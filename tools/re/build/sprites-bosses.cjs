// Bosses family of the ROM sprite data (PLAN §3.2, §4.1, §5.2; ENEMIES §6.1; CAMPAIGN §5.4-§10.4, §12.4; WP-C).
//   node tools/re/build-game-assets.cjs sprites bosses        (or: node tools/re/build/sprites-bosses.cjs)
// Inputs : work/re/extract/bosses/{butcher,torikeratopss,arosaurus,morgan,slice,vice-t,fessenden,vice-chain,boss-projectiles}.json
//          + atlases, bosses/live/{fess-boss*,morgan*}.json (Fessenden part offsets, Morgan's throw frame), the E8a3 scroll2
//          map through tools/re/export/lib/stage-rom.cjs (Crown Engine cells), work/re/runs/bz-fess-boss (optional: OBJ order),
//          tools/re/build/pack-config.json `bosses`, enemy-kinds.js (every BOSS_DEFS anim ref ships).
// Outputs: sprite-data-bosses.js (or sprite-data-bosses-ch<N>.js when over the eager budget, PLAN §5.4),
//          work/re/pack/boss-palettes.png (original vs new palette per body, for the user), work/re/pack/bosses-<body>.png
//          contact sheets, work/re/pack/crown-engine.png, work/re/pack/bosses-report.json.
// HOGG, MORGUE, FESSENDEN-1, SLISAUR and TYROG 2 are not shipped (CAMPAIGN D5).
'use strict';
const fs = require('fs'), path = require('path');
const E = require('./sprites-enemies.cjs');
const png = require('./png.cjs'), emit = require('./emit.cjs');
const { ROOT, EXTRACT, PACK_DIR, RUNS, readJSON, rel, akey, normSet, hex } = E;
let P_ = null; const PAL = () => P_ || (P_ = require('./palettes.cjs'));
let SR_ = null; const SR = () => SR_ || (SR_ = require('../export/lib/stage-rom.cjs'));
let BGA_ = null; const BGA = () => BGA_ || (BGA_ = require('../build-game-assets.cjs'));

// ================================================================ bodies
function loadBody(id, spec) {
  const rd = E.readBossEntity(path.join(EXTRACT, spec.src));
  const j = rd.json, P = j.palette || {};
  const base = spec.src.replace(/\.json$/, '');
  const atlas = fs.existsSync(path.join(EXTRACT, base + '-atlas.json')) ? E.readAtlas(path.join(EXTRACT, base + '-atlas.json'), path.join(EXTRACT, base + '-atlas.png')) : null;
  const react = (j.reactionSets || [])[0] || {};
  const sets = { main: normSet(spec.main || (j.objects[0] && j.objects[0].static && j.objects[0].static.sets[0]) || j.sets.find(s => !/^0x3/.test(s.set)).set) };
  if (react.hit) sets.hit = normSet(react.hit);
  if (react.grab) sets.grab = normSet(react.grab);
  return { id, spec, rd, json: j, anims: rd.anims, atlas, sets, home: { ep: P.episodeArea[0], area: P.episodeArea[1] }, override: spec.override !== undefined ? spec.override : P.override ?? null, atlasFiles: [path.join(EXTRACT, base + '-atlas.json'), path.join(EXTRACT, base + '-atlas.png')] };
}

