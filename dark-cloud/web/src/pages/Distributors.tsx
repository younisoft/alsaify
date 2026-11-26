import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { orderBy, where } from 'firebase/firestore';
import { Plus, Pencil, MessageCircle, Printer, SlidersHorizontal, Ban, Scale } from 'lucide-react';
import { creditExposure, whatsappLink, formatMoney, formatDate, type Settings } from '@dc/shared';
import { useAuth } from '../lib/auth';
import { useCollection, useDoc, useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { major } from '../lib/format';
import { Badge, Button, Card, DataView, Field, FormModal, Grid, Input, Kpi, Note, PageHeader, Select, Stat, Tabs, Textarea, useToast, Loading, ErrorBox, Modal, Empty, type Col } from '../components/ui';
import { Money, DistStatus, BatchStatus, SettlementBadge, DocStatus, Documents, History, today, num } from './common';

const exposureOf = (d: any, s: Settings) => creditExposure(d.bal?.ledger || 0, d.bal?.custodyGross || 0, d.bal?.custodyNet || 0, s.finance.exposureBasis);
const limitOf = (d: any, s: Settings) => d.creditLimitMinor ?? s.finance.defaultCreditLimitMinor;

export function DistributorsPage() {
  const { can, settings } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const r = useCollection<any>('distributors', [orderBy('code')]);
  const rows = r.data.filter((d) => !status || d.status === status);
  const q = sp.get('q')?.toLowerCase();
  const cols: Col<any>[] = [
    { key: 'code', label: 'الكود', mobile: 'meta', render: (d) => <span className="num text-xs font-semibold text-muted">{d.code}</span> },
    { key: 'name', label: 'الموزع', mobile: 'title', render: (d) => <div><div className="font-semibold">{d.name}</div>{d.shopName && <div className="text-xs text-muted">{d.shopName}</div>}</div> },
    { key: 'region', label: 'المنطقة', mobile: 'sub', value: (d) => d.region || '—' },
    { key: 'status', label: 'الحالة', mobile: 'meta', render: (d) => <DistStatus s={d.status} />, value: (d) => d.status },
    { key: 'custody', label: 'عهدة مفتوحة', align: 'end', value: (d) => major(d.bal?.custodyGross), render: (d) => <Money v={d.bal?.custodyGross} /> },
    { key: 'ledger', label: 'الرصيد المستحق', align: 'end', mobile: 'amount', value: (d) => major(d.bal?.ledger), render: (d) => <Money v={d.bal?.ledger} /> },
    { key: 'exposure', label: 'التعرض / الحد', align: 'end', value: (d) => major(exposureOf(d, settings)), render: (d) => {
      const e = exposureOf(d, settings), l = limitOf(d, settings);
      return <span className={e > l ? 'font-bold text-bad' : 'text-muted'}><span className="num">{formatMoney(e)}</span> / <span className="num">{formatMoney(l)}</span></span>;
    } },
  ];
  const total = (k: string) => rows.reduce((a, d) => a + (d.bal?.[k] || 0), 0);
  return (
    <>
      <PageHeader title="الموزعون" subtitle="العهدة المفتوحة والمستحقات المعتمدة والرصيد — كل منها مستقل عن الآخر" crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'الموزعون' }]}
        actions={can('distributors', 'create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>موزع جديد</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="إجمالي العهدة المفتوحة" value={<Money v={total('custodyGross')} />} basis="balance" tone="warn" hint="كروت مسلّمة لم تُعتمد" />
        <Kpi label="الأرصدة المستحقة" value={<Money v={rows.reduce((a, d) => a + Math.max(d.bal?.ledger || 0, 0), 0)} />} basis="balance" tone="brand" />
        <Kpi label="أرصدة دائنة / غير مخصصة" value={<Money v={total('unallocated')} />} basis="balance" tone="gold" />
        <Kpi label="موزعون متجاوزون للحد" value={rows.filter((d) => d.status === 'active' && exposureOf(d, settings) > limitOf(d, settings)).length} tone="bad" />
      </div>
      <DataView key={q} rows={q ? rows.filter((d) => `${d.code} ${d.name} ${d.shopName} ${d.phone}`.toLowerCase().includes(q)) : rows} columns={cols} loading={r.loading} error={r.error}
        search={(d) => `${d.code} ${d.name} ${d.shopName} ${d.region} ${d.phone}`} onRowClick={(d) => nav(`/distributors/${d.id}`)} exportName="distributors" title="تقرير الموزعين"
        emptyTitle="لا يوجد موزعون بعد" emptyHint="ابدأ بإضافة أول موزع. يتم توليد الكود تلقائياً."
        toolbar={<Select aria-label="الحالة" className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="كل الحالات" options={[{ value: 'active', label: 'نشط' }, { value: 'suspended', label: 'موقوف' }, { value: 'closed', label: 'مغلق' }]} />} />
      <DistributorForm open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function DistributorForm({ open, onClose, existing }: { open: boolean; onClose: () => void; existing?: any }) {
  const { settings, can, profile } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const canTerms = profile?.kind === 'owner' || can('distributors', 'approve');
  const [f, setF] = useState<any>(() => existing ? { ...existing } : { name: '', shopName: '', region: '', category: '', phone: '', whatsapp: '', startDate: today(), commissionPct: '', creditLimit: '', openingBalance: '', notes: '' });
  const set = (k: string) => (e: any) => setF((s: any) => ({ ...s, [k]: e.target.value }));
  const submit = async () => {
    if (existing) {
      await api('distributors.update', { id: existing.id, name: f.name, shopName: f.shopName, region: f.region, category: f.category, phone: f.phone, whatsapp: f.whatsapp || undefined, notes: f.notes });
      toast('تم تحديث بيانات الموزع');
    } else {
      const r = await api('distributors.create', { name: f.name, shopName: f.shopName, region: f.region, category: f.category, phone: f.phone, whatsapp: f.whatsapp, startDate: f.startDate,
        commissionPct: num(f.commissionPct), creditLimit: num(f.creditLimit), openingBalance: num(f.openingBalance) ?? 0, notes: f.notes });
      toast(`تمت إضافة الموزع ${r.code}`); nav(`/distributors/${r.id}`);
    }
  };
  return (
    <FormModal open={open} onClose={onClose} title={existing ? `تعديل بيانات ${existing.name}` : 'إضافة موزع جديد'} onSubmit={submit} wide>
      <Grid>
        <Field label="الاسم الكامل" required><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="اسم المحل / المركز"><Input value={f.shopName} onChange={set('shopName')} /></Field>
        <Field label="المنطقة"><Input list="regions" value={f.region} onChange={set('region')} /></Field>
        <datalist id="regions">{settings.lists.regions.map((r) => <option key={r.id} value={r.name} />)}</datalist>
        <Field label="التصنيف"><Select value={f.category} onChange={set('category')} placeholder="—" options={settings.lists.distributorCategories.map((c) => ({ value: c.name, label: c.name }))} /></Field>
        <Field label="رقم الهاتف" required hint="رقم يمني، مثال: 7XXXXXXXX"><Input inputMode="tel" dir="ltr" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="رقم الواتساب" hint="فارغ = نفس رقم الهاتف. يُحوَّل تلقائياً إلى صيغة 967"><Input inputMode="tel" dir="ltr" value={f.whatsapp} onChange={set('whatsapp')} /></Field>
        {!existing && <Field label="تاريخ بداية التعامل" required><Input type="date" value={f.startDate} onChange={set('startDate')} /></Field>}
      </Grid>
      {!existing && (
        <>
          <Note>تُترك الحقول التالية فارغة لاستخدام القيم الافتراضية ({settings.finance.defaultCommissionPct}% عمولة، حد {formatMoney(settings.finance.defaultCreditLimitMinor)} ريال). {!canTerms && 'تحديدها يتطلب صلاحية الاعتماد.'}</Note>
          <Grid cols={3}>
            <Field label="نسبة عمولة خاصة (%)"><Input type="number" step="0.01" min="0" max="100" value={f.commissionPct} onChange={set('commissionPct')} disabled={!canTerms} /></Field>
            <Field label="حد ائتماني خاص (ريال)"><Input type="number" min="0" value={f.creditLimit} onChange={set('creditLimit')} disabled={!canTerms} /></Field>
            <Field label="رصيد افتتاحي (ريال)" hint="موجب = عليه، سالب = له"><Input type="number" value={f.openingBalance} onChange={set('openingBalance')} disabled={!canTerms} /></Field>
          </Grid>
        </>
      )}
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={set('notes')} /></Field>
    </FormModal>
  );
}

type Tab = 'summary' | 'custody' | 'batches' | 'payments' | 'statement' | 'follow' | 'docs' | 'history';
export function DistributorProfile() {
  const { id } = useParams();
  const { can, settings } = useAuth();
  const d = useDoc<any>('distributors', id);
  const [tab, setTab] = useState<Tab>('summary');
  const [modal, setModal] = useState<'' | 'edit' | 'terms' | 'adjust' | 'status' | 'wa'>('');
  const batches = useCollection<any>(can('batches', 'view') ? 'batches' : null, [where('distributorId', '==', id), orderBy('batchNo', 'desc')], id);
  const payments = useCollection<any>(can('payments', 'view') ? 'payments' : null, [where('distributorId', '==', id), orderBy('date', 'desc')], id);
  const follow = useCollection<any>(can('collection', 'view') ? 'collection_followups' : null, [where('distributorId', '==', id)], id);
  if (d.loading) return <Loading />;
  if (d.error) return <ErrorBox message={d.error} />;
  if (!d.data) return <Empty title="الموزع غير موجود" />;
  const x = d.data;
  const exposure = exposureOf(x, settings), limit = limitOf(x, settings);
  const open = batches.data.filter((b) => b.status === 'open');
  return (
    <>
      <PageHeader title={x.name} subtitle={<span className="inline-flex flex-wrap items-center gap-2"><span className="num">{x.code}</span>·{x.region || 'بدون منطقة'}·<DistStatus s={x.status} />{x.shopName && <>· {x.shopName}</>}</span>}
        crumbs={[{ label: 'الموزعون', to: '/distributors' }, { label: x.name }]}
        actions={<>
          {can('distributors', 'edit') && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setModal('edit')}>تعديل</Button>}
          <Button icon={<MessageCircle className="h-4 w-4" />} onClick={() => setModal('wa')}>كشف عبر واتساب</Button>
          <Link to={`/print/statement/${x.id}`} target="_blank"><Button icon={<Printer className="h-4 w-4" />}>طباعة الكشف</Button></Link>
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="عهدة مفتوحة (قيمة الكروت)" value={<Money v={x.bal?.custodyGross} />} basis="balance" tone="warn" hint={<>صافي بعد العمولة: <Money v={x.bal?.custodyNet} /></>} />
        <Kpi label="الرصيد المستحق" value={<Money v={x.bal?.ledger} />} basis="balance" tone="brand" hint="افتتاحي + معتمد + تسويات − سدادات" />
        <Kpi label="إجمالي المعتمد (صافي)" value={<Money v={x.bal?.finalizedNet} />} basis="accrual" />
        <Kpi label="إجمالي المحصّل" value={<Money v={x.bal?.collected} />} basis="cash" tone="ok" hint={x.lastPaymentDate ? `آخر سداد ${formatDate(x.lastPaymentDate)}` : 'لا يوجد سداد'} />
        <Kpi label="التعرض الائتماني / الحد" value={<span className={exposure > limit ? 'text-bad' : ''}>{formatMoney(exposure)}</span>} tone={exposure > limit ? 'bad' : 'ok'} hint={<>الحد: {formatMoney(limit)}{x.creditLimitMinor == null && ' (افتراضي)'}</>} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'summary', label: 'البيانات والشروط' }, { id: 'custody', label: 'العهدة المفتوحة', count: open.length }, { id: 'batches', label: 'الدفعات', count: batches.data.length },
        { id: 'payments', label: 'السدادات', count: payments.data.length }, { id: 'statement', label: 'كشف الحساب' }, { id: 'follow', label: 'متابعة التحصيل', count: follow.data.length },
        { id: 'docs', label: 'المستندات' }, { id: 'history', label: 'سجل التعديلات' }]} />
      {tab === 'summary' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="البيانات الأساسية">
            <Stat label="الهاتف" value={<span dir="ltr">{x.phone}</span>} />
            <Stat label="واتساب (دولي)" value={<span dir="ltr">+{x.whatsappIntl}</span>} />
            <Stat label="بداية التعامل" value={formatDate(x.startDate)} />
            <Stat label="التصنيف" value={x.category || '—'} />
            {x.notes && <p className="mt-2 text-sm text-muted">{x.notes}</p>}
          </Card>
          <Card title="الشروط المالية" actions={can('distributors', 'edit') && <>
            <Button size="sm" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setModal('terms')}>تعديل الشروط</Button>
            <Button size="sm" icon={<Scale className="h-4 w-4" />} onClick={() => setModal('adjust')}>تسوية رصيد</Button>
            <Button size="sm" icon={<Ban className="h-4 w-4" />} onClick={() => setModal('status')}>تغيير الحالة</Button></>}>
            <Stat label="نسبة العمولة" value={x.commissionPct == null ? `${settings.finance.defaultCommissionPct}% (افتراضية)` : `${x.commissionPct}%`} />
            <Stat label="الحد الائتماني" value={<Money v={limit} />} />
            <Stat label="الرصيد الافتتاحي" value={<Money v={x.openingBalanceMinor} />} />
            <Stat label="مبالغ مقبوضة غير مخصصة" value={<Money v={x.bal?.unallocated} />} />
            <p className="mt-2 text-xs text-muted">تغيير العمولة لا يغيّر الدفعات السابقة — كل دفعة تحفظ نسبتها لحظة إنشائها. تعديل الشروط والتسويات يمر بالاعتماد.</p>
          </Card>
        </div>
      )}
      {tab === 'custody' && <BatchTable rows={open} loading={batches.loading} error={batches.error} />}
      {tab === 'batches' && <BatchTable rows={batches.data} loading={batches.loading} error={batches.error} />}
      {tab === 'payments' && <PaymentTable rows={payments.data} loading={payments.loading} error={payments.error} />}
      {tab === 'statement' && <Statement id={x.id} />}
      {tab === 'follow' && <FollowList rows={follow.data} />}
      {tab === 'docs' && <Documents module="distributors" recordId={x.id} />}
      {tab === 'history' && <Card><History recordId={x.id} /></Card>}

      {modal === 'edit' && <DistributorForm open onClose={() => setModal('')} existing={x} />}
      {modal === 'terms' && <TermsModal d={x} onClose={() => setModal('')} />}
      {modal === 'adjust' && <AdjustModal d={x} onClose={() => setModal('')} />}
      {modal === 'status' && <StatusModal d={x} onClose={() => setModal('')} />}
      {modal === 'wa' && <WhatsAppModal d={x} onClose={() => setModal('')} />}
    </>
  );
}

