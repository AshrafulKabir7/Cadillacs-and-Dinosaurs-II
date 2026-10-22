// CPS-1 scroll-layer decoder for harness dumps of the original Cadillacs & Dinosaurs (MAME "dino").
// Research tooling only. Follows MAME's cps1 video code (cps1_v.cpp), every point re-checked by rendering against
// MAME snapshots (tools/re/export/stages.cjs validate):
//   CPS-A regs (word index): 0 OBJ base, 1/2/3 scroll1/2/3 base, 4 "other" (rowscroll) base, 5 palette base,
//     6/7 scroll1 x/y, 8/9 scroll2 x/y, 10/11 scroll3 x/y, 16 rowscroll offset, 17 video control
//     (bit 0 = scroll2 rowscroll enable, bits 1-3 = scroll1/2/3 enable as written by this game).
//   Tilemaps: 64 x 64 tiles, 2 words per tile (code, attr), 0x4000 bytes.
//     scroll1  8x8   512x512   offset = (row & 0x1f) + (col << 5) + ((row & 0x20) << 6)
//     scroll2 16x16 1024x1024  offset = (row & 0x0f) + (col << 4) + ((row & 0x30) << 6)
//     scroll3 32x32 2048x2048  offset = (row & 0x07) + (col << 3) + ((row & 0x38) << 6)
//   attr: bits 0-4 palette (page 1/2/3 for scroll1/2/3), bit 5 flipX, bit 6 flipY, bits 7-8 priority group;
//     bits 9-15 are not used by the video hardware (the game stores its own data there).
//   Graphics: code units are 64 bytes (one 8x8 tile). scroll1 code c -> bytes c*64, the left half of each 8-byte row
//     for even tilemap columns, the right half for odd columns. scroll2 code c -> bytes c*128 (16x16, the OBJ tile
//     format). scroll3 code (c & 0x3fff) -> bytes c*512 (32x32: 16 bytes per row, 4 groups of 4 bitplane bytes).
//     Gfx bank mapper CD63B (MAME master cps1_v.cpp mapper_CD63B_table, "verified from PAL dump"): two ranges for all
//     gfx types, 0x00000-0x07FFF bank 0 and 0x08000-0x0FFFF bank 1 in 8x8-tile units (code << 0/1/1/3 for
//     scroll1/OBJ/scroll2/scroll3), bank sizes 0x8000 each: the identity over the whole 4 MB for every layer.
//   Screen: visible 384x224 = bitmap (64..447, 16..239); tilemap x = bitmap x + scrollX, y = bitmap y + scrollY.
//   Rowscroll (scroll2 only, video control bit 0): bitmap row i uses scrollX + other[(i + rowscrollOffset) & 0x3ff].
//   Palettes: 6 pages of 32 x 16 BRGB words (OBJ, scroll1, scroll2, scroll3, stars1, stars2), MAME colour formula.
//   CPS-B (this game, as written by the program): word 0x0A layer control (bits 6-13 = draw order bottom..top,
//     0 sprites 1 scroll1 2 scroll2 3 scroll3; low bits = layer enables), word 0x04 palette control (page mask),
//     priority pen masks for groups 0-3 at words 0x0C, 0x0E, 0x00, 0x02 (pens in the mask cover sprites).
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../../rom.cjs');

const RUNS = path.resolve(__dirname, '../../../../work/re/runs');
const LAYER = {
  1: { tile: 8, size: 512, page: 1, shift: 0 },
  2: { tile: 16, size: 1024, page: 2, shift: 1 },
  3: { tile: 32, size: 2048, page: 3, shift: 3 },
};
// CD63B ranges in 8x8-tile units (all gfx types): [start, end, bank]; bank bases 0 and 0x8000
const CD63B = [[0x0000, 0x7fff, 0], [0x8000, 0xffff, 1]], BANK_SIZES = [0x8000, 0x8000];
const CPSB = { layerControl: 0x0a, paletteControl: 0x04, priority: [0x0c, 0x0e, 0x00, 0x02] };
const SCREEN = { w: 384, h: 224, x0: 64, y0: 16 };

