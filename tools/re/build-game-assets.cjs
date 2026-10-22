#!/usr/bin/env node
// Asset build for Cadillacs & Dinosaurs II (PLAN §5, ARCHITECTURE §6). Run from the repo root:
//   node tools/re/build-game-assets.cjs <target> [args] [--rgba] [--out <dir>] [--root <dir>] [--seed-fail] [--json]
// Targets:
//   sprites [family]   heroes | fx | enemies | bosses | ui  (tools/re/build/sprites-<family>.cjs; WP-B/C/D)
//   stages <ch|all>    tools/re/build/levels-compose.cjs + levels-validate.cjs (WP-E)
//   ui                 = sprites ui
//   config             combat-config.js from combat-config.json (tools/build-config.cjs)
//   check              every registered gate; exit 1 on any failure (§5.2 `check` row)
//   review <ch>        tools/re/build/review.cjs (WP-E)
//   manifest           tools/re/build/manifest.json: ROM part hashes + sha256 of the shipped outputs
//   all                sprites *, stages all, config, manifest, then check
//   selftest           WP-A acceptance: config bytes, png round trips, atlas packing, palette presets, emit,
//                      manifest, hand palettes, and `check` failing on a seeded fault; writes review images to
//                      work/re/build/selftest/
// Needs Node 22, the ROM set (DINO_ROMS, default E:/mostafa/dino) and work/re/extract/** for the ROM targets.
// Every target is deterministic: sorted inputs, (family, rec) packing order, sorted keys, 4-decimal floats,
// no timestamps. Family and level builders that are not written yet are reported as "not available" and skipped.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILD_DIR = path.join(__dirname, 'build');
const png = require('./build/png.cjs'), atlas = require('./build/atlas-pack.cjs'), emit = require('./build/emit.cjs'), manifest = require('./build/manifest.cjs');
const FAMILIES = ['heroes', 'fx', 'enemies', 'bosses', 'ui'];
const CHAPTERS = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6'];

// ---------------------------------------------------------------- CLI
function parseArgs(argv) {
  const out = { target: null, args: [], rgba: false, out: null, root: ROOT, seedFail: false, json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rgba') out.rgba = true;
    else if (a === '--out') out.out = path.resolve(argv[++i]);
    else if (a === '--root') out.root = path.resolve(argv[++i]);
    else if (a === '--seed-fail') out.seedFail = true;
    else if (a === '--json') out.json = true;
    else if (a === '--quiet') out.quiet = true;
    else if (!out.target) out.target = a;
    else out.args.push(a);
  }
  return out;
}
function makeCtx(opts) {
  const root = opts.root || ROOT;
  const ctx = {
    root, out: opts.out || root, rgba: !!opts.rgba, seedFail: !!opts.seedFail, quiet: !!opts.quiet,
    extract: path.join(ROOT, 'work', 're', 'extract'), work: path.join(ROOT, 'work', 're'),
    config: readJSON(path.join(BUILD_DIR, 'pack-config.json')),
    lib: { png, atlas, emit, manifest, palettes: null },
    get palettes() { return this.lib.palettes || (this.lib.palettes = require('./build/palettes.cjs')); },
    get rom() { return this._rom || (this._rom = require('./rom.cjs')); },
    log(...a) { if (!this.quiet) console.log(...a); },
  };
  return ctx;
}
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = p => fs.existsSync(p);
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');
function optionalModule(name) {
  const p = path.join(BUILD_DIR, name);
  return exists(p) ? require(p) : null;
}
function listFiles(dir, filter = () => true, acc = []) {
  if (!exists(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, filter, acc); else if (filter(p)) acc.push(p);
  }
  return acc;
}
const MB = n => (n / 1048576).toFixed(3) + ' MB';

// ---------------------------------------------------------------- targets
function targetConfig(ctx) {
  const bc = require('../build-config.cjs');
  const r = bc.build({ root: ctx.root, out: path.join(ctx.out, 'combat-config.js') });
  ctx.log(`config: ${r.changed ? 'wrote' : 'unchanged'} ${rel(ctx.root, r.out)} (${Buffer.byteLength(r.text)} bytes)`);
  if (ctx.out === ctx.root) manifest.update('config', { inputs: ['combat-config.json'], outputs: ['combat-config.js'] });
  return { files: [r.out] };
}

function targetSprites(ctx, family) {
  const fams = family ? [family] : FAMILIES;
  const results = {};
  for (const f of fams) {
    if (!FAMILIES.includes(f)) throw new Error(`sprites: unknown family '${f}' (${FAMILIES.join(', ')})`);
    const mod = optionalModule(`sprites-${f}.cjs`);
    if (!mod || typeof mod.build !== 'function') { ctx.log(`sprites ${f}: tools/re/build/sprites-${f}.cjs not available yet, skipped`); results[f] = { skipped: true }; continue; }
    ctx.log(`sprites ${f}: building${ctx.rgba ? ' (rgba)' : ''}`);
    const r = mod.build({ rom: ctx.rom, extract: ctx.extract, config: ctx.config, out: ctx.out, rgba: ctx.rgba, lib: { png, atlas, emit, manifest, palettes: ctx.palettes }, log: ctx.log.bind(ctx) });
    results[f] = r;
    const files = (r && r.files) || [];
    ctx.log(`sprites ${f}: ${files.map(p => rel(ctx.root, p)).join(', ') || 'no files'}`);
    if (ctx.out === ctx.root) manifest.update(`sprites-${f}`, { inputs: (r && r.report && r.report.inputs) || [], outputs: files, extra: r && r.report ? { report: r.report.summary || null } : null });
  }
  return results;
}

function targetStages(ctx, which) {
  const compose = optionalModule('levels-compose.cjs'), validate = optionalModule('levels-validate.cjs');
  if (!compose || !validate) { ctx.log('stages: levels-compose.cjs / levels-validate.cjs not available yet, skipped'); return { skipped: true }; }
  const chapters = !which || which === 'all' ? CHAPTERS : [which];
  const r = compose.buildAll ? compose.buildAll({ chapters, rom: ctx.rom, extract: ctx.extract, config: ctx.config, out: ctx.out, lib: { png, atlas, emit, manifest, palettes: ctx.palettes }, validate, log: ctx.log.bind(ctx) })
    : (() => { throw new Error('stages: levels-compose.cjs must export buildAll({chapters, rom, extract, config, out, lib, validate, log}) -> {files, report}'); })();
  if (ctx.out === ctx.root) manifest.update('stages', { inputs: (r.report && r.report.inputs) || listFiles(path.join(ROOT, 'tools', 're', 'levels'), p => p.endsWith('.json')), outputs: r.files || [] });
  return r;
}

function targetReview(ctx, ch) {
  const review = optionalModule('review.cjs');
  if (!review) { ctx.log('review: tools/re/build/review.cjs not available yet, skipped'); return { skipped: true }; }
  if (!ch) throw new Error('review: chapter argument needed (ch1..ch6)');
  return review.run({ chapter: ch, root: ctx.root, rom: ctx.rom, extract: ctx.extract, config: ctx.config, lib: { png, atlas, emit, manifest, palettes: ctx.palettes }, log: ctx.log.bind(ctx) });
}

// Known shipped outputs of the pipeline (PLAN §3.1) that exist today.
function shippedOutputs(root) {
  const fixed = ['combat-config.js', 'stage-data.js', ...FAMILIES.map(f => `sprite-data-${f}.js`), ...CHAPTERS.map(c => `sprite-data-bosses-${c}.js`)].map(p => path.join(root, p)).filter(exists);
  return fixed.concat(listFiles(path.join(root, 'assets', 'stages'), p => p.endsWith('.png')));
}
function buildInputs(root) {
  const inputs = ['combat-config.json', 'tools/re/build/pack-config.json'].map(p => path.join(root, p)).filter(exists);
  inputs.push(...listFiles(path.join(root, 'tools', 're', 'levels'), p => p.endsWith('.json')));
  for (const topic of ['heroes', 'enemies', 'bosses', 'mechanics', 'stages', 'story']) inputs.push(...listFiles(path.join(ROOT, 'work', 're', 'extract', topic), p => p.endsWith('.json') && !/[\\/](live|evidence|snapcheck)[\\/]/.test(p)));
  return inputs;
}
function targetManifest(ctx) {
  const outputs = shippedOutputs(ctx.root), inputs = buildInputs(ctx.root);
  const m2 = manifest.update('manifest', { inputs: inputs.map(p => rel(ROOT, p)), outputs: outputs.map(p => rel(ROOT, p)), rom: true });
  ctx.log(`manifest: ${Object.keys(m2.targets.manifest.inputs).length} inputs, ${Object.keys(m2.targets.manifest.outputs).length} outputs, ROM ${m2.rom && m2.rom.verified ? 'verified' : 'NOT verified'} -> ${rel(ROOT, manifest.PATH)}`);
  return m2;
}

