#!/usr/bin/env node
// Stage census of the regular human enemies of the original Cadillacs & Dinosaurs (research only, never shipped).
// Source: the whole-stage MAME walks made for the boss export (tools/re/export/bosses-live.cjs, runs work/re/runs/bz-stage*).
// Those walks log every pool-B object every frame ({"o": [[pool, slot, type, sub, b03, b00, b04, b05, b06, b07, fp, set,
// hpMax, hp, p23, face, x, h, d, f25, t2f, lp, tdx, tdy, f53, c4c, c4d, f2e, b01, atk58], ...], "g": [rank, players-1,
// stage, area, main state]}). The bot there kills regular enemies (+0x6C = 0, +0x04 = 6) every 90 frames, so each life
// shows how the enemy ENTERS (its behaviour mode, +0x26 low byte) but rarely a whole fight.
//
//   node tools/re/export/enemy-census.cjs        -> work/re/extract/enemies/census.json (also used by enemies.cjs)
//
// What it gives (all OBSERVED in real stage play, not debug spawns): for every regular type, the stages and areas it
// appears in, with which subtype words (+0x26: high byte = variant, low byte = behaviour mode), HUD index (+0x03),
// palette override (+0x23; counted while +0x05 = 0, overrides during reactions such as the burning palette 0x84 are
// listed apart as p23Reaction), starting HP, and the first animations it plays.
'use strict';
const fs = require('fs'), path = require('path'), readline = require('readline');
const R = require('../rom.cjs');
const A = require('./enemy-anim.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const RUNS = path.join(ROOT, 'work/re/runs');
const OUT = path.join(ROOT, 'work/re/extract/enemies');
const hex = A.hex;

// pool-B types followed (regular humans + their helpers + the related mutants / cut-scene punks)
const TYPES = { 0x08: 'chinpira', 0x28: 'hutori', 0x13C: 'naguri', 0x34: 'mituryou', 0x38: 'knifeman', 0xFC: 'knifeonly', 0x50: 'subayai',
  0x100: 'thurow', 0x0C: 'ishinage', 0x18: 'kameleon', 0x48: 'richmond', 0x10: 'kingkimo', 0x16C: 'tyrog2', 0x118: 'bike', 0xDC: 'intro-punk' };
const F = { pool: 0, slot: 1, type: 2, sub: 3, b03: 4, b00: 5, b04: 6, b05: 7, b06: 8, b07: 9, fp: 10, set: 11, hpMax: 12, hp: 13, p23: 14, face: 15, x: 16, h: 17, d: 18, atk: 29 };

function runList() {
  return fs.readdirSync(RUNS).filter(d => /^bz-stage/.test(d) && fs.existsSync(path.join(RUNS, d, 'hook.jsonl'))).sort();
}

const setCache = new Map();
function animOf(set, fp) {
  if (!set || set >= R.prg.length) return null;
  if (!setCache.has(set)) setCache.set(set, A.decodeSet(set));
  for (const an of setCache.get(set).anims) { const i = an.frames.findIndex(f => f.addr === fp); if (i >= 0) return an.index; }
  return null;
}

async function scanRun(run) {
  const lives = []; const open = new Map();   // slot -> life
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(RUNS, run, 'hook.jsonl')), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.startsWith('{"n"') || line.indexOf('"o"') < 0) continue;
    const j = JSON.parse(line); const n = j.n, g = j.g || [];
    const seen = new Set();
    for (const o of j.o) {
      if (o[F.pool] !== 'B') continue;
      const type = o[F.type]; if (!(type in TYPES)) continue;
      const slot = o[F.slot]; seen.add(slot);
      let L = open.get(slot);
      if (L && L.type !== type) { lives.push(L); open.delete(slot); L = null; }
      if (!L) {
        L = { run, slot, type, first: n, last: n, stage: (g[2] ?? -1) + 1, area: g[3] ?? null, rank: g[0] ?? null, players: (g[1] ?? 0) + 1, subs: new Map(), b03: new Map(), p23: new Map(), p23React: new Map(), sets: new Map(), hp0: null, hpMax0: null, anims: [], atk: new Set(), atk0: o[F.atk], atkChanged: false, states: new Set() };
        open.set(slot, L);
      }
      L.last = n;
      const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
      inc(L.subs, o[F.sub]); L.states.add(o[F.b04]);
      if (o[F.b04] === 2) { inc(L.b03, o[F.b03]); inc(o[F.b05] === 0 ? L.p23 : L.p23React, o[F.p23]); inc(L.sets, o[F.set]); if (L.hp0 === null) { L.hp0 = o[F.hp]; L.hpMax0 = o[F.hpMax]; } }
      // the first logged frame of a slot life still holds the previous occupant's +0x28/+0x40 (the handler has not run
      // yet), and +0x58 is never cleared on free: skip that frame, and count attack ids only once +0x58 has changed
      if (n === L.first) continue;
      if (o[F.atk] !== L.atk0) L.atkChanged = true;
      if (L.atkChanged && o[F.atk]) L.atk.add(o[F.atk]);
      const a = animOf(o[F.set], o[F.fp]);
      const key = a === null ? '?' : a;
      const lastA = L.anims[L.anims.length - 1];
      if (!lastA || lastA.anim !== key || lastA.set !== o[F.set]) { if (L.anims.length < 24) L.anims.push({ anim: key, set: o[F.set], n, st: [o[F.b04], o[F.b05], o[F.b06], o[F.b07]] }); }
    }
    for (const [slot, L] of open) if (!seen.has(slot)) { lives.push(L); open.delete(slot); }
  }
  for (const L of open.values()) lives.push(L);
  return lives;
}

