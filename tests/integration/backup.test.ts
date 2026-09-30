import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, teardownDatabase } from './helpers';
import { currentDb } from '../../src/main/db/database';
import { SYSTEM_ACTOR } from '../../src/main/services/common';
import { createBackup, listBackups, previewRestore, runRestore, verifyBackup } from '../../src/main/services/backup';
import { setSettings } from '../../src/main/services/settings';

/**
 * FD-008 / FD-010 regression:
 *  - backups are created, verified and restorable end-to-end;
 *  - retention prunes ONLY exact-pattern files, respects keepCount,
 *    never deletes the just-created file, never deletes a pre-restore
 *    safety backup that backup_records still references;
 *  - a failed restore (garbage file) must leave the live database intact
 *    and must create the pre-restore safety backup first.
 */

const BACKUP_RE = /^DentivaPro_Backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.dvbackup$/;

let destDir: string;
let patientId: number;

function mkOldFile(dest: string, name: string): string {
  const p = path.join(dest, name);
  fs.writeFileSync(p, 'not a real backup (synthetic retention fixture)');
  return p;
}

beforeAll(async () => {
  freshDatabase('backup');
  destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-backups-'));
  // one real patient so restore has something observable
  const db = currentDb();
  const info = db
    .prepare(
      `INSERT INTO patients (patient_code, full_name, phone, gender, created_at)
       VALUES ('P-REG-001', 'Retention Test Patient', '01711-000001', 'female', datetime('now','localtime'))`,
    )
    .run();
  patientId = Number(info.lastInsertRowid);
});

afterAll(() => {
  teardownDatabase();
  fs.rmSync(destDir, { recursive: true, force: true });
});

