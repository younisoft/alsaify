import { z } from 'zod';
import type { Firestore, Query } from 'firebase-admin/firestore';
import {
  S, can, profitAndLoss, cashFlow, agingBuckets, agingLabels, withRunningBalance, creditExposure, accountMovements, baseAccount, monthRange, AR_MONTHS, addDays,
  DEFAULT_SETTINGS, ACCOUNTS, type PostedEntry, type CashMovement, type Settings, type Minor,
} from '@dc/shared';
import { query } from '../core/registry';
import { fail } from '../core/errors';
import type { Ctx } from '../core/tx';

type Doc = Record<string, any> & { id: string };
const all = async (q: Query): Promise<Doc[]> => (await q.get()).docs.map((d) => ({ ...d.data(), id: d.id }));
async function settings(db: Firestore): Promise<Settings> {
  const s = (await db.collection('settings').doc('main').get()).data() as Partial<Settings> | undefined;
  return { company: { ...DEFAULT_SETTINGS.company, ...s?.company }, finance: { ...DEFAULT_SETTINGS.finance, ...s?.finance }, lists: { ...DEFAULT_SETTINGS.lists, ...s?.lists }, system: { ...DEFAULT_SETTINGS.system, ...s?.system } };
}
const journalIn = (db: Firestore, from?: string, to?: string) => {
  let q: Query = db.collection('journal_entries');
  if (from) q = q.where('date', '>=', from);
  if (to) q = q.where('date', '<=', to);
  return all(q) as Promise<(Doc & PostedEntry)[]>;
};
const cashIn = (db: Firestore, from?: string, to?: string) => {
  let q: Query = db.collection('cash_transactions');
  if (from) q = q.where('date', '>=', from);
  if (to) q = q.where('date', '<=', to);
  return all(q) as Promise<(Doc & CashMovement)[]>;
};
const sum = (xs: Doc[], f: (d: Doc) => number) => xs.reduce((a, d) => a + (f(d) || 0), 0);
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []; let y = +from.slice(0, 4), m = +from.slice(5, 7);
  while (`${y}-${String(m).padStart(2, '0')}` <= to.slice(0, 7) && out.length < 36) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
function defaultRange(ctx: Ctx, from?: string, to?: string) {
  return { from: from ?? `${ctx.today.slice(0, 7)}-01`, to: to ?? ctx.today };
}

/** Open receivable items (finalized batches + debit charges) with what is still unpaid. */
async function openItems(db: Firestore, distributorId?: string) {
  let bq: Query = db.collection('batches').where('allocOpen', '==', true);
  let cq: Query = db.collection('distributor_charges').where('allocOpen', '==', true);
  if (distributorId) { bq = bq.where('distributorId', '==', distributorId); cq = cq.where('distributorId', '==', distributorId); }
  const [b, c] = await Promise.all([all(bq), all(cq)]);
  return [
    ...b.map((x) => ({ id: x.id, type: 'batch', ref: `دفعة #${x.batchNo}`, distributorId: x.distributorId, date: x.settlementDate, amountMinor: x.netMinor, paidMinor: x.paidMinor, outstandingMinor: x.netMinor - x.paidMinor })),
    ...c.map((x) => ({ id: x.id, type: 'charge', ref: x.description, distributorId: x.distributorId, date: x.date, amountMinor: x.amountMinor, paidMinor: x.paidMinor, outstandingMinor: x.amountMinor - x.paidMinor })),
  ];
}

