// Live capture of the story text of the original Cadillacs & Dinosaurs (MAME "dino"): MAME plans with a ROM read tap
// on every text block start and text pointer-table entry. Research tooling only. One MAME process at a time.
//
// Each plan writes work/re/runs/<name>/hook.jsonl with
//   {"t":"rd","f":frame,"a":address,"pc":reading PC,"a6":A6}   first read of a watched ROM word in a frame
//   {"t":"st","f":frame,"m":main state,"s1":sub state,"st":stage byte,"ar":area,"at":attract step,"rg":region word,...}
//                                                              on every change of the game-flow bytes
// and snapshots txt-fNNNNNN.png a few frames after each text read (plus the plan's own periodic snapshots).
'use strict';
const fs = require('fs'), path = require('path');
const RT = require('../../runtime/rt.cjs');

const RUNS = RT.RUNS;

// Lua: watch set + taps + state logger. ranges: [[lo, hi], ...] (inclusive, even), watch: [addr, ...]
function tapLua({ ranges, watch, tables = [], snapDelays = [8, 90, 240], maxSnaps = 600 }) {
  const tb = new Set(tables);
  const W = watch.map(a => `[${a}]=${tb.has(a) ? 2 : 1}`);
  const lines = [];
  for (let i = 0; i < W.length; i += 40) lines.push('  ' + W.slice(i, i + 40).join(',') + ',');
  return String.raw`
-- ===== story text tap (tools/re/export/lib/story-live.cjs) =====
local cpu = manager.machine.devices[":maincpu"]
STORY = { f = 0, last = {}, snaps = {}, nsnap = 0, st = "" }
STORY.watch = {
${lines.join('\n')}
}
STORY.taps = {}
local function tapfn(o, d, m)
  local k = STORY.watch[o]
  if k and STORY.last[o] ~= STORY.f then
    local run = STORY.last[o] == STORY.f - 1
    STORY.last[o] = STORY.f
    if run then return end            -- read again in consecutive frames (per-frame dispatch): log the first only
    HLOG(fmt('{"t":"rd","f":%d,"a":%d,"pc":%d,"a6":%d,"a0":%d}', STORY.f, o, cpu.state["CURPC"].value, cpu.state["A6"].value & 0xFFFFFF, cpu.state["A0"].value & 0xFFFFFF))
    if k == 1 then
      for _, dl in ipairs({${snapDelays.join(',')}}) do STORY.snaps[STORY.f + dl] = true end
      STORY.census = true
    end
  end
end
-- active objects of pool B (enemies, bosses) and pool C (controllers, text objects): type, name index (+0x03),
-- subtype (+0x26), X, depth -- logged once in the frame after a text read, to tell who is on screen when a line appears
local function census(n)
  local b, c = {}, {}
  for i = 0, 23 do local a = 0xFFC8F4 + i * 0xE0 if rb(a) ~= 0 then b[#b + 1] = fmt('[%d,%d,%d,%d,%d]', rw(a + 0x20), rb(a + 3), rw(a + 0x26), rw(a + 8), rw(a + 0x10)) end end
  for i = 0, 23 do local a = 0xFFB6F4 + i * 0xC0 if rb(a) ~= 0 then c[#c + 1] = fmt('[%d,%d,%d]', rw(a + 0x20), rb(a + 3), rw(a + 0x26)) end end
  HLOG(fmt('{"t":"objs","f":%d,"b":[%s],"c":[%s],"cam":%d}', n, table.concat(b, ","), table.concat(c, ","), rw(0xFF8744)))
end
${ranges.map(([lo, hi], k) => `STORY.taps[${k + 1}] = space:install_read_tap(${lo}, ${hi}, "story${k}", tapfn)`).join('\n')}
function STORY_PEEK(n)
  STORY.f = n
  local s = fmt('"m":%d,"s1":%d,"s2":%d,"st":%d,"ar":%d,"at":%d,"rg":%d,"p1":%d,"cid":%d,"lv":%d,"cr":%d',
    rb(0xFF84D0), rb(0xFF84D1), rb(0xFF84D2), rb(0xFF84D9), rb(0xFF8786), rb(0xFF8FD0), rw(0xFF8032), rb(0xFFB274), rb(0xFFB277), rb(0xFFB317), rb(0xFF847D))
  if s ~= STORY.st then STORY.st = s HLOG(fmt('{"t":"st","f":%d,%s}', n, s)) end
  if STORY.census then STORY.census = false census(n) end
  if STORY.snaps[n] and STORY.nsnap < ${maxSnaps} then STORY.snaps[n] = nil STORY.nsnap = STORY.nsnap + 1 scr:snapshot(fmt("txt-f%06d.png", n)) end
end
`;
}

