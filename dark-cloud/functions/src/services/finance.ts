import { FieldValue } from 'firebase-admin/firestore';
import {
  S, journals, toMinor, applyRate, formatMoney, weightedAverageCost, monthlyDepreciation, monthRange, roundHalfUp, reverseLines, can,
  type Minor, type JournalLine,
} from '@dc/shared';
import { executor, mutation } from '../core/registry';
import { fail } from '../core/errors';
import type { Tx } from '../core/tx';
import { requestOrExecute } from './approvals';

const canApprove = (tx: Tx, m: Parameters<typeof can>[1]) => can(tx.ctx.actor, m, 'approve');
const settle = (paid: Minor, total: Minor) => (paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partial');

// ================================================================== CASH & TREASURY
interface CashAcc { id: string; name: string; type: string; currency: string; balanceMinor: Minor; status: string }

mutation('cash.createAccount', S.cashAccountCreate, ['cash', 'manage'], async (tx, i) => {
  const ref = tx.ref('cash_accounts');
  const st = await tx.settings();
  if (!st.lists.currencies.some((c) => c.code === i.currency && c.active)) throw fail.invalid('العملة غير مفعلة');
  const sign = i.openingBalance >= 0 ? 1 : -1;
  const fx = i.openingBalance !== 0 ? await tx.fx(i.currency, Math.abs(i.openingBalance), i.openingDate, i.rate) : null;
  tx.create(ref, { name: i.name, type: i.type, currency: i.currency, openingMinor: fx ? sign * fx.originalMinor : 0, balanceMinor: fx ? sign * fx.originalMinor : 0,
    balanceBaseMinor: fx ? sign * fx.baseMinor : 0, status: 'active', openingDate: i.openingDate, ...tx.stamp() });
  if (fx) {
    const journalId = await tx.journal({ date: i.openingDate, memo: `رصيد افتتاحي — ${i.name}`, lines: journals.cashOpening(ref.id, sign * fx.baseMinor), source: { type: 'cash_opening', id: ref.id } });
    tx.create(tx.ref('cash_transactions'), { accountId: ref.id, accountName: i.name, date: i.openingDate, direction: sign > 0 ? 'in' : 'out', originalMinor: fx.originalMinor, currency: i.currency,
      rate: fx.rate, baseMinor: fx.baseMinor, type: 'opening', flowClass: 'opening', sourceType: 'cash_account', sourceId: ref.id, journalId, description: 'رصيد افتتاحي', atMs: tx.ctx.now.getTime(), ...tx.stamp() });
  }
  tx.audit({ module: 'cash', action: 'createAccount', recordId: ref.id, after: i });
  return { id: ref.id };
});

mutation('cash.setStatus', S.idReason, ['cash', 'manage'], async (tx, i) => {
  const ref = tx.ref('cash_accounts', i.id);
  const a = await tx.must<CashAcc>(ref, 'الحساب');
  const status = a.status === 'active' ? 'inactive' : 'active';
  tx.update(ref, { status, ...tx.stamp(false) });
  tx.audit({ module: 'cash', action: 'status', recordId: i.id, before: { status: a.status }, after: { status }, reason: i.reason });
  return { status };
});

mutation('cash.transfer', S.cashTransfer, ['cash', 'create'], async (tx, i) => {
  if (i.fromId === i.toId) throw fail.invalid('لا يمكن التحويل إلى نفس الحساب');
  const from = await tx.must<CashAcc>(tx.ref('cash_accounts', i.fromId), 'الحساب المحوَّل منه');
  const to = await tx.must<CashAcc>(tx.ref('cash_accounts', i.toId), 'الحساب المحوَّل إليه');
  if (from.currency !== to.currency) throw fail.invalid('التحويل متاح بين حسابين بنفس العملة فقط');
  const fx = await tx.fx(from.currency, i.amount, i.date);
  const no = await tx.code('transfer', 'TR-', 6);
  const ref = tx.ref('cash_transfers');
  const journalId = await tx.journal({ date: i.date, memo: `تحويل داخلي ${no}: ${from.name} ← ${to.name}`, lines: journals.transfer(i.fromId, i.toId, fx.baseMinor), source: { type: 'transfer', id: ref.id } });
  const common = { date: i.date, originalMinor: fx.originalMinor, currency: fx.currency, rate: fx.rate, baseMinor: fx.baseMinor, type: 'transfer', flowClass: 'transfer' as const, sourceType: 'transfer', sourceId: ref.id, journalId };
  await tx.cashMove({ ...common, accountId: i.fromId, direction: 'out', description: `تحويل ${no} إلى ${to.name}` });
  await tx.cashMove({ ...common, accountId: i.toId, direction: 'in', description: `تحويل ${no} من ${from.name}` });
  tx.create(ref, { transferNo: no, fromId: i.fromId, toId: i.toId, fromName: from.name, toName: to.name, ...fx, date: i.date, notes: i.notes, journalId, ...tx.stamp() });
  tx.audit({ module: 'cash', action: 'transfer', recordId: ref.id, after: i });
  return { id: ref.id, transferNo: no };
});

mutation('cash.other', S.cashOther, ['cash', 'create'], async (tx, i) => {
  if (i.kind !== 'other_income' && tx.ctx.actor.kind !== 'owner' && !canApprove(tx, 'cash')) throw fail.denied('حركات رأس مال المالك تتطلب صلاحية الاعتماد');
  const a = await tx.must<CashAcc>(tx.ref('cash_accounts', i.accountId), 'الحساب');
  const fx = await tx.fx(a.currency, i.amount, i.date, i.rate);
  const ref = tx.ref('cash_vouchers');
  const no = await tx.code('voucher', 'CV-', 6);
  const lines = i.kind === 'other_income' ? journals.otherIncome(a.id, fx.baseMinor) : i.kind === 'owner_capital' ? journals.ownerCapital(a.id, fx.baseMinor) : journals.ownerWithdrawal(a.id, fx.baseMinor);
  const journalId = await tx.journal({ date: i.date, memo: `${no}: ${i.description}`, lines, source: { type: 'cash_voucher', id: ref.id } });
  await tx.cashMove({ accountId: a.id, date: i.date, direction: i.kind === 'owner_withdrawal' ? 'out' : 'in', originalMinor: fx.originalMinor, currency: fx.currency, rate: fx.rate, baseMinor: fx.baseMinor,
    type: i.kind, flowClass: i.kind === 'other_income' ? 'operating' : 'financing', sourceType: 'cash_voucher', sourceId: ref.id, journalId, description: i.description });
  tx.create(ref, { voucherNo: no, kind: i.kind, accountId: a.id, ...fx, date: i.date, description: i.description, journalId, status: 'posted', ...tx.stamp() });
  tx.audit({ module: 'cash', action: i.kind, recordId: ref.id, after: i });
  return { id: ref.id, voucherNo: no };
});

mutation('cash.reconcile', S.cashReconcile, ['cash', 'edit'], async (tx, i) => {
  const a = await tx.must<CashAcc>(tx.ref('cash_accounts', i.accountId), 'الحساب');
  const actual = toMinor(i.actualBalance);
  const diff = actual - a.balanceMinor;
  const ref = tx.ref('cash_reconciliations');
  tx.create(ref, { accountId: a.id, accountName: a.name, currency: a.currency, date: i.date, bookMinor: a.balanceMinor, actualMinor: actual, diffMinor: diff, reason: i.reason,
    status: diff === 0 ? 'matched' : 'pending', ...tx.stamp() });
  tx.audit({ module: 'cash', action: 'reconcile', recordId: ref.id, after: { book: a.balanceMinor, actual, diff }, reason: i.reason });
  if (diff === 0) return { id: ref.id, diffMinor: 0, status: 'matched' };
  if (!i.reason) throw fail.invalid('أدخل سبب الفرق');
  const r = await requestOrExecute(tx, { type: 'cash.reconcile', module: 'cash', reason: i.reason, summary: `فرق جرد ${a.name}: ${formatMoney(diff)} ${a.currency}`, payload: { reconciliationId: ref.id, accountId: a.id, diffMinor: diff, date: i.date, reason: i.reason } });
  return { id: ref.id, diffMinor: diff, ...r };
});
executor('cash.reconcile', async (tx, p) => {
  const a = await tx.must<CashAcc>(tx.ref('cash_accounts', p.accountId), 'الحساب');
  const st = await tx.settings();
  const abs = Math.abs(p.diffMinor);
  let rate = 1;
  if (a.currency !== st.finance.baseCurrency) rate = (await tx.fx(a.currency, abs / 100, p.date)).rate;
  const base = a.currency === st.finance.baseCurrency ? abs : applyRate(abs, rate, st.finance.precision);
  const signedBase = p.diffMinor > 0 ? base : -base;
  const journalId = await tx.journal({ date: p.date, memo: `تسوية فرق جرد ${a.name}: ${p.reason}`, lines: journals.cashAdjustment(a.id, signedBase), source: { type: 'cash_reconciliation', id: p.reconciliationId } });
  await tx.cashMove({ accountId: a.id, date: p.date, direction: p.diffMinor > 0 ? 'in' : 'out', originalMinor: abs, currency: a.currency, rate, baseMinor: base, type: 'adjustment', flowClass: 'operating',
    sourceType: 'cash_reconciliation', sourceId: p.reconciliationId, journalId, description: `فرق جرد: ${p.reason}`, allowNegative: true });
  tx.update(tx.ref('cash_reconciliations', p.reconciliationId), { status: 'approved', journalId, approvedBy: tx.ctx.actor.uid });
  return { journalId };
});

// ================================================================== EXPENSES
mutation('expenses.create', S.expenseCreate, ['expenses', 'create'], async (tx, i) => {
  const st = await tx.settings();
  const cat = st.lists.expenseCategories.find((c) => c.id === i.categoryId);
  if (!cat) throw fail.invalid('نوع المصروف غير معروف');
  if (!st.lists.paymentMethods.some((m) => m.id === i.methodId)) throw fail.invalid('طريقة الدفع غير معروفة');
  const fx = await tx.fx(i.currency, i.amount, i.date, i.rate, i.rateDate, i.rateSource);
  const no = await tx.code('expense', 'E-', 6);
  const ref = tx.ref('expenses');
  const journalId = await tx.journal({ date: i.date, memo: `مصروف ${no}: ${i.description}`, lines: journals.expense(cat.id, i.cashAccountId, fx.baseMinor), source: { type: 'expense', id: ref.id } });
  const cashTxId = await tx.cashMove({ accountId: i.cashAccountId, date: i.date, direction: 'out', originalMinor: fx.originalMinor, currency: fx.currency, rate: fx.rate, baseMinor: fx.baseMinor,
    type: 'expense', flowClass: 'operating', sourceType: 'expense', sourceId: ref.id, journalId, description: `${cat.name}: ${i.description}` });
  if (i.assetId) {
    const aref = tx.ref('assets', i.assetId);
    const asset = await tx.must<{ maintenanceMinor?: Minor }>(aref, 'الأصل');
    tx.update(aref, { maintenanceMinor: (asset.maintenanceMinor || 0) + fx.baseMinor });
  }
  const doc = { expenseNo: no, date: i.date, categoryId: cat.id, categoryName: cat.name, description: i.description, ...fx, cashAccountId: i.cashAccountId, methodId: i.methodId,
    supplierId: i.supplierId ?? null, assetId: i.assetId ?? null, notes: i.notes, status: 'posted', journalId, cashTxId, ...tx.stamp() };
  tx.create(ref, doc);
  tx.audit({ module: 'expenses', action: 'create', recordId: ref.id, after: doc });
  return { id: ref.id, expenseNo: no, baseMinor: fx.baseMinor };
});

mutation('expenses.cancel', S.idReason, ['expenses', 'cancel'], async (tx, i) => {
  const e = await tx.must<{ status: string; expenseNo: string; baseMinor: Minor }>(tx.ref('expenses', i.id), 'المصروف');
  if (e.status !== 'posted') throw fail.state('المصروف ملغى مسبقاً');
  return requestOrExecute(tx, { type: 'expense.cancel', module: 'expenses', reason: i.reason, summary: `إلغاء المصروف ${e.expenseNo} (${formatMoney(e.baseMinor)})`, payload: { id: i.id, reason: i.reason } });
});
executor('expense.cancel', async (tx, p) => {
  const ref = tx.ref('expenses', p.id);
  const e = await tx.must<{ status: string; expenseNo: string; baseMinor: Minor; originalMinor: Minor; currency: string; rate: number; cashAccountId: string; journalId: string; assetId?: string | null }>(ref, 'المصروف');
  if (e.status !== 'posted') throw fail.state('المصروف ملغى مسبقاً');
  const journalId = await tx.reverseJournal(e.journalId, tx.ctx.today, `إلغاء المصروف ${e.expenseNo}: ${p.reason}`);
  await tx.cashMove({ accountId: e.cashAccountId, date: tx.ctx.today, direction: 'in', originalMinor: e.originalMinor, currency: e.currency, rate: e.rate, baseMinor: e.baseMinor, type: 'reversal', flowClass: 'operating',
    sourceType: 'expense', sourceId: p.id, journalId, description: `عكس المصروف ${e.expenseNo}` });
  if (e.assetId) { const a = await tx.must<{ maintenanceMinor?: Minor }>(tx.ref('assets', e.assetId), 'الأصل'); tx.update(tx.ref('assets', e.assetId), { maintenanceMinor: (a.maintenanceMinor || 0) - e.baseMinor }); }
  tx.update(ref, { status: 'cancelled', cancelReason: p.reason, reversalJournalId: journalId, ...tx.stamp(false) });
  tx.audit({ module: 'expenses', action: 'cancel', recordId: p.id, reason: p.reason });
  return { id: p.id };
});

// ================================================================== SUPPLIERS
interface Supplier { id: string; code: string; name: string; status: string; bal: { ledger: Minor; purchases: Minor; paid: Minor } }
const supBal = (s: Supplier) => Object.assign({ ledger: 0, purchases: 0, paid: 0 }, s.bal || {});
function supLedger(tx: Tx, e: { supplierId: string; date: string; type: string; description: string; creditMinor: Minor; debitMinor: Minor; sourceType: string; sourceId: string; journalId: string | null }) {
  // credit = increases what we owe; debit = decreases it
  tx.create(tx.ref('supplier_ledger'), { ...e, atMs: tx.ctx.now.getTime(), ...tx.stamp() });
}

mutation('suppliers.create', S.supplierCreate, ['suppliers', 'create'], async (tx, i) => {
  const opening = toMinor(i.openingBalance);
  if (opening !== 0 && tx.ctx.actor.kind !== 'owner' && !canApprove(tx, 'suppliers')) throw fail.denied('الرصيد الافتتاحي للمورد يتطلب صلاحية الاعتماد');
  const code = await tx.code('supplier', 'S', 4);
  const ref = tx.ref('suppliers', code);
  const doc = { code, name: i.name, phone: i.phone, address: i.address, email: i.email, preferredCurrency: i.preferredCurrency, openingMinor: opening, notes: i.notes, status: 'active',
    bal: { ledger: opening, purchases: 0, paid: 0 }, ...tx.stamp() };
  tx.create(ref, doc);
  if (opening !== 0) {
    const date = i.openingDate ?? tx.ctx.today;
    const journalId = await tx.journal({ date, memo: `رصيد افتتاحي للمورد ${code}`, lines: journals.supplierOpening(code, opening), source: { type: 'supplier_opening', id: code } });
    supLedger(tx, { supplierId: code, date, type: 'opening', description: 'رصيد افتتاحي', creditMinor: Math.max(opening, 0), debitMinor: Math.max(-opening, 0), sourceType: 'supplier', sourceId: code, journalId });
  }
  tx.audit({ module: 'suppliers', action: 'create', recordId: code, after: doc });
  return { id: code, code };
});

mutation('suppliers.update', S.supplierUpdate, ['suppliers', 'edit'], async (tx, i) => {
  const ref = tx.ref('suppliers', i.id);
  const before = await tx.must<Record<string, unknown>>(ref, 'المورد');
  const { id, ...patch } = i;
  tx.update(ref, { ...patch, ...tx.stamp(false) });
  tx.audit({ module: 'suppliers', action: 'update', recordId: id, before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null])), after: patch });
  return { id };
});

