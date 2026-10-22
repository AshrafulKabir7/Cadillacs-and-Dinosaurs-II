// Review sheets for the composed stages (ARCHITECTURE §3.7 end, PLAN §6 WP-E):
//   run({chapter, root, log}) -> work/re/levels/<ch>-review.png (all areas), <ch>-<area>-review.png, <ch>-review.json,
//                                originality.json
// Each area at 1x: scroll3 drawn as the camera would show it around each column (camera centred on the column, so the
// far layer reads continuously), scroll2 over it, priority (fg) pixels tinted red, the walk band outlined (green top,
// teal bottom; dark hatching on mask holes), lock windows (yellow, boss red) with their ids, spawn edges at
// lock.left-48 / lock.right+48 (cyan ticks), section boundaries and names (white), slice seams with their sources
// (magenta; orange when the seam gate warns or the join shows a cut), join chunks (green frames), other patches (blue
// frames), the start (white cross), hazards (orange) and props (letters). The far layer is drawn camera screen by camera
// screen (the camera's left edge at every multiple of 384, grey ticks on the top row): a step in it at a tick is the
// parallax between two camera positions, not a seam.
'use strict';
const fs = require('fs'), path = require('path');
const C = require('./levels-compose.cjs'), V = require('./levels-validate.cjs');
const png = require('./png.cjs');
const ROOT = path.resolve(__dirname, '..', '..', '..');

// 5x7 font (rows top->bottom, 5 bits each, MSB left)
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31], 0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [30, 1, 1, 14, 1, 1, 30],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  '-': [0, 0, 0, 14, 0, 0, 0], '/': [1, 1, 2, 4, 8, 16, 16], '.': [0, 0, 0, 0, 0, 12, 12], ':': [0, 12, 12, 0, 12, 12, 0], '#': [10, 31, 10, 10, 31, 10, 0], '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8], ',': [0, 0, 0, 0, 12, 4, 8], "'": [4, 4, 8, 0, 0, 0, 0], '%': [24, 25, 2, 4, 8, 19, 3], '+': [0, 4, 4, 31, 4, 4, 0], '=': [0, 0, 31, 0, 31, 0, 0], '>': [8, 4, 2, 1, 2, 4, 8],
  '<': [2, 4, 8, 16, 8, 4, 2], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4], '[': [14, 8, 8, 8, 8, 8, 14], ']': [14, 2, 2, 2, 2, 2, 14], '·': [0, 0, 0, 4, 0, 0, 0], '&': [12, 18, 20, 8, 21, 18, 13],
};
function canvas(w, h, c = [16, 16, 20, 255]) { const rgba = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) rgba.set(c, i * 4); return { width: w, height: h, rgba }; }
function px(img, x, y, c, a = 1) { if (x < 0 || y < 0 || x >= img.width || y >= img.height) return; const o = (y * img.width + x) * 4; if (a >= 1) { img.rgba[o] = c[0]; img.rgba[o + 1] = c[1]; img.rgba[o + 2] = c[2]; img.rgba[o + 3] = 255; } else { for (let k = 0; k < 3; k++) img.rgba[o + k] = Math.round(img.rgba[o + k] * (1 - a) + c[k] * a); img.rgba[o + 3] = 255; } }
function rect(img, x, y, w, h, c, a = 1) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(img, i, j, c, a); }
function frame(img, x, y, w, h, c, t = 1) { rect(img, x, y, w, t, c); rect(img, x, y + h - t, w, t, c); rect(img, x, y, t, h, c); rect(img, x + w - t, y, t, h, c); }
function text(img, x, y, s, c = [255, 255, 255], bg = [0, 0, 0]) {
  s = String(s).toUpperCase(); let cx = x;
  for (const ch of s) { const g = FONT[ch]; if (bg) rect(img, cx - 1, y - 1, 7, 9, bg, 0.75); if (g) for (let r = 0; r < 7; r++) for (let b = 0; b < 5; b++) if (g[r] & (16 >> b)) px(img, cx + b, y + r, c); cx += 6; }
  return cx;
}
const W = 384, AH = 224, LABEL = 24, GAP = 12;

