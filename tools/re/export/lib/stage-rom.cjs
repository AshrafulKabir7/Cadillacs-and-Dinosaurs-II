// Static decode of the original Cadillacs & Dinosaurs stage maps from the program ROM (work/re/dino-prg.bin layout,
// read through tools/re/rom.cjs). Research tooling only. Every address below is quoted from the disassembly; see
// tools/re/export/stages.cjs for the evidence ids and the live validation.
//
// Stage controller (scroll2 camera) at 0xFF873C, scroll3 controller at 0xFF87DC. Stage index s = byte 0xFF84D9 (0-7),
// area a = byte 0xFF8786.
//
// scroll2 (playfield, 16x16 tiles)
//   area table   0x21580: long per stage -> 10-byte entries per area: b0 width (blocks, not read by the code),
//                b1 rows (map height in 256-px blocks), long block map, word camera X0, word camera Y0 (0x207CA)
//   block map    words, column-major: block = map[(X >> 8) * rows + (Y >> 8)] (0x214F0); stage 3 wraps X >= 0x4D00
//                by -0xF00 (the endless part of HELL ROAD)
//   block -> 8x8 chunks of 32x32 px: L2 = long[0x2155E + s*4]; chunk = word[L2 + block*128 + cx*16 + (14 - cy*2)]
//                (cx, cy = (X & 0xE0) >> 5, (Y & 0xE0) >> 5; cy = 0 is the bottom chunk) (0x2152C)
//   chunk -> 2x2 tiles: L3 = long[0x21454 + s*4]; 16 bytes at L3 + chunk*16 = (code, attr) longs in the order
//                left-top, left-bottom, right-top, right-bottom (0x2142A)
//   attr bits 10-15 = terrain type read by the collision code (0x1309C, 0x13646: rol #6 & 0x3F), 0 = free floor.
// scroll3 (far background, 32x32 tiles)
//   area table   0x2311E: same 10-byte entry format (0x22CC4)
//   block map    words & 0x7F (0x230BE); stage 3 wraps X >= 0xA00 by -0x100
//   block data   0x177288 + block*256: 8 columns x 8 rows of (code, attr) longs, offset col*32 + (0x1C - row*4)
//                (row 0 = bottom) (0x230F6)
//   parallax     X3 = camX >> shift, shift byte at 0x22DE4 + word[0x22DE4 + s*2] + a (0x22DC6 / 0x22E10);
//                Y3 = y0_3 + ((camY - y0_2) >> shift) when byte[0x22E54 + s*4 + a] != 0, else y0_3; segment state 5
//                (0x22E8C) and 9 (0x22EAE) use their own Y rules.
// World/screen: world X right, world height h up. A map pixel at (X, h) shows at screen x = X - camX,
//   y = camY + 239 - h (scroll2 regs: x = camX - 0x40, y = 0x300 - camY; scroll3: 0x700 - Y3; 0x6C0).
//   A sprite with feet at depth d (height 0) stands at screen y = camY + 240 - d, i.e. on map row h = d.
// Palettes (area start 0x8A44): scroll1 = 0xBBA52 (0x8A8E), scroll2 = long[0x8AE0 + s*16 + a*4] (0x8AAE),
//   scroll3 = long[0x8C52 + s*16 + a*4] (0x8C20), OBJ = 32 palette indices at long[0x8E8E + s*16 + a*4] into 0xB7A52
//   (0x8E4C). ROM words have brightness 0; the fade code (0x87A6..0x88F4) adds 0x1000 steps up to 0xF000.
// Priority masks (0x8D92): words[0x8DEC + s*8] (E7: [0x8DCC + a*8]) -> CPS-B 0x0C, 0x0E, 0x00, 0x02 (groups 0-3).
// Layer control (0x2076A): 0x12D6 (scroll3, scroll2, sprites, scroll1); E7 area 1 uses 0x06D6 (scroll3, scroll2,
//   scroll1, sprites) with scroll1 as an extra background (0x20778: blocks 1 and 2 drawn by 0x205C6).
// Segment script 0x21B2A: word offset per stage, 16-byte segments (0x2099A -> 0x209C0 copies them):
//   +0 camera-X trigger (Y trigger in E7 area 1) -> +0x4C, +2 -> +0x4E (camera-Y limit / Y trigger), +4 -> +0x50
//   (scroll lead when +0xD set), +6/+8 -> +0x52/+0x54 (vertical follow margins when +0xC set), +0xA area, +0xB state,
//   +0xC/+0xD/+0xE/+0xF flags (+0xE = state after a lock, +0xF = Y trigger).
'use strict';
const R = require('../../rom.cjs');
const S = require('./cps-scroll.cjs');

