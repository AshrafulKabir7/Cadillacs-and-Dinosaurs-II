// Build the static part of heroes.json (animations, legs/bob, stance tables, hold tables, pose rows, weapon sets,
// hold placements). Everything here is decoded from the ROM; the live labels / validation / firing are merged later.
'use strict';
const S = require('./hero-static.cjs');
const D = require('./draw.cjs');
const { hex } = S;
const R = require('../../rom.cjs');

const KEYS = ['jack', 'mustapha', 'hannah', 'mess'];
const CONTAINERS = [[0x0, 'jerrycan', 'JERICAN', 0x2995E], [0x2, 'drum', 'DRAMCAN', 0x2998C], [0x4, 'barrel', 'TARU', 0x299FE], [0x6, 'concrete', 'CONKRIET', 0x29A66], [0x8, 'rock', 'IWA', 0x29A86], [0xA, 'armor', 'YOROI', 0x29AA6], [0xC, 'tire', 'TIYA', 0x29AC8]];

// compact frame for export
function outFrame(f, size) {
  const o = { addr: f.addr };
  if (f.composite) { o.rec = null; o.rec2 = null; o.parts = f.parts.map(p => ({ rec: p.rec, dx: p.dx, dy: p.dy, flag: p.flag })); o.hitRec = f.hitRec; }
  else { o.rec = f.rec; o.rec2 = f.rec2; }
  o.dur = f.dur; if (f.durNote) o.durNote = f.durNote;
  if (f.last) o.last = true;
  if (size === 12) { o.hold = f.hold; o.w10 = f.w10; }
  o.b4 = f.b4; o.b5 = f.b5; o.b6 = f.b6; o.w8 = f.w8;
  return o;
}
function outAnim(an, size, setAddr, list) {
  if (an.terminator) return { index: an.index, terminator: true, note: an.note };
  const o = { index: an.index, set: setAddr, list, addr: an.addr, frames: an.frames.map(f => outFrame(f, size)) };
  o.loopTo = an.loopTo;
  if (an.loopFrame != null) o.loopFrame = an.loopFrame;
  if (an.loopTarget) o.loopTarget = an.loopTarget;
  if (an.problem) o.problem = an.problem;
  o.length = an.frames.reduce((a, f) => a + (f.dur || 256), 0);
  return o;
}

// weapon "variants": what a held weapon object can be (V19-V22, R2): pose slot + animation set
function weaponVariants(weapons) {
  const by = k => weapons.find(w => w.key === k);
  const v = [];
  for (const w of weapons) v.push({ key: w.key, weapon: w.key, name: w.name, slot: w.slot, set: hex(w.set), cls: hex(w.cls) });
  v.push({ key: 'rifle-empty', weapon: 'rifle', name: 'RIFLE (out of ammo, swung as a club)', slot: 2, set: hex(by('rifle').set), cls: '0x203', note: 'R2: the last shot sets class 0x203 and pose slot 2 (0x25232)' });
  v.push({ key: 'm16-empty', weapon: 'm16', name: 'M-16A1 (out of ammo, swung as a club)', slot: 6, set: hex(by('m16').set), cls: '0x203', note: 'R2: class 0x203, pose slot 6 (0x256DC)' });
  v.push({ key: 'stone-b', weapon: 'stone', name: 'STONE (variant +0x5C = 1)', slot: 14, set: '0x27D1A', cls: '0x201', note: 'item init 0x25020: +0x5C selects the set 0x27CD2 / 0x27D1A / 0x27D62' });
  v.push({ key: 'stone-c', weapon: 'stone', name: 'STONE (variant +0x5C >= 2)', slot: 14, set: '0x27D62', cls: '0x201', note: 'item init 0x25020' });
  // carried containers: pool A type 0x14 items (handler 0x28C76, init switch 0x28C96 by subtype), class 0x20A, pose slot 15
  // only subtypes 0-8 are carried: the attack table 0x5EDE has container entries for them alone, and live (runs
  // ex-heroes-cont3-*) YOROI (0xA) and TIYA (0xC) were broken by the attack + direction that lifts the others
  for (const [sub, key, name, set] of CONTAINERS) if (sub <= 8) v.push({ key: 'container-' + key, weapon: null, name, slot: 15, set: hex(set), cls: '0x20A', subtype: hex(sub), note: 'carried container (ITEM ' + name + '), init 0x28C96' });
  return v;
}