// ---------------------------------------------------------------- check: the gate registry
// A gate is {id, run(ctx) -> {ok, errors:[…], warnings:[…], skipped?:string, info?:string}}.
function loadScript(file) { try { return emit.load(file); } catch (e) { return { __error: e }; } }
// The shipped files of a family: sprite-data-<f>.js, plus sprite-data-bosses-ch<N>.js when bosses ship per chapter (§5.2).
function familyFiles(root, f) {
  const files = [path.join(root, `sprite-data-${f}.js`)];
  if (f === 'bosses') files.push(...CHAPTERS.map(c => path.join(root, `sprite-data-bosses-${c}.js`)));
  return files.filter(exists);
}
// -> { '<stem>': {fam, file, family} | {error, file, family} } keyed by the file stem ('enemies', 'bosses', 'bosses-ch1', …).
function familiesIn(root) {
  const out = {};
  for (const f of FAMILIES) for (const file of familyFiles(root, f)) {
    const key = path.basename(file, '.js').replace(/^sprite-data-/, '');
    const win = loadScript(file);
    if (win.__error) { out[key] = { error: win.__error.message, file, family: f }; continue; }
    const fams = (win.SPRITE_DATA && win.SPRITE_DATA.families) || {}, names = Object.keys(fams);
    const fam = fams[f] || fams[key] || (names.length === 1 ? fams[names[0]] : null);
    out[key] = fam ? { fam, file, family: f } : { error: `no SPRITE_DATA.add('${f}', …)`, file, family: f };
  }
  return out;
}
// One family's anims/types/bodies merged across its shipped files (null when nothing of it is shipped).
function familyView(fams, f) {
  const parts = Object.values(fams).filter(r => r.family === f && r.fam);
  if (!parts.length) return null;
  const view = { anims: {}, types: {}, bodies: {}, files: parts.map(r => r.file) };
  for (const r of parts) { Object.assign(view.anims, r.fam.anims || {}); Object.assign(view.types, r.fam.types || {}); Object.assign(view.bodies, r.fam.bodies || {}); }
  return view;
}

