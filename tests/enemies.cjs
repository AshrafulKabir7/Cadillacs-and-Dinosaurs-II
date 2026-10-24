// tests/enemies.cjs — ENEMIES.md §8 checks (1)-(7) plus the WP-C data gates (PLAN §6 WP-C, §3.3).
// Run from the repo root:   node tests/enemies.cjs            (data checks in Node, then the browser checks if GAME_URL answers)
//                           node tests/enemies.cjs --node     (data checks only)
// Data checks (Node, no browser): (1) every ENEMY_KINDS state/attack resolves to a shipped ROM_ENEMIES anim for every
// variant, (5) chapter HP budgets within ±15 % of ENEMIES §2.6 (ch2 exempt: O12 is on since G8 and lifts it only to about 0.7, PLAN RC7), (7) every BOSS_DEFS move
// anim exists in ROM_BOSSES and every BOSS_DEFS body ships (RC11), plus sheet checksums, frame boxes, the KI13 TYROG maps,
// the Fessenden attach table, Morgan's throw frame, the Crown Engine bake and the boss palette acceptance.
// Browser checks (G4, against the PLAN §4.6 API): (2) walking FERRIS frames advance with distance, (3) a jab hits only on
// its active frame, (4) a knifer drops its knife on a knockdown and picks it back up, (6) no Math.random call is added in
// spawnEnemy/arrive, (8) every attack of TYROG and RAZOR's slash come in natural duels and a poacher rolls in once, (9) the poacher's aim is the windup and the round leaves on the fire frame. Until G4 lands they are reported as SKIP (ARCADE_STEP=G4 turns those SKIPs into failures).
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), vm = require('node:vm');
const A = require('./lib/arcade.cjs');
const ROOT = A.ROOT, rel = p => path.join(ROOT, p), exists = p => fs.existsSync(rel(p));
const NODE_ONLY = process.argv.includes('--node') || process.env.ENEMIES_NODE === '1';
const C = A.checks('enemies');

// ---------------------------------------------------------------- the shipped data in one sandbox (as the page loads it)
function sandbox(files) {
  const win = {}; win.window = win; win.globalThis = win; const ctx = vm.createContext(win);
  for (const f of files) if (exists(f)) vm.runInContext(fs.readFileSync(rel(f), 'utf8'), ctx, { filename: f, timeout: 60000 });
  return win;
}
// the generated boss bodies (tools/art/import-sprite.cjs: Sable, Crownback and his jet) load after the ROM family, as in play.html
const bossFiles = ['sprite-data-bosses.js', ...[1, 2, 3, 4, 5, 6].map(n => `sprite-data-bosses-ch${n}.js`), 'sprite-data-boss-sable.js', 'sprite-data-boss-crownback.js', 'sprite-data-boss-crownjet.js', 'sprite-data-boss-rook.js', 'sprite-data-boss-krag.js', 'sprite-data-boss-ironclub.js', 'sprite-data-boss-thorne.js', 'sprite-data-boss-glassback.js', 'sprite-data-boss-cinder.js', 'sprite-data-boss-overdrive.js', 'sprite-data-boss-cinderfx.js', 'sprite-data-boss-echo.js', 'sprite-data-boss-echoring.js', 'sprite-data-boss-engine.js', 'sprite-data-boss-enginefx.js'];
const W = sandbox(['combat-config.js', 'sprite-data-enemies.js', ...bossFiles, 'enemy-kinds.js', 'campaign.js']);
const FAM = (W.SPRITE_DATA && W.SPRITE_DATA.families) || {};
const EN = FAM.enemies || null;
const BO = (() => { const parts = Object.entries(FAM).filter(([k]) => k === 'bosses' || /^bosses-ch\d+$/.test(k)).map(([, f]) => f); if (!parts.length) return null; const v = { anims: {}, bodies: {}, frames: null, sheets: {}, rect: {}, pal: { rows: {}, maps: {} } }; for (const p of parts) { Object.assign(v.anims, p.anims); Object.assign(v.bodies, p.bodies); Object.assign(v.sheets, p.sheets); Object.assign(v.rect, p.rect); Object.assign(v.pal.rows, p.pal.rows); Object.assign(v.pal.maps, p.pal.maps); v.frames = v.frames && p !== FAM.bosses ? v.frames : p.frames;   /* the ROM family's frame list (a generated body's frames are local to its file) */ v.crownEngine = p.crownEngine || v.crownEngine; } return v; })();
const KINDS = W.ENEMY_KINDS, DEFS = W.BOSS_DEFS, CAMPAIGN = W.EDEN_CAMPAIGN;
const fmt = v => JSON.stringify(v);

