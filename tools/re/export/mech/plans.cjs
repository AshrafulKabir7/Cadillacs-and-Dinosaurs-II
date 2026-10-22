// Live MAME plans for the game-mechanics export (tools/re/export/mechanics.cjs). Research tooling only.
// Every plan is run through tools/re/runtime/rt.cjs (via lib/live.cjs runSeq: one MAME process at a time, a run is
// skipped when work/re/runs/<name>/ already holds an ok run of the identical plan).
//
// Shared Lua (MECH_LUA) gives every plan:
//   * MSPAWN(entry, sub, dx, dd): the verified debug spawn-list writes (V10, 0x88DDA) at P1's position + (dx, dd);
//   * HPTAP(slot, tag): a write tap on <slot>+0x6C (HP). Each real HP change logs the writing PC, D1 (the damage the
//     game's hit routines subtract with `sub.w D1,($6c,A3)`), the attacker in A2 (type, subtype, +0x03 id, +0x02
//     player, +0x58 attack id, state, frame pointer, +0x2E, +0xC6 power, +0xA0 class) and the victim's +0x84, state,
//     stun meter, rank words 0xFF85EE / 0xFF85F0;
//   * VTAP(base, tag): write taps on +0x14..+0x1F (velocities / accelerations) logging the PC of each distinct
//     (offset, value, pc), so every measured speed is tied to the code (and table) that set it;
//   * PEEK: one compact JSON line per frame for P1 and the tracked target.
// Writes made by these scripts themselves (HP refills) set NOLOG so the taps skip them.
'use strict';

const P1 = 0xFFB274;
const HEROES = ['jack', 'mustapha', 'hannah', 'mess'];   // character id order (V27)

const MECH_LUA = String.raw`
local CPU = manager.machine.devices[":maincpu"]
P1 = ${P1}
FRN = 0
NOLOG = false
TARGET = nil
local function rsb(a) local v = space:read_u8(a) if v >= 0x80 then v = v - 0x100 end return v end
RSB = rsb
local EXPOOLS = {[0]={0xFFE5F8,0xFFE602},[1]={0xFFE5F6,0xFFE600},[3]={0xFFE5F4,0xFFE5FE}}
function MSPAWN(e, sub, dx, dd, w6)
  local a = 0x88DDA + e * 26 + 16
  local cls = rw(a) & 7
  local p = EXPOOLS[cls]
  local s = POOL_ALLOC(p[1], p[2])
  if not s then HLOG(fmt('{"t":"spawn","f":%d,"e":%d,"err":"pool full"}', FRN, e)) return nil end
  if sub < 0 then sub = rw(a + 4) end
  wb(s, 1) ww(s + 0x20, rw(a + 2)) ww(s + 0x26, sub) ww(s + 0x5C, rw(a + 6)) wb(s + 0x96, rw(a + 8) & 0xFF)
  ww(s + 8, rw(P1 + 8) + dx) ww(s + 0xC, rw(P1 + 0xC)) ww(s + 0x10, rw(P1 + 0x10) + dd)
  if w6 ~= nil then wb(s + 6, w6) end
  HLOG(fmt('{"t":"spawn","f":%d,"e":%d,"slot":%d,"type":%d,"sub":%d}', FRN, e, s, rw(a + 2), sub))
  return s
end
local function a2info(a2)
  if a2 < 0xFF0000 then return '"a2":0' end
  return fmt('"a2":%d,"a2ty":%d,"a2sub":%d,"a2id":%d,"a2pl":%d,"a2at":%d,"a2st":%d,"a2fp":%d,"a2b2e":%d,"a2c6":%d,"a2cls":%d,"a2r84":%d,"a2ee":%d',
    a2, rw(a2 + 0x20), rw(a2 + 0x26), rb(a2 + 3), rsb(a2 + 2), rb(a2 + 0x58), rl(a2 + 4), rl(a2 + 0x28), rb(a2 + 0x2E), rb(a2 + 0xC6), rw(a2 + 0xA0), rw(a2 + 0x84), rsw(a2 + 0xEE))
end
TAPS = {}
function HPTAP(slot, tag)
  TAPS[#TAPS + 1] = space:install_write_tap(slot + 0x6C, slot + 0x6D, "hp" .. tag, function(o, d, m)
    if NOLOG then return end
    local old, new = rw(slot + 0x6C), d & 0xFFFF
    if new == old then return end
    local a2 = CPU.state["A2"].value & 0xFFFFFF
    if tag == "tg" then LASTHIT = FRN end
    HLOG(fmt('{"t":"hp","tag":"%s","f":%d,"pc":%d,"old":%d,"new":%d,"d1":%d,"d0":%d,"vty":%d,"vr84":%d,"vst":%d,"vstun":%d,"vat":%d,"vb2e":%d,"vhpm":%d,"rank":%d,"rank2":%d,%s}',
      tag, FRN, CPU.state["CURPC"].value, rsw(slot + 0x6C), (new >= 0x8000) and (new - 0x10000) or new, CPU.state["D1"].value & 0xFFFF, CPU.state["D0"].value & 0xFFFF,
      rw(slot + 0x20), rw(slot + 0x84), rl(slot + 4), rb(slot + 0x78), rb(slot + 0x58), rb(slot + 0x2E), rw(slot + 0x6A), rw(0xFF85EE), rw(0xFF85F0), a2info(a2)))
  end)
end
local VSEEN = {}
function VTAP(base, tag)
  TAPS[#TAPS + 1] = space:install_write_tap(base + 0x14, base + 0x1F, "v" .. tag, function(o, d, m)
    local pc = CPU.state["CURPC"].value
    local off = o - base
    local k = off .. ":" .. d .. ":" .. m .. ":" .. pc
    if VSEEN[k] then return end
    VSEEN[k] = true
    HLOG(fmt('{"t":"v","tag":"%s","f":%d,"o":%d,"d":%d,"m":%d,"pc":%d,"st":%d,"id":%d}', tag, FRN, off, d, m, pc, rl(base + 4), rb(base + 3)))
  end)
end
function TAPW(addr, len, tag)
  TAPS[#TAPS + 1] = space:install_write_tap(addr, addr + len - 1, "w" .. tag, function(o, d, m)
    if NOLOG then return end
    HLOG(fmt('{"t":"w","tag":"%s","f":%d,"o":%d,"d":%d,"m":%d,"pc":%d,"cur":%d}', tag, FRN, o, d, m, CPU.state["CURPC"].value, rl(o & 0xFFFFFC)))
  end)
end
LASTHIT = -1
function TIMERHOLD(n) if n % 30 == 0 then NOLOG = true ww(0xFF84E8, 0x0359) NOLOG = false end end
function SETF(k, v) fields[k]:set_value(v and 1 or 0) end
local KEYN = {R = "P1 Right", L = "P1 Left", U = "P1 Up", D = "P1 Down", A = "P1 Button 1", J = "P1 Button 2"}
function KEYS(t) for k, name in pairs(KEYN) do fields[name]:set_value(t[k] and 1 or 0) end end
function P1LINE()
  return fmt('"p1":{"s0":%d,"st":%d,"x":%d,"h":%d,"d":%d,"vx":%d,"vh":%d,"vd":%d,"ax":%d,"ah":%d,"ad":%d,"f24":%d,"at":%d,"hs":%d,"hp":%d,"hpm":%d,"c6":%d,"ee":%d,"ec":%d,"f9":%d,"stun":%d,"lives":%d,"sc":%d,"fp":%d,"w":%d,"b2e":%d,"f6":%d,"in":%d}',
    rb(P1), rl(P1 + 4), rl(P1 + 8), rl(P1 + 0xC), rl(P1 + 0x10), rsw(P1 + 0x14), rsw(P1 + 0x16), rsw(P1 + 0x18), rsw(P1 + 0x1A), rsw(P1 + 0x1C), rsw(P1 + 0x1E),
    rb(P1 + 0x24), rb(P1 + 0x58), rb(P1 + 0x59), rsw(P1 + 0x6C), rw(P1 + 0x6A), rb(P1 + 0xC6), rsw(P1 + 0xEE), rw(P1 + 0xEC), rb(P1 + 0xF9), rb(P1 + 0x78), rb(P1 + 0xA3),
    rl(P1 + 0x100), rl(P1 + 0x28), rw(P1 + 0xB4), rb(P1 + 0x2E), rw(P1 + 0xF6), rb(P1 + 0xA0))
end
function OBJLINE(a)
  if not a or rb(a) == 0 then return '"tg":null' end
  return fmt('"tg":{"a":%d,"s0":%d,"ty":%d,"st":%d,"x":%d,"h":%d,"d":%d,"hp":%d,"hpm":%d,"hs":%d,"stun":%d,"at":%d,"b2e":%d,"f24":%d,"r84":%d,"fp":%d,"vx":%d,"vh":%d}',
    a, rb(a), rw(a + 0x20), rl(a + 4), rsw(a + 8), rsw(a + 0xC), rsw(a + 0x10), rsw(a + 0x6C), rw(a + 0x6A), rb(a + 0x59), rb(a + 0x78), rb(a + 0x58), rb(a + 0x2E), rb(a + 0x24), rw(a + 0x84), rl(a + 0x28), rsw(a + 0x14), rsw(a + 0x16))
end
function GLOBLINE()
  return fmt('"g":{"rk0":%d,"rk":%d,"rk2":%d,"rkA":%d,"tm":%d,"tk":%d,"st":%d,"ar":%d,"ms":%d,"cx":%d,"cy":%d,"cad":%d}',
    rw(0xFF85EC), rw(0xFF85EE), rw(0xFF85F0), rw(0xFF85F6), rw(0xFF84E8), rb(0xFF84EA), rb(0xFF84D9), rb(0xFF8786), rb(0xFF84D0), rsw(0xFF8744), rsw(0xFF8748), rb(0xFF8518))
end
`;

