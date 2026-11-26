/**
 * DARK-CLOUD accounting engine (pure, deterministic, no I/O).
 * Every screen, report and server service MUST use these functions — no formula
 * is re-implemented elsewhere. All amounts are integer minor units (see money.ts).
 */
import { applyRate, percentOf, roundHalfUp, type Minor } from './money';
import { daysBetween } from './dates';

// ---------------------------------------------------------------- Chart of accounts
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'contra_revenue' | 'expense';
export const ACCOUNTS: Record<string, { name: string; type: AccountType }> = {
  '1100': { name: 'الصناديق والحسابات النقدية', type: 'asset' },
  '1200': { name: 'ذمم الموزعين (مستحقات)', type: 'asset' },
  '1300': { name: 'المخزون الإداري', type: 'asset' },
  '1500': { name: 'الأصول الثابتة (التكلفة)', type: 'asset' },
  '1590': { name: 'مجمع الإهلاك', type: 'asset' },
  '2100': { name: 'ذمم الموردين (دائنون)', type: 'liability' },
  '3000': { name: 'حقوق الملكية / أرصدة افتتاحية', type: 'equity' },
  '4100': { name: 'إيراد الكروت المعتمدة (إجمالي)', type: 'revenue' },
  '4190': { name: 'عمولات الموزعين', type: 'contra_revenue' },
  '4195': { name: 'تسويات حسابات الموزعين', type: 'contra_revenue' },
  '4900': { name: 'إيرادات أخرى', type: 'revenue' },
  '5100': { name: 'المصروفات التشغيلية', type: 'expense' },
  '5200': { name: 'المشتريات التشغيلية المستهلكة', type: 'expense' },
  '5300': { name: 'مصروف الإهلاك', type: 'expense' },
  '5900': { name: 'فروقات وتالف المخزون', type: 'expense' },
  '5950': { name: 'عجز/زيادة الصناديق', type: 'expense' },
};
export const acct = {
  cash: (cashAccountId: string) => `1100:${cashAccountId}`,
  ar: '1200', inventory: '1300', fixedAssets: '1500', accDep: '1590', ap: '2100', equity: '3000',
  revenue: '4100', commission: '4190', distAdjust: '4195', otherIncome: '4900',
  opex: (categoryId: string) => `5100:${categoryId}`,
  opPurchases: '5200', depreciation: '5300', inventoryLoss: '5900', cashOverShort: '5950',
};
export const baseAccount = (code: string) => code.split(':')[0];

export interface Party { type: 'distributor' | 'supplier'; id: string }
export interface JournalLine { account: string; debit: Minor; credit: Minor; party?: Party }

export function assertBalanced(lines: JournalLine[]): void {
  if (!lines.length) throw new Error('JOURNAL_EMPTY');
  let d = 0, c = 0;
  for (const l of lines) {
    if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit) || l.debit < 0 || l.credit < 0) throw new Error('JOURNAL_BAD_LINE');
    if ((l.debit > 0) === (l.credit > 0)) throw new Error('JOURNAL_ONE_SIDE');
    if (!ACCOUNTS[baseAccount(l.account)]) throw new Error('JOURNAL_UNKNOWN_ACCOUNT:' + l.account);
    d += l.debit; c += l.credit;
  }
  if (d !== c) throw new Error(`JOURNAL_UNBALANCED:${d}!=${c}`);
}

const dr = (account: string, amount: Minor, party?: Party): JournalLine => ({ account, debit: amount, credit: 0, ...(party ? { party } : {}) });
const cr = (account: string, amount: Minor, party?: Party): JournalLine => ({ account, debit: 0, credit: amount, ...(party ? { party } : {}) });
/** Signed helper: positive → debit, negative → credit. */
const signed = (account: string, amount: Minor, party?: Party) => (amount >= 0 ? dr(account, amount, party) : cr(account, -amount, party));
const nz = (lines: JournalLine[]) => lines.filter((l) => l.debit > 0 || l.credit > 0);