function areaImage(chap, a, val) {
  const w = a.artW, img = canvas(w, AH, hex(a.bg));
  // scroll3 spans, as the camera shows them screen by screen (cam = 384-px steps, like the extract composites)
  const maxCam = a.recipe.loop ? a.recipe.loop.period : Math.max(0, a.w - W);
  for (const sp of a.s3 || []) {
    const { rgba: r3 } = C.rgbaOf(sp.L, chap.ctxs);
    for (let x = Math.max(0, sp.x0); x < Math.min(w, sp.period ? w : sp.x1); x++) {
      const cam = Math.min(maxCam, Math.floor(x / W) * W), sx = x - cam;
      let X3 = sp.period ? (((cam >> sp.shift) % sp.period) + sx) : ((Math.max(0, cam - sp.c0)) >> sp.shift) + sx; X3 = Math.min(sp.L.w - 1, X3);
      for (let y = 0; y < AH; y++) { const o = (y * sp.L.w + X3) * 4; if (r3[o + 3]) px(img, x, y, [r3[o], r3[o + 1], r3[o + 2]]); }
    }
  }
  const { rgba } = C.rgbaOf(a.s2.L, chap.ctxs), fg = C.rgbaOf(a.s2.L, chap.ctxs, { fg: true }).rgba;
  for (let y = 0; y < AH; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; if (rgba[o + 3]) px(img, x, y, [rgba[o], rgba[o + 1], rgba[o + 2]]); if (fg[o + 3]) px(img, x, y, [255, 0, 0], 0.4); }
  // anims (first frame)
  for (const an of a.anims) { const { rgba: ar } = C.rgbaOf(an.frames[0], chap.ctxs); for (let y = 0; y < an.h; y++) for (let x = 0; x < an.w; x++) { const o = (y * an.w + x) * 4; if (ar[o + 3]) px(img, an.x + x, an.y + y, [ar[o], ar[o + 1], ar[o + 2]]); } frame(img, an.x, an.y, an.w, an.h, [255, 160, 0]); }
  // beyond the gameplay width (loop art)
  if (w > a.w) rect(img, a.w, 0, w - a.w, AH, [0, 0, 0], 0.45);
  // walk band, mask holes
  const { band, mask, cols, rows } = a.walk;
  for (let c = 0; c < cols; c++) {
    const b = band[c]; if (!b) { rect(img, c * 16, 0, 16, AH, [255, 0, 255], 0.35); continue; }
    rect(img, c * 16, b[0] - 1, 16, 1, [80, 255, 80]); rect(img, c * 16, b[1] - 1, 16, 1, [0, 200, 200]);
    for (let r = 0; r < rows; r++) if (!mask[r * cols + c] && r * 16 + 1 >= b[0] && r * 16 + 16 <= b[1]) for (let k = 0; k < 16; k += 4) rect(img, c * 16 + k, r * 16 + k, 2, 2, [0, 0, 0]);
  }
  for (const pt of (a.recipe.walk && a.recipe.walk.patch) || []) frame(img, pt.rect[0], pt.rect[1], pt.rect[2], pt.rect[3], pt.walk === false ? [255, 80, 80] : [160, 255, 160]);
  // hazards
  for (const hz of a.recipe.hazards || []) { rect(img, hz.rect[0], hz.rect[1], hz.rect[2], hz.rect[3], [255, 140, 0], 0.3); frame(img, hz.rect[0], hz.rect[1], hz.rect[2], hz.rect[3], [255, 140, 0]); text(img, hz.rect[0] + 2, hz.rect[1] + 2, hz.kind, [255, 200, 120]); }
  // locks
  a.locks.forEach((l, i) => {
    const c = l.boss ? [255, 60, 60] : [255, 230, 40], y0 = 2 + (i % 3) * 3;
    frame(img, l.x, 81 - 1 - y0, W, AH - 81 + 1 + y0, c);
    text(img, l.x + 3, 82 - 1 - y0 + 2, `${l.id}${l.boss ? ' BOSS' : ''}`, c);
    for (const ex of [l.x - 48, l.x + W + 48]) rect(img, ex, 150, 2, 40, [0, 255, 255]);
  });
  // sections
  for (const s of a.recipe.sections || []) { for (let y = 0; y < AH; y += 6) rect(img, s.x0, y, 1, 3, [255, 255, 255]); text(img, s.x0 + 3, 46, `${s.id} ${s.name || ''}`.slice(0, 40), [255, 255, 255]); if (s.cap) text(img, s.x0 + 3, 56, `CAP ${s.cap}`, [200, 220, 255]);
    for (const p of s.props || []) { const x = s.x0 + (p.x || 0), b = band[Math.min(cols - 1, Math.floor(x / 16))] || [160, 224], y = Math.round((b[0] + b[1]) / 2); rect(img, x - 3, y - 3, 7, 7, [255, 255, 255]); text(img, x - 2, y - 3, (p.kind === 'drop' ? (p.type || 'd')[0] : p.kind[0]), [0, 0, 0], null); } }
  // seams
  const seams = (val && val.seams || []).filter(s => s.area === a.id);
  for (const p of a.s2.pieces) {
    if (p.kind === 'patch' || p.kind === 'tiles') { const c = p.join ? [80, 255, 120] : [120, 200, 255], w = p.srcX ? p.srcX[1] - p.srcX[0] : 16, hh = p.h ? p.h[1] - p.h[0] : 16; for (const bx of p.starts || [p.x0]) frame(img, bx, p.y || 0, w, hh, c); continue; }
    const s = seams.find(q => q.x === p.x0), warn = s && (s.overlap < 48 || (s.topStep > 16 && !s.step) || s.rgb > 48 || s.cut > V.LIMITS.joinCut);
    rect(img, p.x0, 0, 1, AH, warn ? [255, 140, 0] : [255, 0, 255]);
    text(img, p.x0 + 3, 4 + (p.kind === 'loop' ? 0 : 0), `${p.src} ${p.srcX[0]}-${p.srcX[1]}${p.flip ? ' FLIP' : ''}${p.y ? ' Y' + p.y : ''}`, [255, 160, 255]);
  }
  // camera screens of the far layer
  for (let x = W; x < w; x += W) rect(img, x, 0, 1, 4, [160, 160, 170]);
  // start
  rect(img, a.start.x - 5, a.start.y, 11, 1, [255, 255, 255]); rect(img, a.start.x, a.start.y - 5, 1, 11, [255, 255, 255]);
  // camera-y path (flat in every area of v1: cam.y = 0)
  for (let x = 0; x < a.w; x += 8) rect(img, x, 0, 4, 1, [120, 120, 255]);
  return img;
}
const hex = h => { const v = parseInt(String(h).replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255]; };

