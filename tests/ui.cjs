/* tests/ui.cjs: Node-only checks of arcade-ui.js (WP-I). No browser, no node-canvas: the module runs in a vm
   sandbox against two stub 2D contexts, one that records every call and one that rasterises fillRect so the
   screens can be written as PNGs for review (`node tests/ui.cjs --png` -> work/re/impl/WP-I/review/*.png).
   Run from the repo root: node tests/ui.cjs */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const checks = [], failures = [];
const check = (name, ok, detail) => { if (ok) checks.push(name); else failures.push(name + (detail ? ': ' + detail : '')); };

/* ---------- sandbox ---------- */
function load(extraGlobals) {
  const sandbox = Object.assign({ console }, extraGlobals || {});
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['arcade-ui.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  return sandbox;
}
// Load a `window.X = ...` data module into its own sandbox and return the sandbox.
function loadData(file) {
  const sandbox = { window: null }; sandbox.window = sandbox; vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  return sandbox;
}

/* ---------- stub contexts ---------- */
const METHODS = ['fillRect', 'strokeRect', 'clearRect', 'drawImage', 'save', 'restore', 'translate', 'scale', 'rotate', 'setTransform',
  'beginPath', 'closePath', 'rect', 'clip', 'fill', 'stroke', 'moveTo', 'lineTo', 'arc', 'fillText', 'strokeText', 'measureText'];
const PROPS = ['fillStyle', 'strokeStyle', 'globalAlpha', 'font', 'textAlign', 'textBaseline', 'lineWidth', 'lineJoin', 'imageSmoothingEnabled', 'globalCompositeOperation'];
function recorder() {
  const calls = [], state = { fillStyle: '#000', globalAlpha: 1 };
  const target = {};
  for (const m of METHODS) target[m] = (...a) => { calls.push({ m, a, fillStyle: state.fillStyle, alpha: state.globalAlpha }); return m === 'measureText' ? { width: 8 * String(a[0]).length } : undefined; };
  const g = new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; if (PROPS.includes(k)) return state[k]; if (k === 'calls') return calls; if (typeof k === 'symbol' || k === 'then' || k === 'toJSON') return undefined; throw new Error('stub context has no member ' + String(k)); },
    set(t, k, v) { if (!PROPS.includes(k)) throw new Error('stub context has no property ' + String(k)); state[k] = v; return true; }
  });
  return g;
}
// A rasteriser: fillRect with hex/rgba colours and globalAlpha onto an RGBA buffer (fallback glyphs are fillRect runs),
// source-over drawImage from another raster canvas (nearest neighbour), clearRect and getImageData, so fakeCanvas() can
// stand in for document.createElement('canvas'): the module's atlases and the ROM font decode then run in Node too.
function raster(w = 384, h = 224) {
  const px = new Uint8Array(w * h * 4), state = { fillStyle: '#000', globalAlpha: 1 };
  const colour = s => { const m3 = /^#([0-9a-f]{3})$/i.exec(s); if (m3) s = '#' + m3[1].split('').map(c => c + c).join('');
    const m = /^#([0-9a-f]{6})$/i.exec(s); if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
    const r = /^rgba?\(([^)]+)\)$/.exec(s); if (r) { const v = r[1].split(',').map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; } return [255, 0, 255, 1]; };
  const blend = (i, r, gg, b, a) => { px[i] = px[i] + (r - px[i]) * a; px[i + 1] = px[i + 1] + (gg - px[i + 1]) * a; px[i + 2] = px[i + 2] + (b - px[i + 2]) * a; px[i + 3] = px[i + 3] + (255 - px[i + 3]) * a; };
  const target = {
    fillRect(x, y, rw, rh) { const [r, gg, b, a0] = colour(state.fillStyle), a = a0 * state.globalAlpha;
      const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y)), x1 = Math.min(w, Math.round(x + rw)), y1 = Math.min(h, Math.round(y + rh));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) blend((yy * w + xx) * 4, r, gg, b, a); },
    clearRect(x, y, rw, rh) { const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y)), x1 = Math.min(w, Math.round(x + rw)), y1 = Math.min(h, Math.round(y + rh));
      for (let yy = y0; yy < y1; yy++) px.fill(0, (yy * w + x0) * 4, (yy * w + x1) * 4); },
    drawImage(src, ...a) {
      const sp = src && src.pixels; if (!sp) return;                                   // an image without pixels (a plain stub) draws nothing
      const sw0 = src.width, sh0 = src.height;
      const [sx, sy, sw, sh, dx, dy, dw, dh] = a.length >= 8 ? a : a.length >= 4 ? [0, 0, sw0, sh0, a[0], a[1], a[2], a[3]] : [0, 0, sw0, sh0, a[0], a[1], sw0, sh0];
      for (let Y = Math.round(dy); Y < Math.round(dy + dh); Y++) for (let X = Math.round(dx); X < Math.round(dx + dw); X++) {
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const sxx = sx + Math.floor((X - Math.round(dx)) * sw / dw), syy = sy + Math.floor((Y - Math.round(dy)) * sh / dh);
        if (sxx < 0 || syy < 0 || sxx >= sw0 || syy >= sh0) continue;
        const j = (syy * sw0 + sxx) * 4, a1 = sp[j + 3] / 255 * state.globalAlpha; if (a1 <= 0) continue;
        blend((Y * w + X) * 4, sp[j], sp[j + 1], sp[j + 2], a1);
      } },
    getImageData(x, y, gw, gh) { const data = new Uint8ClampedArray(gw * gh * 4);
      for (let yy = 0; yy < gh; yy++) for (let xx = 0; xx < gw; xx++) { const X = x + xx, Y = y + yy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; data.set(px.subarray((Y * w + X) * 4, (Y * w + X) * 4 + 4), (yy * gw + xx) * 4); }
      return { width: gw, height: gh, data }; },
    measureText(s) { return { width: 8 * String(s).length }; }
  };
  for (const m of METHODS) if (!target[m]) target[m] = () => {};
  const g = new Proxy(target, { get(t, k) { if (k in t) return t[k]; if (PROPS.includes(k)) return state[k]; if (k === 'pixels') return px; if (k === 'width') return w; if (k === 'height') return h; if (typeof k === 'symbol') return undefined; throw new Error('raster context has no member ' + String(k)); },
    set(t, k, v) { state[k] = v; return true; } });
  return g;
}
// A canvas element stand-in: width/height are read when getContext is first called (as arcade-ui's makeCanvas sets them).
function fakeCanvas() {
  const c = { width: 300, height: 150, _g: null, getContext() { return this._g || (this._g = raster(this.width, this.height)); }, get pixels() { return this._g ? this._g.pixels : null; } };
  return c;
}
function writePNG(file, w, h, rgba) {
  const zlib = require('node:zlib');
  const crcTable = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

/* ---------- 1. determinism and API surface ---------- */
const src = fs.readFileSync(path.join(ROOT, 'arcade-ui.js'), 'utf8');
check('No Math.random in arcade-ui.js', !/Math\.random/.test(src));
check('No clock reads in arcade-ui.js', !/Date\.now|performance\.now|new Date/.test(src));
const sb = load(); const UI = sb.ARCADE_UI;
check('window.ARCADE_UI is published', !!UI && UI.version === 1);
for (const fn of ['text', 'measure', 'panel', 'card', 'caption', 'bossCard', 'tally', 'staffRoll', 'dialogue', 'wrap', 'check', 'checkCard', 'missing', 'radio', 'continueCount', 'glyph', 'romGlyphs'])
  check('ARCADE_UI.' + fn + ' is a function', typeof UI[fn] === 'function');
// G7 (PLAN §7 G7): the weapon rect is the cabinet panel (0,208)-(120,224) that the ROM routine 0x23A24 draws; §1.7's
// (8,198,128,22) was reserved from the video before the panel was decoded.
check('Rects follow ARCHITECTURE §1.7 (the weapon panel at the cabinet’s (0,208,120,16), G7); the tall radio rect stays above the feet band (polish L50)', (() => {
  const want = { hud: [0, 0, 384, 44], radio: [8, 46, 368, 14], weapon: [0, 208, 120, 16] };
  return Object.keys(want).every(k => JSON.stringify(UI.RECTS[k]) === JSON.stringify(want[k])) && UI.RECTS.radioTall[1] === 46 && UI.RECTS.radioTall[1] + UI.RECTS.radioTall[3] <= 81;
})());
check('Limits follow CAMPAIGN D11', UI.LIMITS.panelChars === 30 && UI.LIMITS.panelLines === 4 && UI.LIMITS.typeRate === 2 && UI.LIMITS.radioChars === 72);
check('Caption holds 2.5 s, boss card 2.4 s, pre-card 2 s', UI.TIMING.caption === 150 && UI.TIMING.bossCard === 144 && UI.TIMING.pre === 120);
check('ROM fonts are reported absent without ROM_UI', UI.romFonts === false);

/* ---------- 2. measure, wrap, normalisation ---------- */
check('measure: 8x8 cells', (() => { const m = UI.measure('ABC'); return m.w === 24 && m.h === 8; })());
check('measure: 8x16 font', (() => { const m = UI.measure('ABC', { font: 16 }); return m.w === 24 && m.h === 16; })());
check('measure: scale 2', UI.measure('AB', { scale: 2 }).w === 32);
check('measure: "..." and "…" take the ROM two-tile ellipsis', UI.measure('...').w === 16 && UI.measure('…').w === 16 && UI.measure('A...B').w === 32);
check('measure: multi-line uses the pitch', (() => { const m = UI.measure('A\nBC', { font: 16, pitch: 24 }); return m.w === 16 && m.h === 40 && m.lines === 2; })());
check('measure: lower case counts like upper case', UI.measure('abc').w === UI.measure('ABC').w);
check('wrap: a 72-character radio line fits two rows of 45', (() => { const line = 'HANNAH: The jail barge is on fire! Who would attack Wassoon? Look at the sea wall'; assert.equal(line.length, 81); const rows = UI.wrap(line.slice(0, 72), 45); return rows.length === 2 && rows.every(r => r.length <= 45) && rows.join(' ') === line.slice(0, 72); })());
check('wrap: never splits a word that fits', UI.wrap('ONE TWO THREE FOUR', 9).join('|') === 'ONE TWO|THREE|FOUR');
check('hasGlyph covers A-Z 0-9 and the ROM punctuation', [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?\'’“”-·/()'].every(c => UI.hasGlyph(c)));
check('missing() reports uncovered characters once', JSON.stringify(UI.missing('A@B@C')) === '["@"]' && UI.missing('HELLO, WORLD…').length === 0);
check('Every authored glyph fits its cell: at most 7 rows, one or two 8 px cells', UI.charset.every(ch => { const d = UI.glyph(ch); return !d || (d.rows.length <= 7 && (d.cells === 1 || d.cells === 2)); }));

/* ---------- 3. font coverage over the shipped text ---------- */
(() => {
  const strings = [];
  // Keys whose strings are drawn on the canvas (ids, colours, music cues, stage keys are not; brief and end stay DOM text).
  // G6: `dialog` is queued on the radio when play starts, so its lines are drawn in the ROM font too.
  const DISPLAY = new Set(['name', 'area', 'boss', 'bossCard', 'bossToast', 'bossSay', 'bossLines', 'bossDefeat', 'say', 'after', 'lines', 'lines2', 'caption', 'pre', 'title', 'verb', 'dialog', 'cap',
    'driverDeadSay', 'gateSay', 'spillwaySay', 'card', 'toast', 'defeat', 'byHero', 'label', 'sub', 'hud']);
  const walk = (v, keyPath) => {
    const k1 = keyPath[keyPath.length - 1] || '', k2 = keyPath[keyPath.length - 2] || '', k3 = keyPath[keyPath.length - 3] || '';
    if (typeof v === 'string') { if (DISPLAY.has(k1) || DISPLAY.has(k2) || (k3 === 'tasks' && k1 !== '0')) strings.push(v); }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, keyPath.concat(String(i))));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], keyPath.concat(k));
  };
  for (const file of ['campaign.js', 'mission-data.js']) {
    if (!fs.existsSync(path.join(ROOT, file))) continue;
    const d = loadData(file);
    for (const key of ['EDEN_CAMPAIGN', 'EDEN_MISSIONS', 'EDEN_INTRO', 'EDEN_ENDING']) if (d[key]) walk(d[key], [key]);
  }
  const hud = ['INSERT COIN', 'JOIN-IN', 'CREDIT 0', 'JACK.T', 'HANNAH.D', 'MUSTAPHA', 'MESS.O', '1ST', 'CROWNBACK', 'SHOTS', 'HITS', 'CONTINUE?', 'STAGE 1 CLEAR', 'VITALITY', 'FINAL BLOW', 'EAST COAST — SIX MONTHS LATER',
    // G6 screens drawn by game.js: the title, the tally, the ending
    'II · THE CROWN TIDE', 'STAGE 8 CLEAR', 'TOTAL', 'THE ROAD GOES ON', 'THANK YOU FOR PLAYING', 'A FAN SEQUEL MADE FOR MOSTAFA',
    // the picture screens (p-manifest, p-ledger; revision 3 texts)
    'CAMP · NORTH WETLANDS', 'LIVE STOCK ONLY', 'VIA CAUSEWAY · CROWN', 'OUTLYING WORKSHOP', 'ORDERS SIGNED: DR. ECHO', 'PAID: MARSHAL SABLE'];
  const bad = [];
  for (const s of strings.concat(hud)) { const m = UI.missing(s.replace(/\\n/g, '\n')); if (m.length) bad.push(m.join('') + ' in ' + JSON.stringify(s.slice(0, 40))); }
  check('Every drawn campaign/mission/HUD character has a glyph (' + (strings.length + hud.length) + ' strings)', bad.length === 0, bad.slice(0, 5).join('; '));
  // Panel limits of the shipped intermission data (CAMPAIGN §15.2 (4)), when the new campaign.js is in place.
  const d = fs.existsSync(path.join(ROOT, 'campaign.js')) ? loadData('campaign.js') : {};
  const panels = [];
  (d.EDEN_CAMPAIGN || []).forEach(ch => (ch.inter || []).forEach(p => panels.push(p)));
  (d.EDEN_INTRO || []).forEach(p => panels.push(p));
  (d.EDEN_ENDING || []).forEach(b => { if (b.lines) panels.push(b); (b.boxes || []).forEach(p => panels.push(p)); });
  const problems = []; panels.forEach((p, i) => { for (const e of UI.check(p)) problems.push(i + ': ' + e); });
  check('Shipped panels respect 30 chars x 4 lines (' + panels.length + ' panels)', problems.length === 0, problems.slice(0, 5).join('; '));
  // Chapter cards: every shipped card.marker must be a CARD_MARKERS key, or card() would blink it at the default spot.
  const chapters = d.EDEN_CAMPAIGN || [], markers = chapters.map(ch => [ch.name, ch.card && ch.card.marker]);
  const unknown = markers.filter(([, m]) => m == null || !UI.CARD_MARKERS[m]);
  check('Every shipped chapter card has a marker that CARD_MARKERS knows (' + markers.length + ' cards)', unknown.length === 0, unknown.map(u => u.join(': ')).join('; '));
  const cardProblems = []; chapters.forEach((ch, i) => { for (const e of UI.checkCard(Object.assign({ name: ch.name }, ch.card))) cardProblems.push(i + ': ' + e); });
  check('checkCard() passes every shipped chapter card', cardProblems.length === 0, cardProblems.join('; '));
})();

