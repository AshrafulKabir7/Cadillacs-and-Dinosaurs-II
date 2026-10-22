#!/usr/bin/env node
// Live runs for the heroes + weapons export (MAME 0.289, one process at a time).
//   node tools/re/export/heroes-live.cjs run [label|armed|all] [hero...]   -> work/re/runs/ex-heroes-*
//   node tools/re/export/heroes-live.cjs events                         -> work/re/extract/heroes/live/events.json
// Labelling runs log every write of P1 +0x28 / +0x30 with the writing PC and the caller's return address
// (lib/live.cjs TAP_LUA), plus the P1 struct, camera and pools A/B/D every frame. Armed runs add the OBJ list.
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./lib/live.cjs');
const I = require('./lib/ident.cjs');
const OUT = path.join(__dirname, '../../../work/re/extract/heroes/live');

const HEROES = L.HERO_KEYS;                                       // id order: jack mustapha hannah mess
const WEAPONS = ['rifle', 'gun', 'knife', 'uzi', 'm16', 'shotgun', 'bazooka', 'rod', 'stick', 'bknife', 'club', 'torch', 'dynamite', 'grenade', 'stone'];
const RAM_P1 = [['0xFFB274', 0x180], ['0xFF8744', 8], ['0xFF801A', 2]];
const RAM_POOLS = [['0xFF8874', 24 * 0xC0], ['0xFF9A74', 48 * 0x80], ['0xFFC8F4', 24 * 0xE0]];

// spawn helper (debug spawn list 0x88DDA, V10): SPAWNS = {{n=frame, idx=entry, dx=, dd=, w5c=}}
const SPAWN_LUA = String.raw`
EXPOOLS = {[0]={0xFFE5F8,0xFFE602},[1]={0xFFE5F6,0xFFE600},[3]={0xFFE5F4,0xFFE5FE}}
function EXSPAWN(e, dx, dd, w5c)
  local a = 0x88DDA + e * 26 + 16
  local cls = rw(a) & 7
  local p = EXPOOLS[cls]
  local s = POOL_ALLOC(p[1], p[2])
  if not s then HLOG(fmt('{"spawn":%d,"error":"pool full"}', e)) return end
  wb(s, 1) ww(s + 0x20, rw(a + 2)) ww(s + 0x26, rw(a + 4)) ww(s + 0x5C, w5c or rw(a + 6)) wb(s + 0x96, rw(a + 8) & 0xFF)
  local dir = (rb(0xFFB298) ~= 0) and 1 or -1
  ww(s + 8, rw(0xFFB27C) + dx * dir) ww(s + 0xC, rw(0xFFB280)) ww(s + 0x10, rw(0xFFB284) + dd)
  HLOG(fmt('{"spawn":%d,"slot":"%X","class":%d,"type":"%X","sub":"%X","n":%d}', e, s, cls, rw(a + 2), rw(a + 4), EXN or -1))
end
local HOOKS0 = HOOK
function HOOK(n) EXN = n if HOOKS0 then HOOKS0(n) end for _, s in ipairs(SPAWNS or {}) do if s.n == n then EXSPAWN(s.idx, s.dx, s.dd, s.w5c) end end
  for _, p in ipairs(EXPOKES or {}) do if p.n == n then if p.size == 1 then wb(p.addr, p.v) else ww(p.addr, p.v) end end end end
`;
const luaList = (name, arr) => `${name} = {` + arr.map(o => '{' + Object.entries(o).map(([k, v]) => `${k}=${v}`).join(',') + '}').join(',') + '}\n';

function base(name, hero, frames, extra = {}) {
  return {
    name, frames, loadState: extra.state || `stage1-${hero}`,
    cheats: extra.cheats || [{ cheat: 'invuln' }],
    hook: L.TAP_LUA + luaList('SPAWNS', extra.spawns || []) + luaList('EXPOKES', extra.pokes || []) + SPAWN_LUA,
    inputs: L.seqInputs(extra.steps || []),
    dump: { from: 0, to: frames - 1, every: 1, obj: !!extra.obj, cpsA: !!extra.obj, ram: extra.ram || RAM_P1.concat(RAM_POOLS) },
    snapshots: extra.snapshots || [],
  };
}
const A = (at, keys, len = 2) => ({ at, keys, len });

