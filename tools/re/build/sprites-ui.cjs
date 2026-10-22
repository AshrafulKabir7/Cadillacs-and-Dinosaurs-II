// Ui family of the ROM sprite data (PLAN §4.1 "ui", §5.2 `sprites ui`, §6 WP-D; KI5). Writes:
//   sprite-data-ui.js                  SPRITE_DATA.add('ui', …): one slot-indexed sheet `ui` (R = palette slot, G = pen)
//                                      holding the scroll1 8x8 ASCII font (font8), the narrow 8x16 story font (font16),
//                                      the dialogue portraits 0x00-0x0D with their talk (mouth) and blink (eyes) frames,
//                                      the HUD faces of the P1 block, the life-bar tiles, the ornate INSERT COIN, the
//                                      title-card map panel (card frame, emblem, name plate) and the title logo (KI5);
//                                      palette rows (scroll1 page 0xBBA52, the villain rows at 0x84E8A, the card page
//                                      0xBC252 as live, the boot OBJ rows) and the maps `ui` and `text-<n>`
//   work/re/build/sheets/ui-ui.png     the sheet coloured with the `ui` map (review)
//   work/re/pack/ui-contact.png        fonts, portraits (every talk/blink state) and HUD pieces drawn from the data
//
// Sources (all ROM): scroll1 tiles through cps-scroll.cjs tilePens (8x8, 64 bytes per code; both column halves are
// checked identical for every glyph used, so the glyph does not depend on the screen column it is printed at);
// portraits from the 0x84736 routine (9x9 tile map [0x8463E + i*4], palette word [0x8461A + i*2], attribute bytes
// [0x84696 + i*4]) and the 0x84910 talk/blink handlers (table 0x84982, tile lists drawn by 0x84DD0, tile 0xA05 is
// flipped vertically); villain palette rows 0x84E8A + D4*32 (0x84E2E -> scroll1 row 0x1C, 0x84E5C -> 0x1D); HUD faces
// from 0x16396 (tile base [0x163D4 + id*2], attribute [0x163DC + id*2], columns c, c+0x10, c+0x3A0); the life bar
// from 0x16446 / 0x16548 (tiles 0x903 full, 0x90B empty, partial tables 0x16520 / 0x16530 / 0x1653C, attribute
// 0x18D); INSERT COIN (tiles 0x4C0-0x4CD), the card panel and the logo from two stage screens whose tile / OBJ lists are
// frozen below (CARD_FROZEN, LOGO_FROZEN: they only say WHICH tiles / OBJ blocks and palettes the screen used): every
// pixel is re-rendered from the graphics ROM and checked against the extract PNGs (stages/screens). The MAME dumps in
// work/re/runs (stg-ep1-walk, stg-screens-card3, stg-screens-boot) are optional cross-checks: present or not, the
// output is the same. The font coverage scan of campaign.js / mission-data.js / game.js / arcade-ui.js is a check
// only (the glyph set is fixed), so editing those files never changes sprite-data-ui.js.
//
// API (PLAN §5.3):  build({rom, extract, config, out, rgba, lib, log}) -> {files, report}
// CLI:              node tools/re/build/sprites-ui.cjs [--out <dir>] [--rgba]
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const RUNS = path.join(ROOT, 'work', 're', 'runs');
const hexs = (n, w = 0) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const uniq = a => [...new Set(a)];

// ------------------------------------------------------------------------------------------------ ROM tables
const T = {
  pal1: 0xBBA52,                 // scroll1 palette page loaded at area start (stage-rom.cjs T.pal1)
  cardPage: 0xBC252,             // scroll1 page of the title-card screens (rows 1-8, 12, 13 equal the live card palette)
  portraitPal: 0x8461A, portraitMap: 0x8463E, portraitAttr: 0x84696, portraitAttrAlt: 0x846DE,
  talk: 0x84982, talkEnd: 0x84DD0, villainRows: 0x84E8A, villainCount: 6,
  hudFace: 0x163D4, hudAttr: 0x163DC,
  // G7 (PLAN §7 G7) HUD tables: P1 names (after the 0x16396 face routine), foe row (R9), weapon panel (0x23A24)
  p1Names: 0x16426, foeNames: 0x17D78, foeCount: 39, heroFoeNames: 0x17D70, foeFaces: 0x17ABE, foePal: 0x17A1E,
  heroFoeFaces: 0x17A82, heroFoePal: 0x17A6E, foeCycle: 0x17892,
  wpnIcons: 0x23AC6, wpnArm: 0x23B52, wpnFireNames: 0x23C58, wpnNames: 0x23CDE, wpnUnits: 0x23EB4, wpnLow: 0x23BD0,
  barMid: 0x16520, barLeft: 0x16530, barRight: 0x1653C,
};
const PORTRAITS = 14;            // 0x00-0x0D (CAST.md; 0x0E-0x11 exist in the tables but no call site loads them)
const PORTRAIT_NAMES = ['Jack Tenrec', 'Hannah Dundee', 'Mustapha Cairo', "Mess O'Bradovich", 'Dr. Fessenden', 'Vice T.', 'The Butcher', 'Morgan', 'the village elder', 'Slice',
  'Jack Tenrec (ending set)', 'Hannah Dundee (ending set)', 'Mustapha Cairo (ending set)', "Mess O'Bradovich (ending set, never called)"];
// sheet slot of each portrait's pixels: the heroes keep their scroll1 rows 0x10-0x13; the six villains share the
// hardware rows 0x1C/0x1D (loaded per scene), so each gets its own slot 20-25 in the sheet
const VILLAIN_SLOT = { 4: 20, 5: 21, 6: 22, 7: 23, 8: 24, 9: 25 };
const HERO_IDS = ['jack', 'mustapha', 'hannah', 'mess'];        // character id order (0x163D4 index)
const HERO_PORTRAIT = { jack: '0x00', hannah: '0x01', mustapha: '0x02', mess: '0x03' };
// font sets
const NARROW = (() => {        // story-rom.cjs NARROW / stages.cjs FONT16: 8x16 = tile c over c + 0x10 (printer 0x84F72)
  const m = {};
  'ABCDEFGHIJKLMNO'.split('').forEach((c, i) => { m[c] = 0x160 + i; });
  'PQRSTUVWX'.split('').forEach((c, i) => { m[c] = 0x190 + i; });
  m.Y = 0x582; m.Z = 0x583; for (let d = 1; d <= 7; d++) m[String(d)] = 0x583 + d;
  m['8'] = 0x35D; m['9'] = 0x35E; m['0'] = 0x35F; m['!'] = 0x33F; m['?'] = 0x359;
  return m;
})();
const PLAN_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?'’“”-·/()";   // PLAN §4.1 ui
// characters every font carries besides the text scan (ARCADE_UI's normalised set: …, —, ×, &, +, =, %, *, #, ")
const EXTRA_GLYPHS = '…—×&+=%*#"';

// ------------------------------------------------------------------------------------------------ frozen screen lists
// The title-card panel and the boot logo come from two MAME dumps (work/re/runs, not a build input): only WHICH tiles /
// OBJ blocks and palette rows the screen used is frozen here; every pixel is re-rendered from the graphics ROM and
// checked against the extract PNGs (stages/screens/card3-f0300-scroll1.png, boot-f0330-sprites.png). When the dump
// exists the builder also checks these lists against it (report only).
// CARD: stg-screens-card3 f300, scroll1 at (248, 0), screen cols 10-37 x rows 0-14; each cell = tile code (4 hex) + attribute (2 hex)
const CARD_FROZEN = {
  run: 'stg-screens-card3', frame: 300, scroll: [248, 0], col0: 10, row0: 0,
  cells: [
    '002006 002006 002006 002006 002006 002006 002006 002006 002006 092401 092501 092601 092701 092801 092901 092521 092421 002006 002006 002006 002006 002006 002006 002006 002006 002006 002006 002006',
    '002006 002006 002006 002006 002006 002006 002006 002006 002006 093401 093501 093601 093701 093801 093901 093521 093421 002006 002006 002006 002006 002006 002006 002006 002006 002006 002006 002006',
    '094101 094201 094301 094401 094501 094601 094701 094801 094901 094a01 094b01 094c01 094d01 094d21 094c21 09c001 09c101 09c201 09c301 09c401 09c501 09c601 09c701 09c801 09c901 09ca01 09cb01 002006',
    '095101 095201 095301 095402 095502 095602 095702 095802 095901 095a01 095b01 095c01 095d01 095d21 095c21 09d001 09d101 09d201 09d309 09d409 09d509 09d609 09d709 09d801 09d901 09da01 09db01 002006',
    '096102 096202 096302 096402 096502 096602 096702 096802 096902 096a07 096b07 096c07 096d07 096e07 096f07 09e007 09e107 09e209 09e309 09e409 09e509 09e609 09e709 09e809 09e909 09ea09 09eb09 002006',
    '097102 097202 097302 097402 097502 097602 097702 097802 097902 097a07 097b07 097c07 097d07 097e07 097f07 09f007 09f10a 09f20a 09f309 09f409 09f509 09f609 09f709 09f809 09f909 09fa09 09fb09 002006',
    '0d0102 0d0202 0d0302 0d0402 0d0502 0d0602 0d0708 0d0808 0d0908 0d0a07 0d0b07 0d0c07 0d0d07 0d0e07 0d0f07 0d8007 0d810a 0d820a 0d8309 0d840b 0d850b 0d860b 0d870b 0d880b 0d890b 0d8a0b 0d8b09 002006',
    '0d1102 0d1202 0d1302 0d1402 0d1502 0d1608 0d1708 0d1807 0d1907 0d1a07 0d1b07 0d1c07 0d1d07 0d1e07 0d1f07 0d9007 0d910a 0d920a 0d930b 0d940b 0d950b 0d960b 0d970b 0d980b 0d990b 0d9a0b 0d9b09 002006',
    '0d2104 0d2202 0d2302 0d2404 0d2504 0d2608 0d2708 0d2805 0d2905 0d2a05 0d2b05 0d2c05 0d2d05 0d2e07 0d2f07 0da007 0da10a 0da201 0da301 0da40b 0da50b 0da60b 0da70b 0da80b 0da90b 0daa0b 0dab01 002006',
    '0d3103 0d3203 0d3303 0d3403 0d3503 0d3606 0d3705 0d3805 0d3905 0d3a05 0d3b05 0d3c05 0d3d05 0d3e05 0d3f05 0db001 0db101 0db201 0db301 0db401 0db501 0db601 0db701 0db801 0db901 0dba01 0dbb01 002006',
    '0d4103 0d4203 0d4303 0d4403 0d4503 0d4605 0d4705 0d4805 0d4905 0d4a05 0d4b05 0d4c05 0d4d05 0d4e05 0d4f05 0dc001 0dc101 0dc201 0dc301 0dc401 0dc501 0dc601 0dc701 0dc801 0dc901 0dca01 0dcb01 002006',
    '0d5103 0d5203 0d5303 0d5403 0d5503 0d5601 0d5701 0d5801 0d5901 0d5a01 0d5b01 0d5c01 0d5d01 0d5e01 0d5f01 0dd001 0dd101 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0ddb01 002006',
    '0d6103 0d6203 0d6303 0d6403 0d6501 0d6601 0d6701 0d6801 0d6901 0d6a01 0d6b01 0d6c01 0d6d01 0d6e01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0deb01 002006',
    '0d7103 0d7203 0d7303 0d7401 0d7501 0d7601 0d7701 0d7801 0de801 074b01 074c01 074d01 074e01 074f01 07c001 07c101 07c201 0de901 0df301 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0d6f01 0dfb01 002006',
    '077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 077a01 002006',
  ],
  // the live scroll1 page rows of the palettes the panel uses (24-bit RGB; rows 9-11 are mid palette cycle)
  pals: {
    1: '775555 886655 aa8877 ccaa88 eecc99 ffeeaa ffffff 005588 55aadd bbccdd bbccdd 0088aa 0077aa 006699 55aadd 009900',
    2: '557755 779966 88bb77 aadd88 884433 aa7744 cc9966 ddbb88 447799 bbaa99 bbccdd 55aadd 775555 eecc99 ffeeaa 009900',
    3: '775533 aa7766 bb9988 eeccaa ffeedd 994422 ee7755 ffaa66 336644 44aa66 0088bb cc9977 775555 eecc99 ffeeaa 009900',
    4: '775533 aa7766 bb9988 eeccaa ffeedd eecc88 ccaa77 aa8866 447799 000000 000000 000000 775555 eecc99 ffeeaa 009900',
    5: '333333 666666 888888 aaaaaa cccccc ffffff 664411 997744 ccaa77 ffccaa 0088bb 007755 00aa66 000000 dd9966 009900',
    6: '775533 aa7766 bb9988 eeccaa ffeedd 000000 773333 995544 bb7755 dd9966 0088bb 000000 000000 000000 000000 009900',
    7: '773333 995544 bb7755 dd9966 ffbb88 0088bb 779944 88bb55 447799 775555 886655 aa8877 ccaa88 eecc99 ffeeaa 009900',
    8: '557755 779966 88bb77 aadd88 884433 aa7744 cc9966 ddbb88 447799 773333 995544 bb7755 dd9966 ffbb88 ffffff 009900',
    9: '111111 003300 226600 338811 000000 330000 663300 885522 997733 bbccdd 2266aa 55aadd 775555 eecc99 ffeeaa 009900',
    10: '773333 995544 bb7755 dd9966 ffbb88 000000 000000 000000 447799 0088bb 000000 330000 663300 885522 997733 009900',
    11: '111111 222233 555566 777788 111111 443311 665533 887766 0077aa 0088bb 000000 000000 663300 441100 885522 009900',
  },
};
// LOGO (KI5): stg-screens-boot f330, the OBJ blocks [code, sx, sy, bw, bh, flip (1 x, 2 y), palette] in list order, and
// the 16-bit words of the OBJ palettes they use
const LOGO_FROZEN = {
  run: 'stg-screens-boot', frame: 330,
  blocks: [
    [10204, 300, 80, 2, 2, 0, 30], [20428, 236, 80, 4, 2, 0, 30], [20459, 156, 80, 5, 2, 0, 30], [20424, 108, 48, 3, 4, 0, 30],
    [28120, 284, 63, 1, 1, 0, 29], [28334, 300, 63, 2, 1, 0, 29], [28069, 316, 47, 1, 1, 0, 29], [28064, 300, 47, 1, 1, 0, 29],
    [28094, 252, 63, 2, 1, 0, 29], [28328, 172, 15, 6, 1, 0, 29], [28323, 172, 63, 5, 1, 0, 29], [28344, 172, 47, 8, 1, 0, 29],
    [28336, 172, 31, 8, 1, 0, 29], [28070, 140, 31, 2, 1, 0, 29], [28320, 44, 95, 3, 1, 0, 29], [28088, 44, 79, 6, 1, 0, 29],
    [28080, 44, 63, 8, 1, 0, 29], [28072, 44, 47, 8, 1, 0, 29], [28065, 60, 31, 4, 1, 0, 29],
  ],
  pals: {
    29: 'f37f f147 f333 fbbb fddd ffff ffbd ff8a ff20 f67a f999 ffc0 f368 ffc0 ffc0 f000',
    30: 'f78b f111 f567 f567 f062 f093 f0b4 f000 ff99 f3d9 fbfc f000 f000 f000 f000 f000',
  },
};

