// Analysis of the live mechanics runs (work/re/runs/mech-*), for mechanics.cjs. Research tooling only.
// Every number taken from a run says which run and frames it comes from; damage values are checked against the
// decoded formulas (formula.cjs), which enumerate the game's random factors.
'use strict';
const fs = require('fs'), path = require('path');
const S = require('./static.cjs'), F = require('./formula.cjs');
const RUNS = path.resolve(__dirname, '../../../../work/re/runs');
const HERO_KEYS = ['jack', 'mustapha', 'hannah', 'mess'];
const hex = S.hex;

function hook(run) {
  const f = path.join(RUNS, run, 'hook.jsonl');
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function runOk(run) { try { return JSON.parse(fs.readFileSync(path.join(RUNS, run, 'summary.json'), 'utf8')).ok === true; } catch (e) { return false; } }
const stb = v => { v >>>= 0; return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; };
const stTxt = v => stb(v).map(b => b.toString(16).toUpperCase()).join('.');
const fx = v => +((v | 0) / 65536).toFixed(3);
const bcdNum = v => parseInt((v >>> 0).toString(16), 10);
const hist = arr => { const h = {}; for (const v of arr) h[v] = (h[v] || 0) + 1; return h; };
const mode = arr => { let best = null, n = 0; for (const [k, c] of Object.entries(hist(arr))) if (c > n) { best = k; n = c; } return best; };

// ------------------------------------------------------------------------------------------------ locomotion
function loco(heroKey) {
  const run = `mech-loco-${heroKey}`, L = hook(run);
  if (!L || !runOk(run)) return { run, error: 'run missing or failed' };
  const heroId = HERO_KEYS.indexOf(heroKey);
  const fr = L.filter(e => e.t === 'f');
  const vw = L.filter(e => e.t === 'v');
  const sets = S.speedSets().sets;
  // walking: state 2.0.0.2
  const walkPairs = {};
  for (const e of fr) { const s = stb(e.p1.st); if (s[0] === 2 && s[1] === 0 && s[2] === 0 && s[3] === 2) { const k = `${e.p1.vx},${e.p1.vd}`; walkPairs[k] = (walkPairs[k] || 0) + 1; } }
  const set0 = sets[0].per[S.HEROES[heroId]].dirs;
  const walk = Object.entries(walkPairs).map(([k, n]) => { const [vx, vd] = k.split(',').map(Number); const d = set0.find(q => Math.abs(q.vx) === Math.abs(vx) && Math.abs(q.vd) === Math.abs(vd) && Math.sign(q.vx) === Math.sign(vx) && Math.sign(q.vd) === Math.sign(vd)); return { vx, vd, vxPx: S.px(vx), vdPx: S.px(vd), frames: n, matchesSet0: d ? d.dir : null }; }).filter(w => w.frames >= 3).sort((a, b) => b.frames - a.frames);
  // running: +0x06 == 2
  const runs = []; let cur = null;
  for (const e of fr) {
    const s = stb(e.p1.st);
    if (s[2] === 2 && s[1] === 0) { if (!cur) { cur = { from: e.f, v: [] }; runs.push(cur); } cur.v.push([e.p1.vx, e.p1.vd]); cur.to = e.f; }
    else cur = null;
  }
  const set1 = sets[1].per[S.HEROES[heroId]].dirs, set2 = sets[2].per[S.HEROES[heroId]].dirs;
  const runInfo = runs.map(r => {
    const first = Math.abs(r.v[0][0]); let burst = 0; for (const [vx] of r.v) { if (Math.abs(vx) === first) burst++; else break; }
    return { from: r.from, to: r.to, frames: r.v.length, startVx: r.v[0][0], burstFrames: burst, afterBurst: r.v[burst] ? r.v[burst] : null, distinct: Object.keys(hist(r.v.map(v => v.join(',')))) };
  });
  // jumps: +0x06 == 4 segments
  const jumps = []; cur = null;
  for (let i = 0; i < fr.length; i++) {
    const e = fr[i], s = stb(e.p1.st);
    if (s[2] === 4 && s[1] === 0) { if (!cur) { cur = { from: e.f, frames: [] }; jumps.push(cur); } cur.frames.push(e); }
    else cur = null;
  }
  const PLAN = [[575, 600, 'standing jump'], [645, 680, 'forward jump'], [715, 740, 'backward jump (stick reversed < 3 frames)'], [800, 860, 'running jump']];
  const jumpInfo = jumps.map(j => {
    const f0 = j.frames[0], label = (PLAN.find(([a, b]) => j.from >= a && j.from <= b) || [0, 0, 'jump'])[2];
    const sets16 = vw.filter(v => v.o === 0x16 && v.f >= j.from - 1 && v.f <= j.from && v.d !== 0);
    const sets14 = vw.filter(v => v.o === 0x14 && v.f >= j.from - 1 && v.f <= j.from);
    const sets1a = vw.filter(v => v.o === 0x1A && v.f >= j.from - 1 && v.f <= j.from);
    const sets1c = vw.filter(v => v.o === 0x1C && v.f >= j.from - 1 && v.f <= j.from && v.d !== 0);
    const hs = j.frames.map(e => fx(e.p1.h)), apex = Math.max(...hs), air = hs.filter(h => h > 0).length;
    const landIdx = hs.findIndex((h, k) => k > 0 && h === 0);
    const facing = f0.p1.f24 ? 1 : -1;
    // initial values: the setter's write when the tap caught one (the integrator at 0x18BC / 0x18A6 is not a setter),
    // else the first logged frame minus one acceleration step
    const PHYS = new Set([0x18BC, 0x18A6]);
    const sv = arr => { const x = arr.find(v => !PHYS.has(v.pc)); return x ? (x.d << 16) >> 16 : null; };
    const vh0 = sv(sets16) != null ? sv(sets16) : (f0.p1.vh - f0.p1.ah), vx0 = sv(sets14) != null ? sv(sets14) : f0.p1.vx - f0.p1.ax;
    return {
      label, from: j.from, state: stTxt(f0.p1.st), vh0, vh0Px: S.px(vh0), gravity: f0.p1.ah, gravityPx: S.px(f0.p1.ah), vx0, vx0Px: S.px(vx0) * facing, ax: f0.p1.ax, axPx: S.px(f0.p1.ax) * facing,
      vd: f0.p1.vd, apexPx: apex, airborneFrames: air, landingFrames: landIdx >= 0 ? j.frames.length - landIdx : null, totalFrames: j.frames.length,
      xTravelPx: +(fx(j.frames[j.frames.length - 1].p1.x) - fx(f0.p1.x) + S.px(vx0) * 0).toFixed(2),
      setters: { vh: sets16.map(v => ({ pc: hex(v.pc), value: v.d })), vx: sets14.map(v => ({ pc: hex(v.pc), value: (v.d << 16) >> 16 })), ax: sets1a.map(v => ({ pc: hex(v.pc), value: (v.d << 16) >> 16 })), g: sets1c.map(v => ({ pc: hex(v.pc), value: (v.d << 16) >> 16 })) },
    };
  });
  // dash attack (+0x07 == 0x10) and mega crash (+0x07 == 0x0E)
  const segs = (pred) => { const out = []; let c = null; for (const e of fr) { if (pred(stb(e.p1.st))) { if (!c) { c = { from: e.f, frames: [] }; out.push(c); } c.frames.push(e); } else c = null; } return out; };
  const dash = segs(s => s[1] === 0 && s[2] === 0 && s[3] === 0x10).map(d => {
    const f0 = d.frames[0]; return { from: d.from, frames: d.frames.length, vx0: f0.p1.vx - f0.p1.ax, vx0Px: S.px(Math.abs(f0.p1.vx - f0.p1.ax)), decel: f0.p1.ax, decelPx: S.px(Math.abs(f0.p1.ax)), attackIds: [...new Set(d.frames.map(e => e.p1.at))], distancePx: +Math.abs(fx(d.frames[d.frames.length - 1].p1.x) - fx(f0.p1.x)).toFixed(1) };
  });
  const hpEv = L.filter(e => e.t === 'hp' && e.tag === 'p1');
  const mega = segs(s => s[1] === 0 && s[3] === 0x0E).map(m => {
    const cost = hpEv.filter(e => e.f >= m.from && e.f <= m.from + m.frames.length && e.pc === 0x10B1E).map(e => ({ f: e.f, cost: e.old - e.new, budgetBefore: e.a2ee }));
    const pools = m.frames.map(e => e.nB != null ? e.nB : null);
    const frozen = m.frames.filter(e => e.p1.hs > 0).length;
    return { from: m.from, frames: m.frames.length, hitStopFrames: frozen, framesWithoutHitStop: m.frames.length - frozen, hpCostEvents: cost, poolBObjectsDuring: pools.length ? [Math.min(...pools), Math.max(...pools)] : null, eeAfter: m.frames[m.frames.length - 1].p1.ee };
  });
  // all distinct velocity/acceleration writes (code sites)
  const sites = {};
  for (const v of vw) { const k = `${hex(v.pc)}`; (sites[k] = sites[k] || { pc: hex(v.pc), field: hex(v.o), values: new Set(), states: new Set() }); sites[k].values.add((v.d << 16) >> 16); sites[k].states.add(stTxt(v.st)); }
  const siteList = Object.values(sites).map(s => ({ pc: s.pc, field: s.field, values: [...s.values].slice(0, 12), states: [...s.states].slice(0, 6) }));
  return { run, hero: S.HEROES[heroId], walk, run_: runInfo, jumps: jumpInfo, dashAttack: dash, megaCrash: mega, velocityWriteSites: siteList };
}

// ------------------------------------------------------------------------------------------------ hit prediction
// HP writes that are hits (the subtracting instruction of each hit routine); the other writes to +0x6C are the clamp
// to 0 after a negative result (0x10A66, 0x1257A, 0x110E6, 0x123EC), spawn init (0x3144A), time over (0x1047C) etc.
const HIT_PCS = { 0x10A5E: 'melee 0x10A34', 0x1256A: 'grab 0x12540', 0x110DE: 'weapon object 0x110A0', 0x11912: 'thrown/flying body 0x118D2',
  0x1227A: 'Cadillac ram 0x12236', 0x123E4: 'Cadillac vs bike 0x12342', 0x116D2: 'enemy attack 0x116B2', 0x111D6: 'fixed-damage weapon id 0x6C/0x6E 0x111C6' };
function isHit(e) { return HIT_PCS[e.pc] !== undefined && e.new < e.old; }
function dedupe(L) { const seen = new Set(); return L.filter(e => { if (e.t !== 'hp') return true; const k = [e.f, e.tag, e.pc, e.old, e.new].join(','); if (seen.has(k)) return false; seen.add(k); return true; }); }
function predictHit(e, { p1c6 = 32 } = {}) {
  if (e.pc === 0x11912 || e.pc === 0x1227A || e.pc === 0x123E4) { const rec = F.enemyRecord(e.pc === 0x11912 ? 0x11 : e.a2at); return { path: HIT_PCS[e.pc], record: rec, flags: ['fixed: b0 of enemy record ' + (e.pc === 0x11912 ? '0x11' : e.a2at) + ', no modifier'], values: [rec[0]], explained: rec[0] === e.d1 }; }
  const common = { victimR84: e.vr84, rank: e.rank, victimHp: e.old, victimB2e: e.vb2e, victimAttackId: e.vat, attackId: e.a2at };
  let pr, path;
  if (e.pc === 0x10A5E || e.pc === 0x1256A || e.pc === 0x11BD0) { path = e.pc === 0x1256A ? 'grab 0x12540' : 'melee 0x10A34'; pr = F.heroHit({ heroId: e.a2id, power: e.a2c6, ...common }); }
  else if (e.pc === 0x110DE) { path = 'weapon object 0x110A0'; pr = F.weaponHit({ heroId: e.a2pl >= 0 ? e.a2id : 0, power: p1c6, ownerPlayer: e.a2pl, ...common }); }
  else return { path: HIT_PCS[e.pc] || `other (pc ${hex(e.pc)})`, values: null, explained: null };
  const dmg = Math.min(e.d1, e.old);
  return { path, record: pr.record, flags: pr.flags, values: pr.values, explained: pr.values.includes(e.d1) || pr.values.includes(dmg) };
}

// ------------------------------------------------------------------------------------------------ moves
function moves(heroKey, run = `mech-moves-${heroKey}`) {
  const L0 = hook(run), L = L0 ? dedupe(L0) : null;
  if (!L || !runOk(run)) return { run, error: 'run missing or failed' };
  const heroId = HERO_KEYS.indexOf(heroKey);
  const fr = new Map(L.filter(e => e.t === 'f').map(e => [e.f, e]));
  const out = []; let mv = null;
  for (const e of L) {
    if (e.t === 'move') { mv = { move: e.n, rep: e.rep, from: e.f, to: null, attackIds: new Set(), hits: [], heroCost: [] }; out.push(mv); continue; }
    if (e.t === 'moveend') { if (mv) mv.to = e.f; mv = null; continue; }
    if (!mv) continue;
    if (e.t === 'f' && e.p1.b2e) mv.attackIds.add(e.p1.at);
    if (e.t === 'hp' && e.tag === 'tg' && isHit(e)) {
      const p = predictHit(e);
      // hit-stop: frames from the hit with the attacker's +0x59 > 0 (P1) / the victim's
      let hsA = 0, hsV = 0; for (let k = e.f; k < e.f + 40; k++) { const q = fr.get(k); if (!q) break; if (q.p1.hs > 0) hsA++; else if (k > e.f) break; }
      for (let k = e.f; k < e.f + 40; k++) { const q = fr.get(k); if (!q || !q.tg) break; if (q.tg.hs > 0) hsV++; else if (k > e.f) break; }
      const after = fr.get(e.f), before = fr.get(e.f - 1);
      const scoreDelta = after && before ? bcdNum(after.p1.sc) - bcdNum(before.p1.sc) : null;
      mv.hits.push({ f: e.f, pc: hex(e.pc), attacker: e.a2 === 0xFFB274 ? 'P1' : hex(e.a2), attackerType: e.a2ty, attackId: e.a2at, attackerState: stTxt(e.a2st), damage: e.d1, hpBefore: e.old, rank: e.rank, power: e.a2c6,
        predicted: p.values, explained: p.explained, path: p.path, flags: p.flags, record: p.record,
        hitStop: { recordB3: p.record ? p.record[3] : null, attackerFrozenFrames: hsA, victimFrozenFrames: hsV },
        stun: { before: e.vstun, recordB1: p.record ? p.record[1] : null, after: after && after.tg ? after.tg.stun : null },
        victimStateAfter: after && after.tg ? stTxt(after.tg.st) : null, scoreDelta });
    }
    if (e.t === 'hp' && e.tag === 'p1' && e.pc === 0x10B1E) mv.heroCost.push({ f: e.f, cost: e.old - e.new, budget: e.a2ee });
  }
  for (const m of out) m.attackIds = [...m.attackIds];
  return { run, hero: S.HEROES[heroId], moves: out };
}

// ------------------------------------------------------------------------------------------------ weapons
function weapon(run) {
  const L0 = hook(run), L = L0 ? dedupe(L0) : null;
  if (!L || !runOk(run)) return { run, error: 'run missing or failed' };
  const hits = L.filter(e => e.t === 'hp' && e.tag === 'tg' && isHit(e)).map(e => {
    const p = predictHit(e);
    return { f: e.f, pc: hex(e.pc), objType: hex(e.a2ty), objSub: hex(e.a2sub), objClass: hex(e.a2cls & 0xFFFF), heroId: e.a2id, ownerPlayer: e.a2pl, attackId: e.a2at, damage: e.d1, hpBefore: e.old, rank: e.rank, predicted: p.values, explained: p.explained, path: p.path, flags: p.flags, record: p.record };
  });
  const shots = L.filter(e => e.t === 'shot').map(e => e.ammo);
  return { run, hits, ammoAtEachPress: shots };
}

// ------------------------------------------------------------------------------------------------ items
function items(run = 'mech-items-jack') {
  const L = hook(run);
  if (!L || !runOk(run)) return { run, error: 'run missing or failed' };
  const fr = L.filter(e => e.t === 'f');
  const ev = L.filter(e => e.t === 'item');
  return { run, items: ev.map((it, i) => {
    const end = i + 1 < ev.length ? ev[i + 1].f - 1 : it.f + 69;
    const a = fr.find(e => e.f === it.f), b = fr.find(e => e.f === end);
    const heal = L.filter(e => e.t === 'hp' && e.f > it.f && e.f <= end && e.new > e.old);
    return { kind: it.kind, entry: it.e, subtype: it.sub, f: it.f, hpBefore: a ? a.p1.hp : it.hp, hpAfter: b ? b.p1.hp : null, healPc: heal.length ? hex(heal[0].pc) : null,
      scoreBefore: a ? bcdNum(a.p1.sc) : null, scoreAfter: b ? bcdNum(b.p1.sc) : null, scoreDelta: a && b ? bcdNum(b.p1.sc) - bcdNum(a.p1.sc) : null };
  }) };
}

// ------------------------------------------------------------------------------------------------ hurt / lives / i-frames
function hurt(run = 'mech-hurt-jack') {
  const L = hook(run);
  if (!L || !runOk(run)) return { run, error: 'run missing or failed' };
  const fr = L.filter(e => e.t === 'f'), byF = new Map(fr.map(e => [e.f, e]));
  const hits = dedupe(L).filter(e => e.t === 'hp' && e.tag === 'p1' && isHit(e)).map(e => {
    let pred = null;
    if (e.pc === 0x116D2 || e.pc === 0x116D6) { const p = F.enemyHit({ attackId: e.a2at, attackerR84: e.a2r84, rank: e.rank, heroId: 0, heroHp: e.old }); pred = p.values; }
    const after = byF.get(e.f);
    return { f: e.f, pc: hex(e.pc), attackerType: hex(e.a2ty || 0), attackId: e.a2at, attackerR84: hex(e.a2r84 || 0), damage: e.old - e.new, hpBefore: e.old, rank: e.rank, predicted: pred, explained: pred ? pred.includes(e.old - e.new) : null,
      stunBefore: e.vstun, stateAfter: after ? stTxt(after.p1.st) : null };
  });
  const writes = tag => L.filter(e => e.t === 'w' && e.tag === tag).map(e => ({ f: e.f, pc: hex(e.pc), o: hex(e.o), data: e.d, mask: hex(e.m), stateAtWrite: byF.get(e.f - 1) ? stTxt(byF.get(e.f - 1).p1.st) : null }));
  // state segments of P1 (+0x04..+0x07) with HP, i-frame timers and the stun meter
  const segs = []; let c = null;
  for (const e of fr) { const k = stTxt(e.p1.st) + ' s0=' + e.p1.s0; if (!c || c.key !== k) { c = { key: k, from: e.f, to: e.f, hp: e.p1.hp, ec: e.p1.ec, f9: e.p1.f9, stun: e.p1.stun, lives: e.p1.lives }; segs.push(c); } else c.to = e.f; }
  return { run, hits, timers: { ec: writes('ec'), f9: writes('f9') }, stunWrites: writes('stun'), livesWrites: writes('lives'), stateSegments: segs };
}

// ------------------------------------------------------------------------------------------------ timer
// TAPW logs every write to the 2-byte clock with its mask: the tick (0x103EA / 0x103EE) and the add routine
// (0x104D8 / 0x104DC) write single bytes (the data word carries the byte replicated), 0x1032C / 0xFD9C write the word.
function timerWrite(e) {
  const m = e.m & 0xFFFF, d = e.d & 0xFFFF;
  const byte = (m & 0xFF00) && (m & 0xFF) ? 'word' : (m & 0xFF00) ? 'minutes' : 'seconds';
  const value = byte === 'word' ? d : byte === 'minutes' ? (d >> 8) & 0xFF : d & 0xFF;
  return { f: e.f, pc: hex(e.pc), byte, value: hex(value, byte === 'word' ? 4 : 2) };
}
function timerRuns(states) {
  return states.map(st => {
    const run = `mech-timer-${st}`, L = hook(run);
    if (!L || !runOk(run)) return { state: st, error: 'run missing or failed' };
    const fr = L.filter(e => e.t === 'f');
    const w = L.filter(e => e.t === 'w' && e.tag === 'timer').map(timerWrite);
    const dec = w.filter(x => x.pc !== hex(0x1032C) && x.byte === 'minutes');   // one tick = a minutes write then a seconds write
    const gaps = []; for (let i = 1; i < dec.length; i++) gaps.push(dec[i].f - dec[i - 1].f);
    return { state: st, stage: fr[0] && fr[0].g.st + 1, area: fr[0] && fr[0].g.ar, timerAtLoad: fr[0] && hex(fr[0].g.tm, 4), tick: fr[0] && fr[0].g.tk, writes: w, framesPerSecond: gaps.length ? mode(gaps) : null, gaps };
  });
}

// ------------------------------------------------------------------------------------------------ timer scripts (set / add by the stage scripts)
function timerScript(run) {
  const L = hook(run);
  if (!L || !runOk(run)) return { run, error: 'run missing or failed' };
  const g = L.filter(e => e.t === 'g');
  const w = L.filter(e => e.t === 'tmw' && e.pc !== 0x103EA && e.pc !== 0x103EE).map(e => ({ f: e.f, pc: hex(e.pc), byte: e.byte, value: hex(e.val, e.byte === 'word' ? 4 : 2), before: hex(e.old, 4), cameraX: e.cx, area: e.ar, liveEnemies: e.n, eventObjects: e.ev }));
  const first = g[0];
  return { run, stage: first && first.g.st + 1, areaAtStart: first && first.g.ar, timerAtStart: first && hex(first.g.tm, 4), writes: w, lastFrame: g.length ? g[g.length - 1].f : null, cameraXReached: g.length ? Math.max(...g.map(e => e.g.cx)) : null, areasSeen: sortNum(g.map(e => e.g.ar)) };
}
const sortNum = a => [...new Set(a)].sort((x, y) => x - y);

function timerRespawn(run = 'mech-timer-respawn') {
  const L = hook(run);
  if (!L || !runOk(run)) return { run, error: 'run missing or failed' };
  const w = L.filter(e => e.t === 'tmw').map(e => ({ f: e.f, pc: hex(e.pc), byte: e.byte, value: hex(e.val, e.byte === 'word' ? 4 : 2), before: hex(e.old, 4), mainState: e.ms, lives: e.lives, state: stTxt(e.st) }));
  const cont = L.find(e => e.t === 'contstart');
  const fr = L.filter(e => e.t === 'f');
  const segs = []; let c = null;
  for (const e of fr) { const k = stTxt(e.p1.st) + ' s0=' + e.p1.s0 + ' ms=' + e.g.ms; if (!c || c.key !== k) { c = { key: k, from: e.f, to: e.f, hp: e.p1.hp, lives: e.p1.lives, timer: hex(e.g.tm, 4) }; segs.push(c); } else { c.to = e.f; c.timerEnd = hex(e.g.tm, 4); } }
  return { run, writes: w, continueScreenAt: cont ? cont.f : null, stateSegments: segs };
}

// ------------------------------------------------------------------------------------------------ run rules
function runRelease(heroKey) {
  const run = `mech-run-${heroKey}`, L = hook(run);
  if (!L || !runOk(run)) return { run, error: 'run missing or failed' };
  const fr = L.filter(e => e.t === 'f');
  // segments of (state, input)
  const segs = []; let c = null;
  for (const e of fr) {
    const k = stTxt(e.p1.st) + '|' + e.p1.in;
    if (!c || c.key !== k) { c = { key: k, state: stTxt(e.p1.st), input: e.p1.in, from: e.f, to: e.f, vx: e.p1.vx, vd: e.p1.vd, stick: e.stick, prevStick: e.prevStick, x0: fx(e.p1.x) }; segs.push(c); }
    else { c.to = e.f; c.vxEnd = e.p1.vx; c.vdEnd = e.p1.vd; c.stickEnd = e.stick; c.x1 = fx(e.p1.x); }
  }
  const running = s => s.state.startsWith('2.0.2.');
  const INPUT = v => ['none', 'R', 'L', 'RL', 'D', 'RD', 'LD', '', 'U', 'RU', 'LU', '', '', '', '', ''][v & 0xF] + (v & 0x10 ? '+attack' : '') + (v & 0x20 ? '+jump' : '');
  const events = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!running(s)) continue;
    const prev = segs[i - 1], next = segs[i + 1];
    // a run segment with no input that follows a run segment with input: persistence
    if (s.input === 0 && prev && running(prev) && prev.input !== 0) {
      const lastF = fr.find(e => e.f === s.to) || {};
      const why = next ? (next.input ? INPUT(next.input) + ' -> ' + next.state : (lastF.dd ? 'scripted stop: 0xFF84DD set at the wave point (0x1A09E) -> ' + next.state : lastF.fa <= 1 ? '240-frame limit (+0xFA) -> ' + next.state : 'state ' + next.state)) : 'end of run';
      events.push({ kind: 'run persists after release', from: s.from, to: s.to, frames: s.to - s.from + 1, vx: s.vx, vd: s.vd, stick: s.stick, faAtEnd: lastF.fa, ddAtEnd: lastF.dd, endedBy: why });
    }
    // a run segment that ends with a new input: what the next state was
    if (next && !running(next) && next.input !== 0) events.push({ kind: 'input while running', input: INPUT(next.input), stickBefore: s.stickEnd != null ? s.stickEnd : s.stick, stateAfter: next.state, at: next.from, vxAfter: next.vx, vdAfter: next.vd, note: next.state.startsWith('2.0.0.2') ? 'walk' : next.state.startsWith('2.0.0.10') || next.state.startsWith('2.0.4.12') ? 'dash attack' : next.state.startsWith('2.0.4.8') ? 'running jump' : next.state === '2.0.0.0' ? 'idle' : '' });
    if (next && running(next) && next.input !== 0 && next.input !== s.input) events.push({ kind: 'steer while running', input: INPUT(next.input), stickBefore: s.stickEnd != null ? s.stickEnd : s.stick, stickAfter: next.stick, vx: next.vx, vd: next.vd, at: next.from });
  }
  // the long final run: where did it stop (camera / area limit)?
  const last = [...segs].reverse().find(s => running(s));
  const tail = last ? { from: last.from, to: last.to, frames: last.to - last.from + 1, xFrom: last.x0, xTo: last.x1, vxEnd: last.vxEnd, stateAfter: (segs[segs.indexOf(last) + 1] || {}).state || null, camXEnd: (fr.find(e => e.f === last.to) || { g: {} }).g.cx } : null;
  // double-tap window: taps at 1240 (2 f), release, second tap at 1260 (gap 18 frames from the first press)
  const dt = fr.find(e => e.f >= 1260 && e.f <= 1300 && stTxt(e.p1.st).startsWith('2.0.2.'));
  return { run, hero: S.HEROES[HERO_KEYS.indexOf(heroKey)], events, longRun: tail, doubleTapGap18Frames: dt ? `run started at f${dt.f}` : 'no run (gap of 18 frames between the presses is too long)', segments: segs.filter(s => running(s) || s.input).slice(0, 80) };
}

