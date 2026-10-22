// Stage gates (ARCHITECTURE §3.7 gates 1-6, §3.8 return visits; CAMPAIGN §15.2 (2), (7); PLAN §6 WP-E):
//   validate(composed, recipe, {out, data}) -> {ok, errors, warnings, gates, seams, locks, originality}
//   originalityAll(composedByChapter)      -> {ok, errors, warnings, report, maxUse}   (cross-chapter column use)
// 1 seams        at every slice boundary the bands overlap >= 48 px and the tops differ <= 16 px unless the right
//                piece is marked "step"; at most 16 rows of the boundary may show a cut (two arts that do not
//                continue each other, or an object cut off where its original goes on): a join chunk (a pillar,
//                a heap, a door frame, a strip of floor; CAMPAIGN §4.1) or a cut at a natural edge removes them;
//                the far layer is one per section and changes only at a section boundary hidden behind opaque
//                scroll2 (ARCHITECTURE §3.3); mean RGB step across the boundary is reported (warning above 48)
// 2 walkability  every column has a band with floor art under it (no walkable voids, KI1/R5); a flood fill of the band-clipped walk mask connects the start to every
//                lock window, the boss lock and the exit; every lock window has a band >= 64 px over >= 75 %
// 3 test start   (ch1 a0) the first 640 px are flat with a band covering mid +-48, no lock before x 600, two
//                breakable props and the starting gun drop at x 150-400
// 4 originality  no verbatim run (consecutive source columns, unpatched, < 50 % of the pixels recoloured) > 512 px;
//                the HELL ROAD loop needs >= 25 % of its cells patched (PLAN R7); no boss lock
//                on an original boss window (states 0x06/0x10/0x13); D8 exclusions; return-visit rules (§3.8);
//                the cross-chapter rules (<= 60 % of an original area's columns, no shared columns between
//                consecutive chapters) are in originalityAll
// 5 budget       pages <= 1024^2, <= 1.0 MB per chapter, <= 5 MB in all, stage-data.js <= 150 KB, files <= 1.5 MB
// 6 determinism  a fresh compose of the chapter reproduces the same pixels, walk mask and bands
// The HELL ROAD loop (CAMPAIGN R7, PLAN R7, user question 5) takes the default: the `loop` gate-4 exemption; its
// verbatim run and boss-window overlap are reported as warnings and listed in originality.json.
'use strict';
const fs = require('fs'), path = require('path');
const C = require('./levels-compose.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const EXPECT = { ch1: { len: 6592, locks: 12 }, ch2: { len: 6592, locks: 12 }, ch3: { len: 6976, locks: 13 }, ch4: { len: 6592, locks: 12 }, ch5: { len: 6592, locks: 12 }, ch6: { len: 7104, locks: 13 } };
const EXCLUDED = [['E1a0', 0, 896], ['E4a1', 0, 1e9], ['E4a0', 0, 352], ['E2a2', 0, 1e9], ['E5a1', 0, 1e9], ['E6a2', 0, 1e9], ['E7a1', 0, 1e9]];
const LIMITS = { seamOverlap: 48, seamTop: 16, seamRGB: 48, joinCut: 16, s3Cut: 8, voidRows: 16, recolour: 0.5, loopPatch: 0.25, lockBand: 64, lockShare: 0.75, verbatim: 512, useFail: 0.60, useWarn: 0.35, returnPatch: 0.25,
  pagesPerChapter: 1048576, pagesTotal: 5242880, stageData: 153600, anyFile: 1572864, page: 1024 };

const bandH = b => (b ? b[1] - b[0] + 1 : 0);
function colBand(a, x) { const c = Math.max(0, Math.min(a.walk.cols - 1, Math.floor(x / C.CELL))); return a.walk.band[c]; }

function validate(chap, recipe, { out = ROOT, data = null } = {}) {
  const errors = [], warnings = [], gates = {}, seams = [], lockRep = [], s3cuts = [], voids = [], loopRep = [], E = (g, m) => { errors.push(`gate ${g}: ${m}`); (gates[g] = gates[g] || { errors: 0 }).errors++; }, W = (g, m) => warnings.push(`gate ${g}: ${m}`);
  const ch = recipe.id;
  // ---- structure (CAMPAIGN §4.1, §15.2 (2))
  let total = 0, lockCount = 0;
  for (const a of chap.areas) {
    const A = a.recipe; total += a.w;
    let x = 0;
    for (const s of A.sections || []) {
      if (s.x0 !== x) E(2, `${a.id} section ${s.id} starts at ${s.x0}, expected ${x}`);
      x = s.x0 + s.len; lockCount += (s.locks || []).length + (s.bossLock != null ? 1 : 0);
      for (const l of s.locks || []) if (l < s.x0 || l + C.VIEW.w > s.x0 + s.len) E(2, `${s.id} lock ${l} window is not inside the section ${s.x0}-${s.x0 + s.len}`);
      if (s.bossLock != null && (s.bossLock < s.x0 || s.bossLock + C.VIEW.w > s.x0 + s.len)) E(2, `${s.id} boss lock ${s.bossLock} window outside the section`);
      if (!A.loop) { const sum = (A.s2 || []).filter(p => p.slice && (p.at || [0, 0])[0] < s.x0 + s.len && (p.at || [0, 0])[0] + p.slice.x[1] - p.slice.x[0] > s.x0).reduce((n, p) => n + p.slice.x[1] - p.slice.x[0], 0); if (sum !== s.len) E(2, `${s.id}: slices sum to ${sum}, section length ${s.len} (a slice may not straddle a section boundary)`); }
    }
    if (x !== a.w) E(2, `${a.id}: sections cover ${x} of ${a.w} px`);
  }
  if (EXPECT[ch]) {
    if (total !== EXPECT[ch].len) E(2, `chapter length ${total}, expected ${EXPECT[ch].len}`);
    if (lockCount !== EXPECT[ch].locks) E(2, `lock count ${lockCount}, expected ${EXPECT[ch].locks}`);
  }
  for (const a of chap.areas) {
    const A = a.recipe, base = a.s2.pieces.filter(p => (p.kind === 'slice' && !p.blend) || p.kind === 'loop').sort((p, q) => p.x0 - q.x0);
    // ---- gate 1: seams
    let covered = 0;
    for (const p of base) { if (p.x0 > covered && p.kind !== 'loop') E(1, `${a.id}: columns ${covered}-${p.x0} have no slice`); covered = Math.max(covered, p.x1); }
    if (covered < a.w) E(1, `${a.id}: columns ${covered}-${a.w} have no slice`);
    for (let i = 1; i < base.length; i++) {
      const L = base[i - 1], R = base[i], b = R.x0; if (b >= a.w || b !== L.x1) continue;
      const bl = colBand(a, b - 1), br = colBand(a, b);
      const ov = bl && br ? Math.min(bl[1], br[1]) - Math.max(bl[0], br[0]) + 1 : 0, dt = bl && br ? Math.abs(bl[0] - br[0]) : 999;
      const rgb = rgbStep(a, b, chap.ctxs), rec = { area: a.id, x: b, left: `${L.src} ${L.srcX.join('-')}${L.flip ? ' flip' : ''}`, right: `${R.src} ${R.srcX.join('-')}${R.flip ? ' flip' : ''}`, bands: [bl, br], overlap: ov, topStep: dt, step: R.step, rgb };
      seams.push(rec);
      if (ov < LIMITS.seamOverlap) E(1, `${a.id} x ${b} (${rec.left} | ${rec.right}): bands ${JSON.stringify(bl)} / ${JSON.stringify(br)} overlap ${ov} < ${LIMITS.seamOverlap}`);
      if (dt > LIMITS.seamTop && !R.step) E(1, `${a.id} x ${b} (${rec.left} | ${rec.right}): band tops differ by ${dt} > ${LIMITS.seamTop} (mark "step":true if intended)`);
      if (rgb > LIMITS.seamRGB) W(1, `${a.id} x ${b} (${rec.left} | ${rec.right}): mean RGB step ${rgb.toFixed(1)} across the seam`);
      const jc = C.joinCuts(a.s2, chap.ctxs, b); rec.cut = jc.cut; rec.cutRows = rowRuns(jc.rows);
      rec.chunk = a.s2.pieces.some(p => p.kind === 'patch' && p.join && p.starts.some(bx => bx < b && bx + (p.srcX[1] - p.srcX[0]) > b));
      if (jc.cut > LIMITS.joinCut) E(1, `${a.id} x ${b} (${rec.left} | ${rec.right}): ${jc.cut} rows show a cut (y ${rec.cutRows}); cover the join with a chunk or cut at a natural edge`);
    }
    // a replace-mode patch of mostly empty cells erases the art under it (holes onto the far layer)
    for (const p of a.s2.pieces.filter(p => p.kind === 'patch' && !p.blend && p.opaque < 0.3)) W(1, `${a.id} patch s2[${p.index}] ${p.src} ${p.srcX.join('-')} h ${p.h.join('-')} is ${(p.opaque * 100).toFixed(0)}% opaque: it erases the art under it`);
    // patch edges (rectangular chunks make their own joins): reported, not fatal
    if (!A.loop) for (const p of a.s2.pieces.filter(p => p.kind === 'patch' && p.blend !== 'object' && p.blend !== 'over')) for (const bx of p.starts) for (const e of [bx, bx + p.srcX[1] - p.srcX[0]]) {
      if (e <= 0 || e >= a.w) continue; const y0 = Math.max(0, p.y), y1 = Math.min(a.s2.H, p.y + p.h[1] - p.h[0]);
      const jc = C.joinCuts(a.s2, chap.ctxs, e, { y0, y1 }); if (jc.cut > LIMITS.joinCut) W(1, `${a.id} patch s2[${p.index}] ${p.src} edge x ${e}: ${jc.cut} rows show a cut`);
    }
    // far layer: one per section, changing only at a section boundary behind opaque scroll2
    const spans = (a.s3 || []).filter(sp => !sp.period).slice().sort((p, q) => p.x0 - q.x0), secX = new Set((A.sections || []).map(s => s.x0));
    for (let i = 1; i < spans.length; i++) {
      const x = spans[i].x0; if (x <= 0 || x >= a.w) continue;
      if (!secX.has(x)) E(1, `${a.id}: the far layer changes at x ${x} (${spans[i - 1].src} | ${spans[i].src}), not at a section boundary`);
      let open = 0; for (let y = 0; y < a.s2.H; y++) if (a.s2.L.pen[y * a.s2.artW + x - 1] === 15 || a.s2.L.pen[y * a.s2.artW + x] === 15) open++;
      s3cuts.push({ area: a.id, x, from: spans[i - 1].src, to: spans[i].src, openRows: open });
      if (open > LIMITS.s3Cut) E(1, `${a.id}: the far layer changes at x ${x} (${spans[i - 1].src} | ${spans[i].src}) where ${open} rows of scroll2 are open; hide it behind an opaque chunk or keep one far layer`);
    }
    // ---- gate 2: walkability
    const cols = a.walk.cols, rows = a.walk.rows, band = a.walk.band, mask = a.walk.mask;
    const nulls = []; for (let c = 0; c < cols; c++) if (!band[c]) nulls.push(c * C.CELL);
    if (nulls.length) E(2, `${a.id}: ${nulls.length} columns have no walkable band (x ${runsOf(nulls).join(', ')})`);
    // walkable voids: band rows with no scroll2 floor art under the feet (the far layer or nothing would show there)
    // A band cell is void when its scroll2 cell is (nearly) empty: < 50 % opaque where a walk patch made it walkable (a
    // walk patch must sit on floor art), < 5 % where the ROM terrain is walkable. Fatal for walk patches and for columns
    // whose terrain is walkable in every row (the ROM never authored a lane there, e.g. E8a1 past the 3008 fade); open
    // floor over the source's own far layer is what the original shows (E8a3 under the bridge) and only warns.
    const voidCols = [], voidOrig = [], spanAt = x => (a.s3 || []).find(sp => !sp.period && x >= sp.x0 && x < sp.x1) || (a.s3 || []).find(sp => sp.period);
    for (let c = 0; c < cols; c++) { const bb = band[c]; if (!bb) continue; let bad = 0;
      for (let r = Math.floor((bb[0] - 1) / C.CELL); r * C.CELL < bb[1]; r++) { if (!mask[r * cols + c]) continue; let o = 0; for (let y = r * C.CELL; y < r * C.CELL + C.CELL; y++) for (let x = 0; x < C.CELL; x++) if (a.s2.L.pen[y * a.s2.artW + c * C.CELL + x] !== 15) o++;
        const share = o / 256, viaPatch = a.walk.patched.has(r * a.walk.artCols + c);
        if (viaPatch && share < 0.5) { bad = 2; break; } if (share < 0.05) bad = Math.max(bad, 1); }
      if (!bad) continue;
      let authored = false; for (let r = 0; r < a.s2.rows; r++) { const t = a.s2.terrain[r * a.s2.cols + c]; if (t >= 0 && !C.WALK_TYPES.has(t)) { authored = true; break; } }
      const sp = spanAt(c * C.CELL), pv = a.s2.prov[c], own = sp && pv && sp.src === pv.src;
      if (bad === 2 || !authored || !own) voidCols.push(c * C.CELL); else voidOrig.push(c * C.CELL); }
    if (voidCols.length) { voids.push({ area: a.id, x: runsOf(voidCols), fatal: true }); E(2, `${a.id}: walkable band over open scroll2 (no floor art) at x ${runsOf(voidCols).join(', ')}`); }
    if (voidOrig.length) { voids.push({ area: a.id, x: runsOf(voidOrig), fatal: false }); W(2, `${a.id}: open floor over the source's own far layer at x ${runsOf(voidOrig).join(', ')} (as the original shows it)`); }
    const inBand = (c, r) => band[c] && mask[r * cols + c] && r * C.CELL + 1 >= band[c][0] && r * C.CELL + C.CELL <= band[c][1];
    const seen = new Uint8Array(cols * rows), q = [];
    const sc = Math.floor(a.start.x / C.CELL), sr = Math.floor((a.start.y - 1) / C.CELL);
    if (!inBand(sc, sr)) E(2, `${a.id}: start ${a.start.x},${a.start.y} is not on the band`);
    else { seen[sr * cols + sc] = 1; q.push(sc, sr); }
    while (q.length) { const r = q.pop(), c = q.pop(); for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const c2 = c + dc, r2 = r + dr; if (c2 < 0 || c2 >= cols || r2 < 0 || r2 >= rows) continue; const k = r2 * cols + c2; if (seen[k] || !inBand(c2, r2)) continue; seen[k] = 1; q.push(c2, r2); } }
    const reached = c => { for (let r = 0; r < rows; r++) if (seen[r * cols + c]) return true; return false; };
    const reachedSpan = (x0, x1) => { for (let c = Math.floor(x0 / C.CELL); c < Math.ceil(x1 / C.CELL); c++) if (c < cols && reached(c)) return true; return false; };
    for (const l of a.locks) {
      const c0 = Math.floor(l.x / C.CELL), n = C.VIEW.w / C.CELL; let ok = 0, minH = 999;
      for (let c = c0; c < c0 + n; c++) { const h = bandH(band[Math.min(cols - 1, c)]); minH = Math.min(minH, h); if (h >= LIMITS.lockBand) ok++; }
      const share = ok / n, reach = reachedSpan(l.x, l.x + C.VIEW.w);
      lockRep.push({ area: a.id, id: l.id, x: l.x, boss: !!l.boss, share: +share.toFixed(3), minBand: minH, reachable: reach });
      if (share < LIMITS.lockShare) E(2, `${a.id} lock ${l.id} at ${l.x}: band >= ${LIMITS.lockBand} px over ${(share * 100).toFixed(0)}% of the window (< 75%)`);
      if (!reach) E(2, `${a.id} lock ${l.id} at ${l.x} is not reachable from the start`);
    }
    if (!reached(cols - 1)) E(2, `${a.id}: the exit column (x ${a.w - C.CELL}) is not reachable from the start`);
    // ---- gate 4 (per area): verbatim runs, boss windows, exclusions, return visit
    const prov = a.s2.prov, runs = []; let cur = null;
    for (let c = 0; c < prov.length; c++) {
      const p = prov[c];
      const cont = cur && p && p.src === cur.src && p.flip === cur.flip && p.X === cur.lastX + (p.flip ? -C.CELL : C.CELL);
      if (cont) { cur.n++; cur.lastX = p.X; if (!verbatim(p)) cur.verbatimBroken = true; else if (!cur.verbatimBroken) cur.vn++; }
      else { if (cur) runs.push(cur); cur = p ? { src: p.src, flip: p.flip, x: c * C.CELL, firstX: p.X, lastX: p.X, n: 1, vn: verbatim(p) ? 1 : 0, verbatimBroken: !verbatim(p), loop: !!p.loop } : null; }
    }
    if (cur) runs.push(cur);
    for (const r of runs) {
      const len = r.n * C.CELL, vlen = verbatimLen(prov, r);
      if (vlen > LIMITS.verbatim) (r.loop && A.loop && A.loop.exempt ? W : E)(4, `${a.id} x ${r.x}: verbatim run of ${vlen} px from ${r.src} ${r.firstX}${r.loop ? ' (HELL ROAD loop: gate-4 exemption, user question 5 default)' : ''}`);
      else if (len > LIMITS.verbatim && !r.loop) W(4, `${a.id} x ${r.x}: ${len} px of consecutive ${r.src} columns from ${r.firstX} (recoloured or patched, so not verbatim)`);
    }
    for (const l of a.locks.filter(l => l.boss)) {
      for (let c = Math.floor(l.x / C.CELL); c < Math.floor(l.x / C.CELL) + C.VIEW.w / C.CELL; c++) {
        const p = prov[c]; if (!p) continue; const w = C.BOSS_WINDOWS[p.src];
        if (w == null) continue;
        const hit = p.loop ? true : p.X + C.CELL > w;
        if (hit) { (p.loop && A.loop && A.loop.exempt ? W : E)(4, `${a.id} boss lock ${l.id}: column ${c * C.CELL} from ${p.src} ${p.X} lies on the original boss window ${p.src} ${w}+${p.loop ? ' (loop content repeats into the HELL ROAD boss window; exemption)' : ''}`); break; }
      }
    }
    for (const p of base) if (p.kind === 'slice' && p.srcX[1] - p.srcX[0] > LIMITS.verbatim) E(4, `${a.id}: slice ${p.src} ${p.srcX.join('-')} is ${p.srcX[1] - p.srcX[0]} px (CAMPAIGN D8: every slice <= 512 px)`);
    for (const p of base) { for (const [src, x0, x1] of EXCLUDED) if (p.src === src && p.kind !== 'patch' && p.srcX[0] < x1 && p.srcX[1] > x0) E(4, `${a.id}: ${p.src} ${p.srcX.join('-')} uses the excluded range ${src} ${x0}-${x1 === 1e9 ? 'end' : x1} (CAMPAIGN D8)`);
      if (!chap.ctxs.list[p.ctx].identity) { if (p.kind === 'slice') { let n = 0, ch = 0; for (let c = p.x0 / C.CELL; c < p.x1 / C.CELL; c++) if (prov[c] && prov[c].piece === p.index) { n++; ch += prov[c].changed; } if (n && ch / n < LIMITS.recolour) W(4, `${a.id}: ${p.src} ${p.srcX.join('-')} recolours only ${(100 * ch / n).toFixed(0)}% of its pixels`); } continue; }
      W(4, `${a.id}: ${p.src} ${p.srcX.join('-')} has an identity palette (CAMPAIGN D8 wants a preset on every slice)`); }
    if (A.loop) {   // PLAN R7 / CAMPAIGN 2-6: the drive boss section patches >= 25 % of the loop cells
      const pc = A.loop.period / C.CELL; let n = 0; for (const q of a.s2.patchSet) if (q % a.s2.cols < pc) n++;
      const share = n / (pc * a.walk.rows), boss = (A.sections || []).some(s => s.bossLock != null);
      loopRep.push({ area: a.id, patchedCells: n, cells: pc * a.walk.rows, share: +share.toFixed(4), boss });
      if (boss && share < LIMITS.loopPatch) E(4, `${a.id}: the drive boss section patches ${(share * 100).toFixed(1)}% of the loop cells (< 25 %, PLAN R7)`);
    }
    if (A.returnVisit) {
      const cells = (a.w / C.CELL) * a.walk.rows, share = a.s2.patchCells / cells;
      for (const p of base) if (chap.ctxs.list[p.ctx].identity) E(4, `${a.id} (return visit): ${p.src} ${p.srcX.join('-')} keeps the original palette`);
      if (share < LIMITS.returnPatch) E(4, `${a.id} (return visit ${JSON.stringify(A.returnVisit.source)}): patched cells ${(share * 100).toFixed(1)}% < 25%`);
      // a different lock layout: no lock window starts on an original lock trigger of the same source (unflipped)
      for (const l of a.locks) { const p = prov[Math.floor(l.x / C.CELL)]; if (!p || p.flip) continue; const src = C.source(p.src);
        for (const g of src.segments) { const st = typeof g.state === 'string' ? parseInt(g.state, 16) : g.state; if (st === 0x04 && Math.abs(g.trigger - p.X) < 64) E(4, `${a.id} (return visit): lock ${l.id} starts on the original lock of ${p.src} at ${g.trigger}`); } }
      W(4, `${a.id} is a return visit to ${JSON.stringify(A.returnVisit.source)} (${(share * 100).toFixed(1)}% cells patched): ${A.returnVisit.why}`);
    }
  }
  // ---- gate 3: the test-safe start (ch1 a0)
  if (ch === 'ch1') {
    const a = chap.areas[0], b0 = a.walk.band[0];
    let flat = true; for (let c = 0; c < 640 / C.CELL; c++) { const b = a.walk.band[c]; if (!b || !b0 || b[0] !== b0[0] || b[1] !== b0[1]) { flat = false; break; } }
    if (!flat) E(3, `ch1 a0: the band is not flat over x 0-640 (${JSON.stringify(a.walk.band.slice(0, 40))})`);
    if (b0) { const mid = (b0[0] + b0[1]) / 2; if (!(b0[0] <= mid - 48 && b0[1] >= mid + 48)) E(3, `ch1 a0: band ${JSON.stringify(b0)} does not cover mid ${mid} +-48`); }
    const early = a.locks.filter(l => l.x < 600); if (early.length) E(3, `ch1 a0: lock trigger before x 600 (${early.map(l => l.x).join(', ')})`);
    const props = [];
    for (const s of a.recipe.sections || []) for (const p of s.props || []) props.push({ ...p, ax: s.x0 + (p.x || 0) });
    const breakable = props.filter(p => /^(crate|barrel|drum)$/.test(p.kind) && p.ax >= 150 && p.ax <= 400), gun = props.filter(p => p.kind === 'drop' && p.type === 'gun' && p.ax >= 150 && p.ax <= 400);
    if (breakable.length < 2) E(3, `ch1 a0: ${breakable.length} breakable props in x 150-400 (need 2)`);
    if (!gun.length) E(3, 'ch1 a0: no starting gun drop in x 150-400');
  }
  // ---- gate 5: budget (files on disk under `out`)
  const dir = path.join(out, 'assets', 'stages', ch);
  if (fs.existsSync(dir)) {
    let bytes = 0;
    for (const f of walk(dir)) { const s = fs.statSync(f).size; bytes += s; if (s > LIMITS.anyFile) E(5, `${rel(out, f)} is ${s} bytes > 1.5 MB`); const d = pngSize(f); if (d && (d.w > LIMITS.page || d.h > LIMITS.page)) E(5, `${rel(out, f)} is ${d.w}x${d.h}`); }
    if (bytes > LIMITS.pagesPerChapter) E(5, `${ch} pages ${(bytes / 1048576).toFixed(3)} MB > 1.0 MB`);
    gates[5] = Object.assign(gates[5] || {}, { bytes });
  } else W(5, `${ch}: no pages written under ${rel(ROOT, dir)}`);
  const all = path.join(out, 'assets', 'stages'); if (fs.existsSync(all)) { const t = walk(all).reduce((n, f) => n + fs.statSync(f).size, 0); if (t > LIMITS.pagesTotal) E(5, `all stage pages ${(t / 1048576).toFixed(3)} MB > 5 MB`); }
  const sd = path.join(out, 'stage-data.js'); if (fs.existsSync(sd) && fs.statSync(sd).size > LIMITS.stageData) E(5, `stage-data.js is ${fs.statSync(sd).size} bytes > 150 KB`);
  // ---- gate 6: determinism (a fresh compose gives the same pixels, mask and bands)
  {
    const again = C.compose(recipe), sig = x => x.areas.map(a => [fnv(a.s2.L.pen), fnv(a.s2.L.pal), fnv(Uint16ToBytes(a.s2.L.ctx)), fnv(a.walk.mask), JSON.stringify(a.walk.band), (a.s3 || []).map(sp => fnv(sp.L.pen)).join(','), a.bg].join(':')).join('|');
    if (sig(again) !== sig(chap)) E(6, `${ch}: a second compose differs from the first`);
    const ctxSig = x => x.ctxs.list.map(c => c.key + fnv(c.rgb)).join('|'); if (ctxSig(again) !== ctxSig(chap)) E(6, `${ch}: palette contexts differ between composes`);
  }
  for (const g of [1, 2, 3, 4, 5, 6]) gates[g] = Object.assign({ errors: 0 }, gates[g] || {}, { ok: !(gates[g] && gates[g].errors) });
  return { ok: !errors.length, errors, warnings, gates, seams, locks: lockRep, s3cuts, voids, loops: loopRep };
}
// a column is verbatim when it is unpatched and fewer than half of its opaque pixels changed colour (a palette page
// that changes one word does not make a column new)
const verbatim = p => !!p && !p.patched && (p.identity || (p.changed != null && p.changed < LIMITS.recolour));
function verbatimLen(prov, r) {
  // longest stretch of verbatim columns inside the structural run r
  let best = 0, n = 0;
  for (let c = r.x / C.CELL; c < r.x / C.CELL + r.n; c++) { const p = prov[c]; if (verbatim(p)) { n++; best = Math.max(best, n); } else n = 0; }
  return best * C.CELL;
}
function rowRuns(ys) { const out = []; let a = null, b = null; for (const y of ys) { if (b != null && y === b + 1) b = y; else { if (a != null) out.push(a === b ? `${a}` : `${a}-${b}`); a = b = y; } } if (a != null) out.push(a === b ? `${a}` : `${a}-${b}`); return out.join(','); }
function rgbStep(a, x, ctxs) {
  const L = a.s2.L; let sum = 0, n = 0;
  for (let y = 0; y < L.h; y++) {
    const q0 = y * L.w + x - 1, q1 = y * L.w + x; if (L.pen[q0] === 15 || L.pen[q1] === 15) continue;
    const c0 = ctxs.list[L.ctx[q0]], c1 = ctxs.list[L.ctx[q1]], k0 = (L.pal[q0] * 16 + L.pen[q0]) * 3, k1 = (L.pal[q1] * 16 + L.pen[q1]) * 3;
    sum += (Math.abs(c0.rgb[k0] - c1.rgb[k1]) + Math.abs(c0.rgb[k0 + 1] - c1.rgb[k1 + 1]) + Math.abs(c0.rgb[k0 + 2] - c1.rgb[k1 + 2])) / 3; n++;
  }
  return n ? sum / n : 0;
}
function runsOf(xs) { const out = []; let a = null, b = null; for (const x of xs) { if (b != null && x === b + C.CELL) b = x; else { if (a != null) out.push(a === b ? `${a}` : `${a}-${b + C.CELL}`); a = b = x; } } if (a != null) out.push(a === b ? `${a}` : `${a}-${b + C.CELL}`); return out; }
function fnv(bytes) { let h = 0x811c9dc5; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); }
const Uint16ToBytes = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
function walk(dir) { const out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } return out.sort(); }
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');
function pngSize(f) { const b = Buffer.alloc(24); const fd = fs.openSync(f, 'r'); fs.readSync(fd, b, 0, 24, 0); fs.closeSync(fd); return b.readUInt32BE(12) === 0x49484452 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null; }

