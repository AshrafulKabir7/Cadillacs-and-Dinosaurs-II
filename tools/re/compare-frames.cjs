#!/usr/bin/env node
// Visual checks of the game against the arcade (PLAN §8.3, WP-H).
//
//   node tools/re/compare-frames.cjs [--scene s01,s02] [--refs] [--file] [--url http://127.0.0.1:8766] [--force] [--list]
//                                    [--out work/re/visual] [--fixture tests/fixtures/visual-scenes.json] [--mame] [--no-reload]
//
// For every scene in tests/fixtures/visual-scenes.json the tool
//   1. produces the reference frame at 384x224: a frame of one of the two local videos (ffmpeg; the 4:3 picture is
//      cropped and area-scaled), a MAME snapshot (work/re/runs/<run>/snap-fNNNNNN.png, or a crop of a verify
//      composite), or a crop of an extract image;
//   2. sets the game up through LAST_EDEN (tests/lib/arcade.cjs AT helpers; a small op list per scene), renders, grabs
//      the canvas and downsamples 768x448 -> 384x224 (today's 768x432 frame is padded);
//   3. writes work/re/visual/<shot>-{game,ref,diff,side}.png, measures what the scene asks for (hero bbox height,
//      band top, HUD rects, record numbers, overlay fit against the reference, size ratios, palette pens) and writes
//      work/re/visual/report.json plus index.png (every side-by-side sheet, half size) for the user to look at.
//
// A scene names the step after which it must match (G1..G7). Before that step has landed the scene is reported as
// 'early' (frames still produced, gates not evaluated). An op that needs an API the game does not have yet (for
// example test.pose) marks the scene 'skipped' with the reason; the reference frame is produced regardless, so the
// references can be reviewed before the game catches up. --refs stops after step 1 (no browser).
// Every scene starts from a freshly loaded page (storage cleared) with Math.random as the suites' seeded LCG (fixture
// `seed`, 2024): a scene's frames are byte-identical whether it runs alone (--scene s20) or in the full table.
// --no-reload shares one page across the scenes (faster, but a frame then depends on the scenes run before it).
// --mame re-runs a MAME plan embedded in a scene's ref when its snapshot is missing (one MAME process, short runs).
'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const A = require('../../tests/lib/arcade.cjs');
const ROOT = A.ROOT, img = A.img;

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2), flag = k => argv.includes(k), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const FIXTURE = path.resolve(ROOT, opt('--fixture', 'tests/fixtures/visual-scenes.json'));
const OUT = path.resolve(ROOT, opt('--out', 'work/re/visual')), REFS = path.join(OUT, 'refs');
const ONLY = opt('--scene', null) ? opt('--scene').split(',').map(s => s.trim()).filter(Boolean) : null;
const URL = opt('--url', process.env.GAME_URL || A.BASE), USE_FILE = flag('--file'), REFS_ONLY = flag('--refs'), FORCE = flag('--force'), MAME = flag('--mame'), NO_RELOAD = flag('--no-reload');
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const scenes = fixture.scenes.filter(s => !ONLY || ONLY.includes(s.id));
const SEED = fixture.seed != null ? fixture.seed : 2024;   // Math.random LCG seed, re-applied at the start of every scene
if (flag('--list')) { for (const s of fixture.scenes) console.log(`${s.id.padEnd(5)} ${s.step.padEnd(4)} ${s.title}  [${(s.shots || [{ ref: s.ref }]).map(sh => refName(sh.ref || s.ref)).join('; ')}]`); process.exit(0); }
fs.mkdirSync(REFS, { recursive: true });

