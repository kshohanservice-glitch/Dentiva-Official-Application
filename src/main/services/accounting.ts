import { currentDb, tx } from '../db/database';
import { recordAudit, requirePermission, ServiceError, type ServiceActor } from './common';
import { assertPassword } from './admin';
import { nowIso, todayIso } from '../../shared/format';
import type {
  AccountingCategoryDto,
  DentistRevenueRow,
  FinancialSummaryReport,
  LedgerEntryDto,
  LedgerEntryInput,
  PatientBalanceRow,
  Page,
  TreatmentRevenueRow,
} from '../../shared/contract';

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function listCategories(actor: ServiceActor): AccountingCategoryDto[] {
  requirePermission(actor, 'accounting.view');
  const rows = currentDb()
    .prepare('SELECT * FROM accounting_categories ORDER BY kind, name')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind as 'income' | 'expense',
    name: String(r.name),
    active: Boolean(r.active),
  }));
}

export function saveCategory(
  actor: ServiceActor,
  input: { id?: number; kind: 'income' | 'expense'; name: string; active?: boolean },
): { id: number } {
  requirePermission(actor, 'accounting.manage');
  if (!input.name?.trim()) throw new ServiceError('validation', 'Category name is required');
  const db = currentDb();
  let id: number;
  if (input.id) {
    db.prepare('UPDATE accounting_categories SET kind=?, name=?, active=? WHERE id=?').run(
      input.kind,
      input.name.trim(),
      input.active === false ? 0 : 1,
      input.id,
    );
    id = input.id;
  } else {
    const dup = db
      .prepare('SELECT id FROM accounting_categories WHERE kind = ? AND name = ?')
      .get(input.kind, input.name.trim());
    if (dup) throw new ServiceError('validation', 'Category already exists');
    const res = db
      .prepare('INSERT INTO accounting_categories (kind, name) VALUES (?, ?)')
      .run(input.kind, input.name.trim());
    id = Number(res.lastInsertRowid);
  }
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'accounting.category.save',
    entity: 'accounting_category',
    entityId: id,
    after: { kind: input.kind, name: input.name },
  });
  return { id };
}

const LEDGER_SELECT = `
  SELECT ft.*, c.name AS category_name, pm.label AS method_label, u.username AS created_by_name
  FROM financial_transactions ft
  JOIN accounting_categories c ON c.id = ft.category_id
  JOIN payment_methods pm ON pm.code = ft.method_code
  LEFT JOIN users u ON u.id = ft.created_by`;

