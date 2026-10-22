// Shared decode/render helpers for the boss & dinosaur export (tools/re/export/bosses.cjs).
// Research tooling only; reads the user's ROM through tools/re/rom.cjs and never writes outside work/.
//
// Facts relied on (tools/re/MEMORY-MAP.md): V04 (draw: rec2 at the same origin, composite part list at fp+2+w1,
// uniform-attribute records use the record's attr word for every block), V13 (10-byte frames, bit 7 of byte 7 = last
// frame, the following word is a self-relative loop offset), V14 (records stored x4), H06 (OBJ palettes = ROM
// palette set at 0xB7A52 at brightness F).
'use strict';
const R = require('../rom.cjs');

const N_REC = R.REC_COUNT;

// ---------- records ----------
// rom.cjs parseRecord gives uniform-attribute records (flags bit 15 clear) palette 0. The draw code (0x14294 path,
// see tools/re/verify-live/drawmodel.cjs) uses the record's flags word as the attr of every block, so the palette is
// flags & 0x1F and the block is 1x1.
const recCache = new Map();
function rec(i) {
  if (recCache.has(i)) return recCache.get(i);
  let r = null;
  if (i >= 0 && i < N_REC) {
    r = R.parseRecord(i);
    if (r && !(r.flags & 0x8000)) r.blocks = r.blocks.map(b => ({ ...b, attr: r.flags, pal: r.flags & 31, flipX: !!(r.flags & 0x20), flipY: !!(r.flags & 0x40) }));
  }
  recCache.set(i, r);
  return r;
}

// Draw one record into an indexed canvas. canvas: {pen:Uint8Array, pal:Uint8Array, w, h, ox, oy} with (ox,oy) the
// frame origin (feet). (dx, dy) = part offset in screen pixels (x right, y down), native left-facing orientation.
// palOverride: -1 = record palettes, else 0..31 (obj+0x23 bit 7 semantics).
function recBounds(i, dx = 0, dy = 0, { dropShadows = false } = {}) {
  const r = rec(i); if (!r || !r.offs.length) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  r.blocks.forEach((b, k) => {
    const o = r.offs[k]; if (!o) return;
    if (dropShadows && isShadowBlock(b)) return;
    x0 = Math.min(x0, o.x + dx); y0 = Math.min(y0, o.y + dy); x1 = Math.max(x1, o.x + dx + b.w * 16); y1 = Math.max(y1, o.y + dy + b.h * 16);
  });
  return x0 > x1 ? null : { x0, y0, x1, y1 };
}
function isShadowBlock(b) {
  for (let ty = 0; ty < b.h; ty++) for (let tx = 0; tx < b.w; tx++) { const t = R.tile(b.code + tx + ty * 16); for (let q = 0; q < 256; q++) if (t[q] !== 0 && t[q] !== 15) return false; }
  return true;
}
// Blocks are drawn so that earlier blocks end up on top (CPS-1: entry 0 has priority; the game writes a record's
// blocks in order, so block 0 is in front). We paint from the last block to the first.
function paintRec(cv, i, dx, dy, palOverride = -1, { dropShadows = false } = {}) {
  const r = rec(i); if (!r) return;
  for (let k = r.blocks.length - 1; k >= 0; k--) {
    const b = r.blocks[k], o = r.offs[k]; if (!o) continue;
    if (dropShadows && isShadowBlock(b)) continue;
    const pal = palOverride >= 0 ? palOverride : b.pal;
    for (let ty = 0; ty < b.h; ty++) for (let tx = 0; tx < b.w; tx++) {
      const t = R.tile(b.code + tx + ty * 16);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const pen = t[y * 16 + x]; if (pen === 15) continue;
        let lx = tx * 16 + x, ly = ty * 16 + y;
        if (b.flipX) lx = b.w * 16 - 1 - lx;
        if (b.flipY) ly = b.h * 16 - 1 - ly;
        const X = cv.ox + dx + o.x + lx, Y = cv.oy + dy + o.y + ly;
        if (X < 0 || Y < 0 || X >= cv.w || Y >= cv.h) continue;
        const q = Y * cv.w + X; cv.pen[q] = pen; cv.pal[q] = pal; cv.set[q] = 1;
      }
    }
  }
}
function canvas(b) { const w = b.x1 - b.x0, h = b.y1 - b.y0; return { w, h, ox: -b.x0, oy: -b.y0, pen: new Uint8Array(w * h), pal: new Uint8Array(w * h), set: new Uint8Array(w * h) }; }
function toRGBA(cv, palettes) {
  const out = new Uint8Array(cv.w * cv.h * 4);
  for (let q = 0; q < cv.w * cv.h; q++) { if (!cv.set[q]) continue; const c = palettes[cv.pal[q]][cv.pen[q]]; out[q * 4] = c[0]; out[q * 4 + 1] = c[1]; out[q * 4 + 2] = c[2]; out[q * 4 + 3] = 255; }
  return out;
}
// One record -> {w,h,ox,oy,rgba,pals}
function renderRecord(i, palettes, palOverride = -1, opts = {}) {
  const b = recBounds(i, 0, 0, opts); if (!b) return null;
  const cv = canvas(b); paintRec(cv, i, 0, 0, palOverride, opts);
  const pals = new Set(); rec(i).blocks.forEach(bl => pals.add(palOverride >= 0 ? palOverride : bl.pal));
  return { w: cv.w, h: cv.h, ox: cv.ox, oy: cv.oy, rgba: toRGBA(cv, palettes), pals: [...pals] };
}
// A whole animation frame: list of {rec, dx, dy} (dy screen-down). The first part is in front (drawn first).
function renderParts(parts, palettes, palOverride = -1, opts = {}) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of parts) { const b = recBounds(p.rec, p.dx, p.dy, opts); if (!b) continue; x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  if (x0 > x1) return null;
  const cv = canvas({ x0, y0, x1, y1 });
  for (let k = parts.length - 1; k >= 0; k--) paintRec(cv, parts[k].rec, parts[k].dx, parts[k].dy, palOverride, opts);
  return { w: cv.w, h: cv.h, ox: cv.ox, oy: cv.oy, rgba: toRGBA(cv, palettes) };
}

