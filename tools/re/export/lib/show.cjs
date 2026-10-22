// print a hero's lists compactly: node tools/re/export/lib/show.cjs <heroId> [list]
const I = require('./ident.cjs');
const c = +process.argv[2], only = process.argv[3];
const h = I.all().heroes[c];
for (const l of h.lists) {
  if (only && l.key !== only) continue;
  console.log('==', h.name, l.key, l.set);
  for (const a of l.anims) {
    if (a.terminator) { console.log(a.index, 'END'); continue; }
    const fr = a.frames.map(f => (f.composite ? 'C[' + f.parts.map(p => p.rec + '@' + p.dx + ',' + p.dy).join(' ') + ']' : f.rec) + (f.rec2 != null ? '+' + f.rec2 : '') + '/' + f.dur + 'h' + (f.hold < 0 ? '-' : f.hold.toString(16)) + (f.b4 || f.b5 || f.b6 ? '[' + f.b4 + ',' + f.b5 + ',' + f.b6 + ']' : '') + (f.w8 !== '0x0' ? 'w' + f.w8.slice(2) : '') + (f.w10lo ? 'l' + f.w10lo.toString(16) : ''));
    console.log(a.index, a.addr, fr.join(' '), a.loopFrame != null ? 'loop' + a.loopFrame : a.loopTarget ? 'loop->' + JSON.stringify(a.loopTarget) : a.problem || '');
  }
}
