// Static extraction of the original game's object / animation / held-weapon data (read-only on the ROM).
// node tools/re/static-extract.cjs   -> writes JSON tables to work/re/static/
// Every table address below was found by reading the 68000 code (see work/re/static/REPORT.md for the code paths
// and the REA evidence ids); this script only decodes the data those routines read.
const fs = require('fs'), path = require('path');
const R = require('./rom.cjs');
const OUT = path.join(__dirname, '../../work/re/static');
fs.mkdirSync(OUT, { recursive: true });
const hex = n => '0x' + n.toString(16).toUpperCase();
const { u16, s16, u32, prg } = R;

// ---------------------------------------------------------------- animation sets
// Word-offset table: entry k = signed offset (from the table start) to anim k's first frame.
// Frame (10 or 12 bytes): w0 rec*4 (bit15: composite, low 15 bits = hit record), w1 second rec*4 (<0 none) or,
// for composites, a self-relative offset to the part list; b4 b5 b6 -> obj+0x2C..0x2E; b7 duration (bit7 = last
// frame, then a signed loop offset word follows); w8 -> obj+0x48; w10 (12-byte frames only) -> obj+0x60.
function animCount(T) {
  let n = u16(T) >> 1;
  for (let k = 0; k < n && k < 512; k++) { const o = s16(T + k * 2); if (o > 0 && (o >> 1) < n) n = o >> 1; }
  return Math.min(n, 512);
}
function decodeParts(addr) {
  const n = u16(addr) + 1, parts = []; let a = addr + 2;
  for (let k = 0; k < n && k < 32; k++) { parts.push({ dx: s16(a), dy: s16(a + 2), rec: u16(a + 4) >> 2, flag: u16(a + 6) }); a += 8; }
  return parts;
}
function decodeFrame(a, size) {
  const w0 = u16(a), w1 = u16(a + 2), b7 = prg[a + 7];
  const f = { addr: hex(a) };
  if (w0 & 0x8000) { f.composite = true; f.hitRec = (w0 & 0x7fff) >> 2; f.parts = decodeParts(a + 2 + s16(a + 2)); }
  else { f.rec = w0 >> 2; if (!(w1 & 0x8000)) f.rec2 = w1 >> 2; }
  f.b4 = prg[a + 4]; f.b5 = prg[a + 5]; f.b6 = prg[a + 6]; f.dur = b7 & 0x7f; if (b7 & 0x80) f.last = true;
  f.w8 = u16(a + 8);
  if (size >= 12) { const w10 = u16(a + 10); f.hold = w10 >> 8; f.w10lo = w10 & 0xff; }
  return f;
}
function decodeSet(T, size = 10) {
  const n = animCount(T), anims = [];
  for (let k = 0; k < n; k++) {
    const off = s16(T + k * 2); if (off <= 0) { anims.push({ index: k, invalid: true }); continue; }
    let a = T + off; const frames = []; let loopTo = null;
    for (let g = 0; g < 64 && a + size <= prg.length; g++) {
      const f = decodeFrame(a, size); frames.push(f); a += size;
      if (f.last) { loopTo = a + s16(a); break; }
    }
    const firstAddr = T + off;
    anims.push({ index: k, addr: hex(firstAddr), frames, loopTo: loopTo == null ? null : hex(loopTo), loopFrame: loopTo == null ? null : Math.round((loopTo - firstAddr) / size) });
  }
  return { table: hex(T), frameSize: size, count: n, anims };
}

// ---------------------------------------------------------------- heroes
// Object char id ((0x20)/4 and (0x03)) order, proven by the record ranges in each table and by the
// measured weapon placements (Mustapha = 1): Jack, Mustapha, Hannah, Mess.
const CHARS = ['Jack', 'Mustapha', 'Hannah', 'Mess'];
const HERO_TABLES = [ // per-character pointer lists used by the set-animation entry points at 0x13A0..0x13CC / 0x14C2..0x14EA
  { list: 0x163E, entry: '0x13A0 / 0x14C2', note: 'main set (idle, walk, run, punches, jump, hurt, ...)' },
  { list: 0x164E, entry: '0x13A8 / 0x14CA', note: 'set 2' },
  { list: 0x165E, entry: '0x13B0 (clears 0x25) / 0x14D2', note: 'set 3' },
  { list: 0x166E, entry: '0x13BC / 0x14DA', note: 'set 4' },
  { list: 0x167E, entry: '0x13C4 / 0x14E2', note: 'set 5' },
  { list: 0x168E, entry: '0x13CC / 0x14EA', note: 'weapon set (stances / firing / torsos used while holding weapons)' },
];
const heroAnims = { chars: CHARS, frameSize: 12, sets: [] };
for (const t of HERO_TABLES) {
  const per = CHARS.map((name, c) => { const T = u32(t.list + c * 4); return { char: name, ...decodeSet(T, 12) }; });
  heroAnims.sets.push({ list: hex(t.list), entry: t.entry, note: t.note, perChar: per });
}
fs.writeFileSync(path.join(OUT, 'hero-anims.json'), JSON.stringify(heroAnims, null, 1));

