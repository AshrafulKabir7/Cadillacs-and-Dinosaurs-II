// 12-bit palette operations, presets and hand sprite rows for the asset build (ARCHITECTURE §3.4, CAMPAIGN §4.3,
// ENEMIES §6.1, PLAN §5.3).
//
//   words(ep, area, layer)      -> Uint16Array(512): the 32 rows x 16 pens of EPISODE ep (1-8) area, layer
//                                  's1'|'s2'|'s3'|'obj' (scroll1 0xBBA52, scroll2 0x8AE0, scroll3 0x8C52, OBJ 0x8E8E)
//   objMap(ep, area)            -> the 32 OBJ slot -> ROM row indices (0x8E8E);  mapKey(ep, area) -> 'S1A0'
//   rowWords(romRow)            -> Uint16Array(16) from 0xB7A52 + row*32;  rowRGB(romRow) -> [16 x 0xRRGGBB]
//   apply(words, ops, opts)     -> Uint16Array: ops run in order on the low 12 bits (pen 15 untouched), each result
//                                  quantised back to 4 bits per channel
//   preset(name, roles, opts)   -> ops[]  (ARCHITECTURE §3.4 night/fire/flood/lab/ruin, CAMPAIGN §4.3 chapter presets)
//   pickRows(ramp, opts)        -> romRow[] whose 16-pen structure matches the ramp (palette-pick support)
//   HAND                        -> {rook: {30: [16 x 0xRRGGBB]}, cinder: {28: […], 30: […], 31: […]}, …}: the hand
//                                  sprite rows (rook, cinder, sable, slicevat, crown, half-*, ironhide, verdant,
//                                  drowned, mirror-*, freed-*, gel, flash) resolved per OBJ slot (PLAN §5.3; lazy,
//                                  computed from the ROM on first access)
//   HAND_SPECS / hand(name)     -> the specs behind them, and one palette resolved with its base rows, keys and
//                                  ENEMIES §6.1 acceptance: {rows:{slot:[16]}, base, keys, accept, draft}
//   acceptance(row, originals, {keep}) -> ENEMIES §6.1 palette acceptance
//
// Conventions. A ROM word is 0xBRGB: brightness nibble (0 in ROM, F = full) and 4-bit channels; full brightness
// shows channel n as n*17. A "row" is 16 words; an OBJ "slot" is 0-31. Every op works on 0..15 channel values.
// Hand rows are keyed '<name>:<slot>' (handKey) when they sit beside ROM rows in SPRITE_DATA.pal.rows.
'use strict';
const path = require('path'), fs = require('fs');

let ROM = null, SR = null;
const R = () => ROM || (ROM = require('../rom.cjs'));
const stageRom = () => SR || (SR = require('../export/lib/stage-rom.cjs'));
const ROW_SCAN = 0x800;                           // rows 0..2047 of 0xB7A52 (64 KB; the OBJ maps index up to 2048)

// ---------------------------------------------------------------- colour helpers (4-bit channels)
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const q4 = v => clamp(Math.round(v * 15), 0, 15);                 // 0..1 -> 0..15
const wordRGB = w => [(w >> 8) & 15, (w >> 4) & 15, w & 15];
const rgbWord = (r, g, b, hi = 0) => (hi & 0xF000) | (clamp(r, 0, 15) << 8) | (clamp(g, 0, 15) << 4) | clamp(b, 0, 15);
const word24 = w => (((w >> 8) & 15) * 17 << 16) | (((w >> 4) & 15) * 17 << 8) | ((w & 15) * 17);
function hex24(c) {
  if (Array.isArray(c)) return ((c[0] & 255) << 16) | ((c[1] & 255) << 8) | (c[2] & 255);
  if (typeof c === 'number') return c;
  let s = String(c).replace('#', '');
  if (s.length === 3) s = s.split('').map(ch => ch + ch).join('');
  return parseInt(s, 16);
}
const hexTo4 = c => { const v = hex24(c); return [Math.round(((v >> 16) & 255) / 17), Math.round(((v >> 8) & 255) / 17), Math.round((v & 255) / 17)]; };
function rgbToHsl(r, g, b) {                       // 0..1 in, h in degrees
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2; let h = 0, s = 0;
  if (max !== min) {
    const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60; else if (max === g) h = ((b - r) / d + 2) * 60; else h = ((r - g) / d + 4) * 60;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, f = t => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h / 360 + 1 / 3), f(h / 360), f(h / 360 - 1 / 3)];
}
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;       // on 0..15 channels

