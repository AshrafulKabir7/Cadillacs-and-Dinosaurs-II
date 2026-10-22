// Enemies family of the ROM sprite data (PLAN §3.2, §4.1, §5.2; ENEMIES §2.1-§2.9; WP-C).
//   node tools/re/build-game-assets.cjs sprites enemies        (or: node tools/re/build/sprites-enemies.cjs)
// Inputs : work/re/extract/enemies/<type>.json + atlases, work/re/extract/bosses/<dino>.json + atlases (R HOPPER, ZEKE and
//          the scenery dinosaurs), tools/re/build/pack-config.json `enemies`, enemy-kinds.js (every ENEMY_KINDS anim ref
//          is shipped), the ROM (records 0xD0CF4/0xD43D8 through rom.cjs, attack records 0xA2EA4, rank rows 0x2C3AE,
//          OBJ palette rows 0xB7A52 and the per-area maps 0x8E8E) and the knife man live logs (work/re/runs/en-knifeman-*,
//          optional) for the knife-in-hand attach table.
// Outputs: sprite-data-enemies.js (SPRITE_DATA.add('enemies', …), indexed sheets: R = OBJ slot, G = pen, B = 0, A = 255),
//          work/re/pack/enemies-<type>.png contact sheets, work/re/pack/enemies-report.json.
// The record renderer follows the verified draw model (tools/re/verify-live/drawmodel.cjs): block 0 is in front, a record
// without per-block attributes uses its flags word as the attribute of every block, a composite frame's first part is in
// front, rec2 is drawn at the same origin behind rec. Composite frames are flattened into one box per frame.
// Deterministic: inputs in a fixed order, frames sorted by signature, MaxRects packing with stable ids, sorted keys.
'use strict';
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const EXTRACT = path.join(ROOT, 'work', 're', 'extract');
const PACK_DIR = path.join(ROOT, 'work', 're', 'pack');
const RUNS = path.join(ROOT, 'work', 're', 'runs');
const ATTACK_TABLE = 0xA2EA4, RANK_TABLE = 0x2C3AE;

let R_ = null; const R = () => R_ || (R_ = require('../rom.cjs'));
let P_ = null; const PAL = () => P_ || (P_ = require('./palettes.cjs'));
let BGA_ = null; const BGA = () => BGA_ || (BGA_ = require('../build-game-assets.cjs'));
const png = require('./png.cjs'), atlas = require('./atlas-pack.cjs'), emit = require('./emit.cjs');

const hex = (v, n = 0) => '0x' + Number(v).toString(16).toUpperCase().padStart(n, '0');
const normSet = s => (typeof s === 'number' ? hex(s) : /^0x[0-9a-f]+$/i.test(String(s)) ? hex(parseInt(s, 16)) : String(s));
const akey = (set, i) => `${normSet(set)}:${i}`;
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

// ================================================================ records (drawmodel semantics)
const recCache = new Map();
function recInfo(i) {
  if (recCache.has(i)) return recCache.get(i);
  let r = null;
  if (i >= 0 && i < R().REC_COUNT) {
    r = R().parseRecord(i);
    if (r) {
      const perBlock = !!(r.flags & 0x8000);
      if (!perBlock) r.blocks = r.blocks.map(b => ({ ...b, attr: r.flags, pal: r.flags & 31, flipX: !!(r.flags & 0x20), flipY: !!(r.flags & 0x40) }));
      r.perBlock = perBlock;
    }
  }
  recCache.set(i, r);
  return r;
}
const shadowCache = new Map();
function isShadowBlock(b) {
  const k = `${b.code},${b.w},${b.h}`;
  if (shadowCache.has(k)) return shadowCache.get(k);
  let solid0 = true, any0 = false;
  for (let ty = 0; ty < b.h && solid0; ty++) for (let tx = 0; tx < b.w && solid0; tx++) {
    const t = R().tile(b.code + tx + ty * 16);
    for (let q = 0; q < 256; q++) { if (t[q] === 0) any0 = true; else if (t[q] !== 15) { solid0 = false; break; } }
  }
  const v = solid0 && any0; shadowCache.set(k, v); return v;
}
function recBounds(i, dx, dy) {
  const r = recInfo(i); if (!r || !r.offs.length) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  r.blocks.forEach((b, k) => { const o = r.offs[k]; if (!o) return; x0 = Math.min(x0, o.x + dx); y0 = Math.min(y0, o.y + dy); x1 = Math.max(x1, o.x + dx + b.w * 16); y1 = Math.max(y1, o.y + dy + b.h * 16); });
  return x0 > x1 ? null : { x0, y0, x1, y1 };
}
// indexed canvas {w, h, ox, oy, pen, slot, set}; earlier blocks end up in front, so paint from the last block to the first
function paintRec(cv, i, dx, dy) {
  const r = recInfo(i); if (!r) return { shadow: false, slots: [] };
  let shadow = false; const slots = new Set();
  for (let k = r.blocks.length - 1; k >= 0; k--) {
    const b = r.blocks[k], o = r.offs[k]; if (!o) continue;
    if (isShadowBlock(b)) shadow = true;
    slots.add(b.pal);
    for (let ty = 0; ty < b.h; ty++) for (let tx = 0; tx < b.w; tx++) {
      const t = R().tile(b.code + tx + ty * 16);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const pen = t[y * 16 + x]; if (pen === 15) continue;
        let lx = tx * 16 + x, ly = ty * 16 + y;
        if (b.flipX) lx = b.w * 16 - 1 - lx;
        if (b.flipY) ly = b.h * 16 - 1 - ly;
        const X = cv.ox + dx + o.x + lx, Y = cv.oy + dy + o.y + ly;
        if (X < 0 || Y < 0 || X >= cv.w || Y >= cv.h) continue;
        const q = Y * cv.w + X; cv.pen[q] = pen; cv.slot[q] = b.pal; cv.set[q] = 1;
      }
    }
  }
  return { shadow, slots: [...slots] };
}
function newCanvas(x0, y0, x1, y1) { const w = x1 - x0, h = y1 - y0; return { w, h, ox: -x0, oy: -y0, pen: new Uint8Array(w * h), slot: new Uint8Array(w * h), set: new Uint8Array(w * h) }; }
// parts [{rec, dx, dy}] (screen px, y down, native left-facing), first part in front -> indexed image (untrimmed)
function composeIdx(parts) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of parts) { const b = recBounds(p.rec, p.dx, p.dy); if (!b) continue; x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  if (x0 > x1) return null;
  const cv = newCanvas(x0, y0, x1, y1); let shadow = false; const slots = new Set();
  for (let k = parts.length - 1; k >= 0; k--) { const r = paintRec(cv, parts[k].rec, parts[k].dx, parts[k].dy); shadow = shadow || r.shadow; r.slots.forEach(s => slots.add(s)); }
  cv.shadow = shadow; cv.slots = [...slots].sort((a, b) => a - b);
  return cv;
}
// tight box around the opaque pixels (keeps ox/oy relative to the feet origin)
function trim(cv) {
  let x0 = cv.w, y0 = cv.h, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.h; y++) for (let x = 0; x < cv.w; x++) if (cv.set[y * cv.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = { w, h, ox: cv.ox - x0, oy: cv.oy - y0, pen: new Uint8Array(w * h), slot: new Uint8Array(w * h), set: new Uint8Array(w * h), shadow: cv.shadow, slots: cv.slots };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y0 + y) * cv.w + x0 + x, d = y * w + x; out.pen[d] = cv.pen[s]; out.slot[d] = cv.slot[s]; out.set[d] = cv.set[s]; }
  return out;
}
// colour an indexed image: rows(slot) -> [16 x 0xRRGGBB]; override = one slot for every pixel (+0x23 bit 7)
function colourise(img, rowOfSlot, override = null) {
  const out = new Uint8Array(img.w * img.h * 4);
  for (let q = 0; q < img.w * img.h; q++) {
    if (!img.set[q]) continue;
    const c = rowOfSlot(override == null ? img.slot[q] : override)[img.pen[q]];
    out[q * 4] = (c >> 16) & 255; out[q * 4 + 1] = (c >> 8) & 255; out[q * 4 + 2] = c & 255; out[q * 4 + 3] = 255;
  }
  return out;
}
const mapRows = (map, rows) => slot => rows[String(map[slot])] || PAL().rowRGB(map[slot]);

// ================================================================ palette maps
function objMapKey(ep, area, ov) { return `S${ep}A${area}` + (ov != null ? `-p${ov}` : ''); }
function objMapArray(ep, area, ov) { const m = PAL().objMap(ep, area); return ov != null ? new Array(32).fill(m[ov]) : m.slice(); }
class PalBook {
  constructor() { this.rows = {}; this.maps = {}; }
  addRow(key, row24) { this.rows[String(key)] = row24.slice(0, 16); return key; }
  romRow(n) { if (!this.rows[String(n)]) this.rows[String(n)] = PAL().rowRGB(n); return n; }
  addMap(key, arr) { const m = arr.map(e => (typeof e === 'number' ? this.romRow(e) : e)); this.maps[key] = m; return key; }
  objMap(ep, area, ov = null) { const k = objMapKey(ep, area, ov); if (!this.maps[k]) this.addMap(k, objMapArray(ep, area, ov)); return k; }
  rowsOf(key) { const m = this.maps[key]; return slot => this.rows[String(m[slot])]; }
  // gel version of a map: every slot in `slots` -> 'gel:<row>' (palettes.gelRow), every other slot -> the generic gel ramp
  gelMap(key, slots) {
    const k = 'gel-' + key; if (this.maps[k]) { this.gelSlots(k, slots); return k; }
    const base = this.maps[key]; this.addRow('gel', PAL().HAND.gel['*']);
    this.maps[k] = new Array(32).fill('gel'); this.gelSlots(k, slots, base); return k;
  }
  gelSlots(k, slots, base = this.maps[k.slice(4)]) {
    for (const s of slots) { const src = base[s]; const rk = `gel:${src}`; if (!this.rows[rk]) this.addRow(rk, PAL().gelRow(this.rows[String(src)] || PAL().rowRGB(src))); this.maps[k][s] = rk; }
  }
}

