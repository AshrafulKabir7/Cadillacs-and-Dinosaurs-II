// Tiny RGBA canvas for contact sheets and atlases: blit ROM records, 5x7 text, markers, PNG output.
'use strict';
const R = require('../../rom.cjs');

const F = { // 5x7 glyphs, rows top->bottom, 5 bits each (MSB = left)
  'A': [14, 17, 17, 31, 17, 17, 17], 'B': [30, 17, 17, 30, 17, 17, 30], 'C': [14, 17, 16, 16, 16, 17, 14], 'D': [30, 17, 17, 17, 17, 17, 30],
  'E': [31, 16, 16, 30, 16, 16, 31], 'F': [31, 16, 16, 30, 16, 16, 16], 'G': [14, 17, 16, 23, 17, 17, 15], 'H': [17, 17, 17, 31, 17, 17, 17],
  'I': [14, 4, 4, 4, 4, 4, 14], 'J': [7, 2, 2, 2, 2, 18, 12], 'K': [17, 18, 20, 24, 20, 18, 17], 'L': [16, 16, 16, 16, 16, 16, 31],
  'M': [17, 27, 21, 21, 17, 17, 17], 'N': [17, 17, 25, 21, 19, 17, 17], 'O': [14, 17, 17, 17, 17, 17, 14], 'P': [30, 17, 17, 30, 16, 16, 16],
  'Q': [14, 17, 17, 17, 21, 18, 13], 'R': [30, 17, 17, 30, 20, 18, 17], 'S': [15, 16, 16, 14, 1, 1, 30], 'T': [31, 4, 4, 4, 4, 4, 4],
  'U': [17, 17, 17, 17, 17, 17, 14], 'V': [17, 17, 17, 17, 17, 10, 4], 'W': [17, 17, 17, 21, 21, 21, 10], 'X': [17, 17, 10, 4, 10, 17, 17],
  'Y': [17, 17, 10, 4, 4, 4, 4], 'Z': [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8], ':': [0, 12, 12, 0, 12, 12, 0], '-': [0, 0, 0, 31, 0, 0, 0],
  '+': [0, 4, 4, 31, 4, 4, 0], '/': [1, 1, 2, 4, 8, 16, 16], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], '=': [0, 0, 31, 0, 31, 0, 0],
  '>': [8, 4, 2, 1, 2, 4, 8], '<': [2, 4, 8, 16, 8, 4, 2], '#': [10, 10, 31, 10, 31, 10, 10], '_': [0, 0, 0, 0, 0, 0, 31], '%': [24, 25, 2, 4, 8, 19, 3],
  '?': [14, 17, 1, 2, 4, 0, 4], '!': [4, 4, 4, 4, 4, 0, 4], "'": [4, 4, 8, 0, 0, 0, 0], '[': [14, 8, 8, 8, 8, 8, 14], ']': [14, 2, 2, 2, 2, 2, 14], '*': [0, 4, 21, 14, 21, 4, 0], '|': [4, 4, 4, 4, 4, 4, 4], '@': [14, 17, 23, 21, 23, 16, 14], '&': [12, 18, 20, 8, 21, 18, 13],
};

