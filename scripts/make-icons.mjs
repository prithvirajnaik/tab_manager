// Generates public/icon/{16,32,48,128}.png: a blue rounded square with three stacked "tabs".
// Dependency-free (zlib only) so the icons are reproducible: `node scripts/make-icons.mjs`.
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [47, 91, 211];
const FG = [255, 255, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** Coverage (0..1) of pixel (x, y) by a rounded rectangle, 4x4 supersampled. */
function cover(x, y, rx, ry, rw, rh, r) {
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4;
      const py = y + (sy + 0.5) / 4;
      if (px < rx || py < ry || px > rx + rw || py > ry + rh) continue;
      const cx = Math.min(Math.max(px, rx + r), rx + rw - r);
      const cy = Math.min(Math.max(py, ry + r), ry + rh - r);
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) hits++;
    }
  }
  return hits / 16;
}

function icon(size) {
  const s = size / 16;
  const bars = [
    [4, 3.5, 8],
    [4, 7, 8],
    [4, 10.5, 5],
  ];
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const a = cover(x, y, 0, 0, size, size, 3.5 * s);
      let fg = 0;
      for (const [bx, by, bw] of bars)
        fg = Math.max(fg, cover(x, y, bx * s, by * s, bw * s, 2 * s, 0.8 * s));
      const rgb = BG.map((c, i) => Math.round(c * (1 - fg) + FG[i] * fg));
      row.push(...rgb, Math.round(a * 255));
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icon', { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`public/icon/${size}.png`, icon(size));
process.stdout.write('icons written to public/icon' + String.fromCharCode(10));