function sheet(chap, val) {
  const imgs = chap.areas.map(a => areaImage(chap, a, val)), Wd = Math.max(...imgs.map(i => i.width)) + 16;
  const H = imgs.reduce((n, i) => n + i.height + LABEL + GAP, LABEL) + 8;
  const out = canvas(Wd, H, [24, 24, 30, 255]);
  const r = chap.recipe;
  text(out, 8, 8, `${r.id} ${r.title || ''}  PRESET ${r.preset || '-'}  OBJ ${r.objPage || '-'}  GATES ${val ? (val.ok ? 'OK' : 'FAIL ' + val.errors.length) : '?'}  WARN ${val ? val.warnings.length : '?'}`, [255, 255, 255]);
  let y = LABEL;
  chap.areas.forEach((a, i) => {
    const im = imgs[i];
    text(out, 8, y + 6, `${a.id}  W ${a.w}${a.artW !== a.w ? ' ART ' + a.artW : ''}  BG ${a.bg}  S3 ${a.s3 ? a.s3.map(sp => sp.src + ' ' + sp.x0 + '-' + sp.x1 + ' SHIFT ' + sp.shift).join(' / ') : 'NONE'}${a.recipe.loop ? '  LOOP ' + a.recipe.loop.src + ' ' + a.recipe.loop.x0 + '+' + a.recipe.loop.period : ''}${a.recipe.returnVisit ? '  RETURN VISIT' : ''}`, [220, 220, 220]);
    for (let x = 0; x < a.artW; x += 128) text(out, 8 + x, y + 16, String(x), [140, 140, 160], null);
    y += LABEL;
    for (let j = 0; j < im.height; j++) out.rgba.set(im.rgba.subarray(j * im.width * 4, (j + 1) * im.width * 4), ((y + j) * Wd + 8) * 4);
    y += im.height + GAP;
  });
  return out;
}

