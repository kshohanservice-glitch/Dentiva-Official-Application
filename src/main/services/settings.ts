import { currentDb } from '../db/database';
import { logger } from '../logger';
import { recordAudit, requirePermission, ServiceError, type ServiceActor } from './common';
import { DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from '../security/password';
import {
  REMOVED_SETTINGS,
  SETTINGS_REGISTRY,
  groupExists,
  keyExists,
  registryDefaults,
  validateSettingValue,
} from '../../shared/settings-registry';
import { setFormatConfig } from '../../shared/format';

/**
 * Central settings store (app_settings KV, JSON values, grouped).
 *
 * Every key is validated against the canonical registry
 * (`src/shared/settings-registry.ts`):
 *   - unknown group  → rejected
 *   - unknown key    → rejected (FD-001 class of defect)
 *   - invalid value  → rejected with a precise message (FD-009)
 *   - corrupt stored value on read → repaired to default + logged
 *
 * `DEFAULT_SETTINGS` is derived from the registry so there is exactly one
 * place where defaults exist.
 */
import type { SettingsPayload } from '../../shared/contract';

export const DEFAULT_SETTINGS: SettingsPayload = registryDefaults() as SettingsPayload;

export function getAllSettings(): SettingsPayload {
  const db = currentDb();
  const rows = db.prepare('SELECT group_name, key, value_json FROM app_settings').all() as {
    group_name: string;
    key: string;
    value_json: string;
  }[];
  const merged = registryDefaults();
  for (const r of rows) {
    if (!groupExists(r.group_name) || !keyExists(r.group_name, r.key)) continue; // orphan row (removed key)
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.value_json);
    } catch {
      logger.warn(`Corrupt settings value (kept default): ${r.group_name}.${r.key}`);
      continue;
    }
    const def = SETTINGS_REGISTRY[r.group_name][r.key];
    const err = validateSettingValue(def, parsed);
    if (err) {
      logger.warn(`Invalid settings value (kept default ${JSON.stringify(def.default)}): ${r.group_name}.${r.key} ${err}`);
      continue;
    }
    merged[r.group_name][r.key] = parsed as (typeof merged)[string][string];
  }
  return merged as unknown as SettingsPayload;
}

export function getSettings(group?: string): SettingsPayload {
  const all = getAllSettings();
  if (!group) return all;
  const value = (all as Record<string, unknown>)[group];
  if (!value) throw new ServiceError('not_found', `Unknown settings group: ${group}`, 404);
  return { [group]: value } as SettingsPayload;
}

export function setSettings(actor: ServiceActor, group: string, values: Record<string, unknown>): void {
  requirePermission(actor, 'settings.manage');
  if (!groupExists(group)) throw new ServiceError('not_found', `Unknown settings group: ${group}`, 404);

  // Validate the whole payload first — either everything applies or nothing does.
  for (const [k, v] of Object.entries(values)) {
    if (!keyExists(group, k)) {
      throw new ServiceError('validation', `Unknown setting: ${group}.${k}`, 400);
    }
    const err = validateSettingValue(SETTINGS_REGISTRY[group][k], v);
    if (err) {
      throw new ServiceError('validation', `Settings validation failed: ${group}.${k} ${err}`, 400);
    }
  }

  const before = getSettings(group)[group];
  const db = currentDb();
  const upsert = db.prepare(
    `INSERT INTO app_settings (group_name, key, value_json, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(group_name, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  );
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(values)) {
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
  try {
    applyFormatConfigFromSettings();
  } catch {
    /* format config is best-effort */
  }
}

/**
 * One-time hygiene for upgraded v1.0.0 databases: delete stored rows for keys
 * that were removed from the product (orphaned — no UI, no runtime consumer).
 * Idempotent; runs at startup after seeding.
 */
export function cleanupRemovedSettings(): void {
  try {
    const db = currentDb();
    const del = db.prepare('DELETE FROM app_settings WHERE group_name = ? AND key = ?');
    for (const [group, key] of REMOVED_SETTINGS) {
      del.run(group, key);
    }
  } catch (err) {
    logger.warn('cleanupRemovedSettings failed (non-fatal)', { err: String(err) });
  }
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

/**
 * Push the canonical format settings into the shared format helpers (main
 * process instance) so printing/reports honor moneyDecimals / 24h / date style
 * (FD-007). Called at startup, after restore, and after every settings write.
 */
export function applyFormatConfigFromSettings(): void {
  const all = getAllSettings();
  const clinic = all.clinic as Record<string, unknown>;
  const general = all.general as Record<string, unknown>;
  setFormatConfig({
    moneyDecimals: Number.isInteger(clinic.moneyDecimals) ? (clinic.moneyDecimals as number) : 2,
    use24HourTime: Boolean(clinic.use24HourTime),
    dateFormat: general.dateFormat === 'long' ? 'long' : 'short',
  });
}