// ================================================================ extract readers (enemies format and bosses format)
// normalised anim: {key, set, index, kind:'main'|'held'|'down'|'hit'|'grab'|'object', label, aliasOf, frames:[{parts, dur, active,
// b6, w8, addr}], loopTo, next, attackIds}
function framePartsOf(f) {
  if (f.composite && Array.isArray(f.parts) && f.parts.length) return f.parts.map(p => ({ rec: p.rec, dx: p.dx | 0, dy: p.dy | 0 }));
  const parts = [{ rec: f.rec, dx: f.dx | 0, dy: f.dy | 0 }];
  if (f.rec2 != null) parts.push({ rec: f.rec2, dx: (f.dx | 0) + (f.dx2 | 0), dy: (f.dy | 0) + (f.dy2 | 0) });
  return parts;
}
const w8Of = f => (f.flags ? (typeof f.flags.w8 === 'string' ? parseInt(f.flags.w8, 16) : f.flags.w8 | 0) : typeof f.w8 === 'string' ? parseInt(f.w8, 16) : f.w8 | 0);
const b6Of = f => (f.flags ? f.flags.b6 | 0 : f.b6 | 0);
function normFrame(f) {
  const b6 = b6Of(f), w8 = w8Of(f);
  return { parts: framePartsOf(f), dur: f.dur | 0, active: !!((b6 & 4) && (w8 & 0xFF)), b6, w8, addr: f.addr };
}
function normLoop(a) {
  const L = a.loopTo;
  if (L == null) return { loop: null, next: null };
  if (typeof L === 'number') return { loop: L, next: null };
  if (L.continuesInto) return { loop: null, next: { key: akey(L.continuesInto.set, L.continuesInto.index), frame: L.continuesInto.frame | 0 } };
  return { loop: null, next: null, outside: L.address || null };
}
function readEnemyType(file) {
  const j = readJSON(file);
  const anims = new Map();
  for (const a of j.animations) {
    const kind = a.kind === 'object' ? 'object' : a.kind;
    const k = akey(a.set, a.index);
    if (anims.has(k)) { const o = anims.get(k); for (const v of a.variants || []) if (!o.variantsSeen.includes(v)) o.variantsSeen.push(v); continue; }
    anims.set(k, { key: k, set: normSet(a.set), index: a.index, kind, label: a.label || a.name || '', aliasOf: a.aliasOf, frames: a.frames.map(normFrame), ...normLoop(a), attackIds: (a.attackIds || []).slice(), variantsSeen: (a.variants || []).slice(), objectType: a.objectType || null, palette: a.palette ?? null });
  }
  return { format: 'enemies', json: j, anims };
}
function readBossEntity(file) {
  const j = readJSON(file);
  const anims = new Map();
  for (const a of j.animations) {
    const kind = a.kind === 'reaction-hit' ? 'hit' : a.kind === 'reaction-grab' ? 'grab' : a.kind || 'main';
    const k = akey(a.set, a.index);
    if (anims.has(k)) continue;
    anims.set(k, { key: k, set: normSet(a.set), index: a.index, kind, label: a.name || '', aliasOf: null, frames: a.frames.map(normFrame), ...normLoop(a), attackIds: (a.live && a.live.attackIds) ? a.live.attackIds.slice() : [] });
  }
  return { format: 'bosses', json: j, anims };
}
// atlas frames of an extract file: Map rec -> [{key, pal (override or null), x, y, w, h, ox, oy, variants, palSlots}]
function readAtlas(jsonFile, pngFile) {
  const aj = readJSON(jsonFile), img = png.read(pngFile), byRec = new Map();
  for (const fr of aj.frames) {
    const e = { key: fr.key || String(fr.rec), rec: fr.rec, x: fr.x, y: fr.y, w: fr.w, h: fr.h, ox: fr.ox, oy: fr.oy, variants: fr.variants || null, pal: Array.isArray(fr.pal) ? null : fr.pal ?? null, palSlots: Array.isArray(fr.pal) ? fr.pal : null };
    if (!byRec.has(fr.rec)) byRec.set(fr.rec, []); byRec.get(fr.rec).push(e);
  }
  return { img, byRec, json: aj };
}

// ================================================================ ROM tables
function attackRecord(id) { const a = ATTACK_TABLE + id * 8; return Array.from(R().prg.subarray(a, a + 8)); }
function rankRow(r84) { const a = RANK_TABLE + r84 * 8; return Array.from(R().prg.subarray(a, a + 32)); }
const atkOf = id => { const b = attackRecord(id); return { id, tbl: b[0], stun: b[1], react: b[2], hitstop: b[4], raw: b }; };

// ================================================================ attack ids per anim (KI14, PLAN §4.1 "every attack carries tbl")
// The id of an anim's attack comes from, in this order (the first rule that gives one wins; `src` says which):
//   live     hits recorded on the anim: the variant's attacks[] (preferred: the id that landed on that anim), the anim's
//            own attackIds, attackIds[].liveAnims;
//   static   the type's handler code at the extract's writtenAt addresses: `move.b #id,($58,A6)` (1D7C 00id 0058) right
//            after an anim start `moveq #n,D0; jsr|jmp $120E` (0x120E = the anim driver's start, MEMORY-MAP V13), or the
//            first anim start that follows it in the same block; an object's id maps onto the object's own set;
//   record   another anim of the same set whose active frame draws the same record and has an id (a roll that ends in
//            the same thrust);
//   variant  the same anim index of another variant of the type (the variants share the handler code);
//   object   the projectile the attack throws or fires (ENEMY_KINDS `obj`): its own record is the attack's;
//   config   pack-config enemies.attackMap (code paths read by hand; each entry carries its note).
// Only the anims ENEMY_KINDS plays as attacks, the objects they throw and the configured objects get inferred ids;
// live ids ship on every anim as before.
const w16 = a => (R().prg[a] << 8) | R().prg[a + 1];
const isAnimStart = b => (w16(b) & 0xFF00) === 0x7000 && (w16(b + 2) === 0x4EB9 || w16(b + 2) === 0x4EF9) && w16(b + 4) === 0 && w16(b + 6) === 0x120E;
const isBlockEnd = b => w16(b) === 0x4E75 || w16(b) === 0x4EF9 || (w16(b) & 0xFF00) === 0x6000;
function animNearWrite(W) {
  if (w16(W) !== 0x1D7C || w16(W + 4) !== 0x0058) return null;                                   // move.b #id,($58,A6)
  for (let b = W - 8; b >= W - 16; b -= 2) if (isAnimStart(b)) return { anim: R().prg[b + 1] << 24 >> 24, at: b, dir: 'before' };
  for (let b = W + 6; b <= W + 48; b += 2) { if (isAnimStart(b)) return { anim: R().prg[b + 1] << 24 >> 24, at: b, dir: 'after' }; if (isBlockEnd(b)) return null; }
  return null;
}
// attack refs of ENEMY_KINDS per type: key -> [{kind, V, id, kindOf, objs:[keys]}]
function kindAttackRefs(kinds, typesInfo) {
  const out = new Map(), add = (k, r) => { if (!out.has(k)) out.set(k, []); out.get(k).push(r); };
  for (const [kid, k] of Object.entries(kinds)) {
    if (!k || typeof k !== 'object' || !k.variants || k.hero || k.parked || typeof kinds.table !== 'function') continue;
    for (const V of Object.keys(k.variants)) {
      const t = kinds.table(kid, V), type = kinds.typeOf(kid, V), info = typesInfo[type] && typesInfo[type][V]; if (!t || !info) continue;
      const res = ref => (ref == null ? null : typeof ref === 'string' ? (/^0x/i.test(ref) ? ref.replace(/^(0x[0-9a-f]+)/i, m => normSet(m)) : null) : Array.isArray(ref[0]) ? res(ref[0]) : info[ref[0]] ? akey(info[ref[0]], ref[1]) : null);
      for (const a of t.atk || []) {
        if (a.variants && !a.variants.includes(V)) continue;
        const objSrc = a.obj == null ? [] : typeof a.obj === 'string' ? [a.obj] : Array.isArray(a.obj) ? a.obj : a.obj[V] ? [a.obj[V]] : Object.values(a.obj);
        const objs = objSrc.map(res).filter(Boolean), key = res(a.a);
        if (key) add(key, { kind: kid, V, type, id: a.id, kindOf: a.kind || 'melee', objs });
        for (const o of objs) add(o, { kind: kid, V, type, id: a.id + ':obj', kindOf: 'object', objs: [] });
      }
    }
  }
  return out;
}
function attackIdsOfType(T, refs, cfgMap, extraObjects) {
  const out = new Map();                                                     // key -> {ids:[...], src}
  const put = (k, ids, src) => { if (!ids.length || !T.anims.has(k)) return false; if (!out.has(k)) out.set(k, { ids: [], src }); const o = out.get(k); for (const id of ids) if (!o.ids.includes(id)) o.ids.push(id); return true; };
  // live (every anim)
  for (const info of Object.values(T.variants)) for (const x of info.liveAttacks) put(x.key, x.ids, 'live');
  for (const a of T.anims.values()) put(a.key, a.attackIds, 'live');
  for (const info of Object.values(T.variants)) for (const x of info.attackIds) if (x.by === 'self') for (const i of x.liveAnims) put(akey(info.main, i), [x.id], 'live');
  // which anims get inferred ids
  const wanted = new Set([...refs.keys(), ...extraObjects].filter(k => T.anims.has(k)));
  const open = () => [...wanted].filter(k => !out.has(k)).sort();
  // static
  const stat = new Map();                                                    // key -> Map(id -> [addresses])
  for (const info of Object.values(T.variants)) for (const x of info.attackIds) for (const W of x.writtenAt) {
    const r = animNearWrite(W); if (!r || r.anim < 0) continue;
    const sets = x.by === 'self' ? [info.main] : x.objectType ? [...new Set(info.objects.filter(o => o.type === x.objectType).flatMap(o => o.sets))] : [];
    for (const s of sets) { const k = akey(s, r.anim); if (!stat.has(k)) stat.set(k, new Map()); const m = stat.get(k); if (!m.has(x.id)) m.set(x.id, []); if (!m.get(x.id).includes(W)) m.get(x.id).push(W); }
  }
  for (const k of open()) if (stat.has(k)) { const m = [...stat.get(k).entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]); put(k, m.map(e => e[0]), `static ${m.map(([id, ws]) => `${id}@${ws.map(w => hex(w)).join('/')}`).join(' ')}`); }
  // same active record in the same set
  const actRec = a => { const f = a.frames.find(x => x.active); return f ? f.parts[0].rec : null; };
  for (const k of open()) {
    const a = T.anims.get(k), r = actRec(a); if (r == null) continue;
    const twin = [...T.anims.values()].filter(b => b.set === a.set && b.key !== k && out.has(b.key) && /^(live|static)/.test(out.get(b.key).src) && b.frames.some(f => f.active && f.parts[0].rec === r)).sort((x, y) => x.index - y.index)[0];
    if (twin) put(k, out.get(twin.key).ids, `record ${twin.key} (active record ${r})`);
  }
  // same index of another variant of the type
  for (let pass = 0; pass < 2; pass++) for (const k of open()) {
    const a = T.anims.get(k); if (!Object.values(T.variants).some(i => i.main === a.set)) continue;
    const sib = Object.values(T.variants).map(i => akey(i.main, a.index)).filter(s => s !== k && out.has(s)).sort()[0];
    if (sib) put(k, out.get(sib).ids, `variant ${sib}`);
  }
  // config (hand-read code paths), then the projectile of an attack
  for (const [k, c] of Object.entries(cfgMap || {})) {
    if (k === '_doc') continue;
    const keys = /:\*$/.test(k) ? [...T.anims.keys()].filter(x => x.startsWith(k.slice(0, -1).replace(/^(0x[0-9a-f]+)/i, m => normSet(m)))) : [k.replace(/^(0x[0-9a-f]+)/i, m => normSet(m))];
    for (const kk of keys) { if (!T.anims.has(kk)) continue; if (out.has(kk) && !out.get(kk).ids.includes(c.id)) { out.get(kk).conflict = `config ${c.id} vs ${out.get(kk).src}`; continue; } if (!out.has(kk)) put(kk, [c.id], `config: ${c.note || ''}`.trim()); }
  }
  for (const k of open()) {
    const objs = [...new Set((refs.get(k) || []).flatMap(r => r.objs))].filter(o => out.has(o));
    if (objs.length) put(k, out.get(objs[0]).ids, `object ${objs[0]}`);
  }
  // an object id of the type's variants whose creation the live runs saw during this anim
  for (const k of open()) for (const info of Object.values(T.variants)) for (const o of info.objects) if (o.whileTarget.includes(k) && info.objAttacks[o.type] && info.objAttacks[o.type].length === 1) put(k, info.objAttacks[o.type], `object ${o.type} created during the anim (live)`);
  return out;
}

