// Firing / throwing analysis over the armed runs: every object born in pool A (items, shots) or pool D (effects)
// while the hero fires, with its spawn point relative to the hero's feet and to the weapon, velocities, lifetime and
// the records it draws; plus fire timing (frames between shots), ammo use and the hero's push-back.
'use strict';
const R = require('../../rom.cjs');
const L = require('./live.cjs');
const V = require('./validate.cjs');

const POOLS = { A: { base: 0xFF8874, n: 24, stride: 0xC0 }, D: { base: 0xFF9A74, n: 48, stride: 0x80 } };
const hexs = n => '0x' + (n >>> 0).toString(16).toUpperCase();
function recsAt(fp) {
  if (!fp || fp + 4 > R.prg.length) return null;
  const w0 = R.prg.readUInt16BE(fp), w1 = R.prg.readUInt16BE(fp + 2);
  if (w0 & 0x8000) return { composite: true, hitRec: (w0 & 0x7FFF) >> 2 };
  return { rec: w0 >> 2, rec2: (w1 & 0x8000) ? null : w1 >> 2 };
}

function analyseRun(run) {
  const frames = L.readRun(run);
  const objs = [];                 // tracked objects
  const live = new Map();          // slot -> current track
  const hero = [];                 // per-frame hero summary
  for (const fr of frames) {
    if (!fr.mem) continue;
    const m = L.mem(fr), st = V.stateAt(fr);
    const ammo = st.weapon ? m.sw(st.weapon.addr + 0x6C) : null;
    hero.push({ f: fr.f, x: st.x, h: st.h, d: st.d, face: st.face, state: st.state, cls: st.cls, weapon: st.weapon ? { addr: st.weapon.addr, x: st.weapon.x, h: st.weapon.h, slot: st.weapon.slot } : null, ammo, fp: st.fp, f2f: m.b(L.P1 + 0x2F) });
    for (const [pk, P] of Object.entries(POOLS)) for (let k = 0; k < P.n; k++) {
      const a = P.base + k * P.stride;
      const act = m.b(a), type = m.w(a + 0x20);
      const key = pk + k;
      let t = live.get(key);
      const isHeld = st.weapon && st.weapon.addr === a;
      if (!act) { if (t) { t.died = fr.f; live.delete(key); } continue; }
      if (t && t.type !== hexs(type)) { t.died = fr.f; live.delete(key); t = null; }
      if (!t) {
        t = { pool: pk, slot: hexs(a), type: hexs(type), sub: hexs(m.w(a + 0x26)), born: fr.f, died: null, held0: isHeld, path: [] };
        live.set(key, t); objs.push(t);
      }
      const fp = m.l(a + 0x28);
      t.path.push({ f: fr.f, x: m.sw(a + 8), h: m.sw(a + 0xC), d: m.sw(a + 0x10), vx: m.sw(a + 0x14), vh: m.sw(a + 0x16), ah: m.sw(a + 0x1C), face: m.b(a + 0x24), st: [4, 5, 6].map(o => m.b(a + o).toString(16)).join('.'), set: hexs(m.l(a + 0x40)), fp: hexs(fp), recs: recsAt(fp), held: !!isHeld, cls: m.w(a + 0xA0) });
    }
  }
  return { run, hero, objs };
}

