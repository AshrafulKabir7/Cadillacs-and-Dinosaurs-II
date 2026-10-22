// Story text of the original Cadillacs & Dinosaurs: the decoded text tables (static, from the ROM and the
// disassembly) and the build step that merges them with the live runs. Research tooling only.
'use strict';
const fs = require('fs'), path = require('path');
const T = require('./story-rom.cjs');
const DIS = require('./dis.cjs');
const hex = T.hex, u8 = T.u8, u16 = T.u16, u32 = T.u32;

// ---------------------------------------------------------------- pointer tables (OBSERVED in the code named in `code`)
// kind: 'long' = table of absolute longs, 'pcword' = table of word offsets relative to the table start
const TABLE_DEFS = [
  { id: 'titleCards', at: 0xC6D2, n: 16, kind: 'long', code: '0xC6B2-0xC6CA: A0 = [0xC6D2 + stage*4 + (0xFF8032 != 0 ? 0x20 : 0)] -> 0x7EC20 (typewriter)', note: 'entries 0-7 Japanese, 8-15 English, index = stage byte 0xFF84D9' },
  { id: 'titleCards2', at: 0x7D142, n: 16, kind: 'long', code: '0x7D122-0x7D13A: same selection as 0xC6B2 (second copy of the title-card code)', note: 'byte-identical copy of the title-card table' },
  { id: 'continueTauntsJP', at: 0xF194, n: 5, kind: 'pcword', code: '0xF13E-0xF178: index = (counter +0x08)/5 when 0xFF8032 == 0 -> 0x0CE4', note: 'Japanese' },
  { id: 'continueTaunts', at: 0xF27C, n: 5, kind: 'pcword', code: '0xF17E-0xF18C: same index when 0xFF8032 != 0 -> 0x84F72', note: 'English' },
  { id: 'scroller', at: 0x7E38C, n: 28, kind: 'long', code: 'pool C type 0x60 (0x7E2D0): A0 = [0x7E38C + (+0x84)*4] -> 0x84F72 every scheduled step', note: '10-character pieces of a horizontally scrolling line' },
  { id: 'fessLines', at: 0x81BCA, n: 7, kind: 'long', code: 'pool C type 0x88 (0x81B3E): A0 = [0x81BCA + index*4] -> 0x84F72 (0x81B64-0x81B70)', note: 'Dr. Fessenden on the monitor (episode 7 boss room)' },
  { id: 'fessMess', at: 0x84584, n: 32, kind: 'long', code: 'pool C type 0xC8 "FESS MESS" (0x844B4): routine = [0x84584 + (subtype*4 + front player character id)*4]', note: 'per-boss, per-hero dialogue scripts' },
  { id: 'dialogue', at: 0x84800, n: 0x44, kind: 'long', code: '0x84736: portrait D0 (0x63 = none) + line D1: A0 = [0x84800 + D1*4] -> 0x84F72 (0x847AE-0x847F4)', note: 'portrait dialogue lines' },
  { id: 'captions', at: 0x87710, n: 0x70, kind: 'long', code: 'pool C type 0x108 (0x86D76): A0 = [0x87710 + subtype*4] -> 0x84F72 (0x86FBA-0x8700C)', note: 'in-stage captions and lines, index = object subtype +0x26' },
];
// Japanese/English selection points (OBSERVED): 0xFF8032 = 0 Japan, 1 USA, 2 World; set to 2 at 0xA736.
const REGION = { addr: 0xFF8032, writtenAt: 0xA736, value: 2, uses: [0x6FD4, 0x7400, 0x7600, 0x780C, 0xB45C, 0xB686, 0xC6BC, 0xF168, 0x427CC, 0x7D12C, 0x7EE38, 0x93D4C, 0x97EC4, 0x97EEE, 0x9A598, 0x9DD08, 0x9DD2C, 0x9DD56] };