// bot walk (same rules as tools/re/export/stages.cjs WALK_LUA: hold Right, switch to Right+Up / Right+Down when stuck,
// teleport over obstacles that ENEMY CLEAR cannot end); stops a few frames after the stage clears (main state 8/0x1C)
const WALK_LUA = String.raw`
local W = { lastX = 0, stuck = 0, mode = 0, endAt = nil }
-- enemy clearing that leaves bosses and scripted actors alive long enough to talk: every 45 frames the grunt types
-- below get what the game's ENEMY CLEAR (0x3B7D6) gives every pool-B slot (+0x6C = 0, +0x04 = 6). Once the camera
-- has not moved for FIGHT_AFTER frames (a boss room) the bot fights: it walks to the nearest hittable non-grunt
-- (+0x00 == 1), sets its HP to 1 and punches, so the boss dies through the game's own damage path (death lines,
-- transformations). If nothing hittable shows up for CLEAR_AFTER frames, every pool-B slot is cleared.
local GRUNT = { [0x08]=1, [0x28]=1, [0x34]=1, [0x38]=1, [0xF0]=1, [0x50]=1, [0x100]=1, [0x0C]=1, [0x18]=1, [0x13C]=1, [0x118]=1, [0xFC]=1, [0x104]=1, [0x108]=1 }
-- never removed outright: Dr. Fessenden's forms and the objects of his death sequence (removing them skips the
-- escape and the ending, 0xABB0 waits on 0xFF84E2). 0x184 = the JUMP PL. escape runners (0x69E40/0x69E74), 0x174 =
-- the object the escape spawns at 0x69F78; clearing them (as the first E8 runs did) stalls the escape.
local KEEP = { [0x150]=1, [0x154]=1, [0x158]=1, [0x15C]=1, [0x160]=1, [0x164]=1, [0x170]=1, [0x174]=1, [0x178]=1, [0x17C]=1, [0x180]=1, [0x184]=1, [0x188]=1, [0x18C]=1 }
local function clear(all)
  for i = 0, 23 do
    local a = 0xFFC8F4 + i * 0xE0
    local ty = rw(a + 0x20)
    if rb(a) ~= 0 and rb(a + 4) ~= 6 and not KEEP[ty] and (all or GRUNT[ty]) then ww(a + 0x6C, 0) wb(a + 4, 6) end
  end
end
function PEEK(n)
  STORY_PEEK(n)
  local main = rb(0xFF84D0)
  if (main == 8 or main == 0x1C or main == 0x10) and n > (BOT_MIN_END or 100) and not W.endAt then W.endAt = n + (BOT_TAIL or 30) end
  -- END_ON_READ: stop a few hundred frames after the text block at that ROM address has been read (STORY.last is
  -- written by the read tap), e.g. the TYROG grab line 0x882F0
  if END_ON_READ and STORY.last[END_ON_READ] and not W.endAt then W.endAt = n + (END_TAIL or 400) HLOG(fmt('{"t":"endOnRead","f":%d,"a":%d}', n, END_ON_READ)) end
  local key = rw(0xFF8744) * 65536 + rw(0xFF8748) + rb(0xFF8786) * 7 + rb(0xFF84D9) * 131
  if key ~= W.key then W.key = key W.since = n W.moved = n W.lastHit = n end
  W.fight = false
  -- 0xFF84D1 is the stage-clear step: 2 = boss fight, 4 = boss dead, 6 = waiting for the escape cut-scene (0xABA8).
  -- Once the boss is dead nothing is cleared or fought any more, so the game's own clear sequence can run.
  local s1 = rb(0xFF84D1)
  if main == 0xC and n > 30 and s1 < 4 then
    local still = n - (W.moved or n)
    if n % 45 == 0 then clear(false) end
    W.fight = still > (FIGHT_AFTER or 600)
    if W.fight and n - (W.lastHit or n) > (CLEAR_AFTER or 1500) then clear(true) W.lastHit = n HLOG(fmt('{"t":"clearall","f":%d}', n)) end
  end
  if main == 0xC and s1 >= 4 and n % 60 == 0 then
    local boss = rw(0xFF84E0) + 0xFF0000
    HLOG(fmt('{"t":"esc","f":%d,"s1":%d,"bits":%d,"boss":%d,"bstate":%d,"ba6":%d,"e2":%d,"cnt":%d,"exit":%d}', n, s1, rb(0xFF8F57), boss, rb(boss + 4), rb(boss + 0xA6), rb(0xFF84E2), rw(0xFF8508), rb(0xFF87A9)))
    W.moved = n   -- the escape wait is not a stall
  end
  -- the player's cut-scene script (0x1DB82: +0xD4 pointer, +0xD2 op, +0xD8 countdown) once the boss fight has started
  if main == 0xC and s1 >= 2 and n % 30 == 0 then
    local p = 0xFFB274
    HLOG(fmt('{"t":"pscript","f":%d,"op":%d,"ptr":%d,"cnt":%d,"d3":%d,"b51":%d,"dd":%d,"de":%d,"fc":%d,"f503":%d,"s4":%d,"s5":%d,"s6":%d,"s7":%d,"x":%d}', n, rb(p + 0xD2), rl(p + 0xD4) & 0xFFFFFF, rw(p + 0xD8), rb(p + 0xD3), rb(p + 0x51), rb(0xFF84DD), rb(0xFF84DE), rb(0xFF84FC), rb(0xFF8503), rb(p + 4), rb(p + 5), rb(p + 6), rb(p + 7), rw(p + 8)))
  end
  if not W.endAt and n > 600 and n - (W.moved or 0) > (STALL or 6000) then W.endAt = n + 1 HLOG(fmt('{"t":"stall","f":%d}', n)) end
  if W.endAt and n >= W.endAt then exit_at = n end
end
function HOOK(n)
  -- boss dead (stage-clear step >= 4): release every input so the game's own end-of-stage player script can run
  -- (its op 0x04 at 0x1E200 waits for every player to be idle, +0x51 == 0); HOOK runs after the plan's inputs
  if rb(0xFF84D0) == 0xC and rb(0xFF84D1) >= 4 then
    for _, k in ipairs({"P1 Right", "P1 Left", "P1 Up", "P1 Down", "P1 Button 1", "P1 Button 2"}) do if fields[k] then fields[k]:set_value(0) end end
    -- that script's op 0x4A (0x1DC8A) also waits while a player's +0x00 is 2, which the invuln cheat forces every
    -- frame: switch the cheats off (they run after this hook) and make the hero hittable again (V31: a poke is needed)
    if CHEATS and #CHEATS > 0 then for i = #CHEATS, 1, -1 do CHEATS[i] = nil end HLOG(fmt('{"t":"cheatsoff","f":%d}', n)) end
    if rb(0xFFB274) == 2 then wb(0xFFB274, 1) wb(0xFFB36D, 0) ww(0xFFB360, 0) end
    return
  end
  local px = rw(0xFFB27C)
  if px > W.lastX then W.lastX = px W.stuck = 0 else W.stuck = W.stuck + 1 end
  if px + 64 < W.lastX then W.lastX = px end
  if W.stuck > (BOT_PATIENCE or 40) then W.mode = (W.mode + 1) % 3 W.stuck = 0 end
  fields["P1 Up"]:set_value(W.mode == 1 and 1 or 0)
  fields["P1 Down"]:set_value(W.mode == 2 and 1 or 0)
  if TIMER_WORD then ww(0xFF84E8, TIMER_WORD) end
  if W.fight then
    local px, pd, best, bd = rw(0xFFB27C), rw(0xFFB284), nil, 1e9
    for i = 0, 23 do
      local a = 0xFFC8F4 + i * 0xE0
      if rb(a) == 1 and not GRUNT[rw(a + 0x20)] and rsw(a + 0x6C) > 0 then local d = math.abs(rw(a + 8) - px) if d < bd then bd = d best = a end end
    end
    local R, Lf, U, Dn, A = 0, 0, 0, 0, 0
    -- NOFIGHT = {[type]=1,...}: do not fight these bosses; stand still (every input released, HP untouched) so the
    -- boss can grab the hero (its grab lines: TYROG caption 0x5A at 0x5E2F8). STAND_MAX ends the run after that
    -- many frames of standing. The hero must be hittable (+0x00 == 1): use infhp, not invuln.
    if best and NOFIGHT and NOFIGHT[rw(best + 0x20)] then
      -- walk up to the boss (same approach as the fight below, attack never pressed), then stand within reach
      local dx, dd = rw(best + 8) - px, rw(best + 0x10) - pd
      local near = math.abs(dx) <= (STAND_DX or 56) and math.abs(dd) <= 6
      if not near then
        if dx > 36 then R = 1 elseif dx < -36 then Lf = 1 end
        if dd > 4 then U = 1 elseif dd < -4 then Dn = 1 end
      end
      fields["P1 Right"]:set_value(R) fields["P1 Left"]:set_value(Lf) fields["P1 Up"]:set_value(U) fields["P1 Down"]:set_value(Dn) fields["P1 Button 1"]:set_value(0)
      if near and not W.standSince then W.standSince = n HLOG(fmt('{"t":"stand","f":%d,"type":%d,"x":%d,"d":%d,"px":%d,"pd":%d}', n, rw(best + 0x20), rw(best + 8), rw(best + 0x10), px, pd)) end
      W.lastHit = n
      if W.standSince and STAND_MAX and n - W.standSince > STAND_MAX and not W.endAt then W.endAt = n + 1 end
      return
    end
    if best then
      if rsw(best + 0x6C) > 1 then ww(best + 0x6C, 1) W.lastHit = n end
      local dx, dd = rw(best + 8) - px, rw(best + 0x10) - pd
      if dx > 36 then R = 1 elseif dx < -36 then Lf = 1 end
      if dd > 4 then U = 1 elseif dd < -4 then Dn = 1 end
      if math.abs(dx) <= 70 and math.abs(dd) <= 10 then
        if dx > 0 and rb(0xFFB298) == 0 then R = 1 elseif dx < 0 and rb(0xFFB298) ~= 0 then Lf = 1 end
        A = (n % 10 < 5) and 1 or 0
      end
    end
    fields["P1 Right"]:set_value(R) fields["P1 Left"]:set_value(Lf) fields["P1 Up"]:set_value(U) fields["P1 Down"]:set_value(Dn) fields["P1 Button 1"]:set_value(A)
    return
  end
  if TELEPORT_AFTER and W.since and n - W.since > TELEPORT_AFTER and rb(0xFF8741) == 0 and rsw(0xFFB280) == rsw(0xFFB2C8) then
    local cam, px, pd, fl = rw(0xFF8744), rw(0xFFB27C), rw(0xFFB284), rsw(0xFFB2C8)
    local b = gbase(4, 0x4000)
    local function pass(X, h)
      if h < 0 then return false end
      local col, row = (X >> 4) & 0x3f, ((1023 - h) >> 4) & 0x3f
      local attr = space:read_u16(0x900000 + b + ((row & 0x0f) + (col << 4) + ((row & 0x30) << 6)) * 4 + 2)
      return space:read_u16(0x1370C + (attr >> 10) * 16) == 0
    end
    local done = false
    for dx = 160, 32, -16 do
      if px + dx < cam + 360 and not done then
        for k = 0, 40 do
          local dd = ((k % 2 == 0) and 1 or -1) * ((k + 1) // 2) * 8
          local h = pd + fl + dd
          if pass(px + dx, h) and pass(px + dx, h + 8) and pass(px + dx, h - 8) then
            ww(0xFFB27C, px + dx) ww(0xFFB284, pd + dd)
            HLOG(fmt('{"t":"teleport","f":%d}', n))
            done = true W.since = n break
          end
        end
      end
    end
    if not done then W.since = n - TELEPORT_AFTER // 2 end
  end
end
`;
// plain logger (attract, intermissions, ending): no bot
const PLAIN_LUA = String.raw`
function PEEK(n) STORY_PEEK(n) if STOP_MAIN and n > 60 and rb(0xFF84D0) == STOP_MAIN and not STORY.stopAt then STORY.stopAt = n + (STOP_TAIL or 60) end
  if STORY.stopAt and n >= STORY.stopAt then exit_at = n end end
`;

