import React, { useEffect, useState } from 'react';
import { api, useApi, useApiMutation, useAppState } from '../lib/api';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  PageHead,
  Select,
  Tabs,
  Textarea,
  useToast,
} from '../components/ui';
import { formatDateTime } from '@shared/format';
import type { ClinicInput, ExportKind, PrinterProfileDto, PrinterProfileInput } from '@shared/contract';

type TabKey = 'clinic' | 'preferences' | 'printers' | 'security' | 'data';

export function SettingsPage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const canManage = perms.includes('settings.manage');
  const [tab, setTab] = useState<TabKey>('clinic');

  return (
    <div className="page">
      <PageHead
        title="Settings"
        sub="Clinic identity, preferences, printers, security and data"
        actions={
          !canManage ? (
            <Badge tone="warn">Read-only — settings.manage required to edit</Badge>
          ) : null
        }
      />
      <Tabs
        active={tab}
        onChange={(k) => setTab(k as TabKey)}
        tabs={[
          { key: 'clinic', label: 'Clinic' },
          { key: 'preferences', label: 'Preferences' },
          { key: 'printers', label: 'Printer profiles' },
          { key: 'security', label: 'Security' },
          { key: 'data', label: 'Data & export' },
        ]}
      />
      {tab === 'clinic' ? <ClinicSection canManage={canManage} /> : null}
      {tab === 'preferences' ? <PreferencesSection canManage={canManage} /> : null}
      {tab === 'printers' ? <PrintersSection canManage={canManage} /> : null}
      {tab === 'security' ? <SecuritySection canManage={canManage} /> : null}
      {tab === 'data' ? <DataSection /> : null}
    </div>
  );
}

/* ------------------------------- clinic ------------------------------- */

function ClinicSection({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const clinic = useApi('clinic.get', undefined, { staleTime: 15_000 });
  const [form, setForm] = useState<ClinicInput>({ name: '' });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    if (clinic.data) {
      const { id, ...rest } = clinic.data as ClinicInput & { id: number };
      void id;
      setForm(rest);
      setLogoPreview(rest.logoPath ?? null);
    }
  }, [clinic.data]);

  const save = useApiMutation('clinic.update', {
    onSuccess: () => {
      toast.push({ kind: 'success', title: 'Clinic profile saved' });
      void clinic.refetch();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', msg: e.message }),
  });

  if (clinic.isLoading) return <div className="card card-pad">Loading…</div>;
  if (clinic.error) return <div className="alert alert-danger">Could not load clinic profile.</div>;

  const days = form.closingDays ?? [];
  const set = (k: keyof ClinicInput, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="col">
      <div className="card card-pad">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h3>Clinic identity</h3>
          <Button variant="primary" icon="save" loading={save.isPending} disabled={!canManage} onClick={() => save.mutate(form)}>
            Save clinic
          </Button>
        </div>
        <div className="form-grid">
          <Field label="Clinic name" required className="span-2">
            <Input disabled={!canManage} value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Address" className="span-2">
            <Textarea disabled={!canManage} rows={2} value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input disabled={!canManage} value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Alternate phone">
            <Input disabled={!canManage} value={form.altPhone ?? ''} onChange={(e) => set('altPhone', e.target.value)} />
          </Field>
          <Field label="Email">
            <Input disabled={!canManage} value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Website">
            <Input disabled={!canManage} value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} />
          </Field>
          <Field label="Opening hours" hint="Shown on printed prescriptions & invoices">
            <Input disabled={!canManage} value={form.openingHours ?? ''} onChange={(e) => set('openingHours', e.target.value)} />
          </Field>
          <Field label="Emergency contact">
            <Input disabled={!canManage} value={form.emergencyContact ?? ''} onChange={(e) => set('emergencyContact', e.target.value)} />
          </Field>
          <Field label="Prescription footer message">
            <Input disabled={!canManage} value={form.prescriptionMessage ?? ''} onChange={(e) => set('prescriptionMessage', e.target.value)} />
          </Field>
          <Field label="Invoice footer note">
            <Input disabled={!canManage} value={form.footerMessage ?? ''} onChange={(e) => set('footerMessage', e.target.value)} />
          </Field>
          <Field label="Timezone">
            <Select
              disabled={!canManage}
              value={form.timezone ?? 'Asia/Dhaka'}
              onChange={(e) => set('timezone', e.target.value)}
              options={[
                { value: 'Asia/Dhaka', label: 'Asia/Dhaka (Bangladesh)' },
                { value: 'Asia/Kolkata', label: 'Asia/Kolkata (India)' },
                { value: 'UTC', label: 'UTC' },
              ]}
            />
          </Field>
          <Field label="Closing days">
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                <label key={d} className="chip" style={{ cursor: canManage ? 'pointer' : 'not-allowed', ...(days.includes(i) ? { background: 'var(--c-primary-soft)', borderColor: 'var(--c-primary)' } : {}) }}>
                  <input
                    type="checkbox"
                    disabled={!canManage}
                    checked={days.includes(i)}
                    onChange={(e) => set('closingDays', e.target.checked ? [...days, i] : days.filter((x) => x !== i))}
                    style={{ display: 'none' }}
                  />
                  {d}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Logo" hint="PNG/JPEG ≤ 2MB — appears on prints">
            <div className="row" style={{ gap: 10 }}>
              <input
                type="file"
                accept="image/png,image/jpeg"
                disabled={!canManage}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 2 * 1024 * 1024) {
                    toast.push({ kind: 'error', title: 'Logo must be 2MB or smaller' });
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    const dataUrl = String(reader.result);
                    setLogoPreview(dataUrl);
                    set('logoData', dataUrl);
                  };
                  reader.readAsDataURL(f);
                }}
              />
              {logoPreview ? <img alt="logo" src={logoPreview} style={{ height: 44, borderRadius: 6, border: '1px solid var(--c-border)' }} /> : null}
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- preferences ------------------------------- */

