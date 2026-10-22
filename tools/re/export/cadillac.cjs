#!/usr/bin/env node
// Cadillac extraction for the sequel (WP-J, CAR-1; HEROES.md §9.1, PLAN.md §6 WP-J). Research tooling only: nothing in
// this file ships, and every output goes to the git-ignored work/ tree.
//
//   node tools/re/export/cadillac.cjs live [jack|mustapha|3p|all] [--force]   MAME runs -> work/re/runs/ex-cadillac-e3-*
//   node tools/re/export/cadillac.cjs [export]                                -> work/re/extract/heroes/cadillac/*
//                                                                               + work/re/impl/WP-J/fx-cadillac.json
//
// The export needs no MAME: it decodes the ROM (tools/re/rom.cjs, the user's own set, read-only) and reads the runs that
// `live` made plus the earlier heroes runs ex-heroes-car-e2-jack / ex-heroes-car-e4-jack (the EPISODE 2 / 4 starts,
// where the Cadillac drives in with the seated hero). It is deterministic for a given set of runs.
//
// What the ROM does (every number below is re-read from the ROM by decodeStatic(), which checks the instruction bytes
// at each cited address and stops if any differ):
//   * HELL ROAD car = three pool-C objects of type 0x160 (handler 0x8BDDC, animation set 0x8C8D6): subtype 0 the body
//     (anim 0 record 1097 "drive", anim 1 record 1098 "brake": nose down while the speed is above the target), subtypes
//     2 / 4 the front / rear wheel (anims 2..6: wheel frames 1099/1100 straight, 1102/1103 and 1105/1106 turned toward
//     the viewer, 1108/1109 and 1111/1112 turned away). The art faces right (facing byte 0 drives right).
//   * The heroes in the car are not drawn by the hero objects (the player handler skips its draw while 0xFF8518 is
//     set, 0x18A3E). Three pool-D seat objects of type 0x90 (handler 0x96FF4, set 0x97150) draw them: subtype 0 the
//     driver, 1 the front passenger, 2 the back seat (mirrored), at (dx, height, depth) offsets 0x970F6 from the body;
//     front seats play anim 2*id (main:29 records 2700 / 2696-2697 / 2698-2699 / 2701), the back seat 2*id+1
//     (records 113 / 287 / 1580 / 644). The seat records are cut at the waist and drawn over the body: no clipping.
//   * Damage: HP 120; below 60 a hood smoke puff every 8 frames, below 30 a second puff and a red flash (palette
//     override 0x84 = slot 4 for 2 of every 32 frames); a hit flinches the body in slot 4. HP 0 (or camX 0xA000, the
//     end of the road) = the wreck: the riders are thrown out (120 frames of invulnerability), the car keeps rolling
//     at its last speed in the brake pose, leaves the screen (x > camX + 512) and is removed. There is no broken-car art.
//   * The same body art (records 3391 / 3392, OBJ slots 11 / 12) is the car that brings the hero in at the EPISODE 2
//     and 4 starts (pool B type 0x40, set 0x42386, wheels pool B type 0x44); records 3489 / 3490 are the ending car
//     with Jack driving and Hannah beside him (pool C type 0x158, set 0x8B5E6).
//
// Outputs (work/re/extract/heroes/cadillac/):
//   cadillac.json      the fx.cadillac entry (PLAN §6 WP-J contract) that tools/re/build/sprites-fx.cjs embeds verbatim
//   extraction.json    everything behind it: static decode with the instruction evidence, live observations per run,
//                      validation statistics (OBJ blocks predicted from RAM, model offsets, pixels, timing)
//   atlas-cadillac.png/.json   every Cadillac record (and the seat records) rendered with the live E3 palette
//   sheet-cadillac.png labelled contact sheet: body, wheels by steer index, seats per hero, flash, dust, ending car
//   compare-*.png      MAME snapshot | model render (from the shipped data) | difference, for sampled frames
// and work/re/impl/WP-J/fx-cadillac.json (= cadillac.json) for WP-D.
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../rom.cjs');
const AN = require('../anim.cjs');
const O = require('../mame/obj.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const RUNS = path.join(ROOT, 'work/re/runs');
const OUT = path.join(ROOT, 'work/re/extract/heroes/cadillac');
const IMPL = path.join(ROOT, 'work/re/impl/WP-J');
const HEROES = ['jack', 'mustapha', 'hannah', 'mess'];          // character id order (V27)
const hex = (v, n = 0) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');

// =====================================================================================================================
// 1. live MAME runs (only `live` touches MAME; one process at a time through lib/live.cjs runSeq)
// =====================================================================================================================
const RAM = [
  ['0xFFB274', 3 * 0x180],          // players P1..P3 (V25)
  ['0xFFB6F4', 24 * 0xC0],          // pool C: the car body and its two wheels (type 0x160)
  ['0xFF9A74', 48 * 0x80],          // pool D: seat objects (type 0x90), dust / smoke puffs (type 0xA4)
  ['0xFF8744', 8],                  // camera X / Y (V05)
  ['0xFF84D0', 0x50],               // game flags (0xFF8516 / 0xFF8518 Cadillac mode, 0xFF850E car spawned)
  ['0xFF8000', 2],                  // main-loop counter (the car's smoke timer reads it)
];

// Lua hook: spawns score item subtype 12 (debug spawn list entry 77, record 2692) at the hero's feet at frame spawnAt
// (picking it up calls 0x8BD24, which spawns the car), keeps the stage timer from running out, and writes the car's
// HP (+0x6C) at the given frames (50: hood smoke, 25: second smoke + red flash, 0: wreck).
const HOOK = (spawnAt, hpPokes) => String.raw`
CEXPOOLS = {[0]={0xFFE5F8,0xFFE602},[1]={0xFFE5F6,0xFFE600},[3]={0xFFE5F4,0xFFE5FE}}
function CSPAWN(e, sub, dx)
  local a = 0x88DDA + e * 26 + 16
  local cls = rw(a) & 7
  local p = CEXPOOLS[cls]
  local s = POOL_ALLOC(p[1], p[2])
  if not s then HLOG(fmt('{"t":"spawn","f":%d,"e":%d,"err":"pool full"}', CN, e)) return nil end
  wb(s, 1) ww(s + 0x20, rw(a + 2)) ww(s + 0x26, sub) ww(s + 0x5C, rw(a + 6)) wb(s + 0x96, rw(a + 8) & 0xFF) wb(s + 6, 0)
  ww(s + 8, rw(0xFFB27C) + dx) ww(s + 0xC, rw(0xFFB280)) ww(s + 0x10, rw(0xFFB284))
  HLOG(fmt('{"t":"spawn","f":%d,"e":%d,"slot":%d,"type":%d,"sub":%d}', CN, e, s, rw(a + 2), sub))
  return s
end
CAR = nil
CARHP = {${hpPokes.map(p => `{n=${p.n},v=${p.v}}`).join(',')}}
function HOOK(n) CN = n
  if n % 30 == 0 then ww(0xFF84E8, 0x0359) end
  if n == ${spawnAt} then local dir = (rb(0xFFB298) ~= 0) and 1 or -1 CSPAWN(77, 12, 8 * dir) end
  if not CAR then for k = 0, 23 do local a = 0xFFB6F4 + k * 0xC0
    if rb(a) ~= 0 and rw(a + 0x20) == 0x160 and rw(a + 0x26) == 0 then CAR = a HLOG(fmt('{"t":"car","f":%d,"a":%d}', n, a)) end end end
  for _, p in ipairs(CARHP) do if p.n == n and CAR then ww(CAR + 0x6C, p.v) HLOG(fmt('{"t":"carhp","f":%d,"v":%d}', n, p.v)) end end
end
`;
const A = (at, keys, len = 1) => ({ from: at, to: at + len - 1, keys });

// Solo run from the runtime save state stage3-<hero>: the NPC who drives the car in is the lowest absent character id
// (0x8C784): Mustapha for Jack, Jack for Mustapha. Then boost, cruise, steer up / down, brake, diagonals, the damage
// pokes and the wreck.
function solo(hero = 'jack', frames = 1200) {
  return {
    name: `ex-cadillac-e3-${hero}`, frames, loadState: `stage3-${hero}`,
    cheats: [{ cheat: 'invuln' }, { cheat: 'infhp' }],
    inputs: [A(30, ['attack'], 2),
      A(400, ['right'], 120), A(580, ['up'], 60), A(640, ['down'], 60), A(700, ['left'], 60),
      A(760, ['right', 'up'], 60), A(820, ['right', 'down'], 60), A(900, ['attack'], 3), A(905, ['right'], 120)],
    hook: HOOK(20, [{ n: 940, v: 50 }, { n: 980, v: 25 }, { n: 1030, v: 0 }]),
    dump: { from: 30, to: frames - 1, every: 1, obj: true, cpsA: true, palette: true, ram: RAM },
    snapshotEvery: { from: 40, to: frames - 1, every: 5 },
  };
}

// Three players: P2 and P3 join (coin + start, the select cursor moved with Right, then Button 1; recipe of vl-p2join /
// vl-p3-lives / ex-heroes-probe-p2select: the cursor cycles Jack, Hannah, Mustapha, Mess and skips taken heroes)
// before the item is picked up, so the car fills all three seat objects (subtype 0 driver = P1, 1 front passenger =
// the next present player, 2 back seat = the last one) and the wreck throws all three out. The NPC who drives the car
// in is the lowest character id nobody plays (0x8C784). Four line-ups put every hero in a front seat and in the back
// seat at least once: [p1, p2, p3] = character keys; p2Right / p3Right = Right presses from the default cursor.
const LINEUPS = [
  { p1: 'mustapha', p2: 'jack', p3: 'hannah', p2Right: 0, p3Right: 0 },    // NPC mess
  { p1: 'mustapha', p2: 'hannah', p3: 'jack', p2Right: 1, p3Right: 0 },    // NPC mess
  { p1: 'jack', p2: 'mustapha', p3: 'mess', p2Right: 1, p3Right: 1 },      // NPC hannah
  { p1: 'jack', p2: 'hannah', p3: 'mustapha', p2Right: 0, p3Right: 0 },    // NPC mess
];
function three(lu, frames = 1300) {
  const P = (p) => [{ cheat: 'invuln', player: p }, { cheat: 'infhp', player: p }];
  const Rt = (key, at, n) => Array.from({ length: n }, (_, k) => A(at + k * 15, [key], 2));
  return {
    name: `ex-cadillac-e3-3p-${lu.p1}-${lu.p2}-${lu.p3}`, frames, loadState: `stage3-${lu.p1}`,
    cheats: [...P(1), ...P(2), ...P(3)],
    inputs: [A(5, ['Coin 2'], 6), A(30, ['2 Players Start'], 6), ...Rt('P2 Right', 60, lu.p2Right), A(90, ['P2 Button 1'], 3), A(120, ['P2 Button 1'], 3),
      A(140, ['Coin 3'], 6), A(165, ['3 Players Start'], 6), ...Rt('P3 Right', 195, lu.p3Right), A(225, ['P3 Button 1'], 3), A(255, ['P3 Button 1'], 3),
      A(340, ['attack'], 2),
      A(800, ['right'], 100), A(900, ['up'], 50), A(950, ['down'], 50), A(1000, ['left'], 50), A(1050, ['right'], 60)],
    hook: HOOK(330, [{ n: 1120, v: 0 }]),
    dump: { from: 300, to: frames - 1, every: 1, obj: true, cpsA: true, palette: true, ram: RAM },
    snapshotEvery: { from: 150, to: frames - 1, every: 5 },
  };
}

const PLANS = { jack: () => [solo('jack')], mustapha: () => [solo('mustapha')], '3p': () => LINEUPS.map(lu => three(lu)) };
PLANS.all = () => [...PLANS.jack(), ...PLANS.mustapha(), ...PLANS['3p']()];
const RUN_NAMES = () => PLANS.all().map(p => p.name);
const ARRIVAL_RUNS = ['ex-heroes-car-e2-jack', 'ex-heroes-car-e4-jack'];    // made by heroes-live.cjs (read only)

// =====================================================================================================================
// 2. static decode (every value is read from the ROM at an address whose instruction bytes are checked first)
// =====================================================================================================================
const EVIDENCE = [];
function ins(addr, bytes, what) {
  const b = bytes.replace(/\s+/g, '').toLowerCase(), got = R.prg.slice(addr, addr + b.length / 2).toString('hex');
  if (got !== b) throw new Error(`ROM check failed at ${hex(addr)} (${what}): expected ${b}, found ${got}`);
  EVIDENCE.push({ addr: hex(addr, 5), bytes: b, what });
  return addr;
}
const sb = a => (R.prg[a] < 128 ? R.prg[a] : R.prg[a] - 256);
const disp = (base, type) => R.u32(base + type) & 0xFFFFFF;
const DISPATCH = { A: 0x233F0, B: 0x2346C, C: 0x2362E, D: 0x237E6 };            // V08
function decodeSet(addr, n) {
  return AN.decodeSet(addr, 10, n).map(a => ({ index: a.index, addr: hex(a.addr, 5), loopTo: a.loopTo == null ? null : hex(a.loopTo, 5),
    frames: a.frames.map(f => ({ rec: f.rec, rec2: f.rec2, dur: f.dur, end: f.end })) }));
}

function decodeStatic() {
  EVIDENCE.length = 0;
  const S = {};
  const need = (cond, what) => { if (!cond) throw new Error('static check failed: ' + what); };
  // dispatch tables (V08)
  S.handlers = {
    car: { pool: 'C', type: 0x160, handler: disp(DISPATCH.C, 0x160) },
    seat: { pool: 'D', type: 0x90, handler: disp(DISPATCH.D, 0x90) },
    npcExit: { pool: 'D', type: 0x94, handler: disp(DISPATCH.D, 0x94) },
    puff: { pool: 'D', type: 0xA4, handler: disp(DISPATCH.D, 0xA4) },
    arrivalCar: { pool: 'B', type: 0x40, handler: disp(DISPATCH.B, 0x40) },
    arrivalWheel: { pool: 'B', type: 0x44, handler: disp(DISPATCH.B, 0x44) },
    endingCar: { pool: 'C', type: 0x158, handler: disp(DISPATCH.C, 0x158) },
  };
  need(S.handlers.car.handler === 0x8BDDC && S.handlers.seat.handler === 0x96FF4 && S.handlers.puff.handler === 0x97800 &&
    S.handlers.arrivalCar.handler === 0x420EA && S.handlers.arrivalWheel.handler === 0x423A4 && S.handlers.endingCar.handler === 0x8B428, 'dispatch tables');
  for (const h of Object.values(S.handlers)) { h.type = hex(h.type); h.handler = hex(h.handler, 5); }

  // --- the HELL ROAD car (pool C type 0x160) ---
  const C = S.car = {};
  ins(0x8BE24, '2d7c 0008c8d6 0040', 'car init: animation set +0x40 = 0x8C8D6');
  C.set = R.u32(0x8BE26);
  ins(0x8BE1E, '1d7c 0010 0025', 'car init: +0x25 = 0x10');
  ins(0x8BE2C, '302d 0744 0440 00a0 3d40 0008', 'car init: X = camX - 0xA0 (enters from 160 px left of the camera)');
  C.spawnDx = -R.u16(0x8BE32);
  ins(0x8BE38, '3d7c 0005 000c', 'car init: height +0x0C = 5 (the body rides 5 px above the road)');
  C.bodyHeight = R.u16(0x8BE3A);
  ins(0x8BE3E, '3d7c 0030 0010', 'car init: depth +0x10 = 0x30');
  C.spawnDepth = R.u16(0x8BE40);
  ins(0x8BE44, '4a6e 0026 6700 001c 1d7c 0001 0080 1d7c 0002 00a0 7002 4eb9 0000120e', 'wheels (subtype != 0): +0xA0 steer index 2, start anim 2');
  C.wheelStartAnim = R.prg[0x8BE59]; C.wheelStartIndex = R.prg[0x8BE55];
  ins(0x8BE6A, '7000 4eb9 0000120e 3d7c 0500 0014', 'body: start anim 0, drive in at +0x14 = 0x500 (5 px/frame)');
  C.entrySpeed = R.u16(0x8BE74);
  ins(0x8BE9E, '303c 0078 3d40 006c 3d40 006e 3d7c 0064 006a', 'body: HP +0x6C = 120 (+0x6E = 120, +0x6A = 100)');
  C.hp = R.u16(0x8BEA0); C.hpMaxField = R.u16(0x8BEAC);
  ins(0x8BEF8, '7000 4eb9 00096fd4 7001 4eb9 00096fd4', 'body: spawn seat objects 0 and 1 (0x96FD4)');
  ins(0x8BF08, '4a2d 04cf 6600 000a 7002 4eb9 00096fd4', 'body: spawn seat object 2 unless 0xFF84CF is set');
  ins(0x8BF2A, '302d 0744 0640 0080 b06e 0008 6c00 0014 7001 4eb9 0000120e 3d7c ffd0 001a', 'entry: past camX + 0x80 start anim 1 (brake) with ax = -0x30');
  C.entryBrakeX = R.u16(0x8BF30); C.entryBrakeAx = R.s16(0x8BF44);
  ins(0x8BF58, '4a6e 0014 6a00 0042 7000 4eb9 0000120e 426e 0014', 'entry: when the speed goes negative: anim 0, speed 0 (stopped)');
  ins(0x8C06E, '1b7c 0001 0518 1d7c 0066 0058', 'boarding done: Cadillac mode 0xFF8518 = 1, ram attack id +0x58 = 0x66');
  C.ramAttackId = R.prg[0x8C077];
  ins(0x8C784, '7000 4a2d 3274', 'NPC driver: +0xA2 = the lowest character id no player uses');
  // target speed: per player stick direction (+0xA0 & 15, bits R1 L2 D4 U8) -> table offset 0x8C886 -> (dvx, dvd) words
  ins(0x8C2E0, '3d7c 0800 00b0 426e 00b2', 'no input: target speed +0xB0 = 0x800 (8 px/frame), depth speed 0');
  ins(0x8C352, '117c 003d 0119', 'a press sets the player +0x119 = 61 frames (selects the second speed table)');
  ins(0x8C364, '43fa 0520', 'lea 0x8C886: direction -> table offset');
  ins(0x8C36C, '43fa 0548', 'lea 0x8C8B6: speed table');
  ins(0x8C378, '43fa 051c', 'lea 0x8C896: speed table while +0x119 runs');
  ins(0x8C396, '066e 0800 00b0', 'target speed = 0x800 + the table dvx');
  C.cruise = R.u16(0x8C398);
  const dirOff = [...R.prg.slice(0x8C886, 0x8C896)];
  const tbl = a => Array.from({ length: 8 }, (_, k) => [R.s16(a + k * 4), R.s16(a + k * 4 + 2)]);
  C.speedTable = tbl(0x8C8B6); C.speedTable2 = tbl(0x8C896);
  C.speedTablesIdentical = JSON.stringify(C.speedTable) === JSON.stringify(C.speedTable2);
  const DIRS = { R: 1, L: 2, D: 4, U: 8, RD: 5, RU: 9, LD: 6, LU: 10 };
  C.targetByInput = { none: [C.cruise, 0] };
  for (const [k, bits] of Object.entries(DIRS)) { const e = C.speedTable[dirOff[bits] / 4]; C.targetByInput[k] = [C.cruise + e[0], e[1]]; }
  ins(0x8C2F4, '0c06 0002 6600 001a', 'two players steering: the summed target is halved');
  ins(0x8C314, '0c06 0003 6600 002a', 'three players: x 6/16');
  ins(0x8C20A, '3d6e 00b2 0018 302e 00b0 906e 0014 0640 0020 0c40 0040', 'depth speed = target; speed snaps when within 0x20 of the target');
  ins(0x8C230, '046e 0030 0014', 'speed -0x30 per frame toward the target');
  ins(0x8C238, '066e 0030 0014', 'speed +0x30 per frame toward the target');
  C.accel = R.u16(0x8C232); C.snap = R.u16(0x8C21A);
  ins(0x8C4B6, '7000 322e 00b0 0641 0080 b26e 0014 6c00 0004 7001 4ef9 0000120e', 'body anim: 1 (brake pose) while speed > target + 0x80, else 0');
  C.brakeMargin = R.u16(0x8C4BE);
  // bumps
  ins(0x8C41C, '3d7c 0005 000c 302e 00ae 6700 0016 7200 123b 00d6', 'height = 5 + bump table 0x8C404[+0xAE countdown]');
  C.bumpTable = Array.from({ length: 24 }, (_, k) => sb(0x8C404 + k));
  ins(0x8C452, '0c6e 0014 006c 6500 004c', 'no random bumps while HP < 20');
  ins(0x8C482, '532e 00a9 6400 0024 4eb9 0000119c 0240 000f', 'random bump: every rand(16) frames');
  ins(0x8C498, '4eb9 0000119c 0240 0001 6600 0008 3d7c 000f 00ae', '... with a 50% chance a 15-frame bump (+0xAE = 15)');
  C.bumpFrames = R.u16(0x8C4A8);
  ins(0x8C4AE, '3d7c 0018 00ae 4e75', 'a 24-frame bump entry (no caller found inside the car handler)');
  // wheels
  ins(0x8C4E6, '3d68 0008 0008 3d68 0010 0010 526e 0010 426e 000c', 'wheel: X / depth of the body, depth + 1, height 0');
  ins(0x8C4FA, '0c6e 0002 0026 6700 000c 046e 004b 0008 6000 0008 066e 004c 0008', 'wheel: subtype 2 at X + 0x4C (front), subtype 4 at X - 0x4B (rear)');
  C.frontWheelDx = R.u16(0x8C510); C.rearWheelDx = -R.u16(0x8C506);
  ins(0x8C514, '4a68 0014 6700 001a 4eb9 0000121e', 'wheel anims tick only while the body moves');
  ins(0x8C526, '4eb9 0000119c 0240 0001 3d40 000c', 'moving wheels jitter: height = rand(2)');
  ins(0x8C534, '0c6e 0002 0026 6600 008e', 'only the front wheel steers');
  ins(0x8C556, '552e 0080', 'no depth speed: the steer index relaxes toward 2 (timer -2 per frame)');
  ins(0x8C580, '532e 0080', 'depth speed: the steer index moves (timer -1 per frame)');
  ins(0x8C588, '4a6e 0018 6a00 0012', 'depth speed < 0 (toward the viewer): index - 1 (min 0); > 0 (away): index + 1 (max 4)');
  ins(0x8C5A4, '0c2e 0005 00a0 6500 0008 1d7c 0004 00a0', 'steer index clamp 4');
  ins(0x8C5B4, '7000 102e 00a0 103b 0010 4eb9 0000120e 1d7c 000c 0080', 'wheel anim = 0x8C5CC[index]; next step after 12 timer units');
  C.steerAnims = [...R.prg.slice(0x8C5CC, 0x8C5D1)]; C.steerStep = R.prg[0x8C5C7];
  // dust from the wheels (pool D type 0xA4, palette override 0x8E)
  ins(0x8C5D2, '306e 0076 0c68 0300 0014 6500 0030 7007 0c68 0800 0014 6400 0004 700f', 'dust: speed >= 0x300; every 8 frames at >= 0x800, else every 16');
  ins(0x8C5F8, '302e 0008 322e 000c 342e 0010 5942 7600 4ef9 000977d2', 'dust puff at the wheel (X, height, depth - 4), kind 0 (dust)');
  C.dust = { minSpeed: R.u16(0x8C5D8), fastSpeed: R.u16(0x8C5E4), fastEvery: R.prg[0x8C5E1] + 1, slowEvery: R.prg[0x8C5ED] + 1, depth: -4 };
  // damage
  ins(0x8C3A6, '302d 0000 0240 0007 6600 0052 0c6e 003c 006c', 'smoke: every 8 main-loop passes while HP < 60');
  ins(0x8C3BC, '302e 0008 0640 0040 322e 000c 0641 0020 342e 0010 5942 7601', '... a smoke puff at (X + 64, height + 32, depth - 4)');
  ins(0x8C3DA, '0c6e 001e 006c 6400 0020 302e 0008 0440 0020 322e 000c 0641 0010', '... and below 30 a second one at (X - 32, height + 16)');
  C.smoke = { every: R.u16(0x8C3AC) + 1, below: R.u16(0x8C3B4), at: [R.u16(0x8C3C2), R.u16(0x8C3CA)], below2: R.u16(0x8C3DC), at2: [-R.u16(0x8C3EA), R.u16(0x8C3F2)], depth: -4 };
  ins(0x8C19E, '0c6e 001e 006c 6400 0006 542e 0006', 'HP < 30: damaged state (+0x06 = 2)');
  ins(0x8C1AE, '422e 0023 522e 0080 022e 001f 0080 0c2e 0002 0080 6400 0008 1d7c 0084 0023', 'damaged: palette override 0x84 (slot 4) on 2 of every 32 frames');
  C.flash = { below: R.u16(0x8C1A0), period: R.prg[0x8C1B9] + 1, frames: R.prg[0x8C1BF], override: R.prg[0x8C1C9], slot: R.prg[0x8C1C9] & 31 };
  ins(0x8C1CC, '4a6e 006c 6600 0016', 'HP 0 -> wreck');
  ins(0x8C1E0, '2d7c 04000000 0004', 'wreck: state 4');
  ins(0x8C1EA, '1d7c 0084 0023 532e 0059', 'hit flinch: override 0x84 while the hit-stop +0x59 counts down');
  ins(0x8C158, '0c6d a000 0744', 'camX >= 0xA000 (end of the road): HP 0');
  C.roadEnd = R.u16(0x8C15A);
  // wreck: state 4.0 then 4.2
  ins(0x8C832, '422e 0023 70ff 1d40 00a2 1d40 00a3 1d40 00a4', 'wreck: palette restored, seats emptied');
  ins(0x8C852, '422d 0516 422d 0518', 'wreck: Cadillac mode off');
  ins(0x8C744, '302d 0744 0640 0080', 'riders thrown out toward camX + 0x80');
  ins(0x8C754, '0640 0020', '... + 0x20 for player 2');
  ins(0x8C762, '0640 0020 3d40 0088 3d7c 0030 008a 1d7c 0002 0000 1d7c 0078 00f9', '... + 0x20 more for player 3, depth target 0x30, 120 frames of invulnerability');
  C.wreck = { ejectX: R.u16(0x8C74A), ejectStep: R.u16(0x8C756), ejectDepth: R.u16(0x8C76C), invuln: R.prg[0x8C779] };
  ins(0x8C868, '302d 0744 0640 0200 b06e 0008 6400 0008 3d7c 0600 0004', 'wreck: once X > camX + 0x200 the car is removed (state 6)');
  C.wreck.exitX = R.u16(0x8C86E);
  ins(0x8C7D6, '302e 0008 906d 0744 0440 0030 6b00 000a 0440 0110', 'the car is kept inside screen X 48..320');
  ins(0x8C7F2, '302e 0010 906d 0748 0440 0010 6b00 000a 0440 0040', '... and depth camY + 16..80');
  C.clampX = [R.u16(0x8C7E0), R.u16(0x8C7E0) + R.u16(0x8C7E8)]; C.clampDepth = [R.u16(0x8C7FC), R.u16(0x8C7FC) + R.u16(0x8C804)];
  C.anims = decodeSet(C.set, 7);
  need(C.anims[0].frames[0].rec === 1097 && C.anims[1].frames[0].rec === 1098 && C.anims[6].frames[1].rec === 1112, 'car animation set');

  // --- seat objects (pool D type 0x90) ---
  const Sx = S.seat = {};
  ins(0x96FD4, '4eb9 00004884 6500 0016 117c 0001 0000 317c 0090 0020 314e 0058 3140 0026', 'seat spawner: pool D type 0x90, +0x58 = the car, subtype = seat');
  ins(0x97008, '2d7c 00097150 0040', 'seat: animation set 0x97150');
  Sx.set = R.u32(0x9700A);
  ins(0x9702A, '0c6e 0002 0026 6600 0008 1d7c 0001 0024', 'seat 2 (back seat) is mirrored');
  ins(0x9704E, '43fa 00a6', 'lea 0x970F6: per-seat (dX, height, depth) from the car');
  Sx.offsets = [0, 1, 2].map(k => ({ sub: k, dx: R.s16(0x970F6 + k * 6), dh: R.s16(0x970F8 + k * 6), dd: R.s16(0x970FA + k * 6) }));
  ins(0x97136, 'd040 0c6e 0002 0026 6600 0004 5200 4ef9 000015e4', 'seat anim = 2 * character id (+1 for the back seat)');
  ins(0x970EA, '4eb9 000015f4 4ef9 000049c0', 'an occupied seat ticks its anim and registers for drawing');
  ins(0x18A3E, '4a2d 0518 6600 002c', 'player handler: no draw while Cadillac mode is on');
  Sx.anims = decodeSet(Sx.set, 8);
  need(Sx.offsets[0].dh === 33 && Sx.offsets[2].dx === -59 && Sx.anims[0].frames[0].rec === 2700 && Sx.anims[7].frames[0].rec === 644, 'seat table');
  ins(0x971E0, '117c 0001 0000 317c 0094 0020', 'the NPC who drove the car in leaves as pool D type 0x94');

  // --- dust / smoke puffs (pool D type 0xA4) ---
  const P = S.puff = {};
  ins(0x977D2, '4eb9 00004884 6524 117c 0001 0000 317c 00a4 0020', 'puff spawner: pool D type 0xA4');
  ins(0x977F2, '4a03 6600 0008 117c 008e 0023', 'kind 0 (dust): palette override 0x8E (slot 14); kind 1 (smoke): the record palette');
  P.dustOverride = R.prg[0x977FB]; P.dustSlot = P.dustOverride & 31;
  ins(0x97814, '2d7c 0009786e 0040', 'puff: animation set 0x9786E');
  P.set = R.u32(0x97816);
  ins(0x9782A, '4eb9 0000119c 0240 0018 41fa 0098', 'puff velocity: random entry of 0x978CE');
  P.velocity = Array.from({ length: 4 }, (_, k) => [R.u32(0x978CE + k * 8) / 65536, R.u32(0x978D2 + k * 8) / 65536]);
  P.anims = decodeSet(P.set, 1);

  // --- the arrival car of the EPISODE 2 / 4 starts (pool B type 0x40) and its wheels (type 0x44) ---
  const V = S.arrival = {};
  ins(0x42124, '2d7c 00042386 0040', 'arrival car: animation set 0x42386');
  V.set = R.u32(0x42126);
  ins(0x42154, '317c 0044 0020', 'arrival car: wheel objects pool B type 0x44');
  ins(0x421F6, '3d7c 0500 0014', 'arrival car: drives in at 5 px/frame');
  ins(0x42268, '3d7c ffa0 001a 7001 4eb9 0000120e', 'arrival car: brakes at -0x60 with anim 1');
  V.speed = R.u16(0x421F8); V.brakeAx = R.s16(0x4226A);
  ins(0x423C4, '2d7c 00042516 0040', 'arrival wheel: animation set 0x42516');
  V.wheelSet = R.u32(0x423C6);
  ins(0x423E8, '0440 0002', 'arrival wheel: height = car height - 2');
  ins(0x4241C, '0640 0002', 'arrival wheel: depth + 2');
  ins(0x42430, '0640 004d', 'arrival wheel 0: X + 0x4D');
  ins(0x42440, '0440 004b', 'arrival wheel 1: X - 0x4B');
  V.frontWheelDx = R.u16(0x42432); V.rearWheelDx = -R.u16(0x42442); V.wheelDepth = R.u16(0x4241E); V.wheelHeight = -R.u16(0x423EA);
  V.anims = decodeSet(V.set, 2); V.wheelAnims = decodeSet(V.wheelSet, 5);
  need(V.anims[0].frames[0].rec === 3391 && V.wheelAnims[0].frames[0].rec === 1099, 'arrival car sets');

  // --- the ending car (pool C type 0x158) ---
  const E = S.ending = {};
  ins(0x8B45E, '2d7c 0008b5e6 0040 7000 4eb9 0000120e 3d7c 0c00 0014', 'ending car: set 0x8B5E6, anim 0, 12 px/frame');
  E.set = R.u32(0x8B460); E.speed = R.u16(0x8B470);
  ins(0x8B526, '3d7c 0830 0014', 'ending car: then 0x830');
  E.speed2 = R.u16(0x8B528);
  ins(0x8B496, '317c 0044 0020', 'ending car: the same wheel objects (pool B type 0x44)');
  E.anims = decodeSet(E.set, 2);
  need(E.anims[0].frames[0].rec === 3489 && E.anims[0].frames[1].rec === 3490, 'ending car set');

  for (const o of [C, Sx, P, V, E]) for (const k of ['set', 'wheelSet']) if (typeof o[k] === 'number') o[k] = hex(o[k], 5);
  S.evidence = EVIDENCE.slice();
  return S;
}

// =====================================================================================================================
// 3. records: parse with the draw rules (uniform-attribute records take size/flip/palette from the flags word), render
// =====================================================================================================================
function recParts(rec) {
  const r = R.parseRecord(rec); if (!r) return null;
  const uni = !(r.flags & 0x8000);
  return r.blocks.map((b, k) => {
    const attr = uni ? r.flags : b.attr;
    return { code: b.code, bw: ((attr >> 8) & 15) + 1, bh: ((attr >> 12) & 15) + 1, flipX: !!(attr & 0x20), flipY: !!(attr & 0x40), pal: attr & 31, x: r.offs[k].x, y: r.offs[k].y };
  });
}
// indexed image: slot (palette) and pen per pixel, pen 15 = transparent; block 0 ends on top
function recImage(rec) {
  const parts = recParts(rec); if (!parts || !parts.length) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of parts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.bw * 16); y1 = Math.max(y1, p.y + p.bh * 16); }
  const w = x1 - x0, h = y1 - y0, pen = new Uint8Array(w * h).fill(15), slot = new Uint8Array(w * h);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    for (let r = 0; r < p.bh; r++) for (let c = 0; c < p.bw; c++) {
      const col = p.flipX ? p.bw - 1 - c : c, row = p.flipY ? p.bh - 1 - r : r;
      const t = R.tile((p.code & ~0xF) + ((p.code + col) & 0xF) + 0x10 * row);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const v = t[(p.flipY ? 15 - y : y) * 16 + (p.flipX ? 15 - x : x)]; if (v === 15) continue;
        const q = (p.y - y0 + r * 16 + y) * w + (p.x - x0 + c * 16 + x); pen[q] = v; slot[q] = p.pal;
      }
    }
  }
  let opaque = 0; for (let q = 0; q < w * h; q++) if (pen[q] !== 15) opaque++;
  return { rec, w, h, ox: -x0, oy: -y0, pen, slot, opaque, pals: [...new Set(parts.map(p => p.pal))].sort((a, b) => a - b) };
}
// OBJ blocks the draw code writes for a record at a feet point (V04); facing != 0 mirrors
function recBlocks(rec, feetX, feetY, facing, palOverride) {
  return (recParts(rec) || []).map(p => ({ code: p.code, bw: p.bw, bh: p.bh, flipX: facing ? !p.flipX : p.flipX, pal: palOverride != null ? palOverride : p.pal,
    sx: facing ? feetX - p.x - 16 * p.bw : feetX + p.x, sy: feetY + p.y }));
}
// palette rows: ROM row k at 0xB7A52 + k*32 (16 words, RGB444); MAME colour = n * 0x11 * (0x0F + 2B) / 0x2D
const rowWords = k => Array.from({ length: 16 }, (_, i) => R.u16(R.PAL_TABLE + k * 32 + i * 2));
const wordRGB = w => { const br = 0x0F + ((w >> 12) << 1); return [((w >> 8) & 15) * 0x11 * br / 0x2D | 0, ((w >> 4) & 15) * 0x11 * br / 0x2D | 0, (w & 15) * 0x11 * br / 0x2D | 0]; };
const rowRGB24 = k => rowWords(k).map(w => { const c = wordRGB(w | 0xF000); return (c[0] << 16) | (c[1] << 8) | c[2]; });
let ROW_INDEX = null;
function rowsOf(words12) {
  if (!ROW_INDEX) { ROW_INDEX = new Map(); for (let k = 0; R.PAL_TABLE + k * 32 + 32 <= R.prg.length && k < 0x800; k++) { const key = rowWords(k).map(w => w & 0xFFF).join(','); if (!ROW_INDEX.has(key)) ROW_INDEX.set(key, []); ROW_INDEX.get(key).push(k); } }
  return ROW_INDEX.get(words12.map(w => w & 0xFFF).join(',')) || [];
}

