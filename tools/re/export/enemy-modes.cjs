// Static decode of the enemy behaviour-mode dispatch (+0x26 low byte) for the regular human enemies of the original
// Cadillacs & Dinosaurs. Research only; never shipped.
// Two code shapes are used (OBSERVED in the disassembly):
//   A  move.w ($26,A6),D0 ; andi.w #$FF,D0 ; move.w tbl(pc,D0.w),D0 ; jsr tbl(pc,D0.w)          (Chinpira, Hutori, ...)
//   B  moveq #0,D0 ; move.b ($27,A6),D0 ; move.w tbl(pc,D0.w),D1 ; jmp tbl(pc,D1.w)             (Mituryou, Knife Man, ...)
// tbl = signed word offsets relative to tbl, one per even mode value. The entry count is the number of words before
// the first target that lies after the table.
'use strict';
const R = require('../rom.cjs');
const hex = (v, n = 0) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');

function pcIndexTarget(a) {   // 'move.w d8(pc,Dn.w),Dm' at a: 0x303B/0x323B/... ext word -> pc = a + 2
  const op = R.u16(a); if ((op & 0xF1FF) !== 0x303B) return null;
  const ext = R.u16(a + 2); return a + 2 + ((ext & 0xFF) << 24 >> 24);
}
function tableEntries(tbl, max = 32) {
  const ents = []; let min = Infinity;
  for (let n = 0; n < max && tbl + 2 * n < min; n++) { const t = tbl + R.s16(tbl + 2 * n); ents.push(t); if (t > tbl) min = Math.min(min, t); }
  return ents;
}
// scan [start, end) for both shapes
function findModeTables(start, end) {
  const out = [];
  for (let a = start; a < end - 12; a += 2) {
    if (R.u16(a) === 0x302E && R.u16(a + 2) === 0x0026 && R.u16(a + 4) === 0x0240 && R.u16(a + 6) === 0x00FF) {
      const tbl = pcIndexTarget(a + 8); if (tbl) out.push({ shape: 'A', at: a, tbl, call: R.u16(a + 12) === 0x4EBB ? 'jsr' : 'jmp', entries: tableEntries(tbl) });
    }
    if (R.u16(a) === 0x102E && R.u16(a + 2) === 0x0027) {
      const tbl = pcIndexTarget(a + 4); if (tbl) out.push({ shape: 'B', at: a, tbl, call: R.u16(a + 8) === 0x4EBB ? 'jsr' : 'jmp', entries: tableEntries(tbl) });
    }
  }
  return out;
}
module.exports = { findModeTables, tableEntries, hex };
if (require.main === module) {
  const H = { chinpira: [0x3383A, 0x358B2], hutori: [0x3B828, 0x3DDEA], naguri: [0x5F5D0, 0x5FB80], mituryou: [0x3DDEA, 0x4020E], knifeman: [0x4020E, 0x42590], knifeonly: [0x5AA6E, 0x5AFC2], subayai: [0x457B0, 0x479FE],
    thurow: [0x5AFC2, 0x5B606], ishinage: [0x358B2, 0x36A64], kameleon: [0x39272, 0x3A234], richmond: [0x42590, 0x438F2], kingkimo: [0x36A64, 0x38DDE], tyrog2: [0x654E2, 0x67D2C], bike: [0x5C356, 0x5C6F0] };
  for (const [k, [s, e]] of Object.entries(H)) console.log(k, JSON.stringify(findModeTables(s, e).map(t => ({ ...t, at: hex(t.at), tbl: hex(t.tbl), entries: t.entries.map(x => hex(x)) }))));
}
