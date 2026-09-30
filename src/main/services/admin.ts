import { currentDb, tx } from '../db/database';
import { recordAudit, requirePermission, ServiceError, type ServiceActor } from './common';
import { hashPassword, checkPasswordStrength, verifyPassword } from '../security/password';
import { getSecuritySettings } from './settings';
import { refreshSessionPermissions } from './auth';
import { PERMISSIONS, isPermission } from '../../shared/permissions';
import type {
  DentistDto,
  DentistInput,
  RoleDto,
  RoleInput,
  StaffDto,
  StaffInput,
  UserDto,
  UserInput,
} from '../../shared/contract';

/* ================================== DENTISTS ================================== */

function mapDentist(r: Record<string, unknown>): DentistDto {
  return {
    id: Number(r.id),
    dentistCode: String(r.dentist_code),
    fullName: String(r.full_name),
    photoPath: (r.photo_path as string | null) ?? null,
    designations: safeJson(r.designations_json, []),
    qualifications: (r.qualifications as string | null) ?? null,
    licenseNo: (r.license_no as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    signaturePath: (r.signature_path as string | null) ?? null,
    availability: safeJson(r.availability_json, [0, 1, 2, 3, 4, 5, 6]),
    workingHours: (r.working_hours as string | null) ?? null,
    active: Boolean(r.active),
    createdAt: String(r.created_at),
  };
}

function safeJson<T>(v: unknown, fallback: T): T {
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}

export function listDentists(includeInactive = false): DentistDto[] {
  const db = currentDb();
  const rows = db
    .prepare(
      `SELECT * FROM dentists WHERE deleted_at IS NULL ${includeInactive ? '' : 'AND active = 1'} ORDER BY full_name`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapDentist);
}

export function createDentist(actor: ServiceActor, input: DentistInput): { id: number } {
  requirePermission(actor, 'settings.manage');
  if (!input.fullName?.trim()) throw new ServiceError('validation', 'Dentist name is required');
  const db = currentDb();
  const row = db.prepare("SELECT value FROM system_state WHERE key = 'counter.dentist'").get() as
    | { value: string }
    | undefined;
  const n = row ? Number(row.value) + 1 : 1;
  const code = input.dentistCode || `D${String(n).padStart(3, '0')}`;
  const res = db
    .prepare(
      `INSERT INTO dentists (dentist_code, full_name, designations_json, qualifications, license_no, phone, email, availability_json, working_hours, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      code,
      input.fullName.trim(),
      JSON.stringify(input.designations ?? []),
      input.qualifications ?? null,
      input.licenseNo ?? null,
      input.phone ?? null,
      input.email ?? null,
      JSON.stringify(input.availability ?? [0, 1, 2, 3, 4, 5, 6]),
      input.workingHours ?? null,
    );
  db.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES ('counter.dentist', ?, datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(n));
  const id = Number(res.lastInsertRowid);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'dentist.create',
    entity: 'dentist',
    entityId: id,
    after: { fullName: input.fullName },
  });
  return { id };
}

export function updateDentist(actor: ServiceActor, input: DentistInput): void {
  requirePermission(actor, 'settings.manage');
  if (!input.id) throw new ServiceError('validation', 'Dentist id required');
  const db = currentDb();
  const before = db.prepare('SELECT * FROM dentists WHERE id = ?').get(input.id);
  if (!before) throw new ServiceError('not_found', 'Dentist not found', 404);
  db.prepare(
    `UPDATE dentists SET full_name=?, designations_json=?, qualifications=?, license_no=?, phone=?, email=?,
      availability_json=?, working_hours=?, active=?, updated_at=datetime('now','localtime') WHERE id=?`,
  ).run(
    input.fullName?.trim(),
    JSON.stringify(input.designations ?? []),
    input.qualifications ?? null,
    input.licenseNo ?? null,
    input.phone ?? null,
    input.email ?? null,
    JSON.stringify(input.availability ?? [0, 1, 2, 3, 4, 5, 6]),
    input.workingHours ?? null,
    input.active === false ? 0 : 1,
    input.id,
  );
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'dentist.update',
    entity: 'dentist',
    entityId: input.id,
    before,
    after: { fullName: input.fullName },
  });
  refreshSessionPermissions();
}

export function deleteDentist(actor: ServiceActor, id: number): { ok: boolean; reason?: string } {
  requirePermission(actor, 'settings.manage');
  const db = currentDb();
  const inUse = db
    .prepare('SELECT COUNT(*) AS c FROM appointments WHERE dentist_id = ? AND deleted_at IS NULL')
    .get(id) as { c: number };
  const visits = db.prepare('SELECT COUNT(*) AS c FROM visits WHERE dentist_id = ?').get(id) as { c: number };
  const users = db.prepare('SELECT COUNT(*) AS c FROM users WHERE dentist_id = ? AND deleted_at IS NULL').get(id) as {
    c: number;
  };
  if (inUse.c > 0 || visits.c > 0 || users.c > 0) {
    // archive instead of delete to preserve clinical/financial integrity
    db.prepare("UPDATE dentists SET active = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(id);
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'dentist.archive',
      entity: 'dentist',
      entityId: id,
      metadata: { reason: 'in_use', appointments: inUse.c, visits: visits.c },
    });
    return { ok: true, reason: 'archived_in_use' };
  }
  db.prepare('UPDATE dentists SET deleted_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'dentist.delete',
    entity: 'dentist',
    entityId: id,
  });
  return { ok: true };
}

/* =================================== USERS =================================== */

function mapUser(r: Record<string, unknown>): UserDto {
  return {
    id: Number(r.id),
    username: String(r.username),
    displayName: (r.display_name as string | null) ?? null,
    roleId: Number(r.role_id),
    roleName: String(r.role_name),
    dentistId: (r.dentist_id as number | null) ?? null,
    active: Boolean(r.active),
    photoPath: (r.photo_path as string | null) ?? null,
    lastLoginAt: (r.last_login_at as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

export function listUsers(actor: ServiceActor): UserDto[] {
  requirePermission(actor, 'user.manage');
  const rows = currentDb()
    .prepare(
      `SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.deleted_at IS NULL ORDER BY u.username`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapUser);
}

export function createUser(actor: ServiceActor, input: UserInput): { id: number } {
  requirePermission(actor, 'user.manage');
  const username = input.username?.trim() ?? '';
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    throw new ServiceError('validation', 'Username must be 3–32 chars (letters, numbers, . _ -)');
  }
  if (!input.password) throw new ServiceError('validation', 'Password is required');
  const db = currentDb();
  if (db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
    throw new ServiceError('validation', 'Username already exists');
  }
  const role = db.prepare('SELECT id FROM roles WHERE id = ?').get(input.roleId);
  if (!role) throw new ServiceError('validation', 'Role does not exist');
  const strength = checkPasswordStrength(input.password, getSecuritySettings().passwordPolicy, username);
  if (!strength.ok) throw new ServiceError('validation', 'Password too weak: ' + strength.issues.join(', '));
  const rec = hashPassword(input.password);
  const res = db
    .prepare(
      `INSERT INTO users (username, password_hash, password_salt, password_params, display_name, role_id, dentist_id, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      username,
      rec.hash,
      rec.salt,
      rec.params,
      input.displayName?.trim() || username,
      input.roleId,
      input.dentistId ?? null,
      input.active === false ? 0 : 1,
    );
  const id = Number(res.lastInsertRowid);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'user.create',
    entity: 'user',
    entityId: id,
    after: { username, roleId: input.roleId },
  });
  return { id };
}

