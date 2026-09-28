import { describe, expect, it } from 'vitest';
import {
  ageFromDob,
  formatAmount,
  formatMoney,
  formatDate,
  formatDateTime,
  formatPercent,
  parseMoney,
  sanitizeText,
  todayIso,
  truncate,
} from '../../src/shared/format';

describe('formatMoney', () => {
  it('uses ৳ BDT symbol with 2 decimals by default', () => {
    expect(formatMoney(1234.5)).toBe('৳ 1,234.50');
    expect(formatMoney(0)).toBe('৳ 0.00');
  });

  it('handles null/undefined as zero', () => {
    expect(formatMoney(null)).toBe('৳ 0.00');
    expect(formatMoney(undefined)).toBe('৳ 0.00');
  });

  it('respects decimal override', () => {
    expect(formatMoney(99.999, 0)).toBe('৳ 100');
  });

  it('formats negative amounts', () => {
    expect(formatMoney(-5)).toContain('-');
    expect(formatMoney(-5)).toContain('৳');
  });
});

describe('formatAmount', () => {
  it('omits symbol for compact display', () => {
    expect(formatAmount(10.5)).toBe('10.50');
  });
});

describe('parseMoney', () => {
  it('parses plain numbers and strips separators', () => {
    expect(parseMoney('1234.56')).toBe(1234.56);
    expect(parseMoney('1,234.56')).toBe(1234.56);
    expect(parseMoney('৳ 1,000')).toBe(1000);
  });

  it('returns NaN for garbage', () => {
    expect(parseMoney('abc')).toBeNaN();
    expect(parseMoney('')).toBeNaN();
  });
});

describe('dates', () => {
  it('todayIso returns YYYY-MM-DD', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formatDate numeric style is DD/MM/YYYY', () => {
    expect(formatDate('2026-01-05', 'numeric')).toBe('05/01/2026');
  });

  it('formatDate handles null', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });

  it('formatDateTime includes date and time', () => {
    const out = formatDateTime('2026-01-05T14:30:00');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/2:30 PM|14:30/);
  });
});

describe('ageFromDob', () => {
  it('computes whole-year age', () => {
    expect(ageFromDob('2000-06-15', new Date('2026-06-14'))).toBe(25);
    expect(ageFromDob('2000-06-15', new Date('2026-06-15'))).toBe(26);
  });

  it('null for missing dob', () => {
    expect(ageFromDob(null)).toBeNull();
    expect(ageFromDob(undefined)).toBeNull();
  });
});

describe('sanitizeText', () => {
  it('removes control characters (keeps printable text)', () => {
    expect(sanitizeText('a\u0007b\u0000c')).toBe('abc');
    expect(sanitizeText('bell\u0007')).toBe('bell');
  });

  it('preserves Bengali Unicode', () => {
    const bn = 'আমার সোনার বাংলা';
    expect(sanitizeText(bn)).toBe(bn);
  });

  it('preserves newlines and tabs in clinical notes', () => {
    expect(sanitizeText('line1\nline2')).toContain('\n');
    expect(sanitizeText('a\tb')).toContain('\t');
  });
});

describe('misc', () => {
  it('truncate limits length with ellipsis', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('formatPercent', () => {
    expect(formatPercent(0.125)).toBe('12.5%');
    expect(formatPercent(1)).toBe('100%');
  });
});
