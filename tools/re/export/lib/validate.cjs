// Pixel validation of the exported hero + held-weapon model against MAME's OBJ lists (armed runs).
// For every frame f of a run: game state from the RAM dumped at f (position, facing, camera, the ROM address of the
// current torso/legs frame, pose slot, palette override) -> blocks predicted from the JSON alone (model.predict) ->
// compared pixel by pixel (palette*16 + pen) with MAME's OBJ list dumped at f+1 (V05 timing), restricted to the
// entries whose tile codes belong to the hero's or the weapon's records.
'use strict';
const L = require('./live.cjs');
const M = require('./model.cjs');

function codesOfHero(hj) {
  const set = new Set(), add = rec => { for (const b of M.recBlocks(rec)) for (let r = 0; r < b.bh; r++) for (let c = 0; c < b.bw; c++) set.add(((b.code & ~0xF) + ((b.code + c) & 0xF) + 0x10 * r)); };
  for (const l of Object.values(hj.lists)) for (const an of l.anims) if (an.frames) for (const f of an.frames) { if (f.parts) f.parts.forEach(p => add(p.rec)); if (f.rec != null) add(f.rec); if (f.rec2 != null) add(f.rec2); }
  return set;
}
function codesOfSet(ws) {
  const set = new Set(), add = rec => { for (const b of M.recBlocks(rec)) for (let r = 0; r < b.bh; r++) for (let c = 0; c < b.bw; c++) set.add(((b.code & ~0xF) + ((b.code + c) & 0xF) + 0x10 * r)); };
  for (const an of ws.anims) if (an.frames) for (const f of an.frames) { if (f.parts) f.parts.forEach(p => add(p.rec)); if (f.rec != null) add(f.rec); if (f.rec2 != null) add(f.rec2); }
  return set;
}
const hexs = n => '0x' + n.toString(16).toUpperCase();

function stateAt(fr) {
  const m = L.mem(fr), P = L.P1;
  const st = { x: m.sw(P + 8), h: m.sw(P + 0xC), d: m.sw(P + 0x10), face: m.b(P + 0x24), split: m.b(P + 0x25) & 1, f25: m.b(P + 0x25), fp: m.l(P + 0x28), lp: m.l(P + 0x30),
    pal23: m.b(P + 0x23), cam: { x: m.sw(0xFF8744), y: m.sw(0xFF8748) }, ram3c: m.sw(P + 0x3C), ram3e: m.sw(P + 0x3E), hold60: m.sb(P + 0x60), weapon: null,
    state: [4, 5, 6, 7].map(k => m.b(P + k).toString(16)).join('.'), cls: m.w(P + 0xB6), drawn: m.b(P + 1) };
  const slot = m.w(P + 0xB4);
  if (slot) {
    const W = 0xFF0000 | slot;
    if (m.has(W) && m.b(W + 5) === 8 && m.w(W + 0x70) === (P & 0xFFFF)) st.weapon = { addr: W, slot: m.w(W + 0xA2) >> 2, set: hexs(m.l(W + 0x40)), pal23: m.b(W + 0x23), x: m.sw(W + 8), h: m.sw(W + 0xC), d: m.sw(W + 0x10), fp: m.l(W + 0x28), anim: m.sb(W + 0x22), sub: m.w(W + 0x26) };
    // the torch's flame: pool A type 0x18 whose +0x5A is the torch (lib/hero-extras.cjs torchFlame)
    if (st.weapon && m.has(0xFF8874 + 24 * 0xC0 - 1)) for (let k = 0; k < 24; k++) { const a = 0xFF8874 + k * 0xC0; if (m.b(a) && m.w(a + 0x20) === 0x18 && m.w(a + 0x5A) === (W & 0xFFFF)) st.flame = { addr: a, x: m.sw(a + 8), h: m.sw(a + 0xC), d: m.sw(a + 0x10), drawn: m.b(a + 1), fp: m.l(a + 0x28), face: m.b(a + 0x24) }; }
  }
  return st;
}

