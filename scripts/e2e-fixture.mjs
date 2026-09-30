#!/usr/bin/env node
/**
 * Build the CI E2E activation fixture.
 *
 * The customer's 16-digit activation code must never appear in the repo or in
 * CI logs. When DENTIVA_ACTIVATION_SOURCE is unavailable (forks/PRs), this
 * script pre-activates a throwaway user-data directory by writing the SAME
 * artifacts the real activation flow writes:
 *
 *   - dentiva.db  → activation_state(id=1) row with activated=1 + payload
 *   - activation.dat → the same payload (the app requires file == DB blob)
 *
 * The payload is AES-256-GCM (iv|tag|ciphertext, base64) keyed with
 * scrypt(`hostname|username|dentiva-pro`, 'dentiva-activation-v1') — exactly
 * what src/main/security/activation.ts does at runtime, so the fixture only
 * works on the machine that built it (the CI runner), which is the point.
 *
 * MUST run BEFORE `electron-rebuild` (it uses the node-ABI build of
 * better-sqlite3 produced by `npm ci`).
 *
 * Usage: node scripts/e2e-fixture.mjs [outDir]   (default: e2e-fixture/userdata)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDecipheriv, createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const outDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'e2e-fixture', 'userdata'));

function machineKey() {
  return `${os.hostname()}|${os.userInfo().username}|dentiva-pro`;
}

function encryptState(plaintext, keyInput) {
  const key = scryptSync(keyInput, 'dentiva-activation-v1', 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

function decryptState(payload, keyInput) {
  const key = scryptSync(keyInput, 'dentiva-activation-v1', 32);
  const buf = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const d of ['attachments', 'logs', 'backups', 'runtime', 'clinic', 'dentists', 'users', 'exports']) {
  fs.mkdirSync(path.join(outDir, d), { recursive: true });
}

const marker = 'dentiva-activated-v1';
const payload = encryptState(JSON.stringify({ marker, at: new Date().toISOString() }), machineKey());

// self-check: decrypt round-trip must yield the marker (catches drift from activation.ts)
const roundTrip = JSON.parse(decryptState(payload, machineKey()));
if (roundTrip.marker !== marker) throw new Error('fixture self-check failed: marker mismatch');

const dbPath = path.join(outDir, 'dentiva.db');
const db = new Database(dbPath);
// Only `activation_state` is pre-seeded. Everything else (schema_migrations,
// all tables, seeds) is applied by the app itself on first boot: its v1
// migration uses CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE, so the
// pre-activated row (id=1, activated=1, payload) survives the migration.
// Column shapes must stay in sync with src/main/db/migrations.ts.
db.exec(`
  CREATE TABLE IF NOT EXISTS activation_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    activated INTEGER NOT NULL DEFAULT 0,
    activated_at TEXT,
    payload TEXT
  );
`);
db.prepare(
  'INSERT OR REPLACE INTO activation_state (id, activated, activated_at, payload) VALUES (1, 1, datetime(\'now\',\'localtime\'), ?)',
).run(payload);
db.prepare('SELECT 1').get();
// sanity: the row is readable
const row = db.prepare('SELECT activated FROM activation_state WHERE id = 1').get();
if (row.activated !== 1) throw new Error('fixture DB sanity check failed');
db.close();

fs.writeFileSync(path.join(outDir, 'activation.dat'), payload, { encoding: 'utf8', mode: 0o600 });

console.log(`E2E activation fixture written to ${outDir}`);
console.log('App boot with this user-data dir starts at the setup wizard (already activated).');
