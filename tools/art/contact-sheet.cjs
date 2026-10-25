#!/usr/bin/env node
// tools/art/contact-sheet.cjs - preview of an imported body (tools/art/import-sprite.cjs output) next to a ROM hero frame.
//   node tools/art/contact-sheet.cjs work/art/out/<id>/<id>.json [out.png] [--hero jack|hannah|mustapha|mess]
// Panels: (A) game scale - the hero's idle and the first frame of every anim at 2x (the game canvas is 2x the 384x224
// arcade screen), feet on one line; (B) every frame at 3x per anim with its feet line (red) and origin (cyan);
// (C) onion skin of each multi-frame anim at its origin (jitter shows as ghosting); (D) the palette.
'use strict';
const fs = require('fs'), path = require('path');
const png = require('../re/build/png.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
// 3x5 font, rows top->bottom, 3 bits each
const G = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011',
  H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101',
  O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110', 6: '011100111101111',
  7: '111001010010010', 8: '111101111101111', 9: '111101111001110', ' ': '000000000000000', ':': '000010000010000', '-': '000000111000000', '.': '000000000000010',
  '/': '001001010100100', '#': '101111101111101', '(': '010100100100010', ')': '010001001001010', ',': '000000000010100', '%': '101001010100101', '_': '000000000000111',
  '+': '000010111010000', '>': '100010001010100', '=': '000111000111000', '@': '010101111100011', "'": '010010000000000',
};

function canvas(w, h, bg) { const c = { w, h, rgba: new Uint8Array(w * h * 4) }; fill(c, 0, 0, w, h, bg); return c; }
function fill(c, x, y, w, h, col, a = 1) {
  for (let j = Math.max(0, y); j < Math.min(c.h, y + h); j++) for (let i = Math.max(0, x); i < Math.min(c.w, x + w); i++) {
    const o = (j * c.w + i) * 4;
    for (let k = 0; k < 3; k++) c.rgba[o + k] = Math.round(c.rgba[o + k] * (1 - a) + col[k] * a);
    c.rgba[o + 3] = 255;
  }
}
function text(c, x, y, s, col, sc = 2) {
  for (const ch of String(s).toUpperCase()) {
    const g = G[ch] || G[' '];
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r * 3 + q] === '1') fill(c, x + q * sc, y + r * sc, sc, sc, col);
    x += 4 * sc;
  }
  return x;
}
const textW = (s, sc = 2) => String(s).length * 4 * sc;
// a sprite = {w, h, ox, oy, px: Uint8Array rgba}; drawn with its origin at (x, y)
function blit(c, sp, x, y, sc, a = 1) {
  const X0 = x - sp.ox * sc, Y0 = y - sp.oy * sc;
  for (let j = 0; j < sp.h; j++) for (let i = 0; i < sp.w; i++) {
    const o = (j * sp.w + i) * 4; if (!sp.px[o + 3]) continue;
    fill(c, X0 + i * sc, Y0 + j * sc, sc, sc, [sp.px[o], sp.px[o + 1], sp.px[o + 2]], a);
  }
}

function heroIdle(name) {
  const g = globalThis; const had = 'window' in g; if (!had) g.window = g;
  require(path.join(ROOT, 'sprite-data-heroes.js'));
  const fam = g.window.SPRITE_DATA.families.heroes, C = fam.compat, i = C.lists[name].idle[0], rec = C.frames[i][0], r = fam.rect[name][rec];
  const sheet = png.fromDataURL(fam.sheets[name].png), map = fam.pal.maps[`hero-${name}`] || fam.pal.maps.hero;
  const [sx, sy, w, h, ox, oy] = r, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = ((sy + y) * sheet.width + sx + x) * 4; if (!sheet.rgba[o + 3]) continue;
    const slot = sheet.rgba[o], pen = sheet.rgba[o + 1]; if (pen === 15) continue;
    const row = fam.pal.rows[map[slot]]; if (!row) continue; const v = row[pen] >>> 0;
    px.set([(v >> 16) & 255, (v >> 8) & 255, v & 255, 255], (y * w + x) * 4);
  }
  return { w, h, ox, oy, px, name: name.toUpperCase() };
}

