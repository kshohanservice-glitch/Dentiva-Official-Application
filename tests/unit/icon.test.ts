import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(__dirname, '../..');

/* ------------------------- minimal PNG decoder (RGBA8) ------------------------- */

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePngRGBA(buf: Buffer): { width: number; height: number; px: (i: number, j: number) => [number, number, number, number] } {
  expect(buf.subarray(0, 8).toString('hex'), 'PNG signature').toBe('89504e470d0a1a0a');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  expect(bitDepth, 'bit depth 8').toBe(8);
  expect(colorType, 'color type 6 (RGBA)').toBe(6);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const rowBytes = width * bpp;
  const out = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const rowIn = raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1));
    const rowOut = out.subarray(y * rowBytes, (y + 1) * rowBytes);
    const prev = y > 0 ? out.subarray((y - 1) * rowBytes, y * rowBytes) : null;
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? rowOut[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = rowIn[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          v = (v + a) & 0xff;
          break;
        case 2:
          v = (v + b) & 0xff;
          break;
        case 3:
          v = (v + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          v = (v + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error('unsupported PNG filter ' + filter);
      }
      rowOut[x] = v;
    }
  }
  return {
    width,
    height,
    px: (i: number, j: number) => {
      const o = (j * width + i) * 4;
      return [out[o], out[o + 1], out[o + 2], out[o + 3]];
    },
  };
}

/* ------------------------------ ICO container ------------------------------ */

function icoEntries(buf: Buffer): { w: number; h: number; data: Buffer }[] {
  expect(buf.readUInt16LE(0), 'ICO reserved').toBe(0);
  expect(buf.readUInt16LE(2), 'ICO type').toBe(1);
  const count = buf.readUInt16LE(4);
  const out: { w: number; h: number; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const w = buf[e] || 256;
    const h = buf[e + 1] || 256;
    const size = buf.readUInt32LE(e + 8);
    const offset = buf.readUInt32LE(e + 12);
    out.push({ w, h, data: buf.subarray(offset, offset + size) });
  }
  return out;
}

function decodeIcoImage(entry: { w: number; h: number; data: Buffer }): {
  width: number;
  height: number;
  px: (i: number, j: number) => [number, number, number, number];
} {
  const isPng = entry.data.subarray(0, 4).toString('hex') === '89504e47';
  if (isPng) {
    const d = decodePngRGBA(entry.data);
    return d;
  }
  // BMP-in-ICO: BITMAPINFOHEADER (40 B), then BGRA rows bottom-up, then AND mask.
  const headerSize = entry.data.readUInt32LE(0);
  expect(headerSize, 'BMP header').toBe(40);
  const width = entry.data.readInt32LE(4);
  const height = Math.floor(entry.data.readInt32LE(8) / 2); // stored doubled (XOR + AND)
  const px = (i: number, j: number): [number, number, number, number] => {
    const row = height - 1 - j; // bottom-up
    const o = 40 + row * width * 4 + i * 4;
    return [entry.data[o + 2], entry.data[o + 1], entry.data[o], entry.data[o + 3]];
  };
  return { width, height, px };
}

/* ------------------------------- the actual tests ------------------------------- */

describe('application icon (FD-003 regression: no opaque white matte)', () => {
  it('assets/icons/icon-256.png has transparent corners and an opaque logo center', () => {
    const d = decodePngRGBA(fs.readFileSync(path.join(repo, 'assets', 'icons', 'icon-256.png')));
    expect(d.width).toBe(256);
    expect(d.height).toBe(256);
    for (const [i, j] of [
      [0, 0],
      [255, 0],
      [0, 255],
      [255, 255],
    ] as const) {
      const a = d.px(i, j)[3];
      if (a !== 0) throw new Error(`corner ${i},${j} alpha must be 0 (got ${a})`);
    }
    const [, , , centerA] = d.px(128, 128);
    expect(centerA, 'center must be fully opaque').toBe(255);
    // No white matte: every pixel of the 12×12 corner boxes must be
    // (near-)transparent. (Corner radius is 56px, so the 12px box starting
    // at 244 lies fully outside the logo with ≥7px margin for anti-aliasing —
    // the v1.0.0 defect filled exactly these regions with opaque white.)
    const cornerBox = (x0: number, y0: number): number => {
      let max = 0;
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          const a = d.px(x0 + x, y0 + y)[3];
          if (a > max) max = a;
        }
      }
      return max;
    };
    expect(cornerBox(0, 0), 'top-left corner must be transparent').toBeLessThan(16);
    expect(cornerBox(244, 0), 'top-right corner must be transparent').toBeLessThan(16);
    expect(cornerBox(0, 244), 'bottom-left corner must be transparent').toBeLessThan(16);
    expect(cornerBox(244, 244), 'bottom-right corner must be transparent').toBeLessThan(16);
  });

  it('assets/icons/app-icon.png (window/taskbar icon) matches the same contract', () => {
    const d = decodePngRGBA(fs.readFileSync(path.join(repo, 'assets', 'icons', 'app-icon.png')));
    for (const [i, j] of [
      [0, 0],
      [d.width - 1, 0],
      [0, d.height - 1],
      [d.width - 1, d.height - 1],
    ]) {
      expect(d.px(i, j)[3]).toBe(0);
    }
  });

  it('build/icon.ico contains 16→256 entries and every entry has transparent corners', () => {
    const ico = fs.readFileSync(path.join(repo, 'build', 'icon.ico'));
    const entries = icoEntries(ico);
    const sizes = entries.map((e) => e.w);
    for (const s of [16, 24, 32, 48, 64, 128, 256]) {
      expect(sizes, `ICO must contain ${s}px`).toContain(s);
    }
    for (const entry of entries) {
      const d = decodeIcoImage(entry);
      const corners: [number, number][] = [
        [0, 0],
        [d.width - 1, 0],
        [0, d.height - 1],
        [d.width - 1, d.height - 1],
      ];
      for (const [i, j] of corners) {
        const a = d.px(i, j)[3];
        // 16px entries may carry a <1/255 anti-aliasing fringe from downscaling;
        // anything visibly opaque (>= 16/255) is a white-matte defect.
        expect(a, `${entry.w}px corner ${i},${j} alpha`).toBeLessThan(16);
      }
      const centerA = d.px(Math.floor(d.width / 2), Math.floor(d.height / 2))[3];
      expect(centerA, `${entry.w}px center must be opaque`).toBe(255);
    }
  });
});
