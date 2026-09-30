import { currentDb, tx, nextSequence } from '../db/database';
import { recordAudit, requirePermission, ServiceError, type ServiceActor } from './common';
import { assertPassword } from './admin';
import { nowIso, todayIso } from '../../shared/format';
import type {
  InvoiceDto,
  InvoiceInput,
  InvoiceListQuery,
  InvoiceStatus,
  Page,
  PaymentDto,
  PaymentInput,
  PaymentListQuery,
  PaymentsDashboard,
} from '../../shared/contract';

/* ================================ INVOICES ================================ */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface InvoiceComputation {
  subtotal: number;
  lineDiscounts: number;
  total: number;
}

/** Centralized invoice math — single domain implementation used everywhere. */
export function computeInvoice(
  items: { qty: number; unitPrice: number; discount?: number }[],
  discountAmount = 0,
  taxAmount = 0,
): InvoiceComputation {
  let subtotal = 0;
  let lineDiscounts = 0;
  for (const it of items) {
    const qty = Math.max(0, Number(it.qty) || 0);
    const price = Math.max(0, Number(it.unitPrice) || 0);
    const disc = Math.max(0, Number(it.discount) || 0);
    const gross = qty * price;
    if (disc > gross) throw new ServiceError('validation', 'Line discount exceeds line amount');
    subtotal += gross - disc;
    lineDiscounts += disc;
  }
  const invDiscount = Math.max(0, Number(discountAmount) || 0);
  if (invDiscount > subtotal) throw new ServiceError('validation', 'Invoice discount exceeds subtotal');
  const total = round2(subtotal - invDiscount + Math.max(0, Number(taxAmount) || 0));
  return { subtotal: round2(subtotal), lineDiscounts: round2(lineDiscounts), total };
}

function recomputeInvoice(invoiceId: number): void {
  const db = currentDb();
  const inv = db.prepare('SELECT total FROM invoices WHERE id = ?').get(invoiceId) as { total: number } | undefined;
  if (!inv) return;
  const paidRow = db
    .prepare(
      `SELECT COALESCE(SUM(a.amount),0) AS paid FROM payment_allocations a
       JOIN payments p ON p.id = a.payment_id
       WHERE a.invoice_id = ? AND p.status = 'posted'`,
    )
    .get(invoiceId) as { paid: number };
  const paid = round2(paidRow.paid);
  const status: InvoiceStatus =
    paid + 0.005 >= inv.total ? 'paid' : paid > 0.005 ? 'partial' : 'unpaid';
  db.prepare("UPDATE invoices SET paid_total = ?, status = CASE WHEN status = 'void' THEN 'void' ELSE ? END, updated_at = datetime('now','localtime') WHERE id = ?").run(
    paid,
    status,
    invoiceId,
  );
}

function mapInvoice(r: Record<string, unknown>): InvoiceDto {
  const db = currentDb();
  const items = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort, id')
    .all(r.id) as Record<string, unknown>[];
  const payments = db
    .prepare(
      `SELECT pay.*, pm.label AS method_label, u.username AS received_by_name, inv.invoice_no
       FROM payments pay
       JOIN payment_methods pm ON pm.code = pay.method_code
       LEFT JOIN users u ON u.id = pay.received_by
       LEFT JOIN invoices inv ON inv.id = pay.invoice_id
       WHERE pay.invoice_id = ? ORDER BY pay.paid_at`,
    )
    .all(r.id) as Record<string, unknown>[];
  return {
    id: Number(r.id),
    invoiceNo: String(r.invoice_no),
    patientId: Number(r.patient_id),
    patientName: String(r.patient_name ?? ''),
    patientCode: String(r.patient_code ?? ''),
    issuedAt: String(r.issued_at),
    items: items.map((i) => ({
      id: Number(i.id),
      description: String(i.description),
      treatmentId: (i.treatment_id as number | null) ?? null,
      qty: Number(i.qty),
      unitPrice: Number(i.unit_price),
      discount: Number(i.discount),
      lineTotal: Number(i.line_total),
    })),
    subtotal: Number(r.subtotal),
    discountAmount: Number(r.discount_amount),
    taxAmount: Number(r.tax_amount),
    total: Number(r.total),
    paidTotal: Number(r.paid_total),
    balance: round2(Number(r.total) - Number(r.paid_total)),
    status: r.status as InvoiceStatus,
    notes: (r.notes as string | null) ?? null,
    createdAt: String(r.created_at),
    createdBy: (r.created_by as number | null) ?? null,
    payments: payments.map(mapPaymentRow),
  };
}