function mapLedger(r: Record<string, unknown>): LedgerEntryDto {
  return {
    id: Number(r.id),
    kind: r.kind as 'income' | 'expense',
    categoryId: Number(r.category_id),
    categoryName: String(r.category_name),
    amount: Number(r.amount),
    methodCode: String(r.method_code),
    methodLabel: String(r.method_label),
    paidAt: String(r.paid_at),
    reference: (r.reference as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    patientId: (r.patient_id as number | null) ?? null,
    invoiceId: (r.invoice_id as number | null) ?? null,
    status: r.status as 'posted' | 'reversed',
    createdBy: (r.created_by as number | null) ?? null,
    createdAt: String(r.created_at),
  };
}

function rangeBounds(range?: string, from?: string, to?: string): [string, string] {
  const today = todayIso();
  switch (range) {
    case 'today':
      return [today, today];
    case 'd7':
      return [todayIso(-7), today];
    case 'd30':
      return [todayIso(-30), today];
    case 'd90':
      return [todayIso(-90), today];
    case 'd365':
      return [todayIso(-365), today];
    case 'custom':
      return [from ?? today, to ?? today];
    default:
      return ['2000-01-01', '2999-12-31'];
  }
}

export function listLedger(
  actor: ServiceActor,
  opts: { kind?: string; range?: string; from?: string; to?: string; categoryId?: number; page?: number; pageSize?: number },
): Page<LedgerEntryDto> {
  requirePermission(actor, 'accounting.view');
  const db = currentDb();
  const where: string[] = [];
  const params: unknown[] = [];
  const [start, end] = rangeBounds(opts.range, opts.from, opts.to);
  if (opts.range && opts.range !== 'all') {
    where.push('ft.paid_at >= ? AND ft.paid_at <= ?');
    params.push(start, end + 'T23:59:59');
  }
  if (opts.kind && opts.kind !== 'all') {
    where.push('ft.kind = ?');
    params.push(opts.kind);
  }
  if (opts.categoryId) {
    where.push('ft.category_id = ?');
    params.push(opts.categoryId);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const pageSize = Math.min(200, Math.max(5, opts.pageSize ?? 25));
  const page = Math.max(1, opts.page ?? 1);
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM financial_transactions ft ${whereSql}`).get(...params) as { c: number }
  ).c;
  const rows = db
    .prepare(`${LEDGER_SELECT} ${whereSql} ORDER BY ft.paid_at DESC, ft.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
  return { items: rows.map(mapLedger), total, page, pageSize };
}

export function addLedgerEntry(actor: ServiceActor, input: LedgerEntryInput): { id: number } {
  requirePermission(actor, 'accounting.manage');
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new ServiceError('validation', 'Amount must be positive');
  const db = currentDb();
  const cat = db.prepare('SELECT id, kind FROM accounting_categories WHERE id = ?').get(input.categoryId) as
    | { id: number; kind: string }
    | undefined;
  if (!cat) throw new ServiceError('validation', 'Category does not exist');
  if (cat.kind !== input.kind) throw new ServiceError('validation', 'Category kind does not match entry kind');
  const res = db
    .prepare(
      `INSERT INTO financial_transactions (kind, category_id, amount, method_code, paid_at, reference, notes, patient_id, invoice_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.kind,
      input.categoryId,
      amount,
      input.methodCode || 'cash',
      input.paidAt || nowIso(),
      input.reference || null,
      input.notes || null,
      input.patientId ?? null,
      input.invoiceId ?? null,
      actor.userId,
    );
  const id = Number(res.lastInsertRowid);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: input.kind === 'income' ? 'accounting.income' : 'accounting.expense',
    entity: 'financial_transaction',
    entityId: id,
    after: { amount, category: cat.id, paidAt: input.paidAt },
  });
  return { id };
}

export function reverseLedgerEntry(
  actor: ServiceActor,
  id: number,
  reason: string,
  password: string,
): { ok: boolean; reason?: string } {
  requirePermission(actor, 'accounting.manage');
  assertPassword(actor, password);
  if (!reason?.trim()) throw new ServiceError('validation', 'A reversal reason is required');
  const db = currentDb();
  const entry = db.prepare('SELECT id, status, amount, kind FROM financial_transactions WHERE id = ?').get(id) as
    | { id: number; status: string; amount: number; kind: string }
    | undefined;
  if (!entry) throw new ServiceError('not_found', 'Entry not found', 404);
  if (entry.status !== 'posted') throw new ServiceError('validation', 'Entry is already reversed');
  db.prepare("UPDATE financial_transactions SET status = 'reversed' WHERE id = ?").run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'accounting.reverse',
    entity: 'financial_transaction',
    entityId: id,
    before: { status: 'posted', amount: entry.amount },
    after: { status: 'reversed' },
    metadata: { reason: reason.trim() },
  });
  return { ok: true };
}

/* ================================= REPORTS ================================= */

export function financialSummary(actor: ServiceActor, from: string, to: string): FinancialSummaryReport {
  requirePermission(actor, 'financial.view');
  const db = currentDb();
  const income = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS s FROM financial_transactions
       WHERE kind = 'income' AND status = 'posted' AND paid_at >= ? AND paid_at <= ?`,
    )
    .get(from, to + 'T23:59:59') as { s: number };
  const expense = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS s FROM financial_transactions
       WHERE kind = 'expense' AND status = 'posted' AND paid_at >= ? AND paid_at <= ?`,
    )
    .get(from, to + 'T23:59:59') as { s: number };
  const collected = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS s FROM payments
       WHERE status = 'posted' AND paid_at >= ? AND paid_at <= ?`,
    )
    .get(from + 'T00:00:00', to + 'T23:59:59') as { s: number };
  const outstanding = db
    .prepare(`SELECT COALESCE(SUM(total - paid_total),0) AS s FROM invoices WHERE status IN ('unpaid','partial')`)
    .get() as { s: number };
  const byCategory = db
    .prepare(
      `SELECT c.name, ft.kind, SUM(ft.amount) AS total FROM financial_transactions ft
       JOIN accounting_categories c ON c.id = ft.category_id
       WHERE ft.status = 'posted' AND ft.paid_at >= ? AND ft.paid_at <= ?
       GROUP BY c.id ORDER BY total DESC`,
    )
    .all(from, to + 'T23:59:59') as Record<string, unknown>[];
  return {
    from,
    to,
    income: round2(income.s),
    expense: round2(expense.s),
    net: round2(income.s - expense.s),
    collected: round2(collected.s),
    outstanding: round2(outstanding.s),
    byCategory: byCategory.map((c) => ({
      name: String(c.name),
      kind: String(c.kind),
      total: round2(Number(c.total)),
    })),
  };
}

export function revenueByTreatment(actor: ServiceActor, from: string, to: string): TreatmentRevenueRow[] {
  requirePermission(actor, 'financial.view');
  const rows = currentDb()
    .prepare(
      `SELECT COALESCE(tc.name, ii.description) AS treatment, COUNT(DISTINCT ii.invoice_id) AS cnt,
              SUM(ii.line_total) AS revenue
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id AND i.status != 'void'
       LEFT JOIN treatment_catalog tc ON tc.id = ii.treatment_id
       WHERE i.issued_at >= ? AND i.issued_at <= ?
       GROUP BY treatment ORDER BY revenue DESC LIMIT 100`,
    )
    .all(from, to) as Record<string, unknown>[];
  return rows.map((r) => ({
    treatment: String(r.treatment),
    count: Number(r.cnt),
    revenue: round2(Number(r.revenue)),
  }));
}

export function revenueByDentist(actor: ServiceActor, from: string, to: string): DentistRevenueRow[] {
  requirePermission(actor, 'financial.view');
  const rows = currentDb()
    .prepare(
      `SELECT COALESCE(d.full_name, 'Unassigned') AS dentist, COUNT(DISTINCT v.id) AS visits,
              COALESCE(SUM(ii.line_total),0) AS revenue
       FROM visits v
       LEFT JOIN dentists d ON d.id = v.dentist_id
       LEFT JOIN treatment_records tr ON tr.visit_id = v.id AND tr.deleted_at IS NULL
       LEFT JOIN invoice_items ii ON ii.treatment_record_id = tr.id
       LEFT JOIN invoices i ON i.id = ii.invoice_id AND i.status != 'void'
       WHERE v.visit_at >= ? AND v.visit_at <= ? AND v.deleted_at IS NULL
       GROUP BY dentist ORDER BY revenue DESC LIMIT 100`,
    )
    .all(from, to + 'T23:59:59') as Record<string, unknown>[];
  return rows.map((r) => ({
    dentist: String(r.dentist),
    visits: Number(r.visits),
    revenue: round2(Number(r.revenue)),
  }));
}

export function paymentMethodBreakdown(actor: ServiceActor, from: string, to: string) {
  requirePermission(actor, 'financial.view');
  const rows = currentDb()
    .prepare(
      `SELECT pm.label, SUM(pay.amount) AS total, COUNT(pay.id) AS count
       FROM payments pay JOIN payment_methods pm ON pm.code = pay.method_code
       WHERE pay.status = 'posted' AND pay.paid_at >= ? AND pay.paid_at <= ?
       GROUP BY pm.code, pm.label ORDER BY total DESC`,
    )
    .all(from + 'T00:00:00', to + 'T23:59:59') as Record<string, unknown>[];
  return rows.map((r) => ({ label: String(r.label), total: round2(Number(r.total)), count: Number(r.count) }));
}

export function outstandingBalances(actor: ServiceActor, limit = 500): PatientBalanceRow[] {
  requirePermission(actor, 'financial.view');
  const rows = currentDb()
    .prepare(
      `SELECT p.id, p.patient_code, p.full_name,
              COALESCE(SUM(i.total),0) AS billed,
              COALESCE(SUM(i.paid_total),0) AS paid,
              COALESCE(SUM(i.total - i.paid_total),0) AS balance
       FROM invoices i JOIN patients p ON p.id = i.patient_id
       WHERE i.status IN ('unpaid','partial') AND p.deleted_at IS NULL
       GROUP BY p.id HAVING balance > 0.005
       ORDER BY balance DESC LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    patientId: Number(r.id),
    patientCode: String(r.patient_code),
    patientName: String(r.full_name),
    billed: round2(Number(r.billed)),
    paid: round2(Number(r.paid)),
    balance: round2(Number(r.balance)),
  }));
}

export { tx };
