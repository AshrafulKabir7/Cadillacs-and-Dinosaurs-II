// Read-only decoder for the user's Cadillacs & Dinosaurs ROM set (never modified, never shipped).
// Program: cde_23a.8f + cde_22a.7f + cde_21a.6f, byte pairs swapped. Graphics: cd-1m..cd-8m interleaved into 4 MB.
// Tile = 128 bytes; each 8-byte row holds the four bitplanes of pixels 0-7 (bytes 0-3) then 8-15 (bytes 4-7), MSB first;
// pen 15 is transparent. Verified at 99.8 % against the shipped hero atlas.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const DIR = process.env.DINO_ROMS || 'E:/mostafa/dino';

const prg = (() => {
  const b = Buffer.concat(['cde_23a.8f', 'cde_22a.7f', 'cde_21a.6f'].map(f => fs.readFileSync(path.join(DIR, f))));
  for (let i = 0; i < b.length; i += 2) { const t = b[i]; b[i] = b[i + 1]; b[i + 1] = t; }
  return b;
})();

const gfx = (() => {
  const names = ['cd-1m.3a', 'cd-3m.5a', 'cd-2m.4a', 'cd-4m.6a', 'cd-5m.7a', 'cd-7m.9a', 'cd-6m.8a', 'cd-8m.10a'];
  const roms = names.map(f => fs.readFileSync(path.join(DIR, f))), g = Buffer.alloc(0x400000);
  for (let half = 0; half < 2; half++) for (let k = 0; k < 4; k++) {
    const r = roms[half * 4 + k];
    for (let i = 0; i < r.length; i += 2) { const d = half * 0x200000 + (i / 2) * 8 + k * 2; g[d] = r[i]; g[d + 1] = r[i + 1]; }
  }
  return g;
})();

const u16 = o => prg.readUInt16BE(o), u32 = o => prg.readUInt32BE(o), s16 = o => prg.readInt16BE(o);
const REC_TABLE = 0xD0CF4, REC_COUNT = 0xDB9, LAY_TABLE = 0xD43D8, LAY_COUNT = 0x9D4, PAL_TABLE = 0xB7A52;

const tileCache = new Map();
function tile(code) {
  if (tileCache.has(code)) return tileCache.get(code);
  const out = new Uint8Array(256), base = code * 128;
  if (base + 128 > gfx.length) { out.fill(15); return out; }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let pen = 0;
    for (let p = 0; p < 4; p++) { const byte = gfx[base + y * 8 + (x >> 3) * 4 + p]; pen |= ((byte >> (7 - (x & 7))) & 1) << p; }
    out[y * 16 + x] = pen;
  }
  tileCache.set(code, out);
  return out;
}

function parseRecord(i) {
  const a = u32(REC_TABLE + i * 4) & 0xFFFFFF;
  if (!a || a >= prg.length) return null;
  const head = [u16(a), u16(a + 2), u16(a + 4), u16(a + 6)], count = head[1], flags = head[2], layout = head[3];
  if (!count || count > 200) return null;
  const blocks = []; let p = a + 8;
  for (let k = 0; k < count; k++) {
    if (flags & 0x8000) {
      const code = u16(p), attr = u16(p + 2); p += 4;
      blocks.push({ code, attr, w: ((attr >> 8) & 15) + 1, h: ((attr >> 12) & 15) + 1, flipX: !!(attr & 0x20), flipY: !!(attr & 0x40), pal: attr & 31 });
    } else { blocks.push({ code: u16(p), attr: 0, w: 1, h: 1, flipX: false, flipY: false, pal: 0 }); p += 2; }
  }
  const la = u32(LAY_TABLE + layout * 4) & 0xFFFFFF, offs = [];
  if (la && la < prg.length) for (let k = 0; k < count; k++) offs.push({ x: s16(la + k * 4), y: s16(la + k * 4 + 2) });
  return { index: i, address: a, head, count, flags, layout, blocks, offs };
}