// staff roll list: 12-byte entries (11 characters + '@') at 0x8B7EC, read by STUFF ROLL (pool C 0x15C, 0x8B60E: lea 0x8B7EC at 0x8B692)
const STAFF = { at: 0x8B7EC, end: 0x8BC84 };

// byte-format (ASCII) text regions: printers 0x0BAE/0x0BB6 (header col,row,colour), 0x0C0A (no header)
const BYTE_RANGES = [[0xB390, 0xB400], [0x97F40, 0x98100], [0x988A0, 0x988C0], [0x9AC00, 0x9AC20], [0x9D980, 0x9DA00], [0x9DB60, 0x9DBA0], [0x9DCC0, 0x9DD00], [0x9DE10, 0x9E3A0], [0xA83A0, 0xA8C80]];

let CACHE = null;
function staticDecode() {
  if (CACHE) return CACHE;
  const blocks = T.scanWordBlocks(0, 0xB0000);
  const byAddr = new Map(blocks.map(b => [b.addr, b]));
  const tables = [];
  for (const d of TABLE_DEFS) {
    const entries = [];
    for (let i = 0; i < d.n; i++) {
      const at = d.at + i * (d.kind === 'long' ? 4 : 2);
      const target = d.kind === 'long' ? u32(at) : d.at + u16(at);
      entries.push({ index: i, at, target });
      if (d.id === 'fessMess') continue;
      if (!byAddr.has(target)) {
        const b = T.parseWordBlock(target);
        if (b) { b.font = T.guessFont(b); b.chars = b.lines.reduce((s, l) => s + l.codes.length, 0); b.fromTable = d.id; blocks.push(b); byAddr.set(target, b); }
      }
    }
    tables.push(Object.assign({}, d, { entries }));
  }
  blocks.sort((a, b) => a.addr - b.addr);
  // byte blocks
  const byteBlocks = [];
  for (const [lo, hi] of BYTE_RANGES) for (let a = lo; a < hi; a++) {
    const b = T.parseByteBlock(a);
    if (!b) continue;
    const txt = b.lines.map(l => l.text).join(' ');
    if (txt.replace(/[^A-Za-z]/g, '').length < 3) continue;
    byteBlocks.push(b); a = b.end - 1;
  }
  // staff roll
  const staff = [];
  for (let a = STAFF.at; a < STAFF.end; a += 12) {
    let s = ''; for (let k = 0; k < 11; k++) s += String.fromCharCode(u8(a + k));
    staff.push({ at: a, text: s.replace(/\s+$/, '') });
  }
  CACHE = { blocks, byteBlocks, tables, staff, fessMess: fessMessScripts(), dialogueCalls: dialogueCalls(), printerCalls: printerCalls(), captionSpawns: captionSpawns() };
  return CACHE;
}

