import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { orderBy, where, limit } from 'firebase/firestore';
import { Plus, ArrowLeftRight, Scale, HandCoins, XCircle, CheckCircle2, Trash2, Wallet } from 'lucide-react';
import { CASH_TYPE_LABELS, PURCHASE_STATUS_LABELS, PAY_STATE_LABELS, formatDate, formatMoney } from '@dc/shared';
import { useAuth } from '../lib/auth';
import { useCollection, useDoc, useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { tsDate, major } from '../lib/format';
import { Badge, Button, Card, DataView, Field, FormModal, Grid, Input, Kpi, Note, PageHeader, Select, Stat, Textarea, useToast, Loading, ErrorBox, Empty, useReasonPrompt, Tabs, Modal, Chips } from '../components/ui';
import { Money, DocStatus, Documents, History, today, useCashAccounts, useSupplierOptions, CurrencyFields, num } from './common';

// ================================================================== CASH
export function CashPage() {
  const { can, settings } = useAuth();
  const nav = useNavigate();
  const acc = useCollection<any>('cash_accounts', [orderBy('name')]);
  const recs = useCollection<any>('cash_reconciliations', [orderBy('date', 'desc'), limit(50)]);
  const [m, setM] = useState<'' | 'new' | 'transfer' | 'other' | 'reconcile'>('');
  const totalBase = acc.data.filter((a) => a.currency === settings.finance.baseCurrency).reduce((s, a) => s + a.balanceMinor, 0);
  return (
    <>
      <PageHeader title="الصناديق والحسابات" subtitle="الأرصدة بعملة كل حساب. التحويلات الداخلية ليست إيراداً ولا مصروفاً." crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'الصناديق' }]}
        actions={<>
          {can('cash', 'manage') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setM('new')}>حساب جديد</Button>}
          {can('cash', 'create') && <Button icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => setM('transfer')}>تحويل داخلي</Button>}
          {can('cash', 'create') && <Button icon={<HandCoins className="h-4 w-4" />} onClick={() => setM('other')}>سند نقدي آخر</Button>}
          {can('cash', 'edit') && <Button icon={<Scale className="h-4 w-4" />} onClick={() => setM('reconcile')}>جرد صندوق</Button>}
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`إجمالي الحسابات بالريال اليمني`} value={<Money v={totalBase} />} basis="cash" tone="ok" />
        {acc.data.filter((a) => a.currency !== settings.finance.baseCurrency).map((a) => <Kpi key={a.id} label={a.name} value={<Money v={a.balanceMinor} currency={a.currency} />} basis="cash" tone="gold" />)}
      </div>
      <DataView rows={acc.data} loading={acc.loading} error={acc.error} onRowClick={(a) => nav(`/cash/${a.id}`)} exportName="cash-accounts" title="تقرير الحسابات النقدية" emptyTitle="لا توجد حسابات نقدية" emptyHint="أنشئ الصندوق الرئيسي أولاً — مطلوب لتسجيل السدادات والمصروفات."
        columns={[
          { key: 'name', label: 'الحساب', mobile: 'title' },
          { key: 'type', label: 'النوع', mobile: 'sub', value: (a) => CASH_TYPE_LABELS[a.type as keyof typeof CASH_TYPE_LABELS] },
          { key: 'currency', label: 'العملة', mobile: 'meta' },
          { key: 'status', label: 'الحالة', mobile: 'meta', render: (a) => <Badge tone={a.status === 'active' ? 'ok' : 'neutral'}>{a.status === 'active' ? 'نشط' : 'غير نشط'}</Badge>, value: (a) => a.status },
          { key: 'balance', label: 'الرصيد الدفتري', align: 'end', mobile: 'amount', value: (a) => major(a.balanceMinor), render: (a) => <Money v={a.balanceMinor} currency={a.currency} /> },
        ]} />
      <h2 className="mb-2 mt-6 text-sm font-bold">آخر عمليات الجرد</h2>
      <DataView rows={recs.data} loading={recs.loading} error={recs.error} exportName="reconciliations" emptyTitle="لا توجد عمليات جرد" columns={[
        { key: 'date', label: 'التاريخ', mobile: 'sub', value: (r) => formatDate(r.date) }, { key: 'accountName', label: 'الحساب', mobile: 'title' },
        { key: 'book', label: 'الدفتري', align: 'end', value: (r) => major(r.bookMinor), render: (r) => <Money v={r.bookMinor} /> },
        { key: 'actual', label: 'الفعلي', align: 'end', value: (r) => major(r.actualMinor), render: (r) => <Money v={r.actualMinor} /> },
        { key: 'diff', label: 'الفرق', align: 'end', mobile: 'amount', value: (r) => major(r.diffMinor), render: (r) => <Money v={r.diffMinor} /> },
        { key: 'status', label: 'الحالة', mobile: 'meta', value: (r) => r.status, render: (r) => <Badge tone={r.status === 'matched' || r.status === 'approved' ? 'ok' : 'warn'}>{r.status === 'matched' ? 'مطابق' : r.status === 'approved' ? 'معتمد ومُسوّى' : 'بانتظار الاعتماد'}</Badge> },
        { key: 'reason', label: 'السبب', value: (r) => r.reason || '—' }, { key: 'by', label: 'المسؤول', value: (r) => r.createdByName },
      ]} />
      {m === 'new' && <CashAccountForm onClose={() => setM('')} />}
      {m === 'transfer' && <TransferForm onClose={() => setM('')} />}
      {m === 'other' && <OtherForm onClose={() => setM('')} />}
      {m === 'reconcile' && <ReconcileForm onClose={() => setM('')} />}
    </>
  );
}
function CashAccountForm({ onClose }: { onClose: () => void }) {
  const toast = useToast(); const { settings } = useAuth();
  const [f, setF] = useState({ name: '', type: 'cash', currency: settings.finance.baseCurrency, openingBalance: '', openingDate: today(), rate: '' });
  return (
    <FormModal open onClose={onClose} title="حساب نقدي جديد" onSubmit={async () => { await api('cash.createAccount', { ...f, openingBalance: num(f.openingBalance) ?? 0, rate: num(f.rate) }); toast('تم إنشاء الحساب'); }}>
      <Grid>
        <Field label="اسم الحساب" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="الصندوق الرئيسي" /></Field>
        <Field label="النوع"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={Object.entries(CASH_TYPE_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
        <CurrencyFields currency={f.currency} rate={f.rate} onCurrency={(c) => setF({ ...f, currency: c })} onRate={(r) => setF({ ...f, rate: r })} date={f.openingDate} />
        <Field label="الرصيد الافتتاحي (بعملة الحساب)" hint="يُقيَّد مقابل حقوق الملكية/الأرصدة الافتتاحية"><Input type="number" value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} /></Field>
        <Field label="تاريخ الرصيد الافتتاحي" required><Input type="date" value={f.openingDate} onChange={(e) => setF({ ...f, openingDate: e.target.value })} /></Field>
      </Grid>
    </FormModal>
  );
}
function TransferForm({ onClose }: { onClose: () => void }) {
  const toast = useToast(); const accounts = useCashAccounts();
  const [f, setF] = useState({ fromId: '', toId: '', amount: '', date: today(), notes: '' });
  const cur = accounts.find((a) => a.value === f.fromId)?.currency;
  return (
    <FormModal open onClose={onClose} title="تحويل داخلي بين حسابين" submitLabel="تنفيذ التحويل" onSubmit={async () => { const r = await api('cash.transfer', { ...f, amount: Number(f.amount) }); toast(`تم التحويل ${r.transferNo}`); }}>
      <Note>يُنفذ التحويل كعملية واحدة ذرية: ينقص المصدر ويزيد المستلم بنفس المبلغ، ولا يُسجل كإيراد أو مصروف. التحويل بين حسابين بنفس العملة فقط.</Note>
      <Grid>
        <Field label="من حساب" required><Select value={f.fromId} onChange={(e) => setF({ ...f, fromId: e.target.value, toId: '' })} placeholder="اختر" options={accounts} /></Field>
        <Field label="إلى حساب" required><Select value={f.toId} onChange={(e) => setF({ ...f, toId: e.target.value })} placeholder="اختر" options={accounts.filter((a) => a.value !== f.fromId && (!cur || a.currency === cur))} /></Field>
        <Field label={`المبلغ${cur ? ` (${cur})` : ''}`} required><Input type="number" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="التاريخ" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </Grid>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </FormModal>
  );
}
function OtherForm({ onClose }: { onClose: () => void }) {
  const toast = useToast(); const accounts = useCashAccounts(); const { settings } = useAuth();
  const [f, setF] = useState({ accountId: '', kind: 'other_income', amount: '', date: today(), rate: '', description: '' });
  const cur = accounts.find((a) => a.value === f.accountId)?.currency;
  return (
    <FormModal open onClose={onClose} title="سند نقدي" onSubmit={async () => { const r = await api('cash.other', { ...f, amount: Number(f.amount), rate: num(f.rate) }); toast(`تم ترحيل ${r.voucherNo}`); }}>
      <Grid>
        <Field label="النوع"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[{ value: 'other_income', label: 'إيراد آخر (تشغيلي)' }, { value: 'owner_capital', label: 'إيداع رأس مال من المالك (تمويلي)' }, { value: 'owner_withdrawal', label: 'مسحوبات المالك (تمويلي — ليست مصروفاً)' }]} /></Field>
        <Field label="الحساب" required><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })} placeholder="اختر" options={accounts} /></Field>
        <Field label={`المبلغ${cur ? ` (${cur})` : ''}`} required><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="التاريخ" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        {cur && cur !== settings.finance.baseCurrency && <Field label="سعر الصرف"><Input type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>}
      </Grid>
      <Field label="البيان" required><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
    </FormModal>
  );
}
function ReconcileForm({ onClose }: { onClose: () => void }) {
  const toast = useToast(); const accounts = useCashAccounts();
  const [f, setF] = useState({ accountId: '', date: today(), actualBalance: '', reason: '' });
  const a = useDoc<any>('cash_accounts', f.accountId || undefined);
  const diff = a.data && f.actualBalance !== '' ? Math.round(Number(f.actualBalance) * 100) - a.data.balanceMinor : null;
  return (
    <FormModal open onClose={onClose} title="جرد صندوق ومطابقة" onSubmit={async () => {
      const r = await api('cash.reconcile', { ...f, actualBalance: Number(f.actualBalance) });
      toast(r.diffMinor === 0 ? 'الرصيد مطابق' : r.executed ? 'تم تسجيل الفرق وتسويته' : 'أُرسل الفرق للاعتماد', r.diffMinor === 0 || r.executed ? 'ok' : 'warn');
    }}>
      <Grid>
        <Field label="الحساب" required><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })} placeholder="اختر" options={accounts} /></Field>
        <Field label="تاريخ الجرد" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="الرصيد الدفتري"><Input disabled value={a.data ? formatMoney(a.data.balanceMinor) : ''} /></Field>
        <Field label="الرصيد الفعلي المعدود" required><Input type="number" value={f.actualBalance} onChange={(e) => setF({ ...f, actualBalance: e.target.value })} /></Field>
      </Grid>
      {diff !== null && <Note tone={diff === 0 ? 'info' : 'warn'}>الفرق: <span className="num font-bold">{formatMoney(diff)}</span> {diff === 0 ? '— مطابق' : '— يتطلب سبباً واعتماد المدير'}</Note>}
      <Field label="سبب الفرق"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
    </FormModal>
  );
}
export function CashStatementPage() {
  const { id } = useParams();
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const s = useApi<any>('reports.cashStatement', { id, from: from || undefined, to: to || undefined }, `${id}${from}${to}`);
  const TYPE: Record<string, string> = { opening: 'رصيد افتتاحي', distributor_receipt: 'سند قبض', expense: 'مصروف', purchase: 'مشتريات', supplier_payment: 'سداد مورد', transfer: 'تحويل داخلي', other_income: 'إيراد آخر', owner_capital: 'رأس مال', owner_withdrawal: 'مسحوبات', adjustment: 'فرق جرد', reversal: 'قيد عكسي' };
  return (
    <>
      <PageHeader title={s.data ? `كشف ${s.data.account.name}` : 'كشف حساب نقدي'} subtitle={s.data && <>الرصيد الحالي: <Money v={s.data.account.balanceMinor} currency={s.data.account.currency} /></>} crumbs={[{ label: 'الصناديق', to: '/cash' }, { label: 'كشف الحساب' }]} />
      <div className="no-print mb-3 flex flex-wrap gap-2"><Field label="من"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="إلى"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      {s.error && <ErrorBox message={s.error} />}
      <DataView rows={s.data?.rows ?? []} loading={s.loading} exportName={`cash-statement-${id}`} title="كشف حساب نقدي" columns={[
        { key: 'date', label: 'التاريخ', mobile: 'sub', value: (r: any) => formatDate(r.date) }, { key: 'type', label: 'النوع', mobile: 'meta', value: (r: any) => TYPE[r.type] ?? r.type },
        { key: 'description', label: 'البيان', mobile: 'title' },
        { key: 'before', label: 'الرصيد قبل', align: 'end', value: (r: any) => major(r.balanceBeforeMinor), render: (r: any) => <Money v={r.balanceBeforeMinor} /> },
        { key: 'in', label: 'وارد', align: 'end', value: (r: any) => major(r.inMinor), render: (r: any) => (r.inMinor ? <span className="text-ok"><Money v={r.inMinor} /></span> : '') },
        { key: 'out', label: 'صادر', align: 'end', value: (r: any) => major(r.outMinor), render: (r: any) => (r.outMinor ? <Money v={-r.outMinor} /> : '') },
        { key: 'after', label: 'الرصيد بعد', align: 'end', mobile: 'amount', value: (r: any) => major(r.balanceAfterMinor), render: (r: any) => <Money v={r.balanceAfterMinor} /> },
      ]} />
    </>
  );
}

