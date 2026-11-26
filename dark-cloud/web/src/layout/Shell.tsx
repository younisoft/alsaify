import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { where, orderBy, limit } from 'firebase/firestore';
import {
  LayoutDashboard, Users, Package, Wallet, PhoneCall, Landmark, Receipt, ShoppingCart, Truck, Boxes, Building2, BarChart3, ListTodo, CheckSquare,
  Archive, UserCog, ScrollText, Settings, Bell, Menu, X, LogOut, Search, Wifi, WifiOff, MoreHorizontal,
} from 'lucide-react';
import type { Module } from '@dc/shared';
import { useAuth } from '../lib/auth';
import { useCollection, useOnline } from '../lib/hooks';
import { api } from '../lib/api';
import { tsDate } from '../lib/format';
import { cx } from '../components/ui';

interface NavItem { to: string; label: string; icon: ReactNode; module?: Module; show?: (a: ReturnType<typeof useAuth>) => boolean }
const I = (C: typeof Users) => <C className="h-[18px] w-[18px]" />;
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'الرئيسية', items: [{ to: '/', label: 'لوحة التحكم', icon: I(LayoutDashboard), module: 'dashboard' }] },
  { group: 'التوزيع', items: [
    { to: '/distributors', label: 'الموزعون', icon: I(Users), module: 'distributors' },
    { to: '/batches', label: 'الدفعات والتسليمات', icon: I(Package), module: 'batches' },
    { to: '/payments', label: 'السداد والقبض', icon: I(Wallet), module: 'payments' },
    { to: '/collection', label: 'متابعة التحصيل', icon: I(PhoneCall), module: 'collection' },
  ] },
  { group: 'المالية', items: [
    { to: '/cash', label: 'الصناديق والحسابات', icon: I(Landmark), module: 'cash' },
    { to: '/expenses', label: 'المصروفات', icon: I(Receipt), module: 'expenses' },
    { to: '/purchases', label: 'المشتريات', icon: I(ShoppingCart), module: 'purchases' },
    { to: '/suppliers', label: 'الموردون', icon: I(Truck), module: 'suppliers' },
  ] },
  { group: 'المخزون والأصول', items: [
    { to: '/inventory', label: 'المخزون', icon: I(Boxes), module: 'inventory' },
    { to: '/assets', label: 'الأصول الثابتة', icon: I(Building2), module: 'assets' },
  ] },
  { group: 'التقارير', items: [{ to: '/reports', label: 'التقارير', icon: I(BarChart3), module: 'reports' }] },
  { group: 'الإدارة', items: [
    { to: '/tasks', label: 'المهام', icon: I(ListTodo), show: (a) => a.profile?.kind !== 'portal' },
    { to: '/approvals', label: 'الاعتمادات', icon: I(CheckSquare), show: (a) => a.profile?.kind !== 'portal' },
    { to: '/archive', label: 'الأرشيف', icon: I(Archive), module: 'archive' },
    { to: '/team', label: 'الفريق والصلاحيات', icon: I(UserCog), show: (a) => a.profile?.kind === 'owner' },
    { to: '/audit', label: 'سجل التدقيق', icon: I(ScrollText), module: 'audit' },
    { to: '/settings', label: 'الإعدادات', icon: I(Settings), module: 'settings' },
  ] },
];

