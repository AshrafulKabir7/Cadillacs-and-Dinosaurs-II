// Static decode of the hero-related objects and data that live outside the six animation lists:
//   torchFlame()     the TORCH's flame: a separate pool-A object (type 0x18) that follows the held torch
//   stagePalettes()  OBJ palette slot -> ROM palette row for every stage area (table 0x8E8E, area start 0x8A44)
//   bubbles()        the catchphrase speech bubbles (pool D type 0x14, set 0x92BF0)
//   extraRecords()   hero-palette records that no hero animation uses
// Everything is read from the program image (work/re/dino-prg.bin); addresses are the code that reads the data.
'use strict';
const R = require('../../rom.cjs');
const S = require('./hero-static.cjs');
const SR = require('./stage-rom.cjs');
const { u16, s16, u32, prg } = R;
const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();

// a chain of 10-byte frames started directly by address (0x160A), up to the end flag + its loop word
function chain10(a, max = 32) {
  const frames = []; let p = a, loopTo = null;
  for (let g = 0; g < max; g++) { const f = S.frame10(p); frames.push(f); p += 10; if (f.last) { loopTo = p + s16(p); break; } }
  const lf = loopTo == null ? null : frames.findIndex(f => parseInt(f.addr, 16) === loopTo);
  return { addr: hex(a), frames: frames.map(f => ({ addr: f.addr, rec: f.rec, rec2: f.rec2, b4: f.b4, b5: f.b5, dur: f.dur, last: f.last || undefined })), loopTo: loopTo == null ? null : hex(loopTo), loopFrame: lf >= 0 ? lf : null };
}

// ------------------------------------------------------------------------------------------------ torch flame
// Torch item init 0x24F4C (V19 id 0x16) allocates a pool-A object at 0x24F6E: type 0x18, +0x5A = the torch, +0x58 = the
// torch class (0x203). Handler 0x29B06:
//   init      start the frame chain 0x29CB6 (0x160A), +0x25 = 0x30, +0x5C/+0x5D = 0
//   per frame free itself (0x48D4) when the torch slot is empty, its type is not 0 or its class differs from +0x58;
//             +0x01 (drawn) = torch +0x01; offset = long [0x29C26 + torch byte +0x2D] (torch frame byte b5, 4 per entry):
//             high word dx (negated when the torch faces right), low word dy (height, up); depth = torch depth + 2,
//             or - 1 when bit 0 of 0xFF8001 is set (alternate frames: behind / in front of the holder)
//   anim      held (torch +0x05 == 8) and the holder running (+0x06 == 2): the running chain 0x29CF4 starts when the
//             run starts (only from a frame with b4 == 0); otherwise the burning chain 0x29CB6 restarts as soon as
//             the current frame has b4 != 0 (= a running-flame frame). On the ground / thrown: burning chain.
function torchFlame() {
  const burning = chain10(0x29CB6), running = chain10(0x29CF4);
  const torchSet = S.set10(0x276FE), use = {};
  for (const an of torchSet.anims) if (!an.terminator) an.frames.forEach((f, i) => { const k = f.b5 >> 2; (use[k] = use[k] || []).push(`${an.index}.${i}`); });
  const offsets = [];
  for (let k = 0; k <= 32; k++) offsets.push({ index: k, b5: k * 4, dx: s16(0x29C26 + k * 4), dy: s16(0x29C26 + k * 4 + 2), origin: [s16(0x29C26 + k * 4), -s16(0x29C26 + k * 4 + 2)], torchFrames: use[k] || [] });
  return {
    weapon: 'torch', id: '0x16', object: 'pool A type 0x18', spawnedAt: '0x24F6E (torch item init 0x24F4C)', handler: '0x29B06',
    link: '+0x5A = torch object, +0x58 = 0x203 (the torch class); the flame frees itself (0x29CAA -> 0x48D4) when the torch slot is empty, is no longer type 0 or its class changes',
    anims: {
      burning: { ...burning, note: 'normal flame: records 1408-1413, 4 frames each, loops (24-frame cycle)' },
      running: { ...running, note: 'flame blown back while the holder runs (+0x06 == 2): records 1414-1417, 4 frames each, loops; every frame has b4 = 1' },
    },
    animRule: 'held and the holder running: the running chain (started on the first running frame, from a frame with b4 == 0); otherwise the burning chain (restarted as soon as the current flame frame has b4 != 0, i.e. right after the run). On the ground or in flight: the burning chain. Both start at frame 0 when switched; the burning chain runs freely (its phase does not depend on the hero).',
    offsetTable: { at: '0x29C26', index: 'torch frame byte b5 / 4 (+0x2D, stored by the 10-byte driver from the current torch frame)', units: 'world: dx forward in the native left-facing art (negated when facing right), dy = height (up)', entries: offsets,
      note: 'entries 0-15: the 16 held rotations (torch anims 0-15, frame 0), 16-31: the fast spin (anim 16), 32: lying on the ground (anim 17)' },
    placement: 'flame origin = torch origin + (dx, -dy) in screen pixels (left-facing art), x mirrored when facing right. The torch origin is the hold placement (V23); so flame origin = feet + hold (dx, -dy) [+ torso bob] + flame (dx, -dy).',
    depth: 'torch depth + 2 on even frames of 0xFF8001, torch depth - 1 on odd frames (0x29B98): the flame is drawn behind the torch and the holder on one frame and in front of both on the next',
    drawn: 'flame +0x01 = torch +0x01 every frame: hidden whenever the torch is hidden (hold index < 0)',
    flags: '+0x25 = 0x30 (no wading splash; not split body); +0x24 copies the torch facing',
    palette: 'records 1408-1417 use OBJ palette 9 (fire), the same in every stage area',
  };
}
// flame placement for one held torch frame: torchFrame = the torch set frame shown (frame 0 of the pose-row anim)
function flameFor(fl, torchFrame) {
  const e = fl.offsetTable.entries[torchFrame.b5 >> 2];
  return e ? { index: e.index, offset: [e.dx, -e.dy] } : null;
}

