import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = (f: string) => fs.readFileSync(path.resolve(__dirname, `../../src/renderer/styles/${f}`), 'utf8');

/**
 * CSS contract tests pin the layout/appearance fixes that must survive
 * refactors:
 *  - Failure B: the setup/auth screens must be scrollable on short
 *    viewports (1366×768 at 150% ≈ 512 CSS px tall) — the v1.0.0
 *    min-height:100vh flex centering clipped the wizard with no way to
 *    reach the buttons.
 *  - FD-009: appearance settings (theme / density / motion) must be
 *    implemented as real CSS token overrides, not dead UI.
 */

describe('ui.css — short-viewport scrollability (Failure B)', () => {
  const css = styles('ui.css');

  /** Find the rule whose selector is exactly `selector` (line-anchored, so
   *  `.auth-card {` does not match `.auth-screen > .auth-card {`). */
  function blockOf(selector: string): string {
    selector = selector.replace(/\s*\{$/, ''); // tolerate a trailing brace
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    const m = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{`).exec(css);
    expect(m, `selector ${selector} must exist`).not.toBeNull();
    // absolute index of the opening brace (the match ends with it)
    const open = m!.index + m![0].lastIndexOf('{');
    let depth = 0;
    for (let j = open; j < css.length; j++) {
      if (css[j] === '{') depth++;
      if (css[j] === '}') {
        depth--;
        if (depth === 0) return css.slice(open, j + 1);
      }
    }
    throw new Error('unbalanced css');
  }

  it('.auth-screen (setup + login) scrolls within the viewport', () => {
    const b = blockOf('.auth-screen {');
    expect(b).toMatch(/height:\s*100vh/);
    expect(b).toMatch(/overflow-y:\s*auto/);
    // the old clipping bug: min-height:100vh without a scroll context
    expect(b).not.toMatch(/min-height:\s*100vh/);
  });

  it('auth card is centered when it fits, scrolls when it does not', () => {
    const b = blockOf('.auth-screen > .auth-card {');
    expect(b).toMatch(/margin:\s*auto/);
  });

  it('auth card has no fixed height (content decides, screen scrolls)', () => {
    const b = blockOf('.auth-card {');
    expect(b).toMatch(/max-width:\s*100%/);
    expect(b).not.toMatch(/height:\s*100vh/);
    expect(b).not.toMatch(/min-height:\s*100vh/);
  });
});

describe('tokens.css — appearance settings are live (FD-009)', () => {
  const css = styles('tokens.css');

  it('defines a full dark theme token set', () => {
    expect(css).toContain("[data-theme='dark']");
    // core surfaces must actually be overridden, not just one accent
    const dark = css.slice(css.indexOf("[data-theme='dark']"));
    for (const token of ['--c-bg', '--c-surface', '--c-border', '--c-text', '--c-text-2']) {
      expect(dark, `dark theme must override ${token}`).toContain(`${token}:`);
    }
  });

  it('defines a compact density scale', () => {
    expect(css).toContain("[data-density='compact']");
  });

  it('defines reduced motion (kills animations/transitions)', () => {
    expect(css).toContain("[data-motion='reduce']");
    const i = css.indexOf("[data-motion='reduce']");
    const block = css.slice(i, i + 300);
    expect(block).toMatch(/animation:\s*none\s*!important/);
    expect(block).toMatch(/transition:\s*none\s*!important/);
  });

  it('print pages are NOT affected by the dark theme (paper stays white)', () => {
    // Print documents are self-contained HTML (inline styles in the print
    // templates) — the app token sheet must not introduce a print override
    // that could tint paper dark.
    expect(css).not.toContain('@media print');
  });
});