// ------------------------------------------------------------------------------------------------ locomotion
// Walk in the 8 directions, run (double tap), stop, every jump (standing, forward, backward, running), a mega crash
// with nothing in range (to show it costs no HP), with write taps on P1 +0x14..+0x1F.
function loco(hero) {
  const A = (at, keys, len = 1) => ({ from: at, to: at + len - 1, keys });
  const inputs = [
    A(10, ['right'], 40), A(60, ['left'], 30), A(100, ['up'], 30), A(140, ['down'], 30),
    A(180, ['right', 'up'], 30), A(220, ['right', 'down'], 30), A(260, ['left', 'up'], 30), A(300, ['left', 'down'], 30),
    A(340, ['right'], 4),                                              // face right
    A(360, ['right'], 2), A(365, ['right'], 50),                       // run right (double tap), release at 415
    A(440, ['left'], 4),                                               // face left
    A(460, ['left'], 2), A(465, ['left'], 40),                         // run left
    A(530, ['right'], 4),                                              // face right
    A(550, ['right'], 2), A(555, ['right'], 25), A(590, ['jump'], 2),  // run, release, jump while still running = running jump
    A(660, ['right'], 2), A(665, ['right'], 40), A(690, ['jump'], 2),  // run and jump with the direction held
    A(760, ['jump'], 2),                                               // standing jump (no direction)
    A(830, ['right', 'jump'], 3), A(833, ['right'], 40),               // forward jump
    A(910, ['left'], 1), A(911, ['right', 'jump'], 3),                 // reversed stick -> backward jump
    A(1000, ['attack', 'jump'], 2),                                    // mega crash with nothing in range (killAll before)
    A(1080, ['right'], 4), A(1100, ['right'], 2), A(1105, ['right'], 30), A(1122, ['attack'], 2), // dash attack
    A(1180, ['up'], 2), A(1185, ['up'], 30),                           // double tap up (no run expected)
    A(1240, ['right'], 2), A(1245, ['right'], 40), A(1260, ['right', 'up'], 25), // run then steer up while running
  ];
  return {
    name: `mech-loco-${hero}`, frames: 1330, loadState: `stage1-${hero}`,
    cheats: [{ cheat: 'invuln' }, { cheat: 'infhp' }, { cheat: 'killAll', every: 20, from: 940, to: 1060 }],
    inputs,
    hook: MECH_LUA + String.raw`
VTAP(P1, "p1")
HPTAP(P1, "p1")
function HOOK(n) FRN = n TIMERHOLD(n) end
local function occ(base, n, stride) local c = 0 for k = 0, n - 1 do if rb(base + k * stride) ~= 0 then c = c + 1 end end return c end
function PEEK(n) FRN = n HLOG(fmt('{"t":"f","f":%d,%s,%s,"nA":%d,"nB":%d,"nC":%d}', n, P1LINE(), GLOBLINE(), occ(0xFF8874, 24, 0xC0), occ(0xFFC8F4, 24, 0xE0), occ(0xFFB6F4, 24, 0xC0))) end
`,
  };
}

