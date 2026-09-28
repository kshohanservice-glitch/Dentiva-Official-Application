import { currentDb } from '../db/database';
import { recordAudit, requirePermission, ServiceError, type ServiceActor } from './common';
import { DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from '../security/password';
import type { SettingsPayload } from '../../shared/contract';

/** Central settings store (app_settings KV, JSON values, grouped). */

export const DEFAULT_SETTINGS: SettingsPayload = {
  clinic: {
    name: '',
    logoPath: null,
    address: '',
    phone: '',
    altPhone: '',
    email: '',
    website: '',
    openingHours: '9:00 AM – 9:00 PM',
    closingDays: [5], // Friday
    emergencyContact: '',
    footerMessage: 'Get well soon. Thank you for your trust.',
    prescriptionMessage: '',
    timezone: 'Asia/Dhaka',
    use24HourTime: false,
    moneyDecimals: 2,
  },
  security: {
    autoLockMinutes: 10,
    allowDisableAutoLock: false,
    maxLoginAttempts: 5,
    lockoutMinutes: 15,
    passwordMinLength: 8,
    passwordRequireLetter: true,
    passwordRequireNumber: true,
  },
  appearance: {
    theme: 'light',
    density: 'comfortable',
    sidebarCollapsed: false,
    reducedMotion: 'system',
  },
  backup: {
    folder: '',
    autoEveryDays: 0, // 0 = disabled, 7/15/30
    keepCount: 10,
    lastSuccessAt: null as string | null,
    lastResult: null as string | null,
  },
  appointments: {
    defaultDurationMin: 30,
    slotIntervalMin: 15,
    workStart: '09:00',
    workEnd: '21:00',
    reminderMin: 30,
  },
  prescription: {
    terminology: [
      'Pain',
      'G. caries',
      'Swelling',
      'Gum bleeding',
      'Bad breath',
      'Sensitivity',
      'Caries',
      'BDR/BDC',
      'Gingivitis',
      'Periodontal pocket',
      'Periodontitis',
      'Pulpitis',
      'Impacted teeth',
      'Dry socket',
      'Attrition',
      'Erosion',
    ],
    showAvailability: true,
    defaultAdvice: '',
  },
  invoice: {
    prefix: 'INV-',
    nextNumber: 1,
    showDentistInHeader: false,
    taxRate: 0,
    footerNote: 'Thank you for choosing us.',
  },
  notifications: {
    lowStockEnabled: true,
    expiryDays: 30,
    appointmentReminders: true,
    unpaidInvoiceDays: 7,
    backupReminders: true,
  },
  general: {
    patientCodePrefix: 'P',
    patientCodeDigits: 5,
    visitCodeDigits: 5,
    dateFormat: 'short',
    language: 'en',
  },
};

export function getAllSettings(): SettingsPayload {
  const db = currentDb();
  const rows = db.prepare('SELECT group_name, key, value_json FROM app_settings').all() as {
    group_name: string;
    key: string;
    value_json: string;
  }[];
  const merged: Record<string, Record<string, unknown>> = structuredClone(
    DEFAULT_SETTINGS as unknown as Record<string, Record<string, unknown>>,
  );
  for (const r of rows) {
    if (!merged[r.group_name]) merged[r.group_name] = {};
    try {
      merged[r.group_name][r.key] = JSON.parse(r.value_json);
    } catch {
      /* ignore corrupt value, keep default */
    }
  }
  return merged as SettingsPayload;
}

export function getSettings(group?: string): SettingsPayload {
  const all = getAllSettings();
  if (!group) return all;
  const value = all[group];
  if (!value) throw new ServiceError('not_found', `Unknown settings group: ${group}`, 404);
  return { [group]: value };
}

export function setSettings(actor: ServiceActor, group: string, values: Record<string, unknown>): void {
  requirePermission(actor, 'settings.manage');
  if (!DEFAULT_SETTINGS[group]) throw new ServiceError('not_found', `Unknown settings group: ${group}`, 404);
  const before = getSettings(group)[group];
  const db = currentDb();
  const upsert = db.prepare(
    `INSERT INTO app_settings (group_name, key, value_json, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(group_name, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  );
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(values)) {
      if (!(k in (DEFAULT_SETTINGS[group] as Record<string, unknown>))) {
        throw new ServiceError('validation', `Unknown setting: ${group}.${k}`);
      }
      upsert.run(group, k, JSON.stringify(v));
    }
  });
  tx();
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'settings.update',
    entity: 'settings',
    entityId: group,
    before,
    after: values,
  });
}

export interface SecuritySettings {
  autoLockMinutes: number;
  allowDisableAutoLock: boolean;
  maxLoginAttempts: number;
  lockoutMinutes: number;
  passwordPolicy: PasswordPolicy;
}

export function getSecuritySettings(): SecuritySettings {
  const s = (getAllSettings().security ?? {}) as Record<string, unknown>;
  return {
    autoLockMinutes: Number(s.autoLockMinutes ?? 10),
    allowDisableAutoLock: Boolean(s.allowDisableAutoLock),
    maxLoginAttempts: Number(s.maxLoginAttempts ?? 5),
    lockoutMinutes: Number(s.lockoutMinutes ?? 15),
    passwordPolicy: {
      ...DEFAULT_PASSWORD_POLICY,
      minLength: Number(s.passwordMinLength ?? DEFAULT_PASSWORD_POLICY.minLength),
      requireLetter: s.passwordRequireLetter !== false,
      requireNumber: s.passwordRequireNumber !== false,
    },
  };
}

export function getGeneralSettings() {
  return getAllSettings().general;
}