// ---------------------------------------------------------------------------------------------- scenarios
// solo moves: idle, walk 4 ways, turn, run, every jump variant, jump attacks, specials, whiffed punches
function solo(hero) {
  const s = [
    A(20, ['right'], 30), A(60, ['left'], 20), A(90, ['up'], 12), A(106, ['down'], 12),
    A(130, ['right'], 2), A(135, ['right'], 40),                                   // run
    A(200, ['jump']), A(260, ['right', 'jump'], 3), A(263, ['right'], 30),          // standing jump, forward jump
    A(330, ['jump']), A(334, ['attack']),                                           // early jump attack
    A(390, ['jump']), A(408, ['attack']),                                           // late jump attack
    A(450, ['jump']), A(462, ['down', 'attack'], 3),                                 // jump + down attack
    A(510, ['jump']), A(522, ['up', 'attack'], 3),                                   // jump + up attack
    A(570, ['left'], 2), A(575, ['left'], 36), A(596, ['jump']),                    // running jump
    A(650, ['right'], 2), A(655, ['right'], 36), A(675, ['jump']), A(684, ['attack']), // running jump attack
    A(740, ['left'], 2), A(745, ['left'], 30), A(765, ['attack']),                  // dash attack
    A(820, ['attack', 'jump'], 2),                                                  // special on the spot
    A(900, ['right'], 30), A(915, ['attack', 'jump'], 2),                            // special while walking
    A(980, ['attack']), A(988, ['attack']), A(996, ['attack']), A(1004, ['attack']), A(1012, ['attack']), A(1020, ['attack']), // whiffs
    A(1060, ['down', 'attack'], 3), A(1090, ['up', 'attack'], 3), A(1120, ['left', 'attack'], 3),
    A(1160, ['right', 'jump'], 3), A(1163, ['right'], 30), A(1168, ['attack']),        // forward jump + early attack
    A(1230, ['right', 'jump'], 3), A(1233, ['right'], 30), A(1250, ['attack']),        // forward jump + late attack
    A(1300, ['left', 'jump'], 3), A(1303, ['left'], 30),                              // jump while turning (facing right -> left)
    A(1370, ['jump']), A(1382, ['attack', 'jump'], 2),                               // special in the air
    A(1440, ['right'], 2), A(1445, ['right'], 30), A(1462, ['attack', 'jump'], 2),    // special while running
    A(1530, ['left', 'jump'], 3), A(1533, ['left'], 30), A(1545, ['down', 'attack'], 3), // back jump + down attack
  ];
  return base(`ex-heroes-${hero}-solo`, hero, 1600, { steps: s, ram: RAM_P1 });
}
// fight: combos on a frozen Chinpira, then grabs/knees/throws on live ones (invulnerable hero)
function fight(hero) {
  const s = [];
  for (let k = 0; k < 8; k++) s.push(A(20 + k * 7, ['attack']));                  // rapid combo into a frozen enemy
  for (let k = 0; k < 8; k++) s.push(A(120 + k * 12, ['attack']));                // slower combo
  s.push(A(260, ['right'], 40));                                                  // walk into enemy -> grab
  s.push(A(304, ['attack']), A(318, ['attack']), A(332, ['attack']));              // knees / throw
  s.push(A(420, ['right'], 40), A(464, ['left', 'attack'], 3));                     // grab, back throw
  s.push(A(560, ['right'], 40), A(604, ['jump']), A(610, ['attack']));             // grab + jump?
  s.push(A(700, ['right'], 40), A(744, ['right', 'attack'], 3));                    // grab + forward throw
  s.push(A(840, ['right'], 30), A(872, ['attack', 'jump'], 2));                      // special in contact
  return base(`ex-heroes-${hero}-fight`, hero, 960, {
    steps: s, ram: RAM_P1.concat(RAM_POOLS),
    cheats: [{ cheat: 'invuln' }, { cheat: 'freeze', from: 12, to: 230 }],
    spawns: [{ n: 5, idx: 1, dx: 34, dd: 0 }, { n: 250, idx: 1, dx: 60, dd: 0 }, { n: 410, idx: 2, dx: 60, dd: 0 }, { n: 550, idx: 1, dx: 60, dd: 0 }, { n: 690, idx: 3, dx: 60, dd: 0 }],
  });
}
// hurt: no invulnerability; enemies hit the hero (infhp), then HP 1 -> death
function hurt(hero) {
  return base(`ex-heroes-${hero}-hurt`, hero, 1500, {
    cheats: [{ cheat: 'infhp', to: 900 }, { cheat: 'lives', value: 3, at: 2 }],
    spawns: [{ n: 5, idx: 11, dx: 50, dd: 0 }, { n: 6, idx: 1, dx: -50, dd: 0 }, { n: 7, idx: 4, dx: 60, dd: 10 }, { n: 300, idx: 13, dx: 50, dd: 0 },
      { n: 500, idx: 16, dx: 90, dd: 0 }, { n: 600, idx: 7, dx: 70, dd: 0 }, { n: 700, idx: 5, dx: -60, dd: 0 }],
    pokes: [{ n: 910, addr: 0xFFB274 + 0x6C, size: 2, v: 1 }],
    steps: [A(400, ['attack']), A(440, ['attack', 'jump'])],
    ram: RAM_P1.concat(RAM_POOLS),
  });
}
// grabbed: enemies that seize the hero (+0x05 = 6, set 5); infhp keeps the hero alive
function grabbed(hero) {
  return base(`ex-heroes-${hero}-grabbed`, hero, 1500, {
    cheats: [{ cheat: 'infhp' }],
    spawns: [{ n: 5, idx: 21, dx: 80, dd: 0 }, { n: 300, idx: 22, dx: 90, dd: 0 }, { n: 650, idx: 85, dx: 90, dd: 0 }, { n: 1000, idx: 84, dx: 90, dd: 0 }],
    steps: [], ram: RAM_P1.concat(RAM_POOLS),
  });
}
// stage clear: last area of stage 1, walk right, clear the enemies every 90 frames (victory pose)
const WEAK_LUA = String.raw`
local HOOKW0 = HOOK
function HOOK(n) if HOOKW0 then HOOKW0(n) end
  if n >= 150 then for k = 0, 23 do local a = 0xFFC8F4 + k * 0xE0 if rb(a) ~= 0 and rsw(a + 0x6C) > 1 then ww(a + 0x6C, 1) end end end end
`;
function clear(hero) {
  const s = []; for (let k = 0; k < 60; k++) { s.push(A(150 + k * 40, ['right'], 24)); s.push(A(176 + k * 40, ['attack'])); s.push(A(184 + k * 40, ['attack'])); }
  const p = base(`ex-heroes-${hero}-clear`, hero, 3300, {
    steps: s, ram: RAM_P1,
    cheats: [{ cheat: 'invuln' }, { cheat: 'warpArea', area: 2, at: 10 }],
  });
  p.hook += WEAK_LUA;
  return p;
}
// misc: pick up a weapon (give cheat), pick up / carry / throw a drum can (class 0x20A), food pick up
function misc(hero) {
  return base(`ex-heroes-${hero}-misc`, hero, 900, {
    cheats: [{ cheat: 'invuln' }, { cheat: 'give', weapon: 'rifle', at: 10 }],
    spawns: [{ n: 200, idx: 69, dx: 0, dd: 0 }, { n: 600, idx: 75, dx: 0, dd: 0 }],
    steps: [A(60, ['attack']), A(90, ['attack']), A(110, ['jump', 'attack'], 2),          // shoot twice, special drops the gun
      A(205, ['attack']), A(240, ['right'], 30), A(280, ['left'], 2), A(285, ['left'], 30), A(330, ['jump']), A(345, ['attack']), // drum can: pick up, walk, run, jump, throw
      A(400, ['attack']), A(450, ['attack']), A(605, ['attack'])],
    ram: RAM_P1.concat(RAM_POOLS),
  });
}

