// Gameplay labels for the hero animations, per hero.
// Sources, strongest first:
//   1. live: the anim was started in a labelling / armed / team-up / victory / car run (lib/live.cjs write taps).
//      A start = a write of +0x28 (or +0x30 for legs) that jumps to the first frame of an anim from outside that anim.
//      The caller's return address names the code path (CALLERS). Starts made by a state handler that the dispatcher
//      reached (return address 0x18E78) are named by the state bytes (STATE_STARTS). When several anims share the
//      first frame (identical data), the call site (static D0) or the state picks the one the game started.
//   2. table: weapon-list (0x168E) anims selected through the class-indexed tables (stance 0x5C36, walk torso 0x5D2C,
//      run torso 0x1A15C, attack 0x5EDE, SMG walk-fire 0x5FF2, run attack 0x1A228, container jumps 0x1A902 / 0x1B0C6 /
//      0x1B0F2).
//   3. static: the call site in the shared player code that starts this anim index (SITES), checked per hero for
//      reachability (an index can be dead for one hero: e.g. a hero is never the partner of his own team-up move).
//   4. visual: what the hero's own records show (VISUAL, per hero), always attached as `looks`.
// Nothing is copied from one hero to another by index alone.
'use strict';

// caller (return address of the jsr that started the anim, live) -> meaning
const CALLERS = {
  '0x1916E': { name: 'idle / weapon stance', trigger: 'standing still (0x19168 jumps to 0x5BDC: plain idle, or the weapon list anim for the held class)', state: '2.0.0.0' },
  '0x19708': { name: 'idle (end of mega crash)', trigger: 'mega crash finished (state 0x0E ends)', state: '2.0.0.E' },
  '0x18AA2': { name: 'idle (player init)', trigger: 'player slot init (state 0)', state: '0.0.0.0' },
  '0x18B1A': { name: 'seated in the Cadillac', trigger: 'player init at the area-0 start of EPISODE 2 / 4 (0x18AB6, stage byte 1 or 3): the first present player rides in the arriving Cadillac (state 2.0.4.32), then jumps out with main 4', state: '0.0.0.0' },
  '0x18B9E': { name: 'idle (respawn finished)', trigger: 'respawn drop-in landed', state: '0.2.0.2' },
  '0x18C04': { name: 'respawn / join drop-in (somersault from the top of the screen)', trigger: 'new life after a death, or a player joining', state: '0.2.4.2' },
  '0x192DE': { name: 'walk', trigger: 'stick held (0x5CA6: plain walk, or split body: weapon torso + legs main 0x10)', state: '2.0.0.2' },
  '0x193BE': { name: 'walk legs (split body)', trigger: 'walking with a weapon: legs main 0x10 started at the walk phase', state: '2.0.0.2', legs: true },
  '0x193DA': { name: 'punch 1 (start)', trigger: 'attack on the ground', state: '2.0.0.4' },
  '0x19430': { name: 'punch 1 (jab)', trigger: 'attack on the ground (attack released)', state: '2.0.0.4' },
  '0x19426': { name: 'punch 1 (quick jab)', trigger: 'attack still held on the next frame', state: '2.0.0.4' },
  '0x193EA': { name: 'punch 1 (repeated jab, nothing hit)', trigger: 'attack again while the jab whiffs', state: '2.0.0.4' },
  '0x194AE': { name: 'idle (after punch 1)', trigger: 'jab finished', state: '2.0.0.6' },
  '0x19516': { name: 'combo hit 2 (start)', trigger: 'attack after punch 1 connected', state: '2.0.0.6' },
  '0x19558': { name: 'combo hit 2 (jab)', trigger: 'attack after punch 1 connected', state: '2.0.0.6/8' },
  '0x1954E': { name: 'combo hit 2 (quick jab)', trigger: 'combo hit 2 with attack held', state: '2.0.0.8' },
  '0x19574': { name: 'combo hit 3 (start)', trigger: 'attack after hit 2 connected', state: '2.0.0.6' },
  '0x195AE': { name: 'combo hit 3', trigger: 'combo continues', state: '2.0.0.A' },
  '0x19632': { name: 'combo hit 4 (start)', trigger: 'attack after hit 3 connected', state: '2.0.0.6' },
  '0x1966A': { name: 'combo finisher (hit 4)', trigger: 'combo continues', state: '2.0.0.C' },
  '0x196F2': { name: 'mega crash (special: attack + jump)', trigger: 'attack + jump together on the ground (costs HP; also drops a held weapon)', state: '2.0.0.E' },
  '0x1AAFA': { name: 'mega crash (special: attack + jump)', trigger: 'attack + jump together (Mustapha path)', state: '2.0.0.E' },
  '0x197A2': { name: 'dash attack (run + attack)', trigger: 'attack while running', state: '2.0.0.10' },
  '0x1AC54': { name: 'dash attack (run + attack)', trigger: 'attack while running', state: '2.0.0.10' },
  '0x197BE': { name: 'dash attack (slide continues)', trigger: 'dash attack', state: '2.0.0.10' },
  '0x19822': { name: 'dash attack recovery', trigger: 'end of the dash attack', state: '2.0.0.12' },
  '0x1982C': { name: 'idle (after dash attack)', trigger: 'dash recovery finished', state: '2.0.0.12' },
  '0x19854': { name: 'pick up (crouch)', trigger: 'attack over an item', state: '2.0.0.14' },
  '0x198BA': { name: 'pick up (stand up with the item)', trigger: 'pick up', state: '2.0.0.14' },
  '0x19916': { name: 'weapon attack (fire / throw / stab)', trigger: 'attack holding a pistol, rifle, shotgun, knife/stick or throwable (0x5E5C picks the anim by class)', state: '2.0.0.16' },
  '0x1993E': { name: 'knife/stick thrown (no enemy within reach)', trigger: 'attack holding a blade with nobody in the stab box (0x6248) -> class 0x201 throw anim', state: '2.0.0.16' },
  '0x1996E': { name: 'weapon attack (anim ends)', trigger: '', state: '2.0.0.16' },
  '0x199C8': { name: 'victory pose (stage clear / boss defeated / extra life)', trigger: 'ground state 0x18 (0x19996): main 14 when +0x10E (extra life) or +0xC0 (this player defeated the boss: catchphrase bubble 0x6192) is set, else main 17 (stage clear 0x1E200)', state: '2.0.0.18' },
  '0x19A18': { name: 'victory pose (frame advance)', trigger: '', state: '2.0.0.18' },
  '0x19A90': { name: 'team-up pose (initiator, both players standing still together)', trigger: 'two idle players within 32 px and 16 depth for 90 frames (0x6710): the initiator goes to ground state 0x1A (main 15, then 180 frames of invulnerability), the partner to the state from table 0x6902 for the initiator\'s character', state: '2.0.0.1A' },
  '0x19A9A': { name: 'team-up pose (frame advance)', trigger: '', state: '2.0.0.1A' },
  '0x19AE4': { name: 'Uzi / M16 burst', trigger: 'attack holding an Uzi or M16 (3-shot burst, repeats while attack is held)', state: '2.0.0.1C' },
  '0x19B16': { name: 'Uzi / M16 burst (next shot)', trigger: 'burst continues', state: '2.0.0.1C' },
  '0x19B88': { name: 'Uzi / M16 fire while walking', trigger: 'attack + direction holding an Uzi/M16 (state 0x1E, 0x5FB6)', state: '2.0.0.1E' },
  '0x19C48': { name: 'melee weapon swing', trigger: 'attack holding a class 0x203 weapon (rod, B. knife, club, torch, emptied rifle/M16); holding attack charges', state: '2.0.0.20' },
  '0x19CD2': { name: 'melee weapon swing (release)', trigger: 'swing', state: '2.0.0.20' },
  '0x19D12': { name: 'bazooka fire', trigger: 'attack holding the bazooka (recoil push-back)', state: '2.0.0.22' },
  '0x19D98': { name: 'bazooka fire (recovery)', trigger: '', state: '2.0.0.22' },
  '0x19DEA': { name: 'Down, Up + Attack special: landing attack (Hannah)', trigger: 'after punch 14 (jump state 0x30) Hannah lands into ground state 0x24 and attacks', state: '2.0.4.30 -> 2.0.0.24' },
  '0x19E7E': { name: 'Down, Up + Attack special: landing attack (Mess)', trigger: 'jump state 0x30 -> ground state 0x26', state: '2.0.4.30 -> 2.0.0.26' },
  '0x19E84': { name: 'Down, Up + Attack special: landing attack (Mess, frame advance)', trigger: '', state: '2.0.0.26' },
  '0x19E9A': { name: 'Down, Up + Attack special: landing attack (Mustapha)', trigger: 'jump state 0x30 -> ground state 0x28', state: '2.0.4.30 -> 2.0.0.28' },
  '0x19EA0': { name: 'Down, Up + Attack special: landing attack (Mustapha, frame advance)', trigger: '', state: '2.0.0.28' },
  '0x19FD2': { name: 'run (start)', trigger: 'double-tap a direction', state: '2.0.2.0' },
  '0x19FF2': { name: 'run with a weapon (torso)', trigger: 'run holding a gun (split body: legs main 0x0B, bob table 0x1A164)', state: '2.0.2.0' },
  '0x1A0BC': { name: 'run (loop)', trigger: 'keep running', state: '2.0.2.0' },
  '0x1A36E': { name: 'team-up run (partner of a Jack team-up)', trigger: 'run state 4 (table 0x6902 row Jack = 02 04): the partner is attached to Jack (0x6922) and its anim restarted at Jack\'s frame b5 until Jack\'s frame b4 != 0, then runs on (main 25 at the legs phase)', state: '2.0.2.4' },
  '0x1A39A': { name: 'team-up run with a weapon (torso)', trigger: 'team-up run holding a gun (split body)', state: '2.0.2.4' },
  '0x1A456': { name: 'team-up run (loop)', trigger: '', state: '2.0.2.4' },
  '0x5D0A': { name: 'walk with a weapon (torso)', trigger: 'walk holding a weapon (0x5CA6: split body, legs main 0x10, bob table 0x5D1C)', state: '2.0.0.2' },
  '0x1A636': { name: 'jump', trigger: 'jump: anim 3 straight up, 4 forward, 5 backward (stick reversed less than 3 frames ago; the facing flips back)', state: '2.0.4.0' },
  '0x1A6B0': { name: 'jump descent (stick pressed near the apex)', trigger: 'jump with the stick pressed after the apex (0x1A69E needs height >= 48): anim 7 towards the facing, 12 against it', state: '2.0.4.0' },
  '0x1A6D6': { name: 'jump descent', trigger: 'past the apex: anim 7 forward, 12 backward', state: '2.0.4.0' },
  '0x1A822': { name: 'landing', trigger: 'touch down after any jump', state: '2.0.4.4' },
  '0x1A836': { name: 'idle (after landing)', trigger: 'landing finished', state: '2.0.4.4' },
  '0x1A94A': { name: 'running jump', trigger: 'jump while running', state: '2.0.4.8' },
  '0x1A9B8': { name: 'jump attack (forward / late)', trigger: 'attack during a forward jump', state: '2.0.4.A' },
  '0x1AA68': { name: 'jump kick', trigger: 'attack during a jump (also with a weapon in hand)', state: '2.0.4.C' },
  '0x1AD16': { name: 'running jump attack', trigger: 'attack during a running jump', state: '2.0.4.16' },
  '0x1B4A6': { name: 'running jump attack', trigger: 'attack during a running jump', state: '2.0.4.28' },
  '0x1B578': { name: 'running jump attack', trigger: 'attack during a running jump', state: '2.0.4.2A' },
  '0x1B5E4': { name: 'running jump attack', trigger: 'attack during a running jump', state: '2.0.4.2C' },
  '0x1AFD0': { name: 'leap into a new area', trigger: 'area change (seen after warpArea): vx 5.0, vh 3.0 (0x1AF90); main 21 instead when +0xC0 is set', state: '2.0.4.1C' },
  '0x1B07C': { name: 'jump carrying a container (rise)', trigger: 'jump while carrying a container (class 0x20A, 0x1A5D6 -> 0x1B038): weapon anim from table 0x1B0C6', state: '2.0.4.1E' },
  '0x1B0E6': { name: 'jump carrying a container (fall)', trigger: 'the same jump past the apex (0x1B0CA): weapon anim from table 0x1B0F2', state: '2.0.4.20' },
  '0x1B39E': { name: 'team-up: partner launched by Mess ("Let\'s fly!")', trigger: 'jump state 0x26 (table 0x6902 row Mess = 04 26), attached to Mess until her frame b4 != 0 (0x1B380)', state: '2.0.4.26' },
  '0x1B714': { name: 'Down, Up + Attack special (start)', trigger: 'stick Down, Up, then attack (0x6AC8 sets +0xF1 = 2) -> jump state 0x30 (0x1B6EC)', state: '2.0.0.2 -> 2.0.4.30' },
  '0x1B74E': { name: 'Down, Up + Attack special (in the air, Jack)', trigger: 'jump state 0x30, Jack path', state: '2.0.4.30' },
  '0x1B7A8': { name: 'Down, Up + Attack special: air attack (Jack)', trigger: 'jump state 0x30, Jack path (0x1B7A2)', state: '2.0.4.30' },
  '0x1B842': { name: 'Down, Up + Attack special: landing (Jack)', trigger: 'jump state 0x30 landing (0x1B83C)', state: '2.0.4.30' },
  '0x1B856': { name: 'Down, Up + Attack special: landing (Jack, frame advance)', trigger: '', state: '2.0.4.30' },
  '0x1BD5E': { name: 'hard landing after a jump attack', trigger: 'landing from jump attack (state 0x36)', state: '2.0.4.36' },
  '0x1BD72': { name: 'idle (after hard landing)', trigger: '', state: '2.0.4.36' },
  '0x1C0B2': { name: 'hurt (light hit)', trigger: 'hit by an enemy', state: '2.2.0.0' },
  '0x1C174': { name: 'hurt (body hit)', trigger: 'hit by an enemy (other hit type)', state: '2.2.2.0' },
  '0x1C1F4': { name: 'knocked down (falls on the back)', trigger: 'strong hit / stun meter empty', state: '2.2.0.0' },
  '0x1C3D4': { name: 'knocked flying (hard fall; also the death fall)', trigger: 'heavy hit, explosion, or a hit with HP 0', state: '2.2.6.0' },
  '0x1CBB4': { name: 'hurt (hit from behind)', trigger: 'hit', state: '2.2.0.0' },
  '0x1CC1A': { name: 'knocked down forwards (face down)', trigger: 'released / thrown by an enemy', state: '2.2.6.0' },
  '0x1CDD4': { name: 'get up (roll back up)', trigger: 'after a knock-down', state: '2.2.x.6' },
  '0x1CDF0': { name: 'get up', trigger: 'after a knock-down', state: '2.2.1E.0' },
  '0x1D578': { name: 'held by an enemy (struggle)', trigger: 'grabbed by an enemy', state: '2.6.x.x' },
  '0x1D684': { name: 'grab (holding an enemy)', trigger: 'walk into an enemy', state: '2.4.0.0' },
  '0x1D75E': { name: 'grab: knee 1', trigger: 'attack while holding', state: '2.4.0.2' },
  '0x1D782': { name: 'grab: knee 1 (end)', trigger: '', state: '2.4.2.0' },
  '0x1D7F6': { name: 'grab: knee 2 / head butt', trigger: 'second attack while holding', state: '2.4.0.2' },
  '0x1D81A': { name: 'grab: knee 2 (end)', trigger: '', state: '2.4.4.0' },
  '0x1D890': { name: 'grab: throw (forward or back: same anim, the facing decides)', trigger: 'direction + attack while holding (or the third attack)', state: '2.4.0.2' },
  '0x1D878': { name: 'grab: throw (Mess path)', trigger: 'direction + attack while holding', state: '2.4.0.2' },
  '0x1D8B4': { name: 'throw follow-through', trigger: 'after the throw', state: '2.4.6.0' },
  '0x1A142': { name: 'run legs (split body)', trigger: 'running with a gun', state: '2.0.2.0', legs: true },
};
// the anims a caller's call site can start (static D0, or the alternatives the code chooses between)
const CALLER_ANIMS = {
  '0x199C8': ['main:14', 'main:17'], '0x1A36E': ['main:23', 'main:25'], '0x1A456': ['main:25'], '0x1AFD0': ['main:20', 'main:21'],
  '0x1B39E': ['main:28'], '0x1B842': ['main:23'], '0x1B856': ['main:23'], '0x19A90': ['main:15'], '0x19A9A': ['main:15'], '0x18B1A': ['main:29'],
};
// starts made by a state handler reached through the dispatcher (return address 0x18E78), by state bytes
const STATE_STARTS = {
  '2.0.4.22': { anim: 'main:27', name: 'team-up: partner launched by Hannah ("Jump!")', trigger: 'jump state 0x22 (table 0x6902 row Hannah = 04 22); attached to Hannah (0x6922) until her frame b4 != 0 (0x1B120)', site: '0x1B138' },
  '2.0.4.24': { anim: 'main:26', name: 'team-up: partner launched by Mustapha ("Let\'s roll!")', trigger: 'jump state 0x24 (table 0x6902 row Mustapha = 04 24); attached to Mustapha until his frame b4 != 0 (0x1B250)', site: '0x1B268' },
  '2.0.4.26': { anim: 'main:28', name: 'team-up: partner launched by Mess ("Let\'s fly!")', trigger: 'jump state 0x26 (table 0x6902 row Mess = 04 26)', site: '0x1B398' },
  '2.2.1c.4': { anim: 'set3:9', name: 'lying face down (hold)', trigger: 'knocked-down sub-state 0x1C.4 (seen after a grab release)', site: '0x1D0A2' },
};
const LOOP_CALLER = '0x18E78';
// names for a caller that starts different anims
const CALLER_ANIM_NAMES = {
  '0x199C8|main:14': 'victory pose: extra life, or this player defeated the boss (with the catchphrase bubble)',
  '0x199C8|main:17': 'stage-clear pose of a player who did not defeat the boss',
  '0x1A36E|main:25': 'team-up run (resumed at the legs phase)',
};

