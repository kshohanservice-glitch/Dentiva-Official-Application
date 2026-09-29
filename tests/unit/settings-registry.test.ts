import { describe, expect, it } from 'vitest';
import {
  SETTINGS_REGISTRY,
  listGroups,
  validateSettingValue,
  validateSettingsPayload,
  registryDefaults,
  REMOVED_SETTINGS,
} from '../../src/shared/settings-registry';
import { DEFAULT_SETTINGS } from '../../src/main/services/settings';

/**
 * FD-001 regression: the v1.0.0 setup wizard submitted `moneyDecimals` under
 * the `general` group while the backend owned it under `clinic`, dead-ending
 * first-run setup with "Unknown setting". The canonical registry pins key
 * ownership so no UI payload can drift from the backend again.
 */

describe('canonical settings registry', () => {
  it('owns moneyDecimals in the clinic group (the FD-001 contract)', () => {
    expect(SETTINGS_REGISTRY.clinic.moneyDecimals).toBeDefined();
    expect(SETTINGS_REGISTRY.general).not.toHaveProperty('moneyDecimals');
    expect(DEFAULT_SETTINGS.clinic.moneyDecimals).toBe(2);
    expect((DEFAULT_SETTINGS.general as Record<string, unknown>).moneyDecimals).toBeUndefined();
  });

  it('the wizard preferences payload (canonical shape) is fully accepted', () => {
    // Exact shape the setup wizard step 4 submits after the FD-001 fix.
    const payload = {
      security: { autoLockMinutes: 10 },
      general: { dateFormat: 'short' },
      clinic: { use24HourTime: false, moneyDecimals: 0 },
      backup: { autoEveryDays: 7, folder: 'C:/Backups' },
    };
    expect(validateSettingsPayload(payload)).toEqual([]);
  });

  it('the v1.0.0 wizard payload (general.moneyDecimals) is rejected with a precise error', () => {
    const legacyPayload = {
      general: { moneyDecimals: 0 },
    };
    const errors = validateSettingsPayload(legacyPayload);
    expect(errors).toEqual(['Unknown setting: general.moneyDecimals']);
  });

  it('every registered key has a valid default', () => {
    for (const [group, keys] of Object.entries(SETTINGS_REGISTRY)) {
      for (const [key, def] of Object.entries(keys)) {
        expect(validateSettingValue(def, def.default), `${group}.${key} default`).toBeNull();
      }
    }
  });

  it('rejects invalid value types and ranges', () => {
    const clinic = SETTINGS_REGISTRY.clinic;
    const security = SETTINGS_REGISTRY.security;
    const backup = SETTINGS_REGISTRY.backup;
    const appointments = SETTINGS_REGISTRY.appointments;

    expect(validateSettingValue(clinic.moneyDecimals, 2)).toBeNull();
    expect(validateSettingValue(clinic.moneyDecimals, 17)).toMatch(/at most 4/);
    expect(validateSettingValue(clinic.moneyDecimals, 1.5)).toMatch(/whole number/);
    expect(validateSettingValue(clinic.moneyDecimals, '2')).toMatch(/whole number/);
    expect(validateSettingValue(clinic.closingDays, [5, 6])).toBeNull();
    expect(validateSettingValue(clinic.closingDays, [5, 9])).toMatch(/at most 6/);
    expect(validateSettingValue(clinic.closingDays, 'Fri')).toMatch(/list/);
    expect(validateSettingValue(clinic.name, 'x'.repeat(201))).toMatch(/at most 200/);
    expect(validateSettingValue(security.autoLockMinutes, 0)).toBeNull();
    expect(validateSettingValue(security.autoLockMinutes, -5)).toMatch(/at least 0/);
    expect(validateSettingValue(backup.autoEveryDays, 7)).toBeNull();
    expect(validateSettingValue(backup.autoEveryDays, 3)).toMatch(/one of/);
    expect(validateSettingValue(appointments.workStart, '09:00')).toBeNull();
    expect(validateSettingValue(appointments.workStart, '25:99')).toMatch(/invalid format/);
    expect(validateSettingValue(clinic.use24HourTime, 'yes')).toMatch(/true or false/);
  });

  it('registry defaults equal the backend DEFAULT_SETTINGS (single source of truth)', () => {
    expect(DEFAULT_SETTINGS).toEqual(registryDefaults());
  });

  it('relocated-or-removed v1.0.0 keys are tracked for startup purge', () => {
    // None of the removed keys may reappear in the registry.
    for (const [group, key] of REMOVED_SETTINGS) {
      expect(SETTINGS_REGISTRY[group]?.[key], `${group}.${key} must stay removed`).toBeUndefined();
    }
    // moneyDecimals was relocated (not removed): it must exist under clinic.
    expect(REMOVED_SETTINGS).not.toContainEqual(['clinic', 'moneyDecimals']);
    expect(listGroups()).not.toContain('prescription'); // group removed entirely
  });

  it('every group in DEFAULT_SETTINGS is a registered group', () => {
    for (const g of Object.keys(DEFAULT_SETTINGS)) {
      expect(SETTINGS_REGISTRY[g], `group ${g} must be registered`).toBeDefined();
    }
  });
});