// ---------------------------------------------------------------- references
function refName(ref) { if (!ref) return 'none'; if (ref.kind === 'video') return `video ${ref.video} @${ref.t}s`; if (ref.kind === 'mame') return ref.run ? `MAME ${ref.run} f${ref.frame}` : `MAME ${path.basename(ref.file || '?')}`; if (ref.kind === 'extract') return `extract ${path.basename(ref.file || '?')}`; return ref.kind || 'none'; }
function videoPath(key) { const v = fixture.videos[key]; if (!v) throw new Error(`unknown video '${key}'`); const env = process.env['CD_VIDEO_' + key.toUpperCase()]; return env || path.resolve(ROOT, v.file); }
function probeVideo(file) {
  const r = cp.spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffprobe failed: ' + (r.stderr || r.error && r.error.message));
  const [w, h, fps, dur] = r.stdout.trim().split(',');
  return { width: +w, height: +h, fps: fps.includes('/') ? +fps.split('/')[0] / +fps.split('/')[1] : +fps, duration: +dur };
}
const videoInfo = {};
function videoFrame(ref) {
  const key = ref.video, file = videoPath(key), out = path.join(REFS, `${key}-${String(ref.t).replace('.', '_')}.png`);
  if (!fs.existsSync(file)) return { missing: `video '${key}' not found at ${file} (set CD_VIDEO_${key.toUpperCase()})` };
  if (fs.existsSync(out) && !FORCE) return { file: out, cached: true };
  const v = fixture.videos[key]; let info = videoInfo[key]; if (!info) info = videoInfo[key] = probeVideo(file);
  let crop = v.crop || null;
  if (!crop && info.width / info.height > 4 / 3 + 0.01) { const w = Math.round(info.height * 4 / 3); crop = [Math.round((info.width - w) / 2), 0, w, info.height]; }   // pillarboxed 4:3 picture
  const vf = (crop ? `crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]},` : '') + 'scale=384:224:flags=area';
  const r = cp.spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(ref.t), '-i', file, '-frames:v', '1', '-vf', vf, out], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(out)) return { missing: 'ffmpeg failed: ' + (r.stderr || r.error && r.error.message || 'no output') };
  return { file: out, crop, info };
}
function mameFrame(ref) {
  if (ref.file) { const f = path.resolve(ROOT, ref.file); if (!fs.existsSync(f)) return { missing: `${ref.file} not found` }; let im = img.read(f); if (ref.crop) im = img.crop(im, ...ref.crop); if (im.width !== 384 || im.height !== 224) im = img.fit(im, 384, 224, ref.fit || 'center'); return { image: im, file: f }; }
  const dir = path.join(ROOT, 'work', 're', 'runs', ref.run), snap = path.join(dir, `snap-f${String(ref.frame).padStart(6, '0')}.png`);
  if (!fs.existsSync(snap) && MAME && ref.plan) {
    try { const run = require('./mame/run.cjs'); console.log(`  running MAME plan ${ref.plan.name || ref.run} (${ref.plan.frames} frames)`); cp.execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(ROOT, 'tools/re/mame/run.cjs'))}).runPlan(${JSON.stringify(ref.plan)}).then(s=>console.log(JSON.stringify({ok:s.ok})))`], { cwd: ROOT, stdio: 'inherit', timeout: 600000 }); void run; } catch (e) { return { missing: `MAME run failed: ${e.message}` }; }
  }
  if (!fs.existsSync(snap)) return { missing: `${path.relative(ROOT, snap)} not found${ref.plan ? ' (pass --mame to run its plan)' : ''}` };
  let im = img.read(snap); if (ref.crop) im = img.fit(img.crop(im, ...ref.crop), 384, 224, ref.fit || 'center'); return { image: im, file: snap };
}
function extractFrame(ref) {
  const f = path.resolve(ROOT, ref.file); if (!fs.existsSync(f)) return { missing: `${ref.file} not found` };
  let im = img.read(f); if (ref.crop) im = img.crop(im, ref.crop[0], ref.crop[1], ref.crop[2] || 384, ref.crop[3] || 224);
  if (im.width !== 384 || im.height !== 224) im = img.fit(im, 384, 224, ref.fit || 'topleft');
  return { image: im, file: f };
}
function reference(ref) {
  if (!ref || ref.kind === 'none') return { none: true };
  try {
    const r = ref.kind === 'video' ? videoFrame(ref) : ref.kind === 'mame' ? mameFrame(ref) : ref.kind === 'extract' ? extractFrame(ref) : { missing: `unknown ref kind ${ref.kind}` };
    if (r.missing) return r; if (!r.image) r.image = img.read(r.file); return r;
  } catch (e) { return { missing: e.message }; }
}

// ---------------------------------------------------------------- in-page op runner (uses window.AT from tests/lib/arcade.cjs)
const RUN_OPS = `(ops) => {
  const g = LAST_EDEN, log = [];
  const X = v => { if (v && typeof v === 'object') { if (v.raw != null) return v.raw; if (v.view != null) return AT.view().x + AT.arc(v.view); if (v.player != null) return g.snapshot.player.x + AT.arc(v.player); if (v.lock != null) { const L = g.snapshot.lock || { left: AT.view().x, right: AT.view().x + AT.view().w }; return (v.side === 'right' ? L.right : L.left) + AT.arc(v.lock); } } return AT.arc(+v); };
  const Y = v => { if (v === 'M' || v == null) return AT.M(); if (v && typeof v === 'object') { if (v.raw != null) return v.raw; if (v.lane != null) return AT.lane(v.lane); } return AT.arc(+v); };
  const need = (ok, what) => { if (!ok) { const e = new Error('needs ' + what); e.needs = what; throw e; } };
  for (const op of ops) {
    const [k, ...a] = op;
    switch (k) {
      case 'start': g.start(a[0] || 0, a[1] || 0, a[2] || 'easy', a[3] || 0); break;
      case 'die': {   // lose lives until the continue screen (or n deaths): damage, then wait for the respawn
        for (let d = 0; d < (a[0] || 4) && g.state === 'play'; d++) { g.test.damagePlayer(99999); const lives = g.snapshot.lives; for (let t = 0; t < 900 && g.state === 'play' && g.snapshot.lives === lives; t++) g.step(1 / 60); for (let t = 0; t < 30 && g.state === 'play'; t++) g.step(1 / 60); }
        log.push('state after dying: ' + g.state + ', lives ' + g.snapshot.lives); break; }
      case 'move': AT.move(X(a[0]), Y(a[1]), a[2]); break;
      case 'equip': g.test.equip(a[0], a[1]); break;
      case 'spawn': { const e = AT.spawn(a[0], X(a[1]), Y(a[2]), a[3] || {}); log.push('spawned ' + a[0] + ' at ' + Math.round(e.x) + ',' + Math.round(e.y)); break; }
      case 'spawnBoss': need(typeof g.test.spawnBoss === 'function', 'test.spawnBoss'); g.test.spawnBoss(); break;
      case 'skipTo': g.test.skipTo(a[0]); break;
      case 'ticks': AT.ticks(a[0], a[1]); break;
      case 'key': AT.key(a[0], a[1] !== false); break;
      case 'hold': AT.hold(a[0], a[1], a[2]); break;
      case 'face': AT.hold(a[0] < 0 ? 'KeyA' : 'KeyD', a[1] || 2); break;
      case 'attack': g.controls.attack(); break;
      case 'jump': g.controls.jump(); break;
      case 'special': g.controls.special(); break;
      case 'pickup': g.controls.pickup(); break;
      case 'coin': g.controls.coin(); break;
      case 'pose': need(g.test && typeof g.test.pose === 'function', 'test.pose'); g.test.pose(a[0], a[1] || 0); break;
      case 'damagePlayer': g.test.damagePlayer(a[0]); break;
      case 'damageEnemy': g.test.damageEnemy(a[0], a[1]); break;
      case 'clearFighters': g.test.clearFighters(); break;
      case 'freeClones': need(typeof g.test.freeClones === 'function', 'test.freeClones'); g.test.freeClones(a[0] || 1); break;
      case 'click': { const el = document.querySelector(a[0]); need(!!el, 'element ' + a[0]); el.click(); break; }
      case 'render': g.render(); break;
      case 'call': { const fn = a[0].split('.').reduce((o, k2) => o && o[k2], window); need(typeof fn === 'function', a[0]); fn.apply(null, a.slice(1)); break; }
      default: throw new Error('unknown op ' + k);
    }
  }
  g.render();
  const s = g.snapshot, v = AT.view();
  return { log, state: g.state, units: !!g.units, view: v, band: s.band || null, cameraY: s.cameraY, layout: g.layout || null,
    player: { x: s.player.x, y: s.player.y, z: s.player.z, dir: s.player.dir, pose: s.player.pose, weapon: s.player.weapon, anim: s.player.anim || null, hp: s.player.hp },
    held: s.held ? { rec: s.held.rec, lx: s.held.lx, ly: s.held.ly, w: s.held.w, h: s.held.h, origin: s.held.origin } : null, gunSocket: s.gunSocket || null,
    enemies: s.enemies.map(e => ({ type: e.type, x: Math.round(e.x), y: Math.round(e.y), z: Math.round(e.z || 0), state: e.state, boss: !!e.boss, phase: e.phase, name: e.name || null, anim: e.anim && typeof e.anim === 'object' ? e.anim : undefined })),
    feetScreen: { x: (s.player.x - v.x) * (g.units ? g.units.px : 1), y: (s.player.y - (s.player.z || 0) - v.y) * (g.units ? g.units.px : 1) }, px: g.units ? g.units.px : 1 };
}`;

// Diff-based silhouette: render, move the subject, render again; the changed pixels around the first position are its sprite.
async function silhouette(page, before, moveOps, restoreOps, window) {
  const a = await A.grab(page);
  await page.evaluate(RUN_OPS_FN, moveOps);
  const b = await A.grab(page);
  await page.evaluate(RUN_OPS_FN, restoreOps);
  const d = img.diff(a, b, 16), box = img.bbox(d.mask, d.image.width, d.image.height, window);
  return { frame: a, other: b, mask: d.mask, box, W: d.image.width, H: d.image.height };
}
const RUN_OPS_FN = new Function('return ' + RUN_OPS)();

// Best placement of the hero's silhouette (from the 2x game frame) in the 1x reference: fraction of silhouette pixels
// whose reference colour is close (sum of channel deltas < 90, as the extraction's video fit did).
function overlayFit(game2x, mask, box, W, ref, opts = {}) {
  const k = 2, pts = [];
  for (let y = box.y; y < box.y + box.h; y += k) for (let x = box.x; x < box.x + box.w; x += k) { if (!mask[y * W + x]) continue; const q = (y * game2x.width + x) * 4; pts.push([(x - box.x) / k | 0, (y - box.y) / k | 0, game2x.rgba[q], game2x.rgba[q + 1], game2x.rgba[q + 2]]); }
  if (!pts.length) return null;
  const bw = Math.ceil(box.w / k), bh = Math.ceil(box.h / k), mirror = !!opts.mirror;
  const win = opts.search || [0, 0, ref.width, ref.height]; let best = { score: -1, x: 0, y: 0 };
  const step = opts.step || 1;
  for (let oy = win[1]; oy + bh <= win[1] + win[3]; oy += step) for (let ox = win[0]; ox + bw <= win[0] + win[2]; ox += step) {
    let ok = 0; for (const [px, py, r, g, b] of pts) { const X = ox + (mirror ? bw - 1 - px : px), Y = oy + py; const q = (Y * ref.width + X) * 4; if (Math.abs(ref.rgba[q] - r) + Math.abs(ref.rgba[q + 1] - g) + Math.abs(ref.rgba[q + 2] - b) < 90) ok++; }
    const sc = ok / pts.length; if (sc > best.score) best = { score: sc, x: ox, y: oy };
  }
  return { score: +best.score.toFixed(3), at: [best.x, best.y], size: [bw, bh], pixels: pts.length, mirror };
}

// The hero exactly as HeroRig draws it now (from snapshot.player.anim, the torso/legs pair included, and the held weapon),
// alone on transparent 256x192 canvases with the feet at (128,160), for both facings: all parts, the hero parts only and
// the weapon only. With no stage behind it the alpha is the true silhouette (G3a). null before HeroRig is ready.
async function rigLayers(page) {
  return page.evaluate(() => {
    const g = window.LAST_EDEN, R = window.HeroRig, s = g && g.snapshot, a = s && s.player.anim; if (!R || !R.ready || !a || !a.hero) return null;
    const body = a.legs ? { torso: { clip: a.id, k: a.k }, legs: { clip: a.legs.id, k: a.legs.k } } : { full: { clip: a.id, k: a.k } };
    const w = s.held ? s.held.weapon : (s.player.weapon && R.hero(a.hero).hold[s.player.weapon] ? s.player.weapon : null), out = {};
    for (const dir of [1, -1]) for (const which of ['full', 'body', 'weapon']) {
      let parts = R.parts(a.hero, body, w); if (which === 'body') parts = parts.filter(p => p.tag !== 'weapon'); else if (which === 'weapon') parts = parts.filter(p => p.tag === 'weapon');
      const c = document.createElement('canvas'); c.width = 256; c.height = 192; if (parts.length) R.draw(c.getContext('2d'), parts, 128, 160, 0, dir, 1, 'hero');
      out[which + (dir > 0 ? 'R' : 'L')] = parts.length ? c.toDataURL('image/png') : null;
    }
    return { layers: out, dir: s.player.dir, hero: a.hero, weapon: w, rec: a.rec, legs: a.legs ? a.legs.rec : null };
  });
}
// Best placement of a rig layer in the reference: fraction of its opaque pixels whose reference colour is within tol (sum
// of channel deltas), over feet positions [x0,y0,x1,y1) of the reference. -> {score, feet:[x,y], n}
function rigFit(layer, ref, feetWin, tol = 60) {
  const pts = []; for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) { const q = (y * layer.width + x) * 4; if (layer.rgba[q + 3] > 128) pts.push([x - 128, y - 160, layer.rgba[q], layer.rgba[q + 1], layer.rgba[q + 2]]); }
  if (!pts.length) return null;
  let best = { score: -1, feet: [0, 0] };
  for (let fy = feetWin[1]; fy < feetWin[3]; fy++) for (let fx = feetWin[0]; fx < feetWin[2]; fx++) {
    let ok = 0; for (const [x, y, r, g, b] of pts) { const X = fx + x, Y = fy + y; if (X < 0 || Y < 0 || X >= ref.width || Y >= ref.height) continue; const q = (Y * ref.width + X) * 4; if (Math.abs(ref.rgba[q] - r) + Math.abs(ref.rgba[q + 1] - g) + Math.abs(ref.rgba[q + 2] - b) < tol) ok++; }
    const sc = ok / pts.length; if (sc > best.score) best = { score: sc, feet: [fx, fy] };
  }
  return { score: +best.score.toFixed(4), feet: best.feet, n: pts.length };
}

// ---------------------------------------------------------------- main
(async () => {
  const report = { date: new Date().toISOString(), url: USE_FILE ? 'file://' : URL, fixture: path.relative(ROOT, FIXTURE), out: path.relative(ROOT, OUT), refsOnly: REFS_ONLY, steps: null, probe: null, scenes: [] };
  let browser = null, page = null, P = null, S = null;
  if (!REFS_ONLY) {
    const L = await A.launch({ viewport: { width: 1280, height: 900 } }); browser = L.browser; page = L.page; report.errors = L.errors;
    await A.prepare(page, { seed: SEED });
    await A.open(page, { file: USE_FILE, url: URL });
    await A.install(page);
    P = await A.probe(page); S = A.stepsOf(P); report.steps = S; report.probe = { units: P.units, layout: P.layout, canvas: P.canvas, href: P.href, test: P.test };
    console.log(`game at ${P.href}: canvas ${P.canvas.w}x${P.canvas.h}, landed steps: ${Object.entries(S).filter(([, v]) => v).map(([k]) => k).join(' ') || 'none (today\'s canvas-px game)'}`);
  }
  const sheets = [];
  for (const scene of scenes) {
    const row = { id: scene.id, title: scene.title, step: scene.step, status: 'ok', shots: [], notes: scene.note || undefined };
    const landed = S ? A.stepNo(scene.step) <= Math.max(-1, ...Object.entries(S).filter(([, v]) => v).map(([k]) => A.stepNo(k))) : false;
    if (!REFS_ONLY) {
      let setup = scene.setup || [];
      const reload = setup.length && setup[0][0] === 'reload' ? setup[0] : null; if (reload) setup = setup.slice(1);
      // Every scene starts from a freshly loaded page with empty storage: LAST_EDEN.start() does not reset game.js's
      // global clock `time` (HUD blink, rain, item bob, animation phases), coins, particles or the UI modules' state,
      // so reseeding Math.random alone left a scene's frame dependent on the scenes before it. The init script of
      // A.prepare re-seeds Math.random at every load; the explicit reseed below covers a seed set per scene.
      // --no-reload keeps one page for the whole table (faster; frames then depend on the subset and its order).
      if (!NO_RELOAD || reload) {
        await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* storage blocked */ } }).catch(() => {});
        await A.open(page, { file: USE_FILE, url: URL, sound: reload ? reload[1] !== false : true }); await A.install(page);
      }
      await A.reseed(page, scene.seed != null ? scene.seed : SEED);
      try { await page.evaluate(RUN_OPS_FN, setup); } catch (e) { row.status = 'skipped'; row.reason = `setup: ${String(e.message).split('\n')[0]}`; }
      // From G2 the stage pages load lazily per chapter: wait for the scene's chapter before its shots render.
      await page.evaluate(async () => { const g = window.LAST_EDEN; if (g && window.SEQUEL_RENDER && typeof SEQUEL_RENDER.loadChapter === 'function' && g.snapshot && g.snapshot.level != null) await SEQUEL_RENDER.loadChapter(g.snapshot.level); }).catch(() => {});
    }
    const shots = scene.shots || [{ id: scene.id, ops: [], ref: scene.ref, expect: scene.expect }];
    for (const sh of shots) {
      const sid = sh.id || scene.id, shot = { id: sid, ref: refName(sh.ref), metrics: {}, gate: null };
      const R = reference(sh.ref);
      if (!R.image) for (const k of ['ref', 'diff']) { const f = path.join(OUT, `${sid}-${k}.png`); if (fs.existsSync(f)) fs.unlinkSync(f); }   // this tool's stale outputs of an earlier fixture
      if (R.none) shot.refFile = null; else if (R.missing) { shot.refMissing = R.missing; } else { shot.refFile = path.join(OUT, `${sid}-ref.png`); img.write(shot.refFile, R.image); shot.refSource = path.relative(ROOT, R.file || ''); }
      if (REFS_ONLY || row.status === 'skipped') { row.shots.push(shot); continue; }
      let st = null;   // a shot's `before` ops run first (setup only; the boss gate no longer diffs against a frame grabbed then)
      try { if (sh.before) await page.evaluate(RUN_OPS_FN, sh.before); st = await page.evaluate(RUN_OPS_FN, sh.ops || []); } catch (e) { shot.skipped = `ops: ${String(e.message).split('\n')[0]}`; row.status = row.status === 'ok' ? 'skipped' : row.status; row.reason = row.reason || shot.skipped; row.shots.push(shot); continue; }
      shot.state = { state: st.state, player: st.player, held: st.held, gunSocket: st.gunSocket, enemies: st.enemies.slice(0, 12), band: st.band, view: st.view, feetScreen: st.feetScreen };
      const frame2x = await A.grab(page), game = A.toArcade(frame2x);
      shot.gameFile = path.join(OUT, `${sid}-game.png`); img.write(shot.gameFile, game); shot.canvasSource = frame2x.source;
      const ex = sh.expect || {}, m = shot.metrics, fails = [];
      // Hero silhouette: move the player 200 arcade px to the right and back (no step in between, so only the hero changes).
      // 200, not 120: a held long gun or bazooka reaches 70 px behind the moved copy's feet, which put it inside the
      // +-90 px window of the first position and polluted the silhouette (G3a).
      if (ex.heroHeight || ex.overlay || ex.sizes === 'hero' || ex.sizes === true) {
        const dx = 200, win = [Math.max(0, st.feetScreen.x - 90 * st.px), 0, 180 * st.px, Math.round(st.feetScreen.y) + 1];
        const sil = await silhouette(page, st, [['move', { player: dx }, { raw: st.player.y }]], [['move', { player: -dx }, { raw: st.player.y }]], win);
        if (sil.box) { m.heroBox = { x: sil.box.x / st.px, y: sil.box.y / st.px, w: sil.box.w / st.px, h: sil.box.h / st.px }; m.heroHeight = +(sil.box.h / st.px).toFixed(1); m.heroScreenFrac = +(sil.box.h / frame2x.height).toFixed(3);
          if (ex.heroHeight) { const ok = Math.abs(m.heroHeight - ex.heroHeight.h) <= (ex.heroHeight.tol == null ? 1 : ex.heroHeight.tol); if (!ok) fails.push(`hero height ${m.heroHeight} != ${ex.heroHeight.h} ±${ex.heroHeight.tol == null ? 1 : ex.heroHeight.tol}`); }
          if (ex.overlay && R.image) { const fit = overlayFit(frame2x, sil.mask, sil.box, sil.W, R.image, { mirror: !!ex.overlay.mirror, search: ex.overlay.search, step: ex.overlay.step }); m.overlay = fit; if (fit && ex.overlay.minScore != null && fit.score < ex.overlay.minScore) fails.push(`overlay score ${fit.score} < ${ex.overlay.minScore}`); }
        } else { m.heroBox = null; if (ex.heroHeight) fails.push('the hero is not visible (no pixel changed when moved)'); }
      }
      // Exact sprite overlay (G3a): the rig's own sprite fitted into the reference. Gates: the best score (every opaque
      // pixel of hero + weapon within the colour tolerance at one placement), the facing (the game's own unless
      // rig.mirror), and the weapon fitted on its own within weaponTol px of where the hero body puts it.
      if (ex.rig && R.image) {
        const L = await rigLayers(page);
        if (!L) fails.push('HeroRig layers unavailable (HeroRig not ready or snapshot.player.anim.hero missing)');
        else {
          const win = ex.rig.feet || [0, 0, R.image.width, R.image.height], tol = ex.rig.tol || 60, wt = ex.rig.weaponTol == null ? 1 : ex.rig.weaponTol;
          const fits = {}; for (const d of ['R', 'L']) { const lay = L.layers['full' + d]; fits[d] = lay ? rigFit(img.fromDataURL(lay), R.image, win, tol) : null; }
          const own = L.dir > 0 ? 'R' : 'L', other = own === 'R' ? 'L' : 'R', face = ex.rig.mirror ? other : own, f = fits[face];
          m.rig = { hero: L.hero, weapon: L.weapon, rec: L.rec, legs: L.legs, facing: face, score: f && f.score, feet: f && f.feet, pixels: f && f.n, otherFacing: fits[face === 'R' ? 'L' : 'R'] && fits[face === 'R' ? 'L' : 'R'].score };
          if (!f) fails.push('rig sprite has no opaque pixel');
          else {
            if (f.score < (ex.rig.minScore || 0.95)) fails.push(`rig overlay score ${f.score} < ${ex.rig.minScore || 0.95} (facing ${face})`);
            if (ex.rig.at) { const d = Math.max(Math.abs(f.feet[0] - ex.rig.at[0]), Math.abs(f.feet[1] - ex.rig.at[1])); m.rig.feetOff = d; if (d > 1) fails.push(`rig feet ${f.feet} not within 1 px of the reference hero's ${ex.rig.at}`); }
            if (L.weapon && L.layers['weapon' + face]) {
              const near = [f.feet[0] - 4, f.feet[1] - 4, f.feet[0] + 5, f.feet[1] + 5], b = rigFit(img.fromDataURL(L.layers['body' + face]), R.image, [f.feet[0] - 2, f.feet[1] - 2, f.feet[0] + 3, f.feet[1] + 3], tol), wf = rigFit(img.fromDataURL(L.layers['weapon' + face]), R.image, near, tol);
              m.rig.body = b; m.rig.weaponFit = wf && { score: wf.score, dx: wf.feet[0] - b.feet[0], dy: wf.feet[1] - b.feet[1], pixels: wf.n };
              if (!wf) fails.push('weapon layer empty'); else if (Math.abs(wf.feet[0] - b.feet[0]) > wt || Math.abs(wf.feet[1] - b.feet[1]) > wt) fails.push(`weapon ${wf.feet[0] - b.feet[0]},${wf.feet[1] - b.feet[1]} px off the hold (> ${wt})`);
              else if (wf.score < (ex.rig.weaponScore || 0.9)) fails.push(`weapon overlay score ${wf.score} < ${ex.rig.weaponScore || 0.9}`);
            }
          }
        }
      }
      // Boss silhouette (G5): the view as rendered, against the same view rendered once more with the boss's body left out
      // (test.hideEnemy: sprite, shadow and chain; no step in between, so the stage, toasts and the sequel tells are identical
      // and only the boss's own pixels change; test.overlays(false) leaves the HUD, radio and mission strips out of both). Its box is gated against the box of the ROM records the game
      // says it draws (test.bossBox: the frame on show, LOT 00's parts, at 1 arcade px per art px): the top within tol px and
      // the same height, so a body drawn at another scale or offset fails. The boss/hero ratio is the measured boss height
      // over the measured hero height, checked against the ROM record heights (the hero's 79, scene s01).
      // (Until G5's fix this diffed against a frame grabbed before spawnBoss moved the camera: the box was the window.)
      if (ex.bossHeight) { const i = st.enemies.findIndex(e => e.boss && (!ex.bossHeight.type || e.type === ex.bossHeight.type)); if (i < 0) fails.push(`no boss${ex.bossHeight.type ? ' of type ' + ex.bossHeight.type : ''} on the field`); else {
          const rom = await page.evaluate(i => { const t = LAST_EDEN.test; return t && typeof t.bossBox === 'function' && typeof t.hideEnemy === 'function' ? t.bossBox(i) : null; }, i);
          if (!rom) fails.push('test.bossBox/test.hideEnemy missing, or the boss has no ROM frame on show');
          else {
            const px = st.px, tol = ex.bossHeight.tol == null ? 3 : ex.bossHeight.tol, heroRom = ex.bossHeight.heroRom || 79, b = rom.box, pad = 48;
            // both renders leave the HUD, radio and mission strips out (test.overlays(false)): a tall boss's head reaches under them
            const lean = await page.evaluate(() => typeof LAST_EDEN.test.overlays === 'function' && (LAST_EDEN.test.overlays(false), LAST_EDEN.render(), true));
            const withBoss = await A.grab(page);
            await page.evaluate(i => { LAST_EDEN.test.hideEnemy(i, true); LAST_EDEN.render(); }, i);
            const without = await A.grab(page);
            await page.evaluate(i => { LAST_EDEN.test.hideEnemy(i, false); if (typeof LAST_EDEN.test.overlays === 'function') LAST_EDEN.test.overlays(true); LAST_EDEN.render(); }, i);
            // the window: the record box with 48 px around it, its bottom at the record's bottom row (the shadow below the
            // feet is not the body)
            const x0 = Math.max(0, Math.round((b[0] - pad) * px)), y0 = Math.max(0, Math.round((b[1] - pad) * px)), x1 = Math.min(withBoss.width, Math.round((b[0] + b[2] + pad) * px)), y1 = Math.min(withBoss.height, Math.round((b[1] + b[3]) * px));
            const d = img.diff(withBoss, without, 24), box = img.bbox(d.mask, d.image.width, d.image.height, [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)]);
            m.bossRom = { overlaysOff: !!lean, type: rom.type, name: rom.name, fid: rom.fid, key: rom.key, parts: rom.parts, w: rom.w, h: rom.h, box: b.map(v => +v.toFixed(1)), toHero: +(rom.h / heroRom).toFixed(3) };
            m.bossBox = box ? { x: box.x / px, y: box.y / px, w: box.w / px, h: box.h / px, type: rom.type, name: rom.name } : null;
            if (!box) fails.push('the boss is not visible (no pixel changed when it was left out)');
            else {
              m.bossHeight = +(box.h / px).toFixed(1);
              if (Math.abs(box.y / px - b[1]) > tol) fails.push(`boss top ${(box.y / px).toFixed(1)} is not the ROM box top ${b[1].toFixed(1)} (±${tol})`);
              if (Math.abs(m.bossHeight - rom.h) > tol) fails.push(`boss drawn ${m.bossHeight} px high, its ROM records ${rom.h} (±${tol})`);
              if (m.heroHeight) { m.bossToHero = +(m.bossHeight / m.heroHeight).toFixed(3);
                if (Math.abs(m.bossToHero - m.bossRom.toHero) > (ex.bossHeight.ratioTol || .06)) fails.push(`boss/hero height ratio ${m.bossToHero} is not the ROM records' ${m.bossRom.toHero}`);
                if (ex.bossHeight.ratio && (m.bossToHero < ex.bossHeight.ratio[0] || m.bossToHero > ex.bossHeight.ratio[1])) fails.push(`boss/hero height ratio ${m.bossToHero} outside [${ex.bossHeight.ratio}]`); }
            }
          } } }
      if (ex.bandTop != null) { m.bandTop = st.band ? st.band.top - (st.cameraY || 0) : null; if (!ex.soft && (m.bandTop == null || Math.abs(m.bandTop - ex.bandTop) > (ex.bandTol || 0))) fails.push(`band top ${m.bandTop} != ${ex.bandTop}`); else if (m.bandTop != null && Math.abs(m.bandTop - ex.bandTop) > (ex.bandTol || 0)) m.bandTopNote = `expected ${ex.bandTop} (soft)`; }
      // the radio rect is the tall 8x16 strip from G6 (PLAN §7 G6 4), still above the feet band at arcade y 81; from G7 the weapon rect is the cabinet panel (0,208)-(120,224) (0x23A24)
      if (ex.layout) { const L = st.layout, inside = (r, Rr) => Array.isArray(r) && r.length === 4 && r[0] >= Rr[0] && r[1] >= Rr[1] && r[0] + r[2] <= Rr[0] + Rr[2] && r[1] + r[3] <= Rr[1] + Rr[3]; m.layout = L; const ok = L && inside(L.hud, [0, 0, 768, 88]) && inside(L.radio, [16, 92, 736, 64]) && L.radio[1] + L.radio[3] <= 2 * 81 && inside(L.weapon, S && S.G7 ? [0, 416, 240, 32] : [16, 396, 256, 44]); if (!ok) fails.push('layout rects outside the reserved HUD/radio/weapon rects'); }
      // G7 (PLAN §7 G7 acceptance, s30): the top HUD element by element against the cabinet boxes of
      // tests/fixtures/hud-cabinet.json (tools/re/hud-cabinet.cjs), within ex.hud.tol px, in each coin turn, on a HUD-only render
      if (ex.hud) { const fix = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'hud-cabinet.json'), 'utf8')); } catch (e) { return null; } })();
        if (!fix) fails.push('tests/fixtures/hud-cabinet.json missing (node tools/re/hud-cabinet.cjs)'); else { m.hud = {};
          for (const [turn, call] of [['join', 'JOIN-IN'], ['insert', 'INSERT COIN']]) {
            const h = await page.evaluate(call => { const g = LAST_EDEN; for (let i = 0; i < 260; i++) { const h = g.test.hud(); if (h.coin.call === call && h.coin.phase % 64 > 8) break; g.step(1 / 60); } g.test.toast(null); g.test.say(null); g.test.hudOnly(true); g.render(); return g.test.hud(); }, call);
            const hm = A.hudMask(await A.grab(page)); await page.evaluate(() => LAST_EDEN.test.hudOnly(false));
            const only = turn === 'insert' || !h.foe ? ['face', 'lives', 'score', 'name', 'bar', 'slot2', 'slot3'] : null, cmp = A.hudCompare(A.hudBoxes(hm.mask, hm.W), fix.boxes[turn], ex.hud.tol == null ? 2 : ex.hud.tol, only);
            m.hud[turn] = { call: h.coin.call, foe: h.foe && h.foe.name, d: Object.fromEntries(Object.entries(cmp).map(([k, r]) => [k, r.d])) };
            if (h.coin.call !== call) fails.push(`hud: the coin call never showed ${call}`);
            for (const [k, r] of Object.entries(cmp)) if (!r.ok) fails.push(`hud ${turn} ${k}: ${r.d == null ? 'missing' : r.d + ' px'} from the cabinet`);
          } } }
      if (ex.recs) { const rec = st.player.anim && st.player.anim.rec; m.rec = rec == null ? null : rec; m.role = st.player.anim && st.player.anim.role; if (rec == null) fails.push('snapshot.player.anim.rec missing'); else if (!ex.recs.includes(rec)) fails.push(`record ${rec} not in [${ex.recs}]`); }
      if (ex.heldRec) { m.heldRec = st.held && st.held.rec; if (m.heldRec !== ex.heldRec) fails.push(`held record ${m.heldRec} != ${ex.heldRec}`); }
      if (ex.role) { m.role = st.player.anim && st.player.anim.role; if (!st.player.anim) fails.push('snapshot.player.anim missing'); else if (![].concat(ex.role).includes(m.role)) fails.push(`role ${m.role} not in [${[].concat(ex.role)}]`); }
      if (ex.pose) { m.pose = st.player.pose; if (![].concat(ex.pose).includes(st.player.pose)) fails.push(`pose ${st.player.pose} not in [${[].concat(ex.pose)}]`); }
      if (ex.enemyState) { m.enemyStates = st.enemies.map(e => e.type + ':' + e.state); if (!st.enemies.some(e => [].concat(ex.enemyState).includes(e.state))) fails.push(`no enemy in state ${ex.enemyState}`); }
      if (ex.bossParts) { m.bossParts = await page.evaluate(() => { const g = LAST_EDEN, i = g.snapshot.enemies.findIndex(e => e.type === 'fessenden'); if (i < 0 || typeof g.test.bossParts !== 'function') return null; const p = g.test.bossParts(i); return Array.isArray(p) ? p.map(x => x.name || x.part || x) : Object.keys(p || {}); }); if (!m.bossParts) fails.push('test.bossParts(i) missing'); else { const need = ex.bossParts === true ? ['body', 'arm', 'arm2', 'neckA', 'neckB', 'line'] : ex.bossParts; const miss = need.filter(n => !m.bossParts.includes(n)); if (miss.length) fails.push(`LOT 00 parts missing: ${miss}`); } }
      if (ex.paletteDiff) { m.paletteDiff = await page.evaluate(pd => { const fam = window.SPRITE_DATA && SPRITE_DATA.families[pd.family]; if (!fam) return null; const a = fam.pal.maps[pd.map], b = fam.pal.maps[pd.home]; if (!a || !b) return { error: `maps ${pd.map}/${pd.home} missing` }; const slots = pd.slots || [...Array(32).keys()]; let pens = 0, rows = 0; for (const s of slots) { if (a[s] === b[s]) continue; rows++; const ra = fam.pal.rows[a[s]] || [], rb = fam.pal.rows[b[s]] || []; for (let p = 0; p < 16; p++) if (ra[p] !== rb[p]) pens++; } return { rowsChanged: rows, pensChanged: pens }; }, ex.paletteDiff); if (!m.paletteDiff) fails.push('SPRITE_DATA family for the palette check missing'); else if (m.paletteDiff.error) fails.push(m.paletteDiff.error); else if (ex.paletteDiff.minPens && m.paletteDiff.pensChanged < ex.paletteDiff.minPens) fails.push(`only ${m.paletteDiff.pensChanged} pens differ from ${ex.paletteDiff.home} (need ${ex.paletteDiff.minPens})`); }
      if (ex.state) { if (st.state !== ex.state) fails.push(`game state ${st.state} != ${ex.state}`); }
      // Frame diff against the reference (informative for video refs; a gate only when the scene asks).
      if (R.image) { const d = img.diff(game, R.image, 24, ex.roi || null); m.diffRatio = +d.ratio.toFixed(4); shot.diffFile = path.join(OUT, `${sid}-diff.png`); img.write(shot.diffFile, d.image); if (ex.diffMax != null && d.ratio > ex.diffMax) fails.push(`frame diff ${m.diffRatio} > ${ex.diffMax}`); }
      // Side-by-side sheet for the eye.
      const panels = [{ im: game, title: `${sid} GAME` }]; if (R.image) { panels.push({ im: R.image, title: `${sid} REF ${sh.ref && sh.ref.kind === 'video' ? sh.ref.video + ' ' + sh.ref.t + 'S' : sh.ref && sh.ref.run ? sh.ref.run.toUpperCase().slice(0, 18) : 'MAME' }` }); if (shot.diffFile) panels.push({ im: img.read(shot.diffFile), title: `${sid} DIFF ${Math.round((m.diffRatio || 0) * 100)}%` }); }
      if (m.heroBox) { const g2 = panels[0].im; img.rect(g2, [Math.round(m.heroBox.x), Math.round(m.heroBox.y), Math.round(m.heroBox.w), Math.round(m.heroBox.h)], [0, 255, 0]); }
      if (m.bossBox) { const g2 = panels[0].im; img.rect(g2, [Math.round(m.bossBox.x), Math.round(m.bossBox.y), Math.round(m.bossBox.w), Math.round(m.bossBox.h)], [255, 160, 0]); if (m.bossRom) img.rect(g2, m.bossRom.box.map(Math.round), [0, 200, 255]); }
      const side = img.sheet(panels); shot.sideFile = path.join(OUT, `${sid}-side.png`); img.write(shot.sideFile, side); sheets.push({ id: sid, im: side });
      shot.gate = { evaluated: landed, passed: landed ? fails.length === 0 : null, fails, step: scene.step };
      if (!landed && fails.length) shot.gate.note = 'not evaluated: the scene\'s step has not landed';
      if (landed && fails.length) row.status = 'failed'; else if (!landed && row.status === 'ok') row.status = 'early';
      row.shots.push(shot);
      console.log(`${sid.padEnd(9)} ${row.status.padEnd(7)} ${scene.step.padEnd(4)} ${shot.refMissing ? 'REF MISSING: ' + shot.refMissing : 'ref ' + shot.ref}${m.heroHeight != null ? ` | hero h ${m.heroHeight}` : ''}${m.overlay ? ` | overlay ${m.overlay.score}` : ''}${m.rig && m.rig.score != null ? ` | rig ${m.rig.score} feet ${m.rig.feet}${m.rig.weaponFit ? ` weapon ${m.rig.weaponFit.dx},${m.rig.weaponFit.dy} (${m.rig.weaponFit.score})` : ''}` : ''}${m.bossHeight != null ? ` | boss h ${m.bossHeight} (rom ${m.bossRom.h})${m.bossToHero != null ? ` ratio ${m.bossToHero} (rom ${m.bossRom.toHero})` : ''}` : ''}${m.diffRatio != null ? ` | diff ${(m.diffRatio * 100).toFixed(1)}%` : ''}${fails.length ? ' | ' + fails.join('; ') : ''}`);
    }
    if (REFS_ONLY) { row.status = row.shots.some(s => s.refMissing) ? 'missing-ref' : 'refs'; console.log(`${scene.id.padEnd(9)} ${row.status.padEnd(11)} ${row.shots.map(s => s.refMissing ? 'MISSING ' + s.refMissing : (s.refFile ? path.relative(ROOT, s.refFile) : 'no ref')).join(' ; ')}`); }
    else if (row.status === 'skipped') console.log(`${scene.id.padEnd(9)} skipped ${scene.step.padEnd(4)} ${row.reason}`);
    for (const p of row.shots) for (const k of ['refFile', 'gameFile', 'diffFile', 'sideFile']) if (p[k]) p[k] = path.relative(ROOT, p[k]).replace(/\\/g, '/');
    report.scenes.push(row);
  }
  if (sheets.length) {   // index.png: every side-by-side at half size, stacked
    const half = sheets.map(s => ({ id: s.id, im: img.downsample(s.im, 2) })), W = Math.max(...half.map(h => h.im.width)), H = half.reduce((n, h) => n + h.im.height + 2, 0), idx = img.blank(W, H, [12, 12, 14]);
    let y = 0; for (const h of half) { img.blit(idx, h.im, 0, y); y += h.im.height + 2; } img.write(path.join(OUT, 'index.png'), idx);
  }
  report.summary = { scenes: report.scenes.length, ok: report.scenes.filter(s => s.status === 'ok').length, early: report.scenes.filter(s => s.status === 'early').length, skipped: report.scenes.filter(s => s.status === 'skipped').length, failed: report.scenes.filter(s => s.status === 'failed').length, missingRefs: report.scenes.reduce((n, s) => n + s.shots.filter(p => p.refMissing).length, 0) };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`report: ${path.relative(ROOT, path.join(OUT, 'report.json'))}  ${JSON.stringify(report.summary)}`);
  if (browser) await browser.close();
  if (report.summary.failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
