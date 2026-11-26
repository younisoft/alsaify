import { describe, it, expect, beforeAll } from 'vitest';
import { testDb, resetDb, IDS, call, bootstrapOwner, Y, get } from './helpers';
import { reconcile } from '../src/services/reports';

const db = testDb();
const O = IDS.owner;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aden' }).format(new Date());
let main = '', t6 = '', usd = '', distA = '', b1 = '', b2 = '';

beforeAll(async () => {
  await resetDb();
  await bootstrapOwner(db);
  main = (await call(db, O, 'cash.createAccount', { name: 'الصندوق الرئيسي', type: 'cash', currency: 'YER', openingBalance: 0, openingDate: today })).id;
  await call(db, O, 'cash.other', { accountId: main, kind: 'owner_capital', amount: 2_000_000, date: today, description: 'رأس مال تشغيلي (اختبار)' });
});

describe('Mandatory accounting acceptance tests (end-to-end through the server API)', () => {
  it('settings start clean: defaults only, no demo records', async () => {
    const s = await get(db, 'settings', 'main');
    expect(s.finance.defaultCommissionPct).toBe(10);
    expect(Y(s.finance.defaultCreditLimitMinor)).toBe(500000);
    expect((await db.collection('distributors').get()).size).toBe(0);
  });

  it('T1 batch calculation: 500 × 1,000 @10% = 500,000 / 50,000 / 450,000', async () => {
    distA = (await call(db, O, 'distributors.create', { name: 'موزع اختبار أ', region: 'المدينة', phone: '770000001', startDate: today, creditLimit: 5_000_000 })).id;
    const r = await call(db, O, 'batches.create', { distributorId: distA, deliveryDate: today, lines: [{ categoryId: 'c1000', quantity: 500 }], deliverNow: true });
    b1 = r.id;
    expect([Y(r.grossMinor), Y(r.commissionMinor), Y(r.netMinor)]).toEqual([500000, 50000, 450000]);
    const b = await get(db, 'batches', b1);
    expect(b.status).toBe('open');
    expect(b.commissionPct).toBe(10);
  });

  it('T4 open custody: an open batch of 300,000 is custody, not receivable or revenue', async () => {
    b2 = (await call(db, O, 'batches.create', { distributorId: distA, deliveryDate: today, lines: [{ categoryId: 'c300', quantity: 1000 }], deliverNow: true })).id;
    const d = await get(db, 'distributors', distA);
    expect(Y(d.bal.custodyGross)).toBe(800000);
    expect(d.bal.ledger).toBe(0);
    const pl = await call(db, O, 'reports.profit', { from: today, to: today });
    expect(pl.current.grossCardRevenue).toBe(0);
  });

  it('T2 historical commission: change default to 12% — the finalized 10% batch is unchanged', async () => {
    await call(db, O, 'batches.finalize', { id: b1, settlementDate: today });
    await call(db, O, 'settings.update', { section: 'finance', data: { defaultCommissionPct: 12 } });
    const b = await get(db, 'batches', b1);
    expect(b.commissionPct).toBe(10);
    expect(Y(b.netMinor)).toBe(450000);
    const nb = await call(db, O, 'batches.create', { distributorId: distA, deliveryDate: today, lines: [{ categoryId: 'c1000', quantity: 10 }], deliverNow: false });
    expect((await get(db, 'batches', nb.id)).commissionPct).toBe(12);
    await call(db, O, 'batches.cancel', { id: nb.id, reason: 'اختبار' });
    await call(db, O, 'settings.update', { section: 'finance', data: { defaultCommissionPct: 10 } });
    expect((await get(db, 'batches', b1)).commissionPct).toBe(10);
  });

  it('T3 payment: receivable 450,000 − payment 200,000 = 250,000 (FIFO allocation, partial settlement)', async () => {
    const p = await call(db, O, 'payments.create', { distributorId: distA, date: today, amount: 200000, currency: 'YER', methodId: 'cash', cashAccountId: main, allocation: { mode: 'fifo', items: [] } });
    expect(Y(p.allocatedMinor)).toBe(200000);
    const d = await get(db, 'distributors', distA);
    expect(Y(d.bal.ledger)).toBe(250000);
    const b = await get(db, 'batches', b1);
    expect(b.settlement).toBe('partial');
    const st = await call(db, O, 'reports.distributorStatement', { id: distA });
    expect(Y(st.closingMinor)).toBe(250000);
    expect(st.openCustody.length).toBe(1); // T4 batch still open
  });

  it('T5 exchange rate: 100 USD × 2,500 = 250,000 YER; a later rate change does not alter it', async () => {
    usd = (await call(db, O, 'cash.createAccount', { name: 'صندوق الدولار', type: 'cash', currency: 'USD', openingBalance: 500, openingDate: today, rate: 2500 })).id;
    const e = await call(db, O, 'expenses.create', { date: today, categoryId: 'subscriptions', description: 'اشتراك بالدولار', amount: 100, currency: 'USD', rate: 2500, cashAccountId: usd, methodId: 'cash' });
    expect(Y(e.baseMinor)).toBe(250000);
    await call(db, O, 'settings.setExchangeRate', { currency: 'USD', rate: 3000, date: today });
    const doc = await get(db, 'expenses', e.id);
    expect(Y(doc.baseMinor)).toBe(250000);
    expect(doc.rate).toBe(2500);
    // a new USD transaction without an explicit rate picks the recorded table rate
    const e2 = await call(db, O, 'expenses.create', { date: today, categoryId: 'subscriptions', description: 'سعر من الجدول', amount: 10, currency: 'USD', cashAccountId: usd, methodId: 'cash' });
    expect(Y(e2.baseMinor)).toBe(30000);
  });

  it('T6 cash: opening 100,000 + receipt 50,000 − payment 20,000 = 130,000', async () => {
    t6 = (await call(db, O, 'cash.createAccount', { name: 'صندوق T6', type: 'cash', currency: 'YER', openingBalance: 100000, openingDate: today })).id;
    await call(db, O, 'payments.create', { distributorId: distA, date: today, amount: 50000, currency: 'YER', methodId: 'cash', cashAccountId: t6, allocation: { mode: 'none', items: [] } });
    await call(db, O, 'expenses.create', { date: today, categoryId: 'transport', description: 'مواصلات', amount: 20000, currency: 'YER', cashAccountId: t6, methodId: 'cash' });
    expect(Y((await get(db, 'cash_accounts', t6)).balanceMinor)).toBe(130000);
    const stmt = await call(db, O, 'reports.cashStatement', { id: t6 });
    expect(stmt.rows.map((r: any) => [Y(r.balanceBeforeMinor), Y(r.balanceAfterMinor)])).toEqual([[0, 100000], [100000, 150000], [150000, 130000]]);
  });

  it('T7 capital purchase 400,000: not an operating expense; is investing cash out; asset registered', async () => {
    const before = await call(db, O, 'reports.profit', { from: today, to: today });
    const p = await call(db, O, 'purchases.create', { date: today, classification: 'capital', currency: 'YER', lines: [{ description: 'مولد كهربائي', quantity: 1, unitPrice: 400000 }],
      paidAmount: 400000, cashAccountId: main, methodId: 'cash', asset: { name: 'مولد كهربائي', categoryId: 'equipment' } });
    expect((await get(db, 'purchases', p.id)).status).toBe('pending');
    const a = await call(db, O, 'purchases.approve', { id: p.id });
    const after = await call(db, O, 'reports.profit', { from: today, to: today });
    expect(after.current.operatingExpenses).toBe(before.current.operatingExpenses);
    expect(after.current.operatingProfit).toBe(before.current.operatingProfit);
    const cf = await call(db, O, 'reports.cashflow', { from: today, to: today });
    expect(Y(cf.summary.investingOut)).toBe(400000);
    const asset = await get(db, 'assets', a.assetId);
    expect(Y(asset.costMinor)).toBe(400000);
    expect(asset.usefulLifeMonths).toBeNull(); // never invented
  });

  it('T8 internal transfer 30,000: source −30,000, destination +30,000, no revenue/expense, excluded from cash flow', async () => {
    const [m0, t0] = [(await get(db, 'cash_accounts', main)).balanceMinor, (await get(db, 'cash_accounts', t6)).balanceMinor];
    const pl0 = await call(db, O, 'reports.profit', { from: today, to: today });
    const cf0 = await call(db, O, 'reports.cashflow', { from: today, to: today });
    await call(db, O, 'cash.transfer', { fromId: main, toId: t6, amount: 30000, date: today });
    expect(Y((await get(db, 'cash_accounts', main)).balanceMinor - m0)).toBe(-30000);
    expect(Y((await get(db, 'cash_accounts', t6)).balanceMinor - t0)).toBe(30000);
    const pl1 = await call(db, O, 'reports.profit', { from: today, to: today });
    const cf1 = await call(db, O, 'reports.cashflow', { from: today, to: today });
    expect(pl1.current).toEqual(pl0.current);
    expect(cf1.summary).toEqual(cf0.summary);
  });

  it('books reconcile: trial balance, distributor/supplier/cash sub-ledgers and allocations', async () => {
    const r = await reconcile(db);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  });
});

