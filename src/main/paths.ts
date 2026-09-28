import os from 'node:os';
import path from 'node:path';

/** Central application paths (userData-based once Electron is available). */
let userDataDir = path.join(process.cwd(), 'userData');

export function setUserDataDir(dir: string): void {
  userDataDir = dir;
}

export function paths() {
  return {
    userData: userDataDir,
    db: path.join(userDataDir, 'dentiva.db'),
    dbWal: path.join(userDataDir, 'dentiva.db-wal'),
    attachments: path.join(userDataDir, 'attachments'),
    logs: path.join(userDataDir, 'logs'),
    backups: path.join(userDataDir, 'backups'),
    runtime: path.join(userDataDir, 'runtime'),
    activation: path.join(userDataDir, 'activation.dat'),
    clinicLogo: path.join(userDataDir, 'clinic'),
    dentists: path.join(userDataDir, 'dentists'),
    users: path.join(userDataDir, 'users'),
    exports: path.join(userDataDir, 'exports'),
  };
}

export function ensureDirs(): void {
  const p = paths();
  for (const dir of [
    p.userData,
    p.attachments,
    p.logs,
    p.backups,
    p.runtime,
    p.clinicLogo,
    p.dentists,
    p.users,
    p.exports,
  ]) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy CJS require
    require('node:fs').mkdirSync(dir, { recursive: true });
  }
}

/** Weak machine binding key for encrypted local state (anti-casual-copy, not DRM). */
export function machineKey(): string {
  let host = 'unknown';
  let user = 'unknown';
  try {
    host = os.hostname();
    user = os.userInfo().username;
  } catch {
    /* fallback */
  }
  return `${host}|${user}|dentiva-pro`;
}