// container: pick up a drum can (class 0x20A, pose slot 15), walk both ways, jump, run, throw it
function container(hero) {
  const s = [A(12, ['right'], 4), A(20, ['attack']), A(60, ['right'], 30), A(100, ['left'], 26), A(150, ['jump']), A(210, ['right'], 2), A(215, ['right'], 24), A(250, ['attack']), A(284, ['right'], 4), A(292, ['attack']), A(330, ['jump']), A(342, ['attack'])];
  return base(`ex-heroes-cont-${hero}`, hero, 420, { steps: s, obj: true, ram: RAM_P1.concat(RAM_POOLS), spawns: [{ n: 5, idx: 68, dx: 16, dd: 0 }, { n: 280, idx: 71, dx: 16, dd: 0 }] });
}
// armed: per hero x weapon; idle, walk right, walk left (native facing), run, jump, fire x3, fire facing left,
// walk+fire, jump+fire, run+fire
function armed(hero, weapon) {
  const s = [
    A(30, ['right'], 24), A(70, ['left'], 24),                                      // walk right / left (ends facing left)
    A(110, ['attack']), A(140, ['attack']), A(170, ['attack']),                      // fire facing left
    A(200, ['right'], 2), A(205, ['right'], 30),                                     // run right
    A(250, ['jump']), A(320, ['right', 'jump'], 2), A(330, ['attack']),               // jump, jump + fire
    A(390, ['attack']), A(397, ['attack']), A(404, ['attack']), A(411, ['attack']),   // rapid fire facing right
    A(450, ['attack'], 30),                                                         // held fire (burst)
    A(500, ['left'], 2), A(505, ['left'], 26), A(520, ['attack']),                   // run + fire
    A(560, ['left'], 30), A(575, ['attack']),                                        // walk + fire
  ];
  return base(`ex-heroes-arm-${hero}-${weapon}`, hero, 640, {
    state: `stage1-${hero}-armed-${weapon}`, steps: s, obj: true, ram: RAM_P1.concat(RAM_POOLS),
    pokes: [{ n: 2, addr: 0xFFB274 + 0x6C, size: 2, v: 100 }],
  });
}