export function reverseLines(lines: JournalLine[]): JournalLine[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

// ---------------------------------------------------------------- Batches
export interface BatchLineInput { categoryId: string; categoryName: string; quantity: number; unitPriceMinor: Minor }
export interface BatchLineTotals extends BatchLineInput { grossMinor: Minor; commissionMinor: Minor; netMinor: Minor }
export interface BatchTotals { lines: BatchLineTotals[]; grossMinor: Minor; commissionMinor: Minor; netMinor: Minor; commissionPct: number }

/**
 * Gross = Quantity × Unit price; Commission = Gross × pct / 100 (rounded per line to the
 * configured precision, as the original Excel did with ROUND(..,0)); Net = Gross − Commission.
 */
export function computeBatchTotals(lines: BatchLineInput[], commissionPct: number, precision: number): BatchTotals {
  if (!(commissionPct >= 0 && commissionPct <= 100)) throw new Error('INVALID_COMMISSION');
  if (!lines.length) throw new Error('BATCH_NO_LINES');
  const out = lines.map((l) => {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new Error('INVALID_QUANTITY');
    if (!Number.isSafeInteger(l.unitPriceMinor) || l.unitPriceMinor <= 0) throw new Error('INVALID_UNIT_PRICE');
    const grossMinor = l.quantity * l.unitPriceMinor;
    const commissionMinor = percentOf(grossMinor, commissionPct, precision);
    return { ...l, grossMinor, commissionMinor, netMinor: grossMinor - commissionMinor };
  });
  const s = (k: 'grossMinor' | 'commissionMinor' | 'netMinor') => out.reduce((a, l) => a + l[k], 0);
  return { lines: out, grossMinor: s('grossMinor'), commissionMinor: s('commissionMinor'), netMinor: s('netMinor'), commissionPct };
}

// ---------------------------------------------------------------- Currency
export interface FxSnapshot { currency: string; originalMinor: Minor; rate: number; rateDate: string; rateSource: string; baseMinor: Minor }

/** Original × rate = base equivalent. Base currency must use rate 1. */
export function fxConvert(originalMinor: Minor, currency: string, baseCurrency: string, rate: number, precision: number): Minor {
  if (!Number.isSafeInteger(originalMinor)) throw new Error('INVALID_AMOUNT');
  if (currency === baseCurrency) {
    if (rate !== 1) throw new Error('BASE_RATE_MUST_BE_1');
    return originalMinor;
  }
  return applyRate(originalMinor, rate, precision);
}

// ---------------------------------------------------------------- Journal builders
const D = (id: string): Party => ({ type: 'distributor', id });
const S = (id: string): Party => ({ type: 'supplier', id });

export const journals = {
  /** Positive = distributor owes us. */
  distributorOpening: (distributorId: string, amount: Minor) =>
    nz([signed(acct.ar, amount, D(distributorId)), signed(acct.equity, -amount)]),
  batchFinalized: (distributorId: string, t: { grossMinor: Minor; commissionMinor: Minor; netMinor: Minor }) =>
    nz([dr(acct.ar, t.netMinor, D(distributorId)), dr(acct.commission, t.commissionMinor), cr(acct.revenue, t.grossMinor)]),
  receipt: (distributorId: string, cashAccountId: string, baseMinor: Minor) =>
    [dr(acct.cash(cashAccountId), baseMinor), cr(acct.ar, baseMinor, D(distributorId))],
  /** Positive = debit adjustment (increase what distributor owes); negative = credit note. */
  distributorAdjustment: (distributorId: string, amount: Minor) =>
    nz([signed(acct.ar, amount, D(distributorId)), signed(acct.distAdjust, -amount)]),
  expense: (categoryId: string, cashAccountId: string, baseMinor: Minor) =>
    [dr(acct.opex(categoryId), baseMinor), cr(acct.cash(cashAccountId), baseMinor)],
  /**
   * Purchase: debit side depends on classification; paid part credits cash, unpaid part credits supplier.
   * debitTarget: 'capital' → fixed assets; 'inventory' → inventory (expensed only when issued);
   * 'operational' → operational purchases expense. One purchase is posted once — never also as an expense.
   */
  purchase: (debitTarget: 'capital' | 'inventory' | 'operational', totalMinor: Minor, paidMinor: Minor, cashAccountId: string | null, supplierId: string | null) => {
    const account = debitTarget === 'capital' ? acct.fixedAssets : debitTarget === 'inventory' ? acct.inventory : acct.opPurchases;
    const unpaid = totalMinor - paidMinor;
    if (paidMinor < 0 || unpaid < 0) throw new Error('INVALID_PAID_AMOUNT');
    if (paidMinor > 0 && !cashAccountId) throw new Error('CASH_ACCOUNT_REQUIRED');
    if (unpaid > 0 && !supplierId) throw new Error('SUPPLIER_REQUIRED_FOR_CREDIT');
    return nz([dr(account, totalMinor), cr(acct.cash(cashAccountId || '-'), paidMinor), cr(acct.ap, unpaid, supplierId ? S(supplierId) : undefined)]);
  },
  /** Purchase split across debit targets (an operational purchase may hold stock lines and consumables). */
  purchaseSplit: (parts: { capital: Minor; inventory: Minor; operational: Minor }, paidMinor: Minor, cashAccountId: string | null, supplierId: string | null) => {
    const total = parts.capital + parts.inventory + parts.operational;
    const unpaid = total - paidMinor;
    if (paidMinor < 0 || unpaid < 0) throw new Error('INVALID_PAID_AMOUNT');
    if (paidMinor > 0 && !cashAccountId) throw new Error('CASH_ACCOUNT_REQUIRED');
    if (unpaid > 0 && !supplierId) throw new Error('SUPPLIER_REQUIRED_FOR_CREDIT');
    return nz([dr(acct.fixedAssets, parts.capital), dr(acct.inventory, parts.inventory), dr(acct.opPurchases, parts.operational),
      cr(acct.cash(cashAccountId || '-'), paidMinor), cr(acct.ap, unpaid, supplierId ? S(supplierId) : undefined)]);
  },
  ownerCapital: (cashAccountId: string, baseMinor: Minor) => [dr(acct.cash(cashAccountId), baseMinor), cr(acct.equity, baseMinor)],
  ownerWithdrawal: (cashAccountId: string, baseMinor: Minor) => [dr(acct.equity, baseMinor), cr(acct.cash(cashAccountId), baseMinor)],
  supplierPayment: (supplierId: string, cashAccountId: string, baseMinor: Minor) =>
    [dr(acct.ap, baseMinor, S(supplierId)), cr(acct.cash(cashAccountId), baseMinor)],
  /** Positive = we owe supplier. */
  supplierOpening: (supplierId: string, amount: Minor) => nz([signed(acct.ap, -amount, S(supplierId)), signed(acct.equity, amount)]),
  cashOpening: (cashAccountId: string, baseMinor: Minor) => nz([signed(acct.cash(cashAccountId), baseMinor), signed(acct.equity, -baseMinor)]),
  transfer: (fromId: string, toId: string, baseMinor: Minor) => [dr(acct.cash(toId), baseMinor), cr(acct.cash(fromId), baseMinor)],
  /** Positive delta = cash found over book (gain); negative = shortage. */
  cashAdjustment: (cashAccountId: string, deltaMinor: Minor) => nz([signed(acct.cash(cashAccountId), deltaMinor), signed(acct.cashOverShort, -deltaMinor)]),
  otherIncome: (cashAccountId: string, baseMinor: Minor) => [dr(acct.cash(cashAccountId), baseMinor), cr(acct.otherIncome, baseMinor)],
  depreciation: (baseMinor: Minor) => [dr(acct.depreciation, baseMinor), cr(acct.accDep, baseMinor)],
  inventoryIssue: (costMinor: Minor) => nz([dr(acct.opPurchases, costMinor), cr(acct.inventory, costMinor)]),
  /** Positive = gain (stock found), negative = loss/damage. */
  inventoryAdjustment: (deltaMinor: Minor) => nz([signed(acct.inventory, deltaMinor), signed(acct.inventoryLoss, -deltaMinor)]),
};

// ---------------------------------------------------------------- Reports (pure aggregations)
export interface PostedEntry { date: string; lines: JournalLine[]; status?: 'posted' | 'reversed' }

const inRange = (d: string, from?: string, to?: string) => (!from || d >= from) && (!to || d <= to);

/** Net debit-minus-credit per account base over a date range. */
export function accountMovements(entries: PostedEntry[], from?: string, to?: string): Record<string, Minor> {
  const m: Record<string, Minor> = {};
  for (const e of entries) {
    if (!inRange(e.date, from, to)) continue;
    for (const l of e.lines) m[l.account] = (m[l.account] || 0) + l.debit - l.credit;
  }
  return m;
}

export interface ProfitReport {
  grossCardRevenue: Minor; commissions: Minor; distributorAdjustments: Minor; netRevenue: Minor; otherIncome: Minor;
  operatingExpenses: Minor; expensesByCategory: Record<string, Minor>; operationalPurchases: Minor; inventoryLosses: Minor; cashOverShort: Minor;
  operatingProfitBeforeDepreciation: Minor; depreciation: Minor; operatingProfit: Minor;
}

/** Accrual P&L from journal entries. Capital purchases never appear here (they sit in 1500). */
export function profitAndLoss(entries: PostedEntry[], from?: string, to?: string): ProfitReport {
  const m = accountMovements(entries, from, to);
  let opex = 0; const byCat: Record<string, Minor> = {};
  const sumBase = (b: string) => Object.entries(m).filter(([k]) => baseAccount(k) === b).reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of Object.entries(m)) if (baseAccount(k) === '5100') { opex += v; byCat[k.split(':')[1]] = (byCat[k.split(':')[1]] || 0) + v; }
  const grossCardRevenue = -sumBase('4100');
  const commissions = sumBase('4190');
  const distributorAdjustments = -sumBase('4195');
  const netRevenue = grossCardRevenue - commissions + distributorAdjustments;
  const otherIncome = -sumBase('4900');
  const operationalPurchases = sumBase('5200');
  const inventoryLosses = sumBase('5900');
  const cashOverShort = sumBase('5950');
  const before = netRevenue + otherIncome - opex - operationalPurchases - inventoryLosses - cashOverShort;
  const depreciation = sumBase('5300');
  const z = (x: number) => x + 0; // normalise -0
  return normalizeZeros({ grossCardRevenue, commissions, distributorAdjustments, netRevenue, otherIncome, operatingExpenses: opex, expensesByCategory: byCat,
    operationalPurchases, inventoryLosses, cashOverShort, operatingProfitBeforeDepreciation: before, depreciation, operatingProfit: z(before - depreciation) });
}