/* ---------- 3b. the shipped ROM ui family (sprite-data-ui.js, WP-D) that G6 loads ---------- */
(() => {
  if (!fs.existsSync(path.join(ROOT, 'sprite-data-ui.js'))) return;
  const sb = { SPRITE_DATA: { families: {}, add(n, f) { this.families[n] = f; } } }; sb.window = sb; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sprite-data-ui.js'), 'utf8'), sb, { filename: 'sprite-data-ui.js' });
  const U = sb.SPRITE_DATA.families.ui, need = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?-/()', "'"];
  check('sprite-data-ui.js carries the 8x8 and 8x16 ROM fonts (A-Z, 0-9 and the punctuation the campaign uses)', !!U && ['font8', 'font16'].every(f => U[f] && need.every(ch => Array.isArray(U[f][ch]) && U[f][ch].length >= 2)));
  const idx = { jack: '0x00', hannah: '0x01', mustapha: '0x02', mess: '0x03', fessenden: '0x04' };
  check('sprite-data-ui.js has the ROM portraits the panels and radio name (0x00-0x04) and the title-card panel', !!U && Object.values(idx).every(k => U.portraits && U.portraits[k] && U.rect.ui[U.portraits[k]]) && !!U.rect.ui[U.cardFrame] && ['jack', 'hannah', 'mustapha', 'mess'].every(h => U.rect.ui[U.hudFaces[h]]));
})();

