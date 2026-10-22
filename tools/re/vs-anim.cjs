// verify-static: decode an animation set (signed word-offset table) independently of the other agents' tools.
// usage: node vs-anim.cjs <setAddrHex> <frameSize 8|10|12> [maxAnims]
const R = require('./rom.cjs');
function decodeSet(base, fs, maxAnims = 64, maxFrames = 40) {
  const offs = []; let minOff = 1e9;
  for (let k = 0; k < maxAnims; k++) {
    if (base + k * 2 >= minOff + base) break;
    const o = R.s16(base + k * 2); offs.push(o); if (o > 0) minOff = Math.min(minOff, o);
  }
  return offs.map((o, k) => {
    let p = base + o, frames = [];
    for (let f = 0; f < maxFrames; f++) {
      const w0 = R.u16(p), w1 = R.u16(p + 2), b = [R.prg[p + 4], R.prg[p + 5], R.prg[p + 6]], d = R.prg[p + 7];
      const fr = { at: p.toString(16), rec: w0 & 0x8000 ? 'C' + ((w0 & 0x7fff) >> 2) : w0 >> 2, rec2: w1 & 0x8000 ? -1 : w1 >> 2, b, dur: d & 0x7f, last: !!(d & 0x80) };
      if (fs >= 10) fr.w8 = R.u16(p + 8).toString(16);
      if (fs >= 12) fr.w10 = R.u16(p + 10).toString(16);
      if (w0 & 3) fr.warnNotMul4 = true;
      frames.push(fr); p += fs;
      if (d & 0x80) { fr.loop = R.s16(p); break; }
    }
    return { anim: k, off: o, frames };
  });
}
module.exports = { decodeSet };
if (require.main === module) {
  const base = parseInt(process.argv[2], 16), fs = +process.argv[3], n = +(process.argv[4] || 64);
  for (const a of decodeSet(base, fs, n)) console.log(a.anim, a.off, a.frames.map(f => `${f.rec}${f.rec2 >= 0 ? '+' + f.rec2 : ''}${f.w10 ? ' h' + f.w10 : ''}/${f.dur}${f.warnNotMul4 ? '!' : ''}`).join(' '));
}