// Static call sites in the shared player code (checked per hero by `unreachable`). `at` = the jsr/jmp.
const SITES = {
  'main:7': { at: '0x1A6AA', state: '2.0.4.0', name: 'jump descent: the stick pressed towards the facing after the apex (0x1A69E needs height >= 48); the same frames are the tail of main 4 (forward jump)' },
  'main:12': { at: '0x1A6AA', state: '2.0.4.0', name: 'jump descent: the stick pressed against the facing after the apex (0x1A69E); the same frames are the tail of main 5 (backward jump)' },
  'main:14': { at: '0x199C2', state: '2.0.0.18', name: 'victory pose: extra life (+0x10E) or boss defeated by this player (+0xC0, with the catchphrase bubble); Mustapha and Hannah jump while posing (0x1ADA6 / 0x1AE62)' },
  'main:17': { at: '0x199C2', state: '2.0.0.18', name: 'stage-clear pose of a player who did not defeat the boss (state 0x18 without +0x10E / +0xC0)' },
  'main:18': { at: '0x1A7AE', state: '2.0.4.2', name: 'edge jump: jump pressed in the air while moving, at least 32 px above the floor, when the terrain byte +0xAF is 4, 0x18 or 0x1C (0x1A75C)' },
  'main:19': { at: null, name: 'no call site in the player code (no jsr/jmp with D0 = 0x13 found)' },
  'main:20': { at: '0x1AFCA / 0x1BC5A', state: '2.0.4.1C / 2.0.4.34', name: 'leap into the next area (0x1AF82, +0xC0 clear) and scripted leap to a target point (0x1BBCA: stage table 0x1DD4C, and 0x8C6E2 which sends every player to camX + 0xB0, depth 48; on EPISODE 3 the held weapon class is cleared)' },
  'main:21': { at: '0x1AFCA', state: '2.0.4.1C', name: 'leap into the next area after defeating the boss (+0xC0 set): kick-pose variant of main 20' },
  'main:22': { at: '0x1984E', state: '2.0.0.14', name: 'pick up a carried container (pick-up of an item of class 0x20A)' },
  'main:23': { at: '0x1A368 / 0x1B83C', state: '2.0.2.4 / 2.0.4.30', name: 'team-up run as the partner of Jack (0x1A368), or the landing of Jack\'s Down, Up + Attack special (0x1B83C, Jack path only)' },
  'main:24': { at: '0x1A13C / 0x1A4BC (legs)', state: '2.0.2.4', name: 'run legs while team-running with a gun (+0x07 == 4 replaces main 0x0B)' },
  'main:25': { at: '0x1A572', state: '2.0.2.4', name: 'team-up run resumed after a team-run attack, at the legs phase (0x13EA)' },
  'main:26': { at: '0x1B268', state: '2.0.4.24', name: 'team-up: partner launched by Mustapha ("Let\'s roll!")' },
  'main:27': { at: '0x1B138', state: '2.0.4.22', name: 'team-up: partner launched by Hannah ("Jump!")' },
  'main:28': { at: '0x1B398', state: '2.0.4.26', name: 'team-up: partner launched by Mess ("Let\'s fly!")' },
  'main:29': { at: '0x18B14', state: '2.0.4.32', name: 'seated in the Cadillac: area-0 start of EPISODE 2 and EPISODE 4, first present player (others start in main 6); the HELL ROAD driver (reference video 03:28) shows the same records' },
  'main:30': { at: '0x1BD58', state: '2.0.4.36', name: 'hard landing after a jump attack' },
  'main:31': { at: '0x19F92', state: '2.0.0.2C', name: 'scripted stage-end move of the boss killer (+0xC0, 0x1E2AA -> 0x19F40): effect 0xD spawned 88 px above (0x92422), 40 frames later main 31 (0x81FB0 first): lift overhead and throw' },
  'punch:4': { at: '0x1962C', state: '2.0.0.C', name: 'combo hit 4 / finisher (start); Mustapha starts punch 7 instead when his current frame byte b4 is 0 (0x19616)' },
  'punch:7': { at: '0x1962C', state: '2.0.0.C', name: "Mustapha's combo hit 4 / finisher (start) when his current frame byte b4 is 0 (0x19616)" },
  'set4:4': { at: '0x1D872', state: '2.4.6.0', name: 'grab: back throw (Mess only: stick away from his facing, 0x1D854); the other heroes throw with set4:3 both ways' },
  'punch:9': { at: '0x1A528 / 0x1A2BE', state: '2.0.2.4 / 2.0.2.2', name: 'attack during the team-up run (0x1A4CA, empty hands): running attack on the run legs, then the team run resumes (main 25); the 0x1A2BE entry (0x1A230) has no static reference' },
  'punch:10': { at: null, name: 'no call site in the player code (no jsr/jmp with D0 = 0x0A for the punch list)' },
  'set3:1': { at: '0x1C16E', state: '2.2.2.0', name: 'hurt (body hit)' },
  'set3:4': { at: '0x1CE0A', state: '2.2.x.2', name: 'dizzy / stunned after getting up (+0xCD set)' },
  'set3:5': { at: '0x1CFAE', state: '2.2.20.0', name: 'knocked back onto the backside (fall state 0x20, +0x80 = 30)' },
  'set3:6': { at: '0x1C940 / 0x1CAB4 / 0x1CBAE', state: '2.2.0.0', name: 'hurt (hit from behind)' },
  'set3:7': { at: '0x1CC14', state: '2.2.6.0', name: 'knocked down forwards (face down)' },
  'set3:9': { at: '0x1C33C / 0x1D0A2 ...', state: '2.2.x.x', name: 'lying face down (hold)' },
  'set3:10': { at: '0x1D072', state: '2.2.x.x', name: 'lying, head raised: hit while lying (+0x7B not 4/6)' },
  'set3:11': { at: null, name: 'lying on the back (hold): no direct call site' },
  'set5:2': { at: '0x1D49E', state: '2.6.6.0', name: 'held by an enemy: thrown down' },
  'set5:3': { at: '0x1D402', state: '2.6.4.0', name: 'held by an enemy: released' },
  'set5:4': { at: '0x1D572', state: '2.6.x.x', name: 'held by an enemy: reaction pose (+0x7B == 0)' },
  'set5:5': { at: '0x1D572', state: '2.6.x.x', name: 'held by an enemy: reaction pose (+0x7B != 0)' },
};
for (const k of ['set5:0', 'set5:1', 'set5:6', 'set5:7', 'set5:8', 'set5:9', 'set5:10'])
  SITES[k] = { at: '0x1D5F0', state: '2.6.x.x', name: 'held by an enemy: puppet pose chosen every frame by the grabber (0x1D598: table by enemy type, then hero; entries dx, dh, facing flip, set5 anim)' };