// ---------------------------------------------------------------- cross-chapter originality (gate 4)
function originalityAll(composed) {
  const errors = [], warnings = [], use = new Map(), byChapter = {};
  const addUse = (src, X, ch, how) => { const k = src; if (!use.has(k)) use.set(k, new Map()); const m = use.get(k); const key = C.srcWrap(C.source(src), X); if (!m.has(key)) m.set(key, new Set()); m.get(key).add(ch); if (how === 'slice') (byChapter[ch] = byChapter[ch] || new Set()).add(`${src}:${key}`); };
  const runs = [];
  for (const [ch, chap] of Object.entries(composed)) for (const a of chap.areas) {
    for (const p of a.s2.prov) if (p) addUse(p.src, p.X, ch, 'slice');
    for (const p of a.s2.pieces.filter(p => p.kind === 'patch')) for (let X = p.srcX[0]; X < p.srcX[1]; X += C.CELL) addUse(p.src, X, ch, 'patch');
    // per-area run summary for the report
    let cur = null; const prov = a.s2.prov;
    for (let c = 0; c <= prov.length; c++) { const p = prov[c]; const cont = cur && p && p.src === cur.src && p.flip === cur.flip && p.X === cur.lastX + (p.flip ? -C.CELL : C.CELL);
      if (cont) { cur.len += C.CELL; cur.lastX = p.X; if (verbatim(p)) cur.identityCols++; if (p.patched) cur.patchedCols++; cur.changed += p.changed || 0; }
      else { if (cur) runs.push(cur); cur = p ? { chapter: ch, area: a.id, x: c * C.CELL, src: p.src, srcX: p.X, flip: p.flip, len: C.CELL, lastX: p.X, identityCols: verbatim(p) ? 1 : 0, patchedCols: p.patched ? 1 : 0, changed: p.changed || 0, loop: !!p.loop } : null; } }
  }
  const areas = {}; let maxUse = { id: null, share: 0 };
  for (const [src, m] of [...use.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const S = C.source(src), cols = Math.ceil((S.world.x[1] - S.world.x[0]) / C.CELL), share = m.size / cols;
    areas[src] = { columns: m.size, of: cols, share: +share.toFixed(4), chapters: [...new Set([...m.values()].flatMap(s => [...s]))].sort() };
    if (share > maxUse.share) maxUse = { id: src, share };
    if (share > LIMITS.useFail) errors.push(`gate 4: ${src} has ${(share * 100).toFixed(1)}% of its columns used (> 60%)`);
    else if (share > LIMITS.useWarn) warnings.push(`gate 4: ${src} has ${(share * 100).toFixed(1)}% of its columns used (> 35%, the expected reuse of a small pool)`);
  }
  const chs = Object.keys(composed).sort();
  for (let i = 1; i < chs.length; i++) {
    const a = byChapter[chs[i - 1]] || new Set(), b = byChapter[chs[i]] || new Set(); const shared = [...b].filter(k => a.has(k));
    if (shared.length) errors.push(`gate 4: ${chs[i - 1]} and ${chs[i]} share ${shared.length} slice columns (${summarise(shared)}) (CAMPAIGN §4.2 reuse rule; patch cells are not counted)`);
  }
  const bw = C.scriptBossWindows();
  const report = { note: 'ARCHITECTURE §3.7 gate 4 / CAMPAIGN §4.2 usage matrix as built. A run = consecutive output columns from consecutive source columns of one original area; identityCols = unpatched columns with the original palette (verbatim). The HELL ROAD loop takes the gate-4 exemption (user question 5 default).',
    limits: LIMITS, bossWindowsUsed: C.BOSS_WINDOWS, bossWindowsFromScript: bw, areas, runs: runs.map(r => ({ chapter: r.chapter, area: r.area, x: r.x, src: r.src, srcX: r.srcX, flip: r.flip, len: r.len, verbatimCols: r.identityCols, patchedCols: r.patchedCols, recoloured: +(r.changed / (r.len / C.CELL)).toFixed(3), loop: r.loop })),
    returnVisits: Object.entries(composed).flatMap(([ch, c]) => c.areas.filter(a => a.recipe.returnVisit).map(a => ({ chapter: ch, area: a.id, source: a.recipe.returnVisit.source, why: a.recipe.returnVisit.why, patchedCells: a.s2.patchCells, cells: (a.w / C.CELL) * a.walk.rows }))),
    loops: Object.entries(composed).flatMap(([ch, c]) => c.areas.filter(a => a.recipe.loop).map(a => { const pc = a.recipe.loop.period / C.CELL; let n = 0; for (const q of a.s2.patchSet) if (q % a.s2.cols < pc) n++; return { chapter: ch, area: a.id, src: a.recipe.loop.src, x0: a.recipe.loop.x0, period: a.recipe.loop.period, exempt: !!a.recipe.loop.exempt, patchedCells: n, loopCells: pc * a.walk.rows, share: +(n / (pc * a.walk.rows)).toFixed(4) }; })),
    maxUse: { id: maxUse.id, share: +maxUse.share.toFixed(4) }, errors, warnings };
  return { ok: !errors.length, errors, warnings, report, maxUse };
}
function summarise(keys) { const by = {}; for (const k of keys) { const [s, x] = k.split(':'); (by[s] = by[s] || []).push(+x); } return Object.entries(by).map(([s, xs]) => `${s} ${runsOf(xs.sort((a, b) => a - b)).slice(0, 3).join(',')}`).join('; '); }

module.exports = { validate, originalityAll, LIMITS, EXPECT, EXCLUDED };
