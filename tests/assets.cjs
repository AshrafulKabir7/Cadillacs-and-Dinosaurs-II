// Node-only asset gate (PLAN §3.3, §8.4; ARCHITECTURE §5.3, §5.4, §7 "New checks"). No browser, no ROM needed.
// Run from the repo root: node tests/assets.cjs
//   G0  `build-game-assets.cjs check` exits 0; no .bin/.zip/.mp4/.rar tracked; SPRITE_DATA sheets decode and their sums match
//   G2  every page named in STAGE_DATA exists, pages <= 1024x1024, <= 1.0 MB per chapter, <= 5 MB in all;
//       STAGE.bandAt/walkable/resolveMove data checks (WP-E asked for them here)
//   G8  budgets: eager non-audio <= 3.5 MB, per-module budgets, any shipped file <= 1.5 MB, tracked files <= 2 MB
//       outside assets/audio; no retired legacy file (ARCHITECTURE §5.6) left in the tree or in index.html. Since G8
//       this suite is the asset gate: every row is enforced (no legacy script is loaded, so G8 below is true). The
//       WARN path is kept only for an old checkout that still loads the legacy art (ASSETS_GATE=1 forces the gate).
// Flags: ASSETS_SKIP_CHECK=1 skips the build check (no ROM on this machine); ARCADE_STEP=G2 fails the SKIPs of steps <= G2.
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), cp = require('node:child_process');
const A = require('./lib/arcade.cjs');
const ROOT = A.ROOT, rel = p => path.join(ROOT, p), exists = p => fs.existsSync(rel(p)), size = p => fs.statSync(rel(p)).size;
const MiB = 1048576, MB = n => (n / MiB).toFixed(3) + ' MB';
const C = A.checks('assets');

const LEGACY_SCRIPTS = ['assets.js', 'weapon-art.js', 'combat-art.js', 'hero-art.js', 'sequel-art.js', 'environment-art.js', 'arcade-heroes.js', 'arcade-items.js'];
const LEGACY_FILES = [...LEGACY_SCRIPTS, 'world-art.js', 'assets/scenery', 'assets/original', 'assets/sprites.png', 'assets/combat-sprites.png', 'assets/hero-actions.png', 'assets/arcade-heroes.png'];
const LEGACY_LARGE = ['assets/original/', 'assets/scenery/', 'sequel-art.js', 'world-art.js', 'assets/sprites.png', 'assets/combat-sprites.png', 'assets/hero-actions.png', 'assets/arcade-heroes.png'];
const BUDGET = { eager: 3.5 * MiB, anyShipped: 1.5 * MiB, tracked: 2 * MiB, stagePerChapter: 1.0 * MiB, stagesTotal: 5 * MiB, stageData: 0.15 * MiB, page: 1024,
  files: { 'sprite-data-heroes.js': 0.9 * MiB, 'sprite-data-fx.js': 0.35 * MiB, 'sprite-data-enemies.js': 1.1 * MiB, 'sprite-data-bosses.js': 1.5 * MiB, 'sprite-data-ui.js': 0.15 * MiB, 'stage-data.js': 0.15 * MiB } };