// per-hero reachability of a static site (null = reachable)
const TEAM_ROW = { 0: 'main:23', 1: 'main:26', 2: 'main:27', 3: 'main:28' };    // partner anim when this hero initiates
function unreachable(key, id) {
  const own = TEAM_ROW[id];
  if (key === own && id !== 0) return 'the partner anim of this hero\'s own team-up move: a hero is never his own partner (table 0x6902 row = the initiator)';
  if (id === 0 && ['main:24', 'main:25', 'punch:9'].includes(key)) return 'team-up run anims: only the partner of a Jack team-up runs (row Jack = 02 04), so Jack never plays them';
  if (key === 'punch:7' && id !== 1) return "only Mustapha's combo code starts punch 7 (0x19616)";
  if (key === 'set4:4' && id !== 3) return 'only Mess picks set4:4 (0x1D854 checks id 3); the others throw with set4:3 in both directions';
  return null;
}

// What each hero's own records show (looked at on the per-hero strips; records in brackets are in heroes.json)
const VISUAL = {
  jack: {
    'main:17': 'standing, hand on the head (record 2)', 'main:18': 'single standing frame (record 2, same as main 17)', 'main:19': 'crouch, rise', 'main:20': 'somersault in the air, lands upright with arms up',
    'main:21': 'flying kick, then upright', 'main:22': 'crouch, rise', 'main:23': 'crouch, rise (landing)', 'main:24': 'crouch, rise (no run frames)', 'main:25': 'crouch, rise (no run frames)',
    'main:26': 'tumbling somersaults', 'main:27': 'jump with arms raised', 'main:28': 'hit pose, upside down, somersault', 'main:29': 'seated in the Cadillac: small upper body (record 2700)', 'main:30': 'crouch, rise',
    'main:31': 'crouch, rise, lift the prize overhead (record 110 under 78), throw it forward (100-102)', 'punch:9': 'low diving slide along the ground', 'punch:10': 'crouch, flying kick',
    'set3:1': 'recoil, hand to the face', 'set3:4': 'dizzy, holding the head (stars)', 'set3:5': 'knocked back onto the backside', 'set3:9': 'lying face down', 'set3:10': 'lying, head raised', 'set3:11': 'lying on the back',
  },
  mustapha: {
    'main:14': 'somersault, then thumbs up (294, 295)', 'main:17': 'standing, one arm raised (record 173)', 'main:18': 'crouch, somersault, land crouched', 'main:19': 'crouch, rise', 'main:20': 'somersault, lands upright with arms up',
    'main:21': 'flying kick, then upright', 'main:23': 'run cycle (team-up run)', 'main:24': 'run legs (same records as main 11)', 'main:25': 'run cycle', 'main:26': 'run cycle (copy of main 25: placeholder)',
    'main:27': 'crouched jump, arms up (no end flag: live, frame 6 is held until the landing replaces it)', 'main:28': 'hit pose, upside down (3196), tumble, landing', 'main:29': 'seated in the Cadillac: leaning back in the driver seat, arm up (2696, 2697)',
    'main:31': 'crouch, rise, lift overhead (281, 280), throw (283)', 'punch:4': 'combo finisher (234-238)', 'punch:9': 'low diving slide', 'punch:10': 'crouch, flying kick',
    'set3:1': 'recoil (body hit)', 'set3:4': 'dizzy (313-315)', 'set3:5': 'knocked back onto the backside', 'set3:9': 'lying face down', 'set3:10': 'lying, head raised', 'set3:11': 'lying on the back',
    'weapon:25': 'record 289 is not hero art (letters "CAI" in his palette): a placeholder entry', 'set5:0': 'held, hit pose (296)', 'set5:1': 'struggling (316-318)', 'set5:2': 'thrown down onto the ground', 'set5:3': 'released, recovers', 'set5:4': 'held, reaction pose', 'set5:5': 'held, reaction pose', 'set5:6': 'held, reaction poses', 'set5:7': 'held, hit pose', 'set5:8': 'upside down (3196)',
  },
  hannah: {
    'main:17': 'standing, hand on the hip (record 1426)', 'main:18': 'crouch, somersault, land', 'main:19': 'crouch, rise', 'main:20': 'somersault, lands upright with arms up', 'main:21': 'flying kick, somersault, upright',
    'main:23': 'run cycle (team-up run)', 'main:24': 'run legs (same records as main 11)', 'main:25': 'run cycle', 'main:26': 'tumbling somersaults', 'main:27': 'tumbling somersaults (copy of main 26: placeholder)',
    'main:28': 'hit pose, upside down (3188), tumble, landing', 'main:29': 'seated in the Cadillac (2698, 2699)', 'main:30': 'crouch, rise', 'main:31': 'crouch, rise, lift overhead (1550+1548), throw (1575, 1576)',
    'punch:9': 'low diving slide', 'punch:10': 'crouch, flying kick', 'set3:4': 'dizzy (1501-1503)', 'set3:5': 'knocked back onto the backside', 'set3:6': 'hurt from behind (pitched forward)',
    'set3:9': 'lying face down', 'set3:10': 'lying, head raised', 'set3:11': 'lying on the back', 'set5:0': 'held, hit pose (1484)', 'set5:2': 'thrown down onto the ground', 'set5:3': 'released, recovers',
    'set5:4': 'held, reaction pose (1505)', 'set5:5': 'held, reaction pose (1505)', 'set5:6': 'held, reaction poses', 'set5:7': 'held, hit pose', 'set5:8': 'upside down (3188)',
  },
  mess: {
    'main:17': 'single standing frame (607)', 'main:18': 'single standing frame (607, same as main 17)', 'main:19': 'crouch, rise', 'main:20': 'jump with arms raised (no somersault)', 'main:21': 'flying kick, then the jump pose',
    'main:23': 'run cycle (team-up run)', 'main:24': 'run legs (same records as main 11)', 'main:25': 'run cycle', 'main:26': 'tumble and dive', 'main:27': 'crouched jump, arms up', 'main:28': 'crouched jump (copy of main 27: placeholder)',
    'main:29': 'seated in the Cadillac (2701)', 'main:30': 'crouch, rise', 'main:31': 'crouch, rise, lift overhead (643), throw (735-737)', 'punch:9': 'low diving slide', 'punch:10': 'crouch, flying kick',
    'set3:1': 'recoil (body hit)', 'set3:4': 'dizzy (772-774)', 'set3:5': 'knocked back onto the backside', 'set3:6': 'hurt from behind', 'set3:7': 'knocked down face down', 'set3:9': 'lying face down', 'set3:10': 'lying, head raised', 'set3:11': 'lying on the back',
    'weapon:7': 'torso only: flexing both arms (record 713, hold 15)', 'set5:0': 'held, hit pose (754)', 'set5:1': 'struggling (773-775)', 'set5:2': 'thrown down onto the ground', 'set5:3': 'released, recovers with a flex (629-631)', 'set5:4': 'held, reaction pose', 'set5:5': 'held, reaction pose', 'set5:6': 'held, reaction poses', 'set5:7': 'held, hit pose', 'set5:8': 'upside down (3255)',
  },
};