mutation('suppliers.pay', S.supplierPay, ['suppliers', 'create'], async (tx, i) => {
  const sref = tx.ref('suppliers', i.supplierId);
  const s = await tx.must<Supplier>(sref, 'المورد');
  const fx = await tx.fx(i.currency, i.amount, i.date, i.rate, i.rateDate, i.rateSource);
  let flowClass: 'operating' | 'investing' = 'operating';
  let purchase: { id: string; totalBaseMinor: Minor; paidBaseMinor: Minor; classification: string; supplierId: string; status: string; purchaseNo: string } | null = null;
  if (i.purchaseId) {
    purchase = await tx.must(tx.ref('purchases', i.purchaseId), 'المشتريات');
    if (purchase!.supplierId !== s.id || purchase!.status !== 'approved') throw fail.invalid('فاتورة المشتريات لا تخص هذا المورد أو غير معتمدة');
    if (fx.baseMinor > purchase!.totalBaseMinor - purchase!.paidBaseMinor) throw fail.invalid('المبلغ يتجاوز المتبقي على فاتورة المشتريات');
    if (purchase!.classification === 'capital') flowClass = 'investing';
  }
  const no = await tx.code('supplierPayment', 'SP-', 6);
  const ref = tx.ref('supplier_payments');
  const journalId = await tx.journal({ date: i.date, memo: `سداد مورد ${no} — ${s.name}`, lines: journals.supplierPayment(s.id, i.cashAccountId, fx.baseMinor), source: { type: 'supplier_payment', id: ref.id } });
  const cashTxId = await tx.cashMove({ accountId: i.cashAccountId, date: i.date, direction: 'out', originalMinor: fx.originalMinor, currency: fx.currency, rate: fx.rate, baseMinor: fx.baseMinor,
    type: 'supplier_payment', flowClass, sourceType: 'supplier_payment', sourceId: ref.id, journalId, description: `سداد ${s.name} ${no}` });
  if (purchase) {
    const paid = purchase.paidBaseMinor + fx.baseMinor;
    tx.update(tx.ref('purchases', purchase.id), { paidBaseMinor: paid, payState: settle(paid, purchase.totalBaseMinor) });
  }
  const bal = supBal(s);
  tx.update(sref, { bal: { ...bal, ledger: bal.ledger - fx.baseMinor, paid: bal.paid + fx.baseMinor }, ...tx.stamp(false) });
  supLedger(tx, { supplierId: s.id, date: i.date, type: 'payment', description: `سداد ${no}${purchase ? ` (فاتورة ${purchase.purchaseNo})` : ''}`, creditMinor: 0, debitMinor: fx.baseMinor, sourceType: 'supplier_payment', sourceId: ref.id, journalId });
  const doc = { paymentNo: no, supplierId: s.id, supplierName: s.name, date: i.date, ...fx, cashAccountId: i.cashAccountId, methodId: i.methodId, purchaseId: i.purchaseId ?? null, notes: i.notes, status: 'posted', journalId, cashTxId, flowClass, ...tx.stamp() };
  tx.create(ref, doc);
  tx.audit({ module: 'suppliers', action: 'pay', recordId: ref.id, after: doc });
  return { id: ref.id, paymentNo: no };
});

