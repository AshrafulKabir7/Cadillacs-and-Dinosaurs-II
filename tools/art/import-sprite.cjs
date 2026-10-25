#!/usr/bin/env node
// tools/art/import-sprite.cjs - generated pose images -> game-ready CPS-1-style boss frames (deterministic, node built-ins
// plus the repo's PNG codec). One run = one character ("body"):
//
//   node tools/art/import-sprite.cjs <spec.json> [--out <dir>] [--preview <png>] [--no-preview]
//
// Pipeline per input image (PNG, or baseline JPEG as the Antigravity CLI writes them):
//   1. crop, then background removal: a flat key colour (#FF00FF by default) keyed globally with a soft band whose edge
//      pixels are un-mixed from the key, or bg:'auto' (the border colour, flood-filled from the edges: concept boards on
//      flat panels). Enclosed key-coloured pockets go too; specks and stray text go by connected-component size.
//   2. split into poses: one pose per image, a fixed {cols, rows} grid, explicit boxes, or 'auto' (empty row / column
//      gutters of the matte).
//   3. scale: every pose of one image shares one factor (a pose sheet keeps its internal proportions); the factor maps
//      the reference pose's matte height to `h` arcade px (spec.height by default), clamped by spec.maxW.
//   4. downscale by area-weighted majority sampling: an output pixel is opaque when >= `cover` of its footprint is
//      matte, and takes the mean of the most common 3-bit colour bin under it (dark bins weighted up so linework
//      survives). No smoothing, so no halos.
//   5. one palette for all frames of the character: <= 15 opaque colours (pen 15 is CPS-1 transparent), hue families
//      split into lightness ramps ('ramps', default) or k-means ('kmeans'), snapped to 4 bits per channel, outline pen
//      reserved. Nearest-colour mapping without dithering, then speck removal.
//   6. a clean 1-px dark outline: boundary pixels of parts >= 2 px thick become outline; 1-px-thin parts get it outside.
//   7. anchors: origin (ox, oy) on the feet line (art faces LEFT, like every ROM boss frame); x from the feet span or
//      the torso; frames of one anim registered to its first frame by best overlap of the torso band (no jitter).
//   8. shelf-packed atlas in the ROM boss sheet encoding (R = palette slot, G = pen, A = 0 transparent) + palette rows
//      and a map, frames [sheet, x, y, w, h, ox, oy, rec, flags], anims {f:[[fid, dur]], loop}, a body record - the
//      SPRITE_DATA 'bosses' family shape (see sprites.js, sprite-data-bosses.js notes, enemy-kinds.js BOSS_DEFS).
//
// Outputs in <out> (default work/art/out/<id>): <id>.json (local frame ids), <id>-atlas.png (indexed encoding),
// <id>-atlas-rgba.png (coloured, for eyes), <id>.sprite.js (SPRITE_DATA.add('bosses-ch<N>', ...) that rebases frame ids
// onto the loaded bosses family; load it after sprite-data-bosses.js), <id>-frames/<name>.png (each frame, coloured),
// and a contact sheet (tools/art/contact-sheet.cjs) at work/art/preview/<id>-contact.png.
// Spec format: see work/art/PRODUCTION.md and work/art/specs/*.json.
'use strict';
const fs = require('fs'), path = require('path');
const png = require('../re/build/png.cjs');
const jpeg = require('./jpeg.cjs');
const col = require('./colour.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

// ------------------------------------------------------------------ image I/O
function loadImage(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0x89 && buf[1] === 0x50) return png.decode(buf);
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    try { return Object.assign(jpeg.decode(buf), { jpeg: true }); } catch (err) {
      // progressive JPEG: convert with Windows' own GDI+ (no download), then decode the PNG
      const tmp = path.join(require('os').tmpdir(), `import-sprite-${process.pid}.png`);
      require('child_process').execFileSync('powershell', ['-NoProfile', '-Command',
        `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile('${path.resolve(file)}'); $i.Save('${tmp}',[System.Drawing.Imaging.ImageFormat]::Png); $i.Dispose()`]);
      const im = png.read(tmp); fs.unlinkSync(tmp); im.jpeg = true; return im;
    }
  }
  throw new Error(`${file}: not a PNG or JPEG`);
}
function crop(im, r) {
  const [x0, y0, w, h] = r.map(v => Math.round(v)), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y; if (sx < 0 || sy < 0 || sx >= im.width || sy >= im.height) continue;
    out.set(im.rgba.subarray((sy * im.width + sx) * 4, (sy * im.width + sx) * 4 + 4), (y * w + x) * 4);
  }
  return { width: w, height: h, rgba: out, jpeg: im.jpeg };
}

