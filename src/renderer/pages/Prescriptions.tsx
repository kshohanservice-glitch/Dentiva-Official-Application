import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi, useApiMutation, useAppState } from '../lib/api';
import {
  Badge,
  Button,
  ChipRow,
  DataTable,
  ErrorState,
  Field,
  Icon,
  Input,
  LoadingState,
  PageHead,
  Pagination,
  SearchBox,
  Select,
  Textarea,
  useToast,
  type Column,
} from '../components/ui';
import { PrintPreviewModal } from '../components/PrintPreview';
import { PatientCombobox } from './Clinical';
import { formatDate, formatDateTime, todayIso } from '@shared/format';
import type { PrescriptionDto, PrescriptionItemInput } from '@shared/contract';

/* ================================ LIST ================================ */

export function PrescriptionsPage() {
  const navigate = useNavigate();
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const [q, setQ] = useState('');
  const [range, setRange] = useState<'today' | 'd7' | 'd30' | 'd365' | 'all'>('d30');
  const [patientId, setPatientId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [printId, setPrintId] = useState<number | null>(null);

  const query = useMemo(
    () => ({ q: q || undefined, range, patientId: patientId ? Number(patientId) : undefined, page, pageSize }),
    [q, range, patientId, page, pageSize],
  );
  const list = useApi('prescriptions.list', query, { staleTime: 3000 });
  useEffect(() => setPage(1), [q, range, patientId]);

  const cols: Column<PrescriptionDto>[] = [
    { key: 'code', header: 'Rx No.', width: '110px', render: (rx) => <span className="mono" style={{ fontWeight: 600 }}>{rx.code}</span> },
    { key: 'date', header: 'Date', value: (rx) => formatDate(rx.prescribedAt ?? rx.createdAt) },
    {
      key: 'patient',
      header: 'Patient',
      render: (rx) => (
        <div>
          <div className="cell-main">{rx.patientName}</div>
          <div className="cell-sub">
            {rx.patientCode}
            {rx.age != null ? ` · ${rx.age}y` : ''}
            {rx.gender ? ` · ${rx.gender}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'medicines',
      header: 'Medicines',
      render: (rx) => (
        <span title={rx.items.map((i) => i.medicineName).join(', ')}>
          {rx.items.length} × {rx.items.map((i) => i.medicineName).slice(0, 2).join(', ')}
          {rx.items.length > 2 ? '…' : ''}
        </span>
      ),
    },
    { key: 'dentist', header: 'Prescriber', value: (rx) => rx.dentistName || '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (rx) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon="print" onClick={() => setPrintId(rx.id)} />
          <Button size="sm" variant="ghost" icon="edit" onClick={() => navigate(`/prescriptions/${rx.id}`)} />
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHead
        title="Prescriptions"
        sub={list.data ? `${list.data.total} prescriptions` : 'Prescriptions & printing'}
        actions={
          perms.includes('prescription.create') ? (
            <Button variant="primary" icon="plus" onClick={() => navigate('/prescriptions/new')}>
              New prescription
            </Button>
          ) : null
        }
      />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search Rx no., patient, medicine…" />
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
        <div style={{ width: 260 }}>
          <PatientCombobox
            value={patientId}
            placeholder="Filter by patient…"
            onChange={(v) => setPatientId(v === patientId ? '' : v)}
          />
        </div>
        {patientId ? (
          <Button size="sm" variant="ghost" onClick={() => setPatientId('')}>
            Clear patient
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={cols}
        rows={list.data?.items ?? []}
        rowKey={(rx) => rx.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(rx) => navigate(`/prescriptions/${rx.id}`)}
        empty={{
          title: q ? `No prescriptions match “${q}”` : 'No prescriptions yet',
          desc: 'Create prescriptions with medicine frequency, meal timing and print them on A4, A5 or thermal paper.',
          icon: 'file',
          action: perms.includes('prescription.create') ? (
            <Button variant="primary" icon="plus" onClick={() => navigate('/prescriptions/new')}>
              New prescription
            </Button>
          ) : undefined,
        }}
        footer={
          list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} /> : null
        }
      />

      <PrintPreviewModal
        open={printId != null}
        template="prescription"
        entityId={printId ?? 0}
        title="Print prescription"
        onClose={() => setPrintId(null)}
      />
    </div>
  );
}

/* ================================ EDITOR ================================ */

const emptyItem = (): PrescriptionItemInput => ({
  medicineName: '',
  genericName: '',
  strength: '',
  frequency: '',
  morning: false,
  noon: false,
  night: false,
  meal: 'any',
  duration: '',
  quantity: '',
  instruction: '',
});

export function PrescriptionEditorPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const toast = useToast();
  const id = Number(params.id ?? '0');
  const isNew = !id;

  const [form, setForm] = useState({
    patientId: searchParams.get('patientId') ?? '',
    visitId: searchParams.get('visitId') ?? '',
    dentistId: '',
    prescribedAt: todayIso(),
    chiefComplaint: '',
    onExamination: '',
    examinationResult: '',
    advice: '',
  });
  const [items, setItems] = useState<PrescriptionItemInput[]>([emptyItem()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [printOpen, setPrintOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dentists = useApi('dentists.list', undefined, { staleTime: 60_000 });
  const existing = useApi('prescriptions.get', { id }, { enabled: !isNew });
  const medications = useApi('medications.list', undefined, { staleTime: 120_000 });

  useEffect(() => {
    if (existing.data) {
      const rx = existing.data;
      setForm({
        patientId: String(rx.patientId),
        visitId: rx.visitId != null ? String(rx.visitId) : '',
        dentistId: rx.dentistId != null ? String(rx.dentistId) : '',
        prescribedAt: (rx.prescribedAt ?? rx.createdAt).slice(0, 10),
        chiefComplaint: rx.chiefComplaint ?? '',
        onExamination: rx.onExamination ?? '',
        examinationResult: rx.examinationResult ?? '',
        advice: rx.advice ?? '',
      });
      setItems(rx.items.map((i) => ({ ...i, id: undefined })));
    }
  }, [existing.data]);

  const save = useApiMutation(isNew ? 'prescriptions.create' : 'prescriptions.update', {
    onSuccess: (data) => {
      const rid = isNew ? (data as { id: number }).id : id;
      toast.push({ kind: 'success', title: isNew ? 'Prescription created' : 'Prescription updated' });
      if (isNew) navigate(`/prescriptions/${rid}`, { replace: true });
      else void existing.refetch();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', msg: e.message }),
  });

  const remove = useApiMutation('prescriptions.delete', {
    onSuccess: () => {
      toast.push({ kind: 'success', title: 'Prescription deleted' });
      navigate('/prescriptions');
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Delete failed', msg: e.message }),
  });

  const setItem = (idx: number, patch: Partial<PrescriptionItemInput>) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!form.patientId) errs.patient = 'Select a patient';
    const valid = items.filter((i) => i.medicineName.trim());
    if (!valid.length) errs.items = 'Add at least one medicine';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      id: isNew ? undefined : id,
      patientId: Number(form.patientId),
      visitId: form.visitId ? Number(form.visitId) : null,
      dentistId: form.dentistId ? Number(form.dentistId) : null,
      prescribedAt: form.prescribedAt,
      chiefComplaint: form.chiefComplaint,
      onExamination: form.onExamination,
      examinationResult: form.examinationResult,
      advice: form.advice,
      items: valid.map((i) => ({
        ...i,
        genericName: i.genericName || undefined,
        strength: i.strength || undefined,
        dose: i.dose || undefined,
        quantity: i.quantity || undefined,
        duration: i.duration || undefined,
        instruction: i.instruction || undefined,
      })),
    });
  };

  if (!isNew && existing.isLoading) return <LoadingState label="Loading prescription…" />;
  if (!isNew && existing.error) return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;

  const rx = existing.data;
  const canEdit = isNew || perms.includes('prescription.edit');

  return (
    <div className="page">
      <PageHead
        title={isNew ? 'New prescription' : `Prescription ${rx?.code ?? ''}`}
        sub={rx ? `${rx.patientName} · ${rx.patientCode} · ${formatDate(rx.prescribedAt ?? rx.createdAt, 'long')}` : 'Compose and print a prescription'}
        actions={
          <>
            <Button icon="arrowLeft" onClick={() => navigate('/prescriptions')}>
              Back
            </Button>
            {!isNew && rx ? (
              <Button icon="print" onClick={() => setPrintOpen(true)}>
                Print / PDF
              </Button>
            ) : null}
            {!isNew && perms.includes('prescription.delete') ? (
              <Button icon="trash" variant="ghost" onClick={() => setDeleting(true)}>
                Delete
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="primary" icon="save" loading={save.isPending} onClick={submit}>
                {isNew ? 'Create prescription' : 'Save changes'}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid-2" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
        <div className="col">
          <div className="card card-pad">
            <h3 style={{ marginBottom: 12 }}>Medicines</h3>
            {errors.items ? (
              <div className="alert alert-danger">
                <Icon name="alert" size={16} />
                <div>{errors.items}</div>
              </div>
            ) : null}
            <div className="col" style={{ gap: 12 }}>
              {items.map((it, idx) => (
                <div key={idx} className="rx-item">
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <strong>Medicine {idx + 1}</strong>
                    {canEdit && items.length > 1 ? (
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => setItems((a) => a.filter((_, i) => i !== idx))} />
                    ) : null}
                  </div>
                  <div className="form-grid">
                    <Field label="Medicine name" required>
                      <Input
                        value={it.medicineName}
                        list={`meds-${idx}`}
                        onChange={(e) => setItem(idx, { medicineName: e.target.value })}
                        placeholder="e.g. Amoxicillin"
                      />
                      <datalist id={`meds-${idx}`}>
                        {(medications.data ?? []).map((m) => (
                          <option key={m.id} value={m.name}>
                            {m.genericName ? `${m.genericName} ${m.strength ?? ''}` : m.form ?? ''}
                          </option>
                        ))}
                      </datalist>
                    </Field>
                    <Field label="Generic / strength">
                      <Input
                        value={`${it.genericName ?? ''}`}
                        onChange={(e) => setItem(idx, { genericName: e.target.value })}
                        placeholder="e.g. Amoxicillin 500mg"
                      />
                    </Field>
                    <Field label="Dose">
                      <Input value={it.dose ?? ''} onChange={(e) => setItem(idx, { dose: e.target.value })} placeholder="e.g. 1 cap" />
                    </Field>
                    <Field label="Frequency (text)">
                      <Input value={it.frequency ?? ''} onChange={(e) => setItem(idx, { frequency: e.target.value })} placeholder="e.g. 1-0-1" />
                    </Field>
                  </div>
                  <div className="row" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={Boolean(it.morning)} onChange={(e) => setItem(idx, { morning: e.target.checked })} />
                      Morning
                    </label>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={Boolean(it.noon)} onChange={(e) => setItem(idx, { noon: e.target.checked })} />
                      Noon
                    </label>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={Boolean(it.night)} onChange={(e) => setItem(idx, { night: e.target.checked })} />
                      Night
                    </label>
                    <Select
                      value={it.meal ?? 'any'}
                      onChange={(e) => setItem(idx, { meal: e.target.value as PrescriptionItemInput['meal'] })}
                      options={[
                        { value: 'any', label: 'Any time' },
                        { value: 'before', label: 'Before meal' },
                        { value: 'after', label: 'After meal' },
                      ]}
                      style={{ width: 150 }}
                    />
                    <Input
                      style={{ width: 130 }}
                      value={it.duration ?? ''}
                      onChange={(e) => setItem(idx, { duration: e.target.value })}
                      placeholder="Duration"
                    />
                    <Input
                      style={{ width: 110 }}
                      value={it.quantity ?? ''}
                      onChange={(e) => setItem(idx, { quantity: e.target.value })}
                      placeholder="Qty"
                    />
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Input
                      value={it.instruction ?? ''}
                      onChange={(e) => setItem(idx, { instruction: e.target.value })}
                      placeholder="Special instruction…"
                    />
                  </div>
                </div>
              ))}
            </div>
            {canEdit ? (
              <div style={{ marginTop: 12 }}>
                <Button icon="plus" onClick={() => setItems((a) => [...a, emptyItem()])}>
                  Add medicine
                </Button>
              </div>
            ) : null}
          </div>

          <div className="card card-pad">
            <h3 style={{ marginBottom: 12 }}>Clinical sections</h3>
            <div className="col" style={{ gap: 'var(--sp-3)' }}>
              <Field label="C/C — Chief complaint">
                <Input disabled={!canEdit} value={form.chiefComplaint} onChange={(e) => setForm((f) => ({ ...f, chiefComplaint: e.target.value }))} />
              </Field>
              <Field label="On examination">
                <Textarea disabled={!canEdit} rows={2} value={form.onExamination} onChange={(e) => setForm((f) => ({ ...f, onExamination: e.target.value }))} />
              </Field>
              <Field label="Examination result">
                <Textarea disabled={!canEdit} rows={2} value={form.examinationResult} onChange={(e) => setForm((f) => ({ ...f, examinationResult: e.target.value }))} />
              </Field>
              <Field label="Advice">
                <Textarea disabled={!canEdit} rows={2} value={form.advice} onChange={(e) => setForm((f) => ({ ...f, advice: e.target.value }))} />
              </Field>
            </div>
          </div>
        </div>

        <div className="col">
          <div className="card card-pad">
            <h3 style={{ marginBottom: 12 }}>Details</h3>
            <div className="col" style={{ gap: 'var(--sp-3)' }}>
              <Field label="Patient" required error={errors.patient}>
                <PatientCombobox
                  value={form.patientId}
                  disabled={!canEdit}
                  placeholder="Search patient…"
                  onChange={(v) => setForm((f) => ({ ...f, patientId: v }))}
                />
              </Field>
              <Field label="Prescriber">
                <Select
                  value={form.dentistId}
                  disabled={!canEdit}
                  placeholder="Select dentist…"
                  onChange={(e) => setForm((f) => ({ ...f, dentistId: e.target.value }))}
                  options={(dentists.data ?? []).map((d) => ({
                    value: d.id,
                    label: `${d.fullName}${d.designations.length ? ', ' + d.designations.join(', ') : ''}`,
                  }))}
                />
              </Field>
              <Field label="Date">
                <Input
                  type="date"
                  disabled={!canEdit}
                  value={form.prescribedAt}
                  onChange={(e) => setForm((f) => ({ ...f, prescribedAt: e.target.value }))}
                />
              </Field>
              <Field label="Linked visit ID" hint="Optional — set automatically when opened from a visit">
                <Input
                  disabled={!canEdit}
                  value={form.visitId}
                  onChange={(e) => setForm((f) => ({ ...f, visitId: e.target.value }))}
                />
              </Field>
            </div>
          </div>
          <div className="card card-pad">
            <h3 style={{ marginBottom: 8 }}>Output</h3>
            <p className="tiny muted">
              Print on A4, A5 or thermal paper with the clinic letterhead, dentist signature and Bengali messages. PDF
              export is available from the print preview.
            </p>
            <Button icon="print" disabled={isNew} onClick={() => setPrintOpen(true)}>
              Open print preview
            </Button>
          </div>
          {!isNew && perms.includes('prescription.edit') && existing.data ? (
            <div className="card card-pad">
              <h3 style={{ marginBottom: 8 }}>Status</h3>
              <div className="row" style={{ gap: 8 }}>
                <Badge tone="info">Rx {existing.data.code}</Badge>
                <span className="tiny muted">created {formatDateTime(existing.data.createdAt)}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <PrintPreviewModal
        open={printOpen}
        template="prescription"
        entityId={id}
        title="Print prescription"
        onClose={() => setPrintOpen(false)}
      />
      <ConfirmDelete open={deleting} name={rx?.code ?? ''} onClose={() => setDeleting(false)} onConfirm={() => remove.mutate({ id })} />
    </div>
  );
}

function ConfirmDelete({ open, name, onClose, onConfirm }: { open: boolean; name: string; onClose: () => void; onConfirm: () => void }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Delete prescription {name}?</h3>
          <button className="modal-x" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <p>This permanently removes the prescription. Consider voiding by editing instead if it was printed.</p>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" icon="trash" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