// ------------------------------------------------------------------------------------------------ moves
// A Lua bot fights one Chinpira A (spawn entry 1). The hero is invulnerable with HP refilled (the mega crash cost
// is then always taken from 100); the target's HP is held at HOLDHP so the damage modifier's HP bands are fixed
// (HP 100: no extra bar, band >= 75), and P1 +0xC6 (power, re-rolled only when the hero is hit) is held at 32.
// Each move: position (|dx| in [dist-6, dist+6], same lane, facing), then its key timeline, then a pause.
const MOVES = [
  { n: 'combo', dist: 34, seq: [[0, 'A'], [8, 'A'], [16, 'A'], [24, 'A'], [32, 'A'], [40, 'A'], [48, 'A']], dur: 90 },
  { n: 'combo-slow', dist: 34, seq: [[0, 'A'], [14, 'A'], [28, 'A'], [42, 'A'], [56, 'A']], dur: 100 },
  { n: 'jab', dist: 34, seq: [[0, 'A']], dur: 50 },
  { n: 'dash-attack', dist: 150, pin: 50, pinFrom: 28, seq: [[4, 'T', 2], [9, 'T', 30], [28, 'A', 2]], dur: 84 },
  { n: 'jump-kick-early', dist: 40, pin: 30, seq: [[0, 'J', 2], [6, 'A', 2]], dur: 70 },
  { n: 'jump-kick-apex', dist: 40, pin: 30, seq: [[0, 'J', 2], [18, 'A', 2]], dur: 70 },
  { n: 'jump-kick-falling', dist: 40, pin: 30, seq: [[0, 'J', 2], [30, 'A', 2]], dur: 80 },
  { n: 'jump-forward-kick', dist: 90, pin: 34, pinFrom: 26, seq: [[0, 'TJ', 3], [3, 'T', 34], [28, 'A', 2]], dur: 80 },
  { n: 'jump-down-attack', dist: 34, pin: 24, seq: [[0, 'J', 2], [26, 'DA', 3]], dur: 80 },
  { n: 'jump-up-attack', dist: 34, pin: 24, seq: [[0, 'J', 2], [26, 'UA', 3]], dur: 80 },
  { n: 'running-jump-kick', dist: 160, pin: 36, pinFrom: 38, seq: [[4, 'T', 2], [9, 'T', 40], [26, 'J', 2], [38, 'A', 2]], dur: 94 },
  { n: 'mega-crash', dist: 30, seq: [[0, 'AJ', 2]], dur: 90 },
  { n: 'grab-knee3-throw', grab: true, seq: [[10, 'A', 2], [26, 'A', 2], [42, 'A', 2], [70, 'TA', 3]], dur: 110 },
  { n: 'grab-back-throw', grab: true, seq: [[12, 'BA', 3]], dur: 100 },
  { n: 'grab-forward-throw', grab: true, seq: [[12, 'TA', 3]], dur: 100 },
  { n: 'grab-knee-x6', grab: true, seq: [[10, 'A', 2], [24, 'A', 2], [38, 'A', 2], [52, 'A', 2], [66, 'A', 2], [80, 'A', 2]], dur: 120 },
  { n: 'grab-jump', grab: true, seq: [[12, 'J', 2], [20, 'A', 2]], dur: 100 },
  { n: 'running-mega-crash', dist: 150, pin: 40, pinFrom: 24, seq: [[4, 'T', 2], [9, 'T', 25], [24, 'AJ', 2]], dur: 94 },
  { n: 'running-attack-up', dist: 150, pin: 44, pinFrom: 26, seq: [[4, 'T', 2], [9, 'T', 30], [26, 'UA', 2]], dur: 84 },
  { n: 'back-attack', dist: 34, faceAway: true, pin: -30, seq: [[0, 'BA', 3]], dur: 60 },
  { n: 'jump-attack-while-grab-range', dist: 26, pin: 26, seq: [[0, 'TJ', 3], [8, 'A', 2]], dur: 80 },
];
function luaMoves(list = MOVES) {
  return 'MOVES = {' + list.map(m => `{n="${m.n}",dist=${m.dist || 0},pin=${m.pin || 0},pinFrom=${m.pinFrom || 0},grab=${m.grab ? 'true' : 'false'},away=${m.faceAway ? 'true' : 'false'},dur=${m.dur},seq={` +
    m.seq.map(([t, k, len]) => `{${t},"${k}",${len || 2}}`).join(',') + '}}').join(',\n') + '}\n';
}
// a slower jab cadence (7 frames) that stays out of grab range: for the move labels of ids 0/2/4 (Mess's 8-frame
// script walked into a grab and landed knees instead)
const COMBO7 = [{ n: 'combo-7f', dist: 40, seq: [[0, 'A'], [7, 'A'], [14, 'A'], [21, 'A'], [28, 'A'], [35, 'A'], [42, 'A']], dur: 90 }];
function moves(hero, { reps = 2, holdHp = 100, state, name, target = 1, extraFrames = 400, c6 = 32, movesList = MOVES } = {}) {
  const lua = MECH_LUA + luaMoves(movesList) + String.raw`
local REPS = ${reps}
local HOLDHP = ${holdHp}
local C6 = ${c6}
local TGT_ENTRY = ${target}
local mi, rep, phase, t0, grabAt = 1, 1, "spawn", 0, nil
local DONE = false
local function tgtOk() return TARGET and rb(TARGET) ~= 0 and rw(TARGET + 0x20) == TTYPE end
local function respawn()
  TARGET = MSPAWN(TGT_ENTRY, -1, 70, 0)
  if TARGET then TTYPE = rw(TARGET + 0x20) HPTAP(TARGET, "tg") end
end
local function keysFor(code, toward, away, keys)
  for c in code:gmatch(".") do
    if c == "T" then keys[toward] = true elseif c == "B" then keys[away] = true
    else keys[c] = true end
  end
end
function HOOK(n)
  FRN = n
  TIMERHOLD(n)
  if n == 3 then respawn() phase = "pos" t0 = n end
  if C6 >= 0 then wb(P1 + 0xC6, C6) end
  if TARGET and tgtOk() and HOLDHP > 0 and rsw(TARGET + 0x6C) ~= HOLDHP and rsw(TARGET + 0x6C) > 0 then NOLOG = true ww(TARGET + 0x6C, HOLDHP) NOLOG = false end
  local keys = {}
  if DONE or phase == "spawn" then KEYS(keys) return end
  if not tgtOk() then
    if phase ~= "gone" then HLOG(fmt('{"t":"gone","f":%d}', n)) phase = "gone" t0 = n end
    if n - t0 > 30 then respawn() phase = "pos" t0 = n end
    KEYS(keys) return
  end
  local m = MOVES[mi]
  local px, pd = rsw(P1 + 8), rsw(P1 + 0x10)
  local ex, ed = rsw(TARGET + 8), rsw(TARGET + 0x10)
  local dx, dd = ex - px, ed - pd
  local adx, add = math.abs(dx), math.abs(dd)
  local toward, away = "L", "R"
  if dx > 0 then toward, away = "R", "L" end
  local faceR = rb(P1 + 0x24) ~= 0
  local facing = (dx > 0) == faceR
  local st4, st5, st6, st7 = rb(P1 + 4), rb(P1 + 5), rb(P1 + 6), rb(P1 + 7)
  local idle = st4 == 2 and st5 == 0 and st6 == 0 and (st7 == 0 or st7 == 2)
  if phase == "pos" then
    local ok = true
    if add > 3 then keys[(dd > 0) and "U" or "D"] = true ok = false end
    if not m.grab then
      if adx > m.dist + 6 then keys[toward] = true ok = false
      elseif adx < m.dist - 6 then keys[away] = true ok = false
      elseif m.away and facing then keys[away] = true ok = false
      elseif not m.away and not facing then keys[toward] = true ok = false end
      if ok and (rb(TARGET) ~= 1 or not idle) then ok = false end
      if ok or n - t0 > 240 then
        phase = "act" t0 = n
        HLOG(fmt('{"t":"move","f":%d,"mi":%d,"n":"%s","rep":%d,"dx":%d,"dd":%d,"forced":%s}', n, mi, m.n, rep, dx, dd, tostring(not ok)))
        keys = {}
      end
    else
      if rb(P1 + 5) == 4 then phase = "act" t0 = n HLOG(fmt('{"t":"move","f":%d,"mi":%d,"n":"%s","rep":%d,"grab":1}', n, mi, m.n, rep))
      else
        if add > 2 then keys[(dd > 0) and "U" or "D"] = true end
        if rb(TARGET) == 1 then keys[toward] = true end
        if n - t0 > 300 then phase = "act" t0 = n HLOG(fmt('{"t":"move","f":%d,"mi":%d,"n":"%s","rep":%d,"grab":0}', n, mi, m.n, rep)) end
      end
    end
  end
  if phase == "act" then
    local t = n - t0
    -- dummy mode: keep the target at m.pin px in front of the hero (behind when negative), same lane, until it is hit
    if m.pin ~= 0 and t >= m.pinFrom and LASTHIT < t0 and rb(TARGET) == 1 and rb(TARGET + 5) == 0 then
      local dir = faceR and 1 or -1
      NOLOG = true ww(TARGET + 8, px + m.pin * dir) ww(TARGET + 0x10, pd) NOLOG = false
    end
    for _, s in ipairs(m.seq) do if t >= s[1] and t < s[1] + s[3] then keysFor(s[2], toward, away, keys) end end
    if t >= m.dur then
      HLOG(fmt('{"t":"moveend","f":%d,"mi":%d}', n, mi))
      rep = rep + 1
      if rep > REPS then rep = 1 mi = mi + 1 end
      if mi > #MOVES then DONE = true HLOG(fmt('{"t":"done","f":%d}', n)) end
      phase = "pos" t0 = n
    end
  end
  KEYS(keys)
end
HPTAP(P1, "p1")
function PEEK(n) FRN = n HLOG(fmt('{"t":"f","f":%d,%s,%s,%s}', n, P1LINE(), OBJLINE(TARGET), GLOBLINE())) end
`;
  const per = movesList.reduce((a, m) => a + m.dur + 160, 0) * reps;
  return {
    name: name || `mech-moves-${hero}`, frames: per + extraFrames, loadState: state || `stage1-${hero}`,
    cheats: [{ cheat: 'invuln' }, { cheat: 'infhp' }, { cheat: 'lives', value: 9, at: 2 }],
    hook: lua,
  };
}

