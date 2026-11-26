import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  S, computeBatchTotals, creditExposure, fifoAllocate, journals, normalizeYemeniPhone, toMinor, formatMoney,
  type BatchLineTotals, type Minor,
} from '@dc/shared';
import { executor, mutation } from '../core/registry';
import { fail } from '../core/errors';
import type { Tx } from '../core/tx';
import { requestOrExecute } from './approvals';

// ------------------------------------------------------------------ types & helpers
export interface Bal { custodyGross: Minor; custodyNet: Minor; ledger: Minor; finalizedNet: Minor; collected: Minor; unallocated: Minor }
export const EMPTY_BAL: Bal = { custodyGross: 0, custodyNet: 0, ledger: 0, finalizedNet: 0, collected: 0, unallocated: 0 };
interface Dist { id: string; code: string; name: string; status: 'active' | 'suspended' | 'closed'; commissionPct: number | null; creditLimitMinor: number | null; bal: Bal; region: string; lastPaymentDate?: string | null }
interface Batch { id: string; batchNo: number; distributorId: string; status: string; deliveryDate: string; grossMinor: Minor; commissionMinor: Minor; netMinor: Minor;
  paidMinor: Minor; commissionPct: number; journalId?: string | null; settlementDate?: string | null; lines: BatchLineTotals[] }
interface Payment { id: string; receiptNo: string; kind: 'receipt' | 'credit'; distributorId: string; date: string; baseMinor: Minor; originalMinor: Minor; currency: string; rate: number;
  allocatedMinor: Minor; status: 'posted' | 'cancelled'; cashAccountId?: string | null; journalId: string }
interface Target { id: string; type: 'batch' | 'charge'; date: string; amountMinor: Minor; paidMinor: Minor }

const cache = new WeakMap<Tx, Map<string, Dist>>();
export async function loadDist(tx: Tx, id: string): Promise<Dist> {
  let m = cache.get(tx); if (!m) { m = new Map(); cache.set(tx, m); }
  if (!m.has(id)) {
    const d = await tx.must<Dist>(tx.ref('distributors', id), 'الموزع');
    d.bal = { ...EMPTY_BAL, ...(d.bal || {}) };
    m.set(id, d);
  }
  return m.get(id)!;
}
function changeBal(tx: Tx, d: Dist, delta: Partial<Bal>, extra: Record<string, unknown> = {}) {
  for (const k of Object.keys(delta) as (keyof Bal)[]) d.bal[k] += delta[k]!;
  Object.assign(d, extra);
  tx.update(tx.ref('distributors', d.id), { bal: { ...d.bal }, ...extra, ...tx.stamp(false) });
}
function ledger(tx: Tx, e: { distributorId: string; date: string; type: string; description: string; debitMinor: Minor; creditMinor: Minor; sourceType: string; sourceId: string; journalId: string | null }) {
  tx.create(tx.ref('distributor_ledger'), { ...e, atMs: tx.ctx.now.getTime(), ...tx.stamp() });
}
const settlementOf = (paid: Minor, total: Minor) => (paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partial');

// ------------------------------------------------------------------ distributors
mutation('distributors.create', S.distributorCreate, ['distributors', 'create'], async (tx, i) => {
  const st = await tx.settings();
  const phone = normalizeYemeniPhone(i.phone);
  if (!phone) throw fail.invalid('رقم الهاتف غير صالح (مثال: 7XXXXXXXX)');
  const wa = i.whatsapp ? normalizeYemeniPhone(i.whatsapp) : phone;
  if (!wa) throw fail.invalid('رقم الواتساب غير صالح');
  const hasFinancialTerms = i.commissionPct !== undefined || i.creditLimit !== undefined || i.openingBalance !== 0;
  if (hasFinancialTerms && !tx.ctx.actor.permissions?.distributors?.includes('approve') && tx.ctx.actor.kind !== 'owner')
    throw fail.denied('تحديد العمولة الخاصة أو الحد الائتماني أو الرصيد الافتتاحي يتطلب صلاحية الاعتماد في قسم الموزعين');
  const code = await tx.code('distributor', 'D', 4);
  const ref = tx.ref('distributors', code);
  const opening = toMinor(i.openingBalance);
  const doc = {
    code, name: i.name, shopName: i.shopName, region: i.region, category: i.category, phone: phone.local, phoneIntl: phone.international, whatsappIntl: wa.international,
    commissionPct: i.commissionPct ?? null, creditLimitMinor: i.creditLimit !== undefined ? toMinor(i.creditLimit) : null, openingBalanceMinor: opening,
    startDate: i.startDate, status: 'active', notes: i.notes, bal: { ...EMPTY_BAL }, lastPaymentDate: null, nameLower: i.name.toLowerCase(), ...tx.stamp(),
  };
  tx.create(ref, doc);
  const d: Dist = { ...(doc as unknown as Dist), id: code };
  cache.get(tx)?.set(code, d) ?? cache.set(tx, new Map([[code, d]]));
  if (opening !== 0) await postOpening(tx, d, opening, i.startDate);
  tx.audit({ module: 'distributors', action: 'create', recordId: code, after: doc });
  void st;
  return { id: code, code };
});

async function postOpening(tx: Tx, d: Dist, amount: Minor, date: string) {
  const journalId = await tx.journal({ date, memo: `رصيد افتتاحي للموزع ${d.code}`, lines: journals.distributorOpening(d.id, amount), source: { type: 'distributor_opening', id: d.id } });
  if (amount > 0) {
    const cref = tx.ref('distributor_charges');
    tx.create(cref, { distributorId: d.id, kind: 'opening', date, description: 'رصيد افتتاحي', amountMinor: amount, paidMinor: 0, allocOpen: true, status: 'posted', journalId, ...tx.stamp() });
    ledger(tx, { distributorId: d.id, date, type: 'opening', description: 'رصيد افتتاحي (مدين)', debitMinor: amount, creditMinor: 0, sourceType: 'charge', sourceId: cref.id, journalId });
    changeBal(tx, d, { ledger: amount });
  } else {
    const pref = tx.ref('payments');
    const no = await tx.code('credit', 'CN-', 5);
    tx.create(pref, { receiptNo: no, kind: 'credit', distributorId: d.id, distributorName: d.name, date, currency: 'YER', originalMinor: -amount, rate: 1, baseMinor: -amount,
      allocatedMinor: 0, status: 'posted', methodId: null, cashAccountId: null, reference: '', notes: 'رصيد افتتاحي دائن', journalId, ...tx.stamp() });
    ledger(tx, { distributorId: d.id, date, type: 'opening', description: 'رصيد افتتاحي (دائن)', debitMinor: 0, creditMinor: -amount, sourceType: 'payment', sourceId: pref.id, journalId });
    changeBal(tx, d, { ledger: amount, unallocated: -amount });
  }
}

mutation('distributors.update', S.distributorUpdate, ['distributors', 'edit'], async (tx, i) => {
  const ref = tx.ref('distributors', i.id);
  const before = await tx.must<Record<string, unknown>>(ref, 'الموزع');
  const patch: Record<string, unknown> = {};
  for (const k of ['name', 'shopName', 'region', 'category', 'notes'] as const) if (i[k] !== undefined) patch[k] = i[k];
  if (i.name) patch.nameLower = i.name.toLowerCase();
  if (i.phone !== undefined) { const p = normalizeYemeniPhone(i.phone); if (!p) throw fail.invalid('رقم الهاتف غير صالح'); patch.phone = p.local; patch.phoneIntl = p.international; }
  if (i.whatsapp !== undefined) { const p = normalizeYemeniPhone(i.whatsapp); if (!p) throw fail.invalid('رقم الواتساب غير صالح'); patch.whatsappIntl = p.international; }
  tx.update(ref, { ...patch, ...tx.stamp(false) });
  tx.audit({ module: 'distributors', action: 'update', recordId: i.id, before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null])), after: patch });
  return { id: i.id };
});