// ------------------------------------------------------------------ dashboard
query('reports.dashboard', S.range, ['dashboard', 'view'], async (ctx, i) => {
  const { from, to } = defaultRange(ctx, i.from, i.to);
  const db = ctx.db;
  const st = await settings(db);
  const [dists, entries, moves, batchesDelivered, batchesFinal, openBatches, receipts, purchases, cashAccounts, users, tasks, approvals, items] = await Promise.all([
    all(db.collection('distributors')), journalIn(db, from, to), cashIn(db, from, to),
    all(db.collection('batches').where('deliveryDate', '>=', from).where('deliveryDate', '<=', to)),
    all(db.collection('batches').where('settlementDate', '>=', from).where('settlementDate', '<=', to)),
    all(db.collection('batches').where('status', '==', 'open')),
    all(db.collection('payments').where('date', '>=', from).where('date', '<=', to)),
    all(db.collection('purchases').where('date', '>=', from).where('date', '<=', to)),
    all(db.collection('cash_accounts')), all(db.collection('users')),
    all(db.collection('tasks').where('status', 'in', ['new', 'assigned', 'in_progress', 'review'])),
    all(db.collection('approvals').where('status', '==', 'pending')), openItems(db),
  ]);
  const pl = profitAndLoss(entries, from, to);
  const cf = cashFlow(moves, from, to);
  const finalized = batchesFinal.filter((b) => b.status === 'finalized');
  const delivered = batchesDelivered.filter((b) => b.status === 'open' || b.status === 'finalized');
  const collections = sum(receipts.filter((p) => p.kind === 'receipt' && p.status === 'posted'), (p) => p.baseMinor);
  const approvedPurch = purchases.filter((p) => p.status === 'approved');
  const aging = agingBuckets(items as any, to, st.finance.agingBounds);
  const overLimit = dists.filter((d) => d.status === 'active').map((d) => {
    const limit = d.creditLimitMinor ?? st.finance.defaultCreditLimitMinor;
    const exposure = creditExposure(d.bal?.ledger || 0, d.bal?.custodyGross || 0, d.bal?.custodyNet || 0, st.finance.exposureBasis);
    return { id: d.id, code: d.code, name: d.name, exposure, limit };
  }).filter((x) => x.exposure > x.limit);
  const byDist = new Map<string, { id: string; name: string; gross: Minor; net: Minor }>();
  for (const b of finalized) { const r = byDist.get(b.distributorId) ?? { id: b.distributorId, name: b.distributorName, gross: 0, net: 0 }; r.gross += b.grossMinor; r.net += b.netMinor; byDist.set(b.distributorId, r); }
  const performance = [...byDist.values()].sort((a, b) => b.gross - a.gross);
  const regions = new Map<string, { region: string; custody: Minor; receivable: Minor; distributors: number }>();
  for (const d of dists) { const k = d.region || 'غير محدد'; const r = regions.get(k) ?? { region: k, custody: 0, receivable: 0, distributors: 0 };
    r.custody += d.bal?.custodyGross || 0; r.receivable += Math.max(d.bal?.ledger || 0, 0); r.distributors++; regions.set(k, r); }
  const monthly = monthsBetween(from, to).map((mk) => {
    const [y, m] = mk.split('-').map(Number); const r = monthRange(y, m);
    const f = r.from < from ? from : r.from, t = r.to > to ? to : r.to;
    const p = profitAndLoss(entries, f, t);
    return { month: mk, label: `${AR_MONTHS[m - 1]} ${y}`, netRevenue: p.netRevenue, expenses: p.operatingExpenses + p.operationalPurchases, operatingProfit: p.operatingProfit,
      collections: sum(receipts.filter((x) => x.kind === 'receipt' && x.status === 'posted' && x.date >= f && x.date <= t), (x) => x.baseMinor) };
  });
  const catName = (id: string) => st.lists.expenseCategories.find((c) => c.id === id)?.name ?? id;
  const today = ctx.today;
  return {
    range: { from, to },
    accrualVsCash: 'الإيراد والربح محسوبان على أساس الاستحقاق (الدفعات المعتمدة)؛ التحصيل والتدفق النقدي حركات نقدية فعلية فقط.',
    financial: {
      openCustodyGross: sum(dists, (d) => d.bal?.custodyGross), openCustodyNet: sum(dists, (d) => d.bal?.custodyNet),
      finalizedReceivablesInPeriod: sum(finalized, (b) => b.netMinor), collections,
      outstandingBalances: sum(dists, (d) => Math.max(d.bal?.ledger || 0, 0)), distributorCredits: sum(dists, (d) => Math.min(d.bal?.ledger || 0, 0)),
      operatingProfit: pl.operatingProfit, netRevenue: pl.netRevenue, operatingExpenses: pl.operatingExpenses, operationalPurchases: pl.operationalPurchases,
      capitalPurchases: sum(approvedPurch.filter((p) => p.classification === 'capital'), (p) => p.totalBaseMinor), netCashMovement: cf.netCashMovement, netOperatingCashFlow: cf.netOperating,
      cashAccounts: cashAccounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, balanceMinor: a.balanceMinor, status: a.status })),
      profit: pl, cashFlow: cf,
    },
    distribution: {
      activeDistributors: dists.filter((d) => d.status === 'active').length, suspendedDistributors: dists.filter((d) => d.status === 'suspended').length,
      openBatches: openBatches.length, finalizedBatchesInPeriod: finalized.length, deliveredValueInPeriod: sum(delivered, (b) => b.grossMinor),
      overdueReceivables: aging[3], agingBuckets: aging, agingLabels: agingLabels(st.finance.agingBounds), overLimit, top5: performance.slice(0, 5),
    },
    management: {
      activeTeam: users.filter((u) => u.status === 'active' && u.kind !== 'portal').length, openTasks: tasks.length,
      overdueTasks: tasks.filter((t) => t.dueDate && t.dueDate < today).length, pendingApprovals: approvals.length,
      recentActivity: can(ctx.actor, 'audit', 'view') ? (await all(db.collection('audit_logs').orderBy('at', 'desc').limit(10))).map((a) => ({ id: a.id, action: a.action, module: a.module, userName: a.userName, date: a.date, recordId: a.recordId })) : [],
    },
    charts: {
      monthly, performance: performance.slice(0, 10), regions: [...regions.values()],
      expenseCategories: Object.entries(pl.expensesByCategory).map(([id, v]) => ({ id, name: catName(id), value: v })).sort((a, b) => b.value - a.value),
      purchasesSplit: [{ name: 'تشغيلية', value: sum(approvedPurch.filter((p) => p.classification === 'operational'), (p) => p.totalBaseMinor) },
        { name: 'رأسمالية', value: sum(approvedPurch.filter((p) => p.classification === 'capital'), (p) => p.totalBaseMinor) }],
    },
  };
});

