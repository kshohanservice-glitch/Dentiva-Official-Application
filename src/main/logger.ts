import fs from 'node:fs';
import path from 'node:path';

/**
 * Structured local application logging.
 * Never logs passwords, activation secrets, or unnecessary patient data.
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
let logDir = path.join(process.cwd(), 'logs');

type Level = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export function configureLogging(dir: string): void {
  logDir = dir;
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    /* best effort */
  }
}

function scrub(message: string): string {
  return message
    .replace(/(password|passwd|pwd|secret|activation|token|hash)["'\s:=]+\S+/gi, '$1=[redacted]')
    .replace(/\b\d{16}\b/g, '[redacted]');
}

function write(level: Level, message: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  let line = `${ts} [${level}] ${scrub(message)}`;
  if (meta !== undefined) {
    try {
      line += ' ' + scrub(JSON.stringify(meta));
    } catch {
      /* circular */
    }
  }
  line += '\n';
  try {
    const file = path.join(logDir, `dentiva-${new Date().toISOString().slice(0, 10)}.log`);
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_FILE_BYTES) {
        fs.renameSync(file, file + '.1');
      }
    } catch {
      /* first write */
    }
    fs.appendFileSync(file, line);
  } catch {
    /* logging must never crash the app */
  }
  if (level === 'ERROR') process.stderr.write(line);
}

export const logger = {
  info: (message: string, meta?: unknown) => write('INFO', message, meta),
  warn: (message: string, meta?: unknown) => write('WARN', message, meta),
  error: (message: string, meta?: unknown) => write('ERROR', message, meta),
  debug: (message: string, meta?: unknown) => {
    if (process.env.DENTIVA_DEBUG) write('DEBUG', message, meta);
  },
};