function run({ chapter, root = ROOT, log = console.log, composedAll = null } = {}) {
  const chs = chapter === 'all' ? C.CHAPTERS : [chapter];
  const outDir = path.join(root, 'work', 're', 'levels'); fs.mkdirSync(outDir, { recursive: true });
  const composed = composedAll || {};
  for (const ch of C.CHAPTERS) if (!composed[ch] && fs.existsSync(path.join(root, 'tools', 're', 'levels', `${ch}.json`))) composed[ch] = C.compose(C.loadRecipe(ch));
  const files = [], lanes = C.selfTest();
  for (const ch of chs) {
    const chap = composed[ch]; if (!chap) { log(`review ${ch}: no recipe`); continue; }
    const val = V.validate(chap, chap.recipe, { out: root });
    const img = sheet(chap, val), file = path.join(outDir, `${ch}-review.png`);
    png.write(file, img); files.push(file);
    // one sheet per area as well (the user approves ch1 a0 and ch2 a0 before the other areas are un-stubbed, PLAN G2)
    chap.areas.forEach(a => { const one = sheet({ ...chap, areas: [a] }, { ...val, seams: val.seams }); const af = path.join(outDir, `${ch}-${a.id}-review.png`); png.write(af, one); files.push(af); });
    const rep = { chapter: ch, ok: val.ok, errors: val.errors, warnings: val.warnings, gates: val.gates, seams: val.seams, locks: val.locks, farLayerChanges: val.s3cuts, walkVoids: val.voids, loops: val.loops,
      joinChunks: chap.areas.flatMap(a => a.s2.pieces.filter(p => p.kind === 'patch' && p.join).map(p => ({ area: a.id, x: p.x0, w: p.srcX[1] - p.srcX[0], src: p.src, srcX: p.srcX, note: p.note }))),
      unprobedLanes: lanes.unprobed || null, laneProbes: lanes.info,
      areas: chap.areas.map(a => ({ id: a.id, w: a.w, artW: a.artW, bg: a.bg, s3: a.s3 ? a.s3.map(sp => ({ src: sp.src, x: [sp.x0, sp.x1], shift: sp.shift, x3: sp.x3, h: sp.h, w: sp.w })) : null, pieces: a.s2.pieces.map(p => ({ kind: p.kind, src: p.src, at: [p.x0, p.y || 0], srcX: p.srcX, h: p.h || null, flip: p.flip, ops: chap.ctxs.list[p.ctx].key })), patchedCells: a.s2.patchCells, start: a.start,
        bands: compressBands(a.walk.band), paletteLog: [...new Set(chap.ctxs.list.flatMap(c => c.log))] })) };
    fs.writeFileSync(path.join(outDir, `${ch}-review.json`), JSON.stringify(rep, null, 1) + '\n'); files.push(path.join(outDir, `${ch}-review.json`));
    log(`review ${ch}: ${path.relative(root, file).split(path.sep).join('/')} (${img.width}x${img.height}); gates ${val.ok ? 'ok' : 'FAIL'} ${val.errors.length} errors, ${val.warnings.length} warnings`);
    for (const e of val.errors) log(`      error: ${e}`);
  }
  const o = V.originalityAll(composed);
  require('./emit.cjs').json(path.join(outDir, 'originality.json'), o.report); files.push(path.join(outDir, 'originality.json'));
  log(`review: originality.json (${Object.keys(composed).length} chapters): ${o.ok ? 'ok' : 'FAIL'}; max area use ${o.maxUse.id} ${(o.maxUse.share * 100).toFixed(1)}%`);
  for (const e of o.errors) log(`      error: ${e}`);
  return { files, ok: o.ok };
}
function compressBands(band) { const out = []; band.forEach((b, c) => { const k = JSON.stringify(b), last = out[out.length - 1]; if (last && last.k === k) last.x1 = (c + 1) * 16; else out.push({ x0: c * 16, x1: (c + 1) * 16, band: b, k }); }); return out.map(({ k, ...r }) => r); }

module.exports = { run, sheet, areaImage, text };