// ------------------------------------------------------------------------------------------------ scroll1 tiles
function tileLib(S) {
  const pens = code => S.tilePens(1, code, 0);
  const halvesEqual = code => { const a = S.tilePens(1, code, 0), b = S.tilePens(1, code, 1); for (let i = 0; i < 64; i++) if (a[i] !== b[i]) return false; return true; };
  // an 8x8 tile as a code image (slot*16+pen, 0xFFFF transparent) with flips
  const tile = (code, slot, { fx = false, fy = false, half = 0 } = {}) => {
    const t = S.tilePens(1, code, half), out = new Uint16Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const p = t[(fy ? 7 - y : y) * 8 + (fx ? 7 - x : x)]; out[y * 8 + x] = p === 15 ? 0xFFFF : slot * 16 + p; }
    return out;
  };
  return { pens, tile, halvesEqual };
}
// image helpers: {w, h, code: Uint16Array}
const blank = (w, h) => ({ w, h, code: new Uint16Array(w * h).fill(0xFFFF) });
function put(img, t8, x, y) { for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) { const v = t8[yy * 8 + xx]; if (v !== 0xFFFF) img.code[(y + yy) * img.w + x + xx] = v; } }
function putImg(dst, src, x, y) { for (let yy = 0; yy < src.h; yy++) for (let xx = 0; xx < src.w; xx++) { const v = src.code[yy * src.w + xx]; const X = x + xx, Y = y + yy; if (v !== 0xFFFF && X >= 0 && Y >= 0 && X < dst.w && Y < dst.h) dst.code[Y * dst.w + X] = v; } }
function bbox(img) { let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1; for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.code[y * img.w + x] !== 0xFFFF) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x0, y0, x1, y1 }; }
function crop(img, x, y, w, h) { const o = blank(w, h); for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) o.code[yy * w + xx] = img.code[(y + yy) * img.w + x + xx]; return o; }

// ------------------------------------------------------------------------------------------------ fonts
function buildFonts(L, required) {
  const tilesUsed = new Set(), t8 = c => { tilesUsed.add(c); return L.tile(c, 0); };
  const shift = (src, dx, dy) => { const o = new Uint16Array(64).fill(0xFFFF); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const v = src[y * 8 + x]; const X = x + dx, Y = y + dy; if (v !== 0xFFFF && X >= 0 && X < 8 && Y >= 0 && Y < 8) o[Y * 8 + X] = v; } return o; };
  const box = src => { let x0 = 8, y0 = 8, x1 = -1, y1 = -1; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (src[y * 8 + x] !== 0xFFFF) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { x0, y0, x1, y1 }; };
  const glyph8 = {}, src8 = {};
  // 1. the ROM ASCII 8x8 font: tile code = ASCII code (byte printers 0x0BAE/0x0BB6, 0x20-0x7E)
  for (let c = 0x21; c <= 0x5F; c++) { const ch = String.fromCharCode(c); if (/[a-z]/.test(ch)) continue; glyph8[ch] = { cells: 1, code: t8(c) }; src8[ch] = `rom ${hexs(c, 3)}`; }
  // 2. composed from ROM glyphs (PLAN §4.1: authored glyphs for · and ’; the rest map to the ROM shapes)
  const dot = t8(0x2E), db = box(dot), dash = t8(0x2D), dsb = box(dash);
  glyph8['·'] = { cells: 1, code: shift(dot, 0, -Math.max(0, db.y0 - (3 - Math.floor((db.y1 - db.y0) / 2)))) }; src8['·'] = 'authored: ROM . (0x2E) raised to the middle rows';
  glyph8['’'] = { cells: 1, code: t8(0x27) }; src8['’'] = "authored: ROM ' (0x27)";
  glyph8['‘'] = { cells: 1, code: t8(0x27) }; src8['‘'] = "authored: ROM ' (0x27)";
  glyph8['“'] = { cells: 1, code: t8(0x22) }; src8['“'] = 'authored: ROM " (0x22)';
  glyph8['”'] = { cells: 1, code: t8(0x22) }; src8['”'] = 'authored: ROM " (0x22)';
  glyph8['×'] = { cells: 1, code: t8(0x78) }; src8['×'] = 'authored: ROM small x (0x78)';
  // em dash: the ROM '-' stretched over the whole cell (its middle column repeated, its 1-px shadow kept on the right)
  { const o = new Uint16Array(64).fill(0xFFFF), mid = Math.floor((dsb.x0 + dsb.x1) / 2);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const sx = x === 7 ? dsb.x1 : x === 0 ? dsb.x0 : Math.min(mid, dsb.x1 - 1); o[y * 8 + x] = dash[y * 8 + sx]; }
    glyph8['—'] = { cells: 1, code: o }; src8['—'] = 'authored: ROM - (0x2D) stretched to the cell'; }
  // ellipsis: three ROM dots over two cells (ARCADE_UI draws '...' and '…' as one 16-px glyph, like the ROM pair 0x6CA+0x6CB)
  { const o = new Uint16Array(128).fill(0xFFFF), w = db.x1 - db.x0 + 1, gap = Math.max(1, Math.floor((16 - 3 * w) / 3));
    for (let k = 0; k < 3; k++) { const ox = Math.floor(gap / 2) + k * (w + gap) - db.x0; for (let y = 0; y < 8; y++) for (let x = db.x0; x <= db.x1; x++) { const v = dot[y * 8 + x], X = x + ox; if (v !== 0xFFFF && X >= 0 && X < 16) o[y * 16 + X] = v; } }
    glyph8['…'] = { cells: 2, code: o }; src8['…'] = 'authored: three ROM . (0x2E) over two cells'; }

  // 3. the narrow 8x16 font (printer 0x84F72): c over c + 0x10; punctuation as the printer draws it
  const glyph16 = {}, src16 = {};
  const pair = (top, bottom) => { const o = new Uint16Array(128).fill(0xFFFF); if (top) for (let i = 0; i < 64; i++) o[i] = top[i]; if (bottom) for (let i = 0; i < 64; i++) o[64 + i] = bottom[i]; return o; };
  const double = (g8, cells = 1) => { const W = cells * 8, o = new Uint16Array(W * 16).fill(0xFFFF); for (let y = 0; y < 16; y++) for (let x = 0; x < W; x++) o[y * W + x] = g8[(y >> 1) * W + x]; return o; };
  for (const [ch, c] of Object.entries(NARROW)) { glyph16[ch] = { cells: 1, code: pair(t8(c), t8(c + 0x10)) }; src16[ch] = `rom ${hexs(c, 3)}+${hexs(c + 0x10, 3)}`; }
  glyph16["'"] = { cells: 1, code: pair(t8(0x2C), null) }; src16["'"] = 'rom 0x02C in the top cell (printer 0x84F72 word 0x2727)';
  glyph16['’'] = glyph16["'"]; src16['’'] = src16["'"];
  glyph16['‘'] = glyph16["'"]; src16['‘'] = src16["'"];
  glyph16['"'] = { cells: 1, code: pair(t8(0x22), null) }; src16['"'] = 'rom 0x022 in the top cell (printer word 0x5E5E)';
  glyph16['“'] = glyph16['"']; src16['“'] = src16['"']; glyph16['”'] = glyph16['"']; src16['”'] = src16['"'];
  glyph16[','] = { cells: 1, code: pair(null, t8(0x2C)) }; src16[','] = 'rom 0x02C in the bottom cell (printer word 0x2C2C)';
  glyph16['.'] = { cells: 1, code: pair(null, t8(0x2E)) }; src16['.'] = 'rom 0x02E in the bottom cell (printer word 0x2E2E)';
  { const o = new Uint16Array(256).fill(0xFFFF), parts = [[0x6CA, 0], [0x6CB, 8]];
    for (const [c, x0] of parts) { const a = t8(c), b = t8(c + 0x10); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { o[y * 16 + x0 + x] = a[y * 8 + x]; o[(y + 8) * 16 + x0 + x] = b[y * 8 + x]; } }
    glyph16['…'] = { cells: 2, code: o }; src16['…'] = 'rom 0x6CA+0x6CB over 0x6DA+0x6DB (the two-column ellipsis)'; }
  // everything else: the 8x8 glyph with every row doubled (1-px verticals, 2-px horizontals: the narrow font's metrics)
  for (const ch of Object.keys(glyph8)) if (!glyph16[ch]) { const g = glyph8[ch]; glyph16[ch] = { cells: g.cells, code: double(g.code, g.cells) }; src16[ch] = `${src8[ch]}, rows doubled`; }
  // checks: column halves of every ROM tile used, coverage
  const halves = [...tilesUsed].filter(c => !L.halvesEqual(c));
  const missing8 = [...required].filter(ch => !glyph8[ch]), missing16 = [...required].filter(ch => !glyph16[ch]);
  return { glyph8, glyph16, src8, src16, halves, missing8, missing16 };
}
// lay a glyph set out on a grid image: 16 cells per row
function fontGrid(glyphs, h) {
  const keys = Object.keys(glyphs).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), cols = 16, at = {};
  let cell = 0; for (const k of keys) { const c = glyphs[k].cells; if ((cell % cols) + c > cols) cell += cols - (cell % cols); at[k] = cell; cell += c; }
  const rows = Math.ceil(cell / cols), img = blank(cols * 8, rows * h);
  for (const k of keys) { const g = glyphs[k], W = g.cells * 8, x0 = (at[k] % cols) * 8, y0 = Math.floor(at[k] / cols) * h; for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) { const v = g.code[y * W + x]; if (v !== 0xFFFF) img.code[(y0 + y) * img.w + x0 + x] = v; } at[k] = [x0, y0, g.cells]; }
  return { img, at };
}