function normalizeZeros<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (typeof o[k] === 'number') (o as Record<keyof T, unknown>)[k] = (o[k] as number) + 0;
  return o;
}

export type CashFlowClass = 'operating' | 'investing' | 'financing' | 'transfer' | 'opening';
export interface CashMovement { date: string; direction: 'in' | 'out'; baseMinor: Minor; flowClass: CashFlowClass; cashAccountId: string }
export interface CashFlowReport { operatingIn: Minor; operatingOut: Minor; netOperating: Minor; investingIn: Minor; investingOut: Minor; financingIn: Minor; financingOut: Minor; netCashMovement: Minor }

/** Actual cash only. Internal transfers are excluded from every total. */
export function cashFlow(moves: CashMovement[], from?: string, to?: string): CashFlowReport {
  const r = { operatingIn: 0, operatingOut: 0, investingIn: 0, investingOut: 0, financingIn: 0, financingOut: 0 };
  for (const mv of moves) {
    if (!inRange(mv.date, from, to) || mv.flowClass === 'transfer' || mv.flowClass === 'opening') continue;
    const key = `${mv.flowClass}${mv.direction === 'in' ? 'In' : 'Out'}` as keyof typeof r;
    r[key] += mv.baseMinor;
  }
  return normalizeZeros({ ...r, netOperating: r.operatingIn - r.operatingOut,
    netCashMovement: r.operatingIn + r.investingIn + r.financingIn - r.operatingOut - r.investingOut - r.financingOut });
}

