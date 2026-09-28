import React, { useEffect, useMemo, useState } from 'react';
import { api, useApi, useApiMutation, useAppState } from '../lib/api';
import {
  Badge,
  Button,
  ChipRow,
  ConfirmDialog,
  DataTable,
  Field,
  Icon,
  Input,
  Modal,
  PageHead,
  Pagination,
  SearchBox,
  Select,
  useToast,
  type Column,
} from '../components/ui';
import { PERMISSION_GROUPS, ALL_PERMISSIONS, type Permission } from '@shared/permissions';
import { formatDate, formatDateTime, todayIso } from '@shared/format';
import type { AuditEntryDto, AuditQuery, RoleDto, RoleInput, StaffDto, UserDto, UserInput } from '@shared/contract';

/* ================================ STAFF ================================ */

export function StaffPage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const canManage = perms.includes('staff.manage');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [edit, setEdit] = useState<StaffDto | 'new' | null>(null);
  const list = useApi('staff.list', { includeInactive }, { staleTime: 5000 });

  const cols: Column<StaffDto>[] = [
    { key: 'code', header: 'Code', width: '96px', render: (s) => <span className="mono">{s.staffCode}</span> },
    {
      key: 'name',
      header: 'Name',
      render: (s) => (
        <div>
          <div className="cell-main">{s.fullName}</div>
          <div className="cell-sub">{[s.designation, s.department].filter(Boolean).join(' · ') || '—'}</div>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', value: (s) => s.phone || '—' },
    { key: 'joined', header: 'Joined', value: (s) => (s.joiningDate ? formatDate(s.joiningDate) : '—') },
    { key: 'salary', header: 'Salary (৳)', align: 'num', value: (s) => (s.salary != null ? s.salary.toFixed(0) : '—') },
    { key: 'status', header: 'Status', render: (s) => <Badge tone={s.active ? 'ok' : 'neutral'}>{s.active ? 'active' : 'inactive'}</Badge> },
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
                void api('staff.delete', { id: s.id }).then(() => void list.refetch());
              }}
            />
          </span>
        ) : null,
    },
  ];

  return (
    <div className="page">
      <PageHead
        title="Staff"
        sub={list.data ? `${list.data.length} staff records` : 'Clinic staff directory'}
        actions={
          canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>
              New staff
            </Button>
          ) : null
        }
      />
      <div className="toolbar">
        <label className="checkbox-row">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Include inactive
        </label>
      </div>
      <DataTable
        columns={cols}
        rows={list.data ?? []}
        rowKey={(s) => s.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(s) => (canManage ? setEdit(s) : undefined)}
        empty={{
          title: 'No staff records',
          desc: 'Keep a directory of assistants, hygienists and administrative staff with emergency contacts.',
          icon: 'users',
          action: canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>
              New staff
            </Button>
          ) : undefined,
        }}
      />
      <StaffEditor
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

