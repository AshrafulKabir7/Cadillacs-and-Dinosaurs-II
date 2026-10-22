#!/usr/bin/env node
// Writes work/re/runtime/memory-map.json: the validated runtime memory map of the original Cadillacs & Dinosaurs
// (MAME romset "dino", World set, MAME 0.289). Every entry carries a status:
//   validated = changed by controlled input / poke and the predicted effect was observed (OBJ list, HUD, behaviour)
//   observed  = seen in RAM dumps or disassembly, consistent everywhere, but not separately poked
//   inferred  = meaning guessed from use
// and evidence: run names under work/re/runs/, snapshots, and REA evidence ids (work/re/runtime/evidence/*.json).
'use strict';
const fs = require('fs'), path = require('path');
const OUT = path.resolve(__dirname, '../../../work/re/runtime/memory-map.json');
const ev = n => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../work/re/runtime/evidence/${n}.json`), 'utf8')).evidence_id; } catch (e) { return null; } };
const E = n => `REA ${n} ${ev(n)}`;

const map = {
  meta: {
    game: 'Cadillacs & Dinosaurs (Capcom 1993, CPS-1, World set "dino")', mame: '0.289', ram: 'main RAM 0xFF0000-0xFFFFFF; A5 = 0xFFFF8000 everywhere, so (d16,A5) = 0xFF8000 + d16',
    timing: 'Values read from RAM at plan frame f-1 produce the OBJ list dumped at f, which is shown in snapshot f+1 (tools/re/mame/README.md).',
    statuses: { validated: 'poked or driven and the effect observed', observed: 'seen in dumps/disassembly, consistent', inferred: 'meaning guessed from use' },
    validation: 'tools/re/runtime/validate-all.cjs -> work/re/runtime/validation.json: 7,242 of 7,242 P1 frames, 18,100 of 18,490 enemy-object frames (11 types) and 4,817 of 4,818 item/weapon-object frames predicted exactly from RAM (every on-screen block: tile code, size, flip, screen x/y). The 390 enemy misses are whole objects not drawn on alternate frames (blinking), 0 partial mismatches; the 1 item miss is a food item already in its removal state (+0x04 = 6, eaten) in rt-val-stage5-mustapha frame 362.',
  },
  globals: [
    { addr: '0xFF8000', size: 'w', name: 'frame counter', desc: '+1 every game frame (addq at 0xA942 in the main loop)', status: 'validated', evidence: 'rt-p1-moves: +1 on 299 of 299 frames; ' + E('rt07-main-loop-state') },
    { addr: '0xFF84DA', size: 'b', name: 'frame counter (byte)', desc: '+1 every frame (0xA946)', status: 'observed', evidence: 'rt-p1-moves 299/299; ' + E('rt07-main-loop-state') },
    { addr: '0xFF801A..0xFF801F', size: 'b', name: 'input mirrors', desc: '0xFF801B = P1 input bits (R 1, L 2, D 4, U 8, attack 0x10, jump 0x20)', status: 'observed', evidence: 'rt-spawn-rifle frames 22-24 (0x10 while attack held)' },
    { addr: '0xFF847D', size: 'b', name: 'credits', desc: '0 -> 1 -> 2 with two coins, -> 1 after 1P start', status: 'observed', evidence: 'rt-credits frames 325/345/370/395' },
    { addr: '0xFF84D0', size: 'b', name: 'main game state', desc: 'index x4 into 0xA958: 0 title/attract (0xA978), 4 character select (0xAD46), 8 intermission/story + stage title (0xD898), 0xC gameplay (0xAAF6), 0x10 0xE9E6, 0x14 0xAC06, 0x18 0xAC26, 0x1C ending (0xAC48, set by stage clear when stage == 7)', status: 'validated', evidence: 'rt-boot-state (0 -> 4 at boot frame 394 -> 0xC at 640); writing 8 starts the next stage (rt-warp-live-s3, rt-warplive-cheat); ' + E('rt07-main-loop-state') + '; ' + E('rt08-stage-clear') },
    { addr: '0xFF84D1 / 0xFF84D2', size: 'b / w', name: 'main sub-states', desc: 'cleared by the stage-clear code before state 8', status: 'observed', evidence: E('rt08-stage-clear') },
    { addr: '0xFF84D9', size: 'b', name: 'stage (0-7 = EPISODE 1-8)', desc: 'read by ~150 code sites; stage clear does +1 & 7 (0xABE8); title cards confirm 1 = "EPISODE 2 THE SWAMP FOREST", 3 = "EPISODE 4 JACK\'S GARAGE", 4 = "EPISODE 5 VILLAGE OF FLAME", 7 = "EPISODE 8 THE UNDER WORLD"', status: 'validated', evidence: 'rt-warp-s1/-s4/-s7 (warp-titles.png), rt-warp-live-s3, stage<N>-<hero> states (states.json); ' + E('rt08-stage-clear') + '; ' + E('rt22-debug-stage-select') },
    { addr: '0xFF8786', size: 'b', name: 'area within the stage (0-based)', desc: '= stage controller +0x4A. Areas per stage in the script table 0x21B2A: 3,3,1,3,2,3,4,4 (EPISODE 1..8). Areas the warpArea cheat can enter (first segment has camera trigger 0): E1 a1,a2; E2 a2; E4 a1,a2; E6 a1; E7 a1,a2,a3; E8 a1,a2', status: 'validated', evidence: 'rt-bot-s1-tap write taps (0 -> 1 at PC 0x20C94 frame 962, 1 -> 2 at PC 0x20D5C frame 2252), rt-warparea-* (warparea-sheet.png); ' + E('rt11-area-change') },
    { addr: '0xFF84E8', size: 'w', name: 'stage timer (BCD minutes, seconds)', desc: 'counts down one "second" every 50 frames (tick byte 0xFF84EA reset to 0x32 at 0x103F2); start value per stage from 0x1033E; at 0:00 the player dies ("time over")', status: 'observed', evidence: 'rt-bot-s1 (0x0120 -> 0x0000 at ~4200 then the hero died), HUD "0:57" in rt-invuln snap 1200; ' + E('rt20-stage-timer') },
    { addr: '0xFF84E6', size: 'b', name: 'starting lives setting (copy)', desc: 'from 0xFFF77C & 3 (configuration / DIP), also written to each hero +0xA3 at game start (0x4DD6)', status: 'observed', evidence: E('rt23-lives-init-dip') },
    { addr: '0xFF0ECC / 0xFF0ECD-0xFF0ECF', size: 'b', name: 'HUD score refresh flags (any / P1-P3)', desc: 'set by the score-add routine (0xFF9A / 0xFFE8-0x10002); setting them after poking a score redraws it', status: 'validated', evidence: 'rt-score-cheat (HUD shows 123450; hud-cheats-sheet.png); ' + E('rt06-score-add') },
    { addr: '0xFF8744 / 0xFF8748', size: 'w', name: 'camera X / camera Y', desc: 'stage controller +0x08/+0x0C. screen feetX = X - camX, screen feetY = camY - (depth + height) + 240 (RAM one frame before the OBJ dump)', status: 'validated', evidence: 'predict.cjs over 28 runs (7,242 P1 frames, depth and height changing), rt-p1-pokes' },
    { addr: '0xFFE9B4 / 0xFFE9B6 / 0xFFE9B8', size: 'w', name: 'OBJ buffer toggle / camX-64 / camY', desc: 'sprite builder copies used by the draw code (0x1426E)', status: 'observed', evidence: E('rt17-draw-transform') },
    { addr: '0xFF844A', size: 'b', name: 'fade counter', desc: 'set to 0xF when an area exit starts (0x20C54); the area loads when it reaches 0', status: 'observed', evidence: 'rt-areawarp-1/-2 dumps (0x0F -> 0x00)' },
  ],
  stageController: {
    base: '0xFF873C', desc: 'scrolling / script controller of the current stage (lea ($73c,A5),A6 in 0x206D4.., 0x20C9A ..)',
    fields: [
      { off: '0x05', name: 'state = state byte of the last triggered script segment (0 free, 1 area exit, 4 enemy wave/lock, 0xB/0x11/0x12 scripted scenes ...)', status: 'observed', evidence: 'rt-bot-s1-ctrl (0 -> 11 -> 0 -> 4 -> 1 -> area change)' },
      { off: '0x06', name: 'sub-state (state 1: 0 init, 2 wait for exit, 4 fade, 6 load next area, 8)', status: 'validated', evidence: 'rt-areawarp-1/-2' },
      { off: '0x08 / 0x0C', name: 'camera X / Y (0xFF8744 / 0xFF8748)', status: 'validated' },
      { off: '0x4A', name: 'area (0xFF8786)', status: 'validated' },
      { off: '0x4C..0x54', name: 'words 0..4 of the current segment', status: 'observed', evidence: '0x209C0' },
      { off: '0x56', name: 'pointer to the next script segment (long, 0xFF8792)', status: 'validated', evidence: 'rt-bot-s1-ctrl, rt-areawarp-*' },
      { off: '0x6C', name: 'index of the next segment (0xFF87A8)', status: 'validated' },
      { off: '0x6D', name: '"exit reached" flag; with state 1.2 it starts the fade to the next area (0xFF87A9)', status: 'validated', evidence: 'rt-areawarp-1/-2' },
    ],
    scriptTable: { addr: '0x21B2A', desc: 'word offset per stage -> 16-byte segments: +0 camera-X trigger, +2..+8 camera/limit words, +0xA area, +0xB state, +0xC..+0xF flags. A segment fires when camX reaches its trigger; an area starts at a segment whose trigger is 0', evidence: E('rt10-segment-table') + '; rt-bot-s1-ctrl (triggers 896/1032/1120/1232/1408 fired at camX 897/1040/1122/1232/1408)' },
    heroStartTable: { addr: '0x4E56', desc: 'word offset per stage, then per area 3 players x (X, height, depth); stage 1 area 0 P1 = (1056, 0, 296) = the stage1-* states', evidence: E('rt24-hero-start-table') + '; ' + E('rt09-start-positions') },
  },
  player: {
    base: '0xFFB274', stride: '0x180', slots: 3, p2: '0xFFB3F4', p3: '0xFFB574', p2p3status: 'observed in code (0x6714 loop, 0xAB070), not run-time tested',
    fields: [
      { off: '0x00', size: 'b', name: 'active / vulnerability', desc: '0 empty, 1 playing and hittable, 2 playing but not hittable (only objects with 1 are put in the hit list at 0x4AC2); set to 2 with +0xF9 or +0xEC running', status: 'validated', evidence: 'rt-invuln (0 hits in 1,500 frames vs 7 in rt-noinvuln), rt-ec-timer; ' + E('rt05-hittable-register') + '; ' + E('rt04-invuln-set') },
      { off: '0x01', size: 'b', name: 'drawn (registered for sprites)', status: 'observed' },
      { off: '0x02', size: 'b', name: 'player number (0 = P1)', status: 'observed' },
      { off: '0x03', size: 'b', name: 'character id: 0 Jack, 1 Mustapha, 2 Hannah, 3 Mess (not the select-screen order)', status: 'observed', evidence: 'rt-p1-moves-* frame 50' },
      { off: '0x04', size: 'b', name: 'state: 0 init, 2 alive, 4 dead (respawn sequence)', status: 'observed', evidence: 'rt-die2 / rt-lives-cheat (2 -> 4 at the death, back to 2 at respawn)' },
      { off: '0x05', size: 'b', name: 'reaction: 0 normal, 2 hurt, 4 knocked down / dying', status: 'observed', evidence: 'rt-die2 frame 620 (0x0202), 660 (0x0402)' },
      { off: '0x06', size: 'b', name: 'action: 0 stand, 2 walk, 4 jump, 0x20 hit, ...', status: 'observed', evidence: 'rt-p1-moves' },
      { off: '0x07', size: 'b', name: 'action step: 4 punch, 6/8/0xC combo/throw steps, 0x0E end of the intro blast, 0x14 picking up, 0x16 firing', status: 'observed', evidence: 'rt-p1-moves, rt-fight, rt-spawn-rifle' },
      { off: '0x08', size: 'l', name: 'world X (16.16; integer word at +0x08)', status: 'validated', evidence: 'rt-p1-pokes frame 20 (+40 -> sprite +34 and camera +6), predict.cjs' },
      { off: '0x0C', size: 'l', name: 'height above ground Z (16.16, up positive)', status: 'validated', evidence: 'rt-p1-pokes frame 80 (Z 40 -> feet 40 px higher, then falls with record 218), jumps in rt-p1-moves' },
      { off: '0x10', size: 'l', name: 'depth Y / lane (16.16, up = farther; 296 at the stage 1 start)', status: 'validated', evidence: 'rt-p1-pokes frame 50 (296 -> 330 = feet 34 px up), rt-p1-moves up/down' },
      { off: '0x14', size: 'w', name: 'X velocity (8.8 px/frame; walk: Jack 414, Hannah 422, Mustapha 435, Mess 409)', status: 'observed', evidence: 'rt-p1-moves-*' },
      { off: '0x16', size: 'w', name: 'Z velocity (8.8, jump starts at 0x055B)', status: 'observed' },
      { off: '0x18', size: 'w', name: 'depth velocity (8.8, +0xEC up / -0xEC down)', status: 'observed' },
      { off: '0x1C', size: 'w', name: 'gravity (8.8 per frame, -0x4A while airborne)', status: 'observed' },
      { off: '0x20', size: 'w', name: 'object type = character id x 4', status: 'observed' },
      { off: '0x22', size: 'b', name: 'stick direction in 32nds (0 up, 8 right, 0x10 down, 0x18 left, 0xFF none)', status: 'observed', evidence: 'rt-p1-moves' },
      { off: '0x23', size: 'b', name: 'palette override (bit 7: low 5 bits replace every block palette)', status: 'observed (static: 0x142E8)' },
      { off: '0x24', size: 'b', name: 'facing: 0 = art as stored (faces left), 1 = mirrored (faces right)', status: 'validated', evidence: 'rt-p1-pokes frames 120/150 (OBJ flipX follows)' },
      { off: '0x25', size: 'b', name: 'draw flags (bit0 split torso/legs, bit7 screen space)', status: 'observed (static)' },
      { off: '0x28', size: 'l', name: 'animation frame pointer (ROM). Current frame record = word[ptr] / 4 when word >= 0 (plus word[ptr+2] / 4 when >= 0), record index into the table at 0xD0CF4', status: 'validated', evidence: 'predict.cjs: 7,242/7,242 frames in 28 runs, 4 heroes, weapons; ' + E('rt17-draw-transform') },
      { off: '0x2C..0x2E', size: 'b x3', name: 'frame bytes 4..6 of the current animation frame', status: 'validated', evidence: 'anim-check.cjs: 299/299 per hero run' },
      { off: '0x2F', size: 'b', name: 'frames left on the current animation frame (ROM byte 7 & 0x7F on entry, -1 per frame, 0 = advance; frozen during hit-stop)', status: 'validated', evidence: 'anim-check.cjs: every advance sets it to the ROM duration, every other frame -1 or unchanged (hit-stop); ' + E('rt18-anim-driver') },
      { off: '0x48', size: 'w', name: 'frame word 8 of the current animation frame', status: 'observed' },
      { off: '0x5E', size: 'b', name: 'attack press counter (+1 per attack)', status: 'inferred', evidence: 'rt-p1-moves / rt-fight' },
      { off: '0x60', size: 'w', name: 'frame word 10; high byte = weapon hold index', status: 'observed (static 0x144C)' },
      { off: '0x6A / 0x6C / 0x6E', size: 'w', name: 'max HP / HP / HP shown in the HUD bar (100 each)', status: 'validated', evidence: 'rt-die2 (HP poked to 1, first hit kills: 1 -> 0, death, lives 1 -> 0), rt-infhp; ' + E('rt01-player-init') },
      { off: '0x70', size: 'w', name: 'partner object (grab / last hit)', status: 'inferred' },
      { off: '0xA0 / 0xA1', size: 'b', name: 'P1 input this frame / last frame (R 1, L 2, D 4, U 8, attack 0x10, jump 0x20)', status: 'observed', evidence: 'rt-spawn-rifle 18-26, rt-p1-moves 28-34' },
      { off: '0xA3', size: 'b', name: 'lives left (HUD "=N")', status: 'validated', evidence: 'rt-die2 (1 -> 0, HUD =1 -> =0), rt-lives-cheat (poke 5, death -> 4, HUD =4); ' + E('rt02-lives-death') },
      { off: '0xB4', size: 'w', name: 'held weapon object (low word of its pool-A slot address, 0 = empty hands)', status: 'validated', evidence: 'rt-spawn-rifle (0 -> 0x99B4 at pick-up), rt-give-* (15 weapons)' },
      { off: '0xB6', size: 'w', name: 'held weapon class (copy of weapon +0xA0)', status: 'validated', evidence: 'rt-give-*' },
      { off: '0xC4', size: 'b', name: 'fire request (consumed by the weapon, 0x251F4)', status: 'observed (static)' },
      { off: '0xEC', size: 'w', name: 'invulnerability timer (0x168 after a respawn, 0xB4 elsewhere); -1 per frame, at 0 sets +0x00 = 1', status: 'validated', evidence: 'rt-ec-timer (poke 900 -> not hittable until frame 910, first hit 1036), rt-die2; ' + E('rt03-invuln-timers') },
      { off: '0xF9', size: 'b', name: 'second invulnerability timer (0x3C after the stage intro blast, 0x78 at 0x8C776); same rule', status: 'validated', evidence: 'rt-p1-moves (0x38 at frame 5 -> 0 at 60, +0x00 back to 1), rt-invuln (held at 0x3C)' },
      { off: '0x100', size: 'l', name: 'score (BCD, abcd at 0xFFBE)', status: 'validated', evidence: 'rt-fight (0 -> 0x1800 = HUD 1800), rt-score-cheat; ' + E('rt06-score-add') },
      { off: '0x110', size: 'l', name: 'score copy (extend threshold?)', status: 'inferred', evidence: 'rt-fight: follows +0x100' },
    ],
  },
  pools: {
    note: 'Every object slot shares the header above (+0x00 active, +0x04 state, +0x08/+0x0C/+0x10 position, +0x20 type, +0x24 facing, +0x26 subtype, +0x28 frame pointer, +0x6A/6C/6E HP). Free lists: count word + pointer word; alloc pops (0x4818..), free pushes back and clears the first 0x28 bytes (0x48D4..).',
    A_items_weapons: { base: '0xFF8874', slots: 24, stride: '0xC0', freeCount: '0xFFE5F4', freePtr: '0xFFE5FE', alloc: '0x4818', status: 'validated', evidence: 'rt-give-* (allocated slot 0xFF99B4 = slot 23, the game ran the init and the hero picked it up); ' + E('rt12-pool-alloc-free') },
    B_enemies: { base: '0xFFC8F4', slots: 24, stride: '0xE0', freeCount: '0xFFE5F8', freePtr: '0xFFE602', alloc: '0x483C', run: '0x23420 (no global skip flag)', status: 'validated', evidence: 'predict.cjs pool mode, census.cjs; ' + E('rt19-enemy-run-loop') },
    C_special: { base: '0xFFB6F4', slots: 24, stride: '0xC0', freeCount: '0xFFE5F6', freePtr: '0xFFE600', alloc: '0x4860', status: 'observed' },
    D_effects: { base: '0xFF9A74', slots: 48, stride: '0x80', freeCount: '0xFFE5FA', freePtr: '0xFFE604', status: 'observed (static)' },
    spawner: { addr: '0x88D76', desc: 'debug spawn list 0x88DDA (26-byte entries: 16-char name, class (pool = class & 7: 0 B, 1 C, 3 A), type -> +0x20, subtype -> +0x26, +0x5C, +0x96); copies X/height/depth from the spawning object', evidence: E('rt13-spawner') },
  },
  enemy: {
    pool: 'B (0xFFC8F4, 24 x 0xE0)',
    fields: [
      { off: '0x00', name: 'active: 1 normal, 2 not hittable (hit-stun / knocked down), 0 free', status: 'observed', evidence: 'rt-enemies slot 21' },
      { off: '0x03', name: 'variant', status: 'observed' },
      { off: '0x04', name: 'state: 0 init, 2 alive, 4 dying (blinks, then frees itself), 6 removed now (ENEMY CLEAR)', status: 'validated', evidence: 'rt-enemies / rt-enemy-hp1 (2 -> 4 -> freed), rt-killall; ' + E('rt14-enemy-clear') },
      { off: '0x05', name: 'reaction (2 hurt, 6 knocked down)', status: 'observed' },
      { off: '0x08 / 0x0C / 0x10', name: 'X / height / depth (same as the hero)', status: 'validated', evidence: 'predict.cjs: all on-screen blocks matched for 11 types' },
      { off: '0x20', name: 'type (x4 index into the pool-B handler table 0x2346C; names in enemy-census.json)', status: 'observed' },
      { off: '0x24', name: 'facing', status: 'validated' },
      { off: '0x26', name: 'subtype (e.g. Chinpira_A 0, _B 0x200, _C 0x400)', status: 'observed' },
      { off: '0x28', name: 'animation frame pointer -> current record (same rule as the hero)', status: 'validated', evidence: 'validation.json poolBByType' },
      { off: '0x2F', name: 'frames left on the animation frame', status: 'validated', evidence: 'anim-check.cjs rt-enemies FFDB54: 70/70 advances' },
      { off: '0x6A / 0x6C / 0x6E', name: 'max HP / HP / shown HP (Chinpira in stage 1: 44)', status: 'validated', evidence: 'rt-enemy-hp1: HP poked to 1 -> first hit (frame 462) kills it, freed at 677 instead of 4 hits and 697 in rt-enemies' },
    ],
    types: 'work/re/runtime/enemy-census.json (types seen in stages 1-8 with debug names from 0x88DDA, HP, subtypes and record ranges)',
  },
  weapons: {
    hero: 'P1+0xB4 -> weapon object in pool A; P1+0xB6 = class',
    object: [
      { off: '0x26', name: 'weapon id (subtype); the item init switch at 0x24D60 and the HUD name table at 0x23CDE are both indexed by it', status: 'validated' },
      { off: '0x6A / 0x6C', name: 'max / remaining ammo (guns) or uses (melee, throwables); -1 per shot at 0x25212; at 0 a gun becomes class 0x203 (blunt)', status: 'validated', evidence: 'rt-spawn-rifle (6 -> 5 -> 4 per shot), rt-give-* (ammo override 9 shown in the HUD); ' + E('rt21-ammo-decrement') },
      { off: '0x70', name: 'holder object (0xB274 = P1)', status: 'validated' },
      { off: '0xA0', name: 'class: 0x201 throwable, 0x202 blade, 0x203 blunt, 0x204 pistol, 0x205 rifle, 0x206 smg, 0x207 m16, 0x208 shotgun, 0x209 bazooka', status: 'validated' },
      { off: '0x04 / 0x05', name: 'state 2; sub 0 on the ground, 4 being picked up, 8 held', status: 'observed', evidence: 'rt-spawn-rifle' },
    ],
    ids: [
      ['0x00', 'RIFLE', 'rifle', '0x205', 6], ['0x02', 'GUN', 'gun', '0x204', 6], ['0x04', 'KNIFE', 'knife', '0x202', 6], ['0x06', 'UZI', 'uzi', '0x206', 48],
      ['0x08', 'M-16A1', 'm16', '0x207', 48], ['0x0A', 'SHOT GUN', 'shotgun', '0x208', 6], ['0x0C', 'BAZOOKA', 'bazooka', '0x209', 4], ['0x0E', 'ROD', 'rod', '0x203', 10],
      ['0x10', 'STICK', 'stick', '0x202', 6], ['0x12', 'B. KNIFE', 'bknife', '0x203', 6], ['0x14', 'CLUB', 'club', '0x203', 10], ['0x16', 'TORCH', 'torch', '0x203', 10],
      ['0x18', 'DYNAMITE', 'dynamite', '0x201', 10], ['0x1A', 'GRENADE', 'grenade', '0x201', 10], ['0x1C', 'STONE', 'stone', '0x201', 10],
    ].map(([id, hud, cheat, cls, ammo]) => ({ id, hudName: hud, cheatName: cheat, class: cls, defaultAmmoOrUses: ammo })),
    idsEvidence: 'rt-give-<weapon> runs: HUD shows the name for every id (give-hud-sheet.png), hero holds/uses it (give-hold-sheet.png); class and default ammo read back from the 60 stage1-<hero>-armed-<weapon> states (states.json); ' + E('rt15-item-init') + '; ' + E('rt16-hud-weapon-names') + '; ' + E('rt16b-weapon-name-strings'),
  },
  cheats: {
    file: 'tools/re/runtime/cheats.cjs (plan.cheats in tools/re/runtime/rt.cjs plans)',
    list: [
      { cheat: 'invuln', how: 'each frame P1+0x00 = 2 and +0xF9 = 0x3C (the game own invulnerability)', validation: 'rt-invuln: 0 HP drops / 0 hurt states in 1,500 frames walking into a Chinpira; rt-noinvuln: 7 hits, HP 100 -> 35; invuln-sheet.png' },
      { cheat: 'infhp', how: 'P1+0x6C = +0x6A each frame', validation: 'rt-infhp: hurt states still happen, HP back to max the next frame' },
      { cheat: 'lives', how: 'P1+0xA3 = value', validation: 'rt-lives-cheat: 5, death -> HUD =4 (hud-cheats-sheet.png)' },
      { cheat: 'score', how: 'P1+0x100 = BCD value, 0xFF0ECC/0xFF0ECD = 1', validation: 'rt-score-cheat: HUD 123450' },
      { cheat: 'give', how: 'pop a pool-A slot like 0x88D76 (type 0, subtype = weapon id) at the hero feet, ammo after init, attack held 3 frames', validation: 'rt-give-<weapon> x 15: hook.jsonl ok=true, HUD name and ammo 9 (give-hud-sheet.png, give-hold-sheet.png)' },
      { cheat: 'warp', how: 'stage byte 0xFF84D9 = N-1 while 0xFF84D0 == 4 (select)', validation: 'stage<N>-jack/-mustapha N = 2..8 (states.json, stage-states-sheet.png); rt-warp-s1/-s4/-s7 title cards (warp-titles.png)' },
      { cheat: 'warpLive', how: 'stage byte N-1, area 0, 0xFF84D1 = 0, 0xFF84D2 = 0, 0xFF84D0 = 8', validation: 'rt-warp-live-s3 (EPISODE 4), rt-warplive-cheat (EPISODE 6)' },
      { cheat: 'warpArea', how: 'controller 0xFF8792 = first zero-trigger segment of the area, 0xFF87A8 = its index, 0xFF87A9 = 1, 0xFF8742 = 2, 0xFF8741 = 1', validation: 'rt-warparea-* (E1 a2, E2 a2, E4 a2, E6 a1, E8 a1, E8 a2; warparea-sheet.png), rt-areawarp-1/-2' },
      { cheat: 'killAll', how: 'spawn pool-B type 0x24 (ENEMY CLEAR, 0x3B7D6)', validation: 'rt-killall: every pool-B object gone at frame 200 (killall-freeze-sheet.png)' },
      { cheat: 'freeze', how: 'restore every active pool-B slot to its bytes at freeze start, each frame', validation: 'rt-freeze: Chinpira fixed at x 1209 / record 2422 frames 150-450, moves after' },
    ],
  },
  saveStates: 'work/re/runtime/states.json (76 new states in E:/tools/mame/states/dino/)',
};
fs.writeFileSync(OUT, JSON.stringify(map, null, 1));
console.log('wrote', OUT);