// ------------------------------------------------------------------ monthly / annual
async function yearRows(db: Firestore, year: number) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [entries, moves, batches, finals, receipts, purchases] = await Promise.all([
    journalIn(db, from, to), cashIn(db, from, to),
    all(db.collection('batches').where('deliveryDate', '>=', from).where('deliveryDate', '<=', to)),
    all(db.collection('batches').where('settlementDate', '>=', from).where('settlementDate', '<=', to)),
    all(db.collection('payments').where('date', '>=', from).where('date', '<=', to)),
    all(db.collection('purchases').where('date', '>=', from).where('date', '<=', to)),
  ]);
  const rows = AR_MONTHS.map((label, idx) => {
    const { from: f, to: t } = monthRange(year, idx + 1);
    const pl = profitAndLoss(entries, f, t);
    const cf = cashFlow(moves, f, t);
    const inM = (d?: string) => !!d && d >= f && d <= t;
    return {
      month: `${year}-${String(idx + 1).padStart(2, '0')}`, label,
      deliveredValue: sum(batches.filter((b) => (b.status === 'open' || b.status === 'finalized') && inM(b.deliveryDate)), (b) => b.grossMinor),
      finalizedGross: pl.grossCardRevenue, commissions: pl.commissions, netRevenue: pl.netRevenue,
      finalizedCount: finals.filter((b) => b.status === 'finalized' && inM(b.settlementDate)).length,
      collections: sum(receipts.filter((p) => p.kind === 'receipt' && p.status === 'posted' && inM(p.date)), (p) => p.baseMinor),
      operatingExpenses: pl.operatingExpenses, operationalPurchases: pl.operationalPurchases, depreciation: pl.depreciation, operatingProfit: pl.operatingProfit,
      netOperatingCashFlow: cf.netOperating, netCashMovement: cf.netCashMovement,
      capitalPurchases: sum(purchases.filter((p) => p.status === 'approved' && p.classification === 'capital' && inM(p.date)), (p) => p.totalBaseMinor),
    };
  });
  const keys = Object.keys(rows[0]).filter((k) => typeof (rows[0] as any)[k] === 'number');
  const total: Record<string, number> = {};
  for (const k of keys) total[k] = rows.reduce((a, r) => a + (r as any)[k], 0);
  return { rows, total };
}
query('reports.monthly', S.year, ['reports', 'view'], async (ctx, i) => {
  const [cur, prev, dists, suppliers, cash] = await Promise.all([yearRows(ctx.db, i.year), yearRows(ctx.db, i.year - 1), all(ctx.db.collection('distributors')), all(ctx.db.collection('suppliers')), all(ctx.db.collection('cash_accounts'))]);
  return {
    year: i.year, rows: cur.rows, total: cur.total, previousYear: { rows: prev.rows, total: prev.total },
    currentBalances: {
      note: 'أرصدة لحظية (الآن) وليست أرصدة نهاية السنة',
      distributorBalances: sum(dists, (d) => d.bal?.ledger), openCustody: sum(dists, (d) => d.bal?.custodyGross), supplierBalances: sum(suppliers, (s) => s.bal?.ledger),
      cash: cash.map((a) => ({ name: a.name, currency: a.currency, balanceMinor: a.balanceMinor })),
    },
  };
});