// ---------------------------------------------------------------- weapon items
// Item spawn subtype (obj+0x26) -> init case in the switch at 0x24D60 (jump table 0x24D6C).
const ITEM_NAMES = { 0x00: 'RIFLE', 0x02: 'REVOLVER (GUN)', 0x04: 'KNIFE', 0x06: 'SMG (UZI)', 0x08: 'M16', 0x0A: 'SHOTGUN', 0x0C: 'BAZOOKA', 0x0E: 'KAKUZAI (lumber/ROD)', 0x10: 'STICK (inferred, no debug entry)', 0x12: 'B. KNIFE', 0x14: 'KONBOU (club)', 0x16: 'TAIMATSU (torch)', 0x18: 'DYNAMITE', 0x1A: 'SYURYUUDAN (grenade)', 0x1C: 'STONE (inferred)' };
// values read straight from the immediates in each init case (see evidence 21-weapon-item-init)
const ITEMS = [
  [0x00, 0x24D8A, 0x265F4, 0x0205, 0x04, 6], [0x02, 0x24DB0, 0x268BC, 0x0204, 0x00, 6], [0x04, 0x24DF0, 0x26A3C, 0x0202, 0x0C, 6],
  [0x06, 0x24E1C, 0x26BBC, 0x0206, 0x10, 48], [0x08, 0x24E46, 0x26D3C, 0x0207, 0x14, 48], [0x0A, 0x24E70, 0x26F7E, 0x0208, 0x1C, 6],
  [0x0C, 0x24E96, 0x270FE, 0x0209, 0x20, 4], [0x0E, 0x24EBC, 0x2727E, 0x0203, 0x24, 10], [0x10, 0x24EDA, 0x273FE, 0x0202, 0x28, 6],
  [0x12, 0x24F00, 0x2757E, 0x0203, 0x2C, 6], [0x14, 0x24F26, 0x276FE, 0x0203, 0x30, 10], [0x16, 0x24F4C, 0x276FE, 0x0203, 0x30, 10],
  [0x18, 0x24FAA, 0x2787E, 0x0201, 0x34, 10], [0x1A, 0x25002, 0x27B12, 0x0201, 0x38, 10], [0x1C, 0x25020, 0x27CD2, 0x0201, 0x38, 10],
];
const CLASS_NAMES = { 0x0201: 'throwable', 0x0202: 'blade', 0x0203: 'blunt (also an emptied gun)', 0x0204: 'pistol', 0x0205: 'rifle', 0x0206: 'smg', 0x0207: 'm16', 0x0208: 'shotgun', 0x0209: 'bazooka' };
const weaponItems = ITEMS.map(([sub, code, set, cls, a2, ammo]) => {
  const s = decodeSet(set, 10);
  const first = k => (s.anims[k] && s.anims[k].frames && s.anims[k].frames[0]) ? s.anims[k].frames[0].rec : null;
  return {
    subtype: hex(sub), name: ITEM_NAMES[sub], initCode: hex(code), animSet: hex(set), class: hex(cls), className: CLASS_NAMES[cls],
    poseSlot: a2 >> 2, poseSlotByteOffset: hex(a2), ammoOrUses: ammo,
    animCount: s.count,
    rotationRecords: Array.from({ length: 16 }, (_, k) => first(k)), // anims 0..15 start at rotation k (shown frozen while held)
    groundRecord: first(17),
    extraAnims: s.anims.slice(18).filter(a => !a.invalid).map(a => ({ index: a.index, firstRec: a.frames[0].rec != null ? a.frames[0].rec : 'C' + a.frames[0].hitRec, frames: a.frames.length })),
  };
});

