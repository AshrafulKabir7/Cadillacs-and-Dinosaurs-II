// Fx family of the ROM sprite data (PLAN §4.1 "fx", §5.2 `sprites fx`, §6 WP-D; HEROES §7, §10.4; KI6, KI7, KI9).
// Writes:
//   sprite-data-fx.js                 SPRITE_DATA.add('fx', …): one slot-indexed sheet `items` (R = OBJ slot, G = pen)
//                                     with every weapon record (holds, 16 rotations, fast spin, ground, the rifle/M16
//                                     empty poses, the dynamite fuse), the muzzle flashes, sparks, smoke, casings,
//                                     bullets, pellets, rocket, impacts, explosions, BOOM, debris, the torch flame, the
//                                     speech bubbles, the carried/breakable containers, the food / score / magazine
//                                     items and the boss projectiles; tight record boxes; OBJ palette rows and the
//                                     0x8E8E area maps (objPages) plus `home`; the weapon art index (ground, rot,
//                                     fastSpin, empty poses, the thrown-gun "hurl" art the user chose for empty guns),
//                                     effect groups, containers / props, items.frames (the 28 names of today's
//                                     FOOD_WEIGHTS / BONUS_WEIGHTS on the ROM item each picture shows, with today's
//                                     heal/score/kind, frozen in pack-config.json fx.items) and the bubble texts
//   work/re/build/sheets/fx-items.png the sheet coloured with the home map (review)
//   work/re/pack/fx-contact.png       every group drawn from the shipped sheet data at its origin (review)
//
// Records are re-rendered from the ROM (model.cjs recBlocks + rom.cjs tiles, the validated hero renderer) into
// (slot, pen) codes, trimmed to their opaque box and checked pixel for pixel against the extract atlases
// (atlas-weapons.png with the home rows, atlas-bubbles.png with set 0, boss-projectiles-atlas.png with its own rows)
// (the legacy arcade-items.js sheet, while it exists, is only a cross-check of the renderer and of the heal/score/kind
// values; G8 deletes it and the build does not need it). Timing of weapons and effects stays in ROM_HEROES
// (weapon.*, fx.*; HEROES §4.2, PLAN §4.1); this family carries the art and the names that point at it.
//
// API (PLAN §5.3):  build({rom, extract, config, out, rgba, lib, log}) -> {files, report}
// CLI:              node tools/re/build/sprites-fx.cjs [--out <dir>] [--rgba]
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const HEROES = ['jack', 'mustapha', 'hannah', 'mess'];
const FIREARMS = ['gun', 'rifle', 'uzi', 'm16', 'shotgun', 'bazooka'];
// the 14 sequel weapon types + bknife (HEROES §7.1, D21)
const WEAPON_TYPES = ['gun', 'rifle', 'uzi', 'm16', 'shotgun', 'bazooka', 'knife', 'stick', 'rod', 'bknife', 'club', 'torch', 'dynamite', 'grenade', 'stone'];
const EXTRA_VARIANTS = ['rifle-empty', 'm16-empty', 'stone-b', 'stone-c'];
// PLAN §4.1 fx effect records (2102–2124, 2135–2137, …): every record of these ranges that renders is shipped
const PLAN_EFFECTS = '2102-2124,2135-2137,2154-2170,2583-2599,2835-2840,378-393,460-469,2140-2142,3509-3511,2127,2132,2138,3361-3363,1405-1407';
const FLAME = '1408-1417', BUBBLES = '1593-1607', MAGAZINE = 2130;
// carried / breakable containers (pool A type 0x14, handler 0x28C76); subtypes from the container table (HEROES §7.13)
const CONTAINERS = [
  { key: 'jerrycan', name: 'JERICAN', set: '0x2995E', sub: 0x0 },
  { key: 'drum', name: 'DRAMCAN', set: '0x2998C', sub: 0x2 },
  { key: 'barrel', name: 'TARU', set: '0x299FE', sub: 0x4 },
  { key: 'concrete', name: 'CONKRIET', set: '0x29A66', sub: 0x6 },
  { key: 'rock', name: 'IWA', set: '0x29A86', sub: 0x8 },
  { key: 'armor', name: 'YOROI', set: '0x29AA6', sub: 0xA },
  { key: 'tire', name: 'TIYA', set: '0x29AC8', sub: 0xC },
];
// sequel prop kinds (tools/re/levels/ch<N>.json section props, game.js placeProps) -> ROM art. Only kinds with a ROM
// object are listed with a container; the mission objects stay code-drawn (no ROM object record identified).
const PROPS = {
  barrel: { container: 'barrel', note: 'TARU, the wooden barrel the arcade places and breaks' },
  drum: { container: 'drum', note: 'DRAMCAN, the oil drum' },
  crate: { container: 'drum', note: 'the ROM has no wooden crate object: the sequel crate is drawn as DRAMCAN, the oil drum the 1993 streets place and break (CONKRIET is a concrete chunk, not a box); set crate to null to keep it code-drawn' },
  jerrycan: { container: 'jerrycan' }, rock: { container: 'rock' }, armor: { container: 'armor' }, tire: { container: 'tire' }, concrete: { container: 'concrete' },
  pod: null, cargo: null, valve: null, tuner: null, pylon: null, beacon: null, gate: null, 'vat-vent': null, 'pump-column': null, 'spillway-gate': null, 'spillway-wheel': null,
  'chain-barrier': null, 'chain-anchor': null, 'crane-shadow': null, 'parked-car': null, 'crown-engine': null,
};

// ------------------------------------------------------------------------------------------------ small helpers
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const md5 = p => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const hexs = n => '0x' + n.toString(16).toUpperCase();
const r4 = v => Math.round(v * 10000) / 10000;
const uniq = a => [...new Set(a)];
const sortNum = a => uniq(a).sort((x, y) => x - y);
function rangeList(spec) { const out = []; for (const t of String(spec).split(',')) { const m = /^(\d+)(?:-(\d+))?$/.exec(t.trim()); if (!m) continue; const a = +m[1], b = m[2] ? +m[2] : a; for (let i = a; i <= b; i++) out.push(i); } return out; }
function ranges(list) { const l = sortNum(list); if (!l.length) return ''; const o = []; let s = l[0], p = l[0]; for (const v of l.slice(1)) { if (v === p + 1) { p = v; continue; } o.push(s === p ? `${s}` : `${s}-${p}`); s = p = v; } o.push(s === p ? `${s}` : `${s}-${p}`); return o.join(','); }
// "2102x1 2103x2" / "3+2590x2" / "-x3" -> [[rec, dur]] (records only; '-' = a frame without a record)
const seqOf = s => String(s || '').split(/\s+/).filter(Boolean).map(t => { const m = /^(?:\d+\+)?(-|\d+)x(\d+)$/.exec(t); return m && m[1] !== '-' ? [+m[1], +m[2]] : null; }).filter(Boolean);
const framesOf = an => (an && an.frames ? an.frames : []).map(f => [f.rec, f.dur]);

