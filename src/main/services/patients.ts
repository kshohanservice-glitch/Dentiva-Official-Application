import { currentDb } from '../db/database';
import { recordAudit, requirePermission, ServiceError, type ServiceActor } from './common';
import { assertPassword } from './admin';
import { getAllSettings } from './settings';
import { ageFromDob, nowIso, sanitizeText, todayIso } from '../../shared/format';
import type {
  PatientInput,
  PatientListItem,
  PatientListQuery,
  PatientProfile,
  Page,
  TimelineEntry,
} from '../../shared/contract';

/** Patient management — unlimited practical records, indexed search, safe deletion. */

function nextPatientCode(): string {
  const db = currentDb();
  const g = getAllSettings().general;
  const prefix = String(g.patientCodePrefix || 'P');
  const digits = Number(g.patientCodeDigits || 5);
  const row = db.prepare("SELECT value FROM system_state WHERE key = 'counter.patient'").get() as
    | { value: string }
    | undefined;
  const n = row ? Number(row.value) + 1 : 1;
  db.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES ('counter.patient', ?, datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(n));
  return `${prefix}${String(n).padStart(digits, '0')}`;
}

export function listPatients(actor: ServiceActor, q: PatientListQuery): Page<PatientListItem> {
  requirePermission(actor, 'patient.view');
  const db = currentDb();
  const where: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];

  const status = q.status ?? 'active';
  if (status !== 'all') {
    where.push('p.status = ?');
    params.push(status);
  }
  if (q.q && q.q.trim()) {
    const like = `%${q.q.trim().toLowerCase()}%`;
    where.push(
      `(LOWER(p.full_name) LIKE ? OR LOWER(COALESCE(p.preferred_name,'')) LIKE ?
        OR LOWER(p.patient_code) LIKE ? OR LOWER(COALESCE(p.phone,'')) LIKE ?
        OR LOWER(COALESCE(p.address,'')) LIKE ?)`,
    );
    params.push(like, like, like, like, like);
  }
  if (q.range && q.range !== 'all') {
    const [from, to] = resolveRange(q);
    if (from) {
      where.push('p.registered_at >= ?');
      params.push(from);
    }
    if (to) {
      where.push('p.registered_at <= ?');
      params.push(to + 'T23:59:59');
    }
  }
  if (q.hasBalance) {
    where.push(
      `(SELECT COALESCE(SUM(i.total - i.paid_total),0) FROM invoices i WHERE i.patient_id = p.id AND i.status IN ('unpaid','partial')) > 0`,
    );
  }
  if (q.treatmentId) {
    where.push(
      'EXISTS (SELECT 1 FROM treatment_records tr WHERE tr.patient_id = p.id AND tr.treatment_id = ? AND tr.deleted_at IS NULL)',
    );
    params.push(q.treatmentId);
  }
  if (q.dentistId) {
    where.push(
      'EXISTS (SELECT 1 FROM visits v WHERE v.patient_id = p.id AND v.dentist_id = ? AND v.deleted_at IS NULL)',
    );
    params.push(q.dentistId);
  }

  const orderBy =
    q.sort === 'oldest'
      ? 'p.registered_at ASC'
      : q.sort === 'name_asc'
        ? 'p.full_name COLLATE NOCASE ASC'
        : q.sort === 'name_desc'
          ? 'p.full_name COLLATE NOCASE DESC'
          : q.sort === 'last_visit'
            ? '(SELECT MAX(v.visit_at) FROM visits v WHERE v.patient_id = p.id AND v.deleted_at IS NULL) DESC NULLS LAST'
            : 'p.registered_at DESC';

  const pageSize = clampPageSize(q.pageSize);
  const page = Math.max(1, q.page ?? 1);
  const whereSql = where.join(' AND ');

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM patients p WHERE ${whereSql}`).get(...params) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT p.id, p.patient_code, p.full_name, p.phone, p.gender, p.dob, p.age, p.address,
              p.registered_at, p.status, p.allergies,
              (SELECT MAX(v.visit_at) FROM visits v WHERE v.patient_id = p.id AND v.deleted_at IS NULL) AS last_visit_at,
              (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id AND v.deleted_at IS NULL) AS visit_count,
              (SELECT COALESCE(SUM(i.total - i.paid_total),0) FROM invoices i
                 WHERE i.patient_id = p.id AND i.status IN ('unpaid','partial')) AS outstanding
       FROM patients p
       WHERE ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];

  const financialOk = actor.permissions.includes('financial.view') || actor.isSystem === true;
  return {
    items: rows.map((r) => mapListItem(r, financialOk)),
    total,
    page,
    pageSize,
  };
}

function clampPageSize(size?: number): number {
  const s = size ?? 25;
  return Math.min(200, Math.max(5, s));
}

function resolveRange(q: PatientListQuery): [string | null, string | null] {
  const today = todayIso();
  switch (q.range) {
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
      return [q.from ?? null, q.to ?? null];
    default:
      return [null, null];
  }
}

function mapListItem(r: Record<string, unknown>, financialOk: boolean): PatientListItem {
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

export function getPatientProfile(actor: ServiceActor, id: number): PatientProfile {
  requirePermission(actor, 'patient.view');
  const db = currentDb();
  const p = db.prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw new ServiceError('not_found', 'Patient not found', 404);

  const clinical = {
    totalVisits: (
      db.prepare('SELECT COUNT(*) AS c FROM visits WHERE patient_id = ? AND deleted_at IS NULL').get(id) as {
        c: number;
      }
    ).c,
    lastVisitAt:
      (
        db
          .prepare(
            'SELECT MAX(visit_at) AS m FROM visits WHERE patient_id = ? AND deleted_at IS NULL',
          )
          .get(id) as { m: string | null }
      ).m ?? null,
    nextAppointment: null as PatientProfile['clinical']['nextAppointment'],
    activeTreatments: (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM treatment_records WHERE patient_id = ? AND status = 'planned' AND deleted_at IS NULL",
        )
        .get(id) as { c: number }
    ).c,
    totalPrescriptions: (
      db.prepare('SELECT COUNT(*) AS c FROM prescriptions WHERE patient_id = ? AND deleted_at IS NULL').get(id) as {
        c: number;
      }
    ).c,
    totalInvoices: (
      db.prepare("SELECT COUNT(*) AS c FROM invoices WHERE patient_id = ? AND status != 'void'").get(id) as {
        c: number;
      }
    ).c,
  };

  // next appointment only if permission allows viewing appointments
  if (actor.permissions.includes('appointment.view') || actor.isSystem) {
    const appt = db
      .prepare(
        `SELECT * FROM appointments WHERE patient_id = ? AND deleted_at IS NULL
         AND start_at >= datetime('now','localtime')
         AND status IN ('Scheduled','Confirmed') ORDER BY start_at LIMIT 1`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (appt) clinical.nextAppointment = mapAppointment(appt);
  }

  const financialOk = actor.permissions.includes('financial.view') || actor.isSystem === true;
  const fin = financialOk
    ? (db
        .prepare(
          `SELECT COALESCE(SUM(total),0) AS billed,
                  COALESCE((SELECT SUM(amount) FROM payments WHERE patient_id = ? AND status = 'posted'),0) AS paid
           FROM invoices WHERE patient_id = ? AND status != 'void'`,
        )
        .get(id, id) as { billed: number; paid: number })
    : { billed: 0, paid: 0 };

  const stats = db
    .prepare(
      `SELECT
        SUM(CASE WHEN start_at >= datetime('now','localtime') AND status IN ('Scheduled','Confirmed') THEN 1 ELSE 0 END) AS upcoming,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN status = 'No Show' THEN 1 ELSE 0 END) AS no_show
       FROM appointments WHERE patient_id = ? AND deleted_at IS NULL`,
    )
    .get(id) as Record<string, number | null>;

  const attachments = db
    .prepare(
      `SELECT a.id, a.patient_id, a.filename, a.mime, a.size, a.created_at, u.username AS uploader
       FROM patient_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.patient_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC`,
    )
    .all(id) as Record<string, unknown>[];

  const referrals = db
    .prepare('SELECT * FROM referrals WHERE patient_id = ? ORDER BY referral_date DESC')
    .all(id) as Record<string, unknown>[];

  const notes = db
    .prepare(
      `SELECT n.id, n.body, n.created_at, u.username AS author FROM patient_notes n
       LEFT JOIN users u ON u.id = n.created_by WHERE n.patient_id = ? ORDER BY n.created_at DESC`,
    )
    .all(id) as Record<string, unknown>[];

  return {
    patient: {
      ...(mapListItem({ ...p, visit_count: clinical.totalVisits, last_visit_at: clinical.lastVisitAt }, financialOk) as PatientListItem),
      ...normalizePatientInput(p),
      createdAt: String(p.created_at),
      createdBy: (p.created_by as number | null) ?? null,
      updatedAt: String(p.updated_at),
    },
    alerts: {
      allergies: (p.allergies as string | null) ?? null,
      medicalHistory: (p.medical_history as string | null) ?? null,
      emergencyNotes: (p.emergency_notes as string | null) ?? null,
      notes: (p.notes as string | null) ?? null,
    },
    clinical,
    financial: {
      permitted: financialOk,
      totalBilled: Number(fin.billed),
      totalPaid: Number(fin.paid),
      outstanding: Number(fin.billed) - Number(fin.paid),
    },
    appointmentStats: {
      upcoming: Number(stats.upcoming ?? 0),
      completed: Number(stats.completed ?? 0),
      cancelled: Number(stats.cancelled ?? 0),
      noShow: Number(stats.no_show ?? 0),
    },
    attachments: attachments.map((a) => ({
      id: Number(a.id),
      patientId: Number(a.patient_id),
      filename: String(a.filename),
      mime: String(a.mime),
      size: Number(a.size),
      createdAt: String(a.created_at),
      uploadedBy: (a.uploader as string | null) ?? null,
    })),
    referrals: referrals.map(mapReferral),
    notes: notes.map((n) => ({
      id: Number(n.id),
      body: String(n.body),
      author: (n.author as string | null) ?? null,
      createdAt: String(n.created_at),
    })),
  };
}

function normalizePatientInput(p: Record<string, unknown>): Omit<PatientInput, 'fullName'> & { fullName: string } {
  return {
    fullName: String(p.full_name),
    preferredName: (p.preferred_name as string | null) ?? undefined,
    dob: (p.dob as string | null) ?? null,
    age: (p.age as number | null) ?? ageFromDob(p.dob as string | null),
    gender: (p.gender as string | null) ?? null,
    bloodGroup: (p.blood_group as string | null) ?? null,
    phone: (p.phone as string | null) ?? undefined,
    emergencyPhone: (p.emergency_phone as string | null) ?? undefined,
    email: (p.email as string | null) ?? undefined,
    address: (p.address as string | null) ?? undefined,
    occupation: (p.occupation as string | null) ?? undefined,
    source: (p.source as string | null) ?? undefined,
    chiefComplaint: (p.chief_complaint as string | null) ?? undefined,
    previousProblems: (p.previous_problems as string | null) ?? undefined,
    medicalHistory: (p.medical_history as string | null) ?? undefined,
    dentalHistory: (p.dental_history as string | null) ?? undefined,
    allergies: (p.allergies as string | null) ?? undefined,
    currentMedication: (p.current_medication as string | null) ?? undefined,
    notes: (p.notes as string | null) ?? undefined,
    emergencyNotes: (p.emergency_notes as string | null) ?? undefined,
    status: (p.status as 'active' | 'archived') ?? 'active',
  };
}

function mapAppointment(r: Record<string, unknown>): PatientProfile['clinical']['nextAppointment'] {
  return {
    id: Number(r.id),
    patientId: Number(r.patient_id),
    patientName: '',
    patientCode: '',
    dentistId: Number(r.dentist_id),
    dentistName: '',
    startAt: String(r.start_at),
    endAt: String(r.end_at),
    durationMin: Number(r.duration_min),
    reason: (r.reason as string | null) ?? null,
    treatmentId: (r.treatment_id as number | null) ?? null,
    treatmentName: null,
    status: r.status as PatientProfile['clinical']['nextAppointment'] extends null
      ? never
      : NonNullable<PatientProfile['clinical']['nextAppointment']>['status'],
    notes: (r.notes as string | null) ?? null,
    reminderMin: (r.reminder_min as number | null) ?? null,
    createdBy: Number(r.created_by ?? 0),
    createdAt: String(r.created_at),
  };
}

function mapReferral(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    patientId: Number(r.patient_id),
    referringName: (r.referring_name as string | null) ?? null,
    referredTo: (r.referred_to as string | null) ?? null,
    specialty: (r.specialty as string | null) ?? null,
    organization: (r.organization as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    referralDate: String(r.referral_date),
    notes: (r.notes as string | null) ?? null,
    followUp: (r.follow_up as string | null) ?? null,
    status: r.status as 'referred' | 'followed_up' | 'closed',
    createdAt: String(r.created_at),
  };
}

const PHONE_LIKE = /^[+]?[\d\s\-()]{6,20}$/;

export function createPatient(actor: ServiceActor, input: PatientInput): { id: number; patientCode: string } {
  requirePermission(actor, 'patient.create');
  validatePatientInput(input);
  if (input.phone) {
    const dup = findDuplicateMatches(input.phone, input.fullName).slice(0, 5);
    // duplicates are surfaced to the UI for confirmation, not hard-blocked
    void dup;
  }
  const code = nextPatientCode();
  const db = currentDb();
  const res = db
    .prepare(
      `INSERT INTO patients (patient_code, full_name, preferred_name, dob, age, gender, blood_group, phone,
        emergency_phone, email, address, occupation, source, chief_complaint, previous_problems, medical_history,
        dental_history, allergies, current_medication, notes, emergency_notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      code,
      input.fullName.trim(),
      input.preferredName?.trim() || null,
      input.dob || null,
      input.age ?? null,
      input.gender || null,
      input.bloodGroup || null,
      input.phone || null,
      input.emergencyPhone || null,
      input.email || null,
      input.address || null,
      input.occupation || null,
      input.source || null,
      input.chiefComplaint || null,
      input.previousProblems || null,
      input.medicalHistory || null,
      input.dentalHistory || null,
      input.allergies || null,
      input.currentMedication || null,
      input.notes || null,
      input.emergencyNotes || null,
      actor.userId,
      actor.userId,
    );
  const id = Number(res.lastInsertRowid);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'patient.create',
    entity: 'patient',
    entityId: id,
    after: { patientCode: code, fullName: input.fullName },
  });
  return { id, patientCode: code };
}

