// Contact sheet of ROM frame records with index labels and a feet-origin cross.
// node tools/re/sheet.cjs <from> <to> <out.png> [paletteSet] [cellW] [cellH] [cols] [scale]
const R = require('./rom.cjs');
const [from, to] = [+process.argv[2], +process.argv[3]], out = process.argv[4];
const set = +(process.argv[5] || 0), CW = +(process.argv[6] || 112), CH = +(process.argv[7] || 112), COLS = +(process.argv[8] || 10), S = +(process.argv[9] || 1);
const FONT = { '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111', '-': '000000111000000' };
const n = to - from + 1, rows = Math.ceil(n / COLS), W = CW * COLS * S, H = CH * rows * S, img = new Uint8Array(W * H * 4);
for (let q = 0; q < W * H; q++) { img[q * 4] = 40; img[q * 4 + 1] = 44; img[q * 4 + 2] = 52; img[q * 4 + 3] = 255; }
const put = (x, y, c) => { for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) { const X = x * S + a, Y = y * S + b; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const q = (Y * W + X) * 4; img[q] = c[0]; img[q + 1] = c[1]; img[q + 2] = c[2]; } };
const text = (s, x, y, c) => { [...s].forEach((ch, k) => { const f = FONT[ch]; if (!f) return; for (let i = 0; i < 15; i++) if (f[i] === '1') put(x + k * 4 + (i % 3), y + Math.floor(i / 3), c); }); };
for (let i = from; i <= to; i++) {
  const k = i - from, cx = (k % COLS) * CW, cy = Math.floor(k / COLS) * CH;
  for (let x = 0; x < CW; x++) put(cx + x, cy, [70, 74, 84]); for (let y = 0; y < CH; y++) put(cx, cy + y, [70, 74, 84]);
  text(String(i), cx + 2, cy + 2, [255, 255, 120]);
  let im = null; try { im = R.recordRGBA(i, set, { dropShadows: false }); } catch (e) { }
  const fx = cx + Math.floor(CW / 2), fy = cy + CH - 12;
  if (im) for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const q = (y * im.w + x) * 4; if (!im.rgba[q + 3]) continue;
    const X = fx - im.ox + x, Y = fy - im.oy + y; if (X <= cx || Y <= cy + 8 || X >= cx + CW || Y >= cy + CH) continue;
    put(X, Y, [im.rgba[q], im.rgba[q + 1], im.rgba[q + 2]]);
  }
  for (let d = -3; d <= 3; d++) { put(fx + d, fy, [255, 0, 255]); put(fx, fy + d, [255, 0, 255]); }
}
R.writePNG(out, W, H, img);
console.log('wrote', out, W + 'x' + H);
