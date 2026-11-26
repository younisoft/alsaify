import { useEffect, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { formatDate, formatMoney, BATCH_STATUS_LABELS } from '@dc/shared';
import { useAuth } from '../lib/auth';
import { useApi, useDoc } from '../lib/hooks';
import { tsDate } from '../lib/format';
import { Button, Loading, ErrorBox } from '../components/ui';
import { today } from './common';

function Sheet({ title, docNo, children, loading, error }: { title: string; docNo?: string; children: ReactNode; loading?: boolean; error?: string | null }) {
  const { settings } = useAuth();
  useEffect(() => { document.title = `${title} ${docNo ?? ''}`; }, [title, docNo]);
  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-3 flex max-w-[210mm] justify-end gap-2 px-2"><Button variant="primary" icon={<Printer className="h-4 w-4" />} onClick={() => print()}>طباعة / حفظ PDF</Button></div>
      <article className="print-area mx-auto max-w-[210mm] bg-white p-8 shadow print:shadow-none">
        <header className="flex items-start justify-between border-b-2 border-navy pb-4">
          <div><h1 className="text-lg font-bold text-navy">{settings.company.nameAr}</h1><p className="text-xs tracking-wider text-muted">{settings.company.nameEn}</p>
            <p className="mt-1 text-xs text-muted">{[settings.company.address, settings.company.phone && `هاتف ${settings.company.phone}`].filter(Boolean).join(' · ')}</p>
            {settings.company.invoiceHeader && <p className="mt-1 whitespace-pre-wrap text-xs">{settings.company.invoiceHeader}</p>}</div>
          <img src="/brand/logo-light.png" alt="DARK-CLOUD" className="h-24 object-contain" />
        </header>
        <div className="my-4 flex items-end justify-between"><h2 className="text-xl font-bold text-navy">{title}</h2>{docNo && <p className="num text-sm font-bold">{docNo}</p>}</div>
        {error ? <ErrorBox message={error} /> : loading ? <Loading /> : children}
        <footer className="mt-10 border-t border-line pt-3 text-xs text-muted">
          {settings.company.invoiceFooter && <p className="mb-1 whitespace-pre-wrap">{settings.company.invoiceFooter}</p>}
          <div className="flex justify-between"><span>المدير العام: {settings.company.managerName}</span><span>طُبع في {formatDate(today())}</span></div>
          <div className="mt-8 grid grid-cols-2 gap-8 text-center"><div className="border-t border-slate-300 pt-1">توقيع المستلم</div><div className="border-t border-slate-300 pt-1">توقيع المسؤول</div></div>
        </footer>
      </article>
    </div>
  );
}
const Row = ({ l, v }: { l: string; v: ReactNode }) => <div className="flex justify-between border-b border-line py-1.5 text-sm"><span className="text-muted">{l}</span><span className="font-semibold">{v}</span></div>;
const M = ({ v }: { v: number }) => <span className="num">{formatMoney(v)}</span>;

