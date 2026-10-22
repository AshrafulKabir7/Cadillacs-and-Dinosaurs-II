// Terrain collision of the original Cadillacs & Dinosaurs (MAME "dino"), emulated from the disassembly so the
// walkable band of every area can be computed from the ROM maps. Research tooling only.
//
// Collision routine 0x1309C (callers 0x12CD0 / 0x12E3C, retried up to 5 times while it returns carry):
//   reads the scroll2 tile attribute at (X = obj+0x08, h = depth +0x10 + floor +0x54) from the live tilemap
//   (0x90C000; E7 area 1 reads a 32x16-cell map at 0x91C000 instead, 0x136E4), type = attr >> 10 (0 = free, returns
//   at once), then the behaviour entry at 0x1370C + type*16 (8 words w0..w7):
//     w0 class -> jump table 0x1313E (0x20 is handled as 0x14), w1 sub-dispatch, w2 mirror flag, w3 shift,
//     w4 base, w5 "repeat" (return carry so the caller applies the routine again), w7 low byte -> obj+0x50.
//   class 0x00  types 1-8: one-sided push walls. w1 0: depth += 16-(h&15) (push up), 4: depth -= (h&15)+1
//               (push down), 8: X -= (X&15)+1 (push left), 0xC: X += 16-(X&15) (push right)      (0x13178..)
//   class 0x04  slopes. w1 0 floor: s = (((w2 ? X : ~X)&15) >> w3) + w4 + 1, depth += s-(h&15) when (h&15) <= s
//               (feet lifted onto the surface); 4 ceiling: s from (w2 ? ~X : X), depth -= s-(15-(h&15)) when
//               15-(h&15) <= s; 8 / 0xC: diagonal walls in X computed from h                      (0x131FE..)
//   class 0x08  corner pushes (always move one axis, 0x132CA), class 0x0C / 0x10 / 0x1C platform cells whose
//               edges push while the object is below the platform height word[0x12C40 + stage*2] (0xFF86B0,
//               written at 0x12BEC) and whose interior raises the floor (+0x56 = that height, 0x13468),
//   class 0x14 (type 21) and 0x20 (type 63, water: 0x13646 lowers the height = wading): no position change.
// Floor height +0x54 per X comes from the per-stage/area lists at 0x12C30 (0x12FE4 / 0x1302C): 12-byte entries
//   (mode, x0, x1, w3, w4, flags): mode 0 flat floor w4 (byte 7 -> +0x52), mode 1 slope: w3 + (X-x0)/4 when w4 == 0,
//   else w3 - 1 - (X-x0)/4; flags 0x100 -> +0x53 (wading flag). The map row the feet stand on is h = depth + floor.
// E7 area 1: 0x12C16 builds the collision map at 0x91C000/0x91C400 from blocks 0xC/0xD of the chunk-word table
//   0x141DC8 (128 bytes per block) and the 16-byte chunks at 0x16E188 (0x12C50): column-major, 32 columns of
//   16 cells (64 bytes per 16-px column, 4 bytes per cell, row 15 - (h >> 4)).
'use strict';
const R = require('../../rom.cjs');

const T = { table: 0x1370c, platHeight: 0x12c40, floorLists: 0x12c30, e7Blocks: 0x141dc8, e7Chunks: 0x16e188, routine: 0x1309c, stageTypeBytes: 0x13b0c };
const CLASS_NAMES = { 0x00: 'push wall (types 1-8) / free (type 0)', 0x04: 'slope', 0x08: 'corner push', 0x0c: 'platform edge (diagonal)', 0x10: 'platform', 0x14: 'no-op', 0x18: 'diagonal wall', 0x1c: 'platform edge + diagonal', 0x20: 'water (wading)' };

const PCACHE = [];
function params(type) {
  if (PCACHE[type]) return PCACHE[type];
  const o = T.table + type * 16, w = []; for (let k = 0; k < 8; k++) w.push(R.u16(o + k * 2));
  return (PCACHE[type] = { type, w, cls: w[0], w1: w[1], w2: w[2], w3: w[3], w4: w[4], w5: w[5], flag50: w[7] & 0xff });
}
const platOf = s => R.u16(T.platHeight + s * 2);

