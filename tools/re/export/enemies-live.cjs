#!/usr/bin/env node
// Live capture for the regular (non-boss) human enemies of the original Cadillacs & Dinosaurs (MAME "dino").
// Research tooling only; nothing here ships with the sequel. Outputs go to the git-ignored work/re/runs/en-<id>/.
//
//   node tools/re/export/enemies-live.cjs [id ...] [--list]
//
// Each variant gets one MAME run (one MAME process at a time) from a stage save state:
//   * the enemy is spawned with the verified debug spawn-list format (V10: 26-byte entries at 0x88DDA, the same
//     writes the spawner 0x88D76 makes), optionally with a different subtype word (+0x26);
//   * a Lua bot drives P1 through phases: "near" (stand still without invulnerability, so its attacks land and
//     the HP write tap measures the damage), "away" (stand back, for ranged attacks), "punch", "grab" (walk into it,
//     knee, throw forward/backward), "jump" (jump kicks), and "kill" (the target's HP is set to 1 and no longer refilled);
//   * the target's HP is refilled every frame until the kill phase so all reactions can be seen before it dies;
//   * PEEK logs, every frame, P1 and every active pool A/B/C/D object (fields of V09/V12) to hook.jsonl, and a write
//     tap on P1 +0x6C (0xFFB2E0) logs every HP write with the attacker in A2 (0x116B2 reads the attacker's +0x58);
//   * the OBJ list is dumped every frame (frames.jsonl) so enemies.cjs can rebuild the enemy's blocks from RAM and
//     check them (drawmodel.cjs), and the OBJ palettes are logged every 120 frames.
'use strict';
const fs = require('fs'), path = require('path');
const RT = require('../runtime/rt.cjs');