// ---------------------------------------------------------------- ROM access
function stageIndex(ep) { if (!(ep >= 1 && ep <= 8)) throw new Error(`palettes: episode ${ep} is not 1..8`); return ep - 1; }
function layerKey(layer) {
  const k = String(layer).toLowerCase();
  if (k === '1' || k === 's1' || k === 'scroll1') return 'scroll1';
  if (k === '2' || k === 's2' || k === 'scroll2') return 'scroll2';
  if (k === '3' || k === 's3' || k === 'scroll3') return 'scroll3';
  if (k === 'obj' || k === 'o' || k === 'sprites') return 'obj';
  throw new Error(`palettes: unknown layer ${layer}`);
}
const pageCache = new Map();
function page(ep, area) {
  const key = `${ep}:${area}`;
  if (pageCache.has(key)) return pageCache.get(key);
  const s = stageIndex(ep), areas = stageRom().stageAreas(s);
  if (!areas.includes(area)) throw new Error(`palettes: EPISODE ${ep} has areas ${areas.join(',')}, not ${area}`);
  const p = stageRom().palettes(s, area);
  pageCache.set(key, p);
  return p;
}
function words(ep, area, layer) { return Uint16Array.from(page(ep, area)[layerKey(layer)].words); }
function objMap(ep, area) { return page(ep, area).obj.idx.slice(); }
const mapKey = (ep, area) => `S${ep}A${area}`;
function parseMapKey(key) { const m = /^S(\d)A(\d)$/.exec(key); if (!m) throw new Error(`palettes: bad map key ${key}`); return [Number(m[1]), Number(m[2])]; }
function rowWords(romRow) {
  const base = R().PAL_TABLE + romRow * 32;
  if (!(romRow >= 0) || base + 32 > R().prg.length) throw new Error(`palettes: ROM row ${romRow} is outside the table`);
  const out = new Uint16Array(16);
  for (let k = 0; k < 16; k++) out[k] = R().u16(base + k * 2);
  return out;
}
const wordsRGB = ws => Array.from(ws, word24);
const rowRGB = romRow => wordsRGB(rowWords(romRow));
const rowOf = (ws, row) => ws.subarray(row * 16, row * 16 + 16);
// All distinct ROM colours (24-bit) of the OBJ row table, for snapping.
let romColourCache = null;
function romColours() {
  if (romColourCache) return romColourCache;
  const set = new Set();
  for (let r = 0; r < ROW_SCAN; r++) { const base = R().PAL_TABLE + r * 32; if (base + 32 > R().prg.length) break; for (let k = 0; k < 15; k++) set.add(word24(R().u16(base + k * 2))); }
  return (romColourCache = set);
}
function snapToRom(c24) {
  const cols = romColours(); if (cols.has(c24)) return c24;
  const r = (c24 >> 16) & 255, g = (c24 >> 8) & 255, b = c24 & 255; let best = c24, bd = Infinity;
  for (const x of cols) { const d = ((x >> 16) & 255) - r, e = ((x >> 8) & 255) - g, f = (x & 255) - b, dist = d * d * 0.299 + e * e * 0.587 + f * f * 0.114; if (dist < bd || (dist === bd && x < best)) { bd = dist; best = x; } }
  return best;
}
const snapRow = row24 => row24.map((c, i) => (i === 15 ? c : snapToRom(c)));
const to4 = c24 => [((c24 >> 16) & 255) / 17, ((c24 >> 8) & 255) / 17, (c24 & 255) / 17].map(Math.round);
const rgbRowToWords = row24 => Uint16Array.from(row24, c => { const [r, g, b] = to4(c); return rgbWord(r, g, b); });

// ---------------------------------------------------------------- ops
const ALL_ROWS = Array.from({ length: 32 }, (_, i) => i), ALL_PENS = Array.from({ length: 15 }, (_, i) => i);
function rowsOf(op, roles, log) {
  if (op.role != null) {
    const r = roles && roles[op.role];
    if (!r) { if (log) log.push(`skipped ${op.op}: role '${op.role}' not given`); return null; }
    return r;
  }
  let rows = op.rows ? op.rows.slice() : ALL_ROWS.slice();
  if (op.exclude != null) { const ex = roles && roles[op.exclude]; if (ex) rows = rows.filter(r => !ex.includes(r)); }
  return rows;
}
// per-pen transform helper: fn([r,g,b] 0..1) -> [r,g,b] 0..1
function perPen(out, rows, pens, fn) {
  for (const row of rows) for (const pen of pens) {
    if (pen === 15) continue;
    const i = row * 16 + pen, w = out[i], [r, g, b] = wordRGB(w), [nr, ng, nb] = fn([r / 15, g / 15, b / 15], pen, row);
    out[i] = rgbWord(q4(nr), q4(ng), q4(nb), w);
  }
}
const scaleAmount = (k, amount) => 1 - (1 - k) * amount;        // interpolate a factor toward 1

