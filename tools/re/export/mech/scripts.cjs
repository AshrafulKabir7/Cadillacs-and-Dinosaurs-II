// Stage scripts of the original Cadillacs & Dinosaurs: the per-area spawn lists, the "event" (wave) chains and the
// commands they carry (stage timer set/add, enemy-mix re-roll). Read-only on the program image (tools/re/rom.cjs).
// Research tooling only; nothing here ships with the game.
//
// OBSERVED code (work/re/static/full.dis, REA records m43-m46 in rea-evidence.cjs):
//   0xFBF4 (from 0xAAEE at every area start) loads two per-area row streams into the spawner struct 0xFF866C:
//     +0x08 = long[long[0xFC2E + stage*4] + area*4]   list A, 14-byte rows
//     +0x0C = long[long[0xFC4E + stage*4] + area*4]   list B, 16-byte rows
//   0xFC6E runs every frame: rows whose word 0 (trigger) <= camera X 0xFF8744 are consumed in order (camera Y
//   0xFF8748 with a signed compare while 0xFF84DC is set). Word 2 bit 7 marks a command row, dispatched by 0xFD56
//   through long[0xFD60 + word4]:
//     0x00 0xFD74 advance one extra row         0x04 0xFD88 -> 0x182A2 re-roll the enemy-mix level 0xFF85EC
//     0x08 0xFD8E 0xFF85F2 = word6, 0xFF85F4 = word12
//     0x0C 0xFD9C stage timer 0xFF84E8 = word6 (BCD M:SS)      0x10 0xFDA4 timer += word6 (0x104A8, cap 4:00)
//   Any other row spawns an object: pool by word2 & 7 (0 pool B 0x483C, 1 pool C 0x4860, 3 pool A 0x4818);
//   +0x20 = word4 (type), +0x08 = word6 (X), +0x10 = word8 (depth), +0x26 = word10 (subtype). List A also sets
//   +0x0C = word12 (height). List B sets +0x5C = word12, +0x5B = byte14, +0x96 = byte15 (the item-drop index of
//   containers, see drops) and has conditions: word2 & 0x60 = 0x40 only with 2+ players (0xFF84EF != 0), 0x60 only
//   with 3 players; word2 & 0x18 = 0x08 only while rank 0xFF85EE >= word2 >> 8, 0x10 / 0x18 only while rank <= it.
//   A trigger of 0x9FFF or 0xFFFF ends the list (never <= the camera X).
//   Event objects (pool C type 0x3C, handler 0x7B336, placed by list B): long[0x7B37C + stage*4] is a table of
//   signed word offsets by subtype into a chain of WAVES. A wave is 3 words (the enemy count 0xFF84F3 allowed for
//   1 / 2 / 3 players; the wave waits until the live count is <= that, or until the 7200-frame timeout 0xFF850C
//   runs out), then 16-byte rows in the list-B format whose word 0 is a frame DELAY before the row runs (0x7B41E
//   counts it down, 0xFDAE executes the row: a spawn or a command). A row word 0 with bit 15 set ends the wave:
//   0x9FFF continues with the next wave (its 3 threshold words follow the 16-byte terminator), 0x8000|n ends the
//   chain with end action n: 0 sets the stage controller's exit flag 0xFF87A9 (the camera scrolls on), 2 and 4
//   run the stage-end routines (0x7B4F2 / 0x7B506) - meanings INFERRED from the callees.
'use strict';
const R = require('../../rom.cjs');
const u8 = a => R.prg[a], u16 = a => R.u16(a), s16 = a => R.s16(a), u32 = a => R.u32(a) >>> 0;
const hex = (v, n = 0) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
const bcd = v => parseInt(v.toString(16), 10);
const bcdText = w => `${bcd(w >> 8)}:${(w & 0xFF).toString(16).padStart(2, '0')}`;
const bcdSeconds = w => bcd(w >> 8) * 60 + bcd(w & 0xFF);

const TABLE_A = 0xFC2E, TABLE_B = 0xFC4E, EVENT_TABLE = 0x7B37C, SPAWNER = 0xFF866C;
const AREAS = [3, 3, 1, 3, 2, 3, 4, 4];      // U09 (areas per stage); the tables hold 4 pointers each, extras repeat
const COMMANDS = { 0x00: 'advance one extra row (0xFD74)', 0x04: 're-roll enemy-mix level 0xFF85EC (0xFD88 -> 0x182A2)', 0x08: 'set 0xFF85F2 / 0xFF85F4 (0xFD8E)', 0x0C: 'SET TIMER (0xFD9C)', 0x10: 'ADD TIME (0xFDA4 -> 0x104A8)' };
const POOLS = { 0: 'B', 1: 'C', 3: 'A' };

