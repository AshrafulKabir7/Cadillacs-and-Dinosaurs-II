#!/usr/bin/env node
// Live capture for the boss & dinosaur export. Spawns one boss/dinosaur in a stage save state of its own episode,
// exactly the way the debug spawner 0x88D76 does (pool alloc, +0 = 1, +0x20 type, +0x26 subtype, +0x5C, +0x96,
// position copied from the spawning object; here P1 + dx), then logs every active pool-A/B/C/D object every frame.
//   node tools/re/export/bosses-live.cjs [id ...]      (default: every entry of RUNS below; one MAME at a time)
//   node tools/re/export/bosses-live.cjs --list
// Each run goes to work/re/runs/bz-<id>/ (harness output: hook.jsonl, frames.jsonl with OBJ + palette dumps,
// snapshots) and a compact copy of the object log goes to work/re/extract/bosses/live/<id>.json, which
// tools/re/export/bosses.cjs reads. Plan frames follow tools/re/mame/README.md (PEEK(n) = RAM after frame n ran,
// the OBJ dump of frame n+1 is built from it).
//
// Phases of every run (plan frames):
//   2        killAll (the game's ENEMY CLEAR object) so stage enemies do not interfere
//   spawnAt  spawn the target (default 12)
//   ..idleTo hero stands still; infhp keeps the hero alive but still hittable (so grabs/throws happen)
//   ..botTo  hero walks to the target's lane and punches in bursts (hurt / knockdown reactions)
//   hpAt     target +0x6C (HP) := 1 so the next hit kills it (death animation), bot keeps punching
'use strict';
const fs = require('fs'), path = require('path');
const { runPlan, readHook, readFrames, RUNS } = require('../runtime/rt.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'work/re/extract/bosses/live');

// id, type (+0x20), sub (+0x26), state, options
const RUNS_LIST = [
  // bosses
  { id: 'vice-t', pal: [1, 2], type: 0x48, sub: 0x000, state: 'stage1-jack' },
  { id: 'walther', pal: [8, 2], type: 0x48, sub: 0x200, state: 'stage3-jack' },
  { id: 'butcher', pal: [2, 2], type: 0xF4, sub: 0x000, state: 'stage2-jack' },
  { id: 'hogg', pal: [3, 0], type: 0x7C, sub: 0x000, state: 'stage3-jack', frames: 1800 },
  { id: 'hogg-bike', pal: [3, 0], type: 0x80, sub: 0x000, state: 'stage3-jack', frames: 600, idleTo: 600 },
  { id: 'slice', pal: [4, 2], type: 0x64, sub: 0x000, state: 'stage4-jack' },
  { id: 'morgan', pal: [5, 1], type: 0x90, sub: 0x000, state: 'stage5-jack', frames: 2000, hpAt: 1500 },
  { id: 'morgan-demo', pal: [5, 1], type: 0x8C, sub: 0x000, state: 'stage5-jack', frames: 900, idleTo: 900 },
  { id: 'morgue', pal: [5, 1], type: 0xA0, sub: 0x000, state: 'stage5-jack' },
  { id: 'tyrog', pal: [6, 2], type: 0x10, sub: 0x000, state: 'stage6-jack' },
  { id: 'tyrog-kk', pal: [6, 2], type: 0x120, sub: 0x100, state: 'stage6-jack' },
  { id: 'tyrog-2', pal: [8, 3], type: 0x16C, sub: 0x000, state: 'stage8-jack' },
  { id: 'slisaur', pal: [7, 3], type: 0x11C, sub: 0x000, state: 'stage7-jack' },
  { id: 'fess-1', pal: [8, 3], type: 0x178, sub: 0x000, state: 'stage8-jack', frames: 2000, hpAt: 1500 },
  { id: 'fess-boss', pal: [8, 3], type: 0x150, sub: 0x000, state: 'stage8-jack', frames: 2400, hpAt: 1900 },
  // dinosaurs
  { id: 'pteranodon', pal: [5, 0], type: 0x148, sub: 0x000, state: 'stage5-jack' },
  { id: 'torikera', pal: [2, 0], type: 0x98, sub: 0x000, state: 'stage2-jack' },
  { id: 'torikera-b', pal: [2, 0], type: 0x98, sub: 0x200, state: 'stage2-jack' },
  { id: 'torikera-c', pal: [2, 0], type: 0x98, sub: 0x400, state: 'stage2-jack', frames: 1500 },
  { id: 'dinonics', pal: [5, 0], type: 0x74, sub: 0x400, state: 'stage5-jack' },
  { id: 'arosaurus', pal: [2, 0], type: 0x60, sub: 0x000, state: 'stage2-jack' },
  { id: 'ankirosaurs', pal: [2, 0], type: 0x138, sub: 0x000, state: 'stage2-jack', frames: 900 },
  { id: 'maiasura', pal: [2, 0], type: 0x140, sub: 0x000, state: 'stage2-jack', frames: 900 },
  { id: 'naguri', pal: [5, 0], type: 0x13C, sub: 0x000, state: 'stage5-jack' },
];
// passive variants: the hero never attacks, so the full attack pattern plays (HP is refilled every frame)
for (const r of RUNS_LIST.slice()) RUNS_LIST.push({ ...r, id: r.id + '-passive', passive: true, frames: 1800, idleTo: 240, hpAt: 99999 });
const BY_ID = Object.fromEntries(RUNS_LIST.map(r => [r.id, r]));

// OBJ palette rows the game loads for (stage, area): table 0x8E8E (0x8E4C: ptr = [0x8E8E + stage*16 + area*4], 32 row
// indices; row r = 32 bytes at 0xB7A52 + r*32, copied verbatim to the OBJ palette page 0x914000).
const R = require('../rom.cjs');
function paletteRows(stage, area) { const p = R.u32(0x8E8E + (stage - 1) * 16 + area * 4); const rows = []; for (let k = 0; k < 32; k++) rows.push(R.u16(p + k * 2)); return rows; }
function hookLua(c) {
  const palRows = c.pal ? paletteRows(c.pal[0], c.pal[1]) : null;
  const spawnAt = c.spawnAt ?? 12, idleTo = c.idleTo ?? 420, botTo = c.botTo ?? 1600, hpAt = c.hpAt ?? 1100, dx = c.dx ?? 112;
  return String.raw`
local P1 = 0xFFB274
local CFG = { at = ${spawnAt}, type = ${c.type}, sub = ${c.sub}, w5c = ${c.w5c ?? 0}, b96 = ${c.b96 ?? 0}, dx = ${dx}, idleTo = ${idleTo}, botTo = ${botTo}, hpAt = ${hpAt}, passive = ${c.passive ? 'true' : 'false'} }
local slot = nil
local PALROWS = ${palRows ? '{' + palRows.join(',') + '}' : 'nil'}
local function key(name, on) fields[name]:set_value(on and 1 or 0) end
local function target()
  if slot and rb(slot) ~= 0 and rw(slot + 0x20) == CFG.type then return slot end
  local best = nil
  for k = 0, 23 do local a = 0xFFC8F4 + k * 0xE0 if rb(a) ~= 0 and rsw(a + 0x6C) > 0 and rb(a + 4) == 2 then best = a break end end
  return best
end
function HOOK(n)
  if n == 2 then
    local s = POOL_ALLOC(0xFFE5F8, 0xFFE602)
    if s then wb(s, 1) ww(s + 0x20, 0x24) ww(s + 0x26, 0) ww(s + 0x5C, 0) wb(s + 0x96, 0) end
  end
  if n == CFG.at then
    slot = POOL_ALLOC(0xFFE5F8, 0xFFE602)
    if slot then
      wb(slot, 1) ww(slot + 0x20, CFG.type) ww(slot + 0x26, CFG.sub) ww(slot + 0x5C, CFG.w5c) wb(slot + 0x96, CFG.b96)
      ww(slot + 0x08, rw(P1 + 0x08) + CFG.dx) ww(slot + 0x0C, 0) ww(slot + 0x10, rw(P1 + 0x10))
      HLOG(fmt('{"spawn":"%X","n":%d,"type":%d,"sub":%d}', slot, n, CFG.type, CFG.sub))
    else HLOG(fmt('{"spawn":null,"n":%d}', n)) end
  end
  if PALROWS and n >= CFG.at and (n - CFG.at) % 30 == 0 then
    for sl = 0, 31 do local src = 0xB7A52 + PALROWS[sl + 1] * 32 for k = 0, 15 do ww(0x914000 + sl * 32 + k * 2, rw(src + k * 2)) end end
  end
  ww(0xFF84E8, 0x0300)                       -- stage clock held at 3:00 (R8)
  if rb(P1) ~= 0 then ww(P1 + 0x6C, rw(P1 + 0x6A)) end   -- infhp
  local R, L, U, D, A = false, false, false, false, false
  local t = target()
  if CFG.passive and n > CFG.idleTo then
    -- passive hero: never attacks; walks away for 40 frames every 150 frames (alternating sides) so the target chases,
    -- jumps and uses its ranged moves
    local ph = (n - CFG.idleTo) % 300
    if ph < 40 then L = true elseif ph >= 150 and ph < 190 then R = true end
  elseif t and n > CFG.idleTo and n < CFG.botTo then
    local tx, hx, td, hd = rsw(t + 8), rsw(P1 + 8), rsw(t + 0x10), rsw(P1 + 0x10)
    local ph = n % 30
    if ph < 14 then
      if tx > hx + 44 then R = true elseif tx < hx - 44 then L = true end
      if td > hd + 4 then U = true elseif td < hd - 4 then D = true end
      if not R and not L and ph < 2 then if tx > hx then R = true else L = true end end
    elseif ph == 16 or ph == 20 or ph == 24 or ph == 28 then A = true end
  end
  key("P1 Right", R) key("P1 Left", L) key("P1 Up", U) key("P1 Down", D) key("P1 Button 1", A)
  if n == CFG.hpAt then local tt = target() if tt then ww(tt + 0x6C, 1) HLOG(fmt('{"hp1":"%X","n":%d}', tt, n)) end end
end
local function ob(pool, k, a)
  return fmt('["%s",%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d]', pool, k,
    rw(a + 0x20), rw(a + 0x26), rb(a + 3), rb(a), rb(a + 4), rb(a + 5), rb(a + 6), rb(a + 7),
    rl(a + 0x28), rl(a + 0x40), rsw(a + 0x6A), rsw(a + 0x6C), rb(a + 0x23), rb(a + 0x24),
    rsw(a + 0x08), rsw(a + 0x0C), rsw(a + 0x10), rb(a + 0x25), rb(a + 0x2F), rl(a + 0x30), rsw(a + 0x3C), rsw(a + 0x3E),
    rb(a + 0x53), rb(a + 0x4C), rb(a + 0x4D), rb(a + 0x2E), rb(a + 1), rb(a + 0x58))
end
function PEEK(n)
  local o = {}
  for k = 0, 23 do local a = 0xFFC8F4 + k * 0xE0 if rb(a) ~= 0 then o[#o + 1] = ob("B", k, a) end end
  for k = 0, 23 do local a = 0xFFB6F4 + k * 0xC0 if rb(a) ~= 0 then o[#o + 1] = ob("C", k, a) end end
  for k = 0, 23 do local a = 0xFF8874 + k * 0xC0 if rb(a) ~= 0 then o[#o + 1] = ob("A", k, a) end end
  for k = 0, 47 do local a = 0xFF9A74 + k * 0x80 if rb(a) ~= 0 then o[#o + 1] = ob("D", k, a) end end
  local p = P1
  HLOG(fmt('{"n":%d,"cam":[%d,%d],"p1":[%d,%d,%d,%d,%d,%d,%d,%d,%d,%d],"g":[%d,%d,%d],"o":[%s]}', n, rsw(0xFF8744), rsw(0xFF8748),
    rsw(p + 8), rsw(p + 0xC), rsw(p + 0x10), rb(p + 4), rb(p + 5), rb(p + 6), rb(p + 7), rsw(p + 0x6C), rb(p + 0x24), rb(p),
    rw(0xFF85EE), rb(0xFF84EF), rb(0xFF84D9), table.concat(o, ",")))
end
`;
}

const FIELDS = ['pool', 'slot', 'type', 'sub', 'b03', 'b00', 'b04', 'b05', 'b06', 'b07', 'fp', 'set', 'hpMax', 'hp', 'p23', 'face', 'x', 'h', 'd', 'f25', 't2f', 'lp', 'tdx', 'tdy', 'f53', 'c4c', 'c4d', 'f2e', 'b01', 'atk58'];

async function capture(c) {
  const frames = c.frames ?? 1500;
  const plan = {
    name: `bz-${c.id}`, frames, loadState: c.state,
    dump: { from: 0, to: frames - 1, every: c.dumpEvery ?? 3, obj: true, cpsA: true, palette: true },
    snapshotEvery: { from: 0, to: frames - 1, every: c.snapEvery ?? 15 },
    hook: hookLua(c),
  };
  const t0 = Date.now();
  const s = await runPlan(plan, { quiet: true });
  const hook = readHook(plan.name);
  const log = hook.filter(h => h.o);   // o = arrays in FIELDS order (kept compact)
  const events = hook.filter(h => !h.o);
  fs.mkdirSync(OUT, { recursive: true });
  const meta = { id: c.id, kind: c.passive ? 'spawn-passive' : 'spawn', type: c.type, sub: c.sub, state: c.state, run: plan.name, ok: s.ok, seconds: s.seconds, frames, phases: { spawnAt: c.spawnAt ?? 12, idleTo: c.idleTo ?? 420, botTo: c.botTo ?? 1600, hpAt: c.hpAt ?? 1100 }, events, fields: FIELDS };
  fs.writeFileSync(path.join(OUT, `${c.id}.json`), JSON.stringify({ meta, log }));
  console.log(`${c.id}: ok=${s.ok} ${s.seconds.toFixed(1)} s, ${log.length} log frames, events ${JSON.stringify(events).slice(0, 160)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return s;
}


// ---------- stage walks: meet each boss the way the game stages it ----------
// Load stage<N>-jack, optionally warpArea to a later area, then a bot walks right and punches whatever is near.
// Regular grunts (KILL types) are cleared every 90 frames with the same writes as ENEMY CLEAR (0x3B7D6:
// +0x6C = 0, +0x04 = 6); bosses, mid-bosses and dinosaurs are never touched. Once a boss (name index in BOSSNAME)
// is active, the bot fights it; fightFor frames later its HP is set to 1 so the death plays.
const STAGES = [
  { id: 'stage1', state: 'stage1-jack', area: 2, frames: 9000, next: 1 },
  { id: 'stage2', state: 'stage2-jack', area: 2, frames: 9000, next: 2 },
  { id: 'stage3', state: 'stage3-jack', area: 0, frames: 12000, next: 3 },
  { id: 'stage4', state: 'stage4-jack', area: 2, frames: 9000, next: 4 },
  { id: 'stage5', state: 'stage5-jack', area: 0, frames: 20000, next: 5, saveAt: 19990 },
  { id: 'stage5b', state: 'bz-stage5-19990', area: 0, frames: 15000, next: 5 },
  { id: 'stage6', state: 'stage6-jack', area: 1, frames: 20000, next: 6, saveAt: 19990 },
  { id: 'stage6b', state: 'bz-stage6-19990', area: 0, frames: 15000, next: 6 },
  { id: 'stage7', state: 'stage7-jack', area: 3, frames: 12000, next: 7 },
  { id: 'stage8', state: 'stage8-jack', area: 2, frames: 20000, next: 0, saveAt: 19990 },
  { id: 'stage8b', state: 'bz-stage8-19990', area: 0, frames: 20000, next: 0 },
  // whole-stage walks from area 0 (census of mid-bosses and dinosaurs per episode)
  { id: 'stage1full', state: 'stage1-jack', area: 0, frames: 30000, next: 1 },
  { id: 'stage2full', state: 'stage2-jack', area: 0, frames: 30000, next: 2 },
  { id: 'stage4full', state: 'stage4-jack', area: 0, frames: 30000, next: 4 },
  { id: 'stage7full', state: 'stage7-jack', area: 0, frames: 30000, next: 7 },
  { id: 'stage8full', state: 'stage8-jack', area: 0, frames: 30000, next: 0 },
  { id: 'stage6a0', state: 'stage6-jack', area: 0, frames: 15000, next: 6 },
];
const BY_STAGE = Object.fromEntries(STAGES.map(r => [r.id, r]));
function stageLua(c) {
  return String.raw`
local P1 = 0xFFB274
local KILL = { [0x08]=true, [0x0C]=true, [0x18]=true, [0x28]=true, [0x34]=true, [0x38]=true, [0xF0]=true, [0x50]=true, [0x100]=true, [0x118]=true, [0xFC]=true }
local BOSSNAME = { [0x0C]=true, [0x0F]=true, [0x26]=true, [0x05]=true, [0x15]=true, [0x16]=true, [0x19]=true, [0x1B]=true, [0x23]=true, [0x18]=true, [0x22]=true, [0x25]=true }
local CFG = { area = ${c.area}, fightFor = ${c.fightFor ?? 1500} }
local bossT0, hpDone = nil, {}
local lastX, stuck = -1, 0
local function key(name, on) fields[name]:set_value(on and 1 or 0) end
function HOOK(n)
  ww(0xFF84E8, 0x0300)
  local a0 = rb(P1) if a0 == 1 or a0 == 2 then wb(P1, 2) wb(P1 + 0xF9, 0x3C) end
  if CFG.area > 0 and n == 10 then
    local stage = rb(0xFF84D9)
    local tbl = 0x21B2A + rw(0x21B2A + stage * 2)
    local k = nil
    for i = 1, 63 do local e = tbl + i * 16 if rw(e) == 0xFFFF then break end if rw(e) == 0 and rb(e + 0xA) == CFG.area then k = i break end end
    if k then wl(0xFF8792, tbl + k * 16) wb(0xFF87A8, k) wb(0xFF87A9, 1) wb(0xFF8742, 2) wb(0xFF8741, 1) HLOG(fmt('{"warpArea":%d,"n":%d,"segment":%d}', CFG.area, n, k))
    else HLOG(fmt('{"warpArea":%d,"n":%d,"error":"no segment"}', CFG.area, n)) end
  end
  local boss, near, nd = nil, nil, 1e9
  local hx, hd = rsw(P1 + 8), rsw(P1 + 0x10)
  for k = 0, 23 do local a = 0xFFC8F4 + k * 0xE0
    if rb(a) ~= 0 then
      if BOSSNAME[rb(a + 3)] and rsw(a + 0x6C) > 0 then boss = a end
      if n % 90 == 45 and KILL[rw(a + 0x20)] and rb(a + 4) == 2 then ww(a + 0x6C, 0) wb(a + 4, 6) end
      if rb(a) == 1 and rsw(a + 0x6C) > 0 then local dd = math.abs(rsw(a + 8) - hx) if dd < nd then nd, near = dd, a end end
    end
  end
  for k = 0, 23 do local a = 0xFF8874 + k * 0xC0
    if rb(a) ~= 0 and rw(a + 0x20) == 0x14 and rsw(a + 0x6C) > 0 then local dd = math.abs(rsw(a + 8) - hx) if dd < 90 and dd < nd then nd, near = dd, a end end
  end
  if hx == lastX or (stuck > 40 and math.abs(hx - lastX) < 2) then stuck = stuck + 1 else stuck = 0 end
  lastX = hx
  if boss and not bossT0 then bossT0 = n HLOG(fmt('{"boss":"%X","n":%d,"type":%d,"b03":%d}', boss, n, rw(boss + 0x20), rb(boss + 3))) end
  if boss and bossT0 and n >= bossT0 + CFG.fightFor and not hpDone[boss] and rsw(boss + 0x6C) > 1 then hpDone[boss] = true ww(boss + 0x6C, 1) HLOG(fmt('{"hp1":"%X","n":%d}', boss, n)) end
  local t = boss or ((nd < 160) and near or nil)
  local R, L, U, D, A = false, false, false, false, false
  if rb(0xFF84D0) == 0x0C and n > 40 then
    if t then
      local tx, td = rsw(t + 8), rsw(t + 0x10)
      local ph = n % 30
      if ph < 14 then
        if tx > hx + 44 then R = true elseif tx < hx - 44 then L = true end
        if td > hd + 4 then U = true elseif td < hd - 4 then D = true end
        if not R and not L and ph < 2 then if tx > hx then R = true else L = true end end
      elseif ph == 16 or ph == 20 or ph == 24 or ph == 28 then A = true end
    else
      R = true
      if n % 40 == 0 and stuck < 40 then A = true end
      if stuck > 40 then
        local ph = math.floor((stuck - 40) / 90) % 6
        if ph == 0 then D = true elseif ph == 1 then U = true elseif ph == 2 then R = false D = true elseif ph == 3 then R = false U = true elseif ph == 4 then R = false L = true D = true else R = false L = true U = true end
        if stuck % 97 == 0 then A = true end
      elseif hd > 300 and n % 60 < 10 then D = true end
    end
  end
  key("P1 Right", R) key("P1 Left", L) key("P1 Up", U) key("P1 Down", D) key("P1 Button 1", A)
end
local function ob(pool, k, a)
  return fmt('["%s",%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d]', pool, k,
    rw(a + 0x20), rw(a + 0x26), rb(a + 3), rb(a), rb(a + 4), rb(a + 5), rb(a + 6), rb(a + 7),
    rl(a + 0x28), rl(a + 0x40), rsw(a + 0x6A), rsw(a + 0x6C), rb(a + 0x23), rb(a + 0x24),
    rsw(a + 0x08), rsw(a + 0x0C), rsw(a + 0x10), rb(a + 0x25), rb(a + 0x2F), rl(a + 0x30), rsw(a + 0x3C), rsw(a + 0x3E),
    rb(a + 0x53), rb(a + 0x4C), rb(a + 0x4D), rb(a + 0x2E), rb(a + 1), rb(a + 0x58))
end
function PEEK(n)
  local o = {}
  for k = 0, 23 do local a = 0xFFC8F4 + k * 0xE0 if rb(a) ~= 0 then o[#o + 1] = ob("B", k, a) end end
  for k = 0, 23 do local a = 0xFFB6F4 + k * 0xC0 if rb(a) ~= 0 then o[#o + 1] = ob("C", k, a) end end
  if n % 4 == 0 or bossT0 then
    for k = 0, 23 do local a = 0xFF8874 + k * 0xC0 if rb(a) ~= 0 then o[#o + 1] = ob("A", k, a) end end
    for k = 0, 47 do local a = 0xFF9A74 + k * 0x80 if rb(a) ~= 0 then o[#o + 1] = ob("D", k, a) end end
  end
  local p = P1
  HLOG(fmt('{"n":%d,"cam":[%d,%d],"p1":[%d,%d,%d,%d,%d,%d,%d,%d,%d,%d],"g":[%d,%d,%d,%d,%d],"o":[%s]}', n, rsw(0xFF8744), rsw(0xFF8748),
    rsw(p + 8), rsw(p + 0xC), rsw(p + 0x10), rb(p + 4), rb(p + 5), rb(p + 6), rb(p + 7), rsw(p + 0x6C), rb(p + 0x24), rb(p),
    rw(0xFF85EE), rb(0xFF84EF), rb(0xFF84D9), rb(0xFF8786), rb(0xFF84D0), table.concat(o, ",")))
end
`;
}
async function captureStage(c) {
  const frames = c.frames;
  const plan = {
    name: `bz-${c.id}`, frames, loadState: c.state,
    dump: { from: 0, to: frames - 1, every: 6, obj: true, cpsA: true, palette: true },
    snapshotEvery: { from: 0, to: frames - 1, every: 30 },
    stopWhen: { addr: '0xFF84D9', size: 1, value: c.next, after: 100 },
    ...(c.saveAt ? { saveStateAt: { frame: c.saveAt, name: `bz-${c.id}-${c.saveAt}` } } : {}),
    hook: stageLua(c),
  };
  const s = await runPlan(plan, { quiet: true });
  const hook = readHook(plan.name);
  const log = hook.filter(h => h.o), events = hook.filter(h => !h.o);
  fs.mkdirSync(OUT, { recursive: true });
  const meta = { id: c.id, kind: 'stage', state: c.state, area: c.area, run: plan.name, ok: s.ok, seconds: s.seconds, frames, lastFrame: s.lastFrame, events, fields: FIELDS, g: ['rank 0xFF85EE', 'players-1 0xFF84EF', 'stage 0xFF84D9', 'area 0xFF8786', 'main state 0xFF84D0'] };
  fs.writeFileSync(path.join(OUT, `${c.id}.json`), JSON.stringify({ meta, log }));
  console.log(`${c.id}: ok=${s.ok} ${s.seconds.toFixed(1)} s, last ${s.lastFrame}, events ${JSON.stringify(events).slice(0, 400)}`);
  return s;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--list') { for (const r of RUNS_LIST) console.log(r.id, '0x' + r.type.toString(16), '0x' + r.sub.toString(16), r.state); return; }
  const ids = args.length ? args : [...STAGES.map(r => r.id), ...RUNS_LIST.map(r => r.id)];
  for (const id of ids) { if (BY_STAGE[id]) { await captureStage(BY_STAGE[id]); continue; } const c = BY_ID[id]; if (!c) { console.error('unknown id', id); process.exitCode = 1; continue; } await capture(c); }   // strictly one MAME at a time
}
if (require.main === module) main();
module.exports = { paletteRows, RUNS_LIST, STAGES, FIELDS, hookLua, stageLua };
