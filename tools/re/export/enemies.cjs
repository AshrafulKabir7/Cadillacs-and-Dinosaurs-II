#!/usr/bin/env node
// Export of the original Cadillacs & Dinosaurs (1993, MAME "dino") regular human enemies for the fan sequel.
// Research tooling only; it never edits the game. Deterministic and re-runnable:
//
//   node tools/re/export/enemies-live.cjs              # (once, ~7 min) variant captures -> work/re/runs/en-<variant>/
//   node tools/re/export/enemies-live.cjs --extra      # (once, ~10 min) mode / brawl / ranged / kill / TYROG 2 runs
//   node tools/re/export/enemies-live.cjs --palettes   # OBJ palette RAM of the 10 stage states -> work/re/runs/en-pal-*
//   tools/re/export/enemies-rea-ev.sh <label> "<rizin>"  # REA evidence records -> work/re/extract/enemies/evidence/
//   node tools/re/export/enemies.cjs                   # ROM decode + live facts + stage census -> work/re/extract/enemies/
//
// Outputs per type: <type>.json (variants, HP, palettes and colourings, speeds, behaviour modes, attack ids with damage
// predictions, measured hits, behaviour, every animation decoded with labels and live evidence), <type>.png +
// <type>.atlas.json (every record any of its animations or created objects use, native LEFT-facing, ROM palettes at full
// brightness through the variant's home stage/area palette map, transparent; frames {key, rec, pal, x, y, w, h, ox, oy}
// with (ox, oy) = feet origin), <type>-<variant>-<colouring>.png/.atlas.json (the records whose colours differ in another
// stage/area or palette override), <type>-<variant>-sheet.png contact sheets, <type>-colourings.png, census.json,
// INDEX.md and validation.json.
//
// Facts used (tools/re/MEMORY-MAP.md): V04 draw/composites/+0x23 override, V08 pools, V09/V12 object fields, V10 spawn
// list, V13/V15 10-byte frames, V18 reaction tables 0x2E724/0x2E68C, R4 record layout, R9 HUD names (0x17D78). New
// static facts found here are re-read from the ROM below (ROM_CHECKS) and the run fails if any differs.
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../rom.cjs');
const A = require('./enemy-anim.cjs');
const D = require('./enemy-draw.cjs');
const ER = require('./enemy-run.cjs');
const AT = require('./enemy-attacks.cjs');
const MD = require('./enemy-modes.cjs');
const CEN = require('./enemy-census.cjs');
const LIVE = require('./enemies-live.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'work/re/extract/enemies');
const RUNS = path.join(ROOT, 'work/re/runs');
const hex = A.hex;
const MM = JSON.parse(fs.readFileSync(path.join(ROOT, 'work/re/memory-map.json'), 'utf8'));
const SPAWN = MM.tables.spawnList.entries || MM.tables.spawnList;

// ---------------------------------------------------------------------------------------------------------------
// Static tables found for this export (OBSERVED in the disassembly; addresses are 68000 addresses = file offsets)
const HP_TABLE = 0x31454;         // 0x31424: +0x6C = +0x6E = word[0x31454 + (+0x03)*64 + lvl*2], +0x6A = min(that, 100)
const BOSS_HP_TABLE = 0x31E52;    // 0x31E14: 48 bytes per index, 16 per player count (byte 0xFF84EF), word (lvl & 0x1C) >> 2
const SPEED_PTRS = 0x17CE;        // 0x17A4: +0x64 = long[0x17CE + idx*4] -> 32 directions x (vx, vdepth) 8.8 words
// OBJ palettes are loaded per stage and area by 0x8E4C: long[0x8E8E + stage*16 + area*4] -> 32 words; OBJ slot k gets
// ROM palette #word[k] (0xB7A52 + n*32). Areas per stage (U09, all seen in the census): 3, 3, 1, 3, 2, 3, 4, 4.
const PAL_MAP_TABLE = 0x8E8E;
const AREAS_PER_STAGE = [3, 3, 1, 3, 2, 3, 4, 4];
function palMap(stage, area) { const p = R.u32(PAL_MAP_TABLE + (stage - 1) * 16 + area * 4); return Array.from({ length: 32 }, (_, k) => R.u16(p + k * 2)); }
const STAGE_AREAS = []; AREAS_PER_STAGE.forEach((n, i) => { for (let a = 0; a < n; a++) STAGE_AREAS.push([i + 1, a]); });
const FIXED_SLOTS = Array.from({ length: 32 }, (_, k) => new Set(STAGE_AREAS.map(([s, a]) => palMap(s, a)[k])).size === 1);
const EXPLOSION_TABLE = 0xA26FC;  // explosion hits (0x10EC4): hero melee table [0xA26FC + 0] (Jack's) + id*4, b0 unmodified

const ROM_CHECKS = [
  // [address, expected words, what]
  [0x8E4C, [0x7000, 0x102D, 0x04D9, 0xE948, 0x7200, 0x122D, 0x0786, 0xD241, 0xD241, 0xD041, 0x207B, 0x002C], 'palette map index = stage*16 + area*4 (0xFF84D9, 0xFF8786)'],
  [0x8E74, [0x267C, 0x000B, 0x7A52], 'palette loader copies ROM palettes from 0xB7A52'],
  [0x36B36, [0x1D7C, 0x009F, 0x0023, 0x0C2E, 0x0001, 0x0026], 'KING KIMO KIMO +0x23 = 0x9F, 0x9E when +0x26 high byte = 1'],
  [0x36ACA, [0x4EB9, 0x0003, 0x1E14, 0x302E, 0x006C, 0xE240, 0x4A2E, 0x0026], 'KING KIMO KIMO HP: boss routine index 6, then asr #1 (both branches store the halved value)'],
  [0x31424, [0x7000, 0x102E, 0x0003, 0xED48], 'HP init: moveq #0,D0; move.b ($3,A6),D0; lsl.w #6,D0'],
  [0x31430, [0x322D, 0x05EE], 'HP init reads the level word 0xFF85EE'],
  [0x3143C, [0x0C41, 0x0064], 'HP init caps +0x6A at 100'],
  [0x31E22, [0x102D, 0x04EF], 'boss HP row by the player count byte 0xFF84EF'],
  [0x17A4, [0x4880, 0xE548, 0x207B, 0x0024, 0x2D48, 0x0064], 'speed setter: +0x64 = long[0x17CE + D0*4]'],
  [0x116B2, [0x287C, 0x000A, 0x2EA4], 'enemy->player damage records at 0xA2EA4'],
  [0x116BA, [0x102A, 0x0058, 0xE748], 'record index = attacker +0x58 * 8'],
  [0x116CC, [0x4EB9, 0x0000, 0x6422], 'damage modifier 0x6422'],
  [0x11DCA, [0x287C, 0x000A, 0x2EA4, 0x7000, 0x102A, 0x0058, 0xE748], 'second enemy-hit path (chain, bike ram): same records'],
  [0x11DE4, [0x4EB9, 0x0000, 0x6422], 'second enemy-hit path: same modifier 0x6422'],
  [0x10ED6, [0x287C, 0x000A, 0x26FC], 'explosion hits use the hero melee table pointers 0xA26FC'],
  [0x6422, [0x4A6D, 0x04AA, 0x6700, 0x000C, 0x082D, 0x0001, 0x0024, 0x6600], '0x6422: no damage when word 0xFF84AA != 0 and bit 1 of 0xFF8024 is set'],
  [0x6436, [0x302A, 0x0084, 0xE748, 0x2C7C, 0x0002, 0xC3AE], 'multiplier row = attacker +0x84 * 8 (32 bytes per kind)'],
  [0x64CC, [0x302B, 0x006C, 0x0C40, 0x0001, 0x6700, 0x0018, 0x9041, 0x6200, 0x0012, 0x4440, 0x0C40, 0x0005], 'overkill by less than 5 leaves the hero at 1 HP (unless HP is 1)'],
  [0x5F6DA, [0x0C68, 0x0060, 0x0020], 'Dinosaurs Naguri needs a dinosaur partner (type 0x60/0x74/0x98)'],
  [0x33990, [0x302E, 0x0026, 0x0240, 0x00FF, 0x303B, 0x0012, 0x4EBB, 0x000E], 'Chinpira mode dispatch on the +0x26 low byte'],
  [0x339AC, [0x000C, 0x0096, 0x0136, 0x0286, 0x035E, 0x049C], 'Chinpira mode table (6 modes)'],
  [0x3B93C, [0x000A, 0x0092, 0x00B0, 0x00C8, 0x0132], 'Hutori mode table (5 modes)'],
  [0x4589E, [0x000C, 0x0100, 0x01B0, 0x0238, 0x0328, 0x0400], 'Subayai mode table (6 modes)'],
  [0x393D6, [0x0008, 0x000C, 0x0160, 0x00BC], 'Kameleon mode table (4 modes)'],
  [0x3DF46, [0x7000, 0x102E, 0x0027, 0x323B, 0x0006, 0x4EFB], 'Mituryou mode dispatch on byte +0x27'],
  [0x3DF54, [0x05B0, 0x1CEA, 0x1D50, 0x1D8C, 0x193A, 0x1FD2, 0x20C8, 0x205A, 0x1DEA, 0x1F0C], 'Mituryou mode table (10 modes; 0x3DF68 = the +0x04 = 2 routine)'],
  [0x403E8, [0x156C, 0x141A, 0x143C, 0x145E, 0x14CC, 0x15C4, 0x1634], 'Knife Man mode table (7 modes)'],
  [0x5B0E6, [0x302E, 0x0026, 0x0240, 0x00FF, 0x6704, 0x6100], 'Thurow: a non-zero +0x26 low byte calls 0x5B0FA (enter from the screen edge)'],
  [0x5C6CE, [0x4EB9, 0x0002, 0x4B36, 0x4EB9, 0x0003, 0x3802, 0x4EB9, 0x0002, 0xAF9A, 0x103C], 'bike death: item drop 0x24B36, rider 0x33802, score 0x2AF9A, sound'],
  [0x33802, [0x4EB9, 0x0000, 0x483C, 0x652E, 0x117C, 0x0001, 0x0000, 0x317C, 0x0008, 0x0020, 0x317C, 0x0208, 0x0026], 'rider = pool-B type 8 (Chinpira), +0x26 = 0x208'],
  [0x6550A, [0x1D7C, 0x0023, 0x0003, 0x3D7C, 0x008C, 0x0084, 0x2D7C, 0x0007, 0x02C4, 0x0040, 0x1D7C, 0x009D], 'TYROG 2 init: +0x03 0x23, +0x84 0x8C, set 0x702C4, +0x23 0x9D'],
  [0x655BA, [0x1D7C, 0x009F, 0x0023], 'TYROG 2 alive: +0x23 = 0x9F (0x9E / 0x9D by the +0x26 high byte)'],
  [0x57F78, [0x317C, 0x00EC, 0x0020], 'bullet creator 0x57F62 allocates pool-B type 0xEC'],
  [0x55884, [0x3D7C, 0x005C, 0x0084], 'thrown knife (0xA4) sets its own +0x84 = 0x5C'],
  [0x48FC, [0x386D, 0x6602, 0x390E, 0x3B4C, 0x6602, 0x526D, 0x65F8, 0x7000, 0x49D6, 0x28C0], 'pool-B free clears only the first 0x28 bytes (+0x84 survives)'],
  [0x4340A, [0x4EB9, 0x0000, 0x9CD8, 0x7002, 0x323C, 0x0033, 0x343C, 0x0046, 0x4EB9, 0x0005], 'N.Richmond pistol shot: 0x57F62 with sub 2, x+0x33, h+0x46'],
  [0x57876, [0x4EB9, 0x0000, 0x119C, 0x0240, 0x0001, 0x6600, 0x001A, 0x2D7C], 'stage-1 intro punk 0xDC: random FERRIS / GNEISS art'],
  [0x3FCB6, [0x1D7C, 0x008B, 0x0023], 'Mituryou mode 4: override 0x8B (slot 11) while fading in'],
  [0x3EF64, [0x1D7C, 0x008F, 0x0023, 0x0C2E, 0x0002, 0x0026], 'Mituryou after the fade-in: +0x23 = 0x8F (0x90 / 0x91 by the +0x26 high byte)'],
  [0x3EFFC, [0x0091, 0x4160, 0x0091, 0x4160, 0x0091, 0x4160], 'Mituryou fade writes OBJ palette RAM slot 11 (0x914160)'],
];

// ---------------------------------------------------------------------------------------------------------------
// The regular human enemies. Variant -> live capture id (enemies-live.cjs VARIANTS). role/sequel/behaviour are curated
// notes; home stages come from the census (census.json) unless a variant gives one.
const TYPES = [
  { id: 'chinpira', title: 'Chinpira (street punks of the Ferris gang)', objType: 0x08, handler: 0x3383A, select: '+0x26 high byte 0/2/4 -> init 0x3388A/0x338BE/0x338F2 (switch 0x3386C)',
    role: 'basic melee punk: walks in, taunts, short punch combo; the most common enemy', sequel: ['raider'],
    modes: { site: 0x33990, count: 6 },
    behaviour: 'Walks to about 57 px in front of the player on the same lane (depth within 2), then repeats its attack about every 45 frames (A jab 9 damage, straight punch id 1, B jab, C jump kick 15 damage). Taunts (anim 2) when it reaches a stop. Entrance by behaviour mode (+0x26 low byte): walk, run, ambush sitting, lookout, thrown off a bike, drop from above. Variants differ in speed tables and attack timing (C attacks fastest).',
    variants: [{ id: 'A', run: 'chinpira-a' }, { id: 'B', run: 'chinpira-b' }, { id: 'C', run: 'chinpira-c' }] },
  { id: 'hutori', title: 'Hutori ("fatty" brutes)', objType: 0x28, handler: 0x3B828, select: '+0x26 high byte 0/2/4 -> init 0x3B8C6/0x3B8E2/0x3B8FE',
    role: 'fat brute: slow walk, belly charge / body press, heavy punches', sequel: ['brute'],
    modes: { site: 0x3B920, count: 5 },
    behaviour: 'Walks slowly; attacks from 80-95 px with a haymaker (attack id 4, 14-16 damage) about every 50 frames, and charges with a running belly rush from up to ~150 px (attack id 6, 18-22 damage). Entrances by mode: walk, drop from above, catch breath then charge, body press, wait smoking.',
    variants: [{ id: 'A', run: 'hutori-a' }, { id: 'B', run: 'hutori-b' }, { id: 'C', run: 'hutori-c' }, { id: 'C0', run: 'hutori-c0', note: 'Hutori_C with the behaviour low byte cleared (sub 0x400): the debug entry uses 0x408, the wait-smoking mode' }] },
  { id: 'naguri', title: 'Dinosaurs Naguri (brutes beating a captive dinosaur)', objType: 0x13C, handler: 0x5F5D0, select: '+0x26 high byte 0/2/4 -> init 0x5F676/0x5F692/0x5F6AE (switch 0x5F60C)',
    role: 'Hutori-style brute that beats a captured dinosaur; has no attack of its own against the player', sequel: ['brute'],
    behaviour: 'Only stays if a captive dinosaur (pool-B type 0x60/0x74/0x98 with +0xC0 bit 7 set, +0xC1 = 0) exists (0x5F6CA, otherwise it frees itself); it pairs with it (+0x76) and loops anim 2 beating it (attack id 5 is written by that loop, 0x5FA04) while the dinosaur stays captive, then walks after the player. Its set has no attack animation: in 2000 brawl frames without invulnerability it never hit the player. Uses the Hutori reaction sets.',
    variants: [{ id: 'A', run: 'naguri-a' }, { id: 'B', run: 'naguri-b' }, { id: 'C', run: 'naguri-c' }] },
  { id: 'mituryou', title: 'Mituryou Sya (poachers)', objType: 0x34, handler: 0x3DDEA, select: '+0x26 high byte 0 / 2 / >=4 -> init 0x3DE50 / 0x3DE38 / 0x3DE20',
    role: 'poacher: rifle with bayonet; lunging stabs, flying kick, rifle shot from range', sequel: ['raider', 'gunner'],
    modes: { site: 0x3DF46, count: 10 },
    behaviour: 'Sneaks in crouched; stabs from 40-70 px (attack id 9 lunge, 18 damage; id 8 thrust, 15) and flying-kicks (id 43, 18 damage); rolls in (id 44); from range it aims and fires the rifle (anim 15: bullet object 0xEC, attack id 11, created by 0x57F62 from 0x3EA7E).',
    objects: [{ pool: 'B', type: 0xE4, role: 'rifle shot effect (muzzle flash)' }, { pool: 'B', type: 0xEC, role: 'rifle bullet (attack id 11; +0x84 not set by the bullet)' }],
    variants: [{ id: 'A', run: 'mituryou-a' }, { id: 'B', run: 'mituryou-b' }, { id: 'C', run: 'mituryou-c' }] },
  { id: 'knifeman', title: 'Knife Man', objType: 0x38, handler: 0x4020E, select: '+0x26 high byte 0/2 (init 0x402F8/0x40310); the first call re-allocates the enemy into a fresh slot and turns the spawned slot into a knife object (type 0xF0)',
    role: 'knife fighter: slashes up close, throws knives from range, drops his knife', sequel: ['knifer'],
    modes: { site: 0x403DA, count: 7 },
    otherTypeAnims: { anims: [30, 31], note: 'main anims 30/31 are the KNIFE ONLY art (type 0xFC uses the same set); Knife Man never plays them, so they are left out of its colourings' },
    behaviour: 'Boxer stance; stabs from 45-110 px (attack id 23, 11 damage), leaping attack (id 52, 17-20 damage), throws his knife from range (anim 12 -> thrown knife object 0xA4, id 25, 14 damage). When knocked down he drops the knife (item KNIFE) and walks back to pick it up (anim 21). Entrances by mode: walk, ambush crouch, stand and wait, leap down from above (id 24), run, run covering the face.',
    objects: [{ pool: 'B', type: 0xA4, role: 'thrown knife (HUD KNIFE; sets its own +0x84 = 0x5C)' }, { pool: 'B', type: 0x88, role: 'knife held in the hand (HUD KNIFE)' }, { pool: 'B', type: 0xF0, role: 'knife helper object (the spawned slot after the re-allocation; attack id 30)' }, { pool: 'A', type: 0x0, role: 'dropped knife item (subtype 4)', render: false }],
    variants: [{ id: 'A', run: 'knifeman-a' }, { id: 'B', run: 'knifeman-b' }] },
  { id: 'knifeonly', title: 'KNIFE ONLY (knife thrower pass)', objType: 0xFC, handler: 0x5AA6E, select: 'one variant; uses the Knife Man animation sets',
    role: 'runs in, throws a knife and leaves', sequel: ['knifer'],
    behaviour: 'Runs in with the knife drawn (anim 30), throws it once (anim 31 -> object 0xA4) and runs off; HP 36 at lvl 10. Attack id 28 is written while it runs.',
    objects: [{ pool: 'B', type: 0xA4, role: 'thrown knife (HUD KNIFE)' }],
    variants: [{ id: 'A', run: 'knifeonly' }] },
  { id: 'subayai', title: 'Subayai Zako ("quick small-fry")', objType: 0x50, handler: 0x457B0, select: '+0x26 high byte 0/2 -> init 0x457E2/0x45800',
    role: 'fast acrobatic punk: jump kicks and quick strikes', sequel: ['slicer'],
    modes: { site: 0x45882, count: 6 },
    behaviour: 'Waits crouched (mode 0), then somersaults in; quick jab from ~70 px (attack id 13, 6 damage) about every 40 frames, jumping spin kick (id 14, 8 damage), flips and dive kicks (ids 15/16); dodges by ducking and back-flipping.',
    variants: [{ id: 'A', run: 'subayai-a' }, { id: 'B', run: 'subayai-b' }] },
  { id: 'thurow', title: 'Thurow Bomb / DYNA Zako (grenade and dynamite throwers)', objType: 0x100, handler: 0x5AFC2, select: '+0x26 high byte 0 grenade (PUNK art, set 0x5B606) / non-zero dynamite (WRENCH T., set 0x5B77C); low byte non-zero: enter from the screen edge (0x5B0FA). The first call allocates a second slot: the lower address becomes the thrower (type 0x100) and the other the bomb (type 0x134)',
    role: 'throws grenades or dynamite from the back of the screen', sequel: ['gunner'],
    modeCode: 'no mode table: the +0x26 low byte only selects the entrance side (0x5B0E6: non-zero -> 0x5B0FA puts X at camX + 0xC0 -/+ 0x100, on the side away from the players)',
    behaviour: 'Somersaults/runs in, throws one grenade or stick of dynamite overhand (anim 7) and leaves. The bomb (0x134) flies in an arc; its explosion (pool A type 4) hits through 0x10EC4 with the hero melee table (attack id 106: b0 = 10, no level multiplier). Uses the Subayai art (PUNK / THUG records).',
    objects: [{ pool: 'B', type: 0x134, role: 'thrown grenade / dynamite in flight' }, { pool: 'A', type: 0x4, role: 'explosion (hits for 10 through 0x10EC4)' }],
    variants: [{ id: 'BOMB', run: 'thurow-bomb', hp: { kind: 'const', value: 20, evidence: 'move.w #20 -> +0x6A/+0x6C/+0x6E at 0x5B070' } }, { id: 'DYNA', run: 'thurow-dyna', hp: { kind: 'const', value: 20, evidence: 'move.w #20 -> +0x6A/+0x6C/+0x6E at 0x5B09A' } }] },
  { id: 'ishinage', title: 'Ishinage Man (stone thrower)', objType: 0x0C, handler: 0x358B2, select: 'one variant',
    role: 'ball-and-chain heavy (HUD LASH T.; the debug name says stone thrower)', sequel: ['brute', 'slicer'],
    behaviour: 'Re-allocates on its first frame and leaves two helper objects (types 0xF8 and 0x20). Walks with the chain coiled and lashes the ball and chain at long reach (anims 2/3/5/12, ids 81/83/87/88 on himself); the damage comes from the chain object 0x20 (ids 84-86, 13 damage at lvl 10) through the second hit path 0x11DCA. In the ranged run he hit the player from ~100-150 px ten times. HP 180 at lvl 10 (the +0x6A bar field is capped at 100).',
    objects: [{ pool: 'B', type: 0xF8, role: 'helper object created on the first frame (ids 8, 42)' }, { pool: 'B', type: 0x20, role: 'ball and chain: the lash (ids 84-86; hits through 0x11DCA)' }],
    variants: [{ id: 'A', run: 'ishinage' }] },
  { id: 'kameleon', title: 'Kameleon Man', objType: 0x18, handler: 0x39272, select: 'one variant (debug subtype 6)',
    role: 'lizard-man mutant (HUD BLUDGE): crawls, emerges, leaping kicks and pounces', sequel: ['mutant'],
    modes: { site: 0x393BA, count: 4 },
    behaviour: 'Crawls low and fast or emerges (mode 6, anim 19); leaping kick from ~120 px (attack id 37, 15 damage), pounce from ~80 px (id 38, 17 damage), claw swipe (id 36).',
    variants: [{ id: 'A', run: 'kameleon' }] },
  { id: 'richmond', title: 'N.Richmond (Vice T. / Walther)', objType: 0x48, handler: 0x42590, select: '+0x26 high byte 0 / 2 -> init 0x425C8 / 0x425F8',
    role: 'big brawler with a pistol; variant A is VICE T. (boss HP routine, 450 HP: the stage-1 boss), variant B WALTHER (regular heavy)', sequel: ['gunner', 'brute'],
    behaviour: 'Punches from ~70 px (attack id 18, 8-9 damage), lunge punch from 90-135 px (id 19, 19-20 damage), flying kick (id 20, 11-12 damage), kick (id 53, 10). At range on the player\'s lane (depth within 6, 0x44D42) he aims the pistol (anim 14) and fires (0x4340A): a bullet object 0xEC (sub 2, attack id 11) that hit for 16 and 19 in the ranged runs, depending on the +0x84 the bullet slot kept from its previous occupant. Vice T. (A) starts with long intro poses (anims 20/21) and spawns a Dinonics (type 0x74) on its first frame.',
    objects: [{ pool: 'B', type: 0xEC, role: 'pistol bullet (attack id 11; +0x84 not set by the bullet)' }, { pool: 'D', type: 0x54, role: 'shot / impact effect' }],
    variants: [{ id: 'A', run: 'richmond-a', hp: { kind: 'boss', index: 0, evidence: 'jsr 0x31E14 with D0 = 0 at 0x425EA' } }, { id: 'B', run: 'richmond-b' }] },
  { id: 'kingkimo', title: 'KING KIMO KIMO and TYROG 2 (Tyrog mutants)', objType: 0x10, handler: 0x36A64, select: 'KING KIMO KIMO: one variant; +0x26 high byte 0/1/2 -> palette override +0x23 = 0x9F/0x9E/0x9D. TYROG 2 (type 0x16C, handler 0x654E2) shares the set and the palette rule',
    role: 'mutant (HUD TYROG / TYROG 2): crawling reptile that leaps, lashes its tongue and spits parasites; its set also holds the mutation of punks/brutes into it', sequel: ['mutant'],
    behaviour: 'Shuffles and rears up; leaping dive (attack id 77, 26 damage), claw lash (id 79, 23-24), tongue lash object 0x128 (ids 80/107, 27 and 16-22), spits parasite objects 0x68 (ids 68/78/103) and an 0xEC shot. KING KIMO KIMO appears only in stage 6 area 2 (three of them: +0x26 high byte 0/1/2 = blue-grey, orange, green); TYROG 2 is fought in stage 8 area 0 with regular HP (300 at every level).',
    objects: [{ pool: 'B', type: 0x68, role: 'spat parasite (ids 68, 78, 103)' }, { pool: 'B', type: 0x128, role: 'tongue lash extending from the mouth (anims 27-29; ids 80, 107)' }, { pool: 'B', type: 0x12C, role: 'flesh splatter effect (sub 3)' }, { pool: 'B', type: 0xEC, role: 'shot (0x57F62 from 0x37540, sub 0)' }],
    variants: [{ id: 'A', run: 'kingkimo', colourBy: 'override', hp: { kind: 'boss', index: 6, halved: true, evidence: 'jsr 0x31E14 with D0 = 6 at 0x36ACA, then asr #1 at 0x36AD4' } },
      { id: 'TYROG2', run: 'tyrog2', handler: 0x654E2, objType: 0x16C, colourBy: 'override', note: 'TYROG 2: pool-B type 0x16C (spawn #42), init 0x6550A; regular HP table 0x31424 (word[0x31454 + 0x23*64] = 300 at every level)' }] },
  { id: 'bike', title: 'Bike Chinpira / Bike Jump', objType: 0x118, handler: 0x5C356, select: '+0x26 0x000 ride-through / 0x100 jump-in',
    role: 'biker that rides across the lane (or jumps in) and rams the player; destroyed, it throws its rider off', sequel: ['biker'],
    modeCode: 'no mode table: +0x26 = 0x100 jumps in (anim 1) instead of riding in',
    behaviour: 'Rides straight across (or jumps in, anim 1) and leaves; ramming hits for 11 (attack id 71, second hit path 0x11DCA). HP 8. Destroyed (state 4, 0x5C6CE): item drop 0x24B36, the rider is spawned by 0x33802 as a Chinpira (pool-B type 8, +0x26 = 0x208: variant B GNEISS, behaviour mode 8) at height 32 with the bike\'s X, depth and facing, score 0x2AF9A, a sound, then the bike slot is freed. The rider tumbles (anim 14), gets up (anim 15) and fights.',
    objects: [{ pool: 'D', type: 0x1C, role: 'dust', render: false }],
    variants: [{ id: 'RIDE', run: 'bike', hp: { kind: 'const', value: 8, evidence: 'moveq #8 -> +0x6C/+0x6E/+0x6A at 0x5C404' } }, { id: 'JUMP', run: 'bikejump', hp: { kind: 'const', value: 8, evidence: 'moveq #8 -> +0x6C/+0x6E/+0x6A at 0x5C404' } }] },
];
// census type names (enemy-census.cjs) -> export type / variant matching
const CENSUS_TYPE = { tyrog2: 'kingkimo' };

// curated animation labels, per type and set kind ('main' = +0x40 set, 'held' = 0x2E724 set, 'down' = 0x2E68C set)
const LABELS = require('./enemy-labels.cjs');

// ---------------------------------------------------------------------------------------------------------------
function romChecks() {
  return ROM_CHECKS.map(([a, words, what]) => { const got = words.map((_, i) => R.u16(a + i * 2)); return { addr: hex(a), what, ok: got.every((w, i) => w === words[i]), got: got.map(w => hex(w, 4)) }; });
}

function speedIndexOf(ptr) { for (let k = 0; k < 64; k++) { const p = R.u32(SPEED_PTRS + k * 4); if (p === ptr) return k; if ((p >>> 16) !== 0x12) break; } return null; }
function speedTable(ptr) { return { ptr: hex(ptr), index: speedIndexOf(ptr), vxRight: R.s16(ptr + 8 * 4), vdepthAway: R.s16(ptr + 2), pxPerFrame: +(R.s16(ptr + 8 * 4) / 256).toFixed(3) }; }

function initEvidence(h, v03, r84, set) {
  // the init writes in the handler range: move.b #v03,($3,A6) / move.w #r84,($84,A6) / move.l #set,($40,A6)
  const [s, e] = AT.rangeOf(h); const ev = { v03: [], r84: [], set: [] };
  for (let a = s; a < e && a < R.prg.length - 8; a += 2) {
    const w = R.u16(a);
    if (w === 0x1D7C && R.u16(a + 4) === 0x0003 && (R.u16(a + 2) & 0xFF) === v03) ev.v03.push(hex(a));
    if (w === 0x3D7C && R.u16(a + 4) === 0x0084 && R.u16(a + 2) === r84) ev.r84.push(hex(a));
    if (w === 0x2D7C && R.u16(a + 6) === 0x0040 && R.u32(a + 2) === set) ev.set.push(hex(a));
  }
  return ev;
}

const top = arr => (arr && arr.length ? arr[0][0] : null);

// HP source per variant (v.hp): default the per-name table 0x31454 through 0x31424; 'boss' = 0x31E14 (table 0x31E52),
// optionally halved; 'const' = an immediate
function hpInfo(v, v03, lvl, hp0, hpm, hpTable) {
  const spec = v.hp || { kind: 'table' };
  let byLevel, source, byPlayers = null;
  if (spec.kind === 'boss') {
    const row = p => Array.from({ length: 32 }, (_, l) => { const w = R.u16(BOSS_HP_TABLE + spec.index * 48 + p * 16 + ((l & 0x1C) >> 1)); return spec.halved ? w >> 1 : w; });
    byPlayers = { '1': row(0), '2': row(1), '3': row(2) }; byLevel = byPlayers['1'];
    source = `boss HP routine 0x31E14, index ${spec.index}${spec.halved ? ', then halved' : ''} (table ${hex(BOSS_HP_TABLE + spec.index * 48)}: 16 bytes per player count, byte 0xFF84EF; word by (lvl & 0x1C) >> 2); ${spec.evidence}`;
  } else if (spec.kind === 'const') {
    byLevel = Array.from({ length: 32 }, () => spec.value); source = `constant ${spec.value}; ${spec.evidence}`;
  } else { byLevel = hpTable; source = `table ${hex(HP_TABLE + v03 * 64)} (0x31424: word[0x31454 + (+0x03)*64 + lvl*2]), +0x6A capped at 100`; }
  const at = byLevel[lvl];
  return { hpAtSpawn: hp0, maxHpField: hpm, level: lvl, levelNote: 'lvl = word 0xFF85EE (dynamic difficulty, 0..31; 9-11 in these stage-1 captures)', source, atLevel: at, ok: at === hp0 && Math.min(100, at) === hpm, byLevel, ...(byPlayers ? { byPlayers } : {}) };
}

// frame -> JSON (output convention: rec, rec2|null, dx2?, dy2?, dur, flags...)
function frameJSON(f) {
  const o = { rec: null, rec2: null, dur: f.dur };
  if (f.composite) {
    const parts = (f.parts || []).map(p => ({ rec: p.rec, dx: p.dx, dy: -p.dy, flag: hex(p.flag, 4) }));
    o.rec = parts[0] ? parts[0].rec : null; o.composite = true; o.parts = parts;
    if (parts[0] && (parts[0].dx || parts[0].dy)) { o.dx = parts[0].dx; o.dy = parts[0].dy; }
    if (parts[1]) { o.rec2 = parts[1].rec; o.dx2 = parts[1].dx - parts[0].dx; o.dy2 = parts[1].dy - parts[0].dy; }
  } else { o.rec = f.rec; o.rec2 = f.rec2; }
  o.flags = { b4: f.b4, b5: f.b5, b6: f.b6, w8: hex(f.w8, 4) };
  if (isActive(f)) o.active = true;
  if (f.last) o.last = true;
  o.addr = hex(f.addr);
  return o;
}
function isActive(f) { return !!((f.b6 & 4) && (f.w8 & 0xFF)); }
// attack window from the frame flags: frames before the first active frame = wind-up
function attackWindow(frames) {
  const act = frames.map((f, i) => isActive(f) ? i : -1).filter(i => i >= 0);
  if (!act.length) return null;
  return { windupFrames: frames.slice(0, act[0]).reduce((n, f) => n + f.dur, 0), activeFrameIndices: act, activeDuration: act.reduce((n, i) => n + frames[i].dur, 0), attackBox: [...new Set(act.map(i => frames[i].w8 & 0xFF))] };
}
function recsOfFrame(f) { return f.composite ? (f.parts || []).map(p => p.rec) : [f.rec, ...(f.rec2 != null ? [f.rec2] : [])]; }

// label text without the (live)/(sheet) note; the evidence is the animation's own live[] list
function labelFor(t, kind, idx) { const L = (LABELS[t.id] || {})[kind] || {}; const s = L[idx]; return s ? s.replace(/\s*\((live|sheet)[^)]*\)\s*$/, '').trim() : null; }

