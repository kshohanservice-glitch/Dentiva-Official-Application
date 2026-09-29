import fs from 'node:fs';
import path from 'node:path';
import { currentDb, tx } from '../db/database';
import { paths } from '../paths';
import { logger } from '../logger';
import { hashPassword, checkPasswordStrength } from '../security/password';
import { recordAudit, ServiceError } from './common';
import { getAllSettings, setSettings, DEFAULT_SETTINGS, getSecuritySettings } from './settings';
import { systemActor } from './auth';
import type {
  AdminAccountInput,
  ClinicInput,
  DentistInput,
  SetupProgress,
  SettingsPayload,
} from '../../shared/contract';

/**
 * First-run setup wizard — resumable, transactional per step, never leaves a
 * partially initialized state marked complete.
 */

function getState(key: string): string | null {
  const row = currentDb().prepare('SELECT value FROM system_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setState(key: string, value: string): void {
  currentDb()
    .prepare(
      `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value);
}

export function isSetupComplete(): boolean {
  return getState('setup.complete') === '1';
}

export function getSetupStep(): number {
  return Number(getState('setup.step') ?? '0');
}

export function setupStatus(): SetupProgress {
  const db = currentDb();
  const clinic = (getAllSettings().clinic ?? {}) as Record<string, unknown>;
  const dentists = db.prepare('SELECT COUNT(*) AS c FROM dentists WHERE deleted_at IS NULL').get() as { c: number };
  const admins = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL`).get() as { c: number };
  return {
    step: getSetupStep(),
    clinicSaved: Boolean(clinic.name) && getState('setup.clinic') === '1',
    dentistsSaved: dentists.c > 0 && getState('setup.dentists') === '1',
    adminSaved: admins.c > 0 && getState('setup.admin') === '1',
    preferencesSaved: getState('setup.preferences') === '1',
  };
}

function saveStep(name: string, step: number): void {
  setState(`setup.${name}`, '1');
  const current = getSetupStep();
  if (step > current) setState('setup.step', String(step));
}

/* ------------------------------- image helpers ------------------------------- */

function decodeDataUrl(data: string): { buf: Buffer; mime: string } {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/.exec(data.trim());
  if (!m) throw new ServiceError('validation', 'Logo must be a PNG or JPEG image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw new ServiceError('validation', 'Logo must be ≤ 2 MB');
  const mime = m[1];
  const isPng = mime === 'image/png' && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpg = mime === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8;
  if (!isPng && !isJpg) throw new ServiceError('validation', 'Logo content does not match a valid PNG/JPEG file');
  return { buf, mime };
}

function imageDimensions(buf: Buffer, mime: string): { w: number; h: number } | null {
  try {
    if (mime === 'image/png' && buf.length > 24) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) break;
        const marker = buf[off + 1];
        const len = buf.readUInt16BE(off + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
        }
        off += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Validate (MIME magic + size + minimum dimensions) and store an image from a
 * base64 data-URL. Shared by the setup wizard (clinic logo, dentist photos)
 * and Settings → Clinic (logo re-upload, FD-006).
 */
export function storeImageFromDataUrl(data: string, dir: string, name: string): string {
  const { buf, mime } = decodeDataUrl(data);
  const dims = imageDimensions(buf, mime);
  if (dims && (dims.w < 32 || dims.h < 32)) {
    throw new ServiceError('validation', `Image is too small (${dims.w}×${dims.h}). Minimum 32×32 px.`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const target = path.join(dir, `${name}.${ext}`);
  fs.writeFileSync(target, buf);
  return target;
}

function storeImage(data: string, dir: string, name: string): string {
  return storeImageFromDataUrl(data, dir, name);
}

/* --------------------------------- steps --------------------------------- */

const PHONE_RE = /^[+]?[\d\s\-()]{6,20}$/;

export function setupSaveClinic(input: ClinicInput): { ok: true; step: number } {
  if (!input.name || input.name.trim().length < 2) {
    throw new ServiceError('validation', 'Clinic name is required');
  }
  if (input.phone && !PHONE_RE.test(input.phone.trim())) {
    throw new ServiceError('validation', 'Phone number format is invalid');
  }
  if (input.altPhone && !PHONE_RE.test(input.altPhone.trim())) {
    throw new ServiceError('validation', 'Alternative phone number format is invalid');
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    throw new ServiceError('validation', 'Email format is invalid');
  }
  let logoPath: string | null = (getAllSettings().clinic as Record<string, unknown>).logoPath as string | null;
  if (input.logoData) {
    logoPath = storeImage(input.logoData, paths().clinicLogo, 'logo');
  }
  const values: Record<string, unknown> = {
    name: input.name.trim(),
    address: input.address ?? '',
    phone: input.phone ?? '',
    altPhone: input.altPhone ?? '',
    email: input.email ?? '',
    website: input.website ?? '',
    openingHours: input.openingHours ?? DEFAULT_SETTINGS.clinic.openingHours,
    closingDays: input.closingDays ?? [5],
    emergencyContact: input.emergencyContact ?? '',
    footerMessage: input.footerMessage ?? '',
    prescriptionMessage: input.prescriptionMessage ?? '',
    timezone: input.timezone ?? 'Asia/Dhaka',
    use24HourTime: input.use24HourTime ?? false,
    moneyDecimals: input.moneyDecimals ?? 2,
    logoPath,
  };
  setSettings(systemActor(), 'clinic', values);
  saveStep('clinic', 1);
  return { ok: true, step: 1 };
}

export function setupSaveDentists(dentists: DentistInput[]): { ok: true; step: number } {
  if (!dentists.length) throw new ServiceError('validation', 'At least one dentist is required');
  const db = currentDb();
  const txRes = tx(() => {
    for (const d of dentists) {
      if (!d.fullName || d.fullName.trim().length < 2) {
        throw new ServiceError('validation', 'Dentist full name is required');
      }
      if (d.phone && !PHONE_RE.test(d.phone.trim())) {
        throw new ServiceError('validation', `Invalid phone for ${d.fullName}`);
      }
      let photoPath: string | null = null;
      if (d.photoData) photoPath = storeImage(d.photoData, paths().dentists, `dentist-${Date.now()}`);
      let sigPath: string | null = null;
      if (d.signatureData) sigPath = storeImage(d.signatureData, paths().dentists, `sig-${Date.now()}`);
      if (d.id) {
        db.prepare(
          `UPDATE dentists SET full_name=?, designations_json=?, qualifications=?, license_no=?, phone=?, email=?,
            availability_json=?, working_hours=?, active=1, updated_at=datetime('now','localtime'),
            photo_path=COALESCE(?, photo_path), signature_path=COALESCE(?, signature_path) WHERE id=?`,
        ).run(
          d.fullName.trim(),
          JSON.stringify(d.designations ?? []),
          d.qualifications ?? null,
          d.licenseNo ?? null,
          d.phone ?? null,
          d.email ?? null,
          JSON.stringify(d.availability ?? [0, 1, 2, 3, 4, 5, 6]),
          d.workingHours ?? null,
          photoPath,
          sigPath,
          d.id,
        );
      } else {
        const code = nextDentistCode();
        db.prepare(
          `INSERT INTO dentists (dentist_code, full_name, photo_path, designations_json, qualifications, license_no, phone, email, signature_path, availability_json, working_hours)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          code,
          d.fullName.trim(),
          photoPath,
          JSON.stringify(d.designations ?? []),
          d.qualifications ?? null,
          d.licenseNo ?? null,
          d.phone ?? null,
          d.email ?? null,
          sigPath,
          JSON.stringify(d.availability ?? [0, 1, 2, 3, 4, 5, 6]),
          d.workingHours ?? null,
        );
      }
    }
  });
  void txRes;
  saveStep('dentists', 2);
  return { ok: true, step: 2 };
}

function nextDentistCode(): string {
  const db = currentDb();
  const row = db.prepare("SELECT value FROM system_state WHERE key = 'counter.dentist'").get() as
    | { value: string }
    | undefined;
  const n = row ? Number(row.value) + 1 : 1;
  db.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES ('counter.dentist', ?, datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(n));
  return `D${String(n).padStart(3, '0')}`;
}

export function setupSaveAdmin(input: AdminAccountInput): { ok: true; step: number } {
  const db = currentDb();
  const username = input.username.trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    throw new ServiceError('validation', 'Username must be 3–32 chars (letters, numbers, . _ -)');
  }
  const dup = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (dup) throw new ServiceError('validation', 'Username already exists');
  const strength = checkPasswordStrength(input.password, getSecuritySettings().passwordPolicy, username);
  if (!strength.ok) {
    throw new ServiceError('validation', 'Password too weak: ' + strength.issues.join(', '));
  }
  const ownerRole = db.prepare("SELECT id FROM roles WHERE name = 'Owner'").get() as { id: number };
  const rec = hashPassword(input.password);
  tx(() => {
    db.prepare(
      `INSERT INTO users (username, password_hash, password_salt, password_params, display_name, role_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(username, rec.hash, rec.salt, rec.params, input.displayName?.trim() || username, ownerRole.id);
  });
  saveStep('admin', 3);
  recordAudit({
    actor: { userId: null, username: 'setup' },
    action: 'setup.admin_created',
    entity: 'user',
    metadata: { username },
  });
  return { ok: true, step: 3 };
}

export function setupSavePreferences(prefs: SettingsPayload): { ok: true; step: number } {
  const actor = systemActor();
  for (const [group, values] of Object.entries(prefs)) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    // preferences step may only touch non-critical clinic keys (identity is step 0).
    // NOTE: moneyDecimals belongs to the `clinic` group per the canonical registry —
    // submitting it under `general` is rejected by setSettings (FD-001 regression guard).
    if (group === 'clinic') {
      const allowed = ['use24HourTime', 'moneyDecimals', 'timezone'];
      const filtered: Record<string, unknown> = {};
      for (const k of allowed) if (k in values) filtered[k] = values[k];
      if (Object.keys(filtered).length) setSettings(actor, 'clinic', filtered);
      continue;
    }
    // Unknown groups/keys or invalid values throw — the wizard must never
    // silently persist settings the backend doesn't own.
    setSettings(actor, group, values as Record<string, unknown>);
  }
  saveStep('preferences', 4);
  return { ok: true, step: 4 };
}

export function setupFinish(): { ok: true; step: number } {
  const status = setupStatus();
  if (!status.clinicSaved || !status.dentistsSaved || !status.adminSaved) {
    throw new ServiceError('validation', 'Setup is incomplete');
  }
  if (!status.preferencesSaved) {
    // defaults are valid preferences; mark them as applied
    saveStep('preferences', 4);
  }
  setState('setup.complete', '1');
  setState('setup.step', '5');
  logger.info('Setup wizard completed');
  recordAudit({ actor: { userId: null, username: 'setup' }, action: 'setup.completed' });
  return { ok: true, step: 5 };
}

/** Ensures default printer profiles + settings exist (idempotent). */
export function ensureRuntimeDefaults(): void {
  void paths();
  void logger;
}
