// node structdiff.cjs <run> <baseHex> <len> [from to step] [--bytes]
// Prints the words (or bytes) of a struct that change across a run's full-RAM dumps.
'use strict';
const fs = require('fs'), path = require('path');
const { ramOf, RUNS } = require('./rt.cjs');
const a = process.argv.slice(2);
const run = a[0], base = parseInt(a[1], 16), len = parseInt(a[2], 16);
const files = fs.readdirSync(path.join(RUNS, run)).filter(f => /^ram-f\d+\.bin$/.test(f)).map(f => +f.slice(5, 11)).sort((x, y) => x - y);
const from = a[3] ? +a[3] : files[0], to = a[4] ? +a[4] : files[files.length - 1], step = a[5] ? +a[5] : 1;
const bytes = a.includes('--bytes');
const fr = files.filter(f => f >= from && f <= to && (f - from) % step === 0);
const rams = fr.map(f => ramOf(run, f));
const off = base - 0xFF0000, sz = bytes ? 1 : 2;
const cols = [];
for (let o = 0; o < len; o += sz) {
  const vals = rams.map(r => bytes ? r[off + o] : r.readUInt16BE(off + o));
  if (vals.some(v => v !== vals[0])) cols.push({ o, vals });
}
console.log('frame ' + cols.map(c => ('+' + c.o.toString(16)).padStart(sz * 2 + 1)).join(' '));
fr.forEach((f, k) => console.log(String(f).padStart(5) + ' ' + cols.map(c => c.vals[k].toString(16).padStart(sz * 2 + 1)).join(' ')));
