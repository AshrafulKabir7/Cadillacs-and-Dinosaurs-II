// Independent re-implementation of the per-object sprite writer as read from the 68000 code at 0x141F8..0x14700,
// used to test the draw claims against live OBJ lists. Inputs are the object fields the debugger logged at the
// draw call (0x1405A), so no RAM-timing assumption is involved.
//   drawObject(o, cam) -> [{x, y, code, attr, part}]   (raw OBJ words, x/y before & 0x1FF)
// o: {x, h, d, face, fp, f25, f23, tdx, tdy, lp, f53, c4c, c4d}; cam: {cx (=0xFFE9B6), cy (=0xFFE9B8)}
'use strict';
const R = require('../rom.cjs');
class Unmodelled extends Error {}
const chk = a => { if (a < 0 || a + 4 > R.prg.length) throw new Unmodelled('address outside ROM 0x' + a.toString(16)); return a; };
const u16 = a => R.prg.readUInt16BE(chk(a)), s16 = a => R.prg.readInt16BE(chk(a)), u32 = a => R.prg.readUInt32BE(chk(a));
const w16 = v => ((v % 0x10000) + 0x10000) % 0x10000;
const sx16 = v => { v = w16(v); return v >= 0x8000 ? v - 0x10000 : v; };

// one record at origin (D4, D5); returns OBJ entries; wade = {apply:boolean, drop:number}
function drawRecord(recX4, D4, D5, o, wadeAllowed, out, tag) {
  const ra = u32(u32(0xFFFF4) + sx16(recX4)) & 0xFFFFFF;
  let A1 = ra; A1 += 2;                              // w0 -> 0xFFE9B2 sum
  let D6 = u16(A1) - 1; A1 += 2;
  let D3 = u16(A1); A1 += 2;
  const perBlock = !!(D3 & 0x8000);
  // wading clip (0x142BE / 0x14494): +0x53 set, first-record flag negative, height < 0x18
  let dropped = 0;
  if (o.f53 && wadeAllowed && sx16(o.h) < 0x18) {
    let hh = sx16(o.h); if (hh < 0) hh = 0;
    const idx = ((hh + 8) >> 4) & 1;
    const sub = idx ? o.c4d : o.c4c;
    dropped = sub;
    D6 -= sub;
    if (D6 < 0) return { dropped, perBlock, skippedAll: true };
  }
  const lay = u32(u32(0xFFFFA) + u16(A1) * 4) & 0xFFFFFF; A1 += 2;
  let A2 = lay;
  for (let k = 0; k <= D6; k++) {
    let code, attr;
    if (perBlock) { code = u16(A1); attr = u16(A1 + 2); A1 += 4; } else { code = u16(A1); attr = D3; A1 += 2; }
    if (o.f23 & 0x80) attr = (attr & 0xFFE0) | (o.f23 & 0x1F);
    const lx = s16(A2), ly = s16(A2 + 2); A2 += 4;
    let X;
    if (o.face) {
      attr ^= 0x20;
      const wpx = perBlock ? (((attr >> 4) & 0xF0) + 0x10) : 0x10;   // uniform path subtracts a fixed 16
      X = sx16(-lx - wpx + D4);
    } else X = sx16(lx + D4);
    const width = ((attr >> 4) & 0xF0) + 0x10;
    let draw;
    if (X > 0x1C0) draw = false; else if (X > 0x40) draw = true; else draw = width >= (0x40 - X);
    if (draw) out.push({ x: w16(X), y: w16(D5 + ly), code, attr, tag });
  }
  return { dropped, perBlock };
}

function origin(o, cam, x, h) {
  let D4 = x, D5 = h + o.d;
  if (!(o.f25 & 0x80)) { D4 -= cam.cx; D5 -= cam.cy; }
  D4 = w16(D4); D5 = w16(D5);
  D5 = (D5 & 0xFF00) | ((~D5) & 0xFF); D5 = w16(D5 + 1);
  return { D4: sx16(D4), D5 };
}

// returns {entries, notes}
function drawFrames(o, cam, fp, x, h, out, notes, tag) {
  const inRom = fp + 4 <= R.prg.length;
  const w0 = inRom ? u16(fp) : (tag === 'l' ? null : o.w0);
  if (w0 === null) throw new Unmodelled('legs frame in RAM');
  if (!inRom) notes.ramFrame = true;
  if (w0 & 0x8000) {                               // composite part list (0x14180)
    // 0x14180: the part-list offset is the word after w0 (A3 already points past w0)
    const w1c = inRom ? u16(fp + 2) : o.w1;
    if (!inRom) throw new Unmodelled('composite list in RAM');
    let A3 = fp + 2 + sx16(w1c);
    const cnt = u16(A3); A3 += 2;
    notes.composite = (notes.composite || 0) + 1;
    for (let k = 0; k <= cnt; k++) {
      let dx = s16(A3); A3 += 2; if (o.face) dx = -dx;
      const dy = s16(A3); A3 += 2;
      const rec = u16(A3); A3 += 2;
      const flag = u16(A3); A3 += 2;
      const { D4, D5 } = origin(o, cam, x + dx, h + dy);
      drawRecord(rec, D4, D5, { ...o, h: h + dy }, !!(flag & 0x8000), out, tag + 'c' + k);
    }
    return;
  }
  const { D4, D5 } = origin(o, cam, x, h);
  const w1 = inRom ? u16(fp + 2) : o.w1;
  drawRecord(w0, D4, D5, o, !!(w1 & 0x8000), out, tag + 'r0');
  if (!(w1 & 0x8000)) { notes.second = (notes.second || 0) + 1; drawRecord(w1, D4, D5, o, true, out, tag + 'r1'); }
}

function drawObject(o, cam) {
  const out = [], notes = {};
  if (o.f05 === 4 && o.f2e === 0x0C) { notes.pair = true; return { out, notes }; }
  if (o.f25 & 0x40) { notes.bit6 = true; return { out, notes }; }
  if (o.f25 & 1) {                                 // split body (0x14136): torso at +0x3C/+0x3E, then legs (+0x30)
    notes.split = true;
    const tdx = o.face ? -sx16(o.tdx) : sx16(o.tdx);
    drawFrames({ ...o, f53: 0 }, cam, o.fp, o.x + tdx, o.h + sx16(o.tdy), out, notes, 't');
    drawFrames(o, cam, o.lp, o.x, o.h, out, notes, 'l');
  } else drawFrames(o, cam, o.fp, o.x, o.h, out, notes, '');
  return { out, notes };
}
module.exports = { drawObject, sx16, w16, Unmodelled };
