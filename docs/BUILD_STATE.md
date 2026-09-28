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

## Release attempts so far (Actions)
- PR **#1** opened (arena branch → main). Tag `v1.0.0` pushed 3 times (each iteration added fixes).
- CI `verify` job: **PASS** after guard fix (lint + typecheck + static audit + 108 tests on Actions).
- CI `e2e` job: FAIL at Playwright step (details pending — diagnostics now in check-run summary next run).
- Release job: gates 1–3 PASS on Windows (lint/typecheck/108 tests); **Gate 4 failed = node-gyp "Could not find any Visual Studio"** while rebuilding better-sqlite3 (Electron ABI 136 has no prebuild in better-sqlite3 v11.10.0 → MSVC compile required; `windows-latest` = Server 2025 image failed VS detection).
- **Fix committed locally as `24de965` but NOT pushed** (GitHub auth expired mid-run): `runs-on: windows-2022` + vswhere locate step + `msvs_version=2022` + single-step E2E diagnostics that writes the full ANSI-stripped log into the check-run summary (the only reliable log channel from this sandbox — results-receiver + blob storage are blocked).

## ⛔ BLOCKED: GitHub connection
`gh auth status` → "The github.com token in GH_TOKEN is no longer valid" (401). Local work is safe (commit `24de965` on `arena/01a0e807-dentiva-official-application`; local tag `v1.0.0` → `24de965`; remote tag still at `5914a36`).

## Next exact action (after GitHub is reconnected in Arena)
1. `git push origin arena/01a0e807-dentiva-official-application` then `git push -f origin v1.0.0`.
2. Watch the two runs: CI (PR) and Release (tag). Read failures via `gh api .../check-runs/{id}/annotations` + `.output.summary` (proven channel).
3. Expected: Release Gate 4 succeeds on windows-2022 with VS found → `Dentiva-Pro-Setup-v1.0.0.exe` + checksums → GitHub Release; E2E job needs its summary read → fix spec or env per actual error.
4. On success: record evidence in `docs/FINAL_REPORT.md` (spec §176), refresh this file + traceability (rows 47/48/49 → ✅), final commit/push.