export function updateUser(actor: ServiceActor, input: UserInput): void {
  requirePermission(actor, 'user.manage');
  if (!input.id) throw new ServiceError('validation', 'User id required');
  const db = currentDb();
  const before = db.prepare('SELECT id, username, role_id, active, display_name FROM users WHERE id = ?').get(input.id);
  if (!before) throw new ServiceError('not_found', 'User not found', 404);
  const dup = db
    .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?')
    .get(input.username.trim(), input.id);
  if (dup) throw new ServiceError('validation', 'Username already exists');
  db.prepare(
    `UPDATE users SET username=?, display_name=?, role_id=?, dentist_id=?, active=?, updated_at=datetime('now','localtime') WHERE id=?`,
  ).run(
    input.username.trim(),
    input.displayName?.trim() || input.username.trim(),
    input.roleId,
    input.dentistId ?? null,
    input.active === false ? 0 : 1,
    input.id,
  );
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'user.update',
    entity: 'user',
    entityId: input.id,
    before,
    after: { username: input.username, roleId: input.roleId, active: input.active !== false },
  });
  refreshSessionPermissions();
}

export function deleteUser(
  actor: ServiceActor,
  id: number,
  password: string,
): { ok: boolean; reason?: string } {
  requirePermission(actor, 'user.manage');
  assertPassword(actor, password);
  const db = currentDb();
  const self = actor.userId === id;
  if (self) throw new ServiceError('validation', 'You cannot delete your own account');
  const ownerCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'Owner' AND u.deleted_at IS NULL AND u.active = 1`,
    )
    .get() as { c: number };
  const target = db
    .prepare(
      `SELECT r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    )
    .get(id) as { role_name: string } | undefined;
  if (!target) throw new ServiceError('not_found', 'User not found', 404);
  if (target.role_name === 'Owner' && ownerCount.c <= 1) {
    throw new ServiceError('validation', 'Cannot delete the last Owner account');
  }
  const hasData = db
    .prepare('SELECT COUNT(*) AS c FROM audit_log WHERE user_id = ?')
    .get(id) as { c: number };
  db.prepare("UPDATE users SET deleted_at = datetime('now','localtime'), active = 0 WHERE id = ?").run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'user.delete',
    entity: 'user',
    entityId: id,
    metadata: { auditEntriesRetained: hasData.c },
  });
  return { ok: true };
}

