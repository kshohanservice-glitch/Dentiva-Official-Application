import { currentDb, tx } from '../db/database';
import { recordAudit, requirePermission, ServiceError, type ServiceActor } from './common';
import { nowIso } from '../../shared/format';
import type {
  AppointmentConflict,
  AppointmentDto,
  AppointmentInput,
  AppointmentSaveResult,
  AppointmentStatus,
  QueueCheckInInput,
  QueueEntryDto,
  QueueStatus,
} from '../../shared/contract';

/* =============================== APPOINTMENTS =============================== */

const BLOCKING_STATUSES = ['Scheduled', 'Confirmed', 'Checked In', 'In Progress'];

function addMinutes(iso: string, mins: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + mins);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

function mapAppointment(r: Record<string, unknown>): AppointmentDto {
  return {
    id: Number(r.id),
    patientId: Number(r.patient_id),
    patientName: String(r.patient_name ?? ''),
    patientCode: String(r.patient_code ?? ''),
    dentistId: Number(r.dentist_id),
    dentistName: String(r.dentist_name ?? ''),
    startAt: String(r.start_at),
    endAt: String(r.end_at),
    durationMin: Number(r.duration_min),
    reason: (r.reason as string | null) ?? null,
    treatmentId: (r.treatment_id as number | null) ?? null,
    treatmentName: (r.treatment_name as string | null) ?? null,
    status: r.status as AppointmentStatus,
    notes: (r.notes as string | null) ?? null,
    reminderMin: (r.reminder_min as number | null) ?? null,
    createdBy: Number(r.created_by ?? 0),
    createdAt: String(r.created_at),
  };
}

const APPT_SELECT = `
  SELECT a.*, p.full_name AS patient_name, p.patient_code, d.full_name AS dentist_name, tc.name AS treatment_name
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN dentists d ON d.id = a.dentist_id
  LEFT JOIN treatment_catalog tc ON tc.id = a.treatment_id`;

export function findConflicts(
  dentistId: number,
  startAt: string,
  durationMin: number,
  ignoreId?: number,
): AppointmentConflict[] {
  const endAt = addMinutes(startAt, durationMin);
  const db = currentDb();
  const rows = db
    .prepare(
      `${APPT_SELECT} WHERE a.dentist_id = ? AND a.deleted_at IS NULL AND a.id != COALESCE(?, -1)
        AND a.status IN (${BLOCKING_STATUSES.map(() => '?').join(',')})
        AND a.start_at < ? AND a.end_at > ?`,
    )
    .all(dentistId, ignoreId ?? null, ...BLOCKING_STATUSES, endAt, startAt) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    patientName: String(r.patient_name),
    dentistName: String(r.dentist_name),
    startAt: String(r.start_at),
    endAt: String(r.end_at),
  }));
}

export function listAppointments(
  actor: ServiceActor,
  opts: { from: string; to: string; dentistId?: number; status?: string; patientId?: number },
): AppointmentDto[] {
  requirePermission(actor, 'appointment.view');
  const db = currentDb();
  const where = ['a.deleted_at IS NULL', 'a.start_at <= ?', 'a.end_at >= ?'];
  const params: unknown[] = [opts.to + 'T23:59:59', opts.from + 'T00:00:00'];
  if (opts.dentistId) {
    where.push('a.dentist_id = ?');
    params.push(opts.dentistId);
  }
  if (opts.status && opts.status !== 'all') {
    where.push('a.status = ?');
    params.push(opts.status);
  }
  if (opts.patientId) {
    where.push('a.patient_id = ?');
    params.push(opts.patientId);
  }
  const rows = db
    .prepare(`${APPT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.start_at`)
    .all(...params) as Record<string, unknown>[];
  return rows.map(mapAppointment);
}