// the 240-frame run limit: double-tap left into the screen edge, nothing else pressed
function runLimit(heroKey) {
  const run = `mech-runlimit-${heroKey}`, L = hook(run);
  if (!L || !runOk(run)) return { run, error: 'run missing or failed' };
  const fr = L.filter(e => e.t === 'f');
  const first = fr.find(e => stTxt(e.p1.st).startsWith('2.0.2.'));
  if (!first) return { run, error: 'no run started' };
  let last = first; for (const e of fr) if (e.f >= first.f && stTxt(e.p1.st).startsWith('2.0.2.')) last = e; else if (e.f > last.f + 1 && last.f >= first.f) break;
  const after = fr.find(e => e.f === last.f + 1);
  const xEnd = (last.p1.x / 65536) | 0;
  const stuck = fr.filter(e => e.f >= first.f && e.f <= last.f && e.p1.vx !== 0 && ((e.p1.x / 65536) | 0) === xEnd);
  return { run, hero: S.HEROES[HERO_KEYS.indexOf(heroKey)], runStart: first.f, faAtStart: first.fa, runEnd: last.f, runFrames: last.f - first.f + 1, faAtEnd: last.fa, stateAfter: after ? stTxt(after.p1.st) : null, inputAtEnd: last.p1.in, ddAtEnd: last.dd, framesStuckAtScreenEdge: stuck.length, xAtEnd: fx(last.p1.x), camXAtEnd: last.g.cx };
}