// ------------------------------------------------------------------------------------------------ portraits
function portraitTables(R) {
  const out = [];
  for (let i = 0; i < PORTRAITS; i++) out.push({ i, pal: R.u16(T.portraitPal + i * 2), map: R.u32(T.portraitMap + i * 4) & 0xFFFFFF, attr: R.u32(T.portraitAttr + i * 4) & 0xFFFFFF });
  return out;
}
// the talk / blink parts of a 0x84910 handler: [{counter:'mouth'|'eyes', frames:[tileListAddr…], rows, cols, col, row}]
function talkParts(R, start, end) {
  const p = R.prg, u16 = a => (p[a] << 8) | p[a + 1], parts = [];
  for (let a = start; a < end - 4; a += 2) {
    const w = u16(a);
    if (w !== 0x302E || (u16(a + 2) !== 0x00A6 && u16(a + 2) !== 0x00AA)) continue;
    const counter = u16(a + 2) === 0x00A6 ? 'mouth' : 'eyes', n = counter === 'mouth' ? 3 : 2;
    let b = a + 4, table = null, rows = null, cols = null, off = null;
    for (; b < end - 2 && b < a + 40; b += 2) {
      const v = u16(b);
      if (table == null && v === 0x227B) { const d8 = (p[b + 3] << 24) >> 24; table = b + 2 + d8; continue; }
      if (rows == null && (v & 0xFF00) === 0x7400) { rows = (v & 0xFF) + 1; continue; }
      if (cols == null && (v & 0xFF00) === 0x7600) { cols = (v & 0xFF) + 1; continue; }
      if (off == null && v === 0x41E8) { off = u16(b + 2); break; }
    }
    if (table == null || rows == null || cols == null || off == null) continue;
    const frames = Array.from({ length: n }, (_, k) => R.u32(table + k * 4) & 0xFFFFFF);
    parts.push({ counter, frames, rows, cols, col: off >> 7, row: (off & 0x7F) >> 2, table, at: a });
  }
  return parts;
}
// render a 72x72 portrait: base map + optional part overrides {partIndex: frame}
function renderPortrait(R, L, P, slotOf, overrides) {
  const img = blank(72, 72);
  for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
    const k = row * 9 + col, code = R.u16(P.map + k * 2), add = R.prg[P.attr + k];
    const attr = (P.pal & 0xFF00) | ((P.pal + add) & 0xFF), hw = attr & 31;
    put(img, L.tile(code, slotOf(hw), { fx: !!(attr & 0x20), fy: !!(attr & 0x40) }), col * 8, row * 8);
  }
  for (const [pi, fr] of Object.entries(overrides || {})) { const part = P.parts[pi]; if (part) putPatch(img, R, L, part, fr, slotOf(P.pal & 31), part.col * 8, part.row * 8); }
  return img;
}
function patchImage(R, L, part, frame, slot) { const img = blank(part.cols * 8, part.rows * 8); putPatch(img, R, L, part, frame, slot, 0, 0, true); return img; }
// 0x84DD0: rows x cols tile words, row-major; every tile is written (a blank tile clears the cell); 0xA05 = flip Y
function putPatch(img, R, L, part, frame, slot, x0, y0) {
  const list = part.frames[frame];
  for (let r = 0; r < part.rows; r++) for (let c = 0; c < part.cols; c++) {
    const code = R.u16(list + (r * part.cols + c) * 2), t = L.tile(code, slot, { fy: code === 0xA05 });
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) img.code[(y0 + r * 8 + y) * img.w + x0 + c * 8 + x] = t[y * 8 + x];
  }
}
function diffRGB(img, colour, ref) {
  let bad = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const v = img.code[y * img.w + x], q = (y * ref.width + x) * 4;
    if (v === 0xFFFF) { if (ref.rgba[q + 3]) bad++; continue; }
    const c = colour(v); if (c[0] !== ref.rgba[q] || c[1] !== ref.rgba[q + 1] || c[2] !== ref.rgba[q + 2]) bad++;
  }
  return bad;
}

// ------------------------------------------------------------------------------------------------ run dumps
function runFrame(run, f) {
  const file = path.join(RUNS, run, 'frames.jsonl'); if (!fs.existsSync(file)) return null;
  for (const ln of fs.readFileSync(file, 'utf8').split('\n')) { if (!ln || ln.indexOf(`"f":${f},`) < 0) continue; const fr = JSON.parse(ln); if (fr.f === f) return fr; }
  return null;
}

