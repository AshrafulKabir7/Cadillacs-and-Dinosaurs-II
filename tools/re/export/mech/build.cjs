// Builds work/re/extract/mechanics/{mechanics.json, MECHANICS.md} from the ROM (static.cjs) and the live runs
// (analyze.cjs). Deterministic: no timestamps, the same inputs give the same files.
'use strict';
const fs = require('fs'), path = require('path');
const S = require('./static.cjs'), A = require('./analyze.cjs'), F = require('./formula.cjs'), P = require('./plans.cjs');
const { hex, px } = S;
const HK = A.HERO_KEYS, HN = S.HEROES;
const OBS = 'OBSERVED', INF = 'INFERRED';
const sum = a => a.reduce((x, y) => x + y, 0);
const uniq = a => [...new Set(a)];
const sortNum = a => uniq(a).sort((x, y) => x - y);

function evidenceIds(OUT) { try { return JSON.parse(fs.readFileSync(path.join(OUT, 'evidence', 'evidence.json'), 'utf8')); } catch (e) { return {}; } }

// ------------------------------------------------------------------------------------------------ heroes
const MOVE_INPUTS = {
  'combo': 'attack x7, 8 frames apart, standing 34 px from the enemy', 'combo-slow': 'attack x5, 14 frames apart', 'jab': 'one attack press',
  'dash-attack': 'double-tap toward (run), attack 19 frames into the run', 'running-attack-up': 'run, then up+attack',
  'jump-kick-early': 'jump, attack 6 frames later (rising)', 'jump-kick-apex': 'jump, attack at frame 18 (apex)', 'jump-kick-falling': 'jump, attack at frame 30 (falling)',
  'jump-forward-kick': 'toward+jump, attack at frame 28', 'jump-down-attack': 'jump, down+attack at frame 26', 'jump-up-attack': 'jump, up+attack at frame 26',
  'running-jump-kick': 'run, jump 17 frames into the run, attack 12 frames later', 'mega-crash': 'attack+jump together', 'running-mega-crash': 'run, then attack+jump',
  'grab-knee3-throw': 'walk into the enemy (grab), attack x3 (knees), then toward+attack', 'grab-back-throw': 'grab, then away+attack', 'grab-forward-throw': 'grab, then toward+attack',
  'grab-knee-x6': 'grab, attack x6', 'grab-jump': 'grab, then jump, then attack', 'back-attack': 'facing away from the enemy: away+attack', 'jump-attack-while-grab-range': 'toward+jump from 26 px, attack 8 frames later',
  'combo-7f': 'attack x7, 7 frames apart, standing 40 px from the enemy (out of grab range)',
};
function heroAttacks(heroKey) {
  const runs = [A.moves(heroKey)]; if (heroKey === 'jack') runs.push(A.moves('jack', 'mech-moves-jack-hpmax')); if (heroKey === 'mess') runs.push(A.moves('mess', 'mech-moves-mess-combo7'));
  const heroId = HK.indexOf(heroKey);
  const byId = new Map(); const perMove = [];
  for (const r of runs) {
    if (r.error) continue;
    const agg = new Map();
    for (const m of r.moves) {
      const k = m.move; if (!agg.has(k)) agg.set(k, { move: k, inputs: MOVE_INPUTS[k] || null, run: r.run, attackIdsActive: new Set(), hits: [], heroCost: [] });
      const a = agg.get(k); m.attackIds.forEach(i => a.attackIdsActive.add(i)); a.hits.push(...m.hits); a.heroCost.push(...m.heroCost);
      for (const h of m.hits) {
        if (h.attacker !== 'P1' || !['melee 0x10A34', 'grab 0x12540'].includes(h.path)) continue;
        if (!byId.has(h.attackId)) byId.set(h.attackId, { attackId: h.attackId, moves: new Set(), damage: [], hitStop: [], victimHitStop: [], stun: [], score: [], explained: 0, total: 0, paths: new Set() });
        const b = byId.get(h.attackId); b.moves.add(k); b.damage.push(h.damage); b.hitStop.push(h.hitStop.attackerFrozenFrames); b.victimHitStop.push(h.hitStop.victimFrozenFrames);
        b.stun.push([h.stun.before, h.stun.after]); if (h.scoreDelta != null) b.score.push(h.scoreDelta); b.total++; if (h.explained) b.explained++; b.paths.add(h.path);
      }
    }
    for (const a of agg.values()) perMove.push({ move: a.move, inputs: a.inputs, run: a.run, attackIdsWhileActive: [...a.attackIdsActive], hits: a.hits.map(h => ({ f: h.f, attackId: h.attackId, damage: h.damage, hpBefore: h.hpBefore, predicted: h.predicted, explained: h.explained, path: h.path, flags: h.flags, hitStop: h.hitStop, stun: h.stun, score: h.scoreDelta })), heroHpCost: a.heroCost });
  }
  const recs = S.heroRecords()[HN[heroId]].records;
  const ids = [...byId.values()].sort((a, b) => a.attackId - b.attackId).map(b => {
    const rec = recs[b.attackId / 2];
    const vsChinpira = F.heroHit({ heroId, attackId: b.attackId, power: 32, victimR84: 0, rank: 10, victimHp: 100 });
    return { attackId: b.attackId, moves: [...b.moves], record: { addr: rec.addr, damage: rec.damage, stun: rec.stun, reaction: rec.reaction, hitStop: rec.hitStop, sound: rec.sound, score: rec.score, effect: rec.effect, b7: rec.b7 },
      damageMeasured: sortNum(b.damage), damageVsFullHpChinpiraAtRank10: vsChinpira.values, flags: vsChinpira.flags, hitsExplained: `${b.explained}/${b.total}`,
      attackerFreezeFrames: sortNum(b.hitStop), scorePerHit: sortNum(b.score), paths: [...b.paths] };
  });
  return { hero: HN[heroId], attackIds: ids, moves: perMove };
}

