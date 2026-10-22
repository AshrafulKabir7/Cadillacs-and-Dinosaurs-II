// hero-rig.js - window.HeroRig: the 1993 heroes driven by ROM clips (HEROES §3-§5, PLAN §4.3).
// Data: ROM_HEROES (sprite-data-heroes.js, published by sprites.js; read straight from SPRITE_DATA when sprites.js is
// absent, e.g. under plain Node). Pixels: SPRITES.canvasFor (sprites.js). The data side (clip, play, tick, advance,
// frame, parts, weaponAt, muzzle, flame, flameUpdate) is pure - no DOM, no canvas - so tests/rom-heroes.cjs runs it
// in Node against the golden part lists predicted by tools/re/export/lib/model.cjs.
//
// Space: native, left-facing, feet-relative arcade px (x right, y down); facing right mirrors about the feet.
// Time: clip durations are 60 Hz frames (dur 0 = 256); the rig keeps the remaining time of the current frame in
// seconds, so any dt works (1/60, .016, .033, 1/72, 1/144). A newly started clip shows its first frame for
// max(1, dur-1) frames (KI11, switch ROM_START_TRIM). Callers skip tick() during hitstop.
// Frame tuple: [rec, rec2 (-1 none), dur, hold (<0 hidden), ev (b4), act, bob (legs clips only)].
(function (root) {
  'use strict';
  const FPS = 60, EPS = 1e-9;
  const VARIANTS = ['hero', 'mirror', 'freed', 'half'];
  let fam = null;
  const view = {};                         // heroId -> {h, byId, anim, roleOf}

  function data() {
    if (fam) return fam;
    const sd = root.SPRITE_DATA, f = root.ROM_HEROES || (sd && sd.families && sd.families.heroes);
    if (!f || !f.hero) return null;
    fam = f; for (const id of Object.keys(f.hero)) index(id);
    return fam;
  }
  function index(id) {
    const h = fam.hero[id], byId = {}, anim = {}, roleOf = {};
    for (const [cid, c] of Object.entries(h.clips)) byId[cid] = { id: cid, f: c.f, loop: c.loop == null ? null : c.loop, next: c.next || null, nextK: c.nextK || 0, bob: c.bob || null, st: c.st || null };
    for (const [role, cid] of Object.entries(h.roles)) if (byId[cid] && roleOf[cid] == null) roleOf[cid] = role;
    for (const [role, cid] of Object.entries(h.roles)) {
      const c = byId[cid]; if (!c) continue;
      anim[role] = { id: cid, role, f: c.f, loop: c.next ? null : c.loop, next: c.next ? (roleOf[c.next] || c.next) : null, nextK: c.nextK, contact: (h.contact && h.contact[role]) || null, bob: c.bob, clip: c };
    }
    h.anim = anim;                                   // ROM_HEROES.hero.<id>.anim[role] (HEROES §4.2 shape; tests read it)
    view[id] = { h, byId, anim, roleOf };
  }
  const heroKey = id => { const f = data(); if (!f) return null; if (typeof id === 'number') return (f.gameOrder || [])[id] || null; return f.hero[id] ? id : null; };
  const V = id => { const k = heroKey(id); return k ? view[k] : null; };
  const durOf = d => (d === 0 ? 256 : d) / FPS;
  // a clip reference: role name, clip id 'list:index', or a clip object
  function clipRef(v, ref) {
    if (!v || ref == null) return null;
    if (typeof ref === 'object') return ref.f ? (ref.clip || ref) : null;
    if (v.anim[ref]) return v.anim[ref].clip;
    return v.byId[ref] || null;
  }

  function enter(a, out) {
    const f = a.clip.f[a.k];
    if (f[4]) out.push({ type: 'ev', code: f[4], k: a.k, role: a.role });
    if (f[5]) out.push({ type: 'act', k: a.k, role: a.role });
  }
  function next(a, out) {
    const c = a.clip, n = c.f.length;
    if (a.k + 1 < n) { a.k++; a.t += durOf(c.f[a.k][2]); enter(a, out); return; }
    if (!a.ended) { a.ended = true; out.push({ type: 'end', role: a.role, id: c.id }); }
    const v = view[a.hero];
    if (c.next && v.byId[c.next]) {                                   // ROM loopTarget: continue into another clip
      a.clip = v.byId[c.next]; a.role = v.roleOf[c.next] || c.next; a.k = Math.min(c.nextK || 0, a.clip.f.length - 1); a.ended = false; a.loops = 0;
      a.t += durOf(a.clip.f[a.k][2]); enter(a, out); return;
    }
    const loop = c.loop == null ? n - 1 : c.loop;
    if (loop >= n - 1) { a.done = true; a.k = n - 1; a.t = 0; return; }   // loop onto the last frame: the clip holds
    a.k = loop; a.loops++; a.t += durOf(c.f[a.k][2]); enter(a, out);
  }

  const HeroRig = {
    S: 1,                                  // CFG.sockets.scale (1 from G1: one world unit = one arcade px)
    ROM_START_TRIM: true,                  // KI11: a new clip's first frame lasts max(1, dur-1)
    objPage: null,                         // palette map for held weapons (the chapter's 0x8E8E page); null = ROM_FX default
    get data() { return data(); },
    get ready() { const S = root.SPRITES; return !!(data() && S && (typeof S.familyReady === 'function' ? S.familyReady('heroes') : S.ready)); },
    heroes() { const f = data(); return f ? f.order.slice() : []; },
    hero(id) { const v = V(id); return v ? v.h : null; },
    roles(id) { const v = V(id); return v ? Object.keys(v.anim) : []; },
    clip(id, role) { const v = V(id); return v && v.anim[role] ? v.anim[role] : undefined; },
    clipById(id, cid) { const v = V(id); return v ? v.byId[cid] : undefined; },
    player() { return { hero: null, role: null, clip: null, k: 0, t: 0, done: false, ended: false, loops: 0 }; },

    // start `role` (or a clip id); returns the events of the frame entered. No-op while the same role plays.
    play(a, id, role, opts) {
      const o = opts || {}, k = heroKey(id), v = view[k]; if (!v) return [];
      if (a.hero === k && a.role === role && !o.restart && a.clip) return [];
      const clip = clipRef(v, role); if (!clip) return [];
      a.hero = k; a.role = v.anim[role] ? role : (v.roleOf[clip.id] || role); a.clip = clip; a.k = Math.max(0, Math.min(o.k | 0, clip.f.length - 1));
      a.done = false; a.ended = false; a.loops = 0;
      const d = clip.f[a.k][2] === 0 ? 256 : clip.f[a.k][2];
      a.t = (o.trim !== false && HeroRig.ROM_START_TRIM ? Math.max(1, d - 1) : d) / FPS;
      const out = []; enter(a, out); return out;
    },
    // advance by dt seconds; returns [{type:'ev', code, k} | {type:'act', k} | {type:'end'}] in order
    tick(a, dt) {
      const out = []; if (!a || !a.clip || a.done) return out;
      a.t -= dt; let guard = 0;
      while (a.t <= EPS && !a.done && guard++ < 512) next(a, out);
      return out;
    },
    // distance-driven locomotion (HEROES §3.5): romFrames = moved / (romSpeed * S)
    advance(a, romFrames) { return HeroRig.tick(a, romFrames / FPS); },
    frame(a) { return a && a.clip ? a.clip.f[a.k] : null; },
    // clip length in 60 Hz frames (first frame untrimmed)
    length(id, role) { const c = clipRef(V(id), role); return c ? c.f.reduce((n, f) => n + (f[2] === 0 ? 256 : f[2]), 0) : 0; },

    // body = {full: a} | {torso: a, legs: b}; a = anim state or {clip: role|id|clipObject, k}.
    // -> [{tag, fam, sheet, rec, x, y, flip?}] back -> front (legs.rec2, legs.rec, torso.rec2, torso.rec, weapon, flame)
    parts(id, body, weaponKey, opts) {
      const v = V(id); if (!v || !body) return [];
      const o = opts || {}, h = v.h, sheet = h.sheet, out = [];
      const st = s => { if (!s) return null; const c = s.clip && s.clip.f ? (s.clip.clip || s.clip) : clipRef(v, s.clip); return c ? { c, f: c.f[Math.max(0, Math.min(s.k | 0, c.f.length - 1))] } : null; };
      const push = (tag, f, x, y) => { if (f[1] >= 0) out.push({ tag, fam: 'heroes', sheet, rec: f[1], x, y }); out.push({ tag, fam: 'heroes', sheet, rec: f[0], x, y }); };
      let hf, tdx = 0, tdy = 0;
      const legs = st(body.legs), torso = st(body.torso), full = st(body.full);
      if (legs && torso) {
        const tab = h.bob[legs.c.bob || 'walk'] || h.bob.walk, b = tab[legs.f[6]] || [0, 0];
        tdx = b[0]; tdy = b[1];
        push('legs', legs.f, 0, 0); push('torso', torso.f, tdx, -tdy); hf = torso.f;
      } else if (full || torso) { const s = full || torso; push('hero', s.f, 0, 0); hf = s.f; }
      else return out;
      const fl = o.flame && o.flame.out && weaponKey === 'torch' ? o.flame.out : null;
      const flamePart = fl ? { tag: 'flame', fam: 'fx', sheet: 'items', rec: fl.rec, x: fl.x, y: fl.y, flip: !!fl.flip } : null;
      if (flamePart && !fl.front) out.unshift(flamePart);              // depth torch+2: behind the hero (KI6)
      if (weaponKey && hf[3] >= 0) {
        const e = h.hold[weaponKey] && h.hold[weaponKey][hf[3]];
        if (e) out.push({ tag: 'weapon', fam: 'fx', sheet: 'items', rec: e[0], x: e[1] + tdx, y: e[2] - tdy });
      }
      if (flamePart && fl.front) out.push(flamePart);                  // depth torch-1: in front of everything
      return out;
    },
    // the held weapon of a body: {rec, x, y, hold, origin, lx, ly, w, h} (lx/ly/w/h when the fx rect is known)
    weaponAt(id, body, weaponKey) {
      const p = HeroRig.parts(id, body, weaponKey).find(q => q.tag === 'weapon'); if (!p) return null;
      const v = V(id), b = body.torso || body.full, s = b && (b.clip && b.clip.f ? (b.clip.clip || b.clip) : clipRef(v, b.clip));
      const hold = s ? s.f[Math.max(0, Math.min(b.k | 0, s.f.length - 1))][3] : null;
      const r = { rec: p.rec, x: p.x, y: p.y, hold, origin: [p.x, p.y] };
      const S = root.SPRITES, loc = S && typeof S.locate === 'function' ? S.locate('fx', p.rec) : null;
      if (loc) { r.w = loc.r[2]; r.h = loc.r[3]; r.lx = p.x - loc.r[4]; r.ly = p.y - loc.r[5]; }
      return r;
    },
    // muzzle of `weaponKey` on the shot frame of the hero's attack.<cls> clip: origin + [-fwd, -up] (HEROES §7.3)
    muzzle(id, weaponKey, shotFrame) {
      const v = V(id), f = data(); if (!v || !f) return null;
      const w = f.weapon[weaponKey]; if (!w || !w.muzzle) return null;
      const ci = v.h.cls[w.cls], role = ci && ci.attack, clip = role && v.anim[role]; if (!clip) return null;
      const k = shotFrame != null ? shotFrame : (w.cls === 'smg' || w.cls === 'm16' ? 1 : 0), fr = clip.f[Math.min(k, clip.f.length - 1)];
      const e = v.h.hold[weaponKey] && v.h.hold[weaponKey][fr[3]]; if (!e) return null;
      return { x: e[1] - w.muzzle[0], y: e[2] - w.muzzle[1], origin: [e[1], e[2]], hold: fr[3], k, clip: clip.id, rec: e[0] };
    },

    // ---- torch flame (KI6): its own clock, one frame behind the torch, depth alternating +2 / -1
    flame() { return { chain: 'burning', k: 0, t: 0, parity: 0, prev: null, out: null }; },
    // once per game update, after the hero's clips: x = world x, z = height above the floor, dir = facing.
    flameUpdate(fl, id, body, weaponKey, o) {
      const f = data(), v = V(id); if (!fl || !f || !v) return null;
      const TF = f.fx.torchFlame, opt = o || {}, dt = opt.dt == null ? 1 / FPS : opt.dt, running = !!opt.running;
      // clock: the running chain while the holder runs, the burning chain otherwise (both restart at frame 0)
      const want = running ? 'running' : 'burning';
      if (fl.chain !== want) { fl.chain = want; fl.k = 0; fl.t = durOf(TF[want][0][1]); }
      else { if (!(fl.t > 0)) fl.t = durOf(TF[want][fl.k][1]); fl.t -= dt; let g = 0; while (fl.t <= EPS && g++ < 64) { fl.k = (fl.k + 1) % TF[want].length; fl.t += durOf(TF[want][fl.k][1]); } }
      fl.parity ^= 1;
      const dd = TF.depthAlt[fl.parity], x = opt.x || 0, z = opt.z || 0, dir = opt.dir > 0 ? 1 : -1;
      // position: the torch as it was in the previous update (origin + offsets[b5/4], that frame's facing)
      if (fl.prev) {
        const off = TF.offsets[fl.prev.idx] || [0, 0], p = fl.prev;
        const wx = p.wx + (p.dir > 0 ? -off[0] : off[0]), wz = p.wz - off[1];
        fl.out = { rec: TF[fl.chain][fl.k][0], x: dir > 0 ? -(wx - x) : wx - x, y: -(wz - z) - dd, dd, front: dd < 0, flip: p.dir !== dir };
      } else fl.out = null;
      // remember this frame's torch for the next update
      const p = weaponKey === 'torch' ? HeroRig.parts(id, body, 'torch').find(q => q.tag === 'weapon') : null;
      if (p) {
        const b = body.torso || body.full, c = b && (b.clip && b.clip.f ? (b.clip.clip || b.clip) : clipRef(v, b.clip)), hold = c ? c.f[Math.max(0, Math.min(b.k | 0, c.f.length - 1))][3] : -1;
        const e = v.h.hold.torch && v.h.hold.torch[hold];
        fl.prev = { wx: x + (dir > 0 ? -p.x : p.x), wz: z - p.y, dir, idx: e && e[3] != null ? e[3] : 0 };
      } else fl.prev = null;
      return fl.out;
    },

    // ---- loading and drawing
    load(cb) {
      const S = root.SPRITES;
      if (!S || !data()) { if (cb) setTimeout(() => cb(false), 0); return false; }
      if (typeof S.whenReady === 'function') S.whenReady('heroes', () => cb && cb(HeroRig.ready)); else if (cb) cb(HeroRig.ready);
      return true;
    },
    // 'hero' | 'mirror' | 'freed' | 'half' (or 'mirror-jack' …: the prefix is applied to the part's own hero), 'gel', 'flash'
    mapFor(variant, heroId) {
      const v = variant || 'hero', maps = (data() && data().pal.maps) || {};
      const m = new RegExp(`^(${VARIANTS.join('|')})(?:-\\w+)?$`).exec(v);
      if (m) return `${m[1]}-${heroId}`;
      return maps[v] ? v : `hero-${heroId}`;
    },
    // one transform for every part of a fighter (HEROES §3.1): feet at (x, y - z), art faces left, dir +1 = right
    draw(g, parts, x, y, z, dir, S, variant) {
      const SP = root.SPRITES; if (!g || !parts || !parts.length || !SP || !HeroRig.ready) return false;
      const scale = S == null ? HeroRig.S : S, objPage = HeroRig.objPage || (root.ROM_FX && root.ROM_FX.objPages && root.ROM_FX.objPages[0]) || 'S1A0';
      g.save(); g.imageSmoothingEnabled = false;
      g.translate(Math.round(x), Math.round(y - (z || 0)));
      g.scale(-(dir > 0 ? 1 : -1) * scale, scale);
      let n = 0;
      for (const p of parts) {
        const loc = SP.locate(p.fam || 'heroes', p.rec, p.fam === 'heroes' ? p.sheet : null); if (!loc) continue;
        const key = p.mapKey || (p.fam === 'heroes' ? HeroRig.mapFor(variant, p.sheet) : objPage);
        const cv = SP.canvasFor(loc.key, key, loc.family, loc.r); if (!cv) continue;     // colours only this record's box on first use
        const r = loc.r;
        if (p.flip) { g.save(); g.translate(p.x, 0); g.scale(-1, 1); g.drawImage(cv, r[0], r[1], r[2], r[3], -r[4], p.y - r[5], r[2], r[3]); g.restore(); }
        else g.drawImage(cv, r[0], r[1], r[2], r[3], p.x - r[4], p.y - r[5], r[2], r[3]);
        n++;
      }
      g.restore();
      return n > 0;
    },
  };
  root.HeroRig = HeroRig;
  if (typeof module === 'object' && module && module.exports) module.exports = HeroRig;
})(typeof window !== 'undefined' ? window : globalThis);