let NAMES = null;
function names() {
  if (NAMES) return NAMES;
  NAMES = new Map();
  try {
    const m = require('../../../../work/re/memory-map.json');
    for (const e of m.tables.spawnList.entries) { const k = `${e.pool}:${parseInt(e.type, 16)}:${parseInt(e.subtype, 16)}`; if (!NAMES.has(k)) NAMES.set(k, e.name); const k2 = `${e.pool}:${parseInt(e.type, 16)}`; if (!NAMES.has(k2)) NAMES.set(k2, e.name.replace(/_[ABC]$/, '')); }
  } catch (e) { /* no memory map: unnamed rows */ }
  return NAMES;
}
function nameOf(pool, type, subtype) { const N = names(); return N.get(`${pool}:${type}:${subtype}`) || N.get(`${pool}:${type}:${subtype & 0xFF00}`) || N.get(`${pool}:${type}`) || null; }

function decodeRow(p, list) {
  const w = k => u16(p + k * 2);
  const trigger = w(0), flags = w(1);
  const row = { addr: hex(p), [list === 'event' ? 'delay' : 'trigger']: trigger, flags: hex(flags, 4) };
  if (flags & 0x80) {
    const cmd = w(2); row.kind = 'command'; row.command = hex(cmd, 2); row.what = COMMANDS[cmd] || 'unknown'; row.arg = hex(w(3), 4); row.arg2 = hex(w(6), 4);
    if (cmd === 0x0C || cmd === 0x10) { row.time = bcdText(w(3)); row.seconds = bcdSeconds(w(3)); row.frames = bcdSeconds(w(3)) * 51; }
    return row;
  }
  const pool = POOLS[flags & 7] || `invalid (${flags & 7})`;
  Object.assign(row, { kind: 'spawn', pool, type: hex(w(2)), x: w(3), depth: w(4), subtype: hex(w(5)), name: nameOf(pool, w(2), w(5)) });
  if (list === 'A') row.height = w(6);
  else {
    row.w5c = hex(w(6), 4); row.b5b = hex(u8(p + 14), 2); row.dropIndex = u8(p + 15);
    const cond = [];
    if ((flags & 0x60) === 0x40) cond.push('2+ players'); else if ((flags & 0x60) === 0x60) cond.push('3 players');
    if (flags & 0x18) cond.push(((flags & 0x10) ? 'rank <= ' : 'rank >= ') + (flags >> 8));
    if (cond.length) row.condition = cond.join(', ');
  }
  return row;
}

function walkList(p, list) {
  const size = list === 'A' ? 14 : 16, rows = [];
  for (let n = 0; n < 1000; n++) {
    const t = u16(p);
    if (t === 0x9FFF || t === 0xFFFF) return { rows, end: hex(p), terminator: hex(t, 4) };
    rows.push(decodeRow(p, list)); p += size;
  }
  return { rows, end: hex(p), terminator: 'none within 1000 rows' };
}

// a chain of waves starting at p (3 threshold words, rows, terminator ...)
function walkChain(p) {
  const waves = []; let end = null;
  for (let w = 0; w < 64 && !end; w++) {
    const wave = { addr: hex(p), maxEnemiesByPlayers: [u16(p), u16(p + 2), u16(p + 4)], rows: [] };
    p += 6;
    for (let n = 0; n < 200; n++) {
      const d = u16(p);
      if (d & 0x8000) {
        if (d === 0x9FFF) { wave.next = 'next wave'; p += 16; }
        else { end = { terminator: hex(d, 4), action: d & 0xE, actionWhat: d & 0xE ? ((d & 0xE) === 2 ? '0x7B4F2: 0x1E5F6 + 0x1D95E, then state 6 (INFERRED: stage end)' : (d & 0xE) === 4 ? '0x7B506: 0x1E5F6 + 0x1DAC4, then state 6 (INFERRED: stage end)' : 'unknown') : '0x7B4DE: controller exit flag 0xFF87A9 = 1 (the stage scrolls on), 0x1E5F6, state 6', at: hex(p) }; wave.end = end.terminator; }
        break;
      }
      wave.rows.push(decodeRow(p, 'event')); p += 16;
    }
    waves.push(wave);
  }
  return { waves, end };
}