mutation('suppliers.cancelPayment', S.idReason, ['suppliers', 'cancel'], async (tx, i) => {
  const p = await tx.must<{ status: string; paymentNo: string; baseMinor: Minor }>(tx.ref('supplier_payments', i.id), 'سند السداد');
  if (p.status !== 'posted') throw fail.state('السند ملغى مسبقاً');
  return requestOrExecute(tx, { type: 'supplierPayment.cancel', module: 'suppliers', reason: i.reason, summary: `إلغاء سداد المورد ${p.paymentNo} (${formatMoney(p.baseMinor)})`, payload: { id: i.id, reason: i.reason } });
});
executor('supplierPayment.cancel', async (tx, x) => {
  const ref = tx.ref('supplier_payments', x.id);
  const p = await tx.must<{ status: string; paymentNo: string; baseMinor: Minor; originalMinor: Minor; currency: string; rate: number; cashAccountId: string; journalId: string; supplierId: string; purchaseId: string | null; flowClass: 'operating' | 'investing' }>(ref, 'السند');
  if (p.status !== 'posted') throw fail.state('السند ملغى مسبقاً');
  const s = await tx.must<Supplier>(tx.ref('suppliers', p.supplierId), 'المورد');
  const journalId = await tx.reverseJournal(p.journalId, tx.ctx.today, `إلغاء سداد ${p.paymentNo}: ${x.reason}`);
  await tx.cashMove({ accountId: p.cashAccountId, date: tx.ctx.today, direction: 'in', originalMinor: p.originalMinor, currency: p.currency, rate: p.rate, baseMinor: p.baseMinor, type: 'reversal', flowClass: p.flowClass,
    sourceType: 'supplier_payment', sourceId: x.id, journalId, description: `عكس ${p.paymentNo}` });
  if (p.purchaseId) {
    const pu = await tx.must<{ paidBaseMinor: Minor; totalBaseMinor: Minor }>(tx.ref('purchases', p.purchaseId), 'المشتريات');
    const paid = pu.paidBaseMinor - p.baseMinor;
    tx.update(tx.ref('purchases', p.purchaseId), { paidBaseMinor: paid, payState: settle(paid, pu.totalBaseMinor) });
  }
  const bal = supBal(s);
  tx.update(tx.ref('suppliers', s.id), { bal: { ...bal, ledger: bal.ledger + p.baseMinor, paid: bal.paid - p.baseMinor } });
  supLedger(tx, { supplierId: s.id, date: tx.ctx.today, type: 'reversal', description: `إلغاء ${p.paymentNo}: ${x.reason}`, creditMinor: p.baseMinor, debitMinor: 0, sourceType: 'supplier_payment', sourceId: x.id, journalId });
  tx.update(ref, { status: 'cancelled', cancelReason: x.reason, reversalJournalId: journalId });
  tx.audit({ module: 'suppliers', action: 'cancelPayment', recordId: x.id, reason: x.reason });
  return { id: x.id };
});

