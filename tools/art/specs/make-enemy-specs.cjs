#!/usr/bin/env node
// tools/art/specs/make-enemy-specs.cjs - writes the specs of the three generated general enemies (revision 3: Crown
// Militiaman, Trapper, Hybrid Enforcer) for tools/art/import-sprite.cjs (spec.family 'enemies': the atlas joins
// ROM_ENEMIES as one more type). Sources: work/art/gen/<id>/<id>-NN-*.png (Codex sheets from tools/art/boss-prompts.json,
// 4 poses on magenta facing left, the first pose of every sheet the idle reference that fixes the scale).
//   node tools/art/specs/make-enemy-specs.cjs && node tools/art/import-sprite.cjs tools/art/specs/militia.json
// The anim list is the ENEMY_KINDS ['main', n] numbering (enemy-kinds.js); keep it stable. `atk` is each attack's record in
// the 0xA2EA4 shape the engine reads for damage (K.DMG(tbl, rankRow, level)), stun and reaction (react >= 4 knocks down).
'use strict';
const fs = require('fs'), path = require('path');
const lv = steps => { const a = []; for (let l = 0; l < 32; l++) { let v = steps[0][1]; for (const [from, hp] of steps) if (l >= from) v = hp; a.push(v); } return a; };
// the reaction anims every human kind needs (hurt, knockdown flight, corpse, get-up, held, knee, throw): main 5-12
const react = f => [
  { name: 'hurt', frames: [f.hurt], dur: 10 },
  { name: 'hurt-low', frames: [f.low], dur: 10 },
  { name: 'fly', frames: [f.fall, f.fall, f.down], dur: [12, 12, 40], align: 'none' },
  { name: 'dead', frames: [f.fall, f.down], dur: [10, 60], align: 'none' },
  { name: 'rise', frames: [f.down, f.getup], dur: [6, 20], align: 'none' },
  { name: 'held', frames: [f.hurt], dur: 30 },
  { name: 'kneed', frames: [f.low, f.low, f.low, f.low, f.low], dur: 8 },
  { name: 'thrown', frames: [f.hurt, f.low, f.fall, f.fall], dur: 8, align: 'none' },
];
const gen = id => n => `work/art/gen/${id}/${id}-${n}.png`;
const RANK = [32, 32, 32, 32, 35, 35, 35, 35, 38, 38, 38, 38, 44, 44, 44, 44, 48, 48, 48, 48, 52, 52, 52, 52, 56, 56, 56, 56, 60, 60, 60, 68];   // BLADE's rank row (r84 24)
const R5 = { hurt: 'hurt1', low: 'hurt2', fall: 'fall', down: 'down', getup: 'getup' };
const specs = {
  militia: {
    id: 'militia', name: 'CROWN MILITIAMAN', family: 'enemies', chapterTag: 111, height: 80, bg: '#FF00FF', anchor: 'feet',
    ship: 'sprite-data-enemy-militia.js',
    note: 'Generated general enemy (revision 3): Sable\'s uniformed militia, riot shield and baton. Stages 1, 5, 7, 8. About 80 arcade px (a ROM knife man is 82, Jack 79).',
    enemy: { data: { hud: 'MILITIAMAN', face: 'VICE T.', hp: lv([[0, 52], [9, 60], [12, 68], [16, 76], [24, 92]]), rankRow: RANK, walk: 1.05 } },
    inputs: [
      { file: gen('militia')('00-model'), split: 'auto', names: ['idle0'] },
      { file: gen('militia')('01-idle-walk'), split: 'auto', names: ['_ref1', 'idle1', 'walk1', 'walk2'] },
      { file: gen('militia')('02-walk-guard'), split: 'auto', names: ['_ref2', 'walk3', 'walk4', 'guard'] },
      { file: gen('militia')('03-attack'), split: 'auto', names: ['_ref3', 'tell', 'strike', 'bash'] },
      { file: gen('militia')('04-hurt'), split: 'auto', names: ['_ref4', 'hurt1', 'hurt2', 'fall'] },
      { file: gen('militia')('05-down'), split: 'auto', names: ['_ref5', 'down', 'getup', 'stagger'] },
    ],
    anims: [
      { name: 'idle', frames: ['idle0', 'idle1'], dur: 24, loop: 0 },
      { name: 'walk', frames: ['walk1', 'walk2', 'walk3', 'walk4'], dur: 8, loop: 0, alignTo: 'idle0' },
      { name: 'guard', frames: ['guard'], dur: 30, alignTo: 'idle0' },
      { name: 'strike', frames: ['tell', 'strike'], dur: [20, 18], act: [1], align: 'none', atk: { id: 900, tbl: 11, stun: 4, react: 2, hitstop: 6, src: 'sequel: militia baton swing' } },
      { name: 'bash', frames: ['guard', 'bash'], dur: [14, 20], act: [1], align: 'none', atk: { id: 901, tbl: 12, stun: 11, react: 4, hitstop: 9, src: 'sequel: militia shield bash (knocks down)' } },
      ...react(R5),
      { name: 'stagger', frames: ['stagger'], dur: 30, alignTo: 'idle0' },
    ],
    // teal uniform + shield highlights (the grey ramp otherwise tops out at #888)
    palette: { mode: 'ramps', lock: ['#337766', '#448877', '#aaaaaa', '#cccccc'] }, clean: { smooth: 1 },
  },
  trapper: {
    id: 'trapper', name: 'TRAPPER', family: 'enemies', chapterTag: 112, height: 76, bg: '#FF00FF', anchor: 'feet',
    ship: 'sprite-data-enemy-trapper.js',
    note: 'Generated general enemy (revision 3): Thorne\'s handler with an electric catch-pole; the lunge shocks (a short hold, then a knockback). Stages 2, 6. About 76 arcade px in his crouched stance.',
    enemy: { data: { hud: 'TRAPPER', face: 'SKINNER', hp: lv([[0, 48], [9, 56], [12, 64], [16, 72]]), rankRow: RANK, walk: 1.1 } },
    inputs: [
      // the model draws the catch-pole longer than every sheet does: the idle is the sheets' own reference pose
      { file: gen('trapper')('01-idle-walk'), split: 'auto', names: ['idle0', 'idle1', 'walk1', 'walk2'] },
      // the generator put the tell's spark on the butt of the pole: its blue-white pixels are erased
      { file: gen('trapper')('02-walk-tell'), split: 'auto', names: ['_ref2', 'walk3', 'walk4', 'tell'], colourErase: [[1480, 460, 56, 100]] },
      { file: gen('trapper')('03-lunge'), split: 'auto', names: ['_ref3', 'lunge', 'shock', 'recover'] },
      { file: gen('trapper')('04-hurt'), split: 'auto', names: ['_ref4', 'hurt1', 'hurt2', 'fall'] },
      { file: gen('trapper')('05-down'), split: 'auto', names: ['_ref5', 'down', 'getup', 'throw'], nudge: { down: [40, 0] }, erase: [[1078, 436, 70, 52]] },   // the pole under the lying body pulls the feet rule to the head; the bait meat (it joined the get-up pose) is erased
    ],
    anims: [
      { name: 'idle', frames: ['idle0', 'idle1'], dur: 24, loop: 0 },
      { name: 'walk', frames: ['walk1', 'walk2', 'walk3', 'walk4'], dur: 8, loop: 0, alignTo: 'idle0' },
      { name: 'lunge', frames: ['tell', 'lunge', 'shock', 'recover'], dur: [24, 8, 16, 22], act: [1], align: 'none', atk: { id: 902, tbl: 9, stun: 0, react: 0, hitstop: 12, src: 'sequel: catch-pole lunge (the shock hold, then a knockback: game.js trapperShock)' } },
      { name: 'throw', frames: ['throw'], dur: 24, align: 'none' },
      ...react(R5),
    ],
    palette: { mode: 'ramps' }, clean: { smooth: 1 },
  },
  hybrid: {
    id: 'hybrid', name: 'HYBRID ENFORCER', family: 'enemies', chapterTag: 113, height: 84, bg: '#FF00FF', anchor: 'feet',
    ship: 'sprite-data-enemy-hybrid.js',
    note: 'Generated general enemy (revision 3): a volunteer of Echo\'s treatment, scaled skin and hooked claws; a leaping slash. Stages 6, 7, 8. About 84 arcade px hunched (a BLUDGE graft is 78).',
    enemy: { data: { hud: 'HYBRID', face: 'BLUDGE', hp: lv([[0, 80], [9, 88], [12, 96], [13, 104], [16, 112]]), rankRow: RANK, walk: 1.25 } },
    inputs: [
      { file: gen('hybrid')('00-model'), split: 'auto', names: ['idle0'] },
      { file: gen('hybrid')('01-idle-walk'), split: 'auto', names: ['_ref1', 'idle1', 'walk1', 'walk2'] },
      { file: gen('hybrid')('02-walk-tell'), split: 'auto', names: ['_ref2', 'walk3', 'walk4', 'tell'] },
      { file: gen('hybrid')('03-attack'), split: 'auto', names: ['_ref3', 'leap', 'slash', 'slash2'] },
      { file: gen('hybrid')('04-hurt'), split: 'auto', names: ['_ref4', 'hurt1', 'hurt2', 'fall'] },
      { file: gen('hybrid')('05-down'), split: 'auto', names: ['_ref5', 'down', 'getup', 'roar'], flipNames: ['down'] },
    ],
    anims: [
      { name: 'idle', frames: ['idle0', 'idle1'], dur: 20, loop: 0 },
      { name: 'walk', frames: ['walk1', 'walk2', 'walk3', 'walk4'], dur: 7, loop: 0, alignTo: 'idle0' },
      { name: 'pounce', frames: ['tell', 'leap'], dur: [20, 28], act: [1], align: 'none', atk: { id: 903, tbl: 14, stun: 11, react: 4, hitstop: 9, src: 'sequel: hybrid leaping slash (knocks down)' } },
      { name: 'slash', frames: ['tell', 'slash', 'slash2'], dur: [12, 6, 16], act: [1], align: 'none', atk: { id: 904, tbl: 12, stun: 5, react: 2, hitstop: 9, src: 'sequel: hybrid claw slash' } },
      { name: 'roar', frames: ['roar'], dur: 40, alignTo: 'idle0' },
      ...react(R5),
    ],
    // scale greens (otherwise merged into the trousers' khaki ramp)
    palette: { mode: 'ramps', lock: ['#556633', '#778844', '#99aa55', '#bbcc77'] }, clean: { smooth: 1 },
  },
};
const only = process.argv.slice(2);
for (const [id, s] of Object.entries(specs)) { if (only.length && !only.includes(id)) continue; fs.writeFileSync(path.join(__dirname, `${id}.json`), JSON.stringify(s, null, 1) + '\n'); console.log(`wrote tools/art/specs/${id}.json`); }