// ================================================================== EXPENSES
export function ExpensesPage() {
  const { can, settings } = useAuth();
  const [sp] = useSearchParams();
  const r = useCollection<any>('expenses', [orderBy('date', 'desc'), limit(1000)]);
  const [open, setOpen] = useState(false); const [sel, setSel] = useState<any>(null); const [cat, setCat] = useState('');
  const q = sp.get('q');
  const rows = r.data.filter((e) => (!cat || e.categoryId === cat) && (!q || e.expenseNo === q));
  const month = today().slice(0, 7);
  return (
    <>
      <PageHeader title="المصروفات" subtitle="المصروفات التشغيلية تُدفع من حساب نقدي وتُقيَّد مرة واحدة فقط" crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'المصروفات' }]}
        actions={can('expenses', 'create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>مصروف جديد</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="مصروفات هذا الشهر" value={<Money v={r.data.filter((e) => e.status === 'posted' && e.date.startsWith(month)).reduce((a, e) => a + e.baseMinor, 0)} />} basis="cash" tone="bad" />
        <Kpi label="عدد القيود هذا الشهر" value={r.data.filter((e) => e.status === 'posted' && e.date.startsWith(month)).length} />
      </div>
      <DataView rows={rows} loading={r.loading} error={r.error} onRowClick={setSel} exportName="expenses" title="تقرير المصروفات" search={(e) => `${e.expenseNo} ${e.description} ${e.categoryName}`}
        toolbar={<Select aria-label="النوع" className="w-44" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="كل الأنواع" options={settings.lists.expenseCategories.map((c) => ({ value: c.id, label: c.name }))} />}
        footer={<tr><td className="px-3 py-2" colSpan={4}>الإجمالي (المرحّل)</td><td className="px-3 py-2 text-left"><Money v={rows.filter((e) => e.status === 'posted').reduce((a, e) => a + e.baseMinor, 0)} /></td><td colSpan={2} /></tr>}
        columns={[
          { key: 'expenseNo', label: 'الرقم', mobile: 'meta', render: (e) => <span className="num text-xs font-semibold">{e.expenseNo}</span> },
          { key: 'date', label: 'التاريخ', mobile: 'sub', value: (e) => formatDate(e.date) },
          { key: 'categoryName', label: 'النوع', mobile: 'meta' },
          { key: 'description', label: 'البيان', mobile: 'title' },
          { key: 'base', label: 'المعادل (ريال)', align: 'end', mobile: 'amount', value: (e) => major(e.baseMinor), render: (e) => <Money v={e.baseMinor} /> },
          { key: 'orig', label: 'الأصلي', align: 'end', value: (e) => `${major(e.originalMinor)} ${e.currency}`, render: (e) => (e.currency !== settings.finance.baseCurrency ? <span className="text-xs"><Money v={e.originalMinor} currency={e.currency} /> × {e.rate}</span> : '—') },
          { key: 'status', label: 'الحالة', render: (e) => <DocStatus s={e.status} />, value: (e) => e.status },
        ]} />
      {open && <ExpenseForm onClose={() => setOpen(false)} />}
      {sel && <ExpenseDetail e={sel} onClose={() => setSel(null)} />}
    </>
  );
}
function ExpenseForm({ onClose }: { onClose: () => void }) {
  const { settings, can } = useAuth(); const toast = useToast(); const suppliers = useSupplierOptions();
  const assets = useCollection<any>(can('assets', 'view') ? 'assets' : null, [where('status', '==', 'in_service')]);
  const [f, setF] = useState({ date: today(), categoryId: settings.lists.expenseCategories[0]?.id || '', description: '', amount: '', currency: settings.finance.baseCurrency, rate: '', cashAccountId: '', methodId: 'cash', supplierId: '', assetId: '', notes: '' });
  const accounts = useCashAccounts(f.currency);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal open onClose={onClose} title="تسجيل مصروف" wide onSubmit={async () => {
      const r = await api('expenses.create', { ...f, amount: Number(f.amount), rate: num(f.rate), supplierId: f.supplierId || undefined, assetId: f.assetId || undefined });
      toast(`تم ترحيل المصروف ${r.expenseNo}`);
    }}>
      <Grid cols={3}>
        <Field label="التاريخ" required><Input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="نوع المصروف" required><Select value={f.categoryId} onChange={set('categoryId')} options={settings.lists.expenseCategories.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="المبلغ" required><Input type="number" min="0" step="any" value={f.amount} onChange={set('amount')} /></Field>
        <CurrencyFields currency={f.currency} rate={f.rate} date={f.date} onCurrency={(c) => setF({ ...f, currency: c, cashAccountId: '' })} onRate={(r) => setF({ ...f, rate: r })} />
        <Field label="دُفع من حساب" required><Select value={f.cashAccountId} onChange={set('cashAccountId')} placeholder="اختر" options={accounts} /></Field>
        <Field label="طريقة الدفع"><Select value={f.methodId} onChange={set('methodId')} options={settings.lists.paymentMethods.map((m) => ({ value: m.id, label: m.name }))} /></Field>
        <Field label="المورد (اختياري)"><Select value={f.supplierId} onChange={set('supplierId')} placeholder="—" options={suppliers} /></Field>
        <Field label="صيانة أصل (اختياري)"><Select value={f.assetId} onChange={set('assetId')} placeholder="—" options={assets.data.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }))} /></Field>
      </Grid>
      <Field label="البيان" required><Input value={f.description} onChange={set('description')} /></Field>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={set('notes')} /></Field>
      <p className="text-xs text-muted">لا تُسجّل المشتريات هنا — استخدم صفحة المشتريات لتجنب الاحتساب المزدوج. أرفق صورة الفاتورة بعد الحفظ.</p>
    </FormModal>
  );
}
function ExpenseDetail({ e, onClose }: { e: any; onClose: () => void }) {
  const { can } = useAuth(); const toast = useToast(); const { ask, el } = useReasonPrompt();
  return (
    <Modal open onClose={onClose} title={`مصروف ${e.expenseNo}`} wide footer={<>
      {e.status === 'posted' && can('expenses', 'cancel') && <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={async () => { const r = await ask('إلغاء المصروف بقيد عكسي'); if (!r) return; try { const x = await api('expenses.cancel', { id: e.id, reason: r }); toast(x.executed ? 'تم الإلغاء' : 'أُرسل للاعتماد', x.executed ? 'ok' : 'warn'); onClose(); } catch (err: any) { toast(err.message, 'bad'); } }}>إلغاء المصروف</Button>}
      <Button onClick={onClose}>إغلاق</Button></>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><Stat label="التاريخ" value={formatDate(e.date)} /><Stat label="النوع" value={e.categoryName} /><Stat label="المعادل" value={<Money v={e.baseMinor} />} />
          {e.currency !== 'YER' && <Stat label="الأصلي × السعر" value={`${formatMoney(e.originalMinor)} ${e.currency} × ${e.rate}`} />}
          <Stat label="الحالة" value={<DocStatus s={e.status} />} /><Stat label="أدخله" value={`${e.createdByName} · ${tsDate(e.createdAt)}`} /><p className="mt-2 text-sm">{e.description}</p></Card>
        <Documents module="expenses" recordId={e.id} />
      </div>
      {el}
    </Modal>
  );
}

// ================================================================== SUPPLIERS
export function SuppliersPage() {
  const { can } = useAuth(); const nav = useNavigate();
  const r = useCollection<any>('suppliers', [orderBy('code')]);
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader title="الموردون" subtitle="أرصدة الموردين منفصلة تماماً عن أرصدة الموزعين" crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'الموردون' }]}
        actions={can('suppliers', 'create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>مورد جديد</Button>} />
      <DataView rows={r.data} loading={r.loading} error={r.error} onRowClick={(s) => nav(`/suppliers/${s.id}`)} exportName="suppliers" title="تقرير الموردين" search={(s) => `${s.code} ${s.name} ${s.phone}`}
        columns={[
          { key: 'code', label: 'الكود', mobile: 'meta' }, { key: 'name', label: 'المورد', mobile: 'title' }, { key: 'phone', label: 'الهاتف', mobile: 'sub', value: (s) => s.phone || '—' },
          { key: 'purchases', label: 'إجمالي المشتريات', align: 'end', value: (s) => major(s.bal?.purchases), render: (s) => <Money v={s.bal?.purchases} /> },
          { key: 'paid', label: 'المدفوع', align: 'end', value: (s) => major(s.bal?.paid), render: (s) => <Money v={s.bal?.paid} /> },
          { key: 'ledger', label: 'المستحق له', align: 'end', mobile: 'amount', value: (s) => major(s.bal?.ledger), render: (s) => <Money v={s.bal?.ledger} /> },
        ]} />
      {open && <SupplierForm onClose={() => setOpen(false)} />}
    </>
  );
}
function SupplierForm({ onClose, existing }: { onClose: () => void; existing?: any }) {
  const toast = useToast(); const { settings } = useAuth();
  const [f, setF] = useState(existing ?? { name: '', phone: '', address: '', email: '', preferredCurrency: settings.finance.baseCurrency, openingBalance: '', notes: '' });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal open onClose={onClose} title={existing ? 'تعديل المورد' : 'مورد جديد'} onSubmit={async () => {
      if (existing) await api('suppliers.update', { id: existing.id, name: f.name, phone: f.phone, address: f.address, email: f.email, preferredCurrency: f.preferredCurrency, notes: f.notes });
      else await api('suppliers.create', { ...f, openingBalance: num(f.openingBalance) ?? 0 });
      toast('تم الحفظ');
    }}>
      <Grid>
        <Field label="الاسم" required><Input value={f.name} onChange={set('name')} /></Field><Field label="الهاتف"><Input dir="ltr" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="البريد (اختياري)"><Input dir="ltr" value={f.email} onChange={set('email')} /></Field>
        <Field label="العملة المفضلة"><Select value={f.preferredCurrency} onChange={set('preferredCurrency')} options={settings.lists.currencies.map((c) => ({ value: c.code, label: c.name }))} /></Field>
        {!existing && <Field label="رصيد افتتاحي (ريال)" hint="موجب = مستحق للمورد"><Input type="number" value={f.openingBalance} onChange={set('openingBalance')} /></Field>}
      </Grid>
      <Field label="العنوان"><Input value={f.address} onChange={set('address')} /></Field>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={set('notes')} /></Field>
    </FormModal>
  );
}
export function SupplierProfile() {
  const { id } = useParams(); const { can } = useAuth();
  const s = useDoc<any>('suppliers', id);
  const st = useApi<any>('reports.supplierStatement', { id }, id);
  const purchases = useCollection<any>(can('purchases', 'view') ? 'purchases' : null, [where('supplierId', '==', id)], id);
  const [m, setM] = useState<'' | 'pay' | 'edit'>(''); const [tab, setTab] = useState<'statement' | 'purchases' | 'docs'>('statement');
  if (s.loading) return <Loading />;
  if (!s.data) return <Empty title="المورد غير موجود" />;
  const x = s.data;
  return (
    <>
      <PageHeader title={x.name} subtitle={x.code} crumbs={[{ label: 'الموردون', to: '/suppliers' }, { label: x.name }]} actions={<>
        {can('suppliers', 'create') && <Button variant="primary" icon={<Wallet className="h-4 w-4" />} onClick={() => setM('pay')}>سداد للمورد</Button>}
        {can('suppliers', 'edit') && <Button onClick={() => setM('edit')}>تعديل</Button>}</>} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Kpi label="إجمالي المشتريات" value={<Money v={x.bal?.purchases} />} basis="accrual" />
        <Kpi label="المدفوع" value={<Money v={x.bal?.paid} />} basis="cash" tone="ok" />
        <Kpi label="المستحق للمورد" value={<Money v={x.bal?.ledger} />} basis="balance" tone="warn" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'statement', label: 'كشف الحساب' }, { id: 'purchases', label: 'المشتريات', count: purchases.data.length }, { id: 'docs', label: 'المستندات' }]} />
      {tab === 'statement' && (st.error ? <ErrorBox message={st.error} /> : <DataView rows={st.data?.rows ?? []} loading={st.loading} exportName={`supplier-${id}`} title={`كشف حساب المورد ${x.name}`} columns={[
        { key: 'date', label: 'التاريخ', mobile: 'sub', value: (r: any) => formatDate(r.date) }, { key: 'description', label: 'البيان', mobile: 'title' },
        { key: 'credit', label: 'له (مشتريات)', align: 'end', value: (r: any) => major(r.creditMinor), render: (r: any) => (r.creditMinor ? <Money v={r.creditMinor} /> : '') },
        { key: 'debit', label: 'عليه (مدفوعات)', align: 'end', value: (r: any) => major(r.debitMinor), render: (r: any) => (r.debitMinor ? <Money v={r.debitMinor} /> : '') },
        { key: 'balance', label: 'الرصيد المستحق', align: 'end', mobile: 'amount', value: (r: any) => major(r.balanceMinor), render: (r: any) => <Money v={r.balanceMinor} /> }]} />)}
      {tab === 'purchases' && <PurchaseTable rows={purchases.data} loading={purchases.loading} />}
      {tab === 'docs' && <Documents module="suppliers" recordId={x.id} />}
      {m === 'pay' && <SupplierPayForm supplier={x} purchases={purchases.data} onClose={() => setM('')} />}
      {m === 'edit' && <SupplierForm existing={x} onClose={() => setM('')} />}
    </>
  );
}
function SupplierPayForm({ supplier, purchases, onClose }: { supplier: any; purchases: any[]; onClose: () => void }) {
  const toast = useToast(); const { settings } = useAuth();
  const [f, setF] = useState({ date: today(), amount: '', currency: settings.finance.baseCurrency, rate: '', cashAccountId: '', methodId: 'cash', purchaseId: '', notes: '' });
  const accounts = useCashAccounts(f.currency);
  return (
    <FormModal open onClose={onClose} title={`سداد للمورد ${supplier.name}`} onSubmit={async () => { const r = await api('suppliers.pay', { supplierId: supplier.id, ...f, amount: Number(f.amount), rate: num(f.rate), purchaseId: f.purchaseId || undefined }); toast(`تم ترحيل ${r.paymentNo}`); }}>
      <Grid>
        <Field label="التاريخ" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="المبلغ" required><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <CurrencyFields currency={f.currency} rate={f.rate} date={f.date} onCurrency={(c) => setF({ ...f, currency: c, cashAccountId: '' })} onRate={(r) => setF({ ...f, rate: r })} />
        <Field label="من حساب" required><Select value={f.cashAccountId} onChange={(e) => setF({ ...f, cashAccountId: e.target.value })} placeholder="اختر" options={accounts} /></Field>
        <Field label="عن فاتورة (اختياري)"><Select value={f.purchaseId} onChange={(e) => setF({ ...f, purchaseId: e.target.value })} placeholder="سداد عام" options={purchases.filter((p) => p.status === 'approved' && p.payState !== 'paid').map((p) => ({ value: p.id, label: `${p.purchaseNo} — متبقٍ ${formatMoney(p.totalBaseMinor - p.paidBaseMinor)}` }))} /></Field>
      </Grid>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </FormModal>
  );
}

