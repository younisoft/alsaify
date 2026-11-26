import { describe, it, expect } from 'vitest';
import {
  computeBatchTotals, journals, assertBalanced, accountMovements, profitAndLoss, cashFlow, fxConvert, withRunningBalance,
  agingBuckets, fifoAllocate, monthlyDepreciation, weightedAverageCost, creditExposure, reverseLines, acct,
  toMinor, fromMinor, percentOf, roundToPrecision, todayISO, isValidISODate, formatDate, normalizeYemeniPhone, can,
} from '../src';

const Y = (n: number) => toMinor(n);
const line = { categoryId: 'c1000', categoryName: 'فئة 1000', quantity: 500, unitPriceMinor: Y(1000) };

describe('Mandatory accounting tests (engine level)', () => {
  it('T1 batch: 500 × 1,000 @10% → 500,000 / 50,000 / 450,000', () => {
    const t = computeBatchTotals([line], 10, 0);
    expect([t.grossMinor, t.commissionMinor, t.netMinor].map(fromMinor)).toEqual([500000, 50000, 450000]);
  });
  it('T2 commission snapshot: totals depend only on the snapshot pct passed in', () => {
    const at10 = computeBatchTotals([line], 10, 0);
    const at12 = computeBatchTotals([line], 12, 0);
    expect(fromMinor(at10.commissionMinor)).toBe(50000);
    expect(fromMinor(at12.commissionMinor)).toBe(60000);
  });
  it('T3 payment: 450,000 receivable − 200,000 payment = 250,000', () => {
    const rows = withRunningBalance([{ date: '2026-11-01', debitMinor: Y(450000), creditMinor: 0 }, { date: '2026-11-02', debitMinor: 0, creditMinor: Y(200000) }]);
    expect(fromMinor(rows.at(-1)!.balanceMinor)).toBe(250000);
  });
  it('T4 open custody is not revenue: no journal exists for an open batch', () => {
    const pl = profitAndLoss([], '2026-01-01', '2026-12-31');
    expect(pl.grossCardRevenue).toBe(0);
  });
  it('T5 fx: 100 USD × 2,500 = 250,000 YER', () => {
    expect(fromMinor(fxConvert(Y(100), 'USD', 'YER', 2500, 0))).toBe(250000);
    expect(() => fxConvert(Y(100), 'YER', 'YER', 2, 0)).toThrow();
    expect(() => fxConvert(Y(100), 'USD', 'YER', 0, 0)).toThrow();
  });
  it('T6 cash: 100,000 + 50,000 − 20,000 = 130,000', () => {
    const e = [journals.cashOpening('A', Y(100000)), journals.receipt('D', 'A', Y(50000)), journals.expense('rent', 'A', Y(20000))].map((lines) => ({ date: '2026-11-01', lines }));
    expect(fromMinor(accountMovements(e)[acct.cash('A')])).toBe(130000);
  });
  it('T7 capital purchase 400,000: not an operating expense, but is investing cash out', () => {
    const lines = journals.purchase('capital', Y(400000), Y(400000), 'A', null);
    assertBalanced(lines);
    const pl = profitAndLoss([{ date: '2026-11-05', lines }]);
    expect(pl.operatingExpenses + pl.operationalPurchases).toBe(0);
    expect(pl.operatingProfit).toBe(0);
    const cf = cashFlow([{ date: '2026-11-05', direction: 'out', baseMinor: Y(400000), flowClass: 'investing', cashAccountId: 'A' }]);
    expect(fromMinor(cf.investingOut)).toBe(400000);
    expect(fromMinor(cf.netCashMovement)).toBe(-400000);
    expect(cf.netOperating).toBe(0);
  });
  it('T8 transfer 30,000: source −, destination +, no revenue/expense, no cash-flow effect', () => {
    const lines = journals.transfer('A', 'B', Y(30000));
    const m = accountMovements([{ date: '2026-11-01', lines }]);
    expect(fromMinor(m[acct.cash('A')])).toBe(-30000);
    expect(fromMinor(m[acct.cash('B')])).toBe(30000);
    expect(profitAndLoss([{ date: '2026-11-01', lines }]).operatingProfit).toBe(0);
    const cf = cashFlow([{ date: '2026-11-01', direction: 'out', baseMinor: Y(30000), flowClass: 'transfer', cashAccountId: 'A' }, { date: '2026-11-01', direction: 'in', baseMinor: Y(30000), flowClass: 'transfer', cashAccountId: 'B' }]);
    expect(cf.netCashMovement).toBe(0);
  });
});

