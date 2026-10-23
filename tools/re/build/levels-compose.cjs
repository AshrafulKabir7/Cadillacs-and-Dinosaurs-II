// Level builder for Cadillacs & Dinosaurs II (ARCHITECTURE §3, PLAN §4.2/§5.3, KI1, KI2). Composes the authored
// stage recipes tools/re/levels/ch<N>.json from ROM cells of the 1993 game (never from the extract PNGs) and writes
//   assets/stages/<ch>/<area>/{s2,s3,fg}-<col>-<row>.png, anim.png      lazy stage pages (drawn only, never read back)
//   stage-data.js                                                       window.STAGE_DATA (all chapters, eager)
// API (PLAN §5.3):
//   compose(recipe, {sources}) -> {id, areas:[composed area]}          pure, deterministic, no file writes
//   buildAll({chapters, out, lib, validate, log}) -> {files, report}   the `stages` target of build-game-assets.cjs
//   selfTest() -> {ok, errors, info}                                    KI1 band vs depth-check.json, KI2 s3 beyond 1536
// Model (ARCHITECTURE §3.3): every layer is a grid of ROM cells (16x16 scroll2 tiles, 32x32 scroll3 tiles) rendered
// per pixel with the palette context of its piece; pieces apply in order, a later piece replaces whole cells unless
// `blend:"over"`. Each output scroll2 column records its source (area, X, flip), palette identity and patching for the
// originality gate. Terrain: a cell is walkable when its terrain type (attr >> 10) is 0 (free floor) or 21 (no-op);
// the class-0 push walls (types 1-8) and every other class are not (KI1: the lane limit, not the screen clamp).
// Patches: {patch:{src,x,h,rows?,pens?}, at, flip?, every?, repeat?, alternate? (every other copy mirrored, so copies
// meet on mirror joins), blend:'over'?, terrain:'copy'?, join? (a seam chunk), skipEmpty?}; rows/pens lift an object
// (a pillar, a tree, a pipe) off its background. Every pixel keeps its provenance (layer.pc -> the piece map), which
// gate 1 uses to find cuts at joins (joinCuts). A loop area's wrap copy repeats its first 384 px exactly, patches
// included. "s3":"auto" gives one far layer per section (a section may name it with "s3").
'use strict';
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const LEVELS = path.join(ROOT, 'tools', 're', 'levels');
const EXTRACT = path.join(ROOT, 'work', 're', 'extract');
const VERIFY = path.join(ROOT, 'work', 're', 'verify-extract', 'stages');
const CHAPTERS = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6'];
const VIEW = { w: 384, h: 224 }, CLAMP = { top: 81, bottom: 224 }, PAGE = 1024, CELL = 16;
const WALK_TYPES = new Set([0, 21]);

let G = null, S = null, P = null;
const lib = () => { if (!G) { G = require('../export/lib/stage-rom.cjs'); S = require('../export/lib/cps-scroll.cjs'); P = require('./palettes.cjs'); } };

// ---------------------------------------------------------------- source areas (stages.json)
let SJ = null; const SRC = new Map();
function stagesJson() { return SJ || (SJ = JSON.parse(fs.readFileSync(path.join(EXTRACT, 'stages', 'stages.json'), 'utf8'))); }
function parseSrc(id) { const m = /^E([1-8])a([0-3])$/.exec(String(id)); if (!m) throw new Error(`levels: bad source id '${id}' (want E<ep>a<area>)`); return { ep: +m[1], area: +m[2] }; }
function source(id) {
  if (SRC.has(id)) return SRC.get(id);
  lib();
  const { ep, area } = parseSrc(id), s = ep - 1;
  const A = stagesJson().episodes[s].areas.find(a => a.area === area);
  if (!A) throw new Error(`levels: ${id} is not an area of stages.json`);
  const ma = A.mapArea, e2 = G.areaEntry(G.T.area2, s, ma), e3 = G.areaEntry(G.T.area3, s, ma);
  const segs = (stagesJson().episodes[s].script.segments || []).filter(g => g.area === area);
  const src = {
    id, ep, area, s, ma, world: A.world, s3World: A.scroll3World || null, screens: A.compositeScreens || [],
    mapH: e2.rows * 256, hasS3: !!(e3.rows && e3.b0), e3, shift: G.shiftOf(s, ma) & 63,
    prio: G.priority(s, area), dynamic: (A.dynamic && A.dynamic.scroll2) || null, segments: segs,
  };
  SRC.set(id, src);
  return src;
}
// Original boss windows (segment states 0x06 / 0x10 / 0x13, CAMPAIGN §18.4) and the PLAN §6 list.
const BOSS_WINDOWS = { E1a2: 464, E2a2: 0, E3a0: 32752, E4a2: 1136, E5a1: 4544, E6a2: 4096, E7a3: 1264, E8a3: 4384, E8a0: 1152 };
function scriptBossWindows() {
  lib(); const out = {};
  for (const ep of stagesJson().episodes) for (const g of ep.script.segments || []) {
    const st = typeof g.state === 'string' ? parseInt(g.state, 16) : g.state;
    if (st === 0x06 || st === 0x10 || st === 0x13) { const k = `E${ep.ep}a${g.area}`; out[k] = Math.min(out[k] == null ? Infinity : out[k], g.trigger); }
  }
  return out;
}

// ---------------------------------------------------------------- palette contexts
// A context = one palette page (32 rows x 16 pens) of a source layer after the piece's ops, plus the priority masks
// of the source stage. Pixels store the context index; pages are coloured at the end.
class Contexts {
  constructor() { this.list = []; this.index = new Map(); }
  get(src, layer, ops, roles, prioFrom) {
    lib();
    const key = JSON.stringify([src.id, layer, ops || [], roles || null, prioFrom || null]);
    if (this.index.has(key)) return this.index.get(key);
    const base = P.words(src.ep, src.area, layer === 's3' ? 's3' : 's2');
    let words = base, log = [];
    if (ops && ops.length) words = P.apply(base, ops, { roles: roles || null, log, layer });
    let identity = true; for (let i = 0; i < 512; i++) if ((i & 15) !== 15 && (words[i] & 0xFFF) !== (base[i] & 0xFFF)) { identity = false; break; }
    const rgb = new Uint8Array(512 * 3), same = new Uint8Array(512);   // same[k] = 1 when pen k keeps its 1993 colour
    for (let i = 0; i < 512; i++) { const w = words[i]; rgb[i * 3] = ((w >> 8) & 15) * 17; rgb[i * 3 + 1] = ((w >> 4) & 15) * 17; rgb[i * 3 + 2] = (w & 15) * 17; same[i] = (w & 0xFFF) === (base[i] & 0xFFF) ? 1 : 0; }
    // prio: the priority masks of another source, or 'none' (dressing that always stays behind the sprites)
    const prio = prioFrom === 'none' ? [0, 0, 0, 0] : prioFrom ? source(prioFrom).prio : src.prio;
    const c = { id: this.list.length, key, src: src.id, layer, identity, rgb, same, prio, log };
    this.list.push(c); this.index.set(key, c.id);
    return c.id;
  }
}

// ---------------------------------------------------------------- pixel layers
// pc = per-pixel provenance: 1 + the index of the piece (composeS2 `map`) that last wrote the pixel, 0 = never written.
function newLayer(w, h) { return { w, h, pen: new Uint8Array(w * h).fill(15), pal: new Uint8Array(w * h), ctx: new Uint16Array(w * h), grp: new Uint8Array(w * h), pc: new Uint16Array(w * h) }; }
// Draws one ROM tile (scroll layer 2: 16 px, 3: 32 px) at (x, y); mirror flips the whole placement (slice flip).
// rows/pens keep only the pixels of those palette rows / pens (an object lifted off its background; implies blend).
function blitTile(L, layer, code, attr, x, y, ctx, { mirror = false, blend = false, pc = 0, rows = null, pens = null } = {}) {
  lib();
  const T = layer === 3 ? 32 : 16, c = S.mapCode(layer, code);
  if (c < 0) return 0;
  const t = S.tilePens(layer, c, 0), fx = !!(attr & 0x20) !== mirror, fy = !!(attr & 0x40), pal = attr & 31, grp = (attr >> 7) & 3;
  if ((rows && !rows.includes(pal))) return 0;
  const filter = !!(rows || pens);
  let n = 0;
  for (let yy = 0; yy < T; yy++) { const Y = y + yy; if (Y < 0 || Y >= L.h) continue;
    for (let xx = 0; xx < T; xx++) { const X = x + xx; if (X < 0 || X >= L.w) continue;
      const pen = t[(fy ? T - 1 - yy : yy) * T + (fx ? T - 1 - xx : xx)];
      if ((blend || filter) && pen === 15) continue;
      if (pens && !pens.includes(pen)) continue;
      const q = Y * L.w + X; L.pen[q] = pen; L.pal[q] = pal; L.grp[q] = grp; L.ctx[q] = ctx; L.pc[q] = pc; n++;
    } }
  return n;
}
// The pen and palette row of a source scroll2 pixel: cell X (16-aligned), cell bottom h, pixel (xx, yy) inside the
// cell in source orientation (xx left->right, yy top->bottom). dyn = a dynamicMap. null when the cell has no tile.
function srcPixel(src, X, hb, xx, yy, dyn) {
  lib();
  while (xx < 0) { xx += CELL; X -= CELL; } while (xx >= CELL) { xx -= CELL; X += CELL; }
  if (X < 0) return { pen: 15, pal: 0 };
  const e = cell2(src, X, hb, dyn), c = S.mapCode(2, e.code);
  if (c < 0) return { pen: 15, pal: 0 };
  const t = S.tilePens(2, c, 0), fx = !!(e.attr & 0x20), fy = !!(e.attr & 0x40);
  return { pen: t[(fy ? 15 - yy : yy) * 16 + (fx ? 15 - xx : xx)], pal: e.attr & 31 };
}
// Scroll2 cell entry of a source at world (X, h) (16-px cell, bottom-left h), with stage-3 wrap; dynamic live state.
function cell2(src, X, h, dyn) {
  lib();
  if (dyn) { const d = dyn.get(`${X},${h}`); if (d) return d; }
  const e = G.map2Entry(src.s, src.ma, X, h);
  return e || { code: 0, attr: 0 };
}
function dynamicMap(src, state) {
  if (!state || !src.dynamic) return null;
  const out = new Map();
  for (const c of src.dynamic.list || []) {
    const live = (c.live || [])[state === 'first' ? 0 : (c.live || []).length - 1]; if (!live) continue;
    const [code, attr] = live.split('/').map(v => parseInt(v, 16)); out.set(`${c.X},${c.h}`, { code, attr, dynamic: true });
  }
  return out;
}