/* ---------- 4. check(): line limits ---------- */
check('check() flags a 31-character line', UI.check({ layout: 'A', lines: ['X'.repeat(31)] }).some(e => /over 30/.test(e)));
check('check() flags a fifth line', UI.check({ layout: 'B', lines: ['A', 'B', 'C'], lines2: ['D', 'E'] }).some(e => /5 lines/.test(e)));
check('check() flags an unknown layout and an uncovered glyph', UI.check({ layout: 'Z', lines: ['A@B'] }).length === 2);
check('check() passes a CAMPAIGN panel', UI.check({ layout: 'B', who: 'hannah', pic: 'p-manifest', lines: ['ROOK’S MANIFEST SAYS THE PODS', 'RIDE THE CORAL CAUSEWAY.'], lines2: ['IT ONLY SURFACES AT', 'LOW TIDE.'] }).length === 0);
check('checkCard() flags an unknown marker unless markerAt overrides it, and an uncovered glyph', UI.checkCard({ marker: 'nowhere' }).some(e => /unknown card marker/.test(e)) && UI.checkCard({ marker: 'nowhere', markerAt: [1, 2] }).length === 0 && UI.checkCard({ marker: 'wassoon', pre: 'A@B' }).some(e => /no glyph/.test(e)));

/* ---------- 5. typing speed and layout geometry (via the glyph trace) ---------- */
function traced(fn) { const glyphs = []; UI.trace = e => glyphs.push(e); const r = fn(recorder()); UI.trace = null; return { glyphs, r }; }
check('panel types 2 characters per frame', (() => {
  const p = { layout: 'A', lines: ['ABCDEFGH', 'IJ'] };
  const t0 = traced(g => UI.panel(g, Object.assign({ typed: 0 }, p))), t2 = traced(g => UI.panel(g, Object.assign({ typed: 2 }, p))), t5 = traced(g => UI.panel(g, Object.assign({ typed: 5 }, p))), all = traced(g => UI.panel(g, p));
  return t0.glyphs.length === 0 && t0.r === 10 && t2.glyphs.length === 4 && t2.r === 6 && t5.glyphs.length === 10 && t5.r === 0 && all.glyphs.length === 10 && all.r === 0;
})());
check('panel typing counts spaces but does not draw them', (() => { const t = traced(g => UI.panel(g, { lines: ['AB CD'], typed: 2 })); return t.glyphs.length === 3 && t.r === 1; })());
check('layout A: lines at x 64 from y 120, 24 px pitch, 8x16 font', (() => {
  const t = traced(g => UI.panel(g, { layout: 'A', lines: ['AB', 'CD', 'EF', 'GH'] }));
  const ys = t.glyphs.map(e => e.y); return t.glyphs[0].x === 64 && t.glyphs[0].y === 120 && t.glyphs[1].x === 72 && ys.includes(144) && ys.includes(168) && ys.includes(192) && t.glyphs.every(e => e.font === 16);
})());
check('layout A: the picture is 224x96 centred at the top', (() => {
  const g = recorder(); UI.panel(g, { layout: 'A', pic: 'p-barge-fire', lines: ['X'] });
  return g.calls.some(c => c.m === 'fillRect' && c.a.join() === '80,16,224,96');
})());
check('layout B: portrait at (16,0), lines beside at x 112 from y 8, lines2 at x 64 from y 184 under a 96-tall picture', (() => {
  const g = recorder(); let glyphs = []; UI.trace = e => glyphs.push(e);
  UI.panel(g, { layout: 'B', who: 'jack', pic: { w: 160, h: 96 }, lines: ['AB', 'CD', 'EF'], lines2: ['GH'] }); UI.trace = null;
  const portrait = g.calls.some(c => c.m === 'fillRect' && c.a.join() === '16,0,72,72'), pic = g.calls.some(c => c.m === 'fillRect' && c.a.join() === '128,80,160,96');
  const beside = glyphs.filter(e => e.x >= 112 && e.y === 8 || e.y === 32 || e.y === 56).length === 6, below = glyphs.some(e => e.x === 64 && e.y === 184);
  return portrait && pic && beside && below;
})());
check('layout B: a 64-tall picture sits at y 64 with lines2 at y 144', (() => {
  const g = recorder(); let glyphs = []; UI.trace = e => glyphs.push(e);
  UI.panel(g, { layout: 'B', who: 'mustapha', pic: { w: 128, h: 64 }, lines: ['A'], lines2: ['B'] }); UI.trace = null;
  return g.calls.some(c => c.m === 'fillRect' && c.a.join() === '144,64,128,64') && glyphs.some(e => e.x === 64 && e.y === 144);
})());
check('layout C: picture at (32,16), first line beside at (192,32), the rest at x 32 from y 104', (() => {
  const g = recorder(); let glyphs = []; UI.trace = e => glyphs.push(e);
  UI.panel(g, { layout: 'C', pic: { w: 128, h: 64 }, lines: ['AB', 'CD', 'EF'] }); UI.trace = null;
  return g.calls.some(c => c.m === 'fillRect' && c.a.join() === '32,16,128,64') && glyphs[0].x === 192 && glyphs[0].y === 32 && glyphs[2].x === 32 && glyphs[2].y === 104 && glyphs[4].y === 128;
})());
check('panel clips to 4 lines and 30 characters without throwing', (() => { const t = traced(g => UI.panel(g, { lines: ['A'.repeat(40), 'B', 'C', 'D', 'E', 'F'] })); return t.glyphs.length === 43 && t.r === 0; })());

