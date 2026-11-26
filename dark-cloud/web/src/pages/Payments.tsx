import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { orderBy, where, limit } from 'firebase/firestore';
import { Plus, Printer, XCircle, Shuffle, MessageCircle, PhoneCall } from 'lucide-react';
import { formatDate, formatMoney, fromMinor, whatsappLink } from '@dc/shared';
import { useAuth } from '../lib/auth';
import { useCollection, useDoc } from '../lib/hooks';
import { api } from '../lib/api';
import { tsDate, major } from '../lib/format';
import { Badge, Button, Card, DataView, Field, FormModal, Grid, Input, Kpi, Note, PageHeader, Select, Stat, Textarea, useToast, Loading, ErrorBox, Empty, useReasonPrompt, Modal } from '../components/ui';
import { Money, DocStatus, Documents, History, today, useDistributorOptions, useCashAccounts, CurrencyFields, num, useTeamOptions } from './common';
import { PaymentTable } from './Distributors';

export function PaymentsPage() {
  const { can } = useAuth();
  const [sp] = useSearchParams();
  const [open, setOpen] = useState(false);
  const r = useCollection<any>('payments', [orderBy('date', 'desc'), limit(1000)]);
  const q = sp.get('q');
  const rows = q ? r.data.filter((p) => p.receiptNo === q) : r.data;
  const posted = r.data.filter((p) => p.status === 'posted' && p.kind === 'receipt');
  const month = today().slice(0, 7);
  return (
    <>
      <PageHeader title="السداد وسندات القبض" subtitle="كل سند يُرحَّل للصندوق المختار ولحساب الموزع في عملية واحدة. التصحيح بالإلغاء والقيد العكسي فقط."
        crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'السداد' }]}
        actions={can('payments', 'create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>سند قبض جديد</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="المحصّل هذا الشهر" value={<Money v={posted.filter((p) => p.date.startsWith(month)).reduce((a, p) => a + p.baseMinor, 0)} />} basis="cash" tone="ok" />
        <Kpi label="مبالغ غير مخصصة لدفعات" value={<Money v={posted.reduce((a, p) => a + p.baseMinor - p.allocatedMinor, 0)} />} tone="gold" hint="يمكن تخصيصها لاحقاً بصلاحية الاعتماد" />
        <Kpi label="سندات هذا الشهر" value={posted.filter((p) => p.date.startsWith(month)).length} />
      </div>
      <PaymentTable rows={rows} loading={r.loading} error={r.error} />
      {open && <PaymentForm onClose={() => setOpen(false)} />}
    </>
  );
}

function OpenItems({ distributorId, children }: { distributorId: string; children: (items: any[]) => React.ReactNode }) {
  const b = useCollection<any>('batches', [where('distributorId', '==', distributorId), where('allocOpen', '==', true)], distributorId);
  const c = useCollection<any>('distributor_charges', [where('distributorId', '==', distributorId), where('allocOpen', '==', true)], distributorId);
  const items = useMemo(() => [
    ...b.data.map((x) => ({ key: `batch:${x.id}`, targetType: 'batch', targetId: x.id, label: `دفعة #${x.batchNo} (${formatDate(x.settlementDate)})`, date: x.settlementDate, outstanding: x.netMinor - x.paidMinor })),
    ...c.data.map((x) => ({ key: `charge:${x.id}`, targetType: 'charge', targetId: x.id, label: `${x.description} (${formatDate(x.date)})`, date: x.date, outstanding: x.amountMinor - x.paidMinor })),
  ].sort((a, z) => (a.date < z.date ? -1 : 1)), [b.data, c.data]);
  if (b.loading || c.loading) return <Loading />;
  return <>{children(items)}</>;
}