// Render to indexed pixels with a per-pixel palette index; (ox, oy) = feet origin inside the image.
function render(rec, { dropShadows = true } = {}) {
  if (!rec || !rec.offs.length) return null;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9; const pieces = [];
  rec.blocks.forEach((b, k) => {
    const o = rec.offs[k]; if (!o) return;
    const px = []; let solid0 = true;
    for (let ty = 0; ty < b.h; ty++) for (let tx = 0; tx < b.w; tx++) {
      const t = tile(b.code + tx + ty * 16); px.push({ tx, ty, t });
      for (let q = 0; q < 256; q++) if (t[q] !== 0 && t[q] !== 15) solid0 = false;
    }
    if (dropShadows && solid0) return;
    minX = Math.min(minX, o.x); minY = Math.min(minY, o.y); maxX = Math.max(maxX, o.x + b.w * 16); maxY = Math.max(maxY, o.y + b.h * 16);
    pieces.push({ b, o, px, w: b.w * 16, h: b.h * 16 });
  });
  if (!pieces.length) return null;
  const W = maxX - minX, H = maxY - minY, img = new Uint8Array(W * H).fill(15), palIdx = new Uint8Array(W * H), pals = new Set();
  for (const pc of pieces) {
    pals.add(pc.b.pal);
    for (const { tx, ty, t } of pc.px) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const pen = t[y * 16 + x]; if (pen === 15) continue;
      let lx = tx * 16 + x, ly = ty * 16 + y;
      if (pc.b.flipX) lx = pc.w - 1 - lx;
      if (pc.b.flipY) ly = pc.h - 1 - ly;
      const q = (pc.o.y + ly - minY) * W + (pc.o.x + lx - minX);
      img[q] = pen; palIdx[q] = pc.b.pal;
    }
  }
  return { w: W, h: H, ox: -minX, oy: -minY, pixels: img, palIdx, pals: [...pals] };
}

// Object palette sets: 32 palettes x 16 RGB444 words, one set per 0x1000 bytes.
// pal 0 Jack, 1 Hannah, 2 Mustapha, 3 Mess, 6 weapons, 7 food.
function paletteSet(s = 0) {
  const base = PAL_TABLE + s * 0x1000, pal = [];
  for (let p = 0; p < 32; p++) {
    const row = [];
    for (let k = 0; k < 16; k++) { const w = u16(base + p * 32 + k * 2); row.push([((w >> 8) & 15) * 17, ((w >> 4) & 15) * 17, (w & 15) * 17]); }
    pal.push(row);
  }
  return pal;
}

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
function readPNG(buf) {
  let p = 8, w = 0, h = 0, bpp = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); const ct = data[9]; bpp = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 0; if (!bpp) throw new Error('unsupported PNG'); }
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(w * h * 4); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { out[(y * w + x) * 4] = line[x * bpp]; out[(y * w + x) * 4 + 1] = line[x * bpp + (bpp >= 3 ? 1 : 0)]; out[(y * w + x) * 4 + 2] = line[x * bpp + (bpp >= 3 ? 2 : 0)]; out[(y * w + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255; }
    prev = line;
  }
  return { w, h, data: out };
}

// Render a record to RGBA with the ROM palettes.
function recordRGBA(i, set = 0, opts) {
  const im = render(parseRecord(i), opts); if (!im) return null;
  const pal = paletteSet(set), rgba = new Uint8Array(im.w * im.h * 4);
  for (let q = 0; q < im.w * im.h; q++) {
    const pen = im.pixels[q]; if (pen === 15) continue;
    const c = pal[im.palIdx[q]][pen]; rgba[q * 4] = c[0]; rgba[q * 4 + 1] = c[1]; rgba[q * 4 + 2] = c[2]; rgba[q * 4 + 3] = 255;
  }
  return { ...im, rgba };
}

module.exports = { DIR, prg, gfx, u16, u32, s16, tile, parseRecord, render, paletteSet, recordRGBA, writePNG, readPNG, REC_TABLE, REC_COUNT, LAY_TABLE, LAY_COUNT, PAL_TABLE };
