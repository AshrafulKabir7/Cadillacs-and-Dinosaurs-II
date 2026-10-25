#!/usr/bin/env node
// tools/art/import-bg.cjs - painted stage backgrounds (tools/art/gen-bg.cjs output) -> stage strips for
// tools/re/build/levels-compose.cjs `paint` areas (format: work/story3/PAINT-FORMAT.md).
//
//   node tools/art/import-bg.cjs [st1 st2 ...]           every work/bg/gen/<st>/<st>-<id>.png of those stages (default all)
//   node tools/art/import-bg.cjs --file <img> --as <st>/<id>   one image from anywhere (e.g. work/bg/test/stage1-strips.png)
// Options: --colours N   colours per stage palette (default 96; every strip of a stage shares it, so a 1024-px page
//                        that spans two strips still fits one indexed PNG)
//          --debug       print the floor-detector candidates per strip
//
// One image = two stacked strips (A = top half, B = bottom half). Per strip:
//   1. downscale to 672x224 arcade px (scale 0.4375 for 1536x512) with an exact area (box) filter in linear light;
//      another aspect keeps the 224-px height and rounds the width to 16 px
//   2. colours: snapped to the CPS-1 precision (4 bits per channel), then mapped without dithering to one palette per
//      stage (weighted k-means in OKLab over the 4-bit colour cells of all the stage's strips; deterministic init by
//      weighted median cut). No dithering: flat posterised ramps read as 16-bit art and deflate well.
//   3. floor line (y in strip px where the back scenery meets the walkable floor): tools/art/bg-floors.json override,
//      else detectFloor() on the downscaled strip (a full-width horizontal boundary with vertical structure above it
//      and flat floor texture below, searched in y 64..184)
// Writes tools/art/strips/ (tracked: the stage build reads them) <st>/<st>-<id>-A.png / -B.png (indexed PNG), work/bg/strips/<st>/floors.json
// ({strip: {floor, detected, override, w, h, bytes}}) and the review sheet work/bg/review/<st>.png (every strip at 1x
// with the floor line in red (= the walk band top: feet y floor..224, never above the clamp 81), the top of the 16-px
// walk cell holding it in cyan (the walk.patch grid), the walk band shaded and 16-px ticks). Deterministic: same inputs -> same bytes (adding an image to a stage re-derives its palette).
'use strict';
const fs = require('fs'), path = require('path');
const png = require('../re/build/png.cjs');
const { rgbToLab, labToRgb } = require('./colour.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const GEN = path.join(ROOT, 'work', 'bg', 'gen'), STRIPS = path.join(ROOT, 'tools', 'art', 'strips'), REVIEW = path.join(ROOT, 'work', 'bg', 'review');
const FLOORS = path.join(__dirname, 'bg-floors.json');
const TARGET_H = 224, CELL = 16, CLAMP_TOP = 81;
const SEARCH = [64, 184];

// ---------------------------------------------------------------- image io
function loadImage(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xFF && buf[1] === 0xD8) { const j = require('./jpeg.cjs').decode(buf); return { w: j.width, h: j.height, rgba: j.rgba }; }
  const p = png.decode(buf); return { w: p.width, h: p.height, rgba: p.rgba };
}

// ---------------------------------------------------------------- area downscale (linear light, exact box weights)
const LIN = new Float64Array(256); for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const toS = v => { v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, v * 255)); };
function weights(n, m) {   // source n px -> m px: per output index the list of [srcIndex, weight]
  const s = n / m, out = [];
  for (let i = 0; i < m; i++) { const a = i * s, b = (i + 1) * s, list = []; for (let k = Math.floor(a); k < Math.ceil(b - 1e-9); k++) { const w = Math.min(b, k + 1) - Math.max(a, k); if (w > 1e-9) list.push([k, w / s]); } out.push(list); }
  return out;
}
// returns Float64Array rgb (sRGB 0..255, not rounded) of w x h
function downscale(img, x0, y0, sw, sh, w, h) {
  const wx = weights(sw, w), wy = weights(sh, h), tmp = new Float64Array(w * sh * 3), out = new Float64Array(w * h * 3);
  for (let y = 0; y < sh; y++) for (let x = 0; x < w; x++) { let r = 0, g = 0, b = 0; for (const [k, wt] of wx[x]) { const o = ((y0 + y) * img.w + x0 + k) * 4; r += LIN[img.rgba[o]] * wt; g += LIN[img.rgba[o + 1]] * wt; b += LIN[img.rgba[o + 2]] * wt; } const q = (y * w + x) * 3; tmp[q] = r; tmp[q + 1] = g; tmp[q + 2] = b; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let r = 0, g = 0, b = 0; for (const [k, wt] of wy[y]) { const q = (k * w + x) * 3; r += tmp[q] * wt; g += tmp[q + 1] * wt; b += tmp[q + 2] * wt; } const o = (y * w + x) * 3; out[o] = toS(r); out[o + 1] = toS(g); out[o + 2] = toS(b); }
  return out;
}
function splitStrips(img) {
  const sh = Math.floor(img.h / 2), w = Math.round(img.w * TARGET_H / sh / CELL) * CELL;
  return ['A', 'B'].map((k, i) => ({ part: k, w, h: TARGET_H, px: downscale(img, 0, i * sh, img.w, sh, w, TARGET_H) }));
}