const SPAWN_LIST = 0x88DDA;               // V10
// id, spawn-list index, optional subtype override, state, spawn offset (dx, dd), phases override
const VARIANTS = [
  { id: 'chinpira-a', idx: 1 }, { id: 'chinpira-b', idx: 2 }, { id: 'chinpira-c', idx: 3 },
  { id: 'hutori-a', idx: 4 }, { id: 'hutori-b', idx: 5 }, { id: 'hutori-c', idx: 6 },
  { id: 'hutori-c0', idx: 6, sub: 0x400 },
  // Dinosaurs Naguri (0x13C) only stays if a dinosaur (pool-B type 0x60/0x74/0x98) with +0xC0 bit 7 set and +0xC1 = 0
  // exists (0x5F6CA); a Dinonics (spawn entry 28) is spawned first and its +0xC0 held at 0xFF for 300 frames
  ...['a', 'b', 'c'].map((k, i) => ({ id: 'naguri-' + k, idx: 7, sub: i * 0x200, pre: { idx: 28, dx: 170, at: 4, to: 300, pokes: [[0xC0, 1, 0xFF], [0xC1, 1, 0]] } })),
  { id: 'mituryou-a', idx: 8 }, { id: 'mituryou-b', idx: 9 }, { id: 'mituryou-c', idx: 10 },
  { id: 'knifeman-a', idx: 11 }, { id: 'knifeman-b', idx: 12 },
  { id: 'subayai-a', idx: 13 }, { id: 'subayai-b', idx: 14 },
  { id: 'thurow-bomb', idx: 15 }, { id: 'thurow-dyna', idx: 16 },
  { id: 'ishinage', idx: 17 },
  { id: 'kameleon', idx: 18 },
  { id: 'richmond-b', idx: 19 }, { id: 'richmond-a', idx: 19, sub: 0x000 },
  { id: 'kingkimo', idx: 32 },
  { id: 'knifeonly', idx: 38 },
  { id: 'bike', idx: 81, dx: 160 }, { id: 'bikejump', idx: 82, dx: 160 },
];
// spawn-list entries probed once and found not to be fighters (no HP, never drawn, or freed at once); kept so the
// probe can be repeated: node tools/re/export/enemies-live.cjs eplayer-1 ...
const PROBES = [
  { id: 'eplayer-1', idx: 39 }, { id: 'eplayer-2', idx: 40 }, { id: 'eplayer-3', idx: 41 },
  { id: 'jumppl', idx: 44 }, { id: 'hosei', idx: 83 },
];
// Extra runs (added after the first verification pass). Each belongs to a variant capture above (of) and is merged into
// that variant's facts by enemies.cjs; 'light' runs keep no OBJ dumps and few snapshots.
//   m-*  behaviour modes (+0x26 low byte) seen in real stage play (census.json): the enemy is spawned with that subtype
//        and P1 stands still (no invulnerability) for 600 frames, then fights with invulnerability
//   b-*  brawl: P1 walks up and punches for 2000 frames WITHOUT invulnerability (infhp keeps P1 at 100 HP), so every
//        close attack can land and its damage is measured by the HP write tap
//   r-*  ranged: P1 keeps ~150 px away on the enemy's lane for 1500 frames without invulnerability (rifle / pistol)
const MODE_PHASES = [[0, 599, 'near'], [600, 899, 'punch']];
const BRAWL_PHASES = [[0, 1999, 'punch']];
const RANGE_PHASES = [[0, 1499, 'away']];
const NEVER = 1e9;
const modeRun = (of, idx, sub) => ({ id: `m-${of.replace(/-[a-z0-9]+$/, '')}-${sub.toString(16).padStart(4, '0')}`, of, idx, sub, phases: MODE_PHASES, frames: 900, invulnFrom: 600, light: true, purpose: 'mode' });
const EXTRA = [
  ...[[1, 0x0002], [2, 0x0204], [1, 0x0006], [2, 0x0208], [1, 0x000A]].map(([i, s]) => modeRun(['chinpira-a', 'chinpira-b'][i - 1], i, s)),
  ...[[5, 0x0202], [6, 0x0404], [5, 0x0206]].map(([i, s]) => modeRun(i === 5 ? 'hutori-b' : 'hutori-c', i, s)),
  ...[[8, 0x0002], [10, 0x0404], [8, 0x0006], [8, 0x0008], [10, 0x040C], [8, 0x0012]].map(([i, s]) => modeRun(i === 8 ? 'mituryou-a' : 'mituryou-c', i, s)),
  ...[[11, 0x0002], [11, 0x0004], [12, 0x0208], [11, 0x000A], [12, 0x020C]].map(([i, s]) => modeRun(i === 11 ? 'knifeman-a' : 'knifeman-b', i, s)),
  ...[[13, 0x0002], [14, 0x0204], [14, 0x0206], [14, 0x0208], [14, 0x020A]].map(([i, s]) => modeRun(i === 13 ? 'subayai-a' : 'subayai-b', i, s)),
  ...[0x0000, 0x0002, 0x0004].map(s => ({ ...modeRun('kameleon', 18, s), id: 'm-kameleon-' + s.toString(16).padStart(4, '0') })),
  // table entries never seen in the stage census (static mode tables 0x3DF54 / 0x403E8)
  ...[0x000A, 0x000E, 0x0010].map(s => modeRun('mituryou-a', 8, s)), modeRun('knifeman-a', 11, 0x0006),
  ...['chinpira-a', 'chinpira-b', 'chinpira-c', 'hutori-a', 'hutori-b', 'naguri-a', 'mituryou-a', 'knifeman-a', 'knifeman-b', 'knifeonly', 'subayai-a', 'subayai-b', 'ishinage', 'kameleon', 'richmond-b', 'kingkimo']
    .map(of => { const v = VARIANTS.find(x => x.id === of); return { ...v, id: 'b-' + of, of, phases: BRAWL_PHASES, frames: 2000, invulnFrom: NEVER, light: true, purpose: 'brawl' }; }),
  ...['richmond-a', 'richmond-b', 'mituryou-a', 'mituryou-b', 'mituryou-c', 'ishinage']
    .map(of => { const v = VARIANTS.find(x => x.id === of); return { ...v, id: 'r-' + of, of, phases: RANGE_PHASES, frames: 1500, invulnFrom: NEVER, light: true, purpose: 'ranged' }; }),
  // a longer ranged run for the rifle (its volley is random-gated: 0x3F6B2 picks 1-3 shots from table 0x3F6E8)
  { ...VARIANTS.find(x => x.id === 'mituryou-b'), id: 'r2-mituryou-b', of: 'mituryou-b', phases: [[0, 3599, 'away']], frames: 3600, invulnFrom: NEVER, light: true, purpose: 'ranged' },
  // TYROG 2 (pool-B type 0x16C, spawn #42): shares KING KIMO KIMO's set; fought in stage 8 area 0
  { id: 'tyrog2', idx: 42, state: 'stage8-jack', purpose: 'variant' },
  // the bike destroyed: HP set to 1 when it appears, P1 (invulnerable) faces it and jabs; its death spawns the rider
  { id: 'k-bike', of: 'bike', idx: 81, dx: 160, phases: [[0, 899, 'jab']], killFrom: 0, frames: 900, invulnFrom: 0, purpose: 'kill' },
  { id: 'k-bikejump', of: 'bikejump', idx: 82, dx: 160, phases: [[0, 899, 'jab']], killFrom: 0, frames: 900, invulnFrom: 0, purpose: 'kill' },
];
const DEFAULT_PHASES = [[0, 799, 'near'], [800, 999, 'away'], [1000, 1399, 'punch'], [1400, 1899, 'grab'],
  [1900, 2149, 'jump'], [2150, 2799, 'kill']];
