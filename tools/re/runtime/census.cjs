// Enemy census: run stage-start states with the invuln cheat and a walk/attack bot, log every pool-B object type seen,
// with the ROM records it was drawn with, HP values and subtypes. Writes work/re/runtime/enemy-census.json.
//   node tools/re/runtime/census.cjs [stateNames...]   (default: stage1-jack, stage2-jack .. stage8-jack)
'use strict';
const fs = require('fs'), path = require('path');
const { runPlan, readFrames } = require('./rt.cjs');
const R = require('../rom.cjs');
const types = require('../../../work/re/static/object-types.json');
const OUT = path.resolve(__dirname, '../../../work/re/runtime/enemy-census.json');
const nameOf = {};
for (const s of types.spawn) if (s.pool === 'B') (nameOf[s.type.toLowerCase()] = nameOf[s.type.toLowerCase()] || []).push(`${s.name}${s.subtype0x26 !== '0x0' ? ' (sub ' + s.subtype0x26 + ')' : ''}`);
const POOLB = 0xFFC8F4, N = 24, STRIDE = 0xE0;
function frameRec(ptr) { if (!ptr || ptr >= R.prg.length) return null; const w0 = R.u16(ptr); return w0 & 0x8000 ? null : w0 >> 2; }

(async () => {
  const states = process.argv.slice(2).length ? process.argv.slice(2) : ['stage1-jack', ...[2, 3, 4, 5, 6, 7, 8].map(n => `stage${n}-jack`)];
  const inputs = []; for (let c = 10; c < 3600; c += 60) { inputs.push({ from: c, to: c + 39, keys: ['right'] }); for (let k = 40; k < 60; k += 6) inputs.push({ from: c + k, to: c + k + 1, keys: ['attack'] }); }
  const runs = await Promise.all(states.map(st => runPlan({ name: `census-${st}`, frames: 3600, loadState: st, inputs, cheats: [{ cheat: 'invuln' }],
    pokes: [{ from: 0, to: 3600, addr: '0xFF84E8', size: 2, value: '0x0300' }],
    dump: { from: 0, to: 3599, every: 6, obj: false, cpsA: false, ram: [['0xFFC8F4', N * STRIDE], ['0xFF84D9', 1], ['0xFF8786', 1]] }, snapshotEvery: { from: 0, to: 3599, every: 300 } })));
  const out = { note: 'pool B (0xFFC8F4, 24 x 0xE0) objects seen at run time; type = obj+0x20, sub = obj+0x26, records from the frame pointer obj+0x28 (word0/4)', byState: {}, byType: {} };
  for (const st of states) {
    const seen = {};
    for (const f of readFrames(`census-${st}`)) {
      const hex = f.ram['FFC8F4'], area = parseInt(f.ram['FF8786'], 16);
      const buf = Buffer.from(hex, 'hex');
      for (let k = 0; k < N; k++) {
        const o = k * STRIDE; if (!buf[o]) continue;
        const type = '0x' + buf.readUInt16BE(o + 0x20).toString(16), sub = '0x' + buf.readUInt16BE(o + 0x26).toString(16), rec = frameRec(buf.readUInt32BE(o + 0x28));
        const t = seen[type] || (seen[type] = { type, names: nameOf[type] || [], subs: new Set(), hpMax: new Set(), records: new Set(), areas: new Set(), firstFrame: f.f, b3: new Set() });
        t.subs.add(sub); t.hpMax.add(buf.readInt16BE(o + 0x6A)); if (rec != null) t.records.add(rec); t.areas.add(area); t.b3.add(buf[o + 3]);
      }
    }
    out.byState[st] = Object.values(seen).map(t => ({ type: t.type, names: t.names, subtypes: [...t.subs], variant03: [...t.b3], hpMax: [...t.hpMax], areas: [...t.areas], firstFrame: t.firstFrame,
      recordRange: t.records.size ? [Math.min(...t.records), Math.max(...t.records)] : null, records: [...t.records].sort((a, b) => a - b).slice(0, 80) }));
    for (const t of out.byState[st]) { const g = out.byType[t.type] || (out.byType[t.type] = { names: t.names, stages: [], hpMax: new Set(), subtypes: new Set() }); g.stages.push(st); t.hpMax.forEach(h => g.hpMax.add(h)); t.subtypes.forEach(s => g.subtypes.add(s)); }
  }
  for (const g of Object.values(out.byType)) { g.hpMax = [...g.hpMax]; g.subtypes = [...g.subtypes]; }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  for (const [t, g] of Object.entries(out.byType).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) console.log(t.padEnd(6), (g.names.join('/') || '-').slice(0, 60).padEnd(60), 'hpMax', g.hpMax.join(','), 'subs', g.subtypes.join(','), 'in', g.stages.join(','));
  console.log('runs ok:', runs.map(r => r.name + ':' + r.ok).join(' '));
})();