function AllocationEditor({ distributorId, mode, setMode, manual, setManual }: { distributorId: string; mode: string; setMode: (m: string) => void; manual: Record<string, string>; setManual: (m: Record<string, string>) => void }) {
  return (
    <div className="space-y-2 rounded-xl border border-line p-3">
      <Field label="تخصيص السداد">
        <Select value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: 'fifo', label: 'تلقائي — الأقدم أولاً (FIFO)' }, { value: 'manual', label: 'يدوي — اختيار الدفعات' }, { value: 'none', label: 'بدون تخصيص (دفعة مقدمة / رصيد دائن)' }]} />
      </Field>
      {mode === 'manual' && distributorId && (
        <OpenItems distributorId={distributorId}>{(items) => !items.length ? <p className="text-sm text-muted">لا توجد دفعات معتمدة غير مسددة لهذا الموزع.</p> : (
          <ul className="space-y-1.5">{items.map((it) => (
            <li key={it.key} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{it.label} — متبقٍ <span className="num font-semibold">{formatMoney(it.outstanding)}</span></span>
              <Input className="w-32" type="number" min="0" max={fromMinor(it.outstanding)} placeholder="0" value={manual[it.key] || ''} onChange={(e) => setManual({ ...manual, [it.key]: e.target.value })} aria-label={`مبلغ التخصيص ${it.label}`} />
            </li>))}</ul>
        )}</OpenItems>
      )}
      <p className="text-xs text-muted">لا يُفترض أبداً أن السداد يخص أحدث دفعة. المبلغ غير المخصص يبقى رصيداً دائناً للموزع ويُخصص لاحقاً.</p>
    </div>
  );
}
const allocPayload = (mode: string, manual: Record<string, string>) => ({ mode, items: mode !== 'manual' ? [] : Object.entries(manual).filter(([, v]) => Number(v) > 0).map(([k, v]) => { const [targetType, targetId] = k.split(':'); return { targetType, targetId, amount: Number(v) }; }) });

export function PaymentForm({ onClose, distributorId }: { onClose: () => void; distributorId?: string }) {
  const { settings } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const dists = useDistributorOptions(false);
  const [f, setF] = useState({ distributorId: distributorId || '', date: today(), amount: '', currency: settings.finance.baseCurrency, rate: '', methodId: 'cash', cashAccountId: '', reference: '', notes: '' });
  const accounts = useCashAccounts(f.currency);
  const [mode, setMode] = useState('fifo');
  const [manual, setManual] = useState<Record<string, string>>({});
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal open onClose={onClose} title="سند قبض من موزع" wide submitLabel="ترحيل السند" onSubmit={async () => {
      const r = await api('payments.create', { distributorId: f.distributorId, date: f.date, amount: Number(f.amount), currency: f.currency, rate: num(f.rate), methodId: f.methodId,
        cashAccountId: f.cashAccountId, reference: f.reference, notes: f.notes, allocation: allocPayload(mode, manual) });
      toast(`تم ترحيل السند ${r.receiptNo} — المعادل ${formatMoney(r.baseMinor)} ريال، غير مخصص ${formatMoney(r.unallocatedMinor)}`);
      nav(`/payments/${r.id}`);
    }}>
      <Grid cols={3}>
        <Field label="الموزع" required><Select value={f.distributorId} onChange={set('distributorId')} placeholder="اختر" options={dists} /></Field>
        <Field label="تاريخ السداد" required><Input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="المبلغ (بالعملة الأصلية)" required><Input type="number" min="0" step="any" value={f.amount} onChange={set('amount')} /></Field>
        <CurrencyFields currency={f.currency} rate={f.rate} date={f.date} onCurrency={(c) => setF({ ...f, currency: c, cashAccountId: '' })} onRate={(r) => setF({ ...f, rate: r })} />
        <Field label="طريقة السداد" required><Select value={f.methodId} onChange={set('methodId')} options={settings.lists.paymentMethods.map((m) => ({ value: m.id, label: m.name }))} /></Field>
        <Field label="الحساب المستلِم" required hint={`حسابات بعملة ${f.currency} فقط`}><Select value={f.cashAccountId} onChange={set('cashAccountId')} placeholder="اختر الصندوق/الحساب" options={accounts} /></Field>
        <Field label="مرجع خارجي (رقم حوالة…)"><Input value={f.reference} onChange={set('reference')} /></Field>
      </Grid>
      {f.distributorId && <AllocationEditor distributorId={f.distributorId} mode={mode} setMode={setMode} manual={manual} setManual={setManual} />}
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={set('notes')} /></Field>
    </FormModal>
  );
}

