// INDEX.md / index.json writer for tools/re/export/bosses.cjs (episode -> boss, mid-bosses, dinosaurs; per-entity notes).
'use strict';
const fs = require('fs'), path = require('path');

const EPISODES = { 1: 'CITY IN THE JUNGLE', 2: 'THE SWAMP FOREST', 3: 'HELL ROAD', 4: "JACK'S GARAGE", 5: 'VILLAGE OF FLAME', 6: 'JUNGLE AND MINE', 7: "(title not in the map; Fessenden's lab)", 8: 'THE UNDER WORLD' };
// Video references: "all boss fights" video (YTDown...Inhoeri2BQc..._1080p.mp4, Japanese set, so HUD names differ),
// timestamps read from 8-second contact sheets work/re/extract/bosses/video/boss-overview-0N.png (+-8 s).
const VIDEO = {
  'vice-t': '0:24-1:36 (JP "VICE"): walks in holding R HOPPER on a chain; fight on the street, the raptor fights too',
  butcher: '1:44-3:20 (JP "ATOMIC"): bald machete fighter in the swamp; spins, rolls, leaps',
  hogg: '3:28-4:08 (JP "GASPAR"): motorcycle boss of the Cadillac stage; knocked off the bike to finish',
  slice: '4:16-5:20 (JP "SLICE"): knife fighter in the factory; somersaults away, long blade lashes',
  morgan: '5:28-6:30 (JP "MORGAN"): small hunched man in the burning village',
  morgue: '6:30-7:36 (JP "MORGUE"): silver lizard-man after MORGAN mutates; charges on all fours',
  tyrog: '7:44-11:00 (JP "TYROG"): several Tyrogs (green, orange, blue) in the jungle',
  slisaur: '11:04-12:32 (JP "SLISAUR"): Slice re-created as a lizard man (Fessenden on the monitors); two of them',
  'fessenden-1': '12:40-14:00 (JP "FESSENDEN"): after the dialogue, a pale lizard-man form that leaps and claws',
  fessenden: '14:00-15:20 (JP "FESSENDEN"): giant pink dinosaur form, final boss',
};
// Interpretation of the live pattern data (OBSERVED in the passive / stage runs unless marked INFERRED).
const NOTES = {
  'vice-t': [
    'Intro (stage walk and spawn runs): idle ~230 f, "flex then punch" 93 f, walks to his mark (~190 f), "shadow-boxing" 240 f; only then does +0x04 become 2 and he fights.',
    'Fight: walks up and throws punches (attack id 0x12, table damage 7, 9 seen on a 1P rank-10 hero), lunging punch (id 0x13, table 15, 20 seen), leaps (jump / high jump) and jump kicks.',
    'R HOPPER (Dinonics, type 0x74) is spawned with him and the chain (pool D type 0x50, set 0x945CC) is drawn between them.',
    'INFERRED: the pistol anims (13-16) belong to him but were never played in any run (2 stage walks, 2 spawn runs); they may need range or low HP.',
    'Reaction sets: +0x84 = 0x30 -> hit set 0x2FBE2 and grab set 0x30FB0 (his own records 1208-1221, 3207/3208).',
  ],
  walther: ['Vice T. palette-swap with the regular HP table (name 0x0D: 100-300 by rank, 200-220 seen). Kicks (id 0x35, 11 seen), jumps, punches (id 0x12), lunging punch (id 0x13, 21 seen).', 'Met in E3, E4 (area 1), E5 (area 1), E6 area 0 and E8 area 2 (two at once).'],
  butcher: ['Idles and walks between attacks; machete flurry (3 spinning slashes, id 0x33, 11-19 seen), overhead slash + thrust (id 0x2D, 18), rolling body press as a curled ball (id 0x2E, 16-18), dash shoulder punch (id 0x2F, 28), high jump over the hero, chuckle/kneel taunts.'],
  hogg: ['Fought only on the motorcycle: rider (type 0x7C, set 0x50DFA) and bike (type 0x80, set 0x51076) are separate objects. Rides forward, leans into charges, clothesline reach and side swipe (id 0x6A, table 10, 7-16 seen), raises a fist to taunt. Finish: "knocked off the bike".', '+0x84 = 0x98 is past the end of both reaction tables, so he has no grab/hit reaction sets (he cannot be grabbed).', 'Boss HP index 2 has no rank scaling: 300 / 400 / 500 for 1 / 2 / 3 players.'],
  slice: ['Stage walk: intro idle ~170 f then the blade wind-up pose (39 f); fight = approach walk, lunging low blade sweep (state +0x07 = 0x0E), flip jump away when crowded (+0x06 = 2), jab. Blades are part of his sprites (no projectile objects were spawned).', 'Spawned outside his arena he stays in the idle intro (waits for the area script).'],
  morgan: ['Throws things: knives, rocks and stones (type 0x110, spawned at 0x52528) and a grenade (type 0x68 sub 0, 0x52012); see `boss-projectiles`.', 'Creeps forward, hop attack (id 0x08/0x3F, 10-12 seen), lunging grab dash (id 0x3F, 18-24), jabs, point jab (20), head-butt (24). Weak (HP index 4: 256-384 at 1P).', 'When his HP runs out he cowers and flashes (anim 8) and MORGUE (type 0xA0) takes over, starting with the 44-frame transformation (MORGUE anim 11). Type 0x8C ("Pakike (DEMO)") is the scripted cut-scene MORGAN with the same set.'],
  morgue: ['Claw swipe (ids 0x4B/0x6C, 22-25 seen), pounce (id 0x42, 30), charge on all fours, low claw combo, crouch/stand feints. HP index 5 (512-640 at 1P).', 'The same set 0x6EA48 also holds FESSENDEN in his lab coat and the pale beast morph frames (used by type 0x178).', 'Palette animation: his handler rewrites OBJ slot 29 from ROM rows at run time (0x540C0-0x540F8, row offset in RAM 0xFF0FA4); the one colour mismatch of the check (stage walk frame 7866, slot 29) is this effect.'],
  tyrog: ['Several Tyrogs: type 0x10 (name 0x19, boss HP index 6, then halved by the init at 0x36AD0: 288/320 seen) and type 0x120 (name 0x1B, boss HP index 0: 550 seen). Colours by palette override: slots 29/30/31 (+0x23 = 0x9D/0x9E/0x9F).', 'Spits fireballs that explode and green acid blobs that splash (type 0x68 subs 3/4, spawned at 0x37574/0x375D2; see `boss-projectiles`).', 'Moves: long airborne leaps across the screen (id 0x4D), short crawl steps, rising claw (id 0x4F, 28 seen), rising/standing slashes (21), slash-and-drop (35), rear up.', 'Type 0x120 enters with the KING K.K. DEMO2 cut-scene: a poacher (type 0x12C, set 0x71A4E) mutates (type 0x130, set 0x71D66, and TYROG anims 34/35) into a Tyrog.'],
  'tyrog-2': ['Same set and moves as TYROG; regular HP table row 0x23 (300 at every rank). Met as a mid-boss in E8 area 0 (stage walk, camera X 1152).'],
  slisaur: ['Two SLISAURs together (550 HP each at rank 24, boss HP index 0). Same animation layout as SLICE with faster timings; green lizard version of Slice.'],
  'fessenden-1': ['Appears as human Fessenden in a lab coat (MORGUE-set anim 20, 286 f of pointing/talking), morphs (anims 24/29) and fights with the MORGUE moveset in a pale palette: claw swipe (id 0x40, 33-35 seen), low claw combo (id 0x31, 39), pounce (id 0x42, 41), charge (id 0x41, 39). Rocks, slime and fireball objects (types 0x170, 0x174, 0x17C) fly around in this phase. Boss HP index 8.', 'Palette animation like MORGUE: 0x67FB6-0x67FEE rewrites OBJ slot 29 (row offset in RAM 0xFF0FBA).'],
  fessenden: ['Built from six objects sharing one HP pool (boss HP index 9: 600-700 at 1P): body 0x150 (walks, bites, lies flat), long arm 0x158 (reach and grab), second arm 0x15C, two snake-headed necks 0x160/0x164 that lunge and bite, and 0x154 drawing a line that extends from the body (set 0x712A0).', 'In the passive run the body mostly idles/walks while the arms deal the hits (22-41 damage seen).'],
  dinonics: ['Raptor: idle/sniff until the hero is near, then runs, pounces and bites. HP from the regular table (name 0x04 R HOPPER: 44-150 by rank).'],
  arosaurus: ['Allosaurus "SHIVAT": sleeps (anims 0/1) until woken, walks at 8 speeds (anims 2-9), roars, bites, tail swipes. HP regular table name 0x07 (60-200 by rank).'],
  torikeratopss: ['Triceratops "MACK" (HP 128 at every rank): charges (id 0x59, 22 seen); subtype 0x200 enters with a jump, 0x400 sleeps until woken.'],
  pteranodon: ['Flies across in flap cycles and swoops (fly with turn: id 0x3B, 27-31 seen). HP 20.'],
  'giant-foot': ['A giant foot drops from above (rise 217 px) with its shadow and stomps; HP 100. E6 area 1.'],
};