function validatePatientInput(input: PatientInput): void {
  if (!input.fullName || input.fullName.trim().length < 2) {
    throw new ServiceError('validation', 'Patient full name is required (min 2 characters)');
  }
  if (input.phone && !PHONE_LIKE.test(input.phone.trim())) {
    throw new ServiceError('validation', 'Phone number format is invalid');
  }
  if (input.emergencyPhone && !PHONE_LIKE.test(input.emergencyPhone.trim())) {
    throw new ServiceError('validation', 'Emergency phone number format is invalid');
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    throw new ServiceError('validation', 'Email format is invalid');
  }
  if (input.dob && Number.isNaN(Date.parse(input.dob))) {
    throw new ServiceError('validation', 'Date of birth is invalid');
  }
}

export function updatePatient(actor: ServiceActor, input: PatientInput): void {
  requirePermission(actor, 'patient.edit');
  if (!input.id) throw new ServiceError('validation', 'Patient id required');
  validatePatientInput(input);
  const db = currentDb();
  const before = db.prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.id);
  if (!before) throw new ServiceError('not_found', 'Patient not found', 404);
  db.prepare(
    `UPDATE patients SET full_name=?, preferred_name=?, dob=?, age=?, gender=?, blood_group=?, phone=?,
      emergency_phone=?, email=?, address=?, occupation=?, source=?, chief_complaint=?, previous_problems=?,
      medical_history=?, dental_history=?, allergies=?, current_medication=?, notes=?, emergency_notes=?, status=?,
      updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`,
  ).run(
    input.fullName.trim(),
    input.preferredName?.trim() || null,
    input.dob || null,
    input.age ?? null,
    input.gender || null,
    input.bloodGroup || null,
    input.phone || null,
    input.emergencyPhone || null,
    input.email || null,
    input.address || null,
    input.occupation || null,
    input.source || null,
    input.chiefComplaint || null,
    input.previousProblems || null,
    input.medicalHistory || null,
    input.dentalHistory || null,
    input.allergies || null,
    input.currentMedication || null,
    input.notes || null,
    input.emergencyNotes || null,
    input.status ?? 'active',
    actor.userId,
    input.id,
  );
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'patient.update',
    entity: 'patient',
    entityId: input.id,
    before: { fullName: (before as Record<string, unknown>).full_name },
    after: { fullName: input.fullName },
  });
}

