# Dentiva Pro v1.1.0 — Final Release Report

> Deliverable per spec §45. Companion docs: `FORENSIC_AUDIT_REPORT.md` (root causes),
> `TESTING_GAP_ANALYSIS.md` (test pyramid), `RELEASE_READINESS.md` (gate checklist),
> `PHYSICAL_DEVICE_VALIDATION.md` (field protocol), `BUILD_STATE.md` (execution state).

## RELEASE STATUS

**RELEASE BLOCKED (one release-blocking defect open: FD-019, Windows test-gate failure —
under active diagnosis).** All product defects (FD-001…FD-018) remain fixed and
regression-tested; the blocker is in the release pipeline's Windows execution, not in
verified product behavior on the platforms where the full suite runs green.

Evidence so far (all independently re-verified this session):

| Gate | Platform | Result |
|---|---|---|
| PR CI on final product commit `9b50de7` (run 36610276411) | ubuntu | **PASS** — lint · typecheck · 154/154 tests (1m22s) + real-Electron E2E: activation gate, fixture journey (wizard → login → dashboard → dark theme → backup picker), 900×520 short-viewport (2m22s) |
| Tag build `v1.1.0` @ `9b50de7` (run 36611121395) | windows-2022 | **FAIL** — Gate 1 lint PASS, Gate 2 typecheck PASS, **Gate 3 (unit + integration tests) FAIL**; packaging/release steps skipped (gated) |
| Same 154-test suite | this sandbox (linux) | **PASS 154/154** |
| v1.0.0 release build (run 36450442666, 108-test suite) | windows-2022 | PASS (proves the Windows runner + native better-sqlite3 + test harness work) |