// ---------------------------------------------------------------- recipe helpers
const req = (cond, msg) => { if (!cond) throw new Error(`levels: ${msg}`); };
function sliceOf(p) { return p.slice || null; }
function framing(src, sl) {
  // h:[h0,h1] source map rows shown in the 224-px frame (h1 - h0 = 224, h0 % 16 == 0); default = the CAMPAIGN §4.1 camY
  const h = sl.h || defaultFrame(src);
  req(h[1] - h[0] === VIEW.h && h[0] % CELL === 0, `${src.id} slice frame h ${JSON.stringify(h)} must be 224 rows starting on a 16-px cell`);
  return h;
}
const CAMPAIGN_CAMY = { E1a0: 256, E1a2: 256, E2a0: 64, E2a1: 64, E5a0: 512, E6a1: 256, E8a1: 768, E8a2: 256, E8a3: 256 };
function defaultFrame(src) { const camY = CAMPAIGN_CAMY[src.id] || 0; return [camY + 16, camY + 240]; }
function opsFor(recipe, area, piece, layer) {
  const ops = [];
  if (layer === 's3' && piece.preset !== true) { const o = piece.s3ops || area.s3ops || recipe.s3ops; if (o) return [].concat(o, piece.ops || []); }
  if (piece.preset !== false && (piece.preset || area.preset || recipe.preset)) ops.push(piece.preset || area.preset || recipe.preset);
  for (const o of [].concat(recipe.ops || [], area.ops || [], piece.ops || [])) ops.push(o);
  return ops.filter(o => !(o && typeof o === 'object' && o.layer && o.layer !== layer));
}
function rolesFor(recipe, srcId, layer) { const r = recipe.roles && recipe.roles[srcId]; return (r && r[layer]) || null; }

