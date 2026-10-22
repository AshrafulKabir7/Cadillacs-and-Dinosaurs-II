// CPS-1 OBJ helpers for harness dumps (frames.jsonl from tools/re/mame/run.cjs).
// Rendering follows MAME's cps1 sprite code: entries are drawn from the last to the first (entry 0 ends on top),
// block sprites expand to bw x bh tiles with tile = (code & ~0xf) + ((code + col) & 0xf) + 0x10 * row
// (columns wrap inside a 16-tile row; flipX/flipY reverse the column/row order and mirror each tile),
// pen 15 is transparent, and the visible 384x224 screen starts at OBJ coordinate (64, 16).
'use strict';
const R = require('../rom.cjs');

const X0 = 64, Y0 = 16, W = 384, H = 224;

// MAME cps1_build_palette: word = BRGB (4 bits each), bright = 0x0f + (B << 1), c = n * 0x11 * bright / 0x2d.
function palWordRGB(w) {
  const bright = 0x0f + ((w >> 12) << 1);
  return [((w >> 8) & 15) * 0x11 * bright / 0x2d | 0, ((w >> 4) & 15) * 0x11 * bright / 0x2d | 0, (w & 15) * 0x11 * bright / 0x2d | 0];
}
// frame.pal (hex string) -> [32][16] RGB
function framePalettes(frame) {
  if (!frame.pal) throw new Error('frame has no palette dump (plan dump.palette: true)');
  const out = [];
  for (let p = 0; p < 32; p++) {
    const row = [];
    for (let c = 0; c < 16; c++) { const o = (p * 16 + c) * 4; row.push(palWordRGB(parseInt(frame.pal.slice(o, o + 4), 16))); }
    out.push(row);
  }
  return out;
}

// Expand one OBJ entry into its 16x16 tiles: [{tile, x, y, flipX, flipY}] in OBJ coordinates (x & 0x1ff, y & 0x1ff).
function expand(o) {
  const nx = o.bw, ny = o.bh, fx = !!(o.attr & 0x20), fy = !!(o.attr & 0x40), out = [];
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const col = fx ? nx - 1 - c : c, row = fy ? ny - 1 - r : r;
    out.push({ tile: (o.code & ~0xf) + ((o.code + col) & 0xf) + 0x10 * row, x: (o.x + c * 16) & 0x1ff, y: (o.y + r * 16) & 0x1ff, flipX: fx, flipY: fy });
  }
  return out;
}

// Render a frame's OBJ list to RGBA (alpha 255 where a sprite pixel is opaque). opts: {dx, dy, codeOffset, pals, only(o)=>bool}
function renderObj(frame, opts = {}) {
  const dx = opts.dx === undefined ? -X0 : opts.dx, dy = opts.dy === undefined ? -Y0 : opts.dy, off = opts.codeOffset || 0;
  const pals = opts.pals || framePalettes(frame), rgba = new Uint8Array(W * H * 4), owner = new Int16Array(W * H).fill(-1);
  for (let i = frame.obj.length - 1; i >= 0; i--) {
    const o = frame.obj[i];
    if (opts.only && !opts.only(o)) continue;
    for (const t of expand(o)) {
      const px = R.tile((t.tile + off) & 0xffff);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const pen = px[(t.flipY ? 15 - y : y) * 16 + (t.flipX ? 15 - x : x)];
        if (pen === 15) continue;
        const sx = t.x + x + dx, sy = t.y + y + dy;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const q = sy * W + sx, c = pals[o.attr & 31][pen];
        rgba[q * 4] = c[0]; rgba[q * 4 + 1] = c[1]; rgba[q * 4 + 2] = c[2]; rgba[q * 4 + 3] = 255; owner[q] = i;
      }
    }
  }
  return { w: W, h: H, rgba, owner };
}

// Compare a render with a snapshot (readPNG result): fraction of opaque sprite pixels whose RGB matches exactly.
function compare(render, snap) {
  let opaque = 0, match = 0;
  for (let q = 0; q < W * H; q++) {
    if (render.rgba[q * 4 + 3] !== 255) continue;
    opaque++;
    if (render.rgba[q * 4] === snap.data[q * 4] && render.rgba[q * 4 + 1] === snap.data[q * 4 + 1] && render.rgba[q * 4 + 2] === snap.data[q * 4 + 2]) match++;
  }
  return { opaque, match, agreement: opaque ? match / opaque : 0 };
}

// Group OBJ entries by palette and match each group against ROM frame records (same tiles + same relative layout).
// Returns [{pal, entries, matches:[{record, feetX, feetY, flipX, exact}]}]. feet = screen position of the record origin.
let recIndex = null;
function buildRecordIndex() {
  if (recIndex) return recIndex;
  recIndex = new Map();
  for (let i = 0; i < R.REC_COUNT; i++) {
    const r = R.parseRecord(i); if (!r || !r.offs.length) continue;
    for (const b of r.blocks) { if (!recIndex.has(b.code)) recIndex.set(b.code, new Set()); recIndex.get(b.code).add(i); }
  }
  return recIndex;
}
function matchRecords(entries) {
  const idx = buildRecordIndex(), cand = new Map();
  for (const o of entries) for (const i of idx.get(o.code) || []) cand.set(i, (cand.get(i) || 0) + 1);
  const res = [];
  for (const [i] of cand) {
    const r = R.parseRecord(i);
    // try both facings: entry flipX = record flipX XOR facing
    for (const facing of [false, true]) {
      let feet = null, hit = 0;
      for (let k = 0; k < r.blocks.length; k++) {
        const b = r.blocks[k], lo = r.offs[k], w = b.w * 16;
        const o = entries.find(e => e.code === b.code && e.bw === b.w && e.bh === b.h && (!!(e.attr & 0x20)) === (b.flipX !== facing));
        if (!o) continue;
        const fx = facing ? o.sx + lo.x + w : o.sx - lo.x, fy = o.sy - lo.y;
        if (!feet) feet = [fx, fy];
        if (feet[0] === fx && feet[1] === fy) hit++;
      }
      if (hit) res.push({ record: i, hit, of: r.blocks.length, entries: entries.length, flipX: facing, feetX: feet[0], feetY: feet[1], exact: hit === r.blocks.length && hit === entries.length });
    }
  }
  res.sort((a, b) => (b.exact - a.exact) || (b.hit / Math.max(b.of, b.entries) - a.hit / Math.max(a.of, a.entries)));
  return res;
}

module.exports = { X0, Y0, W, H, palWordRGB, framePalettes, expand, renderObj, compare, matchRecords };
