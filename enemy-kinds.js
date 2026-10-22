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
  // a LOT 00 phase entry ('arm grab' in phases[].body, 'bite' in phases[].necks) -> its part move
  function bossPartMove(bossId, list, name) { const d = BOSS_DEFS[bossId], pm = d && d.partMoves; if (!pm) return null; return (pm[list === 'necks' ? 'necks' : 'body'] || {})[name] || null; }
  function paletteKey(kindId, v, ctx) { const F = fam('enemies'), t = typeOf(kindId, v); if (!F || !F.palMap) return null; return (ctx && F.palMap[`${t}:${v}/${ctx}`]) || F.palMap[`${t}:${v}`] || null; }

  const ENEMY_KINDS = Object.assign(kinds, { K, CAST, REACT, BOSS_REACT, table, typeOf, variantData, resolve, stateAnim, romHp, kindHp, kindSpeed, bossVx, bossPartMove, pick, attackCycle, paletteKey });

  // ------------------------------------------------------------------ BOSS_DEFS (CAMPAIGN §12.4 verbatim; kind ids kept, D10)
  const BOSS_DEFS = {
    warden: { name: 'WARDEN ROOK', body: 'butcher', pal: 'rook', line: 'vice-chain 0x945CC', hp: 760, clone: true,
      intro: { walk: '0x6FDEC/1', pose: '0x6FDEC/18', t: 2.4 },
      moves: { hook: { a: 'main:9', kind: 'strike', reach: 104, dmg: 18 }, flurry: { a: 'main:11', kind: 'zone', r: 56, ticks: 3, dmg: 12 },
        gaff: { a: 'main:12>9', kind: 'pull', reach: 190, lane: 20, dmg: 14, pullTo: 52, then: 'hook' }, barrel: { a: 'main:25>6', kind: 'lob', proj: 'barrel', vx: 190, dmg: 18, knock: true, max: 2 },
        roll: { a: 'main:4>7', kind: 'rush', vx: 330, dmg: 20, air: false }, drop: { a: 'main:16>24', kind: 'leap', r: 66, dmg: 22 },
        crane: { kind: 'env', telegraph: 0.9, r: 52, dmg: 28, leaves: 'crate', from: 0.4 }, tide: { kind: 'env', every: 10, tell: 1.0, band: [192, 224], dmg: 16, knock: true, air: false, from: 0.6 },
        glitch: { kind: 'script', at: 0.25, inv: 1.2, tempo: 1.2, line: 'p25' } },
      phases: [{ at: 1, pattern: ['hook', 'flurry', 'barrel', 'gaff', 'hook'] }, { at: 0.6, pattern: ['roll', 'gaff', 'drop', 'flurry', 'barrel', 'crane'] }] },
    truck: { name: 'LOT 44 · MACK', body: 'torikeratopss', ctx: 't98-e5a0-pal30', palFallback: 'ironhide', line: 'vice-chain (tow leash)', hp: 860, clone: false, drive: true, sparks: true,
      intro: { jumpIn: 'main:3', then: 'main:4', t: 2.4 }, hurt: { ram: 1, gun: 1, ramInRecover: 2, other: 0 },
      moves: { pace: { a: 'main:7|2', kind: 'follow', t: 2.0, contact: 56, dmg: 12 }, gore: { a: 'main:4>2', kind: 'rush', tell: 0.6, vx: 'road+300', dmg: 24, knockCar: true },
        headon: { a: 'main:2', kind: 'rush-front', tell: 1.0, dmgCar: 20, dmgSelf: 40 }, recover: { a: 'main:5', kind: 'window', t: 1.2 }, bellow: { a: 'main:1', kind: 'summon', type: 'biker', n: 2, at: [0.66, 0.33] } },
      phases: [{ at: 1, pattern: ['pace', 'gore', 'recover', 'pace', 'headon', 'recover'] }, { at: 0.5, pattern: ['gore', 'headon', 'recover', 'gore', 'recover'] }], defeat: { collar: 'snap', anim: 'main:0', flee: 'sea' } },
    raptor: { name: 'VERDANT REGENT', body: 'arosaurus', ctx: 't60-e2a1-pal30', palFallback: 'verdant', line: 'vice-chain (to the driver)', hp: 840, clone: false, driver: { name: 'NEST SONIC DRIVER', at: 'lock.right-260', hpFloor: 1 }, tether: 260,
      intro: { roar: 'main:10', walk: 'main:20..27', t: 2.4 },
      moves: { stomp: { a: 'main:20..27', kind: 'rush', vx: 260, dmg: 22 }, bite: { a: 'main:11', kind: 'strike', hits: 2, reach: 89, dmg: 18 }, lunge: { a: 'main:12', kind: 'leap', range: [67, 155], dmg: 22 },
        tail: { a: 'main:13', kind: 'zone', behind: true, r: 60, dmg: 18, knock: true }, roar: { a: 'main:10', kind: 'summon', type: 'raptor', n: 2, once: 0.66 }, drowsy: { kind: 'state', onDriverThird: true, t: 3, hurt: 1.5 } },
      phases: [{ at: 1, pattern: ['stomp', 'bite', 'lunge', 'tail', 'bite'] }, { at: 0.5, pattern: ['bite', 'tail', 'lunge', 'stomp', 'tail'] }], defeat: { when: 'driver destroyed', say: 'driverDeadSay', flee: 'right' } },
    // cinder: two anims differ from the CAMPAIGN §12.4 literal (boss changes are allowed). The live logs show Morgan's rock
    // (type 0x110) created on the first tick of main 11 frame 0 (ROM_BOSSES.bodies.morgan.throwFrame: the arm drawn back
    // behind the head; the extract's 'head-butt' label is wrong), and main 3 is the pointing taunt. So slag plays main 11
    // and releases on frame 0; the headbutt strike plays main 7 (the jab, live attack id 8).
    cinder: { name: 'FOREMAN CINDER', body: 'morgan', pal: 'cinder', proj: '0x71408', hp: 940, clone: true,
      intro: { walk: 'main:1', pose: 'main:3', t: 2.4 },
      moves: { slag: { a: 'main:11', release: 0, kind: 'lob', proj: 'rock:3', arc: 0.8, dmg: 18, burn: { r: 30, t: 1.5 } }, rivets: { kind: 'volley', proj: 'knife:2', n: 3, lanes: [0, -24, 24], dmg: 12 }, grenade: { proj: '0x68:0', kind: 'lob', r: 56, dmg: 20 },
        steam: { a: 'main:2', kind: 'zone', style: 'fire', tell: 0.8, r: 70, dmg: 20 }, hop: { a: 'main:5|6', kind: 'rush', within: 74, dmg: 18 }, headbutt: { a: 'main:7', kind: 'strike', dmg: 20 },
        backstep: { a: 'main:17r', kind: 'move', within: 66, back: [60, 100] }, surge: { a: 'main:12', kind: 'env', every: 8, zones: [-70, 70], t: 1.25, dmg: 24, air: false, from: 0.5 } },
      phases: [{ at: 1, pattern: ['slag', 'rivets', 'steam', 'slag', 'grenade'] }, { at: 0.5, pattern: ['rivets', 'slag', 'hop', 'steam', 'grenade'] }],
      defeat: { script: ['main:8', { flash: ['cinder', 'gel'], n: 3 }, 'bossDefeat', 'dissolve'], t: 2.6, note: 'no MORGUE frames' } },
    echo: { name: 'LOT 04 · SLICE', body: 'slice', pal: 'slicevat', hp: 940, clone: true,
      intro: { walk: 'main:4', pose: 'main:9', t: 2.4 },
      moves: { lash: { a: 'main:8', kind: 'strike', reach: 111, dmg: 22, air: true }, sweep: { a: 'main:7|12', kind: 'rush', vx: 280, len: 100, dmg: 20, air: false }, flip: { a: 'main:2>11', kind: 'leap', to: 'hero.x-dir*52', dmg: 20 },
        jab: { a: 'main:5', kind: 'strike', dmg: 12 }, sway: { a: 'main:10', kind: 'taunt', t: 0.5 }, drain: { kind: 'env', at: 0.66, style: 'flood', zones: [-70, 0, 70], t: 1.25, dmg: 24, air: false },
        unfinished: { kind: 'summon', at: 0.33, type: 'mirror', n: 2, hp: 60, pal: 'half', from: 'B' } },
      phases: [{ at: 1, pattern: ['lash', 'sweep', 'flip', 'jab', 'lash'] }, { at: 0.5, pattern: ['flip', 'lash', 'flip', 'sweep', 'sway'] }], defeat: { script: ['hits:5', 'hits:4 held', 'bossDefeat', 'dissolve'] } },
    sable: { name: 'MARSHAL SABLE', body: 'richmond', pal: 'sable', hp: 800, clone: false, bullet: '0xEC',
      intro: { walk: 'main:1', pose: 'main:13>12', t: 2.4 },
      moves: { draw: { a: 'main:13', kind: 'tell' }, fan: { a: 'main:16', kind: 'volley', n: 6, lanes: [0, -24, 24], dmg: 16 }, quick: { a: 'main:14', kind: 'shot', dmg: 18 }, reload: { a: 'main:15', kind: 'window', t: 0.5, hurt: 1.5, line: 'reload' },
        punch: { a: 'main:7|9', kind: 'strike', dmg: [10, 19] }, kick: { a: 'main:11', kind: 'leap', when: 'cornered', dmg: 14 }, summon: { a: 'main:5', kind: 'summon', type: 'mirror', n: 2, ifAliveBelow: 2 } },
      phases: [{ at: 1, pattern: ['draw', 'fan', 'reload', 'quick', 'punch'] }, { at: 0.6, pattern: ['quick', 'fan', 'kick', 'reload', 'summon'] }],
      phase2: { name: 'CROWN ENGINE', art: { bake: 'E8a3 throne steps + glass capsule (~200x150) + two blue tank columns', pal: 'crown', insert: 'sable idle clipped in the glass' }, hp: 1050, stationary: true, hurtBox: 'capsule', hurtAfterSurge: { mult: 1.5, t: 3 },
        moves: { turrets: { kind: 'volley' }, surge: { kind: 'env', style: 'flood', zones: [-70, 0, 70], r: 43, t: 1.25, dmg: 30, air: false }, vents: { kind: 'zone', style: 'slam', tell: 0.9, r: 83 }, summon: { kind: 'summon', type: 'mirror', n: 2, from: 'R' } },
        pattern: ['turrets', 'surge', 'vents', 'summon', 'surge'], defeat: { sparks: true, gate: 'FINAL SPILLWAY RELEASE', say: 'gateSay' } } },
    fessenden: { name: 'LOT 00 · FESSENDEN', body: 'fessenden', parts: ['body', 'arm', 'arm2', 'neckA', 'neckB', 'line'], ctx: 'S8A3', hp: 1150, clone: true,
      intro: { crack: true, cutIn: false, walk: 'body main:1', spawn: 'lock.right+60', settle: 'lock.right-140', t: 3.2, card: 'THE LAST COPY', byHero: true },
      targets: 'hostileTarget (allies included)',
      phases: [{ at: 1, mode: 'planted', wheels: { at: ['lock.left+90', 'lock.center'], hold: 1, stagger: 4, hurt: 1.5, recharge: 12 }, body: ['arm grab', 'arm extend', 'line'], necks: ['bite', 'rise'] },
        { at: 0.66, melt: 'neckB', mode: 'wading', body: ['lunge', 'chomp', 'arm grab', 'bite', 'line'], neckTempo: 1.15 },
        { at: 0.33, melt: 'arm', mode: 'collapse', bodyHurt: 1.5, necks: ['bite', 'bite', 'rise'], neckTempo: 1.25, summon: { type: 'mirror', n: 2, once: true }, line: 'p20 at 0.2' }],
      defeat: { anim: 'body main:10', box: { who: 'fessenden', line: 'defeat' }, gore: 'main:11..14 gel ramp', crossfade: 1.5, then: 'clear' } },
  };

  // ------------------------------------------------------------------ resolved part moves of LOT 00 (ENEMIES §6.7; names used by the phases above)
  // A helper table so the executor does not parse 'arm grab': part, anim (part-relative 'main:n'), kind and numbers. Two
  // lists because one name means a different move per scheduler: phases[].body names (the body, its arms and the line)
  // resolve in partMoves.body, phases[].necks names in partMoves.necks (ENEMY_KINDS.bossPartMove('fessenden', list, name)).
  // vx in px/s like every BOSS_DEFS move (the lunge is ENEMIES §6.7's 6.4 px/f).
  BOSS_DEFS.fessenden.partMoves = {
    body: {
      'bite': { part: 'body', a: 'body main:6', kind: 'strike', dmg: 32 }, 'chomp': { part: 'body', a: 'body main:7', kind: 'grab', hold: 100, dmg: [17, 23] },
      'leanbite': { part: 'body', a: 'body main:8', kind: 'strike', dmg: 32 }, 'lunge': { part: 'body', a: 'body main:4', kind: 'rush', vx: 384 },
      'arm grab': { part: 'arm', a: 'arm main:2', kind: 'grab', reach: 200, dmg: 38 }, 'arm extend': { part: 'arm', a: 'arm main:3', kind: 'strike', dmg: 32 },
      'arm2 extend': { part: 'arm2', a: 'arm2 main:1', kind: 'strike', dmg: 17 }, 'line': { part: 'line', a: 'line main:11>10', kind: 'strike', lane: true, dmg: 20 },
      'collapse': { part: 'body', a: 'body main:9>10', kind: 'state', t: 2.5 }, 'flinch': { part: 'body', a: 'body main:15..22', kind: 'react' },
    },
    necks: {
      'bite': { part: 'neck', a: 'neckA main:1', kind: 'strike', dmg: 22, target: 'nearest' }, 'rise': { part: 'neck', a: 'neckA main:5', kind: 'zone', style: 'slam', air: true, dmg: 28 },
    },
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