function applyOne(out, op, { roles, log, layer } = {}) {
  if (typeof op === 'string') { for (const o of preset(op, roles, { layer })) applyOne(out, o, { roles, log, layer }); return; }
  if (op.layer && layer && layerKey(op.layer) !== layerKey(layer)) return;
  const amount = op.amount == null ? 1 : op.amount;
  const pens = op.pens ? op.pens.filter(p => p !== 15) : ALL_PENS;
  switch (op.op) {
    case 'preset': { for (const o of preset(op.name, roles, { layer, amount: op.amount, rows: op.rows })) applyOne(out, o, { roles, log, layer }); return; }
    case 'borrow': {                                           // one row from another stage/area/layer (or a ROM OBJ row)
      const pairs = op.role != null ? (roles && roles[op.role]) : [[op.row, op.from ? op.from[3] : undefined]];
      if (!pairs) { if (log) log.push(`skipped borrow: role '${op.role}' not given`); return; }
      for (const pr of pairs) {
        const row = Array.isArray(pr) ? pr[0] : pr.row, fromRow = Array.isArray(pr) ? pr[1] : pr.fromRow;
        const from = (Array.isArray(pr) ? null : pr.from) || op.from;
        let src;
        if (op.romRow != null || (pr && pr.romRow != null)) src = rowWords(pr.romRow != null ? pr.romRow : op.romRow);
        else { if (!from) throw new Error('palettes: borrow needs from:[ep, area, layer, row]'); src = rowOf(words(from[0], from[1], from[2]), fromRow != null ? fromRow : from[3]); }
        for (let k = 0; k < 15; k++) out[row * 16 + k] = (out[row * 16 + k] & 0xF000) | (src[k] & 0xFFF);
      }
      return;
    }
    case 'hsl': {
      const rows = rowsOf(op, roles, log); if (!rows) return;
      const dh = (op.h || 0) * amount, ks = scaleAmount(op.s == null ? 1 : op.s, amount), kl = scaleAmount(op.l == null ? 1 : op.l, amount);
      perPen(out, rows, pens, ([r, g, b]) => { const [h, s, l] = rgbToHsl(r, g, b); return hslToRgb(h + dh, s * ks, l * kl); });
      return;
    }
    case 'tint': {
      const rows = rowsOf(op, roles, log); if (!rows) return;
      const t = hexTo4(op.rgb).map(v => v / 15), a = (op.amount == null ? 1 : op.amount);
      perPen(out, rows, pens, ([r, g, b]) => [r + (t[0] - r) * a, g + (t[1] - g) * a, b + (t[2] - b) * a]);
      return;
    }
    case 'scale': {                                            // night: per-channel factors, keepPens untouched
      const rows = rowsOf(op, roles, log); if (!rows) return;
      const keep = new Set(op.keepPens || []), f = op.rgb.map(k => scaleAmount(k, amount));
      perPen(out, rows, pens.filter(p => !keep.has(p)), ([r, g, b]) => [r * f[0], g * f[1], b * f[2]]);
      return;
    }
    case 'set': {                                              // authored pen: {row, pen, rgb}
      const [r, g, b] = hexTo4(op.rgb); const i = op.row * 16 + op.pen; out[i] = rgbWord(r, g, b, out[i]); return;
    }
    case 'night': { applyOne(out, { ...PRESETS.night[0], amount, rows: op.rows, role: op.role }, { roles, log, layer }); return; }
    default: throw new Error(`palettes: unknown op ${op.op}`);
  }
}
function apply(wordsIn, ops, opts = {}) {
  const out = Uint16Array.from(wordsIn);
  for (const op of ops || []) applyOne(out, op, opts);
  return out;
}

