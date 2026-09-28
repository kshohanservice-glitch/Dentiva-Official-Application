import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app } from 'electron';
import { currentDb } from '../db/database';
import { logger } from '../logger';
import { requirePermission, ServiceError, type ServiceActor } from '../services/common';
import {
  docShell,
  esc,
  fileUrl,
  renderInvoice,
  renderPatientSummary,
  renderPrescription,
  renderTableReport,
  type PrintClinic,
  type PrintProfile,
} from './templates';
import type {
  PrintPreviewInput,
  PrintPreviewPayload,
  PrintRunInput,
  PrintRunResult,
} from '../../shared/contract';
import { formatDate, formatMoney } from '../../shared/format';

export function fontsDir(): string {
  return path.join(app.getAppPath(), 'assets', 'fonts');
}

export function defaultProfile(): PrintProfile {
  const row = currentDb()
    .prepare('SELECT * FROM printer_profiles ORDER BY is_default DESC, id LIMIT 1')
    .get() as Record<string, unknown> | undefined;
  if (!row) {
    return {
      id: 0,
      name: 'A4',
      paperSize: 'A4',
      widthMm: 210,
      heightMm: 297,
      marginTop: 8,
      marginRight: 8,
      marginBottom: 8,
      marginLeft: 8,
      orientation: 'portrait',
      scale: 100,
    };
  }
  return mapProfile(row);
}

export function mapProfile(r: Record<string, unknown>): PrintProfile {
  return {
    id: Number(r.id),
    name: String(r.name),
    paperSize: r.paper_size as PrintProfile['paperSize'],
    widthMm: Number(r.width_mm),
    heightMm: Number(r.height_mm),
    marginTop: Number(r.margin_top),
    marginRight: Number(r.margin_right),
    marginBottom: Number(r.margin_bottom),
    marginLeft: Number(r.margin_left),
    orientation: r.orientation as 'portrait' | 'landscape',
    scale: Number(r.scale),
  };
}

function getProfile(profileId?: number | null): PrintProfile {
  if (!profileId) return defaultProfile();
  const row = currentDb().prepare('SELECT * FROM printer_profiles WHERE id = ?').get(profileId) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new ServiceError('not_found', 'Printer profile not found', 404);
  return mapProfile(row);
}

export function getClinic(): PrintClinic {
  const rows = currentDb()
    .prepare(`SELECT key, value_json FROM app_settings WHERE group_name = 'clinic'`)
    .all() as { key: string; value_json: string }[];
  const obj: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      obj[r.key] = JSON.parse(r.value_json);
    } catch {
      /* ignore */
    }
  }
  return {
    name: String(obj.name ?? 'Dental Clinic'),
    logoPath: (obj.logoPath as string | null) ?? null,
    address: String(obj.address ?? ''),
    phone: String(obj.phone ?? ''),
    altPhone: String(obj.altPhone ?? ''),
    email: String(obj.email ?? ''),
    website: String(obj.website ?? ''),
    openingHours: String(obj.openingHours ?? ''),
    footerMessage: String(obj.footerMessage ?? ''),
    prescriptionMessage: String(obj.prescriptionMessage ?? ''),
    emergencyContact: String(obj.emergencyContact ?? ''),
  };
}

/* ------------------------------ data assembly ------------------------------ */

