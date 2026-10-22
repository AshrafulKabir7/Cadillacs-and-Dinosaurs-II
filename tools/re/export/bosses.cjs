#!/usr/bin/env node
// Boss & dinosaur export for the original Cadillacs & Dinosaurs (MAME "dino", the user's own ROM set).
//   node tools/re/export/bosses.cjs            -> work/re/extract/bosses/  (deterministic; reads the ROM and the live logs)
//   node tools/re/export/bosses.cjs --only vice-t,butcher
// Live logs come from tools/re/export/bosses-live.cjs (MAME runs, work/re/extract/bosses/live/*.json). Without them
// the static part (sets, records, atlases, HP tables) is still exported and the live sections stay empty.
//
// Per entity:  <id>.json            catalogue entry, HP, palettes, anims (labelled), live usage, damage, validation
//              <id>-atlas.png/.json record atlas (RGBA, ROM palettes at full brightness, transparent, native LEFT-facing)
//              <id>-sheet.png       contact sheet: one row per animation, frames left to right, feet on a baseline
//              <id>-<variant>-atlas.png  extra atlases for palette variants (e.g. the three Tyrog colours)
// Plus INDEX.md (episode -> boss, mid-bosses, dinosaurs) and index.json.
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./bosses-lib.cjs'), R = L.R;
const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'work/re/extract/bosses');
const LIVE = path.join(OUT, 'live');
const hex = (v, w = 0) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(w, '0');

// ---------------------------------------------------------------------------------------------------------------
// ROM tables (addresses verified in MEMORY-MAP.md or traced for this export; evidence ids in EVIDENCE below)
// ---------------------------------------------------------------------------------------------------------------
const NAME_TABLE = 0x17D78;        // R9: HUD enemy names, word offsets from the table start; 39 entries (0..0x26)
const DISPATCH = { B: 0x2346C, C: 0x2362E, A: 0x233F0, D: 0x237E6 };
const DISPATCH_LEN = { B: 102, C: 97, A: 12, D: 42 };
const REACT_GRAB = 0x2E724, REACT_HIT = 0x2E68C;   // V18, indexed by obj+0x84 (x4 index)
const BOSS_HP = 0x31E52;           // 0x31E14: D0*48 + players*16 + ((rank & 0x1C) >> 1); HP; +0x6A = min(HP,100)
const REG_HP = 0x31454;            // 0x31424: +0x03*64 + rank*2
const ENEMY_DMG = 0xA2EA4;         // 0x116B2: 8 bytes per attack id (attacker +0x58): damage, stun, reaction, ...
const DMG_RANK = 0x2C3AE;          // 0x6436: damage *= byte[0x2C3AE + (+0x84)*8 + (rank & 0x1F)] / 32
const PAL_AREA = 0x8E8E;           // 0x8E4C: [stage*16 + area*4] -> 32 ROM palette row indices for the OBJ slots
const PAL_ROWS = 0xB7A52;          // row r = 16 BRGB words at 0xB7A52 + r*32 (H06), copied verbatim to 0x914000

function nameOf(i) {
  if (i < 0 || i > 0x26) return null;
  const a = NAME_TABLE + R.s16(NAME_TABLE + i * 2); let s = '';
  for (let p = a + 1; p < a + 20; p++) { const c = R.prg[p]; if (c === 0x40) break; s += String.fromCharCode(c); }
  return s.trim();
}
const handlerOf = (pool, type) => R.u32(DISPATCH[pool] + type) >>> 0;
const ALL_HANDLERS = (() => { const s = new Set(); for (const p of Object.keys(DISPATCH)) for (let i = 0; i < DISPATCH_LEN[p]; i++) { const h = R.u32(DISPATCH[p] + i * 4); if (h && h < R.prg.length) s.add(h); } return [...s].sort((a, b) => a - b); })();
const handlerEnd = h => ALL_HANDLERS.find(x => x > h) || h + 0x2000;
function bossHpTable(idx) { const rows = []; for (let p = 0; p < 3; p++) { const r = []; for (let k = 0; k < 8; k++) r.push(R.u16(BOSS_HP + idx * 48 + p * 16 + k * 2)); rows.push(r); } return rows; }
function regHpRow(b03) { const r = []; for (let k = 0; k < 32; k++) r.push(R.u16(REG_HP + b03 * 64 + k * 2)); return r; }
function paletteRows(stage, area) { const p = R.u32(PAL_AREA + (stage - 1) * 16 + area * 4); const rows = []; for (let k = 0; k < 32; k++) rows.push(R.u16(p + k * 2)); return { table: p, rows }; }
// Colours at full brightness (H06: gameplay runs at brightness F; some ROM rows store brightness 0 and are shown at F).
function romRowRGB(row) { const out = []; for (let k = 0; k < 16; k++) { const w = R.u16(PAL_ROWS + row * 32 + k * 2); out.push([((w >> 8) & 15) * 17, ((w >> 4) & 15) * 17, (w & 15) * 17]); } return out; }
function romRowWords(row) { const out = []; for (let k = 0; k < 16; k++) out.push(R.u16(PAL_ROWS + row * 32 + k * 2)); return out; }
function damageRecord(id) { const a = ENEMY_DMG + id * 8; return { attackId: id, addr: hex(a), damage: R.prg[a], stun: R.prg[a + 1], reaction: R.prg[a + 2], b3: R.prg[a + 3], b4: R.prg[a + 4], b5: R.prg[a + 5], b6: R.prg[a + 6], b7: R.prg[a + 7] }; }
function rankRow(r84) { const out = []; for (let k = 0; k < 32; k++) out.push(R.prg[DMG_RANK + r84 * 8 + k]); return out; }

// Byte-pattern scan of a handler range (68000 opcodes): sets, name index, reaction index, palette override, HP init.
function scanHandler(start, end) {
  const out = { sets: new Set(), b03: new Set(), r84: new Set(), p23: new Set(), bossHp: new Set(), regHp: false, spawns: new Set() };
  for (let a = start; a < end - 8; a += 2) {
    const w = R.u16(a);
    if (w === 0x2D7C && R.u16(a + 6) === 0x0040) { const v = R.u32(a + 2); if (v > 0x400 && v < R.prg.length) out.sets.add(v); }
    if (w === 0x1D7C && R.u16(a + 4) === 0x0003) out.b03.add(R.u16(a + 2) & 0xFF);
    if (w === 0x3D7C && R.u16(a + 4) === 0x0084) out.r84.add(R.u16(a + 2));
    if (w === 0x1D7C && R.u16(a + 4) === 0x0023) out.p23.add(R.u16(a + 2) & 0xFF);
    if ((w & 0xFF00) === 0x7000 && R.u16(a + 2) === 0x4EB9 && R.u32(a + 4) === 0x31E14) out.bossHp.add(w & 0xFF);
    if (w === 0x4EB9 && R.u32(a + 2) === 0x31424) out.regHp = true;
    if (w === 0x317C && R.u16(a + 4) === 0x0020) out.spawns.add(R.u16(a + 2));   // move.w #type,($20,A0) after an alloc
  }
  return { sets: [...out.sets], b03: [...out.b03], r84: [...out.r84], p23: [...out.p23], bossHp: [...out.bossHp], regHp: out.regHp, spawns: [...out.spawns] };
}