// Live starts from the event log (heroes-live.cjs events): returns Map `${hero}|${list}:${anim}[|legs]` ->
// {callers: Map(caller -> {n, states, name, trigger}), runs: []}. `framesOf(hero, key)` -> Set of frame addresses;
// `siteAnims(caller)` -> anims a static call site starts (from the call-site scan).
function liveStarts(events, framesOf, siteAnims, succOf = () => null, callKind = () => 'unknown') {
  const out = new Map(), reached = new Map();
  out.reached = reached;   // key -> {n, runs}: the frame driver ran into the anim's first frame from another anim (tail / loop target)
  const hx = s => '0x' + parseInt(s, 16).toString(16).toUpperCase();
  for (const r of events) {
    const last = {};
    for (const e of r.events) {
      const prev = last[e.tap]; last[e.tap] = e.value;
      if (!e.start || !e.start.length || prev === e.value) continue;
      const caller = hx(e.caller);
      // the jsr before the return address tells a start entry (0x13A0..) from the frame tick (0x1426 / 0x1542 / 0x15F4):
      // a tick only advances (next frame, or the loop word into this or another anim's frames) and never starts
      const kind = callKind(caller);
      if (kind === 'tick') {
        for (const k of e.start) if (!(prev && framesOf(r.hero, k).has(hx(prev)))) { const key = r.hero + '|' + k + (e.tap === 'lp' ? '|legs' : ''); const o = reached.get(key) || { n: 0, runs: [] }; o.n++; if (o.runs.length < 4 && !o.runs.some(x => x.startsWith(r.run + '@'))) o.runs.push(`${r.run}@f${e.f}`); reached.set(key, o); }
        continue;
      }
      let cands = e.start;
      if (kind !== 'start') {
        cands = cands.filter(k => !(prev && framesOf(r.hero, k).has(hx(prev))));    // a loop back to frame 0 is not a start
        const sc = prev ? succOf(r.hero, hx(prev)) : null;
        if (sc && sc.has(hx(e.value))) {                                               // nor an advance into a shared tail
          for (const k of cands) { const key = r.hero + '|' + k + (e.tap === 'lp' ? '|legs' : ''); const o = reached.get(key) || { n: 0, runs: [] }; o.n++; if (o.runs.length < 4 && !o.runs.some(x => x.startsWith(r.run + '@'))) o.runs.push(`${r.run}@f${e.f}`); reached.set(key, o); }
          continue;
        }
      }   // the driver advanced into it (loop target / next frame), not a start
      if (!cands.length) continue;
      let name = null, trigger;
      if (caller === LOOP_CALLER) {
        const st = STATE_STARTS[e.state];
        if (!st) continue;                                       // an advance / loop of the per-frame driver
        cands = cands.filter(k => k === st.anim); if (!cands.length) continue;
        name = st.name; trigger = st.trigger;
      } else {
        const allowed = (CALLER_ANIMS[caller] || []).concat(siteAnims(caller));
        if (cands.length > 1 && allowed.length) { const f = cands.filter(k => allowed.includes(k)); if (f.length) cands = f; }
        const C = CALLERS[caller]; name = C ? C.name : 'started from ' + caller; trigger = C ? C.trigger : undefined;
      }
      for (const k of cands) {
        const key = r.hero + '|' + k + (e.tap === 'lp' ? '|legs' : '');
        const o = out.get(key) || { callers: new Map(), runs: [] };
        const cc = o.callers.get(caller) || { n: 0, states: new Set(), name: CALLER_ANIM_NAMES[caller + '|' + k] || name, trigger, shared: cands.length > 1 || e.start.length > 1 ? e.start : undefined };
        cc.n++; if (e.state) cc.states.add(e.state); o.callers.set(caller, cc);
        if (o.runs.length < 6 && !o.runs.some(x => x.startsWith(r.run + '@'))) o.runs.push(`${r.run}@f${e.f}`);
        out.set(key, o);
      }
    }
  }
  return out;
}