// ---------------------------------------------------------------- scroll2 composition
function composeS2(recipe, area, ctxs) {
  const loop = area.loop || null;
  const artW = Math.max(area.w, loop ? loop.period + VIEW.w : 0);
  req(artW % CELL === 0, `${area.id}: width ${artW} not a multiple of 16`);
  const H = area.h || VIEW.h, cols = artW / CELL, rows = H / CELL;
  const L = newLayer(artW, H);
  const terrain = new Int16Array(cols * rows).fill(-1);          // -1 = no cell
  const cellSrc = new Array(cols * rows).fill(null);              // {src, X, h} of the cell drawn there (for dynamic)
  const prov = new Array(cols).fill(null);                        // per output column: {src, X, flip, ctx, identity, patched, changed}
  const pieces = [], map = [], patchCells = new Set();
  // map[i] (pixel provenance, pc = i + 1): {kind, src, ctx, dyn, flip, y0, fr | h, starts:[x of each placement], w, srcX0, srcX1}
  const place = (src, X, hb, ox, oy, ctx, mirror, blend, dyn, setTerrain, pc) => {
    const e = cell2(src, X, hb, dyn), c = (ox / CELL) | 0, r = (oy / CELL) | 0;
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    blitTile(L, 2, e.code, e.attr, ox, oy, ctx, { mirror, blend, pc });
    if (setTerrain) terrain[r * cols + c] = e.attr >> 10;
    if (!blend) cellSrc[r * cols + c] = { src: src.id, X, h: hb };
    return e;
  };
  // the loop: the area art is the source map from x0 over period + 384 px (map2Entry applies the ROM wrap)
  if (loop) {
    const src = source(loop.src), fr = loop.h || defaultFrame(src), ctx = ctxs.get(src, 's2', opsFor(recipe, area, loop, 's2'), rolesFor(recipe, src.id, 's2'));
    map.push({ kind: 'loop', src: src.id, ctx, dyn: null, flip: false, y0: 0, fr, starts: [0], w: artW, srcX0: loop.x0, srcX1: loop.x0 + artW });
    for (let c = 0; c < cols; c++) {
      const X = loop.x0 + c * CELL;
      for (let r = 0; r < rows; r++) place(src, X, fr[1] - CELL - r * CELL, c * CELL, r * CELL, ctx, false, false, null, true, map.length);
      prov[c] = { src: src.id, X: srcWrap(src, X), flip: false, ctx, identity: ctxs.list[ctx].identity, patched: 0, piece: 'loop', loop: true };
    }
    pieces.push({ kind: 'loop', src: src.id, x0: 0, x1: artW, srcX: [loop.x0, loop.x0 + loop.period], flip: false, ctx, at: [0, 0], pc: map.length });
  }
  for (const [pi, p] of (area.s2 || []).entries()) {
    const sl = sliceOf(p);
    if (sl) {
      const src = source(sl.src || `E${sl.ep}a${sl.area}`), [x0, x1] = sl.x, fr = framing(src, sl), at = p.at || [0, 0], flip = !!(p.flip || p.mirror);
      req(x0 % CELL === 0 && x1 % CELL === 0 && x1 > x0, `${area.id} s2[${pi}] ${src.id} x ${x0}-${x1} must be 16-px aligned`);
      req(at[0] % CELL === 0 && at[1] % CELL === 0, `${area.id} s2[${pi}] at ${at} must be 16-px aligned`);
      const ctx = ctxs.get(src, 's2', opsFor(recipe, area, p, 's2'), rolesFor(recipe, src.id, 's2'), p.prio || null), dyn = dynamicMap(src, p.dynamic);
      map.push({ kind: 'slice', index: pi, src: src.id, ctx, dyn, flip, y0: at[1], fr, starts: [at[0]], w: x1 - x0, srcX0: x0, srcX1: x1 });
      const pc = map.length, n = (x1 - x0) / CELL;
      for (let k = 0; k < n; k++) {
        const X = flip ? x1 - CELL - k * CELL : x0 + k * CELL, ox = at[0] + k * CELL, c = ox / CELL;
        let dynCells = 0;
        for (let r = 0; r < rows; r++) {
          const oy = at[1] + r * CELL, hb = fr[1] - CELL - r * CELL;
          if (oy < 0 || oy >= H) continue;
          const e = place(src, X, hb, ox, oy, ctx, flip, !!p.blend, dyn, !p.blend, pc);
          if (e && e.dynamic) { dynCells++; patchCells.add((oy / CELL) * cols + c); }
        }
        if (c >= 0 && c < cols && !p.blend) prov[c] = { src: src.id, X, flip, ctx, identity: ctxs.list[ctx].identity, patched: dynCells, piece: pi };
      }
      // rows the slice did not cover (at.y offsets) keep their previous cells; uncovered rows of a fresh column are empty
      pieces.push({ kind: 'slice', index: pi, src: src.id, x0: at[0], x1: at[0] + (x1 - x0), y: at[1], srcX: [x0, x1], h: fr, flip, ctx, step: !!p.step, blend: !!p.blend, dynamic: p.dynamic || null, note: p.note || null, pc });
      continue;
    }
    // patches: cells copied from a source rect (chunks: a pillar, a heap, a door frame, a strip of floor); they never
    // count as a slice. rows/pens lift an object off its background; join:true marks a seam chunk (gate 1).
    const pt = p.patch || null;
    if (pt) {
      const src = source(pt.src), [x0, x1] = pt.x, [h0, h1] = pt.h, at = p.at, flip = !!p.flip;
      req(x0 % CELL === 0 && x1 % CELL === 0 && h0 % CELL === 0 && h1 % CELL === 0 && at[0] % CELL === 0 && at[1] % CELL === 0, `${area.id} s2[${pi}] patch must be 16-px aligned`);
      const ctx = ctxs.get(src, 's2', opsFor(recipe, area, p, 's2'), rolesFor(recipe, src.id, 's2'), p.prio || null);
      const nx = (x1 - x0) / CELL, ny = (h1 - h0) / CELL, every = p.every || null, limit = loop ? loop.period : artW;
      const reps = p.repeat || (every ? Math.max(1, Math.floor((limit - at[0] - (x1 - x0)) / every) + 1) : 1);
      const starts = Array.from({ length: reps }, (_, rep) => at[0] + rep * (every || (x1 - x0)));
      const flips = starts.map((_, rep) => flip !== (!!p.alternate && rep % 2 === 1));   // alternate: every other placement mirrored (mirror joins)
      map.push({ kind: 'patch', index: pi, src: src.id, ctx, dyn: null, flip, flips, y0: at[1], h: [h0, h1], starts, w: x1 - x0, srcX0: x0, srcX1: x1 });
      const pc = map.length, rowsF = pt.rows || p.rows || null, pensF = pt.pens || p.pens || null; let drawn = 0, cellPx = 0;
      for (const [ri, bx] of starts.entries()) { const fl = flips[ri];
        for (let k = 0; k < nx; k++) for (let j = 0; j < ny; j++) {
          const X = fl ? x1 - CELL - k * CELL : x0 + k * CELL, hb = h1 - CELL - j * CELL, ox = bx + k * CELL, oy = at[1] + j * CELL;
          if (ox < 0 || ox >= artW || oy < 0 || oy >= H) continue;
          const e = cell2(src, X, hb, null);
          if (p.skipEmpty && emptyTile(e.code)) continue;
          const n = blitTile(L, 2, e.code, e.attr, ox, oy, ctx, { mirror: fl, blend: p.blend === 'over', pc, rows: rowsF, pens: pensF }); cellPx += 256; if (!rowsF && !pensF && p.blend !== 'over') { for (let yy = 0; yy < CELL; yy++) for (let xx = 0; xx < CELL; xx++) if (L.pen[(oy + yy) * artW + ox + xx] !== 15) drawn++; }
          if ((rowsF || pensF) && !n) continue;
          if (p.terrain === 'copy') terrain[(oy / CELL) * cols + ox / CELL] = e.attr >> 10;
          patchCells.add((oy / CELL) * cols + ox / CELL);
        }
      }
      pieces.push({ kind: 'patch', index: pi, src: src.id, x0: at[0], x1: starts[starts.length - 1] + (x1 - x0), y: at[1], srcX: [x0, x1], h: [h0, h1], flip, ctx, blend: p.blend || (rowsF || pensF ? 'object' : null), join: !!p.join, floor: !!p.floor, starts, opaque: cellPx ? drawn / cellPx : 1, note: p.note || null, pc });
      continue;
    }
    if (p.tiles) {
      const src = source(p.tiles.src), at = p.at, ctx = ctxs.get(src, 's2', opsFor(recipe, area, p, 's2'), rolesFor(recipe, src.id, 's2'), p.prio || null);
      map.push({ kind: 'tiles', index: pi, src: src.id, ctx, dyn: null, flip: false, y0: at[1], starts: [at[0]], w: CELL });
      for (const t of p.tiles.cells) {
        const ox = at[0] + (t.dx || 0), oy = at[1] + (t.dy || 0); req(ox % CELL === 0 && oy % CELL === 0, `${area.id} tiles must be 16-px aligned`);
        blitTile(L, 2, parseInt(t.code, 16), parseInt(t.attr, 16), ox, oy, ctx, { blend: p.blend === 'over', pc: map.length });
        patchCells.add((oy / CELL) * cols + ox / CELL);
      }
      pieces.push({ kind: 'tiles', index: pi, src: src.id, x0: at[0], x1: at[0] + CELL, ctx, note: p.note || null, pc: map.length });
      continue;
    }
    throw new Error(`levels: ${recipe.id}/${area.id} s2[${pi}] has no slice/patch/tiles`);
  }
  // the loop's wrap copy: the art past the period repeats the first columns exactly (patches included), so the road
  // never changes when it wraps (ARCHITECTURE §2.5)
  if (loop) {
    const pc = loop.period / CELL;
    for (let c = pc; c < cols; c++) {
      const s = c - pc;
      for (let y = 0; y < H; y++) for (let xx = 0; xx < CELL; xx++) { const d = y * artW + c * CELL + xx, q = y * artW + s * CELL + xx; L.pen[d] = L.pen[q]; L.pal[d] = L.pal[q]; L.ctx[d] = L.ctx[q]; L.grp[d] = L.grp[q]; L.pc[d] = L.pc[q]; }
      for (let r = 0; r < rows; r++) { terrain[r * cols + c] = terrain[r * cols + s]; cellSrc[r * cols + c] = cellSrc[r * cols + s]; }
    }
    for (const q of [...patchCells]) { const c = q % cols, r = (q - c) / cols; if (c < pc && c + pc < cols) patchCells.add(r * cols + c + pc); else if (c >= pc) patchCells.delete(q); }
    for (const q of [...patchCells]) { const c = q % cols; if (c >= pc && !patchCells.has(q - pc)) patchCells.delete(q); }
  }
  for (const q of patchCells) { const c = q % cols; if (prov[c]) prov[c].patched = (prov[c].patched || 0) + 1; }
  // recolour metric (gate 4): share of each column's opaque pixels whose colour differs from the 1993 palette
  for (let c = 0; c < cols; c++) {
    if (!prov[c]) continue; let n = 0, ch = 0;
    for (let y = 0; y < H; y++) for (let xx = 0; xx < CELL; xx++) { const q = y * artW + c * CELL + xx; if (L.pen[q] === 15) continue; n++; if (!ctxs.list[L.ctx[q]].same[L.pal[q] * 16 + L.pen[q]]) ch++; }
    prov[c].changed = n ? ch / n : 1;
  }
  return { L, artW, H, cols, rows, terrain, prov, pieces, map, patchCells: patchCells.size, patchSet: patchCells, cellSrc };
}
// ---------------------------------------------------------------- seam analysis (gate 1)
// The source pixel an output pixel came from (piece map), and its neighbour in source space one pixel to the right
// (dir +1) or left (dir -1) of the output column: what the original art has next to it.
function sourceOf(s2, ox, oy) {
  const pc = s2.L.pc[oy * s2.artW + ox]; if (!pc) return null;
  const m = s2.map[pc - 1]; if (m.kind === 'tiles') return null;
  let bx = m.starts[0], fl = m.flips ? m.flips[0] : m.flip; for (const [i, b] of m.starts.entries()) if (b <= ox && ox < b + m.w) { bx = b; fl = m.flips ? m.flips[i] : m.flip; break; }
  const dx = ox - bx, k = Math.floor(dx / CELL), px = dx - k * CELL, dy = oy - m.y0, r = Math.floor(dy / CELL), yy = dy - r * CELL;
  const X = fl ? m.srcX1 - CELL - k * CELL : m.srcX0 + k * CELL, xx = fl ? CELL - 1 - px : px;
  const hb = m.kind === 'patch' ? m.h[1] - CELL - r * CELL : m.fr[1] - CELL - r * CELL;
  return { m, flip: fl, src: source(m.src), X, hb, xx, yy, ctx: m.ctx };
}
function colourAt(ctxs, ctx, pal, pen) { if (pen === 15) return -1; const c = ctxs.list[ctx].rgb, k = (pal * 16 + pen) * 3; return (c[k] << 16) | (c[k + 1] << 8) | c[k + 2]; }
// Rows of the boundary between output columns b-1 and b that show a cut: both pixels opaque and neither one is what
// the other side's original art continues into, or an object of one side cut off where its original goes on.
function joinCuts(s2, ctxs, b, { y0 = 0, y1 = s2.H } = {}) {
  const L = s2.L, W = s2.artW, rows = [];
  if (b <= 0 || b >= W) return { cut: 0, rows };
  for (let y = y0; y < y1; y++) {
    const ql = y * W + b - 1, qr = y * W + b, cl = colourAt(ctxs, L.ctx[ql], L.pal[ql], L.pen[ql]), cr = colourAt(ctxs, L.ctx[qr], L.pal[qr], L.pen[qr]);
    if (cl === cr) continue;                     // both open, a mirror axis or a flat colour: no visible cut
    const sl = sourceOf(s2, b - 1, y), sr = sourceOf(s2, b, y);
    const nextL = sl ? srcPixel(sl.src, sl.X, sl.hb, sl.xx + (sl.flip ? -1 : 1), sl.yy, sl.m.dyn) : null;
    const prevR = sr ? srcPixel(sr.src, sr.X, sr.hb, sr.xx + (sr.flip ? 1 : -1), sr.yy, sr.m.dyn) : null;
    const contL = nextL ? colourAt(ctxs, sl.ctx, nextL.pal, nextL.pen) === cr : cr < 0;
    const contR = prevR ? colourAt(ctxs, sr.ctx, prevR.pal, prevR.pen) === cl : cl < 0;
    if (contL || contR) continue;
    rows.push(y);
  }
  return { cut: rows.length, rows };
}
const EMPTY = new Map();
function emptyTile(code) {
  lib(); if (EMPTY.has(code)) return EMPTY.get(code);
  const c = S.mapCode(2, code); let empty = true; if (c >= 0) { const t = S.tilePens(2, c, 0); for (let i = 0; i < 256; i++) if (t[i] !== 15) { empty = false; break; } }
  EMPTY.set(code, empty); return empty;
}
function srcWrap(src, X) { let x = X; if (src.s === 2) while (x >= 0x4d00) x -= 0xf00; return x; }