mutation('distributors.setStatus', S.distributorStatus, ['distributors', 'edit'], async (tx, i) => {
  const d = await loadDist(tx, i.id);
  if (i.status === 'closed' && (d.bal.ledger !== 0 || d.bal.custodyGross !== 0)) throw fail.state('لا يمكن إغلاق حساب موزع لديه رصيد أو عهدة مفتوحة');
  tx.update(tx.ref('distributors', i.id), { status: i.status, ...tx.stamp(false) });
  tx.audit({ module: 'distributors', action: 'status', recordId: i.id, before: { status: d.status }, after: { status: i.status }, reason: i.reason });
  return { id: i.id };
});

mutation('distributors.changeTerms', S.distributorTerms, ['distributors', 'edit'], async (tx, i) => {
  const d = await loadDist(tx, i.id);
  return requestOrExecute(tx, { type: 'distributor.changeTerms', module: 'distributors', reason: i.reason,
    summary: `${d.name} (${d.code}): ${i.commissionPct !== undefined ? `العمولة ← ${i.commissionPct ?? 'الافتراضية'}% ` : ''}${i.creditLimit !== undefined ? `الحد ← ${i.creditLimit ?? 'الافتراضي'}` : ''}`,
    payload: { id: i.id, commissionPct: i.commissionPct, creditLimit: i.creditLimit, reason: i.reason } });
});
executor('distributor.changeTerms', async (tx, p) => {
  const d = await loadDist(tx, p.id);
  const patch: Record<string, unknown> = {};
  if (p.commissionPct !== undefined) patch.commissionPct = p.commissionPct;
  if (p.creditLimit !== undefined) patch.creditLimitMinor = p.creditLimit === null ? null : toMinor(p.creditLimit);
  tx.update(tx.ref('distributors', d.id), { ...patch, ...tx.stamp(false) });
  tx.audit({ module: 'distributors', action: 'changeTerms', recordId: d.id, before: { commissionPct: d.commissionPct, creditLimitMinor: d.creditLimitMinor }, after: patch, reason: p.reason });
  return { id: d.id };
});