// ------------------------------------------------------------------ 1. background removal -> {a: Float32 alpha, rgb (un-mixed)}
function borderColour(im) {
  const { width: w, height: h, rgba } = im, bins = new Map();
  const add = (x, y) => { const o = (y * w + x) * 4, k = ((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3); bins.set(k, (bins.get(k) || 0) + 1); };
  for (let x = 0; x < w; x++) { add(x, 0); add(x, 1); add(x, h - 1); add(x, h - 2); }
  for (let y = 0; y < h; y++) { add(0, y); add(1, y); add(w - 1, y); add(w - 2, y); }
  let best = 0, bk = 0; for (const [k, n] of bins) if (n > best || (n === best && k < bk)) { best = n; bk = k; }
  // mean of the border pixels in the winning bin
  let r = 0, g = 0, b = 0, n = 0;
  const acc = (x, y) => { const o = (y * w + x) * 4, k = ((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3); if (k === bk) { r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; n++; } };
  for (let x = 0; x < w; x++) { acc(x, 0); acc(x, h - 1); } for (let y = 0; y < h; y++) { acc(0, y); acc(w - 1, y); }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
function keyBackground(im, opt) {
  const { width: w, height: h, rgba } = im, n = w * h;
  const key = opt.bg === 'auto' || !opt.bg ? borderColour(im) : col.parseHex(opt.bg);
  const mode = opt.keyMode || (opt.bg === 'auto' ? 'flood' : 'global');
  const inner = opt.keyInner != null ? opt.keyInner : mode === 'flood' ? 8 : 70;
  const outer = opt.keyOuter != null ? opt.keyOuter : mode === 'flood' ? 20 : 170;
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) { const o = i * 4; dist[i] = Math.hypot(rgba[o] - key[0], rgba[o + 1] - key[1], rgba[o + 2] - key[2]); }
  const a = new Float32Array(n).fill(1);
  if (mode === 'global') {
    for (let i = 0; i < n; i++) a[i] = dist[i] <= inner ? 0 : dist[i] >= outer ? 1 : (dist[i] - inner) / (outer - inner);
  } else {
    // flood from the border through key-like pixels; then key-like enclosed pockets of >= minHole px
    const bg = new Uint8Array(n), q = new Int32Array(n); let qh = 0, qt = 0;
    const push = i => { if (!bg[i] && dist[i] <= outer) { bg[i] = 1; q[qt++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (qh < qt) { const i = q[qh++], x = i % w, y = (i / w) | 0; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w); }
    for (let i = 0; i < n; i++) a[i] = bg[i] ? (dist[i] <= inner ? 0 : Math.min(1, (dist[i] - inner) / (outer - inner))) : 1;
  }
  // enclosed key pockets (between arm and body ...): components of near-key pixels not reached from the border
  {
    const seen = new Uint8Array(n), stack = []; const minHole = opt.minHole != null ? opt.minHole : mode === 'flood' ? 80 : 24, pocket = mode === 'flood' ? inner + 2 : inner * 1.4;
    for (let s = 0; s < n; s++) {
      if (seen[s] || a[s] < 0.5 || dist[s] > pocket) continue;
      const comp = []; stack.push(s); seen[s] = 1;
      while (stack.length) { const i = stack.pop(); comp.push(i); const x = i % w, y = (i / w) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !seen[j] && a[j] >= 0.5 && dist[j] <= pocket) { seen[j] = 1; stack.push(j); } }
      if (comp.length >= minHole) for (const i of comp) a[i] = 0;
    }
  }
  // un-mix the key from soft edge pixels
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 4, al = a[i];
    for (let c = 0; c < 3; c++) {
      const v = al > 0.05 && al < 1 ? (rgba[o + c] - (1 - al) * key[c]) / al : rgba[o + c];
      rgb[i * 3 + c] = Math.max(0, Math.min(255, v));
    }
  }
  // edge de-spill: a pixel in the N-px band along the matte edge is a mix of the key and the colour just inside it,
  // P = a F + (1 - a) K. Solve a by projecting onto the K -> F line (F = mean of the solid pixels just inside the
  // band), drop it below 0.5, else un-mix it. N = opt.despill (default 1 px; 3 px for JPEG, whose chroma bleeds).
  const N = opt.despill === false ? 0 : typeof opt.despill === 'number' ? opt.despill : im.jpeg ? 3 : 1;
  if (N > 0) {
    const depth = new Uint8Array(n), q = []; let qh = 0;
    for (let i = 0; i < n; i++) if (a[i] < 0.5) { depth[i] = 0; } else depth[i] = 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (depth[i] !== 255) continue;
      let edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if (a[(y + dy) * w + x + dx] < 0.5) { edge = true; break; }
      if (edge) { depth[i] = 1; q.push(i); }
    }
    while (qh < q.length) {
      const i = q[qh++], d = depth[i]; if (d >= N) continue; const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (depth[j] === 255) { depth[j] = d + 1; q.push(j); } }
    }
    const na = a.slice(), R = N + 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (depth[i] === 0 || depth[i] > N) continue;
      let F = [0, 0, 0], m = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (depth[j] > N) { F[0] += rgb[j * 3]; F[1] += rgb[j * 3 + 1]; F[2] += rgb[j * 3 + 2]; m++; } }
      if (!m) continue; F = F.map(v => v / m);
      const P = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]], d = [F[0] - key[0], F[1] - key[1], F[2] - key[2]], dd = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
      if (dd < 900) continue;                                         // the inside is key-coloured itself: leave it
      const al = Math.max(0, Math.min(1, ((P[0] - key[0]) * d[0] + (P[1] - key[1]) * d[1] + (P[2] - key[2]) * d[2]) / dd));
      if (al < 0.5 && depth[i] === 1) { na[i] = 0; continue; }
      // un-mix; deeper band pixels (JPEG chroma bleed) keep their own lightness and take the inside's chroma pull-back
      if (al < 0.98) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.max(0, Math.min(255, key[c] + (P[c] - key[c]) / Math.max(al, 0.5)));
    }
    // then remove the key's own chroma direction from every band pixel (dark outline pixels tinted by the key are not
    // a K/F mix, and JPEG's half-resolution chroma tints them for several pixels)
    const kcb = -0.1687 * key[0] - 0.3313 * key[1] + 0.5 * key[2], kcr = 0.5 * key[0] - 0.4187 * key[1] - 0.0813 * key[2], kl = Math.hypot(kcb, kcr);
    if (kl > 40) for (let i = 0; i < n; i++) {
      if (depth[i] === 0 || depth[i] > N) continue;
      const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2], Y = 0.299 * r + 0.587 * g + 0.114 * b;
      let cb = -0.1687 * r - 0.3313 * g + 0.5 * b, cr = 0.5 * r - 0.4187 * g - 0.0813 * b;
      const p = (cb * kcb + cr * kcr) / kl; if (p <= 0) continue;
      cb -= p * kcb / kl; cr -= p * kcr / kl;
      rgb[i * 3] = Math.max(0, Math.min(255, Y + 1.402 * cr)); rgb[i * 3 + 1] = Math.max(0, Math.min(255, Y - 0.344136 * cb - 0.714136 * cr)); rgb[i * 3 + 2] = Math.max(0, Math.min(255, Y + 1.772 * cb));
    }
    a.set(na);
  }
  return { w, h, a, rgb, key };
}

// connected components (8-conn) of a binary mask; returns {label Int32Array, comps:[{n, x0,y0,x1,y1}]}
function components(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1), comps = [], stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    const id = comps.length, c = { n: 0, x0: w, y0: h, x1: -1, y1: -1 }; comps.push(c);
    label[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0; c.n++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const j = Y * w + X; if (mask[j] && label[j] < 0) { label[j] = id; stack.push(j); }
      }
    }
  }
  return { label, comps };
}

