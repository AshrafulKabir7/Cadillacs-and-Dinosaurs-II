// Decodes the HUD name tables used by 0x17D2E (main table base 0x17D78, alternate 0x17D70 when +4 == 2)
const R = require('../rom.cjs'); const p = R.prg;
const str = a => { let s = "" ; for (let i = 1; i < 14; i++) { const c = p[a + i]; if (c === 0x40 || c === 0) break; s += String.fromCharCode(c); } return s.trim(); };
const out = { main: [], alt: [] };
for (let idx = 0; idx < 0x24; idx++) { const off = p.readUInt16BE(0x17D78 + idx * 2); out.main.push({ idx: '0x' + idx.toString(16), at: '0x' + (0x17D78 + off).toString(16), name: str(0x17D78 + off) }); }
for (let idx = 0; idx < 4; idx++) { const off = p.readUInt16BE(0x17D70 + idx * 2); out.alt.push({ idx, at: '0x' + (0x17D70 + off).toString(16), name: str(0x17D70 + off) }); }
console.log(JSON.stringify(out, null, 0));
module.exports = out;