// ------------------------------------------------------------------------------------------------ records
// One ROM record -> tight (slot, pen) image; code = slot*16 + pen, 0xFFFF = transparent. Same block order, flips,
// tile wrap and uniform-record attribute rule as model.cjs/draw.cjs (block 0 ends on top): the renderer the heroes
// family validated pixel-exact (sprites-heroes.cjs makeRenderer).
function makeRenderer(M, R) {
  const cache = new Map();
  return function renderRec(rec) {
    if (cache.has(rec)) return cache.get(rec);
    const blocks = M.recBlocks(rec); let out = null;
    if (blocks.length) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const b of blocks) { x0 = Math.min(x0, b.lx); y0 = Math.min(y0, b.ly); x1 = Math.max(x1, b.lx + 16 * b.bw); y1 = Math.max(y1, b.ly + 16 * b.bh); }
      const W = x1 - x0, H = y1 - y0;
      if (W > 0 && H > 0 && W <= 2048 && H <= 2048) {
        const code = new Uint16Array(W * H).fill(0xFFFF);
        for (let i = blocks.length - 1; i >= 0; i--) {
          const b = blocks[i], fx = !!(b.attr & 0x20), fy = !!(b.attr & 0x40), pal = b.attr & 31;
          for (let r = 0; r < b.bh; r++) for (let c = 0; c < b.bw; c++) {
            const col = fx ? b.bw - 1 - c : c, row = fy ? b.bh - 1 - r : r;
            const t = R.tile((b.code & ~0xF) + ((b.code + col) & 0xF) + 0x10 * row);
            for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
              const p = t[(fy ? 15 - y : y) * 16 + (fx ? 15 - x : x)]; if (p === 15) continue;
              code[(b.ly - y0 + r * 16 + y) * W + (b.lx - x0 + c * 16 + x)] = pal * 16 + p;
            }
          }
        }
        let tx0 = W, ty0 = H, tx1 = -1, ty1 = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (code[y * W + x] !== 0xFFFF) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
        if (tx1 >= 0) {
          const w = tx1 - tx0 + 1, h = ty1 - ty0 + 1, img = new Uint16Array(w * h);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = code[(y + ty0) * W + x + tx0];
          out = { rec, w, h, ox: -x0 - tx0, oy: -y0 - ty0, code: img };
        }
      }
    }
    cache.set(rec, out); return out;
  };
}
// compare a rendered record with an atlas frame box ({x,y,w,h,ox,oy} in an RGBA image) through colour(code)
function atlasCompare(im, af, ap, colour) {
  let pixels = 0, bad = 0;
  for (let y = 0; y < af.h; y++) for (let x = 0; x < af.w; x++) {
    const mx = x - af.ox + im.ox, my = y - af.oy + im.oy;
    const c = mx >= 0 && my >= 0 && mx < im.w && my < im.h ? im.code[my * im.w + mx] : 0xFFFF;
    const q = ((af.y + y) * ap.width + af.x + x) * 4, a = ap.rgba[q + 3];
    if (c === 0xFFFF && !a) continue;
    pixels++;
    if (c === 0xFFFF || !a) { bad++; continue; }
    const rgb = colour(c); if (rgb[0] !== ap.rgba[q] || rgb[1] !== ap.rgba[q + 1] || rgb[2] !== ap.rgba[q + 2]) bad++;
  }
  // every opaque pixel of the render must lie inside the atlas box
  let outside = 0;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    if (im.code[y * im.w + x] === 0xFFFF) continue;
    const ax = x - im.ox + af.ox, ay = y - im.oy + af.oy;
    if (ax < 0 || ay < 0 || ax >= af.w || ay >= af.h) outside++;
  }
  return { pixels, bad: bad + outside };
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
  const C = config.fx || {};
  const R = opts.rom || require('../rom.cjs'), M = require('../export/lib/model.cjs');
  const P = {
    heroes: path.join(extract, 'heroes', 'heroes.json'), mech: path.join(extract, 'mechanics', 'mechanics.json'),
    weapons: path.join(extract, 'heroes', 'atlas-weapons.json'), weaponsPng: path.join(extract, 'heroes', 'atlas-weapons.png'),
    stagepal: path.join(extract, 'heroes', 'atlas-stagepal.json'), stagepalPng: path.join(extract, 'heroes', 'atlas-stagepal.png'),
    bubbles: path.join(extract, 'heroes', 'atlas-bubbles.json'), bubblesPng: path.join(extract, 'heroes', 'atlas-bubbles.png'),
    proj: path.join(extract, 'bosses', 'boss-projectiles.json'), projAtlas: path.join(extract, 'bosses', 'boss-projectiles-atlas.json'), projPng: path.join(extract, 'bosses', 'boss-projectiles-atlas.png'),
    config: path.join(__dirname, 'pack-config.json'),
  };
  const legacyItems = path.join(ROOT, 'arcade-items.js');   // optional cross-check only (retired in G8)
  const H = readJSON(P.heroes), MECH = readJSON(P.mech), PROJ = readJSON(P.proj);
  const inputs = Object.values(P).filter(p => fs.existsSync(p)).concat([path.join(ROOT, 'tools/re/export/lib/model.cjs'), path.join(ROOT, 'tools/re/rom.cjs')]);
  const report = { inputs: inputs.map(rel), warnings: [], groups: {}, atlasCheck: {}, sheets: {}, sizes: {}, empty: [] };
  const renderRec = makeRenderer(M, R);

  // 1. every record the family ships, by group (a record may sit in several groups)
  const groups = {};
  const add = (g, recs) => { const s = groups[g] = groups[g] || new Set(); for (const r of recs) if (r != null && r >= 0) s.add(r); };
  const V = Object.fromEntries(H.weaponVariants.map(v => [v.key, v]));
  for (const [sid, set] of Object.entries(H.weaponSets)) {
    const users = set.users.join('/');
    for (const an of set.anims || []) for (const f of an.frames || []) { add(`set ${sid} ${users}`, [f.rec, f.rec2]); }
  }
  for (const hj of H.heroes) for (const p of hj.holdPlacements) for (const wv of Object.values(p.weapons)) if (wv && wv.rec != null && !wv.hidden) add('holds', [wv.rec]);
  add('torch flame', rangeList(FLAME));
  for (const an of Object.values(H.companions.torchFlame.anims)) add('torch flame', an.frames.map(f => f.rec));
  add('bubbles', rangeList(BUBBLES));
  // effects: the PLAN ranges, every record a firing run spawned (pool A/D sequences), the bullet flight anims
  add('effects', rangeList(PLAN_EFFECTS));
  for (const per of Object.values(H.firing.perWeapon)) for (const r of Object.values(per)) for (const k of (r && r.spawnedPerKind) || []) add('effects', seqOf(k.recordSequence).map(s => s[0]));
  for (const row of H.firing.static.bulletTable.rows) add('effects', (row.flightAnim || []).map(a => a.rec));
  // items: food (17 subtypes), score items (16), the magazine; the named table (pack-config fx.items) points into them
  for (const f of MECH.items.food.list) add('items', f.records);
  for (const f of MECH.items.scoreItems.list) add('items', f.records);
  add('items', [MAGAZINE]);
  const table = itemTable(C.items, MECH);
  // boss projectiles (set 0x71408: MORGAN / TYROG throws, PLAN §3.1)
  for (const an of PROJ.animations) add('boss projectiles', an.frames.flatMap(f => [f.rec, f.rec2]));
  // WP-J (CAR-1): the Cadillac body / anim records, when its extraction has landed
  const cadFile = path.join(extract, 'heroes', 'cadillac', 'cadillac.json'), cadJson = fs.existsSync(cadFile) ? readJSON(cadFile) : null;
  if (cadJson) { add('cadillac', cadRecords(cadJson)); inputs.push(cadFile); }
  // the records HeroRig draws from this family (ROM_HEROES.weaponRecs) must all be here
  const heroesFile = path.join(out, 'sprite-data-heroes.js'), heroesFam = fs.existsSync(heroesFile) ? loadFamily(heroesFile, 'heroes', emit) : null;
  if (heroesFam && Array.isArray(heroesFam.weaponRecs)) add('heroes weaponRecs', heroesFam.weaponRecs);

  // 2. render; records that render empty are dropped (logged)
  const all = sortNum(Object.values(groups).flatMap(s => [...s]));
  const images = {};
  for (const rec of all) { const im = renderRec(rec); if (im) images[rec] = im; else report.empty.push(rec); }
  for (const [g, s] of Object.entries(groups)) report.groups[g] = { records: s.size, shipped: [...s].filter(r => images[r]).length, ranges: ranges([...s]) };
  if (heroesFam) {
    const miss = heroesFam.weaponRecs.filter(r => !images[r]);
    if (miss.length) throw new Error(`sprites-fx: ROM_HEROES.weaponRecs records render empty: ${miss.slice(0, 20).join(',')}`);
  }

  // 3. verify against the extract atlases
  const set0 = R.paletteSet(0), rowRGB = palettes.rowRGB;
  const rgbOf = c24 => [(c24 >> 16) & 255, (c24 >> 8) & 255, c24 & 255];
  const pins = C.pins || {}, homeRows = { 28: (pins.yoroi && pins.yoroi.row) != null ? pins.yoroi.row : 488, 30: (pins.bknife && pins.bknife.row) != null ? pins.bknife.row : 29 };
  const homeColour = c => { const s = c >> 4, p = c & 15; return homeRows[s] != null ? rgbOf(rowRGB(homeRows[s])[p]) : set0[s][p]; };
  const check = (name, atlasJson, atlasPng, colourFor) => {
    const aj = readJSON(atlasJson), ap = png.read(atlasPng), chk = { frames: aj.frames.length, compared: 0, pixels: 0, mismatches: 0, missing: [], bad: [] };
    for (const af of aj.frames) {
      const im = images[af.rec]; if (!im) { chk.missing.push(af.rec); continue; }
      const r = atlasCompare(im, af, ap, colourFor(af)); chk.compared++; chk.pixels += r.pixels; chk.mismatches += r.bad; if (r.bad) chk.bad.push(af.rec);
    }
    report.atlasCheck[name] = { frames: chk.frames, compared: chk.compared, pixels: chk.pixels, mismatches: chk.mismatches, missing: chk.missing.length ? ranges(chk.missing) : '', bad: chk.bad.length ? ranges(chk.bad) : '' };
    return chk;
  };
  const cw = check('atlas-weapons', P.weapons, P.weaponsPng, () => homeColour);
  const cs = check('atlas-stagepal', P.stagepal, P.stagepalPng, af => c => { const s = c >> 4, p = c & 15; return s === af.slot ? rgbOf(rowRGB(af.romRow)[p]) : homeColour(c); });
  const cb = check('atlas-bubbles', P.bubbles, P.bubblesPng, () => c => set0[c >> 4][c & 15]);
  const projRows = (PROJ.palette && PROJ.palette.objSlotToRomRow) || null;
  const cp = fs.existsSync(P.projAtlas) ? check('boss-projectiles-atlas', P.projAtlas, P.projPng, () => c => { const s = c >> 4, p = c & 15; return projRows ? rgbOf(rowRGB(projRows[s])[p]) : set0[s][p]; }) : null;
  for (const [k, ch] of [['atlas-weapons', cw], ['atlas-stagepal', cs], ['atlas-bubbles', cb], ['boss-projectiles-atlas', cp]]) {
    if (!ch) continue;
    if (ch.mismatches) throw new Error(`sprites-fx: ${k}: ${ch.mismatches} px differ (records ${ranges(ch.bad)})`);
    if (ch.missing.length) throw new Error(`sprites-fx: ${k}: records ${ranges(ch.missing)} are not shipped`);
  }
  // optional cross-check with the legacy arcade-items.js (absent after G8; never changes the output): its 28 boxes
  // re-render from the ROM records it names (renderer check), and its heal/score/kind equal the frozen table
  if (fs.existsSync(legacyItems)) {
    const today = loadItems(legacyItems);
    const chk = report.atlasCheck['arcade-items.js'] = checkItems(today, renderRec, set0);
    if (chk.mismatches) report.warnings.push(`arcade-items.js cross-check: ${chk.mismatches} px differ (${chk.bad.join(',')})`);
    chk.values = itemValueCheck(today, table);
    if (chk.values.differ.length) report.warnings.push(`arcade-items.js cross-check: heal/score/kind differ from pack-config fx.items: ${chk.values.differ.join('; ')}`);
  } else report.atlasCheck['arcade-items.js'] = { skipped: 'arcade-items.js not present (retired in G8); pack-config fx.items is the source' };

  // 4. pack and encode the sheet
  const recs = Object.keys(images).map(Number).sort((a, b) => a - b);
  const items = recs.map(r => ({ id: r, w: images[r].w, h: images[r].h }));
  const sheetCfg = (config.build && config.build.sheet) || { max: 1024, pad: 1 };
  const pk = atlas.pack(items, { max: sheetCfg.max || 1024, pad: sheetCfg.pad == null ? 1 : sheetCfg.pad, sort: 'height' });
  const pc = atlas.check(pk, items, { max: sheetCfg.max || 1024, pad: sheetCfg.pad == null ? 1 : sheetCfg.pad });
  if (!pc.ok) throw new Error(`sprites-fx: packing: ${pc.errors.slice(0, 3).join('; ')}`);
  const sheets = {}, rect = {}, vis = {};
  const slotsUsed = new Set();
  pk.sheets.forEach((sh, si) => {
    const id = si === 0 ? 'items' : `items${si + 1}`, W = sh.w, Hh = sh.h, px = new Uint8Array(W * Hh * 4), view = new Uint8Array(W * Hh * 4), rc = {};
    for (const p of sh.places) {
      const im = images[p.id];
      for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
        const c = im.code[y * im.w + x]; if (c === 0xFFFF) continue;
        const q = ((p.y + y) * W + p.x + x) * 4, rgb = homeColour(c); slotsUsed.add(c >> 4);
        if (rgba) { px[q] = rgb[0]; px[q + 1] = rgb[1]; px[q + 2] = rgb[2]; } else { px[q] = c >> 4; px[q + 1] = c & 15; px[q + 2] = 0; }
        px[q + 3] = 255; view[q] = rgb[0]; view[q + 1] = rgb[1]; view[q + 2] = rgb[2]; view[q + 3] = 255;
      }
      rc[p.id] = [p.x, p.y, im.w, im.h, im.ox, im.oy];
    }
    const buf = png.encode({ width: W, height: Hh, rgba: px, palette: true }), dec = png.decode(buf);
    if (!png.equalVisible(dec, { width: W, height: Hh, rgba: px })) throw new Error(`sprites-fx: sheet ${id} does not round-trip`);
    sheets[id] = { png: png.dataURL(buf), w: W, h: Hh, sum: png.fnvIndexed(dec.rgba).toString(16) };
    rect[id] = rc; vis[id] = { w: W, h: Hh, rgba: view };
    report.sheets[id] = { w: W, h: Hh, records: sh.places.length, pngBytes: buf.length, fill: r4(sh.places.reduce((n, p) => n + p.w * p.h, 0) / (W * Hh)) };
  });
  if (pk.sheets.length > 1) report.warnings.push(`${pk.sheets.length} sheets (PLAN §5.2 expects one)`);

  // 5. palette rows and maps: every 0x8E8E area page (live rows from heroes.json stagePalettes, which carry the rows of
  //    the scrolled-into areas), the home map, and the projectile override maps; slots the family never uses are null
  const used = [...slotsUsed].sort((a, b) => a - b);
  const rows = {}, maps = {};
  const putRow = r => { if (rows[r] == null) rows[r] = rowRGB(r); return r; };
  const mapOf = list => Array.from({ length: 32 }, (_, s) => (slotsUsed.has(s) && list[s] != null ? putRow(list[s]) : null));
  const live = {}; for (const a of H.stagePalettes.areas) live[`S${a.episode}A${a.area}`] = a.rows;
  for (let ep = 1; ep <= 8; ep++) for (let area = 0; area < 4; area++) {
    const key = `S${ep}A${area}`; let list = live[key];
    if (!list) { try { list = palettes.objMap(ep, area); } catch (e) { list = null; } }
    if (list) maps[key] = mapOf(list);
  }
  maps.home = mapOf(Array.from({ length: 32 }, (_, s) => (homeRows[s] != null ? homeRows[s] : s)));
  const objPages = (C.objPages || ['S1A0', 'S3A0', 'S2A0', 'S8A1', 'S7A1', 'S8A2', 'S8A3']).slice();
  for (const k of objPages) if (!maps[k]) throw new Error(`sprites-fx: objPage ${k} has no 0x8E8E map`);

  // 6. data
  const weapon = weaponIndex(H, V, images);
  const effects = effectIndex(H, images);
  const torchFlame = { burning: framesOf(H.companions.torchFlame.anims.burning).map(f => f[0]), running: framesOf(H.companions.torchFlame.anims.running).map(f => f[0]), timing: 'ROM_HEROES.fx.torchFlame (KI6: offsets, one-frame lag, depth alternation)' };
  const bubbles = bubbleIndex(H, readJSON(P.bubbles));
  const containers = containerIndex(H, images);
  const props = {}; for (const [k, v] of Object.entries(PROPS)) props[k] = v ? Object.assign({ rec: containers[v.container].rec }, v) : null;
  const itemData = itemIndex(MECH, table, images);
  const bossProjectiles = projectileIndex(PROJ, images);
  const rom = (() => { try { return (lib.manifest || require('./manifest.cjs')).romSha1(); } catch (e) { return null; } })();
  const fam = {
    v: 1, family: 'fx', mode: rgba ? 'rgba' : 'indexed',
    build: { from: ['work/re/extract/heroes/heroes.json', 'work/re/extract/heroes/atlas-weapons.png', 'work/re/extract/heroes/atlas-stagepal.png', 'work/re/extract/heroes/atlas-bubbles.png', 'work/re/extract/mechanics/mechanics.json', 'work/re/extract/bosses/boss-projectiles.json', 'tools/re/build/pack-config.json (fx)'],
      md5: { heroes: md5(P.heroes), mechanics: md5(P.mech), bossProjectiles: md5(P.proj) }, tool: 'tools/re/build-game-assets.cjs sprites fx (tools/re/build/sprites-fx.cjs)', rom },
    sheets, rect,
    pal: { rows, maps, home: 'home', slots: used },
    objPages,
    weapon, effects, torchFlame, bubbles, containers, props, items: itemData, bossProjectiles,
    // USER DECISION (HEROES O3 over D15): an empty gun is thrown at the enemy; the flight art is the gun's fast spin
    // (weapon.<t>.fastSpin), it lands on its ground record (weapon.<t>.ground); flight numbers in ROM_HEROES.fx.hurl
    hurl: { weapons: FIREARMS.slice(), spin: 'weapon.<type>.fastSpin', ground: 'weapon.<type>.ground', timing: 'ROM_HEROES.fx.hurl', note: 'user decision: empty guns are thrown at the enemy (HEROES O3), the arcade discard (D15) stays data in ROM_HEROES.fx.discard' },
    cadillac: null,
    units: { space: 'native left-facing object space, x right, y down; (ox, oy) = object origin inside the box', time: '60 Hz frames', pair: '[rec, dur]', colour: 'pal.maps[objPage] (0x8E8E area page of the chapter), home = B. KNIFE E2a2 row 29 and YOROI E1a1 row 488 (KI7)' },
    notes: {
      timing: 'weapon and effect timing (shot speeds, lives, offsets, fuses, flights) is ROM_HEROES.weapon.* / ROM_HEROES.fx.* (HEROES §4.2); this family ships the art and the names',
      cadillac: 'fx.cadillac is filled by WP-J (tools/re/export/cadillac.cjs, work/re/extract/heroes/cadillac/) through this builder; until then the KI12 fallback ships (vector car, ROM driver main:29)',
      props: 'mission objects (pod, valve, tuner, pylon, beacon, gate, cargo, vents, wheels, chains) have no identified ROM object record and stay code-drawn (PLAN §4.1)',
      containers: 'KI9: the carry roles use containerBySubtype 0..4; YOROI / TIYA are breakable only (heroes.json containersNotCarried)',
    },
  };
  if (cadJson) fam.cadillac = cadillacEntry(cadJson, images);
  report.acceptance = acceptanceList(fam, images);
  const failed = report.acceptance.filter(a => !a.ok);
  if (failed.length) throw new Error(`sprites-fx: acceptance: ${failed.map(a => a.what).join('; ')}`);
  const file = path.join(out, 'sprite-data-fx.js');
  const res = emit.module(file, "SPRITE_DATA.add('fx',", fam);
  report.sizes['sprite-data-fx.js'] = res.bytes;
  const budget = (config.budgets && config.budgets.files && config.budgets.files['sprite-data-fx.js']) || 0.35 * 1048576;
  if (res.bytes > budget) report.warnings.push(`sprite-data-fx.js is ${res.bytes} bytes > ${budget} budget`);
  log(`sprites fx: ${Object.entries(report.sheets).map(([k, s]) => `${k} ${s.w}x${s.h} ${s.records} rec (${s.fill} fill, ${s.pngBytes} B png)`).join(', ')}; ${(res.bytes / 1048576).toFixed(3)} MB (budget ${(budget / 1048576).toFixed(3)})`);
  log(`sprites fx: atlas check ${Object.entries(report.atlasCheck).map(([k, c]) => (c.skipped ? `${k} skipped` : `${k} ${c.compared}/${c.frames} frames, ${c.mismatches} px off`)).join('; ')}`);
  { const v = report.atlasCheck['arcade-items.js'] && report.atlasCheck['arcade-items.js'].values; if (v) log(`sprites fx: items: ${Object.keys(itemData.frames).length} names from pack-config fx.items; legacy arcade-items.js values ${v.differ.length ? 'DIFFER' : 'equal'} (${v.names} names), records moved to the ROM item each picture shows: ${v.recMoved.join(', ')}`); }
  if (report.empty.length) log(`sprites fx: ${report.empty.length} listed records render empty and are skipped: ${ranges(report.empty)}`);
  for (const w of report.warnings) log(`sprites fx: WARN ${w}`);
  const files = [file];

  // 7. review images (work/, git-ignored)
  const isRoot = path.resolve(out) === path.resolve(ROOT);
  if (opts.review !== false && isRoot) {
    const dir = path.join(ROOT, 'work', 're', 'build', 'sheets'); fs.mkdirSync(dir, { recursive: true });
    for (const [id, v] of Object.entries(vis)) png.write(path.join(dir, `fx-${id}.png`), { width: v.w, height: v.h, rgba: v.rgba });
    try { report.contact = contactSheet({ fam, images, homeColour, png, out: path.join(ROOT, 'work', 're', 'pack', 'fx-contact.png') }); log(`sprites fx: contact sheet ${rel(report.contact)}`); }
    catch (e) { report.warnings.push(`contact sheet: ${e.message}`); log(`sprites fx: WARN contact sheet ${e.stack}`); }
  }
  report.summary = { sheets: report.sheets, bytes: res.bytes, records: recs.length, slots: used, atlasCheck: report.atlasCheck, empty: ranges(report.empty), warnings: report.warnings.length };
  return { files, report };
}

