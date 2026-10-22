#!/usr/bin/env node
// Palette picker for the boss and elite palettes (ENEMIES §6.1, PLAN §3.2; WP-C).
//   node tools/re/build/palette-pick.cjs <body> <slot> [--hue <deg>] [--tol <deg>] [--min <score>] [--limit <n>] [--png]
//   node tools/re/build/palette-pick.cjs --list
// <body> is a boss body of pack-config.json `bosses.bodies` (butcher, morgan, richmond, slice, torikeratopss, arosaurus,
// fessenden, …) or an enemy type of `enemies.types` (kingkimo, dinonics, …); <slot> is the OBJ slot (0-31) whose ramp is
// matched. Lists the ROM rows of the 0xB7A52 table (rows 0..2047) whose 16-pen luminance order and ramp breaks match the
// slot's row in the body's home map (palettes.cjs rankRows: 0.6 Spearman + 0.4 Jaccard of the ramp resets), best first,
// with their colours and the ENEMIES §6.1 acceptance of using that row as-is for the slot (skin/outline/eye pens of the
// original kept, >= 6 of the other pens different). The kept pens are the build's: classifyPens grown by the pixels of
// the shipped frames (sprites-enemies.cjs penRoles: a skin ramp's cream highlight and dark shadow stay skin), plus the
// pack-config keep list, minus its deliberate `recolour` pens. --png writes work/re/pack/palette-pick-<body>-<slot>.png.
// Record a pick in pack-config.json `bosses.palettes.<name>.slots.<slot>` ({romRow} or {romRow, ops}).
'use strict';
const fs = require('fs'), path = require('path');
const P = require('./palettes.cjs'), png = require('./png.cjs'), E = require('./sprites-enemies.cjs'), emit = require('./emit.cjs');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'pack-config.json'), 'utf8'));
const EXTRACT = path.join(ROOT, 'work', 're', 'extract');

function contexts() {
  const out = {};
  for (const [id, b] of Object.entries((cfg.bosses && cfg.bosses.bodies) || {})) {
    if (id === '_doc' || !b.src) continue;
    const j = JSON.parse(fs.readFileSync(path.join(EXTRACT, b.src), 'utf8')), p = j.palette || {};
    out[id] = { ep: p.episodeArea[0], area: p.episodeArea[1], override: p.override ?? null, slots: (p.slotsUsed || []).map(s => s.slot), name: j.name };
  }
  for (const [id, t] of Object.entries((cfg.enemies && cfg.enemies.types) || {})) {
    if (out[id] || !t.src) continue;
    const j = JSON.parse(fs.readFileSync(path.join(EXTRACT, t.src), 'utf8'));
    if (t.format === 'bosses') { const p = j.palette; out[id] = { ep: p.episodeArea[0], area: p.episodeArea[1], override: p.override ?? null, slots: (p.slotsUsed || []).map(s => s.slot), name: j.name }; continue; }
    const v = j.variants.find(x => !x.error); const ov = (v.palette.p23.find(q => q.override !== null) || {}).override ?? null;
    out[id] = { ep: v.palette.home.stage, area: v.palette.home.area, override: ov, slots: Object.keys(v.palette.slots).map(Number), name: v.hudName };
  }
  return out;
}
const hex6 = c => '#' + c.toString(16).padStart(6, '0');
// the indexed frames of a body / type from the shipped modules (anims[key].t names the owner)
function framesOf(body) {
  for (const fam of ['bosses', 'enemies']) {
    const file = path.join(ROOT, `sprite-data-${fam}.js`); if (!fs.existsSync(file)) continue;
    const F = emit.load(file).SPRITE_DATA.families[fam], ids = new Set(), dec = {};
    for (const a of Object.values(F.anims)) if (a.t === body) for (const x of a.f) ids.add(x[0]);
    if (!ids.size) continue;
    return [...ids].sort((a, b) => a - b).map(i => { const [sh, sx, sy, w, h] = F.frames[i], im = dec[sh] || (dec[sh] = png.fromDataURL(F.sheets[sh].png)), it = { w, h, pen: new Uint8Array(w * h), slot: new Uint8Array(w * h), set: new Uint8Array(w * h) };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const q = ((sy + y) * im.width + sx + x) * 4, d = y * w + x; if (!im.rgba[q + 3]) continue; it.slot[d] = im.rgba[q]; it.pen[d] = im.rgba[q + 1]; it.set[d] = 1; } return it; });
  }
  return [];
}
// the pack-config keep / recolour of a body slot (bosses.palettes.<hand>.slots.<slot>), if a palette is configured
function slotConfig(body, slot) {
  const b = cfg.bosses && cfg.bosses.bodies && cfg.bosses.bodies[body]; if (!b) return {};
  for (const c of Object.values(b.palettes || {})) { const h = c.hand && cfg.bosses.palettes[c.hand]; const s = h && h.slots && h.slots[slot]; if (s) return { name: c.hand, keep: s.keep || null, recolour: s.recolour || [] }; }
  return {};
}