/* ---------- 6. caption, card, boss card, dialogue, radio ---------- */
check('caption: 8x16, centred on row 23 (y 184), x snapped to 8', (() => {
  const t = traced(g => UI.caption(g, '47TH STREET', 10)); return t.r === true && t.glyphs[0].y === 184 && t.glyphs[0].x === 144 && t.glyphs.every(e => e.font === 16);
})());
check('caption: visible for 150 frames then gone', (() => { const a = traced(g => UI.caption(g, 'X', 149)), b = traced(g => UI.caption(g, 'X', 150)); return a.r === true && a.glyphs.length === 1 && b.r === false && b.glyphs.length === 0; })());
check('card: stage 1 shows the pre caption for 2 s, then the map, the marker and the typed title', (() => {
  const c = { pre: 'EAST COAST — SIX MONTHS LATER', chapter: 1, name: 'WASSOON', marker: 'wassoon' };
  const pre = traced(g => UI.card(g, Object.assign({ t: 60 }, c))), then = traced(g => UI.card(g, Object.assign({ t: 120 }, c))), later = traced(g => UI.card(g, Object.assign({ t: 124 }, c))), full = traced(g => UI.card(g, c));
  // t 124 = 4 frames of typing = 8 characters = 'STAGE 1' and the name's W (the space is not drawn: 7 glyphs)
  return pre.r.phase === 'pre' && pre.glyphs.every(e => e.y === 184) && then.r.phase === 'card' && then.glyphs.length === 0 && then.r.remaining === 14 && later.glyphs.length === 7 && later.r.remaining === 6 && full.r.remaining === 0 && full.glyphs.some(e => e.y === 136) && full.glyphs.some(e => e.y === 168);
})());
check('card: the map picture sits in the frame at (80,16) 224x96 and the marker blinks on t', (() => {
  const g = recorder(); UI.card(g, { chapter: 2, name: 'THE CORAL CAUSEWAY', marker: 'causeway', t: 400 });
  const map = g.calls.some(c => c.m === 'fillRect' && c.a.join() === '80,16,224,96'), frame = g.calls.some(c => c.m === 'fillRect' && c.a.join() === '72,8,240,112');
  const markerOn = g.calls.filter(c => c.m === 'fillRect' && c.fillStyle === UI.PEN.red && c.a[2] === 7).length;
  const g2 = recorder(); UI.card(g2, { chapter: 2, name: 'X', marker: 'causeway', t: 408 });
  const markerOff = g2.calls.filter(c => c.m === 'fillRect' && c.fillStyle === UI.PEN.red && c.a[2] === 7).length;
  return map && frame && markerOn === 1 && markerOff === 0;
})());
check('card: the shipped marker ids city-in-the-sea and river-head blink at their own spots, not the default', (() => {
  const spot = marker => { const g = recorder(); UI.card(g, { chapter: 4, name: 'X', marker, t: 400 }); const c = g.calls.find(c => c.m === 'fillRect' && c.fillStyle === UI.PEN.red && c.a[2] === 7); return c ? [c.a[0] + 3 - 80, c.a[1] + 1 - 16] : null; };
  const sea = spot('city-in-the-sea'), river = spot('river-head'), dflt = spot('nowhere');
  return JSON.stringify(sea) === JSON.stringify(UI.CARD_MARKERS['city-in-the-sea']) && JSON.stringify(river) === JSON.stringify(UI.CARD_MARKERS['river-head']) && JSON.stringify(dflt) === '[112,48]' && sea.join() !== dflt.join() && river.join() !== dflt.join();
})());
check('bossCard: name in 8x16 at y 66, sub in 8x8 at y 86, gone after 144 frames', (() => {
  const a = traced(g => UI.bossCard(g, { name: 'WARDEN ROOK', sub: 'WARDEN OF THE JAIL BARGE', t: 30 })), b = traced(g => UI.bossCard(g, { name: 'X', t: 144 }));
  return a.r === true && a.glyphs.some(e => e.y === 66 && e.font === 16) && a.glyphs.some(e => e.y === 86 && e.font === 8) && b.r === false && b.glyphs.length === 0;
})());
check('bossCard restores globalAlpha', (() => { const g = recorder(); g.globalAlpha = 1; UI.bossCard(g, { name: 'X', t: 140 }); return g.globalAlpha === 1; })());
check('dialogue: framed portrait at (32,24) 88x88, lines at x 144 from y 48 with a 16 px pitch', (() => {
  const g = recorder(); let glyphs = []; UI.trace = e => glyphs.push(e);
  const r = UI.dialogue(g, { who: 'jack', lines: ['HEY CREEP!', 'GET AWAY FROM THAT DINO!'] }); UI.trace = null;
  return r === 0 && g.calls.some(c => c.m === 'fillRect' && c.a.join() === '32,24,88,88') && g.calls.some(c => c.m === 'fillRect' && c.a.join() === '40,32,72,72') && glyphs[0].x === 144 && glyphs[0].y === 48 && glyphs.some(e => e.y === 64);
})());
check('dialogue: a villain without a portrait gets a name tag in the accent colour', (() => {
  const g = recorder(); UI.dialogue(g, { who: 'ROOK', accent: '#8fb3e6', lines: ['X'] });
  return g.calls.some(c => c.m === 'fillRect' && c.fillStyle === '#8fb3e6' && c.a[0] >= 40 && c.a[0] < 112 && c.a[2] <= 7);   // glyph runs of the tag inside the 72 px box
})());
check('dialogue types at 2 characters per frame', (() => { const t = traced(g => UI.dialogue(g, { who: 'mess', lines: ['ABCDEF'], typed: 1 })); return t.glyphs.filter(e => e.x >= 144).length === 2 && t.r === 4; })());
check('radio: strip background in the §1.7 rect, tag in accent, 72 chars wrap to two rows', (() => {
  const g = recorder(); let glyphs = []; UI.trace = e => glyphs.push(e);
  const rows = UI.radio(g, { name: 'HANNAH', accent: '#8fb3e6', text: 'The jail barge is on fire! Who would attack Wassoon? Look at the sea wall!' }); UI.trace = null;
  return rows === 2 && g.calls.some(c => c.m === 'fillRect' && c.a.join() === '8,46,368,14') && glyphs[0].pen === '#8fb3e6' && glyphs[0].y === 46 && glyphs.some(e => e.y === 53) && glyphs.every(e => e.x >= 8 && e.x + 8 <= 376 && e.y >= 46 && e.y + 7 <= 60);
})());
check('radio: the 8x8 rows at the 7 px pitch never bleed into each other (every ink row inside its own 7 px band)', (() => {
  const g = recorder(); UI.radio(g, { name: 'MESS', text: 'HEY, CREEP; LOOK: AT, THIS; LINE, OF, PUNCTUATION, THAT, WRAPS, TO, THE, SECOND, ROW, OF, THE, STRIP, OK' });
  const runs = g.calls.filter(c => c.m === 'fillRect' && c.a[3] <= 2 && c.a[1] >= 46 && c.a[1] < 60);
  return runs.length > 50 && runs.every(c => (c.a[1] < 53 ? c.a[1] + c.a[3] <= 53 : c.a[1] + c.a[3] <= 60));
})());
check('radio: font 16 (PLAN G6) uses the tall rect (8,46)-(376,78): two 8x16 rows at y 46 and 62 with the tag in accent', (() => {
  const g = recorder(); let glyphs = []; UI.trace = e => glyphs.push(e);
  const rows = UI.radio(g, { font: 16, name: 'HANNAH', accent: '#8fb3e6', text: 'The jail barge is on fire! Who would attack Wassoon? Look at the sea wall!' }); UI.trace = null;
  const ink = g.calls.filter(c => c.m === 'fillRect' && c.a[3] <= 2 && c.a[1] >= 46);
  return rows === 2 && g.calls.some(c => c.m === 'fillRect' && c.a.join() === '8,46,368,32') && glyphs[0].pen === '#8fb3e6' && glyphs.every(e => e.font === 16 && (e.y === 46 || e.y === 62)) && ink.every(c => c.a[1] + c.a[3] <= 78);
})());