// ---------------------------------------------------------------- scroll3 composition
// s3 = one span or a list of spans {x:[x0,x1] (area x it shows behind; default the whole area), src, shift, x3:[a,b]
// (source X3 range, 32-px aligned), h:[h0,h1] (source rows), fill:'mirror'|'repeat', ops, period?}.
// A span is seen while the camera is in [c0, c1] (c0 = max(0, x0 - 384)); its strip x at screen x sx is
// X3 = ((cam.x - c0) >> shift) + sx, and it is drawn only where cam.x + sx lies in [x0, x1): the far layer changes at
// the scroll2 seam, each side keeping its own parallax. A looping span (period) is sampled at
// mod((cam.x + road) >> shift, period). Cells are read through map3Entry, which streams past the declared map width
// exactly as the game does (KI2).
// "s3":"auto" (or {"auto":true, ...defaults}) gives every SECTION one far layer (CAMPAIGN §12.2, ARCHITECTURE §3.3:
// the far layer never jumps at a scroll2 seam): the source with the most slice columns in the section that has a
// scroll3 (a section may name it with "s3":"E4a0"), at its original shift, framed at the original Y3 and started near
// the X3 the original camera showed. Consecutive sections with the same far layer share one span.
const S3_LIMIT = { E2a1: 1856 };   // live maximum of the streamed scroll3 past the declared width (s3-beyond.json, KI2 / PLAN R20)
function autoS3(area, s2) {
  const opt = typeof area.s3 === 'object' ? area.s3 : {}, out = [];
  const base = s2.pieces.filter(p => p.kind === 'slice' && !p.blend).sort((p, q) => p.x0 - q.x0);
  const secs = (area.sections && area.sections.length) ? area.sections : [{ x0: 0, len: area.w }];
  for (const sec of secs) {
    const inSec = base.filter(p => p.x0 >= sec.x0 && p.x1 <= sec.x0 + sec.len), cols = new Map();
    for (const p of inSec) if (source(p.src).hasS3) cols.set(p.src, (cols.get(p.src) || 0) + (p.x1 - p.x0));
    let pick = typeof sec.s3 === 'string' ? sec.s3 : (sec.s3 && sec.s3.src) || null; const over = sec.s3 && typeof sec.s3 === 'object' ? sec.s3 : null;
    if (!pick) { let best = -1; for (const p of inSec) { const n = cols.get(p.src); if (n != null && n > best) { best = n; pick = p.src; } } }
    if (!pick) continue;
    const mine = inSec.filter(p => p.src === pick), frame = (mine[0] || inSec[0]).h || defaultFrame(source(pick));
    const srcX0 = mine.length ? Math.min(...mine.map(p => p.srcX[0])) : 0, srcX1 = mine.length ? Math.max(...mine.map(p => p.srcX[1])) : VIEW.w;
    const last = out[out.length - 1];
    if (last && last.src === pick && last.x[1] === sec.x0) { last.x[1] = sec.x0 + sec.len; last.srcX0 = Math.min(last.srcX0, srcX0); last.srcX1 = Math.max(last.srcX1, srcX1); continue; }
    out.push({ x: [sec.x0, sec.x0 + sec.len], src: pick, srcX0, srcX1, frame, over });
  }
  return out.map(d => {
    const src = source(d.src), shift = (opt.shift && opt.shift[d.src] != null) ? opt.shift[d.src] : src.shift, sw = src.s3World || { x: [0, 1024], h: [16, 240] };
    const camY = d.frame[0] - 16, scr = src.screens.find(c => Math.abs(c.camY - camY) < 32 && c.Y3 != null), Y3 = scr ? scr.Y3 : sw.h[0] - 16;
    // the X3 range the original camera showed behind these source columns, inside the streamed width (KI2: E2a1 to 1856)
    const limit = Math.min(S3_LIMIT[d.src] || src.e3.b0 * 256, (sw.x[1] + 31) & ~31);
    let a = Math.max(sw.x[0] & ~31, (d.srcX0 >> src.shift) & ~31), b = Math.min(limit, ((Math.max(d.srcX0, d.srcX1 - VIEW.w) >> src.shift) + VIEW.w + 31) & ~31);
    if (b - a < 64) a = Math.max(0, b - 64);
    const o = Object.assign({ x: d.x, src: d.src, shift, x3: [a, b], h: [Y3 + 16, Y3 + 240] }, (opt.spans && opt.spans[d.src]) || {}, d.over || {});
    o.x = d.x; return o;
  });
}
function composeS3(recipe, area, artW, ctxs, s2) {
  if (!area.s3) return null;
  lib();
  const defs = area.s3 === 'auto' || (area.s3 && area.s3.auto) ? autoS3(area, s2) : Array.isArray(area.s3) ? area.s3 : [area.s3], camMax = area.loop ? area.loop.period : Math.max(0, area.w - VIEW.w);
  return defs.map((d, k) => {
    const src = source(d.src); req(src.hasS3, `${area.id}: ${src.id} has no scroll3 layer`);
    const shift = d.shift == null ? src.shift : d.shift, period = d.period || null;
    const [x0, x1] = d.x || [0, area.w], c0 = period ? 0 : Math.max(0, x0 - VIEW.w), c1 = period ? 0 : Math.min(camMax, x1);
    const w = period ? period + VIEW.w : ((Math.max(0, c1 - c0)) >> shift) + VIEW.w;
    const sw = src.s3World || { x: [0, 1024], h: [16, 240] };
    const [a, b] = d.x3 || [sw.x[0] & ~31, sw.x[1] & ~31], [h0, h1] = d.h || [sw.h[0], sw.h[0] + VIEW.h];
    req(h1 - h0 === VIEW.h, `${area.id}: s3 frame must be 224 rows`);
    req(a % 32 === 0 && b % 32 === 0 && b > a, `${area.id}: s3 x3 ${a}-${b} must be 32-px aligned`);
    const W = Math.ceil(w / 32) * 32, L = newLayer(W, VIEW.h);
    const ctx = ctxs.get(src, 's3', opsFor(recipe, area, d, 's3'), rolesFor(recipe, src.id, 's3'));
    const len = b - a, mode = d.fill || 'mirror', used = new Set();
    for (let ox = 0; ox < W; ox += 32) {
      const seg = Math.floor(ox / len), within = ox - seg * len, mir = mode === 'mirror' && (seg & 1) === 1;
      const X = mir ? b - 32 - within : a + within;
      used.add(X);
      for (let hb = (h1 - 1) & ~31; hb + 32 > h0; hb -= 32) {
        if (hb < 0) break;
        const e = G.map3Entry(src.s, src.ma, X, hb);
        if (!e) continue;
        blitTile(L, 3, e.code, e.attr, ox, h1 - 32 - hb, ctx, { mirror: mir });
      }
    }
    return { index: k, L, w, W, x0, x1, c0, shift, period, ctx, src: src.id, x3: [a, b], h: [h0, h1], fill: mode, used: [...used].sort((p, q) => p - q) };
  });
}

