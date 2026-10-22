// Stage runtime for Cadillacs & Dinosaurs II (ARCHITECTURE §2.3-§2.5, §4.1-§4.3, §5.5; PLAN §4.2). Reads the
// generated window.STAGE_DATA (stage-data.js) and draws the lazily loaded PNG pages under assets/stages/.
//   window.STAGE         pure data API: area(ref), chapter(ref), use(ch), bandAt(area,x), mid(area,x), lane(area,x,f),
//                        walkable(area,x,y), resolveMove(area,x0,y0,x1,y1,{cam,lock}), pathY(area,camX), clampView
//   window.STAGE_RENDER  require(ch) -> Promise, loaded(ch), ready(ch) (starts loading the chapter if nothing did),
//                        release(ch), back(g,area,cam,t,opts), front(g,area,cam,t,opts), setState(area,id,on),
//                        resetStream(area), base (path prefix of the pages)
// Driving areas: the rowscroll rows and the looping far layer keep their own phase per area, advanced by the change of
// cam.x + road between frames, taken modulo the loop period: resetting road by any multiple of the period (ARCHITECTURE
// §2.5) moves nothing on screen.
// Units are arcade px (one world unit = one arcade pixel). An area ref is an area object of STAGE_DATA, 'ch1/a0',
// ['ch1', 0], or an index/id inside the chapter selected with STAGE.use(ch). Nothing here calls Math.random, reads
// pixels back (pages are only drawn, so file:// works) or throws on a page that is missing or still loading.
(function (root) {
  'use strict';
  var VIEW_W = 384, VIEW_H = 224, CELL = 16;
  var data = function () { return root.STAGE_DATA || null; };
  var CH = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6'];

  // ---------------------------------------------------------------- refs
  function chapterId(ref) {
    if (ref == null) return null;
    if (typeof ref === 'number') return CH[ref] || null;
    if (typeof ref === 'string' && /^ch\d$/.test(ref)) return ref;
    if (typeof ref === 'object' && ref.id && ref.areas) return ref.id;
    return null;
  }
  function chapter(ref) { var d = data(), id = chapterId(ref); return d && id && d.chapters[id] || null; }
  var current = null;
  function area(ref, ch) {
    if (ref == null) return null;
    if (typeof ref === 'object' && !Array.isArray(ref)) return ref.walk ? ref : null;
    var c = null, k = ref;
    if (Array.isArray(ref)) { c = chapter(ref[0]); k = ref[1]; }
    else if (typeof ref === 'string' && ref.indexOf('/') > 0) { var p = ref.split('/'); c = chapter(p[0]); k = p[1]; }
    else c = chapter(ch != null ? ch : current);
    if (!c) return null;
    if (typeof k === 'number') return c.areas[k] || null;
    for (var i = 0; i < c.areas.length; i++) if (c.areas[i].id === k) return c.areas[i];
    return null;
  }

  // ---------------------------------------------------------------- walk mask (1 bit per 16-px cell, row-major)
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', maskCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function decode64(s) {
    var out = [], buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) { var v = B64.indexOf(s.charAt(i)); if (v < 0) continue; buf = (buf << 6) | v; bits += 6; if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); } }
    return out;
  }
  function maskOf(a) {
    var m = maskCache && maskCache.get(a); if (m) return m;
    var bytes = decode64(a.walk.mask), n = a.walk.cols * a.walk.rows; m = new Uint8Array(n);
    for (var i = 0; i < n; i++) m[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
    if (maskCache) maskCache.set(a, m);
    return m;
  }
  function col(a, x) { var c = Math.floor(x / CELL); return c < 0 ? 0 : c >= a.walk.cols ? a.walk.cols - 1 : c; }
  function bandAt(ref, x) {
    var a = area(ref); if (!a) return null;
    var b = a.walk.band[col(a, x)];
    return b ? [b[0], b[1]] : null;
  }
  function mid(ref, x) { var b = bandAt(ref, x); return b ? (b[0] + b[1]) / 2 : null; }
  function lane(ref, x, f) { var b = bandAt(ref, x); return b ? b[0] + f * (b[1] - b[0]) : null; }
  function walkable(ref, x, y) {
    var a = area(ref); if (!a) return false;
    var c = col(a, x), b = a.walk.band[c]; if (!b || y < b[0] || y > b[1]) return false;
    var r = Math.floor((y - 1) / CELL); if (r < 0) r = 0; if (r >= a.walk.rows) r = a.walk.rows - 1;
    return maskOf(a)[r * a.walk.cols + c] === 1;
  }
  var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  // Tries x, then y, against the mask (a column whose band does not hold y blocks x, like the ROM push walls), then
  // applies the player clamp [cam.x+16, cam.x+367] x [cam.y+81, cam.y+224] and the lock [left+16, right-17].
  function resolveMove(ref, x0, y0, x1, y1, opts) {
    var a = area(ref); if (!a) return { x: x1, y: y1 };
    opts = opts || {};
    var x = x0, y = y0, b0 = bandAt(a, x0);
    if (b0 && !walkable(a, x0, y0)) { y = clamp(y0, b0[0], b0[1]); if (!walkable(a, x0, y)) y = nearestWalkable(a, x0, y); }
    if (walkable(a, x1, y)) x = x1;
    var b = bandAt(a, x) || [81, 224], ny = clamp(y1, b[0], b[1]);
    if (walkable(a, x, ny)) y = ny; else if (!walkable(a, x, y)) y = nearestWalkable(a, x, ny);
    if (opts.lock) x = clamp(x, opts.lock.left + 16, opts.lock.right - 17);
    if (opts.cam) { x = clamp(x, opts.cam.x + 16, opts.cam.x + VIEW_W - 17); y = clamp(y, (opts.cam.y || 0) + 81, (opts.cam.y || 0) + VIEW_H); }
    return { x: x, y: y };
  }
  function nearestWalkable(a, x, y) {
    var b = bandAt(a, x); if (!b) return y;
    for (var d = 0; d < VIEW_H; d++) { if (walkable(a, x, y - d)) return y - d; if (walkable(a, x, y + d)) return y + d; }
    return clamp(y, b[0], b[1]);
  }
  // camera Y path: keyframes [[camX, camY], ...] linear between them; flat areas are 0
  function pathY(ref, camX) {
    var a = area(ref); if (!a || !a.cameraY || !a.cameraY.length) return 0;
    var k = a.cameraY; if (camX <= k[0][0]) return k[0][1];
    for (var i = 1; i < k.length; i++) if (camX <= k[i][0]) { var t = (camX - k[i - 1][0]) / (k[i][0] - k[i - 1][0]); return Math.round(k[i - 1][1] + t * (k[i][1] - k[i - 1][1])); }
    return k[k.length - 1][1];
  }
  function clampView(ref, cam) { var a = area(ref); if (!a) return cam; return { x: clamp(cam.x, 0, Math.max(0, a.w - VIEW_W)), y: clamp(cam.y || 0, 0, Math.max(0, a.h - VIEW_H)) }; }

  var STAGE = {
    VIEW: { w: VIEW_W, h: VIEW_H }, CELL: CELL,
    chapter: chapter, area: area, use: function (ch) { current = chapterId(ch); return chapter(current); }, get current() { return current; },
    bandAt: bandAt, mid: mid, lane: lane, walkable: walkable, resolveMove: resolveMove, pathY: pathY, clampView: clampView,
    section: function (id) { var d = data(); return d && d.sections[id] || null; },
  };

  // ---------------------------------------------------------------- pages (lazy, per chapter)
  var pages = {}, order = [], states = {}, KEEP = 2;
  function makeImage(src) {
    var Img = root.Image; if (typeof Img !== 'function') return null;
    var img = new Img(); img.src = src; return img;
  }
  function areaPages(chId, a, ai) {
    var list = [], dir = a.dir || ('assets/stages/' + chId + '/' + a.id + '/'), artW = a.artW || a.w;
    var add = function (layer, file, x, y, w, h, span) { list.push({ layer: layer, file: file, src: dir + file, x: x, y: y, w: w, h: h, span: span, area: ai, img: null }); };
    (a.s2 || []).forEach(function (p) { add('s2', 's2-' + p[0] + '-' + p[1] + '.png', p[0] * a.page, p[1] * a.page, Math.min(a.page, artW - p[0] * a.page), Math.min(a.page, a.h - p[1] * a.page)); });
    (a.fg || []).forEach(function (p) { add('fg', 'fg-' + p[0] + '-' + p[1] + '.png', p[0] * a.page, p[1] * a.page, Math.min(a.page, artW - p[0] * a.page), Math.min(a.page, a.h - p[1] * a.page)); });
    if (a.s3 && a.s3.spans) a.s3.spans.forEach(function (sp, k) { (sp.pages || []).forEach(function (f) { var m = /s3-\d+-(\d+)-(\d+)\.png$/.exec(f), c = m ? +m[1] : 0, r = m ? +m[2] : 0; add('s3', f, c * a.page, r * a.page, Math.min(a.page, sp.w - c * a.page), Math.min(a.page, VIEW_H - r * a.page), k); }); });
    if (a.animFile) add('anim', a.animFile, 0, 0, 0, 0);
    return list;
  }
  function chapterPages(chId) {
    var c = chapter(chId); if (!c) return null;
    if (!pages[chId]) { var all = []; c.areas.forEach(function (a, ai) { if (!a.stub) all = all.concat(areaPages(chId, a, ai)); }); pages[chId] = { list: all, promise: null }; }
    return pages[chId];
  }
  var good = function (img) { return !!(img && img.complete && img.naturalWidth > 0); };
  function require_(ref) {
    var chId = chapterId(ref), P = chapterPages(chId);
    if (!P) return Promise.resolve(0);
    order = order.filter(function (x) { return x !== chId; }); order.push(chId);
    while (order.length > KEEP) release(order.shift());
    if (P.promise) return P.promise;
    // area 0 first, nearest the start first, then the rest in x order
    var list = P.list.slice().sort(function (p, q) { return p.area - q.area || p.x - q.x || (p.layer < q.layer ? -1 : 1); });
    P.promise = Promise.all(list.map(function (p) {
      return new Promise(function (done) {
        var img = makeImage(STAGE_RENDER.base + p.src); p.img = img;
        if (!img) return done(false);
        if (good(img)) return done(true);
        // p.settle lets release() resolve a load it cancels, so a caller awaiting require() never hangs
        p.settle = done;
        img.onload = function () { p.settle = null; done(true); }; img.onerror = function () { p.settle = null; done(false); };
      });
    })).then(function (r) { return r.filter(Boolean).length; });
    return P.promise;
  }
  function release(ref) {
    var chId = chapterId(ref), P = pages[chId]; if (!P) return;
    P.list.forEach(function (p) { if (p.img) { p.img.onload = p.img.onerror = null; p.img.src = ''; p.img = null; } if (p.settle) { var s = p.settle; p.settle = null; s(false); } });
    P.promise = null; order = order.filter(function (x) { return x !== chId; });
  }
  function loaded(ref) { var P = pages[chapterId(ref)]; return P ? P.list.filter(function (p) { return good(p.img); }).length : 0; }
  function ready(ref) {
    var chId = chapterId(ref == null ? 'ch1' : ref), c = chapter(chId); if (!c) return false;
    var P = pages[chId]; if (!P || !P.promise) { require_(chId); P = pages[chId]; }
    if (!P) return false;
    return P.list.every(function (p) { return p.area !== 0 || p.x >= 2 * VIEW_W || p.layer === 'anim' || good(p.img); });
  }

  // ---------------------------------------------------------------- drawing
  var stats = { drawImage: 0 };
  function pagesFor(a) { var c = null, d = data(); if (!d) return []; for (var k in d.chapters) if (d.chapters[k].areas.indexOf(a) >= 0) { c = k; break; } var P = c && pages[c]; if (!P) return []; var ai = d.chapters[c].areas.indexOf(a); return P.list.filter(function (p) { return p.area === ai; }); }
  var mod = function (v, m) { return ((v % m) + m) % m; };
  // draws the source rect [sx, sx+w) x [sy, sy+h) of a layer (in layer space) at screen (dx, dy)
  function blit(g, list, layer, span, sx, sy, w, h, dx, dy) {
    for (var i = 0; i < list.length; i++) {
      var p = list[i]; if (p.layer !== layer || (span != null && p.span !== span) || !good(p.img)) continue;
      var x0 = Math.max(sx, p.x), x1 = Math.min(sx + w, p.x + p.w), y0 = Math.max(sy, p.y), y1 = Math.min(sy + h, p.y + p.h);
      if (x1 <= x0 || y1 <= y0) continue;
      g.drawImage(p.img, x0 - p.x, y0 - p.y, x1 - x0, y1 - y0, dx + x0 - sx, dy + y0 - sy, x1 - x0, y1 - y0); stats.drawImage++;
    }
  }
  function layerX(a, cx, road) { return a.loop ? mod(cx + (road || 0), a.loop.period) : cx; }
  // per-area stream phases: rows[i] (rowscroll row i, scroll2 px) and s3[k] (looping far-layer span k, X3 px)
  var streams = {};
  function rowFactor(rs, i) { return rs.den ? (rs.base + i) / rs.den : rs.from + (rs.to - rs.from) * i / Math.max(1, rs.rows - 1); }   // row i at camX*(32+i)/64 (0x23390)
  function stream(a, D) {
    var key = a.dir || a.id, s = streams[key], rs = a.rowscroll, spans = (a.s3 && a.s3.spans) || [], i;
    if (!s) {
      s = streams[key] = { D: D, rows: [], s3: [] };
      if (rs) for (i = 0; i < rs.rows; i++) s.rows[i] = D * rowFactor(rs, i);
      for (i = 0; i < spans.length; i++) s.s3[i] = spans[i].period ? D / (1 << spans[i].shift) : 0;
      return s;
    }
    var dD = D - s.D;
    if (a.loop) dD -= a.loop.period * Math.round(dD / a.loop.period);   // a road reset by k periods is no motion
    if (dD) {
      if (rs) for (i = 0; i < rs.rows; i++) s.rows[i] += dD * rowFactor(rs, i);
      for (i = 0; i < spans.length; i++) if (spans[i].period) s.s3[i] += dD / (1 << spans[i].shift);
    }
    s.D = D;
    return s;
  }
  function resetStream(ref) { var a = area(ref); if (a) delete streams[a.dir || a.id]; }
  function drawPlayfield(g, a, list, layer, cx, cy, road) {
    var lx = layerX(a, cx, road), rs = a.rowscroll;
    if (!rs) { blit(g, list, layer, null, lx, cy, VIEW_W, VIEW_H, 0, 0); return; }
    var top = rs.y, bot = rs.y + rs.rows, st = stream(a, cx + (road || 0));
    blit(g, list, layer, null, lx, cy, VIEW_W, top - cy, 0, 0);
    for (var i = 0; i < rs.rows; i++) {
      var rx = Math.round(st.rows[i]);
      if (a.loop) rx = mod(rx, a.loop.period);
      blit(g, list, layer, null, rx, top + i, VIEW_W, 1, 0, top + i - cy);
    }
    blit(g, list, layer, null, lx, bot, VIEW_W, cy + VIEW_H - bot, 0, bot - cy);
  }
  function drawAnims(g, a, list, layer, cx, cy, t) {
    if (!a.anims || !a.anims.length || a.loop) return;
    var img = null; for (var i = 0; i < list.length; i++) if (list[i].layer === 'anim') img = list[i].img;
    if (!good(img)) return;
    var f60 = Math.floor((t || 0) * 60);
    a.anims.forEach(function (an) {
      if (an.layer !== layer || an.x >= cx + VIEW_W || an.x + an.w <= cx) return;
      var total = an.durs.reduce(function (n, d) { return n + d; }, 0) || 1, k = mod(f60, total), fi = 0;
      while (fi < an.durs.length - 1 && k >= an.durs[fi]) { k -= an.durs[fi]; fi++; }
      var fr = an.frames[fi]; g.drawImage(img, fr[0], fr[1], an.w, an.h, an.x - cx, an.y - cy, an.w, an.h); stats.drawImage++;
    });
  }
  function lightning(g, fx, t) {
    if (!fx || !fx.lightning) return;
    var L = fx.lightning, f = Math.floor((t || 0) * 60), lo = L.every[0], hi = L.every[1], at = 0, n = 0;
    while (at <= f && n < 100000) { var gap = lo + ((n * 2654435761) >>> 0) % (hi - lo + 1); if (f >= at + gap && f < at + gap + L.frames) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = L.alpha; g.fillStyle = '#fff'; g.fillRect(0, 0, VIEW_W, VIEW_H); g.restore(); return; } at += gap; n++; }
  }
  function chapterOf(a) { var d = data(); if (!d) return null; for (var k in d.chapters) if (d.chapters[k].areas.indexOf(a) >= 0) return d.chapters[k]; return null; }
  // STAGE_RENDER.back: backdrop, scroll3 spans, (lightning), scroll2 pages (+loop, +rowscroll), scroll2 anims
  function back(g, ref, cam, t, opts) {
    var a = area(ref); if (!a) return;
    opts = opts || {}; stats.drawImage = 0;
    var cx = Math.round(cam.x), cy = Math.round(cam.y || 0), road = opts.road || 0, list = pagesFor(a);
    g.fillStyle = a.bg || '#000'; g.fillRect(0, 0, VIEW_W, VIEW_H);
    var spans = (a.s3 && a.s3.spans) || [];
    var st = spans.some(function (sp) { return sp.period; }) ? stream(a, cx + road) : null;
    spans.forEach(function (sp, k) {
      if (sp.period) { blit(g, list, 's3', k, mod(Math.floor(st.s3[k]), sp.period), 0, VIEW_W, VIEW_H, 0, 0); return; }
      if (sp.x1 <= cx || sp.x0 >= cx + VIEW_W) return;
      var X3 = Math.max(0, cx - sp.c0) >> sp.shift, s0 = Math.max(0, sp.x0 - cx), s1 = Math.min(VIEW_W, sp.x1 - cx);
      blit(g, list, 's3', k, X3 + s0, 0, s1 - s0, VIEW_H, s0, 0);
    });
    var ch = chapterOf(a); lightning(g, ch && ch.fx, t);
    drawPlayfield(g, a, list, 's2', cx, cy, road);
    drawAnims(g, a, list, 's2', cx, cy, t);
  }
  // STAGE_RENDER.front: the scroll2 priority pens over the sprites, fg anims, rain
  function front(g, ref, cam, t, opts) {
    var a = area(ref); if (!a) return;
    opts = opts || {};
    var cx = Math.round(cam.x), cy = Math.round(cam.y || 0), list = pagesFor(a);
    drawPlayfield(g, a, list, 'fg', cx, cy, opts.road || 0);
    drawAnims(g, a, list, 'fg', cx, cy, t);
    var ch = chapterOf(a);
    if (ch && ch.fx && ch.fx.rain && opts.rain !== false) rain(g, t, cx);
  }
  function rain(g, t, cx) {
    var f = (t || 0) * 60; g.save(); g.strokeStyle = 'rgba(170,190,255,0.35)'; g.lineWidth = 1; g.beginPath();
    for (var i = 0; i < 48; i++) { var h = (i * 2654435761) >>> 0, x = mod((h % 997) - cx * 0.2 - f * 2, VIEW_W + 40) - 20, y = mod((h >>> 10) % 613 + f * 7, VIEW_H + 20) - 10; g.moveTo(x, y); g.lineTo(x - 3, y + 9); }
    g.stroke(); g.restore();
  }
  function setState(ref, id, on) { var a = area(ref); if (!a) return; var k = a.dir + '#' + id; if (on) states[k] = true; else delete states[k]; }

  var STAGE_RENDER = {
    base: '', stats: stats,
    require: require_, release: release, loaded: loaded, ready: ready,
    back: back, front: front, setState: setState, resetStream: resetStream, state: function (ref, id) { var a = area(ref); return !!(a && states[a.dir + '#' + id]); },
    // one row per page of the chapter: declared size (w, h; 0 for the anim atlas) and the decoded size (nw, nh)
    pages: function (ref) { var P = pages[chapterId(ref)]; return P ? P.list.map(function (p) { var ok = good(p.img); return { layer: p.layer, src: p.src, area: p.area, x: p.x, y: p.y, w: p.w, h: p.h, loaded: ok, nw: ok ? p.img.naturalWidth : 0, nh: ok ? p.img.naturalHeight : 0 }; }) : []; },
  };
  root.STAGE = STAGE;
  root.STAGE_RENDER = STAGE_RENDER;
})(typeof window !== 'undefined' ? window : this);
