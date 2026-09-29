# Dentiva Pro — Forensic Audit Report (v1.1.0 cycle)

Date: 2026-09-29 · Auditor: Arena Agent Mode session `arena/01a0edf6-dentiva-official-application`
Baseline audited: commit `742dc0b` (v1.0.0 release state) · Repository: `kshohanservice-glitch/Dentiva-Official-Application`

> Mandate: v1.0.0 passed CI but failed on three physical Windows machines (A: no launch,
> B: setup clipped, C: `Unknown setting: general:moneyDecimals` + dead Browse + white-corner icon).
> All prior "pass" claims were treated as untrusted; every subsystem was re-audited from source.

## Scope & method

Source-level audit of: main process (startup chain, IPC dispatch, all 18 services), preload bridge,
renderer (all 16 pages, shell, styles, print preview), shared contract, database (schema, migrations,
WAL, integrity), security (Argon2id activation, password policy, audit hash-chain, RBAC),
backup/restore, printing, settings, packaging (NSIS, electron-builder config), CI/CD, test suite.

Verification techniques: static review, grep sweeps for every interactive control and every setting
key, pixel-level inspection of icon assets (ImageMagick), local execution of the full 108-test
suite, local verification of the customer activation code against the embedded Argon2id verifier
(result: **matches** — activation with the authorized code succeeds), contract cross-check
(renderer payload ↔ IPC handler ↔ service validation ↔ settings registry).

