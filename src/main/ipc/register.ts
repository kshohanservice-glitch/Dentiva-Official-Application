import { ipcMain, BrowserWindow, dialog } from 'electron';
import { API_METHODS, type ApiMethod, type AppEvent } from '../../shared/contract';
import { logger } from '../logger';
import { ServiceError } from '../services/common';
import { getSession, sessionActor, touchActivity, logout, unlock, login, changePassword, lockSession } from '../services/auth';
import * as activation from '../services/activation';
import * as setup from '../services/setup';
import * as settingsSvc from '../services/settings';
import * as admin from '../services/admin';
import * as patients from '../services/patients';
import * as clinical from '../services/clinical';
import * as scheduling from '../services/scheduling';
import * as billing from '../services/billing';
import * as inventory from '../services/inventory';
import * as accounting from '../services/accounting';
import * as notifications from '../services/notifications';
import * as search from '../services/search';
import * as dashboardSvc from '../services/dashboard';
import * as backupSvc from '../services/backup';
import * as exportSvc from '../services/export';
import { buildPrintHtml, runPrint, mapProfile } from '../print/run';
import { currentDb } from '../db/database';
import { isSetupComplete } from '../services/setup';
import { isActivated } from '../services/activation';
import { APP_VERSION, BUILD_NUMBER } from '../version';
import { SCHEMA_VERSION } from '../db/database';
import type { AppState, SettingsPayload, PrinterProfileInput, AttachmentAddInput } from '../../shared/contract';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { paths } from '../paths';

const ALLOWED = new Set<string>(API_METHODS);
const NO_AUTH = new Set<string>([
  'app.state',
  'activation.verify',
  'setup.status',
  'setup.saveClinic',
  'setup.saveDentists',
  'setup.saveAdmin',
  'setup.savePreferences',
  'setup.finish',
  'auth.login',
  'auth.logout',
]);
const LOCK_ALLOWED = new Set<string>(['app.state', 'auth.unlock', 'auth.logout', 'auth.lock']);

export function emitEvent(event: AppEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('dp:event', event);
  }
}

function computeAppState(): AppState {
  const session = getSession();
  const setupDone = isSetupComplete();
  const activated = isActivated();
  let phase: AppState['phase'];
  if (!activated) phase = 'activate';
  else if (!setupDone) phase = 'setup';
  else if (!session) phase = 'login';
  else if (session.locked) phase = 'locked';
  else phase = 'ready';
  return {
    phase,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    buildNumber: BUILD_NUMBER,
    activated,
    setupComplete: setupDone,
    setupStep: setup.getSetupStep(),
    clinicName: (settingsSvc.getAllSettings().clinic as Record<string, unknown>).name as string | null,
    user: session?.user ?? null,
    now: new Date().toISOString(),
  };
}

/* ------------------------------- attachments ------------------------------- */

const MAGIC: { mime: string; bytes: number[]; ext: string[] }[] = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46], ext: ['.pdf'] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ext: ['.png'] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff], ext: ['.jpg', '.jpeg'] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], ext: ['.webp'] },
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04], ext: ['.zip', '.docx', '.xlsx', '.pptx'] },
  { mime: 'application/x-ole-storage', bytes: [0xd0, 0xcf, 0x11, 0xe0], ext: ['.doc', '.xls'] },
];

function sniff(buf: Buffer): { mime: string; ok: boolean } {
  for (const m of MAGIC) {
    if (m.bytes.every((b, i) => buf[i] === b)) return { mime: m.mime, ok: true };
  }
  return { mime: 'application/octet-stream', ok: false };
}

