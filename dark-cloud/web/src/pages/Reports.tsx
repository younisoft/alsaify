import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { formatDate, formatMoney, ACCOUNTS } from '@dc/shared';
import { useAuth } from '../lib/auth';
import { useApi, useCollection } from '../lib/hooks';
import { major } from '../lib/format';
import { Card, DataView, Field, Input, Kpi, Note, PageHeader, Tabs, Loading, ErrorBox, Stat, Button, Badge, Select } from '../components/ui';
import { Money, RangePicker, presetRange, today } from './common';
import { C } from './Dashboard';

type T = 'monthly' | 'profit' | 'cash' | 'aging' | 'balances' | 'integrity' | 'catalog';
export function ReportsPage() {
  const [tab, setTab] = useState<T>('monthly');
  return (
    <>
      <PageHeader title="التقارير" subtitle="كل الأرقام محسوبة على الخادم من القيود والحركات الفعلية عبر محرك محاسبي واحد" crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'التقارير' }]} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'monthly', label: 'الشهري والسنوي' }, { id: 'profit', label: 'الأرباح' }, { id: 'cash', label: 'التدفق النقدي' }, { id: 'aging', label: 'أعمار الديون' },
        { id: 'balances', label: 'العهدة والمستحقات' }, { id: 'integrity', label: 'سلامة الدفاتر' }, { id: 'catalog', label: 'كل التقارير' }]} />
      {tab === 'monthly' && <Monthly />}{tab === 'profit' && <Profit />}{tab === 'cash' && <CashFlow />}{tab === 'aging' && <Aging />}
      {tab === 'balances' && <Balances />}{tab === 'integrity' && <Integrity />}{tab === 'catalog' && <Catalog />}
    </>
  );
}

function Monthly() {
  const [year, setYear] = useState(+today().slice(0, 4));
  const r = useApi<any>('reports.monthly', { year }, String(year));
  const cols = [
    ['deliveredValue', 'قيمة الكروت المسلمة'], ['finalizedGross', 'قيمة الدفعات المعتمدة'], ['commissions', 'عمولات الموزعين'], ['netRevenue', 'صافي الإيراد المستحق'],
    ['collections', 'التحصيل الفعلي'], ['operatingExpenses', 'مصروفات تشغيلية'], ['operationalPurchases', 'مشتريات تشغيلية'], ['depreciation', 'الإهلاك'],
    ['operatingProfit', 'الربح التشغيلي'], ['netCashMovement', 'صافي التدفق النقدي'], ['capitalPurchases', 'مشتريات رأسمالية'],
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2"><Field label="السنة"><Select value={String(year)} onChange={(e) => setYear(+e.target.value)} options={Array.from({ length: 6 }, (_, i) => +today().slice(0, 4) - i).map((y) => ({ value: String(y), label: String(y) }))} /></Field></div>
      {r.error && <ErrorBox message={r.error} />}
      {r.loading ? <Loading /> : r.data && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label={`صافي الإيراد ${year}`} value={<Money v={r.data.total.netRevenue} />} basis="accrual" tone="brand" hint={<>السنة السابقة <Money v={r.data.previousYear.total.netRevenue} /></>} />
          <Kpi label="الربح التشغيلي" value={<Money v={r.data.total.operatingProfit} />} basis="accrual" tone="ok" hint={<>السابقة <Money v={r.data.previousYear.total.operatingProfit} /></>} />
          <Kpi label="التحصيل الفعلي" value={<Money v={r.data.total.collections} />} basis="cash" tone="ok" hint={<>السابقة <Money v={r.data.previousYear.total.collections} /></>} />
          <Kpi label="صافي التدفق النقدي" value={<Money v={r.data.total.netCashMovement} />} basis="cash" hint="يشمل المشتريات الرأسمالية المدفوعة" />
        </div>
        <Card title="مقارنة شهرية"><div className="h-72"><ResponsiveContainer><BarChart data={r.data.rows.map((x: any, i: number) => ({ ...x, prev: r.data.previousYear.rows[i].netRevenue }))}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatMoney(v)} width={80} orientation="right" />
          <Tooltip formatter={(v: any) => formatMoney(Number(v))} /><Legend /><Bar dataKey="netRevenue" name={`صافي الإيراد ${year}`} fill={C.brand} /><Bar dataKey="prev" name={`${year - 1}`} fill={C.muted} />
          <Bar dataKey="operatingProfit" name="الربح التشغيلي" fill={C.navy} /></BarChart></ResponsiveContainer></div></Card>
        <DataView rows={r.data.rows.map((x: any) => ({ ...x, id: x.month }))} exportName={`monthly-${year}`} title={`الملخص الشهري والسنوي ${year}`} pageSize={12}
          columns={[{ key: 'label', label: 'الشهر', mobile: 'title' }, ...cols.map(([k, l]) => ({ key: k, label: l, align: 'end' as const, mobile: k === 'operatingProfit' ? ('amount' as const) : undefined, value: (x: any) => major(x[k]), render: (x: any) => <Money v={x[k]} /> }))]}
          footer={<tr><td className="px-3 py-2">الإجمالي</td>{cols.map(([k]) => <td key={k} className="px-3 py-2 text-left"><Money v={r.data.total[k]} /></td>)}</tr>} />
        <Card title="الأرصدة الحالية"><p className="mb-2 text-xs text-muted">{r.data.currentBalances.note}</p>
          <Stat label="أرصدة الموزعين" value={<Money v={r.data.currentBalances.distributorBalances} />} /><Stat label="العهدة المفتوحة" value={<Money v={r.data.currentBalances.openCustody} />} />
          <Stat label="أرصدة الموردين" value={<Money v={r.data.currentBalances.supplierBalances} />} />
          {r.data.currentBalances.cash.map((c: any) => <Stat key={c.name} label={c.name} value={<Money v={c.balanceMinor} currency={c.currency} />} />)}</Card>
      </>}
    </div>
  );
}

