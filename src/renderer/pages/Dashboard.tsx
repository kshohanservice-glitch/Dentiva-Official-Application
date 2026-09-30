import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, useAppState, useApiMutation } from '../lib/api';
import {
  Badge,
  Button,
  ChipRow,
  DataTable,
  Icon,
  PageHead,
  Pagination,
  Select,
  Stat,
  EmptyState,
  useToast,
  type Column,
} from '../components/ui';
import { formatDate, formatMoney, todayIso, ageFromDob } from '@shared/format';
import type { AppointmentDto, PatientListItem } from '@shared/contract';

const DATE_RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'd7', label: '7 days' },
  { value: 'd30', label: '30 days' },
  { value: 'd90', label: '90 days' },
  { value: 'd365', label: '1 year' },
  { value: 'all', label: 'All' },
];

export function DashboardPage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const finOk = perms.includes('financial.view');
  const navigate = useNavigate();
  const toast = useToast();
  const [range, setRange] = useState('today');
  const dash = useApi('reports.dashboard', undefined, { refetchInterval: 60_000 });
  const d = dash.data;

  const todayStr = useMemo(() => formatDate(todayIso(), 'long'), []);
  void range;

  const quickActions = [
    { label: 'New Patient', icon: 'userPlus', perm: 'patient.create', to: '/patients/new' },
    { label: 'New Appointment', icon: 'calendar', perm: 'appointment.create', to: '/appointments?new=1' },
    { label: 'New Visit', icon: 'clipboard', perm: 'clinical.create', to: '/visits?new=1' },
    { label: 'New Prescription', icon: 'file', perm: 'prescription.create', to: '/prescriptions/new' },
    { label: 'New Invoice', icon: 'receipt', perm: 'invoice.create', to: '/invoices/new' },
    { label: 'Record Payment', icon: 'money', perm: 'payment.create', to: '/payments?new=1' },
  ].filter((a) => (perms as readonly string[]).includes(a.perm));

  const apptCols: Column<AppointmentDto>[] = [
    {
      key: 'time',
      header: 'Time',
      render: (a) => <span className="mono">{new Date(a.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>,
    },
    {
      key: 'patient',
      header: 'Patient',
      render: (a) => (
        <div>
          <div className="cell-main">{a.patientName}</div>
          <div className="cell-sub">{a.patientCode}</div>
        </div>
      ),
    },
    { key: 'dentist', header: 'Dentist', value: (a) => a.dentistName },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <StatusBadge status={a.status} />,
    },
  ];

  const patientCols: Column<PatientListItem>[] = [
    {
      key: 'name',
      header: 'Patient',
      render: (p) => (
        <div>
          <div className="cell-main">{p.fullName}</div>
          <div className="cell-sub">
            {p.patientCode}
            {p.phone ? ` · ${p.phone}` : ''}
          </div>
        </div>
      ),
    },
    { key: 'age', header: 'Age', align: 'num', render: (p) => (p.age != null ? `${p.age}` : '—') },
    { key: 'date', header: 'Registered', value: (p) => formatDate(p.registeredAt) },
  ];

  return (
    <div className="page">
      <PageHead
        title="Dashboard"
        sub={`${todayStr}${state.clinicName ? ` · ${state.clinicName}` : ''}`}
        actions={
          <Button
            icon="refresh"
            onClick={() => {
              void dash.refetch();
              toast.push({ kind: 'info', title: 'Dashboard refreshed' });
            }}
          >
            Refresh
          </Button>
        }
      />

      <div className="toolbar">
        <ChipRow options={DATE_RANGES} value={range} onChange={setRange} />
        <span style={{ flex: 1 }} />
        {quickActions.map((a) => (
          <Button key={a.label} icon={a.icon} onClick={() => navigate(a.to)}>
            {a.label}
          </Button>
        ))}
      </div>

      {dash.isLoading ? (
        <div className="card card-pad muted">Loading dashboard…</div>
      ) : dash.error ? (
        <div className="alert alert-danger">
          <Icon name="alert" size={16} />
          <div>Could not load dashboard data. {String(dash.error.message ?? '')}</div>
        </div>
      ) : d ? (
        <>
          <div className="stat-grid cols-4">
            <Stat
              label="Today's patients"
              value={d.todayPatients}
              icon="users"
              tone="primary"
              sub="New registrations today"
              onClick={() => navigate('/patients?range=today')}
            />
            <Stat
              label="Today's appointments"
              value={d.todayAppointments}
              icon="calendar"
              tone="info"
              sub={`${d.upcomingAppointments.length} upcoming`}
              onClick={() => navigate('/appointments')}
            />
            <Stat
              label="Waiting in queue"
              value={d.waitingQueue}
              icon="list"
              tone="warn"
              sub="Active queue now"
              onClick={() => perms.includes('queue.manage') && navigate('/queue')}
            />
            <Stat
              label="Completed visits"
              value={d.completedVisits}
              icon="check"
              tone="ok"
              sub="Visits recorded today"
              onClick={() => navigate('/visits')}
            />
          </div>

          {finOk && d.financial ? (
            <div className="stat-grid cols-4">
              <Stat
                label="Today's revenue"
                value={formatMoney(d.financial.todayRevenue)}
                icon="money"
                tone="ok"
                sub={`${d.financial.todayPayments} payments`}
                onClick={() => navigate('/payments')}
              />
              <Stat
                label="Outstanding balance"
                value={formatMoney(d.financial.outstanding)}
                icon="wallet"
                tone="danger"
                sub="Unpaid invoice balances"
                onClick={() => navigate('/invoices?status=unpaid')}
              />
              <Stat
                label="Low stock items"
                value={d.lowStockCount}
                icon="package"
                tone={d.lowStockCount > 0 ? 'warn' : 'ok'}
                sub="At or below minimum"
                onClick={() => navigate('/inventory?filter=low')}
              />
              <Stat
                label="Expiring inventory"
                value={d.expiringCount}
                icon="clock"
                tone={d.expiringCount > 0 ? 'warn' : 'ok'}
                sub="Within 30 days"
                onClick={() => navigate('/inventory?filter=expiring')}
              />
            </div>
          ) : (
            <div className="stat-grid cols-4">
              <Stat
                label="Low stock items"
                value={d.lowStockCount}
                icon="package"
                tone={d.lowStockCount > 0 ? 'warn' : 'ok'}
                sub="At or below minimum"
                onClick={() => navigate('/inventory?filter=low')}
              />
              <Stat
                label="Expiring inventory"
                value={d.expiringCount}
                icon="clock"
                tone={d.expiringCount > 0 ? 'warn' : 'ok'}
                sub="Within 30 days"
                onClick={() => navigate('/inventory?filter=expiring')}
              />
              <Stat
                label="Unread notifications"
                value={d.unreadNotifications}
                icon="bell"
                tone="info"
                sub="Actionable alerts"
                onClick={() => navigate('/notifications')}
              />
              <Stat label="Active clinic" value="✓" icon="shield" tone="ok" sub="System healthy" />
            </div>
          )}

          <div className="grid-2" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
            <div className="card">
              <div className="card-header">
                <h3>Upcoming appointments</h3>
                <Button size="sm" variant="ghost" onClick={() => navigate('/appointments')}>
                  View all
                </Button>
              </div>
              <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
                <DataTable
                  columns={apptCols}
                  rows={d.upcomingAppointments}
                  rowKey={(a) => a.id}
                  onRowClick={() => navigate('/appointments')}
                  loading={dash.isLoading}
                  empty={{
                    title: 'No upcoming appointments',
                    desc: 'Scheduled and confirmed appointments for today and later appear here.',
                    action: perms.includes('appointment.create') ? (
                      <Button icon="plus" onClick={() => navigate('/appointments?new=1')}>
                        New appointment
                      </Button>
                    ) : undefined,
                  }}
                />
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <h3>Recent patients</h3>
                <Button size="sm" variant="ghost" onClick={() => navigate('/patients')}>
                  View all
                </Button>
              </div>
              <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
                <DataTable
                  columns={patientCols}
                  rows={d.recentPatients}
                  rowKey={(p) => p.id}
                  onRowClick={(p) => navigate(`/patients/${p.id}`)}
                  loading={dash.isLoading}
                  empty={{
                    title: 'No patients yet',
                    desc: 'Create your first patient to get started.',
                    action: perms.includes('patient.create') ? (
                      <Button icon="userPlus" onClick={() => navigate('/patients/new')}>
                        New patient
                      </Button>
                    ) : undefined,
                  }}
                />
              </div>
            </div>
          </div>

          {finOk && d.financial && d.financial.recentPayments.length > 0 ? (
            <div className="card">
              <div className="card-header">
                <h3>Recent payments</h3>
                <Button size="sm" variant="ghost" onClick={() => navigate('/payments')}>
                  View all
                </Button>
              </div>
              <div className="card-body" style={{ paddingTop: 'var(--sp-3)' }}>
                <div className="stat-grid cols-6" style={{ gap: 'var(--sp-3)' }}>
                  {d.financial.recentPayments.map((p) => (
                    <div key={p.id} className="stat" style={{ padding: 'var(--sp-3)' }}>
                      <div className="stat-label" style={{ fontSize: 'var(--fs-xs)' }}>
                        {p.methodLabel} · {formatDate(p.paidAt.slice(0, 10))}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>{formatMoney(p.amount)}</div>
                      <div className="stat-sub">{p.patientName}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'Completed' || status === 'paid'
      ? 'ok'
      : status === 'Cancelled' || status === 'No Show' || status === 'void'
        ? 'danger'
        : status === 'In Progress' || status === 'Checked In' || status === 'partial'
          ? 'warn'
          : status === 'Confirmed'
            ? 'info'
            : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}

export { ageFromDob, EmptyState, Select, Pagination, useApiMutation };
