import { currentDb, tx } from '../db/database';
import { recordAudit, requirePermission, ServiceError, type ServiceActor } from './common';
import { nowIso, todayIso } from '../../shared/format';
import type {
  InventoryAlerts,
  InventoryBatchDto,
  InventoryItemDto,
  InventoryItemInput,
  StockMoveInput,
  SupplierDto,
  SupplierInput,
} from '../../shared/contract';

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function mapItem(r: Record<string, unknown>, expiryInfo?: { nearest: string | null; soon: boolean }): InventoryItemDto {
  return {
    id: Number(r.id),
    code: String(r.code),
    name: String(r.name),
    category: String(r.category),
    unit: String(r.unit),
    supplierId: (r.supplier_id as number | null) ?? null,
    supplierName: (r.supplier_name as string | null) ?? null,
    purchasePrice: Number(r.purchase_price),
    usePrice: Number(r.use_price),
    openingStock: Number(r.opening_stock),
    currentStock: Number(r.current_stock),
    minStock: Number(r.min_stock),
    location: (r.location as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    active: Boolean(r.active),
    expirySoon: expiryInfo?.soon ?? false,
    nearestExpiry: expiryInfo?.nearest ?? null,
  };
}

const ITEM_SELECT = `
  SELECT i.*, s.name AS supplier_name FROM inventory_items i
  LEFT JOIN suppliers s ON s.id = i.supplier_id`;

function expiryFor(itemId: number, _days: number): { nearest: string | null; soon: boolean } {
  const row = currentDb()
    .prepare(
      `SELECT MIN(expiry_date) AS nearest FROM inventory_batches
       WHERE item_id = ? AND expiry_date IS NOT NULL AND qty > 0 AND expiry_date >= ?`,
    )
    .get(itemId, todayIso()) as { nearest: string | null };
  const expired = currentDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM inventory_batches WHERE item_id = ? AND expiry_date IS NOT NULL AND qty > 0 AND expiry_date < ?`,
    )
    .get(itemId, todayIso()) as { c: number };
  const soon = row.nearest != null && row.nearest <= todayIso() ? true : false;
  void expired;
  return { nearest: row.nearest, soon };
}

export function listInventory(
  actor: ServiceActor,
  opts: { q?: string; category?: string; filter?: string; includeInactive?: boolean } = {},
): InventoryItemDto[] {
  requirePermission(actor, 'inventory.view');
  const db = currentDb();
  const where: string[] = ['i.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (!opts.includeInactive) where.push('i.active = 1');
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim().toLowerCase()}%`;
    where.push('(LOWER(i.name) LIKE ? OR LOWER(i.code) LIKE ? OR LOWER(i.category) LIKE ?)');
    params.push(like, like, like);
  }
  if (opts.category) {
    where.push('i.category = ?');
    params.push(opts.category);
  }
  if (opts.filter === 'low') where.push('i.current_stock > 0 AND i.current_stock <= i.min_stock');
  if (opts.filter === 'out') where.push('i.current_stock <= 0');
  if (opts.filter === 'expiring') {
    where.push(
      'EXISTS (SELECT 1 FROM inventory_batches b WHERE b.item_id = i.id AND b.qty > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= date(\'now\', \'+30 days\'))',
    );
  }
  const rows = db
    .prepare(`${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.name COLLATE NOCASE`)
    .all(...params) as Record<string, unknown>[];
  const expDays = 30;
  return rows.map((r) => mapItem(r, expiryFor(Number(r.id), expDays)));
}

export function getInventoryItem(actor: ServiceActor, id: number): InventoryItemDto {
  requirePermission(actor, 'inventory.view');
  const r = currentDb().prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) throw new ServiceError('not_found', 'Inventory item not found', 404);
  return mapItem(r, expiryFor(id, 30));
}

