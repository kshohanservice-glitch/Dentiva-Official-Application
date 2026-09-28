import { currentDb, tx, nextSequence } from '../db/database';
import { recordAudit, requirePermission, ServiceError, type ServiceActor } from './common';
import { sanitizeText, nowIso } from '../../shared/format';
import type {
  ChartSaveInput,
  DentalChartDto,
  MedicationDto,
  MedicationInput,
  Page,
  PrescriptionDto,
  PrescriptionInput,
  ReferralDto,
  ReferralInput,
  TreatmentDto,
  TreatmentInput,
  TreatmentRecordDto,
  TreatmentRecordInput,
  VisitDto,
  VisitInput,
} from '../../shared/contract';

/* =================================== VISITS =================================== */

function mapVisit(r: Record<string, unknown>): VisitDto {
  return {
    id: Number(r.id),
    visitNo: Number(r.visit_no),
    patientId: Number(r.patient_id),
    patientName: (r.patient_name as string | null) ?? undefined,
    patientCode: (r.patient_code as string | null) ?? undefined,
    dentistId: (r.dentist_id as number | null) ?? null,
    dentistName: (r.dentist_name as string | null) ?? null,
    visitAt: String(r.visit_at),
    chiefComplaint: (r.chief_complaint as string | null) ?? null,
    history: (r.history as string | null) ?? null,
    examination: (r.examination as string | null) ?? null,
    diagnosis: (r.diagnosis as string | null) ?? null,
    findings: (r.findings as string | null) ?? null,
    treatmentNotes: (r.treatment_notes as string | null) ?? null,
    advice: (r.advice as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    status: (r.status as 'open' | 'closed') ?? 'open',
    treatmentCount: Number(r.treatment_count ?? 0),
    prescriptionCount: Number(r.prescription_count ?? 0),
    createdAt: String(r.created_at),
  };
}

const VISIT_SELECT = `
  SELECT v.*, p.full_name AS patient_name, p.patient_code, d.full_name AS dentist_name,
    (SELECT COUNT(*) FROM treatment_records tr WHERE tr.visit_id = v.id AND tr.deleted_at IS NULL) AS treatment_count,
    (SELECT COUNT(*) FROM prescriptions rx WHERE rx.visit_id = v.id AND rx.deleted_at IS NULL) AS prescription_count
  FROM visits v
  JOIN patients p ON p.id = v.patient_id
  LEFT JOIN dentists d ON d.id = v.dentist_id`;

export function listVisits(
  actor: ServiceActor,
  opts: {
    patientId?: number;
    q?: string;
    dentistId?: number;
    status?: 'open' | 'closed';
    range?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  },
): Page<VisitDto> {
  requirePermission(actor, 'clinical.view');
  const db = currentDb();
  const where: string[] = ['v.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (opts.patientId) {
    where.push('v.patient_id = ?');
    params.push(opts.patientId);
  }
  if (opts.dentistId) {
    where.push('v.dentist_id = ?');
    params.push(opts.dentistId);
  }
  if (opts.status === 'open' || opts.status === 'closed') {
    where.push('v.status = ?');
    params.push(opts.status);
  }
  if (opts.q && opts.q.trim()) {
    where.push(
      "(p.full_name LIKE ? OR p.patient_code LIKE ? OR COALESCE(v.chief_complaint, '') LIKE ? OR COALESCE(v.diagnosis, '') LIKE ?)",
    );
    const like = `%${opts.q.trim()}%`;
    params.push(like, like, like, like);
  }
  if (opts.range && opts.range !== 'all') {
    const today = nowIso().slice(0, 10);
    let from: string | null = null;
    let to: string | null = today;
    if (opts.range === 'today') from = today;
    else if (opts.range === 'd7') from = shiftDays(today, -7);
    else if (opts.range === 'd30') from = shiftDays(today, -30);
    else if (opts.range === 'd90') from = shiftDays(today, -90);
    else if (opts.range === 'd365') from = shiftDays(today, -365);
    else if (opts.range === 'custom') {
      from = opts.from ?? null;
      to = opts.to ?? null;
    }
    if (from) {
      where.push('v.visit_at >= ?');
      params.push(from);
    }
    if (to) {
      where.push('v.visit_at <= ?');
      params.push(to + 'T23:59:59');
    }
  }
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(5, opts.pageSize ?? 25));
  const whereSql = where.join(' AND ');
  const total = (
    currentDb()
      .prepare(`SELECT COUNT(*) AS c FROM visits v JOIN patients p ON p.id = v.patient_id WHERE ${whereSql}`)
      .get(...params) as { c: number }
  ).c;
  const rows = db
    .prepare(`${VISIT_SELECT} WHERE ${whereSql} ORDER BY v.visit_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
  return { items: rows.map(mapVisit), total, page, pageSize };
}

function shiftDays(isoDay: string, days: number): string {
  const d = new Date(isoDay + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function getVisit(actor: ServiceActor, id: number): VisitDto {
  requirePermission(actor, 'clinical.view');
  const r = currentDb().prepare(`${VISIT_SELECT} WHERE v.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) throw new ServiceError('not_found', 'Visit not found', 404);
  return mapVisit(r);
}

