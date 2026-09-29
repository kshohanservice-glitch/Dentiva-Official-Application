/**
 * Formatting utilities — BDT currency, dates, numbers, Bengali-safe text.
 * Locale defaults: Bangladesh (en-BD with Bangla content support).
 *
 * Runtime format config (FD-007): the application's format helpers read a
 * mutable config that the app populates from the canonical settings
 * (clinic.moneyDecimals, clinic.use24HourTime, general.dateFormat). Until
 * then, the values below are the product defaults — so the helpers are safe
 * to use in tests and in the main process without any initialization.
 */

export const CURRENCY_SYMBOL = '৳';
export const CURRENCY_CODE = 'BDT';

export interface FormatConfig {
  moneyDecimals: number;
  use24HourTime: boolean;
  dateFormat: 'short' | 'long';
}

const formatConfig: FormatConfig = {
  moneyDecimals: 2,
  use24HourTime: false,
  dateFormat: 'short',
};

/** Apply user settings to all format helpers (idempotent). */
export function setFormatConfig(partial: Partial<FormatConfig>): void {
  if (partial.moneyDecimals !== undefined && Number.isInteger(partial.moneyDecimals)) {
    formatConfig.moneyDecimals = Math.min(4, Math.max(0, partial.moneyDecimals));
  }
  if (partial.use24HourTime !== undefined) formatConfig.use24HourTime = Boolean(partial.use24HourTime);
  if (partial.dateFormat !== undefined) formatConfig.dateFormat = partial.dateFormat;
}

export function getFormatConfig(): FormatConfig {
  return { ...formatConfig };
}

/** Format a money amount as `৳ 1,250.00` (grouping by thousands; decimals from settings). */
export function formatMoney(amount: number | null | undefined, decimals = formatConfig.moneyDecimals): string {
  const value = Number.isFinite(amount) ? (amount as number) : 0;
  const d = Math.min(4, Math.max(0, decimals));
  const fixed = Math.abs(value).toFixed(d);
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = value < 0 ? '-' : '';
  return `${sign}${CURRENCY_SYMBOL} ${grouped}${decPart ? '.' + decPart : ''}`;
}

/** Compact money without the symbol (for tables that render the symbol once). */
export function formatAmount(amount: number | null | undefined, decimals = formatConfig.moneyDecimals): string {
  const value = Number.isFinite(amount) ? (amount as number) : 0;
  const d = Math.min(4, Math.max(0, decimals));
  const fixed = Math.abs(value).toFixed(d);
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = value < 0 ? '-' : '';
  return `${sign}${grouped}${decPart ? '.' + decPart : ''}`;
}

export function parseMoney(input: string): number {
  const cleaned = String(input).replace(/[^\d.-]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** `2026-09-28` → `28 Sep 2026` (default style from settings) */
export function formatDate(
  iso: string | null | undefined,
  style: 'long' | 'short' | 'numeric' = formatConfig.dateFormat,
): string {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = d.getDate();
  const monthIdx = d.getMonth();
  const year = d.getFullYear();
  if (style === 'numeric') return `${pad(day)}/${pad(monthIdx + 1)}/${year}`;
  if (style === 'long') return `${day} ${MONTHS[monthIdx]} ${year}`;
  return `${day} ${MONTHS_SHORT[monthIdx]} ${year}`;
}

/** `2026-09-28T10:30:00` → `28 Sep 2026, 10:30 AM` (12h) or 24h per settings */
export function formatDateTime(iso: string | null | undefined, use24h = formatConfig.use24HourTime): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  const hours = d.getHours();
  const mins = pad(d.getMinutes());
  if (use24h) return `${date}, ${pad(hours)}:${mins}`;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${date}, ${h12}:${mins} ${ampm}`;
}

export function formatTime(iso: string | null | undefined, use24h = formatConfig.use24HourTime): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const hours = d.getHours();
  const mins = pad(d.getMinutes());
  if (use24h) return `${pad(hours)}:${mins}`;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${mins} ${ampm}`;
}

export function weekdayName(weekdayIndex: number, short = false): string {
  const arr = short ? WEEKDAYS_SHORT : WEEKDAYS;
  return arr[((weekdayIndex % 7) + 7) % 7] ?? '';
}

/** Today as `YYYY-MM-DD` in local time. */
export function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Current local timestamp as `YYYY-MM-DDTHH:mm:ss` (no timezone suffix, local-naive). */
export function nowIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

export function ageFromDob(dob: string | null | undefined, reference = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(dob + (dob.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return null;
  let age = reference.getFullYear() - d.getFullYear();
  const m = reference.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && reference.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

/** Clamp + sanitize user text (no control chars except newline/tab). */
export function sanitizeText(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return input.slice(0, max - 1) + '…';
}

/** Percentage from a 0..1 fraction with one decimal (0.125 → '12.5%'). */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  const pct = Math.min(100, Math.max(0, value * 100));
  return `${Math.round(pct * 10) / 10}%`;
}
