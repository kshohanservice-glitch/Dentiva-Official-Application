# Dentiva Pro — Build State

> Persistent execution state. On "Continue", resume from **Next exact action**.

## Current phase
**Phase 9 — v1.1.0 release (all fixes + regression tests complete; CI verification in progress)**

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
- 🟡 Phase 9b — Release: commit → PR → CI (verify + E2E) → tag `v1.1.0` → Windows installer +
  GitHub Release

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
- `.github/workflows/release.yml` — tag `v*` / dispatch: lint → typecheck → tests → `pack:win` →
  checksums → upload artifact (always) → GitHub Release (tag builds) with
  `Dentiva-Pro-Setup-v1.1.0.exe` + `SHA256SUMS.txt`

## Release history
- **v1.0.0** — GitHub Release published: `Dentiva-Pro-Setup-v1.0.0.exe` (93,403,905 bytes) +
  `SHA256SUMS.txt`; PR #1 green (run 36449821131), tag run 36450442666.
- **v1.1.0** — in progress: all gates green locally (2026-09-29); CI verification → tag → release.

## Next exact action
1. Commit all v1.1.0 work on `arena/01a0edf6-dentiva-official-application` and push.
2. Open/update the PR (→ main); wait for CI (verify + e2e) green.
3. Tag `v1.1.0` on the merged/CI-green commit → release.yml builds
   `Dentiva-Pro-Setup-v1.1.0.exe` + `SHA256SUMS.txt` on windows-2022 and publishes the
   GitHub Release.
4. Post-release: manual clean-machine validation per `docs/PHYSICAL_DEVICE_VALIDATION.md`
   (owner/field step); final report `docs/V1_1_FINAL_REPORT.md` updated with CI/release evidence.