function sanitizeVisit(input: VisitInput): VisitInput {
  const out = { ...input };
  for (const key of [
    'chiefComplaint',
    'history',
    'examination',
    'diagnosis',
    'findings',
    'treatmentNotes',
    'advice',
    'notes',
  ] as const) {
    if (typeof out[key] === 'string') out[key] = sanitizeText(out[key] as string);
  }
  return out;
}

export function createVisit(actor: ServiceActor, input: VisitInput): { id: number } {
  requirePermission(actor, 'clinical.create');
  if (!input.patientId) throw new ServiceError('validation', 'Patient is required');
  const db = currentDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ServiceError('not_found', 'Patient not found', 404);
  const clean = sanitizeVisit(input);
  const visitAt = clean.visitAt || nowIso();
  let id = 0;
  tx(() => {
    const seq = nextSequence('visit', 'V', 5);
    const visitNo = Number(seq.replace(/^V/, ''));
    const res = db
      .prepare(
        `INSERT INTO visits (visit_no, patient_id, dentist_id, visit_at, chief_complaint, history, examination,
          diagnosis, findings, treatment_notes, advice, notes, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        visitNo,
        clean.patientId,
        clean.dentistId ?? actorDentistId(actor) ?? null,
        visitAt,
        clean.chiefComplaint || null,
        clean.history || null,
        clean.examination || null,
        clean.diagnosis || null,
        clean.findings || null,
        clean.treatmentNotes || null,
        clean.advice || null,
        clean.notes || null,
        clean.status ?? 'open',
        actor.userId,
      );
    id = Number(res.lastInsertRowid);
  });
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'visit.create',
    entity: 'visit',
    entityId: id,
    after: { patientId: clean.patientId, visitAt },
  });
  return { id };
}

function actorDentistId(actor: ServiceActor): number | null {
  const db = currentDb();
  const row = db.prepare('SELECT dentist_id FROM users WHERE id = ?').get(actor.userId ?? -1) as
    | { dentist_id: number | null }
    | undefined;
  return row?.dentist_id ?? null;
}

export function updateVisit(actor: ServiceActor, input: VisitInput): void {
  requirePermission(actor, 'clinical.edit');
  if (!input.id) throw new ServiceError('validation', 'Visit id required');
  const db = currentDb();
  const before = db
    .prepare('SELECT * FROM visits WHERE id = ? AND deleted_at IS NULL')
    .get(input.id) as Record<string, unknown> | undefined;
  if (!before) throw new ServiceError('not_found', 'Visit not found', 404);
  const clean = sanitizeVisit(input);
  // Partial updates merge with the existing row — omitted fields are preserved.
  const pick = (v: string | undefined, prev: unknown): string | null => (v !== undefined ? v || null : (prev as string | null));
  db.prepare(
    `UPDATE visits SET dentist_id=?, visit_at=?, chief_complaint=?, history=?, examination=?, diagnosis=?,
      findings=?, treatment_notes=?, advice=?, notes=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`,
  ).run(
    clean.dentistId !== undefined && clean.dentistId !== null ? clean.dentistId : (before.dentist_id as number | null),
    clean.visitAt || (before.visit_at as string),
    pick(clean.chiefComplaint, before.chief_complaint),
    pick(clean.history, before.history),
    pick(clean.examination, before.examination),
    pick(clean.diagnosis, before.diagnosis),
    pick(clean.findings, before.findings),
    pick(clean.treatmentNotes, before.treatment_notes),
    pick(clean.advice, before.advice),
    pick(clean.notes, before.notes),
    clean.status ?? (before.status as 'open' | 'closed'),
    input.id,
  );
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'visit.update',
    entity: 'visit',
    entityId: input.id,
    before,
    after: { diagnosis: clean.diagnosis, status: clean.status },
  });
}

export function deleteVisit(actor: ServiceActor, id: number): { ok: boolean; reason?: string } {
  requirePermission(actor, 'clinical.delete');
  const db = currentDb();
  const billed = db.prepare('SELECT COUNT(*) AS c FROM invoice_items WHERE treatment_record_id IN (SELECT id FROM treatment_records WHERE visit_id = ?)').get(id) as { c: number };
  db.prepare("UPDATE visits SET deleted_at = datetime('now','localtime') WHERE id = ?").run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'visit.delete',
    entity: 'visit',
    entityId: id,
    metadata: { linkedInvoiceItems: billed.c },
  });
  return { ok: true };
}

/* ============================== DENTAL CHART ============================== */

export function listChartConditions() {
  const rows = currentDb()
    .prepare('SELECT code, label, color, category, sort FROM chart_conditions ORDER BY sort')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    code: String(r.code),
    label: String(r.label),
    color: String(r.color),
    category: String(r.category),
    sort: Number(r.sort),
  }));
}

export function getChart(actor: ServiceActor, patientId: number): DentalChartDto | null {
  requirePermission(actor, 'clinical.view');
  const db = currentDb();
  const chart = db
    .prepare('SELECT * FROM dental_charts WHERE patient_id = ? ORDER BY updated_at DESC LIMIT 1')
    .get(patientId) as Record<string, unknown> | undefined;
  if (!chart) return null;
  const entries = db
    .prepare('SELECT tooth_id, condition_code, notes FROM dental_chart_entries WHERE chart_id = ?')
    .all(chart.id) as Record<string, unknown>[];
  return {
    id: Number(chart.id),
    patientId: Number(chart.patient_id),
    visitId: (chart.visit_id as number | null) ?? null,
    dentition: (chart.dentition as 'adult' | 'pediatric') ?? 'adult',
    entries: entries.map((e) => ({
      toothId: String(e.tooth_id),
      conditionCode: String(e.condition_code),
      notes: (e.notes as string | null) ?? undefined,
    })),
    createdAt: String(chart.created_at),
    updatedAt: String(chart.updated_at),
  };
}

export function saveChart(actor: ServiceActor, input: ChartSaveInput): { id: number } {
  requirePermission(actor, 'chart.manage');
  if (!input.patientId) throw new ServiceError('validation', 'Patient is required');
  const db = currentDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ServiceError('not_found', 'Patient not found', 404);
  const validCodes = new Set(
    (db.prepare('SELECT code FROM chart_conditions').all() as { code: string }[]).map((r) => r.code),
  );
  for (const e of input.entries) {
    if (!validCodes.has(e.conditionCode)) {
      throw new ServiceError('validation', `Unknown chart condition: ${e.conditionCode}`);
    }
    if (!/^[0-9]{2}$/.test(e.toothId)) {
      throw new ServiceError('validation', `Invalid tooth id: ${e.toothId}`);
    }
  }
  let id = 0;
  tx(() => {
    const res = db
      .prepare(
        `INSERT INTO dental_charts (patient_id, visit_id, dentition, created_by) VALUES (?, ?, ?, ?)`,
      )
      .run(input.patientId, input.visitId ?? null, input.dentition, actor.userId);
    id = Number(res.lastInsertRowid);
    const ins = db.prepare(
      'INSERT INTO dental_chart_entries (chart_id, tooth_id, condition_code, notes) VALUES (?, ?, ?, ?)',
    );
    for (const e of input.entries) ins.run(id, e.toothId, e.conditionCode, e.notes || null);
  });
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'chart.save',
    entity: 'dental_chart',
    entityId: id,
    after: { patientId: input.patientId, teeth: input.entries.length, dentition: input.dentition },
  });
  return { id };
}

/* ============================== TREATMENTS ============================== */

export function listTreatments(
  actor: ServiceActor,
  opts: { q?: string; category?: string; includeInactive?: boolean } = {},
): TreatmentDto[] {
  requirePermission(actor, 'clinical.view');
  const where: string[] = [];
  const params: unknown[] = [];
  if (!opts.includeInactive) where.push('active = 1');
  if (opts.category) {
    where.push('category = ?');
    params.push(opts.category);
  }
  if (opts.q && opts.q.trim()) {
    const like = `%${opts.q.trim()}%`;
    where.push('(name LIKE ? OR code LIKE ?)');
    params.push(like, like);
  }
  const rows = currentDb()
    .prepare(
      `SELECT * FROM treatment_catalog ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY category, name`,
    )
    .all(...params) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    code: String(r.code),
    name: String(r.name),
    category: String(r.category),
    description: (r.description as string | null) ?? null,
    defaultFee: Number(r.default_fee),
    durationMin: (r.duration_min as number | null) ?? null,
    active: Boolean(r.active),
  }));
}

export function saveTreatment(actor: ServiceActor, input: TreatmentInput): { id: number } {
  requirePermission(actor, 'treatment.manage');
  if (!input.code?.trim() || !input.name?.trim()) {
    throw new ServiceError('validation', 'Treatment code and name are required');
  }
  if (input.defaultFee < 0) throw new ServiceError('validation', 'Fee cannot be negative');
  const db = currentDb();
  let id: number;
  if (input.id) {
    const before = db.prepare('SELECT * FROM treatment_catalog WHERE id = ?').get(input.id);
    if (!before) throw new ServiceError('not_found', 'Treatment not found', 404);
    db.prepare(
      `UPDATE treatment_catalog SET code=?, name=?, category=?, description=?, default_fee=?, duration_min=?,
        active=?, updated_at=datetime('now','localtime') WHERE id=?`,
    ).run(
      input.code.trim(),
      input.name.trim(),
      input.category || 'General',
      input.description || null,
      input.defaultFee,
      input.durationMin ?? null,
      input.active === false ? 0 : 1,
      input.id,
    );
    id = input.id;
  } else {
    if (db.prepare('SELECT id FROM treatment_catalog WHERE code = ?').get(input.code.trim())) {
      throw new ServiceError('validation', 'Treatment code already exists');
    }
    const res = db
      .prepare(
        `INSERT INTO treatment_catalog (code, name, category, description, default_fee, duration_min, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.code.trim(),
        input.name.trim(),
        input.category || 'General',
        input.description || null,
        input.defaultFee,
        input.durationMin ?? null,
        input.active === false ? 0 : 1,
      );
    id = Number(res.lastInsertRowid);
  }
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'treatment.save',
    entity: 'treatment',
    entityId: id,
    after: { code: input.code, name: input.name, fee: input.defaultFee },
  });
  return { id };
}