const T = {
  area2: 0x21580, area3: 0x2311E, L2: 0x2155E, L3: 0x21454, block3: 0x177288,
  shift: 0x22DE4, vflag: 0x22E54, script: 0x21B2A, pal1: 0xBBA52, pal2: 0x8AE0, pal3: 0x8C52, palObj: 0x8E8E,
  palBase: 0xB7A52, prio: 0x8DEC, prioE7: 0x8DCC, kTable: 0x20F58,
  s1L2: 0x138C48, s1L3: 0x15CFE8,
};
const NSTAGE = 8;
const TITLES = ['', 'THE SWAMP FOREST', 'HELL ROAD', "JACK'S GARAGE", 'VILLAGE OF FLAME', 'JUNGLE AND MINE', '', 'THE UNDER WORLD'];

const STATE_NAMES = {
  0x00: 'scroll: camera X follows the players (0x20A22), Y follows when flag +0xC (0x20B68)',
  0x01: 'area exit: fade, then load the next area from the next segment (0x20BF4)',
  0x02: 'diagonal scroll down-right, X and Y together (0x20F92)',
  0x03: 'diagonal scroll up-right, X and Y together (0x2100C)',
  0x04: 'lock: camera held at the trigger until the wave is cleared, then state = byte +0xE (0x21086)',
  0x05: 'scripted vertical drop (E7 area 1) (0x210E0)',
  0x06: 'stage end (boss lock), sets 0xFF84D4 (0x20DA6)',
  0x07: 'camera Y follows the lowest player (0x211AE)',
  0x08: 'next area without reload: area++, palettes/timer reset (0x20E78)',
  0x09: 'camera Y falls during a fade (0x2120E)',
  0x0A: 'slope: camY = Y0 + (camX - X0) / 4 (0x20EF8)',
  0x0B: 'slope: camY = Y0 - ((camX - X0) >> k), floor +0x4E (0x20F12)',
  0x0C: 'camera Y sinks while the lead player X >= 0x750 (0x20F78)',
  0x0D: 'slope: camY = Y0 + (camX - X0) / 2, cap +0x4E (0x20ED4)',
  0x0E: 'debug view (no camera follow)', 0x0F: 'debug view (no camera follow)',
  0x10: 'stage end variant (0x20DEA)',
  0x11: 'intro auto-scroll, camX += 3 per frame (0x21266)',
  0x12: 'area exit variant (0x20CFE)',
  0x13: 'stage end with fade (0x20E20)',
};

const hex = (v, n = 0) => '0x' + v.toString(16).toUpperCase().padStart(n, '0');

function areaEntry(table, s, a) {
  const e = (R.u32(table + s * 4) & 0xffffff) + a * 10;
  return { entry: e, b0: R.prg[e], rows: R.prg[e + 1], map: R.u32(e + 2) & 0xffffff, x0: R.u16(e + 6), y0: R.u16(e + 8) };
}

function script(s) {
  const t = T.script + R.u16(T.script + s * 2), segs = [];
  for (let i = 0; i < 64; i++) {
    const e = t + i * 16;
    if (R.u16(e) === 0xffff) break;
    segs.push({
      i, addr: e, trigger: R.u16(e), w2: R.u16(e + 2), w4: R.u16(e + 4), w6: R.u16(e + 6), w8: R.u16(e + 8),
      area: R.prg[e + 0xa], state: R.prg[e + 0xb], followY: R.prg[e + 0xc], leadFromSeg: R.prg[e + 0xd],
      nextState: R.prg[e + 0xe], yTrigger: R.prg[e + 0xf],
    });
  }
  return { table: t, segs };
}

