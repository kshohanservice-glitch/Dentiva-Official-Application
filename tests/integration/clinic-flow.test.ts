import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, teardownDatabase, rmDir } from './helpers';
import { currentDb } from '../../src/main/db/database';
import { SYSTEM_ACTOR, type ServiceActor } from '../../src/main/services/common';
import * as setup from '../../src/main/services/setup';
import * as admin from '../../src/main/services/admin';
import * as patients from '../../src/main/services/patients';
import * as clinical from '../../src/main/services/clinical';
import * as scheduling from '../../src/main/services/scheduling';
import * as billing from '../../src/main/services/billing';
import * as inventory from '../../src/main/services/inventory';
import * as accounting from '../../src/main/services/accounting';
import * as settings from '../../src/main/services/settings';
import * as exportSvc from '../../src/main/services/export';
import * as dashboard from '../../src/main/services/dashboard';
import * as notifications from '../../src/main/services/notifications';
import * as search from '../../src/main/services/search';
import * as backupSvc from '../../src/main/services/backup';
import { PERMISSIONS } from '../../src/shared/permissions';
import { todayIso } from '../../src/shared/format';

/**
 * Full clinic lifecycle integration test: setup → patients → clinical →
 * scheduling → billing → inventory → accounting → reports → backup.
 * Every assertion runs against the real SQLite database and real services.
 */

let dir: string;
let dentistId: number;
let patientId: number;
let patient2Id: number;
let adminActor: ServiceActor;
const ADMIN_PW = 'Dentiva#2026x';

function futureDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

beforeAll(() => {
  ({ dir } = freshDatabase('flow'));

  // --- setup wizard ---
  expect(setup.setupSaveClinic({ name: 'Dentiva Test Clinic', phone: '+880 1700-000001' }).ok).toBe(true);
  expect(setup.setupSaveDentists([{ fullName: 'Dr. Nasrin Sultana', designations: ['BDS'] }]).ok).toBe(true);
  expect(setup.setupSaveAdmin({ username: 'admin', password: ADMIN_PW, displayName: 'Clinic Admin' }).ok).toBe(true);
  expect(setup.setupSavePreferences({ appearance: { theme: 'light' } }).ok).toBe(true);
  expect(setup.setupFinish().ok).toBe(true);
  expect(setup.isSetupComplete()).toBe(true);

  dentistId = admin.listDentists()[0].id;
  expect(dentistId).toBeGreaterThan(0);

  adminActor = {
    userId: 1,
    username: 'admin',
    permissions: [...PERMISSIONS],
  };
}, 60_000);

afterAll(() => {
  teardownDatabase();
  rmDir(dir);
});