function StaffEditor({ target, onClose, onSaved }: { target: StaffDto | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const empty = {
    fullName: '',
    phone: '',
    emergencyPhone: '',
    gender: '',
    bloodGroup: '',
    address: '',
    idNo: '',
    designation: '',
    department: '',
    joiningDate: todayIso(),
    salary: '',
    paymentInfo: '',
    notes: '',
    dob: '',
    active: true,
  };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setErrors({});
    if (target && target !== 'new') {
      setForm({
        fullName: target.fullName,
        phone: target.phone ?? '',
        emergencyPhone: target.emergencyPhone ?? '',
        gender: target.gender ?? '',
        bloodGroup: target.bloodGroup ?? '',
        address: target.address ?? '',
        idNo: target.idNo ?? '',
        designation: target.designation ?? '',
        department: target.department ?? '',
        joiningDate: target.joiningDate ?? '',
        salary: target.salary != null ? String(target.salary) : '',
        paymentInfo: target.paymentInfo ?? '',
        notes: target.notes ?? '',
        dob: target.dob ?? '',
        active: target.active,
      });
    } else if (target === 'new') setForm(empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const save = useApiMutation('staff.save', {
    onSuccess: () => {
      toast.push({ kind: 'success', title: 'Staff saved' });
      onSaved();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', msg: e.message }),
  });

  if (!target) return null;
  return (
    <Modal
      open
      title={target === 'new' ? 'New staff member' : `Edit — ${target.fullName}`}
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
              if (!form.fullName.trim()) {
                setErrors({ fullName: 'Name required' });
                return;
              }
              save.mutate({
                id: target !== 'new' ? target.id : undefined,
                fullName: form.fullName,
                phone: form.phone || undefined,
                emergencyPhone: form.emergencyPhone || undefined,
                gender: form.gender || undefined,
                bloodGroup: form.bloodGroup || undefined,
                address: form.address || undefined,
                idNo: form.idNo || undefined,
                designation: form.designation || undefined,
                department: form.department || undefined,
                joiningDate: form.joiningDate || null,
                salary: form.salary ? Number(form.salary) : null,
                paymentInfo: form.paymentInfo || undefined,
                notes: form.notes || undefined,
                dob: form.dob || null,
                active: form.active,
              });
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Full name" required error={errors.fullName}>
          <Input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
        </Field>
        <Field label="Designation">
          <Input value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} placeholder="e.g. Dental assistant" />
        </Field>
        <Field label="Department">
          <Input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </Field>
        <Field label="Emergency phone">
          <Input value={form.emergencyPhone} onChange={(e) => setForm((f) => ({ ...f, emergencyPhone: e.target.value }))} />
        </Field>
        <Field label="Gender">
          <Select
            value={form.gender}
            placeholder="—"
            onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
            options={['Male', 'Female', 'Other'].map((g) => ({ value: g, label: g }))}
          />
        </Field>
        <Field label="Date of birth">
          <Input type="date" value={form.dob} onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))} />
        </Field>
        <Field label="Blood group">
          <Select
            value={form.bloodGroup}
            placeholder="—"
            onChange={(e) => setForm((f) => ({ ...f, bloodGroup: e.target.value }))}
            options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => ({ value: b, label: b }))}
          />
        </Field>
        <Field label="National ID / ID no.">
          <Input value={form.idNo} onChange={(e) => setForm((f) => ({ ...f, idNo: e.target.value }))} />
        </Field>
        <Field label="Joining date">
          <Input type="date" value={form.joiningDate} onChange={(e) => setForm((f) => ({ ...f, joiningDate: e.target.value }))} />
        </Field>
        <Field label="Salary (৳)">
          <Input type="number" min={0} value={form.salary} onChange={(e) => setForm((f) => ({ ...f, salary: e.target.value }))} />
        </Field>
        <Field label="Address" className="span-2">
          <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        </Field>
        <Field label="Payment info" hint="Bank account / wallet for salary">
          <Input value={form.paymentInfo} onChange={(e) => setForm((f) => ({ ...f, paymentInfo: e.target.value }))} />
        </Field>
        <Field label="Notes">
          <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
        <label className="checkbox-row span-2">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          Active
        </label>
      </div>
    </Modal>
  );
}

/* ================================ USERS ================================ */

