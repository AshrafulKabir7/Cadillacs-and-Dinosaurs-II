#!/usr/bin/env node
// Heroes + weapons export for the sequel (research data from the user's own ROM set; nothing here edits the game).
//   node tools/re/export/heroes.cjs            -> work/re/extract/heroes/
// Inputs: the ROM (tools/re/rom.cjs), the live runs made by tools/re/export/heroes-live.cjs (work/re/runs/ex-heroes-*),
// REA evidence (cached in work/re/extract/heroes/evidence/). Deterministic: re-running gives the same files.
// Outputs:
//   heroes.json                 every hero animation (all six lists) with per-hero labels, legs/bob, stance tables, hold
//                               tables, pose rows, hold placements for every hero x hold x weapon (torch with its
//                               flame), weapon sets, companions (torch flame), team-up, victory, bubbles, Cadillac seat,
//                               stage palettes, firing data, pixel validation results, evidence
//   atlas-<hero>.png/.json      every record any hero animation uses + the hero's unused records (RGBA, full brightness)
//   atlas-weapons.png/.json     every weapon / container / projectile / flash / effect / torch-flame record; stage-
//                               dependent slots drawn with the palette of the item's home area
//   atlas-stagepal.png/.json    the stage-dependent weapon records once per distinct palette row, with the areas using it
//   atlas-bubbles.png/.json     the catchphrase speech bubbles (records 1593-1607)
//   sheet-<hero>.png            contact sheet of every labelled animation (left-facing, feet origin = magenta cross)
//   sheet-extras.png            torch flame, bubbles, Cadillac seat, unused hero records, B. KNIFE / YOROI per area
//   grid-heroes-weapons.png     every hero x every weapon x idle / walk / run / jump / fire, drawn from the JSON alone
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../rom.cjs');
const HJ = require('./lib/hero-json.cjs');
const LB = require('./lib/labels.cjs');
const D = require('./lib/draw.cjs');
const M = require('./lib/model.cjs');
const DIS = require('./lib/dis.cjs');
const Z = require('./lib/rz.cjs');
const X = require('./lib/hero-extras.cjs');
const T = require('./lib/hero-live2.cjs');
const S = require('./lib/hero-static.cjs');

const ROOT = path.join(__dirname, '../..', '..');
const OUT = path.join(ROOT, 'work/re/extract/heroes');
const EVD = path.join(OUT, 'evidence');
const RUNS = path.join(ROOT, 'work/re/runs');
const LIVE = path.join(OUT, 'live');
fs.mkdirSync(OUT, { recursive: true });
const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();
const NAMES = ['Jack', 'Mustapha', 'Hannah', 'Mess'];
const KEYS = HJ.KEYS;
const WKEYS = ['rifle', 'gun', 'knife', 'uzi', 'm16', 'shotgun', 'bazooka', 'rod', 'stick', 'bknife', 'club', 'torch', 'dynamite', 'grenade', 'stone'];
const log = (...a) => console.log('[heroes]', ...a);
const runExists = run => fs.existsSync(path.join(RUNS, run, 'frames.jsonl'));

// ------------------------------------------------------------------------------------------- 1. static decode
const J = HJ.build();
const A = S.decodeAll();
const { u16, s16, u32, prg } = R;
const FLAME = X.torchFlame(), STAGEPAL = X.stagePalettes(), BUB = X.bubbles(), ITEMS = X.itemPlacements();
J.companions = { torchFlame: FLAME };
J.heroes.forEach((h, c) => {
  const p = u32(0x5EDE + c * 4), by = {};
  for (let k = 0; k < 12; k++) { const v = s16(p + k * 2); by[hex(0x200 + k)] = v < 0 ? null : v; }
  // container entries: index 12 + subtype/2 for the five carried containers (subtypes 0, 2, 4, 6, 8)
  const cont = []; for (let k = 12; k < 17; k++) { const v = s16(p + k * 2); cont.push(v < 0 ? null : v); }
  const after = u16(p + 17 * 2);
  h.attackTable = { table: hex(p), pointerTable: '0x5EDE', byClass: by, containerBySubtype: cont, containerSubtypes: ['0x0 JERICAN', '0x2 DRAMCAN', '0x4 TARU', '0x6 CONKRIET', '0x8 IWA'],
    note: `0x5E5C: weapon-list anim started for an attack, indexed by the held class low byte; a carried container (class 0x20A) indexes 12 + item subtype/2 instead. 0x8000 = no weapon (plain anim 0). The table has 5 container words (subtypes 0-8); the word after them is ${hex(after)} (${after & 0x8000 ? 'the 0x8000 end' : 'the start of the next data, not an entry'}). YOROI (0xA) and TIYA (0xC) are never carried (heroes.json containersNotCarried).` };
  h.containerJumps = {
    rise: { table: '0x1B0C6', anim: prg[0x1B0C6 + c], state: '2.0.4.1E', code: '0x1B038 (jump while carrying, from 0x1A5D6)' },
    fall: { table: '0x1B0F2', anim: prg[0x1B0F2 + c], state: '2.0.4.20', code: '0x1B0CA (past the apex)' },
    forward: { table: '0x1A902', anim: prg[0x1A902 + c], state: '2.0.4.x', code: '0x1A8AA (forward / running jump; main 4 when not carrying)' },
    note: 'weapon-list anims played instead of the jump anims while a container (class 0x20A) is carried; the hold index of their frames keeps the container overhead',
  };
  const sb = 0x62AE + c * 10;
  h.stabBox = { table: '0x62AE', fwd: s16(sb), xoff: s16(sb + 2), xRange: s16(sb + 4), dOff: s16(sb + 6), dRange: s16(sb + 8),
    rule: 'blade attack (0x19916): 0x6248 scans the hittable enemies; an enemy counts when (x + fwd*facing - enemy.x + xoff) < xRange and (depth - enemy.depth + dOff) < dRange (both unsigned). Found -> stab anim (class 0x202), none -> the knife/stick is thrown (class 0x201 anim, b4 = 2 frame releases it at 0x25496).' };
  h.bazookaRecoil = { table: '0x19CD8', vx: s16(0x19CD8 + c * 2) / 256, ax: 1, note: 'bazooka fire (0x19D3C): +0x14 = -vx (away from the facing), +0x1A = +1.0 px/frame^2 back towards 0; the push stops once |vx| < 0.125 (0x19DB0)' };
  // hold table capacity: the per-hero hold tables are consecutive (0x122230 pointers); the last one (Mess, 0x12263C) ends
  // at 0x1227A8, the first of the 12 stick-direction velocity tables listed at 0x17CE (read by 0x17A4; REA h29), so it
  // holds exactly 91 entries (U14 assumed 96)
  const HOLD_TABLES_END = 0x1227A8;
  const ptrs = [0, 1, 2, 3].map(k => u32(0x122230 + k * 4)), mine = ptrs[c], next = ptrs.filter(q => q > mine).sort((a, b) => a - b)[0] || HOLD_TABLES_END;
  h.holds.used = h.holds.count; h.holds.capacity = (next - mine) / 4; h.holds.tableEnd = hex(next);
  h.holds.note += ` Hold indices used by this hero's frames: 0..${h.holds.count - 1} (${h.holds.count} entries); the table has room for ${(next - mine) / 4} entries before the next table at ${hex(next)}${next === HOLD_TABLES_END ? ' (the first stick-direction velocity table of the list at 0x17CE, read by 0x17A4: so this table is exactly full)' : " (the next hero's hold table)"}.`;
});
J.containersNotCarried = HJ.CONTAINERS.filter(c => c[0] > 8).map(([sub, key, name, set]) => ({ subtype: hex(sub), key, name, set: hex(set),
  why: 'no entry in the attack table 0x5EDE (5 container words, subtypes 0-8); live, attack + the stick towards it broke it instead of lifting it, 8 of 8 tries (ex-heroes-cont3-<hero>, frames 14 and 214)' }));