// ------------------------------------------------------------------------------------------------ knockdown rule
function knockdown(heroKey) {
  const run = `mech-knockdown-${heroKey}`, L = hook(run);
  if (!L || !runOk(run)) return { run, error: 'run missing or failed' };
  const fr = new Map(L.filter(e => e.t === 'f').map(e => [e.f, e]));
  const seen = new Set();
  const hits = [];
  for (const e of L) {
    if (e.t !== 'kd') continue;
    const k = [e.f, e.pc, e.old, e.new].join(','); if (seen.has(k)) continue; seen.add(k);
    if (e.pc !== 0x116D2) continue;    // enemy -> hero hits only (the other PCs are special paths)
    // the hit frame shows state 2.2.<reaction byte>.0 (0x1170A: record byte 2 -> +0x06 / +0x7B); the reaction entry
    // (0x1C062 for byte 0, 0x1C124 for byte 2, the heavy path for byte 4) runs on the next frame: +0x06 becomes 4 or 6
    // for a knockdown, and +0x07 = 2 with +0x06 unchanged (0 or 2) for a flinch
    let reaction = null, b06 = null, r7b = null, reactionByte = null;
    { const f0 = fr.get(e.f); if (f0) reactionByte = stb(f0.p1.st)[2]; }
    for (let q = e.f + 1; q <= e.f + 3; q++) { const f = fr.get(q); if (!f) continue; const s = stb(f.p1.st); if (s[1] === 2) { reaction = s[2] >= 4 ? 'knockdown' : 'flinch'; b06 = s[2]; r7b = f.r7b; break; } }
    const rec = F.enemyRecord(e.aat);
    const stunAfter = e.stun - rec[1];
    const predicted = (e.new === 0 || stunAfter <= 0 || e.a5a !== 0 || e.h51 !== 0) ? 'knockdown' : 'flinch';
    hits.push({ f: e.f, attackerType: hex(e.aty), attackerName: S.nameOf(e.aid) || null, attackId: e.aat, attackerFlag5a: e.a5a, heroAirborne51: e.h51, hero5aBefore: e.h5a, hpBefore: e.old, hpAfter: e.new, stunBefore: e.stun, recordStun: rec[1], recordReaction: rec[2], reactionByteAtHit: reactionByte, stunAfterPredicted: Math.max(0, stunAfter), heightAtHit: e.h, reaction, b06, r7b, predicted, ok: reaction === predicted });
  }
  const tally = { total: hits.filter(h => h.reaction).length, ok: hits.filter(h => h.ok).length, knockdowns: hits.filter(h => h.reaction === 'knockdown').length, byCause: {}, flinchKinds: {} };
  for (const h of hits.filter(h => h.reaction === 'knockdown')) { const cause = h.hpAfter === 0 ? 'HP 0' : h.attackerFlag5a ? 'attack flag +0x5A' : h.heroAirborne51 ? 'airborne +0x51' : h.stunAfterPredicted <= 0 ? (h.recordStun >= 10 ? 'stun meter 0 (heavy attack: stun byte >= 10)' : 'stun meter 0') : 'unexplained'; tally.byCause[cause] = (tally.byCause[cause] || 0) + 1; }
  for (const h of hits.filter(h => h.reaction)) { const k = `reaction byte ${h.reactionByteAtHit} -> ${h.reaction} (+0x06 = ${h.b06})`; tally.flinchKinds[k] = (tally.flinchKinds[k] || 0) + 1; }
  const flagsByAttack = {}; for (const h of hits) { const k = `${h.attackerName || h.attackerType} id ${h.attackId}`; (flagsByAttack[k] = flagsByAttack[k] || new Set()).add(h.attackerFlag5a); }
  return { run, hero: S.HEROES[HERO_KEYS.indexOf(heroKey)], tally, flagByAttack: Object.fromEntries(Object.entries(flagsByAttack).map(([k, v]) => [k, [...v]])), hits };
}

module.exports = { HIT_PCS, isHit, dedupe, hook, runOk, stb, stTxt, fx, bcdNum, loco, moves, weapon, items, hurt, timerRuns, timerWrite, timerScript, timerRespawn, runRelease, runLimit, knockdown, predictHit, HERO_KEYS };
