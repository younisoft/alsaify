# Accounting engine

All formulas live in **`shared/src/accounting.ts`** (pure functions, no I/O). The server services and the UI previews both call this one module. No screen re-implements a formula.

## 1. Money and rounding
- Every amount is stored as an **integer in minor units** (1/100 of the currency) in `shared/src/money.ts`, so sums never drift.
- Display precision is configurable (`finance.precision`, default **0** for YER).
- Rounding is **half away from zero**:
  - commissions are rounded **per batch line**, as the Excel `ROUND(x,0)` did;
  - FX equivalents are rounded at the transaction.
- Commission rates are stored as **percent** (10 = 10%). The Excel workbook stored fractions (0.1); the migration converts them.

## 2. The four concepts that are never mixed

| Concept | Where it lives | Enters profit? | Enters cash? |
|---|---|---|---|
| **Open custody** (عهدة مفتوحة): delivered, not finalized | `batches.status='open'`, `distributors.bal.custodyGross/Net` | No | No |
| **Finalized receivable**: batch finalized by an authorized user | Journal Dr AR (1200) · Cr revenue (4100) · Dr commission (4190); `distributor_ledger` | Yes (accrual, on the finalization date) | No |
| **Collection**: receipt voucher | Journal Dr cash (1100:acct) · Cr AR; `cash_transactions` | No | Yes (operating in) |
| **Capital purchase** | Dr fixed assets (1500) | No (depreciation only, if a policy is set) | Yes (investing out, if paid) |

Expiry of cards **never** finalizes a batch. Finalization is an explicit action that needs `batches.approve`.

## 3. Formulas

| Quantity | Formula | Source |
|---|---|---|
| Gross | Quantity × Unit price | `computeBatchTotals` |
| Commission | Gross × pct / 100, rounded per line | `computeBatchTotals`, `percentOf` |
| Net payable | Gross − Commission | `computeBatchTotals` |
| Distributor balance | Opening + finalized net + debit adjustments − receipts − credit notes (± reversals) | `distributor_ledger` running balance (`withRunningBalance`) |
| Credit exposure | Balance + open custody (**net** by default, as in Excel; **gross** configurable) | `creditExposure` |
| Aging | Outstanding of each finalized batch (from finalization date) and debit charge, in buckets `<7 / 7–15 / 16–30 / >30` days (configurable) | `agingBuckets` |
| FX | Original × rate = YER equivalent; rate, rate date and rate source snapshotted on the document | `fxConvert`, `Tx.fx` |
| Net revenue | Gross card revenue − commissions ± distributor adjustments | `profitAndLoss` |
| Operating profit | Net revenue + other income − operating expenses − operational purchases consumed − inventory losses − cash shortages; shown **before and after depreciation** | `profitAndLoss` |
| Net operating cash flow | Operating cash in − operating cash out | `cashFlow` |
| Net cash movement | All actual receipts − all actual payments, **including capital purchases**; internal transfers and opening balances excluded | `cashFlow` |
| Cash balance | Opening + receipts − payments, per account and currency; transfers move between accounts | `cash_accounts.balanceMinor` + `cash_transactions` |
| Depreciation | Straight line (cost − residual) / useful-life months, only when both are set; never invented | `monthlyDepreciation` |
| Inventory cost | Weighted average; issues are expensed at average cost | `weightedAverageCost` |

## 4. Chart of accounts and postings

`1100:{cashAccountId}` cash/bank/wallet · `1200` distributor receivables · `1300` inventory · `1500` fixed assets · `1590` accumulated depreciation · `2100` supplier payables · `3000` equity / opening balances · `4100` card revenue (gross) · `4190` distributor commissions · `4195` distributor adjustments · `4900` other income · `5100:{category}` operating expenses · `5200` operational purchases consumed · `5300` depreciation · `5900` inventory differences · `5950` cash over/short.

| Operation | Debit | Credit |
|---|---|---|
| Distributor opening balance (+) | 1200 | 3000 |
| Batch delivered | — (custody only, no journal) | — |
| Batch finalized | 1200 net · 4190 commission | 4100 gross |
| Receipt | 1100:acct | 1200 |
| Debit / credit adjustment (approval) | 1200 / 4195 | 4195 / 1200 |
| Expense | 5100:cat | 1100:acct |
| Purchase (approved = received) | 1500 (capital) or 1300 (stock lines) or 5200 (consumables) | 1100 (paid part) + 2100 (unpaid part) |
| Supplier payment | 2100 | 1100 |
| Internal transfer | 1100:to | 1100:from |
| Cash count difference (approval) | 1100 / 5950 | 5950 / 1100 |
| Owner capital / withdrawal | 1100 / 3000 | 3000 / 1100 |
| Stock issue | 5200 | 1300 |
| Stock count / damage (approval) | 1300 / 5900 | 5900 / 1300 |
| Depreciation run | 5300 | 1590 |
| Any cancellation | exact **reversal** of the original entry, dated in the open period; the original is never deleted |