export interface LedgerRow { date: string; seq?: number; debitMinor: Minor; creditMinor: Minor }
export function withRunningBalance<T extends LedgerRow>(rows: T[], opening: Minor = 0): (T & { balanceMinor: Minor })[] {
  let b = opening;
  return [...rows]
    .sort((a, b2) => (a.date === b2.date ? (a.seq ?? 0) - (b2.seq ?? 0) : a.date < b2.date ? -1 : 1))
    .map((r) => { b += r.debitMinor - r.creditMinor; return { ...r, balanceMinor: b }; });
}

/** Credit exposure = ledger balance + open custody (gross or net per policy). */
export function creditExposure(ledgerBalance: Minor, custodyGross: Minor, custodyNet: Minor, basis: 'gross' | 'net'): Minor {
  return ledgerBalance + (basis === 'gross' ? custodyGross : custodyNet);
}

export interface AgingItem { id: string; date: string; outstandingMinor: Minor }
/** bounds [7,15,30] → buckets: <7 | 7–15 | 16–30 | >30 days. */
export function agingBuckets(items: AgingItem[], asOf: string, bounds: [number, number, number]): Minor[] {
  const b = [0, 0, 0, 0];
  for (const it of items) {
    if (it.outstandingMinor <= 0) continue;
    const age = daysBetween(it.date, asOf);
    const i = age < bounds[0] ? 0 : age <= bounds[1] ? 1 : age <= bounds[2] ? 2 : 3;
    b[i] += it.outstandingMinor;
  }
  return b;
}
export function agingLabels(bounds: [number, number, number]): string[] {
  return [`أقل من ${bounds[0]} أيام`, `${bounds[0]}–${bounds[1]} يوم`, `${bounds[1] + 1}–${bounds[2]} يوم`, `أكثر من ${bounds[2]} يوم`];
}

