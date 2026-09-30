import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import DatabaseCtor from 'better-sqlite3';
import { freshDatabase, teardownDatabase } from './helpers';
import { closeDatabase, currentDb, initDatabase, lastRecovery, SCHEMA_VERSION } from '../../src/main/db/database';

/**
 * Failure A hardening regression: if the installed database file is corrupt
 * (power loss, disk failure, partial write), the app must NOT crash at
 * startup with an unhandled SQLITE error. It quarantines the bad file in
 * place (keeping it for forensics/restore), starts a fresh database, and
 * exposes `lastRecovery` so the UI can tell the user — with the quarantine
 * path — and offer a restore.
 */

let dir: string;

function corruptGarbage(dbPath: string): void {
  fs.writeFileSync(dbPath, 'THIS IS NOT A SQLITE DATABASE — simulated hard disk failure');
}

function corruptIntegrity(dbPath: string): void {
  // Zero out page 2: valid enough to OPEN, but integrity_check must fail.
  const buf = fs.readFileSync(dbPath);
  const zero = Buffer.alloc(4096, 0);
  zero.copy(buf, 4096);
  fs.writeFileSync(dbPath, buf);
}

afterAll(() => teardownDatabase());

describe('corrupt database at startup', () => {
  it('unreadable file: quarantines, recovers fresh, sets lastRecovery', () => {
    ({ dir } = freshDatabase('recovery'));
    const dbPath = path.join(dir, 'dentiva.db');

    // put real data in so "data loss without notice" would be observable
    currentDb()
      .prepare(
        `INSERT INTO patients (patient_code, full_name, phone, gender, created_at)
         VALUES ('P-REC-001', 'Recovery Test', '01711-222222', 'male', datetime('now','localtime'))`,
      )
      .run();
    closeDatabase();

    corruptGarbage(dbPath);

    // the recovered database must open and be fully usable
    const db = initDatabase(dbPath);
    expect(lastRecovery).not.toBeNull();
    expect(lastRecovery!.from).toBe(dbPath);
    expect(lastRecovery!.reason).toContain('open failed');
    expect(lastRecovery!.quarantined.some((f) => f.startsWith(dbPath + '.corrupt-'))).toBe(true);

    // original file preserved under a quarantine name (forensics + restore)
    const quarantined = fs.readdirSync(dir).filter((f) => f.startsWith('dentiva.db.corrupt-'));
    expect(quarantined.length).toBe(1);
    expect(fs.readFileSync(path.join(dir, quarantined[0]), 'utf8')).toContain('NOT A SQLITE DATABASE');

    // fresh database has the full schema + is writable
    expect((db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v).toBe(SCHEMA_VERSION);
    db.prepare(
      `INSERT INTO patients (patient_code, full_name, phone, gender, created_at)
       VALUES ('P-REC-002', 'Post-Recovery', '01711-333333', 'female', datetime('now','localtime'))`,
    ).run();
    expect(db.prepare('SELECT COUNT(*) c FROM patients').get()).toMatchObject({ c: 1 });
    expect(fs.readFileSync(dbPath, 'utf8')).not.toContain('NOT A SQLITE DATABASE');
  });

  it('integrity-corrupt file: quarantines on failed integrity check, recovers fresh', () => {
    const dbPath = path.join(dir, 'dentiva.db');
    closeDatabase();

    corruptIntegrity(dbPath);
    // sanity: the corruption must actually break integrity (else the test is vacuous)
    const probe = new DatabaseCtor(dbPath, { readonly: true, fileMustExist: true });
    expect(probe.pragma('integrity_check', { simple: true })).not.toBe('ok');
    probe.close();

    const db = initDatabase(dbPath);
    expect(lastRecovery).not.toBeNull();
    expect(lastRecovery!.reason).toContain('integrity check');
    const quarantined = fs.readdirSync(dir).filter((f) => f.startsWith('dentiva.db.corrupt-'));
    // one more quarantine (the previous one is still there)
    expect(quarantined.length).toBe(2);
    expect((db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v).toBe(SCHEMA_VERSION);
  });

  it('a healthy database does NOT trigger recovery', () => {
    closeDatabase();
    const dbPath = path.join(dir, 'dentiva.db');
    const before = fs.readdirSync(dir).filter((f) => f.startsWith('dentiva.db.corrupt-')).length;
    const db = initDatabase(dbPath);
    // no NEW quarantine files appeared
    const after = fs.readdirSync(dir).filter((f) => f.startsWith('dentiva.db.corrupt-')).length;
    expect(after).toBe(before);
    db.prepare('SELECT 1').get();
  });
});