// ------------------------------------------------------------------------------------------------ stage palettes
// The area start (0x8A44) loads the 32 OBJ palettes from the ROM rows listed at long[0x8E8E + stage*16 + area*4]
// (row k = 0xB7A52 + k*32). Hero and weapon records draw with the slot numbers in their block attributes.
// An area whose first script segment has camera trigger 0 is entered by a cut and loads its own rows; the others
// (E2 a1, E5 a1, E6 a2, E8 a3) are scrolled into by segment state 8 (0x20E78: area byte + 1 only) and keep the rows
// of the area before them (the stages export confirmed this live: work/re/extract/stages).
function stagePalettes() {
  const areas = [];
  for (let s = 0; s < 8; s++) {
    const segs = SR.script(s).segs;
    let prev = null;
    for (const a of SR.stageAreas(s)) {
      const first = segs.find(g => g.area === a), cut = !first || first.trigger === 0 || !prev;
      const pg = SR.palObjPage(s, a);
      const rows = cut ? pg.idx : prev.rows;
      const o = { episode: s + 1, area: a, list: hex(cut ? pg.list : parseInt(prev.list, 16)), rows, loaded: cut };
      if (!cut) o.note = `entered by scrolling (segment state 8, 0x20E78): keeps the rows of area ${prev.area}; the table entry ${hex(pg.list)} is not loaded`;
      areas.push(o); prev = o;
    }
  }
  const fixed = [], variable = [];
  for (let slot = 0; slot < 32; slot++) {
    const vals = [...new Set(areas.map(x => x.rows[slot]))];
    if (vals.length === 1 && vals[0] === slot) fixed.push(slot); else variable.push({ slot, rows: vals });
  }
  return { table: '0x8E8E', loader: '0x8A44 (area start)', rowAddress: 'row k at 0xB7A52 + k*32 (16 words, RGB444 in the low 12 bits; full brightness = n*17 per channel)', areas, fixedSlots: fixed, variableSlots: variable };
}
const rowRGB = k => { const out = []; for (let c = 0; c < 16; c++) { const w = u16(0xB7A52 + k * 32 + c * 2); out.push([((w >> 8) & 15) * 17, ((w >> 4) & 15) * 17, (w & 15) * 17]); } return out; };
const rowWords = k => Array.from({ length: 16 }, (_, c) => hex(u16(0xB7A52 + k * 32 + c * 2)));