// ---------------------------------------------------------------- walk mask and band (KI1)
// cell (c, r) covers pixel rows 16r..16r+15, i.e. feet y 16r+1..16r+16. The band of a column is the run of walkable
// cells inside the screen clamp (feet 81..224) continuing the previous column's band (largest overlap), else the
// tallest; walk.patch rects (pixel rows, 16-aligned) set cells walkable or not first.
function walkOf(area, s2) {
  const { cols, rows, terrain } = s2, W = area.w / CELL;
  const walk = new Uint8Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) walk[i] = terrain[i] >= 0 && WALK_TYPES.has(terrain[i]) ? 1 : 0;
  const patches = (area.walk && area.walk.patch) || [], patched = new Set();
  for (const pt of patches) {
    const [x, y, w, h] = pt.rect;
    for (let c = Math.floor(x / CELL); c < Math.ceil((x + w) / CELL); c++) for (let r = Math.floor(y / CELL); r < Math.ceil((y + h) / CELL); r++)
      if (c >= 0 && c < cols && r >= 0 && r < rows) { if (pt.walk !== false && !walk[r * cols + c]) patched.add(r * cols + c); walk[r * cols + c] = pt.walk === false ? 0 : 1; }
  }
  const r0 = Math.ceil((CLAMP.top - 1) / CELL), band = new Array(W).fill(null);
  let prev = null;
  for (let c = 0; c < W; c++) {
    const runs = []; let cur = null;
    for (let r = r0; r < rows; r++) { if (walk[r * cols + c]) { if (cur && cur[1] === r) cur[1] = r + 1; else { cur = [r, r + 1]; runs.push(cur); } } else cur = null; }
    let pick = null;
    if (runs.length) {
      if (prev) { let bo = 0; for (const q of runs) { const o = Math.min(q[1], prev[1]) - Math.max(q[0], prev[0]); if (o > bo) { bo = o; pick = q; } } }
      if (!pick) pick = runs.slice().sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]) || q[1] - p[1])[0];
    }
    band[c] = pick ? [Math.max(CLAMP.top, pick[0] * CELL + 1), Math.min(CLAMP.bottom, pick[1] * CELL)] : null;
    if (pick) prev = pick;
  }
  // mask shipped = walkable cells of the gameplay width, clipped to the clamp rows
  const mask = new Uint8Array(W * rows);
  for (let c = 0; c < W; c++) for (let r = r0; r < rows; r++) mask[r * W + c] = walk[r * cols + c];
  return { band, mask, cols: W, rows, patches, patched, artCols: cols };
}
function packBits(bits) { const out = Buffer.alloc(Math.ceil(bits.length / 8)); for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 0x80 >> (i & 7); return out.toString('base64'); }

// ---------------------------------------------------------------- anims (animated ROM cells, CAMPAIGN 1-1/1-4 fire)
// {cells:{src, x:[X0,X1], h:[h0,h1]}, at:[x,y], pens?, rows?} -> frames from stages.json dynamic.scroll2.animRows states
// (pens/rows keep only those pens / palette rows, e.g. the flame pens of a fire tile without its ground; fg:false keeps
// the whole animation in the playfield layer, behind the sprites, when its source's priority pens would put a background
// fire in front of the heroes: G2's front pass draws the fg part over every sprite)
function composeAnims(recipe, area, ctxs) {
  const out = [];
  for (const [ai, a] of (area.anims || []).entries()) {
    if (!a.cells) continue;
    const src = source(a.cells.src), [x0, x1] = a.cells.x, [h0, h1] = a.cells.h, at = a.at;
    const rowsA = ((src.dynamic && src.dynamic.animRows) || []).filter(r => r.X >= x0 && r.X < x1 && r.h >= h0 && r.h < h1);
    req(rowsA.length, `${area.id} anims[${ai}]: no animated cells of ${src.id} in x ${x0}-${x1} h ${h0}-${h1}`);
    const nF = Math.max(...rowsA.map(r => r.states.length)), w = x1 - x0, h = h1 - h0;
    const ctx = ctxs.get(src, 's2', opsFor(recipe, area, a, 's2'), rolesFor(recipe, src.id, 's2'));
    const frames = [];
    for (let f = 0; f < nF; f++) {
      const L = newLayer(w, h), dyn = new Map();
      for (const r of rowsA) { const st = r.states[f % r.states.length]; dyn.set(`${r.X},${r.h}`, { code: parseInt(st[0], 16), attr: parseInt(st[1], 16) }); }
      for (let X = x0; X < x1; X += CELL) for (let hb = h0; hb < h1; hb += CELL) {
        const e = cell2(src, X, hb, dyn), oy = h1 - CELL - hb;
        if (a.onlyAnimated && !dyn.has(`${X},${hb}`)) continue;
        blitTile(L, 2, e.code, e.attr, X - x0, oy - 0, ctx, {});
      }
      if (a.pens || a.rows) for (let q = 0; q < L.pen.length; q++) { if (L.pen[q] === 15) continue; if ((a.pens && !a.pens.includes(L.pen[q])) || (a.rows && !a.rows.includes(L.pal[q]))) L.pen[q] = 15; }
      frames.push(L);
    }
    const durs = rowsA[0].states.map(s => s[2]);
    out.push({ index: ai, src: src.id, x: at[0], y: at[1], w, h, frames, durs, ctx, fg: a.fg !== false, note: a.note || null });
  }
  return out;
}

// ---------------------------------------------------------------- colouring and pages
function rgbaOf(L, ctxs, { fg = false, x0 = 0, y0 = 0, w = L.w, h = L.h } = {}) {
  const out = new Uint8Array(w * h * 4); let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x0 + x, Y = y0 + y; if (X >= L.w || Y >= L.h) continue;
    const q = Y * L.w + X, pen = L.pen[q]; if (pen === 15) continue;
    const c = ctxs.list[L.ctx[q]];
    if (fg && !((c.prio[L.grp[q]] >> pen) & 1)) continue;
    const k = (L.pal[q] * 16 + pen) * 3, o = (y * w + x) * 4;
    out[o] = c.rgb[k]; out[o + 1] = c.rgb[k + 1]; out[o + 2] = c.rgb[k + 2]; out[o + 3] = 255; n++;
  }
  return { rgba: out, opaque: n };
}
function pagesOf(L, ctxs, { fg = false, width = L.w } = {}) {
  const pages = [];
  for (let row = 0; row * PAGE < L.h; row++) for (let col = 0; col * PAGE < width; col++) {
    const x0 = col * PAGE, y0 = row * PAGE, w = Math.min(PAGE, width - x0), h = Math.min(PAGE, L.h - y0);
    const { rgba, opaque } = rgbaOf(L, ctxs, { fg, x0, y0, w, h });
    if (!opaque) continue;
    pages.push({ col, row, w, h, rgba });
  }
  return pages;
}
function atlasOfAnims(anims, ctxs) {
  if (!anims.length) return null;
  let W = 0, H = 0; const places = [];
  for (const a of anims) { const fw = a.w * a.frames.length; places.push({ a, y: H }); W = Math.max(W, fw); H += a.h * 2; }  // s2 row then fg row
  const rgba = new Uint8Array(W * H * 4), meta = [];
  for (const { a, y } of places) {
    a.frames.forEach((L, f) => {
      for (const [k, fg] of a.fg === false ? [[0, false]] : [[0, false], [1, true]]) {
        const { rgba: px } = rgbaOf(L, ctxs, { fg });
        for (let yy = 0; yy < a.h; yy++) for (let xx = 0; xx < a.w; xx++) { const s = (yy * a.w + xx) * 4; if (!px[s + 3]) continue; const d = ((y + k * a.h + yy) * W + f * a.w + xx) * 4; rgba.set(px.subarray(s, s + 4), d); }
      }
    });
    const hasFg = a.fg !== false && a.frames.some(L => rgbaOf(L, ctxs, { fg: true }).opaque);
    meta.push({ layer: 's2', x: a.x, y: a.y, w: a.w, h: a.h, frames: a.frames.map((_, f) => [f * a.w, y]), durs: a.durs });
    if (hasFg) meta.push({ layer: 'fg', x: a.x, y: a.y, w: a.w, h: a.h, frames: a.frames.map((_, f) => [f * a.w, y + a.h]), durs: a.durs });
  }
  return { w: W, h: H, rgba, meta };
}