function scanOffset(layer, col, row) {
  if (layer === 1) return (row & 0x1f) + ((col & 0x3f) << 5) + ((row & 0x20) << 6);
  if (layer === 2) return (row & 0x0f) + ((col & 0x3f) << 4) + ((row & 0x30) << 6);
  return (row & 0x07) + ((col & 0x3f) << 3) + ((row & 0x38) << 6);
}

// gfx bank mapper CD63B as MAME's gfxrom_bank_mapper applies it: the code in 8x8-tile units (code << shift) is looked
// up in the ranges and mapped to bank base + (code & (bank size - 1)); with the CD63B table this is the identity.
// Returns the code to use with the layer's own tile size, or -1 (no range matched: draws nothing)
function mapCode(layer, code) {
  const L = LAYER[layer];
  if (layer === 3) code &= 0x3fff;
  const u = code << L.shift;
  for (const [a, b, bank] of CD63B) if (u >= a && u <= b) { let base = 0; for (let i = 0; i < bank; i++) base += BANK_SIZES[i]; return (base + (u & (BANK_SIZES[bank] - 1))) >> L.shift; }
  return -1;
}

// decoded tiles: Uint8Array(tile*tile) of pens (15 = transparent)
const cache = { 1: new Map(), 2: new Map(), 3: new Map() };
function tilePens(layer, code, half) {
  const key = layer === 1 ? code * 2 + half : code, c = cache[layer];
  if (c.has(key)) return c.get(key);
  const g = R.gfx; let out;
  if (layer === 2) out = R.tile(code);
  else if (layer === 1) {
    out = new Uint8Array(64); const base = code * 64 + half * 4;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      let pen = 0; for (let p = 0; p < 4; p++) pen |= ((g[base + y * 8 + p] >> (7 - x)) & 1) << p;
      out[y * 8 + x] = pen;
    }
  } else {
    out = new Uint8Array(1024); const base = code * 512;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      let pen = 0; for (let p = 0; p < 4; p++) pen |= ((g[base + y * 16 + (x >> 3) * 4 + p] >> (7 - (x & 7))) & 1) << p;
      out[y * 32 + x] = pen;
    }
  }
  c.set(key, out);
  return out;
}

function palWordRGB(w) {
  const bright = 0x0f + ((w >> 12) << 1);
  return [((w >> 8) & 15) * 0x11 * bright / 0x2d | 0, ((w >> 4) & 15) * 0x11 * bright / 0x2d | 0, (w & 15) * 0x11 * bright / 0x2d | 0];
}
// full brightness (the ROM palette sets are stored at brightness F; fades only change the brightness nibble)
function palWordRGBFull(w) { return palWordRGB(w | 0xf000); }

// hex palette dump (dump.allPalettes) -> pages[6][32][16] of [r,g,b] (and the raw words)
function palettePages(hex, { full = false } = {}) {
  const pages = [], words = [];
  const n = Math.floor(hex.length / 4);
  for (let i = 0; i < n; i++) words.push(parseInt(hex.slice(i * 4, i * 4 + 4), 16));
  for (let pg = 0; pg < 6; pg++) {
    const P = [];
    for (let p = 0; p < 32; p++) {
      const row = [];
      for (let c = 0; c < 16; c++) { const w = words[pg * 512 + p * 16 + c] || 0; row.push(full ? palWordRGBFull(w) : palWordRGB(w)); }
      P.push(row);
    }
    pages.push(P);
  }
  return { pages, words };
}

// One dumped frame of a run (dump.scroll + dump.allPalettes + cpsA) -> decoder input
function loadFrame(run, frame) {
  const dir = path.join(RUNS, run), s = frame.scroll;
  if (!s) throw new Error(`${run} f${frame.f}: no scroll dump`);
  const rd = f => fs.readFileSync(path.join(dir, f));
  return {
    f: frame.f, mf: frame.mf, cpsA: frame.cpsA, cpsB: frame.cpsB,
    maps: { 1: rd(s.s1.file), 2: rd(s.s2.file), 3: rd(s.s3.file) }, other: rd(s.rowscroll.file),
    pal: frame.pal ? palettePages(frame.pal) : null, palHex: frame.pal || null, frame,
  };
}