mutation('distributors.adjust', S.distributorAdjust, ['distributors', 'edit'], async (tx, i) => {
  const d = await loadDist(tx, i.id);
  return requestOrExecute(tx, { type: 'distributor.adjust', module: 'distributors', reason: i.reason,
    summary: `${i.kind === 'debit' ? 'إضافة مدين' : 'إشعار دائن'} ${formatMoney(toMinor(i.amount))} ريال — ${d.name}`, payload: { ...i } });
});
executor('distributor.adjust', async (tx, p) => {
  const d = await loadDist(tx, p.id);
  const amount = toMinor(p.amount);
  const signedAmt = p.kind === 'debit' ? amount : -amount;
  const journalId = await tx.journal({ date: p.date, memo: `تسوية رصيد ${d.code}: ${p.reason}`, lines: journals.distributorAdjustment(d.id, signedAmt), source: { type: 'distributor_adjustment', id: d.id } });
  if (p.kind === 'debit') {
    const cref = tx.ref('distributor_charges');
    tx.create(cref, { distributorId: d.id, kind: 'adjustment', date: p.date, description: p.reason, amountMinor: amount, paidMinor: 0, allocOpen: true, status: 'posted', journalId, ...tx.stamp() });
    ledger(tx, { distributorId: d.id, date: p.date, type: 'debit_adjustment', description: `تسوية مدينة: ${p.reason}`, debitMinor: amount, creditMinor: 0, sourceType: 'charge', sourceId: cref.id, journalId });
    changeBal(tx, d, { ledger: amount });
  } else {
    const pref = tx.ref('payments');
    const no = await tx.code('credit', 'CN-', 5);
    tx.create(pref, { receiptNo: no, kind: 'credit', distributorId: d.id, distributorName: d.name, date: p.date, currency: 'YER', originalMinor: amount, rate: 1, baseMinor: amount,
      allocatedMinor: 0, status: 'posted', methodId: null, cashAccountId: null, reference: '', notes: p.reason, journalId, ...tx.stamp() });
    ledger(tx, { distributorId: d.id, date: p.date, type: 'credit_adjustment', description: `إشعار دائن: ${p.reason}`, debitMinor: 0, creditMinor: amount, sourceType: 'payment', sourceId: pref.id, journalId });
    changeBal(tx, d, { ledger: -amount, unallocated: amount });
  }
  tx.audit({ module: 'distributors', action: 'adjust', recordId: d.id, after: p, reason: p.reason });
  return { id: d.id };
});

// ------------------------------------------------------------------ batches
mutation('batches.create', S.batchCreate, ['batches', 'create'], async (tx, i) => {
  const st = await tx.settings();
  const d = await loadDist(tx, i.distributorId);
  if (d.status !== 'active') throw fail.state('لا يمكن تسليم كروت لموزع غير نشط');
  const lines = i.lines.map((l: { categoryId: string; quantity: number; unitPrice?: number }) => {
    const cat = st.lists.cardCategories.find((c) => c.id === l.categoryId && c.active !== false);
    if (!cat) throw fail.invalid('فئة الكروت غير موجودة أو غير مفعلة');
    const custom = l.unitPrice !== undefined && toMinor(l.unitPrice) !== cat.unitPriceMinor;
    if (custom && tx.ctx.actor.kind !== 'owner' && !tx.ctx.actor.permissions?.batches?.includes('approve')) throw fail.denied('تعديل سعر الوحدة عن سعر الفئة يتطلب صلاحية الاعتماد');
    return { categoryId: cat.id, categoryName: cat.name, quantity: l.quantity, unitPriceMinor: l.unitPrice !== undefined ? toMinor(l.unitPrice) : cat.unitPriceMinor };
  });
  const pct = d.commissionPct ?? st.finance.defaultCommissionPct;
  const totals = computeBatchTotals(lines, pct, st.finance.precision);
  const batchNo = await tx.nextNumber('batch');
  const ref = tx.ref('batches');
  const doc = { batchNo, distributorId: d.id, distributorCode: d.code, distributorName: d.name, region: d.region, deliveryDate: i.deliveryDate, status: 'draft', commissionPct: pct,
    lines: totals.lines, grossMinor: totals.grossMinor, commissionMinor: totals.commissionMinor, netMinor: totals.netMinor, paidMinor: 0, settlement: 'unpaid', allocOpen: false,
    settlementDate: null, journalId: null, notes: i.notes, ...tx.stamp() };
  tx.create(ref, doc);
  tx.audit({ module: 'batches', action: 'create', recordId: ref.id, after: doc });
  const b = { ...(doc as unknown as Batch), id: ref.id };
  let nb = newBatches.get(tx); if (!nb) { nb = new Map(); newBatches.set(tx, nb); } nb.set(ref.id, b);
  let delivery: unknown = null;
  if (i.deliverNow) delivery = await deliver(tx, b, i.overrideReason);
  return { id: ref.id, batchNo, ...totals, delivery };
});