// =====================================================================================================================
// 4. live analysis
// =====================================================================================================================
// stream a run's frames.jsonl: cb(frame) with RAM ranges decoded to Buffers (frame.mem = [[addr, Buffer]])
function eachFrame(run, cb) {
  const file = path.join(RUNS, run, 'frames.jsonl');
  const text = fs.readFileSync(file, 'utf8');
  let p = 0;
  while (p < text.length) {
    let e = text.indexOf('\n', p); if (e < 0) e = text.length;
    if (e > p) {
      const fr = JSON.parse(text.slice(p, e));
      if (fr.ram) fr.mem = Object.entries(fr.ram).map(([k, v]) => [parseInt(k, 16), Buffer.from(v, 'hex')]);
      delete fr.ram; cb(fr);
    }
    p = e + 1;
  }
}
function memOf(fr) {
  const find = a => { for (const [s, b] of fr.mem || []) if (a >= s && a < s + b.length) return [b, a - s]; return null; };
  const rd = (a, fn) => { const f = find(a); if (!f) throw new Error('address not dumped ' + hex(a)); return fn(f[0], f[1]); };
  return { b: a => rd(a, (b, o) => b[o]), sb: a => rd(a, (b, o) => b.readInt8(o)), w: a => rd(a, (b, o) => b.readUInt16BE(o)), sw: a => rd(a, (b, o) => b.readInt16BE(o)), l: a => rd(a, (b, o) => b.readUInt32BE(o)), has: a => !!find(a) };
}
const frameRec = fp => { if (!fp || fp + 4 > R.prg.length) return { rec: null, rec2: null }; const w0 = R.u16(fp), w1 = R.u16(fp + 2); return { rec: w0 & 0x8000 ? null : w0 >> 2, rec2: (w0 & 0x8000) || (w1 & 0x8000) ? null : w1 >> 2 }; };
function actor(m, a) {
  const fp = m.l(a + 0x28), r = frameRec(fp);
  return { a, s0: m.b(a), drawn: m.b(a + 1), state: [4, 5, 6, 7].map(k => m.b(a + k)), type: m.w(a + 0x20), sub: m.w(a + 0x26), x: m.sw(a + 8), h: m.sw(a + 0xC), d: m.sw(a + 0x10),
    vx: m.sw(a + 0x14), vd: m.sw(a + 0x18), pal: m.b(a + 0x23), face: m.b(a + 0x24), fp, rec: r.rec, rec2: r.rec2 };
}
// the car objects, seats, puffs and players of one RAM frame
function scene(m) {
  const S = { car: null, wheels: {}, seats: [], puffs: [], players: [], cam: [m.sw(0xFF8744), m.sw(0xFF8748)], cad: m.b(0xFF8518), loop: m.has(0xFF8000) ? m.w(0xFF8000) : null };
  for (let k = 0; k < 24; k++) {
    const a = 0xFFB6F4 + k * 0xC0; if (!m.b(a) || m.w(a + 0x20) !== 0x160) continue;
    const o = actor(m, a);
    if (o.sub === 0) { o.hp = m.sw(a + 0x6C); o.target = m.sw(a + 0xB0); o.seat = [0xA2, 0xA3, 0xA4].map(q => m.sb(a + q)); o.timer80 = m.b(a + 0x80); S.car = o; } else { o.steer = m.b(a + 0xA0); S.wheels[o.sub] = o; }
  }
  for (let k = 0; k < 48; k++) {
    const a = 0xFF9A74 + k * 0x80; if (!m.b(a)) continue;
    const t = m.w(a + 0x20);
    if (t === 0x90) { const o = actor(m, a); o.car = 0xFF0000 | m.w(a + 0x58); S.seats.push(o); }
    else if (t === 0xA4) S.puffs.push(actor(m, a));
  }
  for (let p = 0; p < 3; p++) { const a = 0xFFB274 + p * 0x180; if (m.b(a)) S.players.push({ p: p + 1, id: m.b(a + 3), state: [4, 5, 6, 7].map(k => m.b(a + k)), x: m.sw(a + 8), h: m.sw(a + 0xC), d: m.sw(a + 0x10), drawn: m.b(a + 1) }); }
  return S;
}
const snapFile = (run, f) => path.join(RUNS, run, `snap-f${String(f).padStart(6, '0')}.png`);
const wrap = v => ((v + 256) & 511) - 256;                                      // OBJ X / Y are 9-bit
const feetOf = (o, cam) => [o.x - cam[0], cam[1] - (o.d + o.h) + 240];        // V05
const onScreen = p => p.sx < 384 && p.sx + 16 * p.bw > 0 && p.sy < 224 && p.sy + 16 * p.bh > 0;
// match predicted blocks against the OBJ list: exact, else the best common (dx, dy) shift within +-1 px
function matchBlocks(obj, blocks) {
  blocks = blocks.filter(onScreen);
  if (!blocks.length) return null;
  const find = (p, dx, dy) => obj.find(e => e.code === p.code && e.bw === p.bw && e.bh === p.bh && e.flipX === p.flipX && e.pal === p.pal && ((e.sx - p.sx - dx) & 511) === 0 && ((e.sy - p.sy - dy) & 511) === 0);
  let best = null;
  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
    const hit = blocks.filter(p => find(p, dx, dy)).length;
    if (!best || hit > best.hit) best = { dx, dy, hit, of: blocks.length };
    if (hit === blocks.length) break;
  }
  return best;
}