function regs(F) {
  const a = F.cpsA, b = F.cpsB || [];
  const lc = b[CPSB.layerControl / 2] || 0;
  return {
    s: { 1: { x: a[6], y: a[7] }, 2: { x: a[8], y: a[9] }, 3: { x: a[10], y: a[11] } },
    rowscrollOffs: a[16], video: a[17], rowscroll: !!(a[17] & 1),
    layerControl: lc, order: [(lc >> 6) & 3, (lc >> 8) & 3, (lc >> 10) & 3, (lc >> 12) & 3],
    paletteControl: b[CPSB.paletteControl / 2] || 0,
    priority: CPSB.priority.map(o => b[o / 2] || 0),
  };
}

function tileEntry(F, layer, col, row) {
  const o = scanOffset(layer, col, row) * 4, m = F.maps[layer];
  return { code: m.readUInt16BE(o), attr: m.readUInt16BE(o + 2) };
}

// Render a whole tilemap: {w, h, pen (Uint8Array, 15 = transparent), pal (palette 0-31), group, rgba}
function renderTilemap(F, layer, { pages = null, rgba = true } = {}) {
  const L = LAYER[layer], N = L.size, T = L.tile, pen = new Uint8Array(N * N).fill(15), pal = new Uint8Array(N * N), grp = new Uint8Array(N * N);
  for (let row = 0; row < 64; row++) for (let col = 0; col < 64; col++) {
    const e = tileEntry(F, layer, col, row), code = mapCode(layer, e.code);
    if (code < 0) continue;
    const t = tilePens(layer, code, col & 1), fx = e.attr & 0x20, fy = e.attr & 0x40, p = e.attr & 31, g = (e.attr >> 7) & 3;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const v = t[(fy ? T - 1 - y : y) * T + (fx ? T - 1 - x : x)];
      const q = (row * T + y) * N + col * T + x;
      pen[q] = v; pal[q] = p; grp[q] = g;
    }
  }
  const out = { layer, w: N, h: N, pen, pal, grp };
  if (rgba && (pages || F.pal)) out.rgba = toRGBA(out, (pages || F.pal.pages)[L.page]);
  return out;
}

function toRGBA(img, page) {
  const n = img.w * img.h, rgba = new Uint8Array(n * 4);
  for (let q = 0; q < n; q++) {
    const v = img.pen[q]; if (v === 15) continue;
    const c = page[img.pal[q]][v]; rgba[q * 4] = c[0]; rgba[q * 4 + 1] = c[1]; rgba[q * 4 + 2] = c[2]; rgba[q * 4 + 3] = 255;
  }
  return rgba;
}

// The visible 384x224 window of one layer, as MAME draws it: {pen, pal, grp, tx, ty} per screen pixel
// (tx, ty = tilemap pixel shown there).
function screenLayer(F, layer, full = null) {
  const L = LAYER[layer], N = L.size, Rg = regs(F), sx = Rg.s[layer].x, sy = Rg.s[layer].y;
  const T = full || renderTilemap(F, layer, { rgba: false });
  const W = SCREEN.w, H = SCREEN.h, pen = new Uint8Array(W * H).fill(15), pal = new Uint8Array(W * H), grp = new Uint8Array(W * H);
  const tx = new Int32Array(W * H), ty = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    const by = y + SCREEN.y0, my = (by + sy) & (N - 1);
    let xs = sx;
    if (layer === 2 && Rg.rowscroll) xs = (sx + F.other.readUInt16BE(((by + Rg.rowscrollOffs) & 0x3ff) * 2)) & 0xffff;
    for (let x = 0; x < W; x++) {
      const mx = (x + SCREEN.x0 + xs) & (N - 1), s = my * N + mx, q = y * W + x;
      pen[q] = T.pen[s]; pal[q] = T.pal[s]; grp[q] = T.grp[s]; tx[q] = mx; ty[q] = my;
    }
  }
  return { layer, w: W, h: H, pen, pal, grp, tx, ty };
}

