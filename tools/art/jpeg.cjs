// Baseline JPEG decoder (node built-ins only) for tools/art/import-sprite.cjs: image generators such as the Antigravity
// CLI write .jpg. Sequential Huffman DCT (SOF0 / SOF1), 8-bit, 1 or 3 components, any sampling factors, restart
// intervals. Progressive (SOF2) and arithmetic-coded files throw; the importer then falls back to Windows' own
// System.Drawing conversion (see import-sprite.cjs loadImage).
//   decode(buf) -> {width, height, rgba}
'use strict';

const ZZ = new Int32Array([0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]);
// IDCT basis: C[x*8+u] = c(u)/2 * cos((2x+1)u pi / 16)
const C = (() => { const t = new Float64Array(64); for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) t[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) / 2 * Math.cos((2 * x + 1) * u * Math.PI / 16); return t; })();

function huffTable(counts, symbols) {
  const maxcode = new Int32Array(18).fill(-1), valptr = new Int32Array(17), mincode = new Int32Array(17);
  let code = 0, k = 0;
  for (let l = 1; l <= 16; l++) {
    const n = counts[l - 1]; valptr[l] = k; mincode[l] = code; code += n; k += n;
    maxcode[l] = n ? code - 1 : -1; code <<= 1;
  }
  return { maxcode, valptr, mincode, symbols };
}

function decode(buf) {
  const d = buf;
  if (d[0] !== 0xFF || d[1] !== 0xD8) throw new Error('jpeg.decode: not a JPEG');
  const qt = [], dcT = [], acT = [];
  let frame = null, restart = 0, p = 2;
  const u16 = i => (d[i] << 8) | d[i + 1];
  while (p < d.length) {
    if (d[p] !== 0xFF) { p++; continue; }
    const m = d[p + 1]; p += 2;
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01 || m === 0xFF) { if (m === 0xFF) p--; continue; }
    if (m === 0xD9) break;
    const len = u16(p), seg = p + 2, end = p + len;
    if (m === 0xDB) {
      let q = seg;
      while (q < end) { const pq = d[q] >> 4, tq = d[q] & 15; q++; const t = new Int32Array(64); for (let i = 0; i < 64; i++) { t[i] = pq ? u16(q + i * 2) : d[q + i]; } q += pq ? 128 : 64; qt[tq] = t; }
    } else if (m === 0xC0 || m === 0xC1) {
      const n = d[seg + 5]; frame = { h: u16(seg + 1), w: u16(seg + 3), comps: [] };
      if (d[seg] !== 8) throw new Error('jpeg.decode: only 8-bit samples');
      for (let i = 0; i < n; i++) { const o = seg + 6 + i * 3; frame.comps.push({ id: d[o], h: d[o + 1] >> 4, v: d[o + 1] & 15, tq: d[o + 2] }); }
    } else if (m === 0xC2 || m === 0xC3 || (m >= 0xC5 && m <= 0xCF && m !== 0xC8 && m !== 0xCC)) {
      throw new Error('jpeg.decode: unsupported (progressive / lossless / arithmetic) JPEG');
    } else if (m === 0xC4) {
      let q = seg;
      while (q < end) {
        const tc = d[q] >> 4, th = d[q] & 15; q++;
        const counts = d.subarray(q, q + 16); q += 16; let n = 0; for (let i = 0; i < 16; i++) n += counts[i];
        const t = huffTable(Array.from(counts), d.subarray(q, q + n)); q += n;
        (tc ? acT : dcT)[th] = t;
      }
    } else if (m === 0xDD) {
      restart = u16(seg);
    } else if (m === 0xDA) {
      if (!frame) throw new Error('jpeg.decode: scan before frame');
      const ns = d[seg], sc = [];
      for (let i = 0; i < ns; i++) { const id = d[seg + 1 + i * 2], t = d[seg + 2 + i * 2]; const c = frame.comps.find(x => x.id === id); c.dc = dcT[t >> 4]; c.ac = acT[t & 15]; sc.push(c); }
      p = decodeScan(d, end, frame, sc, qt, restart);
      continue;
    }
    p = end;
  }
  if (!frame) throw new Error('jpeg.decode: no frame');
  return toRGBA(frame);
}