// ---------------------------------------------------------------- stage spawn lists (OBSERVED: 0xFBF4-0xFC2C and 0xFC7A-0xFCF8, REA t23)
// At an area start 0xFBF4 loads the controller's list pointers: +0x08 = [[0xFC2E + stage*4] + area*4] and
// +0x0C = [[0xFC4E + stage*4] + area*4]. The walker at 0xFC7A reads 14-byte entries {trigger, pool, type, X, depth,
// subtype, height} from the +0x08 list and spawns every entry whose trigger the camera has passed (camera X, or camera
// Y while 0xFF84DC is set): allocator [0xFD46 + pool*4], then type -> +0x20, X -> +0x08, height -> +0x0C, depth -> +0x10,
// subtype -> +0x26. The lists end with a trigger of 0xFFFF. In-stage captions are the entries of type 0x108 (pool 1 =
// pool C, 0x4860) whose subtype is the caption index: the location captions and the scripted caption lines of each area.
const AREAS = [3, 3, 1, 3, 2, 3, 4, 4];   // U09
function captionSpawns() {
  const pools = [0, 1, 2, 3].map(i => u32(0xFD46 + i * 4));
  const lists = [];
  for (let st = 0; st < 8; st++) { const tA = u32(0xFC2E + st * 4), tB = u32(0xFC4E + st * 4); for (let ar = 0; ar < AREAS[st]; ar++) lists.push({ stage: st, area: ar, at: u32(tA + ar * 4), listB: u32(tB + ar * 4) }); }
  const starts = [...new Set(lists.map(l => l.at))].sort((a, b) => a - b);
  const captions = [];
  for (const l of lists) {
    const k = starts.indexOf(l.at), bound = k + 1 < starts.length ? starts[k + 1] : l.at + 14 * 64;
    let n = 0, a = l.at;
    for (; a + 14 <= bound; a += 14) {
      const trig = u16(a), pool = u16(a + 2), type = u16(a + 4), sub = u16(a + 10); n++;
      if (trig === 0xFFFF) break;
      if (type === 0x108) captions.push({ stage: l.stage, area: l.area, at: a, trigger: trig, pool, caption: sub });
    }
    l.entries = n; l.end = a + 14;
  }
  return { code: '0xFBF4 (list pointers by stage/area) and 0xFC7A (walker; 14-byte entries, 0xFFFF ends a list)', tables: { byStage: 0xFC2E, byStageB: 0xFC4E, allocators: 0xFD46 }, pools, lists, captions };
}
function blockText(b, sep = ' / ') {
  const d = T.decodeWordBlock(b, b.font === 'blank' ? 'narrow' : b.font === 'other' || b.font === 'ascii8' ? b.font : b.font);
  const lines = T.screenLines(d);
  return lines.map(l => l.text).join(sep);
}

