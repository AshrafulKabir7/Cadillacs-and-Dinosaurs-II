// node pool.cjs <run> <frame> [pool]   -> lists active slots of a pool at a frame of a run (needs ramFile dumps)
'use strict';
const { ramOf } = require('./rt.cjs');
const R = require('../rom.cjs');
const POOLS = {
  P: { base: 0xFFB274, n: 3, stride: 0x180 }, A: { base: 0xFF8874, n: 24, stride: 0xC0 }, B: { base: 0xFFC8F4, n: 24, stride: 0xE0 },
  C: { base: 0xFFB6F4, n: 24, stride: 0xC0 }, D: { base: 0xFF9A74, n: 48, stride: 0x80 }, E: { base: 0xFFDDF4, n: 16, stride: 0x80 },
};
// record index drawn from an animation frame pointer (draw code 0x14230: word0 >= 0 -> record = word0/4)
function frameRecord(ptr) {
  if (!ptr || ptr >= R.prg.length) return null;
  const w0 = R.u16(ptr), w1 = R.u16(ptr + 2);
  return { rec: w0 & 0x8000 ? null : w0 >> 2, rec2: w1 & 0x8000 ? null : w1 >> 2, w0, w1 };
}
function slot(r, a) {
  const o = a - 0xFF0000, b = k => r[o + k], w = k => r.readUInt16BE(o + k), sw = k => r.readInt16BE(o + k), l = k => r.readUInt32BE(o + k);
  const fp = l(0x28), fr = frameRecord(fp);
  return { addr: a.toString(16).toUpperCase(), active: b(0), vis: b(1), b2: b(2), b3: b(3), state: [b(4), b(5), b(6), b(7)].map(x => x.toString(16)).join('.'),
    x: sw(8), z: sw(0xC), y: sw(0x10), type: '0x' + w(0x20).toString(16), b22: b(0x22), b23: b(0x23), face: b(0x24), b25: b(0x25), sub: '0x' + w(0x26).toString(16),
    fp: '0x' + fp.toString(16), rec: fr && fr.rec, rec2: fr && fr.rec2, legs: (b(0x25) & 1) ? (frameRecord(l(0x30)) || {}).rec : undefined,
    hpMax: sw(0x6A), hp: sw(0x6C), hpDisp: sw(0x6E), a0: '0x' + w(0xA0).toString(16) };
}
function list(r, pool) { const P = POOLS[pool], out = []; for (let k = 0; k < P.n; k++) { const a = P.base + k * P.stride; if (r[a - 0xFF0000]) out.push(Object.assign({ slot: k }, slot(r, a))); } return out; }
if (require.main === module) {
  const [run, f, pool] = process.argv.slice(2);
  for (const p of pool ? [pool] : Object.keys(POOLS)) { const l = list(ramOf(run, +f), p); console.log(`pool ${p}: ${l.length} active`); for (const s of l) console.log(' ' + JSON.stringify(s)); }
}
module.exports = { POOLS, slot, list, frameRecord };
