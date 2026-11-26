import { createContext, cloneElement, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type ReactElement, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, Download, FileSpreadsheet, Inbox, Loader2, Printer, Search, X, ArrowUpDown, Info } from 'lucide-react';
import { exportCsv, exportXlsx, type ExportColumn } from '../lib/export';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ------------------------------------------------------------------ buttons
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const btnStyles: Record<BtnVariant, string> = {
  primary: 'bg-brand text-white hover:bg-[#1f68b0] shadow-sm',
  secondary: 'bg-white text-navy border border-line hover:bg-slate-50',
  danger: 'bg-white text-bad border border-bad/30 hover:bg-bad/5',
  success: 'bg-ok text-white hover:bg-[#127050] shadow-sm',
  ghost: 'text-navy hover:bg-slate-100',
};
export function Button({ variant = 'secondary', loading, icon, children, className, size = 'md', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean; icon?: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <button {...p} disabled={p.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-10 px-4 text-sm', btnStyles[variant], className)}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ layout pieces
export function Card({ children, className, title, actions, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(16,36,58,0.04)]', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h3 className="text-sm font-bold text-navy">{title}</h3>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export interface Crumb { label: string; to?: string }
export function PageHeader({ title, subtitle, crumbs, actions }: { title: string; subtitle?: ReactNode; crumbs?: Crumb[]; actions?: ReactNode }) {
  useEffect(() => { document.title = `${title} | DARK-CLOUD`; }, [title]);
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="مسار التنقل" className="no-print mb-1 flex flex-wrap items-center gap-1 text-xs text-muted">
            {crumbs.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {c.to ? <Link to={c.to} className="hover:text-brand">{c.label}</Link> : <span>{c.label}</span>}
                {i < crumbs.length - 1 && <ChevronLeft className="h-3 w-3" />}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-bold text-navy sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'gold' | 'navy';
const toneCls: Record<Tone, string> = {
  ok: 'bg-ok/10 text-ok', warn: 'bg-warn/12 text-[#9a5f12]', bad: 'bg-bad/10 text-bad', info: 'bg-brand-light text-brand',
  neutral: 'bg-slate-100 text-slate-600', gold: 'bg-gold/15 text-[#7d6630]', navy: 'bg-navy text-white',
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', toneCls[tone])}>{children}</span>;
}

export function Kpi({ label, value, hint, tone = 'navy', basis, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'navy' | 'brand' | 'ok' | 'warn' | 'bad' | 'gold'; basis?: 'accrual' | 'cash' | 'balance'; icon?: ReactNode }) {
  const bar = { navy: 'bg-navy', brand: 'bg-brand', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', gold: 'bg-gold' }[tone];
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-white p-4">
      <span className={cx('absolute inset-y-0 right-0 w-1', bar)} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {basis && <span className={cx('shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold', basis === 'cash' ? 'bg-ok/10 text-ok' : basis === 'accrual' ? 'bg-brand-light text-brand' : 'bg-slate-100 text-slate-600')}>
          {basis === 'cash' ? 'نقدي فعلي' : basis === 'accrual' ? 'استحقاق' : 'رصيد'}</span>}
        {icon}
      </div>
      <p className="mt-2 text-xl font-bold text-navy num">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'ok' | 'bad' | 'warn' }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/70 py-2 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={cx('font-bold num', tone === 'ok' && 'text-ok', tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn')}>{value}</span>
    </div>
  );
}

export function Loading({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted"><Loader2 className="h-5 w-5 animate-spin text-brand" />{label}</div>;
}
export function Empty({ title = 'لا توجد بيانات بعد', hint, action }: { title?: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <Inbox className="h-9 w-9 text-slate-300" />
      <p className="font-semibold text-navy">{title}</p>
      {hint && <p className="max-w-md text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}
export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">
      <AlertTriangle className="h-5 w-5 shrink-0" /><span className="flex-1">{message}</span>
      {retry && <Button size="sm" onClick={retry}>إعادة المحاولة</Button>}
    </div>
  );
}
export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return <div className={cx('flex gap-2 rounded-lg p-3 text-sm', tone === 'info' ? 'bg-brand-light text-navy' : 'bg-warn/10 text-[#7a4c0e]')}><Info className="mt-0.5 h-4 w-4 shrink-0" /><div>{children}</div></div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="no-print -mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('relative whitespace-nowrap px-3 py-2.5 text-sm font-semibold transition-colors', value === t.id ? 'text-brand' : 'text-muted hover:text-navy')}>
          {t.label}{t.count !== undefined && <span className="mr-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
          {value === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-brand" />}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ form fields
export function Field({ label, hint, error, required, children, className }: { label: string; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode; className?: string }) {
  const id = useId();
  const hid = `${id}-hint`;
  const el = isValidElement(children) ? (children as ReactElement<any>) : null;
  const control = el ? cloneElement(el, { id: el.props.id ?? id, 'aria-describedby': hint || error ? hid : undefined, 'aria-invalid': error ? true : undefined, 'aria-required': required || undefined }) : children;
  return (
    <div className={cx('block', className)}>
      <label htmlFor={el ? el.props.id ?? id : undefined} className="mb-1 block text-xs font-semibold text-navy">{label}{required && <span aria-hidden="true" className="text-bad"> *</span>}</label>
      {control}
      {hint && !error && <span id={hid} className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span id={hid} className="mt-1 block text-xs text-bad">{error}</span>}
    </div>
  );
}
const inputCls = 'h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-navy placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-slate-50';
export function Input(p: InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={cx(inputCls, p.type === 'number' && 'num text-right', p.className)} />; }
export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return <select {...p} className={cx(inputCls, 'pr-3', p.className)}>{placeholder !== undefined && <option value="">{placeholder}</option>}{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}
export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea rows={3} {...p} className={cx(inputCls, 'h-auto py-2', p.className)} />; }
export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }) {
  return <div className={cx('grid grid-cols-1 gap-3', cols >= 2 && 'sm:grid-cols-2', cols >= 3 && 'lg:grid-cols-3', cols >= 4 && 'xl:grid-cols-4')}>{children}</div>;
}

// ------------------------------------------------------------------ modal / dialogs
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k); document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => { removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-dark/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={cx('flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-4xl' : 'sm:max-w-xl')}>
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-base font-bold text-navy">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-slate-100" aria-label="إغلاق"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-slate-50/60 px-5 py-3">{footer}</footer>}
      </div>
    </div>, document.body);
}

/** Generic submit form inside a modal; shows server errors inline and never closes on failure. */
export function FormModal({ open, onClose, title, onSubmit, submitLabel = 'حفظ', children, wide, danger }: {
  open: boolean; onClose: () => void; title: string; onSubmit: () => Promise<unknown>; submitLabel?: string; children: ReactNode; wide?: boolean; danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) setErr(null); }, [open]);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await onSubmit(); onClose(); } catch (e: any) { setErr(e.message || 'تعذر الحفظ'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title} wide={wide}
      footer={<><Button onClick={onClose} disabled={busy}>إلغاء</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={submit}>{submitLabel}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3">
        {err && <ErrorBox message={err} />}
        {children}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ toasts
type ToastT = { id: number; text: string; tone: 'ok' | 'bad' | 'warn' };
const ToastCtx = createContext<(text: string, tone?: ToastT['tone']) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, set] = useState<ToastT[]>([]);
  const push = useCallback((text: string, tone: ToastT['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    set((s) => [...s, { id, text, tone }]);
    setTimeout(() => set((s) => s.filter((t) => t.id !== id)), tone === 'ok' ? 4000 : 8000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="no-print pointer-events-none fixed bottom-20 left-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2 lg:bottom-5">
        {items.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg', t.tone === 'ok' ? 'bg-navy' : t.tone === 'warn' ? 'bg-warn' : 'bg-bad')}>
            {t.tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}{t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------------ data view (table on desktop, record cards on mobile)
export interface Col<T> {
  key: string; label: string; render?: (r: T) => ReactNode; value?: (r: T) => string | number | null | undefined;
  align?: 'end'; mobile?: 'title' | 'sub' | 'meta' | 'amount' | 'hide'; noExport?: boolean; className?: string;
}
export function DataView<T extends { id: string }>({ rows, columns, loading, error, onRowClick, search, emptyTitle, emptyHint, exportName, toolbar, footer, pageSize = 50, title }: {
  rows: T[]; columns: Col<T>[]; loading?: boolean; error?: string | null; onRowClick?: (r: T) => void; search?: (r: T) => string; emptyTitle?: string; emptyHint?: ReactNode;
  exportName?: string; toolbar?: ReactNode; footer?: ReactNode; pageSize?: number; title?: string;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [limit, setLimit] = useState(pageSize);
  const [printing, setPrinting] = useState(false);
  useEffect(() => { const b = () => setPrinting(true), a = () => setPrinting(false); addEventListener('beforeprint', b); addEventListener('afterprint', a); return () => { removeEventListener('beforeprint', b); removeEventListener('afterprint', a); }; }, []);
  const val = (c: Col<T>, r: T) => (c.value ? c.value(r) : (r as any)[c.key]);
  const filtered = useMemo(() => {
    let out = rows;
    if (q.trim() && search) { const s = q.trim().toLowerCase(); out = out.filter((r) => search(r).toLowerCase().includes(s)); }
    if (sort) { const c = columns.find((x) => x.key === sort.key)!; out = [...out].sort((a, b) => { const x = val(c, a), y = val(c, b); return (x == null ? -1 : y == null ? 1 : x < y ? -1 : x > y ? 1 : 0) * sort.dir; }); }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort]);
  const shown = printing ? filtered : filtered.slice(0, limit);
  const exportCols: ExportColumn<T>[] = columns.filter((c) => !c.noExport).map((c) => ({ label: c.label, value: (r) => { const v = val(c, r); return typeof v === 'object' ? '' : v; } }));
  const titleCol = columns.find((c) => c.mobile === 'title') ?? columns[0];
  const amountCol = columns.find((c) => c.mobile === 'amount');
  return (
    <div className="print-area rounded-xl border border-line bg-white">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line p-3">
        {search && (
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث…" aria-label="بحث" className={cx(inputCls, 'pr-9')} />
          </div>
        )}
        {toolbar}
        {exportName && (
          <div className="flex gap-1.5">
            <Button size="sm" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => exportXlsx(exportName, title || exportName, exportCols, filtered, title)} disabled={!filtered.length}>Excel</Button>
            <Button size="sm" icon={<Download className="h-4 w-4" />} onClick={() => exportCsv(exportName, exportCols, filtered)} disabled={!filtered.length}>CSV</Button>
            <Button size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => print()} disabled={!filtered.length}>طباعة / PDF</Button>
          </div>
        )}
      </div>
      {title && <h2 className="hidden px-3 pt-3 text-base font-bold print:block">{title}</h2>}
      {error ? <div className="p-3"><ErrorBox message={error} /></div> : loading ? <Loading /> : !filtered.length ? <Empty title={q ? 'لا توجد نتائج مطابقة' : emptyTitle} hint={q ? undefined : emptyHint} /> : (
        <>
          <div className="hidden overflow-x-auto md:block print:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-muted">
                <tr>{columns.map((c) => (
                  <th key={c.key} scope="col" className={cx('px-3 py-2.5 font-semibold', c.align === 'end' ? 'text-left' : 'text-right')}>
                    <button className="no-print inline-flex items-center gap-1 hover:text-navy" onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key ? (-s.dir as 1 | -1) : 1 }))}>
                      {c.label}<ArrowUpDown className="h-3 w-3 opacity-40" />
                    </button>
                    <span className="hidden print:inline">{c.label}</span>
                  </th>))}</tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx('border-t border-line/70', onRowClick && 'cursor-pointer hover:bg-brand-light/40')}>
                    {columns.map((c) => <td key={c.key} className={cx('px-3 py-2.5 align-middle', c.align === 'end' && 'text-left', c.className)}>{c.render ? c.render(r) : String(val(c, r) ?? '—')}</td>)}
                  </tr>
                ))}
              </tbody>
              {footer && <tfoot className="border-t-2 border-line bg-slate-50 font-bold">{footer}</tfoot>}
            </table>
          </div>
          <ul className="divide-y divide-line md:hidden print:hidden">
            {shown.map((r) => (
              <li key={r.id}>
                <button disabled={!onRowClick} onClick={() => onRowClick?.(r)} className="flex w-full items-start justify-between gap-3 p-3 text-right">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-navy">{titleCol.render ? titleCol.render(r) : String(val(titleCol, r) ?? '')}</div>
                    {columns.filter((c) => c.mobile === 'sub').map((c) => <div key={c.key} className="mt-0.5 text-xs text-muted">{c.render ? c.render(r) : String(val(c, r) ?? '')}</div>)}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">{columns.filter((c) => c.mobile === 'meta').map((c) => <span key={c.key} className="text-xs">{c.render ? c.render(r) : String(val(c, r) ?? '')}</span>)}</div>
                  </div>
                  {amountCol && <div className="shrink-0 text-left font-bold">{amountCol.render ? amountCol.render(r) : String(val(amountCol, r) ?? '')}</div>}
                </button>
              </li>
            ))}
          </ul>
          {footer && <div className="border-t-2 border-line bg-slate-50 md:hidden"><table className="w-full text-sm"><tbody>{footer}</tbody></table></div>}
          {filtered.length > shown.length && (
            <div className="no-print border-t border-line p-3 text-center">
              <Button size="sm" onClick={() => setLimit((l) => l + pageSize)}>عرض المزيد ({filtered.length - shown.length} متبقٍ)</Button>
            </div>
          )}
          <p className="no-print px-3 pb-2 text-xs text-muted">{filtered.length} سجل</p>
        </>
      )}
    </div>
  );
}

/** Promise-based prompt for a mandatory reason (cancellations, adjustments). */
export function useReasonPrompt() {
  const [st, set] = useState<{ title: string; label: string; resolve: (v: string | null) => void; danger?: boolean } | null>(null);
  const [text, setText] = useState('');
  const ask = (title: string, label = 'السبب', danger = true) => new Promise<string | null>((resolve) => { setText(''); set({ title, label, resolve, danger }); });
  const el = st && (
    <Modal open onClose={() => { st.resolve(null); set(null); }} title={st.title}
      footer={<><Button onClick={() => { st.resolve(null); set(null); }}>تراجع</Button><Button variant={st.danger ? 'danger' : 'primary'} disabled={!text.trim()} onClick={() => { st.resolve(text.trim()); set(null); }}>تأكيد</Button></>}>
      <Field label={st.label} required><Textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus /></Field>
      <p className="mt-2 text-xs text-muted">يُسجَّل السبب في سجل التدقيق. العمليات المالية لا تُحذف بل تُعكس بقيود عكسية.</p>
    </Modal>
  );
  return { ask, el };
}