/** Batches created earlier in the same transaction (not yet readable from Firestore). */
const newBatches = new WeakMap<Tx, Map<string, Batch>>();
async function deliver(tx: Tx, b: Batch, overrideReason?: string, forced = false) {
  if (b.status !== 'draft') throw fail.state('الدفعة ليست في حالة «جديدة»');
  const st = await tx.settings();
  const d = await loadDist(tx, b.distributorId);
  if (d.status !== 'active') throw fail.state('الموزع غير نشط');
  const limit = d.creditLimitMinor ?? st.finance.defaultCreditLimitMinor;
  const after = creditExposure(d.bal.ledger, d.bal.custodyGross + b.grossMinor, d.bal.custodyNet + b.netMinor, st.finance.exposureBasis);
  const warnings: string[] = [];
  if (after > limit && !forced) {
    const msg = `التعرض بعد التسليم ${formatMoney(after)} يتجاوز الحد الائتماني ${formatMoney(limit)} للموزع ${d.name}`;
    if (st.finance.creditPolicy === 'block') {
      if (!overrideReason) throw fail.state(msg + ' — أدخل سبب التجاوز لطلب الاعتماد');
      const r = await requestOrExecute(tx, { type: 'batch.creditOverride', module: 'batches', reason: overrideReason, summary: `دفعة #${b.batchNo}: ${msg}`, payload: { id: b.id, reason: overrideReason } });
      return { delivered: r.executed, approvalId: r.approvalId, warnings: [msg] };
    }
    warnings.push(msg);
    await tx.notify({ type: 'credit_limit', title: 'تجاوز الحد الائتماني', body: msg, link: `/distributors/${d.id}`, module: 'distributors', action: 'view', dedupeKey: `credit_${d.id}_${tx.ctx.today}` });
  }
  tx.update(tx.ref('batches', b.id), { status: 'open', deliveredAt: FieldValue.serverTimestamp(), deliveredBy: tx.ctx.actor.uid, ...tx.stamp(false) });
  b.status = 'open';
  changeBal(tx, d, { custodyGross: b.grossMinor, custodyNet: b.netMinor });
  tx.audit({ module: 'batches', action: 'deliver', recordId: b.id, after: { status: 'open', exposureAfter: after, limit }, reason: overrideReason });
  return { delivered: true, warnings };
}

mutation('batches.deliver', S.batchDeliver, ['batches', 'edit'], async (tx, i) => {
  const b = await tx.must<Batch>(tx.ref('batches', i.id), 'الدفعة');
  return deliver(tx, b, i.overrideReason);
});
executor('batch.creditOverride', async (tx, p) => {
  const b = newBatches.get(tx)?.get(p.id) ?? await tx.must<Batch>(tx.ref('batches', p.id), 'الدفعة');
  return deliver(tx, b, p.reason, true);
});

mutation('batches.finalize', S.batchFinalize, ['batches', 'approve'], async (tx, i) => {
  const ref = tx.ref('batches', i.id);
  const b = await tx.must<Batch>(ref, 'الدفعة');
  if (b.status === 'finalized') throw fail.state('الدفعة معتمدة مسبقاً — لا يمكن اعتمادها مرتين');
  if (b.status !== 'open') throw fail.state('يمكن اعتماد الدفعات المفتوحة (المسلّمة) فقط');
  if (i.settlementDate < b.deliveryDate) throw fail.invalid('تاريخ الاعتماد لا يمكن أن يسبق تاريخ التسليم');
  if (i.settlementDate > tx.ctx.today) throw fail.invalid('تاريخ الاعتماد لا يمكن أن يكون في المستقبل');
  const d = await loadDist(tx, b.distributorId);
  const journalId = await tx.journal({ date: i.settlementDate, memo: `اعتماد دفعة #${b.batchNo} — ${d.name}`, lines: journals.batchFinalized(d.id, b), source: { type: 'batch', id: b.id } });
  tx.update(ref, { status: 'finalized', settlementDate: i.settlementDate, finalizedAt: FieldValue.serverTimestamp(), finalizedBy: tx.ctx.actor.uid, finalizedByName: tx.ctx.actor.displayName,
    journalId, allocOpen: true, settlement: 'unpaid', ...tx.stamp(false) });
  ledger(tx, { distributorId: d.id, date: i.settlementDate, type: 'batch', description: `دفعة #${b.batchNo} معتمدة (إجمالي ${formatMoney(b.grossMinor)} − عمولة ${b.commissionPct}%)`,
    debitMinor: b.netMinor, creditMinor: 0, sourceType: 'batch', sourceId: b.id, journalId });
  changeBal(tx, d, { custodyGross: -b.grossMinor, custodyNet: -b.netMinor, ledger: b.netMinor, finalizedNet: b.netMinor });
  tx.audit({ module: 'batches', action: 'finalize', recordId: b.id, before: { status: 'open' }, after: { status: 'finalized', settlementDate: i.settlementDate, netMinor: b.netMinor } });
  return { id: b.id, journalId, netMinor: b.netMinor };
});