function writeIndex(results, runs, { OUT, nameOf, hex, ENTITIES }) {
  const byId = Object.fromEntries(results.map(r => [r.id, r]));
  // episode census from the stage walks: entity objects and every other named pool-B object, by episode and area
  const census = {};
  const FI = { pool: 0, type: 2, b03: 4, hp: 13 };
  for (const [rid, run] of Object.entries(runs)) {
    if (run.meta.kind !== 'stage') continue;
    for (const fr of run.log) {
      const ep = fr.g[2] + 1, area = fr.g[3];
      if (fr.g[4] !== 0x0C) continue;   // gameplay only
      const C = census[ep] || (census[ep] = { entities: new Map(), named: new Map(), runs: new Set(), areas: new Set() });
      C.runs.add(rid); C.areas.add(area);
      for (const o of fr.o) {
        if (o[0] !== 'B') continue;
        const ent = ENTITIES.find(E => [E.objs[0]].some(s => (s.pool || 'B') === 'B' && s.type === o[FI.type] && (s.b03 === undefined || s.b03 === o[FI.b03])));   // main object only
        if (ent) { const k = ent.id; const e = C.entities.get(k) || { areas: new Set(), first: `${rid}@${fr.n}` }; e.areas.add(area); C.entities.set(k, e); }
        else if (o[FI.hp] > 0) { const nm = nameOf(o[FI.b03]); if (nm) { const e = C.named.get(nm) || { areas: new Set(), types: new Set() }; e.areas.add(area); e.types.add(hex(o[FI.type])); C.named.set(nm, e); } }
      }
    }
  }
  const L = [];
  const p = s => L.push(s);
  p('# Bosses and dinosaurs of the original Cadillacs & Dinosaurs (1993)');
  p('');
  p('Generated by `node tools/re/export/bosses.cjs` from the user\'s ROM set (through `tools/re/rom.cjs`) and the MAME logs of `node tools/re/export/bosses-live.cjs`. Static evidence: `sh tools/re/export/bosses-rea.sh` (REA/Rizin records in `evidence/`). Nothing here ships with the game.');
  p('');
  p('Status words: **OBSERVED** = seen in the ROM, the disassembly or a live MAME run; **INFERRED** = a reading of observed data that was not checked directly.');
  p('');
  p('## Files');
  p('');
  p('| File | Contents |');
  p('|---|---|');
  p('| `<id>.json` | catalogue entry, objects (type, handler, code range, static scan), name index, HP (tables + live), damage (attack ids + table), palette (episode/area rows, overrides, variants), reaction sets, animations (labelled, with live usage), fight pattern (passive runs), timeline (stage walk), validation |');
  p('| `<id>-atlas.png` / `.json` | every record the entity\'s animations use; RGBA, ROM palettes at full brightness, transparent; art in native LEFT-facing orientation; frames `{rec, x, y, w, h, ox, oy, pal}` with `(ox, oy)` the feet origin inside the box |');
  p('| `<id>-t<type>-e<ep>a<area>[-pal<slot>]-atlas.*` | the same records in another live colour context (e.g. the three Tyrog colours, the pteranodon in other episodes) |');
  p('| `<id>-sheet.png` | contact sheet: one row per animation (set, index, label, live summary), frames left to right, magenta cross = feet origin |');
  p('| `live/*.json` | compact per-frame object logs of the MAME runs (fields listed in `meta.fields`) |');
  p('| `video/boss-overview-0N.png` | 8-second contact sheets of the boss-fight video |');
  p('| `evidence/` | REA records (`evidence.jsonl` lists the ids) |');
  p('');
  p('Frames keep every block of the record, including the dark pen-0 shadow blocks some records carry (the separate shadow sprites of 0x14EC0 are not part of the records). Attack ids in the JSON are decimal (`attackIds`); the INDEX quotes them in hex. On the attack frames checked, byte 6 of the frame is non-zero (e.g. Vice T. lunging punch frame 1: b6 = 4); INFERRED: bytes 4-6 carry the hit box / active-frame data (U10).');
  p('');
  p('Animation format: `{name, set, index, kind, frames:[{rec, rec2|null, dx2?, dy2?, dur, b4?, b5?, b6?, w8?, composite?, parts?, last?, addr}], loopTo}`. `dur` is in 60 Hz frames (V13 byte 7 & 0x7F). `rec2` is drawn at the same origin (V04); for composite frames (bit 15 of word 0) `rec`/`rec2` are the first two parts and `parts` lists all of them as `{rec, dx, dy}` in screen pixels (y down) for the left-facing art; the first part is in front. `loopTo` is the frame index the anim loops to, or `{continuesInto:{set,index,frame}}` when the loop word jumps into another anim. `kind`: `main` (obj+0x40 sets), `reaction-hit` (0x2E68C[+0x84]), `reaction-grab` (0x2E724[+0x84]). Bytes 4-6 and word 8 are copied raw (meaning untraced, U10).');
  p('');
  p('## Episode -> boss, mid-bosses, dinosaurs');
  p('');
  p('From the stage walks (MAME, `stage<N>-jack` states, invulnerable hero bot; grunts cleared with the game\'s own ENEMY CLEAR writes). OBSERVED.');
  p('');
  p('| Ep | Title | Boss (area) | Mid-bosses / heavy enemies | Dinosaurs | Other named enemies (HUD names) | Areas walked |');
  p('|---|---|---|---|---|---|---|');
  for (let ep = 1; ep <= 8; ep++) {
    const C = census[ep];
    const ents = C ? [...C.entities.entries()] : [];
    const fmt = ([id, e]) => `${byId[id] ? byId[id].name : id} (\`${id}\`, a${[...e.areas].sort().join('/')})`;
    const boss = ents.filter(([id]) => byId[id] && byId[id].group === 'boss' && byId[id].episode === ep).map(fmt).join('; ') || '-';
    const mids = ents.filter(([id]) => byId[id] && (byId[id].group === 'mid-boss' || (byId[id].group === 'boss' && byId[id].episode !== ep) || byId[id].group === 'regular')).map(fmt).join('; ') || '-';
    const dinos = ents.filter(([id]) => byId[id] && byId[id].group === 'dinosaur').map(fmt).join('; ') || '-';
    const named = C ? [...C.named.entries()].filter(([n]) => !results.some(r => r.name === n)).map(([n, e]) => `${n} (a${[...e.areas].sort().join('/')})`).join(', ') : '-';
    p(`| ${ep} | ${EPISODES[ep]} | ${boss} | ${mids} | ${dinos} | ${named} | ${C ? [...C.areas].sort().join(', ') : '-'} |`);
  }
  p('');
  p('Coverage of the walks: E1, E2, E5, E7 and E8 from area 0 to the end (E5/E6/E8 continued from save states `bz-stage<N>-19990`); E3 is a single area; E4 area 1 stalled before its exit (area 2 reached with an area warp); E6 walked as area 0 (`stage6a0`) and areas 1-2 (`stage6`, `stage6b`). Episode 7 has no title-card text in the map (V34 lists the others).');
  p('');
  p('## Entities');
  p('');
  p('| id | HUD name (+0x03) | group | episode | objects (type: handler) | sets | anims (labelled) | records | HP (OBSERVED) | OBJ check | colour check |');
  p('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const lab = r.animations.filter(a => !/unlabelled/.test(a.name)).length;
    const hp = r.hp.boss ? r.hp.boss.map(b => `boss #${b.index} (1P ${b.byPlayers[0][0]}-${b.byPlayers[0][7]})`).join(', ') : r.hp.regular ? r.hp.regular.filter(x => x.name && r.name.includes(x.name)).map(x => `${x.name} ${Math.min(...x.byRank)}-${Math.max(...x.byRank)}`).join(', ') : '-';
    const v = r.validation;
    p(`| \`${r.id}\` | ${r.name} | ${r.group} | ${r.episode || '-'} | ${r.objects.map(o => `${o.type}: ${o.handler}`).join(', ')} | ${r.sets.length} | ${r.animations.length} (${lab}) | ${r.records} | ${hp}; live ${r.hp.liveInitial.slice(0, 3).join(', ') || '-'} | ${v.obj.framesExact}/${v.obj.framesChecked} frames | ${v.colours.exact}/${v.colours.slotChecks} |`);
  }
  p('');
  p('## How the numbers were checked');
  p('');
  p('- **Animations / records / draw:** for every logged frame where the entity is drawn, its OBJ entries were predicted from its RAM (frame pointer, position, facing, palette override, split-body fields) with the independent draw model `tools/re/verify-live/drawmodel.cjs` and looked up in the OBJ list MAME dumped one frame later (H04/V05 timing). Exact = every predicted entry present with the same x, y, code and attr. The few misses are frames where the object was spawned/freed between the RAM read and the list build, plus the unmodelled grab-pair / bit-6 paths (U01) that are counted as skipped.');
  p('- **Colours:** the OBJ palette slot of every predicted entry was compared with the live palette RAM (`dump.palette`) word by word (brightness nibble ignored, gameplay is at F); the expected words come from the ROM row that the (episode, area) table 0x8E8E assigns to that slot. All slots matched in the stage walks; spawn runs repaint the palettes of the target\'s home area themselves.');
  p('- **HP:** the initial `+0x6C` of every boss seen live equals the table value for the live rank (0xFF85EE) and player count (0xFF84EF): Vice T. 450 (rank 10/11) and 550 (24), Butcher 576/640, Hogg 300, Slice 500/550, Morgan 320/384, Morgue 576/640, Slisaur 550, Fessenden 550 (first form) and 700, Tyrog 0x120 550, Tyrog 0x10 = half of its table value (288/320, the init halves it at 0x36AD0), Tyrog 2 300, Walther 200/220, R HOPPER 100-130, SHIVAT 100/150, MACK 128, ZEKE 20.');
  p('- **Damage:** "seen" damage is the hero\'s HP drop on the frame the attack connected (hero HP refilled every frame in the spawn runs; 1 player, rank 10-24). The table value is byte 0 of the 8-byte record at 0xA2EA4 + id*8; the game then scales it by the attacker\'s rank row (0x2C3AE + (+0x84)*8) and victim factors (0x6422).');
  p('');
  p('## Static formulas (OBSERVED in the disassembly, evidence in `evidence/`)');
  p('');
  p('- **Name index:** each handler writes `move.b #n,($3,A6)`; the HUD shows `0x17D78[n]` (R9). The table has 39 entries: 0x24 WRENCH T., 0x25 FESSENDEN, 0x26 HOGG were missing from R9 (b01).');
  p('- **Boss HP** (0x31E14, b02): `HP = word[0x31E52 + idx*48 + (players-1)*16 + ((rank & 0x1C) >> 1)]`, `+0x6A = min(HP, 100)` (one bar = 100 HP, the bar changes colour per 100), `+0x6C = +0x6E = HP`. idx: 0 Vice T./Slice/Slisaur/Tyrog 0x120, 1 Butcher, 2 Hogg, 4 Morgan, 5 Morgue, 6 Tyrog 0x10 (halved), 8 Fessenden form 1, 9 Fessenden final (b07-b17). Indices 3 and 7 are not used by any handler.');
  p('- **Regular HP** (0x31424, b03): `HP = word[0x31454 + b03*64 + rank*2]`, same min(.,100) bar rule. Used by Walther, Tyrog 2 and the dinosaurs.');
  p('- **Palettes** (0x8E4C, b04): on area load the game copies 32 ROM rows `0xB7A52 + row*32` into the OBJ palette page 0x914000; the row list is `[0x8E8E + (episode-1)*16 + area*4]`. A record block uses its own palette slot unless `obj+0x23` bit 7 is set (V04).');
  p('- **Enemy attack damage** (0x116B2, b05): record `0xA2EA4 + (attacker +0x58)*8` = {damage, stun, reaction -> hero +0x7B/+0x06, ...}; modifier 0x6422.');
  p('- **Reactions** (0x2B49A / 0x2B416, b06): hit set `[0x2E68C + +0x84]`, grab set `[0x2E724 + +0x84]`, started through 0x1236 (V18). Hit-set anim roles by index (OBSERVED on Vice T., Slice, Butcher): 0/1/6 stagger, 2/3/7/10 knockdowns, 4 get up, 5 dizzy, 8 thrown landing, 9 bounce. Grab set: 0 held, 1 kneed, 2-5 thrown.');
  p('- **Controllers:** FESS MESS (pool C 0xC8, b19) is Fessenden\'s dialogue picker (subtype x 8 + the front player\'s character), not a sprite. KING K.K. DEMO2 (pool C 0x13C, b20) spawns pool-B type 0x12C four times (subtypes 0, 1, 4, 4) for the Tyrog transformation. SISOCYOU 1 (pool C 0x120, b21) spawns types 0xB8/0xC8 (archaeopteryx flocks).');
  p('');
  p('## Bosses and dinosaurs');
  p('');
  for (const r of results) {
    if (!['boss', 'mid-boss', 'dinosaur', 'boss-part'].includes(r.group)) continue;
    p(`### ${r.name} (\`${r.id}\`)`);
    p('');
    p(`- Role: ${r.role}${r.debugName ? ` Debug-list name: "${r.debugName}".` : ''}`);
    p(`- Objects: ${r.objects.map(o => `${o.pool} ${o.type} (handler ${o.handler}${o.static.nameIndex.length ? ', name ' + o.static.nameIndex.map(n => n.b03 + ' ' + n.name).join('/') : ''}${o.static.r84.length ? ', +0x84 ' + o.static.r84.join('/') : ''}${o.static.bossHpIndex.length ? ', boss HP #' + o.static.bossHpIndex.join('/') : o.static.regularHp ? ', regular HP' : ''})`).join('; ')}.`);
    p(`- Sets: ${r.sets.map(s => `${s.set} (${s.anims})`).join(', ')}; ${r.animations.length} anims, ${r.records} records. Palette: E${r.palette.home.episode} area ${r.palette.home.area} rows${r.palette.overrideByType.some(t => t.slot != null) ? ', override ' + r.palette.overrideByType.filter(t => t.slot != null).map(t => t.type + '->slot ' + t.slot).join(', ') : ''}${r.palette.variants.length ? '; variants ' + r.palette.variants.map(v => v.tag).join(', ') : ''}.`);
    const notes = NOTES[r.id] || [];
    for (const n of notes) p(`- ${n}`);
    if (VIDEO[r.id]) p(`- Video: ${VIDEO[r.id]}.`);
    const pat = (r.pattern || []).filter(q => q.frequency.length);
    for (const q of pat.slice(0, 3)) p(`- Passive run \`${q.mameRun}\` type ${q.type}: ${q.frequency.slice(0, 8).map(f => `${f.anim} x${f.uses}${f.heroDamage.length ? ' (hit ' + f.heroDamage.join('/') + ')' : ''}`).join('; ')}.`);
    p('');
  }
  p('## Gaps');
  p('');
  p('- Labels ending in "?" come from the art only; reaction-set labels are by index and were checked on a few characters only.');
  p('- Frame bytes 4-6 and word 8 (probably hit boxes, U10) are exported raw; attack timing is given by the frames during which `+0x58` holds an attack id and by the observed hit frames, not by decoded hit boxes.');
  p('- Vice T.\'s pistol anims, several Fessenden body anims and most dinosaur sub-anims were not triggered live.');
  p('- `pteranodon-bg`, `small-raptor` and `yellow-dino` were never met in the walks (their handlers exist; where the game uses them is unknown).');
  p('- The full enemy damage formula is victim-dependent (random band, character and HP factors); only the table byte and the observed 1P numbers are given.');
  fs.writeFileSync(path.join(OUT, 'INDEX.md'), L.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ generatedBy: 'tools/re/export/bosses.cjs', entities: results.map(r => ({ id: r.id, name: r.name, group: r.group, episode: r.episode, objects: r.objects.map(o => o.type), atlas: r.atlas.file, sheet: r.sheet && r.sheet.file, anims: r.animations.length, records: r.records, validation: { obj: [r.validation.obj.framesExact, r.validation.obj.framesChecked], colours: [r.validation.colours.exact, r.validation.colours.slotChecks] } })), census: Object.fromEntries(Object.entries(census).map(([ep, C]) => [ep, { runs: [...C.runs], areas: [...C.areas], entities: Object.fromEntries([...C.entities].map(([k, e]) => [k, { areas: [...e.areas], first: e.first }])), named: Object.fromEntries([...C.named].map(([k, e]) => [k, { areas: [...e.areas], types: [...e.types] }])) }])) }, null, 1));
}
module.exports = { writeIndex };