// record + second record of a 10-byte weapon frame -> tight box relative to the origin (native left-facing)
function frameBox(f) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const add = (rec, dx = 0, dy = 0) => { const im = D.recImg(rec); if (!im) return; const t = D.tightBox(im); if (!t) return; x0 = Math.min(x0, t.x + dx); y0 = Math.min(y0, t.y - dy); x1 = Math.max(x1, t.x + dx + t.w); y1 = Math.max(y1, t.y - dy + t.h); };
  if (f.composite) for (const p of f.parts) add(p.rec, p.dx, p.dy); else { if (f.rec != null) add(f.rec); if (f.rec2 != null) add(f.rec2); }
  return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function build() {
  const A = S.decodeAll();
  const weaponSets = {};
  const setAddrs = new Set(A.weapons.map(w => w.set)); [0x27D1A, 0x27D62].forEach(a => setAddrs.add(a)); CONTAINERS.forEach(c => setAddrs.add(c[3]));
  for (const a of [...setAddrs].sort((x, y) => x - y)) {
    const s = S.set10(a);
    weaponSets[hex(a)] = { set: hex(a), frameSize: 10, users: A.weapons.filter(w => w.set === a).map(w => w.key).concat(a === 0x27D1A ? ['stone (+0x5C = 1)'] : a === 0x27D62 ? ['stone (+0x5C >= 2)'] : []).concat(CONTAINERS.filter(c => c[3] === a).map(c => 'container ' + c[2])), anims: s.anims.map(an => an.terminator ? { index: an.index, terminator: true } : { index: an.index, addr: an.addr, frames: an.frames.map(f => outFrame(f, 10)), loopTo: an.loopTo, loopFrame: an.loopFrame, problem: an.problem }) };
  }
  const variants = weaponVariants(A.weapons);
  const heroes = A.heroes.map((h, c) => {
    const lists = {};
    for (const l of h.lists) lists[l.key] = { list: l.list, set: l.set, entry: l.entry, legsEntry: l.legsEntry, note: l.note, count: l.count, anims: l.anims.map(an => outAnim(an, 12, l.set, l.key)) };
    const classIdx = k => '0x' + (0x200 + k).toString(16).toUpperCase();
    const stand = {}, walk = {};
    h.stance.standAnimByClassLow.forEach((v, k) => { stand[classIdx(k)] = v; });
    h.stance.walkTorsoAnimByClassLow.forEach((v, k) => { walk[classIdx(k)] = v; });
    // hold placements: every hold index x every weapon variant
    const placements = [];
    for (const e of h.holds.entries) {
      const row = { hold: e.hold, dx: e.dx, dy: e.dy, origin: [e.dx, -e.dy], weapons: {} };
      for (const v of variants) {
        const anim = h.poseRows.rows[v.slot].anims[e.hold];
        if (anim < 0) { row.weapons[v.key] = { slot: v.slot, anim, hidden: true }; continue; }
        const ws = weaponSets[v.set], an = ws && ws.anims[anim];
        if (!an || !an.frames) { row.weapons[v.key] = { slot: v.slot, anim, error: 'no such weapon anim' }; continue; }
        const f0 = an.frames[0], box = frameBox(f0);
        row.weapons[v.key] = { slot: v.slot, set: v.set, anim, rec: f0.rec, rec2: f0.rec2 != null ? f0.rec2 : undefined, parts: f0.parts, origin: [e.dx, -e.dy], topLeft: box ? [e.dx + box.x, -e.dy + box.y] : null, size: box ? [box.w, box.h] : null };
      }
      placements.push(row);
    }
    return {
      id: c, key: KEYS[c], name: h.name, palette: h.palette, lists,
      stance: { standTable: h.stance.standTable, standAnimByClass: stand, walkTorsoTable: h.stance.walkTorsoTable, walkTorsoAnimByClass: walk,
        note: 'value = anim index in the weapon list (0x168E); null = plain idle (main anim 0) / plain walk (main anim 1). Class 0x200 / 0x20B are table padding (no weapon has them).' },
      bob: { table: h.stance.bobTable, entries: h.stance.bob, runTable: h.stance.runBobTable, run: h.stance.runBob,
        note: 'split body: the legs frame byte b5 (low byte of frame word 4 -> +0x34/+0x35) indexes the bob table in +0x38; the entry gives the torso offset (+0x3C dx, +0x3E dy; dy is height, up = positive). Driver 0x1564..0x1598. Walking (legs main anim 0x10, set by 0x5CA6/0x5FB6) uses entries (table 0x5D1C[id]); running (legs main anim 0x0B/0x18, set at 0x1A120/0x1A198/0x1A240/0x1A4A6) uses run (table 0x1A164[id]).' },
      runTorso: h.stance.runTorso, runAttackThrowTorso: h.stance.runAttackThrowTorso, smgWalkFireTorso: h.stance.smgWalkFireTorso,
      holds: { table: h.holds.table, count: h.holdCount, entries: h.holds.entries, note: 'hold index = high byte of the torso frame word 10 (+0x60); < 0 hides the weapon. Weapon origin = feet + (dx, -dy) in screen pixels (left-facing art), mirrored (x -> -x) when facing right; plus the torso offset (+0x3C, -+0x3E) while split-body walking (0x24A9A).' },
      poseRows: h.poseRows.rows.map(r => ({ slot: r.slot, row: r.row, anims: r.anims })), poseTable: h.poseRows.table,
      holdPlacements: placements,
    };
  });
  const weapons = A.weapons.map(w => ({ id: hex(w.id), key: w.key, name: w.name, class: hex(w.cls), ammo: w.ammo, poseSlot: w.slot, set: hex(w.set), init: hex(w.init) }));
  return { heroes, weapons, weaponSets, weaponVariants: variants };
}
module.exports = { build, KEYS, frameBox, outFrame, CONTAINERS };