function locomotion() {
  const sets = S.speedSets();
  const per = {};
  for (const h of HK) {
    const l = A.loco(h); if (l.error) { per[h] = l; continue; }
    const id = HK.indexOf(h), s = sets.sets;
    const walkTab = s[0].per[HN[id]].dirs;
    const walkOk = l.walk.every(w => w.matchesSet0);
    const runs = l.run_.filter(r => r.frames > 10);
    per[h] = {
      run: l.run,
      walk: { pxPerFrame: Object.fromEntries(walkTab.map(d => [d.dir, { x: d.vxPx, depth: d.vdPx }])), liveCheck: `${l.walk.length} live (vx, vdepth) pairs, all equal to speed set 0: ${walkOk}`, live: l.walk },
      run_: {
        burst: { vx: s[2].per[HN[id]].dirs[2].vx, pxPerFrame: s[2].per[HN[id]].dirs[2].vxPx, frames: sortNum(runs.map(r => r.burstFrames)), table: s[2].per[HN[id]].table },
        sustained: { vx: s[1].per[HN[id]].dirs[2].vx, pxPerFrame: s[1].per[HN[id]].dirs[2].vxPx, table: s[1].per[HN[id]].table },
        diagonal: { x: s[1].per[HN[id]].dirs[1].vxPx, depth: s[1].per[HN[id]].dirs[1].vdPx },
        liveRuns: runs.map(r => ({ from: r.from, frames: r.frames, burstFrames: r.burstFrames, values: r.distinct })),
        input: 'double-tap left or right (the second press within a few frames); up/down double taps do not run (live: no run state)',
      },
      jumpsLive: l.jumps.filter(j => j.from > 0).map(j => ({ from: j.from, state: j.state, kind: j.state.endsWith('.8') ? 'running jump (table kind 1)' : j.state.endsWith('.12') ? 'dash/leap attack (0x1ABD4)' : j.state.endsWith('.E') ? 'mega crash hop' : (j.vx0 === 0 ? 'standing jump (kind 0, no direction)' : 'jump with a direction (kind 0)'),
        vh0: j.vh0, vh0Px: j.vh0Px, gravity: j.gravity, gravityPx: j.gravityPx, vx0: j.vx0, vx0Px: px(j.vx0), ax: j.ax, axPx: px(j.ax), apexPx: j.apexPx, airborneFrames: j.airborneFrames, landingRecoveryFrames: j.landingFrames, setters: j.setters })),
      dashAttackLive: l.dashAttack,
      megaCrashLive: l.megaCrash.filter(m => m.from > 0),
      velocityWriteSites: l.velocityWriteSites,
    };
  }
  // jump tables (static)
  const jt = []; const KINDS = ['normal jump (0x1A600)', 'running jump (0x1A91E; +0xC1 keeps the running vx/vd)', 'edge hop (0x1A7A4: moving with the feet >= 32 px above the floor; INFERRED)', 'jump while carrying a container (0x1B05E)'];
  const DIRN = ['none', 'up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'];
  for (let k = 0; k < 4; k++) { const perH = {}; for (let h = 0; h < 4; h++) { const p = require('../../rom.cjs').u32(0x53A2 + k * 16 + h * 4); const ent = {}; for (let i = 0; i < 9; i++) { const a = p + i * 12, R = require('../../rom.cjs'); const v = [0, 2, 4, 6, 8, 10].map(o => R.s16(a + o)); ent[DIRN[i]] = { vx: v[0], ax: v[1], vh: v[2], g: v[3], vd: v[4], ad: v[5], apexPx: apex(v[2], v[3]), airFrames: airtime(v[2], v[3]) }; } perH[HN[h]] = { table: hex(p), byStick: ent }; } jt.push({ kind: k, use: KINDS[k], perHero: perH }); }
  // run rules (static + live)
  const runRules = S.runRules();
  runRules.live = Object.fromEntries(HK.map(h => { const r = A.runRelease(h); return [h, r.error ? r : { run: r.run, events: r.events, longRun: r.longRun, doubleTapGap18Frames: r.doubleTapGap18Frames }]; }));
  runRules.duration.live = Object.fromEntries(['jack', 'hannah'].map(h => [h, A.runLimit(h)]));
  return {
    units: 'velocities 8.8 fixed point per 60 Hz frame (256 = 1 px/frame); px values are value/256; depth is the lane axis (up = away)',
    speedTables: sets,
    running: runRules,
    jumpTables: { routine: '0x5364: A0 = long[0x53A2 + kind*16 + id*4] + 12*(stick+1); writes +0x14 vx, +0x1A ax, +0x16 vh, +0x1C gravity, +0x18 vdepth, +0x1E adepth', stickDirection: '+0x22 from table 0x1A6E8: up 0, up-right 4, right 8, down-right 12, down 16, down-left 20, left 24, up-left 28, none -1', integration: 'each frame: v += a, then pos += v (positions 16.16); airborne while height > 0', airFramesNote: 'airFrames counts the frames with height > 0 (the landing frame, where the integration reaches 0 or below, is not counted), which is what the live airborneFrames measure', kinds: jt },
    airControl: S.airControl(),
    perHero: per,
  };
}
function apex(vh, g) { let h = 0, v = vh, m = 0; for (let i = 0; i < 400; i++) { v += g; h += v; if (h > m) m = h; if (h < 0) break; } return +(m / 256).toFixed(2); }
function airtime(vh, g) { let h = 0, v = vh; for (let i = 1; i < 400; i++) { v += g; h += v; if (h <= 0) return i - 1; } return null; }