export function BatchTable({ rows, loading, error }: { rows: any[]; loading?: boolean; error?: string | null }) {
  const nav = useNavigate();
  return <DataView rows={rows} loading={loading} error={error} onRowClick={(b) => nav(`/batches/${b.id}`)} search={(b) => `${b.batchNo} ${b.distributorName}`} exportName="batches"
    columns={[
      { key: 'batchNo', label: 'رقم الدفعة', mobile: 'title', render: (b) => <span className="num font-bold">#{b.batchNo}</span> },
      { key: 'deliveryDate', label: 'التسليم', mobile: 'sub', value: (b) => formatDate(b.deliveryDate) },
      { key: 'status', label: 'الحالة', mobile: 'meta', render: (b) => <BatchStatus s={b.status} />, value: (b) => b.status },
      { key: 'commissionPct', label: 'العمولة', value: (b) => `${b.commissionPct}%` },
      { key: 'gross', label: 'الإجمالي', align: 'end', value: (b) => major(b.grossMinor), render: (b) => <Money v={b.grossMinor} /> },
      { key: 'net', label: 'الصافي المستحق', align: 'end', mobile: 'amount', value: (b) => major(b.netMinor), render: (b) => <Money v={b.netMinor} /> },
      { key: 'settle', label: 'السداد', mobile: 'meta', render: (b) => (b.status === 'finalized' ? <SettlementBadge s={b.settlement} /> : '—'), value: (b) => b.settlement },
    ]} />;
}
export function PaymentTable({ rows, loading, error }: { rows: any[]; loading?: boolean; error?: string | null }) {
  const nav = useNavigate();
  return <DataView rows={rows} loading={loading} error={error} onRowClick={(p) => nav(`/payments/${p.id}`)} search={(p) => `${p.receiptNo} ${p.distributorName} ${p.reference}`} exportName="payments"
    columns={[
      { key: 'receiptNo', label: 'رقم السند', mobile: 'title', render: (p) => <span className="num font-bold">{p.receiptNo}</span> },
      { key: 'date', label: 'التاريخ', mobile: 'sub', value: (p) => formatDate(p.date) },
      { key: 'kind', label: 'النوع', mobile: 'meta', render: (p) => (p.kind === 'credit' ? <Badge tone="gold">إشعار دائن</Badge> : <Badge tone="info">سند قبض</Badge>), value: (p) => p.kind },
      { key: 'orig', label: 'المبلغ الأصلي', align: 'end', value: (p) => major(p.originalMinor), render: (p) => <Money v={p.originalMinor} currency={p.currency} /> },
      { key: 'base', label: 'المعادل (ريال)', align: 'end', mobile: 'amount', value: (p) => major(p.baseMinor), render: (p) => <Money v={p.baseMinor} /> },
      { key: 'unalloc', label: 'غير مخصص', align: 'end', value: (p) => major(p.baseMinor - p.allocatedMinor), render: (p) => (p.status === 'posted' ? <Money v={p.baseMinor - p.allocatedMinor} /> : '—') },
      { key: 'status', label: 'الحالة', mobile: 'meta', render: (p) => <DocStatus s={p.status} />, value: (p) => p.status },
    ]} />;
}

function Statement({ id }: { id: string }) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const s = useApi<any>('reports.distributorStatement', { id, from: from || undefined, to: to || undefined }, `${id}${from}${to}`);
  const TYPE: Record<string, string> = { opening: 'رصيد افتتاحي', batch: 'دفعة معتمدة', receipt: 'سند قبض', debit_adjustment: 'تسوية مدينة', credit_adjustment: 'إشعار دائن', reversal: 'قيد عكسي' };
  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-end gap-2">
        <Field label="من"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="إلى"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Link to={`/print/statement/${id}?from=${from}&to=${to}`} target="_blank"><Button icon={<Printer className="h-4 w-4" />}>طباعة / PDF</Button></Link>
      </div>
      {s.error && <ErrorBox message={s.error} retry={s.reload} />}
      {s.loading ? <Loading /> : s.data && (
        <DataView rows={s.data.rows} exportName={`statement-${id}`} title="كشف حساب موزع" columns={[
          { key: 'date', label: 'التاريخ', mobile: 'sub', value: (r: any) => formatDate(r.date) },
          { key: 'type', label: 'النوع', mobile: 'meta', value: (r: any) => TYPE[r.type] ?? r.type },
          { key: 'description', label: 'البيان', mobile: 'title' },
          { key: 'debit', label: 'مدين', align: 'end', value: (r: any) => major(r.debitMinor), render: (r: any) => (r.debitMinor ? <Money v={r.debitMinor} /> : '') },
          { key: 'credit', label: 'دائن', align: 'end', value: (r: any) => major(r.creditMinor), render: (r: any) => (r.creditMinor ? <Money v={r.creditMinor} /> : '') },
          { key: 'balance', label: 'الرصيد', align: 'end', mobile: 'amount', value: (r: any) => major(r.balanceMinor), render: (r: any) => <Money v={r.balanceMinor} /> },
        ]} footer={<tr><td className="px-3 py-2" colSpan={5}>الرصيد الختامي</td><td className="px-3 py-2 text-left"><Money v={s.data.closingMinor} /></td></tr>} emptyTitle="لا توجد حركات في الفترة" />
      )}
    </div>
  );
}