// ------------------------------------------------------------------------------------------------ weapons
// Armed states (stage1-<hero>-armed-<weapon>): one Chinpira A in front, HP held at 100; the hero fires / swings /
// throws from a fixed distance. HP tap logs the projectile (A2) with its type/subtype and attack id.
const WEAPON_SPEC = {
  rifle: { dist: 110, every: 26, shots: 7 }, gun: { dist: 110, every: 26, shots: 7 }, uzi: { dist: 110, every: 40, shots: 6, hold: 12 },
  m16: { dist: 110, every: 40, shots: 6, hold: 12 }, shotgun: { dist: 90, every: 30, shots: 7 }, bazooka: { dist: 130, every: 50, shots: 5 },
  knife: { dist: 30, every: 26, shots: 6 }, rod: { dist: 34, every: 30, shots: 8 }, stick: { dist: 34, every: 26, shots: 6 },
  bknife: { dist: 34, every: 26, shots: 6 }, club: { dist: 34, every: 30, shots: 8 }, torch: { dist: 34, every: 30, shots: 8 },
  dynamite: { dist: 110, every: 160, shots: 3 }, grenade: { dist: 110, every: 110, shots: 3 }, stone: { dist: 90, every: 40, shots: 3 },
  knifethrow: { state: 'knife', dist: 120, every: 40, shots: 4 },
};
function weapon(hero, w) {
  const sp = WEAPON_SPEC[w], wname = sp.state || w;
  const lua = MECH_LUA + String.raw`
local DIST, EVERY, SHOTS, HOLD = ${sp.dist}, ${sp.every}, ${sp.shots}, ${sp.hold || 2}
local phase, t0, shot = "spawn", 0, 0
local function tgtOk() return TARGET and rb(TARGET) ~= 0 and rw(TARGET + 0x20) == TTYPE end
local function respawn()
  local dir = (rb(P1 + 0x24) ~= 0) and 1 or -1
  TARGET = MSPAWN(1, -1, DIST * dir, 0)
  if TARGET then TTYPE = rw(TARGET + 0x20) HPTAP(TARGET, "tg") end
end
function HOOK(n)
  FRN = n
  TIMERHOLD(n)
  if n == 3 then respawn() phase = "pos" t0 = n end
  wb(P1 + 0xC6, 32)
  if TARGET and tgtOk() and rsw(TARGET + 0x6C) ~= 100 and rsw(TARGET + 0x6C) > 0 then NOLOG = true ww(TARGET + 0x6C, 100) NOLOG = false end
  local keys = {}
  if phase == "spawn" or phase == "done" then KEYS(keys) return end
  if not tgtOk() then if n - t0 > 30 then respawn() t0 = n end KEYS(keys) return end
  local px, pd = rsw(P1 + 8), rsw(P1 + 0x10)
  local ex, ed = rsw(TARGET + 8), rsw(TARGET + 0x10)
  local dx, dd = ex - px, ed - pd
  local adx, add = math.abs(dx), math.abs(dd)
  local toward, away = "L", "R"
  if dx > 0 then toward, away = "R", "L" end
  local facing = (dx > 0) == (rb(P1 + 0x24) ~= 0)
  -- keep the target at DIST: pin its X/depth relative to the hero while it is idle-walking (not while hit)
  if rb(TARGET) == 1 and (rl(TARGET + 4) >> 24) == 2 and ((rl(TARGET + 4) >> 16) & 0xFF) == 0 then
    NOLOG = true
    local dir = (rb(P1 + 0x24) ~= 0) and 1 or -1
    ww(TARGET + 8, px + DIST * dir) ww(TARGET + 0x10, pd)
    NOLOG = false
  end
  if phase == "pos" then
    if not facing then keys[toward] = true
    elseif n - t0 > 20 then phase = "fire" t0 = n end
  elseif phase == "fire" then
    local t = n - t0
    if t % EVERY < HOLD then keys.A = true end
    if t % EVERY == 0 then shot = shot + 1 HLOG(fmt('{"t":"shot","f":%d,"k":%d,"dx":%d,"dd":%d,"ammo":%d}', n, shot, dx, dd, (rw(P1 + 0xB4) ~= 0) and rsw(0xFF0000 + rw(P1 + 0xB4) + 0x6C) or -1)) end
    if shot > SHOTS and t % EVERY == EVERY - 1 then phase = "done" HLOG(fmt('{"t":"done","f":%d}', n)) end
  end
  KEYS(keys)
end
function PEEK(n) FRN = n HLOG(fmt('{"t":"f","f":%d,%s,%s,%s}', n, P1LINE(), OBJLINE(TARGET), GLOBLINE())) end
`;
  return {
    name: `mech-wpn-${hero}-${w}`, frames: 60 + sp.every * (sp.shots + 2) + 120, loadState: `stage1-${hero}-armed-${wname}`,
    cheats: [{ cheat: 'invuln' }, { cheat: 'infhp' }],
    hook: lua,
  };
}

