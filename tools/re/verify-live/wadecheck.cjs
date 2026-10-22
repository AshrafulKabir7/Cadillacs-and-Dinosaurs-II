// Wading check: predicted entries must appear in order (subsequence) in the OBJ buffer; extra entries are listed
// (the code at 0x1439C/0x1463E calls 0x14BC6 before drawing the clipped record).
const { parseConsole, parseHook } = require('./drawcheck.cjs');
const M = require('./drawmodel.cjs');
const run = process.argv[2];
const F = parseConsole(run), H = parseHook(run);
let frames = 0, subseq = 0, extraTot = 0, wadeFrames = 0, dropped = [];
const extras = {};
for (const [fc, fr] of [...F.entries()].sort((a, b) => a[0] - b[0])) {
  const h = H.get(fc + 1); if (!h || fr.S === undefined) continue;
  const cam = { cx: M.sx16(fr.X.d0), cy: M.sx16(fr.Y.d0) };
  const pred = []; let wade = null;
  for (const o of fr.D) {
    const { out } = M.drawObject(o, cam);
    if ((o.d0 & 0xFFFF) === 0xB274 && o.f53) {
      const full = M.drawObject({ ...o, f53: 0 }, cam).out.length;
      wade = { h: o.h, c4c: o.c4c, c4d: o.c4d, full, drawn: out.length };
    }
    pred.push(...out);
  }
  const buf = (fr.B === 0x900000 ? h.b0 : h.b1).slice(0, (fr.S - fr.B) / 8);
  let j = 0; const extra = [];
  for (const b of buf) {
    const p = pred[j];
    if (p && (p.x & 0x1FF) === (b.x & 0x1FF) && (p.y & 0x1FF) === (b.y & 0x1FF) && p.code === b.code && p.attr === b.attr) j++;
    else extra.push(b.code.toString(16) + '/' + b.attr.toString(16));
  }
  frames++; if (j === pred.length) subseq++;
  extraTot += extra.length; for (const e of extra) extras[e] = (extras[e] || 0) + 1;
  if (wade) { wadeFrames++; if (dropped.length < 12 || wade.full !== wade.drawn) dropped.push({ fc, ...wade, extra: extra.length }); }
}
console.log(JSON.stringify({ run, frames, predIsSubsequence: subseq, extraEntries: extraTot, extraKinds: extras, wadeFrames, samples: dropped.slice(0, 40) }, null, 0));