// ---------------------------------------------------------------------------------------------------------------
// Catalogue. objs: the pool-B objects that make up the entity (type = obj+0x20; b03 = obj+0x03 name index when it
// identifies the variant). pal: [episode, area] whose OBJ palette rows colour the atlas (where it is met in the game).
// Episode / role are OBSERVED in the stage walks (bosses-live.cjs stage*) unless marked inferred.
// ---------------------------------------------------------------------------------------------------------------
const ENTITIES = [
  { id: 'vice-t', name: 'VICE T.', group: 'boss', episode: 1, pal: [1, 2], objs: [{ type: 0x48, b03: 0x0C }], sets: [0x438F2], r84: [0x30], hpKind: 'boss', debugName: 'N.Richmond (sub 0x000)',
    role: 'Episode 1 boss (CITY IN THE JUNGLE, last area). Enters with R HOPPER (Dinonics, type 0x74) on a chain (pool D type 0x50, set 0x945CC).', companions: ['dinonics', 'vice-chain'] },
  { id: 'vice-chain', name: '(chain)', group: 'boss-part', episode: 1, pal: [1, 2], objs: [{ pool: 'D', type: 0x50 }], role: 'Effect object (pool D type 0x50) drawn between VICE T. and his R HOPPER; seen only in the Vice T. fight.' },
  { id: 'walther', name: 'WALTHER', group: 'mid-boss', episode: null, pal: [8, 2], objs: [{ type: 0x48, b03: 0x0D }], sets: [0x43E54], r84: [0x34], hpKind: 'regular', debugName: 'N.Richmond (sub 0x200)',
    role: 'Vice T. palette-swap mid-boss / heavy regular (same code, set 0x43E54). Met in episodes 3, 5 and 8 (two at once in E8).' },
  { id: 'butcher', name: 'BUTCHER', group: 'boss', episode: 2, pal: [2, 2], objs: [{ type: 0xF4 }], debugName: 'Plaso', role: 'Episode 2 boss (THE SWAMP FOREST, last area). Machete fighter.' },
  { id: 'hogg', name: 'HOGG', group: 'boss', episode: 3, pal: [3, 0], objs: [{ type: 0x7C }, { type: 0x80 }], debugName: '3 Boss / 3 Boss Bike',
    role: 'Episode 3 boss (HELL ROAD, the Cadillac stage): rides in on a motorcycle (type 0x80 is the bike) and fights from it.' },
  { id: 'slice', name: 'SLICE', group: 'boss', episode: 4, pal: [4, 2], objs: [{ type: 0x64 }], role: "Episode 4 boss (JACK'S GARAGE, last area). Knife fighter." },
  { id: 'morgan', name: 'MORGAN', group: 'boss', episode: 5, pal: [5, 1], objs: [{ type: 0x90 }, { type: 0x8C }], debugName: 'Pakike Falo / Pakike (DEMO)',
    role: 'Episode 5 boss, first form (VILLAGE OF FLAME). The debug name "Pakike Falo" is misleading: the object is MORGAN (name 0x15, boss HP index 4). After his HP runs out he mutates into MORGUE.' },
  { id: 'morgue', name: 'MORGUE', group: 'boss', episode: 5, pal: [5, 1], objs: [{ type: 0xA0 }], debugName: 'Pakike (AFTER)', role: 'Episode 5 boss, second (mutated) form of MORGAN.' },
  { id: 'tyrog', name: 'TYROG', group: 'boss', episode: 6, pal: [6, 2], objs: [{ type: 0x10 }, { type: 0x120 }, { type: 0x12C }, { type: 0x130 }], debugName: 'KING KIMO KIMO / King K.K. (S) / KING K.K. DEMO2 objects',
    role: 'Episode 6 boss(es) (JUNGLE AND MINE, last area): several TYROGs in different colours. Types 0x12C/0x130 are the KING K.K. DEMO2 transformation cut-scene (a poacher mutating into a Tyrog).' },
  { id: 'tyrog-2', name: 'TYROG 2', group: 'mid-boss', episode: 8, pal: [8, 3], objs: [{ type: 0x16C }], debugName: 'TYROG 2', role: 'Tyrog variant with its own name and code (0x654E2): mid-boss of episode 8, area 0 (stage walk). Regular HP table.' },
  { id: 'slisaur', name: 'SLISAUR', group: 'boss', episode: 7, pal: [7, 3], objs: [{ type: 0x11C }], role: "Episode 7 boss: two SLISAURs (Fessenden's re-created Slice) fought together in the lab." },
  { id: 'fessenden-1', name: 'FESSENDEN', group: 'boss', episode: 8, pal: [8, 3], objs: [{ type: 0x178 }, { type: 0x170 }, { type: 0x174 }, { type: 0x17C }], debugName: 'PAKIKE 2',
    role: 'Episode 8 boss, first form (THE UNDER WORLD): Fessenden mutated into a Morgue-like beast (re-uses the MORGUE set 0x6EA48 with its own palette), name index 0x25.' },
  { id: 'fessenden', name: 'FESSENDEN', group: 'boss', episode: 8, pal: [8, 3], objs: [{ type: 0x150 }, { type: 0x154 }, { type: 0x158 }, { type: 0x15C }, { type: 0x160 }, { type: 0x164 }], debugName: '8 BOSS',
    role: 'Final boss, last form: a giant dinosaur built from separate objects (body 0x150, clawed arms 0x158/0x15C, two snake-headed necks 0x160/0x164, line object 0x154) that share one HP pool.' },
  { id: 'boss-projectiles', name: '(thrown objects)', group: 'boss-part', episode: null, pal: [5, 1], objs: [{ type: 0x68 }, { type: 0x110 }],
    role: 'Objects bosses throw or spit (set 0x71408). Type 0x110 is spawned only by MORGAN (0x52528): knife (sub 2), rock (sub 3), stone (sub 4), each spinning then lying. Type 0x68 is spawned by MORGAN (0x52012, sub 0: grenade), TYROG (0x37574 / 0x375D2) and TYROG 2 (0x65FA2 / 0x66000): sub 3 fireball -> explosion, sub 4 green acid blob -> splash; also by hero code (0x611A) and a pool-C cut-scene (0x7EC30).' },
  // dinosaurs
  { id: 'dinonics', name: 'R HOPPER', group: 'dinosaur', episode: null, pal: [5, 0], objs: [{ type: 0x74 }], debugName: 'Dinonics', role: 'Raptor (Deinonychus). Hostile; also the chained raptor of VICE T. in E1.' },
  { id: 'arosaurus', name: 'SHIVAT', group: 'dinosaur', episode: null, pal: [5, 0], objs: [{ type: 0x60 }], debugName: 'Arosaurus', role: 'Allosaurus. Sleeps until woken, then hostile.' },
  { id: 'torikeratopss', name: 'MACK', group: 'dinosaur', episode: null, pal: [2, 0], objs: [{ type: 0x98 }], debugName: 'Torikeratopss / TorikeraB(Jump) / TorikeraC(Sleep)', role: 'Triceratops. Subtype 0x000 normal, 0x200 jumps in, 0x400 sleeping (calm until woken).' },
  { id: 'pteranodon', name: 'ZEKE', group: 'dinosaur', episode: null, pal: [5, 0], objs: [{ type: 0x148 }], debugName: 'Pteranodon', role: 'Pteranodon: swoops over the play field.' },
  { id: 'pteranodon-bg', name: '(pteranodon)', group: 'dinosaur', episode: null, pal: [2, 0], objs: [{ type: 0x94 }], role: 'Non-interactive pteranodon (type 0x94, set 0x5326A); scenery.' },
  { id: 'ankirosaurs', name: '(ankylosaurus)', group: 'dinosaur', episode: null, pal: [2, 0], objs: [{ type: 0x138 }], debugName: 'Ankirosaurs', role: 'Ankylosaurus; no HUD name or HP (harmless).' },
  { id: 'maiasura', name: '(maiasaura)', group: 'dinosaur', episode: null, pal: [2, 0], objs: [{ type: 0x140 }], debugName: 'Maiasura', role: 'Maiasaura; no HUD name or HP (harmless).' },
  { id: 'naguri', name: 'HAMMER T. / BLK ELMER / WRENCH T.', group: 'regular', episode: null, pal: [5, 0], objs: [{ type: 0x13C }], debugName: 'Dinosaurs Naguri',
    role: 'Fat poacher brawler (Hutori look-alike with its own code); the debug name means "dinosaur puncher": a haymaker brawler met around dinosaurs (E2, E5). Not a dinosaur itself; listed here because of the debug name.' },
  { id: 'archaeopteryx', name: '(archaeopteryx)', group: 'dinosaur', episode: null, pal: [1, 2], objs: [{ type: 0xC8 }, { type: 0xB8 }], debugName: 'SISOCYOU 1 (pool C controller 0x120 spawns types 0xB8/0xC8)',
    role: 'Flying archaeopteryx flocks (scenery).' },
  { id: 'giant-foot', name: '(giant dinosaur foot)', group: 'dinosaur', episode: null, pal: [6, 1], objs: [{ type: 0x58 }, { type: 0x5C }], role: 'Stomping foot of an off-screen giant dinosaur (0x58, HP 100) with its shadow (0x5C).' },
  { id: 'small-raptor', name: '(small raptor)', group: 'dinosaur', episode: null, pal: [1, 2], objs: [{ type: 0x70 }], role: 'Small raptor (set 0x4DBA0).' },
  { id: 'yellow-dino', name: '(large dinosaur)', group: 'dinosaur', episode: null, pal: [2, 0], objs: [{ type: 0x78 }], r84: [], role: 'Single-pose large yellow dinosaur (set 0x4FC22, record 1621); no name, its handler only clears +0x84, so no reaction sets.' },
];
const EVIDENCE = {};   // filled from work/re/extract/bosses/evidence/*.json (rea records), see bosses-rea.sh