function analyseRun(run) {
  const ST = { run, frames: 0, carFrames: 0, kinds: {}, model: {}, seatsSeen: {}, timing: {}, speeds: {}, palettes: {}, events: [] };
  const kind = k => ST.kinds[k] || (ST.kinds[k] = { objects: 0, exact: 0, within1: 0, partial: 0, absent: 0, maxErr: 0, records: {}, fails: [] });
  const model = k => ST.model[k] || (ST.model[k] = { frames: 0, maxErr: 0, errHist: {}, offsets: {} });
  const T = ST.timing;
  T.wheelRuns = {}; T.bodyAnim = { agree: 0, of: 0, disagree: [] }; T.steer = { steps: [], wrongRec: 0, of: 0 }; T.flash = { overrideFrames: 0, damagedFrames: 0, pattern: {} };
  T.puffSpawns = { dust: [], smoke: [] }; T.puffOffsets = { dust: {}, smoke: {} }; T.wreck = null;
  let prev = null, prevScene = null, wheelPrev = {}, steerPrev = null, puffSeen = new Set();
  eachFrame(run, fr => {
    ST.frames++;
    if (!fr.mem) return;
    const m = memOf(fr), sc = scene(m);
    // palettes (live OBJ slots matched back to ROM rows)
    if (fr.pal) for (const s of [0, 1, 2, 3, 4, 11, 12, 14, 19, 28, 29]) {
      const ws = Array.from({ length: 16 }, (_, i) => parseInt(fr.pal.substr((s * 16 + i) * 4, 4), 16));
      const rows = rowsOf(ws), key = s + ':' + (rows.length ? rows[0] : '?');
      ST.palettes[key] = (ST.palettes[key] || 0) + 1;
    }
    // OBJ prediction: OBJ dump f is built from RAM f-1 (H04)
    if (prev && prevScene && prevScene.car && fr.obj) {
      const P = prevScene, cam = P.cam, car = P.car;
      ST.carFrames++;
      const parts = [];
      if (car.rec != null) parts.push({ k: 'body', o: car, rec: car.rec });
      for (const sub of [2, 4]) { const w = P.wheels[sub]; if (w && w.rec != null) parts.push({ k: sub === 2 ? 'frontWheel' : 'rearWheel', o: w, rec: w.rec }); }
      for (const s of P.seats) { if (s.car !== car.a) continue; const occ = car.seat[s.sub]; if (occ < 0 || s.rec == null) continue; parts.push({ k: 'seat' + s.sub, o: s, rec: s.rec, who: HEROES[occ] }); }
      for (const p of P.puffs) if (p.rec != null) parts.push({ k: p.pal === 0x8E ? 'dust' : 'smoke', o: p, rec: p.rec });
      const origin = {};
      for (const pt of parts) {
        const [fx, fy] = feetOf(pt.o, cam), ov = pt.o.pal & 0x80 ? pt.o.pal & 31 : null;
        const mt = matchBlocks(fr.obj, recBlocks(pt.rec, fx, fy, pt.o.face, ov));
        if (!mt) continue;                                               // culled
        const K = kind(pt.k); K.objects++; K.records[pt.rec] = (K.records[pt.rec] || 0) + 1;
        if (mt.hit === mt.of) { if (!mt.dx && !mt.dy) K.exact++; else K.within1++; K.maxErr = Math.max(K.maxErr, Math.abs(mt.dx), Math.abs(mt.dy)); origin[pt.k] = [fx + mt.dx, fy + mt.dy]; }
        else if (mt.hit) { K.partial++; if (K.fails.length < 6) K.fails.push({ f: fr.f, rec: pt.rec, hit: mt.hit, of: mt.of }); }
        else { K.absent++; if (K.fails.length < 6) K.fails.push({ f: fr.f, rec: pt.rec, hit: 0, of: mt.of }); }
        if (pt.who) { const key = `${pt.k}:${pt.who}:${pt.rec}`; ST.seatsSeen[key] = (ST.seatsSeen[key] || 0) + 1; }
      }
      // model: the shipped offsets reproduce the parts' screen origins from the body origin (OBJ-derived)
      const B = origin.body;
      if (B) {
        const bump = car.h - CAR_MODEL.bodyHeight;
        const want = {
          frontWheel: P.wheels[2] && [CAR_MODEL.frontWheel[0], CAR_MODEL.frontWheel[1] + bump - P.wheels[2].h],
          rearWheel: P.wheels[4] && [CAR_MODEL.rearWheel[0], CAR_MODEL.rearWheel[1] + bump - P.wheels[4].h],
          seat0: CAR_MODEL.seats[0], seat1: CAR_MODEL.seats[1], seat2: CAR_MODEL.seats[2],
        };
        for (const [k, w] of Object.entries(want)) {
          if (!w || !origin[k]) continue;
          const got = [origin[k][0] - B[0], origin[k][1] - B[1]], err = Math.max(Math.abs(got[0] - w[0]), Math.abs(got[1] - w[1]));
          const M = model(k); M.frames++; M.maxErr = Math.max(M.maxErr, err); M.errHist[err] = (M.errHist[err] || 0) + 1;
          const raw = k.startsWith('seat') ? got.join(',') : `${got[0]},${got[1] - bump + (k === 'frontWheel' ? P.wheels[2].h : P.wheels[4].h)}`;
          M.offsets[raw] = (M.offsets[raw] || 0) + 1;
        }
        if (bump) { const M = model('bob'); M.frames++; M.offsets[bump] = (M.offsets[bump] || 0) + 1; }
      }
      // pixel samples for the compare images: every 50th car frame (and the first flash / wreck frames)
      const special = (car.pal === 0x84 && !ST._flashSample) || (car.state[0] === 4 && !ST._wreckSample) || (P.wheels[2] && P.wheels[2].steer !== 2 && !ST._steerSample);
      if (SAMPLE_ON && (special || fr.f - (ST._lastSample || -1e9) >= 150) && origin.body && fs.existsSync(snapFile(run, fr.f + 1))) {
        if (car.pal === 0x84) ST._flashSample = true; if (car.state[0] === 4) ST._wreckSample = true; if (P.wheels[2] && P.wheels[2].steer !== 2) ST._steerSample = true;
        ST._lastSample = fr.f; SAMPLES.push({ run, f: fr.f, scene: P, pal: fr.pal, obj: fr.obj, origin });
      }
    }
    // timing (RAM only)
    if (sc.car) {
      const car = sc.car;
      // body anim rule: 1098 while speed > target + 0x80 (cruise states only; the anim lags the rule by one frame)
      if (car.state[0] === 2 && car.state[1] === 0) {
        const want = car.vx > car.target + CAR_MODEL.brakeMargin ? 1098 : 1097;
        T.bodyAnim.of++; if (car.rec === want) T.bodyAnim.agree++; else if (T.bodyAnim.disagree.length < 5) T.bodyAnim.disagree.push({ f: fr.f, rec: car.rec, vx: car.vx, target: car.target });
      }
      // speeds per steady target
      if (car.state[0] === 2 && car.state[1] === 0) { const key = `${car.target}/${car.vd}`; const sp = ST.speeds[key] || (ST.speeds[key] = { frames: 0, vx: {} }); sp.frames++; sp.vx[car.vx] = (sp.vx[car.vx] || 0) + 1; }
      // wheel frames: run length of each wheel record while the car moves
      for (const sub of [2, 4]) {
        const w = sc.wheels[sub]; if (!w) continue;
        const wp = wheelPrev[sub];
        if (wp && wp.rec === w.rec && car.vx) wp.n++;
        else { if (wp && wp.n && wp.moving) T.wheelRuns[wp.n] = (T.wheelRuns[wp.n] || 0) + 1; wheelPrev[sub] = { rec: w.rec, n: 1, moving: !!car.vx }; }
      }
      // steering: front-wheel index steps and the record set it shows
      const fw = sc.wheels[2];
      if (fw) {
        const want = CAR_MODEL.steer[fw.steer] || [];
        T.steer.of++; if (!want.includes(fw.rec)) T.steer.wrongRec++;
        if (steerPrev && fw.steer !== steerPrev.steer) T.steer.steps.push({ f: fr.f, from: steerPrev.steer, to: fw.steer, after: fr.f - steerPrev.since, vd: car.vd });
        if (!steerPrev || fw.steer !== steerPrev.steer) steerPrev = { steer: fw.steer, since: fr.f };
      }
      // flash: palette override frames while damaged (+0x06 = 2)
      if (car.state[0] === 2 && car.state[2] === 2) { T.flash.damagedFrames++; if (car.pal === 0x84) { T.flash.overrideFrames++; const ph = car.timer80 & 31; T.flash.pattern[ph] = (T.flash.pattern[ph] || 0) + 1; } }
      // wreck
      if (car.state[0] === 4 && !T.wreck) T.wreck = { f: fr.f, x: car.x, camX: sc.cam[0], vx: car.vx, rec: car.rec, seats: car.seat.slice() };
      if (T.wreck && !T.wreck.removedAt && prevScene && prevScene.car && car.state[0] === 4) { T.wreck.lastX = car.x; T.wreck.lastCamX = sc.cam[0]; T.wreck.lastRec = car.rec; T.wreck.lastVx = car.vx; }
    } else if (T.wreck && !T.wreck.removedAt && prevScene && prevScene.car) { T.wreck.removedAt = fr.f; T.wreck.players = sc.players.map(p => ({ p: p.p, id: HEROES[p.id], x: p.x, h: p.h, state: p.state.join('.') })); }
    // puff spawn intervals: a new type-0xA4 object (new slot address / first anim frame)
    for (const p of sc.puffs) {
      const key = p.a.toString(16);
      if (p.rec === 2165 && !puffSeen.has(key)) {
        puffSeen.add(key); (p.pal === 0x8E ? T.puffSpawns.dust : T.puffSpawns.smoke).push(fr.f);
        // spawn offset: the puff has drifted one tick (+1 px in X) since the car / wheel update that spawned it this frame
        if (sc.car && p.pal !== 0x8E) { const k = `${p.x - 1 - sc.car.x},${p.d - sc.car.d}`; T.puffOffsets.smoke[k] = (T.puffOffsets.smoke[k] || 0) + 1; }
        if (p.pal === 0x8E) { const w = [sc.wheels[2], sc.wheels[4]].filter(Boolean).map(q => [p.x - 1 - q.x, p.d - q.d]).sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]))[0]; if (w) { const k = w.join(','); T.puffOffsets.dust[k] = (T.puffOffsets.dust[k] || 0) + 1; } }
      }
      if (p.rec !== 2165) puffSeen.delete(key);
    }
    prev = fr; prevScene = sc;
  });
  // summarise puff intervals
  for (const k of ['dust', 'smoke']) { const f = T.puffSpawns[k], d = {}; for (let i = 1; i < f.length; i++) { const g = f[i] - f[i - 1]; if (g <= 32) d[g] = (d[g] || 0) + 1; } T.puffSpawns[k] = { count: f.length, intervals: d }; }
  T.steer.steps = { count: T.steer.steps.length, afterFrames: T.steer.steps.reduce((o, s) => (o[s.after] = (o[s.after] || 0) + 1, o), {}), sample: T.steer.steps.slice(0, 8) };
  for (const k of ['_flashSample', '_wreckSample', '_steerSample', '_lastSample']) delete ST[k];
  return ST;
}