function decodeScan(d, start, frame, sc, qt, restart) {
  const hmax = Math.max(...frame.comps.map(c => c.h)), vmax = Math.max(...frame.comps.map(c => c.v));
  const mcux = Math.ceil(frame.w / (8 * hmax)), mcuy = Math.ceil(frame.h / (8 * vmax));
  for (const c of frame.comps) {
    if (!c.data) { c.bw = mcux * c.h; c.bh = mcuy * c.v; c.stride = c.bw * 8; c.data = new Uint8ClampedArray(c.stride * c.bh * 8); }
    c.pred = 0;
  }
  let pos = start, bitBuf = 0, bitCnt = 0;
  const readBit = () => {
    if (bitCnt === 0) {
      let b = d[pos];
      if (b === 0xFF) { const b2 = d[pos + 1]; if (b2 === 0) pos += 2; else b = 0; } else pos++;   // a marker: feed zeros, stay put
      bitBuf = b; bitCnt = 8;
    }
    bitCnt--; return (bitBuf >> bitCnt) & 1;
  };
  const readBits = n => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | readBit(); return v; };
  const huff = t => {
    let code = 0;
    for (let l = 1; l <= 16; l++) { code = (code << 1) | readBit(); if (t.maxcode[l] >= 0 && code <= t.maxcode[l]) return t.symbols[t.valptr[l] + code - t.mincode[l]]; }
    return 0;
  };
  const extend = s => { if (!s) return 0; const v = readBits(s); return v < (1 << (s - 1)) ? v - (1 << s) + 1 : v; };
  const coef = new Float64Array(64), tmp = new Float64Array(64);
  const block = (c, bx, by) => {
    coef.fill(0); const q = qt[c.tq];
    c.pred += extend(huff(c.dc)); coef[0] = c.pred * q[0];
    for (let k = 1; k < 64;) {
      const rs = huff(c.ac), r = rs >> 4, s = rs & 15;
      if (!s) { if (r === 15) { k += 16; continue; } break; }
      k += r; if (k > 63) break; coef[ZZ[k]] = extend(s) * q[k]; k++;
    }
    // separable IDCT: rows then columns
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += C[x * 8 + u] * coef[y * 8 + u]; tmp[y * 8 + x] = s; }
    const out = c.data, base = by * 8 * c.stride + bx * 8;
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) { let s = 0; for (let v = 0; v < 8; v++) s += C[y * 8 + v] * tmp[v * 8 + x]; out[base + y * c.stride + x] = Math.round(s + 128); }
  };
  const single = sc.length === 1;
  const total = single ? Math.ceil(Math.ceil(frame.w * sc[0].h / hmax) / 8) * Math.ceil(Math.ceil(frame.h * sc[0].v / vmax) / 8) : mcux * mcuy;
  const perRow = single ? Math.ceil(Math.ceil(frame.w * sc[0].h / hmax) / 8) : mcux;
  for (let n = 0; n < total; n++) {
    if (restart && n > 0 && n % restart === 0) {
      bitCnt = 0;
      while (pos < d.length - 1 && !(d[pos] === 0xFF && d[pos + 1] >= 0xD0 && d[pos + 1] <= 0xD7)) pos++;
      pos += 2; for (const c of sc) c.pred = 0;
    }
    const mx = n % perRow, my = (n / perRow) | 0;
    if (single) block(sc[0], mx, my);
    else for (const c of sc) for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) block(c, mx * c.h + h, my * c.v + v);
  }
  // continue the marker walk after the entropy-coded data
  while (pos < d.length - 1 && !(d[pos] === 0xFF && d[pos + 1] !== 0 && !(d[pos + 1] >= 0xD0 && d[pos + 1] <= 0xD7))) pos++;
  return pos;
}

function toRGBA(frame) {
  const { w, h, comps } = frame, hmax = Math.max(...comps.map(c => c.h)), vmax = Math.max(...comps.map(c => c.v));
  const rgba = new Uint8Array(w * h * 4);
  const at = (c, x, y) => c.data[((y * c.v / vmax) | 0) * c.stride + ((x * c.h / hmax) | 0)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (comps.length === 1) { const g = at(comps[0], x, y); rgba[o] = rgba[o + 1] = rgba[o + 2] = g; }
    else {
      const Y = at(comps[0], x, y), cb = at(comps[1], x, y) - 128, cr = at(comps[2], x, y) - 128;
      rgba[o] = clamp(Y + 1.402 * cr); rgba[o + 1] = clamp(Y - 0.344136 * cb - 0.714136 * cr); rgba[o + 2] = clamp(Y + 1.772 * cb);
    }
    rgba[o + 3] = 255;
  }
  return { width: w, height: h, rgba };
}
const clamp = v => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);

module.exports = { decode };
