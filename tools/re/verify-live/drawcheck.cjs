#!/usr/bin/env node
// Checks a drawrun.cjs run: rebuilds every OBJ list from the logged object fields with drawmodel.cjs and compares
// it, entry by entry and in order, with the OBJ buffer the builder wrote (read one game frame later, when the
// builder has finished and the other buffer is the one being rewritten).
//   node tools/re/verify-live/drawcheck.cjs <run> [--verbose]
'use strict';
const fs = require('fs'), path = require('path');
const { RUNS } = require('./vl.cjs');
const M = require('./drawmodel.cjs');

function parseConsole(run) {
  const lines = fs.readFileSync(path.join(RUNS, run, 'debug-console.txt'), 'utf8').split(/\r?\n/);
  const F = new Map();
  const get = fc => { if (!F.has(fc)) F.set(fc, { fc, D: [] }); return F.get(fc); };
  for (const l of lines) {
    const t = l.trim().split(/\s+/); if (t.length < 2) continue;
    const v = t.slice(1).map(x => parseInt(x, 16));
    const fr = () => get(v[0]);
    switch (t[0]) {
      case 'B': fr().B = v[1]; break;
      case 'X': fr().X = { d0: v[1], cam: v[2] }; break;
      case 'Y': fr().Y = { d0: v[1], cam: v[2], dc: v[3] }; break;
      case 'N': fr().N = v[1]; break;
      case 'E': fr().E = v[1]; break;
      case 'S': fr().S = v[1]; break;
      case 'D': fr().D.push({ d0: v[1], x: M.sx16(v[2]), h: M.sx16(v[3]), d: M.sx16(v[4]), face: v[5], fp: v[6], f25: v[7], f23: v[8], tdx: v[9], tdy: v[10], lp: v[11], f53: v[12], c4c: v[13] >> 8, c4d: v[13] & 0xFF, f04: v[14] >> 8, f05: v[14] & 0xFF, f2e: v[15], w0: v[16], w1: v[17] }); break;
    }
  }
  return F;
}
function parseHook(run) {
  const H = new Map();
  for (const l of fs.readFileSync(path.join(RUNS, run, 'hook.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    const j = JSON.parse(l); if (j.fc === undefined || !j.b0) continue;
    const dec = s => s.split(',').map(h => ({ x: parseInt(h.slice(0, 4), 16), y: parseInt(h.slice(4, 8), 16), code: parseInt(h.slice(8, 12), 16), attr: parseInt(h.slice(12, 16), 16) }));
    if (!H.has(j.fc)) H.set(j.fc, { n: j.n, b0: dec(j.b0), b1: dec(j.b1) });
  }
  return H;
}

function check(run, verbose) {
  const F = parseConsole(run), H = parseHook(run);
  const r = { run, frames: 0, exact: 0, entries: 0, entriesMatched: 0, endMarkerOk: 0, endMarkerBad: [], camX: { ok: 0, bad: [] }, camY: { ok: 0, bad: [], forcedZero: 0 },
    countMatchesN: 0, countBad: [], sortOk: 0, sortBad: [], depthWordOk: 0, depthWordBad: 0, a4Toggle: { ok: 0, bad: 0 },
    notes: { composite: 0, second: 0, split: 0, paletteOverride: 0, wading: 0, bit6: 0, pair: 0, uniformWide: 0 }, mismatches: [] };
  let prevB = null;
  for (const [fc, fr] of [...F.entries()].sort((a, b) => a[0] - b[0])) {
    if (fr.B === undefined || fr.E === undefined || !fr.X || !fr.Y) continue;
    if (prevB !== null) { if (fr.B !== prevB && (fr.B === 0x900000 || fr.B === 0x904000)) r.a4Toggle.ok++; else r.a4Toggle.bad++; }
    prevB = fr.B;
    // camera copies
    if (fr.X.d0 === ((fr.X.cam - 0x40) & 0xFFFF)) r.camX.ok++; else r.camX.bad.push({ fc, ...fr.X });
    const expY = fr.Y.dc ? 0 : fr.Y.cam;
    if (fr.Y.d0 === expY) { r.camY.ok++; if (fr.Y.dc) r.camY.forcedZero++; } else r.camY.bad.push({ fc, ...fr.Y });
    // registration count and sort order
    if (fr.N === fr.D.length) r.countMatchesN++; else r.countBad.push({ fc, N: fr.N, D: fr.D.length });
    let sorted = true;
    for (let k = 1; k < fr.D.length; k++) if ((fr.D[k].d0 >>> 0) < (fr.D[k - 1].d0 >>> 0)) sorted = false;
    if (sorted) r.sortOk++; else r.sortBad.push({ fc, d0: fr.D.map(o => o.d0.toString(16)) });
    for (const o of fr.D) { if ((o.d0 >>> 16) === (o.d & 0xFFFF)) r.depthWordOk++; else r.depthWordBad++; }
    // model
    const cam = { cx: M.sx16(fr.X.d0), cy: M.sx16(fr.Y.d0) };
    const pred = [], tags = [];
    let unmodelled = false;
    fr.D.forEach((o, k) => {
      let res; try { res = M.drawObject(o, cam); } catch (e) { if (!(e instanceof M.Unmodelled)) throw e; unmodelled = true; r.notes.unmodelled = (r.notes.unmodelled || 0) + 1; if (!r.unmodelledWhy) r.unmodelledWhy = []; if (r.unmodelledWhy.length < 5) r.unmodelledWhy.push({ fc, obj: (o.d0 & 0xFFFF).toString(16), fp: o.fp.toString(16), why: e.message }); return; }
      const { out, notes } = res;
      if (notes.ramFrame) r.notes.ramFrame = (r.notes.ramFrame || 0) + 1;
      if (notes.composite) r.notes.composite++;
      if (notes.second) r.notes.second++;
      if (notes.split) r.notes.split++;
      if (notes.bit6) { r.notes.bit6++; unmodelled = true; }
      if (notes.pair) { r.notes.pair++; unmodelled = true; }
      if (o.f23 & 0x80) r.notes.paletteOverride++;
      if (o.f53) r.notes.wading++;
      for (const e of out) { pred.push(e); tags.push({ k, obj: (o.d0 & 0xFFFF).toString(16), part: e.tag }); }
    });
    const h = H.get(fc + 1); if (!h) continue;
    const buf = fr.B === 0x900000 ? h.b0 : h.b1;
    const n = (fr.E - fr.B) / 8;
    const endE = buf[n];
    if (endE && endE.x === 0 && endE.y === 0x100 && endE.code === 0 && endE.attr === 0xFF00 && buf.length === n + 1) r.endMarkerOk++; else r.endMarkerBad.push({ fc, n, len: buf.length, end: endE });
    r.frames++;
    if (unmodelled) { r.unmodelledFrames = (r.unmodelledFrames || 0) + 1; }
    const nObj = fr.S !== undefined ? (fr.S - fr.B) / 8 : n;
    r.extraAfterObjects = (r.extraAfterObjects || 0) + (n - nObj);
    let ok = pred.length === nObj, matched = 0;
    for (let i = 0; i < Math.max(pred.length, nObj); i++) {
      const p = pred[i], b = buf[i];
      const same = p && b && i < nObj && ((p.x & 0x1FF) === (b.x & 0x1FF)) && ((p.y & 0x1FF) === (b.y & 0x1FF)) && p.code === b.code && p.attr === b.attr;
      if (same) matched++; else { ok = false; if (r.mismatches.length < 30) r.mismatches.push({ fc, i, pred: p && { x: p.x.toString(16), y: p.y.toString(16), code: p.code.toString(16), attr: p.attr.toString(16), ...tags[i] }, buf: b && i < nObj ? { x: b.x.toString(16), y: b.y.toString(16), code: b.code.toString(16), attr: b.attr.toString(16) } : null }); }
    }
    r.entries += nObj; r.entriesMatched += matched;
    if (ok) r.exact++;
    if (verbose && !ok) console.log('frame', fc.toString(16), 'pred', pred.length, 'buf', n, 'matched', matched);
  }
  return r;
}
if (require.main === module) {
  const a = process.argv.slice(2);
  for (const run of a.filter(x => !x.startsWith('--'))) {
    const r = check(run, a.includes('--verbose'));
    const s = JSON.stringify(r, (k, v) => (Array.isArray(v) && v.length > 6 ? v.slice(0, 6).concat([`...${v.length} total`]) : v), 1);
    console.log(s);
    fs.mkdirSync(path.join(__dirname, '../../../work/re/verify-live'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, `../../../work/re/verify-live/drawcheck-${run}.json`), JSON.stringify(r, null, 1));
  }
}
module.exports = { check, parseConsole, parseHook };
