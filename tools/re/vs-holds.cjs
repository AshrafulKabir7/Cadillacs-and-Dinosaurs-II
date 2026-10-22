// verify-static: independent recompute of held-weapon placement tables (0x122230 offsets, 0x120A20 pose bytes)
const R = require('./rom.cjs');
const { decodeSet } = require('./vs-anim.cjs');
const sets = { 0: 0x268bc, 1: 0x265f4, 3: 0x26a3c, 4: 0x26bbc, 5: 0x26d3c, 7: 0x26f7e, 8: 0x270fe };
const ch = +(process.argv[2] || 1);
const offT = R.u32(0x122230 + ch * 4), poseT = R.u32(0x120a20 + ch * 4);
console.log('char', ch, 'offTable', offT.toString(16), 'poseTable', poseT.toString(16));
for (const [hold, slot] of (process.argv[3] || '52:1,58:7,56:4,64:3').split(',').map(s => s.split(':').map(Number))) {
  const dx = R.s16(offT + hold * 4), dy = R.s16(offT + hold * 4 + 2);
  const pp = R.u32(poseT + slot * 4), anim = R.prg.readInt8(pp + hold);
  let rec = null, bbox = null;
  if (anim >= 0 && sets[slot]) {
    const s = decodeSet(sets[slot], 10, anim + 1); rec = s[anim].frames[0].rec;
    const im = R.render(R.parseRecord(rec)); bbox = im ? [-im.ox, -im.oy, im.w, im.h] : null;
  }
  console.log({ hold: hold.toString(16), slot, dx, dy, posePtr: pp.toString(16), anim, rec, recTopLeftFromOrigin: bbox });
}