function Profit() {
  const [range, setRange] = useState({ ...presetRange('month'), preset: 'month' });
  const r = useApi<any>('reports.profit', { from: range.from, to: range.to }, `${range.from}${range.to}`);
  const rows: [string, string, boolean?][] = [['grossCardRevenue', 'إيراد الكروت المعتمدة (إجمالي)'], ['commissions', '(−) عمولات الموزعين'], ['distributorAdjustments', '(±) تسويات الموزعين'], ['netRevenue', 'صافي الإيراد', true],
    ['otherIncome', '(+) إيرادات أخرى'], ['operatingExpenses', '(−) المصروفات التشغيلية'], ['operationalPurchases', '(−) المشتريات التشغيلية المستهلكة'], ['inventoryLosses', '(−) فروقات وتالف المخزون'],
    ['cashOverShort', '(−) عجز/(+) زيادة الصناديق'], ['operatingProfitBeforeDepreciation', 'الربح التشغيلي قبل الإهلاك', true], ['depreciation', '(−) الإهلاك'], ['operatingProfit', 'الربح التشغيلي', true]];
  return (
    <div className="space-y-4">
      <RangePicker value={range} onChange={setRange} />
      <Note>أساس الاستحقاق: الإيراد يُعترف به عند اعتماد الدفعة. العهدة المفتوحة والمشتريات الرأسمالية خارج الأرباح. سياسة إدراج الإهلاك في الربح التشغيلي غير محددة بعد، لذا يُعرض الربح قبل الإهلاك وبعده.</Note>
      {r.error && <ErrorBox message={r.error} />}
      {r.loading ? <Loading /> : r.data && (
        <Card title={`قائمة الأرباح ${formatDate(r.data.range.from)} — ${formatDate(r.data.range.to)}`} pad={false}>
          <table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-muted"><tr><th className="p-3 text-right">البند</th><th className="p-3 text-left">الفترة الحالية</th><th className="p-3 text-left">الفترة المماثلة السابقة</th></tr></thead>
            <tbody>{rows.map(([k, l, bold]) => <tr key={k} className={`border-t border-line ${bold ? 'bg-brand-light/40 font-bold' : ''}`}><td className="p-3">{l}</td><td className="p-3 text-left"><Money v={r.data.current[k]} /></td><td className="p-3 text-left text-muted"><Money v={r.data.previous[k]} /></td></tr>)}</tbody></table>
          {Object.keys(r.data.current.expensesByCategory).length > 0 && <div className="border-t border-line p-4"><p className="mb-2 text-xs font-bold">تفصيل المصروفات</p>
            {Object.entries(r.data.current.expensesByCategory).map(([k, v]) => <Stat key={k} label={r.data.expenseCategoryNames[k]} value={<Money v={v as number} />} />)}</div>}
        </Card>
      )}
    </div>
  );
}