// ---------------------------------------------------------------------------------------------------------------
// live logs
// ---------------------------------------------------------------------------------------------------------------
function loadLive() {
  const runs = {};
  if (!fs.existsSync(LIVE)) return runs;
  for (const f of fs.readdirSync(LIVE).filter(f => f.endsWith('.json')).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(LIVE, f), 'utf8'));
    runs[j.meta.id] = j;
  }
  return runs;
}
const FI = {}; ['pool', 'slot', 'type', 'sub', 'b03', 'b00', 'b04', 'b05', 'b06', 'b07', 'fp', 'set', 'hpMax', 'hp', 'p23', 'face', 'x', 'h', 'd', 'f25', 't2f', 'lp', 'tdx', 'tdy', 'f53', 'c4c', 'c4d', 'f2e', 'b01', 'atk58'].forEach((k, i) => FI[k] = i);
// (episode, area) whose palette rows a spawn run painted (tools/re/export/bosses-live.cjs RUNS_LIST pal)
const LIVE_RUNS = require('./bosses-live.cjs').RUNS_LIST;
function spawnPal(run) { const r = LIVE_RUNS.find(x => x.id === run.meta.id); return r && r.pal ? r.pal : null; }
function matchObj(o, spec) { return (spec.pool || 'B') === o[FI.pool] && o[FI.type] === spec.type && (spec.b03 === undefined || o[FI.b03] === spec.b03); }

// ---------------------------------------------------------------------------------------------------------------
// animation indexing
// ---------------------------------------------------------------------------------------------------------------
const setCache = new Map();
function setOf(T) { if (!setCache.has(T)) setCache.set(T, L.decodeSet(T)); return setCache.get(T); }
function frameIndex(sets) { // frame address -> [{set, anim, k}]
  const idx = new Map();
  for (const T of sets) for (const an of setOf(T)) { if (an.bad) continue; an.frames.forEach((f, k) => { const e = idx.get(f.addr) || []; e.push({ set: T, anim: an.index, k, start: an.addr }); idx.set(f.addr, e); }); }
  return idx;
}

function framePartsOf(f) { // -> [{rec, dx, dy}] screen offsets (y down), native left-facing; first part is in front
  if (f.comp) return f.parts.map(p => ({ rec: p.rec, dx: p.dx, dy: -p.dy }));
  const out = [{ rec: f.rec, dx: 0, dy: 0 }]; if (f.rec2 != null) out.push({ rec: f.rec2, dx: 0, dy: 0 }); return out;
}
function exportFrame(f) {
  const parts = framePartsOf(f);
  const o = { rec: parts[0].rec };
  if (parts[0].dx || parts[0].dy) { o.dx = parts[0].dx; o.dy = parts[0].dy; }
  o.rec2 = parts[1] ? parts[1].rec : null;
  if (parts[1] && (parts[1].dx || parts[1].dy)) { o.dx2 = parts[1].dx; o.dy2 = parts[1].dy; }
  if (parts.length > 2) o.parts = parts;
  o.dur = f.dur;
  if (f.comp) o.composite = true;
  if (f.b4 || f.b5 || f.b6) { o.b4 = f.b4; o.b5 = f.b5; o.b6 = f.b6; }
  if (f.w8) o.w8 = f.w8;
  if (f.end) o.last = true;
  o.addr = hex(f.addr);
  return o;
}

// ---------------------------------------------------------------------------------------------------------------
// labels (filled after reviewing the contact sheets and the live state bytes; see LABELS.md notes in INDEX.md)
// ---------------------------------------------------------------------------------------------------------------
const LABELS = require('./bosses-labels.cjs');