// ------------------------------------------------------------------------------------------------ items
// Food (pool A type 0x10, subtypes 1..17), score items (type 0x24, subtypes 1..16) and the ammo magazine (type 8):
// each is spawned 20 px in front of the hero, resting on the ground, then picked up with attack. Food is eaten
// with P1 HP poked to 10 (heal = HP change) and once at full HP (score instead). P1 HP / score are logged per frame
// and by the HP tap.
function items(hero = 'jack') {
  const list = [];
  for (let s = 1; s <= 17; s++) list.push({ e: 75, sub: s, hp: 10, kind: 'food' });
  for (const s of [1, 5, 9, 13, 17]) list.push({ e: 75, sub: s, hp: -1, kind: 'food-full' });
  for (let s = 1; s <= 16; s++) list.push({ e: 77, sub: s, hp: -1, kind: 'score' });
  list.push({ e: 67, sub: 0, hp: -1, kind: 'magazine' });
  const lua = MECH_LUA + 'ITEMS = {' + list.map(o => `{e=${o.e},sub=${o.sub},hp=${o.hp},k="${o.kind}"}`).join(',') + '}\n' + String.raw`
local k, t0, slot = 0, 0, nil
local PER = 70
function HOOK(n)
  FRN = n
  TIMERHOLD(n)
  local keys = {}
  if n >= 20 and (n - 20) % PER == 0 then
    k = k + 1
    local it = ITEMS[k]
    if it then
      if it.hp > 0 then NOLOG = true ww(P1 + 0x6C, it.hp) NOLOG = false end
      local dir = (rb(P1 + 0x24) ~= 0) and 1 or -1
      slot = MSPAWN(it.e, it.sub, 10 * dir, 0, 0)
      HLOG(fmt('{"t":"item","f":%d,"k":%d,"e":%d,"sub":%d,"kind":"%s","hp":%d,"score":%d}', n, k, it.e, it.sub, it.k, rsw(P1 + 0x6C), rl(P1 + 0x100)))
    end
  end
  local t = (n - 20) % PER
  if n >= 20 and ITEMS[k] and t >= 12 and t < 14 then keys.A = true end
  KEYS(keys)
end
HPTAP(P1, "p1")
TAPW(P1 + 0x100, 4, "score")
function PEEK(n) FRN = n HLOG(fmt('{"t":"f","f":%d,%s,%s}', n, P1LINE(), GLOBLINE())) end
`;
  return { name: `mech-items-${hero}`, frames: 20 + 70 * (list.length + 1), loadState: `stage1-${hero}`, cheats: [{ cheat: 'invuln' }], hook: lua };
}

// ------------------------------------------------------------------------------------------------ hurt / lives
// No invulnerability: three enemies attack an idle hero. Phase 1 (infhp until 1200): hits, stun meter, knockdowns,
// i-frames. Phase 2: HP poked to 1 -> death, respawn (lives 1 -> 0), death again -> continue countdown; the
// continue is left to run out. Taps on P1 +0x6C, +0xEC, +0xF9, +0x78, +0xA3 and the stun/hit-stop bytes.
function hurt(hero = 'jack') {
  const lua = MECH_LUA + String.raw`
local spawned = false
function HOOK(n)
  FRN = n
  TIMERHOLD(n)
  if n == 5 then MSPAWN(1, -1, 60, 0) MSPAWN(4, -1, -70, 0) MSPAWN(11, -1, 90, 8) end
  if n >= 5 and n < 1200 then NOLOG = true if rsw(P1 + 0x6C) < 60 then ww(P1 + 0x6C, 100) end NOLOG = false end
  if n == 1200 then NOLOG = true ww(P1 + 0x6C, 1) NOLOG = false HLOG(fmt('{"t":"hp1","f":%d,"lives":%d}', n, rb(P1 + 0xA3))) end
  if n == 1700 then NOLOG = true if rb(P1) ~= 0 and rsw(P1 + 0x6C) > 1 then ww(P1 + 0x6C, 1) end NOLOG = false HLOG(fmt('{"t":"hp1b","f":%d,"lives":%d}', n, rb(P1 + 0xA3))) end
  KEYS({})
end
HPTAP(P1, "p1")
TAPW(P1 + 0xEC, 2, "ec")
TAPW(P1 + 0xF8, 2, "f9")
TAPW(P1 + 0x78, 2, "stun")
TAPW(P1 + 0xA2, 2, "lives")
function PEEK(n) FRN = n
  HLOG(fmt('{"t":"f","f":%d,%s,%s,"cont":"%s","pl":"%s"}', n, P1LINE(), GLOBLINE(), HEX(0xFF84C0, 0x60), HEX(P1, 0x10)))
end
`;
  return { name: `mech-hurt-${hero}`, frames: 3600, loadState: `stage1-${hero}`, cheats: [], hook: lua, snapshotEvery: { from: 1200, to: 3599, every: 60 } };
}

// ------------------------------------------------------------------------------------------------ timer probe
const TIMER_STATES = ['stage1-jack', 'stage1-jack-area1', 'stage1-jack-area2', 'stage2-jack', 'stage3-jack', 'stage4-jack', 'stage5-jack', 'stage6-jack', 'stage7-jack', 'stage8-jack'];
function timerProbe(state) {
  return {
    name: `mech-timer-${state}`, frames: 130, loadState: state, cheats: [{ cheat: 'invuln' }],
    hook: MECH_LUA + String.raw`
TAPW(0xFF84E8, 2, "timer")
function PEEK(n) FRN = n if n % 10 == 0 or n < 3 then HLOG(fmt('{"t":"f","f":%d,%s}', n, GLOBLINE())) end end
`,
  };
}

// area-start timer values: warp into an area with the game's own area-exit path (cheat warpArea, V38) and catch the
// reset write of 0x1031A (pc 0x1032C) with a write tap
const TIMER_WARPS = [['stage1-jack', 1], ['stage1-jack', 2], ['stage2-jack', 2], ['stage4-jack', 1], ['stage4-jack', 2], ['stage6-jack', 1], ['stage7-jack', 1], ['stage7-jack', 2], ['stage7-jack', 3], ['stage8-jack', 1], ['stage8-jack', 2]];
function timerWarp(state, area) {
  return {
    name: `mech-timerwarp-${state}-a${area}`, frames: 700, loadState: state, cheats: [{ cheat: 'invuln' }, { cheat: 'warpArea', area, at: 10 }],
    hook: MECH_LUA + String.raw`
TAPW(0xFF84E8, 2, "timer")
function PEEK(n) FRN = n if n % 10 == 0 then HLOG(fmt('{"t":"f","f":%d,%s}', n, GLOBLINE())) end end
`,
  };
}