// a short description of a type's behaviour (for stages.json)
function describe(type) {
  if (type === 0) return 'free';
  const p = params(type), cls = p.cls === 0x20 ? 0x14 : p.cls, dir = ['up', 'down', 'left', 'right'][p.w1 >> 2];
  switch (cls) {
    case 0x00: return `push ${dir}${p.w5 ? ' (repeat)' : ''}`;
    case 0x04: return `${['floor slope', 'ceiling slope', 'wall from the right (diagonal)', 'wall from the left (diagonal)'][p.w1 >> 2]} s=((${p.w2 ? 'x' : '15-x'})>>${p.w3})+${p.w4}+1` .replace('x', ['x', 'x', 'y', 'y'][p.w1 >> 2]);
    case 0x08: return `corner push ${['down/left', 'down/right', 'up/left', 'up/right'][p.w1 >> 2]}${p.w5 ? ' (repeat)' : ''}`;
    case 0x0c: return `platform edge, diagonal ${p.w1 === 0xc ? 'push right' : 'push left'} below the platform height`;
    case 0x10: return ['platform interior (floor raised by the stage platform height)', 'platform edge, push down below it', 'platform edge, push left below it', 'platform edge, push right below it'][p.w1 >> 2];
    case 0x14: return p.cls === 0x20 ? 'water (wading, no push)' : 'no-op (free)';
    case 0x18: return `diagonal wall ${p.w1 === 0xc ? 'push right' : 'push left'} (w2 ${p.w2}, shift ${p.w3}, base ${p.w4})`;
    case 0x1c: return 'platform edge (push down below the platform height) + diagonal push right';
    default: return `class 0x${cls.toString(16)} (unknown)`;
  }
}

// Emulate 0x1309C for an object standing on the ground (height == floor, +0x56 cleared) at map pixel (X, h) whose
// cell has terrain `type`. Returns the correction the routine applies: dx / dh (map pixels), carry (the caller
// repeats), raised (+0x56 set to the platform height: the floor is raised there).
function collide(s, type, X, h) {
  const r = { dx: 0, dh: 0, carry: false, raised: false };
  if (type <= 0) { if (type < 0) r.dx = -1; return r; } // type < 0 = outside the map: treat as blocked
  const p = params(type), x = X & 15, y = h & 15, nx = 15 - x, ny = 15 - y, plat = platOf(s);
  const cls = p.cls === 0x20 ? 0x14 : p.cls, { w1, w2, w3, w4, w5 } = p;
  switch (cls) {
    case 0x00:
      if (w1 === 0) r.dh = ny + 1; else if (w1 === 4) r.dh = -(y + 1); else if (w1 === 8) r.dx = -(x + 1); else r.dx = nx + 1;
      r.carry = w5 !== 0; break;
    case 0x04: {
      let sv;
      if (w1 === 0) { sv = (((w2 ? x : nx) >> w3) + w4 + 1); if (!(sv < y)) r.dh = sv - y; }
      else if (w1 === 4) { sv = (((w2 ? nx : x) >> w3) + w4 + 1); if (!(sv < ny)) r.dh = -(sv - ny); }
      else if (w1 === 8) { sv = (((w2 ? y : ny) >> w3) + w4 + 1); if (!(sv < nx)) r.dx = -(sv - nx); }
      else { sv = (((w2 ? ny : y) >> w3) + w4 + 1); if (!(sv < x)) r.dx = sv - x; }
      break;
    }
    case 0x08:
      r.carry = w5 !== 0;
      if (w1 === 0) { if (x >= y) r.dh = -(y + 1); else r.dx = -(x + 1); }
      else if (w1 === 4) { if (nx >= y) r.dh = -(y + 1); else r.dx = nx + 1; }
      else if (w1 === 8) { if (x >= ny) r.dh = ny + 1; else r.dx = -(x + 1); }
      else { if (nx >= ny) r.dh = ny + 1; else r.dx = nx + 1; }
      break;
    case 0x0c: {
      let d1 = (y >> w3) + w4 + 1;
      if (w1 !== 0xc) { if (d1 <= nx) break; d1 -= nx; if (plat <= 0 || d1 >= (plat >> 2)) { r.raised = true; break; } r.dx = -d1; }
      else { if (d1 < x) break; d1 -= x; if (plat <= 0 || d1 >= (plat >> 2)) { r.raised = true; break; } r.dx = d1; }
      break;
    }
    case 0x10:
      if (w1 === 0) r.raised = true;
      else if (w1 === 4) { if (plat <= 0 || (plat >> 2) <= y) r.raised = true; else r.dh = -(y + 1); }
      else if (w1 === 8) { if (plat <= 0 || (plat >> 2) <= x) r.raised = true; else { r.dx = -(x + 1); r.carry = true; } }
      else { const d0 = (-X) & 15; if (plat <= 0 || (plat >> 2) <= d0) r.raised = true; else { r.dx = d0 + 1; r.carry = true; } }
      break;
    case 0x14: break;
    case 0x18: {
      let d1 = w2 ? y : ny;
      if (w1 !== 0xc) { if (d1 <= w4) { r.dx = -(x + 1); r.carry = true; break; } d1 = (d1 - w4) << w3; if (x < d1) break; r.dx = -((x - d1) + 1); }
      else { if (d1 < w4) break; d1 = (d1 - w4) << w3; if (x > d1) break; r.dx = d1 + 1 - x; }
      break;
    }
    case 0x1c: {
      if (plat > 0 && y < (plat >> 2)) { r.dh = -(y + 1); r.carry = true; break; }
      r.raised = true;
      let d1 = w2 ? y : ny; if (d1 < w4) break; d1 = (d1 - w4) << w3; if (x > d1) break; r.dx = d1 + 1 - x;
      break;
    }
    default: r.dx = -1; r.unknown = true;
  }
  return r;
}
const stable = (s, type, X, h) => { const c = collide(s, type, X, h); return c.dx === 0 && c.dh === 0 ? (c.raised ? 2 : 1) : 0; };