// all area numbers of a stage, from its script
function stageAreas(s) {
  const segs = script(s).segs, areas = [];
  for (const g of segs) if (!areas.includes(g.area)) areas.push(g.area);
  return areas.sort((x, y) => x - y);
}

// map data length in columns: distance to the next map that starts after it (any table), / rows / 2
let allMapPtrs = null;
function mapPtrs() {
  if (allMapPtrs) return allMapPtrs;
  const set = new Set([T.script]);
  for (let s = 0; s < NSTAGE; s++) for (let a = 0; a < 5; a++) {
    const e = areaEntry(T.area2, s, a); if (e.map && e.map < 0x30000) set.add(e.map);
  }
  allMapPtrs = [...set].sort((x, y) => x - y);
  return allMapPtrs;
}
function dataCols(e) {
  const next = mapPtrs().find(p => p > e.map);
  return next && e.rows ? Math.floor((next - e.map) / 2 / e.rows) : e.b0;
}

// scroll3 block-map columns the game can stream: the code never checks the width byte (0x230BE reads
// map[(X3 >> 8) * rows + (Y3 >> 8)] unbounded), so the render must cover every X3 the camera can reach:
// X3 = camX >> shift with camX <= scroll2 width - 384 (HELL ROAD wraps X3 at 0xA00). Columns past the declared
// width read whatever follows the block map in ROM, exactly as the game does.
function cols3Needed(s, a) {
  const e3 = areaEntry(T.area3, s, a), e2 = areaEntry(T.area2, s, a);
  if (!e3.rows || !e3.b0) return 0;
  if (s === 2) return Math.max(e3.b0, 10);
  const w2 = (e2.map && e2.rows ? dataCols(e2) : e2.b0) * 256, shift = shiftOf(s, a) & 63;
  const x3max = ((Math.max(0, w2 - 384)) >>> shift) + 384;
  return Math.max(e3.b0, Math.ceil(x3max / 256));
}

function shiftOf(s, a) { return R.prg[T.shift + R.u16(T.shift + s * 2) + a]; }
function vflagOf(s, a) { return R.prg[T.vflag + s * 4 + a]; }

// ROM palette page (32 palettes x 16 words) at full brightness -> {words, rgb[32][16]}
function palPage(ptr) {
  const words = [], rgb = [];
  for (let p = 0; p < 32; p++) {
    const row = [];
    for (let c = 0; c < 16; c++) { const w = R.u16(ptr + (p * 16 + c) * 2); words.push(w); row.push(S.palWordRGBFull(w)); }
    rgb.push(row);
  }
  return { ptr, words, rgb };
}
function palObjPage(s, a) {
  const list = R.u32(T.palObj + s * 16 + a * 4) & 0xffffff, words = [], rgb = [], idx = [];
  for (let p = 0; p < 32; p++) {
    const k = R.u16(list + p * 2); idx.push(k);
    const row = [];
    for (let c = 0; c < 16; c++) { const w = R.u16(T.palBase + k * 32 + c * 2); words.push(w); row.push(S.palWordRGBFull(w)); }
    rgb.push(row);
  }
  return { list, idx, words, rgb };
}
function palettes(s, a) {
  return {
    scroll1: palPage(T.pal1),
    scroll2: palPage(R.u32(T.pal2 + s * 16 + a * 4) & 0xffffff),
    scroll3: palPage(R.u32(T.pal3 + s * 16 + a * 4) & 0xffffff),
    obj: palObjPage(s, a),
  };
}
function priority(s, a) {
  const b = s === 6 ? T.prioE7 + a * 8 : T.prio + s * 8;
  return [0, 1, 2, 3].map(k => R.u16(b + k * 2));
}

// generic image with per-pixel pen/palette/group (+ terrain for scroll2)
function newImg(w, h, terrain) {
  return { w, h, pen: new Uint8Array(w * h).fill(15), pal: new Uint8Array(w * h), grp: new Uint8Array(w * h), terrain: terrain ? new Uint8Array((w >> 4) * (h >> 4)) : null };
}
function blitTile(img, layer, code, attr, x, y, half = 0) {
  const T2 = S.LAYER[layer].tile, c = S.mapCode(layer, code);
  if (c < 0) return false;
  const t = S.tilePens(layer, c, half), fx = attr & 0x20, fy = attr & 0x40, p = attr & 31, g = (attr >> 7) & 3;
  for (let yy = 0; yy < T2; yy++) for (let xx = 0; xx < T2; xx++) {
    const X = x + xx, Y = y + yy; if (X < 0 || Y < 0 || X >= img.w || Y >= img.h) continue;
    const q = Y * img.w + X;
    img.pen[q] = t[(fy ? T2 - 1 - yy : yy) * T2 + (fx ? T2 - 1 - xx : xx)]; img.pal[q] = p; img.grp[q] = g;
  }
  return true;
}

