// Story text export: the curated reading per section and episode (SCRIPT.md notes, EPISODES.md, CAST.md).
// OBSERVED = seen in a live run, the ROM or the disassembly (the evidence is named); INFERRED = a reading of observed
// data that was not checked directly. Research tooling only.
'use strict';
const T = require('./story-rom.cjs');
const D = require('./story-data.cjs');
const N = require('./story-notes.cjs');
const hex = T.hex, p = T.p, u16 = T.u16;
const md = s => String(s).replace(/\|/g, '\\|');

// ---------------------------------------------------------------- HUD names (OBSERVED: table 0x17D78, R9 + bosses b01)
function hudNames() {
  const out = [];
  for (let i = 0; i < 0x27; i++) {
    const a = 0x17D78 + u16(0x17D78 + i * 2); let s = '';
    for (let k = 1; k < 12 && p[a + k] !== 0x40; k++) s += String.fromCharCode(p[a + k]);
    out.push({ index: hex(i, 2), name: s.trim() });
  }
  return out;
}

const SECTION_INTRO = {
  attract: 'Without a coin the game loops: version screen and WARNING (f70, f191), title with "INSERT COIN" (f320), copyright page, the four character profiles, title again, a demo stage, then one of two story intros. Intro A (0x988C0, picture panels) follows the odd demos and intro B (0x9BF50, a jungle cut-scene with captions) the even ones. Demo stages seen: EPISODE 1 (Jack), EPISODE 3 HELL ROAD (Hannah), EPISODE 8 area 1 (Jack), EPISODE 5 (Jack). Sequencer: byte 0xFF8FD0 stepping through 0x97C40 (REA `t20-attract`).',
  start: 'Coin at f330, start at f370, select (main state 4) from f393, play (state 0xC) from f640. EPISODE 1 opens without an intermission or title card: a pteranodon flies over the coast and the poachers line up in front of the hero.',
  ep1: 'Areas: 0 roof top, 1 inside the building, 2 47th Street. Boss: VICE T. with the raptor R HOPPER (the "ROCK HOPPER") on a chain.',
  continue: 'When no player is left (0xFF84CD = 0, 0x6CA2) the game enters main state 0x10: a full-screen gunman counts down from 20 and taunts every 5 counts (0xF13E: index = counter / 5 into the English table 0xF27C). At 0 he fires, "GAME OVER" is drawn (graphics, not text), then main state 0x14/0x18 (high-score table "BRAVES") and the attract loop. Seen in story-continue2 (lives 0, timer poked to 0:02).',
  ending: 'Reached when stage byte 7 clears (0xABB8 -> main state 0x1C, 0xA69B8). The ending is CADDI. DEMO 2 (pool C 0x148): the lab escape, the cut-in "JACK! HANNAH!", Mustapha and Mess walking out of the desert while the staff roll scrolls, the Cadillac arriving with Jack and Hannah, the closing lines, "THANK YOU FOR PLAYING" / "PRODUCED BY" CAPCOM, then the high-score table. The ending cast is fixed: it does not depend on who played. Captured by poking main state 0x1C from the stage8-jack state (story-ending).',
};
const SECTION_NOTES = {
  attract: [
    'Not in the World attract: "WILL MAN EVER LEARN NOT TO MESS WITH NATURE..." (0x9CB40) is in intro B\'s code (step 0x9C1F4) but that step is not in its schedule 0x9C002-0x9C048, and the other copies (0x99BDC, intro variant 0x98FCC; Japanese intro 0x9B342) have no caller. The 10-character pieces of "SCIENCE HAD PROGRESSED..." at 0x7E3FC are for the scroller object (pool C 0x60) that only those uncalled variants spawn.',
    'Graphic (not text) logos and labels: the CADILLACS AND DINOSAURS logo, CAPCOM, the profile pages\' "HEIGHT/WEIGHT" labels are ASCII (0x9AC02); the high-score table "BRAVES" is drawn from sprites.',
  ],
  start: [
    'Select screen strings (ASCII, OBSERVED live reads at 0xB3DA/0xB374): names "JACK.T", "HANNAH.D", "MUSTAPHA.C", "MESS.O" (0xB39E, select order) and "POWER", "SPEED", "SKILL" (0xB3E4). The HUD uses JACK.T, MUSTAPHA, HANNAH.D, MESS.O (0x16425) and the boss-bar table JACK.T, MUSTAPHA, HANNAH, MESS (0x17D70).',
    '"EASTCOAST 2513" and the three opening lines are entries of the EPISODE 1 area 0 spawn list (0xACD9E, walker 0xFC7A, REA t23): caption 0x9 at camera X 64, captions 0x49, 0x54 and 0x4A together at camera X 672 (one speech in three caption objects, shown one after the other), then "TOP OF THE BUILDING" (0xE) at 912. Every location caption and scripted caption line of the stages is spawned this way; see EPISODES.md and story.json captionSpawns.',
  ],
  ep3: ['HELL ROAD is driven in the Cadillac. The car hint "TAKE THE CAR, IT WOULD BE SAFER.GO FOR IT!" (caption 0x68, pool C 0x160 spawned by 0x8BD24 when 0xFF85F6 >= 3) was printed in the attract demo of this episode (story-attract f10423, twice) but not in the walk, which starts from a save state. Boss HOGG (with his bike) has no dialogue.'],
  ep4: ['The opening lines of this episode (captions 0x38-0x3A) are spawned by pool B type 0xAC (0x55F2A) as Slice\'s gang barricades the garage; they were printed in story-inter4 after the title card.'],
  ep5: ['Three caption groups print an empty English entry here (captions 0x34, 0x3D, 0x41 -> blocks 0x880CE, 0x880C8, 0x880D4 are a header and an end mark only). Their Japanese entries (0x87F22-0x8813E region) have text: these lines were dropped from the English version. 0x3D (area 0, camera X 1712) and 0x34 (area 1, camera X 3072) are entries of the stage spawn lists like the location captions (REA t23); the spawner of 0x41 (read in area 1, story-ep5-jack f4603) was not traced: it is in no spawn list and no code loads the constant. EPISODE 8 area 3 has one more such Japanese-only entry, caption 0x7 at camera X 4264 (0xADB9E), read blank before the boss room (story-ep8-jack f10513).'],
  ep6: ['Boss room order: the first TYROG (pool B type 0x10, HUD 0x19) dies, then KING K.K. DEMO2 (pool C 0x13C, 0x8A3D0) plays the poacher\'s lines (captions 0x50-0x53) and the mutation (pool B 0x12C x4, 0x130), and the second TYROG (type 0x120, HUD 0x1B, boss HP 550) is fought. The grab line "SOMEONE HELP MMMMPHH...GURGLE!" (caption 0x5A, 0x882F0) is spawned only by the second Tyrog\'s grab-hold state (0x5E2F8-0x5E32A, REA t26): it leaps at a hero (0x5E24A, attack 0x34) and, when the leap connects (0x5E044), holds him while the held hero\'s line prints. The invulnerable bot cannot be grabbed; story-ep6-grab-mustapha (HP refill, bot standing next to the type-0x120 Tyrog from f8991 instead of fighting it) got the line at f9087.'],
  ep7: ['Areas: 0 CITY IN THE SEA, 1 (vertical shaft, no caption), 2 LIBRARY, 3 COMPUTER ROOM. Dr. Fessenden speaks from a monitor (pool C 0x88, 0x81B3E, table 0x81BCA: line 0..3 by the front hero, all the same text), then releases SLISAUR (two of them in the boss room), the "OLD FRIEND" he gave a new life (INFERRED: SLICE, the E4 boss; same name stem; the boss export reads Slisaur the same way).'],
  ep8: ['After the final form dies the game runs the end-of-stage player script 0x18 (table 0x1D9B0, EPISODE 8 area 3; 6-byte steps at 0x1EDCE, interpreter 0x1DB82, REA t24): it waits for dropped items to clear (op 0x38), for every player to be idle and hittable (ops 0x4A/0x04 at 0x1DC60/0x1E200: +0x51 == 0, +0x00 == 1, HP > 0), releases stage-clear step 4 (op 0x06 sets 0xFF84E3), walks the heroes (op 0x02), spawns the four JUMP PL. runners (op 0x42, 0x1E672: pool B type 0x184, one per hero, the heroes nobody plays as stand-ins at X 0x10E0), waits 540 frames and clears 0xFF84E2 (op 0x44) so that step 6 ends (0xABA8 -> main state 0x1C, the ending). Each runner sets its bit in 0xFF0F57 (A5-0x70A9) once it has run to X 0x1180; when all four bits are set and the dead boss has raised its +0xA6 flag (0x63766), the runner spawns type 0x174 and FESS MESS subtype 7 (0x84490 from 0x69F90): Jack\'s portrait with "HIS LAB IS GONN EXPLODE! RUN!!!" (line 0x43), then the exit flag 0xFF87A9 and the run to the right. The first E8 runs never got there: the invulnerability cheat keeps +0x00 at 2 (op 0x4A waits for ever) and the bot cleared pool B after the boss died. story-ep8-esc2-jack switches both off once the boss is dead and shows the line (f14474, snapshot txt-f014482.png: Jack\'s portrait, Jack and the Mustapha stand-in in the boss room) followed by the game\'s own transition into the ending (f14896). Without the script the stage-clear steps time out on their own (0x708 and 0xE10 passes at 0xAB66/0xABA8) and the ending starts without the escape scene (story-ep8-esc-jack f18245).'],
};