// ---------------------------------------------------------------- held-weapon placement
// Routine 0x24A9A (A0 = holder, A6 = weapon object):
//   hold = holder.b[0x60] (<0: weapon hidden); (dx,dy) = s16 pair at [0x122230 + char*4] + hold*4
//   weapon.x = holder.x + (holder.facing ? -dx : dx) (+/- holder 0x3C when holder.0x25 bit0)
//   weapon.h(0x0C) = holder.h + dy (+ holder 0x3E when split body); weapon.0x10 = holder.0x10; weapon.facing = holder.facing
//   anim = byte [[0x120A20 + char*4] + weapon.0xA2] [hold] (<0: hidden) -> jsr 0x120E (frame 0 of that anim, every frame)
const HOLD_LEN = [90, 80, 85, 96];
const slotToItems = {}; for (const w of weaponItems) (slotToItems[w.poseSlot] = slotToItems[w.poseSlot] || []).push(w);
const setCache = {}; const setOf = a => setCache[a] || (setCache[a] = decodeSet(a, 10));
function tight(rec) {
  const im = R.render(R.parseRecord(rec), { dropShadows: false }); if (!im) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.pixels[y * im.w + x] !== 15) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0 - im.ox, y: y0 - im.oy, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const holds = { routine: '0x24A9A', holdOffsetTable: '0x122230', poseTable: '0x120A20', convention: 'native ROM art faces left (holder.facing byte 0x24 == 0); x right-positive, y up-positive in world units == screen pixels; topLeft is screen-space (y down) relative to the holder feet; mirror for facing right: x\' = -(x + w)', chars: [] };
for (let c = 0; c < 4; c++) {
  const hb = u32(0x122230 + c * 4), pb = u32(0x120A20 + c * 4);
  const ch = { char: CHARS[c], holdTable: hex(hb), poseList: hex(pb), entries: [] };
  for (let h = 0; h < HOLD_LEN[c]; h++) {
    const dx = s16(hb + h * 4), dy = s16(hb + h * 4 + 2), e = { hold: h, holdHex: hex(h), dx, dy, weapons: {} };
    for (let slot = 0; slot < 16; slot++) {
      const b = prg[u32(pb + slot * 4) + h]; if (b > 127) continue;
      const items = slotToItems[slot]; if (!items) { e.weapons['slot' + slot] = { anim: b, note: 'slot not used by any weapon item' }; continue; }
      const it = items[0], s = setOf(parseInt(it.animSet, 16)), an = s.anims[b];
      const rec = an && an.frames && an.frames[0] ? an.frames[0].rec : null, t = rec != null ? tight(rec) : null;
      e.weapons[it.name] = { slot, anim: b, rec, anchor: [dx, -dy], topLeft: t ? [dx + t.x, -dy + t.y] : null, size: t ? [t.w, t.h] : null, sharedWith: items.slice(1).map(i => i.name) };
    }
    ch.entries.push(e);
  }
  holds.chars.push(ch);
}
// Which hero frames carry which hold index (12-byte frames, high byte of w10)
const framesByHold = CHARS.map(() => ({}));
for (const set of heroAnims.sets) set.perChar.forEach((pc, c) => pc.anims.forEach(an => (an.frames || []).forEach((f, fi) => {
  if (!f.hold) return; const key = f.hold;
  (framesByHold[c][key] = framesByHold[c][key] || []).push({ set: set.list, anim: an.index, frame: fi, rec: f.rec != null ? f.rec : 'C' + f.hitRec, rec2: f.rec2 }); })));
holds.chars.forEach((ch, c) => ch.entries.forEach(e => { e.heroFrames = framesByHold[c][e.hold] || []; }));
fs.writeFileSync(path.join(OUT, 'weapon-holds.json'), JSON.stringify(holds, null, 1));

// Hero idle/walk selection by weapon class (0x5BDC / 0x5CA6): per-char word tables indexed by class low byte (0..11)
function wordTable(a, n) { return Array.from({ length: n }, (_, k) => { const v = u16(a + k * 2); return v & 0x8000 ? null : v; }); }
const stance = CHARS.map((name, c) => ({ char: name, standAnimIn0x168E: wordTable(u32(0x5C36 + c * 4), 12), walkTorsoAnimIn0x168E: wordTable(u32(0x5D2C + c * 4), 12),
  torsoBobTable: hex(u32(0x5D1C + c * 4)), torsoBob: Array.from({ length: 12 }, (_, k) => [s16(u32(0x5D1C + c * 4) + k * 4), s16(u32(0x5D1C + c * 4) + k * 4 + 2)]) }));
fs.writeFileSync(path.join(OUT, 'weapon-items.json'), JSON.stringify({ switch: '0x24D60 (jump table 0x24D6C, index obj+0x26)', classNames: CLASS_NAMES, items: weaponItems, heroStanceByClass: { standTable: '0x5C36', walkTable: '0x5D2C', bobTable: '0x5D1C', classIndex: 'low byte of holder 0xB6 (= weapon 0xA0)', perChar: stance } }, null, 1));