/* ---------- 7. tally, staff roll, thanks, continue ---------- */
check('tally: rows appear every 30 frames, TOTAL in yellow after the fourth', (() => {
  const s = { chapter: 1, vitality: 8800, enemies: 4200, finalBlow: 20000 };
  const a = traced(g => UI.tally(g, Object.assign({ t: 0 }, s))), b = traced(g => UI.tally(g, Object.assign({ t: 60 }, s))), c = traced(g => UI.tally(g, Object.assign({ t: 120 }, s)));
  const total = c.glyphs.filter(e => e.pen === 'yellow' && e.y === 148).map(e => e.ch).join('');
  return a.r.rows === 0 && !a.glyphs.some(e => e.y === 72) && b.r.rows === 2 && b.glyphs.some(e => e.y === 96) && !b.glyphs.some(e => e.y === 120) && c.r.rows === 4 && total === 'TOTAL33000';
})());
check('tally: values are right-aligned to x 304', (() => { const t = traced(g => UI.tally(g, { vitality: 123, enemies: 0, finalBlow: 0 })); const v = t.glyphs.filter(e => e.y === 72 && e.x >= 200); return v.length === 3 && v[2].x === 296; })());
check('staffRoll: categories red, names white, 16 px pitch, scrolling up 0.5 px per frame until done', (() => {
  const a = traced(g => UI.staffRoll(g, 100)), b = traced(g => UI.staffRoll(g, 200));
  const cat = a.glyphs.find(e => e.pen === 'red'), name = a.glyphs.find(e => e.pen === 'white');
  const first = a.glyphs[0], firstB = b.glyphs.find(e => e.ch === first.ch && e.x === first.x);
  let done = null; for (let t = 0; t < 6000 && done == null; t += 100) if (UI.staffRoll(recorder(), t).done) done = t;
  return cat && name && name.y - cat.y === 16 && firstB && first.y - firstB.y === 50 && a.glyphs.every(e => e.y >= -16 && e.y < 224) && done != null && done > 1000 && !UI.staffRoll(recorder(), 0).done;
})());
check('thanks: 16x16 lines at y 40 and y 168; a line over 23 cells drops to 8x16 and stays on screen', (() => {
  const t = traced(g => UI.thanks(g, ['THANK YOU FOR PLAYING', 'A FAN SEQUEL MADE FOR MOSTAFA'])), s = traced(g => UI.thanks(g, ['THANKS', 'MOSTAFA']));
  return t.glyphs.some(e => e.y === 40 && e.scale === 2) && t.glyphs.filter(e => e.y === 168).every(e => e.scale === 1 && e.font === 16) && t.glyphs.every(e => e.x >= 0 && e.x + 8 * e.scale <= 384) && s.glyphs.some(e => e.y === 168 && e.scale === 2);
})());
check('continueCount: red 0:09 centred at y 56, hint blinks on t', (() => {
  const a = traced(g => UI.continueCount(g, { count: 9, hint: 'INSERT COIN', t: 0 })), b = traced(g => UI.continueCount(g, { count: 9, hint: 'INSERT COIN', t: 40 }));
  const digits = a.glyphs.filter(e => e.y === 56).map(e => e.ch).join('');
  return digits === '0:09' && a.glyphs.every(e => e.y !== 56 || e.pen === 'red') && a.glyphs.some(e => e.y === 92) && !b.glyphs.some(e => e.y === 92);
})());
check('coinSlot: INSERT COIN centred in slot 0 at x 192, JOIN-IN in slot 1 at x 320', (() => {
  const a = traced(g => UI.coinSlot(g, 0, 'INSERT COIN', 0)), b = traced(g => UI.coinSlot(g, 1, 'JOIN-IN', 0)), off = traced(g => UI.coinSlot(g, 0, 'INSERT COIN', 40));
  const cx = gl => (gl[0].x + gl[gl.length - 1].x + 8) / 2;
  return Math.abs(cx(a.glyphs) - 192) <= 4 && Math.abs(cx(b.glyphs) - 320) <= 4 && off.glyphs.length === 0;
})());

