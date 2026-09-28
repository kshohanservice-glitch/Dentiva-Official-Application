import { currentDb } from '../db/database';
import { logger } from '../logger';
import { verifyPassword, hashPassword, checkPasswordStrength } from '../security/password';
import { recordAudit, requirePermission, ServiceError, type ServiceActor } from './common';
import { getSecuritySettings } from './settings';
import type { LoginResult, SessionUser } from '../../shared/contract';
import type { Permission } from '../../shared/permissions';

/**
 * Authentication + session management (fully offline).
 * - Argon2id password verification
 * - Progressive lockout after repeated failures
 * - Single active session per window (desktop app)
 * - In-memory session only: never persisted as a token the renderer can read
 */

export interface Session {
  user: SessionUser;
  locked: boolean;
  lastActivityAt: number;
}

let session: Session | null = null;

export function getSession(): Session | null {
  return session;
}

export function sessionActor(): ServiceActor {
  if (!session) throw new ServiceError('unauthenticated', 'Not authenticated', 401);
  return {
    userId: session.user.id,
    username: session.user.username,
    permissions: session.user.permissions as Permission[],
  };
}

export function touchActivity(): void {
  if (session) session.lastActivityAt = Date.now();
}

export function setLocked(locked: boolean): void {
  if (session) {
    session.locked = locked;
    session.lastActivityAt = Date.now();
  }
}

export function clearSession(): void {
  session = null;
}

/** Lock the UI (auto-lock or manual) — sensitive data hides behind unlock. */
export function lockSession(): void {
  if (session && !session.locked) {
    session.locked = true;
    session.lastActivityAt = Date.now();
    recordAudit({
      actor: { userId: session.user.id, username: session.user.username },
      action: 'auth.lock',
    });
  }
}

