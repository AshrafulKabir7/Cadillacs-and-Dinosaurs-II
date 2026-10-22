// Static decode of the four heroes' animation data and the held-weapon tables (read-only on the ROM).
// Every table address comes from verified facts in tools/re/MEMORY-MAP.md (V13-V16, V19-V24) or from code read
// for this export (see heroes.json -> evidence).
'use strict';
const R = require('../../rom.cjs');
const { u16, s16, u32, prg } = R;
const hex = n => (n < 0 ? '-0x' + (-n).toString(16).toUpperCase() : '0x' + n.toString(16).toUpperCase());

const HEROES = ['Jack', 'Mustapha', 'Hannah', 'Mess'];          // character id order (V27)
const HERO_PAL = [0, 2, 1, 3];                                   // OBJ palette of each character id (MEMORY-MAP conventions)
const LISTS = [                                                  // V16 + the start entries at 0x13A0..0x13CC
  { key: 'main', list: 0x163E, entry: 0x13A0, legsEntry: 0x14C2 },
  { key: 'punch', list: 0x164E, entry: 0x13A8, legsEntry: 0x14CA },
  { key: 'set3', list: 0x165E, entry: 0x13B0, legsEntry: 0x14D2, note: 'entry 0x13B0 clears +0x25 (split body) first' },
  { key: 'set4', list: 0x166E, entry: 0x13BC, legsEntry: 0x14DA },
  { key: 'set5', list: 0x167E, entry: 0x13C4, legsEntry: 0x14E2 },
  { key: 'weapon', list: 0x168E, entry: 0x13CC, legsEntry: 0x14EA },
];
const FRAME = 12;

// One 12-byte hero frame (driver 0x143E): w0 rec*4 (bit 15 = composite), w1 2nd rec*4 (<0 none) or the composite
// part-list offset, b4 b5 b6 -> +0x2C..+0x2E, b7 = duration | 0x80 last, w8 -> +0x48, w10 -> +0x60 (high byte = hold).
function frameAt(a) {
  const w0 = u16(a), w1 = u16(a + 2), b7 = prg[a + 7], w10 = u16(a + 10);
  const f = { addr: hex(a) };
  if (w0 & 0x8000) {
    f.composite = true; f.rec = null; f.hitRec = (w0 & 0x7FFF) >> 2;
    const pl = a + 2 + s16(a + 2); f.partsAt = hex(pl);
    const n = u16(pl) + 1; f.parts = [];
    if (n > 0 && n < 16) for (let k = 0; k < n; k++) { const p = pl + 2 + k * 8; f.parts.push({ dx: s16(p), dy: s16(p + 2), rec: u16(p + 4) >> 2, flag: hex(u16(p + 6)) }); }
    f.rec2 = null;
  } else { f.rec = w0 >> 2; f.rec2 = (w1 & 0x8000) ? null : w1 >> 2; }
  f.b4 = prg[a + 4]; f.b5 = prg[a + 5]; f.b6 = prg[a + 6];
  f.dur = b7 & 0x7F; if (f.dur === 0) f.durNote = 'duration 0: the tick at 0x1426 decrements to 0xFF, so it holds 256 frames';
  f.last = !!(b7 & 0x80);
  f.w8 = hex(u16(a + 8)); f.w10 = hex(w10);
  const hb = w10 >> 8; f.hold = hb >= 0x80 ? hb - 0x100 : hb;     // signed: < 0 hides the weapon (V23)
  f.w10lo = w10 & 0xFF;
  return f;
}