function whereOf(sec, it) {
  const st = it.state || {};
  const via = it.via;
  if (sec.id === 'attract' && (it.addr === 0x87BD6 || it.addr === 0x87BF8)) return 'attract intro B (cut-scene): caption line (pool C 0x108 subtype ' + hex(via.index) + ', spawned by the pool B 0x2C actor at 0x3D9F8)';
  if (sec.id === 'attract' && via && via.table === 'captions') return `attract demo play (EPISODE ${st.st + 1}): caption (pool C 0x108 subtype ${hex(via.index)})`;
  if (via && /titleCards/.test(via.table)) return 'title card (typewriter, pool C 0x68)';
  if (via && via.table === 'continueTaunts') return 'continue screen, speech balloon of the gunman';
  if (via && via.table === 'fessLines') return `EPISODE ${st.st + 1} area ${st.ar}: monitor (pool C 0x88)`;
  if (via && via.table === 'dialogue') {
    if (st.m === 8) return 'intermission screen, portrait line';
    if (st.m === 0x1C) return 'ending, portrait line over the desert road';
    return `EPISODE ${st.st + 1} area ${st.ar}: portrait line (0x84736)`;
  }
  if (via && via.table === 'captions') {
    const loc = /^(MUD SWAMP|TOP OF THE BUILDING|IN THE BUILDING|47TH STREET|DESERT OF DEATH|IN THE GARAGE|FACTORY|GREEN PATH|VILLAGE|COAL MANE|JUNGLE|CITY IN THE SEA|LIBRARY|COMPUTER ROOM|BIO LAB|UNDERGROUND|CAVE|EASTCOAST 2513)$/.test((it.lines[0] || {}).text || '');
    const where = st.m === 0 ? 'attract demo/cut-scene' : st.m === 0x1C ? 'ending' : `EPISODE ${st.st + 1} area ${st.ar}`;
    return `${where}: ${loc ? 'location caption' : 'caption line'} (pool C 0x108 subtype ${hex(via.index)})`;
  }
  const a = it.addr;
  if (a >= 0xE42A && a < 0xE90E) return 'intermission screen (main state 8), text under the picture';
  if (a >= 0x98CC6 && a < 0x98FCC) return 'attract intro A (picture panels)';
  if (a >= 0x9CB40 && a < 0x9CFC6) return 'attract intro B (cut-scene)';
  if (a >= 0x9B0F8 && a < 0x9B342) return 'attract character profile page';
  if (a >= 0x97F40 && a < 0x98100) return 'title / copyright page';
  if (a >= 0x9DE00 && a < 0x9E3A0) return 'power-on version / WARNING screen';
  if (a === 0x988A4 || a === 0x988B2 || a === 0x9D990) return 'title screen credit line';
  if (a >= 0x8A956 && a < 0x8AA0A) return 'ending, last screen (16x16 font)';
  if (a === 0x9AC02) return 'profile page labels';
  return '';
}