// ---------------------------------------------------------------------------------------------------------------
function analyseEntity(E, runs) {
  // 1. static
  const handlers = E.objs.map(s => ({ pool: s.pool || 'B', type: s.type, handler: handlerOf(s.pool || 'B', s.type) }));
  const scans = handlers.map(h => ({ ...h, end: handlerEnd(h.handler), scan: scanHandler(h.handler, handlerEnd(h.handler)) }));
  const sets = new Set(), r84 = new Set(), b03s = new Set(), p23s = new Set(), bossHp = new Set();
  let regHp = false;
  for (const s of scans) { (E.sets || s.scan.sets).forEach(x => sets.add(x)); (E.r84 || s.scan.r84).forEach(x => r84.add(x)); s.scan.b03.forEach(x => b03s.add(x)); s.scan.p23.forEach(x => p23s.add(x)); s.scan.bossHp.forEach(x => bossHp.add(x)); regHp = regHp || s.scan.regHp; }
  // keep only static sets that decode
  for (const T of [...sets]) if (!setOf(T).length) sets.delete(T);

  // 2. live: collect object frames
  const live = { runs: [], frames: 0, setsSeen: new Map(), p23: new Map(), hp: [], b03: new Map(), atk: new Map(), firstSeen: [] };
  const perRun = [];
  for (const [rid, run] of Object.entries(runs)) {
    let hit = false; const tracks = new Map();
    for (const fr of run.log) {
      for (const o of fr.o) {
        if (!E.objs.some(s => matchObj(o, s))) continue;
        hit = true; live.frames++;
        if (o[FI.set] && o[FI.set] < R.prg.length) live.setsSeen.set(o[FI.set], (live.setsSeen.get(o[FI.set]) || 0) + 1);
        live.p23.set(o[FI.p23], (live.p23.get(o[FI.p23]) || 0) + 1);
        live.b03.set(o[FI.b03], (live.b03.get(o[FI.b03]) || 0) + 1);
        const key = o[FI.pool] + o[FI.slot] + ':' + o[FI.type];
        const t = tracks.get(key) || { key, type: o[FI.type], rows: [] }; tracks.set(key, t);
        t.rows.push({ n: fr.n, o, p1: fr.p1, g: fr.g, cam: fr.cam });
      }
    }
    if (hit) perRun.push({ rid, run, tracks: [...tracks.values()] });
  }
  for (const [T, c] of live.setsSeen) if (setOf(T).length && c >= 30) sets.add(T);   // < 30 frames = a slot being reused
  // reaction sets from +0x84 (static values; obj+0x84 is not in the log)
  const reaction = [];
  for (const v of [...r84].sort((a, b) => a - b)) {
    if (v >= 0x98 || (v & 3)) { reaction.push({ r84: hex(v), grab: null, hit: null, note: "outside the 38-entry tables" }); continue; }
    const g = R.u32(REACT_GRAB + v), h = R.u32(REACT_HIT + v);
    reaction.push({ r84: hex(v), grab: g ? hex(g) : null, hit: h ? hex(h) : null });
    if (g) sets.add(g); if (h) sets.add(h);
  }
  const setList = [...sets].sort((a, b) => a - b);
  const fidx = frameIndex(setList);

  // 3. animation instances from the live tracks
  const usage = new Map();   // "set:anim" -> stats
  const unresolved = new Map();
  const instances = [];
  for (const pr of perRun) for (const t of pr.tracks) {
    let cur = null;
    for (let i = 0; i < t.rows.length; i++) {
      const row = t.rows[i], o = row.o, fp = o[FI.fp];
      const cands = fidx.get(fp);
      if (!cands) { if (fp) { const u = unresolved.get(fp) || { fp: hex(fp), count: 0, runs: new Set() }; u.count++; u.runs.add(pr.rid); unresolved.set(fp, u); } cur = null; continue; }
      let c = null;
      if (cur && cands.some(x => x.set === cur.set && x.anim === cur.anim)) c = cands.find(x => x.set === cur.set && x.anim === cur.anim);
      else c = cands.find(x => x.k === 0) || cands[0];
      if (!cur || c.set !== cur.set || c.anim !== cur.anim) {
        if (cur) instances.push(cur);
        cur = { run: pr.rid, track: t.key, set: c.set, anim: c.anim, n0: row.n, n1: row.n, x0: o[FI.x], x1: o[FI.x], h0: o[FI.h], hMax: o[FI.h], hp0: o[FI.hp], hp1: o[FI.hp], st: [o[FI.b04], o[FI.b05], o[FI.b06], o[FI.b07]], face: o[FI.face], p23: new Set([o[FI.p23]]), atk: new Set(), p1hit: 0, p1dmg: [], frames: new Set([c.k]) };
      }
      cur.n1 = row.n; cur.x1 = o[FI.x]; cur.hp1 = o[FI.hp]; cur.hMax = Math.max(cur.hMax, o[FI.h]); cur.p23.add(o[FI.p23]); cur.frames.add(c.k);
      if (o[FI.atk58]) cur.atk.add(o[FI.atk58]);
      // hero damage this frame (spawn runs refill HP each frame, so 100 - hp is the damage of this frame)
      if (row.p1 && row.p1[7] < 100 && row.p1[7] >= 0) { cur.p1hit++; cur.p1dmg.push({ dmg: 100 - row.p1[7], atk: o[FI.atk58] }); }
    }
    if (cur) instances.push(cur);
  }
  for (const it of instances) {
    const k = it.set + ':' + it.anim;
    const u = usage.get(k) || { set: it.set, anim: it.anim, instances: 0, frames: 0, runs: new Set(), firstN: null, states: new Map(), dxPerFrame: [], hpLoss: 0, endsDead: 0, maxH: 0, p23: new Set(), atk: new Set(), framesSeen: new Set(), heroDamage: [] };
    u.instances++; u.frames += it.n1 - it.n0 + 1; u.runs.add(it.run); if (u.firstN == null) u.firstN = `${it.run}@${it.n0}`;
    const sk = it.st.join('.'); u.states.set(sk, (u.states.get(sk) || 0) + 1);
    const dur = it.n1 - it.n0 + 1; if (dur > 3) u.dxPerFrame.push((it.x1 - it.x0) / dur * (it.face ? 1 : -1));   // + = forward (towards facing)
    if (it.hp1 < it.hp0) u.hpLoss++; if (it.hp1 <= 0) u.endsDead++;
    u.maxH = Math.max(u.maxH, it.hMax - it.h0); it.p23.forEach(p => u.p23.add(p)); it.atk.forEach(a => u.atk.add(a)); it.frames.forEach(f => u.framesSeen.add(f));
    for (const d of it.p1dmg) u.heroDamage.push(d);
    usage.set(k, u);
  }

  // 4. records used
  const recs = new Set();
  for (const T of setList) for (const an of setOf(T)) if (!an.bad) for (const f of an.frames) for (const p of framePartsOf(f)) if (p.rec >= 0 && p.rec < R.REC_COUNT) recs.add(p.rec);

  // 5. palettes. OBJ slot -> ROM row comes from the (episode, area) table 0x8E8E; the slot is the record's block
  // palette unless obj+0x23 bit 7 overrides it (V04). The override is resolved per object type (an entity can be
  // several objects with different palettes). Contexts = (type, episode, area, override) seen live; p23 values that
  // never last 20 frames in a row are hit flashes, not variants.
  const p23counts = [...live.p23.entries()].sort((a, b) => b[1] - a[1]);
  const ctx = new Map(), flash = new Map(), setOwner = new Map();
  for (const sc of scans) { for (const T of (E.sets || sc.scan.sets)) if (!setOwner.has(T)) setOwner.set(T, sc.type); for (const v of (E.r84 || sc.scan.r84)) if (v < 0x98 && !(v & 3)) { for (const tb of [REACT_GRAB, REACT_HIT]) { const T = R.u32(tb + v); if (T && !setOwner.has(T)) setOwner.set(T, sc.type); } } }
  for (const pr of perRun) for (const t of pr.tracks) {
    for (const row of t.rows) { const T = row.o[FI.set]; if (T && !setOwner.has(T) && sets.has(T)) setOwner.set(T, t.type); }
    let runP = null, runLen = 0;
    const isStage = pr.run.meta.kind === 'stage';
    // spawn runs repaint all 32 OBJ palette slots with the rows of the target's home (episode, area) every 30 frames
    if (!isStage && !spawnPal(pr.run)) continue;
    const close = () => { if (runP == null) return; const fl = flash.get(runP) || { frames: 0, maxRun: 0 }; fl.frames += runLen; fl.maxRun = Math.max(fl.maxRun, runLen); flash.set(runP, fl); };
    for (const row of t.rows) {
      const p = row.o[FI.p23];
      if (p !== runP) { close(); runP = p; runLen = 0; } runLen++;
      const st = isStage ? [row.g[2] + 1, row.g[3]] : spawnPal(pr.run);
      const ov = (p & 0x80) ? (p & 31) : -1;
      const key = t.type + ',' + st[0] + ',' + st[1] + ',' + ov;
      const c = ctx.get(key) || { type: t.type, stage: st[0], area: st[1], override: ov, p23: p, frames: 0, runs: new Set() };
      c.frames++; c.runs.add(pr.rid); ctx.set(key, c);
    }
    close();
  }
  const isFlash = p => { const fl = flash.get(p); return fl && fl.maxRun < 20; };
  const allCtx = [...ctx.values()].filter(c => !isFlash(c.p23) && c.frames >= 60).sort((a, b) => b.frames - a.frames);
  // home (episode, area): the catalogue's, if the entity was met there, else where it was seen most
  const atHome = allCtx.filter(c => c.stage === E.pal[0] && c.area === E.pal[1]);
  const homeStage = atHome.length ? E.pal : allCtx.length ? [allCtx[0].stage, allCtx[0].area] : E.pal;
  const typeOverride = new Map();
  for (const sp of E.objs) {
    const c = allCtx.find(x => x.type === sp.type && x.stage === homeStage[0] && x.area === homeStage[1]) || allCtx.find(x => x.type === sp.type);
    if (c) typeOverride.set(sp.type, c.override);
    else { const sc = scans.find(x => x.type === sp.type); const ps = sc ? sc.scan.p23 : []; typeOverride.set(sp.type, ps.length === 1 && (ps[0] & 0x80) ? ps[0] & 31 : -1); }
  }
  const recOwner = new Map();
  for (const T of setList) { const ty = setOwner.get(T); for (const an of setOf(T)) if (!an.bad) for (const f of an.frames) for (const p of framePartsOf(f)) if (!recOwner.has(p.rec)) recOwner.set(p.rec, ty); }
  const recOverride = new Map([...recOwner].map(([r, ty]) => [r, ty === undefined ? -1 : (typeOverride.get(ty) ?? -1)]));
  const homeRuns = new Set(); for (const c of (atHome.length ? atHome : allCtx.slice(0, 1))) c.runs.forEach(r => homeRuns.add(r));
  const homeCtx = { stage: homeStage[0], area: homeStage[1], frames: atHome.reduce((s2, c) => s2 + c.frames, 0) || (allCtx[0] ? allCtx[0].frames : 0), runs: homeRuns, assumed: !allCtx.length };
  const mkPal = c => { const pr = paletteRows(c.stage, c.area); return { ...c, table: pr.table, rows: pr.rows, palettes: pr.rows.map(r => romRowRGB(r)) }; };
  const homeP = mkPal(homeCtx);
  const { table: palTable, rows, palettes } = homeP;
  const homeKeys = new Set(E.objs.map(sp => sp.type + ',' + homeStage[0] + ',' + homeStage[1] + ',' + typeOverride.get(sp.type)));
  const variants = allCtx.filter(c => !homeKeys.has(c.type + ',' + c.stage + ',' + c.area + ',' + c.override)).slice(0, 6).map(mkPal);
  const primaryOverride = typeOverride.get(E.objs[0].type) ?? -1;
  const slotsUsed = new Set();
  for (const r of recs) { const rr = L.rec(r); const ov = recOverride.get(r) ?? -1; if (rr) rr.blocks.forEach(b => slotsUsed.add(ov >= 0 ? ov : b.pal)); }
  const flashes = [...flash.entries()].filter(([p, fl]) => fl.maxRun < 20).map(([p, fl]) => ({ p23: hex(p, 2), frames: fl.frames, longestRun: fl.maxRun }));
  const setOwnerOut = [...setOwner].filter(([T]) => sets.has(T)).map(([T, ty]) => ({ set: hex(T), type: hex(ty), override: typeOverride.get(ty) ?? -1 }));

  return { E, handlers: scans, setList, reaction, b03s: [...b03s], p23s: [...p23s], bossHp: [...bossHp], regHp, live, perRun, usage, unresolved, instances, recs: [...recs].sort((a, b) => a - b), palTable, rows, palettes, primaryOverride, recOverride, recOwner, typeOverride, setOwnerOut, home: homeP, variants, flashes, slotsUsed: [...slotsUsed].sort((a, b) => a - b), p23counts };
}

