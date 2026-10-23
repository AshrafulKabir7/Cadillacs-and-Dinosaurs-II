// Shared helpers for the browser suites and the visual harness (PLAN §3.3, §4.6, ARCHITECTURE §8).
//
// Node side (this module):
//   ROOT, BASE, fileURL()            repo root, GAME_URL (default http://127.0.0.1:8766), file:// launch of index.html
//   launch(opts) -> {browser, page, errors}      Playwright Chromium with pageerror collection
//   prepare(page, {seed, raf})       seeded Math.random (LCG, same as the suites) and a requestAnimationFrame stub
//   open(page, {file, sound})        goto + waitReady + the #sound click the suites do
//   waitReady(page)                  SEQUEL_RENDER.ready && window.ARCADE_HEROES (every suite's gate, PLAN R14)
//   probe(page)                      which runtime pieces exist (units, layout, SPRITES, STAGE, HeroRig, ...) -> gates
//   install(page)                    defines window.AT, the in-page helpers below
//   grab(page) / toArcade(img)       canvas pixels (toDataURL over http, element screenshot under file://), 384x224 view
//   checks(name) / finish(...)       PASS/FAIL/SKIP rows with the step each check belongs to; tests/results/<name>-report.json
//   HUD_ELEMENTS, hudBoxes, hudCompare, hudMask   the cabinet HUD element windows and the 2-px comparison (G7, s30)
//   img                              PNG decode/encode (tools/re/build/png.cjs), downsample, diff, bbox, crop, fit, label, sheet
//
// Browser side (window.AT after install(page); plain functions so they also work on today's game, PLAN §6 WP-H):
//   AT.U()        true once LAST_EDEN.units.world==='arcade' (G1); false on today's canvas-px game
//   AT.M()        snapshot.band.mid, or today's fixed lane 350 when the band does not exist
//   AT.lane(f)    g.test.lane(f) when present, else band.top + f*(bottom-top)
//   AT.px(v)      a canvas-px literal from today's suites expressed in the current units (v/1.35 rounded after G1)
//   AT.arc(v)     an arcade-px value (fixture, spec) expressed in the current units (v*1.35 before G1)
//   AT.move(x,y,area), AT.spawn(type,x,y,opts: boss, dummy, dir, v = ROM variant), AT.dummy(x,y), AT.kill(), AT.ticks(n,dt), AT.key(code,on), AT.hold(code,n)
//   AT.view()     snapshot.view, or {x:camera, y:0, w:768, h:432} today
//   AT.canvasPNG()  data URL of the game canvas, or null when the canvas is tainted (file://)
//
// Steps: every check names the integration step it belongs to ('G0'..'G8', or a sub-step such as 'G3b'). A check
// whose step has not landed is reported as SKIP and the suite stays green. ARCADE_STEP=G2 (env) makes every SKIP of a
// step <= G2 a failure, so the agent that lands a step can prove the suite is really enabled; ARCADE_STEP=G3a requires
// only the rows of G3's first sub-step (a bare G3 requires all of G3a..G3d). A SKIP the environment forces (gated(...,
// {env:true}): the http-only pixel rows from file://, where the canvas is tainted) stays a SKIP and is counted as envSkipped.
'use strict';
const fs = require('node:fs'), path = require('node:path'), url = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = process.env.GAME_URL || 'http://127.0.0.1:8766';
const RESULTS = path.join(ROOT, 'tests', 'results');
const fileURL = () => url.pathToFileURL(path.join(ROOT, 'index.html')).href;
const isFileURL = u => /^file:/i.test(u || BASE);

function playwright() {
  try { return require('playwright'); } catch (e) { /* fall through */ }
  try { return require(path.join(ROOT, 'tests', 'node_modules', 'playwright')); } catch (e) {
    throw new Error('Playwright is not installed: run `npm install` inside tests/ (see VALIDATION.md)');
  }
}