function handleAttachmentAdd(input: AttachmentAddInput): { id: number } {
  const actor = sessionActor();
  if (!actor.permissions.includes('patient.edit') && !actor.isSystem) {
    throw new ServiceError('forbidden', 'Missing permission: patient.edit', 403);
  }
  const db = currentDb();
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (!patient) throw new ServiceError('not_found', 'Patient not found', 404);
  const maxMb = 25;
  const buf = Buffer.from(input.dataBase64, 'base64');
  if (buf.length === 0) throw new ServiceError('validation', 'File is empty');
  if (buf.length > maxMb * 1024 * 1024) throw new ServiceError('validation', `File exceeds ${maxMb} MB limit`);
  const sniffed = sniff(buf);
  if (!sniffed.ok) throw new ServiceError('validation', 'Unsupported or unrecognized file format');
  const original = path.basename(input.filename).replace(/[^\p{L}\p{N}._\- ()]/gu, '').slice(0, 120) || 'file';
  const ext = path.extname(original).toLowerCase() || '.bin';
  const year = new Date().getFullYear().toString();
  const dir = path.join(paths().attachments, year);
  fs.mkdirSync(dir, { recursive: true });
  const stored = `${Date.now()}-${createHash('sha256').update(buf).digest('hex').slice(0, 12)}${ext}`;
  fs.writeFileSync(path.join(dir, stored), buf);
  const sha = createHash('sha256').update(buf).digest('hex');
  const res = db
    .prepare(
      `INSERT INTO patient_attachments (patient_id, filename, stored_path, mime, size, sha256, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.patientId, original, path.join(year, stored), sniffed.mime, buf.length, sha, actor.userId);
  return { id: Number(res.lastInsertRowid) };
}

/* --------------------------------- printers --------------------------------- */

function listPrinterProfiles() {
  const rows = currentDb().prepare('SELECT * FROM printer_profiles ORDER BY is_default DESC, id').all() as Record<
    string,
    unknown
  >[];
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    printerName: (r.printer_name as string | null) ?? null,
    paperSize: r.paper_size as PrinterProfileInput['paperSize'],
    widthMm: Number(r.width_mm),
    heightMm: Number(r.height_mm),
    marginTop: Number(r.margin_top),
    marginRight: Number(r.margin_right),
    marginBottom: Number(r.margin_bottom),
    marginLeft: Number(r.margin_left),
    orientation: r.orientation as 'portrait' | 'landscape',
    scale: Number(r.scale),
    copies: Number(r.copies),
    isDefault: Boolean(r.is_default),
  }));
}

function savePrinterProfile(input: PrinterProfileInput): { id: number } {
  const db = currentDb();
  const validSizes = ['A4', 'A5', '80mm', '58mm', 'custom'];
  if (!validSizes.includes(input.paperSize)) throw new ServiceError('validation', 'Invalid paper size');
  if (!input.name?.trim()) throw new ServiceError('validation', 'Profile name is required');
  const width = input.widthMm ?? (input.paperSize === 'A5' ? 148 : input.paperSize === '80mm' ? 80 : input.paperSize === '58mm' ? 58 : 210);
  const height = input.heightMm ?? (input.paperSize === 'A5' ? 210 : input.paperSize === 'A4' ? 297 : 2000);
  if (width < 20 || width > 500 || height < 20 || height > 5000) {
    throw new ServiceError('validation', 'Paper dimensions out of range');
  }
  const tx = db.transaction(() => {
    if (input.isDefault) db.prepare('UPDATE printer_profiles SET is_default = 0').run();
    let id = input.id ?? 0;
    if (input.id) {
      db.prepare(
        `UPDATE printer_profiles SET name=?, printer_name=?, paper_size=?, width_mm=?, height_mm=?,
          margin_top=?, margin_right=?, margin_bottom=?, margin_left=?, orientation=?, scale=?, copies=?, is_default=? WHERE id=?`,
      ).run(
        input.name.trim(),
        input.printerName ?? null,
        input.paperSize,
        width,
        height,
        input.marginTop ?? 8,
        input.marginRight ?? 8,
        input.marginBottom ?? 8,
        input.marginLeft ?? 8,
        input.orientation ?? 'portrait',
        input.scale ?? 100,
        input.copies ?? 1,
        input.isDefault ? 1 : 0,
        input.id,
      );
    } else {
      const res = db
        .prepare(
          `INSERT INTO printer_profiles (name, printer_name, paper_size, width_mm, height_mm, margin_top, margin_right,
            margin_bottom, margin_left, orientation, scale, copies, is_default)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name.trim(),
          input.printerName ?? null,
          input.paperSize,
          width,
          height,
          input.marginTop ?? 8,
          input.marginRight ?? 8,
          input.marginBottom ?? 8,
          input.marginLeft ?? 8,
          input.orientation ?? 'portrait',
          input.scale ?? 100,
          input.copies ?? 1,
          input.isDefault ? 1 : 0,
        );
      id = Number(res.lastInsertRowid);
    }
    return id;
  });
  const id = tx();
  return { id };
}