// ---------------------------------------------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------------------------------------------
// ovFor(rec) -> palette override slot for that record (-1 = the record's own block palettes)
function writeAtlas(A, file, ovFor, palettes = A.palettes) {
  const items = [];
  for (const r of A.recs) {
    const im = L.renderRecord(r, palettes, ovFor(r));
    if (!im) continue;
    items.push({ rec: r, w: im.w, h: im.h, ox: im.ox, oy: im.oy, im });
  }
  const box = L.packShelves(items, 2048, 1);
  const img = new Uint8Array(box.w * box.h * 4);
  for (const it of items) for (let y = 0; y < it.h; y++) for (let x = 0; x < it.w; x++) {
    const s = (y * it.w + x) * 4; if (!it.im.rgba[s + 3]) continue; const d = ((it.y + y) * box.w + it.x + x) * 4;
    img[d] = it.im.rgba[s]; img[d + 1] = it.im.rgba[s + 1]; img[d + 2] = it.im.rgba[s + 2]; img[d + 3] = 255;
  }
  R.writePNG(file + '.png', box.w, box.h, img);
  const frames = items.sort((a, b) => a.rec - b.rec).map(it => ({ rec: it.rec, x: it.x, y: it.y, w: it.w, h: it.h, ox: it.ox, oy: it.oy, pal: [...new Set(L.rec(it.rec).blocks.map(b => ovFor(it.rec) >= 0 ? ovFor(it.rec) : b.pal))] }));
  fs.writeFileSync(file + '.json', JSON.stringify({ image: path.basename(file) + '.png', size: [box.w, box.h], orientation: 'native left-facing (mirror for facing right, V06)', origin: '(ox, oy) = feet origin inside the frame box', palette: 'ROM palette rows of the OBJ slots listed per frame (pal), full brightness; see <id>.json palette', frames }, null, 1));
  return { file: path.basename(file) + '.png', w: box.w, h: box.h, count: items.length };
}

