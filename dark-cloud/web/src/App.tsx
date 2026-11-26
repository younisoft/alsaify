import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { Module } from '@dc/shared';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider, Loading, Empty } from './components/ui';
import { Shell } from './layout/Shell';
import { LoginPage, UnauthorizedPage, PortalPage } from './pages/Auth';

const L = <T extends Record<string, any>>(f: () => Promise<T>, k: keyof T) => lazy(() => f().then((m) => ({ default: m[k] })));
const Dashboard = L(() => import('./pages/Dashboard'), 'Dashboard');
const DistributorsPage = L(() => import('./pages/Distributors'), 'DistributorsPage');
const DistributorProfile = L(() => import('./pages/Distributors'), 'DistributorProfile');
const BatchesPage = L(() => import('./pages/Batches'), 'BatchesPage');
const BatchDetail = L(() => import('./pages/Batches'), 'BatchDetail');
const PaymentsPage = L(() => import('./pages/Payments'), 'PaymentsPage');
const PaymentDetail = L(() => import('./pages/Payments'), 'PaymentDetail');
const CollectionPage = L(() => import('./pages/Payments'), 'CollectionPage');
const CashPage = L(() => import('./pages/Finance'), 'CashPage');
const CashStatementPage = L(() => import('./pages/Finance'), 'CashStatementPage');
const ExpensesPage = L(() => import('./pages/Finance'), 'ExpensesPage');
const SuppliersPage = L(() => import('./pages/Finance'), 'SuppliersPage');
const SupplierProfile = L(() => import('./pages/Finance'), 'SupplierProfile');
const PurchasesPage = L(() => import('./pages/Finance'), 'PurchasesPage');
const PurchaseDetail = L(() => import('./pages/Finance'), 'PurchaseDetail');
const InventoryPage = L(() => import('./pages/Stock'), 'InventoryPage');
const AssetsPage = L(() => import('./pages/Stock'), 'AssetsPage');
const ReportsPage = L(() => import('./pages/Reports'), 'ReportsPage');
const TasksPage = L(() => import('./pages/Admin'), 'TasksPage');
const ApprovalsPage = L(() => import('./pages/Admin'), 'ApprovalsPage');
const ArchivePage = L(() => import('./pages/Admin'), 'ArchivePage');
const TeamPage = L(() => import('./pages/Admin'), 'TeamPage');
const AuditPage = L(() => import('./pages/Admin'), 'AuditPage');
const SettingsPage = L(() => import('./pages/Admin'), 'SettingsPage');
const PrintBatch = L(() => import('./pages/Print'), 'PrintBatch');
const PrintStatement = L(() => import('./pages/Print'), 'PrintStatement');
const PrintReceipt = L(() => import('./pages/Print'), 'PrintReceipt');

function Guard({ module, owner, children }: { module?: Module; owner?: boolean; children: React.ReactNode }) {
  const { can, profile } = useAuth();
  if ((owner && profile?.kind !== 'owner') || (module && !can(module, 'view'))) return <Empty title="ليست لديك صلاحية عرض هذه الصفحة" hint="يمكن للمدير العام منحك الصلاحية من صفحة الفريق." />;
  return <>{children}</>;
}

function Gate() {
  const { status, profile, can } = useAuth();
  if (status === 'loading') return <div className="grid min-h-dvh place-items-center"><Loading label="جارٍ التحقق من الحساب…" /></div>;
  if (status === 'signed-out') return <LoginPage />;
  if (status === 'unauthorized' || !profile) return <UnauthorizedPage />;
  if (profile.kind === 'portal') return <PortalPage />;
  const home = can('dashboard', 'view') ? <Guard module="dashboard"><Dashboard /></Guard> : <Navigate to="/tasks" replace />;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/print/batch/:id" element={<PrintBatch />} />
        <Route path="/print/statement/:id" element={<PrintStatement />} />
        <Route path="/print/receipt/:id" element={<PrintReceipt />} />
        <Route element={<Shell />}>
          <Route index element={home} />
          <Route path="distributors" element={<Guard module="distributors"><DistributorsPage /></Guard>} />
          <Route path="distributors/:id" element={<Guard module="distributors"><DistributorProfile /></Guard>} />
          <Route path="batches" element={<Guard module="batches"><BatchesPage /></Guard>} />
          <Route path="batches/:id" element={<Guard module="batches"><BatchDetail /></Guard>} />
          <Route path="payments" element={<Guard module="payments"><PaymentsPage /></Guard>} />
          <Route path="payments/:id" element={<Guard module="payments"><PaymentDetail /></Guard>} />
          <Route path="collection" element={<Guard module="collection"><CollectionPage /></Guard>} />
          <Route path="cash" element={<Guard module="cash"><CashPage /></Guard>} />
          <Route path="cash/:id" element={<Guard module="cash"><CashStatementPage /></Guard>} />
          <Route path="expenses" element={<Guard module="expenses"><ExpensesPage /></Guard>} />
          <Route path="suppliers" element={<Guard module="suppliers"><SuppliersPage /></Guard>} />
          <Route path="suppliers/:id" element={<Guard module="suppliers"><SupplierProfile /></Guard>} />
          <Route path="purchases" element={<Guard module="purchases"><PurchasesPage /></Guard>} />
          <Route path="purchases/:id" element={<Guard module="purchases"><PurchaseDetail /></Guard>} />
          <Route path="inventory" element={<Guard module="inventory"><InventoryPage /></Guard>} />
          <Route path="assets" element={<Guard module="assets"><AssetsPage /></Guard>} />
          <Route path="reports" element={<Guard module="reports"><ReportsPage /></Guard>} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="archive" element={<Guard module="archive"><ArchivePage /></Guard>} />
          <Route path="team" element={<Guard owner><TeamPage /></Guard>} />
          <Route path="audit" element={<Guard module="audit"><AuditPage /></Guard>} />
          <Route path="settings" element={<Guard module="settings"><SettingsPage /></Guard>} />
          <Route path="*" element={<Empty title="الصفحة غير موجودة" />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return <BrowserRouter><ToastProvider><AuthProvider><Gate /></AuthProvider></ToastProvider></BrowserRouter>;
}
