// Cheats for the original Cadillacs & Dinosaurs (MAME "dino"), as Lua for tools/re/runtime/rt.cjs plans.
// Every address and value here comes from the validated runtime map (work/re/runtime/memory-map.json).
//
// plan.cheats = [ { "cheat": "<name>", ...options } ]   (frames are plan frames, see the harness README)
//   invuln     {player:1, from, to}        the game's own invulnerability: obj+0x00 = 2 (not registered as a hit
//                                          target, see 0x4AC2) and obj+0xF9 = 0x3C (the countdown at 0x18D00 that
//                                          puts +0x00 back to 1), rewritten every frame -> never hit, never grabbed
//   infhp      {player:1, from, to}        obj+0x6C (HP) = obj+0x6A (max HP) every frame
//   lives      {player:1, value, at}       obj+0xA3 (lives left, the "=N" in the HUD) = value
//   score      {player:1, value, at}       obj+0x100 (BCD long) = value and set the HUD refresh flags 0xFF0ECC/0xFF0ECD+p
//   give       {player:1, weapon, ammo, at} spawn the weapon item (pool A, type 0, subtype from WEAPONS) at the
//                                          hero's feet exactly like the game's spawner 0x88D76, set its ammo/uses
//                                          once its init (0x24D58) ran, then hold P1 attack for 3 frames so the
//                                          hero picks it up. Logs {give:..} to hook.jsonl with the result.
//   warp       {stage}                     boot-time warp: while the select screen runs (0xFF84D0 == 4) keep the
//                                          stage byte 0xFF84D9 = stage-1 (0-based), so gameplay starts at EPISODE stage
//   warpLive   {stage, at}                 from inside a stage: stage byte = stage-1, area 0xFF8786 = 0, then main
//                                          state 0xFF84D0 = 8 / 0xFF84D1 = 0 / 0xFF84D2 = 0 (what the stage-clear
//                                          code at 0xABE8 does) -> intermission, title card, then stage `stage`
//   warpArea   {area, at}                  inside a running stage: point the stage controller (0xFF873C) at the
//                                          first script segment of `area` (0-based, table 0x21B2A) and enter its
//                                          area-exit state 1.2 with "exit reached" (+0x6D) set; the game fades and
//                                          loads that area itself (0x20C6A -> 0xACD0). Only areas whose first
//                                          segment has a 0 camera trigger (the ones the game enters by a cut)
//   killAll    {at | every, from, to}      spawn the developer "ENEMY CLEAR" object (pool B type 0x24, handler
//                                          0x3B7D6): every active pool-B object gets HP 0 and state 6 (death)
//   freeze     {from, to}                  every active pool-B (enemy) slot is restored each frame to the bytes it had
//                                          when the freeze began (slots that appear later are captured on arrival)
'use strict';

const PLAYER_BASE = [0xFFB274, 0xFFB3F4, 0xFFB574];
// weapon item subtype (obj+0x26) -> in-game name (HUD table 0x23CDE, item init switch 0x24D60)
const WEAPONS = {
  rifle: 0x00, gun: 0x02, knife: 0x04, uzi: 0x06, m16: 0x08, shotgun: 0x0A, bazooka: 0x0C, rod: 0x0E,
  stick: 0x10, bknife: 0x12, club: 0x14, torch: 0x16, dynamite: 0x18, grenade: 0x1A, stone: 0x1C,
};
const POOL = { A: { count: 0xFFE5F4, ptr: 0xFFE5FE }, B: { count: 0xFFE5F8, ptr: 0xFFE602 }, C: { count: 0xFFE5F6, ptr: 0xFFE600 } };
const n = (v, d) => (v === undefined ? d : typeof v === 'string' ? Number(v) : v);