mutation('batches.return', S.batchReturn, ['batches', 'edit'], async (tx, i) => {
  const ref = tx.ref('batches', i.id);
  const b = await tx.must<Batch>(ref, 'الدفعة');
  if (b.status !== 'open') throw fail.state('يمكن إرجاع الدفعات المفتوحة فقط');
  const d = await loadDist(tx, b.distributorId);
  tx.update(ref, { status: 'returned', returnedDate: i.date, returnReason: i.reason, ...tx.stamp(false) });
  changeBal(tx, d, { custodyGross: -b.grossMinor, custodyNet: -b.netMinor });
  tx.audit({ module: 'batches', action: 'return', recordId: b.id, before: { status: 'open' }, after: { status: 'returned' }, reason: i.reason });
  return { id: b.id };
});

mutation('batches.cancel', S.idReason, ['batches', 'cancel'], async (tx, i) => {
  const ref = tx.ref('batches', i.id);
  const b = await tx.must<Batch>(ref, 'الدفعة');
  if (b.status === 'finalized')
    return requestOrExecute(tx, { type: 'batch.cancelFinalized', module: 'batches', reason: i.reason, summary: `إلغاء الدفعة المعتمدة #${b.batchNo} (${formatMoney(b.netMinor)})`, payload: { id: b.id, reason: i.reason } });
  if (b.status !== 'draft' && b.status !== 'open') throw fail.state('لا يمكن إلغاء هذه الدفعة في حالتها الحالية');
  if (b.status === 'open') changeBal(tx, await loadDist(tx, b.distributorId), { custodyGross: -b.grossMinor, custodyNet: -b.netMinor });
  tx.update(ref, { status: 'cancelled', cancelReason: i.reason, ...tx.stamp(false) });
  tx.audit({ module: 'batches', action: 'cancel', recordId: b.id, before: { status: b.status }, after: { status: 'cancelled' }, reason: i.reason });
  return { executed: true, id: b.id };
});
executor('batch.cancelFinalized', async (tx, p) => {
  const ref = tx.ref('batches', p.id);
  const b = await tx.must<Batch>(ref, 'الدفعة');
  if (b.status !== 'finalized') throw fail.state('الدفعة لم تعد معتمدة');
  const d = await loadDist(tx, b.distributorId);
  await voidAllocationsForTarget(tx, d, 'batch', b.id);
  const journalId = await tx.reverseJournal(b.journalId!, tx.ctx.today, `عكس اعتماد الدفعة #${b.batchNo}: ${p.reason}`);
  ledger(tx, { distributorId: d.id, date: tx.ctx.today, type: 'reversal', description: `إلغاء الدفعة المعتمدة #${b.batchNo}: ${p.reason}`, debitMinor: 0, creditMinor: b.netMinor, sourceType: 'batch', sourceId: b.id, journalId });
  changeBal(tx, d, { ledger: -b.netMinor, finalizedNet: -b.netMinor });
  tx.update(ref, { status: 'cancelled', cancelReason: p.reason, reversalJournalId: journalId, allocOpen: false, paidMinor: 0, settlement: 'unpaid', ...tx.stamp(false) });
  tx.audit({ module: 'batches', action: 'cancelFinalized', recordId: b.id, before: { status: 'finalized' }, after: { status: 'cancelled' }, reason: p.reason });
  return { id: b.id };
});

// ------------------------------------------------------------------ allocations
async function openTargets(tx: Tx, distributorId: string): Promise<Map<string, Target & { ref: DocumentReference }>> {
  const [batches, charges] = await Promise.all([
    tx.query<Batch>(tx.col('batches').where('distributorId', '==', distributorId).where('allocOpen', '==', true)),
    tx.query<{ date: string; amountMinor: Minor; paidMinor: Minor }>(tx.col('distributor_charges').where('distributorId', '==', distributorId).where('allocOpen', '==', true)),
  ]);
  const m = new Map<string, Target & { ref: DocumentReference }>();
  for (const b of batches) m.set(`batch:${b.id}`, { id: b.id, type: 'batch', date: b.settlementDate!, amountMinor: b.netMinor, paidMinor: b.paidMinor || 0, ref: tx.ref('batches', b.id) });
  for (const c of charges) m.set(`charge:${c.id}`, { id: c.id, type: 'charge', date: c.date, amountMinor: c.amountMinor, paidMinor: c.paidMinor || 0, ref: tx.ref('distributor_charges', c.id) });
  return m;
}
function writeTarget(tx: Tx, t: Target & { ref: DocumentReference }) {
  const open = t.paidMinor < t.amountMinor;
  tx.update(t.ref, { paidMinor: t.paidMinor, allocOpen: open, ...(t.type === 'batch' ? { settlement: settlementOf(t.paidMinor, t.amountMinor) } : {}) });
}