// floor-height list of (stage, area) from 0x12C30 and the floor it gives at X (0x12FE4 / 0x1302C)
function floorList(s, a) {
  const st = T.floorLists + R.u16(T.floorLists + s * 2), t = st + R.u16(st + a * 2), entries = [];
  for (let i = 0; i < 32; i++) {
    const e = t + i * 12, w = []; for (let k = 0; k < 6; k++) w.push(R.u16(e + k * 2));
    entries.push({ addr: e, mode: w[0], x0: w[1], x1: w[2], w3: w[3], w4: w[4], flags: w[5], wading: !!(w[5] & 0x100), floor: w[0] === 0 ? w[4] : null, slope: w[0] === 0 ? null : (w[4] === 0 ? `${w[3]} + (X - ${w[1]}) / 4` : `${w[3]} - 1 - (X - ${w[1]}) / 4`) });
    if (w[2] >= 0x7fff) break;
  }
  return { table: t, entries };
}
function floorAt(list, X) {
  const e = list.entries.find(q => X <= q.x1) || list.entries[list.entries.length - 1];
  if (e.mode === 0) return e.w4;
  const d = Math.max(0, X - e.x0) >> 2, f = e.w4 === 0 ? e.w3 + d : e.w3 - 1 - d;
  return f < 0 ? 0 : f;
}

// E7 area 1 collision map (0x12C16 -> 0x12C50): 32 x 16 cells of 16 px, X 0..511, h 0..255 -> terrain types
function e7ShaftMap() {
  const types = new Int16Array(32 * 16).fill(0), codes = new Uint16Array(32 * 16), attrs = new Uint16Array(32 * 16);
  for (const [blk, xoff] of [[0xc, 0], [0xd, 16]]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const chunk = R.u16(T.e7Blocks + blk * 128 + (r * 8 + c) * 2), base = T.e7Chunks + chunk * 16;
    // chunk c writes column bytes c*8 (L0, L1) of column 2r and of column 2r+1 (L2, L3): cell index i = 2c + (k & 1),
    // which the lookup addresses as 15 - (h >> 4), so the cell holds h >> 4 = 15 - i (chunk 0 is the top of the map)
    for (let k = 0; k < 4; k++) {
      const col = xoff + 2 * r + (k >> 1), hcell = 15 - 2 * c - (k & 1);
      const code = R.u16(base + k * 4), attr = R.u16(base + k * 4 + 2), q = hcell * 32 + col;
      codes[q] = code; attrs[q] = attr; types[q] = attr >> 10;
    }
  }
  // the lookup (0x136E4) masks X with 0x1F0 and h with 0xF0, so the map repeats every 512 px in X and 256 px in h
  return { w: 512, h: 256, cols: 32, rows: 16, types, codes, attrs, typeAt: (X, h) => types[((h & 0xf0) >> 4) * 32 + ((X & 0x1f0) >> 4)] };
}