// ================================================================ frame registry, packing, sheets
class FrameBook {
  constructor() { this.bySig = new Map(); }
  sig(parts) { return parts.length === 1 && !parts[0].dx && !parts[0].dy ? String(parts[0].rec) : parts.map(p => `${p.rec}@${p.dx},${p.dy}`).join('+'); }
  add(parts, owner) {
    const s = this.sig(parts);
    if (!this.bySig.has(s)) this.bySig.set(s, { sig: s, parts, owners: new Set() });
    if (owner) this.bySig.get(s).owners.add(owner);
    return s;
  }
  // render, trim, order, pack -> {list:[entry], sheets:[{id, w, h, rgba, places}]}
  finish({ prefix, max = 1024, pad = 1, sort = 'height', shadowFlag = true, groupOf = null, sheetId = null } = {}) {
    const list = [...this.bySig.values()].sort((a, b) => a.parts[0].rec - b.parts[0].rec || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0));
    list.forEach((e, i) => {
      e.id = i; const full = composeIdx(e.parts); if (!full) throw new Error(`frame ${e.sig}: nothing to draw`);
      e.full = full; e.img = trim(full);
      e.flags = (shadowFlag && full.shadow ? 1 : 0) | (e.parts.length > 1 ? 2 : 0);
    });
    return packGrouped(list, { prefix, max, pad, sort, groupOf, sheetId });
  }
}
// Pack the rendered entries, one MaxRects run per group (PLAN R4: the colouriser allocates a canvas per sheet x map, so a
// variant's maps should only ever touch the sheets of its own type): groupOf(entry) -> group name (null: one group),
// sheetId(group, n) -> sheet id. Groups pack in name order; inside a group the items keep the (rec, sig) id order.
function packGrouped(list, { prefix = 's', max = 1024, pad = 1, sort = 'id', groupOf = null, sheetId = null } = {}) {
  const groups = new Map();
  for (const e of list) { const g = groupOf ? String(groupOf(e)) : ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(e); }
  const sheets = []; let used = 0, area = 0;
  for (const g of [...groups.keys()].sort()) {
    const items = groups.get(g).map(e => ({ id: e.id, w: e.img.w, h: e.img.h }));
    const packed = atlas.pack(items, { max, pad, sort }), chk = atlas.check(packed, items, { max, pad });
    if (!chk.ok) throw new Error(`atlas-pack ${g || prefix}: ` + chk.errors.slice(0, 3).join('; '));
    packed.sheets.forEach((s, si) => {
      const id = sheetId ? sheetId(g, si) : groupOf ? `${prefix}-${g}${si ? '-' + (si + 1) : ''}` : `${prefix}${si}`, rgba = new Uint8Array(s.w * s.h * 4);
      for (const p of s.places) {
        const e = list[p.id]; e.sheet = id; e.sx = p.x; e.sy = p.y; e.group = g;
        for (let y = 0; y < e.img.h; y++) for (let x = 0; x < e.img.w; x++) {
          const q = y * e.img.w + x; if (!e.img.set[q]) continue;
          const d = ((p.y + y) * s.w + p.x + x) * 4; rgba[d] = e.img.slot[q]; rgba[d + 1] = e.img.pen[q]; rgba[d + 2] = 0; rgba[d + 3] = 255;
        }
      }
      const fillPx = s.places.reduce((n, p) => n + p.w * p.h, 0); used += fillPx; area += s.w * s.h;
      sheets.push({ id, group: g, w: s.w, h: s.h, rgba, fill: fillPx / (s.w * s.h) });
    });
  }
  return { list, sheets, fill: area ? used / area : 0 };
}
// md5 of the ROM-derived inputs (PLAN §4.1 build.md5): only files under work/re/extract, so an edit to another
// package's pack-config key never makes a shipped module stale
function inputMd5(relPaths) {
  const crypto = require('crypto'), out = {};
  for (const p of [...relPaths].sort()) { if (!/^work\/re\/extract\//.test(p)) continue; const f = path.join(ROOT, p); if (fs.existsSync(f)) out[p] = crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex'); }
  return out;
}
// the type -> sheet group (pack-config enemies.sheetGroups; default: the type itself)
function groupOfType(cfg) { const g = {}; for (const [name, ts] of Object.entries(cfg.sheetGroups || {})) if (name !== '_doc') for (const t of ts) g[t] = name; return t => g[t] || t; }
function sheetOut(sh, rgbaMode = false, colourOf = null) {
  let rgba = sh.rgba;
  if (rgbaMode && colourOf) { rgba = new Uint8Array(sh.rgba.length); for (let q = 0; q < sh.w * sh.h; q++) { if (!sh.rgba[q * 4 + 3]) continue; const c = colourOf(sh.rgba[q * 4], sh.rgba[q * 4 + 1]); rgba[q * 4] = (c >> 16) & 255; rgba[q * 4 + 1] = (c >> 8) & 255; rgba[q * 4 + 2] = c & 255; rgba[q * 4 + 3] = 255; } }
  const buf = png.encode({ width: sh.w, height: sh.h, rgba, palette: true });
  const colours = new Set(); for (let q = 0; q < sh.w * sh.h; q++) if (rgba[q * 4 + 3]) colours.add((rgba[q * 4] << 8) | rgba[q * 4 + 1]);
  return { png: png.dataURL(buf), w: sh.w, h: sh.h, sum: png.fnvIndexed(sh.rgba).toString(16), bytes: buf.length, colours: colours.size, paletteMode: buf[25] === 3 };
}
// decoded sheet item -> indexed image (for the read-back from the shipped pixels)
function itemFromSheet(decoded, e) {
  const w = e.img.w, h = e.img.h, out = { w, h, ox: e.img.ox, oy: e.img.oy, pen: new Uint8Array(w * h), slot: new Uint8Array(w * h), set: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((e.sy + y) * decoded.width + e.sx + x) * 4, d = y * w + x; if (!decoded.rgba[s + 3]) continue; out.slot[d] = decoded.rgba[s]; out.pen[d] = decoded.rgba[s + 1]; out.set[d] = 1; }
  return out;
}

// ================================================================ read-back against the extract atlases
// ref: compose the parts from the atlas boxes (first part in front), aligned at the feet origin; mine: the shipped item
// coloured with the same map/override. Returns {ok, diff:{pixels, alpha, firstAt}} or {skipped:reason}.
function composeRef(parts, pick) {
  const boxes = [];
  for (const p of parts) { const f = pick(p.rec); if (!f) return null; boxes.push({ p, f }); }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const { p, f } of boxes) { x0 = Math.min(x0, p.dx - f.ox); y0 = Math.min(y0, p.dy - f.oy); x1 = Math.max(x1, p.dx - f.ox + f.w); y1 = Math.max(y1, p.dy - f.oy + f.h); }
  const w = x1 - x0, h = y1 - y0, rgba = new Uint8Array(w * h * 4);
  for (let k = boxes.length - 1; k >= 0; k--) {
    const { p, f } = boxes[k], src = f.atlasImg;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const s = ((f.y + y) * src.width + f.x + x) * 4; if (!src.rgba[s + 3]) continue;
      const X = p.dx - f.ox - x0 + x, Y = p.dy - f.oy - y0 + y, d = (Y * w + X) * 4;
      rgba[d] = src.rgba[s]; rgba[d + 1] = src.rgba[s + 1]; rgba[d + 2] = src.rgba[s + 2]; rgba[d + 3] = 255;
    }
  }
  return { w, h, ox: -x0, oy: -y0, rgba };
}
function compareAligned(ref, img, rgba) {
  // every opaque pixel of either image must match at the same position relative to the feet origin
  let bad = 0, first = null;
  const at = (x, y) => { const X = x + ref.ox, Y = y + ref.oy; if (X < 0 || Y < 0 || X >= ref.w || Y >= ref.h) return null; const q = (Y * ref.w + X) * 4; return ref.rgba[q + 3] ? [ref.rgba[q], ref.rgba[q + 1], ref.rgba[q + 2]] : null; };
  let mine = 0, theirs = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const q = y * img.w + x; if (!img.set[q]) continue; mine++;
    const c = at(x - img.ox, y - img.oy);
    if (!c || c[0] !== rgba[q * 4] || c[1] !== rgba[q * 4 + 1] || c[2] !== rgba[q * 4 + 2]) { bad++; if (!first) first = [x - img.ox, y - img.oy]; }
  }
  for (let q = 0; q < ref.w * ref.h; q++) if (ref.rgba[q * 4 + 3]) theirs++;
  if (theirs !== mine) bad += Math.abs(theirs - mine);
  return { ok: bad === 0, bad, first, mine, theirs };
}