// ------------------------------------------------------------------ 2. pose boxes
// -> [{box:[x,y,w,h], own: label set | null}] ; `own` restricts a pose to its own matte components (poses whose boxes
// overlap - a hook reaching over the neighbour - stay separate)
function splitBoxes(mask, w, h, split, names, CC) {
  const plain = list => list.map(box => ({ box, own: null }));
  if (!split || split === 'none') return plain([[0, 0, w, h]]);
  if (split.boxes) return plain(split.boxes);
  if (split.cols) {
    const cw = w / split.cols, ch = h / (split.rows || 1), out = [];
    for (let r = 0; r < (split.rows || 1); r++) for (let c = 0; c < split.cols; c++) out.push([Math.round(c * cw), Math.round(r * ch), Math.round(cw), Math.round(ch)]);
    return plain(out);
  }
  if (split === 'auto' || split.mode === 'components') {
    // every large matte component is a pose; small ones (a detached hook tip, a spark) join the nearest large one
    const { comps } = CC, big = comps.reduce((p, c) => Math.max(p, c.n), 0), frac = (split && split.bigFrac) || 0.15;
    const bigs = comps.map((c, i) => i).filter(i => comps[i].n >= big * frac);
    const own = bigs.map(i => new Set([i])), bb = bigs.map(i => [comps[i].x0, comps[i].y0, comps[i].x1, comps[i].y1]);
    const reach = (split && split.attach) || Math.round(Math.min(w, h) * 0.06);
    comps.forEach((c, i) => {
      if (bigs.includes(i) || !c.n) return;
      let bi = -1, bd = Infinity;
      bigs.forEach((j, k) => { const B = comps[j]; const dx = Math.max(0, B.x0 - c.x1, c.x0 - B.x1), dy = Math.max(0, B.y0 - c.y1, c.y0 - B.y1), d = Math.hypot(dx, dy); if (d < bd) { bd = d; bi = k; } });
      if (bi >= 0 && bd <= reach) { own[bi].add(i); const b = bb[bi]; b[0] = Math.min(b[0], c.x0); b[1] = Math.min(b[1], c.y0); b[2] = Math.max(b[2], c.x1); b[3] = Math.max(b[3], c.y1); }
    });
    // reading order: rows (by vertical overlap), then left to right
    const order = bigs.map((_, k) => k).sort((p, q) => { const P = bb[p], Q = bb[q], ov = Math.min(P[3], Q[3]) - Math.max(P[1], Q[1]); return ov > 0.3 * Math.min(P[3] - P[1], Q[3] - Q[1]) ? P[0] - Q[0] : P[1] - Q[1]; });
    const out = order.map(k => ({ box: [bb[k][0], bb[k][1], bb[k][2] - bb[k][0] + 1, bb[k][3] - bb[k][1] + 1], own: own[k] }));
    if (names && out.length !== names.length) console.warn(`  split: found ${out.length} poses, spec names ${names.length}`);
    return out;
  }
  // 'gutters': row bands by empty rows, then column bands inside each by empty columns (gutters >= gap px)
  const gap = (split && split.gap) || Math.max(4, Math.round(Math.min(w, h) * 0.008));
  const bands = (occ, len, minLen) => {
    const out = []; let s = -1, empty = 0;
    for (let i = 0; i <= len; i++) {
      const on = i < len && occ[i] > 0;
      if (on) { if (s < 0) s = i; empty = 0; } else if (s >= 0) { empty++; if (empty >= gap || i === len) { out.push([s, i - empty + 1]); s = -1; empty = 0; } }
    }
    return out.filter(b => b[1] - b[0] >= minLen);
  };
  const rowOcc = new Int32Array(h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) rowOcc[y]++;
  const out = [];
  for (const [y0, y1] of bands(rowOcc, h, Math.round(h * 0.05))) {
    const colOcc = new Int32Array(w); for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) colOcc[x]++;
    let cb = bands(colOcc, w, 2);
    // merge slivers (< 25 % of the median band width) into their nearest neighbour
    const med = cb.map(b => b[1] - b[0]).sort((p, q) => p - q)[cb.length >> 1] || 0;
    for (let i = 0; i < cb.length; i++) if (cb.length > 1 && cb[i][1] - cb[i][0] < med * 0.25) {
      const L = i > 0 ? cb[i][0] - cb[i - 1][1] : Infinity, R = i < cb.length - 1 ? cb[i + 1][0] - cb[i][1] : Infinity;
      if (L <= R) cb[i - 1][1] = cb[i][1]; else cb[i + 1][0] = cb[i][0];
      cb.splice(i, 1); i = -1;
    }
    for (const [x0, x1] of cb) out.push([x0, y0, x1 - x0, y1 - y0]);
  }
  if (names && out.length !== names.length) console.warn(`  split: found ${out.length} poses, spec names ${names.length}`);
  return plain(out);
}