// ---------------------------------------------------------------- floor line
// On the downscaled strip (rgb floats). For a candidate y:
//   edge(y)  share of columns whose mean colour over rows [y, y+4) differs from rows [y-4, y) by > 20 (a full-width
//            boundary: the foot of a wall, a kerb, the road edge)
//   vert(y)  vertical structure: per row the mean over x of the smallest |horizontal luma gradient| of that row and
//            the next 3 (posts, door frames and walls keep their edges from row to row; floor texture does not)
//   score(y) = edge(y) * (above - below) / (above + below), above / below = mean vert over 28 rows above / below
// The floor line is the best-scoring y in SEARCH; ties go to the lower y.
function detectFloor(st, { debug = false } = {}) {
  const { w, h, px } = st, L = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * px[i * 3] + 0.587 * px[i * 3 + 1] + 0.114 * px[i * 3 + 2];
  const gx = new Float64Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) gx[y * w + x] = Math.abs(L[y * w + x + 1] - L[y * w + x]);
  const vert = new Float64Array(h);
  for (let y = 0; y < h - 3; y++) { let s = 0; for (let x = 0; x < w - 1; x++) { let m = gx[y * w + x]; for (let d = 1; d < 4; d++) m = Math.min(m, gx[(y + d) * w + x]); s += m; } vert[y] = s / (w - 1); }
  const colMean = (x, y0, y1) => { let r = 0, g = 0, b = 0; for (let y = y0; y < y1; y++) { const o = (y * w + x) * 3; r += px[o]; g += px[o + 1]; b += px[o + 2]; } const n = y1 - y0; return [r / n, g / n, b / n]; };
  const cands = [];
  for (let y = SEARCH[0]; y <= Math.min(SEARCH[1], h - 30); y++) {
    let n = 0; for (let x = 0; x < w; x++) { const a = colMean(x, y - 4, y), b = colMean(x, y, y + 4); if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 20) n++; }
    const edge = n / w; let above = 0, below = 0; for (let d = 2; d < 30; d++) { above += vert[y - d] || 0; below += vert[Math.min(h - 4, y + d)]; }
    above /= 28; below /= 28;
    const contrast = (above - below) / (above + below + 1e-6), score = edge * Math.max(0, contrast);
    cands.push({ y, edge: +edge.toFixed(3), above: +above.toFixed(2), below: +below.toFixed(2), score });
  }
  let best = cands[0]; for (const c of cands) if (c.score > best.score + 1e-12) best = c;
  if (debug) console.log('   top:', cands.slice().sort((p, q) => q.score - p.score || p.y - q.y).slice(0, 5).map(c => `y${c.y} s${c.score.toFixed(3)} e${c.edge} ${c.above}/${c.below}`).join('  '));
  return { floor: best.y, score: +best.score.toFixed(4) };
}
function loadOverrides() { if (!fs.existsSync(FLOORS)) return {}; const j = JSON.parse(fs.readFileSync(FLOORS, 'utf8')); return j.floors || {}; }
// the walk band top levels-compose gives a painted column: the floor line itself (feet never stand on the back
// scenery), never above the engine clamp (feet y 81); the walk mask cell holding it is walkable
const bandTop = floor => Math.max(CLAMP_TOP, floor);
// what a human should look at: a walk band under 72 px (the floor line is low; ROM bands are 64-112), a floor line
// above y 96 (scenery squeezed into the top), a weak detection (score < 0.15: no clear wall foot)
function flags(s) { const out = []; const b = 224 - bandTop(s.floor) + 1; if (b < 72) out.push(`BAND ${b} PX`); if (s.floor < 96) out.push('FLOOR HIGH'); if (s.override == null && s.score < 0.15) out.push('WEAK DETECTION'); return out; }