/** FIFO: oldest open item first. Returns allocations and the unallocated remainder. */
export function fifoAllocate(openItems: AgingItem[], amount: Minor): { allocations: { id: string; amountMinor: Minor }[]; unallocatedMinor: Minor } {
  let left = amount; const allocations: { id: string; amountMinor: Minor }[] = [];
  for (const it of [...openItems].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1))) {
    if (left <= 0) break;
    const take = Math.min(left, it.outstandingMinor);
    if (take > 0) { allocations.push({ id: it.id, amountMinor: take }); left -= take; }
  }
  return { allocations, unallocatedMinor: left };
}

/** Straight-line monthly depreciation. Returns 0 when policy fields are missing (never invented). */
export function monthlyDepreciation(costMinor: Minor, residualMinor: Minor | null | undefined, usefulLifeMonths: number | null | undefined, precision: number): Minor {
  if (!usefulLifeMonths || usefulLifeMonths <= 0 || residualMinor == null) return 0;
  const base = costMinor - residualMinor;
  if (base <= 0) return 0;
  const unit = 10 ** (2 - precision);
  return roundHalfUp(base / usefulLifeMonths / unit) * unit;
}

/** Weighted average cost after receiving qty at unitCost. */
export function weightedAverageCost(qtyOnHand: number, avgCostMinor: Minor, qtyIn: number, unitCostMinor: Minor): Minor {
  const q = qtyOnHand + qtyIn;
  if (q <= 0) return unitCostMinor;
  return roundHalfUp((Math.max(qtyOnHand, 0) * avgCostMinor + qtyIn * unitCostMinor) / q);
}