// ---------------------------------------------------------------- code-derived data (unidasm listing, OBSERVED)
// FESS MESS: per (subtype, character id) a list of step routines; each step may call 0x84736 (portrait D0, line D1),
// 0x84910 (animate portrait D0 until the timer +0xA4 or a button), 0x84E2E/0x84E5C (D4: villain portrait setup).
function stepOps(a) {
  const ops = []; let d0 = null, d1 = null, d4 = null;
  for (const i of DIS.range(a, a + 0x80)) {
    let m;
    if ((m = /^moveq #(-?\$[0-9a-f]+), D([014])$/.exec(i.text)) || (m = /^move\.w #(\$[0-9a-f]+), D([014])$/.exec(i.text))) {
      const v = parseInt(m[1].replace('$', ''), 16) * (m[1].startsWith('-') ? -1 : 1);
      if (m[2] === '0') d0 = v; else if (m[2] === '1') d1 = v; else d4 = v;
    }
    if (/^jsr \$84736/.test(i.text)) ops.push({ op: 'say', portrait: d0, line: d1, pc: i.addr });
    if (/^jsr \$84910/.test(i.text)) ops.push({ op: 'talk', portrait: d0, pc: i.addr });
    if (/^jsr \$84e(2e|5c)/.test(i.text)) ops.push({ op: 'villain', d4, pc: i.addr, fn: i.args });
    if (/^bsr \$a65e6/.test(i.text)) ops.push({ op: 'clear', pc: i.addr });
    if (i.op === 'rts' || i.op === 'jmp' || i.op === 'bra') break;
  }
  return ops;
}
function fessMessScripts() {
  const top = 0x84584, out = [];
  const tbls = [];
  for (let k = 0; k < 32; k++) {
    const r = u32(top + k * 4);
    const ins = DIS.range(r, r + 16).find(i => /^lea \(\$([0-9a-f]+),PC\), A2$/.test(i.text));
    tbls.push({ k, sub: k >> 2, cid: k & 3, r, t: ins ? parseInt(/\$([0-9a-f]+)/.exec(ins.text)[1], 16) : null });
  }
  const starts = [...new Set(tbls.map(x => x.t))].sort((a, b) => a - b);
  for (const x of tbls) {
    const end = Math.min(starts.find(s => s > x.t) || 0xA606E, 0xA606E);
    const steps = []; for (let a = x.t; a < end; a += 4) steps.push({ at: a, routine: u32(a), ops: stepOps(u32(a)) });
    out.push({ subtype: x.sub, cid: x.cid, routine: x.r, table: x.t, steps });
  }
  return out;
}
// every jsr/jmp/bra 0x84736 with the D0/D1 constants loaded before it
function dialogueCalls() {
  const out = [];
  for (const ins of DIS.grep(/^(jsr|jmp|bra|bsr) \$84736(\.l)?$/)) {
    let d0 = null, d1 = null, d1add = null, a0 = null, k = 1, e;
    while (k < 12 && (e = DIS.prev(ins, k))) {
      let m;
      if (d0 === null && ((m = /^moveq #(\$[0-9a-f]+), D0$/.exec(e.text)) || (m = /^move\.w #(\$[0-9a-f]+), D0$/.exec(e.text)))) d0 = parseInt(m[1].slice(1), 16);
      if (d1 === null && ((m = /^moveq #(\$[0-9a-f]+), D1$/.exec(e.text)) || (m = /^move\.w #(\$[0-9a-f]+), D1$/.exec(e.text)))) d1 = parseInt(m[1].slice(1), 16);
      if (d1add === null && (m = /^addi\.w #(\$[0-9a-f]+), D1$/.exec(e.text))) d1add = parseInt(m[1].slice(1), 16);
      if (a0 === null && (m = /^lea \$([0-9a-f]+)\.l, A0$/.exec(e.text))) a0 = parseInt(m[1], 16);
      if (/^(rts|jmp)/.test(e.op)) break;
      k++;
    }
    out.push({ pc: ins.addr, portrait: d0, line: d1, lineAdd: d1add, screen: a0 });
  }
  return out;
}
// every call of a text printer with the text address loaded into A0 just before it
const PRINTERS = { 0x84F72: 'en8x16', 0xCE4: '16x16', 0xCD2: '16x16-nohdr', 0xE12: '8x16', 0xE68: '8x16-nohdr', 0xC4C: '8x8w', 0xC9A: '8x8w-nohdr', 0xBAE: 'ascii', 0xBB6: 'ascii', 0xC0A: 'ascii-nohdr', 0x7EC20: 'typewriter' };
function printerCalls() {
  const out = [];
  for (const [addr, kind] of Object.entries(PRINTERS)) {
    const t = (+addr).toString(16);
    for (const ins of DIS.grep(new RegExp('^(jsr|jmp|bra|bsr) \\$' + t + '(\\.l)?$'))) {
      let src = null, k = 1, e;
      while (k < 8 && (e = DIS.prev(ins, k))) {
        let m;
        if ((m = /^lea \$([0-9a-f]+)\.l, A0$/.exec(e.text)) || (m = /^movea\.l #\$([0-9a-f]+), A0$/.exec(e.text)) || (m = /^lea \(\$([0-9a-f]+),PC\), A0$/.exec(e.text))) { src = parseInt(m[1], 16); break; }
        if (/^(rts|jmp|bra)/.test(e.op)) break;
        k++;
      }
      out.push({ pc: ins.addr, printer: +addr, kind, text: src });
    }
  }
  return out.sort((a, b) => a.pc - b.pc);
}

module.exports = { TABLE_DEFS, REGION, STAFF, AREAS, staticDecode, blockText, fessMessScripts, dialogueCalls, printerCalls, captionSpawns, PRINTERS };

// ---------------------------------------------------------------- sprite speech balloons (OBJ records with the text drawn in)
// Records 1593-1609 (OBSERVED: rendered from the ROM; the text below is read off those renders). Animation-set offsets are
// relative to the table base (0x15E4: a0 = set, a0 += word[set + anim*2]).
// - Set 0x92BF0 of pool D type 0x14 (0x92B7A): 12 anims, records 1593-1604. 0x6192 spawns the type with anim
//   [0x61E6 + id*4 + (random & 1)] (id = character id from +0x20) from the victory pose 0x22BA (hero state 02/00/00/18,
//   anim 0x11, taken when +0x10E == 0 and +0xC0 != 0; +0xC0 is set by the end-of-stage player script op at 0x1E63C for the
//   player with the largest X, and by 0x6160/0x6170). 0x61F6 spawns the cue [0x6244 + id] from the team-up 0x6836-0x68FC:
//   two heroes within 32 px and 16 of depth for 90 frames (+0xC3) -> the initiator (a6) takes state 02/00/00/1A, partner
//   +0x70, the partner's +0x06/+0x07 from table 0x6902; the cue balloon is the initiator's.
// - Set 0x93C82 of pool D type 0x38 (0x93B28), spawned at 0x18C30 when a hero drops in (0x18BE2; entry 0x18C1E with
//   subtype 2 from 0x2342/0x36F8/0x19A38/0x1AE1E): anim 1 (1605 "Need a hand?") when byte 0xFF84EF != 0, else anim 0
//   (1606 "They're gonna pay for this!"); then anim 2 + player number = the player marker (records 2603.., 2717.., 2720..).
// - Set 0x974EA (record 1609 "DRIVE!"): pool D type 0x98, spawner 0x97414, handler 0x97430 (blinks while (0xFF8000 & 0x1F)
//   < 0x18, X by subtype from 0x974DA or 0x974E0 depending on 0xFF84CF, height 0xA0). Nothing calls 0x97414 and the pool D
//   dispatch entry for type 0x98 (0x237E6 + 0x98) is 0: dead code. 1607 "Look out!" and 1608 "BREAK!" have no reference.
const BALLOON_TEXT = {
  1593: "You can't touch this!", 1594: "Damn I'm Good!", 1595: "Let's go!",
  1596: 'What a Wimp!', 1597: 'All Right!', 1598: 'Jump!',
  1599: 'Bad to The Bone!', 1600: "I'm a Bad Mamba Jamma", 1601: "Let's roll!",
  1602: "I'm just too Cool!", 1603: 'Number One Baby!', 1604: "Let's fly!",
  1605: 'Need a hand?', 1606: "They're gonna pay for this!", 1607: 'Look out!',
  1608: 'BREAK!', 1609: 'DRIVE!',
};
function decodeSet(set, n, len = 10) {
  return [...Array(n)].map((_, i) => {
    const fa = set + T.s16(set + i * 2), frames = [];
    for (let p = fa, k = 0; k < 8; k++, p += len) { const w0 = u16(p), w1 = u16(p + 2), d = u8(p + 7); frames.push({ rec: (w0 & 0x7FFF) >> 2, rec2: w1 < 0x8000 ? w1 >> 2 : null, dur: d & 0x7F }); if (d & 0x80) break; }
    return { anim: i, frame: hex(fa), frames };
  });
}
function balloons() {
  const SET = 0x92BF0, HEROES = ['Jack', 'Mustapha', 'Hannah', 'Mess'];
  const anims = [];
  for (let i = 0; i < 12; i++) {
    const fa = SET + T.s16(SET + i * 2);
    const rec = u16(fa) / 4;
    anims.push({ anim: i, frame: hex(fa), rec, text: BALLOON_TEXT[rec], hero: null, slot: null });
  }
  const pair = [0, 1, 2, 3].map(id => [u8(0x61E6 + id * 4), u8(0x61E7 + id * 4)]);
  const cue = [0, 1, 2, 3].map(id => u8(0x6244 + id));
  // who says what: the tables are indexed by the character id (0 Jack, 1 Mustapha, 2 Hannah, 3 Mess, V27)
  const byHero = HEROES.map((hero, id) => ({ hero, id, pairAnims: pair[id], pair: pair[id].map(a => anims[a].rec), cueAnim: cue[id], cue: anims[cue[id]].rec }));
  for (const a of anims) { const o = byHero.find(x => x.pair.includes(a.rec) || x.cue === a.rec); if (o) { a.hero = o.hero; a.slot = o.cue === a.rec ? 2 : o.pair.indexOf(a.rec); } }
  const dropIn = {
    set: hex(0x93C82), handler: 'pool D type 0x38, 0x93B28', spawn: '0x18C30 (hero drop-in 0x18BE2-0x18C5C; entry 0x18C1E, subtype 2, from 0x2342, 0x36F8, 0x19A38, 0x1AE1E)',
    select: 'anim 1 when byte 0xFF84EF != 0 (0x93B4E-0x93B58), else anim 0; once it ends, anim 2 + player number (0x93BB2-0x93BBA)',
    anims: decodeSet(0x93C82, 5).map(a => Object.assign(a, { text: a.frames.map(f => BALLOON_TEXT[f.rec]).find(Boolean) || (a.anim >= 2 ? `player ${a.anim - 1} marker` : null) })),
  };
  const victory = { pose: '0x22BA (state 02/00/00/18, anim 0x11; jump-table words 0x1AB2 and 0x2204)', condition: '+0x10E == 0 and +0xC0 != 0 (0x22C8-0x22D8; the same test at 0x199A4-0x199B4)', flag: '+0xC0 = 1 written by the end-of-stage player script op at 0x1E63C-0x1E64E (the player with the largest X) and by 0x6160-0x6176', spawner: '0x6192: pool D type 0x14 at the hero, height + 0x60, anim [0x61E6 + id*4 + (random & 1)]' };
  const teamUp = { code: '0x6836-0x68FC', condition: 'two heroes with |dX + 0x20| < 0x40 and 0 <= dDepth < 0x10 for 0x5A frames (+0xC3)', effect: 'initiator: +0x00 = 2, +0xC1 = 1, state 02/00/00/1A, +0x70 = partner, +0xC8 = 0x12; partner: position copied, +0x70 = initiator, +0x06/+0x07 from table 0x6902[initiator id*8 + partner id*2], +0x2E = 0x0E', spawner: '0x61F6 (bra.w at 0x68FC): the cue balloon of the initiator, anim [0x6244 + id]', table6902: [...Array(16)].map((_, k) => [u8(0x6902 + k * 2), u8(0x6903 + k * 2)].map(v => hex(v, 2))) };
  const driveSign = { set: hex(0x974EA), record: 1609, type: 'pool D type 0x98 (0x97424), spawner 0x97414, handler 0x97430', dispatchEntry: hex(u32(0x237E6 + 0x98)), callers: 'none (no jsr/jmp/bsr or self-relative word reaches 0x97414)', positions: { byTable0x974DA: [0, 2, 4].map(k => u16(0x974DA + k)), byTable0x974E0: [0, 2].map(k => u16(0x974E0 + k)), selector: 'byte 0xFF84CF', height: u16(0x974CA + 2) }, anims: decodeSet(0x974EA, 1) };
  // frame words rec*4 found in the ROM (for the records outside set 0x92BF0): the hits at 0x2B8D0/0x4AB60/0x74388 are
  // bytes of velocity tables, not frames
  const refs = {};
  for (const rec of [1605, 1606, 1607, 1608, 1609]) { refs[rec] = []; for (let a = 0x20000; a < 0xB0000; a += 2) if (u16(a) === rec * 4 && refs[rec].length < 8) refs[rec].push(hex(a)); }
  return { set: hex(SET), handler: 'pool D type 0x14, 0x92B7A', records: Object.entries(BALLOON_TEXT).map(([r, t]) => ({ rec: +r, text: t })), anims, byHero, pairByHero: Object.fromEntries(byHero.map(h => [h.hero, h.pairAnims])), cueByHero: Object.fromEntries(byHero.map(h => [h.hero, h.cueAnim])), victory, teamUp, dropIn, driveSign, unreferenced: [1607, 1608], refs };
}
module.exports.balloons = balloons;
module.exports.BALLOON_TEXT = BALLOON_TEXT;