const UNSEEN_NOTES = {
  0x7D1C: 'select-screen name plate fragment (16x16 font), part of the select screen layout data', 0x7D48: 'select-screen name plate fragment',
  0xF286: 'continue taunt (seen in story-continue2 once the build includes it)',
  0x7D304: 'second copy of the title cards (0x7D122 code path); the live runs read the 0xC6D2 copy', 0x7D342: 'second title-card copy', 0x7D372: 'second title-card copy', 0x7D3AA: 'second title-card copy', 0x7D3E8: 'second title-card copy', 0x7D424: 'second title-card copy', 0x7D454: 'second title-card copy',
  0x81CDA: 'Fessenden monitor line for the third/fourth hero (same text)', 0x81D54: 'Fessenden monitor line for the third/fourth hero (same text)',
  0x87C30: '16x16-font caption, no spawn site loads subtype 0x4B-0x4F: unused (older caption style)', 0x87C50: 'unused 16x16 caption (no such area name in this set)', 0x87C76: 'unused 16x16 caption', 0x87C92: 'unused 16x16 caption (no such area in this set)', 0x87CB8: 'unused 16x16 caption',
  0x882D8: 'caption 0x59: in no stage spawn list (0xACD9E-0xAE680, tables 0xFC2E) and no constant load; the player cut-scene scripts (0x1E6FC, op 0x22) only ever load caption 0x1B: unused in this set', 0x882F0: 'TYROG grab line (caption 0x5A, 0x5E2F8-0x5E32A)',
  0x88384: 'location caption 0x5D: in no stage spawn list and no constant load (unused in this set)', 0x88398: 'location caption 0x5E: in no stage spawn list and no constant load (unused in this set)',
  0x91A2C: 'fragment inside Japanese data', 0x9B06C: 'fragment of a Japanese block', 0x9BEC4: 'fragment of a Japanese block',
  0x99BDC: 'intro variant 0x98FCC (no caller)', 0x99C4E: 'intro variant 0x98FCC (no caller)', 0x99C82: 'intro variant 0x98FCC (no caller)', 0x99D00: 'intro variant 0x98FCC (no caller)',
  0x9CB40: 'World intro B code, step 0x9C1F4 is not scheduled',
  0x9D9E0: 'title-screen credit message (0x9D75E-0x9D876, by coin mode and credits)', 0x9D9F8: 'title-screen credit message', 0x9DA20: 'title-screen credit message', 0x9DA52: 'title-screen credit message', 0x9DA8A: 'title-screen credit message', 0x9DAC6: 'title-screen credit message', 0x9DB0A: 'title-screen credit message', 0x9DBA0: 'title-screen credit message',
  0xA533C: 'unreferenced portrait-format copy of the monitor line (typo CREATER)',
  0xA54FC: 'hero variant of "JACK,LOOK..." (seen in story-inter4-mustapha)', 0xA5520: 'hero variant of "JACK,LOOK..."', 0xA5542: 'hero variant of "JACK,LOOK..."',
  0xA55D2: 'hero variant of "HELLO THIS IS JACK."', 0xA5608: 'hero variant of "HELLO THIS IS JACK."',
  0xA574C: 'dialogue line 0x37: no call site loads it (unused ending line)',
  0xA599C: 'dialogue line 0x3C: no call site loads it (unused; reads like Morgan after the serum, i.e. MORGUE)',
  0xA5C9E: 'FESS MESS subtype 7, Jack\'s portrait, at the start of the escape (0x69F90); not reached by the bot',
};