// Walkable band of an area from the terrain: for every map X in [X0, X1) the h-runs (h0 <= h < h1) where the
// collision routine leaves a grounded object in place; the band is the run that holds the live P1 ground samples
// at that X, propagated to the other columns by overlap. samples = [[X, h]] (h = depth + floor).
function bandProfile({ s, typeAt, X0, X1, h0, h1, samples = [], seedWindow = null }) {
  const W = X1 - X0, runsAt = new Array(W), chosen = new Array(W).fill(null), seeded = new Uint8Array(W);
  const sampleAt = new Map(); for (const [x, h] of samples) { const k = x - X0; if (k < 0 || k >= W) continue; if (!sampleAt.has(k)) sampleAt.set(k, []); sampleAt.get(k).push(h); }
  for (let k = 0; k < W; k++) {
    const X = X0 + k, runs = []; let cur = null;
    for (let h = h0; h < h1; h++) {
      const st = stable(s, typeAt(X, h), X, h);
      if (!st) { cur = null; continue; }
      if (cur && cur.h1 === h) { cur.h1 = h + 1; if (st === 2) cur.raised++; } else { cur = { h0: h, h1: h + 1, raised: st === 2 ? 1 : 0 }; runs.push(cur); }
    }
    runsAt[k] = runs;
    const hs = sampleAt.get(k);
    if (hs) { const r = runs.find(q => hs.some(h => h >= q.h0 && h < q.h1)); if (r) { chosen[k] = r; seeded[k] = 1; } }
  }
  const overlap = (a, b) => Math.min(a.h1, b.h1) - Math.max(a.h0, b.h0);
  const pick = (runs, ref) => { let best = null, bo = 0; for (const r of runs) { const o = overlap(r, ref); if (o > bo) { bo = o; best = r; } } if (best) return best; let bd = 33; for (const r of runs) { const d = r.h0 >= ref.h1 ? r.h0 - ref.h1 : ref.h0 - r.h1; if (d < bd) { bd = d; best = r; } } return best; };
  let first = seeded.indexOf(1);
  if (first < 0 && seedWindow) { // no live samples: start from the run that overlaps the start window most
    for (let k = 0; k < W && first < 0; k++) { const r = pick(runsAt[k], { h0: seedWindow[0], h1: seedWindow[1] }); if (r && overlap(r, { h0: seedWindow[0], h1: seedWindow[1] }) > 0) { chosen[k] = r; first = k; } }
  }
  if (first >= 0) {
    for (let k = first + 1; k < W; k++) if (!seeded[k] && chosen[k - 1]) chosen[k] = pick(runsAt[k], chosen[k - 1]);
    for (let k = first - 1; k >= 0; k--) if (!seeded[k] && chosen[k + 1]) chosen[k] = pick(runsAt[k], chosen[k + 1]);
    // seeds with gaps on their left that the forward pass could not fill (chosen[k-1] null) get filled backwards
    for (let k = W - 2; k >= 0; k--) if (!chosen[k] && chosen[k + 1]) chosen[k] = pick(runsAt[k], chosen[k + 1]);
  }
  const profile = [], cols = [];
  for (let k = 0; k < W; k++) {
    const c = chosen[k], f = c ? c.h0 : null, t = c ? c.h1 : null, rz = c && c.raised ? 1 : 0, last = profile[profile.length - 1];
    if (last && last[2] === f && last[3] === t && last[4] === rz) last[1] = X0 + k + 1; else profile.push([X0 + k, X0 + k + 1, f, t, rz]);
  }
  for (let X = X0 & ~15; X < X1; X += 16) {
    let lo = null, hi = null, rz = 0, n = 0;
    for (let x = Math.max(X, X0); x < Math.min(X + 16, X1); x++) { const c = chosen[x - X0]; if (!c) continue; n++; lo = lo === null ? c.h0 : Math.min(lo, c.h0); hi = hi === null ? c.h1 : Math.max(hi, c.h1); if (c.raised) rz = 1; }
    const floor = n ? [lo, hi] : null, key = JSON.stringify([floor, rz]), last = cols[cols.length - 1];
    if (last && last.key === key) last.x1 = X + 16; else cols.push({ x0: X, x1: X + 16, floor, raised: rz ? true : undefined, key });
  }
  const fl = profile.filter(p => p[2] !== null);
  return {
    min: fl.length ? Math.min(...fl.map(p => p[2])) : null, max: fl.length ? Math.max(...fl.map(p => p[3])) - 1 : null,
    columns: W, columnsWithFloor: profile.reduce((a, p) => a + (p[2] !== null ? p[1] - p[0] : 0), 0), seededColumns: seeded.reduce((a, v) => a + v, 0),
    profile, floorRuns: cols.map(({ key, ...r }) => r),
    stableAt: (X, h) => { const k = X - X0; if (k < 0 || k >= W) return null; const c = chosen[k]; return c ? (h >= c.h0 && h < c.h1) : null; },
  };
}

module.exports = { T, CLASS_NAMES, params, platOf, describe, collide, stable, floorList, floorAt, e7ShaftMap, bandProfile };
