// Cadillacs & Dinosaurs II: the enemy kinds and the boss fights, authored on the ROM data (PLAN §4.4, WP-C).
//   window.ENEMY_KINDS : constants (K), one table per sequel kind (ENEMIES §2.5), the cast ids (CAMPAIGN §4.4) and helpers.
//   window.BOSS_DEFS   : the seven fights (CAMPAIGN §12.4, the ENEMIES §6.1 move-record shape).
// Animation references are relative to the variant's ROM sets: ['main', 3] = '<variant main set>:3', ['down', 2] and
// ['held', 0] the shared reaction sets, ['hit', n] / ['grab', n] the boss-format ones; strings '0x6FB6A:33' are absolute
// keys. Every reference exists in ROM_ENEMIES.anims / ROM_BOSSES.anims (sprite-data-enemies.js / sprite-data-bosses.js):
// `node tools/re/build-game-assets.cjs check` (gate anim-keys) and tests/enemies.cjs (1), (7) prove it.
// Units (K.UNITS): arcade px and 60 Hz ROM frames (ARCHITECTURE D1, PLAN RC1); reach = [min, max] distance in px measured
// from the attack-start distances of the live captures; durations in frames unless a key ends in `s` (seconds).
// Speeds: ENEMY_KINDS vx / walk / speed are px/frame (ENEMIES §2.5); BOSS_DEFS move vx are px/s, as CAMPAIGN §12.4 writes
// them ('road+300' = the road speed + 300 px/s); ENEMY_KINDS.bossVx(move) converts. kindSpeed(kind, V) is the walk speed.
// hit: [frame…] on an attack whose anim carries no active flag (the ROM hits through an object or a code path there):
// the frames the sequel tests the hit on. Every attack anim carries its 0xA2EA4 record (anims[key].atk, with atk.src).
// No Math.random anywhere: attack choice is a weighted cycle on e.attackNo, variants come from the section cast
// (pool[(wave + j) % n], CAMPAIGN §4.4) or from `variants` weights through pick().
(function (root) {
  'use strict';
  const T = 1 / 60;
  const fam = name => (root[name === 'enemies' ? 'ROM_ENEMIES' : 'ROM_BOSSES']) || (root.SPRITE_DATA && root.SPRITE_DATA.families && root.SPRITE_DATA.families[name]) || null;

  // ------------------------------------------------------------------ constants (ENEMIES §0, PLAN RC1/RC7)
  const K = {
    ARC: 1, T, SPD: 60,                       // arcade px per world unit, s per ROM frame, (px/frame) -> px/s
    // Sequel HP from the ROM HP (affine: keeps FERRIS < BLADE < BLK ELMER < TYROG and compresses the spread). FERRIS 44 -> 80.
    // 'spec' = ENEMIES §0 DECISION 40 + 0.9 r (shipped). With the CAMPAIGN D9 waves and the section casts of
    // tools/re/levels/ch*.json every chapter lands inside the ±15 % gate (tests/enemies.cjs (5): 1.08 / 0.64 exempt / 1.14 /
    // 1.14 / 1.14 / 1.14, ENEMIES §2.6 meeting it by counts, as it decides). 'tuned' = 56 + 0.55 r is the fallback if the
    // counts grow again (FERRIS still 80; it lowers the tough enemies: TYROG 256 -> 197 instead of 270): changing HP_USE
    // needs the user's / G4's approval, because it overrides a spec DECISION.
    HP_FORMULAS: { spec: { a: 40, b: 0.9 }, tuned: { a: 56, b: 0.55 } }, HP_USE: 'spec', HP_A: 40, HP_B: 0.9,
    HP(rom, mult = 1, formula = null) { const f = formula ? K.HP_FORMULAS[formula] : { a: K.HP_A, b: K.HP_B }; return Math.round((f.a + f.b * rom) * mult); },
    // Arcade damage formula 0x6422 without the victim factors, ×1.2 for the sequel's 120-HP hero.
    // `row` = the variant's rankRow[32] (ROM 0x2C3AE + r84*8), or the r84 number itself (PLAN §4.4 DMG(tbl, r84, lvl))
    DMG(tbl, row, lvl, mult = 1) { if (typeof row === 'number') row = rankRowOf(row); const r = row && row.length ? row[Math.max(0, Math.min(31, lvl | 0))] : 32; return Math.max(1, Math.round(tbl * r / 32 * 1.2 * mult)); },
    LV: [9, 10, 11, 12, 13, 14],              // arcade level word 0xFF85EE per chapter
    LV_SHIFT: { easy: -3, normal: 0, hard: 6 },
    BOSS_DMG: 1,                              // 0.8 until the G8 balance pass (PLAN §7 G8; the bot stays in 150-300 s)
    telegraph: { easy: 1.6, normal: 1, hard: 1 },
    DEPTH: 26,                                // |dy| tolerance of a melee hit (35 canvas px today ÷ 1.35, U10)
    MIRROR_HP: 150,                           // hero copies have no ROM body (today's BASE_HP.mirror)
    UNITS: { dist: 'arcade px', time: 'ROM frames at 60 Hz (keys ending in s: seconds)', kindSpeed: 'px/frame (ENEMY_KINDS vx, walk, speed)', bossVx: "px/s (BOSS_DEFS move vx, CAMPAIGN §12.4; 'road+N' = road speed + N)", hp: 'sequel HP = K.HP(rom HP at K.lvl(ch, diff))' },
    lvl(ch, diff) { const s = K.LV_SHIFT[diff] || 0; return Math.max(0, Math.min(31, K.LV[Math.max(0, Math.min(5, ch | 0))] + s)); },
  };

  K.HP_A = K.HP_FORMULAS[K.HP_USE].a; K.HP_B = K.HP_FORMULAS[K.HP_USE].b;

  function rankRowOf(r84) { const F = fam('enemies'); if (!F || !F.types) return null; for (const t of Object.values(F.types)) for (const v of Object.values(t.variants)) if (v.r84 === r84) return v.rankRow; return null; }

  // ------------------------------------------------------------------ the shared reaction layout (ENEMIES §2.3)
  // down set 0x2E68C[+0x84] and held set 0x2E724[+0x84], the same eleven / six entries for every human type.
  const REACT = {
    hurt: [['down', 0], ['down', 1]], held: ['held', 0], kneed: ['held', 1], thrown: [['held', 2], ['held', 3], ['held', 4], ['held', 5]],
    fly: ['down', 3], flyHeld: ['down', 2], thrownLand: ['down', 8], slam: ['down', 6], rise: ['down', 4], dizzy: ['down', 5],
    dead: ['down', 9], deadThrown: ['down', 10],
  };
  const BOSS_REACT = {                       // boss-format hit/grab sets (0x2E68C / 0x2E724 through the boss +0x84)
    hurt: [['hit', 0], ['hit', 1]], knock: [['hit', 2], ['hit', 3], ['hit', 7], ['hit', 10]], rise: ['hit', 4], dizzy: ['hit', 5], stagger: ['hit', 6],
    thrownLand: ['hit', 8], bounce: ['hit', 9], held: ['grab', 0], kneed: ['grab', 1], thrown: [['grab', 2], ['grab', 3], ['grab', 4], ['grab', 5]],
  };
  const R = (extra) => Object.assign({}, REACT, extra || {});

  const kinds = {
    // ---------------------------------------------------------------- raider: Chinpira FERRIS / GNEISS / DRIVER
    raider: {
      type: 'chinpira', label: 'variant', variants: { A: 2, B: 2, C: 1 }, hp: 'rom', speed: 'rom', grab: true, drop: 'food',
      walk: { A: 0.778, B: 1.166, C: 1.108 }, stop: 57,
      st: R({ idle: ['main', 0], walk: ['main', 1], run: ['main', 6], enter: ['main', 6], taunt: ['main', 2], fall: ['main', 12], land: ['main', 9],
        flee: ['main', 6], sit: ['main', 11], bikeFall: ['main', 14] }),
      atk: [{ id: 'jab', a: ['main', 3], reach: [40, 69], w: 3 },
        { id: 'straight', a: ['main', 4], reach: [45, 62], w: 1 },
        { id: 'kick', a: ['main', 5], reach: [45, 60], w: 1, variants: 'BC' },
        { id: 'jumpkick', a: ['main', 8], kind: 'leap', reach: [45, 62], arc: { t: 0.5, h: 30 }, w: 2, variants: 'C' }],
      cadence: { A: 45, B: 45, C: 30 },
      entrance: { side: 'run', top: ['fall', 'land'], ambush: 'sit', rider: 'bikeFall' },
    },
    // ---------------------------------------------------------------- knifer: Knife Man BLADE / RAZOR, KNIFE ONLY (P)
    knifer: {
      type: 'knifeman', label: 'variant', variants: { A: 2, B: 2, P: { type: 'knifeonly', w: 0 } }, hp: 'rom', speed: 'rom', grab: true, drop: 'knife',
      walk: { A: 1.5, B: 1.545, P: 3.5 }, knife: true,
      st: R({ idle: ['main', 0], walk: ['main', 1], run: ['main', 2], enter: ['main', 2], flee: ['main', 2], pickup: ['main', 21], jump: ['main', 23] }),
      atk: [{ id: 'stab', a: ['main', 11], reach: [46, 111], w: 3, armed: true, variants: 'AB' },
        { id: 'slash', a: ['main', 14], reach: [40, 60], w: 2, armed: true, variants: 'B' },
        { id: 'leap', a: ['main', 22], kind: 'leap', reach: [42, 116], w: 1, armed: true, variants: 'AB' },
        { id: 'throw', a: ['main', 12], kind: 'throw', range: [85, 160], release: 1, obj: '0x6FB6A:33', spawn: { dx: 64, h: 64 }, w: 1, armed: true, variants: 'AB' },
        { id: 'longThrow', a: ['main', 28], kind: 'throw', range: [160, 260], release: 1, obj: '0x6FB6A:33', spawn: { dx: 64, h: 64 }, w: 1, armed: true, variants: 'A' },   // RAZOR's main 28 is its walk cycle (records 1122-1126), not a throw
        { id: 'onetwo', a: ['main', 4], reach: [30, 55], hit: [1, 2], w: 2, armed: false, variants: 'AB' },
        { id: 'hooks', a: ['main', 7], reach: [30, 55], hit: [1, 2], w: 1, armed: false, variants: 'AB' }],
      knifeOnly: { variants: 'P', st: { run: ['main', 30], flee: ['main', 30] }, atk: [{ id: 'throw', a: ['main', 31], kind: 'throw', release: 1, obj: '0x6FB6A:33', once: true }], runSpeed: 3.5 },
      alt: { P: 'knifeOnly' },
      obj: { thrown: '0x6FB6A:33', spin: '0x6FB6A:32', hand: '0x6FB6A:0' },
      // The knife in the leading fist while running in (run main 2): objects.knifeHand has no rows for main 2, but the
      // live logs do (en-knifeman-*: object 0xF0, pose 0x6FB6A:27 at these [dx, dy] per run frame, 6-7 hits each).
      // RAZOR's main 2 was never logged; its frames have BLADE's widths and origins, so it takes the same rows.
      knifeRun: { pose: '0x6FB6A:27', keys: ['0x6DA40:2', '0x6DF2A:2'], f: [[-49, -52], [-55, -50], [-51, -48], [-53, -52], [-55, -50], [-51, -48]] },
      cadence: 40, pickupRange: 118,
    },
    // ---------------------------------------------------------------- gunner: Mituryou POACHER J / SKINNER / GUTTER, Thurow DYNA (T) / BOMB (U)
    gunner: {
      type: 'mituryou', label: 'variant', variants: { A: 2, B: 1, C: 1, T: { type: 'thurow', w: 0 }, U: { type: 'thurow', w: 0 } }, hp: 'rom', speed: 'rom', grab: true, drop: 'gun',
      walk: { A: 1.13, B: 1.13, C: 1.13, T: 4.5, U: 4 },
      st: Object.assign({ variants: 'ABC' }, R({ idle: ['main', 0], walk: ['main', 1], walkFast: ['main', 30], enter: ['main', 3], run: ['main', 3], roll: ['main', 4],
        leapDown: ['main', 6], flee: ['main', 30] })),
      atk: [{ id: 'thrust', a: ['main', 11], reach: [30, 72], w: 2, variants: 'ABC' },
        { id: 'lunge', a: ['main', 12], reach: [41, 88], w: 2, variants: 'ABC' },
        { id: 'flykick', a: ['main', 13], kind: 'leap', reach: [45, 90], w: 1, variants: 'ABC' },
        { id: 'rollLunge', a: ['main', 14], kind: 'rush', reach: [60, 110], vx: 2.5, w: 1, variants: 'ABC' },
        // fire = the 1-f frame the round leaves on (POACHER J 7; SKINNER / GUTTER have one aim frame fewer, 6). aim: the
        // windup is the aim before the firing pose (POACHER J 6 x 8 = 48 f, ENEMIES §2.5; SKINNER / GUTTER 40 f); the
        // pose's 3 f before the fire frame then play at the ROM pace, not stretched by the telegraph.
        { id: 'shoot', a: ['main', 15], kind: 'shot', range: [100, 260], fire: { A: 7, B: 6, C: 6 }, aim: true, muzzle: { dx: 43, h: 68 }, obj: '0x6FB1A:0', flash: '0x57E0E:1', dmg: 14, w: 2, variants: 'ABC' }],
      thurow: { variants: 'TU', st: Object.assign({ idle: ['main', 0], run: ['main', 1], enter: ['main', 1], flee: ['main', 1], somersault: ['main', 5] }, R()),
        atk: [{ id: 'throw', a: ['main', 7], kind: 'lob', release: 1, obj: { T: '0x5F128:0', U: '0x5F0AC:0' }, arc: { t: 0.8 }, boom: 'fx:explosion 460-469 then 2140-2142', r: 40, dmg: 12, once: true }] },
      alt: { T: 'thurow', U: 'thurow' },
      drive: { T: 'roadside dynamite: runs in along the verge, one throw at the car lane, runs off (ENEMIES §2.5 driving rule)' },
      cadence: 35,
    },
    // ---------------------------------------------------------------- brute: Hutori HAMMER T. / BLK ELMER / WRENCH T., Naguri (N), LASH T. (L)
    brute: {
      type: 'hutori', label: 'variant', variants: { A: 1, B: 2, C: 1, N: { type: 'naguri', w: 0 }, L: { type: 'ishinage', w: 0 } }, hp: 'rom', speed: 'rom', grab: true, drop: 'food',
      walk: { A: 1.086, B: 0.902, C: 1.0, N: 0.6, L: 0.9 },
      st: Object.assign({ variants: 'ABC' }, R({ idle: ['main', 0], taunt: ['main', 2], walk: ['main', 3], drop: ['main', 5], crouch: ['main', 10],
        land: ['main', 15], breath: ['main', 13], getupFlop: ['main', 14], flee: ['main', 3] })),
      atk: [{ id: 'haymaker', a: ['main', 6], reach: [49, 100], w: 3, variants: 'ABC' },
        { id: 'shove', a: ['main', 7], reach: [40, 80], w: 2, variants: 'ABC' },
        { id: 'charge', a: ['main', 4], kind: 'rush', reach: [42, 159], vx: 3, then: 'breath', w: 2, variants: 'ABC' },
        { id: 'press', a: ['main', 11], kind: 'leap', reach: [100, 120], r: 40, then: 'getupFlop', w: 1, variants: 'ABC' }],
      naguri: { variants: 'N', st: Object.assign({ idle: ['main', 0], walk: ['main', 1], beat: ['main', 2], taunt: ['main', 3], stand: ['main', 4] }, R()), swapTo: 'A', provoke: 200 },
      lashT: { variants: 'L', st: Object.assign({ idle: ['main', 0], walk: ['main', 1], getup: ['main', 4], crouch: ['main', 6] }, R()),
        atk: [{ id: 'lash', a: ['main', 2], reach: [60, 140], w: 3, obj: '0x712A0:11' },
          { id: 'sweep', a: ['main', 5], reach: [40, 110], w: 2, air: false },
          { id: 'hop', a: ['main', 8], reach: [20, 50], w: 1 }],
        ball: ['0x7020A:0', '0x7020A:1'] },
      alt: { N: 'naguri', L: 'lashT' },
      cadence: 52,
    },
    // ---------------------------------------------------------------- raptor: R HOPPER (own anims, no human reactions)
    raptor: {
      type: 'dinonics', label: 'variant', variants: { A: 1 }, hp: 'rom', speed: 138 / 1.35 / 60, grab: false, drop: null, dinosaur: true,
      st: { idle: ['main', 0], stand: ['main', 2], creep: ['main', 7], walk: ['main', 7], run: ['main', 9], runFast: ['main', 10],
        enter: ['main', 10], flee: ['main', 11], hurt: [['main', 20]], fly: ['main', 18], down: ['main', 19], rise: ['main', 17], dead: ['main', 19], crouch: ['main', 6] },
      atk: [{ id: 'runAttack', a: ['main', 23], kind: 'rush', reach: [40, 120], w: 2 },
        { id: 'pounce', a: ['main', 25], kind: 'leap', reach: [60, 140], w: 2 },
        { id: 'bite', a: ['main', 14], reach: [20, 50], w: 2 },
        { id: 'crouchBite', a: ['main', 27], reach: [20, 45], hit: [1], w: 1 },
        { id: 'lowBite', a: ['main', 26], reach: [20, 45], hit: [1], w: 1 },
        { id: 'highPounce', a: ['main', 13], kind: 'leap', reach: [60, 160], elite: true, every: 3 }],
      evade: ['main', 29], cadence: 40,
    },
    // ---------------------------------------------------------------- mutant: Kameleon BLUDGE
    mutant: {
      type: 'kameleon', label: 'variant', variants: { A: 1 }, hp: 'rom', speed: 102 / 1.35 / 60, grab: true, drop: 'food',
      st: R({ idle: ['main', 0], walk: ['main', 16], approach: ['main', 16], riseCrawl: ['main', 9], emerge: ['main', 19], enter: ['main', 19], taunt: ['main', 3],
        crouch: ['main', 2], squat: ['main', 17], flee: ['main', 16] }),
      atk: [{ id: 'claw', a: ['main', 4], reach: [20, 50], hit: [2], w: 2 },
        { id: 'kick', a: ['main', 6], kind: 'leap', reach: [90, 130], w: 1 },
        { id: 'pounce', a: ['main', 7], reach: [60, 90], w: 2 },
        { id: 'lowLunge', a: ['main', 5], reach: [30, 60], w: 1 },
        { id: 'clawLunge', a: ['main', 14], reach: [30, 70], w: 1 }],
      cadence: 45,
    },
    // ---------------------------------------------------------------- regent: KING KIMO KIMO (TYROG), +0x23 slot 29 / 30 / 31
    regent: {
      type: 'kingkimo', label: 'variant', variants: { A: 1 }, hp: 'rom', speed: 110 / 1.35 / 60, grab: true, drop: 'food',
      slot: { ch5: 30, ch6: 29, brood: 29 }, maxPerChapter: 4,
      st: R({ idle: ['main', 0], idleHold: ['main', 38], walk: ['main', 20], crawl: ['main', 1], taunt: ['main', 23],
        roar: ['main', 4], rear: ['main', 21], spitPose: ['main', 22], riseTall: ['main', 7], enter: ['main', 21], land: ['main', 25], dead: ['main', 36], flee: ['main', 1] }),
      atk: [{ id: 'lash', a: ['main', 3], reach: [36, 74], w: 3 },
        { id: 'lashFast', a: ['main', 24], reach: [36, 74], w: 1 },
        { id: 'leap', pre: ['main', 21], a: ['main', 25], kind: 'leap', reach: [60, 160], w: 2 },
        // The spit (new for the sequel, ENEMIES §2.5 gives no range) works from TYROG's lash distance too: the parasites
        // leap 60-90 px ahead and then crawl back at the hero. From 60 px it was skipped whenever a hero stood close
        // (G4 verify #2: no spit in natural play).
        { id: 'spit', a: ['main', 22], kind: 'spit', range: [36, 220], obj: ['0x71408:10', '0x71408:11'], spawn: { dx: 60, h: 96 }, n: 2, air: false, dmg: 10, crawl: 2, w: 1 }],
      brood: { variants: 'A', submerge: { hidden: 1.0, tell: 0.9, r: 63, dmg: 30, every: 12 }, roar: ['main', 4], call: { kind: 'mutant', n: 2, max: 2, emerge: 'emerge' } },
      cadence: 50,
    },
    // ---------------------------------------------------------------- biker: Bike RIDE (R) / JUMP (J), rider FERRIS
    biker: {
      type: 'bike', label: 'variant', variants: { R: 2, J: 1 }, hp: 'rom', speed: 4.37, grab: false, drop: null,
      st: { ride: ['main', 0], walk: ['main', 0], enter: ['main', 0], jumpIn: ['main', 1], fly: ['down', 3], flyHeld: ['down', 2], dead: ['down', 9], hurt: [['down', 0]] },
      atk: [{ id: 'ram', a: ['main', 0], kind: 'rush', vx: 4.37, all: true }, { id: 'jumpRam', a: ['main', 1], kind: 'rush', vx: 6.68, all: true, variants: 'J' }],
      onDeath: { explode: true, rider: ['raider', 'B'], riderState: 'bikeFall', riderH: 32 },   // KI15: a GNEISS tumbles off the wreck
      cadence: 0,
    },
    // ---------------------------------------------------------------- slicer: WALTHER (kept defined, no campaign wave spawns it: RC5)
    // Parked (PLAN RC5: no campaign wave spawns it). The table is kept; it ships no art while it carries no `type`/`variants`
    // (the anim-keys gate and the build then skip it). To enable it: move `rom.type`/`rom.variants` up a level and rebuild.
    slicer: {
      parked: true, rom: { type: 'richmond', variants: { B: 1 } }, label: 'variant', hp: 'rom', speed: 'rom', grab: true, drop: 'gun', walk: { B: 2.21 },
      st: R({ idle: ['main', 0], walk: ['main', 1], run: ['main', 4], enter: ['main', 4], jump: ['main', 2], land: ['main', 3], taunt: ['main', 12], flex: ['main', 8],
        draw: ['main', 13], aim: ['main', 14], pistolWalk: ['main', 15], flee: ['main', 4] }),
      atk: [{ id: 'punch', a: ['main', 7], reach: [60, 90], w: 3 },
        { id: 'lunge', a: ['main', 9], kind: 'rush', reach: [90, 134], w: 2 },
        { id: 'kick', a: ['main', 10], reach: [50, 80], w: 2 },
        { id: 'flyKick', a: ['main', 11], kind: 'leap', reach: [70, 90], w: 1 },
        { id: 'pistol', pre: ['main', 13], a: ['main', 16], kind: 'shot', range: [120, 260], n: 3, obj: '0x6FB1A:0', w: 1 }],
      cadence: 45,
    },
    // ---------------------------------------------------------------- dinosaurs and scenery (ENEMIES §3; set pieces, CAMPAIGN §4.5)
    zeke: {
      type: 'pteranodon', label: 'variant', variants: { A: 1 }, hp: 'rom', grab: false, dinosaur: true, setPiece: true,
      st: { fly: ['main', 0], up: ['main', 1], glide: ['main', 3], glideBack: ['main', 2], flap: ['main', 4], swoop: ['main', 6], turn: ['main', 7], flee: ['main', 1], hurt: [['main', 5]] },
      atk: [{ id: 'swoop', a: ['main', 7], kind: 'rush', h: 'head', air: true }],
    },
    skybird: { type: 'pteranodonBg', variants: { A: 1 }, scenery: true, st: { glide: ['main', 0], flap: ['main', 2], speck: ['main', 6] } },
    flock: { type: 'archaeopteryx', variants: { A: 1, B: 1 }, scenery: true, st: { far: '0x5708C:0', far2: '0x5708C:1', fly: '0x5708C:2', flyFast: '0x5708C:3', glide: '0x5708C:4', flock: '0x5674E:0', flockFast: '0x5674E:1' } },
    herd: { type: 'ankirosaurs', variants: { A: 1, M: { type: 'maiasura', w: 1 } }, scenery: true, st: { walk: ['main', 0] }, ankylo: { variants: 'A', st: { step2: ['main', 1], step3: ['main', 2], step4: ['main', 3] } }, maia: { variants: 'M', st: { walk7: ['main', 1] } } },
    hatchling: { type: 'smallRaptor', variants: { A: 1 }, scenery: true, st: { walk: ['main', 0], crouch: ['main', 1], curled: ['main', 2], run: ['main', 3], runFast: ['main', 4], jump: ['main', 5], leap: ['main', 6], land: ['main', 7] } },
    // ---------------------------------------------------------------- hero copies: hero art (ROM_HEROES / HeroRig), no ROM_ENEMIES anims
    mirror: { type: 'hero', hero: true, hp: K.MIRROR_HP, grab: true, palettes: { controlled: 'mirror-<id>', freed: 'freed-<id>', unfinished: 'half-<id>' } },
  };

  // ------------------------------------------------------------------ CAMPAIGN §4.4 cast ids -> [kind, variant, palette ctx?]
  const CAST = {
    ferris: ['raider', 'A'], gneiss: ['raider', 'B'], driver: ['raider', 'C'],
    blade: ['knifer', 'A'], razor: ['knifer', 'B'], knife: ['knifer', 'P'],
    poacherJ: ['gunner', 'A'], skinner: ['gunner', 'B'], gutter: ['gunner', 'C'], dyna: ['gunner', 'T'], bomber: ['gunner', 'U'],
    hammerT: ['brute', 'A'], blkElmer: ['brute', 'B'], wrenchT: ['brute', 'C'], naguri: ['brute', 'N'], lashT: ['brute', 'L'],
    bludge: ['mutant', 'A'], tyrog: ['regent', 'A'], ride: ['biker', 'R'], jump: ['biker', 'J'], hopper: ['raptor', 'A'], mirror: ['mirror', 'hero'],
  };

  // ------------------------------------------------------------------ helpers (pure; no Math.random)
  // the table a variant plays: the kind's, or its `alt` sub-table (Thurow, Naguri, LASH T., KNIFE ONLY) laid over the kind's
  // states when those are not restricted to other variants (st.variants)
  function table(kindId, v) {
    const k = kinds[kindId]; if (!k) return null; const sub = k.alt && k.alt[v]; if (!sub) return k;
    const s = k[sub], baseSt = k.st && !(k.st.variants && !k.st.variants.includes(v)) ? k.st : {};
    const st = Object.assign({}, baseSt, s.st || {}); delete st.variants;
    return Object.assign({}, k, s, { st, atk: s.atk || (k.atk || []).filter(a => !a.variants || a.variants.includes(v)) });
  }
  function typeOf(kindId, v) { const k = kinds[kindId]; if (!k) return null; const e = k.variants && k.variants[v]; return (e && typeof e === 'object' && e.type) || k.type; }
  function variantData(kindId, v) { const F = fam('enemies'), t = typeOf(kindId, v); return F && F.types && F.types[t] ? F.types[t].variants[v] || null : null; }
  // ['main', 3] -> '0x34892:3' for that variant; absolute strings pass through; arrays of refs -> first
  function resolve(kindId, v, ref) {
    if (ref == null) return null;
    if (typeof ref === 'string') return /^0x/i.test(ref) ? ref : null;
    if (Array.isArray(ref[0])) return resolve(kindId, v, ref[0]);
    const d = variantData(kindId, v); if (!d || !d[ref[0]]) return null;
    return `${d[ref[0]]}:${ref[1]}`;
  }
  function stateAnim(kindId, v, state, k = 0) { const t = table(kindId, v); if (!t || !t.st) return null; let r = t.st[state]; if (Array.isArray(r) && Array.isArray(r[0])) r = r[k % r.length]; return resolve(kindId, v, r); }
  function romHp(kindId, v, lvl) { const d = variantData(kindId, v); return d ? d.hp[Math.max(0, Math.min(31, lvl | 0))] : null; }
  // sequel HP before the difficulty multiplier (the engine multiplies by CFG.difficulty[d].enemyHealth)
  function kindHp(kindId, v, ch = 0, diff = 'normal') {
    const k = kinds[kindId]; if (!k) return null; if (k.hero) return K.MIRROR_HP;
    const vv = v || Object.keys(k.variants)[0]; const r = romHp(kindId, vv, K.lvl(ch, diff)); return r == null ? null : K.HP(r);
  }
  // deterministic weighted pick: u in [0, 1)
  function pick(kindId, u) {
    const k = kinds[kindId]; if (!k || !k.variants) return null;
    const ws = Object.entries(k.variants).map(([V, w]) => [V, typeof w === 'object' ? (w.w || 0) : w]).filter(([, w]) => w > 0);
    const tot = ws.reduce((s, [, w]) => s + w, 0); let x = (((u % 1) + 1) % 1) * tot;
    for (const [V, w] of ws) { if (x < w) return V; x -= w; } return ws.length ? ws[ws.length - 1][0] : null;
  }
  // the attack cycle on e.attackNo (weights repeat the attack), skipping entries whose `variants` or `armed` rule fails
  function attackCycle(kindId, v, armed = true) {
    const t = table(kindId, v); if (!t || !t.atk) return [];
    const out = [];
    for (const a of t.atk) { if (a.variants && !a.variants.includes(v)) continue; if (a.armed === true && !armed) continue; if (a.armed === false && armed) continue; if (a.elite) continue; for (let i = 0; i < (a.w || 1); i++) out.push(a); }
    return out;
  }
  // walk speed in px/frame (G4 kindSpeed; ×K.SPD for px/s): a number on the kind wins, then the kind's walk table (the
  // ENEMIES §2.5 values), then the shipped variant walk. Never read ROM_ENEMIES variant.walk alone: a capture can
  // under-read (POACHER J's 4 plays measured 0.188, shipped as 1.13 with walkMeasured kept).
  function kindSpeed(kindId, v) {
    const k = kinds[kindId]; if (!k || k.hero) return null; const sub = table(kindId, v) || k, vv = v || Object.keys(k.variants || {})[0];
    if (typeof sub.speed === 'number') return sub.speed;
    if (sub.walk && typeof sub.walk === 'object' && sub.walk[vv] != null) return sub.walk[vv];
    const d = variantData(kindId, vv); return d && d.walk != null ? d.walk : null;
  }
  // a BOSS_DEFS move's vx (px/s, CAMPAIGN §12.4) in px/frame; 'road+N' needs the road speed in px/frame
  function bossVx(move, roadPxPerFrame = 0) { if (!move || move.vx == null) return null; if (typeof move.vx === 'number') return move.vx / K.SPD; const m = /^road\+(\d+(?:\.\d+)?)$/.exec(String(move.vx)); return m ? roadPxPerFrame + Number(m[1]) / K.SPD : null; }
  // a part move of a multi-part boss body (BOSS_DEFS.<id>.partMoves; none since CROWNBACK left the six-part stand-in)
  function bossPartMove(bossId, list, name) { const d = BOSS_DEFS[bossId], pm = d && d.partMoves; if (!pm) return null; return (pm[list === 'necks' ? 'necks' : 'body'] || {})[name] || null; }
  function paletteKey(kindId, v, ctx) { const F = fam('enemies'), t = typeOf(kindId, v); if (!F || !F.palMap) return null; return (ctx && F.palMap[`${t}:${v}/${ctx}`]) || F.palMap[`${t}:${v}`] || null; }

  const ENEMY_KINDS = Object.assign(kinds, { K, CAST, REACT, BOSS_REACT, table, typeOf, variantData, resolve, stateAnim, romHp, kindHp, kindSpeed, bossVx, bossPartMove, pick, attackCycle, paletteKey });

  // ------------------------------------------------------------------ BOSS_DEFS (CAMPAIGN §12.4; kind ids kept, D10)
  // Names, cards and summons follow STORY.md (The Crown Tide). Until the boss rebuild the fights keep their ROM bodies as
  // stand-in: the gate controls on the Crown bake. Warden
  // Rook, Krag / Ironclub, Thorne / Glassback, Cinder / Overdrive, Dr. Echo / Echo Engine, Marshal Sable and CROWNBACK (kind 'fessenden', the engine's id) have their own generated
  // bodies (tools/art/import-sprite.cjs; sprite-data-boss-*.js, loaded after sprite-data-bosses.js).
  const BOSS_DEFS = {
    // Warden Rook on his generated body ('rook', sprite-data-boss-rook.js; tools/art/specs/rook.json; BOSS-SPECS 1): anims 0 idle,
    // 1 walk, 2 hook pull (the hook lowered 30 ticks, thrust, full extension, yank back), 3 the hook stuck in the planks,
    // 4 barrel kick (boot on the barrel, the kick; his keg frame 10 rolls off), 5 crane call (the rope coil raised, the
    // shout), 6 rope swing, 7 hurt, 8 the desperate shout, 9 the arrest (recoil, drops the hook, sits on a mooring post,
    // hands up), 10 the keg; set 'rook-hit': 2 the knockdown (stagger, fall, lying with the hook), 4 the get-up (one knee).
    // Pattern: hook pulls between rope swings and barrels (a caught hero is dragged in, knocked down and kicked a barrel at;
    // a miss sticks the hook, x1.5); from 60 % the tide, from 50 % enraged with the crane every cycle.
    warden: { name: 'WARDEN ROOK', body: 'rook', pal: 'home', chain: false, flinch: 'main:7', keg: 'main:10', hp: 1200, clone: false,
      // the user found him a push-over (760 HP, idle between moves): 1200 HP, a faster cadence (tempo 1.25: shorter idle and
      // recovery), a quicker walk to close the distance, the rope swing whenever a hero crowds him, the hook pull knocking
      // a caught hero down and chaining into a barrel kick (a miss sticks the hook: the punish window), harder hits, the
      // intro slam with his taunt, and the enrage at 50 % (roar pose, tempo x1.3, the crane every cycle, a barrel then
      // the crane); guards at 66 % / 33 % as every boss. Every move keeps its tell.
      tempo: 1.25, walkMul: 1.35, near: { move: 'rope', r: 52, cd: 2.4 },
      intro: { walk: 'main:1', pose: 'main:3', slam: true, t: 2.4 },
      moves: { gaff: { a: 'main:2', kind: 'pull', reach: 118, lane: 20, dmg: 20, pullTo: 48, knock: true, then: 'barrel', miss: 'stuck' }, stuck: { a: 'main:3', kind: 'window', t: 0.67, hurt: 1.5 },
        barrel: { a: 'main:4', kind: 'lob', proj: 'barrel', vx: 210, dmg: 22, knock: true, max: 2, dx: 60, hide: 0.3, then: 'crane', thenBelow: 0.5 }, rope: { a: 'main:6', kind: 'zone', r: 64, ticks: 1, dmg: 18, within: 56 },
        crane: { a: 'main:5', kind: 'env', telegraph: 0.9, r: 52, dmg: 30, leaves: 'crate', from: 0.5 }, tide: { kind: 'env', every: 10, tell: 1.0, band: [192, 224], dmg: 18, knock: true, air: false, from: 0.6 },
        desperate: { a: 'main:8', kind: 'script', at: 0.5, inv: 1.2, tempo: 1.3, toast: 'ROOK IS ENRAGED', shake: 10 } },
      phases: [{ at: 1, pattern: ['gaff', 'rope', 'gaff', 'barrel', 'gaff', 'rope'] }, { at: 0.5, pattern: ['gaff', 'crane', 'rope', 'barrel', 'gaff', 'crane'] }],
      defeat: { anim: 'main:9', arrest: true, note: 'arrested: drops the hook, sits on a mooring post, hands up (held; no dissolve)' } },
    // HAULMASTER KRAG -> IRONCLUB (kind 'truck', the engine's id; chapter 2). The convoy's haulmaster takes an early test
    // dose of Echo's serum (the Crown treatment's first trial) and becomes an armoured ankylosaur-man. Fought on foot: at
    // the last wagon's lock the convoy halts and the gang leaves the Cadillac. Phase 1 on 'krag' (sprite-data-boss-krag.js;
    // tools/art/specs/krag.json): anims 0 idle, 1 walk, 2 chain whip (the chain drawn back, the lash along his lane), 3 the
    // shoulder charge, 4 hurt, 5 the serum (syringe, plates bursting). At 0 HP he transforms (Krag's main 5, then
    // Ironclub's main 9: invulnerable) into phase 2 on 'ironclub' (sprite-data-boss-ironclub.js): 0 idle, 1 walk, 2 tail
    // club (raised behind, the spin, the low smash in front, back to stance), 3 overhead smash (both clubs up, the
    // shockwave), 4 curling up, 5 the rolling ball, 6 uncurling (open, x1.5), 7 hurt, 8 defeat (cracking, stagger, knees,
    // lying half-human: arrested), 9 the end of the serum, 10 lying.
    truck: { name: 'HAULMASTER KRAG', body: 'krag', pal: 'home', hp: 340, clone: false, onFoot: true, flinch: 'main:4', sparks: true,
      intro: { walk: 'main:1', pose: 'main:2', t: 2.4 },
      moves: { whip: { a: 'main:2', kind: 'strike', depth: 18, dmg: 16 }, charge: { a: 'main:3', kind: 'rush', vx: 300, dmg: 18, knock: true } },
      phases: [{ at: 1, pattern: ['whip', 'whip', 'charge', 'whip', 'charge'] }],
      transform: { anims: [5, 9], t: 2.4, note: 'Krag main 5 then Ironclub main 9, invulnerable' },
      phase2: { name: 'IRONCLUB', body: 'ironclub', hp: 560, flinch: 'main:7',
        moves: { tail: { a: 'main:2', kind: 'zone', depth: 36, hits: [{ behind: true, r: 110 }, { r: 120 }], r: 120, dmg: 22, knock: true },
          smash: { a: 'main:3', kind: 'zone', shock: true, r: 84, dmg: 24, knock: true },
          roll: { a: 'main:4>5', kind: 'rush', vx: 380, dmg: 24, knock: true, spin: true, after: { a: 'main:6', t: 0.9, hurt: 1.5 } } },
        pattern: ['tail', 'smash', 'roll', 'tail', 'roll', 'smash'],
        defeat: { anim: 'main:8', arrest: true, note: 'back to human, arrested (no death)' } } },
    // HEADKEEPER THORNE -> GLASSBACK (kind 'raptor', the engine's id; chapter 3). Thorne runs Sable's hatchery in the
    // glass dome and steers the collared raptors with the NEST SONIC DRIVER (the beacon objective at lock.right - 260).
    // Phase 1 on 'thorne' (sprite-data-boss-thorne.js; tools/art/specs/thorne.json): anims 0 idle, 1 walk, 2 the electric
    // staff thrust (along her lane), 3 the overhead swing, 4 hurt, 5 the whistle (the pack answers), 6 the graft (syringe,
    // feathers bursting). At 0 HP she injects the therizinosaur graft (Thorne's main 6, then Glassback's main 8:
    // invulnerable) and fights on as GLASSBACK (sprite-data-boss-glassback.js): 0 idle, 1 walk, 2 claw sweep (claws
    // crossed high 30 ticks, the slash, the long low sweep, recovery), 3 the crouch, 4 the pounce (in the air, landing),
    // 5 the screech (raptors answer), 6 hurt, 7 defeat (feathers flying, stagger, knees, lying human again: arrested),
    // 8 the end of the graft, 9 lying. The driver steers her: while it hums Glassback cannot be beaten (hpFloor) and keeps
    // to its leash (tether); every third of its HP lost staggers her (drowsy); once it is smashed she is open (x1.5).
    raptor: { name: 'HEADKEEPER THORNE', body: 'thorne', pal: 'home', hp: 320, clone: false, flinch: 'main:4', callA: 'main:5',
      driver: { name: 'NEST SONIC DRIVER', at: 'lock.right-260' }, tether: 260,
      intro: { walk: 'main:1', pose: 'main:5', t: 2.4 },
      moves: { thrust: { a: 'main:2', kind: 'strike', depth: 18, dmg: 16 }, swing: { a: 'main:3', kind: 'strike', reach: 62, dmg: 18, knock: true },
        whistle: { a: 'main:5', kind: 'summon', type: 'raptor', n: 2, ifAliveBelow: 2, from: 0.8 },
        drowsy: { kind: 'state', onDriverThird: true, t: 3, hurt: 1.5 }, roar: { kind: 'summon', type: 'raptor', n: 2, once: 0.66 } },
      phases: [{ at: 1, pattern: ['thrust', 'swing', 'thrust', 'whistle', 'swing'] }],
      transform: { anims: [6, 8], t: 2.4, note: 'Thorne main 6 then Glassback main 8, invulnerable' },
      phase2: { name: 'GLASSBACK', body: 'glassback', hp: 520, flinch: 'main:6', callA: 'main:5', driver: { name: 'NEST SONIC DRIVER', hpFloor: 1 },
        moves: { sweep: { a: 'main:2', kind: 'strike', reach: 92, depth: 30, dmg: 22, knock: true, air: false }, pounce: { a: 'main:3>4', kind: 'leap', range: [70, 170], r: 56, dmg: 22, shadow: true },
          screech: { a: 'main:5', kind: 'summon', type: 'raptor', n: 2, ifAliveBelow: 2 }, drowsy: { kind: 'state', onDriverThird: true, t: 3, hurt: 1.5 } },
        pattern: ['sweep', 'pounce', 'sweep', 'screech', 'pounce', 'sweep'],
        defeat: { anim: 'main:7', arrest: true, note: 'the graft burns out: lying human again, arrested; the eggs and the pack are safe' } } },
    // FOREMAN CINDER -> OVERDRIVE CINDER (kind 'cinder'; chapter 4). Not a serum: losing, he slams his diving helmet shut and
    // overloads his steam rig into heavy brass armour with a steam-cannon pile-driver arm. Phase 1 on 'cinder'
    // (sprite-data-boss-cinder.js; tools/art/specs/cinder.json): anims 0 idle, 1 walk, 2 driver slam (raised high, then
    // into the floor: a shockwave ring to jump), 3 driver punch along his lane, 4 charge, 5 hurt, 6 the overload (helmet
    // shut, plates locking). At 0 HP (about 55 % of the fight left) he overloads (Cinder's main 6, then Overdrive's main 9:
    // invulnerable) into phase 2 on 'overdrive' (sprite-data-boss-overdrive.js): 0 idle, 1 walk, 2 steam cannon (the red
    // gauge 40 ticks, the punch, the shot: a round down his lane and the muzzle burst 'cinderfx'), 3 the stuck arm in
    // dark smoke (x1.5), 4 steam vent (the stacks blow, then a scalding cloud round his feet), 5 shoulder charge, 6 skid
    // stop, 7 hurt, 8 defeat (cracked plates, plates falling, kneeling with the helmet open, sitting with his hands up
    // beside the broken rig, frame 10, left on the floor). From half of each form the pumps surge every 8 s.
    cinder: { name: 'FOREMAN CINDER', body: 'cinder', pal: 'home', hp: 420, clone: false, flinch: 'main:5',
      intro: { walk: 'main:1', pose: 'main:2', t: 2.4 },
      moves: { slam: { a: 'main:2', kind: 'zone', shock: true, r: 70, dmg: 22, knock: true }, drive: { a: 'main:3', kind: 'strike', reach: 96, depth: 18, dmg: 16 },
        charge: { a: 'main:4', kind: 'rush', vx: 280, dmg: 18, knock: true },
        surge: { kind: 'env', every: 8, zones: [-70, 70], t: 1.25, dmg: 24, air: false, from: 0.5 } },
      phases: [{ at: 1, pattern: ['drive', 'slam', 'charge', 'drive', 'slam'] }],
      transform: { anims: [6, 9], t: 2.4, note: 'Cinder main 6 then Overdrive main 9, invulnerable' },
      phase2: { name: 'OVERDRIVE CINDER', body: 'overdrive', hp: 520, flinch: 'main:7', rig: 'main:10', fx: 'cinderfx',
        moves: { cannon: { a: 'main:2', kind: 'shot', cannon: true, muzzle: { dx: 143, dz: 86 }, vx: 300, dmg: 22, knock: true },
          jam: { a: 'main:3', kind: 'window', t: 0.83, hurt: 1.5 },
          vent: { a: 'main:4', kind: 'zone', cloud: true, r: 72, t: 1.6, dmg: 9 },
          charge: { a: 'main:5', kind: 'rush', vx: 340, dmg: 22, knock: true, after: { a: 'main:6', t: 0.5 } },
          surge: { kind: 'env', every: 8, zones: [-70, 70], t: 1.25, dmg: 24, air: false, from: 0.5 } },
        pattern: ['cannon', 'jam', 'vent', 'charge', 'cannon', 'jam', 'vent'],
        defeat: { anim: 'main:8', arrest: true, note: 'he climbs out of the broken rig and surrenders, hands up (no melt)' } } },
    // DR. ECHO -> ECHO ENGINE (kind 'echo'; chapter 5). Echo invented the serum but never tests it on herself: cornered in
    // the observatory she climbs into her four-legged brass sound-walker. Phase 1 on 'echo' (sprite-data-boss-echo.js;
    // tools/art/specs/echo.json): anims 0 idle, 1 walk, 2 dish ring (the dish raised over her shoulder 36 ticks, then a
    // violet ring 'echoring' down her lane), 3 tuning-fork jab, 4 hurt, 5 the call (dish raised). At 0 HP (about 55 % of
    // the fight left) she boards the Engine (Echo's walk, then the walker's main 9: jumping on, climbing in, rising;
    // invulnerable) and fights on as ECHO ENGINE (sprite-data-boss-engine.js): 0 idle, 1 walk, 2 sonic beam (dishes
    // aimed and glowing 40 ticks, then the beam 'enginefx' main 0 down her lane, 260 px; the lane is marked during the
    // tell), 3 overheat (steaming, x1.5), 4 stomp (rearing up, the front legs slam: a violet ring, enginefx main 1, to
    // jump), 5 crouch, 6 the low leap onto a lane (its shadow marks the landing), 7 hurt, 8 defeat (sparking, legs
    // buckling, collapsed with Echo climbing out, Echo kneeling with her hands up beside the wreck, frame 10).
    echo: { name: 'DR. ECHO', body: 'echo', pal: 'home', hp: 420, clone: false, flinch: 'main:4', callA: 'main:5',
      intro: { walk: 'main:1', pose: 'main:5', t: 2.4 },
      moves: { ring: { a: 'main:2', kind: 'shot', cannon: true, projBody: 'echoring', muzzle: { dx: 46, dz: 70 }, vx: 260, dmg: 18 },
        fork: { a: 'main:3', kind: 'strike', reach: 58, dmg: 14 }, backstep: { a: 'main:1', kind: 'move', within: 60, back: [60, 100] },
        drain: { kind: 'env', at: 0.5, style: 'flood', zones: [-70, 0, 70], t: 1.25, dmg: 24, air: false } },
      phases: [{ at: 1, pattern: ['ring', 'fork', 'backstep', 'ring', 'ring', 'fork'] }],
      transform: { anims: [1, 9], t: 2.4, note: 'Echo walk then the Engine main 9 (boarding), invulnerable' },
      phase2: { name: 'ECHO ENGINE', body: 'engine', hp: 520, flinch: 'main:7', fx: 'enginefx', jet: 'enginefx', rig: 'main:10', rigFrom: 3, rigDx: 96,
        moves: { beam: { a: 'main:2', kind: 'jet', len: 260, lane: 16, t: 0.6, dmg: 24, knock: true, mouth: { dx: 64, z: 136 } },
          overheat: { a: 'main:3', kind: 'window', t: 0.83, hurt: 1.5 },
          quake: { a: 'main:4', kind: 'zone', shock: true, ringFx: 1, r: 86, dmg: 22, knock: true },
          pounce: { a: 'main:5>6', kind: 'leap', range: [70, 170], r: 60, dmg: 22, shadow: true },
          grafts: { kind: 'summon', at: 0.33, type: 'mutant', n: 2, hp: 60, from: 'B' } },
        pattern: ['beam', 'overheat', 'quake', 'pounce', 'beam', 'overheat', 'quake'],
        defeat: { anim: 'main:8', arrest: true, note: 'the walker collapses; Echo kneels with her hands up beside the wreck and surrenders (arrested)' } } },
    // Sable is drawn on his own generated body ('sable', sprite-data-boss-sable.js; tools/art/specs/sable.json): anims
    // 0 idle, 1 walk, 2 draw (raise, aim), 3 volley (six shots: the art's muzzle-flash frames are the active frames),
    // 4 quick shot, 5 reload, 6 pistol whip (the close-range blow), 7 command (gun raised), 8 hop (the cornered step-out),
    // 9 the treatment (inject, swell, half-grown; Crownback's transform anim finishes it). His muzzle sits 81 px up.
    sable: { name: 'MARSHAL SABLE', body: 'sable', pal: 'home', hp: 800, clone: false, bullet: '0xEC', muzzle: 81,
      intro: { walk: 'main:1', pose: 'main:2', t: 2.4 },
      moves: { draw: { a: 'main:2', kind: 'tell' }, fan: { a: 'main:3', kind: 'volley', n: 6, lanes: [0, -24, 24], dmg: 16 }, quick: { a: 'main:4', kind: 'shot', dmg: 18 }, reload: { a: 'main:5', kind: 'window', t: 0.5, hurt: 1.5, line: 'reload' },
        punch: { a: 'main:6', kind: 'strike', reach: 44, dmg: [10, 19] }, kick: { a: 'main:8', kind: 'leap', when: 'cornered', dmg: 14 }, summon: { a: 'main:7', kind: 'summon', type: 'knifer', n: 2, hp: 70, ifAliveBelow: 2 } },
      phases: [{ at: 1, pattern: ['draw', 'fan', 'reload', 'quick', 'punch'] }, { at: 0.6, pattern: ['quick', 'fan', 'kick', 'reload', 'summon'] }],
      phase2: { name: 'SABLE · GATE CONTROLS', art: { bake: 'E8a3 throne steps + glass capsule (~200x150) + two blue tank columns, standing in for the dam control chair', pal: 'crown', insert: 'sable idle clipped in the glass' }, hp: 1050, stationary: true, hurtBox: 'capsule', hurtAfterSurge: { mult: 1.5, t: 3 },
        moves: { turrets: { kind: 'volley' }, surge: { kind: 'env', style: 'flood', zones: [-70, 0, 70], r: 43, t: 1.25, dmg: 30, air: false }, vents: { kind: 'zone', style: 'slam', tell: 0.9, r: 83 }, summon: { kind: 'summon', type: 'raider', n: 2, hp: 70, from: 'R' } },
        pattern: ['turrets', 'surge', 'vents', 'summon', 'surge'], defeat: { sparks: true, gate: 'FINAL SPILLWAY RELEASE', say: 'gateSay' } } },
    // CROWNBACK (kind 'fessenden', the engine's id; work/story2/BOSS-SPECS.md 6c) on his generated body ('crownback',
    // sprite-data-boss-crownback.js; tools/art/specs/crownback.json): anims 0 idle, 1 walk, 2 gate-arm sweep (shoulder drawn
    // back 30 ticks, arm across, the extended blow, head-down recovery), 3 tail sweep (tail lifted 30 ticks, the swing behind,
    // the low sweep round the front, back to stance), 4 pressure release (gills open 36 ticks, the jet, the braced vent
    // recovery), 5 brace (hand planted), 6 rush (the low charge), 7 hurt (stagger), 8 roar, 9 defeat (roar, stagger, fall,
    // lying), 10 the end of the treatment (half-grown, roaring; Sable's anim 9 starts it), 11 lying in the spillway, 12 the crouch
    // before the rush. The jet
    // is its own body ('crownjet'). Phases: planted behind the shield arm (the spillway wheels stagger him), wading out at
    // 66 % when the arm plates crack, the guard broken at 33 % (x1.5, two guards, the desperate rush).
    fessenden: { name: 'CROWNBACK', body: 'crownback', jet: 'crownjet', art: ['sable'], hp: 1150, clone: false, walkA: 'main:1', flinch: 'main:7',
      intro: { treatment: true, settle: 'lock.right-120', t: 3.4, card: 'CROWNBACK · THE CROWN TREATMENT', byHero: true, inv: true },
      targets: 'hostileTarget (allies included)',
      moves: { gatearm: { a: 'main:2', kind: 'strike', depth: 44, dmg: 30, knock: true }, tail: { a: 'main:3', kind: 'zone', depth: 40, hits: [{ behind: true, r: 150 }, { r: 150 }], r: 150, dmg: 22, knock: true },
        jet: { a: 'main:4', kind: 'jet', len: 240, lane: 14, t: 0.55, dmg: 26, knock: true, mouth: { dx: 86, z: 95 } }, brace: { a: 'main:5', kind: 'env', style: 'flood', zones: [-70, 0, 70], r: 43, t: 1.25, dmg: 24, air: false },
        rush: { a: 'main:12>6', kind: 'rush', vx: 384, dmg: 26, knock: true, from: 0.34 } },
      phases: [{ at: 1, mode: 'planted', wheels: { at: ['lock.left+90', 'lock.center'], hold: 1, stagger: 4, hurt: 1.5, recharge: 12 }, pattern: ['gatearm', 'jet', 'tail', 'gatearm', 'brace'], speed: 0.6 },
        { at: 0.66, mode: 'wading', roar: true, pattern: ['gatearm', 'tail', 'jet', 'gatearm', 'brace', 'tail'], speed: 1 },
        { at: 0.33, mode: 'collapse', roar: true, bodyHurt: 1.5, pattern: ['rush', 'gatearm', 'jet', 'tail', 'rush', 'brace'], speed: 1.25, summon: { type: 'raider', n: 2, hp: 70, once: true }, line: 'p20 at 0.2' }],
      defeat: { anim: 'main:9', lie: 'main:11', box: { who: 'sable', line: 'defeat' }, crossfade: 1.5, then: 'clear' } },
  };

  // ------------------------------------------------------------------ readiness (ENEMIES §2.1, §8): ROM_ENEMIES.ready / ROM_BOSSES.ready
  // The data modules ship ready:false; once sprites.js has decoded and verified a family's sheets, its ready reads true.
  for (const [g, name] of [['ROM_ENEMIES', 'enemies'], ['ROM_BOSSES', 'bosses']]) {
    const fam = root[g] || (root.SPRITE_DATA && root.SPRITE_DATA.families && root.SPRITE_DATA.families[name]);
    if (fam && typeof fam === 'object') try { Object.defineProperty(fam, 'ready', { configurable: true, enumerable: true, get() { const S = root.SPRITES; return !!(S && typeof S.familyReady === 'function' && S.familyReady(name)); } }); } catch (e) { /* frozen */ }
  }

  root.ENEMY_KINDS = ENEMY_KINDS;
  root.BOSS_DEFS = BOSS_DEFS;
})(typeof window !== 'undefined' ? window : globalThis);
