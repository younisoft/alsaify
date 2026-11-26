import { useMemo, useRef, useState, type ReactNode } from 'react';
import { orderBy, where, limit } from 'firebase/firestore';
import { ref as sref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Paperclip, Upload, FileText } from 'lucide-react';
import { addDays, todayISO, BATCH_STATUS_LABELS, SETTLEMENT_LABELS, DISTRIBUTOR_STATUS_LABELS, type Module } from '@dc/shared';
import { useAuth } from '../lib/auth';
import { useCollection } from '../lib/hooks';
import { api, uuid } from '../lib/api';
import { storage } from '../lib/firebase';
import { money, tsDate } from '../lib/format';
import { Badge, Button, Card, Field, Input, Select, Empty, Loading, ErrorBox, useToast, cx } from '../components/ui';

export const today = () => todayISO();

export function Money({ v, className, currency }: { v: number | null | undefined; className?: string; currency?: string }) {
  const { settings } = useAuth();
  const neg = (v ?? 0) < 0;
  return <span className={cx('num font-semibold', neg && 'text-bad', className)}>{money(v, settings.finance.precision)}{currency && currency !== settings.finance.baseCurrency ? ` ${currency}` : ''}</span>;
}

export function BatchStatus({ s }: { s: keyof typeof BATCH_STATUS_LABELS }) {
  const tone = { draft: 'neutral', open: 'warn', finalized: 'ok', cancelled: 'bad', returned: 'gold' }[s] as any;
  return <Badge tone={tone}>{BATCH_STATUS_LABELS[s]}</Badge>;
}
export function SettlementBadge({ s }: { s: keyof typeof SETTLEMENT_LABELS }) {
  return <Badge tone={s === 'paid' ? 'ok' : s === 'partial' ? 'info' : 'warn'}>{SETTLEMENT_LABELS[s]}</Badge>;
}
export function DistStatus({ s }: { s: keyof typeof DISTRIBUTOR_STATUS_LABELS }) {
  return <Badge tone={s === 'active' ? 'ok' : s === 'suspended' ? 'warn' : 'neutral'}>{DISTRIBUTOR_STATUS_LABELS[s]}</Badge>;
}
export function DocStatus({ s }: { s: string }) {
  return s === 'cancelled' ? <Badge tone="bad">ملغى (معكوس)</Badge> : s === 'pending' ? <Badge tone="warn">بانتظار الاعتماد</Badge> : <Badge tone="ok">مُرحَّل</Badge>;
}

/** Lookups for selects (only loaded when the user may read them). */
export function useCashAccounts(currency?: string) {
  const { can } = useAuth();
  const allowed = can('cash', 'view') || can('payments', 'create') || can('expenses', 'create') || can('purchases', 'create') || can('suppliers', 'create');
  const r = useCollection<any>(allowed ? 'cash_accounts' : null, [where('status', '==', 'active')]);
  return useMemo(() => r.data.filter((a) => !currency || a.currency === currency).map((a) => ({ value: a.id, label: `${a.name} (${a.currency})`, currency: a.currency })), [r.data, currency]);
}
export function useDistributorOptions(activeOnly = true) {
  const { can } = useAuth();
  const r = useCollection<any>(can('distributors', 'view') ? 'distributors' : null, [orderBy('code')]);
  return useMemo(() => r.data.filter((d) => !activeOnly || d.status === 'active').map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })), [r.data, activeOnly]);
}
export function useSupplierOptions() {
  const { can } = useAuth();
  const r = useCollection<any>(can('suppliers', 'view') ? 'suppliers' : null, [orderBy('code')]);
  return useMemo(() => r.data.filter((s) => s.status === 'active').map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })), [r.data]);
}
export function useTeamOptions() {
  const { profile } = useAuth();
  const r = useCollection<any>(profile?.kind === 'owner' ? 'users' : null, []);
  return useMemo(() => {
    const list = r.data.filter((u) => u.status === 'active' && u.kind !== 'portal').map((u) => ({ value: u.id, label: u.displayName }));
    if (!list.length && profile) list.push({ value: profile.uid, label: profile.displayName });
    return list;
  }, [r.data, profile]);
}

// ------------------------------------------------------------------ date range presets
export type Range = { from: string; to: string };
export function presetRange(p: string): Range {
  const t = todayISO(); const y = +t.slice(0, 4), m = +t.slice(5, 7);
  const mm = (x: number) => String(x).padStart(2, '0');
  const lastDay = (yy: number, mo: number) => new Date(Date.UTC(yy, mo, 0)).getUTCDate();
  switch (p) {
    case 'today': return { from: t, to: t };
    case 'week': { const dow = new Date(t + 'T00:00:00Z').getUTCDay(); const back = (dow + 1) % 7; return { from: addDays(t, -back), to: t }; } // week starts Saturday
    case 'prevMonth': { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return { from: `${py}-${mm(pm)}-01`, to: `${py}-${mm(pm)}-${lastDay(py, pm)}` }; }
    case 'year': return { from: `${y}-01-01`, to: t };
    case 'prevYear': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default: return { from: `${y}-${mm(m)}-01`, to: t };
  }
}
const PRESETS = [{ value: 'today', label: 'اليوم' }, { value: 'week', label: 'هذا الأسبوع' }, { value: 'month', label: 'هذا الشهر' }, { value: 'prevMonth', label: 'الشهر السابق' },
  { value: 'year', label: 'هذه السنة' }, { value: 'prevYear', label: 'السنة السابقة' }, { value: 'custom', label: 'فترة مخصصة' }];