// ================================================================ contact sheets (labelled, coloured, magenta feet cross)
const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
  '-': '000000111000000', '.': '000000000000010', ':': '000010000010000', '/': '001001010100100', '+': '000010111010000', '(': '010100100100010', ')': '010001001001010', '#': '101111101111101', '_': '000000000000111', '>': '100010001010100', '*': '101010111010101', '=': '000111000111000', ',': '000000000010100', '@': '111101111100111', '%': '101001010100101', "'": '010010000000000', '!': '010010010000010', '?': '111001010000010', '<': '001010100010001', '&': '010101010101011', '|': '010010010010010',
};
function canvasRGBA(w, h, bg = [34, 38, 46]) { const d = new Uint8Array(w * h * 4); for (let q = 0; q < w * h; q++) { d[q * 4] = bg[0]; d[q * 4 + 1] = bg[1]; d[q * 4 + 2] = bg[2]; d[q * 4 + 3] = 255; } return { w, h, d }; }
function putPx(c, x, y, col) { if (x < 0 || y < 0 || x >= c.w || y >= c.h) return; const q = (y * c.w + x) * 4; c.d[q] = col[0]; c.d[q + 1] = col[1]; c.d[q + 2] = col[2]; c.d[q + 3] = 255; }
function text(c, s, x, y, col = [255, 240, 150], scale = 1) {
  [...String(s).toUpperCase()].forEach((ch, k) => { const g = GLYPHS[ch]; if (!g) return; for (let i = 0; i < 15; i++) if (g[i] === '1') for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) putPx(c, x + (k * 4 + (i % 3)) * scale + a, y + Math.floor(i / 3) * scale + b, col); });
}
function fillRect(c, x0, y0, w, h, col) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) putPx(c, x, y, col); }
function blitRGBA(c, src, sw, sh, x0, y0, flip = false) { for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const q = (y * sw + (flip ? sw - 1 - x : x)) * 4; if (!src[q + 3]) continue; putPx(c, x0 + x, y0 + y, [src[q], src[q + 1], src[q + 2]]); } }
// rows [{title, sub?, cells:[{img, rgba, caption}]}] -> PNG file
function contactSheet(file, rows, { cellW = 104, cellH = 120, maxCols = 12, title = '' } = {}) {
  const labelW = 190, head = title ? 16 : 0;
  const cols = Math.min(maxCols, Math.max(1, ...rows.map(r => r.cells.length)));
  const lines = rows.map(r => Math.max(1, Math.ceil(r.cells.length / cols)));
  const W = labelW + cols * cellW, H = head + lines.reduce((a, b) => a + b, 0) * cellH;
  const c = canvasRGBA(W, Math.max(H, 20));
  if (title) text(c, title, 4, 4, [255, 230, 140], 2);
  let y = head;
  rows.forEach((r, ri) => {
    fillRect(c, 0, y, W, 1, [90, 96, 110]);
    String(r.title).split('\n').forEach((ln, k) => text(c, ln, 4, y + 4 + k * 8, k ? [190, 200, 215] : [255, 255, 140]));
    r.cells.forEach((cell, i) => {
      const cx = labelW + (i % cols) * cellW, cy = y + Math.floor(i / cols) * cellH;
      fillRect(c, cx, cy, 1, cellH, [70, 74, 84]);
      const fx = cx + Math.floor(cellW / 2), fy = cy + cellH - 14;
      if (cell.img) blitRGBA(c, cell.rgba, cell.img.w, cell.img.h, fx - cell.img.ox, fy - cell.img.oy);
      for (let d = -3; d <= 3; d++) { putPx(c, fx + d, fy, [255, 0, 255]); putPx(c, fx, fy + d, [255, 0, 255]); }
      text(c, cell.caption || '', cx + 3, cy + cellH - 9, [200, 230, 255]);
    });
    y += lines[ri] * cellH;
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png.encode({ width: c.w, height: c.h, rgba: c.d }));
  return { w: c.w, h: c.h };
}

// ================================================================ anim refs (through the anim-keys gate's resolver)
// every anim key ENEMY_KINDS references, per type and variant (resolved through the variant's sets)
function kindRefKeys(kinds, typesSets) {
  const G = BGA(), out = new Map(), problems = [];      // type -> Set(key)
  const add = (t, k) => { if (!out.has(t)) out.set(t, new Set()); out.get(t).add(k); };
  for (const ref of G.enemyKindRefs(kinds)) {
    const kind = kinds[ref.kind]; if (!kind || kind.hero === true || /^(hero|mirror)$/.test(String(kind.type))) continue;
    if (!ref.refs) { problems.push(`${ref.where}: cannot parse ${ref.token}`); continue; }
    const vobj = kind.variants && typeof kind.variants === 'object' ? kind.variants : {};
    for (const V of Object.keys(vobj)) {
      if (ref.variants && !ref.variants.includes(V)) continue;
      const v = vobj[V], t = (v && typeof v === 'object' && v.type) || kind.type, sets = typesSets[t] && typesSets[t][V];
      if (!sets) { problems.push(`${ref.where}: ${ref.kind}:${V} -> type ${t} variant ${V} is not configured`); continue; }
      for (const { set, i } of ref.refs) { const addr = G.resolveSet(set, sets, ref.part); if (!addr) { if (ref.strict) problems.push(`${ref.where}: '${set}' is not a set of ${t}:${V}`); continue; } add(t, akey(addr, i)); }
    }
  }
  return { keys: out, problems };
}

// ================================================================ knife-in-hand attach (ENEMIES §2.8) from the live logs
function knifeAttach(typeAnims, runs) {
  const addrKey = new Map();
  for (const a of typeAnims.values()) a.frames.forEach((f, i) => { const k = parseInt(f.addr, 16); if (!addrKey.has(k)) addrKey.set(k, `${a.key}:${i}`); });
  const stats = new Map(); let frames = 0; const used = [];
  for (const run of runs) {
    const p = path.join(RUNS, run, 'hook.jsonl'); if (!fs.existsSync(p)) continue; used.push(run);
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line.startsWith('{"f"')) continue;
      let e; try { e = JSON.parse(line); } catch (x) { continue; }
      const B = e.B || [], body = B.find(o => o.ty === 0x38); if (!body) continue;
      const bk = addrKey.get(body.fp); if (!bk) continue;
      const face = body.f24 ? -1 : 1;
      const knives = B.filter(o => o.ty === 0xF0 && Math.abs(o.x - body.x) < 80 && Math.abs(o.d - body.d) <= 1 && o.h - body.h > 20 && o.h - body.h < 130);
      if (!knives.length) continue; frames++;
      for (const k of knives) {
        const pose = addrKey.get(k.fp); if (!pose || !/^0x6FB6A:/.test(pose)) continue;
        const v = `${(k.x - body.x) * face},${-(k.h - body.h)},${pose.replace(/:\d+$/, '')}`;
        if (!stats.has(bk)) stats.set(bk, new Map()); const m = stats.get(bk); m.set(v, (m.get(v) || 0) + 1);
      }
    }
  }
  const attach = {}, coverage = { bodyFrames: 0, logged: frames, exactShare: 0, runs: used };
  let tot = 0, top = 0;
  for (const bk of [...stats.keys()].sort()) {
    const m = stats.get(bk), arr = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)), n = arr.reduce((s, x) => s + x[1], 0);
    const [v0, c0] = arr[0], [dx, dy, pose] = v0.split(','), alt = arr.slice(1).filter(([, c]) => c >= Math.max(3, n * 0.25)).map(([v, c]) => { const [ax, ay, ap] = v.split(','); return [+ax, +ay, ap, c]; });
    attach[bk] = alt.length ? [+dx, +dy, pose, c0, alt] : [+dx, +dy, pose, c0];
    tot += n; top += c0 + alt.reduce((s, a) => s + a[3], 0); coverage.bodyFrames++;
  }
  coverage.exactShare = tot ? +(top / tot).toFixed(3) : 0;
  return { attach, coverage };
}

// ================================================================ budgets (ENEMIES §2.6 / CAMPAIGN D9)
const CHAPTER_POOLS = [
  { raider: ['ferris', 'gneiss'], knifer: ['blade'], gunner: ['poacherJ'], brute: ['blkElmer', 'hammerT'] },
  { raider: ['driver', 'ferris'], knifer: ['razor'], gunner: ['dyna', 'skinner'], brute: ['wrenchT', 'hammerT'], biker: ['ride', 'jump'] },
  { raider: ['gneiss', 'poacherJ'], knifer: ['blade'], gunner: ['skinner', 'gutter'], brute: ['hammerT', 'blkElmer'], raptor: ['hopper'] },
  { raider: ['gneiss', 'driver'], knifer: ['razor'], gunner: ['bomber', 'gutter'], brute: ['wrenchT', 'blkElmer'], mutant: ['bludge'], regent: ['tyrog'] },
  { raider: ['driver'], knifer: ['razor', 'knife'], gunner: ['gutter', 'bomber'], brute: ['lashT', 'blkElmer'], mutant: ['bludge'], regent: ['tyrog'], mirror: ['mirror'] },
  { raider: ['gneiss', 'driver'], knifer: ['razor', 'blade'], gunner: ['gutter', 'skinner'], brute: ['blkElmer'], mutant: ['bludge'], regent: ['tyrog'], mirror: ['mirror'] }];
const CURRENT_BUDGET = [4853, 5888, 5641, 5372, 5945, 6576];
function sectionCasts() {
  const dir = path.join(ROOT, 'tools', 're', 'levels'), out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter(x => /^ch\d\.json$/.test(x)).sort()) {
    const j = readJSON(path.join(dir, f));
    for (const a of j.areas || []) for (const s of a.sections || []) if (s.cast) out[s.id] = s.cast;
  }
  return out;
}
// budget per chapter: Σ over the regular waves of K.HP(rom hp at LV[ch]); mirrors count MIRROR_HP
function budgets(kinds, typesOut, campaign) {
  const K = kinds.K, CAST = kinds.CAST, casts = sectionCasts(), alt = K.HP_USE === 'spec' ? 'tuned' : 'spec';
  return campaign.map((c, i) => {
    let sum = 0, sumAlt = 0; const mix = {};
    for (const s of c.sections) {
      const pools = { ...CHAPTER_POOLS[i], ...(casts[s.stage] || {}) };
      for (const e of s.enc) (e.w || []).forEach((w, wi) => w.forEach((kind, j) => {
        const pool = [].concat(pools[kind] || []), id = pool.length ? pool[(wi + j) % pool.length] : kind;
        mix[id] = (mix[id] || 0) + 1;
        const cast = CAST[id];
        if (!cast || cast[0] === 'mirror') { sum += K.MIRROR_HP; sumAlt += K.MIRROR_HP; return; }
        const kd = kinds[cast[0]], V = cast[1], t = (kd.variants[V] && kd.variants[V].type) || kd.type, tv = typesOut[t] && typesOut[t].variants[V];
        sum += tv ? K.HP(tv.hp[K.LV[i]]) : 0; sumAlt += tv ? K.HP(tv.hp[K.LV[i]], 1, alt) : 0;
      }));
    }
    return { chapter: i + 1, budget: sum, current: CURRENT_BUDGET[i], ratio: +(sum / CURRENT_BUDGET[i]).toFixed(3), formula: K.HP_USE, alt, budgetAlt: sumAlt, ratioAlt: +(sumAlt / CURRENT_BUDGET[i]).toFixed(3), mix };
  });
}

// colouriser canvases per chapter (PLAN R4): sprites.js allocates one sheet-sized canvas per (sheet, map) pair, so a
// chapter's cast costs the sheets its variants draw from x their maps (home, gel)
function canvasBudget(kinds, typesOut, anims, frames, sheets, palMap) {
  const sheetsOf = (t, V) => { const v = typesOut[t].variants[V], sets = [v.main, v.held, v.down, v.hit, v.grab].filter(Boolean), out = new Set(); for (const [k, a] of Object.entries(anims)) if (sets.includes(k.split(':')[0])) for (const f of a.f) out.add(frames[f[0]][0]); return out; };
  return CHAPTER_POOLS.map((pools, i) => {
    const pairs = new Set(), home = new Set();
    for (const ids of Object.values(pools)) for (const id of ids) { const c = kinds.CAST[id]; if (!c || c[0] === 'mirror') continue; const t = kinds.typeOf(c[0], c[1]), V = c[1]; if (!typesOut[t]) continue; for (const sh of sheetsOf(t, V)) { pairs.add(sh + '|' + palMap[t + ':' + V]); home.add(sh + '|' + palMap[t + ':' + V]); pairs.add(sh + '|' + palMap[t + ':' + V + '/gel']); } }
    const mb = set => +([...set].reduce((n, p) => { const sh = sheets[p.split('|')[0]]; return n + sh.w * sh.h * 4; }, 0) / 1048576).toFixed(1);
    return { chapter: i + 1, pairs: pairs.size, mb: mb(pairs), homeOnlyPairs: home.size, homeOnlyMb: mb(home) };
  });
}