// ================================================================== PURCHASES
interface PLine { description: string; itemId: string | null; warehouseId: string | null; quantity: number; unitPriceMinor: Minor; totalMinor: Minor; baseMinor: Minor }
interface Purchase { id: string; purchaseNo: string; date: string; supplierId: string | null; classification: 'operational' | 'capital'; currency: string; rate: number; rateDate: string; rateSource: string;
  lines: PLine[]; totalOriginalMinor: Minor; totalBaseMinor: Minor; paidOriginalMinor: Minor; paidBaseMinor: Minor; paidAtApprovalMinor?: Minor; cashAccountId: string | null; methodId: string | null;
  status: string; createdBy: string; asset: Record<string, unknown> | null; assetId?: string | null; journalId?: string | null; categoryId: string }

mutation('purchases.create', S.purchaseCreate, ['purchases', 'create'], async (tx, i) => {
  const st = await tx.settings();
  if (i.classification === 'capital' && !i.asset) throw fail.invalid('المشتريات الرأسمالية تتطلب بيانات الأصل');
  if (i.supplierId) await tx.must(tx.ref('suppliers', i.supplierId), 'المورد');
  const fx = await tx.fx(i.currency, 1, i.date, i.rate, i.rateDate, i.rateSource);
  const lines: PLine[] = [];
  for (const l of i.lines) {
    if (l.itemId) {
      if (i.classification === 'capital') throw fail.invalid('لا يمكن ربط أصناف مخزنية بمشتريات رأسمالية');
      await tx.must(tx.ref('inventory_items', l.itemId), 'الصنف');
      if (!l.warehouseId) throw fail.invalid('حدد المخزن لكل صنف مخزني');
      await tx.must(tx.ref('warehouses', l.warehouseId), 'المخزن');
    }
    const unitPriceMinor = toMinor(l.unitPrice);
    const totalMinor = roundHalfUp(unitPriceMinor * l.quantity);
    const baseMinor = fx.currency === st.finance.baseCurrency ? totalMinor : applyRate(totalMinor, fx.rate, st.finance.precision);
    lines.push({ description: l.description, itemId: l.itemId ?? null, warehouseId: l.warehouseId ?? null, quantity: l.quantity, unitPriceMinor, totalMinor, baseMinor });
  }
  const totalOriginalMinor = lines.reduce((a, l) => a + l.totalMinor, 0);
  const totalBaseMinor = lines.reduce((a, l) => a + l.baseMinor, 0);
  const paidOriginalMinor = toMinor(i.paidAmount);
  if (paidOriginalMinor > totalOriginalMinor) throw fail.invalid('المبلغ المدفوع يتجاوز إجمالي الفاتورة');
  if (paidOriginalMinor > 0 && !i.cashAccountId) throw fail.invalid('حدد الحساب النقدي للمبلغ المدفوع');
  if (paidOriginalMinor < totalOriginalMinor && !i.supplierId) throw fail.invalid('المشتريات الآجلة (غير المدفوعة بالكامل) تتطلب تحديد المورد');
  const paidBaseMinor = paidOriginalMinor === totalOriginalMinor ? totalBaseMinor : fx.currency === st.finance.baseCurrency ? paidOriginalMinor : applyRate(paidOriginalMinor, fx.rate, st.finance.precision);
  const no = await tx.code('purchase', 'P-', 6);
  const ref = tx.ref('purchases');
  const doc = { purchaseNo: no, date: i.date, supplierId: i.supplierId ?? null, classification: i.classification, categoryId: i.categoryId, currency: fx.currency, rate: fx.rate, rateDate: fx.rateDate,
    rateSource: fx.rateSource, lines, totalOriginalMinor, totalBaseMinor, paidOriginalMinor, paidBaseMinor, cashAccountId: i.cashAccountId ?? null, methodId: i.methodId ?? null, payState: 'unpaid',
    status: 'pending', notes: i.notes, asset: i.asset ?? null, assetId: null, journalId: null, ...tx.stamp() };
  tx.create(ref, doc);
  tx.audit({ module: 'purchases', action: 'create', recordId: ref.id, after: doc });
  await tx.notify({ type: 'approval', title: 'مشتريات بانتظار الاعتماد', body: `${no} بمبلغ ${formatMoney(totalBaseMinor)}`, link: '/purchases', module: 'purchases', action: 'approve', excludeUid: tx.ctx.actor.uid });
  return { id: ref.id, purchaseNo: no, totalBaseMinor };
});

