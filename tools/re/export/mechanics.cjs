#!/usr/bin/env node
// Game mechanics and numbers of the original Cadillacs & Dinosaurs (MAME "dino"), for the sequel's combat and feel.
// Research tooling only; nothing here ships with the game. Deterministic and re-runnable from the repo root:
//
//   node tools/re/export/mechanics.cjs            -> live runs that are missing (one MAME process at a time), then
//                                                   work/re/extract/mechanics/{mechanics.json, MECHANICS.md}
//   node tools/re/export/mechanics.cjs live [re]  -> only the live runs (names matching the regex re)
//   node tools/re/export/mechanics.cjs build      -> only the outputs, from the ROM and the existing runs
//   node tools/re/export/mechanics.cjs evidence   -> REA evidence records for the key code (mech/rea-evidence.cjs)
//
// Sources: the program image work/re/dino-prg.bin (ROM tables and code, decoded in mech/static.cjs), live MAME
// runs work/re/runs/mech-* (plans in mech/plans.cjs, analysis in mech/analyze.cjs), and the earlier verified facts
// of tools/re/MEMORY-MAP.md (V/R ids are quoted where a number relies on them).
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./lib/live.cjs');
const P = require('./mech/plans.cjs');

const OUT = path.join(__dirname, '../../../work/re/extract/mechanics');

function allPlans() {
  const plans = [];
  for (const h of P.HEROES) plans.push(P.loco(h));
  for (const h of P.HEROES) plans.push(P.moves(h));
  // the same move list with the target's HP held at its natural max (band test) for Jack
  plans.push(P.moves('jack', { name: 'mech-moves-jack-hpmax', holdHp: -1, reps: 1, c6: -1 }));
  for (const w of Object.keys(P.WEAPON_SPEC)) plans.push(P.weapon('jack', w));
  for (const [h, w] of [['hannah', 'rifle'], ['mess', 'shotgun'], ['mustapha', 'uzi'], ['hannah', 'club'], ['mess', 'knife']]) plans.push(P.weapon(h, w));
  plans.push(P.items('jack'));
  plans.push(P.hurt('jack'));
  for (const v of ['idle', 'press', 'coin']) plans.push(P.cont(v));
  for (const s of P.TIMER_STATES) plans.push(P.timerProbe(s));
  for (const [st, a] of P.TIMER_WARPS) plans.push(P.timerWarp(st, a));
  plans.push(P.cadillac('jack'));
  plans.push(P.cadDrive('jack'));
  {
    const A = (at, keys, len = 1) => ({ from: at, to: at + len - 1, keys });
    // ramming run: HP taps on every pool-B slot and on the car; right held, with neutral and brake stretches
    plans.push(P.cadDrive('jack', { name: 'mech-cad-ram-jack', frames: 2600, tapAll: true, script: [A(30, ['attack'], 2), A(400, ['right'], 600), A(1000, [], 120), A(1120, ['left'], 120), A(1240, ['right'], 1300)] }));
  }
  // verifier follow-ups: run persistence / steering / limits, the knockdown decision, the stage-script time commands,
  // the respawn / continue time adds, and Mess's combo labels at a 7-frame cadence
  for (const h of P.HEROES) plans.push(P.runRelease(h));
  for (const h of ['jack', 'hannah']) plans.push(P.runLimit(h));
  for (const h of ['mess', 'jack']) plans.push(P.knockdown(h));
  plans.push(P.timerScript({ name: 'mech-timerscript-s1a1', state: 'stage1-jack', area: 1 }));
  plans.push(P.timerScript({ name: 'mech-timerscript-s1a2', state: 'stage1-jack', area: 2 }));
  plans.push(P.timerScript({ name: 'mech-timerscript-s2', state: 'stage2-jack', frames: 3600 }));
  plans.push(P.timerRespawn());
  plans.push(P.moves('mess', { name: 'mech-moves-mess-combo7', movesList: P.COMBO7, reps: 2, extraFrames: 200 }));
  return plans;
}

async function live(filter) {
  const re = filter ? new RegExp(filter) : null;
  const plans = allPlans().filter(p => !re || re.test(p.name));
  for (const p of plans) {
    const t0 = Date.now();
    const [s] = await L.runSeq([p]);
    console.log(`${p.name}: ok=${s.ok} ${((Date.now() - t0) / 1000).toFixed(1)} s, last ${s.lastFrame}`);
  }
}

async function main() {
  const [cmd = 'all', arg] = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });
  if (cmd === 'live' || cmd === 'all') await live(cmd === 'live' ? arg : null);
  if (cmd === 'evidence') require('./mech/rea-evidence.cjs').run(path.join(OUT, 'evidence'));
  if (cmd === 'build' || cmd === 'all') require('./mech/build.cjs').build(OUT);
}
module.exports = { allPlans };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
