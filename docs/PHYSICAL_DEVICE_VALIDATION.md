# Dentiva Pro — Physical Device Validation Protocol (v1.1.0)

**Purpose.** The five field failures (A–E) all happened on **installed, physical** machines —
none of them are reproducible in the development sandbox or the CI runners alone. This document
is the required post-release validation protocol to prove the v1.1.0 fixes on real hardware, and
it records exactly which layers CI already covers so the field test is short and targeted.

**Status: PENDING FIELD EXECUTION** — this sandbox has no Windows machine, display, or
installer; nothing below marked *field* has been executed. Every *CI* layer has a test that
already passes (or will run on the PR).

---

## 1. What CI already proves (no field action needed)

| Layer | CI evidence |
|---|---|
| Native module ABI (better-sqlite3 ↔ Electron 37) | `ci.yml` rebuilds better-sqlite3 with `electron-rebuild -f -w better-sqlite3` and runs the **real Electron app** under Xvfb (E2E). A wrong ABI crashes at startup and fails the run. |
| Fresh-install DB bootstrap (migrations + seeds + activation state) | Every E2E run boots a **throwaway user-data dir** through the full first-run chain; unit/integration tests open fresh SQLite DBs per file. |
| Startup failure surfaces (Failure A) | `tests/integration/startup-recovery.test.ts` — unreadable + integrity-corrupt DB → quarantine + fresh DB + `lastRecovery`; fatal-path dialog code is covered by the hardened `bootstrap()` (log-first, dialog-with-log-path). |
| Wizard completion with non-default settings (Failure C) | E2E journey submits `moneyDecimals=0` on step 4 and asserts step 5 is reached; `setup-flow.test.ts` replays the exact payload through the services. |
| Wizard buttons reachable at 900×520 (Failure B) | E2E short-viewport test scrolls `.auth-screen` and asserts each button is in the viewport. |
| Restore file picker wiring (Failure D) | E2E backup step (UI→preload→IPC→main round trip, headless dialog guard). |
| Icon transparency (Failure E) | `tests/unit/icon.test.ts` decodes the actual `build/icon.ico` pixels (16→256) — corners must be transparent. The installer embeds this exact file (`electron-builder` `icon: build/icon.ico`). |
| No activation code in repo/artifacts | 16-digit guard on every push/PR. |
| Financial/clinical integrity | 154 unit/integration tests incl. round2 math, FIFO payments, restore round-trip. |

## 2. Field test — clean Windows machine (owner/field engineer)

**Machine criteria (match the field reports):**
- Windows 10 21H2+ **or** Windows 11, x64, **clean install** (no prior Dentiva, no VC++
  redist dependency assumed — the installer must work as-is).
- One machine at **1366×768** (small laptop) and one at ≥1920×1080; test at **100% and 150%**
  display scaling on the small one.
- Offline (airplane mode) for the whole run — the app must never require network.

### 2.1 Install
1. Download `Dentiva-Pro-Setup-v1.1.0.exe` from the GitHub Release.
2. Verify the SHA-256 against `SHA256SUMS.txt` **before** running
   (`certutil -hashfile Dentiva-Pro-Setup-v1.1.0.exe SHA256`).
3. Run the installer (SmartScreen may warn — installer is unsigned, FD-016; "More info → Run
   anyway" is expected and documented).
4. **Expected:** installer completes without "missing VC++ runtime" or native-module errors.
   *(This is the Failure A install half.)*

### 2.2 First launch (Failure A)
1. Launch from the Start menu and the desktop shortcut.
2. **Expected:** activation screen appears within ~10 s; no blank window, no silent exit, no
   crash dialog. If anything fails: collect `%APPDATA%\Dentiva Pro\logs\dentiva-<date>.log`
   (the path is now always printed in every fatal dialog) and file it immediately.
3. Activate with the customer code (16 digits, no spaces needed — normalization handles both).
   **Expected:** "activation succeeded" → setup wizard.

### 2.3 Setup wizard on the 1366×768 machine at 150% scaling (Failures B + C)
1. Complete all 5 steps with **non-default** values: clinic name, one dentist, admin account,
   and on step 4 pick **"৳ 1,250 (no decimals)"**, auto-lock 10 min, backup "Every 7 days".
2. **Expected:** every button (Previous / Save & continue / Browse / Create administrator /
   Launch) is reachable by scrolling — nothing clipped, nothing unreachable.
   *(Before v1.1.0: buttons below the fold were unreachable — Failure B. Step 4 "Save &
   continue" rejected `general:moneyDecimals` — Failure C.)*
3. Use **Browse** on the backup-folder field. **Expected:** a real folder picker opens;
   picking a folder fills the field; Cancel leaves the field unchanged. *(Failure D.)*

### 2.4 Login + daily loop
1. Log in with the wizard admin account. Create a patient (include a **Bengali name**,
   e.g. `করিম`), an appointment, a clinical visit with a Bengali note, and an invoice with
   a bKash payment.
2. **Expected:** money shows **without decimals** everywhere (dashboard, invoice, print
   preview) — the wizard choice is live (FD-007). Bengali renders correctly on screen.
3. Settings → Preferences → Appearance: switch **Theme = Dark**, save. **Expected:** the app
   goes dark immediately (FD-009/FD-011). Switch back to Light.
4. Print the invoice to PDF and open it. **Expected:** white page, letterhead, Bengali footer,
   money with 0 decimals.

### 2.5 Icon (Failure E)
1. Check the **taskbar** icon, the **Start-menu** tile, the **desktop shortcut**, and the
   **installer** icon.
2. **Expected:** blue rounded-square logo with **transparent (not white) corners** at every
   size (16 px taskbar up to 256 px).
3. Task Manager → Details → right-click column header → add "Icon": all `Dentiva Pro.exe`
   processes show the new icon.

### 2.6 Backup / restore (Failure D + FD-010)
1. Backup & Restore → **Create backup** (default folder). Then pick a custom folder via
   **Browse** and create again.
2. Restore: use **"Choose backup file…"** to pick the first backup → Preview → Restore (re-enter
   the admin password).
3. **Expected:** restore succeeds; data intact; a "pre-restore safety backup" exists in the
   backups folder; retention keeps the configured number of backups and **never** deletes the
   safety backup.

### 2.7 Upgrade path (v1.0.0 → v1.1.0)
1. On a machine running v1.0.0 with real data: install v1.1.0 over it.
2. **Expected:** app launches; all data intact; a one-time cleanup of removed v1.0.0 settings
   happens silently (no errors); wizard does **not** reappear.

### 2.8 Result recording
For each step record: PASS / FAIL + screenshot + log excerpt on failure. Any FAIL on
§2.1–§2.3 = **release blocker** (reopens the corresponding field failure). Any FAIL on
§2.4–§2.8 = file an issue with the captured log; assess severity.

## 3. Exit criteria for v1.1.0
- §2.1–§2.5 all PASS on both machines (1366×768@150% and ≥1080p@100%).
- §2.6–§2.7 PASS on at least one machine.
- No new activation-code material in any log (guard: grep logs for 16-digit sequences).