// ---------------------------------------------------------------------------------------------- second pass
// Scenarios added after the adversarial review (labels per hero, the knife stab, containers, colour, the torch flame).
const P1B = 0xFFB274, P2B = 0xFFB3F4;
// extra: straight jump + stick against / towards the facing near the apex (main 12 / 7: 0x1A69E needs height >= 48),
// turn + jump within 3 frames (backward jump, main 5: 0x1A61A tests +0xAB < 3), the Down, Up + Attack command
// (0x6AC8 -> +0xF1 = 2 -> jump state 0x30, 0x1B6EC), then the 1-UP pose (+0x10E = 1 while idle: 0x19176 -> 0x19996)
function extra(hero) {
  const s = [
    A(20, ['jump']), A(28, ['left'], 22),
    A(100, ['right'], 2),
    A(130, ['jump']), A(138, ['right'], 22),
    A(210, ['left'], 1), A(211, ['left', 'jump'], 2),
    A(300, ['right'], 2),
    A(330, ['down'], 4), A(334, ['up'], 8), A(336, ['up', 'attack'], 2),
    A(450, ['left'], 2),
    A(480, ['down'], 4), A(484, ['up'], 8), A(486, ['up', 'attack'], 2),
  ];
  return base(`ex-heroes-${hero}-extra`, hero, 900, { steps: s, ram: RAM_P1.concat([['0xFF9A74', 48 * 0x80]]), pokes: [{ n: 600, addr: P1B + 0x10E, size: 1, v: 1 }] });
}
// stab: knife in hand, a frozen Chinpira 40 px in front (inside every hero's reach box 0x62AE), attack x4
function stab(hero) {
  return base(`ex-heroes-stab-${hero}`, hero, 300, {
    state: `stage1-${hero}-armed-knife`, obj: true, ram: RAM_P1.concat(RAM_POOLS),
    cheats: [{ cheat: 'invuln' }, { cheat: 'freeze', from: 8, to: 299 }],
    spawns: [{ n: 5, idx: 1, dx: 40, dd: 0 }],
    steps: [A(40, ['attack']), A(100, ['attack']), A(160, ['attack']), A(220, ['attack'])],
    pokes: [{ n: 2, addr: P1B + 0x6C, size: 2, v: 100 }],
  });
}
// cont2: containers are lifted with attack + the stick held towards them (0x5B68; only CONKRIET 6 and IWA 8 lift on a
// plain attack): drum can (carry: idle, walk both ways, run, jump, throw), then YOROI (0xA) and TIYA (0xC)
function cont2(hero) {
  const s = [
    A(14, ['right', 'attack'], 2),
    A(50, ['right'], 30), A(90, ['left'], 30), A(140, ['jump']),
    A(200, ['right'], 2), A(205, ['right'], 24), A(250, ['attack']),
    A(300, ['right'], 2), A(314, ['right', 'attack'], 2), A(360, ['attack']),
    A(420, ['right'], 2), A(434, ['right', 'attack'], 2), A(480, ['attack']),
  ];
  return base(`ex-heroes-cont2-${hero}`, hero, 560, { steps: s, obj: true, ram: RAM_P1.concat(RAM_POOLS), snapshots: [30, 60, 100, 200, 330, 450],
    spawns: [{ n: 5, idx: 69, dx: 18, dd: 0 }, { n: 306, idx: 73, dx: 18, dd: 0 }, { n: 426, idx: 74, dx: 18, dd: 0 }] });
}
// cont3: YOROI (0xA) and TIYA (0xC) alone (cont2 dropped a food item from the broken drum on the same spot): lift with
// attack + the stick towards the item, walk, jump, throw
function cont3(hero) {
  const s = [
    A(14, ['right', 'attack'], 2), A(60, ['left'], 20), A(100, ['jump']), A(160, ['attack']),
    A(214, ['right', 'attack'], 2), A(260, ['left'], 20), A(300, ['jump']), A(360, ['attack']),
  ];
  return base(`ex-heroes-cont3-${hero}`, hero, 420, { steps: s, obj: true, ram: RAM_P1.concat(RAM_POOLS), snapshots: [40, 80, 240, 280],
    cheats: [{ cheat: 'invuln' }, { cheat: 'killAll', every: 60, from: 2 }],
    spawns: [{ n: 5, idx: 73, dx: 18, dd: 0 }, { n: 205, idx: 74, dx: 18, dd: 0 }] });
}
// colour: the torch (with its flame object) per hero, real MAME screenshots + palette RAM
function snapTorch(hero) {
  const s = [A(30, ['right'], 24), A(70, ['left'], 24), A(110, ['attack']), A(150, ['right'], 2), A(155, ['right'], 24), A(200, ['jump'])];
  const p = base(`ex-heroes-snap-${hero}-torch`, hero, 240, { state: `stage1-${hero}-armed-torch`, steps: s, obj: true, ram: RAM_P1.concat([['0xFF8874', 24 * 0xC0]]) });
  p.dump.palette = true; p.snapshotEvery = { from: 10, to: 230, every: 10 }; return p;
}
// colour in the weapon's home context: B. KNIFE only appears in EPISODE 2 area 2 (the BUTCHER's knives, type 0xD0 ->
// item subtype 0x12 at 0x5739A), YOROI only in EPISODE 1 area 1 (bz-stage walks)
function snapBknife() {
  const p = base('ex-heroes-snap-jack-bknife-e2a2', 'jack', 900, { state: 'stage2-jack', cheats: [{ cheat: 'invuln' }, { cheat: 'warpArea', area: 2, at: 10 }, { cheat: 'killAll', every: 90, from: 400 }, { cheat: 'give', weapon: 'bknife', at: 560 }],
    steps: [A(620, ['right'], 24), A(660, ['left'], 24), A(700, ['attack']), A(760, ['right'], 2), A(765, ['right'], 20)], obj: true, ram: RAM_P1.concat([['0xFF8874', 24 * 0xC0], ['0xFF84D0', 16], ['0xFF8786', 2]]) });
  p.dump.palette = true; p.snapshotEvery = { from: 560, to: 890, every: 10 }; return p;
}
function snapYoroi() {
  const p = base('ex-heroes-snap-jack-yoroi-e1a1', 'jack', 300, { state: 'stage1-jack-area1', cheats: [{ cheat: 'invuln' }, { cheat: 'killAll', every: 90, from: 10 }],
    spawns: [{ n: 20, idx: 73, dx: 18, dd: 0 }], steps: [A(30, ['right'], 2), A(36, ['right', 'attack'], 2), A(80, ['left'], 24), A(130, ['right'], 24), A(200, ['attack'])],
    obj: true, ram: RAM_P1.concat([['0xFF8874', 24 * 0xC0], ['0xFF84D0', 16], ['0xFF8786', 2]]) });
  p.dump.palette = true; p.snapshotEvery = { from: 30, to: 290, every: 10 }; return p;
}
// team-up (2 players): P1 = initiator (stage1-<p1> state), P2 joins with coin 2 and picks <p2>; the two stand still
// next to each other (0x6710: |dx| < 32, 0 <= P1.depth - P2.depth < 16, no input, both hittable) for 90 frames ->
// P1 -> ground state 0x1A, P2 -> the state chosen by table 0x6902 for P1's character (team move). The hook teleports P1
// next to P2 twice; the second time P2 presses attack during the move. No invulnerability cheat (it would keep +0x00 = 2).
const SELECT_ORDER = [0, 2, 1, 3];
function team(p1, p2) {
  const c1 = HEROES.indexOf(p1), c2 = HEROES.indexOf(p2);
  const order = SELECT_ORDER.filter(c => c !== c1), presses = order.indexOf(c2);
  const inputs = [{ from: 10, to: 15, keys: ['Coin 2'] }, { from: 40, to: 45, keys: ['2 Players Start'] }];
  for (let k = 0; k < presses; k++) inputs.push({ from: 60 + k * 15, to: 61 + k * 15, keys: ['P2 Right'] });
  inputs.push({ from: 120, to: 122, keys: ['P2 Button 1'] });
  const hook = L.tapLuaFor([{ base: P1B, tag: '' }, { base: P2B, tag: '2' }]) + String.raw`
local TP = { phase = 0, n0 = 0, t1 = 0 }
local function idle(p) return rb(p + 4) == 2 and rb(p + 5) == 0 and rb(p + 6) == 0 and rb(p + 7) == 0 end
local function teleport(n) ww(${P1B} + 8, rw(${P2B} + 8) + 12) ww(${P1B} + 0x10, rw(${P2B} + 0x10)) ww(${P1B} + 0x0C, 0) HLOG(fmt('{"teleport":%d}', n)) end
local HOOKT0 = HOOK
function HOOK(n)
  if HOOKT0 then HOOKT0(n) end
  if rb(${P1B}) ~= 0 then ww(${P1B} + 0x6C, rw(${P1B} + 0x6A)) end
  if rb(${P2B}) ~= 0 then ww(${P2B} + 0x6C, rw(${P2B} + 0x6A)) end
  if TP.phase == 0 and n >= 700 and rb(${P2B} + 4) == 2 and idle(${P2B}) then teleport(n) TP.phase = 1 end
  if (TP.phase == 1 or TP.phase == 3) and rb(${P1B} + 7) == 0x1A then TP.n0 = n HLOG(fmt('{"team":%d,"phase":%d,"p2state":"%X.%X.%X.%X"}', n, TP.phase, rb(${P2B} + 4), rb(${P2B} + 5), rb(${P2B} + 6), rb(${P2B} + 7))) TP.phase = TP.phase + 1 end
  if TP.phase == 2 and n > TP.n0 + 90 and idle(${P1B}) and idle(${P2B}) then TP.t1 = n + 40 TP.phase = 25 end
  if TP.phase == 25 and n >= TP.t1 then teleport(n) TP.phase = 3 end
  if TP.phase == 4 then local d = n - TP.n0 if (d >= 20 and d <= 22) or (d >= 45 and d <= 47) or (d >= 70 and d <= 72) then fields["P2 Button 1"]:set_value(1) else fields["P2 Button 1"]:set_value(0) end end
  for k = 0, 47 do local a = 0xFF9A74 + k * 0x80 if rb(a) ~= 0 and rw(a + 0x20) == 0x14 then HLOG(fmt('{"bubble":"%X","n":%d,"sub":%d,"x":%d,"h":%d,"d":%d,"fp":%d,"st":%d,"drawn":%d,"holder":"%X"}', a, n, rw(a + 0x26), rsw(a + 8), rsw(a + 0xC), rsw(a + 0x10), rl(a + 0x28), rb(a + 5), rb(a + 1), rw(a + 0x58))) end end
end
`;
  return {
    name: `ex-heroes-team-${p1}-${p2}`, frames: 1900, loadState: `stage1-${p1}`,
    cheats: [{ cheat: 'killAll', every: 60, from: 100 }],
    hook, inputs,
    dump: { from: 0, to: 1899, every: 1, obj: false, cpsA: false, ram: [['0xFFB274', 0x180], ['0xFFB3F4', 0x180], ['0xFF8744', 8], ['0xFF801A', 4]] },
    snapshots: [],
  };
}
const TEAM_PAIRS = []; for (const a of HEROES) for (const b of HEROES) if (a !== b) TEAM_PAIRS.push([a, b]);
// victory: the stage-clear / boss-defeat pose, ground state 0x18 (0x19996). The idle code enters it when +0x10E (extra
// life) is set (0x19176); inside, +0x10E = 0 with +0xC0 = 1 (boss defeated by this player, 0x6148) spawns the
// catchphrase bubble (0x6192 -> pool D type 0x14) and plays main 14 (Mustapha and Hannah then jump: 0x1ADA6 / 0x1AE62);
// +0xC0 = 0 plays main 17. A read tap on +0x10E answers 1 to the test at 0x19176 once per arming and passes every other
// read through (RAM stays 0), which reaches both branches without a boss fight.
function victory(hero) {
  const hook = L.TAP_LUA + String.raw`
VARM = false
VTAP = space:install_read_tap(${P1B + 0x10E}, ${P1B + 0x10F}, "victory", function(offset, data, mask)
  if VARM and cpu.state["CURPC"].value == 0x19176 and (mask & 0xFF00) ~= 0 then
    VARM = false
    HLOG(fmt('{"victoryArm":%d,"c0":%d}', EXN or -1, rb(${P1B + 0xC0})))
    return (data & 0x00FF) | 0x0100
  end
  return data
end)
local HOOKV0 = HOOK
function HOOK(n) EXN = n if HOOKV0 then HOOKV0(n) end
  if n == 30 then wb(${P1B + 0xC0}, 1) VARM = true end
  if n == 260 then wb(${P1B + 0xC0}, 0) end
  if n == 300 then VARM = true end
  for k = 0, 47 do local a = 0xFF9A74 + k * 0x80 if rb(a) ~= 0 and rw(a + 0x20) == 0x14 then HLOG(fmt('{"bubble":"%X","n":%d,"sub":%d,"x":%d,"h":%d,"d":%d,"fp":%d,"st":%d,"drawn":%d}', a, n, rw(a + 0x26), rsw(a + 8), rsw(a + 0xC), rsw(a + 0x10), rl(a + 0x28), rb(a + 4), rb(a + 1))) end end
end
`;
  return {
    name: `ex-heroes-victory-${hero}`, frames: 520, loadState: `stage1-${hero}`,
    cheats: [{ cheat: 'invuln' }, { cheat: 'killAll', every: 60, from: 5 }],
    hook, inputs: [],
    dump: { from: 0, to: 519, every: 1, obj: true, cpsA: true, ram: RAM_P1.concat([['0xFF9A74', 48 * 0x80], ['0xFF8000', 4]]) },
    snapshotEvery: { from: 30, to: 510, every: 8 },
  };
}

