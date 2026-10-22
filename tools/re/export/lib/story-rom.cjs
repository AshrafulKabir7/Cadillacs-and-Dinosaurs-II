// Story text of the original Cadillacs & Dinosaurs (MAME "dino", World set): ROM decoders.
// Research tooling only; nothing here ships with the game.
//
// Text formats (OBSERVED in the printers, see tools/re/export/story-rea.sh for the REA records):
//   word blocks  : header {col byte, row byte, attr word}, then one word per character; 0x2F2F = new header follows,
//                  0x4040 = end. Printed to scroll1 at 0x90A000 + col*0x80 + row*4.
//                    0x84F72  English 8x16 printer (char c -> tile c over c+0x10, one column per char) with the
//                             punctuation words 0x2727 ' (tile 0x2C top), 0x5E5E " (0x22 top), 0x2C2C , (0x2C bottom),
//                             0x2E2E . (0x2E bottom), 0x5B5B (tile 0x18F one column back), 0x5D5D (0x1BF two rows down)
//                    0x0CE4   16x16 printer (c, c+1 over c+0x10, c+0x11; two columns per char) with the Japanese
//                             dakuten/handakuten words 0x7E7E/0x2829 (tile 0x1B1/0x1B0 above the previous char);
//                             0x0CD2 is the same without the header (A1 preset)
//                    0x0E12   8x16 printer without punctuation words (0x0E68 = no-header variant)
//                    0x0C4C   8x8 word printer (one tile per char; 0x0C9A = no-header variant)
//                    0x7EC48  typewriter object (pool C type 0x68, spawned by 0x7EC20 with the text at +0x80): one char
//                             per +0x86 frames; in English mode codes < 0x100 are drawn 16 wide, others 8 wide
//   byte blocks  : header {col, row, colour byte}, ASCII bytes, '/' = new header, '@' = end (8x8 ASCII font;
//                  printers 0x0BAE/0x0BB6, no-header 0x0C0A)
// Region: word 0xFF8032 (0 Japan, 1 USA, 2 World/"Etc"); written once at 0xA736 (move.w #2) in this set. Japanese and
// English tables sit side by side and the code picks one with tst.w 0x32(A5).
'use strict';
const R = require('../../rom.cjs');
const p = R.prg;
const u8 = a => p[a], u16 = a => (p[a] << 8) | p[a + 1], u32 = a => ((p[a] << 24) | (p[a + 1] << 16) | (p[a + 2] << 8) | p[a + 3]) >>> 0;
const s16 = a => { const v = u16(a); return v >= 0x8000 ? v - 0x10000 : v; };
const hex = (n, w = 0) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');

