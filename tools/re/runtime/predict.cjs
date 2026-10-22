// Predict an actor's OBJ entries from RAM and check them against the dumped OBJ list.
//   node predict.cjs <run> <slotAddrHex> [from to] [--verbose]
// For every frame f that has an OBJ dump and a RAM dump at f-1 (sprites trail RAM by one frame, see the harness
// README), it reads the actor at slotAddr in RAM(f-1): frame pointer +0x28 (record = word0/4 when word0 >= 0, plus
// word1/4 when word1 >= 0, as the draw code at 0x14230 does), X +0x08, height +0x0C, depth +0x10, facing +0x24,
// camera 0xFF8744/0xFF8748, and predicts every block of the record(s):
//   feetX = X - camX            feetY = camY - (depth + height) + 240
//   facing != 0 (mirrored): sx = feetX - layout.x - 16*w, flipX = recFlip ^ 1 ; else sx = feetX + layout.x
//   sy = feetY + layout.y
// A frame passes when every predicted block is present in the OBJ list (same code, size, flipX, sx, sy).
// Split-body actors (+0x25 bit0) are reported separately (torso +0x28 drawn at +0x3C/+0x3E, legs +0x30 at the feet).
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../rom.cjs');
const { ramOf, readFrames, RUNS } = require('./rt.cjs');

function recBlocks(rec, feetX, feetY, facing) {
  const r = R.parseRecord(rec); if (!r) return [];
  return r.blocks.map((b, k) => {
    const lo = r.offs[k] || { x: 0, y: 0 };
    return { code: b.code, bw: b.w, bh: b.h, flipX: facing ? !b.flipX : b.flipX, sx: facing ? feetX - lo.x - 16 * b.w : feetX + lo.x, sy: feetY + lo.y };
  });
}
function readActor(ram, a) {
  const o = a - 0xFF0000, sw = k => ram.readInt16BE(o + k), l = k => ram.readUInt32BE(o + k), b = k => ram[o + k];
  const fp = l(0x28), w0 = fp < R.prg.length ? R.u16(fp) : 0x8000, w1 = fp < R.prg.length ? R.u16(fp + 2) : 0x8000;
  const lp = l(0x30), lw0 = lp && lp < R.prg.length ? R.u16(lp) : 0x8000;
  return { x: sw(8), z: sw(0xC), y: sw(0x10), face: b(0x24), flags25: b(0x25), fp, rec: w0 & 0x8000 ? null : w0 >> 2, rec2: w1 & 0x8000 ? null : w1 >> 2,
    legsRec: lw0 & 0x8000 ? null : lw0 >> 2, tdx: sw(0x3C), tdy: sw(0x3E), camX: ram.readInt16BE(0x8744), camY: ram.readInt16BE(0x8748) };
}
function predictActor(A) {
  const feetX = A.x - A.camX, feetY = A.camY - (A.y + A.z) + 240, out = [];
  if (A.flags25 & 1) {
    if (A.legsRec != null) out.push(...recBlocks(A.legsRec, feetX, feetY, A.face));
    if (A.rec != null) out.push(...recBlocks(A.rec, A.face ? feetX + A.tdx : feetX - A.tdx, feetY - A.tdy, A.face));
  } else {
    if (A.rec != null) out.push(...recBlocks(A.rec, feetX, feetY, A.face));
    if (A.rec2 != null) out.push(...recBlocks(A.rec2, feetX, feetY, A.face));
  }
  return { feetX, feetY, blocks: out };
}
// a block entirely outside the visible screen is culled by the game and never reaches the OBJ list
const onScreen = p => p.sx < 384 && p.sx + 16 * p.bw > 0 && p.sy < 224 && p.sy + 16 * p.bh > 0;
function check(objList, blocks) {
  let hit = 0; const miss = [];
  blocks = blocks.filter(onScreen);   // the game culls blocks that are entirely off the 384x224 screen
  for (const p of blocks) {
    const e = objList.find(o => o.code === p.code && o.bw === p.bw && o.bh === p.bh && o.flipX === p.flipX && ((o.sx - p.sx) & 511) === 0 && ((o.sy - p.sy) & 511) === 0);
    if (e) hit++; else miss.push(p);
  }
  return { hit, of: blocks.length, miss };
}
function validate(run, addr, from = 0, to = 1e9, verbose = false) {
  const frames = readFrames(run).filter(f => f.obj && f.f >= from && f.f <= to);
  const have = new Set(fs.readdirSync(path.join(RUNS, run)).filter(f => /^ram-f/.test(f)).map(f => +f.slice(5, 11)));
  const res = { run, addr: '0x' + addr.toString(16).toUpperCase(), frames: 0, pass: 0, split: 0, splitPass: 0, offscreen: 0, noRec: 0, fails: [], records: {} };
  for (const fr of frames) {
    if (!have.has(fr.f - 1)) continue;
    const A = readActor(ramOf(run, fr.f - 1), addr);
    if (A.rec == null && A.legsRec == null) { res.noRec++; continue; }
    const P = predictActor(A);
    if (P.feetX < -64 || P.feetX > 448) { res.offscreen++; continue; }
    const c = check(fr.obj, P.blocks);
    const ok = c.of > 0 && c.hit === c.of;
    res.frames++; if (ok) res.pass++;
    if (A.flags25 & 1) { res.split++; if (ok) res.splitPass++; }
    const key = (A.flags25 & 1) ? `legs${A.legsRec}+torso${A.rec}` : String(A.rec) + (A.rec2 != null ? '+' + A.rec2 : '');
    res.records[key] = (res.records[key] || 0) + 1;
    if (!ok && res.fails.length < 25) res.fails.push({ f: fr.f, rec: A.rec, rec2: A.rec2, legs: A.legsRec, split: !!(A.flags25 & 1), face: A.face, feet: [P.feetX, P.feetY], hit: c.hit, of: c.of, miss: c.miss.slice(0, 3) });
    if (verbose) console.log(fr.f, ok ? 'OK ' : 'BAD', JSON.stringify({ rec: A.rec, legs: A.legsRec, feet: [P.feetX, P.feetY], hit: c.hit, of: c.of }));
  }
  return res;
}
if (require.main === module) {
  const a = process.argv.slice(2);
  const r = validate(a[0], parseInt(a[1], 16), a[2] ? +a[2] : 0, a[3] ? +a[3] : 1e9, a.includes('--verbose'));
  console.log(JSON.stringify(r, null, 1).slice(0, 6000));
}
module.exports = { recBlocks, readActor, predictActor, check, validate };