function CashFlow() {
  const [range, setRange] = useState({ ...presetRange('month'), preset: 'month' });
  const r = useApi<any>('reports.cashflow', { from: range.from, to: range.to }, `${range.from}${range.to}`);
  const TYPE: Record<string, string> = { distributor_receipt: 'تحصيلات الموزعين', expense: 'مصروفات', purchase: 'مشتريات مدفوعة', supplier_payment: 'سداد موردين', other_income: 'إيرادات أخرى', owner_capital: 'رأس مال', owner_withdrawal: 'مسحوبات المالك', adjustment: 'فروق جرد', reversal: 'قيود عكسية', transfer: 'تحويلات داخلية (مستبعدة)' };
  return (
    <div className="space-y-4">
      <RangePicker value={range} onChange={setRange} />
      <Note>نقدي فعلي فقط: لا يتضمن المستحقات غير المحصلة ولا الفواتير غير المدفوعة. التحويلات الداخلية مستبعدة. الأرصدة الافتتاحية ليست تدفقاً.</Note>
      {r.error && <ErrorBox message={r.error} />}
      {r.loading ? <Loading /> : r.data && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="ملخص التدفق النقدي">
          <Stat label="مقبوضات تشغيلية" value={<Money v={r.data.summary.operatingIn} />} tone="ok" /><Stat label="مدفوعات تشغيلية" value={<Money v={-r.data.summary.operatingOut} />} />
          <Stat label="صافي التدفق التشغيلي" value={<Money v={r.data.summary.netOperating} />} />
          <Stat label="مدفوعات استثمارية (رأسمالية)" value={<Money v={r.data.summary.investingIn - r.data.summary.investingOut} />} />
          <Stat label="تمويلي (رأس مال − مسحوبات)" value={<Money v={r.data.summary.financingIn - r.data.summary.financingOut} />} />
          <Stat label="صافي الحركة النقدية" value={<Money v={r.data.summary.netCashMovement} />} />
        </Card>
        <Card title="حسب نوع الحركة">{Object.entries(r.data.byType).map(([k, v]: any) => <Stat key={k} label={TYPE[k] ?? k} value={<span>وارد <Money v={v.in} /> · صادر <Money v={v.out} /></span>} />)}</Card>
      </div>}
    </div>
  );
}

function Aging() {
  const [asOf, setAsOf] = useState(today());
  const r = useApi<any>('reports.aging', { asOf }, asOf);
  return (
    <div className="space-y-4">
      <Field label="حتى تاريخ"><Input type="date" className="w-44" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
      <Note>الأعمار محسوبة على الدفعات المعتمدة غير المسددة (من تاريخ الاعتماد) والأرصدة المدينة. المبالغ المقبوضة غير المخصصة تُعرض منفصلة ولا تُخصم تلقائياً. الفئات قابلة للتعديل من الإعدادات.</Note>
      {r.error && <ErrorBox message={r.error} />}
      {r.loading ? <Loading /> : r.data && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{r.data.labels.map((l: string, i: number) => <Kpi key={l} label={l} value={<Money v={r.data.totals[i]} />} tone={i === 3 ? 'bad' : i === 2 ? 'warn' : 'brand'} />)}</div>
        <DataView rows={r.data.rows} exportName={`aging-${asOf}`} title={`أعمار ديون الموزعين حتى ${formatDate(asOf)}`} search={(x: any) => `${x.code} ${x.name}`} columns={[
          { key: 'name', label: 'الموزع', mobile: 'title', render: (x: any) => <Link className="text-brand" to={`/distributors/${x.id}`}>{x.name}</Link>, value: (x: any) => x.name },
          ...r.data.labels.map((l: string, i: number) => ({ key: `b${i}`, label: l, align: 'end' as const, value: (x: any) => major(x.buckets[i]), render: (x: any) => (x.buckets[i] ? <Money v={x.buckets[i]} /> : '—') })),
          { key: 'total', label: 'الإجمالي', align: 'end', mobile: 'amount', value: (x: any) => major(x.total), render: (x: any) => <Money v={x.total} /> },
          { key: 'unalloc', label: 'رصيد دائن غير مخصص', align: 'end', value: (x: any) => major(x.unallocatedCredit), render: (x: any) => (x.unallocatedCredit ? <Money v={x.unallocatedCredit} /> : '—') },
        ]} />
      </>}
    </div>
  );
}

function Balances() {
  const { settings } = useAuth();
  const d = useCollection<any>('distributors', []);
  const rows = d.data.filter((x) => x.bal?.custodyGross || x.bal?.ledger);
  return <DataView rows={rows} loading={d.loading} error={d.error} exportName="custody-receivables" title="تقرير العهدة المفتوحة والمستحقات" search={(x) => `${x.code} ${x.name}`} columns={[
    { key: 'name', label: 'الموزع', mobile: 'title' }, { key: 'region', label: 'المنطقة', mobile: 'sub', value: (x) => x.region || '—' },
    { key: 'custody', label: 'العهدة المفتوحة (إجمالي)', align: 'end', value: (x) => major(x.bal?.custodyGross), render: (x) => <Money v={x.bal?.custodyGross} /> },
    { key: 'custodyNet', label: 'العهدة (صافي)', align: 'end', value: (x) => major(x.bal?.custodyNet), render: (x) => <Money v={x.bal?.custodyNet} /> },
    { key: 'ledger', label: 'المستحق المعتمد (الرصيد)', align: 'end', mobile: 'amount', value: (x) => major(x.bal?.ledger), render: (x) => <Money v={x.bal?.ledger} /> },
    { key: 'limit', label: 'الحد الائتماني', align: 'end', value: (x) => major(x.creditLimitMinor ?? settings.finance.defaultCreditLimitMinor), render: (x) => <Money v={x.creditLimitMinor ?? settings.finance.defaultCreditLimitMinor} /> },
  ]} footer={<tr><td className="px-3 py-2" colSpan={2}>الإجمالي</td><td className="px-3 py-2 text-left"><Money v={rows.reduce((a, x) => a + (x.bal?.custodyGross || 0), 0)} /></td>
    <td className="px-3 py-2 text-left"><Money v={rows.reduce((a, x) => a + (x.bal?.custodyNet || 0), 0)} /></td><td className="px-3 py-2 text-left"><Money v={rows.reduce((a, x) => a + (x.bal?.ledger || 0), 0)} /></td><td /></tr>} />;
}