// Composite the screen as MAME's cps1 screen_update does: background pen 0xBFF, layers in layer-control order,
// sprites masked by the high-priority pens of the layer right below them.
// opts.sprites: OBJ render {rgba} (obj.cjs renderObj of the OBJ dump one frame earlier) or null.
// opts.layers: subset of [1,2,3] to draw (default all enabled ones).
function composite(F, { sprites = null, layers = [1, 2, 3], pages = null } = {}) {
  const Rg = regs(F), P = pages || F.pal.pages, W = SCREEN.w, H = SCREEN.h, rgba = new Uint8Array(W * H * 4);
  const bg = palWordRGB(F.pal.words[0xbff] || 0);
  for (let q = 0; q < W * H; q++) { rgba[q * 4] = bg[0]; rgba[q * 4 + 1] = bg[1]; rgba[q * 4 + 2] = bg[2]; rgba[q * 4 + 3] = 255; }
  const scr = {}; for (const l of [1, 2, 3]) scr[l] = screenLayer(F, l);
  const mask = new Uint8Array(W * H); let masked = 0;
  const drawLayer = l => {
    if (l === 0) {
      if (!sprites) return;
      for (let q = 0; q < W * H; q++) if (sprites.rgba[q * 4 + 3] === 255) { if (mask[q]) { masked++; continue; } rgba[q * 4] = sprites.rgba[q * 4]; rgba[q * 4 + 1] = sprites.rgba[q * 4 + 1]; rgba[q * 4 + 2] = sprites.rgba[q * 4 + 2]; }
      return;
    }
    if (!layers.includes(l)) return;
    const S = scr[l], page = P[LAYER[l].page];
    for (let q = 0; q < W * H; q++) {
      const v = S.pen[q]; if (v === 15) continue;
      const c = page[S.pal[q]][v]; rgba[q * 4] = c[0]; rgba[q * 4 + 1] = c[1]; rgba[q * 4 + 2] = c[2];
    }
  };
  const highMask = l => {
    if (l === 0 || !layers.includes(l)) return;
    const S = scr[l];
    for (let q = 0; q < W * H; q++) { const v = S.pen[q]; if (v !== 15 && (Rg.priority[S.grp[q]] >> v) & 1) mask[q] = 1; }
  };
  const o = Rg.order;
  drawLayer(o[0]); if (o[1] === 0) highMask(o[0]);
  drawLayer(o[1]); if (o[2] === 0) highMask(o[1]);
  drawLayer(o[2]); if (o[3] === 0) highMask(o[2]);
  drawLayer(o[3]);
  return { w: W, h: H, rgba, scr, regs: Rg, maskedSpritePixels: masked };
}

function compareRGBA(a, b, w, h) {
  let same = 0; const diff = [];
  for (let q = 0; q < w * h; q++) {
    if (a[q * 4] === b[q * 4] && a[q * 4 + 1] === b[q * 4 + 1] && a[q * 4 + 2] === b[q * 4 + 2]) same++;
    else if (diff.length < 20) diff.push({ x: q % w, y: (q / w) | 0, got: [a[q * 4], a[q * 4 + 1], a[q * 4 + 2]], want: [b[q * 4], b[q * 4 + 1], b[q * 4 + 2]] });
  }
  return { same, total: w * h, agreement: same / (w * h), diff };
}

module.exports = { LAYER, CPSB, SCREEN, RUNS, scanOffset, mapCode, tilePens, palWordRGB, palWordRGBFull, palettePages, loadFrame, regs, tileEntry, renderTilemap, toRGBA, screenLayer, composite, compareRGBA };