function one(c, k) {
  const id = `C${k}`, from = n(c.from, 0), to = n(c.to, 1e9), P = PLAYER_BASE[n(c.player, 1) - 1];
  switch (c.cheat) {
    case 'invuln': return `-- ${id} invuln
CHEATS[#CHEATS+1] = function(n) if n >= ${from} and n <= ${to} then local a = rb(${P}) if a == 1 or a == 2 then wb(${P}, 2) wb(${P} + 0xF9, 0x3C) end end end`;
    case 'infhp': return `-- ${id} infhp
CHEATS[#CHEATS+1] = function(n) if n >= ${from} and n <= ${to} and rb(${P}) ~= 0 then ww(${P} + 0x6C, rw(${P} + 0x6A)) end end`;
    case 'lives': return `-- ${id} lives
CHEATS[#CHEATS+1] = function(n) if n == ${n(c.at, 0)} then wb(${P} + 0xA3, ${n(c.value, 9)}) end end`;
    case 'score': return `-- ${id} score
CHEATS[#CHEATS+1] = function(n) if n == ${n(c.at, 0)} then wl(${P} + 0x100, ${n(c.value, 0)}) wb(0xFF0ECC, 1) wb(0xFF0ECC + ${n(c.player, 1)}, 1) end end`;
    case 'give': {
      const sub = typeof c.weapon === 'number' ? c.weapon : WEAPONS[String(c.weapon).toLowerCase().replace(/[^a-z0-9]/g, '')];
      if (sub === undefined) throw new Error(`give: unknown weapon ${c.weapon} (one of ${Object.keys(WEAPONS).join(', ')})`);
      const at = n(c.at, 2), ammo = c.ammo === undefined ? -1 : n(c.ammo);
      return `-- ${id} give ${c.weapon}
do local slot = nil
CHEATS[#CHEATS+1] = function(n)
  if n == ${at} then
    if rw(${P} + 0xB4) ~= 0 then HLOG(fmt('{"give":"${c.weapon}","n":%d,"error":"hero already holds a weapon","held":"%X"}', n, rw(${P} + 0xB4))) return end
    slot = POOL_ALLOC(${POOL.A.count}, ${POOL.A.ptr})
    if not slot then HLOG(fmt('{"give":"${c.weapon}","n":%d,"error":"pool A full"}', n)) return end
    wb(slot, 1) ww(slot + 0x20, 0) ww(slot + 0x26, ${sub}) ww(slot + 0x5C, 0) wb(slot + 0x96, 0)
    ww(slot + 0x08, rw(${P} + 0x08)) ww(slot + 0x0C, 0) ww(slot + 0x10, rw(${P} + 0x10))
  end
  if slot and n == ${at} + 2 and ${ammo} >= 0 then ww(slot + 0x6A, ${ammo}) ww(slot + 0x6C, ${ammo}) ww(slot + 0x6E, ${ammo}) end
  if slot and n >= ${at} + 3 and n <= ${at} + 5 then fields["P1 Button 1"]:set_value(1) end
  if slot and n == ${at} + 6 then fields["P1 Button 1"]:set_value(0) end
  if slot and n == ${at} + 30 then
    HLOG(fmt('{"give":"${c.weapon}","subtype":${sub},"n":%d,"slot":"%X","heldBy":"%X","heroHolds":"%X","class":"%X","ammo":%d,"ok":%s}', n, slot,
      rw(slot + 0x70), rw(${P} + 0xB4), rw(slot + 0xA0), rsw(slot + 0x6C), tostring(rw(${P} + 0xB4) == (slot & 0xffff))))
  end
end end`;
    }
    case 'warp': return `-- ${id} warp (boot)
CHEATS[#CHEATS+1] = function(n) if rb(0xFF84D0) == 4 then wb(0xFF84D9, ${n(c.stage, 1) - 1}) wb(0xFF8786, 0) end end`;
    case 'warpLive': return `-- ${id} warpLive
CHEATS[#CHEATS+1] = function(n) if n == ${n(c.at, 2)} then wb(0xFF84D9, ${n(c.stage, 1) - 1}) wb(0xFF8786, 0) wb(0xFF84D1, 0) ww(0xFF84D2, 0) wb(0xFF84D0, 8)
  HLOG(fmt('{"warpLive":${n(c.stage, 1)},"n":%d}', n)) end end`;
    case 'warpArea': return `-- ${id} warpArea (inside the current stage)
CHEATS[#CHEATS+1] = function(n) if n == ${n(c.at, 2)} then
  -- segment script of the stage: 0x21B2A + word[stage]; 16-byte entries, +0 camera-X trigger, +0xA area, +0xB state
  local stage = rb(0xFF84D9)
  local tbl = 0x21B2A + rw(0x21B2A + stage * 2)
  local k = nil
  for i = 0, 63 do local e = tbl + i * 16 if rw(e) == 0 and rb(e + 0xA) == ${n(c.area, 1)} and (i > 0) then k = i break end end
  if not k then HLOG(fmt('{"warpArea":${n(c.area, 1)},"n":%d,"error":"no area-start segment (word0 == 0) for this area in stage %d"}', n, stage + 1)) return end
  -- stage controller 0xFF873C: +0x56 next segment, +0x6C its index, +0x6D exit reached, +0x05/+0x06 state 1.2 (area exit)
  wl(0xFF8792, tbl + k * 16) wb(0xFF87A8, k) wb(0xFF87A9, 1) wb(0xFF8742, 2) wb(0xFF8741, 1)
  HLOG(fmt('{"warpArea":${n(c.area, 1)},"n":%d,"stage":%d,"segment":%d,"entry":"%X"}', n, stage + 1, k, tbl + k * 16))
end end`;
    case 'killAll': {
      const cond = c.every ? `n >= ${from} and n <= ${to} and (n - ${from}) % ${n(c.every)} == 0` : `n == ${n(c.at, 2)}`;
      return `-- ${id} killAll
CHEATS[#CHEATS+1] = function(n) if ${cond} then
  local s = POOL_ALLOC(${POOL.B.count}, ${POOL.B.ptr})
  if s then wb(s, 1) ww(s + 0x20, 0x24) ww(s + 0x26, 0) ww(s + 0x5C, 0) wb(s + 0x96, 0) end
end end`;
    }
    case 'freeze': return `-- ${id} freeze
do local saved = {}
CHEATS[#CHEATS+1] = function(n)
  if n < ${from} or n > ${to} then saved = {} return end
  for k = 0, 23 do
    local a = 0xFFC8F4 + k * 0xE0
    if rb(a) ~= 0 then
      if not saved[k] then saved[k] = space:read_range(a, a + 0xDF, 8) end
      local s = saved[k]
      for i = 1, 0xE0 do space:write_u8(a + i - 1, s:byte(i)) end
    else saved[k] = nil end
  end
end end`;
    default: throw new Error(`unknown cheat ${c.cheat}`);
  }
}

function cheatLua(list) {
  if (!list || !list.length) return '';
  return ['-- ===== cheats (tools/re/runtime/cheats.cjs) =====', 'CHEATS = {}', ...list.map(one),
    'local HOOK0 = HOOK',
    'HOOK = function(n) if HOOK0 then HOOK0(n) end for _, f in ipairs(CHEATS) do f(n) end end'].join('\n');
}
module.exports = { cheatLua, WEAPONS, PLAYER_BASE, POOL };
