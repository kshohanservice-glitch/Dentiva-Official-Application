# Dentiva Pro — Testing Gap Analysis (v1.1.0 cycle)

Date: 2026-09-29 · Companion to `docs/FORENSIC_AUDIT_REPORT.md`.

## Why v1.0.0's green CI still shipped a broken product

| # | Gap | Consequence | v1.1.0 closure |
|---|-----|-------------|----------------|
| G1 | E2E full journey (activation → setup → login) ran **only** when the `DENTIVA_ACTIVATION_SOURCE` repo secret was configured; it was not, so the journey was silently `test.skip`ped on every CI run. | The setup wizard — the exact code path of field failures C/D — was never executed by any test. | E2E journey now runs on **every PR** via a CI activation fixture (pre-activated throwaway userData built by `scripts/e2e-fixture.mjs` with the node-ABI better-sqlite3, before the Electron rebuild). Real-code UI activation journey additionally runs when the secret is set. |
| G2 | No regression test pinned the settings contract between UI payloads and the backend registry. | `general:moneyDecimals` (FD-001) and `clinic.logoData` (FD-006) shipped undetected. | `tests/unit/settings-registry.test.ts` (registry matrix incl. the exact wizard payload) + `tests/integration/setup-flow.test.ts` (wizard payload end-to-end through the service layer) + E2E step-4 assertion. |
| G3 | No test exercised the setup IPC surface for unauthenticated calls. | The 401 on `backup.chooseFolder` during setup (FD-002) was invisible. | Unit test pins the `NO_AUTH` set for the setup wizard surface; E2E completes the wizard with a chosen backup folder flow (Browse presence + completion). |
| G4 | Icon integrity test only checked existence + size entries. | White-matte icon (FD-003) shipped. | Purity test now decodes PNG/ICO pixels (pure-JS zlib inflate + unfilter) and asserts corner alpha = 0 / center alpha = 255 at 16px and 256px. |
| G5 | No test for short-viewport usability of auth/wizard screens. | Clipped setup (FD-004) shipped. | E2E resizes the window to 1100×430 and asserts the wizard's primary action is visible/reachable (scroll). |
| G6 | No startup-failure observability test (corrupt DB, missing files). | Silent no-launch (FD-005) was undiagnosable. | `tests/integration/startup-recovery.test.ts`: corrupt DB → quarantine + fresh start + recovery flag; boot of the real main process on every PR (E2E). |
| G7 | No retention/keepCount enforcement existed (nothing to test). | Settable-but-dead setting (FD-010). | `tests/integration/backup.test.ts`: retention pruning + pre-restore safety-backup protection + naming-pattern guard. |
| G8 | Format settings had no runtime consumers, so no tests could exist. | Dead settings (FD-007/FD-011). | `tests/unit/format-config.test.ts`, template decimal tests, `tests/unit/appearance.test.ts`. |
| G9 | Printing/PDF path never executed in E2E (no printer on CI; PDF not asserted in the journey). | Unknown until now whether the hidden-window print chain works headlessly. | E2E (Xvfb) adds a **PDF export** assertion: create a minimal patient + prescription, call `print.run` mode=pdf, assert a non-empty PDF is returned (header `%PDF`). Printer-queue behavior remains a Windows field check (recorded in PHYSICAL_DEVICE_VALIDATION). |
| G10 | No test covered `clinic.update` with a logo upload. | FD-006 shipped. | `tests/integration/setup-flow.test.ts` logo round-trip (PNG data-URL → stored file + `logoPath` + `clinic.getLogo` data-URL). |

## Test pyramid after v1.1.0

- **Unit (vitest):** formatting + format config, settings registry validation matrix, permissions
  role matrices, password policy/Argon2id, activation (format + verifier, real check when env
  provided), print templates (escaping, Bengali, paper CSS, totals incl. decimal variants),
  build purity (no demo data, no plaintext codes, **icon alpha**, installer file whitelist),
  appearance tokens.
- **Integration (vitest, real SQLite temp DBs):** full clinic lifecycle, auth & RBAC matrix,
  setup wizard flow (all 5 steps, resumability, wizard payload contract, logo), backup
  (create/verify/restore + retention + corruption handling), startup recovery (corrupt DB),
  100k-patient stress (seed/page/search/deep-page).
- **E2E (Playwright + real Electron under Xvfb, every PR):**
  1. activation gate (malformed code rejected) — always;
  2. **full first-run journey via activation fixture** — always: activate(skipped) → 5-step
     wizard (step 4 explicit save assertion + short-viewport scroll check) → login → dashboard
     → patients → **prescription PDF export**;
  3. real-code UI activation journey — when `DENTIVA_ACTIVATION_SOURCE` secret present.
- **Windows field validation (owner-run, 30-minute protocol):** install/launch/setup/print/
  backup/restore on Devices A/B/C — `docs/PHYSICAL_DEVICE_VALIDATION.md`.

## What this sandbox cannot test (disclosed)

- NSIS installer behavior on real Windows (mitigated: identical pipeline already validated on
  windows-2022 for v1.0.0; v1.1.0 re-runs the same pipeline with gates before packing).
- Physical DPI (125/150/175/200%) on real displays — E2E covers layout geometry at reduced
  viewport size, which is the same constraint the scaling produces.
- Real printer hardware (PDF path is covered headlessly; printer queue is a field check).