/* --------------------------------- dispatch --------------------------------- */


async function dispatch(method: ApiMethod, payload: unknown): Promise<unknown> {
  const needsAuth = !NO_AUTH.has(method);
  const session = getSession();
  if (needsAuth && !session) throw new ServiceError('unauthenticated', 'Sign in required', 401);
  if (session?.locked && !LOCK_ALLOWED.has(method)) {
    throw new ServiceError('locked', 'Application is locked', 423);
  }
  const actor = session && !session.locked ? sessionActor() : session ? { ...sessionActor(), permissions: [] as never } : null;
  touchActivity();
  const p = (payload ?? {}) as never;

  switch (method) {
    /* ---- app ---- */
    case 'app.state':
      return computeAppState();

    /* ---- activation ---- */
    case 'activation.verify':
      return activation.activate((p as { code: string }).code, actor ?? undefined);

    /* ---- setup ---- */
    case 'setup.status':
      return setup.setupStatus();
    case 'setup.saveClinic':
      return setup.setupSaveClinic(p);
    case 'setup.saveDentists':
      return setup.setupSaveDentists((p as { dentists: never[] }).dentists);
    case 'setup.saveAdmin':
      return setup.setupSaveAdmin(p);
    case 'setup.savePreferences':
      return setup.setupSavePreferences(p);
    case 'setup.finish':
      return setup.setupFinish();

    /* ---- auth ---- */
    case 'auth.login': {
      const input = p as { username: string; password: string };
      const result = login(input.username, input.password);
      return result;
    }
    case 'auth.logout':
      logout();
      return { ok: true as const };
    case 'auth.lock':
      lockSession();
      return { ok: true as const };
    case 'auth.unlock':
      return unlock((p as { password: string }).password);
    case 'auth.changePassword': {
      const input = p as { currentPassword: string; newPassword: string };
      return changePassword(input.currentPassword, input.newPassword);
    }

    /* ---- settings / clinic / printers ---- */
    case 'settings.get':
      return settingsSvc.getSettings((p as { group?: string } | undefined)?.group);
    case 'settings.set': {
      const input = p as { group: string; values: Record<string, unknown> };
      settingsSvc.setSettings(actor!, input.group, input.values);
      return { ok: true as const };
    }
    case 'settings.resetSecurity': {
      const input = p as { password: string };
      admin.assertPassword(actor!, input.password);
      // reset auto-lock to default and unlock policy exceptions
      settingsSvc.setSettings(actor!, 'security', { autoLockMinutes: 10, allowDisableAutoLock: false });
      return { ok: true as const };
    }
    case 'clinic.get': {
      const s = settingsSvc.getAllSettings().clinic as Record<string, unknown>;
      return { id: 1, ...s };
    }
    case 'clinic.update': {
      const input = p as Record<string, unknown>;
      settingsSvc.setSettings(actor!, 'clinic', input as never);
      return { ok: true as const };
    }
    case 'dentists.list':
      return admin.listDentists((p as { includeInactive?: boolean } | undefined)?.includeInactive);
    case 'dentists.create':
      return admin.createDentist(actor!, p);
    case 'dentists.update':
      admin.updateDentist(actor!, p);
      return { ok: true as const };
    case 'dentists.delete':
      return admin.deleteDentist(actor!, (p as { id: number }).id);
    case 'printers.profiles':
      return listPrinterProfiles();
    case 'printers.saveProfile':
      return savePrinterProfile(p);
    case 'printers.deleteProfile': {
      const id = (p as { id: number }).id;
      currentDb().prepare('DELETE FROM printer_profiles WHERE id = ?').run(id);
      return { ok: true as const };
    }
    case 'printers.systemPrinters': {
      const { session } = { session: getSession() };
      void session;
      const printers = await new Promise<{ name: string; isDefault: boolean }[]>((resolve) => {
        BrowserWindow.getAllWindows()[0]?.webContents
          .getPrintersAsync()
          .then((list) => resolve(list.map((x) => ({ name: x.name, isDefault: (x as { isDefault?: boolean }).isDefault ?? false }))))
          .catch(() => resolve([]));
      });
      return printers;
    }

    /* ---- users / roles ---- */
    case 'users.list':
      return admin.listUsers(actor!);
    case 'users.create':
      return admin.createUser(actor!, p);
    case 'users.update':
      admin.updateUser(actor!, p);
      return { ok: true as const };
    case 'users.delete': {
      const input = p as { id: number; password: string };
      return admin.deleteUser(actor!, input.id, input.password);
    }
    case 'users.resetPassword': {
      const input = p as { id: number; newPassword: string; password: string };
      return admin.resetUserPassword(actor!, input.id, input.newPassword, input.password);
    }
    case 'roles.list':
      return admin.listRoles(actor!);
    case 'roles.save':
      return admin.saveRole(actor!, p);
    case 'roles.delete':
      return admin.deleteRole(actor!, (p as { id: number }).id);

    /* ---- patients ---- */
    case 'patients.list':
      return patients.listPatients(actor!, p);
    case 'patients.get':
      return patients.getPatientProfile(actor!, (p as { id: number }).id);
    case 'patients.create':
      return patients.createPatient(actor!, p);
    case 'patients.update':
      patients.updatePatient(actor!, p);
      return { ok: true as const };
    case 'patients.archive':
      patients.setPatientStatus(actor!, (p as { id: number }).id, 'archived');
      return { ok: true as const };
    case 'patients.restore':
      patients.setPatientStatus(actor!, (p as { id: number }).id, 'active');
      return { ok: true as const };
    case 'patients.delete': {
      const input = p as { id: number; password: string; confirmPhrase?: string };
      return patients.deletePatient(actor!, input.id, input.password, input.confirmPhrase);
    }
    case 'patients.timeline':
      return patients.patientTimeline(actor!, (p as { id: number }).id);
    case 'patients.addNote':
      return patients.addPatientNote(actor!, (p as { patientId: number }).patientId, (p as { body: string }).body);
    case 'referrals.create':
      return clinical.addReferral(actor!, p);
    case 'referrals.list':
      return clinical.listReferrals(actor!, (p as { patientId: number }).patientId);
    case 'patients.duplicateCheck':
      return { matches: patients.findDuplicateMatches((p as { phone?: string }).phone, (p as { name?: string }).name) };

    /* ---- attachments ---- */
    case 'attachments.list': {
      const patientId = (p as { patientId: number }).patientId;
      const rows = currentDb()
        .prepare(
          `SELECT a.id, a.patient_id, a.filename, a.mime, a.size, a.created_at, u.username AS uploader
           FROM patient_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
           WHERE a.patient_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC`,
        )
        .all(patientId) as Record<string, unknown>[];
      return rows.map((r) => ({
        id: Number(r.id),
        patientId: Number(r.patient_id),
        filename: String(r.filename),
        mime: String(r.mime),
        size: Number(r.size),
        createdAt: String(r.created_at),
        uploadedBy: (r.uploader as string | null) ?? null,
      }));
    }
    case 'attachments.add':
      return handleAttachmentAdd(p as never);
    case 'attachments.read': {
      const id = (p as { id: number }).id;
      const row = currentDb().prepare('SELECT * FROM patient_attachments WHERE id = ? AND deleted_at IS NULL').get(id) as
        | Record<string, unknown>
        | undefined;
      if (!row) throw new ServiceError('not_found', 'Attachment not found', 404);
      const abs = path.join(paths().attachments, String(row.stored_path));
      if (!abs.startsWith(paths().attachments) || !fs.existsSync(abs)) {
        throw new ServiceError('not_found', 'Attachment file is missing on disk', 404);
      }
      const buf = fs.readFileSync(abs);
      return {
        filename: String(row.filename),
        mime: String(row.mime),
        dataBase64: buf.toString('base64'),
      };
    }
    case 'attachments.export': {
      const id = (p as { id: number }).id;
      const row = currentDb().prepare('SELECT * FROM patient_attachments WHERE id = ? AND deleted_at IS NULL').get(id) as
        | Record<string, unknown>
        | undefined;
      if (!row) throw new ServiceError('not_found', 'Attachment not found', 404);
      const abs = path.join(paths().attachments, String(row.stored_path));
      const result = await dialog.showSaveDialog({
        defaultPath: String(row.filename),
      });
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
      fs.copyFileSync(abs, result.filePath);
      return { ok: true, path: result.filePath };
    }
    case 'attachments.delete': {
      const id = (p as { id: number }).id;
      currentDb().prepare("UPDATE patient_attachments SET deleted_at = datetime('now','localtime') WHERE id = ?").run(id);
      return { ok: true as const };
    }

    /* ---- visits ---- */
    case 'visits.list':
      return clinical.listVisits(actor!, p);
    case 'visits.get':
      return clinical.getVisit(actor!, (p as { id: number }).id);
    case 'visits.create':
      return clinical.createVisit(actor!, p);
    case 'visits.update':
      clinical.updateVisit(actor!, p);
      return { ok: true as const };
    case 'visits.delete':
      return clinical.deleteVisit(actor!, (p as { id: number }).id);

    /* ---- chart ---- */
    case 'chart.conditions':
      return clinical.listChartConditions();
    case 'chart.get':
      return clinical.getChart(actor!, (p as { patientId: number }).patientId);
    case 'chart.save':
      return clinical.saveChart(actor!, p);

    /* ---- treatments ---- */
    case 'treatments.list':
      return clinical.listTreatments(actor!, (p as { q?: string; category?: string; includeInactive?: boolean } | undefined) ?? {});
    case 'treatments.save':
      return clinical.saveTreatment(actor!, p);
    case 'treatments.delete':
      return clinical.deleteTreatment(actor!, (p as { id: number }).id);
    case 'treatmentRecords.list':
      return clinical.listTreatmentRecords(actor!, (p as { patientId: number }).patientId);
    case 'treatmentRecords.create':
      return clinical.createTreatmentRecord(actor!, p);
    case 'treatmentRecords.delete':
      return clinical.deleteTreatmentRecord(actor!, (p as { id: number }).id);

    /* ---- prescriptions ---- */
    case 'prescriptions.list':
      return clinical.listPrescriptions(actor!, p);
    case 'prescriptions.get':
      return clinical.getPrescription(actor!, (p as { id: number }).id);
    case 'prescriptions.create':
      return clinical.createPrescription(actor!, p);
    case 'prescriptions.update':
      clinical.updatePrescription(actor!, p);
      return { ok: true as const };
    case 'prescriptions.delete':
      return clinical.deletePrescription(actor!, (p as { id: number }).id);
    case 'medications.list':
      return clinical.listMedications(actor!);
    case 'medications.save':
      return clinical.saveMedication(actor!, p);
    case 'medications.delete':
      return clinical.deleteMedication(actor!, (p as { id: number }).id);

    /* ---- appointments ---- */
    case 'appointments.list':
      return scheduling.listAppointments(actor!, p);
    case 'appointments.get':
      return scheduling.getAppointment(actor!, (p as { id: number }).id);
    case 'appointments.save': {
      const input = p as { allowConflictOverride?: boolean } & Record<string, unknown>;
      return scheduling.saveAppointment(actor!, input as never, { allowConflictOverride: input.allowConflictOverride });
    }
    case 'appointments.setStatus':
      return scheduling.setAppointmentStatus(actor!, (p as { id: number }).id, (p as { status: never }).status);
    case 'appointments.delete':
      return scheduling.deleteAppointment(actor!, (p as { id: number }).id);
    case 'appointments.conflicts':
      return scheduling.findConflicts(
        (p as { dentistId: number }).dentistId,
        (p as { startAt: string }).startAt,
        (p as { durationMin: number }).durationMin,
        (p as { ignoreId?: number }).ignoreId,
      );

    /* ---- queue ---- */
    case 'queue.list':
      return scheduling.listQueue(actor!, (p as { date?: string } | undefined)?.date);
    case 'queue.checkIn':
      return scheduling.checkInQueue(actor!, p);
    case 'queue.setStatus':
      scheduling.setQueueStatus(actor!, (p as { id: number }).id, (p as { status: never }).status);
      emitEvent({ type: 'queue' });
      return { ok: true as const };
    case 'queue.callNext': {
      const out = scheduling.callNext(actor!, (p as { dentistId?: number } | undefined)?.dentistId ?? null);
      emitEvent({ type: 'queue' });
      return out;
    }

    /* ---- invoices / payments ---- */
    case 'invoices.list':
      return billing.listInvoices(actor!, p);
    case 'invoices.get':
      return billing.getInvoice(actor!, (p as { id: number }).id);
    case 'invoices.create':
      return billing.createInvoice(actor!, p);
    case 'invoices.update':
      billing.updateInvoice(actor!, p);
      return { ok: true as const };
    case 'invoices.void': {
      const input = p as { id: number; password: string };
      return billing.voidInvoice(actor!, input.id, input.password);
    }
    case 'payments.list':
      return billing.listPayments(actor!, p);
    case 'payments.get':
      return billing.getPayment(actor!, (p as { id: number }).id);
    case 'payments.create':
      return billing.createPayment(actor!, p);
    case 'payments.reverse': {
      const input = p as { id: number; reason: string; password: string };
      return billing.reversePayment(actor!, input.id, input.reason, input.password);
    }
    case 'payments.dashboard':
      return billing.paymentsDashboard(actor!, (p as { period: string }).period, (p as { from?: string }).from, (p as { to?: string }).to);

    /* ---- inventory ---- */
    case 'inventory.list':
      return inventory.listInventory(actor!, p);
    case 'inventory.get':
      return inventory.getInventoryItem(actor!, (p as { id: number }).id);
    case 'inventory.save':
      return inventory.saveInventoryItem(actor!, p);
    case 'inventory.delete':
      return inventory.deleteInventoryItem(actor!, (p as { id: number }).id);
    case 'inventory.move':
      return inventory.moveStock(actor!, p);
    case 'inventory.batches':
      return inventory.listBatches(actor!, (p as { itemId: number }).itemId);
    case 'inventory.alerts':
      return inventory.inventoryAlerts(actor!);
    case 'suppliers.list':
      return inventory.listSuppliers(actor!);
    case 'suppliers.save':
      return inventory.saveSupplier(actor!, p);
    case 'suppliers.delete':
      return inventory.deleteSupplier(actor!, (p as { id: number }).id);

    /* ---- accounting ---- */
    case 'accounting.categories':
      return accounting.listCategories(actor!);
    case 'accounting.saveCategory':
      return accounting.saveCategory(actor!, p);
    case 'accounting.entries':
      return accounting.listLedger(actor!, p);
    case 'accounting.addEntry':
      return accounting.addLedgerEntry(actor!, p);
    case 'accounting.reverseEntry': {
      const input = p as { id: number; reason: string; password: string };
      return accounting.reverseLedgerEntry(actor!, input.id, input.reason, input.password);
    }

    /* ---- reports ---- */
    case 'reports.summary':
      return accounting.financialSummary(actor!, (p as { from: string }).from, (p as { to: string }).to);
    case 'reports.byTreatment':
      return accounting.revenueByTreatment(actor!, (p as { from: string }).from, (p as { to: string }).to);
    case 'reports.byDentist':
      return accounting.revenueByDentist(actor!, (p as { from: string }).from, (p as { to: string }).to);
    case 'reports.paymentMethods':
      return accounting.paymentMethodBreakdown(actor!, (p as { from: string }).from, (p as { to: string }).to);
    case 'reports.outstanding':
    case 'reports.patientBalances':
      return accounting.outstandingBalances(actor!);
    case 'reports.dashboard':
      return dashboardSvc.getDashboard(actor!);

    /* ---- staff ---- */
    case 'staff.list':
      return admin.listStaff(actor!, (p as { includeInactive?: boolean } | undefined)?.includeInactive);
    case 'staff.save':
      return admin.saveStaff(actor!, p);
    case 'staff.delete':
      return admin.deleteStaff(actor!, (p as { id: number }).id);

    /* ---- backup ---- */
    case 'backup.list':
      return backupSvc.listBackups(actor!);
    case 'backup.create':
      return backupSvc.createBackup(actor!, (p as { destDir?: string } | undefined)?.destDir);
    case 'backup.chooseFolder': {
      const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      return { path: res.canceled || !res.filePaths[0] ? null : res.filePaths[0] };
    }
    case 'backup.verify':
      return backupSvc.verifyBackup(actor!, (p as { path: string }).path);
    case 'restore.preview':
      return backupSvc.previewRestore(actor!, (p as { path: string }).path);
    case 'restore.run': {
      const input = p as { path: string; password: string };
      const result = await backupSvc.runRestore(actor!, input.path, input.password);
      if (result.ok) emitEvent({ type: 'data-changed', entity: 'restore' });
      return result;
    }

    /* ---- audit ---- */
    case 'audit.list': {
      const q = p as Record<string, unknown> & { page?: number; pageSize?: number };
      const actorForAudit = actor!;
      if (!actorForAudit.isSystem && !actorForAudit.permissions.includes('audit.view')) {
        throw new ServiceError('forbidden', 'Missing permission: audit.view', 403);
      }
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.action) {
        where.push('a.action LIKE ?');
        params.push(`%${q.action}%`);
      }
      if (q.entity) {
        where.push('a.entity = ?');
        params.push(q.entity);
      }
      if (q.userId) {
        where.push('a.user_id = ?');
        params.push(q.userId);
      }
      if (q.result) {
        where.push('a.result = ?');
        params.push(q.result);
      }
      if (q.q) {
        where.push('(LOWER(COALESCE(a.action,"")) LIKE ? OR LOWER(COALESCE(a.username,"")) LIKE ? OR LOWER(COALESCE(a.entity_id,"")) LIKE ?)');
        const like = `%${String(q.q).toLowerCase()}%`;
        params.push(like, like, like);
      }
      const pageSize = Math.min(200, Math.max(5, Number(q.pageSize ?? 25)));
      const page = Math.max(1, Number(q.page ?? 1));
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const total = (currentDb().prepare(`SELECT COUNT(*) AS c FROM audit_log a ${whereSql}`).get(...params) as { c: number }).c;
      const rows = currentDb()
        .prepare(
          `SELECT a.* FROM audit_log a ${whereSql} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
      return {
        items: rows.map((r) => ({
          id: Number(r.id),
          ts: String(r.ts),
          userId: (r.user_id as number | null) ?? null,
          username: (r.username as string | null) ?? null,
          action: String(r.action),
          entity: (r.entity as string | null) ?? null,
          entityId: (r.entity_id as string | null) ?? null,
          result: r.result as 'success' | 'failure',
          beforeState: r.before_json ? JSON.parse(String(r.before_json)) : null,
          afterState: r.after_json ? JSON.parse(String(r.after_json)) : null,
          metadata: r.metadata_json ? JSON.parse(String(r.metadata_json)) : null,
        })),
        total,
        page,
        pageSize,
      };
    }

    /* ---- notifications ---- */
    case 'notifications.list':
      return notifications.listNotifications(actor!, (p as { unreadOnly?: boolean } | undefined)?.unreadOnly);
    case 'notifications.markRead':
      notifications.markNotificationsRead(actor!, (p as { ids?: number[] } | undefined)?.ids);
      return { ok: true as const };
    case 'notifications.dismiss':
      notifications.dismissNotification(actor!, (p as { id: number }).id);
      return { ok: true as const };

    /* ---- search / export / print ---- */
    case 'search.global':
      return search.globalSearch(actor!, (p as { q: string }).q, (p as { limit?: number }).limit);
    case 'export.csv':
      return exportSvc.exportCsv(actor!, p);
    case 'print.preview':
      return buildPrintHtml(actor!, p);
    case 'print.run':
      return runPrint(actor!, p);

    /* ---- ledger ---- */
    case 'ledger.patientPayments': {
      const patientId = (p as { patientId: number }).patientId;
      const rows = currentDb()
        .prepare(
          `SELECT pay.*, pm.label AS method_label, pt.full_name AS patient_name, u.username AS received_by_name, inv.invoice_no
           FROM payments pay
           JOIN payment_methods pm ON pm.code = pay.method_code
           JOIN patients pt ON pt.id = pay.patient_id
           LEFT JOIN users u ON u.id = pay.received_by
           LEFT JOIN invoices inv ON inv.id = pay.invoice_id
           WHERE pay.patient_id = ? ORDER BY pay.paid_at DESC`,
        )
        .all(patientId) as Record<string, unknown>[];
      return rows.map((r) => ({
        id: Number(r.id),
        paymentNo: String(r.payment_no),
        patientId: Number(r.patient_id),
        patientName: String(r.patient_name),
        invoiceId: (r.invoice_id as number | null) ?? null,
        invoiceNo: (r.invoice_no as string | null) ?? null,
        amount: Number(r.amount),
        paidAt: String(r.paid_at),
        methodCode: r.method_code as never,
        methodLabel: String(r.method_label),
        reference: (r.reference as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
        receivedBy: (r.received_by as number | null) ?? null,
        receivedByName: (r.received_by_name as string | null) ?? null,
        status: r.status as 'posted' | 'reversed',
        reversalOf: (r.reversal_of as number | null) ?? null,
        createdAt: String(r.created_at),
      }));
    }

    default:
      throw new ServiceError('not_found', `Unknown method: ${method}`, 404);
  }
}

export function registerIpc(): void {
  ipcMain.handle('dp:invoke', async (_event, method: string, payload: unknown) => {
    if (typeof method !== 'string' || !ALLOWED.has(method)) {
      logger.warn('IPC blocked: unknown method', { method: String(method).slice(0, 64) });
      return { error: { code: 'bad_method', message: 'Unknown API method' } };
    }
    try {
      const result = await dispatch(method as ApiMethod, payload);
      return { result };
    } catch (err) {
      if (err instanceof ServiceError) {
        return { error: { code: err.code, message: err.message, details: err.httpish } };
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error('IPC handler failed', { method, err: message });
      return { error: { code: 'internal', message: 'Something went wrong. Please try again.' } };
    }
  });
}

export { mapProfile, type SettingsPayload };