// ---------------------------------------------------------------- presets
// ARCHITECTURE §3.4 (exact numbers) and CAMPAIGN §4.3 (row roles are supplied by the level recipe: `roles`).
// A role names a list of rows ('stone', 'sea', 'liquid', …); ops with a role the caller did not give are skipped.
const PRESETS = {
  night: [{ op: 'scale', rgb: [0.45, 0.50, 0.75], keepPens: [1, 2, 3] }],
  fire: [{ op: 'hsl', h: 0, s: 1.2, l: 1.05 }, { op: 'tint', rgb: '#f80', amount: 0.25, role: 'background' }],
  flood: [{ op: 'hsl', h: -20, s: 0.8, l: 0.85 }, { op: 'tint', rgb: '#2a6', amount: 0.2 }],
  lab: [{ op: 'tint', rgb: '#6f8', amount: 0.3, exclude: 'metal' }],
  ruin: [{ op: 'hsl', h: 0, s: 0.55, l: 0.8 }, { op: 'tint', rgb: '#432', amount: 0.25 }],
  // CAMPAIGN §4.3 chapter presets
  'harbor-night': ['night', { op: 'borrow', role: 'sea', from: [4, 0, 's3'] }, { op: 'tint', rgb: '#1a2a5a', amount: 0.2, role: 'stone' }],
  amber: [{ op: 'hsl', h: 35, s: 1.0, l: 1.0, role: 'liquid' }],
  coral: [{ op: 'borrow', role: 'sand', from: [7, 0, 's2'], layer: 's2' }, { op: 'hsl', h: -25, s: 1.1, l: 1.05, role: 'scrub', layer: 's2' },
    { op: 'borrow', role: 'asphalt', from: [4, 0, 's2'], layer: 's2' }, { op: 'tint', rgb: '#d98a8a', amount: 0.25, role: 'mesas', layer: 's3' },
    { op: 'borrow', role: 'sky', from: [1, 0, 's3'], layer: 's3' }],
  'coral-fort': [{ op: 'hsl', h: -30, s: 0.8, l: 1.1, role: 'wood', layer: 's2' }, { op: 'borrow', role: 'stone', from: [7, 0, 's2'], layer: 's2' },
    { op: 'borrow', role: 'mountains', from: [1, 0, 's3'], layer: 's3' }],
  verdant: [{ op: 'hsl', h: 35, s: 1.15, l: 1.0, role: 'rock' }, { op: 'tint', rgb: '#5c4', amount: 0.15, exclude: 'glass' }, { op: 'hsl', h: 0, s: 1, l: 1.1, role: 'sky', layer: 's3' }],
  drowned: ['flood', 'ruin', { op: 'night', amount: 0.8 }, { op: 'preset', name: 'ruin', role: 'glass' }, { op: 'borrow', role: 'water', from: [8, 1, 's2'] }],
  coldlab: ['lab', { op: 'tint', rgb: '#9ef', amount: 0.25 }, { op: 'hsl', h: 0, s: 0.7, l: 1.15 }, { op: 'hsl', h: 110, s: 1, l: 1, role: 'liquid' }],
  'storm-crown': [{ op: 'hsl', h: -40, s: 0.6, l: 0.85 }, { op: 'tint', rgb: '#6a4a9a', amount: 0.25 }, { op: 'borrow', role: 'sky', from: [4, 0, 's3'], layer: 's3' },
    { op: 'tint', rgb: '#2a6', amount: 0.15, role: 'water' }],
};
// preset(name, roles?, {layer?, amount?, rows?}) -> flat ops list (presets inside presets are expanded)
function preset(name, roles = null, { layer = null, amount = null, rows = null } = {}) {
  const list = PRESETS[name]; if (!list) throw new Error(`palettes: unknown preset '${name}'`);
  const out = [];
  for (const op of list) {
    if (typeof op === 'string') { out.push(...preset(op, roles, { layer, amount, rows })); continue; }
    if (op.op === 'preset') { out.push(...preset(op.name, roles, { layer, amount: op.amount != null ? op.amount : amount, rows: op.rows || rows }).map(o => (op.role != null ? { ...o, role: op.role } : o))); continue; }
    if (op.layer && layer && layerKey(op.layer) !== layerKey(layer)) continue;
    const o = { ...op };
    if (amount != null) o.amount = (o.amount == null ? 1 : o.amount) * amount;
    if (rows && o.role == null && !o.rows) o.rows = rows;
    out.push(o);
  }
  return out;
}

