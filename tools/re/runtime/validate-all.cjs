#!/usr/bin/env node
// Re-checks the runtime memory map against every run that has per-frame RAM + OBJ dumps and writes
// work/re/runtime/validation.json.  node tools/re/runtime/validate-all.cjs
// Test: for each frame f, read the actor from RAM(f-1) (X +0x08, height +0x0C, depth +0x10, facing +0x24, frame
// pointer +0x28 -> ROM record, camera 0xFF8744/0xFF8748) and require every on-screen block of the predicted record to be
// present in OBJ(f) with the same tile code, size, flip and screen position (tools/re/runtime/predict.cjs).
'use strict';
const fs = require('fs'), path = require('path');
const P = require('./predict.cjs');
const { RUNS } = require('./rt.cjs');
const OUT = path.resolve(__dirname, '../../../work/re/runtime/validation.json');
const everyFrame = name => { try { const s = JSON.parse(fs.readFileSync(path.join(RUNS, name, 'plan.json'), 'utf8')); return s.dump && s.dump.ramFile && (s.dump.every || 1) === 1 && s.dump.obj !== false; } catch (e) { return false; } };
const runs = fs.readdirSync(RUNS).filter(n => /^(rt-|chk-)/.test(n) && everyFrame(n)).sort();
const res = { method: 'RAM(f-1) -> predicted OBJ blocks -> must all be present in OBJ(f); off-screen blocks excluded (the game culls them)', player1: {}, poolB: {}, poolA: {}, totals: {} };
let pf = 0, pp = 0; const bt = {};
for (const run of runs) {
  const v = P.validate(run, 0xFFB274);
  res.player1[run] = { frames: v.frames, pass: v.pass, records: Object.keys(v.records).length, fails: v.fails.slice(0, 3) };
  pf += v.frames; pp += v.pass;
  const b = P.validatePool(run, 0xFFC8F4, 24, 0xE0);
  res.poolB[run] = Object.fromEntries(Object.entries(b).map(([t, x]) => [t, { frames: x.frames, pass: x.pass, absent: x.absent, partial: x.partial, records: x.records.length, hpMax: x.hp }]));
  for (const [t, x] of Object.entries(b)) { bt[t] = bt[t] || { frames: 0, pass: 0, absent: 0, partial: 0 }; bt[t].frames += x.frames; bt[t].pass += x.pass; bt[t].absent += x.absent; bt[t].partial += x.partial; }
  const a = P.validatePool(run, 0xFF8874, 24, 0xC0);
  res.poolA[run] = Object.fromEntries(Object.entries(a).map(([t, x]) => [t, { frames: x.frames, pass: x.pass, records: x.records }]));
}
res.totals = { runs: runs.length, player1: { frames: pf, pass: pp }, poolBByType: bt };
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res.totals, null, 1));
for (const [r, v] of Object.entries(res.player1)) if (v.pass !== v.frames) console.log('P1 mismatch', r, JSON.stringify(v));