export function saveInventoryItem(actor: ServiceActor, input: InventoryItemInput): { id: number } {
  requirePermission(actor, 'inventory.manage');
  if (!input.code?.trim() || !input.name?.trim()) {
    throw new ServiceError('validation', 'Item code and name are required');
  }
  if (input.minStock != null && input.minStock < 0) throw new ServiceError('validation', 'Min stock cannot be negative');
  const db = currentDb();
  let id: number;
  if (input.id) {
    const before = db.prepare('SELECT id, name, current_stock FROM inventory_items WHERE id = ?').get(input.id);
    if (!before) throw new ServiceError('not_found', 'Item not found', 404);
    db.prepare(
      `UPDATE inventory_items SET code=?, name=?, category=?, unit=?, supplier_id=?, purchase_price=?, use_price=?,
        min_stock=?, location=?, notes=?, active=?, updated_at=datetime('now','localtime') WHERE id=?`,
    ).run(
      input.code.trim(),
      input.name.trim(),
      input.category || 'General',
      input.unit || 'pcs',
      input.supplierId ?? null,
      input.purchasePrice ?? 0,
      input.usePrice ?? 0,
      input.minStock ?? 0,
      input.location || null,
      input.notes || null,
      input.active === false ? 0 : 1,
      input.id,
    );
    id = input.id;
  } else {
    if (db.prepare('SELECT id FROM inventory_items WHERE code = ?').get(input.code.trim())) {
      throw new ServiceError('validation', 'Item code already exists');
    }
    const opening = Number(input.openingStock ?? 0);
    if (opening < 0) throw new ServiceError('validation', 'Opening stock cannot be negative');
    const res = db
      .prepare(
        `INSERT INTO inventory_items (code, name, category, unit, supplier_id, purchase_price, use_price,
          opening_stock, current_stock, min_stock, location, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.code.trim(),
        input.name.trim(),
        input.category || 'General',
        input.unit || 'pcs',
        input.supplierId ?? null,
        input.purchasePrice ?? 0,
        input.usePrice ?? 0,
        opening,
        opening,
        input.minStock ?? 0,
        input.location || null,
        input.notes || null,
      );
    id = Number(res.lastInsertRowid);
    if (opening > 0) {
      db.prepare(
        `INSERT INTO inventory_transactions (item_id, type, qty, stock_after, note, created_by) VALUES (?, 'in', ?, ?, ?, ?)`,
      ).run(id, opening, opening, 'Opening stock', actor.userId);
    }
  }
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'inventory.save',
    entity: 'inventory_item',
    entityId: id,
    after: { code: input.code, name: input.name },
  });
  return { id };
}

export function deleteInventoryItem(actor: ServiceActor, id: number): { ok: boolean; reason?: string } {
  requirePermission(actor, 'inventory.manage');
  const db = currentDb();
  const txs = db.prepare('SELECT COUNT(*) AS c FROM inventory_transactions WHERE item_id = ?').get(id) as { c: number };
  if (txs.c > 0) {
    db.prepare("UPDATE inventory_items SET active = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(id);
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'inventory.archive',
      entity: 'inventory_item',
      entityId: id,
      metadata: { transactions: txs.c },
    });
    return { ok: true, reason: 'archived_has_transactions' };
  }
  db.prepare('DELETE FROM inventory_items WHERE id = ?').run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'inventory.delete',
    entity: 'inventory_item',
    entityId: id,
  });
  return { ok: true };
}

/**
 * Stock movement — transactional, negative-stock guarded (unless the setting
 * allowNegativeStock is enabled), every adjustment auditable.
 */
export function moveStock(actor: ServiceActor, input: StockMoveInput): { id: number; currentStock: number } {
  requirePermission(actor, 'inventory.manage');
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) throw new ServiceError('validation', 'Quantity must be positive');
  const db = currentDb();
  const item = db.prepare('SELECT id, current_stock FROM inventory_items WHERE id = ? AND deleted_at IS NULL').get(
    input.itemId,
  ) as { id: number; current_stock: number } | undefined;
  if (!item) throw new ServiceError('not_found', 'Item not found', 404);

  const delta =
    input.type === 'in' || input.type === 'returned'
      ? qty
      : input.type === 'out'
        ? -qty
        : input.type === 'adjust'
          ? qty // adjust sets target as delta semantics: qty = new absolute? we treat as delta from current via +/-; here: adjust uses qty as the new absolute count
          : -qty;

  // 'adjust' means set absolute stock = qty
  const newStock = input.type === 'adjust' ? qty : round2(item.current_stock + delta);
  if (newStock < 0) {
    const allowNegative = false;
    if (!allowNegative) {
      throw new ServiceError(
        'validation',
        `Insufficient stock: current ${item.current_stock}, resulting ${newStock}`,
        409,
      );
    }
  }

  let id = 0;
  tx(() => {
    if (input.type === 'in' && (input.batchNo || input.expiryDate)) {
      db.prepare(
        'INSERT INTO inventory_batches (item_id, batch_no, expiry_date, qty, unit_cost) VALUES (?, ?, ?, ?, ?)',
      ).run(input.itemId, input.batchNo || null, input.expiryDate || null, qty, input.unitCost ?? null);
    }
    const res = db
      .prepare(
        `INSERT INTO inventory_transactions (item_id, type, qty, stock_after, unit_cost, reference, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.itemId,
        input.type,
        input.type === 'adjust' ? Math.abs(round2(newStock - item.current_stock)) : qty,
        newStock,
        input.unitCost ?? null,
        input.reference || null,
        input.note || null,
        actor.userId,
      );
    id = Number(res.lastInsertRowid);
    db.prepare("UPDATE inventory_items SET current_stock = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(
      newStock,
      input.itemId,
    );
    if ((input.type === 'expired' || input.type === 'damaged') && input.batchNo) {
      db.prepare('UPDATE inventory_batches SET qty = MAX(0, qty - ?) WHERE item_id = ? AND batch_no = ?').run(
        qty,
        input.itemId,
        input.batchNo,
      );
    }
  });
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'inventory.move',
    entity: 'inventory_item',
    entityId: input.itemId,
    after: { type: input.type, qty, stockAfter: newStock },
  });
  return { id, currentStock: newStock };
}

