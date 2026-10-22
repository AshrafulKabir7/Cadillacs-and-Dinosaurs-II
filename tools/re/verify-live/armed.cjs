#!/usr/bin/env node
// Armed-state probes: one short run per stage1-<hero>-armed-<weapon> save state, then a live check of the held
// weapon claims (placement 0x24A9A, pose slots, classes/uses, animation sets, stance selection 0x5BDC/0x5CA6).
//   node tools/re/verify-live/armed.cjs run [hero...]      -> runs vl-arm-<hero>-<weapon> (6 in parallel)
//   node tools/re/verify-live/armed.cjs native              -> Mustapha states with facing forced to 0 (art as stored)
//   node tools/re/verify-live/armed.cjs check               -> work/re/verify-live/armed-check.json
'use strict';
const fs = require('fs'), path = require('path');
const VL = require('./vl.cjs');
const R = require('../rom.cjs');
const OUTDIR = path.join(__dirname, '../../../work/re/verify-live');
const HEROES = ['jack', 'hannah', 'mustapha', 'mess'];
const WEAPONS = ['rifle', 'gun', 'knife', 'uzi', 'm16', 'shotgun', 'bazooka', 'rod', 'stick', 'bknife', 'club', 'torch', 'dynamite', 'grenade', 'stone'];
const u8 = a => R.prg[a], u16 = a => R.prg.readUInt16BE(a), s16 = a => R.prg.readInt16BE(a), u32 = a => R.prg.readUInt32BE(a);

function plan(hero, weapon) {
  return {
    name: `vl-arm-${hero}-${weapon}`, frames: 130, loadState: `stage1-${hero}-armed-${weapon}`,
    inputs: [{ from: 30, to: 49, keys: ['right'] }, { from: 70, to: 72, keys: ['attack'] }, { from: 100, to: 102, keys: ['attack'] }],
    dump: { from: 0, to: 129, every: 1, obj: true, cpsA: true, ramFile: true },
    snapshots: [10, 20, 40, 76, 80, 106],
  };
}
function nativePlan(hero, weapon) {
  return {
    name: `vl-native-${hero}-${weapon}`, frames: 40, loadState: `stage1-${hero}-armed-${weapon}`,
    pokes: [{ from: 1, to: 39, addr: '0xFFB298', size: 1, value: 0 }],
    dump: { from: 0, to: 39, every: 1, obj: true, cpsA: true, ramFile: true },
    snapshots: [20, 30],
  };
}
async function pool(plans, k = 6) {
  const q = plans.slice(); const res = [];
  await Promise.all(Array.from({ length: k }, async () => { while (q.length) { const p = q.shift(); res.push(await VL.runPlan(p)); } }));
  return res;
}

// ---------- analysis helpers ----------
function framesOf(setPtr, anim) {   // frame addresses of a 10/12-byte animation (follows until the "last" flag)
  const start = setPtr + s16(setPtr + anim * 2);
  return start;
}
function rd(ram, a) {
  const o = a - 0xFF0000;
  return { b: k => ram[o + k], w: k => ram.readUInt16BE(o + k), sw: k => ram.readInt16BE(o + k), l: k => ram.readUInt32BE(o + k) };
}
function recOf(fp) { if (fp >= R.prg.length) return null; const w0 = u16(fp), w1 = u16(fp + 2); return { w0, w1, rec: w0 & 0x8000 ? null : w0 >> 2, rec2: w1 & 0x8000 ? null : w1 >> 2 }; }