// One animation: frames until the "last" flag, then the self-relative loop word (0x147A).
function animAt(start, maxFrames = 48, starts = null) {
  const frames = []; let a = start, loopTo = null, bad = null;
  for (let g = 0; g < maxFrames; g++) {
    if (a + FRAME > prg.length) { bad = 'ran past the ROM'; break; }
    // another animation starts inside this 12-byte slot: the data is misaligned from here on (no end flag)
    if (starts && g > 0) { const hit = starts.find(x => x > a && x < a + FRAME); if (hit != null) { bad = `no end flag: frame ${g} would overlap the animation that starts at ${hex(hit)} (the game would read misaligned data after frame ${g - 1})`; break; } }
    const f = frameAt(a); frames.push(f); a += FRAME;
    if (f.last) { loopTo = a + s16(a); break; }
  }
  if (loopTo == null && !bad) bad = `no end flag within ${maxFrames} frames`;
  return { start, frames, loopTo, bad };
}

function decodeList(L, c, starts) {
  const T = u32(L.list + c * 4), n = u16(T) >> 1, anims = [];
  for (let k = 0; k < n; k++) {
    const off = s16(T + k * 2);
    if (off <= 0) { anims.push({ index: k, terminator: true, note: `offset word ${off} (table end)` }); continue; }
    const an = animAt(T + off, 48, starts);
    anims.push({ index: k, addr: hex(T + off), frames: an.frames, loopTo: an.loopTo == null ? null : hex(an.loopTo), problem: an.bad || undefined });
  }
  return { list: hex(L.list), key: L.key, set: hex(T), entry: hex(L.entry), legsEntry: hex(L.legsEntry), note: L.note, count: anims.filter(a => !a.terminator).length, anims };
}

// frame address -> [{list, anim, frame}] over all lists of one hero (anims may share frames)
function frameIndex(lists) {
  const idx = new Map();
  for (const l of lists) for (const an of l.anims) if (!an.terminator) an.frames.forEach((f, i) => {
    const a = parseInt(f.addr, 16); if (!idx.has(a)) idx.set(a, []); idx.get(a).push({ list: l.key, anim: an.index, frame: i });
  });
  return idx;
}
function resolveLoops(lists, idx) {
  for (const l of lists) for (const an of l.anims) if (!an.terminator && an.loopTo) {
    const t = parseInt(an.loopTo, 16), own = an.frames.findIndex(f => parseInt(f.addr, 16) === t);
    if (own >= 0) an.loopFrame = own;
    else {
      an.loopFrame = null;
      const hits = (idx.get(t) || []);
      // prefer a target in the same list
      const h = hits.find(x => x.list === l.key) || hits[0];
      an.loopTarget = h ? { list: h.list, anim: h.anim, frame: h.frame } : { unknown: true, addr: an.loopTo };
    }
  }
}

// Stance / walk-torso by weapon class (V24): [0x5C36 + id*4] -> 12 words (class low byte), 0x8000 = plain idle.
function wordTable(a, n) { return Array.from({ length: n }, (_, k) => { const v = u16(a + k * 2); return v & 0x8000 ? null : v; }); }
function stance(c) {
  const sp = u32(0x5C36 + c * 4), wp = u32(0x5D2C + c * 4), bp = u32(0x5D1C + c * 4);
  return {
    standTable: hex(sp), standAnimByClassLow: wordTable(sp, 12),
    walkTorsoTable: hex(wp), walkTorsoAnimByClassLow: wordTable(wp, 12),
    bobTable: hex(bp), bob: Array.from({ length: 12 }, (_, k) => ({ index: k, dx: s16(bp + k * 4), dy: s16(bp + k * 4 + 2) })),
    // running with a weapon (0x1A0F0..0x1A15A, also 0x1A198 / 0x1A240 / 0x1A4A6): +0x38 = [0x1A164 + id*4] (8 entries),
    // legs = main anim 0x0B (0x18 while +0x07 == 4), torso = weapon-list anim byte [0x1A15C + id*2 + (class >= 0x205)]
    runBobTable: hex(u32(0x1A164 + c * 4)), runBob: Array.from({ length: 8 }, (_, k) => ({ index: k, dx: s16(u32(0x1A164 + c * 4) + k * 4), dy: s16(u32(0x1A164 + c * 4) + k * 4 + 2) })),
    runTorso: { table: '0x1A15C', blunt0x203: prg[0x1A15C + c * 2], gunsAtLeast0x205: prg[0x1A15D + c * 2], note: 'class >= 0x205 -> second byte; class 0x203 -> first byte (Jack: no split-body run with 0x203); classes 0x201/0x202 run with the plain run (0x1A174 path)' },
    runAttackThrowTorso: { table: '0x1A228', anim: u16(0x1A228 + c * 2), note: 'run + attack while holding a class 0x201/0x202 weapon (0x1A1EA): torso anim of the weapon list, legs main 0x0B' },
    smgWalkFireTorso: { table: '0x5FF2', uzi0x206: s16(u32(0x5FF2 + c * 4)), m16_0x207: s16(u32(0x5FF2 + c * 4) + 2), note: '0x5FB6: firing an Uzi/M16 while walking keeps the split body; torso anim from this table, bob table 0x5D1C' },
    note: 'index = class low byte (0x201 -> 1 ... 0x20A -> 10); null (0x8000) = main anim 0 (plain idle) / main anim 1 (plain walk). Walking with a weapon: torso = weapon-set anim from walkTorso, legs = main anim 0x10 via 0x1506, +0x25 = 1, +0x38 = bob table (0x5CA6).',
  };
}