export function UsersPage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const canManage = perms.includes('user.manage');
  const toast = useToast();
  const [edit, setEdit] = useState<UserDto | 'new' | null>(null);
  const [reset, setReset] = useState<UserDto | null>(null);
  const [deleting, setDeleting] = useState<UserDto | null>(null);
  const list = useApi('users.list', undefined, { staleTime: 5000 });
  const roles = useApi('roles.list', undefined, { staleTime: 60_000 });
  const dentists = useApi('dentists.list', undefined, { staleTime: 60_000 });

  const cols: Column<UserDto>[] = [
    {
      key: 'user',
      header: 'User',
      render: (u) => (
        <div>
          <div className="cell-main">{u.displayName ?? u.username}</div>
          <div className="cell-sub mono">{u.username}</div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', value: (u) => u.roleName },
    {
      key: 'link',
      header: 'Linked dentist',
      value: (u) => dentists.data?.find((d) => d.id === u.dentistId)?.fullName ?? '—',
    },
    { key: 'last', header: 'Last login', value: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never') },
    { key: 'status', header: 'Status', render: (u) => <Badge tone={u.active ? 'ok' : 'neutral'}>{u.active ? 'active' : 'inactive'}</Badge> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (u) =>
        canManage ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" icon="key" title="Reset password" onClick={() => setReset(u)} />
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(u)} />
            {u.id !== state.user?.id ? (
              <Button size="sm" variant="ghost" icon="trash" onClick={() => setDeleting(u)} />
            ) : null}
          </span>
        ) : null,
    },
  ];

  return (
    <div className="page">
      <PageHead
        title="Users"
        sub={list.data ? `${list.data.length} login accounts` : 'Accounts & access'}
        actions={
          canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>
              New user
            </Button>
          ) : null
        }
      />
      <DataTable
        columns={cols}
        rows={list.data ?? []}
        rowKey={(u) => u.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(u) => (canManage ? setEdit(u) : undefined)}
        empty={{
          title: 'No users',
          desc: 'Create login accounts and assign roles to enforce permissions.',
          icon: 'key',
        }}
      />

      <UserEditor
        target={edit}
        roles={roles.data ?? []}
        dentists={dentists.data ?? []}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          void list.refetch();
        }}
      />
      <ResetPasswordModal
        user={reset}
        onClose={() => setReset(null)}
        onDone={() => {
          setReset(null);
          void list.refetch();
        }}
      />
      <ConfirmDialog
        open={deleting != null}
        title="Delete user"
        danger
        confirmLabel="Delete user"
        requirePassword
        requirePhrase={deleting?.username ?? ''}
        message={
          <>
            Permanently delete the account <strong>{deleting?.username}</strong>? The audit history is retained, but
            the user can no longer log in. Type the username to confirm.
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={async ({ password, phrase }) => {
          if (!deleting) return;
          try {
            const res = await api('users.delete', { id: deleting.id, password, confirmPhrase: phrase });
            if (res.ok) {
              toast.push({ kind: 'success', title: 'User deleted' });
              void list.refetch();
            } else {
              toast.push({ kind: 'error', title: 'Delete failed', msg: res.reason });
            }
          } catch (e) {
            toast.push({ kind: 'error', title: 'Delete failed', msg: e instanceof Error ? e.message : undefined });
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

function UserEditor({
  target,
  roles,
  dentists,
  onClose,
  onSaved,
}: {
  target: UserDto | 'new' | null;
  roles: RoleDto[];
  dentists: { id: number; fullName: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ username: '', password: '', displayName: '', roleId: '', dentistId: '', active: true });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setErrors({});
    if (target && target !== 'new') {
      setForm({ username: target.username, password: '', displayName: target.displayName ?? '', roleId: String(target.roleId), dentistId: target.dentistId != null ? String(target.dentistId) : '', active: target.active });
    } else if (target === 'new') {
      setForm({ username: '', password: '', displayName: '', roleId: '', dentistId: '', active: true });
    }
  }, [target]);

  const save = useApiMutation(target === 'new' ? 'users.create' : 'users.update', {
    onSuccess: () => {
      toast.push({ kind: 'success', title: 'User saved' });
      onSaved();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', msg: e.message }),
  });

  if (!target) return null;
  const isNew = target === 'new';
  return (
    <Modal
      open
      title={isNew ? 'New user' : `Edit — ${target.username}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="save"
            loading={save.isPending}
            onClick={() => {
              const errs: Record<string, string> = {};
              if (!form.username.trim()) errs.username = 'Username required';
              if (isNew && form.password.length < 8) errs.password = 'At least 8 characters';
              if (!form.roleId) errs.role = 'Role required';
              setErrors(errs);
              if (Object.keys(errs).length) return;
              save.mutate({
                id: isNew ? undefined : target.id,
                username: form.username.trim(),
                password: isNew ? form.password : form.password || undefined,
                displayName: form.displayName || undefined,
                roleId: Number(form.roleId),
                dentistId: form.dentistId ? Number(form.dentistId) : null,
                active: form.active,
              } satisfies UserInput);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Username" required error={errors.username}>
          <Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} autoComplete="off" />
        </Field>
        <Field label="Display name">
          <Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
        </Field>
        <Field label={isNew ? 'Password' : 'New password (optional)'} required={isNew} error={errors.password}>
          <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} autoComplete="new-password" />
        </Field>
        <Field label="Role" required error={errors.role}>
          <Select
            value={form.roleId}
            placeholder="Select role…"
            onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
            options={roles.map((r) => ({ value: r.id, label: `${r.name}${r.isSystem ? ' (built-in)' : ''}` }))}
          />
        </Field>
        <Field label="Linked dentist" hint="For dentist accounts: ties sessions to a dentist">
          <Select
            value={form.dentistId}
            placeholder="None…"
            onChange={(e) => setForm((f) => ({ ...f, dentistId: e.target.value }))}
            options={dentists.map((d) => ({ value: d.id, label: d.fullName }))}
          />
        </Field>
        <label className="checkbox-row span-2" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          Active (can log in)
        </label>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: UserDto | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (user) {
      setPw('');
      setCurrent('');
    }
  }, [user]);
  if (!user) return null;
  return (
    <Modal
      open
      title={`Reset password — ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="key"
            loading={busy}
            onClick={async () => {
              if (pw.length < 8) {
                toast.push({ kind: 'error', title: 'Password must be at least 8 characters' });
                return;
              }
              if (!current) {
                toast.push({ kind: 'error', title: 'Enter your own password to authorize this reset' });
                return;
              }
              setBusy(true);
              try {
                await api('users.resetPassword', { id: user.id, newPassword: pw, password: current });
                toast.push({ kind: 'success', title: 'Password reset' });
                onDone();
              } catch (e) {
                toast.push({ kind: 'error', title: 'Reset failed', msg: e instanceof Error ? e.message : undefined });
              } finally {
                setBusy(false);
              }
            }}
          >
            Reset password
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 'var(--sp-3)' }}>
        <Field label="Your password (authorization)" required hint="Required by the security policy — audited.">
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password" required hint="Minimum 8 characters. The user must change it at next login.">
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
    </Modal>
  );
}

/* ================================ ROLES ================================ */

export function RolesPage() {
  const { state } = useAppState();
  const perms = state.user?.permissions ?? [];
  const canManage = perms.includes('role.manage');
  const [edit, setEdit] = useState<RoleDto | 'new' | null>(null);
  const list = useApi('roles.list', undefined, { staleTime: 5000 });

  const cols: Column<RoleDto>[] = [
    {
      key: 'name',
      header: 'Role',
      render: (r) => (
        <div>
          <div className="cell-main">
            {r.name} {r.isSystem ? <Badge tone="info">built-in</Badge> : null}
          </div>
          <div className="cell-sub">{r.description || '—'}</div>
        </div>
      ),
    },
    { key: 'perms', header: 'Permissions', align: 'num', value: (r) => r.permissions.length },
    { key: 'users', header: 'Users', align: 'num', value: (r) => r.userCount },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        canManage ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(r)} />
            {!r.isSystem ? (
              <Button
                size="sm"
                variant="ghost"
                icon="trash"
                onClick={() => {
                  void api('roles.delete', { id: r.id }).then(() => void list.refetch());
                }}
              />
            ) : null}
          </span>
        ) : null,
    },
  ];

  return (
    <div className="page">
      <PageHead
        title="Roles & permissions"
        sub="Permissions are enforced in business logic, not just the UI"
        actions={
          canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>
              New role
            </Button>
          ) : null
        }
      />
      <DataTable
        columns={cols}
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => (canManage ? setEdit(r) : undefined)}
        empty={{ title: 'No roles', desc: 'Built-in roles are seeded automatically.', icon: 'shield' }}
      />
      <RoleEditor
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