function analyseRun(name) {
  const dir = path.join(VL.RUNS, name);
  if (!fs.existsSync(path.join(dir, 'frames.jsonl'))) return null;
  const frames = VL.readFrames(name);
  const ramAt = n => fs.readFileSync(path.join(dir, `ram-f${String(n).padStart(6, '0')}.bin`));
  const f = 20, ram = ramAt(f);
  const P = rd(ram, 0xFFB274);
  const W = P.w(0xB4) ? rd(ram, 0xFF0000 | P.w(0xB4)) : null;
  const out = { name, char: P.b(0x03), p20: P.w(0x20), heldSlot: P.w(0xB4).toString(16), heroClass: P.w(0xB6).toString(16) };
  if (!W) { out.error = 'no weapon held at f20'; return out; }
  const hold = P.b(0x60) << 24 >> 24;
  Object.assign(out, {
    sub: W.w(0x26), wClass: W.w(0xA0).toString(16), pose: W.w(0xA2) / 4, poseRaw: W.w(0xA2), ammo: W.sw(0x6C), ammoMax: W.sw(0x6A), ammoBar: W.sw(0x6E), holder: W.w(0x70).toString(16),
    hold, hold60: P.w(0x60).toString(16), wSet: W.l(0x40).toString(16), wAnim: W.b(0x22), wFp: W.l(0x28).toString(16), wRec: recOf(W.l(0x28)),
    heroFp: P.l(0x28).toString(16), heroRec: recOf(P.l(0x28)), split: P.b(0x25) & 1, legsRec: P.b(0x25) & 1 ? recOf(P.l(0x30)) : null,
  });
  // placement 0x24A9A (same-frame RAM)
  if (hold >= 0) {
    const tab = u32(0x122230 + P.w(0x20)) + hold * 4, dx = s16(tab), dy = s16(tab + 2);
    const face = P.b(0x24);
    let ex = P.sw(0x08) + (face ? -dx : dx), eh = P.sw(0x0C) + dy;
    if (P.b(0x25) & 1) { eh += P.sw(0x3E); ex += face ? -P.sw(0x3C) : P.sw(0x3C); }
    const animTab = u32(u32(0x120A20 + P.w(0x20)) + W.w(0xA2));
    const eAnim = u8(animTab + hold) << 24 >> 24;
    const eFp = eAnim >= 0 ? W.l(0x40) + s16(W.l(0x40) + eAnim * 2) : null;
    out.placement = { dx, dy, expect: { x: ex, h: eh, d: P.sw(0x10), face, anim: eAnim, fp: eFp && eFp.toString(16) }, got: { x: W.sw(0x08), h: W.sw(0x0C), d: W.sw(0x10), face: W.b(0x24), anim: W.b(0x22) << 24 >> 24, fp: W.l(0x28).toString(16) } };
    const e = out.placement.expect, g = out.placement.got;
    out.placementOk = e.x === g.x && e.h === g.h && e.d === g.d && e.face === g.face && e.anim === g.anim && (e.fp === g.fp);
  }
  // stance selection 0x5BDC (whole-body) / 0x5CA6 (split)
  const cls = P.w(0xB6) & 0xFF, ch = P.b(0x03);
  const wholeIdx = s16(u32(0x5C36 + P.w(0x20)) + cls * 2), splitIdx = s16(u32(0x5D2C + P.w(0x20)) + cls * 2);
  const wset = u32(0x168E + ch * 4);
  const animStart = i => (i < 0 ? null : wset + s16(wset + i * 2));
  out.stance = { cls, wholeIdx, splitIdx, wset: wset.toString(16), wholeStart: animStart(wholeIdx) && animStart(wholeIdx).toString(16), splitStart: animStart(splitIdx) && animStart(splitIdx).toString(16), heroFp: P.l(0x28).toString(16), bob: P.l(0x38).toString(16), bobExpect: u32(0x5D1C + P.w(0x20)).toString(16) };
  // OBJ order: weapon entries before hero entries? (OBJ dump f+1 shows RAM f)
  const fr = frames.find(x => x.f === f + 1);
  if (fr) {
    const wPal = new Set([6]);
    const iW = fr.obj.findIndex(o => o.pal === 6), heroPal = { 0: 0, 1: 2, 2: 1, 3: 3 }[ch];
    const iH = fr.obj.findIndex(o => o.pal === heroPal);
    out.objOrder = { firstWeaponEntry: iW, firstHeroEntry: iH };
  }
  // ammo / step history over the run
  const hist = [];
  let last = null;
  for (let n = 0; n < 130; n++) {
    let r; try { r = ramAt(n); } catch (e) { break; }
    const p = rd(r, 0xFFB274), slot = p.w(0xB4);
    const w = slot ? rd(r, 0xFF0000 | slot) : null;
    const s = `${p.b(0x04)}.${p.b(0x05)}.${p.b(0x06)}.${p.b(0x07).toString(16)} held=${slot.toString(16)} cls=${p.w(0xB6).toString(16)}` + (w ? ` wcls=${w.w(0xA0).toString(16)} pose=${w.w(0xA2) / 4} ammo=${w.sw(0x6C)} wst=${w.b(0x04)}.${w.b(0x05)}` : '');
    if (s !== last) { hist.push(`f${n} ${s}`); last = s; }
  }
  out.history = hist;
  return out;
}

