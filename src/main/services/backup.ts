import fs from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { createHash } from 'node:crypto';
import { currentDb, initDatabase, closeDatabase, SCHEMA_VERSION, tx } from '../db/database';
import { paths } from '../paths';
import { logger } from '../logger';
import { recordAudit, requirePermission, type ServiceActor } from './common';
import { assertPassword } from './admin';
import { getAllSettings, setSettings } from './settings';
import { seedSystemData } from '../db/seeds';
import { systemActor } from './auth';
import type { BackupManifest, BackupRecordDto, RestorePreview, RestoreResult } from '../../shared/contract';
import { APP_VERSION } from '../version';

const BACKUP_FORMAT = 'dentiva-backup';
const BACKUP_FORMAT_VERSION = 1;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function backupFileName(d = new Date()): string {
  return `DentivaPro_Backup_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(
    d.getMinutes(),
  )}-${pad(d.getSeconds())}.dvbackup`;
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

function collectFiles(dir: string, base = dir): { abs: string; rel: string; size: number }[] {
  const out: { abs: string; rel: string; size: number }[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(abs, base));
    else out.push({ abs, rel: path.relative(base, abs), size: fs.statSync(abs).size });
  }
  return out;
}

export async function createBackup(
  actor: ServiceActor,
  destDir?: string,
  note?: string,
): Promise<{ ok: boolean; path?: string; reason?: string }> {
  requirePermission(actor, 'backup.create');
  const settings = getAllSettings().backup as Record<string, unknown>;
  const dir = destDir || (settings.folder as string) || paths().backups;
  const filename = backupFileName();
  const target = path.join(dir, filename);
  const snapshotPath = path.join(paths().runtime, 'backup-snapshot.db');
  const started = Date.now();

  try {
    fs.mkdirSync(dir, { recursive: true });
    // 1. consistent WAL-checkpointed snapshot via SQLite Online Backup API
    try {
      if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    } catch {
      /* ignore */
    }
    const db = currentDb();
    await db.backup(snapshotPath);
    if (!fs.existsSync(snapshotPath)) throw new Error('Snapshot was not created');

    // 2. collect attachments
    const attachments = collectFiles(paths().attachments);

    // 3. build manifest with per-member hashes
    const dbHash = await sha256File(snapshotPath);
    const files: BackupManifest['files'] = [
      { name: 'dentiva.db', sha256: dbHash, size: fs.statSync(snapshotPath).size },
      ...attachments.map((f) => ({ name: `attachments/${f.rel.replace(/\\/g, '/')}`, sha256: '', size: f.size })),
    ];
    // hash attachments
    for (const f of attachments) {
      const entry = files.find((x) => x.name === `attachments/${f.rel.replace(/\\/g, '/')}`);
      if (entry) entry.sha256 = await sha256File(f.abs);
    }
    const clinic = (getAllSettings().clinic ?? {}) as Record<string, unknown>;
    const counts = dbCounts();
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      clinicName: (clinic.name as string) ?? null,
      counts,
      files,
    };

    // 4. zip everything
    await new Promise<void>((resolve, reject) => {
      const zipfile = new yazl.ZipFile();
      zipfile.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'manifest.json');
      zipfile.addFile(snapshotPath, 'dentiva.db');
      for (const f of attachments) {
        zipfile.addFile(f.abs, `attachments/${f.rel.replace(/\\/g, '/')}`);
      }
      zipfile.end();
      const out = fs.createWriteStream(target);
      zipfile.outputStream.pipe(out);
      out.on('finish', () => resolve());
      out.on('error', reject);
      zipfile.outputStream.on('error', reject);
    });

    const size = fs.statSync(target).size;
    const zipHash = await sha256File(target);
    // verify the produced archive opens + manifest readable
    const check = await readManifest(target);
    if (!check.valid) throw new Error('Backup verification failed: ' + check.reason);

    const db2 = currentDb();
    db2
      .prepare(
        `INSERT INTO backup_records (filename, path, created_at, size, sha256, status, schema_version, app_version, note)
         VALUES (?, ?, datetime('now','localtime'), ?, ?, 'ok', ?, ?, ?)`,
      )
      .run(filename, target, size, zipHash, SCHEMA_VERSION, APP_VERSION, note || null);
    setSettings(systemActor(), 'backup', {
      lastSuccessAt: new Date().toISOString(),
      lastResult: `ok (${Math.round(size / 1024)} KB)`,
    });
    fs.rmSync(snapshotPath, { force: true });
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'backup.create',
      entity: 'backup',
      entityId: filename,
      metadata: { size, sha256: zipHash, ms: Date.now() - started },
    });
    logger.info('Backup completed', { filename, size });
    return { ok: true, path: target };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Backup failed', { err: message });
    try {
      const db2 = currentDb();
      db2
        .prepare(
          `INSERT INTO backup_records (filename, path, created_at, size, sha256, status, schema_version, app_version, note)
           VALUES (?, ?, datetime('now','localtime'), 0, NULL, 'failed', ?, ?, ?)`,
        )
        .run(filename, target, SCHEMA_VERSION, APP_VERSION, message);
      setSettings(systemActor(), 'backup', { lastResult: `failed: ${message}` });
    } catch {
      /* ignore secondary failure */
    }
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'backup.create',
      entity: 'backup',
      entityId: filename,
      result: 'failure',
      metadata: { error: message },
    });
    return { ok: false, reason: message };
  }
}