// ---------------------------------------------------------------- ramp matching (palette-pick support)
function rampLum(row24) { return row24.slice(0, 15).map(c => lum((c >> 16) & 255, (c >> 8) & 255, c & 255)); }
function ranks(v) { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); const r = new Array(v.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; }
function spearman(a, b) { const ra = ranks(a), rb = ranks(b), n = a.length; let d2 = 0; for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2; return 1 - 6 * d2 / (n * (n * n - 1)); }
function resets(l) { const s = new Set(); for (let i = 1; i < l.length; i++) if (l[i] < l[i - 1] - 8) s.add(i); return s; }
function jaccard(a, b) { let inter = 0; for (const x of a) if (b.has(x)) inter++; const uni = a.size + b.size - inter; return uni ? inter / uni : 1; }
function hueOf(row24, pens) {
  let sx = 0, sy = 0;
  for (const p of pens) { const c = row24[p], [h, s] = rgbToHsl(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255); if (s < 0.2) continue; sx += Math.cos(h * Math.PI / 180) * s; sy += Math.sin(h * Math.PI / 180) * s; }
  if (!sx && !sy) return null;
  return ((Math.atan2(sy, sx) * 180 / Math.PI) + 360) % 360;
}
// ramp: {row} (a ROM row) | {words:[16]} | {rgb:[16 x 0xRRGGBB]} | Uint16Array (words) | Array (24-bit colours)
function toRow24(ramp) {
  if (ArrayBuffer.isView(ramp)) return Array.from(ramp, word24);
  if (Array.isArray(ramp)) return ramp.slice();
  if (ramp && ramp.row != null) return rowRGB(ramp.row);
  if (ramp && ramp.words) return Array.from(ramp.words, word24);
  if (ramp && ramp.rgb) return ramp.rgb.slice();
  throw new Error('palettes: ramp must be {row}, {words}, {rgb}, a Uint16Array or an array of 24-bit colours');
}
// rankRows(ramp, {min, limit, hue, hueTol, pens, excludeRow}) -> [{row, score, hue}]: rows whose luminance order over
// the pens and ramp resets match the given 16-colour ramp; `hue` (degrees) prefers rows of that hue family.
function rankRows(ramp, { min = 0.75, limit = 24, hue = null, hueTol = 40, pens = null, excludeRow = null } = {}) {
  const ref = toRow24(ramp), rl = rampLum(ref), rr = resets(rl), out = [], P = pens || ALL_PENS;
  for (let row = 0; row < ROW_SCAN; row++) {
    const base = R().PAL_TABLE + row * 32; if (base + 32 > R().prg.length) break;
    if (row === excludeRow) continue;
    const ws = rowWords(row); let zero = true; for (let k = 0; k < 15; k++) if (ws[k] & 0xFFF) { zero = false; break; }
    if (zero) continue;
    const c24 = wordsRGB(ws), l = rampLum(c24);
    const score = 0.6 * spearman(rl, l) + 0.4 * jaccard(rr, resets(l));
    if (score < min) continue;
    const h = hueOf(c24, P);
    if (hue != null) { if (h == null) continue; const d = Math.abs(((h - hue + 540) % 360) - 180); if (d > hueTol) continue; }
    out.push({ row, score: Number(score.toFixed(4)), hue: h == null ? null : Math.round(h) });
  }
  out.sort((a, b) => b.score - a.score || a.row - b.row);
  return out.slice(0, limit);
}
const pickRows = (ramp, opts) => rankRows(ramp, opts).map(r => r.row);