// ------------------------------------------------------------------------------------------------ Cadillac probe
// HELL ROAD (stage 3): watch what the hero, the Cadillac flag 0xFF8518 and the pools do while holding right, then
// steering up/down, attack and jump. Pools B/C objects are summarised every frame.
function cadillac(hero = 'jack', { name, frames = 1500, inputs } = {}) {
  const A = (at, keys, len = 1) => ({ from: at, to: at + len - 1, keys });
  return {
    name: name || `mech-cad-probe-${hero}`, frames, loadState: `stage3-${hero}`, cheats: [{ cheat: 'invuln' }, { cheat: 'infhp' }],
    inputs: inputs || [A(30, ['right'], 300), A(330, ['right', 'up'], 60), A(390, ['right', 'down'], 60), A(450, ['right', 'attack'], 6),
      A(470, ['right'], 200), A(670, ['jump'], 2), A(700, ['left'], 120), A(820, ['right'], 600)],
    snapshotEvery: { from: 0, to: frames - 1, every: 50 },
    hook: MECH_LUA + String.raw`
VTAP(P1, "p1")
function HOOK(n) FRN = n TIMERHOLD(n) end
local function pool(base, n, stride)
  local t = {}
  for k = 0, n - 1 do local a = base + k * stride
    if rb(a) ~= 0 then t[#t + 1] = fmt('{"a":%d,"s0":%d,"ty":%d,"sub":%d,"st":%d,"x":%d,"h":%d,"d":%d,"vx":%d,"vh":%d,"vd":%d,"hp":%d,"f24":%d,"own":%d,"fp":%d,"at":%d}',
      a, rb(a), rw(a + 0x20), rw(a + 0x26), rl(a + 4), rsw(a + 8), rsw(a + 0xC), rsw(a + 0x10), rsw(a + 0x14), rsw(a + 0x16), rsw(a + 0x18), rsw(a + 0x6C), rb(a + 0x24), rw(a + 0x70), rl(a + 0x28), rb(a + 0x58)) end
  end
  return "[" .. table.concat(t, ",") .. "]"
end
function PEEK(n) FRN = n
  HLOG(fmt('{"t":"f","f":%d,%s,%s,"B":%s,"C":%s,"cadv":"%s"}', n, P1LINE(), GLOBLINE(), pool(0xFFC8F4, 24, 0xE0), pool(0xFFB6F4, 24, 0xC0), HEX(0xFF8510, 0x20)))
end
`,
  };
}

// Episode 3: picking up score item subtype 12 calls 0x8BD24, which spawns three pool-C objects of type 0x160 (the
// Cadillac) and sets 0xFF850E. This plan spawns that item at the hero's feet, picks it up, then drives with a fixed
// input script; pools B/C, the hero and the Cadillac flags are logged every frame.
function cadDrive(hero = 'jack', { name, frames = 2400, script, tapAll = false } = {}) {
  const A = (at, keys, len = 1) => ({ from: at, to: at + len - 1, keys });
  const inputs = script || [A(30, ['attack'], 2),
    A(400, ['right'], 240), A(640, ['right', 'up'], 60), A(700, ['right', 'down'], 60), A(760, ['left'], 90), A(850, [], 1),
    A(900, ['right'], 300), A(1200, ['right', 'attack'], 4), A(1210, ['right'], 120), A(1330, ['right', 'jump'], 4), A(1340, ['right'], 200),
    A(1540, ['up'], 40), A(1580, ['down'], 80), A(1660, ['right'], 600)];
  return {
    name: name || `mech-cad-drive-${hero}`, frames, loadState: `stage3-${hero}`, cheats: [{ cheat: 'invuln' }, { cheat: 'infhp' }],
    inputs, snapshotEvery: { from: 0, to: frames - 1, every: 25 },
    hook: MECH_LUA + (tapAll ? 'TAPALL = true\n' : '') + String.raw`
VTAP(P1, "p1")
local CARSEEN = {}
function HOOK(n) FRN = n TIMERHOLD(n)
  if n == 20 then local dir = (rb(P1 + 0x24) ~= 0) and 1 or -1 MSPAWN(77, 12, 8 * dir, 0, 0) end
  if n == 21 and TAPALL then for k = 0, 23 do HPTAP(0xFFC8F4 + k * 0xE0, "B" .. k) end end
  for k = 0, 23 do local a = 0xFFB6F4 + k * 0xC0
    if rb(a) ~= 0 and rw(a + 0x20) == 0x160 and not CARSEEN[a] then CARSEEN[a] = true VTAP(a, "car" .. k) if TAPALL then HPTAP(a, "car" .. rw(a + 0x26)) end HLOG(fmt('{"t":"car","f":%d,"a":%d,"sub":%d}', n, a, rw(a + 0x26))) end
  end
end
local function pool(base, n, stride)
  local t = {}
  for k = 0, n - 1 do local a = base + k * stride
    if rb(a) ~= 0 then t[#t + 1] = fmt('{"a":%d,"s0":%d,"ty":%d,"sub":%d,"st":%d,"x":%d,"h":%d,"d":%d,"vx":%d,"vh":%d,"vd":%d,"ax":%d,"ad":%d,"hp":%d,"f24":%d,"own":%d,"fp":%d,"at":%d,"b2e":%d,"x32":%d,"d32":%d}',
      a, rb(a), rw(a + 0x20), rw(a + 0x26), rl(a + 4), rsw(a + 8), rsw(a + 0xC), rsw(a + 0x10), rsw(a + 0x14), rsw(a + 0x16), rsw(a + 0x18), rsw(a + 0x1A), rsw(a + 0x1E), rsw(a + 0x6C), rb(a + 0x24), rw(a + 0x70), rl(a + 0x28), rb(a + 0x58), rb(a + 0x2E), rl(a + 8), rl(a + 0x10)) end
  end
  return "[" .. table.concat(t, ",") .. "]"
end
function PEEK(n) FRN = n
  HLOG(fmt('{"t":"f","f":%d,%s,%s,"B":%s,"C":%s,"flags":"%s","in":%d}', n, P1LINE(), GLOBLINE(), pool(0xFFC8F4, 24, 0xE0), pool(0xFFB6F4, 24, 0xC0), HEX(0xFF84D0, 0x50), rb(0xFF801B)))
end
`,
  };
}

