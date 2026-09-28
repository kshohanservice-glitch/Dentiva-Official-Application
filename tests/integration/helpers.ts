import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, initDatabase, type DB } from '../../src/main/db/database';
import { seedSystemData } from '../../src/main/db/seeds';
import { ensureDirs, setUserDataDir } from '../../src/main/paths';
import { configureLogging } from '../../src/main/logger';

/** Create an isolated on-disk database (migrations + seeds) in a temp dir. */
export function freshDatabase(label: string): { dir: string; db: DB } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dentiva-${label}-`));
  setUserDataDir(dir);
  configureLogging(path.join(dir, 'logs'));
  ensureDirs();
  const db = initDatabase(path.join(dir, 'dentiva.db'));
  seedSystemData(db);
  return { dir, db };
}

export function teardownDatabase(): void {
  try {
    closeDatabase();
  } catch {
    /* already closed */
  }
}

export function rmDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