type AllocInput = { mode: 'none' | 'fifo' | 'manual'; items: { targetType: 'batch' | 'charge'; targetId: string; amount: number }[] };
async function allocate(tx: Tx, p: { id: string; distributorId: string; date: string; receiptNo: string }, available: Minor, alloc: AllocInput): Promise<Minor> {
  if (alloc.mode === 'none' || available <= 0) return 0;
  const targets = await openTargets(tx, p.distributorId);
  let plan: { key: string; amountMinor: Minor }[];
  if (alloc.mode === 'fifo') {
    const r = fifoAllocate([...targets.entries()].map(([key, t]) => ({ id: key, date: t.date, outstandingMinor: t.amountMinor - t.paidMinor })), available);
    plan = r.allocations.map((a) => ({ key: a.id, amountMinor: a.amountMinor }));
  } else {
    plan = alloc.items.map((it) => ({ key: `${it.targetType}:${it.targetId}`, amountMinor: toMinor(it.amount) }));
    const total = plan.reduce((a, x) => a + x.amountMinor, 0);
    if (total > available) throw fail.invalid('مجموع التخصيص يتجاوز مبلغ السند');
    const seen = new Set<string>();
    for (const x of plan) {
      if (seen.has(x.key)) throw fail.invalid('لا يمكن تكرار نفس الدفعة في التخصيص'); seen.add(x.key);
      const t = targets.get(x.key);
      if (!t) throw fail.invalid('لا يمكن التخصيص إلا لدفعات معتمدة غير مسددة أو أرصدة مدينة لنفس الموزع');
      if (x.amountMinor > t.amountMinor - t.paidMinor) throw fail.invalid('مبلغ التخصيص يتجاوز المتبقي على الدفعة');
    }
  }
  let sum = 0;
  for (const x of plan) {
    const t = targets.get(x.key)!;
    t.paidMinor += x.amountMinor; sum += x.amountMinor;
    writeTarget(tx, t);
    tx.create(tx.ref('payment_allocations'), { paymentId: p.id, receiptNo: p.receiptNo, distributorId: p.distributorId, targetType: t.type, targetId: t.id, amountMinor: x.amountMinor,
      date: p.date, status: 'active', ...tx.stamp() });
  }
  return sum;
}

/** Voids allocations; the released amounts return to the payments' unallocated balance. */
async function voidAllocations(tx: Tx, d: Dist, allocs: { id: string; paymentId: string; targetType: 'batch' | 'charge'; targetId: string; amountMinor: Minor }[], skipPaymentId?: string) {
  const payments = new Map<string, Payment>();
  for (const a of allocs) {
    const tref = tx.ref(a.targetType === 'batch' ? 'batches' : 'distributor_charges', a.targetId);
    const t = await tx.must<{ netMinor?: Minor; amountMinor?: Minor; paidMinor: Minor; status: string }>(tref, 'هدف التخصيص');
    const amount = (a.targetType === 'batch' ? t.netMinor : t.amountMinor)!;
    const paid = t.paidMinor - a.amountMinor;
    tx.update(tref, { paidMinor: paid, allocOpen: t.status === 'finalized' || t.status === 'posted' ? paid < amount : false, ...(a.targetType === 'batch' ? { settlement: settlementOf(paid, amount) } : {}) });
    tx.update(tx.ref('payment_allocations', a.id), { status: 'void', voidedAt: FieldValue.serverTimestamp(), voidedBy: tx.ctx.actor.uid });
    if (a.paymentId !== skipPaymentId) {
      if (!payments.has(a.paymentId)) payments.set(a.paymentId, await tx.must<Payment>(tx.ref('payments', a.paymentId), 'السند'));
      payments.get(a.paymentId)!.allocatedMinor -= a.amountMinor;
    }
  }
  let released = 0;
  for (const a of allocs) released += a.amountMinor;
  for (const p of payments.values()) tx.update(tx.ref('payments', p.id), { allocatedMinor: p.allocatedMinor });
  changeBal(tx, d, { unallocated: released });
  return released;
}
async function voidAllocationsForTarget(tx: Tx, d: Dist, type: 'batch' | 'charge', id: string) {
  const allocs = await tx.query<{ paymentId: string; targetType: 'batch' | 'charge'; targetId: string; amountMinor: Minor }>(
    tx.col('payment_allocations').where('targetId', '==', id).where('status', '==', 'active'));
  return voidAllocations(tx, d, allocs.filter((a) => a.targetType === type));
}

