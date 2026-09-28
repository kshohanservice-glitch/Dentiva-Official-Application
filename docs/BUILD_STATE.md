# Dentiva Pro — Build State

> Persistent execution state. On "Continue", resume from **Next exact action**.

## Current phase
**Phase 8 — Release (implementation + tests complete; release run in progress)**

## Completed phases
- ✅ Phase A — Discovery (empty repo, toolchain, `gh` auth, ImageMagick available)
- ✅ Phase B — Architecture (docs/ADR-0001-architecture.md)
- ✅ Phase C — Scaffold (configs, scripts, package.json, Electron 37 + React 18 + Vite 5 + TS 5.9)
- ✅ Phase D — Shared layer (`src/shared`: permissions, contract, validation, format)
- ✅ Phase E — Data layer (`src/main/db`: migrations, WAL, seeds of system catalog only — **no demo data**)
- ✅ Phase F — Services (activation, auth, setup, settings, admin, patients, clinical, scheduling, billing, inventory, accounting, notifications, search, dashboard, backup, export)
- ✅ Phase G — IPC + preload (`src/main/ipc/register.ts`, typed `src/preload`)
- ✅ Phase H — Renderer (design system, shell, all screens incl. print preview)
- ✅ Phase I — Quality gates green (see below)
- ✅ Phase J — Test suite complete: **108 tests, 9 files, all passing**
- ✅ Phase K — Docs set (README, TESTING, SECURITY, THIRD_PARTY_NOTICES, traceability)
- 🟡 Phase L — Release: CI/release workflows written; PR + tag + installer run pending

## Quality gates (all executed locally, 2026-09-28)
| Gate | Command | Result |
|---|---|---|
| ESLint | `npx eslint .` | **0 errors**, 37 warnings (documented demotions: `react-hooks/set-state-in-effect` ×33, `exhaustive-deps` ×4 → warn) |
| Typecheck | `npm run typecheck` | **0 errors** (node + web tsconfigs; includes tests/**) |
| Static audit | `npm run audit:static` | **PASS** — no TODO/FIXME/console.log/demo terms in `src/` (55 files) |
| Activation-code guard | `git grep -E '[0-9]{16}'` (CI) | **PASS** — no 16-digit codes in tracked files |
| Unit + integration + stress | `npx vitest run` | **108/108 tests, 9 files, ~80 s** |
| Production build | `npm run build` | **PASS** (typecheck → Vite renderer → esbuild main/preload `--prod`) |

## Test inventory
- `tests/unit/`: format, permissions, password, activation, templates, purity (7+ suites)
- `tests/integration/`: clinic-flow (28), auth-rbac (11), stress (7) — real SQLite temp DBs
- `tests/e2e/smoke.spec.ts` — activation gate always; full first-run journey when `DENTIVA_ACTIVATION_SOURCE` present (CI-only: needs Electron binary)
- Stress measurements (local): seed 100k = **1,249 ms**; first page **40 ms**; page 2000 **162 ms**; code search **132 ms**; Bengali search **131 ms**
- Electron stub for tests: `tests/stubs/electron.ts` (aliased in `vitest.config.ts`)

## Recent fixes worth knowing
- `clinical.updateVisit` now **merges** partial input with the existing row (was full-row overwrite)
- `patients` profile `age` falls back to `ageFromDob(dob)` when stored age is null
- `inventory.listSuppliers` SQL: fixed broken `COALESCE(SUM(...))` parenthesis (suppliers screen would have crashed)
- `formatPercent` treats input as 0..1 fraction, clamped 0..100
- `permissions` Operations group includes `settings.*` and `notification.*`
- `build:main` script passes `--prod` (minified, no sourcemaps) for installers; `scripts/dev.mjs` still builds dev bundles
- **`build/icon.ico` was missing** — generated multi-resolution ICO (16/24/32/48/64/128/256, ImageMagick MVG source) + `assets/icons/*.png`; guarded by purity test

## Known issues
- ESLint warnings ×37 are intentional demotions (common query→form-init pattern), see `eslint.config.mjs`.
- Electron/Playwright E2E cannot run in this sandbox (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`) — CI-only by design.

## Environment constraints (do not retry)
- Local `electron .`, `npm run e2e`, `pack:win` **fail in this sandbox** (no Electron binary, no display) — run via Actions.
- `better-sqlite3` local build needed `npm_config_nodedir=/usr/local`; `ELECTRON_SKIP_BINARY_DOWNLOAD=1` for `npm ci`.
- Never print/use `DENTIVA_ACTIVATION_SOURCE` in repo files; CI guard fails the build on any 16-digit code.

## Workflows (written, in repo)
- `.github/workflows/ci.yml` — push/PR to main: code guard → lint → typecheck → static audit → tests → E2E (Xvfb)
- `.github/workflows/release.yml` — tag `v*` / dispatch: lint → typecheck → tests → `pack:win` → checksums → upload artifact (always) → GitHub Release (tag builds) with `Dentiva-Pro-Setup-v*.exe` + `SHA256SUMS.txt`

## Release outcome (final)
- **CI (PR): run 36449821131 — success** (guard, lint, typecheck, audit, 108 tests, Electron E2E).
- **Release (tag v1.0.0 @ 018293c): run 36450442666 — success** on windows-2022 (all gates before pack; MSVC rebuild of better-sqlite3 for Electron ABI 136).
- **GitHub Release v1.0.0** published with `Dentiva-Pro-Setup-v1.0.0.exe` (93,403,905 bytes) + `SHA256SUMS.txt`; Actions artifact `dentiva-pro-installer` uploaded as fallback.
- PR #1 (arena branch → main) open with green checks.
- Final local gates (same commit): lint 0 errors · tsc 0 · audit PASS · guard clean · build PASS · **108/108 tests**.
- Full evidence: `docs/FINAL_REPORT.md`.

## Next exact action
None — release complete. Post-release (user) tasks: merge PR #1; optionally configure the `DENTIVA_ACTIVATION_SOURCE` repo secret (unlocks the E2E full-journey test + real activation verify in CI); manual install/uninstall check on a clean Windows machine per FINAL_REPORT §6.
