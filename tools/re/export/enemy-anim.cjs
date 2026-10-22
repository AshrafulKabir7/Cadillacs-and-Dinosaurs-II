// Animation-set decoding for pool-B enemies of the original Cadillacs & Dinosaurs (research only, never shipped).
// Formats (verified): V13 10-byte frames {w0 rec*4 | 0x8000 composite, w1 rec2*4 or composite offset, b4 b5 b6 -> +0x2C..,
// b7 duration | 0x80 last, w8 -> +0x48}; after the last frame a signed word gives the loop target relative to itself.
// Composite (V04 correction): part list at fp + 2 + w1: count-1, then per part dx, dy, rec*4, flag.
// Set = table of signed self-relative word offsets (relative to the table start), one per animation.
'use strict';
const R = require('../rom.cjs');
const hex = (v, n = 0) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');

// number of entries: walk the table until the first animation's data (works with negative offsets too)
function setCount(T, max = 128) {
  let n = 0, minStart = Infinity;
  while (n < max && T + 2 * n < minStart) {
    const off = R.s16(T + 2 * n), start = T + off;
    if (start <= 0 || start >= R.prg.length || (start & 1)) break;
    if (start > T) minStart = Math.min(minStart, start);
    n++;
  }
  return n;
}

function decodeParts(addr) {
  const cnt = R.u16(addr) + 1, parts = [];
  if (cnt > 32) return null;
  let a = addr + 2;
  for (let k = 0; k < cnt; k++) { parts.push({ dx: R.s16(a), dy: R.s16(a + 2), rec: (R.u16(a + 4) & 0x7FFF) >> 2, flag: R.u16(a + 6) }); a += 8; }
  return parts;
}

function decodeFrame(a) {
  const w0 = R.u16(a), w1 = R.u16(a + 2), b7 = R.prg[a + 7];
  const f = { addr: a, w0, w1, b4: R.prg[a + 4], b5: R.prg[a + 5], b6: R.prg[a + 6], dur: b7 & 0x7F, last: !!(b7 & 0x80), w8: R.u16(a + 8) };
  if (w0 & 0x8000) { f.composite = true; f.rec = (w0 & 0x7FFF) >> 2; f.rec2 = null; f.partsAt = a + 2 + R.s16(a + 2); f.parts = decodeParts(f.partsAt); }
  else { f.rec = w0 >> 2; f.rec2 = (w1 & 0x8000) ? null : w1 >> 2; }
  return f;
}

function decodeAnim(start, maxFrames = 96) {
  const frames = []; let a = start, loopTo = null, ok = true;
  for (let k = 0; k < maxFrames; k++) {
    if (a <= 0 || a + 10 > R.prg.length) { ok = false; break; }
    const f = decodeFrame(a); frames.push(f); a += 10;
    if (f.last) { loopTo = a + R.s16(a); break; }
    if (k === maxFrames - 1) ok = false;
  }
  let loopFrame = null;
  if (loopTo !== null) { const i = frames.findIndex(f => f.addr === loopTo); loopFrame = i >= 0 ? i : null; }
  return { addr: start, frames, loopTo, loopFrame, ok };
}

function decodeSet(T) {
  const n = setCount(T), anims = [];
  for (let k = 0; k < n; k++) {
    const off = R.s16(T + 2 * k);
    if (off === 0) { anims.push({ index: k, addr: T, frames: [], loopTo: null, loopFrame: null, ok: false, empty: true }); continue; }
    anims.push({ index: k, ...decodeAnim(T + off) });
  }
  return { set: T, count: n, anims };
}

// frame address -> [{set, anim, frame}]
function frameIndex(sets) {
  const m = new Map();
  for (const s of sets) for (const an of s.anims) an.frames.forEach((f, i) => {
    if (!m.has(f.addr)) m.set(f.addr, []);
    m.get(f.addr).push({ set: s.set, anim: an.index, frame: i });
  });
  return m;
}

// reaction tables (V18): 38 longs each, indexed by enemy +0x84 / 4
const REACT_HELD = 0x2E724, REACT_DOWN = 0x2E68C;
function reactionSets(r84) { return { held: R.u32(REACT_HELD + r84) & 0xFFFFFF, down: R.u32(REACT_DOWN + r84) & 0xFFFFFF }; }

// HUD names (R9 correction): table 0x17D78, 39 word offsets (indices 0x00..0x26), strings = colour byte, text, '@'
function hudName(i) {
  if (i < 0 || i > 0x26) return null;
  let a = 0x17D78 + R.u16(0x17D78 + i * 2) + 1, s = '';
  while (R.prg[a] !== 0x40 && s.length < 20) s += String.fromCharCode(R.prg[a++]);
  return s.trim();
}

module.exports = { hex, setCount, decodeParts, decodeFrame, decodeAnim, decodeSet, frameIndex, reactionSets, hudName, REACT_HELD, REACT_DOWN };
