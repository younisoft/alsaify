# Operations: environments, deployment, backup and recovery, migration

## 1. Environments
Use **three separate Firebase projects**: `darkcloud-dev`, `darkcloud-staging` and `darkcloud-prod` (names are your choice).
- Production must be on the **Blaze plan**. Cloud Functions, scheduled jobs and Storage backups require it.
- Local development and all automated tests use the **emulators**, with project id `demo-darkcloud`. A `demo-` project can't reach real services.
- Test helpers refuse to run without `FIRESTORE_EMULATOR_HOST`.

Don't reuse the old AI Studio project or its named database for the new system until the migration is approved. The new system defaults to the `(default)` database. Set `FIRESTORE_DATABASE_ID` (functions) and `VITE_FIRESTORE_DATABASE_ID` (web) to use a named database.

## 2. First deployment (per project)
```bash
cd dark-cloud && npm install
npx firebase login
npx firebase use --add                         # select the project, alias e.g. prod
# Firebase console: enable Authentication → Google provider; add your hosting domain to Authorized domains
# Create web/.env.production from web/.env.example with that project's web config (public identifiers)
npm run build -w functions && npm run build -w web
npx firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting
# One-time GM bootstrap with project-admin credentials (gcloud auth application-default login):
node scripts/bootstrap-owner.mjs --project <project-id> --email <the GM's real Google email> --name "المهندس توهيب السيفي"
```
Then:
1. The GM signs in. The account activates and default settings are created. **No demo data is created.**
2. The GM creates the main cash account in الصناديق, reviews الإعدادات (regions, categories, card prices, exchange rates), and invites Azzam, Al-Ashbat and Dahman with their real emails.

Optional function settings (`functions/.env.<project>`):
- `FUNCTIONS_REGION` (default `europe-west1`; the web app's `VITE_FUNCTIONS_REGION` must match);
- `ENFORCE_APP_CHECK=true`;
- `BACKUP_BUCKET`;
- `FIRESTORE_DATABASE_ID`.

## 3. Backup and recovery
| Layer | What | Status |
|---|---|---|
| Daily logical backup | `dailyBackup` at 02:30 Asia/Aden exports 35 collections to `gs://<bucket>/backups/<timestamp>.json`, **reads it back, verifies the SHA-256 and the counts**, and records the result in `backups` (visible in الإعدادات ← النسخ الاحتياطي) | Code complete. Export, verification and restore **tested on the emulator**. The Storage upload and the scheduler need a real project, so **not yet run** |
| Manual backup | «نسخ احتياطي الآن» (GM) calls the same code | Same as above |
| Point-in-time recovery | Enable Firestore PITR (7 days) in the console, or: `gcloud firestore databases update --database='(default)' --enable-pitr` | Configuration step for you |
| Managed export (recommended in addition) | `gcloud firestore export gs://<bucket>/managed/$(date +%F)` on a Cloud Scheduler job | Configuration step for you |

**Restore procedure (tested on the emulator):**
1. Create an **empty** recovery project or database. Never restore over live data.
2. Download the backup JSON.
3. Run `restoreDatabase`. It verifies the checksum and counts first and refuses a non-empty target. In the test suite it reproduced an identical checksum, and the restored books reconciled.
4. Run **سلامة الدفاتر** on the restored copy.
5. Switch the app (or export) only after the GM confirms.

A tampered or corrupted backup is detected and refused (tested).

## 4. Data migration from the legacy system
`npm run migrate:dryrun -- <xlsx> [outDir]` reads the workbook and writes `migration-plan.json` and `migration-report.md`. **It never writes to a database.** It:
- maps settings, distributors, deliveries (split into finalize-able batches), payments, expenses and purchases;
- converts fractional commissions to percentages;
- normalizes phones to the 967 format;
- detects duplicates, unknown codes, finished lines without a date, foreign amounts without a rate, and demo rows;
- recomputes each distributor's balance and exposure **with the new engine**. On the audited workbook it matches the Excel formulas exactly (D001: balance 15,000, exposure 132,000).

The current report (`docs/migration-dryrun/`) shows:
- **0 blocking errors** and **3 warnings**: all distributors are marked «(مثال)», i.e. demo data;
- **8 decisions** for management (regions, custody categories, payment allocation, receiving cash account, asset useful lives, batch splitting).

The uploaded workbook is a template with demo rows, **not** a production database. No real data has been migrated.

**Import procedure (once real data and decisions are available):**
1. Fix every error in the source and answer the decisions.
2. Run the import into **staging** through the server API, as the GM in a script, so every rule, journal and audit applies:
   - distributors with opening balances;
   - batches delivered and finalized on their historical dates;
   - receipts with the chosen allocation;
   - expenses and purchases.
3. Compare staging `reports.reconcile` and the per-distributor balances against the dry-run reconciliation table. Every figure must match.
4. GM sign-off. Repeat on production; take a backup immediately before the import.
5. Rollback: production starts empty. If anything fails, restore from the pre-import backup, or delete the project's data and repeat. Nothing is mixed with demo data.

The API import runner (step 2) is **not written yet**. It depends on the decisions above.
