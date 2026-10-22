#!/usr/bin/env node
// Validate the harness OBJ decode against MAME's own snapshots.
//   node tools/re/mame/validate-obj.cjs <runName> [frame ...] [--out work/re/harness/validate] [--nosprites <runName2>]
// --nosprites: a replay of the same plan with a poke {from: f, rel:'obj', addr:6, size:2, value:0xFF00} for every
// snapshot frame f (it empties the OBJ list MAME copies for snapshot f); the snapshot differences then give the true
// visible-sprite mask for a recall score (example: examples/stage1-jack-walk-nosprites.json).
// The run must have dump {obj, palette} on frames f-2..f+2 and snapshots on the listed frames.
// For each snapshot frame it renders the dumped OBJ list (rom.cjs tiles + dumped palettes) onto 384x224, compares the
// opaque sprite pixels with the snapshot, scans the dump lag (-2..+2) and the screen origin (dx, dy), and writes
// overlay PNGs. It also groups OBJ entries per palette and matches them back to ROM frame records.
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../rom.cjs');
const { readFrames, RUNS, REPO } = require('./run.cjs');
const O = require('./obj.cjs');

const args = process.argv.slice(2), name = args[0];
const oi = args.indexOf('--out'), outDir = path.resolve(REPO, oi >= 0 ? args[oi + 1] : 'work/re/harness/validate');
fs.mkdirSync(outDir, { recursive: true });
const frames = readFrames(name), byF = new Map(frames.map(f => [f.f, f]));
const ni = args.indexOf('--nosprites'), noSpr = ni >= 0 ? args[ni + 1] : null;
let snapFrames = args.slice(1).filter((a, i) => !a.startsWith('--') && args[i] !== '--out' && args[i] !== '--nosprites').map(Number);
if (!snapFrames.length) snapFrames = fs.readdirSync(path.join(RUNS, name)).filter(f => /^snap-f\d+\.png$/.test(f)).map(f => +f.match(/\d+/)[0]);