export function buildPrintHtml(actor: ServiceActor, input: PrintPreviewInput): PrintPreviewPayload {
  const profile = getProfile(input.profileId);
  const clinic = getClinic();
  const opts = { profile, fontsDir: fontsDir(), title: `Dentiva Pro — ${input.template}` };

  switch (input.template) {
    case 'prescription': {
      requirePermission(actor, 'prescription.view');
      const db = currentDb();
      const rx = db
        .prepare(
          `SELECT p.*, pt.full_name AS patient_name, pt.patient_code, pt.gender, pt.age,
                  d.full_name AS dentist_name, d.designations_json, d.qualifications, d.signature_path, d.working_hours
           FROM prescriptions p
           JOIN patients pt ON pt.id = p.patient_id
           LEFT JOIN dentists d ON d.id = p.dentist_id
           WHERE p.id = ? AND p.deleted_at IS NULL`,
        )
        .get(input.entityId) as Record<string, unknown> | undefined;
      if (!rx) throw new ServiceError('not_found', 'Prescription not found', 404);
      const items = db
        .prepare('SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort, id')
        .all(input.entityId) as Record<string, unknown>[];
      const designations = (() => {
        try {
          return JSON.parse(String(rx.designations_json ?? '[]')) as string[];
        } catch {
          return [];
        }
      })();
      const html = renderPrescription(
        {
          code: String(rx.code),
          date: formatDate(String(rx.prescribed_at), 'long'),
          patientName: String(rx.patient_name),
          gender: (rx.gender as string | null) ?? null,
          age: (rx.age as number | null) ?? null,
          patientCode: String(rx.patient_code),
          dentistName: String(rx.dentist_name ?? ''),
          designations,
          qualifications: (rx.qualifications as string | null) ?? null,
          availability: (rx.working_hours as string | null) ?? null,
          chiefComplaint: String(rx.chief_complaint ?? ''),
          onExamination: String(rx.on_examination ?? ''),
          examinationResult: String(rx.examination_result ?? ''),
          advice: String(rx.advice ?? ''),
          signaturePath: (rx.signature_path as string | null) ?? null,
          items: items.map((i) => ({
            medicineName: String(i.medicine_name),
            genericName: (i.generic_name as string | null) ?? null,
            strength: (i.strength as string | null) ?? null,
            form: (i.form as string | null) ?? null,
            dose: (i.dose as string | null) ?? null,
            frequency: (i.frequency as string | null) ?? null,
            morning: Boolean(i.morning),
            noon: Boolean(i.noon),
            night: Boolean(i.night),
            meal: (i.meal as string | null) ?? null,
            duration: (i.duration as string | null) ?? null,
            instruction: (i.instruction as string | null) ?? null,
            quantity: (i.quantity as string | null) ?? null,
          })),
        },
        clinic,
        opts,
      );
      return { html, widthMm: profile.widthMm, heightMm: profile.heightMm, paperSize: profile.paperSize };
    }
    case 'invoice': {
      requirePermission(actor, 'invoice.view');
      const db = currentDb();
      const inv = db
        .prepare(
          `SELECT i.*, pt.full_name AS patient_name, pt.patient_code FROM invoices i
           JOIN patients pt ON pt.id = i.patient_id WHERE i.id = ?`,
        )
        .get(input.entityId) as Record<string, unknown> | undefined;
      if (!inv) throw new ServiceError('not_found', 'Invoice not found', 404);
      const itemRows = db
        .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort, id')
        .all(input.entityId) as Record<string, unknown>[];
      const payRows = db
        .prepare(
          `SELECT pay.amount, pay.paid_at, pm.label FROM payments pay
           JOIN payment_methods pm ON pm.code = pay.method_code
           WHERE pay.invoice_id = ? AND pay.status = 'posted' ORDER BY pay.paid_at`,
        )
        .all(input.entityId) as Record<string, unknown>[];
      const html = renderInvoice(
        {
          invoiceNo: String(inv.invoice_no),
          date: formatDate(String(inv.issued_at)),
          patientName: String(inv.patient_name),
          patientCode: String(inv.patient_code),
          items: itemRows.map((i) => ({
            description: String(i.description),
            qty: Number(i.qty),
            unitPrice: Number(i.unit_price),
            discount: Number(i.discount),
            lineTotal: Number(i.line_total),
          })),
          subtotal: Number(inv.subtotal),
          discountAmount: Number(inv.discount_amount),
          taxAmount: Number(inv.tax_amount),
          total: Number(inv.total),
          paidTotal: Number(inv.paid_total),
          balance: Number(inv.total) - Number(inv.paid_total),
          status: String(inv.status),
          notes: (inv.notes as string | null) ?? null,
          payments: payRows.map((p) => ({
            amount: Number(p.amount),
            paidAt: String(p.paid_at),
            methodLabel: String(p.label),
          })),
        },
        clinic,
        opts,
      );
      return { html, widthMm: profile.widthMm, heightMm: profile.heightMm, paperSize: profile.paperSize };
    }
    case 'patientSummary': {
      requirePermission(actor, 'patient.view');
      const db = currentDb();
      const p = db.prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.entityId) as
        | Record<string, unknown>
        | undefined;
      if (!p) throw new ServiceError('not_found', 'Patient not found', 404);
      const visits = db
        .prepare(
          `SELECT v.visit_at, v.chief_complaint, v.diagnosis, d.full_name AS dentist FROM visits v
           LEFT JOIN dentists d ON d.id = v.dentist_id
           WHERE v.patient_id = ? AND v.deleted_at IS NULL ORDER BY v.visit_at DESC LIMIT 50`,
        )
        .all(input.entityId) as Record<string, unknown>[];
      const rxs = db
        .prepare(
          `SELECT p.prescribed_at, p.code, (SELECT GROUP_CONCAT(medicine_name, ', ') FROM prescription_items i WHERE i.prescription_id = p.id) AS meds
           FROM prescriptions p WHERE p.patient_id = ? AND p.deleted_at IS NULL ORDER BY p.prescribed_at DESC LIMIT 50`,
        )
        .all(input.entityId) as Record<string, unknown>[];
      const invs = db
        .prepare(
          `SELECT issued_at, invoice_no, total, paid_total, status FROM invoices
           WHERE patient_id = ? AND status != 'void' ORDER BY issued_at DESC LIMIT 50`,
        )
        .all(input.entityId) as Record<string, unknown>[];
      const fin = db
        .prepare(
          `SELECT COALESCE(SUM(total),0) AS billed FROM invoices WHERE patient_id = ? AND status != 'void'`,
        )
        .get(input.entityId) as { billed: number };
      const paid = db
        .prepare(`SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE patient_id = ? AND status = 'posted'`)
        .get(input.entityId) as { paid: number };
      const html = renderPatientSummary(
        {
          patientName: String(p.full_name),
          patientCode: String(p.patient_code),
          gender: (p.gender as string | null) ?? null,
          age: (p.age as number | null) ?? null,
          phone: (p.phone as string | null) ?? null,
          address: (p.address as string | null) ?? null,
          allergies: (p.allergies as string | null) ?? null,
          visits: visits.map((v) => ({
            date: formatDate(String(v.visit_at)),
            complaint: String(v.chief_complaint ?? '—'),
            diagnosis: String(v.diagnosis ?? '—'),
            dentist: String(v.dentist ?? '—'),
          })),
          prescriptions: rxs.map((r) => ({
            date: formatDate(String(r.prescribed_at)),
            code: String(r.code),
            medicines: String(r.meds ?? '—'),
          })),
          invoices: invs.map((i) => ({
            date: formatDate(String(i.issued_at)),
            no: String(i.invoice_no),
            total: Number(i.total),
            paid: Number(i.paid_total),
            status: String(i.status),
          })),
          totals: {
            billed: Number(fin.billed),
            paid: Number(paid.paid),
            balance: Number(fin.billed) - Number(paid.paid),
            financial: actor.isSystem || actor.permissions.includes('financial.view'),
          },
        },
        clinic,
        opts,
      );
      return { html, widthMm: profile.widthMm, heightMm: profile.heightMm, paperSize: profile.paperSize };
    }
    case 'appointmentSummary': {
      requirePermission(actor, 'appointment.view');
      const db = currentDb();
      const range = input.range ?? { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
      const rows = db
        .prepare(
          `SELECT a.start_at, a.status, a.reason, p.full_name AS patient, p.phone, d.full_name AS dentist
           FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN dentists d ON d.id = a.dentist_id
           WHERE date(a.start_at) >= ? AND date(a.start_at) <= ? AND a.deleted_at IS NULL ORDER BY a.start_at`,
        )
        .all(range.from, range.to) as Record<string, unknown>[];
      const html = renderTableReport(
        'Appointment Summary',
        `${range.from} → ${range.to}`,
        ['Date/Time', 'Patient', 'Phone', 'Dentist', 'Reason', 'Status'],
        rows.map((r) => [
          String(r.start_at).replace('T', ' '),
          String(r.patient),
          String(r.phone ?? ''),
          String(r.dentist),
          String(r.reason ?? ''),
          String(r.status),
        ]),
        clinic,
        opts,
      );
      return { html, widthMm: profile.widthMm, heightMm: profile.heightMm, paperSize: profile.paperSize };
    }
    case 'financialReport': {
      requirePermission(actor, 'financial.view');
      const db = currentDb();
      const range = input.range ?? { from: '2000-01-01', to: new Date().toISOString().slice(0, 10) };
      const income = db
        .prepare(
          `SELECT COALESCE(SUM(amount),0) AS s FROM financial_transactions WHERE kind='income' AND status='posted' AND paid_at >= ? AND paid_at <= ?`,
        )
        .get(range.from, range.to + 'T23:59:59') as { s: number };
      const expense = db
        .prepare(
          `SELECT COALESCE(SUM(amount),0) AS s FROM financial_transactions WHERE kind='expense' AND status='posted' AND paid_at >= ? AND paid_at <= ?`,
        )
        .get(range.from, range.to + 'T23:59:59') as { s: number };
      const collected = db
        .prepare(
          `SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS c FROM payments WHERE status='posted' AND paid_at >= ? AND paid_at <= ?`,
        )
        .get(range.from + 'T00:00:00', range.to + 'T23:59:59') as { s: number; c: number };
      const outstanding = db
        .prepare(`SELECT COALESCE(SUM(total - paid_total),0) AS s FROM invoices WHERE status IN ('unpaid','partial')`)
        .get() as { s: number };
      const byCat = db
        .prepare(
          `SELECT c.name, ft.kind, SUM(ft.amount) AS total FROM financial_transactions ft
           JOIN accounting_categories c ON c.id = ft.category_id
           WHERE ft.status='posted' AND ft.paid_at >= ? AND ft.paid_at <= ?
           GROUP BY c.id ORDER BY total DESC`,
        )
        .all(range.from, range.to + 'T23:59:59') as Record<string, unknown>[];
      const html = renderTableReport(
        'Financial Report',
        `${range.from} → ${range.to}`,
        ['Item', 'Amount (৳)'],
        [
          ['Total collected (payments)', formatMoney(collected.s)],
          ['Payment count', String(collected.c)],
          ['Ledger income', formatMoney(income.s)],
          ['Ledger expenses', formatMoney(expense.s)],
          ['Net (income - expense)', formatMoney(income.s - expense.s)],
          ['Outstanding invoices', formatMoney(outstanding.s)],
          ...byCat.map((c) => [`${c.kind === 'income' ? 'Income' : 'Expense'} · ${c.name}`, formatMoney(Number(c.total))]),
        ],
        clinic,
        opts,
      );
      return { html, widthMm: profile.widthMm, heightMm: profile.heightMm, paperSize: profile.paperSize };
    }
    case 'inventoryReport': {
      requirePermission(actor, 'inventory.view');
      const rows = currentDb()
        .prepare(
          `SELECT code, name, category, unit, current_stock, min_stock, purchase_price FROM inventory_items
           WHERE deleted_at IS NULL ORDER BY name`,
        )
        .all() as Record<string, unknown>[];
      const html = renderTableReport(
        'Inventory Report',
        '',
        ['Code', 'Item', 'Category', 'Stock', 'Min', 'Cost (৳)'],
        rows.map((r) => [
          String(r.code),
          String(r.name),
          String(r.category),
          `${r.current_stock} ${r.unit}`,
          String(r.min_stock),
          formatMoney(Number(r.purchase_price)),
        ]),
        clinic,
        opts,
      );
      return { html, widthMm: profile.widthMm, heightMm: profile.heightMm, paperSize: profile.paperSize };
    }
    case 'chart': {
      requirePermission(actor, 'clinical.view');
      const db = currentDb();
      const p = db.prepare('SELECT full_name, patient_code, gender, age FROM patients WHERE id = ? AND deleted_at IS NULL').get(
        input.entityId,
      ) as Record<string, unknown> | undefined;
      if (!p) throw new ServiceError('not_found', 'Patient not found', 404);
      const chart = db.prepare('SELECT id, dentition FROM dental_charts WHERE patient_id = ?').get(input.entityId) as
        | Record<string, unknown>
        | undefined;
      const conds = db.prepare('SELECT code, label, sort FROM chart_conditions ORDER BY sort').all() as Record<
        string,
        unknown
      >[];
      const condMap = new Map(conds.map((c) => [String(c.code), String(c.label)]));
      let entries: { toothId: string; conditionCode: string; notes?: string }[] = [];
      let dentition = 'adult';
      if (chart) {
        dentition = String(chart.dentition ?? 'adult');
        const rows = db
          .prepare('SELECT tooth_id, condition_code, notes FROM dental_chart_entries WHERE chart_id = ?')
          .all(chart.id) as Record<string, unknown>[];
        entries = rows.map((r) => ({
          toothId: String(r.tooth_id),
          conditionCode: String(r.condition_code),
          notes: (r.notes as string | null) ?? undefined,
        }));
      }
      if (!entries.length) throw new ServiceError('not_found', 'No dental chart recorded for this patient yet', 404);
      const sorted = [...entries].sort((a, b) => Number(a.toothId) - Number(b.toothId));
      const html = renderTableReport(
        `Dental Chart — ${String(p.full_name)}`,
        `${String(p.patient_code)} · ${dentition === 'pediatric' ? 'Pediatric dentition' : 'Adult dentition'} · FDI numbering`,
        ['Tooth (FDI)', 'Condition', 'Notes'],
        sorted.map((e) => [e.toothId, condMap.get(e.conditionCode) ?? e.conditionCode, e.notes ?? '']),
        clinic,
        opts,
      );
      return { html, widthMm: profile.widthMm, heightMm: profile.heightMm, paperSize: profile.paperSize };
    }
    default:
      throw new ServiceError('validation', 'Unknown print template');
  }
}