// EPISODE 2 / 4 starts (heroes runs): the arrival car (pool B, not dumped) is found in the OBJ list by its records;
// the seated hero (P1 in main:29, drawn by the hero object) is predicted from RAM. Checks the seat and wheel offsets.
function analyseArrival(run) {
  const ST = { run, frames: 0, carFrames: 0, seat: { frames: 0, offsets: {}, firstFrame: {} }, wheels: { offsets: {} }, bodyRecs: {} };
  let prev = null;
  const bodyRecs = [3391, 3392], wheelRecs = [1099, 1100, 1102, 1103, 1105, 1106, 1108, 1109, 1111, 1112];
  const originOf = (obj, rec) => {
    const parts = recParts(rec), b0 = parts.reduce((a, p) => (p.bw * p.bh > a.bw * a.bh ? p : a));
    const out = [];
    for (const e of obj) {
      if (e.code !== b0.code || e.bw !== b0.bw || e.bh !== b0.bh || e.flipX !== b0.flipX) continue;
      const fx = e.sx - b0.x, fy = e.sy - b0.y;
      const blocks = recBlocks(rec, fx, fy, 0, null).filter(onScreen);
      const hit = blocks.filter(p => obj.some(q => q.code === p.code && q.bw === p.bw && q.bh === p.bh && q.flipX === p.flipX && ((q.sx - p.sx) & 511) === 0 && ((q.sy - p.sy) & 511) === 0)).length;
      if (hit === blocks.length) out.push([fx, fy]);
    }
    return out;
  };
  eachFrame(run, fr => {
    ST.frames++;
    if (prev && prev.mem && fr.obj) {
      const m = memOf(prev);
      let body = null, brec = null;
      for (const r of bodyRecs) { const o = originOf(fr.obj, r); if (o.length) { body = o[0]; brec = r; break; } }
      if (body) {
        ST.carFrames++; ST.bodyRecs[brec] = (ST.bodyRecs[brec] || 0) + 1;
        const P1 = 0xFFB274, fp = m.l(P1 + 0x28), r = frameRec(fp);
        if (r.rec != null && [2696, 2697, 2698, 2699, 2700, 2701].includes(r.rec) && m.b(P1 + 1)) {
          const cam = [m.sw(0xFF8744), m.sw(0xFF8748)], hx = m.sw(P1 + 8) - cam[0], hy = cam[1] - (m.sw(P1 + 0x10) + m.sw(P1 + 0xC)) + 240;
          const mt = matchBlocks(fr.obj, recBlocks(r.rec, hx, hy, m.b(P1 + 0x24), null));
          if (mt && mt.hit === mt.of) { ST.seat.frames++; const k = `${wrap(hx + mt.dx - body[0])},${wrap(hy + mt.dy - body[1])}`; ST.seat.offsets[k] = (ST.seat.offsets[k] || 0) + 1; if (!(k in ST.seat.firstFrame)) ST.seat.firstFrame[k] = { f: fr.f, heroH: m.sw(P1 + 0xC), heroD: m.sw(P1 + 0x10), brec, body }; }
        }
        for (const wr of wheelRecs) for (const o of originOf(fr.obj, wr)) { const k = `${wrap(o[0] - body[0])},${wrap(o[1] - body[1])}`; ST.wheels.offsets[k] = (ST.wheels.offsets[k] || 0) + 1; }
      }
    }
    prev = fr;
  });
  return ST;
}

