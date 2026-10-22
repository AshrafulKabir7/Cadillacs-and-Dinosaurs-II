#!/usr/bin/env node
// Live check of the animation-frame claims on every RAM dump of the given runs:
//   12-byte hero frames (P1): +0x2C..+0x2E = frame bytes 4..6, +0x48 = word 8, +0x60 = word 10, +0x2F <= byte7 & 0x7F
//   10-byte frames (held weapon, pool B enemies): same, without +0x60
//   +0x4C (long) = ROM long at 0x11D220 + (w1 >= 0 ? w1 : w0 & 0x7FFF)   (non-split objects)
//   split body: +0x3C/+0x3E = s16 pair at +0x38 + 4 * (signed byte 5 of the legs frame)
//   frame advance: new fp - old fp = frame size, or a jump taken after a frame whose byte 7 has bit 7 set
//   node tools/re/verify-live/animcheck.cjs <run...>
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../rom.cjs');
const { RUNS } = require('./vl.cjs');
const u8 = a => R.prg[a], u16 = a => R.prg.readUInt16BE(a), s16 = a => R.prg.readInt16BE(a), u32 = a => R.prg.readUInt32BE(a);
const inRom = a => a > 0 && a + 12 <= R.prg.length;

function checkObj(r, a, size, stats, prev) {
  const o = a - 0xFF0000, b = k => r[o + k], w = k => r.readUInt16BE(o + k), l = k => r.readUInt32BE(o + k);
  if (!b(0)) return null;
  const fp = l(0x28); if (!inRom(fp)) return null;
  const S = stats;
  const bytesOk = b(0x2C) === u8(fp + 4) && b(0x2D) === u8(fp + 5) && b(0x2E) === u8(fp + 6);
  S.bytes[bytesOk ? 0 : 1]++;
  S.w8[w(0x48) === u16(fp + 8) ? 0 : 1]++;
  if (size === 12) S.w10[w(0x60) === u16(fp + 10) ? 0 : 1]++;
  S.dur[b(0x2F) <= (u8(fp + 7) & 0x7F) ? 0 : 1]++;
  const split = b(0x25) & 1;
  if (!split) {
    const w0 = u16(fp), w1 = u16(fp + 2);
    const idx = size === 12 ? (w1 & 0x8000 ? w0 : w1) : (w0 & 0x8000 ? w0 & 0x7FFF : (w1 & 0x8000 ? w0 : w1));
    const ok = l(0x4C) === u32(0x11D220 + idx);
    S.c4c[ok ? 0 : 1]++;
    if (!ok && S.c4cBad.length < 5) S.c4cBad.push({ a: a.toString(16), fp: fp.toString(16), got: l(0x4C).toString(16), exp: u32(0x11D220 + idx).toString(16) });
  } else {
    const lp = l(0x30);
    if (inRom(lp) && l(0x38)) {
      const bi = (u8(lp + 5) << 24) >> 24, t = l(0x38) + bi * 4;
      const ok = r.readInt16BE(o + 0x3C) === s16(t) && r.readInt16BE(o + 0x3E) === s16(t + 2);
      S.bob[ok ? 0 : 1]++;
      if (!ok && S.bobBad.length < 5) S.bobBad.push({ lp: lp.toString(16), bi, got: [r.readInt16BE(o + 0x3C), r.readInt16BE(o + 0x3E)], exp: [s16(t), s16(t + 2)] });
    }
  }
  if (prev && prev.fp !== fp && inRom(prev.fp)) {
    const d = fp - prev.fp;
    if (d === size) S.adv.step++;
    else if (u8(prev.fp + 7) & 0x80) {
      const tgt = prev.fp + size + s16(prev.fp + size);
      if (tgt === fp) S.adv.loop++; else S.adv.other++;
    } else S.adv.other++;
    if (prev.fp + size === fp || (u8(prev.fp + 7) & 0x80)) { S.durReset[b(0x2F) === (u8(fp + 7) & 0x7F) || b(0x2F) === (u8(fp + 7) & 0x7F) - 1 ? 0 : 1]++; }
  }
  return { fp };
}

function run(name) {
  const dir = path.join(RUNS, name);
  const files = fs.readdirSync(dir).filter(f => /^ram-f\d+\.bin$/.test(f)).sort();
  const mk = () => ({ bytes: [0, 0], w8: [0, 0], w10: [0, 0], dur: [0, 0], c4c: [0, 0], c4cBad: [], bob: [0, 0], bobBad: [], adv: { step: 0, loop: 0, other: 0 }, durReset: [0, 0] });
  const S = { hero: mk(), weapon: mk(), enemy: mk() };
  let prevH = null, prevW = null; const prevE = {};
  for (const f of files) {
    const r = fs.readFileSync(path.join(dir, f));
    prevH = checkObj(r, 0xFFB274, 12, S.hero, prevH) || prevH;
    const ws = r.readUInt16BE(0xB274 + 0xB4);
    if (ws) prevW = checkObj(r, 0xFF0000 | ws, 10, S.weapon, prevW) || prevW;
    for (let k = 0; k < 24; k++) { const a = 0xFFC8F4 + k * 0xE0; prevE[k] = checkObj(r, a, 10, S.enemy, prevE[k]) || prevE[k]; }
  }
  return { run: name, frames: files.length, ...S };
}
if (require.main === module) {
  const tot = {};
  for (const n of process.argv.slice(2)) {
    const r = run(n);
    for (const k of ['hero', 'weapon', 'enemy']) {
      tot[k] = tot[k] || { bytes: [0, 0], w8: [0, 0], w10: [0, 0], dur: [0, 0], c4c: [0, 0], bob: [0, 0], adv: { step: 0, loop: 0, other: 0 }, durReset: [0, 0], c4cBad: [], bobBad: [] };
      for (const f of ['bytes', 'w8', 'w10', 'dur', 'c4c', 'bob', 'durReset']) { tot[k][f][0] += r[k][f][0]; tot[k][f][1] += r[k][f][1]; }
      for (const f of ['step', 'loop', 'other']) tot[k].adv[f] += r[k].adv[f];
      if (tot[k].c4cBad.length < 5) tot[k].c4cBad.push(...r[k].c4cBad.slice(0, 2).map(x => ({ run: n, ...x })));
      if (tot[k].bobBad.length < 5) tot[k].bobBad.push(...r[k].bobBad.slice(0, 2).map(x => ({ run: n, ...x })));
    }
  }
  console.log(JSON.stringify(tot, null, 1));
  fs.writeFileSync(path.join(__dirname, '../../../work/re/verify-live/animcheck.json'), JSON.stringify({ runs: process.argv.slice(2), totals: tot }, null, 1));
}
module.exports = { run };
