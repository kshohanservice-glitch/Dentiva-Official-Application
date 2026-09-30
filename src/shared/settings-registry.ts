/**
 * Dentiva Pro — canonical settings registry.
 *
 * SINGLE SOURCE OF TRUTH for every setting the application knows:
 *   - group & key ownership (a key lives in exactly one group)
 *   - value type + range/enum validation
 *   - default value
 *
 * The backend (`settings.ts`), the setup wizard, the UI, and the regression
 * tests all consume this registry. There is no setting in the UI that the
 * backend rejects, and no backend key that is impossible to validate.
 *
 * History: v1.0.0 had no registry — the wizard submitted `moneyDecimals` in
 * the `general` group while the backend owned it under `clinic`, which made
 * first-run setup dead-end with "Unknown setting" on real machines (FD-001).
 * This registry makes that class of defect impossible to re-introduce.
 */

export type SettingValue = string | number | boolean | string[] | number[] | null;

export interface SettingDef {
  /** Human-facing key type label (used in error messages). */
  kind: 'string' | 'integer' | 'boolean' | 'string[]' | 'number[]' | 'nullable-string';
  default: SettingValue;
  /** Inclusive numeric range for integers. */
  min?: number;
  max?: number;
  /** Allowed values (enum) for strings / integers. */
  enum?: readonly (string | number)[];
  /** Max string length (0 = unlimited). */
  maxLen?: number;
  /** Max array length (0 = unlimited). */
  maxItems?: number;
  /** Each string[] item max length (0 = unlimited). */
  itemMaxLen?: number;
  /** Inclusive per-item range for number[] arrays. */
  itemMin?: number;
  itemMax?: number;
  /** Pattern the string value must match (null values always allowed). */
  pattern?: RegExp;
}

