// verify-static: scan frame records for header attr widths in non-bit15 records
const R = require('./rom.cjs');
let n15 = 0, nU = 0, wide = [], hist = {};
for (let i = 0; i < 0xDB9; i++) {
  const a = R.u32(0xD0CF4 + i * 4) & 0xFFFFFF; if (!a || a >= R.prg.length) continue;
  const fl = R.u16(a + 4);
  if (fl & 0x8000) { n15++; continue; }
  nU++; const w = ((fl >> 8) & 15); hist[fl & 0xFFE0] = (hist[fl & 0xFFE0] || 0) + 1; if (w) wide.push([i, fl.toString(16)]);
}
console.log({ n15, nU, wideCount: wide.length, wideFirst: wide.slice(0, 20), hist });