// ---------------------------------------------------------------- hero-dependent lines (static, from the code)
function heroVariantsMD(S, r) {
  const L = [];
  const dl = i => { const t = S.tables.find(x => x.id === 'dialogue').entries[i].target; const b = S.blocks.find(x => x.addr === t); return b ? T.screenLines(T.decodeWordBlock(b, b.font === 'blank' ? 'narrow' : b.font)).map(l => l.text).join(' / ') : ''; };
  L.push('Boss scenes are FESS MESS scripts (pool C type 0xC8, 0x844B4): routine `[0x84584 + (subtype*4 + character id of the front player)*4]`. The text is the same for every hero; the portrait (and table index) changes. Portraits: 0 Jack, 1 Hannah, 2 Mustapha, 3 Mess, 4 Fessenden, 5 Vice T., 6 Butcher, 7 Morgan, 8 village elder, 9 Slice.', '');
  L.push('| FESS MESS subtype | Spawned by | Jack | Mustapha | Hannah | Mess |', '|---|---|---|---|---|---|');
  const spawnedBy = { 0: 'VICE T. (pool B 0x48, 0x426DE)', 1: 'pool B type 0x14 (0x38F62), EPISODE 2 boss room', 2: 'SLICE (pool B 0x64, 0x4BF6C)', 3: 'EPISODE 5 village (live: story-ep5-jack f6413)', 4: 'EPISODE 8 boss room (live: story-ep8-jack f10587)', 5: 'same script as 4', 6: 'Fessenden\'s final form (0x8446C from 0x6361C)', 7: 'a JUMP PL. runner (pool B 0x184) at the escape, 0x84490 from 0x69F90 (live: story-ep8-esc2-jack f14474)' };
  for (let sub = 0; sub < 8; sub++) {
    const cells = [0, 1, 2, 3].map(cid => {
      const x = S.fessMess.find(f => f.subtype === sub && f.cid === cid);
      if (!x) return '';
      return x.steps.flatMap(s => s.ops.filter(o => o.op === 'say').map(o => `p${o.portrait} "${md(dl(o.line))}" (${hex(o.line)})`)).join('<br>');
    });
    L.push(`| ${sub} | ${md(spawnedBy[sub] || '')} | ${cells.join(' | ')} |`);
  }
  L.push('', 'Mess also gets an extra portrait beat in subtype 3 (step 0xA66D8 animates portrait 3 before the elder goes on). Intermission lines that depend on the players (0xE034 picks the first hero nobody plays, 0xE0AA the first player\'s hero):', '');
  L.push('| Before | Line chosen by | Jack plays | Mustapha plays | Hannah plays | Mess plays |', '|---|---|---|---|---|---|');
  L.push(`| EPISODE 4 | D1 = 0x2A + player's hero, spoken by the free hero | Mustapha: "${dl(0x2A)}" | Jack: "${dl(0x2B)}" | Jack: "${dl(0x2C)}" | Jack: "${dl(0x2D)}" |`);
  L.push(`| EPISODE 5 | D1 = 0x2F + player's hero, no portrait | "${dl(0x2F)}" | "${dl(0x30)}" | "${dl(0x31)}" | "${dl(0x32)}" |`);
  L.push('| EPISODE 6 | portrait of the player\'s hero (none when Hannah plays) | Jack | Mustapha | (no portrait) | Mess |');
  L.push('| EPISODE 7 | free hero speaks line 0x33 (0x34 when that hero is Hannah, same text) | Mustapha | Jack | Jack | Jack |');
  L.push('', 'OBSERVED live: the intermission rows for all four heroes (story-inter2..8-jack/-mustapha/-hannah/-mess: "HANNAH,LOOK..." and "MESS,LOOK...", "HELLO THIS IS HANNAH." / "HELLO THIS IS MESS.", no portrait before EPISODE 6 when Hannah plays and Mess\'s portrait with the blank line 0x2E when Mess plays, line 0x33 before EPISODE 7 when Jack is the free hero), the FESS MESS columns for Jack and Mustapha (story-ep*-jack/-mustapha), for Hannah and Mess in EPISODE 1 (story-ep1-hannah/-mess) and the Mess column of subtype 3 in EPISODE 5 (story-ep5-mess f8169-f8595: fessMess[15] -> 0xA5DFA, Mess standing by the elder in txt-f008177.png), and subtype 7 in story-ep8-esc2-jack. The EPISODE 7 variant 0x34 (free hero Hannah, i.e. Jack, Mustapha and Mess all playing) needs three players and was not run.');
  return L;
}

// ---------------------------------------------------------------- tables and printers
function tablesMD(S, ev) {
  const L = [];
  L.push('| Table | Address | Entries | Selected by | Note |', '|---|---|---|---|---|');
  for (const t of S.tables) L.push(`| ${t.id} | ${hex(t.at)} | ${t.n} | ${md(t.code)} | ${md(t.note)} |`);
  L.push('', 'Printers (OBSERVED, REA records in `evidence/`):', '');
  L.push('| Routine | Format | Used for |', '|---|---|---|');
  L.push('| 0x84F72 | word blocks, 8x16 English font, punctuation words | intermissions, portrait lines, captions, attract pages, monitor, continue taunts |');
  L.push('| 0x0CE4 / 0x0CD2 | word blocks, 16x16 font, dakuten words | Japanese text; title-screen credit lines; ending credits |');
  L.push('| 0x7EC48 (pool C 0x68, spawned by 0x7EC20) | word blocks typed one character per +0x86 frames | title cards |');
  L.push('| 0x0E0A / 0x0E12, 0x0E68 | word blocks, 8x16, no punctuation words | (no English story text) |');
  L.push('| 0x0C44 / 0x0C4C, 0x0C9A | word blocks, 8x8 (ASCII tile codes) | HUD erasers, credits count |');
  L.push('| 0x0BAE / 0x0BB6, 0x0C0A | byte blocks (ASCII) | version/WARNING screens, title, copyright, INSERT COIN, profile labels, test mode |');
  L.push('', 'Font (narrow 8x16, OBSERVED by rendering the scroll1 glyphs; renders of every English block are in `blocks/`): A-O = 0x160-0x16E, P-X = 0x190-0x198, Y 0x582, Z 0x583, 1-7 = 0x584-0x58A, 8 0x35D, 9 0x35E, 0 0x35F, ! 0x33F, ? 0x359, blank 0x680, "..." = 0x6CA+0x6CB. The 16x16 font: A-F 0xA4-0xAE, G-M 0xC0-0xCC, N-U 0xE0-0xEE, V 0x100, W 0x102/0x52A, X 0x105, Y 0x107, Z 0x109, M 0x528, 0-7 0x80-0x8E, 8 0xA0, 9 0xA2, ! 0x120, ? 0x122.');
  const ids = Object.entries(ev || {});
  if (ids.length) { L.push('', 'REA evidence ids:', ''); for (const [k, v] of ids) L.push(`- ${k}: \`${v}\``); }
  return L;
}