// ---------------------------------------------------------------- backdrop colour ('auto')
function autoBg(s2, s3, ctxs) {
  const count = new Map(), add = (L, y0, y1) => { if (!L) return; for (let y = y0; y < Math.min(y1, L.h); y++) for (let x = 0; x < L.w; x += 2) { const q = y * L.w + x; if (L.pen[q] === 15) continue; const c = ctxs.list[L.ctx[q]], k = (L.pal[q] * 16 + L.pen[q]) * 3, v = (c.rgb[k] << 16) | (c.rgb[k + 1] << 8) | c.rgb[k + 2]; count.set(v, (count.get(v) || 0) + 1); } };
  if (s3 && s3.length) add(s3[0].L, 0, 8); else add(s2.L, 0, 8);
  let best = 0, bn = -1; for (const [v, n] of [...count.entries()].sort((a, b) => a[0] - b[0])) if (n > bn) { bn = n; best = v; }
  return '#' + best.toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------- camera list, locks, sections
function areaCamera(recipe, area, ai, nAreas) {
  const cam = [{ x: 0, mode: 'follow', lead: (area.camera && area.camera.lead) || 192 }], locks = [];
  for (const sec of area.sections || []) {
    (sec.locks || []).forEach((x, k) => { const id = `${sec.id}/${k}`; locks.push({ id, x, section: sec.id }); cam.push({ x, mode: 'lock', id }); });
    if (sec.bossLock != null) { const id = `${sec.id}/${(sec.locks || []).length}`; locks.push({ id, x: sec.bossLock, section: sec.id, boss: true }); cam.push({ x: sec.bossLock, mode: 'boss', id }); }
  }
  if (ai < nAreas - 1) cam.push({ x: area.w - VIEW.w, mode: 'exit', to: recipe.areas[ai + 1].id, fx: 'fade' });
  if (area.timer) cam.push(...area.timer);
  cam.sort((p, q) => p.x - q.x || order(p.mode) - order(q.mode));
  return { camera: cam, locks };
}
const order = m => ({ follow: 0, auto: 1, lock: 2, boss: 3, exit: 4 }[m] || 5);

// ---------------------------------------------------------------- compose one recipe
function compose(recipe, opts = {}) {
  lib();
  const ctxs = opts.ctxs || new Contexts();
  const areas = recipe.areas.map((area, ai) => {
    const s2 = composeS2(recipe, area, ctxs);
    const s3 = composeS3(recipe, area, s2.artW, ctxs, s2);
    const walk = walkOf(area, s2);
    const anims = composeAnims(recipe, area, ctxs);
    const { camera, locks } = areaCamera(recipe, area, ai, recipe.areas.length);
    const bg = !area.bg || area.bg === 'auto' ? autoBg(s2, s3, ctxs) : area.bg;
    const startX = (area.start && area.start.x) || 60, sb = walk.band[Math.min(walk.cols - 1, Math.floor(startX / CELL))];
    const start = { x: startX, y: area.start && area.start.y != null ? area.start.y : sb ? Math.round((sb[0] + sb[1]) / 2) : 160 };
    return { id: area.id, index: ai, recipe: area, w: area.w, h: s2.H, artW: s2.artW, s2, s3, walk, anims, camera, locks, bg, start };
  });
  return { id: recipe.id, recipe, areas, ctxs };
}

// ---------------------------------------------------------------- shipped data of a composed chapter
function stageEntry(chap, files) {
  const r = chap.recipe;
  return {
    id: r.id, title: r.title || null, objPage: r.objPage || null, preset: r.preset || null, fx: r.fx || null,
    areas: chap.areas.map(a => {
      const A = a.recipe, dir = `assets/stages/${r.id}/${a.id}/`, f = files[a.id] || {};
      const sec = (A.sections || []).map(s => ({ id: s.id, name: s.name || null, x0: s.x0, len: s.len, cap: s.cap || null, locks: (s.locks || []).slice(), bossLock: s.bossLock == null ? null : s.bossLock,
        drive: !!(s.drive || A.drive), props: s.props || [], set: s.set || [], scenery: s.scenery || [], cast: s.cast || null, music: s.music || null, note: s.note || null }));
      return {
        id: a.id, w: a.w, h: a.h, artW: a.artW, bg: a.bg, page: PAGE, dir,
        s2: f.s2 || [], fg: f.fg || [],
        s3: a.s3 ? { w: a.s3[0].w, h: VIEW.h, shift: a.s3[0].shift, y: { mode: 'fixed', y0: 0 }, pages: (f.s3 || []).flat(), spans: a.s3.map((sp, k) => ({ x0: sp.x0, x1: sp.x1, c0: sp.c0, shift: sp.shift, w: sp.w, period: sp.period || null, pages: f.s3[k] || [] })) } : null,
        anims: f.anims || [], animFile: f.anims && f.anims.length ? 'anim.png' : null,
        walk: { cell: CELL, cols: a.walk.cols, rows: a.walk.rows, mask: packBits(a.walk.mask), band: a.walk.band },
        hazards: A.hazards || [], camera: a.camera, locks: a.locks.map(l => ({ id: l.id, x: l.x, boss: l.boss || undefined })), start: a.start,
        loop: A.loop ? { x0: 0, period: A.loop.period } : null, rowscroll: A.rowscroll || null, drive: !!A.drive, fx: A.fx || null,
        returnVisit: A.returnVisit || null, cameraY: A.cameraY || null, sections: sec,
      };
    }),
  };
}

// ---------------------------------------------------------------- intermission pictures (CAMPAIGN §4.7)
// pics.json {pics:{id:{w,h,bg,preset?,layers:[{s2|s3:{src,x:[X0,X1],h:[h0,h1]}, at:[x,y], flip?, ops?, preset?}]}}}:
// ROM scroll2/scroll3 cells only, painted in order over the backdrop (pen 15 shows the layer below).
function composePic(id, def) {
  lib();
  const ctxs = new Contexts(), L = newLayer(def.w, def.h);
  for (const [li, ly] of (def.layers || []).entries()) {
    const layer = ly.s3 ? 3 : 2, d = ly.s3 || ly.s2; req(d, `pics ${id} layers[${li}] needs s2 or s3`);
    const src = source(d.src), T = layer === 3 ? 32 : 16, [x0, x1] = d.x, [h0, h1] = d.h, at = ly.at || [0, 0], flip = !!ly.flip;
    const ops = [].concat(ly.preset === false ? [] : (ly.preset || def.preset || []), ly.ops || []);
    const ctx = ctxs.get(src, layer === 3 ? 's3' : 's2', ops, null);
    for (let X = x0 & ~(T - 1); X < x1; X += T) for (let hb = (h1 - 1) & ~(T - 1); hb + T > h0; hb -= T) {
      if (hb < 0) break;
      const e = layer === 3 ? G.map3Entry(src.s, src.ma, X, hb) : G.map2Entry(src.s, src.ma, X, hb); if (!e) continue;
      const ox = at[0] + (flip ? (x1 - T - X) : (X - x0)), oy = at[1] + (h1 - T - hb);
      if (ly.pens || ly.rows) { const T2 = layer === 3 ? 32 : 16, tmp = newLayer(T2, T2); blitTile(tmp, layer, e.code, e.attr, 0, 0, ctx, { mirror: flip }); for (let yy = 0; yy < T2; yy++) for (let xx = 0; xx < T2; xx++) { const q = yy * T2 + xx, pen = tmp.pen[q]; if (pen === 15 || (ly.pens && !ly.pens.includes(pen)) || (ly.rows && !ly.rows.includes(tmp.pal[q]))) continue; const X2 = ox + xx, Y2 = oy + yy; if (X2 < 0 || Y2 < 0 || X2 >= L.w || Y2 >= L.h) continue; const d = Y2 * L.w + X2; L.pen[d] = pen; L.pal[d] = tmp.pal[q]; L.grp[d] = tmp.grp[q]; L.ctx[d] = ctx; } continue; }
      blitTile(L, layer, e.code, e.attr, ox, oy, ctx, { mirror: flip, blend: true });
    }
  }
  const { rgba } = rgbaOf(L, ctxs), bg = hexRGB(def.bg || '#000000');
  for (let i = 0; i < def.w * def.h; i++) if (!rgba[i * 4 + 3]) { rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255; }
  return { w: def.w, h: def.h, rgba };
}
const hexRGB = h => { const v = parseInt(String(h).replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

// ---------------------------------------------------------------- recipes on disk
function loadRecipe(ch) { const p = path.join(LEVELS, `${ch}.json`); return JSON.parse(fs.readFileSync(p, 'utf8')); }
function loadPics() { const p = path.join(LEVELS, 'pics.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }

// ---------------------------------------------------------------- build (the `stages` target)
// Composes every chapter (stage-data.js is always rewritten whole), writes the pages of the requested chapters and
// runs the validator on each; validation results go into report.validation for `check`.
function buildAll({ chapters = CHAPTERS, out = ROOT, lib: L = {}, validate = null, log = () => {}, write = true } = {}) {
  const png = L.png || require('./png.cjs'), emit = L.emit || require('./emit.cjs');
  const V = validate || require('./levels-validate.cjs');
  const want = new Set(chapters), files = [], report = { inputs: [], chapters: {}, validation: [], pages: {} };
  const data = { version: 1, chapters: {}, sections: {}, pics: {} };
  report.inputs.push(...CHAPTERS.map(c => `tools/re/levels/${c}.json`).filter(p => fs.existsSync(path.join(ROOT, p))), 'work/re/extract/stages/stages.json', 'work/re/verify-extract/stages/depth-check.json', 'work/re/verify-extract/stages/s3-beyond.json');
  const composed = {};
  for (const ch of CHAPTERS) {
    if (!fs.existsSync(path.join(LEVELS, `${ch}.json`))) { log(`stages ${ch}: no recipe, skipped`); continue; }
    const recipe = loadRecipe(ch), chap = compose(recipe);
    composed[ch] = chap;
    const pageFiles = {};
    let bytes = 0;
    for (const a of chap.areas) {
      const dir = path.join(out, 'assets', 'stages', ch, a.id), f = { s2: [], fg: [], s3: [], anims: [] }, keepS3 = [];
      const s2p = pagesOf(a.s2.L, chap.ctxs), fgp = pagesOf(a.s2.L, chap.ctxs, { fg: true }), s3p = (a.s3 || []).map(sp => pagesOf(sp.L, chap.ctxs, { width: sp.w }));
      const at = atlasOfAnims(a.anims, chap.ctxs);
      const emitPage = (layer, p) => {
        const file = path.join(dir, `${layer}-${p.col}-${p.row}.png`);
        f[layer].push([p.col, p.row]);
        if (write && want.has(ch)) { fs.mkdirSync(dir, { recursive: true }); const buf = png.encode({ width: p.w, height: p.h, rgba: p.rgba, palette: true }); writeIfChanged(file, buf); bytes += buf.length; files.push(file); }
      };
      s2p.forEach(p => emitPage('s2', p)); fgp.forEach(p => emitPage('fg', p));
      s3p.forEach((list, k) => { f.s3[k] = []; for (const p of list) { const name = `s3-${k}-${p.col}-${p.row}.png`; f.s3[k].push(name); keepS3.push(name);
        if (write && want.has(ch)) { fs.mkdirSync(dir, { recursive: true }); const buf = png.encode({ width: p.w, height: p.h, rgba: p.rgba, palette: true }); writeIfChanged(path.join(dir, name), buf); bytes += buf.length; files.push(path.join(dir, name)); } } });
      if (at) {
        f.anims = at.meta;
        if (write && want.has(ch)) { fs.mkdirSync(dir, { recursive: true }); const buf = png.encode({ width: at.w, height: at.h, rgba: at.rgba, palette: true }); writeIfChanged(path.join(dir, 'anim.png'), buf); bytes += buf.length; files.push(path.join(dir, 'anim.png')); }
      }
      // remove stale pages of this area (a page that became empty or a layer that shrank)
      if (write && want.has(ch) && fs.existsSync(dir)) {
        const keep = new Set([...f.s2.map(p => `s2-${p[0]}-${p[1]}.png`), ...f.fg.map(p => `fg-${p[0]}-${p[1]}.png`), ...keepS3, ...(at ? ['anim.png'] : [])]);
        for (const e of fs.readdirSync(dir)) if (e.endsWith('.png') && !keep.has(e)) fs.unlinkSync(path.join(dir, e));
      }
      pageFiles[a.id] = f;
    }
    const entry = stageEntry(chap, pageFiles);
    data.chapters[ch] = entry;
    entry.areas.forEach((a, ai) => a.sections.forEach(s => { data.sections[s.id] = { chapter: ch, area: ai, areaId: a.id, x0: s.x0, len: s.len }; }));
    report.pages[ch] = { bytes };
    if (want.has(ch)) log(`stages ${ch}: ${chap.areas.map(a => `${a.id} ${a.w}${a.artW !== a.w ? '/' + a.artW : ''}px`).join(', ')}; pages ${(bytes / 1024).toFixed(0)} KB`);
  }
  // intermission pictures (CAMPAIGN §4.7): composed from stage cells only
  const pics = loadPics();
  if (pics) {
    for (const [id, def] of Object.entries(pics.pics || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const r = composePic(id, def);
      data.pics[id] = { file: `assets/stages/pics/${id}.png`, w: r.w, h: r.h };
      if (write && want.size === CHAPTERS.length) { const file = path.join(out, 'assets', 'stages', 'pics', `${id}.png`); fs.mkdirSync(path.dirname(file), { recursive: true }); writeIfChanged(file, png.encode({ width: r.w, height: r.h, rgba: r.rgba, palette: true })); files.push(file); }
    }
  }
  // stage-data.js (always all chapters)
  const sdFile = path.join(out, 'stage-data.js');
  if (write) { emit.module(sdFile, 'window.STAGE_DATA =', data, { header: '// Generated by tools/re/build-game-assets.cjs stages from tools/re/levels/*.json and the ROM; do not edit by hand.' }); files.push(sdFile); }
  // validation per chapter
  for (const ch of Object.keys(composed)) {
    if (!want.has(ch)) continue;
    const v = V.validate(composed[ch], composed[ch].recipe, { out, data, composedAll: composed });
    v.chapter = ch; report.validation.push(v); report.chapters[ch] = { ok: v.ok, errors: v.errors.length, warnings: v.warnings.length };
    log(`stages ${ch}: gates ${v.ok ? 'ok' : 'FAIL'} (${v.errors.length} errors, ${v.warnings.length} warnings)`);
    for (const e of v.errors) log(`      error: ${e}`);
  }
  if (V.originalityAll) { const o = V.originalityAll(composed); report.originality = o; report.validation.push({ chapter: 'all', ok: o.ok, errors: o.errors, warnings: o.warnings }); log(`stages originality (all chapters): ${o.ok ? 'ok' : 'FAIL'}; max area use ${o.maxUse.id} ${(o.maxUse.share * 100).toFixed(1)}%`); for (const e of o.errors) log(`      error: ${e}`);
    if (write && out === ROOT) { fs.mkdirSync(path.join(ROOT, 'work', 're', 'levels'), { recursive: true }); emit.json(path.join(ROOT, 'work', 're', 'levels', 'originality.json'), o.report); } }
  const st = selfTest();
  report.validation.push({ chapter: 'selftest', ok: st.ok, errors: st.errors, warnings: st.warnings || [] });
  log(`stages self-test (KI1 band vs depth-check, KI2 s3 beyond 1536): ${st.ok ? 'ok' : 'FAIL'}  ${st.info}`);
  for (const e of st.errors) log(`      error: ${e}`);
  return { files, report, data, composed };
}
function writeIfChanged(file, buf) { if (fs.existsSync(file)) { const old = fs.readFileSync(file); if (old.equals(buf)) return false; } fs.writeFileSync(file, buf); return true; }

// ---------------------------------------------------------------- self-tests
// KI1: every source column a recipe uses must give the band the game enforces: compared with the live maxima of
// work/re/verify-extract/stages/depth-check.json (±4 px) wherever a probe run covers it.
// KI2: E2a1 scroll3 beyond the declared 1536 px reads the block map past the declared columns: every cell the
// builder samples there equals map3Entry, and (when the MAME run is present) the 6279 live cells of s3-beyond.json.
function bandRunAt(srcId, X, frame) {
  lib(); const src = source(srcId), camY = frame[0] - 16, runs = []; let cur = null;
  for (let h = camY + 16; h < camY + 160; h += CELL) { const t = G.map2Entry(src.s, src.ma, X, h).attr >> 10; if (WALK_TYPES.has(t)) { if (cur && cur[1] === h) cur[1] = h + CELL; else { cur = [h, h + CELL]; runs.push(cur); } } else cur = null; }
  return runs;
}
function usedSourceColumns() {
  const used = new Map();
  for (const ch of CHAPTERS) {
    if (!fs.existsSync(path.join(LEVELS, `${ch}.json`))) continue;
    const r = loadRecipe(ch);
    for (const a of r.areas) {
      for (const p of a.s2 || []) { const sl = p.slice; if (!sl) continue; const src = source(sl.src), fr = framing(src, sl); for (let X = sl.x[0]; X < sl.x[1]; X += CELL) used.set(`${src.id}:${X}`, { src: src.id, X, frame: fr }); }
      if (a.loop) { const src = source(a.loop.src), fr = a.loop.h || defaultFrame(src); for (let X = a.loop.x0; X < a.loop.x0 + a.loop.period; X += CELL) used.set(`${src.id}:${X}`, { src: src.id, X, frame: fr }); }
    }
  }
  return [...used.values()];
}
function selfTest() {
  lib();
  const errors = [], warnings = [], info = [];
  // KI1 (a) the verifier's probe runs (depth-check.json: live max h per floor run); (b) the exporter's own depth runs
  // (work/re/runs/stg-depth-e<ep>a<area>: P1 holds Up for 110 frames at several X; the settled h is the lane top there)
  // and WP-E's own walk-through probes (work/re/runs/wpe-depth-e<ep>a<area>: cycles of right 90 / up 110 / down 60).
  // A probe covers the used columns around it whose ROM band run is the same (a flat run); the rest are unprobed (R5).
  const dc = path.join(VERIFY, 'depth-check.json'), probes = [];
  if (fs.existsSync(dc)) { const D = JSON.parse(fs.readFileSync(dc, 'utf8')); for (const run of Object.values(D)) for (const [k, v] of Object.entries(run.perRun || {})) { const m = /^(\d)\/(\d) x(\d+)-(\d+)/.exec(k); if (m && v.n >= 20) probes.push({ src: `E${m[1]}a${m[2]}`, x0: +m[3], x1: +m[4], hMax: v.hMax, key: `depth-check ${k}` }); } }
  else warnings.push('depth-check.json not present: the verifier probes are skipped');
  for (const t of upHoldTops()) probes.push({ src: t.src, x0: t.X & ~15, x1: (t.X & ~15) + CELL, hMax: t.h, key: `${t.run} up@${t.n} X ${t.X}`, point: true });
  let checked = 0, bad = 0, edge = 0; const used = usedSourceColumns(), probed = new Set();
  for (const u of used) {
    const pr = probes.find(p => p.src === u.src && u.X >= p.x0 && u.X < p.x1); if (!pr) continue;
    const runs = bandRunAt(u.src, u.X, u.frame), run = runs.find(r => pr.hMax >= r[0] - 4 && pr.hMax < r[1] + 4);
    // a point probe within 32 px of a terrain change (a diagonal or push wall the ROM collision reaches sideways) says
    // nothing about the column's own lane: skipped
    if (pr.point && [-32, -16, 16, 32].some(d => JSON.stringify(bandRunAt(u.src, u.X + d, u.frame)) !== JSON.stringify(runs))) { edge++; continue; }
    checked++; probed.add(`${u.src}:${u.X}`);
    if (!run || Math.abs((run[1] - 1) - pr.hMax) > 4) { bad++; if (bad <= 8) errors.push(`KI1: ${u.src} X ${u.X}: band runs ${JSON.stringify(runs)} vs live max h ${pr.hMax} (${pr.key})`); }
  }
  // a probe also covers every used column of the same source whose terrain column (the types of all its cells in the
  // frame) is identical: the ROM collision reads only the terrain and the source's floor list
  const sig = u => { const src = source(u.src), out = []; for (let h = u.frame[0]; h < u.frame[1]; h += CELL) out.push(G.map2Entry(src.s, src.ma, u.X, h).attr >> 10); return `${u.src}:${u.frame[0]}:${out.join(',')}`; };
  const goodSig = new Set(); for (const u of used) if (probed.has(`${u.src}:${u.X}`)) goodSig.add(sig(u));
  const unprobed = {}; for (const u of used) if (!probed.has(`${u.src}:${u.X}`) && !goodSig.has(sig(u))) (unprobed[u.src] = unprobed[u.src] || []).push(u.X);
  const unprobedRanges = Object.fromEntries(Object.entries(unprobed).map(([k, xs]) => [k, ranges16(xs.sort((p, q) => p - q))]));
  info.push(`KI1 ${checked - bad}/${checked} used source columns match the live lane top ±4 px (${probes.length} probes; ${edge} point probes next to a terrain change skipped)`);
  info.push(`R5 unprobed lanes (ROM terrain only, no live sample in the same flat run): ${Object.entries(unprobedRanges).map(([k, r]) => `${k} ${r.join(',')}`).join('; ') || 'none'}`);
  if (!checked) warnings.push('KI1: no used source column is covered by a probe');
  // KI2
  const sb = path.join(VERIFY, 's3-beyond.json');
  {
    const src = source('E2a1'), e3 = src.e3, W = e3.b0 * 256;
    let cells = 0, eq = 0;
    for (let X = W; X < 1856; X += 32) for (let h = 16; h < 240; h += 32) { const e = G.map3Entry(src.s, src.ma, X, h); cells++; if (e && !emptyS3(e.code)) eq++; }
    if (eq === 0) errors.push('KI2: E2a1 scroll3 past 1536 is blank in the builder');
    info.push(`KI2 E2a1 s3 ${W}-1856: ${eq}/${cells} cells drawn`);
    const runDir = path.join(ROOT, 'work', 're', 'runs', 'stg-ep2-walk');
    if (fs.existsSync(sb) && fs.existsSync(runDir)) {
      const ref = JSON.parse(fs.readFileSync(sb, 'utf8'))['2/1'], r = liveBeyond(runDir, 1, 1);
      if (!r || r.cells !== ref.cells || r.equal !== ref.equalExtendedRom) errors.push(`KI2: live scroll3 beyond the width ${r ? `${r.equal}/${r.cells}` : 'not read'} vs s3-beyond.json ${ref.equalExtendedRom}/${ref.cells}`);
      else info.push(`KI2 live ${r.equal}/${r.cells} cells = the extended ROM map (s3-beyond.json)`);
    } else warnings.push('KI2: work/re/runs/stg-ep2-walk not present, live comparison skipped');
  }
  return { ok: !errors.length, errors, warnings, info: info.join('; '), unprobed: unprobedRanges };
}
function ranges16(xs) { const out = []; let a = null, b = null; for (const x of xs) { if (b != null && x === b + CELL) b = x; else { if (a != null) out.push(`${a}-${b + CELL}`); a = b = x; } } if (a != null) out.push(`${a}-${b + CELL}`); return out; }
// settled lane tops of the exporter's depth runs: the last 20 frames of every 'up' hold, when P1 is grounded and still
let UPTOPS = null;
function upHoldTops() {
  if (UPTOPS) return UPTOPS; UPTOPS = [];
  const RUNS = path.join(ROOT, 'work', 're', 'runs'); if (!fs.existsSync(RUNS)) return UPTOPS;
  for (const r of fs.readdirSync(RUNS).filter(r => /^(stg|wpe)-depth-e\da\d$/.test(r)).sort()) {
    const pf = path.join(RUNS, r, 'plan.json'), hf = path.join(RUNS, r, 'hook.jsonl'); if (!fs.existsSync(pf) || !fs.existsSync(hf)) continue;
    const plan = JSON.parse(fs.readFileSync(pf, 'utf8')), L = fs.readFileSync(hf, 'utf8').split('\n').filter(l => l.startsWith('{"n"')).map(l => JSON.parse(l));
    for (const seg of plan.inputs || []) {
      if (seg.keys.length !== 1 || seg.keys[0] !== 'up') continue;
      const tail = L.filter(x => x.n >= seg.to - 20 && x.n <= seg.to && x.m === 12 && x.ph === x.fl); if (tail.length < 6) continue;
      const hs = tail.map(x => x.pd + x.fl), xs = tail.map(x => x.px);
      if (Math.max(...hs) - Math.min(...hs) > 1 || Math.max(...xs) - Math.min(...xs) > 2) continue;
      // P1 must have climbed during the hold: a player frozen by a scripted event (E7a3 at 1231) is no lane sample
      const head = L.find(x => x.n >= seg.from && x.n <= seg.from + 8 && x.m === 12 && x.ph === x.fl);
      if (!head || hs[hs.length - 1] - (head.pd + head.fl) < 4) continue;
      UPTOPS.push({ run: r, src: `E${tail[0].st + 1}a${tail[0].ar}`, X: tail[tail.length - 1].px, h: hs[hs.length - 1], n: seg.to });
    }
  }
  return UPTOPS;
}
const EMPTY3 = new Map();
function emptyS3(code) { lib(); if (EMPTY3.has(code)) return EMPTY3.get(code); const c = S.mapCode(3, code); let e = true; if (c >= 0) { const t = S.tilePens(3, c, 0); for (let i = 0; i < 1024; i++) if (t[i] !== 15) { e = false; break; } } EMPTY3.set(code, e); return e; }
// The verifier's own method (work/re/verify-extract/stages/tools/s3-beyond.cjs) with the builder's map3Entry.
function liveBeyond(dir, s, area) {
  const A = stagesJson().episodes[s].areas.find(a => a.area === area), e = G.areaEntry(G.T.area3, s, A.mapArea), W = e.b0 * 256;
  const hk = new Map(fs.readFileSync(path.join(dir, 'hook.jsonl'), 'utf8').split('\n').filter(l => l.startsWith('{"n"')).map(l => JSON.parse(l)).map(x => [x.n, x]));
  let cells = 0, equal = 0;
  for (const f of fs.readdirSync(dir).filter(f => /^scroll3-f\d+\.bin$/.test(f)).sort()) {
    const n = +f.slice(9, 15), h = hk.get(n); if (!h || h.m !== 0xc || h.br !== 15 || h.st !== s || h.ar !== area) continue;
    const X3 = (h.s3x + 0x40) & 0xffff, Y3 = (0x700 - h.s3y) & 0xffff; if (X3 + 384 <= W) continue;
    const b = fs.readFileSync(path.join(dir, f));
    const live = (X, hh) => { const col = (X >> 5) & 63, row = ((2047 - hh) >> 5) & 63; const o = ((row & 7) + (col << 3) + ((row & 0x38) << 6)) * 4; return [b.readUInt16BE(o), b.readUInt16BE(o + 2)]; };
    for (let X = Math.max(W, X3 & ~31); X < X3 + 384; X += 32) for (let hh = Y3 + 16; hh < Y3 + 240; hh += 32) { const L = live(X, hh), R0 = G.map3Entry(s, A.mapArea, X, hh); cells++; if (R0 && R0.code === L[0] && R0.attr === L[1]) equal++; }
  }
  return { cells, equal };
}

module.exports = { joinCuts, sourceOf, srcPixel, colourAt, compose, composePic, buildAll, selfTest, source, scriptBossWindows, BOSS_WINDOWS, CHAPTERS, VIEW, CLAMP, PAGE, CELL, WALK_TYPES, loadRecipe, rgbaOf, pagesOf, Contexts, newLayer, blitTile, cell2, defaultFrame, framing, bandRunAt, usedSourceColumns, packBits, stagesJson, srcWrap, emptyTile, emptyS3 };