const INVULN_FROM = 800, FRAMES = 2800, SPAWN_AT = 10;

function luaPhases(ph) { return '{' + ph.map(([a, b, m]) => `{${a},${b},"${m}"}`).join(',') + '}'; }

function hook(v) {
  const ph = v.phases || DEFAULT_PHASES, killFrom = v.killFrom !== undefined ? [v.killFrom] : ph.find(p => p[2] === 'kill');
  return String.raw`
local CPU = manager.machine.devices[":maincpu"]
local POOLS = {[0]={0xFFE5F8,0xFFE602},[1]={0xFFE5F6,0xFFE600},[3]={0xFFE5F4,0xFFE5FE}}
local PHASES = ${luaPhases(ph)}
local KILL_FROM = ${killFrom ? killFrom[0] : 1e9}
local P1 = 0xFFB274
TARGET = nil
TTYPE = nil
local frame = 0
SPAWNED = 1e9
local function SPAWN(e, sub, dx, dd)
  local a = ${SPAWN_LIST} + e * 26 + 16
  local cls = rw(a) & 7
  local p = POOLS[cls]
  local s = POOL_ALLOC(p[1], p[2])
  if not s then HLOG(fmt('{"spawn":%d,"error":"pool full"}', e)) return nil end
  if sub < 0 then sub = rw(a + 4) end
  wb(s, 1) ww(s + 0x20, rw(a + 2)) ww(s + 0x26, sub) ww(s + 0x5C, rw(a + 6)) wb(s + 0x96, rw(a + 8) & 0xFF)
  ww(s + 8, rw(0xFFB27C) + dx) ww(s + 0xC, rw(0xFFB280)) ww(s + 0x10, rw(0xFFB284) + dd)
  HLOG(fmt('{"spawn":%d,"f":%d,"slot":"%X","class":%d,"type":"%X","sub":"%X"}', e, frame, s, cls, rw(a + 2), sub))
  return s
end
local function mode(n) for _, p in ipairs(PHASES) do if n >= p[1] and n <= p[2] then return p[3] end end return "idle" end
local function ok(a) return a ~= nil and rb(a) ~= 0 end
local function findTarget()
  if ok(TARGET) then
    if rw(TARGET + 0x20) ~= TTYPE then
      HLOG(fmt('{"typechange":"%X","f":%d,"from":"%X","to":"%X"}', TARGET, frame, TTYPE, rw(TARGET + 0x20)))
      -- some handlers (Knife Man 0x38, U03) turn their own slot into a helper object and re-allocate themselves:
      -- follow the fresh slot of the original type
      local moved = nil
      if frame <= SPAWNED + 4 then for k = 0, 23 do local a = 0xFFC8F4 + k * 0xE0 if a ~= TARGET and rb(a) ~= 0 and rw(a + 0x20) == TTYPE then moved = a end end end
      if moved then TARGET = moved HLOG(fmt('{"retarget":"%X","f":%d,"type":"%X"}', moved, frame, TTYPE)) else TTYPE = rw(TARGET + 0x20) end
    end
    return TARGET
  end
  if TARGET and not GONE then GONE = frame HLOG(fmt('{"gone":"%X","f":%d}', TARGET, frame)) end
  return nil
end
local K = {R = "P1 Right", L = "P1 Left", U = "P1 Up", D = "P1 Down", A = "P1 Button 1", J = "P1 Button 2"}
local GH, GC = 0, 0
local function bot(n)
  local keys = {}
  local m = mode(n)
  local t = findTarget()
  if t and m ~= "idle" then
    local px, pd = rsw(0xFFB27C), rsw(0xFFB284)
    local ex, ed = rsw(t + 8), rsw(t + 0x10)
    local dx, dd = ex - px, ed - pd
    local adx, add = math.abs(dx), math.abs(dd)
    local toward, away = "L", "R"
    if dx > 0 then toward, away = "R", "L" end
    local faceR = rb(P1 + 0x24) ~= 0
    local facing = (dx > 0) == faceR
    local holding = rb(P1 + 5) == 4
    local vert = (dd > 0) and "U" or "D"
    if m == "near" then
      -- stand still (walking into an enemy grabs it); the enemy comes to P1 and attacks
    elseif m == "away" then
      if adx < 150 then keys[away] = true elseif add > 6 then keys[vert] = true end
    elseif m == "punch" or m == "kill" then
      if add > 3 then keys[vert] = true end
      if adx > 44 then keys[toward] = true
      elseif adx < 16 then keys[away] = true
      elseif not facing then keys[toward] = true
      elseif add <= 6 and (n % 8) < 2 then keys.A = true end
    elseif m == "grab" then
      if holding then
        GH = GH + 1
        if GH == 10 or GH == 11 or GH == 26 or GH == 27 then keys.A = true end
        if GH >= 44 and GH <= 46 then keys.A = true if GC % 2 == 0 then keys[toward] = true else keys[away] = true end end
      else
        if GH > 0 then GC = GC + 1 end
        GH = 0
        if add > 2 then keys[vert] = true end
        if adx > 6 then keys[toward] = true end
      end
    elseif m == "jab" then
      if add > 3 then keys[vert] = true
      elseif not facing then keys[toward] = true
      elseif (n % 4) < 2 then keys.A = true end
    elseif m == "jump" then
      if add > 3 then keys[vert] = true
      elseif adx > 76 then keys[toward] = true
      elseif adx < 36 then keys[away] = true
      elseif not facing then keys[toward] = true
      else local c = n % 48 if c < 2 then keys.J = true keys[toward] = true elseif c >= 9 and c < 11 then keys.A = true end end
    end
  end
  for k, name in pairs(K) do fields[name]:set_value(keys[k] and 1 or 0) end
end
local function objB(a)
  return fmt('{"a":"%X","s0":%d,"dr":%d,"v03":%d,"st":"%08X","ty":%d,"dir":%d,"p23":%d,"f24":%d,"f25":%d,"sub":%d,"x":%d,"h":%d,"d":%d,"vx":%d,"vh":%d,"vd":%d,"fp":%d,"fb":"%08X","t":%d,"lp":%d,"tdx":%d,"tdy":%d,"set":%d,"c4c":%d,"c4d":%d,"f53":%d,"at":%d,"a59":%d,"spd":%d,"hpm":%d,"hp":%d,"stun":%d,"r84":%d,"w1":%d,"w48":%d}',
    a, rb(a), rb(a + 1), rb(a + 3), rl(a + 4), rw(a + 0x20), rb(a + 0x22), rb(a + 0x23), rb(a + 0x24), rb(a + 0x25), rw(a + 0x26),
    rsw(a + 8), rsw(a + 0xC), rsw(a + 0x10), rsw(a + 0x14), rsw(a + 0x16), rsw(a + 0x18), rl(a + 0x28), rl(a + 0x2C), rb(a + 0x2F),
    rl(a + 0x30), rsw(a + 0x3C), rsw(a + 0x3E), rl(a + 0x40), rb(a + 0x4C), rb(a + 0x4D), rb(a + 0x53), rb(a + 0x58), rb(a + 0x59),
    rl(a + 0x64), rw(a + 0x6A), rsw(a + 0x6C), rb(a + 0x78), rw(a + 0x84), rw(a + 0x2A), rw(a + 0x48))
end
local function objS(a)
  return fmt('{"a":"%X","s0":%d,"st":"%08X","ty":%d,"sub":%d,"p23":%d,"f24":%d,"f25":%d,"x":%d,"h":%d,"d":%d,"fp":%d,"set":%d,"own":"%X","hpm":%d,"hp":%d,"at":%d}',
    a, rb(a), rl(a + 4), rw(a + 0x20), rw(a + 0x26), rb(a + 0x23), rb(a + 0x24), rb(a + 0x25), rsw(a + 8), rsw(a + 0xC), rsw(a + 0x10),
    rl(a + 0x28), rl(a + 0x40), rw(a + 0x70), rw(a + 0x6A), rsw(a + 0x6C), rb(a + 0x58))
end
local function pool(base, n, stride, f) local t = {} for k = 0, n - 1 do local a = base + k * stride if rb(a) ~= 0 then t[#t + 1] = f(a) end end return "[" .. table.concat(t, ",") .. "]" end
local HPLOG = {}
HPTAP = space:install_write_tap(0xFFB2E0, 0xFFB2E1, "p1hp", function(o, d, m)
  if (d & 0xFFFF) == rw(0xFFB2E0) then return end
  local a2 = CPU.state["A2"].value & 0xFFFFFF
  local inB = a2 >= 0xFF8000
  HLOG(fmt('{"hpw":%d,"f":%d,"pc":"%X","old":%d,"new":%d,"a2":"%X","a2ty":%d,"a2at":%d,"a2fp":%d,"a2set":%d,"a2r84":%d,"lvl":%d}', 1, frame,
    CPU.state["PC"].value, rw(0xFFB2E0), d & 0xFFFF, a2, inB and rw(a2 + 0x20) or -1, inB and rb(a2 + 0x58) or -1, inB and rl(a2 + 0x28) or -1,
    inB and rl(a2 + 0x40) or -1, inB and rw(a2 + 0x84) or -1, rw(0xFF85EE)))
end)
function PEEK(n)
  frame = n
  if n % 120 == 0 then local pb = 0x900000 + gbase(0x0A, 0x400) HLOG(fmt('{"pal":%d,"base":%d,"hex":"%s"}', n, pb, HEX(pb, 0x400))) end
  HLOG(fmt('{"f":%d,"lvl":%d,"rk":%d,"cx":%d,"cy":%d,"cxd":%d,"cyd":%d,"p1":{"s0":%d,"st":"%08X","x":%d,"h":%d,"d":%d,"f24":%d,"fp":%d,"hp":%d,"hold":"%X","w":"%X","inv":%d},"B":%s,"A":%s,"C":%s,"D":%s}',
    n, rw(0xFF85EE), rw(0xFF85EC), rsw(0xFF8744), rsw(0xFF8748), rsw(0xFFE9B6), rsw(0xFFE9B8),
    rb(P1), rl(P1 + 4), rsw(P1 + 8), rsw(P1 + 0xC), rsw(P1 + 0x10), rb(P1 + 0x24), rl(P1 + 0x28), rsw(P1 + 0x6C), rw(P1 + 0x70), rw(P1 + 0xB4), rw(P1 + 0xEC),
    pool(0xFFC8F4, 24, 0xE0, objB), pool(0xFF8874, 24, 0xC0, objS), pool(0xFFB6F4, 24, 0xC0, objS), pool(0xFF9A74, 48, 0x80, objS)))
end
PRE = nil
${v.pre ? `local PRE_SPEC = {idx = ${v.pre.idx}, sub = ${v.pre.sub === undefined ? -1 : v.pre.sub}, dx = ${v.pre.dx || 150}, dd = ${v.pre.dd || 0}, at = ${v.pre.at || 4}, to = ${v.pre.to || 0}, pokes = {${(v.pre.pokes || []).map(p => `{${p[0]}, ${p[1]}, ${p[2]}}`).join(', ')}}}` : 'local PRE_SPEC = nil'}
function HOOK(n)
  -- optional partner object spawned first (e.g. the dinosaur a Dinosaurs-Naguri brute needs), with per-frame pokes
  if PRE_SPEC and n == PRE_SPEC.at then PRE = SPAWN(PRE_SPEC.idx, PRE_SPEC.sub, PRE_SPEC.dx, PRE_SPEC.dd) HLOG(fmt('{"pre":"%X","f":%d}', PRE or 0, n)) end
  if PRE_SPEC and PRE and n >= PRE_SPEC.at and n <= PRE_SPEC.to then for _, p in ipairs(PRE_SPEC.pokes) do if p[2] == 1 then wb(PRE + p[1], p[3]) else ww(PRE + p[1], p[3]) end end end
  if n == ${v.spawnAt || SPAWN_AT} then SPAWNED = n TARGET = SPAWN(${v.idx}, ${v.sub === undefined ? -1 : v.sub}, ${v.dx || 100}, ${v.dd || 0}) if TARGET then TTYPE = rw(TARGET + 0x20) end end
  -- kill phase: the next hit kills (HP 1), so the death animation is reached quickly
  -- (once the enemy's own init has run, +0x04 = 2, so the init does not overwrite the poke)
  if n >= KILL_FROM and not KILLED and ok(TARGET) and rb(TARGET + 4) == 2 then KILLED = true if rsw(TARGET + 0x6C) > 1 then ww(TARGET + 0x6C, 1) HLOG(fmt('{"killhp":%d}', n)) end end
  if n < KILL_FROM and ok(TARGET) and rw(TARGET + 0x6A) > 0 and rsw(TARGET + 0x6C) < rw(TARGET + 0x6A) and rsw(TARGET + 0x6C) > 0 then ww(TARGET + 0x6C, rw(TARGET + 0x6A)) end
  bot(n)
end
`;
}