// ================================================================== PURCHASES
function PurchaseTable({ rows, loading, error }: { rows: any[]; loading?: boolean; error?: string | null }) {
  const nav = useNavigate();
  return <DataView rows={rows} loading={loading} error={error} onRowClick={(p) => nav(`/purchases/${p.id}`)} exportName="purchases" title="تقرير المشتريات" search={(p) => `${p.purchaseNo} ${p.lines.map((l: any) => l.description).join(' ')}`}
    columns={[
      { key: 'purchaseNo', label: 'الرقم', mobile: 'title', render: (p) => <span className="num font-bold">{p.purchaseNo}</span> },
      { key: 'date', label: 'التاريخ', mobile: 'sub', value: (p) => formatDate(p.date) },
      { key: 'items', label: 'الأصناف', value: (p) => p.lines.map((l: any) => l.description).join('، ') },
      { key: 'classification', label: 'التصنيف', mobile: 'meta', value: (p) => (p.classification === 'capital' ? 'رأسمالي' : 'تشغيلي'), render: (p) => <Badge tone={p.classification === 'capital' ? 'gold' : 'info'}>{p.classification === 'capital' ? 'رأسمالي' : 'تشغيلي'}</Badge> },
      { key: 'total', label: 'الإجمالي (ريال)', align: 'end', mobile: 'amount', value: (p) => major(p.totalBaseMinor), render: (p) => <Money v={p.totalBaseMinor} /> },
      { key: 'status', label: 'الحالة', mobile: 'meta', value: (p) => PURCHASE_STATUS_LABELS[p.status as keyof typeof PURCHASE_STATUS_LABELS], render: (p) => <Badge tone={p.status === 'approved' ? 'ok' : p.status === 'pending' ? 'warn' : 'bad'}>{PURCHASE_STATUS_LABELS[p.status as keyof typeof PURCHASE_STATUS_LABELS]}</Badge> },
      { key: 'pay', label: 'الدفع', value: (p) => PAY_STATE_LABELS[p.payState as keyof typeof PAY_STATE_LABELS], render: (p) => (p.status === 'approved' ? <Badge tone={p.payState === 'paid' ? 'ok' : p.payState === 'partial' ? 'info' : 'warn'}>{PAY_STATE_LABELS[p.payState as keyof typeof PAY_STATE_LABELS]}</Badge> : '—') },
    ]} />;
}
export function PurchasesPage() {
  const { can } = useAuth(); const [sp] = useSearchParams();
  const r = useCollection<any>('purchases', [orderBy('date', 'desc'), limit(1000)]);
  const [open, setOpen] = useState(false); const [cls, setCls] = useState('');
  const q = sp.get('q');
  const rows = r.data.filter((p) => (!cls || p.classification === cls) && (!q || p.purchaseNo === q));
  const appr = r.data.filter((p) => p.status === 'approved');
  return (
    <>
      <PageHeader title="المشتريات" subtitle="التشغيلية تُحمَّل على الأرباح (أو المخزون حتى صرفه)، والرأسمالية تُسجَّل أصلاً ثابتاً — ولا تُحتسب مرتين" crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'المشتريات' }]}
        actions={can('purchases', 'create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>فاتورة مشتريات</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="مشتريات تشغيلية معتمدة" value={<Money v={appr.filter((p) => p.classification === 'operational').reduce((a, p) => a + p.totalBaseMinor, 0)} />} basis="accrual" tone="brand" />
        <Kpi label="مشتريات رأسمالية معتمدة" value={<Money v={appr.filter((p) => p.classification === 'capital').reduce((a, p) => a + p.totalBaseMinor, 0)} />} basis="accrual" tone="gold" />
        <Kpi label="غير مدفوع للموردين" value={<Money v={appr.reduce((a, p) => a + p.totalBaseMinor - p.paidBaseMinor, 0)} />} tone="warn" />
        <Kpi label="بانتظار الاعتماد" value={r.data.filter((p) => p.status === 'pending').length} tone="navy" />
      </div>
      <Chips label="تصفية حسب التصنيف" value={cls} onChange={setCls} options={[['', 'الكل'], ['operational', 'تشغيلي'], ['capital', 'رأسمالي']] as [string, string][]} />
      <PurchaseTable rows={rows} loading={r.loading} error={r.error} />
      {open && <PurchaseForm onClose={() => setOpen(false)} />}
    </>
  );
}
function PurchaseForm({ onClose }: { onClose: () => void }) {
  const { settings, can } = useAuth(); const toast = useToast(); const nav = useNavigate(); const suppliers = useSupplierOptions();
  const items = useCollection<any>(can('inventory', 'view') ? 'inventory_items' : null, [where('status', '==', 'active')]);
  const whs = useCollection<any>('warehouses', []);
  const [f, setF] = useState({ date: today(), supplierId: '', classification: 'operational', currency: settings.finance.baseCurrency, rate: '', paidAmount: '', cashAccountId: '', methodId: 'cash', notes: '' });
  const [lines, setLines] = useState([{ description: '', itemId: '', warehouseId: '', quantity: '1', unitPrice: '' }]);
  const [asset, setAsset] = useState({ name: '', categoryId: settings.lists.assetCategories[0]?.id || '', location: '', responsible: '', usefulLifeMonths: '', residualValue: '', inServiceDate: '' });
  const accounts = useCashAccounts(f.currency);
  const total = lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  const upd = (i: number, k: string, v: string) => setLines(lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <FormModal open onClose={onClose} title="فاتورة مشتريات" wide submitLabel="حفظ (بانتظار الاعتماد)" onSubmit={async () => {
      const r = await api('purchases.create', { ...f, supplierId: f.supplierId || undefined, rate: num(f.rate), paidAmount: num(f.paidAmount) ?? 0, cashAccountId: f.cashAccountId || undefined,
        lines: lines.map((l) => ({ description: l.description, itemId: l.itemId || undefined, warehouseId: l.warehouseId || undefined, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
        asset: f.classification === 'capital' ? { name: asset.name, categoryId: asset.categoryId, location: asset.location, responsible: asset.responsible, usefulLifeMonths: num(asset.usefulLifeMonths), residualValue: num(asset.residualValue), inServiceDate: asset.inServiceDate || undefined } : undefined });
      toast(`تم حفظ ${r.purchaseNo} — بانتظار الاعتماد والاستلام`); nav(`/purchases/${r.id}`);
    }}>
      <Grid cols={3}>
        <Field label="التاريخ" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="التصنيف" required><Select value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value })} options={[{ value: 'operational', label: 'تشغيلي (كيابل، قطع غيار، مستهلكات…)' }, { value: 'capital', label: 'رأسمالي (معدات، أجهزة، أثاث…)' }]} /></Field>
        <Field label="المورد" hint="إلزامي للشراء الآجل"><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} placeholder="—" options={suppliers} /></Field>
        <CurrencyFields currency={f.currency} rate={f.rate} date={f.date} onCurrency={(c) => setF({ ...f, currency: c, cashAccountId: '' })} onRate={(r) => setF({ ...f, rate: r })} />
      </Grid>
      <div className="space-y-2">
        <p className="text-xs font-semibold">الأصناف</p>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-lg bg-slate-50 p-2">
            <div className="col-span-12 md:col-span-4"><Field label="الوصف"><Input value={l.description} onChange={(e) => upd(i, 'description', e.target.value)} /></Field></div>
            {f.classification === 'operational' && <>
              <div className="col-span-6 md:col-span-2"><Field label="صنف مخزني"><Select value={l.itemId} onChange={(e) => upd(i, 'itemId', e.target.value)} placeholder="غير مخزني" options={items.data.map((x) => ({ value: x.id, label: x.name }))} /></Field></div>
              <div className="col-span-6 md:col-span-2"><Field label="المخزن"><Select value={l.warehouseId} disabled={!l.itemId} onChange={(e) => upd(i, 'warehouseId', e.target.value)} placeholder="—" options={whs.data.map((w) => ({ value: w.id, label: w.name }))} /></Field></div>
            </>}
            <div className="col-span-5 md:col-span-1"><Field label="الكمية"><Input type="number" value={l.quantity} onChange={(e) => upd(i, 'quantity', e.target.value)} /></Field></div>
            <div className="col-span-5 md:col-span-2"><Field label="سعر الوحدة"><Input type="number" value={l.unitPrice} onChange={(e) => upd(i, 'unitPrice', e.target.value)} /></Field></div>
            <div className="col-span-2 md:col-span-1"><Button variant="ghost" aria-label="حذف" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></div>
          </div>))}
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setLines([...lines, { description: '', itemId: '', warehouseId: '', quantity: '1', unitPrice: '' }])}>إضافة صنف</Button>
        <p className="text-sm">الإجمالي: <span className="num font-bold">{total.toLocaleString('en-US')}</span> {f.currency}</p>
      </div>
      <Grid cols={3}>
        <Field label="المدفوع عند الشراء" hint="الباقي يُسجَّل ديناً للمورد"><Input type="number" value={f.paidAmount} onChange={(e) => setF({ ...f, paidAmount: e.target.value })} /></Field>
        <Field label="من حساب"><Select value={f.cashAccountId} onChange={(e) => setF({ ...f, cashAccountId: e.target.value })} placeholder="—" options={accounts} /></Field>
        <Field label="طريقة الدفع"><Select value={f.methodId} onChange={(e) => setF({ ...f, methodId: e.target.value })} options={settings.lists.paymentMethods.map((m) => ({ value: m.id, label: m.name }))} /></Field>
      </Grid>
      {f.classification === 'capital' && (
        <div className="rounded-xl border border-gold/40 bg-gold/5 p-3">
          <p className="mb-2 text-xs font-bold">بيانات الأصل الثابت (يُنشأ عند الاعتماد)</p>
          <Grid cols={3}>
            <Field label="اسم الأصل" required><Input value={asset.name} onChange={(e) => setAsset({ ...asset, name: e.target.value })} /></Field>
            <Field label="الفئة"><Select value={asset.categoryId} onChange={(e) => setAsset({ ...asset, categoryId: e.target.value })} options={settings.lists.assetCategories.map((c) => ({ value: c.id, label: c.name }))} /></Field>
            <Field label="الموقع"><Input value={asset.location} onChange={(e) => setAsset({ ...asset, location: e.target.value })} /></Field>
            <Field label="المسؤول"><Input value={asset.responsible} onChange={(e) => setAsset({ ...asset, responsible: e.target.value })} /></Field>
            <Field label="العمر الإنتاجي (أشهر)" hint="اتركه فارغاً إن لم يُحدَّد — لن يُحتسب إهلاك"><Input type="number" value={asset.usefulLifeMonths} onChange={(e) => setAsset({ ...asset, usefulLifeMonths: e.target.value })} /></Field>
            <Field label="القيمة المتبقية (ريال)"><Input type="number" value={asset.residualValue} onChange={(e) => setAsset({ ...asset, residualValue: e.target.value })} /></Field>
            <Field label="تاريخ بدء الخدمة"><Input type="date" value={asset.inServiceDate} onChange={(e) => setAsset({ ...asset, inServiceDate: e.target.value })} /></Field>
          </Grid>
        </div>
      )}
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </FormModal>
  );
}
export function PurchaseDetail() {
  const { id } = useParams(); const { can, profile } = useAuth(); const toast = useToast(); const { ask, el } = useReasonPrompt();
  const p = useDoc<any>('purchases', id);
  const [busy, setBusy] = useState(false);
  if (p.loading) return <Loading />;
  if (!p.data) return <Empty title="غير موجود" />;
  const x = p.data;
  return (
    <>
      <PageHeader title={`مشتريات ${x.purchaseNo}`} subtitle={<span className="inline-flex gap-2"><Badge tone={x.classification === 'capital' ? 'gold' : 'info'}>{x.classification === 'capital' ? 'رأسمالي' : 'تشغيلي'}</Badge><Badge tone={x.status === 'approved' ? 'ok' : x.status === 'pending' ? 'warn' : 'bad'}>{PURCHASE_STATUS_LABELS[x.status as keyof typeof PURCHASE_STATUS_LABELS]}</Badge></span>}
        crumbs={[{ label: 'المشتريات', to: '/purchases' }, { label: x.purchaseNo }]} actions={<>
          {x.status === 'pending' && can('purchases', 'approve') && <Button variant="success" loading={busy} icon={<CheckCircle2 className="h-4 w-4" />} disabled={x.createdBy === profile?.uid && profile?.kind !== 'owner'}
            onClick={async () => { setBusy(true); try { await api('purchases.approve', { id: x.id }); toast('تم الاعتماد: قُيّدت الفاتورة واستُلمت الأصناف'); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } }}>اعتماد واستلام</Button>}
          {x.status !== 'cancelled' && can('purchases', 'cancel') && <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={async () => { const r = await ask('إلغاء المشتريات'); if (!r) return; try { const res = await api('purchases.cancel', { id: x.id, reason: r }); toast(res.executed ? 'تم الإلغاء' : 'أُرسل للاعتماد', res.executed ? 'ok' : 'warn'); } catch (e: any) { toast(e.message, 'bad'); } }}>إلغاء</Button>}
        </>} />
      {x.status === 'pending' && <div className="mb-4"><Note>لا أثر مالي ولا مخزني قبل الاعتماد. الاعتماد يتم من شخص غير المُدخِل (فصل المهام) ما لم يكن المدير العام.</Note></div>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="الإجمالي (ريال)" value={<Money v={x.totalBaseMinor} />} hint={x.currency !== 'YER' ? `${formatMoney(x.totalOriginalMinor)} ${x.currency} × ${x.rate}` : undefined} />
        <Kpi label="المدفوع" value={<Money v={x.paidBaseMinor} />} tone="ok" basis="cash" />
        <Kpi label="المتبقي للمورد" value={<Money v={x.totalBaseMinor - x.paidBaseMinor} />} tone="warn" />
        {x.assetId && <Kpi label="الأصل المسجل" value={<Link className="text-brand" to="/assets">{x.assetId}</Link>} tone="gold" />}
      </div>
      <Card title="الأصناف" pad={false}>
        <table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-muted"><tr><th className="p-2.5 text-right">الوصف</th><th className="p-2.5 text-right">مخزني</th><th className="p-2.5 text-right">الكمية</th><th className="p-2.5 text-left">السعر</th><th className="p-2.5 text-left">المعادل بالريال</th></tr></thead>
          <tbody>{x.lines.map((l: any, i: number) => <tr key={i} className="border-t border-line"><td className="p-2.5">{l.description}</td><td className="p-2.5">{l.itemId ? 'نعم' : '—'}</td><td className="p-2.5 num">{l.quantity}</td><td className="p-2.5 text-left"><Money v={l.unitPriceMinor} currency={x.currency} /></td><td className="p-2.5 text-left"><Money v={l.baseMinor} /></td></tr>)}</tbody></table>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2"><Documents module="purchases" recordId={x.id} /><Card title="السجل"><Stat label="أدخلها" value={`${x.createdByName} · ${tsDate(x.createdAt)}`} />{x.approvedByName && <Stat label="اعتمدها" value={`${x.approvedByName} · ${tsDate(x.approvedAt)}`} />}<History recordId={x.id} /></Card></div>
      {el}
    </>
  );
}