// ------------------------------------------------------------------------------------------- 2. static call sites
// every call to the hero animation start entries in the player code, with the constant anim index (D0) and the
// state written just before (0x18A32..0x1DA00 is the live player code; 0x5B00..0x6100 holds the weapon stance code)
const ENTRY = { 0x13A0: 'main', 0x13A8: 'punch', 0x13B0: 'set3', 0x13BC: 'set4', 0x13C4: 'set5', 0x13CC: 'weapon', 0x13EA: 'main(+frame)', 0x1416: '+0x40', 0x14C2: 'legs main', 0x14CA: 'legs punch', 0x14D2: 'legs set3', 0x14DA: 'legs set4', 0x14E2: 'legs set5', 0x14EA: 'legs weapon', 0x1506: 'legs main(+frame)', 0x1532: 'legs +0x40' };
const callSites = [];
for (const l of DIS.load()) {
  if (!/^(jsr|jmp|bsr|bra)$/.test(l.op)) continue;
  const t = DIS.target(l); if (!ENTRY[t]) continue;
  if (!((l.addr >= 0x18A32 && l.addr < 0x1DA00) || (l.addr >= 0x5B00 && l.addr < 0x6100) || (l.addr >= 0x1A000 && l.addr < 0x1C000))) continue;
  let d0 = null, st = null;
  for (let k = 1; k < 16; k++) {
    const p = DIS.prev(l, k); if (!p) break; if (k > 1 && /^(rts|jmp|bra)$/.test(p.op)) break;
    if (d0 == null && /^moveq$/.test(p.op) && /,\s*D0$/.test(p.args)) d0 = parseInt(p.args.replace(/^#\$?/, '').split(',')[0], 16);
    else if (d0 == null && /,\s*D0$/.test(p.args)) d0 = p.text;
    if (st == null && /^move\.l$/.test(p.op) && /\(\$4,A6\)$/.test(p.args)) st = p.args.split(',')[0].replace('#$', '0x');
  }
  callSites.push({ at: hex(l.addr), returnTo: hex(l.addr + (l.bytes.replace(/ /g, '').length / 2)), entry: hex(t), list: ENTRY[t], anim: typeof d0 === 'number' ? d0 : null, animFrom: typeof d0 === 'string' ? d0 : undefined, stateWritten: st || undefined });
}
const siteAnims = caller => callSites.filter(s => s.returnTo === caller && s.anim != null).map(s => s.list.replace(/^legs /, '').replace('(+frame)', '') + ':' + s.anim);

// ------------------------------------------------------------------------------------------- 2b. weapon poses
// per hero x weapon: the animations the game plays for each pose, every frame with the weapon record and origin
// (native left-facing, relative to the feet; split-body torsos add the bob entry of the current legs frame)
function flameOf(v, wf, origin) {
  if (v.key !== 'torch' || !wf) return undefined;
  const e = X.flameFor(FLAME, wf); if (!e) return undefined;
  return { offsetIndex: e.index, offset: e.offset, origin: [origin[0] + e.offset[0], origin[1] + e.offset[1]], note: 'origin of the flame chain (companions.torchFlame); 1 frame behind the torch, depth alternating -1 / +2' };
}
function weaponFrame(h, v, f) {
  if (f.hold == null || f.hold < 0) return { hidden: true, hold: f.hold };
  const he = h.holds.entries[f.hold], anim = h.poseRows[v.slot].anims[f.hold];
  if (!he || anim < 0) return { hidden: true, hold: f.hold, anim };
  const wf = J.weaponSets[v.set].anims[anim].frames[0], box = HJ.frameBox(wf), origin = [he.dx, -he.dy];
  return { hold: f.hold, anim, rec: wf.rec, rec2: wf.rec2 != null ? wf.rec2 : undefined, origin, topLeft: box ? [he.dx + box.x, -he.dy + box.y] : null, size: box ? [box.w, box.h] : null, flame: flameOf(v, wf, origin) };
}
function poseAnim(h, v, list, a, extra = {}) {
  const an = a == null ? null : h.lists[list].anims[a]; if (!an || !an.frames) return null;
  return { list, anim: a, ...extra, frames: an.frames.map(f => ({ rec: f.rec, rec2: f.rec2, parts: f.parts, dur: f.dur, hold: f.hold, b4: f.b4 || undefined, weapon: weaponFrame(h, v, f) })), loopFrame: an.loopFrame, loopTarget: an.loopTarget };
}
J.heroes.forEach(h => {
  // the torch's flame for every hold placement
  for (const row of h.holdPlacements) { const w = row.weapons.torch; if (w && !w.hidden && !w.error) { const wf = J.weaponSets[w.set].anims[w.anim].frames[0]; w.flame = flameOf({ key: 'torch' }, wf, w.origin); } }
  h.weaponPoses = {};
  for (const v of J.weaponVariants) {
    const cls = v.cls.toUpperCase().replace('0X', '0x'), lo = parseInt(cls, 16) & 0xFF;
    const stand = h.stance.standAnimByClass[cls], walk = h.stance.walkTorsoAnimByClass[cls];
    const runT = lo >= 5 && lo <= 9 ? h.runTorso.gunsAtLeast0x205 : (lo === 3 && h.id !== 0 ? h.runTorso.blunt0x203 : null);
    const atk = cls === '0x20A' ? h.attackTable.containerBySubtype[(parseInt(v.subtype || '0', 16)) / 2] : h.attackTable.byClass[cls];
    const P = {
      stance: stand != null ? poseAnim(h, v, 'weapon', stand) : poseAnim(h, v, 'main', 0, { note: 'plain idle (table value 0x8000)' }),
      walk: walk != null ? poseAnim(h, v, 'weapon', walk, { splitBody: true, legs: 'main:16', bob: 'bob.entries (walk table) indexed by the legs frame b5' }) : poseAnim(h, v, 'main', 1, { note: 'plain walk' }),
      run: runT != null ? poseAnim(h, v, 'weapon', runT, { splitBody: true, legs: 'main:11', bob: 'bob.run indexed by the legs frame b5' }) : poseAnim(h, v, 'main', 2, { note: 'plain run (start, then main:9)' }),
      runLoop: runT != null ? undefined : poseAnim(h, v, 'main', 9),
      jump: cls === '0x20A' ? poseAnim(h, v, 'weapon', h.containerJumps.rise.anim, { note: 'jump carrying a container: rise (table 0x1B0C6), then fall (0x1B0F2)' }) : poseAnim(h, v, 'main', 3),
      jumpFall: cls === '0x20A' ? poseAnim(h, v, 'weapon', h.containerJumps.fall.anim) : undefined,
      jumpForward: cls === '0x20A' ? poseAnim(h, v, 'weapon', h.containerJumps.forward.anim) : poseAnim(h, v, 'main', 4),
      runningJump: cls === '0x20A' ? undefined : poseAnim(h, v, 'main', 8), landing: poseAnim(h, v, 'main', 6),
      attack: atk != null ? poseAnim(h, v, 'weapon', atk, { note: 'attack table 0x5EDE (0x5E5C)' }) : null,
      jumpAttack: cls === '0x20A' ? undefined : poseAnim(h, v, 'punch', 11, { note: 'attack in a jump plays the jump kick even when armed (observed in every armed run)' }),
      walkFire: (cls === '0x206' || cls === '0x207') ? poseAnim(h, v, 'weapon', cls === '0x206' ? h.smgWalkFireTorso.uzi0x206 : h.smgWalkFireTorso.m16_0x207, { splitBody: true, legs: 'main:16', note: 'attack + direction with an Uzi/M16 (state 0x1E)' }) : undefined,
      runAttack: (cls === '0x201' || cls === '0x202') ? poseAnim(h, v, 'weapon', h.runAttackThrowTorso.anim, { splitBody: true, legs: 'main:11', note: 'run + attack: throw' }) : undefined,
      knifeThrow: cls === '0x202' ? poseAnim(h, v, 'weapon', h.attackTable.byClass['0x201'], { note: 'blade attack with nobody in the stab box: the class 0x201 throw anim plays' }) : undefined,
    };
    h.weaponPoses[v.key] = { weapon: v.weapon, name: v.name, class: cls, slot: v.slot, set: v.set, ...P };
  }
});

// ------------------------------------------------------------------------------------------- 3. live labels
const evFile = path.join(LIVE, 'events.json');
const events = fs.existsSync(evFile) ? JSON.parse(fs.readFileSync(evFile, 'utf8')) : [];
const framesOfCache = new Map();
const framesOf = (c, key) => {
  const k = c + key; if (framesOfCache.has(k)) return framesOfCache.get(k);
  const [l, i] = key.split(':'), an = J.heroes[c].lists[l].anims[+i], s = new Set(an && an.frames ? an.frames.map(f => f.addr) : []);
  framesOfCache.set(k, s); return s;
};
const succMap = J.heroes.map(h => { const m = new Map(); for (const l of Object.values(h.lists)) for (const an of l.anims) if (an.frames) an.frames.forEach((f, i) => { const nx = f.last ? an.loopTo : (an.frames[i + 1] && an.frames[i + 1].addr); if (!nx) return; const k = f.addr; (m.get(k) || m.set(k, new Set()).get(k)).add('0x' + parseInt(nx, 16).toString(16).toUpperCase()); }); return m; });
const succOf = (c, addr) => succMap[c].get(addr) || null;
// what the jsr before a return address called: a start entry (0x13A0..0x1532) or a tick (0x1426 / 0x1542 / 0x15F4)
const callKind = caller => {
  const ra = parseInt(caller, 16);
  for (const len of [6, 4, 2]) { const ins = DIS.at(ra - len); if (!ins || !/^(jsr|bsr|jmp|bra)/.test(ins.op)) continue; const t = DIS.target(ins); if (t == null) continue; if ([0x1426, 0x1542, 0x15F4].includes(t)) return 'tick'; if (ENTRY[t]) return 'start'; return 'other'; }
  return 'unknown';
};
const liveBy = LB.liveStarts(events, framesOf, siteAnims, succOf, callKind);
// anims whose first frame another anim of the same hero runs into (loop target)
const continuedFrom = (h, an) => { const out = []; for (const [k2, l2] of Object.entries(h.lists)) for (const b of l2.anims) if (b.frames && b.loopTarget && b.loopTarget.frame === 0 && b.loopTarget.list === an.list && b.loopTarget.anim === an.index) out.push(`${k2}:${b.index}`); return out; };
const sameData = (h, key, an) => {      // other anims of the same hero with identical frame data
  const out = [];
  for (const [k2, l2] of Object.entries(h.lists)) for (const b of l2.anims) {
    if (b.terminator || (k2 === key.split(':')[0] && b.index === an.index)) continue;
    if (b.addr === an.addr || (b.frames.length === an.frames.length && b.frames.every((f, i) => f.rec === an.frames[i].rec && f.rec2 === an.frames[i].rec2 && f.dur === an.frames[i].dur && f.hold === an.frames[i].hold))) out.push(`${k2}:${b.index}${b.addr === an.addr ? ' (same address)' : ''}`);
  }
  return out;
};
J.heroes.forEach((h, c) => {
  const tables = LB.weaponTableLabels(h, { attackByClass: h.attackTable.byClass, attackContainer: h.attackTable.containerBySubtype, containerJumpRise: h.containerJumps.rise.anim, containerJumpFall: h.containerJumps.fall.anim, containerJumpForward: h.containerJumps.forward.anim });
  for (const [key, l] of Object.entries(h.lists)) for (const an of l.anims) {
    if (an.terminator) continue;
    const ak = `${key}:${an.index}`;
    const lab = { live: [], table: [], static: null, looks: (LB.VISUAL[h.key] || {})[ak] || undefined };
    for (const suffix of ['', '|legs']) {
      const o = liveBy.get(c + '|' + ak + suffix); if (!o) continue;
      for (const [cl, v] of o.callers) lab.live.push({ name: v.name + (suffix ? ' (as legs)' : ''), caller: cl, count: v.n, states: [...v.states].slice(0, 6), trigger: v.trigger, sharedFirstFrame: v.shared });
      lab.runs = (lab.runs || []).concat(o.runs);
    }
    if (key === 'weapon' && tables[an.index]) lab.table = tables[an.index];
    const site0 = LB.SITES[ak], site = site0 && site0.at ? site0 : null;
    if (site0 && !site0.at) lab.noCallSite = site0.name;
    if (site) { const un = LB.unreachable(ak, c); lab.static = { ...site, reachable: !un, unreachableBecause: un || undefined }; }
    lab.callSites = callSites.filter(s => s.list.replace(/^legs /, '').replace('(+frame)', '') === key && s.anim === an.index).map(s => s.at + (s.stateWritten ? ' st ' + s.stateWritten : '') + (s.list.startsWith('legs') ? ' (legs)' : ''));
    const same = sameData(h, ak, an); if (same.length) lab.sameDataAs = same;
    const cont = continuedFrom(h, an); if (cont.length) lab.continuationOf = cont;
    const tail = []; for (const [k2, l2] of Object.entries(h.lists)) for (const b of l2.anims) if (b.frames && !(k2 === key && b.index === an.index)) { const i = b.frames.findIndex(f => f.addr === an.addr); if (i > 0) tail.push(`${k2}:${b.index} from frame ${i}`); }
    if (tail.length) lab.tailOf = tail;
    const rch = liveBy.reached.get(c + '|' + ak); if (rch) lab.reachedLive = { by: 'the frame driver advancing from another anim (tail / loop target)', count: rch.n, runs: rch.runs };
    const liveNames = [...new Set(lab.live.map(x => x.name))];
    if (key === 'weapon' && lab.table.length) { an.name = [...new Set(lab.table.map(x => x.name))].join(' | '); an.status = liveNames.length ? 'observed + table' : 'table'; }
    else if (liveNames.length) { an.name = liveNames.join(' | '); an.status = 'observed'; }
    else if (rch) { an.name = (site ? site.name + '; ' : '') + (tail.length ? `the tail of ${tail.join(', ')}: played live as that anim advances` : 'played live as a loop target of another anim') + (lab.looks ? ` — ${h.name}: ${lab.looks}` : ''); an.status = 'observed (as tail)'; }
    else if (site && lab.static.reachable) { an.name = site.name + (lab.looks ? ` — ${h.name}: ${lab.looks}` : ''); an.status = 'static'; }
    else if (site) { an.name = `never played by ${h.name}: ${lab.static.unreachableBecause}` + (same.length ? ` (data = ${same.join(', ')})` : '') + (lab.looks ? ` — ${lab.looks}` : ''); an.status = 'unused'; }
    else if (tail.length && rch) { an.name = `the tail of ${tail.join(', ')}: played live as that anim advances`+ (lab.looks ? ` — ${h.name}: ${lab.looks}` : ''); an.status = 'observed (as tail)'; }
    else if (tail.length) { an.name = `the tail of ${tail.join(', ')}: reached when that anim advances` + (lab.looks ? ` — ${h.name}: ${lab.looks}` : ''); an.status = 'static'; }
    else if (cont.length) { an.name = `reached as the continuation of ${cont.join(', ')} (its loop target)` + (lab.looks ? ` — ${h.name}: ${lab.looks}` : ''); an.status = 'static'; }
    else if (lab.looks) { an.name = `${h.name}: ${lab.looks} (no call site found${site0 ? ': ' + site0.name : ''})`; an.status = 'visual'; }
    else { an.name = (key === 'weapon' ? 'weapon-list anim not selected by any decoded table' + (same.length ? ` (data = ${same.join(', ')})` : '') : 'unlabelled') + (lab.looks ? ` — ${h.name}: ${lab.looks}` : ''); an.status = 'unknown'; }
    an.labels = lab;
  }
});

J.heroes.forEach(h => { for (const l of Object.values(h.lists)) for (const an of l.anims) if (!an.terminator && /tail/.test(an.status) || (an.labels && an.labels.tailOf && /^the tail of/.test(an.name || ''))) {
  const first = an.labels.tailOf[0].split(' ')[0], [pl, pi] = first.split(':'), p = h.lists[pl].anims[+pi];
  if (p && p.name && !/^the tail of/.test(p.name)) an.name = an.name.replace(first, `${first} (${p.name})`);
} });
// HEROES_LABELS_ONLY=1: print the label status and the anims that are not observed, then stop (no files written)
if (process.env.HEROES_LABELS_ONLY) {
  const st = {}; for (const h of J.heroes) for (const [k, l] of Object.entries(h.lists)) for (const an of l.anims) if (!an.terminator) { st[an.status] = (st[an.status] || 0) + 1; if (!/observed|table/.test(an.status)) console.log(h.key.padEnd(9), (k + ':' + an.index).padEnd(10), an.status.padEnd(7), an.name.slice(0, 120)); }
  console.log(JSON.stringify(st)); process.exit(0);
}

// ------------------------------------------------------------------------------------------- 4. pixel validation
const V = require('./lib/validate.cjs');
const validation = { method: 'For every frame f of each run: the RAM dumped at f gives the game state (world position, facing, camera, the ROM address of the current torso and legs frames, the pose slot, +0x23; for the torch flame its frame pointer and depth). The hero + weapon (+ torch flame) blocks are rebuilt from heroes.json alone (frame records, second record, hold index, hold table, pose row, weapon set frame 0, bob table chosen by the legs anim; flame offset table by the torch frame b5, one frame behind the torch) and compared pixel by pixel (palette*16+pen) with MAME OBJ list f+1 (V05), using MAME\'s own entries (located by object order, V07; shadow sprites from 0x14EC0 excluded). Blocks outside 0x40 <= X + 16w, X <= 0x1C0 are not drawn (V04); each 16x16 tile wraps in the 512x512 OBJ space as MAME draws it. Frames where the hero is not drawn (+0x01 == 0) are skipped.', runs: [], totals: null };
let tot = { frames: 0, exact: 0, union: 0, same: 0, wpos: 0, wposOk: 0, flame: { frames: 0, posExact: 0, depthRule: 0, union: 0, same: 0 } }, coverage = {};
const VRUNS = [];
for (const [c, hk] of KEYS.entries()) {
  for (const w of WKEYS) VRUNS.push([c, w, `ex-heroes-arm-${hk}-${w}`, 'armed']);
  VRUNS.push([c, 'container (rock)', `ex-heroes-cont-${hk}`, 'container'], [c, 'container (drum can)', `ex-heroes-cont2-${hk}`, 'container'], [c, 'knife (stab)', `ex-heroes-stab-${hk}`, 'stab'], [c, 'torch (snapshot run)', `ex-heroes-snap-${hk}-torch`, 'torch'], [c, 'none (victory)', `ex-heroes-victory-${hk}`, 'victory']);
}
VRUNS.push([0, 'none (EPISODE 2 Cadillac)', 'ex-heroes-car-e2-jack', 'car'], [0, 'none (EPISODE 4 Cadillac)', 'ex-heroes-car-e4-jack', 'car'], [1, 'none (EPISODE 3 start)', 'ex-heroes-car-e3-mustapha', 'car']);
for (const [c, w, run, kind] of VRUNS) {
  if (!runExists(run)) continue;
  const r = V.validateRun(J, c, run, { maxDetail: 4, exclude: kind === 'car' ? { frames: [4], why: 'warpLive pokes at the end of frame 4: the OBJ list of frame 5 is already the stage-clear screen' } : null });
  if (!r.frames) continue;
  tot.frames += r.frames; tot.exact += r.exactFrames; tot.union += r.union; tot.same += r.same; tot.wpos += r.weaponPos.checked; tot.wposOk += r.weaponPos.exact;
  for (const k of ['frames', 'posExact', 'depthRule', 'union', 'same']) tot.flame[k] += r.flame[k];
  const cats = {};
  for (const [pose, v] of Object.entries(r.poses)) {
    const st = v.state.split('.'), face = pose.endsWith(' R') ? 'right' : 'left', armed = pose.startsWith('armed');
    const cat = st[1] !== '0' ? 'other' : st[2] === '2' ? 'run' : st[2] === '4' ? 'jump' : ['16', '1c', '1e', '20', '22'].includes(st[3]) ? 'fire/attack' : st[3] === '2' ? 'walk' : st[3] === '0' ? 'idle' : 'other';
    const k = `${armed ? 'armed' : 'empty'} ${cat} ${face}`; const o = cats[k] = cats[k] || { frames: 0, union: 0, same: 0 }; o.frames += v.frames; o.union += v.union; o.same += v.same;
    const g = coverage[k] = coverage[k] || { frames: 0, union: 0, same: 0 }; g.frames += v.frames; g.union += v.union; g.same += v.same;
  }
  validation.runs.push({ run, kind, hero: NAMES[c], weapon: w, frames: r.frames, exactFrames: r.exactFrames, pixels: r.union, pixelsSame: r.same, agreement: r.agreement, weaponRamPosition: r.weaponPos.exact + '/' + r.weaponPos.checked,
    torchFlame: r.flame.frames ? { frames: r.flame.frames, positionExact: r.flame.posExact, depthRule: r.flame.depthRule, pixels: r.flame.union, pixelsSame: r.flame.same } : undefined, sequenceNotFound: r.seqMisses || 0, skipped: r.skipped, byCategory: cats, mismatches: r.mismatches });
}
const byKind = {}; for (const r of validation.runs) { const o = byKind[r.kind] = byKind[r.kind] || { runs: 0, frames: 0, exactFrames: 0, pixels: 0, pixelsSame: 0 }; o.runs++; o.frames += r.frames; o.exactFrames += r.exactFrames; o.pixels += r.pixels; o.pixelsSame += r.pixelsSame; }
validation.totals = { runs: validation.runs.length, frames: tot.frames, exactFrames: tot.exact, pixels: tot.union, pixelsSame: tot.same, agreement: tot.union ? tot.same / tot.union : null, weaponRamPosition: tot.wposOk + '/' + tot.wpos,
  torchFlame: { frames: tot.flame.frames, positionExact: tot.flame.posExact, depthRule: tot.flame.depthRule, pixels: tot.flame.union, pixelsSame: tot.flame.same },
  byKind, byCategory: Object.fromEntries(Object.entries(coverage).map(([k, v]) => [k, { frames: v.frames, agreement: v.union ? v.same / v.union : null }])) };
validation.notExact = validation.runs.flatMap(r => r.mismatches.map(m => ({ run: r.run, f: m.f, pose: m.pose, cmp: m.cmp }))).slice(0, 40);
log('validation', JSON.stringify(validation.totals).slice(0, 400));

// ------------------------------------------------------------------------------------------- 5. firing
const F = require('./lib/firing.cjs');
const KIND = { 'A0xC': 'bullet (pool A type 0x0C, handler 0x2860A)', 'A0x1C': 'bazooka rocket (pool A type 0x1C)', 'A0x4': 'explosion (pool A type 0x04)', 'A0x28': 'shotgun pellet (pool A type 0x28)', 'D0x7C': 'muzzle sparks (pool D type 0x7C, spawned by 0x96B40)', 'D0x84': 'shot object / shell casing (pool D type 0x84, 0x96B78)', 'D0x4': 'effect (pool D type 0x04: flash / smoke, subtype = effect id)', 'D0x1C': 'smoke puff (pool D type 0x1C)', 'D0x54': 'debris (pool D type 0x54)', 'A0x14': 'stage item (unrelated)', 'A0x0': 'item (unrelated or the weapon)', 'A0x18': 'torch flame (pool A type 0x18)' };
const firing = { perWeapon: {}, static: {} };
const mode = arr => { const m = new Map(); for (const v of arr) { const k = JSON.stringify(v); m.set(k, (m.get(k) || 0) + 1); } let b = null, n = 0; for (const [k, c] of m) if (c > n) { n = c; b = k; } return b == null ? null : JSON.parse(b); };
const histo = arr => { const o = {}; for (const v of arr) o[v] = (o[v] || 0) + 1; return o; };
for (const w of WKEYS) {
  const per = {};
  for (const [c, hk] of KEYS.entries()) {
    const run = `ex-heroes-arm-${hk}-${w}`; if (!runExists(run)) continue;
    const s = F.summarise(run);
    const shots = s.shots.filter(x => !x.released);
    const kinds = {};
    for (const o of s.spawned) {
      if (o.shotAt == null || o.type === '0x14' || (o.pool === 'A' && o.type === '0x0') || (o.pool === 'A' && o.type === '0x18')) continue;
      const k = `${o.pool}${o.type}:${o.sub}`;
      const g = kinds[k] = kinds[k] || { kind: KIND[o.pool + o.type] || `pool ${o.pool} type ${o.type}`, pool: o.pool, type: o.type, sub: o.sub, n: 0, delays: [], fromWeapon: [], fromThrown: [], life: [], speed: [], step: [], travel: [], records: [] };
      g.n++; g.delays.push(o.delay); g.fromWeapon.push(o.fromWeapon); if (o.fromThrown) g.fromThrown.push(o.fromThrown); g.life.push(o.life); g.speed.push(o.meanVx); if (o.stepMode != null) g.step.push(o.stepMode); g.travel.push(o.travel); g.records.push(o.records.map(r => r.r + 'x' + r.n).join(' '));
    }
    const kindOut = Object.values(kinds).map(g => {
      const maxLife = Math.max(...g.life), full = g.life.filter(x => x === maxLife).length;
      return { kind: g.kind, pool: g.pool, type: g.type, sub: g.sub, count: g.n, perShot: shots.length ? +(g.n / shots.length).toFixed(2) : null,
        delayAfterShot: { min: Math.min(...g.delays), max: Math.max(...g.delays), mode: mode(g.delays) }, spawnFromWeaponOrigin: mode(g.fromWeapon), spawnFromWeaponAll: [...new Set(g.fromWeapon.map(x => JSON.stringify(x)))].slice(0, 8).map(x => JSON.parse(x)),
        spawnFromThrownWeapon: g.fromThrown.length ? mode(g.fromThrown) : undefined,
        lifeFrames: { min: Math.min(...g.life), max: maxLife, mode: mode(g.life), histogram: histo(g.life), note: 'frames from birth to free; objects that hit something are removed early; a slot reused in the next frame by the same kind is counted as one object (max)' },
        pxPerFrame: g.step.length ? mode(g.step) : mode(g.speed), pxPerFrameNote: 'mode of the per-frame x step over every tracked frame of every object of this kind (speed in free flight)', meanOverFirst4: mode(g.speed),
        travel: mode(g.travel), recordSequence: mode(g.records) };
    });
    const intervals = shots.map(x => x.sincePrev).filter(x => x != null);
    per[hk] = {
      run, shots: shots.length, ammoAtStart: s.shots.length ? (s.shots[0].ammo != null ? s.shots[0].ammo + 1 : s.shots[0].lastAmmo) : null,
      minFramesBetweenShots: intervals.length ? Math.min(...intervals) : null, shotIntervals: histo(intervals),
      burstSpacing: (w === 'uzi' || w === 'm16') ? mode(intervals.filter(x => x < 14)) : undefined,
      fireStateFrames: mode(shots.map(x => x.fireStateFrames)), fireState: mode(shots.map(x => x.state)), pushBackPx: mode(shots.map(x => x.pushBack)),
      released: s.shots.filter(x => x.released).map(x => ({ atFrame: x.f, state: x.state, lastAmmo: x.lastAmmo })), thrown: s.thrown.map(t => ({ ...t, path: t.path.slice(0, 40) })), spawnedPerKind: kindOut,
      firstShot: shots.length ? s.spawned.filter(o => o.shotAt === shots[0].f && o.delay != null && o.delay <= 40 && o.type !== '0x14' && !(o.pool === 'A' && (o.type === '0x0' || o.type === '0x18'))).map(o => ({ pool: o.pool, type: o.type, sub: o.sub, delay: o.delay, fromWeapon: o.fromWeapon, fromFeet: o.fromFeet, life: o.life, pxPerFrame: o.stepMode, travel: o.travel, records: o.records })) : [],
    };
  }
  // per-hero summary of the main projectile (the values differ per hero: the fire anims differ)
  const main = { rifle: 'A0xC', gun: 'A0xC', uzi: 'A0xC', m16: 'A0xC', shotgun: 'A0x28', bazooka: 'A0x1C' }[w];
  if (main) per.byHero = Object.fromEntries(Object.entries(per).map(([hk, r]) => { const k = r.spawnedPerKind.filter(x => x.pool + x.type === main); return [hk, { burstSpacing: r.burstSpacing, minFramesBetweenShots: r.minFramesBetweenShots, projectile: k.map(x => ({ sub: x.sub, pxPerFrame: x.pxPerFrame, lifeFramesMode: x.lifeFrames.mode, lifeHistogram: x.lifeFrames.histogram, spawnFromWeaponOrigin: x.spawnFromWeaponOrigin })) }]; }));
  if (per.byHero) per.byHeroNote = 'lifeFramesMode = the most common number of frames the object existed (born to freed, impact anim included); short lives are hits on stage objects, long outliers are two bullets reusing the same slot back to back. pxPerFrame = the mode of the per-frame x step (the flight speed).';
  firing.perWeapon[w] = per;
}
// static tables behind the observed objects
const bullet = []; for (let k = 0; k <= 0xC; k += 2) { const a = 0x28814 + k * 4; const anim = s16(a + 2); bullet.push({ subtype: hex(k), vx: s16(a) / 256, anim, attackId: hex(s16(a + 4) & 0xFFFF), aimed: s16(a + 6) < 0 }); }
const bset = S.set10(0x28904); for (const b of bullet) { const an = bset.anims[b.anim]; if (an && an.frames) { b.flightAnim = an.frames.map(f => ({ rec: f.rec, dur: f.dur })); b.flightAnimLoops = an.loopFrame != null; } }
const impactAnims = [1, 2, 3].map(k => ({ anim: k, frames: bset.anims[k].frames.map(f => ({ rec: f.rec, dur: f.dur })) }));
const muzzle = []; for (let k = 0; k < 6; k++) { const a = 0x96D2A + s16(0x96D2A + k * 2); muzzle.push({ class: hex(0x204 + k), sparks: prg[a] >= 0x80 ? 0 : prg[a] + 1, sparkAnim: prg[a + 2], sparkVelocityIndex: prg[a + 3], sparkAt: [s16(a + 4), s16(a + 6)], casing: !!prg[a + 8], casingAt: prg[a + 8] ? [s16(a + 10), s16(a + 12)] : null }); }
const throwV = k => { const a = k; return { vx: s16(a) / 256, ax: s16(a + 2) / 256, vh: s16(a + 4) / 256, gravity: s16(a + 6) / 256 }; };
firing.static = {
  fireRequest: 'The hero sets +0xC4 = 1 when its attack anim reaches the shot (0x19944 / 0x19AD4 / 0x19D1A); the held weapon handler (switch 0x251C8 by subtype) consumes it: sound, 0x96B40 (pool D type 0x84 shot object = muzzle sparks + shell casing), the projectile, ammo -1 (0x25212 / 0x256D0), then the R2 out-of-ammo change.',
  bulletTable: { at: '0x28814', note: "pool A type 0x0C (0x2860A); 8-byte rows at 0x28814 + subtype*4 (subtypes are even): vx (8.8, signed by facing), flight anim of set 0x28904 (it loops, so it does not limit the range), attack id (+0x58), aimed flag (< 0: +0x16/+0x18 steer towards the holder's target +0xEA / +0xA9; the others take a vertical speed from the random tables 0x2884C -> 0x2885C, which are all 0, so they fly flat). Every other frame the hit test 0x12CB4 runs; a hit (+0x59) frees the bullet at once; when +0x51 is cleared, +0x50 is set or it wades below height 0x20 (+0x53) it switches to an impact anim (1, 2 or 3 of set 0x28904) and is freed when that ends (0x287EC). What ends the flight after about 10 frames with nothing in the path was not traced (+0x51 / +0x50 are written by 0x12CB4 / 0x189C); firing.perWeapon.<w>.byHero lists the observed flight lengths per hero (stage-1 start, no enemy in the path).", rows: bullet, impactAnims },
  rifleShot: '0x251F0: bullet subtype 2 at weapon + (-40 * facing-left sign, +5) via 0x26414; effect type 4 id 0x10 (muzzle flash) and id 6 (smoke, random offset table 0x9248A) via 0x92422 / 0x92450',
  revolverShot: '0x252E8: bullet subtype 0 at weapon + (-20, +6); effects id 0x0F and 6',
  muzzleTable: { at: '0x96D2A', note: 'shot object type 0x84 (0x96B78), indexed by holder class low byte - 4: spark count-1 (0xFF = none), spark anim / velocity index, spark offset from the weapon (x signed by facing, h); then a shell casing (vx -2.0 away from the facing, vh 4.0, gravity -0.28, life 30 + 0..3) when the flag byte is set; the Uzi and M16 eject a casing only every other shot (0xFF8515 parity).', rows: muzzle },
  throwVelocities: { throwable: { at: '0x26534', normal: throwV(0x26534), alt: throwV(0x2653C), note: '0x2535C: vx/ax signed by facing; alt row when weapon +0xA8 is set (thrown while running)' }, blade: { at: '0x26544', normal: throwV(0x26544), alt: throwV(0x2654C), note: '0x25496: knife / stick thrown when the hero frame byte b4 == 2' } },
  smgBurst: '0x19AB0: state 0x1C; +0x81 = 3 shots per press; after each fire anim the counter drops; while attack (input bit 4) is held it is reset to 3, so holding fires continuously; a direction makes it state 0x1E (fire while walking, 0x5FB6 torso table 0x5FF2). The spacing between burst shots is the length of the hero\'s own fire anim, so it differs per hero: firing.perWeapon.uzi/m16.byHero.<hero>.burstSpacing.',
  meleeSwing: '0x19C36: state 0x20; holding attack charges +0x80 (max 0x3C); the swing anim plays from the attack table; uses decrement per hit (V20)',
  knifeRule: 'see heroes[].stabBox; live: ex-heroes-stab-<hero> (frozen Chinpira 40 px ahead): the stab anim (Jack weapon:18, Mustapha 17, Hannah 14, Mess 14) started at 0x19916 and stayed; its b4 = 1 frame hit the Chinpira (HP 44 -> about 20 for Jack, frame 46). Ammo stays 6 on a stab. Without an enemy in reach the throw anim replaces the stab in the same frame (ex-heroes-arm-*-knife).',
  emptyWeapons: 'R2: rifle -> class 0x203 pose 2 (club), M16 -> 0x203 pose 6, revolver / Uzi / shotgun -> 0x201 and thrown away, bazooka stays 0x209 and is discarded; the hero clears +0xB6 when the anim ends with 0 ammo (0x19972 / 0x19D9C)',
};

// ------------------------------------------------------------------------------------------- 6. second-pass live data
const TEAM = T.teamUp(A.heroes), VICTORY = T.victory(J, events, BUB), CAR = T.car(events), FIRST = T.firstFrame(events, A.heroes);
log('team-up', TEAM.live.runs.map(r => r.positionExact + '/' + r.framesAttached).join(' '));

// ------------------------------------------------------------------------------------------- 6b. (after the atlases) colour check
// see section 9b

// ------------------------------------------------------------------------------------------- 7. REA evidence
const EVIDENCE = [
  ['h01-hero-anim-driver', 'pd 70 @ 0x13a0', '12-byte hero frame driver; list start entries 0x13A0..0x13CC'],
  ['h02-legs-driver-bob', 'pd 50 @ 0x1542', 'legs driver: frame word 4 -> +0x34, low byte indexes the bob table at +0x38 -> +0x3C/+0x3E'],
  ['h03-stance-walk', 'pd 60 @ 0x5bdc', 'stance 0x5BDC (table 0x5C36) and split-body walk 0x5CA6 (tables 0x5D1C bob, 0x5D2C torso)'],
  ['h04-run-weapon', 'pd 36 @ 0x1a0f0', 'running with a weapon: +0x38 = [0x1A164 + id*4], legs main 0x0B/0x18, torso byte table 0x1A15C'],
  ['h05-weapon-attack', 'pd 40 @ 0x198dc', 'weapon attack dispatch by class: 0x206/0x207 burst, 0x209 bazooka, 0x203 swing, else state 0x16; blade stab-or-throw via 0x6248'],
  ['h06-attack-anim-by-class', 'pd 34 @ 0x5e5c', 'attack anim = [[0x5EDE + id*4] + class low byte*2] (containers: + 0x18 + subtype)'],
  ['h07-stab-box', 'pd 40 @ 0x6248', 'blade reach test per hero (box table 0x62AE)'],
  ['h08-held-weapon-switch', 'pd 70 @ 0x25178', 'held weapon handler 0x25178, placement 0x24A9A, fire handlers rifle 0x251E6 / revolver 0x252D2 / throw 0x2535C'],
  ['h09-knife-throw', 'pd 70 @ 0x253fa', 'knife handler: hero frame b4 == 1 stab hit, b4 == 2 release (velocities 0x26544)'],
  ['h10-shot-object', 'pd 90 @ 0x96b40', 'shot object type 0x84: muzzle sparks (0x967C4 -> type 0x7C) and shell casing (set 0x96D06)'],
  ['h11-bullet', 'pd 110 @ 0x2860a', 'bullet object pool A type 0x0C: speed/anim/attack table 0x28814, aiming, hit test, anim-end removal'],
  ['h12-smg-burst', 'pd 44 @ 0x19ab0', 'Uzi/M16 burst counter +0x81 = 3, refilled while attack is held'],
  ['h13-bazooka-recoil', 'pd 50 @ 0x19ce0', 'bazooka fire: recoil vx table 0x19CD8, ax 1.0'],
  ['h14-jump-select', 'pd 40 @ 0x1a600', 'jump anim 3/4/5 by stick and facing age (+0xAB), descent 7/12'],
  ['h15-player-dispatch', 'pd 12 @ 0x18e6c; pd 8 @ 0x190b8; pd 8 @ 0x190e8; pd 6 @ 0x19fb4; pd 6 @ 0x1a58c', 'player state dispatch: +0x05, +0x06, +0x07 (ground / run / jump)'],
  ['h16-shot-sources', 'pd 20 @ 0x26414; pd 20 @ 0x92422', 'projectile spawner (pool A type 0x0C at D0..D3) and effect spawner (pool D type 4)'],
  ['h17-torch-flame', 'pd 12 @ 0x24f4c; pd 74 @ 0x29b06', 'torch init allocates the flame (pool A type 0x18, +0x5A = torch); flame handler: offset table 0x29C26 by torch byte +0x2D, depth +2 / -1 by 0xFF8001 bit 0, chains 0x29CB6 / 0x29CF4 by holder +0x06'],
  ['h18-victory-state', 'pd 14 @ 0x1916e; pd 30 @ 0x19996; pd 12 @ 0x1e23a', 'idle -> ground state 0x18 when +0x10E is set; +0xC0 -> bubble 0x6192 + main 14, else main 17; stage clear 0x1E200 -> 0x19996'],
  ['h19-team-up', 'pd 50 @ 0x6728; pd 30 @ 0x68d8; pd 28 @ 0x6922', 'team-up trigger 0x6710 (idle pair, 90 frames), partner state table 0x6902, attach 0x6922 with offset tables 0x6994'],
  ['h20-team-partner-anims', 'pd 10 @ 0x1a350; pd 10 @ 0x1b11c; pd 10 @ 0x1b24c; pd 10 @ 0x1b37c', 'team-up partner states: run 4 (main 23), jump 0x22 (main 27), 0x24 (main 26), 0x26 (main 28), each restarted at the initiator frame b5 via 0x13EA'],
  ['h21-bubbles', 'pd 26 @ 0x92b7a; pd 24 @ 0x6192', 'catchphrase bubble: pool D type 0x14 0x60 above the hero, subtype table 0x61E6 (victory) / 0x6244 (team-up), waits for owner b4 != 0, 120 frames'],
  ['h22-cadillac-seat', 'pd 34 @ 0x18aae', 'player init: area 0 of EPISODE 2 / 4 -> main 29 (seated in the Cadillac), state 2.0.4.32'],
  ['h23-pickup-rule', 'pd 42 @ 0x5b44', 'pick-up candidate: containers (class 0x20A) other than CONKRIET / IWA need the stick towards the item'],
  ['h24-container-jumps', 'pd 18 @ 0x1a8aa; pd 16 @ 0x1b038; pd 8 @ 0x1b0ca', 'jumping with a container: tables 0x1A902 (forward), 0x1B0C6 (rise), 0x1B0F2 (fall)'],
  ['h25-bknife-source', 'pd 22 @ 0x57386', 'B. KNIFE items: BUTCHER\'s knife object (pool B type 0xD0) allocates item subtype 0x12 and hands it to its owner'],
  ['h26-stage-end-lift', 'pd 18 @ 0x19f40; pd 6 @ 0x1e2aa', 'scripted stage-end move of the boss killer: state 0x2C, effect 0xD, main 31'],
  ['h27-area-obj-palettes', 'pd 30 @ 0x8a44', 'area start loads the 32 OBJ palettes from the rows listed at [0x8E8E + stage*16 + area*4]'],
  ['h28-stage-object-lists', 'pd 18 @ 0xfbf4; pd 34 @ 0xfc7a; pd 12 @ 0xfd02', 'stage object lists: list A [0xFC2E + stage*4] (14-byte entries), list B [0xFC4E + stage*4] (16-byte entries), per area; +4 type, +6 x, +8 depth, +0xA subtype'],
  ['h29-hold-table-end', 'pd 14 @ 0x17a4', 'the data after the last hold table (Mess, 0x12263C + 91*4 = 0x1227A8) is the first of the stick-direction velocity tables listed at 0x17CE (0x17A4: +0x64 = table, +0x14/+0x18 = entry by +0x22), so Mess\'s hold table has exactly 91 entries (U14 assumed 96)'],
];
const evidence = [];
for (const [label, cmds, what] of EVIDENCE) {
  try { const r = Z.rea(label, cmds, EVD); evidence.push({ label, id: r.id, rizin: cmds, what, file: `work/re/extract/heroes/evidence/${label}.txt` }); }
  catch (e) { evidence.push({ label, error: String(e.message).slice(0, 200), rizin: cmds, what }); }
}
log('evidence', evidence.filter(e => e.id).length, 'of', evidence.length);

// ------------------------------------------------------------------------------------------- 8. stage palettes
// slots 0-9, 13-16, 21, 22 hold the same ROM row in every area; hero and weapon records only use fixed slots except
// the B. KNIFE (slot 30) and the YOROI container (slot 28)
const palsOf = rec => [...new Set(M.recBlocks(rec).map(b => b.attr & 31))].sort((a, b) => a - b);
const varSlots = new Set(STAGEPAL.variableSlots.map(v => v.slot));
const HOME = {
  30: { item: 'B. KNIFE (weapon 0x12)', episode: 2, area: 2, why: 'B. KNIFE items are made only by the BUTCHER\'s knife object (pool B type 0xD0, 0x5739A sets item subtype 0x12 and gives it to its owner); the BUTCHER (type 0xF4) is the EPISODE 2 boss, fought in area 2 (bosses export: home E2 a2, 12,457 live frames). The BUTCHER\'s own sprites use slot 30 too, so the knife matches him. Live: ex-heroes-snap-jack-bknife-e2a2 palette RAM == the ROM rows of E2 a2 in all 32 slots.' },
  28: { item: 'YOROI container (item type 0x14 subtype 0xA)', episode: 1, area: 1, why: 'the stage object lists place YOROI only in EPISODE 1 area 1 (list B 0xADD12: entries 0xADD22 / 0xADD32 / 0xADD72 / 0xADDB2 at x 129, 331, 640, 834, depth 72; heroes.json itemPlacements); live, ex-heroes-snap-jack-yoroi-e1a1 had the YOROIs at x 129 and 331, depth 72, and its palette RAM slot 28 == ROM row 488 (the E1 rows).' },
};
const areaRows = (ep, area) => STAGEPAL.areas.find(a => a.episode === ep && a.area === area).rows;
const homeRemap = slot => { const H = HOME[slot]; const row = areaRows(H.episode, H.area)[slot]; return { tag: `home${slot}-${row}`, rows: { [slot]: X.rowRGB(row) }, row }; };
const stagePalOut = {
  ...STAGEPAL,
  usedByHeroesAndWeapons: null,
  home: Object.fromEntries(Object.entries(HOME).map(([slot, H]) => { const row = areaRows(H.episode, H.area)[+slot]; return [slot, { ...H, romRow: row, romAddr: hex(0xB7A52 + row * 32), words: X.rowWords(row) }]; })),
  recommendation: 'Heroes (slots 0-3), the weapons and effects (4-9) and the bubbles use fixed slots: one palette for the whole game. Only the B. KNIFE (slot 30) and the YOROI container (slot 28) change colour with the stage area; use their home-area rows (atlas-weapons is drawn with them) and atlas-stagepal for any other area.',
};

// ------------------------------------------------------------------------------------------- 9. atlases
M.setCull(false);
function pack(items0, maxW = 1024, pad = 1) {
  const items = items0.map(it => ({ ...it, im: D.recImg(it.rec, null, it.remap || null) })).filter(x => x.im);
  items.sort((a, b) => b.im.h - a.im.h || a.rec - b.rec || String(a.tag || '').localeCompare(String(b.tag || '')));
  let x = 0, y = 0, rowH = 0; const placed = [];
  for (const it of items) {
    if (x + it.im.w > maxW) { x = 0; y += rowH + pad; rowH = 0; }
    placed.push({ ...it, x, y, w: it.im.w, h: it.im.h, ox: it.im.ox, oy: it.im.oy });
    x += it.im.w + pad; rowH = Math.max(rowH, it.im.h);
  }
  const H = y + rowH, cv = new D.Canvas(maxW, Math.max(1, H));
  for (const p of placed) cv.blit(p.im, p.x, p.y);
  placed.sort((a, b) => a.rec - b.rec || String(a.tag || '').localeCompare(String(b.tag || '')));
  return { cv, frames: placed.map(p => { const o = { rec: p.rec, x: p.x, y: p.y, w: p.w, h: p.h, ox: p.ox, oy: p.oy, pal: palsOf(p.rec) }; for (const [k, v] of Object.entries(p.meta || {})) o[k] = v; return o; }) };
}
function heroRecordUse(h) {
  const use = new Map();
  for (const [key, l] of Object.entries(h.lists)) for (const an of l.anims) if (an.frames) for (const f of an.frames) {
    const add = r => { if (r == null || r < 0 || r >= R.REC_COUNT) return; const u = use.get(r) || []; if (u.length < 6 && !u.includes(`${key}:${an.index}`)) u.push(`${key}:${an.index}`); use.set(r, u); };
    if (f.parts) f.parts.forEach(p => add(p.rec)); add(f.rec); add(f.rec2);
  }
  return use;
}
const atlasInfo = {};
J.heroes.forEach(h => {
  const use = heroRecordUse(h), extra = X.extraRecords()[h.key] || [];
  const items = [...use.keys()].map(rec => ({ rec, meta: { usedBy: use.get(rec) } })).concat(extra.filter(([r]) => !use.has(r)).map(([rec, what]) => ({ rec, meta: { extra: true, looks: what, usedBy: [] } })));
  const { cv, frames } = pack(items, 1024);
  cv.png(path.join(OUT, `atlas-${h.key}.png`));
  fs.writeFileSync(path.join(OUT, `atlas-${h.key}.json`), JSON.stringify({ hero: h.name, image: `atlas-${h.key}.png`, size: [cv.w, cv.h], palette: `ROM OBJ palette rows at full brightness; ${h.name} uses OBJ slot ${h.palette} only, which holds the same ROM row in every stage area`, origin: '(ox, oy) = feet origin inside the frame box; art faces left (mirror around ox for facing right)', extra: 'frames with extra: true are the hero\'s records that no animation uses (hero-extras.cjs extraRecords)', frames }, null, 1));
  atlasInfo[h.key] = { records: frames.length, extraRecords: frames.filter(f => f.extra).length, size: [cv.w, cv.h] };
});
// weapons: every weapon-set record + every record drawn by the shot / effect objects seen while firing + the flame
const wuse = new Map();
const addUse = (r, u) => { if (r == null || r <= 0 || r >= R.REC_COUNT) return; const a = wuse.get(r) || []; if (!a.includes(u) && a.length < 6) a.push(u); wuse.set(r, a); };
for (const ws of Object.values(J.weaponSets)) for (const an of ws.anims) if (an.frames) for (const f of an.frames) { const u = `${ws.users.join('/')} anim ${an.index}`; if (f.parts) f.parts.forEach(p => addUse(p.rec, u)); addUse(f.rec, u); addUse(f.rec2, u); }
const fxRecs = new Set();
for (const per of Object.values(firing.perWeapon)) for (const [hk, r] of Object.entries(per)) {
  if (hk.startsWith('byHero')) continue;
  for (const k of r.spawnedPerKind) if (k.recordSequence) for (const t of k.recordSequence.split(' ')) for (const q of t.split('x')[0].split('+')) if (/^\d+$/.test(q) && +q > 2) fxRecs.add(+q);
  for (const t of r.thrown) for (const q of t.records) if (typeof q === 'number') fxRecs.add(q);
}
fxRecs.forEach(r => addUse(r, 'shot / effect object'));
for (const an of Object.values(FLAME.anims)) for (const f of an.frames) addUse(f.rec, `torch flame (${an.addr})`);
for (const b of bullet) if (b.animFrames) for (const f of b.animFrames) addUse(f.rec, `bullet subtype ${b.subtype}`);
{
  const items = [...wuse.keys()].sort((a, b) => a - b).map(rec => {
    const pals = palsOf(rec), v = pals.find(p => varSlots.has(p) && HOME[p]);
    const it = { rec, meta: { usedBy: wuse.get(rec) } };
    if (v != null) { const rm = homeRemap(v); it.remap = rm; it.meta.stageDependentSlot = v; it.meta.drawnWith = `slot ${v} = ROM row ${rm.row} (home: EPISODE ${HOME[v].episode} area ${HOME[v].area}); other areas: atlas-stagepal.json`; }
    return it;
  });
  const { cv, frames } = pack(items, 1024);
  cv.png(path.join(OUT, 'atlas-weapons.png'));
  fs.writeFileSync(path.join(OUT, 'atlas-weapons.json'), JSON.stringify({ image: 'atlas-weapons.png', size: [cv.w, cv.h], palette: 'ROM OBJ palette rows at full brightness. Slots 4-9 (weapons, effects, fire) and 0-3 (the knife uses slot 0) are the same in every area. Records in slot 30 (B. KNIFE) and 28 (YOROI) are drawn with their home-area row (stagePalettes.home); atlas-stagepal has every other area.', origin: '(ox, oy) = the object origin inside the frame box; art faces left', frames }, null, 1));
  atlasInfo.weapons = { records: frames.length, size: [cv.w, cv.h], effectRecords: fxRecs.size, flameRecords: [...new Set(Object.values(FLAME.anims).flatMap(a => a.frames.map(f => f.rec)))] };
}
// stage-dependent weapon records: one copy per distinct ROM row over all areas
{
  const recs = [...wuse.keys()].filter(r => palsOf(r).some(p => varSlots.has(p) && HOME[p])), items = [];
  for (const rec of recs) for (const slot of palsOf(rec).filter(p => HOME[p])) {
    const rows = new Map(); for (const a of STAGEPAL.areas) { const k = a.rows[slot]; (rows.get(k) || rows.set(k, []).get(k)).push(`E${a.episode}a${a.area}`); }
    for (const [row, areas] of rows) items.push({ rec, tag: `${slot}-${row}`, remap: { tag: `s${slot}-r${row}`, rows: { [slot]: X.rowRGB(row) } }, meta: { slot, romRow: row, romAddr: hex(0xB7A52 + row * 32), areas, home: areas.includes(`E${HOME[slot].episode}a${HOME[slot].area}`) } });
  }
  const { cv, frames } = pack(items, 1024);
  cv.png(path.join(OUT, 'atlas-stagepal.png'));
  fs.writeFileSync(path.join(OUT, 'atlas-stagepal.json'), JSON.stringify({ image: 'atlas-stagepal.png', size: [cv.w, cv.h], note: 'B. KNIFE (slot 30) and YOROI (slot 28) records once per ROM palette row the slot holds in some stage area (table 0x8E8E; scrolled-into areas keep the previous area\'s rows). areas = where that colouring is seen; home = the item\'s home area.', origin: '(ox, oy) = object origin; art faces left', frames }, null, 1));
  atlasInfo.stagepal = { records: recs.length, variants: frames.length, size: [cv.w, cv.h] };
  stagePalOut.usedByHeroesAndWeapons = { slots: [...new Set(recs.flatMap(palsOf).filter(p => varSlots.has(p)))], records: recs };
}
// speech bubbles
{
  const owner = {}; BUB.perHero.forEach(p => { p.victory.forEach(v => { owner[v.rec] = { hero: NAMES[p.id], use: 'victory', subtype: v.subtype }; }); owner[p.teamUp.rec] = { hero: NAMES[p.id], use: 'team-up', subtype: p.teamUp.subtype }; });
  const items = []; for (let r = 1593; r <= 1607; r++) items.push({ rec: r, meta: { text: BUB.TEXT[r], ...(owner[r] || { hero: null, use: 'not spawned by the hero code (set 0x93C82 / other objects)' }) } });
  const { cv, frames } = pack(items, 512);
  cv.png(path.join(OUT, 'atlas-bubbles.png'));
  fs.writeFileSync(path.join(OUT, 'atlas-bubbles.json'), JSON.stringify({ image: 'atlas-bubbles.png', size: [cv.w, cv.h], placement: BUB.placement, timing: BUB.timing, palette: BUB.palette, origin: '(ox, oy) = the bubble object origin (spawned 96 px above the hero\'s feet); never mirrored', frames }, null, 1));
  atlasInfo.bubbles = { records: frames.length, size: [cv.w, cv.h] };
}
log('atlases', JSON.stringify(atlasInfo));

// ------------------------------------------------------------------------------------------- 9b. colour check
// the atlases + JSON placements against MAME's real screenshots (RGB): hero, weapon, torch flame, bubbles, ground items
const SC = require('./lib/snapcheck.cjs');
const colour = { method: 'lib/snapcheck.cjs: for every snapshot s of the run, the RAM at s-2 places the hero (JSON frames + bob), its weapon (hold table + pose row), the torch flame, bubbles and ground containers; each is drawn from the exported atlas PNGs (ground containers from atlas-stagepal in the area of the run) in CPS-1 priority order and compared with the screenshot pixel by pixel (RGB). Pixels covered by other objects (enemies, caption text, HUD) count as misses.', runs: [] };
{
  const cropDir = path.join(OUT, 'snapcheck'); fs.mkdirSync(cropDir, { recursive: true });
  const SNAPRUNS = KEYS.map((k, c) => [`ex-heroes-snap-${k}-torch`, c, 'E1a0']).concat([['ex-heroes-snap-jack-bknife-e2a2', 0, 'E2a2'], ['ex-heroes-snap-jack-yoroi-e1a1', 0, 'E1a1']], KEYS.map((k, c) => [`ex-heroes-victory-${k}`, c, 'E1a0']));
  const tk = {};
  for (const [run, c, area] of SNAPRUNS) {
    if (!runExists(run)) continue;
    const r = SC.checkRun(run, { J: { heroes: J.heroes, weaponSets: J.weaponSets, companions: J.companions }, dir: OUT, hero: c, area, crops: /bknife|yoroi|mustapha-torch|victory-jack/.test(run) ? 3 : 0, cropDir });
    colour.runs.push({ run, area, snapshots: r.snapshots, pixels: r.pixels, agreement: r.agreement, byKind: r.byKind });
    for (const [k, v] of Object.entries(r.byKind)) { const o = tk[k] = tk[k] || { px: 0, same: 0 }; o.px += v.px; o.same += v.same; }
  }
  for (const o of Object.values(tk)) o.agreement = o.px ? +(o.same / o.px).toFixed(5) : null;
  colour.byKind = tk;
  colour.oldBknifeColours = { note: 'the previous export drew the B. KNIFE with ROM row 30 (palette set 0 slot 30), which no area loads into slot 30', row30VsHomeRow: X.rowWords(30).map((w, i) => w === X.rowWords(homeRemap(30).row)[i]).filter(x => !x).length + ' of 16 colours differ from the E2 a2 row ' + homeRemap(30).row };
  colour.crops = 'work/re/extract/heroes/snapcheck/ (screenshot | JSON + atlas render | grey = same, magenta = different)';
}
log('colour', JSON.stringify(colour.byKind));

// ------------------------------------------------------------------------------------------- 10. contact sheets
const classOfWeapon = Object.fromEntries(J.weapons.map(w => [w.key, w.class]));
const variantFor = cls => ({ '0x201': 'grenade', '0x202': 'knife', '0x203': 'torch', '0x204': 'gun', '0x205': 'rifle', '0x206': 'uzi', '0x207': 'm16', '0x208': 'shotgun', '0x209': 'bazooka', '0x20A': 'container-drum' })[cls];
function weaponOverlayFor(h, an) {   // which weapon to draw on a weapon-list anim: from its tables
  for (const [cls, a] of Object.entries(h.stance.standAnimByClass)) if (a === an.index && variantFor(cls)) return variantFor(cls);
  for (const [cls, a] of Object.entries(h.attackTable.byClass)) if (a === an.index && variantFor(cls)) return variantFor(cls);
  for (const [cls, a] of Object.entries(h.stance.walkTorsoAnimByClass)) if (a === an.index && variantFor(cls)) return variantFor(cls);
  if (an.index === h.runTorso.gunsAtLeast0x205) return 'rifle';
  if (an.index === h.smgWalkFireTorso.uzi0x206) return 'uzi';
  if (h.attackTable.containerBySubtype.includes(an.index) || Object.values(h.containerJumps).some(c => c.anim === an.index)) return 'container-drum';
  return null;
}
let flamePhase = 0;
function weaponBlocks(h, f, fx, fy, variant, blocks, tdx = 0, tdy = 0, chain = 'burning') {
  if (!variant || f.hold == null || f.hold < 0) return null;
  const v = J.weaponVariants.find(x => x.key === variant), he = h.holds.entries[f.hold];
  const anim = he && h.poseRows[v.slot].anims[f.hold];
  if (anim == null || anim < 0) return null;
  const wf = J.weaponSets[v.set].anims[anim].frames[0], ox = fx + he.dx + tdx, oy = fy - he.dy - tdy;
  if (variant === 'torch') { const e = X.flameFor(FLAME, wf); const ch = FLAME.anims[chain], fr = ch.frames[(flamePhase++) % ch.frames.length]; if (e) M.placeFrame(fr, ox + e.offset[0], oy + e.offset[1], false, null, 'flame', blocks); }
  M.placeFrame(wf, ox, oy, false, null, 'weapon', blocks);
  return { hold: f.hold, anim, rec: wf.rec, origin: [he.dx + tdx, -(he.dy + tdy)] };
}
function paintBlocks(cv, blocks, clip, remap = null) {
  const PAL = R.paletteSet(0);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const o = blocks[i], fx = !!(o.attr & 0x20), fy = !!(o.attr & 0x40), pal = o.attr & 31;
    for (let r = 0; r < o.bh; r++) for (let c = 0; c < o.bw; c++) {
      const col = fx ? o.bw - 1 - c : c, row = fy ? o.bh - 1 - r : r, t = R.tile((o.code & ~0xF) + ((o.code + col) & 0xF) + 0x10 * row);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const pen = t[(fy ? 15 - y : y) * 16 + (fx ? 15 - x : x)]; if (pen === 15) continue;
        const X2 = o.sx + c * 16 + x, Y = o.sy + r * 16 + y;
        if (clip && (X2 < clip[0] || Y < clip[1] || X2 >= clip[0] + clip[2] || Y >= clip[1] + clip[3])) continue;
        const col3 = remap && remap[pal] ? remap[pal][pen] : PAL[pal][pen]; cv.set(X2, Y, [col3[0], col3[1], col3[2], 255]);
      }
    }
  }
}
const homeRows = Object.fromEntries(Object.keys(HOME).map(s => [s, homeRemap(+s).rows[s]]));
for (const h of J.heroes) {
  const rows = [];
  for (const [key, l] of Object.entries(h.lists)) for (const an of l.anims) {
    if (an.terminator) continue;
    const variant = key === 'weapon' ? weaponOverlayFor(h, an) : null;
    rows.push({ label: `${key}:${an.index} [${an.status}] ${an.name}`.replace(/—/g, '-').replace(/"/g, "'"), notes: [`${an.addr}${an.loopFrame != null ? ' loop->' + an.loopFrame : an.loopTarget ? ' loop->' + (an.loopTarget.list || '') + ':' + (an.loopTarget.anim != null ? an.loopTarget.anim : '?') : ''}${variant ? ' w/' + variant : ''}`], frames: an.frames, variant });
  }
  const CW = 100, CH = 128, LW = 300, COLS = 12, CPL = 48;
  const lines = rows.map(r => Math.max(Math.ceil(r.frames.length / COLS), Math.ceil((Math.ceil(r.label.length / CPL) + 2) * 10 / CH)));
  const H = lines.reduce((a, b) => a + b, 0) * CH, W = LW + COLS * CW, cv = new D.Canvas(W, H, [36, 40, 48, 255]);
  let y = 0;
  rows.forEach((r, ri) => {
    cv.fill(0, y, W, 1, [80, 84, 96, 255]);
    const t = r.label.match(new RegExp(`.{1,${CPL}}`, 'g')) || ['']; t.forEach((s, k) => cv.text(s, 4, y + 4 + k * 10, [255, 255, 160]));
    r.notes.forEach((s, k) => cv.text(s, 4, y + 4 + (t.length + k) * 10, [170, 200, 255]));
    flamePhase = 0;
    r.frames.forEach((f, i) => {
      const cx = LW + (i % COLS) * CW, cy = y + Math.floor(i / COLS) * CH, fx = cx + Math.floor(CW / 2) + 8, fy = cy + CH - 16, clip = [cx + 1, cy + 1, CW - 1, CH - 1];
      cv.fill(cx, cy, 1, CH, [56, 60, 70, 255]);
      const blocks = []; const flameFirst = [];
      weaponBlocks(h, f, fx, fy, r.variant, flameFirst);
      M.placeFrame(f, fx, fy, false, null, 'hero', blocks);
      paintBlocks(cv, flameFirst.concat(blocks), clip, homeRows);
      cv.cross(fx, fy);
      cv.text(`${f.rec != null ? f.rec : 'C' + f.hitRec}${f.rec2 != null ? '+' + f.rec2 : ''}/${f.dur}`, cx + 2, cy + CH - 10, [210, 210, 210]);
      if (f.hold != null && f.hold >= 0) cv.text('H' + f.hold.toString(16), cx + 2, cy + 2, [120, 255, 160]);
    });
    y += lines[ri] * CH;
  });
  cv.png(path.join(OUT, `sheet-${h.key}.png`));
}
// extras sheet: torch flame chains, bubbles per hero, Cadillac seat, unused records, B. KNIFE / YOROI per area
{
  const rows = [];
  rows.push({ label: 'TORCH FLAME burning chain 0x29CB6 (pool A type 0x18, palette 9)', cells: FLAME.anims.burning.frames.map(f => ({ rec: f.rec, cap: `${f.rec}/${f.dur}` })) });
  rows.push({ label: 'TORCH FLAME running chain 0x29CF4 (holder running)', cells: FLAME.anims.running.frames.map(f => ({ rec: f.rec, cap: `${f.rec}/${f.dur}` })) });
  for (const p of BUB.perHero) rows.push({ label: `${NAMES[p.id]} bubbles: victory x2, team-up`, cells: p.victory.concat([p.teamUp]).map(v => ({ rec: v.rec, cap: `${v.rec} s${v.subtype}` })) });
  rows.push({ label: 'other bubble records (not spawned by heroes)', cells: [1605, 1606, 1607].map(r => ({ rec: r, cap: String(r) })) });
  rows.push({ label: 'main:29 seated in the Cadillac (Jack, Mustapha, Hannah, Mess)', cells: [2700, 2696, 2697, 2698, 2699, 2701].map(r => ({ rec: r, cap: String(r) })) });
  for (const h of J.heroes) { const ex = X.extraRecords()[h.key] || []; if (ex.length) rows.push({ label: `${h.name}: records no animation uses`, cells: ex.map(([r]) => ({ rec: r, cap: String(r) })) }); }
  for (const slot of [30, 28]) {
    const rec = slot === 30 ? 1700 : 3288, seen = new Map();
    for (const a of STAGEPAL.areas) { const row = a.rows[slot]; if (!seen.has(row)) seen.set(row, []); seen.get(row).push(`E${a.episode}A${a.area}`); }
    rows.push({ label: `${slot === 30 ? 'B. KNIFE' : 'YOROI'} (slot ${slot}) per ROM row, home E${HOME[slot].episode}A${HOME[slot].area}`, cells: [...seen].map(([row, areas]) => ({ rec, remap: { tag: `s${slot}-r${row}`, rows: { [slot]: X.rowRGB(row) } }, cap: `R${row} ${areas.slice(0, 2).join(' ')}` })) });
  }
  const CW = 150, CH = 120, LW = 250, COLS = Math.max(...rows.map(r => r.cells.length));
  const cv = new D.Canvas(LW + COLS * CW, rows.length * CH, [36, 40, 48, 255]);
  rows.forEach((r, ri) => {
    const y = ri * CH; cv.fill(0, y, cv.w, 1, [80, 84, 96, 255]);
    (r.label.match(/.{1,40}/g) || ['']).forEach((s, k) => cv.text(s, 4, y + 4 + k * 10, [255, 255, 160]));
    r.cells.forEach((c, i) => { const cx = LW + i * CW, fx = cx + CW / 2, fy = y + CH - 20; cv.fill(cx, y, 1, CH, [56, 60, 70, 255]); cv.record(c.rec, fx, fy, { clip: [cx + 1, y + 1, CW - 1, CH - 1], remap: c.remap || null }); cv.cross(fx, fy); cv.text(c.cap, cx + 2, y + CH - 10, [210, 210, 210]); });
  });
  cv.png(path.join(OUT, 'sheet-extras.png'));
}
log('sheets written');

// ------------------------------------------------------------------------------------------- 11. render grid
// every hero x every weapon x idle / walk / run / jump / fire, built only from heroes.json (left-facing)
const POSES = ['idle', 'walk', 'run', 'jump', 'fire'];
const gridRows = [];
{
  const CW = 120, CH = 120, LW = 112, cols = WKEYS.length * POSES.length;
  const W = LW + cols * CW, Hh = 24 + J.heroes.length * CH, cv = new D.Canvas(W, Hh, [30, 34, 42, 255]);
  WKEYS.forEach((w, k) => { cv.text(w, LW + k * POSES.length * CW + 4, 2, [255, 255, 160]); POSES.forEach((p, j) => cv.text(p, LW + (k * POSES.length + j) * CW + 4, 12, [170, 200, 255])); });
  J.heroes.forEach((h, c) => {
    cv.text(h.name, 4, 24 + c * CH + 4, [255, 255, 160]);
    WKEYS.forEach((w, k) => {
      const cls = classOfWeapon[w], lo = parseInt(cls, 16) & 0xFF;
      const L = h.lists;
      const stand = h.stance.standAnimByClass[cls], walkT = h.stance.walkTorsoAnimByClass[cls];
      const runT = lo >= 5 ? h.runTorso.gunsAtLeast0x205 : (lo === 3 && h.id !== 0 ? h.runTorso.blunt0x203 : null);
      const atk = h.attackTable.byClass[cls];
      const pick = (list, a, fi = 0) => { const an = L[list].anims[a]; return an && an.frames ? an.frames[Math.min(fi, an.frames.length - 1)] : null; };
      const keyFrame = an => { if (!an || !an.frames) return 0; let best = 0; an.frames.forEach((f, i) => { if (f.b4 && !an.frames[best].b4) best = i; }); return best; };
      const poses = {
        idle: { torso: stand != null ? pick('weapon', stand) : pick('main', 0), legs: null, ref: stand != null ? `weapon:${stand}` : 'main:0' },
        walk: walkT != null ? { torso: pick('weapon', walkT), legs: pick('main', 16, 2), bob: h.bob.entries[2], ref: `weapon:${walkT}+main:16.2` } : { torso: pick('main', 1, 2), legs: null, ref: 'main:1.2' },
        run: runT != null ? { torso: pick('weapon', runT), legs: pick('main', 11, 2), bob: h.bob.run[2], ref: `weapon:${runT}+main:11.2` } : { torso: pick('main', 9, 0), legs: null, ref: 'main:9.0' },
        jump: { torso: pick('main', 3, 2), legs: null, ref: 'main:3.2' },
        fire: atk != null ? { torso: pick('weapon', atk, keyFrame(L.weapon.anims[atk])), legs: null, ref: `weapon:${atk}.${keyFrame(L.weapon.anims[atk])}` } : { torso: null, ref: 'none' },
      };
      POSES.forEach((p, j) => {
        const P = poses[p], cx = LW + (k * POSES.length + j) * CW, cy = 24 + c * CH, fx = cx + 72, fy = cy + CH - 14, clip = [cx + 1, cy + 1, CW - 1, CH - 1];
        cv.fill(cx, cy, 1, CH, [56, 60, 70, 255]); if (!P.torso) return;
        const blocks = [];
        const tdx = P.bob ? P.bob.dx : 0, tdy = P.bob ? P.bob.dy : 0;
        flamePhase = 0;
        const wInfo = weaponBlocks(h, P.torso, fx, fy, w, blocks, tdx, tdy, p === 'run' ? 'running' : 'burning');
        M.placeFrame(P.torso, fx + tdx, fy - tdy, false, null, 'torso', blocks);
        if (P.legs) M.placeFrame(P.legs, fx, fy, false, null, 'legs', blocks);
        paintBlocks(cv, blocks, clip, homeRows); cv.cross(fx, fy);
        gridRows.push({ hero: h.name, weapon: w, pose: p, anim: P.ref, weapon_: wInfo });
      });
    });
  });
  cv.png(path.join(OUT, 'grid-heroes-weapons.png'));
}
M.setCull(true);

// ------------------------------------------------------------------------------------------- 12. write JSON
const status = {}; for (const h of J.heroes) for (const l of Object.values(h.lists)) for (const an of l.anims) if (!an.terminator) status[an.status] = (status[an.status] || 0) + 1;
const out = {
  meta: {
    generator: 'tools/re/export/heroes.cjs (static) + tools/re/export/heroes-live.cjs (MAME runs)', rom: 'MAME set dino (the user\'s dump), program image work/re/dino-prg.bin',
    conventions: {
      art: 'native ROM orientation = facing LEFT. Facing right mirrors around the feet origin: x -> -x - 1 per pixel (block: sx = feetX - layout.x - 16*w, V05).',
      offsets: 'screen pixels relative to the hero\'s feet, x right, y DOWN (origin [dx, -dy] where dy is height, up = positive).',
      durations: '60 Hz frames (+0x2F counter, 0x1426). dur 0 holds 256 frames. Starting an animation: its first frame usually shows dur - 1 frames, because the state handler that starts it also ticks it in the same frame (firstFrame.byCaller lists every live start path; 1,291 of 1,979 live starts were dur - 1, 333 were dur). Every later frame, and a loop back to a frame, lasts exactly dur.',
      frames: 'hero frame = 12 bytes: rec (w0/4), rec2 (w1/4, drawn under rec at the same origin) or composite parts, b4..b6 -> +0x2C..+0x2E (b4 is the attack/action trigger byte: e.g. knife 1 = stab hit, 2 = release; victory pose: shows the bubble), dur, last, w8 -> +0x48, w10 -> +0x60 (hold = high byte, signed; < 0 = weapon hidden). Loop: loopFrame (same anim) or loopTarget (another anim).',
      labels: 'per hero. status observed = started live (callers / runs listed); observed + table / table = selected by a decoded class table; static = started by a call site in the shared player code that this hero can reach (SITES); unused = the call site exists but this hero can never reach it (unreachableBecause), the data is a copy; visual = no call site found, described from the hero\'s own records; unknown = not identified. labels.looks describes the hero\'s own records; labels.sameDataAs lists identical anims.',
      states: 'a.b.c.d = player +0x04/+0x05/+0x06/+0x07 (MEMORY-MAP R6).',
      blockCulling: 'the draw skips a block unless 0x40 <= X + 16*w and X <= 0x1C0 (X = screen x + 64, V04); the validation models it',
    },
    sources: ['tools/re/MEMORY-MAP.md V04-V07, V13-V16, V19-V24, R1, R2, R6', 'work/re/memory-map.json', 'work/re/extract/stages (area palettes, scrolled-into areas)', 'work/re/extract/bosses (BUTCHER home area)'],
    labelStatus: status,
  },
  heroes: J.heroes, weapons: J.weapons, weaponVariants: J.weaponVariants, containersNotCarried: J.containersNotCarried, weaponSets: J.weaponSets,
  companions: J.companions, itemPlacements: ITEMS, teamUp: TEAM, victory: VICTORY, bubbles: { ...BUB, TEXT: undefined, live: VICTORY.live.bubbles }, cadillac: CAR, extraRecords: X.extraRecords(), stagePalettes: stagePalOut, firstFrame: FIRST,
  callSites, firing, validation: { ...validation, colour }, evidence, atlases: atlasInfo, grid: { image: 'grid-heroes-weapons.png', cells: gridRows },
  liveRuns: { labelling: events.filter(e => !/arm-/.test(e.run)).map(e => e.run), armed: events.filter(e => /arm-/.test(e.run)).map(e => e.run), note: 'work/re/runs/<run>/ (plan.json, frames.jsonl, hook.jsonl = animation-start taps)' },
};
fs.writeFileSync(path.join(OUT, 'heroes.json'), JSON.stringify(out, null, 1));
log('heroes.json written', (fs.statSync(path.join(OUT, 'heroes.json')).size / 1e6).toFixed(1) + ' MB', 'label status', JSON.stringify(status));