// =====================================================================================================================
// 5. the shipped model (built from the static decode; the live analysis checks it)
// =====================================================================================================================
let CAR_MODEL = null, SAMPLE_ON = false;
const ARRIVAL_SEAT = [0, -33];                     // the EPISODE 2 / 4 arrival car: hero object 33 px above the body origin (measured)
function timingSummary(live) {
  const sum = (get) => live.reduce((o, st) => { for (const [k, v] of Object.entries(get(st) || {})) o[k] = (o[k] || 0) + v; return o; }, {});
  const body = live.reduce((o, st) => (o.agree += st.timing.bodyAnim.agree, o.of += st.timing.bodyAnim.of, o), { agree: 0, of: 0 });
  return {
    bodyPose: `body record = 1098 if speed > target + 0x80, else 1097, in ${body.agree}/${body.of} cruise frames (the one miss per run is its boarding frame, target 0)`,
    wheelFrameRuns: sum(st => st.timing.wheelRuns),
    steerStepAfter: sum(st => st.timing.steer.steps.afterFrames),
    steerRecordsWrong: live.reduce((a, st) => a + st.timing.steer.wrongRec, 0),
    flashPhases: sum(st => st.timing.flash.pattern),
    dustIntervals: sum(st => st.timing.puffSpawns.dust.intervals), smokeIntervals: sum(st => st.timing.puffSpawns.smoke.intervals),
    smokeSpawnDxDd: sum(st => st.timing.puffOffsets.smoke), dustSpawnDxDdFromWheel: sum(st => st.timing.puffOffsets.dust),
    wreck: live.map(st => st.timing.wreck && `${st.run}: f${st.timing.wreck.f} state 4 at x ${st.timing.wreck.x} (camX ${st.timing.wreck.camX}), rolls at ${st.timing.wreck.vx}/256 px/f in ${st.timing.wreck.lastRec}, removed f${st.timing.wreck.removedAt} at x ${st.timing.wreck.lastX} > camX + 512; ${st.timing.wreck.players.length} rider(s) thrown out`).filter(Boolean),
  };
}
const SAMPLES = [];
function buildModel(S) {
  const C = S.car, so = S.seat.offsets;
  // screen offsets from the body record origin (x right, y down). Body: height C.bodyHeight above the road point;
  // wheels: height 0 at depth + 1 (1 px higher on screen); seats: (dx, height, depth) from the body, so the body's bump
  // moves them too.
  const wheelDy = C.bodyHeight - 1;
  CAR_MODEL = {
    bodyHeight: C.bodyHeight, brakeMargin: C.brakeMargin,
    frontWheel: [C.frontWheelDx, wheelDy], rearWheel: [C.rearWheelDx, wheelDy],
    seats: so.map(s => [s.dx, -s.dh - s.dd]),
    steer: C.steerAnims.map(a => C.anims[a].frames.map(f => f.rec)),
  };
  return CAR_MODEL;
}

