import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useApi, useApiMutation, useAppState } from '../lib/api';
import {
  Badge,
  Button,
  ChipRow,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
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
import { PatientForm } from './Patients';
import { formatDate, formatDateTime, nowIso } from '@shared/format';
import type {
  ChartConditionDto,
  DentalChartDto,
  PatientListItem,
  TreatmentDto,
  VisitDto,
} from '@shared/contract';

/* --------------------------- shared patient picker --------------------------- */

interface PatientSearchOption {
  id: number;
  label: string;
  subtitle?: string | null;
  phone?: string | null;
  lastVisit?: string | null;
}

export function PatientCombobox({
  value: _value,
  onChange,
  placeholder,
  disabled,
  error,
}: {
  value: string;
  onChange: (id: string, label?: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<PatientSearchOption[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const seqRef = React.useRef(0);

  useEffect(() => {
    if (disabled) return;
    const t = setTimeout(() => {
      const my = ++seqRef.current;
      if (term.trim().length < 2) {
        setOptions([]);
        return;
      }
      void api('patients.list', { q: term, pageSize: 8, status: 'active' })
        .then((page) => {
          if (my !== seqRef.current) return;
          setOptions(
            page.items.map((p: PatientListItem) => ({
              id: p.id,
              label: p.fullName,
              phone: p.phone,
              lastVisit: p.lastVisitAt,
              subtitle: p.patientCode,
            })),
          );
        })
        .catch(() => setOptions([]));
    }, 220);
    return () => clearTimeout(t);
  }, [term, disabled]);

  return (
    <div className="combobox">
      <Input
        value={term}
        disabled={disabled}
        invalid={error}
        placeholder={placeholder}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHighlight((h) => Math.min(h + 1, options.length - 1));
          else if (e.key === 'ArrowUp') setHighlight((h) => Math.max(h - 1, 0));
          else if (e.key === 'Enter' && open && options[highlight]) {
            onChange(String(options[highlight].id), options[highlight].label);
            setTerm(options[highlight].label);
            setOpen(false);
            e.preventDefault();
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && options.length > 0 ? (
        <div className="combobox-menu" role="listbox">
          {options.map((o, i) => (
            <div
              key={o.id}
              className={`combobox-item ${i === highlight ? 'active' : ''}`}
              onMouseDown={() => {
                onChange(String(o.id), o.label);
                setTerm(o.label);
                setOpen(false);
              }}
            >
              <div className="cell-main">{o.label}</div>
              <div className="cell-sub">
                {o.subtitle}
                {o.phone ? ` · ${o.phone}` : ''}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {open && term.trim().length >= 2 && options.length === 0 ? (
        <div className="combobox-menu">
          <div className="combobox-item muted">No patients found — register one first</div>
        </div>
      ) : null}
    </div>
  );
}

/* ================================ VISITS ================================ */

export function VisitsPage() {
  const navigate = useNavigate();
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const [searchParams, setSearchParams] = useSearchParams();
  const editorOpen = searchParams.get('new') === '1';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all');
  const [dentist, setDentist] = useState('');
  const [range, setRange] = useState<'all' | 'today' | 'd7' | 'd30' | 'd365'>('d30');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const dentists = useApi('dentists.list', undefined, { staleTime: 60_000 });
  const query = useMemo(
    () => ({
      q: q || undefined,
      status: status === 'all' ? undefined : status,
      dentistId: dentist ? Number(dentist) : undefined,
      range,
      page,
      pageSize,
    }),
    [q, status, dentist, range, page, pageSize],
  );
  const list = useApi('visits.list', query, { staleTime: 2000 });
  useEffect(() => setPage(1), [q, status, dentist, range]);

  const cols: Column<VisitDto>[] = [
    { key: 'date', header: 'Date', sortable: true, render: (v) => <strong>{formatDateTime(v.visitAt)}</strong> },
    {
      key: 'patient',
      header: 'Patient',
      render: (v) => (
        <div>
          <div className="cell-main">{v.patientName}</div>
          <div className="cell-sub">{v.patientCode}</div>
        </div>
      ),
    },
    { key: 'dentist', header: 'Dentist', value: (v) => v.dentistName ?? '—' },
    { key: 'complaint', header: 'Chief complaint', value: (v) => v.chiefComplaint || '—' },
    { key: 'diagnosis', header: 'Diagnosis', value: (v) => v.diagnosis || '—' },
    {
      key: 'status',
      header: 'Status',
      render: (v) => <Badge tone={v.status === 'closed' ? 'ok' : 'info'}>{v.status}</Badge>,
    },
    { key: 'counts', header: 'Rx / Tx', align: 'num', render: (v) => `${v.prescriptionCount} / ${v.treatmentCount}` },
  ];

  return (
    <div className="page">
      <PageHead
        title="Visits"
        sub={list.data ? `${list.data.total} clinical encounters` : 'Clinical encounters'}
        actions={
          perms.includes('clinical.create') ? (
            <Button variant="primary" icon="plus" onClick={() => setSearchParams({ new: '1' })}>
              New visit
            </Button>
          ) : null
        }
      />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search patient, complaint, diagnosis…" />
        <ChipRow
          options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
          ]}
          value={status}
          onChange={(v) => setStatus(v as typeof status)}
        />
        <ChipRow
          options={[
            { value: 'today', label: 'Today' },
            { value: 'd7', label: '7 days' },
            { value: 'd30', label: '30 days' },
            { value: 'd365', label: 'Year' },
            { value: 'all', label: 'All' },
          ]}
          value={range}
          onChange={(v) => setRange(v as typeof range)}
        />
        <Select
          value={dentist}
          onChange={(e) => setDentist(e.target.value)}
          placeholder="Any dentist"
          style={{ width: 170 }}
          options={(dentists.data ?? []).map((d) => ({ value: d.id, label: d.fullName }))}
        />
      </div>

      <DataTable
        columns={cols}
        rows={list.data?.items ?? []}
        rowKey={(v) => v.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(v) => navigate(`/visits/${v.id}`)}
        empty={{
          title: q ? `No visits match “${q}”` : 'No visits found',
          desc: 'Clinical visits appear here — start one from a patient profile or the New visit button.',
          icon: 'clipboard',
          action: perms.includes('clinical.create') ? (
            <Button variant="primary" icon="plus" onClick={() => setSearchParams({ new: '1' })}>
              New visit
            </Button>
          ) : undefined,
        }}
        footer={
          list.data ? (
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} />
          ) : null
        }
      />

      <VisitEditor open={editorOpen} onClose={() => setSearchParams({})} onSaved={(id) => { setSearchParams({}); navigate(`/visits/${id}`); }} />
    </div>
  );
}

export function VisitEditor({
  open,
  onClose,
  onSaved,
  patientId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
  patientId?: number;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    patient: patientId ? String(patientId) : '',
    visitAt: nowIso(),
    dentist: '',
    complaint: '',
    history: '',
    exam: '',
    findings: '',
    diagnosis: '',
    treatmentNotes: '',
    advice: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dentists = useApi('dentists.list', undefined, { enabled: open, staleTime: 60_000 });

  useEffect(() => {
    if (open) {
      setForm({
        patient: patientId ? String(patientId) : '',
        visitAt: nowIso(),
        dentist: '',
        complaint: '',
        history: '',
        exam: '',
        findings: '',
        diagnosis: '',
        treatmentNotes: '',
        advice: '',
        notes: '',
      });
      setErrors({});
    }
  }, [open, patientId]);

  const save = useApiMutation('visits.create', {
    onSuccess: (data) => {
      toast.push({ kind: 'success', title: 'Visit recorded' });
      onSaved((data as { id: number }).id);
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Could not save visit', msg: e.message }),
  });

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!form.patient) errs.patient = 'Select a patient';
    if (!form.dentist) errs.dentist = 'Select the treating dentist';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      patientId: Number(form.patient),
      dentistId: Number(form.dentist),
      visitAt: form.visitAt,
      chiefComplaint: form.complaint,
      history: form.history,
      examination: form.exam,
      findings: form.findings,
      diagnosis: form.diagnosis,
      treatmentNotes: form.treatmentNotes,
      advice: form.advice,
      notes: form.notes,
      status: 'open',
    });
  };

  return (
    <Modal
      open={open}
      title="New visit"
      onClose={onClose}
      size="lg"
      closeOnOverlay={false}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={save.isPending} onClick={submit}>
            Save visit
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 'var(--sp-4)' }}>
        <div className="form-grid">
          <Field label="Patient" required error={errors.patient}>
            <PatientCombobox
              value={form.patient}
              disabled={Boolean(patientId)}
              placeholder={patientId ? 'Selected patient' : 'Search name or phone…'}
              onChange={(v) => setForm((f) => ({ ...f, patient: v }))}
            />
          </Field>
          <Field label="Dentist" required error={errors.dentist}>
            <Select
              value={form.dentist}
              onChange={(e) => setForm((f) => ({ ...f, dentist: e.target.value }))}
              placeholder="Select…"
              options={(dentists.data ?? []).map((d) => ({ value: d.id, label: d.fullName }))}
            />
          </Field>
          <Field label="Date & time" className="span-2">
            <Input
              type="datetime-local"
              value={form.visitAt.slice(0, 16)}
              onChange={(e) => setForm((f) => ({ ...f, visitAt: e.target.value }))}
            />
          </Field>
          <Field label="Chief complaint (C/C)" className="span-2">
            <Input value={form.complaint} onChange={(e) => setForm((f) => ({ ...f, complaint: e.target.value }))} />
          </Field>
          <Field label="History">
            <Textarea rows={2} value={form.history} onChange={(e) => setForm((f) => ({ ...f, history: e.target.value }))} />
          </Field>
          <Field label="Examination">
            <Textarea rows={2} value={form.exam} onChange={(e) => setForm((f) => ({ ...f, exam: e.target.value }))} />
          </Field>
          <Field label="Findings">
            <Textarea rows={2} value={form.findings} onChange={(e) => setForm((f) => ({ ...f, findings: e.target.value }))} />
          </Field>
          <Field label="Diagnosis">
            <Textarea rows={2} value={form.diagnosis} onChange={(e) => setForm((f) => ({ ...f, diagnosis: e.target.value }))} />
          </Field>
          <Field label="Treatment notes">
            <Textarea rows={2} value={form.treatmentNotes} onChange={(e) => setForm((f) => ({ ...f, treatmentNotes: e.target.value }))} />
          </Field>
          <Field label="Advice">
            <Textarea rows={2} value={form.advice} onChange={(e) => setForm((f) => ({ ...f, advice: e.target.value }))} />
          </Field>
          <Field label="General notes" className="span-2">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function VisitDetailPage({ visitId }: { visitId?: number } = {}) {
  const params = useParams();
  const id = visitId ?? Number(params.id ?? '0');
  const navigate = useNavigate();
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const visit = useApi('visits.get', { id }, { enabled: id > 0 });
  const v = visit.data;

  const records = useApi('treatmentRecords.list', { patientId: v?.patientId ?? 0 }, { enabled: Boolean(v?.patientId) });
  const rxs = useApi('prescriptions.list', { patientId: v?.patientId ?? 0, pageSize: 200 }, { enabled: Boolean(v?.patientId) });
  const [form, setForm] = useState<Record<string, string>>({});

  const visitRecords = useMemo(
    () => (records.data ?? []).filter((r) => r.visitId === id),
    [records.data, id],
  );
  const visitRxs = useMemo(() => (rxs.data?.items ?? []).filter((r) => r.visitId === id), [rxs.data, id]);

  if (visit.isLoading) return <LoadingState label="Loading visit…" />;
  if (visit.error || !v) return <ErrorState error={visit.error} onRetry={() => void visit.refetch()} />;

  const saveEdit = async () => {
    try {
      await api('visits.update', {
        id,
        patientId: v.patientId,
        chiefComplaint: form.complaint ?? v.chiefComplaint ?? '',
        history: form.history ?? v.history ?? '',
        examination: form.exam ?? v.examination ?? '',
        findings: form.findings ?? v.findings ?? '',
        diagnosis: form.diagnosis ?? v.diagnosis ?? '',
        treatmentNotes: form.treatmentNotes ?? v.treatmentNotes ?? '',
        advice: form.advice ?? v.advice ?? '',
        notes: form.notes ?? v.notes ?? '',
      });
      toast.push({ kind: 'success', title: 'Visit updated' });
      setEditing(false);
      void visit.refetch();
    } catch (e) {
      toast.push({ kind: 'error', title: 'Update failed', msg: e instanceof Error ? e.message : undefined });
    }
  };

  const setStatus = async (status: 'open' | 'closed') => {
    try {
      await api('visits.update', { id, patientId: v.patientId, status });
      toast.push({ kind: 'success', title: status === 'closed' ? 'Visit closed' : 'Visit reopened' });
      void visit.refetch();
    } catch (e) {
      toast.push({ kind: 'error', title: 'Status change failed', msg: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="page">
      <PageHead
        title={`Visit · ${v.patientName}`}
        sub={`${formatDateTime(v.visitAt)} · ${v.dentistName ?? 'No dentist'} · Visit #${v.visitNo}`}
        actions={
          <>
            <Button icon="arrowLeft" onClick={() => navigate('/visits')}>
              Back
            </Button>
            <Button icon="user" onClick={() => navigate(`/patients/${v.patientId}`)}>
              Patient
            </Button>
            <Button icon="tooth" onClick={() => navigate(`/chart/${v.patientId}`)}>
              Dental chart
            </Button>
            {perms.includes('clinical.edit') ? (
              <Button icon="edit" onClick={() => setEditing(true)}>
                Edit clinical
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid-2" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
        <div className="card card-pad">
          <div className="row" style={{ marginBottom: 14 }}>
            <Badge tone={v.status === 'closed' ? 'ok' : 'info'}>{v.status}</Badge>
            <span className="tiny muted">
              {v.treatmentCount} treatment records · {v.prescriptionCount} prescriptions
            </span>
            <span style={{ flex: 1 }} />
            {perms.includes('clinical.edit') ? (
              <Select
                value={v.status}
                onChange={(e) => void setStatus(e.target.value as 'open' | 'closed')}
                options={[
                  { value: 'open', label: 'Open' },
                  { value: 'closed', label: 'Closed' },
                ]}
                style={{ width: 140 }}
              />
            ) : null}
          </div>
          <dl className="kv">
            <dt>Chief complaint</dt>
            <dd>{v.chiefComplaint || '—'}</dd>
            <dt>History</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{v.history || '—'}</dd>
            <dt>Examination</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{v.examination || '—'}</dd>
            <dt>Findings</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{v.findings || '—'}</dd>
            <dt>Diagnosis</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{v.diagnosis || '—'}</dd>
            <dt>Treatment notes</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{v.treatmentNotes || '—'}</dd>
            <dt>Advice</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{v.advice || '—'}</dd>
            <dt>Notes</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{v.notes || '—'}</dd>
          </dl>
        </div>
        <div className="col">
          <div className="card">
            <div className="card-header">
              <h3>Treatments this visit</h3>
              <span className="tiny muted">{visitRecords.length}</span>
            </div>
            <div className="card-body" style={{ paddingTop: 0 }}>
              {visitRecords.length === 0 ? (
                <p className="tiny muted">No treatment records linked to this visit.</p>
              ) : (
                visitRecords.map((r) => (
                  <div key={r.id} className="row" style={{ justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid var(--c-border-2)' }}>
                    <div>
                      <div className="cell-main">{r.treatmentName}</div>
                      <div className="cell-sub">
                        {r.toothIds.length ? `Teeth ${r.toothIds.join(', ')} · ` : ''}৳ {r.fee.toFixed(2)} · {r.status}
                        {r.invoiced ? ' · invoiced' : ''}
                      </div>
                    </div>
                    {perms.includes('clinical.edit') ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        onClick={() => void api('treatmentRecords.delete', { id: r.id }).then(() => records.refetch())}
                      />
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <h3>Prescriptions this visit</h3>
              <span className="tiny muted">{visitRxs.length}</span>
            </div>
            <div className="card-body" style={{ paddingTop: 0 }}>
              {visitRxs.length === 0 ? (
                <p className="tiny muted">No prescriptions linked to this visit.</p>
              ) : (
                visitRxs.map((rx) => (
                  <div key={rx.id} className="row" style={{ justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid var(--c-border-2)' }}>
                    <span>
                      Rx {rx.code} · {formatDate(rx.prescribedAt ?? rx.createdAt)}
                    </span>
                    <Button size="sm" variant="ghost" icon="eye" onClick={() => navigate(`/prescriptions/${rx.id}`)}>
                      Open
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="card card-pad">
            <h3 style={{ marginBottom: 8 }}>Actions</h3>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button size="sm" icon="tooth" onClick={() => navigate(`/chart/${v.patientId}`)}>
                Chart teeth
              </Button>
              <Button size="sm" icon="file" onClick={() => navigate(`/prescriptions/new?patientId=${v.patientId}&visitId=${v.id}`)}>
                Prescribe
              </Button>
              <Button size="sm" icon="receipt" onClick={() => navigate(`/invoices/new?patientId=${v.patientId}`)}>
                Invoice
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={editing}
        title="Edit clinical details"
        onClose={() => setEditing(false)}
        size="lg"
        closeOnOverlay={false}
        footer={
          <>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" icon="save" onClick={() => void saveEdit()}>
              Save
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Chief complaint" className="span-2">
            <Input value={form.complaint ?? v.chiefComplaint ?? ''} onChange={(e) => setForm((f) => ({ ...f, complaint: e.target.value }))} />
          </Field>
          <Field label="History">
            <Textarea rows={3} value={form.history ?? v.history ?? ''} onChange={(e) => setForm((f) => ({ ...f, history: e.target.value }))} />
          </Field>
          <Field label="Examination">
            <Textarea rows={3} value={form.exam ?? v.examination ?? ''} onChange={(e) => setForm((f) => ({ ...f, exam: e.target.value }))} />
          </Field>
          <Field label="Findings">
            <Textarea rows={3} value={form.findings ?? v.findings ?? ''} onChange={(e) => setForm((f) => ({ ...f, findings: e.target.value }))} />
          </Field>
          <Field label="Diagnosis">
            <Textarea rows={3} value={form.diagnosis ?? v.diagnosis ?? ''} onChange={(e) => setForm((f) => ({ ...f, diagnosis: e.target.value }))} />
          </Field>
          <Field label="Treatment notes">
            <Textarea rows={3} value={form.treatmentNotes ?? v.treatmentNotes ?? ''} onChange={(e) => setForm((f) => ({ ...f, treatmentNotes: e.target.value }))} />
          </Field>
          <Field label="Advice">
            <Textarea rows={3} value={form.advice ?? v.advice ?? ''} onChange={(e) => setForm((f) => ({ ...f, advice: e.target.value }))} />
          </Field>
          <Field label="Notes" className="span-2">
            <Textarea rows={3} value={form.notes ?? v.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/* ================================ DENTAL CHART ================================ */

const FDI_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const FDI_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const PEDIATRIC_UPPER = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
const PEDIATRIC_LOWER = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];

export function DentalChartPage() {
  const params = useParams();
  const patientId = Number(params.patientId ?? '0');
  const navigate = useNavigate();
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [condition, setCondition] = useState('caries');
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<'chart' | 'summary' | 'records'>('chart');
  const [printOpen, setPrintOpen] = useState(false);
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const conditions = useApi('chart.conditions', undefined, { staleTime: 300_000 });
  const chart = useApi('chart.get', { patientId }, { enabled: patientId > 0, staleTime: 3000 });
  const records = useApi('treatmentRecords.list', { patientId }, { enabled: patientId > 0 });

  const [localEntries, setLocalEntries] = useState<DentalChartDto['entries']>([]);
  const [dentition, setDentition] = useState<'adult' | 'pediatric'>('adult');

  useEffect(() => {
    if (chart.data) {
      setLocalEntries(chart.data.entries);
      setDentition(chart.data.dentition);
      setDirty(false);
    } else if (chart.data === null) {
      setLocalEntries([]);
      setDentition('adult');
      setDirty(false);
    }
  }, [chart.data]);

  const condList: ChartConditionDto[] = conditions.data ?? [];
  const condMap = useMemo(() => new Map(condList.map((c) => [c.code, c])), [condList]);
  const toothMap = useMemo(() => {
    const m = new Map<string, string>(); // toothId -> conditionCode
    for (const e of localEntries) m.set(e.toothId, e.conditionCode);
    return m;
  }, [localEntries]);

  const teeth = dentition === 'pediatric' ? { upper: PEDIATRIC_UPPER, lower: PEDIATRIC_LOWER } : { upper: FDI_UPPER, lower: FDI_LOWER };

  const saveChart = async () => {
    if (!patientId) return;
    setSaving(true);
    try {
      await api('chart.save', { patientId, dentition, entries: localEntries });
      toast.push({ kind: 'success', title: 'Dental chart saved' });
      setDirty(false);
      void chart.refetch();
      void records.refetch();
    } catch (e) {
      toast.push({ kind: 'error', title: 'Save failed', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const applyTooth = () => {
    if (!selected) return;
    setLocalEntries((entries) => {
      const others = entries.filter((e) => e.toothId !== selected);
      if (condition === 'healthy') return others; // healthy = no record
      return [...others, { toothId: selected, conditionCode: condition, notes: note || undefined }];
    });
    setDirty(true);
    setSelected(null);
    setNote('');
  };

  const removeTooth = () => {
    if (!selected) return;
    setLocalEntries((entries) => entries.filter((e) => e.toothId !== selected));
    setDirty(true);
    setSelected(null);
  };

  return (
    <div className="page">
      <PageHead
        title="Dental chart"
        sub={
          chart.data
            ? `Patient loaded · FDI numbering · updated ${formatDateTime(chart.data.updatedAt)}`
            : patientId
              ? 'FDI numbering · odontogram'
              : 'Select a patient to begin'
        }
        actions={
          <>
            <Button icon="print" onClick={() => setPrintOpen(true)} disabled={!patientId || localEntries.length === 0}>
              Print chart
            </Button>
            <Button variant="primary" icon="save" loading={saving} disabled={!dirty} onClick={() => void saveChart()}>
              {dirty ? 'Save chart' : 'Saved'}
            </Button>
          </>
        }
      />

      {!patientId ? (
        <ChartPatientPicker />
      ) : chart.isLoading ? (
        <LoadingState label="Loading chart…" />
      ) : chart.error ? (
        <ErrorState error={chart.error} onRetry={() => void chart.refetch()} />
      ) : (
        <>
          <div className="toolbar">
            <Tabs
              active={tab}
              onChange={(k) => setTab(k as typeof tab)}
              tabs={[
                { key: 'chart', label: 'Odontogram' },
                { key: 'summary', label: 'By condition' },
                { key: 'records', label: 'Treatment records', count: records.data?.length ?? 0 },
              ]}
            />
            <span style={{ flex: 1 }} />
            <Select
              value={dentition}
              onChange={(e) => {
                setDentition(e.target.value as 'adult' | 'pediatric');
                setDirty(true);
              }}
              options={[
                { value: 'adult', label: 'Adult dentition' },
                { value: 'pediatric', label: 'Pediatric dentition' },
              ]}
              style={{ width: 180 }}
            />
            <Button size="sm" icon="user" onClick={() => navigate(`/patients/${patientId}`)}>
              Patient
            </Button>
            <Button
              size="sm"
              icon="refresh"
              onClick={() => {
                void chart.refetch();
                setDirty(false);
              }}
            >
              Reload
            </Button>
            {perms.includes('clinical.edit') || perms.includes('chart.manage') ? (
              <Button size="sm" variant="primary" icon="plus" onClick={() => setNewPatientOpen(true)}>
                New patient
              </Button>
            ) : null}
          </div>

          {tab === 'chart' ? (
            <div className="chart-wrap">
              {(['upper', 'lower'] as const).map((archKey) => (
                <div className="chart-arch" key={archKey}>
                  <div className="arch-label">{archKey === 'upper' ? 'Upper arch' : 'Lower arch'}</div>
                  <div className="teeth">
                    {teeth[archKey].map((n) => {
                      const toothId = String(n);
                      const code = toothMap.get(toothId);
                      const cond = code ? condMap.get(code) : null;
                      return (
                        <div
                          key={n}
                          className={`tooth ${selected === toothId ? 'selected' : ''}`}
                          onClick={() => {
                            setSelected(toothId);
                            setCondition(code ?? 'caries');
                            setNote(localEntries.find((e) => e.toothId === toothId)?.notes ?? '');
                          }}
                          title={cond ? `Tooth ${n}: ${cond.label}` : `Tooth ${n}: healthy`}
                        >
                          <svg viewBox="0 0 40 54" className="tooth-svg" aria-hidden>
                            <path
                              d="M20 3 C10 3 5 10 5 18 C5 26 7 30 8 38 C9 46 10 52 14 52 C17 52 17 44 18 40 C19 36 21 36 22 40 C23 44 23 52 26 52 C30 52 31 46 32 38 C33 30 35 26 35 18 C35 10 30 3 20 3 Z"
                              className={`tooth-body ${code === 'missing' ? 'tooth-missing' : ''}`}
                              style={cond && code !== 'missing' ? { fill: `${cond.color}33`, stroke: cond.color } : undefined}
                            />
                            <path d="M12 16 h16 M20 8 v16 M14 26 h12" className="tooth-groove" />
                          </svg>
                          <span className="tooth-num">{n}</span>
                          {cond ? (
                            <span className="tooth-badge" style={{ background: cond.color }}>
                              {cond.label.split(' ')[0]}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="legend">
                {condList.map((c) => (
                  <span key={c.code} className="legend-item">
                    <span className="legend-dot" style={{ background: c.color }} /> {c.label}
                  </span>
                ))}
              </div>

              <div className="card card-pad" style={{ marginTop: 'var(--sp-4)' }}>
                <h3 style={{ marginBottom: 12 }}>{selected ? `Tooth ${selected}` : 'Select a tooth to record a condition'}</h3>
                {selected ? (
                  <div className="col" style={{ gap: 'var(--sp-3)' }}>
                    <div className="form-grid">
                      <Field label="Condition" required hint="“Healthy” removes any record for this tooth">
                        <Select
                          value={condition}
                          onChange={(e) => setCondition(e.target.value)}
                          options={[
                            { value: 'healthy', label: 'Healthy (clear)' },
                            ...condList.map((c) => ({ value: c.code, label: c.label })),
                          ]}
                        />
                      </Field>
                      <Field label="Note">
                        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. MO composite, 16 mesial" />
                      </Field>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <Button variant="primary" icon="check" onClick={applyTooth}>
                        Apply
                      </Button>
                      <Button variant="danger" icon="trash" onClick={removeTooth}>
                        Clear tooth
                      </Button>
                      <Button variant="ghost" onClick={() => setSelected(null)}>
                        Cancel
                      </Button>
                      {dirty ? <span className="tiny muted">Unsaved changes — press “Save chart”</span> : null}
                    </div>
                  </div>
                ) : (
                  <p className="tiny muted">Click a tooth above. Chart changes stay local until you save — condition history is preserved by save time.</p>
                )}
              </div>
            </div>
          ) : null}

          {tab === 'summary' ? (
            <div className="card card-pad">
              <ChartSummary entries={localEntries} condMap={condMap} />
            </div>
          ) : null}

          {tab === 'records' ? (
            <div className="card card-pad">
              {records.isLoading ? (
                <LoadingState />
              ) : !records.data?.length ? (
                <EmptyState
                  title="No treatment records"
                  desc="Planned or completed treatments for this patient appear here and can be added to invoices."
                  icon="scissors"
                />
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Treatment</th>
                      <th>Teeth</th>
                      <th>Fee (৳)</th>
                      <th>Status</th>
                      <th>Invoiced</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.data.map((r) => (
                      <tr key={r.id}>
                        <td className="cell-main">{r.treatmentName}</td>
                        <td>{r.toothIds.join(', ') || '—'}</td>
                        <td className="mono">{r.fee.toFixed(2)}</td>
                        <td>
                          <Badge tone={r.status === 'done' ? 'ok' : 'warn'}>{r.status}</Badge>
                        </td>
                        <td>{r.invoiced ? <Badge tone="ok">yes</Badge> : <Badge tone="neutral">no</Badge>}</td>
                        <td>{formatDate(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}
        </>
      )}

      <PrintPreviewModal open={printOpen} template="chart" entityId={patientId} title="Dental chart" onClose={() => setPrintOpen(false)} />
      <Modal open={newPatientOpen} onClose={() => setNewPatientOpen(false)} title="Register patient for charting" size="lg">
        <PatientForm
          open
          onClose={() => setNewPatientOpen(false)}
          onSaved={(id) => {
            setNewPatientOpen(false);
            navigate(`/chart/${id}`);
          }}
        />
      </Modal>
    </div>
  );
}

function ChartSummary({ entries, condMap }: { entries: DentalChartDto['entries']; condMap: Map<string, ChartConditionDto> }) {
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of entries) {
      const arr = m.get(e.conditionCode) ?? [];
      arr.push(e.toothId);
      m.set(e.conditionCode, arr);
    }
    return [...m.entries()].sort((a, b) => (condMap.get(a[0])?.sort ?? 99) - (condMap.get(b[0])?.sort ?? 99));
  }, [entries, condMap]);

  if (!entries.length) return <EmptyState title="No conditions recorded" desc="Recorded tooth conditions summarize here." icon="grid" />;
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Condition</th>
          <th>Teeth</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        {groups.map(([code, teeth]) => {
          const cond = condMap.get(code);
          return (
            <tr key={code}>
              <td>
                <span className="legend-dot" style={{ background: cond?.color ?? '#64748b' }} /> {cond?.label ?? code}
              </td>
              <td>{teeth.join(', ')}</td>
              <td className="mono">{teeth.length}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ChartPatientPicker() {
  const navigate = useNavigate();
  return (
    <div className="card card-pad" style={{ maxWidth: 560 }}>
      <h3 style={{ marginBottom: 10 }}>Choose a patient</h3>
      <PatientCombobox value="" onChange={(v) => navigate(`/chart/${v}`)} placeholder="Search patient name or phone…" />
      <p className="tiny muted" style={{ marginTop: 10 }}>
        Tooth-level conditions are stored as clinical facts with save timestamps — printed as an A4 chart via any paper profile.
      </p>
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <Button icon="users" onClick={() => navigate('/patients')}>
          Go to patients
        </Button>
      </div>
    </div>
  );
}

/* ================================ TREATMENTS ================================ */

export function TreatmentsPage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const canManage = perms.includes('treatment.manage');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [edit, setEdit] = useState<TreatmentDto | 'new' | null>(null);

  const query = useMemo(
    () => ({ q: q || undefined, category: category || undefined, includeInactive }),
    [q, category, includeInactive],
  );
  const list = useApi('treatments.list', query, { staleTime: 3000 });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of list.data ?? []) if (t.category) set.add(t.category);
    return [...set].sort();
  }, [list.data]);

  const cols: Column<TreatmentDto>[] = [
    { key: 'code', header: 'Code', width: '90px', render: (t) => <span className="mono">{t.code}</span> },
    {
      key: 'name',
      header: 'Treatment',
      render: (t) => (
        <div>
          <div className="cell-main">{t.name}</div>
          {t.description ? <div className="cell-sub">{t.description}</div> : null}
        </div>
      ),
    },
    { key: 'category', header: 'Category', value: (t) => t.category || '—' },
    { key: 'fee', header: 'Fee (৳)', align: 'num', value: (t) => t.defaultFee.toFixed(2) },
    { key: 'duration', header: 'Duration', value: (t) => (t.durationMin ? `${t.durationMin} min` : '—') },
    {
      key: 'active',
      header: 'Status',
      render: (t) => <Badge tone={t.active ? 'ok' : 'neutral'}>{t.active ? 'active' : 'inactive'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (t) =>
        canManage ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(t)} />
            <Button
              size="sm"
              variant="ghost"
              icon="trash"
              onClick={() => {
                void api('treatments.delete', { id: t.id })
                  .then(() => {
                    void list.refetch();
                  })
                  .catch(() => undefined);
              }}
            />
          </span>
        ) : null,
    },
  ];

  return (
    <div className="page">
      <PageHead
        title="Treatments"
        sub={list.data ? `${list.data.length} catalog entries` : 'Treatment catalog & pricing'}
        actions={
          canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>
              New treatment
            </Button>
          ) : null
        }
      />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search treatment or code…" />
        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Any category"
          style={{ width: 200 }}
          options={categories.map((c) => ({ value: c, label: c }))}
        />
        <label className="checkbox-row">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Include inactive
        </label>
      </div>
      <DataTable
        columns={cols}
        rows={list.data ?? []}
        rowKey={(t) => t.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(t) => (canManage ? setEdit(t) : undefined)}
        empty={{
          title: q ? `No treatments match “${q}”` : 'No treatments yet',
          desc: 'Define the services your clinic offers — prices feed invoices and reports.',
          icon: 'scissors',
        }}
      />
      <TreatmentEditor
        target={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          void list.refetch();
        }}
      />
    </div>
  );
}

function TreatmentEditor({
  target,
  onClose,
  onSaved,
}: {
  target: TreatmentDto | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ code: '', name: '', category: '', description: '', defaultFee: '', durationMin: '', active: true });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (target && target !== 'new') {
      setForm({
        code: target.code,
        name: target.name,
        category: target.category,
        description: target.description ?? '',
        defaultFee: String(target.defaultFee),
        durationMin: target.durationMin != null ? String(target.durationMin) : '',
        active: target.active,
      });
    } else if (target === 'new') {
      setForm({ code: '', name: '', category: '', description: '', defaultFee: '', durationMin: '', active: true });
    }
    setErrors({});
  }, [target]);

  const save = useApiMutation('treatments.save', {
    onSuccess: () => {
      toast.push({ kind: 'success', title: 'Treatment saved' });
      onSaved();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', msg: e.message }),
  });

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!form.code.trim()) errs.code = 'Code is required';
    if (!form.name.trim()) errs.name = 'Name is required';
    if (!form.category.trim()) errs.category = 'Category is required';
    if (form.defaultFee === '' || Number(form.defaultFee) < 0) errs.defaultFee = 'Valid fee required';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      id: target && target !== 'new' ? target.id : undefined,
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category.trim(),
      description: form.description.trim() || undefined,
      defaultFee: Number(form.defaultFee),
      durationMin: form.durationMin ? Number(form.durationMin) : null,
      active: form.active,
    });
  };

  if (!target) return null;
  return (
    <Modal
      open
      title={target === 'new' ? 'New treatment' : `Edit — ${target.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="save" loading={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Code" required error={errors.code}>
          <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. FILL-COM" />
        </Field>
        <Field label="Category" required error={errors.category}>
          <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Restorative" />
        </Field>
        <Field label="Name" required error={errors.name} className="span-2">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Composite filling — per surface" />
        </Field>
        <Field label="Default fee (৳)" required error={errors.defaultFee}>
          <Input type="number" min={0} step="0.01" value={form.defaultFee} onChange={(e) => setForm((f) => ({ ...f, defaultFee: e.target.value }))} />
        </Field>
        <Field label="Duration (min)">
          <Input type="number" min={0} value={form.durationMin} onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))} />
        </Field>
        <Field label="Description" className="span-2">
          <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <label className="checkbox-row span-2">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          Active (available for selection)
        </label>
      </div>
    </Modal>
  );
}