function render(jsonFile, opts = {}) {
  const fam = JSON.parse(fs.readFileSync(jsonFile, 'utf8')), dir = path.dirname(jsonFile);
  const sid = Object.keys(fam.sheets)[0], atlas = png.read(path.join(dir, fam.sheets[sid].file));
  const row = fam.pal.rows[(fam.bodies && fam.bodies[fam.id] && fam.bodies[fam.id].pal && fam.bodies[fam.id].pal.home) || (fam.pal.rows['art-' + fam.id] ? 'art-' + fam.id : fam.id)];
  const sprites = fam.frames.map(([, x, y, w, h, ox, oy], k) => {
    const px = new Uint8Array(w * h * 4);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const o = ((y + j) * atlas.width + x + i) * 4; if (!atlas.rgba[o + 3]) continue;
      const v = row[atlas.rgba[o + 1]] >>> 0; px.set([(v >> 16) & 255, (v >> 8) & 255, v & 255, 255], (j * w + i) * 4);
    }
    return { w, h, ox, oy, px, name: fam.frameNames[k] };
  });
  const hero = heroIdle(opts.hero || 'jack');
  const anims = Object.entries(fam.anims).map(([key, a]) => ({ key, name: a.name || key, f: a.f.map(([fid, d]) => [fid, d]) }));
  // frames no anim uses yet (a partial import) still get shown
  const used = new Set(anims.flatMap(a => a.f.map(x => x[0]))), loose = sprites.map((s, i) => i).filter(i => !used.has(i));
  if (loose.length) anims.push({ key: 'no anim', name: 'not in an anim yet', f: loose.map(i => [i, 0]) });
  const PAD = 16, BG = [24, 26, 32], INK = [230, 230, 220], DIM = [130, 135, 150];
  // sizes
  const S1 = 2, S2 = 3;
  const firsts = anims.map(a => sprites[a.f[0][0]]);
  const aW = PAD + [hero].concat(firsts).reduce((n, s) => n + s.w * S1 + 24, 0) + PAD;
  const aH = Math.max(hero.h, ...firsts.map(s => s.oy)) * S1 + 70;
  const bRows = anims.map(a => { const fs_ = a.f.map(([fid]) => sprites[fid]); return { a, fs: fs_, w: fs_.reduce((n, s) => n + s.w * S2 + 18, 0), up: Math.max(...fs_.map(s => s.oy)), dn: Math.max(0, ...fs_.map(s => s.h - s.oy)) }; });
  const bW = PAD * 2 + Math.max(...bRows.map(r => r.w), 200), bH = bRows.reduce((n, r) => n + (r.up + r.dn) * S2 + 40, 0) + 30;
  const multi = anims.filter(a => a.f.length > 1 && a.key !== 'no anim');
  const cCells = multi.map(a => { const fs_ = a.f.map(([fid]) => sprites[fid]); const l = Math.max(...fs_.map(s => s.ox)), r = Math.max(...fs_.map(s => s.w - s.ox)), u = Math.max(...fs_.map(s => s.oy)), d = Math.max(0, ...fs_.map(s => s.h - s.oy)); return { a, fs: fs_, l, r, u, d }; });
  const cW = PAD + cCells.reduce((n, c) => n + (c.l + c.r) * S2 + 24, 0) + PAD, cH = cCells.length ? Math.max(...cCells.map(c => (c.u + c.d) * S2)) + 60 : 0;
  const W = Math.max(aW, bW, cW, 760), H = 40 + aH + bH + cH + 90;
  const c = canvas(W, H, BG);
  let y = 12;
  text(c, PAD, y, `${fam.bodies ? fam.bodies[fam.id].hud : (fam.types && fam.types[fam.id] && fam.types[fam.id].title) || fam.id}  -  ${sprites.length} FRAMES  ${anims.length} ANIMS  ${fam.palette.hex.length} COLOURS + TRANSPARENT`, INK, 2); y += 24;
  // (A) game scale
  text(c, PAD, y, `GAME SCALE X${S1} (ARCADE PX X2) NEXT TO ROM ${hero.name} IDLE (${hero.h} PX)`, DIM, 2); y += 18;
  const base = y + Math.max(hero.h, ...firsts.map(s => s.oy)) * S1 + 8;
  fill(c, 0, y, W, base - y, [70, 84, 104]); fill(c, 0, base, W, aH - (base - y) - 8, [92, 82, 66]);
  let x = PAD;
  for (const s of [hero].concat(firsts)) { blit(c, s, x + s.ox * S1, base, S1); x += s.w * S1 + 24; }
  x = PAD; [hero].concat(firsts).forEach((s, k) => { text(c, x, base + 8, k === 0 ? hero.name : anims[k - 1].name, INK, 1); x += s.w * S1 + 24; });
  y += aH;
  // (B) frames per anim
  text(c, PAD, y, `FRAMES X${S2}: RED = FEET LINE (OY), CYAN = ORIGIN (OX); NUMBER = DURATION IN 60 HZ FRAMES`, DIM, 2); y += 22;
  for (const r of bRows) {
    text(c, PAD, y, `${r.a.name} (${r.a.key})`, INK, 2); y += 16;
    const bl = y + r.up * S2; x = PAD;
    r.fs.forEach((s, k) => {
      fill(c, x, y, s.w * S2, (r.up + r.dn) * S2, [34, 37, 46]);
      blit(c, s, x + s.ox * S2, bl, S2);
      fill(c, x - 4, bl, s.w * S2 + 8, 1, [230, 60, 60]); fill(c, x + s.ox * S2, bl - 6, 1, 12, [60, 220, 230]);
      text(c, x, bl + r.dn * S2 + 4, `${k}:${r.a.f[k][1]}`, DIM, 1);
      x += s.w * S2 + 18;
    });
    y += (r.up + r.dn) * S2 + 24;
  }
  y += 6;
  // (C) onion skin
  if (cCells.length) {
    text(c, PAD, y, 'REGISTRATION: ALL FRAMES OF AN ANIM AT ONE ORIGIN', DIM, 2); y += 20;
    x = PAD; const top = y;
    for (const cc of cCells) {
      const ox = x + cc.l * S2, bl = top + cc.u * S2;
      fill(c, x, top, (cc.l + cc.r) * S2, (cc.u + cc.d) * S2, [34, 37, 46]);
      cc.fs.forEach(s => blit(c, s, ox, bl, S2, Math.max(0.25, 1 / cc.fs.length + 0.1)));
      fill(c, x, bl, (cc.l + cc.r) * S2, 1, [230, 60, 60]); fill(c, ox, bl - 6, 1, 12, [60, 220, 230]);
      text(c, x, bl + cc.d * S2 + 6, cc.a.name, INK, 1);
      x += (cc.l + cc.r) * S2 + 24;
    }
    y += cH - 20;
  }
  // (D) palette
  text(c, PAD, y, 'PALETTE (CPS-1 4-BIT; PEN 15 TRANSPARENT)', DIM, 2); y += 18;
  fam.palette.hex.forEach((h, i) => {
    const v = parseInt(h.slice(1), 16), X = PAD + i * 48;
    fill(c, X, y, 40, 26, [(v >> 16) & 255, (v >> 8) & 255, v & 255]);
    text(c, X, y + 30, (i === fam.palette.outline ? 'OL ' : '') + i, DIM, 1); text(c, X, y + 38, h.slice(1), DIM, 1);
  });
  return c;
}
function write(jsonFile, outFile, opts) {
  const c = render(jsonFile, opts || {});
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  png.write(outFile, { width: c.w, height: c.h, rgba: c.rgba });
  return outFile;
}

if (require.main === module) {
  const a = process.argv.slice(2); let hero = 'jack'; const rest = [];
  for (let i = 0; i < a.length; i++) if (a[i] === '--hero') hero = a[++i]; else rest.push(a[i]);
  if (!rest[0]) { console.error('usage: node tools/art/contact-sheet.cjs <id>.json [out.png] [--hero jack]'); process.exit(2); }
  const fam = JSON.parse(fs.readFileSync(rest[0], 'utf8'));
  console.log(write(path.resolve(rest[0]), path.resolve(rest[1] || path.join(ROOT, `work/art/preview/${fam.id}-contact.png`)), { hero }));
}
module.exports = { render, write, heroIdle };
