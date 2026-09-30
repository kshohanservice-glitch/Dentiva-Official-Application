import { currentDb } from '../db/database';
import { logger } from '../logger';
import { sha256Hex } from '../security/activation';
import type { Permission } from '../../shared/permissions';

/**
 * Append-only audit log with a hash chain (each entry commits to its
 * predecessor) — records cannot be casually edited or deleted: this module
 * intentionally exposes no update/delete operations.
 */

export interface AuditActor {
  userId: number | null;
  username: string | null;
}

export interface AuditInput {
  actor: AuditActor;
  action: string;
  entity?: string;
  entityId?: string | number | null;
  result?: 'success' | 'failure';
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

export function recordAudit(input: AuditInput): void {
  try {
    const db = currentDb();
    const ts = new Date().toISOString();
    const prev = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get() as
      | { hash: string }
      | undefined;
    const body = JSON.stringify({
      ts,
      userId: input.actor.userId,
      username: input.actor.username,
      action: input.action,
      entity: input.entity ?? null,
      entityId: input.entityId != null ? String(input.entityId) : null,
      result: input.result ?? 'success',
      before: input.before ?? null,
      after: input.after ?? null,
      metadata: input.metadata ?? null,
    });
    const prevHash = prev?.hash ?? 'genesis';
    const hash = sha256Hex(prevHash + '|' + body);
    db.prepare(
      `INSERT INTO audit_log (ts, user_id, username, action, entity, entity_id, result, before_json, after_json, metadata_json, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ts,
      input.actor.userId,
      input.actor.username,
      input.action,
      input.entity ?? null,
      input.entityId != null ? String(input.entityId) : null,
      input.result ?? 'success',
      input.before != null ? JSON.stringify(input.before) : null,
      input.after != null ? JSON.stringify(input.after) : null,
      input.metadata != null ? JSON.stringify(input.metadata) : null,
      prevHash,
      hash,
    );
  } catch (err) {
    logger.error('Failed to write audit log', { action: input.action, err: String(err) });
  }
}

/** Verifies the integrity of the whole audit hash chain. Used by tests + UI. */
export function verifyAuditChain(): { ok: boolean; brokenAt?: number } {
  const db = currentDb();
  const rows = db
    .prepare(
      'SELECT id, ts, user_id, username, action, entity, entity_id, result, before_json, after_json, metadata_json, prev_hash, hash FROM audit_log ORDER BY id',
    )
    .all() as Record<string, unknown>[];
  let prevHash = 'genesis';
  for (const r of rows) {
    if (r.prev_hash !== prevHash) return { ok: false, brokenAt: Number(r.id) };
    const body = JSON.stringify({
      ts: r.ts,
      userId: r.user_id,
      username: r.username,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      result: r.result,
      before: r.before_json != null ? JSON.parse(String(r.before_json)) : null,
      after: r.after_json != null ? JSON.parse(String(r.after_json)) : null,
      metadata: r.metadata_json != null ? JSON.parse(String(r.metadata_json)) : null,
    });
    const expected = sha256Hex(prevHash + '|' + body);
    if (expected !== r.hash) return { ok: false, brokenAt: Number(r.id) };
    prevHash = String(r.hash);
  }
  return { ok: true };
}

/** Thrown for any permission / validation / domain failure in the service layer. */
export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpish = 400,
  ) {
    super(message);
  }
}

export interface ServiceActor {
  userId: number | null;
  username: string | null;
  permissions: Permission[];
  isSystem?: boolean;
}

export const SYSTEM_ACTOR: ServiceActor = {
  userId: null,
  username: 'system',
  permissions: [],
  isSystem: true,
};

/**
 * RBAC gate — MUST be called inside every service method before any data
 * query. The system actor (internal jobs) bypasses checks; UI sessions never do.
 */
export function requirePermission(actor: ServiceActor, permission: Permission): void {
  if (actor.isSystem) return;
  if (!actor.permissions.includes(permission)) {
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'permission.denied',
      entity: 'permission',
      entityId: permission,
      result: 'failure',
    });
    throw new ServiceError('forbidden', `Missing permission: ${permission}`, 403);
  }
}
