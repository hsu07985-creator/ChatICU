import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './lib/auth-context';
import { SidebarProvider } from './components/ui/sidebar';
import { AppSidebar } from './components/app-sidebar';
import { SidebarToggle } from './components/sidebar-toggle';
import { Toaster } from './components/ui/sonner';
import { ErrorBoundary } from './components/error-boundary';

// Eagerly loaded pages (small, critical path)
import { LoginPage } from './pages/login';
import { DashboardPage } from './pages/dashboard';
import { PatientsPage } from './pages/patients';

// Lazy loaded pages (large or infrequently accessed)
const PatientDetailPage = lazy(() => import('./pages/patient-detail').then(m => ({ default: m.PatientDetailPage })));
const ChatPage = lazy(() => import('./pages/chat').then(m => ({ default: m.ChatPage })));

// Pharmacy Pages (lazy)
const PharmacyWorkstationPage = lazy(() => import('./pages/pharmacy/workstation').then(m => ({ default: m.PharmacyWorkstationPage })));
const DrugInteractionsPage = lazy(() => import('./pages/pharmacy/interactions').then(m => ({ default: m.DrugInteractionsPage })));
const CompatibilityPage = lazy(() => import('./pages/pharmacy/compatibility').then(m => ({ default: m.CompatibilityPage })));
const DosagePage = lazy(() => import('./pages/pharmacy/dosage').then(m => ({ default: m.DosagePage })));
const PharmacyAdviceStatisticsPage = lazy(() => import('./pages/pharmacy/advice-statistics').then(m => ({ default: m.PharmacyAdviceStatisticsPage })));

// Admin Pages (lazy)
const AuditPage = lazy(() => import('./pages/admin/placeholder').then(m => ({ default: m.AuditPage })));
const VectorsPage = lazy(() => import('./pages/admin/vectors').then(m => ({ default: m.VectorsPage })));
const UsersPage = lazy(() => import('./pages/admin/users').then(m => ({ default: m.UsersPage })));
const AdminStatisticsPage = lazy(() => import('./pages/admin/statistics').then(m => ({ default: m.AdminStatisticsPage })));

// Loading 元件
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-[var(--color-brand)] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-muted-foreground">載入中...</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function PharmacyRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'pharmacist' && user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarToggle />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}

function AppRoutes() {
  const { isAuthenticated, loading } = useAuth();

  // 登入頁面也需要等待 loading 完成，避免閃爍
  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
    <Routes>
      {/* Public Routes */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />

      {/* Protected Routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <AppLayout>
              <DashboardPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/patients"
        element={
          <ProtectedRoute>
            <AppLayout>
              <PatientsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/patient/:id"
        element={
          <ProtectedRoute>
            <AppLayout>
              <PatientDetailPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <AppLayout>
              <ChatPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Admin Routes */}
      <Route
        path="/admin/audit"
        element={
          <AdminRoute>
            <AppLayout>
              <AuditPage />
            </AppLayout>
          </AdminRoute>
        }
      />
      <Route
        path="/admin/vectors"
        element={
          <AdminRoute>
            <AppLayout>
              <VectorsPage />
            </AppLayout>
          </AdminRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <AdminRoute>
            <AppLayout>
              <UsersPage />
            </AppLayout>
          </AdminRoute>
        }
      />
      <Route
        path="/admin/statistics"
        element={
          <AdminRoute>
            <AppLayout>
              <AdminStatisticsPage />
            </AppLayout>
          </AdminRoute>
        }
      />

      {/* Pharmacy Routes */}
      <Route
        path="/pharmacy/workstation"
        element={
          <PharmacyRoute>
            <AppLayout>
              <PharmacyWorkstationPage />
            </AppLayout>
          </PharmacyRoute>
        }
      />
      <Route
        path="/pharmacy/interactions"
        element={
          <PharmacyRoute>
            <AppLayout>
              <DrugInteractionsPage />
            </AppLayout>
          </PharmacyRoute>
        }
      />
      <Route
        path="/pharmacy/compatibility"
        element={
          <PharmacyRoute>
            <AppLayout>
              <CompatibilityPage />
            </AppLayout>
          </PharmacyRoute>
        }
      />
      <Route
        path="/pharmacy/dosage"
        element={
          <PharmacyRoute>
            <AppLayout>
              <DosagePage />
            </AppLayout>
          </PharmacyRoute>
        }
      />
      <Route
        path="/pharmacy/advice-statistics"
        element={
          <PharmacyRoute>
            <AppLayout>
              <PharmacyAdviceStatisticsPage />
            </AppLayout>
          </PharmacyRoute>
        }
      />

      {/* Redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <Toaster />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
