// Colour helpers for tools/art: sRGB <-> OKLab, CPS-1 4-bit snapping, deterministic palette quantisers.
'use strict';

const toLin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const LIN = new Float64Array(256); for (let i = 0; i < 256; i++) LIN[i] = toLin(i);
const toSrgb = v => { v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); };

function rgbToLab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function labToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
}
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const parseHex = s => { const h = String(s).replace('#', ''); const f = h.length === 3 ? h.split('').map(x => x + x).join('') : h; return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)]; };
const snap4 = c => c.map(v => Math.round(v / 17) * 17);           // CPS-1 colour precision: 4 bits per channel
const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
const luma = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

// points: [{lab, w}] ; returns weighted mean lab
function mean(points) { let w = 0, L = 0, a = 0, b = 0; for (const p of points) { w += p.w; L += p.lab[0] * p.w; a += p.lab[1] * p.w; b += p.lab[2] * p.w; } return w ? [L / w, a / w, b / w] : [0, 0, 0]; }

// Weighted k-means with optional fixed centroids (never moved). Deterministic: init by weighted farthest-point.
function kmeans(points, k, fixed = [], iters = 16, feat = x => x) {
  if (k <= 0 || !points.length) return { cents: [], assign: points.map(() => -1) };
  const F = points.map(p => feat(p.lab));
  const cents = [];
  let first = 0; for (let i = 1; i < points.length; i++) if (points[i].w > points[first].w) first = i;
  cents.push(F[first].slice());
  const fx = fixed.map(feat);
  while (cents.length < k) {
    let best = -1, bd = -1;
    for (let i = 0; i < points.length; i++) {
      let m = Infinity; for (const c of cents.concat(fx)) m = Math.min(m, d2(F[i], c));
      const s = m * Math.sqrt(points[i].w);
      if (s > bd) { bd = s; best = i; }
    }
    if (best < 0 || bd <= 0) break;
    cents.push(F[best].slice());
  }
  const assign = new Int32Array(points.length);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < points.length; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < cents.length; c++) { const dd = d2(F[i], cents[c]); if (dd < bd) { bd = dd; bi = c; } }
      for (let c = 0; c < fx.length; c++) { const dd = d2(F[i], fx[c]); if (dd < bd) { bd = dd; bi = -1 - c; } }
      assign[i] = bi;
    }
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) { const c = assign[i]; if (c < 0) continue; const a = acc[c], w = points[i].w; a[0] += F[i][0] * w; a[1] += F[i][1] * w; a[2] += F[i][2] * w; a[3] += w; }
    acc.forEach((a, c) => { if (a[3]) cents[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  return { cents, assign: Array.from(assign) };
}

// 1-D weighted k-means on L, init at weighted quantiles. Returns groups of point indices.
function splitL(points, idx, t) {
  const sorted = idx.slice().sort((i, j) => points[i].lab[0] - points[j].lab[0]);
  let W = 0; for (const i of sorted) W += points[i].w;
  let cents = [];
  for (let q = 0; q < t; q++) { const target = W * (q + 0.5) / t; let acc = 0; for (const i of sorted) { acc += points[i].w; if (acc >= target) { cents.push(points[i].lab[0]); break; } } }
  cents = cents.filter((v, i) => cents.indexOf(v) === i);
  let groups = [];
  for (let it = 0; it < 20; it++) {
    groups = cents.map(() => []);
    for (const i of sorted) { let bi = 0, bd = Infinity; cents.forEach((c, k) => { const dd = Math.abs(points[i].lab[0] - c); if (dd < bd) { bd = dd; bi = k; } }); groups[bi].push(i); }
    cents = groups.map((g, k) => { let w = 0, s = 0; for (const i of g) { w += points[i].w; s += points[i].lab[0] * points[i].w; } return w ? s / w : cents[k]; });
  }
  return groups.filter(g => g.length);
}

// Build a palette of at most `n` colours (outline + locks included) from weighted colours.
//   colours: Map(rgbInt -> weight); opts: {mode:'ramps'|'kmeans', ramps, outline:[r,g,b], lock:[[r,g,b]], darkL}
// Returns {pal:[[r,g,b]...], outline: index, ramps: [[indices]]}
function buildPalette(colours, n, opts = {}) {
  const outline = opts.outline || [17, 17, 17];
  const locks = (opts.lock || []).map(snap4);
  // aggregate to 4-bit cells, weight = count^power (< 1 lets small but distinct materials - a steel shaft, an eye, a
  // gauge - hold a pen against large flat areas)
  const cells = new Map(), power = opts.weightPower != null ? opts.weightPower : 0.6;
  for (const [k, w] of colours) {
    const c = [(k >> 16) & 255, (k >> 8) & 255, k & 255], ck = rgbKey(snap4(c)), e = cells.get(ck) || { s: [0, 0, 0], w: 0 };
    e.s[0] += c[0] * w; e.s[1] += c[1] * w; e.s[2] += c[2] * w; e.w += w; cells.set(ck, e);
  }
  const pts = [];
  for (const [, e] of cells) { const c = e.s.map(v => Math.round(v / e.w)); pts.push({ c, lab: rgbToLab(...c), w: Math.pow(e.w, power), raw: e.w }); }
  pts.sort((p, q) => q.w - p.w || (rgbKey(p.c) - rgbKey(q.c)));
  const oLab = rgbToLab(...outline);
  const darkL = opts.darkL != null ? opts.darkL : oLab[0] + 0.06;
  const free = Math.max(1, n - 1 - locks.length);
  const body = pts.filter(p => !(p.lab[0] < darkL && Math.hypot(p.lab[1], p.lab[2]) < 0.06));
  const lockLab = locks.map(c => rgbToLab(...c));
  let groups = [];
  if ((opts.mode || 'ramps') === 'ramps') {
    const F = Math.max(1, Math.min(free, opts.ramps || Math.max(2, Math.min(6, Math.round(free / 3)))));
    // hue families: chroma-plane k-means with a little lightness so greys split from tinted darks
    const fam = kmeans(body, F, [], 20, l => [l[1] * 1.0, l[2] * 1.0, l[0] * 0.18]);
    const fams = fam.cents.map(() => []); fam.assign.forEach((c, i) => { if (c >= 0) fams[c].push(i); });
    const live = fams.filter(f => f.length);
    const stats = live.map(f => { let w = 0, raw = 0, s = 0, s2 = 0; for (const i of f) { const p = body[i]; w += p.w; raw += p.raw; s += p.lab[0] * p.w; s2 += p.lab[0] ** 2 * p.w; } const m = s / w; return { w, raw, sd: Math.sqrt(Math.max(0, s2 / w - m * m)) }; });
    // pens per ramp follow the ramp's real pixel share (sqrt) and its lightness spread
    const score = stats.map(s => Math.sqrt(s.raw) * (s.sd + 0.03));
    const tot = score.reduce((a, b) => a + b, 0);
    let tones = score.map(s => Math.max(2, Math.min(6, Math.round(free * s / tot))));
    while (tones.reduce((a, b) => a + b, 0) > free) { let bi = -1; tones.forEach((t, i) => { if (t > 1 && (bi < 0 || score[i] / t < score[bi] / tones[bi])) bi = i; }); if (bi < 0) break; tones[bi]--; }
    while (tones.reduce((a, b) => a + b, 0) < free) { let bi = 0; tones.forEach((t, i) => { if (score[i] / (t + 1) > score[bi] / (tones[bi] + 1)) bi = i; }); tones[bi]++; }
    // tones of one ramp closer than minGap in lightness (or equal after 4-bit snapping) waste a pen: take one from
    // that ramp and give it to the ramp that gains most, until no ramp has a near-duplicate (bounded)
    const minGap = opts.minGap != null ? opts.minGap : 0.045;
    const ramp = k => splitL(body, live[k], Math.min(tones[k], live[k].length)).map(g => mean(g.map(i => body[i])));
    let rs = live.map((f, k) => ramp(k));
    for (let it = 0; it < 12; it++) {
      let worst = -1;
      rs.forEach((r, k) => { for (let i = 1; i < r.length; i++) { const a = snap4(labToRgb(...r[i - 1])), b = snap4(labToRgb(...r[i])); if (r[i][0] - r[i - 1][0] < minGap || rgbKey(a) === rgbKey(b)) { worst = k; break; } } });
      if (worst < 0) break;
      tones[worst]--;
      let bi = -1; tones.forEach((t, i) => { if (i !== worst && t < live[i].length && (bi < 0 || score[i] / (t + 1) > score[bi] / (tones[bi] + 1))) bi = i; });
      if (bi >= 0) tones[bi]++;
      rs = live.map((f, k) => ramp(k));
    }
    rs.forEach((r, k) => r.forEach(lab => groups.push({ fam: k, lab })));
  } else {
    const km = kmeans(body, free, [oLab].concat(lockLab), 24);
    km.cents.forEach(c => groups.push({ fam: 0, lab: c }));
  }
  // to sRGB at CPS-1 precision, de-duplicated; ramps sorted by family then dark -> light
  groups.sort((p, q) => p.fam - q.fam || p.lab[0] - q.lab[0]);
  const pal = [], ramps = [], seen = new Set();
  for (const g of groups) {
    const c = snap4(labToRgb(...g.lab)), k = rgbKey(c);
    if (seen.has(k) || rgbKey(snap4(outline)) === k) continue; seen.add(k);
    (ramps[g.fam] = ramps[g.fam] || []).push(pal.length); pal.push(c);
  }
  for (const c of locks) { const k = rgbKey(c); if (!seen.has(k)) { seen.add(k); pal.push(c); } }
  pal.push(snap4(outline));
  return { pal, outline: pal.length - 1, ramps: ramps.filter(Boolean) };
}
const rgbKey = c => (c[0] << 16) | (c[1] << 8) | c[2];

// nearest palette index in OKLab (L weighted a little higher: keeps value structure, which is what reads at 1x)
function nearestFn(pal) {
  const labs = pal.map(c => rgbToLab(...c)), cache = new Map();
  return (r, g, b) => {
    const k = (r << 16) | (g << 8) | b; let v = cache.get(k); if (v != null) return v;
    const l = rgbToLab(r, g, b); let bi = 0, bd = Infinity;
    for (let i = 0; i < labs.length; i++) { const q = labs[i], dd = 1.4 * (l[0] - q[0]) ** 2 + (l[1] - q[1]) ** 2 + (l[2] - q[2]) ** 2; if (dd < bd) { bd = dd; bi = i; } }
    cache.set(k, bi); return bi;
  };
}

module.exports = { rgbToLab, labToRgb, hex, parseHex, snap4, luma, buildPalette, nearestFn, rgbKey };