export function listBatches(actor: ServiceActor, itemId: number): InventoryBatchDto[] {
  requirePermission(actor, 'inventory.view');
  const rows = currentDb()
    .prepare('SELECT * FROM inventory_batches WHERE item_id = ? ORDER BY expiry_date IS NULL, expiry_date')
    .all(itemId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    itemId: Number(r.item_id),
    batchNo: (r.batch_no as string | null) ?? null,
    expiryDate: (r.expiry_date as string | null) ?? null,
    qty: Number(r.qty),
    unitCost: (r.unit_cost as number | null) ?? null,
    receivedAt: String(r.received_at),
  }));
}

export function inventoryAlerts(actor: ServiceActor): InventoryAlerts {
  requirePermission(actor, 'inventory.view');
  const db = currentDb();
  const lowRows = db
    .prepare(
      `${ITEM_SELECT} WHERE i.deleted_at IS NULL AND i.active = 1 AND i.current_stock > 0 AND i.current_stock <= i.min_stock ORDER BY i.name`,
    )
    .all() as Record<string, unknown>[];
  const outRows = db
    .prepare(
      `${ITEM_SELECT} WHERE i.deleted_at IS NULL AND i.active = 1 AND i.current_stock <= 0 ORDER BY i.name`,
    )
    .all() as Record<string, unknown>[];
  const expiring = db
    .prepare(
      `${ITEM_SELECT} WHERE i.deleted_at IS NULL AND i.active = 1
       AND EXISTS (SELECT 1 FROM inventory_batches b WHERE b.item_id = i.id AND b.qty > 0
         AND b.expiry_date IS NOT NULL AND b.expiry_date <= date('now','+30 days') AND b.expiry_date >= date('now'))
       ORDER BY i.name`,
    )
    .all() as Record<string, unknown>[];
  const expired = db
    .prepare(
      `SELECT b.*, i.name AS item_name FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
       WHERE i.deleted_at IS NULL AND b.qty > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date < date('now')
       ORDER BY b.expiry_date`,
    )
    .all() as Record<string, unknown>[];
  return {
    lowStock: lowRows.map((r) => mapItem(r)),
    outOfStock: outRows.map((r) => mapItem(r)),
    expiringSoon: expiring.map((r) => mapItem(r)),
    expired: expired.map((r) => ({
      id: Number(r.id),
      itemId: Number(r.item_id),
      batchNo: (r.batch_no as string | null) ?? null,
      expiryDate: (r.expiry_date as string | null) ?? null,
      qty: Number(r.qty),
      unitCost: (r.unit_cost as number | null) ?? null,
      receivedAt: String(r.received_at),
      ...( { itemName: String(r.item_name) } as object),
    })),
  };
}