// ================================================================ (1) ENEMY_KINDS -> ROM_ENEMIES
const G = require(rel('tools/re/build-game-assets.cjs'));
if (!KINDS || !EN) C.fail('G0', '(1) Every ENEMY_KINDS state and attack resolves to a ROM_ENEMIES anim for every variant', `missing: ${!KINDS ? 'enemy-kinds.js ' : ''}${!EN ? 'sprite-data-enemies.js' : ''}`);
else {
  // a: the build gate's resolver (array refs, set:i strings, variant filters, alt sub-tables)
  const r = G.checkAnimKeys({ kinds: KINDS, bosses: {}, enemies: { anims: EN.anims, types: EN.types }, bossFam: null });
  C.check('G0', '(1a) anim-keys resolver: every ENEMY_KINDS reference exists in ROM_ENEMIES.anims', r.ok, r.errors.slice(0, 6).join(' | '));
  // b: the runtime helper the engine will call (ENEMY_KINDS.stateAnim / resolve) for every kind x variant x state / attack
  const bad = [], ok = { n: 0 };
  for (const [kid, k] of Object.entries(KINDS)) {
    if (!k || typeof k !== 'object' || !k.variants || !k.type || k.hero) continue;
    for (const V of Object.keys(k.variants)) {
      const t = KINDS.table(kid, V), d = KINDS.variantData(kid, V);
      if (!d) { bad.push(`${kid}:${V} has no ROM_ENEMIES variant (type ${KINDS.typeOf(kid, V)})`); continue; }
      const refs = [];
      for (const [st, ref] of Object.entries(t.st || {})) { if (st === 'variants') continue; if ((t.st.variants || '').length && !t.st.variants.includes(V)) continue; [].concat(Array.isArray(ref) && Array.isArray(ref[0]) ? ref : [ref]).forEach((x, i) => refs.push([`st.${st}${i ? '#' + i : ''}`, x])); }
      for (const a of t.atk || []) { if (a.variants && !a.variants.includes(V)) continue; refs.push([`atk.${a.id}`, a.a]); if (a.pre) refs.push([`atk.${a.id}.pre`, a.pre]); }
      for (const [where, ref] of refs) {
        const key = KINDS.resolve(kid, V, ref); ok.n++;
        if (!key || !EN.anims[key]) { bad.push(`${kid}:${V} ${where} -> ${key || fmt(ref)}`); continue; }
        for (const [fid] of EN.anims[key].f) if (!EN.frames[fid]) bad.push(`${kid}:${V} ${where} ${key}: frame ${fid} missing`);
      }
    }
  }
  C.check('G0', `(1b) ENEMY_KINDS.resolve(): ${ok.n} kind x variant x state/attack refs land on shipped anims with shipped frames`, !bad.length, bad.slice(0, 8).join(' | '));
  // c: the CAMPAIGN §4.4 cast ids all resolve to a kind and a variant with ROM data
  const castBad = Object.entries(KINDS.CAST).filter(([, [k, v]]) => k !== 'mirror' && !KINDS.variantData(k, v)).map(([id]) => id);
  C.check('G0', '(1c) Every CAMPAIGN §4.4 cast id maps to a shipped kind variant', !castBad.length, castBad.join(', '));
  // d: knife, rifle, dynamite, parasite and chain objects named by the kinds ship
  const objs = []; for (const k of Object.values(KINDS)) if (k && typeof k === 'object') JSON.stringify(k, (key, v) => { if (typeof v === 'string' && /^0x[0-9A-F]+:\d+$/i.test(v)) objs.push(v); return v; });
  const missObj = [...new Set(objs)].filter(o => !EN.anims[o]);
  C.check('G0', `(1d) ${new Set(objs).size} object anims named in ENEMY_KINDS (knife, rifle, bombs, parasite, chain) ship`, !missObj.length, missObj.join(', '));
}

// ================================================================ (5) HP budgets per chapter
const CURRENT = [4853, 5888, 5641, 5372, 5945, 6576], EXEMPT = [1];
const POOLS = [
  { raider: ['ferris', 'gneiss'], knifer: ['blade'], gunner: ['poacherJ'], brute: ['blkElmer', 'hammerT'] },
  { raider: ['driver', 'ferris'], knifer: ['razor'], gunner: ['dyna', 'skinner'], brute: ['wrenchT', 'hammerT'], biker: ['ride', 'jump'] },
  { raider: ['gneiss', 'poacherJ'], knifer: ['blade'], gunner: ['skinner', 'gutter'], brute: ['hammerT', 'blkElmer'], raptor: ['hopper'] },
  { raider: ['gneiss', 'driver'], knifer: ['razor'], gunner: ['bomber', 'gutter'], brute: ['wrenchT', 'blkElmer'], mutant: ['bludge'], regent: ['tyrog'] },
  { raider: ['driver'], knifer: ['razor', 'knife'], gunner: ['gutter', 'bomber'], brute: ['lashT', 'blkElmer'], mutant: ['bludge'], regent: ['tyrog'], mirror: ['mirror'] },
  { raider: ['gneiss', 'driver'], knifer: ['razor', 'blade'], gunner: ['gutter', 'skinner'], brute: ['blkElmer'], mutant: ['bludge'], regent: ['tyrog'], mirror: ['mirror'] }];
function sectionCasts() { const out = {}, dir = rel('tools/re/levels'); if (!fs.existsSync(dir)) return out; for (const f of fs.readdirSync(dir).filter(x => /^ch\d\.json$/.test(x)).sort()) { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); for (const a of j.areas || []) for (const s of a.sections || []) if (s.cast) out[s.id] = s.cast; } return out; }
if (!KINDS || !EN || !CAMPAIGN) C.fail('G0', '(5) Regular HP budgets within ±15 % per chapter', 'enemy-kinds.js, sprite-data-enemies.js or campaign.js missing');
else {
  const casts = sectionCasts(), rows = [];
  CAMPAIGN.forEach((c, i) => {
    let sum = 0; const mix = {};
    for (const s of c.sections) { const pools = { ...POOLS[i], ...(casts[s.stage] || {}) };
      for (const e of s.enc) (e.w || []).forEach((w, wi) => w.forEach((kind, j) => { const pool = [].concat(pools[kind] || []), id = pool.length ? pool[(wi + j) % pool.length] : kind; mix[id] = (mix[id] || 0) + 1; const [k, v] = KINDS.CAST[id] || [kind, null]; sum += k === 'mirror' ? KINDS.K.MIRROR_HP : (KINDS.kindHp(k, v, i) || 0); })); }
    rows.push({ ch: i + 1, budget: sum, current: CURRENT[i], ratio: +(sum / CURRENT[i]).toFixed(3), mix });
  });
  const alt = KINDS.K.HP_USE === 'spec' ? 'tuned' : 'spec';
  rows.forEach((r, i) => { let a = 0; const c = CAMPAIGN[i]; for (const s of c.sections) { const pools = { ...POOLS[i], ...(casts[s.stage] || {}) }; for (const e of s.enc) (e.w || []).forEach((w, wi) => w.forEach((kind, j) => { const pool = [].concat(pools[kind] || []), id = pool.length ? pool[(wi + j) % pool.length] : kind, [k, v] = KINDS.CAST[id] || [kind, null]; if (k === 'mirror') { a += KINDS.K.MIRROR_HP; return; } const rom = KINDS.romHp(k, v, KINDS.K.lvl(i)); a += rom == null ? 0 : KINDS.K.HP(rom, 1, alt); })); } r.alt = +(a / r.current).toFixed(3); });
  rows.forEach(r => console.log(`      ch${r.ch} K.HP ('${KINDS.K.HP_USE}') budget ${r.budget} vs ${r.current} = ${r.ratio}${EXEMPT.includes(r.ch - 1) ? ' (exempt, O12 on)' : ''}; under '${alt}' ${r.alt}`));
  const out = rows.filter(r => !EXEMPT.includes(r.ch - 1) && Math.abs(r.ratio - 1) > 0.15).map(r => `ch${r.ch} ${r.ratio}`);
  C.check('G0', `(5) Regular HP budgets within ±15 % of ENEMIES §2.6 (K.HP '${KINDS.K.HP_USE}' = round(${KINDS.K.HP_A} + ${KINDS.K.HP_B} rom), ch2 exempt: O12 on, about 0.7)`, !out.length, out.join(', '));
  C.check('G0', '(5c) K.HP is the ENEMIES §0 DECISION formula 40 + 0.9 rom (a retune needs the user / G4)', KINDS.K.HP_USE === 'spec' && KINDS.K.HP_A === 40 && KINDS.K.HP_B === 0.9, `${KINDS.K.HP_USE} ${KINDS.K.HP_A} ${KINDS.K.HP_B}`);
  C.check('G0', '(5b) specification.cjs anchor: kindHp(brute, A) = HAMMER T. at LV 9 through K.HP', KINDS.kindHp('brute', 'A', 0) === KINDS.K.HP(KINDS.romHp('brute', 'A', 9)), `${KINDS.kindHp('brute', 'A', 0)}`);
  fs.mkdirSync(rel('tests/results'), { recursive: true }); fs.writeFileSync(rel('tests/results/enemies-budget.json'), JSON.stringify(rows, null, 1));
}