// ------------------------------------------------------------------ 3-4. matte + scale + majority downscale
function cellMatte(K, cell, opt, CC) {
  const [bx, by, bw, bh] = cell.box, m = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const X = bx + x, Y = by + y; if (X < 0 || Y < 0 || X >= K.w || Y >= K.h) continue;
    const i = Y * K.w + X; m[y * bw + x] = K.a[i] >= 0.5 && (!cell.own || cell.own.has(CC.label[i])) ? 1 : 0;
  }
  for (const r of opt.erase || []) for (let y = r[1] - by; y < r[1] - by + r[3]; y++) for (let x = r[0] - bx; x < r[0] - bx + r[2]; x++) if (x >= 0 && y >= 0 && x < bw && y < bh) m[y * bw + x] = 0;
  const { label, comps } = components(m, bw, bh);
  const big = comps.reduce((p, c) => Math.max(p, c.n), 0), keepFrac = opt.keepFrac != null ? opt.keepFrac : 0.02;
  const keep = comps.map(c => c.n >= big * keepFrac);
  let x0 = bw, y0 = bh, x1 = -1, y1 = -1;
  for (let i = 0; i < m.length; i++) { if (!m[i]) continue; if (!keep[label[i]]) { m[i] = 0; continue; } const x = i % bw, y = (i / bw) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error('empty pose (nothing left after background removal)');
  return { m, bw, bh, bbox: [x0, y0, x1 - x0 + 1, y1 - y0 + 1] };
}
function downscale(K, box, M, s, opt, flip, vote) {
  const [bx, by] = box, [x0, y0, w0, h0] = M.bbox;
  const ow = Math.max(1, Math.round(w0 * s)), oh = Math.max(1, Math.round(h0 * s)), P = 2;
  const W = ow + P * 2, H = oh + P * 2, rgb = new Uint8Array(W * H * 3), on = new Uint8Array(W * H), pen = new Int16Array(W * H).fill(-1);
  const cover = opt.cover != null ? opt.cover : 0.5, darkBias = opt.darkBias != null ? opt.darkBias : 1.6, darkL = opt.darkLuma != null ? opt.darkLuma : 56;
  const fx = w0 / ow, fy = h0 / oh, bins = new Float64Array(512), plain = new Float64Array(512), sums = new Float64Array(512 * 3), touched = [];
  for (let j = 0; j < oh; j++) for (let i = 0; i < ow; i++) {
    const sx0 = x0 + i * fx, sx1 = sx0 + fx, sy0 = y0 + j * fy, sy1 = sy0 + fy;
    let tot = 0, fg = 0;
    for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
      const wy = Math.min(y + 1, sy1) - Math.max(y, sy0); if (wy <= 0) continue;
      for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
        const wx = Math.min(x + 1, sx1) - Math.max(x, sx0); if (wx <= 0) continue;
        const wgt = wx * wy; tot += wgt;
        if (x < 0 || y < 0 || x >= M.bw || y >= M.bh || !M.m[y * M.bw + x]) continue;
        fg += wgt;
        const k = ((by + y) * K.w + (bx + x)) * 3, r = K.rgb[k], g = K.rgb[k + 1], b = K.rgb[k + 2];
        // pass 1 votes on 3-bit colour bins (dark bins weighted up); pass 2 (vote) on final palette pens with per-pen bias
        const bin = vote ? vote.near(r, g, b) : ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
        const lw = vote ? wgt * vote.bias[bin] : (0.299 * r + 0.587 * g + 0.114 * b) < darkL ? wgt * darkBias : wgt;
        if (!plain[bin]) touched.push(bin);
        bins[bin] += lw; plain[bin] += wgt; sums[bin * 3] += r * wgt; sums[bin * 3 + 1] += g * wgt; sums[bin * 3 + 2] += b * wgt;
      }
    }
    if (tot > 0 && fg / tot >= cover) {
      let bb = touched[0]; for (const t of touched) if (bins[t] > bins[bb] || (bins[t] === bins[bb] && t < bb)) bb = t;
      const pw = plain[bb], X = (flip ? ow - 1 - i : i) + P, o = (j + P) * W + X;
      on[o] = 1; if (vote) pen[o] = bb; rgb[o * 3] = Math.round(sums[bb * 3] / pw); rgb[o * 3 + 1] = Math.round(sums[bb * 3 + 1] / pw); rgb[o * 3 + 2] = Math.round(sums[bb * 3 + 2] / pw);
    }
    for (const t of touched) { bins[t] = plain[t] = 0; sums[t * 3] = sums[t * 3 + 1] = sums[t * 3 + 2] = 0; } touched.length = 0;
  }
  return { w: W, h: H, rgb, on, pen };
}

// ------------------------------------------------------------------ 5-6. indexed cleanup + outline
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function cleanIndexed(F, outlinePen, opt) {
  const { w, h } = F; let p = F.pen;
  const at = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? -1 : p[y * w + x];
  // isolated opaque pixels go; 1-px pinholes fill
  for (let pass = 0; pass < 2; pass++) {
    const q = p.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = at(x, y), nb = N4.map(([dx, dy]) => at(x + dx, y + dy)), opq = nb.filter(c => c >= 0);
      if (v >= 0 && opq.length === 0) q[y * w + x] = -1;
      else if (v < 0 && opq.length === 4 && opt.pinholes !== false) q[y * w + x] = mode(opq);
    }
    p = q;
  }
  // specks: an interior pixel with no 8-neighbour of its own pen takes the commonest neighbour pen
  {
    const q = p.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = at(x, y); if (v < 0) continue;
      const nb = []; let same = 0, trans = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const c = at(x + dx, y + dy); if (c < 0) trans++; else { nb.push(c); if (c === v) same++; } }
      if (!same && trans === 0 && v !== outlinePen) q[y * w + x] = mode(nb);
    }
    p = q;
  }
  // optional simplification (clean.smooth passes): a non-outline pixel whose 3x3 neighbourhood is dominated (>= 5 of
  // 8) by one other pen takes it - flattens texture noise into the larger clusters CPS-1 art is drawn in
  for (let pass = 0; pass < (opt.smooth || 0); pass++) {
    const q = p.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = at(x, y); if (v < 0 || v === outlinePen) continue;
      const nb = []; let trans = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const c = at(x + dx, y + dy); if (c < 0) trans++; else nb.push(c); }
      if (trans) continue;
      const m = mode(nb); if (m !== v && m !== outlinePen && nb.filter(c => c === m).length >= 5) q[y * w + x] = m;
    }
    p = q;
  }
  F.pen = p; return F;
}
function mode(arr) { const m = new Map(); let b = arr[0], bn = 0; for (const v of arr) { const n = (m.get(v) || 0) + 1; m.set(v, n); if (n > bn || (n === bn && v < b)) { bn = n; b = v; } } return b; }
function outline(F, pen, how) {
  if (how === 'none') return F;
  const { w, h } = F, p = F.pen, q = p.slice(), at = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? -1 : p[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) < 0) continue;
    for (const [dx, dy] of N4) {
      if (at(x + dx, y + dy) >= 0) continue;                       // not an edge on this side
      const thick = at(x - dx, y - dy) >= 0 && at(x - 2 * dx, y - 2 * dy) >= 0;   // >= 3 px deep: outline inside
      if (how === 'outer' || (how !== 'inner' && !thick)) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) q[Y * w + X] = pen; }
      else q[y * w + x] = pen;
    }
  }
  F.pen = q; return F;
}