// Held-weapon hold offsets (V23): [0x122230 + id*4] -> s16 (dx, dy) per hold index.
function holdTable(c, n) {
  const hb = u32(0x122230 + c * 4);
  return { table: hex(hb), entries: Array.from({ length: n }, (_, h) => ({ hold: h, dx: s16(hb + h * 4), dy: s16(hb + h * 4 + 2) })) };
}
// Pose rows: [0x120A20 + id*4] -> 16 longs (pose slot) -> s8 weapon anim per hold index.
function poseRows(c, n) {
  const pb = u32(0x120A20 + c * 4), rows = [];
  for (let slot = 0; slot < 16; slot++) {
    const row = u32(pb + slot * 4);
    rows.push({ slot, row: hex(row), anims: Array.from({ length: n }, (_, h) => { const b = prg[row + h]; return b >= 0x80 ? b - 0x100 : b; }) });
  }
  return { table: hex(pb), rows };
}

// Weapons (V19-V22): id -> init values; the held handler switch at 0x251C8 (index +0x26).
const WEAPONS = [
  // id, key, HUD name, class, ammo, poseSlot, anim set (+0x40), init code
  [0x00, 'rifle', 'RIFLE', 0x205, 6, 1, 0x265F4, 0x24D8A], [0x02, 'gun', 'GUN', 0x204, 6, 0, 0x268BC, 0x24DB0],
  [0x04, 'knife', 'KNIFE', 0x202, 6, 3, 0x26A3C, 0x24DF0], [0x06, 'uzi', 'UZI', 0x206, 48, 4, 0x26BBC, 0x24E1C],
  [0x08, 'm16', 'M-16A1', 0x207, 48, 5, 0x26D3C, 0x24E46], [0x0A, 'shotgun', 'SHOT GUN', 0x208, 6, 7, 0x26F7E, 0x24E70],
  [0x0C, 'bazooka', 'BAZOOKA', 0x209, 4, 8, 0x270FE, 0x24E96], [0x0E, 'rod', 'ROD', 0x203, 10, 9, 0x2727E, 0x24EBC],
  [0x10, 'stick', 'STICK', 0x202, 6, 10, 0x273FE, 0x24EDA], [0x12, 'bknife', 'B. KNIFE', 0x203, 6, 11, 0x2757E, 0x24F00],
  [0x14, 'club', 'CLUB', 0x203, 10, 12, 0x276FE, 0x24F26], [0x16, 'torch', 'TORCH', 0x203, 10, 12, 0x276FE, 0x24F4C],
  [0x18, 'dynamite', 'DYNAMITE', 0x201, 10, 13, 0x2787E, 0x24FAA], [0x1A, 'grenade', 'GRENADE', 0x201, 10, 14, 0x27B12, 0x25002],
  [0x1C, 'stone', 'STONE', 0x201, 10, 14, 0x27CD2, 0x25020],
].map(([id, key, name, cls, ammo, slot, set, init]) => ({ id, key, name, cls, ammo, slot, set, init }));