describe('patients', () => {
  it('creates patients with generated codes and profile aggregates', () => {
    const created = patients.createPatient(SYSTEM_ACTOR, {
      fullName: 'Abdul Rahman',
      phone: '+880 1711-111111',
      dob: '1990-04-12',
      gender: 'Male',
      address: 'Mirpur, Dhaka',
      allergies: 'Penicillin',
    });
    expect(created.patientCode).toMatch(/^P\d{5}$/);
    patientId = created.id;

    const created2 = patients.createPatient(SYSTEM_ACTOR, {
      fullName: 'Fatema Begum',
      phone: '+880 1711-111111', // same phone → duplicate candidate
      dob: '1995-01-01',
      gender: 'Female',
    });
    patient2Id = created2.id;
    // patient codes are unique
    expect(created2.patientCode).not.toBe(created.patientCode);

    const profile = patients.getPatientProfile(SYSTEM_ACTOR, patientId);
    expect(profile.patient.fullName).toBe('Abdul Rahman');
    expect(profile.patient.age).toBeGreaterThan(30);
    expect(profile.alerts.allergies).toBe('Penicillin');
    expect(profile.financial.totalBilled).toBe(0);
  });

  it('searches and filters the registry', () => {
    const byName = patients.listPatients(SYSTEM_ACTOR, { q: 'Abdul' });
    expect(byName.total).toBe(1);
    expect(byName.items[0].id).toBe(patientId);

    const byPhone = patients.listPatients(SYSTEM_ACTOR, { q: '1711-111111' });
    expect(byPhone.total).toBe(2);

    const byCode = patients.listPatients(SYSTEM_ACTOR, { q: byName.items[0].patientCode });
    expect(byCode.total).toBe(1);
  });

  it('detects duplicate phone/name matches', () => {
    const matches = patients.findDuplicateMatches('+880 1711-111111');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('records notes and builds a timeline', () => {
    patients.addPatientNote(SYSTEM_ACTOR, patientId, 'Prefers morning appointments — সকালে আসতে চান');
    const timeline = patients.patientTimeline(SYSTEM_ACTOR, patientId);
    expect(timeline.some((e) => e.kind === 'registration')).toBe(true);
    expect(timeline.some((e) => e.kind === 'note')).toBe(true);
  });
});

describe('clinical', () => {
  let visitId: number;

  it('creates and updates a visit', () => {
    const v = clinical.createVisit(SYSTEM_ACTOR, {
      patientId,
      dentistId,
      visitAt: `${todayIso()}T11:00:00`,
      chiefComplaint: 'Lower right molar pain',
      diagnosis: 'Irreversible pulpitis 46',
    });
    visitId = v.id;

    clinical.updateVisit(SYSTEM_ACTOR, {
      id: visitId,
      patientId,
      examination: 'Deep caries, tenderness to percussion',
      treatmentNotes: 'RCT 46 started',
      status: 'closed',
    });

    const got = clinical.getVisit(SYSTEM_ACTOR, visitId);
    expect(got.status).toBe('closed');
    expect(got.examination).toContain('Deep caries');
    expect(got.patientName).toBe('Abdul Rahman');

    const list = clinical.listVisits(SYSTEM_ACTOR, { q: 'pulpitis' });
    expect(list.total).toBe(1);
    const byDentist = clinical.listVisits(SYSTEM_ACTOR, { dentistId });
    expect(byDentist.total).toBeGreaterThanOrEqual(1);
  });

  it('saves and reads the dental chart (FDI entries)', () => {
    expect(clinical.listChartConditions().length).toBeGreaterThanOrEqual(20);

    clinical.saveChart(SYSTEM_ACTOR, {
      patientId,
      dentition: 'adult',
      entries: [
        { toothId: '46', conditionCode: 'root_canal', notes: 'RCT in progress' },
        { toothId: '16', conditionCode: 'caries' },
        { toothId: '38', conditionCode: 'impacted' },
      ],
    });

    const chart = clinical.getChart(SYSTEM_ACTOR, patientId);
    expect(chart).not.toBeNull();
    expect(chart!.entries).toHaveLength(3);
    expect(chart!.entries.find((e) => e.toothId === '46')?.conditionCode).toBe('root_canal');

    // invalid condition code rejected (FK-style validation)
    expect(() =>
      clinical.saveChart(SYSTEM_ACTOR, {
        patientId,
        dentition: 'adult',
        entries: [{ toothId: '47', conditionCode: 'no_such_condition' }],
      }),
    ).toThrow(/Unknown chart condition/);
  });

  it('manages treatment catalog and per-patient records', () => {
    const t = clinical.saveTreatment(SYSTEM_ACTOR, {
      code: 'RCT-46',
      name: 'Root canal — molar',
      category: 'Endodontics',
      defaultFee: 4500,
      durationMin: 60,
    });
    const catalog = clinical.listTreatments(SYSTEM_ACTOR, { q: 'root canal' });
    expect(catalog.some((x) => x.id === t.id)).toBe(true);
    expect(clinical.listTreatments(SYSTEM_ACTOR, { category: 'Endodontics' })).toHaveLength(1);

    const rec = clinical.createTreatmentRecord(SYSTEM_ACTOR, {
      patientId,
      visitId,
      treatmentId: t.id,
      toothIds: ['46'],
      fee: 4500,
      notes: 'Stage 1 — working length',
    });
    expect(rec.id).toBeGreaterThan(0);
    const records = clinical.listTreatmentRecords(SYSTEM_ACTOR, patientId);
    expect(records).toHaveLength(1);
    expect(records[0].toothIds).toEqual(['46']);
    expect(records[0].invoiced).toBe(false);
  });

  it('creates prescriptions with medicine rows', () => {
    const rx = clinical.createPrescription(SYSTEM_ACTOR, {
      patientId,
      visitId,
      dentistId,
      chiefComplaint: 'Tooth pain',
      items: [
        {
          medicineName: 'Amoxicillin 500mg',
          frequency: '1-0-1',
          duration: '5 days',
          meal: 'after',
          morning: true,
          night: true,
        },
        { medicineName: 'Ibuprofen 400mg', frequency: '1-1-1', duration: '3 days', meal: 'after' },
      ],
    });
    expect(rx.id).toBeGreaterThan(0);

    const got = clinical.getPrescription(SYSTEM_ACTOR, rx.id);
    expect(got.items).toHaveLength(2);
    expect(got.patientName).toBe('Abdul Rahman');
    expect(got.code).toMatch(/^RX/);

    const list = clinical.listPrescriptions(SYSTEM_ACTOR, { patientId });
    expect(list.total).toBe(1);
  });
});

describe('scheduling & queue', () => {
  it('records referrals for a patient', () => {
    const r = clinical.addReferral(SYSTEM_ACTOR, {
      patientId,
      referredTo: 'Dr. Nasir (Endodontist)',
      specialty: 'Endodontics',
      reason: 'Complex root canal case — refer for specialist care',
    });
    expect(r.id).toBeGreaterThan(0);
    const list = clinical.listReferrals(SYSTEM_ACTOR, patientId);
    expect(list.some((x) => x.id === r.id)).toBe(true);
  });

  it('saves an appointment and detects conflicts', () => {
    const startAt = `${futureDay(1)}T10:00:00`;
    const res = scheduling.saveAppointment(SYSTEM_ACTOR, {
      patientId,
      dentistId,
      startAt,
      durationMin: 30,
      reason: 'RCT follow-up',
    });
    expect(res.ok).toBe(true);

    const conflict = scheduling.findConflicts(dentistId, `${futureDay(1)}T10:15:00`, 30);
    expect(conflict.length).toBeGreaterThan(0);

    const list = scheduling.listAppointments(SYSTEM_ACTOR, { from: futureDay(0), to: futureDay(7) });
    expect(list.length).toBeGreaterThanOrEqual(1);

    const id = res.appointment!.id;
    const status = scheduling.setAppointmentStatus(SYSTEM_ACTOR, id, 'Confirmed');
    expect(status.ok).toBe(true);
    expect(scheduling.getAppointment(SYSTEM_ACTOR, id).status).toBe('Confirmed');
  });

  it('runs the token queue: check-in → call next → complete', () => {
    const tok = scheduling.checkInQueue(SYSTEM_ACTOR, { patientId, dentistId });
    expect(tok.number).toBeGreaterThanOrEqual(1);

    const called = scheduling.callNext(SYSTEM_ACTOR, dentistId);
    expect(called.entry).not.toBeNull();
    expect(called.entry!.patientId).toBe(patientId);
    expect(['called', 'in_consultation']).toContain(called.entry!.status);

    scheduling.setQueueStatus(SYSTEM_ACTOR, called.entry!.id, 'in_consultation');
    scheduling.setQueueStatus(SYSTEM_ACTOR, called.entry!.id, 'completed');
    const list = scheduling.listQueue(SYSTEM_ACTOR);
    expect(list.some((e) => e.status === 'completed')).toBe(true);
  });
});

describe('billing & payments', () => {
  let invoiceId: number;
  let total = 0;

  it('computes and issues an invoice with discount + tax', () => {
    const computed = billing.computeInvoice(
      [
        { qty: 1, unitPrice: 4500 },
        { qty: 2, unitPrice: 500, discount: 100 },
      ],
      200,
      100,
    );
    expect(computed.subtotal).toBe(4500 + 900);
    expect(computed.total).toBe(4500 + 900 - 200 + 100);

    const inv = billing.createInvoice(SYSTEM_ACTOR, {
      patientId,
      items: [
        { description: 'Root canal — molar', treatmentId: null, qty: 1, unitPrice: 4500 },
        { description: 'Composite filling', qty: 2, unitPrice: 500, discount: 100 },
      ],
      discountAmount: 200,
      taxAmount: 100,
    });
    expect(inv.invoiceNo).toMatch(/^INV-/);
    invoiceId = inv.id;

    const got = billing.getInvoice(SYSTEM_ACTOR, invoiceId);
    total = got.total;
    expect(total).toBe(computed.total);
    expect(got.status).toBe('unpaid');
    expect(got.balance).toBe(total);

    // invoice numbers never collide (sequence-backed), discount over subtotal rejected
    const inv2 = billing.createInvoice(SYSTEM_ACTOR, {
      patientId: patient2Id,
      items: [{ description: 'Scaling & polishing', treatmentId: null, qty: 1, unitPrice: 800 }],
    });
    expect(inv2.invoiceNo).not.toBe(inv.invoiceNo);
    expect(inv2.invoiceNo).toMatch(/^INV-/);
    expect(() => billing.computeInvoice([{ qty: 1, unitPrice: 100 }], 200)).toThrow();
  });

  it('records a partial payment then settles the invoice', () => {
    const half = Math.floor(total / 2);
    const p1 = billing.createPayment(adminActor, {
      patientId,
      invoiceId,
      amount: half,
      methodCode: 'bkash',
      reference: 'TXN-9981',
    });
    expect(p1.paymentNo).toMatch(/^PAY/);

    let inv = billing.getInvoice(SYSTEM_ACTOR, invoiceId);
    expect(inv.status).toBe('partial');
    expect(inv.paidTotal).toBe(half);
    expect(inv.balance).toBe(total - half);

    billing.createPayment(adminActor, {
      patientId,
      invoiceId,
      amount: total - half,
      methodCode: 'cash',
    });

    inv = billing.getInvoice(SYSTEM_ACTOR, invoiceId);
    expect(inv.status).toBe('paid');
    expect(inv.balance).toBe(0);
    expect(inv.payments).toHaveLength(2);
  });

  it('reverses a payment with password + reason (audited)', () => {
    const pay = billing.listPayments(SYSTEM_ACTOR, { patientId, pageSize: 10 }).items[0];
    const res = billing.reversePayment(adminActor, pay.id, 'Wrong method recorded', ADMIN_PW);
    expect(res.ok).toBe(true);

    const inv = billing.getInvoice(SYSTEM_ACTOR, invoiceId);
    expect(inv.status).not.toBe('paid');
    expect(inv.balance).toBeGreaterThan(0);

    // financial dashboard authorizes BEFORE any data query
    let denied: { code?: string } | null = null;
    try {
      billing.paymentsDashboard({ userId: 404, username: 'viewer', permissions: ['patient.view'] }, 'all');
    } catch (e) {
      denied = e as { code?: string };
    }
    expect(denied?.code).toBe('forbidden');

    const dash = billing.paymentsDashboard(SYSTEM_ACTOR, 'all');
    expect(dash.permitted).toBe(true);
    expect(dash.totalCollected).toBeGreaterThan(0);
    expect(dash.byMethod.length).toBeGreaterThan(0);
    expect(dash.outstanding).toBeGreaterThan(0);
  });

  it('patient profile financials aggregate billed/paid/outstanding', () => {
    const profile = patients.getPatientProfile(SYSTEM_ACTOR, patientId);
    expect(profile.financial.permitted).toBe(true);
    expect(profile.financial.totalBilled).toBe(total);
    expect(profile.financial.outstanding).toBeGreaterThan(0);
  });
});

describe('inventory & suppliers', () => {
  it('tracks stock movements and low-stock alerts', () => {
    const sup = inventory.saveSupplier(SYSTEM_ACTOR, { name: 'Dental House BD', phone: '+880 1800-000000' });
    expect(sup.id).toBeGreaterThan(0);

    const item = inventory.saveInventoryItem(SYSTEM_ACTOR, {
      code: 'GLO-001',
      name: 'Gloves (nitrile)',
      category: 'Consumables',
      unit: 'box',
      supplierId: sup.id,
      purchasePrice: 350,
      minStock: 5,
      openingStock: 10,
    });

    let full = inventory.getInventoryItem(SYSTEM_ACTOR, item.id);
    expect(full.currentStock).toBe(10);

    const move = inventory.moveStock(SYSTEM_ACTOR, { itemId: item.id, type: 'out', qty: 7, note: 'Used in clinic' });
    expect(move.currentStock).toBe(3);

    full = inventory.getInventoryItem(SYSTEM_ACTOR, item.id);
    expect(full.currentStock).toBe(3);
    expect(full.minStock).toBe(5);

    const alerts = inventory.inventoryAlerts(SYSTEM_ACTOR);
    expect(alerts.lowStock.some((i) => i.id === item.id)).toBe(true);

    // batched receipt creates a tracked batch row
    inventory.moveStock(SYSTEM_ACTOR, {
      itemId: item.id,
      type: 'in',
      qty: 20,
      batchNo: 'LOT-77',
      expiryDate: futureDay(90),
      unitCost: 340,
    });
    const batches = inventory.listBatches(SYSTEM_ACTOR, item.id);
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches.some((b) => b.batchNo === 'LOT-77')).toBe(true);
    expect(inventory.getInventoryItem(SYSTEM_ACTOR, item.id).currentStock).toBe(23);

    // negative stock is impossible — oversell is rejected
    expect(() =>
      inventory.moveStock(SYSTEM_ACTOR, { itemId: item.id, type: 'out', qty: 99_999 }),
    ).toThrow(/Insufficient stock/);
    expect(inventory.getInventoryItem(SYSTEM_ACTOR, item.id).currentStock).toBe(23);

    expect(inventory.listSuppliers(SYSTEM_ACTOR).some((x) => x.id === sup.id)).toBe(true);
  });

  it('filters inventory list by query and low filter', () => {
    const q = inventory.listInventory(SYSTEM_ACTOR, { q: 'Gloves' });
    expect(q).toHaveLength(1);
    // after the restock above the item is above minimum → excluded from low filter
    const low = inventory.listInventory(SYSTEM_ACTOR, { filter: 'low' });
    expect(low.some((i) => i.code === 'GLO-001')).toBe(false);
    const all = inventory.listInventory(SYSTEM_ACTOR, { q: 'GLO-001' });
    expect(all[0].currentStock).toBe(23);
  });
});

describe('accounting & reports', () => {
  it('records expense ledger entries and sums them in the summary', () => {
    const cats = accounting.listCategories(SYSTEM_ACTOR);
    const rent = cats.find((c) => c.kind === 'expense' && c.name === 'Clinic Rent');
    expect(rent).toBeDefined();

    accounting.addLedgerEntry(SYSTEM_ACTOR, {
      kind: 'expense',
      categoryId: rent!.id,
      amount: 12000,
      methodCode: 'bank',
      paidAt: todayIso(),
      reference: 'RENT-SEP',
    });

    const summary = accounting.financialSummary(SYSTEM_ACTOR, todayIso(), todayIso());
    expect(summary.expense).toBeGreaterThanOrEqual(12000);
    expect(summary.byCategory.some((c) => c.name === 'Clinic Rent')).toBe(true);
  });

  it('dashboard reports real numbers without crashing', () => {
    const d = dashboard.getDashboard(SYSTEM_ACTOR);
    expect(d.todayAppointments).toBeGreaterThanOrEqual(0);
    expect(d.recentPatients.length).toBeGreaterThan(0);
    expect(d.financial).not.toBeNull();
    expect(d.financial!.todayPayments).toBeGreaterThanOrEqual(0);
  });

  it('global search finds patients across categories', () => {
    const hits = search.globalSearch(SYSTEM_ACTOR, 'Abdul');
    expect(hits.some((h) => h.category === 'patients' && h.id === patientId)).toBe(true);
  });
});

describe('notifications & audit trail', () => {
  it('generates system notifications and lists them', () => {
    notifications.generateSystemNotifications();
    const list = notifications.listNotifications(SYSTEM_ACTOR);
    expect(Array.isArray(list)).toBe(true);
  });

  it('audit log records chained entries', () => {
    const entries = currentDb()
      .prepare('SELECT action, hash FROM audit_log ORDER BY id')
      .all() as { action: string; hash: string }[];
    expect(entries.length).toBeGreaterThan(3);
    expect(entries.some((e) => e.action.startsWith('patient.'))).toBe(true);
    expect(entries.every((e) => e.hash.length === 64)).toBe(true);
  });
});

describe('backup', () => {
  it('creates, verifies and previews a backup archive', async () => {
    const res = await backupSvc.createBackup(SYSTEM_ACTOR, undefined, 'integration test');
    expect(res.ok).toBe(true);
    expect(res.path).toBeTruthy();

    const verified = await backupSvc.verifyBackup(SYSTEM_ACTOR, res.path!);
    expect(verified.valid).toBe(true);

    const preview = await backupSvc.previewRestore(SYSTEM_ACTOR, res.path!);
    expect(preview.valid).toBe(true);
    expect(preview.manifest.counts).toBeDefined();

    const list = backupSvc.listBackups(SYSTEM_ACTOR);
    expect(list.some((b) => b.path === res.path)).toBe(true);
  }, 60_000);
});


describe('settings & database health', () => {
  it('persists validated settings and rejects unknown keys', () => {
    settings.setSettings(SYSTEM_ACTOR, 'security', { autoLockMinutes: 15 });
    expect(settings.getSecuritySettings().autoLockMinutes).toBe(15);

    expect(() => settings.setSettings(SYSTEM_ACTOR, 'security', { nope: 1 })).toThrow(/Unknown setting/);
    expect(() => settings.setSettings(SYSTEM_ACTOR, 'no-such-group', { a: 1 })).toThrow(/Unknown settings group/);
  });

  it('settings.update requires settings.manage', () => {
    let denied: { code?: string } | null = null;
    try {
      settings.setSettings({ userId: 404, username: 'viewer', permissions: ['patient.view'] }, 'security', {
        autoLockMinutes: 5,
      });
    } catch (e) {
      denied = e as { code?: string };
    }
    expect(denied?.code).toBe('forbidden');
    // value unchanged by the denied call
    expect(settings.getSecuritySettings().autoLockMinutes).toBe(15);
  });

  it('runs in WAL mode and passes the integrity check', () => {
    const db = currentDb();
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
    expect(String(db.pragma('integrity_check', { simple: true }))).toBe('ok');
  });
});


describe('destructive delete guard', () => {
  it('password-gates deletion and honors typed confirmation', () => {
    const fresh = patients.createPatient(SYSTEM_ACTOR, {
      fullName: 'Zahur Hasan',
      phone: '+880 1799-999999',
    });
    const code = patients.getPatientProfile(SYSTEM_ACTOR, fresh.id).patient.patientCode;

    // wrong password rejected
    expect(() => patients.deletePatient(adminActor, fresh.id, 'wrong-password', code)).toThrow();
    // right password but wrong confirmation phrase rejected
    expect(() => patients.deletePatient(adminActor, fresh.id, ADMIN_PW, 'not-the-code')).toThrow(/confirm/i);
    // typing the patient code confirms
    const res = patients.deletePatient(adminActor, fresh.id, ADMIN_PW, code);
    expect(res.ok).toBe(true);
    expect(patients.listPatients(SYSTEM_ACTOR, { q: 'Zahur' }).total).toBe(0);

    // a patient with invoices/payments can never be hard-deleted — archive only
    const protectedRes = patients.deletePatient(adminActor, patient2Id, ADMIN_PW);
    expect(protectedRes.ok).toBe(true);
    expect(protectedRes.reason).toBe('archived_financial_history');
  });
});

describe('CSV export guard', () => {
  it('rejects patient CSV export without the export permission', async () => {
    await expect(
      exportSvc.exportCsv({ userId: 404, username: 'viewer', permissions: ['patient.view'] }, { kind: 'patients' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
