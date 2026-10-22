// Dump readable text runs from the program ROM (the game stores English text as ASCII with '@' / control bytes as separators).
// node tools/re/text.cjs [from] [to] [minLen] > work/re/text.txt
const R = require('./rom.cjs');
const p = R.prg;
const from = parseInt(process.argv[2] || '0', 16), to = parseInt(process.argv[3] || p.length.toString(16), 16), min = +(process.argv[4] || 4);
let s = '', start = 0; const out = [];
for (let i = from; i < to; i++) {
  const c = p[i];
  if ((c >= 32 && c < 127) || c === 10) { if (!s) start = i; s += c === 10 ? '\\n' : String.fromCharCode(c); }
  else { if (s.replace(/[^A-Za-z]/g, '').length >= min) out.push(start.toString(16).padStart(6, '0') + ': ' + s); s = ''; }
}
console.log(out.join('\n'));