function RoleEditor({ target, onClose, onSaved }: { target: RoleDto | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', description: '' });
  const [selected, setSelected] = useState<Permission[]>([]);

  useEffect(() => {
    if (target && target !== 'new') {
      setForm({ name: target.name, description: target.description ?? '' });
      setSelected(target.permissions);
    } else if (target === 'new') {
      setForm({ name: '', description: '' });
      setSelected([]);
    }
  }, [target]);

  const save = useApiMutation('roles.save', {
    onSuccess: () => {
      toast.push({ kind: 'success', title: 'Role saved' });
      onSaved();
    },
    onError: (e) => toast.push({ kind: 'error', title: 'Save failed', msg: e.message }),
  });

  if (!target) return null;
  const isNew = target === 'new';
  const toggle = (p: Permission, on: boolean) =>
    setSelected((arr) => (on ? [...new Set([...arr, p])] : arr.filter((x) => x !== p)));
  const allSelected = selected.length === ALL_PERMISSIONS.length;

  return (
    <Modal
      open
      title={isNew ? 'New role' : `Edit — ${target.name}`}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="save"
            loading={save.isPending}
            onClick={() => {
              if (!form.name.trim()) {
                toast.push({ kind: 'error', title: 'Role name required' });
                return;
              }
              if (target !== 'new' && target.isSystem && selected.length !== target.permissions.length) {
                toast.push({ kind: 'error', title: 'Built-in role permissions cannot be changed', msg: 'Create a custom role instead.' });
                return;
              }
              save.mutate({
                id: target !== 'new' ? target.id : undefined,
                name: form.name.trim(),
                description: form.description || undefined,
                permissions: selected,
              } satisfies RoleInput);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <Field label="Role name" required>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} disabled={target !== 'new' && target.isSystem} />
        </Field>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="tiny muted">
          {selected.length} of {ALL_PERMISSIONS.length} permissions selected
        </span>
        <Button
          size="sm"
          onClick={() => setSelected(allSelected ? [] : [...ALL_PERMISSIONS])}
          disabled={target !== 'new' && target.isSystem}
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </Button>
      </div>
      <div className="col" style={{ gap: 10, maxHeight: '50vh', overflowY: 'auto' }}>
        {PERMISSION_GROUPS.map((g) => (
          <div key={g.group} className="card card-pad" style={{ padding: 'var(--sp-3)' }}>
            <strong style={{ fontSize: 'var(--fs-sm)' }}>{g.group}</strong>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              {g.permissions.map((p) => (
                <label key={p} className="checkbox-row" style={{ fontSize: 'var(--fs-xs)' }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(p)}
                    disabled={target !== 'new' && target.isSystem}
                    onChange={(e) => toggle(p, e.target.checked)}
                  />
                  <code>{p}</code>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ================================ AUDIT LOG ================================ */

export function AuditPage() {
  const { state } = useAppState();
  const toast = useToast();
  const perms = state.user?.permissions ?? [];
  const canSee = perms.includes('audit.view');
  const [q, setQ] = useState('');
  const [result, setResult] = useState<'all' | 'success' | 'failure'>('all');
  const [range, setRange] = useState<'today' | 'd7' | 'd30' | 'd90' | 'd365' | 'all'>('d30');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [detail, setDetail] = useState<AuditEntryDto | null>(null);

  const query: AuditQuery = useMemo(
    () => ({ q: q || undefined, result: result === 'all' ? undefined : result, range, page, pageSize }),
    [q, result, range, page, pageSize],
  );
  const list = useApi('audit.list', query, { staleTime: 3000, enabled: canSee });
  useEffect(() => setPage(1), [q, result, range]);

  if (!canSee) {
    return (
      <div className="page">
        <PageHead title="Audit log" sub="Restricted" />
        <div className="state-block">
          <Icon name="lock" size={34} />
          <p>audit.view permission is required.</p>
        </div>
      </div>
    );
  }

  const cols: Column<AuditEntryDto>[] = [
    { key: 'ts', header: 'Time', render: (e) => formatDateTime(e.ts) },
    { key: 'user', header: 'User', value: (e) => e.username ?? 'system' },
    { key: 'action', header: 'Action', render: (e) => <span className="mono" style={{ fontWeight: 600 }}>{e.action}</span> },
    { key: 'entity', header: 'Entity', value: (e) => (e.entity ? `${e.entity}${e.entityId ? ` #${e.entityId}` : ''}` : '—') },
    {
      key: 'result',
      header: 'Result',
      render: (e) => <Badge tone={e.result === 'success' ? 'ok' : 'danger'}>{e.result}</Badge>,
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      render: (e) => (
        <Button size="sm" variant="ghost" icon="eye" onClick={(ev) => { ev.stopPropagation(); setDetail(e); }} />
      ),
    },
  ];

  const exportAudit = async () => {
    try {
      const res = await api('export.csv', { kind: 'audit', range });
      if (res.ok) toast.push({ kind: 'success', title: `Exported ${res.rowCount ?? 0} rows`, msg: res.path });
      else if (!res.cancelled) toast.push({ kind: 'error', title: 'Export failed', msg: res.reason });
    } catch (e) {
      toast.push({ kind: 'error', title: 'Export failed', msg: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Audit log"
        sub={list.data ? `${list.data.total} entries` : 'Immutable trail of sensitive actions'}
        actions={
          <Button icon="download" onClick={() => void exportAudit()}>
            Export CSV
          </Button>
        }
      />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search action, entity, user…" />
        <ChipRow
          options={[
            { value: 'all', label: 'All' },
            { value: 'success', label: 'Success' },
            { value: 'failure', label: 'Failure' },
          ]}
          value={result}
          onChange={(v) => setResult(v as typeof result)}
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
        rowKey={(e) => e.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(e) => setDetail(e)}
        empty={{ title: 'No audit entries', desc: 'Sensitive actions will appear here.', icon: 'history' }}
        footer={
          list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} /> : null
        }
      />
      <Modal open={detail != null} title="Audit entry" onClose={() => setDetail(null)} size="lg">
        {detail ? (
          <div className="col" style={{ gap: 10 }}>
            <dl className="kv">
              <dt>Time</dt>
              <dd>{formatDateTime(detail.ts)}</dd>
              <dt>User</dt>
              <dd>{detail.username ?? 'system'}</dd>
              <dt>Action</dt>
              <dd className="mono">{detail.action}</dd>
              <dt>Entity</dt>
              <dd>{detail.entity ? `${detail.entity} #${detail.entityId ?? ''}` : '—'}</dd>
              <dt>Result</dt>
              <dd>
                <Badge tone={detail.result === 'success' ? 'ok' : 'danger'}>{detail.result}</Badge>
              </dd>
            </dl>
            <div>
              <strong style={{ fontSize: 'var(--fs-sm)' }}>Before</strong>
              <pre className="code-block">{JSON.stringify(detail.beforeState, null, 2)}</pre>
            </div>
            <div>
              <strong style={{ fontSize: 'var(--fs-sm)' }}>After</strong>
              <pre className="code-block">{JSON.stringify(detail.afterState, null, 2)}</pre>
            </div>
            <div>
              <strong style={{ fontSize: 'var(--fs-sm)' }}>Metadata</strong>
              <pre className="code-block">{JSON.stringify(detail.metadata, null, 2)}</pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