/* ---------- 8. text() options and pens ---------- */
check('text: a CSS colour pen is used as fillStyle', (() => { const g = recorder(); UI.text(g, 'A', 0, 0, { pen: '#8fb3e6' }); return g.calls.some(c => c.m === 'fillRect' && c.fillStyle === '#8fb3e6'); })());
check('text: shadow is drawn before the glyph, outline draws 8 neighbours, plain draws none', (() => {
  const s = recorder(); UI.text(s, 'I', 0, 0); const o = recorder(); UI.text(o, 'I', 0, 0, { outline: true }); const p = recorder(); UI.text(p, 'I', 0, 0, { shadow: false });
  const shadows = g => g.calls.filter(c => c.m === 'fillRect' && c.fillStyle === UI.PEN.shadow).length, pens = g => g.calls.filter(c => c.m === 'fillRect' && c.fillStyle !== UI.PEN.shadow).length;
  return shadows(s) === pens(s) && s.calls[0].fillStyle === UI.PEN.shadow && shadows(o) === 8 * pens(o) && shadows(p) === 0 && pens(p) > 0;
})());
check('text: 8x16 glyphs occupy rows 1-14 of the cell (ROM narrow font metrics)', (() => {
  const g = recorder(); UI.text(g, 'H', 0, 100, { font: 16, shadow: false });
  const ys = g.calls.filter(c => c.m === 'fillRect').map(c => [c.a[1], c.a[1] + c.a[3]]); const top = Math.min(...ys.map(y => y[0])), bottom = Math.max(...ys.map(y => y[1]));
  return top === 101 && bottom === 115;
})());
check('text: 8x16 "," and ";" stay inside rows 1-14 of the cell (no overflow into the next line)', (() => {
  const g = recorder(); UI.text(g, ',;.', 0, 100, { font: 16, shadow: false });
  const ys = g.calls.filter(c => c.m === 'fillRect').map(c => [c.a[1], c.a[1] + c.a[3]]);
  return ys.length > 0 && Math.min(...ys.map(y => y[0])) >= 101 && Math.max(...ys.map(y => y[1])) <= 115;
})());
check('text: align center/right and snap', (() => { const a = traced(g => UI.text(g, 'ABCD', 192, 0, { align: 'center' })), b = traced(g => UI.text(g, 'ABCD', 100, 0, { align: 'right' })), c = traced(g => UI.text(g, 'ABC', 100, 0, { align: 'center', snap: true })); return a.glyphs[0].x === 176 && b.glyphs[0].x === 68 && c.glyphs[0].x === 88; })());
check('text: max reveals a prefix and reports shown/total', (() => { const g = recorder(); const r = UI.text(g, 'HELLO WORLD', 0, 0, { max: 7 }); return r.shown === 7 && r.total === 11 && r.w === 88; })());
check('text: returns the pixel width of the longest line', UI.text(recorder(), 'AB\nCDEF', 0, 0).w === 32);

/* ---------- 9. ROM_UI path (shape of PLAN §4.1) and its guards ---------- */
/* The ROM font is a glyph SOURCE: arcade-ui decodes each tile once (ink = bright opaque pixels, the tile's own shadow =
   dark opaque pixels) and paints the ink in any pen with its own shadow/outline passes, so no pens table is needed and
   no glyph can come out in the wrong colour. The synthetic sheet below is in the §4.1 shape: every tile is a solid ink
   block (cols 2-6) with a shadow column at col 0, i.e. NOT where a synthetic +1,+1 drop shadow would fall. */
(() => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?\'"-·/()';
  const font8 = {}, font16 = {}; let i = 0;
  for (const ch of chars) { font8[ch] = [(i % 32) * 8, Math.floor(i / 32) * 8]; font16[ch] = [(i % 32) * 8, 64 + Math.floor(i / 32) * 16]; i++; }
  const sheet = fakeCanvas(); sheet.width = 256; sheet.height = 256; const sg = sheet.getContext('2d');
  for (const ch of chars) {
    if (ch === ' ') continue;
    const [x8, y8] = font8[ch], [x16, y16] = font16[ch];
    sg.fillStyle = '#f8f8f8'; sg.fillRect(x8 + 2, y8 + 1, 5, 6); sg.fillRect(x16 + 2, y16 + 1, 5, 14);   // ink
    sg.fillStyle = '#202020'; sg.fillRect(x8, y8 + 1, 1, 6); sg.fillRect(x16, y16 + 1, 1, 14);           // the tile's own shadow pen
  }
  sg.fillStyle = '#4060a0'; sg.fillRect(0, 128, 72, 72);                                                 // portrait record 4000
  const ROM_UI = { v: 1, family: 'ui', mode: 'indexed', sheets: { ui: { png: 'data:,', w: 256, h: 256, sum: '0' } }, rect: { ui: { 4000: [0, 128, 72, 72, 0, 0] } }, pal: { rows: {}, maps: { ui: [] } },
    font8, font16, portraits: { '0x00': 4000, '0x01': 4000, '0x02': 4000, '0x03': 4000, '0x04': 4000 }, cardFrame: 4001, hudPortraits: {}, lifeBar: {} };
  const sprites = () => { const calls = []; return { calls, SPRITES: { ready: true, verified: true, canvasFor(sheetId, map) { calls.push([sheetId, map]); return sheet; }, has: () => true } }; };
  const DOC = { createElement: tag => tag === 'canvas' ? fakeCanvas() : null };
  const WHITE = [0xf8, 0xf8, 0xf8], RED = [0xe8, 0x40, 0x2c], SHADOW = [0x14, 0x14, 0x14];
  const at = (g, x, y) => Array.from(g.pixels.subarray((y * 384 + x) * 4, (y * 384 + x) * 4 + 3)), is = (g, x, y, c) => at(g, x, y).join() === c.join(), clear = (g, x, y) => g.pixels[(y * 384 + x) * 4 + 3] === 0;
  const draw = (U, str, opts) => { const g = raster(); U.text(g, str, 10, 20, opts); return g; };

  const m2 = sprites(), s2 = load({ ROM_UI, SPRITES: m2.SPRITES, document: DOC }), U2 = s2.ARCADE_UI;
  check('ROM fonts are decoded when ROM_UI, SPRITES and a canvas exist', U2.romFonts === true);
  check('ROM 8x16 glyphs decode into native 16-row ink masks plus the tile\'s shadow mask', (() => { const d = U2.romGlyphs(16).glyphs.H; return d && d.native === true && d.cells === 1 && d.rows.length === 16 && d.rows[0] === 0 && d.rows[1] === 0x7c && d.rows[14] === 0x7c && d.rows[15] === 0 && d.dark && d.dark[1] === 1; })());
  check('ROM glyph: ink in the pen, the tile\'s own shadow in the shadow pen, no synthetic drop shadow, native rows', (() => {
    const g = draw(U2, 'H', { font: 16, pen: 'red' });
    return is(g, 12, 21, RED) && is(g, 16, 34, RED) && clear(g, 12, 20) && clear(g, 12, 35) && is(g, 10, 21, SHADOW) && is(g, 10, 34, SHADOW) && clear(g, 11, 21) && clear(g, 17, 35) && clear(g, 17, 22);
  })());
  check('ROM glyph shapes are used, not the authored ones (trace src = rom)', (() => {
    const g = draw(U2, 'H', { font: 16, shadow: false }); let src = null; U2.trace = e => { src = e.src; }; U2.text(recorder(), 'H', 0, 0, { font: 16 }); U2.trace = null;
    const a = draw(UI, 'H', { font: 16, shadow: false });                                             // authored H: row 1 cols 0 and 5 only
    return src === 'rom' && is(g, 12, 21, WHITE) && clear(a, 12, 21) && is(a, 10, 21, WHITE);
  })());
  check('ROM glyph in a CSS pen (accent) and in yellow', is(draw(U2, 'H', { font: 16, pen: '#8fb3e6' }), 12, 21, [0x8f, 0xb3, 0xe6]) && is(draw(U2, 'T', { pen: 'yellow' }), 12, 21, [0xf8, 0xd8, 0x38]));
  check('ROM glyph with outline: the 8 neighbours of the ink in the shadow pen, the tile\'s shadow column dropped', (() => {
    const g = draw(U2, 'H', { font: 16, outline: true });
    return is(g, 12, 21, WHITE) && is(g, 11, 20, SHADOW) && is(g, 17, 35, SHADOW) && is(g, 11, 27, SHADOW) && is(g, 17, 27, SHADOW) && clear(g, 10, 21) && clear(g, 10, 27);
  })());
  check('ROM glyph plain (shadow:false): ink only', (() => { const g = draw(U2, 'H', { font: 16, shadow: false }); return is(g, 12, 21, WHITE) && clear(g, 10, 21) && clear(g, 17, 35); })());
  check('ROM 8x8 glyphs: 8 native rows, at scale 2 every pixel doubles', (() => {
    const g = draw(U2, 'A'), g2 = draw(U2, 'A', { scale: 2 });
    return is(g, 12, 21, WHITE) && is(g, 16, 26, WHITE) && clear(g, 12, 27) && is(g, 10, 21, SHADOW) && is(g2, 14, 22, WHITE) && is(g2, 15, 23, WHITE) && is(g2, 23, 33, WHITE) && clear(g2, 14, 34) && is(g2, 10, 22, SHADOW) && is(g2, 11, 23, SHADOW);
  })());
  check('A glyph the ROM font lacks falls back to the authored glyph (trace src = auth)', (() => { const srcs = []; U2.trace = e => srcs.push(e.src); U2.text(recorder(), 'A…B', 0, 0); U2.trace = null; const g = draw(U2, '…', { shadow: false }); return srcs.join() === 'rom,auth,rom' && is(g, 11, 25, WHITE) && is(g, 23, 26, WHITE); })());
  // G8 (PLAN §8.4, draw calls <= 150 per frame): a line is drawn once from 10 px atlas cells into a cached strip, then
  // the strip is one drawImage per line at (x-1, y-1); the same line again reuses the strip. Its pixels are the glyphs'
  // (the raster rows above draw through the strip too).
  check('With a canvas, a line is one drawImage of its cached strip of 10 px atlas cells at (x-1, y-1), reused when drawn again', (() => {
    const g = recorder(); U2.text(g, 'HI', 10, 20, { font: 16 }); U2.text(g, 'HI', 10, 40, { font: 16 }); const di = g.calls.filter(c => c.m === 'drawImage');
    return di.length === 2 && di[0].a[0] === di[1].a[0] && di[0].a[3] === 18 && di[0].a[4] === 18 && di[0].a[5] === 9 && di[0].a[6] === 19 && di[0].a[7] === 18 && di[1].a[6] === 39 && g.calls.every(c => c.m !== 'fillRect');
  })());
  check('A traced line (ARCADE_UI.trace, the layout checks) still draws glyph by glyph: one drawImage per glyph at (x-1, y-1)', (() => {
    const g = recorder(); U2.trace = () => {}; U2.text(g, 'HI', 10, 20, { font: 16 }); U2.trace = null; const di = g.calls.filter(c => c.m === 'drawImage');
    return di.length === 2 && di[0].a[3] === 10 && di[0].a[4] === 18 && di[0].a[5] === 9 && di[0].a[6] === 19 && di[1].a[5] === 17;
  })());
  for (let k = 0; k < 30; k++) U2.text(recorder(), 'THE DECODE RUNS ONCE', 0, 0, { font: k % 2 ? 16 : 8, pen: k % 3 ? 'red' : 'white' });
  check('The ROM sheet is read once per font (no per-call colouriser work)', m2.calls.length <= 2, m2.calls.length + ' canvasFor calls');
  const gp = recorder(); U2.dialogue(gp, { who: 'hannah', lines: ['X'] });
  check('ROM portraits are blitted through the rect table (72x72 at (40,32))', gp.calls.some(c => c.m === 'drawImage' && c.a[0] === sheet && c.a[1] === 0 && c.a[2] === 128 && c.a[3] === 72 && c.a[4] === 72 && c.a[5] === 40 && c.a[6] === 32));

  const m5 = sprites(), s5 = load({ ROM_UI, SPRITES: m5.SPRITES }), U5 = s5.ARCADE_UI;             // no document: nothing can be decoded
  for (let k = 0; k < 20; k++) U5.text(recorder(), 'NO CANVAS HERE', 0, 0, { pen: 'red' });
  const g5 = recorder(); U5.text(g5, 'HI', 10, 20, { font: 16, pen: 'red' });
  check('Without a canvas the authored font is used for every pen (fillRect runs, no ROM blit) and the decode is not retried', U5.romFonts === false && g5.calls.some(c => c.m === 'fillRect' && c.fillStyle === U5.PEN.red) && g5.calls.every(c => c.m !== 'drawImage') && m5.calls.length <= 2, m5.calls.length + ' canvasFor calls');
  let ready = false; const s6 = load({ ROM_UI, SPRITES: { canvasFor: () => ready ? sheet : null }, document: DOC }), U6 = s6.ARCADE_UI;
  const srcs6 = []; U6.trace = e => srcs6.push(e.src); U6.text(recorder(), 'A', 0, 0); const before = U6.romFonts; ready = true; U6.text(recorder(), 'A', 0, 0); U6.trace = null;
  check('A sheet that is not ready yet falls back, then the ROM font is picked up on a later call', before === false && srcs6.join() === 'auth,rom' && U6.romFonts === true);
  const s3 = load({ ROM_UI, SPRITES: { canvasFor() { throw new Error('boom'); } }, document: DOC });
  const g3 = recorder(); let threw = false; try { s3.ARCADE_UI.panel(g3, { layout: 'B', who: 'jack', lines: ['SAFE'] }); } catch (e) { threw = true; }
  check('A throwing colouriser falls back silently', !threw && g3.calls.some(c => c.m === 'fillRect' || c.m === 'drawImage') && s3.ARCADE_UI.romFonts === false);
  const s4 = load({ ROM_UI: { v: 1, family: 'ui', sheets: {} }, document: DOC });
  check('A ROM_UI without fonts falls back', s4.ARCADE_UI.romFonts === false && (s4.ARCADE_UI.text(recorder(), 'A', 0, 0), true));
  class Image { constructor() { this.complete = true; this.naturalWidth = 256; this.width = 256; this.height = 256; this.pixels = sheet.pixels; } set src(v) { this._src = v; } }
  const s7 = load({ ROM_UI: Object.assign({}, ROM_UI, { mode: 'rgba' }), Image, document: DOC }), U7 = s7.ARCADE_UI;
  check('An rgba-mode sheet (no SPRITES) decodes from its image once loaded', U7.romFonts === true && is(draw(U7, 'H', { font: 16, pen: 'red' }), 12, 21, RED));
})();