// ------------------------------------------------------------------ payments
mutation('payments.create', S.paymentCreate, ['payments', 'create'], async (tx, i) => {
  const st = await tx.settings();
  const d = await loadDist(tx, i.distributorId);
  if (d.status === 'closed') throw fail.state('حساب الموزع مغلق');
  if (!st.lists.paymentMethods.some((m) => m.id === i.methodId)) throw fail.invalid('طريقة السداد غير معروفة');
  const fx = await tx.fx(i.currency, i.amount, i.date, i.rate, i.rateDate, i.rateSource);
  const receiptNo = await tx.code('receipt', 'R-', 6);
  const ref = tx.ref('payments');
  const journalId = await tx.journal({ date: i.date, memo: `سند قبض ${receiptNo} — ${d.name}`, lines: journals.receipt(d.id, i.cashAccountId, fx.baseMinor), source: { type: 'payment', id: ref.id } });
  const cashTxId = await tx.cashMove({ accountId: i.cashAccountId, date: i.date, direction: 'in', originalMinor: fx.originalMinor, currency: fx.currency, rate: fx.rate, baseMinor: fx.baseMinor,
    type: 'distributor_receipt', flowClass: 'operating', sourceType: 'payment', sourceId: ref.id, journalId, description: `سند قبض ${receiptNo} — ${d.name}` });
  const allocated = await allocate(tx, { id: ref.id, distributorId: d.id, date: i.date, receiptNo }, fx.baseMinor, i.allocation);
  const doc = { receiptNo, kind: 'receipt', distributorId: d.id, distributorName: d.name, distributorCode: d.code, date: i.date, ...fx, methodId: i.methodId,
    cashAccountId: i.cashAccountId, reference: i.reference, notes: i.notes, allocatedMinor: allocated, status: 'posted', journalId, cashTxId, ...tx.stamp() };
  tx.create(ref, doc);
  ledger(tx, { distributorId: d.id, date: i.date, type: 'receipt', description: `سند قبض ${receiptNo}${fx.currency !== st.finance.baseCurrency ? ` (${fx.currency} × ${fx.rate})` : ''}`,
    debitMinor: 0, creditMinor: fx.baseMinor, sourceType: 'payment', sourceId: ref.id, journalId });
  changeBal(tx, d, { ledger: -fx.baseMinor, collected: fx.baseMinor, unallocated: fx.baseMinor - allocated },
    { lastPaymentDate: !d.lastPaymentDate || i.date > d.lastPaymentDate ? i.date : d.lastPaymentDate });
  tx.audit({ module: 'payments', action: 'create', recordId: ref.id, after: doc });
  return { id: ref.id, receiptNo, baseMinor: fx.baseMinor, allocatedMinor: allocated, unallocatedMinor: fx.baseMinor - allocated };
});

mutation('payments.reallocate', S.paymentReallocate, ['payments', 'approve'], async (tx, i) => {
  const ref = tx.ref('payments', i.id);
  const p = await tx.must<Payment>(ref, 'السند');
  if (p.status !== 'posted') throw fail.state('السند ملغى');
  const d = await loadDist(tx, p.distributorId);
  const current = await tx.query<{ paymentId: string; targetType: 'batch' | 'charge'; targetId: string; amountMinor: Minor }>(tx.col('payment_allocations').where('paymentId', '==', p.id).where('status', '==', 'active'));
  const released = await voidAllocations(tx, d, current, p.id);
  // targets were updated in place; re-read is avoided by recomputing on fresh openTargets (reads happen before flush, so adjust manually)
  const allocated = await allocateAfterRelease(tx, p, current, i.allocation);
  tx.update(ref, { allocatedMinor: allocated, ...tx.stamp(false) });
  changeBal(tx, d, { unallocated: -allocated });
  tx.audit({ module: 'payments', action: 'reallocate', recordId: p.id, before: { allocatedMinor: p.allocatedMinor, released }, after: { allocatedMinor: allocated, mode: i.allocation.mode }, reason: i.reason });
  return { id: p.id, allocatedMinor: allocated };
});

/** Allocate after voiding this payment's previous allocations (targets' paid amounts reflect the release). */
async function allocateAfterRelease(tx: Tx, p: Payment, released: { targetType: 'batch' | 'charge'; targetId: string; amountMinor: Minor }[], alloc: AllocInput) {
  const targets = await openTargets(tx, p.distributorId);
  // include fully-paid targets that the release reopened
  for (const r of released) {
    const key = `${r.targetType}:${r.targetId}`;
    if (!targets.has(key)) {
      const tref = tx.ref(r.targetType === 'batch' ? 'batches' : 'distributor_charges', r.targetId);
      const t = await tx.must<{ netMinor?: Minor; amountMinor?: Minor; paidMinor: Minor; settlementDate?: string; date?: string }>(tref, 'هدف التخصيص');
      targets.set(key, { id: r.targetId, type: r.targetType, date: (t.settlementDate || t.date)!, amountMinor: (t.netMinor ?? t.amountMinor)!, paidMinor: t.paidMinor, ref: tref });
    }
    targets.get(key)!.paidMinor -= r.amountMinor;
  }
  for (const [k, t] of targets) if (t.paidMinor >= t.amountMinor) targets.delete(k);
  if (alloc.mode === 'none') { for (const t of targets.values()) writeTarget(tx, t); return 0; }
  let plan: { key: string; amountMinor: Minor }[];
  if (alloc.mode === 'fifo') plan = fifoAllocate([...targets.entries()].map(([key, t]) => ({ id: key, date: t.date, outstandingMinor: t.amountMinor - t.paidMinor })), p.baseMinor).allocations.map((a) => ({ key: a.id, amountMinor: a.amountMinor }));
  else {
    plan = alloc.items.map((it) => ({ key: `${it.targetType}:${it.targetId}`, amountMinor: toMinor(it.amount) }));
    if (plan.reduce((a, x) => a + x.amountMinor, 0) > p.baseMinor) throw fail.invalid('مجموع التخصيص يتجاوز مبلغ السند');
    for (const x of plan) { const t = targets.get(x.key); if (!t || x.amountMinor > t.amountMinor - t.paidMinor) throw fail.invalid('تخصيص غير صالح'); }
  }
  let sum = 0;
  for (const x of plan) {
    const t = targets.get(x.key)!;
    t.paidMinor += x.amountMinor; sum += x.amountMinor;
    tx.create(tx.ref('payment_allocations'), { paymentId: p.id, receiptNo: p.receiptNo, distributorId: p.distributorId, targetType: t.type, targetId: t.id, amountMinor: x.amountMinor, date: p.date, status: 'active', ...tx.stamp() });
  }
  for (const t of targets.values()) writeTarget(tx, t);
  return sum;
}

