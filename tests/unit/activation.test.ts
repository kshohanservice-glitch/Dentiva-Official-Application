import { describe, expect, it } from 'vitest';
import {
  normalizeActivationCode,
  validateActivationCodeFormat,
  verifyActivationCode,
} from '../../src/main/security/activation';

describe('activation format validation', () => {
  it('accepts a 16-digit code', () => {
    expect(validateActivationCodeFormat('1234567890123456')).toBe(true);
  });

  it('rejects wrong lengths and non-digits', () => {
    expect(validateActivationCodeFormat('12345')).toBe(false);
    expect(validateActivationCodeFormat('abcdefghijklmnop')).toBe(false);
    expect(validateActivationCodeFormat('12345678901234567')).toBe(false);
    expect(validateActivationCodeFormat('')).toBe(false);
  });

  it('normalization strips spaces and dashes', () => {
    expect(normalizeActivationCode('1234-5678 9012-3456')).toBe('1234567890123456');
  });

  it('verify returns format reason for malformed input without touching the verifier', () => {
    expect(verifyActivationCode('abc')).toEqual({ ok: false, reason: 'format' });
    expect(verifyActivationCode('')).toEqual({ ok: false, reason: 'format' });
  });

  it('a well-formed but wrong code is rejected as invalid', () => {
    const wrong = '0000000000000000';
    expect(verifyActivationCode(wrong)).toEqual({ ok: false, reason: 'invalid' });
  });
});

/**
 * The authorized activation source is provided only through the environment
 * (DENTIVA_ACTIVATION_SOURCE) at test time — never committed to the repo.
 * When absent (normal forks/CI without secrets), this case is skipped.
 */
describe('activation verification against the embedded verifier', () => {
  const source = process.env.DENTIVA_ACTIVATION_SOURCE;

  it('verifies the authorized activation code', () => {
    if (!source) {
      expect(verifyActivationCode('1234567890123456').ok).toBe(false);
      return; // skip real check — secret not provided in this environment
    }
    const result = verifyActivationCode(source);
    expect(result.ok).toBe(true);
    // spaced/dashed presentation must also verify
    const spaced = source.replace(/(\d{4})(?=\d)/g, '$1 ');
    expect(verifyActivationCode(spaced).ok).toBe(true);
  });
});