function nextInvoiceNo(): string {
  const db = currentDb();
  const prefixRow = db.prepare("SELECT value_json FROM app_settings WHERE group_name='invoice' AND key='prefix'").get() as
    | { value_json: string }
    | undefined;
  const prefix = prefixRow ? (JSON.parse(prefixRow.value_json) as string) : 'INV-';
  return nextSequence('invoice', prefix, 5);
}

export function createInvoice(actor: ServiceActor, input: InvoiceInput): { id: number; invoiceNo: string } {
  requirePermission(actor, 'invoice.create');
  if (!input.patientId) throw new ServiceError('validation', 'Patient is required');
  if (!input.items?.length) throw new ServiceError('validation', 'At least one invoice item is required');
  for (const [i, it] of input.items.entries()) {
    if (!it.description?.trim()) throw new ServiceError('validation', `Item #${i + 1}: description is required`);
    if (Number(it.qty) <= 0) throw new ServiceError('validation', `Item #${i + 1}: quantity must be positive`);
    if (Number(it.unitPrice) < 0) throw new ServiceError('validation', `Item #${i + 1}: price cannot be negative`);
  }
  const db = currentDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ServiceError('not_found', 'Patient not found', 404);

  const comp = computeInvoice(input.items, input.discountAmount ?? 0, input.taxAmount ?? 0);
  let id = 0;
  let invoiceNo = '';
  tx(() => {
    invoiceNo = nextInvoiceNo();
    const res = db
      .prepare(
        `INSERT INTO invoices (invoice_no, patient_id, issued_at, subtotal, discount_amount, tax_amount, total, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        invoiceNo,
        input.patientId,
        input.issuedAt || nowIso().slice(0, 10),
        comp.subtotal,
        input.discountAmount ?? 0,
        input.taxAmount ?? 0,
        comp.total,
        input.notes || null,
        actor.userId,
      );
    id = Number(res.lastInsertRowid);
    const ins = db.prepare(
      `INSERT INTO invoice_items (invoice_id, description, treatment_id, treatment_record_id, qty, unit_price, discount, line_total, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    input.items.forEach((it, idx) => {
      const qty = Number(it.qty);
      const price = Number(it.unitPrice);
      const disc = Number(it.discount) || 0;
      ins.run(
        id,
        it.description.trim(),
        it.treatmentId ?? null,
        it.treatmentRecordId ?? null,
        qty,
        price,
        disc,
        round2(qty * price - disc),
        idx,
      );
    });
    // link treatment records (mark invoiced) when provided
    for (const it of input.items) {
      if (it.treatmentRecordId) {
        db.prepare('UPDATE treatment_records SET visit_id = COALESCE(visit_id, visit_id) WHERE id = ?').run(
          it.treatmentRecordId,
        );
      }
    }
  });
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'invoice.create',
    entity: 'invoice',
    entityId: id,
    after: { invoiceNo, patientId: input.patientId, total: comp.total },
  });
  return { id, invoiceNo };
}