export function deleteTreatment(actor: ServiceActor, id: number): { ok: boolean; reason?: string } {
  requirePermission(actor, 'treatment.manage');
  const db = currentDb();
  const used = db.prepare('SELECT COUNT(*) AS c FROM treatment_records WHERE treatment_id = ?').get(id) as {
    c: number;
  };
  if (used.c > 0) {
    db.prepare('UPDATE treatment_catalog SET active = 0, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(id);
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'treatment.archive',
      entity: 'treatment',
      entityId: id,
      metadata: { usedBy: used.c },
    });
    return { ok: true, reason: 'archived_in_use' };
  }
  db.prepare('DELETE FROM treatment_catalog WHERE id = ?').run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'treatment.delete',
    entity: 'treatment',
    entityId: id,
  });
  return { ok: true };
}

/* =========================== TREATMENT RECORDS =========================== */

export function listTreatmentRecords(actor: ServiceActor, patientId: number): TreatmentRecordDto[] {
  requirePermission(actor, 'clinical.view');
  const rows = currentDb()
    .prepare(
      `SELECT tr.*, COALESCE(tc.name, 'Custom') AS treatment_name,
        EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.treatment_record_id = tr.id) AS invoiced
       FROM treatment_records tr LEFT JOIN treatment_catalog tc ON tc.id = tr.treatment_id
       WHERE tr.patient_id = ? AND tr.deleted_at IS NULL ORDER BY tr.created_at DESC`,
    )
    .all(patientId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    patientId: Number(r.patient_id),
    visitId: (r.visit_id as number | null) ?? null,
    treatmentId: (r.treatment_id as number | null) ?? null,
    treatmentName: String(r.treatment_name),
    toothIds: parseJsonArray(r.tooth_ids_json),
    fee: Number(r.fee),
    notes: (r.notes as string | null) ?? null,
    status: (r.status as 'planned' | 'done') ?? 'planned',
    invoiced: Boolean(r.invoiced),
    createdAt: String(r.created_at),
  }));
}