// ---------- palettes ----------
// ROM palette sets at 0xB7A52 (0x1000 bytes each = 128 palettes? no: 32 palettes x 16 words = 0x400 bytes used).
// MAME colour for brightness F: n*17 (H06).
function romPalette(set, p) { return R.paletteSet(set)[p]; }
function palettesFromLive(hex) { // 32 palettes x 16 BRGB words, big-endian hex (dump.palette)
  const out = [];
  for (let p = 0; p < 32; p++) { const row = []; for (let k = 0; k < 16; k++) { const w = parseInt(hex.substr((p * 16 + k) * 4, 4), 16); const B = (w >> 12) & 15, f = v => Math.floor(v * 0x11 * (0x0F + 2 * B) / 0x2D); row.push([f((w >> 8) & 15), f((w >> 4) & 15), f(w & 15)]); } out.push(row); }
  return out;
}

// ---------- animation sets (V13) ----------
function isFrameSane(a) {
  if (a <= 0 || a + 12 > R.prg.length) return false;
  const w0 = R.u16(a), w1 = R.u16(a + 2), b7 = R.prg[a + 7];
  if (w0 & 0x8000) { const pl = a + 2 + R.s16(a + 2); if (pl <= 0 || pl + 2 > R.prg.length) return false; const c = R.u16(pl); if (c > 31) return false; return (b7 & 0x7f) > 0 || !!(b7 & 0x80); }
  if ((w0 & 3) || (w0 >> 2) >= N_REC) return false;
  if (!(w1 & 0x8000) && ((w1 & 3) || (w1 >> 2) >= N_REC)) return false;
  return true;
}
function decodeParts(addr) {
  const n = R.u16(addr) + 1, parts = []; let a = addr + 2;
  for (let k = 0; k < n && k < 32; k++) { parts.push({ dx: R.s16(a), dy: R.s16(a + 2), rec: R.u16(a + 4) >> 2, flag: R.u16(a + 6) }); a += 8; }
  return parts;
}
// Decode one animation starting at addr. Returns {frames, loopTo, loopIndex, ok}.
function decodeAnim(start, size = 10) {
  const frames = []; let a = start, loopTo = null, ok = true;
  for (let guard = 0; guard < 96; guard++) {
    if (!isFrameSane(a)) { ok = false; break; }
    const w0 = R.u16(a), w1 = R.u16(a + 2), b7 = R.prg[a + 7];
    const f = { addr: a, w0, w1, b4: R.prg[a + 4], b5: R.prg[a + 5], b6: R.prg[a + 6], dur: b7 & 0x7f, end: !!(b7 & 0x80), w8: R.u16(a + 8) };
    if (w0 & 0x8000) { f.comp = true; f.partsAt = a + 2 + R.s16(a + 2); f.parts = decodeParts(f.partsAt); f.hitRec = (w0 & 0x7fff) >> 2; }
    else { f.rec = w0 >> 2; f.rec2 = (w1 & 0x8000) ? null : w1 >> 2; }
    frames.push(f); a += size;
    if (b7 & 0x80) { loopTo = a + R.s16(a); break; }
  }
  let loopIndex = null;
  if (loopTo != null) { const k = frames.findIndex(f => f.addr === loopTo); loopIndex = k >= 0 ? k : null; }
  if (loopTo == null) ok = false;
  return { frames, loopTo, loopIndex, ok };
}
// A set is a table of signed self-relative... no: offsets relative to the table start (driver 0x120E: A0 = set,
// D0*2 -> offset word, A0 += offset). The table length is not stored; we take entries until the first offset that
// points into the table itself or decodes to a broken animation.
function decodeSet(T, size = 10, max = 160) {
  const anims = []; let tableEnd = Infinity;
  if (!T || T + 2 > R.prg.length) return anims;
  for (let k = 0; k < max; k++) {
    const pos = T + k * 2; if (pos >= tableEnd || pos + 2 > R.prg.length) break;
    const off = R.s16(pos), start = T + off;
    if (start <= 0 || start + 10 > R.prg.length) { if (k === 0) break; continue; }
    if (off > 0) tableEnd = Math.min(tableEnd, start);
    if (start >= T && start < T + (k + 1) * 2) break;
    const an = decodeAnim(start, size);
    if (!an.ok || !an.frames.length) { if (k === 0) break; anims.push({ index: k, addr: start, bad: true, frames: [] }); continue; }
    anims.push({ index: k, addr: start, ...an });
  }
  while (anims.length && anims[anims.length - 1].bad) anims.pop();
  return anims;
}

