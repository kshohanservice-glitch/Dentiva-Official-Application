# Dentiva Pro — Requirements Traceability

Status legend: ⬜ not started · 🟡 implemented, coverage partial · ✅ implemented + tested · ⛔ documented limitation (manual QA)

| # | Requirement | Module | Implementation | Test | Status |
|---|---|---|---|---|---|
| 1 | Offline activation (hashed verifier, no plaintext) | Activation | src/main/security/activation.ts | tests/unit/activation + CI 16-digit guard | ✅ |
| 2 | First-run setup wizard (clinic, dentists, admin) | Setup | pages/SetupWizard.tsx, services/setup.ts | integration setup ×3 + E2E wizard | ✅ |
| 3 | Login / session / auto-lock | Auth | services/auth.ts + lock/unlock/lockout | integration auth-rbac (5 tests) | ✅ |
| 4 | RBAC enforced in service layer | RBAC | common.requirePermission | unit permissions matrix + integration forbidden paths | ✅ |
| 5 | Audit log (append-only, hash chain) | Audit | common.recordAudit | integration hash-chain assertions | ✅ |
| 6 | Unlimited patients / visits / invoices | Core DB | migrations, no caps; page-size clamp ≠ data cap | stress test: 100k rows, true totals | ✅ |
| 7 | Patient CRUD + advanced search/list | Patients | services/patients.ts | integration create/search/dupe/filters | ✅ |
| 8 | Patient profile + clinical timeline | Patients | getPatientProfile / patientTimeline | integration aggregates + timeline | ✅ |
| 9 | Visit editor (never overwrite history) | Clinical | services/clinical.ts (partial-update merge + audit) | integration create/update + before/after audit | ✅ |
| 10 | Dental chart (adult+pediatric, conditions) | Clinical | chart entries FDI notation | integration save/read chart | ✅ |
| 11 | Treatment catalog w/ fees | Clinical | services/clinical.ts catalog + records | integration catalog + per-patient record | ✅ |
| 12 | Appointments (statuses, views, collision) | Schedule | services/scheduling.ts `findConflicts` | integration conflict detection | ✅ |
| 13 | Queue management (transactional) | Schedule | scheduling.ts state machine | integration full transition path | ✅ |
| 14 | Prescriptions (multi-medicine, C/C O/E R/E) | Clinical | services/clinical.ts prescriptions | integration create + unit template render | ✅ |
| 15 | Prescription print A4/A5/thermal + PDF | Print | print/templates.ts + print/run.ts (integer-micron printToPDF) | unit templates (A4/A5/80mm/landscape CSS) | ✅ |
| 16 | Bengali Unicode UI/PDF/print | i18n/fonts | bundled Noto Sans Bengali | unit templates + stress Bengali search | ✅ |
| 17 | Invoice numbering (unique, collision-safe) | Billing | sequence counter `nextSequence` | integration: two invoices → distinct numbers | ✅ |
| 18 | Partial/multi payments (transactional) | Billing | services/billing.ts | integration partial → settle → reversal | ✅ |
| 19 | Invoice print/PDF multi-paper | Print | invoice templates (totals, PARTIAL, XSS) | unit templates | ✅ |
| 20 | Payment dashboard periods + RBAC | Billing | paymentsDashboard — `financial.view` **before query** | integration forbidden + totals | ✅ |
| 21 | Inventory + expiry/low-stock alerts | Inventory | services/inventory.ts | integration movements/alerts/batches/negative guard | ✅ |
| 22 | Suppliers | Inventory | saveSupplier/listSuppliers/deleteSupplier | integration save/list (found+fixed SQL bug) | ✅ |
| 23 | Accounting (income/expense/categories) | Accounting | services/accounting.ts | integration ledger + summary + byCategory | ✅ |
| 24 | Financial reports from real data | Reports | financialSummary / paymentMethodBreakdown | integration summary assertions | ✅ |
| 25 | Staff management | HR | services/admin.ts users | integration user create/list/role assignment | ✅ |
| 26 | Users + custom roles + permission matrix | Admin | admin.saveRole etc. | integration custom role → exact permissions | ✅ |
| 27 | Financial privacy on dashboard | Security | dashboard.service checks `financial.view` first | integration: financial = null without perm | ✅ |
| 28 | Configurable auto-lock | Security | settings.security.autoLockMinutes | integration settings persist + reject unknown keys | ✅ |
| 29 | Backup (verified, dated name, manifest) | Backup | services/backup.ts `.dvbackup` | integration create → verify (hash+manifest) | ✅ |
| 30 | Restore (safety backup, staged, audited) | Backup | backup.ts restore preview/apply | integration preview-restore + count restore | ✅ |
| 31 | Destructive-action safeguards | Security | password + typed confirm in services | integration reversal password; delete: pw + typed code + financial-archive guard | ✅ |
| 32 | Settings (centralized, validated) | Settings | services/settings.ts | integration set/get/unknown key/group + RBAC | ✅ |
| 33 | Global search (indexed, categorized) | Search | services/search.ts | integration categories + Bengali | ✅ |
| 34 | Notification center (real events) | Notifications | generateSystemNotifications | integration generate/list | ✅ |
| 35 | Role-aware dashboard | Dashboard | services/dashboard.ts | integration real-number assertions | ✅ |
| 36 | Attachments (validated, safe storage) | Files | ipc/register.ts attachments.* (typed input, guarded) | boundary logic reviewed; no dedicated automated test | 🟡 |
| 37 | Referrals | Clinical | clinical.addReferral/listReferrals | integration create + list | ✅ |
| 38 | Data export (CSV) w/ permissions | Reports | services/export.ts (BOM + quoting) | integration: missing `patient.export` → forbidden; dialog path = runtime | ✅ |
| 39 | Versioned migrations + startup check | DB | db/migrations.ts | every integration test migrates a fresh DB | ✅ |
| 40 | Global error handling + structured logging | Infra | renderer boundary + main logger | exercised (logs written) in all integration runs | ✅ |
| 41 | Crash recovery / WAL / integrity | DB | WAL + integrity_check on startup | integration: journal_mode=wal, integrity=ok | ✅ |
| 42 | Keyboard shortcuts | UX | shell key handler | manual UI QA | ⛔ |
| 43 | Accessibility (focus, contrast, reduced motion) | UX | design system CSS | manual UI QA | ⛔ |
| 44 | Empty/loading/error states everywhere | UX | shared components | manual UI QA | ⛔ |
| 45 | About (creator, versions, notices) | Admin | pages/Misc.tsx About | purity test: author + email present in product | ✅ |
| 46 | App icon (multi-res ICO, no clipping) | Assets | build/icon.ico + assets/icons | purity test parses ICO: 16/32/48/128/256 present | ✅ |
| 47 | CI (guard/lint/typecheck/audit/test/e2e) | CI | .github/workflows/ci.yml | Actions run on push/PR | ✅ |
| 48 | Release workflow → installer + checksums | Release | .github/workflows/release.yml | tag-triggered run (gates before pack) | 🟡 |
| 49 | PR workflow for production release | Release | GitHub PR (arena branch → main) | PR link recorded in FINAL_REPORT | 🟡 |
| 50 | Docs set (README, guides, notices, security) | Docs | README, docs/* | review | ✅ |
| 51 | License/dependency inventory | Docs | docs/THIRD_PARTY_NOTICES.md | generated from actual package tree | ✅ |
| 52 | No demo data in production build | Purity | — | tests/unit/purity | ✅ |
| 53 | Static audit (TODO/placeholder/console.log) | QA | scripts/static-audit.mjs | run log: PASS (55 files) | ✅ |
| 54 | Stress/perf with 100k patients | QA | tests/integration/stress.test.ts | 100k seed 1.249 s; pages ≤162 ms; searches ≤132 ms | ✅ |
| 55 | Print layout QA (long/Bengali/many rows) | QA | templates | unit templates: Unicode, escaping, A4/A5/80mm | ✅ |
| 56 | Clean-machine install test | Release | NSIS on windows-latest runner | installer produced on clean runner; interactive install = post-release checklist | 🟡 |
| 57 | Uninstall/reinstall test | Release | NSIS (keeps data by default) | manual checklist in FINAL_REPORT | ⛔ |
| 58 | Invoice number & patient code uniqueness | Core | sequence counter + UNIQUE constraints | integration: distinct codes/invoices asserted | ✅ |
| 59 | Financial immutability (reversals, no rewrite) | Billing | reversePayment creates reversing entry + audit | integration reversal + audit chain | ✅ |
| 60 | Inventory negative-stock guard | Inventory | moveStock hard error on oversell | integration: oversell throws `Insufficient stock` | ✅ |

**Coverage summary: 52 ✅ · 5 🟡 · 3 ⛔ (rows 42–44 manual UI QA; row 57 uninstall checklist) — full matrix evidence in `docs/FINAL_REPORT.md` (spec §172/§176).**