function parseJsonArray(v: unknown): string[] {
  try {
    const arr = JSON.parse(String(v ?? '[]'));
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

export function createTreatmentRecord(actor: ServiceActor, input: TreatmentRecordInput): { id: number } {
  requirePermission(actor, 'clinical.create');
  if (!input.patientId) throw new ServiceError('validation', 'Patient is required');
  if (input.fee < 0) throw new ServiceError('validation', 'Fee cannot be negative');
  const db = currentDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ServiceError('not_found', 'Patient not found', 404);
  const res = db
    .prepare(
      `INSERT INTO treatment_records (patient_id, visit_id, treatment_id, tooth_ids_json, fee, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.patientId,
      input.visitId ?? null,
      input.treatmentId ?? null,
      JSON.stringify(input.toothIds ?? []),
      input.fee,
      input.notes || null,
      actor.userId,
    );
  const id = Number(res.lastInsertRowid);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'treatment_record.create',
    entity: 'treatment_record',
    entityId: id,
    after: { patientId: input.patientId, fee: input.fee },
  });
  return { id };
}

export function deleteTreatmentRecord(actor: ServiceActor, id: number): { ok: boolean; reason?: string } {
  requirePermission(actor, 'clinical.delete');
  const db = currentDb();
  const invoiced = db.prepare('SELECT COUNT(*) AS c FROM invoice_items WHERE treatment_record_id = ?').get(id) as {
    c: number;
  };
  if (invoiced.c > 0) {
    throw new ServiceError('validation', 'This treatment is already billed — void or edit the invoice instead');
  }
  db.prepare("UPDATE treatment_records SET deleted_at = datetime('now','localtime') WHERE id = ?").run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'treatment_record.delete',
    entity: 'treatment_record',
    entityId: id,
  });
  return { ok: true };
}

/* ============================== PRESCRIPTIONS ============================== */

function mapRx(r: Record<string, unknown>): PrescriptionDto {
  const db = currentDb();
  const items = db
    .prepare('SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort, id')
    .all(r.id) as Record<string, unknown>[];
  return {
    id: Number(r.id),
    code: String(r.code),
    patientId: Number(r.patient_id),
    visitId: (r.visit_id as number | null) ?? null,
    dentistId: (r.dentist_id as number | null) ?? null,
    prescribedAt: String(r.prescribed_at),
    chiefComplaint: (r.chief_complaint as string | null) ?? undefined,
    onExamination: (r.on_examination as string | null) ?? undefined,
    examinationResult: (r.examination_result as string | null) ?? undefined,
    advice: (r.advice as string | null) ?? undefined,
    dentistName: String(r.dentist_name ?? ''),
    patientName: String(r.patient_name ?? ''),
    patientCode: String(r.patient_code ?? ''),
    gender: (r.gender as string | null) ?? null,
    age: (r.age as number | null) ?? null,
    createdAt: String(r.created_at),
    items: items.map((i) => ({
      id: Number(i.id),
      medicineName: String(i.medicine_name),
      genericName: (i.generic_name as string | null) ?? undefined,
      strength: (i.strength as string | null) ?? undefined,
      form: (i.form as string | null) ?? undefined,
      dose: (i.dose as string | null) ?? undefined,
      quantity: (i.quantity as string | null) ?? undefined,
      frequency: (i.frequency as string | null) ?? undefined,
      morning: Boolean(i.morning),
      noon: Boolean(i.noon),
      night: Boolean(i.night),
      meal: (i.meal as 'before' | 'after' | 'any' | null) ?? null,
      duration: (i.duration as string | null) ?? undefined,
      instruction: (i.instruction as string | null) ?? undefined,
    })),
  };
}

const RX_SELECT = `
  SELECT p.*, d.full_name AS dentist_name, pt.full_name AS patient_name, pt.patient_code, pt.gender, pt.age
  FROM prescriptions p
  LEFT JOIN dentists d ON d.id = p.dentist_id
  JOIN patients pt ON pt.id = p.patient_id`;

export function listPrescriptions(
  actor: ServiceActor,
  opts: { q?: string; patientId?: number; range?: string; from?: string; to?: string; page?: number; pageSize?: number },
): Page<PrescriptionDto> {
  requirePermission(actor, 'prescription.view');
  const db = currentDb();
  const where: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (opts.patientId) {
    where.push('p.patient_id = ?');
    params.push(opts.patientId);
  }
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim().toLowerCase()}%`;
    where.push(
      `(LOWER(p.code) LIKE ? OR LOWER(pt.full_name) LIKE ? OR LOWER(pt.patient_code) LIKE ?
        OR EXISTS (SELECT 1 FROM prescription_items i WHERE i.prescription_id = p.id AND LOWER(i.medicine_name) LIKE ?))`,
    );
    params.push(like, like, like, like);
  }
  if (opts.range && opts.range !== 'all') {
    const today = nowIso().slice(0, 10);
    let from: string | null = null;
    let to: string | null = today;
    if (opts.range === 'today') from = today;
    else if (opts.range === 'd7') from = shiftDays(today, -7);
    else if (opts.range === 'd30') from = shiftDays(today, -30);
    else if (opts.range === 'd90') from = shiftDays(today, -90);
    else if (opts.range === 'd365') from = shiftDays(today, -365);
    else if (opts.range === 'custom') {
      from = opts.from ?? null;
      to = opts.to ?? null;
    }
    if (from) {
      where.push('p.prescribed_at >= ?');
      params.push(from);
    }
    if (to) {
      where.push('p.prescribed_at <= ?');
      params.push(to + 'T23:59:59');
    }
  }
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(5, opts.pageSize ?? 25));
  const whereSql = where.join(' AND ');
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM prescriptions p JOIN patients pt ON pt.id = p.patient_id WHERE ${whereSql}`,
      )
      .get(...params) as { c: number }
  ).c;
  const rows = db
    .prepare(`${RX_SELECT} WHERE ${whereSql} ORDER BY p.prescribed_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
  return { items: rows.map(mapRx), total, page, pageSize };
}

export function getPrescription(actor: ServiceActor, id: number): PrescriptionDto {
  requirePermission(actor, 'prescription.view');
  const r = currentDb().prepare(`${RX_SELECT} WHERE p.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) throw new ServiceError('not_found', 'Prescription not found', 404);
  return mapRx(r);
}

export function createPrescription(actor: ServiceActor, input: PrescriptionInput): { id: number } {
  requirePermission(actor, 'prescription.create');
  validateRx(input);
  const db = currentDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ServiceError('not_found', 'Patient not found', 404);
  let id = 0;
  tx(() => {
    const code = nextSequence('rx', 'RX-', 5);
    const res = db
      .prepare(
        `INSERT INTO prescriptions (code, patient_id, visit_id, dentist_id, prescribed_at, chief_complaint,
          on_examination, examination_result, advice, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        code,
        input.patientId,
        input.visitId ?? null,
        input.dentistId ?? actorDentistId(actor) ?? null,
        input.prescribedAt || nowIso(),
        input.chiefComplaint || null,
        input.onExamination || null,
        input.examinationResult || null,
        input.advice || null,
        actor.userId,
      );
    id = Number(res.lastInsertRowid);
    insertRxItems(id, input);
  });
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'prescription.create',
    entity: 'prescription',
    entityId: id,
    after: { patientId: input.patientId, items: input.items.length },
  });
  return { id };
}