// ---------------------------------------------------------------------------------------------------------------
// census helpers
function censusLives(census, t, v03) {
  return census.lives.filter(L => (CENSUS_TYPE[L.name] || L.name) === t.id && L.b03 === v03)
    .sort((a, b) => a.stage - b.stage || a.area - b.area || a.run.localeCompare(b.run) || a.first - b.first);
}
function homeOf(v, lives, typeLives) {
  if (v.home) return { stage: v.home[0], area: v.home[1], source: v.home[2] };
  if (lives.length) { const L = lives[0]; return { stage: L.stage, area: L.area, source: `census: first stage appearance of this HUD name (${lives.length} lives in the bz-stage walks, first ${L.run} f${L.first})` }; }
  if (typeLives.length) { const L = typeLives[0]; return { stage: L.stage, area: L.area, source: `INFERRED: this variant never appeared in the stage walks; the type's first appearance (${L.run} f${L.first})` }; }
  return { stage: 1, area: 0, source: 'INFERRED: never seen in the stage walks; the capture context (stage 1 area 0)' };
}
const overrideOf = p23s => { const p = (p23s || []).find(x => (parseInt(x.p23, 16) & 0x80) && x.frames >= 8); return p ? parseInt(p.p23, 16) & 0x1F : null; };

// all runs that belong to a variant capture (the main run + EXTRA runs with of === run id)
function runsOf(v) {
  const main = LIVE.VARIANTS.find(x => x.id === v.run) || LIVE.EXTRA.find(x => x.id === v.run);
  const extras = LIVE.EXTRA.filter(x => x.of === v.run);
  return { main, extras };
}
const anCache = new Map();
function analyzeRun(spec) {
  const name = 'en-' + spec.id;
  if (!anCache.has(name)) anCache.set(name, ER.analyze(name, { phases: spec.phases || LIVE.DEFAULT_PHASES }));
  return anCache.get(name);
}