export function resetUserPassword(
  actor: ServiceActor,
  id: number,
  newPassword: string,
  password: string,
): { ok: boolean; reason?: string } {
  requirePermission(actor, 'user.manage');
  assertPassword(actor, password);
  const db = currentDb();
  const target = db.prepare('SELECT username FROM users WHERE id = ? AND deleted_at IS NULL').get(id) as
    | { username: string }
    | undefined;
  if (!target) throw new ServiceError('not_found', 'User not found', 404);
  const strength = checkPasswordStrength(newPassword, getSecuritySettings().passwordPolicy, target.username);
  if (!strength.ok) throw new ServiceError('validation', 'Password too weak: ' + strength.issues.join(', '));
  const rec = hashPassword(newPassword);
  db.prepare(
    'UPDATE users SET password_hash=?, password_salt=?, password_params=?, failed_attempts=0, locked_until=NULL, must_change_password=1, updated_at=datetime(\'now\',\'localtime\') WHERE id=?',
  ).run(rec.hash, rec.salt, rec.params, id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'user.reset_password',
    entity: 'user',
    entityId: id,
  });
  return { ok: true };
}

/** Re-authentication guard for destructive/admin actions. */
export function assertPassword(actor: ServiceActor, password: string): void {
  if (actor.isSystem) return;
  const db = currentDb();
  const user = db.prepare('SELECT password_hash, password_salt, password_params FROM users WHERE id = ?').get(
    actor.userId ?? -1,
  ) as { password_hash: string; password_salt: string; password_params: string } | undefined;
  if (!user) throw new ServiceError('unauthenticated', 'Not authenticated', 401);
  const ok = verifyPassword(password, {
    hash: user.password_hash,
    salt: user.password_salt,
    params: user.password_params,
  });
  if (!ok) {
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'auth.reauth',
      result: 'failure',
    });
    throw new ServiceError('forbidden', 'Password verification failed', 403);
  }
}