// ---------------------------------------------------------------- anim-key resolver (ENEMIES §2.1, §6.1; CAMPAIGN §12.4)
// A reference names an animation relative to the sets of its owner. Forms (one token, optional words around it):
//   ENEMY_KINDS: ['main', 3]  resolved through ROM_ENEMIES.types[kind.type].variants[V].main (held, down, …) for every
//                variant the kind uses (an attack's `variants:'BC'` narrows it); a variant entry may carry its own
//                {type} or inline sets; 'set:3' strings resolve the same way.
//   BOSS_DEFS:   'main:6' through ROM_BOSSES.bodies[def.body].main (hit, grab, rider, bike, chain, …); 'main:12>9' a
//                sequence, 'main:20..27' a range, 'main:17r' reversed, 'main:7|12' alternatives (index or full ref),
//                '0x6FDEC/1' or '0x6FDEC:1' an absolute set; 'body main:1' selects a part of a parts body (Fessenden).
// Every resolved key is normalised to '<0xSET>:<index>' and must exist in the family's own `anims`.
const REF_RE = /^(0x[0-9a-f]+|[a-z][a-z0-9_-]*)[:/](\d+)(?:(>|\.\.)(\d+))?(r)?$/i;
const IDX_RE = /^(\d+)(?:(>|\.\.)(\d+))?(r)?$/;
const CAND_RE = /^(0x[0-9a-f]+|[a-z][a-z0-9_-]*)[:/]\d/i;
const NON_ANIM_SETS = new Set(['hits']);                            // 'hits:5' in a defeat script counts hits, not frames
const normSet = s => (/^0x[0-9a-f]+$/i.test(s) ? '0x' + parseInt(s, 16).toString(16).toUpperCase() : s);
const animKey = (set, i) => `${normSet(set)}:${i}`;
function animIndex(fam) {
  const out = new Set();
  for (const k of Object.keys((fam && fam.anims) || {})) { const c = k.lastIndexOf(':'); out.add(c < 0 ? k : animKey(k.slice(0, c), k.slice(c + 1))); }
  return out;
}
const isRefString = v => typeof v === 'string' && v.split(/\s+/).some(w => CAND_RE.test(w.split('|')[0]));
// expandRef('body main:12>9 gel') -> {part:'body', token:'main:12>9', refs:[{set:'main', i:12}, {set:'main', i:9}]}
function expandRef(str) {
  const words = String(str).trim().split(/\s+/);
  const at = words.findIndex(w => REF_RE.test(w.split('|')[0]));
  if (at < 0) return null;
  const part = at > 0 && /^[a-z][a-z0-9_-]*$/i.test(words[at - 1]) ? words[at - 1] : null;
  const refs = []; let set = null;
  for (const alt of words[at].split('|')) {
    let m = REF_RE.exec(alt), a, op, b;
    if (m) { set = m[1]; a = +m[2]; op = m[3]; b = m[4]; }
    else { m = IDX_RE.exec(alt); if (!m || !set) return null; a = +m[1]; op = m[2]; b = m[3]; }
    if (b == null) refs.push({ set, i: a });
    else if (op === '>') refs.push({ set, i: a }, { set, i: +b });
    else for (let i = Math.min(a, +b); i <= Math.max(a, +b); i++) refs.push({ set, i });
  }
  return { part, token: words[at], refs };
}
// The ROM address of a named set of an owner: a variant {main, held, down}, a body {main, hit, grab, …} or a parts
// body {parts:[{id, set}]} (part chosen by `part`, default 'body' then the first part). Absolute sets pass through.
function resolveSet(setName, sets, part = null) {
  if (/^0x[0-9a-f]+$/i.test(setName)) return normSet(setName);
  if (!sets || typeof sets !== 'object') return null;
  if (Array.isArray(sets.parts)) {
    const p = sets.parts.find(x => x && x.id === (part || 'body')) || (part ? null : sets.parts[0]);
    if (!p) return null;
    const v = typeof p[setName] === 'string' ? p[setName] : setName === 'main' || setName === 'set' ? p.set : null;
    return typeof v === 'string' ? normSet(v) : null;
  }
  if (part && sets[part] && typeof sets[part] === 'object') sets = sets[part];
  return typeof sets[setName] === 'string' ? normSet(sets[setName]) : null;
}
const isHeroKind = kind => !kind || typeof kind !== 'object' || kind.hero === true || /^(hero|heroes|mirror|clone)$/.test(String(kind.type || '')) || (kind.type == null && !kind.variants);
// Every anim reference inside ENEMY_KINDS: ['set', i] arrays anywhere in a kind, and 'set:i' strings.
function enemyKindRefs(kinds) {
  const out = [];
  for (const [name, kind] of Object.entries(kinds || {})) {
    if (name === 'K' || !kind || typeof kind !== 'object') continue;
    const walk = (v, where, vfilter) => {
      if (Array.isArray(v)) {
        if (v.length === 2 && typeof v[0] === 'string' && Number.isInteger(v[1]) && /^(0x[0-9a-f]+|[a-z][a-z0-9_-]*)$/i.test(v[0])) { out.push({ kind: name, where, part: null, token: `['${v[0]}',${v[1]}]`, refs: [{ set: v[0], i: v[1] }], variants: vfilter, strict: true }); return; }
        v.forEach((x, i) => walk(x, `${where}[${i}]`, vfilter)); return;
      }
      if (typeof v === 'string') { if (isRefString(v)) { const e = expandRef(v); out.push({ kind: name, where, part: e ? e.part : null, token: e ? e.token : v, refs: e ? e.refs : null, variants: vfilter, strict: /\.(a|anim|anims)$/.test(where) || /^0x/i.test(v) }); } return; }
      if (v && typeof v === 'object') { const vf = typeof v.variants === 'string' ? v.variants : vfilter; for (const [k, x] of Object.entries(v)) if (k !== 'variants') walk(x, `${where}.${k}`, vf); }
    };
    walk(kind, `ENEMY_KINDS.${name}`, null);
  }
  return out;
}
// Every anim reference inside BOSS_DEFS: strings of the grammar above. Under `proj` a plain string names an object
// ('rock:3', 'knife:2', '0x68:0' = type:subtype, CAMPAIGN §12.4), not an anim, and is left alone; only `proj.obj`
// (ENEMIES §6.1 `proj:{obj:'0x71408:8'}`) is an anim key and is checked.
function bossDefRefs(defs) {
  const out = [];
  for (const [name, def] of Object.entries(defs || {})) {
    if (!def || typeof def !== 'object') continue;
    const walk = (v, where, underProj) => {
      if (typeof v === 'string') {
        if (!isRefString(v)) return;
        const e = expandRef(v), token = e ? e.token : v;
        if (underProj && !/\.(obj|a|anim)$/.test(where)) return;
        if (e && e.refs.every(r => NON_ANIM_SETS.has(r.set))) return;
        out.push({ def: name, where, part: e ? e.part : null, token, refs: e ? e.refs : null, strict: /\.(a|anim|anims|obj)$/.test(where) || /^0x/i.test(token) });
        return;
      }
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${where}[${i}]`, underProj)); return; }
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`, underProj || k === 'proj');
    };
    walk(def, `BOSS_DEFS.${name}`, false);
  }
  return out;
}
// The sets of every variant a kind uses: {sets:{V: {main, held, down, …} | null}, errors:[…]}.
function enemyVariantSets(kind, types) {
  const res = { sets: {}, errors: [] };
  const vobj = kind.variants && typeof kind.variants === 'object' ? kind.variants : null;
  const names = vobj ? Object.keys(vobj) : kind.type && types[kind.type] ? Object.keys(types[kind.type].variants || {}) : [];
  for (const V of names) {
    const v = vobj ? vobj[V] : null;
    if (v && typeof v === 'object' && typeof v.main === 'string') { res.sets[V] = v; continue; }
    const t = (v && typeof v === 'object' && v.type) || kind.type, T = t ? types[t] : null;
    if (!T) { res.errors.push(`type '${t}' not in ROM_ENEMIES.types`); res.sets[V] = null; continue; }
    const tv = (T.variants || {})[V];
    if (!tv) { res.errors.push(`variant ${V} not in ROM_ENEMIES.types.${t}.variants`); res.sets[V] = null; continue; }
    res.sets[V] = tv;
  }
  if (!names.length) res.errors.push(`no variants to resolve (type '${kind.type}' ${kind.type && types[kind.type] ? 'has none' : 'not in ROM_ENEMIES.types'})`);
  return res;
}
// The gate's logic, reusable on in-memory data: {kinds: ENEMY_KINDS, bosses: BOSS_DEFS, enemies: familyView|null, bossFam: familyView|null}.
function checkAnimKeys({ kinds = {}, bosses = {}, enemies = null, bossFam = null }) {
  const errors = [], warnings = [];
  const idx = { enemies: enemies ? animIndex(enemies) : null, bosses: bossFam ? animIndex(bossFam) : null };
  const whereIs = (own, key) => { if (idx[own] && idx[own].has(key)) return own; const other = own === 'enemies' ? 'bosses' : 'enemies'; return idx[other] && idx[other].has(key) ? other : null; };
  const kindRefs = enemyKindRefs(kinds), bossRefs = bossDefRefs(bosses);
  let checked = 0, skippedHero = 0;
  if (!enemies) { if (kindRefs.length) warnings.push(`${kindRefs.length} ENEMY_KINDS anim refs unchecked: no enemies family shipped`); }
  else {
    const types = enemies.types || {}, cache = {};
    for (const ref of kindRefs) {
      const kind = kinds[ref.kind];
      if (isHeroKind(kind)) { skippedHero++; continue; }
      const vs = cache[ref.kind] || (cache[ref.kind] = enemyVariantSets(kind, types));
      if (vs.errors.length && !vs.reported) { vs.reported = true; errors.push(...vs.errors.map(e => `ENEMY_KINDS.${ref.kind}: ${e}`)); }
      if (!ref.refs) { warnings.push(`${ref.where}: cannot parse anim ref ${JSON.stringify(ref.token)}`); continue; }
      const variants = Object.keys(vs.sets).filter(V => vs.sets[V] && (!ref.variants || ref.variants.includes(V)));
      for (const { set, i } of ref.refs) {
        const missing = [], unresolved = [];
        for (const V of variants) {
          const addr = resolveSet(set, vs.sets[V], ref.part); if (!addr) { unresolved.push(V); continue; }
          checked++; const key = animKey(addr, i), at = whereIs('enemies', key);
          if (at !== 'enemies') missing.push(`${V}=${key}${at ? ' (only in ROM_BOSSES)' : ''}`);
        }
        if (variants.length && unresolved.length === variants.length) (ref.strict ? errors : warnings).push(`${ref.where}: '${set}' is not a set of ${ref.kind}'s variants ${variants.join('')}`);
        else if (unresolved.length) warnings.push(`${ref.where}: set '${set}' missing on variant${unresolved.length > 1 ? 's' : ''} ${unresolved.join('')}`);
        if (missing.length) errors.push(`${ref.where}: anim ${set}:${i} missing from ROM_ENEMIES.anims (${missing.join(', ')})`);
      }
    }
  }
  if (!bossFam) { if (bossRefs.length) warnings.push(`${bossRefs.length} BOSS_DEFS anim refs unchecked: no bosses family shipped`); }
  else {
    const bodies = bossFam.bodies || {}, reported = new Set();
    for (const ref of bossRefs) {
      const def = bosses[ref.def], bodyName = def && def.body, body = bodyName != null && bodies[bodyName];
      if (!body) { if (!reported.has(ref.def)) { reported.add(ref.def); errors.push(`BOSS_DEFS.${ref.def}: body '${bodyName}' not in ROM_BOSSES.bodies`); } continue; }
      if (!ref.refs) { warnings.push(`${ref.where}: cannot parse anim ref ${JSON.stringify(ref.token)}`); continue; }
      for (const { set, i } of ref.refs) {
        const addr = resolveSet(set, body, ref.part);
        if (!addr) { (ref.strict ? errors : warnings).push(`${ref.where}: '${set}'${ref.part ? ` of part '${ref.part}'` : ''} is not a set of body ${bodyName}${ref.strict ? '' : ' (unchecked)'}`); continue; }
        checked++; const key = animKey(addr, i), at = whereIs('bosses', key);
        if (at !== 'bosses') errors.push(`${ref.where}: anim ${set}:${i} (${key}) missing from ROM_BOSSES.anims${at ? ' (only in ROM_ENEMIES)' : ''}`);
      }
    }
  }
  const info = `${kindRefs.length} ENEMY_KINDS + ${bossRefs.length} BOSS_DEFS refs, ${checked} keys checked${skippedHero ? `, ${skippedHero} hero-art refs skipped` : ''}`;
  return { ok: !errors.length, errors, warnings, info };
}
// JSON view of a family with the sheet pixels replaced by their decoded signature (so pixel equality, not bytes, decides).
function familySignature(fam) {
  const copy = JSON.parse(JSON.stringify(fam));
  for (const [id, sh] of Object.entries(copy.sheets || {})) { const img = png.fromDataURL(sh.png); sh.png = `${img.width}x${img.height}:${png.fnvIndexed(img.rgba)}:${manifest.hashBuffer(Buffer.from(img.rgba))}`; }
  return emit.stringify(copy);
}