/** Validate one value against its definition. Returns an error message or null when valid. */
export function validateSettingValue(def: SettingDef, value: unknown): string | null {
  if (def.kind === 'nullable-string' || def.kind === 'string') {
    if (value === null) return def.kind === 'string' ? 'must be a string' : null;
    if (typeof value !== 'string') return 'must be a string (or empty)';
    if (def.maxLen && value.length > def.maxLen) return `must be at most ${def.maxLen} characters`;
    if (def.enum && !(def.enum as readonly string[]).includes(value)) {
      return `must be one of: ${def.enum.join(', ')}`;
    }
    if (def.pattern && !def.pattern.test(value)) return `has an invalid format`;
    return null;
  }
  if (def.kind === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'must be a whole number';
    if (def.min !== undefined && value < def.min) return `must be at least ${def.min}`;
    if (def.max !== undefined && value > def.max) return `must be at most ${def.max}`;
    if (def.enum && !(def.enum as readonly number[]).includes(value)) {
      return `must be one of: ${def.enum.join(', ')}`;
    }
    return null;
  }
  if (def.kind === 'boolean') {
    if (typeof value !== 'boolean') return 'must be true or false';
    return null;
  }
  if (def.kind === 'string[]') {
    if (!Array.isArray(value)) return 'must be a list';
    if (def.maxItems && value.length > def.maxItems) return `must have at most ${def.maxItems} items`;
    for (const item of value) {
      if (typeof item !== 'string') return 'items must be strings';
      if (def.itemMaxLen && item.length > def.itemMaxLen) {
        return `items must be at most ${def.itemMaxLen} characters`;
      }
    }
    return null;
  }
  if (def.kind === 'number[]') {
    if (!Array.isArray(value)) return 'must be a list';
    if (def.maxItems && value.length > def.maxItems) return `must have at most ${def.maxItems} items`;
    for (const item of value) {
      if (typeof item !== 'number' || !Number.isInteger(item)) return 'items must be whole numbers';
      if (def.itemMin !== undefined && item < def.itemMin) return `items must be at least ${def.itemMin}`;
      if (def.itemMax !== undefined && item > def.itemMax) return `items must be at most ${def.itemMax}`;
    }
    return null;
  }
  return 'unknown setting type';
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const SETTINGS_REGISTRY: Record<string, Record<string, SettingDef>> = {
  clinic: {
    name: { kind: 'string', default: '', maxLen: 200 },
    logoPath: { kind: 'nullable-string', default: null, maxLen: 500 },
    address: { kind: 'string', default: '', maxLen: 500 },
    phone: { kind: 'string', default: '', maxLen: 30 },
    altPhone: { kind: 'string', default: '', maxLen: 30 },
    email: { kind: 'string', default: '', maxLen: 100 },
    website: { kind: 'string', default: '', maxLen: 200 },
    openingHours: { kind: 'string', default: '9:00 AM – 9:00 PM', maxLen: 100 },
    closingDays: {
      kind: 'number[]',
      default: [5], // Friday (0=Sunday..6=Saturday)
      maxItems: 7,
      itemMin: 0,
      itemMax: 6,
    },
    emergencyContact: { kind: 'string', default: '', maxLen: 100 },
    footerMessage: { kind: 'string', default: 'Get well soon. Thank you for your trust.', maxLen: 300 },
    prescriptionMessage: { kind: 'string', default: '', maxLen: 300 },
    timezone: { kind: 'string', default: 'Asia/Dhaka', maxLen: 64 },
    use24HourTime: { kind: 'boolean', default: false },
    /** Canonical owner of the currency-decimal preference (NOT general.*). */
    moneyDecimals: { kind: 'integer', default: 2, min: 0, max: 4 },
  },
  security: {
    autoLockMinutes: { kind: 'integer', default: 10, min: 0, max: 240 },
    allowDisableAutoLock: { kind: 'boolean', default: false },
    maxLoginAttempts: { kind: 'integer', default: 5, min: 1, max: 20 },
    lockoutMinutes: { kind: 'integer', default: 15, min: 1, max: 1440 },
    passwordMinLength: { kind: 'integer', default: 8, min: 6, max: 64 },
    passwordRequireLetter: { kind: 'boolean', default: true },
    passwordRequireNumber: { kind: 'boolean', default: true },
  },
  appearance: {
    theme: { kind: 'string', default: 'light', enum: ['light', 'dark', 'system'] },
    density: { kind: 'string', default: 'comfortable', enum: ['comfortable', 'compact'] },
    reducedMotion: { kind: 'string', default: 'system', enum: ['system', 'reduce', 'never'] },
  },
  backup: {
    folder: { kind: 'string', default: '', maxLen: 500 },
    /** 0 = disabled; only the documented retention cadences are allowed. */
    autoEveryDays: { kind: 'integer', default: 0, enum: [0, 7, 15, 30] },
    keepCount: { kind: 'integer', default: 10, min: 1, max: 100 },
    lastSuccessAt: { kind: 'nullable-string', default: null, maxLen: 64 },
    lastResult: { kind: 'nullable-string', default: null, maxLen: 300 },
  },
  appointments: {
    defaultDurationMin: { kind: 'integer', default: 30, min: 5, max: 480 },
    slotIntervalMin: { kind: 'integer', default: 15, min: 5, max: 120 },
    workStart: { kind: 'string', default: '09:00', pattern: TIME_RE },
    workEnd: { kind: 'string', default: '21:00', pattern: TIME_RE },
    reminderMin: { kind: 'integer', default: 30, min: 0, max: 720 },
  },
  invoice: {
    prefix: { kind: 'string', default: 'INV-', maxLen: 16, pattern: /^[^\s/\\]+$/ },
    /** Default tax rate (%) offered by the invoice editor; the editor still records an explicit amount. */
    taxRate: { kind: 'integer', default: 0, min: 0, max: 100 },
  },
  notifications: {
    lowStockEnabled: { kind: 'boolean', default: true },
    expiryDays: { kind: 'integer', default: 30, min: 1, max: 365 },
    appointmentReminders: { kind: 'boolean', default: true },
    unpaidInvoiceDays: { kind: 'integer', default: 7, min: 1, max: 365 },
    backupReminders: { kind: 'boolean', default: true },
  },
  general: {
    patientCodePrefix: { kind: 'string', default: 'P', maxLen: 4, pattern: /^[A-Za-z0-9]+$/ },
    patientCodeDigits: { kind: 'integer', default: 5, min: 3, max: 10 },
    dateFormat: { kind: 'string', default: 'short', enum: ['short', 'long'] },
  },
};

/**
 * Keys removed from the product since v1.0.0 (orphaned — no UI, no runtime
 * consumer). `cleanupRemovedSettings()` deletes their stored rows on startup
 * so an upgraded database never carries dead values.
 */
export const REMOVED_SETTINGS: Array<[group: string, key: string]> = [
  ['appearance', 'sidebarCollapsed'],
  ['general', 'language'],
  ['general', 'visitCodeDigits'],
  ['invoice', 'footerNote'],
  ['invoice', 'nextNumber'],
  ['invoice', 'showDentistInHeader'],
  ['prescription', 'terminology'],
  ['prescription', 'showAvailability'],
  ['prescription', 'defaultAdvice'],
];

export function listGroups(): string[] {
  return Object.keys(SETTINGS_REGISTRY);
}

export function groupExists(group: string): boolean {
  return Object.prototype.hasOwnProperty.call(SETTINGS_REGISTRY, group);
}

export function keyExists(group: string, key: string): boolean {
  const g = SETTINGS_REGISTRY[group];
  return !!g && Object.prototype.hasOwnProperty.call(g, key);
}

/** Deep-cloned defaults for every registered group (safe to mutate by callers). */
export function registryDefaults(): Record<string, Record<string, SettingValue>> {
  const out: Record<string, Record<string, SettingValue>> = {};
  for (const [group, keys] of Object.entries(SETTINGS_REGISTRY)) {
    out[group] = {};
    for (const [key, def] of Object.entries(keys)) {
      out[group][key] =
        typeof def.default === 'object' && def.default !== null
          ? ([...(def.default as string[] | number[])] as string[] | number[])
          : def.default;
    }
  }
  return out;
}

/**
 * Validate a full `group → values` payload (as sent by the UI / wizard).
 * Returns a list of precise error strings; empty list = acceptable.
 */
export function validateSettingsPayload(
  payload: Record<string, Record<string, unknown>>,
): string[] {
  const errors: string[] = [];
  for (const [group, values] of Object.entries(payload)) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    if (!groupExists(group)) {
      errors.push(`Unknown settings group: ${group}`);
      continue;
    }
    for (const [key, value] of Object.entries(values)) {
      if (!keyExists(group, key)) {
        errors.push(`Unknown setting: ${group}.${key}`);
        continue;
      }
      const err = validateSettingValue(SETTINGS_REGISTRY[group][key], value);
      if (err) errors.push(`${group}.${key} ${err}`);
    }
  }
  return errors;
}