// ================================================================ (7) BOSS_DEFS -> ROM_BOSSES
if (!DEFS || !BO) C.fail('G0', '(7) Every boss move anim exists in ROM_BOSSES', `missing: ${!DEFS ? 'BOSS_DEFS ' : ''}${!BO ? 'sprite-data-bosses.js' : ''}`);
else {
  const r = G.checkAnimKeys({ kinds: {}, bosses: DEFS, enemies: EN ? { anims: EN.anims, types: EN.types } : null, bossFam: { anims: BO.anims, bodies: BO.bodies } });
  C.check('G0', `(7) Every BOSS_DEFS anim reference exists in ROM_BOSSES.anims (${r.info})`, r.ok, r.errors.slice(0, 6).join(' | '));
  // The boss rebuild: the ROM stand-in bodies of the rebuilt bosses (BUTCHER for Rook, MACK for Breakwater, SHIVAT for
  // Glassback, MORGAN for Cinder, VICE T. for Sable, the six-part FESSENDEN for Crownback) no longer ship
  // (tools/re/build/pack-config.json bosses.droppedBodies): each boss draws its generated body (sprite-data-boss-*.js).
  const roster = Object.values(DEFS).flatMap(b => [b.body, b.phase2 && b.phase2.body].filter(Boolean)).concat(['crownEngine']);
  const missing = roster.filter(id => !BO.bodies[id]);
  C.check('G0', `(7b) RC11: every BOSS_DEFS body and the Crown Engine ship (bossRoster ${roster.length} >= 7)`, !missing.length && roster.length >= 7, missing.join(', '));
  const banned = Object.keys(BO.bodies).filter(b => /hogg|morgue|slisaur|tyrog|fessenden-1/i.test(b));
  C.check('G0', '(7c) CAMPAIGN D5: HOGG, MORGUE, SLISAUR, FESSENDEN-1 and TYROG 2 are not shipped as bosses', !banned.length, banned.join(', '));
  const palBad = [];
  for (const [kid, d] of Object.entries(DEFS)) { const b = BO.bodies[d.body]; if (!b) continue; for (const name of [d.pal, d.ctx, d.palFallback].filter(Boolean)) if (!(b.pal && b.pal[name])) palBad.push(`${kid}: ${d.body} has no palette '${name}'`); if (!BO.pal.maps[b.pal[b.use]]) palBad.push(`${d.body}.use '${b.use}' has no map`); }
  C.check('G0', '(7d) Every BOSS_DEFS pal / ctx / palFallback names a shipped palette map of its body', !palBad.length, palBad.join(' | '));
  // Fessenden: six parts, every logged body frame has an attach row, order lists the six parts
  const stand = ['butcher', 'torikeratopss', 'arosaurus', 'morgan', 'richmond', 'fessenden', 'slice'].filter(b => BO.bodies[b]);
  C.check('G0', '(7e/7f) The rebuilt bosses\' ROM stand-in bodies (BUTCHER, MACK, SHIVAT, MORGAN, VICE T., SLICE, the six-part FESSENDEN) no longer ship', !stand.length, stand.join(', '));
  const ce = BO.crownEngine || BO.bodies.crownEngine;
  C.check('G0', '(7g) Crown Engine baked from the E8a3 cells: idle and cracked frames, crown palette, ~200x150', !!(ce && BO.frames[ce.frames.idle] && BO.frames[ce.frames.cracked] && BO.pal.maps[ce.pal.crown] && ce.w >= 150 && ce.w <= 320 && ce.h >= 90 && ce.h <= 170), ce ? `${ce.w}x${ce.h}` : 'none');
}