// ------------------------------------------------------------------------------------------------ weapons
function weapons() {
  const out = [];
  const runs = Object.keys(P.WEAPON_SPEC).map(w => ['jack', w]).concat([['hannah', 'rifle'], ['mess', 'shotgun'], ['mustapha', 'uzi'], ['hannah', 'club'], ['mess', 'knife']]);
  for (const [h, w] of runs) {
    const r = A.weapon(`mech-wpn-${h}-${w}`); if (r.error) { out.push({ hero: h, weapon: w, ...r }); continue; }
    const byId = new Map();
    for (const x of r.hits) {
      const k = `${x.attackId}|${x.objType}|${x.path}`;
      if (!byId.has(k)) byId.set(k, { attackId: x.attackId, object: { type: x.objType, subtypes: [], class: x.objClass }, path: x.path, damage: [], explained: 0, total: 0, record: x.record, predicted: new Set(), flags: x.flags });
      const b = byId.get(k); if (!b.object.subtypes.includes(x.objSub)) b.object.subtypes.push(x.objSub); b.damage.push(x.damage); b.total++; if (x.explained) b.explained++; (x.predicted || []).forEach(v => b.predicted.add(v));
    }
    out.push({ hero: h, weapon: w, run: r.run, ammoAtEachPress: r.ammoAtEachPress, hits: [...byId.values()].map(b => ({ attackId: b.attackId, object: b.object, path: b.path, record: b.record ? { damage: b.record[0], stun: b.record[1], reaction: b.record[2], hitStop: b.record[3], score: S.scoreOf(b.record[5]) } : null, damageMeasured: sortNum(b.damage), predicted: [...b.predicted].sort((x, y) => x - y), hitsExplained: `${b.explained}/${b.total}`, flags: b.flags })) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ items: repo check
function repoItemsCheck(food, scoreItems) {
  const f = path.join(__dirname, '../../../../arcade-items.js');
  if (!fs.existsSync(f)) return { error: 'arcade-items.js not found' };
  const src = fs.readFileSync(f, 'utf8'); global.window = {}; eval(src); const items = global.window.ARCADE_ITEMS.frames; delete global.window;
  const rom = new Map(), EA = require('../enemy-anim.cjs');
  const allRecs = (set, anim) => { const out = []; for (const fr of EA.decodeSet(set).anims[anim].frames) { if (fr.rec != null) out.push(fr.rec); if (fr.rec2 != null) out.push(fr.rec2); } return [...new Set(out)]; };
  for (const x of food.list) for (const r of allRecs(0x28B54, x.subtype - 1)) if (!rom.has(r)) rom.set(r, { kind: 'food', subtype: x.subtype, heal: x.heal, scoreAtFullHp: x.scoreAtFullHp, firstFrame: x.record });
  for (const x of scoreItems.list) for (const r of allRecs(0x2A174, x.subtype - 1)) if (!rom.has(r)) rom.set(r, { kind: 'score', subtype: x.subtype, points: x.points, firstFrame: x.record });
  const rows = [];
  for (const [name, it] of Object.entries(items)) {
    const r = rom.get(it.rec);
    let verdict;
    if (!r) verdict = it.kind === 'ammo' ? (it.score === 1000 ? 'ok (magazine: 1000 points when no gun can take it; record from the ROM set 0x285DC)' : 'score differs') : 'record is not in any food or score-item animation (sets 0x28B54 / 0x2A174)';
    else if (it.kind === 'food' && r.kind === 'food') verdict = (it.heal === r.heal ? 'heal ok' : `heal ${it.heal} but ROM ${r.heal}`) + (it.score === r.scoreAtFullHp ? ', score ok' : `, score ${it.score} but ROM ${r.scoreAtFullHp}`);
    else if (it.kind === 'bonus' && r.kind === 'score') verdict = it.score === r.points ? 'score ok' : `score ${it.score} but ROM ${r.points}`;
    else verdict = `repo says ${it.kind}, ROM says ${r.kind} subtype ${r.subtype} (${r.kind === 'food' ? 'heal ' + r.heal : r.points + ' points'})`;
    rows.push({ name, rec: it.rec, repo: { kind: it.kind, heal: it.heal == null ? null : it.heal, score: it.score }, rom: r || null, verdict, ok: /^(heal ok, score ok|score ok|ok)/.test(verdict) });
  }
  const romOnly = [...rom.entries()].filter(([rec, r]) => rec === r.firstFrame && !Object.values(items).some(it => rom.get(it.rec) && rom.get(it.rec).kind === r.kind && rom.get(it.rec).subtype === r.subtype)).map(([rec, r]) => ({ rec, ...r }));
  return { file: 'arcade-items.js', rows, ok: rows.filter(r => r.ok).length, total: rows.length, romItemsMissingFromRepo: romOnly };
}

// ------------------------------------------------------------------------------------------------ cadillac
function cadillac() {
  const L = A.hook('mech-cad-drive-jack'), R = A.hook('mech-cad-ram-jack');
  if (!L) return { error: 'run missing' };
  const fr = L.filter(e => e.t === 'f');
  const car = e => e.C.find(o => o.ty === 0x160 && o.sub === 0);
  const seg = [];
  let last = null;
  for (const e of fr) { const c = car(e); if (!c) continue; const k = [c.vx, c.vd, A.stTxt(c.st), e.in].join('|'); if (!last || last.k !== k) { last = { k, from: e.f, to: e.f, vx: c.vx, vd: c.vd, ax: c.ax, st: A.stTxt(c.st), input: e.in, x: c.x }; seg.push(last); } else last.to = e.f; }
  const INPUT = v => ['', 'R', 'L', 'RL', 'D', 'RD', 'LD', '', 'U', 'RU', 'LU'][v & 0xF] + (v & 0x10 ? '+attack' : '') + (v & 0x20 ? '+jump' : '');
  const steady = seg.filter(s => s.to - s.from >= 10 && s.st === '2.0.0.0').map(s => ({ input: INPUT(s.input) || 'none', vx: s.vx, vxPx: px(s.vx), vd: s.vd, vdPx: px(s.vd), frames: s.to - s.from + 1, from: s.from }));
  const byInput = {}; for (const s of steady) { const k = s.input; (byInput[k] = byInput[k] || new Set()).add(`${s.vx}/${s.vd}`); }
  // accel ramps: consecutive vx differences while state 2.0.0.0
  const dv = []; for (let i = 1; i < fr.length; i++) { const a = car(fr[i - 1]), b = car(fr[i]); if (a && b && A.stTxt(b.st) === '2.0.0.0' && b.vx !== a.vx) dv.push(b.vx - a.vx); }
  const spawn = L.filter(e => e.t === 'car');
  const rams = R ? A.dedupe(R).filter(e => e.t === 'hp' && (e.pc === 0x1227A || e.pc === 0x123E4)) : [];
  const carHits = R ? A.dedupe(R).filter(e => e.t === 'hp' && /^car/.test(e.tag) && e.new < e.old) : [];
  const entry = seg.filter(s => s.st !== '2.0.0.0').map(s => ({ from: s.from, to: s.to, state: s.st, vx: s.vx, ax: s.ax }));
  const endF = (() => { let lastF = null; for (const e of fr) if (car(e)) lastF = e.f; return lastF; })();
  return {
    trigger: { what: 'EPISODE 3: picking up score item subtype 12 (record 2692) calls 0x8BD24 once (0xFF850E): three pool-C objects of type 0x160 (subtypes 0 car body, 2 and 4 the parts that follow it at +76 / -75 px), 0xFF84D5 = 1 (timer paused), 0xFF84DB = 1; the car drives in, stops, the hero jumps in (hero state 2.0.4.34), and 0xFF8518 = 1 (Cadillac mode) while driving', evidence: 'run mech-cad-drive-jack: item spawned at f20, picked up at f32, car objects at f42 (' + spawn.map(s => hex(s.a)).join(', ') + ')', status: OBS },
    entrySequence: entry.slice(0, 12),
    speeds: { note: 'car body +0x14 (8.8 px/frame) while driving (state 2.0.0.0); the camera keeps the car 192 px from the left edge (camX = car X - 192)', byInput: Object.fromEntries(Object.entries(byInput).map(([k, v]) => [k, [...v]])), steadySegments: steady.slice(0, 40) },
    acceleration: { perFrameChanges: sortNum(dv), note: 'speed moves toward the target by 48 (0.1875 px/frame) per frame; entry: drives in at 1280 and brakes at -48/frame, then accelerates from 0 at +64/frame to the 2048 cruise' },
    hp: { value: 120, note: 'car body +0x6C at spawn (live)', damageRoutine: '0x12454 (when 0xFF87B4 is set): enemy attack objects in an active frame (+0x2E == 4) that overlap the car subtract b0 of their enemy record (0xA2EA4 + id*8) with no modifier; the car flinches (state 2.2.0.0) for 10 frames',
      hitsTaken: carHits.map(e => ({ f: e.f, pc: hex(e.pc), damage: e.old - e.new, attackerType: hex(e.a2ty || 0), attackId: e.a2at })),
      destroyed: (() => { if (!R) return null; const fr2 = R.filter(e => e.t === 'f'); let dead = null, gone = null; for (const e of fr2) { const c = car(e); if (c && !dead && A.stb(c.st)[0] === 4) dead = e.f; if (dead && !c && !gone) gone = e.f; } return { stateDeadAt: dead, removedAt: gone, note: 'at HP 0 the car goes to state 4 then 6 and is removed; 0xFF8518 returns to 0 and the hero continues on foot (mech-cad-ram-jack: 10 hits of 12 from type 0xA8 objects, handler 0x55B06, attack id 105)' }; })(), status: OBS },
    ramming: {
      routine: '0x121D8 -> 0x12236 (car = word 0xFFF7A2; every hittable pool-B object whose +0x59 hit-stop is 0 and whose box overlaps): damage = b0 of enemy record 0xA2EA4 + car(+0x58)*8 with car +0x58 = 102 -> 20 HP, no modifier; stun, reaction, hit-stop from the same record; score code 0x1C (300) via 0xFF42; the victim faces away from the car. Bikes (0x12342 / 0x123E4) take the same 20.',
      record: F.enemyRecord(102), hitsLogged: rams.length, damageValues: sortNum(rams.map(e => e.old - e.new)).filter(v => v > 0),
      victims: uniq(rams.map(e => hex(e.vty))), evidence: 'run mech-cad-ram-jack (HP taps on all 24 pool-B slots)', status: OBS,
    },
    end: { carGoneAtFrame: endF, note: 'the drive ends when the car is wrecked (HP 0); in mech-cad-drive-jack the car was gone at f' + endF + ', in mech-cad-ram-jack the 10th hit of a type-0xA8 object at f2279 wrecked it (camX 19969), and the hero continued on foot', status: OBS },
  };
}

// ------------------------------------------------------------------------------------------------ continue
function continueScreen() {
  const res = {};
  for (const v of ['idle', 'press', 'coin']) {
    const L = A.hook(`mech-cont-${v}`); if (!L) { res[v] = { error: 'run missing' }; continue; }
    const fr = L.filter(e => e.t === 'f');
    const counts = []; let last = null, lf = 0;
    for (const e of fr) { const c = parseInt(e.cs.slice(16, 18), 16); if (e.g.ms !== 0x10) continue; if (c !== last) { counts.push({ f: e.f, count: c, framesSincePrev: e.f - lf }); last = c; lf = e.f; } }
    const cont = fr.find(e => e.g.ms === 0x10), after = fr.filter(e => e.p1.s0 !== 0 && cont && e.f > cont.f);
    res[v] = { run: `mech-cont-${v}`, enter: cont ? cont.f : null, counts: counts.slice(0, 30), endMainState: fr[fr.length - 1].g.ms, heroAfter: after.length ? { f: after[0].f, hp: after[0].p1.hp, lives: after[0].p1.lives, scoreBCD: hex(after[after.length - 1].p1.sc) } : null };
  }
  return res;
}

// ------------------------------------------------------------------------------------------------ enemy HP per type
function enemyHpPerType() {
  const base = path.join(__dirname, '../../../../work/re/extract');
  const out = [];
  const ej = d => fs.existsSync(path.join(base, d)) ? fs.readdirSync(path.join(base, d)).filter(x => x.endsWith('.json') && !/atlas|REPORT|validation|VERIFY/.test(x)).sort() : [];
  for (const fn of ej('enemies')) {
    const j = JSON.parse(fs.readFileSync(path.join(base, 'enemies', fn), 'utf8')); if (!j.variants) continue;
    for (const v of j.variants) if (v.hp) out.push({ export: 'enemies/' + fn, type: j.objType || j.type, variant: v.id, hudName: v.hudName, nameIndex: v.hudIndex, source: v.hp.source, liveAtSpawn: v.hp.hpAtSpawn, liveRank: v.hp.level, byRank: v.hp.byLevel || null });
  }
  for (const fn of ej('bosses')) {
    const j = JSON.parse(fs.readFileSync(path.join(base, 'bosses', fn), 'utf8')); if (!j.hp) continue;
    if (j.hp.boss && j.hp.boss.length) for (const b of j.hp.boss) out.push({ export: 'bosses/' + fn, name: j.name, source: `boss table ${b.table} (index ${b.index}) by players and rank/4`, byPlayers: b.byPlayers, live: j.hp.liveInitial || null });
    else { const rows = (j.hp.regular || []).filter(r => r.name === j.name); if (rows.length) for (const r of rows) out.push({ export: 'bosses/' + fn, name: j.name, nameIndex: r.b03, source: 'regular table ' + r.table, byRank: r.byRank, live: j.hp.liveInitial || null }); else out.push({ export: 'bosses/' + fn, name: j.name, source: 'see the bosses export (no name-matched row)', live: j.hp.liveInitial || null }); }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ JSON
function build(OUT) {
  fs.mkdirSync(OUT, { recursive: true });
  const ev = evidenceIds(OUT);
  const settings = S.settings(), loco = locomotion();
  const attacks = Object.fromEntries(HK.map(h => [h, heroAttacks(h)]));
  const wpn = weapons();
  const food = S.food(), scoreItems = S.scoreItems(), mag = S.magazine();
  const items = A.items();
  const hurt = A.hurt();
  const timerStates = A.timerRuns(P.TIMER_STATES);
  const timerWarps = P.TIMER_WARPS.map(([st, a]) => { const L = A.hook(`mech-timerwarp-${st}-a${a}`); if (!L) return { state: st, area: a, error: 'missing' }; const w = L.filter(e => e.t === 'w' && e.tag === 'timer' && e.pc === 0x1032C).map(e => hex(e.d & 0xFFFF, 4)); const st0 = parseInt(st.replace(/\D+/g, ' ').trim().split(' ')[0], 10); const tab = S.timer().startValues[st0 - 1].areas[a]; return { state: st, area: a, resetWrites: w, table: tab.bcd, match: w.length > 0 && w.every(x => x === tab.bcd) }; });
  const timerScripts = ['mech-timerscript-s1a1', 'mech-timerscript-s1a2', 'mech-timerscript-s2'].map(r => A.timerScript(r));
  const timerRespawn = A.timerRespawn();
  const knock = Object.fromEntries(['mess', 'jack'].map(h => [h, A.knockdown(h)]));
  const cad = cadillac(), cont = continueScreen();
  // timer script checks: every non-tick write caught live must be one of the decoded script commands (0xFD9C /
  // 0x104D8-DC from 0xFDA4) with a decoded value, or an area start (0x1032C)
  const timerCmds = S.timer().scriptCommands.commands;
  const scriptChecks = [];
  for (const r of timerScripts) { if (r.error) continue; for (const w of r.writes) {
    if (w.pc === hex(0x1032C)) { scriptChecks.push({ run: r.run, f: w.f, pc: w.pc, value: w.value, ok: true, what: 'area start value' }); continue; }
    if (w.pc === hex(0xFD9C)) { const c = timerCmds.find(c => c.episode === r.stage && c.command === '0x0C' && hex(parseInt(c.arg, 16), 4) === w.value); scriptChecks.push({ run: r.run, f: w.f, pc: w.pc, value: w.value, cameraX: w.cameraX, area: w.area, ok: !!c, what: c ? 'SET ' + c.time + ' from ' + c.source : 'no decoded SET command with this value in this stage' }); continue; }
    if (w.pc === hex(0x104D8) || w.pc === hex(0x104DC)) { scriptChecks.push({ run: r.run, f: w.f, pc: w.pc, byte: w.byte, value: w.value, cameraX: w.cameraX, area: w.area, ok: true, what: 'add routine 0x104A8 (ADD TIME command or respawn/continue)' }); continue; }
    scriptChecks.push({ run: r.run, f: w.f, pc: w.pc, value: w.value, ok: false, what: 'unexpected writer' });
  } }
  const respawnChecks = (() => { if (timerRespawn.error) return null; const adds = timerRespawn.writes.filter(w => w.pc === hex(0x104D8) || w.pc === hex(0x104DC)); return { adds, respawnAt: timerRespawn.stateSegments.filter(s => s.key.startsWith('0.') && s.from > 5).map(s => s.from), continueScreenAt: timerRespawn.continueScreenAt }; })();
  // validation tallies
  let hh = 0, hhOk = 0; for (const h of HK) for (const m of attacks[h].moves) for (const x of m.hits) { if (x.explained == null) continue; hh++; if (x.explained) hhOk++; }
  let wh = 0, whOk = 0; for (const w of wpn) for (const x of (w.hits || [])) { const [a, b] = x.hitsExplained.split('/').map(Number); whOk += a; wh += b; }
  const eh = hurt.hits ? hurt.hits.filter(x => x.explained != null) : [];
  const foodLive = items.items ? items.items.filter(x => x.kind === 'food') : [];
  const foodOk = foodLive.filter(x => { const f = food.list.find(q => q.subtype === x.subtype); return f && x.hpAfter - x.hpBefore === Math.min(f.heal, 100 - x.hpBefore); }).length;
  const scoreLive = items.items ? items.items.filter(x => x.kind !== 'food') : [];
  const scoreOk = scoreLive.filter(x => { if (x.kind === 'food-full') { const f = food.list.find(q => q.subtype === x.subtype); return x.hpBefore === 100 ? x.scoreDelta === f.scoreAtFullHp : true; } if (x.kind === 'score') return x.scoreDelta === scoreItems.list.find(q => q.subtype === x.subtype).points; if (x.kind === 'magazine') return x.scoreDelta === 1000; return false; }).length;

  const J = {
    meta: {
      title: 'Cadillacs & Dinosaurs (1993 arcade, MAME dino) - game mechanics and numbers',
      generator: 'node tools/re/export/mechanics.cjs (static: mech/static.cjs, formulas: mech/formula.cjs, live plans: mech/plans.cjs, analysis: mech/analyze.cjs, output: mech/build.cjs)',
      units: { time: '60 Hz frames unless stated', speed: '8.8 fixed point per frame (256 = 1 px/frame); *Px fields are px/frame', position: '16.16 (integer = px)', hp: 'hit points (heroes 100)', score: 'points (decimal; the game stores BCD)' },
      status: { OBSERVED: 'read in the ROM code/tables and/or seen in a live MAME run (evidence named)', INFERRED: 'reasoned from code or behaviour, not checked by a dedicated run' },
      memoryMapFactsUsed: ['V08', 'V09', 'V10', 'V12', 'V13', 'V15', 'V16', 'V19-V21', 'V25', 'V26', 'V28', 'V29', 'V31', 'V33-V36', 'V38-V40', 'U09 (areas per stage)', 'R4 (corrected damage record)', 'R6', 'R7', 'R8 (timer 51 frames)', 'R9 (+0x03 name index)'],
      rejectedClaimsAvoided: 'R4: 60 x 8-byte damage records per hero (index +0x58/2), not 120 x 4; R8: 51 frames per timer second; R6 state bytes',
      evidence: ev,
    },
    validation: {
      heroHitsExplainedByFormula: `${hhOk}/${hh} (mech-moves-*: melee and grab hits; every measured damage is in the set the decoded formula 0x2B904 allows)`,
      weaponHitsExplainedByFormula: `${whOk}/${wh} (mech-wpn-*: weapon objects through 0x2BA2A)`,
      enemyHitsOnHeroExplained: `${eh.filter(x => x.explained).length}/${eh.length} (mech-hurt-jack: 0x6422 formula)`,
      foodHealMatches: `${foodOk}/${foodLive.length} (mech-items-jack: HP change = min(table heal, 100 - HP))`,
      scoreItemMatches: `${scoreOk}/${scoreLive.length} (mech-items-jack: score deltas of full-HP food, score items and the magazine)`,
      timerStartValues: (() => { const tab = S.timer().startValues; const ok = timerStates.filter(t => !t.error && t.area === 0 && t.timerAtLoad === tab[t.stage - 1].areas[0].bcd); const a0 = timerStates.filter(t => !t.error && t.area === 0); return `${ok.length}/${a0.length} area-0 stage save states load with the table value; ${timerWarps.filter(t => t.match).length}/${timerWarps.length} area warps write the table value (pc 0x1032C). The E1 area-1/2 runtime states load at 3:00 because they were saved later in the area, not at its start (the clock is only the table value at the area start; see timerScriptWrites)`; })(),
      timerScriptWrites: `${scriptChecks.filter(c => c.ok).length}/${scriptChecks.length} non-tick timer writes caught live in mech-timerscript-* are explained by the decoded stage-script commands or area starts (${scriptChecks.filter(c => c.pc === hex(0xFD9C)).map(c => `${c.run}: ${c.value} at camera X ${c.cameraX}`).join('; ') || 'no SET writes caught'})`,
      timerRespawnAdds: respawnChecks ? `${respawnChecks.adds.length} byte writes by the add routine 0x104A8 in mech-timer-respawn (respawn at f${respawnChecks.respawnAt.join('/')}: ${respawnChecks.adds.filter(w => w.mainState === 0x0C).map(w => w.byte + '=' + w.value + ' (before ' + w.before + ')').join(', ')}; continue screen at f${respawnChecks.continueScreenAt}: ${respawnChecks.adds.filter(w => w.mainState !== 0x0C).map(w => w.byte + '=' + w.value + ' (before ' + w.before + ')').join(', ')})` : 'run missing',
      knockdownRule: Object.entries(knock).map(([h, k]) => k.error ? `${h}: ${k.error}` : `${h}: ${k.tally.ok}/${k.tally.total} enemy hits react as the 0x1C08A decision predicts (${k.tally.knockdowns} knockdowns: ${Object.entries(k.tally.byCause).map(([c, n]) => `${n} by ${c}`).join(', ')})`).join('; '),
      runPersistence: HK.map(h => { const r = loco.running.live[h]; if (r.error) return `${h}: ${r.error}`; const p = r.events.filter(e => e.kind === 'run persists after release'); return `${h}: ${p.length} releases kept running (${p.map(e => e.frames + ' f').join(', ')})`; }).join('; '),
      walkSpeeds: `all live walk velocities equal speed set 0 for the 4 heroes: ${HK.every(h => loco.perHero[h].walk && /true$/.test(loco.perHero[h].walk.liveCheck))}`,
    },
    settings,
    heroes: {
      maxHp: { value: 100, address: '0x4DC2 / 0x4DE8 (+0x6A/+0x6C/+0x6E = 0x64)', status: OBS },
      selectScreenStats: { note: 'POWER/SPEED/SKILL bars of the select screen (V32, table 0xB444) are display only; they are never read during play', values: { Jack: [4, 3, 3], Hannah: [2, 4, 5], Mustapha: [3, 5, 3], Mess: [5, 2, 4] } },
      toughness: { note: 'damage taken multiplier /32 (0x2C88E): Jack 32, Mustapha 34, Hannah 35, Mess 30', values: S.enemyModifier().heroToughness.values, status: OBS },
      locomotion: loco,
      attacks,
      megaCrash: {
        input: 'attack + jump together (heroes export); also from a run',
        hpCost: { rule: 'paid only when the mega crash hits something: per hit 0x10B08 subtracts 10 from the budget +0xEE when +0xEE == 20 (first hit), else 4, and takes the same from the hero HP while the budget stays >= 0 (HP never below 1). +0xEE = 20 at the start of each mega crash (0x1968E). So 10 + 4 + 4 = 18 HP at most.', liveCostsPerHit: sortNum([].concat(...HK.map(h => attacks[h].moves.filter(m => /mega/.test(m.move)).map(m => m.heroHpCost.map(c => c.cost))).flat(2))), noTargetCost: 'INFERRED: the cost sits inside the hero-hit routine after the damage (0x10AEE..0x10B26), so a mega crash that hits nothing costs nothing. In mech-loco-* the mega crash at f1001 only hit the ENEMY CLEAR helper objects (special path 0x10B50, hit-stop but no cost) and +0xEE stayed 20', status: OBS },
        damage: 'attack id 18 (b0: Jack 20, Mustapha 20, Hannah 20, Mess 23); 21 per hit vs a full-HP Chinpira (live)',
        duration: Object.fromEntries(HK.map(h => [h, (loco.perHero[h].megaCrashLive || []).map(m => m.framesWithoutHitStop)])),
        durationNote: 'frames in state 2.0.0.E minus the frames frozen by hit-stop (mech-loco-*)',
        note: 'Mustapha\'s mega crash includes a hop (vh 0x4C0 = 1216, g -64 at 0x1AB20) - this is the "1216 / -64" of U05',
      },
      grab: {
        start: 'walk into a standing enemy (the hero holds it: +0x05 = 4; enemy +0x05 = 6)',
        knees: 'attack while holding: first knee id 6, next knees id 8 (grab hit routine 0x12528: damage through 0x2B904, stun -= byte 1; when the stun meter or the HP reaches 0 the victim is set to state 2.2 and drops out of the hold - the third knee on a 10-stun Chinpira in every live run; record byte 3 (hit-stop) is read and dropped at 0x125A2, so grab hits have no hit-stop)',
        throw: 'toward+attack or away+attack while holding: id 10 (both directions use the same record)',
        damageJack: '6: 10, 8: 15-16, 10 (throw): 23-24 vs a full-HP Chinpira', bodyHit: 'a thrown or flying enemy that hits another enemy deals a fixed 5 (enemy record 0x11, 0x118D2) and knocks it down', status: OBS,
      },
      hitStop: { rule: 'byte 3 of the damage record is written to +0x59 of both attacker and victim; the attacker\'s punch/attack state waits while +0x59 counts down (0x19464..0x19496), so the animation freezes for that many frames', liveCheck: 'mech-moves-*: attacker freeze frames equal record byte 3 (combo 9/9/9/13 for Jack, throws 2, jump kick 6, mega crash 7)', status: OBS },
      knockdown: { ...S.knockdownRule(), live: knock },
      stunMeter: {
        heroes: { start: 10, address: '+0x78 = 0x0A (0x18CB4, 0x18DD6, 0x1C286, 0x1CCB0, 0x1CDC6)', rule: 'each enemy hit subtracts enemy record byte 1 (0x116E6, floor 0). The meter is one of four knockdown causes (see knockdown): a hit is a flinch only when the meter stays above 0 AND the attack carries no knockdown flag (+0x5A) AND the hero is on the ground (+0x51 == 0) AND the HP stays above 0. Refilled to 10 at the knockdown / get-up, and 120 frames after the last hit (+0xF6 = 0x78 at 0x116DE, counted down at 0x18DC6: +0x78 = 10 when it reaches 0)', live: 'mech-hurt-jack: 10 -4 -> 6, then -6 -> 0 = knockdown; mech-knockdown-mess: 10 -> 8 -> 6 -> 4 then a knockdown by the Hutori finisher flag with the meter at 4; refilled at the knockdown (pc 0x1C286 / 0x1CCB0) and at the get-up (0x1CDC6)', status: OBS },
        enemies: { rule: 'same field +0x78; hero record byte 1 is subtracted (0x10A6A); when it reaches 0 the enemy is knocked down (the finisher / jump kick / 3rd knee); Chinpira starts at 10', live: 'combo: 10 -> 9 -> 8 -> 5 -> 0 (knockdown); knees 10 -> 7 -> 2 -> 0 (released)', status: OBS },
      },
      invulnerability: {
        rule: 'V31: only objects with +0x00 == 1 can be hit; +0xEC (word) and +0xF9 (byte) count down 1 per frame (0x18CEA / 0x18D08) and keep +0x00 = 2 while either runs',
        respawn: { frames: 360, address: '0x18B9E (+0xEC = 0x168)', live: 'mech-hurt-jack: written at f1535 (drop-in), counts down from the landing f1597 to f1956', status: OBS },
        getUp: { frames: 20, address: '0x6C2A: +0xF9 = byte[0x6C3A + row + id], row 0 = 0x14 for every hero', live: 'mech-hurt-jack: +0x00 = 2 for 20 frames after every get-up (f227-246, 520-539, 907-926, 1050-1069)', status: OBS },
        stageStart: { frames: 60, address: '0x6C32 with row 0x0C (0x3C)', live: 'f1-60 of every stage-1 state', status: OBS },
        otherRows: S.livesExtend().secondIframeTable,
        other: { sites: ['0x19A66', '0x19AA0', '0x1A348', '0x1AE4C', '0x1AF6C', '0x1B110', '0x1B240', '0x1B370'], value: '+0xEC = 0xB4 (180 frames)', note: 'not reached in the runs; 0x19A52 is the extend/1-up path (+0x10E), the others sit in special moves - INFERRED', status: INF },
        afterHit: 'no i-frames after a normal flinch (+0x00 back to 1 the next frame); enemy hits set hero +0xF6 = 0x78: the 120-frame countdown after which the stun meter refills to 10 (0x18DC6)',
      },
    },
    stageScripts: (() => { const d = S.scripts.decode(); return { note: 'per-area spawn lists and event (wave) chains: what each area places where, with the drop index of containers and the time commands. Decoded statically; the time commands were checked live (validation.timerScriptWrites).', ...d }; })(),
    damage: {
      heroRecords: { table: '0xA26FC (pointers per character id)', fields: 'damage, stun, reaction (-> victim +0x7B/+0x06), hitStop (-> +0x59 of both), sound (jsr 0x962A), scoreCode (0x10292 + code), effect (D5 -> 0x12720), b7 (-> victim +0x9A)', perHero: S.heroRecords() },
      heroModifier: S.heroModifier(), heroPower: S.heroPower(),
      enemyRecords: { table: '0xA2EA4', note: 'enemy attack id = attacker +0x58; byte 5 is not used by 0x116B2', records: S.enemyRecords() },
      enemyModifier: S.enemyModifier(),
      specialPaths: [
        { pc: '0x118D2', what: 'flying/thrown body hits another enemy: fixed b0 of enemy record 0x11 (5), stun cleared, knockdown', status: OBS },
        { pc: '0x111C6', what: 'weapon attack ids 0x6C / 0x6E: fixed signed b0, HP not below 1', status: OBS },
        { pc: '0x12236', what: 'Cadillac ram: fixed b0 of enemy record 102 (20)', status: OBS },
        { pc: '0x10706', what: '2-3 players: a hero attack that hits another hero (0xFF84F3 < 3 and depth close) costs the victim 1 HP (never below 1) and +0xF6 = 0x78', status: INF },
        { pc: '0x2B904 overflow', what: 'melee path: (D*F1 & 0xFFFF)*F2 is shifted with lsr.w, so a product >= 65536 wraps: id 38 (b0 60) would do 1 instead of 63 at F2 = 35; never observed (no live move used id 38)', status: INF },
      ],
    },
    weapons: {
      perWeapon: wpn,
      ammo: { table: 'V19-V21 (memory map): rifle 6, gun 6, knife 6, Uzi 48, M16 48, shotgun 6, bazooka 4, rod 10, stick 6, B. knife 6, club 10, torch 10, dynamite 10, grenade 10, stone 10; Uzi/M16 bursts use 3 per press (live: 45, 42, 39 ...)', status: OBS },
      bluntCharge: { routine: '0x11262 (class 0x203 swings): holder +0x80 (charge counter) <= 15: x1, <= 30: x1.25, <= 45: x1.5, else x2', status: OBS },
      magazine: mag,
      note: 'Weapon damage uses the holder\'s damage table (object +0x03 = character id) and the owner player\'s power +0xC6; the measured ids are identical for the four heroes (records 70-98 are the same in all four tables except Hannah id 78/90 reaction bytes).',
    },
    enemies: {
      hp: S.hpTables(),
      perType: enemyHpPerType(),
      note: 'Per-type HP, names and attacks are exported with live checks in work/re/extract/enemies/<type>.json and work/re/extract/bosses/<id>.json (HP by rank and source, attack ids with measured damage); this file gives the shared tables and formulas.',
    },
    items: { food, scoreItems, magazine: mag, live: items, repoCheck: repoItemsCheck(food, scoreItems) },
    drops: S.drops(),
    score: {
      table: { addr: '0x10292', note: 'BCD longs, indexed by a byte offset code (code/4 = entry)', values: S.scoreTable() },
      events: [
        { event: 'hit', rule: 'damage record byte 5 (100 / 200 / 300 / 400 / 700 / 800 / 1000 points)', status: OBS },
        { event: 'counter hit (victim in an attack frame with a counter multiplier)', rule: '+400 (code 0x20 at 0x10ABC)', status: OBS },
        { event: 'food at full HP', rule: 'table 0x28B10: 10000 / 5000 / 3000 / 1000', status: OBS },
        { event: 'score item', rule: 'table 0x2A164: 10000 / 5000 / 3000 / 1000', status: OBS },
        { event: 'magazine with nothing to refill, or a full gun', rule: '1000', status: OBS },
        { event: 'Cadillac ram', rule: '300 (code 0x1C via 0xFF42)', status: OBS },
        { event: 'continue', rule: 'continuing resets the score to 0 and adds 1 (the last digit counts continues: score 1 after the first continue, live mech-cont-coin)', status: OBS },
      ],
      cap: '99,999,999 (0x10026 clamps on BCD overflow)',
    },
    lives: {
      start: { value: 'NUMBER OF PLAYERS setting value (0..3) in stock, default 1 -> 2 lives in total', address: '0x4DD6', live: 'mech-hurt-jack: lives 1 -> death -> respawn with 0 (pc 0x1BFD6) -> death -> continue screen', status: OBS },
      respawn: 'in place: drop-in from the top of the screen (state 0.2.4.2), HP 100, 360 frames of i-frames',
      extend: S.livesExtend().extend,
      continue: { rule: 'main state 0x10 (0xE9E6): count 20 -> 0, the first count lasts 98 frames, then 60 frames (1 s) per count; holding/pressing attack drops it to 10 frames per count; a coin resets it to 20; start continues in place with HP 100, lives = setting, score reset (+1 per continue). At 0 the game goes to main state 0x14 (game over).', live: cont, status: OBS },
    },
    timer: { ...S.timer(), liveStates: timerStates, liveAreaWarps: timerWarps, liveScriptRuns: timerScripts, liveScriptChecks: scriptChecks, liveRespawn: timerRespawn },
    difficulty: { settings: settings.items.filter(i => /DIFFICULTY|EXTEND|PLAYERS/.test(i.name)), rank: S.rankSystem(), liveRankValues: { note: 'word 0xFF85EE seen live in the stage-1 runs', values: sortNum([].concat(...HK.map(h => { const L = A.hook(`mech-moves-${h}`) || []; return L.filter(e => e.t === 'f').map(e => e.g.rk); }))) } },
    cadillac: cad,
  };
  fs.writeFileSync(path.join(OUT, 'mechanics.json'), JSON.stringify(J, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'MECHANICS.md'), require('./markdown.cjs').md(J));
  console.log('wrote', path.join(OUT, 'mechanics.json'), 'and MECHANICS.md');
  return J;
}
module.exports = { build };