function loadSessionUser(userId: number): SessionUser | null {
  const db = currentDb();
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.photo_path, u.role_id, u.dentist_id, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? AND u.deleted_at IS NULL AND u.active = 1`,
    )
    .get(userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const perms = db
    .prepare(
      `SELECT rp.permission_code FROM role_permissions rp WHERE rp.role_id = ?`,
    )
    .all(row.role_id) as { permission_code: string }[];
  return {
    id: Number(row.id),
    username: String(row.username),
    displayName: (row.display_name as string | null) ?? null,
    photoPath: (row.photo_path as string | null) ?? null,
    roleId: Number(row.role_id),
    roleName: String(row.role_name),
    permissions: perms.map((p) => p.permission_code) as Permission[],
    dentistId: (row.dentist_id as number | null) ?? null,
  };
}

export function login(username: string, password: string): LoginResult {
  const db = currentDb();
  const security = getSecuritySettings();
  const maxAttempts = security.maxLoginAttempts ?? 5;
  const lockoutMin = security.lockoutMinutes ?? 15;

  const user = db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND deleted_at IS NULL')
    .get(username.trim()) as Record<string, unknown> | undefined;

  if (!user) {
    // burn comparable time to avoid user enumeration timing side channel
    verifyPassword(password, {
      hash: '00'.repeat(32),
      salt: '11'.repeat(16),
      params: 'm=65536,t=4,p=2',
    });
    recordAudit({
      actor: { userId: null, username: username.trim() },
      action: 'auth.login',
      result: 'failure',
      metadata: { reason: 'unknown_user' },
    });
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (user.locked_until && String(user.locked_until) > new Date().toISOString()) {
    recordAudit({
      actor: { userId: Number(user.id), username: String(user.username) },
      action: 'auth.login',
      result: 'failure',
      metadata: { reason: 'locked' },
    });
    return { ok: false, reason: 'rate_limited', retryAfterSec: 60 };
  }

  const valid = verifyPassword(password, {
    hash: String(user.password_hash),
    salt: String(user.password_salt),
    params: String(user.password_params),
  });

  if (!valid) {
    const attempts = Number(user.failed_attempts) + 1;
    const lockUntil =
      attempts >= maxAttempts
        ? new Date(Date.now() + lockoutMin * 60_000).toISOString()
        : null;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(
      attempts,
      lockUntil,
      user.id,
    );
    recordAudit({
      actor: { userId: Number(user.id), username: String(user.username) },
      action: 'auth.login',
      result: 'failure',
      metadata: { reason: 'bad_password', attempts },
    });
    if (lockUntil) return { ok: false, reason: 'locked' };
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (!user.active) {
    recordAudit({
      actor: { userId: Number(user.id), username: String(user.username) },
      action: 'auth.login',
      result: 'failure',
      metadata: { reason: 'inactive' },
    });
    return { ok: false, reason: 'inactive' };
  }

  db.prepare(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime(\'now\',\'localtime\'), updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
  ).run(user.id);

  const su = loadSessionUser(Number(user.id));
  if (!su) return { ok: false, reason: 'invalid_credentials' };

  session = { user: su, locked: false, lastActivityAt: Date.now() };
  recordAudit({
    actor: { userId: su.id, username: su.username },
    action: 'auth.login',
    result: 'success',
    metadata: { role: su.roleName },
  });
  logger.info('User logged in', { userId: su.id, username: su.username });
  return { ok: true, user: su };
}

export function logout(): void {
  if (session) {
    recordAudit({
      actor: { userId: session.user.id, username: session.user.username },
      action: 'auth.logout',
    });
  }
  clearSession();
}

export function unlock(password: string): { ok: boolean; reason?: string } {
  if (!session) return { ok: false, reason: 'no_session' };
  const db = currentDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user.id) as
    | Record<string, unknown>
    | undefined;
  if (!user) return { ok: false, reason: 'invalid' };
  const valid = verifyPassword(password, {
    hash: String(user.password_hash),
    salt: String(user.password_salt),
    params: String(user.password_params),
  });
  if (!valid) {
    recordAudit({
      actor: { userId: session.user.id, username: session.user.username },
      action: 'auth.unlock',
      result: 'failure',
    });
    return { ok: false, reason: 'invalid' };
  }
  setLocked(false);
  recordAudit({
    actor: { userId: session.user.id, username: session.user.username },
    action: 'auth.unlock',
  });
  return { ok: true };
}

export function changePassword(currentPassword: string, newPassword: string): { ok: boolean; reason?: string } {
  if (!session) return { ok: false, reason: 'no_session' };
  const db = currentDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user.id) as
    | Record<string, unknown>
    | undefined;
  if (!user) return { ok: false, reason: 'invalid' };
  const valid = verifyPassword(currentPassword, {
    hash: String(user.password_hash),
    salt: String(user.password_salt),
    params: String(user.password_params),
  });
  if (!valid) return { ok: false, reason: 'invalid_current' };
  const strength = checkPasswordStrength(newPassword, getSecuritySettings().passwordPolicy, session.user.username);
  if (!strength.ok) return { ok: false, reason: 'weak: ' + strength.issues.join(', ') };
  const rec = hashPassword(newPassword);
  db.prepare(
    'UPDATE users SET password_hash = ?, password_salt = ?, password_params = ?, must_change_password = 0, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
  ).run(rec.hash, rec.salt, rec.params, user.id);
  recordAudit({
    actor: { userId: session.user.id, username: session.user.username },
    action: 'auth.change_password',
    entity: 'user',
    entityId: session.user.id,
  });
  return { ok: true };
}

/** Used by services that need an actor but internally (setup phase, jobs). */
export function systemActor(): ServiceActor {
  return { userId: null, username: 'system', permissions: [], isSystem: true };
}

/** Refresh permissions in the live session (after role edits). */
export function refreshSessionPermissions(): void {
  if (!session) return;
  const fresh = loadSessionUser(session.user.id);
  if (fresh) session.user = fresh;
}

export { requirePermission };