// scroll2 playfield map of (stage s, area a) -> image with world X = image x, world h = H - 1 - image y
function renderMap2(s, a, { cols = null } = {}) {
  const e = areaEntry(T.area2, s, a);
  if (!e.map || !e.rows) return null;
  const W = cols || dataCols(e), Hb = e.rows, L2 = R.u32(T.L2 + s * 4) & 0xffffff, L3 = R.u32(T.L3 + s * 4) & 0xffffff;
  const img = newImg(W * 256, Hb * 256, true); img.tiles = new Map(); // "tx,ty" (16-px cell, image coords) -> {code, attr}
  const stats = { blocks: new Set(), chunks: new Set(), codes: new Set(), unmapped: 0 };
  for (let bx = 0; bx < W; bx++) for (let by = 0; by < Hb; by++) {
    const block = R.u16(e.map + (bx * Hb + by) * 2); stats.blocks.add(block);
    for (let cx = 0; cx < 8; cx++) for (let cy = 0; cy < 8; cy++) {
      const chunk = R.u16(L2 + block * 128 + cx * 16 + (14 - cy * 2)); stats.chunks.add(chunk);
      const X = bx * 256 + cx * 32, Ytop = img.h - (by * 256 + cy * 32) - 32;
      for (let k = 0; k < 4; k++) {
        const code = R.u16(L3 + chunk * 16 + k * 4), attr = R.u16(L3 + chunk * 16 + k * 4 + 2);
        const tx = X + (k >> 1) * 16, ty = Ytop + (k & 1) * 16;
        stats.codes.add(code);
        if (!blitTile(img, 2, code, attr, tx, ty)) stats.unmapped++;
        img.terrain[(ty >> 4) * (img.w >> 4) + (tx >> 4)] = attr >> 10;
        img.tiles.set(`${tx >> 4},${ty >> 4}`, { code, attr });
      }
    }
  }
  return { img, e, W, L2, L3, stats: { blocks: stats.blocks.size, chunks: stats.chunks.size, codes: stats.codes.size, unmapped: stats.unmapped } };
}

// scroll2 tile entry the game would stream for world (X, h) (16-px cell), honouring the stage-3 wrap
function map2Entry(s, a, X, h, ctx = null) {
  const e = ctx ? ctx.e : areaEntry(T.area2, s, a);
  if (!e.map || !e.rows) return null;
  const L2 = R.u32(T.L2 + s * 4) & 0xffffff, L3 = R.u32(T.L3 + s * 4) & 0xffffff;
  let x = X & 0xffe0;
  if (s === 2) while (x >= 0x4d00) x -= 0xf00;
  const by = (h >> 8), bx = x >> 8;
  const block = R.u16(e.map + (bx * e.rows + by) * 2);
  const cx = (X & 0xe0) >> 5, cy = (h & 0xe0) >> 5;
  const chunk = R.u16(L2 + block * 128 + cx * 16 + (14 - cy * 2));
  const k = ((X >> 4) & 1) * 2 + (((h >> 4) & 1) ? 0 : 1);
  return { code: R.u16(L3 + chunk * 16 + k * 4), attr: R.u16(L3 + chunk * 16 + k * 4 + 2) };
}