/** Approval = goods received: posts the journal once, pays the paid part, receives stock, registers the asset. */
mutation('purchases.approve', S.idOnly, ['purchases', 'approve'], async (tx, i) => {
  const ref = tx.ref('purchases', i.id);
  const p = await tx.must<Purchase>(ref, 'المشتريات');
  if (p.status !== 'pending') throw fail.state('المشتريات ليست بانتظار الاعتماد');
  if (p.createdBy === tx.ctx.actor.uid && tx.ctx.actor.kind !== 'owner') throw fail.denied('لا يمكنك اعتماد مشتريات أدخلتها بنفسك (فصل المهام)');
  const st = await tx.settings();
  const parts = { capital: 0, inventory: 0, operational: 0 };
  for (const l of p.lines) parts[p.classification === 'capital' ? 'capital' : l.itemId ? 'inventory' : 'operational'] += l.baseMinor;
  let lines: JournalLine[];
  try { lines = journals.purchaseSplit(parts, p.paidBaseMinor, p.cashAccountId, p.supplierId); } catch (e) { throw fail.invalid('بيانات الدفع غير مكتملة: ' + (e as Error).message); }
  const journalId = await tx.journal({ date: p.date, memo: `مشتريات ${p.purchaseNo}`, lines, source: { type: 'purchase', id: p.id } });
  const flowClass = p.classification === 'capital' ? 'investing' : 'operating';
  if (p.paidBaseMinor > 0)
    await tx.cashMove({ accountId: p.cashAccountId!, date: p.date, direction: 'out', originalMinor: p.paidOriginalMinor, currency: p.currency, rate: p.rate, baseMinor: p.paidBaseMinor,
      type: 'purchase', flowClass, sourceType: 'purchase', sourceId: p.id, journalId, description: `مشتريات ${p.purchaseNo}` });
  if (p.supplierId) {
    const s = await tx.must<Supplier>(tx.ref('suppliers', p.supplierId), 'المورد');
    const bal = supBal(s);
    tx.update(tx.ref('suppliers', s.id), { bal: { ledger: bal.ledger + p.totalBaseMinor - p.paidBaseMinor, purchases: bal.purchases + p.totalBaseMinor, paid: bal.paid + p.paidBaseMinor } });
    supLedger(tx, { supplierId: s.id, date: p.date, type: 'purchase', description: `فاتورة مشتريات ${p.purchaseNo}`, creditMinor: p.totalBaseMinor, debitMinor: 0, sourceType: 'purchase', sourceId: p.id, journalId });
    if (p.paidBaseMinor > 0) supLedger(tx, { supplierId: s.id, date: p.date, type: 'payment', description: `مدفوع عند الشراء ${p.purchaseNo}`, creditMinor: 0, debitMinor: p.paidBaseMinor, sourceType: 'purchase', sourceId: p.id, journalId });
  }
  // stock receipt
  const items = new Map<string, { qtyTotal: number; avgCostMinor: Minor; stock: Record<string, number>; name: string }>();
  for (const l of p.lines.filter((x) => x.itemId)) {
    if (!items.has(l.itemId!)) items.set(l.itemId!, await tx.must(tx.ref('inventory_items', l.itemId!), 'الصنف'));
    const it = items.get(l.itemId!)!;
    const unitCost = roundHalfUp(l.baseMinor / l.quantity);
    it.avgCostMinor = weightedAverageCost(it.qtyTotal, it.avgCostMinor, l.quantity, unitCost);
    it.qtyTotal += l.quantity;
    it.stock = { ...(it.stock || {}), [l.warehouseId!]: ((it.stock || {})[l.warehouseId!] || 0) + l.quantity };
    tx.create(tx.ref('inventory_movements'), { itemId: l.itemId, itemName: it.name, type: 'receipt', date: p.date, quantity: l.quantity, warehouseId: l.warehouseId, toWarehouseId: null,
      unitCostMinor: unitCost, valueMinor: l.baseMinor, reference: p.purchaseNo, notes: l.description, sourceType: 'purchase', sourceId: p.id, journalId, ...tx.stamp() });
  }
  for (const [id, it] of items) tx.update(tx.ref('inventory_items', id), { qtyTotal: it.qtyTotal, avgCostMinor: it.avgCostMinor, stock: it.stock });
  // capital asset
  let assetId: string | null = null;
  if (p.classification === 'capital' && p.asset) {
    const a = p.asset as { name: string; categoryId: string; location: string; responsible: string; warrantyUntil?: string; usefulLifeMonths?: number; residualValue?: number; inServiceDate?: string };
    const code = await tx.code('asset', 'A', 4);
    assetId = code;
    tx.create(tx.ref('assets', code), { code, name: a.name, categoryId: a.categoryId, purchaseDate: p.date, supplierId: p.supplierId, currency: p.currency, originalMinor: p.totalOriginalMinor, rate: p.rate,
      costMinor: p.totalBaseMinor, location: a.location, responsible: a.responsible, warrantyUntil: a.warrantyUntil ?? null, usefulLifeMonths: a.usefulLifeMonths ?? null,
      residualMinor: a.residualValue !== undefined ? toMinor(a.residualValue) : null, inServiceDate: a.inServiceDate ?? null, status: 'in_service', accumulatedDepMinor: 0, maintenanceMinor: 0,
      source: 'purchase', purchaseId: p.id, notes: '', ...tx.stamp() });
  }
  tx.update(ref, { status: 'approved', journalId, assetId, paidAtApprovalMinor: p.paidBaseMinor, payState: settle(p.paidBaseMinor, p.totalBaseMinor), approvedBy: tx.ctx.actor.uid,
    approvedByName: tx.ctx.actor.displayName, approvedAt: FieldValue.serverTimestamp() });
  tx.audit({ module: 'purchases', action: 'approve', recordId: p.id, after: { journalId, assetId, parts } });
  void st;
  return { id: p.id, journalId, assetId };
});