// ---------------------------------------------------------------- fonts (OBSERVED: glyphs rendered from the scroll1 gfx)
// Narrow 8x16 story font (printer 0x84F72, typewriter): letters 0x160-0x16E (A-O), 0x190-0x198 (P-X), 0x582 Y,
// 0x583 Z, digits 0x584-0x58A (1-7), 0x35D/0x35E/0x35F (8, 9, 0) and 0x33F ! / 0x359 ? borrowed from the service
// font, 0x680 blank, 0x6CA+0x6CB = one three-dot ellipsis drawn over two columns.
const NARROW = new Map();
'ABCDEFGHIJKLMNO'.split('').forEach((c, i) => NARROW.set(0x160 + i, c));
'PQRSTUVWX'.split('').forEach((c, i) => NARROW.set(0x190 + i, c));
NARROW.set(0x582, 'Y'); NARROW.set(0x583, 'Z');
for (let d = 1; d <= 7; d++) NARROW.set(0x583 + d, String(d));
NARROW.set(0x35d, '8'); NARROW.set(0x35e, '9'); NARROW.set(0x35f, '0'); NARROW.set(0x33f, '!'); NARROW.set(0x359, '?');
NARROW.set(0x680, ' '); NARROW.set(0x6ca, '..'); NARROW.set(0x6cb, '.');
// Wide 16x16 font (printer 0x0CE4 and the typewriter for codes < 0x100). A 16x16 glyph is the tiles c, c+1 over
// c+0x10, c+0x11, so the letters sit at even codes in rows of 8: 0xA0 8, 0xA2 9, 0xA4-0xAE A-F, 0xC0-0xCC G-M,
// 0xE0-0xEE N-U, 0x100 V, 0x102 W, 0x105 X, 0x107 Y, 0x109 Z, 0x120 !, 0x122 ?, 0x80-0x8E digits 0-7, plus the
// broader M/W at 0x528/0x52A used by the attract and caption texts.
const WIDE = new Map();
'ABCDEF'.split('').forEach((c, i) => WIDE.set(0xa4 + i * 2, c));
'GHIJKLM'.split('').forEach((c, i) => WIDE.set(0xc0 + i * 2, c));
'NOPQRSTU'.split('').forEach((c, i) => WIDE.set(0xe0 + i * 2, c));
WIDE.set(0x100, 'V'); WIDE.set(0x102, 'W'); WIDE.set(0x105, 'X'); WIDE.set(0x107, 'Y'); WIDE.set(0x109, 'Z');
WIDE.set(0x528, 'M'); WIDE.set(0x52a, 'W');
WIDE.set(0xa0, '8'); WIDE.set(0xa2, '9'); for (let d = 0; d <= 7; d++) WIDE.set(0x80 + d * 2, String(d));
WIDE.set(0x120, '!'); WIDE.set(0x122, '?'); WIDE.set(0x680, ' '); WIDE.set(0x20, ' ');
// Service font (EEPROM / test screens): 0x330 7, 0x331 8, 0x332 9, 0x333-0x33E A-L, 0x33F !, 0x350-0x358 N-V,
// 0x359 ?, 0x35A X, 0x35B Y, 0x35C Z, 0x35D 8, 0x35E 9, 0x35F 0; M = 0x8AE+0x8AF, W = 0x920+0x921 (two columns).
const SERVICE = new Map();
'789ABCDEFGHIJKL!'.split('').forEach((c, i) => SERVICE.set(0x330 + i, c));
'NOPQRSTUV?XYZ890'.split('').forEach((c, i) => SERVICE.set(0x350 + i, c));
SERVICE.set(0x8ae, 'M'); SERVICE.set(0x8af, ''); SERVICE.set(0x920, 'W'); SERVICE.set(0x921, ''); SERVICE.set(0x10f, '-');
SERVICE.set(0x680, ' '); SERVICE.set(0x20, ' ');
const PUNCT = new Map([[0x2727, "'"], [0x5e5e, '"'], [0x2c2c, ','], [0x2e2e, '.'], [0x5b5b, ''], [0x5d5d, ''], [0x7e7e, '゙'], [0x2829, '゚']]);
const FONTS = { narrow: NARROW, wide: WIDE, service: SERVICE };