// ---------------------------------------------------------------- palette (one per stage)
function stagePalette(strips, n) {
  // 4-bit cells (4096) with pixel counts and the mean colour inside the cell
  const cnt = new Float64Array(4096), sum = new Float64Array(4096 * 3);
  for (const s of strips) for (let i = 0; i < s.w * s.h; i++) { const r = s.px[i * 3], g = s.px[i * 3 + 1], b = s.px[i * 3 + 2], k = (Math.round(r / 17) << 8) | (Math.round(g / 17) << 4) | Math.round(b / 17); cnt[k]++; sum[k * 3] += r; sum[k * 3 + 1] += g; sum[k * 3 + 2] += b; }
  const pts = []; for (let k = 0; k < 4096; k++) if (cnt[k]) pts.push({ k, w: Math.pow(cnt[k], 0.75), lab: rgbToLab(Math.round(sum[k * 3] / cnt[k]), Math.round(sum[k * 3 + 1] / cnt[k]), Math.round(sum[k * 3 + 2] / cnt[k])) });
  // weighted median cut in OKLab (split the box with the largest weighted spread at its weighted median)
  let boxes = [pts];
  const spread = b => { let W = 0; const m = [0, 0, 0]; for (const p of b) { W += p.w; for (let d = 0; d < 3; d++) m[d] += p.lab[d] * p.w; } for (let d = 0; d < 3; d++) m[d] /= W || 1; let best = 0, dim = 0; for (let d = 0; d < 3; d++) { let v = 0; for (const p of b) v += p.w * (p.lab[d] - m[d]) ** 2; v *= d === 0 ? 1.4 : 1; if (v > best) { best = v; dim = d; } } return { v: best, dim }; };
  while (boxes.length < Math.min(n, pts.length)) {
    let bi = -1, bs = null; boxes.forEach((b, i) => { if (b.length < 2) return; const s = spread(b); if (!bs || s.v > bs.v) { bs = s; bi = i; } });
    if (bi < 0) break;
    const b = boxes[bi].slice().sort((p, q) => p.lab[bs.dim] - q.lab[bs.dim] || p.k - q.k);
    let W = 0; for (const p of b) W += p.w; let acc = 0, cut = 1; for (let i = 0; i < b.length - 1; i++) { acc += b[i].w; if (acc >= W / 2) { cut = i + 1; break; } }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  let cents = boxes.map(b => { let W = 0; const m = [0, 0, 0]; for (const p of b) { W += p.w; for (let d = 0; d < 3; d++) m[d] += p.lab[d] * p.w; } return m.map(v => v / W); });
  const dist = (a, b) => 1.4 * (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  for (let it = 0; it < 10; it++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (const p of pts) { let bi = 0, bd = Infinity; for (let c = 0; c < cents.length; c++) { const d = dist(p.lab, cents[c]); if (d < bd) { bd = d; bi = c; } } const a = acc[bi]; a[0] += p.lab[0] * p.w; a[1] += p.lab[1] * p.w; a[2] += p.lab[2] * p.w; a[3] += p.w; }
    cents = cents.map((c, i) => (acc[i][3] ? [acc[i][0] / acc[i][3], acc[i][1] / acc[i][3], acc[i][2] / acc[i][3]] : c));
  }
  // to 4-bit sRGB, de-duplicated, sorted by key (stable order = stable PNG bytes)
  const pal = [...new Set(cents.map(c => { const v = labToRgb(...c).map(x => Math.round(x / 17)); return (v[0] << 8) | (v[1] << 4) | v[2]; }))].sort((p, q) => p - q);
  const labs = pal.map(k => rgbToLab(((k >> 8) & 15) * 17, ((k >> 4) & 15) * 17, (k & 15) * 17));
  const lut = new Int16Array(4096).fill(-1);
  for (let k = 0; k < 4096; k++) { if (!cnt[k]) continue; const lab = rgbToLab(((k >> 8) & 15) * 17, ((k >> 4) & 15) * 17, (k & 15) * 17); let bi = 0, bd = Infinity; for (let c = 0; c < labs.length; c++) { const d = dist(lab, labs[c]); if (d < bd) { bd = d; bi = c; } } lut[k] = bi; }
  return { pal, lut };
}
function applyPalette(st, P) {
  const rgba = new Uint8Array(st.w * st.h * 4);
  for (let i = 0; i < st.w * st.h; i++) { const k = (Math.round(st.px[i * 3] / 17) << 8) | (Math.round(st.px[i * 3 + 1] / 17) << 4) | Math.round(st.px[i * 3 + 2] / 17), c = P.pal[P.lut[k]]; rgba[i * 4] = ((c >> 8) & 15) * 17; rgba[i * 4 + 1] = ((c >> 4) & 15) * 17; rgba[i * 4 + 2] = (c & 15) * 17; rgba[i * 4 + 3] = 255; }
  return rgba;
}

// ---------------------------------------------------------------- review sheet
const FONT = { A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110', ' ': '000000000000000', ':': '000010000010000', '-': '000000111000000', '.': '000000000000010', '/': '001001010100100', '(': '010100100100010', ')': '010001001001010', '=': '000111000111000', '+': '000010111010000' };
function sheetCanvas(w, h, bg) { const rgba = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255; } return { w, h, rgba }; }
function put(c, x, y, col, a = 1) { if (x < 0 || y < 0 || x >= c.w || y >= c.h) return; const o = (y * c.w + x) * 4; for (let k = 0; k < 3; k++) c.rgba[o + k] = Math.round(c.rgba[o + k] * (1 - a) + col[k] * a); }
function text(c, x, y, s, col, sc = 2) { for (const ch of String(s).toUpperCase()) { const g = FONT[ch] || FONT[' ']; for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r * 3 + q] === '1') for (let j = 0; j < sc; j++) for (let i = 0; i < sc; i++) put(c, x + q * sc + i, y + r * sc + j, col); x += 4 * sc; } }
function reviewSheet(stage, rows, file) {
  const GAP = 12, LABEL = 18, W = Math.max(...rows.map(r => r.strips.reduce((n, s) => n + s.w, 0) + GAP * (r.strips.length + 1))), H = GAP + rows.length * (LABEL + TARGET_H + GAP) + 20;
  const c = sheetCanvas(W, H, [24, 24, 28]);
  text(c, GAP, 6, `${stage}: RED = FLOOR LINE = WALK BAND TOP   CYAN = TOP OF ITS 16-PX WALK CELL   SHADE = WALK BAND   TICKS = 16 PX`, [220, 220, 220], 2);
  let y = 26;
  for (const r of rows) {
    let x = GAP;
    for (const s of r.strips) {
      const fl = flags(s); text(c, x, y, `${s.id}  FLOOR ${s.floor}${s.override != null ? ' (OVERRIDE)' : ' (DETECTED)'}  BAND ${bandTop(s.floor)}-224${fl.length ? '  CHECK: ' + fl.join(', ') : ''}`, fl.length ? [255, 120, 100] : s.override != null ? [255, 210, 120] : [200, 200, 200], 2);
      const y0 = y + LABEL, bt = bandTop(s.floor), ct = Math.max(0, Math.floor((bt - 1) / CELL)) * CELL;
      for (let yy = 0; yy < s.h; yy++) for (let xx = 0; xx < s.w; xx++) { const o = (yy * s.w + xx) * 4; put(c, x + xx, y0 + yy, [s.rgba[o], s.rgba[o + 1], s.rgba[o + 2]]); if (yy > bt) put(c, x + xx, y0 + yy, [80, 200, 255], 0.12); }
      for (let xx = 0; xx < s.w; xx++) { put(c, x + xx, y0 + bt, [255, 40, 40]); put(c, x + xx, y0 + ct, [60, 230, 255], (xx >> 2) & 1 ? 1 : 0.3); }
      for (let xx = 0; xx <= s.w; xx += 16) for (let k = 0; k < 4; k++) put(c, x + xx, y0 + s.h + 1 + k, [160, 160, 160]);
      x += s.w + GAP;
    }
    y += LABEL + TARGET_H + GAP;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png.encode({ width: c.w, height: c.h, rgba: c.rgba }));
}