mutation('purchases.cancel', S.idReason, ['purchases', 'cancel'], async (tx, i) => {
  const ref = tx.ref('purchases', i.id);
  const p = await tx.must<Purchase>(ref, 'المشتريات');
  if (p.status === 'pending') {
    tx.update(ref, { status: 'cancelled', cancelReason: i.reason, ...tx.stamp(false) });
    tx.audit({ module: 'purchases', action: 'cancel', recordId: p.id, reason: i.reason });
    return { executed: true };
  }
  if (p.status !== 'approved') throw fail.state('المشتريات ملغاة مسبقاً');
  return requestOrExecute(tx, { type: 'purchase.cancel', module: 'purchases', reason: i.reason, summary: `إلغاء المشتريات المعتمدة ${p.purchaseNo} (${formatMoney(p.totalBaseMinor)})`, payload: { id: p.id, reason: i.reason } });
});
executor('purchase.cancel', async (tx, x) => {
  const ref = tx.ref('purchases', x.id);
  const p = await tx.must<Purchase>(ref, 'المشتريات');
  if (p.status !== 'approved') throw fail.state('المشتريات ليست معتمدة');
  if (p.paidBaseMinor !== (p.paidAtApprovalMinor ?? 0)) throw fail.state('توجد سدادات مورد مرتبطة بهذه الفاتورة — ألغِها أولاً');
  if (p.assetId) {
    const a = await tx.must<{ accumulatedDepMinor: Minor }>(tx.ref('assets', p.assetId), 'الأصل');
    if (a.accumulatedDepMinor > 0) throw fail.state('تم احتساب إهلاك على الأصل — لا يمكن إلغاء الشراء');
    tx.update(tx.ref('assets', p.assetId), { status: 'cancelled' });
  }
  const today = tx.ctx.today;
  for (const l of p.lines.filter((y) => y.itemId)) {
    const it = await tx.must<{ qtyTotal: number; stock: Record<string, number>; avgCostMinor: Minor; name: string }>(tx.ref('inventory_items', l.itemId!), 'الصنف');
    if ((it.stock?.[l.warehouseId!] || 0) < l.quantity) throw fail.state(`لا يمكن الإلغاء: تم صرف جزء من الصنف «${it.name}»`);
    tx.update(tx.ref('inventory_items', l.itemId!), { qtyTotal: it.qtyTotal - l.quantity, stock: { ...it.stock, [l.warehouseId!]: it.stock[l.warehouseId!] - l.quantity } });
    tx.create(tx.ref('inventory_movements'), { itemId: l.itemId, itemName: it.name, type: 'return', date: today, quantity: -l.quantity, warehouseId: l.warehouseId, unitCostMinor: roundHalfUp(l.baseMinor / l.quantity),
      valueMinor: -l.baseMinor, reference: p.purchaseNo, notes: 'إلغاء مشتريات', sourceType: 'purchase', sourceId: p.id, ...tx.stamp() });
  }
  const journalId = await tx.reverseJournal(p.journalId!, today, `إلغاء المشتريات ${p.purchaseNo}: ${x.reason}`);
  if (p.paidBaseMinor > 0)
    await tx.cashMove({ accountId: p.cashAccountId!, date: today, direction: 'in', originalMinor: p.paidOriginalMinor, currency: p.currency, rate: p.rate, baseMinor: p.paidBaseMinor, type: 'reversal',
      flowClass: p.classification === 'capital' ? 'investing' : 'operating', sourceType: 'purchase', sourceId: p.id, journalId, description: `استرداد مشتريات ملغاة ${p.purchaseNo}` });
  if (p.supplierId) {
    const s = await tx.must<Supplier>(tx.ref('suppliers', p.supplierId), 'المورد');
    const bal = supBal(s);
    tx.update(tx.ref('suppliers', s.id), { bal: { ledger: bal.ledger - (p.totalBaseMinor - p.paidBaseMinor), purchases: bal.purchases - p.totalBaseMinor, paid: bal.paid - p.paidBaseMinor } });
    supLedger(tx, { supplierId: s.id, date: today, type: 'reversal', description: `إلغاء فاتورة ${p.purchaseNo}`, creditMinor: p.paidBaseMinor, debitMinor: p.totalBaseMinor, sourceType: 'purchase', sourceId: p.id, journalId });
  }
  tx.update(ref, { status: 'cancelled', cancelReason: x.reason, reversalJournalId: journalId });
  tx.audit({ module: 'purchases', action: 'cancelApproved', recordId: p.id, reason: x.reason });
  return { id: p.id };
});