describe('Lifecycle, integrity and duplicates', () => {
  it('rejects duplicate finalization and finalizing a non-open batch', async () => {
    await expect(call(db, O, 'batches.finalize', { id: b1, settlementDate: today })).rejects.toThrow(/مسبقاً/);
  });
  it('idempotency: replaying the same requestId does not create a second receipt', async () => {
    const before = (await db.collection('payments').get()).size;
    const input = { distributorId: distA, date: today, amount: 1000, currency: 'YER', methodId: 'cash', cashAccountId: main, allocation: { mode: 'none', items: [] } };
    const a = await call(db, O, 'payments.create', input, 'req-fixed-0001');
    const b = await call(db, O, 'payments.create', input, 'req-fixed-0001');
    expect(b.duplicate).toBe(true);
    expect(b.receiptNo).toBe(a.receiptNo);
    expect((await db.collection('payments').get()).size).toBe(before + 1);
  });
  it('rejects zero/negative amounts, invalid dates, unknown distributor, foreign currency without any rate', async () => {
    const base = { distributorId: distA, date: today, currency: 'YER', methodId: 'cash', cashAccountId: main, allocation: { mode: 'none', items: [] } };
    await expect(call(db, O, 'payments.create', { ...base, amount: 0 })).rejects.toThrow();
    await expect(call(db, O, 'payments.create', { ...base, amount: -5 })).rejects.toThrow();
    await expect(call(db, O, 'payments.create', { ...base, amount: 5, date: '2026-13-45' })).rejects.toThrow(/تاريخ/);
    await expect(call(db, O, 'payments.create', { ...base, amount: 5, distributorId: 'NOPE' })).rejects.toThrow(/غير موجود/);
    await expect(call(db, O, 'expenses.create', { date: '2020-01-01', categoryId: 'rent', description: 'x', amount: 5, currency: 'SAR', cashAccountId: main, methodId: 'cash' })).rejects.toThrow(/سعر صرف/);
    await expect(call(db, O, 'expenses.create', { date: today, categoryId: 'rent', description: 'x', amount: 5, currency: 'USD', rate: 2500, cashAccountId: main, methodId: 'cash' })).rejects.toThrow(/عملة الحساب/);
  });
  it('payment cancellation reverses ledger, cash and allocations (no deletion)', async () => {
    const d0 = await get(db, 'distributors', distA);
    const c0 = (await get(db, 'cash_accounts', main)).balanceMinor;
    const p = await call(db, O, 'payments.create', { distributorId: distA, date: today, amount: 100000, currency: 'YER', methodId: 'cash', cashAccountId: main, allocation: { mode: 'fifo', items: [] } });
    const r = await call(db, O, 'payments.cancel', { id: p.id, reason: 'سند مكرر' });
    expect(r.executed).toBe(true);
    const d1 = await get(db, 'distributors', distA);
    expect(d1.bal.ledger).toBe(d0.bal.ledger);
    expect(d1.bal.unallocated).toBe(d0.bal.unallocated);
    expect((await get(db, 'cash_accounts', main)).balanceMinor).toBe(c0);
    expect((await get(db, 'payments', p.id)).status).toBe('cancelled');
    await expect(call(db, O, 'payments.cancel', { id: p.id, reason: 'مرة أخرى' })).rejects.toThrow(/مسبقاً/);
  });
  it('reallocation applies an unallocated credit to a batch', async () => {
    const d = await get(db, 'distributors', distA);
    expect(Y(d.bal.unallocated)).toBe(51000); // 50,000 (T6) + 1,000 (idempotency test)
    const pays = (await db.collection('payments').where('distributorId', '==', distA).where('allocatedMinor', '==', 0).where('status', '==', 'posted').get()).docs;
    const p = pays.find((x) => x.data().baseMinor === 5000000)!;
    await call(db, O, 'payments.reallocate', { id: p.id, reason: 'تطبيق الرصيد على الدفعة', allocation: { mode: 'manual', items: [{ targetType: 'batch', targetId: b1, amount: 50000 }] } });
    expect(Y((await get(db, 'batches', b1)).paidMinor)).toBe(250000);
    expect(Y((await get(db, 'distributors', distA)).bal.unallocated)).toBe(1000);
  });
  it('cancelling a finalized batch is reversed via approval and releases its allocations', async () => {
    const d = (await call(db, O, 'distributors.create', { name: 'موزع إلغاء', phone: '771234567', startDate: today })).id;
    const b = (await call(db, O, 'batches.create', { distributorId: d, deliveryDate: today, lines: [{ categoryId: 'c500', quantity: 100 }] })).id;
    await call(db, O, 'batches.finalize', { id: b, settlementDate: today });
    await call(db, O, 'payments.create', { distributorId: d, date: today, amount: 45000, currency: 'YER', methodId: 'cash', cashAccountId: main, allocation: { mode: 'fifo', items: [] } });
    await call(db, O, 'batches.cancel', { id: b, reason: 'خطأ إدخال' });
    const dd = await get(db, 'distributors', d);
    expect(Y(dd.bal.ledger)).toBe(-45000);
    expect(Y(dd.bal.unallocated)).toBe(45000);
    expect((await get(db, 'batches', b)).status).toBe('cancelled');
  });
  it('opening balance becomes an agable charge; aging and reconciliation stay consistent', async () => {
    const d = (await call(db, O, 'distributors.create', { name: 'موزع رصيد سابق', phone: '772000003', startDate: '2026-01-01', openingBalance: 25000 })).id;
    const ag = await call(db, O, 'reports.aging', { asOf: today });
    const row = ag.rows.find((r: any) => r.id === d);
    expect(Y(row.total)).toBe(25000);
    expect(row.buckets[3]).toBe(2500000);
  });
  it('credit limit (block policy) requires approval with a reason', async () => {
    await call(db, O, 'settings.update', { section: 'finance', data: { creditPolicy: 'block' } });
    const d = (await call(db, O, 'distributors.create', { name: 'موزع محدود', phone: '773000004', startDate: today, creditLimit: 100000 })).id;
    await expect(call(db, O, 'batches.create', { distributorId: d, deliveryDate: today, lines: [{ categoryId: 'c1000', quantity: 200 }] })).rejects.toThrow(/الحد الائتماني/);
    const r = await call(db, O, 'batches.create', { distributorId: d, deliveryDate: today, lines: [{ categoryId: 'c1000', quantity: 200 }], overrideReason: 'موزع موثوق — موافقة المدير' });
    expect(r.delivery.delivered).toBe(true);
    await call(db, O, 'settings.update', { section: 'finance', data: { creditPolicy: 'warn' } });
  });
  it('closed accounting period rejects postings', async () => {
    await call(db, O, 'periods.close', { month: today.slice(0, 7) });
    await expect(call(db, O, 'expenses.create', { date: today, categoryId: 'rent', description: 'x', amount: 5, currency: 'YER', cashAccountId: main, methodId: 'cash' })).rejects.toThrow(/مقفلة/);
    await call(db, O, 'periods.reopen', { month: today.slice(0, 7), reason: 'اختبار' });
  });
  it('supplier on credit, partial payment, inventory receipt on approval, issue at average cost', async () => {
    const wh = (await call(db, O, 'inventory.createWarehouse', { name: 'المخزن الرئيسي' })).id;
    const item = (await call(db, O, 'inventory.createItem', { name: 'كيبل شبكة', unit: 'متر', minQuantity: 50 })).id;
    const s = (await call(db, O, 'suppliers.create', { name: 'مورد اختبار' })).id;
    const p = await call(db, O, 'purchases.create', { date: today, supplierId: s, classification: 'operational', currency: 'YER', lines: [{ description: 'كيبل', itemId: item, warehouseId: wh, quantity: 100, unitPrice: 500 }, { description: 'مستهلكات', quantity: 1, unitPrice: 10000 }], paidAmount: 20000, cashAccountId: main, methodId: 'cash' });
    expect((await get(db, 'inventory_items', item)).qtyTotal).toBe(0); // not before approval
    await call(db, O, 'purchases.approve', { id: p.id });
    const it = await get(db, 'inventory_items', item);
    expect(it.qtyTotal).toBe(100);
    expect(Y(it.avgCostMinor)).toBe(500);
    expect(Y((await get(db, 'suppliers', s)).bal.ledger)).toBe(40000);
    await call(db, O, 'suppliers.pay', { supplierId: s, date: today, amount: 15000, currency: 'YER', cashAccountId: main, methodId: 'cash', purchaseId: p.id });
    expect((await get(db, 'purchases', p.id)).payState).toBe('partial');
    expect(Y((await get(db, 'suppliers', s)).bal.ledger)).toBe(25000);
    await call(db, O, 'inventory.move', { type: 'issue', itemId: item, warehouseId: wh, quantity: 60, date: today });
    await expect(call(db, O, 'inventory.move', { type: 'issue', itemId: item, warehouseId: wh, quantity: 41, date: today })).rejects.toThrow(/المتاحة/);
    const pl = await call(db, O, 'reports.profit', { from: today, to: today });
    expect(Y(pl.current.operationalPurchases)).toBeGreaterThanOrEqual(10000 + 30000); // consumables + issued stock (60 × 500)
    await call(db, O, 'inventory.move', { type: 'count', itemId: item, warehouseId: wh, quantity: 38, date: today, notes: 'جرد' });
    expect((await get(db, 'inventory_items', item)).qtyTotal).toBe(38);
  });
  it('depreciation only when policy is set; idempotent per month', async () => {
    const a = (await call(db, O, 'assets.create', { name: 'جهاز حاسوب', purchaseDate: '2026-01-01', cost: 120000, currency: 'YER', usefulLifeMonths: 12, residualValue: 0, inServiceDate: '2026-01-01' })).id;
    const m = today.slice(0, 7);
    const r1 = await call(db, O, 'assets.runDepreciation', { month: m });
    const r2 = await call(db, O, 'assets.runDepreciation', { month: m });
    expect(r1.skipped.some((s: string) => s.includes('A0001'))).toBe(true); // purchased generator has no policy
    expect(Y(r1.totalMinor)).toBe(10000);
    expect(r2.totalMinor).toBe(0);
    expect(Y((await get(db, 'assets', a)).accumulatedDepMinor)).toBe(10000);
  });
  it('dashboard and monthly report run on real data', async () => {
    const d = await call(db, O, 'reports.dashboard', { from: `${today.slice(0, 7)}-01`, to: today });
    expect(d.distribution.activeDistributors).toBeGreaterThan(0);
    expect(d.financial.openCustodyGross).toBeGreaterThan(0);
    const m = await call(db, O, 'reports.monthly', { year: +today.slice(0, 4) });
    expect(m.rows.length).toBe(12);
  });
  it('everything still reconciles after the full scenario', async () => {
    const r = await reconcile(db);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  });
});
