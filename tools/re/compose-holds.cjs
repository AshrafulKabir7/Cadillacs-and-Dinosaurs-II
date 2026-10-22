// Render every hero standing with every weapon exactly as the ROM tables place it (validation sheet).
// node tools/re/compose-holds.cjs [out.png]
// Uses work/re/static/{hero-anims,weapon-holds,weapon-items}.json from static-extract.cjs.
const path = require('path');
const R = require('./rom.cjs');
const S = path.join(__dirname, '../../work/re/static');
const anims = require(path.join(S, 'hero-anims.json')), holds = require(path.join(S, 'weapon-holds.json')), items = require(path.join(S, 'weapon-items.json'));
const out = process.argv[2] || path.join(S, 'img/hold-validation.png');
const CW = 150, CH = 130, SCALE = 2;
const weapons = items.items.filter(w => !['TAIMATSU (torch)', 'STONE (inferred)', 'STICK (inferred, no debug entry)'].includes(w.name));
const cols = weapons.length + 1, rows = 4, W = CW * cols * SCALE, H = CH * rows * SCALE, img = new Uint8Array(W * H * 4);
for (let q = 0; q < W * H; q++) { img[q * 4] = 34; img[q * 4 + 1] = 38; img[q * 4 + 2] = 46; img[q * 4 + 3] = 255; }
const put = (x, y, c) => { for (let a = 0; a < SCALE; a++) for (let b = 0; b < SCALE; b++) { const X = x * SCALE + a, Y = y * SCALE + b; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const q = (Y * W + X) * 4; img[q] = c[0]; img[q + 1] = c[1]; img[q + 2] = c[2]; } };
function blit(rec, fx, fy, cx, cy) {
  const im = R.recordRGBA(rec, 0, { dropShadows: false }); if (!im) return;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) { const q = (y * im.w + x) * 4; if (!im.rgba[q + 3]) continue; const X = fx - im.ox + x, Y = fy - im.oy + y; if (X < cx || Y < cy || X >= cx + CW || Y >= cy + CH) continue; put(X, Y, [im.rgba[q], im.rgba[q + 1], im.rgba[q + 2]]); }
}
const setByList = l => anims.sets.find(s => s.list === l);
const report = [];
for (let c = 0; c < 4; c++) {
  const stance = items.heroStanceByClass.perChar[c];
  for (let k = 0; k < cols; k++) {
    const cx = k * CW, cy = c * CH, fx = cx + 90, fy = cy + CH - 12;
    let frame, weapon = null;
    if (k === 0) frame = setByList('0x163E').perChar[c].anims[0].frames[0];
    else {
      weapon = weapons[k - 1]; const cls = parseInt(weapon.class, 16) & 0xff, a = stance.standAnimIn0x168E[cls];
      frame = a == null ? setByList('0x163E').perChar[c].anims[0].frames[0] : setByList('0x168E').perChar[c].anims[a].frames[0];
    }
    // legs (rec2) under torso (rec): the builder draws rec first, so rec is on top
    if (frame.rec2 != null) blit(frame.rec2, fx, fy, cx, cy);
    blit(frame.rec, fx, fy, cx, cy);
    let line = `${holds.chars[c].char} ${weapon ? weapon.name : 'none'}: hero rec ${frame.rec}${frame.rec2 != null ? '+' + frame.rec2 : ''} hold ${frame.hold}`;
    if (weapon) {
      const e = holds.chars[c].entries[frame.hold], w = e && e.weapons[weapon.name];
      if (w && w.rec != null) { blit(w.rec, fx + w.anchor[0], fy + w.anchor[1], cx, cy); line += ` -> weapon rec ${w.rec} anchor (${w.anchor}) topLeft (${w.topLeft}) ${w.size.join('x')}`; }
      else line += ' -> weapon hidden';
    }
    for (let d = -3; d <= 3; d++) { put(fx + d, fy, [255, 0, 255]); put(fx, fy + d, [255, 0, 255]); }
    report.push(line);
  }
}
R.writePNG(out, W, H, img);
console.log(report.join('\n'));
console.log('wrote', out, 'columns: none,', weapons.map(w => w.name).join(', '));