const GATES = [
  { id: 'config-fresh', run(ctx) {
    const bc = require('../build-config.cjs');
    const src = path.join(ctx.root, 'combat-config.json'), dst = path.join(ctx.root, 'combat-config.js');
    if (!exists(src) || !exists(dst)) return { ok: true, skipped: 'combat-config.json/js not present' };
    const fresh = bc.render(fs.readFileSync(src, 'utf8')), shipped = fs.readFileSync(dst, 'utf8');
    return fresh === shipped ? { ok: true, errors: [], warnings: [] } : { ok: false, errors: ['combat-config.js differs from a fresh build of combat-config.json (run: node tools/re/build-game-assets.cjs config)'], warnings: [] };
  } },
  { id: 'sprite-sums', run(ctx) {
    const fams = familiesIn(ctx.root), errors = [], warnings = [];
    if (!Object.keys(fams).length) return { ok: true, skipped: 'no sprite-data-*.js shipped yet' };
    for (const [f, r] of Object.entries(fams)) {
      if (r.error) { errors.push(`${f}: ${r.error}`); continue; }
      const fam = r.fam;
      if (fam.v !== 1 || (fam.family !== r.family && fam.family !== f)) errors.push(`${f}: envelope v/family wrong`);
      for (const [id, sh] of Object.entries(fam.sheets || {})) {
        let img; try { img = png.fromDataURL(sh.png); } catch (e) { errors.push(`${f}/${id}: ${e.message}`); continue; }
        if (img.width !== sh.w || img.height !== sh.h) errors.push(`${f}/${id}: size ${img.width}x${img.height} != ${sh.w}x${sh.h}`);
        if (img.width > 1024 || img.height > 1024) errors.push(`${f}/${id}: page over 1024x1024`);
        const sum = png.fnvIndexed(img.rgba).toString(16);
        if (String(sh.sum).replace(/^0x/, '').toLowerCase() !== sum) errors.push(`${f}/${id}: sum ${sh.sum} != ${sum}`);
        for (const [rec, box] of Object.entries((fam.rect || {})[id] || {})) if (box[0] + box[2] > img.width || box[1] + box[3] > img.height) errors.push(`${f}/${id}: rect ${rec} outside the sheet`);
      }
      if (fam.mode !== 'indexed' && fam.mode !== 'rgba') errors.push(`${f}: mode ${fam.mode}`);
    }
    return { ok: !errors.length, errors, warnings };
  } },
  { id: 'sprite-rebuild', run(ctx) {
    const fams = familiesIn(ctx.root), errors = [], warnings = [], done = [];
    for (const f of FAMILIES) {
      const mod = optionalModule(`sprites-${f}.cjs`), shipped = Object.entries(fams).filter(([, r]) => r.family === f && !r.error);
      if (!mod || !shipped.length) continue;
      const out = path.join(ctx.work, 'build-check'); fs.mkdirSync(out, { recursive: true });
      let r; try { r = mod.build({ rom: ctx.rom, extract: ctx.extract, config: ctx.config, out, rgba: ctx.rgba, lib: { png, atlas, emit, manifest, palettes: ctx.palettes }, log: () => {} }); } catch (e) { errors.push(`${f}: rebuild threw ${e.message}`); continue; }
      for (const [key, s] of shipped) {
        const file = path.join(out, path.basename(s.file));
        if (!exists(file)) { errors.push(`${key}: rebuild wrote no ${rel(out, file)}`); continue; }
        const win = loadScript(file), fams2 = (win.SPRITE_DATA && win.SPRITE_DATA.families) || {}, names = Object.keys(fams2);
        const fam = fams2[f] || fams2[key] || (names.length === 1 ? fams2[names[0]] : null);
        if (!fam) { errors.push(`${key}: rebuilt module did not register the family`); continue; }
        if (familySignature(fam) !== familySignature(s.fam)) errors.push(`${key}: rebuild differs from the shipped ${path.basename(s.file)} (pixels or JSON)`);
        done.push(key);
      }
    }
    if (!done.length && !errors.length) return { ok: true, skipped: 'no family has both a builder and a shipped file' };
    return { ok: !errors.length, errors, warnings, info: `rebuilt ${done.join(', ')}` };
  } },
  { id: 'stage-rebuild', run(ctx) {
    const compose = optionalModule('levels-compose.cjs'), validate = optionalModule('levels-validate.cjs');
    const shipped = path.join(ctx.root, 'stage-data.js');
    if (!compose || !validate || !exists(shipped)) return { ok: true, skipped: 'levels modules or stage-data.js not present' };
    const out = path.join(ctx.work, 'build-check'); fs.mkdirSync(out, { recursive: true });
    const errors = [], warnings = [];
    let r; try { r = compose.buildAll({ chapters: CHAPTERS, rom: ctx.rom, extract: ctx.extract, config: ctx.config, out, lib: { png, atlas, emit, manifest, palettes: ctx.palettes }, validate, log: () => {} }); } catch (e) { return { ok: false, errors: [`stages rebuild threw ${e.message}`], warnings }; }
    const a = fs.readFileSync(shipped, 'utf8'), b = exists(path.join(out, 'stage-data.js')) ? fs.readFileSync(path.join(out, 'stage-data.js'), 'utf8') : null;
    if (a !== b) errors.push('stage-data.js differs from the rebuild');
    for (const p of listFiles(path.join(ctx.root, 'assets', 'stages'), x => x.endsWith('.png'))) {
      const q = path.join(out, rel(ctx.root, p));
      if (!exists(q)) { errors.push(`${rel(ctx.root, p)}: not produced by the rebuild`); continue; }
      if (!png.equal(png.read(p), png.read(q))) errors.push(`${rel(ctx.root, p)}: pixels differ from the rebuild`);
    }
    if (r && r.report && r.report.validation) for (const v of [].concat(r.report.validation)) { if (v && v.ok === false) errors.push(...(v.errors || []).map(e => `gate: ${e}`)); if (v) warnings.push(...(v.warnings || [])); }
    return { ok: !errors.length, errors, warnings };
  } },
  { id: 'budgets', run(ctx) {
    const B = ctx.config.budgets, errors = [], warnings = [], info = [];
    const size = p => (exists(p) ? fs.statSync(p).size : 0);
    for (const [f, limit] of Object.entries(B.files || {})) { const p = path.join(ctx.root, f); if (!exists(p)) continue; const s = size(p); info.push(`${f} ${MB(s)}`); if (s > limit) errors.push(`${f} is ${MB(s)} > ${MB(limit)}`); }
    const stages = path.join(ctx.root, 'assets', 'stages'); let total = 0;
    for (const ch of CHAPTERS) { const files = listFiles(path.join(stages, ch), p => p.endsWith('.png')); const s = files.reduce((n, p) => n + size(p), 0); total += s; if (s > B.stagePagesPerChapter) errors.push(`assets/stages/${ch} is ${MB(s)} > ${MB(B.stagePagesPerChapter)}`);
      for (const p of files) { const img = png.read(p); if (img.width > B.pageMax || img.height > B.pageMax) errors.push(`${rel(ctx.root, p)} is ${img.width}x${img.height} > ${B.pageMax}`); } }
    total += listFiles(path.join(stages, 'pics'), p => p.endsWith('.png')).reduce((n, p) => n + size(p), 0);
    if (total > B.stagePagesTotal) errors.push(`assets/stages total ${MB(total)} > ${MB(B.stagePagesTotal)}`);
    for (const p of shippedOutputs(ctx.root)) if (size(p) > B.anyShippedFile) errors.push(`${rel(ctx.root, p)} is ${MB(size(p))} > ${MB(B.anyShippedFile)}`);
    const index = path.join(ctx.root, 'index.html');
    if (exists(index)) {
      const html = fs.readFileSync(index, 'utf8'), srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
      const css = [...html.matchAll(/<link[^>]*href="([^"]+\.css)"/g)].map(m => m[1]);
      const eager = [...srcs, ...css].reduce((n, f) => n + size(path.join(ctx.root, f)), 0);
      info.push(`eager non-audio ${MB(eager)} (${srcs.length} scripts + css)`);
      if (eager > B.eagerTotal) (B.enforceEager ? errors : warnings).push(`eager non-audio ${MB(eager)} > ${MB(B.eagerTotal)}${B.enforceEager ? '' : ' (not enforced until G8: budgets.enforceEager)'}`);
    }
    return { ok: !errors.length, errors, warnings, info: info.join('; ') };
  } },
  { id: 'git-hygiene', run(ctx) {
    let files; try { files = cp.execFileSync('git', ['ls-files', '-z'], { cwd: ctx.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean); } catch (e) { return { ok: true, skipped: 'not a git checkout' }; }
    const C = ctx.config.check || {}, B = ctx.config.budgets, errors = [], warnings = [];
    const legacy = C.legacyLarge || [], forbidden = C.forbiddenTracked || ['.bin', '.zip'];
    for (const f of files) {
      const p = path.join(ctx.root, f); if (!exists(p)) continue;
      if (forbidden.some(ext => f.toLowerCase().endsWith(ext))) errors.push(`tracked ${f} (${forbidden.join('/')} must never be committed)`);
      const s = fs.statSync(p).size;
      if (s > B.trackedFileMax && !f.startsWith('assets/audio/')) { if (legacy.some(l => f === l || f.startsWith(l))) warnings.push(`tracked ${f} is ${MB(s)} (legacy, retired in G8)`); else errors.push(`tracked ${f} is ${MB(s)} > ${MB(B.trackedFileMax)}`); }
    }
    return { ok: !errors.length, errors, warnings, info: `${files.length} tracked files` };
  } },
  { id: 'anim-keys', run(ctx) {
    const ek = path.join(ctx.root, 'enemy-kinds.js'); if (!exists(ek)) return { ok: true, skipped: 'enemy-kinds.js not present' };
    const win = loadScript(ek); if (win.__error) return { ok: false, errors: [`enemy-kinds.js: ${win.__error.message}`], warnings: [] };
    const fams = familiesIn(ctx.root), errors = [];
    for (const [key, r] of Object.entries(fams)) if (r.error && (r.family === 'enemies' || r.family === 'bosses')) errors.push(`${key}: ${r.error}`);
    const enemies = familyView(fams, 'enemies'), bossFam = familyView(fams, 'bosses');
    const r = checkAnimKeys({ kinds: win.ENEMY_KINDS || {}, bosses: win.BOSS_DEFS || {}, enemies, bossFam });
    if (!enemies && !bossFam && !errors.length) return { ok: true, skipped: 'no enemies/bosses family shipped yet', info: r.info };
    return { ok: r.ok && !errors.length, errors: errors.concat(r.errors), warnings: r.warnings, info: r.info };
  } },
  { id: 'campaign-stages', run(ctx) {
    const camp = path.join(ctx.root, 'campaign.js'), sd = path.join(ctx.root, 'stage-data.js');
    if (!exists(camp) || !exists(sd)) return { ok: true, skipped: 'campaign.js or stage-data.js not present' };
    const c = loadScript(camp), s = loadScript(sd);
    if (c.__error || s.__error) return { ok: false, errors: [(c.__error || s.__error).message], warnings: [] };
    const sections = (s.STAGE_DATA && s.STAGE_DATA.sections) || null;
    const levels = c.EDEN_CAMPAIGN || [];
    const uses = levels.some(l => (l.sections || []).some(sec => sec.stage));
    if (!sections || !uses) return { ok: true, skipped: 'campaign sections carry no `stage` keys yet or STAGE_DATA has no sections' };
    const errors = [];
    levels.forEach((l, i) => (l.sections || []).forEach(sec => {
      if (!sec.stage) return;
      const st = sections[sec.stage]; if (!st) { errors.push(`ch${i + 1} section ${sec.stage}: not in STAGE_DATA.sections`); return; }
      const ch = s.STAGE_DATA.chapters[st.chapter], area = ch && ch.areas[st.area], def = area && (area.sections || []).find(x => x.id === sec.stage);
      // PLAN §4.2: a section's boss encounter locks at `bossLock`, the others at `locks` (tests/campaign.cjs counts the same way)
      const locks = def ? (def.locks || []).length + (def.bossLock != null ? 1 : 0) : null, encs = (sec.enc || sec.encounters || []).length;
      if (locks != null && locks !== encs) errors.push(`ch${i + 1} section ${sec.stage}: ${locks} locks but ${encs} encounters`);
    }));
    return { ok: !errors.length, errors, warnings: [] };
  } },
  { id: 'manifest-fresh', run(ctx) {
    if (!exists(manifest.PATH)) return { ok: true, skipped: 'no manifest.json yet (run: node tools/re/build-game-assets.cjs manifest)' };
    if (ctx.root !== ROOT) return { ok: true, skipped: 'manifest is only checked against the repo root' };
    const v = manifest.verify();
    const errors = [...v.stale.map(s => `stale output ${s}`), ...v.missing.map(s => `missing output ${s}`)];
    return { ok: v.ok, errors, warnings: [], info: `${v.targets.length} targets` };
  } },
];

function runGates(ctx, { only = null } = {}) {
  const gates = GATES.slice();
  if (ctx.seedFail) gates.push({ id: 'seeded-failure', run() { return { ok: false, errors: ['--seed-fail: this gate always fails'], warnings: [] }; } });
  const results = [];
  for (const g of gates) {
    if (only && !only.includes(g.id)) continue;
    let r; try { r = g.run(ctx); } catch (e) { r = { ok: false, errors: [`threw: ${e.message}`], warnings: [] }; }
    results.push({ id: g.id, ...r });
  }
  return results;
}
function targetCheck(ctx) {
  const results = runGates(ctx);
  let failed = 0;
  for (const r of results) {
    const tag = r.skipped ? 'SKIP' : r.ok ? 'ok  ' : 'FAIL';
    if (!r.ok) failed++;
    ctx.log(`check ${tag} ${r.id}${r.info ? `  (${r.info})` : ''}${r.skipped ? `  - ${r.skipped}` : ''}`);
    for (const e of r.errors || []) ctx.log(`      error: ${e}`);
    for (const w of r.warnings || []) ctx.log(`      warn:  ${w}`);
  }
  ctx.log(`check: ${results.length} gates, ${failed} failed, ${results.filter(r => r.skipped).length} skipped`);
  return { ok: !failed, results };
}

function targetAll(ctx) {
  const r = {};
  r.sprites = targetSprites(ctx);
  r.stages = targetStages(ctx, 'all');
  r.config = targetConfig(ctx);
  r.manifest = targetManifest(ctx);
  r.check = targetCheck(ctx);
  return r;
}

// ---------------------------------------------------------------- selftest (WP-A acceptance)
function targetSelftest(ctx) {
  const P = ctx.palettes, R = ctx.rom;
  const outDir = path.join(ctx.work, 'build', 'selftest'); fs.mkdirSync(outDir, { recursive: true });
  const checks = [], t = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); ctx.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

  // 1. config: byte-identical to the shipped file
  { const bc = require('../build-config.cjs'); const fresh = bc.render(fs.readFileSync(path.join(ROOT, 'combat-config.json'), 'utf8')); const shipped = fs.readFileSync(path.join(ROOT, 'combat-config.js'), 'utf8');
    t('config: node port reproduces combat-config.js byte for byte', fresh === shipped, `${Buffer.byteLength(fresh)} bytes`); }

  // 2. png: 20 extract PNGs round-trip pixel-exact and deterministically; the decoder agrees with rom.cjs
  { let files = []; for (const d of ['heroes', 'enemies', 'bosses', 'stages']) files.push(...listFiles(path.join(ctx.extract, d), p => p.endsWith('.png') && path.dirname(p) === path.join(ctx.extract, d)));
    files = files.filter((_, i) => i % Math.ceil(files.length / 20) === 0).slice(0, 20);
    let ok = 0, det = 0, pal = 0, agree = 0, srcBytes = 0, palBytes = 0;
    for (const f of files) {
      const buf = fs.readFileSync(f), a = png.decode(buf), ref = R.readPNG(buf);
      if (a.width === ref.w && a.height === ref.h && Buffer.compare(Buffer.from(a.rgba), ref.data) === 0) agree++;
      const e1 = png.encode(a), e2 = png.encode(a); if (e1.equals(e2)) det++;
      if (png.equal(a, png.decode(e1))) ok++;
      const e3 = png.encode({ ...a, palette: true }); if (png.equal(a, png.decode(e3))) pal++;
      srcBytes += buf.length; palBytes += e3.length;
    }
    t('png: 20 extract PNGs round-trip pixel-exact', ok === files.length && files.length === 20, `${ok}/${files.length}`);
    t('png: encoding is deterministic', det === files.length);
    t('png: palette mode (type 3) round-trips pixel-exact', pal === files.length, `${MB(srcBytes)} source -> ${MB(palBytes)} palette`);
    t('png: decoder agrees with rom.cjs readPNG', agree === files.length); }

  // 3. atlas-pack: the 613 weapon records in their tight boxes (the fx builder packs used records trimmed to their
  //    opaque extent; the extract's 16-px block boxes carry transparent slack and are packed as a second, looser case)
  { const a = readJSON(path.join(ctx.extract, 'heroes', 'atlas-weapons.json')), img = png.read(path.join(ctx.extract, 'heroes', 'atlas-weapons.png'));
    const raw = a.frames.map(f => ({ id: f.rec, w: f.w, h: f.h }));
    let empty = 0; const tight = a.frames.map(f => { const b = tightBox(img, f); if (!b) empty++; return { id: f.rec, w: b ? b.w : 1, h: b ? b.h : 1 }; });
    const O = { max: 1024, pad: 1 }, area = l => l.reduce((n, i) => n + i.w * i.h, 0) / 1048576;
    const r = atlas.pack(tight, O), c = atlas.check(r, tight, O), r2 = atlas.pack(tight.slice().reverse(), O);
    const rh = atlas.pack(tight, { ...O, sort: 'height' }), ch = atlas.check(rh, tight, O);
    const rr = atlas.pack(raw, O), cr = atlas.check(rr, raw, O);
    const dims = x => x.sheets.map(s => `${s.w}x${s.h}`).join(' + ');
    t('atlas-pack: 613 weapon records (tight boxes) packed into one sheet <= 1024^2 with no overlap', tight.length === 613 && c.ok && r.sheets.length === 1 && r.sheets[0].w <= 1024 && r.sheets[0].h <= 1024,
      `${dims(r)}, fill ${(c.fill * 100).toFixed(0)}%, tight area ${area(tight).toFixed(2)} x 1024^2${empty ? `, ${empty} empty records` : ''}; sort 'height': ${dims(rh)} fill ${(ch.fill * 100).toFixed(0)}%`);
    t('atlas-pack: deterministic across input order', JSON.stringify(r) === JSON.stringify(r2) && ch.ok);
    t('atlas-pack: the raw 16-px block boxes also pack with no overlap, every sheet <= 1024^2', cr.ok && rr.sheets.every(s => s.w <= 1024 && s.h <= 1024), `${dims(rr)}, block area ${area(raw).toFixed(2)} x 1024^2`);
    drawPacking(path.join(outDir, 'atlas-weapons-pack.png'), r); }

  // 4. palettes: ARCHITECTURE §3.4 numbers and ROM agreement
  { const want = { night: [{ op: 'scale', rgb: [0.45, 0.5, 0.75], keepPens: [1, 2, 3] }], fire: [{ op: 'hsl', h: 0, s: 1.2, l: 1.05 }, { op: 'tint', rgb: '#f80', amount: 0.25, role: 'background' }],
      flood: [{ op: 'hsl', h: -20, s: 0.8, l: 0.85 }, { op: 'tint', rgb: '#2a6', amount: 0.2 }], lab: [{ op: 'tint', rgb: '#6f8', amount: 0.3, exclude: 'metal' }], ruin: [{ op: 'hsl', h: 0, s: 0.55, l: 0.8 }, { op: 'tint', rgb: '#432', amount: 0.25 }] };
    t('palettes: the five ARCHITECTURE §3.4 presets carry the exact numbers', Object.entries(want).every(([k, v]) => JSON.stringify(P.preset(k)) === JSON.stringify(v)));
    const row = new Uint16Array(512).fill(0x0FA5), n = P.apply(row, ['night']), lab = P.apply(row, ['lab']);
    t('palettes: night = x(0.45,0.50,0.75) quantised, pens 1-3 and 15 kept', n[0] === 0x0754 && n[1] === 0x0FA5 && n[15] === 0x0FA5 && n[4] === 0x0754);
    t('palettes: lab = 30% toward #6f8 (metal rows excluded by role)', lab[0] === 0x0CC6);
    const SR = require('./export/lib/stage-rom.cjs');
    t('palettes: words(1,0,s2) == stage-rom scroll2 page', JSON.stringify(Array.from(P.words(1, 0, 's2'))) === JSON.stringify(SR.palettes(0, 0).scroll2.words));
    t('palettes: objMap(1,0) == stage-rom OBJ list', JSON.stringify(P.objMap(1, 0)) === JSON.stringify(SR.palObjPage(0, 0).idx));
    t('palettes: rowRGB(0) == rom.cjs paletteSet(0)[0] (Jack)', JSON.stringify(P.rowRGB(0)) === JSON.stringify(R.paletteSet(0)[0].map(c => (c[0] << 16) | (c[1] << 8) | c[2])));
    const b = P.apply(row, [{ op: 'borrow', row: 3, from: [4, 0, 's3', 2] }]);
    t('palettes: borrow copies the row from another stage layer', JSON.stringify(Array.from(b.subarray(48, 63))) === JSON.stringify(Array.from(P.words(4, 0, 's3').subarray(32, 47))));
    // hand rows: ENEMIES §6.1 acceptance on every clothing-swap palette
    const bad = [];
    for (const name of Object.keys(P.HAND_SPECS)) { const h = P.hand(name); for (const [slot, a] of Object.entries(h.accept)) if (a && !a.ok) bad.push(`${name}:${slot}`); }
    t('palettes: every hand clothing palette passes ENEMIES §6.1 acceptance (drafts)', !bad.length, bad.join(' ') || `${Object.keys(P.HAND_SPECS).length} palettes`);
    const H = P.HAND, isRow = r => Array.isArray(r) && r.length === 16 && r.every(c => Number.isInteger(c) && c >= 0 && c <= 0xFFFFFF);
    t('palettes: HAND is the PLAN §5.3 view {rook:{30:[16 x 0xRRGGBB]}, …} and equals handRows()', isRow(H.rook[30]) && isRow(H.cinder[28]) && isRow(H['mirror-jack'][0]) && isRow(H.gel['*']) && Object.keys(H).length === Object.keys(P.HAND_SPECS).length && Object.values(H).every(p => Object.values(p).every(isRow)) && JSON.stringify(H) === JSON.stringify(P.handRows()), `${Object.keys(H).length} palettes`);
    drawHandSheet(path.join(outDir, 'hand-palettes.png'), P);
    drawPresetSheet(path.join(outDir, 'preset-rows.png'), P); }

  // 5. emit: stable modules
  { const tmp = path.join(outDir, 'emit-test.js');
    emit.module(tmp, "SPRITE_DATA.add('test',", { z: 1, a: { 10: 1, 2: 2, b: [1.23456789, -0, new Uint8Array([1, 2])], u: undefined } });
    const text = fs.readFileSync(tmp, 'utf8'), win = emit.load(tmp);
    t('emit: sorted keys, 4-decimal floats, LF, envelope, loadable', !text.includes('\r') && text.includes(emit.ENVELOPE.trim()) && JSON.stringify(win.SPRITE_DATA.families.test) === '{"a":{"2":2,"10":1,"b":[1.2346,0,[1,2]]},"z":1}');
    emit.module(tmp, "SPRITE_DATA.add('test',", { z: 1, a: { 10: 1, 2: 2, b: [1.23456789, -0, new Uint8Array([1, 2])], u: undefined } });
    t('emit: rewrite of identical content is byte-identical', fs.readFileSync(tmp, 'utf8') === text); }

  // 6. manifest
  { const v = manifest.romVerify(); t('manifest: ROM parts match original-rom-hashes.json', v.ok, v.ok ? `sha1 ${manifest.romSha1().slice(0, 12)}…` : JSON.stringify(v));
    targetManifest({ ...ctx, log: () => {} });
    const mv = manifest.verify(); t('manifest: written and every recorded output hashes fresh', exists(manifest.PATH) && mv.ok, `${mv.targets.length} targets`);
    // a single-target rebuild must refresh the shared `manifest` record of the same path (reviewer: stale after one target)
    const saved = fs.readFileSync(manifest.PATH, 'utf8');
    const m1 = manifest.update('selftest-sync', { outputs: { 'combat-config.js': 'deadbeef' } });
    const synced = m1.targets.manifest.outputs['combat-config.js'] === 'deadbeef' && m1.targets.config.outputs['combat-config.js'] === 'deadbeef';
    const m2 = manifest.update('selftest-sync', { outputs: ['combat-config.js'] });
    const restored = m2.targets.manifest.outputs['combat-config.js'] === manifest.hashFile('combat-config.js') && manifest.verify().ok;
    fs.writeFileSync(manifest.PATH, saved, 'utf8');
    t('manifest: a single-target update syncs the hash into every record that lists the path', synced && restored); }

  // 7. check: every gate runs; a seeded fault fails the run; a tampered shipped file is caught
  { const results = runGates({ ...ctx, quiet: true }); t('check: every registered gate runs', results.length === GATES.length && results.every(r => typeof r.ok === 'boolean'), results.map(r => `${r.id}:${r.skipped ? 'skip' : r.ok ? 'ok' : 'FAIL'}`).join(' '));
    const seeded = runGates({ ...ctx, seedFail: true, quiet: true }); t('check: --seed-fail makes the run fail', seeded.some(r => r.id === 'seeded-failure' && !r.ok));
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cad2-check-')); fs.copyFileSync(path.join(ROOT, 'combat-config.json'), path.join(tmpRoot, 'combat-config.json'));
    fs.writeFileSync(path.join(tmpRoot, 'combat-config.js'), fs.readFileSync(path.join(ROOT, 'combat-config.js'), 'utf8').replace('"version":1', '"version":2'));
    const tampered = runGates(makeCtx({ root: tmpRoot, quiet: true }), { only: ['config-fresh'] });
    t('check: a tampered combat-config.js fails the config-fresh gate (exit 1)', tampered.length === 1 && tampered[0].ok === false);
    fs.rmSync(tmpRoot, { recursive: true, force: true }); }

  // 8. anim-keys: the resolver on the ENEMIES §2.1/§6.1 and CAMPAIGN §12.4 shapes, in a temp root with synthetic families
  { const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cad2-anim-'));
    const keys = (set, idx) => Object.fromEntries(idx.map(i => [`${set}:${i}`, { f: [[0, 4]], loop: 0 }]));
    const enemiesFam = () => ({ v: 1, family: 'enemies', mode: 'indexed', types: { chinpira: { obj: '0x8', variants: { A: { main: '0x34892', held: '0x30B64', down: '0x2E7BC' }, B: { main: '0x34A00', held: '0x30B64', down: '0x2E7BC' } } }, thurow: { variants: { T: { main: '0x5F000' } } } },
      anims: { ...keys('0x34892', [0, 1, 3, 5, 6]), ...keys('0x34A00', [0, 1, 3, 5, 6]), ...keys('0x2E7BC', [0, 1, 3]), ...keys('0x30B64', [0]), ...keys('0x5F000', [0, 1, 6, 7]) } });
    const bossesFam = () => ({ v: 1, family: 'bosses', mode: 'indexed', bodies: { butcher: { main: '0x6FDEC', hit: '0x30750', grab: '0x311C4' }, hogg: { rider: '0x50DFA', bike: '0x51076', grab: null },
      fessenden: { parts: [{ id: 'body', type: '0x150', set: '0x64452' }, { id: 'line', type: '0x154', set: '0x712A0' }] }, projectiles: { set: '0x71408' } },
      anims: { ...keys('0x6FDEC', [0, 1, 3, 5, 6, 8, 9, 11, 12, 17, 18, 20, 21, 22]), ...keys('0x30750', [2]), ...keys('0x50DFA', [1]), ...keys('0x64452', [1, 10]), ...keys('0x712A0', [2]), ...keys('0x71408', [8]) } });
    const kindsSrc = `window.ENEMY_KINDS = { K: { ARC: 1 },
      raider: { type: 'chinpira', variants: { A: 2, B: 1 }, st: { idle: ['main', 0], walk: ['main', 1], hurt: [['down', 0], ['down', 1]], held: ['held', 0], fly: 'down:3' },
                atk: [{ id: 'jab', a: ['main', 3] }, { id: 'kick', a: ['main', 5], variants: 'B' }], cadence: 45 },
      gunner: { type: 'chinpira', variants: { A: 1, T: { type: 'thurow', w: 1 } }, st: { idle: ['main', 0], run: ['main', 6] }, atk: [{ id: 'throw', a: ['main', 7], variants: 'T' }] },
      mirror: { type: 'hero', st: { run: ['run', 0], rise: ['getup', 1] } } };
      window.BOSS_DEFS = {
      warden: { name: 'WARDEN ROOK', body: 'butcher', line: 'vice-chain 0x945CC', intro: { walk: '0x6FDEC/1', pose: 'main:18', t: 2.4 },
                moves: { hook: { a: 'main:9', kind: 'strike' }, gaff: { a: 'main:12>9', then: 'hook' }, hop: { a: 'main:5|6' }, back: { a: 'main:17r', back: [60, 100] }, stomp: { a: 'main:20..22' },
                         slag: { a: 'main:3', proj: 'rock:3' }, grenade: { proj: '0x68:0', kind: 'lob' }, muzzle: { proj: { obj: '0x71408:8' } }, knock: { a: 'hit:2' }, crane: { kind: 'env', r: 52 } },
                phases: [{ at: 1, pattern: ['hook', 'gaff', 'hop'] }], defeat: { anim: 'main:0', script: ['main:8', 'hits:5', 'bossDefeat'], gore: 'main:11..12 gel ramp' } },
      hogg: { body: 'hogg', intro: { ride: 'rider:1' } },
      last: { body: 'fessenden', intro: { walk: 'body main:1', spawn: 'lock.right+60' }, defeat: { anim: 'body main:10', line: 'line main:2' } } };\n`;
    const writeFam = (f, fam) => emit.module(path.join(tmpRoot, `sprite-data-${f}.js`), `SPRITE_DATA.add('${f}',`, fam);
    fs.writeFileSync(path.join(tmpRoot, 'enemy-kinds.js'), kindsSrc);
    const gate = () => runGates(makeCtx({ root: tmpRoot, quiet: true }), { only: ['anim-keys'] })[0];
    let g = gate(); t('anim-keys: skipped (not passed) while neither family is shipped', g.skipped && g.ok, g.info);
    writeFam('enemies', enemiesFam()); g = gate();
    t('anim-keys: enemies only -> ENEMY_KINDS checked, BOSS_DEFS refs reported unchecked (warning, not pass)', g.ok && !g.skipped && g.warnings.some(w => /BOSS_DEFS anim refs unchecked/.test(w)), g.info);
    writeFam('bosses', bossesFam()); g = gate();
    t('anim-keys: every §2.1/§6.1/§12.4 ref form resolves and passes on complete families', g.ok && !g.errors.length && !g.warnings.length && /13 ENEMY_KINDS \+ 17 BOSS_DEFS refs, 42 keys checked, 2 hero-art refs skipped/.test(g.info), `${g.info}${g.errors.length ? ' / ' + g.errors.join(' | ') : ''}${g.warnings.length ? ' / warn ' + g.warnings.join(' | ') : ''}`);
    const e2 = enemiesFam(); delete e2.anims['0x34A00:3']; delete e2.anims['0x5F000:7']; const b2 = bossesFam(); delete b2.anims['0x6FDEC:9']; delete b2.anims['0x712A0:2']; delete b2.anims['0x71408:8'];
    writeFam('enemies', e2); writeFam('bosses', b2); g = gate();
    const want = ['ENEMY_KINDS.raider.atk[0].a: anim main:3 missing from ROM_ENEMIES.anims (B=0x34A00:3)', 'ENEMY_KINDS.gunner.atk[0].a: anim main:7 missing from ROM_ENEMIES.anims (T=0x5F000:7)',
      'BOSS_DEFS.warden.moves.hook.a: anim main:9 (0x6FDEC:9) missing', 'BOSS_DEFS.warden.moves.gaff.a: anim main:9 (0x6FDEC:9) missing', 'BOSS_DEFS.warden.moves.muzzle.proj.obj: anim 0x71408:8 (0x71408:8) missing', 'BOSS_DEFS.last.defeat.line: anim main:2 (0x712A0:2) missing'];
    t('anim-keys: a missing key fails and names the ref, the variant and the resolved key (arrays, >, parts, absolute proj.obj; proj aliases skipped)', !g.ok && want.every(w => g.errors.some(e => e.startsWith(w))) && g.errors.length === want.length, g.errors.length + ' errors');
    const e3 = enemiesFam(); delete e3.anims['0x34892:1']; const b3 = bossesFam(); b3.anims['0x34892:1'] = { f: [[0, 4]] }; delete b3.anims['0x6FDEC:0']; e3.anims['0x6FDEC:0'] = { f: [[0, 4]] };
    writeFam('enemies', e3); writeFam('bosses', b3); g = gate();
    t('anim-keys: a key present only in the other family is an error for its owner', !g.ok && g.errors.some(e => /ENEMY_KINDS.raider.st.walk.*only in ROM_BOSSES/.test(e)) && g.errors.some(e => /BOSS_DEFS.warden.defeat.anim.*only in ROM_ENEMIES/.test(e)) && g.errors.length === 2, g.errors.join(' | '));
    const b4 = bossesFam(); delete b4.bodies.hogg; writeFam('enemies', enemiesFam()); writeFam('bosses', b4);
    fs.writeFileSync(path.join(tmpRoot, 'enemy-kinds.js'), kindsSrc.replace("knock: { a: 'hit:2' }", "knock: { a: 'hti:2' }").replace("st: { idle: ['main', 0], walk: ['main', 1]", "st: { idle: ['mian', 0], walk: ['main', 1]"));
    g = gate();
    t('anim-keys: an unshipped body and a misspelt set under `a`/`st` are errors', !g.ok && g.errors.some(e => /BOSS_DEFS.hogg: body 'hogg' not in ROM_BOSSES.bodies/.test(e)) && g.errors.some(e => /warden.moves.knock.a: 'hti' is not a set of body butcher/.test(e)) && g.errors.some(e => /raider.st.idle: 'mian' is not a set of raider's variants AB/.test(e)) && g.errors.length === 3, g.errors.join(' | '));
    fs.unlinkSync(path.join(tmpRoot, 'sprite-data-bosses.js')); writeFam('bosses-ch1', { ...bossesFam(), family: 'bosses' }); fs.writeFileSync(path.join(tmpRoot, 'enemy-kinds.js'), kindsSrc); g = gate();
    t('anim-keys: per-chapter sprite-data-bosses-ch<N>.js files are merged into the bosses view', g.ok && /42 keys checked/.test(g.info), g.info);
    fs.rmSync(tmpRoot, { recursive: true, force: true }); }

  const failed = checks.filter(c => !c.ok).length;
  ctx.log(`selftest: ${checks.length} checks, ${failed} failed; review images in ${rel(ROOT, outDir)}`);
  return { ok: !failed, checks };
}

// ---------------------------------------------------------------- review images (for looking at, under work/)
function canvas(w, h, bg = [0, 0, 0, 255]) { const rgba = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) rgba.set(bg, i * 4); return { width: w, height: h, rgba }; }
function fill(img, x, y, w, h, c) { for (let j = Math.max(0, y); j < Math.min(img.height, y + h); j++) for (let i = Math.max(0, x); i < Math.min(img.width, x + w); i++) img.rgba.set(c, (j * img.width + i) * 4); }
const c24 = v => [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
function drawPacking(file, r) {
  const sheets = r.sheets, W = sheets.reduce((n, s) => n + s.w + 8, 0), H = Math.max(...sheets.map(s => s.h));
  const img = canvas(W, H, [24, 24, 24, 255]); let x0 = 0;
  sheets.forEach((s, si) => { fill(img, x0, 0, s.w, s.h, [40, 40, 48, 255]); s.places.forEach((p, i) => { const h = (p.id * 2654435761 >>> 0); fill(img, x0 + p.x, p.y, p.w, p.h, [80 + (h & 127), 80 + ((h >> 8) & 127), 80 + ((h >> 16) & 127), 255]); }); x0 += s.w + 8; });
  png.write(file, img, { palette: true });
}
// Opaque extent of one extract frame inside its atlas (null when the box is fully transparent).
function tightBox(img, f) {
  let x0 = f.w, y0 = f.h, x1 = -1, y1 = -1;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (img.rgba[((f.y + y) * img.width + f.x + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: f.x + x0, y: f.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function drawHandSheet(file, P) {
  const names = Object.keys(P.HAND_SPECS), rows = []; for (const n of names) { const h = P.hand(n); for (const [slot, row] of Object.entries(h.rows)) rows.push({ label: `${n}:${slot}`, base: h.base[slot], row }); }
  const cell = 14, img = canvas(16 * cell * 2 + 24, rows.length * (cell + 4) + 4, [20, 20, 20, 255]);
  rows.forEach((r, k) => { const y = 4 + k * (cell + 4); r.base.forEach((c, p) => fill(img, 4 + p * cell, y, cell - 1, cell, c24(c))); r.row.forEach((c, p) => fill(img, 20 + 16 * cell + p * cell, y, cell - 1, cell, c24(c))); });
  png.write(file, img, { palette: true });
  fs.writeFileSync(file.replace(/\.png$/, '.txt'), rows.map(r => r.label).join('\n') + '\n');
}
function drawPresetSheet(file, P) {
  const presets = ['night', 'fire', 'flood', 'lab', 'ruin', 'drowned', 'coldlab', 'storm-crown'], base = P.words(1, 0, 's2');
  const cell = 6, rowsShown = 32, colW = 16 * cell + 6, img = canvas(colW * (presets.length + 1) + 4, rowsShown * (cell + 1) + 4, [20, 20, 20, 255]);
  const paint = (col, ws) => { for (let r = 0; r < rowsShown; r++) for (let p = 0; p < 16; p++) fill(img, 4 + col * colW + p * cell, 4 + r * (cell + 1), cell - 1, cell, c24(P.word24(ws[r * 16 + p]))); };
  paint(0, base); presets.forEach((name, i) => paint(i + 1, P.apply(base, P.preset(name))));
  png.write(file, img, { palette: true });
  fs.writeFileSync(file.replace(/\.png$/, '.txt'), ['E1a0 s2 (source)', ...presets].join('\n') + '\n');
}

// ---------------------------------------------------------------- main
function main(argv) {
  const opts = parseArgs(argv);
  if (!opts.target) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 19).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return 2; }
  const ctx = makeCtx(opts);
  let r;
  switch (opts.target) {
    case 'sprites': r = targetSprites(ctx, opts.args[0]); break;
    case 'ui': r = targetSprites(ctx, 'ui'); break;
    case 'stages': r = targetStages(ctx, opts.args[0] || 'all'); break;
    case 'config': r = targetConfig(ctx); break;
    case 'check': r = targetCheck(ctx); if (opts.json) console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1;
    case 'review': r = targetReview(ctx, opts.args[0]); break;
    case 'manifest': r = targetManifest(ctx); break;
    case 'all': r = targetAll(ctx); return r.check.ok ? 0 : 1;
    case 'selftest': r = targetSelftest(ctx); if (opts.json) console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1;
    default: console.error(`unknown target '${opts.target}'`); return 2;
  }
  if (opts.json) console.log(JSON.stringify(r, (k, v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v), 2));
  return 0;
}

module.exports = { ROOT, BUILD_DIR, FAMILIES, CHAPTERS, GATES, makeCtx, runGates, targetConfig, targetSprites, targetStages, targetReview, targetManifest, targetCheck, targetAll, targetSelftest, shippedOutputs, buildInputs, familiesIn, familyFiles, familyView, familySignature,
  checkAnimKeys, expandRef, resolveSet, animKey, animIndex, enemyKindRefs, bossDefRefs, enemyVariantSets, tightBox };

if (require.main === module) {
  let code;
  try { code = main(process.argv.slice(2)); } catch (e) { console.error(`build-game-assets: ${process.env.BUILD_DEBUG ? e.stack : e.message}`); code = 1; }
  process.exitCode = code;
}
