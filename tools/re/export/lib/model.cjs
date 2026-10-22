// Predict a hero's (and its held weapon's) OBJ blocks from the exported JSON alone, and compare with MAME's OBJ list.
// The JSON supplies every frame's records / second record / composite parts, the hold index, the hold tables, the
// pose rows, the weapon animation sets and the bob tables. The run supplies only the game state that is not
// geometry: which frame is current (its ROM address), world position, facing, camera, pose slot, palette override.
'use strict';
const R = require('../../rom.cjs');
const W = 384, H = 224;

// record -> OBJ-like blocks in list order (block 0 first = highest priority), exactly as 0x14294/0x142D8 write them
const recCache = new Map();
function recBlocks(rec) {
  if (recCache.has(rec)) return recCache.get(rec);
  const r = R.parseRecord(rec); let out = [];
  if (r) {
    const per = !!(r.flags & 0x8000);
    out = r.blocks.map((b, k) => {
      const attr = per ? b.attr : r.flags;                      // uniform records: the flags word is every block's attr
      return { code: b.code, attr, bw: ((attr >> 8) & 15) + 1, bh: ((attr >> 12) & 15) + 1, lx: r.offs[k] ? r.offs[k].x : 0, ly: r.offs[k] ? r.offs[k].y : 0 };
    });
  }
  recCache.set(rec, out); return out;
}
// place a record with its origin at screen (fx, fy); mirror = facing right
let cull = true;
function setCull(v) { cull = v; }
function place(rec, fx, fy, mirror, palOverride, tag, out) {
  for (const b of recBlocks(rec)) {
    let attr = b.attr;
    if (palOverride != null) attr = (attr & 0xFFE0) | palOverride;
    const sx = mirror ? fx - b.lx - 16 * b.bw : fx + b.lx;
    // the draw (0x14294..) skips a block unless 0x40 <= X + 16*w and X <= 0x1C0, X = screen x + 64 (V04)
    if (cull && (sx + 64 > 0x1C0 || sx + 64 + 16 * b.bw < 0x40)) continue;
    out.push({ code: b.code, attr: mirror ? attr ^ 0x20 : attr, bw: b.bw, bh: b.bh, sx, sy: fy + b.ly, tag, rec });
  }
}
// one animation frame (hero 12-byte or weapon 10-byte JSON frame) at world origin -> blocks
function placeFrame(f, fx, fy, mirror, palOverride, tag, out) {
  const s = mirror ? -1 : 1;
  if (f.composite) { for (const p of f.parts) place(p.rec, fx + s * p.dx, fy - p.dy, mirror, palOverride, tag, out); return; }
  if (f.rec != null) place(f.rec, fx, fy, mirror, palOverride, tag, out);
  if (f.rec2 != null) place(f.rec2, fx, fy, mirror, palOverride, tag, out);
}

// Render blocks (list order, first = top) into a W x H Uint16 buffer of pal*16+pen (0xFFFF = transparent).
function rasterise(blocks) {
  const buf = new Uint16Array(W * H).fill(0xFFFF);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const o = blocks[i], fx = !!(o.attr & 0x20), fy = !!(o.attr & 0x40), pal = o.attr & 31;
    for (let r = 0; r < o.bh; r++) for (let c = 0; c < o.bw; c++) {
      const col = fx ? o.bw - 1 - c : c, row = fy ? o.bh - 1 - r : r;
      const t = R.tile((o.code & ~0xF) + ((o.code + col) & 0xF) + 0x10 * row);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const pen = t[(fy ? 15 - y : y) * 16 + (fx ? 15 - x : x)]; if (pen === 15) continue;
        // each 16x16 tile wraps on its own in the 512x512 OBJ space (MAME cps1 render_sprites: (x + n*16) & 0x1ff)
        const X = (((o.sx + 64 + c * 16) & 0x1FF) - 64) + x, Y = (((o.sy + 16 + r * 16) & 0x1FF) - 16) + y;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        buf[Y * W + X] = pal * 16 + pen;
      }
    }
  }
  return buf;
}
// MAME OBJ entries (harness frames.jsonl) -> same buffer, filtered
function rasteriseObj(obj, keep) {
  return rasterise(obj.filter(keep).map(o => ({ code: o.code, attr: o.attr, bw: o.bw, bh: o.bh, sx: o.sx, sy: o.sy })));
}
function compareBufs(a, b) {
  let union = 0, same = 0, onlyA = 0, onlyB = 0, diff = 0;
  for (let q = 0; q < a.length; q++) {
    const x = a[q], y = b[q]; if (x === 0xFFFF && y === 0xFFFF) continue;
    union++;
    if (x === y) same++; else if (y === 0xFFFF) onlyA++; else if (x === 0xFFFF) onlyB++; else diff++;
  }
  return { union, same, onlyPred: onlyA, onlyMame: onlyB, diff };
}