// 10-byte frames (driver 0x120E/0x121E/0x1236)
function frame10(a) {
  const w0 = u16(a), w1 = u16(a + 2), b7 = prg[a + 7];
  const f = { addr: hex(a) };
  if (w0 & 0x8000) {
    f.composite = true; f.rec = null; f.hitRec = (w0 & 0x7FFF) >> 2; const pl = a + 2 + s16(a + 2); f.partsAt = hex(pl);
    const n = u16(pl) + 1; f.parts = []; if (n > 0 && n < 16) for (let k = 0; k < n; k++) { const p = pl + 2 + k * 8; f.parts.push({ dx: s16(p), dy: s16(p + 2), rec: u16(p + 4) >> 2, flag: hex(u16(p + 6)) }); }
    f.rec2 = null;
  } else { f.rec = w0 >> 2; f.rec2 = (w1 & 0x8000) ? null : w1 >> 2; }
  f.b4 = prg[a + 4]; f.b5 = prg[a + 5]; f.b6 = prg[a + 6]; f.dur = b7 & 0x7F; f.last = !!(b7 & 0x80); f.w8 = hex(u16(a + 8));
  return f;
}
function set10(T, maxAnims = 64) {
  let n = u16(T) >> 1; for (let k = 0; k < n && k < 512; k++) { const o = s16(T + k * 2); if (o > 0 && (o >> 1) < n) n = o >> 1; }
  n = Math.min(n, maxAnims);
  const anims = [];
  for (let k = 0; k < n; k++) {
    const off = s16(T + k * 2); if (off <= 0) { anims.push({ index: k, terminator: true }); continue; }
    const frames = []; let a = T + off, loopTo = null;
    for (let g = 0; g < 48; g++) { const f = frame10(a); frames.push(f); a += 10; if (f.last) { loopTo = a + s16(a); break; } }
    const lf = loopTo == null ? null : frames.findIndex(f => parseInt(f.addr, 16) === loopTo);
    anims.push({ index: k, addr: hex(T + off), frames, loopTo: loopTo == null ? null : hex(loopTo), loopFrame: lf != null && lf >= 0 ? lf : null, problem: loopTo == null ? 'no end flag within 48 frames' : undefined });
  }
  return { set: hex(T), frameSize: 10, count: anims.length, anims };
}

function decodeAll() {
  const heroes = HEROES.map((name, c) => {
    const starts = [];
    for (const L of LISTS) { const T = u32(L.list + c * 4), n = u16(T) >> 1; for (let k = 0; k < n; k++) { const o = s16(T + k * 2); if (o > 0) starts.push(T + o); } }
    const lists = LISTS.map(L => decodeList(L, c, starts));
    const idx = frameIndex(lists); resolveLoops(lists, idx);
    let maxHold = 0; for (const l of lists) for (const an of l.anims) if (!an.terminator) for (const f of an.frames) if (f.hold > maxHold && !an.problem) maxHold = f.hold;
    const n = maxHold + 1;
    return { id: c, name, palette: HERO_PAL[c], lists, frameIndex: idx, stance: stance(c), holds: holdTable(c, n), poseRows: poseRows(c, n), holdCount: n };
  });
  const weapons = WEAPONS.map(w => ({ ...w, anims: set10(w.set) }));
  return { heroes, weapons };
}

module.exports = { HEROES, HERO_PAL, LISTS, WEAPONS, decodeAll, frameAt, animAt, set10, frame10, hex };