// ---------------------------------------------------------------- word-block parser
// Returns {addr, end, lines:[{col,row,attr,codes}]} or null. Lines may be empty (header + 0x2F2F).
function parseWordBlock(a, { maxLines = 40, maxChars = 64 } = {}) {
  let q = a; const lines = [];
  for (let g = 0; g < maxLines; g++) {
    const col = u8(q), row = u8(q + 1), attr = u16(q + 2);
    if (col > 0x3f || row > 0x3f || attr > 0xff) return null;
    q += 4; const codes = []; let end = null;
    for (let k = 0; k <= maxChars; k++) {
      const w = u16(q); q += 2;
      if (w === 0x4040) { end = '@'; break; }
      if (w === 0x2f2f) { end = '/'; break; }
      if (PUNCT.has(w) || (w >= 0x20 && w < 0x1000)) { codes.push(w); continue; }
      return null;
    }
    if (!end) return null;
    lines.push({ col, row, attr, codes });
    if (end === '@') return { addr: a, end: q, lines };
  }
  return null;
}
const isBlank = c => c === 0x680 || c === 0x20;
function fontScore(block, font) {
  let n = 0, k = 0;
  for (const l of block.lines) for (const c of l.codes) { if (PUNCT.has(c) || isBlank(c)) continue; n++; if (FONTS[font].has(c)) k++; }
  return n ? k / n : 0;
}
function guessFont(block) {
  const codes = block.lines.flatMap(l => l.codes);
  if (codes.every(c => isBlank(c))) return 'blank';     // eraser blocks
  const ascii = codes.filter(c => c >= 0x20 && c < 0x7f).length / codes.length;
  if (ascii === 1) return 'ascii8';
  const s = Object.keys(FONTS).map(f => [f, fontScore(block, f)]).sort((x, y) => y[1] - x[1]);
  if (s[0][1] >= 0.8) return s[0][0];
  return 'other';   // Japanese kana/kanji or picture tiles
}
function codeText(c, font) {
  if (PUNCT.has(c)) return PUNCT.get(c);
  if (font === 'ascii8') return c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : `{${c.toString(16)}}`;
  const m = FONTS[font]; if (m && m.has(c)) return m.get(c);
  // Japanese blocks mix kana/kanji with the 16x16 Latin letters and digits; the English EP1 card keeps a kanji subtitle
  if (font === 'other' && c < 0x130 && WIDE.has(c)) return WIDE.get(c);
  if (font === 'other' && NARROW.has(c) && c !== 0x680) return NARROW.get(c);
  if (c === 0x680) return ' ';
  return `{${c.toString(16)}}`;
}
// columns a line occupies: one per code (two for the 16x16 fonts), except the marks drawn over a neighbour
const NOADVANCE = new Set([0x5b5b, 0x7e7e, 0x2829]);
function lineCols(codes, font) {
  const w = font === 'wide' || font === 'other' ? 2 : 1;
  return codes.reduce((s, c) => s + (NOADVANCE.has(c) ? 0 : PUNCT.has(c) ? 1 : w), 0);
}
// cells a code occupies on screen, as text: one per code (two for the 16x16 fonts), none for the marks drawn over a
// neighbour; the two-column ellipsis 0x6CA+0x6CB reads "..." in total
function codeCells(c, font) {
  if (NOADVANCE.has(c)) return [];
  const t = codeText(c, font);
  if (font === 'wide' || font === 'other') return PUNCT.has(c) ? [t] : [t, ''];
  return [t];
}
function decodeWordBlock(block, font = guessFont(block)) {
  return {
    font, lines: block.lines.map(l => ({ col: l.col, row: l.row, attr: l.attr, cols: lineCols(l.codes, font), text: l.codes.map(c => codeText(c, font)).join(''), cells: l.codes.flatMap(c => codeCells(c, font)) })),
  };
}
// The block painted onto a character grid in print order (later lines overwrite earlier ones, as the printers do:
// eraser lines, and re-coloured words printed over a line in another palette). Returns the screen rows top to bottom
// with the plain text and a markdown version in which cells drawn with a different attribute word than the row's
// first cell are **bold** (the highlighted words of the attract and profile pages).
function screenLines(dec) {
  const grid = new Map();
  for (const l of dec.lines) {
    if (!grid.has(l.row)) grid.set(l.row, new Map());
    const g = grid.get(l.row);
    l.cells.forEach((s, i) => g.set(l.col + i, { s, attr: l.attr }));
  }
  const out = [];
  for (const row of [...grid.keys()].sort((a, b) => a - b)) {
    const g = grid.get(row), cols = [...g.keys()].sort((a, b) => a - b);
    const cells = [];
    for (let c = cols[0]; c <= cols[cols.length - 1]; c++) cells.push(g.get(c) || { s: ' ', attr: null });
    const ink = cells.filter(x => x.s.trim());
    if (!ink.length) continue;
    const base = 0;   // the English pages print their normal text with attribute word 0 and highlights with 2
    // words: runs of inked cells; a word is highlighted when all its cells use another attribute word
    let text = '', rich = '', word = [], open = false;
    const flush = () => {
      if (!word.length) return;
      const al = word.filter(x => /[A-Z0-9]/.test(x.s)), w = word.map(x => x.s).join(''), hi = al.length > 0 && al.every(x => x.attr !== base);
      if (hi && !open) { rich += '**'; open = true; }
      if (!hi && open) { rich = rich.replace(/\s*$/, '') + '** '; open = false; }
      rich += w; word = [];
    };
    for (const x of cells) {
      text += x.s;
      if (x.s.trim()) word.push(x); else if (x.s === ' ') { flush(); rich += ' '; }
    }
    flush(); if (open) rich = rich.replace(/\s*$/, '') + '**';
    text = text.replace(/\s+/g, ' ').trim();
    rich = rich.replace(/\s+/g, ' ').trim();
    out.push({ row, col: cols.find(c => (g.get(c).s || '').trim()), text, rich });
  }
  return out;
}

// ---------------------------------------------------------------- byte (ASCII) blocks
function parseByteBlock(a, { maxLines = 60 } = {}) {
  let q = a; const lines = [];
  for (let g = 0; g < maxLines; g++) {
    const col = u8(q), row = u8(q + 1), colour = u8(q + 2);
    if (col > 0x3f || row > 0x3f) return null;
    q += 3; let s = '', end = null;
    for (let k = 0; k < 80; k++) {
      const c = u8(q++);
      if (c === 0x40) { end = '@'; break; }
      if (c === 0x2f) { end = '/'; break; }
      if (c >= 0x20 && c < 0x7f) { s += String.fromCharCode(c); continue; }
      return null;
    }
    if (!end) return null;
    lines.push({ col, row, colour, text: s });
    if (end === '@') return { addr: a, end: q, lines };
  }
  return null;
}

