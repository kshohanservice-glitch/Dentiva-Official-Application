import { describe, expect, it, beforeEach } from 'vitest';
import {
  CURRENCY_SYMBOL,
  formatAmount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatTime,
  getFormatConfig,
  setFormatConfig,
} from '../../src/shared/format';

/**
 * FD-007 regression: moneyDecimals / use24HourTime / dateFormat were persisted
 * but never consumed — the format helpers always used hard-coded defaults.
 * The runtime config makes every call site honor the user's settings.
 */

beforeEach(() => {
  setFormatConfig({ moneyDecimals: 2, use24HourTime: false, dateFormat: 'short' });
});

describe('format config (settings → format helpers)', () => {
  it('money formatting follows moneyDecimals', () => {
    expect(formatMoney(1250)).toBe(`${CURRENCY_SYMBOL} 1,250.00`);
    setFormatConfig({ moneyDecimals: 0 });
    expect(formatMoney(1250)).toBe(`${CURRENCY_SYMBOL} 1,250`);
    expect(formatAmount(1250.456)).toBe('1,250');
    setFormatConfig({ moneyDecimals: 4 });
    expect(formatMoney(12.5)).toBe(`${CURRENCY_SYMBOL} 12.5000`);
    // explicit argument still wins over the config
    expect(formatMoney(1250, 3)).toBe(`${CURRENCY_SYMBOL} 1,250.000`);
  });

  it('date/time formatting follows dateFormat and use24HourTime', () => {
    expect(formatDate('2026-09-28')).toBe('28 Sep 2026');
    setFormatConfig({ dateFormat: 'long' });
    expect(formatDate('2026-09-28')).toBe('28 September 2026');
    expect(formatDate('2026-09-28', 'numeric')).toBe('28/09/2026'); // explicit wins

    setFormatConfig({ dateFormat: 'short', use24HourTime: true });
    expect(formatTime('2026-09-28T14:05:00')).toBe('14:05');
    expect(formatDateTime('2026-09-28T14:05:00')).toBe('28 Sep 2026, 14:05');
    setFormatConfig({ use24HourTime: false });
    expect(formatTime('2026-09-28T14:05:00')).toBe('2:05 PM');
  });

  it('out-of-range config values are clamped (never corrupt formatting)', () => {
    // The registry rejects these at the settings layer; the config layer
    // clamps defensively so no caller can force an invalid decimal count.
    setFormatConfig({ moneyDecimals: 17 } as never);
    expect(getFormatConfig().moneyDecimals).toBe(4); // clamped down
    setFormatConfig({ moneyDecimals: -1 } as never);
    expect(getFormatConfig().moneyDecimals).toBe(0); // clamped up
    setFormatConfig({ moneyDecimals: 1.5 } as never);
    expect(getFormatConfig().moneyDecimals).toBe(0); // non-integer ignored → previous value
  });
});