// ------------------------------------------------------------------------------------------------ speech bubbles
// Two spawners in the player code allocate a pool-D object of type 0x14 (handler 0x92B7A) 0x60 above the hero:
//   0x6192 (victory pose, 0x199B4): subtype = byte [0x61E6 + id*4 + random bit] -> one of the hero's two lines
//   0x61F6 (team-up move, 0x68FC):  subtype = byte [0x6244 + id], +0x5C = 1
// Handler: anim = subtype in set 0x92BF0 (0x15E4), +0x24 = 0 (never mirrored), +0x25 = 0x10; it waits until the
// owner's frame byte b4 (+0x2C) is non-zero (or +0x5C is set), then shows its single 120-frame frame and frees itself
// (0x15F4 end -> 0x4964); also freed while 0xFF8518 is set.
function bubbles() {
  const set = 0x92BF0, anims = [];
  for (let k = 0; k < 12; k++) { const a = set + s16(set + k * 2), f = S.frame10(a); anims.push({ subtype: k, addr: hex(a), rec: f.rec, dur: f.dur }); }
  const TEXT = { 1593: "You can't touch this!", 1594: "Damn I'm Good!", 1595: "Let's go!", 1596: 'What a Wimp!', 1597: 'All Right!', 1598: 'Jump!', 1599: 'Bad to The Bone!', 1600: "I'm a Bad Mamba Jamma", 1601: "Let's roll!", 1602: "I'm just Too Cool!", 1603: 'Number One Baby!', 1604: "Let's fly!", 1605: 'Need a hand?', 1606: "They're gonna pay for this!", 1607: 'Look out!' };
  const perHero = [0, 1, 2, 3].map(c => {
    const v = [prg[0x61E6 + c * 4], prg[0x61E6 + c * 4 + 1]], t = prg[0x6244 + c];
    const rec = k => anims[k].rec;
    return { id: c, victory: v.map(k => ({ subtype: k, rec: rec(k), text: TEXT[rec(k)] })), teamUp: { subtype: t, rec: rec(t), text: TEXT[rec(t)] } };
  });
  return {
    object: 'pool D type 0x14', handler: '0x92B7A', set: hex(set), anims: anims.map(a => ({ ...a, text: TEXT[a.rec] })),
    spawners: { victory: { at: '0x6192 (called at 0x199B4 when the victory pose starts with +0xC0 set)', subtypeTable: '0x61E6 + id*4 + (random & 1)' }, teamUp: { at: '0x61F6 (team-up move, 0x68FC)', subtypeTable: '0x6244 + id', note: '+0x5C = 1: shown at once' } },
    placement: 'spawned at the hero\'s x, height + 0x60 (96 px above the feet), same depth; never mirrored (+0x24 = 0); the record\'s origin is the bubble\'s bottom-left anchor point (see the atlas ox/oy)',
    timing: 'appears on the first frame where the hero\'s current frame byte b4 is non-zero (victory pose) or at once (team-up); stays 120 frames, then is freed. Freed early while 0xFF8518 is set.',
    perHero, palette: 'each bubble uses its hero\'s OBJ palette (Jack 0, Hannah 1, Mustapha 2, Mess 3), the same in every area',
    others: { recs: [1605, 1606, 1607], note: 'the same bubble art also holds 1605 "Need a hand?" and 1606 "They\'re gonna pay for this!" (set 0x93C82, set by 0x93B44) and 1607 "Look out!"; they are not spawned by the hero code', text: { 1605: TEXT[1605], 1606: TEXT[1606], 1607: TEXT[1607] } },
    TEXT,
  };
}