/* =================================== ROLES =================================== */

export function listRoles(actor: ServiceActor): RoleDto[] {
  requirePermission(actor, 'role.manage');
  const db = currentDb();
  const roles = db.prepare('SELECT * FROM roles ORDER BY name').all() as Record<string, unknown>[];
  return roles.map((r) => {
    const perms = db
      .prepare('SELECT permission_code FROM role_permissions WHERE role_id = ?')
      .all(r.id) as { permission_code: string }[];
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM users WHERE role_id = ? AND deleted_at IS NULL')
      .get(r.id) as { c: number };
    return {
      id: Number(r.id),
      name: String(r.name),
      description: (r.description as string | null) ?? null,
      isSystem: Boolean(r.is_system),
      permissions: perms.map((p) => p.permission_code) as RoleDto['permissions'],
      userCount: count.c,
    };
  });
}

export function saveRole(actor: ServiceActor, input: RoleInput): { id: number } {
  requirePermission(actor, 'role.manage');
  const name = input.name?.trim();
  if (!name || name.length < 2) throw new ServiceError('validation', 'Role name is required');
  const perms = input.permissions ?? [];
  for (const p of perms) {
    if (!isPermission(p)) throw new ServiceError('validation', `Unknown permission: ${p}`);
  }
  if (name === 'Owner') throw new ServiceError('validation', 'The Owner role cannot be modified');
  const db = currentDb();
  const txRes = tx(() => {
    let id: number;
    if (input.id) {
      const existing = db.prepare('SELECT id, is_system FROM roles WHERE id = ?').get(input.id) as
        | { id: number; is_system: number }
        | undefined;
      if (!existing) throw new ServiceError('not_found', 'Role not found', 404);
      db.prepare("UPDATE roles SET name=?, description='customized', updated_at=datetime('now','localtime') WHERE id=?").run(
        name,
        input.id,
      );
      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(input.id);
      id = existing.id;
    } else {
      const dup = db.prepare('SELECT id FROM roles WHERE name = ?').get(name);
      if (dup) throw new ServiceError('validation', 'Role name already exists');
      const res = db
        .prepare("INSERT INTO roles (name, description, is_system) VALUES (?, 'customized', 0)")
        .run(name);
      id = Number(res.lastInsertRowid);
    }
    const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)');
    for (const p of perms) ins.run(id, p);
    return id;
  });
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'role.save',
    entity: 'role',
    entityId: txRes,
    after: { name, permissionCount: perms.length },
  });
  refreshSessionPermissions();
  return { id: txRes };
}

export function deleteRole(actor: ServiceActor, id: number): { ok: boolean; reason?: string } {
  requirePermission(actor, 'role.manage');
  const db = currentDb();
  const role = db.prepare('SELECT name, is_system FROM roles WHERE id = ?').get(id) as
    | { name: string; is_system: number }
    | undefined;
  if (!role) throw new ServiceError('not_found', 'Role not found', 404);
  if (role.is_system) throw new ServiceError('validation', 'Built-in roles cannot be deleted');
  const users = db.prepare('SELECT COUNT(*) AS c FROM users WHERE role_id = ? AND deleted_at IS NULL').get(id) as {
    c: number;
  };
  if (users.c > 0) throw new ServiceError('validation', `Role is assigned to ${users.c} user(s)`);
  db.prepare('DELETE FROM roles WHERE id = ?').run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'role.delete',
    entity: 'role',
    entityId: id,
    before: { name: role.name },
  });
  return { ok: true };
}

export function allPermissions() {
  return [...PERMISSIONS];
}

/* =================================== STAFF =================================== */