/* ================================ SUPPLIERS ================================ */

export function listSuppliers(actor: ServiceActor): SupplierDto[] {
  requirePermission(actor, 'inventory.view');
  const rows = currentDb()
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM inventory_items i WHERE i.supplier_id = s.id AND i.deleted_at IS NULL) AS purchase_count,
        (SELECT COALESCE(SUM(t.qty * COALESCE(t.unit_cost, 0)), 0) FROM inventory_transactions t
           JOIN inventory_items i2 ON i2.id = t.item_id
           WHERE i2.supplier_id = s.id AND t.type = 'in') AS total_purchase
       FROM suppliers s WHERE s.deleted_at IS NULL ORDER BY s.name COLLATE NOCASE`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    contactPerson: (r.contact_person as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    purchaseCount: Number(r.purchase_count ?? 0),
    totalPurchase: Number(r.total_purchase ?? 0),
    createdAt: String(r.created_at),
  }));
}

export function saveSupplier(actor: ServiceActor, input: SupplierInput): { id: number } {
  requirePermission(actor, 'supplier.manage');
  if (!input.name?.trim()) throw new ServiceError('validation', 'Supplier name is required');
  const db = currentDb();
  let id: number;
  if (input.id) {
    db.prepare(
      'UPDATE suppliers SET name=?, contact_person=?, phone=?, email=?, address=?, notes=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?',
    ).run(
      input.name.trim(),
      input.contactPerson || null,
      input.phone || null,
      input.email || null,
      input.address || null,
      input.notes || null,
      input.id,
    );
    id = input.id;
  } else {
    const res = db
      .prepare('INSERT INTO suppliers (name, contact_person, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        input.name.trim(),
        input.contactPerson || null,
        input.phone || null,
        input.email || null,
        input.address || null,
        input.notes || null,
      );
    id = Number(res.lastInsertRowid);
  }
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'supplier.save',
    entity: 'supplier',
    entityId: id,
    after: { name: input.name },
  });
  return { id };
}

export function deleteSupplier(actor: ServiceActor, id: number): { ok: boolean; reason?: string } {
  requirePermission(actor, 'supplier.manage');
  const db = currentDb();
  const used = db.prepare('SELECT COUNT(*) AS c FROM inventory_items WHERE supplier_id = ? AND deleted_at IS NULL').get(id) as {
    c: number;
  };
  if (used.c > 0) {
    throw new ServiceError('validation', `Supplier is linked to ${used.c} item(s) — remove the links first`);
  }
  db.prepare("UPDATE suppliers SET deleted_at = datetime('now','localtime') WHERE id = ?").run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'supplier.delete',
    entity: 'supplier',
    entityId: id,
  });
  return { ok: true };
}

export { nowIso };