const CLASS_NAMES = { '0x201': 'throwable (dynamite, grenade, stone; emptied revolver/Uzi/shotgun)', '0x202': 'blade (knife, stick)', '0x203': 'blunt (rod, B. knife, club, torch, emptied rifle/M16)', '0x204': 'revolver', '0x205': 'rifle', '0x206': 'Uzi', '0x207': 'M-16A1', '0x208': 'shotgun', '0x209': 'bazooka', '0x20A': 'carried container' };
const ATTACK_VERB = { '0x201': 'throw', '0x202': 'stab', '0x203': 'swing', '0x204': 'fire', '0x205': 'fire', '0x206': 'fire (burst)', '0x207': 'fire (burst)', '0x208': 'fire', '0x209': 'fire', '0x20A': 'throw the container' };

// weapon-list labels from the class tables (needs the static tables: hero JSON + attack table words)
function weaponTableLabels(hj, extra) {
  const L = {};
  const add = (anim, name, src) => { if (anim == null || anim < 0) return; (L[anim] = L[anim] || []).push({ name, source: src }); };
  for (const [cls, a] of Object.entries(hj.stance.standAnimByClass)) if (CLASS_NAMES[cls]) add(a, `stance: ${CLASS_NAMES[cls]}`, 'table 0x5C36 (stance by class, V24)');
  for (const [cls, a] of Object.entries(hj.stance.walkTorsoAnimByClass)) if (CLASS_NAMES[cls]) add(a, `walk torso: ${CLASS_NAMES[cls]}`, 'table 0x5D2C (walk torso by class)');
  add(hj.runTorso.gunsAtLeast0x205, 'run torso: guns (class >= 0x205)', 'table 0x1A15C');
  if (hj.id !== 0) add(hj.runTorso.blunt0x203, 'run torso: blunt (class 0x203)', 'table 0x1A15C');
  add(hj.runAttackThrowTorso.anim, 'run + attack: throw/stab torso (class 0x201/0x202)', 'table 0x1A228');
  add(hj.smgWalkFireTorso.uzi0x206, 'walk + fire torso: Uzi', 'table 0x5FF2');
  add(hj.smgWalkFireTorso.m16_0x207, 'walk + fire torso: M-16A1', 'table 0x5FF2');
  for (const [cls, a] of Object.entries(extra.attackByClass)) if (CLASS_NAMES[cls]) add(a, `attack: ${ATTACK_VERB[cls]} (${CLASS_NAMES[cls]})`, 'table 0x5EDE (attack anim by class, read by 0x5E5C)');
  (extra.attackContainer || []).forEach((a, k) => add(a, `attack: throw carried container subtype ${'0x' + (k * 2).toString(16)}`, 'table 0x5EDE (+0x18 + container subtype)'));
  add(extra.containerJumpRise, 'jump carrying a container (rise, state 2.0.4.1E)', 'table 0x1B0C6 (0x1B038)');
  add(extra.containerJumpFall, 'jump carrying a container (fall, state 2.0.4.20)', 'table 0x1B0F2 (0x1B0CA)');
  add(extra.containerJumpForward, 'forward / running jump carrying a container', 'table 0x1A902 (0x1A8AA)');
  return L;
}

module.exports = { CALLERS, CALLER_ANIM_NAMES, CALLER_ANIMS, STATE_STARTS, LOOP_CALLER, SITES, VISUAL, unreachable, liveStarts, CLASS_NAMES, ATTACK_VERB, weaponTableLabels, TEAM_ROW };
