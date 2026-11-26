# DARK-CLOUD — نظام الإدارة والمحاسبة والتوزيع

Enterprise management, accounting and card-distribution system for **شبكة دارك كلاود اللاسلكية (DARK-CLOUD NETWORK)**.
Arabic-first (RTL), base currency **YER**, timezone **Asia/Aden**, dates shown **DD/MM/YYYY**.

> Scope: administration, accounting and distribution only. There is no router, MikroTik or network-monitoring functionality.

| Document | Contents |
|---|---|
| [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) | Hosting the PWA on Cloudflare Pages with the Firebase backend: dependencies, settings, auth domains, plan |
| [docs/ANDROID.md](docs/ANDROID.md) | Android installation (PWA), updates, offline behavior, staging deployment requirements |
| [docs/STATUS.md](docs/STATUS.md) | **Read first.** Per-module implementation status, test results, open policy decisions, what remains |
| [docs/ACCOUNTING.md](docs/ACCOUNTING.md) | Accounting engine: definitions, formulas, double-entry postings, policies, Excel→new mapping |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | Roles, permission matrix, approvals, separation of duties, security model |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Installation, environments, deployment, backup & recovery, data migration |
| [docs/migration-dryrun/](docs/migration-dryrun/) | Dry-run migration report generated from the audited Excel workbook |
| [docs/screenshots/](docs/screenshots/) | Screenshots captured by the automated end-to-end run (desktop + mobile) |

## Architecture in one picture

```
 Browser (React 19 + Vite + Tailwind, Arabic RTL, desktop & mobile)
   │   reads ──► Cloud Firestore  (real-time, permission-gated by firestore.rules; NO client writes)
   │   writes ─► Cloud Function `api` (single callable) ──► services ──► Firestore transaction
   │                   │  auth + permission check (server-side, every call)
   │                   │  zod validation · idempotency key · period lock · approval workflow
   │                   │  balanced double-entry journal + sub-ledgers + audit log (same transaction)
   │                   └─ shared/ accounting engine (pure, unit-tested; same code used by UI previews)
   └─ files ─► Cloud Storage (documents/, permission-checked by storage.rules)
 Scheduled: dailyScan (alerts, 06:00 Aden) · dailyBackup (02:30 Aden, verified JSON snapshot)
```

```
dark-cloud/
  shared/      accounting engine, money/date utils, permissions, domain types, input schemas (+ unit tests)
  functions/   Cloud Functions: core (dispatcher, transaction wrapper), services (team, distribution,
               finance, reports, approvals, backup, scan) + emulator integration/security/rules tests
  web/         React app (pages, components, print documents) + e2e/ Playwright script
  scripts/     bootstrap-owner.mjs · emulator-reset.sh · migrate-from-excel.ts (dry-run)
  firestore.rules · storage.rules · firestore.indexes.json · firebase.json
```

## Quick start (local, emulators only — never touches a real project)

Prerequisites: Node 22, Java 17+ (for the Firestore emulator).

```bash
cd dark-cloud
npm install
npm run build -w functions                     # bundle the server
npx firebase emulators:start --only auth,firestore,functions,storage --project demo-darkcloud
# in another terminal:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 node scripts/bootstrap-owner.mjs --project demo-darkcloud --email gm@example.test --name "المهندس توهيب السيفي"
cd web && npx vite --mode emulator             # http://localhost:5173 — use the "دخول تجريبي" box with gm@example.test
```

The emulator-only sign-in box is compiled in only when `VITE_USE_EMULATORS=true`. Production builds have Google sign-in only.

## Tests

```bash
npm run test:unit                              # 21 engine tests (pure)
npm run test:emulator                          # 74 server tests on the Firestore emulator (business, security, rules, backup)
# E2E (emulators + `vite build --mode emulator && vite preview --mode emulator --port 4173` running, then):
./scripts/emulator-reset.sh && PW_CHROMIUM=/opt/pw-browsers/chromium node web/e2e/e2e.mjs   # 19 browser scenarios
npm run migrate:dryrun -- /path/to/DARK-CLOUD_Database_With_Formulas.xlsx                  # migration dry-run report
```

Results from the last run are in [docs/STATUS.md](docs/STATUS.md#test-results).