// ---------------------------------------------------------------- pen classes and hand rows
// Classifies the pens of a 16-colour row: outline (darkest), eyes (white), skin (warm mid tones), clothing (the rest).
function classifyPens(row24) {
  const out = { outline: [], eyes: [], skin: [], clothing: [], transparent: [15] };
  const lums = row24.slice(0, 15).map(c => lum((c >> 16) & 255, (c >> 8) & 255, c & 255));
  const darkest = lums.indexOf(Math.min(...lums));
  for (let p = 0; p < 15; p++) {
    const c = row24[p], [h, s, l] = rgbToHsl(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
    if (p === darkest || lums[p] < 40) out.outline.push(p);
    else if (l > 0.93 && s < 0.15) out.eyes.push(p);
    else if (h >= 12 && h <= 42 && s >= 0.35 && l >= 0.22 && l <= 0.9 && ((c >> 16) & 255) > (c & 255) + 40) out.skin.push(p);
    else out.clothing.push(p);
  }
  return out;
}
const handKey = (name, slot) => (slot == null ? name : `${name}:${slot}`);
// gel: the base row with every non-outline pen mapped by luminance rank onto the ROM row 467 ramp, hue-shifted green.
function gelRamp() { return rowRGB(467).slice(0, 12).map(c => { const [h, s, l] = rgbToHsl(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255); return hslToRgb(120, Math.max(s, 0.5), l); }).map(([r, g, b]) => (q4(r) * 17 << 16) | (q4(g) * 17 << 8) | q4(b) * 17); }
function gelRow(base24) {
  const ramp = gelRamp(), cls = classifyPens(base24), lums = rampLum(base24), order = ranks(lums), out = base24.slice();
  for (let p = 0; p < 15; p++) { if (cls.outline.includes(p)) { out[p] = 0x113322; continue; } out[p] = ramp[Math.min(ramp.length - 1, Math.floor(order[p] * ramp.length / 15))]; }
  return out;
}
const flashRow = () => Array.from({ length: 16 }, (_, i) => (i === 15 ? 0x00AA99 : 0xFFFFFF));
function halfRow(base24) { return base24.map((c, i) => { if (i === 15) return c; const [h, s, l] = rgbToHsl(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255); const [r, g, b] = hslToRgb(h, s * 0.6, l); return (q4(r) * 17 << 16) | (q4(g) * 17 << 8) | q4(b) * 17; }); }
// mirror: clothing pens hue-rotated 180° (the inverse family), every colour snapped to a ROM colour; skin/outline/eyes kept.
function mirrorRow(base24, cls = classifyPens(base24)) {
  return base24.map((c, i) => { if (i === 15 || !cls.clothing.includes(i)) return c; const [h, s, l] = rgbToHsl(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255); const [r, g, b] = hslToRgb(h + 180, s, l); return snapToRom((q4(r) * 17 << 16) | (q4(g) * 17 << 8) | q4(b) * 17); });
}
// Expands preset names and {op:'preset'} entries so every op is a plain object (hsl/tint/scale/set/borrow).
function flatOps(ops, roles = null) {
  const out = [];
  for (const o of ops || []) {
    if (typeof o === 'string') out.push(...preset(o, roles));
    else if (o.op === 'preset') out.push(...preset(o.name, roles, { amount: o.amount, rows: o.rows }));
    else if (o.op === 'night') out.push({ ...PRESETS.night[0], amount: o.amount, rows: o.rows, role: o.role });
    else out.push(o);
  }
  return out;
}
function recolourRow(base24, ops, cls = classifyPens(base24)) {
  const ws = rgbRowToWords(base24), out = apply(ws, flatOps(ops).map(o => ({ ...o, rows: [0], role: undefined, exclude: undefined, pens: o.pens || cls.clothing })));
  return wordsRGB(out).map((c, i) => (i === 15 || !cls.clothing.includes(i) ? base24[i] : snapToRom(c)));
}
// A class split from an explicit keep list: everything else is clothing.
function classesFromKeep(keep) { return { outline: [], eyes: [], skin: keep.slice(), clothing: ALL_PENS.filter(p => !keep.includes(p)), transparent: [15] }; }
// ENEMIES §6.1 acceptance: every colour from a ROM row; >= 6 of 16 clothing pens changed against every original
// row of that body; skin, outline and eye pens unchanged. `keep` = pens that must stay (default: classifyPens of
// the first original).
function acceptance(row24, originals, { keep = null, minChanged = 6 } = {}) {
  const cols = romColours(), notRom = [];
  for (let p = 0; p < 15; p++) if (!cols.has(row24[p])) notRom.push(p);
  const cls = classifyPens(originals[0]);
  const keepPens = keep || [...cls.outline, ...cls.skin, ...cls.eyes];
  const keptChanged = keepPens.filter(p => row24[p] !== originals[0][p]);
  const changed = originals.map(o => { let n = 0; for (let p = 0; p < 15; p++) if (!keepPens.includes(p) && row24[p] !== o[p]) n++; return n; });
  const minC = changed.length ? Math.min(...changed) : 0;
  return { ok: !notRom.length && !keptChanged.length && minC >= minChanged, notRom, keptChanged, changed, keepPens, clothing: cls.clothing };
}

// Hand palette specifications (drafts until the owning package approves a contact sheet: WP-B heroes, WP-C bosses).
// base: {hero:0..3} | {romRow} | {ctx:[ep, area, slot]} (the OBJ row of that context) | {layer:[ep, area, 's2'], row}
// make: 'mirror' | 'freed' | 'half' | 'gel' | 'flash' | 'recolour' (ops on the clothing pens, snapped to ROM colours)
const HERO_NAMES = ['jack', 'hannah', 'mustapha', 'mess'];
const HAND_SPECS = {
  rook: { body: 'butcher', note: 'black oilskin, navy headband, iron gaff blade', draft: true, slots: { 30: { base: { ctx: [2, 2, 30] }, make: 'recolour', ops: [{ op: 'hsl', h: 0, s: 0.25, l: 0.55 }, { op: 'tint', rgb: '#1a2a5a', amount: 0.3 }] } } },
  cinder: { body: 'morgan', note: 'soot coat, ember scarf, ash hair', draft: true, slots: { 28: { base: { ctx: [5, 1, 28] }, make: 'recolour', ops: [{ op: 'hsl', h: 0, s: 0.3, l: 0.7 }, { op: 'tint', rgb: '#432', amount: 0.25 }] }, 30: { base: { ctx: [5, 1, 30] }, make: 'recolour', ops: [{ op: 'hsl', h: 15, s: 1.2, l: 0.9 }, { op: 'tint', rgb: '#f60', amount: 0.3 }] }, 31: { base: { ctx: [5, 1, 31] }, make: 'recolour', ops: [{ op: 'hsl', h: 0, s: 0.2, l: 1.1 }] } } },
  sable: { body: 'vice-t', note: 'black long coat, charcoal trousers, silver hair, gold badge', draft: true, slots: { 25: { base: { ctx: [1, 2, 25] }, make: 'recolour', ops: [{ op: 'hsl', h: 0, s: 0.2, l: 0.5 }] }, 30: { base: { ctx: [1, 2, 30] }, make: 'recolour', ops: [{ op: 'hsl', h: 0, s: 0.15, l: 0.45 }, { op: 'tint', rgb: '#222', amount: 0.3 }] }, 31: { base: { ctx: [1, 2, 31] }, make: 'recolour', ops: [{ op: 'hsl', h: 0, s: 0.1, l: 1.2 }] } } },
  slicevat: { body: 'slice', note: 'home palette with the vest teal', draft: true, slots: { 30: { base: { ctx: [4, 2, 30] }, make: 'recolour', ops: [{ op: 'hsl', h: 150, s: 1.0, l: 1.0 }] }, 31: { base: { ctx: [4, 2, 31] }, make: 'recolour', ops: [{ op: 'hsl', h: 150, s: 1.0, l: 1.0 }, { op: 'tint', rgb: '#2a8', amount: 0.3 }] } } },
  crown: { body: 'crown-engine', note: 'gunmetal, gold trim, violet glass: ops over the E8a3 scroll2 rows of the capsule cells (rows chosen by WP-C)', draft: true, layer: [8, 3, 's2'], ops: [{ op: 'hsl', h: 0, s: 0.4, l: 0.9 }, { op: 'tint', rgb: '#6a4a9a', amount: 0.2 }], slots: {} },
  ironhide: { body: 'torikeratopss', note: 'MACK fallback if t98-e5a0-pal30 does not read as steel', draft: true, slots: { 30: { base: { ctx: [5, 0, 30] }, make: 'recolour', ops: [{ op: 'hsl', h: 0, s: 0.3, l: 0.9 }, { op: 'tint', rgb: '#8a96a6', amount: 0.25 }] } } },
  verdant: { body: 'arosaurus', note: 'SHIVAT fallback if t60-e2a1-pal30 does not read as nest-green', draft: true, slots: { 30: { base: { ctx: [2, 1, 30] }, make: 'recolour', ops: [{ op: 'hsl', h: 25, s: 1.1, l: 0.95 }, { op: 'tint', rgb: '#5c4', amount: 0.25 }] } } },
  drowned: { body: 'kingkimo', note: 'Brood Mother clothing slots: the TYROG rows (KI13) under the drowned preset', draft: true, slots: { 30: { base: { romRow: 30 }, make: 'recolour', ops: ['flood', 'ruin'] }, 31: { base: { romRow: 114 }, make: 'recolour', ops: ['flood', 'ruin'] } } },
  gel: { note: 'ROM row 467 ramp recoloured green, one row for every slot (ENEMIES §2.7); gelRow(base) gives a per-variant version', draft: false, slots: { '*': { base: { romRow: 467 }, make: 'gelRamp' } } },
  flash: { note: 'all pens light: the hit flash', draft: false, slots: { '*': { base: { romRow: 0 }, make: 'flash' } } },
};
// Hero rows (0xB7A52 rows 0-3): pen 0 outline, pens 1-4 the skin ramp, 5-13 clothing ramps, 14 white (eyes/teeth).
const HERO_KEEP = [0, 1, 2, 3, 4, 14];
HERO_NAMES.forEach((h, i) => {
  HAND_SPECS[`mirror-${h}`] = { body: h, note: 'controlled clone: clothing ramps in the inverse hue family', draft: true, keep: HERO_KEEP, slots: { [i]: { base: { hero: i }, make: 'mirror' } } };
  HAND_SPECS[`freed-${h}`] = { body: h, note: 'freed clone: the hero rows (the gold outline is a draw pass)', draft: false, keep: HERO_KEEP, slots: { [i]: { base: { hero: i }, make: 'freed' } } };
  HAND_SPECS[`half-${h}`] = { body: h, note: 'unfinished copy: the whole row at 60% saturation', draft: false, slots: { [i]: { base: { hero: i }, make: 'half' } } };
});
function baseRow(base) {
  if (base.hero != null) return rowRGB(base.hero);
  if (base.romRow != null) return rowRGB(base.romRow);
  if (base.ctx) return rowRGB(objMap(base.ctx[0], base.ctx[1])[base.ctx[2]]);
  if (base.layer) return wordsRGB(rowOf(words(base.layer[0], base.layer[1], base.layer[2]), base.row));
  throw new Error('palettes: hand base needs hero, romRow, ctx or layer');
}
function makeRow(spec, keep = null) {
  const b = baseRow(spec.base), cls = keep ? classesFromKeep(keep) : classifyPens(b);
  switch (spec.make) {
    case 'mirror': return mirrorRow(b, cls);
    case 'freed': return b.slice();
    case 'half': return halfRow(b);
    case 'gel': return gelRow(b);
    case 'gelRamp': { const ramp = gelRamp(); return Array.from({ length: 16 }, (_, p) => (p === 15 ? b[15] : p === 0 ? 0x113322 : ramp[Math.min(ramp.length - 1, Math.floor((p - 1) * ramp.length / 14))])); }
    case 'flash': return flashRow();
    case 'recolour': return recolourRow(b, spec.ops || [], cls);
    default: throw new Error(`palettes: unknown hand make '${spec.make}'`);
  }
}
const NO_ACCEPT = new Set(['freed', 'flash', 'gel', 'gelRamp', 'half']);   // whole-row effects, not §6.1 clothing swaps
// hand(name) -> {name, body, note, draft, keep, rows:{slot:[16 x 0xRRGGBB]}, base:{slot:[16]}, keys:{slot:'name:slot'}, accept:{slot}}
function hand(name) {
  const spec = HAND_SPECS[name]; if (!spec) throw new Error(`palettes: unknown hand palette '${name}'`);
  const keep = spec.keep || null;
  const out = { name, body: spec.body || null, note: spec.note || '', draft: !!spec.draft, keep, rows: {}, base: {}, keys: {}, accept: {} };
  for (const [slot, s] of Object.entries(spec.slots || {})) {
    const b = baseRow(s.base), row = makeRow(s, s.keep || keep);
    out.rows[slot] = row; out.base[slot] = b; out.keys[slot] = handKey(name, slot === '*' ? null : slot);
    out.accept[slot] = NO_ACCEPT.has(s.make) ? null : acceptance(row, [b], { keep: s.keep || keep });
  }
  return out;
}

// handRows() -> {name: {slot: [16 x 0xRRGGBB]}} for every hand palette (the PLAN §5.3 `HAND:{rook:[…rows]}` view).
function handRows(names = Object.keys(HAND_SPECS)) { const out = {}; for (const n of names) out[n] = hand(n).rows; return out; }
let handCache = null;

module.exports = {
  words, objMap, mapKey, parseMapKey, rowWords, rowRGB, wordsRGB, rowOf, rgbRowToWords, apply, preset, PRESETS, pickRows, rankRows, hueOf, handRows,
  classifyPens, classesFromKeep, snapToRom, snapRow, romColours, acceptance, HAND_SPECS, HERO_KEEP, hand, handKey, gelRow, flashRow, halfRow, mirrorRow, recolourRow, flatOps,
  wordRGB, rgbWord, word24, hex24, rgbToHsl, hslToRgb, stageIndex, layerKey, ROW_SCAN, HERO_NAMES,
};
// HAND is the resolved view of PLAN §5.3 ({rook: {30: [16 x 0xRRGGBB]}, …}); it needs the ROM, so it resolves on first use.
Object.defineProperty(module.exports, 'HAND', { enumerable: true, get() { return handCache || (handCache = handRows()); } });
