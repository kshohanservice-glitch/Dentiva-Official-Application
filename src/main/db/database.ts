import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { migrations } from './migrations';
import { logger } from '../logger';

export type DB = Database.Database;

let instance: DB | null = null;

export const SCHEMA_VERSION = migrations[migrations.length - 1]?.version ?? 1;

export function currentDb(): DB {
  if (!instance) throw new Error('Database not initialized');
  return instance;
}

/**
 * Set when `initDatabase` had to quarantine a corrupt database and start a
 * fresh one. The main process reads this to surface a one-time recovery
 * dialog to the user (FD-005: a corrupt DB used to cause a silent exit).
 */
export let lastRecovery: { from: string; quarantined: string[]; reason: string; at: string } | null = null;

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds())}`;
}

function quarantineFiles(dbPath: string, reason: string): void {
  // Unique suffix — a second corruption within the same second must NOT
  // clobber the earlier quarantine (forensics + the restore dialog rely on
  // every quarantine surviving).
  let suffix = `.corrupt-${timestamp()}`;
  if (fs.existsSync(dbPath + suffix)) {
    suffix += `-${process.hrtime.bigint() % 1_000_000n}`;
  }
  const quarantined: string[] = [];
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!fs.existsSync(f)) continue;
    const target = f + suffix;
    // Windows: a rename can transiently fail (EBUSY/EPERM) when the OS or
    // antivirus has not released the handle yet — retry briefly before giving up.
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(f, target);
        quarantined.push(target);
        logger.error(`Quarantined ${f} → ${target} (${reason})`);
        break;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        const retryable =
          attempt < 10 && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES');
        if (!retryable) {
          logger.error(`Failed to quarantine ${f}: ${String(err)}`);
          break;
        }
        // busy-wait: file-lock release is measured in ms; the whole startup
        // path stays bounded (<= ~1 s total across all three files).
        const until = Date.now() + 100;
        while (Date.now() < until) { /* yield nothing — sync context */ }
      }
    }
  }
  lastRecovery = {
    from: dbPath,
    quarantined,
    reason,
    at: new Date().toISOString(),
  };
}

/**
 * Open (or create) the database, run migrations, verify integrity.
 *
 * Corruption recovery: if the existing database fails its integrity check
 * (power loss mid-write, interrupted restore, disk error), the app attempts
 * a WAL checkpoint re-check; if that still fails it QUARANTINES the bad files
 * (renamed, never deleted) and starts a fresh database. The user is told via
 * a dialog to restore from a backup — the quarantined data stays on disk.
 */
export function initDatabase(dbPath: string): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  let db: DB;
  try {
    db = openAndCheck(dbPath);
  } catch (openErr) {
    // The file could not even be opened (e.g. SQLITE_NOTADB) — quarantine and retry fresh.
    const msg = openErr instanceof Error ? openErr.message : String(openErr);
    logger.error('Database open failed — quarantining', { err: msg });
    quarantineFiles(dbPath, `open failed: ${msg}`);
    db = openAndCheck(dbPath);
  }

  runMigrations(db);
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    logger.error(`SQLite integrity check failed: ${integrity}`);
    db.close();
    quarantineFiles(dbPath, `integrity check: ${integrity}`);
    db = openAndCheck(dbPath);
    runMigrations(db);
  }

  instance = db;
  return db;
}

function openAndCheck(dbPath: string): DB {
  let db: DB | null = null;
  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 8000');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    // If a torn WAL is the problem, a truncate checkpoint may salvage the DB.
    let integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        integrity = db.pragma('integrity_check', { simple: true });
      } catch {
        /* keep original result */
      }
    }
    if (integrity !== 'ok') {
      const reason = String(integrity);
      quarantineFiles(dbPath, `integrity check: ${reason}`);
      throw new Error(`Database integrity check failed: ${reason}`);
    }
    return db;
  } catch (err) {
    // A failed open MUST release its handle before the caller quarantines
    // (renames) the file: on Windows a file with any open handle cannot be
    // renamed (EBUSY), so the quarantine would silently fail and the fresh-DB
    // retry would re-open the same corrupt file — the app would crash-loop at
    // startup on a real Windows machine. (FD-019.)
    if (db) {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    }
    throw err;
  }
}

export function closeDatabase(): void {
  if (instance) {
    try {
      instance.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* ignore */
    }
    instance.close();
    instance = null;
  }
}

function runMigrations(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    logger.info(`Applying migration ${m.version}_${m.name}`);
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    });
    tx();
  }
  const maxApplied = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null })
    .v;
  if ((maxApplied ?? 0) > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${maxApplied} is newer than supported ${SCHEMA_VERSION}. Update the application.`,
    );
  }
}

/** Run a function inside an exclusive transaction (better-sqlite3 sync API). */
export function tx<T>(fn: () => T): T {
  return currentDb().transaction(fn)();
}

/** Named counters — collision-safe sequential numbering (invoice no, patient code…). */
export function nextSequence(scope: string, prefix: string, pad = 5): string {
  const db = currentDb();
  const row = db.prepare('SELECT next_value FROM invoice_counters WHERE scope = ?').get(scope) as
    | { next_value: number }
    | undefined;
  let value: number;
  if (row) {
    value = row.next_value;
    db.prepare('UPDATE invoice_counters SET next_value = next_value + 1 WHERE scope = ?').run(scope);
  } else {
    value = 1;
    db.prepare('INSERT INTO invoice_counters (scope, next_value) VALUES (?, 2)').run(scope);
  }
  return `${prefix}${String(value).padStart(pad, '0')}`;
}