// tight box of the weapon (palette 6) pixels relative to the hero feet, from the OBJ list (native runs)
function tightWeapon(name, f) {
  const frames = VL.readFrames(name);
  const fr = frames.find(x => x.f === f + 1); if (!fr) return null;
  const ram = fs.readFileSync(path.join(VL.RUNS, name, `ram-f${String(f).padStart(6, '0')}.bin`));
  const P = rd(ram, 0xFFB274);
  const feetX = P.sw(0x08) - ram.readInt16BE(0x8744), feetY = ram.readInt16BE(0x8748) - (P.sw(0x10) + P.sw(0x0C)) + 240;
  const W0 = P.w(0xB4) ? rd(ram, 0xFF0000 | P.w(0xB4)) : null;
  const wr = W0 && recOf(W0.l(0x28));
  const codes = new Set(); for (const q of [wr && wr.rec, wr && wr.rec2]) if (q != null) for (const bb of R.parseRecord(q).blocks) codes.add(bb.code);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, pals = new Set();
  for (const o of fr.obj) {
    if (!codes.has(o.code)) continue;
    pals.add(o.pal);
    for (let ty = 0; ty < o.bh; ty++) for (let tx = 0; tx < o.bw; tx++) {
      const code = (o.code & ~0xF) + ((o.code + tx) & 0xF) + 0x10 * ty;
      const t = R.tile(code);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (t[y * 16 + x] === 15) continue;
        let lx = tx * 16 + x, ly = ty * 16 + y;
        if (o.flipX) lx = o.bw * 16 - 1 - lx;
        if (o.flipY) ly = o.bh * 16 - 1 - ly;
        const X = o.sx + lx, Y = o.sy + ly;
        minX = Math.min(minX, X); maxX = Math.max(maxX, X); minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
      }
    }
  }
  const W = P.w(0xB4) ? rd(ram, 0xFF0000 | P.w(0xB4)) : null;
  return { pals: [...pals], face: P.b(0x24), feet: [feetX, feetY], topLeft: [minX - feetX, minY - feetY], size: [maxX - minX + 1, maxY - minY + 1], hold: P.b(0x60), heroRec: recOf(P.l(0x28)), split: P.b(0x25) & 1, legsRec: P.b(0x25) & 1 ? recOf(P.l(0x30)) : null, wRec: W && recOf(W.l(0x28)) };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'run') {
    const heroes = rest.length ? rest : HEROES;
    const res = await pool(heroes.flatMap(h => WEAPONS.map(w => plan(h, w))));
    console.log('runs ok', res.filter(s => s.ok).length, 'of', res.length);
  } else if (cmd === 'native') {
    const res = await pool(WEAPONS.map(w => nativePlan('mustapha', w)));
    console.log('runs ok', res.filter(s => s.ok).length, 'of', res.length);
  } else if (cmd === 'check') {
    const all = [];
    for (const h of HEROES) for (const w of WEAPONS) { const r = analyseRun(`vl-arm-${h}-${w}`); if (r) { r.hero = h; r.weapon = w; all.push(r); } }
    const nat = {};
    for (const w of WEAPONS) { try { nat[w] = { f20: tightWeapon(`vl-native-mustapha-${w}`, 20), f30: tightWeapon(`vl-native-mustapha-${w}`, 30) }; } catch (e) { } }
    fs.writeFileSync(path.join(OUTDIR, 'armed-check.json'), JSON.stringify({ armed: all, nativeMustapha: nat }, null, 1));
    console.log('wrote armed-check.json with', all.length, 'armed analyses');
  }
}
if (require.main === module) main();
module.exports = { analyseRun, tightWeapon };