describe('backup create + verify', () => {
  it('creates a verifiable backup in the requested folder', async () => {
    const res = await createBackup(SYSTEM_ACTOR, destDir, 'regression backup');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.reason);
    expect(BACKUP_RE.test(path.basename(res.path!))).toBe(true);
    const v = await verifyBackup(SYSTEM_ACTOR, res.path!);
    expect(v.valid).toBe(true);
    expect(v.manifest).toBeTruthy();
    const list = listBackups(SYSTEM_ACTOR);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('previewRestore reports a valid manifest for a real backup', async () => {
    const files = fs.readdirSync(destDir).filter((f) => BACKUP_RE.test(f));
    const preview = await previewRestore(SYSTEM_ACTOR, path.join(destDir, files[0]));
    expect(preview.valid).toBe(true);
    expect(preview.manifest).toBeDefined();
  });
});

describe('retention (FD-010)', () => {
  it('prunes only exact-pattern files, keeps keepCount + never the fresh one', async () => {
    setSettings(SYSTEM_ACTOR, 'backup', { keepCount: 3, folder: destDir });
    // seed 5 old backups + 1 non-conforming file
    const old = [
      'DentivaPro_Backup_2026-08-01_09-00-00.dvbackup',
      'DentivaPro_Backup_2026-08-02_09-00-00.dvbackup',
      'DentivaPro_Backup_2026-08-03_09-00-00.dvbackup',
      'DentivaPro_Backup_2026-08-04_09-00-00.dvbackup',
      'DentivaPro_Backup_2026-08-05_09-00-00.dvbackup',
    ].map((n) => mkOldFile(destDir, n));
    const foreign = path.join(destDir, 'my-manual-backup.dvbackup');
    fs.writeFileSync(foreign, 'must never be touched');

    const res = await createBackup(SYSTEM_ACTOR, destDir);
    expect(res.ok).toBe(true);

    // the fresh backup always survives (even with a same-second collision suffix)
    expect(fs.existsSync(res.path!)).toBe(true);
    // the foreign file survives — retention never touches non-pattern names
    expect(fs.existsSync(foreign)).toBe(true);
    // keepCount=3 counts the fresh file + the previous test's backup + the
    // 2026-08-05 fixture → the four oldest pattern files are pruned.
    expect(fs.existsSync(old[0])).toBe(false); // 2026-08-01
    expect(fs.existsSync(old[1])).toBe(false); // 2026-08-02
    expect(fs.existsSync(old[2])).toBe(false); // 2026-08-03
    expect(fs.existsSync(old[3])).toBe(false); // 2026-08-04
    expect(fs.existsSync(old[4])).toBe(true); // 2026-08-05 (newest old) kept
  });

  it('never prunes a pre-restore safety backup referenced by backup_records', async () => {
    setSettings(SYSTEM_ACTOR, 'backup', { keepCount: 2, folder: destDir });
    const victim = 'DentivaPro_Backup_2026-08-05_09-00-00.dvbackup'; // newest "old" one
    const victimPath = path.join(destDir, victim);
    expect(fs.existsSync(victimPath)).toBe(true);
    currentDb()
      .prepare(
        `INSERT INTO backup_records (filename, path, created_at, size, sha256, status, schema_version, app_version, note)
         VALUES (?, ?, datetime('now','localtime'), 1, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'ok', 1, '1.1.0', 'pre-restore safety backup')`,
      )
      .run(victim, victimPath);

    const res = await createBackup(SYSTEM_ACTOR, destDir);
    expect(res.ok).toBe(true);
    // keepCount=2 would prune the 2026-08-05 file, but it is protected.
    expect(fs.existsSync(victimPath)).toBe(true);
    expect(fs.existsSync(res.path!)).toBe(true);
  });

  it('is a no-op when the folder has few backups', async () => {
    setSettings(SYSTEM_ACTOR, 'backup', { keepCount: 100, folder: destDir });
    const before = new Set(fs.readdirSync(destDir));
    const res = await createBackup(SYSTEM_ACTOR, destDir);
    expect(res.ok).toBe(true);
    const after = new Set(fs.readdirSync(destDir));
    // nothing may be deleted; the fresh file must be present
    for (const f of before) expect(after.has(f), `${f} must not be deleted`).toBe(true);
    expect(after.has(path.basename(res.path!))).toBe(true);
  });
});

describe('restore safety (failed restore must not destroy the database)', () => {
  it('restores a deleted patient from a real backup and keeps a safety backup', async () => {
    // explicit fresh backup (deterministic source)
    const created = await createBackup(SYSTEM_ACTOR, destDir, 'restore source');
    expect(created.ok).toBe(true);
    const backupFile = created.path!;

    // wipe the patient from the live DB
    currentDb().prepare('DELETE FROM patients WHERE id = ?').run(patientId);
    expect(currentDb().prepare('SELECT COUNT(*) c FROM patients WHERE id = ?').get(patientId)).toMatchObject({ c: 0 });

    const res = await runRestore(SYSTEM_ACTOR, backupFile, '');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.reason);

    // patient is back
    expect(currentDb().prepare('SELECT COUNT(*) c FROM patients WHERE id = ?').get(patientId)).toMatchObject({ c: 1 });
    // a pre-restore safety backup of the pre-restore state exists on disk
    // (its DB record is replaced by the restored database, so verify the file)
    expect(res.safetyBackupPath).toBeTruthy();
    expect(fs.existsSync(res.safetyBackupPath!)).toBe(true);
    const records = currentDb()
      .prepare(`SELECT COUNT(*) c FROM backup_records`)
      .get() as { c: number };
    expect(records.c).toBeGreaterThanOrEqual(1); // backup history restored intact
  });

  it('a garbage restore file fails cleanly and leaves the live DB intact', async () => {
    const before = (currentDb().prepare('SELECT COUNT(*) c FROM patients').get() as { c: number }).c;
    const garbage = path.join(destDir, 'DentivaPro_Backup_2026-09-01_10-00-00.dvbackup');
    fs.writeFileSync(garbage, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])); // not a valid archive

    const res = await runRestore(SYSTEM_ACTOR, garbage, '');
    expect(res.ok).toBe(false);
    expect(res.reason).toBeTruthy();
    const after = (currentDb().prepare('SELECT COUNT(*) c FROM patients').get() as { c: number }).c;
    expect(after).toBe(before);
  });
});