// ---------------------------------------------------------------- ROM-wide scan of word blocks
function scanWordBlocks(from = 0, to = 0xb0000) {
  const out = [];
  for (let a = from; a < to - 8; a += 2) {
    const b = parseWordBlock(a);
    if (!b) continue;
    const n = b.lines.reduce((s, l) => s + l.codes.length, 0);
    if (n < 3) continue;
    const font = guessFont(b);
    if (font === 'ascii8' && b.lines[0].col === 0x2f && b.lines[0].row === 0x2f) continue;   // byte strings misread as words
    if (font === 'other') {
      // keep Japanese-looking blocks only when most codes are plausible tile codes and there are dakuten or kana
      const codes = b.lines.flatMap(l => l.codes);
      const plaus = codes.filter(c => PUNCT.has(c) || c === 0x680 || (c >= 0x80 && c < 0xd00)).length / codes.length;
      if (plaus < 0.9 || n < 4) continue;
    }
    out.push(Object.assign(b, { font, chars: n }));
    a = b.end - 2;
  }
  return out;
}

// ---------------------------------------------------------------- references to an address
function longRefs(target) {
  const hits = [];
  for (let a = 0; a < 0x100000 - 3; a += 2) if (u32(a) === target) hits.push(a);
  return hits;
}

module.exports = { p, u8, u16, u32, s16, hex, NARROW, WIDE, SERVICE, PUNCT, FONTS, parseWordBlock, guessFont, codeText, decodeWordBlock, screenLines, parseByteBlock, scanWordBlocks, longRefs };

// ---------------------------------------------------------------- render a word block the way its printer draws it
// (scroll1 8x8 tiles from the 4 MB graphics, pen 15 transparent, grey ramp by pen; no palette). mode: 'narrow' =
// 0x84F72 rules, 'wide' = 0x0CE4 rules (c, c+1 over c+0x10, c+0x11), 'typewriter' = wide below 0x100 else narrow.
// Returns {w, h, rgba} cropped to the inked cells (+4 px margin), or null.
function renderBlock(block, mode = 'narrow', scale = 2) {
  const S = require('./cps-scroll.cjs');
  const cells = new Map();   // "col,row" -> code
  const put = (col, row, code) => cells.set(`${col & 63},${row & 63}`, code);
  for (const l of block.lines) {
    let col = l.col; const row = l.row;
    for (const w of l.codes) {
      if (w === 0x2727) { put(col, row, mode === 'wide' ? 0x27 : 0x2c); col++; continue; }
      if (w === 0x5e5e) { put(col, row, 0x22); col++; continue; }
      if (w === 0x2c2c) { put(col, row + 1, mode === 'wide' ? 0x1b2 : 0x2c); col++; continue; }
      if (w === 0x2e2e) { put(col, row + 1, mode === 'wide' ? 0x1b0 : 0x2e); col++; continue; }
      if (w === 0x5b5b) { put(col - 1, row, 0x18f); continue; }
      if (w === 0x5d5d) { put(col, row + 2, 0x1bf); col++; continue; }
      if (w === 0x7e7e) { put(col - 1, row - 1, 0x1b1); continue; }
      if (w === 0x2829) { put(col - 1, row - 1, 0x1b0); continue; }
      const wide = mode === 'wide' || (mode === 'typewriter' && w < 0x100);
      put(col, row, w); put(col, row + 1, w + 0x10);
      if (wide) { put(col + 1, row, w + 1); put(col + 1, row + 1, w + 0x11); col += 2; } else col++;
    }
  }
  if (!cells.size) return null;
  const ks = [...cells.keys()].map(k => k.split(',').map(Number));
  const c0 = Math.min(...ks.map(k => k[0])), c1 = Math.max(...ks.map(k => k[0])), r0 = Math.min(...ks.map(k => k[1])), r1 = Math.max(...ks.map(k => k[1]));
  const W = ((c1 - c0 + 1) * 8 + 8) * scale, H = ((r1 - r0 + 1) * 8 + 8) * scale;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = 16; rgba[i * 4 + 1] = 16; rgba[i * 4 + 2] = 40; rgba[i * 4 + 3] = 255; }
  let inked = 0;
  for (const [k, code] of cells) {
    const [col, row] = k.split(',').map(Number);
    const pens = S.tilePens(1, code, col & 1);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const pen = pens[y * 8 + x]; if (pen === 15) continue; inked++;
      const v = 255 - pen * 9;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const o = ((((row - r0) * 8 + y + 4) * scale + dy) * W + ((col - c0) * 8 + x + 4) * scale + dx) * 4;
        rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v;
      }
    }
  }
  return inked ? { w: W, h: H, rgba } : null;
}
module.exports.renderBlock = renderBlock;