// car: the area-0 start of EPISODE 2 / 3 / 4 reached with warpLive (stage-clear writes). The player init at 0x18AB6
// starts main 29 (the hero seated in the Cadillac, records 2696-2701) for the first present player when the stage byte
// is 1 or 3 (EPISODE 2 / 4); EPISODE 3 (HELL ROAD) is the driving stage seen in the reference video at 03:28.
function car(hero, ep, frames = 1700) {
  const p = base(`ex-heroes-car-e${ep}-${hero}`, hero, frames, {
    cheats: [{ cheat: 'invuln' }, { cheat: 'warpLive', stage: ep, at: 5 }],
    steps: ep === 3 ? [A(1250, ['right'], 300), A(1600, ['attack']), A(1700, ['right'], 200)] : [],
    obj: true, ram: RAM_P1.concat([['0xFF84D0', 16], ['0xFF8786', 2], ['0xFF8874', 24 * 0xC0], ['0xFFB6F4', 24 * 0xC0]]),
  });
  p.snapshotEvery = { from: 600, to: frames - 1, every: 25 };
  return p;
}

const PLANS = {
  car: h => (h === 'mustapha' ? [car(h, 3, 2200)] : [car(h, 2), car(h, 4)]),
  label: h => [solo(h), fight(h), hurt(h), misc(h), grabbed(h)],
  clear: h => [clear(h)],
  container: h => [container(h)],
  armed: h => WEAPONS.map(w => armed(h, w)),
  extra: h => [extra(h)],
  stab: h => [stab(h)],
  cont2: h => [cont2(h)],
  cont3: h => [cont3(h)],
  snap: h => [snapTorch(h)].concat(h === 'jack' ? [snapBknife(), snapYoroi()] : []),
  team: h => TEAM_PAIRS.filter(([a]) => a === h).map(([a, b]) => team(a, b)),
  victory: h => [victory(h)],
};

