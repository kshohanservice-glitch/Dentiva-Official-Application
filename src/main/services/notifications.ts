import { currentDb } from '../db/database';
import { recordAudit, type ServiceActor } from './common';
import { getAllSettings } from './settings';
import { logger } from '../logger';
import type { NotificationDto } from '../../shared/contract';

/** Real, actionable notifications generated from actual application data. */

export type NotifyFn = (n: NotificationDto, unreadCount: number) => void;
let emit: NotifyFn | null = null;

export function setNotificationEmitter(fn: NotifyFn | null): void {
  emit = fn;
}

function unreadCount(): number {
  return (
    currentDb()
      .prepare('SELECT COUNT(*) AS c FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL')
      .get() as { c: number }
  ).c;
}

function mapNotification(r: Record<string, unknown>): NotificationDto {
  return {
    id: Number(r.id),
    type: String(r.type),
    severity: r.severity as NotificationDto['severity'],
    title: String(r.title),
    body: String(r.body),
    route: (r.route as string | null) ?? null,
    createdAt: String(r.created_at),
    readAt: (r.read_at as string | null) ?? null,
  };
}

export function notify(input: {
  type: string;
  severity?: NotificationDto['severity'];
  title: string;
  body: string;
  route?: string | null;
  entity?: string;
  entityId?: string | number | null;
  dedupeKey?: string;
}): NotificationDto | null {
  const db = currentDb();
  if (input.dedupeKey) {
    const existing = db
      .prepare(
        'SELECT id FROM notifications WHERE type = ? AND entity = ? AND read_at IS NULL AND dismissed_at IS NULL LIMIT 1',
      )
      .get(input.type, input.dedupeKey ?? null) as { id: number } | undefined;
    if (existing) return null;
  }
  const res = db
    .prepare(
      'INSERT INTO notifications (type, severity, title, body, route, entity, entity_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      input.type,
      input.severity ?? 'info',
      input.title,
      input.body,
      input.route ?? null,
      input.entity ?? null,
      input.entityId != null ? String(input.entityId) : null,
    );
  const id = Number(res.lastInsertRowid);
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Record<string, unknown>;
  const dto = mapNotification(row);
  const count = unreadCount();
  try {
    emit?.(dto, count);
  } catch {
    /* renderer may not be ready */
  }
  return dto;
}