// damage of one measured hit by its hit path (pc of the HP write)
function hitPath(pc) {
  if (pc === '116D8') return { routine: '0x116B2', model: 'record 0xA2EA4 + id*8, modifier 0x6422 (multiplier row = attacker +0x84)' };
  if (pc === '11DF0') return { routine: '0x11DCA', model: 'record 0xA2EA4 + id*8, modifier 0x6422 (second hit path: chain, bike ram)' };
  if (pc === '10F16') return { routine: '0x10EC4', model: 'explosion: hero melee table [0xA26FC] (Jack\'s, 0xA270C) + id*4, b0 not modified (enemy-owned object)' };
  return { routine: '0x' + pc, model: 'unknown' };
}
function predictHit(h) {
  if (h.pc === '116D8' || h.pc === '11DF0') { const b0 = R.prg[AT.ENEMY_DMG + h.attackId * 8]; const r = AT.damageRange(b0, h.attackerR84 ?? 0, h.lvl, h.hpBefore, 0); return { ...r, b0 }; }
  if (h.pc === '10F16') { const b0 = R.prg[R.u32(EXPLOSION_TABLE) + h.attackId * 4]; return { min: b0, max: b0, b0 }; }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
function variantFacts(t, v, census) {
  const { main: lv, extras } = runsOf(v);
  const an = analyzeRun(lv);
  if (!an || an.error || an.first === null) return { id: v.id, run: 'en-' + v.run, error: an ? an.error || 'enemy never appeared' : 'run missing' };
  const v03 = top(an.alive.v03), r84 = top(an.alive.r84), set = top(an.alive.set), lvl = an.lvlAtSpawn;
  const handler = v.handler || t.handler;
  const p23 = an.alive.p23.map(([p, n]) => ({ value: hex(p, 2), frames: n, override: (p & 0x80) ? p & 0x1F : null }));
  const lives = censusLives(census, t, v03), typeLives = census.lives.filter(L => (CENSUS_TYPE[L.name] || L.name) === t.id).sort((a, b) => a.stage - b.stage || a.area - b.area || a.first - b.first);
  const home = homeOf(v, lives, typeLives);
  const map = palMap(home.stage, home.area);
  const capStage = lv.state ? +lv.state.replace(/^stage(\d).*/, '$1') : 1;
  const captureMap = palMap(capStage, 0);
  const rs = A.reactionSets(r84);
  const spawnEntry = SPAWN.find(e => e.i === lv.idx);
  const hpTable = Array.from({ length: 32 }, (_, i) => R.u16(HP_TABLE + v03 * 64 + i * 2));
  const hpm = top(an.alive.hpm);
  const objTypes = new Set((t.objects || []).map(o => o.type));
  // every run of this variant (main + brawl/ranged/kill/mode extras)
  const runs = [{ spec: lv, an, purpose: 'variant' }, ...extras.map(x => ({ spec: x, an: analyzeRun(x), purpose: x.purpose })).filter(r => r.an && !r.an.error && r.an.first !== null)];
  // plays per animation (main capture only: speeds, behaviour statistics)
  const byAnim = new Map();
  for (const p of an.plays) { if (!p.kind) continue; const k = `${p.kind}:${hex(p.set)}:${p.anim}`; if (!byAnim.has(k)) byAnim.set(k, []); byAnim.get(k).push(p); }
  // hits on P1 from all runs: its own hits, or hits by objects of the kinds it creates (other stage enemies excluded)
  const attacks = new Map();
  for (const r of runs) for (const h of r.an.hits) {
    if (!h.own && !(objTypes.has(h.attackerType) && h.attacker !== 'FFB274')) continue;
    const key = h.own && h.attackerAnim ? `main:${h.attackerAnim.set}:${h.attackerAnim.anim}` : `object:${hex(h.attackerType)}`;
    if (!attacks.has(key)) attacks.set(key, { key, attackIds: new Set(), hits: [], byObject: !h.own, objectType: h.own ? null : hex(h.attackerType) });
    const a = attacks.get(key); a.attackIds.add(h.attackId);
    const pr = predictHit(h);
    a.hits.push({ run: 'en-' + r.spec.id, f: h.f, damage: h.damage, predictedMin: pr ? pr.min : null, predictedMax: pr ? pr.max : null, b0: pr ? pr.b0 : null, attackId: h.attackId, attackerR84: hex(h.attackerR84 ?? 0, 2), lvl: h.lvl, p1HpBefore: h.hpBefore, framesFromAnimStart: h.sinceStart, animFrame: h.attackerAnim ? h.attackerAnim.frame : null, pc: '0x' + h.pc, path: hitPath(h.pc).routine });
  }
  const attackList = [...attacks.values()].sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true })).map(a => {
    const ids = [...a.attackIds].sort((x, y) => x - y);
    return { anim: a.key, byObject: a.byObject, objectType: a.objectType, attackIds: ids, records: ids.filter(i => i >= 0 && i < 128).map(AT.record),
      damagePaths: [...new Set(a.hits.map(h => h.path))].map(p => ({ routine: p, model: hitPath(a.hits.find(h => h.path === p).pc.slice(2)).model })),
      measuredDamage: a.hits.map(h => h.damage), ok: a.hits.every(h => h.predictedMin !== null && h.damage >= h.predictedMin && h.damage <= h.predictedMax), hits: a.hits };
  });
  // speeds while each animation plays: mean |dx|, |d depth| per frame over plays (>= 8 frames) where it moved
  const speeds = {};
  for (const [k, ps] of byAnim) {
    const sx = [], sd = []; const tabs = new Set();
    for (const p of ps) {
      if (p.xs.length < 8) continue;
      let ax = 0, ad = 0; for (let i = 1; i < p.xs.length; i++) { ax += Math.abs(p.xs[i][1] - p.xs[i - 1][1]); ad += Math.abs(p.xs[i][2] - p.xs[i - 1][2]); }
      const n = p.xs.length - 1; if (ax + ad > 0) { sx.push(ax / n); sd.push(ad / n); }
      for (const s of p.spd) if (s) tabs.add(s);
    }
    if (sx.length) speeds[k] = { pxPerFrameX: +ER.median(sx).toFixed(3), pxPerFrameDepth: +ER.median(sd).toFixed(3), plays: sx.length, speedTables: [...tabs].sort((a, b) => a - b).map(speedTable) };
  }
  // behaviour statistics: attack starts (distance to P1), intervals (main capture)
  const attackAnimKeys = new Set(attackList.filter(a => !a.byObject).map(a => a.anim));
  for (const [k] of byAnim) { const [kind, setHex, idx] = k.split(':'); if (kind !== 'main') continue; const d = A.decodeSet(parseInt(setHex, 16)).anims[+idx]; if (d && attackWindow(d.frames)) attackAnimKeys.add(k); }
  const starts = an.plays.filter(p => p.kind && attackAnimKeys.has(`${p.kind}:${hex(p.set)}:${p.anim}`)).map(p => ({ f: p.start, key: `${p.kind}:${hex(p.set)}:${p.anim}`, dx: Math.abs(p.dx), dd: Math.abs(p.dd), phase: p.phase }));
  const near = starts.filter(s => s.phase === 'near');
  const intervals = near.slice(1).map((s, i) => s.f - near[i].f);
  const perAttack = {};
  for (const s of starts) { (perAttack[s.key] = perAttack[s.key] || { n: 0, dx: [], dd: [] }).n++; perAttack[s.key].dx.push(s.dx); perAttack[s.key].dd.push(s.dd); }
  for (const k of Object.keys(perAttack)) { const p = perAttack[k]; perAttack[k] = { starts: p.n, medianDx: ER.median(p.dx), minDx: Math.min(...p.dx), maxDx: Math.max(...p.dx), medianDepth: ER.median(p.dd), maxDepth: Math.max(...p.dd) }; }
  // objects it created, over all its runs: the curated per-type list (t.objects); pool D only within 160 px of it
  const objMap = new Map();
  for (const r of runs) for (const spec of t.objects || []) {
    const recs = r.an.others.get(`${spec.pool}:${spec.type}`) || [];
    const sel = recs.filter(x => x.first >= r.an.first && (spec.pool !== 'D' || (x.dxTarget !== null && Math.abs(x.dxTarget) < 160)));
    if (!sel.length) continue;
    const k = `${spec.pool}:${spec.type}`;
    if (!objMap.has(k)) objMap.set(k, { pool: spec.pool, type: hex(spec.type), role: spec.role, count: 0, runs: new Set(), sets: new Set(), subtypes: new Set(), p23: new Set(), whileTarget: new Set(), offsets: [], fps: new Set(), firstFrames: [], render: spec.render !== false });
    const o = objMap.get(k); o.count += sel.length; o.runs.add('en-' + r.spec.id);
    for (const x of sel) { for (const s of x.sets) if (s) o.sets.add(s); o.subtypes.add(x.sub); for (const p of x.p23) o.p23.add(p); if (x.targetPlay) o.whileTarget.add(x.targetPlay); for (const f of x.fps) o.fps.add(f); if (o.offsets.length < 6) o.offsets.push({ run: 'en-' + r.spec.id, dx: x.dxTarget, ddepth: x.ddTarget, dheight: x.dhTarget }); if (o.firstFrames.length < 8) o.firstFrames.push(x.first); }
  }
  const objs = [...objMap.values()].map(o => ({ pool: o.pool, type: o.type, role: o.role, count: o.count, runs: [...o.runs], sets: [...o.sets].sort((a, b) => a - b).map(s => hex(s)), subtypes: [...o.subtypes].map(s => hex(s)), p23: [...o.p23].sort((a, b) => a - b).map(p => hex(p, 2)), whileTarget: [...o.whileTarget].slice(0, 6), offsetFromEnemyAtCreation: o.offsets, fps: [...o.fps].sort((a, b) => a - b), firstFrames: o.firstFrames, render: o.render }));
  // death: what appeared when the kill runs destroyed it (bike: the rider)
  const death = runs.filter(r => r.purpose === 'kill').map(r => deathCheck(r));
  // live animation evidence over every run (main capture + extras); mode runs of other variants add theirs in buildType
  const seen = new Map();
  for (const r of runs) for (const p of r.an.plays) {
    if (!p.kind) continue; const k = `${p.kind}:${hex(p.set)}:${p.anim}`;
    if (!seen.has(k)) seen.set(k, { key: k, plays: 0, runs: new Set(), phases: new Set(), states: new Set(), framesSeen: new Set(), firstFrame: p.start });
    const s = seen.get(k); s.plays++; s.runs.add('en-' + r.spec.id); s.phases.add(p.phase); if (s.states.size < 8) s.states.add(p.st.slice(0, 6)); for (const f of p.frames) s.framesSeen.add(f);
  }
  const animsSeen = [...seen.values()].map(s => ({ key: s.key, plays: s.plays, runs: [...s.runs], phases: [...s.phases], states: [...s.states], framesSeen: [...s.framesSeen].sort((a, b) => a - b), firstFrame: s.firstFrame }));
  // attack id <-> animation, from the value of +0x58 on the active frames of every live play (all runs)
  const idAnims = new Map();
  for (const r of runs) for (const p of r.an.plays) {
    if (p.kind !== 'main') continue;
    const d = A.decodeSet(p.set).anims[p.anim]; if (!d) continue;
    p.frames.forEach((fi, i) => { const f = d.frames[fi]; if (f && isActive(f) && p.ats[i]) { const k = p.ats[i]; if (!idAnims.has(k)) idAnims.set(k, new Set()); idAnims.get(k).add(p.anim); } });
  }
  return {
    id: v.id, note: v.note, run: 'en-' + v.run, state: lv.state || 'stage1-jack', extraRuns: extras.map(x => ({ run: 'en-' + x.id, purpose: x.purpose, subtype: x.sub !== undefined ? hex(x.sub, 4) : undefined })),
    spawn: { listIndex: lv.idx, entry: spawnEntry ? spawnEntry.addr : null, name: spawnEntry ? spawnEntry.name : null, subtype: hex(lv.sub === undefined ? parseInt(spawnEntry.subtype, 16) : lv.sub, 4), subtypeOverride: lv.sub !== undefined, partner: lv.pre ? { listIndex: lv.pre.idx, name: (SPAWN.find(e => e.i === lv.pre.idx) || {}).name, pokes: lv.pre.pokes.map(p => ({ off: hex(p[0]), value: hex(p[2]) })), untilFrame: lv.pre.to } : null },
    objType: hex(top(an.alive.ty)), handler: hex(handler), slotRelocated: an.moves.length > 0,
    hudIndex: hex(v03, 2), hudName: A.hudName(v03), r84: hex(r84, 2), set: hex(set),
    reactionSets: { held: hex(rs.held), down: hex(rs.down), table: { held: hex(A.REACT_HELD + r84), down: hex(A.REACT_DOWN + r84) } },
    init: initEvidence(handler, v03, r84, set),
    hp: hpInfo(v, v03, lvl, an.hp0, hpm, hpTable),
    palette: { p23, home, recordPalettes: null, liveCheck: null, slots: null, colourings: null },
    census: { lives: lives.length, appearances: [...new Set(lives.map(L => `S${L.stage}A${L.area}`))], subtypes: [...new Set(lives.map(L => L.sub))].sort(), modes: [...new Set(lives.map(L => L.mode))].sort() },
    speeds, locomotion: Object.fromEntries(Object.entries(speeds).filter(([k]) => k.startsWith('main:')).map(([k, sp]) => [k, { label: labelFor(t, 'main', +k.split(':')[2]), ...sp }]).filter(([, sp]) => /^(walk|run|crawl|shuffle|ride|stalk)/i.test(sp.label || ''))),
    attacks: attackList, attackIds: null,
    behaviour: { attackStarts: perAttack, nearPhaseAttackIntervals: intervals, firstAttackFrame: near.length ? near[0].f - an.first : null, plays: an.plays.length },
    objects: objs, death,
    animsSeen,
    unknownFramePointers: an.unknownFp.map(([a, n]) => ({ fp: hex(a), frames: n })),
    drawCheck: { framesChecked: an.draw.checked, exact: an.draw.exact, dyingBlinkFrames: an.draw.dyingBlink || 0, wholeObjectAbsent: an.draw.absent || 0, absentFrames: an.draw.absentFrames || [], partialMisses: an.draw.otherMiss || 0, missFrames: an.draw.misses, unmodelled: an.draw.unmodelled, note: 'RAM at f-1 -> OBJ dump f (V05); blink = dying state 4; absent = none of the predicted tiles in that frame list' },
    gone: an.gone, lvl, _an: an, _runs: runs, _map: map, _captureMap: captureMap, _lives: lives, _idAnims: idAnims, _r84: r84, _handler: handler,
  };
}