// ------------------------------------------------------------------ 7. anchors
function rowsOf(F) { let top = -1, bot = -1; for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) if (F.pen[y * F.w + x] >= 0) { if (top < 0) top = y; bot = y; } return [top, bot]; }
function anchorOf(F, how, air) {
  const [top, bot] = rowsOf(F), H = bot - top + 1;
  let ox;
  if (how === 'torso') {
    let s = 0, n = 0; for (let y = Math.round(bot - H * 0.7); y <= Math.round(bot - H * 0.35); y++) for (let x = 0; x < F.w; x++) if (F.pen[y * F.w + x] >= 0) { s += x; n++; }
    ox = Math.round(s / Math.max(1, n));
  } else if (Array.isArray(how)) { ox = how[0]; if (how[1] != null) return { ox, oy: how[1], top, bot }; }
  else {
    const k = Math.max(2, Math.round(H * 0.05)); let mn = F.w, mx = -1;
    for (let y = bot - k; y <= bot; y++) for (let x = 0; x < F.w; x++) if (F.pen[y * F.w + x] >= 0) { if (x < mn) mn = x; if (x > mx) mx = x; }
    ox = Math.round((mn + mx) / 2);
  }
  return { ox, oy: bot + 1 + (air || 0), top, bot };
}
// best horizontal shift t so that frame G's torso band matches the key frame's (feet lines aligned)
function registerShift(Kf, Ka, G, Ga, opt) {
  const H = Ka.bot - Ka.top + 1, r0 = Math.round(H * (opt.bandTop != null ? opt.bandTop : 0.75)), r1 = Math.round(H * (opt.bandBottom != null ? opt.bandBottom : 0.35));
  const R = Math.round(Math.max(Kf.w, G.w) * 0.3);
  let best = 0, bs = -Infinity;
  for (let t = -R; t <= R; t++) {
    let s = 0;
    for (let r = r1; r <= r0; r++) {
      const yk = Ka.bot - r, yg = Ga.bot - r; if (yk < 0 || yg < 0 || yg >= G.h) continue;
      for (let x = 0; x < Kf.w; x++) { if (Kf.pen[yk * Kf.w + x] < 0) continue; const xg = x - Ka.ox + Ga.ox + t; if (xg >= 0 && xg < G.w) s += G.pen[yg * G.w + xg] >= 0 ? 1 : -0.35; }
    }
    if (s > bs + 1e-9 || (Math.abs(s - bs) < 1e-9 && Math.abs(t) < Math.abs(best))) { bs = s; best = t; }
  }
  return best;
}

// ------------------------------------------------------------------ 8. trim + pack
function trim(F, A) {
  let x0 = F.w, y0 = F.h, x1 = -1, y1 = -1;
  for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) if (F.pen[y * F.w + x] >= 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, pen = new Int16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pen[y * w + x] = F.pen[(y + y0) * F.w + x + x0];
  return { w, h, pen, ox: A.ox - x0, oy: A.oy - y0 };
}
function pack(frames, maxW) {
  const order = frames.map((f, i) => i).sort((a, b) => frames[b].h - frames[a].h || frames[b].w - frames[a].w || a - b);
  const W = Math.max(maxW, ...frames.map(f => f.w + 1)), pos = [];
  let x = 0, y = 0, shelf = 0;
  for (const i of order) { const f = frames[i]; if (x + f.w > W) { x = 0; y += shelf + 1; shelf = 0; } pos[i] = [x, y]; x += f.w + 1; shelf = Math.max(shelf, f.h); }
  const usedW = Math.max(...frames.map((f, i) => pos[i][0] + f.w));
  return { pos, w: usedW, h: y + shelf };
}

