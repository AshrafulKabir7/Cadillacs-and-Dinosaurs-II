#!/usr/bin/env node
// Build the "stage 1 gameplay just started" save states, one per hero, from a cold boot.
//   node tools/re/mame/make-states.cjs [jack|hannah|mustapha|mess ...]
//
// Recipe (frames counted from power-on, one per frame_done callback; see README "Boot recipes"):
//   coin   "Coin 1"          held 330-335   (the title shows INSERT COIN from ~frame 320; coins before ~300 are lost)
//   start  "1 Player Start"  held 370-375   -> character select appears ~frame 400, cursor on Jack, 10 s timer
//   move   "P1 Right"        held 430-433, 445-448, 460-463 (0/1/2/3 presses for jack/hannah/mustapha/mess)
//   pick   "P1 Button 1"     held 480-483
//   stage 1 intro (plane, dialogue, the hero's scripted blast) runs by itself; control returns ~frame 1300.
// The control frame is found by experiment: two runs, one holding P1 Right through the intro, one idle;
// the first frame where the P1 world-X word (0xFFB27C) differs is the first frame the game obeys the stick.
// The state is saved two frames earlier, so a plan that loads it and holds a direction moves on its frame 0-2.
'use strict';
const fs = require('fs'), path = require('path');
const { runPlan, readFrames, REPO, STATES } = require('./run.cjs');

const HEROES = { jack: 0, hannah: 1, mustapha: 2, mess: 3 };
const P1_X = 0xFFB27C;       // P1 world X (observed: tracks the hero's sprite X one frame earlier; see README)
const COIN = 330, START = 370, RIGHT0 = 430, RIGHT_STEP = 15, PICK = 480, HOLD = 4;

function selectInputs(hero) {
  const inputs = [];
  for (let k = 0; k < HEROES[hero]; k++) inputs.push({ from: RIGHT0 + k * RIGHT_STEP, to: RIGHT0 + k * RIGHT_STEP + HOLD - 1, keys: ['P1 Right'] });
  inputs.push({ from: PICK, to: PICK + HOLD - 1, keys: ['P1 Button 1'] });
  return inputs;
}
const coinStart = { coin: COIN, start: START, hold: 6 };
const xOf = fr => parseInt(fr.ram['FFB270'].slice((P1_X - 0xFFB270) * 2, (P1_X - 0xFFB270) * 2 + 4), 16);

async function make(hero) {
  const base = { frames: 1500, coinStart, dump: { from: 1100, to: 1500, every: 1, obj: false, cpsA: false, ram: [[0xFFB270, 0x40]] } };
  const [held, idle] = await Promise.all([
    runPlan(Object.assign({}, base, { name: `mk-${hero}-held`, inputs: selectInputs(hero).concat([{ from: 1000, to: 1500, keys: ['P1 Right'] }]) })),
    runPlan(Object.assign({}, base, { name: `mk-${hero}-idle`, inputs: selectInputs(hero) })),
  ]);
  if (!held.ok || !idle.ok) throw new Error(`${hero}: probe runs failed`);
  const H = readFrames(`mk-${hero}-held`), I = readFrames(`mk-${hero}-idle`);
  let D = -1;
  for (let k = 0; k < H.length; k++) if (xOf(H[k]) !== xOf(I[k])) { D = H[k].f; break; }
  if (D < 0) throw new Error(`${hero}: P1 X never diverged; control frame not found`);
  const S = D - 2;
  const save = await runPlan({ name: `mk-${hero}-save`, frames: S + 1, coinStart, inputs: selectInputs(hero),
    saveStateAt: { frame: S, name: `stage1-${hero}` }, snapshots: [480, S], dump: { from: S, to: S, obj: true, cpsA: true, palette: true, ram: [[0xFFB270, 0x40]] } });
  if (!save.ok || !save.statesSaved[0].exists) throw new Error(`${hero}: save run failed`);
  // verify: load the state, hold right; P1 X must move within 3 frames, and stay put when idle
  const [vh, vi] = await Promise.all([
    runPlan({ name: `stage1-${hero}-verify-held`, frames: 40, loadState: `stage1-${hero}`, inputs: [{ from: 0, to: 40, keys: ['P1 Right'] }], snapshots: [0, 40], dump: { from: 0, to: 40, obj: false, cpsA: false, ram: [[0xFFB270, 0x40]] } }),
    runPlan({ name: `stage1-${hero}-verify-idle`, frames: 40, loadState: `stage1-${hero}`, snapshots: [0, 40], dump: { from: 0, to: 40, obj: false, cpsA: false, ram: [[0xFFB270, 0x40]] } }),
  ]);
  const VH = readFrames(`stage1-${hero}-verify-held`), VI = readFrames(`stage1-${hero}-verify-idle`);
  let firstMove = -1;
  for (let k = 0; k < VH.length; k++) if (xOf(VH[k]) !== xOf(VI[k])) { firstMove = VH[k].f; break; }
  const res = { hero, controlFrame: D, stateFrame: S, state: `stage1-${hero}`, file: `${STATES}/dino/stage1-${hero}.sta`.replace(/\\/g, '/'),
    resumesAtBootFrame: S + 1, p1xAtState: xOf(readFrames(`mk-${hero}-save`)[0]), verifyFirstMoveFrame: firstMove,
    verifyX: { held: [xOf(VH[0]), xOf(VH[VH.length - 1])], idle: [xOf(VI[0]), xOf(VI[VI.length - 1])] },
    snapshot: `work/re/runs/mk-${hero}-save/snap-f${String(S).padStart(6, '0')}.png`, inputs: selectInputs(hero), coinStart, ok: firstMove >= 0 && firstMove <= 3 };
  console.log(JSON.stringify(res));
  return res;
}

(async () => {
  const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(HEROES);
  const out = [];
  for (const h of which) { if (!(h in HEROES)) throw new Error('unknown hero ' + h); out.push(await make(h)); }
  const dir = path.join(REPO, 'work/re/harness');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'states.json');
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* first run */ }
  for (const r of out) prev[r.hero] = r;
  fs.writeFileSync(file, JSON.stringify(prev, null, 2));
  console.log('wrote', file);
})().catch(e => { console.error(e); process.exitCode = 1; });