// ---------------------------------------------------------------- import one stage
// images: [{id, file}] -> writes the strips, floors.json and the review sheet; returns the per-strip report
function importStage(stage, images, { colours = 96, debug = false, outDir = STRIPS, reviewDir = REVIEW } = {}) {
  const over = loadOverrides(), all = [], rows = [];
  for (const im of images) {
    const img = loadImage(im.file), strips = splitStrips(img);
    const row = { id: im.id, src: path.relative(ROOT, im.file).split(path.sep).join('/'), size: [img.w, img.h], strips: [] };
    for (const s of strips) {
      s.id = `${stage}-${im.id}-${s.part}`;
      if (debug) console.log(` ${s.id}`);
      const d = detectFloor(s, { debug }), o = over[s.id];
      s.detected = d.floor; s.score = d.score; s.override = o == null ? null : (typeof o === 'object' ? o.floor : o); s.floor = s.override != null ? s.override : d.floor;
      row.strips.push(s); all.push(s);
    }
    rows.push(row);
  }
  if (!all.length) return null;
  const P = stagePalette(all, colours), dir = path.join(outDir, stage), floors = {};
  fs.mkdirSync(dir, { recursive: true });
  for (const s of all) {
    s.rgba = applyPalette(s, P);
    const buf = png.encode({ width: s.w, height: s.h, rgba: s.rgba, palette: true }), file = path.join(dir, `${s.id}.png`);
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(buf)) fs.writeFileSync(file, buf);
    s.bytes = buf.length;
    floors[s.id] = { floor: s.floor, detected: s.detected, score: s.score, override: s.override, bandTop: bandTop(s.floor), flags: flags(s), w: s.w, h: s.h, bytes: s.bytes };
  }
  const meta = { note: 'written by tools/art/import-bg.cjs; floor = the strip y where the back scenery meets the walkable floor (override from tools/art/bg-floors.json, else detected)', colours: P.pal.length, images: rows.map(r => ({ id: r.id, src: r.src, size: r.size })), strips: floors };
  fs.writeFileSync(path.join(dir, 'floors.json'), JSON.stringify(meta, null, 1) + '\n');
  reviewSheet(stage, rows, path.join(reviewDir, `${stage}.png`));
  return { stage, colours: P.pal.length, strips: all.map(s => ({ id: s.id, floor: s.floor, detected: s.detected, override: s.override, score: s.score, flags: flags(s), bytes: s.bytes })), bytes: all.reduce((n, s) => n + s.bytes, 0) };
}
function stageImages(stage) {
  const dir = path.join(GEN, stage); if (!fs.existsSync(dir)) return [];
  const re = new RegExp(`^${stage}-(.+)\\.(png|jpe?g)$`, 'i');
  return fs.readdirSync(dir).filter(f => re.test(f)).sort().map(f => ({ id: re.exec(f)[1], file: path.join(dir, f) }));
}