describe('Engine invariants', () => {
  it('every journal builder is balanced', () => {
    const t = computeBatchTotals([line], 10, 0);
    const all = [
      journals.distributorOpening('D', Y(1000)), journals.distributorOpening('D', Y(-1000)), journals.batchFinalized('D', t),
      journals.receipt('D', 'A', Y(5)), journals.distributorAdjustment('D', Y(7)), journals.distributorAdjustment('D', Y(-7)),
      journals.expense('x', 'A', Y(9)), journals.purchase('operational', Y(100), Y(40), 'A', 'S'), journals.purchase('inventory', Y(100), 0, null, 'S'),
      journals.supplierPayment('S', 'A', Y(3)), journals.supplierOpening('S', Y(50)), journals.cashOpening('A', Y(1)), journals.transfer('A', 'B', Y(2)),
      journals.cashAdjustment('A', Y(-4)), journals.otherIncome('A', Y(1)), journals.depreciation(Y(1)), journals.inventoryIssue(Y(1)), journals.inventoryAdjustment(Y(-1)),
    ];
    for (const l of all) { assertBalanced(l); assertBalanced(reverseLines(l)); }
  });
  it('purchase on credit requires a supplier; paid part requires a cash account', () => {
    expect(() => journals.purchase('operational', Y(100), 0, null, null)).toThrow('SUPPLIER_REQUIRED_FOR_CREDIT');
    expect(() => journals.purchase('operational', Y(100), Y(100), null, null)).toThrow('CASH_ACCOUNT_REQUIRED');
  });
  it('rejects unbalanced or one-sided journals', () => {
    expect(() => assertBalanced([{ account: '1200', debit: 5, credit: 0 }])).toThrow();
    expect(() => assertBalanced([{ account: '9999', debit: 5, credit: 0 }, { account: '1200', debit: 0, credit: 5 }])).toThrow();
  });
  it('P&L: finalized batch + expense + operational purchase', () => {
    const t = computeBatchTotals([line], 10, 0);
    const pl = profitAndLoss([
      { date: '2026-11-03', lines: journals.batchFinalized('D', t) },
      { date: '2026-11-04', lines: journals.expense('rent', 'A', Y(30000)) },
      { date: '2026-11-04', lines: journals.purchase('operational', Y(20000), Y(20000), 'A', null) },
      { date: '2027-01-01', lines: journals.expense('rent', 'A', Y(99999)) },
    ], '2026-11-01', '2026-11-30');
    expect(fromMinor(pl.netRevenue)).toBe(450000);
    expect(fromMinor(pl.operatingProfit)).toBe(400000);
    expect(fromMinor(pl.expensesByCategory.rent)).toBe(30000);
  });
  it('rounding: per-line commission rounded to precision (half away from zero)', () => {
    expect(percentOf(Y(1005), 10, 0)).toBe(Y(101)); // 100.5 → 101
    expect(percentOf(Y(1005), 10, 2)).toBe(Y(100.5));
    expect(roundToPrecision(Y(2.5), 0)).toBe(Y(3));
    expect(toMinor('1,234.56')).toBe(123456);
  });
  it('FIFO allocation oldest first, remainder unallocated', () => {
    const r = fifoAllocate([{ id: 'b2', date: '2026-02-01', outstandingMinor: 100 }, { id: 'b1', date: '2026-01-01', outstandingMinor: 50 }], 120);
    expect(r.allocations).toEqual([{ id: 'b1', amountMinor: 50 }, { id: 'b2', amountMinor: 70 }]);
    expect(fifoAllocate([{ id: 'b1', date: '2026-01-01', outstandingMinor: 50 }], 80).unallocatedMinor).toBe(30);
  });
  it('aging buckets <7 | 7–15 | 16–30 | >30', () => {
    const b = agingBuckets([
      { id: '1', date: '2026-11-25', outstandingMinor: 1 }, { id: '2', date: '2026-11-19', outstandingMinor: 2 },
      { id: '3', date: '2026-11-01', outstandingMinor: 4 }, { id: '4', date: '2026-09-01', outstandingMinor: 8 },
    ], '2026-11-26', [7, 15, 30]);
    expect(b).toEqual([1, 2, 4, 8]);
  });
  it('depreciation is never invented', () => {
    expect(monthlyDepreciation(Y(1200), null, 12, 0)).toBe(0);
    expect(monthlyDepreciation(Y(1200), 0, undefined, 0)).toBe(0);
    expect(monthlyDepreciation(Y(1200), Y(0), 12, 0)).toBe(Y(100));
  });
  it('weighted average cost', () => {
    expect(weightedAverageCost(10, Y(100), 10, Y(200))).toBe(Y(150));
  });
  it('exposure basis', () => {
    expect(creditExposure(100, 50, 45, 'net')).toBe(145);
    expect(creditExposure(100, 50, 45, 'gross')).toBe(150);
  });
  it('dates in Asia/Aden', () => {
    expect(todayISO(new Date('2026-11-25T22:30:00Z'))).toBe('2026-11-26'); // 01:30 Aden
    expect(isValidISODate('2026-13-45')).toBe(false);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(formatDate('2026-11-05')).toBe('05/11/2026');
  });
  it('Yemeni phone normalisation', () => {
    expect(normalizeYemeniPhone('0733000003')?.international).toBe('967733000003');
    expect(normalizeYemeniPhone('+967 770 000 001')?.local).toBe('770000001');
    expect(normalizeYemeniPhone('12')).toBeNull();
  });
  it('permissions: owner all, suspended none, member only granted', () => {
    expect(can({ kind: 'owner', status: 'active', permissions: {} }, 'settings', 'manage')).toBe(true);
    expect(can({ kind: 'owner', status: 'suspended', permissions: {} }, 'settings', 'view')).toBe(false);
    expect(can({ kind: 'member', status: 'active', permissions: { tasks: ['view'] } }, 'tasks', 'view')).toBe(true);
    expect(can({ kind: 'member', status: 'active', permissions: { tasks: ['view'] } }, 'payments', 'view')).toBe(false);
    expect(can({ kind: 'portal', status: 'active', permissions: { payments: ['view'] } }, 'payments', 'view')).toBe(false);
  });
});