export function getAppointment(actor: ServiceActor, id: number): AppointmentDto {
  requirePermission(actor, 'appointment.view');
  const r = currentDb().prepare(`${APPT_SELECT} WHERE a.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) throw new ServiceError('not_found', 'Appointment not found', 404);
  return mapAppointment(r);
}

export function saveAppointment(
  actor: ServiceActor,
  input: AppointmentInput,
  opts: { allowConflictOverride?: boolean } = {},
): AppointmentSaveResult {
  requirePermission(actor, input.id ? 'appointment.edit' : 'appointment.create');
  if (!input.patientId) throw new ServiceError('validation', 'Patient is required');
  if (!input.dentistId) throw new ServiceError('validation', 'Dentist is required');
  if (!input.startAt || Number.isNaN(Date.parse(input.startAt))) {
    throw new ServiceError('validation', 'Valid start time is required');
  }
  const duration = Number(input.durationMin);
  if (!Number.isFinite(duration) || duration < 5 || duration > 24 * 60) {
    throw new ServiceError('validation', 'Duration must be between 5 minutes and 24 hours');
  }
  const db = currentDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ServiceError('not_found', 'Patient not found', 404);
  const dentist = db.prepare('SELECT id FROM dentists WHERE id = ? AND deleted_at IS NULL').get(input.dentistId);
  if (!dentist) throw new ServiceError('not_found', 'Dentist not found', 404);

  const conflicts = findConflicts(input.dentistId, input.startAt, duration, input.id);
  if (conflicts.length > 0 && !opts.allowConflictOverride) {
    return { ok: false, conflict: conflicts[0] };
  }

  const endAt = addMinutes(input.startAt, duration);
  let id = input.id ?? 0;
  tx(() => {
    if (input.id) {
      const before = db.prepare('SELECT status FROM appointments WHERE id = ? AND deleted_at IS NULL').get(input.id);
      if (!before) throw new ServiceError('not_found', 'Appointment not found', 404);
      db.prepare(
        `UPDATE appointments SET patient_id=?, dentist_id=?, start_at=?, end_at=?, duration_min=?, reason=?,
          treatment_id=?, status=?, notes=?, reminder_min=?, updated_at=datetime('now','localtime') WHERE id=?`,
      ).run(
        input.patientId,
        input.dentistId,
        input.startAt,
        endAt,
        duration,
        input.reason || null,
        input.treatmentId ?? null,
        input.status || 'Scheduled',
        input.notes || null,
        input.reminderMin ?? null,
        input.id,
      );
      id = input.id;
    } else {
      const res = db
        .prepare(
          `INSERT INTO appointments (patient_id, dentist_id, start_at, end_at, duration_min, reason, treatment_id,
            status, notes, reminder_min, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.patientId,
          input.dentistId,
          input.startAt,
          endAt,
          duration,
          input.reason || null,
          input.treatmentId ?? null,
          input.status || 'Scheduled',
          input.notes || null,
          input.reminderMin ?? null,
          actor.userId,
        );
      id = Number(res.lastInsertRowid);
    }
  });
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: input.id ? 'appointment.update' : 'appointment.create',
    entity: 'appointment',
    entityId: id,
    after: { startAt: input.startAt, dentistId: input.dentistId, status: input.status ?? 'Scheduled' },
  });
  const saved = getAppointment(actor, id);
  return { ok: true, appointment: saved };
}

export function setAppointmentStatus(
  actor: ServiceActor,
  id: number,
  status: AppointmentStatus,
): AppointmentSaveResult {
  requirePermission(actor, 'appointment.edit');
  const db = currentDb();
  const before = db.prepare('SELECT status FROM appointments WHERE id = ? AND deleted_at IS NULL').get(id) as
    | { status: string }
    | undefined;
  if (!before) throw new ServiceError('not_found', 'Appointment not found', 404);
  db.prepare("UPDATE appointments SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(
    status,
    id,
  );
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'appointment.status',
    entity: 'appointment',
    entityId: id,
    before: { status: before.status },
    after: { status },
  });
  return { ok: true, appointment: getAppointment(actor, id) };
}

export function deleteAppointment(actor: ServiceActor, id: number): { ok: boolean } {
  requirePermission(actor, 'appointment.delete');
  currentDb().prepare("UPDATE appointments SET deleted_at = datetime('now','localtime') WHERE id = ?").run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'appointment.delete',
    entity: 'appointment',
    entityId: id,
  });
  return { ok: true };
}

/* =================================== QUEUE =================================== */