// ------------------------------------------------------------------------------------------------ the build
function build(opts = {}) {
  const lib = opts.lib || {};
  const png = lib.png || require('./png.cjs'), atlas = lib.atlas || require('./atlas-pack.cjs'), emit = lib.emit || require('./emit.cjs');
  const palettes = lib.palettes || require('./palettes.cjs');
  const log = opts.log || (() => {});
  const extract = opts.extract || path.join(ROOT, 'work', 're', 'extract');
  const out = opts.out || ROOT, rgba = !!opts.rgba;
  const config = opts.config || readJSON(path.join(__dirname, 'pack-config.json'));
  const C = config.ui || {};
  const R = opts.rom || require('../rom.cjs'), S = require('../export/lib/cps-scroll.cjs');
  const L = tileLib(S);
  const word24 = w => palettes.word24(w & 0xFFF);
  const rgbOf = c24 => [(c24 >> 16) & 255, (c24 >> 8) & 255, c24 & 255];
  const pageRow = (base, r) => Array.from({ length: 16 }, (_, k) => word24(R.u16(base + (r * 16 + k) * 2)));
  const report = { inputs: [], warnings: [], fonts: {}, portraits: {}, checks: {}, sheets: {}, sizes: {} };
  const inputs = [path.join(ROOT, 'tools/re/rom.cjs'), path.join(ROOT, 'tools/re/export/lib/cps-scroll.cjs')];

  // palette rows (24-bit) by key and the slot each image uses
  const rows = {}, slotRow = {};
  const useSlot = (slot, key, row) => { if (slotRow[slot] != null && slotRow[slot] !== key) throw new Error(`sprites-ui: slot ${slot} wanted by ${slotRow[slot]} and ${key}`); slotRow[slot] = key; if (!rows[key]) rows[key] = row; return slot; };
  for (let r = 0; r < 32; r++) rows[`s1:${r}`] = pageRow(T.pal1, r);

  // 1. text the fonts must cover: campaign.js, mission-data.js, the HUD strings of game.js / arcade-ui.js, PLAN set
  const required = new Set([...PLAN_GLYPHS, ...EXTRA_GLYPHS]);
  const scan = coverageScan(); for (const ch of scan.chars) required.add(ch); inputs.push(...scan.files);
  required.delete(' '); required.delete('\n');
  const fonts = buildFonts(L, required);
  useSlot(0, 's1:0', rows['s1:0']);
  if (fonts.halves.length) throw new Error(`sprites-ui: font tiles whose column halves differ: ${fonts.halves.map(c => hexs(c)).join(',')}`);
  if (fonts.missing8.length || fonts.missing16.length) throw new Error(`sprites-ui: font coverage: font8 lacks ${JSON.stringify(fonts.missing8.join(''))}, font16 lacks ${JSON.stringify(fonts.missing16.join(''))}`);
  report.fonts = { required: [...required].sort().join(''), font8: Object.keys(fonts.glyph8).length, font16: Object.keys(fonts.glyph16).length, scanned: scan.files.map(rel) };

  // 2. portraits 0x00-0x0D with their talk/blink parts
  const PT = portraitTables(R);
  const handlers = Array.from({ length: 10 }, (_, i) => T.talk + R.u16(T.talk + i * 2));
  const sortedH = handlers.slice().sort((a, b) => a - b);
  PT.forEach(P => { P.parts = []; if (P.i < 10) { const s = handlers[P.i], e = sortedH.find(h => h > s) || T.talkEnd; P.parts = talkParts(R, s, e); } });
  const villainRow = d4 => Array.from({ length: 16 }, (_, k) => word24(R.u16(T.villainRows + d4 * 32 + k * 2)));
  for (let d = 0; d < T.villainCount; d++) rows[`villain:${d}`] = villainRow(d);
  const portraitImgs = {}, patchImgs = {}, portraitInfo = {};
  const cropFile = i => path.join(extract, 'story', 'portraits', `portrait-${hexs(i, 2)}.png`);
  for (const P of PT) {
    const id = hexs(P.i, 2), hw = P.pal & 31, villain = VILLAIN_SLOT[P.i] != null;
    const slot = villain ? VILLAIN_SLOT[P.i] : hw;
    const slotOf = h => { if (h !== hw) throw new Error(`sprites-ui: portrait ${id} tile palette ${h} != ${hw}`); return slot; };
    // the palette row: the scroll1 page row for the heroes; for the villains the 0x84E8A entry that reproduces the crop
    const base = renderPortrait(R, L, P, slotOf, null);
    const crop = fs.existsSync(cropFile(P.i)) ? png.read(cropFile(P.i)) : null;
    if (crop) inputs.push(cropFile(P.i));
    // every talk/blink state: base, then each part at each frame (one part at a time, and both together)
    const states = [{ key: 'base', ov: {} }];
    const mouth = P.parts.findIndex(p => p.counter === 'mouth'), eyes = P.parts.findIndex(p => p.counter === 'eyes');
    if (mouth >= 0) for (let k = 0; k < 3; k++) states.push({ key: `mouth${k}`, ov: { [mouth]: k } });
    if (eyes >= 0) for (let k = 0; k < 2; k++) states.push({ key: `eyes${k}`, ov: { [eyes]: k } });
    if (mouth >= 0 && eyes >= 0) for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) states.push({ key: `mouth${k}+eyes${j}`, ov: { [mouth]: k, [eyes]: j } });
    const candidates = villain ? Array.from({ length: T.villainCount }, (_, d) => ({ key: `villain:${d}`, row: rows[`villain:${d}`] })) : [{ key: `s1:${hw}`, row: rows[`s1:${hw}`] }];
    let best = null;
    const refFor = crop || (P.i === 13 && fs.existsSync(cropFile(3)) ? png.read(cropFile(3)) : null);
    if (refFor) for (const cand of candidates) for (const st of states) {
      const im = st.key === 'base' ? base : renderPortrait(R, L, P, slotOf, st.ov);
      const bad = diffRGB(im, v => rgbOf(cand.row[v & 15]), refFor);
      if (!best || bad < best.bad) best = { bad, row: cand.key, state: st.key };
      if (!bad) break;
    }
    const rowKey = villain ? (best && best.bad === 0 ? best.row : null) : `s1:${hw}`;
    if (!rowKey) throw new Error(`sprites-ui: no villain palette row reproduces portrait ${id} (best ${best && best.row} ${best && best.bad} px)`);
    useSlot(slot, rowKey, rows[rowKey]);
    if (crop && best.bad) throw new Error(`sprites-ui: portrait ${id} differs from ${rel(cropFile(P.i))} in ${best.bad} px (best state ${best.state})`);
    portraitImgs[id] = base;
    const info = { name: PORTRAIT_NAMES[P.i], slot, row: rowKey, hwPalette: hexs(hw, 2), tiles: hexs(P.map), attrs: hexs(P.attr), check: refFor ? { against: crop ? rel(cropFile(P.i)) : `${rel(cropFile(3))} (0x0D has no crop: CAST.md says it repeats 0x03)`, state: best.state, px: best.bad } : null };
    for (const [pi, part] of P.parts.entries()) {
      const name = part.counter, keys = [];
      for (let k = 0; k < part.frames.length; k++) { const key = `${id}:${name}${k}`; patchImgs[key] = patchImage(R, L, part, k, slot); keys.push(key); }
      info[name] = { at: [part.col * 8, part.row * 8], size: [part.cols * 8, part.rows * 8], frames: keys, tiles: part.frames.map(a => hexs(a)), clock: name === 'mouth' ? { step: 8, order: [0, 1, 2], note: '0x84996: the frame index advances every 8 frames while the line types (0, 1, 2, 0, …)' } : { open: 0, closed: 1, closedFor: 3, period: 32, note: '0x849C2: frame 1 shows from counter&31 = 29 until 0 (3 of every 32 frames)' } };
      void pi;
    }
    portraitInfo[id] = info;
    report.portraits[id] = info.check ? `${info.check.state}: ${info.check.px} px` : 'no reference';
  }

  // 3. HUD faces (0x16396), life bar tiles, INSERT COIN
  const hudImgs = {}, hudFaces = {};
  for (let id = 0; id < 4; id++) {
    const base = R.u16(T.hudFace + id * 2), attr = R.u16(T.hudAttr + id * 2), hw = attr & 31, img = blank(24, 24);
    for (let col = 0; col < 3; col++) [0, 0x10, 0x3A0].forEach((d, row) => put(img, L.tile(base + col + d, hw), col * 8, row * 8));
    const key = `hud:${HERO_IDS[id]}`; hudImgs[key] = img; hudFaces[HERO_IDS[id]] = key;
    if (slotRow[hw] !== `s1:${hw}`) useSlot(hw, `s1:${hw}`, rows[`s1:${hw}`]);
  }
  const barCodes = uniq([0x903, 0x90B, 0x90C, 0x983, 0x989, 0x98A].concat(
    Array.from({ length: 8 }, (_, k) => R.u16(T.barMid + k * 2)), Array.from({ length: 8 }, (_, k) => R.u16(T.barLeft + k * 2)), Array.from({ length: 6 }, (_, k) => R.u16(T.barRight + k * 2)))).sort((a, b) => a - b);
  useSlot(13, 's1:13', rows['s1:13']);
  for (const c of barCodes) { const img = blank(8, 8); put(img, L.tile(c, 13), 0, 0); hudImgs[`bar:${hexs(c, 3)}`] = img; }
  const lifeBar = {
    attr: '0x18D', row: 's1:13', slot: 13, segmentHp: 8, tiles: Object.fromEntries(barCodes.map(c => [hexs(c, 3), `bar:${hexs(c, 3)}`])),
    full: 'bar:0x903', empty: 'bar:0x90B', partial: Array.from({ length: 8 }, (_, k) => `bar:${hexs(R.u16(T.barMid + k * 2), 3)}`),
    left: { full: 'bar:0x90C', table: Array.from({ length: 8 }, (_, k) => `bar:${hexs(R.u16(T.barLeft + k * 2), 3)}`) },
    right: { full: 'bar:0x983', empty: 'bar:0x989', table: Array.from({ length: 6 }, (_, k) => `bar:${hexs(R.u16(T.barRight + k * 2), 3)}`) },
    enemyLeft: 'bar:0x98A',
    pens: { fill: 1, empty: 2, colours: rows['s1:13'].slice(0, 3) },
    player: { segments: 11, rule: '0x16446: HP 0-100; n = (HP - (HP != 0 && HP != 100) + 2) >> 3; segments 11..1 from the right: full above n, empty below, partial[(HP+2)&7] at n; right cap 0x983 at 100, partial above 94, else 0x989; left cap 0x90C unless HP-1 < 6' },
    enemy: { segments: 18, rule: '0x16548: the same with n = (HP*1.5 + 2) >> 3, left end 0x98A' },
    note: 'tiles are yellow (pen 1) on red (pen 2) in scroll1 row 0x0D; the per-100-HP colour cycle of large enemy bars is not decoded (ENEMIES §11 HUD notes)',
  };
  // INSERT COIN: the ornate tiles of the live HUD (stg-ep1-walk f2400, rows 2-3 of slots 2/3: 0x4C0-0x4CD over +0x10, palette 0x0B)
  const coinCodes = [0x4C0, 0x4C1, 0x4C2, 0x4C3, 0x4C4, 0x4C5, 0x4C6, 0x4C7, null, 0x4C9, 0x4CA, 0x4CB, 0x4CC, 0x4CD];
  useSlot(11, 's1:11', rows['s1:11']);
  { const img = blank(coinCodes.length * 8, 16); coinCodes.forEach((c, i) => { if (c == null) return; put(img, L.tile(c, 11), i * 8, 0); put(img, L.tile(c + 0x10, 11), i * 8, 8); }); hudImgs['hud:insertCoin'] = img; }
  const hudCheck = checkHud(S, L, png, hudImgs, rows, report); if (hudCheck) report.checks.hud = hudCheck;

  // 3b. G7 (PLAN §7 G7): the rest of the cabinet HUD, re-rendered from the tables its draw routines read. These images
  // keep the HARDWARE scroll1 palette row as their slot (R = row 0-31 of the scroll1 page 0xBBA52) and are coloured
  // through the map `hud` (slot n -> s1:n), so they take no slot of the `ui` map (whose slots 1-11 / 20-28 hold the
  // card, villain and logo rows). Tiles are read in the column half of the screen column they are drawn at.
  const hudMapImgs = {};
  const tileAt = (code, pal, col) => L.tile(code, pal, { half: col & 1 });
  // 3x2 tile icons as the ROM lists them: column-major (top, bottom) words, drawn at screen columns c0..c0+2
  const icon3x2 = (words, pal, c0 = 0) => { const img = blank(24, 16); for (let c = 0; c < 3; c++) { put(img, tileAt(words[c * 2], pal, c0 + c), c * 8, 0); put(img, tileAt(words[c * 2 + 1], pal, c0 + c), c * 8, 8); } return img; };
  const romWords = (a, n) => Array.from({ length: n }, (_, k) => R.u16(a + k * 2));
  const romString = a => { let s = ''; for (let i = a; i < a + 40; i++) { const c = R.prg[i]; if (c === 0x40 || c < 0x20 || c > 0x7E) break; s += String.fromCharCode(c); } return s; };
  // foe row (0x16E46 -> 0x179B6 face, 0x17D2E name, 0x174F2 bar): name index = enemy +0x03 (R9); hero faces for kind 2
  const hudNames = Array.from({ length: T.foeCount }, (_, i) => romString(T.foeNames + R.s16(T.foeNames + i * 2) + 1).trim());
  const heroFoeNames = {}; HERO_IDS.forEach((h, i) => { heroFoeNames[h] = romString(T.heroFoeNames + R.s16(T.heroFoeNames + i * 2) + 1).trim(); });
  const p1Names = {}; { let a = T.p1Names; for (const h of HERO_IDS) { const s = romString(a); p1Names[h] = s; a += s.length + 1; } }
  const foeFaces = { enemy: {}, hero: {}, names: hudNames, heroNames: heroFoeNames, palettes: {} }, faceKey = {};
  for (let i = 0; i < T.foeCount; i++) {
    const words = romWords(T.foeFaces + i * 16, 6), pal = R.u16(T.foePal + i * 2) & 31, sig = words.join(',') + '/' + pal, id = hexs(i, 2);
    if (!faceKey[sig]) { faceKey[sig] = `foe:${id}`; hudMapImgs[faceKey[sig]] = icon3x2(words, pal); }
    foeFaces.enemy[id] = faceKey[sig]; foeFaces.palettes[id] = pal;
  }
  HERO_IDS.forEach((h, i) => { const key = `foe:${h}`; hudMapImgs[key] = icon3x2(romWords(T.heroFoeFaces + i * 16, 6), R.u16(T.heroFoePal + i * 2) & 31); foeFaces.hero[h] = key; });
  // JOIN-IN: the other half of the slot call (stg-ep1-walk: 48 frames JOIN-IN, 16 off, 48 INSERT COIN, 16 off), tiles
  // 0x620-0x629 over 0x630-0x639, palette 0x0B, screen columns 19-28 of slot 2 (35-44 of slot 3)
  { const img = blank(80, 16); for (let i = 0; i < 10; i++) { put(img, tileAt(0x620 + i, 11, 19 + i), i * 8, 0); put(img, tileAt(0x630 + i, 11, 19 + i), i * 8, 8); } hudMapImgs['hud:joinIn'] = img; }
  // score digits 0x124-0x12D, palette 1 (the P1 score, right-aligned to column 15)
  { const img = blank(80, 8); for (let d = 0; d < 10; d++) put(img, tileAt(0x124 + d, 1, 0), d * 8, 0); hudMapImgs['hud:score'] = img; }
  const scoreHalves = Array.from({ length: 10 }, (_, d) => L.halvesEqual(0x124 + d)).every(Boolean);
  // weapon panel (0x23A24): firearm icon 0x23A90 (table 0x23AC6 + idx*16, palette 0x0C), ARM icon 0x23B26 (0x23B52),
  // ammo digits 0x23B62 (2 cells, palette 2 at or under the low-ammo count 0x23BD0), firearm name 0x23C2C (table
  // 0x23C58), other names 0x23CAC (table 0x23CDE by subtype), ammo strip 0x23DDC (12 tiles 0xCF = 2 units, 0xDF = 1,
  // palette 0x0B; units 0x23E6E: rounds x 0x23EB4[idx], (rounds+1)>>1 for UZI and M-16A1)
  const FIREARMS = ['gun', 'rifle', 'uzi', 'm16', 'shotgun', 'bazooka'];
  const weaponIcons = {}; FIREARMS.forEach((w, i) => { const key = `hud:wpn:${w}`; hudMapImgs[key] = icon3x2(romWords(T.wpnIcons + i * 16, 6), 12); weaponIcons[w] = key; });
  hudMapImgs['hud:wpn:arm'] = icon3x2(romWords(T.wpnArm, 6), 12); weaponIcons.arm = 'hud:wpn:arm';
  { const a2 = blank(8, 8), a1 = blank(8, 8); put(a2, tileAt(0xCF, 11, 0), 0, 0); put(a1, tileAt(0xDF, 11, 0), 0, 0); hudMapImgs['hud:ammo2'] = a2; hudMapImgs['hud:ammo1'] = a1; }
  const ammoHalves = L.halvesEqual(0xCF) && L.halvesEqual(0xDF);
  const SUBTYPES = { rifle: 0x00, gun: 0x02, knife: 0x04, uzi: 0x06, m16: 0x08, shotgun: 0x0A, bazooka: 0x0C, rod: 0x0E, stick: 0x10, bknife: 0x12, club: 0x14, torch: 0x16, dynamite: 0x18, grenade: 0x1A, stone: 0x1C };
  const weaponNames = {}; for (const [w, sub] of Object.entries(SUBTYPES)) weaponNames[w] = romString(T.wpnNames + R.s16(T.wpnNames + sub) + 1).trim();
  const firearmNames = {}; FIREARMS.forEach((w, i) => { firearmNames[w] = romString(T.wpnFireNames + R.s16(T.wpnFireNames + i * 2) + 1).trim(); });
  const weaponPanel = {
    note: 'arcade screen px of the cabinet weapon panel (0x23A24; base = the P1 foe block (0,24) + 0x5C, i.e. row 26): icon 24x16, ammo right-aligned in 2 cells ending at x 48 (palette 2 when ammo <= lowAmmo), firearm name at x 48 (the ROM string starts with a space), other names at x 32, the ammo strip of 12 tiles at (24,216): 2 units per full tile',
    icon: [0, 208], ammo: [32, 208, 2], name: [48, 208], otherName: [32, 208], strip: [24, 216, 12],
    firearms: FIREARMS, icons: weaponIcons, names: Object.assign({}, weaponNames, firearmNames),
    units: Object.fromEntries(FIREARMS.map((w, i) => [w, R.u16(T.wpnUnits + i * 2)])), halfUnits: ['uzi', 'm16'],
    lowAmmo: Object.fromEntries(FIREARMS.map((w, i) => [w, R.u16(T.wpnLow + i * 2)])), pens: { normal: 's1:0', low: 's1:2' },
    tiles: { full: 'hud:ammo2', half: 'hud:ammo1' },
  };
  // foe bar colour cycle 0x17834: pens 3/4/5 of the bar row 0x0D per 100-HP layer (8 layers, table 0x17892):
  // [border, fill, under] where `under` is the previous layer's fill (layer 0: red)
  const foeCycle = Array.from({ length: 8 }, (_, l) => [0, 1, 2].map(k => word24(R.u16(T.foeCycle + l * 8 + k * 2))));
  lifeBar.foe = { layerHp: 100, cycle: foeCycle, rule: '0x174F2/0x17834: bar length = min(maxHP,100) px (left cap 6, 8-px mids, right cap 6: mids = ceil((len-6)/8)-1 for len > 6, at least one); HP is shown modulo 100 (100 stays 100) in the colours of layer floor((HP-1)/100) mod 8; pens: 3 border, 4 fill, 5 under' };
  const hudLayout = {
    note: 'arcade screen px of the P1 block and the slots, read from the live scroll1 dumps (stg-ep1-walk f0/f16/f72/f2400) and the draw routines: face 24x24 at (0,0); "=N" lives at column 3, row 0; the score right-aligned to x 128 on row 0 (digits 0x124+); the name at (24,8); the life bar at (24,16) (100 px of fill from x 26); the foe face 24x16 at (0,24), its name at (24,24) and its bar at (24,32); INSERT COIN 112x16 at (136,16) / (264,16); JOIN-IN 80x16 at (152,16) / (280,16)',
    face: [0, 0], lives: [24, 0], scoreRight: [128, 0], name: [24, 8], bar: [24, 16],
    foe: { face: [0, 24], name: [24, 24], bar: [24, 32] },
    insertCoin: [[136, 16], [264, 16]], joinIn: [[152, 16], [280, 16]],
    blink: { period: 128, joinIn: [0, 48], insertCoin: [64, 112] },
  };
  report.checks.hudG7 = checkHudG7(S, L, hudMapImgs, foeFaces, rows, report) || 'skipped (no live dumps)';
  report.checks.hudHalves = `score digits ${scoreHalves ? 'column-half independent' : 'DIFFER per half'}; ammo tiles ${ammoHalves ? 'column-half independent' : 'DIFFER per half'}`;

  // 4. title-card panel (stg-screens-card3 f300: scroll1 cols 10-37, rows 0-14, card page rows 1-11)
  const card = cardPanel(S, L, R, png, word24, extract, rows, useSlot, report);
  if (card) inputs.push(...card.inputs);
  // 5. title logo (KI5): the boot screen OBJ list (stg-screens-boot f330) re-rendered from the graphics ROM
  const logo = logoImage(R, png, word24, extract, rows, useSlot, report);
  if (logo) inputs.push(...logo.inputs);

  // 6. pack: font grids, portraits, patches, HUD pieces, card, logo
  const f8 = fontGrid(fonts.glyph8, 8), f16 = fontGrid(fonts.glyph16, 16);
  const images = { font8: f8.img, font16: f16.img, ...portraitImgs, ...patchImgs, ...hudImgs, ...hudMapImgs };
  if (card) images.cardPanel = card.img;
  if (logo) images.logo = logo.img;
  const items = Object.entries(images).map(([id, im]) => ({ id, w: im.w, h: im.h }));
  const pk = atlas.pack(items, { max: 1024, pad: 1, sort: 'height' }), pc = atlas.check(pk, items, { max: 1024, pad: 1 });
  if (!pc.ok) throw new Error(`sprites-ui: packing: ${pc.errors.slice(0, 3).join('; ')}`);
  if (pk.sheets.length !== 1) throw new Error(`sprites-ui: ${pk.sheets.length} sheets (one expected)`);
  const sh = pk.sheets[0], W = sh.w, Hh = sh.h, px = new Uint8Array(W * Hh * 4), view = new Uint8Array(W * Hh * 4), rc = {};
  const colourOf = v => rgbOf(rows[slotRow[v >> 4]][v & 15]);
  const hudColourOf = v => rgbOf(rows[`s1:${v >> 4}`][v & 15]);           // the `hud` map: slot = scroll1 palette row
  const place = {};
  for (const p of sh.places) {
    const im = images[p.id], hudMapped = !!hudMapImgs[p.id], col = hudMapped ? hudColourOf : colourOf; place[p.id] = p;
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
      const v = im.code[y * im.w + x]; if (v === 0xFFFF) continue;
      if (!hudMapped && slotRow[v >> 4] == null) throw new Error(`sprites-ui: ${p.id} uses slot ${v >> 4} without a row`);
      const q = ((p.y + y) * W + p.x + x) * 4, c = col(v);
      if (rgba) { px[q] = c[0]; px[q + 1] = c[1]; px[q + 2] = c[2]; } else { px[q] = v >> 4; px[q + 1] = v & 15; px[q + 2] = 0; }
      px[q + 3] = 255; view[q] = c[0]; view[q + 1] = c[1]; view[q + 2] = c[2]; view[q + 3] = 255;
    }
    if (p.id !== 'font8' && p.id !== 'font16') rc[p.id] = [p.x, p.y, im.w, im.h, 0, 0];
  }
  // sub-rects of the card panel (they share its pixels)
  if (card) for (const [k, r] of Object.entries(card.parts)) rc[k] = [place.cardPanel.x + r[0], place.cardPanel.y + r[1], r[2], r[3], 0, 0];
  const buf = png.encode({ width: W, height: Hh, rgba: px, palette: true }), dec = png.decode(buf);
  if (!png.equalVisible(dec, { width: W, height: Hh, rgba: px })) throw new Error('sprites-ui: sheet does not round-trip');
  const sheets = { ui: { png: png.dataURL(buf), w: W, h: Hh, sum: png.fnvIndexed(dec.rgba).toString(16) } };
  report.sheets.ui = { w: W, h: Hh, items: sh.places.length, pngBytes: buf.length, fill: Math.round(sh.places.reduce((n, p) => n + p.w * p.h, 0) / (W * Hh) * 10000) / 10000 };
  const glyphMap = (grid, origin, src) => { const m = { sheet: 'ui', map: 'ui' }; for (const [ch, [x, y, cells]] of Object.entries(grid.at)) m[ch] = cells === 2 ? [origin.x + x, origin.y + y, 2] : [origin.x + x, origin.y + y]; void src; return m; };
  const font8 = glyphMap(f8, place.font8), font16 = glyphMap(f16, place.font16);

  // 7. maps: `ui` colours every image; `text-<n>` = ui with the font slot on scroll1 row n (the ROM text colours)
  const slots = Object.keys(slotRow).map(Number).sort((a, b) => a - b);
  const keepRows = new Set(Object.values(slotRow));
  const mapUi = Array.from({ length: 32 }, (_, s) => (slotRow[s] != null ? slotRow[s] : null));
  const maps = { ui: mapUi };
  for (let n = 0; n < 16; n++) { const m = mapUi.slice(); m[0] = `s1:${n}`; maps[`text-${n}`] = m; keepRows.add(`s1:${n}`); }
  // G7: `hud` colours the cabinet HUD pieces (foe faces, JOIN-IN, score digits, weapon icons, ammo tiles) whose slot is
  // their scroll1 palette row
  maps.hud = Array.from({ length: 32 }, (_, s) => `s1:${s}`); for (let s = 0; s < 32; s++) keepRows.add(`s1:${s}`);
  const shippedRows = {}; for (const k of [...keepRows].sort()) shippedRows[k] = rows[k];

  // 8. the family
  const portraits = { sheet: 'ui', map: 'ui' }; for (const id of Object.keys(portraitImgs)) portraits[id] = id;
  const rom = (() => { try { return (lib.manifest || require('./manifest.cjs')).romSha1(); } catch (e) { return null; } })();
  const fam = {
    v: 1, family: 'ui', mode: rgba ? 'rgba' : 'indexed',
    build: { from: ['ROM scroll1 tiles and tables (see sprites-ui.cjs)', 'CARD_FROZEN / LOGO_FROZEN tile and OBJ lists in sprites-ui.cjs (from stg-screens-card3 f300 / stg-screens-boot f330)', 'work/re/extract/story/portraits/*.png, stages/screens/card3-f0300-scroll1.png, boot-f0330-sprites.png (checks)', 'campaign.js, mission-data.js, game.js, arcade-ui.js (font coverage check only)'],
      tool: 'tools/re/build-game-assets.cjs ui (tools/re/build/sprites-ui.cjs)', rom },
    sheets, rect: { ui: rc },
    pal: { rows: shippedRows, maps, home: 'ui', slots },
    map: 'ui',
    font8, font16,
    fontSource: { font8: fonts.src8, font16: fonts.src16, note: 'rom = the scroll1 tile drawn by the arcade printers (byte printers 0x0BAE/0x0BB6 for 8x8 ASCII, 0x84F72 for the narrow 8x16 story font); authored = composed from ROM glyphs (PLAN §4.1); a 16-px glyph carries cells 2' },
    portraits, portraitInfo,
    hudPortraits: Object.assign({}, HERO_PORTRAIT),
    hudFaces, hud: { insertCoin: 'hud:insertCoin', joinIn: 'hud:joinIn', score: 'hud:score', map: 'hud', names: p1Names, layout: hudLayout,
      note: 'the P1 block face (24x24, 0x16396) is hudFaces[hero]; hudPortraits names the 72x72 dialogue portrait of each hero (PLAN §4.1). G7: names = the P1 block names (0x16426); joinIn / score / foeFaces / weaponPanel images are drawn through the map `hud` (slot = scroll1 palette row); layout = the cabinet positions' },
    foeFaces, weaponPanel,
    lifeBar,
    cardFrame: card ? 'cardPanel' : null, card: card ? card.info : null,
    logo: logo ? { rec: 'logo', ...logo.info } : null,
    cloneMap: 'gel',
    units: { space: 'arcade screen px; rect [sx, sy, w, h, 0, 0] (top-left origin)', font: '[sx, sy] = top-left of the glyph cell on sheet ui (8x8 or 8x16), [sx, sy, 2] = a 16-px glyph', time: '60 Hz frames' },
  };
  report.acceptance = [
    { what: `font8 and font16 cover every character of campaign.js, mission-data.js, the HUD strings and the PLAN set (${report.fonts.required.length} characters)`, ok: !fonts.missing8.length && !fonts.missing16.length, detail: report.fonts.required },
    { what: 'authored glyphs for · and ’ (and “ ” — × …) composed from ROM glyphs', ok: ['·', '’', '“', '”', '—', '×', '…'].every(ch => font8[ch] && font16[ch]) },
    { what: 'portraits 0x00-0x0C render pixel-exact against story/portraits/portrait-0x0N.png (in the talk/blink state of the crop)', ok: Object.entries(portraitInfo).filter(([, v]) => v.check && /portrait-0x0[0-9A-C].png$/.test(v.check.against)).every(([, v]) => v.check.px === 0) && Object.keys(portraitInfo).length === PORTRAITS, detail: Object.entries(report.portraits).map(([k, v]) => `${k} ${v}`).join('; ') },
    { what: 'portrait 0x0D (no crop; never called) rendered from its own tables', ok: !!portraitImgs['0x0D'], detail: portraitInfo['0x0D'] && portraitInfo['0x0D'].check ? `vs the 0x03 crop: ${portraitInfo['0x0D'].check.px} px differ (a different tile map, 0xA3BFC)` : '' },
    { what: 'hudPortraits = portraits 0x00-0x03; hudFaces = the 24x24 P1-block faces (0x16396)', ok: Object.keys(hudFaces).length === 4 },
    { what: 'lifeBar tiles and pen row (scroll1 row 0x0D)', ok: !!lifeBar.full && barCodes.every(c => rc[`bar:${hexs(c, 3)}`]) },
    { what: 'G7: foe faces for the 39 HUD names and the 4 heroes, JOIN-IN, score digits, weapon icons, ammo tiles, the foe bar colour cycle', ok: Object.keys(foeFaces.enemy).length === T.foeCount && Object.keys(foeFaces.hero).length === 4 && Object.keys(hudMapImgs).every(k => rc[k]) && foeCycle.length === 8, detail: report.checks.hudG7 },
    { what: 'cardFrame from stages/screens/card*', ok: !!card, detail: report.checks.card || '' },
    { what: 'sequel: the card plate ships blank (no 1993 place name), cardPlateText is one flat colour', ok: !!card && card.plateBlank, detail: report.checks.plate || '' },
    { what: 'KI5 logo from the boot OBJ list', ok: !!logo, detail: report.checks.logo || '' },
  ];
  const file = path.join(out, 'sprite-data-ui.js');
  const res = emit.module(file, "SPRITE_DATA.add('ui',", fam);
  report.sizes['sprite-data-ui.js'] = res.bytes;
  const budget = (config.budgets && config.budgets.files && config.budgets.files['sprite-data-ui.js']) || 0.15 * 1048576;
  if (res.bytes > budget) report.warnings.push(`sprite-data-ui.js is ${res.bytes} bytes > ${budget} budget`);
  log(`sprites ui: ui ${W}x${Hh} ${sh.places.length} items (${report.sheets.ui.fill} fill, ${buf.length} B png); ${(res.bytes / 1048576).toFixed(3)} MB (budget ${(budget / 1048576).toFixed(3)})`);
  log(`sprites ui: fonts font8 ${report.fonts.font8} / font16 ${report.fonts.font16} glyphs cover ${JSON.stringify(report.fonts.required)}`);
  log(`sprites ui: portraits ${Object.entries(report.portraits).map(([k, v]) => `${k} ${v}`).join('; ')}`);
  for (const [k, v] of Object.entries(report.checks)) log(`sprites ui: check ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  for (const w of report.warnings) log(`sprites ui: WARN ${w}`);
  const files = [file];
  report.inputs = uniq(inputs).map(rel);

  const isRoot = path.resolve(out) === path.resolve(ROOT);
  if (opts.review !== false && isRoot) {
    const dir = path.join(ROOT, 'work', 're', 'build', 'sheets'); fs.mkdirSync(dir, { recursive: true });
    png.write(path.join(dir, 'ui-ui.png'), { width: W, height: Hh, rgba: view });
    try { report.contact = contactSheet({ fam, images, colourOf, hudColourOf, hudMapImgs, png, out: path.join(ROOT, 'work', 're', 'pack', 'ui-contact.png'), R, L, PT, origin: { 8: [place.font8.x, place.font8.y], 16: [place.font16.x, place.font16.y] } }); log(`sprites ui: contact sheet ${rel(report.contact)}`); }
    catch (e) { report.warnings.push(`contact sheet: ${e.message}`); log(`sprites ui: WARN contact sheet ${e.stack}`); }
  }
  report.summary = { sheet: report.sheets.ui, bytes: res.bytes, fonts: report.fonts, portraits: report.portraits, checks: report.checks, warnings: report.warnings.length };
  return { files, report };
}

// ------------------------------------------------------------------------------------------------ coverage scan
// Every character the sequel prints: campaign.js / mission-data.js strings (colour codes skipped), the upper-case
// string literals of game.js (HUD and menus) and arcade-ui.js (staff roll, name tags).
function coverageScan() {
  const files = [], chars = new Set();
  const addText = s => { for (const ch of String(s).toUpperCase()) chars.add(ch); };
  const win = {}; win.window = win; vm.createContext(win);
  for (const f of ['campaign.js', 'mission-data.js']) {
    const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue; files.push(p);
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), win, { filename: f }); } catch (e) { /* data files only */ }
  }
  const walk = v => { if (typeof v === 'string') { if (!/^#[0-9a-f]{3,8}$/i.test(v)) addText(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  for (const k of ['EDEN_CAMPAIGN', 'EDEN_INTRO', 'EDEN_ENDING', 'EDEN_MISSIONS']) if (win[k]) walk(win[k]);
  for (const f of ['game.js', 'arcade-ui.js']) {
    const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue; files.push(p);
    const src = fs.readFileSync(p, 'utf8'), re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g; let m;
    while ((m = re.exec(src))) { const s = (m[1] != null ? m[1] : m[2]).replace(/\\(.)/g, '$1'); if (s.length >= 3 && /[A-Z]{2}/.test(s) && /^[A-Z0-9 .,:;!?'’‘“”"\-·\/()&+×%=*#…—]+$/.test(s)) addText(s); }
  }
  return { files, chars };
}

// ------------------------------------------------------------------------------------------------ HUD check
// the HUD face, bar and INSERT COIN tiles against the live HUD of stg-ep1-walk (scroll1 dump + palettes)
function checkHud(S, L, png, hudImgs, rows, report) {
  const fr = runFrame('stg-ep1-walk', 2400); if (!fr || !fr.scroll) { report.warnings.push('HUD check skipped: stg-ep1-walk f2400 not present'); return null; }
  const F = S.loadFrame('stg-ep1-walk', fr), Rg = S.regs(F), page = F.pal.pages[1];
  const cell = (c, r) => S.tileEntry(F, 1, ((c * 8 + 64 + Rg.s[1].x) & 511) >> 3, ((r * 8 + 16 + Rg.s[1].y) & 511) >> 3);
  let bad = 0, px = 0;
  const cmp = (img, c0, r0) => {
    for (let r = 0; r < img.h / 8; r++) for (let c = 0; c < img.w / 8; c++) {
      const e = cell(c0 + c, r0 + r), t = S.tilePens(1, e.code, (c0 + c) & 1);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const v = img.code[(r * 8 + y) * img.w + c * 8 + x], p = t[y * 8 + x];
        if (v === 0xFFFF && p === 15) continue; px++;
        if (v === 0xFFFF || p === 15) { bad++; continue; }
        const a = page[e.attr & 31][p], b = rows[`s1:${v >> 4}`][v & 15];
        if (a[0] !== ((b >> 16) & 255) || a[1] !== ((b >> 8) & 255) || a[2] !== (b & 255)) bad++;
      }
    }
  };
  cmp(hudImgs['hud:jack'], 0, 0);
  cmp(hudImgs['hud:insertCoin'], 17, 2);
  const e = cell(4, 2); if (hudImgs[`bar:0x${e.code.toString(16).toUpperCase()}`] == null) bad++;
  return `HUD face (Jack), INSERT COIN and the bar tiles vs stg-ep1-walk f2400 scroll1: ${px} px, ${bad} off`;
}

// G7: the foe faces, JOIN-IN and the score digits against the live HUD of stg-ep1-walk (f0: FERRIS, f16: GNEISS and
// JOIN-IN in both slots, f1888: score 100), pixel by pixel through the live palette page, plus the cell positions of
// the P1 block the game copies (name at column 3 of row 1, bar caps at columns 3/15 of row 2, foe name / bar at row 3/4)
function checkHudG7(S, L, imgs, foeFaces, rows, report) {
  const out = []; let px = 0, bad = 0, cells = 0, badCells = 0;
  for (const [f, what] of [[0, 'foe 0x00'], [16, 'foe 0x01 + JOIN-IN'], [1888, 'score 100']]) {
    const fr = runFrame('stg-ep1-walk', f); if (!fr || !fr.scroll) { report.warnings.push(`HUD G7 check: stg-ep1-walk f${f} not present`); continue; }
    const F = S.loadFrame('stg-ep1-walk', fr), Rg = S.regs(F), page = F.pal.pages[1];
    const cell = (c, r) => S.tileEntry(F, 1, ((c * 8 + 64 + Rg.s[1].x) & 511) >> 3, ((r * 8 + 16 + Rg.s[1].y) & 511) >> 3);
    const cmp = (img, c0, r0) => {
      for (let r = 0; r < img.h / 8; r++) for (let c = 0; c < img.w / 8; c++) {
        const e = cell(c0 + c, r0 + r), t = S.tilePens(1, e.code, (c0 + c) & 1);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const v = img.code[(r * 8 + y) * img.w + c * 8 + x], p = t[y * 8 + x];
          if (v === 0xFFFF && p === 15) continue; px++;
          if (v === 0xFFFF || p === 15) { bad++; continue; }
          const a = page[e.attr & 31][p], b = rows[`s1:${v >> 4}`][v & 15];
          if (a[0] !== ((b >> 16) & 255) || a[1] !== ((b >> 8) & 255) || a[2] !== (b & 255)) bad++;
        }
      }
    };
    const want = (c, r, ok, label) => { cells++; const e = cell(c, r); if (!ok(e.code)) { badCells++; report.warnings.push(`HUD G7 cell ${label} at column ${c} row ${r}: 0x${e.code.toString(16)}`); } };
    if (f === 0 || f === 16) {
      cmp(imgs[foeFaces.enemy[f === 0 ? '0x00' : '0x01']], 0, 3);
      'JACK.T'.split('').forEach((ch, i) => want(3 + i, 1, c => c === ch.charCodeAt(0), 'P1 name'));
      want(3, 2, c => c === 0x90C, 'bar left cap'); want(15, 2, c => c === 0x983, 'bar right cap');
      (f === 0 ? 'FERRIS' : 'GNEISS').split('').forEach((ch, i) => want(3 + i, 3, c => c === ch.charCodeAt(0), 'foe name'));
      want(3, 4, c => (c >= 0x913 && c <= 0x91F) || (c >= 0x990 && c <= 0x999), 'foe bar');
      want(3, 0, c => c === 0x3D, 'lives "="');
    }
    if (f === 16) { cmp(imgs['hud:joinIn'], 19, 2); cmp(imgs['hud:joinIn'], 35, 2); }
    if (f === 1888) {
      const digits = { 1: 0x125, 0: 0x124 }, im = imgs['hud:score'];
      [[13, 1], [14, 0], [15, 0]].forEach(([c, d]) => { const one = { w: 8, h: 8, code: new Uint16Array(64) }; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) one.code[y * 8 + x] = im.code[y * im.w + d * 8 + x]; cmp(one, c, 0); want(c, 0, code => code === digits[d], 'score digit'); });
    }
    out.push(what);
  }
  if (!out.length) return null;
  return `foe faces, JOIN-IN and score digits vs stg-ep1-walk (${out.join('; ')}): ${px} px, ${bad} off; ${cells} P1-block cells, ${badCells} off`;
}

// ------------------------------------------------------------------------------------------------ card panel
// the frozen cell list -> [{c, r, code, attr, half}] (half = the scroll1 column parity the tile was drawn in)
function cardCells(F0) {
  const out = [];
  F0.cells.forEach((line, r) => line.trim().split(/\s+/).forEach((s, c) => {
    const tx = (((F0.col0 + c) * 8 + 64 + F0.scroll[0]) & 511) >> 3;
    out.push({ c, r, code: parseInt(s.slice(0, 4), 16), attr: parseInt(s.slice(4), 16), half: tx & 1 });
  }));
  return out;
}
// the same list read from the run dump (cross-check of CARD_FROZEN, report only)
function cardFromRun(S, F0) {
  const fr = runFrame(F0.run, F0.frame); if (!fr || !fr.scroll) return null;
  const F = S.loadFrame(F0.run, fr), Rg = S.regs(F), page = F.pal.pages[1], cells = [], pals = {};
  for (let r = 0; r < F0.cells.length; r++) {
    const row = [];
    for (let c = 0; c < F0.cells[0].trim().split(/\s+/).length; c++) {
      const tx = (((F0.col0 + c) * 8 + 64 + Rg.s[1].x) & 511) >> 3, ty = (((F0.row0 + r) * 8 + 16 + Rg.s[1].y) & 511) >> 3, e = S.tileEntry(F, 1, tx, ty);
      row.push(e.code.toString(16).padStart(4, '0') + e.attr.toString(16).padStart(2, '0'));
      if (e.code !== 0x20) pals[e.attr & 31] = page[e.attr & 31].map(([R, G, B]) => ((R << 16) | (G << 8) | B).toString(16).padStart(6, '0')).join(' ');
    }
    cells.push(row.join(' '));
  }
  const same = Rg.s[1].x === F0.scroll[0] && Rg.s[1].y === F0.scroll[1] && cells.every((l, i) => l === F0.cells[i].trim()) && Object.keys(pals).length === Object.keys(F0.pals).length && Object.entries(pals).every(([p, v]) => F0.pals[p] === v);
  return same;
}
// the place-name plate: row 13, cols 7-18 of the panel; its name tiles are cols 9-16 (the 1993 card reads WASTE LAND)
const PLATE = { row: 13, c0: 7, c1: 18, text0: 9, text1: 16, blank: 0xDE9 };
function cardPanel(S, L, R, png, word24, extract, rows, useSlot, report) {
  const F0 = CARD_FROZEN, C0 = F0.col0, R0 = F0.row0, cells = cardCells(F0);
  const COLS = F0.cells[0].trim().split(/\s+/).length, ROWS = F0.cells.length;
  // card palettes p (1-11) -> sheet slots (11 is INSERT COIN's slot: the card's row 11 goes to slot 26)
  const slotOfCard = p => (p === 11 ? 26 : p);
  const img = blank(COLS * 8, ROWS * 8), used = new Set();
  for (const e of cells) {
    if (e.code === 0x20) continue;
    const p = e.attr & 31;
    if (p < 1 || p > 11) throw new Error(`sprites-ui: card tile palette ${p}`);
    used.add(p);
    put(img, L.tile(e.code, slotOfCard(p), { fx: !!(e.attr & 0x20), fy: !!(e.attr & 0x40), half: e.half }), e.c * 8, e.r * 8);
  }
  const romPage = Array.from({ length: 32 }, (_, r) => Array.from({ length: 16 }, (_, k) => word24(R.u16(T.cardPage + (r * 16 + k) * 2))));
  const live = {};
  for (const p of [...used].sort((a, b) => a - b)) {
    if (!F0.pals[p]) throw new Error(`sprites-ui: CARD_FROZEN has no palette row ${p}`);
    const row = F0.pals[p].split(' ').map(h => parseInt(h, 16));
    live[p] = row.every((v, i) => v === romPage[p][i]) ? 'rom 0xBC252' : 'live (palette cycling)';
    useSlot(slotOfCard(p), `card:${p}`, row);
  }
  // check against the extract composite (scroll1 is the top layer of the card screen), before the plate is blanked
  const snapFile = path.join(extract, 'stages', 'screens', 'card3-f0300-scroll1.png'), inputs = [];
  if (fs.existsSync(snapFile)) {
    inputs.push(snapFile); const ref = png.read(snapFile); let bad = 0, px = 0;
    const x0 = C0 * 8 - ((F0.scroll[0] + 64) & 7), y0 = R0 * 8 - ((F0.scroll[1] + 16) & 7);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const v = img.code[y * img.w + x], X = x0 + x, Y = y0 + y; if (X < 0 || Y < 0 || X >= ref.width || Y >= ref.height) continue;
      const q = (Y * ref.width + X) * 4; if (v === 0xFFFF && !ref.rgba[q + 3]) continue; px++;
      if (v === 0xFFFF || !ref.rgba[q + 3]) { bad++; continue; }
      const c = rows[`card:${v >> 4 === 26 ? 11 : v >> 4}`][v & 15]; if (((c >> 16) & 255) !== ref.rgba[q] || ((c >> 8) & 255) !== ref.rgba[q + 1] || (c & 255) !== ref.rgba[q + 2]) bad++;
    }
    report.checks.card = `card panel vs ${rel(snapFile)}: ${px} px, ${bad} off`;
    if (bad) throw new Error(`sprites-ui: ${report.checks.card}`);
  } else report.warnings.push('card check skipped: stages/screens/card3-f0300-scroll1.png not present');
  const run = cardFromRun(S, F0);
  report.checks.cardList = run == null ? `CARD_FROZEN (${F0.run} f${F0.frame}): dump not present, list used as frozen` : `CARD_FROZEN ${run ? 'equals' : 'DIFFERS from'} ${F0.run} f${F0.frame} (${cells.length} cells, ${Object.keys(F0.pals).length} palette rows)`;
  if (run === false) report.warnings.push(report.checks.cardList);
  // SEQUEL: the plate ships blank. Each name tile keeps its top two rows (the plate's edge and dark rule) and takes
  // rows 2-7 of the plate's own empty interior tile 0x0DE9 (the cell right of the name), so no 1993 place name ships
  const plateNames = [];
  for (const e of cells) {
    if (e.r !== PLATE.row || e.c < PLATE.text0 || e.c > PLATE.text1) continue;
    plateNames.push(hexs(e.code, 3));
    const fill = L.tile(PLATE.blank, slotOfCard(e.attr & 31), { half: e.half });
    for (let y = 2; y < 8; y++) for (let x = 0; x < 8; x++) img.code[(e.r * 8 + y) * img.w + e.c * 8 + x] = fill[y * 8 + x];
  }
  const blankCell = cells.find(e => e.r === PLATE.row && e.c === PLATE.text1 + 1);
  const win = new Set(); for (let y = 2; y < 8; y++) for (let x = (PLATE.text0 - 1) * 8; x < (PLATE.text1 + 2) * 8; x++) win.add(img.code[(PLATE.row * 8 + y) * img.w + x]);
  const plateBlank = win.size === 1 && !win.has(0xFFFF);
  report.checks.plate = `plate name tiles ${plateNames.join(',')} blanked from ${hexs(PLATE.blank, 3)}: the text window holds ${win.size} colour code(s) ${[...win].map(v => `${v >> 4}:${v & 15}`).join(',')}`;
  if (!blankCell || blankCell.code !== PLATE.blank) throw new Error(`sprites-ui: card plate: cell right of the name is not ${hexs(PLATE.blank, 3)}`);
  // emblem = rows 0-1 (cols 22-29 of the screen), plate = row 13 cols 17-28 (text window cols 18-27, rows 2-7 of the
  // cell), map window = rows 2-13, bottom line = row 14
  const parts = {
    cardEmblem: [(22 - C0) * 8, 0, 64, 16], cardMap: [0, 16, COLS * 8, 96], cardLine: [0, 14 * 8, COLS * 8, 8],
    cardPlate: [PLATE.c0 * 8, PLATE.row * 8, (PLATE.c1 - PLATE.c0 + 1) * 8, 8],
    cardPlateText: [(PLATE.text0 - 1) * 8, PLATE.row * 8 + 2, (PLATE.text1 - PLATE.text0 + 3) * 8, 6],
  };
  return {
    img, parts, inputs, plateBlank,
    info: { panel: 'cardPanel', size: [COLS * 8, ROWS * 8], emblem: 'cardEmblem', plate: 'cardPlate', plateText: 'cardPlateText', map: 'cardMap', line: 'cardLine', rects: parts, palettes: live,
      plate1993: { tiles: plateNames, text: 'WASTE LAND', note: 'not shipped: the name tiles are blanked' },
      note: 'the 1993 title-card panel (EPISODE 3 card, stg-screens-card3 f300, scroll1 cols 10-37 rows 0-14) re-rendered from the ROM: the world map in rows 2-13 (224x96, the size ARCADE_UI expects for p-card-map), the emblem over its top edge, the place-name plate and the bottom line; the frame is part of the map tiles, so cardFrame names the whole panel. SEQUEL: the plate ships blank (its 8 name tiles take the interior of the ROM blank plate tile 0x0DE9 below their top edge); print the chapter name in cardPlateText (80x6 tan interior, pen 3 of row card:1) with the ROM font' },
  };
}

// ------------------------------------------------------------------------------------------------ title logo (KI5)
function logoImage(R, png, word24, extract, rows, useSlot, report) {
  const F0 = LOGO_FROZEN;
  const blocks = F0.blocks.map(([code, sx, sy, bw, bh, flip, pal]) => ({ code, sx, sy, bw, bh, flipX: !!(flip & 1), flipY: !!(flip & 2), pal }));
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const o of blocks) { x0 = Math.min(x0, o.sx); y0 = Math.min(y0, o.sy); x1 = Math.max(x1, o.sx + 16 * o.bw); y1 = Math.max(y1, o.sy + 16 * o.bh); }
  const W = x1 - x0, H = y1 - y0, img = blank(W, H);
  // logo OBJ palettes -> sheet slots 27-31 (pal p -> 27 + rank)
  const palList = uniq(blocks.map(o => o.pal)).sort((a, b) => a - b);
  if (palList.length > 5) throw new Error(`sprites-ui: logo uses ${palList.length} OBJ palettes`);
  const slotOf = p => 27 + palList.indexOf(p);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const o = blocks[i], fx = o.flipX, fy = o.flipY;
    for (let r = 0; r < o.bh; r++) for (let c = 0; c < o.bw; c++) {
      const col = fx ? o.bw - 1 - c : c, row = fy ? o.bh - 1 - r : r, t = R.tile((o.code & ~0xF) + ((o.code + col) & 0xF) + 0x10 * row);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const p = t[(fy ? 15 - y : y) * 16 + (fx ? 15 - x : x)]; if (p === 15) continue;
        const X = o.sx - x0 + c * 16 + x, Y = o.sy - y0 + r * 16 + y; img.code[Y * W + X] = slotOf(o.pal) * 16 + p;
      }
    }
  }
  const b = bbox(img), cimg = crop(img, b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  const info = { at: [x0 + b.x0, y0 + b.y0], palettes: {} };
  for (const p of palList) {
    if (!F0.pals[p]) throw new Error(`sprites-ui: LOGO_FROZEN has no OBJ palette ${p}`);
    const row = F0.pals[p].split(' ').map(h => word24(parseInt(h, 16)));
    useSlot(slotOf(p), `logo:${p}`, row); info.palettes[slotOf(p)] = `OBJ palette ${p} of ${F0.run} f${F0.frame}`;
  }
  // check against the extract render of the same OBJ list
  const sf = path.join(extract, 'stages', 'screens', 'boot-f0330-sprites.png'), inputs = [];
  if (fs.existsSync(sf)) {
    inputs.push(sf); const ref = png.read(sf); let bad = 0, px = 0;
    for (let y = 0; y < cimg.h; y++) for (let x = 0; x < cimg.w; x++) {
      const v = cimg.code[y * cimg.w + x], X = info.at[0] + x, Y = info.at[1] + y; if (X < 0 || Y < 0 || X >= ref.width || Y >= ref.height) continue;
      const q = (Y * ref.width + X) * 4; if (v === 0xFFFF && !ref.rgba[q + 3]) continue; px++;
      if (v === 0xFFFF || !ref.rgba[q + 3]) { bad++; continue; }
      const c = rows[`logo:${palList[(v >> 4) - 27]}`][v & 15]; if (((c >> 16) & 255) !== ref.rgba[q] || ((c >> 8) & 255) !== ref.rgba[q + 1] || (c & 255) !== ref.rgba[q + 2]) bad++;
    }
    report.checks.logo = `logo vs ${rel(sf)}: ${px} px, ${bad} off`;
    if (bad) throw new Error(`sprites-ui: ${report.checks.logo}`);
  } else report.warnings.push('logo check skipped: stages/screens/boot-f0330-sprites.png not present');
  // cross-check of the frozen list with the dump (report only)
  const fr = runFrame(F0.run, F0.frame);
  if (fr && fr.obj && fr.pal) {
    const live = fr.obj.filter(o => o.pal != null).map(o => [o.code, o.sx, o.sy, o.bw, o.bh, (o.flipX ? 1 : 0) | (o.flipY ? 2 : 0), o.pal]);
    const words = p => Array.from({ length: 16 }, (_, k) => fr.pal.slice((p * 16 + k) * 4, (p * 16 + k) * 4 + 4).toLowerCase()).join(' ');
    const same = JSON.stringify(live) === JSON.stringify(F0.blocks) && palList.every(p => words(p) === F0.pals[p]);
    report.checks.logoList = `LOGO_FROZEN ${same ? 'equals' : 'DIFFERS from'} ${F0.run} f${F0.frame} (${F0.blocks.length} OBJ blocks, palettes ${palList.join('/')})`;
    if (!same) report.warnings.push(report.checks.logoList);
  } else report.checks.logoList = `LOGO_FROZEN (${F0.run} f${F0.frame}): dump not present, list used as frozen`;
  info.note = 'KI5: the CADILLACS AND DINOSAURS logo of the boot screen (the OBJ blocks of stg-screens-boot f330, frozen in sprites-ui.cjs LOGO_FROZEN, re-rendered from the graphics ROM); at = its top-left on the 384x224 screen. It is the 1993 mark: the sequel title adds its "II" / subtitle in the ROM font';
  return { img: cimg, info, inputs };
}

// ------------------------------------------------------------------------------------------------ contact sheet
function contactSheet({ fam, images, colourOf, hudColourOf, hudMapImgs, png, out, R, L, PT, origin }) {
  const D = require('../export/lib/draw.cjs');
  const W = 1100; let y = 8; const draws = [];
  const label = (t, x, yy) => draws.push({ t, x, y: yy });
  const blit = (im, x, yy, sc = 1, col) => draws.push({ im, x, y: yy, sc, col });
  // fonts: every glyph at 2x, both sizes
  label('FONT8 (2X): ' + Object.keys(fam.font8).filter(k => k.length === 1).sort().join(' '), 8, y); y += 12;
  blit(images.font8, 8, y, 3); y += images.font8.h * 3 + 10;
  label('FONT16 (2X)', 8, y); y += 12; blit(images.font16, 8, y, 3); y += images.font16.h * 3 + 10;
  // sample lines
  label('SAMPLES (FONT8 / FONT16, 2X)', 8, y); y += 12;
  const sample = ["THE GANG’S “COLD POD · LOT 07” IS EMPTY...", 'CHAPTER 06: MIRROR WAR — 1993 × 2; (FESSENDEN)', 'INSERT COIN / JOIN-IN · CREDIT 3 · HP 100%!?'];
  for (const s of sample) for (const font of [8, 16]) {
    const map = font === 8 ? fam.font8 : fam.font16, grid = font === 8 ? images.font8 : images.font16, line = blank(s.length * 16 + 16, font); let x = 0;
    for (const ch0 of s) { const ch = ch0 === ' ' ? null : ch0.toUpperCase(); if (!ch || !map[ch]) { x += 8; continue; } const [sx, sy, c] = map[ch], w = (c || 1) * 8; const base = origin[font]; putImg(line, crop(grid, sx - base[0], sy - base[1], w, font), x, 0); x += w; }
    blit(line, 8, y, 2); y += font * 2 + 4;
  }
  y += 6;
  // portraits with every talk / blink state
  label('PORTRAITS 0X00-0X0D: BASE, MOUTH 0-2, EYES 0-1 (2X)', 8, y); y += 12;
  for (const P of PT) {
    const id = hexs(P.i, 2), info = fam.portraitInfo[id]; let x = 8;
    label(`${id} ${info.name.toUpperCase()} ${info.row}`, 8, y); y += 10;
    const states = [null]; if (info.mouth) for (let k = 0; k < 3; k++) states.push(['mouth', k]); if (info.eyes) for (let k = 0; k < 2; k++) states.push(['eyes', k]);
    for (const st of states) {
      const im = blank(72, 72); putImg(im, images[id], 0, 0);
      if (st) { const part = info[st[0]], patch = images[part.frames[st[1]]]; for (let yy = 0; yy < patch.h; yy++) for (let xx = 0; xx < patch.w; xx++) im.code[(part.at[1] + yy) * 72 + part.at[0] + xx] = patch.code[yy * patch.w + xx]; }
      blit(im, x, y, 2); x += 150;
    }
    y += 150;
  }
  label('HUD FACES, LIFE BAR TILES, INSERT COIN (3X)', 8, y); y += 12;
  { let x = 8; for (const h of HERO_IDS) { blit(images[`hud:${h}`], x, y, 3); x += 80; } for (const k of Object.keys(images).filter(k => k.startsWith('bar:'))) { blit(images[k], x, y, 3); x += 28; } y += 80; blit(images['hud:insertCoin'], 8, y, 3); y += 56; }
  if (hudMapImgs && hudColourOf) {
    label('G7 CABINET HUD (MAP HUD, 2X): FOE FACES 0X00-0X26 + HEROES, JOIN-IN, SCORE DIGITS, WEAPON ICONS, AMMO TILES', 8, y); y += 12;
    let x = 8;
    for (const k of Object.keys(hudMapImgs)) { const im = hudMapImgs[k]; if (x + im.w * 2 > W - 8) { x = 8; y += 40; } blit(im, x, y, 2, hudColourOf); x += im.w * 2 + 6; }
    y += 44;
  }
  if (images.cardPanel) { label('TITLE CARD PANEL (2X)', 8, y); y += 12; blit(images.cardPanel, 8, y, 2); y += images.cardPanel.h * 2 + 8; }
  if (images.logo) { label('TITLE LOGO (KI5, 2X)', 8, y); y += 12; blit(images.logo, 8, y, 2); y += images.logo.h * 2 + 8; }
  const cv = new D.Canvas(W, y + 8, [24, 26, 30, 255]);
  for (const d of draws) {
    if (d.t) { cv.text(d.t, d.x, d.y, [255, 230, 120]); continue; }
    const im = d.im; if (!im || !im.w) continue;
    for (let yy = 0; yy < im.h; yy++) for (let xx = 0; xx < im.w; xx++) { const v = im.code[yy * im.w + xx]; if (v === 0xFFFF) continue; const c = (d.col || colourOf)(v); for (let a = 0; a < d.sc; a++) for (let b = 0; b < d.sc; b++) cv.set(d.x + xx * d.sc + b, d.y + yy * d.sc + a, c); }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true }); cv.png(out);
  void R; void L;
  return out;
}

module.exports = { build, coverageScan, NARROW, T };

if (require.main === module) {
  const argv = process.argv.slice(2), outI = argv.indexOf('--out');
  const out = outI >= 0 ? path.resolve(argv[outI + 1]) : ROOT;
  const t0 = Date.now();
  const r = build({ out, rgba: argv.includes('--rgba'), log: (...a) => console.log(...a) });
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${r.files.map(rel).join(', ')}`);
}
