#!/usr/bin/env python3
"""Build build/icon.ico from the multi-size PNG assets.

ImageMagick's `ico:` writer re-encodes sub-256 entries and can fill
transparency with an opaque white matte (the v1.0.0 icon defect — FD-003).
This script assembles the ICO container by hand:

  - 16/24/32/48/64/128 px: 32-bit BGRA BMP entries (bottom-up rows, zero AND
    mask — Windows uses the alpha channel)
  - 256 px: raw PNG entry (the Windows-documented form for 256)

The PNGs are decoded with zlib + PNG unfiltering only — no image library, so
the output is bit-for-bit reproducible from the committed assets.

Usage: python3 scripts/build-ico.py [out.ico]
"""
import os
import struct
import sys
import zlib


def read_png_rgba(path):
    """Minimal PNG decoder — returns (width, height, rows) with rows a list
    of BGRA byte strings (top-down, each row width*4 bytes)."""
    with open(path, "rb") as f:
        data = f.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    off = 8
    width = height = depth = ctype = None
    idat = []
    while off < len(data):
        (length,) = struct.unpack_from(">I", data, off)
        ctype_name = data[off + 4 : off + 8]
        chunk = data[off + 8 : off + 8 + length]
        if ctype_name == b"IHDR":
            width, height = struct.unpack_from(">II", chunk, 0)
            depth, ctype = chunk[8], chunk[9]
        elif ctype_name == b"IDAT":
            idat.append(chunk)
        elif ctype_name == b"IEND":
            break
        off += 12 + length
    assert depth == 8 and ctype == 6, f"need 8-bit RGBA, got depth={depth} ctype={ctype}"

    raw = zlib.decompress(b"".join(idat))
    stride = width * 4
    rows_out = [bytearray(stride) for _ in range(height)]
    for y in range(height):
        row_start = y * (stride + 1)
        filter_type = raw[row_start]
        src = raw[row_start + 1 : row_start + 1 + stride]
        out = rows_out[y]
        prev = rows_out[y - 1] if y > 0 else None
        for x in range(stride):
            a = out[x - 4] if x >= 4 else 0
            b = prev[x] if prev is not None else 0
            c = prev[x - 4] if (prev is not None and x >= 4) else 0
            v = src[x]
            if filter_type == 1:
                v = (v + a) & 0xFF
            elif filter_type == 2:
                v = (v + b) & 0xFF
            elif filter_type == 3:
                v = (v + ((a + b) >> 1)) & 0xFF
            elif filter_type == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                v = (v + pr) & 0xFF
            elif filter_type != 0:
                raise ValueError(f"unsupported PNG filter {filter_type}")
            out[x] = v
    # RGBA → BGRA
    bgra_rows = []
    for row in rows_out:
        bgr = bytearray(stride)
        for i in range(width):
            bgr[i * 4] = row[i * 4 + 2]
            bgr[i * 4 + 1] = row[i * 4 + 1]
            bgr[i * 4 + 2] = row[i * 4]
            bgr[i * 4 + 3] = row[i * 4 + 3]
        bgra_rows.append(bytes(bgr))
    return width, height, bgra_rows


def bmp32_entry(width, height, bgra_rows):
    header = struct.pack(
        "<IiiHHIIiiII", 40, width, height * 2, 1, 32, 0, width * height * 4, 0, 0, 0, 0
    )
    xor = b"".join(reversed(bgra_rows))  # bottom-up
    and_row_bytes = ((width + 31) // 32) * 4
    and_mask = b"\x00" * (and_row_bytes * height)
    return header + xor + and_mask


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    icons_dir = os.path.join(root, "assets", "icons")
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "build", "icon.ico")

    sizes = [16, 24, 32, 48, 64, 128, 256]
    entries = []  # (w, h, payload)
    for size in sizes:
        src = os.path.join(icons_dir, f"icon-{size}.png")
        if not os.path.exists(src):
            sys.exit(f"missing {src}")
        w, h, bgra = read_png_rgba(src)
        assert w == size and h == size, f"{src} is {w}x{h}, expected {size}x{size}"
        if size == 256:
            with open(src, "rb") as f:
                payload = f.read()
        else:
            payload = bmp32_entry(w, h, bgra)
        entries.append((w, h, payload))

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    dir_bytes = b""
    blobs = b""
    for w, h, payload in entries:
        dir_bytes += struct.pack(
            "<BBBBHHII",
            w if w < 256 else 0,
            h if h < 256 else 0,
            0,
            0,
            1,
            32,
            len(payload),
            offset,
        )
        offset += len(payload)
        blobs += payload
    with open(out_path, "wb") as f:
        f.write(header + dir_bytes + blobs)
    print(f"wrote {out_path} ({os.path.getsize(out_path)} bytes, {len(entries)} entries)")


if __name__ == "__main__":
    main()