// objects that appeared within 8 frames of the target's slot being freed (the bike's rider, item drops)
function deathCheck(r) {
  const an = r.an; const g = an.gone;
  if (g === null) return { run: 'en-' + r.spec.id, destroyed: false };
  const before = new Set(); const fr = an.run.frames;
  for (const l of fr.filter(l => l.f >= g - 12 && l.f < g)) for (const [pool, arr] of [['A', l.A], ['B', l.B]]) for (const o of arr) before.add(pool + o.a + ':' + o.ty);
  const appeared = []; const seenIds = new Set();
  for (const l of fr.filter(l => l.f >= g - 2 && l.f <= g + 8)) for (const [pool, arr] of [['A', l.A], ['B', l.B]]) for (const o of arr) {
    const id = pool + o.a + ':' + o.ty; if (before.has(id) || seenIds.has(id)) continue; seenIds.add(id);
    const later = fr.find(x => x.f === l.f + 2); const o2 = later ? (pool === 'B' ? later.B : later.A).find(x => x.a === o.a) : null;
    appeared.push({ f: l.f, pool, slot: o.a, type: hex(o.ty), subtype: hex(o.sub, 4), ...(pool === 'B' ? { hud03: o2 ? o2.v03 : o.v03, hudName: A.hudName(o2 ? o2.v03 : o.v03), height: o2 ? o2.h : o.h, hp: o2 ? o2.hp : o.hp, set: hex(o2 ? o2.set : o.set) } : {}) });
  }
  const hit = an.hits.length; const killed = r.an.run.events.find(e => e.killhp !== undefined);
  return { run: 'en-' + r.spec.id, destroyed: true, hpSetTo1At: killed ? killed.killhp : null, slotFreedAt: g, appeared };
}

