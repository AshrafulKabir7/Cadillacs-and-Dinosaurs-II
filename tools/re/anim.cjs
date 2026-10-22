// Decode original animation sets (word-offset table -> frame sequences).
// Frame layouts (from the animation driver at 0x120E..0x16F8):
//   size 10: w0 rec*4 (bit15 => composite, w1 = rel. offset to part list), w1 2nd rec*4 (<0 none), b4 b5 b6, b7 = dur | 0x80 end, w8 -> obj+0x48
//   size 12: same + w10 -> obj+0x60 (hero hold index in its high byte)
// After a frame whose b7 has bit 7 set, the next word is a signed loop offset (relative to that word).
const R = require('./rom.cjs');
function decodeSet(T, size = 10, maxAnims = 400) {
  const first = R.u16(T); const n = Math.min(first >> 1, maxAnims); const anims = [];
  for (let k = 0; k < n; k++) {
    const off = R.s16(T + k * 2); const start = T + off; const frames = []; let a = start, guard = 0, loopTo = null;
    while (guard++ < 64 && a > 0 && a + size <= R.prg.length) {
      const w0 = R.u16(a), w1 = R.u16(a + 2), b4 = R.prg[a + 4], b5 = R.prg[a + 5], b6 = R.prg[a + 6], b7 = R.prg[a + 7], w8 = R.u16(a + 8);
      const f = { addr: a, rec: w0 & 0x8000 ? null : w0 >> 2, comp: !!(w0 & 0x8000), hitRec: (w0 & 0x7fff) >> 2, rec2: (w1 & 0x8000) || (w0 & 0x8000) ? null : w1 >> 2, b4, b5, b6, dur: b7 & 0x7f, end: !!(b7 & 0x80), w8 };
      if (w0 & 0x8000) f.partsAt = a + 2 + R.s16(a + 2);
      if (size >= 12) f.w10 = R.u16(a + 10);
      frames.push(f); a += size;
      if (b7 & 0x80) { const lo = R.s16(a); loopTo = a + lo; break; }
    }
    anims.push({ index: k, addr: start, frames, loopTo });
  }
  return anims;
}
function decodeParts(addr) { // composite part list: count-1, then (dx, dy, rec*4, attr?) per part
  const n = R.u16(addr) + 1, parts = []; let a = addr + 2;
  for (let k = 0; k < n && k < 32; k++) { parts.push({ dx: R.s16(a), dy: R.s16(a + 2), rec: R.u16(a + 4) >> 2, w: R.u16(a + 6) }); a += 8; }
  return parts;
}
module.exports = { decodeSet, decodeParts };
if (require.main === module) {
  const T = parseInt(process.argv[2], 16), size = +(process.argv[3] || 10);
  for (const an of decodeSet(T, size)) console.log(an.index, an.addr.toString(16), an.frames.map(f => (f.comp ? 'C' + f.hitRec : f.rec) + (f.rec2 != null ? '+' + f.rec2 : '') + '/' + f.dur + (size >= 12 ? '[' + f.w8.toString(16) + ',' + f.w10.toString(16) + ']' : '')).join(' '), an.loopTo ? 'loop->' + an.loopTo.toString(16) : '');
}