// =====================================================================================================================
// 6. images
// =====================================================================================================================
function png(file, w, h, rgba) { R.writePNG(file, w, h, rgba); }
const FONT = { '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111', '-': '000000111000000', '.': '000000000000010', ' ': '000000000000000', ':': '000010000010000', '+': '000010111010000', '/': '001001010100100', '=': '000111000111000', '(': '010100100100010', ')': '010001001001010', ',': '000000000010100' };
function canvas(w, h, bg = [36, 40, 48]) { const d = new Uint8Array(w * h * 4); for (let q = 0; q < w * h; q++) { d[q * 4] = bg[0]; d[q * 4 + 1] = bg[1]; d[q * 4 + 2] = bg[2]; d[q * 4 + 3] = 255; } return { w, h, d }; }
function put(cv, x, y, c) { if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return; const q = (y * cv.w + x) * 4; cv.d[q] = c[0]; cv.d[q + 1] = c[1]; cv.d[q + 2] = c[2]; cv.d[q + 3] = 255; }
function text(cv, s, x, y, c = [255, 255, 140]) { [...s.toUpperCase()].forEach((ch, k) => { const g = FONT[ch] || FONT[' ']; for (let i = 0; i < 15; i++) if (g[i] === '1') put(cv, x + k * 4 + (i % 3), y + ((i / 3) | 0), c); }); }
// draw a record image at a feet point with a palette function slot -> [16 RGB]
function blit(cv, im, fx, fy, palOf, { flip = false, override = null, mask = null } = {}) {
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const q = y * im.w + x, pen = im.pen[q]; if (pen === 15) continue;
    const X = flip ? fx - (x - im.ox) - 1 : fx + (x - im.ox), Y = fy + (y - im.oy);
    const c = palOf(override != null ? override : im.slot[q])[pen];
    put(cv, X, Y, c); if (mask && X >= 0 && Y >= 0 && X < cv.w && Y < cv.h) mask[Y * cv.w + X] = 1;
  }
}

// =====================================================================================================================
// 7. export
// =====================================================================================================================
function runExists(n) { return fs.existsSync(path.join(RUNS, n, 'frames.jsonl')) && fs.existsSync(path.join(RUNS, n, 'summary.json')) && JSON.parse(fs.readFileSync(path.join(RUNS, n, 'summary.json'), 'utf8')).ok; }

