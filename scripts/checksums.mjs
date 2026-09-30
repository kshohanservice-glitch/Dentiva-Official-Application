/* Generates SHA-256 checksums for everything in dist/ (and release/ if present). */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath — new URL().pathname is not a valid path on Windows (/D:/...)
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['dist', 'release'].map((d) => path.join(repo, d)).filter((d) => fs.existsSync(d));

if (targets.length === 0) {
  console.error('No dist/ or release/ directory found. Build first.');
  process.exit(1);
}

const lines = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.exe', '.zip', '.blockmap', '.yml', '.json', '.txt'].includes(ext)) continue;
      const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      const rel = path.relative(repo, full);
      const size = fs.statSync(full).size;
      lines.push(`${hash}  ${rel}  (${size} bytes)`);
      console.log(`${hash}  ${rel}  (${size} bytes)`);
    }
  }
}
targets.forEach(walk);
fs.writeFileSync(path.join(repo, 'dist', 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log('Wrote dist/SHA256SUMS.txt');
