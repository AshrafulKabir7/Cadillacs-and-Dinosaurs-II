// Reads an en-<variant> live capture (tools/re/export/enemies-live.cjs) and turns it into facts: which animation
// sets and frames the spawned enemy used, in which context, its HP/palette/speed fields, the damage its attacks did
// to P1 (write tap on P1 +0x6C), the objects it created (projectiles), and a draw-model check of its OBJ blocks.
// Research only; nothing here ships with the sequel.
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../rom.cjs');
const A = require('./enemy-anim.cjs');
const DM = require('../verify-live/drawmodel.cjs');
const LIVE = require('./enemies-live.cjs');
const RUNS = path.resolve(__dirname, '../../../work/re/runs');

const setCache = new Map();
function getSet(T) { if (!setCache.has(T)) setCache.set(T, A.decodeSet(T)); return setCache.get(T); }
function locate(T, fp) {
  if (!T || T >= R.prg.length) return null;
  const s = getSet(T);
  for (const an of s.anims) { const i = an.frames.findIndex(f => f.addr === fp); if (i >= 0) return { set: T, anim: an.index, frame: i }; }
  return null;
}
const phaseOf = (f, phases) => { for (const [a, b, m] of phases) if (f >= a && f <= b) return m; return 'idle'; };
const stBytes = st => [0, 2, 4, 6].map(i => parseInt(st.slice(i, i + 2), 16));
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function loadRun(name) {
  const f = path.join(RUNS, name, 'hook.jsonl');
  if (!fs.existsSync(f)) return null;
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { name, lines, frames: lines.filter(l => l.p1), events: lines.filter(l => !l.p1) };
}

function* objFrames(name) {
  const f = path.join(RUNS, name, 'frames.jsonl');
  if (!fs.existsSync(f)) return;
  const data = fs.readFileSync(f, 'utf8');
  let p = 0;
  while (p < data.length) { const q = data.indexOf('\n', p); const line = data.slice(p, q < 0 ? data.length : q); p = q < 0 ? data.length : q + 1; if (line) yield JSON.parse(line); }
}

// rebuild the target's OBJ entries from its RAM fields (drawmodel.cjs, V04) and look for them in the dumped list
function drawCheck(run, slotAt, frameByF, gone) {
  const res = { checked: 0, exact: 0, unmodelled: 0, empty: 0, lag: 1, misses: [] };
  for (const fr of objFrames(run.name)) {
    if (gone !== null && fr.f >= gone) break;
    if (!Array.isArray(fr.obj)) continue;   // light runs (enemies-live.cjs EXTRA) dump no OBJ lists
    const prev = frameByF.get(fr.f - res.lag); if (!prev) continue;
    const o = prev.B.find(b => b.a === slotAt(prev.f)); if (!o || !o.dr) continue;
    const st = stBytes(o.st), fb = parseInt(o.fb, 16);
    const obj = { x: o.x, h: o.h, d: o.d, face: o.f24, fp: o.fp, f25: o.f25, f23: o.p23, tdx: o.tdx, tdy: o.tdy, lp: o.lp, f53: o.f53, c4c: o.c4c, c4d: o.c4d, f05: st[1], f2e: (fb >>> 8) & 0xFF };
    let pred;
    try { pred = DM.drawObject(obj, { cx: prev.cxd, cy: prev.cyd }); } catch (e) { res.unmodelled++; continue; }
    if (pred.notes.pair || pred.notes.bit6) { res.unmodelled++; continue; }
    if (!pred.out.length) { res.empty++; continue; }
    res.checked++;
    const live = new Map();
    for (const e of fr.obj) { const k = `${e.x & 0x1FF},${e.y & 0x1FF},${e.code},${e.attr}`; live.set(k, (live.get(k) || 0) + 1); }
    let ok = true;
    for (const e of pred.out) { const k = `${e.x & 0x1FF},${e.y & 0x1FF},${e.code},${e.attr}`; if (live.get(k)) live.set(k, live.get(k) - 1); else { ok = false; break; } }
    if (ok) res.exact++;
    else {
      const dying = o.st.startsWith('04');
      const codes = new Set(pred.out.map(e => e.code)), absent = !fr.obj.some(e => codes.has(e.code));
      if (dying) res.dyingBlink = (res.dyingBlink || 0) + 1;
      else if (absent) { res.absent = (res.absent || 0) + 1; if ((res.absentFrames = res.absentFrames || []).length < 8) res.absentFrames.push(fr.f); }
      else { res.otherMiss = (res.otherMiss || 0) + 1; if (res.misses.length < 8) res.misses.push(fr.f); }
    }
  }
  return res;
}