// ---------- tiny bitmap font for sheets ----------
const FONT = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111',
  'A': '010101111101101', 'B': '110101110101110', 'C': '011100100100011', 'D': '110101101101110', 'E': '111100110100111', 'F': '111100110100100', 'G': '011100101101011', 'H': '101101111101101', 'I': '111010010010111', 'J': '001001001101010', 'K': '101101110101101', 'L': '100100100100111', 'M': '101111111101101', 'N': '110101101101101', 'O': '010101101101010', 'P': '110101110100100', 'Q': '010101101110011', 'R': '110101110101101', 'S': '011100010001110', 'T': '111010010010010', 'U': '101101101101111', 'V': '101101101101010', 'W': '101101111111101', 'X': '101101010101101', 'Y': '101101010010010', 'Z': '111001010100111',
  '-': '000000111000000', '+': '000010111010000', '.': '000000000000010', ':': '000010000010000', '/': '001001010100100', '_': '000000000000111', '>': '100010001010100', '(': '010100100100010', ')': '010001001001010', ' ': '000000000000000', '#': '101111101111101', '=': '000111000111000', '*': '000101010101000', ',': '000000000010100',
};
function makeImage(w, h, bg = [36, 40, 48, 255]) { const d = new Uint8Array(w * h * 4); for (let q = 0; q < w * h; q++) d.set(bg, q * 4); return { w, h, d }; }
function px(img, x, y, c) { if (x < 0 || y < 0 || x >= img.w || y >= img.h) return; const q = (y * img.w + x) * 4; img.d[q] = c[0]; img.d[q + 1] = c[1]; img.d[q + 2] = c[2]; img.d[q + 3] = c[3] === undefined ? 255 : c[3]; }
function text(img, s, x, y, c = [255, 255, 140], scale = 1) {
  [...String(s).toUpperCase()].forEach((ch, k) => { const f = FONT[ch] || FONT[' ']; for (let i = 0; i < 15; i++) if (f[i] === '1') for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) px(img, x + (k * 4 + (i % 3)) * scale + a, y + Math.floor(i / 3) * scale + b, c); });
}
function blit(img, src, sw, sh, x, y) { for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) { const q = (j * sw + i) * 4; if (!src[q + 3]) continue; px(img, x + i, y + j, [src[q], src[q + 1], src[q + 2], 255]); } }

// ---------- atlas packing (shelf) ----------
function packShelves(items, maxW = 1024, pad = 1) { // items: {w,h,...} -> sets x,y; returns {w,h}
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  let x = pad, y = pad, rowH = 0, W = 0;
  for (const it of sorted) {
    if (x + it.w + pad > maxW) { x = pad; y += rowH + pad; rowH = 0; }
    it.x = x; it.y = y; x += it.w + pad; rowH = Math.max(rowH, it.h); W = Math.max(W, x);
  }
  return { w: Math.max(W, 1), h: y + rowH + pad };
}

module.exports = { R, rec, recBounds, renderRecord, renderParts, paintRec, romPalette, palettesFromLive, decodeSet, decodeAnim, decodeParts, isFrameSane, makeImage, px, text, blit, packShelves, FONT };