function pick(body, slot, { hue = null, tol = 40, min = 0.75, limit = 16 } = {}) {
  const ctx = contexts()[body];
  if (!ctx) throw new Error(`unknown body '${body}' (try --list)`);
  const map = P.objMap(ctx.ep, ctx.area), s = ctx.override != null ? ctx.override : slot, romRow = map[s];
  const base = P.rowRGB(romRow), items = framesOf(body), st = E.penStats(items, ctx.override != null ? null : s), roles = E.penRoles(base, st), sc = slotConfig(body, s);
  const keep = E.keepPens(base, roles, { keep: sc.keep || null, recolour: sc.recolour || [] }).keep;
  const ranked = P.rankRows({ row: romRow }, { min, limit: limit * 4, hue, hueTol: tol, excludeRow: romRow });
  const rows = [];
  for (const r of ranked) {
    const rgb = P.rowRGB(r.row);
    // using a row as-is keeps no pen of the original, so the acceptance asks for the kept pens copied back
    const merged = rgb.map((c, p) => (keep.includes(p) || p === 15 ? base[p] : c));
    const a = E.acceptRow(merged, [base], { keep: sc.keep || null, recolour: sc.recolour || [], st });
    rows.push({ row: r.row, score: r.score, hue: r.hue, rgb: rgb.map(hex6), acceptWithKeptPens: a.ok, changed: a.changed[0] });
    if (rows.length >= limit) break;
  }
  return { body, name: ctx.name, slot: s, home: `S${ctx.ep}A${ctx.area}${ctx.override != null ? `-p${ctx.override}` : ''}`, romRow, base: base.map(hex6), keepPens: keep, roles: roles.role, grown: roles.moves, hints: roles.hints, config: sc, frames: items.length, candidates: rows };
}
function swatches(res, file) {
  const n = res.candidates.length + 1, W = 16 * 12 + 80, H = n * 14 + 4, img = new Uint8Array(W * H * 4);
  const put = (x, y, c) => { const q = (y * W + x) * 4; img[q] = (c >> 16) & 255; img[q + 1] = (c >> 8) & 255; img[q + 2] = c & 255; img[q + 3] = 255; };
  for (let q = 0; q < W * H; q++) { img[q * 4] = 30; img[q * 4 + 1] = 32; img[q * 4 + 2] = 40; img[q * 4 + 3] = 255; }
  [res.base, ...res.candidates.map(c => c.rgb)].forEach((row, i) => row.forEach((c, p) => { const v = parseInt(c.slice(1), 16); for (let y = 0; y < 12; y++) for (let x = 0; x < 11; x++) put(80 + p * 12 + x, 2 + i * 14 + y, v); }));
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, png.encode({ width: W, height: H, rgba: img }));
}

if (require.main === module) {
  const a = process.argv.slice(2), opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  if (a.includes('--list') || a.length < 2) {
    const c = contexts();
    console.log('body / type          home      slots used');
    for (const [id, x] of Object.entries(c)) console.log(`${id.padEnd(20)} S${x.ep}A${x.area}${x.override != null ? '-p' + x.override : ''}`.padEnd(32) + x.slots.join(','));
    if (a.length < 2) console.log('\nusage: node tools/re/build/palette-pick.cjs <body> <slot> [--hue deg] [--tol deg] [--min score] [--limit n] [--png]');
    process.exit(0);
  }
  const res = pick(a[0], +a[1], { hue: opt('--hue') != null ? +opt('--hue') : null, tol: opt('--tol') != null ? +opt('--tol') : 40, min: opt('--min') != null ? +opt('--min') : 0.75, limit: opt('--limit') != null ? +opt('--limit') : 16 });
  console.log(`${res.body} (${res.name}) slot ${res.slot}: home ${res.home} row #${res.romRow}  ${res.base.join(' ')}`);
  console.log(`kept pens (outline/skin/eyes from ${res.frames} shipped frames${res.config.name ? `, + pack-config ${res.config.name} keep/recolour` : ''}): ${res.keepPens.join(',')}`);
  if (res.grown.length) console.log(`  grown into skin by the pixels: ${res.grown.map(m => `${m.pen} (${Math.round(m.skin * 100)}% skin contacts)`).join(', ')}`);
  if (res.hints.length) console.log(`  skin pens inside a clothing ramp of their own hue (recolour candidates): ${res.hints.map(h => h.pen).join(', ')}`);
  for (const c of res.candidates) console.log(`  #${String(c.row).padEnd(5)} score ${c.score.toFixed(3)} hue ${String(c.hue).padStart(4)}  ${c.acceptWithKeptPens ? 'ok  ' : 'no  '} changed ${String(c.changed).padStart(2)}  ${c.rgb.join(' ')}`);
  if (a.includes('--png')) { const f = path.join(ROOT, 'work', 're', 'pack', `palette-pick-${res.body}-${res.slot}.png`); swatches(res, f); console.log('wrote ' + path.relative(ROOT, f)); }
}
module.exports = { pick, contexts, swatches };