// ================================================================ data integrity of both families
const png = require(rel('tools/re/build/png.cjs'));
for (const [name, F] of [['enemies', EN], ['bosses', FAM.bosses || null]]) {
  if (!F) { C.skip('G0', `${name}: sheet checksums, frame boxes and palette maps`, `sprite-data-${name}.js not shipped`); continue; }
  const bad = [];
  for (const [id, sh] of Object.entries(F.sheets)) { const im = png.fromDataURL(sh.png); if (im.width !== sh.w || im.height !== sh.h) bad.push(`${id} size`); if (png.fnvIndexed(im.rgba).toString(16) !== String(sh.sum)) bad.push(`${id} sum`); let maxR = 0, maxG = 0; for (let q = 0; q < im.width * im.height; q++) if (im.rgba[q * 4 + 3]) { maxR = Math.max(maxR, im.rgba[q * 4]); maxG = Math.max(maxG, im.rgba[q * 4 + 1]); } if (F.mode === 'indexed' && (maxR > 31 || maxG > 15)) bad.push(`${id} not slot/pen indexed`); }
  for (const fr of F.frames) { const sh = F.sheets[fr[0]]; if (!sh || fr[1] + fr[3] > sh.w || fr[2] + fr[4] > sh.h) bad.push(`frame outside ${fr[0]}`); }
  for (const [k, m] of Object.entries(F.pal.maps)) { if (m.length !== 32) bad.push(`map ${k} length ${m.length}`); for (const e of m) if (!F.pal.rows[String(e)]) { bad.push(`map ${k} -> row ${e} missing`); break; } }
  C.check('G0', `${name}: ${Object.keys(F.sheets).length} sheets decode with their fnv sums, ${F.frames.length} frames inside their sheets, ${Object.keys(F.pal.maps).length} maps x 32 rows`, !bad.length, bad.slice(0, 6).join(' | '));
}
if (EN) {
  const tm = ['29', '30', '31'].map(s => EN.palMap[`kingkimo:A/${s}`]), rows = tm.map(k => k && EN.pal.maps[k]);
  const want = { 29: 113, 30: 30, 31: 114 }, okTy = rows.every((m, i) => m && m.every(e => e === want[29 + i]));
  C.check('G0', 'KI13: the TYROG maps are the S6A2 rows #113 / #30 / #114 for +0x23 slots 29 / 30 / 31 (never the pale S8A3 row)', okTy, fmt(tm));
  const lash = EN.pal.maps[EN.palMap['ishinage:L']];
  C.check('G0', 'KI17: LASH T. slot 23 = ROM row 63 (stage 2)', !!lash && lash[23] === 63, lash ? String(lash[23]) : 'no map');
  const gel = Object.keys(EN.palMap).filter(k => k.endsWith('/gel')).length;
  C.check('G0', `Every enemy variant carries a gel (clone dissolve) map (${gel})`, gel === Object.values(EN.types).reduce((n, t) => n + Object.keys(t.variants).length, 0), String(gel));
}
// the user-facing palette acceptance written by the bosses build (work/re/pack/bosses-report.json)
if (exists('work/re/pack/bosses-report.json')) {
  const rp = JSON.parse(fs.readFileSync(rel('work/re/pack/bosses-report.json'), 'utf8'));
  let er = null; try { er = JSON.parse(fs.readFileSync(rel('work/re/pack/enemies-report.json'), 'utf8')); } catch (e) { /* enemies not built */ }
  const HE = (() => { try { const w = sandbox(['sprite-data-heroes.js']); return w.SPRITE_DATA && w.SPRITE_DATA.families && w.SPRITE_DATA.families.heroes; } catch (e) { return null; } })();
  // the hand palettes of the dropped stand-ins (rook, cinder, sable, ironhide, verdant, slicevat) went with their bodies
  const nine = { crown: rp.palettes.crown, drowned: er && er.palettes && er.palettes.drowned,
    half: HE ? { ok: ['jack', 'hannah', 'mustapha', 'mess'].every(h => HE.pal.maps['half-' + h] && HE.pal.maps['hero-' + h]), note: 'WP-B row effect' } : null };
  const bad = Object.entries(nine).filter(([n, p]) => !(p && p.ok)).map(([n, p]) => `${n}${p ? '' : ' (missing)'}`);
  C.check('G0', `ENEMIES §6.1 palette acceptance for the sequel palettes still shipped (every colour a ROM colour, >= 6 pens changed vs every original, outline/eyes and the pixel-grown skin ramp kept, no ramp split): ${Object.keys(nine).join(', ')}`, !bad.length, bad.join(', '));
  // (the skin-ramp regression of Rook's and Sable's ROM stand-in palettes went with those bodies)
  const cfgP = JSON.parse(fs.readFileSync(rel('tools/re/build/pack-config.json'), 'utf8')).bosses.palettes, noWhy = [];
  for (const [n, p] of Object.entries(cfgP)) for (const [slot, sl] of Object.entries(p.slots || {})) for (const pen of sl.recolour || []) if (!(sl.why && sl.why[pen])) noWhy.push(`${n} ${slot}:${pen}`);
  C.check('G0', 'Every deliberate recolour of a kept pen in pack-config bosses.palettes carries its why (shown on boss-palettes.png)', !noWhy.length, noWhy.join(', '));
  const rb = rp.summary && rp.summary.readBack;
  C.check('G0', `Boss frames re-render identically to the extract atlases (${rb ? `${rb.identical}/${rb.checked}` : '?'})`, !!rb && rb.different === 0 && rb.checked > 0, fmt(rb));
} else C.skip('G0', 'Boss palette acceptance and read-back', 'run node tools/re/build-game-assets.cjs sprites bosses (writes work/re/pack/bosses-report.json)');
if (exists('work/re/pack/enemies-report.json')) {
  const rp = JSON.parse(fs.readFileSync(rel('work/re/pack/enemies-report.json'), 'utf8')), rb = rp.summary.readBack;
  C.check('G0', `Enemy frames re-render identically to the extract atlases, every difference explained by the exporter's two verified semantics errors (${rb.identical}/${rb.checked} identical, ${rb.explained}/${rb.different} explained)`, rb.different === rb.explained && rb.noRef === 0, fmt(rb));
}

