// The cabinet's top HUD as the reference for PLAN §7 G7 ("the top bar matches the arcade layout within 2 px per
// element", §8.3 scene s30). Reads the live scroll1 dumps of the MAME run stg-ep1-walk (work/re/runs, git-ignored),
// renders the HUD rows (scroll1 is the HUD layer: nothing else of the stage uses rows 0-5) and measures every element of
// tests/lib/arcade.cjs HUD_ELEMENTS in two frames: f16 (JOIN-IN in both slots, the foe row showing GNEISS) and f72
// (INSERT COIN in both slots). Writes
//   tests/fixtures/hud-cabinet.json          the element boxes (arcade px [x0, y0, x1, y1]) and what the frames show
//   work/re/visual/hud-cabinet-f16.png, -f72.png   the scroll1 HUD rows at 1x on the #ff00ff key (review)
// Usage (repo root, no browser): node tools/re/hud-cabinet.cjs
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const S = require('./export/lib/cps-scroll.cjs'), A = require('../../tests/lib/arcade.cjs');
const RUN = 'stg-ep1-walk', FRAMES = { join: 16, insert: 72 };

function frame(f) {
  const file = path.join(ROOT, 'work', 're', 'runs', RUN, 'frames.jsonl');
  if (!fs.existsSync(file)) throw new Error(`${RUN}: no frames.jsonl (the MAME dumps are not on this machine)`);
  for (const ln of fs.readFileSync(file, 'utf8').split('\n')) { if (!ln || ln.indexOf(`"f":${f},`) < 0) continue; const o = JSON.parse(ln); if (o.f === f) return o; }
  throw new Error(`${RUN}: frame ${f} not dumped`);
}
// the HUD rows of one frame: {mask (1 = scroll1 pixel), rgba on the key, text of the P1 cells}
function hudOf(f) {
  const F = S.loadFrame(RUN, frame(f)), L = S.screenLayer(F, 1), page = F.pal.pages[S.LAYER[1].page], W = 384, H = 48;
  const mask = new Uint8Array(W * H), rgba = new Uint8Array(W * H * 4);
  for (let q = 0; q < W * H; q++) {
    const v = L.pen[q];
    if (v === 15) { rgba[q * 4] = 255; rgba[q * 4 + 1] = 0; rgba[q * 4 + 2] = 255; rgba[q * 4 + 3] = 255; continue; }
    const c = page[L.pal[q]][v]; mask[q] = 1; rgba[q * 4] = c[0]; rgba[q * 4 + 1] = c[1]; rgba[q * 4 + 2] = c[2]; rgba[q * 4 + 3] = 255;
  }
  const Rg = S.regs(F), cell = (c, r) => S.tileEntry(F, 1, ((c * 8 + 64 + Rg.s[1].x) & 511) >> 3, ((r * 8 + 16 + Rg.s[1].y) & 511) >> 3);
  const row = (r, c0, c1) => { let s = ''; for (let c = c0; c <= c1; c++) { const k = cell(c, r).code; s += k >= 0x20 && k < 0x7F ? String.fromCharCode(k) : k < 10 ? String(k) : k >= 0x124 && k <= 0x12D ? String(k - 0x124) : ' '; } return s.trim(); };
  return { W, H, mask, rgba, text: { lives: row(0, 3, 4), score: row(0, 5, 15), name: row(1, 3, 15), foeName: row(3, 3, 15) } };
}

const out = { $doc: 'The cabinet top HUD (PLAN §7 G7, §8.3 s30): element boxes in arcade px [x0, y0, x1, y1] measured by tools/re/hud-cabinet.cjs from the live scroll1 dumps of the MAME run stg-ep1-walk (f16: JOIN-IN in both slots and the foe row; f72: INSERT COIN). tests/lib/arcade.cjs HUD_ELEMENTS gives the windows and the compared edges; tests/framing.cjs (G7) and tools/re/compare-frames.cjs (s30) compare the game within 2 px.', run: RUN, frames: FRAMES, elements: A.HUD_ELEMENTS, boxes: {}, shows: {} };
for (const [k, f] of Object.entries(FRAMES)) {
  const h = hudOf(f); out.boxes[k] = A.hudBoxes(h.mask, h.W); out.shows[k] = h.text;
  A.img.write(path.join(ROOT, 'work', 're', 'visual', `hud-cabinet-f${f}.png`), { width: h.W, height: h.H, rgba: h.rgba });
}
const file = path.join(ROOT, 'tests', 'fixtures', 'hud-cabinet.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`hud-cabinet: ${path.relative(ROOT, file)}`);
for (const [k, b] of Object.entries(out.boxes)) console.log(`  ${k} (f${FRAMES[k]}, ${JSON.stringify(out.shows[k])}): ` + Object.entries(b).map(([e, r]) => `${e} ${r ? r.join(',') : '-'}`).join('; '));