function japaneseMD(S) {
  const L = [];
  L.push('The Japanese text uses the 16x16 kana/kanji font through 0x0CE4 and is not transcribed here. Where the code switches on 0xFF8032 the Japanese table is the one at the left:', '');
  L.push('| Use | Japanese | English |', '|---|---|---|');
  L.push('| title cards | 0xC712-0xC840 (table 0xC6D2[0-7]) | 0xC868-0xC9E4 (0xC6D2[8-15]) |');
  L.push('| continue taunts | 0xF19E-0xF244 (table 0xF194) | 0xF286-0xF3B8 (table 0xF27C) |');
  L.push('| attract intro (no switch: only 0x9BF50 is called; 0x9B342 has no caller in this set) | 0x9B342 sequence, texts 0x9BE5A-0x9BF14 | 0x9BF50 sequence, texts 0x9CB40-0x9CDEC |');
  L.push('| captions with a Japanese twin in the same table | 0x878D0-0x879AA (0-6), 0x879F4 (0x0A), 0x87AB8 (0x0C), 0x87F22-0x8813E (0x14-0x17, 0x1F-0x26, 0x3B, 0x3C, 0x46, 0x48) | the English entries next to them |');
  L.push('| portrait lines | 0xA4F70 (0x1B), 0xA50B0-0xA5232 (0x1E-0x27) | 0xA4DDC-0xA5CEC |');
  const ja = S.blocks.filter(b => b.font === 'other');
  L.push('', `Japanese blocks found by the scan: ${ja.length} (addresses in story.json, lang "ja").`);
  return L;
}