// pool D (effects, 0xFF9A74, 48 x 0x80) logger: type, record of the frame word at [+0x28], X, height, depth, facing,
// written whenever the set changes (used for the sprite speech balloons)
const POOLD_LUA = String.raw`
local PEEK1 = PEEK
local PDK = ""
function PEEK(n)
  PEEK1(n)
  local t = {}
  for i = 0, 47 do
    local a = 0xFF9A74 + i * 0x80
    if rb(a) ~= 0 then
      local fp = rl(a + 0x28) & 0xFFFFFF
      local w0 = (fp > 0 and fp < 0x200000) and rw(fp) or 0xFFFF
      t[#t + 1] = fmt('[%d,%d,%d,%d,%d,%d,%d]', i, rw(a + 0x20), w0, rw(a + 8), rw(a + 0x0C), rw(a + 0x10), rb(a + 0x24))
    end
  end
  local k = table.concat(t, ",")
  if k ~= PDK then PDK = k HLOG(fmt('{"t":"poold","f":%d,"o":[%s]}', n, k)) end
end
`;
function readEvents(name) {
  const f = path.join(RUNS, name, 'hook.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{"t"')).map(l => JSON.parse(l));
}
function snapsOf(name) {
  const d = path.join(RUNS, name);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => /^txt-f\d+\.png$/.test(f)).map(f => +/(\d+)/.exec(f)[1]).sort((a, b) => a - b);
}
async function runSeq(plans, log = console.log) {
  const out = [];
  for (const plan of plans) {
    const t0 = Date.now();
    const s = await RT.runPlan(plan, { quiet: true });
    const ev = readEvents(plan.name);
    log(`[live] ${plan.name}: ok ${s.ok}, ${((Date.now() - t0) / 1000).toFixed(1)} s, last frame ${s.lastFrame}, text reads ${ev.filter(e => e.t === 'rd').length}`);
    out.push(s);
  }
  return out;
}
module.exports = { tapLua, WALK_LUA, PLAIN_LUA, POOLD_LUA, readEvents, snapsOf, runSeq, RUNS };
