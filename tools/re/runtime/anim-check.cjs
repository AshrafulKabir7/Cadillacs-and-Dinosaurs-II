// Checks the animation driver fields on per-frame RAM dumps: +0x28 frame pointer, +0x2C..+0x2E frame bytes 4..6,
// +0x2F frames left on the current animation frame. node anim-check.cjs <run> [slotHex]
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../rom.cjs');
const { ramOf, RUNS } = require('./rt.cjs');
function check(run, a = 0xFFB274) {
  const fr = fs.readdirSync(path.join(RUNS, run)).filter(f => /^ram-f/.test(f)).map(f => +f.slice(5, 11)).sort((x, y) => x - y);
  const o = a - 0xFF0000; let paused = 0, steps = 0, adv = 0, advOk = 0, holdOk = 0, holds = 0, bytesOk = 0, bytesN = 0; const bad = [];
  for (let k = 1; k < fr.length; k++) {
    if (fr[k] !== fr[k - 1] + 1) continue;
    const p = ramOf(run, fr[k - 1]), c = ramOf(run, fr[k]);
    const fp0 = p.readUInt32BE(o + 0x28), fp1 = c.readUInt32BE(o + 0x28), d0 = p[o + 0x2F], d1 = c[o + 0x2F];
    if (!fp1 || fp1 >= R.prg.length) continue;
    steps++;
    // frame bytes copied from ROM frame (+4..+6 -> +0x2C..+0x2E, +7 & 0x7f -> +0x2F on entry)
    bytesN++; if (c[o + 0x2C] === R.prg[fp1 + 4] && c[o + 0x2D] === R.prg[fp1 + 5] && c[o + 0x2E] === R.prg[fp1 + 6]) bytesOk++;
    if (fp1 !== fp0) { adv++; const dur = R.prg[fp1 + 7] & 0x7f; if (d1 === dur || d1 === dur - 1) advOk++; else if (bad.length < 5) bad.push({ f: fr[k], fp0: fp0.toString(16), fp1: fp1.toString(16), d0, d1, romDur: R.prg[fp1 + 7] }); }
    else { holds++; if (d1 === d0) paused++; if (d1 === d0 - 1 || d0 === 0) holdOk++; else if (d1 !== d0 && bad.length < 10) bad.push({ f: fr[k], hold: true, d0, d1 }); }
  }
  return { run, slot: '0x' + a.toString(16).toUpperCase(), steps, frameBytesMatchRom: `${bytesOk}/${bytesN}`, advances: adv, advanceSetsDuration: advOk, holds, holdDecrementsBy1: holdOk, holdUnchanged: paused, bad };
}
if (require.main === module) console.log(JSON.stringify(check(process.argv[2], process.argv[3] ? parseInt(process.argv[3], 16) : 0xFFB274)));
module.exports = { check };