function renderMap3(s, a, { cols = null } = {}) {
  const e = areaEntry(T.area3, s, a);
  if (!e.rows || !e.b0) return null;
  const W = cols || e.b0, Hb = e.rows, img = newImg(W * 256, Hb * 256, false);
  const stats = { blocks: new Set(), unmapped: 0 };
  for (let bx = 0; bx < W; bx++) for (let by = 0; by < Hb; by++) {
    const block = R.u16(e.map + (bx * Hb + by) * 2) & 0x7f; stats.blocks.add(block);
    for (let c = 0; c < 8; c++) for (let r = 0; r < 8; r++) {
      const o = T.block3 + block * 256 + c * 32 + (0x1c - r * 4);
      const code = R.u16(o), attr = R.u16(o + 2);
      if (!blitTile(img, 3, code, attr, bx * 256 + c * 32, img.h - (by * 256 + r * 32) - 32)) stats.unmapped++;
    }
  }
  return { img, e, W, stats: { blocks: stats.blocks.size, unmapped: stats.unmapped } };
}

function map3Entry(s, a, X, h) {
  const e = areaEntry(T.area3, s, a);
  if (!e.rows || !e.b0) return null;
  let x = X;
  if (s === 2) while (x >= 0xa00) x -= 0x100;
  const block = R.u16(e.map + ((x >> 8) * e.rows + (h >> 8)) * 2) & 0x7f;
  const o = T.block3 + block * 256 + (X & 0xe0) + (0x1c - ((h & 0xe0) >> 3));
  return { code: R.u16(o), attr: R.u16(o + 2) };
}

// E7 area 1: scroll1 used as a background (0x20778): blocks D5 = 1 at (X 0, Y 0x100) and 2 at (X 0x100, Y 0x100),
// drawn by 0x205C6 with blocks from 0x138C48 (128 bytes: 8 columns x 8 rows of words) and 64-byte chunks
// (4x4 tiles of 8x8) from 0x15CFE8. Returns a 512x256 image in scroll1 tilemap coordinates (x = X & 0x1FF).
function renderScroll1Bg() {
  const img = newImg(512, 512, false);
  for (const [D0, D5] of [[0, 1], [0x100, 2]]) {
    const L2 = T.s1L2 + D5 * 128;
    // 0x205C6: 8 columns of 32 px; each column draws 9 chunks for D1 = 0x100, 0xE0 .. 0 (0x205E4). The chunk word is
    // at L2 + ((X & 0xE0) >> 1) + 14 - ((D1 & 0xE0) >> 4) (0x206A8) and lands at scroll1 tilemap pixel
    // (X & 0x1E0, 0x1E0 - (D1 & 0x1E0)) (0x20650); a chunk is 4 columns x 4 rows of 8x8 tiles, column-major (0x20614).
    for (let c = 0; c < 8; c++) {
      const X = D0 + c * 32;
      for (let D1 = 0x100; D1 >= 0; D1 -= 0x20) {
        const rowPix = (0x1e0 - (D1 & 0x1e0)) & 0x1ff;
        const chunk = R.u16(L2 + ((X & 0xe0) >> 1) + 14 - ((D1 & 0xe0) >> 4));
        const base = T.s1L3 + chunk * 64;
        for (let col = 0; col < 4; col++) for (let k = 0; k < 4; k++) {
          const o = base + col * 16 + k * 4, code = R.u16(o), attr = R.u16(o + 2);
          const tcol = ((X & 0x1e0) >> 3) + col;
          blitTile(img, 1, code, attr, tcol * 8, rowPix + k * 8, tcol & 1);
        }
      }
    }
  }
  return img;
}

function toRGBA(img, pageRGB, { bg = null } = {}) {
  const n = img.w * img.h, rgba = new Uint8Array(n * 4);
  for (let q = 0; q < n; q++) {
    const v = img.pen[q];
    if (v === 15) { if (bg) { rgba[q * 4] = bg[0]; rgba[q * 4 + 1] = bg[1]; rgba[q * 4 + 2] = bg[2]; rgba[q * 4 + 3] = 255; } continue; }
    const c = pageRGB[img.pal[q]][v]; rgba[q * 4] = c[0]; rgba[q * 4 + 1] = c[1]; rgba[q * 4 + 2] = c[2]; rgba[q * 4 + 3] = 255;
  }
  return rgba;
}

module.exports = { T, NSTAGE, TITLES, STATE_NAMES, hex, areaEntry, script, stageAreas, dataCols, cols3Needed, shiftOf, vflagOf, palPage, palObjPage, palettes, priority, renderMap2, map2Entry, renderMap3, map3Entry, renderScroll1Bg, toRGBA, newImg, blitTile };
