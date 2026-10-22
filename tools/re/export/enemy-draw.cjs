// Rendering helpers for the enemy export (research only): ROM records -> RGBA with record or override palettes,
// composites, shelf-packed atlases, and labelled contact sheets. Art stays in its native LEFT-facing orientation.
'use strict';
const R = require('../rom.cjs');

const PAL = R.paletteSet(0);   // ROM palette set 0 at 0xB7A52, brightness F (H06; checked per run against live RAM)
// ROM palette #n (0xB7A52 + n*32), brightness F, as 16 RGB triples
const romPalCache = new Map();
function romPalette(n) {
  if (!romPalCache.has(n)) romPalCache.set(n, Array.from({ length: 16 }, (_, k) => { const w = R.u16(R.PAL_TABLE + n * 32 + k * 2); return [((w >> 8) & 15) * 17, ((w >> 4) & 15) * 17, (w & 15) * 17]; }));
  return romPalCache.get(n);
}
const IDENTITY = Array.from({ length: 32 }, (_, k) => k);

// record -> {w, h, ox, oy, rgba, pals}; palOverride = 5-bit OBJ palette slot that replaces every block's (obj+0x23
// bit 7, V04); slotMap = the stage/area OBJ palette map (slot k holds ROM palette #slotMap[k], loader 0x8E4C)
function recordImage(rec, palOverride = null, slotMap = IDENTITY) {
  const r = R.parseRecord(rec); if (!r) return null;
  const im = R.render(r, { dropShadows: false }); if (!im) return null;
  const rgba = new Uint8Array(im.w * im.h * 4), pals = new Set();
  for (let q = 0; q < im.w * im.h; q++) {
    const pen = im.pixels[q]; if (pen === 15) continue;
    const p = palOverride === null ? im.palIdx[q] : palOverride; pals.add(p);
    const c = romPalette(slotMap[p])[pen]; rgba[q * 4] = c[0]; rgba[q * 4 + 1] = c[1]; rgba[q * 4 + 2] = c[2]; rgba[q * 4 + 3] = 255;
  }
  return { rec, w: im.w, h: im.h, ox: im.ox, oy: im.oy, rgba, pals: [...pals].sort((a, b) => a - b), recordPals: [...new Set(r.blocks.map(b => b.pal))].sort((a, b) => a - b), blocks: r.count };
}

function blit(dst, DW, DH, src, sw, sh, x0, y0, { flip = false, alphaOnly = false } = {}) {
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const sq = (y * sw + (flip ? sw - 1 - x : x)) * 4; if (!src[sq + 3]) continue;
    const X = x0 + x, Y = y0 + y; if (X < 0 || Y < 0 || X >= DW || Y >= DH) continue;
    const dq = (Y * DW + X) * 4; dst[dq] = src[sq]; dst[dq + 1] = src[sq + 1]; dst[dq + 2] = src[sq + 2]; dst[dq + 3] = alphaOnly ? dst[dq + 3] : 255;
  }
}

// shelf packing; items [{key, w, h, ...}] -> sets x, y; returns {W, H}
function pack(items, maxW = 1024, pad = 1) {
  const order = [...items].sort((a, b) => b.h - a.h || b.w - a.w || String(a.key).localeCompare(String(b.key)));
  let x = 0, y = 0, rowH = 0, W = 0;
  for (const it of order) {
    if (x + it.w + pad > maxW && x > 0) { y += rowH + pad; x = 0; rowH = 0; }
    it.x = x; it.y = y; x += it.w + pad; rowH = Math.max(rowH, it.h); W = Math.max(W, x);
  }
  return { W: Math.max(1, W), H: Math.max(1, y + rowH) };
}

function buildAtlas(entries, file) {   // entries [{key, rec, pal, map}] (pal null = record palettes)
  const items = [];
  for (const e of entries) { const im = recordImage(e.rec, e.pal, e.map || IDENTITY); if (im) items.push({ ...e, w: im.w, h: im.h, ox: im.ox, oy: im.oy, im }); }
  const { W, H } = pack(items);
  const img = new Uint8Array(W * H * 4);
  for (const it of items) blit(img, W, H, it.im.rgba, it.w, it.h, it.x, it.y);
  R.writePNG(file, W, H, img);
  return { W, H, frames: items.map(it => ({ key: it.key, rec: it.rec, pal: it.pal, x: it.x, y: it.y, w: it.w, h: it.h, ox: it.ox, oy: it.oy, recordPalettes: it.im.recordPals, romPalettes: it.im.pals.map(p => (it.map || IDENTITY)[p]) })) };
}

