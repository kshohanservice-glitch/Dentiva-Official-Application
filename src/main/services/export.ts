import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import { currentDb } from '../db/database';
import { paths } from '../paths';
import { recordAudit, requirePermission, type ServiceActor } from './common';
import { todayIso } from '../../shared/format';
import type { ExportInput, ExportResult } from '../../shared/contract';

/** Permission-guarded CSV export (safe format, proper quoting, UTF-8 BOM for Excel/Bengali). */

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export async function exportCsv(actor: ServiceActor, input: ExportInput): Promise<ExportResult> {
  const db = currentDb();
  const from = input.from ?? '2000-01-01';
  const to = input.to ?? todayIso();
  let headers: string[] = [];
  let rows: unknown[][] = [];
  let name = '';

  switch (input.kind) {
    case 'patients': {
      requirePermission(actor, 'patient.export');
      headers = ['Code', 'Name', 'Phone', 'Gender', 'DOB', 'Address', 'Registered', 'Status'];
      rows = (
        db
          .prepare(
            `SELECT patient_code, full_name, phone, gender, dob, address, registered_at, status FROM patients
             WHERE deleted_at IS NULL AND date(registered_at) >= ? AND date(registered_at) <= ?
             ORDER BY registered_at DESC`,
          )
          .all(from, to) as Record<string, unknown>[]
      ).map((r) => [
        r.patient_code,
        r.full_name,
        r.phone,
        r.gender,
        r.dob,
        r.address,
        r.registered_at,
        r.status,
      ]);
      name = 'patients';
      break;
    }
    case 'appointments': {
      requirePermission(actor, 'appointment.view');
      headers = ['Date', 'Time', 'Patient', 'Dentist', 'Status', 'Reason'];
      rows = (
        db
          .prepare(
            `SELECT a.start_at, p.full_name, d.full_name AS dentist, a.status, a.reason
             FROM appointments a JOIN patients p ON p.id = a.patient_id
             JOIN dentists d ON d.id = a.dentist_id
             WHERE a.deleted_at IS NULL AND date(a.start_at) >= ? AND date(a.start_at) <= ?
             ORDER BY a.start_at`,
          )
          .all(from, to) as Record<string, unknown>[]
      ).map((r) => [r.start_at, '', r.full_name, r.dentist, r.status, r.reason]);
      name = 'appointments';
      break;
    }
    case 'invoices': {
      requirePermission(actor, 'invoice.view');
      headers = ['Invoice No', 'Date', 'Patient', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance', 'Status'];
      rows = (
        db
          .prepare(
            `SELECT i.invoice_no, i.issued_at, p.full_name, i.subtotal, i.discount_amount, i.tax_amount,
                    i.total, i.paid_total, (i.total - i.paid_total) AS balance, i.status
             FROM invoices i JOIN patients p ON p.id = i.patient_id
             WHERE date(i.issued_at) >= ? AND date(i.issued_at) <= ? ORDER BY i.issued_at DESC`,
          )
          .all(from, to) as Record<string, unknown>[]
      ).map((r) => [
        r.invoice_no,
        r.issued_at,
        r.full_name,
        r.subtotal,
        r.discount_amount,
        r.tax_amount,
        r.total,
        r.paid_total,
        r.balance,
        r.status,
      ]);
      name = 'invoices';
      break;
    }
    case 'payments': {
      requirePermission(actor, 'payment.view');
      headers = ['Payment No', 'Date', 'Patient', 'Amount', 'Method', 'Reference', 'Status'];
      rows = (
        db
          .prepare(
            `SELECT pay.payment_no, pay.paid_at, p.full_name, pay.amount, pm.label, pay.reference, pay.status
             FROM payments pay JOIN patients p ON p.id = pay.patient_id
             JOIN payment_methods pm ON pm.code = pay.method_code
             WHERE date(pay.paid_at) >= ? AND date(pay.paid_at) <= ? ORDER BY pay.paid_at DESC`,
          )
          .all(from, to) as Record<string, unknown>[]
      ).map((r) => [r.payment_no, r.paid_at, r.full_name, r.amount, r.label, r.reference, r.status]);
      name = 'payments';
      break;
    }
    case 'inventory': {
      requirePermission(actor, 'inventory.view');
      headers = ['Code', 'Name', 'Category', 'Unit', 'Stock', 'Min Stock', 'Purchase Price', 'Location'];
      rows = (
        db
          .prepare(
            `SELECT code, name, category, unit, current_stock, min_stock, purchase_price, location
             FROM inventory_items WHERE deleted_at IS NULL ORDER BY name`,
          )
          .all() as Record<string, unknown>[]
      ).map((r) => [
        r.code,
        r.name,
        r.category,
        r.unit,
        r.current_stock,
        r.min_stock,
        r.purchase_price,
        r.location,
      ]);
      name = 'inventory';
      break;
    }
    case 'accounting': {
      requirePermission(actor, 'accounting.view');
      headers = ['Date', 'Kind', 'Category', 'Amount', 'Method', 'Reference', 'Notes', 'Status'];
      rows = (
        db
          .prepare(
            `SELECT ft.paid_at, ft.kind, c.name, ft.amount, pm.label, ft.reference, ft.notes, ft.status
             FROM financial_transactions ft
             JOIN accounting_categories c ON c.id = ft.category_id
             JOIN payment_methods pm ON pm.code = ft.method_code
             WHERE date(ft.paid_at) >= ? AND date(ft.paid_at) <= ? ORDER BY ft.paid_at DESC`,
          )
          .all(from, to) as Record<string, unknown>[]
      ).map((r) => [r.paid_at, r.kind, r.name, r.amount, r.label, r.reference, r.notes, r.status]);
      name = 'accounting';
      break;
    }
    case 'audit': {
      requirePermission(actor, 'audit.view');
      headers = ['Timestamp', 'User', 'Action', 'Entity', 'Entity ID', 'Result'];
      rows = (
        db
          .prepare(
            `SELECT ts, username, action, entity, entity_id, result FROM audit_log
             WHERE date(ts) >= ? AND date(ts) <= ? ORDER BY ts DESC LIMIT 50000`,
          )
          .all(from, to) as Record<string, unknown>[]
      ).map((r) => [r.ts, r.username, r.action, r.entity, r.entity_id, r.result]);
      name = 'audit';
      break;
    }
    default:
      return { ok: false, reason: 'Unknown export kind' };
  }

  const csv = toCsv(headers, rows);
  const defaultName = `Dentiva-${name}-${from}_${to}.csv`;
  const win = BrowserWindow.getFocusedWindow();
  const dialogOpts: import('electron').SaveDialogOptions = {
    title: 'Export CSV',
    defaultPath: path.join(paths().exports, defaultName),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  };
  const result = win ? await dialog.showSaveDialog(win, dialogOpts) : await dialog.showSaveDialog(dialogOpts);
  if (result.canceled || !result.filePath) {
    return { ok: false, cancelled: true };
  }
  try {
    fs.writeFileSync(result.filePath, csv, 'utf8');
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'export.csv',
      entity: input.kind,
      entityId: path.basename(result.filePath),
      metadata: { rows: rows.length, from, to },
    });
    return { ok: true, path: result.filePath, rowCount: rows.length };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
