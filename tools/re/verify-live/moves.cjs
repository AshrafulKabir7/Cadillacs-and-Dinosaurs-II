// Summarise a moves run: P1 record/hold/state sequence, velocities, char id
const fs = require('fs'), path = require('path'), R = require('../rom.cjs');
const { RUNS } = require('./vl.cjs');
const u16 = a => R.prg.readUInt16BE(a);
const run = process.argv[2], from = +(process.argv[3] || 0), to = +(process.argv[4] || 339);
let last = '', out = [];
for (let f = from; f <= to; f++) {
  let r; try { r = fs.readFileSync(path.join(RUNS, run, `ram-f${String(f).padStart(6, '0')}.bin`)); } catch (e) { break; }
  const o = 0xB274, b = k => r[o + k], sw = k => r.readInt16BE(o + k), l = k => r.readUInt32BE(o + k);
  const fp = l(0x28), w0 = fp < R.prg.length ? u16(fp) : 0, w1 = fp < R.prg.length ? u16(fp + 2) : 0x8000;
  const recs = (w0 & 0x8000 ? 'C' : (w0 >> 2)) + (w1 & 0x8000 ? '' : '+' + (w1 >> 2));
  const legs = b(0x25) & 1 ? ' legs' + (u16(l(0x30)) >> 2) : '';
  const s = `rec ${recs}${legs} hold ${b(0x60).toString(16)} st ${b(4)}.${b(5)}.${b(6)}.${b(7).toString(16)} vx ${sw(0x14)} vz ${sw(0x16)} vy ${sw(0x18)} g ${sw(0x1C)}`;
  if (s !== last) { out.push(`f${f} x=${sw(8)} h=${sw(0xC)} d=${sw(0x10)} ${s}`); last = s; }
}
const r0 = fs.readFileSync(path.join(RUNS, run, `ram-f${String(from).padStart(6, '0')}.bin`));
console.log(run, 'char', r0[0xB274 + 3], '+0x20', r0.readUInt16BE(0xB274 + 0x20));
console.log(out.join('\n'));