// live palette RAM (logged every 120 frames) vs ROM palette #map[slot] (0xB7A52 + n*32), colour nibbles only
function paletteCheck(run, pals, map = Array.from({ length: 32 }, (_, k) => k)) {
  const out = {};
  const logs = run.events.filter(e => e.pal !== undefined);
  for (const p of pals) {
    let same = 0, n = 0;
    for (const l of logs) {
      let eq = true;
      for (let k = 0; k < 16; k++) {
        const live = parseInt(l.hex.substr((p * 16 + k) * 4, 4), 16), rom = R.u16(R.PAL_TABLE + map[p] * 32 + k * 2);
        if ((live & 0x0FFF) !== (rom & 0x0FFF)) { eq = false; break; }
      }
      n++; if (eq) same++;
    }
    out[p] = { romPalette: map[p], dumps: n, equal: same };
  }
  return out;
}

function analyze(name, { phases = LIVE.DEFAULT_PHASES, extraSets = [] } = {}) {
  const run = loadRun(name); if (!run) return null;
  const pre = run.events.find(e => e.pre !== undefined);   // partner object spawned first (not the target)
  const spawn = run.events.find(e => e.spawn !== undefined && !e.error && !(pre && e.slot === pre.pre && e.f <= pre.f));
  if (!spawn) return { name, error: 'no spawn' };
  // the spawned slot, or the slot the enemy re-allocated itself into (retarget events after the spawn)
  const moves = run.events.filter(e => e.retarget && e.f >= spawn.f).map(e => ({ f: e.f, slot: e.retarget }));
  const slotAt = f => { let s = spawn.slot; for (const m of moves) if (f >= m.f) s = m.slot; return s; };
  const target = moves.length ? moves[moves.length - 1].slot : spawn.slot;
  const typeChanges = run.events.filter(e => e.typechange).map(e => ({ f: e.f, from: e.from, to: e.to }));
  const gone = (run.events.find(e => e.gone) || {}).f ?? null;
  const frameByF = new Map(run.frames.map(l => [l.f, l]));
  const seen = { v03: new Set(), r84: new Set(), set: new Set(), p23: new Set(), hpm: new Set(), ty: new Set(), sub: new Set(), spd: new Set() };
  const alive = { v03: new Map(), r84: new Map(), set: new Map(), p23: new Map(), hpm: new Map(), ty: new Map(), sub: new Map() };   // value -> frames, state byte +0x04 == 2 only
  let hp0 = null;
  const unknownFp = new Map();
  const plays = []; let cur = null;
  let lvlAtSpawn = null, first = null;
  for (const l of run.frames) {
    if (gone !== null && l.f >= gone) break;
    const o = l.B.find(b => b.a === slotAt(l.f));
    if (!o) { if (cur) { plays.push(cur); cur = null; } continue; }
    if (first === null) { first = l.f; lvlAtSpawn = l.lvl; }
    if (o.st.startsWith('02')) { for (const k of Object.keys(alive)) alive[k].set(o[k], (alive[k].get(o[k]) || 0) + 1); if (hp0 === null) hp0 = o.hp; }
    seen.v03.add(o.v03); seen.r84.add(o.r84); seen.set.add(o.set); seen.p23.add(o.p23); seen.hpm.add(o.hpm); seen.ty.add(o.ty); seen.sub.add(o.sub); seen.spd.add(o.spd);
    const rs = A.reactionSets(o.r84);
    let loc = null, kind = null;
    for (const [k, T] of [['main', o.set], ['held', rs.held], ['down', rs.down], ...extraSets.map(T => ['extra', T])]) { loc = locate(T, o.fp); if (loc) { kind = k; break; } }
    if (!loc) { unknownFp.set(o.fp, (unknownFp.get(o.fp) || 0) + 1); }
    const key = loc ? `${kind}:${A.hex(loc.set)}:${loc.anim}` : `?:${A.hex(o.fp)}`;
    const st = stBytes(o.st), p1st = stBytes(l.p1.st);
    if (!cur || cur.key !== key) {
      if (cur) plays.push(cur);
      cur = { key, kind, set: loc ? loc.set : null, anim: loc ? loc.anim : null, start: l.f, end: l.f, phase: phaseOf(l.f, phases), st: o.st, p1st: l.p1.st,
        dx: o.x - l.p1.x, dd: o.d - l.p1.d, frames: [], vx: [], vd: [], xs: [], at: new Set(), ats: [], s0: new Set(), hp: [], h: [], p23: new Set(), spd: new Set() };
    }
    cur.end = l.f;
    cur.frames.push(loc ? loc.frame : -1); cur.vx.push(o.vx); cur.vd.push(o.vd); cur.xs.push([l.f, o.x, o.d, o.h]); cur.at.add(o.at); cur.ats.push(o.at); cur.s0.add(o.s0); cur.p23.add(o.p23); cur.spd.add(o.spd); cur.h.push(o.h);
  }
  if (cur) plays.push(cur);
  // damage to P1: tap writes with the attacker in A2 (0x116B2 reads attacker +0x58, record 0xA2EA4 + id*8)
  const hits = [];
  for (const e of run.events.filter(e => e.hpw && e.new < e.old)) {
    const own = e.a2 === slotAt(e.f);
    const p = plays.find(p => e.f >= p.start && e.f <= p.end);
    const l = frameByF.get(e.f);
    let loc = null;
    if (e.a2fp > 0) { loc = locate(e.a2set, e.a2fp); }
    hits.push({ f: e.f, pc: e.pc, damage: e.old - e.new, hpBefore: e.old, attacker: e.a2, attackerType: e.a2ty, attackId: e.a2at, attackerR84: e.a2r84, own, lvl: e.lvl,
      attackerAnim: loc ? { set: A.hex(loc.set), anim: loc.anim, frame: loc.frame } : null, play: p ? p.key : null, sinceStart: p ? e.f - p.start : null, p1: l ? l.p1.st : null });
  }
  // other objects present after the spawn (projectiles, effects, held weapons): first appearance per slot life
  const others = new Map(); const live = new Map();
  for (const l of run.frames) {
    if (gone !== null && l.f >= gone) break;
    const t = l.B.find(b => b.a === slotAt(l.f));
    const cur2 = new Set();
    for (const [pool, arr] of [['A', l.A], ['B', l.B], ['C', l.C], ['D', l.D]]) for (const o of arr) {
      if (pool === 'B' && o.a === slotAt(l.f)) continue;
      const id = pool + o.a + ':' + o.ty; cur2.add(id);
      if (!live.has(id)) {
        const rec = { pool, slot: o.a, type: o.ty, sub: o.sub, set: o.set, first: l.f, dxTarget: t ? o.x - t.x : null, ddTarget: t ? o.d - t.d : null, dhTarget: t ? o.h - t.h : null, targetPlay: null, fps: new Set(), sets: new Set(), p23: new Set(), owner: o.own };
        if (t) { const p = plays.find(p => l.f >= p.start && l.f <= p.end + 1); rec.targetPlay = p ? p.key : null; }
        live.set(id, rec);
        const k = `${pool}:${o.ty}`; if (!others.has(k)) others.set(k, []); others.get(k).push(rec);
      }
      // skip the first logged frame of a slot life: +0x28/+0x40 still hold the previous occupant's values before the init ran
      const rec = live.get(id); if (l.f > rec.first) { rec.fps.add(o.fp); rec.sets.add(o.set); rec.p23.add(o.p23); }
    }
    for (const id of [...live.keys()]) if (!cur2.has(id)) live.delete(id);
  }
  const draw = drawCheck(run, slotAt, frameByF, gone);
  return { name, pre: pre ? pre.pre : null, spawn, target, moves, slotAt, first, gone, typeChanges, lvlAtSpawn, seen: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v]])), alive: Object.fromEntries(Object.entries(alive).map(([k, m]) => [k, [...m.entries()].sort((a, b) => b[1] - a[1])])), hp0, plays, hits, others, unknownFp: [...unknownFp.entries()], draw, run };
}

module.exports = { analyze, loadRun, locate, getSet, paletteCheck, median, stBytes, phaseOf };