// ---------------------------------------------------------------- object types (debug spawn list + dispatch tables)
const POOLS = {
  0: { allocator: '0x483C', pool: 'B', base: '0xFFC8F4', slots: 24, stride: 0xE0, runLoop: '0x23420', dispatch: 0x2346C, dispatchLen: 102 },
  1: { allocator: '0x4860', pool: 'C', base: '0xFFB6F4', slots: 24, stride: 0xC0, runLoop: '0x23604', dispatch: 0x2362E, dispatchLen: 97 },
  3: { allocator: '0x4818', pool: 'A', base: '0xFF8874', slots: 24, stride: 0xC0, runLoop: '0x233C6', dispatch: 0x233F0, dispatchLen: 12 },
  // not reachable from the debug spawn list; effects / shots (e.g. type 0x84 muzzle object from 0x96B40, type 0x30 from 0x939B6)
  D: { allocator: '0x4884', pool: 'D', base: '0xFF9A74', slots: 48, stride: 0x80, runLoop: '0x237B2', dispatch: 0x237E6, dispatchLen: 42 },
};
const dispatch = {};
for (const [cls, p] of Object.entries(POOLS)) dispatch[cls] = Array.from({ length: p.dispatchLen }, (_, k) => u32(p.dispatch + k * 4));
const spawn = []; let a = 0x88DDA;
for (let k = 0; k < 200; k++) {
  const name = prg.toString('latin1', a, a + 16); if (!/^[ -~]{16}$/.test(name)) break;
  const cls = u16(a + 16), type = u16(a + 18), sub = u16(a + 20), w3 = u16(a + 22), w4 = u16(a + 24);
  const pool = POOLS[cls & 7]; const handler = pool && dispatch[cls & 7][type >> 2];
  spawn.push({ index: k, addr: hex(a), name: name.trim(), class: cls, pool: pool ? pool.pool : null, type: hex(type), typeIndex: type >> 2, subtype0x26: hex(sub), w0x5C: hex(w3), b0x96: w4 & 0xff, handler: handler != null ? hex(handler) : null });
  a += 26;
}
const pools = Object.fromEntries(Object.entries(POOLS).map(([cls, p]) => [cls, { ...p, dispatch: hex(p.dispatch), stride: hex(p.stride), handlers: dispatch[cls].map((h, i) => ({ typeIndex: i, type: hex(i * 4), handler: h ? hex(h) : null, debugNames: spawn.filter(s => s.class === +cls && s.typeIndex === i).map(s => s.name) })) }]));
fs.writeFileSync(path.join(OUT, 'object-types.json'), JSON.stringify({ spawnList: '0x88DDA (26-byte entries: 16-char name, w class, w type(=obj+0x20), w subtype(=obj+0x26), w ->obj+0x5C, w low byte ->obj+0x96)', spawner: '0x88D76', pools, otherPools: { E: { allocator: '0x48A8', base: '0xFFDDF4', slots: 16, stride: '0x80' }, players: { base: '0xFFB274', slots: 3, stride: '0x180', loop: '0x6714' } }, spawn }, null, 1));

// ---------------------------------------------------------------- one enemy: Chinpira (type 0x08, handler 0x3383A)
const chin = [['A', 0x34892, 0x00, 0x00], ['B', 0x34B90, 0x01, 0x04], ['C', 0x34E7C, 0x1A, 0x68]].map(([v, set, b3, w84]) => ({ variant: v, obj0x03: b3, obj0x84: w84, ...decodeSet(set, 10) }));
fs.writeFileSync(path.join(OUT, 'enemy-chinpira-anims.json'), JSON.stringify({ handler: '0x3383A', initSwitch: '0x3386C (by obj+0x26)', variants: chin }, null, 1));

// ---------------------------------------------------------------- select-screen stat bars (0xB3F8 reads 3 bytes per character at 0xB444)
const SEL = ['JACK.T', 'HANNAH.D', 'MUSTAPHA.C', 'MESS.O'];
const stats = SEL.map((n, i) => ({ select: i, name: n, power: prg[0xB444 + i * 3], speed: prg[0xB444 + i * 3 + 1], skill: prg[0xB444 + i * 3 + 2] }));
fs.writeFileSync(path.join(OUT, 'hero-stats.json'), JSON.stringify({ table: '0xB444', reader: '0xB3F8', units: 'filled boxes out of 5 on the select screen', stats }, null, 1));

