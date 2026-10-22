// MaxRects atlas packing for the sprite sheets (PLAN §5.3).
//   pack(items:[{id, w, h}], {max:1024, pad:1}) -> {sheets:[{w, h, places:[{id, x, y, w, h}]}]}
// Deterministic: items are sorted by id (numbers before strings, numbers ascending, strings by code unit),
// then placed one by one with best-short-side-fit into the first sheet that has room; a new sheet opens when
// none has. No rotation (ROM art is never rotated). `pad` pixels separate neighbours; sheets are trimmed to
// the used extent. `check(result, items, opts)` verifies no overlap, no item outside its sheet and the padding.
'use strict';

function compareIds(a, b) {
  const na = typeof a === 'number', nb = typeof b === 'number';
  if (na && nb) return a - b;
  if (na !== nb) return na ? -1 : 1;
  const sa = String(a), sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

class Bin {
  constructor(size) { this.size = size; this.free = [{ x: 0, y: 0, w: size, h: size }]; this.places = []; this.w = 0; this.h = 0; }
  find(w, h) {
    let best = null, bs = Infinity, bl = Infinity;
    for (const f of this.free) {
      if (f.w < w || f.h < h) continue;
      const s = Math.min(f.w - w, f.h - h), l = Math.max(f.w - w, f.h - h);
      if (s < bs || (s === bs && (l < bl || (l === bl && (f.y < best.y || (f.y === best.y && f.x < best.x)))))) { best = f; bs = s; bl = l; }
    }
    return best;
  }
  place(id, w, h, pw, ph) {
    const f = this.find(pw, ph); if (!f) return false;
    const r = { x: f.x, y: f.y, w: pw, h: ph };
    const next = [];
    for (const g of this.free) {
      if (r.x >= g.x + g.w || r.x + r.w <= g.x || r.y >= g.y + g.h || r.y + r.h <= g.y) { next.push(g); continue; }
      if (r.x > g.x) next.push({ x: g.x, y: g.y, w: r.x - g.x, h: g.h });
      if (r.x + r.w < g.x + g.w) next.push({ x: r.x + r.w, y: g.y, w: g.x + g.w - r.x - r.w, h: g.h });
      if (r.y > g.y) next.push({ x: g.x, y: g.y, w: g.w, h: r.y - g.y });
      if (r.y + r.h < g.y + g.h) next.push({ x: g.x, y: r.y + r.h, w: g.w, h: g.y + g.h - r.y - r.h });
    }
    // prune rectangles contained in another (keep the first of identical ones)
    const kept = [];
    for (let i = 0; i < next.length; i++) {
      const a = next[i]; let contained = false;
      for (let j = 0; j < next.length && !contained; j++) {
        if (i === j) continue; const b = next[j];
        if (a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h)) contained = true;
      }
      if (!contained) kept.push(a);
    }
    this.free = kept;
    this.places.push({ id, x: r.x, y: r.y, w, h });
    this.w = Math.max(this.w, r.x + w); this.h = Math.max(this.h, r.y + h);
    return true;
  }
}

function pack(items, { max = 1024, pad = 1, sort = 'id' } = {}) {
  const list = items.map(it => ({ id: it.id, w: it.w | 0, h: it.h | 0 }));
  for (const it of list) {
    if (!(it.w > 0 && it.h > 0)) throw new Error(`atlas-pack: item ${it.id} has an empty size ${it.w}x${it.h}`);
    if (it.w > max || it.h > max) throw new Error(`atlas-pack: item ${it.id} (${it.w}x${it.h}) exceeds the ${max}px sheet`);
  }
  if (sort === 'id') list.sort((a, b) => compareIds(a.id, b.id));
  else if (sort === 'height') list.sort((a, b) => b.h - a.h || b.w - a.w || compareIds(a.id, b.id));
  else if (sort === 'area') list.sort((a, b) => b.w * b.h - a.w * a.h || compareIds(a.id, b.id));
  const bins = [];
  for (const it of list) {
    const pw = it.w + pad, ph = it.h + pad;
    let done = false;
    for (const b of bins) if (b.place(it.id, it.w, it.h, pw, ph)) { done = true; break; }
    if (!done) { const b = new Bin(max + pad); bins.push(b); if (!b.place(it.id, it.w, it.h, pw, ph)) throw new Error(`atlas-pack: cannot place ${it.id}`); }
  }
  return { sheets: bins.map(b => ({ w: b.w, h: b.h, places: b.places })) };
}

// Verifies a packing: every item placed once, inside its sheet, no two overlapping (padding included).
function check(result, items, { max = 1024, pad = 1 } = {}) {
  const errors = [], seen = new Set();
  const want = new Map(items.map(it => [String(it.id), it]));
  result.sheets.forEach((s, si) => {
    if (s.w > max || s.h > max) errors.push(`sheet ${si} is ${s.w}x${s.h} > ${max}`);
    for (let i = 0; i < s.places.length; i++) {
      const a = s.places[i], src = want.get(String(a.id));
      if (!src) errors.push(`sheet ${si}: unknown item ${a.id}`);
      else if (src.w !== a.w || src.h !== a.h) errors.push(`sheet ${si}: item ${a.id} size changed`);
      if (seen.has(String(a.id))) errors.push(`item ${a.id} placed twice`); seen.add(String(a.id));
      if (a.x < 0 || a.y < 0 || a.x + a.w > s.w || a.y + a.h > s.h) errors.push(`sheet ${si}: item ${a.id} outside the sheet`);
      for (let j = i + 1; j < s.places.length; j++) {
        const b = s.places[j];
        if (a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad) errors.push(`sheet ${si}: ${a.id} and ${b.id} overlap or touch`);
      }
    }
  });
  for (const id of want.keys()) if (!seen.has(id)) errors.push(`item ${id} not placed`);
  const used = result.sheets.reduce((n, s) => n + s.places.reduce((m, p) => m + p.w * p.h, 0), 0);
  const area = result.sheets.reduce((n, s) => n + s.w * s.h, 0);
  return { ok: !errors.length, errors, sheets: result.sheets.length, fill: area ? used / area : 0 };
}

module.exports = { pack, check, compareIds };