// returns per-run summary + per-frame details of mismatches
function validateRun(J, hero, run, { maxDetail = 20, exclude = null } = {}) {
  const frames = L.readRun(run), byF = new Map(frames.map(f => [f.f, f]));
  const hj = J.heroes[hero], cache = {};
  const heroCodes = codesOfHero(hj), setCodes = {};
  const out = { run, frames: 0, skipped: {}, union: 0, same: 0, exactFrames: 0, poses: {}, mismatches: [], weaponPos: { checked: 0, exact: 0 }, flame: { frames: 0, posExact: 0, depthRule: 0, drawn: 0, union: 0, same: 0, firstMiss: null } };
  const FL = J.companions && J.companions.torchFlame, flIdx = new Map(), flCodes = new Set(); let prevT = null;
  if (FL) for (const an of Object.values(FL.anims)) an.frames.forEach((fr, i) => { flIdx.set(parseInt(fr.addr, 16), { anim: an.addr, i, f: fr }); for (const b of M.recBlocks(fr.rec)) for (let r = 0; r < b.bh; r++) for (let c = 0; c < b.bw; c++) flCodes.add((b.code & ~0xF) + ((b.code + c) & 0xF) + 0x10 * r); });
  for (const fr of frames) {
    const next = byF.get(fr.f + 1); if (!next || !next.obj || !fr.mem) continue;
    if (exclude && exclude.frames.includes(fr.f)) { out.skipped[exclude.why] = (out.skipped[exclude.why] || 0) + 1; continue; }
    const st = stateAt(fr);
    if (st.f25 & 0x40) { out.skipped.bit6 = (out.skipped.bit6 || 0) + 1; continue; }
    if (!st.drawn) { out.skipped['not drawn (+0x01 == 0)'] = (out.skipped['not drawn (+0x01 == 0)'] || 0) + 1; continue; }
    const p = M.predict(J, hero, st, cache);
    if (p.error) { out.skipped[p.error.replace(/0x[0-9A-F]+/gi, 'X')] = (out.skipped[p.error.replace(/0x[0-9A-F]+/gi, 'X')] || 0) + 1; continue; }
    // the weapon object's own RAM position must equal the JSON placement (same frame)
    if (st.weapon && p.info.weaponAt) {
      out.weaponPos.checked++;
      const ex = st.x + p.info.weaponAt[0], eh = st.h + p.info.weaponAt[1];
      if (ex === st.weapon.x && eh === st.weapon.h) out.weaponPos.exact++;
      else if (out.weaponPos.firstMiss == null) out.weaponPos.firstMiss = { f: fr.f, expect: [ex, eh], ram: [st.weapon.x, st.weapon.h], info: p.info };
    }
    // the torch flame: position from the JSON (hold placement + offset table by the torch frame b5), frame from RAM
    let flBlocks = null, flFirst = false, curT = null;
    if (FL && st.weapon && p.info.weaponAt && p.info.weaponAnim >= 0) {
      const tf = J.weaponSets[st.weapon.set].anims[p.info.weaponAnim].frames[0];
      curT = { f: fr.f, x: st.x + p.info.weaponAt[0], h: st.h + p.info.weaponAt[1], face: st.face, b5: tf.b5, addr: st.weapon.addr };
    }
    // pool A runs its slots in address order: a flame in a lower slot than its torch reads the torch as it was one
    // frame earlier (position, facing and frame byte b5); in a higher slot, as it is now
    const T = st.flame && curT ? (st.flame.addr < curT.addr ? (prevT && prevT.f === fr.f - 1 ? prevT : null) : curT) : null;
    if (FL && st.flame && T) {
      const e = FL.offsetTable.entries[T.b5 >> 2];
      const mirror = !!T.face, ex = T.x + (mirror ? -e.dx : e.dx), eh = T.h + e.dy;
      out.flame.frames++;
      if (ex === st.flame.x && eh === st.flame.h) out.flame.posExact++; else if (!out.flame.firstMiss) out.flame.firstMiss = { f: fr.f, expect: [ex, eh], ram: [st.flame.x, st.flame.h], torchB5: tf.b5 };
      const dd = st.flame.d - st.weapon.d; if (dd === 2 || dd === -1) out.flame.depthRule++;
      const ff = flIdx.get(st.flame.fp);
      if (ff && st.flame.drawn) {
        out.flame.drawn++; flBlocks = []; flFirst = st.flame.d < st.d;
        M.placeFrame(ff.f, ex - st.cam.x, st.cam.y - (st.flame.d + eh) + 240, !!st.flame.face, null, 'flame', flBlocks);
      }
    }
    prevT = curT;
    const wcodes = st.weapon ? (setCodes[st.weapon.set] = setCodes[st.weapon.set] || (J.weaponSets[st.weapon.set] ? codesOfSet(J.weaponSets[st.weapon.set]) : new Set())) : new Set();
    const [fx] = p.feet;
    const keep = o => { if (o.sx < fx - 200 || o.sx > fx + 200) return false; for (let r = 0; r < o.bh; r++) for (let c = 0; c < o.bw; c++) { const t = (o.code & ~0xF) + ((o.code + c) & 0xF) + 0x10 * r; if (heroCodes.has(t) || wcodes.has(t) || (flBlocks && flCodes.has(t))) return true; } return false; };
    // shadow sprites (0x14EC0) are appended after every object entry: drop that tail (codes 0x1FF0-0x1FFF, palette 0)
    let tail = next.obj.length; while (tail > 0 && (next.obj[tail - 1].code & 0xFFF0) === 0x1FF0 && (next.obj[tail - 1].attr & 31) === 0) tail--;
    const objs = next.obj.slice(0, tail);
    // pick MAME's entries for the hero and the weapon: each object's entries are contiguous in the list and the
    // weapon's come right before its holder's (V07). Locate them by the predicted code sequence; if a sequence is not
    // found exactly, take the window with the most matching codes (a wrong record then shows up as a pixel mismatch).
    const pick = (seq, lo, hi) => {
      if (!seq.length) return [];
      let best = -1, bestScore = -1;
      for (let i = Math.max(0, lo); i + seq.length <= Math.min(objs.length, hi); i++) {
        let sc = 0; for (let k = 0; k < seq.length; k++) if (objs[i + k].code === seq[k]) sc++;
        if (sc > bestScore) { bestScore = sc; best = i; } if (sc === seq.length) break;
      }
      if (best < 0 || bestScore === 0) return [];
      return objs.slice(best, best + seq.length).map((o, k) => ({ ...o, _i: best + k, _exact: bestScore === seq.length }));
    };
    const pw = p.blocks.filter(b => b.tag === 'weapon'), ph = p.blocks.filter(b => b.tag !== 'weapon');
    const mh = pick(ph.map(b => b.code), 0, objs.length);
    const hs = mh.length ? mh[0]._i : objs.length;
    let mw = pw.length ? pick(pw.map(b => b.code), hs - pw.length, hs) : [];
    if (pw.length && !(mw.length && mw[0]._exact)) mw = pick(pw.map(b => b.code), 0, objs.length);
    const exactSeq = (mh.length ? mh[0]._exact : !ph.length) && (mw.length ? mw[0]._exact : !pw.length);
    if (!exactSeq) out.seqMisses = (out.seqMisses || 0) + 1;
    let chosen = mw.concat(mh).filter(keep), predBlocks = p.blocks;
    if (flBlocks && flBlocks.length) {
      const mf = pick(flBlocks.map(b => b.code), 0, objs.length);
      predBlocks = flFirst ? flBlocks.concat(p.blocks) : p.blocks.concat(flBlocks);
      chosen = flFirst ? mf.concat(chosen) : chosen.concat(mf);
      const fa = M.rasterise(flBlocks), fb = M.rasterise(mf), fc = M.compareBufs(fa, fb); out.flame.union += fc.union; out.flame.same += fc.same;
    }
    const a = M.rasterise(predBlocks), b = M.rasterise(chosen), cmp = M.compareBufs(a, b);
    out.frames++; out.union += cmp.union; out.same += cmp.same;
    const pose = (st.weapon ? 'armed ' : 'empty ') + p.info.frame + (p.info.legs ? ' legs ' + p.info.legs : '') + (st.face ? ' R' : ' L');
    const ps = out.poses[pose] = out.poses[pose] || { frames: 0, union: 0, same: 0, state: st.state };
    ps.frames++; ps.union += cmp.union; ps.same += cmp.same;
    if (cmp.same === cmp.union) out.exactFrames++;
    else if (out.mismatches.length < maxDetail) out.mismatches.push({ f: fr.f, pose, cmp, info: p.info, st: { x: st.x, h: st.h, face: st.face, split: st.split, ram3c: st.ram3c, ram3e: st.ram3e, weapon: st.weapon && { slot: st.weapon.slot, x: st.weapon.x, h: st.weapon.h, anim: st.weapon.anim } } });
  }
  out.agreement = out.union ? out.same / out.union : null;
  return out;
}
module.exports = { validateRun, stateAt, codesOfHero, codesOfSet };
