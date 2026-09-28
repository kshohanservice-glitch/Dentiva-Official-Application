# Dentiva Pro

**Professional offline-first dental clinic management for Bangladesh.** One Windows desktop app that runs the whole clinic — patients, clinical records, prescriptions, appointments, billing, inventory, accounting, staff, backups — with zero internet dependency and no recurring fees.

- ✅ Runs 100% offline (local SQLite database, no cloud, no telemetry)
- ✅ One-time local activation — no account, no phone-home
- ✅ English interface with full Bengali (বাংলা) Unicode support in data, search and printing
- ✅ ৳ BDT currency everywhere, Bangladesh-ready formats (phone, addresses, dates)
- ✅ Role-based access control, password-protected audit log, verified backups
- ✅ A4 / A5 / thermal-80mm printing with bundled Inter + Noto Sans Bengali fonts

**Author:** Shohan Khan · helloiamshohan@gmail.com

---

## Feature overview

| Area | What you get |
|---|---|
| Activation & setup | One-time offline activation, 5-step first-run wizard (clinic → dentists → admin → preferences → finish), resumable |
| Security | Argon2id passwords, failed-login lockout, manual lock, inactivity auto-lock (configurable), unlock with password |
| Patients | Unlimited records, generated patient codes, duplicate-phone detection, advanced filters, profile with timeline |
| Clinical | Visits with chief complaint → examination → diagnosis → findings → treatment plan (never overwrites history), adult + pediatric dental chart with tooth notation (FDI/Universal) |
| Prescriptions | Multi-medicine with dosage/frequency/duration + C/C, O/E, R/E sections, print to A4/A5/thermal or PDF, Bengali-capable |
| Scheduling | Appointments with status flow, day/week views, dentist-collision detection, token queue with waiting → called → in consultation → completed |
| Billing | Auto-numbered invoices, discounts, **partial/multi payments**, reversals with password + reason (audit-chained), dashboard by period with RBAC |
| Inventory | Items, suppliers, batches with expiry, stock movements, low-stock and near-expiry alerts, negative-stock guard |
| Accounting | Income/expense ledger with categories, real-data financial reports |
| Staff & roles | Users, built-in roles (Owner, Admin, Dentist, Receptionist, Accountant, Pharmacist, Hygienist, Reception-only), custom roles with full permission matrix |
| Backup & restore | One-click + scheduled `.dvbackup` archives, **verified** (hash manifest), dated names, restore with safety backup, all audited |
| Reports & export | CSV exports (permission-gated), searchable global search across patients/invoices/appointments |
| Settings | Centralized: clinic profile, security, billing numbering, notifications, printing profiles, about page |

## Requirements

- Windows 10/11 (64-bit) for the installer, or any Linux/macOS with Node 20+ to build from source
- No internet connection at runtime — ever

## Install (end users)

1. Get `Dentiva-Pro-Setup-v1.0.0.exe` from the GitHub **Releases** page (or the Actions artifact fallback).
2. Verify the SHA-256 against `SHA256SUMS.txt`.
3. Run the installer (per-user install, no admin rights required by default).
4. Launch **Dentiva Pro**, enter your 16-digit license code once, complete the setup wizard, then sign in.

Uninstalling from Windows *does not* delete your clinic database by default (back it up first anyway via **Administration → Backup**).

## Develop

```bash
npm ci              # install toolchain (Electron, TS, Vite, test tools)
npm run dev         # Vite + Electron dev loop with rebuild-on-change
npm run build       # typecheck + renderer (Vite) + main/preload (esbuild, production)
npm run lint        # ESLint (0 errors gate)
npm run typecheck   # tsc for main/preload and renderer separately
```

Key scripts:

| Script | Purpose |
|---|---|
| `npm run dev` | Live development (renderer HMR + main-process rebuild) |
| `npm run build` | Production build of everything (runs typecheck first) |
| `npm test` | Unit + integration + stress tests (Vitest, real SQLite in temp dirs) |
| `npm run e2e` | Playwright + Electron end-to-end (CI machine with display) |
| `npm run lint` / `npm run typecheck` / `npm run audit:static` | Quality gates |
| `npm run pack:win` | Windows NSIS installer → `release/Dentiva-Pro-Setup-v1.0.0.exe` |
| `npm run checksums` | SHA-256 manifest → `dist/SHA256SUMS.txt` |

### Activation code handling

The activation code exists **only** as an environment variable at test/build time (`DENTIVA_ACTIVATION_SOURCE`). It is **never** committed to this repository — CI enforces this with a guard that fails on any 16-digit sequence in tracked files. The shipped app verifies codes offline against an embedded Argon2id-based verifier; there is no plaintext code anywhere in the binary.

## Test

```bash
npm test              # 100 tests: unit (format/RBAC/activation/templates/purity) + integration (clinic flow, auth/RBAC, 100k-patient stress)
xvfb-run -a npm run e2e   # Electron end-to-end (activation gate + full first-run journey)
```

See [docs/TESTING.md](docs/TESTING.md) for the full matrix and [docs/SECURITY.md](docs/SECURITY.md) for the threat model.

## CI/CD

- **`.github/workflows/ci.yml`** — on every push/PR to `main`: activation-code guard → lint → typecheck → static audit → unit/integration/stress tests → Electron E2E under Xvfb.
- **`.github/workflows/release.yml`** — on `v*` tags (all gates re-run **before** packaging): lint → typecheck → tests → `pack:win` → checksums → GitHub Release with `Dentiva-Pro-Setup-v1.0.0.exe` + `SHA256SUMS.txt`; the artifact is always uploaded as a fallback deliverable.

## Documentation

| Document | Contents |
|---|---|
| [docs/BUILD_STATE.md](docs/BUILD_STATE.md) | Live build state / resume point |
| [docs/REQUIREMENTS_TRACEABILITY.md](docs/REQUIREMENTS_TRACEABILITY.md) | Requirement → implementation → test matrix |
| [docs/TESTING.md](docs/TESTING.md) | How to run every layer + what CI covers |
| [docs/SECURITY.md](docs/SECURITY.md) | Security model, audit chain, backups |
| [docs/ADR-0001-architecture.md](docs/ADR-0001-architecture.md) | Architecture decision record |
| [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md) | Dependency license inventory |

## Data & backups

Your database lives in the OS application-data folder (Windows: `%APPDATA%\Dentiva Pro`). Backups are `.dvbackup` archives (ZIP with manifest + hash) written to a folder you choose. Keep a copy on another disk — offline-first means **you** are the backup administrator.

## License

Proprietary — © 2026 Shohan Khan. Bundled third-party components keep their own licenses; see [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md).