// ================================================================ attack records, hit windows, speeds (KI14, PLAN §4.1/§4.4)
if (KINDS && EN) {
  const resolveObj = (V, o) => (o == null ? [] : typeof o === 'string' ? [o] : Array.isArray(o) ? o : o[V] ? [o[V]] : Object.values(o));
  const noAtk = [], noHit = [], srcs = {}; let n = 0;
  for (const [kid, k] of Object.entries(KINDS)) {
    if (!k || typeof k !== 'object' || !k.variants || !k.type || k.hero || k.parked || k.scenery) continue;
    for (const V of Object.keys(k.variants)) {
      const t = KINDS.table(kid, V); if (!t || !KINDS.variantData(kid, V)) continue;
      for (const a of t.atk || []) {
        if (a.variants && !a.variants.includes(V)) continue;
        const key = KINDS.resolve(kid, V, a.a), an = key && EN.anims[key]; n++;
        if (!an || !an.atk || !Number.isInteger(an.atk.tbl) || !an.atk.src) noAtk.push(`${kid}:${V} ${a.id} (${key})`); else srcs[an.atk.src.split(/[ :]/)[0]] = (srcs[an.atk.src.split(/[ :]/)[0]] || 0) + 1;
        for (const o of resolveObj(V, a.obj)) { n++; const ao = EN.anims[o]; if (!ao || !ao.atk || !Number.isInteger(ao.atk.tbl)) noAtk.push(`${kid}:${V} ${a.id} object ${o}`); }
        // a melee attack needs a hit window: an active frame in the anim, or the kind's authored hit frames
        const melee = !a.kind || a.kind === 'melee';
        if (an && melee && !(an.act && an.act.length) && !(Array.isArray(a.hit) && a.hit.length && a.hit.every(i => i >= 0 && i < an.f.length))) noHit.push(`${kid}:${V} ${a.id} (${key})`);
      }
    }
  }
  C.check('G0', `(1e) KI14: every ENEMY_KINDS attack anim and every object it throws carries its 0xA2EA4 record with tbl and src (${n} refs; ${Object.entries(srcs).map(([s, c]) => `${s} ${c}`).join(', ')})`, !noAtk.length, noAtk.slice(0, 8).join(' | '));
  C.check('G0', '(1f) Every melee attack has a hit window: an active frame, or `hit` frames inside the anim where the body frames carry no active flag', !noHit.length, noHit.join(' | '));
  const sp = [], spBad = [];
  for (const [kid, k] of Object.entries(KINDS)) { if (!k || typeof k !== 'object' || !k.variants || !k.type || k.hero || k.parked || k.scenery || k.setPiece) continue; for (const V of Object.keys(k.variants)) { const v = KINDS.kindSpeed(kid, V); sp.push(`${kid}:${V} ${v == null ? '?' : (+v).toFixed(2)}`); if (!(v > 0.1 && v < 8)) spBad.push(`${kid}:${V} ${v}`); } }
  const pj = KINDS.kindSpeed('gunner', 'A'), pjData = KINDS.variantData('gunner', 'A');
  C.check('G0', `(1g) ENEMY_KINDS.kindSpeed: every regular kind variant walks 0.1-8 px/frame; POACHER J 1.13 (its capture under-read ${pjData && pjData.walkMeasured})`, !spBad.length && Math.abs(pj - 1.13) < 1e-9 && pjData && Math.abs(pjData.walk - 1.13) < 1e-9, spBad.join(', ') || sp.join(' '));
}

// ================================================================ boss contracts: Cinder's throw, LOT 00 part moves, units, Crown Engine
if (DEFS && BO) {
  const cd = DEFS.cinder, cdb = BO.bodies[cd.body] || {}, ob = BO.bodies[(cd.phase2 || {}).body] || {}, cmiss = [];
  for (const [n, m] of Object.entries(cd.moves || {})) if (m.a && !BO.anims[`${cdb.main}:${m.a.split(':')[1]}`]) cmiss.push(n);
  for (const [n, m] of Object.entries((cd.phase2 || {}).moves || {})) if (m.a && !BO.anims[`${ob.main}:${m.a.split(':')[1]}`]) cmiss.push('phase2 ' + n);
  C.check('G0', '(7h) Cinder (cinder) and Overdrive Cinder (overdrive) play their moves on their own bodies; the overload anims and the broken rig ship', cd.body === 'cinder' && (cd.phase2 || {}).body === 'overdrive' && !cmiss.length && !!BO.anims[`${cdb.main}:6`] && !!BO.anims[`${ob.main}:9`] && !!BO.anims[`${ob.main}:10`], cmiss.join(', '));
  // (7i) CROWNBACK left the six-part LOT 00 stand-in for his own generated body: every name in his phase patterns is one of
  // his moves, and each move's anim exists on the 'crownback' body (the Sable treatment frames on 'sable' main 9)
  const fz = DEFS.fessenden, unresolved = [], cb = BO.bodies[fz.body] || {}, sb = BO.bodies.sable || {};
  for (const [pi, ph] of (fz.phases || []).entries()) for (const name of ph.pattern || []) { const m = fz.moves && fz.moves[name]; if (!m) unresolved.push(`phase ${pi} '${name}'`); else for (const n of String(m.a || '').match(/d+/g) || []) if (!BO.anims[`${cb.main}:${n}`]) unresolved.push(`${name} main:${n}`); }
  if (!BO.anims[`${sb.main}:9`] || !BO.anims[`${cb.main}:10`] || !BO.anims[`${cb.main}:11`]) unresolved.push('treatment / lying anims');
  C.check('G0', `(7i) CROWNBACK (${fz.body}): every phase pattern name is one of his moves and every move anim ships, with the treatment (sable main 9 + main 10) and the lying frame`, fz.body === 'crownback' && !unresolved.length, unresolved.join(' | '));
  const vx = [];
  for (const [id, d] of Object.entries(DEFS)) { const walk = (o, where) => { if (!o || typeof o !== 'object') return; if (o.vx != null) { const v = KINDS.bossVx(o, 4.37); if (!(v > 0.5 && v < 12)) vx.push(`${where} vx ${o.vx} -> ${v} px/f`); } for (const [k, x] of Object.entries(o)) if (x && typeof x === 'object') walk(x, `${where}.${k}`); }; walk(d, id); }
  C.check('G0', `(7j) Units: every BOSS_DEFS vx is px/s (K.UNITS.bossVx) and converts to a plausible 0.5-12 px/frame through ENEMY_KINDS.bossVx`, !vx.length && /px\/s/.test(KINDS.K.UNITS.bossVx), vx.join(' | '));
  const ce = BO.crownEngine || {};
  C.check('G0', "(7k) PLAN §4.1: crownEngine {sheet:'crown', rec:'ce-idle'} with both bakes in rect.crown", ce.sheet === 'crown' && ce.rec === 'ce-idle' && !!(BO.sheets.crown && BO.rect.crown && BO.rect.crown['ce-idle'] && BO.rect.crown['ce-cracked']), fmt({ sheet: ce.sheet, rec: ce.rec }));
  // (7m) STORY.md: Cinder surrenders beside his broken rig (the arrest script on Overdrive's defeat anim, no melt, no MORGUE)
  { const cd = DEFS.cinder && DEFS.cinder.phase2 && DEFS.cinder.phase2.defeat, morgue = Object.keys(BO.sheets).concat(Object.keys(BO.bodies)).filter(k => /morgue/i.test(k));
    C.check('G0', '(7m) Cinder\'s defeat is a surrender beside the broken rig (arrest script, main 8) and no MORGUE body or sheet ships', !!cd && cd.arrest === true && cd.anim === 'main:8' && !morgue.length, fmt({ cd, morgue })); }
}

