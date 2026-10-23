/* arcade-ui.js: ARCADE_UI, the arcade-style text and screen renderer (WP-I of work/re/design/PLAN.md).

   Everything here draws in ARCADE SCREEN COORDINATES (384x224) under the caller's transform: the caller sets
   ctx.setTransform(PX,0,0,PX,...) once per frame (ARCHITECTURE.md D2) and passes the context as `g`. Nothing here
   reads the clock or the random generator: every animation (typing, blinking, fading, scrolling) is a function of
   the frame count the caller passes as `t`/`typed`, so a frame renders the same way every time.

   Fonts and portraits come from the ROM ui family (`window.ROM_UI`, PLAN §4.1, built by WP-D and published by
   sprites.js) when it is present. The ROM font is a source of glyph SHAPES: each tile is decoded once into ink and
   shadow masks (romGlyphs) and the ink is painted in the requested pen (ARCADE_UI.PEN or a CSS colour) with the
   same shadow/outline passes as the authored font, so the family needs no per-pen palette maps. Until the sheet is
   decodable, and for every glyph the ROM lacks, an authored 8x8 bitmap font is used (the 8x16 variant doubles its
   rows, which gives the 1-px verticals and 2-px horizontals of the ROM's narrow font). Pictures (`pic`) are resolved
   through ARCADE_UI.registerPic(), then STAGE_DATA.pics, else a placeholder box of the declared size is drawn so
   layouts stay honest while the art is missing.

   Layout evidence: work/re/extract/stages/screens/card*-snap.png (intermissions, title cards), the story runs
   under work/re/runs/story-* (dialogue boxes, captions, staff roll, continue count) and CAMPAIGN.md §4.7, §11. */