// ---------------------------------------------------------------------------------------------- events
function heroIdOf(name) { const m = /ex-heroes-(?:arm-|cont[23]?-|stab-|snap-|victory-|car-e\d-)?(jack|mustapha|hannah|mess)/.exec(name); return m ? HEROES.indexOf(m[1]) : -1; }
// one player's animation starts in a run (P1, or P2 with tag '2' in the team-up runs)
function playerEvents(name, c, P, tag, frames, byF, hook) {
  const taps = L.tapLongs(hook, tag);
  const ev = [];
  for (const t of taps) {
    const st = I.starts(c, t.value), id = I.ident(c, t.value);
    const fr = byF.get(t.f);
    let state = null, inp = null, pos = null;
    if (fr && fr.mem) {
      const m = L.mem(fr);
      if (m.has(P + 0xB6)) {
        state = [m.b(P + 4), m.b(P + 5), m.b(P + 6), m.b(P + 7)].map(x => x.toString(16)).join('.');
        inp = m.has(0xFF801B) ? m.b(0xFF801B) : null;
        pos = { x: m.sw(P + 8), h: m.sw(P + 0xC), d: m.sw(P + 0x10), face: m.b(P + 0x24), split: m.b(P + 0x25) & 1, cls: m.w(P + 0xB6) };
      }
    }
    ev.push({ f: t.f, tap: t.t, value: '0x' + t.value.toString(16), start: st, at: id.map(x => `${x.list}:${x.anim}.${x.frame}`), pc: '0x' + t.pc.toString(16), caller: '0x' + t.r.toString(16), caller2: '0x' + t.r2.toString(16), state, inp, pos });
  }
  return ev;
}
function eventsOf(name) {
  const tm = /^ex-heroes-team-(\w+)-(\w+)$/.exec(name);
  if (tm) {
    const c1 = HEROES.indexOf(tm[1]), c2 = HEROES.indexOf(tm[2]);
    const frames = L.readRun(name), byF = new Map(frames.map(f => [f.f, f])), hook = L.readHook(name);
    return [{ run: name, hero: c1, player: 1, role: 'team-up initiator', events: playerEvents(name, c1, L.P1, '', frames, byF, hook) },
      { run: name, hero: c2, player: 2, role: 'team-up partner', events: playerEvents(name, c2, 0xFFB3F4, '2', frames, byF, hook) }];
  }
  const c = heroIdOf(name); if (c < 0) return null;
  const frames = L.readRun(name), byF = new Map(frames.map(f => [f.f, f]));
  return { run: name, hero: c, events: playerEvents(name, c, L.P1, '', frames, byF, L.readHook(name)) };
}

async function main() {
  const [cmd, what = 'label', ...rest] = process.argv.slice(2);
  const heroes = rest.length ? rest : HEROES;
  if (cmd === 'run') {
    const kinds = what === 'all' ? ['label', 'armed'] : [what];
    const plans = []; for (const k of kinds) for (const h of heroes) plans.push(...PLANS[k](h));
    const res = await L.runSeq(plans);
    console.log('runs ok', res.filter(s => s.ok).length, 'of', res.length);
  } else if (cmd === 'events') {
    fs.mkdirSync(OUT, { recursive: true });
    const runs = fs.readdirSync(L.RUNS).filter(n => /^ex-heroes-/.test(n) && !/test|probe/.test(n) && fs.existsSync(path.join(L.RUNS, n, 'hook.jsonl'))).sort();
    const all = runs.flatMap(n => [].concat(eventsOf(n) || []));
    fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(all, null, 1));
    console.log('events for', all.length, 'runs');
  }
}
if (require.main === module) main();
module.exports = { PLANS, solo, fight, hurt, misc, grabbed, clear, container, armed, extra, stab, cont2, cont3, snapTorch, snapBknife, snapYoroi, team, victory, car, TEAM_PAIRS, eventsOf, WEAPONS, HEROES };