// ================================================================ envelope contract and sheet locality (PLAN §4.1, R4)
for (const [name, F] of [['enemies', EN], ['bosses', FAM.bosses || null]]) {
  if (!F) continue;
  const bad = [];
  if (!('ready' in F)) bad.push('no ready field');
  if (!F.build || !F.build.md5 || !Object.keys(F.build.md5).length) bad.push('build.md5 empty');
  F.frames.forEach((fr, i) => { const r = F.rect[fr[0]] && F.rect[fr[0]][String(fr[7])]; if (!r || r[0] !== fr[1] || r[1] !== fr[2] || r[2] !== fr[3] || r[3] !== fr[4]) bad.push(`frame ${i}: [7] ${fr[7]} is not its rect key`); });
  C.check('G0', `${name}: envelope ready + build.md5 (${F.build && F.build.md5 ? Object.keys(F.build.md5).length : 0} inputs), every frames[i][7] is the rect key of its box`, !bad.length, bad.slice(0, 6).join(' | '));
}
if (EN) {
  const spread = [];
  for (const [t, T] of Object.entries(EN.types)) for (const [V, v] of Object.entries(T.variants)) {
    const sets = [v.main, v.held, v.down, v.hit, v.grab].filter(Boolean), sh = new Set();
    for (const [k, a] of Object.entries(EN.anims)) if (sets.includes(k.split(':')[0])) for (const f of a.f) sh.add(EN.frames[f[0]][0]);
    if (sh.size > 2) spread.push(`${t}:${V} on ${sh.size} sheets`);
  }
  let canvas = null; try { canvas = JSON.parse(fs.readFileSync(rel('work/re/pack/enemies-report.json'), 'utf8')).canvas; } catch (e) { /* report not built */ }
  C.check('G0', `R4: every enemy variant draws from at most 2 sheets of its own type group (${Object.keys(EN.sheets).length} sheets)${canvas ? `; canvases per chapter cast (home + gel): ${canvas.map(c => `ch${c.chapter} ${c.pairs}/${c.mb} MB`).join(', ')}` : ''}`, !spread.length, spread.join(', '));
}

