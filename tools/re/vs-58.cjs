// verify-static: collect immediate writes to obj+0x58 (attack index) from the linear disassembly
const fs = require('fs');
const L = fs.readFileSync('E:/mostafa/Cadillacs-and-Dinosaurs-II/work/re/static/full.dis', 'utf8').split('\n');
const lim = parseInt(process.argv[2] || '10000', 16), vals = {};
const re = /^([0-9a-f]{6}): .*move\.b\s+#\$([0-9a-f]+), \(\$58,A([0-6])\)/;
for (const l of L) { const m = l.match(re); if (m) { const a = parseInt(m[1], 16), v = parseInt(m[2], 16); if (a < lim) (vals[v] = vals[v] || []).push(m[1]); } }
const ks = Object.keys(vals).map(Number).sort((a, b) => a - b);
console.log(ks.map(v => v.toString(16) + ':' + vals[v].length).join(' '));
console.log('odd:', ks.filter(v => v % 2).map(v => v.toString(16) + '@' + vals[v].join(',')));
console.log('>=0x78:', ks.filter(v => v >= 0x78).map(v => v.toString(16) + '@' + vals[v].join(',')));
