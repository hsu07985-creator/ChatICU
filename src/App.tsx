import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth-context';
import { SidebarProvider } from './components/ui/sidebar';
import { AppSidebar } from './components/app-sidebar';
import { SidebarToggle } from './components/sidebar-toggle';
import { Toaster } from './components/ui/sonner';
import { ErrorBoundary } from './components/error-boundary';

// Pages
import { LoginPage } from './pages/login';
import { DashboardPage } from './pages/dashboard';
import { PatientsPage } from './pages/patients';
import { PatientDetailPage } from './pages/patient-detail';
import { ChatPage } from './pages/chat';

// Pharmacy Pages
import { PharmacyWorkstationPage } from './pages/pharmacy/workstation';
import { DrugInteractionsPage } from './pages/pharmacy/interactions';
import { CompatibilityPage } from './pages/pharmacy/compatibility';
import { DosagePage } from './pages/pharmacy/dosage';
import { ErrorReportPage } from './pages/pharmacy/error-report';
import { PharmacyAdviceStatisticsPage } from './pages/pharmacy/advice-statistics';

// Admin Pages
import { AuditPage } from './pages/admin/placeholder';
import { VectorsPage } from './pages/admin/vectors';
import { UsersPage } from './pages/admin/users';
import { AdminStatisticsPage } from './pages/admin/statistics';

// Loading 元件
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-[#7f265b] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-[#6b7280]">載入中...</p>
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
        path="/pharmacy/error-report"
        element={
          <PharmacyRoute>
            <AppLayout>
              <ErrorReportPage />
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