// ================================================================ Fessenden: part offsets from the live logs (ENEMIES §6.1)
const FESS_TYPES = { 336: 'body', 340: 'line', 344: 'arm', 348: 'arm2', 352: 'neckA', 356: 'neckB' };
function fessAttach(body, logs) {
  const addr = new Map();
  for (const a of body.anims.values()) a.frames.forEach((f, i) => { const k = parseInt(f.addr, 16); if (!addr.has(k)) addr.set(k, `${a.key}:${i}`); });
  // the line (type 0x154) is not an attached part in the logs: it shares the body's frame pointer and position on every
  // logged frame (it never plays its own set 0x712A0 there), so it gets no attach row (counted in check.line instead)
  const stats = new Map(), seen = { frames: 0, files: [] }; const parts = Object.values(FESS_TYPES).filter(p => p !== 'body' && p !== 'line');
  const line = { frames: 0, mirrorsBody: 0, ownSet: 0 };
  const rows = [];
  for (const file of logs) {
    const p = path.join(EXTRACT, 'bosses', 'live', file); if (!fs.existsSync(p)) continue; seen.files.push(file);
    const L = readJSON(p), F = L.meta.fields, ix = k => F.indexOf(k);
    for (const e of L.log) {
      const by = {}; for (const o of e.o) { const t = FESS_TYPES[o[ix('type')]]; if (t && o[0] === 'B') by[t] = o; }
      if (!by.body) continue;
      const b = by.body, bk = addr.get(b[ix('fp')]); if (!bk) continue;
      seen.frames++;
      const face = b[ix('face')] ? -1 : 1;
      const row = { n: e.n, file, bk, off: {} };
      if (by.line) { const o = by.line; line.frames++; if (o[ix('fp')] === b[ix('fp')] && o[ix('x')] === b[ix('x')] && o[ix('h')] === b[ix('h')] && o[ix('d')] === b[ix('d')]) line.mirrorsBody++; else if (/^0x712A0:/.test(addr.get(o[ix('fp')]) || '')) line.ownSet++; }
      for (const t of parts) { const o = by[t]; if (!o) continue; row.off[t] = [(o[ix('x')] - b[ix('x')]) * face, -(o[ix('h')] - b[ix('h')]), o[ix('d')] - b[ix('d')], addr.get(o[ix('fp')]) || null]; const k = `${bk}|${t}`; if (!stats.has(k)) stats.set(k, new Map()); const m = stats.get(k), v = row.off[t].slice(0, 3).join(','); m.set(v, (m.get(v) || 0) + 1); }
      rows.push(row);
    }
  }
  const attach = {};
  for (const [k, m] of [...stats.entries()].sort()) {
    const [bk, part] = k.split('|'), best = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0].split(',').map(Number);
    (attach[bk] = attach[bk] || {})[part] = best;
  }
  // verification: every logged frame within ±1 px of the table (spawn frame and turn frames are listed)
  let ok = 0, bad = 0; const misses = [];
  for (const r of rows) {
    const t = attach[r.bk]; let good = true;
    for (const [part, v] of Object.entries(r.off)) { const a = t && t[part]; if (!a || Math.abs(a[0] - v[0]) > 1 || Math.abs(a[1] - v[1]) > 1 || Math.abs(a[2] - v[2]) > 1) good = false; }
    if (good) ok++; else { bad++; if (misses.length < 12) misses.push({ file: r.file, n: r.n, body: r.bk, logged: r.off, table: t || null }); }
  }
  // frames never logged (ENEMIES §10 risk 2): borrow the offsets of a logged frame with the same body record (same pose),
  // else the nearest logged frame of the same anim, else the idle frame; the gore pieces (main 11-14) carry no parts
  const inferred = {}, recOfKey = new Map(), logged = Object.keys(attach);
  for (const a of body.anims.values()) a.frames.forEach((f, i) => recOfKey.set(`${a.key}:${i}`, f.parts[0].rec));
  for (const a of [...body.anims.values()].filter(x => x.set === '0x64452').sort((x, y) => x.index - y.index)) a.frames.forEach((f, i) => {
    const k = `${a.key}:${i}`; if (attach[k]) return;
    if (a.index >= 11 && a.index <= 14) { inferred[k] = [null, 'gore piece: no parts']; return; }
    const same = logged.find(l => recOfKey.get(l) === f.parts[0].rec && l.startsWith('0x64452:'));
    if (same) { inferred[k] = [same, 'same body record']; return; }
    const sib = logged.filter(l => l.startsWith(a.key + ':')).sort((x, y) => Math.abs(+x.split(':')[2] - i) - Math.abs(+y.split(':')[2] - i))[0];
    inferred[k] = sib ? [sib, 'nearest logged frame of the anim'] : ['0x64452:0:0', 'idle (not logged)'];
  });
  return { attach, inferred, line, check: { frames: rows.length, within1px: ok, outside: bad, misses, files: seen.files, logged: logged.length, inferred: Object.keys(inferred).length, line } };
}
// draw order of the six parts from the OBJ lists of the run (lower OBJ index = in front), if the run is present
function fessOrder(body, runName, logFile) {
  const run = path.join(RUNS, runName, 'frames.jsonl'), logP = path.join(EXTRACT, 'bosses', 'live', logFile);
  if (!fs.existsSync(run) || !fs.existsSync(logP)) return null;
  const L = readJSON(logP), F = L.meta.fields, ix = k => F.indexOf(k);
  const recOf = new Map(); for (const a of body.anims.values()) for (const f of a.frames) recOf.set(parseInt(f.addr, 16), { recs: f.parts.map(p => p.rec), set: a.set });
  const ownSet = { body: '0x64452', line: '0x712A0', arm: '0x647D8', arm2: '0x648AA', neckA: '0x646A4', neckB: '0x646A4' };
  const codesOf = recs => { const s = new Set(); for (const r of recs || []) { const ri = E.recInfo(r); if (ri) for (const b of ri.blocks) s.add(b.code); } return s; };
  const byN = new Map(L.log.map(e => [e.n, e]));
  const before = {}; let frames = 0;
  for (const line of fs.readFileSync(run, 'utf8').split('\n')) {
    if (!line) continue; const fr = JSON.parse(line), e = byN.get(fr.f - 1); if (!e) continue;
    const firstIdx = {};
    // only parts drawing their own set count (the idle line object repeats the body's frame pointer)
    for (const o of e.o) { const t = FESS_TYPES[o[ix('type')]]; if (!t || o[0] !== 'B') continue; const ro = recOf.get(o[ix('fp')]); if (!ro || ro.set !== ownSet[t]) continue; const cs = codesOf(ro.recs); if (!cs.size) continue; const i = fr.obj.findIndex(x => cs.has(x.code)); if (i >= 0) firstIdx[t] = i; }
    const ps = Object.keys(firstIdx); if (ps.length < 2) continue; frames++;
    for (const a of ps) for (const b of ps) if (a !== b && firstIdx[a] < firstIdx[b]) before[a + '>' + b] = (before[a + '>' + b] || 0) + 1;
  }
  if (!frames) return null;
  // front to back by pairwise majority (lower OBJ index = in front)
  const parts = Object.values(FESS_TYPES), score = p => parts.reduce((n, q) => n + ((before[p + '>' + q] || 0) > (before[q + '>' + p] || 0) ? 1 : 0), 0);
  const frontToBack = parts.filter(p => parts.some(q => before[p + '>' + q] || before[q + '>' + p])).sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1));
  let agree = 0, total = 0;
  for (let i = 0; i < frontToBack.length; i++) for (let j = i + 1; j < frontToBack.length; j++) { const a = before[frontToBack[i] + '>' + frontToBack[j]] || 0, b = before[frontToBack[j] + '>' + frontToBack[i]] || 0; agree += a; total += a + b; }
  return { frontToBack, frames, share: total ? +(agree / total).toFixed(3) : 0, pairs: before };
}

// ================================================================ Morgan: the frame that creates the thrown object (type 0x110)
function morganThrow(body, logs) {
  const addr = new Map(); for (const a of body.anims.values()) a.frames.forEach((f, i) => { const k = parseInt(f.addr, 16); if (!addr.has(k)) addr.set(k, [a.key, i]); });
  const hits = [];
  for (const file of logs) {
    const p = path.join(EXTRACT, 'bosses', 'live', file); if (!fs.existsSync(p)) continue;
    const L = readJSON(p), F = L.meta.fields, ix = k => F.indexOf(k); let prev = new Set();
    for (const e of L.log) {
      const cur = new Set(); let b = null;
      for (const o of e.o) { if (o[ix('type')] === 0x90) b = o; if (o[ix('type')] === 0x110) cur.add(o[0] + o[1]); }
      for (const s of cur) if (!prev.has(s) && b) { const o = e.o.find(x => x[0] + x[1] === s && x[ix('type')] === 0x110); const face = b[ix('face')] ? -1 : 1; hits.push({ file, n: e.n, at: addr.get(b[ix('fp')]) || null, dx: (o[ix('x')] - b[ix('x')]) * face, h: o[ix('h')] - b[ix('h')], sub: o[ix('sub')] }); }
      prev = cur;
    }
  }
  const tally = {}; for (const h of hits) if (h.at) { const k = `${h.at[0]}/${h.at[1]}/${h.dx}/${h.h}`; tally[k] = (tally[k] || 0) + 1; }
  const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if (!best) return { found: false, fallback: { anim: akey(body.sets.main, 4), frame: 2, note: 'ENEMIES §6.2 fallback: main 4 "crouch and spring up", release on frame 2' }, hits: hits.length };
  const [anim, frame, dx, h] = best[0].split('/');
  return { found: true, anim, frame: +frame, spawn: { dx: +dx, h: +h }, creations: hits.length, sameFrame: best[1], subs: [...new Set(hits.map(x => x.sub))].sort(), files: [...new Set(hits.map(x => x.file))],
    note: 'spawn.dx in native left-facing screen px (the art faces left, so positive = behind the body: the hand is raised behind the head), spawn.h = height above the feet; the object (type 0x110, set 0x71408) appears on the first tick of this frame; the extract labels the anim "head-butt"' };
}

