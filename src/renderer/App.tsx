import React, { useEffect, useMemo, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError, useApi, useAppEvents, useAppState } from './lib/api';
import { AppCtx, type AppStateCtx } from './lib/appState';
import { ToastProvider, useToast, LoadingState, Button, Input, Field, Icon } from './components/ui';
import type { AppState } from '@shared/contract';
import { Shell } from './components/Shell';
import { AuthPages } from './pages/Auth';
import { SetupWizard } from './pages/SetupWizard';
import { DashboardPage } from './pages/Dashboard';
import { PatientsPage, PatientProfilePage, PatientNewPage } from './pages/Patients';
import { VisitsPage, VisitDetailPage, DentalChartPage, TreatmentsPage } from './pages/Clinical';
import { PrescriptionsPage, PrescriptionEditorPage } from './pages/Prescriptions';
import { AppointmentsPage, QueuePage } from './pages/Scheduling';
import { InvoicesPage, InvoiceEditorPage, InvoiceDetailPage, PaymentsPage } from './pages/Billing';
import { InventoryPage, SuppliersPage } from './pages/Inventory';
import { AccountingPage, ReportsPage } from './pages/Accounting';
import { StaffPage, UsersPage, RolesPage, AuditPage } from './pages/Admin';
import { BackupPage } from './pages/Backup';
import { SettingsPage } from './pages/Settings';
import { AboutPage, NotificationsPage } from './pages/Misc';

export { useAppState, usePermissions } from './lib/appState';

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});


/* ----------------------------- locked overlay ----------------------------- */
function LockOverlay({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api('auth.unlock', { password });
      if (res.ok) {
        onUnlock();
      } else {
        setError('Incorrect password');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed');
    } finally {
      setBusy(false);
      void toast;
    }
  };
  return (
    <div className="lock-overlay">
      <form className="lock-card" onSubmit={submit}>
        <div className="auth-brand" style={{ justifyContent: 'center', marginBottom: 0 }}>
          <div className="brand-mark">
            <Icon name="lock" size={22} />
          </div>
        </div>
        <div>
          <h2>Screen locked</h2>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
            Dentiva Pro locked after inactivity. Enter your password to continue.
          </p>
        </div>
        <div style={{ width: '100%' }}>
          <Field label="Password" required error={error}>
            <Input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
            />
          </Field>
        </div>
        <Button type="submit" variant="primary" block loading={busy} icon="unlock">
          Unlock
        </Button>
      </form>
    </div>
  );
}

/* ------------------------------ phase router ------------------------------ */
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/patients" element={<PatientsPage />} />
      <Route path="/patients/new" element={<PatientNewPage />} />
      <Route path="/patients/:id" element={<PatientProfilePage />} />
      <Route path="/visits" element={<VisitsPage />} />
      <Route path="/visits/:id" element={<VisitDetailPage />} />
      <Route path="/chart/:patientId" element={<DentalChartPage />} />
      <Route path="/treatments" element={<TreatmentsPage />} />
      <Route path="/prescriptions" element={<PrescriptionsPage />} />
      <Route path="/prescriptions/new" element={<PrescriptionEditorPage />} />
      <Route path="/prescriptions/:id" element={<PrescriptionEditorPage />} />
      <Route path="/appointments" element={<AppointmentsPage />} />
      <Route path="/queue" element={<QueuePage />} />
      <Route path="/invoices" element={<InvoicesPage />} />
      <Route path="/invoices/new" element={<InvoiceEditorPage />} />
      <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
      <Route path="/invoices/:id/edit" element={<InvoiceEditorPage />} />
      <Route path="/payments" element={<PaymentsPage />} />
      <Route path="/inventory" element={<InventoryPage />} />
      <Route path="/suppliers" element={<SuppliersPage />} />
      <Route path="/accounting" element={<AccountingPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/staff" element={<StaffPage />} />
      <Route path="/users" element={<UsersPage />} />
      <Route path="/roles" element={<RolesPage />} />
      <Route path="/backup" element={<BackupPage />} />
      <Route path="/audit" element={<AuditPage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function PhaseGate() {
  const { state, refresh } = useAppState();
  const toast = useToast();

  useAppEvents((e) => {
    if (e.type === 'locked') void refresh();
    if (e.type === 'unlocked') void refresh();
    if (e.type === 'notification') {
      toast.push({
        kind: e.notification.severity === 'critical' ? 'error' : e.notification.severity === 'warning' ? 'warning' : 'info',
        title: e.notification.title,
        msg: e.notification.body,
      });
    }
    if (e.type === 'backup-completed') {
      toast.push({
        kind: e.ok ? 'success' : 'error',
        title: e.ok ? 'Backup completed' : 'Backup failed',
        msg: e.detail,
      });
      void refresh();
    }
    if (e.type === 'data-changed') void refresh();
  });

  if (state.phase === 'activate') return <AuthPages mode="activate" onDone={() => void refresh()} />;
  if (state.phase === 'setup') return <SetupWizard onDone={() => void refresh()} />;
  if (state.phase === 'login') return <AuthPages mode="login" onDone={() => void refresh()} />;

  return (
    <>
      <Shell>
        <AppRoutes />
      </Shell>
      {state.phase === 'locked' ? <LockOverlay onUnlock={() => void refresh()} /> : null}
    </>
  );
}

function Inner() {
  const { data, error, refetch } = useApi('app.state', undefined, { staleTime: 0, refetchInterval: false });
  const [override, setOverride] = useState<AppState | null>(null);
  const state = override ?? data;
  const refresh = async () => {
    setOverride(null);
    await refetch();
  };

  // allow immediate local updates (e.g. after unlock) — refetch in background
  useEffect(() => {
    if (data) setOverride(null);
  }, [data]);

  const ctx = useMemo<AppStateCtx | null>(
    () => (state ? { state, refresh } : null),
    [state],
  );

  if (error && !data) {
    return (
      <div className="auth-screen">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>Dentiva Pro could not start</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            {error instanceof ApiError ? error.message : 'Unexpected startup error'}
          </p>
          <Button variant="primary" icon="refresh" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
  if (!state || !ctx) {
    return (
      <div className="auth-screen">
        <LoadingState label="Starting Dentiva Pro…" />
      </div>
    );
  }
  return (
    <AppCtx.Provider value={ctx}>
      <PhaseGate />
    </AppCtx.Provider>
  );
}

export function AppProviders() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <HashRouter>
          <Inner />
        </HashRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