function writeSheet(A, anims, file) {
  // rows of anims; each frame rendered with the whole frame composition (rec + rec2 / composite parts)
  const rows = [];
  for (const a of anims) {
    const ims = a.frames.map(f => { const parts = framePartsOf(f.raw); return L.renderParts(parts, A.palettes, A.recOverride.get(parts[0].rec) ?? -1); });
    rows.push({ a, ims });
  }
  let up = 8, down = 4, maxW = 24;
  for (const r of rows) for (const im of r.ims) if (im) { up = Math.max(up, im.oy); down = Math.max(down, im.h - im.oy); maxW = Math.max(maxW, im.w); }
  up = Math.min(up, 260); down = Math.min(down, 120);
  const CW = Math.min(Math.max(maxW + 6, 60), 300), CH = up + down + 18, PER = 10, LABW = 0;
  const lines = [];
  for (const r of rows) for (let s = 0; s < Math.max(1, r.ims.length); s += PER) lines.push({ r, s });
  const W = CW * PER + LABW, H = lines.length * CH + 4;
  if (W * H > 60e6) return null;
  const img = L.makeImage(W, H);
  lines.forEach((ln, li) => {
    const y0 = li * CH; for (let x = 0; x < W; x++) L.px(img, x, y0, [70, 74, 84]);
    if (ln.s === 0) { const lv = ln.r.a.live; const st = lv ? ` (LIVE X${lv.instances} ${lv.frames}F ST ${lv.states.map(x => x.b04_05_06_07).slice(0, 2).join(',')} FWD ${lv.forwardPxPerFrame} RISE ${lv.rise}${lv.attackIds.length ? ' ATK ' + lv.attackIds.join('/') : ''}${lv.heroDamageObserved.length ? ' DMG ' + lv.heroDamageObserved.map(d => d.attackId + ':' + d.damage.join('/')).join(' ') : ''}${lv.endedAtZeroHp ? ' DIED' : ''}${lv.hpLostDuring ? ' HPLOSS' + lv.hpLostDuring : ''})` : ' (NOT SEEN LIVE)'; L.text(img, `${ln.r.a.setHex} A${ln.r.a.index} ${ln.r.a.kind === 'main' ? '' : ln.r.a.kind.toUpperCase() + ' '}${ln.r.a.name}${st}`.slice(0, Math.floor(W / 4) - 2), 2, y0 + 2, [255, 255, 140]); }
    for (let k = ln.s; k < Math.min(ln.r.ims.length, ln.s + PER); k++) {
      const im = ln.r.ims[k], f = ln.r.a.frames[k], cx = (k - ln.s) * CW, base = y0 + 10 + up;
      L.text(img, `${k}:${f.rec}${f.rec2 != null ? '+' + f.rec2 : ''}${f.composite ? 'C' : ''} D${f.dur}`, cx + 2, y0 + 10, [170, 200, 255]);
      if (im) L.blit(img, im.rgba, im.w, im.h, cx + Math.floor(CW / 2) - im.ox, base - im.oy);
      for (let d = -2; d <= 2; d++) { L.px(img, cx + Math.floor(CW / 2) + d, base, [255, 0, 255]); L.px(img, cx + Math.floor(CW / 2), base + d, [255, 0, 255]); }
      for (let y = y0 + 9; y < y0 + CH; y++) L.px(img, cx, y, [56, 60, 70]);
    }
  });
  R.writePNG(file, img.w, img.h, img.d);
  return { file: path.basename(file), w: W, h: H };
}

function summariseUsage(u) {
  if (!u) return null;
  const dx = u.dxPerFrame.length ? u.dxPerFrame.reduce((a, b) => a + b, 0) / u.dxPerFrame.length : 0;
  const dmg = {};
  for (const d of u.heroDamage) { const k = d.atk; (dmg[k] = dmg[k] || []).push(d.dmg); }
  return {
    instances: u.instances, frames: u.frames, runs: [...u.runs], first: u.firstN,
    states: [...u.states.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => ({ b04_05_06_07: k, count: c })),
    forwardPxPerFrame: Math.round(dx * 100) / 100, rise: u.maxH, hpLostDuring: u.hpLoss, endedAtZeroHp: u.endsDead,
    p23: [...u.p23].map(p => hex(p, 2)), attackIds: [...u.atk].sort((a, b) => a - b),
    heroDamageObserved: Object.entries(dmg).map(([atk, v]) => ({ attackId: +atk, hits: v.length, damage: [...new Set(v)].sort((a, b) => a - b) })),
    framesSeen: [...u.framesSeen].sort((a, b) => a - b),
  };
}

function guessLabel(a, u, isReaction) {
  if (isReaction) return null;
  if (!u) return null;
  const s = summariseUsage(u);
  if (s.endedAtZeroHp && s.hpLostDuring) return 'death?';
  if (Math.abs(s.forwardPxPerFrame) > 0.5) return s.forwardPxPerFrame > 0 ? 'move forward?' : 'move back?';
  return null;
}

