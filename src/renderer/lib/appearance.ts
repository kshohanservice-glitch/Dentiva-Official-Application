import { getFormatConfig, setFormatConfig } from '@shared/format';

/**
 * Applies user appearance + format settings to the document (FD-007/FD-011).
 * `data-theme` / `data-density` / `data-motion` are consumed by tokens.css.
 * Returns a cleanup function that restores the light, comfortable, system state.
 */
export function applyAppearance(settings: {
  theme?: string;
  density?: string;
  reducedMotion?: string;
}): () => void {
  const root = document.documentElement;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const theme = settings.theme === 'dark' || settings.theme === 'light' ? settings.theme : 'system';
  const density = settings.density === 'compact' ? 'compact' : 'comfortable';
  const motion = settings.reducedMotion === 'reduce' || settings.reducedMotion === 'never' ? settings.reducedMotion : 'system';

  const setTheme = () => {
    root.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
  };
  setTheme();
  if (theme === 'system') {
    mq.addEventListener?.('change', setTheme);
  }

  root.dataset.density = density;
  root.dataset.motion = motion;

  return () => {
    mq.removeEventListener?.('change', setTheme);
    root.dataset.theme = 'light';
    root.dataset.density = 'comfortable';
    root.dataset.motion = 'system';
  };
}

/** Apply canonical format prefs (money decimals, 24h, date style) to the shared helpers. */
export function applyFormatPrefs(prefs: {
  moneyDecimals: number;
  use24HourTime: boolean;
  dateFormat: 'short' | 'long';
}): void {
  setFormatConfig(prefs);
  void getFormatConfig();
}
