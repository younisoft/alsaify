# Implementation status (honest)

Legend:
- ✅ implemented and covered by automated tests
- 🟢 implemented and exercised end-to-end in the browser
- 🟡 implemented, not yet covered by an automated test
- ⚙ needs external configuration or a real project
- ⛔ not implemented

## Test results
Last run: 2026-11-26, all on local emulators. No real project was touched.

| Suite | Command | Result |
|---|---|---|
| Accounting engine (pure) | `npm run test:unit` | **21 / 21 passed** |
| Server business tests: mandatory T1–T8 + lifecycle, integrity, duplicates | `functions/test/business.test.ts` | **23 / 23 passed** |
| Security and roles (GM, Azzam, Al-Ashbat, Dahman, portal, suspended, uninvited, unverified, self-approval) | `functions/test/security.test.ts` | **13 / 13 passed** |
| Firestore rules: re-run of the Phase-1 scenarios + portal isolation + personal data | `functions/test/rules.test.ts` | **34 / 34 passed** |
| Backup export / verify / tamper-detect / restore + daily alert scan | `functions/test/backup.test.ts` | **4 / 4 passed** |
| Browser E2E (desktop 1440px + iPhone 13), real UI → real API → emulators | `web/e2e/e2e.mjs` | **19 / 19 passed, 0 console errors** |
| Type check (shared, functions, web) and production build | `tsc`, `vite build` | Pass |
| **Android / PWA audit** (Pixel 7 emulation): Chrome installability API, manifest, service worker, 21 routes × (no horizontal scroll, touch targets), dialogs, offline launch / reconnect, no sensitive caching | `web/e2e/android.mjs` | **54 / 54 passed** (2026-11-26) |
| Migration dry-run on the audited workbook | `npm run migrate:dryrun` | 0 errors, 3 warnings, 8 decisions; balances match the Excel formulas |

Mandatory accounting acceptance tests, each run through the real server API:
- T1 batch 500 × 1,000 @10% → 500,000 / 50,000 / 450,000 ✅
- T2 default changed to 12%: the old batch stays at 10% ✅
- T3 450,000 − 200,000 = 250,000 ✅
- T4 open batch of 300,000 is custody, not a receivable or revenue ✅
- T5 100 USD × 2,500 = 250,000 YER, unchanged after the rate changes to 3,000 ✅
- T6 100,000 + 50,000 − 20,000 = 130,000, with before/after balance per line ✅
- T7 capital purchase of 400,000: no operating expense, investing cash out, asset registered ✅
- T8 transfer of 30,000: −30,000 / +30,000, no P&L effect, excluded from cash flow ✅

Bugs found by the tests and fixed:
1. A GM credit-limit override inside the same transaction that created the batch failed. Fixed with a per-transaction cache of new batches.
2. The callable SDK sent absent optional fields as `null`, which the server rejected with an English message. Fixed on both sides, and validation messages are now always Arabic.
3. Form labels wrapped their controls, so a select's accessible name included its current option (bad for screen readers). Fixed with explicit `htmlFor`/`id` and `aria-describedby`.

