import React, { useEffect, useMemo, useState } from 'react';
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
  Input,
  LoadingState,
  Modal,
  PageHead,
  Pagination,
  Select,
  Stat,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from '../components/ui';
import { PrintPreviewModal } from '../components/PrintPreview';
import { formatDate, formatMoney, todayIso } from '@shared/format';
import type {
  AccountingCategoryDto,
  LedgerEntryDto,
  LedgerEntryInput,
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

const RANGE_OPTS = [
  { value: 'today', label: 'Today' },
  { value: 'd7', label: '7 days' },
  { value: 'd30', label: '30 days' },
  { value: 'd90', label: '90 days' },
  { value: 'd365', label: '1 year' },
  { value: 'all', label: 'All' },
];

/* ================================ ACCOUNTING ================================ */

export function AccountingPage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const canManage = perms.includes('accounting.manage');
  const canSee = perms.includes('financial.view');
  const toast = useToast();
  const [kind, setKind] = useState<'all' | 'income' | 'expense'>('all');
  const [range, setRange] = useState<'today' | 'd7' | 'd30' | 'd90' | 'd365' | 'all'>('d30');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [entryOpen, setEntryOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [reverse, setReverse] = useState<LedgerEntryDto | null>(null);

  const categories = useApi('accounting.categories', undefined, { staleTime: 60_000 });
  const query = useMemo(
    () => ({ kind: kind === 'all' ? undefined : kind, range, categoryId: categoryId ? Number(categoryId) : undefined, page, pageSize }),
    [kind, range, categoryId, page, pageSize],
  );
  const entries = useApi('accounting.entries', query, { staleTime: 3000, enabled: canSee });
  useEffect(() => setPage(1), [kind, range, categoryId]);

  if (!canSee) {
    return (
      <div className="page">
        <PageHead title="Accounting" sub="Restricted" />
        <EmptyState
          title="Financial access required"
          desc="Your role does not include the financial.view permission. Ask an administrator to update your role."
          icon="lock"
        />
      </div>
    );
  }

  const cols: Column<LedgerEntryDto>[] = [
    { key: 'date', header: 'Date', value: (e) => formatDate(e.paidAt) },
    {
      key: 'kind',
      header: 'Type',
      render: (e) => <Badge tone={e.kind === 'income' ? 'ok' : 'danger'}>{e.kind}</Badge>,
    },
    { key: 'cat', header: 'Category', value: (e) => e.categoryName },
    { key: 'method', header: 'Method', value: (e) => e.methodLabel },
    { key: 'ref', header: 'Reference', value: (e) => e.reference || '—' },
    { key: 'notes', header: 'Notes', value: (e) => e.notes || '—' },
    {
      key: 'amount',
      header: 'Amount',
      align: 'num',
      render: (e) => (
        <strong className="mono" style={{ color: e.kind === 'income' ? 'var(--c-ok)' : 'var(--c-danger)' }}>
          {e.kind === 'income' ? '+' : '−'}
          {formatMoney(e.amount)}
        </strong>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (e) =>
        canManage && e.status === 'posted' ? (
          <span onClick={(ev) => ev.stopPropagation()}>
            <Button size="sm" variant="ghost" icon="undo" title="Reverse entry" onClick={() => setReverse(e)} />
          </span>
        ) : e.status === 'reversed' ? (
          <Badge tone="neutral">reversed</Badge>
        ) : null,
    },
  ];

  const exportCsv = async () => {
    try {
      const res = await api('export.csv', { kind: 'accounting', range });
      if (res.ok) toast.push({ kind: 'success', title: `Exported ${res.rowCount ?? 0} rows`, msg: res.path });
      else if (!res.cancelled) toast.push({ kind: 'error', title: 'Export failed', msg: res.reason });
    } catch (e) {
      toast.push({ kind: 'error', title: 'Export failed', msg: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Accounting"
        sub="Income & expense ledger beyond patient billing"
        actions={
          <>
            <Button icon="download" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
            {canManage ? (
              <>
                <Button icon="tag" onClick={() => setCatsOpen(true)}>
                  Categories
                </Button>
                <Button variant="primary" icon="plus" onClick={() => setEntryOpen(true)}>
                  New entry
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="toolbar">
        <ChipRow
          options={[
            { value: 'all', label: 'All' },
            { value: 'income', label: 'Income' },
            { value: 'expense', label: 'Expense' },
          ]}
          value={kind}
          onChange={(v) => setKind(v as typeof kind)}
        />
        <ChipRow options={RANGE_OPTS} value={range} onChange={(v) => setRange(v as typeof range)} />
        <Select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          placeholder="Any category"
          style={{ width: 200 }}
          options={(categories.data ?? []).filter((c) => kind === 'all' || c.kind === kind).map((c) => ({ value: c.id, label: `${c.kind === 'income' ? '↓' : '↑'} ${c.name}` }))}
        />
      </div>

      <DataTable
        columns={cols}
        rows={entries.data?.items ?? []}
        rowKey={(e) => e.id}
        loading={entries.isLoading}
        error={entries.error}
        onRetry={() => void entries.refetch()}
        empty={{
          title: 'No ledger entries',
          desc: 'Record non-patient income and expenses (rent, utilities, supplies) for real profit tracking.',
          icon: 'book',
          action: canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setEntryOpen(true)}>
              New entry
            </Button>
          ) : undefined,
        }}
        footer={
          entries.data ? (
            <Pagination page={entries.data.page} pageSize={entries.data.pageSize} total={entries.data.total} onPage={setPage} onPageSize={setPageSize} />
          ) : null
        }
      />

      <LedgerEntryModal
        open={entryOpen}
        categories={categories.data ?? []}
        onClose={() => setEntryOpen(false)}
        onSaved={() => {
          setEntryOpen(false);
          void entries.refetch();
          void categories.refetch();
        }}
      />
      <CategoriesModal
        open={catsOpen}
        categories={categories.data ?? []}
        onClose={() => setCatsOpen(false)}
        onChanged={() => void categories.refetch()}
      />
      <ReverseEntryDialog entry={reverse} onClose={() => setReverse(null)} onDone={() => { setReverse(null); void entries.refetch(); }} />
    </div>
  );
}

function LedgerEntryModal({
  open,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  categories: AccountingCategoryDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    kind: 'expense' as 'income' | 'expense',
    categoryId: '',
    amount: '',
    methodCode: 'cash',
    paidAt: todayIso(),
    reference: '',
    notes: '',
  });

  useEffect(() => {
    if (open) setForm({ kind: 'expense', categoryId: '', amount: '', methodCode: 'cash', paidAt: todayIso(), reference: '', notes: '' });
  }, [open]);

  const save = useApiMutation('accounting.addEntry', {
    onSuccess: () => {
      toast.push({ kind: 'success', title: 'Ledger entry added' });
      onSaved();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', msg: e.message }),
  });

  if (!open) return null;
  const cats = categories.filter((c) => c.kind === form.kind && c.active);

  return (
    <Modal
      open
      title="New ledger entry"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="save"
            loading={save.isPending}
            onClick={() => {
              if (!form.categoryId || !(Number(form.amount) > 0)) {
                toast.push({ kind: 'error', title: 'Category and a positive amount are required' });
                return;
              }
              save.mutate({
                kind: form.kind,
                categoryId: Number(form.categoryId),
                amount: Number(form.amount),
                methodCode: form.methodCode as PaymentMethodCode,
                paidAt: form.paidAt,
                reference: form.reference || undefined,
                notes: form.notes || undefined,
              } satisfies LedgerEntryInput);
            }}
          >
            Add entry
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Type">
          <Select
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as 'income' | 'expense', categoryId: '' }))}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
            ]}
          />
        </Field>
        <Field label="Category" required>
          <Select
            value={form.categoryId}
            placeholder="Select…"
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
            options={cats.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field label="Amount (৳)" required>
          <Input type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
        </Field>
        <Field label="Method">
          <Select
            value={form.methodCode}
            onChange={(e) => setForm((f) => ({ ...f, methodCode: e.target.value }))}
            options={METHOD_OPTIONS.filter((m) => m.value !== 'all')}
          />
        </Field>
        <Field label="Date">
          <Input type="date" value={form.paidAt} onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))} />
        </Field>
        <Field label="Reference">
          <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
        </Field>
        <Field label="Notes" className="span-2">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
      </div>
    </Modal>
  );
}