Every entry is checked by `assertBalanced` (debits = credits, one side per line, known accounts) before it is written. A purchase is posted **once**: never as both an expense and a purchase.

## 5. Integrity guarantees (server)
- **One transaction per operation**: document + journal + sub-ledger + cash movement + balances + allocations + audit log all commit together or not at all (`functions/src/core/tx.ts`).
- **Idempotency**: every call carries a `requestId`. A replay returns the first result and writes nothing.
- **Sequential numbers** from transactional counters: D0001, R-000001, E-, P-, SP-, TR-, CN-, A0001, I0001, batch numbers.
- **Historical integrity**: commission %, unit price, FX rate and category name are snapshotted on each document. Settings changes never rewrite history (tested: T2, T5).
- **Accounting periods** can be closed by the GM, after which posting into them is rejected.
- **`reports.reconcile`** proves:
  - trial balance debits = credits;
  - per distributor, journal AR = ledger = balance document, and custody and unallocated amounts match;
  - suppliers and cash accounts match likewise;
  - allocations match.

  The UI shows this under التقارير ← سلامة الدفاتر.

## 6. Policies — implemented defaults and decisions still needed

| Policy | Default implemented | Configurable? | Needs your confirmation |
|---|---|---|---|
| Commission frozen at batch creation | Yes, always | — | Recommended; confirm |
| Revenue recognition | On **finalization date** | — | Confirm |
| Commission presentation | Contra-revenue (net revenue) | — | Confirm |
| Credit limit | **Warn** | `warn` / `block` (block → approval) | Choose |
| Exposure basis | Net custody (as in Excel) | net / gross | Choose |
| Payment allocation | FIFO, manual or none, chosen per receipt | Per receipt | Choose the default for migrated vouchers |
| GM/technician custody spending | Recorded as operating expenses **or** owner withdrawals (cash voucher) | Per entry | Decide per legacy category (see migration report) |
| Depreciation | Only when useful life and residual are entered | Per asset | Provide values per asset |
| Depreciation in operating profit | Shown both before and after | — | Choose the headline |
| Cancelling an approved paid purchase | Full reversal; the paid amount is assumed refunded to the same cash account | — | Confirm |
| Partial batch settlement (part of a batch sold) | **Not implemented** (lifecycle is per batch; split batches instead) | — | Decide whether needed |
| Cross-currency internal transfers | Not allowed (same currency only) | — | Decide whether needed |
| Negative cash balances | Rejected (except reversals) | — | Confirm |

## 7. Requirements mapping (legacy → new)

| Legacy source | Item | New location | Status |
|---|---|---|---|
| Excel `الموزعون` I/J | Effective rate / limit (special or default) | `distributors.commissionPct ?? settings default` at batch creation; `creditLimitMinor ?? default` | Preserved; **corrected**: the rate is snapshotted, not live |
| Excel `تسليم الكروت` J/L/M | Value, commission ROUND(...,0), net | `computeBatchTotals` (per-line rounding) | Preserved; tested T1 |
| Excel `الموزعون` K | Open custody (gross) | `bal.custodyGross` | Preserved |
| Excel `الموزعون` N | Balance = opening + finished net − paid | `distributor_ledger` / `bal.ledger` | Preserved; migration parity verified |
| Excel `الموزعون` O | Exposure = balance + net custody | `creditExposure(..., 'net')` | Preserved (basis now configurable) |
| Excel `الموزعون` P | Alert text | Dashboard, notifications, block/approval policy | **Redesigned** (can enforce) |
| Excel `الموزعون` Q | 967 WhatsApp format | `normalizeYemeniPhone` | Preserved, with validation |
| Excel `المصروفات` H | FX: blank rate → ×1 | `Tx.fx`: explicit or recorded rate **required** | **Corrected** (old silent understatement) |
| Excel monthly | Month key from finish date | Journal date = finalization date | Preserved; **corrected**: finished-without-date is impossible |
| Excel monthly J | "Net cash" = collected − expenses − operational purchases | `cashFlow`: includes capital purchases; transfers excluded | **Corrected** |
| Excel monthly I | Profit = net revenue − expenses − operational purchases | `profitAndLoss` | Preserved (+ depreciation line, other income) |
| Excel `كشف حساب` | Statement + WhatsApp text | `reports.distributorStatement`, print page, reviewed WhatsApp composer | Preserved + running balance |
| Old `firestore.rules` | Role checks, verified email, schema validation | New rules: read-only clients; all validation server-side | **Redesigned** (closes all 🔴 cases from the audit) |
| Old App.tsx | Auto demo seed on owner login | Removed. Production starts clean; demo data only in emulator tests | **Removed** (audit finding C1) |