// ---------------------------------------------------------------------------------------------------------------
// behaviour modes (+0x26 low byte): static dispatch table + stage census + m-* live runs
function modesOf(t, census) {
  const L = (LABELS.MODES || {})[t.id] || {};
  const cm = census.modes[t.id] || {};
  const runs = LIVE.EXTRA.filter(x => x.purpose === 'mode' && x.of && x.of.startsWith(t.id + '-') || (x.purpose === 'mode' && x.of === t.id));
  const playSummary = (x) => {
    const an = analyzeRun(x); if (!an || an.error) return null;
    const seq = an.plays.filter(p => p.kind).slice(0, 10).map(p => ({ anim: `${p.kind}:${p.anim}`, label: p.kind === 'main' ? labelFor(t, 'main', p.anim) : null, frames: p.end - p.start + 1, height0: p.xs[0][3], depth0: p.xs[0][2] }));
    return { run: 'en-' + x.id, subtype: hex(x.sub, 4), firstPlays: seq };
  };
  if (!t.modes) {
    const list = Object.entries(cm).map(([m, e]) => ({ mode: m, census: { lives: e.lives, where: e.where, examples: e.examples } }));
    return t.modeCode || list.length ? { dispatch: null, note: t.modeCode || 'no +0x26 low-byte dispatch found in the handler', seenInStages: list } : null;
  }
  const tbl = MD.findModeTables(...AT.rangeOf(t.handler)).find(x => x.at === t.modes.site || x.at === t.modes.site + 2);
  const entries = tbl ? tbl.entries.slice(0, t.modes.count) : [];
  const list = entries.map((routine, i) => {
    const mode = hex(i * 2, 2), e = cm[mode];
    const live = runs.filter(x => (x.sub & 0xFF) === i * 2).map(playSummary).filter(Boolean);
    // the variant captures whose debug subtype has this low byte (e.g. Hutori_C 0x408, Kameleon 6)
    const caps = t.variants.map(v => runsOf(v).main).filter(m => { const sub = m.sub !== undefined ? m.sub : parseInt((SPAWN.find(e => e.i === m.idx) || {}).subtype || '0', 16); return (sub & 0xFF) === i * 2; }).map(m => 'en-' + m.id);
    return { mode, routine: hex(routine), description: L[i * 2] ?? null, census: e ? { lives: e.lives, where: e.where, examples: e.examples } : { lives: 0, where: [] }, live, variantCaptures: caps,
      evidence: [e ? 'stage census' : null, live.length ? 'live mode run' : null, caps.length ? 'variant captures' : null].filter(Boolean) };
  });
  return { dispatch: tbl ? { site: hex(tbl.at), table: hex(tbl.tbl), shape: tbl.shape === 'A' ? 'move.w ($26,A6),D0; andi.w #$FF,D0; move.w tbl(pc,D0.w),D0; jsr tbl(pc,D0.w)' : 'move.b ($27,A6),D0; move.w tbl(pc,D0.w),D1; jmp tbl(pc,D1.w)', count: entries.length } : null, note: t.modeCode || null, list };
}