function exportEntity(A) {
  const E = A.E;
  const anims = [];
  const reactionSets = new Set(); for (const r of A.reaction) { if (r.grab) reactionSets.add(parseInt(r.grab)); if (r.hit) reactionSets.add(parseInt(r.hit)); }
  for (const T of A.setList) {
    const isReact = reactionSets.has(T);
    for (const an of setOf(T)) {
      if (an.bad) continue;
      const u = A.usage.get(T + ':' + an.index);
      const isGrab = A.reaction.some(r => r.grab && parseInt(r.grab) === T);
      let name = (LABELS.sets[hex(T)] || [])[an.index] || null;
      if (!name && isReact) name = (isGrab ? LABELS.reactionGrab : LABELS.reactionHit)[an.index] || null;
      if (!name) name = `anim${an.index} (unlabelled)`;
      let loopTo = an.loopIndex;
      if (loopTo == null && an.loopTo != null) {
        let tgt = null; for (const T2 of A.setList) for (const b of setOf(T2)) { if (b.bad) continue; const k = b.frames.findIndex(f => f.addr === an.loopTo); if (k >= 0 && !tgt) tgt = { set: hex(T2), index: b.index, frame: k }; }
        loopTo = tgt ? { continuesInto: tgt } : { address: hex(an.loopTo) };
      }
      const frames = an.frames.map(f => ({ ...exportFrame(f), raw: f }));
      anims.push({ name, set: hex(T), setHex: hex(T).slice(2), index: an.index, kind: isReact ? (A.reaction.some(r => r.grab && parseInt(r.grab) === T) ? 'reaction-grab' : 'reaction-hit') : 'main', addr: hex(an.addr), frames, loopTo, totalDur: an.frames.reduce((s, f) => s + f.dur, 0), live: summariseUsage(u) });
    }
  }
  // atlases
  const base = path.join(OUT, E.id);
  const ovHome = r => A.recOverride.get(r) ?? -1;
  const atlas = writeAtlas(A, base + '-atlas', ovHome);
  // remove stale variant atlases of this entity (anything "<id>-<tag>-atlas.*" other than the home atlas)
  for (const f of fs.readdirSync(OUT)) if (f.startsWith(E.id + '-') && /-atlas\.(png|json)$/.test(f) && f !== `${E.id}-atlas.png` && f !== `${E.id}-atlas.json` && ENTITIES.every(o => o.id === E.id || !f.startsWith(o.id + '-') || o.id.length < E.id.length)) fs.rmSync(path.join(OUT, f));
  const variantAtlases = A.variants.map(v => { const tag = `t${v.type.toString(16)}-e${v.stage}a${v.area}${v.override >= 0 ? '-pal' + v.override : ''}`; const ovV = r => (A.recOwner.get(r) === v.type ? v.override : ovHome(r)); return { tag, type: hex(v.type), episode: v.stage, area: v.area, override: v.override >= 0 ? v.override : null, frames: v.frames, runs: [...v.runs], ...writeAtlas(A, `${base}-${tag}-atlas`, ovV, v.palettes) }; });
  const sheet = writeSheet(A, anims, base + '-sheet.png');

  // HP
  const hp = {};
  if (A.bossHp.length && E.hpKind !== 'regular') hp.boss = A.bossHp.map(i => ({ index: i, table: hex(BOSS_HP + i * 48), rule: 'HP = table[players-1][(rank & 0x1C) >> 2]; +0x6A (bar) = min(HP, 100); each 100 HP is one bar colour', byPlayers: bossHpTable(i) }));
  const b03 = [...A.live.b03.keys()].concat(A.b03s).filter((v, i, a) => a.indexOf(v) === i);
  if (E.hpKind !== 'boss' && (A.regHp || !A.bossHp.length)) hp.regular = b03.filter(b => b <= 0x26 && (E.objs.every(sp => sp.b03 === undefined) || E.objs.some(sp => sp.b03 === b))).map(b => ({ b03: hex(b, 2), name: nameOf(b), table: hex(REG_HP + b * 64), byRank: regHpRow(b) }));
  const hpSeen = new Map();
  for (const pr of A.perRun) for (const t of pr.tracks) { const r0 = t.rows.find(r => r.o[FI.hp] > 0); if (r0) { const k = `${hex(t.type)}: ${r0.o[FI.hp]}/${r0.o[FI.hpMax]}@rank${r0.g[0]},players${r0.g[1] + 1}`; hpSeen.set(k, (hpSeen.get(k) || 0) + 1); } }
  hp.liveInitial = [...hpSeen.keys()];
  // damage: attack ids observed for this entity, with the table record and the per-entity rank multiplier
  const atkIds = new Set(); for (const u of A.usage.values()) u.atk.forEach(a => atkIds.add(a));
  const damage = { rule: 'hero HP -= damage * byte[0x2C3AE + r84*8 + (rank & 0x1F)] / 32, then victim-side factors (0x6454..0x64EE: random reduction by victim HP band from 0x2C896, character factor 0x2C88E[hero id], HP factor 0x2C996)', records: [...atkIds].sort((a, b) => a - b).map(damageRecord), rankMultiplier: [...new Set(A.reaction.map(r => r.r84))].map(r => ({ r84: r, row: rankRow(parseInt(r) / 4 * 4 / 4 * 4) })) };
  // fix: the row index uses +0x84 (a x4 index) times 8 bytes
  damage.rankMultiplier = [...new Set(A.reaction.map(r => parseInt(r.r84)))].map(v => ({ r84: hex(v), addr: hex(DMG_RANK + v * 8), byRank: rankRow(v) }));

  const out = {
    id: E.id, name: E.name, group: E.group, episode: E.episode, role: E.role, debugName: E.debugName || null,
    objects: A.handlers.map(h => ({ pool: h.pool, type: hex(h.type), handler: hex(h.handler), codeRange: [hex(h.handler), hex(h.end)], static: { sets: h.scan.sets.map(s => hex(s)), nameIndex: h.scan.b03.map(b => ({ b03: hex(b, 2), name: nameOf(b) })), r84: h.scan.r84.map(v => hex(v)), paletteOverride: h.scan.p23.map(v => hex(v, 2)), bossHpIndex: h.scan.bossHp, regularHp: h.scan.regHp, spawnsTypes: h.scan.spawns.map(v => hex(v)) } })),
    nameIndexLive: [...A.live.b03.entries()].map(([b, c]) => ({ b03: hex(b, 2), name: nameOf(b), frames: c })),
    sets: A.setList.map(s => ({ set: hex(s), anims: setOf(s).filter(a => !a.bad).length, liveFrames: A.live.setsSeen.get(s) || 0 })),
    reactionSets: A.reaction,
    hp, damage,
    palette: { episodeArea: E.pal, areaTable: hex(A.palTable), objSlotToRomRow: A.rows, slotsUsed: A.slotsUsed.map(s => ({ slot: s, romRow: A.rows[s], romAddr: hex(PAL_ROWS + A.rows[s] * 32), words: romRowWords(A.rows[s]).map(w => hex(w, 4)) })), override: A.primaryOverride >= 0 ? A.primaryOverride : null, overrideByType: [...A.typeOverride].map(([t, o]) => ({ type: hex(t), slot: o >= 0 ? o : null })), setOwners: A.setOwnerOut, home: { episode: A.home.stage, area: A.home.area, frames: A.home.frames, runs: [...A.home.runs], assumed: !!A.home.assumed }, liveP23: A.p23counts.map(([p, c]) => ({ p23: hex(p, 2), frames: c })), hitFlashes: A.flashes, variants: variantAtlases.map(v => ({ tag: v.tag, type: v.type, episode: v.episode, area: v.area, override: v.override, frames: v.frames, runs: v.runs, atlas: v.file })) },
    scale: 'native: 1 arcade pixel = 1 atlas pixel (384x224 screen); no scaling is applied by the draw code (V04)',
    atlas, sheet, records: A.recs.length,
    animations: anims.map(a => ({ name: a.name, set: a.set, index: a.index, kind: a.kind, addr: a.addr, totalDur: a.totalDur, loopTo: a.loopTo, frames: a.frames.map(f => { const { raw, ...rest } = f; return rest; }), live: a.live })),
    live: { frames: A.live.frames, runs: A.perRun.map(p => ({ id: p.rid, run: p.run.meta.run, kind: p.run.meta.kind || 'spawn', state: p.run.meta.state, objects: p.tracks.map(t => ({ track: t.key, first: t.rows[0].n, last: t.rows[t.rows.length - 1].n, area: t.rows[0].g[3] ?? null })) })), unresolvedFramePointers: [...A.unresolved.values()].map(u => ({ fp: u.fp, count: u.count, runs: [...u.runs] })).sort((a, b) => b.count - a.count).slice(0, 40) },
    timeline: buildTimeline(A),
    pattern: buildPattern(A, anims),
    validation: validateEntity(A),
  };
  fs.writeFileSync(base + '.json', JSON.stringify(out, null, 1));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// validation against the live OBJ lists and palettes (frames.jsonl of each bz-* run)
//  - OBJ: the entity's sprite entries predicted from its RAM at plan frame n (PEEK n) with the independent draw model
//    tools/re/verify-live/drawmodel.cjs must all be present in the OBJ list dumped at n+1 (H04/V05 timing).
//  - colours: for every palette slot the entity draws with, the live palette words at that frame must equal the ROM
//    row the (episode, area) table 0x8E8E names (brightness nibble included).
// ---------------------------------------------------------------------------------------------------------------
const DM = require('../verify-live/drawmodel.cjs');
const framesCache = new Map();
function dumpsOf(runName) {
  if (framesCache.has(runName)) return framesCache.get(runName);
  const file = path.join(ROOT, 'work/re/runs', runName, 'frames.jsonl'); let m = null;
  if (fs.existsSync(file)) { m = new Map(); for (const line of fs.readFileSync(file, 'utf8').split(String.fromCharCode(10))) { if (!line) continue; const j = JSON.parse(line); m.set(j.f, { obj: j.obj, pal: j.pal }); } }
  framesCache.clear(); framesCache.set(runName, m); return m;
}
function validateEntity(A, maxPerRun = 400) {
  const res = { obj: { framesChecked: 0, framesExact: 0, entriesPredicted: 0, entriesFound: 0, skipped: 0, byRun: {} }, colours: { rule: 'live palette word & 0x0FFF == ROM row word & 0x0FFF (brightness nibble ignored; gameplay is at F)', slotChecks: 0, exact: 0, mismatches: [] } };
  for (const pr of A.perRun) {
    const runName = pr.run.meta.run; const dumps = dumpsOf(runName); if (!dumps) continue;
    const isStage = pr.run.meta.kind === 'stage';
    const own = isStage || !!spawnPal(pr.run);
    const br = { framesChecked: 0, framesExact: 0, entriesPredicted: 0, entriesFound: 0 };
    let checked = 0;
    for (const t of pr.tracks) for (const row of t.rows) {
      const d = dumps.get(row.n + 1); if (!d || !d.obj) continue;
      if (checked >= maxPerRun) break;
      const o = row.o;
      const obj = { x: o[FI.x], h: o[FI.h], d: o[FI.d], face: o[FI.face], fp: o[FI.fp], f25: o[FI.f25], f23: o[FI.p23], tdx: o[FI.tdx], tdy: o[FI.tdy], lp: o[FI.lp], f53: o[FI.f53], c4c: o[FI.c4c], c4d: o[FI.c4d], f05: o[FI.b05], f2e: o[FI.f2e] };
      if (!o[FI.b01]) continue;                       // not drawn this frame (on-screen test 0x16FA)
      let pred;
      try { const r = DM.drawObject(obj, { cx: (row.cam[0] - 0x40) & 0xFFFF, cy: row.cam[1] & 0xFFFF }); if (r.notes.pair || r.notes.bit6) { res.obj.skipped++; continue; } pred = r.out; }
      catch (e) { res.obj.skipped++; continue; }
      // only entries that are on screen (the draw code clips X; Y wraps at 0x200)
      pred = pred.filter(p => { const sy = (p.y & 0x1FF) - 16; return sy > -256 && sy < 240; });
      if (!pred.length) continue;
      const have = new Set(d.obj.map(e => ((e.x & 0x1FF) << 16 | (e.y & 0x1FF)) + ':' + e.code + ':' + e.attr));
      let found = 0; for (const p of pred) if (have.has(((p.x & 0x1FF) << 16 | (p.y & 0x1FF)) + ':' + p.code + ':' + p.attr)) found++;
      br.framesChecked++; br.entriesPredicted += pred.length; br.entriesFound += found; if (found === pred.length) br.framesExact++;
      checked++;
      // colours
      if (own && d.pal) {
        const st = isStage ? [row.g[2] + 1, row.g[3]] : spawnPal(pr.run); const rows = paletteRows(st[0], st[1]).rows;
        const slots = new Set(pred.map(p => p.attr & 31));
        for (const sl of slots) {
          const liveW = [], romW = romRowWords(rows[sl]); for (let k = 0; k < 16; k++) liveW.push(parseInt(d.pal.substr(sl * 64 + k * 4, 4), 16));
          const live = liveW.map(w => w.toString(16).toUpperCase().padStart(4, '0')).join(''), rom = romW.map(w => w.toString(16).toUpperCase().padStart(4, '0')).join('');
          res.colours.slotChecks++; if (liveW.every((w, k) => (w & 0xFFF) === (romW[k] & 0xFFF))) res.colours.exact++; else if (res.colours.mismatches.length < 12) res.colours.mismatches.push({ run: runName, f: row.n + 1, slot: sl, romRow: rows[sl], live: live.slice(0, 16) + '..', rom: rom.slice(0, 16) + '..' });
        }
      }
    }
    if (br.framesChecked) { res.obj.byRun[runName] = br; for (const k of Object.keys(br)) res.obj[k] += br[k]; }
  }
  return res;
}

// Ordered anim sequence of the first natural (stage) encounter, compressed: "name x frames".
// Fight pattern from the passive spawn runs (the hero never attacks, HP refilled each frame, walks away every 150
// frames): the order in which the entity's own anims start, how often each is used, and the attack id / damage
// seen while it plays. OBSERVED values; the reading in INDEX.md is the interpretation.
function buildPattern(A, anims) {
  const nameOf = new Map(anims.map(a => [parseInt(a.set) + ':' + a.index, a.name]));
  const runs = A.perRun.filter(p => p.run.meta.kind === 'spawn-passive' && A.E.objs.some(sp => sp.type === p.run.meta.type));
  const out = [];
  for (const pr of runs) for (const ty of [...new Set(pr.tracks.map(t => t.type))]) {
    const ins = A.instances.filter(i => i.run === pr.rid && i.track.endsWith(':' + ty));
    const seq = ins.map(i => ({ n: i.n0, anim: nameOf.get(i.set + ':' + i.anim) || hex(i.set) + ':' + i.anim, frames: i.n1 - i.n0 + 1, state: i.st.join('.'), dx: i.x1 - i.x0, attackIds: [...i.atk], heroDamage: [...new Set(i.p1dmg.map(d => d.dmg))] }));
    const freq = {};
    for (const q of seq) { const fq = freq[q.anim] || (freq[q.anim] = { uses: 0, frames: 0, hits: 0, damage: new Set(), attackIds: new Set() }); fq.uses++; fq.frames += q.frames; if (q.heroDamage.length) fq.hits++; q.heroDamage.forEach(d => fq.damage.add(d)); q.attackIds.forEach(a => fq.attackIds.add(a)); }
    out.push({ run: pr.rid, mameRun: pr.run.meta.run, state: pr.run.meta.state, type: hex(ty), sub: hex(pr.run.meta.sub || 0),
      frequency: Object.entries(freq).sort((a, b) => b[1].frames - a[1].frames).map(([k, v]) => ({ anim: k, uses: v.uses, frames: v.frames, hitsOnHero: v.hits, heroDamage: [...v.damage].sort((a, b) => a - b), attackIds: [...v.attackIds].sort((a, b) => a - b), damageTable: [...v.attackIds].filter(a => a > 0).map(a => damageRecord(a).damage) })),
      sequence: seq.slice(0, 120) });
  }
  return out;
}
function buildTimeline(A) {
  const stageRuns = A.perRun.filter(p => p.run.meta.kind === 'stage').map(p => p.rid);
  const pick = stageRuns.length ? stageRuns : A.perRun.map(p => p.rid);
  const out = [];
  for (const rid of pick.slice(0, 2)) {
    const ins = A.instances.filter(i => i.run === rid);
    const tracks = [...new Set(ins.map(i => i.track))];
    for (const tk of tracks.slice(0, 3)) {
      const seq = ins.filter(i => i.track === tk).map(i => ({ n: i.n0, set: hex(i.set), anim: i.anim, frames: i.n1 - i.n0 + 1, st: i.st.join('.'), hp: i.hp0 }));
      out.push({ run: rid, track: tk, count: seq.length, seq: seq.slice(0, 400) });
    }
  }
  return out;
}

const REACT_NAMES = {
  // V18 + this export's live check: hit set (0x2E68C[r84]) anims; grab set (0x2E724[r84]) anims
  hit: null, grab: null,
};

// ---------------------------------------------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
  fs.mkdirSync(OUT, { recursive: true });
  const runs = loadLive();
  const results = [];
  for (const E of ENTITIES) {
    if (only && !only.includes(E.id)) continue;
    const A = analyseEntity(E, runs);
    const out = exportEntity(A);
    results.push(out);
    const v = out.validation; console.log(`${E.id.padEnd(16)} OBJ ${v.obj.framesExact}/${v.obj.framesChecked} frames (${v.obj.entriesFound}/${v.obj.entriesPredicted} entries, skip ${v.obj.skipped}) colours ${v.colours.exact}/${v.colours.slotChecks} sets ${String(out.sets.length).padStart(2)} anims ${String(out.animations.length).padStart(3)} recs ${String(out.records).padStart(4)} live ${String(out.live.frames).padStart(6)} unresolved ${out.live.unresolvedFramePointers.reduce((s, u) => s + u.count, 0)} atlas ${out.atlas.w}x${out.atlas.h}`);
  }
  if (!only) require('./bosses-index.cjs').writeIndex(results, runs, { OUT, nameOf, hex, ENTITIES });
}
if (require.main === module) main();
module.exports = { ENTITIES, analyseEntity, nameOf, paletteRows, scanHandler, handlerOf, bossHpTable, regHpRow, damageRecord, FI, setOf, framePartsOf };
