// node sheet.cjs out.png cols scale label1=img1[@x,y,w,h] label2=img2[@x,y,w,h] ...  -> labelled grid of crops
'use strict';
const fs = require('fs'), R = require('../rom.cjs');
const FONT = { // 3x5 digits/letters for labels
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111', '-': '000000111000000', '.': '000000000000010', ' ': '000000000000000', ':': '000010000010000', '+': '000010111010000', '/': '001001010100100', '=': '000111000111000',
};
const [out, colsS, scaleS, ...items] = process.argv.slice(2), cols = +colsS, S = +scaleS;
const cells = items.map(s => { const [label, rest] = s.split('='); const [file, rect] = rest.split('@'); const im = R.readPNG(fs.readFileSync(file)); const [x, y, w, h] = rect ? rect.split(',').map(Number) : [0, 0, im.w, im.h]; return { label, im, x, y, w, h }; });
const cw = Math.max(...cells.map(c => c.w)) * S, ch = Math.max(...cells.map(c => c.h)) * S + 14, rows = Math.ceil(cells.length / cols);
const W = cols * (cw + 4), H = rows * (ch + 4), o = new Uint8Array(W * H * 4).fill(40);
for (let i = 3; i < o.length; i += 4) o[i] = 255;
cells.forEach((c, k) => {
  const ox = (k % cols) * (cw + 4), oy = Math.floor(k / cols) * (ch + 4);
  for (let j = 0; j < c.h * S; j++) for (let i = 0; i < c.w * S; i++) { const sx = c.x + (i / S | 0), sy = c.y + (j / S | 0); if (sx >= c.im.w || sy >= c.im.h) continue; const q = (sy * c.im.w + sx) * 4, d = ((oy + 14 + j) * W + ox + i) * 4; o[d] = c.im.data[q]; o[d + 1] = c.im.data[q + 1]; o[d + 2] = c.im.data[q + 2]; }
  [...c.label.toUpperCase()].forEach((ch2, n) => { const g = FONT[ch2] || FONT[' ']; for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r * 3 + q] === '1') for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const d = ((oy + 2 + r * 2 + a) * W + ox + 2 + n * 8 + q * 2 + b) * 4; o[d] = 255; o[d + 1] = 255; o[d + 2] = 120; } });
});
R.writePNG(out, W, H, o);
console.log(out, W + 'x' + H);