// ---------------------------------------------------------------------------------------------------------------
function buildType(t, census) {
  const variants = t.variants.map(v => variantFacts(t, v, census));
  const okv = variants.filter(v => !v.error);
  // (mode, brawl, ranged and kill runs are part of their variant's runs in variantFacts: their plays are in animsSeen)
  // census evidence: main-set animation indices in the first animations of each stage life (per variant)
  for (const v of okv) {
    v._censusAnims = new Map();
    for (const L of v._lives) for (const a of new Set(L.firstAnims.filter(x => /^\d+$/.test(x)).map(Number))) v._censusAnims.set(a, (v._censusAnims.get(a) || 0) + 1);
  }
  const anims = []; const recUse = new Map();   // key `${rec}|${pal}|sig` -> {rec, pal, variants}
  const recSig = (rec, pal, map) => { const r = R.parseRecord(rec); if (!r) return ''; const slots = pal !== null ? [pal] : [...new Set(r.blocks.map(b => b.pal))].sort((a, b) => a - b); return slots.map(sl => sl + '>' + map[sl]).join(','); };
  const addRec = (rec, pal, vid, map) => { const sig = recSig(rec, pal, map); const k = `${rec}|${pal === null ? '' : pal}|${sig}`; if (!recUse.has(k)) recUse.set(k, { rec, pal, map, sig, variants: new Set() }); recUse.get(k).variants.add(vid); };
  const setDone = new Map();
  const liveEntry = (v, seen, kind, idx) => {
    const census = kind === 'main' ? (v._censusAnims.get(idx) || 0) : 0;
    if (!seen && !census) return null;
    return { variant: v.id, plays: seen ? seen.plays : 0, runs: seen ? seen.runs : [], phases: seen ? seen.phases : [], states: seen ? seen.states : [], framesSeen: seen ? seen.framesSeen : [], censusLives: census };
  };
  for (const v of okv) {
    const pal = v.palette.p23.length && v.palette.p23[0].override !== null ? v.palette.p23[0].override : null; const map = v._map;
    const seenKeys = new Map(v.animsSeen.map(s => [s.key, s]));
    for (const [kind, T] of [['main', parseInt(v.set, 16)], ['held', parseInt(v.reactionSets.held, 16)], ['down', parseInt(v.reactionSets.down, 16)]]) {
      const s = A.decodeSet(T); const sk = `${kind}:${hex(T)}`;
      for (const an of s.anims) {
        if (an.empty) continue;
        const key = `${kind}:${hex(T)}:${an.index}`; const seen = seenKeys.get(key);
        for (const f of an.frames) for (const r of recsOfFrame(f)) if (r != null) addRec(r, pal, v.id, map);
        const le = liveEntry(v, seen, kind, an.index);
        if (setDone.has(sk + '|' + pal)) { const a = setDone.get(sk + '|' + pal).anims.find(x => x.index === an.index); if (a) { a.variants.push(v.id); if (le) a.live.push(le); } continue; }
        // an entry pointing at the same frames as an earlier entry of the set is an alias
        const first = s.anims.find(b => !b.empty && b.addr === an.addr);
        const alias = first && first.index !== an.index ? first.index : null;
        const label = alias !== null ? `same frames as anim ${alias}: ${labelFor(t, kind, alias) || '?'}` : labelFor(t, kind, an.index);
        anims.push({ name: `${t.id}.${kind}.${hex(T)}.${an.index}`, label, aliasOf: alias, kind, set: hex(T), index: an.index, variants: [v.id], palette: pal,
          frames: an.frames.map(frameJSON), attackWindow: attackWindow(an.frames), attackIds: kind === 'main' ? [...v._idAnims.entries()].filter(([, s2]) => s2.has(an.index)).map(([id]) => id).sort((a, b) => a - b) : [],
          loopTo: an.loopFrame, loopAddr: an.loopTo != null ? hex(an.loopTo) : null, decodeOk: an.ok, live: le ? [le] : [] });
      }
      setDone.set(sk + '|' + pal, { anims: anims.filter(a => a.set === hex(T) && a.kind === kind && a.palette === pal) });
    }
    // attack ids seen live with this animation for the other variants sharing the set
    for (const a of anims.filter(a => a.kind === 'main' && a.set === v.set && !a.variants.includes('_'))) for (const [id, s2] of v._idAnims) if (s2.has(a.index) && !a.attackIds.includes(id)) { a.attackIds.push(id); a.attackIds.sort((x, y) => x - y); }
    // projectile / weapon objects: decode the animations whose frames were seen live
    for (const o of v.objects) {
      if (!o.render) continue;
      for (const sHex of o.sets) {
        const T = parseInt(sHex, 16); if (!T || T >= R.prg.length) continue;
        const s = A.decodeSet(T);
        for (const an of s.anims) {
          if (an.empty || !an.frames.some(f => o.fps.includes(f.addr))) continue;
          const name = `${t.id}.object${o.type}.${hex(T)}.${an.index}`;
          if (anims.some(a => a.name === name)) { const a = anims.find(a => a.name === name); if (!a.variants.includes(v.id)) a.variants.push(v.id); continue; }
          const opal = o.p23.map(p => parseInt(p, 16)).find(p => p & 0x80); const op = opal ? opal & 0x1F : null;
          for (const f of an.frames) for (const r of recsOfFrame(f)) if (r != null) addRec(r, op, v.id, map);
          anims.push({ name, label: labelFor(t, 'object' + o.type, an.index) || `object ${o.type} anim ${an.index}`, kind: 'object', objectType: o.type, objectPool: o.pool, set: hex(T), index: an.index, variants: [v.id], palette: op,
            frames: an.frames.map(frameJSON), loopTo: an.loopFrame, loopAddr: an.loopTo != null ? hex(an.loopTo) : null, decodeOk: an.ok, live: [{ variant: v.id, runs: o.runs, framesSeen: an.frames.map((f, i) => o.fps.includes(f.addr) ? i : -1).filter(i => i >= 0) }] });
        }
      }
    }
  }
  // atlas keys: "<rec>" (or "<rec>p<slot>" with a +0x23 override) for the first colouring of a record, "<rec>@<variants>"
  // when another variant shows the same record in other colours (its home stage loads other palettes)
  const byRec = new Map();
  for (const e of recUse.values()) { if (!byRec.has(e.rec)) byRec.set(e.rec, []); byRec.get(e.rec).push(e); }
  for (const [rec, es] of byRec) es.forEach((e, i) => { e.key = (i === 0 ? String(rec) + (e.pal !== null ? 'p' + e.pal : '') : `${rec}${e.pal !== null ? 'p' + e.pal : ''}@${[...e.variants].join('+')}`); });
  for (const v of okv) {
    v.atlasKeyOverrides = {};
    for (const e of recUse.values()) if (e.variants.has(v.id) && e.key.includes('@')) v.atlasKeyOverrides[e.rec] = e.key;
  }
  // static attack ids: written by the type's handler (and the variant's own handler) or by the objects it creates
  for (const v of okv) v.attackIds = attackIdTable(t, v, anims);
  return { t, variants, anims, recUse, modes: modesOf(t, census) };
}

