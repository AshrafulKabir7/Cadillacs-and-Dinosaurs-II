#!/usr/bin/env node
// Build extra MAME save states with the validated cheats (E:/tools/mame/states/dino/<name>.sta).
//   node tools/re/runtime/make-runtime-states.cjs armed  [heroes...]   -> stage1-<hero>-armed-<weapon>  (15 weapons)
//   node tools/re/runtime/make-runtime-states.cjs stages [heroes...]   -> stage<N>-<hero> for N = 2..8
// armed: load stage1-<hero>, give the weapon (cheat "give", default ammo), save at plan frame 40 (hero idle, holding it).
//        Each state is re-loaded and checked: P1+0xB4 points at a pool-A object whose +0x26 is the weapon subtype.
// stages: boot with the "warp" cheat and the select recipe, then the make-states method: one run holding P1 Right
//        from boot frame 700, one idle; the first frame where P1 X (0xFFB27C) differs is when control starts; a third
//        (idle) run saves two frames earlier. Results -> work/re/runtime/states.json.
'use strict';
const fs = require('fs'), path = require('path');
const { runPlan, ramOf, readFrames, RUNS } = require('./rt.cjs');
const { WEAPONS } = require('./cheats.cjs');
const OUT = path.resolve(__dirname, '../../../work/re/runtime/states.json');
const HEROES = { jack: 0, hannah: 1, mustapha: 2, mess: 3 };
const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const save = () => fs.writeFileSync(OUT, JSON.stringify(db, null, 1));

async function pool(tasks, n = 6) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } })); return out; }

async function armed(heroes) {
  const tasks = [];
  for (const h of heroes) for (const w of Object.keys(WEAPONS)) tasks.push(async () => {
    const name = `stage1-${h}-armed-${w}`;
    const s = await runPlan({ name: 'mk-' + name, frames: 42, loadState: `stage1-${h}`, cheats: [{ cheat: 'give', weapon: w, at: 2 }], saveStateAt: { frame: 40, name }, snapshots: [40] });
    const c = await runPlan({ name: 'chk-' + name, frames: 3, loadState: name, dump: { from: 0, to: 2, every: 1, obj: false, cpsA: false, ramFile: true }, snapshots: [1] });
    const r = ramOf('chk-' + name, 1), held = r.readUInt16BE(0xB274 + 0xB4), sub = held ? r.readUInt16BE(held + 0x26) : null, ammo = held ? r.readInt16BE(held + 0x6C) : null;
    const ok = s.ok && c.ok && held !== 0 && sub === WEAPONS[w];
    db[name] = { kind: 'armed', hero: h, weapon: w, subtype: WEAPONS[w], savedAtPlanFrame: 40, from: `stage1-${h}`, heldObject: held ? '0xFF' + held.toString(16).toUpperCase() : null, class: held ? '0x' + r.readUInt16BE(held + 0xA0).toString(16) : null, ammo, ok, check: `work/re/runs/chk-${name}/snap-f000001.png` };
    console.log(name, ok ? 'OK' : 'FAIL', JSON.stringify(db[name]));
  });
  await pool(tasks); save();
}

function selectInputs(hero) {
  const inputs = [];
  for (let k = 0; k < HEROES[hero]; k++) inputs.push({ from: 430 + k * 15, to: 433 + k * 15, keys: ['P1 Right'] });
  inputs.push({ from: 480, to: 483, keys: ['P1 Button 1'] });
  return inputs;
}
async function stages(heroes) {
  const tasks = [];
  for (const h of heroes) for (let N = 2; N <= 8; N++) tasks.push(async () => {
    const base = { frames: 4200, coinStart: true, cheats: [{ cheat: 'warp', stage: N }], dump: { from: 600, to: 4199, every: 1, obj: false, cpsA: false, ram: [['0xFFB27C', 2], ['0xFF84D0', 0x10]] } };
    const [held, idle] = await Promise.all([
      runPlan(Object.assign({}, base, { name: `mk-s${N}-${h}-held`, inputs: selectInputs(h).concat([{ from: 700, to: 4199, keys: ['P1 Right'] }]) })),
      runPlan(Object.assign({}, base, { name: `mk-s${N}-${h}-idle`, inputs: selectInputs(h) })),
    ]);
    const H = readFrames(`mk-s${N}-${h}-held`), I = readFrames(`mk-s${N}-${h}-idle`);
    let D = -1;
    for (let k = 0; k < Math.min(H.length, I.length); k++) {
      const hs = H[k].ram['FF84D0'], is = I[k].ram['FF84D0'];
      if (hs.slice(0, 2) !== '0C' || is.slice(0, 2) !== '0C') continue;          // gameplay state only
      if (H[k].ram['FFB27C'] !== I[k].ram['FFB27C']) { D = H[k].f; break; }
    }
    const name = `stage${N}-${h}`;
    if (D < 0) { db[name] = { kind: 'stage', hero: h, stage: N, ok: false, error: 'no control divergence before 4200' }; console.log(name, 'FAIL no divergence'); return; }
    const s = await runPlan({ name: 'mk-' + name, frames: D, coinStart: true, inputs: selectInputs(h), cheats: [{ cheat: 'warp', stage: N }], saveStateAt: { frame: D - 2, name }, snapshots: [D - 2] });
    const v = await runPlan({ name: 'chk-' + name, frames: 40, loadState: name, inputs: [{ from: 0, to: 39, keys: ['P1 Right'] }], dump: { from: 0, to: 39, every: 1, obj: false, cpsA: false, ram: [['0xFFB27C', 2], ['0xFF84D9', 1], ['0xFF8786', 1]] }, snapshots: [0, 39] });
    const F = readFrames('chk-' + name), x0 = parseInt(F[0].ram['FFB27C'], 16), x1 = parseInt(F[F.length - 1].ram['FFB27C'], 16), stageByte = parseInt(F[0].ram['FF84D9'], 16);
    db[name] = { kind: 'stage', hero: h, stage: N, stageByte, area: parseInt(F[0].ram['FF8786'], 16), controlFromBootFrame: D, savedAtBootFrame: D - 2, p1xAtLoad: x0, p1xAfter40HeldRight: x1, ok: s.ok && v.ok && stageByte === N - 1 && x1 !== x0, snapshot: `work/re/runs/mk-${name}/snap-f${String(D - 2).padStart(6, '0')}.png` };
    console.log(name, db[name].ok ? 'OK' : 'FAIL', JSON.stringify(db[name]));
  });
  await pool(tasks, 6); save();
}

(async () => {
  const [mode, ...hs] = process.argv.slice(2), heroes = hs.length ? hs : Object.keys(HEROES);
  if (mode === 'armed') await armed(heroes); else if (mode === 'stages') await stages(heroes);
  else { console.error('usage: make-runtime-states.cjs armed|stages [heroes]'); process.exitCode = 2; }
})();