async function launch(opts = {}) {
  const { chromium } = playwright();
  const browser = await chromium.launch({ headless: opts.headless !== false });
  const ctx = opts.mobile ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } : { viewport: opts.viewport || { width: 1280, height: 900 } };
  const page = await browser.newPage(ctx), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (opts.console) page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return { browser, page, errors };
}

// The seeded LCG every suite uses (bot 15454, combat 77, polish 777, specification 764, story 2024; CODE-MAP §2).
async function prepare(page, { seed = null, raf = true } = {}) {
  await page.addInitScript(({ seed, raf }) => {
    if (raf) window.requestAnimationFrame = () => 0;
    if (seed !== null) { let s = seed >>> 0; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  }, { seed, raf });
}

// Re-install the seeded LCG mid-session. compare-frames calls it at the start of every scene, so a scene's frames do
// not depend on the scenes that ran before it in the same page (the same with --scene s20 and with the full table).
async function reseed(page, seed) {
  await page.evaluate(seed => { let s = seed >>> 0; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }, seed);
}

async function waitReady(page, timeout = 60000) {
  await page.waitForFunction(() => window.SEQUEL_RENDER && SEQUEL_RENDER.ready && window.ARCADE_HEROES && window.LAST_EDEN, null, { timeout, polling: 100 });   // these pages stub requestAnimationFrame, so poll on a timer
}

async function open(page, { file = false, sound = true, timeout = 60000, url = null } = {}) {
  await page.goto(file ? fileURL() : (url || BASE));
  await waitReady(page, timeout);
  if (sound && await page.locator('#sound').count()) await page.click('#sound').catch(() => {});
}

// Which pieces of the target runtime exist. The suites gate their checks on these, never on file names.
async function probe(page) {
  return page.evaluate(() => {
    const g = window.LAST_EDEN || {}, c = document.getElementById('game');
    const has = k => typeof window[k] !== 'undefined';
    let snap = null; try { snap = g.snapshot; } catch (e) { snap = null; }
    const fam = window.SPRITE_DATA && SPRITE_DATA.families ? Object.keys(SPRITE_DATA.families) : [];
    return {
      units: g.units || null, layout: g.layout || null, hudFont: g.layout && g.layout.font || null,
      canvas: c ? { w: c.width, h: c.height } : null,
      sprites: has('SPRITES') ? { ready: !!SPRITES.ready, verified: !!SPRITES.verified } : null,
      families: fam,
      stageData: has('STAGE_DATA'), stage: has('STAGE'), stageRender: has('STAGE_RENDER'),
      heroRig: has('HeroRig'), enemyKinds: has('ENEMY_KINDS'), bossDefs: has('BOSS_DEFS'), arcadeUI: has('ARCADE_UI'),
      romUI: has('ROM_UI') || fam.includes('ui'), romHeroes: has('ROM_HEROES'),
      sequelRender: has('SEQUEL_RENDER') ? { ready: !!SEQUEL_RENDER.ready, bossCount: SEQUEL_RENDER.bossCount, roster: SEQUEL_RENDER.bossRoster || null, pages: typeof SEQUEL_RENDER.pagesLoaded === 'function', loadChapter: typeof SEQUEL_RENDER.loadChapter === 'function' } : null,
      test: g.test ? Object.keys(g.test) : [],
      snapshotKeys: snap ? Object.keys(snap) : [],
      href: location.href, ua: navigator.userAgent,
    };
  });
}

// Landed-step detection from a probe (the plan's G steps; PLAN §7). Used by the suites and compare-frames.
function stepsOf(p) {
  // G5: enemy-kinds.js (G4) already carries BOSS_DEFS, so the bosses count as landed only when every roster body is
  // drawn (PLAN §7 G5 gate: bossCount === bossRoster.length && bossRoster.length >= 7); until G5 bossCount is the four
  // legacy boss canvases.
  const sr = p.sequelRender, roster = sr && Array.isArray(sr.roster) ? sr.roster.length : 0;
  const s = { G0: !!p.sprites, G1: !!(p.units && p.units.world === 'arcade'), G2: !!(p.stageRender && p.stageData), G3: !!p.heroRig, G4: !!p.enemyKinds, G5: !!p.bossDefs && roster >= 7 && sr.bossCount === roster, G6: !!p.arcadeUI && !!p.units, G7: !!p.romUI && !!p.layout && p.hudFont === 'rom', G8: false };
  // G7: ROM_UI (sprite-data-ui.js) already loads in G6 (the card, the panels' portraits, the radio font), so the HUD step
  // is marked by the game itself: LAST_EDEN.layout.font === 'rom' once hud() draws in the ROM font (PLAN §7 G7).
  s.G8 = s.G7 && !!p.sequelRender && !!p.sequelRender.pages;   // G8 is confirmed by tests/assets.cjs, not by the runtime
  return s;
}
// 'G3' -> 3, 'G3b' -> 3.2 (sub-steps a..d of PLAN §7 = .1 .. .4); unknown -> 99.
const stepNo = step => { const m = /^G(\d+)([a-d])?/i.exec(String(step || '')); return m ? +m[1] + (m[2] ? (m[2].toLowerCase().charCodeAt(0) - 96) / 10 : 0) : 99; };
// The highest sub-step ARCADE_STEP=<step> requires: a bare 'G3' means the whole step has landed (3.9), 'G3a' only 3.1,
// so a check filed under 'G3b' stays a SKIP while 3a is being landed and becomes required from ARCADE_STEP=G3b on.
const stepRequired = step => { const m = /^G(\d+)([a-d])?/i.exec(String(step || '')); return m ? +m[1] + (m[2] ? (m[2].toLowerCase().charCodeAt(0) - 96) / 10 : 0.9) : -1; };

// ---------------------------------------------------------------- in-page helpers
const AT_SOURCE = `(() => {
  const g = window.LAST_EDEN;
  const U = () => !!(g.units && g.units.world === 'arcade');
  const snap = () => g.snapshot;
  const band = () => { const s = snap(); return s.band && s.band.top != null ? s.band : { top: 284, bottom: 393, mid: 350, legacy: true }; };
  const M = () => band().mid;
  const lane = f => (g.test && typeof g.test.lane === 'function') ? g.test.lane(f) : (band().top + f * (band().bottom - band().top));
  const px = v => U() ? Math.round(v / 1.35) : v;
  const arc = v => U() ? v : v * 1.35;
  const move = (x, y, area) => { g.test.move(x, y == null ? M() : y, area); };
  const view = () => { const s = snap(); return s.view || { x: s.camera || 0, y: 0, w: 768, h: 432, legacy: true }; };
  const ticks = (n, dt) => { for (let i = 0; i < n; i++) g.step(dt || 1 / 60); };
  const key = (code, on) => window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, bubbles: true }));
  const hold = (code, n, dt) => { key(code, true); ticks(n, dt); key(code, false); };
  const spawn = (type, x, y, opts) => { opts = opts || {}; const e = g.test.spawnEnemy(x, y == null ? M() : y, type, !!opts.boss); if (opts.dummy) { e.hp = e.maxhp = 10000; e.state = 'recover'; e.timer = 999; } if (opts.dir) e.dir = opts.dir; if (opts.v) e.v = opts.v; return e; };
  const dummy = (x, y) => spawn('brute', x, y, { dummy: true });
  const kill = () => { snap().enemies.forEach((e, i) => { if (!e.dead) g.test.damageEnemy(i, 99999); }); ticks(110); };
  const playerScreen = () => { const s = snap(), v = view(); return { x: s.player.x - v.x, y: s.player.y - (s.player.z || 0) - v.y }; };
  const canvasPNG = () => { try { return document.getElementById('game').toDataURL('image/png'); } catch (e) { return null; } };
  const canvasSize = () => { const c = document.getElementById('game'); return { w: c.width, h: c.height }; };
  return { g, U, snap, band, M, lane, px, arc, move, view, ticks, key, hold, spawn, dummy, kill, playerScreen, canvasPNG, canvasSize };
})()`;

async function install(page) { await page.evaluate(`window.AT = ${AT_SOURCE}; true`); }

// ---------------------------------------------------------------- images
const png = require(path.join(ROOT, 'tools', 're', 'build', 'png.cjs'));

const img = {
  png,
  decode: buf => png.decode(buf),
  encode: im => png.encode({ width: im.width, height: im.height, rgba: im.rgba }),
  write: (file, im) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, img.encode(im)); },
  read: file => png.decode(fs.readFileSync(file)),
  fromDataURL: u => png.decode(Buffer.from(u.slice(u.indexOf(',') + 1), 'base64')),
  blank: (width, height, rgb = [0, 0, 0]) => { const rgba = new Uint8Array(width * height * 4); for (let i = 0; i < width * height; i++) { rgba[i * 4] = rgb[0]; rgba[i * 4 + 1] = rgb[1]; rgba[i * 4 + 2] = rgb[2]; rgba[i * 4 + 3] = 255; } return { width, height, rgba }; },
  // Box-filter downsample by an integer factor (768x448 -> 384x224).
  downsample(im, k) {
    const W = Math.floor(im.width / k), H = Math.floor(im.height / k), out = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const q = ((y * k + j) * im.width + x * k + i) * 4; r += im.rgba[q]; g += im.rgba[q + 1]; b += im.rgba[q + 2]; a += im.rgba[q + 3]; }
      const o = (y * W + x) * 4, n = k * k; out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
    return { width: W, height: H, rgba: out };
  },
  // Area-average resample to an arbitrary size (video frames, element screenshots).
  resample(im, W, H) {
    const out = new Uint8Array(W * H * 4), sx = im.width / W, sy = im.height / H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = y0; j < y1 && j < im.height; j++) for (let i = x0; i < x1 && i < im.width; i++) { const q = (j * im.width + i) * 4; r += im.rgba[q]; g += im.rgba[q + 1]; b += im.rgba[q + 2]; n++; }
      const o = (y * W + x) * 4; out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
    }
    return { width: W, height: H, rgba: out };
  },
  crop(im, x0, y0, w, h) {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = x0 + x, sy = y0 + y; if (sx < 0 || sy < 0 || sx >= im.width || sy >= im.height) continue; const q = (sy * im.width + sx) * 4, o = (y * w + x) * 4; out[o] = im.rgba[q]; out[o + 1] = im.rgba[q + 1]; out[o + 2] = im.rgba[q + 2]; out[o + 3] = im.rgba[q + 3]; }
    return { width: w, height: h, rgba: out };
  },
  // Place `im` onto a W x H canvas: 'center' pads (or crops) around the middle, 'scale' resamples, 'topleft' pads.
  fit(im, W, H, mode = 'center', bg = [0, 0, 0]) {
    if (mode === 'scale') return img.resample(im, W, H);
    const out = img.blank(W, H, bg), ox = mode === 'topleft' ? 0 : Math.floor((W - im.width) / 2), oy = mode === 'topleft' ? 0 : Math.floor((H - im.height) / 2);
    img.blit(out, im, ox, oy); return out;
  },
  blit(dst, src, dx, dy) {
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) { const X = dx + x, Y = dy + y; if (X < 0 || Y < 0 || X >= dst.width || Y >= dst.height) continue; const q = (y * src.width + x) * 4; if (!src.rgba[q + 3]) continue; const o = (Y * dst.width + X) * 4; dst.rgba[o] = src.rgba[q]; dst.rgba[o + 1] = src.rgba[q + 1]; dst.rgba[o + 2] = src.rgba[q + 2]; dst.rgba[o + 3] = 255; }
  },
  // Per-pixel difference: {ratio, count, mask(Uint8Array), image(heat: dimmed a, magenta where |d|>tol)}.
  diff(a, b, tol = 24, roi = null) {
    const W = Math.min(a.width, b.width), H = Math.min(a.height, b.height), mask = new Uint8Array(W * H), out = new Uint8Array(W * H * 4);
    let count = 0, total = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const qa = (y * a.width + x) * 4, qb = (y * b.width + x) * 4, o = (y * W + x) * 4, i = y * W + x;
      const inRoi = !roi || (x >= roi[0] && y >= roi[1] && x < roi[0] + roi[2] && y < roi[1] + roi[3]);
      const d = Math.max(Math.abs(a.rgba[qa] - b.rgba[qb]), Math.abs(a.rgba[qa + 1] - b.rgba[qb + 1]), Math.abs(a.rgba[qa + 2] - b.rgba[qb + 2]));
      const hit = d > tol; if (inRoi) { total++; if (hit) count++; } mask[i] = hit ? 1 : 0;
      if (hit) { out[o] = 255; out[o + 1] = 0; out[o + 2] = 255; } else { out[o] = a.rgba[qa] >> 2; out[o + 1] = a.rgba[qa + 1] >> 2; out[o + 2] = a.rgba[qa + 2] >> 2; }
      out[o + 3] = 255;
    }
    return { ratio: total ? count / total : 0, count, total, mask, image: { width: W, height: H, rgba: out } };
  },
  bbox(mask, W, H, roi = null) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!mask[y * W + x]) continue; if (roi && (x < roi[0] || y < roi[1] || x >= roi[0] + roi[2] || y >= roi[1] + roi[3])) continue; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  },
  // 3x5 pixel font for labels on review images (A-Z, 0-9, '-', '.', ':', '/', space).
  FONT: { A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101110100110101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101011001', R: '110101110110101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111', '-': '000000111000000', '.': '000000000000010', ':': '000010000010000', '/': '001001010100100', ' ': '000000000000000', '%': '101001010100101', '=': '000111000111000', '+': '000010111010000' },
  label(im, x0, y0, text, rgb = [255, 255, 0], scale = 1) {
    const T = String(text).toUpperCase();
    for (let i = 0; i < T.length; i++) {
      const gph = img.FONT[T[i]] || img.FONT[' '];
      for (let y = -1; y < 6; y++) for (let x = -1; x < 4; x++) {
        const on = y >= 0 && y < 5 && x >= 0 && x < 3 && gph[y * 3 + x] === '1';
        for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) {
          const X = x0 + (i * 4 + x) * scale + b, Y = y0 + y * scale + a; if (X < 0 || Y < 0 || X >= im.width || Y >= im.height) continue;
          const o = (Y * im.width + X) * 4; if (on) { im.rgba[o] = rgb[0]; im.rgba[o + 1] = rgb[1]; im.rgba[o + 2] = rgb[2]; } else { im.rgba[o] = 0; im.rgba[o + 1] = 0; im.rgba[o + 2] = 0; } im.rgba[o + 3] = 255;
        }
      }
    }
  },
  // Panels side by side with a label strip above each: [{im, title}] -> image.
  sheet(panels, { gap = 4, bar = 9, bg = [24, 24, 28] } = {}) {
    const W = panels.reduce((s, p) => s + p.im.width + gap, gap), H = Math.max(...panels.map(p => p.im.height)) + bar + gap * 2, out = img.blank(W, H, bg);
    let x = gap; for (const p of panels) { img.label(out, x + 1, gap + 1, p.title || '', [255, 255, 0]); img.blit(out, p.im, x, gap + bar); x += p.im.width + gap; }
    return out;
  },
  rect(im, r, rgb = [0, 255, 0]) {
    const [x0, y0, w, h] = r; const put = (x, y) => { if (x < 0 || y < 0 || x >= im.width || y >= im.height) return; const o = (y * im.width + x) * 4; im.rgba[o] = rgb[0]; im.rgba[o + 1] = rgb[1]; im.rgba[o + 2] = rgb[2]; im.rgba[o + 3] = 255; };
    for (let x = x0; x < x0 + w; x++) { put(x, y0); put(x, y0 + h - 1); } for (let y = y0; y < y0 + h; y++) { put(x0, y); put(x0 + w - 1, y); }
  },
};

