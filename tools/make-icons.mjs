// Generates the PWA icon PNGs with zero dependencies.
// Draws a supersampled clock/timer glyph, downsamples it, then encodes PNG
// using Node's built-in zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SS = 3; // supersample factor for anti-aliasing

function makeCanvas(size) {
  return { size, data: new Uint8ClampedArray(size * size * 4) };
}

function blend(c, x, y, [r, g, b], a) {
  if (a <= 0 || x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  const d = c.data;
  const da = d[i + 3] / 255;
  const outA = a + da * (1 - a);
  if (outA <= 0) return;
  d[i] = (r * a + d[i] * da * (1 - a)) / outA;
  d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / outA;
  d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / outA;
  d[i + 3] = outA * 255;
}

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

function fillRoundRect(c, x, y, w, h, r, color, alpha = 1) {
  const col = hex(color);
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      const dx = Math.max(x + r - px - 0.5, 0, px + 0.5 - (x + w - r));
      const dy = Math.max(y + r - py - 0.5, 0, py + 0.5 - (y + h - r));
      if (dx * dx + dy * dy <= r * r) blend(c, px, py, col, alpha);
    }
  }
}

function fillCircle(c, cx, cy, rad, color, alpha = 1) {
  const col = hex(color);
  for (let py = Math.floor(cy - rad); py <= Math.ceil(cy + rad); py++) {
    for (let px = Math.floor(cx - rad); px <= Math.ceil(cx + rad); px++) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      if (dx * dx + dy * dy <= rad * rad) blend(c, px, py, col, alpha);
    }
  }
}

// Angles in degrees, 0 = 12 o'clock, growing clockwise.
function fillArc(c, cx, cy, rOuter, rInner, startDeg, endDeg, color, alpha = 1) {
  const col = hex(color);
  for (let py = Math.floor(cy - rOuter); py <= Math.ceil(cy + rOuter); py++) {
    for (let px = Math.floor(cx - rOuter); px <= Math.ceil(cx + rOuter); px++) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > rOuter || dist < rInner) continue;
      let ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (ang < 0) ang += 360;
      if (ang >= startDeg && ang <= endDeg) blend(c, px, py, col, alpha);
    }
  }
}

function fillHand(c, cx, cy, deg, length, width, color) {
  const col = hex(color);
  const rad = ((deg - 90) * Math.PI) / 180;
  const ex = cx + Math.cos(rad) * length;
  const ey = cy + Math.sin(rad) * length;
  const half = width / 2;
  const minX = Math.floor(Math.min(cx, ex) - width);
  const maxX = Math.ceil(Math.max(cx, ex) + width);
  const minY = Math.floor(Math.min(cy, ey) - width);
  const maxY = Math.ceil(Math.max(cy, ey) + width);
  const vx = ex - cx;
  const vy = ey - cy;
  const len2 = vx * vx + vy * vy;
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const wx = px + 0.5 - cx;
      const wy = py + 0.5 - cy;
      let t = len2 ? (wx * vx + wy * vy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dx = wx - vx * t;
      const dy = wy - vy * t;
      if (Math.hypot(dx, dy) <= half) blend(c, px, py, col, 1);
    }
  }
}

function downsample(c, target) {
  const out = makeCanvas(target);
  const factor = c.size / target;
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = ((y * factor + sy) * c.size + (x * factor + sx)) * 4;
          const sa = c.data[i + 3] / 255;
          r += c.data[i] * sa;
          g += c.data[i + 1] * sa;
          b += c.data[i + 2] * sa;
          a += sa;
          n++;
        }
      }
      const o = (y * target + x) * 4;
      out.data[o] = a ? r / a : 0;
      out.data[o + 1] = a ? g / a : 0;
      out.data[o + 2] = a ? b / a : 0;
      out.data[o + 3] = (a / n) * 255;
    }
  }
  return out;
}

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(canvas) {
  const { size, data } = canvas;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size * 4; x++) raw[p++] = data[y * size * 4 + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// scale: how much of the canvas the glyph occupies (maskable needs a safe zone)
function drawIcon(target, { maskable = false, transparent = false } = {}) {
  const size = target * SS;
  const c = makeCanvas(size);

  if (!transparent) {
    const radius = maskable ? size / 2 : size * 0.22;
    fillRoundRect(c, 0, 0, size, size, radius, '#0f172a');
    // subtle diagonal lift so the tile is not flat black
    for (let y = 0; y < size; y++) {
      const a = 0.16 * (1 - y / size);
      fillRoundRect(c, 0, y, size, 1, 0, '#38bdf8', a);
    }
  }

  const glyph = maskable ? 0.72 : 0.86;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = (size / 2) * glyph;
  const rInner = rOuter * 0.78;

  fillArc(c, cx, cy, rOuter, rInner, 0, 360, '#38bdf8', 0.22);
  fillArc(c, cx, cy, rOuter, rInner, 0, 272, '#38bdf8', 1);
  fillCircle(c, cx, cy, rInner * 0.97, '#111827');

  fillHand(c, cx, cy, 0, rInner * 0.72, size * 0.045, '#e2e8f0');
  fillHand(c, cx, cy, 108, rInner * 0.5, size * 0.05, '#22c55e');
  fillCircle(c, cx, cy, size * 0.035, '#e2e8f0');

  return encodePng(downsample(c, target));
}

const outputs = [
  ['icons/icon-192.png', 192, {}],
  ['icons/icon-512.png', 512, {}],
  ['icons/icon-maskable-192.png', 192, { maskable: true }],
  ['icons/icon-maskable-512.png', 512, { maskable: true }],
  ['icons/apple-touch-icon.png', 180, {}],
  ['icons/favicon-32.png', 32, {}],
];

const root = resolve(process.argv[2] ?? '.');
for (const [file, size, opts] of outputs) {
  const path = resolve(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, drawIcon(size, opts));
  console.log('wrote', file, `${size}x${size}`);
}
