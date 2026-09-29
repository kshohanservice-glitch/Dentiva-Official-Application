# Dentiva Pro v1.1.0 — Release Readiness & Gate Checklist

> Living document — evidence is appended as each gate executes. "PENDING" means not yet
> verified in this cycle; nothing is pre-marked green without evidence.

## Functional
- [x] All core modules work — integration suite green locally (2026-09-29); E2E journey runs on every PR via the activation fixture
- [x] All known defects fixed (FD-001…FD-018 in FORENSIC_AUDIT_REPORT, incl. FD-018 = field Defect K)
- [x] All regression tests pass — **154/154 tests, 16 files** locally; new: settings-registry, setup-flow, backup, startup-recovery, format-config, css-contract, icon-alpha, templates-decimals, Defect-K CSV
- [x] No critical defects outstanding
- [x] No high-severity unresolved release blockers

## UI
- [x] All screens usable — code audit of all pages (dead-control sweep) + E2E journey exercises dashboard/patients/settings/backup
- [x] All controls functional — pickers (FD-002/FD-008), exports (incl. Defect K), print, settings save, appearance; no dead buttons remain
- [x] No clipping — `.auth-screen` scroll fix + CSS contract test + short-viewport E2E (900×520)
- [x] No inaccessible controls — wizard scroll fix + E2E `toBeInViewport` assertions on every step
- [ ] High-DPI verified — E2E reduced-viewport proxy in CI; **125/150/200% field check pending (Device B)**
- [ ] Small-screen verified — min window 1024×600 + 900×520 E2E; **1366×768@150% physical check pending (Device B)**
- [x] Resizing verified — flex/scroll containers; modals scroll internally (code audit)

## Database
- [ ] Fresh DB passes (integration suite creates fresh DBs per test)
- [ ] Migration passes (idempotent migration v1; version ceiling check)
- [ ] Backup/restore passes (integration: create/verify/restore + retention + corruption)
- [ ] Data integrity passes (integrity_check on boot; post-restore check; audit hash chain)
- [ ] Large dataset passes (100k-patient stress: seed/page/search timings)

## Security
- [ ] RBAC verified (integration matrix: 6 built-in roles + custom + denial audit)
- [ ] IPC protected (allow-list in preload **and** main; setup-surface no-auth set unit-pinned)
- [ ] Secrets protected (16-digit guard in CI; no plaintext activation material; log scrubbing)
- [ ] Passwords hashed (Argon2id; unit round-trip; plaintext never stored)
- [ ] Activation code protected (Argon2id verifier; local match verification against customer code: DONE 2026-09-29)
- [ ] Destructive actions protected (re-auth + typed-phrase for delete/void/reverse/restore/reset)

## Printing
- [ ] Prescription printing passes (E2E PDF export assertion)
- [ ] Invoice printing passes (template unit tests + PDF path)
- [ ] PDF export passes (E2E: non-empty `%PDF` from hidden-window printToPDF)
- [ ] Bengali text passes (template tests: Unicode pass-through + font embedding)
- [ ] Long content passes (template tests: multi-item layouts; thermal 80mm/58mm CSS)

## Windows
- [ ] Clean-machine install passes (windows-2022 pipeline; **field re-test pending — Device A**)
- [ ] Launch passes (E2E boots real main process every PR; field: Device A)
- [ ] Uninstall passes (NSIS default; field checklist)
- [ ] Reinstall passes (field checklist)
- [ ] Upgrade path passes (v1.0.0 DB → v1.1.0 schema: no schema change in v1.1.0 — same migration v1; startup version ceiling verified by code + tests)
- [ ] Real-device validation passes (PENDING — owner field protocol, 3 devices)

## Release
- [ ] Build reproducible (same pipeline as v1.0.0: gates → esbuild prod → NSIS; `differentialPackage: false`)
- [ ] Installer verified (downloaded artifact size + SHA-256 vs SHA256SUMS.txt)
- [ ] SHA256 generated (release pipeline `npm run checksums`)
- [ ] Release artifacts verified (gh release view; hash match)
- [ ] Documentation complete (V1_1_FINAL_REPORT, PHYSICAL_DEVICE_VALIDATION, BUILD_STATE, SECURITY, README)
- [ ] GitHub Actions green (CI run on final commit — verify before tagging)
- [ ] PR checks green (PR from arena/01a0edf6… → main)
- [ ] Release candidate tested (E2E journey + PDF on the exact tagged commit via CI)
- [ ] Final release tested (release pipeline on tag v1.1.0)

## DPI / resolution matrix (field + automated proxies)

| Class | Proxy in this cycle | Field check |
|---|---|---|
| 1280×720 @100% | CSS contract (scroll) + min-window 1024×600 | Device B |
| 1366×768 @125% (≈1092×614) | min-window 1024×600 + scroll contract | Device B |
| 1366×768 @150% (≈910×512) | **E2E short-viewport at 900×520** (per-button reachability) | Device B |
| 1920×1080 @100/125% | CI default viewport (E2E journey) | Device C |
| 2560×1440 @150% | layout is fluid (flex/grid, no fixed px widths outside modals) | optional |
| 3840×2160 @200% | Chromium DIP scaling (app draws in DIPs; CSS in px) | optional |

Scaling 125/150/175/200% produces exactly the reduced-DIP viewport covered by the
900×520 E2E case or larger — the wizard scroll fix + viewport-clamped auth screens make
content reachability independent of absolute viewport size. The 900×520 case is the
reported "small laptop" geometry (Failure B) and is asserted per-button in E2E.
