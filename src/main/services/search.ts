import { currentDb } from '../db/database';
import { requirePermission, type ServiceActor } from './common';
import type { GlobalSearchResult, PatientListItem } from '../../shared/contract';
import { ageFromDob } from '../../shared/format';

/** Fast categorized global search over indexed columns. */

export function mapListItemFromRow(r: Record<string, unknown>, financialOk: boolean): PatientListItem {
  return {
    id: Number(r.id),
    patientCode: String(r.patient_code),
    fullName: String(r.full_name),
    phone: (r.phone as string | null) ?? null,
    gender: (r.gender as string | null) ?? null,
    age: r.age != null ? Number(r.age) : ageFromDob(r.dob as string | null),
    dob: (r.dob as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    registeredAt: String(r.registered_at),
    lastVisitAt: (r.last_visit_at as string | null) ?? null,
    visitCount: Number(r.visit_count ?? 0),
    outstanding: financialOk ? Number(r.outstanding ?? 0) : 0,
    status: (r.status as 'active' | 'archived') ?? 'active',
    allergies: (r.allergies as string | null) ?? null,
  };
}

export function globalSearch(actor: ServiceActor, q: string, limit = 8): GlobalSearchResult[] {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return [];
  const db = currentDb();
  const like = `%${term}%`;
  const results: GlobalSearchResult[] = [];
  const cap = Math.min(30, Math.max(3, limit));

  if (actor.isSystem || actor.permissions.includes('patient.view')) {
    const rows = db
      .prepare(
        `SELECT id, patient_code, full_name, phone FROM patients
         WHERE deleted_at IS NULL AND (LOWER(full_name) LIKE ? OR LOWER(patient_code) LIKE ? OR LOWER(COALESCE(phone,'')) LIKE ?)
         ORDER BY registered_at DESC LIMIT ?`,
      )
      .all(like, like, like, cap) as Record<string, unknown>[];
    for (const r of rows) {
      results.push({
        category: 'patients',
        id: Number(r.id),
        title: String(r.full_name),
        subtitle: `${r.patient_code}${r.phone ? ' · ' + r.phone : ''}`,
        route: `/patients/${r.id}`,
      });
    }
  }

  if (actor.isSystem || actor.permissions.includes('invoice.view')) {
    const rows = db
      .prepare(
        `SELECT i.id, i.invoice_no, i.total, i.status, p.full_name FROM invoices i
         JOIN patients p ON p.id = i.patient_id
         WHERE LOWER(i.invoice_no) LIKE ? OR LOWER(p.full_name) LIKE ?
         ORDER BY i.issued_at DESC LIMIT ?`,
      )
      .all(like, like, Math.ceil(cap / 2)) as Record<string, unknown>[];
    for (const r of rows) {
      results.push({
        category: 'invoices',
        id: Number(r.id),
        title: `Invoice ${r.invoice_no}`,
        subtitle: `${r.full_name} · ৳ ${Number(r.total).toFixed(2)} (${r.status})`,
        route: `/invoices/${r.id}`,
      });
    }
  }

  if (actor.isSystem || actor.permissions.includes('appointment.view')) {
    const rows = db
      .prepare(
        `SELECT a.id, a.start_at, a.status, p.full_name FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE LOWER(p.full_name) LIKE ? OR LOWER(COALESCE(a.reason,'')) LIKE ?
         ORDER BY a.start_at DESC LIMIT ?`,
      )
      .all(like, like, Math.ceil(cap / 3)) as Record<string, unknown>[];
    for (const r of rows) {
      results.push({
        category: 'appointments',
        id: Number(r.id),
        title: `Appointment · ${r.full_name}`,
        subtitle: `${r.start_at} · ${r.status}`,
        route: '/appointments',
      });
    }
  }

  if (actor.isSystem || actor.permissions.includes('prescription.view')) {
    const rows = db
      .prepare(
        `SELECT p.id, p.code, p.prescribed_at, pt.full_name FROM prescriptions p
         JOIN patients pt ON pt.id = p.patient_id
         WHERE p.deleted_at IS NULL AND (LOWER(p.code) LIKE ? OR LOWER(pt.full_name) LIKE ?
           OR EXISTS (SELECT 1 FROM prescription_items i WHERE i.prescription_id = p.id AND LOWER(i.medicine_name) LIKE ?))
         ORDER BY p.prescribed_at DESC LIMIT ?`,
      )
      .all(like, like, like, Math.ceil(cap / 3)) as Record<string, unknown>[];
    for (const r of rows) {
      results.push({
        category: 'prescriptions',
        id: Number(r.id),
        title: `Prescription ${r.code}`,
        subtitle: `${r.full_name} · ${r.prescribed_at}`,
        route: `/prescriptions/${r.id}`,
      });
    }
  }

  if (actor.isSystem || actor.permissions.includes('clinical.view')) {
    const rows = db
      .prepare(
        `SELECT id, code, name FROM treatment_catalog
         WHERE LOWER(name) LIKE ? OR LOWER(code) LIKE ? LIMIT ?`,
      )
      .all(like, like, 5) as Record<string, unknown>[];
    for (const r of rows) {
      results.push({
        category: 'treatments',
        id: Number(r.id),
        title: String(r.name),
        subtitle: `Treatment · ${r.code}`,
        route: '/treatments',
      });
    }
  }

  if (actor.isSystem || actor.permissions.includes('inventory.view')) {
    const rows = db
      .prepare(
        `SELECT id, name, code, current_stock FROM inventory_items
         WHERE deleted_at IS NULL AND (LOWER(name) LIKE ? OR LOWER(code) LIKE ?) LIMIT ?`,
      )
      .all(like, like, 5) as Record<string, unknown>[];
    for (const r of rows) {
      results.push({
        category: 'inventory',
        id: Number(r.id),
        title: String(r.name),
        subtitle: `Inventory · ${r.code} · stock ${r.current_stock}`,
        route: '/inventory',
      });
    }
  }

  if (actor.isSystem || actor.permissions.includes('staff.view')) {
    const rows = db
      .prepare(
        `SELECT id, full_name, designation FROM staff
         WHERE deleted_at IS NULL AND LOWER(full_name) LIKE ? LIMIT ?`,
      )
      .all(like, 5) as Record<string, unknown>[];
    for (const r of rows) {
      results.push({
        category: 'staff',
        id: Number(r.id),
        title: String(r.full_name),
        subtitle: r.designation ? `Staff · ${r.designation}` : 'Staff',
        route: '/staff',
      });
    }
  }

  if (actor.isSystem || actor.permissions.includes('payment.view')) {
    const rows = db
      .prepare(
        `SELECT pay.id, pay.payment_no, pay.amount, p.full_name FROM payments pay
         JOIN patients p ON p.id = pay.patient_id
         WHERE LOWER(pay.payment_no) LIKE ? OR LOWER(p.full_name) LIKE ?
         ORDER BY pay.paid_at DESC LIMIT ?`,
      )
      .all(like, like, 5) as Record<string, unknown>[];
    for (const r of rows) {
      results.push({
        category: 'payments',
        id: Number(r.id),
        title: `Payment ${r.payment_no}`,
        subtitle: `${r.full_name} · ৳ ${Number(r.amount).toFixed(2)}`,
        route: '/payments',
      });
    }
  }

  return results;
}

export { requirePermission };