// summarise one armed run: shots (ammo decrements), their timing, spawned objects relative to hero/weapon
function summarise(run) {
  const { hero, objs } = analyseRun(run);
  const byF = new Map(hero.map(h => [h.f, h]));
  const shots = [];
  for (let i = 1; i < hero.length; i++) {
    const a = hero[i - 1], b = hero[i];
    const fireState = ['16', '1c', '22'].includes(b.state.split('.')[3]) && b.state.startsWith('2.0.0');
    if (a.ammo != null && b.ammo != null && b.ammo < a.ammo && a.weapon && b.weapon && a.weapon.addr === b.weapon.addr) shots.push({ f: b.f, ammo: b.ammo, state: b.state, face: b.face, heroX: b.x, heroH: b.h, weaponX: b.weapon.x, weaponH: b.weapon.h, fireState });
    else if (a.weapon && !b.weapon && a.ammo != null) shots.push({ f: b.f, released: true, state: b.state, face: a.face, heroX: a.x, heroH: a.h, weaponX: a.weapon.x, weaponH: a.weapon.h, lastAmmo: a.ammo });
  }
  // objects born at or after a shot (within 3 frames), excluding the initial pool contents
  const out = [];
  for (const o of objs) {
    if (o.born === 0) continue;
    const s = shots.filter(x => o.born >= x.f - 1 && o.born <= x.f + 150).pop();
    const h = byF.get(o.born) || byF.get(o.born - 1); if (!h) continue;
    const p0 = o.path[0], dir = h.face ? 1 : -1;
    const life = (o.died != null ? o.died : o.path[o.path.length - 1].f + 1) - o.born;
    const recs = []; for (const p of o.path) { const r = p.recs ? (p.recs.rec != null ? p.recs.rec + (p.recs.rec2 != null ? '+' + p.recs.rec2 : '') : 'C' + p.recs.hitRec) : '-'; if (!recs.length || recs[recs.length - 1].r !== r) recs.push({ r, from: p.f - o.born, n: 1 }); else recs[recs.length - 1].n++; }
    const p1 = o.path[Math.min(4, o.path.length - 1)];
    // per-frame x steps along the whole path (signed by the shooter's facing); the mode is the flight speed of
    // objects that hit nothing, the last step of a bullet that hits something is short
    const steps = []; for (let i = 1; i < o.path.length; i++) if (o.path[i].f === o.path[i - 1].f + 1) steps.push((o.path[i].x - o.path[i - 1].x) * dir);
    const sm = new Map(); for (const v of steps) sm.set(v, (sm.get(v) || 0) + 1); let stepMode = null, sn = 0; for (const [v, c] of sm) if (c > sn) { sn = c; stepMode = v; }
    out.push({
      pool: o.pool, slot: o.slot, type: o.type, sub: o.sub, born: o.born, life, diedAt: o.died, shotAt: s ? s.f : null, delay: s ? o.born - s.f : null,
      fromFeet: [(p0.x - h.x) * dir, p0.h - h.h], fromWeapon: s ? [(p0.x - s.weaponX) * dir, p0.h - s.weaponH] : null, depthDelta: p0.d - h.d,
      v0: { vx: p0.vx * dir / 256, vh: p0.vh / 256, ah: p0.ah / 256 }, meanVx: o.path.length > 1 ? (p1.x - p0.x) * dir / Math.max(1, p1.f - p0.f) : null,
      travel: [(o.path[o.path.length - 1].x - p0.x) * dir, o.path[o.path.length - 1].h - p0.h], stepMode, steps: steps.length, set: p0.set, lastSt: o.path[o.path.length - 1].st, state0: p0.st, records: recs.slice(0, 24), held: o.held0,
    });
  }
  // (thrown is computed below; spawned objects get fromThrown afterwards)
  // the held weapon after it leaves the hand (thrown knife/stick/dynamite/grenade/stone, discarded empty guns)
  const thrown = [];
  for (const o of objs) {
    const k = o.path.findIndex((p, i) => i > 0 && o.path[i - 1].held && !p.held);
    if (k < 0) continue;
    const p0 = o.path[k - 1], h = byF.get(p0.f), dir = h && h.face ? 1 : -1, seg = o.path.slice(k);
    const land = seg.findIndex((p, i) => i > 0 && p.h <= 0 && seg[i - 1].h > 0);
    thrown.push({ slot: o.slot, releasedAt: seg[0].f, fromFeet: h ? [(seg[0].x - h.x) * dir, seg[0].h - h.h] : null, v0: { vx: seg[0].vx * dir / 256, vh: seg[0].vh / 256, ax: null, gravity: seg[0].ah / 256 },
      states: [...new Set(seg.map(p => p.st))].slice(0, 6), airFrames: land > 0 ? land : null, landAt: land > 0 ? [(seg[land].x - seg[0].x) * dir, seg[land].h] : null,
      path: seg.slice(0, 60).map(p => [(p.x - seg[0].x) * dir, p.h]), abs: seg.map(p => ({ f: p.f, x: p.x, h: p.h, d: p.d })), dir, records: [...new Set(seg.slice(0, 60).map(p => p.recs ? (p.recs.rec != null ? p.recs.rec : 'C' + p.recs.hitRec) : '-'))].slice(0, 12), gone: o.died });
  }
  // fire timing: frames between accepted shots, hero x change across each shot window (push-back)
  const accepted = shots.filter(s => !s.released);
  for (let i = 0; i < accepted.length; i++) {
    const s = accepted[i], h0 = byF.get(s.f - 1), h12 = byF.get(s.f + 12);
    if (i) s.sincePrev = s.f - accepted[i - 1].f;
    if (h0 && h12) s.pushBack = (h12.x - h0.x) * (h0.face ? 1 : -1);
    // how long the hero stays in the fire state
    let k = s.f; while (byF.get(k + 1) && byF.get(k + 1).state === s.state) k++; s.fireStateFrames = k - s.f + 1;
  }
  for (const o of out) {
    if (o.delay == null || o.delay < 4) continue;
    for (const t of thrown) {
      if (o.born < t.releasedAt) continue;
      const at = t.abs.filter(p => p.f <= o.born).pop(); if (!at) continue;
      const ob = objs.find(x => x.born === o.born && x.type === o.type && x.slot === o.slot) || null; const p0 = ob ? ob.path[0] : null; if (!p0) continue;
      o.fromThrown = [(p0.x - at.x) * t.dir, p0.h - at.h]; o.thrownSlot = t.slot;
    }
  }
  for (const t of thrown) delete t.abs;
  return { run, shots, spawned: out, thrown };
}
module.exports = { analyseRun, summarise, recsAt };
