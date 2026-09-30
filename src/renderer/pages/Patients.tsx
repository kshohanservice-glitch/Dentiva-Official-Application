import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useApi, useApiMutation, useAppState } from '../lib/api';
import {
  Badge,
  Button,
  ChipRow,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Input,
  LoadingState,
  Modal,
  PageHead,
  Pagination,
  SearchBox,
  Select,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from '../components/ui';
import { PrintPreviewModal } from '../components/PrintPreview';
import { ageFromDob, formatDate, formatDateTime, formatMoney, nowIso, todayIso } from '@shared/format';
import type {
  PatientInput,
  PatientListItem,
  PatientListQuery,
  PatientProfile,
  TimelineEntry,
} from '@shared/contract';

/* ================================ LIST ================================ */

const RANGE_OPTS = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'd7', label: 'Last 7 days' },
  { value: 'd30', label: 'Last 30 days' },
  { value: 'd90', label: 'Last 90 days' },
  { value: 'd365', label: 'Last year' },
];

export function PatientsPage() {
  const navigate = useNavigate();
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [range, setRange] = useState<'all' | 'today' | 'd7' | 'd30' | 'd90' | 'd365'>(searchParams.get('range') as never ?? 'all');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [sort, setSort] = useState<NonNullable<PatientListQuery['sort']>>('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [hasBalance, setHasBalance] = useState(false);

  const query: PatientListQuery = useMemo(
    () => ({ q: q || undefined, range, status, sort, page, pageSize, hasBalance: hasBalance || undefined }),
    [q, range, status, sort, page, pageSize, hasBalance],
  );
  const list = useApi('patients.list', query, { staleTime: 3000 });
  useEffect(() => setPage(1), [q, range, status, sort, hasBalance]);

  const cols: Column<PatientListItem>[] = [
    {
      key: 'code',
      header: 'Code',
      width: '96px',
      render: (p) => <span className="mono" style={{ fontWeight: 600 }}>{p.patientCode}</span>,
    },
    {
      key: 'name',
      header: 'Patient',
      render: (p) => (
        <div>
          <div className="cell-main">
            {p.fullName}
            {p.allergies ? (
              <span className="badge badge-danger" style={{ marginLeft: 8 }} title={`Allergies: ${p.allergies}`}>
                <Icon name="alert" size={10} /> ALLERGY
              </span>
            ) : null}
          </div>
          <div className="cell-sub">
            {p.address ? p.address.slice(0, 46) : '—'}
          </div>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', value: (p) => p.phone ?? '—' },
    {
      key: 'age',
      header: 'Age/Sex',
      render: (p) => `${p.age != null ? p.age : '—'} / ${p.gender ?? '—'}`,
    },
    { key: 'registered', header: 'Registered', sortable: true, value: (p) => formatDate(p.registeredAt) },
    {
      key: 'lastVisit',
      header: 'Last visit',
      sortable: true,
      value: (p) => (p.lastVisitAt ? formatDate(p.lastVisitAt) : '—'),
    },
    { key: 'visits', header: 'Visits', align: 'num', value: (p) => p.visitCount },
    {
      key: 'balance',
      header: 'Balance',
      align: 'num',
      render: (p) =>
        perms.includes('financial.view') ? (
          <span style={{ color: p.outstanding > 0 ? 'var(--c-danger)' : 'var(--c-ok)', fontWeight: 600 }}>
            {formatMoney(p.outstanding)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => <Badge tone={p.status === 'active' ? 'ok' : 'neutral'}>{p.status}</Badge>,
    },
  ];

  const sortBy = (key: string) => {
    if (key === 'registered') setSort(sort === 'newest' ? 'oldest' : 'newest');
    else if (key === 'lastVisit') setSort('last_visit');
    else if (key === 'name') setSort(sort === 'name_asc' ? 'name_desc' : 'name_asc');
  };

  return (
    <div className="page">
      <PageHead
        title="Patients"
        sub={list.data ? `${list.data.total} patient records` : 'Loading…'}
        actions={
          perms.includes('patient.create') ? (
            <Button variant="primary" icon="userPlus" onClick={() => navigate('/patients/new')}>
              New patient
            </Button>
          ) : null
        }
      />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search name, code, phone, address…" />
        <ChipRow options={RANGE_OPTS} value={range} onChange={(v) => setRange(v as typeof range)} />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
            { value: 'all', label: 'All statuses' },
          ]}
          style={{ width: 140 }}
        />
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          options={[
            { value: 'newest', label: 'Newest first' },
            { value: 'oldest', label: 'Oldest first' },
            { value: 'name_asc', label: 'Name A→Z' },
            { value: 'name_desc', label: 'Name Z→A' },
            { value: 'last_visit', label: 'Recent visit' },
          ]}
          style={{ width: 150 }}
        />
        <label className="checkbox-row" title="Only patients with outstanding balance">
          <input type="checkbox" checked={hasBalance} onChange={(e) => setHasBalance(e.target.checked)} />
          Has balance
        </label>
      </div>

      <DataTable
        columns={cols}
        rows={list.data?.items ?? []}
        rowKey={(p) => p.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(p) => navigate(`/patients/${p.id}`)}
        sort={sort === 'newest' || sort === 'oldest' ? { key: 'registered', dir: sort === 'newest' ? 'desc' : 'asc' } : undefined}
        onSort={sortBy}
        empty={{
          title: q ? `No patients match “${q}”` : 'No patients found',
          desc: q
            ? 'Try a different name, patient code or phone number.'
            : 'Register your first patient to begin recording visits, prescriptions and invoices.',
          icon: 'users',
          action:
            perms.includes('patient.create') && !q ? (
              <Button variant="primary" icon="userPlus" onClick={() => navigate('/patients/new')}>
                New patient
              </Button>
            ) : (
              <Button onClick={() => setQ('')}>Clear search</Button>
            ),
        }}
        footer={
          list.data ? (
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onPage={setPage}
              onPageSize={setPageSize}
            />
          ) : null
        }
      />
    </div>
  );
}

/* ================================ NEW / EDIT FORM ================================ */

const GENDERS = ['Male', 'Female', 'Other'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const SOURCES = ['Walk-in', 'Referral', 'Repeat patient', 'Advertisement', 'Online', 'Other'];

export function PatientForm({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial?: PatientInput & { id?: number };
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<PatientInput>(initial ?? { fullName: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupes, setDupes] = useState<PatientListItem[]>([]);
  const [dupeAck, setDupeAck] = useState(false);
  const save = useApiMutation(initial?.id ? 'patients.update' : 'patients.create', {
    onSuccess: (data) => {
      toast.push({ kind: 'success', title: initial?.id ? 'Patient updated' : 'Patient registered' });
      const id = initial?.id ?? (data as { id: number }).id;
      onSaved(id);
      onClose();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Could not save patient', msg: e.message }),
  });

  useEffect(() => {
    if (open) {
      setForm(initial ?? { fullName: '' });
      setErrors({});
      setDupes([]);
      setDupeAck(false);
    }
  }, [open, initial]);

  const set = (k: keyof PatientInput, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const checkDupes = async () => {
    if (!form.phone && (form.fullName ?? '').length < 3) return;
    try {
      const res = await api('patients.duplicateCheck', { phone: form.phone, name: form.fullName });
      const matches = res.matches.filter((m) => m.id !== initial?.id);
      setDupes(matches);
    } catch {
      setDupes([]);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.fullName || form.fullName.trim().length < 2) errs.fullName = 'Full name is required';
    if (form.phone && !/^[+]?[\d\s\-()]{6,20}$/.test(form.phone)) errs.phone = 'Invalid phone format';
    if (form.emergencyPhone && !/^[+]?[\d\s\-()]{6,20}$/.test(form.emergencyPhone))
      errs.emergencyPhone = 'Invalid phone format';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (dupes.length && !dupeAck) {
      toast.push({
        kind: 'warning',
        title: 'Possible duplicate found',
        msg: 'Review the matches — confirm with “Save anyway” if this is a different person.',
      });
      return;
    }
    save.mutate(form);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={initial?.id ? 'Edit patient' : 'New patient'}
      closeOnOverlay={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} icon="save" form="patient-form" type="submit">
            {initial?.id ? 'Save changes' : 'Register patient'}
          </Button>
        </>
      }
    >
      <form id="patient-form" onSubmit={submit} className="col" style={{ gap: 'var(--sp-4)' }}>
        <div className="form-grid">
          <Field label="Full name" required error={errors.fullName}>
            <Input
              value={form.fullName ?? ''}
              onChange={(e) => set('fullName', e.target.value)}
              onBlur={() => void checkDupes()}
              placeholder="Patient full name (English or Bangla)"
            />
          </Field>
          <Field label="Preferred name">
            <Input value={form.preferredName ?? ''} onChange={(e) => set('preferredName', e.target.value)} />
          </Field>
          <Field label="Date of birth" error={errors.dob} hint={form.dob ? `Age: ${ageFromDob(form.dob)} years` : 'Age auto-calculated'}>
            <Input type="date" value={form.dob ?? ''} onChange={(e) => set('dob', e.target.value || null)} />
          </Field>
          <Field label="Gender">
            <Select
              value={form.gender ?? ''}
              placeholder="Select…"
              onChange={(e) => set('gender', e.target.value || null)}
              options={GENDERS.map((g) => ({ value: g, label: g }))}
            />
          </Field>
          <Field label="Blood group">
            <Select
              value={form.bloodGroup ?? ''}
              placeholder="Select…"
              onChange={(e) => set('bloodGroup', e.target.value || null)}
              options={BLOOD.map((b) => ({ value: b, label: b }))}
            />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} onBlur={() => void checkDupes()} placeholder="+880 1XXX-XXXXXX" />
          </Field>
          <Field label="Emergency phone" error={errors.emergencyPhone}>
            <Input value={form.emergencyPhone ?? ''} onChange={(e) => set('emergencyPhone', e.target.value)} />
          </Field>
          <Field label="Email" error={errors.email}>
            <Input value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Occupation">
            <Input value={form.occupation ?? ''} onChange={(e) => set('occupation', e.target.value)} />
          </Field>
          <Field label="Patient source">
            <Select
              value={form.source ?? ''}
              placeholder="Select…"
              onChange={(e) => set('source', e.target.value || null)}
              options={SOURCES.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label="Address" className="span-2">
            <Textarea rows={2} value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          </Field>
        </div>

        <details open={!form.medicalHistory && !form.allergies ? undefined : true}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 10 }}>
            <Icon name="stethoscope" size={14} /> Clinical background (optional)
          </summary>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label="Chief complaint">
              <Input value={form.chiefComplaint ?? ''} onChange={(e) => set('chiefComplaint', e.target.value)} />
            </Field>
            <Field label="Previous problems">
              <Input value={form.previousProblems ?? ''} onChange={(e) => set('previousProblems', e.target.value)} />
            </Field>
            <Field label="Medical history" hint="Diabetes, hypertension, medications…">
              <Textarea rows={2} value={form.medicalHistory ?? ''} onChange={(e) => set('medicalHistory', e.target.value)} />
            </Field>
            <Field label="Dental history">
              <Textarea rows={2} value={form.dentalHistory ?? ''} onChange={(e) => set('dentalHistory', e.target.value)} />
            </Field>
            <Field label="Allergies">
              <Textarea rows={2} value={form.allergies ?? ''} onChange={(e) => set('allergies', e.target.value)} />
            </Field>
            <Field label="Current medication">
              <Textarea rows={2} value={form.currentMedication ?? ''} onChange={(e) => set('currentMedication', e.target.value)} />
            </Field>
            <Field label="Emergency notes">
              <Input value={form.emergencyNotes ?? ''} onChange={(e) => set('emergencyNotes', e.target.value)} />
            </Field>
            <Field label="Additional notes">
              <Input value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        </details>

        {dupes.length ? (
          <div className="alert alert-warn" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div className="row">
              <Icon name="alert" size={16} />
              <strong>Possible duplicate patients found — review before saving</strong>
            </div>
            {dupes.slice(0, 4).map((d) => (
              <div key={d.id} className="tiny">
                • {d.patientCode} · <strong>{d.fullName}</strong> · {d.phone ?? 'no phone'} · registered{' '}
                {formatDate(d.registeredAt)}
              </div>
            ))}
            <label className="checkbox-row">
              <input type="checkbox" checked={dupeAck} onChange={(e) => setDupeAck(e.target.checked)} />
              These are different people — save anyway
            </label>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

export function PatientNewPage() {
  const navigate = useNavigate();
  return (
    <div className="page">
      <PageHead
        title="Register new patient"
        sub="Create a complete patient record — you can add visits, prescriptions and invoices next"
        actions={
          <Button icon="arrowLeft" onClick={() => navigate('/patients')}>
            Back to list
          </Button>
        }
      />
      <PatientForm open onClose={() => navigate('/patients')} onSaved={(id) => navigate(`/patients/${id}`)} />
    </div>
  );
}

/* ================================ PROFILE ================================ */

export function PatientProfilePage({ patientId }: { patientId?: number } = {}) {
  const navigate = useNavigate();
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const toast = useToast();
  const routeParams = useParams();
  const paramsId = patientId ?? Number(routeParams.id ?? '0');
  const [tab, setTab] = useState('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [quickOpen, setQuickOpen] = useState<null | 'visit' | 'appt' | 'rx' | 'invoice' | 'payment' | 'note' | 'referral' | 'attachment'>(null);

  const profile = useApi('patients.get', { id: paramsId }, { enabled: paramsId > 0 });
  const timeline = useApi('patients.timeline', { id: paramsId }, { enabled: paramsId > 0 });
  const p = profile.data;

  if (profile.isLoading) return <LoadingState label="Loading patient…" />;
  if (profile.error || !p) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;

  const patient = p.patient;
  const quickActions = [
    { key: 'visit', label: 'New Visit', icon: 'clipboard', perm: 'clinical.create' },
    { key: 'appt', label: 'Appointment', icon: 'calendar', perm: 'appointment.create' },
    { key: 'rx', label: 'Prescription', icon: 'file', perm: 'prescription.create' },
    { key: 'invoice', label: 'Invoice', icon: 'receipt', perm: 'invoice.create' },
    { key: 'payment', label: 'Payment', icon: 'money', perm: 'payment.create' },
    { key: 'attachment', label: 'Attachment', icon: 'upload', perm: 'patient.edit' },
    { key: 'note', label: 'Note', icon: 'edit', perm: 'patient.edit' },
    { key: 'referral', label: 'Referral', icon: 'send', perm: 'referral.manage' },
  ].filter((a) => (perms as readonly string[]).includes(a.perm)) as { key: NonNullable<typeof quickOpen>; label: string; icon: string; perm: string }[];

  return (
    <div className="page">
      <PageHead
        title={
          <span className="row" style={{ gap: 10 }}>
            {patient.fullName}
            <Badge tone={patient.status === 'active' ? 'ok' : 'neutral'}>{patient.status}</Badge>
            {patient.allergies ? <Badge tone="danger">Allergies: {patient.allergies}</Badge> : null}
          </span>
        }
        sub={`${patient.patientCode} · ${patient.age != null ? patient.age + 'y' : '—'} / ${patient.gender ?? '—'}${
          patient.phone ? ' · ' + patient.phone : ''
        } · Registered ${formatDate(patient.registeredAt)}`}
        actions={
          <>
            <Button icon="arrowLeft" onClick={() => navigate('/patients')}>
              Back
            </Button>
            <Button icon="print" onClick={() => setPrintOpen(true)}>
              Print summary
            </Button>
            <Button icon="edit" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            {perms.includes('patient.delete') ? (
              <Button icon="trash" variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
            <Button variant="primary" icon="plus" onClick={() => setQuickOpen('visit')}>
              Quick actions
            </Button>
          </>
        }
      />

      <div className="stat-grid cols-4">
        <Stat2 label="Total visits" value={p.clinical.totalVisits} sub={p.clinical.lastVisitAt ? `Last: ${formatDate(p.clinical.lastVisitAt)}` : 'No visits yet'} />
        <Stat2
          label="Next appointment"
          value={p.clinical.nextAppointment ? formatDate(p.clinical.nextAppointment.startAt) : '—'}
          sub={p.clinical.nextAppointment ? new Date(p.clinical.nextAppointment.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'None scheduled'}
        />
        <Stat2 label="Prescriptions" value={p.clinical.totalPrescriptions} sub={`${p.clinical.activeTreatments} active treatments`} />
        {p.financial.permitted ? (
          <Stat2
            label="Outstanding"
            value={formatMoney(p.financial.outstanding)}
            tone={p.financial.outstanding > 0 ? 'danger' : 'ok'}
            sub={`Billed ${formatMoney(p.financial.totalBilled)} · Paid ${formatMoney(p.financial.totalPaid)}`}
          />
        ) : (
          <Stat2 label="Appointments" value={p.appointmentStats.upcoming} sub={`${p.appointmentStats.completed} completed`} />
        )}
      </div>

      <div className="toolbar" style={{ gap: 8 }}>
        {quickActions.map((a) => (
          <Button key={a.key} size="sm" icon={a.icon} onClick={() => setQuickOpen(a.key as typeof quickOpen)}>
            {a.label}
          </Button>
        ))}
        <span style={{ flex: 1 }} />
        <Button size="sm" icon="tooth" onClick={() => navigate(`/chart/${patient.id}`)}>
          Open dental chart
        </Button>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'timeline', label: 'Clinical timeline', count: timeline.data?.length ?? 0 },
          { key: 'attachments', label: 'Attachments', count: p.attachments.length },
          { key: 'referrals', label: 'Referrals', count: p.referrals.length },
          { key: 'notes', label: 'Notes', count: p.notes.length },
        ]}
      />

      {tab === 'overview' ? (
        <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card card-pad">
            <h3 style={{ marginBottom: 12 }}>Patient information</h3>
            <dl className="kv">
              <dt>Patient code</dt>
              <dd className="mono">{patient.patientCode}</dd>
              <dt>Full name</dt>
              <dd>{patient.fullName}</dd>
              <dt>Preferred name</dt>
              <dd>{patient.preferredName || '—'}</dd>
              <dt>Date of birth</dt>
              <dd>{patient.dob ? formatDate(patient.dob, 'long') : '—'}</dd>
              <dt>Age / Gender</dt>
              <dd>
                {patient.age != null ? patient.age : '—'} / {patient.gender ?? '—'}
              </dd>
              <dt>Blood group</dt>
              <dd>{patient.bloodGroup ?? '—'}</dd>
              <dt>Phone</dt>
              <dd>{patient.phone ?? '—'}</dd>
              <dt>Emergency</dt>
              <dd>{patient.emergencyPhone ?? '—'}</dd>
              <dt>Email</dt>
              <dd>{patient.email ?? '—'}</dd>
              <dt>Address</dt>
              <dd>{patient.address ?? '—'}</dd>
              <dt>Occupation</dt>
              <dd>{patient.occupation ?? '—'}</dd>
              <dt>Source</dt>
              <dd>{patient.source ?? '—'}</dd>
            </dl>
          </div>
          <div className="col">
            <div className="card card-pad">
              <h3 style={{ marginBottom: 12 }}>Clinical alerts</h3>
              <div className="col" style={{ gap: 8 }}>
                {p.alerts.allergies ? (
                  <div className="alert alert-danger">
                    <Icon name="alert" size={16} />
                    <div>
                      <strong>Allergies:</strong> {p.alerts.allergies}
                    </div>
                  </div>
                ) : null}
                {p.alerts.medicalHistory ? (
                  <div className="alert alert-warn">
                    <Icon name="stethoscope" size={16} />
                    <div>
                      <strong>Medical history:</strong> {p.alerts.medicalHistory}
                    </div>
                  </div>
                ) : null}
                {p.alerts.emergencyNotes ? (
                  <div className="alert alert-danger">
                    <Icon name="info" size={16} />
                    <div>
                      <strong>Emergency notes:</strong> {p.alerts.emergencyNotes}
                    </div>
                  </div>
                ) : null}
                {!p.alerts.allergies && !p.alerts.medicalHistory && !p.alerts.emergencyNotes ? (
                  <div className="alert alert-ok">
                    <Icon name="check" size={16} />
                    <div>No clinical alerts recorded.</div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="card card-pad">
              <h3 style={{ marginBottom: 12 }}>Background</h3>
              <dl className="kv">
                <dt>Chief complaint</dt>
                <dd>{patient.chiefComplaint || '—'}</dd>
                <dt>Medical history</dt>
                <dd>{patient.medicalHistory || '—'}</dd>
                <dt>Dental history</dt>
                <dd>{patient.dentalHistory || '—'}</dd>
                <dt>Current medication</dt>
                <dd>{patient.currentMedication || '—'}</dd>
                <dt>Notes</dt>
                <dd>{patient.notes || '—'}</dd>
              </dl>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'timeline' ? (
        <div className="card card-pad">
          {timeline.isLoading ? (
            <LoadingState />
          ) : !timeline.data?.length ? (
            <EmptyState
              title="No activity yet"
              desc="Visits, prescriptions, appointments, invoices and notes will appear here chronologically."
              icon="history"
            />
          ) : (
            <div className="timeline">
              {timeline.data.map((e) => (
                <TimelineRow key={e.id} entry={e} onOpen={() => e.route && navigate(e.route)} />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'attachments' ? (
        <AttachmentsPanel patientId={patient.id} items={p.attachments} canEdit={perms.includes('patient.edit')} onChanged={() => void profile.refetch()} />
      ) : null}
      {tab === 'referrals' ? (
        <div className="card card-pad">
          {p.referrals.length === 0 ? (
            <EmptyState title="No referrals" desc="Record referrals to other specialists from here." icon="send" />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Referred to</th>
                  <th>Specialty / Organization</th>
                  <th>Reason</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {p.referrals.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.referralDate)}</td>
                    <td>{r.referredTo || '—'}</td>
                    <td>{[r.specialty, r.organization].filter(Boolean).join(' · ') || '—'}</td>
                    <td>{r.reason || '—'}</td>
                    <td>
                      <Badge tone={r.status === 'closed' ? 'neutral' : r.status === 'followed_up' ? 'ok' : 'info'}>
                        {r.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
      {tab === 'notes' ? (
        <NotesPanel
          patientId={patient.id}
          notes={p.notes}
          canEdit={perms.includes('patient.edit')}
          onChanged={() => void profile.refetch()}
        />
      ) : null}

      <PatientForm open={editOpen} initial={patient as PatientInput} onClose={() => setEditOpen(false)} onSaved={() => void profile.refetch()} />
      <PrintPreviewModal
        open={printOpen}
        template="patientSummary"
        entityId={patient.id}
        title={`Patient summary — ${patient.fullName}`}
        onClose={() => setPrintOpen(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete patient"
        danger
        confirmLabel="Delete patient"
        requirePassword
        requirePhrase={patient.patientCode}
        message={
          <>
            This permanently removes <strong>{patient.fullName}</strong> if no financial history exists. If invoices or
            payments exist, the patient will be archived instead to protect clinical/financial integrity. Type the
            patient code to confirm. This action is audited.
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async ({ password, phrase }) => {
          try {
            const res = await api('patients.delete', { id: patient.id, password, confirmPhrase: phrase });
            toast.push({
              kind: 'success',
              title:
                res.reason === 'archived_financial_history'
                  ? 'Patient archived (financial history protected)'
                  : 'Patient deleted',
            });
            navigate('/patients');
          } catch (e) {
            toast.push({ kind: 'error', title: 'Delete failed', msg: e instanceof Error ? e.message : undefined });
          }
          setConfirmDelete(false);
        }}
      />
      <QuickActionModals
        kind={quickOpen}
        patientId={patient.id}
        onClose={() => setQuickOpen(null)}
        onDone={(route) => {
          setQuickOpen(null);
          if (route) navigate(route);
          void profile.refetch();
          void timeline.refetch();
        }}
      />
    </div>
  );
}

function Stat2({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'danger' | 'ok' }) {
  return (
    <div className={`stat ${tone ? 'tone-' + tone : 'tone-primary'}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 'var(--fs-2xl)' }}>
        {value}
      </div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

function TimelineRow({ entry, onOpen }: { entry: TimelineEntry; onOpen: () => void }) {
  const cls =
    entry.kind === 'invoice' || entry.kind === 'payment'
      ? 'tl-finance'
      : entry.kind === 'appointment'
        ? 'tl-appt'
        : entry.kind === 'attachment' || entry.kind === 'referral'
          ? 'tl-warn'
          : '';
  return (
    <div className={`tl-item ${cls}`}>
      <div className="tl-head">
        <span className="tl-title">{entry.title}</span>
        <span className="tl-time">{formatDateTime(entry.at)}</span>
        {entry.actor ? <span className="tl-time">· {entry.actor}</span> : null}
        {entry.route ? (
          <Button size="sm" variant="ghost" onClick={onOpen}>
            Open
          </Button>
        ) : null}
      </div>
      {entry.detail ? <div className="tl-detail">{entry.detail}</div> : null}
    </div>
  );
}

function AttachmentsPanel({
  patientId,
  items,
  canEdit,
  onChanged,
}: {
  patientId: number;
  items: PatientProfile['attachments'];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ id: number; filename: string; mime: string; dataBase64: string } | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      // chunked base64 to avoid call-stack issues on large files
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      await api('attachments.add', { patientId, filename: file.name, dataBase64: btoa(binary) });
      toast.push({ kind: 'success', title: 'Attachment uploaded', msg: file.name });
      onChanged();
    } catch (e) {
      toast.push({ kind: 'error', title: 'Upload failed', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3>Attachments</h3>
        {canEdit ? (
          <>
            <input
              ref={fileRef}
              type="file"
              style={{ display: 'none' }}
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
              }}
            />
            <Button size="sm" icon="upload" loading={busy} onClick={() => fileRef.current?.click()}>
              Add attachment
            </Button>
          </>
        ) : null}
      </div>
      <div className="card-body" style={{ paddingTop: 'var(--sp-3)' }}>
        {items.length === 0 ? (
          <EmptyState
            title="No attachments"
            desc="Upload PDFs, photos of reports, previous prescriptions or scans (max 25 MB each). Files are validated and stored safely outside the application data tables."
            icon="folder"
          />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td className="cell-main">{a.filename}</td>
                  <td>{a.mime}</td>
                  <td className="mono">{(a.size / 1024).toFixed(0)} KB</td>
                  <td>{formatDate(a.createdAt)}</td>
                  <td>{a.uploadedBy ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="eye"
                      onClick={async () => {
                        try {
                          const res = await api('attachments.read', { id: a.id });
                          setPreview({ ...res, id: a.id });
                        } catch (e) {
                          toast.push({ kind: 'error', title: 'Cannot open file', msg: e instanceof Error ? e.message : undefined });
                        }
                      }}
                    >
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="download"
                      onClick={async () => {
                        try {
                          await api('attachments.export', { id: a.id });
                        } catch (e) {
                          toast.push({ kind: 'error', title: 'Export failed', msg: e instanceof Error ? e.message : undefined });
                        }
                      }}
                    >
                      Save
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal open={Boolean(preview)} title={preview?.filename} onClose={() => setPreview(null)} size="lg">
        {preview ? (
          preview.mime === 'application/pdf' ? (
            <iframe
              title="preview"
              style={{ width: '100%', height: '65vh', border: 'none' }}
              src={`data:${preview.mime};base64,${preview.dataBase64}`}
            />
          ) : preview.mime.startsWith('image/') ? (
            <img
              alt={preview.filename}
              src={`data:${preview.mime};base64,${preview.dataBase64}`}
              style={{ maxWidth: '100%', maxHeight: '65vh', display: 'block', margin: '0 auto' }}
            />
          ) : (
            <div className="state-block">
              <p>Preview is not available for this file type. Use “Save” to export it.</p>
              <Button icon="download" onClick={() => void api('attachments.export', { id: preview.id })}>
                Save file
              </Button>
            </div>
          )
        ) : null}
      </Modal>
    </div>
  );
}

function NotesPanel({
  patientId,
  notes,
  canEdit,
  onChanged,
}: {
  patientId: number;
  notes: PatientProfile['notes'];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api('patients.addNote', { patientId, body });
      setBody('');
      toast.push({ kind: 'success', title: 'Note added' });
      onChanged();
    } catch (e) {
      toast.push({ kind: 'error', title: 'Could not add note', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="col">
      {canEdit ? (
        <div className="card card-pad">
          <Field label="Add clinical note">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Observations, instructions, follow-up…" />
          </Field>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <Button variant="primary" icon="save" loading={busy} onClick={() => void submit()}>
              Save note
            </Button>
          </div>
        </div>
      ) : null}
      <div className="card card-pad">
        {notes.length === 0 ? (
          <EmptyState title="No notes" desc="Clinical notes added to this patient appear here." icon="edit" />
        ) : (
          <div className="col" style={{ gap: 12 }}>
            {notes.map((n) => (
              <div key={n.id} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <div className="avatar">{(n.author ?? '?').slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div className="tiny muted">
                    {n.author ?? 'Unknown'} · {formatDateTime(n.createdAt)}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------- quick action modals ------------------------- */
function QuickActionModals({
  kind,
  patientId,
  onClose,
  onDone,
}: {
  kind: null | 'visit' | 'appt' | 'rx' | 'invoice' | 'payment' | 'note' | 'referral' | 'attachment';
  patientId: number;
  onClose: () => void;
  onDone: (route?: string) => void;
}) {
  const toast = useToast();
  const dentists = useApi('dentists.list', undefined, { enabled: kind === 'appt' });
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const field = (k: string) => form[k] ?? '';
  const setF = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      if (kind === 'visit') {
        await api('visits.create', {
          patientId,
          visitAt: nowIso(),
          chiefComplaint: field('chiefComplaint'),
          diagnosis: field('diagnosis'),
        });
        toast.push({ kind: 'success', title: 'Visit started' });
        onDone('/visits');
      } else if (kind === 'appt') {
        const dentistId = Number(field('dentistId'));
        const date = field('date') || todayIso();
        const time = field('time') || '10:00';
        await api('appointments.save', {
          patientId,
          dentistId,
          startAt: `${date}T${time}:00`,
          durationMin: Number(field('duration') || 30),
          reason: field('reason'),
        });
        toast.push({ kind: 'success', title: 'Appointment created' });
        onDone('/appointments');
      } else if (kind === 'rx') {
        const res = await api('prescriptions.create', {
          patientId,
          chiefComplaint: field('chiefComplaint'),
          items: [{ medicineName: field('medicine') || 'Medicine', frequency: field('frequency'), duration: field('duration') }],
        });
        onDone(`/prescriptions/${res.id}`);
      } else if (kind === 'invoice') {
        const res = await api('invoices.create', {
          patientId,
          items: [
            {
              description: field('description') || 'Treatment',
              qty: 1,
              unitPrice: Number(field('amount') || 0),
            },
          ],
        });
        onDone(`/invoices/${res.id}`);
      } else if (kind === 'payment') {
        await api('payments.create', {
          patientId,
          amount: Number(field('amount') || 0),
          methodCode: (field('method') || 'cash') as never,
        });
        toast.push({ kind: 'success', title: 'Payment recorded' });
        onDone(undefined);
      } else if (kind === 'note') {
        await api('patients.addNote', { patientId, body: field('body') });
        toast.push({ kind: 'success', title: 'Note added' });
        onDone(undefined);
      }
    } catch (e) {
      toast.push({ kind: 'error', title: 'Action failed', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  if (!kind) return null;

  const titles: Record<string, string> = {
    visit: 'New visit',
    appt: 'New appointment',
    rx: 'New prescription',
    invoice: 'New invoice',
    payment: 'Record payment',
    note: 'Add note',
    referral: 'Add referral',
    attachment: 'Add attachment',
  };

  return (
    <Modal
      open
      title={titles[kind]}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Create
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 'var(--sp-3)' }}>
        {kind === 'visit' ? (
          <>
            <Field label="Chief complaint">
              <Input value={field('chiefComplaint')} onChange={(e) => setF('chiefComplaint', e.target.value)} autoFocus />
            </Field>
            <Field label="Provisional diagnosis">
              <Input value={field('diagnosis')} onChange={(e) => setF('diagnosis', e.target.value)} />
            </Field>
          </>
        ) : null}
        {kind === 'appt' ? (
          <>
            <Field label="Dentist" required>
              <Select
                value={field('dentistId')}
                onChange={(e) => setF('dentistId', e.target.value)}
                placeholder="Select dentist…"
                options={(dentists.data ?? []).map((d) => ({ value: d.id, label: d.fullName }))}
              />
            </Field>
            <div className="form-grid">
              <Field label="Date" required>
                <Input type="date" value={field('date') || todayIso()} onChange={(e) => setF('date', e.target.value)} />
              </Field>
              <Field label="Time" required>
                <Input type="time" value={field('time') || '10:00'} onChange={(e) => setF('time', e.target.value)} />
              </Field>
              <Field label="Duration (min)">
                <Select
                  value={field('duration') || '30'}
                  onChange={(e) => setF('duration', e.target.value)}
                  options={[15, 30, 45, 60, 90].map((d) => ({ value: String(d), label: `${d} min` }))}
                />
              </Field>
              <Field label="Reason">
                <Input value={field('reason')} onChange={(e) => setF('reason', e.target.value)} />
              </Field>
            </div>
          </>
        ) : null}
        {kind === 'rx' ? (
          <>
            <Field label="Chief complaint (C/C)">
              <Input value={field('chiefComplaint')} onChange={(e) => setF('chiefComplaint', e.target.value)} autoFocus />
            </Field>
            <div className="form-grid">
              <Field label="Medicine" required>
                <Input value={field('medicine')} onChange={(e) => setF('medicine', e.target.value)} />
              </Field>
              <Field label="Frequency">
                <Input value={field('frequency')} onChange={(e) => setF('frequency', e.target.value)} placeholder="1-0-1" />
              </Field>
              <Field label="Duration">
                <Input value={field('duration')} onChange={(e) => setF('duration', e.target.value)} placeholder="5 days" />
              </Field>
            </div>
            <p className="tiny muted">You can add more medicines and clinical sections in the full editor.</p>
          </>
        ) : null}
        {kind === 'invoice' ? (
          <div className="form-grid">
            <Field label="Description" required>
              <Input value={field('description')} onChange={(e) => setF('description', e.target.value)} autoFocus />
            </Field>
            <Field label="Amount (৳)" required>
              <Input type="number" min={0} value={field('amount')} onChange={(e) => setF('amount', e.target.value)} />
            </Field>
          </div>
        ) : null}
        {kind === 'payment' ? (
          <div className="form-grid">
            <Field label="Amount (৳)" required>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={field('amount')}
                onChange={(e) => setF('amount', e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Method">
              <Select
                value={field('method') || 'cash'}
                onChange={(e) => setF('method', e.target.value)}
                options={[
                  { value: 'cash', label: 'Cash' },
                  { value: 'bkash', label: 'bKash' },
                  { value: 'nagad', label: 'Nagad' },
                  { value: 'rocket', label: 'Rocket' },
                  { value: 'upay', label: 'Upay' },
                  { value: 'bank', label: 'Bank' },
                  { value: 'card', label: 'Card' },
                  { value: 'other', label: 'Other' },
                ]}
              />
            </Field>
            <p className="tiny muted span-2">
              The payment is applied to this patient's open invoices (oldest first).
            </p>
          </div>
        ) : null}
        {kind === 'note' ? (
          <Field label="Note" required>
            <Textarea rows={4} value={field('body')} onChange={(e) => setF('body', e.target.value)} autoFocus />
          </Field>
        ) : null}
        {kind === 'referral' || kind === 'attachment' ? (
          <div className="alert alert-info">
            <Icon name="info" size={16} />
            <div>
              Use the <strong>{kind === 'referral' ? 'Referrals' : 'Attachments'}</strong> tab on this profile to add
              records with full fields.
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