// Canvas pixels at the bitmap size. Over http the canvas is not tainted and toDataURL works; under file:// the
// WebPs taint it, so the element screenshot (CSS size) is resampled back to the bitmap size.
async function grab(page) {
  const data = await page.evaluate(() => { try { return document.getElementById('game').toDataURL('image/png'); } catch (e) { return null; } });
  const size = await page.evaluate(() => { const c = document.getElementById('game'); return { w: c.width, h: c.height }; });
  if (data) { const im = img.fromDataURL(data); im.source = 'toDataURL'; return im; }
  const shot = await page.locator('#game').screenshot({ type: 'png' });
  const raw = img.decode(shot), im = img.resample(raw, size.w, size.h); im.source = 'screenshot'; return im;
}
// 768x448 (or today's 768x432) -> the 384x224 arcade view (today's frame is padded with 8 black rows).
function toArcade(im) {
  const half = img.downsample(im, 2);
  if (half.height === 224 && half.width === 384) return half;
  const out = img.fit(half, 384, 224, 'topleft'); out.padded = true; return out;
}

// ---------------------------------------------------------------- reporting
function checks(name) {
  const rows = [];
  const add = (step, title, status, detail) => { const r = { step, name: title, status, detail: detail || '', passed: status !== 'FAIL' }; rows.push(r); console.log(`${status.padEnd(4)} [${step}] ${title}${detail ? '  ' + detail : ''}`); return r; };
  return {
    name, rows,
    check: (step, title, ok, detail) => add(step, title, ok ? 'PASS' : 'FAIL', ok ? '' : detail),
    pass: (step, title, detail) => add(step, title, 'PASS', detail),
    fail: (step, title, detail) => add(step, title, 'FAIL', detail),
    skip: (step, title, reason) => add(step, title, 'SKIP', reason),
    warn: (step, title, detail) => add(step, title, 'WARN', detail),
    // Run fn when the step's pieces exist, else record a SKIP with the reason. fn may be async and may add rows itself.
    // opts.env: the check cannot run in this environment (an http-only pixel row from file://, where the canvas is tainted);
    // its SKIP is marked env and ARCADE_STEP leaves it a SKIP, since no step landing can make it runnable here.
    gated: async (step, title, available, reason, fn, opts) => { if (!available) { const r = add(step, title, 'SKIP', reason); if (opts && opts.env) r.env = true; return r; } try { const r = await fn(); if (r !== undefined) add(step, title, r === true ? 'PASS' : 'FAIL', r === true ? '' : String(r)); } catch (e) { add(step, title, 'FAIL', 'threw: ' + (e && e.message || e)); } },
  };
}