// ---------------------------------------------------------------- hero attack table (damage applied at 0x10A34..0x10A6C)
// A4 = [0xA26FC + attacker.0x20] + attacker.b[0x58]*4; victim.HP(0x6C) -= byte0 (after modifier 0x2B904); victim.0x78 -= byte1 ...
const dmg = CHARS.map((name, c) => { const base = u32(0xA26FC + c * 4); return { char: name, table: hex(base), entries: Array.from({ length: 120 }, (_, k) => ({ attackId: hex(k), damage: prg[base + k * 4], b1: prg[base + k * 4 + 1], b2: prg[base + k * 4 + 2], b3: prg[base + k * 4 + 3] })) }; });
fs.writeFileSync(path.join(OUT, 'hero-damage.json'), JSON.stringify({ pointerTable: '0xA26FC', user: '0x10A34 (index attacker 0x20, attack id attacker 0x58)', modifier: '0x2B904', byte1: 'subtracted from victim 0x78 (inferred stun/knockdown meter)', perChar: dmg }, null, 1));

console.log('hero sets', heroAnims.sets.map(s => s.perChar.map(p => p.count).join('/')).join(' '));
console.log('weapon items', weaponItems.length, 'spawn entries', spawn.length);
for (const [name, c, h, w] of [['rifle stance 259', 1, 0x34, 'RIFLE'], ['shotgun stance 261', 1, 0x3A, 'SHOTGUN'], ['uzi stance 270+269', 1, 0x38, 'SMG (UZI)'], ['knife idle 171', 1, 0x40, 'KNIFE'], ['M16 265', 1, 0x36, 'M16'], ['bazooka 262', 1, 0x3B, 'BAZOOKA']]) {
  const e = holds.chars[c].entries[h].weapons[w]; console.log(name.padEnd(20), JSON.stringify(e));
}

// ---------------------------------------------------------------- every animation set (debug animation viewer list)
// The viewer at 0xAAF90 indexes 0xB7472 with 8-byte entries: l anim-set pointer, w driver (0 -> 0x143E 12-byte frames,
// 4 -> 0x1236 10-byte frames, 8 -> 0x16C6 8-byte frames; table 0xAB440), w group. A null pointer ends the list.
{
  const typesJ = JSON.parse(fs.readFileSync(path.join(OUT, 'object-types.json'), 'utf8'));
  const owners = [];
  for (const [cls, p] of Object.entries(typesJ.pools)) for (const h of p.handlers) if (h.handler) owners.push({ addr: parseInt(h.handler, 16), label: `pool ${p.pool} type ${h.type}` + (h.debugNames.length ? ' ' + h.debugNames.join(' | ') : '') });
  owners.sort((x, y) => x.addr - y.addr);
  const refsTo = v => { const out = []; for (let i = 0; i < 0x100000; i += 2) if (u32(i) === v) out.push(i); return out; };
  const sets = [];
  for (let k = 0, a = 0xB7472; u32(a); k++, a += 8) {
    const ptr = u32(a), driver = u16(a + 4), group = u16(a + 6), size = driver === 0 ? 12 : driver === 4 ? 10 : 8;
    let first = null, count = null;
    try { const s = decodeSet(ptr, size); count = s.count; const f = s.anims.find(x => !x.invalid && x.frames.length); first = f ? (f.frames[0].rec != null ? f.frames[0].rec : 'C' + f.frames[0].hitRec) : null; } catch (e) { }
    const refs = refsTo(ptr).filter(r => r < 0xB7000 || r > 0xB7B00);
    // Attribution = nearest preceding type handler (an inference: a ref may sit in a shared routine after it).
    // 0x2E68C / 0x2E724 are two 38-entry long tables of per-enemy reaction sets indexed by obj+0x84 (code 0x2B41A, 0x2B4A2, 0x326D6, 0x4A6BE, 0x4A746).
    const own = refs.map(r => {
      if (r >= 0x2E68C && r < 0x2E724) return `${hex(r)} = reaction table A 0x2E68C[${(r - 0x2E68C) >> 2}] (index obj+0x84/4)`;
      if (r >= 0x2E724 && r < 0x2E7BC) return `${hex(r)} = reaction table B 0x2E724[${(r - 0x2E724) >> 2}] (index obj+0x84/4)`;
      let o = null; for (const w of owners) if (w.addr <= r) o = w; return o ? `${hex(r)} near ${o.label} (handler ${hex(o.addr)})` : hex(r);
    });
    sets.push({ index: k, set: hex(ptr), driver, frameSize: size, group, anims: count, firstRecord: first, codeRefs: own });
  }
  fs.writeFileSync(path.join(OUT, 'anim-sets.json'), JSON.stringify({ table: '0xB7472', viewer: '0xAAF90', drivers: { 0: '0x143E (12-byte frames)', 4: '0x1236 (10-byte frames)', 8: '0x16C6 (8-byte frames)' }, sets }, null, 1));
  console.log('anim sets', sets.length);
}
