import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useApi, useApiMutation, useAppState } from '../lib/api';
import {
  Badge,
  Button,
  ChipRow,
  DataTable,
  Field,
  Input,
  Modal,
  PageHead,
  SearchBox,
  Select,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from '../components/ui';
import { formatDate, formatMoney } from '@shared/format';
import type { InventoryItemDto, InventoryItemInput, StockMoveInput, SupplierDto } from '@shared/contract';

/* ================================ INVENTORY ================================ */

export function InventoryPage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const canManage = perms.includes('inventory.manage');
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'out' | 'expiring'>(searchParams.get('filter') as never ?? 'all');
  const [tab, setTab] = useState<'items' | 'alerts' | 'moves'>('items');
  const [edit, setEdit] = useState<InventoryItemDto | 'new' | null>(null);
  const [moveItem, setMoveItem] = useState<InventoryItemDto | null>(null);

  const query = useMemo(() => ({ q: q || undefined, filter }), [q, filter]);
  const list = useApi('inventory.list', query, { staleTime: 3000 });
  const alerts = useApi('inventory.alerts', undefined, { staleTime: 15_000 });

  const items = list.data ?? [];

  const cols: Column<InventoryItemDto>[] = [
    { key: 'code', header: 'Code', width: '96px', render: (i) => <span className="mono">{i.code}</span> },
    {
      key: 'name',
      header: 'Item',
      render: (i) => (
        <div>
          <div className="cell-main">{i.name}</div>
          <div className="cell-sub">{i.category}{i.supplierName ? ` · ${i.supplierName}` : ''}</div>
        </div>
      ),
    },
    {
      key: 'stock',
      header: 'Stock',
      align: 'num',
      render: (i) => (
        <span style={{ color: i.currentStock <= 0 ? 'var(--c-danger)' : i.currentStock <= i.minStock ? 'var(--c-warn)' : 'inherit', fontWeight: 600 }}>
          {i.currentStock} {i.unit}
        </span>
      ),
    },
    { key: 'min', header: 'Min', align: 'num', value: (i) => `${i.minStock} ${i.unit}` },
    { key: 'cost', header: 'Cost (৳)', align: 'num', value: (i) => formatMoney(i.purchasePrice) },
    {
      key: 'expiry',
      header: 'Expiry',
      render: (i) =>
        i.nearestExpiry ? (
          <Badge tone={i.expirySoon ? 'warn' : 'neutral'}>{formatDate(i.nearestExpiry)}</Badge>
        ) : (
          '—'
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (i) =>
        canManage ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" icon="arrowUp" title="Stock movement" onClick={() => setMoveItem(i)} />
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(i)} />
          </span>
        ) : null,
    },
  ];

  return (
    <div className="page">
      <PageHead
        title="Inventory"
        sub={`${items.length} items · stock levels & expiry`}
        actions={
          canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>
              New item
            </Button>
          ) : null
        }
      />

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search item or code…" />
        <ChipRow
          options={[
            { value: 'all', label: 'All' },
            { value: 'low', label: 'Low stock' },
            { value: 'out', label: 'Out of stock' },
            { value: 'expiring', label: 'Expiring' },
          ]}
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
        />
        <span style={{ flex: 1 }} />
        <Tabs
          active={tab}
          onChange={(k) => setTab(k as typeof tab)}
          tabs={[
            { key: 'items', label: 'Items' },
            { key: 'alerts', label: 'Alerts', count: (alerts.data?.lowStock.length ?? 0) + (alerts.data?.expiringSoon.length ?? 0) },
          ]}
        />
      </div>

      {tab === 'items' ? (
        <DataTable
          columns={cols}
          rows={items}
          rowKey={(i) => i.id}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={(i) => (canManage ? setMoveItem(i) : undefined)}
          empty={{
            title: q ? `No items match “${q}”` : 'Inventory is empty',
            desc: 'Track consumables, materials and medicines with stock movements, batches and expiry alerts.',
            icon: 'package',
            action: canManage ? (
              <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>
                New item
              </Button>
            ) : undefined,
          }}
        />
      ) : (
        <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
          <div className="card">
            <div className="card-header">
              <h3>Low / out of stock</h3>
            </div>
            <div className="card-body" style={{ paddingTop: 0 }}>
              {!(alerts.data?.lowStock.length || alerts.data?.outOfStock.length) ? (
                <p className="tiny muted">All items above minimum.</p>
              ) : (
                [...(alerts.data?.outOfStock ?? []), ...(alerts.data?.lowStock ?? [])].map((i) => (
                  <div key={i.id} className="row" style={{ justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid var(--c-border-2)' }}>
                    <span>
                      {i.name} <span className="tiny muted mono">({i.code})</span>
                    </span>
                    <Badge tone={i.currentStock <= 0 ? 'danger' : 'warn'}>
                      {i.currentStock} / min {i.minStock} {i.unit}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <h3>Expiring / expired</h3>
            </div>
            <div className="card-body" style={{ paddingTop: 0 }}>
              {!(alerts.data?.expiringSoon.length || alerts.data?.expired.length) ? (
                <p className="tiny muted">Nothing expiring in the next 30 days.</p>
              ) : (
                <>
                  {alerts.data?.expiringSoon.map((i) => (
                    <div key={i.id} className="row" style={{ justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid var(--c-border-2)' }}>
                      <span>{i.name}</span>
                      <Badge tone="warn">expires {i.nearestExpiry ? formatDate(i.nearestExpiry) : 'soon'}</Badge>
                    </div>
                  ))}
                  {alerts.data?.expired.map((b) => (
                    <div key={b.id} className="row" style={{ justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid var(--c-border-2)' }}>
                      <span>Batch {b.batchNo ?? '—'}</span>
                      <Badge tone="danger">expired {b.expiryDate ? formatDate(b.expiryDate) : ''}</Badge>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <InventoryEditor
        target={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          void list.refetch();
          void alerts.refetch();
        }}
      />
      <StockMoveModal
        item={moveItem}
        onClose={() => setMoveItem(null)}
        onSaved={() => {
          setMoveItem(null);
          void list.refetch();
          void alerts.refetch();
        }}
      />
    </div>
  );
}

function InventoryEditor({
  target,
  onClose,
  onSaved,
}: {
  target: InventoryItemDto | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    code: '',
    name: '',
    category: '',
    unit: 'pcs',
    supplierId: '',
    purchasePrice: '0',
    usePrice: '0',
    openingStock: '0',
    minStock: '0',
    location: '',
    notes: '',
    active: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const suppliers = useApi('suppliers.list', undefined, { enabled: target != null, staleTime: 60_000 });

  useEffect(() => {
    setErrors({});
    if (target && target !== 'new') {
      setForm({
        code: target.code,
        name: target.name,
        category: target.category,
        unit: target.unit,
        supplierId: target.supplierId != null ? String(target.supplierId) : '',
        purchasePrice: String(target.purchasePrice),
        usePrice: String(target.usePrice),
        openingStock: String(target.openingStock),
        minStock: String(target.minStock),
        location: target.location ?? '',
        notes: target.notes ?? '',
        active: target.active,
      });
    } else if (target === 'new') {
      setForm({ code: '', name: '', category: '', unit: 'pcs', supplierId: '', purchasePrice: '0', usePrice: '0', openingStock: '0', minStock: '0', location: '', notes: '', active: true });
    }
  }, [target]);

  const save = useApiMutation('inventory.save', {
    onSuccess: () => {
      toast.push({ kind: 'success', title: 'Item saved' });
      onSaved();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', msg: e.message }),
  });

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!form.code.trim()) errs.code = 'Code required';
    if (!form.name.trim()) errs.name = 'Name required';
    if (!form.category.trim()) errs.category = 'Category required';
    if (!form.unit.trim()) errs.unit = 'Unit required';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      id: target && target !== 'new' ? target.id : undefined,
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category.trim(),
      unit: form.unit.trim(),
      supplierId: form.supplierId ? Number(form.supplierId) : null,
      purchasePrice: Number(form.purchasePrice) || 0,
      usePrice: Number(form.usePrice) || 0,
      openingStock: Number(form.openingStock) || 0,
      minStock: Number(form.minStock) || 0,
      location: form.location,
      notes: form.notes,
      active: form.active,
    } satisfies InventoryItemInput);
  };

  if (!target) return null;
  return (
    <Modal
      open
      title={target === 'new' ? 'New inventory item' : `Edit — ${target.name}`}
      onClose={onClose}
      size="lg"
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
          <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. MAT-001" />
        </Field>
        <Field label="Name" required error={errors.name}>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Category" required error={errors.category}>
          <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Composite" />
        </Field>
        <Field label="Unit" required error={errors.unit}>
          <Input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} placeholder="pcs / box / ml" />
        </Field>
        <Field label="Supplier">
          <Select
            value={form.supplierId}
            placeholder="None…"
            onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
            options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Shelf A2" />
        </Field>
        <Field label="Purchase price (৳)">
          <Input type="number" min={0} step="0.01" value={form.purchasePrice} onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))} />
        </Field>
        <Field label="Use price (৳)" hint="Billed to patient if used">
          <Input type="number" min={0} step="0.01" value={form.usePrice} onChange={(e) => setForm((f) => ({ ...f, usePrice: e.target.value }))} />
        </Field>
        <Field label={target === 'new' ? 'Opening stock' : 'Current stock (read-only)'}>
          <Input
            type="number"
            disabled={target !== 'new'}
            value={form.openingStock}
            onChange={(e) => setForm((f) => ({ ...f, openingStock: e.target.value }))}
          />
        </Field>
        <Field label="Minimum stock">
          <Input type="number" min={0} value={form.minStock} onChange={(e) => setForm((f) => ({ ...f, minStock: e.target.value }))} />
        </Field>
        <Field label="Notes" className="span-2">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
        <label className="checkbox-row span-2">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          Active
        </label>
      </div>
    </Modal>
  );
}

function StockMoveModal({ item, onClose, onSaved }: { item: InventoryItemDto | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ type: 'in' as StockMoveInput['type'], qty: '', batchNo: '', expiryDate: '', unitCost: '', note: '' });
  const batches = useApi('inventory.batches', { itemId: item?.id ?? 0 }, { enabled: item != null });

  useEffect(() => {
    if (item) setForm({ type: 'in', qty: '', batchNo: '', expiryDate: '', unitCost: '', note: '' });
  }, [item]);

  const save = useApiMutation('inventory.move', {
    onSuccess: (data) => {
      const res = data as { currentStock: number };
      toast.push({ kind: 'success', title: 'Stock updated', msg: `New level: ${res.currentStock} ${item?.unit ?? ''}` });
      onSaved();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Movement failed', msg: e.message }),
  });

  if (!item) return null;
  const submit = () => {
    if (!(Number(form.qty) > 0)) {
      toast.push({ kind: 'error', title: 'Quantity must be greater than 0' });
      return;
    }
    save.mutate({
      itemId: item.id,
      type: form.type,
      qty: Number(form.qty),
      batchNo: form.batchNo || undefined,
      expiryDate: form.expiryDate || null,
      unitCost: form.unitCost ? Number(form.unitCost) : undefined,
      note: form.note || undefined,
    });
  };

  return (
    <Modal
      open
      title={`Stock — ${item.name} (${item.currentStock} ${item.unit})`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="save" loading={save.isPending} onClick={submit}>
            Apply movement
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Movement type" required>
          <Select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as StockMoveInput['type'] }))}
            options={[
              { value: 'in', label: 'Stock in (purchase)' },
              { value: 'out', label: 'Stock out (use)' },
              { value: 'adjust', label: 'Adjustment' },
              { value: 'damaged', label: 'Damaged' },
              { value: 'expired', label: 'Expired' },
              { value: 'returned', label: 'Returned' },
            ]}
          />
        </Field>
        <Field label="Quantity" required>
          <Input type="number" min={0} step="1" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} autoFocus />
        </Field>
        <Field label="Batch no.">
          <Input value={form.batchNo} onChange={(e) => setForm((f) => ({ ...f, batchNo: e.target.value }))} />
        </Field>
        <Field label="Expiry date">
          <Input type="date" value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} />
        </Field>
        <Field label="Unit cost (৳)">
          <Input type="number" min={0} step="0.01" value={form.unitCost} onChange={(e) => setForm((f) => ({ ...f, unitCost: e.target.value }))} />
        </Field>
        <Field label="Note">
          <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </Field>
      </div>

      {(batches.data ?? []).length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ marginBottom: 6 }}>Batches</h4>
          <table className="data">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Expiry</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {(batches.data ?? []).map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.batchNo ?? '—'}</td>
                  <td>{b.expiryDate ? formatDate(b.expiryDate) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{b.qty}</td>
                  <td style={{ textAlign: 'right' }}>{b.unitCost != null ? formatMoney(b.unitCost) : '—'}</td>
                  <td>{formatDate(b.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Modal>
  );
}

/* ================================ SUPPLIERS ================================ */

export function SuppliersPage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const canManage = perms.includes('inventory.manage');
  const [edit, setEdit] = useState<SupplierDto | 'new' | null>(null);
  const list = useApi('suppliers.list', undefined, { staleTime: 10_000 });

  const cols: Column<SupplierDto>[] = [
    { key: 'name', header: 'Supplier', render: (s) => <strong>{s.name}</strong> },
    { key: 'contact', header: 'Contact person', value: (s) => s.contactPerson || '—' },
    { key: 'phone', header: 'Phone', value: (s) => s.phone || '—' },
    { key: 'email', header: 'Email', value: (s) => s.email || '—' },
    { key: 'purchases', header: 'Purchases', align: 'num', value: (s) => s.purchaseCount },
    { key: 'total', header: 'Total (৳)', align: 'num', value: (s) => formatMoney(s.totalPurchase) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) =>
        canManage ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(s)} />
            <Button
              size="sm"
              variant="ghost"
              icon="trash"
              onClick={() => {
                void api('suppliers.delete', { id: s.id }).then(() => void list.refetch());
              }}
            />
          </span>
        ) : null,
    },
  ];

  return (
    <div className="page">
      <PageHead
        title="Suppliers"
        sub={list.data ? `${list.data.length} suppliers` : 'Purchasing contacts'}
        actions={
          canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>
              New supplier
            </Button>
          ) : null
        }
      />
      <DataTable
        columns={cols}
        rows={list.data ?? []}
        rowKey={(s) => s.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(s) => (canManage ? setEdit(s) : undefined)}
        empty={{
          title: 'No suppliers',
          desc: 'Track suppliers to link inventory purchases and contact details.',
          icon: 'truck',
          action: canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>
              New supplier
            </Button>
          ) : undefined,
        }}
      />
      <SupplierEditor
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

function SupplierEditor({ target, onClose, onSaved }: { target: SupplierDto | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', contactPerson: '', phone: '', email: '', address: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setErrors({});
    if (target && target !== 'new') {
      setForm({
        name: target.name,
        contactPerson: target.contactPerson ?? '',
        phone: target.phone ?? '',
        email: target.email ?? '',
        address: target.address ?? '',
        notes: target.notes ?? '',
      });
    } else if (target === 'new') {
      setForm({ name: '', contactPerson: '', phone: '', email: '', address: '', notes: '' });
    }
  }, [target]);

  const save = useApiMutation('suppliers.save', {
    onSuccess: () => {
      toast.push({ kind: 'success', title: 'Supplier saved' });
      onSaved();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', msg: e.message }),
  });

  if (!target) return null;
  return (
    <Modal
      open
      title={target === 'new' ? 'New supplier' : `Edit — ${target.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="save"
            loading={save.isPending}
            onClick={() => {
              if (!form.name.trim()) {
                setErrors({ name: 'Name required' });
                return;
              }
              save.mutate({ id: target !== 'new' ? target.id : undefined, ...form });
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" required error={errors.name} className="span-2">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Contact person">
          <Input value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </Field>
        <Field label="Email">
          <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        <Field label="Address">
          <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        </Field>
        <Field label="Notes" className="span-2">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
      </div>
    </Modal>
  );
}
