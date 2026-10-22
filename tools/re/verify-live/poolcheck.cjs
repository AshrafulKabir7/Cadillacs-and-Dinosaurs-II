// Checks allocator/free/dispatch breakpoint logs of the vl-pools-* runs against the claimed pool layout.
const fs = require('fs'), path = require('path'), R = require('../rom.cjs');
const { RUNS } = require('./vl.cjs');
const POOLS = { A: [0xFF8874, 24, 0xC0, 0x233F0], B: [0xFFC8F4, 24, 0xE0, 0x2346C], C: [0xFFB6F4, 24, 0xC0, 0x2362E], D: [0xFF9A74, 48, 0x80, 0x237E6], E: [0xFFDDF4, 16, 0x80, null] };
const res = {};
for (const run of process.argv.slice(2)) {
  const L = fs.readFileSync(path.join(RUNS, run, 'debug-console.txt'), 'utf8').split(/\r?\n/);
  const r = { alloc: {}, free: {}, bad: [], dispatch: { ok: 0, bad: 0, wrongPool: 0 }, types: {}, callers: {} };
  for (const l of L) {
    const t = l.trim().split(/\s+/);
    if (t[0] === 'AL' || t[0] === 'FR') {
      const p = t[1], slot = parseInt(t[t[0] === 'AL' ? 3 : 3], 16) & 0xFFFFFF, [b, n, s] = POOLS[p];
      const ok = slot >= b && slot < b + n * s && (slot - b) % s === 0;
      const k = t[0] === 'AL' ? 'alloc' : 'free';
      r[k][p] = r[k][p] || { ok: 0, bad: 0 }; r[k][p][ok ? 'ok' : 'bad']++;
      if (!ok && r.bad.length < 10) r.bad.push(l);
      if (t[0] === 'AL') { const c = parseInt(t[4], 16).toString(16); r.callers[p + ':' + c] = (r.callers[p + ':' + c] || 0) + 1; }
    }
    if (t[0] === 'J') {
      const p = t[1], a6 = parseInt(t[2], 16) & 0xFFFFFF, type = parseInt(t[3], 16), a1 = parseInt(t[4], 16) & 0xFFFFFF, [b, n, s, tab] = POOLS[p];
      const inPool = a6 >= b && a6 < b + n * s && (a6 - b) % s === 0;
      const exp = R.prg.readUInt32BE(tab + type) & 0xFFFFFF;
      if (!inPool) r.dispatch.wrongPool++;
      if (exp === a1) r.dispatch.ok++; else r.dispatch.bad++;
      const k = p + ' 0x' + type.toString(16) + ' -> 0x' + a1.toString(16);
      r.types[k] = (r.types[k] || 0) + 1;
    }
  }
  res[run] = r;
}
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync(path.join(__dirname, '../../../work/re/verify-live/poolcheck.json'), JSON.stringify(res, null, 1));