// ---------------------------------------------------------------- episodes
const EPISODE_NOTES = {
  1: { title: '(none shown; the English card entry is "EPISODE 1" with an untranslated kanji subtitle, 0xC868)', boss: 'VICE T. (HUD 0x0C) with R HOPPER, the "ROCK HOPPER", on a chain', events: ['Opening: a pteranodon over EASTCOAST 2513; a poacher gang leader and three of his men confront the hero ("WE ARE TIRED OF YOU INTERFERING / WITH OUR BUSINESS. / MY MEN WILL TEACH YOU A LESSON!"); the hero\'s blast scatters them.', 'Roof top, inside the building, 47th Street.', 'Vice T. walks in with the chained raptor: the hero tells him to get away from the dino, he answers "GET LOST OR LOSE TEETH!" and threatens to feed the hero to the raptor before he skins it.'] },
  2: { boss: 'BUTCHER (HUD 0x0F), skinning a dinosaur', events: ['Intermission: picture of the Butcher, "THE BUTCHER IS HUNTING IN THE NORTHERN WOODS..."', 'The swamp forest, then the mud swamp; the heroes find skinned dinosaurs ("I CAN\'T BELIVE THIS! / LOOK AT ALL THE DEAD BODIES!").', 'The Butcher over a carcass: "OH GROSS!! ..." / "XXXX YOU!!!".'] },
  3: { boss: 'HOGG (HUD 0x26) on his bike; mid-boss WALTHER', events: ['Intermission: picture of a long-haired armoured biker (INFERRED: Hogg, this episode\'s boss) telling his gang the heroes are busy and it is a good time to take Jack\'s garage.', 'HELL ROAD through the DESERT OF DEATH in the Cadillac (car hint seen in the attract demo).', 'No boss dialogue.'] },
  4: { boss: 'SLICE (HUD 0x05)', events: ['Intermission: the garage in ruins; the free hero says "<player>,LOOK..." then "OUR GARAGE! / SOMEBODY IS GOING TO PAY!".', 'Slice\'s gang barricades the garage with barrels and takes it over ("NICE PLACE,NOW IT IS MINE!").', 'In the garage Slice meets the hero: "WHAT ARE YOU DOING IN MY GARAGE?" / "HEY MAN, I\'M HERE TO PUT AN END TO YOUR LITTLE ADVENTURE."'] },
  5: { boss: 'MORGAN (HUD 0x15), who mutates into MORGUE (HUD 0x16)', events: ['Intermission: a radio call from the village elder ("HELP WE\'RE UNDER ATTACK! THE DINOSAURS HAVE GONE CRAZY!"), the player\'s hero answers, the call is cut ("SOMETHING HAS HAPPENED TO HIM, LET\'S GO!!").', 'Stampeding dinosaurs flee the burning village.', 'The elder thanks the heroes and starts to name the Black Marketeers\' master; Morgan knocks him down ("THAT GUY ALWAYS WAS A BIG MOUTH!"), loses, and mutates into Morgue ("ARRRGGHH!! NOW I\'M REALLY GONNA GET BENT OUTTA OF SHAPE!"; INFERRED cause: the doctor\'s serum, cf. the unused line "THANKS TO THE DOCTOR! I\'M REAL LADIES MAN NOW!").'] },
  6: { boss: 'TYROG, twice: the first (type 0x10, HUD 0x19) and, after the mutation cut-scene, the poacher turned Tyrog (type 0x120, HUD 0x1B)', events: ['Intermission: picture of a dead mutant creature; the player\'s hero: "WHAT THE HECK! THIS DOCTOR IS MAD! HE\'S CREATING NEW LIFE FORMS!!!"', 'The coal mine ("COAL MANE") and the jungle.', 'The first Tyrog dies; a poacher at a crate of serum: "YOU CAN\'T GO ANY FURTHER! / I WILL SHOW YOU THE INCREDIBLE. / POWER OF THE DOCTOR!" and turns into the second Tyrog.', 'That Tyrog leaps on a hero and holds him: "SOMEONE HELP MMMMPHH...GURGLE!" (the held hero\'s line; story-ep6-grab-mustapha f9087).'] },
  7: { boss: 'SLISAUR (HUD 0x18), released by Fessenden; INFERRED to be Slice mutated', events: ['Intermission: lab equipment like "THE STAFF IN THE UNDERGROUND RUINS"; the free hero recognises "THE GENIUS DR.FESSENDEN".', 'City in the sea, library, computer room.', 'Fessenden on a monitor: "YOU FOOLS DARE TRY TO STOP THE CREATOR OF A NEW WORLD!" / "I CAN GIVE YOU ALL NEW LIVES, JUST AS I HAVE DONE TO YOUR OLD FRIEND!" / "GO AHEAD!!! "SLISAURS"".'] },
  8: { boss: 'Dr. FESSENDEN (HUD 0x22/0x25): human, then a Morgue-like beast (PAKIKE 2, type 0x178), then the giant dinosaur (8 BOSS, type 0x150 with arms and two snake-headed necks)', events: ['Intermission: Fessenden himself: "SO FAR YOU\'VE ONLY WITNESSED A TASTE OF MY POWER. IF YOU DARE, COME AND BEHOLD TRUE GENIUS."', 'Bio lab, underground, cave; mid-bosses TYROG 2 and WALTHER.', 'Boss room: "I\'VE BEEN EXPECTING YOU, ... START YOUR NEW LIFE, SHALL WE BEGIN?"; beaten, he injects himself ("PATHETIC FOOLS, NOW WITNESS THE TRUE POWER OF MY SERUM AS IT TAKES EFFECT!"), "I\'VE FINALLY DONE IT!", "ALL THE STRENGTH OF THE MIGHTY DINOSAUR AND MY EXTREME INTELLIGENCE TOGETHER IN ONE BODY!!!", "THE WORLD IS MINE TO CONTROL! HA!HA!HA!"; beaten again: "NO! I\'M NOT FINISHED / MUTATING IS SUCH A RUSH!!!".', 'Escape: the heroes regroup, the runners line up, Jack: "HIS LAB IS GONN EXPLODE! RUN!!!" (FESS MESS 7, live in story-ep8-esc2-jack f14474), everyone runs right and the ending begins.'] },
};
function episodes(r) {
  const S = r.S;
  const cards = S.tables.find(t => t.id === 'titleCards');
  const out = [];
  for (let ep = 1; ep <= 8; ep++) {
    const sec = r.script.find(s => s.ep === ep);
    const cardBlock = S.blocks.find(b => b.addr === cards.entries[8 + ep - 1].target);
    const card = cardBlock ? T.screenLines(T.decodeWordBlock(cardBlock, cardBlock.font)).map(l => l.text) : [];
    const areas = {};
    for (const it of (sec ? sec.items : [])) if (it.via && it.via.table === 'captions' && it.state && it.state.m === 0xC && /location/.test(whereOf(sec, it))) {
      const k = it.state.ar; if (!areas[k]) areas[k] = []; areas[k].push({ text: it.lines.map(l => l.text).join(' / '), addr: hex(it.addr), caption: hex(it.via.index), run: it.run, frame: it.f });
    }
    // the scripted captions of every area from the ROM spawn lists (static, OBSERVED): location captions and caption lines
    const capTable = S.tables.find(t => t.id === 'captions');
    const spawns = S.captionSpawns.captions.filter(c => c.stage === ep - 1).map(c => {
      const t = capTable.entries[c.caption].target, b = S.blocks.find(x => x.addr === t);
      return { area: c.area, trigger: c.trigger, caption: hex(c.caption), addr: hex(t), text: b ? T.screenLines(T.decodeWordBlock(b, b.font === 'blank' ? 'narrow' : b.font)).map(l => l.text).join(' / ') : '', lang: b ? (b.font === 'other' ? 'ja' : b.font === 'blank' ? 'blank' : 'en') : null };
    });
    out.push({ episode: ep, stageByte: ep - 1, titleCard: { addr: hex(cards.entries[8 + ep - 1].target), lines: card, shown: ep !== 1 }, areas: D.AREAS[ep - 1], locationCaptions: areas, spawnListCaptions: spawns, boss: EPISODE_NOTES[ep].boss, events: EPISODE_NOTES[ep].events, lines: sec ? sec.items.map(it => hex(it.addr)) : [] });
  }
  return out;
}
function episodesMD(r, eps) {
  const L = ['# Cadillacs & Dinosaurs (1993): episodes', '', 'Per episode: title card (ROM), areas and their location captions (live), the scripted captions of every area as the ROM spawn lists hold them (static: tables 0xFC2E/0xFC4E, walker 0xFC7A, REA t23; "camera N" is the camera X, or Y in a vertical area, at which the caption object is spawned), boss, and what happens, from the script in SCRIPT.md. Stage byte 0xFF84D9 = episode - 1 (V34), areas per stage 3, 3, 1, 3, 2, 3, 4, 4 (U09). Generated by `node tools/re/export/story.cjs build`.', ''];
  for (const e of eps) {
    L.push(`## EPISODE ${e.episode}${e.titleCard.shown ? ': ' + e.titleCard.lines.slice(1).join(' ') : ''}`, '');
    L.push(`- **Title card:** ${e.titleCard.shown ? '"' + e.titleCard.lines.join(' / ') + '"' : EPISODE_NOTES[e.episode].title} (${e.titleCard.addr}, typed by pool C 0x68 after the intermission)`);
    const ac = Object.entries(e.locationCaptions).map(([a, l]) => `area ${a}: ${l.map(x => `"${x.text}" (${x.addr}, caption ${x.caption})`).join(', ')}`);
    L.push(`- **Location captions (live):** ${ac.length ? ac.join('; ') : '(none printed in the runs)'}`);
    const byArea = {}; for (const s of e.spawnListCaptions) { (byArea[s.area] = byArea[s.area] || []).push(s); }
    const sl = Array.from({ length: e.areas }, (_, a) => `area ${a}: ${(byArea[a] || []).length ? byArea[a].map(s => `${s.lang === 'blank' ? '(blank English entry, Japanese only)' : '"' + s.text + '"'} (caption ${s.caption} at camera ${s.trigger})`).join(', ') : 'no caption'}`);
    L.push(`- **Scripted captions (ROM spawn lists, ${e.areas} areas):** ${sl.join('; ')}`);
    L.push(`- **Boss:** ${e.boss}`);
    L.push('- **Story:**'); for (const ev of e.events) L.push(`  - ${ev}`);
    L.push('');
  }
  L.push('## Ending', '', '- The lab collapses; the four heroes run ("HURRY UP!!"); Hannah collapses and Jack stays with her ("HANNAH!"); a cut-in of Mustapha and Mess, who got out, looking back: "JACK! HANNAH!".', '- Mustapha and Mess walk out of the desert while the staff roll scrolls.', '- The Cadillac pulls up with Jack driving and Hannah beside him. Mustapha: "JACK,HANNAH, YOU ARE ALRIGHT!" Jack: "YA, WE BARELY MADE IT!", "FESSENDEN WAS A MADMAN, HIS INSANE PLANS ALMOST BECAME OUR REALITY.", "FESSENDEN TRIED TO MESS WITH THE BALANCE... NATURE ALWAYS BALANCES ITSELF." Hannah: "LET\'S GO HOME!"', '- "THANK YOU FOR PLAYING" / "PRODUCED BY" CAPCOM, then the high-score table.', '- An unused line sits between them in the table: "YA, LET\'S START BY DESTROYING YOUR LAB." (0x37, never loaded).', '');
  L.push('## Continue and game over', '', '- Full-screen gunman with a revolver counting down from 20, taunting every 5 counts (from 20 down): "IT LOOKS LIKE YOUR LUCK JUST RAN OUT." / "HOW DARE YOU CHALLENGE US!" / "YOU FOOL I\'M GONNA FEED YOU TO THE SHIVAT!" / "EAT LEAD... BABY!" (twice). At 0 he shoots, GAME OVER, high-score table.', '');
  return L;
}