class Canvas {
  constructor(w, h, bg = [0, 0, 0, 0]) { this.w = w; this.h = h; this.px = new Uint8Array(w * h * 4); if (bg[3]) this.fill(0, 0, w, h, bg); }
  set(x, y, c) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const q = (y * this.w + x) * 4; this.px[q] = c[0]; this.px[q + 1] = c[1]; this.px[q + 2] = c[2]; this.px[q + 3] = c[3] == null ? 255 : c[3]; }
  fill(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c); }
  rect(x, y, w, h, c) { for (let i = x; i < x + w; i++) { this.set(i, y, c); this.set(i, y + h - 1, c); } for (let j = y; j < y + h; j++) { this.set(x, j, c); this.set(x + w - 1, j, c); } }
  text(s, x, y, c = [255, 255, 255], scale = 1) {
    let cx = x;
    for (const ch of String(s).toUpperCase()) {
      const g = F[ch] || F['?'];
      for (let r = 0; r < 7; r++) for (let b = 0; b < 5; b++) if (g[r] & (16 >> b)) for (let a = 0; a < scale; a++) for (let d = 0; d < scale; d++) this.set(cx + b * scale + a, y + r * scale + d, c);
      cx += 6 * scale;
    }
    return cx;
  }
  cross(x, y, c = [255, 0, 255], r = 3) { for (let d = -r; d <= r; d++) { this.set(x + d, y, c); this.set(x, y + d, c); } }
  // blit an RGBA image {w,h,rgba} with its top-left at (x, y); mirror = flip horizontally
  blit(im, x, y, { mirror = false, clip = null } = {}) {
    for (let j = 0; j < im.h; j++) for (let i = 0; i < im.w; i++) {
      const q = (j * im.w + i) * 4; if (!im.rgba[q + 3]) continue;
      const X = x + (mirror ? im.w - 1 - i : i), Y = y + j;
      if (clip && (X < clip[0] || Y < clip[1] || X >= clip[0] + clip[2] || Y >= clip[1] + clip[3])) continue;
      this.set(X, Y, [im.rgba[q], im.rgba[q + 1], im.rgba[q + 2], 255]);
    }
  }
  // draw ROM record `rec` with its feet origin at (fx, fy); facing right mirrors around the origin (V05)
  record(rec, fx, fy, { mirror = false, clip = null, pal = null, remap = null } = {}) {
    const im = recImg(rec, pal, remap); if (!im) return null;
    const x = mirror ? fx - (im.w - im.ox) : fx - im.ox;
    this.blit(im, x, fy - im.oy, { mirror, clip });
    return im;
  }
  png(file) { R.writePNG(file, this.w, this.h, this.px); }
}
// Record -> RGBA with the ROM palettes at full brightness (palette set 0 at 0xB7A52, n*17 per channel = MAME's
// formula at brightness F). Blocks are painted so that block 0 ends on top, as on the CPS-1 (earlier OBJ entries win),
// and uniform-attribute records take their palette from the record's flags word (what 0x14294 writes).
const cache = new Map();
let PAL = null;
// remap = { tag, rows: {slot: [[r,g,b] x16]} }: draw the blocks of those OBJ slots with other palette rows (stage areas)
function recImg(rec, palOverride = null, remap = null) {
  const k = rec + ':' + palOverride + ':' + (remap ? remap.tag : ''); if (cache.has(k)) return cache.get(k);
  const M = require('./model.cjs');
  const blocks = M.recBlocks(rec); let im = null;
  if (blocks.length) {
    PAL = PAL || R.paletteSet(0);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const b of blocks) { x0 = Math.min(x0, b.lx); y0 = Math.min(y0, b.ly); x1 = Math.max(x1, b.lx + 16 * b.bw); y1 = Math.max(y1, b.ly + 16 * b.bh); }
    const w = x1 - x0, h = y1 - y0, rgba = new Uint8Array(w * h * 4), pen = new Int16Array(w * h).fill(-1);
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i], fx = !!(b.attr & 0x20), fy = !!(b.attr & 0x40), pal = palOverride != null ? palOverride : b.attr & 31;
      for (let r = 0; r < b.bh; r++) for (let c = 0; c < b.bw; c++) {
        const col = fx ? b.bw - 1 - c : c, row = fy ? b.bh - 1 - r : r;
        const t = R.tile((b.code & ~0xF) + ((b.code + col) & 0xF) + 0x10 * row);
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const p = t[(fy ? 15 - y : y) * 16 + (fx ? 15 - x : x)]; if (p === 15) continue;
          const X = b.lx - x0 + c * 16 + x, Y = b.ly - y0 + r * 16 + y, q = Y * w + X, col3 = remap && remap.rows[pal] ? remap.rows[pal][p] : PAL[pal][p];
          rgba[q * 4] = col3[0]; rgba[q * 4 + 1] = col3[1]; rgba[q * 4 + 2] = col3[2]; rgba[q * 4 + 3] = 255; pen[q] = pal * 16 + p;
        }
      }
    }
    im = { w, h, ox: -x0, oy: -y0, rgba, pen };
  }
  cache.set(k, im); return im;
}
// tight box of the opaque pixels of a record image, relative to its origin
function tightBox(im) {
  let a = 1e9, b = 1e9, c = -1, d = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.rgba[(y * im.w + x) * 4 + 3]) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  if (c < 0) return null;
  return { x: a - im.ox, y: b - im.oy, w: c - a + 1, h: d - b + 1 };
}
const textWidth = (s, scale = 1) => String(s).length * 6 * scale;
module.exports = { Canvas, recImg, tightBox, textWidth };
