# Dentiva Pro — Security Model

Threat model: a single clinic machine (or a few clinic machines), offline, handling patient data. Adversaries are mostly *casual* access (staff walking up to an unlocked screen) and *accidental* damage (bad edits, wrong deletions, mis-scheduled restores) — plus standard hygiene around credentials and backups.

## Authentication

- **Argon2id** password hashing (`@noble/hashes`, m=65536, t=4, p=2, 16-byte salt) — no native crypto, no network.
- Login rate limiting: after `maxLoginAttempts` (default 5) wrong passwords the account locks for `lockoutMinutes` (default 15) — even the **correct** password is rejected while locked. Failures and lockouts are audited.
- Timing side channel: unknown usernames burn a comparable verification (`dummy hash`) so response time does not reveal account existence.
- Password policy (length/letter/number/no-username/common-password) enforced at every change point.

## Session & screen lock

- The session lives **only in main-process memory** — never persisted as a token the renderer can read.
- Manual lock + inactivity auto-lock (configurable minutes) hides all data behind unlock-with-password.
- Unlock failure/success is audited.

## Activation (offline)

- The license code is verified locally against an **embedded verifier** — the app contains only hash material, never the plaintext code.
- The plaintext code exists solely in environment variables at test time and is rejected by the repository guard (CI fails on any 16-digit sequence in tracked files).

## Authorization (RBAC)

- Every service function calls `requirePermission(actor, '<permission>')` — **business logic**, not UI. Hiding a button is cosmetic; the IPC handler would return `forbidden` anyway.
- Built-in roles are seeded; custom roles validate permission codes against the shared allow-list.
- Denials are audited (`permission.denied` with actor + permission code).
- Financial data on the dashboard requires `financial.view` **before the query runs** (no data fetched-then-hidden).

## Audit trail

- `audit_log` rows carry actor, action, entity, result and before/after JSON.
- Each row stores `prev_hash` + `hash` over its content → a tamper-evident chain; the integration suite asserts every hash is 64-hex and links to its predecessor.
- Destructive operations (payment reversal, restore, user deactivation, patient deletion) additionally require the user's password and/or a typed confirmation phrase.

## Data storage

- SQLite with WAL, foreign keys on, versioned migrations, `PRAGMA integrity_check` on startup.
- Database file sits in the OS application-data folder — **not encrypted at rest** (documented limitation for an offline desktop app; use OS disk encryption / NTFS ACLs for stronger protection).
- Patient deletion is soft-delete (recoverable, audited).

## Backups

- `.dvbackup` = ZIP containing the DB copy + JSON manifest (row counts, app version, created-at, SHA-256).
- `verifyBackup` recomputes the hash before any restore; restore creates a **safety backup first**, runs in a staged swap, and is audited.
- Scheduled backups never interrupt clinic work (off the UI path).

## Printing & PDF

- PDFs are rendered in a hidden `BrowserWindow` with all dynamic content HTML-escaped at render time (template tests assert XSS payloads are neutralized).
- Page sizes passed to Electron `printToPDF` as integer microns (A4 = 210000×297000; 80 mm thermal = 80000 wide).

## Input hygiene

- Zod schemas at the IPC boundary; SQL is prepared statements only (no string-built queries).
- `sanitizeText` strips control characters; HTML escaping happens at output (`esc()` in templates) — escaping at render is the single source of truth.

## Known, accepted limitations

| Item | Note |
|---|---|
| DB not encrypted at rest | Offline single-machine app; rely on OS encryption + auto-lock |
| Unsigned installer (until a code-signing cert is added) | Users verify via the published SHA-256 manifest |
| Single active session | Desktop app design — one login per running instance |
| No remote administration / MFA | Out of scope for offline-first desktop |
