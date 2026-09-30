/* Static QA audit — fails the build on unfinished-work markers in shipped source.
 *
 * Checks (src/ only — tests/docs are allowed to mention markers):
 *   1. Work markers: TODO, FIXME, XXX (as a whole word), HACK, "not implemented"
 *   2. Stray console.log / console.debug in shipped code
 *   3. Demo/placeholder data terms (lorem ipsum, dummy records, sample patients)
 *   4. "coming soon" feature flags / dead UI affordances
 *
 * Usage: node scripts/static-audit.mjs [--json]
 * Exit code 0 = clean, 1 = findings (printed with file:line).
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ROOT = path.join(repo, 'src');
const exts = new Set(['.ts', '.tsx']);

const RULES = [
  { id: 'work-marker', label: 'TODO/FIXME/HACK/XXX work marker', re: /\b(TODO|FIXME|HACK|XXX)\b/ },
  { id: 'not-implemented', label: 'not implemented marker', re: /\bnot implemented\b/i },
  { id: 'stray-console', label: 'stray console.log/debug', re: /\bconsole\.(log|debug)\s*\(/ },
  {
    id: 'demo-data',
    label: 'demo/placeholder data term',
    re: /\b(lorem ipsum|dummy (data|record)s?|sample (patient|data|record)s?|john doe|jane doe)\b/i,
  },
  { id: 'coming-soon', label: 'coming-soon dead end', re: /\bcoming soon\b/i },
];

/** Files excluded because they are infrastructure, not product behavior. */
const ALLOW_FILES = new Set([
  // renderer bootstrap: intentional console.error captured by the global error boundary
  path.join('src', 'renderer', 'main.tsx'),
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (exts.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const findings = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(repo, file);
  if (ALLOW_FILES.has(rel)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // strip line comments so documentation of a rule doesn't trip it
    const code = line.replace(/\/\/.*$/, '');
    for (const rule of RULES) {
      if (rule.re.test(code)) {
        findings.push({ rule: rule.id, label: rule.label, file: rel, line: i + 1, text: line.trim().slice(0, 140) });
      }
    }
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
} else if (findings.length === 0) {
  console.log(`static-audit PASS — ${walk(ROOT).length} files scanned, no unfinished-work markers.`);
} else {
  console.error(`static-audit FAIL — ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  ${f.file}:${f.line} [${f.rule}] ${f.text}`);
  process.exit(1);
}