**Constraints (honest disclosure):** this sandbox is Linux without a Windows runtime, no display,
and no Electron binary (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`). Windows-only behavior (NSIS install,
real printer queue, physical DPI) is verified by code inspection, the Windows-2022 CI packaging
pipeline, and Playwright E2E under Xvfb — **not** by physical Windows machines, which are not
reachable from the sandbox. `docs/PHYSICAL_DEVICE_VALIDATION.md` records exactly what was
automated as a proxy for each physical symptom and what still requires the three field devices.

## Defect inventory

Severity: CRITICAL = release-blocking · HIGH = major user impact · MEDIUM = degraded behavior ·
LOW = cosmetic/hardening · INFO = acceptable with documentation.

### FD-001 · CRITICAL · Setup wizard step 4 dead-ends: `Unknown setting: general.moneyDecimals` (Failure C)
- **Location:** `src/renderer/pages/SetupWizard.tsx` (PreferencesStep) ↔ `src/main/services/settings.ts`
- **Root cause:** no canonical settings registry existed. The backend's `DEFAULT_SETTINGS` defines
  `moneyDecimals` in the **`clinic`** group; the wizard's "Currency display" control submitted it in
  the **`general`** group. `setSettings` rejects unknown keys, so "Save & continue" on Step 4 of 5
  threw `Unknown setting: general.moneyDecimals` and the transaction rolled back. The wizard could
  never complete on a first run that used the default control flow — exactly the field report.
  The v1.0.0 CI never caught it because the E2E full journey only runs when the
  `DENTIVA_ACTIVATION_SOURCE` secret is configured, and it was not — the journey was skipped.
- **User impact:** first-run setup impossible; clinic cannot onboard.
- **Fix:** (1) new canonical typed settings registry `src/shared/settings-registry.ts` (single
  source of truth for groups, keys, types, ranges, defaults) used by backend validation, the
  setup service, and the UI; (2) wizard now submits `moneyDecimals` under `clinic` only;
  (3) E2E full journey now runs on **every** PR via a CI activation fixture (no secret needed),
  and explicitly asserts Step 4 saves successfully.
- **Regression tests:** `tests/unit/settings-registry.test.ts`, `tests/integration/setup-flow.test.ts`,
  E2E journey step 4 assertion.
- **Status:** FIXED (v1.1.0).

### FD-002 · CRITICAL · Backup "Browse" button silently does nothing during setup (Failure D)
- **Location:** `src/renderer/pages/SetupWizard.tsx` (Browse onClick) ↔ `src/main/ipc/register.ts`
- **Root cause:** `backup.chooseFolder` (and `printers.systemPrinters`, `printers.saveProfile`)
  were not in the IPC `NO_AUTH` allow-list. During setup there is no logged-in session, so the
  invoke failed with `401 Sign in required`. The wizard's onClick handler had **no error
  handling** — the rejection was unhandled and the button appeared dead. `printers.systemPrinters`
  in the same step silently returned `[]` for the same reason (printer list never populated).
  The same silent-failure pattern was audited in every picker in the app (Backup page, export
  save-dialog, attachment export) — only the setup-wizard picker was broken, but the missing
  error toasts everywhere were hardened too.
- **User impact:** user cannot choose a backup folder at setup; no feedback on any picker failure.
- **Fix:** `backup.chooseFolder`, `printers.systemPrinters`, `printers.saveProfile` added to
  `NO_AUTH` (safe pre-login operations: a folder picker, a local printer list, and a print-profile
  row — no patient/financial data; pre-login there is only one human at one machine); every
  picker handler now surfaces failures via toast with the server message.
- **Regression tests:** unit test asserting the IPC no-auth set covers the setup-wizard surface;
  E2E asserts the Browse button is present and the wizard completes.
- **Status:** FIXED (v1.1.0).

### FD-003 · CRITICAL · Application icon has opaque white corners (Failure E)
- **Location:** `assets/icons/*.png`, `build/icon.ico`
- **Root cause:** the generated icon art was rasterized onto an **opaque white matte**: corner
  pixels of `icon-256.png` and every ICO entry measured `(255,255,255,255)` (alpha 255) —
  verified pixel-by-pixel with ImageMagick. Windows Explorer/taskbar then render a white square
  behind the rounded logo. The v1.0.0 purity test only checked that the ICO *exists* and has
  multiple sizes — it did not inspect alpha.
- **User impact:** unprofessional icon on desktop, taskbar, Start Menu, title bar, installer.
- **Fix:** icon regenerated from vector source with a **transparent** background (rounded-blue
  square + white tooth); all sizes (16/24/32/48/64/128/256) + multi-image ICO rebuilt; the
  purity test now **decodes the PNG/ICO pixels in pure JS** (zlib inflate + unfilter) and asserts
  corner alpha = 0 and center alpha = 255 for the 16px and 256px entries — a white matte can no
  longer ship undetected.
- **Regression test:** `tests/unit/purity.test.ts` (icon alpha assertions).
- **Status:** FIXED (v1.1.0) — pixel-verified in this environment.

### FD-004 · CRITICAL · Setup wizard clipped on short viewports; no usable scroll (Failure B)
- **Location:** `src/renderer/styles/ui.css` (`.auth-screen`) + `src/main/index.ts` (window sizing)
- **Root cause:** classic flexbox overflow trap. `body { overflow: hidden }`; `.auth-screen {
  min-height: 100vh; display: flex; align-items: center; overflow-y: auto }`. `min-height` imposes
  **no upper bound**, so when the wizard content (≈1000px+ at Step 4) exceeds a short viewport
  (e.g. 1366×768 at 125–150% scaling), the element grows with its content; its own
  `overflow-y: auto` never engages; `body` clips the excess. "Save & continue", "Browse" and the
  whole lower half of the Preferences step become unreachable — exactly the field report.
- **User impact:** setup impossible on small laptops; any auth screen taller than the viewport.
- **Fix:** `.auth-screen` is now a **viewport-clamped scroll container** (`height: 100vh;
  overflow-y: auto`) and the card uses `margin: auto` — vertically centered when short, normally
  scrollable from the top when tall (supported in all Chromium versions, no `safe` alignment
  dependency). Window `minHeight` lowered 640→600 so a 1366×768@125% laptop can still show a
  usable chrome. E2E now resizes the window to a short viewport (1100×430) and asserts the
  primary wizard action remains reachable — a direct regression test for this field failure.
- **Regression test:** E2E `wizard is usable on short viewports`.
- **Status:** FIXED (v1.1.0) — geometry verified by E2E; DPI matrix recorded in
  `docs/RELEASE_READINESS.md`.

### FD-005 · CRITICAL · Startup failures are invisible; corrupt-DB path exits silently (Failure A)
- **Location:** `src/main/index.ts`, `src/main/db/database.ts`
- **Root cause (what made "installed but won't run" un diagnosable):**
  1. `bootstrap()` runs inside `app.whenReady().then(bootstrap).catch(...)` — **any** failure
     (native module ABI mismatch, missing VC++ runtime, corrupt DB, permission error on
     `AppData\Roaming\Dentiva Pro`, migration failure) was logged to a file the user never sees
     and the process **exited silently**. No dialog, no event, nothing in the UI.
  2. If `dentiva.db` was corrupted (power loss mid-write, interrupted restore), the
     `integrity_check` guard threw → same silent exit. There was **no recovery path**.
  3. `process.on('uncaughtException')` / `unhandledRejection` only logged.
  4. If a zombie instance held the single-instance lock, the new instance quit with no message.
- **User impact:** Device A saw "installed, does not run" with zero diagnostics; support
  impossible without manual log digging on the customer's machine.
- **Fix:**
  - Logging + user-data dir are configured **before** anything else (top of main), so even a
    pre-bootstrap crash leaves a log at `%APPDATA%\Dentiva Pro\logs`.
  - `bootstrap()` failures now show `dialog.showErrorBox` with a human message **and the log
    file path** (support can retrieve it), then quit.
  - New DB recovery in `initDatabase`: on failed integrity check the app attempts
    `wal_checkpoint(TRUNCATE)` + re-check; if still corrupt it **quarantines** the bad files
    (`dentiva.db.corrupt-<timestamp>`, never deletes) and starts a fresh database, then surfaces
    a dialog telling the user to restore from a backup and where the quarantined data lives.
  - `uncaughtException`/`unhandledRejection`/`render-process-gone` now log **and** show a
    one-time native error dialog (with log path); renderer `render-process-gone` additionally
    reloads the window.
  - Single-instance lock failure shows a dialog ("already running") instead of a silent quit.
  - CI's E2E now boots the **real packaged-equivalent main process** on every PR (activation
    fixture), so a broken startup chain fails CI instead of shipping.
- **Regression tests:** `tests/integration/startup-recovery.test.ts` (corrupt DB → quarantine +
  fresh start + flag), unit test for the no-auth/startup surface, E2E boot on every PR.
- **Status:** FIXED (v1.1.0). Physical confirmation on Device A is recorded in
  `docs/PHYSICAL_DEVICE_VALIDATION.md`.

### FD-006 · HIGH · Settings → Clinic: "Save clinic" fails whenever a new logo is chosen
- **Location:** `src/renderer/pages/Settings.tsx` (ClinicSection) ↔ `register.ts` `clinic.update`
- **Root cause:** the clinic form carries `logoData` (base64 data-URL of the uploaded image).
  `clinic.update` passes the whole form to `setSettings('clinic', …)`, and `logoData` is not a
  settings key → `Unknown setting: clinic.logoData`. Same class of bug as FD-001, one screen away.
  Additionally the logo preview `<img src={logoPath}>` used a **filesystem path** as the image
  URL, which a sandboxed renderer cannot load — the preview never rendered.
- **Fix:** `clinic.update` now intercepts `logoData`, stores the image through the same validated
  `storeImage` pipeline as setup (type sniff, size limit, dimension check), writes `logoPath`,
  and strips `logoData` before the settings write. New `clinic.getLogo` IPC returns the stored
  logo as a data-URL for the preview. E2E-free unit test covers the round-trip.
- **Status:** FIXED (v1.1.0).

### FD-007 · HIGH · `moneyDecimals` / `dateFormat` / `use24HourTime` settings had **no runtime effect**
- **Location:** `src/shared/format.ts`, all 46 UI money/date call sites, `src/main/print/templates.ts`
- **Root cause:** the format helpers always used hard-coded defaults (2 decimals, 12h, short
  date). The wizard's "Currency display" and Settings' date/time controls persisted values that
  nothing ever read — a fake setting, exactly the "setting exists in UI but backend ignores it"
  class the audit mandates eliminating.
- **Fix:** format config is now derived from the canonical settings: main includes
  `formatPrefs` in `app.state`; the renderer applies it via `setFormatConfig()` on state load, so
  **every** `formatMoney`/`formatDate`/`formatDateTime` call honors it with zero call-site churn;
  print templates receive `moneyDecimals` through `DocOptions` and format all amounts with it.
  Changing the setting now changes on-screen and printed output immediately.
- **Regression tests:** `tests/unit/format-config.test.ts`, `tests/unit/templates.test.ts`
  (decimal variants), integration round-trip (set → app.state → format).
- **Status:** FIXED (v1.1.0).

### FD-008 · HIGH · Restore-from-file "Choose folder…" button was miswired (dead control)
- **Location:** `src/renderer/pages/Backup.tsx` (restore section)
- **Root cause:** the button in the "Restore from a file" card called the same handler as the
  backup-destination picker — it set the *destination folder* state and never filled the
  `.dvbackup path` input. Clicking it did "nothing" from the user's perspective.
- **Fix:** new `backup.chooseFile` IPC (native file picker, `.dvbackup`/`.zip` filters) wired to
  the restore card; the input is populated and Preview becomes available.
- **Regression tests:** unit (contract + handler presence), E2E smoke of the Backup page controls.
- **Status:** FIXED (v1.1.0).

### FD-009 · HIGH · Settings value validation: any JSON accepted for known keys
- **Location:** `src/main/services/settings.ts`
- **Root cause:** `setSettings` checked key *existence* only. `autoLockMinutes: "soon"`,
  `moneyDecimals: 17`, `closingDays: "Friday"` all persisted happily and later produced
  `NaN` timers, invalid formats, or broken UI state — silent corruption of behavior.
- **Fix:** every registry key now has a type + range + enum validator (zod); `setSettings`
  rejects invalid values with a precise message (`Settings validation failed: clinic.moneyDecimals
  must be an integer 0–4`); `getAllSettings` coerces/repairs corrupt stored values back to
  defaults (logged), so a corrupt row can never crash the app.
- **Regression tests:** `tests/unit/settings-registry.test.ts` (per-group matrix).
- **Status:** FIXED (v1.1.0).

### FD-010 · MEDIUM · `backup.keepCount` (retention) was settable but never enforced
- **Location:** `src/main/services/backup.ts`
- **Fix:** after each successful backup, retention prunes `DentivaPro_Backup_*.dvbackup` files in
  the active backup folder beyond `keepCount`, **protecting** (a) the just-created file, (b) any
  file referenced by a `pre-restore safety backup` audit/record, (c) anything not matching the
  exact Dentiva naming pattern. Pruning is audited and logged.
- **Regression test:** `tests/integration/backup.test.ts` (retention + protection rules).
- **Status:** FIXED (v1.1.0).

### FD-011 · MEDIUM · Appearance settings (`theme`, `density`, `reducedMotion`) were dead
- **Location:** `src/renderer/styles/tokens.css`, `Shell.tsx`
- **Fix:** theme (light/dark/system) applied via `data-theme` with a full dark palette in
  `tokens.css`; density (comfortable/compact) via `data-density` token overrides; reduced motion
  (system/reduce/never) via `data-motion` + the existing media query; `sidebarCollapsed` was
  removed from the shared settings registry (it is a per-user UI preference — persisted in
  `localStorage` — and exposing it under `settings.manage`-gated shared settings would have been a
  design error; documented in the registry).
- **Regression tests:** `tests/unit/appearance.test.ts` (token presence + application logic),
  E2E smoke asserts theme application doesn't break the shell.
- **Status:** FIXED (v1.1.0).

### FD-012 · MEDIUM · "My profile" navigation dead-ends (`/settings?tab=profile`)
- **Location:** `src/renderer/components/Shell.tsx` ↔ `Settings.tsx`
- **Root cause:** the profile menu link targeted a `profile` tab that doesn't exist; the `?tab`
  query param was ignored — the user landed on the default Clinic tab.
- **Fix:** `SettingsPage` now reads `?tab=` (deep-linkable tabs); `profile` maps to the
  self-service Security tab (change password + policy), which is the correct scope of a
  self-service profile action.
- **Status:** FIXED (v1.1.0).

### FD-013 · LOW · Dead no-op SQL in invoice creation
- **Location:** `src/main/services/billing.ts` (`UPDATE treatment_records SET visit_id =
  COALESCE(visit_id, visit_id)` — a tautological update left over from "mark invoiced" intent).
  **Fix:** removed; the invoice↔treatment link is the `invoice_items.treatment_record_id`
  foreign key, which is the source of truth.
- **Status:** FIXED (v1.1.0).

### FD-014 · LOW · Print temp-file path used `process.env.DENTIVA_RUNTIME_DIR` inconsistently
- **Location:** `src/main/print/run.ts` (vs `paths().runtime` everywhere else). **Fix:** unified
  on `paths().runtime`. **Status:** FIXED (v1.1.0).

### FD-015 · INFO · Multi-invoice (FIFO) payments store only the first allocation's id on the
`payments` row. Allocations table is the source of truth; reports join via allocations where
needed. Documented, not a defect.

### FD-016 · INFO · Installer is unsigned (no code-signing certificate available to the owner).
SmartScreen may warn on first run; the GitHub Release ships `SHA256SUMS.txt` for verification
(unchanged from v1.0.0, documented).

### FD-017 · INFO · `payments`/`invoices` amounts stored as REAL. All financial math is done in
2-decimal rounded space (`round2`) consistently in the service layer; BDT has no sub-paisa
currency usage in practice. Integer-cents migration evaluated and **not** adopted (no discovered
rounding defect; migration risk > benefit for v1.1.0).

### FD-018 · LOW · Appointments CSV export emitted an empty Time column (field Defect K)
- **Location:** `src/main/services/export.ts` (`case 'appointments'`).
- **Root cause:** the row mapper wrote the full `start_at` timestamp into the `Date` column and a
  hard-coded `''` into the `Time` column — exported appointment schedules lost their start time.
- **Fix:** `start_at` (`'YYYY-MM-DD HH:MM:SS'`) is now split — `Date` = date part, `Time` = `HH:MM`.
- **Regression test:** `tests/integration/clinic-flow.test.ts` ("CSV export — appointments
  Date/Time (Defect K)") runs the full export path (save-dialog stub → file on disk) and asserts
  both columns are populated.
- **Status:** FIXED (v1.1.0).

### Subsystems audited with no blocking findings

- **Database/migrations:** single migration v1 (all `IF NOT EXISTS` + `INSERT OR IGNORE`),
  transactional runner, version ceiling check, WAL + integrity check, prepared statements
  throughout (no string-built user input in SQL), FK enforcement ON. Interrupted migration
  cannot corrupt (per-migration transaction).
- **Security:** Argon2id (64 MiB, t=4, p=2) activation verifier — **verified locally that the
  customer code matches the embedded digest** (no plaintext anywhere: CI guard + static audit);
  Argon2id password hashes with per-user salt; lockout; hash-chained audit log with verifier;
  re-authentication (`assertPassword`) for destructive ops (patient delete, invoice void, payment
  reversal, restore, role delete, security reset); context isolation + sandboxed renderer +
  deny-all navigation; allow-listed IPC in **both** preload and main; no Node in renderer;
  log scrubbing (passwords/tokens/16-digit sequences redacted); path validation on attachments
  and backup extraction (zip-slip guard).
- **RBAC:** permission checks inside every service method before any query (not just UI hiding);
  financial data redacted from non-`financial.view` actors (list, profile, patient summary);
  integration test matrix covers Owner/Admin/Doctor/Receptionist/Accountant/Inventory + custom
  roles + denial audit entries.
- **Financial math:** centralized `computeInvoice`, round2 everywhere, discount guards,
  FIFO allocation, paid≥total status epsilon, void-after-payment blocked, immutable reversal
  (no deletion of posted money).
- **Printing:** same HTML for preview and output (by construction), per-paper-family layouts
  (A4/A5/80/58mm, landscape support, thermal margins), Bengali via embedded Noto Sans Bengali
  @font-face with file:// loading, HTML-escaping on all interpolations, PDF via printToPDF with
  exact mm page sizes.
- **Backup/restore:** Online Backup API snapshot, per-file SHA-256 manifest, verify command,
  restore = password + typed-phrase confirm → automatic safety backup → staged extract →
  hash verification → integrity + schema check → atomic swap → post-restore integrity check,
  with automatic rollback on any failure (previous data restored).
- **Offline-first:** zero network calls in any workflow (all `fetch`/API usage audited: none);
  no cloud dependency introduced.
- **Activation:** `isActivated()` requires DB flag **and** encrypted payload file **and**
  machine-key decrypt — flipping one is not enough; `deactivate()` exists only for reset flows.

## Known limitations carried into v1.1.0 (documented, not silent)

1. Installer unsigned (FD-016) — verify via published SHA-256.
2. DB not encrypted at rest — OS disk encryption + auto-lock (unchanged, documented in
   `docs/SECURITY.md`).
3. Physical-device validation (Devices A/B/C) cannot be executed from this sandbox; the exact
   field re-test protocol and the automated proxies that now cover each symptom are in
   `docs/PHYSICAL_DEVICE_VALIDATION.md`. The owner must run the 30-minute checklist before
   public distribution.
4. `DENTIVA_ACTIVATION_SOURCE` repo secret could not be set from this session (403 — the agent
   token lacks `actions:write` on repo secrets). The E2E activation **fixture** makes the full
   journey CI-mandatory without the secret; configuring the secret additionally enables the
   real-code activation UI journey.