export function PrintBatch() {
  const { id } = useParams(); const b = useDoc<any>('batches', id); const x = b.data;
  return (
    <Sheet title="فاتورة تسليم كروت" docNo={x ? `دفعة #${x.batchNo}` : undefined} loading={b.loading} error={b.error}>
      {x && <>
        <div className="grid grid-cols-2 gap-x-8"><Row l="الموزع" v={`${x.distributorName} (${x.distributorCode})`} /><Row l="تاريخ التسليم" v={formatDate(x.deliveryDate)} />
          <Row l="الحالة" v={BATCH_STATUS_LABELS[x.status as keyof typeof BATCH_STATUS_LABELS]} /><Row l="نسبة العمولة (ثابتة)" v={`${x.commissionPct}%`} />
          {x.settlementDate && <Row l="تاريخ الاعتماد" v={formatDate(x.settlementDate)} />}</div>
        <table className="mt-4 w-full border border-line text-sm"><thead className="bg-navy text-white"><tr><th className="p-2 text-right">الفئة</th><th className="p-2">العدد</th><th className="p-2 text-left">سعر الوحدة</th><th className="p-2 text-left">الإجمالي</th><th className="p-2 text-left">العمولة</th><th className="p-2 text-left">الصافي</th></tr></thead>
          <tbody>{x.lines.map((l: any, i: number) => <tr key={i} className="border-t border-line"><td className="p-2">{l.categoryName}</td><td className="p-2 text-center num">{l.quantity}</td><td className="p-2 text-left"><M v={l.unitPriceMinor} /></td><td className="p-2 text-left"><M v={l.grossMinor} /></td><td className="p-2 text-left"><M v={l.commissionMinor} /></td><td className="p-2 text-left"><M v={l.netMinor} /></td></tr>)}</tbody>
          <tfoot className="bg-slate-50 font-bold"><tr className="border-t-2 border-navy"><td className="p-2" colSpan={3}>الإجمالي</td><td className="p-2 text-left"><M v={x.grossMinor} /></td><td className="p-2 text-left"><M v={x.commissionMinor} /></td><td className="p-2 text-left"><M v={x.netMinor} /></td></tr></tfoot></table>
        <p className="mt-3 text-xs text-muted">{x.status === 'finalized' ? 'المبلغ الصافي مستحق على الموزع منذ تاريخ الاعتماد.' : 'هذه الكروت عهدة لدى الموزع ولا تُعد مبيعات أو مستحقات حتى اعتماد الدفعة.'} المبالغ بالريال اليمني.</p>
      </>}
    </Sheet>
  );
}
export function PrintStatement() {
  const { id } = useParams(); const [sp] = useSearchParams();
  const from = sp.get('from') || undefined, to = sp.get('to') || undefined;
  const s = useApi<any>('reports.distributorStatement', { id, from, to }, `${id}${from}${to}`); const x = s.data;
  return (
    <Sheet title="كشف حساب موزع" docNo={x?.distributor.code} loading={s.loading} error={s.error}>
      {x && <>
        <div className="grid grid-cols-2 gap-x-8"><Row l="الموزع" v={x.distributor.name} /><Row l="المنطقة" v={x.distributor.region || '—'} /><Row l="الفترة" v={`${from ? formatDate(from) : 'من البداية'} — ${to ? formatDate(to) : formatDate(today())}`} /><Row l="الرصيد الافتتاحي للفترة" v={<M v={x.openingMinor} />} /></div>
        <table className="mt-4 w-full border border-line text-xs"><thead className="bg-navy text-white"><tr><th className="p-2 text-right">التاريخ</th><th className="p-2 text-right">البيان</th><th className="p-2 text-left">مدين</th><th className="p-2 text-left">دائن</th><th className="p-2 text-left">الرصيد</th></tr></thead>
          <tbody>{x.rows.map((r: any) => <tr key={r.id} className="border-t border-line"><td className="p-2">{formatDate(r.date)}</td><td className="p-2">{r.description}</td><td className="p-2 text-left">{r.debitMinor ? <M v={r.debitMinor} /> : ''}</td><td className="p-2 text-left">{r.creditMinor ? <M v={r.creditMinor} /> : ''}</td><td className="p-2 text-left"><M v={r.balanceMinor} /></td></tr>)}</tbody></table>
        <div className="mt-4 grid grid-cols-2 gap-x-8">
          <Row l="دفعات معتمدة (صافي)" v={<M v={x.totals.finalized} />} /><Row l="إجمالي السداد" v={<M v={x.totals.payments} />} /><Row l="تسويات" v={<M v={x.totals.adjustments} />} />
          <Row l="الرصيد الختامي المستحق" v={<span className="text-brand"><M v={x.closingMinor} /></span>} />
          <Row l="العهدة المفتوحة (كروت لم تُعتمد)" v={<M v={x.openCustody.reduce((a: number, b: any) => a + b.grossMinor, 0)} />} />
        </div>
        <p className="mt-2 text-xs text-muted">العهدة المفتوحة لا تدخل في الرصيد المستحق حتى اعتمادها.</p>
      </>}
    </Sheet>
  );
}
export function PrintReceipt() {
  const { id } = useParams(); const p = useDoc<any>('payments', id); const x = p.data; const { settings } = useAuth();
  return (
    <Sheet title={x?.kind === 'credit' ? 'إشعار دائن' : 'سند قبض'} docNo={x?.receiptNo} loading={p.loading} error={p.error}>
      {x && <div className="space-y-1">
        <Row l="استلمنا من" v={`${x.distributorName} (${x.distributorCode ?? x.distributorId})`} /><Row l="التاريخ" v={formatDate(x.date)} />
        <Row l="المبلغ" v={<>{formatMoney(x.originalMinor)} {x.currency}</>} />{x.currency !== settings.finance.baseCurrency && <Row l="سعر الصرف / المعادل" v={<>{x.rate} — {formatMoney(x.baseMinor)} ريال يمني</>} />}
        <Row l="طريقة السداد" v={settings.lists.paymentMethods.find((m) => m.id === x.methodId)?.name ?? '—'} /><Row l="المرجع" v={x.reference || '—'} />
        <Row l="الحالة" v={x.status === 'cancelled' ? `ملغى — ${x.cancelReason}` : 'مُرحَّل'} /><Row l="أدخله" v={`${x.createdByName} · ${tsDate(x.createdAt)}`} />
      </div>}
    </Sheet>
  );
}
