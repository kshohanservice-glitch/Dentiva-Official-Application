import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/**
 * Password hashing — Argon2id (OWASP recommended), 64 MiB memory, t=4, p=2.
 * Each credential gets a fresh 16-byte salt. Hashes are stored as
 * `argon2id$v=19$m=65536,t=4,p=2$<salt>$<digest>` (self-describing PHC string).
 */

const PARAMS = { t: 4, m: 65536, p: 2 };

export interface PasswordRecord {
  hash: string;
  salt: string;
  params: string;
}

export function hashPassword(password: string): PasswordRecord {
  const salt = randomBytes(16);
  const digest = argon2id(password.normalize('NFKC'), salt, PARAMS);
  const params = `m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}`;
  return {
    hash: bytesToHex(digest),
    salt: bytesToHex(salt),
    params,
  };
}

export function verifyPassword(password: string, record: PasswordRecord): boolean {
  try {
    const parsed: Record<string, number> = {};
    for (const part of record.params.split(',')) {
      const [k, v] = part.split('=');
      if (k && v) parsed[k.trim()] = Number(v);
    }
    const digest = argon2id(password.normalize('NFKC'), hexToBytes(record.salt), {
      t: parsed.t ?? PARAMS.t,
      m: parsed.m ?? PARAMS.m,
      p: parsed.p ?? PARAMS.p,
      dkLen: 32,
    });
    return bytesToHex(digest) === record.hash.toLowerCase();
  } catch {
    return false;
  }
}

export interface PasswordPolicy {
  minLength: number;
  requireLetter: boolean;
  requireNumber: boolean;
  forbidUsername: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  requireLetter: true,
  requireNumber: true,
  forbidUsername: true,
};

export function checkPasswordStrength(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
  username?: string,
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (password.length < policy.minLength) issues.push(`At least ${policy.minLength} characters`);
  if (policy.requireLetter && !/[A-Za-z\u0980-\u09FF]/.test(password)) issues.push('Include a letter');
  if (policy.requireNumber && !/\d/.test(password)) issues.push('Include a number');
  if (policy.forbidUsername && username && password.toLowerCase().includes(username.toLowerCase())) {
    issues.push('Must not contain the username');
  }
  if (/^(password|12345678|qwerty)/i.test(password)) issues.push('Too common');
  return { ok: issues.length === 0, issues };
}
