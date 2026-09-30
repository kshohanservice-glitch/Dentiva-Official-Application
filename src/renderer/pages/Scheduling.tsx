import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, useApi, useApiMutation, useAppState } from '../lib/api';
import {
  Badge,
  Button,
  ChipRow,
  DataTable,
  EmptyState,
  Field,
  Icon,
  Input,
  LoadingState,
  Modal,
  PageHead,
  Select,
  Textarea,
  useToast,
  type Column,
} from '../components/ui';
import { PrintPreviewModal } from '../components/PrintPreview';
import { PatientCombobox } from './Clinical';
import { formatDate, formatDateTime, todayIso } from '@shared/format';
import type { AppointmentDto, AppointmentStatus } from '@shared/contract';

const STATUS_OPTIONS: AppointmentStatus[] = [
  'Scheduled',
  'Confirmed',
  'Checked In',
  'In Progress',
  'Completed',
  'Cancelled',
  'No Show',
  'Rescheduled',
];

const STATUS_TONE: Record<AppointmentStatus, 'ok' | 'warn' | 'danger' | 'info' | 'neutral'> = {
  Scheduled: 'info',
  Confirmed: 'info',
  'Checked In': 'warn',
  'In Progress': 'warn',
  Completed: 'ok',
  Cancelled: 'danger',
  'No Show': 'danger',
  Rescheduled: 'neutral',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function AppointmentsPage() {
  const navigate = useNavigate();
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<'day' | 'week' | 'list'>('week');
  const [cursor, setCursor] = useState(() => new Date());
  const [status, setStatus] = useState<AppointmentStatus | 'all'>('all');
  const [dentistId, setDentistId] = useState('');
  const [editor, setEditor] = useState<AppointmentDto | 'new' | null>(searchParams.get('new') === '1' ? 'new' : null);
  const [printOpen, setPrintOpen] = useState(false);

  const dentists = useApi('dentists.list', undefined, { staleTime: 60_000 });

  const { from, to } = useMemo(() => {
    const d = new Date(cursor);
    if (view === 'day') {
      const k = dayKey(d);
      return { from: `${k}T00:00:00`, to: `${k}T23:59:59` };
    }
    if (view === 'week') {
      const start = new Date(d);
      start.setDate(d.getDate() - d.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { from: `${dayKey(start)}T00:00:00`, to: `${dayKey(end)}T23:59:59` };
    }
    const start = new Date(d);
    start.setMonth(d.getMonth() - 1);
    return { from: `${dayKey(start)}T00:00:00`, to: `${dayKey(new Date())}T23:59:59` };
  }, [view, cursor]);

  const list = useApi(
    'appointments.list',
    { from, to, dentistId: dentistId ? Number(dentistId) : undefined, status },
    { staleTime: 5000 },
  );

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setEditor('new');
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  const appointments = list.data ?? [];

  const dayColumns = useMemo(() => {
    const cols: { key: string; label: string; date: Date }[] = [];
    const start = new Date(cursor);
    if (view === 'week') start.setDate(start.getDate() - start.getDay());
    const n = view === 'day' ? 1 : 7;
    for (let i = 0; i < n; i++) {
      const d = new Date(start);
      if (view !== 'day') d.setDate(start.getDate() + i);
      cols.push({ key: dayKey(d), label: view === 'day' ? `${DAYS[d.getDay()]} ${d.getDate()}` : `${DAYS[d.getDay()]} ${d.getDate()}`, date: d });
    }
    return cols;
  }, [view, cursor]);

  const byDay = useMemo(() => {
    const m = new Map<string, AppointmentDto[]>();
    for (const a of appointments) {
      const k = a.startAt.slice(0, 10);
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((x, y) => x.startAt.localeCompare(y.startAt));
    return m;
  }, [appointments]);

  const moveCursor = (dir: -1 | 1) => {
    const d = new Date(cursor);
    if (view === 'day') d.setDate(d.getDate() + dir);
    else if (view === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setCursor(d);
  };

  const listCols: Column<AppointmentDto>[] = [
    {
      key: 'start',
      header: 'When',
      render: (a) => (
        <div>
          <div className="cell-main">{formatDateTime(a.startAt)}</div>
          <div className="cell-sub">{a.durationMin} min</div>
        </div>
      ),
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
    { key: 'reason', header: 'Reason', value: (a) => a.reason || a.treatmentName || '—' },
    { key: 'status', header: 'Status', render: (a) => <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge> },
    { key: 'actions', header: '', align: 'right', render: (a) => statusActions(a) },
  ];

  const statusActions = (a: AppointmentDto) => (
    <span onClick={(e) => e.stopPropagation()}>
      {perms.includes('appointment.edit') ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            icon="check"
            title="Mark completed"
            onClick={() => void api('appointments.setStatus', { id: a.id, status: 'Completed' }).then(() => list.refetch())}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="x"
            title="Cancel"
            onClick={() => void api('appointments.setStatus', { id: a.id, status: 'Cancelled' }).then(() => list.refetch())}
          />
        </>
      ) : null}
      <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditor(a)} />
      {perms.includes('appointment.delete') ? (
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          onClick={() =>
            void api('appointments.delete', { id: a.id }).then(() => {
              void list.refetch();
            })
          }
        />
      ) : null}
    </span>
  );

  return (
    <div className="page">
      <PageHead
        title="Appointments"
        sub={list.data ? `${appointments.length} in view` : 'Scheduling'}
        actions={
          <>
            <Button icon="print" onClick={() => setPrintOpen(true)}>
              Print summary
            </Button>
            {perms.includes('appointment.create') ? (
              <Button variant="primary" icon="plus" onClick={() => setEditor('new')}>
                New appointment
              </Button>
            ) : null}
          </>
        }
      />

      <div className="toolbar">
        <ChipRow
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: 'list', label: 'List' },
          ]}
          value={view}
          onChange={(v) => setView(v as typeof view)}
        />
        <Button size="sm" icon="arrowLeft" onClick={() => moveCursor(-1)}>
          Prev
        </Button>
        <Button size="sm" onClick={() => setCursor(new Date())}>
          Today
        </Button>
        <Button size="sm" icon="arrowRight" onClick={() => moveCursor(1)}>
          Next
        </Button>
        <span className="tiny muted" style={{ minWidth: 150, textAlign: 'center' }}>
          {formatDate(dayKey(cursor), 'long')}
        </span>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as AppointmentStatus | 'all')}
          style={{ width: 150 }}
          options={[{ value: 'all', label: 'Any status' }, ...STATUS_OPTIONS.map((s) => ({ value: s, label: s }))]}
        />
        <Select
          value={dentistId}
          onChange={(e) => setDentistId(e.target.value)}
          placeholder="Any dentist"
          style={{ width: 170 }}
          options={(dentists.data ?? []).map((d) => ({ value: d.id, label: d.fullName }))}
        />
      </div>

      {list.isLoading ? (
        <LoadingState label="Loading appointments…" />
      ) : view === 'list' ? (
        <DataTable
          columns={listCols}
          rows={appointments}
          rowKey={(a) => a.id}
          onRowClick={(a) => setEditor(a)}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={{
            title: 'No appointments',
            desc: 'Schedule appointments from here or the patient profile.',
            icon: 'calendar',
            action: perms.includes('appointment.create') ? (
              <Button variant="primary" icon="plus" onClick={() => setEditor('new')}>
                New appointment
              </Button>
            ) : undefined,
          }}
        />
      ) : (
        <div
          className="cal-grid"
          style={{ gridTemplateColumns: `repeat(${dayColumns.length}, minmax(0, 1fr))` }}
        >
          {dayColumns.map((col) => {
            const items = byDay.get(col.key) ?? [];
            const isToday = col.key === todayIso();
            return (
              <div key={col.key} className={`cal-col ${isToday ? 'cal-today' : ''}`}>
                <div className="cal-head">
                  <strong>{col.label}</strong>
                  <span className="tiny muted">{items.length}</span>
                </div>
                <div className="cal-body">
                  {items.length === 0 ? (
                    <div className="tiny muted" style={{ padding: 8, textAlign: 'center' }}>
                      —
                    </div>
                  ) : (
                    items.map((a) => (
                      <div key={a.id} className={`cal-event st-${a.status.toLowerCase().replace(/\s+/g, '-')}`} onClick={() => setEditor(a)}>
                        <div className="cal-time">
                          {new Date(a.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {a.durationMin}m
                        </div>
                        <div className="cal-patient">{a.patientName}</div>
                        <div className="cal-meta">
                          {a.dentistName} · <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                        </div>
                        <div className="row" style={{ gap: 2, marginTop: 4 }}>
                          {perms.includes('appointment.edit') ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                icon="check"
                                title="Complete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void api('appointments.setStatus', { id: a.id, status: 'Completed' }).then(() => list.refetch());
                                }}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                icon="x"
                                title="Cancel"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void api('appointments.setStatus', { id: a.id, status: 'Cancelled' }).then(() => list.refetch());
                                }}
                              />
                            </>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="user"
                            title="Patient"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/patients/${a.patientId}`);
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AppointmentEditor
        target={editor}
        onClose={() => {
          setEditor(null);
        }}
        onSaved={() => {
          setEditor(null);
          void list.refetch();
        }}
      />
      <PrintPreviewModal
        open={printOpen}
        template="appointmentSummary"
        entityId={0}
        title="Appointment summary"
        range={{ from: from.slice(0, 10), to: to.slice(0, 10) }}
        onClose={() => setPrintOpen(false)}
      />
    </div>
  );
}

function AppointmentEditor({
  target,
  onClose,
  onSaved,
}: {
  target: AppointmentDto | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    patientId: '',
    dentistId: '',
    date: todayIso(),
    time: '10:00',
    durationMin: '30',
    reason: '',
    notes: '',
    status: 'Scheduled' as AppointmentStatus,
    reminderMin: '30',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<{ id: number; patientName: string; dentistName: string; startAt: string; endAt: string } | null>(null);
  const dentists = useApi('dentists.list', undefined, { enabled: target != null, staleTime: 60_000 });
  // Clinic scheduling defaults are live settings (appointments.*):
  // default duration, work start (default time), slot interval (time-step).
  const apptSettings = useApi('settings.get', { group: 'appointments' }, { enabled: target != null, staleTime: 60_000 });
  const appt = (apptSettings.data?.appointments ?? {}) as Record<string, unknown>;
  const defaultDuration = Number(appt.defaultDurationMin ?? 30);
  const workStart = typeof appt.workStart === 'string' && /^\d{2}:\d{2}$/.test(appt.workStart) ? appt.workStart : '09:00';
  const slotMinutes = Number(appt.slotIntervalMin ?? 15);

  useEffect(() => {
    setConflict(null);
    setErrors({});
    if (target && target !== 'new') {
      setForm({
        patientId: String(target.patientId),
        dentistId: String(target.dentistId),
        date: target.startAt.slice(0, 10),
        time: new Date(target.startAt).toTimeString().slice(0, 5),
        durationMin: String(target.durationMin),
        reason: target.reason ?? '',
        notes: target.notes ?? '',
        status: target.status,
        reminderMin: target.reminderMin != null ? String(target.reminderMin) : '',
      });
    } else if (target === 'new') {
      setForm({
        patientId: '',
        dentistId: '',
        date: todayIso(),
        time: '10:00',
        durationMin: '30',
        reason: '',
        notes: '',
        status: 'Scheduled',
        reminderMin: '30',
      });
    }
  }, [target]);

  // New appointment defaults follow the clinic's scheduling settings (applied
  // only while the editor is in "new" mode, so existing values are never touched).
  useEffect(() => {
    if (target !== 'new') return;
    setForm((f) => ({ ...f, time: workStart, durationMin: String(defaultDuration) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apptSettings.data, target]);

  const save = useApiMutation('appointments.save', {
    onSuccess: (data) => {
      const res = data as { ok: boolean; conflict?: typeof conflict };
      if (res.ok) {
        toast.push({ kind: 'success', title: 'Appointment saved' });
        onSaved();
      }
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', msg: e.message }),
  });

  const submit = async (override?: boolean) => {
    const errs: Record<string, string> = {};
    if (!form.patientId) errs.patient = 'Select a patient';
    if (!form.dentistId) errs.dentist = 'Select a dentist';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const startAt = `${form.date}T${form.time}:00`;
    if (!override) {
      try {
        const conflicts = await api('appointments.conflicts', {
          dentistId: Number(form.dentistId),
          startAt,
          durationMin: Number(form.durationMin),
          ignoreId: target && target !== 'new' ? target.id : undefined,
        });
        if (conflicts.length) {
          setConflict(conflicts[0]);
          return;
        }
      } catch {
        /* conflict check is best effort; save still validates */
      }
    }
    save.mutate({
      id: target && target !== 'new' ? target.id : undefined,
      patientId: Number(form.patientId),
      dentistId: Number(form.dentistId),
      startAt,
      durationMin: Number(form.durationMin),
      reason: form.reason,
      notes: form.notes,
      status: form.status,
      reminderMin: form.reminderMin ? Number(form.reminderMin) : null,
    });
  };

  if (!target) return null;

  return (
    <Modal
      open
      title={target === 'new' ? 'New appointment' : 'Edit appointment'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={save.isPending} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 'var(--sp-3)' }}>
        {conflict ? (
          <div className="alert alert-warn" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div className="row">
              <Icon name="alert" size={16} />
              <strong>Time conflict</strong>
            </div>
            <div className="tiny">
              {conflict.dentistName} already has {conflict.patientName} from{' '}
              {new Date(conflict.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} to{' '}
              {new Date(conflict.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Button size="sm" onClick={() => setConflict(null)}>
                Pick another time
              </Button>
              <Button size="sm" variant="danger" onClick={() => void submit(true)}>
                Save anyway
              </Button>
            </div>
          </div>
        ) : null}
        <div className="form-grid">
          <Field label="Patient" required error={errors.patient} className="span-2">
            <PatientCombobox
              value={form.patientId}
              placeholder="Search patient…"
              onChange={(v) => setForm((f) => ({ ...f, patientId: v }))}
            />
          </Field>
          <Field label="Dentist" required error={errors.dentist}>
            <Select
              value={form.dentistId}
              placeholder="Select…"
              onChange={(e) => setForm((f) => ({ ...f, dentistId: e.target.value }))}
              options={(dentists.data ?? []).map((d) => ({ value: d.id, label: d.fullName }))}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as AppointmentStatus }))}
              options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </Field>
          <Field label="Time" required>
            {/* step follows the clinic's slot interval (ms) so the picker snaps to slots */}
            <Input
              type="time"
              step={slotMinutes * 60 * 1000}
              value={form.time}
              onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
            />
          </Field>
          <Field label="Duration (min)">
            <Select
              value={form.durationMin}
              onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))}
              options={[15, 20, 30, 45, 60, 90, 120].map((d) => ({ value: String(d), label: `${d} min` }))}
            />
          </Field>
          <Field label="Reminder (min before)">
            <Select
              value={form.reminderMin}
              onChange={(e) => setForm((f) => ({ ...f, reminderMin: e.target.value }))}
              options={[
                { value: '', label: 'None' },
                { value: '10', label: '10 min' },
                { value: '30', label: '30 min' },
                { value: '60', label: '60 min' },
              ]}
            />
          </Field>
          <Field label="Reason" className="span-2">
            <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Scaling follow-up" />
          </Field>
          <Field label="Notes" className="span-2">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ================================ QUEUE ================================ */

const QUEUE_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | 'neutral'> = {
  waiting: 'warn',
  called: 'info',
  in_consultation: 'info',
  completed: 'ok',
  skipped: 'danger',
  cancelled: 'neutral',
};

export function QueuePage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const [checkOpen, setCheckOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [nowStr, setNowStr] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  );

  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date());
      setNowStr(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const queue = useApi('queue.list', { date }, { refetchInterval: 15_000, staleTime: 5000 });
  const entries = queue.data ?? [];
  const waiting = entries.filter((e) => e.status === 'waiting');
  const inProgress = entries.filter((e) => e.status === 'called' || e.status === 'in_consultation');
  const done = entries.filter((e) => e.status === 'completed' || e.status === 'skipped' || e.status === 'cancelled');

  const setStatus = async (id: number, status: string) => {
    try {
      await api('queue.setStatus', { id, status: status as never });
      void queue.refetch();
    } catch (e) {
      toast.push({ kind: 'error', title: 'Queue update failed', msg: e instanceof Error ? e.message : undefined });
    }
  };

  const callNext = async () => {
    try {
      const res = await api('queue.callNext', {});
      if (res.entry) {
        toast.push({ kind: 'success', title: `Called token #${res.entry.number}`, msg: res.entry.patientName });
        void queue.refetch();
      } else {
        toast.push({ kind: 'info', title: 'No one waiting' });
      }
    } catch (e) {
      toast.push({ kind: 'error', title: 'Call failed', msg: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Queue"
        sub={`${entries.length} tokens · ${waiting.length} waiting`}
        actions={
          <>
            <span className="mono" style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--c-primary)' }}>
              {nowStr}
            </span>
            {perms.includes('queue.manage') ? (
              <>
                <Button icon="userPlus" onClick={() => setCheckOpen(true)}>
                  Check in patient
                </Button>
                <Button variant="primary" icon="megaphone" onClick={() => void callNext()}>
                  Call next
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <div className="toolbar">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
        <span className="tiny muted">
          now {now.getHours()}:{String(now.getMinutes()).padStart(2, '0')} · auto-refreshes every 15s
        </span>
      </div>

      {queue.isLoading ? (
        <LoadingState />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Queue is empty"
          desc="Check patients in as they arrive — tokens are assigned automatically and the board refreshes live."
          icon="list"
          action={
            perms.includes('queue.manage') ? (
              <Button variant="primary" icon="userPlus" onClick={() => setCheckOpen(true)}>
                Check in patient
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'start' }}>
          <QueueColumn title="Waiting" tone="warn" items={waiting} onStatus={setStatus} canManage={perms.includes('queue.manage')} />
          <QueueColumn title="In consultation" tone="info" items={inProgress} onStatus={setStatus} canManage={perms.includes('queue.manage')} />
          <QueueColumn title="Finished" tone="ok" items={done} onStatus={setStatus} canManage={false} />
        </div>
      )}

      <CheckInModal open={checkOpen} onClose={() => setCheckOpen(false)} onDone={() => { setCheckOpen(false); void queue.refetch(); }} />
    </div>
  );
}

function QueueColumn({
  title,
  tone,
  items,
  onStatus,
  canManage,
}: {
  title: string;
  tone: 'warn' | 'info' | 'ok';
  items: { id: number; number: number; patientName: string; patientCode: string; dentistName: string | null; status: string; checkedInAt: string; priority: number }[];
  onStatus: (id: number, status: string) => Promise<void>;
  canManage: boolean;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <h3>
          {title} <Badge tone={tone}>{items.length}</Badge>
        </h3>
      </div>
      <div className="card-body" style={{ paddingTop: 'var(--sp-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 ? (
          <p className="tiny muted" style={{ padding: 8 }}>
            Nothing here.
          </p>
        ) : (
          items.map((e) => (
            <div key={e.id} className="queue-card" style={{ borderLeft: e.priority > 0 ? '4px solid var(--c-danger)' : undefined }}>
              <div className="token-big">{e.number}</div>
              <div style={{ flex: 1 }}>
                <div className="cell-main">
                  {e.patientName}
                  {e.priority > 0 ? <span style={{ marginLeft: 6 }}><Badge tone="danger">priority</Badge></span> : null}
                </div>
                <div className="cell-sub">
                  {e.patientCode} · {e.dentistName ?? 'any dentist'} · in {new Date(e.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="row" style={{ gap: 4, marginTop: 4 }}>
                  <Badge tone={QUEUE_TONE[e.status] ?? 'neutral'}>{e.status.replace('_', ' ')}</Badge>
                  {canManage ? (
                    <>
                      {e.status === 'waiting' ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => void onStatus(e.id, 'called')}>
                            Call
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void onStatus(e.id, 'in_consultation')}>
                            Start
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void onStatus(e.id, 'skipped')}>
                            Skip
                          </Button>
                        </>
                      ) : null}
                      {e.status === 'called' || e.status === 'in_consultation' ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => void onStatus(e.id, 'completed')}>
                            Done
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void onStatus(e.id, 'cancelled')}>
                            Cancel
                          </Button>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CheckInModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [patientId, setPatientId] = useState('');
  const [dentistId, setDentistId] = useState('');
  const [appointmentId, setAppointmentId] = useState('');
  const [priority, setPriority] = useState(false);
  const dentists = useApi('dentists.list', undefined, { enabled: open, staleTime: 60_000 });
  const [saving, setSaving] = useState(false);

  const checkIn = async () => {
    if (!patientId) {
      toast.push({ kind: 'error', title: 'Select a patient' });
      return;
    }
    setSaving(true);
    try {
      const res = await api('queue.checkIn', {
        patientId: Number(patientId),
        dentistId: dentistId ? Number(dentistId) : null,
        appointmentId: appointmentId ? Number(appointmentId) : null,
        priority: priority ? 1 : 0,
      });
      toast.push({ kind: 'success', title: `Token #${res.number} issued` });
      setPatientId('');
      setAppointmentId('');
      setPriority(false);
      onDone();
    } catch (e) {
      toast.push({ kind: 'error', title: 'Check-in failed', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  return (
    <Modal
      open
      title="Check in patient"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="userPlus" loading={saving} onClick={() => void checkIn()}>
            Issue token
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Patient" required className="span-2">
          <PatientCombobox value={patientId} placeholder="Search patient…" onChange={setPatientId} />
        </Field>
        <Field label="Assign dentist">
          <Select
            value={dentistId}
            placeholder="Any dentist…"
            onChange={(e) => setDentistId(e.target.value)}
            options={(dentists.data ?? []).map((d) => ({ value: d.id, label: d.fullName }))}
          />
        </Field>
        <Field label="Appointment ID" hint="Optional — from today's schedule">
          <Input value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)} />
        </Field>
        <label className="checkbox-row span-2">
          <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} />
          Priority (emergency)
        </label>
      </div>
    </Modal>
  );
}
