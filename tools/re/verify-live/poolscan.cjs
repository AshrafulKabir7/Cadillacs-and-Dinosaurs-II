// node poolscan.cjs <run> <frame,frame,...>  -> active pool A/B/C/D slots in that run's ram dumps
const { ramOf } = require('../runtime/rt.cjs');
const run = process.argv[2], frames = process.argv[3].split(',').map(Number);
const pools = { A: [0xFF8874, 24, 0xC0], B: [0xFFC8F4, 24, 0xE0], C: [0xFFB6F4, 24, 0xC0], D: [0xFF9A74, 48, 0x80], E: [0xFFDDF4, 16, 0x80], P: [0xFFB274, 3, 0x180] };
for (const f of frames) {
  const ram = ramOf(run, f), o = a => a - 0xFF0000;
  const out = [];
  for (const [k, [b, n, s]] of Object.entries(pools)) for (let i = 0; i < n; i++) {
    const a = b + i * s; if (!ram[o(a)]) continue;
    out.push(`${k}${i}@${a.toString(16)} a=${ram[o(a)]} st=${ram.readUInt32BE(o(a) + 4).toString(16)} t=${ram.readUInt16BE(o(a) + 0x20).toString(16)} st=${ram.readUInt16BE(o(a) + 0x26).toString(16)} x=${ram.readInt16BE(o(a) + 8)} h=${ram.readInt16BE(o(a) + 0xC)} d=${ram.readInt16BE(o(a) + 0x10)} fp=${ram.readUInt32BE(o(a) + 0x28).toString(16)} hp=${ram.readInt16BE(o(a) + 0x6C)}`);
  }
  console.log(`f${f} camX=${ram.readInt16BE(0x8744)} camY=${ram.readInt16BE(0x8748)} cnt=${ram.readUInt16BE(0xE7C0)}\n  ` + out.join('\n  '));
}
