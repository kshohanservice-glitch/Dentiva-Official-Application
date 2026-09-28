# ADR-0001 — Dentiva Pro Architecture Decision

**Status:** Accepted · **Date:** 2026-09-28 · **Product version:** 1.0.0

## Context
Dentiva Pro must be a fully offline, commercially distributable Windows desktop dental clinic
management application for Bangladesh. It must handle unlimited practical records, granular RBAC,
audit logging, printing/PDF (A4/A5/thermal) with Bengali Unicode, backup/restore, and ship as a
single-version production NSIS installer built via GitHub Actions.

## Decision summary

| Concern | Choice | Rationale |
|---|---|---|
| Desktop framework | **Electron 37** | Mature, best Windows packaging/printing support, first-class `printToPDF`, sandboxed renderer, wide CI support. Tauri rejected: Rust toolchain not available in this environment, Windows cross-build from Linux significantly harder. |
| Frontend | **React 18 + TypeScript 5.9 + Vite 5** | Predictable, well-known, fast builds; strict TS across renderer/main/shared. |
| Main-process bundling | **esbuild** | Fast, deterministic CJS bundles for main + preload; externals only `electron` + `better-sqlite3`. |
| Database | **SQLite via better-sqlite3** (WAL) | Embedded, transactional, zero-config, ideal for offline clinics; synchronous API suits Electron main; proven at 100k+ row scale with proper indexes. |
| Data layer | Hand-rolled **repository/service layer** with versioned SQL migrations | No ORM magic; explicit schema control; migrations verified at startup. |
| State management | **TanStack Query** over typed IPC + small local UI stores | Single source of truth = database; query cache invalidation after mutations; avoids duplicated global mutable state. |
| Validation | **zod** shared schemas | One schema validates forms (renderer) *and* IPC payloads (main). Server-side validation is authoritative. |
| Authentication | Local username/password, session tokens in memory, auto-lock timer | Fully offline; no external IdP. |
| Password hashing | **Argon2id** (`@noble/hashes`, 64 MiB, t=4, p=2, per-user random salt) | Modern, memory-hard, pure JS → no native build issues; OWASP first choice. |
| Activation | Offline fixed code verified against an **Argon2id-derived verifier** embedded in main bundle; state persisted encrypted (AES-256-GCM with machine+app derived key) in userData | No plaintext code anywhere in repo; no online server; acknowledged (per spec) that any local scheme is ultimately inspectable — this minimizes attack surface without false secrecy claims. |
| Attachments | Files stored under `userData/attachments/<yyyy>/<uuid><ext>`; metadata rows in DB; magic-byte content sniffing + size caps; never trusting extensions | Safe, avoids DB bloat, prevents path traversal. |
| Backup | `*.dvbackup` = ZIP (yazl) containing WAL-checkpointed DB snapshot (SQLite Online Backup API), attachments, `manifest.json` (schema version, app version, SHA-256 per member, counts) | Versioned, integrity-checked, restorable; partial writes fail verification. |
| Restore | validate → safety backup of current data → staged extract → integrity check → atomic swap → reload; fully audited | Never destroys current data without a safety net. |
| PDF/printing | Reusable print templates rendered in a **hidden BrowserWindow sized to the selected paper profile** (A4 210×297, A5 148×210, thermal 58/80 mm) → `webContents.printToPDF()` / `print()` | Real per-paper layouts (not scaled A4); identical CSS for preview and print; Windows printers (incl. network/Bluetooth) reachable through Chromium print dialog; Save-as-PDF built in. |
| Printer profiles | DB entity (name, printer, paper size, margins, orientation, scale, copies, default) | User-selectable, persisted, audited. |
| Installer | **electron-builder NSIS** (`Dentiva-Pro-Setup-vX.Y.Z.exe`), shortcuts, correct icon, `deleteAppDataOnUninstall: false` | Data-safe uninstall; no runtime deps needed on customer machine (app is fully packaged). |
| Auto-lock | Main-process idle timer → locks window, requires password; configurable 5/10/15/30 min / policy | Sensitive data hidden behind lock overlay; unsaved form state preserved where safe. |
| Audit logging | Append-only `audit_log` table (no update/delete service methods); hash chain (prev_hash → hash) for tamper evidence; login/permission/financial/destructive events | “Must not be casually editable/deletable.” |
| RBAC | `roles`, `permissions`, `role_permissions`, `user_roles`; `requirePermission()` called **inside every service method before any data query** | Enforced in business layer, not UI; financial totals never computed without `financial.view`. |
| Error handling | Global main-process uncaught handlers + structured rotating file logs (no PHI/secrets); renderer error boundary with friendly recovery UI | No stack traces to users; crash-safe SQLite (WAL + busy_timeout + integrity checks). |
| Logging | `userData/logs/dentiva-YYYY-MM-DD.log`, size-capped, scrubbed | Local only, no telemetry. |
| Migrations | Ordered `.sql` files + `schema_migrations` table; startup verification; additive-only for this single final release | No silent schema drift. |
| Testing | **Vitest** unit + integration (real SQLite temp DBs), **Playwright** Electron E2E, ESLint + `tsc --noEmit` gates | Full pyramid; CI runs everything. |
| CI/CD | **GitHub Actions**: `ci.yml` (lint → typecheck → unit/integration → build → e2e on Linux) + `release.yml` (Windows runner → electron-builder NSIS → checksums → GitHub Release, fallback to `dist/`) | Windows artifacts built on Windows. |
| Release | Single final version **1.0.0** via PR → CI green → GitHub Release; no auto-updater, no telemetry | Spec §9/§100/§124. |

## Rejected alternatives
- **Tauri/Rust**: no Rust toolchain in build environment; Windows installer cross-compile risk; PDF/print pipeline weaker.
- **Node sqlite (built-in)**: experimental API, not suitable for a commercial product baseline.
- **Electron + IndexedDB/LevelDB**: violates relational integrity requirements.
- **TCP/HTTP localhost server between renderer and DB**: extra attack surface with no benefit offline.
- **ORM (Prisma/TypeScriptORM)**: heavier footprint, migration opacity; explicit SQL chosen for control.

## Security posture (Electron)
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webviewTag: false`
- Preload exposes a narrow, allow-listed, zod-validated `dentiva` bridge only.
- `setWindowOpenHandler` deny-all; navigation denied; CSP without remote origins; no remote content.
- IPC payload validation + RBAC checks in main; renderer never touches filesystem/DB directly.

## Performance strategy
- Indexed covering queries on all search columns; FTS5-free indexed LIKE search with bounded pages.
- List screens paginate (default 25/50/100) over indexed keysets; dashboard queries are per-day aggregates.
- Virtualization-free design kept by pagination; stress harness generates 100k patients for measurement.

## License posture
All runtime deps permissive: MIT/ISC/BSD (better-sqlite3 ISC, react MIT, zod MIT, noble ISC, yazl/yauzl MIT,
fonts OFL). No GPL/AGPL. Inventory maintained in `docs/THIRD_PARTY_NOTICES.md`.