// ================================================================ the enemies build
function loadKinds() {
  const file = path.join(ROOT, 'enemy-kinds.js');
  if (!fs.existsSync(file)) throw new Error('enemy-kinds.js is missing (WP-C authors it next to the generated data)');
  const win = emit.load(file);
  if (!win.ENEMY_KINDS) throw new Error('enemy-kinds.js did not define window.ENEMY_KINDS');
  return win;
}
function srcFile(spec) { return path.join(EXTRACT, spec.src); }
function atlasFiles(spec) {
  if (spec.format === 'bosses') { const base = spec.src.replace(/\.json$/, ''); return [path.join(EXTRACT, base + '-atlas.json'), path.join(EXTRACT, base + '-atlas.png')]; }
  const base = spec.src.replace(/\.json$/, ''); return [path.join(EXTRACT, base + '.atlas.json'), path.join(EXTRACT, base + '.png')];
}

// one configured type -> {variants:{V: info}, anims:Map, atlas}
function loadType(name, spec) {
  const rd = spec.format === 'bosses' ? readBossEntity(srcFile(spec)) : readEnemyType(srcFile(spec));
  const j = rd.json, variants = {};
  for (const [V, vs] of Object.entries(spec.variants)) {
    let info;
    if (rd.format === 'enemies') {
      const v = j.variants.find(x => x.id === vs.rom && !x.error);
      if (!v) throw new Error(`${name}: ROM variant ${vs.rom} not in ${spec.src}`);
      const ov = (v.palette.p23.find(p => p.override !== null) || {}).override ?? null;
      const loco = v.locomotion && Object.values(v.locomotion)[0];
      info = { rom: vs.rom, hud: v.hudName, hudIndex: v.hudIndex, r84: parseInt(v.r84, 16), main: normSet(v.set), held: normSet(v.reactionSets.held), down: normSet(v.reactionSets.down),
        hp: v.hp.byLevel.slice(), home: { ep: v.palette.home.stage, area: v.palette.home.area }, override: ov, walk: loco ? loco.pxPerFrameX : null, walkPlays: loco ? loco.plays ?? null : null, slots: Object.keys(v.palette.slots).map(Number),
        attackIds: (v.attackIds || []).map(a => { const ob = /^object\s+(0x[0-9a-f]+)/i.exec(a.by || ''); return { id: a.attackId, by: ob ? 'object' : a.by, objectType: ob ? hex(parseInt(ob[1], 16)) : null, liveAnims: a.liveAnims || [], writtenAt: (a.writtenAt || []).map(x => parseInt(x, 16)) }; }),
        // live hits per anim ('main:0x34892:3' -> ids) and per object type ('object:0xA4' -> ids)
        liveAttacks: (v.attacks || []).filter(a => !a.byObject && /^[a-z]+:0x/i.test(a.anim)).map(a => ({ key: (([, s, i]) => akey(s, +i))(a.anim.split(':')), ids: a.attackIds.slice() })),
        objAttacks: Object.fromEntries((v.attacks || []).filter(a => a.byObject).map(a => [hex(parseInt(a.objectType, 16)), a.attackIds.slice()])),
        objects: (v.objects || []).map(o => ({ type: hex(parseInt(o.type, 16)), sets: (o.sets || []).map(normSet), whileTarget: (o.whileTarget || []).map(s => (([, st, i]) => (st && i != null ? akey(st, +i) : null))(String(s).split(':'))).filter(Boolean) })) };
    } else {
      const P = j.palette, ov = vs.override !== undefined ? vs.override : P.override ?? null;
      const reg = (j.hp.regular || []).find(r => r.name === (vs.hpName || j.name)) || (j.hp.regular || [])[0];
      const react = (j.reactionSets || [])[0] || {};
      info = { rom: vs.rom || 'A', hud: vs.hud || j.name, r84: react.r84 ? parseInt(react.r84, 16) : 0, main: normSet(vs.main || j.sets.find(s => !/^0x3/.test(s.set)).set),
        hit: react.hit ? normSet(react.hit) : null, grab: react.grab ? normSet(react.grab) : null, hp: reg ? reg.byRank.slice() : new Array(32).fill(0),
        home: { ep: P.episodeArea[0], area: P.episodeArea[1] }, override: ov, walk: vs.walk ?? null, slots: (P.slotsUsed || []).map(s => s.slot), attackIds: [], liveAttacks: [], objAttacks: {}, objects: [] };
    }
    // a configured walk replaces an under-read capture (ENEMIES §2.5: POACHER J's 4 plays read 0.188 px/f, the ROM speed is 1.13)
    if (vs.walk != null) { if (info.walk != null && Math.abs(info.walk - vs.walk) > 1e-6) info.walkMeasured = info.walk; info.walk = vs.walk; }
    variants[V] = info;
  }
  const [aj, ap] = atlasFiles(spec);
  return { name, spec, rd, variants, anims: rd.anims, atlas: fs.existsSync(aj) && fs.existsSync(ap) ? readAtlas(aj, ap) : null, atlasFiles: [aj, ap] };
}
// the set names of one variant, as the anim-keys gate resolves them
function variantSets(info) { const o = { main: info.main }; if (info.held) o.held = info.held; if (info.down) o.down = info.down; if (info.hit) o.hit = info.hit; if (info.grab) o.grab = info.grab; return o; }