function CategoriesModal({
  open,
  categories,
  onClose,
  onChanged,
}: {
  open: boolean;
  categories: AccountingCategoryDto[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'income' | 'expense'>('expense');

  const add = async () => {
    if (!name.trim()) return;
    try {
      await api('accounting.saveCategory', { kind, name: name.trim() });
      setName('');
      toast.push({ kind: 'success', title: 'Category added' });
      onChanged();
    } catch (e) {
      toast.push({ kind: 'error', title: 'Add failed', msg: e instanceof Error ? e.message : undefined });
    }
  };

  if (!open) return null;
  return (
    <Modal open title="Accounting categories" onClose={onClose} size="lg">
      <div className="row" style={{ gap: 8, marginBottom: 14, alignItems: 'flex-end' }}>
        <Field label="New category" style={{ flex: 1 }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marketing" />
        </Field>
        <Field label="Type">
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'income' | 'expense')}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
            ]}
            style={{ width: 140 }}
          />
        </Field>
        <Button variant="primary" icon="plus" onClick={() => void add()}>
          Add
        </Button>
      </div>
      <table className="data">
        <thead>
          <tr>
            <th>Type</th>
            <th>Name</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.id}>
              <td>
                <Badge tone={c.kind === 'income' ? 'ok' : 'danger'}>{c.kind}</Badge>
              </td>
              <td>{c.name}</td>
              <td>
                <Badge tone={c.active ? 'ok' : 'neutral'}>{c.active ? 'active' : 'inactive'}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function ReverseEntryDialog({ entry, onClose, onDone }: { entry: LedgerEntryDto | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  if (!entry) return null;
  return (
    <ConfirmDialog
      open
      title="Reverse ledger entry"
      danger
      confirmLabel="Reverse entry"
      requirePassword
      onCancel={onClose}
      onConfirm={async ({ password }) => {
        if (!reason.trim()) {
          toast.push({ kind: 'error', title: 'A reason is required' });
          return;
        }
        try {
          const res = await api('accounting.reverseEntry', { id: entry.id, password, reason: reason.trim() });
          if (res.ok) {
            toast.push({ kind: 'success', title: 'Entry reversed' });
            onDone();
          } else toast.push({ kind: 'error', title: 'Reversal failed', msg: res.reason });
        } catch (e) {
          toast.push({ kind: 'error', title: 'Reversal failed', msg: e instanceof Error ? e.message : undefined });
        }
        onClose();
      }}
      message={
        <div className="col" style={{ gap: 8 }}>
          <div>
            Reverse {entry.kind} of {formatMoney(entry.amount)} in “{entry.categoryName}”? This creates a compensating
            audit record.
          </div>
          <Field label="Reason (required)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      }
    />
  );
}

/* ================================ REPORTS ================================ */

export function ReportsPage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const canSee = perms.includes('financial.view');
  const toast = useToast();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayIso());
  const [tab, setTab] = useState<'summary' | 'treatments' | 'dentists' | 'methods' | 'balances'>('summary');
  const [printOpen, setPrintOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const enabled = canSee && from <= to;
  const summary = useApi('reports.summary', { from, to }, { enabled });
  const byTreatment = useApi('reports.byTreatment', { from, to }, { enabled: enabled && tab === 'treatments' });
  const byDentist = useApi('reports.byDentist', { from, to }, { enabled: enabled && tab === 'dentists' });
  const methods = useApi('reports.paymentMethods', { from, to }, { enabled: enabled && tab === 'methods' });
  const balances = useApi('reports.patientBalances', undefined, { enabled: enabled && tab === 'balances' });

  if (!canSee) {
    return (
      <div className="page">
        <PageHead title="Reports" sub="Restricted" />
        <EmptyState
          title="Financial access required"
          desc="Your role does not include the financial.view permission."
          icon="lock"
        />
      </div>
    );
  }

  const exportReport = async () => {
    setExporting(true);
    try {
      const res = await api('export.csv', { kind: 'invoices', from, to, range: 'custom' });
      if (res.ok) toast.push({ kind: 'success', title: `Exported ${res.rowCount ?? 0} rows`, msg: res.path });
      else if (!res.cancelled) toast.push({ kind: 'error', title: 'Export failed', msg: res.reason });
    } catch (e) {
      toast.push({ kind: 'error', title: 'Export failed', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setExporting(false);
    }
  };

  const s = summary.data;

  return (
    <div className="page">
      <PageHead
        title="Reports"
        sub="Financial & operational reporting from real data"
        actions={
          <>
            <Button icon="download" loading={exporting} onClick={() => void exportReport()}>
              Export invoices CSV
            </Button>
            <Button variant="primary" icon="print" disabled={!s} onClick={() => setPrintOpen(true)}>
              Print financial report
            </Button>
          </>
        }
      />

      <div className="toolbar">
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Button
          onClick={() => {
            const end = todayIso();
            const d = new Date();
            d.setDate(d.getDate() - 6);
            setFrom(d.toISOString().slice(0, 10));
            setTo(end);
          }}
        >
          Last 7 days
        </Button>
        <Button
          onClick={() => {
            const end = todayIso();
            const d = new Date();
            d.setDate(d.getDate() - 29);
            setFrom(d.toISOString().slice(0, 10));
            setTo(end);
          }}
        >
          Last 30 days
        </Button>
        <Button onClick={() => { const d = new Date(); d.setMonth(d.getMonth() - 1); setFrom(d.toISOString().slice(0, 10)); setTo(todayIso()); }}>
          Last month
        </Button>
        {from > to ? (
          <span className="tiny" style={{ color: 'var(--c-danger)' }}>
            From must be before To
          </span>
        ) : null}
      </div>

      <Tabs
        active={tab}
        onChange={(k) => setTab(k as typeof tab)}
        tabs={[
          { key: 'summary', label: 'Summary' },
          { key: 'treatments', label: 'By treatment' },
          { key: 'dentists', label: 'By dentist' },
          { key: 'methods', label: 'Payment methods' },
          { key: 'balances', label: 'Patient balances' },
        ]}
      />

      {summary.isLoading || !enabled ? (
        <LoadingState label={enabled ? 'Loading report…' : 'Select a valid date range'} />
      ) : summary.error ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : tab === 'summary' && s ? (
        <>
          <div className="stat-grid cols-4">
            <Stat label="Ledger income" value={formatMoney(s.income)} icon="arrowUp" tone="ok" sub={`${formatDate(s.from)} → ${formatDate(s.to)}`} />
            <Stat label="Ledger expenses" value={formatMoney(s.expense)} icon="arrowDown" tone="danger" />
            <Stat label="Net" value={formatMoney(s.net)} icon="wallet" tone={s.net >= 0 ? 'ok' : 'danger'} sub="Income − expenses" />
            <Stat label="Collected (payments)" value={formatMoney(s.collected)} icon="money" tone="info" sub={`Outstanding ${formatMoney(s.outstanding)}`} />
          </div>
          <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
            <div className="card">
              <div className="card-header">
                <h3>By category</h3>
              </div>
              <div className="card-body" style={{ paddingTop: 0 }}>
                {s.byCategory.length === 0 ? (
                  <p className="tiny muted">No ledger activity in this range.</p>
                ) : (
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Type</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.byCategory.map((c, i) => (
                        <tr key={i}>
                          <td>{c.name}</td>
                          <td>
                            <Badge tone={c.kind === 'income' ? 'ok' : 'danger'}>{c.kind}</Badge>
                          </td>
                          <td style={{ textAlign: 'right' }} className="mono">
                            {formatMoney(c.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            <div className="card card-pad">
              <h3 style={{ marginBottom: 10 }}>How numbers are computed</h3>
              <ul className="col" style={{ gap: 6, paddingLeft: 18, fontSize: 'var(--fs-sm)', color: 'var(--c-text-2)' }}>
                <li>
                  <strong>Ledger income / expense</strong> — accounting entries in the period (posted only; reversals
                  excluded).
                </li>
                <li>
                  <strong>Collected</strong> — posted patient payments in the period across all methods.
                </li>
                <li>
                  <strong>Outstanding</strong> — current unpaid balance across non-void invoices.
                </li>
                <li>
                  <strong>Net</strong> — ledger income − ledger expenses.
                </li>
              </ul>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                All values come from the local database — no sample or demo data is ever included.
              </p>
            </div>
          </div>
        </>
      ) : tab === 'treatments' ? (
        <ReportTable
          loading={byTreatment.isLoading}
          error={byTreatment.error}
          onRetry={() => void byTreatment.refetch()}
          head={['Treatment', 'Count', 'Revenue']}
          rows={(byTreatment.data ?? []).map((r) => [r.treatment, String(r.count), formatMoney(r.revenue)])}
          aligns={[undefined, 'right', 'right']}
          empty="No treatment revenue in this range."
        />
      ) : tab === 'dentists' ? (
        <ReportTable
          loading={byDentist.isLoading}
          error={byDentist.error}
          onRetry={() => void byDentist.refetch()}
          head={['Dentist', 'Visits', 'Revenue']}
          rows={(byDentist.data ?? []).map((r) => [r.dentist, String(r.visits), formatMoney(r.revenue)])}
          aligns={[undefined, 'right', 'right']}
          empty="No dentist revenue in this range."
        />
      ) : tab === 'methods' ? (
        <ReportTable
          loading={methods.isLoading}
          error={methods.error}
          onRetry={() => void methods.refetch()}
          head={['Method', 'Count', 'Total']}
          rows={(methods.data ?? []).map((r) => [r.label, String(r.count), formatMoney(r.total)])}
          aligns={[undefined, 'right', 'right']}
          empty="No payments in this range."
        />
      ) : (
        <ReportTable
          loading={balances.isLoading}
          error={balances.error}
          onRetry={() => void balances.refetch()}
          head={['Patient', 'Code', 'Billed', 'Paid', 'Balance']}
          rows={(balances.data ?? []).map((r) => [r.patientName, r.patientCode, formatMoney(r.billed), formatMoney(r.paid), formatMoney(r.balance)])}
          aligns={[undefined, undefined, 'right', 'right', 'right']}
          empty="No outstanding balances — all invoices are settled."
        />
      )}

      <PrintPreviewModal
        open={printOpen}
        template="financialReport"
        entityId={0}
        title="Financial report"
        range={{ from, to }}
        onClose={() => setPrintOpen(false)}
      />
    </div>
  );
}

function ReportTable({
  head,
  rows,
  aligns,
  loading,
  error,
  onRetry,
  empty,
}: {
  head: string[];
  rows: (string | undefined)[][];
  aligns: (('right' | undefined) | undefined)[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty: string;
}) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error as Error} onRetry={onRetry} />;
  if (!rows.length)
    return (
      <div className="card card-pad">
        <EmptyState title="Nothing to show" desc={empty} icon="barChart" />
      </div>
    );
  return (
    <div className="card card-pad" style={{ overflowX: 'auto' }}>
      <table className="data">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} style={aligns[i] === 'right' ? { textAlign: 'right' } : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} style={aligns[j] === 'right' ? { textAlign: 'right' } : undefined} className={aligns[j] === 'right' ? 'mono' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
