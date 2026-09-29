import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

/**
 * End-to-end tests against the real Electron app (CI-only — requires the
 * Electron runtime binary, which is downloaded by `npm ci` on CI).
 *
 * Every run uses a throwaway user-data directory (DENTIVA_USER_DATA_DIR),
 * so the app always boots in a known state:
 *
 *  - without a fixture: first-run state (activation screen);
 *  - with the fixture (scripts/e2e-fixture.mjs): already activated, setup
 *    wizard pending — the full journey can run WITHOUT the customer's
 *    16-digit code ever touching the repo or CI logs.
 *
 * The customer's code is only used when DENTIVA_ACTIVATION_SOURCE is set
 * (owner CI with the secret); the fixture covers everything else.
 */

const ACTIVATION_SOURCE = process.env.DENTIVA_ACTIVATION_SOURCE;
const FIXTURE_DIR = join(process.cwd(), 'e2e-fixture', 'userdata');
const hasFixture = existsSync(FIXTURE_DIR);

const ADMIN_USER = 'e2eadmin';
const ADMIN_PASS = 'DentivaE2E#2026';

let userDataDir: string | null = null;

async function launch(opts: { fixture?: boolean; shortViewport?: boolean } = {}): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  userDataDir = mkdtempSync(join(tmpdir(), 'dentiva-e2e-'));
  if (opts.fixture) {
    if (!existsSync(FIXTURE_DIR)) throw new Error('E2E fixture missing — run: node scripts/e2e-fixture.mjs');
    cpSync(FIXTURE_DIR, userDataDir, { recursive: true });
  }
  const app = await electron.launch({
    // Launch with the repo root as the app path: that is how app.getAppPath()
    // resolves in the packaged build (app.asar), so renderer/asset paths match
    // production. Entry point comes from package.json "main": dist/main/index.js.
    args: [process.cwd(), '--no-sandbox', '--disable-gpu'],
    env: {
      ...process.env,
      // Isolate first-run state on every platform.
      HOME: userDataDir,
      XDG_CONFIG_HOME: join(userDataDir, '.config'),
      APPDATA: userDataDir,
      LOCALAPPDATA: join(userDataDir, 'Local'),
      // Deterministic user-data location (main reads this before userData).
      DENTIVA_USER_DATA_DIR: userDataDir,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  if (opts.shortViewport) {
    // ~1366×768 at 150% Windows scaling ≈ 911×511 CSS px — the reported
    // "setup wizard clipped on a small laptop" geometry (Failure B).
    await page.setViewportSize({ width: 900, height: 520 });
  }
  return { app, page };
}

async function cleanup(app: ElectronApplication | null): Promise<void> {
  if (app) {
    await app.close().catch(() => undefined);
  }
  if (userDataDir) {
    rmSync(userDataDir, { recursive: true, force: true });
    userDataDir = null;
  }
}

/** Locate the input inside a `.field` by its (unassociated) label text. */
function field(page: Page, labelText: RegExp) {
  return page
    .locator('.field')
    .filter({ has: page.locator('label', { hasText: labelText }) })
    .locator('input')
    .first();
}

/** Scroll the auth/wizard screen to the bottom (Failure B user story). */
async function scrollWizard(page: Page): Promise<void> {
  await page.locator('.auth-screen').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(150);
}

test.describe('activation gate', () => {
  let app: ElectronApplication | null = null;

  test.afterEach(async () => {
    await cleanup(app);
    app = null;
  });

  test('first run shows the offline activation screen', async () => {
    const launched = await launch();
    app = launched.app;
    const { page } = launched;

    await expect(page.locator('h1', { hasText: 'Dentiva Pro' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('One-time activation required.')).toBeVisible();
    await expect(page.locator('input[placeholder="16-digit code"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activate Dentiva Pro' })).toBeVisible();

    // A malformed code must be rejected client-side with a visible error.
    await page.locator('input[placeholder="16-digit code"]').fill('123');
    await page.getByRole('button', { name: 'Activate Dentiva Pro' }).click();
    await expect(page.getByText('Enter the 16-digit activation code')).toBeVisible();
  });
});

test.describe('setup wizard on a short viewport (Failure B regression)', () => {
  let app: ElectronApplication | null = null;

  test.afterEach(async () => {
    await cleanup(app);
    app = null;
  });

  test('every wizard button is reachable at 900×520 (no clipping, scrollable)', async () => {
      test.setTimeout(180_000);
      test.skip(!hasFixture, 'E2E fixture missing — run: node scripts/e2e-fixture.mjs');
      const launched = await launch({ fixture: true, shortViewport: true });
      app = launched.app;
      const { page } = launched;

      // Step 1 — Save & continue must be reachable by scrolling.
      await expect(page.getByText('Step 1 of 5')).toBeVisible({ timeout: 30_000 });
      const saveBtn = page.getByRole('button', { name: 'Save & continue' });
      await expect(saveBtn).toBeVisible();
      await scrollWizard(page);
      await expect(saveBtn).toBeInViewport();

      // Step 4 — Browse + Save & continue must be reachable (the step with
      // the most controls: security, general, currency, backups, printer).
      await field(page, /Clinic \/ practice name/).fill('Short Viewport Clinic');
      await saveBtn.click();
      await expect(page.getByText('Step 2 of 5')).toBeVisible({ timeout: 30_000 });
      await field(page, /^Full name/).fill('Dr. Short View');
      await page.getByRole('button', { name: 'Save & continue' }).click();
      await expect(page.getByText('Step 3 of 5')).toBeVisible({ timeout: 30_000 });
      await field(page, /^Username/).fill('svadmin');
      await field(page, /^Password/).fill(ADMIN_PASS);
      await field(page, /^Confirm password/).fill(ADMIN_PASS);
      await page.getByRole('button', { name: 'Create administrator' }).click();
      await expect(page.getByText('Step 4 of 5')).toBeVisible({ timeout: 30_000 });

      await scrollWizard(page);
      await expect(page.getByRole('button', { name: 'Browse' })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Save & continue' })).toBeInViewport();

      // Step 5 — Finish must be reachable.
      await page.getByRole('button', { name: 'Save & continue' }).click();
      await expect(page.getByText('Step 5 of 5')).toBeVisible({ timeout: 30_000 });
      await scrollWizard(page);
      await expect(page.getByRole('button', { name: 'Launch Dentiva Pro' })).toBeInViewport();
  });
});

test.describe('first-run journey (fixture-activated — no customer code needed)', () => {
  let app: ElectronApplication | null = null;

  test.afterEach(async () => {
    await cleanup(app);
    app = null;
  });

  test('wizard (moneyDecimals=0) → login → dashboard → dark theme → backup page', async () => {
      test.setTimeout(240_000);
      test.skip(!hasFixture, 'E2E fixture missing — run: node scripts/e2e-fixture.mjs');
      const launched = await launch({ fixture: true });
      app = launched.app;
      const { page } = launched;

      // 1. Fixture-activated boot goes straight to the setup wizard.
      await expect(page.getByText('Welcome to Dentiva Pro')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Step 1 of 5')).toBeVisible();
      await field(page, /Clinic \/ practice name/).fill('E2E Journey Clinic');
      await page.getByRole('button', { name: 'Save & continue' }).click();

      // 2. Dentists.
      await expect(page.getByText('Step 2 of 5')).toBeVisible({ timeout: 30_000 });
      await field(page, /^Full name/).fill('Dr. E2E Journey');
      await page.getByRole('button', { name: 'Save & continue' }).click();

      // 3. Administrator account.
      await expect(page.getByText('Step 3 of 5')).toBeVisible({ timeout: 30_000 });
      await field(page, /^Username/).fill(ADMIN_USER);
      await field(page, /^Password/).fill(ADMIN_PASS);
      await field(page, /^Confirm password/).fill(ADMIN_PASS);
      await page.getByRole('button', { name: 'Create administrator' }).click();

      // 4. Preferences — choose NON-DEFAULT currency decimals. FD-001
      // regression: the v1.0.0 wizard submitted this under the wrong group
      // and "Save & Continue" dead-ended with "Unknown setting". A regression
      // here would leave the wizard on step 4 with an error banner.
      await expect(page.getByText('Step 4 of 5')).toBeVisible({ timeout: 30_000 });
      await page
        .locator('.field')
        .filter({ has: page.locator('label', { hasText: 'Currency display' }) })
        .locator('select')
        .selectOption({ label: '৳ 1,250 (no decimals)' });
      await page.getByRole('button', { name: 'Save & continue' }).click();

      // 5. Finish.
      await expect(page.getByText('Step 5 of 5')).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Launch Dentiva Pro' }).click();

      // 6. Login with the account created in the wizard.
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 });
      await field(page, /^Username/).fill(ADMIN_USER);
      await field(page, /^Password/).fill(ADMIN_PASS);
      await page.getByRole('button', { name: 'Sign in' }).click();

      // 7. Dashboard renders with real, query-backed data cards.
      await expect(page.getByText("Today's patients")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Today's appointments")).toBeVisible();

      // 8. Settings → Preferences → Appearance: switch to dark theme.
      // FD-011 regression: the theme control must actually change the app.
      await page.locator('a', { hasText: 'Settings' }).first().click();
      await page.getByRole('tab', { name: 'Preferences' }).click();
      const themeSelect = page
        .locator('.field')
        .filter({ has: page.locator('label', { hasText: 'Theme' }) })
        .locator('select');
      await themeSelect.selectOption('dark');
      await page
        .locator('.card')
        .filter({ has: page.getByText('Appearance', { exact: true }) })
        .getByRole('button', { name: 'Save' })
        .click();
      await expect
        .poll(
          () => page.evaluate(() => document.documentElement.dataset.theme),
          { timeout: 15_000 },
        )
        .toBe('dark');

      // 9. The wizard's non-default "no decimals" choice was accepted by the
      // backend (reaching step 5 already proves it — a rejection would have
      // shown "Unknown setting" and kept the wizard on step 4). Belt and
      // braces: no settings error is lingering anywhere on the page.
      await expect(page.getByText('Unknown setting')).toHaveCount(0);

      // 10. Backup page (FD-008): the restore file picker is a real control,
      // not a dead button. Clicking it must complete the UI→IPC→main round
      // trip cleanly. On a headless CI runner the native dialog is guarded
      // (returns cancel), so the correct behavior is: no crash, no error
      // toast, and no fake path injected into the field.
      await page.locator('a', { hasText: 'Backup & Restore' }).first().click();
      await expect(page.getByText('Restore from a file')).toBeVisible({ timeout: 30_000 });
      const chooseBtn = page.getByRole('button', { name: 'Choose backup file…' });
      await expect(chooseBtn).toBeVisible();
      await expect(chooseBtn).toBeEnabled();
      await chooseBtn.click();
      // The round trip must settle (a dead control or a hung dialog would
      // leave the app in a broken state). Give it a moment to complete.
      await page.waitForTimeout(500);
      // No error surfaced from the picker call.
      await expect(page.getByText('File picker failed')).toHaveCount(0);
      // No fake path was written into the path field.
      await expect(
        page.locator('.field').filter({ has: page.getByText('.dvbackup path') }).locator('input'),
      ).toHaveValue('');
      // App is still alive and usable.
      await expect(page.getByText('Restore from a file')).toBeVisible();
  });
});

test.describe('first-run journey (real activation code)', () => {
  let app: ElectronApplication | null = null;

  test.afterEach(async () => {
    await cleanup(app);
    app = null;
  });

  test('activate → setup wizard → login → dashboard', async () => {
    test.skip(
      !ACTIVATION_SOURCE,
      'DENTIVA_ACTIVATION_SOURCE not provided — the fixture-activated journey covers the same flow.',
    );
    const launched = await launch();
    app = launched.app;
    const { page } = launched;

    // 1. Activate (code comes from the environment, never from the repo).
    await expect(page.locator('input[placeholder="16-digit code"]')).toBeVisible({ timeout: 30_000 });
    await page.locator('input[placeholder="16-digit code"]').fill(ACTIVATION_SOURCE!);
    await page.getByRole('button', { name: 'Activate Dentiva Pro' }).click();

    // 2. Setup wizard — clinic information.
    await expect(page.getByText('Welcome to Dentiva Pro')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Step 1 of 5')).toBeVisible();
    await field(page, /Clinic \/ practice name/).fill('E2E Smoke Clinic');
    await page.getByRole('button', { name: 'Save & continue' }).click();

    // 3. Dentists.
    await expect(page.getByText('Step 2 of 5')).toBeVisible({ timeout: 30_000 });
    await field(page, /^Full name/).fill('Dr. E2E Tester');
    await page.getByRole('button', { name: 'Save & continue' }).click();

    // 4. Administrator account (policy: 8+ chars, letter + number, not username).
    await expect(page.getByText('Step 3 of 5')).toBeVisible({ timeout: 30_000 });
    await field(page, /^Username/).fill(ADMIN_USER);
    await field(page, /^Password/).fill(ADMIN_PASS);
    await field(page, /^Confirm password/).fill(ADMIN_PASS);
    await page.getByRole('button', { name: 'Create administrator' }).click();

    // 5. Preferences (defaults are fine for a smoke run).
    await expect(page.getByText('Step 4 of 5')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Save & continue' }).click();

    // 6. Finish.
    await expect(page.getByText('Step 5 of 5')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Launch Dentiva Pro' }).click();

    // 7. Login with the account created in the wizard.
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 });
    await field(page, /^Username/).fill(ADMIN_USER);
    await field(page, /^Password/).fill(ADMIN_PASS);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // 8. Dashboard renders with real, query-backed data cards.
    await expect(page.getByText("Today's patients")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Today's appointments")).toBeVisible();

    // 9. Navigate to Patients — the list loads against the real database.
    await page.locator('a', { hasText: 'Patients' }).first().click();
    await expect(page.getByRole('button', { name: /New patient/ })).toBeVisible({ timeout: 30_000 });
  });
});
