// node ramscan.cjs <run> [--from N --to N] [--maxChanges K] [--monotone] [--exclude pools] [--size 1|2]
// Lists RAM addresses whose value changes over a run's ram-f*.bin dumps, with change count and first/last values.
'use strict';
const fs = require('fs'), path = require('path');
const { ramOf, RUNS } = require('./rt.cjs');
const a = process.argv.slice(2), run = a[0];
const opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
const files = fs.readdirSync(path.join(RUNS, run)).filter(f => /^ram-f\d+\.bin$/.test(f)).map(f => +f.slice(5, 11)).sort((x, y) => x - y)
  .filter(f => f >= +(opt('from') || 0) && f <= +(opt('to') || 1e9));
const size = +(opt('size') || 2), maxC = +(opt('maxChanges') || 1e9), mono = a.includes('--monotone');
const POOLS = [[0xFFB274, 0x180 * 3], [0xFF8874, 0xC0 * 24], [0xFFC8F4, 0xE0 * 24], [0xFFB6F4, 0xC0 * 24], [0xFF9A74, 0x80 * 48], [0xFFDDF4, 0x80 * 16], [0xFFE7C0, 0x2000 - 0x7C0]];
const inPool = ad => POOLS.some(([b, l]) => ad >= b && ad < b + l);
const rams = files.map(f => ramOf(run, f));
const rd = (r, o) => size === 1 ? r[o] : r.readUInt16BE(o);
const out = [];
for (let o = 0; o < 0x10000; o += size) {
  const ad = 0xFF0000 + o;
  if (a.includes('--exclude') && inPool(ad)) continue;
  let ch = 0, up = true, prev = rd(rams[0], o); const at = [];
  for (let k = 1; k < rams.length; k++) { const v = rd(rams[k], o); if (v !== prev) { ch++; if (v < prev) up = false; if (at.length < 12) at.push(files[k] + ':' + v.toString(16)); prev = v; } }
  if (ch && ch <= maxC && (!mono || up)) out.push(`${ad.toString(16).toUpperCase()} changes=${ch} first=${rd(rams[0], o).toString(16)} last=${rd(rams[rams.length - 1], o).toString(16)} ${at.join(' ')}`);
}
console.log(out.join('\n')); console.error(out.length + ' addresses');