// 3x5 pixel font for labels
const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
  4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
  '-': '000000111000000', '.': '000000000000010', ':': '000010000010000', '/': '001001010100100', '+': '000010111010000',
  '(': '010100100100010', ')': '010001001001010', '#': '101111101111101', '_': '000000000000111', '>': '100010001010100',
  '?': '111001010000010', '!': '010010010000010', ',': '000000000010100', '=': '000111000111000', "'": '010010000000000', '&': '010101010101011',
};
function text(img, W, H, s, x, y, c, scale = 1) {
  [...String(s).toUpperCase()].forEach((ch, k) => {
    const g = GLYPHS[ch]; if (!g) return;
    for (let i = 0; i < 15; i++) if (g[i] === '1') for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) {
      const X = x + (k * 4 + (i % 3)) * scale + a, Y = y + Math.floor(i / 3) * scale + b;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const q = (Y * W + X) * 4; img[q] = c[0]; img[q + 1] = c[1]; img[q + 2] = c[2]; img[q + 3] = 255;
    }
  });
}
function rect(img, W, H, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue; const q = (y * W + x) * 4; img[q] = c[0]; img[q + 1] = c[1]; img[q + 2] = c[2]; img[q + 3] = 255;
  }
}

// one animation frame (plain, second record, or composite) composed around the feet origin; returns {minX, minY, w, h, rgba}
function frameImage(f, palOverride = null, slotMap = IDENTITY) {
  const parts = f.composite ? (f.parts || []).map(p => ({ rec: p.rec, dx: p.dx, dy: -p.dy })) : [{ rec: f.rec, dx: 0, dy: 0 }, ...(f.rec2 != null ? [{ rec: f.rec2, dx: 0, dy: 0 }] : [])];
  const ims = parts.map(p => ({ p, im: recordImage(p.rec, palOverride, slotMap) })).filter(o => o.im);
  if (!ims.length) return null;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const { p, im } of ims) { minX = Math.min(minX, p.dx - im.ox); minY = Math.min(minY, p.dy - im.oy); maxX = Math.max(maxX, p.dx - im.ox + im.w); maxY = Math.max(maxY, p.dy - im.oy + im.h); }
  const w = maxX - minX, h = maxY - minY, rgba = new Uint8Array(w * h * 4);
  // the first drawn part is on top (CPS-1 priority: earlier OBJ entries win), so blit in reverse
  for (const { p, im } of [...ims].reverse()) blit(rgba, w, h, im.rgba, im.w, im.h, p.dx - im.ox - minX, p.dy - im.oy - minY);
  return { minX, minY, w, h, rgba };
}

// contact sheet: rows [{title, frames:[{f, caption}]}]
function contactSheet(rows, file, { cellW = 120, cellH = 128, maxCols = 12, title = '' } = {}) {
  const labelW = 150, headH = title ? 14 : 0;
  const cols = Math.min(maxCols, Math.max(1, ...rows.map(r => r.frames.length)));
  const lines = rows.map(r => Math.max(1, Math.ceil(r.frames.length / cols)));
  const W = labelW + cols * cellW, H = headH + lines.reduce((a, b) => a + b, 0) * cellH;
  const img = new Uint8Array(W * H * 4);
  rect(img, W, H, 0, 0, W, H, [38, 42, 50]);
  if (title) text(img, W, H, title, 4, 4, [255, 230, 140], 2);
  let y = headH;
  rows.forEach((r, ri) => {
    const nl = lines[ri];
    rect(img, W, H, 0, y, W, 1, [90, 96, 110]);
    String(r.title).split('\n').forEach((ln, k) => text(img, W, H, ln, 4, y + 4 + k * 8, k ? [190, 200, 215] : [255, 255, 140]));
    r.frames.forEach((fr, i) => {
      const cx = labelW + (i % cols) * cellW, cy = y + Math.floor(i / cols) * cellH;
      rect(img, W, H, cx, cy, 1, cellH, [70, 74, 84]);
      const fx = cx + Math.floor(cellW / 2), fy = cy + cellH - 14;
      if (fr.img) blit(img, W, H, fr.img.rgba, fr.img.w, fr.img.h, fx + fr.img.minX, fy + fr.img.minY);
      for (let d = -3; d <= 3; d++) { rect(img, W, H, fx + d, fy, 1, 1, [255, 0, 255]); rect(img, W, H, fx, fy + d, 1, 1, [255, 0, 255]); }
      text(img, W, H, fr.caption || '', cx + 3, cy + cellH - 9, [200, 230, 255]);
    });
    y += nl * cellH;
  });
  R.writePNG(file, W, H, img);
  return { W, H };
}

module.exports = { PAL, IDENTITY, romPalette, recordImage, buildAtlas, frameImage, contactSheet, text, rect, blit, pack };
