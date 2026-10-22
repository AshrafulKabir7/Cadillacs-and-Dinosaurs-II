#!/usr/bin/env node
// Tile a run's snapshots into one contact sheet (row-major, in frame order) with a tiny frame-number label.
//   node tools/re/mame/contact.cjs <runDir> [out.png] [--cols 8] [--scale 0.5] [--from F] [--to F]
'use strict';
const fs = require('fs'), path = require('path');
const { readPNG, writePNG } = require('../rom.cjs');

// 3x5 digit font
const DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
function label(rgba, W, x0, y0, text) {
  for (let i = 0; i < text.length; i++) {
    const g = DIG[+text[i]]; if (!g) continue;
    for (let y = -1; y < 6; y++) for (let x = -1; x < 4; x++) {
      const on = y >= 0 && y < 5 && x >= 0 && x < 3 && g[y * 3 + x] === '1';
      const q = ((y0 + y) * W + x0 + i * 4 + x) * 4; if (q < 0 || q >= rgba.length) continue;
      rgba[q] = rgba[q + 1] = on ? 255 : 0; rgba[q + 2] = on ? 0 : 0; rgba[q + 3] = 255;
    }
  }
}

function main() {
  const a = process.argv.slice(2), dir = a[0];
  const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? +a[i + 1] : d; };
  const cols = opt('--cols', 8), scale = opt('--scale', 0.5), from = opt('--from', 0), to = opt('--to', 1e9);
  const out = a[1] && !a[1].startsWith('--') ? a[1] : path.join(dir, 'contact.png');
  const files = fs.readdirSync(dir).filter(f => /^snap-f\d+\.png$/.test(f)).map(f => ({ f, n: +f.match(/\d+/)[0] })).filter(o => o.n >= from && o.n <= to).sort((p, q) => p.n - q.n);
  if (!files.length) throw new Error('no snapshots');
  const w = Math.round(384 * scale), h = Math.round(224 * scale), rows = Math.ceil(files.length / cols);
  const W = cols * (w + 2), H = rows * (h + 2), img = new Uint8Array(W * H * 4);
  files.forEach((o, k) => {
    const im = readPNG(fs.readFileSync(path.join(dir, o.f))), cx = (k % cols) * (w + 2), cy = Math.floor(k / cols) * (h + 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = Math.min(im.w - 1, Math.floor(x / scale)), sy = Math.min(im.h - 1, Math.floor(y / scale)), s = (sy * im.w + sx) * 4, d = ((cy + y) * W + cx + x) * 4;
      img[d] = im.data[s]; img[d + 1] = im.data[s + 1]; img[d + 2] = im.data[s + 2]; img[d + 3] = 255;
    }
    label(img, W, cx + 2, cy + 2, String(o.n));
  });
  writePNG(out, W, H, img);
  console.log(out, files.length, 'frames', W + 'x' + H);
}
main();