query('reports.profit', S.range, ['reports', 'view'], async (ctx, i) => {
  const { from, to } = defaultRange(ctx, i.from, i.to);
  const st = await settings(ctx.db);
  const days = Math.max(1, (Date.parse(to) - Date.parse(from)) / 86400000 + 1);
  const pFrom = addDays(from, -days), pTo = addDays(from, -1);
  const [cur, prev] = await Promise.all([journalIn(ctx.db, from, to), journalIn(ctx.db, pFrom, pTo)]);
  const name = (id: string) => st.lists.expenseCategories.find((c) => c.id === id)?.name ?? id;
  const p = profitAndLoss(cur, from, to);
  return { range: { from, to }, current: p, previous: profitAndLoss(prev, pFrom, pTo), previousRange: { from: pFrom, to: pTo },
    expenseCategoryNames: Object.fromEntries(Object.keys(p.expensesByCategory).map((k) => [k, name(k)])) };
});

query('reports.cashflow', S.range, ['reports', 'view'], async (ctx, i) => {
  const { from, to } = defaultRange(ctx, i.from, i.to);
  const moves = await cashIn(ctx.db, from, to);
  const byType: Record<string, { in: Minor; out: Minor }> = {};
  for (const m of moves) { if (m.flowClass === 'opening') continue; const r = (byType[(m as any).type] ??= { in: 0, out: 0 }); r[m.direction] += m.baseMinor; }
  return { range: { from, to }, summary: cashFlow(moves, from, to), byType };
});

query('reports.aging', S.asOf, ['reports', 'view'], async (ctx, i) => {
  const asOf = i.asOf ?? ctx.today;
  const st = await settings(ctx.db);
  const [items, dists] = await Promise.all([openItems(ctx.db), all(ctx.db.collection('distributors'))]);
  const rows = dists.map((d) => {
    const mine = items.filter((x) => x.distributorId === d.id && x.date <= asOf);
    const b = agingBuckets(mine as any, asOf, st.finance.agingBounds);
    return { id: d.id, code: d.code, name: d.name, region: d.region, buckets: b, total: b.reduce((a, x) => a + x, 0), unallocatedCredit: d.bal?.unallocated || 0, ledger: d.bal?.ledger || 0,
      items: mine.map((x) => ({ ...x, ageDays: Math.round((Date.parse(asOf) - Date.parse(x.date)) / 86400000) })) };
  }).filter((r) => r.total > 0 || r.unallocatedCredit > 0);
  const totals = [0, 1, 2, 3].map((k) => rows.reduce((a, r) => a + r.buckets[k], 0));
  return { asOf, labels: agingLabels(st.finance.agingBounds), rows, totals, grandTotal: totals.reduce((a, b) => a + b, 0) };
});

// ------------------------------------------------------------------ statements
query('reports.distributorStatement', S.statement, 'user', async (ctx, i) => {
  const a = ctx.actor;
  if (a.kind === 'portal') {
    const st = await settings(ctx.db);
    if (!st.system.portalEnabled || a.portalDistributorId !== i.id) throw fail.denied();
  } else if (!can(a, 'distributors', 'view')) throw fail.denied();
  const d = await ctx.db.collection('distributors').doc(i.id).get();
  if (!d.exists) throw fail.notFound('الموزع');
  const [rows, custody] = await Promise.all([
    all(ctx.db.collection('distributor_ledger').where('distributorId', '==', i.id)),
    all(ctx.db.collection('batches').where('distributorId', '==', i.id).where('status', '==', 'open')),
  ]);
  const ordered = withRunningBalance(rows.map((r) => ({ ...r, seq: r.atMs })) as any[]);
  const before = i.from ? ordered.filter((r: any) => r.date < i.from!) : [];
  const opening = before.length ? (before.at(-1) as any).balanceMinor : 0;
  const inRange = ordered.filter((r: any) => (!i.from || r.date >= i.from) && (!i.to || r.date <= i.to));
  const t = (type: string[], side: 'debitMinor' | 'creditMinor') => inRange.filter((r: any) => type.includes(r.type)).reduce((x: number, r: any) => x + r[side], 0);
  return {
    distributor: { ...d.data(), id: d.id }, from: i.from ?? null, to: i.to ?? null, openingMinor: opening,
    rows: inRange.map((r: any) => ({ id: r.id, date: r.date, type: r.type, description: r.description, debitMinor: r.debitMinor, creditMinor: r.creditMinor, balanceMinor: r.balanceMinor, sourceType: r.sourceType, sourceId: r.sourceId })),
    totals: { openingBalances: t(['opening'], 'debitMinor') - t(['opening'], 'creditMinor'), finalized: t(['batch'], 'debitMinor'), payments: t(['receipt'], 'creditMinor'),
      adjustments: t(['debit_adjustment'], 'debitMinor') - t(['credit_adjustment'], 'creditMinor'), reversals: t(['reversal'], 'debitMinor') - t(['reversal'], 'creditMinor') },
    closingMinor: inRange.length ? (inRange.at(-1) as any).balanceMinor : opening,
    openCustody: custody.map((b) => ({ id: b.id, batchNo: b.batchNo, deliveryDate: b.deliveryDate, grossMinor: b.grossMinor, netMinor: b.netMinor, lines: b.lines })),
  };
});

