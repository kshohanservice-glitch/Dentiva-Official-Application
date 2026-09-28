import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useApi, useApiMutation, useAppState } from '../lib/api';
import {
  Badge,
  Button,
  ChipRow,
  ConfirmDialog,
  DataTable,
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
  Stat,
  Textarea,
  useToast,
  type Column,
} from '../components/ui';
import { PrintPreviewModal } from '../components/PrintPreview';
import { PatientCombobox } from './Clinical';
import { formatDate, formatDateTime, formatMoney, todayIso } from '@shared/format';
import type {
  InvoiceDto,
  InvoiceItemInput,
  InvoiceListQuery,
  PaymentDto,
  PaymentListQuery,
  PaymentMethodCode,
} from '@shared/contract';

const METHOD_OPTIONS: { value: PaymentMethodCode | 'all'; label: string }[] = [
  { value: 'all', label: 'Any method' },
  { value: 'cash', label: 'Cash' },
  { value: 'bkash', label: 'bKash' },
  { value: 'nagad', label: 'Nagad' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'upay', label: 'Upay' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'bank', label: 'Bank' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

const INVOICE_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  paid: 'ok',
  partial: 'warn',
  unpaid: 'danger',
  void: 'neutral',
};

/* ================================ INVOICES LIST ================================ */

export function InvoicesPage() {
  const navigate = useNavigate();
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<InvoiceListQuery['status']>('all');
  const [range, setRange] = useState<'today' | 'd7' | 'd30' | 'd365' | 'all'>('d30');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const query: InvoiceListQuery = useMemo(
    () => ({ q: q || undefined, status, range, page, pageSize }),
    [q, status, range, page, pageSize],
  );
  const list = useApi('invoices.list', query, { staleTime: 3000 });
  useEffect(() => setPage(1), [q, status, range]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api('export.csv', { kind: 'invoices', range });
      if (res.ok) toast.push({ kind: 'success', title: `Exported ${res.rowCount ?? 0} rows`, msg: res.path });
      else if (!res.cancelled) toast.push({ kind: 'error', title: 'Export failed', msg: res.reason });
    } catch (e) {
      toast.push({ kind: 'error', title: 'Export failed', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setExporting(false);
    }
  };

  const cols: Column<InvoiceDto>[] = [
    { key: 'no', header: 'Invoice', width: '130px', render: (i) => <span className="mono" style={{ fontWeight: 600 }}>{i.invoiceNo}</span> },
    { key: 'date', header: 'Issued', value: (i) => formatDate(i.issuedAt) },
    {
      key: 'patient',
      header: 'Patient',
      render: (i) => (
        <div>
          <div className="cell-main">{i.patientName}</div>
          <div className="cell-sub">{i.patientCode}</div>
        </div>
      ),
    },
    { key: 'items', header: 'Items', align: 'num', value: (i) => i.items.length },
    { key: 'total', header: 'Total', align: 'num', value: (i) => formatMoney(i.total) },
    { key: 'paid', header: 'Paid', align: 'num', value: (i) => formatMoney(i.paidTotal) },
    {
      key: 'balance',
      header: 'Balance',
      align: 'num',
      render: (i) => (
        <span style={{ color: i.balance > 0 ? 'var(--c-danger)' : 'var(--c-ok)', fontWeight: 600 }}>{formatMoney(i.balance)}</span>
      ),
    },
    { key: 'status', header: 'Status', render: (i) => <Badge tone={INVOICE_TONE[i.status]}>{i.status}</Badge> },
  ];

  return (
    <div className="page">
      <PageHead
        title="Invoices"
        sub={list.data ? `${list.data.total} invoices` : 'Billing'}
        actions={
          <>
            <Button icon="download" loading={exporting} onClick={() => void exportCsv()}>
              Export CSV
            </Button>
            {perms.includes('invoice.create') ? (
              <Button variant="primary" icon="plus" onClick={() => navigate('/invoices/new')}>
                New invoice
              </Button>
            ) : null}
          </>
        }
      />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search invoice no., patient…" />
        <ChipRow
          options={[
            { value: 'all', label: 'All' },
            { value: 'unpaid', label: 'Unpaid' },
            { value: 'partial', label: 'Partial' },
            { value: 'paid', label: 'Paid' },
            { value: 'void', label: 'Void' },
          ]}
          value={status ?? 'all'}
          onChange={(v) => setStatus(v as InvoiceListQuery['status'])}
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
      </div>

      <DataTable
        columns={cols}
        rows={list.data?.items ?? []}
        rowKey={(i) => i.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(i) => navigate(`/invoices/${i.id}`)}
        empty={{
          title: q ? `No invoices match “${q}”` : 'No invoices yet',
          desc: 'Create invoices with line items, discounts and taxes — payments update balances automatically.',
          icon: 'receipt',
          action: perms.includes('invoice.create') ? (
            <Button variant="primary" icon="plus" onClick={() => navigate('/invoices/new')}>
              New invoice
            </Button>
          ) : undefined,
        }}
        footer={
          list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} /> : null
        }
      />
    </div>
  );
}

/* ================================ INVOICE EDITOR ================================ */

interface Line {
  id?: number;
  description: string;
  treatmentId: number | null;
  qty: string;
  unitPrice: string;
  discount: string;
}

export function InvoiceEditorPage() {
  const params = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const id = Number(params.id ?? '0');
  const isNew = !id;

  const [patientId, setPatientId] = useState('');
  const [issuedAt, setIssuedAt] = useState(todayIso());
  const [lines, setLines] = useState<Line[]>([{ description: '', treatmentId: null, qty: '1', unitPrice: '', discount: '0' }]);
  const [discountAmount, setDiscountAmount] = useState('0');
  const [taxAmount, setTaxAmount] = useState('0');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const treatments = useApi('treatments.list', undefined, { staleTime: 60_000 });
  const existing = useApi('invoices.get', { id }, { enabled: !isNew });

  useEffect(() => {
    if (existing.data) {
      const inv = existing.data;
      setPatientId(String(inv.patientId));
      setIssuedAt(inv.issuedAt.slice(0, 10));
      setLines(
        inv.items.map((it) => ({
          id: it.id,
          description: it.description,
          treatmentId: it.treatmentId,
          qty: String(it.qty),
          unitPrice: String(it.unitPrice),
          discount: String(it.discount),
        })),
      );
      setDiscountAmount(String(inv.discountAmount));
      setTaxAmount(String(inv.taxAmount));
      setNotes(inv.notes ?? '');
    }
  }, [existing.data]);

  const subtotal = lines.reduce((s, l) => {
    const qty = Number(l.qty) || 0;
    const price = Number(l.unitPrice) || 0;
    const disc = Number(l.discount) || 0;
    return s + Math.max(0, qty * price - disc);
  }, 0);
  const total = Math.max(0, subtotal - (Number(discountAmount) || 0) + (Number(taxAmount) || 0));

  const setLine = (idx: number, patch: Partial<Line>) =>
    setLines((arr) => arr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const save = useApiMutation(isNew ? 'invoices.create' : 'invoices.update', {
    onSuccess: (data) => {
      if (isNew) {
        const inv = data as { id: number; invoiceNo: string };
        toast.push({ kind: 'success', title: `Invoice ${inv.invoiceNo} created` });
        navigate(`/invoices/${inv.id}`, { replace: true });
      } else {
        toast.push({ kind: 'success', title: 'Invoice updated' });
        void existing.refetch();
      }
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', msg: e.message }),
  });

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!patientId) errs.patient = 'Select a patient';
    const valid: InvoiceItemInput[] = [];
    for (const [i, l] of lines.entries()) {
      if (!l.description.trim()) {
        errs[`line${i}`] = 'Description required';
        continue;
      }
      if (!(Number(l.qty) > 0)) {
        errs[`line${i}`] = 'Qty must be > 0';
        continue;
      }
      if (Number(l.unitPrice) < 0 || l.unitPrice === '') {
        errs[`line${i}`] = 'Valid price required';
        continue;
      }
      valid.push({
        id: l.id,
        description: l.description.trim(),
        treatmentId: l.treatmentId,
        qty: Number(l.qty),
        unitPrice: Number(l.unitPrice),
        discount: Number(l.discount) || 0,
      });
    }
    if (!valid.length) errs.lines = 'Add at least one line item';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      id: isNew ? undefined : id,
      patientId: Number(patientId),
      issuedAt,
      items: valid,
      discountAmount: Number(discountAmount) || 0,
      taxAmount: Number(taxAmount) || 0,
      notes,
    });
  };

  if (!isNew && existing.isLoading) return <LoadingState label="Loading invoice…" />;
  if (!isNew && existing.error) return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;

  return (
    <div className="page">
      <PageHead
        title={isNew ? 'New invoice' : `Edit ${existing.data?.invoiceNo ?? ''}`}
        sub={existing.data ? `${existing.data.patientName} · issued ${formatDate(existing.data.issuedAt)}` : 'Build an invoice from treatment lines'}
        actions={
          <>
            <Button icon="arrowLeft" onClick={() => navigate('/invoices')}>
              Back
            </Button>
            <Button variant="primary" icon="save" loading={save.isPending} onClick={submit}>
              {isNew ? 'Create invoice' : 'Save changes'}
            </Button>
          </>
        }
      />

      <div className="card card-pad">
        <div className="form-grid" style={{ marginBottom: 6 }}>
          <Field label="Patient" required error={errors.patient} className="span-2">
            <PatientCombobox value={patientId} placeholder="Search patient…" onChange={setPatientId} />
          </Field>
          <Field label="Issued date">
            <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
          </Field>
        </div>

        <div className="row" style={{ justifyContent: 'space-between', margin: '14px 0 8px' }}>
          <h3>Line items</h3>
          <Button
            size="sm"
            icon="plus"
            onClick={() => setLines((arr) => [...arr, { description: '', treatmentId: null, qty: '1', unitPrice: '', discount: '0' }])}
          >
            Add line
          </Button>
        </div>
        {errors.lines ? (
          <div className="alert alert-danger">
            <Icon name="alert" size={16} />
            <div>{errors.lines}</div>
          </div>
        ) : null}
        <div className="col" style={{ gap: 8 }}>
          {lines.map((l, idx) => (
            <div key={idx} className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Description" style={{ flex: '2 1 240px' }} error={errors[`line${idx}`]}>
                <Input value={l.description} onChange={(e) => setLine(idx, { description: e.target.value })} placeholder="e.g. Scaling — upper arch" />
              </Field>
              <Field label="Treatment (optional)" style={{ flex: '1.4 1 180px' }}>
                <Select
                  value={l.treatmentId ?? ''}
                  placeholder="From catalog…"
                  onChange={(e) => {
                    const tid = e.target.value ? Number(e.target.value) : null;
                    const t = (treatments.data ?? []).find((x) => x.id === tid);
                    setLine(idx, {
                      treatmentId: tid,
                      description: l.description || (t ? t.name : l.description),
                      unitPrice: t ? String(t.defaultFee) : l.unitPrice,
                    });
                  }}
                  options={(treatments.data ?? []).map((t) => ({ value: t.id, label: `${t.name} — ${formatMoney(t.defaultFee)}` }))}
                />
              </Field>
              <Field label="Qty" style={{ width: 80 }}>
                <Input type="number" min={1} value={l.qty} onChange={(e) => setLine(idx, { qty: e.target.value })} />
              </Field>
              <Field label="Unit price" style={{ width: 130 }}>
                <Input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => setLine(idx, { unitPrice: e.target.value })} />
              </Field>
              <Field label="Discount" style={{ width: 110 }}>
                <Input type="number" min={0} step="0.01" value={l.discount} onChange={(e) => setLine(idx, { discount: e.target.value })} />
              </Field>
              <div style={{ width: 120, paddingBottom: 2 }}>
                <div className="tiny muted">Line total</div>
                <strong className="mono">
                  {formatMoney(Math.max(0, (Number(l.qty) || 0) * (Number(l.unitPrice) || 0) - (Number(l.discount) || 0)))}
                </strong>
              </div>
              {lines.length > 1 ? (
                <Button size="sm" variant="ghost" icon="trash" onClick={() => setLines((arr) => arr.filter((_, i) => i !== idx))} />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1fr 320px', alignItems: 'start' }}>
        <div className="card card-pad">
          <Field label="Notes (printed on invoice)">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Follow-up after 7 days" />
          </Field>
        </div>
        <div className="card card-pad">
          <div className="col" style={{ gap: 'var(--sp-3)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Subtotal</span>
              <strong className="mono">{formatMoney(subtotal)}</strong>
            </div>
            <Field label="Invoice discount (৳)">
              <Input type="number" min={0} step="0.01" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} />
            </Field>
            <Field label="Tax (৳)">
              <Input type="number" min={0} step="0.01" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
            </Field>
            <hr />
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 'var(--fs-lg)' }}>
              <span>Total</span>
              <strong className="mono">{formatMoney(total)}</strong>
            </div>
            <Button variant="primary" icon="save" loading={save.isPending} onClick={submit}>
              {isNew ? 'Create invoice' : 'Save changes'}
            </Button>
            <p className="tiny muted">Currency: ৳ (BDT). Payments can be recorded from the invoice detail page.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================ INVOICE DETAIL ================================ */

export function InvoiceDetailPage() {
  const params = useParams();
  const id = Number(params.id ?? '0');
  const navigate = useNavigate();
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const toast = useToast();
  const [printOpen, setPrintOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  const inv = useApi('invoices.get', { id }, { enabled: id > 0 });

  if (inv.isLoading) return <LoadingState label="Loading invoice…" />;
  if (inv.error || !inv.data) return <ErrorState error={inv.error} onRetry={() => void inv.refetch()} />;
  const i = inv.data;

  return (
    <div className="page">
      <PageHead
        title={`Invoice ${i.invoiceNo}`}
        sub={`${i.patientName} · ${i.patientCode} · issued ${formatDate(i.issuedAt, 'long')}`}
        actions={
          <>
            <Button icon="arrowLeft" onClick={() => navigate('/invoices')}>
              Back
            </Button>
            <Button icon="user" onClick={() => navigate(`/patients/${i.patientId}`)}>
              Patient
            </Button>
            <Button icon="print" onClick={() => setPrintOpen(true)}>
              Print / PDF
            </Button>
            {perms.includes('invoice.edit') && i.status !== 'void' ? (
              <Button icon="edit" onClick={() => navigate(`/invoices/${id}/edit`)}>
                Edit
              </Button>
            ) : null}
            {perms.includes('invoice.create') && i.status !== 'void' ? (
              <Button variant="primary" icon="money" onClick={() => setPayOpen(true)}>
                Record payment
              </Button>
            ) : null}
            {perms.includes('invoice.delete') && i.status !== 'void' ? (
              <Button icon="trash" variant="ghost" onClick={() => setVoidOpen(true)}>
                Void
              </Button>
            ) : null}
          </>
        }
      />

      <div className="stat-grid cols-4">
        <Stat label="Total" value={formatMoney(i.total)} icon="receipt" tone="primary" />
        <Stat label="Paid" value={formatMoney(i.paidTotal)} icon="check" tone="ok" sub={`${i.payments.length} payments`} />
        <Stat
          label="Balance"
          value={formatMoney(i.balance)}
          icon="wallet"
          tone={i.balance > 0 ? 'danger' : 'ok'}
          sub={i.balance > 0 ? 'Outstanding' : 'Settled'}
        />
        <Stat label="Status" value={i.status} icon="info" tone={i.status === 'paid' ? 'ok' : i.status === 'partial' ? 'warn' : i.status === 'void' ? 'danger' : 'danger'} />
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-header">
            <h3>Line items</h3>
          </div>
          <div className="card-body" style={{ paddingTop: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Unit</th>
                  <th style={{ textAlign: 'right' }}>Disc</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {i.items.map((it, idx) => (
                  <tr key={it.id ?? idx}>
                    <td>{idx + 1}</td>
                    <td className="cell-main">{it.description}</td>
                    <td style={{ textAlign: 'right' }}>{it.qty}</td>
                    <td style={{ textAlign: 'right' }}>{formatMoney(it.unitPrice)}</td>
                    <td style={{ textAlign: 'right' }}>{it.discount ? formatMoney(it.discount) : '—'}</td>
                    <td style={{ textAlign: 'right' }} className="mono">
                      {formatMoney(it.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} />
                  <td style={{ textAlign: 'right' }}>Subtotal</td>
                  <td style={{ textAlign: 'right' }}>{formatMoney(i.subtotal)}</td>
                </tr>
                {i.discountAmount > 0 ? (
                  <tr>
                    <td colSpan={4} />
                    <td style={{ textAlign: 'right' }}>Discount</td>
                    <td style={{ textAlign: 'right' }}>-{formatMoney(i.discountAmount)}</td>
                  </tr>
                ) : null}
                {i.taxAmount > 0 ? (
                  <tr>
                    <td colSpan={4} />
                    <td style={{ textAlign: 'right' }}>Tax</td>
                    <td style={{ textAlign: 'right' }}>{formatMoney(i.taxAmount)}</td>
                  </tr>
                ) : null}
                <tr>
                  <td colSpan={4} />
                  <td style={{ textAlign: 'right' }}>
                    <strong>Total</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong className="mono">{formatMoney(i.total)}</strong>
                  </td>
                </tr>
                <tr>
                  <td colSpan={4} />
                  <td style={{ textAlign: 'right' }}>Paid</td>
                  <td style={{ textAlign: 'right' }}>{formatMoney(i.paidTotal)}</td>
                </tr>
                <tr>
                  <td colSpan={4} />
                  <td style={{ textAlign: 'right' }}>
                    <strong>Balance</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong className="mono" style={{ color: i.balance > 0 ? 'var(--c-danger)' : 'var(--c-ok)' }}>
                      {formatMoney(i.balance)}
                    </strong>
                  </td>
                </tr>
              </tfoot>
            </table>
            {i.notes ? <p className="tiny muted" style={{ marginTop: 10 }}>Note: {i.notes}</p> : null}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Payments</h3>
            {perms.includes('invoice.create') && i.status !== 'void' ? (
              <Button size="sm" icon="plus" onClick={() => setPayOpen(true)}>
                Record payment
              </Button>
            ) : null}
          </div>
          <div className="card-body" style={{ paddingTop: 0 }}>
            {i.payments.length === 0 ? (
              <p className="tiny muted">No payments recorded yet.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {i.payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {formatDateTime(p.paidAt)}
                        <div className="cell-sub">{p.paymentNo}</div>
                      </td>
                      <td>{p.methodLabel}</td>
                      <td style={{ textAlign: 'right' }} className="mono">
                        {formatMoney(p.amount)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Button size="sm" variant="ghost" icon="user" onClick={() => navigate(`/patients/${p.patientId}`)} title="Patient" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <PrintPreviewModal open={printOpen} template="invoice" entityId={id} title={`Invoice ${i.invoiceNo}`} onClose={() => setPrintOpen(false)} />
      <RecordPaymentModal
        open={payOpen}
        patientId={i.patientId}
        invoiceId={i.id}
        balance={i.balance}
        onClose={() => setPayOpen(false)}
        onPaid={() => {
          setPayOpen(false);
          void inv.refetch();
        }}
      />
      <ConfirmDialog
        open={voidOpen}
        title="Void invoice"
        danger
        confirmLabel="Void invoice"
        requirePassword
        requirePhrase={i.invoiceNo}
        message={
          <>
            Voiding <strong>{i.invoiceNo}</strong> (total {formatMoney(i.total)}) keeps the record for audit but removes
            it from balances. Recorded payments remain. Type the invoice number to confirm.
          </>
        }
        onCancel={() => setVoidOpen(false)}
        onConfirm={async ({ password, phrase }) => {
          try {
            const res = await api('invoices.void', { id, password, confirmPhrase: phrase });
            if (res.ok) {
              toast.push({ kind: 'success', title: 'Invoice voided' });
              void inv.refetch();
            } else {
              toast.push({ kind: 'error', title: 'Void failed', msg: res.reason });
            }
          } catch (e) {
            toast.push({ kind: 'error', title: 'Void failed', msg: e instanceof Error ? e.message : undefined });
          }
          setVoidOpen(false);
        }}
      />
    </div>
  );
}

/* ================================ PAYMENTS ================================ */

export function RecordPaymentModal({
  open,
  patientId,
  invoiceId,
  balance,
  onClose,
  onPaid,
}: {
  open: boolean;
  patientId: number | null;
  invoiceId?: number;
  balance?: number;
  onClose: () => void;
  onPaid: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ patient: '', amount: '', method: 'cash', reference: '', notes: '', paidAt: todayIso() });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setForm({
        patient: patientId ? String(patientId) : '',
        amount: balance != null && balance > 0 ? balance.toFixed(2) : '',
        method: 'cash',
        reference: '',
        notes: '',
        paidAt: todayIso(),
      });
      setErrors({});
    }
  }, [open, patientId, balance]);

  const save = useApiMutation('payments.create', {
    onSuccess: (data) => {
      const res = data as { paymentNo: string; invoiceStatus?: string };
      toast.push({
        kind: 'success',
        title: `Payment ${res.paymentNo} recorded`,
        msg: res.invoiceStatus ? `Invoice now ${res.invoiceStatus}` : undefined,
      });
      onPaid();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Payment failed', msg: e.message }),
  });

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!form.patient) errs.patient = 'Select a patient';
    if (!(Number(form.amount) > 0)) errs.amount = 'Amount must be greater than 0';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      patientId: Number(form.patient),
      invoiceId: invoiceId ?? null,
      amount: Number(form.amount),
      methodCode: form.method as PaymentMethodCode,
      paidAt: form.paidAt,
      reference: form.reference || undefined,
      notes: form.notes || undefined,
    });
  };

  if (!open) return null;
  return (
    <Modal
      open
      title="Record payment"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="money" loading={save.isPending} onClick={submit}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Patient" required error={errors.patient} className="span-2">
          <PatientCombobox value={form.patient} placeholder="Search patient…" onChange={(v) => setForm((f) => ({ ...f, patient: v }))} />
        </Field>
        <Field label="Amount (৳)" required error={errors.amount}>
          <Input type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
        </Field>
        <Field label="Method">
          <Select
            value={form.method}
            onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
            options={METHOD_OPTIONS.filter((m) => m.value !== 'all')}
          />
        </Field>
        <Field label="Date">
          <Input type="date" value={form.paidAt} onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))} />
        </Field>
        <Field label="Reference" hint="Txn ID for mobile wallet">
          <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
        </Field>
        <Field label="Notes" className="span-2">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
        {invoiceId != null ? (
          <p className="tiny muted span-2">
            Applied to this invoice. Without an invoice, payment applies to the patient's open invoices (oldest first).
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export function PaymentsPage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const canSeeMoney = perms.includes('financial.view');
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [range, setRange] = useState<'today' | 'd7' | 'd30' | 'd365' | 'all'>('d30');
  const [method, setMethod] = useState<PaymentMethodCode | 'all'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [newOpen, setNewOpen] = useState(false);
  const [reverse, setReverse] = useState<PaymentDto | null>(null);

  const query: PaymentListQuery = useMemo(
    () => ({ q: q || undefined, range, methodCode: method, status: 'posted', page, pageSize }),
    [q, range, method, page, pageSize],
  );
  const list = useApi('payments.list', query, { staleTime: 3000 });
  const dash = useApi('payments.dashboard', { period: range }, { staleTime: 15_000 });
  useEffect(() => setPage(1), [q, range, method]);

  const cols: Column<PaymentDto>[] = [
    { key: 'no', header: 'Receipt', width: '130px', render: (p) => <span className="mono" style={{ fontWeight: 600 }}>{p.paymentNo}</span> },
    { key: 'date', header: 'Paid at', value: (p) => formatDateTime(p.paidAt) },
    {
      key: 'patient',
      header: 'Patient',
      render: (p) => (
        <div>
          <div className="cell-main">{p.patientName}</div>
          <div className="cell-sub">{p.invoiceNo ? `for ${p.invoiceNo}` : 'on account'}</div>
        </div>
      ),
    },
    { key: 'method', header: 'Method', value: (p) => p.methodLabel },
    { key: 'ref', header: 'Reference', value: (p) => p.reference || '—' },
    { key: 'by', header: 'Received by', value: (p) => p.receivedByName ?? '—' },
    { key: 'amount', header: 'Amount', align: 'num', render: (p) => <strong className="mono">{formatMoney(p.amount)}</strong> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (p) =>
        perms.includes('payment.delete') ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" icon="undo" onClick={() => setReverse(p)} title="Reverse payment" />
          </span>
        ) : null,
    },
  ];

  const exportCsv = async () => {
    try {
      const res = await api('export.csv', { kind: 'payments', range });
      if (res.ok) toast.push({ kind: 'success', title: `Exported ${res.rowCount ?? 0} rows`, msg: res.path });
      else if (!res.cancelled) toast.push({ kind: 'error', title: 'Export failed', msg: res.reason });
    } catch (e) {
      toast.push({ kind: 'error', title: 'Export failed', msg: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Payments"
        sub={list.data ? `${list.data.total} payments` : 'Payment ledger'}
        actions={
          <>
            <Button icon="download" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
            {perms.includes('payment.create') ? (
              <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>
                Record payment
              </Button>
            ) : null}
          </>
        }
      />

      {canSeeMoney && dash.data ? (
        <div className="stat-grid cols-4">
          <Stat label="Collected" value={formatMoney(dash.data.totalCollected)} icon="money" tone="ok" sub={`${dash.data.paymentCount} payments in period`} />
          <Stat label="Outstanding" value={formatMoney(dash.data.outstanding)} icon="wallet" tone="danger" sub="Unpaid invoice balances" />
          {dash.data.byMethod.slice(0, 2).map((m) => (
            <Stat key={m.code} label={m.label} value={formatMoney(m.total)} icon="card" tone="info" sub={`${m.count} payments`} />
          ))}
        </div>
      ) : null}

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search receipt, patient, invoice, reference…" />
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
        <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethodCode | 'all')} style={{ width: 150 }} options={METHOD_OPTIONS} />
      </div>

      <DataTable
        columns={cols}
        rows={list.data?.items ?? []}
        rowKey={(p) => p.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(p) => navigate(`/patients/${p.patientId}`)}
        empty={{
          title: 'No payments',
          desc: 'Recorded payments appear here with method, reference and audit trail.',
          icon: 'money',
          action: perms.includes('payment.create') ? (
            <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>
              Record payment
            </Button>
          ) : undefined,
        }}
        footer={
          list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} /> : null
        }
      />

      <RecordPaymentModal open={newOpen} patientId={null} onClose={() => setNewOpen(false)} onPaid={() => { setNewOpen(false); void list.refetch(); void dash.refetch(); }} />
      <ReversePaymentDialog payment={reverse} onClose={() => setReverse(null)} onDone={() => { setReverse(null); void list.refetch(); void dash.refetch(); }} />
    </div>
  );
}

function ReversePaymentDialog({ payment, onClose, onDone }: { payment: PaymentDto | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  if (!payment) return null;
  return (
    <ConfirmDialog
      open
      title="Reverse payment"
      danger
      confirmLabel="Reverse payment"
      requirePassword
      requirePhrase={payment.paymentNo}
      onCancel={onClose}
      onConfirm={async ({ password, phrase }) => {
        if (!reason.trim()) {
          toast.push({ kind: 'error', title: 'A reason is required for reversals' });
          return;
        }
        try {
          const res = await api('payments.reverse', { id: payment.id, password, confirmPhrase: phrase, reason: reason.trim() });
          if (res.ok) {
            toast.push({ kind: 'success', title: 'Payment reversed' });
            onDone();
          } else {
            toast.push({ kind: 'error', title: 'Reversal failed', msg: res.reason });
          }
        } catch (e) {
          toast.push({ kind: 'error', title: 'Reversal failed', msg: e instanceof Error ? e.message : undefined });
        }
        onClose();
      }}
      message={
        <div className="col" style={{ gap: 8 }}>
          <div>
            Reverse {formatMoney(payment.amount)} paid via {payment.methodLabel} on {formatDateTime(payment.paidAt)}?
            Reversals are permanent and audited.
          </div>
          <Field label="Reason (required)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong amount entered" />
          </Field>
        </div>
      }
    />
  );
}