function attackIdTable(t, v, anims) {
  const writers = [{ by: 'self', handler: v._handler }];
  for (const o of t.objects || []) if (o.pool === 'B') { const h = AT.handlerOf(o.type); if (h) writers.push({ by: 'object ' + hex(o.type), handler: h, objType: o.type }); }
  const out = new Map();
  for (const w of writers) {
    const [s, e] = AT.rangeOf(w.handler);
    const ownR84 = w.by === 'self' ? v._r84 : (AT.writesR84(s, e)[0] || {}).value;
    for (const { id, at } of AT.staticAttackIds(s, e)) {
      const k = `${w.by}:${id}`;
      if (!out.has(k)) out.set(k, { attackId: id, by: w.by, handler: hex(w.handler), writtenAt: [], record: AT.record(id), r84: ownR84 !== undefined ? hex(ownR84, 2) : null,
        r84Note: w.by === 'self' ? 'the enemy\'s own +0x84' : ownR84 !== undefined ? `the object sets +0x84 = ${hex(ownR84, 2)} itself` : 'not written by the object: the pool-B slot keeps its previous occupant\'s +0x84 (free 0x48FC clears only 0x28 bytes); the prediction uses row 0' });
      out.get(k).writtenAt.push(hex(at));
    }
  }
  // live: ids seen in +0x58 (enemy or its objects) and measured hits
  const measured = new Map();
  for (const a of v.attacks) for (const h of a.hits) { if (!measured.has(h.attackId)) measured.set(h.attackId, []); measured.get(h.attackId).push({ damage: h.damage, lvl: h.lvl, attackerR84: h.attackerR84, path: h.path, run: h.run }); }
  return [...out.values()].sort((a, b) => a.attackId - b.attackId || a.by.localeCompare(b.by)).map(x => {
    const r84 = x.r84 !== null ? parseInt(x.r84, 16) : 0;
    const animsWithId = x.by === 'self' ? anims.filter(a => a.kind === 'main' && a.set === v.set && a.attackIds.includes(x.attackId)).map(a => a.index) : [];
    return { ...x, path: x.attackId === 106 ? '0x10EC4 (explosion)' : '0x116B2 or 0x11DCA', predicted: AT.predict(x.attackId, r84, v.lvl), liveAnims: animsWithId, measured: measured.get(x.attackId) || [] };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// colourings: every distinct set of ROM palettes a variant's records are drawn with in the stage census (stage/area
// palette map, or +0x23 override); the home colouring is the main atlas, the others get small extra atlases with only
// the records whose colours differ
function colouringsOf(v, usedSlots, spec) {
  const homeOverride = v.palette.p23.find(p => p.override !== null) ? v.palette.p23.find(p => p.override !== null).override : null;
  const tupleOf = (stage, area, override) => { const m = palMap(stage, area); const slots = override !== null ? [override] : usedSlots; return { override, roms: Object.fromEntries(slots.map(s => [s, m[s]])), sig: (override !== null ? 'p' + override + ':' : '') + slots.map(s => s + '>' + m[s]).join(',') }; };
  const groups = new Map();
  const add = (stage, area, override, src) => {
    const tp = tupleOf(stage, area, override);
    if (!groups.has(tp.sig)) groups.set(tp.sig, { key: `S${stage}A${area}` + (override !== null ? `-p${override}` : ''), stage, area, override, romPalettes: tp.roms, appearances: new Set(), lives: 0, sources: new Set() });
    const g = groups.get(tp.sig); g.appearances.add(`S${stage}A${area}` + (override !== null ? `-p${override}` : '')); g.lives += src === 'census' ? 1 : 0; g.sources.add(src);
  };
  add(v.palette.home.stage, v.palette.home.area, homeOverride, 'home');
  // only KING KIMO KIMO / TYROG 2 pick their palette by override (+0x26 high byte); other overrides are effects (the burning
  // reaction 0x84, the Mituryou mode-4 fade-in 0x8B -> 0x8F..0x91) and are not colourings
  for (const L of v._lives) add(L.stage, L.area, spec.colourBy === 'override' ? (overrideOf(L.p23) ?? homeOverride) : homeOverride, 'census');
  const homeSig = tupleOf(v.palette.home.stage, v.palette.home.area, homeOverride).sig;
  return [...groups.entries()].map(([sig, g]) => ({ key: g.key, home: sig === homeSig, stage: g.stage, area: g.area, override: g.override, romPalettes: g.romPalettes, appearances: [...g.appearances], censusLives: g.lives, sources: [...g.sources] }))
    .sort((a, b) => (b.home - a.home) || a.stage - b.stage || a.area - b.area || (a.override ?? -1) - (b.override ?? -1));
}

function writeType(b, validation, census) {
  const { t, variants, anims, recUse } = b;
  const okv = variants.filter(v => !v.error);
  // atlas
  const entries = [...recUse.values()].sort((a, b) => a.rec - b.rec || (a.pal ?? -1) - (b.pal ?? -1));
  const atlas = D.buildAtlas(entries.map(e => ({ key: e.key, rec: e.rec, pal: e.pal, map: e.map })), path.join(OUT, `${t.id}.png`));
  const highCodes = [];
  for (const e of entries) { const r = R.parseRecord(e.rec); if (r && r.blocks.some(bl => bl.code >= 0x8000)) highCodes.push(e.rec); }
  for (const fr of atlas.frames) { const e = entries.find(x => x.key === fr.key); fr.variants = [...e.variants]; }
  fs.writeFileSync(path.join(OUT, `${t.id}.atlas.json`), JSON.stringify({ image: `${t.id}.png`, width: atlas.W, height: atlas.H, orientation: 'native left-facing (mirror to face right)',
    palette: 'ROM palette set 0 at 0xB7A52, brightness F, through each variant\'s home stage/area palette map (0x8E8E); pal = 5-bit override (+0x23 bit 7) or null = per-block record palettes', origin: '(ox, oy) = record origin (feet) inside the frame box',
    frames: atlas.frames }, null, 1));
  const altAtlases = [];
  // record palettes, colourings and live palette check per variant
  for (const v of okv) {
    const pals = new Set(); const vEntries = entries.filter(e => e.variants.has(v.id));
    for (const e of vEntries) { const r = R.parseRecord(e.rec); if (r) for (const bl of r.blocks) pals.add(e.pal ?? bl.pal); }
    v.palette.recordPalettes = [...pals].sort((a, b) => a - b);
    v.palette.slots = Object.fromEntries(v.palette.recordPalettes.map(sl => {
      const by = {}; for (const [st, ar] of STAGE_AREAS) by[`S${st}A${ar}`] = palMap(st, ar)[sl];
      const distinct = [...new Set(Object.values(by))];
      return [sl, { home: v._map[sl], fixed: FIXED_SLOTS[sl], romPalettesByStageArea: FIXED_SLOTS[sl] ? undefined : by,
        colours: Object.fromEntries(distinct.map(n => [n, D.romPalette(n).map(c => '#' + c.map(x => x.toString(16).padStart(2, '0')).join(''))])) }];
    }));
    v.palette.source = v.palette.p23.some(p => p.override !== null) ? `override +0x23 = ${v.palette.p23.find(p => p.override !== null).value} (palette ${v.palette.p23.find(p => p.override !== null).override})` : 'record block attributes (no +0x23 override)';
    v.palette.liveCheck = ER.paletteCheck(v._an.run, v.palette.recordPalettes, v._captureMap);
    // records this variant can draw: every animation of its sets and objects, minus main anims that belong to another type
    const skip = new Set((t.otherTypeAnims || {}).anims || []);
    const usedRecs = new Set(anims.filter(a => a.variants.includes(v.id) && !(a.kind === 'main' && skip.has(a.index))).flatMap(a => a.frames.flatMap(f => f.composite ? (f.parts || []).map(q => q.rec) : [f.rec, f.rec2].filter(x => x != null))));
    const cEntries = vEntries.filter(e => usedRecs.has(e.rec));
    const usedSlots = [...new Set(cEntries.flatMap(e => { const r = R.parseRecord(e.rec); return r ? r.blocks.map(bl => bl.pal) : []; }))].sort((a, b) => a - b);
    const cols = colouringsOf(v, usedSlots, t.variants.find(x => x.id === v.id));
    for (const c of cols) {
      if (c.home) { c.atlas = { image: `${t.id}.png`, json: `${t.id}.atlas.json`, note: 'main atlas' }; continue; }
      const map = palMap(c.stage, c.area);
      const homeOv = v.palette.p23.find(p => p.override !== null); const homePal = homeOv ? homeOv.override : null;
      const pal = c.override !== null ? c.override : null;
      // records whose colours differ from the home colouring
      const diff = cEntries.filter(e => { const r = R.parseRecord(e.rec); if (!r) return false; const slotsH = (e.pal ?? null) !== null ? [e.pal] : r.blocks.map(bl => bl.pal); const slotsC = pal !== null ? [pal] : r.blocks.map(bl => bl.pal);
        return slotsH.some((s, i) => v._map[s] !== map[slotsC[i] ?? slotsC[0]]) || (pal !== null && pal !== homePal); });
      if (!diff.length) { c.atlas = null; continue; }
      const name = `${t.id}-${v.id.toLowerCase()}-${c.key.toLowerCase()}`;
      const at = D.buildAtlas(diff.map(e => ({ key: String(e.rec) + (pal !== null ? 'p' + pal : ''), rec: e.rec, pal, map })), path.join(OUT, name + '.png'));
      fs.writeFileSync(path.join(OUT, name + '.atlas.json'), JSON.stringify({ image: name + '.png', width: at.W, height: at.H, variant: v.id, colouring: c.key, stage: c.stage, area: c.area, override: c.override, appearances: c.appearances,
        orientation: 'native left-facing (mirror to face right)', note: `only the records whose colours differ from the main atlas (${t.id}.png, home ${v.palette.home.stage}/${v.palette.home.area}); the rest are drawn as in the main atlas`, frames: at.frames }, null, 1));
      c.atlas = { image: name + '.png', json: name + '.atlas.json', records: at.frames.length };
      altAtlases.push({ type: t.id, variant: v.id, colouring: c.key, image: name + '.png', json: name + '.atlas.json', rec: diff.map(e => e.rec), pal, map, frames: at.frames.length });
    }
    v.palette.colourings = cols;
  }
  // contact sheets (one per variant)
  for (const v of okv) {
    const rows = [];
    for (const an of anims.filter(a => a.variants.includes(v.id))) {
      const live = an.live.find(l => l.variant === v.id);
      const ev = live ? (live.plays ? 'LIVE x' + live.plays : '') + (live.censusLives ? (live.plays ? ' ' : '') + 'STAGES x' + live.censusLives : '') || 'LIVE' : 'NOT SEEN LIVE';
      const title = `${an.kind === 'object' ? 'OBJ ' + an.objectType : an.kind.toUpperCase()} ${an.set} #${an.index}\n${(an.label || '?').slice(0, 34)}\n${ev}`;
      rows.push({ title, frames: an.frames.map((f, i) => {
        const fr = { composite: f.composite, parts: f.composite ? f.parts.map(p => ({ rec: p.rec, dx: p.dx, dy: -p.dy })) : null, rec: f.rec, rec2: f.rec2 };
        return { img: D.frameImage(fr, an.palette, v._map), caption: `${i}:${f.composite ? 'C' : ''}${f.rec}${f.rec2 != null && !f.composite ? '+' + f.rec2 : ''} ${f.dur}${f.active ? '*' : ''}` };
      }) });
    }
    let maxW = 60, maxH = 60;
    for (const r of rows) for (const fr of r.frames) if (fr.img) { maxW = Math.max(maxW, fr.img.w); maxH = Math.max(maxH, fr.img.h); }
    D.contactSheet(rows, path.join(OUT, `${t.id}-${v.id.toLowerCase()}-sheet.png`), { cellW: Math.min(220, maxW + 16), cellH: Math.min(200, maxH + 22), maxCols: 10, title: `${t.id} ${v.id} ${v.hudName} set ${v.set} palettes S${v.palette.home.stage}A${v.palette.home.area}` });
  }
  // colourings sheet: idle frame of each variant in each of its colourings
  {
    const rows = [];
    for (const v of okv) {
      const idle = anims.find(a => a.kind === 'main' && a.set === v.set && a.index === 0 && a.frames.length);
      if (!idle) continue; const f = idle.frames[0];
      const fr = { composite: f.composite, parts: f.composite ? f.parts.map(p => ({ rec: p.rec, dx: p.dx, dy: -p.dy })) : null, rec: f.rec, rec2: f.rec2 };
      rows.push({ title: `${v.id} ${v.hudName}\n${v.palette.colourings.length} colouring(s)`, frames: v.palette.colourings.map(c => ({ img: D.frameImage(fr, c.override !== null ? c.override : idle.palette, palMap(c.stage, c.area)), caption: (c.home ? '*' : '') + c.key })) });
    }
    if (rows.length) { let maxW = 60, maxH = 60; for (const r of rows) for (const fr of r.frames) if (fr.img) { maxW = Math.max(maxW, fr.img.w); maxH = Math.max(maxH, fr.img.h); }
      D.contactSheet(rows, path.join(OUT, `${t.id}-colourings.png`), { cellW: Math.min(220, maxW + 24), cellH: Math.min(200, maxH + 22), maxCols: 10, title: `${t.id} colourings (* = home, main atlas)` }); }
  }
  // JSON
  const out = {
    type: t.id, title: t.title, objType: hex(t.objType), ...(t.otherTypeAnims ? { otherTypeAnims: t.otherTypeAnims } : {}), pool: 'B', handler: hex(t.handler), variantSelect: t.select, role: t.role, sequelKinds: t.sequel, behaviourSummary: t.behaviour || null,
    spawnEntries: [...new Set(t.variants.map(v => runsOf(v).main.idx))].map(i => SPAWN.find(e => e.i === i)),
    modes: b.modes,
    variants: variants.map(v => { const { _an, _runs, _map, _captureMap, _lives, _idAnims, _r84, _handler, _censusAnims, ...rest } = v; return rest; }),
    animations: anims, atlas: { image: `${t.id}.png`, json: `${t.id}.atlas.json`, records: entries.length, highCodeRecords: highCodes, colouringAtlases: altAtlases.map(a => ({ variant: a.variant, colouring: a.colouring, image: a.image, json: a.json, records: a.frames })) },
    damageModel: { formula: '0x116B2 / 0x11DCA: record = 0xA2EA4 + (attacker +0x58)*8; D = b0 * byte[0x2C3AE + (attacker +0x84)*8 + (lvl & 31)] >> 5; D -= word[0x2C896 + bracket(hero HP) + (random & 0x3E)] (D < 0 -> 1); D = D * word[0x2C88E + hero id*2] >> 5; D = D * word[0x2C996 + ((hero HP >> 2) & 0x1E)] >> 5 (0 -> 1); if hero HP != 1 and HP <= D < HP + 5: D = HP - 1; no damage when word 0xFF84AA != 0 and bit 1 of 0xFF8024 is set. Explosions (0x10EC4): b0 of the hero melee table [0xA26FC] + id*4, unmodified', tables: AT.tables(), predictionNote: 'predicted.jackFullHpByLevel = Jack at 100 HP for lvl 0..31; byHeroFullHp at the capture level' },
    conventions: { active: 'frame.active = b6 bit 2 set and w8 low byte != 0: every live hit on the hero landed on such a frame (INFERRED meaning: attack box active; w8 low byte = attack box id, high byte = body box id); attackWindow.windupFrames = durations before the first active frame', durations: '60 Hz frames (byte 7 & 0x7F of each 10-byte frame, V13)', frames: 'rec / rec2 drawn at the same origin; composite parts {rec, dx, dy} in screen pixels for the native left-facing art (dy down); mirror dx when facing right', loopTo: 'frame index the animation loops to after its last frame (null: loops outside this animation)', flags: 'b4 b5 b6 -> +0x2C..+0x2E, w8 -> +0x48 (meaning untraced, U10)', aliasOf: 'reaction-set entry that points at the same frames as an earlier entry', live: 'live[] per variant: plays in the en-* runs (runs), censusLives = stage walks whose first animations included it' },
  };
  fs.writeFileSync(path.join(OUT, `${t.id}.json`), JSON.stringify(out, null, 1));
  // validation
  const hitsOnActive = (() => { let n = 0, on = 0; for (const v of okv) for (const a of v.attacks) { if (a.byObject) continue; const [k, set, idx] = a.anim.split(':'); const an = anims.find(x => x.kind === k && x.set === set && x.index === +idx); if (!an) continue; for (const h of a.hits) { n++; if (h.animFrame != null && an.frames[h.animFrame] && an.frames[h.animFrame].active) on++; } } return { hits: n, onActiveFrame: on }; })();
  validation[t.id] = { variants: okv.map(v => ({ id: v.id, run: v.run, extraRuns: v.extraRuns.map(x => x.run), draw: v.drawCheck, hp: { live: v.hp.hpAtSpawn, maxField: v.hp.maxHpField, predicted: v.hp.atLevel, source: v.hp.source, ok: v.hp.ok }, palette: v.palette.liveCheck, init: v.init,
    damage: v.attacks.map(a => ({ anim: a.anim, paths: a.damagePaths.map(p => p.routine), measured: a.measuredDamage, predicted: a.hits.map(h => h.predictedMin === h.predictedMax ? h.predictedMin : `${h.predictedMin}-${h.predictedMax}`), ok: a.ok })), death: v.death })),
    hitsOnActiveFrames: hitsOnActive, errors: variants.filter(v => v.error).map(v => ({ id: v.id, error: v.error })), highCodeRecords: highCodes, unlabelled: anims.filter(a => !a.label).length,
    colouringAtlases: altAtlases.length };
  return { out, altAtlases };
}

// live OBJ palette RAM of every stage state (enemies-live.cjs --palettes) vs the static map 0x8E8E for that stage/area
function paletteMapCheck() {
  const out = [];
  for (const st of LIVE.PAL_STATES) {
    const r = ER.loadRun('en-pal-' + st); const l = r && r.events.find(e => e.hex);
    if (!l) { out.push({ state: st, error: 'run missing (node tools/re/export/enemies-live.cjs --palettes)' }); continue; }
    const map = palMap(l.stage + 1, l.area); let eq = 0;
    for (let k = 0; k < 32; k++) { let ok = true; for (let i = 0; i < 16; i++) { const lw = parseInt(l.hex.substr((k * 16 + i) * 4, 4), 16), rw = R.u16(R.PAL_TABLE + map[k] * 32 + i * 2); if ((lw & 0xFFF) !== (rw & 0xFFF)) { ok = false; break; } } if (ok) eq++; }
    out.push({ state: st, stage: l.stage + 1, area: l.area, slotsEqual: eq, of: 32 });
  }
  return out;
}
// every colouring vs the OBJ palette RAM dumped in the stage walk at a frame where that enemy was alive (bz-stage* frames.jsonl,
// palette dumped every 6 frames): checks the home stage/area choice and the override rule against real stage play
async function colouringLiveCheck(summaries, census) {
  const want = new Map();   // run -> Map(f -> [{type, variant, colouring, slots:{slot:rom}}])
  for (const s of summaries) for (const v of s.variants) {
    if (v.error) continue;
    for (const c of v.palette.colourings) {
      const lives = census.lives.filter(L => (CENSUS_TYPE[L.name] || L.name) === s.type && L.hud === v.hudName && L.stage === c.stage && L.area === c.area && (c.override === null ? !(L.p23[0] && parseInt(L.p23[0].p23, 16) & 0x80) : overrideOf(L.p23) === c.override) && L.frames >= 14).slice(0, 3);
      for (const L of lives) {
        const f = Math.ceil((L.first + 8) / 6) * 6; if (f > L.first + L.frames - 1) continue;
        if (!want.has(L.run)) want.set(L.run, new Map());
        const m = want.get(L.run); if (!m.has(f)) m.set(f, []);
        m.get(f).push({ type: s.type, variant: v.id, colouring: c.key, slots: c.override !== null ? { [c.override]: palMap(c.stage, c.area)[c.override] } : c.romPalettes });
      }
    }
  }
  const res = [];
  const readline = require('readline');
  for (const [run, m] of [...want.entries()].sort()) {
    const file = path.join(RUNS, run, 'frames.jsonl'); if (!fs.existsSync(file)) continue;
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      const mm = /^\{"f":(\d+),/.exec(line); if (!mm || !m.has(+mm[1])) continue;
      const j = JSON.parse(line); if (!j.pal) continue;
      for (const w of m.get(+mm[1])) {
        let eq = 0, n = 0;
        for (const [slot, rom] of Object.entries(w.slots)) { n++; let ok = true; for (let i = 0; i < 16; i++) { const lw = parseInt(j.pal.substr((+slot * 16 + i) * 4, 4), 16), rw = R.u16(R.PAL_TABLE + rom * 32 + i * 2); if ((lw & 0xFFF) !== (rw & 0xFFF)) { ok = false; break; } } if (ok) eq++; }
        res.push({ ...w, run, f: +mm[1], slotsEqual: eq, of: n });
      }
    }
  }
  return res.map(({ slots, ...r }) => r);
}
function evidenceIds() {
  const dir = path.join(OUT, 'evidence'); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort().map(x => { const j = JSON.parse(fs.readFileSync(path.join(dir, x), 'utf8')); return { label: x.replace(/\.json$/, ''), id: j.evidence_id, file: 'evidence/' + x }; });
}
// read every atlas PNG back and compare each frame box with a fresh render of its record
function atlasReadBack(summaries, alts) {
  const res = {};
  const check = (image, frames, mapOf) => {
    const png = R.readPNG(fs.readFileSync(path.join(OUT, image)));
    let ok = 0, bad = 0;
    for (const fr of frames) {
      const im = D.recordImage(fr.rec, fr.pal, mapOf(fr)); let same = im && im.w === fr.w && im.h === fr.h;
      for (let y = 0; same && y < fr.h; y++) for (let x = 0; x < fr.w; x++) { const q = (y * fr.w + x) * 4, p = ((fr.y + y) * png.w + fr.x + x) * 4; if (im.rgba[q + 3] !== png.data[p + 3] || (im.rgba[q + 3] && (im.rgba[q] !== png.data[p] || im.rgba[q + 1] !== png.data[p + 1] || im.rgba[q + 2] !== png.data[p + 2]))) { same = false; break; } }
      if (same) ok++; else bad++;
    }
    return { frames: frames.length, identical: ok, different: bad };
  };
  for (const sm of summaries) {
    const aj = JSON.parse(fs.readFileSync(path.join(OUT, sm.type + '.atlas.json'), 'utf8'));
    res[sm.type] = check(aj.image, aj.frames, fr => { const v = sm.variants.find(x => !x.error && fr.variants.includes(x.id)); return v ? palMap(v.palette.home.stage, v.palette.home.area) : D.IDENTITY; });
  }
  for (const a of alts) {
    const aj = JSON.parse(fs.readFileSync(path.join(OUT, a.json), 'utf8'));
    res[a.image.replace(/\.png$/, '')] = check(aj.image, aj.frames, () => palMap(aj.stage, aj.area));
  }
  return res;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const checks = romChecks();
  const bad = checks.filter(c => !c.ok);
  if (bad.length) { console.error('ROM check failed', bad); process.exitCode = 1; return; }
  const census = await CEN.build();
  fs.writeFileSync(path.join(OUT, 'census.json'), JSON.stringify(census, null, 1));
  const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const validation = { romChecks: checks, paletteMaps: paletteMapCheck(), evidence: evidenceIds() };
  const summaries = []; const alts = [];
  for (const t of TYPES) {
    if (only.length && !only.includes(t.id)) continue;
    const b = buildType(t, census);
    const { out, altAtlases } = writeType(b, validation, census);
    summaries.push(out); alts.push(...altAtlases);
    console.log(`${t.id}: ${out.variants.length} variants, ${out.animations.length} anims, ${out.atlas.records} records, ${altAtlases.length} colouring atlases`);
  }
  validation.atlasReadBack = atlasReadBack(summaries, alts);
  validation.colouringLiveCheck = await colouringLiveCheck(summaries, census);
  // damage: every measured hit on the hero (all runs) vs the exact model
  const allHits = summaries.flatMap(s => s.variants.filter(v => !v.error).flatMap(v => v.attacks.flatMap(a => a.hits.map(h => ({ type: s.type, variant: v.id, ...h })))));
  const byPath = {}; for (const h of allHits) { const k = h.path; byPath[k] = byPath[k] || { hits: 0, ok: 0 }; byPath[k].hits++; if (h.predictedMin !== null && h.damage >= h.predictedMin && h.damage <= h.predictedMax) byPath[k].ok++; }
  validation.damageSummary = { hits: allHits.length, byPath, mismatches: allHits.filter(h => !(h.predictedMin !== null && h.damage >= h.predictedMin && h.damage <= h.predictedMax)).map(h => ({ type: h.type, variant: h.variant, run: h.run, f: h.f, id: h.attackId, damage: h.damage, predicted: [h.predictedMin, h.predictedMax] })) };
  validation.counts = {
    types: summaries.length, variants: summaries.reduce((n, s) => n + s.variants.filter(v => !v.error).length, 0),
    contactSheets: summaries.reduce((n, s) => n + s.variants.filter(v => !v.error).length, 0), colouringSheets: summaries.length,
    animations: summaries.reduce((n, s) => n + s.animations.length, 0), atlasFrames: Object.values(validation.atlasReadBack).reduce((n, r) => n + r.frames, 0),
    mainAtlasFrames: summaries.reduce((n, s) => n + validation.atlasReadBack[s.type].frames, 0), colouringAtlases: alts.length,
    variantCaptures: summaries.reduce((n, s) => n + s.variants.filter(v => !v.error).length, 0), extraRuns: LIVE.EXTRA.length,
    censusLives: census.lives.length, censusRuns: census.runs.length,
  };
  fs.writeFileSync(path.join(OUT, 'validation.json'), JSON.stringify(validation, null, 1));
  if (!only.length) { require('./enemy-index.cjs').writeIndex(OUT, summaries, TYPES, LIVE, validation, census); pruneStale(summaries); }
}
// a full run removes generated .png/.json files of earlier runs that this run did not write (e.g. a colouring that no
// longer exists); REPORT.json and evidence/ are kept
function pruneStale(summaries) {
  const keep = new Set(['INDEX.md', 'validation.json', 'census.json', 'REPORT.json']);
  for (const s of summaries) {
    keep.add(`${s.type}.json`); keep.add(s.atlas.image); keep.add(s.atlas.json); keep.add(`${s.type}-colourings.png`);
    for (const a of s.atlas.colouringAtlases) { keep.add(a.image); keep.add(a.json); }
    for (const v of s.variants) if (!v.error) keep.add(`${s.type}-${v.id.toLowerCase()}-sheet.png`);
  }
  for (const f of fs.readdirSync(OUT)) if (/\.(png|json)$/.test(f) && !keep.has(f) && fs.statSync(path.join(OUT, f)).isFile()) { fs.unlinkSync(path.join(OUT, f)); console.log('removed stale', f); }
}
module.exports = { TYPES, speedTable, palMap, STAGE_AREAS };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