query('reports.supplierStatement', S.statement, ['suppliers', 'view'], async (ctx, i) => {
  const s = await ctx.db.collection('suppliers').doc(i.id).get();
  if (!s.exists) throw fail.notFound('المورد');
  const rows = await all(ctx.db.collection('supplier_ledger').where('supplierId', '==', i.id));
  // supplier perspective: balance = what we owe = credit − debit
  const ordered = withRunningBalance(rows.map((r) => ({ ...r, seq: r.atMs, debitMinor: r.creditMinor, creditMinor: r.debitMinor, _d: r.debitMinor, _c: r.creditMinor })) as any[]);
  const inRange = ordered.filter((r: any) => (!i.from || r.date >= i.from) && (!i.to || r.date <= i.to));
  const before = i.from ? ordered.filter((r: any) => r.date < i.from!) : [];
  return { supplier: { ...s.data(), id: s.id }, openingMinor: before.length ? (before.at(-1) as any).balanceMinor : 0,
    rows: inRange.map((r: any) => ({ id: r.id, date: r.date, type: r.type, description: r.description, debitMinor: r._d, creditMinor: r._c, balanceMinor: r.balanceMinor })),
    closingMinor: ordered.length ? (ordered.filter((r: any) => !i.to || r.date <= i.to).at(-1) as any)?.balanceMinor ?? 0 : 0 };
});

query('reports.cashStatement', S.statement, ['cash', 'view'], async (ctx, i) => {
  const a = await ctx.db.collection('cash_accounts').doc(i.id).get();
  if (!a.exists) throw fail.notFound('الحساب');
  const rows = await all(ctx.db.collection('cash_transactions').where('accountId', '==', i.id));
  const ordered = withRunningBalance(rows.map((r) => ({ ...r, seq: r.atMs, debitMinor: r.direction === 'in' ? r.originalMinor : 0, creditMinor: r.direction === 'out' ? r.originalMinor : 0 })) as any[]);
  const inRange = ordered.filter((r: any) => (!i.from || r.date >= i.from) && (!i.to || r.date <= i.to));
  return { account: { ...a.data(), id: a.id },
    rows: inRange.map((r: any) => ({ id: r.id, date: r.date, type: r.type, description: r.description, inMinor: r.debitMinor, outMinor: r.creditMinor, balanceBeforeMinor: r.balanceMinor - r.debitMinor + r.creditMinor, balanceAfterMinor: r.balanceMinor, rate: r.rate, baseMinor: r.baseMinor })) };
});