// ------------------------------------------------------------------------------------------- the JSON model
// index the exported hero JSON: frame address -> {list, anim, frame, f}
function indexHero(hj) {
  const idx = new Map();
  for (const [key, l] of Object.entries(hj.lists)) for (const an of l.anims) if (an.frames) an.frames.forEach((f, i) => { const a = parseInt(f.addr, 16); if (!idx.has(a)) idx.set(a, { list: key, anim: an.index, frame: i, f }); });
  return idx;
}
function indexWeapon(wj) {
  const idx = new Map();
  for (const an of wj.anims) if (an.frames) an.frames.forEach((f, i) => { const a = parseInt(f.addr, 16); if (!idx.has(a)) idx.set(a, { anim: an.index, frame: i, f }); });
  return idx;
}

// st: {x, h, d, face, split, fp, lp, cam:{x,y}, pal23, weapon:{slot, set, pal23}|null}
// returns {blocks, info} with blocks in OBJ list order: weapon first (V07), then the hero (torso then legs)
function predict(J, hero, st, cache) {
  const hj = J.heroes[hero];
  cache.idx = cache.idx || indexHero(hj);
  const info = {};
  const fr = cache.idx.get(st.fp); if (!fr) return { error: 'frame 0x' + st.fp.toString(16) + ' not in the JSON' };
  info.frame = `${fr.list}:${fr.anim}.${fr.frame}`;
  const mirror = !!st.face, feetX = st.x - st.cam.x, feetY = st.cam.y - (st.d + st.h) + 240;
  let tdx = 0, tdy = 0;
  const heroBlocks = [];
  const pov = st.pal23 & 0x80 ? st.pal23 & 31 : null;
  if (st.split) {
    const lf = cache.idx.get(st.lp); if (!lf) return { error: 'legs frame 0x' + st.lp.toString(16) + ' not in the JSON' };
    info.legs = `${lf.list}:${lf.anim}.${lf.frame}`;
    // walking legs (main anim 16) use the walk bob table, the running legs the run table (heroes.json bob.note)
    const bobIndex = (lf.f.b5 << 24) >> 24, table = lf.list === 'main' && lf.anim === 16 ? hj.bob.entries : hj.bob.run, bob = table[bobIndex];
    info.bobTable = table === hj.bob.entries ? 'walk' : 'run';
    if (!bob) return { error: 'bob index ' + bobIndex };
    tdx = bob.dx; tdy = bob.dy; info.bob = [bobIndex, tdx, tdy];
    placeFrame(fr.f, feetX + (mirror ? -tdx : tdx), feetY - tdy, mirror, pov, 'torso', heroBlocks);
    placeFrame(lf.f, feetX, feetY, mirror, pov, 'legs', heroBlocks);
  } else placeFrame(fr.f, feetX, feetY, mirror, pov, 'hero', heroBlocks);
  const wBlocks = [];
  if (st.weapon) {
    const hold = fr.f.hold; info.hold = hold;
    if (hold >= 0) {
      const he = hj.holds.entries[hold], row = hj.poseRows[st.weapon.slot];
      const anim = row ? row.anims[hold] : -1; info.weaponAnim = anim;
      if (he && anim >= 0) {
        const wj = J.weaponSets[st.weapon.set]; if (!wj) return { error: 'weapon set ' + st.weapon.set + ' not in the JSON' };
        const an = wj.anims[anim]; if (!an || !an.frames) return { error: 'weapon anim ' + anim };
        const dx = he.dx + tdx, dy = he.dy + tdy;
        info.weaponAt = [mirror ? -dx : dx, dy];
        const wpov = st.weapon.pal23 & 0x80 ? st.weapon.pal23 & 31 : null;
        placeFrame(an.frames[0], feetX + (mirror ? -dx : dx), feetY - dy, mirror, wpov, 'weapon', wBlocks);
        info.weaponRec = an.frames[0].rec;
      }
    }
  }
  return { blocks: wBlocks.concat(heroBlocks), info, feet: [feetX, feetY] };
}
module.exports = { setCull, recBlocks, place, placeFrame, rasterise, rasteriseObj, compareBufs, predict, indexHero, indexWeapon, W, H };