export function setPatientStatus(actor: ServiceActor, id: number, status: 'active' | 'archived'): void {
  requirePermission(actor, status === 'archived' ? 'patient.edit' : 'patient.restore');
  const db = currentDb();
  const p = db.prepare('SELECT id, full_name, status FROM patients WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!p) throw new ServiceError('not_found', 'Patient not found', 404);
  db.prepare("UPDATE patients SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(status, id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: status === 'archived' ? 'patient.archive' : 'patient.restore',
    entity: 'patient',
    entityId: id,
    before: { status: (p as { status: string }).status },
    after: { status },
  });
}

/**
 * Safe deletion policy: patients with clinical/financial history are archived
 * (soft-deleted) instead of destroyed; hard delete requires admin password +
 * typed confirmation and only removes patients with no related financial rows.
 */
export function deletePatient(
  actor: ServiceActor,
  id: number,
  password: string,
  confirmPhrase?: string,
): { ok: boolean; reason?: string } {
  requirePermission(actor, 'patient.delete');
  const db = currentDb();
  const p = db.prepare('SELECT id, full_name, patient_code FROM patients WHERE id = ? AND deleted_at IS NULL').get(id) as
    | { id: number; full_name: string; patient_code: string }
    | undefined;
  if (!p) throw new ServiceError('not_found', 'Patient not found', 404);

  const invoices = (
    db.prepare("SELECT COUNT(*) AS c FROM invoices WHERE patient_id = ? AND status != 'void'").get(id) as {
      c: number;
    }
  ).c;
  const payments = (db.prepare('SELECT COUNT(*) AS c FROM payments WHERE patient_id = ?').get(id) as { c: number }).c;

  if (invoices > 0 || payments > 0) {
    // clinical/financial integrity wins: archive only
    assertPassword(actor, password);
    db.prepare("UPDATE patients SET status = 'archived', deleted_at = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?").run(id);
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'patient.archive_protected',
      entity: 'patient',
      entityId: id,
      metadata: { invoices, payments, reason: 'financial_history_present' },
    });
    return { ok: true, reason: 'archived_financial_history' };
  }

  assertPassword(actor, password);
  if (confirmPhrase !== p.patient_code && confirmPhrase !== p.full_name) {
    throw new ServiceError('validation', `Type the patient code "${p.patient_code}" to confirm deletion`);
  }
  db.prepare('UPDATE patients SET deleted_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'patient.delete',
    entity: 'patient',
    entityId: id,
    before: { patientCode: p.patient_code, fullName: p.full_name },
  });
  return { ok: true };
}