export function listNotifications(actor: ServiceActor, unreadOnly?: boolean): NotificationDto[] {
  const db = currentDb();
  const where = unreadOnly ? 'WHERE read_at IS NULL AND dismissed_at IS NULL' : 'WHERE dismissed_at IS NULL';
  const rows = db
    .prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT 100`)
    .all() as Record<string, unknown>[];
  void actor;
  return rows.map(mapNotification);
}

export function markNotificationsRead(actor: ServiceActor, ids?: number[]): void {
  const db = currentDb();
  if (ids && ids.length) {
    const stmt = db.prepare('UPDATE notifications SET read_at = datetime(\'now\',\'localtime\') WHERE id = ?');
    for (const id of ids) stmt.run(id);
  } else {
    db.prepare("UPDATE notifications SET read_at = datetime('now','localtime') WHERE read_at IS NULL").run();
  }
  void actor;
}

export function dismissNotification(actor: ServiceActor, id: number): void {
  currentDb()
    .prepare("UPDATE notifications SET dismissed_at = datetime('now','localtime'), read_at = COALESCE(read_at, datetime('now','localtime')) WHERE id = ?")
    .run(id);
  void actor;
}

/** Recomputes data-driven notifications (idempotent — deduped per entity). */
export function generateSystemNotifications(): void {
  try {
    const db = currentDb();
    const settings = getAllSettings();
    const notif = settings.notifications as Record<string, unknown>;

    if (notif.lowStockEnabled !== false) {
      const low = db
        .prepare(
          `SELECT id, name, current_stock, min_stock FROM inventory_items
           WHERE deleted_at IS NULL AND active = 1 AND current_stock <= min_stock AND min_stock > 0
           AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.type = 'low_stock' AND n.entity = 'inventory_item'
             AND n.entity_id = CAST(inventory_items.id AS TEXT) AND n.read_at IS NULL AND n.dismissed_at IS NULL)
           LIMIT 10`,
        )
        .all() as Record<string, unknown>[];
      for (const item of low) {
        notify({
          type: 'low_stock',
          severity: Number(item.current_stock) <= 0 ? 'critical' : 'warning',
          title: Number(item.current_stock) <= 0 ? `Out of stock: ${item.name}` : `Low stock: ${item.name}`,
          body: `Current ${item.current_stock}, minimum ${item.min_stock}`,
          route: '/inventory',
          entity: 'inventory_item',
          entityId: Number(item.id),
          dedupeKey: String(item.id),
        });
      }
    }

    const expiryDays = Number(notif.expiryDays ?? 30);
    const expiring = db
      .prepare(
        `SELECT b.id, b.item_id, b.batch_no, b.expiry_date, i.name FROM inventory_batches b
         JOIN inventory_items i ON i.id = b.item_id
         WHERE b.qty > 0 AND b.expiry_date IS NOT NULL
           AND b.expiry_date <= date('now', '+' || ? || ' days')
           AND b.expiry_date >= date('now')
           AND i.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.type = 'expiry' AND n.entity = 'inventory_batch'
             AND n.entity_id = CAST(b.id AS TEXT) AND n.read_at IS NULL AND n.dismissed_at IS NULL)
           LIMIT 10`,
      )
      .all(expiryDays) as Record<string, unknown>[];
    for (const b of expiring) {
      notify({
        type: 'expiry',
        severity: 'warning',
        title: `Expiring soon: ${b.name}`,
        body: `Batch ${b.batch_no ?? '—'} expires ${b.expiry_date}`,
        route: '/inventory',
        entity: 'inventory_batch',
        entityId: Number(b.id),
        dedupeKey: String(b.id),
      });
    }

    const unpaidDays = Number(notif.unpaidInvoiceDays ?? 7);
    const unpaid = db
      .prepare(
        `SELECT i.id, i.invoice_no, i.total, i.paid_total, i.issued_at, p.full_name FROM invoices i
         JOIN patients p ON p.id = i.patient_id
         WHERE i.status IN ('unpaid','partial') AND i.issued_at <= date('now', '-' || ? || ' days')
           AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.type = 'unpaid' AND n.entity = 'invoice'
             AND n.entity_id = CAST(i.id AS TEXT) AND n.read_at IS NULL AND n.dismissed_at IS NULL)
           LIMIT 10`,
      )
      .all(unpaidDays) as Record<string, unknown>[];
    for (const i of unpaid) {
      const balance = Number(i.total) - Number(i.paid_total);
      notify({
        type: 'unpaid',
        severity: 'info',
        title: `Unpaid invoice ${i.invoice_no}`,
        body: `${i.full_name} — balance ৳ ${balance.toFixed(2)} since ${i.issued_at}`,
        route: `/invoices/${i.id}`,
        entity: 'invoice',
        entityId: Number(i.id),
        dedupeKey: String(i.id),
      });
    }

    if (notif.backupReminders !== false) {
      const backupSettings = (settings.backup ?? {}) as Record<string, unknown>;
      const every = Number(backupSettings.autoEveryDays ?? 0);
      const last = backupSettings.lastSuccessAt ? new Date(String(backupSettings.lastSuccessAt)).getTime() : 0;
      if (every > 0 && Date.now() - last > every * 86_400_000) {
        notify({
          type: 'backup_due',
          severity: 'warning',
          title: 'Backup due',
          body: `Automatic backup is scheduled every ${every} days. Last successful backup: ${
            last ? new Date(last).toLocaleString() : 'never'
          }`,
          route: '/backup',
          dedupeKey: 'backup-due',
        });
      }
      const lastResult = backupSettings.lastResult;
      if (typeof lastResult === 'string' && lastResult.startsWith('failed')) {
        notify({
          type: 'backup_failed',
          severity: 'critical',
          title: 'Backup failed',
          body: lastResult,
          route: '/backup',
          dedupeKey: 'backup-failed',
        });
      }
    }
  } catch (err) {
    logger.error('Notification generation failed', { err: String(err) });
  }
}

export { recordAudit };