(function (root) {
  'use strict';
  const AW = 384, AH = 224;

  /* ---------- constants shared with the game and the tests ---------- */
  // ARCHITECTURE §1.7; the weapon rect is the cabinet panel (0,208)-(120,224) of the ROM routine 0x23A24 (PLAN §7 G7)
  const RECTS = { hud: [0, 0, 384, 44], radio: [8, 46, 368, 14], weapon: [0, 208, 120, 16],
                  radioTall: [8, 46, 368, 32] };                                                 // radio({font:16}): two 8x16 rows, y 46-78 < 81 (polish L50)
  const LIMITS = { panelChars: 30, panelLines: 4, radioChars: 72, radioCols: 45, typeRate: 2 };   // CAMPAIGN D11
  const TIMING = { caption: 150, bossCard: 144, pre: 120, panelHold: 210, radioHold: 276, blink: 32, tallyRow: 30 };
  const PEN = { white: '#f8f8f8', red: '#e8402c', yellow: '#f8d838', blue: '#58a8f8', acid: '#9dff6d', grey: '#a8a8a8',
                orange: '#f0a030', pink: '#ff8bd0', shadow: '#141414', black: '#000000' };
  const PORTRAIT_INDEX = { jack: 0, hannah: 1, mustapha: 2, mess: 3, fessenden: 4 };               // CAST.md
  const HERO_NAMES = { jack: 'JACK', hannah: 'HANNAH', mustapha: 'MUSTAPHA', mess: 'MESS', fessenden: 'FESSENDEN', clone: 'YOUR CLONE', sable: 'SABLE', echo: 'ECHO' };
  // Marker spots on the 224x96 card map, keyed by the shipped campaign.js card.marker ids (CAMPAIGN §12.1: wassoon,
  // causeway, frontier, city-in-the-sea, cliffs, river-head). Authored guesses; a card's `markerAt` overrides them.
  const CARD_MARKERS = { wassoon: [166, 66], causeway: [124, 80], frontier: [40, 34], 'city-in-the-sea': [176, 46], cliffs: [60, 72], 'river-head': [196, 20] };
  const STAFF_ROLL = [                                                                             // CAMPAIGN §11.4
    ['CADILLACS & DINOSAURS II', ['THE CROWN TIDE']],
    ['AN UNOFFICIAL FAN SEQUEL', ['MADE FOR MOSTAFA']],
    ['ORIGINAL GAME', ['CAPCOM 1993']],
    ['BASED ON', ['XENOZOIC TALES', 'BY MARK SCHULTZ']],
    ['ORIGINAL ART AND MUSIC', ['CAPCOM']],
    ['SEQUEL STORY, LEVELS', ['AND ENGINE', 'MADE FOR THIS GAME']],
    ['AND', ['YOU.']]
  ];

  /* ---------- the fallback font: 8x8 cells, authored; '#' = pen, '.' = clear; a 16-column glyph spans 2 cells ---------- */
  const GLYPHS = {
    A: '.####..|#....#.|#....#.|######.|#....#.|#....#.|#....#.',
    B: '#####..|#....#.|#....#.|#####..|#....#.|#....#.|#####..',
    C: '.####..|#....#.|#......|#......|#......|#....#.|.####..',
    D: '####...|#...#..|#....#.|#....#.|#....#.|#...#..|####...',
    E: '######.|#......|#......|#####..|#......|#......|######.',
    F: '######.|#......|#......|#####..|#......|#......|#......',
    G: '.####..|#....#.|#......|#..###.|#....#.|#....#.|.####..',
    H: '#....#.|#....#.|#....#.|######.|#....#.|#....#.|#....#.',
    I: '.###...|..#....|..#....|..#....|..#....|..#....|.###...',
    J: '...###.|....#..|....#..|....#..|....#..|#...#..|.###...',
    K: '#....#.|#...#..|#..#...|###....|#..#...|#...#..|#....#.',
    L: '#......|#......|#......|#......|#......|#......|######.',
    M: '#.....#|##...##|#.#.#.#|#..#..#|#.....#|#.....#|#.....#',
    N: '#....#.|##...#.|#.#..#.|#..#.#.|#...##.|#....#.|#....#.',
    O: '.####..|#....#.|#....#.|#....#.|#....#.|#....#.|.####..',
    P: '#####..|#....#.|#....#.|#####..|#......|#......|#......',
    Q: '.####..|#....#.|#....#.|#....#.|#..#.#.|#...#..|.###.#.',
    R: '#####..|#....#.|#....#.|#####..|#..#...|#...#..|#....#.',
    S: '.####..|#....#.|#......|.####..|.....#.|#....#.|.####..',
    T: '#####..|..#....|..#....|..#....|..#....|..#....|..#....',
    U: '#....#.|#....#.|#....#.|#....#.|#....#.|#....#.|.####..',
    V: '#....#.|#....#.|#....#.|#....#.|.#..#..|.#..#..|..##...',
    W: '#.....#|#.....#|#.....#|#..#..#|#.#.#.#|##...##|#.....#',
    X: '#....#.|#....#.|.#..#..|..##...|.#..#..|#....#.|#....#.',
    Y: '#...#..|#...#..|.#.#...|..#....|..#....|..#....|..#....',
    Z: '######.|.....#.|....#..|...#...|..#....|.#.....|######.',
    '0': '.####..|#....#.|#...##.|#.#..#.|##...#.|#....#.|.####..',
    '1': '..#....|.##....|..#....|..#....|..#....|..#....|.###...',
    '2': '.####..|#....#.|.....#.|...##..|..#....|.#.....|######.',
    '3': '.####..|#....#.|.....#.|..###..|.....#.|#....#.|.####..',
    '4': '....#..|...##..|..#.#..|.#..#..|######.|....#..|....#..',
    '5': '######.|#......|#####..|.....#.|.....#.|#....#.|.####..',
    '6': '.####..|#......|#......|#####..|#....#.|#....#.|.####..',
    '7': '######.|.....#.|....#..|...#...|..#....|..#....|..#....',
    '8': '.####..|#....#.|#....#.|.####..|#....#.|#....#.|.####..',
    '9': '.####..|#....#.|#....#.|.#####.|.....#.|.....#.|.####..',
    '.': '.......|.......|.......|.......|.......|..##...|..##...',
    ',': '.......|.......|.......|.......|..##...|..##...|.#.....',
    ':': '.......|..##...|..##...|.......|..##...|..##...|.......',
    ';': '.......|..##...|..##...|.......|..##...|..##...|.#.....',
    '!': '..#....|..#....|..#....|..#....|..#....|.......|..#....',
    '?': '.####..|#....#.|.....#.|...##..|..#....|.......|..#....',
    "'": '..#....|..#....|.#.....|.......|.......|.......|.......',
    '"': '.#..#..|.#..#..|.#..#..|.......|.......|.......|.......',
    '-': '.......|.......|.......|.####..|.......|.......|.......',
    '—': '.......|.......|.......|######.|.......|.......|.......',
    '·': '.......|.......|..##...|..##...|.......|.......|.......',
    '/': '.....#.|....#..|...#...|..#....|.#.....|#......|.......',
    '<': '....#..|...#...|..#....|.#.....|..#....|...#...|....#..',
    '>': '.#.....|..#....|...#...|....#..|...#...|..#....|.#.....',
    '(': '...#...|..#....|.#.....|.#.....|.#.....|..#....|...#...',
    ')': '.#.....|..#....|...#...|...#...|...#...|..#....|.#.....',
    '&': '.##....|#..#...|#..#...|.##..#.|#..##..|#...#..|.###.#.',
    '+': '.......|..#....|..#....|#####..|..#....|..#....|.......',
    '=': '.......|.......|.####..|.......|.####..|.......|.......',
    '×': '.......|#...#..|.#.#...|..#....|.#.#...|#...#..|.......',
    '%': '##...#.|##..#..|...#...|..#....|.#..##.|#...##.|.......',
    '*': '.......|.#.#.#.|..###..|.#####.|..###..|.#.#.#.|.......',
    '…': '................|................|................|................|................|.##....##....##.|.##....##....##.',
    ' ': '.......|.......|.......|.......|.......|.......|.......'
  };
  // Characters that are drawn as another glyph. The ROM printer has one glyph pair for "..." (0x6CA+0x6CB).
  const ALIAS = { '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '‐': '-', '•': '·', ' ': ' ' };
  const CHARSET = Object.keys(GLYPHS).concat(Object.keys(ALIAS));

  // Decoded glyph: {cells, rows:[bitmask per row], w}
  const decoded = {};
  function glyph(ch) {
    let d = decoded[ch]; if (d) return d;
    const src = GLYPHS[ch]; if (!src) return null;
    const rows = src.split('|'), w = rows[0].length, cells = Math.ceil(w / 8);
    d = { cells, w: cells * 8, rows: rows.map(r => { let m = 0; for (let i = 0; i < r.length; i++) if (r[i] === '#') m |= 1 << i; return m; }) };
    decoded[ch] = d; return d;
  }

  /* ---------- text normalisation and measurement ---------- */
  // Tokens: {ch, n} where ch is the glyph key and n the number of source characters it consumed (typing budget).
  function tokens(str) {
    const s = String(str == null ? '' : str).toUpperCase(), out = [];
    for (let i = 0; i < s.length; i++) {
      let ch = s[i];
      if (ch === '.' && s[i + 1] === '.' && s[i + 2] === '.') { out.push({ ch: '…', n: 3 }); i += 2; continue; }
      if (ALIAS[ch]) ch = ALIAS[ch];
      out.push({ ch, n: 1 });
    }
    return out;
  }
  function cellsOf(toks) { let c = 0; for (const t of toks) c += GLYPHS[t.ch] ? glyph(t.ch).cells : 1; return c; }
  function hasGlyph(ch) { ch = String(ch).toUpperCase(); return !!(GLYPHS[ch] || ALIAS[ch]); }
  // Characters of `str` (after upper-casing and aliasing) that no glyph covers; '\n' is ignored.
  function missing(str) {
    const out = [];
    for (const t of tokens(String(str).replace(/\n/g, ''))) if (!GLYPHS[t.ch] && !out.includes(t.ch)) out.push(t.ch);
    return out;
  }
  function measure(str, opts) {
    const font = opts && opts.font === 16 ? 16 : 8, scale = (opts && opts.scale) || 1, pitch = (opts && opts.pitch) || font;
    const lines = String(str == null ? '' : str).split('\n');
    let w = 0; for (const l of lines) w = Math.max(w, cellsOf(tokens(l)) * 8);
    return { w: w * scale, h: (lines.length ? (lines.length - 1) * pitch + font : 0) * scale, lines: lines.length, chars: String(str == null ? '' : str).replace(/\n/g, '').length, font, scale };
  }
  // Greedy word wrap to `cols` cells per row (the radio strip holds 45 cells per row; a 72-character line takes two).
  function wrap(str, cols) {
    cols = cols || LIMITS.radioCols; const rows = [];
    for (const para of String(str == null ? '' : str).split('\n')) {
      let row = '';
      for (const word of para.split(' ')) {
        if (!word && !row) continue;
        const cand = row ? row + ' ' + word : word;
        if (cellsOf(tokens(cand)) <= cols) { row = cand; continue; }
        if (row) rows.push(row);
        row = word;
        while (cellsOf(tokens(row)) > cols) { rows.push(row.slice(0, cols)); row = row.slice(cols); }   // one over-long word
      }
      rows.push(row);
    }
    return rows;
  }

  /* ---------- ROM font / portrait sources (guarded: absent until WP-D's sprite-data-ui.js and sprites.js load) ---------- */
  function romUI() { const u = root.ROM_UI; return u && typeof u === 'object' ? u : null; }
  function sheetImage(fam, sheetId, mapKey) {
    try {
      const S = root.SPRITES;
      if (S && typeof S.canvasFor === 'function') { const c = S.canvasFor(sheetId, mapKey); if (c) return c; }
      if (fam.mode === 'rgba' && fam.sheets && fam.sheets[sheetId] && typeof Image !== 'undefined') {
        const sh = fam.sheets[sheetId];
        if (!sh._img) { sh._img = new Image(); sh._img.src = sh.png; }
        return sh._img.complete && sh._img.naturalWidth ? sh._img : null;
      }
    } catch (e) { /* a broken colouriser never breaks the HUD: fall back to the authored font */ }
    return null;
  }
  // The ROM font sheet for `font`: {map, img, mapKey}. Map keys of one character are glyphs ([sx, sy] or [sx, sy, cells]);
  // `map.sheet` / `map.map` may name the sheet and palette map, else the family's, else the first map the colouriser has.
  // Any map will do: the glyph SHAPE is read from it (romGlyphs), the pens are ARCADE_UI.PEN.
  function romFontSheet(font) {
    const fam = romUI(); if (!fam) return null;
    const map = fam[font === 16 ? 'font16' : 'font8']; if (!map || typeof map !== 'object') return null;
    const sheets = fam.sheets || {}, pref = map.sheet || (font === 16 ? 'font16' : 'font8');
    const sheetId = sheets[pref] ? pref : sheets.ui ? 'ui' : Object.keys(sheets)[0];
    if (!sheetId) return null;
    const maps = fam.pal && fam.pal.maps && typeof fam.pal.maps === 'object' ? Object.keys(fam.pal.maps) : [];
    const keys = [map.map, fam.map, 'ui'].concat(maps).filter((k, i, a) => k && a.indexOf(k) === i);
    for (const k of keys) { const img = sheetImage(fam, sheetId, k); if (img) return { map, img, sheetId, mapKey: k }; }
    return null;
  }
  // ROM glyphs decoded ONCE per font into the same row-mask form as the authored glyphs. The arcade tiles carry their own
  // ink and shadow pens (story runs: white ink, dark drop shadow), so the sheet is read through getImageData and every
  // opaque pixel at or above half the font's peak luminance is ink, the darker ones the tile's shadow. Ink is then
  // painted in any pen with the same shadow/outline passes as the authored font: a pen the ROM palette has no map for
  // still renders in its colour, the yellow TOTAL row stays yellow and INSERT COIN keeps its outline. When nothing can
  // be decoded here (no canvas, sheet not loaded yet, colouriser throwing, tainted pixels) the authored font is used:
  // no glyph is ever blitted in the wrong colour. Returns {glyphs, chars, mapKey} | null.
  const romSets = {};                          // font -> set, or null once decoding is known to be impossible in this runtime
  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  function romGlyphs(font) {
    const have = romSets[font]; if (have !== undefined) return have;
    const src = romFontSheet(font); if (!src) return null;        // ROM_UI/SPRITES absent or the sheet not ready: try again next call
    const chars = Object.keys(src.map).filter(k => k.length === 1 && Array.isArray(src.map[k]) && src.map[k].length >= 2);
    const cv = chars.length ? makeCanvas(16, font) : null;
    if (!cv || typeof cv.g.getImageData !== 'function' || typeof cv.g.drawImage !== 'function') return (romSets[font] = null);
    const px = {}, widths = {}; let peak = 0, opaque = 0, total = 0;
    try {
      for (const ch of chars) {
        const at = src.map[ch], cells = at[2] === 2 ? 2 : 1, auth = glyph(ch);
        if (auth && auth.cells !== cells) continue;                 // a glyph whose width differs from the authored one keeps the authored metrics
        const w = cells * 8;
        cv.g.clearRect(0, 0, 16, font); cv.g.drawImage(src.img, at[0], at[1], w, font, 0, 0, w, font);
        const d = cv.g.getImageData(0, 0, w, font).data; px[ch] = d; widths[ch] = w; total += w * font;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 127) { opaque++; peak = Math.max(peak, lum(d, i)); }
      }
    } catch (e) { return (romSets[font] = null); }
    if (!peak) return (romSets[font] = null);                      // nothing visible on the sheet: not a font we can read
    const opaqueBg = opaque >= total * 0.9;                        // an opaque background pen: only the ink counts
    const glyphs = {};
    for (const ch of Object.keys(px)) {
      const d = px[ch], w = widths[ch], rows = [], dark = []; let darkAny = false;
      for (let r = 0; r < font; r++) {
        let m = 0, dm = 0;
        for (let c = 0; c < w; c++) {
          const i = (r * w + c) * 4; if (d[i + 3] <= 127) continue;
          if (lum(d, i) * 2 >= peak) m |= 1 << c; else if (!opaqueBg) { dm |= 1 << c; darkAny = true; }
        }
        rows.push(m); dark.push(dm);
      }
      glyphs[ch] = { cells: w / 8, w, rows, dark: darkAny ? dark : null, native: true };
    }
    return (romSets[font] = { glyphs, chars: Object.keys(glyphs), mapKey: src.mapKey });
  }
  function romPortrait(who, hero) {
    const fam = romUI(); if (!fam || !fam.portraits) return null;
    const key = who === 'clone' ? (hero || 'jack') : who, idx = PORTRAIT_INDEX[key]; if (idx == null) return null;
    const rec = fam.portraits['0x' + idx.toString(16).toUpperCase().padStart(2, '0')]; if (rec == null) return null;
    const sheets = fam.sheets || {}, sheetId = (fam.portraits.sheet) || (sheets.portraits ? 'portraits' : sheets.ui ? 'ui' : Object.keys(sheets)[0]);
    const rect = fam.rect && fam.rect[sheetId] && fam.rect[sheetId][rec]; if (!sheetId || !rect) return null;
    const img = sheetImage(fam, sheetId, who === 'clone' ? (fam.cloneMap || 'gel') : (fam.portraits.map || fam.map || 'ui')); if (!img) return null;
    return { img, sx: rect[0], sy: rect[1], w: rect[2], h: rect[3] };
  }

  /* ---------- glyph drawing: atlas when a document exists, fillRect runs otherwise ---------- */
  const atlases = {};
  function makeCanvas(w, h) {
    try { if (typeof document !== 'undefined' && document.createElement) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); if (g) return { canvas: c, g }; } } catch (e) { /* no canvas here */ }
    return null;
  }
  // Paint one glyph with fillRect runs at (x,y). Authored glyphs are 7-row 8x8 art: in the 8x16 font their rows double
  // (row r -> cell rows 1+2r, 2+2r, i.e. rows 1-14 of the cell, the ROM narrow font's metrics). ROM glyphs are `native`:
  // one pixel row per mask row. The 'shadow' style uses the tile's own shadow pixels (`dark`) when the ROM glyph has
  // them, else a 1-px drop shadow; 'outline' rings the ink with its 8 neighbours; 'plain' is the ink alone.
  function paintGlyph(g, d, x, y, font, scale, pen, style) {
    const twin = !d.native && font === 16, rh = twin ? 2 : 1, y0 = twin ? 1 : 0;
    const paint = (rows, dx, dy, colour) => {
      g.fillStyle = colour;
      for (let r = 0; r < rows.length; r++) {
        const m = rows[r]; if (!m) continue;
        let c = 0;
        while (c < d.w) {
          if (!(m >> c & 1)) { c++; continue; }
          let c2 = c; while (c2 < d.w && (m >> c2 & 1)) c2++;
          g.fillRect(x + (c + dx) * scale, y + (y0 + r * rh + dy) * scale, (c2 - c) * scale, rh * scale);
          c = c2;
        }
      }
    };
    if (style === 'outline') { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) paint(d.rows, dx, dy, PEN.shadow); }
    else if (style === 'shadow') { if (d.dark) paint(d.dark, 0, 0, PEN.shadow); else paint(d.rows, 1, 1, PEN.shadow); }
    paint(d.rows, 0, 0, pen);
  }
  let authoredSet = null;
  function authored() { if (!authoredSet) { authoredSet = {}; for (const k of Object.keys(GLYPHS)) authoredSet[k] = glyph(k); } return authoredSet; }
  // One atlas per (glyph set, font, pen, style): 10 px cells with a 1 px margin for the shadow/outline.
  function atlasFor(setId, glyphs, font, pen, style) {
    const key = setId + '|' + font + '|' + pen + '|' + style; if (key in atlases) return atlases[key];
    const keys = Object.keys(glyphs), cw = 8 + 2, ch = font + 2, cols = 16;
    let cell = 0; const index = {};
    for (const k of keys) { const d = glyphs[k]; if ((cell % cols) + d.cells > cols) cell += cols - (cell % cols); index[k] = cell; cell += d.cells; }
    const rows = Math.ceil(cell / cols), cv = makeCanvas(cols * cw, rows * ch);
    if (!cv) { atlases[key] = null; return null; }
    for (const k of keys) {
      const d = glyphs[k], i = index[k], ax = (i % cols) * cw + 1, ay = Math.floor(i / cols) * ch + 1;
      paintGlyph(cv.g, d, ax, ay, font, 1, pen, style);
    }
    return (atlases[key] = { img: cv.canvas, index, cw, ch, cols });
  }
  // `rom` is the decoded ROM glyph set for this font (or null): a ROM glyph is used when it has one, the authored glyph otherwise.
  function drawGlyph(g, ch, x, y, font, scale, pen, style, rom) {
    let d = rom ? rom.glyphs[ch] : null, setId = 'rom', set = rom ? rom.glyphs : null;
    if (!d) { d = glyph(ch); if (!d) return 1; setId = 'auth'; set = authored(); }
    const atlas = atlasFor(setId, set, font, pen, style);
    if (atlas) {
      const i = atlas.index[ch], ax = (i % atlas.cols) * atlas.cw, ay = Math.floor(i / atlas.cols) * atlas.ch, w = d.cells * 8 + 2;
      g.drawImage(atlas.img, ax, ay, w, atlas.ch, x - scale, y - scale, w * scale, atlas.ch * scale);
    } else paintGlyph(g, d, x, y, font, scale, pen, style);
    return d.cells;
  }

  // The first n tokens of a line, drawn once at scale 1 into a canvas (glyph margins included) and kept (LRU 256): a HUD
  // frame then costs one drawImage per line instead of one per glyph (PLAN §8.4 draw-call budget). Same pixels.
  const lineCache = new Map();
  function cachedLine(toks, n, font, pen, style, rom) {
    const key = [font, pen, style, rom ? 1 : 0, n, toks.map(t => t.ch).join('\u0001')].join('|');
    let e = lineCache.get(key);
    if (e) { lineCache.delete(key); lineCache.set(key, e); return e; }
    const cv = makeCanvas((cellsOf(toks) * 2 + 2) * 8 + 2, font + 2); if (!cv) return null;
    let ux = 0; for (let i = 0; i < n; i++) { const t = toks[i]; ux += (t.ch === ' ' ? 1 : drawGlyph(cv.g, t.ch, ux + 1, 1, font, 1, pen, style, rom)) * 8; }
    lineCache.set(key, e = { img: cv.canvas, w: ux + 2, h: font + 2 });
    if (lineCache.size > 256) lineCache.delete(lineCache.keys().next().value);
    return e;
  }
  /* text(g, str, x, y, opts): draws `str` (upper-cased) in the 8x8 or 8x16 font at (x,y) = top-left of the first
     cell. opts: font 8|16, pen (name or CSS colour), scale (1|2), align 'left'|'center'|'right', snap (x to 8),
     shadow (default true), outline, max (characters to reveal: typing), pitch (line pitch for '\n').
     Returns {w, shown, total}: width in px, characters shown and characters in the string. */
  function text(g, str, x, y, opts) {
    opts = opts || {};
    const font = opts.font === 16 ? 16 : 8, scale = opts.scale || 1, penName = opts.pen || 'white', pen = PEN[penName] || penName;
    const style = opts.outline ? 'outline' : opts.shadow === false ? 'plain' : 'shadow', pitch = (opts.pitch || font) * scale;
    const rom = opts.rom === false ? null : romGlyphs(font);
    let budget = opts.max == null ? Infinity : Math.max(0, Math.floor(opts.max)), shown = 0, total = 0, wmax = 0;
    if (g && 'imageSmoothingEnabled' in g) g.imageSmoothingEnabled = false;
    const lines = String(str == null ? '' : str).split('\n');
    const tr = ARCADE_UI.trace && opts.trace !== false;
    for (let li = 0; li < lines.length; li++) {
      const toks = tokens(lines[li]), w = cellsOf(toks) * 8 * scale; wmax = Math.max(wmax, w);
      let cx = opts.align === 'center' ? x - w / 2 : opts.align === 'right' ? x - w : x;
      cx = opts.snap ? Math.floor(cx / 8) * 8 : Math.round(cx);
      const cy = y + li * pitch;
      let n = 0; if (!tr) for (let b = budget; n < toks.length && b >= toks[n].n;) b -= toks[n++].n;
      const L = n && g && g.drawImage ? cachedLine(toks, n, font, pen, style, rom) : null;
      if (L) g.drawImage(L.img, 0, 0, L.w, L.h, cx - scale, cy - scale, L.w * scale, L.h * scale);
      for (const t of toks) {
        total += t.n;
        if (budget >= t.n) {
          if (t.ch !== ' ' && tr) ARCADE_UI.trace({ ch: t.ch, x: cx, y: cy, font, scale, pen: penName, src: rom && rom.glyphs[t.ch] ? 'rom' : 'auth' });
          const cells = t.ch === ' ' || L ? 1 : drawGlyph(g, t.ch, cx, cy, font, scale, pen, style, rom);
          cx += cells * 8 * scale; budget -= t.n; shown += t.n;
        } else { budget = 0; cx += (GLYPHS[t.ch] ? glyph(t.ch).cells : 1) * 8 * scale; }
      }
    }
    return { w: wmax, shown, total };
  }

  /* ---------- pictures and portraits ---------- */
  const pics = {}, picCache = {};
  function registerPic(id, img, w, h) { pics[id] = { img, w: w || img.width || img.naturalWidth, h: h || img.height || img.naturalHeight, id }; return pics[id]; }
  // `defW`/`defH`: the placeholder size when the picture has no declared size (the layout's usual picture size).
  function resolvePic(pic, defW, defH) {
    if (!pic) return null;
    defW = defW || 224; defH = defH || 96;
    if (typeof pic === 'object') {
      const img = pic.img || pic.canvas || (pic.width ? pic : null);
      return { img, w: pic.w || (img && (img.width || img.naturalWidth)) || defW, h: pic.h || (img && (img.height || img.naturalHeight)) || defH, id: pic.id || '' };
    }
    if (pics[pic]) return pics[pic];
    const data = root.STAGE_DATA && root.STAGE_DATA.pics && root.STAGE_DATA.pics[pic];
    if (data) {
      let c = picCache[pic];
      if (!c) {
        c = picCache[pic] = { w: data.w || defW, h: data.h || defH, id: pic, img: null };
        if (data.file && typeof Image !== 'undefined') { try { const im = new Image(); im.onload = () => { c.img = im; }; im.src = data.file; } catch (e) { /* no loader here */ } }
      }
      return c;
    }
    return { img: null, w: defW, h: defH, id: pic };
  }
  function drawPic(g, entry, x, y) {
    if (!entry) return;
    if (entry.img) { try { g.drawImage(entry.img, x, y, entry.w, entry.h); return; } catch (e) { /* not decodable yet: placeholder */ } }
    g.fillStyle = '#1c2630'; g.fillRect(x, y, entry.w, entry.h);
    g.fillStyle = '#56687a'; g.fillRect(x, y, entry.w, 1); g.fillRect(x, y + entry.h - 1, entry.w, 1); g.fillRect(x, y, 1, entry.h); g.fillRect(x + entry.w - 1, y, 1, entry.h);
    if (entry.id && entry.w >= entry.id.length * 8 + 8 && entry.h >= 16) text(g, entry.id, x + entry.w / 2, y + Math.floor(entry.h / 2) - 4, { align: 'center', pen: 'grey', shadow: false, rom: false, trace: false });
  }
  // Portrait: 72x72 at (x,y). `who`: jack|hannah|mustapha|mess|fessenden|clone (with `hero`), anything else is a name tag.
  function drawPortrait(g, who, x, y, opts) {
    opts = opts || {};
    const w = 72, h = 72, key = String(who || '').toLowerCase();
    const custom = ARCADE_UI.portraits[key];
    if (custom && custom.img) { try { g.drawImage(custom.img, x, y, w, h); return true; } catch (e) { /* placeholder below */ } }
    const p = romPortrait(key, opts.hero);
    if (p) { g.drawImage(p.img, p.sx, p.sy, p.w, p.h, x, y, w, h); return true; }
    const tag = HERO_NAMES[key] || String(who || '').toUpperCase();
    g.fillStyle = key === 'clone' ? '#1e3a2a' : '#1a2a4a'; g.fillRect(x, y, w, h);
    g.fillStyle = opts.accent ? (PEN[opts.accent] || opts.accent) : '#8aa0c0'; g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
    const rows = wrap(tag, 9);
    rows.slice(0, 3).forEach((r, i) => text(g, r, x + w / 2, y + h / 2 - rows.length * 4 + i * 8, { align: 'center', pen: opts.accent || 'white', rom: false, trace: false }));
    return false;
  }

  /* ---------- limits ---------- */
  function clipLines(lines) { return (Array.isArray(lines) ? lines : lines ? [String(lines)] : []).map(l => String(l)); }
  // Problems with a panel against the CAMPAIGN §4.7 limits: 30 characters per line, 4 lines, covered glyphs.
  function check(p) {
    const out = [], lines = clipLines(p && p.lines), lines2 = clipLines(p && p.lines2), layout = String((p && p.layout) || 'A').toUpperCase();
    if (!/^[ABC]$/.test(layout)) out.push('unknown layout ' + layout);
    if (lines.length + lines2.length > LIMITS.panelLines) out.push('panel has ' + (lines.length + lines2.length) + ' lines (limit ' + LIMITS.panelLines + ')');
    for (const l of lines.concat(lines2)) {
      if (l.length > LIMITS.panelChars) out.push('line over ' + LIMITS.panelChars + ' chars: ' + JSON.stringify(l));
      const m = missing(l); if (m.length) out.push('no glyph for ' + m.map(c => JSON.stringify(c)).join(' ') + ' in ' + JSON.stringify(l));
    }
    return out;
  }
  // Problems with a chapter card: a marker id CARD_MARKERS does not know (card() would blink it at the default spot),
  // uncovered glyphs, a caption or name wider than the 48-cell screen. tests/campaign.cjs can call it on the shipped data.
  function checkCard(c) {
    if (!c || typeof c !== 'object') return ['no card'];
    const out = [];
    if (c.marker != null && !CARD_MARKERS[c.marker] && !c.markerAt) out.push('unknown card marker ' + JSON.stringify(c.marker) + ' (known: ' + Object.keys(CARD_MARKERS).join(', ') + ')');
    for (const k of ['pre', 'name', 'title', 'label']) {
      if (c[k] == null) continue;
      const m = missing(c[k]); if (m.length) out.push('no glyph for ' + m.map(x => JSON.stringify(x)).join(' ') + ' in ' + k);
      if (cellsOf(tokens(c[k])) > AW / 8) out.push(k + ' is wider than the screen: ' + JSON.stringify(c[k]));
    }
    return out;
  }
  function typedBudget(typed) { return typed == null || typed === true ? Infinity : Math.max(0, Math.floor(typed * LIMITS.typeRate)); }
  // Type `lines` in reading order at (x, y + i*pitch); returns the characters still unrevealed.
  function typeLines(g, lines, x, y, pitch, budget, opts) {
    let left = budget, remaining = 0;
    for (let i = 0; i < lines.length; i++) {
      const r = text(g, lines[i], x, y + i * pitch, Object.assign({ font: 16, max: left === Infinity ? undefined : left }, opts));
      if (left !== Infinity) left = Math.max(0, left - r.shown);
      remaining += r.total - r.shown;
    }
    return remaining;
  }

  /* ---------- screens ---------- */
  // Intermission panel (layouts A, B, C of CAMPAIGN §4.7). Returns the characters still to type (0 = done).
  function panel(g, p) {
    p = p || {};
    const layout = String(p.layout || 'A').toUpperCase(), lines = clipLines(p.lines).slice(0, LIMITS.panelLines), lines2 = clipLines(p.lines2).slice(0, Math.max(0, LIMITS.panelLines - lines.length));
    const budget = typedBudget(p.typed);
    const pic = resolvePic(p.pic, layout === 'A' ? 224 : layout === 'B' ? 160 : 128, layout === 'C' ? 64 : 96), pic2 = resolvePic(p.pic2, 128, 64);
    if (p.bg !== false) { g.fillStyle = p.bg || '#000000'; g.fillRect(0, 0, AW, AH); }
    let remaining = 0;
    if (layout === 'B') {                                                  // portrait top-left, lines beside, picture + lines2 below
      drawPortrait(g, p.who, 16, 0, { hero: p.hero, accent: p.accent });
      remaining += typeLines(g, lines, 112, 8, 24, budget, { pen: p.pen });
      let y2 = 120;
      if (pic) { const py = lines.length >= 3 ? 80 : 64, px = 208 - Math.floor(pic.w / 2); drawPic(g, pic, px, py); y2 = py + pic.h + (pic.h > 64 ? 8 : 16); }
      const left = budget === Infinity ? Infinity : Math.max(0, budget - (lines.join('').length));
      remaining += typeLines(g, lines2, 64, y2, 24, left, { pen: p.pen });
    } else if (layout === 'C') {                                           // picture top-left with one line beside it, lines below
      if (pic) drawPic(g, pic, 32, 16);
      if (pic2) drawPic(g, pic2, 224, 112);
      const beside = lines.slice(0, 1), below = lines.slice(1).concat(lines2), yBelow = Math.max(104, pic ? 16 + pic.h + 8 : 0);
      remaining += typeLines(g, beside, 192, 32, 24, budget, { pen: p.pen });
      const left = budget === Infinity ? Infinity : Math.max(0, budget - beside.join('').length);
      remaining += typeLines(g, below, 32, yBelow, 24, left, { pen: p.pen });
    } else {                                                               // A: picture centred at the top, lines below
      if (pic) drawPic(g, pic, 192 - Math.floor(pic.w / 2), 16);
      remaining += typeLines(g, lines.concat(lines2), 64, Math.max(120, pic ? 16 + pic.h + 8 : 0), 24, budget, { pen: p.pen });
    }
    return remaining;
  }

  // Area caption on scroll1 row 23 (y 184) for 2.5 s. `t` = frames shown; returns true while visible.
  function caption(g, str, t, opts) {
    const frames = (opts && opts.frames) || TIMING.caption;
    if (t != null && (t < 0 || t >= frames)) return false;
    text(g, str, 192, 23 * 8, Object.assign({ font: 16, align: 'center', snap: true }, opts));
    return true;
  }

  // Chapter card: the map in its frame, a blinking marker, "CHAPTER N" and the typed name; ch1 shows `pre` first.
  // `t` = frames since the card began (typing and blinking derive from it); `typed` overrides the typing budget.
  function card(g, c) {
    c = c || {};
    const t = c.t == null ? Infinity : c.t;
    if (c.pre && t < TIMING.pre) { caption(g, c.pre, 0); return { phase: 'pre', remaining: 1 }; }
    const tt = c.pre ? (t === Infinity ? t : t - TIMING.pre) : t;
    const frame = c.frame !== false, fx = 72, fy = 8, fw = 240, fh = 112;
    if (frame) {
      g.fillStyle = '#d8c8a0'; g.fillRect(fx, fy, fw, fh);
      g.fillStyle = '#6a5a3c'; g.fillRect(fx + 2, fy + 2, fw - 4, fh - 4);
      g.fillStyle = '#e8dcb8'; g.fillRect(fx + 4, fy + 4, fw - 8, fh - 8);
    }
    const map = resolvePic(c.map || 'p-card-map'); drawPic(g, map, 80, 16);
    const at = c.markerAt || CARD_MARKERS[c.marker] || [112, 48], mx = 80 + at[0], my = 16 + at[1];
    const blinkOn = t === Infinity || Math.floor(tt / 8) % 2 === 0;
    if (blinkOn) {
      g.fillStyle = PEN.red; g.fillRect(mx - 3, my - 1, 7, 3); g.fillRect(mx - 1, my - 3, 3, 7);
      g.fillStyle = PEN.white; g.fillRect(mx - 1, my - 1, 3, 3);
    }
    if (c.label) {                                                     // the map's own place label (ROM style: black box, 8x8 text)
      const lw = cellsOf(tokens(c.label)) * 8 + 8, lx = Math.max(80, Math.min(304 - lw, mx - Math.floor(lw / 2)));
      g.fillStyle = '#000000'; g.fillRect(lx, 100, lw, 11);
      text(g, c.label, lx + 4, 102, { shadow: false });
    }
    const budget = c.typed != null ? typedBudget(c.typed) : typedBudget(tt === Infinity ? null : tt);
    const title = c.title != null ? c.title : 'CHAPTER ' + (c.chapter == null ? '' : c.chapter);
    const r1 = text(g, title, 192, 136, { font: 16, align: 'center', snap: true, max: budget === Infinity ? undefined : budget });
    const left = budget === Infinity ? undefined : Math.max(0, budget - r1.shown);
    const r2 = text(g, c.name || '', 192, 168, { font: 16, align: 'center', snap: true, max: left });
    return { phase: 'card', remaining: (r1.total - r1.shown) + (r2.total - r2.shown) };
  }

  // Boss card under the HUD: name (8x16, accent) and sub-title (8x8) in a dark band for 2.4 s. `y` moves the 36-px band
  // (default 64; the game passes 84 so the card clears the tall radio strip, y 46-78, PLAN §7 G7).
  function bossCard(g, b) {
    b = b || {};
    const frames = b.frames || TIMING.bossCard, t = b.t, y0 = b.y == null ? 64 : Math.round(b.y);
    if (t != null && (t < 0 || t >= frames)) return false;
    const fade = t == null ? 1 : Math.min(1, (frames - t) / 12, (t + 1) / 6);
    const prev = g.globalAlpha == null ? 1 : g.globalAlpha;
    g.globalAlpha = prev * fade;
    g.fillStyle = 'rgba(0,0,0,0.72)'; g.fillRect(0, y0, AW, 36);
    g.fillStyle = PEN[b.accent] || b.accent || PEN.red; g.fillRect(0, y0, AW, 1); g.fillRect(0, y0 + 35, AW, 1);
    text(g, b.name || '', 192, y0 + 2, { font: 16, align: 'center', snap: true, pen: b.accent || 'red' });
    if (b.sub) text(g, b.sub, 192, y0 + 22, { align: 'center', snap: true, pen: 'white' });
    g.globalAlpha = prev;
    return true;
  }

  // Stage clear tally: CHAPTER N CLEAR, VITALITY / ENEMIES / FINAL BLOW / TOTAL; rows appear every 30 frames of `t`.
  function tally(g, s) {
    s = s || {};
    const t = s.t == null ? Infinity : s.t, rowsOn = Math.floor(t / TIMING.tallyRow);
    if (s.dim !== false) { g.fillStyle = 'rgba(0,0,0,' + (s.dim == null ? 0.65 : s.dim) + ')'; g.fillRect(0, 0, AW, AH); }
    text(g, s.title || ('CHAPTER ' + (s.chapter == null ? '' : s.chapter) + ' CLEAR'), 192, 32, { font: 16, align: 'center', snap: true, pen: 'yellow' });
    const rows = [['VITALITY', s.vitality], ['ENEMIES', s.enemies], ['FINAL BLOW', s.finalBlow]];
    rows.forEach((r, i) => {
      if (rowsOn < i + 1) return;
      text(g, r[0], 80, 72 + i * 24, { font: 16 });
      text(g, String(Math.max(0, Math.floor(r[1] || 0))), 304, 72 + i * 24, { font: 16, align: 'right' });
    });
    if (rowsOn >= 4) {
      g.fillStyle = PEN.yellow; g.fillRect(80, 142, 224, 1);
      text(g, 'TOTAL', 80, 148, { font: 16, pen: 'yellow' });
      text(g, String(Math.max(0, Math.floor(s.total == null ? (s.vitality || 0) + (s.enemies || 0) + (s.finalBlow || 0) : s.total))), 304, 148, { font: 16, align: 'right', pen: 'yellow' });
    }
    let remaining = 0;
    if (s.lines && rowsOn >= 5) remaining = typeLines(g, clipLines(s.lines).slice(0, 2), 64, 180, 20, typedBudget(s.typed == null ? (t === Infinity ? null : t - 5 * TIMING.tallyRow) : s.typed), {});
    return { rows: Math.min(4, rowsOn), remaining };
  }

  // Staff roll: a right-hand column scrolling up at 0.5 px/frame; categories red, names white, 16 px pitch, a gap per group.
  function staffRoll(g, t, opts) {
    opts = opts || {};
    const list = opts.list || STAFF_ROLL, speed = opts.speed || 0.5, pitch = 16;
    const flat = [];
    for (const [cat, names] of list) { flat.push([cat, 'red']); for (const n of names) flat.push([n, 'white']); flat.push(null); }
    if (opts.tail) for (const l of clipLines(opts.tail)) flat.push([l, 'white']);
    let maxLen = 0; for (const e of flat) if (e) maxLen = Math.max(maxLen, cellsOf(tokens(e[0])));
    const x = opts.x != null ? opts.x : Math.max(16, 368 - maxLen * 8), y0 = AH - Math.floor((t || 0) * speed);
    let last = -Infinity;
    flat.forEach((e, i) => {
      const y = y0 + i * pitch; last = Math.max(last, y);
      if (!e || y <= -pitch || y >= AH) return;
      text(g, e[0], x, y, { pen: e[1], outline: true });
    });
    return { done: last < -pitch, x, lines: flat.length };
  }

  // The last screen: big centred lines (16x16 = the 8x8 font at 2x) at y 40 and y 168, as PRODUCED BY / THANK YOU.
  // A line too long for 16x16 (more than 23 cells) drops to the 8x16 font so it never leaves the screen.
  function thanks(g, lines, opts) {
    lines = clipLines(lines); opts = opts || {};
    const big = (str, y, pen) => { const fits = cellsOf(tokens(str)) * 16 <= 368; text(g, str, 192, y, fits ? { scale: 2, align: 'center', outline: true, pen } : { font: 16, align: 'center', outline: true, pen }); };
    if (lines[0]) big(lines[0], 40, opts.pen || 'white');
    if (lines[1]) big(lines[1], 168, opts.pen2 || opts.pen || 'yellow');
  }

  // In-stage dialogue box: framed 72x72 portrait at (40,32), lines at x 144 from y 48 with a 16 px pitch (the ROM's
  // in-stage layout; its ending boxes used 24: pass `pitch`). `who` without a portrait (villains) gets a name tag in
  // `accent`. Returns the characters still to type.
  function dialogue(g, d) {
    d = d || {};
    if (d.dim) { g.fillStyle = 'rgba(0,0,0,' + (d.dim === true ? 0.5 : d.dim) + ')'; g.fillRect(0, 0, AW, AH); }
    g.fillStyle = '#f0f0f0'; g.fillRect(32, 24, 88, 88);
    g.fillStyle = '#1c3c8c'; g.fillRect(34, 26, 84, 84);
    drawPortrait(g, d.who, 40, 32, { hero: d.hero, accent: d.accent });
    const lines = clipLines(d.lines).slice(0, LIMITS.panelLines);
    return typeLines(g, lines, 144, 48, d.pitch || 16, typedBudget(d.typed), { pen: d.pen });
  }

  // Radio strip: "NAME: text" wrapped to two rows of 45 cells, the tag in `accent`. Two forms, because PLAN G6 (4) asks
  // for the ROM 8x16 font while ARCHITECTURE §1.7 reserves a 14 px strip that holds two rows only in the 8x8 font:
  //   default   RECTS.radio (8,46)-(376,60): two 7-row 8x8 glyph rows at a 7 px pitch (y 46-52, 53-59), no drop shadow
  //   font: 16  RECTS.radioTall (8,46)-(376,78): two 8x16 rows at a 16 px pitch (cells y 46-61, 62-77), still above the
  //             feet band at y 81 that polish L50 checks (radio.y + radio.h <= 81). G6/G7 pick one; both stay off the lanes.
  function radio(g, r) {
    r = r || {};
    const tall = r.font === 16, [rx, ry, rw, rh] = tall ? RECTS.radioTall : RECTS.radio, name = r.name ? String(r.name).toUpperCase() : '';
    const font = tall ? 16 : 8, pitch = tall ? 16 : 7, shadow = tall;
    g.fillStyle = 'rgba(0,0,0,' + (r.alpha == null ? 0.62 : r.alpha) + ')'; g.fillRect(rx, ry, rw, rh);
    const rows = wrap((name ? name + ': ' : '') + String(r.text == null ? '' : r.text), LIMITS.radioCols).slice(0, 2);
    rows.forEach((row, i) => {
      const y = ry + i * pitch, x = rx + 4;
      if (i === 0 && name) {
        const tag = name + ':';
        text(g, tag, x, y, { font, pen: r.accent || 'yellow', shadow });
        text(g, row.slice(tag.length), x + cellsOf(tokens(tag)) * 8, y, { font, shadow });
      } else text(g, row, x, y, { font, shadow });
    });
    return rows.length;
  }

  // In-place continue count: red 16x16 "0:SS" centred at the top, a blinking hint under it.
  function continueCount(g, c) {
    c = c || {};
    const n = Math.max(0, Math.floor(c.count || 0)), s = Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
    text(g, s, 192, 56, { scale: 2, align: 'center', outline: true, pen: 'red' });
    if (c.hint && (c.t == null || Math.floor(c.t / TIMING.blink) % 2 === 0)) text(g, c.hint, 192, 92, { align: 'center', outline: true, pen: 'yellow' });
  }

  // INSERT COIN / JOIN-IN in the top HUD slots (0 = x 128-256, 1 = x 256-384), blinking 32 frames on, 32 off.
  function coinSlot(g, slot, str, t) {
    if (t != null && Math.floor(t / TIMING.blink) % 2 === 1) return false;
    text(g, str == null ? 'INSERT COIN' : str, slot ? 320 : 192, 14, { align: 'center', outline: true, pen: 'orange' });
    return true;
  }

  const ARCADE_UI = {
    version: 1, W: AW, H: AH, RECTS, LIMITS, TIMING, PEN, CARD_MARKERS, STAFF_ROLL, PORTRAIT_INDEX, charset: CHARSET,
    trace: null, portraits: {}, pics,
    get romFonts() { return !!(romGlyphs(8) || romGlyphs(16)); },
    text, measure, wrap, hasGlyph, missing, tokens, glyph, romGlyphs, check, checkCard, typedBudget,
    registerPic, resolvePic, drawPic, drawPortrait,
    panel, caption, card, bossCard, tally, staffRoll, thanks, dialogue, radio, continueCount, coinSlot
  };
  root.ARCADE_UI = ARCADE_UI;
})(typeof window !== 'undefined' ? window : globalThis);