export function getInvoice(actor: ServiceActor, id: number): InvoiceDto {
  requirePermission(actor, 'invoice.view');
  const r = currentDb()
    .prepare(
      `SELECT i.*, p.full_name AS patient_name, p.patient_code
       FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!r) throw new ServiceError('not_found', 'Invoice not found', 404);
  return mapInvoice(r);
}

export function updateInvoice(actor: ServiceActor, input: InvoiceInput): void {
  requirePermission(actor, 'invoice.edit');
  if (!input.id) throw new ServiceError('validation', 'Invoice id required');
  const invoiceId: number = input.id;
  const db = currentDb();
  const inv = db.prepare('SELECT id, status, invoice_no FROM invoices WHERE id = ?').get(input.id) as
    | { id: number; status: string; invoice_no: string }
    | undefined;
  if (!inv) throw new ServiceError('not_found', 'Invoice not found', 404);
  if (inv.status !== 'unpaid') {
    throw new ServiceError(
      'validation',
      'Only unpaid invoices can be edited. Reverse payments or void this invoice instead.',
    );
  }
  if (!input.items?.length) throw new ServiceError('validation', 'At least one invoice item is required');
  const comp = computeInvoice(input.items, input.discountAmount ?? 0, input.taxAmount ?? 0);
  tx(() => {
    db.prepare(
      `UPDATE invoices SET subtotal=?, discount_amount=?, tax_amount=?, total=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?`,
    ).run(comp.subtotal, input.discountAmount ?? 0, input.taxAmount ?? 0, comp.total, input.notes || null, input.id);
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(input.id);
    const ins = db.prepare(
      `INSERT INTO invoice_items (invoice_id, description, treatment_id, treatment_record_id, qty, unit_price, discount, line_total, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    input.items.forEach((it, idx) => {
      const qty = Number(it.qty);
      const price = Number(it.unitPrice);
      const disc = Number(it.discount) || 0;
      ins.run(
        input.id,
        it.description.trim(),
        it.treatmentId ?? null,
        it.treatmentRecordId ?? null,
        qty,
        price,
        disc,
        round2(qty * price - disc),
        idx,
      );
    });
    recomputeInvoice(invoiceId);
  });
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'invoice.update',
    entity: 'invoice',
    entityId: input.id,
    after: { total: comp.total, items: input.items.length },
  });
}

export function voidInvoice(actor: ServiceActor, id: number, password: string): { ok: boolean; reason?: string } {
  requirePermission(actor, 'invoice.delete');
  assertPassword(actor, password);
  const db = currentDb();
  const inv = db.prepare('SELECT id, status, invoice_no, paid_total FROM invoices WHERE id = ?').get(id) as
    | { id: number; status: string; invoice_no: string; paid_total: number }
    | undefined;
  if (!inv) throw new ServiceError('not_found', 'Invoice not found', 404);
  if (inv.status === 'void') return { ok: true, reason: 'already_void' };
  if (inv.paid_total > 0.005) {
    throw new ServiceError('validation', 'Reverse the payments for this invoice before voiding');
  }
  db.prepare("UPDATE invoices SET status = 'void', voided_at = datetime('now','localtime') WHERE id = ?").run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'invoice.void',
    entity: 'invoice',
    entityId: id,
    before: { status: inv.status },
    after: { status: 'void' },
  });
  return { ok: true };
}