/* ------------------------------ print execution ------------------------------ */

function mmToMicrons(mm: number): number {
  return Math.round(mm * 1000);
}

async function withPrintWindow<T>(fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    return await fn(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

export async function runPrint(actor: ServiceActor, input: PrintRunInput): Promise<PrintRunResult> {
  const payload = buildPrintHtml(actor, input);
  const profile = getProfile(input.profileId);
  const htmlPath = path.join(
    process.env.DENTIVA_RUNTIME_DIR || path.join(app.getPath('userData'), 'runtime'),
    `print-${Date.now()}.html`,
  );
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, payload.html, 'utf8');

  try {
    const result = await withPrintWindow(async (win) => {
      await win.loadFile(htmlPath);
      // let fonts/images settle
      await new Promise((r) => setTimeout(r, 150));
      if (input.mode === 'pdf') {
        const targetW = profile.orientation === 'landscape' ? profile.heightMm : profile.widthMm;
        const targetH = profile.orientation === 'landscape' ? profile.widthMm : profile.heightMm;
        const pdf = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: {
            width: mmToMicrons(targetW),
            height: mmToMicrons(targetH),
          },
          landscape: profile.orientation === 'landscape',
          margins: {
            marginType: 'custom',
            top: mmToMicrons(profile.marginTop),
            bottom: mmToMicrons(profile.marginBottom),
            left: mmToMicrons(profile.marginLeft),
            right: mmToMicrons(profile.marginRight),
          },
        } as never);
        return { pdf: pdf.toString('base64') as string };
      }
      // direct print to a Windows/system printer (dialog or silent with device)
      const printer = input.printerName || profile.name;
      const ok = await new Promise<boolean>((resolve) => {
        win.webContents.print(
          {
            silent: Boolean(input.printerName),
            deviceName: input.printerName || undefined,
            printBackground: true,
            margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
          },
          (success, failureReason) => {
            if (!success) logger.error('Print failed', { failureReason });
            resolve(success);
          },
        );
      });
      void printer;
      return { printed: ok };
    });
    fs.rmSync(htmlPath, { force: true });
    if ('pdf' in result) return { ok: true, pdfBase64: result.pdf };
    return { ok: Boolean(result.printed), reason: result.printed ? undefined : 'Printing was cancelled or failed' };
  } catch (err) {
    fs.rmSync(htmlPath, { force: true });
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Print run failed', { err: message });
    return { ok: false, reason: message };
  }
}

export { docShell, esc, fileUrl };