const html = fs.readFileSync(rel('index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]), css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(m => m[1]);
const legacyLoaded = LEGACY_SCRIPTS.filter(f => scripts.includes(f));
const G8 = process.env.ASSETS_GATE === '1' || legacyLoaded.length === 0;
const gate = (step, name, ok, detail) => (G8 ? C.check(step, name, ok, detail) : (ok ? C.pass(step, name, detail) : C.warn(step, name + ' (not enforced until G8)', detail)));
// A browser-style data script in a sandbox whose global object is `window` itself, as tools/re/build/emit.cjs load()
// does: the PLAN §4.1 envelope is `window.SPRITE_DATA = window.SPRITE_DATA || {…};` followed by a BARE
// `SPRITE_DATA.add('<family>', {…});`, so `window`, `self`, `globalThis` and the bare global must be one object.
const loadGlobals = (file, extra = {}) => { const ctx = { console, ...extra }; ctx.window = ctx.self = ctx.globalThis = ctx; vm.runInNewContext(fs.readFileSync(rel(file), 'utf8'), ctx, { filename: file, timeout: 20000 }); return ctx; };
const pngSize = file => { const b = Buffer.alloc(24); const fd = fs.openSync(file, 'r'); fs.readSync(fd, b, 0, 24, 0); fs.closeSync(fd); return b.readUInt32BE(12) === 0x49484452 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null; };

(async () => {
  // ---------------------------------------------------------------- G0 build check
  const checkScript = 'tools/re/build-game-assets.cjs';
  if (process.env.ASSETS_SKIP_CHECK === '1') C.skip('G0', 'build-game-assets.cjs check exits 0', 'ASSETS_SKIP_CHECK=1');
  else if (!exists(checkScript)) C.skip('G0', 'build-game-assets.cjs check exits 0', 'tools/re/build-game-assets.cjs not present (WP-A)');
  else {
    const r = cp.spawnSync(process.execPath, [checkScript, 'check'], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
    const out = ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/), tail = out.slice(-8).join(' | ');
    C.check('G0', 'build-game-assets.cjs check exits 0 (rebuild agreement, §3.7 gates, budgets, hygiene, anim keys, campaign stages)', r.status === 0, `exit ${r.status}${r.error ? ' ' + r.error.message : ''}: ${tail}`);
    const gates = out.filter(l => /^check (ok|SKIP|FAIL)/.test(l)); if (gates.length) console.log('      ' + gates.map(l => l.replace(/^check /, '')).join(' ; '));
  }

  // ---------------------------------------------------------------- G0 git hygiene
  let tracked = []; try { tracked = cp.execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean); } catch (e) { tracked = null; }
  if (!tracked) C.skip('G0', 'No ROM dumps, archives or videos are tracked', 'git not available');
  else {
    const forbidden = tracked.filter(f => /\.(bin|zip|rar|mp4|sta)$/i.test(f) || /^(dino|roms)\//.test(f) || /^work\//.test(f));
    C.check('G0', 'No ROM dumps, archives, videos or work/ files are tracked', forbidden.length === 0, forbidden.slice(0, 5).join(', '));
    const big = tracked.filter(f => !f.startsWith('assets/audio/') && fs.existsSync(rel(f)) && size(f) > BUDGET.tracked);
    const legacyBig = big.filter(f => LEGACY_LARGE.some(l => f === l || f.startsWith(l))), otherBig = big.filter(f => !legacyBig.includes(f));
    C.check('G0', 'No tracked file > 2 MB outside assets/audio (legacy art excepted until G8)', otherBig.length === 0, otherBig.map(f => `${f} ${MB(size(f))}`).join(', '));
    gate('G8', 'No legacy file > 2 MB remains tracked (assets/original, assets/scenery, sequel-art.js, world-art.js)', legacyBig.length === 0, legacyBig.map(f => `${f} ${MB(size(f))}`).join(', '));
  }

  // ---------------------------------------------------------------- budgets (ARCHITECTURE §5.3)
  const eagerFiles = [...scripts, ...css].filter(f => exists(f)), eager = eagerFiles.reduce((n, f) => n + size(f), 0);
  const missingScripts = scripts.filter(f => !exists(f)), legacyLeft = LEGACY_FILES.filter(f => exists(f));
  gate('G8', 'No retired legacy art is loaded by index.html or left in the tree (ARCHITECTURE §5.6)', legacyLoaded.length === 0 && legacyLeft.length === 0, [...legacyLoaded.map(f => 'loaded ' + f), ...legacyLeft].join(', '));
  C.check('G0', 'Every <script src> and stylesheet in index.html exists', missingScripts.length === 0, missingScripts.join(', '));
  gate('G8', `Eager non-audio download <= 3.5 MB (now ${MB(eager)}: ${eagerFiles.length} files${legacyLoaded.length ? ', legacy still loaded: ' + legacyLoaded.join(' ') : ''})`, eager <= BUDGET.eager, MB(eager));
  for (const [f, limit] of Object.entries(BUDGET.files)) { if (!exists(f)) continue; C.check('G0', `${f} <= ${MB(limit)}`, size(f) <= limit, MB(size(f))); }
  const bossSplit = fs.readdirSync(ROOT).filter(f => /^sprite-data-bosses-ch\d\.js$/.test(f)); for (const f of bossSplit) C.check('G0', `${f} <= 1.5 MB (per-chapter boss split)`, size(f) <= 1.5 * MiB, MB(size(f)));
  const shipped = [...eagerFiles, ...(exists('assets/stages') ? walk('assets/stages') : [])].filter(f => !f.startsWith('assets/audio/'));
  const tooBig = shipped.filter(f => size(f) > BUDGET.anyShipped);
  gate('G8', 'Any single shipped non-audio file <= 1.5 MB', tooBig.length === 0, tooBig.map(f => `${f} ${MB(size(f))}`).join(', '));

  // ---------------------------------------------------------------- G0 sprite data envelopes and checksums
  const families = fs.readdirSync(ROOT).filter(f => /^sprite-data-[a-z0-9-]+\.js$/.test(f)).sort();
  // a lazy sheet (the generated boss bodies, sprite-data-boss-*.js) keeps its pixels in its own script, loaded per chapter
  const lazyPng = p => { if (!p) return undefined; if (!exists(p)) throw new Error(`lazy sheet ${p} missing`); const m = /'(data:image\/png;base64,[^']+)'/.exec(fs.readFileSync(rel(p), 'utf8')); return m ? m[1] : undefined; };
  if (!families.length) C.skip('G0', 'Every SPRITE_DATA sheet decodes at its declared size with a matching FNV sum', 'no sprite-data-*.js shipped yet (WP-B/C/D)');
  else for (const f of families) {
    try {
      const w = loadGlobals(f); const fams = w.SPRITE_DATA && w.SPRITE_DATA.families ? Object.entries(w.SPRITE_DATA.families) : [];
      if (!fams.length) { C.fail('G0', `${f} registers a SPRITE_DATA family`, 'SPRITE_DATA.add was not called'); continue; }
      for (const [name, fam] of fams) {
        const bad = [], ids = Object.keys(fam.sheets || {});
        if (!(fam.v >= 1 && fam.sheets && fam.rect && fam.pal && fam.pal.rows && fam.pal.maps)) bad.push('envelope keys');
        for (const id of ids) { const sh = fam.sheets[id]; try { const im = A.img.fromDataURL(sh.png || lazyPng(sh.lazy)); if (im.width !== sh.w || im.height !== sh.h) bad.push(`${id} ${im.width}x${im.height} != ${sh.w}x${sh.h}`); if (fam.mode === 'indexed' && sh.sum != null) { const sum = A.img.png.fnvIndexed(im.rgba).toString(16); if (sum !== String(sh.sum).replace(/^0x/, '').toLowerCase()) bad.push(`${id} sum ${sum} != ${sh.sum}`); } if (im.width > 1024 || im.height > 1024) bad.push(`${id} larger than 1024²`); } catch (e) { bad.push(`${id}: ${e.message}`); } }
        for (const id of Object.keys(fam.rect || {})) if (!fam.sheets[id]) bad.push(`rect.${id} has no sheet`);
        C.check('G0', `${f}: family '${name}' (${ids.length} sheets, mode ${fam.mode}) decodes with matching sums`, bad.length === 0, bad.slice(0, 4).join('; '));
      }
    } catch (e) { C.fail('G0', `${f} loads in Node`, e.message); }
  }

  // ---------------------------------------------------------------- G2 stage data and pages
  if (!exists('stage-data.js')) C.skip('G2', 'Every page named in STAGE_DATA exists at its declared size', 'stage-data.js not shipped yet (WP-E / G2)');
  else {
    let SD = null; try { SD = loadGlobals('stage-data.js').STAGE_DATA; } catch (e) { C.fail('G2', 'stage-data.js loads in Node', e.message); }
    if (SD) {
      C.check('G2', 'stage-data.js <= 150 KB with version, chapters and sections', size('stage-data.js') <= BUDGET.stageData && SD.version >= 1 && SD.chapters && SD.sections, `${MB(size('stage-data.js'))}; keys ${Object.keys(SD).join(',')}`);
      const missing = [], oversize = [], unknown = [], perChapter = {}; let total = 0, pages = 0;
      const want = (ch, file) => { pages++; if (!exists(file)) { missing.push(file); return; } const s = size(file); total += s; perChapter[ch] = (perChapter[ch] || 0) + s; const d = pngSize(rel(file)); if (!d || d.w > BUDGET.page || d.h > BUDGET.page) oversize.push(`${file} ${d ? d.w + 'x' + d.h : '?'}`); };
      for (const [chId, ch] of Object.entries(SD.chapters || {})) for (const ar of ch.areas || []) {
        if (ar.stub) continue; const dir = ar.dir || `assets/stages/${chId}/${ar.id}/`;
        for (const layer of ['s2', 'fg']) for (const p of ar[layer] || []) { if (Array.isArray(p)) want(chId, `${dir}${layer}-${p[0]}-${p[1]}.png`); else if (typeof p === 'string') want(chId, dir + p); else if (p && p.file) want(chId, p.file.includes('/') ? p.file : dir + p.file); else unknown.push(`${chId}/${ar.id} ${layer} ${JSON.stringify(p)}`); }
        for (const p of (ar.s3 && ar.s3.pages) || []) { if (Array.isArray(p)) want(chId, `${dir}s3-${p[0]}-${p[1]}.png`); else if (typeof p === 'string') want(chId, dir + p); else if (p && p.file) want(chId, p.file.includes('/') ? p.file : dir + p.file); else unknown.push(`${chId}/${ar.id} s3 ${JSON.stringify(p)}`); }
        if (ar.anims && ar.anims.length) want(chId, ar.anims[0].file ? dir + ar.anims[0].file : `${dir}anim.png`);
      }
      for (const [id, pic] of Object.entries(SD.pics || {})) if (pic.file) want('pics', pic.file);
      C.check('G2', `Every page named in STAGE_DATA exists (${pages} pages, ${MB(total)})`, missing.length === 0, missing.slice(0, 5).join(', ') + (missing.length > 5 ? ` (+${missing.length - 5})` : ''));
      if (unknown.length) C.warn('G2', 'Page entries of an unrecognised shape', unknown.slice(0, 3).join('; '));
      C.check('G2', 'Every stage page is <= 1024x1024', oversize.length === 0, oversize.slice(0, 5).join(', '));
      const over = Object.entries(perChapter).filter(([ch, s]) => ch !== 'pics' && s > BUDGET.stagePerChapter);
      C.check('G2', 'Stage pages <= 1.0 MB per chapter and <= 5 MB in all', over.length === 0 && total <= BUDGET.stagesTotal, over.map(([ch, s]) => `${ch} ${MB(s)}`).join(', ') + ` total ${MB(total)}`);
      // STAGE band/mask API (ARCHITECTURE §4.3) as pure data checks, when stage-render.js loads in Node.
      if (!exists('stage-render.js')) C.skip('G2', 'STAGE.bandAt/walkable/resolveMove agree with STAGE_DATA on every column', 'stage-render.js not shipped yet');
      else {
        let STG = null, why = '';
        try {
          const stub = { createElement: () => ({ getContext: () => null, width: 0, height: 0, style: {} }), getElementById: () => null, addEventListener() {} };
          const w = loadGlobals('stage-render.js', { STAGE_DATA: SD, document: stub, Image: class { constructor() { this.complete = false; } set src(v) { this._src = v; } get src() { return this._src; } }, requestAnimationFrame: () => 0, performance: { now: () => 0 }, setTimeout: () => 0 });
          STG = w.STAGE || null; if (!STG) why = 'window.STAGE was not defined';
        } catch (e) { why = 'stage-render.js does not load in Node: ' + e.message; }
        if (!STG || typeof STG.bandAt !== 'function') C.skip('G2', 'STAGE.bandAt/walkable/resolveMove agree with STAGE_DATA on every column', why || 'STAGE.bandAt missing');
        else {
          const bad = []; let cols = 0;
          for (const [chId, ch] of Object.entries(SD.chapters)) (ch.areas || []).forEach((ar, ai) => {
            if (ar.stub) return; const keys = [ai, ar.id, ar]; let key = null;
            for (const k of keys) { try { const b = STG.bandAt(k, 0); if (b) { key = k; break; } } catch (e) { /* next */ } }
            if (key === null) { bad.push(`${chId}/${ar.id}: bandAt accepts neither index, id nor area`); return; }
            const norm = b => Array.isArray(b) ? [b[0], b[1]] : [b.top, b.bottom];
            for (let x = 0; x < ar.w; x += 16) { cols++; const [top, bottom] = norm(STG.bandAt(key, x)); if (!(top >= 0 && top < bottom && bottom <= ar.h)) { bad.push(`${chId}/${ar.id} x${x}: band [${top},${bottom}] outside [0,${ar.h}]`); if (bad.length > 8) return; }
              if (typeof STG.walkable === 'function') { const mid = (top + bottom) / 2; if (STG.walkable(key, x + 8, mid) === false) bad.push(`${chId}/${ar.id} x${x + 8}: band mid ${mid} not walkable`); if (STG.walkable(key, x + 8, top - 24) === true && top - 24 >= 0) bad.push(`${chId}/${ar.id} x${x + 8}: ${top - 24} above the band is walkable`); } }
            const e0 = norm(STG.bandAt(key, -500)), e1 = norm(STG.bandAt(key, 0)), e2 = norm(STG.bandAt(key, ar.w + 500)), e3 = norm(STG.bandAt(key, ar.w - 1));
            if (e0[0] !== e1[0] || e0[1] !== e1[1] || e2[0] !== e3[0] || e2[1] !== e3[1]) bad.push(`${chId}/${ar.id}: beyond the map edges bandAt does not reuse the edge column`);
            if (typeof STG.resolveMove === 'function') { const [top, bottom] = norm(STG.bandAt(key, 64)); try { const r = STG.resolveMove(key, 64, (top + bottom) / 2, 64, top - 40); const ry = Array.isArray(r) ? r[1] : r.y; if (!(ry >= top - 0.01)) bad.push(`${chId}/${ar.id}: resolveMove let y reach ${ry} above band top ${top}`); } catch (e) { bad.push(`${chId}/${ar.id}: resolveMove threw ${e.message}`); } }
          });
          C.check('G2', `STAGE.bandAt/walkable/resolveMove agree with STAGE_DATA on every column (${cols} columns)`, bad.length === 0, bad.slice(0, 5).join('; '));
        }
      }
    }
  }

  A.finish(C, [], { extra: { eager: { bytes: eager, files: eagerFiles.length, legacyLoaded }, gateG8: G8, families, scripts } });
})().catch(e => { console.error(e); process.exit(1); });

function walk(dir) { const out = []; const rec = d => { for (const f of fs.readdirSync(rel(d), { withFileTypes: true })) { const p = `${d}/${f.name}`; if (f.isDirectory()) rec(p); else out.push(p); } }; rec(dir); return out; }