// ---------------------------------------------------------------- floor of a strip file (levels-compose default)
// override (tools/art/bg-floors.json, by strip id = file basename) > floors.json next to the strip > detection
function floorOf(file) {
  const id = path.basename(file).replace(/\.png$/i, ''), over = loadOverrides();
  if (over[id] != null) return typeof over[id] === 'object' ? over[id].floor : over[id];
  const fj = path.join(path.dirname(file), 'floors.json');
  if (fs.existsSync(fj)) { const j = JSON.parse(fs.readFileSync(fj, 'utf8')); if (j.strips && j.strips[id]) return j.strips[id].floor; }
  const img = loadImage(file), px = new Float64Array(img.w * img.h * 3);
  for (let i = 0; i < img.w * img.h; i++) { px[i * 3] = img.rgba[i * 4]; px[i * 3 + 1] = img.rgba[i * 4 + 1]; px[i * 3 + 2] = img.rgba[i * 4 + 2]; }
  return detectFloor({ w: img.w, h: img.h, px }).floor;
}

module.exports = { importStage, stageImages, detectFloor, floorOf, bandTop, splitStrips, loadImage, downscale, stagePalette, applyPalette, TARGET_H };

if (require.main === module) {
  const a = process.argv.slice(2), val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const opt = { colours: +(val('--colours') || 96), debug: a.includes('--debug') };
  const report = [];
  if (val('--file')) {
    const [st, id] = String(val('--as') || '').split('/'); if (!st || !id) { console.error('--file needs --as <stage>/<id>'); process.exit(2); }
    report.push(importStage(st, [{ id, file: path.resolve(val('--file')) }], opt));
  } else {
    const skip = new Set(['--colours', '--file', '--as']);
    const want = a.filter((x, i) => !x.startsWith('--') && !skip.has(a[i - 1]));
    const stages = want.length ? want : (fs.existsSync(GEN) ? fs.readdirSync(GEN).filter(d => /^st\d+$/.test(d)).sort((p, q) => +p.slice(2) - +q.slice(2)) : []);
    for (const st of stages) { const ims = stageImages(st); if (!ims.length) { console.log(`${st}: no images yet`); continue; } report.push(importStage(st, ims, opt)); }
  }
  for (const r of report.filter(Boolean)) {
    console.log(`${r.stage}: ${r.strips.length} strips, ${r.colours} colours, ${(r.bytes / 1024).toFixed(0)} KB -> work/bg/strips/${r.stage}/, review work/bg/review/${r.stage}.png`);
    for (const s of r.strips) console.log(`   ${s.id.padEnd(16)} floor ${String(s.floor).padStart(3)}${s.override != null ? ` (override; detected ${s.detected})` : ' (detected)'}  band ${bandTop(s.floor)}-224  ${(s.bytes / 1024).toFixed(1)} KB  score ${s.score}${s.flags.length ? '  CHECK: ' + s.flags.join(', ') : ''}`);
  }
}
