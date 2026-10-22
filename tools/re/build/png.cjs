// Deterministic PNG encoder/decoder for the asset build (extends rom.cjs writePNG/readPNG).
//   encode({width, height, rgba, palette?, filters?, level?}) -> Buffer
//   decode(buf) -> {width, height, rgba, colorType, bitDepth}
// Encoder: adaptive per-row filters (minimum-sum-of-absolute-differences heuristic), zlib level 9, a single
// IDAT, no gAMA/sRGB/iCCP/tEXt/tIME chunks (browsers then decode the exact values; nothing varies between runs).
// With palette:true a page whose distinct RGBA values fit in 256 entries is written as colour type 3
// (PLTE + tRNS, entries sorted by (a, r, g, b)); otherwise it falls back to RGBA (type 6).
// Decoder: colour types 0/2/3/4/6, bit depths 1/2/4/8/16, non-interlaced only. Output is always 8-bit RGBA.
'use strict';
const fs = require('fs'), zlib = require('zlib');

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// Per-row filter candidates; picks the one with the smallest sum of |signed byte| (the libpng heuristic).
function filterRows(raw, width, height, bpp, mode) {
  const stride = width * bpp, out = Buffer.alloc((stride + 1) * height);
  const cand = Buffer.alloc(stride), best = Buffer.alloc(stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const line = raw.subarray(y * stride, (y + 1) * stride);
    let bestType = 0, bestScore = Infinity;
    const types = mode === 'none' ? [0] : [0, 1, 2, 3, 4];
    for (const f of types) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0, x = line[i];
        let v;
        if (f === 0) v = x; else if (f === 1) v = x - a; else if (f === 2) v = x - b; else if (f === 3) v = x - ((a + b) >> 1);
        else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        v &= 255; cand[i] = v; score += v < 128 ? v : 256 - v;
        if (score >= bestScore) break;
      }
      if (score < bestScore) { bestScore = score; bestType = f; cand.copy(best); }
    }
    out[y * (stride + 1)] = bestType; best.copy(out, y * (stride + 1) + 1);
    prev = Buffer.from(line);
  }
  return out;
}

function buildPalette(rgba, n) {
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const key = ((rgba[i * 4 + 3] << 24) | (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2]) >>> 0;
    if (!seen.has(key)) { seen.set(key, 0); if (seen.size > 256) return null; }
  }
  const keys = [...seen.keys()].sort((p, q) => p - q);            // (a, r, g, b) ascending: transparent entries first
  keys.forEach((k, i) => seen.set(k, i));
  return { keys, index: seen };
}