// Writes tests/results/<name>-report.json, applies ARCADE_STEP, and returns {ok, summary}. Exits non-zero on failure
// when exit:true (default). An all-SKIP run prints why and exits 0 (the suite is not enabled yet).
function finish(C, errors = [], { exit = true, extra = {} } = {}) {
  const required = process.env.ARCADE_STEP ? stepRequired(process.env.ARCADE_STEP) : -1;
  for (const r of C.rows) if (r.status === 'SKIP' && !r.env && stepNo(r.step) <= required) { r.status = 'FAIL'; r.passed = false; r.detail = `required by ARCADE_STEP=${process.env.ARCADE_STEP}: ${r.detail}`; console.log(`FAIL [${r.step}] ${r.name}  ${r.detail}`); }
  if (errors.length) C.rows.push({ step: 'G0', name: 'No browser exceptions', status: 'FAIL', passed: false, detail: errors.join(' | ') });
  const n = s => C.rows.filter(r => r.status === s).length;
  const summary = { suite: C.name, passed: n('PASS'), failed: n('FAIL'), skipped: n('SKIP'), envSkipped: C.rows.filter(r => r.status === 'SKIP' && r.env).length, warned: n('WARN'), total: C.rows.length };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, `${C.name}-report.json`), JSON.stringify({ ...summary, checks: C.rows, errors, ...extra }, null, 2));
  const ok = summary.failed === 0;
  if (ok && summary.passed === 0 && summary.skipped > 0) console.log(`SKIPPED: ${C.name} has nothing to check yet (${summary.skipped} checks wait for later steps: ${[...new Set(C.rows.map(r => r.step))].sort().join(', ')})`);
  console.log(JSON.stringify(summary));
  if (exit && !ok) process.exit(1);
  return { ok, summary };
}