export function PaymentDetail() {
  const { id } = useParams();
  const { can, settings } = useAuth();
  const toast = useToast();
  const p = useDoc<any>('payments', id);
  const allocs = useCollection<any>('payment_allocations', [where('paymentId', '==', id)], id);
  const { ask, el } = useReasonPrompt();
  const [realloc, setRealloc] = useState(false);
  if (p.loading) return <Loading />;
  if (p.error) return <ErrorBox message={p.error} />;
  if (!p.data) return <Empty title="السند غير موجود" />;
  const x = p.data;
  const method = settings.lists.paymentMethods.find((m) => m.id === x.methodId)?.name;
  return (
    <>
      <PageHeader title={`${x.kind === 'credit' ? 'إشعار دائن' : 'سند قبض'} ${x.receiptNo}`} subtitle={<span className="inline-flex items-center gap-2"><Link className="text-brand" to={`/distributors/${x.distributorId}`}>{x.distributorName}</Link> · <DocStatus s={x.status} /></span>}
        crumbs={[{ label: 'السداد', to: '/payments' }, { label: x.receiptNo }]}
        actions={<>
          {x.status === 'posted' && can('payments', 'approve') && <Button icon={<Shuffle className="h-4 w-4" />} onClick={() => setRealloc(true)}>إعادة التخصيص</Button>}
          {x.status === 'posted' && can('payments', 'cancel') && <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={async () => {
            const r = await ask('إلغاء السند (قيد عكسي — يتطلب اعتماداً لغير المدير العام)'); if (!r) return;
            try { const res = await api('payments.cancel', { id: x.id, reason: r }); toast(res.executed ? 'تم إلغاء السند بقيد عكسي' : 'أُرسل طلب الإلغاء للاعتماد', res.executed ? 'ok' : 'warn'); } catch (e: any) { toast(e.message, 'bad'); }
          }}>إلغاء السند</Button>}
          <Link to={`/print/receipt/${x.id}`} target="_blank"><Button icon={<Printer className="h-4 w-4" />}>طباعة السند</Button></Link>
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="المبلغ الأصلي" value={<Money v={x.originalMinor} currency={x.currency} />} />
        <Kpi label="المعادل بالريال" value={<Money v={x.baseMinor} />} tone="ok" basis="cash" hint={x.currency !== settings.finance.baseCurrency ? `سعر ${x.rate} (${x.rateSource}، ${formatDate(x.rateDate)}) — محفوظ ولا يتغير` : undefined} />
        <Kpi label="مخصص لدفعات" value={<Money v={x.allocatedMinor} />} tone="brand" />
        <Kpi label="غير مخصص" value={<Money v={x.status === 'posted' ? x.baseMinor - x.allocatedMinor : 0} />} tone="gold" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="التفاصيل">
          <Stat label="التاريخ" value={formatDate(x.date)} /><Stat label="الطريقة" value={method ?? '—'} /><Stat label="المرجع" value={x.reference || '—'} />
          <Stat label="أدخله" value={`${x.createdByName} · ${tsDate(x.createdAt)}`} />
          {x.cancelReason && <p className="mt-2 text-sm text-bad">سبب الإلغاء: {x.cancelReason}</p>}
          {x.notes && <p className="mt-2 text-sm text-muted">{x.notes}</p>}
        </Card>
        <Card title="التخصيصات">
          {!allocs.data.length ? <p className="text-sm text-muted">غير مخصص — يبقى رصيداً دائناً للموزع.</p> : (
            <ul className="divide-y divide-line text-sm">{allocs.data.map((a) => (
              <li key={a.id} className="flex justify-between py-2"><span>{a.targetType === 'batch' ? <Link className="inline-flex min-h-10 items-center text-brand" to={`/batches/${a.targetId}`}>دفعة</Link> : 'رصيد مدين'} · {formatDate(a.date)}</span>
                <span>{a.status === 'void' ? <Badge tone="neutral">أُلغي</Badge> : <Money v={a.amountMinor} />}</span></li>))}</ul>
          )}
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2"><Documents module="payments" recordId={x.id} /><Card title="سجل التعديلات"><History recordId={x.id} /></Card></div>
      {realloc && <ReallocModal p={x} onClose={() => setRealloc(false)} />}
      {el}
    </>
  );
}
function ReallocModal({ p, onClose }: { p: any; onClose: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState('fifo'); const [manual, setManual] = useState<Record<string, string>>({}); const [reason, setReason] = useState('');
  return (
    <FormModal open onClose={onClose} title={`إعادة تخصيص ${p.receiptNo}`} wide onSubmit={async () => { await api('payments.reallocate', { id: p.id, reason, allocation: allocPayload(mode, manual) }); toast('تمت إعادة التخصيص'); }}>
      <Note>يُلغى التخصيص الحالي ويُستبدل بالجديد. المبلغ المتاح: <span className="num font-bold">{formatMoney(p.baseMinor)}</span> ريال.</Note>
      <AllocationEditor distributorId={p.distributorId} mode={mode} setMode={setMode} manual={manual} setManual={setManual} />
      <Field label="السبب" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </FormModal>
  );
}

// ------------------------------------------------------------------ Collection follow-up
const CONTACT: Record<string, string> = { not_contacted: 'لم يتم التواصل', contacted: 'تم التواصل', no_answer: 'لا يرد', promised: 'وعد بالسداد', refused: 'رفض', settled: 'تمت التسوية' };
export function CollectionPage() {
  const { can } = useAuth();
  const dists = useCollection<any>('distributors', [orderBy('code')]);
  const follows = useCollection<any>('collection_followups', [orderBy('nextFollowUpDate')]);
  const [edit, setEdit] = useState<any>(null);
  const [wa, setWa] = useState<any>(null);
  const due = dists.data.filter((d) => (d.bal?.ledger || 0) > 0).sort((a, b) => b.bal.ledger - a.bal.ledger);
  const lastFollow = (id: string) => follows.data.filter((f) => f.distributorId === id).sort((a, b) => (a.nextFollowUpDate < b.nextFollowUpDate ? 1 : -1))[0];
  return (
    <>
      <PageHeader title="متابعة التحصيل" subtitle="الموزعون الذين عليهم أرصدة مستحقة، مع مواعيد المتابعة والوعود بالسداد" crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'متابعة التحصيل' }]} />
      <DataView rows={due} loading={dists.loading} error={dists.error || follows.error} exportName="collection" title="تقرير متابعة التحصيل" search={(d) => `${d.code} ${d.name}`}
        emptyTitle="لا توجد أرصدة مستحقة" columns={[
          { key: 'name', label: 'الموزع', mobile: 'title', render: (d) => <Link className="inline-flex min-h-10 items-center font-semibold text-brand" to={`/distributors/${d.id}`}>{d.name}</Link>, value: (d) => d.name },
          { key: 'ledger', label: 'الرصيد المستحق', align: 'end', mobile: 'amount', value: (d) => major(d.bal.ledger), render: (d) => <Money v={d.bal.ledger} /> },
          { key: 'last', label: 'آخر سداد', mobile: 'sub', value: (d) => formatDate(d.lastPaymentDate) },
          { key: 'next', label: 'المتابعة القادمة', value: (d) => formatDate(lastFollow(d.id)?.nextFollowUpDate), render: (d) => { const f = lastFollow(d.id); return f ? <span className={f.nextFollowUpDate <= today() ? 'font-bold text-warn' : ''}>{formatDate(f.nextFollowUpDate)}</span> : '—'; } },
          { key: 'status', label: 'حالة التواصل', mobile: 'meta', value: (d) => CONTACT[lastFollow(d.id)?.contactStatus] ?? '—', render: (d) => { const f = lastFollow(d.id); return f ? <Badge tone="info">{CONTACT[f.contactStatus]}</Badge> : '—'; } },
          { key: 'promise', label: 'الوعد', value: (d) => major(lastFollow(d.id)?.promisedAmountMinor), render: (d) => { const f = lastFollow(d.id); return f?.promisedAmountMinor != null ? <span><Money v={f.promisedAmountMinor} /> · {formatDate(f.promiseDate)}</span> : '—'; } },
          { key: 'act', label: '', noExport: true, render: (d) => <div className="flex gap-1">
            {can('collection', 'create') && <Button size="sm" icon={<PhoneCall className="h-3.5 w-3.5" />} onClick={() => setEdit({ distributorId: d.id, ...(lastFollow(d.id) || {}) })}>متابعة</Button>}
            <Button size="sm" icon={<MessageCircle className="h-3.5 w-3.5" />} onClick={() => setWa(d)}>واتساب</Button></div> },
        ]} />
      {edit && <FollowForm initial={edit} onClose={() => setEdit(null)} />}
      {wa && <ReminderModal d={wa} onClose={() => setWa(null)} />}
    </>
  );
}
function FollowForm({ initial, onClose }: { initial: any; onClose: () => void }) {
  const toast = useToast(); const team = useTeamOptions();
  const [f, setF] = useState({ id: initial.id, nextFollowUpDate: initial.nextFollowUpDate || today(), contactStatus: initial.contactStatus || 'contacted', promisedAmount: initial.promisedAmountMinor != null ? String(fromMinor(initial.promisedAmountMinor)) : '', promiseDate: initial.promiseDate || '', notes: initial.notes || '', assignedTo: initial.assignedTo || '' });
  return (
    <FormModal open onClose={onClose} title="تسجيل متابعة تحصيل" onSubmit={async () => {
      await api('collection.upsert', { id: f.id, distributorId: initial.distributorId, nextFollowUpDate: f.nextFollowUpDate, contactStatus: f.contactStatus, promisedAmount: num(f.promisedAmount), promiseDate: f.promiseDate || undefined, notes: f.notes, assignedTo: f.assignedTo || undefined });
      toast('تم حفظ المتابعة');
    }}>
      <Grid>
        <Field label="حالة التواصل"><Select value={f.contactStatus} onChange={(e) => setF({ ...f, contactStatus: e.target.value })} options={Object.entries(CONTACT).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="موعد المتابعة القادمة" required><Input type="date" value={f.nextFollowUpDate} onChange={(e) => setF({ ...f, nextFollowUpDate: e.target.value })} /></Field>
        <Field label="المبلغ الموعود"><Input type="number" value={f.promisedAmount} onChange={(e) => setF({ ...f, promisedAmount: e.target.value })} /></Field>
        <Field label="تاريخ الوعد"><Input type="date" value={f.promiseDate} onChange={(e) => setF({ ...f, promiseDate: e.target.value })} /></Field>
        <Field label="المسؤول"><Select value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })} placeholder="أنا" options={team} /></Field>
      </Grid>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </FormModal>
  );
}
function ReminderModal({ d, onClose }: { d: any; onClose: () => void }) {
  const { settings } = useAuth();
  const [text, setText] = useState(`السلام عليكم أخي ${d.name}\nنذكّركم بأن الرصيد المستحق لدى ${settings.company.nameAr} هو ${formatMoney(d.bal.ledger)} ريال حتى ${formatDate(today())}.\nنرجو التكرم بالسداد، وشكراً لتعاونكم.`);
  return (
    <Modal open onClose={onClose} title="مراجعة رسالة التذكير" footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="success" icon={<MessageCircle className="h-4 w-4" />} onClick={() => { window.open(whatsappLink(d.whatsappIntl, text), '_blank', 'noopener'); onClose(); }}>فتح واتساب</Button></>}>
      <p className="mb-2 text-sm text-muted">إلى <span dir="ltr">+{d.whatsappIntl}</span> — لن يُرسل شيء قبل أن تضغط إرسال داخل واتساب.</p>
      <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}
