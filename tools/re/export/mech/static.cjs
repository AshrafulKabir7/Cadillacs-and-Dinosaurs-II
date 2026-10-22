// Static (ROM) decode of the game-mechanics tables of the original Cadillacs & Dinosaurs, for mechanics.cjs.
// Every table address below was found by reading the code that uses it (work/re/static/full.dis, re-run through REA
// for the key sites by mech/rea-evidence.cjs); the reading code is named next to each table ("users").
// Read-only on the program image work/re/dino-prg.bin (through tools/re/rom.cjs).
'use strict';
const R = require('../../rom.cjs');
const EA = require('../enemy-anim.cjs');

const u8 = a => R.prg[a], u16 = a => R.u16(a), s16 = a => R.s16(a), u32 = a => R.u32(a) >>> 0, s8 = a => (R.prg[a] << 24) >> 24;
const hex = (v, n = 0) => (v < 0 ? '-0x' + (-v).toString(16).toUpperCase().padStart(n, '0') : '0x' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0'));
const HEROES = ['Jack', 'Mustapha', 'Hannah', 'Mess'];   // character id order (V27)
const px = v => +(v / 256).toFixed(4);                   // 8.8 velocity -> px per 60 Hz frame
const bcd = v => parseInt(v.toString(16), 10);

// HUD name table (R9 + bosses export: 39 entries 0..0x26), word offsets from the table start
const NAME_TABLE = 0x17D78;
function nameOf(i) {
  if (i < 0 || i > 0x26) return null;
  const a = NAME_TABLE + s16(NAME_TABLE + i * 2); let s = '';
  for (let p = a + 1; p < a + 20; p++) { const c = u8(p); if (c === 0x40) break; s += String.fromCharCode(c); }
  return s.trim();
}
function str(p, max = 60) { let s = ''; for (let a = p; a < p + max; a++) { const c = u8(a); if (c === 0x40) break; s += c === 0x2F ? ' / ' : String.fromCharCode(c); } return s.replace(/\s+\/\s*$/, '').replace(/\s+/g, ' ').trim(); }
function strTable(t, n) { const out = []; for (let i = 0; i < n; i++) out.push(str(u32(t + i * 4))); return out; }

// ------------------------------------------------------------------------------------------- operator settings
// QSound boards keep the settings in the EEPROM (port 0xF1C006); there are no DIP switches for these. 0xAC794 loads
// 128 bytes to 0xFFF65A (defaults: 64 words at 0xACBF4 when the 8-byte signature differs), then packs them into
// 0xFFF77A/B/C, which the game reads. The SYSTEM CONFIGURATION MENU code (0xA87E0..0xA89B2) shows which byte each
// menu line edits and the option strings.
function settings() {
  const D = 0xACBF4, cfg = k => u8(D + k);
  const items = [
    { menu: 1, name: 'COIN', byte: 8, options: strTable(0xA8C48, 10), packed: '0xFFF77A bits 0-2 (values > 7 -> 0); bit 6 set when the value is 8' },
    { menu: 2, name: 'CONTINUE', byte: 9, options: ['OFF', 'ON'], packed: '0xFFF77C bit 6' },
    { menu: 3, name: 'MONITOR FLIP', byte: 0xB, options: ['OFF', 'ON'], packed: '0xFFF77C bit 4' },
    { menu: 4, name: 'DEMO SOUND', byte: 0xA, options: ['OFF', 'ON'], packed: '0xFFF77C bit 5' },
    { menu: 5, name: 'SOUND', byte: 0xC, options: strTable(0xA8D6E, 2), packed: '0xFFF77A bit 7' },
    { menu: 6, name: 'PLAY MODE', byte: 0xD, options: strTable(0xA8D88, 4), packed: '0xFFF77A bits 3-4 (values > 2 -> 1)' },
    { menu: 7, name: 'GAME DIFFICULTY', byte: 0xE, options: strTable(0xA8DF8, 8), packed: '0xFFF77B bits 0-2' },
    { menu: 8, name: 'GAME DIFFICULTY 2', byte: 0x12, options: strTable(0xA8EC0, 4), packed: '0xFFF77B bits 3-4' },
    { menu: 9, name: 'NUMBER OF PLAYERS (lives)', byte: 0xF, options: ['1', '2', '3', '4'], packed: '0xFFF77C bits 0-1', note: 'the menu prints value+1 (0xA8962: addq #1 then a digit tile); the value itself is copied to hero +0xA3 (lives in stock) at 0x4DD6' },
    { menu: 10, name: 'EXTEND', byte: 0x10, options: strTable(0xA8F20, 4), packed: '0xFFF77B bits 5-6' },
    { menu: null, name: '(not in the menu)', byte: 0x11, options: null, packed: '0xFFF77C bit 2' },
  ];
  for (const it of items) { it.default = cfg(it.byte); it.defaultText = it.options ? it.options[it.default] : null; it.eeprom = hex(0xFFF65A + it.byte); it.byte = hex(it.byte); }
  return {
    storage: 'EEPROM through 0xF1C006 (QSound board), copy at 0xFFF65A (128 bytes), defaults 64 words at 0xACBF4',
    loader: '0xAC794 (checks the 8-byte signature at 0xACBF4, else 0xAC9D2 copies the defaults and 0xACABA writes them)',
    packer: '0xAC7BC..0xAC86C writes 0xFFF77A / 0xFFF77B / 0xFFF77C',
    menu: '0xA87E0..0xA89B2 (one routine per line; screen rows 0x90AC10 + 8*(line-1))',
    items,
    mameDefaultPacked: { FFF77C: '0x41 (U16): lives value 1, continue on' },
    debugSwitches: {
      note: 'DIP ports 0x80001A/C/E are copied inverted to 0xFF8022/23/24 (0x7C8); this board has no DIPs there, so they read 0 and every test below is off. Most tests also need the word 0xFF84AA (non-zero only in a debug mode) - OBSERVED code, meaning INFERRED',
      sites: [
        { addr: '0x2B910', test: '0xFF8024 bit 1 with 0xFF84AA', effect: 'hero hits do 0 damage' },
        { addr: '0x2B91A', test: '0xFF8024 bit 2 with 0xFF84AA', effect: 'hero hits do 100 damage' },
        { addr: '0x642A', test: '0xFF8024 bit 1 with 0xFF84AA', effect: 'enemy hits do 0 damage' },
        { addr: '0x10386 / 0x10390', test: '0xFF8023 bit 7 or 0xFF8024 bit 1 with 0xFF84AA', effect: 'stage timer frozen' },
        { addr: '0x10564 / 0x105D2', test: '0xFF8023 bit 3 with 0xFF84AA', effect: 'skips the hero-attack and enemy-attack collision passes' },
        { addr: '0x10AFE', test: '0xFF8024 bit 1 with 0xFF84AA', effect: 'mega crash costs no HP' },
      ],
    },
  };
}

// ------------------------------------------------------------------------------------------- locomotion
// 0x5036: obj+0x64 = long[0x5064 + set*16 + id*4] (long[0x50A4 + ...] while carrying a container, class 0x20A).
// Each table: 8 directions x (vx, vdepth) words, 8.8 px/frame; direction 0 = up (away), clockwise.
const DIRS = ['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'];
function speedSets() {
  const sets = [];
  for (let s = 0; s < 4; s++) {
    const per = {};
    for (let h = 0; h < 4; h++) {
      const p = u32(0x5064 + s * 16 + h * 4), dirs = [];
      for (let d = 0; d < 8; d++) dirs.push({ dir: DIRS[d], vx: s16(p + d * 4), vd: s16(p + d * 4 + 2), vxPx: px(s16(p + d * 4)), vdPx: px(s16(p + d * 4 + 2)) });
      per[HEROES[h]] = { table: hex(p), dirs };
    }
    sets.push({ set: s, per });
  }
  const carry = {};
  for (let h = 0; h < 4; h++) { const p = u32(0x50A4 + h * 4); carry[HEROES[h]] = { table: hex(p), right: s16(p + 8), up: s16(p + 2), diag: [s16(p + 4), s16(p + 6)], rightPx: px(s16(p + 8)), upPx: px(s16(p + 2)) }; }
  return { selector: '0x5036 (obj+0x64 = long[0x5064 + set*16 + id*4]; class 0x20A container: long[0x50A4 + set*16 + id*4])', directionOrder: DIRS, sets, carryingContainer: carry };
}

// ------------------------------------------------------------------------------------------- damage records
// Hero attacks (0x10A34 melee, 0x110A0 weapon objects, 0x12562 grab attacks): record = long[0xA26FC + id*4] +
// (+0x58)*4, 8 bytes (R4 corrected). Byte use per 0x10A4E..0x10AAA.
const REC_FIELDS = ['damage', 'stun', 'reaction', 'hitStop', 'sound', 'score', 'effect', 'b7'];
function heroRecords() {
  const out = {};
  for (let h = 0; h < 4; h++) {
    const base = u32(0xA26FC + h * 4), recs = [];
    for (let i = 0; i < 60; i++) { const a = base + i * 8, b = [...R.prg.slice(a, a + 8)]; recs.push({ id: i * 2, addr: hex(a), bytes: b, damage: b[0], stun: b[1], reaction: b[2], hitStop: b[3], sound: b[4], scoreCode: b[5], score: scoreOf(b[5]), effect: b[6], b7: b[7] }); }
    out[HEROES[h]] = { table: hex(base), records: recs };
  }
  return out;
}
// Enemy attacks on heroes (0x116B2): record 0xA2EA4 + (+0x58)*8; the table runs to the counter table at 0xA320C.
function enemyRecords() {
  const recs = [];
  for (let i = 0; 0xA2EA4 + i * 8 + 8 <= 0xA320C; i++) { const a = 0xA2EA4 + i * 8, b = [...R.prg.slice(a, a + 8)]; recs.push({ id: i, addr: hex(a), bytes: b, damage: b[0], stun: b[1], reaction: b[2], hitStop: b[3], sound: b[4], b5: b[5], effect: b[6], b7: b[7] }); }
  return recs;
}

// ------------------------------------------------------------------------------------------- damage modifiers
function rows(t, n, w, bytes = true) { const out = []; for (let r = 0; r < n; r++) { const row = []; for (let k = 0; k < w; k++) row.push(bytes ? u8(t + r * w + k) : u16(t + (r * w + k) * 2)); out.push(row); } return out; }
function blockHist(t, blocks) { const out = []; for (let b = 0; b < blocks; b++) { const h = {}; for (let k = 0; k < 32; k++) { const v = u16(t + b * 0x40 + k * 2); h[v] = (h[v] || 0) + 1; } out.push(h); } return out; }
function heroModifier() {
  const counter = []; for (let i = 0; 0xA320C + i * 2 < 0xA32FA; i++) { const v = u16(0xA320C + i * 2); if (v) counter.push({ victimAttackId: i * 2, mult: v }); }
  const weak = []; for (let r = 0; r < 40; r++) { const a = 0xA32FA + r * 4; weak.push({ r84: hex(r * 4), pairs: [{ attackId: u8(a) * 2, mult: u8(a + 1) }, { attackId: u8(a + 2) * 2, mult: u8(a + 3) }] }); }
  return {
    routine: '0x2B904 (melee / grab hits, attacker A2 = hero); 0x2BA2A is the same for weapon objects (power taken from the owner player 0x2B002[+0x02])',
    formula: [
      'D = b0 (record damage)',
      'if victim +0x2E == 4 (victim is in an attack frame) and word[0xA320C + victim(+0x58)*2] != 0: D = D * that >> 5 (counter hit; sets 0xFF84F4 -> +400 points and an extra effect at 0x10AB6)',
      'if attacker +0x58 == 2*byte[0xA32FA + victim(+0x84)] or 2*byte[+2]: D = D * byte[+1 / +3] >> 5 (per-enemy weakness / resistance, sets 0xFF84F5)',
      'D = D * attacker(+0xC6) (hero power, see heroPower)',
      'D = D * byte[0x2BECE + victim(+0x84)*8 + rank] >> 10; D = max(D, 1)   (rank = word 0xFF85EE, 0..31; victim row = +0x84/4, 32 bytes)',
      'D = D * word[0x2BC4E + 0x40*floor((HP-1)/100) + rnd]  (HP = victim +0x6C before the hit; one block per 100 HP above the first)',
      'D = D * word[0x2BB4E + band + rnd] >> 10; D = max(D, 1)   (band: HP%100 >= 75 -> 0, >= 50 -> 0x40, >= 25 -> 0x80, else 0xC0; rnd = random & 0x3E)',
    ],
    victimFactorByRank: { table: '0x2BECE', note: 'row = victim +0x84 / 4, column = rank 0..31, /32', rows: rows(0x2BECE, 40, 32).map((r, i) => ({ r84: hex(i * 4), values: r })) },
    hpBarsFactor: { table: '0x2BC4E', note: 'per 100-HP block (0 = HP <= 100), 32 random entries each, /32', blocks: blockHist(0x2BC4E, 10) },
    hpBandFactor: { table: '0x2BB4E', note: 'by the HP left in the current 100-HP bar (>= 75, >= 50, >= 25, < 25), 32 random entries each, /32', blocks: blockHist(0x2BB4E, 4) },
    counterHit: { table: '0xA320C', entries: counter },
    weakness: { table: '0xA32FA', note: 'by victim +0x84; attack id, multiplier/32 (two pairs)', rows: weak },
  };
}
function heroPower() {
  return {
    field: 'hero +0xC6 (byte)', setter: '0x11738 (called when the hero is hit, after the damage): +0xC6 = byte[0x2C9B6 + band*32 + (random & 0x1F)]',
    bands: 'band by the hero HP after the hit: >= 75 -> 0, >= 50 -> 1, >= 25 -> 2, else 3', table: '0x2C9B6',
    values: rows(0x2C9B6, 4, 32).map((r, b) => { const h = {}; r.forEach(v => { h[v] = (h[v] || 0) + 1; }); return { band: b, histogram: h, raw: r }; }),
    note: 'used as a multiplier /32 on every hero hit (32 = 1.0). It keeps its value until the hero is hit again; the stage-1 save states start with 42.',
  };
}
function enemyModifier() {
  return {
    routine: '0x6422 (enemy -> hero; attacker A2 = enemy, victim A3 = hero), called from 0x116CC',
    formula: [
      'D = b0 * byte[0x2C3AE + attacker(+0x84)*8 + (rank & 0x1F)] >> 5',
      'D = D - word[0x2C896 + band + rnd]  (band by hero HP: >= 76 -> 0, >= 51 -> 0x40, >= 26 -> 0x80, else 0xC0; rnd = random & 0x3E); if D < 0: D = 1',
      'D = D * word[0x2C88E + hero id*2] >> 5  (per-hero toughness)',
      'D = D * word[0x2C996 + ((HP >> 2) & 0x1E)] >> 5; D = max(D, 1)  (low-HP reduction)',
      'if HP != 1 and D >= HP and D - HP < 5: D = HP - 1  (a hit that would kill by less than 5 leaves 1 HP)',
    ],
    attackerFactorByRank: { table: '0x2C3AE', rows: rows(0x2C3AE, 40, 32).map((r, i) => ({ r84: hex(i * 4), values: r })) },
    randomReduction: { table: '0x2C896', blocks: blockHist(0x2C896, 4) },
    heroToughness: { table: '0x2C88E', values: Object.fromEntries(HEROES.map((h, i) => [h, u16(0x2C88E + i * 2)])) },
    lowHpFactor: { table: '0x2C996', note: 'index = HP / 8 (HP 0-7, 8-15, ... 120+), /32', values: [...Array(16).keys()].map(i => u16(0x2C996 + i * 2)) },
    afterHit: 'hero +0xF6 = 0x78 (0x116DE); hero +0xC6 re-rolled (0x11738)',
  };
}

// ------------------------------------------------------------------------------------------- HP tables
function hpTables() {
  const reg = []; for (let b = 0; b <= 0x26; b++) { const r = []; for (let k = 0; k < 32; k++) r.push(u16(0x31454 + b * 64 + k * 2)); reg.push({ index: hex(b, 2), name: nameOf(b), byRank: r }); }
  const boss = []; for (let i = 0; i < 10; i++) { const by = []; for (let p = 0; p < 3; p++) { const r = []; for (let k = 0; k < 8; k++) r.push(u16(0x31E52 + i * 48 + p * 16 + k * 2)); by.push(r); } boss.push({ index: i, byPlayers: by }); }
  return {
    regular: { routine: '0x31424', rule: '+0x6C = +0x6E = word[0x31454 + (+0x03)*64 + rank*2]; +0x6A (bar) = min(HP, 100); rank = word 0xFF85EE', rows: reg },
    boss: { routine: '0x31E14', rule: 'HP = word[0x31E52 + idx*48 + (players-1)*16 + ((rank & 0x1C) >> 1)]; players-1 = byte 0xFF84EF', rows: boss },
    heroes: { maxHp: 100, setAt: '0x4DC2 / 0x4DE8 (+0x6A = +0x6C = +0x6E = 0x64)' },
  };
}

// ------------------------------------------------------------------------------------------- timer
function timer() {
  const per = [];
  for (let s = 0; s < 8; s++) { const a = []; for (let k = 0; k < 4; k++) { const w = u16(0x1033E + s * 8 + k * 2); a.push({ area: k, bcd: hex(w, 4), seconds: bcd(w >> 8) * 60 + bcd(w & 0xFF), text: `${bcd(w >> 8)}:${(w & 0xFF).toString(16).padStart(2, '0')}` }); } per.push({ episode: s + 1, areas: a }); }
  return {
    clock: 'word 0xFF84E8 = BCD M:SS, tick byte 0xFF84EA counts 0x32 -> 0 and the second is taken on the following frame: 1 s = 51 frames (R8 correction, verified)',
    reset: '0x1031A: 0xFF84E8 = word[0x1033E + stage*8 + area*2], 0xFF84EA = 0x32 (called at area start: 0xAAE2, 0x20EBC, 0x229F2)',
    startValues: per,
    paused: 'no tick while 0xFF84D5, 0xFF84DD or 0xFF8518 (Cadillac) is non-zero (0x1039A..0x103AE)',
    timeOver: '0x10416: at 0:00 with tick 0: every playing hero with state < 4 gets HP 0 (0x1047C) and dies (0xFF84EB = 1); in HELL ROAD with 0xFF87B4 set the game instead adds 3:00 (0x10436, 0xFF8518 = 2)',
    add: '0x104A8 adds BCD time (cap 4:00, then clears the time-over flag 0xFF84EB) - used by script command 0xFDA4 (add) and by 0x10482/0x10490/0x1049E (+3:30, +4:00, +3:30); 0xFD9C sets the word directly',
    scriptCommands: {
      note: 'The area-start table is only the first budget: stage scripts set or add time later. Camera-triggered list-B rows set it at a camera X; event chains (pool C type 0x3C objects placed by the lists) set it when a wave is cleared (live enemy count 0xFF84F3 <= the wave threshold, or the 7200-frame wave timeout 0xFF850C). Values in BCD M:SS; frames = seconds * 51.',
      commands: SC.decode().timerCommands,
    },
    otherAdds: [
      { site: '0x1C010 (jmp 0x10482) in the death routine 0x1BFC6, after lives -= 1, the rank event 0x184E2 and the HP reset 0x4DE8', effect: 'every respawn with lives left adds 3:30 (cap 4:00), 0xFF850C += 600 (10 s more wave timeout) and clears the time-over flag', status: 'OBSERVED' },
      { site: '0x7458 (jsr 0x10490) in the player-start routine 0x7442 (continue / join with a credit)', effect: '+4:00, i.e. the clock becomes 4:00 by the cap', status: 'OBSERVED code; live mech-timer-respawn' },
      { site: '0x6E9E (jsr 0x1049E) in the join-in path 0x6E86 (a second player pressing start during play)', effect: '+3:30 (cap 4:00)', status: 'INFERRED from the callee; not run live' },
    ],
    waveTimeout: '0xFF850C: set to 0x1C20 (7200 frames = 2 minutes) when an event chain starts or finishes a wave (0x7B368 / 0x7B456); every wave wait decrements it (0x7B3DA) and proceeds when it underflows even if enemies are left; the respawn / continue / join time adds give it +600',
    display: {
      object: 'pool E object, handler 0x81046 (created by 0x8105A while 0xFF84CC != 0; init 0x8106C: screen-space, height 0xB8)',
      rule: '0x810BA: not drawn while the clock is above 3:00. Below that, the digits appear for 300 frames each time the seconds reach :00 or :30, and continuously (800-frame reload every tick) once the clock is at or below 0:15; while shown they tick with sound 0x34 (0xA63C) every timer second, and from 1:00 down the palette override +0x23 = 0x84 is used (0x8113E). The display counter +0xA2 only counts down while 0xFF84DD == 0.',
      status: 'OBSERVED code; matches the reference video (digits visible only in some phases)',
    },
  };
}
const SC = require('./scripts.cjs');

// ------------------------------------------------------------------------------------------- running
// Run state handler 0x1A078 (hero state 2.0.2.0; speed set chosen by 0x5036 with D0 = 8 (set 2, start burst) while
// frame byte 4 (+0x2C) of the run animation is non-zero, else D0 = 4 (set 1)). Then: attack pressed (+0xA8 bit 4)
// -> 0x1A174 dash attack; jump pressed (bit 5) -> 0x1A906 running jump; else 0x1BDEC applies the stick: with no
// direction held it re-applies the speed of the remembered stick direction +0x22 (so the run keeps going); with a
// direction held +0x24 (facing) and +0x22 are updated from table 0x1BDCC and the speed row of +0x64 is written;
// 0x1A0BC then compares the new +0x22 with the previous one (+0xAC): a change of more than 4/32 of a turn
// ((new - old + 4) & 0x1C > 8, i.e. anything but the same or an adjacent 45-degree direction) ends the run (0x19122 ->
// idle, then walking from the held direction).
function runRules() {
  const H = [0x9E41C, 0x9F414, 0xA06AC, 0xA16F0];   // main sets (V16)
  const burst = {};
  H.forEach((set, h) => { const a = set + s16(set + 4); const fr = []; let p = a; for (let k = 0; k < 16; k++) { const b7 = u8(p + 7); fr.push({ rec: u16(p) >> 2, b4: u8(p + 4), dur: b7 & 0x7F }); if (b7 & 0x80) break; p += 12; } burst[HEROES[h]] = { runAnim: hex(a), firstFrame: fr[0], framesWithByte4: fr.filter(f => f.b4).length, frames: fr }; });
  const codes = []; for (let i = 0; i < 16; i++) codes.push(s8(0x19292 + i));
  return {
    handler: '0x1A012 / 0x1A078 (state 2.0.2.0); entry 0x19FC6',
    start: {
      rule: 'double tap: from idle (0x19122 handler) a direction press starts a walk (0x192B8: +0xBD = the input nibble, +0xBC = 15, state 2.0.0.2). +0xBC counts down every frame (0x18D6C). When a direction is pressed again from idle while +0xBC >= 3, i.e. within 12 frames of the first press, and its direction code (table 0x19292 by input nibble: up 0, up-right 1, right 2, down-right 3, down 4, down-left 5, left 6, up-left 7) is the same as or adjacent to the first one ((new - old + 1) & 0x1F < 3, 0x1925A), the run starts (0x19266 -> 0x19FC6). Not while carrying a container (class 0x20A, 0x1923E) and not within the 5-frame lockout +0xFC after a run (0x19236, set at 0x19FD8). Up and down double taps pass the same test (codes 0 / 4), so they do start a run if the first press was a pure up/down tap - the live loco runs double-tapped up while already walking, which is why no run was seen; mech-run-* double-taps from idle.',
      directionCodes: codes, status: 'OBSERVED code; live mech-loco-* (left/right), mech-run-* (18-frame gap: no run)',
    },
    duration: { rule: 'a run lasts at most 240 frames: +0xFA = 0xF0 at the run start (0x19FD2), counted down every frame (0x18E28), and the run handler returns to idle when it reaches 0 (0x1A018 -> 0x19122)', frames: 240, status: 'OBSERVED code; live mech-run-* (the long run)' },
    burst: { rule: 'speed set 2 while +0x2C (run animation frame byte 4) != 0 (0x1A07A: D0 = 8 else 4 -> 0x5036); only the first run frame has byte 4 = 1', perHero: burst, live: 'mech-loco-*: 7 / 5 / 5 / 5 frames at the set-2 speed (first frame duration 8 / 6 / 6 / 6 minus the start frame)' },
    persistence: { rule: 'releasing the stick does not stop the run: 0x1BDEC re-applies the speed row of the remembered stick direction +0x22 every frame while no direction is held (until the 240-frame limit)', status: 'OBSERVED (0x1BDEC: input & 0xF == 0 -> D0 = +0x22; bpl -> speed row), live mech-run-*' },
    steering: { rule: 'a held direction updates facing (+0x24, left/right bits only) and +0x22; the run continues only if the new direction is the same as or adjacent (45 degrees) to the previous one (0x1A0BC..0x1A0D2: (new - old + 4) & 0x1C <= 8), so up-right / down-right steer a right run (set-1 diagonal row), while up, down, the opposite direction or any other change end the run (0x19122: idle, then the walk from the held input)', status: 'OBSERVED code, live mech-run-*' },
    attacks: { rule: 'attack while running -> 0x1A174: with empty hands or a blunt weapon / gun (class != 0x201/0x202) the dash attack 0x19720 (ground slide for Jack, low leap for the others); with a throwable or blade (class 0x201 / 0x202) a weapon dash 0x1A18C (state 2.0.2.2, split body); jump while running -> 0x1A906 (running jump, table kind 1)', status: 'OBSERVED code; empty-hand dash and running jump live (mech-loco-*, mech-run-*)' },
    stop: { rule: 'the run also ends when 0xFF84DD is set (area transition / scripted stop) with no direction held (0x1A09E), when the hero is hit, and at a grab', status: 'OBSERVED code (0x1A09E); grab/hit INFERRED' },
  };
}

// ------------------------------------------------------------------------------------------- knockdown decision
// Hero hit reaction entry 0x1C040 (state 2.2.0.0 from an enemy hit at 0x116B2). 0x1C08A..0x1C0A6 decides:
//   HP == 0 (0x1C08A) or stun +0x78 == 0 (0x1C092) or +0x5A != 0 (0x1C09A) or +0x51 != 0 (0x1C0A2) -> 0x1C19C knockdown
//   otherwise the flinch: anim 0 of the hurt set (0x13B0), +0x07 += 2, hit-stop count-down (0x1C0D0), then back to idle
// 0x116F2 copies the attacker's +0x5A into the hero's +0x5A on every enemy hit (0x107AA, 0x10F30, 0x11820, 0x11E0A are
// the same copy in the other hit routines); the hero's +0x5A is cleared at the get-up (0x1CDC2) and at 0x1FF06.
// +0x51 is the airborne flag of every object: 0x12CF2 / 0x12D4E set it when the height is above the floor (0x12D1C,
// 0x12D7A) and clear it on landing (0x12D48, 0x12DA6); the hero sets it itself for the drop-in, the leap attack
// (0x1AC46) and the knockdown fall (0x1C276).
function knockdownRule() {
  return {
    entry: 'the enemy hit routine writes the enemy record\'s reaction byte (byte 2) to the hero +0x7B and +0x06 (0x1170A) and sets state 2.2; the hurt handler 0x1C02C then dispatches on +0x06: 0 (light) -> 0x1C062, 2 (medium) -> 0x1C124, 4 (heavy) -> the knockdown path directly (these attacks also carry stun bytes >= 10)',
    decision: 'light and medium hits decide the same way (0x1C08A..0x1C0A6 and 0x1C14C..0x1C168): knocked down when HP == 0, or the stun meter +0x78 == 0, or +0x5A != 0 (the attack carried the knockdown flag), or +0x51 != 0 (the hero was airborne); otherwise a flinch',
    knockdown: '0x1C19C (light: state 2.2.4.x) / 0x1C37C (medium: state 2.2.6.x): reaction byte +0x7B = 4, +0x51 = 1, stun refilled to 10 (0x1C286), velocity from the fall table 0x1D28E (or 0x1D296 when the HP is 0: the death fall), rank event 0x183E4 (-1) at the landing 0x1C0F4; get-up 0x1CDAE: state 2.2.0x1E, +0xF6 = 0x78, +0x5A cleared, stun 10, then 20 i-frames (0x6C2A)',
    flinch: '0x1C0AA (light: hurt anim 0, state 2.2.0.2) / 0x1C16C (medium: hurt anim 1, state 2.2.2.2), sound 0x98CC, +0x07 += 2; lasts the attack\'s hit-stop byte (+0x59 counts down at 0x1C0D0 / 0x1C192); no i-frames after it',
    knockdownFlag: {
      field: 'attacker +0x5A (byte), copied to the victim at 0x116F2 (hero hit by an enemy), 0x107AA / 0x10F30 / 0x11820 / 0x11E0A (the other hit routines)',
      setBy: 'the enemy handlers set +0x5A = 1 when they start a knockdown attack and clear it for the others; examples: Chinpira 0x3442E..0x344E6 (attack ids 0, 1, 2: the flag is set when byte[0x343E8 + combo step +0xAA] is negative, i.e. on the combo finisher), Hutori 0x3BF66 / 0x3BFA2 (attack ids 4 and 5 set the flag unless +0xB4 != 0: the first hits of the combo, +0xB4 counted down at 0x3BF0C), and 0x3C26E / 0x3C2C2 (ids 4 / 5 again, flag cleared)',
      live: 'mech-knockdown-* logs the attacker +0x5A at every hit',
      status: 'OBSERVED',
    },
    airborneFlag: { field: '+0x51 (every object): 1 while the height is above the floor (+0x54 + +0x56); set at 0x12D1C / 0x12D7A, cleared at the landing 0x12D48 / 0x12DA6; also forced to 1 by the hero at the drop-in (0x18B1E, 0x18B50, 0x18BE2), the leap attack (0x1AC46) and the knockdown (0x1C276)', effect: 'a hit taken while airborne (jump, running jump, leap attack) is always a knockdown', status: 'OBSERVED code; live mech-knockdown-* (jump phase)' },
    stunMeter: 'the meter only decides when the attack carries no flag and the hero is on the ground: each enemy hit subtracts enemy record byte 1 (0x116E6, floor 0), and the meter is refilled to 10 at the knockdown (0x1C286) and the get-up (0x1CDC6); it also refills 0x78 frames after a hit when the hero is not hit again (+0xF6 countdown 0x18DC6: +0x78 = 10 at 0)',
  };
}

// ------------------------------------------------------------------------------------------- air control
// 0x1BE3C (called from the jump handler 0x1A6DA and the other airborne states 0x1A810, 0x1B0C2, 0x1B1AC, 0x1B2DC,
// 0x1B41C): with a direction held, +0x22 = the stick direction (table 0x1BDCC) and the (dvx, dvdepth) pair at
// 0x1BE66 + stick*... is ADDED to +0x14 / +0x18 every frame.
function airControl() {
  const DIRN = ['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'];
  const per = DIRN.map((d, i) => ({ dir: d, dvx: s16(0x1BE66 + i * 4), dvd: s16(0x1BE66 + i * 4 + 2) }));
  return { routine: '0x1BE3C, table 0x1BE66 (8 directions x (dvx, dvdepth), 8.8 per frame per frame)', perDirection: per, note: 'tiny: holding right during a 46-frame jump adds 2/256 px/f per frame to vx (about 8 px of extra travel); up/down add 1/256 px/f per frame to the lane speed', live: 'mech-loco-*: write tap pc 0x1BE5A / 0x1BE60 (610, 612, 614 ... during the forward jump with right held)', status: 'OBSERVED' };
}

// ------------------------------------------------------------------------------------------- score
function scoreOf(code) { const a = 0x10292 + code; if (code > 0x84 || code & 3) return null; return bcd(u32(a)); }
function scoreTable() { const v = []; for (let i = 0; i < 34; i++) v.push({ code: hex(i * 4), points: bcd(u32(0x10292 + i * 4)) }); return v; }

// ------------------------------------------------------------------------------------------- items
function firstRec(set, anim) { try { const s = EA.decodeSet(set); const an = s.anims[anim]; if (!an || !an.frames.length) return null; return an.frames[0].rec; } catch (e) { return null; } }
function allRecs(set, anim) { try { const an = EA.decodeSet(set).anims[anim]; const out = []; for (const f of an.frames) { if (f.rec != null) out.push(f.rec); if (f.rec2 != null) out.push(f.rec2); } return [...new Set(out)]; } catch (e) { return []; } }
function food() {
  const list = [];
  for (let sub = 1; sub <= 17; sub++) { const a = 0x28B10 + (sub - 1) * 4; list.push({ subtype: sub, heal: u16(a), scoreCode: hex(u16(a + 2)), scoreAtFullHp: scoreOf(u16(a + 2)), record: firstRec(0x28B54, sub - 1), records: allRecs(0x28B54, sub - 1) }); }
  return {
    object: 'pool A type 0x10, handler 0x2898C, subtype +0x26 = 1..17, anim set 0x28B54 (anim = subtype-1)',
    pickup: '0x28AA4: if the eater HP == 100 the item scores word[0x28B10+(sub-1)*4+2] (jsr 0x10036) and heals nothing; otherwise HP = min(HP + heal, 100) (no score). Sound 3 (0x1693C).',
    table: '0x28B10 (heal word, score code word)', list,
  };
}
function scoreItems() {
  const list = []; for (let sub = 1; sub <= 16; sub++) { const c = u8(0x2A164 + sub - 1); list.push({ subtype: sub, scoreCode: hex(c), points: scoreOf(c), record: firstRec(0x2A174, sub - 1), records: allRecs(0x2A174, sub - 1) }); }
  return { object: 'pool A type 0x24, handler 0x2A028, anim set 0x2A174 (an item cycles through every record of its animation; "record" is the first frame, "records" all of them)', pickup: '0x2A10E: score byte[0x2A164 + sub-1] (jsr 0x10036); in EPISODE 3 subtype 0x0C also calls 0x8BD24 once (0xFF850E)', table: '0x2A164', list };
}
function magazine() {
  const per = []; const names = ['rifle', 'gun', 'knife', 'uzi', 'm16', 'shotgun', 'bazooka', 'rod', 'stick', 'bknife', 'club', 'torch', 'dynamite', 'grenade', 'stone'];
  for (let i = 0; i < 15; i++) { const a = 0x2855A + i * 8; per.push({ weapon: names[i], subtype: hex(i * 2), refill: u16(a), class: hex(u16(a + 2)), poseSlotX4: u16(a + 4) }); }
  return { object: 'pool A type 8 (ITEM MAGAZIN), handler 0x283DE', pickup: '0x284B4/0x284E2: if the eater holds a gun whose entry has a non-zero refill: ammo = refill (also restores class/pose of an emptied rifle/M16); if the ammo was already full, +1000 points. With no gun: +1000 points (score code 0x38).', table: '0x2855A (refill, class, pose*4)', list: per };
}
const DROP_NAMES = (() => { const w = ['RIFLE', 'GUN', 'KNIFE', 'UZI', 'M-16A1', 'SHOT GUN', 'BAZOOKA', 'ROD', 'STICK', 'B. KNIFE', 'CLUB', 'TORCH', 'DYNAMITE', 'GRENADE']; return w; })();
function dropCode(c, foodList, scoreList) {
  if (c === 0) return { kind: 'none' };
  if (c === 0x0F) return { kind: 'magazine', note: 'only if a hero holds a refillable gun on screen, else re-rolled in table 0xB64D2' };
  if (c < 0x14) return { kind: 'weapon', subtype: hex((c - 1) * 2), name: DROP_NAMES[c - 1] || null };
  if (c < 0x28) { const sub = c - 0x14 + 1; const f = foodList.find(x => x.subtype === sub); return { kind: 'food', subtype: sub, heal: f ? f.heal : null, record: f ? f.record : null }; }
  const sub = c - 0x28 + 1; const s = scoreList.find(x => x.subtype === sub); return { kind: 'score item', subtype: sub, points: s ? s.points : null, record: s ? s.record : null };
}
function drops() {
  const F = food().list, S = scoreItems().list;
  const tab = (base, n) => { const out = []; for (let v = 1; v <= n; v++) { const a = base + v * 32, bytes = [...R.prg.slice(a, a + 32)]; const h = {}; bytes.forEach(b => { h[b] = (h[b] || 0) + 1; }); out.push({ index: v, addr: hex(a), outcomes: Object.entries(h).map(([c, k]) => ({ code: hex(+c, 2), chance: `${k}/32`, ...dropCode(+c, F, S) })) }); } return out; };
  const fb = [...R.prg.slice(0xB64D2, 0xB64D2 + 32)]; const fh = {}; fb.forEach(b => { fh[b] = (fh[b] || 0) + 1; });
  return {
    routine: '0x24B48 (table 0xB64F2) and 0x24B36 (table 0xB6D12): index = dropper +0x96 (0 = no drop); one byte of the 32-byte row is picked with random & 0x1F',
    codes: '0 none; 0x01-0x0E weapon item subtype (c-1)*2; 0x0F ammo magazine; 0x14-0x27 food subtype c-0x13; 0x28+ score item subtype c-0x27',
    callers: { '0x24B48': 'carried/thrown containers (pool A type 0x14 handler 0x28C76: 0x28E8C, 0x2914E ... 0x29848) and pool B 0x5BAB4/0x5BAD0/0x5BD8A (rolling / falling drums 0x104, rocks 0x108)', '0x24B36': 'pool A type 0x2C (0x2A758 ...), pool B 0x499FC.. (dinosaur handler region) and the bike 0x5C6CE' },
    dropperIndex: 'obj+0x96 comes from the spawning script (debug spawn list: low byte of the entry word at +24); placed enemies themselves do not call these routines',
    fallbackMagazine: { table: '0xB64D2', outcomes: Object.entries(fh).map(([c, k]) => ({ code: hex(+c, 2), chance: `${k}/32`, ...dropCode(+c, F, S) })) },
    tableB64F2: tab(0xB64F2, 64), tableB6D12: tab(0xB6D12, 24),
  };
}

// ------------------------------------------------------------------------------------------- rank (dynamic difficulty)
function rankSystem() {
  const t = (a, n) => [...Array(n).keys()].map(i => u16(a + i * 2));
  const perStage = []; for (let s = 0; s < 8; s++) perStage.push({ episode: s + 1, add: s16(0x1823A + s * 8), max: u16(0x1823A + s * 8 + 2), min: u16(0x1823A + s * 8 + 4) });
  const area = []; for (let s = 0; s < 8; s++) area.push([0, 1, 2, 3].map(a => u8(0x18094 + s * 4 + a) - 1));
  const start = [];
  for (let row = 0; row < 4; row++) { const r = []; for (let d = 0; d < 8; d++) { const off = u16(0x180BA + row * 16 + d * 2); const bytes = [...R.prg.slice(0x180FA + off, 0x180FA + off + 32)].map(b => b - 1); const h = {}; bytes.forEach(b => { h[b] = (h[b] || 0) + 1; }); r.push({ difficulty: d, table: hex(0x180FA + off), histogram: h }); } start.push({ playTimeRow: row, threshold: row ? u16(0x180B4 + (row - 1) * 2) : 0, byDifficulty: r }); }
  const eff = []; for (let r = 0; r < 32; r++) eff.push({ rank: r, p1: u16(0x1860C + r * 6), p2: u16(0x1860C + r * 6 + 2), p3: u16(0x1860C + r * 6 + 4) });
  return {
    variables: { '0xFF85F0': 'rank (0..31), the adjustable value', '0xFF85EE': 'effective rank = word[0x1860C + rank*6 + (players-1)*2] - used by every HP / damage table', '0xFF85EC': 'per-area enemy-mix level byte[0x18094 + stage*4 + area] - 1, re-rolled by 0x182A2 (tables 0x182E4 / 0x18364)', '0xFF85F6': 'second difficulty level = GAME DIFFICULTY 2 + 1 (0x17FFA), then adjusted by events (0x18566, 0..15)' },
    gameStart: '0x17F8A: row = 0/1/2/3 by word 0xFF84F6 against 720/3600/10800 (0x180B4; a counter of idle time 0x18288), then rank = byte[0x180FA + word[0x180BA + row*16 + GAME DIFFICULTY*2] + (random & 0x1F)] - 1',
    startTables: start,
    perEpisode: { routine: '0x1800E: rank += add, clamped to [min, max]', table: '0x1823A', values: perStage },
    perArea0xFF85EC: { table: '0x18094', values: area },
    timeIncrease: { routine: '0x186E4 (every gameplay frame unless 0xFF8602, 0xFF84DD or 0xFF84D5): 0xFF85F8 counts down; on underflow rank += 1 (max 31) and 0xFF85F8 = word[0x187B8 + 0xFF85F6*2]', intervalByLevel: t(0x187B8, 16), note: '0xFF85F6 = GAME DIFFICULTY 2 + 1 at game start (1..4 -> 520/480/440/400 frames), later moved by events (0..15)', live: 'mech-moves-jack: rank +1 every 481 frames with 0xFF85F6 = 2 (NORMAL); after a death 0xFF85F6 = 0 and the interval became 601 frames (mech-hurt-jack)' },
    pendingCounters: '0x18736/0x18764: +0x0E pending increases (+1 every 1800 frames), +0x10 pending decreases (-1 every 1200 frames), set by events not traced here',
    events: [
      { site: '0x183E4', effect: 'rank -= word[0x187D8] (1), then a 600-frame cooldown (0xFF8604 = word[0x187DA])', live: 'mech-hurt-jack: -1 at the knockdown f127 and again at f907 (not between)', status: 'OBSERVED' },
      { site: '0x184E2', effect: 'hero death: rank -= word[0x187E0 + GAME DIFFICULTY*2] (7 6 5 4 3 2 1 0; 3 if another death came within 600 frames, 0xFF8606), then the lives event 0x1843C, then 0xFF85F6 += word[0x187F4 + GAME DIFFICULTY*8 + players term] (negative, clamped at 0)', live: 'mech-hurt-jack (NORMAL): death at f1534: rank 13 -> 9, 0xFF85F6 2 -> 0', status: 'OBSERVED' },
      { site: '0x1843C', effect: 'sum of lives in stock of the playing heroes: 0 -> rank -3; (sum - starting lives 0xFF84E6) == 2 -> +2; >= 3 -> +4 (0..31); also after an extend (0x6BDC)', live: 'mech-hurt-jack: the second death (no lives left) f2617: rank 11 -> 4 (-4 death, -3 no lives)', status: 'OBSERVED' },
      { site: '0x18410 / 0x1842C', effect: '0xFF85F6 += word[0x187DC] (3) while main state is 0x0C / += word[0x187DE] (-1); callers not traced', status: 'INFERRED' },
    ],
    clamp: '0x18592: 1 player: rank <= 24; 2 players: 4..28; 3 players: >= 4',
    effectiveTable: { table: '0x1860C', values: eff },
    tables: { '0x187D8': t(0x187D8, 4), '0x187E0': t(0x187E0, 8), '0x187F0': u16(0x187F0), '0x187F4': t(0x187F4, 32), '0x187B8': t(0x187B8, 16) },
  };
}

// ------------------------------------------------------------------------------------------- lives, extend, i-frames
function livesExtend() {
  const lists = []; for (let k = 0; k < 4; k++) { const off = s16(0x6BFE + k * 2), a = 0x6BFE + off; const th = []; for (let i = 0; i < 4; i++) { const v = u32(a + i * 4); if (v === 0x99999999) break; th.push(bcd(v)); } lists.push({ setting: k, thresholds: th }); }
  const f9 = []; for (let r = 0; r < 4; r++) f9.push({ row: r, byHero: Object.fromEntries(HEROES.map((h, i) => [h, u8(0x6C3A + r * 4 + i)])) });
  return {
    livesStart: '0x4DD6: hero +0xA3 (lives in stock, HUD "=N") = 0xFFF77C & 3 = NUMBER OF PLAYERS setting; copy at 0xFF84E6',
    extend: { routine: '0x6B98 (score check every frame): when the score passes the next threshold of the EXTEND setting: +0xA3 += 1, rank event 0x1843C, sound', table: '0x6BFE', lists },
    secondIframeTable: { routine: '0x6C2A: +0xF9 = byte[0x6C3A + row + id]', rows: f9 },
  };
}

module.exports = { HEROES, hex, px, bcd, nameOf, settings, speedSets, heroRecords, enemyRecords, heroModifier, heroPower, enemyModifier, hpTables, timer, scoreTable, scoreOf, food, scoreItems, magazine, drops, rankSystem, livesExtend, REC_FIELDS, runRules, knockdownRule, airControl, scripts: SC };
