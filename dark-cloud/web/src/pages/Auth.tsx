import { useState } from 'react';
import { signInWithPopup, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { where, orderBy } from 'firebase/firestore';
import { LogIn, ShieldAlert, LogOut } from 'lucide-react';
import { formatDate } from '@dc/shared';
import { auth, googleProvider, USE_EMULATORS } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { useApi, useCollection } from '../lib/hooks';
import { Button, Card, ErrorBox, Input, Kpi, Loading, Note, PageHeader, Stat, Field } from '../components/ui';
import { Money, BatchStatus } from './common';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_top,#16314f,#0B1726_70%)] p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-7 shadow-2xl">
        <img src="/brand/logo-light.png" alt="DARK-CLOUD NETWORK" className="mx-auto mb-4 h-40 object-contain" />
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devEmail, setDevEmail] = useState('');
  const go = async () => {
    setBusy(true); setErr(null);
    try { await signInWithPopup(auth, googleProvider); } catch (e: any) { if (e.code !== 'auth/popup-closed-by-user') setErr('تعذر تسجيل الدخول: ' + (e.code || e.message)); } finally { setBusy(false); }
  };
  return (
    <Frame>
      <h1 className="text-center text-lg font-bold text-navy">نظام الإدارة والمحاسبة والتوزيع</h1>
      <p className="mt-1 text-center text-sm text-muted">شبكة دارك كلاود اللاسلكية</p>
      <div className="mt-6 space-y-3">
        {err && <ErrorBox message={err} />}
        <Button variant="primary" className="w-full" loading={busy} icon={<LogIn className="h-4 w-4" />} onClick={go}>تسجيل الدخول بحساب Google</Button>
        <p className="text-center text-xs text-muted">لا يوجد تسجيل عام. الدخول متاح فقط للحسابات التي دعاها المدير العام.</p>
        {USE_EMULATORS && (
          <form className="mt-4 rounded-lg border border-dashed border-warn p-3" onSubmit={async (e) => { e.preventDefault(); const em = devEmail.trim().toLowerCase();
            await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: 'emu-' + em.replace(/[^a-z0-9]/g, ''), email: em, email_verified: true, name: em.split('@')[0] }))); }}>
            <p className="mb-2 text-xs font-bold text-warn">بيئة المحاكاة المحلية فقط — غير موجود في الإنتاج</p>
            <Field label="دخول تجريبي ببريد اختبار"><Input dir="ltr" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} placeholder="gm@example.test" /></Field>
            <Button type="submit" className="mt-2 w-full" size="sm">دخول تجريبي</Button>
          </form>
        )}
      </div>
    </Frame>
  );
}

export function UnauthorizedPage() {
  const { user, reason, signOut } = useAuth();
  return (
    <Frame>
      <div className="text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-bad" />
        <h1 className="mt-2 text-lg font-bold">الحساب غير مصرح</h1>
        <p className="mt-1 text-sm text-muted" dir="ltr">{user?.email}</p>
        <p className="mt-3 text-sm">{reason || 'لا توجد دعوة مفعلة لهذا البريد.'}</p>
        <p className="mt-2 text-xs text-muted">تم تسجيل المحاولة وإشعار المدير العام.</p>
        <Button className="mt-5" icon={<LogOut className="h-4 w-4" />} onClick={() => void signOut()}>تسجيل الخروج</Button>
      </div>
    </Frame>
  );
}

export function PortalPage() {
  const { profile, settings, signOut } = useAuth();
  const id = profile!.portalDistributorId!;
  const st = useApi<any>(settings.system.portalEnabled ? 'reports.distributorStatement' : null, { id }, id);
  const batches = useCollection<any>(settings.system.portalEnabled ? 'batches' : null, [where('distributorId', '==', id), orderBy('batchNo', 'desc')], id);
  return (
    <div className="min-h-dvh bg-page">
      <header className="flex items-center justify-between bg-navy px-4 py-3 text-white"><div className="flex items-center gap-2"><img src="/brand/icon-192.png" className="h-8 w-8 rounded bg-white" alt="" /><span className="font-bold">{settings.company.nameAr} — بوابة الموزع</span></div>
        <Button size="sm" onClick={() => void signOut()}>خروج</Button></header>
      <main className="mx-auto max-w-4xl p-4">
        {!settings.system.portalEnabled ? <Note tone="warn">بوابة الموزعين غير مفعلة حالياً.</Note> : st.loading ? <Loading /> : st.error ? <ErrorBox message={st.error} /> : st.data && <>
          <PageHeader title={st.data.distributor.name} subtitle={`كشف حسابك حتى ${formatDate(new Date().toISOString().slice(0, 10))} — للاطلاع فقط`} />
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Kpi label="الرصيد المستحق عليك" value={<Money v={st.data.closingMinor} />} tone="brand" />
            <Kpi label="العهدة المفتوحة (كروت لديك)" value={<Money v={st.data.distributor.bal?.custodyGross} />} tone="warn" />
            <Kpi label="إجمالي ما سددته" value={<Money v={st.data.totals.payments} />} tone="ok" />
          </div>
          <Card title="الحركات" pad={false}><table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-muted"><tr><th className="p-2 text-right">التاريخ</th><th className="p-2 text-right">البيان</th><th className="p-2 text-left">مدين</th><th className="p-2 text-left">دائن</th><th className="p-2 text-left">الرصيد</th></tr></thead>
            <tbody>{st.data.rows.map((r: any) => <tr key={r.id} className="border-t border-line"><td className="p-2">{formatDate(r.date)}</td><td className="p-2">{r.description}</td><td className="p-2 text-left">{r.debitMinor ? <Money v={r.debitMinor} /> : ''}</td><td className="p-2 text-left">{r.creditMinor ? <Money v={r.creditMinor} /> : ''}</td><td className="p-2 text-left"><Money v={r.balanceMinor} /></td></tr>)}</tbody></table></Card>
          <Card title="دفعاتي" className="mt-4">{batches.data.map((b) => <Stat key={b.id} label={`#${b.batchNo} · ${formatDate(b.deliveryDate)}`} value={<span className="inline-flex gap-2"><BatchStatus s={b.status} /><Money v={b.netMinor} /></span>} />)}</Card>
          <Button className="mt-4" onClick={() => print()}>طباعة الكشف</Button>
        </>}
      </main>
    </div>
  );
}