function plan(v) {
  return {
    name: 'en-' + v.id, frames: v.frames || FRAMES, loadState: v.state || 'stage1-jack',
    cheats: [{ cheat: 'infhp' }, { cheat: 'lives', value: 9, at: 2 }, ...((v.invulnFrom ?? INVULN_FROM) < (v.frames || FRAMES) ? [{ cheat: 'invuln', from: v.invulnFrom ?? INVULN_FROM }] : [])],
    dump: { from: 0, to: (v.frames || FRAMES) - 1, every: 1, obj: !v.light, cpsA: false },
    snapshotEvery: { from: 0, to: (v.frames || FRAMES) - 1, every: v.light ? 60 : 10 },
    hook: hook(v),
  };
}

// --palettes: the OBJ palette RAM of every stage state (stage byte 0xFF84D9, area 0xFF8786), to check the static
// per-stage/area palette maps (0x8E4C / 0x8E8E) that the export uses for each enemy's home colours
const PAL_STATES = ['stage1-jack', 'stage1-jack-area1', 'stage1-jack-area2', 'stage2-jack', 'stage3-jack', 'stage4-jack', 'stage5-jack', 'stage6-jack', 'stage7-jack', 'stage8-jack'];
function palPlan(state) {
  return { name: 'en-pal-' + state, frames: 4, loadState: state,
    hook: String.raw`
function PEEK(n) if n == 2 then local pb = 0x900000 + gbase(0x0A, 0x400) HLOG(fmt('{"state":"${state}","stage":%d,"area":%d,"main":%d,"base":%d,"hex":"%s"}', rb(0xFF84D9), rb(0xFF8786), rb(0xFF84D0), pb, HEX(pb, 0x400))) end end
` };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--palettes')) {
    for (const st of PAL_STATES) { const s = await RT.runPlan(palPlan(st), { quiet: true }); console.log(`en-pal-${st}: ok=${s.ok}`); }
    return;
  }
  if (args.includes('--list')) { for (const v of [...VARIANTS, ...EXTRA]) console.log(v.id, v.idx, v.sub === undefined ? '' : '0x' + v.sub.toString(16), v.purpose || 'variant', v.of || ''); return; }
  const ids = args.filter(a => !a.startsWith('--'));
  const all = [...VARIANTS, ...PROBES, ...EXTRA];
  const todo = args.includes('--extra') ? EXTRA.filter(v => !ids.length || ids.some(i => v.id.startsWith(i))) : ids.length ? all.filter(v => ids.includes(v.id)) : VARIANTS;
  for (const v of todo) {
    const p = plan(v);
    const s = await RT.runPlan(p, { quiet: true });   // sequential: one MAME process at a time
    console.log(`${p.name}: ok=${s.ok} ${s.seconds.toFixed(1)} s, last ${s.lastFrame}, snaps ${s.snapshots.length}`);
  }
}
module.exports = { PAL_STATES, VARIANTS, PROBES, EXTRA, DEFAULT_PHASES, plan, INVULN_FROM, SPAWN_AT };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