mutation('payments.cancel', S.idReason, ['payments', 'cancel'], async (tx, i) => {
  const p = await tx.must<Payment>(tx.ref('payments', i.id), 'السند');
  if (p.status !== 'posted') throw fail.state('السند ملغى مسبقاً');
  return requestOrExecute(tx, { type: 'payment.cancel', module: 'payments', reason: i.reason, summary: `إلغاء السند ${p.receiptNo} بمبلغ ${formatMoney(p.baseMinor)}`, payload: { id: p.id, reason: i.reason } });
});
executor('payment.cancel', async (tx, x) => {
  const ref = tx.ref('payments', x.id);
  const p = await tx.must<Payment>(ref, 'السند');
  if (p.status !== 'posted') throw fail.state('السند ملغى مسبقاً');
  const d = await loadDist(tx, p.distributorId);
  const allocs = await tx.query<{ paymentId: string; targetType: 'batch' | 'charge'; targetId: string; amountMinor: Minor }>(tx.col('payment_allocations').where('paymentId', '==', p.id).where('status', '==', 'active'));
  await voidAllocations(tx, d, allocs, p.id);
  const journalId = await tx.reverseJournal(p.journalId, tx.ctx.today, `إلغاء السند ${p.receiptNo}: ${x.reason}`);
  if (p.kind === 'receipt' && p.cashAccountId)
    await tx.cashMove({ accountId: p.cashAccountId, date: tx.ctx.today, direction: 'out', originalMinor: p.originalMinor, currency: p.currency, rate: p.rate, baseMinor: p.baseMinor,
      type: 'reversal', flowClass: 'operating', sourceType: 'payment', sourceId: p.id, journalId, description: `عكس السند ${p.receiptNo}`, allowNegative: true });
  ledger(tx, { distributorId: d.id, date: tx.ctx.today, type: 'reversal', description: `إلغاء السند ${p.receiptNo}: ${x.reason}`, debitMinor: p.baseMinor, creditMinor: 0, sourceType: 'payment', sourceId: p.id, journalId });
  changeBal(tx, d, { ledger: p.baseMinor, collected: p.kind === 'receipt' ? -p.baseMinor : 0, unallocated: -p.baseMinor });
  tx.update(ref, { status: 'cancelled', allocatedMinor: 0, cancelReason: x.reason, reversalJournalId: journalId, cancelledAt: FieldValue.serverTimestamp(), cancelledBy: tx.ctx.actor.uid });
  tx.audit({ module: 'payments', action: 'cancel', recordId: p.id, before: { status: 'posted' }, after: { status: 'cancelled' }, reason: x.reason });
  return { id: p.id };
});

// ------------------------------------------------------------------ collection follow-up
mutation('collection.upsert', S.followUp, ['collection', 'create'], async (tx, i) => {
  const d = await loadDist(tx, i.distributorId);
  const ref = i.id ? tx.ref('collection_followups', i.id) : tx.ref('collection_followups');
  const data = { distributorId: d.id, distributorName: d.name, distributorCode: d.code, nextFollowUpDate: i.nextFollowUpDate, contactStatus: i.contactStatus,
    promisedAmountMinor: i.promisedAmount !== undefined ? toMinor(i.promisedAmount) : null, promiseDate: i.promiseDate ?? null, notes: i.notes,
    assignedTo: i.assignedTo ?? tx.ctx.actor.uid, outstandingMinor: d.bal.ledger, lastPaymentDate: d.lastPaymentDate ?? null };
  if (i.id) { await tx.must(ref, 'المتابعة'); tx.update(ref, { ...data, ...tx.stamp(false) }); } else tx.create(ref, { ...data, ...tx.stamp() });
  tx.audit({ module: 'collection', action: i.id ? 'update' : 'create', recordId: ref.id, after: data });
  return { id: ref.id };
});

export const _internal = { allocate, z };