function encode({ width, height, rgba, palette = false, filters = null, level = 9 }) {
  if (!(width > 0 && height > 0)) throw new Error('png.encode: empty image');
  if (rgba.length !== width * height * 4) throw new Error(`png.encode: rgba length ${rgba.length} != ${width}x${height}x4`);
  const n = width * height;
  const pal = palette ? buildPalette(rgba, n) : null;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  const chunks = [SIG];
  let raw, bpp;
  if (pal) {
    ihdr[8] = 8; ihdr[9] = 3; bpp = 1;
    raw = Buffer.alloc(n);
    for (let i = 0; i < n; i++) raw[i] = pal.index.get(((rgba[i * 4 + 3] << 24) | (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2]) >>> 0);
    const plte = Buffer.alloc(pal.keys.length * 3), trns = Buffer.alloc(pal.keys.length);
    let lastAlpha = -1;
    pal.keys.forEach((k, i) => { plte[i * 3] = (k >>> 16) & 255; plte[i * 3 + 1] = (k >>> 8) & 255; plte[i * 3 + 2] = k & 255; trns[i] = (k >>> 24) & 255; if (trns[i] !== 255) lastAlpha = i; });
    chunks.push(chunk('IHDR', ihdr), chunk('PLTE', plte));
    if (lastAlpha >= 0) chunks.push(chunk('tRNS', trns.subarray(0, lastAlpha + 1)));
  } else {
    ihdr[8] = 8; ihdr[9] = 6; bpp = 4;
    raw = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    chunks.push(chunk('IHDR', ihdr));
  }
  // 'auto' deflates both the unfiltered and the adaptively filtered rows and keeps the smaller stream (ties: none).
  // Pixel art with few colours usually compresses better unfiltered; photographic-looking pages the other way.
  const modes = filters === 'auto' || filters == null ? ['none', 'adaptive'] : [filters];
  let idat = null;
  for (const mode of modes) {
    const z = zlib.deflateSync(filterRows(raw, width, height, bpp, mode), { level, memLevel: 9, windowBits: 15 });
    if (!idat || z.length < idat.length) idat = z;
  }
  chunks.push(chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function decode(buf) {
  if (!SIG.equals(buf.subarray(0, 8))) throw new Error('png.decode: not a PNG');
  let p = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0, plte = null, trns = null; const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (interlace) throw new Error('png.decode: interlaced PNGs are not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`png.decode: unsupported colour type ${colorType}`);
  const bitsPP = channels * bitDepth, stride = Math.ceil(width * bitsPP / 8), bpp = Math.max(1, bitsPP >> 3);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error('png.decode: truncated image data');
  const rgba = new Uint8Array(width * height * 4);
  let prev = Buffer.alloc(stride);
  const rawSample = (line, x, c) => {                      // sample c of pixel x at its stored depth
    if (bitDepth === 8) return line[x * channels + c];
    if (bitDepth === 16) return line.readUInt16BE((x * channels + c) * 2);
    const bit = (x * channels + c) * bitDepth;
    return (line[bit >> 3] >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1);
  };
  const maxV = (1 << bitDepth) - 1;
  const sample = (line, x, c) => {                         // sample c of pixel x as 0..255 (palette indices unscaled)
    const v = rawSample(line, x, c);
    return colorType === 3 || bitDepth === 8 ? v : bitDepth === 16 ? v >> 8 : Math.round(v * 255 / maxV);
  };
  const keyGray = colorType === 0 && trns && trns.length >= 2 ? trns.readUInt16BE(0) : -1;
  const keyRGB = colorType === 2 && trns && trns.length >= 6 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null;
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const idx = sample(line, x, 0);
        rgba[o] = plte[idx * 3]; rgba[o + 1] = plte[idx * 3 + 1]; rgba[o + 2] = plte[idx * 3 + 2]; rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 0 || colorType === 4) {
        const g = sample(line, x, 0); rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = colorType === 4 ? sample(line, x, 1) : (trns && rawSample(line, x, 0) === keyGray ? 0 : 255);
      } else {
        rgba[o] = sample(line, x, 0); rgba[o + 1] = sample(line, x, 1); rgba[o + 2] = sample(line, x, 2);
        rgba[o + 3] = colorType === 6 ? sample(line, x, 3)
          : (keyRGB && rawSample(line, x, 0) === keyRGB[0] && rawSample(line, x, 1) === keyRGB[1] && rawSample(line, x, 2) === keyRGB[2] ? 0 : 255);
      }
    }
    prev = line;
  }
  return { width, height, rgba, colorType, bitDepth };
}

function write(file, img, opts) { fs.writeFileSync(file, encode({ ...img, ...(opts || {}) })); }
function read(file) { return decode(fs.readFileSync(file)); }
// Pixel equality of two decoded images (pixels under alpha 0 count too: the encoder keeps them).
function equal(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  const p = a.rgba, q = b.rgba; if (p.length !== q.length) return false;
  for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false;
  return true;
}
// Pixel equality ignoring the RGB of fully transparent pixels.
function equalVisible(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  const p = a.rgba, q = b.rgba;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] !== q[i + 3]) return false;
    if (p[i + 3] && (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2])) return false;
  }
  return true;
}
// FNV-1a (32-bit) over (R<<4|G) of every opaque pixel: the SPRITE_DATA sheet checksum (PLAN §4.1).
function fnvIndexed(rgba) {
  let h = 0x811C9DC5;
  for (let i = 0; i < rgba.length; i += 4) {
    if (!rgba[i + 3]) continue;
    h ^= ((rgba[i] << 4) | (rgba[i + 1] & 15)) & 0xFFFF;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const dataURL = buf => 'data:image/png;base64,' + buf.toString('base64');
const fromDataURL = url => decode(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));

module.exports = { encode, decode, write, read, equal, equalVisible, fnvIndexed, dataURL, fromDataURL, crc32, chunk, SIG };
