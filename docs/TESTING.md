# Dentiva Pro — Testing

Every layer below is executed locally and on CI. Results are recorded in `docs/FINAL_REPORT.md` at release time — nothing is claimed as passing unless the run is logged there.

## Layers

| Layer | Runner | Command | Location | Notes |
|---|---|---|---|---|
| Unit | Vitest (node env) | `npm test` | `tests/unit/` | Pure logic: formatting/money, RBAC matrices, password strength, activation format+verification, print templates (HTML/XSS/Unicode), build purity |
| Integration | Vitest + real SQLite | `npm test` | `tests/integration/` | Temp-dir database via `tests/integration/helpers.ts`; exercises actual service functions — no mocks |
| Stress | Vitest + real SQLite | `npm test` (auto) | `tests/integration/stress.test.ts` | 100,000 patients seeded in one transaction; then list/pagination/search through the real service with timing assertions |
| End-to-end | Playwright + Electron | `xvfb-run -a npm run e2e` | `tests/e2e/` | Launches the built app (`dist/main/index.js`) in a throwaway user-data dir |

## What the integration suite covers

1. **`clinic-flow.test.ts`** — the whole business lifecycle against one real database:
   setup (clinic → dentists → admin → finish) → duplicate-phone rejection → patient profile aggregates → visit create/update with audit → dental chart entries → appointment collision detection → token queue (waiting → called → in-consultation → completed) → invoice creation → partial payment until balance is 0 → password-gated payment reversal with audit hash → inventory receive/sell/low-stock/batches → supplier with unique code → income/expense + daily balance → dashboard aggregates → global search (Bengali + code) → audit rows hash-chained (64-hex, links to prev) → backup create → verify → preview-restore → count restore → settings validation.
2. **`auth-rbac.test.ts`** — unknown-user/wrong-password rejection → successful login with full permissions → session lock/unlock → account lockout after repeated failures (correct password rejected while locked) → password change invalidates old password → service-layer `forbidden` errors (`Missing permission: …`) → permission denials audited → dashboard financial slice hidden without `financial.view` → custom role created with exactly `['patient.view']` → user created under it logs in with only those permissions → Owner role = every permission.
3. **`stress.test.ts`** — see above; recorded numbers (local, 2026-09-28): seed 100k = **1,249 ms**, first page **40 ms**, page 2000 (deep) **162 ms**, code search **132 ms**, Bengali search **131 ms**.

## What unit tests cover

- `format.test.ts` — parse/format money (৳), percent semantics (0..1 fraction), date/time display incl. 12/24h, control-character sanitization (HTML escaping is asserted in template tests, where rendering happens).
- `permissions.test.ts` — Owner has every permission; Administrator has everything except `destructive_actions`; group completeness incl. `settings.*`/`notification.*` under Operations; `isPermission` rejects unknown codes.
- `password.test.ts` — strength policy (length, letter, number, no-username), common-password rejection.
- `activation.test.ts` — format validation, normalization (spaces/dashes), malformed input short-circuits, wrong code rejected; **real Argon2id verification only runs when `DENTIVA_ACTIVATION_SOURCE` is present** (CI secret) — never committed to the repo.
- `templates.test.ts` — prescription/invoice/chart/ledger/backup HTML: escaping (XSS), Bengali Unicode round-trip, invoice totals + `PARTIAL` status, A4/A5/landscape print CSS in millimetres, thermal 80mm widths.
- `purity.test.ts` — no demo/sample/lorem data in `src/`, no 16-digit codes in shipped source, installer `files` whitelist excludes tests/docs/scripts, no `.only()` in the suite, test layers exist.

## End-to-end coverage

- **Always** (no secrets needed): first run shows the offline activation gate; malformed code shows a visible error.
- **With `DENTIVA_ACTIVATION_SOURCE`** (CI secret): full journey — activate → 5-step setup wizard → login → dashboard renders real query-backed cards → navigate to Patients → list loads from the real database.

Electron UI tests require a display: CI runs them under `xvfb-run` on Ubuntu after installing GTK/NSS libraries. They are **not** expected to run in the local sandbox (Electron runtime binary is only downloaded on CI).

## Quality gates (must all pass before release)

```bash
npm run lint          # ESLint: 0 errors (warnings are documented demotions)
npm run typecheck     # tsc --noEmit for main/preload and renderer
npm run audit:static  # no TODO/FIXME, no stray console.log, no demo terms in src/
npm test              # unit + integration + stress
npm run build         # production build
xvfb-run -a npm run e2e   # Electron E2E (CI)
```

`ci.yml` runs every one of these; `release.yml` re-runs lint, typecheck, tests **before** producing the installer, then generates checksums and publishes.
