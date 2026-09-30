/*
 * Derives the offline activation verifier constant used by the application.
 *
 * SECURITY: This script contains NO plaintext activation code.
 * The code is supplied at runtime via env var DENTIVA_ACTIVATION_SOURCE and is
 * never written to disk by this script. Only the Argon2id-derived verifier
 * (params + salt + digest) is printed for embedding into src/main/security/activation.ts.
 *
 * Usage:
 *   DENTIVA_ACTIVATION_SOURCE='...' node scripts/derive-activation.cjs
 */
const { argon2id } = require('@noble/hashes/argon2.js');
const { bytesToHex, randomBytes } = require('@noble/hashes/utils.js');

const source = process.env.DENTIVA_ACTIVATION_SOURCE;
if (!source) {
  console.error('DENTIVA_ACTIVATION_SOURCE not set');
  process.exit(1);
}

const normalized = source.trim();
const salt = randomBytes(16);
const params = { t: 4, m: 65536, p: 2 }; // 64 MiB, iter 4, parallelism 2
const digest = argon2id(normalized.normalize('NFKC'), salt, params);

console.log('saltHex: ' + bytesToHex(salt));
console.log('digestHex: ' + bytesToHex(digest));
console.log('params: ' + JSON.stringify(params));