function dbCounts(): Record<string, number> {
  const db = currentDb();
  const tables = [
    'patients',
    'visits',
    'prescriptions',
    'appointments',
    'invoices',
    'payments',
    'inventory_items',
    'financial_transactions',
    'users',
    'dentists',
    'staff',
  ];
  const out: Record<string, number> = {};
  for (const t of tables) {
    try {
      out[t] = (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
    } catch {
      out[t] = 0;
    }
  }
  return out;
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

async function readManifest(file: string): Promise<{ valid: boolean; manifest?: BackupManifest; reason?: string }> {
  try {
    const zip = await openZip(file);
    return await new Promise((resolve) => {
      let manifest: BackupManifest | null = null;
      zip.readEntry();
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName === 'manifest.json') {
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) {
              zip.close();
              resolve({ valid: false, reason: 'Cannot read manifest' });
              return;
            }
            const chunks: Buffer[] = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => {
              try {
                manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              } catch {
                /* fallthrough */
              }
              zip.readEntry();
            });
            stream.on('error', () => {
              zip.close();
              resolve({ valid: false, reason: 'Manifest stream error' });
            });
          });
        } else {
          zip.readEntry();
        }
      });
      zip.on('end', () => {
        if (!manifest) {
          resolve({ valid: false, reason: 'manifest.json missing' });
          return;
        }
        const m = manifest as BackupManifest;
        if (m.format !== BACKUP_FORMAT) {
          resolve({ valid: false, reason: 'Not a Dentiva Pro backup' });
          return;
        }
        if (m.schemaVersion > SCHEMA_VERSION) {
          resolve({
            valid: false,
            reason: `Backup schema v${m.schemaVersion} requires a newer application (current v${SCHEMA_VERSION})`,
          });
          return;
        }
        resolve({ valid: true, manifest: m });
      });
      zip.on('error', (e) => resolve({ valid: false, reason: String(e) }));
    });
  } catch (err) {
    return { valid: false, reason: `Cannot open backup: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function extractAndVerify(file: string, destDir: string): Promise<{ ok: boolean; reason?: string }> {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  const zip = await openZip(file);
  const manifestResult = await readManifest(file);
  if (!manifestResult.valid || !manifestResult.manifest) {
    return { ok: false, reason: manifestResult.reason };
  }
  const manifest = manifestResult.manifest;
  return new Promise((resolve) => {
    zip.readEntry();
    zip.on('entry', (entry: yauzl.Entry) => {
      // path traversal protection
      const safe = path.normalize(entry.fileName).replace(/^(\.\.(\/|\\|$))+/, '');
      if (safe.includes('..') || path.isAbsolute(safe)) {
        zip.close();
        resolve({ ok: false, reason: 'Unsafe path in archive' });
        return;
      }
      const target = path.join(destDir, safe);
      if (entry.fileName.endsWith('/')) {
        fs.mkdirSync(target, { recursive: true });
        zip.readEntry();
        return;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          zip.close();
          resolve({ ok: false, reason: 'Extract stream error' });
          return;
        }
        const out = fs.createWriteStream(target);
        stream.pipe(out);
        out.on('finish', () => zip.readEntry());
        out.on('error', () => {
          zip.close();
          resolve({ ok: false, reason: 'Write error during extraction' });
        });
      });
    });
    zip.on('end', async () => {
      // verify hashes of all manifest files
      for (const f of manifest.files) {
        const abs = path.join(destDir, f.name);
        if (!fs.existsSync(abs)) {
          resolve({ ok: false, reason: `Missing file in backup: ${f.name}` });
          return;
        }
        if (f.sha256) {
          const h = await sha256File(abs);
          if (h !== f.sha256) {
            resolve({ ok: false, reason: `Integrity check failed for ${f.name}` });
            return;
          }
        }
      }
      resolve({ ok: true });
    });
    zip.on('error', (e) => resolve({ ok: false, reason: String(e) }));
  });
}

export function listBackups(actor: ServiceActor): BackupRecordDto[] {
  requirePermission(actor, 'settings.view');
  const rows = currentDb()
    .prepare('SELECT * FROM backup_records ORDER BY created_at DESC LIMIT 200')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    filename: String(r.filename),
    path: String(r.path),
    createdAt: String(r.created_at),
    size: Number(r.size),
    sha256: (r.sha256 as string | null) ?? null,
    status: r.status as 'ok' | 'failed',
    schemaVersion: Number(r.schema_version),
    appVersion: String(r.app_version),
    note: (r.note as string | null) ?? null,
  }));
}

export async function verifyBackup(actor: ServiceActor, file: string) {
  requirePermission(actor, 'backup.create');
  const manifest = await readManifest(file);
  return manifest;
}

export async function previewRestore(actor: ServiceActor, file: string): Promise<RestorePreview> {
  requirePermission(actor, 'backup.restore');
  if (!file.toLowerCase().endsWith('.dvbackup') && !file.toLowerCase().endsWith('.zip')) {
    return { manifest: null as unknown as BackupManifest, valid: false, reason: 'Unsupported file type' };
  }
  if (!fs.existsSync(file)) {
    return { manifest: null as unknown as BackupManifest, valid: false, reason: 'File not found' };
  }
  const res = await readManifest(file);
  return { manifest: res.manifest ?? (null as unknown as BackupManifest), valid: res.valid, reason: res.reason };
}

/**
 * Restore — safeguarded: password re-auth → safety backup of current data →
 * validate → staged extract → integrity check → atomic swap → reload.
 * On any failure the previous database is rolled back automatically.
 */
export async function runRestore(
  actor: ServiceActor,
  file: string,
  password: string,
): Promise<RestoreResult> {
  requirePermission(actor, 'backup.restore');
  assertPassword(actor, password);
  const p = paths();
  const staging = path.join(p.runtime, 'restore-staging');
  const safety = await createBackup(actor, p.backups, 'pre-restore safety backup');
  if (!safety.ok) {
    return { ok: false, reason: 'Safety backup failed: ' + safety.reason };
  }
  const check = await extractAndVerify(file, staging);
  if (!check.ok) {
    fs.rmSync(staging, { recursive: true, force: true });
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'restore.run',
      entity: 'restore',
      result: 'failure',
      metadata: { reason: check.reason },
    });
    return { ok: false, reason: check.reason };
  }
  const stagedDb = path.join(staging, 'dentiva.db');
  if (!fs.existsSync(stagedDb)) {
    fs.rmSync(staging, { recursive: true, force: true });
    return { ok: false, reason: 'Backup does not contain a database' };
  }
  // validate staged db integrity + schema before touching live data
  try {
    const DatabaseCtor = (await import('better-sqlite3')).default;
    const staged = new DatabaseCtor(stagedDb, { readonly: true, fileMustExist: true });
    const integrity = staged.pragma('integrity_check', { simple: true });
    const ver = staged.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
    staged.close();
    if (integrity !== 'ok') {
      fs.rmSync(staging, { recursive: true, force: true });
      return { ok: false, reason: 'Staged database failed integrity check' };
    }
    if ((ver.v ?? 0) > SCHEMA_VERSION) {
      fs.rmSync(staging, { recursive: true, force: true });
      return { ok: false, reason: `Backup schema v${ver.v} is newer than supported v${SCHEMA_VERSION}` };
    }
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    return { ok: false, reason: `Staged database unreadable: ${err instanceof Error ? err.message : String(err)}` };
  }

  const backupDir = path.join(p.runtime, `pre-restore-${Date.now()}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const swapTargets = [p.db, p.db + '-wal', p.db + '-shm'];
  const moved: { from: string; to: string }[] = [];
  try {
    closeDatabase();
    for (const f of swapTargets) {
      if (fs.existsSync(f)) {
        const to = path.join(backupDir, path.basename(f));
        fs.renameSync(f, to);
        moved.push({ from: f, to });
      }
    }
    fs.copyFileSync(stagedDb, p.db);
    // swap attachments: current → backup, staged → live
    const stagedAtt = path.join(staging, 'attachments');
    const liveAtt = p.attachments;
    const liveAttBackup = path.join(backupDir, 'attachments');
    if (fs.existsSync(liveAtt)) {
      fs.renameSync(liveAtt, liveAttBackup);
      fs.mkdirSync(liveAtt, { recursive: true });
    }
    if (fs.existsSync(stagedAtt)) {
      fs.cpSync(stagedAtt, liveAtt, { recursive: true });
    }
    // re-open + migrate/seed + verify
    initDatabase(p.db);
    seedSystemData(currentDb());
    const post = currentDb().pragma('integrity_check', { simple: true });
    if (post !== 'ok') throw new Error('Post-restore integrity check failed');
    fs.rmSync(staging, { recursive: true, force: true });
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'restore.run',
      entity: 'restore',
      entityId: path.basename(file),
      metadata: { safetyBackup: safety.path, rolledBackFrom: backupDir },
    });
    logger.info('Restore completed', { file, safety: safety.path });
    return { ok: true, safetyBackupPath: safety.path };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Restore failed — rolling back', { err: message });
    try {
      closeDatabase();
      for (const m of moved) {
        if (fs.existsSync(m.to)) fs.renameSync(m.to, m.from);
      }
      initDatabase(p.db);
    } catch (rollbackErr) {
      logger.error('Rollback also failed', { err: String(rollbackErr) });
    }
    recordAudit({
      actor: { userId: actor.userId, username: actor.username },
      action: 'restore.run',
      entity: 'restore',
      result: 'failure',
      metadata: { reason: message },
    });
    return { ok: false, reason: message + ' — previous data restored' };
  }
}

export { tx };