// ---------------------------------------------------------------- the cabinet HUD (PLAN §7 G7, §8.3 s30)
// Element windows of the P1 block and the coin slots in arcade px [x, y, w, h], and the edges (l t r b) compared per
// element: where the cabinet frame and the game may show a different value (the lives digit, the score, the foe bar's
// HP) only the edges that do not move with it. tools/re/hud-cabinet.cjs measures the cabinet's boxes from the live
// scroll1 dumps into tests/fixtures/hud-cabinet.json; framing.cjs (G7) and compare-frames (s30) measure the game's on a
// HUD-only render (LAST_EDEN.test.hudOnly) and compare them within 2 px.
const HUD_ELEMENTS = {
  face: { win: [0, 0, 24, 24], edges: 'ltrb' }, lives: { win: [24, 0, 24, 8], edges: 'ltb' }, score: { win: [48, 0, 80, 8], edges: 'trb' },
  name: { win: [24, 8, 104, 8], edges: 'ltrb' }, bar: { win: [24, 16, 104, 8], edges: 'ltrb' },
  foeFace: { win: [0, 24, 24, 16], edges: 'ltrb' }, foeName: { win: [24, 24, 104, 8], edges: 'ltrb' }, foeBar: { win: [24, 32, 104, 8], edges: 'ltb' },
  slot2: { win: [128, 16, 128, 16], edges: 'ltrb' }, slot3: { win: [256, 16, 128, 16], edges: 'ltrb' },
};
// mask: Uint8Array (1 = HUD pixel) of a W-wide arcade-px image -> {element: [x0, y0, x1, y1] | null}
function hudBoxes(mask, W) {
  const out = {};
  for (const [k, e] of Object.entries(HUD_ELEMENTS)) { const b = img.bbox(mask, W, Math.floor(mask.length / W), e.win); out[k] = b ? [b.x, b.y, b.x + b.w - 1, b.y + b.h - 1] : null; }
  return out;
}
// {element: {ok, d (largest edge difference), edges, game, cab}}; tol = 2 px (PLAN §7 G7 acceptance)
function hudCompare(game, cab, tol = 2, only = null) {
  const res = {};
  for (const [k, e] of Object.entries(HUD_ELEMENTS)) {
    if (only && !only.includes(k)) continue;
    const g = game[k], c = cab[k];
    if (!g || !c) { res[k] = { ok: !g && !c, d: null, edges: e.edges, game: g, cab: c }; continue; }
    let d = 0; for (const [i, ch] of ['l', 't', 'r', 'b'].entries()) if (e.edges.includes(ch)) d = Math.max(d, Math.abs(g[i] - c[i]));
    res[k] = { ok: d <= tol, d, edges: e.edges, game: g, cab: c };
  }
  return res;
}
// HUD-only canvas (the #ff00ff key) -> 384-wide arcade mask of the top 48 rows (1 = HUD pixel)
function hudMask(im) {
  const a = img.downsample(im, 2), W = a.width, H = 48, mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const q = (y * W + x) * 4; if (!(a.rgba[q] > 240 && a.rgba[q + 1] < 16 && a.rgba[q + 2] > 240)) mask[y * W + x] = 1; }
  return { mask, W, H };
}

module.exports = { ROOT, BASE, RESULTS, fileURL, isFileURL, playwright, launch, prepare, reseed, open, waitReady, probe, stepsOf, stepNo, stepRequired, install, AT_SOURCE, grab, toArcade, img, checks, finish, HUD_ELEMENTS, hudBoxes, hudCompare, hudMask };