// ================================================================ browser checks (G4)
function reachable(url) { return new Promise(res => { if (/^file:/i.test(url)) return res(true); const req = http.get(url, r => { r.resume(); res(r.statusCode < 500); }); req.on('error', () => res(false)); req.setTimeout(2500, () => { req.destroy(); res(false); }); }); }
(async () => {
  const G4rows = ['(2) A walking FERRIS advances its walk frames with distance, not time', '(3) A jab hits only on its active frame (main 3 frame 1, after 5 ROM frames)', '(4) A knifer drops its knife on a knockdown and picks it back up (main 21)', '(6) spawnEnemy keeps today\'s Math.random order: id, timer, anim, clone roll (not for mutant/regent/mirror/boss), hero', '(8) Spacing for the next attack (G4 verify): in natural duels TYROG lashes, leaps and spits, RAZOR slashes, a poacher rolls in once', '(9) The poacher aimed shot: the windup is the aim (POACHER J 48 f, SKINNER/GUTTER 40 f) and the round leaves on the 1-f fire frame 3 f later'];
  const G5rows = ['(10) G5 Cinder: beaten as Overdrive Cinder, he climbs out of the broken rig and surrenders within 2.6 s (his line on the radio) and never melts into gel'];
  const skipAll = why => { for (const r of G4rows) C.skip('G4', r, why); for (const r of G5rows) C.skip('G5c', r, why); };
  if (NODE_ONLY) { skipAll('--node: browser checks not run'); return A.finish(C); }
  if (!(await reachable(A.BASE))) { skipAll(`GAME_URL ${A.BASE} not reachable (start node tools/serve.cjs 8766)`); return A.finish(C); }
  let browser, page, errors;
  try { ({ browser, page, errors } = await A.launch()); } catch (e) { skipAll('Playwright: ' + e.message.split('\n')[0]); return A.finish(C); }
  await A.prepare(page, { seed: 9090 });
  await A.open(page);
  await A.install(page);
  const P = await A.probe(page), S = A.stepsOf(P);
  const g4 = S.G4 && P.test.includes('romAnimOf'), why = 'ENEMY_KINDS in play.html and LAST_EDEN.test.romAnimOf (G4)';
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // (6) RNG order: valid today and after G4 (no new Math.random in spawnEnemy)
  await C.gated('G4', G4rows[3], true, '', () => ev(() => {
    const g = LAST_EDEN; g.start(0, 1, 'easy'); const real = Math.random; let n = 0; Math.random = () => { n++; return real(); };
    const bad = [];
    try { for (const [t, boss] of [['raider', false], ['knifer', false], ['brute', false], ['mutant', false], ['regent', false], ['warden', true]]) { n = 0; g.test.spawnEnemy(300, AT.M(), t, boss); const want = 4 + (boss || ['mutant', 'regent', 'mirror'].includes(t) ? 0 : 1); if (n !== want) bad.push(`${t}${boss ? ' boss' : ''}: ${n} calls, want ${want}`); }
      if (typeof g.test.arrive === 'function') { n = 0; g.test.arrive('raider', 'R', 0); if (n !== 5) bad.push(`arrive raider: ${n} calls, want 5`); }
    } finally { Math.random = real; }
    return bad.length ? bad.join('; ') : true;
  }));

  // (2) walk frames on distance
  await C.gated('G4', G4rows[0], g4, why, () => ev(() => {
    const g = LAST_EDEN; g.start(0, 1, 'easy'); const s = g.snapshot, M = AT.M();
    AT.move(s.view.x + 60, M); const e = g.test.spawnEnemy(s.view.x + 330, M, 'raider'); e.v = 'A'; e.state = 'walk'; e.timer = 99;
    const i = g.snapshot.enemies.length - 1, walkKey = ENEMY_KINDS.stateAnim('raider', 'A', 'walk');
    let x0 = e.x, steps = 0, dist = 0, last = null, moves = 0, stillAdv = 0;
    for (let t = 0; t < 180; t++) { const px = e.x; AT.ticks(1); const a = g.test.romAnimOf(i); if (!a || a.key !== walkKey) continue; const d = Math.abs(e.x - px); dist += d; if (last != null && a.frame !== last) { steps++; if (d === 0) stillAdv++; } last = a.frame; moves += d > 0 ? 1 : 0; }
    // ROM: 6 frames per 48-frame cycle at 0.778 px/frame -> ~0.16 frame changes per px
    const rate = dist ? steps / dist : 0;
    return (moves > 30 && steps >= 3 && rate > 0.08 && rate < 0.32 && stillAdv === 0) || `walk key ${walkKey}, ${steps} frame changes over ${dist.toFixed(1)} px (rate ${rate.toFixed(3)}), ${stillAdv} changes while standing`;
  }));

  // (3) jab hits on its active frame
  await C.gated('G4', G4rows[1], g4, why, () => ev(() => {
    // ticks(95): past the hero's 1.5 s spawn invulnerability (the G3c fixture fix of s07), so the blow can land
    const g = LAST_EDEN; g.start(0, 1, 'normal'); AT.ticks(95); const s = g.snapshot, M = AT.M();
    AT.move(s.view.x + 120, M); const p = g.snapshot.player;
    const e = g.test.spawnEnemy(p.x + 50, M, 'raider'); e.v = 'A'; e.dir = -1;
    const i = g.snapshot.enemies.length - 1, jab = ENEMY_KINDS.resolve('raider', 'A', ['main', 3]);
    e.state = 'windup'; e.move = ENEMY_KINDS.table('raider', 'A').atk.find(a => a.id === 'jab'); e.attackNo = 0; e.timer = 5 / 60;
    let hp = g.snapshot.player.hp, hitAt = null;
    for (let t = 0; t < 90 && !hitAt; t++) { AT.ticks(1); const now = g.snapshot.player.hp; if (now < hp) hitAt = g.test.romAnimOf(i); hp = now; }
    return (hitAt && hitAt.key === jab && hitAt.frame === 1) || `hit at ${JSON.stringify(hitAt)}, want ${jab} frame 1`;
  }));

  // (4) knife drop and pickup
  await C.gated('G4', G4rows[2], g4, why, () => ev(() => {
    const g = LAST_EDEN; g.start(0, 1, 'easy'); const s = g.snapshot, M = AT.M();
    AT.move(s.view.x + 40, M); const e = g.test.spawnEnemy(s.view.x + 200, M, 'knifer'); e.v = 'A'; e.knife = true; e.hp = e.maxhp = 999;
    const i = g.snapshot.enemies.length - 1;
    g.test.damageEnemy(i, 30); e.state = 'fly'; e.vz = 200; e.z = 1;          // a knockdown
    AT.ticks(10);
    const dropped = g.snapshot.drops.some(d => d.type === 'knife') && e.knife === false;
    AT.move(s.view.x + 20, M);
    let picked = false, sawPickup = false, pick = ENEMY_KINDS.stateAnim('knifer', 'A', 'pickup');
    for (let t = 0; t < 900 && !picked; t++) { AT.ticks(1); const a = g.test.romAnimOf(i); if (a && a.key === pick) sawPickup = true; picked = e.knife === true && !g.snapshot.drops.some(d => d.type === 'knife'); }
    return (dropped && picked && sawPickup) || `dropped ${dropped}, pickup anim ${sawPickup}, knife back ${picked}`;
  }));

  // (8) the attack cycle no longer starves the attacks that do not fit at a kind's stop (TYROG's leap from 60 px; his spit now also fits from 36,
  // RAZOR's slash at 40-60): the enemy spaces itself for the next one (game.js spacingFor). Natural duels against an idle
  // hero, no forcing; and the poacher's one forward roll (main 4) from 90-150 px.
  await C.gated('G4', G4rows[4], g4, why, () => ev(() => {
    const g = LAST_EDEN, duel = (ch, kv, secs) => { g.start(ch, 0, 'normal'); AT.ticks(100); g.test.clearFighters(); const s = g.snapshot; AT.move(s.view.x + 90, s.band.mid);
      const e = g.test.spawnEnemy(s.view.x + 260, s.band.mid, kv); e.dir = -1; e.timer = .3; e.hp = e.maxhp = 99999; const used = {}; let last = null;
      for (let i = 0; i < secs * 60 && g.snapshot.state === 'play'; i++) { AT.ticks(1); if (e.state === 'windup' && e.move && e.move !== last) used[e.move.id] = (used[e.move.id] || 0) + 1; last = e.state === 'windup' ? e.move : null; }
      return used; };
    const ty = duel(3, 'regent:A', 40), rz = duel(0, 'knifer:B', 40), bad = [];
    for (const id of ['lash', 'lashFast', 'leap', 'spit']) if (!ty[id]) bad.push(`TYROG never used ${id}`);
    if (!rz.slash) bad.push('RAZOR never slashed');
    g.start(0, 0, 'normal'); AT.ticks(100); g.test.clearFighters(); const s = g.snapshot; AT.move(s.view.x + 90, s.band.mid);
    const p = g.test.spawnEnemy(s.view.x + 220, s.band.mid, 'gunner:A'); p.dir = -1; p.timer = 0; const pi = g.snapshot.enemies.length - 1, roll = ENEMY_KINDS.stateAnim('gunner', 'A', 'roll');
    let rolls = 0, sawRoll = false, prev = null, after = null; for (let i = 0; i < 600; i++) { AT.ticks(1); if (p.state === 'roll' && prev !== 'roll') rolls++; if (p.state === 'roll') { const a = g.test.romAnimOf(pi); if (a && a.key === roll) sawRoll = true; } if (prev === 'roll' && p.state !== 'roll' && after === null) after = Math.abs(p.x - g.snapshot.player.x); prev = p.state; }
    if (rolls !== 1 || !sawRoll || !(after < 75)) bad.push(`poacher rolls ${rolls} (anim ${sawRoll}), landed ${after == null ? '-' : after.toFixed(0)} px away`);
    return bad.length ? bad.join('; ') + ` [TYROG ${JSON.stringify(ty)} RAZOR ${JSON.stringify(rz)}]` : true;
  }));

  // (9) ENEMIES §2.5 'the windup is the 48-frame aim' (main 15 [8x6 aim, 3, 1 fire, 7, 10]): on normal the windup lasts the
  // aim frames, the firing pose's 3-frame lift follows, and the round (0x6FB1A:0) appears on the 1-frame fire frame.
  await C.gated('G4', G4rows[5], g4, why, () => ev(() => {
    const g = LAST_EDEN, bad = [], seen = [];
    for (const [V, aim] of [['A', 48], ['B', 40], ['C', 40]]) {
      g.start(0, 0, 'normal'); AT.ticks(100); g.test.clearFighters(); const s = g.snapshot; AT.move(s.view.x + 60, s.band.mid);
      const e = g.test.spawnEnemy(s.view.x + 260, s.band.mid, 'gunner:' + V); e.dir = -1; e.timer = 0; e.rolled = true; const i = g.snapshot.enemies.length - 1;
      let w = null, end = null, shot = null, fr = null;
      for (let t = 0; t < 400 && shot == null; t++) { AT.ticks(1); if (w == null && e.state === 'windup' && e.move && e.move.id === 'shoot') w = t; if (w != null && end == null && e.state !== 'windup') end = t;
        if (w != null && g.snapshot.bullets.some(b => !b.friendly && b.owner === e.id && b.art && b.art.key === '0x6FB1A:0')) { shot = t; const a = g.test.romAnimOf(i); fr = a && a.key + ':' + a.frame; } }
      const key = ENEMY_KINDS.resolve('gunner', V, ['main', 15]), an = (window.ROM_ENEMIES || SPRITE_DATA.families.enemies).anims[key], fire = an && an.f.findIndex(f => f[1] === 1);
      seen.push(`${V}: windup ${end == null || w == null ? '-' : end - w} f, round +${shot == null || w == null ? '-' : shot - w} f on ${fr}`);
      if (w == null || end - w !== aim || shot - w !== aim + 3 || fr !== key + ':' + fire) bad.push(V);
    }
    return bad.length ? `wrong for ${bad.join(',')}: ${seen.join('; ')}` : true;
  }));

  // (10) G5 (PLAN §7 5c, STORY.md; the boss rebuild): beaten, OVERDRIVE CINDER climbs out of his broken rig (overdrive
  // main 8, the arrest script) and surrenders: his
  // bossDefeat line is said within the 2.6-s script and he never flashes to the gel rows or dissolves.
  await C.gated('G5c', G5rows[0], !!S.G5, 'every BOSS_DEFS body on ROM_BOSSES (G5)', () => ev(() => {
    const g = LAST_EDEN; g.start(3, 0, 'normal'); g.test.spawnBoss(); AT.ticks(170); const i = g.snapshot.enemies.findIndex(e => e.boss); g.test.damageEnemy(i, 99999); AT.ticks(200); g.test.damageEnemy(i, 99999);
    const key = `${ROM_BOSSES.bodies.overdrive.main}:8`; let t = 0, said = null, maxF = -1, gel = false;
    for (; t < 200; t++) { const b = g.snapshot.enemies.find(e => e.boss && e.type === 'cinder'); if (!b) break; if (b.ba && b.ba.key === key) maxF = Math.max(maxF, b.ba.t); if (b.flashMap === 'gel' || b.dissolve) gel = true; if (b.defeat && b.defeat.done && said == null) said = t; AT.ticks(1); g.render(); }
    return said != null && said / 60 <= 2.6 && maxF >= 0 && !gel && g.snapshot.radio === EDEN_CAMPAIGN[3].bossDefeat ? true : `surrender at ${said == null ? '-' : (said / 60).toFixed(2) + ' s'}, defeat anim up to ${maxF.toFixed(1)} f, gel ${gel}, radio ${g.snapshot.radio}`;
  }));

  await browser.close();
  A.finish(C, errors);
})().catch(e => { console.error(e); process.exit(1); });