// ================================================================ Crown Engine: E8a3 scroll2 cells (CAMPAIGN §10.4)
function crownEngine(spec, pb) {
  const s = spec.stage - 1, m = SR().renderMap2(s, spec.mapArea, { cols: spec.cols }), img = m.img, pal = SR().palettes(s, spec.area).scroll2;
  const [X0, X1] = spec.x, [H0, H1] = spec.h, rows = new Set(spec.rows);
  const W = X1 - X0, H = H1 - H0;
  const cv = { w: W, h: H, ox: 0, oy: 0, pen: new Uint8Array(W * H), slot: new Uint8Array(W * H), set: new Uint8Array(W * H) };
  for (let h = H0; h < H1; h++) for (let X = X0; X < X1; X++) {
    const my = img.h - 1 - h, q = my * img.w + X, pen = img.pen[q]; if (pen === 15) continue;
    const row = img.pal[q]; if (!rows.has(row)) continue;
    if (spec.rowPens && spec.rowPens[row] && !spec.rowPens[row].includes(pen)) continue;   // e.g. the dirt pens of the floor-cable row
    const y = H1 - 1 - h, x = X - X0, d = y * W + x; cv.pen[d] = pen; cv.slot[d] = row; cv.set[d] = 1;
  }
  // glass: the pod's glass pens inside the pod box
  const [gx0, gx1] = spec.pod.x, [gh0, gh1] = spec.pod.h, glassPens = new Set(spec.pod.glassPens);
  let gb = [1e9, 1e9, -1e9, -1e9];
  const cracked = { ...cv, pen: cv.pen.slice(), slot: cv.slot.slice(), set: cv.set.slice() };
  for (let h = gh0; h < gh1; h++) for (let X = gx0; X < gx1; X++) {
    const x = X - X0, y = H1 - 1 - h, d = y * W + x; if (!cv.set[d] || cv.slot[d] !== spec.pod.row || !glassPens.has(cv.pen[d])) continue;
    gb = [Math.min(gb[0], x), Math.min(gb[1], y), Math.max(gb[2], x), Math.max(gb[3], y)];
    if (spec.cracked.drop.includes(cv.pen[d])) { cracked.set[d] = 0; }
  }
  // feet origin: bottom centre of the throne (the floor line)
  const ox = Math.round(spec.feet[0] - X0), oy = H1 - spec.feet[1];
  cv.ox = ox; cv.oy = oy; cracked.ox = ox; cracked.oy = oy;
  // palettes: home rows of the E8a3 scroll2 page and the crown recolour (hand rows), dark variant for the cracked state
  const homeRows = {}, crownRows = {}, darkRows = {};
  const P = PAL();
  for (const r of spec.rows) {
    const base = pal.rgb[r].map(c => (c[0] << 16) | (c[1] << 8) | c[2]);
    homeRows[r] = pb.addRow(`e8a3s2:${r}`, base);
    const ops = (spec.crown.rows[r] || spec.crown.rows['*'] || []);
    const keep = (spec.crown.keep && spec.crown.keep[r]) || [];
    const cls = { outline: [], eyes: [], skin: keep.slice(), clothing: Array.from({ length: 15 }, (_, i) => i).filter(i => !keep.includes(i)), transparent: [15] };
    const row = P.recolourRow(base, ops, cls);
    crownRows[r] = pb.addRow(`crown:${r}`, row);
    const dark = P.recolourRow(row, spec.cracked.ops, { outline: [], eyes: [], skin: [], clothing: Array.from({ length: 15 }, (_, i) => i), transparent: [15] });
    darkRows[r] = pb.addRow(`crown-dark:${r}`, dark);
  }
  const mk = (name, rowsBy) => { const first = rowsBy[spec.rows[0]]; const arr = new Array(32).fill(first); for (const r of spec.rows) arr[r] = rowsBy[r]; return pb.addMap(name, arr); };
  const maps = { home: mk('crown-home', homeRows), crown: mk('crown', crownRows), dark: mk('crown-dark', darkRows) };
  // ENEMIES §6.1 for the crown rows: every colour a ROM colour, the pens each row changes (the keep lists are by design:
  // the capsule's outline and cables, the gold base); used pens only
  const used = {}; for (let q = 0; q < W * H; q++) if (cv.set[q]) { const r = cv.slot[q]; (used[r] = used[r] || new Set()).add(cv.pen[q]); }
  const romCols = P.romColours(), acc = {};
  for (const r of spec.rows) {
    const base = pb.rows[homeRows[r]], row = pb.rows[crownRows[r]], pens = [...(used[r] || [])].sort((a, b) => a - b), keep = (spec.crown.keep && spec.crown.keep[r]) || [];
    acc[r] = { usedPens: pens, keep, changed: pens.filter(p => row[p] !== base[p]).length, changeable: pens.filter(p => !keep.includes(p)).length, notRom: pens.filter(p => !romCols.has(row[p])), keptChanged: keep.filter(p => row[p] !== base[p]) };
  }
  const ok = Object.values(acc).every(a => !a.notRom.length && !a.keptChanged.length && a.changed === a.changeable) && Object.values(acc).reduce((n, a) => n + a.changed, 0) >= 6;
  const accept = { ok, rows: acc, summary: `${Object.values(acc).reduce((n, a) => n + a.changed, 0)} pens changed over rows ${spec.rows.join('/')}` };
  return { idle: cv, cracked, accept, glass: gb[0] < 1e9 ? [gb[0] - ox, gb[1] - oy, gb[2] - gb[0] + 1, gb[3] - gb[1] + 1] : null, maps, rows: spec.rows, source: { stage: `E${spec.stage}a${spec.area}`, layer: 's2', x: spec.x, h: spec.h, mapArea: spec.mapArea } };
}

// ================================================================ hand palettes for the new characters (ENEMIES §6.1)
// spec: {body, slots:{<slot>:{ops, keep?}}, map:'home'|'uniform', siblings?:[[ep, area, ov?]...] (other contexts of the same body)}
// `items` = the body's indexed frames: the pens' roles come from the pixels (sprites-enemies.cjs penRoles), so a skin
// highlight or shadow is kept even when palettes.cjs classifyPens() calls it clothing; an explicit `keep` adds to them.
function bossPalette(name, spec, body, pb, items = []) {
  const P = PAL(), homeKey = pb.objMap(body.home.ep, body.home.area, body.override);
  const home = pb.maps[homeKey], arr = home.slice(), accept = {}, rowsOut = {}, uniform = spec.map === 'uniform';
  for (const [slot, s] of Object.entries(spec.slots)) {
    const romRow = s.romRow != null ? s.romRow : home[+slot], base = P.rowRGB(romRow);
    const st = E.penStats(items, uniform || body.override != null ? null : +slot), roles = E.penRoles(base, st);
    const keep = E.keepPens(base, roles, { keep: s.keep || null, recolour: s.recolour || [] }).keep;
    const row = s.rgb ? s.rgb.map(c => (typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : c)) : P.recolourRow(base, s.ops || [], P.classesFromKeep(keep));
    const rk = pb.addRow(`${name}:${slot}`, row);
    arr[+slot] = rk; rowsOut[slot] = row;
    // every original palette of the body (home + its other contexts + palette-swap siblings) for this slot
    const originals = [base];
    for (const sib of (spec.siblings && spec.siblings[slot]) || []) { const r = sib[2] != null ? P.objMap(sib[0], sib[1])[sib[2]] : P.objMap(sib[0], sib[1])[+slot]; const rr = P.rowRGB(r); if (!originals.some(o => o.join() === rr.join())) originals.push(rr); }
    const a = E.acceptRow(row, originals, { keep: s.keep || null, recolour: s.recolour || [], st });
    accept[slot] = { ok: a.ok, notRom: a.notRom, keptChanged: a.keptChanged, changedVsEachOriginal: a.changed, keepPens: a.keepPens, keep: s.keep ? 'config + pixel roles' : 'pixel roles', recolour: s.recolour || [], refusedRecolour: a.refusedRecolour, roles: a.roles, roleMoves: a.roleMoves, rampSplit: a.rampSplit, rampSplitShare: a.rampSplitShare, px: a.px, originals: originals.length, romRow,
      base: base.map(c => '#' + c.toString(16).padStart(6, '0')), row: row.map(c => '#' + c.toString(16).padStart(6, '0')) };
  }
  const key = spec.map === 'uniform' ? pb.addMap(name, new Array(32).fill(arr[+Object.keys(spec.slots)[0]])) : pb.addMap(name, arr);
  return { key, accept, ok: Object.values(accept).every(a => a.ok), rows: rowsOut, note: spec.note || '' };
}

