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

export function initDatabase(dbPath: string): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 8000');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  runMigrations(db);
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    logger.error(`SQLite integrity check failed: ${integrity}`);
    throw new Error('Database integrity check failed');
  }
  instance = db;
  return db;
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
