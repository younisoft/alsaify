import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { orderBy, where, limit } from 'firebase/firestore';
import { Plus, Trash2, Truck, CheckCircle2, Undo2, XCircle, Printer } from 'lucide-react';
import { computeBatchTotals, toMinor, formatDate, formatMoney } from '@dc/shared';
import { useAuth } from '../lib/auth';
import { useCollection, useDoc } from '../lib/hooks';
import { api } from '../lib/api';
import { tsDate } from '../lib/format';
import { Button, Card, Field, FormModal, Grid, Input, Kpi, Note, PageHeader, Select, Stat, Textarea, useToast, Loading, ErrorBox, Empty, useReasonPrompt, Badge } from '../components/ui';
import { Money, BatchStatus, SettlementBadge, Documents, History, today, useDistributorOptions } from './common';
import { BatchTable } from './Distributors';

export function BatchesPage() {
  const { can } = useAuth();
  const [sp] = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') || '');
  const [open, setOpen] = useState(false);
  const r = useCollection<any>('batches', [orderBy('batchNo', 'desc'), limit(1000)]);
  const q = sp.get('q');
  const rows = r.data.filter((b) => (!status || b.status === status) && (!q || String(b.batchNo) === q));
  const sum = (s: string, k: string) => r.data.filter((b) => b.status === s).reduce((a, b) => a + b[k], 0);
  return (
    <>
      <PageHeader title="الدفعات والتسليمات" subtitle="التسليم يُنشئ عهدة مفتوحة فقط. لا يصبح المبلغ مستحقاً إلا بعد الاعتماد."
        crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'الدفعات' }]}
        actions={can('batches', 'create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>دفعة جديدة</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="عهدة مفتوحة (إجمالي)" value={<Money v={sum('open', 'grossMinor')} />} basis="balance" tone="warn" hint={`${r.data.filter((b) => b.status === 'open').length} دفعة مفتوحة`} />
        <Kpi label="معتمدة — صافي مستحق" value={<Money v={sum('finalized', 'netMinor')} />} basis="accrual" tone="brand" />
        <Kpi label="معتمدة — المسدد منها" value={<Money v={sum('finalized', 'paidMinor')} />} basis="cash" tone="ok" />
        <Kpi label="جديدة لم تُسلَّم" value={r.data.filter((b) => b.status === 'draft').length} tone="navy" />
      </div>
      <BatchTableWithFilter rows={rows} loading={r.loading} error={r.error} status={status} setStatus={setStatus} />
      {open && <BatchForm onClose={() => setOpen(false)} />}
    </>
  );
}
function BatchTableWithFilter({ rows, loading, error, status, setStatus }: any) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {[['', 'الكل'], ['draft', 'جديدة'], ['open', 'مفتوحة'], ['finalized', 'معتمدة'], ['returned', 'مرتجعة'], ['cancelled', 'ملغاة']].map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} className={`rounded-full px-3 py-1 text-xs font-semibold ${status === v ? 'bg-navy text-white' : 'bg-white text-muted ring-1 ring-line'}`}>{l}</button>
        ))}
      </div>
      <BatchTable rows={rows} loading={loading} error={error} />
    </div>
  );
}

