import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, teardownDatabase } from './helpers';
import * as setup from '../../src/main/services/setup';
import * as settings from '../../src/main/services/settings';
import { getFormatConfig, formatMoney } from '../../src/shared/format';
import { validateSettingsPayload } from '../../src/shared/settings-registry';

/**
 * Failure C (FD-001) regression, end-to-end through the real services:
 * the setup wizard must complete with the exact payload its step 4 submits,
 * including `moneyDecimals` under the `clinic` group. The v1.0.0 payload
 * (moneyDecimals under `general`) must be rejected with a precise error, and
 * the saved preference must actually change runtime money formatting.
 */

const ADMIN_PW = 'SetupFlow#2026';

// Exact shape submitted by SetupWizard.tsx step 4 ("Save & Continue").
const WIZARD_STEP4_PAYLOAD = {
  security: { autoLockMinutes: 10 },
  general: { dateFormat: 'short' },
  clinic: { use24HourTime: false, moneyDecimals: 0 },
  backup: { autoEveryDays: 7, folder: 'C:\\Dentiva Backups' },
} as const;

beforeAll(() => {
  freshDatabase('setup-flow');
});

afterAll(() => teardownDatabase());

describe('setup wizard (first-run, fresh install)', () => {
  it('wizard steps 1–3 save clinic, dentists and admin (resumable state)', () => {
    expect(setup.setupSaveClinic({ name: 'Regression Clinic', phone: '+880 1700-111111' }).ok).toBe(true);
    expect(setup.setupSaveDentists([{ fullName: 'Dr. Ayesha Karim', designations: ['BDS', 'FCPS'] }]).ok).toBe(true);
    expect(setup.setupSaveAdmin({ username: 'admin', password: ADMIN_PW, displayName: 'Clinic Admin' }).ok).toBe(true);
    expect(setup.isSetupComplete()).toBe(false);
  });

  it('the wizard step-4 payload (canonical) is accepted verbatim', () => {
    const payload = { ...WIZARD_STEP4_PAYLOAD, backup: { ...WIZARD_STEP4_PAYLOAD.backup } };
    // The payload must pass the same validation the backend applies.
    expect(validateSettingsPayload(payload)).toEqual([]);
    const res = setup.setupSavePreferences(payload);
    expect(res.ok).toBe(true);
    expect(res.step).toBe(4);
  });

  it('saved preferences persist and are readable back', () => {
    expect(settings.getSecuritySettings().autoLockMinutes).toBe(10);
    const clinic = settings.getSettings('clinic').clinic as Record<string, unknown>;
    expect(clinic.moneyDecimals).toBe(0);
    expect(clinic.use24HourTime).toBe(false);
    const backup = settings.getSettings('backup').backup as Record<string, unknown>;
    expect(backup.autoEveryDays).toBe(7);
    expect(backup.folder).toBe('C:\\Dentiva Backups');
  });

  it('money formatting honors the wizard choice (0 decimals) — the FD-007 wiring', () => {
    // setSettings applies the format config; the wizard choice must be live.
    expect(getFormatConfig().moneyDecimals).toBe(0);
    expect(formatMoney(1250)).toBe('৳ 1,250');
  });

  it('finishing the wizard marks setup complete', () => {
    expect(setup.setupFinish().ok).toBe(true);
    expect(setup.isSetupComplete()).toBe(true);
  });
});

describe('setup.savePreferences strictness (Failure C root cause)', () => {
  // The service layer rejects with ServiceError (the IPC boundary maps it to
  // the wizard's inline error banner) — nothing invalid is ever persisted.

  it('rejects the v1.0.0 legacy payload (general.moneyDecimals) with a precise error', () => {
    const legacy = { general: { moneyDecimals: 0 } };
    expect(() => setup.setupSavePreferences(legacy)).toThrow(/general\.moneyDecimals/);
  });

  it('rejects unknown keys in any group', () => {
    expect(() => setup.setupSavePreferences({ security: { autoLockMinutes: 5, invented: true } })).toThrow(/invented/);
  });

  it('rejects out-of-range values (moneyDecimals 17)', () => {
    expect(() => setup.setupSavePreferences({ clinic: { moneyDecimals: 17 } })).toThrow(/moneyDecimals/);
  });

  it('accepts a partial update and preserves other groups', () => {
    const res = setup.setupSavePreferences({ security: { autoLockMinutes: 15 } });
    expect(res.ok).toBe(true);
    expect(settings.getSecuritySettings().autoLockMinutes).toBe(15);
    expect((settings.getSettings('clinic').clinic as Record<string, unknown>).moneyDecimals).toBe(0);
  });
});

describe('settings after setup (registry-validated for normal users)', () => {
  const manager = { userId: 1, username: 'admin', permissions: ['settings.manage'] as never[] };

  it('a settings manager can update a registered key; a viewer cannot', () => {
    expect(() => settings.setSettings(manager, 'clinic', { moneyDecimals: 2 })).not.toThrow();
    expect((settings.getSettings('clinic').clinic as Record<string, unknown>).moneyDecimals).toBe(2);
    const viewer = { userId: 99, username: 'viewer', permissions: ['patient.view'] as never[] };
    expect(() => settings.setSettings(viewer, 'clinic', { moneyDecimals: 3 })).toThrow();
    expect((settings.getSettings('clinic').clinic as Record<string, unknown>).moneyDecimals).toBe(2);
  });

  it('format config follows subsequent settings changes', () => {
    settings.setSettings(manager, 'clinic', { moneyDecimals: 1 });
    expect(getFormatConfig().moneyDecimals).toBe(1);
    expect(formatMoney(12.5)).toBe('৳ 12.5');
  });
});