// Continue screen (main state 0x10, routine 0xE9E6; per-player counters at hero +0xB0/+0xB1, screen struct 0xFF85CC):
// the hero is killed with no lives left, then the countdown runs (idle), or attack is pressed during it, or a coin and
// start are given to continue.
function cont(variant = 'idle') {
  const inputs = variant === 'coin' ? [{ from: 700, to: 705, keys: ['Coin 1'] }, { from: 740, to: 745, keys: ['1 Player Start'] }] : [];
  return {
    name: `mech-cont-${variant}`, frames: variant === 'idle' ? 2200 : 1400, loadState: 'stage1-jack', cheats: [],
    inputs,
    hook: MECH_LUA + String.raw`
local DEAD = nil
function HOOK(n)
  FRN = n
  TIMERHOLD(n)
  if n == 5 then wb(P1 + 0xA3, 0) NOLOG = true ww(P1 + 0x6C, 1) NOLOG = false MSPAWN(11, -1, 40, 0) MSPAWN(1, -1, -40, 0) end
  if not DEAD and rb(0xFF84D0) == 0x10 then DEAD = n HLOG(fmt('{"t":"contstart","f":%d}', n)) end
  ${variant === 'press' ? 'if DEAD and n > DEAD + 60 and (n % 10) < 2 then fields["P1 Button 1"]:set_value(1) else fields["P1 Button 1"]:set_value(0) end' : ''}
end
HPTAP(P1, "p1")
function PEEK(n) FRN = n
  HLOG(fmt('{"t":"f","f":%d,%s,%s,"d1":%d,"d2":%d,"cs":"%s","b0":%d,"b1":%d,"cr":%d}', n, P1LINE(), GLOBLINE(), rb(0xFF84D1), rb(0xFF84D2), HEX(0xFF85CC, 0x20), rb(P1 + 0xB0), rb(P1 + 0xB1), rb(0xFF847D)))
end
`,
  };
}

// ------------------------------------------------------------------------------------------------ run rules
// What keeps a run going and what ends it: double-tap right and release (does the run persist?), tap the opposite
// direction, tap up / down while running, steer diagonally, attack and jump while running, a long run into the
// area limit. Per frame: state, velocities, X, stick direction +0x22, previous +0xAC, held input, camera X.
function runRelease(hero) {
  const A = (at, keys, len = 1) => ({ from: at, to: at + len - 1, keys });
  const inputs = [
    A(20, ['right'], 2), A(24, ['right'], 30),                      // run right, release at 54, nothing until 220
    A(220, ['left'], 2),                                            // opposite tap while running
    A(300, ['left'], 2), A(304, ['left'], 20), A(360, ['up'], 2),   // run left, release, tap up
    A(440, ['right'], 2), A(444, ['right'], 20), A(470, ['right', 'up'], 20), A(540, ['down'], 2),   // steer up-right, release, tap down
    A(620, ['right'], 2), A(624, ['right'], 14), A(640, ['attack'], 2),    // attack while running (dash attack)
    A(740, ['right'], 2), A(744, ['right'], 14), A(760, ['jump'], 2),      // jump while running (running jump)
    A(860, ['left'], 2), A(864, ['left'], 20), A(900, ['right'], 2),       // run left, tap right
    A(980, ['right'], 2), A(984, ['right'], 20), A(1020, ['down'], 2),     // run right, tap down
    A(1100, ['right'], 2), A(1104, ['right'], 20), A(1130, ['right', 'down'], 20), A(1160, ['up'], 2),  // steer down-right, then tap up
    A(1240, ['right'], 2), A(1244, ['right'], 4), A(1248, [], 1), A(1260, ['right'], 2),               // tap, release 12 frames, tap again (double-tap window)
    A(1340, ['right'], 2), A(1344, ['right'], 300),                        // long run into the area limit
  ];
  return {
    name: `mech-run-${hero}`, frames: 1660, loadState: `stage1-${hero}`,
    cheats: [{ cheat: 'invuln' }, { cheat: 'infhp' }, { cheat: 'killAll', every: 20, from: 0 }],
    inputs,
    hook: MECH_LUA + String.raw`
function HOOK(n) FRN = n TIMERHOLD(n) end
function PEEK(n) FRN = n HLOG(fmt('{"t":"f","f":%d,%s,%s,"stick":%d,"prevStick":%d,"tap":%d,"tapDir":%d,"a8":%d,"fa":%d,"fc":%d,"dd":%d}', n, P1LINE(), GLOBLINE(), RSB(P1 + 0x22), RSB(P1 + 0xAC), rb(P1 + 0xBC), rb(P1 + 0xBD), rb(P1 + 0xA8), rw(P1 + 0xFA), rw(P1 + 0xFC), rb(0xFF84DD))) end
`,
  };
}
// The 240-frame run limit on its own: double-tap left at the stage-1 start (nothing scripted on the left), release;
// the hero reaches the left screen edge after ~40 frames and keeps "running" against it until +0xFA runs out.
function runLimit(hero) {
  const A = (at, keys, len = 1) => ({ from: at, to: at + len - 1, keys });
  return {
    name: `mech-runlimit-${hero}`, frames: 420, loadState: `stage1-${hero}`,
    cheats: [{ cheat: 'invuln' }, { cheat: 'infhp' }, { cheat: 'killAll', every: 20, from: 0 }],
    inputs: [A(20, ['left'], 2), A(24, ['left'], 5)],
    hook: MECH_LUA + String.raw`
function HOOK(n) FRN = n TIMERHOLD(n) end
function PEEK(n) FRN = n HLOG(fmt('{"t":"f","f":%d,%s,%s,"stick":%d,"fa":%d,"fc":%d,"dd":%d}', n, P1LINE(), GLOBLINE(), RSB(P1 + 0x22), rw(P1 + 0xFA), rw(P1 + 0xFC), rb(0xFF84DD))) end
`,
  };
}

// ------------------------------------------------------------------------------------------------ knockdown rule
// No invulnerability; HP refilled when it drops below 60 (never logged as a hit). Three enemies attack the hero:
// phase 1 (to 1300) standing, phase 2 jumping every 70 frames so some hits land while airborne (+0x51). A tap on
// the hero HP logs, for every enemy hit, the attacker (type, id, +0x58, +0x5A) and the hero's stun meter, +0x51 and
// +0x5A before the hit; the per-frame line gives the reaction (state, +0x7B, +0x06).
function knockdown(hero) {
  return {
    name: `mech-knockdown-${hero}`, frames: 2600, loadState: `stage1-${hero}`, cheats: [],
    inputs: Array.from({ length: 18 }, (_, k) => ({ from: 1300 + k * 70, to: 1301 + k * 70, keys: ['jump'] })),
    hook: MECH_LUA + String.raw`
local CPU2 = manager.machine.devices[":maincpu"]
KDTAPS = {}
KDTAPS[1] = space:install_write_tap(P1 + 0x6C, P1 + 0x6D, "kd", function(o, d, m)
  if NOLOG then return end
  local old, new = rw(P1 + 0x6C), d & 0xFFFF
  if new >= old then return end
  local a2 = CPU2.state["A2"].value & 0xFFFFFF
  local at, a5a, a5b, ty, id, sub = -1, -1, -1, -1, -1, -1
  if a2 >= 0xFF0000 then at = rb(a2 + 0x58) a5a = rb(a2 + 0x5A) a5b = rb(a2 + 0x5B) ty = rw(a2 + 0x20) id = rb(a2 + 3) sub = rw(a2 + 0x26) end
  HLOG(fmt('{"t":"kd","f":%d,"pc":%d,"old":%d,"new":%d,"a2":%d,"aty":%d,"aid":%d,"asub":%d,"aat":%d,"a5a":%d,"a5b":%d,"stun":%d,"h51":%d,"h5a":%d,"h":%d,"st":%d,"f6":%d}',
    FRN, CPU2.state["CURPC"].value, old, new, a2, ty, id, sub, at, a5a, a5b, rb(P1 + 0x78), rb(P1 + 0x51), rb(P1 + 0x5A), rsw(P1 + 0xC), rl(P1 + 4), rw(P1 + 0xF6)))
end)
function HOOK(n)
  FRN = n
  TIMERHOLD(n)
  if n == 30 then MSPAWN(1, -1, 50, 0) MSPAWN(4, -1, -60, 0) MSPAWN(11, -1, 80, 8) end
  if n > 30 and rb(P1) ~= 0 and rsw(P1 + 0x6C) < 60 and rsw(P1 + 0x6C) > 0 then NOLOG = true ww(P1 + 0x6C, 100) NOLOG = false end
end
function PEEK(n) FRN = n HLOG(fmt('{"t":"f","f":%d,%s,%s,"r7b":%d,"h51":%d,"h5a":%d,"b06":%d}', n, P1LINE(), GLOBLINE(), rb(P1 + 0x7B), rb(P1 + 0x51), rb(P1 + 0x5A), rb(P1 + 6))) end
`,
  };
}

