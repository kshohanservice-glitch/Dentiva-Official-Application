import fs from 'node:fs';
import { currentDb } from '../db/database';
import { paths, machineKey } from '../paths';
import {
  decryptState,
  encryptState,
  verifyActivationCode,
} from '../security/activation';
import { recordAudit, type ServiceActor } from './common';
import { logger } from '../logger';
import type { ActivationResult } from '../../shared/contract';

/**
 * Offline activation persistence. The activation blob stored in userData is
 * AES-256-GCM encrypted and authenticated; flipping the DB flag alone is not
 * sufficient (the encrypted blob must decrypt to a valid marker).
 */

const MARKER = 'dentiva-activated-v1';

export function isActivated(): boolean {
  try {
    const db = currentDb();
    const row = db.prepare('SELECT activated, payload FROM activation_state WHERE id = 1').get() as
      | { activated: number; payload: string | null }
      | undefined;
    if (!row || row.activated !== 1) return false;
    if (!row.payload) return false;
    const plain = decryptState(row.payload, machineKey());
    if (!plain) return false;
    const parsed = JSON.parse(plain) as { marker?: string; at?: string };
    // also require the encrypted file to still be present & consistent
    const file = paths().activation;
    if (!fs.existsSync(file)) return false;
    const fileBlob = fs.readFileSync(file, 'utf8').trim();
    if (fileBlob !== row.payload) return false;
    return parsed.marker === MARKER;
  } catch (err) {
    logger.error('Activation state check failed', { err: String(err) });
    return false;
  }
}

export function activate(code: string, actor?: ServiceActor): ActivationResult {
  const result = verifyActivationCode(code);
  if (!result.ok) {
    recordAudit({
      actor: { userId: actor?.userId ?? null, username: actor?.username ?? 'setup' },
      action: 'activation.attempt',
      result: 'failure',
      metadata: { reason: result.reason },
    });
    return { ok: false, reason: result.reason };
  }
  const payload = encryptState(
    JSON.stringify({ marker: MARKER, at: new Date().toISOString() }),
    machineKey(),
  );
  const db = currentDb();
  db.prepare(
    "UPDATE activation_state SET activated = 1, activated_at = datetime('now','localtime'), payload = ? WHERE id = 1",
  ).run(payload);
  fs.writeFileSync(paths().activation, payload, { encoding: 'utf8', mode: 0o600 });
  recordAudit({
    actor: { userId: actor?.userId ?? null, username: actor?.username ?? 'setup' },
    action: 'activation.success',
    result: 'success',
  });
  logger.info('Product activated');
  return { ok: true };
}

/** Test hook — clears activation (used only by destructive reset flows). */
export function deactivate(): void {
  const db = currentDb();
  db.prepare('UPDATE activation_state SET activated = 0, activated_at = NULL, payload = NULL WHERE id = 1').run();
  try {
    fs.unlinkSync(paths().activation);
  } catch {
    /* ignore */
  }
}
