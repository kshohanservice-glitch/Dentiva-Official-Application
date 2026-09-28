import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, teardownDatabase, rmDir } from './helpers';
import { SYSTEM_ACTOR } from '../../src/main/services/common';
import * as patients from '../../src/main/services/patients';
import { currentDb } from '../../src/main/db/database';

/**
 * Scale test — 100,000 patients (spec: unlimited records, no artificial caps).
 * Seed uses direct batched SQL inside one transaction (the storage layer);
 * queries run through the real service (the path the app uses).
 */

let dir: string;
const TOTAL = 100_000;
let seedMs = 0;

beforeAll(() => {
  ({ dir } = freshDatabase('stress'));

  const db = currentDb();
  const insert = db.prepare(
    `INSERT INTO patients (patient_code, full_name, phone, gender, dob, age, address, status, registered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now', 'localtime'))`,
  );
  const started = Date.now();
  db.exec('BEGIN');
  for (let i = 1; i <= TOTAL; i++) {
    // Codes start at 2,000,001 so they can never collide with the app's
    // P00001-style counter (max 5 digits → P99999, or unpadded P100000+).
    const bengali = i % 10 === 0;
    insert.run(
      `P${2_000_000 + i}`,
      bengali ? `রোগী আব্দুল করিম ${i}` : `Stress Patient ${i}`,
      `+88017${String(10000000 + i).slice(-8)}`,
      i % 2 === 0 ? 'male' : 'female',
      `19${String(80 + (i % 20))}-0${1 + (i % 9)}-1${i % 9}0`,
      18 + (i % 60),
      i % 3 === 0 ? 'Dhaka' : 'Tangail',
    );
  }
  db.exec('COMMIT');
  seedMs = Date.now() - started;
});

afterAll(() => {
  teardownDatabase();
  rmDir(dir);
});

describe('stress: 100k patients', () => {
  it('seeds 100,000 rows quickly and reports the timing', () => {
    const row = currentDb().prepare('SELECT COUNT(*) AS c FROM patients WHERE deleted_at IS NULL').get() as {
      c: number;
    };
    expect(row.c).toBe(TOTAL);
    console.log(`[stress] seeded ${TOTAL} patients in ${seedMs} ms`);
    expect(seedMs).toBeLessThan(60_000);
  });

  it('first page loads through the real service in bounded time', () => {
    const started = Date.now();
    const page = patients.listPatients(SYSTEM_ACTOR, { page: 1, pageSize: 50 });
    const ms = Date.now() - started;
    console.log(`[stress] first page: ${ms} ms`);
    expect(page.total).toBe(TOTAL); // no artificial cap — true count
    expect(page.items).toHaveLength(50);
    expect(ms).toBeLessThan(3_000);
  });

  it('deep pagination reaches the final record', () => {
    const started = Date.now();
    const last = patients.listPatients(SYSTEM_ACTOR, { page: 2000, pageSize: 50 });
    const ms = Date.now() - started;
    console.log(`[stress] page 2000: ${ms} ms`);
    expect(last.items).toHaveLength(50);
    expect(last.total).toBe(TOTAL);
    // every reachable record is a seeded one (codes P2000001..P2100000)
    expect(last.items[49].patientCode).toMatch(/^P2\d{6}$/);
    expect(ms).toBeLessThan(3_000);
  });

  it('search by code is instant', () => {
    const started = Date.now();
    const res = patients.listPatients(SYSTEM_ACTOR, { q: 'P2000123' });
    const ms = Date.now() - started;
    console.log(`[stress] code search: ${ms} ms`);
    expect(res.total).toBe(1);
    expect(res.items[0].fullName).toBe('Stress Patient 123');
    expect(ms).toBeLessThan(3_000);
  });

  it('search by Bengali name works at scale', () => {
    const started = Date.now();
    const res = patients.listPatients(SYSTEM_ACTOR, { q: 'রোগী আব্দুল করিম 55550' });
    const ms = Date.now() - started;
    console.log(`[stress] Bengali search: ${ms} ms`);
    expect(res.total).toBe(1);
    expect(ms).toBeLessThan(3_000);
  });

  it('phone search and status filters stay bounded', () => {
    const byPhone = patients.listPatients(SYSTEM_ACTOR, { q: '+8801710000' });
    expect(byPhone.total).toBeGreaterThan(0);
    const active = patients.listPatients(SYSTEM_ACTOR, { status: 'active', pageSize: 10_000 });
    expect(active.total).toBe(TOTAL);
    // page size is clamped for transport, never for data availability
    expect(active.items.length).toBeLessThan(10_000);
  });

  it('page size is clamped server-side, totals are not', () => {
    const res = patients.listPatients(SYSTEM_ACTOR, { pageSize: 100_000 });
    expect(res.total).toBe(TOTAL);
    expect(res.items.length).toBeLessThanOrEqual(500);
    expect(res.pageSize).toBeLessThanOrEqual(500);
  });
});