Diagnosis state: the failing test's log is not retrievable from the maintenance sandbox
(GitHub's log-blob host is network-blocked here). Fix applied to the pipeline: `release.yml`
now tees Gate 3 to `test-run.log`, uploads it as an artifact, and patches the check-run
summary with the failure tail (commit `700fb8f`, same diagnostics pattern that surfaced the
FD-011 E2E failure). Re-tag + re-run is pending — blocked on GitHub connectivity dropping
from this session (token 401); see `BUILD_STATE.md` for the exact resume steps.

No installer or GitHub Release has been published for v1.1.0. The tag `v1.1.0` exists at
`9b50de7` and will be force-moved to the fixed commit once Gate 3 is green on Windows
(policy: tag only verified commits; the tag build re-runs all gates before packaging).

Physical clean-machine validation (`PHYSICAL_DEVICE_VALIDATION.md`) remains a documented
**post-release field step** — it cannot execute in this sandbox (no Windows machine/display);
the CI layers it would test are already covered by the real-Electron E2E on every PR and by
the Windows release gates.

## DEFECT SUMMARY

| ID | Sev | Defect (field ref) | Status | Regression coverage |
|---|---|---|---|---|
| FD-001 | CRITICAL | Wizard step 4 `Unknown setting: general.moneyDecimals` (Failure C) | **FIXED** | `settings-registry.test.ts`, `setup-flow.test.ts`, E2E journey (moneyDecimals=0) |
| FD-002 | CRITICAL | Setup "Browse" silently 401'd (Failure D) | **FIXED** | E2E wizard step 4 Browse; IPC NO_AUTH set pinned in contract |
| FD-003 | CRITICAL | Icon opaque white corners (Failure E) | **FIXED** | `icon.test.ts` — pixel decode of all 7 ICO entries (16→256) |
| FD-004 | CRITICAL | Wizard clipped on short laptops (Failure B) | **FIXED** | `css-contract.test.ts` + E2E 900×520 per-button reachability |
| FD-005 | CRITICAL | Invisible startup failures / silent corrupt-DB exit (Failure A) | **FIXED** | `startup-recovery.test.ts` (2 corruption modes) + hardened bootstrap |
| FD-006 | HIGH | Clinic logo save rejected (`clinic.logoData`) | **FIXED** | `clinic.getLogo` flow + Settings logo preview E2E-visible code path |
| FD-007 | HIGH | moneyDecimals/dateFormat/use24HourTime had no runtime effect | **FIXED** | `format-config.test.ts`, `templates.test.ts` (0/2/4 decimals), setup-flow wiring |
| FD-008 | HIGH | Restore "Choose folder…" miswired (dead control) | **FIXED** | E2E backup step (UI→IPC→main round trip) |
| FD-009 | HIGH | Settings accepted any JSON for known keys | **FIXED** | `settings-registry.test.ts` (type/range/enum validation) |
| FD-010 | MEDIUM | `backup.keepCount` never enforced | **FIXED** | `backup.test.ts` (pattern-limited, fresh + pre-restore protection) |
| FD-011 | MEDIUM | Appearance (theme/density/motion) dead | **FIXED** | `css-contract.test.ts` (token sets) + E2E dark-theme application |
| FD-012 | MEDIUM | `/settings?tab=profile` dead-end | **FIXED** | deep-link tabs in Settings (profile→Security) |
| FD-013 | LOW | Dead no-op SQL in invoice creation | **FIXED** | removed (FK is source of truth) |
| FD-014 | LOW | Print temp path env inconsistency | **FIXED** | unified on `paths().runtime` |
| FD-015 | INFO | FIFO payment stores first allocation id | documented | allocations table is source of truth |
| FD-016 | INFO | Installer unsigned | documented | SHA-256 published; SmartScreen note in field protocol |
| FD-017 | INFO | Money stored as REAL | documented | round2 in service layer; integer-cents migration not adopted |
| FD-018 | LOW | Appointments CSV Time column empty (field Defect K) | **FIXED** | `clinic-flow.test.ts` (full export path, Date+Time asserted) |
| FD-019 | CRITICAL | Release Gate 3 (154-test suite) fails on windows-2022; passes on ubuntu CI + local (same commit, same suite) | **OPEN — diagnosis in progress** | diagnostics instrumentation merged (`700fb8f`); failing test identified via check-summary/log artifact on re-run, then root-cause fix + re-run required |

**Tally: 19 findings — 15 FIXED, 3 documented INFO (no action required), 1 OPEN (FD-019,
pipeline/Windows, release-blocking).**

## What changed in v1.1.0 (root-cause level)

1. **Canonical settings registry** (`src/shared/settings-registry.ts`) — one typed source of
   truth for every group/key/type/default/validation; used by backend validation, the setup
   service, and the UI. Removed v1.0.0 keys are purged at startup. This eliminates the whole
   bug class of "UI submits what the backend doesn't own" (FD-001/FD-006/FD-009).
2. **Hardened startup** — logging + user-data configured first; every failure path (bootstrap
   crash, corrupt DB, single-instance lock, renderer crash, uncaught exceptions) is logged
   **and** shown to the user with the log path; corrupt DB is quarantined (never deleted) with
   a recovery dialog pointing at the restore flow (FD-005).
3. **Live format + appearance** — money/date formatting and theme/density/motion are applied
   per JS runtime from settings (renderer on every state change; main at bootstrap/write/
   restore), so UI, print, and PDF always match the user's choices (FD-007/FD-011).
4. **Backup/restore hardening** — retention with safety rails, same-second name collisions,
   clean failure on unreadable archives, pre-restore safety backups, failed restore never
   touches the live DB (FD-008/FD-010 + spec mandate).
5. **Icon integrity** — true-alpha multi-size icon + reproducible builder + pixel-level
   regression tests (FD-003).
6. **Dead controls eliminated** — every removed setting was either wired live
   (`appointments.*` → Scheduling defaults/slot step; `invoice.taxRate` → Billing apply button;
   `notifications.appointmentReminders` → daily digest) or removed from the registry + UI.
7. **E2E no longer secret-gated** — the CI activation fixture
   (`scripts/e2e-fixture.mjs`) lets the full first-run journey run on **every** PR without the
   customer code; the real-code journey still runs when `DENTIVA_ACTIVATION_SOURCE` is set.
   (The agent token cannot set repo secrets — 403; owner action, now optional.)

## Verification evidence (local, 2026-09-29, final commit)

| Gate | Result |
|---|---|
| ESLint | 0 errors (39 documented warning demotions) |
| Typecheck (node + web, incl. tests) | 0 errors |
| Static audit (TODO/FIXME/console/demo) | PASS (57 files) |
| 16-digit activation guard | PASS (no sequences in tracked files) |
| Unit + integration tests | **154/154, 16 files** (v1.0.0 baseline: 108/9) |
| Production build (typecheck → Vite → esbuild prod) | PASS |
| Icon alpha purity (16/24/32/48/64/128/256) | PASS |
| Activation code | verified against embedded Argon2id verifier (env-only, never stored) |
| PR CI on `9b50de7` (run 36610276411) | **PASS** — verify job 1m22s, E2E job 2m22s (full journey + 900×520) |
| Release run 36611121395 (tag v1.1.0, windows-2022) | **FAIL at Gate 3 (tests)** — lint/typecheck PASS; see FD-019 |

## Artifacts & publication (tag `v1.1.0`)

**NOT YET PUBLISHED — blocked on FD-019.** When Gate 3 is green on Windows, the tag build
produces and publishes, in this order:

1. `Dentiva-Pro-Setup-v1.1.0.exe` (NSIS, windows-2022, built **after** all release gates)
2. `SHA256SUMS.txt` (published alongside; verify before running — installer is unsigned, FD-016)
3. GitHub Release `v1.1.0` with both artifacts + fallback Actions artifact
4. PR from `arena/01a0edf6-dentiva-official-application` → `main` with green checks

## Residual risk & accepted limitations

- **Physical clean-machine validation is pending field execution** (protocol in
  `PHYSICAL_DEVICE_VALIDATION.md`). The CI E2E runs the identical startup/migration/wizard
  chain on real Electron; the residual risk is Windows-specific installer/OS-interaction
  behavior, which the field protocol covers step-by-step with log capture.
- Installer unsigned (FD-016) — SmartScreen warning expected; mitigated by published SHA-256.
- Money stored as REAL with round2 service-layer math (FD-017) — no sub-paisa usage in BDT;
  integer-cents migration deferred (risk > benefit for v1.1.0).
- The CI activation fixture is machine-bound (scrypt key from hostname/username) and is
  gitignored; it contains **no** customer code material.

## Sign-off checklist

- [x] All five field failures root-caused, fixed, regression-tested
- [x] Complete settings audit (registry; no UI key rejected; survives fresh/upgrade/restore/reset)
- [x] Every file/folder picker audited and wired (cancel/empty/error paths)
- [x] Icon alpha-pure at all sizes (tested at pixel level)
- [x] Failed restore cannot destroy the database (tested)
- [x] No plaintext activation material anywhere (guard on every push; env-only verification)
- [x] Test pyramid: 154 unit/integration + 4 E2E scenarios (gate, journey, short-viewport,
      real-code journey when secret present)
- [x] CI green on final product commit `9b50de7` (run 36610276411: verify + E2E PASS)
- [ ] Windows release Gate 3 green (FD-019 open — diagnostics instrumentation merged at `700fb8f`; re-tag + re-run pending GitHub connectivity)
- [ ] Tag build + GitHub Release (gated on the line above)
- [ ] Field validation per protocol (post-release)
