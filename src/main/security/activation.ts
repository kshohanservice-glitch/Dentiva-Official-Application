import { argon2id } from '@noble/hashes/argon2.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Offline activation — fixed code verified against an embedded Argon2id
 * derived verifier. No plaintext activation material exists anywhere in the
 * repository or the shipped bundle.
 *
 * The verifier below was produced by scripts/derive-activation.cjs from the
 * authorized source provided by the product owner. Because the application is
 * fully offline, no purely local mechanism can be mathematically
 * irreversible against an attacker with binary access — therefore we:
 *   - never store/ship the plaintext,
 *   - use a memory-hard KDF (Argon2id, 64 MiB, t=4, p=2) for the verifier,
 *   - validate locally and persist activation state encrypted at rest,
 *   - do not claim absolute secrecy.
 */

const VERIFIER = {
  saltHex: '7b695347459d2f52998bcf184e1f67f4',
  digestHex: '006ee2da0658136135db519871562783adde37c05619320981d610e86cf7a924',
  params: { t: 4 as const, m: 65536 as const, p: 2 as const },
};

export function normalizeActivationCode(input: string): string {
  return input.replace(/[\s-]/g, '');
}

export function validateActivationCodeFormat(code: string): boolean {
  return /^\d{16}$/.test(code);
}

/** Returns true when the provided code matches the embedded verifier. */
export function verifyActivationCode(input: string): { ok: boolean; reason?: 'invalid' | 'format' } {
  const normalized = normalizeActivationCode(input ?? '');
  if (!validateActivationCodeFormat(normalized)) return { ok: false, reason: 'format' };
  try {
    const digest = argon2id(normalized.normalize('NFKC'), hexToBytes(VERIFIER.saltHex), VERIFIER.params);
    const expected = hexToBytes(VERIFIER.digestHex);
    if (digest.length !== expected.length) return { ok: false, reason: 'invalid' };
    let diff = 0;
    for (let i = 0; i < digest.length; i++) diff |= digest[i] ^ expected[i];
    if (diff !== 0) return { ok: false, reason: 'invalid' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/**
 * Persisted activation state is encrypted at rest with AES-256-GCM using a key
 * derived (scrypt) from the machine id + app install id — protecting the file
 * against casual tampering/copying, not against full disk compromise.
 */
export function encryptState(plaintext: string, machineKey: string): string {
  const key = scryptSync(machineKey, 'dentiva-activation-v1', 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptState(payload: string, machineKey: string): string | null {
  try {
    const key = scryptSync(machineKey, 'dentiva-activation-v1', 32);
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
