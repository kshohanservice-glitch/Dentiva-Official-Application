# Dentiva Pro v1.1.0 — Final Release Report

> Deliverable per spec §45. Companion docs: `FORENSIC_AUDIT_REPORT.md` (root causes),
> `TESTING_GAP_ANALYSIS.md` (test pyramid), `RELEASE_READINESS.md` (gate checklist),
> `PHYSICAL_DEVICE_VALIDATION.md` (field protocol), `BUILD_STATE.md` (execution state).

## RELEASE STATUS

**RELEASE READY — v1.1.0 is published.** GitHub Release `v1.1.0` (tag @ `4a925e7`) with
`Dentiva-Pro-Setup-v1.1.0.exe` (93,381,089 bytes) + `SHA256SUMS.txt`, built and published on
windows-2022 by release run **36677065338** — all gates green **before** packaging:

| Gate | Platform | Result |
|---|---|---|
| PR CI on the product commits (`9b50de7` run 36610276411; `700fb8f`; `1703ae3`; `4a925e7`) | ubuntu | **PASS** — lint · typecheck · 154/154 tests + real-Electron E2E (activation gate, fixture journey, 900×520 short-viewport) |
| Release run 36676031429 (tag @ `f2573fd`, windows-2022) | windows-2022 | **PASS** — Gate 1 lint · Gate 2 typecheck · **Gate 3 all 154 tests** (FD-019 fix proven) · Gate 4 build + NSIS · checksums · release |
| Release run **36677065338** (tag @ `4a925e7` — final tree, windows-2022) | windows-2022 | **PASS** — same gates; **this is the published artifact set** (NSIS embeds build timestamps, so the republished installer bytes differ from run 36676031429 — hashes below are the published ones) |
| Same 154-test suite | this sandbox (linux) | **PASS 154/154** |

FD-019 (Windows-only test failure) was root-caused from the instrumented run's check-run
summary (run 36675420978): a failed SQLite open left its file handle open; on Windows the
corruption-quarantine rename then failed `EBUSY`, leaving the corrupt file in place so the
app would crash-loop at startup — a genuine Failure-A-class defect on real Windows machines,
hidden on Linux (POSIX renames open files). Fixed in `f2573fd` (close on failed open +
bounded rename retry); the startup-recovery regression tests fail on windows-2022 without
the fix and pass with it.

Installer integrity (the **published** asset set from run 36677065338):
`Dentiva-Pro-Setup-v1.1.0.exe` SHA-256 `cf1b18de6743b9456e6690206890c981c35ea8108514c6965694be1788c4154c`
(93,381,089 bytes; GitHub upload-time digest of the published asset) and `SHA256SUMS.txt`
SHA-256 `6e09112d539162e9d9e7e7b5b73cff2cdcc921934e060022278e9e2e9a2a1284`. The earlier
run 36676031429 published a byte-different build (exe SHA-256 `8f59bb38…c28a0d`,
93,382,465 B) which the final run superseded — NSIS embeds build timestamps, so the
authoritative checksums are always the live release's `SHA256SUMS.txt`. The sandbox's egress
to GitHub's asset CDN is blocked, so the byte-level re-hash is executed by the field protocol
(step-by-step with `certutil -hashfile`) rather than claimed here.

Physical clean-machine validation (`PHYSICAL_DEVICE_VALIDATION.md`) is a documented
**post-release field step** — it cannot execute in this sandbox (no Windows machine/display);
the CI layers it would test are covered by the real-Electron E2E on every PR and by the
Windows release gates (all green on the tagged commit).

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
| FD-019 | CRITICAL | Windows startup crash-loop: failed SQLite open left its handle open → corruption-quarantine `rename` failed `EBUSY` on Windows (POSIX renames open files, so Linux was green) → corrupt file never quarantined → fresh-DB retry re-opened the same garbage | **FIXED** | `openAndCheck` closes on failure; `quarantineFiles` bounded EBUSY/EPERM/EACCES retry. Regression: `startup-recovery.test.ts` (3 tests) — **failed on windows-2022 pre-fix (run 36675420978), passes post-fix (run 36676031429)** |

**Tally: 19 findings — 16 FIXED (incl. FD-019), 3 documented INFO (no action required).
0 open CRITICAL/HIGH.**

## What changed in v1.1.0 (root-cause level)

1. **Canonical settings registry** (`src/shared/settings-registry.ts`) — one typed source of
   truth for every group/key/type/default/validation; used by backend validation, the setup
   service, and the UI. Removed v1.0.0 keys are purged at startup. This eliminates the whole
   bug class of "UI submits what the backend doesn't own" (FD-001/FD-006/FD-009).
2. **Hardened startup** — logging + user-data configured first; every failure path (bootstrap
   crash, corrupt DB, single-instance lock, renderer crash, uncaught exceptions) is logged
   **and** shown to the user with the log path; corrupt DB is quarantined (never deleted) with
   a recovery dialog pointing at the restore flow (FD-005); a failed open releases its SQLite
   handle before quarantine so the recovery cannot dead-end on Windows file locks (FD-019).
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
| Release run 36611121395 (tag v1.1.0 @ 9b50de7, windows-2022) | **FAIL at Gate 3 (tests)** — surfaced FD-019 (fixed in `f2573fd`) |
| Release run 36675420978 (tag v1.1.0 @ 1703ae3, windows-2022) | **FAIL at Gate 3** — instrumented diagnostics identified the exact failure (EBUSY rename in `startup-recovery`) |
| Release run 36676031429 (tag v1.1.0 @ `f2573fd`, windows-2022) | **PASS** — all gates green (lint · typecheck · 154/154 tests · build+NSIS · checksums · release) |
| Release run 36677065338 (tag v1.1.0 @ `4a925e7` — final tree, windows-2022) | **PASS** — same gates; **published artifact set** (hashes above) |

## Artifacts & publication (tag `v1.1.0`)

**PUBLISHED** (release run **36677065338**, tag `v1.1.0` @ `4a925e7`, windows-2022, all gates
green before packaging):

1. `Dentiva-Pro-Setup-v1.1.0.exe` — **93,381,089 bytes**, SHA-256
   `cf1b18de6743b9456e6690206890c981c35ea8108514c6965694be1788c4154c` (NSIS, windows-2022)
2. `SHA256SUMS.txt` — SHA-256 `6e09112d539162e9d9e7e7b5b73cff2cdcc921934e060022278e9e2e9a2a1284`
   (verify before running — installer is unsigned, FD-016; NSIS embeds build timestamps, so a
   re-run publishes byte-different builds — always check the live `SHA256SUMS.txt`)
3. GitHub Release `v1.1.0` with both artifacts + fallback Actions artifact
   (`Dentiva-Pro-Setup-v1.1.0.exe`, `test-run-log`, `pack-win-log`)
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
- [x] Windows release Gate 3 green (FD-019 fixed in `f2573fd`; run 36676031429: 154/154 on windows-2022)
- [x] Tag build + GitHub Release (final run 36677065338 @ 4a925e7: installer + SHA256SUMS published, hashes recorded above)
- [ ] Field validation per protocol (post-release — owner/field step, 3 devices)
