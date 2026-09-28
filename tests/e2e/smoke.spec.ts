import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

/**
 * End-to-end smoke tests against the real Electron app (CI-only — requires the
 * Electron runtime binary, which is downloaded by `npm ci` on CI).
 *
 * Every run uses a throwaway user-data directory, so the app always boots in
 * its first-run state (activation screen → setup wizard → login → dashboard).
 *
 * When DENTIVA_ACTIVATION_SOURCE is not provided (forks/PRs without secrets),
 * only the activation gate is exercised — no plaintext code exists in the repo.
 */

const ACTIVATION_SOURCE = process.env.DENTIVA_ACTIVATION_SOURCE;
const ADMIN_USER = 'e2eadmin';
const ADMIN_PASS = 'DentivaE2E#2026';

let userDataDir: string | null = null;

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  userDataDir = mkdtempSync(join(tmpdir(), 'dentiva-e2e-'));
  const app = await electron.launch({
    // dist/main/index.js is produced by `npm run build` before the e2e job.
    args: ['dist/main/index.js', '--no-sandbox', '--disable-gpu'],
    env: {
      ...process.env,
      // Isolate first-run state on every platform.
      HOME: userDataDir,
      XDG_CONFIG_HOME: join(userDataDir, '.config'),
      APPDATA: userDataDir,
      LOCALAPPDATA: join(userDataDir, 'Local'),
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
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

test.describe('first-run journey', () => {
  let app: ElectronApplication | null = null;

  test.afterEach(async () => {
    await cleanup(app);
    app = null;
  });

  test('activate → setup wizard → login → dashboard', async () => {
    test.skip(
      !ACTIVATION_SOURCE,
      'DENTIVA_ACTIVATION_SOURCE not provided — activation gate still covered by the previous test.',
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
    await expect(page.locator('.sidebar-nav, nav').first()).toBeVisible();

    // 9. Navigate to Patients — the list loads against the real database.
    await page.locator('a', { hasText: 'Patients' }).first().click();
    await expect(page.getByRole('button', { name: /New patient/ })).toBeVisible({ timeout: 30_000 });
  });
});
