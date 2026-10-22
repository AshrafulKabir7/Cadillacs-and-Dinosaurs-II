// node crop.cjs in.png out.png x y w h [scale]   (nearest-neighbour upscale)
'use strict';
const fs = require('fs'), R = require('../rom.cjs');
const [inp, out, x, y, w, h, s] = process.argv.slice(2); const X = +x, Y = +y, W = +w, Hh = +h, S = +(s || 4);
const im = R.readPNG(fs.readFileSync(inp)), o = new Uint8Array(W * S * Hh * S * 4);
for (let j = 0; j < Hh * S; j++) for (let i = 0; i < W * S; i++) { const sx = X + (i / S | 0), sy = Y + (j / S | 0), q = (sy * im.w + sx) * 4, d = (j * W * S + i) * 4; for (let c = 0; c < 4; c++) o[d + c] = im.data[q + c]; }
R.writePNG(out, W * S, Hh * S, o);
