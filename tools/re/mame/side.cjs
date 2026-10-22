#!/usr/bin/env node
// Put several PNGs side by side (same height assumed): node tools/re/mame/side.cjs out.png a.png b.png ...
'use strict';
const fs = require('fs'), { readPNG, writePNG } = require('../rom.cjs');
const [out, ...ins] = process.argv.slice(2);
const ims = ins.map(f => readPNG(fs.readFileSync(f)));
const W = ims.reduce((s, im) => s + im.w + 2, 0), H = Math.max(...ims.map(im => im.h)), o = new Uint8Array(W * H * 4);
let x0 = 0;
for (const im of ims) { for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) { const s = (y * im.w + x) * 4, d = (y * W + x0 + x) * 4; o[d] = im.data[s]; o[d + 1] = im.data[s + 1]; o[d + 2] = im.data[s + 2]; o[d + 3] = 255; } x0 += im.w + 2; }
writePNG(out, W, H, o);