// ---------------------------------------------------------------- cast
function cast(r) {
  const hud = hudNames();
  return {
    heroes: N.CAST.heroes.map(h => Object.assign({}, h, { profile: hex(h.profile) })),
    portraits: Object.fromEntries(Object.entries(N.PORTRAITS).map(([i, p]) => [hex(+i, 2), p])),
    hudNames: hud,
  };
}
function castMD(r, c) {
  const L = ['# Cadillacs & Dinosaurs (1993): cast, factions and places', '', 'Who is who in the original game, from its own text (SCRIPT.md), the HUD name table (0x17D78, R9 in MEMORY-MAP) and the live runs. Portrait crops from the live snapshots are in `portraits/`. OBSERVED / INFERRED as in SCRIPT.md. Generated by `node tools/re/export/story.cjs build`.', ''];
  L.push('## The heroes', '', 'Attract profile pages (0x9B0F8-0x9B2C2: name, height cm, weight kg, two lines, special in the highlight colour). Select order Jack, Hannah, Mustapha, Mess; character id order Jack 0, Mustapha 1, Hannah 2, Mess 3 (V27); portrait order Jack 0, Hannah 1, Mustapha 2, Mess 3.', '');
  L.push('| Hero | HUD | Profile | Notes |', '|---|---|---|---|');
  for (const h of N.CAST.heroes) {
    const b = r.S.blocks.find(x => x.addr === h.profile);
    const prof = b ? T.screenLines(T.decodeWordBlock(b, b.font)).map(l => l.text).join(' / ') : '';
    L.push(`| ${h.name} | ${h.hud} | ${md(prof)} (${hex(h.profile)}) | ${md(h.notes)} |`);
  }
  L.push('', '## Villains and other speakers', '');
  L.push('| Who | Episode | Role | HUD name | Portrait | Evidence |', '|---|---|---|---|---|---|');
  const V = [
    ['Poacher gang leader (white-haired brute)', '1 (opening)', 'leads the poachers who confront the hero at EASTCOAST 2513', '-', '-', 'story-start-jack f957 (INFERRED speaker)'],
    ['Vice T.', '1', 'boss; poacher with the raptor R HOPPER on a chain, wants to skin it', 'VICE T. (0x0C); palette swap WALTHER (0x0D) is a mid-boss in E3-E8', '5', 'story-ep1-jack f2747'],
    ['The Butcher', '2', 'boss; hunter who skins dinosaurs in the northern woods', 'BUTCHER (0x0F)', '6', 'story-inter2, story-ep2-jack f3473'],
    ['Hogg', '3', 'biker boss on HELL ROAD; sends the gang to take Jack\'s garage', 'HOGG (0x26)', '- (picture panel only)', 'story-inter3 f102 (INFERRED identity: long-haired armoured biker = boss HOGG of E3)'],
    ['Slice', '4', 'boss; takes over Jack\'s garage', 'SLICE (0x05)', '9', 'story-inter4, story-ep4-jack f6341'],
    ['Village elder', '5', 'radios for help; starts to name the Black Marketeers\' master', '-', '8', 'story-inter5 f101, story-ep5-jack f6413'],
    ['Morgan / Morgue', '5', 'boss; silences the elder, then mutates into Morgue (INFERRED: by the doctor\'s serum)', 'MORGAN (0x15), MORGUE (0x16)', '7', 'story-ep5-jack f6838, f7471'],
    ['Serum poacher / Tyrog', '6', 'a poacher takes "THE POWER OF THE DOCTOR" and becomes the second Tyrog (type 0x120), which grabs heroes ("SOMEONE HELP MMMMPHH...GURGLE!"); the first Tyrog (type 0x10) has no lines; Tyrog 2 returns in E8', 'TYROG (0x19 first, 0x1B second), TYROG 2 (0x23)', '-', 'story-ep6-jack f7988-f8572; story-ep6-grab-mustapha f9087 (grab line, txt-f009095.png)'],
    ['Slisaur', '7', 'boss released by Fessenden; his "OLD FRIEND" given a new life (INFERRED: Slice)', 'SLISAUR (0x18)', '-', 'story-ep7-jack f14653'],
    ['Dr. Fessenden', '7-8', 'the "GENIUS" scientist behind the Black Marketeers; creates new life forms with his serum, becomes a dinosaur hybrid', 'FESSENDEN (0x22, 0x25)', '4', 'story-inter7/8, story-ep7-jack, story-ep8-jack'],
    ['The gunman of the continue screen', 'continue', 'taunts the player during the countdown, shoots at 0', '-', '- (full-screen picture)', 'story-continue2 f485 (blond spiked hair and fur collar like Vice T.; INFERRED)'],
    ['Poacher hunter', 'attract intro B', 'stalks dinosaurs in the jungle', '-', '-', 'story-attract f12505'],
  ];
  for (const v of V) L.push(`| ${v.map(md).join(' | ')} |`);
  L.push('', '## Portraits (0x84736, tiles [0x8463E + i*4], palette [0x8461A + i*2])', '');
  L.push('| Index | Who | Status | Seen |', '|---|---|---|---|');
  for (const [i, p_] of Object.entries(N.PORTRAITS)) L.push(`| ${hex(+i, 2)} | ${md(p_.name)} | ${p_.status} | ${md(p_.seen)} |`);
  L.push('', 'Portraits 0x0E-0x11 exist in the tables (palettes 0x10-0x13 again) but no call site loads them.', '');
  L.push('## Factions', '', '- **The Black Marketeers / poachers**: the enemy gangs. "THIS MUST BE THE BLACK MARKETEER\'S DOING", "WHY THE BLACK MARKETEER\'S DO THIS", "THE BLACK MARKETEER\'S DID THIS", "THEY JUST KEEP MESSING WITH THE BALANCE". They hunt and skin dinosaurs ("HURRY UP AND FINISH SKINNING THAT THING", the Butcher, Vice T.).', '- **Their master, Dr. Fessenden**: "THEIR MASTERS EVIL PLAN. HIS NAME IS..." (cut off by Morgan); revealed in the EPISODE 7 intermission ("THE GENIUS DR.FESSENDEN"). His serum makes Morgue, Tyrog and himself; he calls himself "THE CREATOR OF A NEW WORLD".', '- **The heroes**: Jack\'s group, who defend the balance of nature ("NATURE ALWAYS BALANCES ITSELF").', '- **Villagers / townspeople**: victims of the dinosaur attacks the poachers provoke.', '');
  L.push('## The world', '', '- **Setting**: "ABOUT 400 YEARS AGO..." science "HAD PROGRESSED TO THE VERGE OF CREATING NEW LIFE"; "THE GREAT CATACLYSM" followed; "THE PAST AND FUTURE HAVE COLLIDED IN A WORLD GONE MAD... THIS IS THE WORLD OF... [Cadillacs & Dinosaurs]" (attract intro B). The title page credits the comic: "TALES BASED UPON THE COMIC "CADILLACS & DINOSAURS"" (Mark Schultz).', '- **Places** (location captions and title cards): EASTCOAST 2513 (the city, year), TOP OF THE BUILDING, IN THE BUILDING, 47TH STREET; THE SWAMP FOREST / the NORTHERN WOODS, MUD SWAMP; HELL ROAD, DESERT OF DEATH; JACK\'S GARAGE, IN THE GARAGE; VILLAGE OF FLAME, VILLAGE; JUNGLE AND MINE, COAL MANE (sic), JUNGLE; THE VAULT, CITY IN THE SEA, LIBRARY, COMPUTER ROOM; THE UNDER WORLD, BIO LAB, UNDERGROUND, CAVE; the UNDERGROUND RUINS (intermission 7). Unused in this set: FACTORY, GREEN PATH, WOOD OF HUNTERES, IN THE DARK ROOM.', '- **The Cadillac**: Jack\'s car (Jack\'s garage, the Cadillac-driving HELL ROAD episode with "TAKE THE CAR, IT WOULD BE SAFER.", and the ending in which Jack and Hannah drive up). The copyright page credits General Motors for the Cadillac names, script, crest and body styles.', '');
  L.push('## Dinosaurs and other HUD names', '', 'HUD name table 0x17D78 (39 entries; index = enemy +0x03):', '');
  L.push(c.hudNames.map(h => `${h.index} ${h.name}`).join(' · '), '');
  L.push('Dinosaurs named in it: SHIVAT (an allosaur-type, "FEED YOU TO THE SHIVAT"), R HOPPER (the "ROCK HOPPER" raptor), MACK (the triceratops), ZEKE (the pteranodon), plus the mutants SLISAUR and TYROG / TYROG 2. Unnamed ones in the boss export: ankylosaurus, maiasaura, archaeopteryx, the giant foot.', '');
  return L;
}

module.exports = { SECTION_INTRO, SECTION_NOTES, whereOf, UNSEEN_NOTES, heroVariantsMD, tablesMD, japaneseMD, episodes, episodesMD, cast, castMD, hudNames, EPISODE_NOTES };