// ------------------------------------------------------------------ main
function run(specFile, args = {}) {
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8')), specDir = path.dirname(path.resolve(specFile));
  const id = spec.id, out = path.resolve(ROOT, args.out || spec.out || `work/art/out/${id}`);
  const resolveIn = f => path.isAbsolute(f) ? f : fs.existsSync(path.resolve(specDir, f)) && !fs.existsSync(path.resolve(ROOT, f)) ? path.resolve(specDir, f) : path.resolve(ROOT, f);
  const maxColours = Math.min(15, spec.colors || 15);
  fs.mkdirSync(out, { recursive: true });
  console.log(`import-sprite ${id}: ${spec.inputs.length} input image(s)`);

  // 1-4 per input
  const poses = [];
  for (const inp of spec.inputs) {
    const file = resolveIn(inp.file);
    if (!fs.existsSync(file)) { console.warn(`  missing ${rel(file)}: skipped (its poses and the anims that use them are left out)`); continue; }
    let im = loadImage(file);
    if (inp.crop) im = crop(im, inp.crop);
    const opt = Object.assign({}, spec.key || {}, inp, { bg: inp.bg || spec.bg || '#FF00FF' });
    const K = keyBackground(im, opt);
    // colour masks (an effect drawn into a pose: a violet beam or shockwave touching the body): colourErase drops the
    // effect's pixels inside rects (image coords, after crop) from the pose; colourKeep keeps only them (the effect sprite)
    {
      const fx = (r, g, b) => (b > g + 50 && r > g) || (r > 215 && g > 190 && b > 235);   // violet, lavender, blue-white
      const inR = (x, y, R) => x >= R[0] && y >= R[1] && x < R[0] + R[2] && y < R[1] + R[3];
      const ers = inp.colourErase || [], keep = inp.colourKeep;
      if (ers.length || keep) for (let y = 0; y < K.h; y++) for (let x = 0; x < K.w; x++) {
        const i = y * K.w + x; if (K.a[i] <= 0) continue; const o = i * 4, v = fx(im.rgba[o], im.rgba[o + 1], im.rgba[o + 2]);
        if (keep && !v) K.a[i] = 0;
        else if (v && ers.some(R => inR(x, y, R))) K.a[i] = 0;
      }
    }
    const names = inp.names || [inp.name || path.basename(inp.file).replace(/\.\w+$/, '')];
    const mask = new Uint8Array(K.w * K.h); for (let i = 0; i < mask.length; i++) mask[i] = K.a[i] >= 0.5 ? 1 : 0;
    { const { label, comps } = components(mask, K.w, K.h), big = comps.reduce((p, c) => Math.max(p, c.n), 0); for (let i = 0; i < mask.length; i++) if (mask[i] && comps[label[i]].n < Math.max(16, big * 0.003)) mask[i] = 0; }
    const CC = components(mask, K.w, K.h);
    const boxes = splitBoxes(mask, K.w, K.h, inp.split, inp.names, CC);
    const mattes = boxes.map(b => cellMatte(K, b, opt, CC));
    const ref = inp.ref || 0, hRef = inp.h || spec.height;
    let s = inp.scale || hRef / mattes[ref].bbox[3];
    if (spec.maxW && !inp.scale) s = Math.min(s, spec.maxW / mattes[ref].bbox[2]);   // the reference (idle) pose's width; attacks may reach further
    console.log(`  ${rel(file)}${inp.crop ? ' crop ' + inp.crop.join(',') : ''}: key ${col.hex(K.key)}, ${boxes.length} pose(s), scale ${s.toFixed(4)}`);
    boxes.forEach((b, k) => {
      const name = names[k] || `${names[0]}${k}`, ps = inp.hByName && inp.hByName[name] ? inp.hByName[name] / mattes[k].bbox[3] : s;
      const sopt = Object.assign({}, spec.sample || {}, inp.sample || {}), flip = !!inp.flip !== (inp.flipNames || []).includes(name);   // flipNames: poses a generator drew facing right
      const F = downscale(K, b.box, mattes[k], ps, sopt, flip);
      poses.push({ name, F, redo: vote => downscale(K, b.box, mattes[k], ps, sopt, flip, vote), air: (inp.air || {})[name] || (spec.air || {})[name] || 0, anchor: (inp.anchor || {})[name] || inp.anchorMode || spec.anchor || 'feet', nudge: (inp.nudge || {})[name] || [0, 0] });
    });
  }
  // poses named '_...' (the idle reference pose that starts every generated sheet) only set the sheet's scale
  for (let i = poses.length - 1; i >= 0; i--) if (poses[i].name.startsWith('_')) poses.splice(i, 1);
  const byName = new Map(poses.map((p, i) => [p.name, i]));
  if (!poses.length) throw new Error('no poses imported');
  if (byName.size !== poses.length) throw new Error('duplicate pose names: ' + poses.map(p => p.name).filter((n, i, a) => a.indexOf(n) !== i).join(', '));

  // 5. shared palette
  const hist = new Map();
  for (const p of poses) for (let i = 0; i < p.F.w * p.F.h; i++) if (p.F.on[i]) { const k = (p.F.rgb[i * 3] << 16) | (p.F.rgb[i * 3 + 1] << 8) | p.F.rgb[i * 3 + 2]; hist.set(k, (hist.get(k) || 0) + 1); }
  const P = spec.palette || {};
  const built = P.fixed ? { pal: P.fixed.map(col.parseHex).map(col.snap4), outline: P.fixed.length - 1, ramps: [] }
    : col.buildPalette(hist, maxColours, { mode: P.mode, ramps: P.ramps, outline: P.outline ? col.parseHex(P.outline) : null, lock: (P.lock || []).map(col.parseHex), darkL: P.darkL });
  const pal = built.pal, oPen = built.outline, near = col.nearestFn(pal);
  console.log(`  palette: ${pal.length} colours (outline pen ${oPen}): ${pal.map(col.hex).join(' ')}`);

  // pass 2: every output pixel takes the commonest palette pen under its footprint (no in-between colours, clean
  // clusters); the outline / darkest pens are weighted up so linework survives the reduction
  const S = spec.sample || {}, bias = new Float64Array(16).fill(1);
  const lum = pal.map(c => col.luma(c));
  pal.forEach((c, i) => { if (i === oPen) bias[i] = S.outlineBias != null ? S.outlineBias : 1.35; else if (lum[i] < 48) bias[i] = S.darkBias2 != null ? S.darkBias2 : 1.15; });
  for (const p of poses) {
    const F = S.vote === false ? null : p.redo({ near, bias });
    let pen;
    if (F) pen = F.pen;
    else { pen = new Int16Array(p.F.w * p.F.h).fill(-1); for (let i = 0; i < pen.length; i++) if (p.F.on[i]) pen[i] = near(p.F.rgb[i * 3], p.F.rgb[i * 3 + 1], p.F.rgb[i * 3 + 2]); }
    p.I = outline(cleanIndexed({ w: p.F.w, h: p.F.h, pen }, oPen, spec.clean || {}), oPen, spec.outline || 'auto');
  }

  // 7. anchors, then per-anim registration to the anim's first frame
  for (const p of poses) { p.A = anchorOf(p.I, p.anchor, p.air); p.A.ox += p.nudge[0]; p.A.oy += p.nudge[1]; }
  // anim numbers stay those of the spec list (BOSS_DEFS 'main:<n>' references) even when a partial import leaves some out
  const anims = (spec.anims || poses.map(p => ({ name: p.name, frames: [p.name], dur: 30 }))).map((a, n) => Object.assign({ n }, a)).filter(a => {
    const miss = a.frames.filter(nm => !byName.has(nm)); if (miss.length) console.warn(`  anim ${a.name}: no pose ${miss.join(', ')}: left out`); return !miss.length;
  });
  const aligned = new Set();
  // alignTo: the anim's first frame is registered to a named pose first (an attack starts where the idle stands)
  for (const a of anims) {
    if (!a.alignTo) continue;
    const k = byName.get(a.alignTo), i = byName.get(a.frames[0]); if (k == null || i == null || i === k || aligned.has(i)) continue;
    poses[i].A.ox += registerShift(poses[k].I, poses[k].A, poses[i].I, poses[i].A, a); aligned.add(i);
  }
  for (const a of anims) {
    if ((a.align || 'torso') === 'none' || a.frames.length < 2) continue;
    const k = byName.get(a.frames[0]); if (k == null) continue;
    for (const nm of a.frames.slice(1)) {
      const i = byName.get(nm); if (i == null || i === k || aligned.has(i) || poses[i].air || (spec.inputs.find(x => (x.anchor || {})[nm]))) continue;
      const t = registerShift(poses[k].I, poses[k].A, poses[i].I, poses[i].A, a);
      poses[i].A.ox += t; aligned.add(i);
    }
  }

  // 8. trim, dedupe, pack, encode
  // spec.family 'enemies' (a general enemy of ENEMY_KINDS): the sheet joins ROM_ENEMIES as 'e-<id>' with a `types` entry and
  // palMap keys, so ENEMY_KINDS.variantData / resolve and the engine's enemyMap treat it as one more ROM type whose sets
  // (main, down, held) are all '<id>'. The default is a boss body (the ROM_BOSSES family).
  const FAMN = spec.family === 'enemies' ? 'enemies' : 'bosses';
  const slot = spec.slot || 0, sheetId = `${FAMN === 'enemies' ? 'e' : 'b'}-${id}`;
  const trimmed = poses.map(p => trim(p.I, p.A));
  const uniq = [], fidOf = [];
  trimmed.forEach((t, i) => {
    const j = uniq.findIndex(u => u.w === t.w && u.h === t.h && u.ox === t.ox && u.oy === t.oy && u.pen.every((v, k) => v === t.pen[k]));
    if (j >= 0) fidOf[i] = j; else { fidOf[i] = uniq.length; uniq.push(Object.assign({ name: poses[i].name }, t)); }
  });
  const pk = pack(uniq, spec.atlasW || 1024);
  const idx = new Uint8Array(pk.w * pk.h * 4), view = new Uint8Array(pk.w * pk.h * 4);
  uniq.forEach((f, i) => { const [x0, y0] = pk.pos[i]; for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const v = f.pen[y * f.w + x]; if (v < 0) continue; const o = ((y0 + y) * pk.w + x0 + x) * 4; idx[o] = slot; idx[o + 1] = v; idx[o + 3] = 255; const c = pal[v]; view[o] = c[0]; view[o + 1] = c[1]; view[o + 2] = c[2]; view[o + 3] = 255; } });
  const idxPng = png.encode({ width: pk.w, height: pk.h, rgba: idx, palette: true });
  const viewPng = png.encode({ width: pk.w, height: pk.h, rgba: view, palette: true });
  fs.writeFileSync(path.join(out, `${id}-atlas.png`), idxPng);
  fs.writeFileSync(path.join(out, `${id}-atlas-rgba.png`), viewPng);
  const fdir = path.join(out, `${id}-frames`); fs.mkdirSync(fdir, { recursive: true });
  uniq.forEach(f => { const r = new Uint8Array(f.w * f.h * 4); for (let i = 0; i < f.pen.length; i++) if (f.pen[i] >= 0) { const c = pal[f.pen[i]]; r.set([c[0], c[1], c[2], 255], i * 4); } png.write(path.join(fdir, `${f.name}.png`), { width: f.w, height: f.h, rgba: r }); });

  const rowInt = c => (c[0] << 16) | (c[1] << 8) | c[2];
  const row = pal.map(rowInt); while (row.length < 16) row.push(0);
  const flash = pal.map((c, i) => i === oPen ? rowInt([0x33, 0x44, 0x33]) : rowInt(col.snap4(c.map((v, k) => Math.round(v * 0.35 + [0xAA, 0xFF, 0xCC][k] * 0.65))))); while (flash.length < 16) flash.push(0);
  const mapOf = key => { const m = new Array(32).fill(null); m[slot] = key; return m; };
  // palette row / map keys carry an 'art-' prefix: the ROM family already names maps after characters (its 'sable' map is
  // VICE T. recoloured), and a generated body must never replace one of them when the families merge
  const pkey = spec.palKey || `art-${id}`;
  const tag = id;
  const fam = {
    v: 1, family: FAMN, mode: 'indexed', rect: {}, id, generatedBy: 'tools/art/import-sprite.cjs', spec: rel(path.resolve(specFile)),
    note: `frames are LOCAL ids (0-based within this body); the .sprite.js loader adds the loaded ${FAMN} family's frame count. Art faces LEFT; (ox, oy) = feet origin inside the box.`,
    sheets: { [sheetId]: { w: pk.w, h: pk.h, sum: png.fnvIndexed(idx).toString(16).padStart(8, '0'), file: `${id}-atlas.png` } },
    frames: uniq.map((f, i) => [sheetId, pk.pos[i][0], pk.pos[i][1], f.w, f.h, f.ox, f.oy, `${id}:${f.name}`, 0]),
    frameNames: uniq.map(f => f.name),
    anims: {}, animIndex: {},
    bodies: { [id]: { main: tag, home: pkey, pal: { home: pkey, gel: `${pkey}-gel` }, use: 'home', hud: spec.name || id.toUpperCase(), source: rel(path.resolve(specFile)), heightPx: spec.height } },
    pal: { rows: { [pkey]: row, [`${pkey}-gel`]: flash }, maps: { [pkey]: mapOf(pkey), [`${pkey}-gel`]: mapOf(`${pkey}-gel`) } },
    palette: { hex: pal.map(col.hex), outline: oPen, ramps: built.ramps },
  };
  anims.forEach((a, n) => {
    const key = a.key || `${tag}:${a.n}`,   // key: an anim of another set of the body (spec.body.hit = "<id>-hit" -> "<id>-hit:2")
     durs = Array.isArray(a.dur) ? a.dur : a.frames.map(() => a.dur || 8);
    const f = a.frames.map((nm, k) => { const i = byName.get(nm); if (i == null) throw new Error(`anim ${a.name}: no pose '${nm}'`); const r = [fidOf[i], durs[k] != null ? durs[k] : durs[durs.length - 1]]; if ((a.act || []).includes(k)) r.push(1); return r; });   // act: the blow frames (f[2] = 1, as in the ROM boss anims)
    fam.anims[key] = Object.assign({ f, loop: a.loop != null ? a.loop : 0, t: id, name: a.name }, a.atk ? { atk: a.atk } : {});
    if (FAMN === 'enemies' && a.act && a.act.length) fam.anims[key].act = a.act.slice();   // the ROM_ENEMIES shape lists the active frames too (atkInfo reads act[0])
    fam.animIndex[a.name] = key;
  });
  if (spec.body) Object.assign(fam.bodies[id], spec.body);   // extra body fields the engine reads (hit: the knockdown set, ...)
  if (FAMN === 'enemies') {
    const E = spec.enemy || {}, V = E.variant || 'A';
    delete fam.bodies;
    fam.types = { [id]: { title: spec.name || id.toUpperCase(), generated: true, variants: { [V]: Object.assign({ main: tag, down: tag, held: tag, home: pkey, rom: V, slots: [slot] }, E.data || {}) } } };
    fam.palMap = { [`${id}:${V}`]: pkey, [`${id}:${V}/gel`]: `${pkey}-gel` };
    // the ROM family keys every box by its record (rect[sheet][rec] = [x, y, w, h, ox, oy]); here the record is '<id>:<pose>'
    fam.rect = { [sheetId]: Object.fromEntries(fam.frames.map(f => [f[7], f.slice(1, 7)])) };
  }
  fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(fam, null, 1));
  const jsFam = JSON.parse(JSON.stringify(fam)); jsFam.sheets[sheetId].png = png.dataURL(idxPng); delete jsFam.sheets[sheetId].file;
  const ch = spec.chapterTag || 90;
  // the enemies loader merges into ROM_ENEMIES itself when sprites.js is not loaded (the Node sandboxes of the suites and
  // tools), so frame ids stay global there too; with sprites.js, SPRITE_DATA.add merges as for the boss bodies
  const MERGE = FAMN === 'enemies' ? "if(B&&!SD.sheetPng&&B!==fam){B.frames=(B.frames||[]).concat(fam.frames);['sheets','rect','anims','types','palMap'].forEach(function(k){B[k]=Object.assign(B[k]||{},fam[k]);});B.pal=B.pal||{};['rows','maps'].forEach(function(k){B.pal[k]=Object.assign(B.pal[k]||{},fam.pal[k]);});}" : '';
  const loadLine = `var base=B&&B.frames?B.frames.length:0;for(var k in fam.anims)fam.anims[k].f.forEach(function(x){x[0]+=base;});fam.frameBase=base;\n${MERGE ? MERGE + '\n' : ''}`;
  const famRef = `var B=SD.families&&SD.families.${FAMN};`, after = FAMN === 'enemies' ? 'sprite-data-enemies.js' : 'sprite-data-bosses.js';
  fs.writeFileSync(path.join(out, `${id}.sprite.js`),
    `// Generated by tools/art/import-sprite.cjs from ${rel(path.resolve(specFile))}; do not edit by hand.\n` +
    `// Load AFTER ${after}: frame ids are rebased onto the ${FAMN} family loaded so far.\n` +
    `// Standalone (a tool or test loading only this file) it still registers, with frame ids unrebased.\n` +
    `(function(){var W=typeof window!=='undefined'?window:globalThis;var SD=W.SPRITE_DATA=W.SPRITE_DATA||{families:{},add:function(n,f){this.families[n]=f;}};${famRef}\n` +
    `var fam=${JSON.stringify(jsFam)};\n${loadLine}` +
    `SD.add('${FAMN}-ch${ch}',fam);})();\n`);
  // ship: the loader the game loads (index.html) with its sheet LAZY: frames, anims, bodies and palettes at start-up, the
  // pixels in a script of their own (spec.sheetDir, default assets/boss-art/<id>.js) that SPRITES.loadSheets injects when
  // a chapter needs the boss (SEQUEL_RENDER.bossArt). The work/art/out copy keeps the data URL inline (runtime-check.html).
  if (spec.ship) {
    const sp = path.resolve(ROOT, spec.ship), lazyRel = `${spec.sheetDir || (FAMN === 'enemies' ? 'assets/enemy-art' : 'assets/boss-art')}/${id}.js`, lp = path.resolve(ROOT, lazyRel);
    const lazyFam = JSON.parse(JSON.stringify(jsFam)); delete lazyFam.sheets[sheetId].png; lazyFam.sheets[sheetId].lazy = lazyRel;
    fs.mkdirSync(path.dirname(sp), { recursive: true }); fs.mkdirSync(path.dirname(lp), { recursive: true });
    fs.writeFileSync(sp, `// Generated by tools/art/import-sprite.cjs from ${rel(path.resolve(specFile))}; do not edit by hand.\n` +
      `// Load AFTER ${after}: frame ids are rebased onto the ${FAMN} family loaded so far. The sheet is lazy: its\n` +
      `// pixels are ${lazyRel}, loaded per chapter (SPRITES.loadSheets).\n` +
      `(function(){var W=typeof window!=='undefined'?window:globalThis;var SD=W.SPRITE_DATA=W.SPRITE_DATA||{families:{},add:function(n,f){this.families[n]=f;}};${famRef}\n` +
      `var fam=${JSON.stringify(lazyFam)};\n${loadLine}` +
      `SD.add('${FAMN}-ch${ch}',fam);})();\n`);
    fs.writeFileSync(lp, `// Generated by tools/art/import-sprite.cjs: the pixels of ${sheetId} (${rel(sp)}), loaded per chapter.\n` +
      `(function(){var W=typeof window!=='undefined'?window:globalThis;var SD=W.SPRITE_DATA;if(SD&&SD.sheetPng)SD.sheetPng('${FAMN}','${sheetId}','${png.dataURL(idxPng)}');})();\n`);
    console.log(`  shipped -> ${rel(sp)} + ${lazyRel}`);
  }
  console.log(`  ${uniq.length} frame(s) (${poses.length} poses), atlas ${pk.w}x${pk.h} -> ${rel(out)}`);
  for (const f of uniq) console.log(`    ${f.name.padEnd(14)} ${String(f.w).padStart(3)}x${String(f.h).padEnd(3)} origin ${f.ox},${f.oy}`);

  if (!args.noPreview) {
    const prev = path.resolve(ROOT, args.preview || `work/art/preview/${id}-contact.png`);
    require('./contact-sheet.cjs').write(path.join(out, `${id}.json`), prev, { hero: spec.previewHero || 'jack' });
    console.log(`  preview -> ${rel(prev)}`);
  }
  return fam;
}

if (require.main === module) {
  const a = process.argv.slice(2), args = {}; let spec = null;
  for (let i = 0; i < a.length; i++) { if (a[i] === '--out') args.out = a[++i]; else if (a[i] === '--preview') args.preview = a[++i]; else if (a[i] === '--no-preview') args.noPreview = true; else spec = a[i]; }
  if (!spec) { console.error('usage: node tools/art/import-sprite.cjs <spec.json> [--out dir] [--preview file.png] [--no-preview]'); process.exit(2); }
  run(spec, args);
}
module.exports = { run, loadImage, keyBackground };
