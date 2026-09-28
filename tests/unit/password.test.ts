import { describe, expect, it } from 'vitest';
import { checkPasswordStrength, hashPassword, verifyPassword } from '../../src/main/security/password';

describe('password hashing (argon2id)', () => {
  it('round-trips a correct password', () => {
    const rec = hashPassword('Correct#Horse9');
    expect(verifyPassword('Correct#Horse9', rec)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const rec = hashPassword('Correct#Horse9');
    expect(verifyPassword('incorrect', rec)).toBe(false);
    expect(verifyPassword('Correct#Horse', rec)).toBe(false);
  });

  it('uses a unique salt per hash', () => {
    const a = hashPassword('SamePass123');
    const b = hashPassword('SamePass123');
    expect(a.salt).not.toEqual(b.salt);
    expect(a.hash).not.toEqual(b.hash);
    expect(verifyPassword('SamePass123', a)).toBe(true);
    expect(verifyPassword('SamePass123', b)).toBe(true);
  });

  it('never stores plaintext', () => {
    const rec = hashPassword('TopSecret#1');
    const blob = JSON.stringify(rec);
    expect(blob).not.toContain('TopSecret#1');
    expect(rec.hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('password policy', () => {
  it('accepts a strong password', () => {
    const r = checkPasswordStrength('Dentiva#2026');
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('requires minimum length', () => {
    const r = checkPasswordStrength('Ab1');
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/At least \d+ characters/i);
  });

  it('requires a letter and a number', () => {
    expect(checkPasswordStrength('abcdefghijkl').ok).toBe(false);
    expect(checkPasswordStrength('123456789012').ok).toBe(false);
  });

  it('rejects password containing the username', () => {
    const r = checkPasswordStrength('shohan123456', undefined, 'shohan');
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/username/i);
  });
});