// ------------------------------------------------------------------------------------------------ timer scripts
// Walk an area with killAll clearing the waves; every write to the stage timer is logged with its PC (0xFD9C set,
// 0x104D8/DC add, 0x1032C area start, 0x103EA/EE tick), the camera X, the live enemy count 0xFF84F3 and the event
// objects (pool C type 0x3C: subtype, state, script pointer +0xA0, delay +0x80) so each write ties to its script row.
function timerScript({ name, state, area, frames = 3400, killEvery = 150 }) {
  const cheats = [{ cheat: 'invuln' }];
  if (area != null) cheats.push({ cheat: 'warpArea', area, at: 10 });
  cheats.push({ cheat: 'killAll', every: killEvery, from: 100 });
  return {
    name, frames, loadState: state, cheats, inputs: [{ from: 60, to: frames - 1, keys: ['right'] }],
    hook: MECH_LUA + String.raw`
local CPU2 = manager.machine.devices[":maincpu"]
local function events()
  local t = {}
  for k = 0, 23 do local a = 0xFFB6F4 + k * 0xC0
    if rb(a) ~= 0 and rw(a + 0x20) == 0x3C then t[#t + 1] = fmt('{"a":%d,"sub":%d,"st":%d,"delay":%d,"ptr":%d,"done":%d}', a, rw(a + 0x26), rl(a + 4), rw(a + 0x80), rl(a + 0xA0), rw(a + 0xA6)) end
  end
  return "[" .. table.concat(t, ",") .. "]"
end
TMTAPS = {}
TMTAPS[1] = space:install_write_tap(0xFF84E8, 0xFF84E9, "tmw", function(o, d, m)
  local v = d & 0xFFFF
  local byte = (m & 0xFF00 ~= 0 and m & 0xFF ~= 0) and "word" or ((m & 0xFF00 ~= 0) and "minutes" or "seconds")
  local val = (byte == "word") and v or ((byte == "minutes") and ((v >> 8) & 0xFF) or (v & 0xFF))
  HLOG(fmt('{"t":"tmw","f":%d,"pc":%d,"byte":"%s","val":%d,"old":%d,"cx":%d,"ar":%d,"n":%d,"ev":%s}', FRN, CPU2.state["CURPC"].value, byte, val, rw(0xFF84E8), rsw(0xFF8744), rb(0xFF8786), rb(0xFF84F3), events()))
end)
function HOOK(n) FRN = n end
function PEEK(n) FRN = n if n % 25 == 0 then HLOG(fmt('{"t":"g","f":%d,%s,"x":%d,"n":%d,"nB":%d,"to":%d,"ev":%s}', n, GLOBLINE(), rw(P1 + 8), rb(0xFF84F3), rw(0xFFE5F8), rsw(0xFF850C), events())) end end
`,
  };
}

// Respawn and continue time: the hero dies with one life left (respawn: +3:30 expected at 0x1C010 -> 0x10482),
// then again with none (continue screen, coin + start: +4:00 expected at 0x7458 -> 0x10490). No timer hold.
function timerRespawn() {
  return {
    name: 'mech-timer-respawn', frames: 2800, loadState: 'stage1-jack', cheats: [],
    hook: MECH_LUA + String.raw`
local CPU2 = manager.machine.devices[":maincpu"]
TMTAPS = {}
TMTAPS[1] = space:install_write_tap(0xFF84E8, 0xFF84E9, "tmw", function(o, d, m)
  local v = d & 0xFFFF
  local byte = (m & 0xFF00 ~= 0 and m & 0xFF ~= 0) and "word" or ((m & 0xFF00 ~= 0) and "minutes" or "seconds")
  local val = (byte == "word") and v or ((byte == "minutes") and ((v >> 8) & 0xFF) or (v & 0xFF))
  if CPU2.state["CURPC"].value ~= 0x103EA and CPU2.state["CURPC"].value ~= 0x103EE then
    HLOG(fmt('{"t":"tmw","f":%d,"pc":%d,"byte":"%s","val":%d,"old":%d,"ms":%d,"lives":%d,"st":%d}', FRN, CPU2.state["CURPC"].value, byte, val, rw(0xFF84E8), rb(0xFF84D0), rb(P1 + 0xA3), rl(P1 + 4)))
  end
end)
local CONT = nil
function HOOK(n)
  FRN = n
  if n == 5 then wb(P1 + 0xA3, 1) NOLOG = true ww(P1 + 0x6C, 1) NOLOG = false MSPAWN(1, -1, 40, 0) MSPAWN(11, -1, -40, 0) end
  if n == 1400 then NOLOG = true if rb(P1) ~= 0 and rsw(P1 + 0x6C) > 1 then ww(P1 + 0x6C, 1) end NOLOG = false end
  if not CONT and rb(0xFF84D0) == 0x10 then CONT = n HLOG(fmt('{"t":"contstart","f":%d}', n)) end
  fields["Coin 1"]:set_value((CONT and n >= CONT + 60 and n < CONT + 66) and 1 or 0)
  fields["1 Player Start"]:set_value((CONT and n >= CONT + 100 and n < CONT + 106) and 1 or 0)
end
function PEEK(n) FRN = n if n % 10 == 0 or (CONT and n > CONT) then HLOG(fmt('{"t":"f","f":%d,%s,%s}', n, P1LINE(), GLOBLINE())) end end
`,
  };
}

module.exports = { cont, TIMER_WARPS, timerWarp, cadDrive, MECH_LUA, MOVES, COMBO7, WEAPON_SPEC, TIMER_STATES, HEROES, loco, moves, weapon, items, hurt, timerProbe, cadillac, runRelease, runLimit, knockdown, timerScript, timerRespawn };