function Integrity() {
  const r = useApi<any>('reports.reconcile', {}, '');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Button icon={<ShieldCheck className="h-4 w-4" />} onClick={r.reload} loading={r.loading}>إعادة الفحص</Button>
        {r.data && <Badge tone={r.data.ok ? 'ok' : 'bad'}>{r.data.ok ? 'الدفاتر متطابقة' : 'توجد فروقات'}</Badge>}</div>
      {r.error && <ErrorBox message={r.error} />}
      {r.data && <>
        <Card title="فحوص المطابقة">{r.data.checks.map((c: any) => (
          <div key={c.name} className="flex items-start gap-2 border-b border-line py-2 last:border-0 text-sm">{c.ok ? <CheckCircle2 className="h-5 w-5 text-ok" /> : <XCircle className="h-5 w-5 text-bad" />}
            <div className="flex-1">{c.name}{!c.ok && <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs" dir="ltr">{JSON.stringify(c.details, null, 1)}</pre>}</div></div>))}</Card>
        <DataView rows={r.data.trialBalance.map((t: any) => ({ ...t, id: t.account }))} exportName="trial-balance" title="ميزان المراجعة" columns={[
          { key: 'account', label: 'الحساب', mobile: 'meta' }, { key: 'name', label: 'الاسم', mobile: 'title', value: (t: any) => t.name ?? ACCOUNTS[t.account]?.name },
          { key: 'debit', label: 'مدين', align: 'end', value: (t: any) => major(Math.max(t.balanceMinor, 0)), render: (t: any) => (t.balanceMinor > 0 ? <Money v={t.balanceMinor} /> : '') },
          { key: 'credit', label: 'دائن', align: 'end', mobile: 'amount', value: (t: any) => major(Math.max(-t.balanceMinor, 0)), render: (t: any) => (t.balanceMinor < 0 ? <Money v={-t.balanceMinor} /> : '') }]} />
      </>}
    </div>
  );
}

function Catalog() {
  const list: [string, string, string][] = [
    ['تقرير الموزعين', '/distributors', 'الموزعون — Excel/CSV/طباعة'], ['تقرير الدفعات', '/batches', 'الدفعات — مع تصفية الحالة'], ['تقرير العهدة المفتوحة', '/batches?status=open', 'الدفعات المفتوحة'],
    ['تقرير المستحقات', '/reports', 'تبويب العهدة والمستحقات'], ['تقرير السدادات', '/payments', 'سندات القبض'], ['أعمار الديون', '/reports', 'تبويب أعمار الديون'],
    ['تقرير المصروفات', '/expenses', 'مع تصفية النوع'], ['تقرير المشتريات', '/purchases', 'تشغيلي/رأسمالي'], ['تقرير الموردين', '/suppliers', 'الأرصدة وكشوف الحساب'],
    ['تقرير المخزون', '/inventory', 'الأصناف والحركات'], ['تقرير الأصول', '/assets', 'التكلفة والإهلاك'], ['تقرير الحسابات النقدية', '/cash', 'الأرصدة وكشوف الحساب'],
    ['تقرير الأرباح', '/reports', 'تبويب الأرباح'], ['تقرير التدفق النقدي', '/reports', 'تبويب التدفق النقدي'], ['تقرير نشاط المستخدمين', '/audit', 'سجل التدقيق'],
  ];
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map(([t, to, h], i) => (
    <Link key={i} to={to} className="rounded-xl border border-line bg-white p-4 hover:border-brand"><p className="font-bold"><span className="ml-1 text-gold num">{i + 1}.</span>{t}</p><p className="mt-1 text-xs text-muted">{h}</p></Link>))}
    <p className="text-xs text-muted sm:col-span-2 lg:col-span-3">كل جدول يدعم البحث والفرز والتصدير إلى Excel و CSV والطباعة / الحفظ PDF. التصفية بالتاريخ متاحة في التقارير المالية.</p></div>;
}
