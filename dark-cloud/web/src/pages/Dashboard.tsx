import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { formatMoney } from '@dc/shared';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { Card, Kpi, PageHeader, Loading, ErrorBox, Note, Empty, Badge } from '../components/ui';
import { Money, RangePicker, presetRange } from './common';

export const C = { navy: '#10243A', brand: '#2878C7', ok: '#16865B', warn: '#D58A24', bad: '#D64545', gold: '#C4A56A', muted: '#94A3B8' };
const PALETTE = [C.navy, C.brand, C.gold, C.ok, C.warn, '#5B8DB8', '#8C6D3D', C.muted];
const fmt = (v: number) => formatMoney(v);
const axis = { fontSize: 11, fill: '#64748B' };
const tip = { formatter: (v: any) => formatMoney(Number(v)), contentStyle: { borderRadius: 10, border: '1px solid #E2E8F0', fontFamily: 'inherit', direction: 'rtl' as const } };

export function Dashboard() {
  const { profile, settings } = useAuth();
  const [range, setRange] = useState<{ from: string; to: string; preset: string }>({ ...presetRange('month'), preset: 'month' });
  const d = useApi<any>('reports.dashboard', { from: range.from, to: range.to }, `${range.from}${range.to}`);
  const x = d.data;
  return (
    <>
      <PageHeader title={`مرحباً، ${profile?.displayName ?? ''}`} subtitle={`${settings.company.nameAr} — لوحة الإدارة التنفيذية`} actions={<RangePicker value={range} onChange={setRange} />} />
      {d.error && <ErrorBox message={d.error} retry={d.reload} />}
      {d.loading && !x ? <Loading /> : x && (
        <div className="space-y-5">
          <Note>{x.accrualVsCash}</Note>
          <section aria-label="المؤشرات المالية">
            <h2 className="mb-2 text-sm font-bold text-muted">المؤشرات المالية</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Kpi label="العهدة المفتوحة (الآن)" value={<Money v={x.financial.openCustodyGross} />} basis="balance" tone="warn" hint={<>صافي بعد العمولة <Money v={x.financial.openCustodyNet} /></>} />
              <Kpi label="مستحقات معتمدة في الفترة" value={<Money v={x.financial.finalizedReceivablesInPeriod} />} basis="accrual" tone="brand" />
              <Kpi label="التحصيلات في الفترة" value={<Money v={x.financial.collections} />} basis="cash" tone="ok" />
              <Kpi label="أرصدة الموزعين المستحقة (الآن)" value={<Money v={x.financial.outstandingBalances} />} basis="balance" tone="navy" />
              <Kpi label="الربح التشغيلي" value={<Money v={x.financial.operatingProfit} />} basis="accrual" tone={x.financial.operatingProfit >= 0 ? 'ok' : 'bad'} hint={<>صافي الإيراد <Money v={x.financial.netRevenue} /></>} />
              <Kpi label="صافي الحركة النقدية" value={<Money v={x.financial.netCashMovement} />} basis="cash" tone={x.financial.netCashMovement >= 0 ? 'ok' : 'bad'} hint={<>التشغيلي <Money v={x.financial.netOperatingCashFlow} /></>} />
              <Kpi label="المصروفات التشغيلية" value={<Money v={x.financial.operatingExpenses} />} basis="accrual" tone="bad" />
              <Kpi label="المشتريات التشغيلية" value={<Money v={x.financial.operationalPurchases} />} basis="accrual" tone="warn" />
              <Kpi label="المشتريات الرأسمالية" value={<Money v={x.financial.capitalPurchases} />} tone="gold" hint="خارج الربح التشغيلي" />
              <Kpi label="الأرصدة الدائنة للموزعين" value={<Money v={x.financial.distributorCredits} />} basis="balance" tone="gold" />
            </div>
          </section>
          <section aria-label="الصناديق">
            <h2 className="mb-2 text-sm font-bold text-muted">أرصدة الصناديق والحسابات</h2>
            {x.financial.cashAccounts.length ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{x.financial.cashAccounts.map((a: any) => <Kpi key={a.id} label={a.name} value={<Money v={a.balanceMinor} currency={a.currency} />} basis="cash" tone="ok" />)}</div>
            ) : <Card><Empty title="لا توجد حسابات نقدية" hint={<Link className="text-brand" to="/cash">أنشئ الصندوق الرئيسي</Link>} /></Card>}
          </section>
          <section aria-label="مؤشرات التوزيع">
            <h2 className="mb-2 text-sm font-bold text-muted">التوزيع</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi label="موزعون نشطون" value={x.distribution.activeDistributors} tone="ok" />
              <Kpi label="موزعون موقوفون" value={x.distribution.suspendedDistributors} tone="warn" />
              <Kpi label="دفعات مفتوحة" value={x.distribution.openBatches} tone="warn" />
              <Kpi label="دفعات معتمدة في الفترة" value={x.distribution.finalizedBatchesInPeriod} tone="brand" />
              <Kpi label="قيمة الكروت المسلمة" value={<Money v={x.distribution.deliveredValueInPeriod} />} tone="navy" />
              <Kpi label={`مستحقات متأخرة (${x.distribution.agingLabels[3]})`} value={<Money v={x.distribution.overdueReceivables} />} tone="bad" />
            </div>
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="الإيراد والمصروفات والربح شهرياً">
              <div className="h-72"><ResponsiveContainer><BarChart data={x.charts.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={fmt} width={80} orientation="right" /><Tooltip {...tip} /><Legend />
                <Bar dataKey="netRevenue" name="صافي الإيراد" fill={C.brand} radius={[4, 4, 0, 0]} /><Bar dataKey="expenses" name="مصروفات ومشتريات تشغيلية" fill={C.warn} radius={[4, 4, 0, 0]} />
                <Bar dataKey="operatingProfit" name="الربح التشغيلي" fill={C.navy} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
            </Card>
            <Card title="التحصيلات النقدية شهرياً">
              <div className="h-72"><ResponsiveContainer><LineChart data={x.charts.monthly}><CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={fmt} width={80} orientation="right" /><Tooltip {...tip} />
                <Line type="monotone" dataKey="collections" name="التحصيلات" stroke={C.ok} strokeWidth={2.5} dot /></LineChart></ResponsiveContainer></div>
            </Card>
            <Card title="أداء الموزعين (المبيعات المعتمدة في الفترة)">
              {x.charts.performance.length ? <div className="h-72"><ResponsiveContainer><BarChart data={x.charts.performance} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis type="number" tick={axis} tickFormatter={fmt} /><YAxis type="category" dataKey="name" tick={axis} width={110} orientation="right" /><Tooltip {...tip} />
                <Bar dataKey="gross" name="الإجمالي" fill={C.navy} radius={[0, 4, 4, 0]} /><Bar dataKey="net" name="الصافي" fill={C.gold} radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div> : <Empty title="لا توجد دفعات معتمدة في الفترة" />}
            </Card>
            <Card title="التوزيع حسب المنطقة (الآن)">
              {x.charts.regions.length ? <div className="h-72"><ResponsiveContainer><BarChart data={x.charts.regions}><CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" /><XAxis dataKey="region" tick={axis} /><YAxis tick={axis} tickFormatter={fmt} width={80} orientation="right" /><Tooltip {...tip} /><Legend />
                <Bar dataKey="custody" name="العهدة" fill={C.warn} radius={[4, 4, 0, 0]} /><Bar dataKey="receivable" name="المستحق" fill={C.brand} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div> : <Empty />}
            </Card>
            <Card title="المصروفات حسب النوع">
              {x.charts.expenseCategories.length ? <div className="h-72"><ResponsiveContainer><PieChart><Pie isAnimationActive={false} data={x.charts.expenseCategories} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                {x.charts.expenseCategories.map((_: any, i: number) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip {...tip} /><Legend /></PieChart></ResponsiveContainer></div> : <Empty title="لا توجد مصروفات في الفترة" />}
            </Card>
            <Card title="المشتريات: تشغيلية مقابل رأسمالية">
              {x.charts.purchasesSplit.some((p: any) => p.value) ? <div className="h-72"><ResponsiveContainer><PieChart><Pie isAnimationActive={false} data={x.charts.purchasesSplit} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                <Cell fill={C.brand} /><Cell fill={C.gold} /></Pie><Tooltip {...tip} /><Legend /></PieChart></ResponsiveContainer></div> : <Empty title="لا توجد مشتريات معتمدة في الفترة" />}
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="أعلى 5 موزعين">
              {x.distribution.top5.length ? <ol className="space-y-2">{x.distribution.top5.map((t: any, i: number) => (
                <li key={t.id} className="flex items-center justify-between text-sm"><Link to={`/distributors/${t.id}`} className="inline-flex min-h-10 items-center text-brand"><span className="ml-2 font-bold text-gold">{i + 1}</span>{t.name}</Link><Money v={t.gross} /></li>))}</ol> : <p className="text-sm text-muted">لا بيانات.</p>}
            </Card>
            <Card title={<span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-bad" />متجاوزو الحد الائتماني</span>}>
              {x.distribution.overLimit.length ? <ul className="space-y-2">{x.distribution.overLimit.map((o: any) => (
                <li key={o.id} className="flex justify-between text-sm"><Link className="inline-flex min-h-10 items-center text-brand" to={`/distributors/${o.id}`}>{o.name}</Link><span className="text-bad"><Money v={o.exposure} /> / <Money v={o.limit} /></span></li>))}</ul> : <p className="text-sm text-ok">لا يوجد تجاوز.</p>}
            </Card>
            <Card title="الإدارة">
              <div className="grid grid-cols-2 gap-2 text-center">
                {[['فريق نشط', x.management.activeTeam, '/team'], ['مهام مفتوحة', x.management.openTasks, '/tasks'], ['مهام متأخرة', x.management.overdueTasks, '/tasks'], ['اعتمادات معلقة', x.management.pendingApprovals, '/approvals']].map(([l, v, to]) => (
                  <Link key={l as string} to={to as string} className="rounded-lg bg-slate-50 p-3 hover:bg-brand-light"><p className="text-xl font-bold num">{v as number}</p><p className="text-xs text-muted">{l as string}</p></Link>))}
              </div>
              {x.management.recentActivity.length > 0 && <><p className="mb-1 mt-3 text-xs font-bold">آخر النشاطات</p><ul className="space-y-1 text-xs text-muted">
                {x.management.recentActivity.map((a: any) => <li key={a.id}><Badge tone="neutral">{a.module}</Badge> {a.action} — {a.userName}</li>)}</ul></>}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