const top = m => { let best = null, bn = -1; for (const [k, v] of m) if (v > bn) { best = k; bn = v; } return best; };

async function build() {
  const runs = runList();
  const all = [];
  for (const r of runs) { const lv = await scanRun(r); all.push(...lv); }
  // only lives that reached the alive state (+0x04 = 2) are enemies proper; init-only blips are dropped
  const lives = all.filter(L => L.b03.size > 0 || L.type === 0xDC).map(L => {
    const sub = top(L.subs);
    return { run: L.run, slot: L.slot, first: L.first, frames: L.last - L.first + 1, stage: L.stage, area: L.area, rank: L.rank, players: L.players,
      type: hex(L.type), name: TYPES[L.type], sub: hex(sub, 4), variantByte: hex(sub >> 8, 2), mode: hex(sub & 0xFF, 2), subs: [...L.subs.keys()].map(s => hex(s, 4)),
      b03: top(L.b03), hud: top(L.b03) === null ? null : A.hudName(top(L.b03)), p23: [...L.p23.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([p, c]) => ({ p23: hex(p, 2), frames: c })),
      p23Reaction: [...L.p23React.entries()].filter(([p]) => p & 0x80).sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([p, c]) => ({ p23: hex(p, 2), frames: c })),
      set: top(L.sets) === null ? null : hex(top(L.sets)), hp0: L.hp0, hpMax0: L.hpMax0, attackIds: [...L.atk].sort((a, b) => a - b),
      firstAnims: L.anims.slice(0, 12).map(a => `${a.anim}${a.set !== top(L.sets) && a.anim !== '?' ? '@' + hex(a.set) : ''}`) };
  });
  // aggregate: per type -> per variant byte -> per (stage, area) -> modes
  const byType = {};
  for (const L of lives) {
    const t = byType[L.name] = byType[L.name] || { type: L.type, lives: 0, appearances: {} };
    t.lives++;
    const k = `${L.variantByte}|S${L.stage}A${L.area}`;
    const ap = t.appearances[k] = t.appearances[k] || { variantByte: L.variantByte, stage: L.stage, area: L.area, lives: 0, modes: {}, b03: new Set(), hud: new Set(), p23: new Set(), hp0: new Set(), sets: new Set(), runs: new Set() };
    ap.lives++; ap.modes[L.mode] = (ap.modes[L.mode] || 0) + 1; ap.b03.add(L.b03); ap.hud.add(L.hud); for (const p of L.p23.slice(0, 1)) ap.p23.add(p.p23); ap.hp0.add(L.hp0); ap.sets.add(L.set); ap.runs.add(L.run);
  }
  for (const t of Object.values(byType)) t.appearances = Object.values(t.appearances).sort((a, b) => a.stage - b.stage || a.area - b.area || a.variantByte.localeCompare(b.variantByte))
    .map(ap => ({ ...ap, b03: [...ap.b03], hud: [...ap.hud], p23: [...ap.p23], hp0: [...ap.hp0], sets: [...ap.sets], runs: [...ap.runs] }));
  // per type and mode: example first-animation sequences (up to 4 distinct)
  const modes = {};
  for (const L of lives) {
    const m = modes[L.name] = modes[L.name] || {};
    const e = m[L.mode] = m[L.mode] || { mode: L.mode, lives: 0, where: new Set(), examples: [] };
    e.lives++; e.where.add(`S${L.stage}A${L.area}`);
    const seq = L.firstAnims.join(' ');
    if (e.examples.length < 4 && !e.examples.some(x => x.firstAnims === seq)) e.examples.push({ run: L.run, frame: L.first, stage: L.stage, area: L.area, sub: L.sub, hud: L.hud, firstAnims: seq, attackIds: L.attackIds });
  }
  for (const m of Object.values(modes)) for (const e of Object.values(m)) e.where = [...e.where];
  return { note: 'OBSERVED in the whole-stage walks bz-stage* (tools/re/export/bosses-live.cjs): every pool-B object of the listed types, every frame. The bot killed regular enemies every 90 frames, so lives are short; firstAnims = main-set animation indices in play order (@set = another set, ? = a reaction set or a frame outside the main set).',
    runs, types: TYPES, byType, modes, lives };
}

async function main() {
  const c = await build();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'census.json'), JSON.stringify(c, null, 1));
  for (const [k, t] of Object.entries(c.byType)) console.log(k.padEnd(11), t.lives, t.appearances.map(a => `${a.variantByte}:S${a.stage}A${a.area}x${a.lives}[${Object.keys(a.modes).join(',')}]${a.p23.filter(p => p !== '0x00').length ? 'p' + a.p23.join('/') : ''}`).join(' '));
}
module.exports = { build, TYPES };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