function exportAll() {
  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(IMPL, { recursive: true });
  const S = decodeStatic();
  buildModel(S);
  const C = S.car;
  // E3a0 OBJ page (0x8E8E entry, heroes.json stagePalettes) = the live rows during the drive (checked below)
  const H = JSON.parse(fs.readFileSync(path.join(ROOT, 'work/re/extract/heroes/heroes.json'), 'utf8'));
  const page = H.stagePalettes.areas.find(a => a.episode === 3 && a.area === 0).rows;
  const slotRows = Object.fromEntries([0, 1, 2, 3, 4, 14, 19, 28, 29].map(s => [s, page[s]]));
  const RGB = {}; const palRGB = slot => RGB[slot] || (RGB[slot] = rowRGB24(slotRows[slot] != null ? slotRows[slot] : page[slot]).map(c => [(c >> 16) & 255, (c >> 8) & 255, c & 255]));

  // records
  const bodyRecs = [...new Set([...C.anims.flatMap(a => a.frames.map(f => f.rec)), ...S.ending.anims[0].frames.map(f => f.rec)])].sort((a, b) => a - b);
  const puffRecs = S.puff.anims[0].frames.map(f => f.rec);
  const seatRecs = [...new Set(S.seat.anims.flatMap(a => a.frames.map(f => f.rec)))].sort((a, b) => a - b);
  const IM = {}; for (const r of [...bodyRecs, ...puffRecs, ...seatRecs, 3391, 3392]) IM[r] = recImage(r);
  for (const r of bodyRecs) if (!IM[r] || !IM[r].opaque) throw new Error('record renders empty: ' + r);

  // ---- live ----
  const runs = RUN_NAMES().filter(runExists), arrivals = ARRIVAL_RUNS.filter(runExists);
  SAMPLE_ON = true; SAMPLES.length = 0;
  const live = runs.map(r => { process.stdout.write(`analysing ${r} ... `); const t = Date.now(); const a = analyseRun(r); console.log(((Date.now() - t) / 1000).toFixed(1) + ' s'); return a; });
  const arrival = arrivals.map(r => { process.stdout.write(`analysing ${r} ... `); const a = analyseArrival(r); console.log('ok'); return a; });

  // ---- driver / seat data per hero ----
  const seatAnim = (id, back) => S.seat.anims[id * 2 + (back ? 1 : 0)].frames.map(f => [f.rec, f.dur]);
  const box = (rec, at, flip) => { const im = IM[rec]; const x = flip ? at[0] - (im.w - im.ox) : at[0] - im.ox; return [x, at[1] - im.oy, im.w, im.h]; };
  const union = bs => { const x0 = Math.min(...bs.map(b => b[0])), y0 = Math.min(...bs.map(b => b[1])), x1 = Math.max(...bs.map(b => b[0] + b[2])), y1 = Math.max(...bs.map(b => b[1] + b[3])); return [x0, y0, x1 - x0, y1 - y0]; };
  const seatsXY = CAR_MODEL.seats;
  const driver = {};
  for (const [id, key] of HEROES.entries()) {
    const front = seatAnim(id, false), back = seatAnim(id, true);
    driver[key] = { front, back, frontBox: union(front.map(f => box(f[0], seatsXY[0], false))), backBox: union(back.map(f => box(f[0], seatsXY[2], true))) };
  }
  const driverClip = union(HEROES.map(k => driver[k].frontBox));
  // opaque-pixel box of the front seat sprites (tighter, for the KI12 fallback clip)
  const opaqueBox = (rec, at) => { const im = IM[rec]; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.pen[y * im.w + x] !== 15) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [at[0] - im.ox + x0, at[1] - im.oy + y0, x1 - x0 + 1, y1 - y0 + 1]; };
  const driverOpaque = union(HEROES.flatMap(k => driver[k].front.map(f => opaqueBox(f[0], seatsXY[0]))));

  // ---- aggregate validation ----
  const agg = { runs: runs.length, carFrames: 0, kinds: {}, model: {}, seatsSeen: {} };
  for (const st of live) {
    agg.carFrames += st.carFrames;
    for (const [k, v] of Object.entries(st.kinds)) { const a = agg.kinds[k] || (agg.kinds[k] = { objects: 0, exact: 0, within1: 0, partial: 0, absent: 0, maxErr: 0 }); for (const f of ['objects', 'exact', 'within1', 'partial', 'absent']) a[f] += v[f]; a.maxErr = Math.max(a.maxErr, v.maxErr); }
    for (const [k, v] of Object.entries(st.model)) { const a = agg.model[k] || (agg.model[k] = { frames: 0, maxErr: 0, offsets: {} }); a.frames += v.frames; a.maxErr = Math.max(a.maxErr, v.maxErr); for (const [o, n] of Object.entries(v.offsets)) a.offsets[o] = (a.offsets[o] || 0) + n; }
    for (const [k, v] of Object.entries(st.seatsSeen)) agg.seatsSeen[k] = (agg.seatsSeen[k] || 0) + v;
  }
  delete agg.model.bob;
  const bobSeen = {}; for (const st of live) for (const [o, n] of Object.entries((st.model.bob || {}).offsets || {})) bobSeen[o] = (bobSeen[o] || 0) + n;
  const seatHeroes = { front: {}, back: {} };
  for (const k of Object.keys(agg.seatsSeen)) { const [seat, who, rec] = k.split(':'); (seat === 'seat2' ? seatHeroes.back : seatHeroes.front)[who] = [...new Set([...(seat === 'seat2' ? seatHeroes.back : seatHeroes.front)[who] || [], +rec])].sort((a, b) => a - b); }
  const arrivalSeat = {}; for (const a of arrival) for (const [o, n] of Object.entries(a.seat.offsets)) arrivalSeat[o] = (arrivalSeat[o] || 0) + n;
  const arrivalWheels = {}; for (const a of arrival) for (const [o, n] of Object.entries(a.wheels.offsets)) arrivalWheels[o] = (arrivalWheels[o] || 0) + n;
  const errTo = (o, w) => { const [x, y] = o.split(',').map(Number); return Math.max(Math.abs(x - w[0]), Math.abs(y - w[1])); };
  const arrivalSeatErr = Math.max(0, ...Object.keys(arrivalSeat).map(o => errTo(o, ARRIVAL_SEAT))), arrivalVsE3 = Math.max(0, ...Object.keys(arrivalSeat).map(o => errTo(o, seatsXY[0])));
  const livePal = {}; for (const st of live) for (const [k, n] of Object.entries(st.palettes)) livePal[k] = (livePal[k] || 0) + n;
  const palOk = [4, 14, 19, 28, 29].every(s => Object.keys(livePal).filter(k => k.startsWith(s + ':')).every(k => +k.split(':')[1] === page[s]));

  // ---- compare images: snapshot | model | diff (model drawn from the shipped data only) ----
  const pix = { frames: 0, modelPx: 0, visible: 0, match: 0, images: [], note: 'model = the car drawn from the shipped data (body origin from the OBJ list, every other part from cadillac.json offsets); scored on the pixels where a car OBJ entry is the top sprite and the MAME snapshot shows it' };
  const chosen = []; const perRun = {};
  for (const s of SAMPLES) { perRun[s.run] = (perRun[s.run] || 0) + 1; if (perRun[s.run] <= 8) chosen.push(s); }
  for (const s of chosen) {
    const snap = snapFile(s.run, s.f + 1);
    if (!fs.existsSync(snap) || !s.origin.body) continue;
    const sp = R.readPNG(fs.readFileSync(snap));
    const livePals = slot => Array.from({ length: 16 }, (_, i) => wordRGB(parseInt(s.pal.substr((slot * 16 + i) * 4, 4), 16)));
    const cv = canvas(384, 224, [0, 0, 0]); const mask = new Uint8Array(384 * 224);
    const P = s.scene, car = P.car, B = s.origin.body, bump = car.h - CAR_MODEL.bodyHeight;
    const ov = car.pal & 0x80 ? car.pal & 31 : null;
    // back to front: wheels (depth + 1), body, seats (seat 0 at depth - 1 last), puffs
    for (const sub of [4, 2]) { const w = P.wheels[sub]; if (!w || w.rec == null) continue; const off = sub === 2 ? CAR_MODEL.frontWheel : CAR_MODEL.rearWheel; blit(cv, IM[w.rec] || recImage(w.rec), B[0] + off[0], B[1] + off[1] + bump - w.h, livePals, { mask }); }
    blit(cv, IM[car.rec], B[0], B[1], livePals, { override: ov, mask });
    for (const sub of [2, 1, 0]) { const st = P.seats.find(q => q.sub === sub && q.car === car.a); if (!st || car.seat[sub] < 0 || st.rec == null) continue; blit(cv, IM[st.rec] || recImage(st.rec), B[0] + seatsXY[sub][0], B[1] + seatsXY[sub][1], livePals, { flip: sub === 2, mask }); }
    // occlusion: render the dumped OBJ list; a pixel scores only where a car entry is the top sprite and the snapshot
    // shows it (scroll layers with priority, captions and other sprites hide the rest)
    const carKeys = new Set();
    const addKeys = (rec, fx, fy, face, ov2) => { for (const b of recBlocks(rec, fx, fy, face, ov2)) carKeys.add(`${b.code}:${b.sx & 511}:${b.sy & 511}`); };
    addKeys(car.rec, ...feetOf(car, P.cam), car.face, ov);
    for (const sub of [2, 4]) { const w = P.wheels[sub]; if (w && w.rec != null) addKeys(w.rec, ...feetOf(w, P.cam), w.face, null); }
    for (const st of P.seats) if (st.car === car.a && car.seat[st.sub] >= 0 && st.rec != null) addKeys(st.rec, ...feetOf(st, P.cam), st.face, null);
    const carIdx = new Set(s.obj.map((e, i) => (carKeys.has(`${e.code}:${e.sx & 511}:${e.sy & 511}`) ? i : -1)).filter(i => i >= 0));
    const objR = O.renderObj({ obj: s.obj, pal: s.pal });
    let mp = 0, vis = 0, ok = 0; const diff = canvas(384, 224, [0, 0, 0]);
    for (let q = 0; q < 384 * 224; q++) {
      const g = [sp.data[q * 4], sp.data[q * 4 + 1], sp.data[q * 4 + 2]];
      diff.d[q * 4] = g[0] >> 2; diff.d[q * 4 + 1] = g[1] >> 2; diff.d[q * 4 + 2] = g[2] >> 2;
      if (!mask[q]) continue; mp++;
      const shown = carIdx.has(objR.owner[q]) && objR.rgba[q * 4] === g[0] && objR.rgba[q * 4 + 1] === g[1] && objR.rgba[q * 4 + 2] === g[2];
      if (!shown) { diff.d[q * 4] = 40; diff.d[q * 4 + 1] = 70; diff.d[q * 4 + 2] = 150; continue; }      // occluded: blue
      vis++;
      const same = cv.d[q * 4] === g[0] && cv.d[q * 4 + 1] === g[1] && cv.d[q * 4 + 2] === g[2];
      if (same) ok++;
      diff.d[q * 4] = same ? 40 : 255; diff.d[q * 4 + 1] = same ? 200 : 40; diff.d[q * 4 + 2] = same ? 60 : 40;
    }
    pix.frames++; pix.modelPx += mp; pix.visible += vis; pix.match += ok;
    // crop around the car: x B-150..B+150, y B-110..B+40
    const cx0 = Math.max(0, Math.min(384 - 300, B[0] - 150)), cy0 = Math.max(0, Math.min(224 - 150, B[1] - 110)), CW = 300, CH = 150;
    const out = canvas(CW * 3 + 8, CH + 12);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const q = ((cy0 + y) * 384 + cx0 + x) * 4;
      put(out, x, y + 12, [sp.data[q], sp.data[q + 1], sp.data[q + 2]]);
      put(out, CW + 4 + x, y + 12, mask[(cy0 + y) * 384 + cx0 + x] ? [cv.d[q], cv.d[q + 1], cv.d[q + 2]] : [24, 26, 32]);
      put(out, 2 * CW + 8 + x, y + 12, [diff.d[q], diff.d[q + 1], diff.d[q + 2]]);
    }
    const label = `${s.run.replace('ex-cadillac-e3-', '')} F${s.f + 1} VISIBLE ${vis} MATCH ${(100 * ok / Math.max(1, vis)).toFixed(2)}`;
    text(out, label, 2, 3); text(out, 'MAME', CW - 18, 3); text(out, 'MODEL', 2 * CW - 18, 3); text(out, 'DIFF', 3 * CW - 10, 3);
    const file = path.join(OUT, `compare-${s.run.replace('ex-cadillac-e3-', '')}-f${String(s.f + 1).padStart(4, '0')}.png`);
    png(file, out.w, out.h, out.d); pix.images.push({ file: rel(file), match: +(ok / Math.max(1, vis)).toFixed(4), visible: vis, modelPx: mp });
  }
  for (const f of fs.readdirSync(OUT)) if (/^compare-.*\.png$/.test(f) && !pix.images.some(i => i.file.endsWith(f))) fs.rmSync(path.join(OUT, f));

  // ---- atlas (RGBA, live E3 palette) ----
  const atlasRecs = [...bodyRecs, ...puffRecs, ...seatRecs];
  const pad = 2; let ax = pad, ay = pad, rowH = 0; const AW = 1024; const place = {};
  for (const r of atlasRecs) { const im = IM[r]; if (ax + im.w + pad > AW) { ax = pad; ay += rowH + pad; rowH = 0; } place[r] = [ax, ay]; ax += im.w + pad; rowH = Math.max(rowH, im.h); }
  const AH = ay + rowH + pad; const atlas = canvas(AW, AH, [0, 0, 0]); for (let q = 0; q < AW * AH; q++) atlas.d[q * 4 + 3] = 0;
  const aj = { from: 'tools/re/export/cadillac.cjs', palette: 'live OBJ rows of EPISODE 3 area 0 (0x8E8E page S3A0): ' + JSON.stringify(slotRows), frames: {} };
  for (const r of atlasRecs) {
    const im = IM[r], [x0, y0] = place[r];
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) { const q = y * im.w + x; if (im.pen[q] === 15) continue; const c = palRGB(im.slot[q])[im.pen[q]]; const o = ((y0 + y) * AW + x0 + x) * 4; atlas.d[o] = c[0]; atlas.d[o + 1] = c[1]; atlas.d[o + 2] = c[2]; atlas.d[o + 3] = 255; }
    aj.frames[r] = { x: x0, y: y0, w: im.w, h: im.h, ox: im.ox, oy: im.oy, slots: im.pals, opaque: im.opaque };
  }
  png(path.join(OUT, 'atlas-cadillac.png'), AW, AH, atlas.d);

  // ---- contact sheet ----
  const sheet = canvas(1100, 760);
  const cell = (label, x, y, w, h) => { for (let i = 0; i < w; i++) { put(sheet, x + i, y, [70, 74, 84]); put(sheet, x + i, y + h - 1, [70, 74, 84]); } for (let j = 0; j < h; j++) { put(sheet, x, y + j, [70, 74, 84]); put(sheet, x + w - 1, y + j, [70, 74, 84]); } text(sheet, label, x + 3, y + 3); };
  const cross = (x, y) => { for (let k = -2; k <= 2; k++) { put(sheet, x + k, y, [255, 0, 255]); put(sheet, x, y + k, [255, 0, 255]); } };
  // row 1: the full car (body + wheels + driver) for each hero, drive and brake
  const fullCar = (x, y, rec, who, steer = 2, ov = null) => {
    const fw = CAR_MODEL.steer[steer][0];
    blit(sheet, IM[1099], x + CAR_MODEL.rearWheel[0], y + CAR_MODEL.rearWheel[1], palRGB, { override: ov });
    blit(sheet, IM[fw] || recImage(fw), x + CAR_MODEL.frontWheel[0], y + CAR_MODEL.frontWheel[1], palRGB, { override: ov });
    blit(sheet, IM[rec], x, y, palRGB, { override: ov });
    if (who) blit(sheet, IM[driver[who].front[0][0]], x + seatsXY[0][0], y + seatsXY[0][1], palRGB, { override: ov });
  };
  HEROES.forEach((k, i) => { const x = 10 + (i % 2) * 545, y = 10 + ((i / 2) | 0) * 120; cell(`${k} drive 1097 seat (${seatsXY[0].join(',')}) rec ${driver[k].front.map(f => f[0]).join('/')}`, x, y, 540, 115); fullCar(x + 140, y + 100, 1097, k); fullCar(x + 410, y + 100, 1098, null); cross(x + 140, y + 100); text(sheet, 'BRAKE 1098', x + 380, y + 12); });
  // row 3: steer index 0..4 (front wheel), flash, all three seats
  { const y = 255; cell('front wheel steer index 0..4 (0 toward the viewer, 2 straight, 4 away): ' + CAR_MODEL.steer.map(s => s.join('/')).join('  '), 10, y, 1080, 70);
    CAR_MODEL.steer.forEach((s, i) => { blit(sheet, IM[s[0]], 60 + i * 110, y + 60, palRGB); blit(sheet, IM[s[1]], 110 + i * 110, y + 60, palRGB); text(sheet, String(i), 60 + i * 110, y + 14); });
    [2165, 2166, 2167, 2159, 2160, 2161, 2162, 2163, 2164].forEach((r, i) => { blit(sheet, IM[r], 640 + i * 46, y + 58, palRGB, { override: i < 3 ? null : null }); blit(sheet, IM[r], 640 + i * 46, y + 30, palRGB, { override: S.puff.dustSlot }); });
    text(sheet, 'PUFFS: DUST (SLOT 14) / SMOKE', 640, y + 14); }
  { const y = 330; cell('three seats: 0 driver (0,-32) depth -1 / 1 passenger (0,-39) / 2 back seat (-59,-36) mirrored; damaged flash = slot 4', 10, y, 1080, 120);
    const x = 160; fullCar(x, y + 105, 1097, 'mustapha');
    blit(sheet, IM[driver.jack.front[0][0]], x + seatsXY[1][0], y + 105 + seatsXY[1][1], palRGB);
    blit(sheet, IM[driver.hannah.back[0][0]], x + seatsXY[2][0], y + 105 + seatsXY[2][1], palRGB, { flip: true });
    blit(sheet, IM[driver.mustapha.front[0][0]], x + seatsXY[0][0], y + 105 + seatsXY[0][1], palRGB);
    fullCar(560, y + 105, 1097, 'jack', 2, C.flash.slot); text(sheet, 'FLASH', 520, y + 14);
    const cb = driverClip; for (let i = 0; i < cb[2]; i++) { put(sheet, 840 + cb[0] + i, y + 105 + cb[1], [0, 255, 255]); put(sheet, 840 + cb[0] + i, y + 105 + cb[1] + cb[3] - 1, [0, 255, 255]); } for (let j = 0; j < cb[3]; j++) { put(sheet, 840 + cb[0], y + 105 + cb[1] + j, [0, 255, 255]); put(sheet, 840 + cb[0] + cb[2] - 1, y + 105 + cb[1] + j, [0, 255, 255]); }
    fullCar(840, y + 105, 1097, 'hannah'); text(sheet, 'DRIVERCLIP ' + driverClip.join(','), 790, y + 14); }
  { const y = 455; cell('back seat poses (mirrored): jack 113, mustapha 287, hannah 1580, mess 644; front seat main:29: 2700, 2696/2697, 2698/2699, 2701', 10, y, 1080, 120);
    HEROES.forEach((k, i) => { driver[k].back.forEach(f => blit(sheet, IM[f[0]], 80 + i * 130, y + 105, palRGB, { flip: true })); driver[k].front.forEach((f, j) => blit(sheet, IM[f[0]], 620 + i * 115 + j * 50, y + 105, palRGB)); }); }
  { const y = 580; cell('ending car 3489/3490 (jack driving, hannah beside him) and the arrival car 3391 (slots 11/12 = the same rows)', 10, y, 1080, 170);
    const rows2 = Object.assign({}, slotRows, { 11: 38, 12: 39 }); const pal2 = s => rowRGB24(rows2[s] != null ? rows2[s] : page[s]).map(c => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);
    blit(sheet, IM[3489], 160, y + 150, palRGB); blit(sheet, IM[3490], 440, y + 150, palRGB); blit(sheet, IM[3391], 760, y + 150, pal2); }
  png(path.join(OUT, 'sheet-cadillac.png'), sheet.w, sheet.h, sheet.d);

  // ---- the fx.cadillac entry ----
  const frames = a => a.frames.map(f => [f.rec, f.dur]);
  const steerFlat = CAR_MODEL.steer.flatMap((recs, i) => C.anims[C.steerAnims[i]].frames.map(f => [f.rec, f.dur, i]));
  const rnd = v => Math.round(v * 10000) / 10000;
  const px = v => rnd(v / 256);
  const entry = {
    v: 1,
    set: C.set,
    object: { pool: 'C', type: '0x160', handler: S.handlers.car.handler, parts: { body: 0, frontWheel: 2, rearWheel: 4 }, seats: { pool: 'D', type: '0x90', handler: S.handlers.seat.handler, set: S.seat.set } },
    faces: 'right',
    units: 'screen px (x right, y down) from the body record origin unless a note says otherwise; 60 Hz frames; [rec, dur] pairs; records 1097-1112 / 2159-2167 / 3489-3490 are on the fx sheet, the rider records are heroes-family records',
    hud: 'observed in the snapshots (not decoded): while driving, the P1 HUD name reads DRIVER and its bar shows the car',
    mapKey: 'S3A0',
    pal: { slots: { 19: page[19], 28: page[28], 29: page[29] }, flashSlot: C.flash.slot, dustSlot: S.puff.dustSlot,
      note: 'body records use OBJ slots 29 / 19, the wheels 28, the riders the fixed hero slots 0-3: draw with the fx map S3A0 (EPISODE 3 area 0, 0x8E8E) in every chapter; flash = every slot -> row 4 (palette override 0x84), dust = every slot -> slot 14 (override 0x8E), smoke = the record palette (slot 9)' },
    body: bodyRecs,
    anims: {
      drive: frames(C.anims[0]),
      brake: frames(C.anims[1]),
      boost: frames(C.anims[0]),
      wheel: frames(C.anims[C.wheelStartAnim]),
      steer: steerFlat,
      wreck: frames(C.anims[1]),
      dust: frames(S.puff.anims[0]),
      ending: frames(S.ending.anims[0]),
    },
    animNotes: {
      drive: 'body anim 0 (record 1097, looping): cruising, accelerating, parked',
      brake: 'body anim 1 (1098, nose down): while the speed is above the target speed + 0x80 (slowing down; the drive-in stop)',
      boost: 'the ROM has no boost body art: holding right raises the target to 0xB00 (11 px/frame) and the body keeps anim 0; the wheels spin and dust puffs every 8 frames (as at cruise)',
      wheel: 'wheel anim 2 (1099/1100, 2 frames each): both wheels spin while the body moves (they stop on the frame shown when the car stops)',
      steer: '[rec, dur, steerIndex]: the front wheel only; index 0/1 turned toward the viewer (depth speed < 0, down the screen), 2 straight, 3/4 away (up the screen); the index moves one step per 13 frames toward the steering side and relaxes back to 2 at one step per 7 frames (timer 12 counted down by 1 / by 2)',
      wreck: 'at HP 0 the riders are thrown out and the car keeps rolling at its last speed in the brake pose until x > camX + 512, then disappears; there is no broken-car art (the damage shows before: smoke below 60 HP, a second puff and the red flash below 30)',
      dust: 'puff object (pool D type 0xA4): records 2165-2167 then 2159-2164, 2 frames each; dust from the wheels in slot 14, smoke from the hood in its own slot 9',
      ending: 'ending car (pool C type 0x158): Jack driving and Hannah beside him are part of the records',
    },
    ground: C.bodyHeight,
    wheels: {
      front: { dx: CAR_MODEL.frontWheel[0], dy: CAR_MODEL.frontWheel[1], depth: 1 }, rear: { dx: CAR_MODEL.rearWheel[0], dy: CAR_MODEL.rearWheel[1], depth: 1 },
      steer: CAR_MODEL.steer, straight: 2, stepFrames: C.steerStep + 1, relaxFrames: (C.steerStep >> 1) + 1, jitter: [0, -1],
      note: 'dx / dy from the body origin with the body at rest (height = ground). The wheels stay on the road (height 0, depth + 1): with the body at height ground + bob the wheel is at body origin + (dx, dy + bob). While the car moves each wheel is drawn 0 or 1 px higher at random every frame (jitter)',
    },
    bob: { table: C.bumpTable, frames: C.bumpFrames, chance: 0.5, everyMax: 16, note: 'body height = ground + table[t] while a bump counts t = 15..1 (table index t, entry 0 at rest): every rand(16) frames a 50% chance of a 15-frame bump (none below 20 HP); the seats ride with the body, the wheels do not. Seen live: -1 and -2 px' },
    seat: seatsXY[0],
    seats: S.seat.offsets.map((s, i) => ({ sub: s.sub, role: ['driver', 'passenger', 'back'][i], dx: seatsXY[i][0], dy: seatsXY[i][1], depth: s.dd, flip: i === 2, anim: i === 2 ? 'back' : 'front' })),
    driver: Object.fromEntries(HEROES.map(k => [k, { front: driver[k].front, back: driver[k].back, frontBox: driver[k].frontBox, backBox: driver[k].backBox }])),
    driverFamily: 'heroes',
    driverRole: 'drive = main:29 (front seats); the back seat plays the hero records listed under back',
    driverClip,
    driverOpaque,
    driverClipNote: 'the ROM does not clip: the seat records are cut at the waist and drawn over the body (seat 0 at depth - 1). driverClip = the union box of the four front-seat records at the driver seat, relative to the body origin; clip a full-body driver frame to it (KI12 fallback) to match the ROM silhouette',
    speed: { cruise: px(C.cruise), boost: px(C.targetByInput.R[0]), brake: px(C.targetByInput.L[0]), diagonal: px(C.targetByInput.RU[0]), depth: px(C.targetByInput.U[1]), depthDiagonal: px(C.targetByInput.RU[1]), accel: px(C.accel), entry: px(C.entrySpeed), units: 'px per 60 Hz frame (ROM 8.8 words / 256)', players: 'two or three riders steering: the summed targets are averaged' },
    damage: { hp: C.hp, smokeBelow: C.smoke.below, smokeEvery: C.smoke.every, smokeAt: [C.smoke.at[0], -C.smoke.at[1] - C.smoke.depth], smoke2Below: C.smoke.below2, smoke2At: [C.smoke.at2[0], -C.smoke.at2[1] - C.smoke.depth], flashBelow: C.flash.below, flashPeriod: C.flash.period, flashFrames: C.flash.frames, flinch: 'palette slot 4 for the hit-stop frames', ramDamage: 20, note: 'smokeAt / smoke2At: screen offsets of the puff origin from the body origin (spawned at height + 32 / + 16, depth - 4, then drifting; checked live in ex-cadillac-e3-jack); ramDamage from mechanics.json cadillac.ramming' },
    wreckRule: { ejectX: C.wreck.ejectX, ejectStep: C.wreck.ejectStep, invulnFrames: C.wreck.invuln, exitX: C.wreck.exitX, roadEnd: C.roadEnd, pose: 'brake', note: 'riders land at camX + 128 (+32 per extra rider); the car is removed once x > camX + 512; reaching camX 0xA000 wrecks it too' },
    dust: { minSpeed: px(C.dust.minSpeed), fastSpeed: px(C.dust.fastSpeed), fastEvery: C.dust.fastEvery, slowEvery: C.dust.slowEvery, velocity: S.puff.velocity, at: [0, 4], note: 'a dust puff at each wheel origin + (0, 4) (same height, depth - 4) every 8 frames at >= 8 px/frame, every 16 at 3-8 px/frame; puffs drift right at 1 px/frame and up at 0.25-1.5 px/frame (random entry of velocity [vx, vh])' },
    arrival: { recs: [3391, 3392], slots: { 11: 38, 12: 39 }, sameArtAs: [1097, 1098], seat: ARRIVAL_SEAT, wheels: { dx: [S.arrival.frontWheelDx, S.arrival.rearWheelDx], dy: CAR_MODEL.frontWheel[1] - 1, depth: S.arrival.wheelDepth, height: S.arrival.wheelHeight }, speed: px(S.arrival.speed), note: 'the car that brings the hero in at the EPISODE 2 / 4 starts (pool B type 0x40); the seated hero is the hero object itself (main:29) 33 px above the body origin (the HELL ROAD seat object sits at depth - 1, hence 32 there); its wheels update before the body, so while it moves they trail by its speed; draw 1097 / 1098 with S3A0 instead (identical tiles, rows 38 / 39)' },
    endingCar: { recs: [3489, 3490], dur: 3, speed: px(S.ending.speed), speed2: px(S.ending.speed2), note: 'slots 0 / 1 (Jack, Hannah) + 29 / 19: S3A0 colours it; wheels as the arrival car' },
    validation: {
      runs: runs.concat(arrivals),
      objBlocks: Object.fromEntries(Object.entries(agg.kinds).map(([k, v]) => [k, `${v.exact + v.within1}/${v.objects} placed (${v.exact} exact), max err ${v.maxErr} px`])),
      modelOffsets: Object.fromEntries(Object.entries(agg.model).map(([k, v]) => [k, `${v.frames} frames, max err ${v.maxErr} px`])),
      arrivalSeat: `${Object.values(arrivalSeat).reduce((a, b) => a + b, 0)} frames of ${arrivals.join(', ')}: offsets ${Object.entries(arrivalSeat).map(([o, n]) => o + ' x' + n).join(', ')}; max err ${arrivalSeatErr} px vs arrival.seat [${ARRIVAL_SEAT}], ${arrivalVsE3} px vs seat`,
      timing: timingSummary(live),
      pixels: `${pix.match}/${pix.visible} visible model pixels equal to the MAME snapshots in ${pix.frames} frames (${pix.modelPx} drawn, the rest hidden by scroll layers / other sprites)`,
    },
    source: 'tools/re/export/cadillac.cjs (work/re/extract/heroes/cadillac/extraction.json)',
  };
  const ordered = o => Array.isArray(o) ? o.map(ordered) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map(k => [k, ordered(o[k])])) : o;
  const entryText = JSON.stringify(ordered(entry), null, 1) + '\n';
  fs.writeFileSync(path.join(OUT, 'cadillac.json'), entryText);
  fs.writeFileSync(path.join(IMPL, 'fx-cadillac.json'), entryText);

  const extraction = {
    meta: { tool: 'tools/re/export/cadillac.cjs', rom: R.DIR, note: 'HEROES.md §9.1 CAR-1; PLAN.md §6 WP-J; every static value is re-read from the ROM at the cited instruction (evidence)' },
    static: S, model: CAR_MODEL,
    records: Object.fromEntries(Object.entries(IM).map(([r, im]) => [r, { w: im.w, h: im.h, ox: im.ox, oy: im.oy, slots: im.pals, opaque: im.opaque, blocks: recParts(+r).length }])),
    livePalette: { page: 'S3A0 (EPISODE 3 area 0, 0x8E8E)', rows: slotRows, observed: livePal, matchesPage: palOk },
    live: live.map(st => ({ run: st.run, frames: st.frames, carFrames: st.carFrames, kinds: st.kinds, model: st.model, seatsSeen: st.seatsSeen, timing: st.timing, speeds: st.speeds })),
    arrival, seatHeroes, bobSeen,
    validation: { aggregate: agg, arrivalSeat, arrivalWheels, arrivalSeatErr, pixels: pix },
    driverClip, driverOpaque,
  };
  fs.writeFileSync(path.join(OUT, 'extraction.json'), JSON.stringify(extraction, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'atlas-cadillac.json'), JSON.stringify(aj, null, 1) + '\n');
  return { entry, extraction, agg, pix, arrivalSeat, arrivalSeatErr, palOk, seatHeroes, runs, arrivals };
}