## Module status
| Module | Status | Notes |
|---|---|---|
| Authentication (Google), invitations, no public registration | ✅🟢 | Uninvited and unverified accounts refused and logged |
| Permission matrix (17 modules × 8 actions), server enforcement | ✅🟢 | Live profile listener: changes and suspensions apply without re-login |
| Approval workflow, separation of duties | ✅ | 10 approval types; UI page 🟡 (not in E2E) |
| Audit log (protected) | ✅ | Before/after values, reason, requestId; viewer page 🟡 |
| Central settings (company, finance, lists, rates, system) | ✅ | Finance section GM-only; settings UI 🟡 |
| Accounting periods (close / reopen) | ✅ | |
| Distributors (auto code, 967 phones, terms, status, profile with 8 tabs) | ✅🟢 | |
| Batches: draft → open → finalized / returned / cancelled; commission snapshot; credit policy | ✅🟢 | Partial settlement of a batch ⛔ (needs a policy decision) |
| Payments: multi-currency, cash account, FIFO / manual / none allocation, reallocation, cancellation by reversal | ✅🟢 | |
| Distributor statement (running balance), WhatsApp composer with review, print / PDF | ✅🟢 | PDF is produced by the browser's «Save as PDF» (no server PDF engine) |
| Aging report (configurable buckets) | ✅ | |
| Collection follow-up | 🟡 | Implemented, not in automated tests |
| Expenses (FX, cash account, asset maintenance link, cancellation) | ✅🟢 | Cancellation path 🟡 |
| Purchases (operational / capital, stock lines, approval = receipt, partial payment) | ✅ | Approved-purchase cancellation 🟡 |
| Suppliers (ledger, payments, statement) | ✅ | Supplier-payment cancellation 🟡 |
| Inventory (warehouses, receipt via purchase, issue at average cost, count / damage via approval) | ✅ | Transfer and return moves 🟡 |
| Fixed assets (register, straight-line depreciation only with an explicit policy, idempotent monthly run) | ✅ | |
| Cash and treasury (accounts per currency, transfers, vouchers, reconciliation with approval, statement) | ✅🟢 | Cross-currency transfer ⛔ (by design for now) |
| Double-entry journal + sub-ledger reconciliation + trial balance | ✅🟢 | |
| Executive dashboard (financial, distribution, management KPIs; 6 charts; 7 date presets) | 🟢 | |
| Reports: monthly / annual with YoY, P&L with prior period, cash flow, aging, custody / receivables, integrity, 15-report catalog; XLSX / CSV / print on every table | 🟢 | |
| Tasks (assignment, statuses, comments, attachments) | 🟡 | |
| Document archive (Storage, type / size / permission checks) | 🟡⚙ | Rules written; upload not yet in an automated test |
| Notifications (approval, credit limit, security, low stock, overdue tasks / receivables / supplier invoices, batches awaiting finalization, follow-ups, expenses without documents) | ✅ | Logic tested; daily schedule ⚙ (runs on deploy). No push or email |
| Distributor portal (optional, isolated) | ✅ | Portal page 🟡 (API and rules tested) |
| Backup and recovery | ✅⚙ | Export / verify / restore tested on the emulator; Storage upload and scheduler need a real project |
| Data migration | 🟡 | Dry-run complete and verified; API import runner ⛔ (waits for your decisions) |
| Mobile UI (bottom nav, drawer, card lists, bottom-sheet dialogs, no horizontal scroll) | 🟢 | |
| PWA / Android install (manifest, icons, safe service worker, update prompt, offline/sync states) | ✅🟢 | Verified locally; see [ANDROID.md](ANDROID.md) |
| Staging deployment | ⚙ | `scripts/deploy-staging.sh` ready (guarded). **Not deployed**: no staging project or credentials available |
| Production deployment | ⚙ | Not deployed: needs your Firebase project on the Blaze plan and credentials |

## What I need from you
1. **A Firebase project on the Blaze plan** for staging and production, plus who should hold deploy rights. Then the real emails of the GM, Azzam, Al-Ashbat and Dahman. I won't invent them.
2. **The policy decisions** in [ACCOUNTING.md §6](ACCOUNTING.md#6-policies--implemented-defaults-and-decisions-still-needed) and the 8 decisions in the [migration report](migration-dryrun/migration-report.md).
3. **Real legacy data**, if any exists beyond the template workbook (which contains only demo rows).

## Known limitations
- Lists load the most recent 1,000 records and reports read the requested date range. That's fine for years of normal volume. Very large volumes would call for aggregate documents (listed as future work).
- `exceljs` adds about 256 kB gzipped, loaded only when exporting.
- The Firestore emulator doesn't enforce composite indexes. They are declared in `firestore.indexes.json` and must deploy before first use.
- Accessibility: labels, focus rings, `aria-live` toasts and keyboard-closable dialogs are in place. A full screen-reader audit has not been done.