export function listInvoices(actor: ServiceActor, q: InvoiceListQuery): Page<InvoiceDto> {
  requirePermission(actor, 'invoice.view');
  const db = currentDb();
  const where: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (q.status && q.status !== 'all') {
    where.push('i.status = ?');
    params.push(q.status);
  } else {
    where.push("i.status != 'void'");
  }
  if (q.patientId) {
    where.push('i.patient_id = ?');
    params.push(q.patientId);
  }
  if (q.q?.trim()) {
    const like = `%${q.q.trim().toLowerCase()}%`;
    where.push('(LOWER(i.invoice_no) LIKE ? OR LOWER(p.full_name) LIKE ? OR LOWER(p.patient_code) LIKE ?)');
    params.push(like, like, like);
  }
  if (q.range && q.range !== 'all') {
    let from: string | null = null;
    let to: string | null = todayIso();
    if (q.range === 'today') from = todayIso();
    else if (q.range === 'd7') from = todayIso(-7);
    else if (q.range === 'd30') from = todayIso(-30);
    else if (q.range === 'd90') from = todayIso(-90);
    else if (q.range === 'd365') from = todayIso(-365);
    else if (q.range === 'custom') {
      from = q.from ?? null;
      to = q.to ?? null;
    }
    if (from) {
      where.push('i.issued_at >= ?');
      params.push(from);
    }
    if (to) {
      where.push('i.issued_at <= ?');
      params.push(to);
    }
  }
  const orderBy =
    q.sort === 'oldest'
      ? 'i.issued_at ASC, i.id ASC'
      : q.sort === 'amount_desc'
        ? 'i.total DESC'
        : q.sort === 'balance_desc'
          ? '(i.total - i.paid_total) DESC'
          : 'i.issued_at DESC, i.id DESC';
  const pageSize = Math.min(200, Math.max(5, q.pageSize ?? 25));
  const page = Math.max(1, q.page ?? 1);
  const whereSql = where.join(' AND ');
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE ${whereSql}`)
      .get(...params) as { c: number }
  ).c;
  const rows = db
    .prepare(
      `SELECT i.*, p.full_name AS patient_name, p.patient_code
       FROM invoices i JOIN patients p ON p.id = i.patient_id
       WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
  return { items: rows.map(mapInvoice), total, page, pageSize };
}

/* ================================= PAYMENTS ================================= */

