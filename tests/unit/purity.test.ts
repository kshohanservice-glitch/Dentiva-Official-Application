import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';


/**
 * Build purity — the shipped application must contain no demo/test data,
 * no activation code in plaintext, and no focused-test leftovers.
 */

const repo = process.cwd(); // vitest runs from the repo root
const srcRoot = path.join(repo, 'src');
const files = walk(srcRoot);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('no demo data in shipped source', () => {

  it('has no lorem ipsum / dummy / sample records', () => {
    const bad = /\b(lorem ipsum|dummy (data|record)s?|sample (patient|data|record)s?|john doe|jane doe)\b/i;
    const hits = files.filter((f) => bad.test(fs.readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('has no plaintext 16-digit activation codes', () => {
    // '1234567890123456' is the documented fake used by format tests only.
    const hits: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\b\d{16}\b/g)) {
        if (m[0] !== '1234567890123456') hits.push(`${path.relative(repo, f)}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('installer does not bundle tests, docs, or repo files', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')) as {
      build: { files: string[] };
    };
    for (const pattern of pkg.build.files) {
      expect(pattern).not.toMatch(/tests|docs|scripts|\.github/);
    }
  });
});

describe('product identity & assets', () => {
  it('About/contact identity is present in the product', () => {
    const all = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(all).toContain('helloiamshohan@gmail.com');
    expect(all).toContain('Shohan Khan');
  });

  it('app icon is a multi-resolution ICO (16→256)', () => {
    const ico = fs.readFileSync(path.join(repo, 'build', 'icon.ico'));
    expect(ico.length).toBeGreaterThan(1000);
    // ICONDIR: 6 bytes, then ICONDIRENTRY × count (16 bytes each);
    // width/height bytes are 0 for 256px images.
    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(4);
    const sizes = new Set<number>();
    for (let i = 0; i < count; i++) {
      const off = 6 + i * 16;
      sizes.add(ico.readUInt8(off) || 256);
    }
    for (const s of [16, 32, 48, 128, 256]) expect(sizes.has(s)).toBe(true);
  });
});

describe('test suite hygiene', () => {
  const testFiles = (() => {
    const out: string[] = [];
    const collect = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(full);
        else if (entry.name.endsWith('.test.ts')) out.push(full);
      }
    };
    collect(path.join(repo, 'tests'));
    return out;
  })();

  it('no focused-test markers can ship', () => {
    const focused = new RegExp(String.fromCharCode(92) + '.only' + String.fromCharCode(92) + '(');
    const hits = testFiles.filter((f) => focused.test(fs.readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('the suite exists and covers unit + integration + e2e layers', () => {
    expect(testFiles.some((f) => f.includes('unit'))).toBe(true);
    expect(testFiles.some((f) => f.includes('integration'))).toBe(true);
    const e2e = fs.readdirSync(path.join(repo, 'tests/e2e')).filter((f) => f.endsWith('.spec.ts'));
    expect(e2e.length).toBeGreaterThan(0);
  });
});