/* ---------- 10. 100 frames of every screen through the recorder: nothing throws ---------- */
const SCREENS = [
  ['panel-A', (g, t) => UI.panel(g, { layout: 'A', pic: 'p-barge-fire', lines: ['HURRY UP! THE MARSHAL', 'WANTS THEM COLD.'], typed: t })],
  ['panel-B', (g, t) => UI.panel(g, { layout: 'B', who: 'hannah', pic: 'p-manifest', lines: ['ROOK’S MANIFEST SAYS THE PODS', 'RIDE THE CORAL CAUSEWAY.'], lines2: ['IT ONLY SURFACES AT', 'LOW TIDE.'], typed: t })],
  ['panel-B3', (g, t) => UI.panel(g, { layout: 'B', who: 'jack', lines: ['FESSENDEN’S DEAD. WE WATCHED', 'THAT LAB GO UP.', 'SO WHO’S SHOPPING IN HIS', 'GRAVE?'], typed: t })],
  ['panel-C', (g, t) => UI.panel(g, { layout: 'C', pic: 'p-echo-speaker', lines: ['YOU BROKE HIS BODY.', 'YOU NEVER BROKE HIS WORK.'], typed: t })],
  ['card-pre', (g, t) => UI.card(g, { pre: 'EAST COAST — SIX MONTHS LATER', chapter: 1, name: 'WASSOON', marker: 'wassoon', label: 'WASSOON', t })],
  ['card', (g, t) => UI.card(g, { chapter: 2, name: 'THE CORAL CAUSEWAY', marker: 'causeway', label: 'THE CORAL CAUSEWAY', t: t + 120 })],
  ['caption', (g, t) => { g.fillStyle = '#304050'; g.fillRect(0, 0, 384, 224); UI.caption(g, 'WASSOON HARBOR', t); }],
  ['bossCard', (g, t) => { g.fillStyle = '#304050'; g.fillRect(0, 0, 384, 224); UI.bossCard(g, { name: 'WARDEN ROOK', sub: 'WARDEN OF THE JAIL BARGE', t, accent: '#8fb3e6' }); UI.radio(g, { name: 'MESS', accent: '#8fb3e6', text: 'Hey… I know that face.' }); UI.coinSlot(g, 0, 'INSERT COIN', t); UI.coinSlot(g, 1, 'JOIN-IN', t); }],
  ['radio', (g, t) => { g.fillStyle = '#304050'; g.fillRect(0, 0, 384, 224); UI.radio(g, { name: 'HANNAH', accent: '#8fb3e6', text: 'The jail barge is on fire! Who would attack Wassoon? Look at the sea wall!' }); UI.coinSlot(g, 0, 'INSERT COIN', t); UI.coinSlot(g, 1, 'JOIN-IN', t); }],
  ['radio-tall', (g, t) => { g.fillStyle = '#304050'; g.fillRect(0, 0, 384, 224); UI.radio(g, { font: 16, name: 'HANNAH', accent: '#8fb3e6', text: 'The jail barge is on fire! Who would attack Wassoon? Look at the sea wall!' }); UI.coinSlot(g, 0, 'INSERT COIN', t); UI.coinSlot(g, 1, 'JOIN-IN', t); }],
  ['dialogue', (g, t) => { g.fillStyle = '#304050'; g.fillRect(0, 0, 384, 224); UI.dialogue(g, { who: 'fessenden', lines: ['NO! NOT AGAIN!', 'I’M NOT FINISH—'], typed: t, dim: true }); }],
  ['dialogue-tag', (g, t) => { g.fillStyle = '#304050'; g.fillRect(0, 0, 384, 224); UI.dialogue(g, { who: 'ROOK', accent: '#8fb3e6', lines: ['NEVER SEEN YOU BEFORE IN MY', 'LIFE. AND IT’S A SHORT LIFE.'], typed: t }); }],
  ['tally', (g, t) => { g.fillStyle = '#304050'; g.fillRect(0, 0, 384, 224); UI.tally(g, { chapter: 1, vitality: 8800, enemies: 4200, finalBlow: 20000, t: t * 2, lines: ['ROOK’S MANIFEST LISTS CARGO', 'NOBODY SHOULD BE ABLE TO SELL.'] }); }],
  ['staffRoll', (g, t) => { g.fillStyle = '#c86030'; g.fillRect(0, 0, 384, 224); UI.staffRoll(g, 300 + t * 2); }],
  ['thanks', (g, t) => { g.fillStyle = '#c86030'; g.fillRect(0, 0, 384, 224); UI.thanks(g, ['THANK YOU FOR PLAYING', 'A FAN SEQUEL MADE FOR MOSTAFA']); }],
  ['continue', (g, t) => { g.fillStyle = '#304050'; g.fillRect(0, 0, 384, 224); UI.continueCount(g, { count: 9 - Math.floor(t / 12), hint: 'INSERT COIN', t }); }]
];
(() => {
  const errors = [];
  for (const [name, draw] of SCREENS) { for (let t = 0; t < 100; t++) { try { draw(recorder(), t); } catch (e) { errors.push(name + '@' + t + ': ' + e.message); break; } } }
  check('100 frames of every screen draw without throwing (' + SCREENS.length + ' screens)', errors.length === 0, errors.join('; '));
  // Determinism: the same frame records the same calls twice.
  const dump = t => { const g = recorder(); SCREENS[1][1](g, t); return JSON.stringify(g.calls.map(c => [c.m, c.a.map(a => typeof a === 'object' ? 'img' : a), c.fillStyle])); };
  check('The same frame renders the same call list twice', dump(7) === dump(7) && dump(7) !== dump(8));
})();

/* ---------- 11. review PNGs (optional: --png) ---------- */
if (process.argv.includes('--png')) {
  const dir = path.join(ROOT, 'work', 're', 'impl', 'WP-I', 'review'); fs.mkdirSync(dir, { recursive: true });
  for (const [name, draw] of SCREENS) { const g = raster(); draw(g, 99); writePNG(path.join(dir, name + '.png'), 384, 224, g.pixels); }
  const g = raster(); g.fillStyle = '#000'; g.fillRect(0, 0, 384, 224);
  UI.text(g, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8, 8); UI.text(g, '0123456789 .,:;!?\'"-—·/()&+=×%*…', 8, 24);
  UI.text(g, 'THE BUTCHER IS HUNTING IN THE', 8, 48, { font: 16 }); UI.text(g, 'NORTHERN WOODS. DON’T MESS…', 8, 72, { font: 16 });
  UI.text(g, 'PLANNING', 8, 104, { outline: true, pen: 'red' }); UI.text(g, 'HATTARI JRA', 8, 120, { outline: true }); UI.text(g, '0:09', 8, 144, { scale: 2, outline: true, pen: 'red' }); UI.text(g, 'INSERT COIN', 100, 144, { outline: true, pen: 'orange' });
  UI.text(g, 'JACK.T =1 100 CREDIT 0', 8, 184); UI.text(g, 'THE CROWN TIDE · THE END', 8, 200, { font: 16, pen: 'yellow' });
  writePNG(path.join(dir, 'font.png'), 384, 224, g.pixels);
  console.log('review PNGs written to ' + dir);
}

/* ---------- report ---------- */
for (const c of checks) console.log('PASS ' + c);
for (const f of failures) console.log('FAIL ' + f);
try { fs.mkdirSync(path.join(ROOT, 'tests', 'results'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'tests', 'results', 'ui.json'), JSON.stringify({ passed: checks.length, failed: failures.length, failures }, null, 1)); } catch (e) { /* results dir is optional */ }
console.log(`${checks.length} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