function mapQueue(r: Record<string, unknown>): QueueEntryDto {
  return {
    id: Number(r.id),
    number: Number(r.number),
    queueDate: String(r.queue_date),
    patientId: Number(r.patient_id),
    patientName: String(r.patient_name ?? ''),
    patientCode: String(r.patient_code ?? ''),
    dentistId: (r.dentist_id as number | null) ?? null,
    dentistName: (r.dentist_name as string | null) ?? null,
    appointmentId: (r.appointment_id as number | null) ?? null,
    priority: Number(r.priority ?? 0),
    status: r.status as QueueStatus,
    checkedInAt: String(r.checked_in_at),
    calledAt: (r.called_at as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null,
  };
}

export function listQueue(actor: ServiceActor, date?: string): QueueEntryDto[] {
  requirePermission(actor, 'queue.manage');
  const day = date || nowIso().slice(0, 10);
  const rows = currentDb()
    .prepare(
      `SELECT q.*, p.full_name AS patient_name, p.patient_code, d.full_name AS dentist_name
       FROM queue_entries q
       JOIN patients p ON p.id = q.patient_id
       LEFT JOIN dentists d ON d.id = q.dentist_id
       WHERE q.queue_date = ?
       ORDER BY q.priority DESC, q.number ASC`,
    )
    .all(day) as Record<string, unknown>[];
  return rows.map(mapQueue);
}

export function checkInQueue(actor: ServiceActor, input: QueueCheckInInput): { id: number; number: number } {
  requirePermission(actor, 'queue.manage');
  if (!input.patientId) throw new ServiceError('validation', 'Patient is required');
  const db = currentDb();
  const day = nowIso().slice(0, 10);
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ServiceError('not_found', 'Patient not found', 404);

  let id = 0;
  let number = 0;
  try {
    tx(() => {
      const active = db
        .prepare(
          `SELECT id, number FROM queue_entries WHERE queue_date = ? AND patient_id = ?
           AND status IN ('waiting','called','in_consultation')`,
        )
        .get(day, input.patientId) as { id: number; number: number } | undefined;
      if (active) {
        id = active.id;
        number = active.number;
        return;
      }
      const maxRow = db.prepare('SELECT COALESCE(MAX(number), 0) AS m FROM queue_entries WHERE queue_date = ?').get(day) as {
        m: number;
      };
      number = maxRow.m + 1;
      const res = db
        .prepare(
          `INSERT INTO queue_entries (queue_date, number, patient_id, dentist_id, appointment_id, priority, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          day,
          number,
          input.patientId,
          input.dentistId ?? null,
          input.appointmentId ?? null,
          input.priority ?? 0,
          actor.userId,
        );
      id = Number(res.lastInsertRowid);
    });
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      throw new ServiceError('validation', 'Patient is already in today’s active queue', 409);
    }
    throw err;
  }
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'queue.checkin',
    entity: 'queue_entry',
    entityId: id,
    after: { number, patientId: input.patientId },
  });
  return { id, number };
}

const QUEUE_TRANSITIONS: Record<QueueStatus, QueueStatus[]> = {
  waiting: ['called', 'skipped', 'cancelled'],
  called: ['in_consultation', 'waiting', 'skipped', 'cancelled'],
  in_consultation: ['completed', 'waiting', 'cancelled'],
  completed: [],
  skipped: ['waiting'],
  cancelled: ['waiting'],
};

export function setQueueStatus(actor: ServiceActor, id: number, status: QueueStatus): void {
  requirePermission(actor, 'queue.manage');
  const db = currentDb();
  const entry = db.prepare('SELECT status FROM queue_entries WHERE id = ?').get(id) as
    | { status: QueueStatus }
    | undefined;
  if (!entry) throw new ServiceError('not_found', 'Queue entry not found', 404);
  if (!QUEUE_TRANSITIONS[entry.status]?.includes(status)) {
    throw new ServiceError('validation', `Cannot move queue entry from ${entry.status} to ${status}`);
  }
  const now = nowIso();
  tx(() => {
    db.prepare(
      `UPDATE queue_entries SET status = ?, updated_at = datetime('now','localtime'),
        called_at = CASE WHEN ? = 'called' THEN ? ELSE called_at END,
        completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END
       WHERE id = ?`,
    ).run(status, status, now, status, now, id);
  });
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'queue.status',
    entity: 'queue_entry',
    entityId: id,
    before: { status: entry.status },
    after: { status },
  });
}

export function callNext(actor: ServiceActor, dentistId?: number | null): { entry: QueueEntryDto | null } {
  requirePermission(actor, 'queue.manage');
  const db = currentDb();
  const day = nowIso().slice(0, 10);
  const params: unknown[] = [day];
  let dentistFilter = '';
  if (dentistId) {
    dentistFilter = ' AND (dentist_id = ? OR dentist_id IS NULL)';
    params.push(dentistId);
  }
  const next = db
    .prepare(
      `SELECT id FROM queue_entries WHERE queue_date = ? AND status = 'waiting' ${dentistFilter}
       ORDER BY priority DESC, number ASC LIMIT 1`,
    )
    .get(...params) as { id: number } | undefined;
  if (!next) return { entry: null };
  setQueueStatus(actor, next.id, 'called');
  const row = db
    .prepare(
      `SELECT q.*, p.full_name AS patient_name, p.patient_code, d.full_name AS dentist_name
       FROM queue_entries q JOIN patients p ON p.id = q.patient_id
       LEFT JOIN dentists d ON d.id = q.dentist_id WHERE q.id = ?`,
    )
    .get(next.id) as Record<string, unknown>;
  return { entry: mapQueue(row) };
}