export function findDuplicateMatches(phone?: string, name?: string): PatientListItem[] {
  const db = currentDb();
  const rows: Record<string, unknown>[] = [];
  if (phone && phone.trim()) {
    rows.push(
      ...(db
        .prepare(
          `SELECT id, patient_code, full_name, phone, gender, dob, age, address, registered_at, status, allergies,
             NULL AS last_visit_at, 0 AS visit_count, 0 AS outstanding
           FROM patients WHERE phone = ? AND deleted_at IS NULL LIMIT 5`,
        )
        .all(phone.trim()) as Record<string, unknown>[]),
    );
  }
  if (name && name.trim().length >= 3) {
    rows.push(
      ...(db
        .prepare(
          `SELECT id, patient_code, full_name, phone, gender, dob, age, address, registered_at, status, allergies,
             NULL AS last_visit_at, 0 AS visit_count, 0 AS outstanding
           FROM patients WHERE LOWER(full_name) LIKE ? AND deleted_at IS NULL LIMIT 5`,
        )
        .all(`%${name.trim().toLowerCase()}%`) as Record<string, unknown>[]),
    );
  }
  const seen = new Set<number>();
  return rows
    .filter((r) => {
      const id = Number(r.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((r) => mapListItem(r, false));
}

export function addPatientNote(actor: ServiceActor, patientId: number, body: string): { id: number } {
  requirePermission(actor, 'patient.edit');
  if (!body?.trim()) throw new ServiceError('validation', 'Note cannot be empty');
  const db = currentDb();
  const p = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(patientId);
  if (!p) throw new ServiceError('not_found', 'Patient not found', 404);
  const res = db
    .prepare('INSERT INTO patient_notes (patient_id, body, created_by) VALUES (?, ?, ?)')
    .run(patientId, sanitizeText(body.trim()), actor.userId);
  const id = Number(res.lastInsertRowid);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'patient.note',
    entity: 'patient',
    entityId: patientId,
    metadata: { noteId: id },
  });
  return { id };
}

/** Chronological clinical timeline for a patient. */
export function patientTimeline(actor: ServiceActor, patientId: number): TimelineEntry[] {
  requirePermission(actor, 'patient.view');
  const db = currentDb();
  const p = db.prepare('SELECT id, full_name, registered_at FROM patients WHERE id = ?').get(patientId) as
    | { id: number; registered_at: string }
    | undefined;
  if (!p) throw new ServiceError('not_found', 'Patient not found', 404);

  const entries: TimelineEntry[] = [];
  entries.push({
    id: `reg-${patientId}`,
    at: String(p.registered_at),
    kind: 'registration',
    title: 'Patient registered',
    detail: null,
    actor: null,
  });

  const clinicalOk = actor.permissions.includes('clinical.view') || actor.isSystem;
  const finOk = actor.permissions.includes('financial.view') || actor.isSystem;
  const apptOk = actor.permissions.includes('appointment.view') || actor.isSystem;

  if (clinicalOk) {
    const visits = db
      .prepare(
        `SELECT v.id, v.visit_at, v.chief_complaint, v.diagnosis, d.full_name AS dentist
         FROM visits v LEFT JOIN dentists d ON d.id = v.dentist_id
         WHERE v.patient_id = ? AND v.deleted_at IS NULL ORDER BY v.visit_at`,
      )
      .all(patientId) as Record<string, unknown>[];
    for (const v of visits) {
      entries.push({
        id: `visit-${v.id}`,
        at: String(v.visit_at),
        kind: 'visit',
        title: `Visit #${v.id}${v.dentist ? ` · ${v.dentist}` : ''}`,
        detail: [v.chief_complaint, v.diagnosis].filter(Boolean).join(' — ') || null,
        actor: (v.dentist as string | null) ?? null,
        route: `/visits/${v.id}`,
      });
    }
    const rx = db
      .prepare(
        `SELECT p.id, p.prescribed_at, p.code, d.full_name AS dentist,
                (SELECT COUNT(*) FROM prescription_items i WHERE i.prescription_id = p.id) AS items
         FROM prescriptions p LEFT JOIN dentists d ON d.id = p.dentist_id
         WHERE p.patient_id = ? AND p.deleted_at IS NULL ORDER BY p.prescribed_at`,
      )
      .all(patientId) as Record<string, unknown>[];
    for (const r of rx) {
      entries.push({
        id: `rx-${r.id}`,
        at: String(r.prescribed_at),
        kind: 'prescription',
        title: `Prescription ${r.code}`,
        detail: `${r.items} medicine(s)`,
        actor: (r.dentist as string | null) ?? null,
        route: `/prescriptions/${r.id}`,
      });
    }
    const charts = db
      .prepare(
        `SELECT id, dentition, updated_at FROM dental_charts WHERE patient_id = ? ORDER BY updated_at`,
      )
      .all(patientId) as Record<string, unknown>[];
    for (const c of charts) {
      entries.push({
        id: `chart-${c.id}`,
        at: String(c.updated_at),
        kind: 'chart',
        title: `Dental chart (${c.dentition}) updated`,
        detail: null,
        actor: null,
        route: `/chart/${patientId}`,
      });
    }
    const notes = db
      .prepare(
        `SELECT n.id, n.created_at, n.body, u.username FROM patient_notes n
         LEFT JOIN users u ON u.id = n.created_by WHERE n.patient_id = ?`,
      )
      .all(patientId) as Record<string, unknown>[];
    for (const n of notes) {
      entries.push({
        id: `note-${n.id}`,
        at: String(n.created_at),
        kind: 'note',
        title: 'Clinical note',
        detail: String(n.body).slice(0, 200),
        actor: (n.username as string | null) ?? null,
      });
    }
    const atts = db
      .prepare(
        `SELECT id, filename, created_at FROM patient_attachments WHERE patient_id = ? AND deleted_at IS NULL`,
      )
      .all(patientId) as Record<string, unknown>[];
    for (const a of atts) {
      entries.push({
        id: `att-${a.id}`,
        at: String(a.created_at),
        kind: 'attachment',
        title: `Attachment added: ${a.filename}`,
        detail: null,
        actor: null,
      });
    }
    const refs = db
      .prepare('SELECT id, referral_date, referred_to, reason FROM referrals WHERE patient_id = ?')
      .all(patientId) as Record<string, unknown>[];
    for (const r of refs) {
      entries.push({
        id: `ref-${r.id}`,
        at: String(r.referral_date),
        kind: 'referral',
        title: 'Referral',
        detail: [r.referred_to, r.reason].filter(Boolean).join(' — ') || null,
        actor: null,
      });
    }
  }

  if (apptOk) {
    const appts = db
      .prepare(
        `SELECT id, start_at, status, reason FROM appointments
         WHERE patient_id = ? AND deleted_at IS NULL ORDER BY start_at`,
      )
      .all(patientId) as Record<string, unknown>[];
    for (const a of appts) {
      entries.push({
        id: `appt-${a.id}`,
        at: String(a.start_at),
        kind: 'appointment',
        title: `Appointment · ${a.status}`,
        detail: (a.reason as string | null) ?? null,
        actor: null,
        route: '/appointments',
      });
    }
  }

  if (finOk) {
    const invoices = db
      .prepare('SELECT id, invoice_no, issued_at, total, status FROM invoices WHERE patient_id = ?')
      .all(patientId) as Record<string, unknown>[];
    for (const i of invoices) {
      entries.push({
        id: `inv-${i.id}`,
        at: String(i.issued_at),
        kind: 'invoice',
        title: `Invoice ${i.invoice_no} · ${i.status}`,
        detail: `Total ৳ ${Number(i.total).toFixed(2)}`,
        actor: null,
        route: `/invoices/${i.id}`,
      });
    }
    const payments = db
      .prepare('SELECT id, payment_no, paid_at, amount, status FROM payments WHERE patient_id = ?')
      .all(patientId) as Record<string, unknown>[];
    for (const pay of payments) {
      entries.push({
        id: `pay-${pay.id}`,
        at: String(pay.paid_at),
        kind: 'payment',
        title: `Payment ${pay.payment_no}${pay.status === 'reversed' ? ' (reversed)' : ''}`,
        detail: `৳ ${Number(pay.amount).toFixed(2)}`,
        actor: null,
      });
    }
  }

  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return entries;
}

export { nextPatientCode, nowIso };