function BatchForm({ onClose, distributorId }: { onClose: () => void; distributorId?: string }) {
  const { settings, can, profile } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const dists = useDistributorOptions();
  const cats = settings.lists.cardCategories.filter((c) => c.active !== false);
  const [f, setF] = useState({ distributorId: distributorId || '', deliveryDate: today(), deliverNow: true, notes: '', overrideReason: '' });
  const [lines, setLines] = useState([{ categoryId: cats[0]?.id || '', quantity: '', unitPrice: '' }]);
  const dist = useDoc<any>('distributors', f.distributorId || undefined);
  const canPrice = profile?.kind === 'owner' || can('batches', 'approve');
  const pct = dist.data ? (dist.data.commissionPct ?? settings.finance.defaultCommissionPct) : settings.finance.defaultCommissionPct;
  const preview = useMemo(() => {
    try {
      const ls = lines.filter((l) => l.categoryId && Number(l.quantity) > 0).map((l) => {
        const c = cats.find((x) => x.id === l.categoryId)!;
        return { categoryId: c.id, categoryName: c.name, quantity: Math.trunc(Number(l.quantity)), unitPriceMinor: l.unitPrice ? toMinor(l.unitPrice) : c.unitPriceMinor };
      });
      return ls.length ? computeBatchTotals(ls, pct, settings.finance.precision) : null;
    } catch { return null; }
  }, [lines, pct]); // eslint-disable-line
  return (
    <FormModal open onClose={onClose} title="دفعة كروت جديدة" wide submitLabel={f.deliverNow ? 'حفظ وتسليم' : 'حفظ كمسودة'} onSubmit={async () => {
      const r = await api('batches.create', { distributorId: f.distributorId, deliveryDate: f.deliveryDate, deliverNow: f.deliverNow, notes: f.notes, overrideReason: f.overrideReason || undefined,
        lines: lines.filter((l) => Number(l.quantity) > 0).map((l) => ({ categoryId: l.categoryId, quantity: Math.trunc(Number(l.quantity)), unitPrice: l.unitPrice ? Number(l.unitPrice) : undefined })) });
      const w = r.delivery?.warnings?.[0];
      toast(r.delivery?.approvalId && !r.delivery.delivered ? 'الدفعة محفوظة وأُرسل طلب تجاوز الحد للاعتماد' : `تم إنشاء الدفعة #${r.batchNo}`, w || (r.delivery && !r.delivery.delivered) ? 'warn' : 'ok');
      if (w) toast(w, 'warn');
      nav(`/batches/${r.id}`);
    }}>
      <Grid cols={3}>
        <Field label="الموزع" required><Select value={f.distributorId} onChange={(e) => setF({ ...f, distributorId: e.target.value })} placeholder="اختر الموزع" options={dists} /></Field>
        <Field label="تاريخ التسليم" required><Input type="date" value={f.deliveryDate} onChange={(e) => setF({ ...f, deliveryDate: e.target.value })} /></Field>
        <Field label="عمولة الموزع (لقطة ثابتة)"><Input value={`${pct}%${dist.data?.commissionPct == null ? ' (افتراضية)' : ''}`} disabled /></Field>
      </Grid>
      <div className="space-y-2">
        <p className="text-xs font-semibold">أسطر الفئات</p>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-lg bg-slate-50 p-2">
            <div className="col-span-12 sm:col-span-5"><Field label="الفئة"><Select value={l.categoryId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))} options={cats.map((c) => ({ value: c.id, label: `${c.name} — ${formatMoney(c.unitPriceMinor)} ريال` }))} /></Field></div>
            <div className="col-span-5 sm:col-span-3"><Field label="العدد"><Input type="number" min="1" step="1" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></Field></div>
            <div className="col-span-5 sm:col-span-3"><Field label="سعر الوحدة"><Input type="number" min="0" placeholder="سعر الفئة" disabled={!canPrice} value={l.unitPrice} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} /></Field></div>
            <div className="col-span-2 sm:col-span-1"><Button variant="ghost" aria-label="حذف السطر" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></div>
          </div>
        ))}
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setLines([...lines, { categoryId: cats[0]?.id || '', quantity: '', unitPrice: '' }])}>إضافة فئة</Button>
      </div>
      {preview && (
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-brand-light p-3 text-center text-sm">
          <div><p className="text-xs text-muted">الإجمالي</p><p className="font-bold num">{formatMoney(preview.grossMinor)}</p></div>
          <div><p className="text-xs text-muted">العمولة {pct}%</p><p className="font-bold num">{formatMoney(preview.commissionMinor)}</p></div>
          <div><p className="text-xs text-muted">الصافي المستحق عند الاعتماد</p><p className="font-bold num text-brand">{formatMoney(preview.netMinor)}</p></div>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.deliverNow} onChange={(e) => setF({ ...f, deliverNow: e.target.checked })} />تسليم الكروت للموزع الآن (تتحول إلى عهدة مفتوحة)</label>
      {settings.finance.creditPolicy === 'block' && f.deliverNow && <Field label="سبب تجاوز الحد الائتماني (إن وُجد)" hint="مطلوب فقط إذا تجاوز التسليم الحد — يُرسل للاعتماد"><Input value={f.overrideReason} onChange={(e) => setF({ ...f, overrideReason: e.target.value })} /></Field>}
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </FormModal>
  );
}

