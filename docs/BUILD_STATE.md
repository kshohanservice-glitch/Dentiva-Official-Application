# Dentiva Pro — Build State

> Persistent execution state. On "Continue", resume from **Next exact action**.

## Current phase
**Phase 10 — v1.1.0 PUBLISHED. Remaining: post-release field validation (owner/field step).**

v1.1.0 shipped 2026-09-30: GitHub Release with `Dentiva-Pro-Setup-v1.1.0.exe` (93,382,465 B)
+ `SHA256SUMS.txt`, release run **36676031429** all gates green on windows-2022 (incl. 154/154
tests — FD-019, a Windows-only startup crash-loop, was root-caused from the instrumented
run 36675420978's check-summary and fixed in `f2573fd`).

## Version
- `package.json` **1.1.0** · `src/main/version.ts` `APP_VERSION='1.1.0'`, `BUILD_NUMBER='20260929.1'`

## Completed phases
- ✅ v1.0.0 full build & release (see §Release history below)
- ✅ Phase 1 — Forensic audit of v1.0.0 (`docs/FORENSIC_AUDIT_REPORT.md`, defects FD-001…FD-018)
- ✅ Phase 2 — Failure A: hardened startup (`earlyInit` logging/userData, fatal dialogs with log path,
  corrupt-DB quarantine + `lastRecovery` recovery dialog, single-instance dialog,
  `render-process-gone` + `uncaughtException`/`unhandledRejection` handlers)
- ✅ Phase 3 — Failure B: `.auth-screen` scroll fix (setup wizard reachable at 900×520; pinned by
  CSS contract test + E2E short-viewport test)
- ✅ Phase 4 — Failure C: canonical settings registry (`src/shared/settings-registry.ts`) — every
  group/key/type/default/validation in one place; registry-validated `setSettings`; wizard payload
  canonical; startup purge of removed v1.0.0 keys (`REMOVED_SETTINGS`)
- ✅ Phase 5 — Failure D: `backup.chooseFolder`/`chooseFile`/`printers.*` in `NO_AUTH` allow-list;
  restore "Choose backup file…" wired to `backup.chooseFile`; headless CI dialog guard
- ✅ Phase 6 — Failure E: icon regenerated with true alpha (transparent corners) + reproducible
  ICO builder (`scripts/build-ico.py`) + pixel-level alpha purity tests (16→256)
- ✅ Phase 7 — Dead-settings audit: live-wired `appointments.*` (Scheduling editor defaults +
  slot-step), `invoice.taxRate` (Billing apply button), `notifications.appointmentReminders`
  (daily digest); removed + purged `invoice.{nextNumber,showDentistInHeader,footerNote}`,
  `prescription.*`, `general.{language,visitCodeDigits}`, `appearance.sidebarCollapsed`
- ✅ Phase 8 — FD-006…FD-018 fixes: logo via `clinic.getLogo`, format config live everywhere
  (renderer + main + print), appearance theme/density/motion live (CSS token overrides),
  backup retention with pre-restore protection, restore hardening (clean failure on garbage
  archive, same-second backup name collision), Defect K (appointments CSV Time), Defect FD-013/14
- ✅ Phase 9a — Regression tests: **154 tests / 16 files, all passing** (was 108 / 9 at v1.0.0)
- ✅ Phase 9b — Release: commit → PR → CI (verify + E2E) ✅ → tag `v1.1.0` ✅ → Windows test
  gate (FD-019 diagnosed + fixed in `f2573fd`) ✅ → **Windows installer + GitHub Release PUBLISHED**
- 🟡 Phase 10 — Post-release: field validation on 3 physical devices (owner/field step,
  `docs/PHYSICAL_DEVICE_VALIDATION.md`)

## Quality gates (all executed locally, 2026-09-29)
| Gate | Command | Result |
|---|---|---|
| ESLint | `npx eslint .` | **0 errors**, 39 warnings (intentional demotions, see `eslint.config.mjs`) |
| Typecheck | `npm run typecheck` | **0 errors** (node + web tsconfigs; includes tests/**) |
| Static audit | `npm run audit:static` | **PASS** — no TODO/FIXME/console/demo markers (57 files) |
| Activation-code guard | `git grep -E '[0-9]{16}'` (simulated + CI) | **PASS** — no 16-digit codes in tracked files |
| Unit + integration | `npx vitest run` | **154/154 tests, 16 files, ~95 s** |
| Production build | `npm run build` | **PASS** |
| Icon alpha purity | `tests/unit/icon.test.ts` | **PASS** — 16/24/32/48/64/128/256 corners transparent |

## New regression tests (v1.1.0, on top of the v1.0.0 suite)
- `tests/unit/settings-registry.test.ts` — FD-001 contract: key ownership, wizard payload, legacy
  payload rejection, defaults ≡ registry, removed-key tracking
- `tests/unit/format-config.test.ts` — FD-007: moneyDecimals/dateFormat/use24HourTime drive formatters
- `tests/unit/icon.test.ts` — FD-003: pure-JS PNG/ICO pixel decode; corner alpha + opaque center,
  all 7 ICO entries
- `tests/unit/css-contract.test.ts` — Failure B (scrollability) + FD-009 (appearance token sets)
- `tests/unit/templates.test.ts` — FD-007: invoice money cells honor moneyDecimals 0/2/4
- `tests/integration/setup-flow.test.ts` — wizard's exact step-4 payload through real services,
  resumable state, strict rejection, RBAC, format-config wiring
- `tests/integration/backup.test.ts` — FD-008/FD-010 + restore safety: create/verify/preview,
  retention (pattern-limited, keepCount, fresh-file + pre-restore protection), restore round-trip,
  garbage-restore leaves live DB intact
- `tests/integration/startup-recovery.test.ts` — Failure A: unreadable + integrity-corrupt DB →
  quarantine (unique suffix, never overwrite) → fresh DB → `lastRecovery`
- `tests/integration/clinic-flow.test.ts` — +Defect K: appointments CSV Date/Time columns
- `tests/e2e/smoke.spec.ts` — +fixture-activated full journey (no customer code needed),
  +short-viewport (900×520) wizard reachability, +dark-theme application, +backup picker wiring
- `scripts/e2e-fixture.mjs` — CI activation fixture (machine-bound; gitignored output)

## Key v1.1.0 changes worth knowing
- **Settings** now have ONE source of truth: `src/shared/settings-registry.ts`. The backend
  validates every write against it; corrupt stored values fall back to defaults (never crash).
- **Format config** is per-JS-runtime: main applies `applyFormatConfigFromSettings()` at bootstrap /
  after every settings write / after restore; renderer applies `AppState.formatPrefs` on every
  state change — printing always matches the user's settings.
- **Appearance** = `documentElement.dataset.{theme,density,motion}` + CSS token overrides
  (dark theme = token swap; print sheets stay white by design).
- **Corrupt DB at startup** → quarantined in place (`.corrupt-<ts>` unique suffix), fresh DB,
  one-time dialog with the quarantined path + log path.
- **Backup**: retention only deletes exact-pattern files, never the just-created file, never
  pre-restore safety backups still referenced by `backup_records`; same-second names get a
  `-N` suffix instead of overwriting; garbage restore archives fail cleanly (no unhandled
  rejections, live DB untouched).
- **`DENTIVA_USER_DATA_DIR`** — support/debug override for the user-data directory (used by the
  CI E2E fixture); default stays the platform-standard `app.getPath('userData')`.
- **Icons**: `scripts/build-ico.py` rebuilds `build/icon.ico` from the committed PNGs
  (32-bit BMP entries 16–128, PNG entry 256) — reproducible, no white-matte re-encoding.

## Resolved this cycle (v1.1.0)
- **FD-019 (was release-blocking):** Windows-only Gate 3 failure — a failed SQLite open left
  its handle open; the corruption-quarantine `rename` then failed `EBUSY` on Windows (POSIX
  renames open files, so Linux CI stayed green) and the app would crash-loop at startup.
  Fixed in `f2573fd` (`openAndCheck` closes on failure; `quarantineFiles` bounded
  EBUSY/EPERM/EACCES retry). Regression: `startup-recovery.test.ts` (3 tests) failed on
  windows-2022 pre-fix (run 36675420978), passes post-fix (run 36676031429).

## Known issues
- ESLint warnings ×39 are intentional demotions (common query→form-init pattern), see `eslint.config.mjs`.
- Physical clean-machine Windows validation is a documented manual step
  (`docs/PHYSICAL_DEVICE_VALIDATION.md`) — not executable in this sandbox.

## Environment constraints (do not retry)
- Local `electron .`, `npm run e2e`, `pack:win` **fail in this sandbox** (no Electron binary, no
  display) — run via Actions.
- Local `npm ci` needs `ELECTRON_SKIP_BINARY_DOWNLOAD=1`; better-sqlite3 build needs
  `npm_config_nodedir=/usr/local`.
- Never print/use `DENTIVA_ACTIVATION_SOURCE` in repo files; CI guard fails the build on any
  16-digit code. `gh secret set` is 403 for the agent token (no `actions:write`) — the owner must
  set the secret manually; the CI activation fixture makes it optional.

## Workflows (in repo)
- `.github/workflows/ci.yml` — push/PR to main: 16-digit guard → lint → typecheck → static audit →
  tests → E2E (Xvfb): **fixture build (node-ABI) → electron-rebuild → playwright** (activation gate
  always; full journey + short viewport via fixture; real-code journey when secret present)
- `.github/workflows/release.yml` — tag `v*` / dispatch: lint → typecheck → tests (**teed to
  `test-run.log`; on failure: artifact upload + check-run summary patch with failure tail —
  `700fb8f`**) → `pack:win` → checksums → upload artifact (always) → GitHub Release (tag builds)
  with `Dentiva-Pro-Setup-v1.1.0.exe` + `SHA256SUMS.txt`

## Release history
- **v1.0.0** — GitHub Release published: `Dentiva-Pro-Setup-v1.0.0.exe` (93,403,905 bytes) +
  `SHA256SUMS.txt`; PR #1 green (run 36449821131), tag run 36450442666.
- **v1.1.0 — PUBLISHED (2026-09-30):**
  - PR #2 CI green on the product commits (9b50de7 run 36610276411; 700fb8f; 1703ae3 — all PASS).
  - Tag v1.1.0 @ `9b50de7` → run 36611121395 (windows-2022): **Gate 3 FAIL** (Windows-only;
    log blob host network-blocked from sandbox).
  - Diagnostics merged `700fb8f` (log tee + artifact + check-summary patch). Re-tag →
    run 36675420978 @ `1703ae3`: **Gate 3 FAIL** — check-summary identified the exact
    failure (`EBUSY rename` in `startup-recovery` on Windows).
  - FD-019 fixed in `f2573fd` (release SQLite handle on failed open + bounded rename retry).
    Local: tsc 0, eslint 0, 154/154, static-audit PASS, 16-digit guard PASS.
  - Re-tag v1.1.0 @ `f2573fd` → **run 36676031429 (windows-2022): ALL GATES PASS** (lint ·
    typecheck · 154/154 tests · build+NSIS · checksums · release).
  - **GitHub Release v1.1.0 published**: `Dentiva-Pro-Setup-v1.1.0.exe` (93,382,465 bytes,
    SHA-256 `8f59bb38ac60e0ef18e3ac7cd361e65a1d021e4544947dea1cc5b26681c28a0d`) +
    `SHA256SUMS.txt` (SHA-256 `318135a37c0106a5fbe4fed0338b379fdcc7685da35943e154c154ba36972ac9`).
  - Sandbox egress to GitHub's asset CDN is blocked, so the byte-level re-hash of the 93 MB
    exe is deferred to the field protocol (`certutil -hashfile`), not claimed here.

## Next exact action
1. **Merge PR #2** (`arena/01a0edf6-dentiva-official-application` → `main`) — all checks green;
   owner action (squash or merge). v1.1.0 tag is already cut from the branch tip.
2. **Field validation (post-release, owner/field step):** run the 3-device protocol in
   `docs/PHYSICAL_DEVICE_VALIDATION.md` — clean-machine install + launch (Device A), DPI /
   small-screen matrix 100–200% (Device B), 1920×1080 (Device C). Verify the installer
   SHA-256 against the value above before first run.
3. If field validation finds a regression: capture evidence → root-cause → fix → regression
   test → new patch tag (v1.1.1); never re-tag v1.1.0.