export function RangePicker({ value, onChange }: { value: Range & { preset?: string }; onChange: (r: Range & { preset: string }) => void }) {
  const preset = value.preset ?? 'month';
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select aria-label="الفترة" className="w-40" value={preset} options={PRESETS} onChange={(e) => onChange({ ...(e.target.value === 'custom' ? value : presetRange(e.target.value)), preset: e.target.value })} />
      {preset === 'custom' && <>
        <Input type="date" aria-label="من" className="w-40" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value, preset })} />
        <Input type="date" aria-label="إلى" className="w-40" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value, preset })} />
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ currency fields
export function CurrencyFields({ currency, rate, onCurrency, onRate, fixedCurrency, date }: { currency: string; rate: string; onCurrency?: (c: string) => void; onRate: (r: string) => void; fixedCurrency?: boolean; date?: string }) {
  const { settings } = useAuth();
  const base = settings.finance.baseCurrency;
  const rates = useCollection<any>(currency !== base ? 'exchange_rates' : null, [where('currency', '==', currency), orderBy('date', 'desc'), limit(1)], currency);
  const latest = rates.data[0];
  return (
    <>
      <Field label="العملة" required>
        <Select value={currency} disabled={fixedCurrency} onChange={(e) => onCurrency?.(e.target.value)} options={settings.lists.currencies.filter((c) => c.active).map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))} />
      </Field>
      {currency !== base && (
        <Field label={`سعر الصرف (1 ${currency} = ؟ ${base})`} required={!latest}
          hint={latest ? `اتركه فارغاً لاستخدام آخر سعر مسجل: ${latest.rate} بتاريخ ${latest.date}${date && latest.date > date ? ' (أحدث من تاريخ العملية — لن يُستخدم)' : ''}` : 'لا يوجد سعر مسجل — أدخل السعر يدوياً'}>
          <Input type="number" inputMode="decimal" step="any" min="0" value={rate} onChange={(e) => onRate(e.target.value)} />
        </Field>
      )}
    </>
  );
}
export const num = (s: string) => (s === '' || s == null ? undefined : Number(s));

// ------------------------------------------------------------------ attachments
export function Documents({ module, recordId }: { module: Module; recordId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const canView = can(module, 'view') || can('archive', 'view');
  const canAdd = can(module, 'create') || can(module, 'edit') || can('archive', 'create');
  const docs = useCollection<any>(canView ? 'documents' : null, [where('module', '==', module), where('recordId', '==', recordId)], recordId);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (f: File) => {
    if (f.size > 10 * 1024 * 1024) return toast('الحد الأقصى لحجم الملف 10 ميجابايت', 'bad');
    setBusy(true);
    try {
      const path = `documents/${module}/${recordId}/${uuid()}-${f.name.replace(/[^\w.\-؀-ۿ]/g, '_')}`;
      await uploadBytes(sref(storage, path), f, { contentType: f.type });
      await api('documents.register', { module, recordId, path, name: f.name, size: f.size, contentType: f.type });
      toast('تم إرفاق المستند');
    } catch (e: any) { toast(e.code === 'storage/unauthorized' ? 'نوع الملف أو الصلاحية غير مسموح' : e.message, 'bad'); } finally { setBusy(false); }
  };
  const open = async (path: string) => { try { window.open(await getDownloadURL(sref(storage, path)), '_blank', 'noopener'); } catch { toast('تعذر فتح الملف', 'bad'); } };
  if (!canView) return null;
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Paperclip className="h-4 w-4" />المستندات المرفقة</span>}
      actions={canAdd && <>
        <input ref={input} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        <Button size="sm" icon={<Upload className="h-4 w-4" />} loading={busy} onClick={() => input.current?.click()}>إرفاق</Button>
      </>}>
      {docs.loading ? <Loading /> : !docs.data.length ? <p className="text-sm text-muted">لا توجد مستندات. المسموح: PDF، صور، Word، Excel حتى 10MB.</p> : (
        <ul className="divide-y divide-line">
          {docs.data.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <button className="inline-flex items-center gap-2 text-brand hover:underline" onClick={() => void open(d.path)}><FileText className="h-4 w-4" />{d.name}</button>
              <span className="text-xs text-muted">{(d.size / 1024).toFixed(0)}KB · {d.createdByName} · {tsDate(d.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function History({ recordId }: { recordId: string }) {
  const { can } = useAuth();
  const r = useCollection<any>(can('audit', 'view') ? 'audit_logs' : null, [where('recordId', '==', recordId), orderBy('at', 'desc'), limit(50)], recordId);
  if (!can('audit', 'view')) return <Empty title="سجل التعديلات" hint="يتطلب صلاحية عرض سجل التدقيق" />;
  if (r.error) return <ErrorBox message={r.error} />;
  return r.loading ? <Loading /> : !r.data.length ? <Empty title="لا توجد تعديلات مسجلة" /> : (
    <ol className="space-y-2">
      {r.data.map((a) => (
        <li key={a.id} className="rounded-lg border border-line p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{a.action}</span><span className="text-xs text-muted">{a.userName} · {tsDate(a.at)}</span></div>
          {a.reason && <p className="mt-1 text-xs text-muted">السبب: {a.reason}</p>}
        </li>
      ))}
    </ol>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="mb-4"><h3 className="mb-2 text-sm font-bold text-navy">{title}</h3>{children}</div>;
}