function validateRx(input: PrescriptionInput): void {
  if (!input.patientId) throw new ServiceError('validation', 'Patient is required');
  if (!input.items || input.items.length === 0) {
    throw new ServiceError('validation', 'At least one medicine is required');
  }
  for (const [i, item] of input.items.entries()) {
    if (!item.medicineName?.trim()) {
      throw new ServiceError('validation', `Medicine #${i + 1}: name is required`);
    }
  }
}

function insertRxItems(prescriptionId: number, input: PrescriptionInput): void {
  const db = currentDb();
  const ins = db.prepare(
    `INSERT INTO prescription_items (prescription_id, medicine_name, generic_name, strength, form, dose, quantity,
      frequency, morning, noon, night, meal, duration, instruction, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  input.items.forEach((item, idx) => {
    ins.run(
      prescriptionId,
      item.medicineName.trim(),
      item.genericName || null,
      item.strength || null,
      item.form || null,
      item.dose || null,
      item.quantity || null,
      item.frequency || null,
      item.morning ? 1 : 0,
      item.noon ? 1 : 0,
      item.night ? 1 : 0,
      item.meal ?? null,
      item.duration || null,
      item.instruction || null,
      idx,
    );
  });
}

export function updatePrescription(actor: ServiceActor, input: PrescriptionInput): void {
  requirePermission(actor, 'prescription.edit');
  if (!input.id) throw new ServiceError('validation', 'Prescription id required');
  const rxId: number = input.id;
  validateRx(input);
  const db = currentDb();
  const before = db.prepare('SELECT id, code FROM prescriptions WHERE id = ? AND deleted_at IS NULL').get(input.id);
  if (!before) throw new ServiceError('not_found', 'Prescription not found', 404);
  tx(() => {
    db.prepare(
      `UPDATE prescriptions SET visit_id=?, dentist_id=?, prescribed_at=?, chief_complaint=?, on_examination=?,
        examination_result=?, advice=?, updated_at=datetime('now','localtime') WHERE id=?`,
    ).run(
      input.visitId ?? null,
      input.dentistId ?? null,
      input.prescribedAt || nowIso(),
      input.chiefComplaint || null,
      input.onExamination || null,
      input.examinationResult || null,
      input.advice || null,
      input.id,
    );
    db.prepare('DELETE FROM prescription_items WHERE prescription_id = ?').run(rxId);
    insertRxItems(rxId, input);
  });
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'prescription.update',
    entity: 'prescription',
    entityId: input.id,
    after: { items: input.items.length },
  });
}

export function deletePrescription(actor: ServiceActor, id: number): { ok: boolean } {
  requirePermission(actor, 'prescription.delete');
  currentDb().prepare("UPDATE prescriptions SET deleted_at = datetime('now','localtime') WHERE id = ?").run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'prescription.delete',
    entity: 'prescription',
    entityId: id,
  });
  return { ok: true };
}

/* =============================== MEDICATIONS =============================== */

export function listMedications(actor: ServiceActor): MedicationDto[] {
  requirePermission(actor, 'prescription.view');
  const rows = currentDb()
    .prepare('SELECT * FROM medications ORDER BY name COLLATE NOCASE')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    genericName: (r.generic_name as string | null) ?? null,
    form: (r.form as string | null) ?? null,
    strength: (r.strength as string | null) ?? null,
    active: Boolean(r.active),
  }));
}

export function saveMedication(actor: ServiceActor, input: MedicationInput): { id: number } {
  requirePermission(actor, 'medication.manage');
  if (!input.name?.trim()) throw new ServiceError('validation', 'Medicine name is required');
  const db = currentDb();
  let id: number;
  if (input.id) {
    db.prepare(
      'UPDATE medications SET name=?, generic_name=?, form=?, strength=?, active=? WHERE id=?',
    ).run(
      input.name.trim(),
      input.genericName || null,
      input.form || null,
      input.strength || null,
      input.active === false ? 0 : 1,
      input.id,
    );
    id = input.id;
  } else {
    const res = db
      .prepare('INSERT INTO medications (name, generic_name, form, strength) VALUES (?, ?, ?, ?)')
      .run(input.name.trim(), input.genericName || null, input.form || null, input.strength || null);
    id = Number(res.lastInsertRowid);
  }
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'medication.save',
    entity: 'medication',
    entityId: id,
    after: { name: input.name },
  });
  return { id };
}

export function deleteMedication(actor: ServiceActor, id: number): { ok: boolean } {
  requirePermission(actor, 'medication.manage');
  currentDb().prepare('DELETE FROM medications WHERE id = ?').run(id);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'medication.delete',
    entity: 'medication',
    entityId: id,
  });
  return { ok: true };
}

/* ================================ REFERRALS ================================ */

export function addReferral(actor: ServiceActor, input: ReferralInput): { id: number } {
  requirePermission(actor, 'referral.manage');
  if (!input.patientId) throw new ServiceError('validation', 'Patient is required');
  const db = currentDb();
  const res = db
    .prepare(
      `INSERT INTO referrals (patient_id, referring_name, referred_to, specialty, organization, reason,
        referral_date, notes, follow_up, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.patientId,
      input.referringName || null,
      input.referredTo || null,
      input.specialty || null,
      input.organization || null,
      input.reason || null,
      input.referralDate || nowIso().slice(0, 10),
      input.notes || null,
      input.followUp || null,
      input.status || 'referred',
      actor.userId,
    );
  const id = Number(res.lastInsertRowid);
  recordAudit({
    actor: { userId: actor.userId, username: actor.username },
    action: 'referral.create',
    entity: 'referral',
    entityId: id,
    after: { patientId: input.patientId, referredTo: input.referredTo },
  });
  return { id };
}

export function listReferrals(actor: ServiceActor, patientId: number): ReferralDto[] {
  requirePermission(actor, 'patient.view');
  const rows = currentDb()
    .prepare('SELECT * FROM referrals WHERE patient_id = ? ORDER BY referral_date DESC')
    .all(patientId) as Record<string, unknown>[];
  return rows.map((r) => ({
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
  }));
}