function decode() {
  const stages = [], timerCommands = [], otherCommands = [];
  for (let s = 0; s < 8; s++) {
    const pa = u32(TABLE_A + s * 4), pb = u32(TABLE_B + s * 4), areas = [];
    for (let a = 0; a < AREAS[s]; a++) {
      const la = u32(pa + a * 4), lb = u32(pb + a * 4);
      const A = walkList(la, 'A'), B = walkList(lb, 'B');
      areas.push({ area: a, listA: { addr: hex(la), ...A }, listB: { addr: hex(lb), ...B } });
      for (const [ln, L] of [['A', A], ['B', B]]) for (const r of L.rows) if (r.kind === 'command') {
        const rec = { episode: s + 1, area: a, source: `list ${ln} row ${r.addr}, camera X >= ${r.trigger}`, ...r };
        (r.time ? timerCommands : otherCommands).push(rec);
      }
    }
    // event chains by subtype
    const et = u32(EVENT_TABLE + s * 4); const offs = []; let minStart = Infinity;
    for (let k = 0; k < 64 && et + 2 * k < minStart; k++) { const st = et + s16(et + 2 * k); if (st <= et) break; minStart = Math.min(minStart, st); offs.push(st); }
    const chains = offs.map((st, k) => ({ subtype: k, addr: hex(st), ...walkChain(st) }));
    for (const c of chains) for (const w of c.waves) { const k = offs.indexOf(parseInt(w.addr, 16)); if (k >= 0 && k !== c.subtype) w.sharedWith = `start of subtype ${k}`; }
    // where each subtype is placed: list A/B rows and chain rows that spawn pool C type 0x3C
    const placements = [];
    const isEvent = r => r.kind === 'spawn' && r.pool === 'C' && parseInt(r.type, 16) === 0x3C;
    for (const ar of areas) for (const [ln, L] of [['A', ar.listA], ['B', ar.listB]]) for (const r of L.rows) if (isEvent(r)) placements.push({ area: ar.area, subtype: parseInt(r.subtype, 16), cameraX: r.trigger, row: r.addr, by: `list ${ln}` });
    for (const c of chains) c.waves.forEach((w, wi) => { for (const r of w.rows) if (isEvent(r)) placements.push({ area: null, subtype: parseInt(r.subtype, 16), row: r.addr, by: `event chain subtype ${c.subtype} wave ${wi}` }); });
    for (const c of chains) {
      const pl = placements.filter(q => q.subtype === c.subtype);
      c.placedBy = pl.map(q => q.area != null ? `area ${q.area} at camera X ${q.cameraX} (${q.by} row ${q.row})` : `${q.by} (row ${q.row})`);
      for (const q of pl) if (q.area == null) { const src = placements.find(z => z.area != null && `event chain subtype ${z.subtype}` === q.by.replace(/ wave \d+$/, '')); if (src) q.area = src.area; }
      c.waves.forEach((w, wi) => { for (const r of w.rows) if (r.kind === 'command') {
        const areasOf = [...new Set(pl.map(q => q.area).filter(a => a != null))];
        const rec = { episode: s + 1, area: areasOf.length ? areasOf.join('/') : null, source: `event chain subtype ${c.subtype} (placed ${c.placedBy.join('; ') || 'by no decoded row'}), wave ${wi} at ${w.addr}${w.sharedWith ? ' (' + w.sharedWith + ')' : ''} after the live enemy count <= ${w.maxEnemiesByPlayers.join('/')} (1/2/3 players), delay ${r.delay} frames`, ...r };
        (r.time ? timerCommands : otherCommands).push(rec);
      } });
    }
    stages.push({ episode: s + 1, areas, events: { table: hex(et), chains, placements } });
  }
  return {
    routines: { init: '0xFBF4 (called from 0xAAEE at every area start; spawner struct 0xFF866C: +0x08 list A pointer, +0x0C list B pointer, +0x04 state)', run: '0xFC6E every gameplay frame (list A rows: 14 bytes, list B rows: 16 bytes; consumed while word 0 <= camera X 0xFF8744, or camera Y with a signed compare while 0xFF84DC != 0)', commandDispatch: '0xFD56: long[0xFD60 + word4]', eventObject: 'pool C type 0x3C, handler 0x7B336 (init 0x7B34A, wait 0x7B3C4, rows 0x7B41E, end 0x7B464 -> table 0x7B4D8)' },
    tables: { listA: hex(TABLE_A), listB: hex(TABLE_B), events: hex(EVENT_TABLE), areasPerStage: AREAS.slice() },
    rowFormat: {
      listA: 'word0 trigger (camera X), word1 flags (bit 7 command; else pool = flags & 7: 0 B, 1 C, 3 A), word2 type (+0x20), word3 X (+0x08), word4 depth (+0x10), word5 subtype (+0x26), word6 height (+0x0C)',
      listB: 'word0 trigger, word1 flags (bit 7 command; pool = flags & 7; 0x40 2+ players, 0x60 3 players; 0x08 rank >= flags>>8, 0x10/0x18 rank <= flags>>8), word2 type, word3 X, word4 depth, word5 subtype, word6 -> +0x5C, byte14 -> +0x5B, byte15 -> +0x96 (drop index)',
      event: 'wave = 3 words (max live enemies 0xFF84F3 for 1/2/3 players; 99 = no wait; the wave also starts when the 7200-frame timeout 0xFF850C expires) then list-B rows whose word0 is a frame delay; 0x9FFF row = next wave follows, 0x8000|n = end of chain with end action n',
      commands: COMMANDS,
    },
    timerCommands, otherCommands, stages,
  };
}

module.exports = { decode, AREAS, COMMANDS, bcdText, bcdSeconds };