function mapPaymentRow(r: Record<string, unknown>): PaymentDto {
  return {
    id: Number(r.id),
    paymentNo: String(r.payment_no),
    patientId: Number(r.patient_id),
    patientName: String(r.patient_name ?? ''),
    invoiceId: (r.invoice_id as number | null) ?? null,
    invoiceNo: (r.invoice_no as string | null) ?? null,
    amount: Number(r.amount),
    paidAt: String(r.paid_at),
    methodCode: r.method_code as PaymentDto['methodCode'],
    methodLabel: String(r.method_label ?? r.method_code),
    reference: (r.reference as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    receivedBy: (r.received_by as number | null) ?? null,
    receivedByName: (r.received_by_name as string | null) ?? null,
    status: r.status as 'posted' | 'reversed',
    reversalOf: (r.reversal_of as number | null) ?? null,
    createdAt: String(r.created_at),
  };
}

const PAY_SELECT = `
  SELECT pay.*, pm.label AS method_label, p.full_name AS patient_name, u.username AS received_by_name, inv.invoice_no
  FROM payments pay
  JOIN payment_methods pm ON pm.code = pay.method_code
  JOIN patients p ON p.id = pay.patient_id
  LEFT JOIN users u ON u.id = pay.received_by
  LEFT JOIN invoices inv ON inv.id = pay.invoice_id`;

export function createPayment(
  actor: ServiceActor,
  input: PaymentInput,
): { id: number; paymentNo: string; invoiceStatus?: InvoiceStatus } {
  requirePermission(actor, 'payment.create');
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ServiceError('validation', 'Payment amount must be positive');
  }
  const db = currentDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ServiceError('not_found', 'Patient not found', 404);
  const method = db.prepare('SELECT code FROM payment_methods WHERE code = ? AND active = 1').get(input.methodCode);
  if (!method) throw new ServiceError('validation', 'Payment method is not available');

  let paymentNo = '';
  let id = 0;
  let lastStatus: InvoiceStatus | undefined;
  tx(() => {
    // determine allocations
    const allocations: { invoiceId: number; amount: number }[] = [];
    if (input.invoiceId) {
      const inv = db.prepare('SELECT id, total, paid_total, status FROM invoices WHERE id = ?').get(input.invoiceId) as
        | { id: number; total: number; paid_total: number; status: string }
        | undefined;
      if (!inv) throw new ServiceError('not_found', 'Invoice not found', 404);
      if (inv.status === 'void') throw new ServiceError('validation', 'Cannot pay a void invoice');
      const openBalance = round2(inv.total - inv.paid_total);
      if (amount > openBalance + 0.005) {
        throw new ServiceError(
          'validation',
          `Payment exceeds invoice balance (open: ৳ ${openBalance.toFixed(2)})`,
        );
      }
      allocations.push({ invoiceId: inv.id, amount });
    } else {
      // FIFO across the patient's open invoices
      let remaining = amount;
      const open = db
        .prepare(
          `SELECT id, total, paid_total FROM invoices
           WHERE patient_id = ? AND status IN ('unpaid','partial') ORDER BY issued_at ASC, id ASC`,
        )
        .all(input.patientId) as { id: number; total: number; paid_total: number }[];
      for (const inv of open) {
        if (remaining <= 0.005) break;
        const openBalance = round2(inv.total - inv.paid_total);
        const apply = Math.min(remaining, openBalance);
        if (apply > 0) {
          allocations.push({ invoiceId: inv.id, amount: round2(apply) });
          remaining = round2(remaining - apply);
        }
      }
      // remaining (if any) stays as unallocated patient advance
    }

    const seq = nextSequence('payment', 'PAY-', 5);
    paymentNo = seq;
    const res = db
      .prepare(
        `INSERT INTO payments (payment_no, patient_id, invoice_id, amount, paid_at, method_code, reference, notes, received_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        paymentNo,
        input.patientId,
        input.invoiceId ?? allocations[0]?.invoiceId ?? null,
        amount,
        input.paidAt || nowIso(),
        input.methodCode,
        input.reference || null,
        input.notes || null,
        actor.userId,
      );
    id = Number(res.lastInsertRowid);
    const ins = db.prepare('INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (?, ?, ?)');
    for (const a of allocations) {
      ins.run(id, a.invoiceId, a.amount);
      recomputeInvoice(a.invoiceId);
      const st = db.prepare('SELECT status FROM invoices WHERE id = ?').get(a.invoiceId) as
        | { status: InvoiceStatus }
        | undefined;
      if (st) lastStatus = st.status;
    }
  });
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'payment.create',
    entity: 'payment',
    entityId: id,
    after: { paymentNo, amount, method: input.methodCode, invoiceId: input.invoiceId ?? null },
  });
  const out: { id: number; paymentNo: string; invoiceStatus?: InvoiceStatus } = { id, paymentNo };
  if (lastStatus) out.invoiceStatus = lastStatus;
  return out;
}

export function listPayments(actor: ServiceActor, q: PaymentListQuery): Page<PaymentDto> {
  requirePermission(actor, 'payment.view');
  const db = currentDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.status !== 'all') where.push("pay.status = 'posted'");
  if (q.patientId) {
    where.push('pay.patient_id = ?');
    params.push(q.patientId);
  }
  if (q.methodCode && q.methodCode !== 'all') {
    where.push('pay.method_code = ?');
    params.push(q.methodCode);
  }
  if (q.q?.trim()) {
    const like = `%${q.q.trim().toLowerCase()}%`;
    where.push('(LOWER(pay.payment_no) LIKE ? OR LOWER(p.full_name) LIKE ? OR LOWER(COALESCE(pay.reference,\'\')) LIKE ?)');
    params.push(like, like, like);
  }
  if (q.range && q.range !== 'all') {
    let from: string | null = null;
    let to: string | null = todayIso();
    if (q.range === 'today') from = todayIso();
    else if (q.range === 'd7') from = todayIso(-7);
    else if (q.range === 'd30') from = todayIso(-30);
    else if (q.range === 'd90') from = todayIso(-90);
    else if (q.range === 'd365') from = todayIso(-365);
    else if (q.range === 'custom') {
      from = q.from ?? null;
      to = q.to ?? null;
    }
    if (from) {
      where.push('pay.paid_at >= ?');
      params.push(from);
    }
    if (to) {
      where.push('pay.paid_at <= ?');
      params.push(to + 'T23:59:59');
    }
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const pageSize = Math.min(200, Math.max(5, q.pageSize ?? 25));
  const page = Math.max(1, q.page ?? 1);
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM payments pay JOIN patients p ON p.id = pay.patient_id ${whereSql}`)
      .get(...params) as { c: number }
  ).c;
  const rows = db
    .prepare(`${PAY_SELECT} ${whereSql} ORDER BY pay.paid_at DESC, pay.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
  return { items: rows.map(mapPaymentRow), total, page, pageSize };
}

export function getPayment(actor: ServiceActor, id: number): PaymentDto {
  requirePermission(actor, 'payment.view');
  const r = currentDb().prepare(`${PAY_SELECT} WHERE pay.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) throw new ServiceError('not_found', 'Payment not found', 404);
  return mapPaymentRow(r);
}

/**
 * Reversal (immutable correction): the original payment row keeps its amount
 * and is marked `reversed`; allocations stop counting; invoice recomputed.
 * The reason is captured in the audit trail.
 */
export function reversePayment(
  actor: ServiceActor,
  id: number,
  reason: string,
  password: string,
): { ok: boolean; reason?: string } {
  requirePermission(actor, 'payment.delete');
  assertPassword(actor, password);
  if (!reason?.trim()) throw new ServiceError('validation', 'A reversal reason is required');
  const db = currentDb();
  const pay = db.prepare('SELECT id, status, amount, invoice_id, payment_no FROM payments WHERE id = ?').get(id) as
    | { id: number; status: string; amount: number; invoice_id: number | null; payment_no: string }
    | undefined;
  if (!pay) throw new ServiceError('not_found', 'Payment not found', 404);
  if (pay.status !== 'posted') throw new ServiceError('validation', 'Payment is already reversed');
  tx(() => {
    db.prepare("UPDATE payments SET status = 'reversed' WHERE id = ?").run(id);
    const allocs = db.prepare('SELECT invoice_id FROM payment_allocations WHERE payment_id = ?').all(id) as {
      invoice_id: number;
    }[];
    for (const a of allocs) recomputeInvoice(a.invoice_id);
  });
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'payment.reverse',
    entity: 'payment',
    entityId: id,
    before: { status: 'posted', amount: pay.amount, paymentNo: pay.payment_no },
    after: { status: 'reversed' },
    metadata: { reason: reason.trim() },
  });
  return { ok: true };
}