// ------------------------------------------------------------------------------------------------ inputs
function loadFamily(file, name, emit) {
  try { const w = emit.load(file); const f = w.SPRITE_DATA && w.SPRITE_DATA.families; return f ? f[name] : null; } catch (e) { return null; }
}
function loadItems(file) {
  if (!fs.existsSync(file)) return { frames: {}, sheet: null };
  const w = { }; w.window = w; vm.createContext(w); vm.runInContext(fs.readFileSync(file, 'utf8'), w, { filename: file });
  const A = w.ARCADE_ITEMS || { frames: {} };
  return { frames: A.frames || {}, sheet: A.sheet || null };
}
// cross-check with the legacy ARCADE_ITEMS sheet: every frame box must equal the ROM record it names (tight box)
// coloured with set 0. Six records whose blocks use the effect slots 5/9 (2673, 2675, 2678, 2680, 2775, the magazine
// 2130) were coloured with slot 0 (Jack's row) by the legacy sheet; they match that way exactly and are listed as
// `legacySlot0`. The legacy names sit one record off for most foods (MECHANICS §4: 11/28 agree), which is why the
// shipped names come from pack-config fx.items; this check only validates the renderer on the legacy boxes.
function checkItems(today, renderRec, set0) {
  const png = require('./png.cjs');
  const out = { frames: Object.keys(today.frames).length, compared: 0, pixels: 0, mismatches: 0, bad: [], legacySlot0: [] };
  if (!today.sheet) return out;
  const ap = png.fromDataURL(today.sheet);
  const diff = (im, f, slot) => {
    let px = 0, bad = 0;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const c = im.code[y * im.w + x], q = ((f.y + y) * ap.width + f.x + x) * 4, a = ap.rgba[q + 3];
      if (c === 0xFFFF && !a) continue;
      px++;
      if (c === 0xFFFF || !a) { bad++; continue; }
      const rgb = set0[slot == null ? c >> 4 : slot][c & 15]; if (rgb[0] !== ap.rgba[q] || rgb[1] !== ap.rgba[q + 1] || rgb[2] !== ap.rgba[q + 2]) bad++;
    }
    return { px, bad };
  };
  for (const [name, f] of Object.entries(today.frames)) {
    const im = renderRec(f.rec); if (!im) { out.bad.push(`${name}:empty`); out.mismatches++; continue; }
    out.compared++;
    if (im.w !== f.w || im.h !== f.h) { out.mismatches += Math.max(1, Math.abs(im.w * im.h - f.w * f.h)); out.bad.push(`${name}:size ${im.w}x${im.h} vs ${f.w}x${f.h}`); continue; }
    const d = diff(im, f, null); out.pixels += d.px;
    if (!d.bad) continue;
    if (!diff(im, f, 0).bad) { out.legacySlot0.push(`${name}:${f.rec}`); continue; }
    out.mismatches += d.bad; out.bad.push(`${name}:${d.bad}px`);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ indices
function weaponIndex(H, V, images) {
  const out = {};
  const recsOf = an => (an && an.frames ? an.frames.map(f => f.rec) : []);
  for (const t of WEAPON_TYPES.concat(EXTRA_VARIANTS)) {
    const v = V[t]; if (!v) throw new Error(`sprites-fx: weapon variant ${t} missing in heroes.json`);
    const set = H.weaponSets[v.set], W = H.weapons.find(x => x.key === (v.weapon || t));
    const d = { set: v.set, slot: v.slot, code: v.cls, name: W ? W.name : null, romId: W ? W.id : null };
    if (!EXTRA_VARIANTS.includes(t) || t.startsWith('stone-')) {
      d.rot = Array.from({ length: 16 }, (_, k) => (set.anims[k] && set.anims[k].frames ? set.anims[k].frames[0].rec : null));
      d.ground = uniq(recsOf(set.anims[17]));
      d.groundAnim = framesOf(set.anims[17]);
    }
    if (!t.startsWith('stone-') && !EXTRA_VARIANTS.includes(t)) d.fastSpin = framesOf(set.anims[16]);
    if (t === 'dynamite' && set.anims[18]) d.fuse = framesOf(set.anims[18]);
    if (t === 'grenade' && set.anims[18]) d.pin = framesOf(set.anims[18]);
    if (FIREARMS.includes(t)) { d.empty = 'hurl'; d.hurl = { spin: d.fastSpin.map(f => f[0]), ground: d.ground[0] }; }
    if (t === 'rifle') d.emptyPose = 'rifle-empty';
    if (t === 'm16') d.emptyPose = 'm16-empty';
    if (t === 'torch') d.flame = 'torchFlame';
    if (EXTRA_VARIANTS.includes(t)) d.of = v.weapon;
    // the set's anims: 0-15 are the tumbles that start at rotation k and run to the last rotation (anim k = rot[k..15],
    // checked), 16 the fast spin, 17 the ground record; anims past 17 (fuse, pin, the empty-pose rotations) and any
    // anim that breaks the tumble rule are listed as [rec, dur] under anims[index]
    if (d.rot) {
      const durs = uniq((set.anims || []).slice(0, 16).flatMap(an => framesOf(an).map(f => f[1])));
      d.rotDur = durs.length === 1 ? durs[0] : durs;
      d.anims = {};
      (set.anims || []).forEach((an, k) => {
        const f = framesOf(an); if (!f.length || k === 16 || k === 17) return;
        const tumble = k < 16 && f.length === 16 - k && f.every((x, i) => x[0] === d.rot[k + i]);
        if (!tumble) d.anims[k] = f;
      });
    }
    if (t === 'rifle-empty' || t === 'm16-empty') d.note = `pose slot ${v.slot} of set ${v.set}: the hold tables pick its records (ROM_HEROES.hero.<id>.hold['${t}'])`;
    for (const r of [...(d.rot || []), ...(d.ground || []), ...((d.fastSpin || []).map(f => f[0]))]) if (r != null && !images[r]) throw new Error(`sprites-fx: weapon ${t} record ${r} not rendered`);
    out[t] = d;
  }
  return out;
}
function effectIndex(H, images) {
  const PW = H.firing.perWeapon, ST = H.firing.static, kinds = (w, h = 'jack') => (PW[w] && PW[w][h] && PW[w][h].spawnedPerKind) || [];
  const BT = Object.fromEntries(ST.bulletTable.rows.map(r => [parseInt(r.subtype, 16), r]));
  const fx = (w, sub) => kinds(w).find(k => k.pool === 'D' && k.type === '0x4' && k.sub === sub && (k.delayAfterShot.mode | 0) <= 1);
  const seqs = k => (k ? seqOf(k.recordSequence) : []);
  const e = { muzzle: {}, smoke: {}, sparks: {}, shot: {} };
  const flashSub = { gun: '0xF', rifle: '0x10', uzi: '0x12', m16: '0x12', shotgun: '0x11', bazooka: '0x13' };
  for (const t of FIREARMS) {
    e.muzzle[t] = seqs(fx(t, flashSub[t]));
    const sm = fx(t, '0x6') || fx(t, '0x9'); e.smoke[t] = seqs(sm);
    const sp = kinds(t).find(k => k.pool === 'D' && k.type === '0x7C'); e.sparks[t] = seqs(sp);
    const proj = kinds(t).find(k => k.pool === 'A' && ['0xC', '0x28', '0x1C'].includes(k.type));
    if (proj && proj.type === '0xC') { const row = BT[parseInt(proj.sub, 16)]; e.shot[t] = row ? row.flightAnim.map(a => [a.rec, a.dur]) : seqs(proj); }
    else if (proj && proj.type === '0x28') e.shot[t] = [[2138, 1], [3361, 1], [3362, 1], [3363, 1]];
    else if (proj) e.shot[t] = seqs(proj).filter(s => s[0] >= 0);
  }
  e.backBlast = seqs(fx('bazooka', '0x14'));
  const cas = kinds('rifle').find(k => k.type === '0x84'); e.casing = seqs(cas).slice(0, 3);
  const imp = kinds('gun').find(k => k.type === '0x4' && k.sub === '0x0'); e.impact = imp ? seqs(imp).filter(s => s[0] >= 1405) : [[1405, 2], [1406, 3], [1407, 3]];
  const gr = kinds('grenade').find(k => k.pool === 'A' && k.type === '0x4'); e.explosion = seqs(gr).filter(s => s[0] >= 0);
  const boom = kinds('grenade').find(k => k.type === '0x4' && k.sub === '0x4'); e.boom = seqs(boom);
  const dyn = kinds('dynamite').find(k => k.pool === 'A' && k.type === '0x4'); e.dynamite = seqs(dyn).filter(s => s[0] >= 0);
  e.debris = sortNum(kinds('bazooka').filter(k => k.type === '0x54').flatMap(k => seqs(k).map(s => s[0]).filter(r => r >= 2835 && r <= 2840))).map(r => [r, 1]);
  e.smgSmoke = [fx('uzi', '0x9'), fx('uzi', '0xA')].filter(Boolean).flatMap(seqs);
  e.pellets = [[2138, 1], [3361, 1], [3362, 1], [3363, 1]];
  e.rocket = (e.shot.bazooka || []).slice();
  // every record named here must be on the sheet
  const missing = [];
  const walk = v => { if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') { if (!images[v[0]]) missing.push(v[0]); return; } if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(e);
  if (missing.length) throw new Error(`sprites-fx: effect records not rendered: ${ranges(missing)}`);
  for (const k of ['casing', 'impact', 'explosion', 'boom', 'dynamite', 'debris', 'smgSmoke', 'backBlast', 'pellets', 'rocket']) if (!e[k] || !e[k].length) throw new Error(`sprites-fx: effect group ${k} is empty`);
  for (const t of FIREARMS) if (!e.muzzle[t].length || !e.shot[t] || !e.shot[t].length) throw new Error(`sprites-fx: ${t} muzzle/shot art missing`);
  e.timing = 'ROM_HEROES.weapon.<t>.{flash, smoke, sparks, shot, casing, backBlast} and ROM_HEROES.fx.{casing, impact, explosion, boom, dynamite, debris, smgSmoke} (HEROES §7.4, §7.5)';
  return e;
}
function bubbleIndex(H, atlasJson) {
  const byRec = Object.fromEntries(atlasJson.frames.map(f => [f.rec, f]));
  const frames = {};
  for (const an of H.bubbles.anims) { const f = byRec[an.rec] || {}; frames[an.rec] = { text: an.text, hero: f.hero ? String(f.hero).toLowerCase() : null, use: f.use || null, subtype: an.subtype, dur: an.dur }; }
  for (const f of atlasJson.frames) if (!frames[f.rec]) frames[f.rec] = { text: f.text, hero: String(f.hero || '').toLowerCase() || null, use: f.use || null, subtype: f.subtype };
  const perHero = {};
  for (const ph of H.bubbles.perHero) perHero[HEROES[ph.id]] = { victory: ph.victory.map(b => b.rec), teamUp: ph.teamUp ? ph.teamUp.rec : null };
  return { frames, perHero, placement: { up: 96, mirrored: false, life: 120, note: 'spawned at the hero x, 96 px above the feet, same depth, never mirrored; 120 frames (atlas-bubbles placement/timing)' } };
}
function containerIndex(H, images) {
  const out = {};
  for (const c of CONTAINERS) {
    const set = H.weaponSets[c.set]; if (!set) throw new Error(`sprites-fx: container set ${c.set} missing`);
    const anims = set.anims.map(an => framesOf(an));
    const first = anims.find(a => a.length && images[a[0][0]]);
    out[c.key] = { name: c.name, set: c.set, sub: c.sub, rec: first ? first[0][0] : null, anims, carried: !['armor', 'tire'].includes(c.key), breakable: true,
      note: 'anim 0 = standing (the prop as placed), 1 = lying / thrown, 2+ = rolling or broken frames of the set (heroes.json weaponSets)' };
  }
  return out;
}
// pack-config fx.items -> {name: {rec, score, kind, heal, rom}}: each name draws a frame of the ROM food / score
// subtype (or the magazine) it names in `sub`; heal / score / kind are today's game values (polish.cjs L91-96)
function itemTable(cfg, MECH) {
  if (!cfg || typeof cfg !== 'object') throw new Error('sprites-fx: pack-config.json fx.items (the named item table) is missing');
  const food = MECH.items.food.list, score = MECH.items.scoreItems.list, out = {};
  for (const name of Object.keys(cfg).sort()) {
    if (name.startsWith('_')) continue;
    const e = cfg[name], m = /^(food|score) (\d+)$/.exec(e.sub || '');
    let rom;
    if (e.sub === 'magazine') rom = { kind: 'magazine', records: [MAGAZINE] };
    else if (m) {
      const x = (m[1] === 'food' ? food : score).find(v => v.subtype === +m[2]);
      if (!x) throw new Error(`sprites-fx: fx.items.${name}: ${e.sub} is not a ROM item subtype (mechanics.json items)`);
      rom = m[1] === 'food' ? { kind: 'food', subtype: x.subtype, heal: x.heal, scoreAtFullHp: x.scoreAtFullHp, records: x.records.slice() }
        : { kind: 'score', subtype: x.subtype, points: x.points, records: x.records.slice() };
    } else throw new Error(`sprites-fx: fx.items.${name}: sub '${e.sub}' is not 'food N', 'score N' or 'magazine'`);
    if (!rom.records.includes(e.rec)) throw new Error(`sprites-fx: fx.items.${name}: rec ${e.rec} is not a frame of ${e.sub} (${rom.records.join(',')})`);
    if (typeof e.score !== 'number' || !e.kind) throw new Error(`sprites-fx: fx.items.${name}: score and kind are required`);
    if (e.kind === 'food' && typeof e.heal !== 'number') throw new Error(`sprites-fx: fx.items.${name}: a food needs heal`);
    out[name] = { rec: e.rec, score: e.score, kind: e.kind, heal: e.heal == null ? null : e.heal, rom };
  }
  return out;
}
// the legacy table's heal/score/kind against the frozen table (cross-check while arcade-items.js exists)
function itemValueCheck(today, table) {
  const names = uniq(Object.keys(today.frames).concat(Object.keys(table))).sort();
  const differ = [], recMoved = [];
  for (const n of names) {
    const a = today.frames[n], b = table[n];
    if (!a || !b) { differ.push(`${n}: only in ${a ? 'arcade-items.js' : 'pack-config'}`); continue; }
    for (const k of ['heal', 'score', 'kind']) if ((a[k] == null ? null : a[k]) !== (b[k] == null ? null : b[k])) differ.push(`${n}.${k} ${a[k]} vs ${b[k]}`);
    if (a.rec !== b.rec) recMoved.push(`${n} ${a.rec}->${b.rec}`);
  }
  return { names: names.length, differ, recMoved };
}
function itemIndex(MECH, table, images) {
  const food = MECH.items.food.list, score = MECH.items.scoreItems.list;
  const frames = {};
  for (const [name, e] of Object.entries(table)) {
    if (!images[e.rec]) throw new Error(`sprites-fx: item ${name} record ${e.rec} not rendered`);
    const d = { rec: e.rec, score: e.score, kind: e.kind, rom: e.rom };
    if (e.heal != null) d.heal = e.heal;
    frames[name] = d;
  }
  return {
    frames,
    food: food.map(f => ({ subtype: f.subtype, heal: f.heal, scoreAtFullHp: f.scoreAtFullHp, records: f.records.slice() })),
    score: score.map(s => ({ subtype: s.subtype, points: s.points, records: s.records.slice() })),
    magazine: { rec: MAGAZINE, refill: Object.fromEntries(MECH.items.magazine.list.filter(m => m.refill).map(m => [m.weapon, m.refill])) },
    note: "frames: the 28 names of FOOD_WEIGHTS / BONUS_WEIGHTS + ammo (pack-config.json fx.items). rec = the still frame of the ROM item the name's picture shows (rom = that food / score subtype with its animation records; roast and barbecue share food 1, pouch is the gold coin, score 13); heal / score / kind are today's game values (polish.cjs L91-96), not the ROM's (rom.heal / rom.points)",
  };
}
function projectileIndex(PROJ, images) {
  const anims = {};
  for (const an of PROJ.animations) { const f = an.frames.map(x => [x.rec, x.dur]).filter(x => images[x[0]]); if (f.length) anims[an.index] = { name: an.name, f, loop: an.loopTo == null ? null : an.loopTo }; }
  return { set: PROJ.sets && PROJ.sets[0] ? PROJ.sets[0].set : '0x71408', anims, objects: (PROJ.objects || []).map(o => ({ pool: o.pool, type: o.type, handler: o.handler })), note: 'objects bosses throw or spit (MORGAN 0x110 / 0x68, TYROG 0x68); also in ROM_BOSSES.bodies["boss-projectiles"] with its palette' };
}
// WP-J (CAR-1): work/re/extract/heroes/cadillac/cadillac.json = {set, anims:{drive, steer, boost, wreck}, body:[rec…],
// seat:[dx,dy], driverClip:[x,y,w,h]} (PLAN §6 WP-J) -> fx.cadillac; its records go on the fx sheet
function cadRecords(c) { return (c.body || []).concat(...Object.values(c.anims || {}).map(a => (a || []).map(x => (Array.isArray(x) ? x[0] : x)))).filter(r => typeof r === 'number'); }
function cadillacEntry(c, images) {
  const missing = cadRecords(c).filter(r => !images[r]);
  if (missing.length) throw new Error(`sprites-fx: cadillac records render empty: ${missing.join(',')}`);
  return Object.assign({}, c);
}
// PLAN §6 WP-D acceptance, checked on the family about to be written
function acceptanceList(fam, images) {
  const on = r => r != null && !!images[r] && !!fam.rect.items[r];
  const all = l => l.length > 0 && l.every(on);
  const out = [];
  const t = (what, ok, detail) => out.push({ what, ok: !!ok, detail: detail || '' });
  for (const w of WEAPON_TYPES) {
    const d = fam.weapon[w];
    t(`${w}: ground, 16 rotations, fast spin`, d && all(d.ground) && d.rot.length === 16 && all(d.rot) && all((d.fastSpin || []).map(f => f[0])), d ? `ground ${d.ground.join(',')}, rot ${d.rot[0]}..${d.rot[15]}, fast spin ${(d.fastSpin || []).length}` : 'missing');
  }
  t('empty poses: rifle-empty / m16-empty pose slots (records via the hold tables) and the thrown-gun hurl art for every firearm', fam.weapon['rifle-empty'] && fam.weapon['m16-empty'] && FIREARMS.every(w => fam.weapon[w].empty === 'hurl' && all(fam.weapon[w].hurl.spin) && on(fam.weapon[w].hurl.ground)));
  const E = fam.effects, recs = l => (l || []).map(f => f[0]);
  t('muzzle flash, smoke, sparks and shot art for every firearm', FIREARMS.every(w => all(recs(E.muzzle[w])) && all(recs(E.shot[w]))) && FIREARMS.filter(w => w !== 'shotgun').every(w => all(recs(E.smoke[w]))));
  for (const k of ['casing', 'impact', 'explosion', 'boom', 'debris', 'dynamite', 'pellets', 'rocket', 'smgSmoke', 'backBlast']) t(`effect ${k}`, all(recs(E[k])), uniq(recs(E[k])).join(','));
  t('bullets: gun 2127, rifle/smg 3509-3511', on(2127) && [3509, 3510, 3511].every(on));
  t('dynamite fuse', all(recs(fam.weapon.dynamite.fuse)), recs(fam.weapon.dynamite.fuse).join(','));
  t('torch flame 1408-1417', all(fam.torchFlame.burning.concat(fam.torchFlame.running)) && fam.torchFlame.burning.length === 6 && fam.torchFlame.running.length === 4);
  t('bubbles 1593-1607', all(rangeList(BUBBLES)));
  t('containers drum, barrel, jerrycan, concrete, rock, YOROI, TIYA', CONTAINERS.every(c => on(fam.containers[c.key].rec)));
  const FOOD = ['hamburger', 'hotdog', 'pizza', 'salad', 'steak', 'barbecue', 'roast', 'lobster', 'sushi', 'cake', 'fries', 'pudding', 'parfait', 'donut', 'coffee', 'croissant', 'gum', 'chocolate'];
  const BONUS = ['sunglasses', 'necklace', 'ring', 'pouch', 'pearls', 'ammonite', 'skull', 'goldbar', 'diamond'];
  const F = fam.items.frames;
  t('items.frames: every FOOD_WEIGHTS / BONUS_WEIGHTS name and ammo, on the sheet', Object.keys(F).length === 28 && FOOD.concat(BONUS, ['ammo']).every(n => F[n] && on(F[n].rec)), `${Object.keys(F).length} names`);
  t('items.frames: each food name on a food subtype record, each bonus name on a score subtype record, ammo on the magazine (27/28 names on the 33 subtype animations)',
    FOOD.every(n => F[n].rom.kind === 'food' && F[n].rom.records.includes(F[n].rec)) && BONUS.every(n => F[n].rom.kind === 'score' && F[n].rom.records.includes(F[n].rec)) && F.ammo.rom.kind === 'magazine' && F.ammo.rec === MAGAZINE,
    FOOD.concat(BONUS).map(n => `${n} ${F[n].rom.kind} ${F[n].rom.subtype} ${F[n].rec}`).join(', '));
  t('items keep the game values: hamburger heal 48, barbecue/goldbar score 10000, ammo kind ammo', F.hamburger.heal === 48 && F.barbecue.score === 10000 && F.goldbar.score === 10000 && F.ammo.kind === 'ammo');
  t('33 ROM item subtypes (17 food + 16 score) with every record on the sheet', fam.items.food.length === 17 && fam.items.score.length === 16 && all(fam.items.food.flatMap(f => f.records).concat(fam.items.score.flatMap(x => x.records))));
  t('objPages S1A0 S3A0 S2A0 S8A1 S7A1 S8A2 S8A3 are maps', fam.objPages.every(k => Array.isArray(fam.pal.maps[k])) && fam.objPages.length === 7);
  t('KI7: B. KNIFE slot 30 -> row 29 in S2A2 / home, YOROI slot 28 -> row 488 in S1A1 / home', fam.pal.maps.S2A2[30] === 29 && fam.pal.maps.home[30] === 29 && fam.pal.maps.S1A1[28] === 488 && fam.pal.maps.home[28] === 488);
  return out;
}

// ------------------------------------------------------------------------------------------------ contact sheet
function contactSheet({ fam, images, homeColour, png, out }) {
  const D = require('../export/lib/draw.cjs');
  const rows = [];
  const W = 1500;
  const line = (label, recs) => rows.push({ label, recs: recs.filter(r => r != null && images[r]) });
  for (const [t, d] of Object.entries(fam.weapon)) {
    if (d.rot) line(`${t} rot`, d.rot);
    if (d.fastSpin) line(`${t} fast spin${FIREARMS.includes(t) ? ' (the thrown empty gun, user decision O3)' : ''}`, d.fastSpin.map(f => f[0]));
    if (d.ground) line(`${t} ground${d.fuse ? ' + fuse' : ''}`, d.ground.concat(d.fuse ? d.fuse.map(f => f[0]) : []));
  }
  for (const t of FIREARMS) line(`${t} muzzle / smoke / sparks / shot`, [...fam.effects.muzzle[t], ...fam.effects.smoke[t], ...fam.effects.sparks[t], ...fam.effects.shot[t]].map(f => f[0]));
  for (const k of ['casing', 'impact', 'explosion', 'boom', 'dynamite', 'debris', 'smgSmoke', 'backBlast', 'pellets', 'rocket']) line(k, uniq(fam.effects[k].map(f => f[0])));
  line('torch flame burning / running', fam.torchFlame.burning.concat(fam.torchFlame.running));
  line('bubbles', Object.keys(fam.bubbles.frames).map(Number));
  for (const [k, c] of Object.entries(fam.containers)) line(`container ${k} (${c.name})`, uniq(c.anims.flat().map(f => f[0])));
  const foodRecs = fam.items.food.flatMap(f => f.records), scoreRecs = fam.items.score.flatMap(s => s.records);
  line('food subtypes', foodRecs); line('score items', scoreRecs);
  line(`items.frames (${Object.keys(fam.items.frames).sort().join(' ')})`, Object.keys(fam.items.frames).sort().map(n => fam.items.frames[n].rec));
  for (const [i, a] of Object.entries(fam.bossProjectiles.anims)) line(`boss projectile ${i} ${a.name}`, uniq(a.f.map(f => f[0])));
  // layout
  const placed = []; let y = 6;
  for (const r of rows) {
    let x = 8, rowH = 0; y += 12; const start = y;
    for (const rec of r.recs) { const im = images[rec]; if (x + im.w + 4 > W) { x = 8; y += rowH + 6; rowH = 0; } placed.push({ rec, x: x + im.ox, y: y + im.oy, im }); x += im.w + 6; rowH = Math.max(rowH, im.h); }
    r.y = start - 11; y += rowH + 6;
  }
  const cv = new D.Canvas(W, y + 8, [24, 26, 30, 255]);
  for (const r of rows) cv.text(r.label.toUpperCase(), 8, r.y, [255, 230, 120]);
  for (const p of placed) {
    const im = p.im;
    for (let yy = 0; yy < im.h; yy++) for (let xx = 0; xx < im.w; xx++) { const c = im.code[yy * im.w + xx]; if (c === 0xFFFF) continue; cv.set(p.x - im.ox + xx, p.y - im.oy + yy, homeColour(c)); }
    cv.set(p.x, p.y, [255, 0, 255]);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  cv.png(out);
  return out;
}

module.exports = { build, makeRenderer, WEAPON_TYPES, CONTAINERS, PROPS, rangeList, ranges };

if (require.main === module) {
  const argv = process.argv.slice(2), outI = argv.indexOf('--out');
  const out = outI >= 0 ? path.resolve(argv[outI + 1]) : ROOT;
  const t0 = Date.now();
  const r = build({ out, rgba: argv.includes('--rgba'), log: (...a) => console.log(...a) });
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${r.files.map(rel).join(', ')}`);
}