function visible(a: ReturnType<typeof useAuth>) {
  return NAV.map((g) => ({ ...g, items: g.items.filter((it) => (it.show ? it.show(a) : it.module ? a.can(it.module, 'view') : true)) })).filter((g) => g.items.length);
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const a = useAuth();
  const groups = visible(a);
  return (
    <div className="flex h-full flex-col bg-navy text-slate-200">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <img src="/brand/icon-192.png" alt="" className="h-10 w-10 rounded-lg bg-white object-contain p-0.5" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{a.settings.company.nameAr}</p>
          <p className="text-[11px] tracking-wider text-slate-400">DARK-CLOUD NETWORK</p>
        </div>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-label="القائمة الرئيسية">
        {groups.map((g) => (
          <div key={g.group}>
            <p className="mb-1 px-2 text-[11px] font-semibold text-slate-400">{g.group}</p>
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.to === '/'} onClick={onNavigate}
                className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-white/10 text-white shadow-[inset_-3px_0_0_var(--color-gold)]' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
                {it.icon}{it.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2 rounded-lg bg-white/5 p-2">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gold/90 text-sm font-bold text-navy">{a.profile?.displayName?.[0] ?? '؟'}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{a.profile?.displayName}</p>
            <p className="truncate text-[11px] text-slate-400">{a.profile?.kind === 'owner' ? 'المدير العام' : a.profile?.positions?.join(' · ') || 'عضو فريق'}</p>
          </div>
          <button onClick={() => void a.signOut()} className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="تسجيل الخروج" title="تسجيل الخروج"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}

function Notifications() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const { data } = useCollection<any>('notifications', [where('uid', '==', user!.uid), orderBy('at', 'desc'), limit(30)], user!.uid);
  const unread = data.filter((n) => !n.read);
  useEffect(() => { if (open && unread.length) void api('notifications.markRead', { ids: unread.map((n) => n.id) }).catch(() => {}); }, [open]); // eslint-disable-line
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-navy hover:bg-slate-100" aria-label={`الإشعارات (${unread.length} غير مقروء)`}>
        <Bell className="h-5 w-5" />
        {unread.length > 0 && <span className="absolute -top-0.5 -left-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">{unread.length}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-40 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-xl border border-line bg-white shadow-xl">
            <p className="border-b border-line px-4 py-2.5 text-sm font-bold">الإشعارات</p>
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {data.length === 0 && <li className="p-6 text-center text-sm text-muted">لا توجد إشعارات</li>}
              {data.map((n) => (
                <li key={n.id}>
                  <button className={cx('w-full px-4 py-3 text-right hover:bg-slate-50', !n.read && 'bg-brand-light/50')} onClick={() => { setOpen(false); if (n.link) nav(n.link); }}>
                    <p className="text-sm font-semibold text-navy">{n.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{n.body}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{tsDate(n.at)}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function GlobalSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const go = () => {
    const s = q.trim(); if (!s) return;
    if (/^(R-|CN-)/i.test(s)) nav(`/payments?q=${encodeURIComponent(s.toUpperCase())}`);
    else if (/^#?\d+$/.test(s)) nav(`/batches?q=${encodeURIComponent(s.replace('#', ''))}`);
    else if (/^(E-)/i.test(s)) nav(`/expenses?q=${encodeURIComponent(s.toUpperCase())}`);
    else if (/^(P-)/i.test(s)) nav(`/purchases?q=${encodeURIComponent(s.toUpperCase())}`);
    else nav(`/distributors?q=${encodeURIComponent(s)}`);
    setQ('');
  };
  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); go(); }} className="relative hidden w-72 md:block">
      <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث: موزع، #رقم دفعة، R-سند…" aria-label="بحث شامل"
        className="h-9 w-full rounded-lg border border-line bg-slate-50 pr-9 pl-3 text-sm focus:border-brand focus:bg-white focus:outline-none" />
    </form>
  );
}

const TITLES: Record<string, string> = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.to, i.label])));

export function Shell() {
  const a = useAuth();
  const loc = useLocation();
  const online = useOnline();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [loc.pathname]);
  const section = useMemo(() => '/' + (loc.pathname.split('/')[1] || ''), [loc.pathname]);
  const mobileNav = visible(a).flatMap((g) => g.items).filter((i) => ['/', '/distributors', '/batches', '/payments'].includes(i.to));
  return (
    <div className="min-h-dvh lg:pr-64">
      <aside className="no-print fixed inset-y-0 right-0 z-30 hidden w-64 lg:block"><Sidebar /></aside>
      {drawer && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-dark/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 right-0 w-[82%] max-w-72 shadow-2xl">
            <button onClick={() => setDrawer(false)} className="absolute left-2 top-3 z-10 rounded-lg p-1.5 text-white/80" aria-label="إغلاق القائمة"><X className="h-5 w-5" /></button>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white/95 px-3 backdrop-blur sm:px-5">
        <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-navy hover:bg-slate-100 lg:hidden" aria-label="فتح القائمة"><Menu className="h-5 w-5" /></button>
        <img src="/brand/icon-192.png" alt="" className="h-8 w-8 rounded-md lg:hidden" />
        <p className="truncate text-sm font-bold text-navy">{TITLES[section] ?? ''}</p>
        <div className="flex-1" />
        <GlobalSearch />
        <span className={cx('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-flex', online ? 'bg-ok/10 text-ok' : 'bg-warn/15 text-[#8a560f]')}
          title={online ? 'البيانات تُحدَّث لحظياً من الخادم' : 'لا يوجد اتصال — العرض من آخر نسخة محفوظة، والعمليات الجديدة متوقفة'}>
          {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{online ? 'متزامن' : 'غير متصل'}
        </span>
        <Notifications />
      </header>
      {!online && <div className="no-print bg-warn/15 px-4 py-2 text-center text-xs font-semibold text-[#7a4c0e]">أنت غير متصل بالإنترنت. البيانات المعروضة قد لا تكون محدثة، ولا يمكن حفظ عمليات جديدة حتى عودة الاتصال.</div>}
      <main className="mx-auto w-full max-w-[1440px] px-3 pb-24 pt-5 sm:px-5 lg:pb-10"><Outlet /></main>
      <nav className="no-print fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="تنقل سريع">
        {mobileNav.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', isActive ? 'text-brand' : 'text-muted')}>
            {i.icon}<span className="truncate">{i.label.split(' ')[0]}</span>
          </NavLink>
        ))}
        <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-muted"><MoreHorizontal className="h-[18px] w-[18px]" />المزيد</button>
      </nav>
    </div>
  );
}