// Pool mode: validate every active slot of a pool on every frame. Returns per-type stats.
function validatePool(run, base, n, stride, from = 0, to = 1e9) {
  const frames = readFrames(run).filter(f => f.obj && f.f >= from && f.f <= to);
  const have = new Set(fs.readdirSync(path.join(RUNS, run)).filter(f => /^ram-f/.test(f)).map(f => +f.slice(5, 11)));
  const byType = {};
  for (const fr of frames) {
    if (!have.has(fr.f - 1)) continue;
    const ram = ramOf(run, fr.f - 1);
    for (let k = 0; k < n; k++) {
      const a = base + k * stride, o = a - 0xFF0000;
      if (!ram[o] || !ram[o + 1]) continue;                 // inactive or not registered for drawing (+0x01)
      if (ram[o + 0x25] & 0x80) continue;                    // screen-space objects
      const A = readActor(ram, a), type = '0x' + ram.readUInt16BE(o + 0x20).toString(16);
      if (A.rec == null && A.legsRec == null) continue;
      const P = predictActor(A);
      if (P.feetX < -96 || P.feetX > 480 || P.feetY < -64 || P.feetY > 320) continue;
      const c = check(fr.obj, P.blocks), ok = c.hit === c.of;
      if (!c.of) continue;   // every block culled (off screen)
      const t = byType[type] || (byType[type] = { frames: 0, pass: 0, absent: 0, partial: 0, slots: new Set(), records: new Set(), hp: new Set(), fails: [] });
      if (!ok) { if (c.hit === 0) t.absent++; else t.partial++; }   // absent = whole object not drawn this frame (blink/flicker)
      t.frames++; if (ok) t.pass++; t.slots.add(k); t.records.add(A.rec); t.hp.add(ram.readInt16BE(o + 0x6C));
      if (!ok && t.fails.length < 5) t.fails.push({ f: fr.f, slot: k, rec: A.rec, rec2: A.rec2, feet: [P.feetX, P.feetY], hit: c.hit, of: c.of });
    }
  }
  for (const t of Object.values(byType)) { t.slots = [...t.slots]; t.records = [...t.records].sort((x, y) => x - y); t.hp = [...t.hp].sort((x, y) => x - y); }
  return byType;
}
module.exports.validatePool = validatePool;
