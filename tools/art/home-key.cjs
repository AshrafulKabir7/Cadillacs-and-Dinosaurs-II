#!/usr/bin/env node
// tools/art/home-key.cjs - turns the generated home page art (work/home-art, tools/art/gen-home.cjs) into the shipped
// WebP files in assets/home. The heroes are painted on flat #FF00FF: that magenta is keyed out (soft edge) and its spill
// pulled out of the edge pixels, so the cut-out stands over the title without a pink rim. Needs ffmpeg with libwebp.
//
//   node tools/art/home-key.cjs
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..'), SRC = path.join(ROOT, 'work', 'home-art'), OUT = path.join(ROOT, 'assets', 'home');
const ff = (args, input) => cp.execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { input, maxBuffer: 1 << 28 });
const size = f => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

function webp(src, out, w, q, extra = []) { ff(['-i', src, ...extra, '-vf', `scale=${w}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6', out]); }

function keyed(src, out, w, q) {
  const [W, H] = size(src), px = ff(['-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2], m = Math.min(r, b) - g;   // magenta-ness: red and blue above green
    const a = m >= 150 ? 0 : m <= 70 ? 1 : 1 - (m - 70) / 80;
    if (m > 0 && a > 0) { const k = Math.min(m, 255) * (a < 1 ? 1 : .6); px[i] = Math.max(g, r - k); px[i + 2] = Math.max(g, b - k); }
    px[i + 3] = Math.round(px[i + 3] * a);
  }
  ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-', '-vf', `scale=${w}:-2:flags=lanczos`, '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', String(q), '-compression_level', '6', out], px);
}

const jobs = [
  ['key-bg.png', 'kv-bg.webp', 1536, 60, false],
  ['key-heroes.png', 'kv-heroes.webp', 1536, 70, true],
  ['slide-road.png', 'kv-road.webp', 1536, 72, false],
  ['slide-dam.png', 'kv-dam.webp', 1536, 72, false],
  ['slide-wild.png', 'kv-wild.webp', 1536, 72, false],
];
for (const [src, out, w, q, key] of jobs) {
  const s = path.join(SRC, src), o = path.join(OUT, out); if (!fs.existsSync(s)) { console.log(`missing ${src}`); continue; }
  (key ? keyed : webp)(s, o, w, q); console.log(`${out}  ${(fs.statSync(o).size / 1024).toFixed(0)} KB`);
}
// the round avatar in the top bar: Mustapha's face from the heroes art (crop in source pixels)
const hs = path.join(SRC, 'key-heroes.png');
if (fs.existsSync(hs)) { ff(['-i', hs, '-vf', 'crop=230:230:925:270,scale=96:96:flags=lanczos', '-c:v', 'libwebp', '-quality', '82', path.join(OUT, 'kv-face.webp')]); console.log('kv-face.webp'); }