// ------------------------------------------------------------------------------------------------ item placements
// Stage object lists (0xFBF4 at area start: controller 0xFF866C): list A = long [[0xFC2E + stage*4] + area*4], 14-byte
// entries read at 0xFC7A; list B = long [[0xFC4E + stage*4] + area*4], 16-byte entries read at 0xFD02 / 0xFDAE.
// Entry: +0 camera trigger (X, or Y while 0xFF84DC is set; 0x9FFF ends the list), +2 class word (low 3 bits = pool via
// 0xFD46: 0 B enemies, 1 C, 3 A items; bit 7 = command entry; list B bits 5-6 / 3-4 + high byte = player-count / rank
// conditions), +4 type, +6 x, +8 depth, +0xA subtype, +0xC height (list A). Only pool-A items are listed here.
const WEAPON_NAMES = { 0x0: 'RIFLE', 0x2: 'GUN', 0x4: 'KNIFE', 0x6: 'UZI', 0x8: 'M-16A1', 0xA: 'SHOT GUN', 0xC: 'BAZOOKA', 0xE: 'ROD', 0x10: 'STICK', 0x12: 'B. KNIFE', 0x14: 'CLUB', 0x16: 'TORCH', 0x18: 'DYNAMITE', 0x1A: 'GRENADE', 0x1C: 'STONE' };
const CONTAINER_NAMES = { 0x0: 'JERICAN', 0x2: 'DRAMCAN', 0x4: 'TARU', 0x6: 'CONKRIET', 0x8: 'IWA', 0xA: 'YOROI', 0xC: 'TIYA' };
function itemPlacements() {
  const out = [];
  for (let s = 0; s < 8; s++) for (const a of SR.stageAreas(s)) for (const [tbl, stride, list] of [[0xFC2E, 14, 'A'], [0xFC4E, 16, 'B']]) {
    const base = u32(tbl + s * 4), p0 = u32(base + a * 4); if (!p0 || p0 >= prg.length) continue;
    for (let k = 0, p = p0, last = 0; k < 200; k++, p += stride) {
      const trig = u16(p); if (trig === 0x9FFF || trig < last) break;    // lists are sorted by trigger; a drop means we ran past the end
      last = trig;
      const cls = u16(p + 2); if (cls & 0x80) continue;
      if ((cls & 7) !== 3) continue;
      const type = u16(p + 4), sub = u16(p + 0xA);
      const name = type === 0 ? WEAPON_NAMES[sub] : type === 0x14 ? CONTAINER_NAMES[sub] : null; if (!name) continue;
      out.push({ episode: s + 1, area: a, list, entry: hex(p), trigger: trig, kind: type === 0 ? 'weapon' : 'container', subtype: hex(sub), name, x: u16(p + 6), depth: u16(p + 8), condition: list === 'B' && (cls & 0x78) ? hex(cls) : undefined });
    }
  }
  return { code: '0xFBF4 (area start) / 0xFC7A (list A, 14-byte entries) / 0xFD02 (list B, 16-byte entries)', tables: { A: '0xFC2E', B: '0xFC4E' }, items: out, note: 'pool-A weapon (type 0) and container (type 0x14) entries of the stage object lists; enemies can also carry and drop weapons (e.g. the BUTCHER\'s B. KNIFE, pool B type 0xD0)' };
}

// ------------------------------------------------------------------------------------------------ extra records
// Records in each hero's palette that none of the six lists uses (ROM search of the record*4 word in frame-like data
// found no hero animation using them). Described from the art; kept so the sequel has the complete pose set.
const EXTRA = {
  jack: [[3190, 'upside down, legs up (thrown / swung by a grabber; same series as set5:8 record 3191)'], [3192, 'flying horizontally, arms forward (thrown)']],
  mustapha: [[268, 'standing, holding the handgun low (gun-set neighbour of 267/269)'], [277, 'standing, arm drawn back (swing wind-up, neighbour of the swing records 273-281)'], [278, 'lunging forward, leaning (swing / push)'], [1295, 'lying face down on the ground with a dark shadow pad (record outside his range, Mustapha palette)'], [3195, 'upside down (thrown / swung by a grabber; series of set5:8 record 3196)'], [3197, 'flying horizontally (thrown)']],
  hannah: [[1504, 'standing, one arm raised to the head (hurt / dizzy variant)'], [1506, 'falling backwards'], [3187, 'upside down (thrown / swung by a grabber; series of set5:8 record 3188)'], [3189, 'flying horizontally (thrown)']],
  mess: [[638, 'crouching, arms forward'], [640, 'squatting, both arms raised (lift)'], [641, 'squatting, both arms raised (lift, variant)'], [715, 'torso only: arms stretched forward (split-body torso)'], [726, 'standing, holding a long object forward (bazooka-type torso + legs)'], [730, 'torso only: punching forward'], [731, 'torso only: arm drawn back'], [732, 'torso only: arm stretched forward'], [733, 'torso only: crouched forward'], [734, 'torso only: leaning forward'], [767, 'diving / thrown forward'], [770, 'jumping, arms raised'], [3254, 'upside down (thrown / swung by a grabber; series of set5:8 record 3255)'], [3256, 'upside down, variant']],
};
function extraRecords() { return EXTRA; }

module.exports = { torchFlame, flameFor, stagePalettes, rowRGB, rowWords, bubbles, extraRecords, itemPlacements, chain10 };