function PreferencesSection({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const all = useApi('settings.get', undefined, { staleTime: 10_000 });

  const [appearance, setAppearance] = useState<Record<string, unknown>>({});
  const [general, setGeneral] = useState<Record<string, unknown>>({});
  const [appointments, setAppointments] = useState<Record<string, unknown>>({});
  const [invoice, setInvoice] = useState<Record<string, unknown>>({});
  const [notifications, setNotifications] = useState<Record<string, unknown>>({});
  const [backup, setBackup] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!all.data) return;
    setAppearance((all.data.appearance as Record<string, unknown>) ?? {});
    setGeneral((all.data.general as Record<string, unknown>) ?? {});
    setAppointments((all.data.appointments as Record<string, unknown>) ?? {});
    setInvoice((all.data.invoice as Record<string, unknown>) ?? {});
    setNotifications((all.data.notifications as Record<string, unknown>) ?? {});
    setBackup((all.data.backup as Record<string, unknown>) ?? {});
  }, [all.data]);

  const groups: { key: string; label: string; state: Record<string, unknown>; set: React.Dispatch<React.SetStateAction<Record<string, unknown>>> }[] = [
    { key: 'appearance', label: 'Appearance', state: appearance, set: setAppearance },
    { key: 'general', label: 'General', state: general, set: setGeneral },
    { key: 'appointments', label: 'Appointments', state: appointments, set: setAppointments },
    { key: 'invoice', label: 'Invoices', state: invoice, set: setInvoice },
    { key: 'notifications', label: 'Notifications', state: notifications, set: setNotifications },
    { key: 'backup', label: 'Backup schedule', state: backup, set: setBackup },
  ];

  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const saveGroup = async (g: (typeof groups)[number]) => {
    setSavingGroup(g.key);
    try {
      await api('settings.set', { group: g.key, values: g.state });
      toast.push({ kind: 'success', title: `${g.label} settings saved` });
      void all.refetch();
    } catch (e) {
      toast.push({ kind: 'error', title: 'Save failed', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setSavingGroup(null);
    }
  };

  if (all.isLoading) return <div className="card card-pad">Loading…</div>;


  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
      <div className="card card-pad">
        <h3 style={{ marginBottom: 12 }}>Appearance</h3>
        <div className="form-grid">
          <Field label="Theme">
            <Select
              disabled={!canManage}
              value={String(appearance.theme ?? 'light')}
              onChange={(e) => setAppearance((s) => ({ ...s, theme: e.target.value }))}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
            />
          </Field>
          <Field label="Density">
            <Select
              disabled={!canManage}
              value={String(appearance.density ?? 'comfortable')}
              onChange={(e) => setAppearance((s) => ({ ...s, density: e.target.value }))}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          </Field>
        </div>
        <RowSave canManage={canManage} saving={savingGroup === 'appearance'} onClick={() => void saveGroup(groups[0])} />
      </div>

      <div className="card card-pad">
        <h3 style={{ marginBottom: 12 }}>General</h3>
        <div className="form-grid">
          <Field label="Patient code prefix">
            <Input disabled={!canManage} value={String(general.patientCodePrefix ?? 'P')} onChange={(e) => setGeneral((s) => ({ ...s, patientCodePrefix: e.target.value }))} />
          </Field>
          <Field label="Patient code digits">
            <Input
              disabled={!canManage}
              type="number"
              min={3}
              max={10}
              value={String(general.patientCodeDigits ?? 5)}
              onChange={(e) => setGeneral((s) => ({ ...s, patientCodeDigits: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Date format">
            <Select
              disabled={!canManage}
              value={String(general.dateFormat ?? 'short')}
              onChange={(e) => setGeneral((s) => ({ ...s, dateFormat: e.target.value }))}
              options={[
                { value: 'short', label: 'DD/MM/YYYY' },
                { value: 'long', label: 'DD Month YYYY' },
              ]}
            />
          </Field>
          <Field label="Interface language" hint="English UI; Bengali content is supported everywhere">
            <Select
              disabled={!canManage}
              value={String(general.language ?? 'en')}
              onChange={(e) => setGeneral((s) => ({ ...s, language: e.target.value }))}
              options={[{ value: 'en', label: 'English' }]}
            />
          </Field>
        </div>
        <RowSave canManage={canManage} saving={savingGroup === 'general'} onClick={() => void saveGroup(groups[1])} />
        <div style={{ borderTop: '1px solid var(--c-border-2)', marginTop: 14, paddingTop: 12 }}>
          <h3 style={{ marginBottom: 10 }}>Invoices</h3>
          <div className="form-grid">
            <Field label="Invoice prefix">
              <Input disabled={!canManage} value={String(invoice.prefix ?? 'INV-')} onChange={(e) => setInvoice((s) => ({ ...s, prefix: e.target.value }))} />
            </Field>
            <Field label="Tax rate %">
              <Input
                disabled={!canManage}
                type="number"
                step="0.1"
                value={String(invoice.taxRate ?? 0)}
                onChange={(e) => setInvoice((s) => ({ ...s, taxRate: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Footer note" className="span-2">
              <Input disabled={!canManage} value={String(invoice.footerNote ?? '')} onChange={(e) => setInvoice((s) => ({ ...s, footerNote: e.target.value }))} />
            </Field>
          </div>
          <RowSave canManage={canManage} saving={savingGroup === 'invoice'} onClick={() => void saveGroup(groups[3])} />
        </div>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginBottom: 12 }}>Appointments</h3>
        <div className="form-grid">
          <Field label="Default duration (min)">
            <Input
              disabled={!canManage}
              type="number"
              value={String(appointments.defaultDurationMin ?? 30)}
              onChange={(e) => setAppointments((s) => ({ ...s, defaultDurationMin: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Slot interval (min)">
            <Input
              disabled={!canManage}
              type="number"
              value={String(appointments.slotIntervalMin ?? 15)}
              onChange={(e) => setAppointments((s) => ({ ...s, slotIntervalMin: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Work start">
            <Input disabled={!canManage} type="time" value={String(appointments.workStart ?? '09:00')} onChange={(e) => setAppointments((s) => ({ ...s, workStart: e.target.value }))} />
          </Field>
          <Field label="Work end">
            <Input disabled={!canManage} type="time" value={String(appointments.workEnd ?? '21:00')} onChange={(e) => setAppointments((s) => ({ ...s, workEnd: e.target.value }))} />
          </Field>
        </div>
        <RowSave canManage={canManage} saving={savingGroup === 'appointments'} onClick={() => void saveGroup(groups[2])} />
      </div>

      <div className="card card-pad">
        <h3 style={{ marginBottom: 12 }}>Notifications & backup</h3>
        <div className="col" style={{ gap: 8, marginBottom: 10 }}>
          {(
            [
              ['lowStockEnabled', 'Low stock alerts'],
              ['appointmentReminders', 'Appointment reminders'],
              ['backupReminders', 'Backup reminders'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="checkbox-row">
              <input
                type="checkbox"
                disabled={!canManage}
                checked={Boolean(notifications[k])}
                onChange={(e) => setNotifications((s) => ({ ...s, [k]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
          <div className="form-grid" style={{ marginTop: 6 }}>
            <Field label="Expiry warning (days)">
              <Input
                disabled={!canManage}
                type="number"
                value={String(notifications.expiryDays ?? 30)}
                onChange={(e) => setNotifications((s) => ({ ...s, expiryDays: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Unpaid invoice alert (days)">
              <Input
                disabled={!canManage}
                type="number"
                value={String(notifications.unpaidInvoiceDays ?? 7)}
                onChange={(e) => setNotifications((s) => ({ ...s, unpaidInvoiceDays: Number(e.target.value) }))}
              />
            </Field>
          </div>
        </div>
        <RowSave canManage={canManage} saving={savingGroup === 'notifications'} onClick={() => void saveGroup(groups[4])} />
        <div style={{ borderTop: '1px solid var(--c-border-2)', marginTop: 14, paddingTop: 12 }}>
          <div className="form-grid">
            <Field label="Auto backup every (days)" hint="0 disables auto backup">
              <Select
                disabled={!canManage}
                value={String(backup.autoEveryDays ?? 0)}
                onChange={(e) => setBackup((s) => ({ ...s, autoEveryDays: Number(e.target.value) }))}
                options={[
                  { value: '0', label: 'Off' },
                  { value: '7', label: 'Every 7 days' },
                  { value: '15', label: 'Every 15 days' },
                  { value: '30', label: 'Every 30 days' },
                ]}
              />
            </Field>
            <Field label="Keep last N backups">
              <Input
                disabled={!canManage}
                type="number"
                min={1}
                max={100}
                value={String(backup.keepCount ?? 10)}
                onChange={(e) => setBackup((s) => ({ ...s, keepCount: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <RowSave canManage={canManage} saving={savingGroup === 'backup'} onClick={() => void saveGroup(groups[5])} />
          {backup.lastSuccessAt ? <p className="tiny muted">Last auto backup: {formatDateTime(String(backup.lastSuccessAt))}</p> : null}
        </div>
      </div>
    </div>
  );
}

function RowSave({ canManage, saving, onClick }: { canManage: boolean; saving: boolean; onClick: () => void }) {
  return (
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
      <Button size="sm" variant="primary" icon="save" disabled={!canManage} loading={saving} onClick={onClick}>
        Save
      </Button>
    </div>
  );
}

/* ------------------------------- printers ------------------------------- */

const PAPER_SIZES: { value: PrinterProfileDto['paperSize']; label: string; w: number; h: number }[] = [
  { value: 'A4', label: 'A4 (210 × 297 mm)', w: 210, h: 297 },
  { value: 'A5', label: 'A5 (148 × 210 mm)', w: 148, h: 210 },
  { value: '80mm', label: 'Thermal 80 mm', w: 80, h: 200 },
  { value: '58mm', label: 'Thermal 58 mm', w: 58, h: 200 },
  { value: 'custom', label: 'Custom', w: 210, h: 297 },
];

function PrintersSection({ canManage }: { canManage: boolean }) {
  const profiles = useApi('printers.profiles', undefined, { staleTime: 5000 });
  const system = useApi('printers.systemPrinters', undefined, { staleTime: 60_000 });
  const [edit, setEdit] = useState<PrinterProfileDto | 'new' | null>(null);

  return (
    <div className="col">
      <div className="card">
        <div className="card-header">
          <h3>Paper profiles</h3>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" icon="refresh" onClick={() => void system.refetch()}>
              Detect printers
            </Button>
            {canManage ? (
              <Button size="sm" variant="primary" icon="plus" onClick={() => setEdit('new')}>
                New profile
              </Button>
            ) : null}
          </div>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          {(profiles.data ?? []).length === 0 ? (
            <EmptyState title="No profiles" desc="Create A4, A5 or thermal receipt profiles for different outputs." icon="printer" />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Paper</th>
                  <th>Size</th>
                  <th>Margins (mm)</th>
                  <th>Scale</th>
                  <th>Printer</th>
                  <th>Default</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(profiles.data ?? []).map((p) => (
                  <tr key={p.id}>
                    <td className="cell-main">{p.name}</td>
                    <td>{p.paperSize}</td>
                    <td className="mono">
                      {p.widthMm}×{p.heightMm}
                      {p.orientation === 'landscape' ? ' ◻' : ''}
                    </td>
                    <td className="mono">
                      {p.marginTop}/{p.marginRight}/{p.marginBottom}/{p.marginLeft}
                    </td>
                    <td>{p.scale}%</td>
                    <td>{p.printerName ?? 'System dialog'}</td>
                    <td>{p.isDefault ? <Badge tone="ok">default</Badge> : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canManage ? (
                        <>
                          <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(p)} />
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="trash"
                            onClick={() => {
                              void api('printers.deleteProfile', { id: p.id }).then(() => void profiles.refetch());
                            }}
                          />
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginBottom: 8 }}>Detected printers</h3>
        {(system.data ?? []).length === 0 ? (
          <p className="tiny muted">No printers detected by the operating system. You can still save PDFs.</p>
        ) : (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {(system.data ?? []).map((p) => (
              <span key={p.name} className="chip">
                {p.name} {p.isDefault ? '(default)' : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      <PrinterEditor
        target={edit}
        systemPrinters={system.data ?? []}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          void profiles.refetch();
        }}
      />
    </div>
  );
}

function PrinterEditor({
  target,
  systemPrinters,
  onClose,
  onSaved,
}: {
  target: PrinterProfileDto | 'new' | null;
  systemPrinters: { name: string; isDefault: boolean }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    printerName: '',
    paperSize: 'A4' as PrinterProfileDto['paperSize'],
    widthMm: '210',
    heightMm: '297',
    marginTop: '8',
    marginRight: '8',
    marginBottom: '8',
    marginLeft: '8',
    orientation: 'portrait' as 'portrait' | 'landscape',
    scale: '100',
    copies: '1',
    isDefault: false,
  });

  useEffect(() => {
    if (target && target !== 'new') {
      setForm({
        name: target.name,
        printerName: target.printerName ?? '',
        paperSize: target.paperSize,
        widthMm: String(target.widthMm),
        heightMm: String(target.heightMm),
        marginTop: String(target.marginTop),
        marginRight: String(target.marginRight),
        marginBottom: String(target.marginBottom),
        marginLeft: String(target.marginLeft),
        orientation: target.orientation,
        scale: String(target.scale),
        copies: String(target.copies),
        isDefault: target.isDefault,
      });
    } else if (target === 'new') {
      setForm({ name: '', printerName: '', paperSize: 'A4', widthMm: '210', heightMm: '297', marginTop: '8', marginRight: '8', marginBottom: '8', marginLeft: '8', orientation: 'portrait', scale: '100', copies: '1', isDefault: false });
    }
  }, [target]);

  const save = useApiMutation('printers.saveProfile', {
    onSuccess: () => {
      toast.push({ kind: 'success', title: 'Profile saved' });
      onSaved();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', msg: e.message }),
  });

  if (!target) return null;
  return (
    <Modal
      open
      title={target === 'new' ? 'New printer profile' : `Edit — ${target.name}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="save"
            loading={save.isPending}
            onClick={() => {
              if (!form.name.trim()) {
                toast.push({ kind: 'error', title: 'Profile name required' });
                return;
              }
              save.mutate({
                id: target !== 'new' ? target.id : undefined,
                name: form.name.trim(),
                printerName: form.printerName || null,
                paperSize: form.paperSize,
                widthMm: Number(form.widthMm),
                heightMm: Number(form.heightMm),
                marginTop: Number(form.marginTop),
                marginRight: Number(form.marginRight),
                marginBottom: Number(form.marginBottom),
                marginLeft: Number(form.marginLeft),
                orientation: form.orientation,
                scale: Number(form.scale),
                copies: Number(form.copies),
                isDefault: form.isDefault,
              } satisfies PrinterProfileInput);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Profile name" required>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Receipt — 80mm" />
        </Field>
        <Field label="Printer" hint="Leave empty to use the system print dialog">
          <Select
            value={form.printerName}
            placeholder="System dialog…"
            onChange={(e) => setForm((f) => ({ ...f, printerName: e.target.value }))}
            options={systemPrinters.map((p) => ({ value: p.name, label: p.name }))}
          />
        </Field>
        <Field label="Paper size">
          <Select
            value={form.paperSize}
            onChange={(e) => {
              const v = e.target.value as PrinterProfileDto['paperSize'];
              const preset = PAPER_SIZES.find((s) => s.value === v);
              setForm((f) => ({ ...f, paperSize: v, widthMm: String(preset?.w ?? f.widthMm), heightMm: String(preset?.h ?? f.heightMm) }));
            }}
            options={PAPER_SIZES.map((s) => ({ value: s.value, label: s.label }))}
          />
        </Field>
        <Field label="Orientation">
          <Select
            value={form.orientation}
            onChange={(e) => setForm((f) => ({ ...f, orientation: e.target.value as 'portrait' | 'landscape' }))}
            options={[
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
            ]}
          />
        </Field>
        <Field label="Width (mm)">
          <Input type="number" value={form.widthMm} onChange={(e) => setForm((f) => ({ ...f, widthMm: e.target.value }))} />
        </Field>
        <Field label="Height (mm)">
          <Input type="number" value={form.heightMm} onChange={(e) => setForm((f) => ({ ...f, heightMm: e.target.value }))} />
        </Field>
        <Field label="Margin top (mm)">
          <Input type="number" value={form.marginTop} onChange={(e) => setForm((f) => ({ ...f, marginTop: e.target.value }))} />
        </Field>
        <Field label="Margin right (mm)">
          <Input type="number" value={form.marginRight} onChange={(e) => setForm((f) => ({ ...f, marginRight: e.target.value }))} />
        </Field>
        <Field label="Margin bottom (mm)">
          <Input type="number" value={form.marginBottom} onChange={(e) => setForm((f) => ({ ...f, marginBottom: e.target.value }))} />
        </Field>
        <Field label="Margin left (mm)">
          <Input type="number" value={form.marginLeft} onChange={(e) => setForm((f) => ({ ...f, marginLeft: e.target.value }))} />
        </Field>
        <Field label="Scale %">
          <Input type="number" min={50} max={200} value={form.scale} onChange={(e) => setForm((f) => ({ ...f, scale: e.target.value }))} />
        </Field>
        <Field label="Copies">
          <Input type="number" min={1} max={20} value={form.copies} onChange={(e) => setForm((f) => ({ ...f, copies: e.target.value }))} />
        </Field>
        <label className="checkbox-row span-2">
          <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))} />
          Default profile for printing
        </label>
      </div>
    </Modal>
  );
}

/* ------------------------------- security ------------------------------- */

function SecuritySection({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const security = useApi('settings.get', { group: 'security' }, { staleTime: 10_000 });
  const [form, setForm] = useState<Record<string, number | boolean>>({});
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [resetOpen, setResetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (security.data?.security) setForm(security.data.security as Record<string, number | boolean>);
  }, [security.data]);

  const changePassword = async () => {
    if (pw.next.length < 8) return toast.push({ kind: 'error', title: 'New password must be at least 8 characters' });
    if (pw.next !== pw.confirm) return toast.push({ kind: 'error', title: 'New passwords do not match' });
    try {
      const res = await api('auth.changePassword', { currentPassword: pw.current, newPassword: pw.next });
      if (res.ok) {
        toast.push({ kind: 'success', title: 'Password changed' });
        setPw({ current: '', next: '', confirm: '' });
      } else {
        toast.push({ kind: 'error', title: 'Change failed', msg: res.reason });
      }
    } catch (e) {
      toast.push({ kind: 'error', title: 'Change failed', msg: e instanceof Error ? e.message : undefined });
    }
  };

  const saveSecurity = async () => {
    setSaving(true);
    try {
      await api('settings.set', { group: 'security', values: form });
      toast.push({ kind: 'success', title: 'Security settings saved' });
      void security.refetch();
    } catch (e) {
      toast.push({ kind: 'error', title: 'Save failed', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
      <div className="card card-pad">
        <h3 style={{ marginBottom: 12 }}>Change my password</h3>
        <div className="col" style={{ gap: 'var(--sp-3)' }}>
          <Field label="Current password" required>
            <Input type="password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} autoComplete="current-password" />
          </Field>
          <Field label="New password" required hint="8+ characters with letter and number">
            <Input type="password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" required>
            <Input type="password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} autoComplete="new-password" />
          </Field>
          <Button variant="primary" icon="key" onClick={() => void changePassword()}>
            Change password
          </Button>
        </div>
      </div>

      <div className="card card-pad">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h3>Security policy</h3>
          <Button size="sm" variant="danger" icon="refresh" disabled={!canManage} onClick={() => setResetOpen(true)}>
            Reset to defaults
          </Button>
        </div>
        <div className="form-grid">
          <Field label="Auto-lock after (min)" hint="0 only if policy allows">
            <Input
              disabled={!canManage}
              type="number"
              value={String(form.autoLockMinutes ?? 10)}
              onChange={(e) => setForm((f) => ({ ...f, autoLockMinutes: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Max login attempts">
            <Input
              disabled={!canManage}
              type="number"
              value={String(form.maxLoginAttempts ?? 5)}
              onChange={(e) => setForm((f) => ({ ...f, maxLoginAttempts: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Lockout duration (min)">
            <Input
              disabled={!canManage}
              type="number"
              value={String(form.lockoutMinutes ?? 15)}
              onChange={(e) => setForm((f) => ({ ...f, lockoutMinutes: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Min password length">
            <Input
              disabled={!canManage}
              type="number"
              value={String(form.passwordMinLength ?? 8)}
              onChange={(e) => setForm((f) => ({ ...f, passwordMinLength: Number(e.target.value) }))}
            />
          </Field>
          <label className="checkbox-row span-2">
            <input
              type="checkbox"
              disabled={!canManage}
              checked={Boolean(form.passwordRequireLetter)}
              onChange={(e) => setForm((f) => ({ ...f, passwordRequireLetter: e.target.checked }))}
            />
            Require letter in passwords
          </label>
          <label className="checkbox-row span-2">
            <input
              type="checkbox"
              disabled={!canManage}
              checked={Boolean(form.passwordRequireNumber)}
              onChange={(e) => setForm((f) => ({ ...f, passwordRequireNumber: e.target.checked }))}
            />
            Require number in passwords
          </label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <Button variant="primary" icon="save" disabled={!canManage} loading={saving} onClick={() => void saveSecurity()}>
            Save policy
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        title="Reset security settings"
        danger
        confirmLabel="Reset settings"
        requirePassword
        message={
          <>
            Restore all security settings (auto-lock, attempts, password policy) to factory defaults? Your current
            password is <strong>not</strong> changed.
          </>
        }
        onCancel={() => setResetOpen(false)}
        onConfirm={async ({ password }) => {
          try {
            const res = await api('settings.resetSecurity', { password });
            if (res.ok) {
              toast.push({ kind: 'success', title: 'Security settings reset' });
              void security.refetch();
            } else toast.push({ kind: 'error', title: 'Reset failed', msg: res.reason });
          } catch (e) {
            toast.push({ kind: 'error', title: 'Reset failed', msg: e instanceof Error ? e.message : undefined });
          }
          setResetOpen(false);
        }}
      />
    </div>
  );
}

/* ------------------------------- data ------------------------------- */

function DataSection() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const kinds: { kind: ExportKind; label: string; desc: string }[] = [
    { kind: 'patients', label: 'Patients', desc: 'Full patient registry' },
    { kind: 'appointments', label: 'Appointments', desc: 'Schedule history' },
    { kind: 'invoices', label: 'Invoices', desc: 'Billing documents' },
    { kind: 'payments', label: 'Payments', desc: 'Payment ledger' },
    { kind: 'inventory', label: 'Inventory', desc: 'Stock items' },
    { kind: 'accounting', label: 'Accounting', desc: 'Income & expenses' },
    { kind: 'audit', label: 'Audit log', desc: 'Security trail' },
  ];

  const run = async (kind: ExportKind) => {
    setBusy(kind);
    try {
      const res = await api('export.csv', { kind, range: 'all' });
      if (res.ok) toast.push({ kind: 'success', title: `${kind} exported — ${res.rowCount ?? 0} rows`, msg: res.path });
      else if (!res.cancelled) toast.push({ kind: 'error', title: 'Export failed', msg: res.reason });
    } catch (e) {
      toast.push({ kind: 'error', title: 'Export failed', msg: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card card-pad">
      <h3 style={{ marginBottom: 6 }}>Export data (CSV, UTF-8)</h3>
      <p className="tiny muted" style={{ marginBottom: 14 }}>
        Choose a destination via the save dialog. CSV opens directly in Excel with full Bengali Unicode support.
      </p>
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {kinds.map((k) => (
          <div key={k.kind} className="card card-pad" style={{ padding: 'var(--sp-3)' }}>
            <strong>{k.label}</strong>
            <p className="tiny muted" style={{ margin: '4px 0 10px' }}>
              {k.desc}
            </p>
            <Button size="sm" icon="download" loading={busy === k.kind} onClick={() => void run(k.kind)}>
              Export CSV
            </Button>
          </div>
        ))}
      </div>
      <div className="alert alert-info" style={{ marginTop: 16 }}>
        <Icon name="info" size={16} />
        <div>
          For full database migration use <strong>Backup &amp; restore</strong> — CSV is for reporting only.
        </div>
      </div>
    </div>
  );
}