// ================================================================== INVENTORY
interface Item { id: string; code: string; name: string; qtyTotal: number; avgCostMinor: Minor; stock: Record<string, number>; minQuantity: number }

mutation('inventory.createWarehouse', S.warehouseCreate, ['inventory', 'manage'], async (tx, i) => {
  const ref = tx.ref('warehouses');
  tx.create(ref, { name: i.name, location: i.location, status: 'active', ...tx.stamp() });
  tx.audit({ module: 'inventory', action: 'createWarehouse', recordId: ref.id, after: i });
  return { id: ref.id };
});
mutation('inventory.createItem', S.itemCreate, ['inventory', 'create'], async (tx, i) => {
  const code = await tx.code('item', 'I', 4);
  const doc = { code, ...i, supplierId: i.supplierId ?? null, status: 'active', qtyTotal: 0, avgCostMinor: 0, stock: {}, ...tx.stamp() };
  tx.create(tx.ref('inventory_items', code), doc);
  tx.audit({ module: 'inventory', action: 'createItem', recordId: code, after: doc });
  return { id: code, code };
});
mutation('inventory.updateItem', S.itemUpdate, ['inventory', 'edit'], async (tx, i) => {
  const ref = tx.ref('inventory_items', i.id);
  await tx.must(ref, 'الصنف');
  const { id, ...patch } = i;
  tx.update(ref, { ...patch, ...tx.stamp(false) });
  tx.audit({ module: 'inventory', action: 'updateItem', recordId: id, after: patch });
  return { id };
});

mutation('inventory.move', S.inventoryMove, ['inventory', 'create'], async (tx, i) => {
  const st = await tx.settings();
  const ref = tx.ref('inventory_items', i.itemId);
  const it = await tx.must<Item>(ref, 'الصنف');
  await tx.must(tx.ref('warehouses', i.warehouseId), 'المخزن');
  const onHand = it.stock?.[i.warehouseId] || 0;
  if (i.type === 'count' || i.type === 'damage') {
    const delta = i.type === 'count' ? i.quantity - onHand : -i.quantity;
    if (i.type === 'damage' && i.quantity <= 0) throw fail.invalid('الكمية يجب أن تكون أكبر من صفر');
    if (delta === 0) {
      tx.create(tx.ref('inventory_movements'), { itemId: it.id, itemName: it.name, type: 'count', date: i.date, quantity: 0, warehouseId: i.warehouseId, unitCostMinor: it.avgCostMinor, valueMinor: 0, reference: i.reference, notes: 'مطابق — ' + i.notes, ...tx.stamp() });
      return { executed: true, delta: 0 };
    }
    return requestOrExecute(tx, { type: 'inventory.adjust', module: 'inventory', reason: i.notes || (i.type === 'count' ? 'فرق جرد فعلي' : 'تالف'),
      summary: `${i.type === 'count' ? 'فرق جرد' : 'تالف'} ${it.name}: ${delta > 0 ? '+' : ''}${delta}`, payload: { itemId: it.id, warehouseId: i.warehouseId, delta, type: i.type, date: i.date, reference: i.reference, notes: i.notes } });
  }
  if (!(i.quantity > 0)) throw fail.invalid('الكمية يجب أن تكون أكبر من صفر');
  const stock = { ...(it.stock || {}) };
  let journalId: string | null = null;
  const cost = roundHalfUp(i.quantity * it.avgCostMinor);
  if (i.type === 'issue' || i.type === 'transfer') {
    if (onHand < i.quantity && !st.finance.allowNegativeInventory) throw fail.state(`الكمية المتاحة من «${it.name}» في هذا المخزن ${onHand} فقط`);
    stock[i.warehouseId] = onHand - i.quantity;
  }
  if (i.type === 'transfer') {
    if (!i.toWarehouseId || i.toWarehouseId === i.warehouseId) throw fail.invalid('حدد مخزناً مختلفاً للتحويل');
    await tx.must(tx.ref('warehouses', i.toWarehouseId), 'المخزن');
    stock[i.toWarehouseId] = (stock[i.toWarehouseId] || 0) + i.quantity;
  }
  if (i.type === 'return') stock[i.warehouseId] = onHand + i.quantity;
  const qtyTotal = i.type === 'issue' ? it.qtyTotal - i.quantity : i.type === 'return' ? it.qtyTotal + i.quantity : it.qtyTotal;
  if (cost > 0 && i.type === 'issue') journalId = await tx.journal({ date: i.date, memo: `صرف مخزني ${it.name} × ${i.quantity}`, lines: journals.inventoryIssue(cost), source: { type: 'inventory', id: it.id } });
  if (cost > 0 && i.type === 'return') journalId = await tx.journal({ date: i.date, memo: `إرجاع للمخزن ${it.name} × ${i.quantity}`, lines: reverseLines(journals.inventoryIssue(cost)), source: { type: 'inventory', id: it.id } });
  tx.update(ref, { stock, qtyTotal, ...tx.stamp(false) });
  const mref = tx.ref('inventory_movements');
  tx.create(mref, { itemId: it.id, itemName: it.name, type: i.type, date: i.date, quantity: i.type === 'issue' ? -i.quantity : i.quantity, warehouseId: i.warehouseId, toWarehouseId: i.toWarehouseId ?? null,
    unitCostMinor: it.avgCostMinor, valueMinor: i.type === 'transfer' ? 0 : i.type === 'issue' ? -cost : cost, reference: i.reference, notes: i.notes, journalId, ...tx.stamp() });
  if (qtyTotal < (it.minQuantity || 0) && st.system.lowStockAlerts)
    await tx.notify({ type: 'low_stock', title: 'انخفاض المخزون', body: `${it.name}: الكمية ${qtyTotal} أقل من الحد الأدنى ${it.minQuantity}`, link: '/inventory', module: 'inventory', action: 'view', dedupeKey: `low_${it.id}_${tx.ctx.today}` });
  tx.audit({ module: 'inventory', action: i.type, recordId: mref.id, after: i });
  return { id: mref.id };
});
executor('inventory.adjust', async (tx, p) => {
  const st = await tx.settings();
  const ref = tx.ref('inventory_items', p.itemId);
  const it = await tx.must<Item>(ref, 'الصنف');
  const onHand = it.stock?.[p.warehouseId] || 0;
  if (onHand + p.delta < 0 && !st.finance.allowNegativeInventory) throw fail.state('الكمية بعد التسوية ستكون سالبة');
  const value = roundHalfUp(p.delta * it.avgCostMinor);
  const journalId = value !== 0 ? await tx.journal({ date: p.date, memo: `تسوية مخزون ${it.name} (${p.delta})`, lines: journals.inventoryAdjustment(value), source: { type: 'inventory', id: it.id } }) : null;
  tx.update(ref, { stock: { ...(it.stock || {}), [p.warehouseId]: onHand + p.delta }, qtyTotal: it.qtyTotal + p.delta });
  tx.create(tx.ref('inventory_movements'), { itemId: it.id, itemName: it.name, type: p.type, date: p.date, quantity: p.delta, warehouseId: p.warehouseId, unitCostMinor: it.avgCostMinor, valueMinor: value,
    reference: p.reference, notes: p.notes, journalId, ...tx.stamp() });
  tx.audit({ module: 'inventory', action: 'adjust', recordId: it.id, after: p });
  return { journalId };
});