function FollowList({ rows }: { rows: any[] }) {
  const STATUS: Record<string, string> = { not_contacted: 'لم يتم التواصل', contacted: 'تم التواصل', no_answer: 'لا يرد', promised: 'وعد بالسداد', refused: 'رفض', settled: 'تمت التسوية' };
  if (!rows.length) return <Empty title="لا توجد متابعات" hint={<Link className="text-brand" to="/collection">إضافة متابعة من صفحة متابعة التحصيل</Link>} />;
  return <ul className="space-y-2">{rows.map((f) => (
    <li key={f.id} className="rounded-xl border border-line bg-white p-3 text-sm"><div className="flex justify-between"><Badge tone="info">{STATUS[f.contactStatus]}</Badge><span className="text-xs text-muted">المتابعة القادمة {formatDate(f.nextFollowUpDate)}</span></div>
      {f.promisedAmountMinor != null && <p className="mt-1">وعد بـ <Money v={f.promisedAmountMinor} /> بتاريخ {formatDate(f.promiseDate)}</p>}{f.notes && <p className="mt-1 text-muted">{f.notes}</p>}</li>))}</ul>;
}

function TermsModal({ d, onClose }: { d: any; onClose: () => void }) {
  const toast = useToast();
  const [pct, setPct] = useState(d.commissionPct == null ? '' : String(d.commissionPct));
  const [lim, setLim] = useState(d.creditLimitMinor == null ? '' : String(major(d.creditLimitMinor)));
  const [reason, setReason] = useState('');
  return (
    <FormModal open onClose={onClose} title={`تعديل شروط ${d.name}`} submitLabel="إرسال" onSubmit={async () => {
      const r = await api('distributors.changeTerms', { id: d.id, commissionPct: pct === '' ? null : Number(pct), creditLimit: lim === '' ? null : Number(lim), reason });
      toast(r.executed ? 'تم تعديل الشروط' : 'أُرسل الطلب للاعتماد', r.executed ? 'ok' : 'warn');
    }}>
      <Note>التعديل يسري على الدفعات الجديدة فقط. اترك الحقل فارغاً للعودة إلى القيمة الافتراضية.</Note>
      <Grid><Field label="نسبة العمولة (%)"><Input type="number" step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
        <Field label="الحد الائتماني (ريال)"><Input type="number" value={lim} onChange={(e) => setLim(e.target.value)} /></Field></Grid>
      <Field label="السبب" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </FormModal>
  );
}
function AdjustModal({ d, onClose }: { d: any; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ kind: 'debit', amount: '', date: today(), reason: '' });
  return (
    <FormModal open onClose={onClose} title={`تسوية رصيد ${d.name}`} submitLabel="إرسال" onSubmit={async () => {
      const r = await api('distributors.adjust', { id: d.id, kind: f.kind, amount: Number(f.amount), date: f.date, reason: f.reason });
      toast(r.executed ? 'تم ترحيل التسوية' : 'أُرسلت التسوية للاعتماد', r.executed ? 'ok' : 'warn');
    }}>
      <Grid>
        <Field label="نوع التسوية"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[{ value: 'debit', label: 'مدينة (تزيد ما عليه)' }, { value: 'credit', label: 'دائنة / إشعار دائن (تنقص ما عليه)' }]} /></Field>
        <Field label="المبلغ (ريال)" required><Input type="number" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="التاريخ" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </Grid>
      <Field label="السبب" required><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
    </FormModal>
  );
}
function StatusModal({ d, onClose }: { d: any; onClose: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState(d.status); const [reason, setReason] = useState('');
  return (
    <FormModal open onClose={onClose} title="تغيير حالة الموزع" onSubmit={async () => { await api('distributors.setStatus', { id: d.id, status, reason }); toast('تم تغيير الحالة'); }}>
      <Field label="الحالة"><Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'active', label: 'نشط' }, { value: 'suspended', label: 'موقوف (لا تسليم جديد)' }, { value: 'closed', label: 'مغلق (يتطلب رصيداً صفرياً)' }]} /></Field>
      <Field label="السبب" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </FormModal>
  );
}
export function WhatsAppModal({ d, onClose }: { d: any; onClose: () => void }) {
  const { settings } = useAuth();
  const s = useApi<any>('reports.distributorStatement', { id: d.id }, d.id);
  const initial = useMemo(() => {
    if (!s.data) return '';
    const t = s.data.totals;
    return [`السلام عليكم أخي ${d.name}`, `كشف حسابك لدى ${settings.company.nameAr} حتى ${formatDate(today())}:`, '',
      `• العهدة المفتوحة (كروت لديك): ${formatMoney(d.bal?.custodyGross || 0)} ريال`, `• الدفعات المعتمدة (صافي): ${formatMoney(t.finalized)} ريال`,
      `• إجمالي ما سددته: ${formatMoney(t.payments)} ريال`, `• الرصيد المستحق عليك: ${formatMoney(s.data.closingMinor)} ريال`, '', settings.company.nameAr].join('\n');
  }, [s.data]); // eslint-disable-line
  const [text, setText] = useState<string | null>(null);
  const body = text ?? initial;
  return (
    <Modal open onClose={onClose} title="مراجعة رسالة الواتساب قبل الإرسال"
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="success" disabled={!body} icon={<MessageCircle className="h-4 w-4" />} onClick={() => { window.open(whatsappLink(d.whatsappIntl, body), '_blank', 'noopener'); onClose(); }}>فتح واتساب</Button></>}>
      {s.loading ? <Loading /> : s.error ? <ErrorBox message={s.error} /> : <>
        <p className="mb-2 text-sm text-muted">إلى: <span dir="ltr">+{d.whatsappIntl}</span> — راجع النص وعدّله إن لزم. لن يُرسل شيء تلقائياً.</p>
        <Textarea rows={10} value={body} onChange={(e) => setText(e.target.value)} />
      </>}
    </Modal>
  );
}
