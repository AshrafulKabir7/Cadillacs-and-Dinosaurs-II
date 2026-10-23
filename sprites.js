// sprites.js - window.SPRITES: the one runtime colouriser for every ROM sprite family (PLAN RC2, §4.1; ARCHITECTURE
// §4.4, §5.1), the family globals ROM_HEROES / ROM_FX / ROM_ENEMIES / ROM_BOSSES / ROM_UI, and the ARCADE_HEROES
// compatibility view today's game.js and the suites read (PLAN §4.6) until G3 removes the last reader.
//
// Sheets are slot-indexed PNG data URLs: R = OBJ palette slot (0-31), G = pen (0-15), B = 0, A = 255; A = 0 is
// transparent. Each sheet is decoded once with getImageData (allowed: data-URL sources never taint a canvas, also
// under file://) and checked against its FNV-1a `sum` over (R<<4|G) of the opaque pixels; any mismatch (browser
// colour management, a stale build) leaves SPRITES.verified false. canvasFor(sheet, mapKey) colours a sheet through a
// palette map (32 slots -> ROM row keys -> 16 x 0xRRGGBB) on first use - one pass through a 512-entry lookup table and
// one putImageData - and keeps the canvases under a 48 MB LRU. A family built with --rgba (mode 'rgba') is drawn as
// is: the colouriser is the identity for it.
//
// Load order: anywhere before game.js. Families added before or after this file are picked up (SPRITE_DATA.add is
// wrapped). Nothing here calls Math.random.
//
// Lazy sheets (the generated boss bodies, sprite-data-boss-*.js): a sheet def with `lazy` (a script path) and no `png`
// ships its frames, anims and palettes at start-up but its pixels per chapter. It stays out of ready / verified /
// familyReady (state 'lazy') until loadSheets(family, ids) injects its script, which hands the data URL over with
// SPRITE_DATA.sheetPng(family, id, png); then it decodes and is checked like any other sheet. A script tag, not a
// fetch, so file:// keeps working.
(function (root) {
  'use strict';
  if (root.SPRITES && root.SPRITES.__colouriser) return;
  const GLOBALS = { heroes: 'ROM_HEROES', fx: 'ROM_FX', enemies: 'ROM_ENEMIES', bosses: 'ROM_BOSSES', ui: 'ROM_UI' };
  const ORDER = ['heroes', 'fx', 'enemies', 'bosses', 'ui'];
  const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const hasDOM = typeof document !== 'undefined' && typeof Image !== 'undefined';

  const SD = root.SPRITE_DATA = root.SPRITE_DATA || { families: {}, add(name, fam) { this.families[name] = fam; } };
  const fams = {};                 // family -> merged family object
  const sheets = {};               // 'family/sheet' -> entry {key, family, id, fam, def, state, w, h, idx, ok, canvas, ms}
  const bare = {};                 // sheet id -> first 'family/sheet' key
  const recs = {};                 // family -> rec -> [{key, sheet, r}]
  const luts = {};                 // 'family|mapKey' -> Int32Array(512)
  const lru = new Map();           // 'family/sheet|mapKey' -> {canvas, bytes}
  const waiters = [];              // {family|null, cb}
  let lruBytes = 0;
  const stats = { decoded: 0, failed: 0, mismatched: [], colourised: 0, evicted: 0, msPerMpx: 0, maxMsPerMpx: 0, bytes: 0, missingRows: {}, boxes: 0, phase: { canvas: 0, image: 0, fill: 0, put: 0, mpx: 0 } };

  const famName = n => String(n).replace(/-ch\d+$/, '');
  function merge(into, add) {
    for (const k of ['sheets', 'rect', 'bodies', 'types', 'anims', 'objects', 'palMap']) if (add[k]) into[k] = Object.assign(into[k] || {}, add[k]);
    if (add.pal) { into.pal = into.pal || {}; for (const k of ['rows', 'maps']) if (add.pal[k]) into.pal[k] = Object.assign(into.pal[k] || {}, add.pal[k]); }
    if (Array.isArray(add.frames)) into.frames = (into.frames || []).concat(add.frames);
    for (const k of Object.keys(add)) if (!(k in into)) into[k] = add[k];
    return into;
  }

  // ---------------------------------------------------------------- registration
  function register(name, fam) {
    if (!fam || typeof fam !== 'object') return;
    const f = famName(name);
    const cur = fams[f] && fams[f] !== fam ? merge(fams[f], fam) : fam;
    fams[f] = cur;
    if (GLOBALS[f]) root[GLOBALS[f]] = cur;
    for (const [id, def] of Object.entries(fam.sheets || {})) {
      const key = `${f}/${id}`; if (sheets[key] && sheets[key].def === def) continue;
      const lazy = !!def.lazy && typeof def.png !== 'string';
      sheets[key] = { key, family: f, id, fam: cur, def, state: lazy ? 'lazy' : 'pending', w: def.w, h: def.h, idx: null, ok: null, canvas: null };
      if (bare[id] == null) bare[id] = key;
      if (lazy && pendingPng[key]) { def.png = pendingPng[key]; delete pendingPng[key]; sheets[key].state = 'pending'; }
      if (sheets[key].state === 'pending') decode(sheets[key]);
    }
    const idx = recs[f] = recs[f] || {};
    for (const [sid, m] of Object.entries(fam.rect || {})) for (const [rec, r] of Object.entries(m)) (idx[rec] = idx[rec] || []).push({ key: `${f}/${sid}`, sheet: sid, r });
    if (Array.isArray(fam.frames)) for (const fr of fam.frames) if (Array.isArray(fr) && fr.length >= 8) { const sid = String(fr[0]); (idx[fr[7]] = idx[fr[7]] || []).push({ key: `${f}/${sid}`, sheet: sid, r: [fr[1], fr[2], fr[3], fr[4], fr[5], fr[6]] }); }
    for (const k of Object.keys(luts)) if (k.startsWith(f + '|')) delete luts[k];
    if (f === 'heroes' && cur.compat) root.ARCADE_HEROES = compatView(cur);
    settle();
  }
  // the pixels of a lazy sheet (its script calls this; before its family registered, the data URL waits)
  const pendingPng = {};
  SD.sheetPng = function (family, id, png) {
    const key = `${famName(family)}/${id}`, e = sheets[key];
    if (!e) { pendingPng[key] = png; return; }
    if (e.state !== 'lazy' && e.state !== 'loading') return;
    e.def.png = png; e.state = 'pending'; decode(e);
  };
  const add0 = SD.add;
  SD.add = function (name, fam) { const r = add0.call(this, name, fam); register(name, this.families[name] || fam); return r; };
  for (const [n, fam] of Object.entries(SD.families || {})) register(n, fam);

  // ---------------------------------------------------------------- decoding and the checksum
  function makeCanvas(w, h) {
    if (hasDOM) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    return null;
  }
  function decode(e) {
    if (!hasDOM) { e.state = 'nodom'; return; }
    const src = e.def.png;
    if (typeof src !== 'string' || src.slice(0, 5) !== 'data:') { e.state = 'bad'; e.ok = false; stats.failed++; settle(); return; }   // only data URLs are pixel-read
    const img = new Image();
    img.onload = () => {
      try {
        const t0 = now(), w = img.naturalWidth, h = img.naturalHeight, c = makeCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, w, h).data, n = w * h, idx = new Uint16Array(n);
        let sum = 0x811C9DC5;
        for (let i = 0, q = 0; i < n; i++, q += 4) {
          if (d[q + 3] === 0) { idx[i] = 0xFFFF; continue; }
          const v = ((d[q] << 4) | (d[q + 1] & 15)) & 0xFFFF; idx[i] = v;
          sum ^= v; sum = Math.imul(sum, 0x01000193) >>> 0;
        }
        // the opaque pixels as two parallel lists (position, slot*16+pen): colourising is one sequential pass over
        // them (the hero sheets are ~60 % transparent), then one putImageData
        let m = 0; for (let i = 0; i < n; i++) if (idx[i] !== 0xFFFF) m++;
        const pos = new Uint32Array(m), codes = new Uint16Array(m);
        for (let i = 0, k = 0; i < n; i++) { const v = idx[i]; if (v !== 0xFFFF) { pos[k] = i; codes[k++] = v & 511; } }
        e.w = w; e.h = h; e.idx = idx; e.pos = pos; e.codes = codes;
        e.ok = sum.toString(16) === String(e.def.sum).replace(/^0x/, '').toLowerCase() && w === e.def.w && h === e.def.h;
        if (!e.ok) stats.mismatched.push(e.key);
        if (e.fam.mode === 'rgba') e.canvas = c;                     // identity colouriser
        e.state = 'ok'; e.ms = now() - t0; stats.decoded++;
      } catch (err) { e.state = 'bad'; e.ok = false; e.error = String(err && err.message || err); stats.failed++; }
      settle(); fireSheet(e);
    };
    img.onerror = () => { e.state = 'bad'; e.ok = false; stats.failed++; settle(); fireSheet(e); };
    img.src = src;
  }
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const done = e => e.state === 'ok' || e.state === 'bad';
  // lazy sheets not loaded yet do not hold up ready / verified / familyReady
  const famSheets = f => Object.values(sheets).filter(e => (!f || e.family === famName(f)) && e.state !== 'lazy' && e.state !== 'loading');
  // callbacks of one sheet's load (loadSheets)
  const sheetCbs = new Map();
  function fireSheet(e) { const l = sheetCbs.get(e.key); if (!l) return; sheetCbs.delete(e.key); for (const cb of l) { try { cb(); } catch (err) { setTimeout(() => { throw err; }, 0); } } }
  function loadSheets(family, ids) {
    const f = famName(family), list = (ids || []).map(id => sheets[`${f}/${id}`]).filter(Boolean);
    return Promise.all(list.map(e => {
      if (done(e)) return true;
      const p = new Promise(res => { const l = sheetCbs.get(e.key) || []; l.push(() => res(e.state === 'ok')); sheetCbs.set(e.key, l); });
      if (e.state === 'lazy') {
        if (!hasDOM) { fireSheet(e); return false; }
        e.state = 'loading'; const sc = document.createElement('script'); sc.src = e.def.lazy; sc.async = true;
        sc.onerror = () => { e.state = 'lazy'; fireSheet(e); };
        (document.head || document.documentElement).appendChild(sc);
      }
      return p;
    })).then(r => r.filter(Boolean).length);
  }
  function familyReady(f) { const l = famSheets(f); return l.length > 0 && l.every(done) && l.every(e => e.state === 'ok'); }
  function settle() {
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i], l = famSheets(w.family);
      if (l.length && l.every(done)) { waiters.splice(i, 1); try { w.cb(w.family ? familyReady(w.family) : SPRITES.ready); } catch (err) { setTimeout(() => { throw err; }, 0); } }
    }
  }

  // ---------------------------------------------------------------- palettes
  function rowFor(f, key) {
    const own = fams[f] && fams[f].pal && fams[f].pal.rows;
    if (own && own[key] != null) return own[key];
    for (const n of ORDER) { const r = fams[n] && fams[n].pal && fams[n].pal.rows; if (r && r[key] != null) return r[key]; }
    return null;
  }
  function mapFor(f, key) {
    const own = fams[f] && fams[f].pal && fams[f].pal.maps;
    if (own && own[key]) return own[key];
    for (const n of ORDER) { const m = fams[n] && fams[n].pal && fams[n].pal.maps; if (m && m[key]) return m[key]; }
    return null;
  }
  function lutFor(f, mapKey) {
    const k = `${f}|${mapKey}`; if (luts[k]) return luts[k];
    const map = mapFor(f, mapKey); if (!map) return null;
    const lut = new Int32Array(512);                          // int32 stays unboxed in the fill loop
    for (let s = 0; s < 32; s++) {
      const rk = Array.isArray(map) ? map[s] : map[s] != null ? map[s] : map[String(s)];
      if (rk == null) continue;
      const row = rowFor(f, rk);
      if (!row) { stats.missingRows[`${f}:${mapKey}:${s}`] = rk; continue; }
      for (let p = 0; p < 15; p++) {
        const c = row[p] >>> 0, r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
        lut[s * 16 + p] = LITTLE ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255;
      }
    }
    return (luts[k] = lut);
  }

  // ---------------------------------------------------------------- colourised canvases (LRU)
  function resolve(sheetKey, family) {
    if (!sheetKey) return null;
    if (sheets[sheetKey]) return sheets[sheetKey];
    if (family && sheets[`${famName(family)}/${sheetKey}`]) return sheets[`${famName(family)}/${sheetKey}`];
    return bare[sheetKey] ? sheets[bare[sheetKey]] : null;
  }
  function fill(px, pos, codes, lut) { for (let k = 0, m = pos.length; k < m; k++) px[pos[k]] = lut[codes[k]]; }
  // one scratch pixel buffer shared by every colourisation: no fresh (page-faulting, zeroed) 4 MB allocation per
  // canvas. It only ever holds the opaque pixels of the last sheet coloured; switching sheets zeroes those first.
  let scratch = null, scratchOf = null;
  function scratchFor(e) {
    const n = e.w * e.h;
    if (!scratch || scratch.byteLength < n * 4) { scratch = new ArrayBuffer(Math.max(n * 4, 1024 * 1024 * 4)); scratchOf = null; }
    const px = new Int32Array(scratch, 0, n);
    if (scratchOf !== e) { if (scratchOf) { const p = scratchOf.pos, z = new Int32Array(scratch); for (let k = 0; k < p.length; k++) z[p[k]] = 0; } scratchOf = e; }
    return { px, img: new ImageData(new Uint8ClampedArray(scratch, 0, n * 4), e.w, e.h) };
  }
  // canvasFor(sheet, mapKey[, family[, rect]]) -> the sheet coloured through the map (a canvas, pixel-readable).
  // Without `rect` the whole sheet is coloured at once. With rect = [sx, sy, w, h] (a record box, what HeroRig.draw
  // passes) only that box is guaranteed coloured: boxes are coloured on first use, so a palette variant that appears
  // mid-chapter costs the few thousand pixels it actually shows, not the sheet. Boxes never overlap (1 px padding).
  function colourAll(e, c, lut) {
    const t0 = now(), g = c.getContext('2d'), sc = typeof ImageData !== 'undefined' ? scratchFor(e) : null, img = sc ? sc.img : g.createImageData(e.w, e.h), t1 = now();
    fill(sc ? sc.px : new Int32Array(img.data.buffer), e.pos, e.codes, lut);
    const t2 = now(); g.putImageData(img, 0, 0);
    const t3 = now(), mpx = e.w * e.h / 1e6, rate = mpx ? (t3 - t0) / mpx : 0, ph = stats.phase;
    ph.image += t1 - t0; ph.fill += t2 - t1; ph.put += t3 - t2; ph.mpx += mpx;
    stats.colourised++; stats.msPerMpx = stats.msPerMpx ? stats.msPerMpx * 0.8 + rate * 0.2 : rate; if (rate > stats.maxMsPerMpx) stats.maxMsPerMpx = rate;
  }
  function colourBox(e, c, lut, r) {
    const sx = Math.max(0, r[0] | 0), sy = Math.max(0, r[1] | 0), w = Math.min(e.w - sx, r[2] | 0), h = Math.min(e.h - sy, r[3] | 0); if (w <= 0 || h <= 0) return;
    const g = c.getContext('2d'), img = g.createImageData(w, h), px = new Int32Array(img.data.buffer), idx = e.idx, W = e.w;
    for (let y = 0, q = 0; y < h; y++) { let i = (sy + y) * W + sx; for (let x = 0; x < w; x++, i++, q++) { const v = idx[i]; if (v !== 0xFFFF) px[q] = lut[v & 511]; } }
    g.putImageData(img, sx, sy); stats.boxes++;
  }
  function canvasFor(sheetKey, mapKey, family, rect) {
    const e = resolve(sheetKey, family); if (!e || e.state !== 'ok') return null;
    if (e.fam.mode === 'rgba') return e.canvas;
    const key = `${e.key}|${mapKey}`; let hit = lru.get(key);
    if (hit) {
      lru.delete(key); lru.set(key, hit);
      if (hit.full) return hit.canvas;
      if (rect) { const bk = rect[0] + ',' + rect[1]; if (!hit.boxes.has(bk)) { colourBox(e, hit.canvas, hit.lut, rect); hit.boxes.add(bk); } return hit.canvas; }
      colourAll(e, hit.canvas, hit.lut); hit.full = true; hit.boxes = null; return hit.canvas;
    }
    const lut = lutFor(e.family, mapKey); if (!lut) return null;
    const t0 = now(), c = makeCanvas(e.w, e.h); if (!c) return null;
    stats.phase.canvas += now() - t0;
    hit = { canvas: c, bytes: e.w * e.h * 4, lut, full: !rect, boxes: rect ? new Set([rect[0] + ',' + rect[1]]) : null };
    if (rect) colourBox(e, c, lut, rect); else colourAll(e, c, lut);
    lru.set(key, hit); lruBytes += hit.bytes;
    while (lruBytes > SPRITES.budget && lru.size > 1) { const [k0, v0] = lru.entries().next().value; if (k0 === key) break; lru.delete(k0); lruBytes -= v0.bytes; try { v0.canvas.width = 0; } catch (err) { /* detached */ } stats.evicted++; }
    stats.bytes = lruBytes;
    return c;
  }
  function locate(family, rec, sheetHint) {
    const f = famName(family || 'heroes'), list = recs[f] && recs[f][rec];
    if (!list || !list.length) return null;
    const hit = (sheetHint && list.find(x => x.sheet === sheetHint)) || list[0];
    return { key: hit.key, family: f, sheet: hit.sheet, r: hit.r };
  }

  // ---------------------------------------------------------------- ARCADE_HEROES compatibility view (PLAN §4.6)
  // {sheet, sheet2, frames:[{x,y,w,h,anchor,oy,rec,hand,grip,s?,gunDrawn?}], heroes:{id:{name:[frameIdx]}}}: today's
  // arcade-heroes.js shape, lists, records and hand points, on the ROM sheets. `sheet` / `sheet2` are built on first
  // read without decoding anything: the hero sheets are palette PNGs whose IDAT bodies splice (sync-flushed deflate,
  // None/Sub row filters), so the stack is one IHDR + a recoloured PLTE + the concatenated bodies.
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u, a, b) => { let c = 0xFFFFFFFF; for (let i = a; i < b; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const b64d = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const b64e = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  function pngParts(url) {
    const u = b64d(url.slice(url.indexOf(',') + 1)), idat = []; let p = 8, w = 0, h = 0;
    while (p + 8 <= u.length) {
      const len = ((u[p] << 24) | (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3]) >>> 0, type = String.fromCharCode(u[p + 4], u[p + 5], u[p + 6], u[p + 7]);
      if (type === 'IHDR') { w = ((u[p + 8] << 24) | (u[p + 9] << 16) | (u[p + 10] << 8) | u[p + 11]) >>> 0; h = ((u[p + 12] << 24) | (u[p + 13] << 16) | (u[p + 14] << 8) | u[p + 15]) >>> 0; }
      if (type === 'IDAT') idat.push(u.subarray(p + 8, p + 8 + len));
      if (type === 'IEND') break;
      p += 12 + len;
    }
    let n = 0; for (const d of idat) n += d.length; const z = new Uint8Array(n); n = 0; for (const d of idat) { z.set(d, n); n += d.length; }
    if (z[0] !== 0x78 || z[z.length - 6] !== 0x03 || z[z.length - 5] !== 0x00) throw new Error('sprites: hero sheet IDAT is not spliceable');
    return { w, h, body: z.subarray(2, z.length - 6) };
  }
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length), n = data.length;
    out[0] = n >>> 24; out[1] = (n >>> 16) & 255; out[2] = (n >>> 8) & 255; out[3] = n & 255;
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8); const c = crc32(out, 4, 8 + n);
    out[8 + n] = c >>> 24; out[9 + n] = (c >>> 16) & 255; out[10 + n] = (c >>> 8) & 255; out[11 + n] = c & 255;
    return out;
  }
  function compatPNG(fam, st) {
    const parts = st.ids.map(id => pngParts(fam.sheets[id].png)), w = parts[0].w, h = parts.reduce((n, q) => n + q.h, 0);
    if (h !== st.h || parts.some(q => q.w !== w)) throw new Error('sprites: compat stack size mismatch');
    const plte = new Uint8Array((fam.compat.plte.length + 1) * 3), trns = new Uint8Array(fam.compat.plte.length + 1).fill(255); trns[0] = 0;
    const map = fam.pal.maps[fam.pal.home || 'hero'] || [];
    fam.compat.plte.forEach(([slot, pen], i) => { const row = fam.pal.rows[map[slot]] || fam.pal.rows[slot] || []; const c = row[pen] >>> 0; plte[(i + 1) * 3] = (c >> 16) & 255; plte[(i + 1) * 3 + 1] = (c >> 8) & 255; plte[(i + 1) * 3 + 2] = c & 255; });
    let n = 2; for (const q of parts) n += q.body.length; const z = new Uint8Array(n + 6); z[0] = 0x78; z[1] = 0xDA; n = 2;
    for (const q of parts) { z.set(q.body, n); n += q.body.length; }
    const ad = parseInt(st.adler, 16) >>> 0; z[n] = 0x03; z[n + 1] = 0x00; z[n + 2] = ad >>> 24; z[n + 3] = (ad >>> 16) & 255; z[n + 4] = (ad >>> 8) & 255; z[n + 5] = ad & 255;
    const ihdr = new Uint8Array(13); ihdr[0] = w >>> 24; ihdr[1] = (w >>> 16) & 255; ihdr[2] = (w >>> 8) & 255; ihdr[3] = w & 255; ihdr[4] = h >>> 24; ihdr[5] = (h >>> 16) & 255; ihdr[6] = (h >>> 8) & 255; ihdr[7] = h & 255; ihdr[8] = 8; ihdr[9] = 3;
    const pieces = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('tRNS', trns), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
    let len = 0; for (const p of pieces) len += p.length; const out = new Uint8Array(len); len = 0; for (const p of pieces) { out.set(p, len); len += p.length; }
    return 'data:image/png;base64,' + b64e(out);
  }
  function compatView(fam) {
    const C = fam.compat, yOff = {}; let y = 0;
    for (const id of C.sheet.ids) { yOff[id] = y; y += fam.sheets[id].h; }
    const owner = {}; for (const [hero, lists] of Object.entries(C.lists)) for (const li of Object.values(lists)) for (const i of li) owner[i] = hero;
    const frames = C.frames.map(([rec, hand, grip, flags], i) => {
      const hero = owner[i] || Object.keys(fam.rect).find(k => fam.rect[k][rec]) || null, r = hero && fam.rect[hero] && fam.rect[hero][rec];
      const on2 = !!r && C.sheet2.ids.includes(hero), f = r ? { x: r[0], y: r[1] + (on2 ? 0 : yOff[hero]), w: r[2], h: r[3], anchor: r[4], oy: r[5], rec } : { x: 0, y: 0, w: 0, h: 0, anchor: 0, oy: 0, rec };   // w 0: a legacy frame no list uses
      if (hand) f.hand = hand.slice(); if (grip) f.grip = grip.slice(); if (on2) f.s = 2; if (flags & 1) f.gunDrawn = true;
      return f;
    });
    const heroes = {}; for (const [hero, lists] of Object.entries(C.lists)) { heroes[hero] = {}; for (const [n, li] of Object.entries(lists)) heroes[hero][n] = li.slice(); }
    let s1 = null, s2 = null;
    const v = { frames, heroes, compat: true, rom: fam };
    Object.defineProperty(v, 'sheet', { enumerable: true, get() { return s1 || (s1 = compatPNG(fam, C.sheet)); } });
    Object.defineProperty(v, 'sheet2', { enumerable: true, get() { return s2 || (s2 = compatPNG(fam, C.sheet2)); } });
    return v;
  }

  // ---------------------------------------------------------------- public API
  const SPRITES = {
    __colouriser: 1,
    budget: 48 * 1048576,
    stats,
    get families() { return fams; },
    get ready() { const l = famSheets(null); return l.length > 0 && l.every(e => e.state === 'ok'); },
    get verified() { const l = famSheets(null); return l.length > 0 && l.every(e => e.state === 'ok' && e.ok === true); },
    familyReady, loadSheets,
    // lazy sheets: {key: state}
    lazyStatus() { const o = {}; for (const e of Object.values(sheets)) if (e.def && e.def.lazy) o[e.key] = e.state; return o; },
    whenReady(family, cb) { if (typeof family === 'function') { cb = family; family = null; } waiters.push({ family: family ? famName(family) : null, cb }); settle(); },
    status() { return Object.values(sheets).map(e => ({ key: e.key, state: e.state, ok: e.ok, w: e.w, h: e.h, ms: e.ms || null })); },
    sheet(key, family) { const e = resolve(key, family); return e ? { key: e.key, family: e.family, id: e.id, w: e.w, h: e.h, state: e.state, ok: e.ok } : null; },
    canvasFor, locate,
    rect(family, rec, sheetHint) { const l = locate(family, rec, sheetHint); return l ? l.r : null; },
    rows(family, mapKey) { const m = mapFor(famName(family), mapKey); return m ? m.map(k => rowFor(famName(family), k)) : null; },
    maps(family) { const f = fams[famName(family)]; return f && f.pal && f.pal.maps ? Object.keys(f.pal.maps) : []; },
    has(a, b) {
      if (b !== undefined) {
        const f = fams[famName(a)]; if (!f) return false;
        if (b === 'crownEngine' && f.crownEngine) return true;
        return !!((f.sheets && f.sheets[b]) || (f.bodies && f.bodies[b]) || (f.types && f.types[b]) || (f.hero && f.hero[b]) || (recs[famName(a)] && recs[famName(a)][b]));
      }
      const bo = fams.bosses; if (bo && ((bo.bodies && bo.bodies[a]) || (a === 'crownEngine' && bo.crownEngine))) return true;
      return !!bare[a];
    },
    get bossIds() {
      const B = root.BOSS_DEFS, bo = fams.bosses;
      const ids = B ? Object.values(B).map(d => d && d.body).filter(Boolean).concat(['fessenden', 'crownEngine']) : Object.keys((bo && bo.bodies) || {}).concat(bo && bo.crownEngine ? ['crownEngine'] : []);
      return ids.filter((x, i) => ids.indexOf(x) === i);
    },
    // pre-warm canvases for a chapter: [[sheetKey, mapKey], …]
    warm(list) { let n = 0; for (const [k, m] of list || []) if (canvasFor(k, m)) n++; return n; },
    // one record of any family with its origin at (x, y); mirror = facing right (art faces left)
    drawRec(g, family, rec, mapKey, x, y, mirror) {
      const l = locate(family, rec); if (!l) return false; const c = canvasFor(l.key, mapKey, null, l.r); if (!c) return false;
      const r = l.r; g.save(); g.imageSmoothingEnabled = false; g.translate(Math.round(x), Math.round(y)); if (mirror) g.scale(-1, 1);
      g.drawImage(c, r[0], r[1], r[2], r[3], -r[4], -r[5], r[2], r[3]); g.restore(); return true;
    },
    flush() { for (const v of lru.values()) { try { v.canvas.width = 0; } catch (err) { /* detached */ } } lru.clear(); lruBytes = 0; stats.bytes = 0; },
    compatView: () => (fams.heroes && fams.heroes.compat ? compatView(fams.heroes) : null),
  };
  root.SPRITES = SPRITES;
  if (typeof module === 'object' && module && module.exports) module.exports = SPRITES;
})(typeof window !== 'undefined' ? window : globalThis);