// ================================================================== FIXED ASSETS
mutation('assets.create', S.assetCreate, ['assets', 'create'], async (tx, i) => {
  if (tx.ctx.actor.kind !== 'owner' && !canApprove(tx, 'assets')) throw fail.denied('تسجيل أصل قائم (رصيد افتتاحي) يتطلب صلاحية الاعتماد');
  const fx = await tx.fx(i.currency, i.cost, i.purchaseDate, i.rate, i.rateDate, i.rateSource);
  const code = await tx.code('asset', 'A', 4);
  const journalId = await tx.journal({ date: i.purchaseDate, memo: `أصل قائم مسجل كرصيد افتتاحي ${code}: ${i.name}`,
    lines: [{ account: '1500', debit: fx.baseMinor, credit: 0 }, { account: '3000', debit: 0, credit: fx.baseMinor }], source: { type: 'asset_opening', id: code } });
  const doc = { code, name: i.name, categoryId: i.categoryId, purchaseDate: i.purchaseDate, supplierId: i.supplierId ?? null, currency: fx.currency, originalMinor: fx.originalMinor, rate: fx.rate,
    costMinor: fx.baseMinor, location: i.location, responsible: i.responsible, warrantyUntil: i.warrantyUntil ?? null, usefulLifeMonths: i.usefulLifeMonths ?? null,
    residualMinor: i.residualValue !== undefined ? toMinor(i.residualValue) : null, inServiceDate: i.inServiceDate ?? null, status: 'in_service', accumulatedDepMinor: 0, maintenanceMinor: 0,
    source: 'opening', purchaseId: null, journalId, notes: i.notes, ...tx.stamp() };
  tx.create(tx.ref('assets', code), doc);
  tx.audit({ module: 'assets', action: 'create', recordId: code, after: doc });
  return { id: code, code };
});
mutation('assets.update', S.assetUpdate, ['assets', 'edit'], async (tx, i) => {
  const ref = tx.ref('assets', i.id);
  const before = await tx.must<Record<string, unknown>>(ref, 'الأصل');
  const { id, residualValue, ...rest } = i;
  const patch: Record<string, unknown> = { ...rest };
  if (residualValue !== undefined) patch.residualMinor = toMinor(residualValue);
  if ((patch.usefulLifeMonths !== undefined || patch.residualMinor !== undefined) && (before.accumulatedDepMinor as number) > 0 && tx.ctx.actor.kind !== 'owner')
    throw fail.denied('تعديل سياسة الإهلاك بعد بدء الإهلاك متاح للمدير العام فقط');
  tx.update(ref, { ...patch, ...tx.stamp(false) });
  tx.audit({ module: 'assets', action: 'update', recordId: id, before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null])), after: patch });
  return { id };
});
mutation('assets.runDepreciation', S.depreciationRun, ['assets', 'approve'], async (tx, i) => {
  const st = await tx.settings();
  const [y, m] = i.month.split('-').map(Number);
  const { to } = monthRange(y, m);
  if (`${i.month}-01` > tx.ctx.today) throw fail.invalid('لا يمكن احتساب إهلاك لشهر مستقبلي');
  const assets = await tx.query<{ code: string; name: string; costMinor: Minor; residualMinor: Minor | null; usefulLifeMonths: number | null; inServiceDate: string | null; accumulatedDepMinor: Minor; status: string }>(
    tx.col('assets').where('status', '==', 'in_service'));
  let total = 0; const done: { id: string; amount: Minor }[] = []; const skipped: string[] = [];
  for (const a of assets) {
    if (!a.usefulLifeMonths || a.residualMinor == null || !a.inServiceDate) { skipped.push(`${a.code}: سياسة الإهلاك غير محددة`); continue; }
    if (a.inServiceDate > to) continue;
    const eref = tx.ref('depreciation_entries', `${a.id}_${i.month}`);
    if (await tx.read(eref)) continue;
    const amount = Math.min(monthlyDepreciation(a.costMinor, a.residualMinor, a.usefulLifeMonths, st.finance.precision), a.costMinor - a.residualMinor - a.accumulatedDepMinor);
    if (amount <= 0) continue;
    total += amount; done.push({ id: a.id, amount });
    tx.create(eref, { assetId: a.id, month: i.month, amountMinor: amount, ...tx.stamp() });
    tx.update(tx.ref('assets', a.id), { accumulatedDepMinor: a.accumulatedDepMinor + amount });
  }
  let journalId: string | null = null;
  if (total > 0) journalId = await tx.journal({ date: to, memo: `إهلاك شهر ${i.month}`, lines: journals.depreciation(total), source: { type: 'depreciation', id: i.month } });
  tx.audit({ module: 'assets', action: 'depreciation', recordId: i.month, after: { total, done, skipped } });
  return { totalMinor: total, assets: done.length, skipped, journalId };
});
