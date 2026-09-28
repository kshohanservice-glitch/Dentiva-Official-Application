import { currentDb } from '../db/database';
import type { ServiceActor } from './common';
import type { DashboardData, Page, PatientListItem } from '../../shared/contract';
import { mapListItemFromRow } from './search';

/**
 * Role-aware dashboard. Financial widgets are computed ONLY when the actor
 * holds `financial.view` — authorization happens before any aggregate query.
 */
export function getDashboard(actor: ServiceActor): DashboardData {
  const db = currentDb();
  const today = new Date().toISOString().slice(0, 10);
  const clinicalOk = actor.isSystem || actor.permissions.includes('clinical.view');
  const apptOk = actor.isSystem || actor.permissions.includes('appointment.view');
  const queueOk = actor.isSystem || actor.permissions.includes('queue.manage');
  const patientOk = actor.isSystem || actor.permissions.includes('patient.view');
  const invOk = actor.isSystem || actor.permissions.includes('inventory.view');
  const finOk = actor.isSystem || actor.permissions.includes('financial.view');
  const notifOk = true;

  const todayPatients = patientOk
    ? (
        db
          .prepare(`SELECT COUNT(*) AS c FROM patients WHERE date(registered_at) = date(?, 'localtime') AND deleted_at IS NULL`)
          .get(today) as { c: number }
      ).c
    : 0;

  const todayAppointments = apptOk
    ? (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM appointments WHERE date(start_at) = date(?, 'localtime') AND deleted_at IS NULL
             AND status NOT IN ('Cancelled','No Show')`,
          )
          .get(today) as { c: number }
      ).c
    : 0;

  const waitingQueue = queueOk
    ? (
        db
          .prepare(`SELECT COUNT(*) AS c FROM queue_entries WHERE queue_date = date(?, 'localtime') AND status IN ('waiting','called','in_consultation')`)
          .get(today) as { c: number }
      ).c
    : 0;

  const completedVisits = clinicalOk
    ? (
        db
          .prepare(`SELECT COUNT(*) AS c FROM visits WHERE date(visit_at) = date(?, 'localtime') AND deleted_at IS NULL`)
          .get(today) as { c: number }
      ).c
    : 0;

  const upcomingAppointments = apptOk
    ? (db
        .prepare(
          `SELECT a.id, a.patient_id, p.full_name AS patient_name, p.patient_code, a.dentist_id,
                  d.full_name AS dentist_name, a.start_at, a.end_at, a.duration_min, a.reason, a.treatment_id,
                  tc.name AS treatment_name, a.status, a.notes, a.reminder_min, a.created_by, a.created_at
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           JOIN dentists d ON d.id = a.dentist_id
           LEFT JOIN treatment_catalog tc ON tc.id = a.treatment_id
           WHERE a.deleted_at IS NULL AND a.start_at >= datetime('now','localtime')
             AND a.status IN ('Scheduled','Confirmed')
           ORDER BY a.start_at LIMIT 6`,
        )
        .all() as Record<string, unknown>[]).map((r) => ({
        id: Number(r.id),
        patientId: Number(r.patient_id),
        patientName: String(r.patient_name),
        patientCode: String(r.patient_code),
        dentistId: Number(r.dentist_id),
        dentistName: String(r.dentist_name),
        startAt: String(r.start_at),
        endAt: String(r.end_at),
        durationMin: Number(r.duration_min),
        reason: (r.reason as string | null) ?? null,
        treatmentId: (r.treatment_id as number | null) ?? null,
        treatmentName: (r.treatment_name as string | null) ?? null,
        status: r.status as DashboardData['upcomingAppointments'][number]['status'],
        notes: (r.notes as string | null) ?? null,
        reminderMin: (r.reminder_min as number | null) ?? null,
        createdBy: Number(r.created_by ?? 0),
        createdAt: String(r.created_at),
      }))
    : [];

  const recentPatients: PatientListItem[] = patientOk
    ? (db
        .prepare(
          `SELECT p.id, p.patient_code, p.full_name, p.phone, p.gender, p.dob, p.age, p.address, p.registered_at,
                  p.status, p.allergies,
                  (SELECT MAX(v.visit_at) FROM visits v WHERE v.patient_id = p.id AND v.deleted_at IS NULL) AS last_visit_at,
                  (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id AND v.deleted_at IS NULL) AS visit_count,
                  (SELECT COALESCE(SUM(i.total - i.paid_total),0) FROM invoices i
                     WHERE i.patient_id = p.id AND i.status IN ('unpaid','partial')) AS outstanding
           FROM patients p WHERE p.deleted_at IS NULL ORDER BY p.registered_at DESC LIMIT 6`,
        )
        .all() as Record<string, unknown>[]).map((r) => mapListItemFromRow(r, finOk))
    : [];

  let lowStockCount = 0;
  let expiringCount = 0;
  if (invOk) {
    lowStockCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM inventory_items WHERE deleted_at IS NULL AND active = 1 AND current_stock <= min_stock AND min_stock > 0`,
        )
        .get() as { c: number }
    ).c;
    expiringCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM inventory_batches WHERE qty > 0 AND expiry_date IS NOT NULL
           AND expiry_date <= date('now','+30 days')`,
        )
        .get() as { c: number }
    ).c;
  }

  const unreadNotifications = notifOk
    ? (
        db
          .prepare('SELECT COUNT(*) AS c FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL')
          .get() as { c: number }
      ).c
    : 0;

  let financial: DashboardData['financial'] = null;
  if (finOk) {
    const todayRevenue = (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'posted' AND date(paid_at) = date(?, 'localtime')`,
        )
        .get(today) as { s: number }
    ).s;
    const outstanding = (
      db.prepare(`SELECT COALESCE(SUM(total - paid_total),0) AS s FROM invoices WHERE status IN ('unpaid','partial')`).get() as {
        s: number;
      }
    ).s;
    const todayPayments = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM payments WHERE status = 'posted' AND date(paid_at) = date(?, 'localtime')`,
        )
        .get(today) as { c: number }
    ).c;
    const recentPayments = (
      db
        .prepare(
          `SELECT pay.id, pay.amount, pay.paid_at, p.full_name AS patient_name, pm.label AS method_label
           FROM payments pay JOIN patients p ON p.id = pay.patient_id
           JOIN payment_methods pm ON pm.code = pay.method_code
           WHERE pay.status = 'posted' ORDER BY pay.paid_at DESC, pay.id DESC LIMIT 5`,
        )
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      id: Number(r.id),
      patientName: String(r.patient_name),
      amount: Number(r.amount),
      paidAt: String(r.paid_at),
      methodLabel: String(r.method_label),
    }));
    financial = {
      todayRevenue,
      outstanding,
      todayPayments,
      recentPayments,
    };
  }

  return {
    period: 'today',
    todayPatients,
    todayAppointments,
    waitingQueue,
    completedVisits,
    upcomingAppointments,
    recentPatients,
    lowStockCount,
    expiringCount,
    unreadNotifications,
    financial,
  };
}

export type { Page };