export function BatchDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const b = useDoc<any>('batches', id);
  const allocs = useCollection<any>(can('payments', 'view') ? 'payment_allocations' : null, [where('targetId', '==', id)], id);
  const { ask, el } = useReasonPrompt();
  const [finalize, setFinalize] = useState(false);
  const [busy, setBusy] = useState('');
  if (b.loading) return <Loading />;
  if (b.error) return <ErrorBox message={b.error} />;
  if (!b.data) return <Empty title="الدفعة غير موجودة" />;
  const x = b.data;
  const run = async (key: string, action: string, input: any, ok: string) => {
    setBusy(key);
    try { const r = await api(action, input); toast(r?.executed === false ? 'أُرسل الطلب للاعتماد' : ok, r?.executed === false ? 'warn' : 'ok'); for (const w of r?.warnings ?? []) toast(w, 'warn'); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  };
  return (
    <>
      <PageHeader title={`دفعة #${x.batchNo}`} subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Link className="text-brand" to={`/distributors/${x.distributorId}`}>{x.distributorName} ({x.distributorCode})</Link>· <BatchStatus s={x.status} />{x.status === 'finalized' && <SettlementBadge s={x.settlement} />}</span>}
        crumbs={[{ label: 'الدفعات', to: '/batches' }, { label: `#${x.batchNo}` }]}
        actions={<>
          {x.status === 'draft' && can('batches', 'edit') && <Button variant="primary" icon={<Truck className="h-4 w-4" />} loading={busy === 'd'} onClick={async () => {
            await run('d', 'batches.deliver', { id: x.id }, 'تم التسليم — أصبحت عهدة مفتوحة'); }}>تسليم للموزع</Button>}
          {x.status === 'open' && can('batches', 'approve') && <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setFinalize(true)}>اعتماد الدفعة</Button>}
          {x.status === 'open' && can('batches', 'edit') && <Button icon={<Undo2 className="h-4 w-4" />} loading={busy === 'r'} onClick={async () => { const r = await ask('إرجاع الكروت (الدفعة كاملة)', 'سبب الإرجاع', false); if (r) await run('r', 'batches.return', { id: x.id, date: today(), reason: r }, 'تم تسجيل الإرجاع'); }}>إرجاع</Button>}
          {['draft', 'open', 'finalized'].includes(x.status) && can('batches', 'cancel') && <Button variant="danger" icon={<XCircle className="h-4 w-4" />} loading={busy === 'c'} onClick={async () => {
            const r = await ask(x.status === 'finalized' ? 'إلغاء دفعة معتمدة (يتطلب اعتماداً ويُنشئ قيداً عكسياً)' : 'إلغاء الدفعة'); if (r) await run('c', 'batches.cancel', { id: x.id, reason: r }, 'تم الإلغاء'); }}>إلغاء</Button>}
          <Link to={`/print/batch/${x.id}`} target="_blank"><Button icon={<Printer className="h-4 w-4" />}>فاتورة التسليم</Button></Link>
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="الإجمالي (عدد × سعر)" value={<Money v={x.grossMinor} />} />
        <Kpi label={`العمولة (${x.commissionPct}% — لقطة ثابتة)`} value={<Money v={x.commissionMinor} />} tone="gold" />
        <Kpi label="الصافي المستحق" value={<Money v={x.netMinor} />} tone="brand" basis={x.status === 'finalized' ? 'accrual' : undefined} />
        <Kpi label="المسدد / المتبقي" value={x.status === 'finalized' ? <><Money v={x.paidMinor} /> / <Money v={x.netMinor - x.paidMinor} /></> : '—'} tone="ok" />
      </div>
      {x.status === 'open' && <div className="mb-4"><Note tone="warn">الدفعة عهدة مفتوحة لدى الموزع — لا تُحسب ضمن المستحقات أو الإيراد حتى يتم اعتمادها. انتهاء صلاحية الكروت لا يعني بيعها.</Note></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="أسطر الفئات" className="lg:col-span-2" pad={false}>
          <table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-muted"><tr><th className="p-2.5 text-right">الفئة</th><th className="p-2.5 text-right">العدد</th><th className="p-2.5 text-left">سعر الوحدة</th><th className="p-2.5 text-left">الإجمالي</th><th className="p-2.5 text-left">العمولة</th><th className="p-2.5 text-left">الصافي</th></tr></thead>
            <tbody>{x.lines.map((l: any, i: number) => (
              <tr key={i} className="border-t border-line"><td className="p-2.5">{l.categoryName}</td><td className="p-2.5 num">{l.quantity}</td><td className="p-2.5 text-left"><Money v={l.unitPriceMinor} /></td>
                <td className="p-2.5 text-left"><Money v={l.grossMinor} /></td><td className="p-2.5 text-left"><Money v={l.commissionMinor} /></td><td className="p-2.5 text-left"><Money v={l.netMinor} /></td></tr>))}</tbody></table>
        </Card>
        <Card title="الدورة">
          <Stat label="تاريخ التسليم" value={formatDate(x.deliveryDate)} />
          <Stat label="تاريخ الاعتماد" value={formatDate(x.settlementDate)} />
          {x.finalizedByName && <Stat label="اعتمدها" value={x.finalizedByName} />}
          {x.returnedDate && <Stat label="تاريخ الإرجاع" value={formatDate(x.returnedDate)} />}
          {x.cancelReason && <p className="mt-2 text-sm text-bad">سبب الإلغاء: {x.cancelReason}</p>}
          <Stat label="أنشأها" value={x.createdByName} /><Stat label="في" value={tsDate(x.createdAt)} />
          {x.notes && <p className="mt-2 text-sm text-muted">{x.notes}</p>}
        </Card>
      </div>
      {x.status === 'finalized' && (
        <Card title="تخصيص السدادات على هذه الدفعة" className="mt-4">
          {!allocs.data.length ? <p className="text-sm text-muted">لم يُخصص أي سداد بعد.</p> : (
            <ul className="divide-y divide-line text-sm">{allocs.data.map((a) => (
              <li key={a.id} className="flex justify-between py-2"><Link className="text-brand" to={`/payments/${a.paymentId}`}>{a.receiptNo}</Link><span>{a.status === 'void' ? <Badge tone="bad">ملغى</Badge> : <Money v={a.amountMinor} />}</span></li>))}</ul>
          )}
        </Card>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2"><Documents module="batches" recordId={x.id} /><Card title="سجل التعديلات"><History recordId={x.id} /></Card></div>
      {finalize && <FinalizeModal b={x} onClose={() => setFinalize(false)} />}
      {el}
    </>
  );
}

function FinalizeModal({ b, onClose }: { b: any; onClose: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(today());
  return (
    <FormModal open onClose={onClose} title={`اعتماد الدفعة #${b.batchNo}`} submitLabel="اعتماد نهائي" onSubmit={async () => { await api('batches.finalize', { id: b.id, settlementDate: date }); toast('تم اعتماد الدفعة وترحيل المستحق لحساب الموزع'); }}>
      <Note>بالاعتماد يُقيَّد صافي الدفعة (<span className="num font-bold">{formatMoney(b.netMinor)}</span> ريال) مديناً على الموزع ويُعترف بالإيراد بتاريخ الاعتماد. لا يمكن الاعتماد مرتين، والإلغاء لاحقاً يتطلب اعتماداً وقيداً عكسياً.</Note>
      <Field label="تاريخ الاعتماد (البيع الفعلي)" required><Input type="date" max={today()} min={b.deliveryDate} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
    </FormModal>
  );
}
export { BatchForm };