const report = { run: name, frames: [] };
for (const f of snapFrames) {
  const snap = R.readPNG(fs.readFileSync(path.join(RUNS, name, `snap-f${String(f).padStart(6, '0')}.png`)));
  const pals = O.framePalettes(byF.get(f));
  const lags = [];
  for (let lag = -2; lag <= 2; lag++) {
    const fr = byF.get(f + lag); if (!fr) continue;
    lags.push({ lag, ...O.compare(O.renderObj(fr, { pals }), snap) });
  }
  const best = lags.reduce((a, b) => (b.agreement > a.agreement || (b.agreement === a.agreement && Math.abs(b.lag + 1) < Math.abs(a.lag + 1)) ? b : a)); // ties -> lag -1
  const fr = byF.get(f + best.lag);
  // origin scan around (64, 16)
  let origin = { dx: -64, dy: -16, agreement: -1 };
  for (let dx = -72; dx <= -56; dx++) for (let dy = -24; dy <= -8; dy++) {
    const c = O.compare(O.renderObj(fr, { pals, dx, dy }), snap);
    if (c.agreement > origin.agreement) origin = { dx, dy, agreement: c.agreement };
  }
  // palette source check: dumped palette of the same frame vs of the OBJ frame
  const palOther = O.compare(O.renderObj(fr, { pals: O.framePalettes(fr) }), snap);
  // overlay: snapshot dimmed, mismatching sprite pixels red, matching sprite pixels shown in their colour
  const rnd = O.renderObj(fr, { pals }), ov = new Uint8Array(O.W * O.H * 4);
  for (let q = 0; q < O.W * O.H; q++) {
    const s = q * 4, opaque = rnd.rgba[s + 3] === 255;
    const same = opaque && rnd.rgba[s] === snap.data[s] && rnd.rgba[s + 1] === snap.data[s + 1] && rnd.rgba[s + 2] === snap.data[s + 2];
    if (!opaque) { ov[s] = snap.data[s] >> 2; ov[s + 1] = snap.data[s + 1] >> 2; ov[s + 2] = snap.data[s + 2] >> 2; }
    else if (same) { ov[s] = rnd.rgba[s]; ov[s + 1] = rnd.rgba[s + 1]; ov[s + 2] = rnd.rgba[s + 2]; }
    else { ov[s] = 255; ov[s + 1] = 0; ov[s + 2] = 255; }
    ov[s + 3] = 255;
  }
  R.writePNG(path.join(outDir, `${name}-f${f}-overlay.png`), O.W, O.H, ov);
  R.writePNG(path.join(outDir, `${name}-f${f}-render.png`), O.W, O.H, rnd.rgba);
  // per-palette groups -> ROM records
  const groups = new Map();
  for (const o of fr.obj) { if (!groups.has(o.pal)) groups.set(o.pal, []); groups.get(o.pal).push(o); }
  const recs = [];
  for (const [pal, es] of groups) {
    if (pal > 3) continue; // heroes are palettes 0-3; other palettes mix several actors
    const m = O.matchRecords(es).slice(0, 3);
    recs.push({ pal, entries: es.map(o => ({ code: '0x' + o.code.toString(16), attr: '0x' + o.attr.toString(16), sx: o.sx, sy: o.sy })), best: m });
  }
  // recall against the sprite-free replay: visible sprite pixels = pixels that differ between the two snapshots
  let recall = null;
  if (noSpr) {
    const bg = R.readPNG(fs.readFileSync(path.join(RUNS, noSpr, `snap-f${String(f).padStart(6, '0')}.png`)));
    let visible = 0, covered = 0, occluded = 0, ours = 0;
    for (let q = 0; q < O.W * O.H; q++) {
      const s4 = q * 4, vis = snap.data[s4] !== bg.data[s4] || snap.data[s4 + 1] !== bg.data[s4 + 1] || snap.data[s4 + 2] !== bg.data[s4 + 2];
      const op = rnd.rgba[s4 + 3] === 255, same = op && rnd.rgba[s4] === snap.data[s4] && rnd.rgba[s4 + 1] === snap.data[s4 + 1] && rnd.rgba[s4 + 2] === snap.data[s4 + 2];
      if (vis) { visible++; if (same) covered++; }
      if (op) { ours++; if (!same && !vis) occluded++; }
    }
    recall = { visibleSpritePixels: visible, reproduced: covered, recall: +(covered / Math.max(1, visible)).toFixed(4), ourOpaque: ours, oursHiddenByLayers: occluded };
  }
  const row = { frame: f, recall, objCount: fr.objCount, lagScan: lags, bestLag: best.lag, agreement: +best.agreement.toFixed(4), opaquePixels: best.opaque,
    originScan: origin, paletteFromObjFrame: +palOther.agreement.toFixed(4), heroRecords: recs };
  report.frames.push(row);
  console.log(`frame ${f}: best lag ${best.lag} agreement ${(best.agreement * 100).toFixed(2)}% of ${best.opaque} px;${recall ? ` recall ${(recall.recall * 100).toFixed(2)}% of ${recall.visibleSpritePixels} visible sprite px (${recall.oursHiddenByLayers} of ours hidden by tilemaps);` : ''} lags ${lags.map(l => l.lag + ':' + (l.agreement * 100).toFixed(1)).join(' ')}; origin best dx=${origin.dx} dy=${origin.dy}`);
  for (const r of recs) console.log(`   pal ${r.pal}: ${r.entries.length} entries -> ${r.best.map(m => `rec ${m.record} ${m.hit}/${m.of}${m.exact ? ' EXACT' : ''} feet(${m.feetX},${m.feetY}) mirror=${m.flipX}`).join(' | ')}`);
}
fs.writeFileSync(path.join(outDir, `${name}-report.json`), JSON.stringify(report, null, 2));
console.log('report', path.join(outDir, `${name}-report.json`));