function mapStaff(r: Record<string, unknown>): StaffDto {
  return {
    id: Number(r.id),
    staffCode: String(r.staff_code),
    fullName: String(r.full_name),
    dob: (r.dob as string | null) ?? null,
    gender: (r.gender as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    emergencyPhone: (r.emergency_phone as string | null) ?? null,
    bloodGroup: (r.blood_group as string | null) ?? null,
    idNo: (r.id_no as string | null) ?? null,
    designation: (r.designation as string | null) ?? null,
    department: (r.department as string | null) ?? null,
    joiningDate: (r.joining_date as string | null) ?? null,
    salary: (r.salary as number | null) ?? null,
    paymentInfo: (r.payment_info as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    active: Boolean(r.active),
    photoPath: (r.photo_path as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

export function listStaff(actor: ServiceActor, includeInactive = false): StaffDto[] {
  requirePermission(actor, 'staff.view');
  const rows = currentDb()
    .prepare(
      `SELECT * FROM staff WHERE deleted_at IS NULL ${includeInactive ? '' : 'AND active = 1'} ORDER BY full_name`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapStaff);
}

export function saveStaff(actor: ServiceActor, input: StaffInput): { id: number } {
  requirePermission(actor, 'staff.manage');
  if (!input.fullName?.trim()) throw new ServiceError('validation', 'Staff name is required');
  const db = currentDb();
  let id: number;
  if (input.id) {
    const before = db.prepare('SELECT * FROM staff WHERE id = ?').get(input.id);
    if (!before) throw new ServiceError('not_found', 'Staff not found', 404);
    db.prepare(
      `UPDATE staff SET full_name=?, dob=?, gender=?, address=?, phone=?, emergency_phone=?, blood_group=?,
        id_no=?, designation=?, department=?, joining_date=?, salary=?, payment_info=?, notes=?, active=?,
        updated_at=datetime('now','localtime') WHERE id=?`,
    ).run(
      input.fullName.trim(),
      input.dob ?? null,
      input.gender ?? null,
      input.address ?? null,
      input.phone ?? null,
      input.emergencyPhone ?? null,
      input.bloodGroup ?? null,
      input.idNo ?? null,
      input.designation ?? null,
      input.department ?? null,
      input.joiningDate ?? null,
      input.salary ?? null,
      input.paymentInfo ?? null,
      input.notes ?? null,
      input.active === false ? 0 : 1,
      input.id,
    );
    id = input.id;
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'staff.update',
      entity: 'staff',
      entityId: id,
      after: { fullName: input.fullName },
    });
  } else {
    const row = db.prepare("SELECT value FROM system_state WHERE key = 'counter.staff'").get() as
      | { value: string }
      | undefined;
    const n = row ? Number(row.value) + 1 : 1;
    const res = db
      .prepare(
        `INSERT INTO staff (staff_code, full_name, dob, gender, address, phone, emergency_phone, blood_group,
          id_no, designation, department, joining_date, salary, payment_info, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `S${String(n).padStart(3, '0')}`,
        input.fullName.trim(),
        input.dob ?? null,
        input.gender ?? null,
        input.address ?? null,
        input.phone ?? null,
        input.emergencyPhone ?? null,
        input.bloodGroup ?? null,
        input.idNo ?? null,
        input.designation ?? null,
        input.department ?? null,
        input.joiningDate ?? null,
        input.salary ?? null,
        input.paymentInfo ?? null,
        input.notes ?? null,
      );
    id = Number(res.lastInsertRowid);
    db.prepare(
      `INSERT INTO system_state (key, value, updated_at) VALUES ('counter.staff', ?, datetime('now','localtime'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(n));
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'staff.create',
      entity: 'staff',
      entityId: id,
      after: { fullName: input.fullName },
    });
  }
  return { id };
}

export function deleteStaff(actor: ServiceActor, id: number): { ok: boolean } {
  requirePermission(actor, 'staff.manage');
  currentDb().prepare("UPDATE staff SET deleted_at = datetime('now','localtime') WHERE id = ?").run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'staff.delete',
    entity: 'staff',
    entityId: id,
  });
  return { ok: true };
}