export function paymentsDashboard(
  actor: ServiceActor,
  period: string,
  from?: string,
  to?: string,
): PaymentsDashboard {
  // financial authorization happens BEFORE any data query
  requirePermission(actor, 'financial.view');
  const db = currentDb();
  let start = from ?? todayIso();
  let end = to ?? todayIso();
  if (period === 'today') start = todayIso();
  else if (period === 'd7') start = todayIso(-7);
  else if (period === 'd30') start = todayIso(-30);
  else if (period === 'd90') start = todayIso(-90);
  else if (period === 'd365') start = todayIso(-365);
  else if (period === 'all') start = '2000-01-01';

  const byMethod = db
    .prepare(
      `SELECT pm.code, pm.label, COALESCE(SUM(pay.amount),0) AS total, COUNT(pay.id) AS count
       FROM payment_methods pm
       LEFT JOIN payments pay ON pay.method_code = pm.code AND pay.status = 'posted'
         AND pay.paid_at >= ? AND pay.paid_at <= ?
       GROUP BY pm.code, pm.label ORDER BY pm.sort`,
    )
    .all(start + 'T00:00:00', end + 'T23:59:59') as Record<string, unknown>[];
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM payments
       WHERE status = 'posted' AND paid_at >= ? AND paid_at <= ?`,
    )
    .get(start + 'T00:00:00', end + 'T23:59:59') as { total: number; count: number };
  const outstanding = db
    .prepare(`SELECT COALESCE(SUM(total - paid_total),0) AS s FROM invoices WHERE status IN ('unpaid','partial')`)
    .get() as { s: number };

  return {
    permitted: true,
    period,
    totalCollected: round2(totals.total),
    byMethod: byMethod.map((m) => ({
      code: String(m.code),
      label: String(m.label),
      total: round2(Number(m.total)),
      count: Number(m.count),
    })),
    outstanding: round2(outstanding.s),
    paymentCount: totals.count,
  };
}

export { recomputeInvoice };