// ================================================================ the build
function build({ rom = null, config = null, out = ROOT, rgba = false, log = console.log } = {}) {
  const cfgAll = config || readJSON(path.join(__dirname, 'pack-config.json'));
  const cfg = cfgAll.bosses;
  const win = emit.load(path.join(ROOT, 'enemy-kinds.js')), defs = win.BOSS_DEFS || {};
  const report = { inputs: [], summary: {}, warnings: [], readBack: {}, palettes: {}, labels: {} };
  const pb = new E.PalBook(), fb = new E.FrameBook();
  const ids = Object.keys(cfg.bodies).filter(k => k !== '_doc').sort();
  const bodies = {};
  for (const id of ids) { bodies[id] = loadBody(id, cfg.bodies[id]); report.inputs.push(rel(path.join(EXTRACT, cfg.bodies[id].src)), ...bodies[id].atlasFiles.filter(fs.existsSync).map(rel)); }
  report.inputs.push('enemy-kinds.js', 'tools/re/build/pack-config.json');

  // ---------------------------------------------------------------- what ships: every anim of the configured sets + every BOSS_DEFS ref
  const need = new Map();
  for (const id of ids) {
    const B = bodies[id], spec = cfg.bodies[id];
    const setList = spec.parts ? spec.parts.map(p => normSet(p.set)).concat([B.sets.hit, B.sets.grab].filter(Boolean)) : Object.values(B.sets);
    for (const a of B.anims.values()) if (setList.includes(a.set) && !(spec.skip || []).includes(a.key)) need.set(a.key, id);
  }
  const G = BGA(), unresolved = [];
  for (const ref of G.bossDefRefs(defs)) {
    const def = defs[ref.def], B = def && bodies[def.body]; if (!B || !ref.refs) continue;
    const sets = cfg.bodies[def.body].parts ? { parts: cfg.bodies[def.body].parts.map(p => ({ id: p.id, set: normSet(p.set) })) } : B.sets;
    for (const { set, i } of ref.refs) { const addr = G.resolveSet(set, sets, ref.part); if (!addr) { unresolved.push(`${ref.where} ${set}`); continue; } const k = akey(addr, i); if (!need.has(k)) { if (B.anims.has(k)) need.set(k, def.body); else report.warnings.push(`${ref.where}: ${k} not decoded in ${B.spec.src}`); } }
  }
  if (unresolved.length) report.warnings.push(...unresolved.map(u => 'unresolved set: ' + u));

  const animsOut = {};
  for (const k of [...need.keys()].sort()) { const id = need.get(k), a = bodies[id].anims.get(k); animsOut[k] = { a, id }; for (const fr of a.frames) fb.add(fr.parts, id); }

  // ---------------------------------------------------------------- Crown Engine bake (its own items on the boss sheets)
  const ce = crownEngine(cfg.crownEngine, pb);
  report.crown = ce.accept; report.palettes.crown = { body: 'crownEngine', ok: ce.accept.ok, summary: ce.accept.summary, rows: ce.accept.rows };
  const ceItems = { 'ce-idle': ce.idle, 'ce-cracked': ce.cracked };

  // ---------------------------------------------------------------- pack (records + the two baked images)
  const done = finishWithExtras(fb, ceItems, { prefix: 'b', max: cfgAll.build.sheet.max, pad: cfgAll.build.sheet.pad, sort: cfg.sort || 'id' });
  const fid = new Map(done.list.map(e => [e.sig, e.id]));

  // ---------------------------------------------------------------- palettes and body records
  const bodiesOut = {};
  for (const id of ids) {
    const B = bodies[id], spec = cfg.bodies[id], j = B.json;
    const home = pb.objMap(B.home.ep, B.home.area, B.override);
    const pal = { home };
    for (const [name, c] of Object.entries(spec.palettes || {})) {
      if (c.ctx) pal[name] = pb.objMap(c.ctx[0], c.ctx[1], c.ctx[2] ?? null);
      else if (c.hand) { const items = done.list.filter(e => e.owners.has(B.id)).map(e => e.img); const r = bossPalette(name, cfg.palettes[c.hand] || c, B, pb, items); pal[name] = r.key; report.palettes[name] = { body: id, ...r }; }
    }
    if (spec.gel) { const slots = usedSlotsOf(B, animsOut, done, fid); pal.gel = B.override != null ? pb.gelMap(pb.addMap(`row-${pb.maps[home][0]}`, new Array(32).fill(pb.maps[home][0])), [0]) : pb.gelMap(home, slots); }
    const bossHp = (j.hp.boss || [])[0], regHp = (j.hp.regular || []).find(r => r.name === j.name) || null;
    const o = { hud: j.name, ...(spec.parts ? { parts: spec.parts.map(p => ({ id: p.id, type: p.type, set: normSet(p.set) })) } : {}), ...B.sets, home, pal, use: spec.use || 'home',
      r84: (j.reactionSets || [])[0] && (j.reactionSets || [])[0].r84 ? parseInt(j.reactionSets[0].r84, 16) : null, source: spec.src,
      hpRom: bossHp ? { table: bossHp.table, index: bossHp.index, byPlayers: bossHp.byPlayers } : regHp ? { table: regHp.table, byRank: regHp.byRank } : null,
      attacks: Object.fromEntries((j.damage && j.damage.records || []).map(r => [r.attackId, E.atkOf(r.attackId)])) };
    bodiesOut[id] = o;
  }
  // Fessenden attach + order (KI: ENEMIES §6.1), Morgan's throw (ENEMIES §6.2 RISK)
  if (bodiesOut.fessenden) {
    const fa = fessAttach(bodies.fessenden, cfg.fessenden.logs);
    const ord = fessOrder(bodies.fessenden, cfg.fessenden.run, cfg.fessenden.orderLog);
    bodiesOut.fessenden.attach = fa.attach;
    bodiesOut.fessenden.attachInferred = fa.inferred;
    // back to front; a part the run never drew with its own set (the line) keeps its ENEMIES §6.1 place (in front)
    bodiesOut.fessenden.order = ord ? ord.frontToBack.slice().reverse().concat(cfg.fessenden.orderFallback.filter(p => !ord.frontToBack.includes(p))) : cfg.fessenden.orderFallback;
    bodiesOut.fessenden.orderSource = ord ? `OBJ lists of ${cfg.fessenden.run} (${ord.frames} frames; ${Math.round(ord.share * 100)}% of the pairwise part orders agree), back to front` : 'ENEMIES §6.1 (back to front)';
    bodiesOut.fessenden.attachFormat = "attach: '<body anim key>:<frame>' -> {arm, arm2, neckA, neckB: [dx, dy, dz]} measured in the live logs (part origin minus body origin, native left-facing screen px, dy up negative, depth); attachInferred: '<key>' -> [measured key to borrow | null, why] for the body frames never logged; the line has no row (see line)";
    bodiesOut.fessenden.line = { attach: null, mirrorsBody: fa.line.mirrorsBody, logged: fa.line.frames, ownSet: fa.line.ownSet, note: 'in the logs the line object (type 0x154) only mirrors the body (same frame pointer and position on every logged frame) and never plays its own set 0x712A0, so its offset is unmeasured: draw its own anims at the body origin until a capture places them' };
    report.fessenden = { check: fa.check, order: ord };
  }
  if (bodiesOut.morgan) { const mt = morganThrow(bodies.morgan, cfg.morgan.logs); bodiesOut.morgan.throwFrame = mt.found ? { anim: mt.anim, frame: mt.frame, spawn: mt.spawn, obj: '0x71408', note: mt.note } : mt.fallback; report.morganThrow = mt; }
  bodiesOut.crownEngine = { sheet: 'crown', rec: 'ce-idle', recCracked: 'ce-cracked', pal: { home: ce.maps.home, crown: ce.maps.crown, dark: ce.maps.dark }, use: 'crown', glass: ce.glass, source: ce.source, drawAt: 'feet line, y-sorted with the fighters (never an fg page, RISK R9)' };

  // ---------------------------------------------------------------- anims
  const anims = {};
  for (const [k, o] of Object.entries(animsOut)) {
    const a = o.a, act = []; let wind = null, t = 0;
    const f = a.frames.map((fr, i) => { if (fr.active) { act.push(i); if (wind == null) wind = t; } t += fr.dur; const id = fid.get(fb.sig(fr.parts)); return fr.active ? [id, fr.dur, 1] : [id, fr.dur]; });
    const rec = { f, loop: a.loop, t: o.id };
    if (a.next) rec.next = [a.next.key, a.next.frame];
    if (act.length) { rec.act = act; rec.wind = wind; }
    if (a.attackIds && a.attackIds.length) { const s = [...new Set(a.attackIds)].sort((x, y) => x - y); rec.atk = E.atkOf(s[0]); if (s.length > 1) rec.ids = s; }
    if (cfg.labels) rec.lbl = a.label.slice(0, 96);
    report.labels[k] = a.label;
    anims[k] = rec;
  }

  // ---------------------------------------------------------------- sheets, rect, frames
  const sheets = {}, rect = {}, stats = [];
  for (const sh of done.sheets) { const o = E.sheetOut(sh, rgba, (slot, pen) => (pb.rows[String(pb.maps[bodiesOut[ids[0]].home][slot])] || PAL().rowRGB(0))[pen]); sheets[sh.id] = { png: o.png, w: o.w, h: o.h, sum: o.sum }; rect[sh.id] = {}; stats.push({ id: sh.id, w: o.w, h: o.h, bytes: o.bytes, colours: o.colours, paletteMode: o.paletteMode, fill: +sh.fill.toFixed(3) }); }
  // frames[i][7] = the rect key: the record number, a composite's signature, or the baked id ('ce-idle')
  const frames = done.list.map(e => { rect[e.sheet][e.sig] = [e.sx, e.sy, e.img.w, e.img.h, e.img.ox, e.img.oy]; return [e.sheet, e.sx, e.sy, e.img.w, e.img.h, e.img.ox, e.img.oy, /^\d+$/.test(e.sig) ? Number(e.sig) : e.sig, e.flags]; });
  const ceE = done.list.find(e => e.sig === 'ce-idle');
  if (ceE.sheet !== 'crown') throw new Error('crown engine not on its own sheet'); bodiesOut.crownEngine.frames = { idle: fid.get('ce-idle'), cracked: fid.get('ce-cracked') };
  bodiesOut.crownEngine.ox = ceE.img.ox; bodiesOut.crownEngine.oy = ceE.img.oy; bodiesOut.crownEngine.w = ceE.img.w; bodiesOut.crownEngine.h = ceE.img.h;

  // ---------------------------------------------------------------- read-back
  const decoded = Object.fromEntries(done.sheets.map(sh => [sh.id, png.fromDataURL(sheets[sh.id].png)]));
  for (const id of ids) report.readBack[id] = readBackBody(bodies[id], animsOut, done, fid, decoded, rgba);

  // ---------------------------------------------------------------- module (eager, or per chapter when over budget)
  const sha = (() => { try { return require('./manifest.cjs').romSha1(); } catch (e) { return null; } })();
  const fam = {
    v: 1, family: 'bosses', mode: rgba ? 'rgba' : 'indexed', ready: false,
    build: { from: report.inputs.filter(p => p.endsWith('.json')).sort(), tool: 'tools/re/build-game-assets.cjs sprites bosses', rom: sha, md5: E.inputMd5(report.inputs) },
    sheets, rect, pal: { rows: pb.rows, maps: pb.maps }, frames, anims, bodies: bodiesOut, crownEngine: bodiesOut.crownEngine,
    notes: {
      frames: "[sheet, x, y, w, h, ox, oy, rec, flags]: (ox, oy) = feet origin inside the box, art faces LEFT; rec = the rect key (record number, a flattened composite's signature 'rec@dx,dy+…', or the baked id 'ce-idle' / 'ce-cracked'); flags bit0 = own pen-0 shadow blocks, bit1 = flattened composite / rec2 frame, bit2 = baked from stage cells",
      sheets: "one sheet set per body 'b-<body>[-n]' (a fight colours only its body's sheets, PLAN R4) and 'crown' for the Crown Engine (PLAN §4.1)",
      ready: 'false in the data; enemy-kinds.js turns it into a getter that reads SPRITES.familyReady(bosses)',
      bodies: "<body>: {main, hit?, grab? | parts:[{id, type, set}], home (map key), pal {<name>: map key}, use (the palette the sequel draws it with), hpRom, attacks, …}; BOSS_DEFS.<kind>.body names the body",
      crownEngine: "PLAN §4.1 {sheet:'crown', rec:'ce-idle' (recCracked 'ce-cracked'), ox, oy}: baked from the E8a3 scroll2 cells (pen 15 transparent; R = the scroll2 palette row, mapped by pal.maps crown / crown-dark / crown-home); frames.idle / frames.cracked = frame ids; glass = [x, y, w, h] of the capsule glass relative to the feet origin (Sable is clipped inside it)",
      anims: 'as ROM_ENEMIES.anims; labels in work/re/pack/bosses-report.json',
    },
  };
  fs.mkdirSync(out, { recursive: true });
  const outFile = path.join(out, 'sprite-data-bosses.js');
  const w = emit.module(outFile, "SPRITE_DATA.add('bosses',", fam);
  const files = [outFile];
  const limit = cfgAll.budgets.files['sprite-data-bosses.js'];
  if (w.bytes > limit) report.warnings.push(`sprite-data-bosses.js is ${w.bytes} bytes > ${limit}: split per chapter (PLAN §5.4) needed`);

  // ---------------------------------------------------------------- review images
  if (out === ROOT) {
    // review images (git-ignored work/): in the report, not in the manifest
    report.reviewImages = [...writeBossSheets(bodies, animsOut, done, fid, decoded, pb, bodiesOut, ids), writePaletteSheet(bodies, bodiesOut, done, fid, decoded, pb, cfg, report), writeCrownSheet(ce, done, fid, decoded, pb), writeLot00Sheet(bodies, bodiesOut, done, fid, decoded, pb)].filter(Boolean).map(rel);
    emit.json(path.join(PACK_DIR, 'bosses-report.json'), report);
  }
  const rb = Object.values(report.readBack).reduce((s, r) => ({ checked: s.checked + r.checked, identical: s.identical + r.identical, different: s.different + r.different, noRef: s.noRef + Math.max(0, r.noRef) }), { checked: 0, identical: 0, different: 0, noRef: 0 });
  report.summary = { bytes: w.bytes, bodies: ids.length, anims: Object.keys(anims).length, frames: frames.length, sheets: stats, readBack: rb, palettesOk: Object.fromEntries(Object.entries(report.palettes).map(([k, v]) => [k, v.ok])) };
  if (out === ROOT) emit.json(path.join(PACK_DIR, 'bosses-report.json'), report);
  log(`sprites bosses: ${ids.length} bodies, ${report.summary.anims} anims, ${frames.length} frames, ${stats.length} sheets ${stats.map(s => `${s.w}x${s.h}${s.paletteMode ? '' : ' rgba'}`).join(' ')}, ${(w.bytes / 1048576).toFixed(3)} MB; read-back ${rb.identical}/${rb.checked} identical, ${rb.different} different, ${rb.noRef} without a reference`);
  log('palettes: ' + Object.entries(report.palettes).map(([k, v]) => `${k} ${v.ok ? 'ok' : 'FAIL'}`).join(', '));
  if (report.fessenden) log(`fessenden attach: ${report.fessenden.check.within1px}/${report.fessenden.check.frames} logged frames within ±1 px; order ${bodiesOut.fessenden.order.join(' < ')} (${bodiesOut.fessenden.orderSource})`);
  if (report.morganThrow) log(`morgan throw: ${report.morganThrow.found ? `${report.morganThrow.anim} frame ${report.morganThrow.frame} (${report.morganThrow.sameFrame}/${report.morganThrow.creations} creations)` : 'not found, fallback recorded'}`);
  for (const wn of report.warnings.slice(0, 20)) log('  warning: ' + wn);
  return { files, report };
}
function usedSlotsOf(B, animsOut, done, fid) {
  const s = new Set();
  for (const o of Object.values(animsOut)) { if (o.id !== B.id) continue; for (const fr of o.a.frames) { const e = done.list[fid.get(new E.FrameBook().sig(fr.parts))]; if (e) e.img.slots.forEach(x => s.add(x)); } }
  return [...s].sort((a, b) => a - b);
}
// FrameBook.finish with extra pre-rendered indexed images (the Crown Engine)
function finishWithExtras(fb, extras, opts) {
  const atlas = require('./atlas-pack.cjs');
  const list = [...fb.bySig.values()].sort((a, b) => a.parts[0].rec - b.parts[0].rec || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0));
  list.forEach(e => { const full = E.composeIdx(e.parts); e.full = full; e.img = E.trim(full); e.flags = (full.shadow ? 1 : 0) | (e.parts.length > 1 ? 2 : 0); });
  for (const [sig, cv] of Object.entries(extras)) { const img = E.trim(cv); list.push({ sig, parts: [{ rec: -1, dx: 0, dy: 0 }], owners: new Set(['crownEngine']), img, flags: 4, extra: true }); }
  list.forEach((e, i) => { e.id = i; });
  // one sheet set per body (a fight colours only its own body's sheets, PLAN R4); the Crown Engine on sheet 'crown'
  return E.packGrouped(list, { prefix: opts.prefix, max: opts.max, pad: opts.pad, sort: opts.sort, groupOf: e => (e.extra ? 'crown' : [...e.owners].sort()[0]), sheetId: (g, si) => (g === 'crown' ? 'crown' : `${opts.prefix}-${g}${si ? '-' + (si + 1) : ''}`) });
}
function readBackBody(B, animsOut, done, fid, decoded, rgba) {
  const res = { checked: 0, identical: 0, different: 0, noRef: 0, examples: [] };
  if (!B.atlas) { res.noRef = -1; return res; }
  const seen = new Set(), P = B.json.palette;
  const map = E.objMapArray(P.episodeArea[0], P.episodeArea[1], null);
  for (const o of Object.values(animsOut)) {
    if (o.id !== B.id) continue;
    for (const fr of o.a.frames) {
      const sig = new E.FrameBook().sig(fr.parts); if (seen.has(sig)) continue; seen.add(sig);
      let ov = null;
      const ref = E.composeRef(fr.parts, rec => { const c = (B.atlas.byRec.get(rec) || [])[0]; if (!c) return null; c.atlasImg = B.atlas.img; const ri = E.recInfo(rec), native = [...new Set(ri.blocks.map(b => b.pal))]; if (c.palSlots && c.palSlots.length === 1 && !(native.length === 1 && native[0] === c.palSlots[0])) ov = c.palSlots[0]; return c; });
      if (!ref) { res.noRef++; continue; }
      res.checked++;
      const e = done.list[fid.get(sig)], item = rgba ? e.img : E.itemFromSheet(decoded[e.sheet], e);
      const c = E.compareAligned(ref, item, E.colourise(item, slot => PAL().rowRGB(map[slot]), ov));
      if (c.ok) res.identical++; else { res.different++; if (res.examples.length < 8) res.examples.push({ sig, bad: c.bad, first: c.first, mine: c.mine, theirs: c.theirs }); }
    }
  }
  return res;
}
function cellOf(e, decoded, rowsOf, cap) { const item = E.itemFromSheet(decoded[e.sheet], e); return { img: item, rgba: E.colourise(item, rowsOf, null), caption: cap }; }
function writeBossSheets(bodies, animsOut, done, fid, decoded, pb, bodiesOut, ids) {
  const files = [];
  if (fs.existsSync(PACK_DIR)) for (const f of fs.readdirSync(PACK_DIR)) if (/^bosses-.*.png$/.test(f)) fs.rmSync(path.join(PACK_DIR, f));
  for (const id of ids) {
    const B = bodies[id], mk = bodiesOut[id].pal[bodiesOut[id].use] || bodiesOut[id].home, rowsOf = pb.rowsOf(mk), rows = [];
    for (const k of Object.keys(animsOut).filter(k => animsOut[k].id === id).sort((a, b) => { const A = animsOut[a].a, Bb = animsOut[b].a; return (A.set < Bb.set ? -1 : A.set > Bb.set ? 1 : 0) || A.index - Bb.index; })) {
      const a = animsOut[k].a;
      rows.push({ title: `${id} ${k} (${bodiesOut[id].use})\n${a.kind} ${a.label}`.slice(0, 120), cells: a.frames.map((fr, i) => { const e = done.list[fid.get(new E.FrameBook().sig(fr.parts))]; return cellOf(e, decoded, rowsOf, `${i}:${e.parts[0].rec}${e.parts.length > 1 ? '+' : ''} ${fr.dur}${fr.active ? '*' : ''}`); }) });
    }
    const per = 50;
    for (let i = 0; i < rows.length; i += per) { const f = path.join(PACK_DIR, rows.length > per ? `bosses-${id}-${i / per + 1}.png` : `bosses-${id}.png`); E.contactSheet(f, rows.slice(i, i + per), { cellW: 150, cellH: 150, maxCols: 10, title: `${id} (${B.spec.src}) palette ${bodiesOut[id].use}` }); files.push(f); }
  }
  return files;
}
// boss-palettes.png: per new character, the original palette next to the sequel palette on the same frames, with the
// swatches of the changed slots and the ENEMIES §6.1 verdict (kept pens, deliberate recolours). Also the Crown Engine
// (crown), the BROOD MOTHER (drowned, from the shipped enemies family) and the unfinished copies (half, from the shipped
// heroes family) so all nine sequel palettes are on one sheet.
function verdictOf(acc) {
  if (!acc) return null;
  const a = Object.entries(acc.accept || {});
  const min = Math.min(...a.map(([, x]) => Math.min(...x.changedVsEachOriginal)));
  const kept = a.map(([s, x]) => `${s}:${x.keepPens.join('.')}`).join(' '), rec = a.filter(([, x]) => (x.recoloured || x.recolour || []).length).map(([s, x]) => `${s}:${(x.recoloured || x.recolour).join('.')}`).join(' ');
  return `${acc.ok ? 'ACCEPT' : 'REJECT'} min changed ${min}/15\nkept ${kept}${rec ? `\nrecoloured ${rec}` : ''}`;
}
function swatchCell(rowsList, caption) {
  const sw = E.canvasRGBA(16 * 8, Math.max(1, rowsList.length) * 8);
  rowsList.slice(0, 8).forEach((r, si) => { for (let p = 0; p < 16; p++) E.fillRect(sw, p * 8, si * 8, 8, 8, [(r[p] >> 16) & 255, (r[p] >> 8) & 255, r[p] & 255]); });
  return { img: { w: sw.w, h: sw.h, ox: Math.floor(sw.w / 2), oy: sw.h }, rgba: sw.d, caption };
}
// a frame of another shipped family (sheet pixels R = slot, G = pen) coloured through one of its maps
function famCell(F, decodedSheets, sheet, r, mapKey, caption) {
  const im = decodedSheets[sheet] || (decodedSheets[sheet] = png.fromDataURL(F.sheets[sheet].png));
  const [sx, sy, w, h, ox, oy] = r, item = { w, h, ox, oy, pen: new Uint8Array(w * h), slot: new Uint8Array(w * h), set: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((sy + y) * im.width + sx + x) * 4, d = y * w + x; if (!im.rgba[s + 3]) continue; item.slot[d] = im.rgba[s]; item.pen[d] = im.rgba[s + 1]; item.set[d] = 1; }
  const m = F.pal.maps[mapKey];
  return { img: item, rgba: E.colourise(item, slot => F.pal.rows[String(m[slot])] || new Array(16).fill(0xff00ff), null), caption };
}
function writePaletteSheet(bodies, bodiesOut, done, fid, decoded, pb, cfg, report) {
  const rows = [];
  for (const sh of cfg.paletteSheet) {
    const o = bodiesOut[sh.body]; if (!o) continue;
    const keys = sh.anims.map(k => k.replace(/^main:/, o.main + ':'));
    const frameOf = (k, i) => { const a = bodies[sh.body].anims.get(k); if (!a) return null; const fr = a.frames[Math.min(i, a.frames.length - 1)]; return done.list[fid.get(new E.FrameBook().sig(fr.parts))]; };
    for (const pname of sh.palettes) {
      const mk = pname === 'home' ? o.home : o.pal[pname]; if (!mk) continue;
      const rowsOf = pb.rowsOf(mk), acc = report.palettes[pname];
      const cells = keys.map((k, j) => { const e = frameOf(k, sh.frames ? sh.frames[j] : 0); return e ? cellOf(e, decoded, rowsOf, k.replace(/^0x[0-9A-F]+/, 'm')) : null; }).filter(Boolean);
      const slots = acc ? Object.keys(acc.accept).map(Number) : [];
      cells.push(swatchCell(slots.map(s => rowsOf(s)), 'slots ' + slots.join(',')));
      rows.push({ title: `${sh.title}: ${pname}\n${verdictOf(acc) || (pname === 'home' ? 'original (ROM)' : 'ROM context')}`, cells });
    }
  }
  // crown: the Crown Engine bake in its E8a3 rows and the sequel rows
  const ce = bodiesOut.crownEngine;
  if (ce) for (const [label, mk] of [['home (E8a3 scroll2 rows)', ce.pal.home], ['crown', ce.pal.crown], ['crown-dark (cracked)', ce.pal.dark]]) {
    const rowsOf = pb.rowsOf(mk), cells = ['ce-idle', 'ce-cracked'].map(sig => cellOf(done.list[fid.get(sig)], decoded, rowsOf, sig));
    const crownRows = (report.crown && report.crown.rows) || {};
    cells.push(swatchCell(Object.keys(crownRows).map(r => rowsOf(+r)), 'rows ' + Object.keys(crownRows).join(',')));
    rows.push({ title: `CROWN ENGINE: ${label}\n${label === 'crown' && report.palettes.crown ? `${report.palettes.crown.ok ? 'ACCEPT' : 'REJECT'} ${report.palettes.crown.summary}` : label.startsWith('home') ? 'original (ROM)' : 'state variant'}`, cells });
  }
  // drowned: the BROOD MOTHER on the TYROG body (enemies family, palMap kingkimo:A/brood)
  try {
    const EN = emit.load(path.join(ROOT, 'sprite-data-enemies.js')).SPRITE_DATA.families.enemies, dec = {};
    const er = fs.existsSync(path.join(PACK_DIR, 'enemies-report.json')) ? readJSON(path.join(PACK_DIR, 'enemies-report.json')) : null, acc = er && er.palettes && er.palettes.drowned;
    const v = EN.types.kingkimo.variants.A, picks = [[0, 0], [20, 1], [22, 0], [25, 0], [3, 2]];
    for (const [label, mk] of [['TYROG ch6 (kingkimo:A/29, KI13)', EN.palMap['kingkimo:A/29']], ['drowned (kingkimo:A/brood)', EN.palMap['kingkimo:A/brood']]]) {
      if (!mk) continue;
      const cells = picks.map(([i, k]) => { const a = EN.anims[`${v.main}:${i}`]; if (!a) return null; const fr = EN.frames[a.f[Math.min(k, a.f.length - 1)][0]]; return famCell(EN, dec, fr[0], fr.slice(1, 7), mk, `m:${i}`); }).filter(Boolean);
      cells.push(swatchCell([EN.pal.rows[String(EN.pal.maps[mk][0])]], 'uniform row'));
      const vd = label.startsWith('drowned') && acc ? `${acc.ok ? 'ACCEPT' : 'REJECT'} min changed ${Math.min(...acc.accept.changed)}/15\nkept ${acc.accept.keepPens.join('.')}` : 'original (ROM)';
      rows.push({ title: `BROOD MOTHER: ${label}\n${vd}`, cells });
    }
  } catch (e) { report.warnings.push('boss-palettes.png: no BROOD MOTHER row (' + e.message + ')'); }
  // half: the unfinished copies of LOT 04 (heroes family, WP-B: the hero row at 60 % saturation, exempt from the clothing test)
  try {
    const HE = emit.load(path.join(ROOT, 'sprite-data-heroes.js')).SPRITE_DATA.families.heroes, dec = {};
    for (const [label, pre] of [['hero-<id> (original)', 'hero-'], ['half-<id>', 'half-']]) {
      const cells = [];
      for (const id of ['jack', 'hannah', 'mustapha', 'mess']) { const recs = Object.keys(HE.rect[id] || {}).map(Number).sort((a, b) => a - b); if (!recs.length || !HE.pal.maps[pre + id]) continue; cells.push(famCell(HE, dec, id, HE.rect[id][String(recs[0])], pre + id, `${id} ${recs[0]}`)); }
      if (cells.length) rows.push({ title: `UNFINISHED COPIES (half): ${label}\n${pre === 'half-' ? 'WP-B row effect (60 % sat.)' : 'original (ROM)'}`, cells });
    }
  } catch (e) { report.warnings.push('boss-palettes.png: no half row (' + e.message + ')'); }
  const file = path.join(PACK_DIR, 'boss-palettes.png');
  E.contactSheet(file, rows, { cellW: 214, cellH: 156, maxCols: 6, title: 'Sequel palettes: original (home) vs sequel; ENEMIES §6.1 acceptance per row' });
  return file;
}
// LOT 00 assembled from the attach table: body frame + every part (its idle pose) at the logged offset, in the shipped order
function writeLot00Sheet(bodies, bodiesOut, done, fid, decoded, pb) {
  const o = bodiesOut.fessenden; if (!o) return null;
  const rowsOf = pb.rowsOf(o.home), B = bodies.fessenden;
  const partAnim = { arm: '0x647D8:0', arm2: '0x648AA:0', neckA: '0x646A4:0', neckB: '0x646A4:0', line: '0x712A0:0', body: null };
  const frameImg = key => { const [set, idx, fr] = key.split(':'); const a = B.anims.get(`${set}:${idx}`); if (!a) return null; const f = a.frames[+fr || 0]; const e = done.list[fid.get(new E.FrameBook().sig(f.parts))]; const item = E.itemFromSheet(decoded[e.sheet], e); return { item, rgba: E.colourise(item, rowsOf, null) }; };
  const cells = [];
  for (const bk of ['0x64452:0:0', '0x64452:1:2', '0x64452:5:1', '0x64452:6:1', '0x64452:7:1', '0x312F4:2:3']) {
    const att = o.attach[bk]; if (!att) continue;
    const layers = o.order.map(p => ({ p, im: p === 'body' ? frameImg(bk) : frameImg(partAnim[p] + ':0'), off: p === 'body' ? [0, 0] : (att[p] || null) })).filter(l => l.im && l.off);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const l of layers) { x0 = Math.min(x0, l.off[0] - l.im.item.ox); y0 = Math.min(y0, l.off[1] - l.im.item.oy); x1 = Math.max(x1, l.off[0] - l.im.item.ox + l.im.item.w); y1 = Math.max(y1, l.off[1] - l.im.item.oy + l.im.item.h); }
    const w = x1 - x0, h = y1 - y0, rgba = new Uint8Array(w * h * 4);
    for (const l of layers) for (let y = 0; y < l.im.item.h; y++) for (let x = 0; x < l.im.item.w; x++) { const s = (y * l.im.item.w + x) * 4; if (!l.im.rgba[s + 3]) continue; const d = ((l.off[1] - l.im.item.oy - y0 + y) * w + l.off[0] - l.im.item.ox - x0 + x) * 4; rgba.set(l.im.rgba.subarray(s, s + 4), d); }
    cells.push({ img: { w, h, ox: -x0, oy: -y0 }, rgba, caption: bk });
  }
  const file = path.join(PACK_DIR, 'lot00-attach.png');
  E.contactSheet(file, [{ title: `LOT 00 assembled\nparts at the attach offsets, order ${o.order.join(' < ')}`, cells }], { cellW: 260, cellH: 230, maxCols: 6, title: 'LOT 00 FESSENDEN: body frame + arm, arm2, necks (idle poses) from bodies.fessenden.attach' });
  return file;
}
function writeCrownSheet(ce, done, fid, decoded, pb) {
  const rows = [];
  for (const [name, maps] of [['home rows', ['crown-home']], ['crown', ['crown']], ['cracked (dark)', ['crown-dark']]]) {
    const cells = [];
    for (const sig of ['ce-idle', 'ce-cracked']) { const e = done.list[fid.get(sig)]; cells.push(cellOf(e, decoded, pb.rowsOf(maps[0]), sig)); }
    rows.push({ title: `crown engine: ${name}`, cells });
  }
  const file = path.join(PACK_DIR, 'crown-engine.png');
  E.contactSheet(file, rows, { cellW: 300, cellH: 170, maxCols: 2, title: 'Crown Engine bake (E8a3 scroll2 cells, pen 15 transparent), magenta = feet origin' });
  return file;
}

module.exports = { build, fessAttach, fessOrder, morganThrow, crownEngine, bossPalette };

if (require.main === module) {
  const r = build({ rgba: process.argv.includes('--rgba') });
  if (process.argv.includes('--json')) console.log(JSON.stringify(r.report.summary, null, 1));
}