// ------------------------------------------------------------------ integrity
export async function reconcile(db: Firestore) {
  const [entries, dists, dl, sups, sl, cashAccs, ctxs, batches, pays, allocs, items] = await Promise.all([
    all(db.collection('journal_entries')), all(db.collection('distributors')), all(db.collection('distributor_ledger')), all(db.collection('suppliers')), all(db.collection('supplier_ledger')),
    all(db.collection('cash_accounts')), all(db.collection('cash_transactions')), all(db.collection('batches')), all(db.collection('payments')),
    all(db.collection('payment_allocations').where('status', '==', 'active')), all(db.collection('inventory_items')),
  ]);
  const checks: { name: string; ok: boolean; details?: unknown }[] = [];
  const dr = entries.reduce((a, e) => a + e.lines.reduce((x: number, l: any) => x + l.debit, 0), 0);
  const cr = entries.reduce((a, e) => a + e.lines.reduce((x: number, l: any) => x + l.credit, 0), 0);
  checks.push({ name: 'ميزان المراجعة متوازن (مجموع المدين = مجموع الدائن)', ok: dr === cr, details: { dr, cr } });
  const party = (type: string, account: string) => {
    const m: Record<string, number> = {};
    for (const e of entries) for (const l of e.lines) if (baseAccount(l.account) === account && l.party?.type === type) m[l.party.id] = (m[l.party.id] || 0) + l.debit - l.credit;
    return m;
  };
  const ar = party('distributor', '1200');
  const bad: unknown[] = [];
  for (const d of dists) {
    const led = dl.filter((x) => x.distributorId === d.id).reduce((a, x) => a + x.debitMinor - x.creditMinor, 0);
    const custody = batches.filter((b) => b.distributorId === d.id && b.status === 'open');
    const unalloc = pays.filter((p) => p.distributorId === d.id && p.status === 'posted').reduce((a, p) => a + p.baseMinor - p.allocatedMinor, 0);
    const issues = { journal: ar[d.id] || 0, ledger: led, doc: d.bal?.ledger || 0, custodyDoc: d.bal?.custodyGross || 0, custodyBatches: sum(custody, (b) => b.grossMinor), unallocDoc: d.bal?.unallocated || 0, unallocPayments: unalloc };
    if (issues.journal !== issues.ledger || issues.ledger !== issues.doc || issues.custodyDoc !== issues.custodyBatches || issues.unallocDoc !== issues.unallocPayments) bad.push({ id: d.id, ...issues });
  }
  checks.push({ name: 'أرصدة الموزعين = دفتر الأستاذ المساعد = القيود (والعهدة والمبالغ غير المخصصة)', ok: bad.length === 0, details: bad });
  const ap = party('supplier', '2100');
  const badS = sups.filter((s) => { const led = sl.filter((x) => x.supplierId === s.id).reduce((a, x) => a + x.creditMinor - x.debitMinor, 0); return led !== (s.bal?.ledger || 0) || -(ap[s.id] || 0) !== led; })
    .map((s) => ({ id: s.id, doc: s.bal?.ledger, journal: -(ap[s.id] || 0) }));
  checks.push({ name: 'أرصدة الموردين = دفتر الموردين = القيود', ok: badS.length === 0, details: badS });
  const mv = accountMovements(entries as unknown as PostedEntry[]);
  const badC = cashAccs.filter((a) => {
    const tx = ctxs.filter((t) => t.accountId === a.id);
    const orig = tx.reduce((x, t) => x + (t.direction === 'in' ? t.originalMinor : -t.originalMinor), 0);
    const base = tx.reduce((x, t) => x + (t.direction === 'in' ? t.baseMinor : -t.baseMinor), 0);
    return orig !== a.balanceMinor || base !== (mv[`1100:${a.id}`] || 0) || base !== (a.balanceBaseMinor || 0);
  }).map((a) => ({ id: a.id, name: a.name }));
  checks.push({ name: 'أرصدة الصناديق = حركاتها = القيود', ok: badC.length === 0, details: badC });
  const badA: unknown[] = [];
  for (const p of pays.filter((x) => x.status === 'posted')) { const s = sum(allocs.filter((a) => a.paymentId === p.id), (a) => a.amountMinor); if (s !== p.allocatedMinor) badA.push({ payment: p.receiptNo, s, doc: p.allocatedMinor }); }
  for (const b of batches.filter((x) => x.status === 'finalized')) { const s = sum(allocs.filter((a) => a.targetType === 'batch' && a.targetId === b.id), (a) => a.amountMinor); if (s !== (b.paidMinor || 0)) badA.push({ batch: b.batchNo, s, doc: b.paidMinor }); }
  checks.push({ name: 'تخصيصات السداد متطابقة مع السندات والدفعات', ok: badA.length === 0, details: badA });
  const stockValue = items.reduce((a, it) => a + Math.round((it.qtyTotal || 0) * (it.avgCostMinor || 0)), 0);
  checks.push({ name: 'قيمة المخزون (كمية × متوسط التكلفة) مقابل حساب المخزون — للعلم (فروق تقريب ممكنة)', ok: true, details: { stockValue, ledger: mv['1300'] || 0 } });
  const tb = Object.entries(mv).filter(([, v]) => v !== 0).map(([k, v]) => ({ account: k, name: ACCOUNTS[baseAccount(k)]?.name, balanceMinor: v })).sort((a, b) => (a.account < b.account ? -1 : 1));
  return { ok: checks.every((c) => c.ok), checks, trialBalance: tb };
}
query('reports.reconcile', z.object({}), ['reports', 'view'], async (ctx) => reconcile(ctx.db));