function build({ rom = null, config = null, out = ROOT, rgba = false, log = console.log } = {}) {
  if (rom) R_ = rom;
  const cfgAll = config || readJSON(path.join(__dirname, 'pack-config.json'));
  const cfg = cfgAll.enemies;
  const win = loadKinds(), kinds = win.ENEMY_KINDS;
  const report = { inputs: [], summary: {}, warnings: [], readBack: {}, budgets: null, labels: {} };
  const pb = new PalBook(), fb = new FrameBook();
  const types = {}, typeList = Object.keys(cfg.types).sort();
  for (const t of typeList) { types[t] = loadType(t, cfg.types[t]); report.inputs.push(rel(srcFile(cfg.types[t])), ...types[t].atlasFiles.filter(fs.existsSync).map(rel)); }
  report.inputs.push('enemy-kinds.js', 'tools/re/build/pack-config.json');

  // ---------------------------------------------------------------- which anims ship
  const typesSets = Object.fromEntries(typeList.map(t => [t, Object.fromEntries(Object.entries(types[t].variants).map(([V, i]) => [V, variantSets(i)]))]));
  const refs = kindRefKeys(kinds, typesSets);
  report.warnings.push(...refs.problems);
  const need = new Map();                                    // key -> {type, variants:Set, why:Set}
  const want = (t, k, V, why) => { if (!need.has(k)) need.set(k, { type: t, variants: new Set(), why: new Set() }); const n = need.get(k); if (V) n.variants.add(V); n.why.add(why); };
  for (const t of typeList) {
    const T = types[t], spec = cfg.types[t];
    for (const [V, info] of Object.entries(T.variants)) {
      for (const a of T.anims.values()) {
        const inSet = a.set === info.main || a.set === info.held || a.set === info.down || a.set === info.hit || a.set === info.grab;
        if (!inSet) continue;
        if (a.kind !== 'main' && spec.reactions !== false) want(t, a.key, V, 'reaction');
        if (a.kind === 'main' && (spec.main === 'all' || (Array.isArray(spec.main) && spec.main.includes(a.index)))) want(t, a.key, V, 'config');
      }
      for (const k of refs.keys.get(t) || []) { const a = T.anims.get(k); if (a && (a.set === info.main || a.set === info.held || a.set === info.down || a.set === info.hit || a.set === info.grab)) want(t, k, V, 'kind'); }
    }
    for (const ok of spec.objects || []) { const k = /:/.test(ok) ? ok.replace(/^(0x[0-9a-f]+)/i, m => normSet(m)) : ok; want(t, k, null, 'object'); }
    for (const k of refs.keys.get(t) || []) if (!need.has(k) && T.anims.has(k)) want(t, k, null, 'kind-absolute');
  }
  // refs to keys no configured type has
  for (const [t, ks] of refs.keys) for (const k of ks) if (![...typeList].some(x => types[x].anims.has(k))) report.warnings.push(`ENEMY_KINDS refers to ${k} (via ${t}) which no configured type decodes`);

  // ---------------------------------------------------------------- frames and anims
  const animsOut = {}, animOwner = {};
  const keys = [...need.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const k of keys) {
    const n = need.get(k), T = types[n.type], a = T.anims.get(k);
    if (!a) { report.warnings.push(`${n.type}: anim ${k} not decoded in ${T.spec.src}`); continue; }
    const ids = a.frames.map(f => fb.add(f.parts, `${n.type}:${[...n.variants].join('') || '*'}`));
    animsOut[k] = { a, ids, type: n.type, variants: [...n.variants].sort() };
    animOwner[k] = n.type;
  }
  const gOf = groupOfType(cfg), groupOfEntry = e => [...e.owners].map(o => gOf(o.split(':')[0])).sort()[0];
  const done = fb.finish({ prefix: 'e', max: cfgAll.build.sheet.max, pad: cfgAll.build.sheet.pad, sort: process.env.PACK_SORT || cfg.sort || 'height', groupOf: groupOfEntry });
  const fid = new Map(done.list.map(e => [e.sig, e.id]));

  // ---------------------------------------------------------------- attack ids per anim (KI14)
  const atkRefs = kindAttackRefs(kinds, Object.fromEntries(typeList.map(t => [t, types[t].variants])));
  const atkTables = {};
  for (const t of typeList) {
    const refsT = new Map([...atkRefs].map(([k, rs]) => [k, rs.filter(r => r.type === t)]).filter(([, rs]) => rs.length));
    const objs = (cfg.types[t].objects || []).map(ok => ok.replace(/^(0x[0-9a-f]+)/i, m => normSet(m)));
    atkTables[t] = attackIdsOfType(types[t], refsT, cfg.attackMap, objs);
  }
  report.attacks = {};
  for (const [k, rs] of [...atkRefs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) for (const r of rs) {
    const at = atkTables[r.type] && atkTables[r.type].get(k), tag = `${r.kind}:${r.V} ${r.id}`;
    report.attacks[tag] = at ? { key: k, id: at.ids[0], ids: at.ids, src: at.src } : { key: k, id: null };
    if (!at) report.warnings.push(`attack ${tag} (${k}) has no 0xA2EA4 record: add it to pack-config enemies.attackMap`);
  }

  // ---------------------------------------------------------------- palettes per variant
  const palMap = {}, typesOut = {}, pins = cfg.pins || {};
  for (const t of typeList) {
    const T = types[t], spec = cfg.types[t], vo = {};
    for (const [V, info] of Object.entries(T.variants)) {
      const homeKey = pb.objMap(info.home.ep, info.home.area, info.override);
      let key = homeKey;
      const pin = pins[t] && Object.entries(pins[t]).filter(([s]) => /^\d+$/.test(s));
      if (pin && pin.length && info.override == null) {         // slot pins on the home map (KI17)
        const m = pb.maps[homeKey].slice(); let changed = false;
        for (const [s, row] of pin) if (m[+s] !== row) { m[+s] = row; changed = true; }
        if (changed) key = pb.addMap(`${homeKey}-${t}`, m);
      }
      palMap[`${t}:${V}`] = key;
      for (const [ctx, c] of Object.entries((spec.palettes && spec.palettes[V]) || {})) {
        if (c.ctx) palMap[`${t}:${V}/${ctx}`] = pb.objMap(c.ctx[0], c.ctx[1], c.ctx[2] ?? null);
        else if (c.uniformRow != null) palMap[`${t}:${V}/${ctx}`] = pb.addMap(`row-${c.uniformRow}`, new Array(32).fill(c.uniformRow));
        else if (c.hand) {
          const items = done.list.filter(e => [...e.owners].some(o => o.split(':')[0] === t)).map(e => e.img);
          const H = handPalette(c.hand, c, pb, items, c.uniform ? null : c.slot);
          palMap[`${t}:${V}/${ctx}`] = H.key; report.palettes = report.palettes || {}; report.palettes[c.hand] = { type: t, variant: V, ctx, map: H.key, ...H.report };
        }
      }
      // gel (clone dissolve) map over the slots this variant draws with
      const slots = info.override != null ? [info.override] : usedSlots(animsOut, done, fid, info, T);
      const gelBase = info.override != null ? pb.addMap(`row-${pb.maps[homeKey][0]}`, new Array(32).fill(pb.maps[homeKey][0])) : key;
      palMap[`${t}:${V}/gel`] = pb.gelMap(gelBase, info.override != null ? [0] : slots);
      vo[V] = { hud: info.hud, rom: info.rom, r84: info.r84, main: info.main, ...(info.held ? { held: info.held } : {}), ...(info.down ? { down: info.down } : {}), ...(info.hit ? { hit: info.hit } : {}), ...(info.grab ? { grab: info.grab } : {}),
        hp: info.hp, walk: info.walk, ...(info.walkMeasured != null ? { walkMeasured: info.walkMeasured } : {}), rankRow: rankRow(info.r84), home: homeKey, slots: info.override != null ? [info.override] : slots, override: info.override };
    }
    // attacks: every id in the type's static/live tables -> 0xA2EA4 record (KI14)
    const ids = new Set(); for (const info of Object.values(T.variants)) for (const a of info.attackIds) ids.add(a.id);
    for (const a of T.anims.values()) for (const id of a.attackIds) ids.add(id);
    for (const at of atkTables[t].values()) for (const id of at.ids) ids.add(id);
    const attacks = {}; for (const id of [...ids].sort((x, y) => x - y)) attacks[id] = atkOf(id);
    typesOut[t] = { obj: T.rd.json.objType || (T.rd.json.objects && T.rd.json.objects[0] && T.rd.json.objects[0].type) || null, title: T.rd.json.title || T.rd.json.name || t, source: T.spec.src, variants: vo, attacks, ...(spec.scenery ? { scenery: true } : {}) };
  }
  // KI13: the TYROG maps, one uniform row per +0x23 slot, in every chapter
  if (pins.kingkimo && typesOut.kingkimo) for (const [s, row] of Object.entries(pins.kingkimo).filter(([s]) => /^\d+$/.test(s))) palMap[`kingkimo:A/${s}`] = pb.addMap(`tyrog-${s}`, new Array(32).fill(row));

  // ---------------------------------------------------------------- anim records
  const anims = {};
  for (const [k, o] of Object.entries(animsOut)) {
    const a = o.a, act = []; let wind = null, t = 0;
    const f = a.frames.map((fr, i) => { if (fr.active) { act.push(i); if (wind == null) wind = t; } t += fr.dur; const id = fid.get(fb.sig(fr.parts)); return fr.active ? [id, fr.dur, 1] : [id, fr.dur]; });
    const rec = { f, loop: a.loop };
    if (cfg.labels) rec.lbl = a.label.slice(0, 96);
    report.labels[k] = a.label;
    if (a.next) rec.next = [a.next.key, a.next.frame];
    if (act.length) { rec.act = act; rec.wind = wind; }
    if (a.aliasOf != null) rec.alias = akey(a.set, a.aliasOf);
    const T = types[o.type], at = atkTables[o.type].get(k);
    if (at) { rec.atk = { ...atkOf(at.ids[0]), src: at.src }; if (at.ids.length > 1) rec.ids = at.ids.slice().sort((x, y) => x - y); if (at.conflict) report.warnings.push(`${k}: ${at.conflict}`); }
    if (a.kind === 'object' && a.palette != null) { const v0 = Object.values(T.variants)[0]; rec.ov = a.palette; rec.pal = pb.objMap(v0.home.ep, v0.home.area, a.palette); }
    rec.t = o.type;
    anims[k] = rec;
  }

  // ---------------------------------------------------------------- objects (ENEMIES §2.1, §2.8)
  const objects = JSON.parse(JSON.stringify(cfg.objects || {}));
  if (types.knifeman) {
    const ka = knifeAttach(types.knifeman.anims, cfg.knifeRuns || ['en-knifeman-a', 'en-knifeman-b', 'en-b-knifeman-a', 'en-b-knifeman-b']);
    objects.knifeHand = { attach: ka.attach, format: '[dx, dy, poseAnim, count, alt?[[dx, dy, pose, count]]]: knife pose object 0xF0 relative to the body feet, native left-facing screen px (dy up negative), by body anim frame', coverage: ka.coverage };
    report.knifeHand = ka.coverage;
  }
  for (const [name, v] of Object.entries(objects)) if (name !== "_doc" && typeof v === "string" && /^0x/i.test(v) && !anims[v.replace(/^(0x[0-9a-f]+)/i, m => normSet(m))] && !/\*$/.test(v)) report.warnings.push(`objects.${name}: ${v} is not shipped`);

  // ---------------------------------------------------------------- sheets
  const sheets = {}, rect = {}, sheetStats = [];
  const firstMapOfSlot = {};                                            // rgba contingency: colour each slot by the first variant map using it
  for (const [vk, mk] of Object.entries(palMap)) if (!vk.includes('/')) { const m = pb.maps[mk]; for (let s = 0; s < 32; s++) if (firstMapOfSlot[s] == null) firstMapOfSlot[s] = m[s]; }
  for (const sh of done.sheets) {
    const o = sheetOut(sh, rgba, (slot, pen) => (pb.rows[String(firstMapOfSlot[slot])] || PAL().rowRGB(firstMapOfSlot[slot] || 0))[pen]);
    sheets[sh.id] = { png: o.png, w: o.w, h: o.h, sum: o.sum };
    sheetStats.push({ id: sh.id, w: o.w, h: o.h, bytes: o.bytes, colours: o.colours, paletteMode: o.paletteMode, fill: +sh.fill.toFixed(3) });
    rect[sh.id] = {};
  }
  // frames[i][7] is the rect key: the record number, or the signature of a flattened composite ('rec@dx,dy+rec2@…')
  const frames = done.list.map(e => { rect[e.sheet][e.sig] = [e.sx, e.sy, e.img.w, e.img.h, e.img.ox, e.img.oy]; return [e.sheet, e.sx, e.sy, e.img.w, e.img.h, e.img.ox, e.img.oy, /^\d+$/.test(e.sig) ? Number(e.sig) : e.sig, e.flags]; });

  // ---------------------------------------------------------------- read-back from the shipped pixels
  const decoded = Object.fromEntries(done.sheets.map(sh => [sh.id, png.fromDataURL(sheets[sh.id].png)]));
  for (const t of typeList) report.readBack[t] = readBackType(types[t], animsOut, done, fid, decoded, pb, palMap, t, rgba);

  // ---------------------------------------------------------------- the module
  const sha = (() => { try { return require('./manifest.cjs').romSha1(); } catch (e) { return null; } })();
  const fam = {
    v: 1, family: 'enemies', mode: rgba ? 'rgba' : 'indexed', ready: false,
    build: { from: report.inputs.filter(p => p.endsWith('.json')).sort(), tool: 'tools/re/build-game-assets.cjs sprites enemies', rom: sha, md5: inputMd5(report.inputs) },
    sheets, rect, pal: { rows: pb.rows, maps: pb.maps }, frames, anims, types: typesOut, objects, palMap,
    notes: {
      frames: "[sheet, x, y, w, h, ox, oy, rec, flags]: (ox, oy) = feet origin inside the box, art faces LEFT; rec = the rect key (the record number, or for a flattened composite / rec2 frame its signature 'rec@dx,dy+rec2@dx,dy'); flags bit0 = the record carries its own pen-0 shadow blocks, bit1 = flattened composite / rec2 frame",
      sheets: 'one sheet set per type group (pack-config enemies.sheetGroups): a variant map only colours its own type sheets (PLAN R4)',
      ready: 'false in the data; enemy-kinds.js turns it into a getter that reads SPRITES.familyReady(enemies)',
      anims: "'<set>:<index>' -> {f:[[frameId, dur, active?]], loop (frame index or null), next?:[key, frame] (continues into another anim), wind (frames before the first active frame), act (active frame indices), atk {id, tbl, stun, react, hitstop (record byte 4, INFERRED), raw[8]} from 0xA2EA4, ids (all attack ids), alias (same frames as that key, KI20), t (type), ov/pal (an object drawn with a +0x23 override: colour it with map `pal`)}; labels are in work/re/pack/enemies-report.json (pack-config enemies.labels:true ships them as lbl)",
      palMap: "'<type>:<V>' -> map key of the variant's home colours (KI4); '<type>:<V>/<ctx>' named alternatives: '/gel' the clone dissolve, '/29' '/30' '/31' the TYROG +0x23 colours (KI13), '/brood' the BROOD MOTHER, '/alpha' PACK ALPHA",
      pal: "maps: 32 entries (OBJ slot -> pal.rows key: a ROM row of 0xB7A52, or a hand row '<name>:<slot>' / 'gel:<row>'); a uniform map is a +0x23 override",
      variants: 'hp[32] = ROM HP by level word 0xFF85EE (0x31454 / boss table halved for TYROG / dinosaur tables); rankRow[32] = 0x2C3AE + r84*8; walk = measured px/frame (null = not measured)',
    },
  };
  fs.mkdirSync(out, { recursive: true });
  const outFile = path.join(out, 'sprite-data-enemies.js');
  const w = emit.module(outFile, "SPRITE_DATA.add('enemies',", fam);

  // ---------------------------------------------------------------- contact sheets, budgets, report
  const files = [outFile];
  // review images are not build outputs (work/ is git-ignored): listed in the report, kept out of the manifest
  if (out === ROOT || cfg.sheetsAlways) report.reviewImages = writeContactSheets(types, animsOut, done, fid, pb, palMap, decoded, typeList).map(rel);
  let camp = null; try { camp = emit.load(path.join(ROOT, 'campaign.js')).EDEN_CAMPAIGN; } catch (e) { report.warnings.push('campaign.js not loadable for the budgets: ' + e.message); }
  if (camp) report.budgets = budgets(kinds, typesOut, camp);
  report.canvas = canvasBudget(kinds, typesOut, anims, frames, sheets, palMap);
  const rbTot = Object.values(report.readBack).reduce((s, r) => ({ checked: s.checked + r.checked, identical: s.identical + r.identical, different: s.different + r.different, explained: s.explained + r.explained, noRef: s.noRef + Math.max(0, r.noRef) }), { checked: 0, identical: 0, different: 0, explained: 0, noRef: 0 });
  report.summary = { bytes: w.bytes, types: typeList.length, variants: Object.values(typesOut).reduce((n, t) => n + Object.keys(t.variants).length, 0), anims: Object.keys(anims).length, frames: frames.length,
    records: new Set(done.list.flatMap(e => e.parts.map(p => p.rec))).size, sheets: sheetStats, areaByType: areaByType(done), readBack: rbTot, maps: Object.keys(pb.maps).length, rows: Object.keys(pb.rows).length };
  if (out === ROOT) { fs.mkdirSync(PACK_DIR, { recursive: true }); emit.json(path.join(PACK_DIR, 'enemies-report.json'), report); }
  log(`sprites enemies: ${report.summary.anims} anims, ${report.summary.frames} frames (${report.summary.records} records), ${sheetStats.length} sheets ${sheetStats.map(s => `${s.w}x${s.h}${s.paletteMode ? '' : ' rgba'}`).join(' ')}, ${(w.bytes / 1048576).toFixed(3)} MB; read-back ${rbTot.identical}/${rbTot.checked} identical, ${rbTot.different} different (${rbTot.explained} explained by the exporter semantics), ${rbTot.noRef} without a reference`);
  if (report.budgets) log('HP budgets (K.HP at LV[ch], CAMPAIGN D9 waves): ' + report.budgets.map(b => `ch${b.chapter} ${b.budget}/${b.current}=${b.ratio}`).join(', ') + ` (K.HP_USE '${kinds.K.HP_USE}'; under '${report.budgets[0].alt}': ` + report.budgets.map(b => `ch${b.chapter} ${b.ratioAlt}`).join(', ') + ')');
  log('colouriser canvases per chapter cast (home + gel maps): ' + report.canvas.map(c => `ch${c.chapter} ${c.pairs} pairs ${c.mb} MB (home only ${c.homeOnlyMb})`).join(', '));
  for (const wn of report.warnings.slice(0, 20)) log('  warning: ' + wn);
  return { files, report };
}
function areaByType(done) { const o = {}; for (const e of done.list) { const t = [...e.owners][0].split(":")[0]; o[t] = (o[t] || 0) + e.img.w * e.img.h; } return o; }
function usedSlots(animsOut, done, fid, info, T) {
  const slots = new Set();
  for (const o of Object.values(animsOut)) {
    const a = o.a; if (!(a.set === info.main || a.set === info.held || a.set === info.down || a.set === info.hit || a.set === info.grab)) continue;
    for (const fr of a.frames) { const e = done.list[fid.get(new FrameBook().sig(fr.parts))]; if (e) e.img.slots.forEach(s => slots.add(s)); }
  }
  return [...slots].sort((x, y) => x - y);
}
// ================================================================ pen roles from the pixels (ENEMIES §6.1 acceptance, WP-C)
// palettes.cjs classifyPens() judges one colour at a time, so the ends of a skin ramp slip out of 'skin' (the near-white
// cream highlight of a bald head #ffffdd, the dark brown under a jaw #553300). penStats() counts the 4-neighbour contacts
// between the pens of one OBJ slot (every slot for a uniform map) in the frames that draw it; penRoles() grows 'skin' by
// every pen whose (non-outline, non-eye) contacts are mostly skin, until nothing moves. The pixels only ever add pens to
// the kept set. A palette that recolours a kept pen on purpose (the white highlight of a coat, an orange vest pen that
// classifyPens calls skin) lists it in `recolour` with a `why`; hints name the skin pens that sit inside a clothing
// ramp of their own hue (the likely candidates), and the ramp-split check fails a kept pen left inside a recoloured ramp.
const lum24 = c => 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);
function hsl24(c) { const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return [0, 0, l]; const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return [h < 0 ? h + 360 : h, s, l]; }
// two colours of one ramp: both greys (chroma below 0.12, i.e. max - min < 31/255), or both coloured within 35 degrees of hue
const chroma24 = c => (Math.max((c >> 16) & 255, (c >> 8) & 255, c & 255) - Math.min((c >> 16) & 255, (c >> 8) & 255, c & 255)) / 255;
function sameFamily(a, b) { const ga = chroma24(a) < 0.12, gb = chroma24(b) < 0.12; if (ga || gb) return ga && gb; const d = Math.abs(hsl24(a)[0] - hsl24(b)[0]) % 360; return Math.min(d, 360 - d) <= 35; }
function penStats(items, slot = null) {
  const cnt = new Array(16).fill(0), adj = Array.from({ length: 16 }, () => new Array(16).fill(0));
  for (const img of items) {
    const { w, h } = img;
    const at = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return -1; const q = y * w + x; return img.set[q] && (slot == null || img.slot[q] === slot) ? img.pen[q] : -1; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = at(x, y); if (p < 0) continue; cnt[p]++;
      for (const n of [at(x + 1, y), at(x, y + 1)]) if (n >= 0 && n !== p) { adj[p][n]++; adj[n][p]++; }
    }
  }
  return { cnt, adj, px: cnt.reduce((a, b) => a + b, 0) };
}
function penRoles(row24, st) {
  const P = PAL(), cls = P.classifyPens(row24), role = new Array(15).fill('clothing'), moves = [], hints = [];
  for (const p of cls.outline) role[p] = 'outline'; for (const p of cls.eyes) role[p] = 'eyes'; for (const p of cls.skin) role[p] = 'skin';
  if (!st || !st.px) return { role, moves, hints, cls };
  // share of a pen's non-outline, non-eye contacts that touch pens of role `want` (family: of its own hue family only)
  const share = (p, want, family = false) => { let s = 0, t = 0; for (let q = 0; q < 15; q++) { const n = st.adj[p][q]; if (!n || q === p || role[q] === 'outline' || role[q] === 'eyes') continue; t += n; if (role[q] === want && (!family || sameFamily(row24[p], row24[q]))) s += n; } return t >= 8 ? s / t : null; };
  for (let it = 0; it < 8; it++) {
    let moved = false;
    for (let p = 0; p < 15; p++) { if (role[p] !== 'clothing' || !st.cnt[p]) continue; const k = share(p, 'skin'); if (k != null && k >= 0.5) { role[p] = 'skin'; moves.push({ pen: p, from: 'clothing', to: 'skin', skin: +k.toFixed(2), px: st.cnt[p] }); moved = true; } }
    if (!moved) break;
  }
  for (let p = 0; p < 15; p++) if (role[p] === 'skin' && st.cnt[p]) { const c = share(p, 'clothing', true); if (c != null && c >= 0.5) hints.push({ pen: p, inClothingRamp: +c.toFixed(2), px: st.cnt[p] }); }
  return { role, moves, hints, cls };
}
// the pens a palette keeps: outline, eyes and skin from the pixels, plus an explicit keep list, minus the pens it
// recolours on purpose (`recolour`; refused for the darkest outline pen and for pens of the explicit keep list)
function keepPens(row24, roles, { keep = null, recolour = [] } = {}) {
  const lums = row24.slice(0, 15).map(lum24), darkest = lums.indexOf(Math.min(...lums));
  const out = new Set([...roles.role.map((r, p) => (r !== 'clothing' ? p : -1)).filter(p => p >= 0), ...(keep || [])]), refused = [];
  for (const p of recolour || []) { if (p !== darkest && !(keep || []).includes(p)) out.delete(p); else refused.push(p); }
  return { keep: [...out].sort((a, b) => a - b), refused };
}
// ENEMIES §6.1 acceptance with the pixel roles: every colour a ROM colour; the kept pens (outline, eyes, skin grown from
// the pixels, explicit keep) unchanged unless listed in `recolour` (refused for the darkest outline pen); >= minChanged
// of the other pens changed against every original row; no ramp split above 2 % of the slot's pixels (an unchanged pen
// whose contacts are mostly with changed pens of its own hue family: an orange stripe left in a recoloured vest).
function acceptRow(row, originals, { keep = null, recolour = [], st = null, minChanged = 6 } = {}) {
  const P = PAL(), base = originals[0], R0 = penRoles(base, st), K0 = keepPens(base, R0, { keep, recolour }), must = new Set(K0.keep);
  const romCols = P.romColours(), notRom = []; for (let p = 0; p < 15; p++) if (!romCols.has(row[p])) notRom.push(p);
  const keptChanged = [...must].filter(p => row[p] !== base[p]).sort((a, b) => a - b);
  const changed = originals.map(o => { let n = 0; for (let p = 0; p < 15; p++) if (!must.has(p) && row[p] !== o[p]) n++; return n; });
  const lums = base.slice(0, 15).map(lum24), darkest = lums.indexOf(Math.min(...lums)), split = [];
  if (st && st.px) for (let p = 0; p < 15; p++) {
    if (row[p] !== base[p] || !st.cnt[p] || p === darkest || lums[p] < 24) continue;
    let c = 0, t = 0; for (let q = 0; q < 15; q++) { const n = st.adj[p][q]; if (!n || q === p || q === darkest) continue; t += n; if (row[q] !== base[q] && sameFamily(base[p], base[q])) c += n; }
    if (t >= 8 && c / t >= 0.5) split.push({ pen: p, role: R0.role[p], px: st.cnt[p], changedNeighbours: +(c / t).toFixed(2) });
  }
  const splitPx = split.reduce((n, x) => n + x.px, 0), splitShare = st && st.px ? +(splitPx / st.px).toFixed(4) : 0;
  const ok = !notRom.length && !keptChanged.length && !K0.refused.length && Math.min(...changed) >= minChanged && splitShare <= 0.02;
  return { ok, notRom, keptChanged, refusedRecolour: K0.refused, recoloured: (recolour || []).filter(p => !K0.refused.includes(p)), changed, keepPens: K0.keep, roles: R0.role.slice(), roleMoves: R0.moves, hints: R0.hints, rampSplit: split, rampSplitShare: splitShare, px: st ? st.px : null };
}
// hand palettes defined in pack-config (my own specs; palettes.cjs HAND_SPECS are WP-A drafts); `items` = the indexed
// frames of the type (pixel roles), `slotOf` = the OBJ slot whose pixels the row colours (null: every slot, uniform map)
function handPalette(name, c, pb, items = [], slotOf = null) {
  const P = PAL(), base = c.base;                                   // {romRow} | {ctx:[ep, area, slot]}
  const baseRow = base.romRow != null ? P.rowRGB(base.romRow) : P.rowRGB(P.objMap(base.ctx[0], base.ctx[1])[base.ctx[2]]);
  const st = penStats(items, slotOf), roles = penRoles(baseRow, st), keep = keepPens(baseRow, roles, { keep: c.keep || null, recolour: c.recolour || [] }).keep, cls = P.classesFromKeep(keep);
  const row = P.recolourRow(baseRow, c.ops || [], cls);
  const rk = `${name}:${c.slot != null ? c.slot : 'x'}`; pb.addRow(rk, row);
  const key = c.uniform ? pb.addMap(name, new Array(32).fill(rk)) : (() => { const m = pb.maps[c.mapOf] ? pb.maps[c.mapOf].slice() : new Array(32).fill(rk); m[c.slot] = rk; return pb.addMap(name, m); })();
  const acc = acceptRow(row, [baseRow], { keep: c.keep || null, recolour: c.recolour || [], st });
  return { key, row, baseRow, report: { base: base, baseRow: baseRow.map(x => '#' + x.toString(16).padStart(6, '0')), row: row.map(x => '#' + x.toString(16).padStart(6, '0')), keep: c.keep ? 'config + pixel roles' : 'pixel roles', recolour: c.recolour || [], accept: acc, ok: acc.ok } };
}
// The enemies exporter (tools/re/export/enemy-draw.cjs, rom.cjs render) painted two cases differently from the verified
// draw model: a record without per-block attributes was coloured with slot 0 instead of its flags word, and overlapping
// blocks were painted with the last block in front. Both were checked against the hardware here (live OBJ palettes:
// HAMMER T. record 511 is drawn with slot 18 in 2717/2717 entries; MAME snapshots: the lower OBJ entry wins 10733:34 and
// 32380:51 in en-knifeonly / en-richmond-b), so a difference is "explained" when the atlas equals a render with the
// exporter's own semantics, and the shipped frame is the correct one.
let ED_ = null; const ED = () => ED_ || (ED_ = require('../export/enemy-draw.cjs'));
function exporterCompose(parts, ov, map) {
  const ims = parts.map(p => ({ p, im: ED().recordImage(p.rec, ov, map) })).filter(o => o.im);
  if (!ims.length) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const { p, im } of ims) { x0 = Math.min(x0, p.dx - im.ox); y0 = Math.min(y0, p.dy - im.oy); x1 = Math.max(x1, p.dx - im.ox + im.w); y1 = Math.max(y1, p.dy - im.oy + im.h); }
  const w = x1 - x0, h = y1 - y0, rgba = new Uint8Array(w * h * 4);
  for (const { p, im } of [...ims].reverse()) for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) { const s = (y * im.w + x) * 4; if (!im.rgba[s + 3]) continue; const d = ((p.dy - im.oy - y0 + y) * w + p.dx - im.ox - x0 + x) * 4; rgba[d] = im.rgba[s]; rgba[d + 1] = im.rgba[s + 1]; rgba[d + 2] = im.rgba[s + 2]; rgba[d + 3] = 255; }
  return { w, h, ox: -x0, oy: -y0, rgba };
}
function sameRGBA(a, b) {
  if (!a || !b) return false;
  for (let y = -Math.max(a.oy, b.oy); y < Math.max(a.h - a.oy, b.h - b.oy); y++) for (let x = -Math.max(a.ox, b.ox); x < Math.max(a.w - a.ox, b.w - b.ox); x++) {
    const ga = (im, X, Y) => { X += im.ox; Y += im.oy; if (X < 0 || Y < 0 || X >= im.w || Y >= im.h) return null; const q = (Y * im.w + X) * 4; return im.rgba[q + 3] ? (im.rgba[q] << 16) | (im.rgba[q + 1] << 8) | im.rgba[q + 2] : null; };
    if (ga(a, x, y) !== ga(b, x, y)) return false;
  }
  return true;
}
function causesOf(parts) {
  const out = new Set();
  for (const p of parts) {
    const r = recInfo(p.rec); if (!r) continue;
    if (!r.perBlock) out.add('no-per-block-attr');
    const occ = new Uint8Array(1); let over = false; const cells = new Map();
    r.blocks.forEach((b, k) => { const o = r.offs[k]; if (!o) return; for (let y = 0; y < b.h * 16 && !over; y += 1) for (let x = 0; x < b.w * 16; x += 1) { const key = (o.x + x) * 4096 + (o.y + y); if (cells.has(key) && cells.get(key) !== k) { over = true; break; } cells.set(key, k); } });
    if (over) out.add('overlapping-blocks'); void occ;
  }
  return [...out];
}
function readBackType(T, animsOut, done, fid, decoded, pb, palMap, t, rgbaMode) {
  const res = { checked: 0, identical: 0, different: 0, explained: 0, noRef: 0, causes: {}, examples: [] };
  if (!T.atlas) { res.noRef = -1; return res; }
  const sigsSeen = new Set();
  for (const o of Object.values(animsOut)) {
    if (o.type !== t) continue;
    const vlist = o.variants.length ? o.variants : Object.keys(T.variants).slice(0, 1);
    const objOv = o.a.kind === 'object' && o.a.palette != null ? o.a.palette : null;
    for (const fr of o.a.frames) {
      const sig = new FrameBook().sig(fr.parts), e = done.list[fid.get(sig)];
      for (const V of vlist) {
        const info = T.variants[V]; if (!info) continue;
        const tag = sig + '|' + V; if (sigsSeen.has(tag)) continue; sigsSeen.add(tag);
        const want = o.a.kind === 'object' ? objOv : info.override;
        // pick the atlas frame the exporter coloured for this variant (enemies: variants list; bosses: the home colouring)
        let mapFor = null;
        const pick = rec => {
          const cands = T.atlas.byRec.get(rec) || []; if (!cands.length) return null;
          let f;
          if (T.rd.format === 'enemies') f = cands.find(c => c.pal === want && c.variants && c.variants.includes(info.rom) && !c.key.includes('@')) || cands.find(c => c.pal === want && c.variants && c.variants.includes(info.rom)) || (o.a.kind === 'object' ? cands.find(c => c.pal === want) : null) || null;
          else f = cands[0];
          if (!f) return null;
          f.atlasImg = T.atlas.img;
          if (!mapFor) {
            if (T.rd.format === 'enemies') { const first = Object.values(T.rd.json.variants).find(x => !x.error && f.variants.includes(x.id)); mapFor = { map: objMapArray(first.palette.home.stage, first.palette.home.area, null), ov: f.pal }; }
            else { const P = T.rd.json.palette; const ov = f.palSlots && f.palSlots.length === 1 && info.override != null ? f.palSlots[0] : null; mapFor = { map: objMapArray(P.episodeArea[0], P.episodeArea[1], null), ov }; }
          }
          return f;
        };
        const ref = composeRef(fr.parts, pick);
        if (!ref) { res.noRef++; if (res.examples.length < 12) res.examples.push({ sig, variant: V, noRef: true }); continue; }
        res.checked++;
        const item = rgbaMode ? e.img : itemFromSheet(decoded[e.sheet], e);
        const rows = slot => PAL().rowRGB(mapFor.map[slot]);
        const c = compareAligned(ref, item, colourise(item, rows, mapFor.ov));
        if (c.ok) { res.identical++; continue; }
        res.different++;
        const exp = T.rd.format === 'enemies' ? exporterCompose(fr.parts, mapFor.ov, mapFor.map) : null;
        const explained = exp && sameRGBA(exp, ref);
        const causes = causesOf(fr.parts);
        if (explained) { res.explained++; for (const k of causes) res.causes[k] = (res.causes[k] || 0) + 1; }
        if (res.examples.length < 12) res.examples.push({ sig, variant: V, bad: c.bad, first: c.first, explained: !!explained, causes });
      }
    }
  }
  return res;
}
function writeContactSheets(types, animsOut, done, fid, pb, palMap, decoded, typeList) {
  const files = [];
  if (fs.existsSync(PACK_DIR)) for (const f of fs.readdirSync(PACK_DIR)) if (/^enemies-.*.png$/.test(f)) fs.rmSync(path.join(PACK_DIR, f));   // no stale sheets of dropped types
  for (const t of typeList) {
    const T = types[t], rows = [];
    for (const [V, info] of Object.entries(T.variants)) {
      const mk = palMap[`${t}:${V}`], rowsOf = pb.rowsOf(mk);
      const keys = Object.keys(animsOut).filter(k => animsOut[k].type === t && (animsOut[k].variants.includes(V) || !animsOut[k].variants.length && V === Object.keys(T.variants)[0])).sort((a, b) => { const A = animsOut[a].a, B = animsOut[b].a; return (A.set < B.set ? -1 : A.set > B.set ? 1 : 0) || A.index - B.index; });
      for (const k of keys) {
        const a = animsOut[k].a, cells = a.frames.map((fr, i) => { const e = done.list[fid.get(new FrameBook().sig(fr.parts))], item = itemFromSheet(decoded[e.sheet], e); return { img: item, rgba: colourise(item, rowsOf, null), caption: `${i}:${e.parts[0].rec}${e.parts.length > 1 ? '+' : ''} ${fr.dur}${fr.active ? '*' : ''}` }; });
        rows.push({ title: `${t}:${V} ${info.hud} ${k}\n${a.kind} ${a.label}`.slice(0, 120), cells });
      }
    }
    const file = path.join(PACK_DIR, `enemies-${t}.png`);
    // split very tall sheets so a viewer can open them
    const per = 60;
    for (let i = 0; i < rows.length; i += per) { const f = rows.length > per ? file.replace(/\.png$/, `-${i / per + 1}.png`) : file; contactSheet(f, rows.slice(i, i + per), { title: `${t} (${T.spec.src}) native left-facing, magenta = feet origin, * = active frame` }); files.push(f); }
  }
  return files;
}

module.exports = {
  build, recInfo, isShadowBlock, composeIdx, trim, colourise, mapRows, objMapKey, objMapArray, PalBook, FrameBook, sheetOut, itemFromSheet,
  readEnemyType, readBossEntity, readAtlas, framePartsOf, normFrame, normLoop, attackRecord, rankRow, atkOf, composeRef, compareAligned,
  contactSheet, text, fillRect, putPx, canvasRGBA, blitRGBA, kindRefKeys, budgets, CHAPTER_POOLS, CURRENT_BUDGET, akey, normSet, hex, ROOT, EXTRACT, PACK_DIR, RUNS, readJSON, rel,
  penStats, penRoles, keepPens, acceptRow, sameFamily, handPalette, animNearWrite, kindAttackRefs, attackIdsOfType, packGrouped, inputMd5,
};

if (require.main === module) {
  const r = build({ rgba: process.argv.includes('--rgba') });
  if (process.argv.includes('--json')) console.log(JSON.stringify(r.report, null, 1));
}