// =====================================================================================================================
async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const cmd = args[0] || 'export';
  if (cmd === 'live') {
    const what = args[1] || 'all';
    if (!PLANS[what]) { console.log('usage: node tools/re/export/cadillac.cjs live [jack|mustapha|3p|all] [--force]'); process.exitCode = 1; return; }
    const L = require('./lib/live.cjs');
    const res = await L.runSeq(PLANS[what](), { force: process.argv.includes('--force') });
    for (const s of res) console.log(s.name, s.ok ? 'ok' : 'FAILED', s.seconds ? s.seconds.toFixed(1) + ' s' : '(cached)', 'last frame', s.lastFrame);
    if (res.some(s => !s.ok)) process.exitCode = 1;
    return;
  }
  if (cmd !== 'export') { console.log('usage: node tools/re/export/cadillac.cjs [export] | live [jack|mustapha|3p|all] [--force]'); process.exitCode = 1; return; }
  const r = exportAll();
  console.log('runs', r.runs.length + r.arrivals.length, '| palette page S3A0 live:', r.palOk);
  for (const [k, v] of Object.entries(r.agg.kinds)) console.log(`  OBJ ${k.padEnd(10)} ${v.exact + v.within1}/${v.objects} (exact ${v.exact}, partial ${v.partial}, absent ${v.absent}) max err ${v.maxErr}`);
  for (const [k, v] of Object.entries(r.agg.model)) console.log(`  model ${k.padEnd(10)} ${v.frames} frames, max err ${v.maxErr}, offsets ${Object.keys(v.offsets).slice(0, 6).join(' ')}`);
  console.log('  arrival seat offsets', JSON.stringify(r.arrivalSeat), 'max err', r.arrivalSeatErr);
  console.log('  pixels', r.pix.match, '/', r.pix.visible, 'visible (of', r.pix.modelPx, 'drawn) in', r.pix.frames, 'frames');
  console.log('  seats seen', JSON.stringify(r.seatHeroes));
  console.log('wrote', rel(OUT), '+', rel(path.join(IMPL, 'fx-cadillac.json')));
}
if (require.main === module) main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
module.exports = { PLANS, LINEUPS, RUN_NAMES, solo, three, RAM, decodeStatic, recImage, recParts, recBlocks, analyseRun, analyseArrival, exportAll };
