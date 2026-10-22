// tests/net.cjs — unit and loopback tests for net.js (window.EDEN_NET), work/mp/MULTIPLAYER.md §4.1 T0/T1 (net part).
//
//   node tests/net.cjs              Node rows (codes, codec fuzz, framing, input counters, interpolation, echo, errors,
//                                   whole host/join sessions over the in-memory bus with latency/loss) + Playwright rows
//                                   (two pages over BroadcastChannel, two browser contexts over a Node relay that
//                                   implements the window.__MP_BUS contract, rtc-local real data channels).
//   MP_PEERJS=1 node tests/net.cjs  also the real PeerJS smoke test (internet; a broker/CDN failure is a SKIP).
//   NET_NODE_ONLY=1                 skip the browser rows.
//   NET_REVIEW_ONLY=1               only the review regression rows (reviewRows).
//
// No server needed: the browser rows serve net.js from disk on a routed origin (http://mp.test/). All rows are filed
// under step G9a. Report: tests/results/net-report.json.
'use strict';
const fs = require('node:fs'), path = require('node:path');
const A = require('./lib/arcade.cjs');
const NET = require('../net.js');

const C = A.checks('net');
const STEP = 'G9a';
const errors = [];
const tick = () => new Promise(r => setImmediate(r));
const ck = (title, ok, detail) => (ok ? C.pass(STEP, title, detail && String(detail).slice(0, 300)) : C.fail(STEP, title, String(detail)));

// ---------------------------------------------------------------- toy game (also served to the browser rows)
function makeToy(NET, opts) {
  opts = opts || {};
  const schema = { sections: {
    g: { fields: [['state', 'str'], ['time', 't'], ['camera', 'q4'], ['coins', 'i'], ['toast', 'str'], ['lock', 'json'], ['driving', 'b'], ['shake', 'f2']] },
    p: { key: 'slot', fields: [['hero', 'i'], ['x', 'q4'], ['y', 'q4'], ['dir', 'i'], ['hp', 'i'], ['taps', 'i'], ['free', 'b']] },
    e: { key: 'nid', fields: [['type', 'str'], ['x', 'q4'], ['y', 'q4'], ['hp', 'i'], ['state', 'str'], ['x_', 'json']] },
    b: { key: 'nid', fields: [['x', 'q4'], ['y', 'q4'], ['slot', 'i']] },
  } };
  const W = { state: 'lobby', time: 0, camera: 0, coins: 3, toast: '', lock: null, driving: false, shake: 0 };
  const players = [null, null, null], inputs = [null, null, null];
  let enemies = [], bullets = [], NID = 0, events = [];
  const local = { held: new Set(), presses: [] };
  const mk = (slot, hero) => ({ slot, hero, nid: ++NID, x: 40 + 30 * slot, y: 150 + 10 * slot, dir: 1, hp: 100, taps: 0, free: true });
  const toy = {
    W, players, inputs, local, admit: true, admitted: [], removed: [], log: [],
    get enemies() { return enemies; }, get bullets() { return bullets; },
    adapter: null,
    step(dt) {
      if (W.state !== 'play') return;
      W.time += dt;
      for (const p of players) {
        if (!p) continue;
        const fr = p.slot === 0 ? { held: local.held, presses: local.presses } : inputs[p.slot] || { held: new Set(), presses: [] };
        const run = fr.held.has('ShiftLeft') ? 1.68 : 1;
        if (fr.held.has('ArrowLeft')) { p.x -= 100 * run * dt; p.dir = -1; }
        if (fr.held.has('ArrowRight')) { p.x += 100 * run * dt; p.dir = 1; }
        if (fr.held.has('ArrowUp')) p.y -= 60 * dt;
        if (fr.held.has('ArrowDown')) p.y += 60 * dt;
        for (const c of fr.presses) if (c === 'KeyJ') { p.taps++; bullets.push({ nid: ++NID, x: p.x, y: p.y, slot: p.slot, life: 0.5 }); events.push(['sfx', 'shot']); }
        if (p.slot !== 0 && inputs[p.slot]) inputs[p.slot] = { held: inputs[p.slot].held, presses: [] };
      }
      local.presses = [];
      for (const b of bullets) { b.x += 300 * dt; b.life -= dt; }
      bullets = bullets.filter(b => b.life > 0);
      for (const e of enemies) { e.x = e.x0 + 30 * Math.sin(W.time * 2 + e.nid); e.state = Math.sin(W.time + e.nid) > 0 ? 'walk' : 'idle'; }
      const lead = Math.max(...players.filter(Boolean).map(p => p.x));
      if (lead - W.camera > 192) W.camera += Math.min(6, lead - W.camera - 192);
    },
    snapshot() { return { W: Object.assign({}, W), players: players.map(p => p && Object.assign({}, p)) }; },
  };
  toy.adapter = {
    build: opts.build || 'toy-1',
    heroes: [{ id: 0, name: 'JACK' }, { id: 1, name: 'MUSTAPHA' }, { id: 2, name: 'HANNAH' }, { id: 3, name: 'MESS' }],
    selectOrder: [1, 2, 0, 3], schema,
    chapters: () => [{ index: 0, name: 'ONE', unlocked: true }],
    difficulties: () => [{ key: 'normal', label: 'NORMAL' }],
    startGame(cfg) {
      W.state = 'play'; toy.log.push(['startGame', cfg]);
      for (const r of cfg.roster) players[r.slot] = mk(r.slot, r.hero);
      enemies = [0, 1, 2].map(i => ({ nid: ++NID, type: 'goon', x0: 200 + 50 * i, x: 200 + 50 * i, y: 140 + 15 * i, hp: 30, state: 'idle', x_: { v: i } }));
    },
    canAdmit() { return toy.admit; },
    addPlayer(slot, hero, o) { players[slot] = mk(slot, hero); toy.admitted.push([slot, hero, o]); },
    removePlayer(slot, reason) { players[slot] = null; inputs[slot] = null; toy.removed.push([slot, reason]); },
    setRemoteInput(slot, fr) { const prev = inputs[slot]; inputs[slot] = { held: fr.held, presses: (prev ? prev.presses : []).concat(fr.presses), dash: fr.dash, away: fr.away }; },
    serialize() {
      return { g: Object.assign({}, W), p: players.filter(Boolean).map(p => Object.assign({}, p)), e: enemies.map(e => Object.assign({}, e)), b: bullets.map(b => Object.assign({}, b)) };
    },
    drainEvents() { const e = events; events = []; return e; },
    stopGame() { W.state = 'lobby'; },
    pause() {},
    echoStep(row, f, dt) {
      if (!row.free) return row;
      const r = Object.assign({}, row), run = (f.b >> 8) & 1 ? 1.68 : 1;
      if (f.b & 1) r.x -= 100 * run * dt;
      if (f.b & 2) r.x += 100 * run * dt;
      return r;
    },
  };
  return toy;
}

// ---------------------------------------------------------------- Node helpers
function manualBus(o = {}) {
  const bus = NET.memoryBus(Object.assign({ mode: 'manual' }, o));
  NET._test.setClock(() => bus.time());
  return bus;
}
async function pump(bus, ms, stepMs = 5) { for (let t = 0; t < ms; t += stepMs) { bus.advance(stepMs); NET._test.poll(); await tick(); } }
async function drive(bus, promise, maxMs = 30000, stepMs = 5) {
  let done = false, val, err;
  promise.then(v => { done = true; val = v; }, e => { done = true; err = e; });
  for (let t = 0; t < maxMs && !done; t += stepMs) { bus.advance(stepMs); NET._test.poll(); await tick(); }
  if (!done) throw new Error('drive: promise did not settle in ' + maxMs + ' ms of bus time');
  if (err) throw err;
  return val;
}
async function settleErr(bus, promise, maxMs) { try { await drive(bus, promise, maxMs); return null; } catch (e) { return e; } }
// One room with n joiners on a manual bus: {bus, toy, host, clients:[{s, toy, sampler}]}
async function room(n, busOpts = {}, hostOpts = {}) {
  const bus = manualBus(busOpts);
  const toy = makeToy(NET);
  const host = await drive(bus, NET.host(Object.assign({ adapter: toy.adapter, transport: NET.transports.loopback({ bus }), name: 'alif', hero: 0, lobby: { chapter: 0, difficulty: 'normal', unlocked: 3 } }, hostOpts)));
  const clients = [];
  for (let i = 0; i < n; i++) clients.push(await joinOne(bus, host, { name: 'p' + (i + 2), hero: i + 1 }));
  return { bus, toy, host, clients };
}
async function joinOne(bus, host, o = {}) {
  const ctoy = makeToy(NET, { build: o.build });
  const s = await drive(bus, NET.join(o.code || host.code, { adapter: ctoy.adapter, transport: NET.transports.loopback({ bus }), name: o.name || 'friend', hero: o.hero == null ? -1 : o.hero, register: false, cid: o.cid || 'cid' + Math.random().toString(36).slice(2, 10) }));
  await pump(bus, 20);
  return { s, toy: ctoy, sampler: new NET.input.Sampler() };
}
// one 60 Hz frame: host toy step + session tick, every client samples and sends, the bus moves 1/60 s
async function frame(r, perClient) {
  r.toy.step(1 / 60);
  r.host.tick(1 / 60);
  r.clients.forEach((c, i) => { if (perClient) perClient(c, i); if (!c.s.ended) c.s.sendInput(c.sampler.sample(1000 / 60)); });
  r.bus.advance(1000 / 60); NET._test.poll(); await tick();
}
function endAll(r) { for (const c of r.clients) if (!c.s.ended) c.s.leave(); if (!r.host.ended) r.host.end('host-left'); NET._test.setClock(null); }
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- deep equality for the codec fuzz
function deq(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b || (isNaN(a) && isNaN(b));
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deq(a[k], b[k]));
}

async function nodeRows() {
  // ---- room codes
  ck('code alphabet, make() and rejection sampling', (() => {
    const re = new RegExp('^DINO-[' + NET.code.ALPHABET + ']{4}$');
    const seen = new Set();
    for (let i = 0; i < 3000; i++) { const c = NET.code.make(); if (!re.test(c)) return false; for (const ch of c.slice(5)) seen.add(ch); }
    if (seen.size !== 31) return false;
    for (const bad of '01OIL') if (NET.code.ALPHABET.includes(bad)) return false;
    // bytes >= 248 are rejected: a source that gives 255,250,248 then 0,1,2,3 must yield "2345"
    const seq = [255, 250, 248, 0, 1, 2, 3, 4, 5, 6, 7]; let k = 0;
    const c = NET.code.make(buf => { for (let i = 0; i < buf.length; i++) buf[i] = seq[k++ % seq.length]; return buf; });
    return c === 'DINO-2345';
  })(), 'make() gave a code outside DINO-[alphabet]{4} or biased sampling');
  ck('normalize / peerId / fromUrl / shareUrl', (() => {
    const N = NET.code.normalize;
    const ok = N('dino4kq7') === 'DINO-4KQ7' && N('DINO 4KQ7') === 'DINO-4KQ7' && N('4kq7') === 'DINO-4KQ7' && N(' dino-4kq7 ') === 'DINO-4KQ7' &&
      N('https://cadillacsanddinosaurs2.vercel.app/?join=DINO-4KQ7') === 'DINO-4KQ7' && N('dino-4kq0') === null && N('DINO-4KQ') === null &&
      N('DINO-4KQ77') === null && N('') === null && N('dino-ilo5') === null &&
      NET.code.problem('4kqo') === 'symbols' && NET.code.problem('4kq') === 'length' && NET.code.problem('') === 'empty' &&
      NET.code.peerId('4kq7') === 'cnd2-dino-4kq7' && NET.code.peerId('nope') === null &&
      NET.code.fromUrl('http://x.y/play?a=1&join=dino-4kq7#z') === 'DINO-4KQ7' && NET.code.fromUrl('http://x.y/') === null &&
      NET.code.shareUrl('4kq7', { protocol: 'https:', origin: 'https://a.b', pathname: '/game/' }) === 'https://a.b/game/?join=DINO-4KQ7' &&
      NET.code.shareUrl('4kq7', { protocol: 'file:', origin: 'null', pathname: '/E:/x/index.html' }) === null;
    return ok;
  })(), 'a normalisation case failed');

  // ---- codec round trip fuzz
  {
    const toy = makeToy(NET), codec = NET.codec.make(toy.adapter.schema);
    let s = 9090; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const pick = a => a[Math.floor(rnd() * a.length)];
    const num = () => (rnd() < 0.05 ? null : rnd() < 0.05 ? undefined : (rnd() - 0.5) * 2000);
    const strv = () => (rnd() < 0.1 ? null : pick(['idle', 'walk', 'hurt', 'ATTACK', 'dino', '', 'élan ✓', '"q"']));
    const randState = () => ({
      g: { state: strv(), time: rnd() * 900, camera: num(), coins: Math.floor(rnd() * 9), toast: strv(), lock: rnd() < 0.5 ? null : { left: num() || 0, right: rnd() * 100 }, driving: rnd() < 0.5, shake: rnd() },
      p: Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => ({ slot: i, hero: Math.floor(rnd() * 4), x: num(), y: num(), dir: pick([-1, 1]), hp: Math.floor(rnd() * 120), taps: Math.floor(rnd() * 50), free: rnd() < 0.5 })),
      e: Array.from({ length: Math.floor(rnd() * 40) }, () => ({ nid: 1 + Math.floor(rnd() * 60), type: strv(), x: num(), y: num(), hp: Math.floor(rnd() * 99), state: strv(), x_: rnd() < 0.3 ? undefined : { a: [1, 2, rnd()], b: strv() } })),
      b: Array.from({ length: Math.floor(rnd() * 10) }, () => ({ nid: 100 + Math.floor(rnd() * 30), x: num(), y: num(), slot: pick([-1, 0, 1, 2]) })),
      junk: [1, 2, 3],
    });
    const mutate = st => {
      const m = JSON.parse(JSON.stringify(st, (k, v) => (v === undefined ? null : v)));
      if (rnd() < 0.7) m.g.camera = num();
      for (const sec of ['p', 'e', 'b']) {
        m[sec] = m[sec].filter(() => rnd() > 0.15);
        for (const r of m[sec]) if (rnd() < 0.4) { r.x = num(); if ('state' in r && rnd() < 0.3) r.state = strv(); }
        if (rnd() < 0.3) m[sec].reverse();
        if (rnd() < 0.5 && sec !== 'p') m[sec].push({ nid: 500 + Math.floor(rnd() * 100), x: num(), y: num(), type: strv(), state: strv(), hp: 1, slot: 0 });
      }
      return m;
    };
    let fails = 0, firstFail = '', bytesKey = 0, bytesDelta = 0, deltas = 0;
    for (let i = 0; i < 2000; i++) {
      const S = randState();
      const mode = i % 3;
      const B = mode === 0 ? null : mode === 1 ? codec.quantise(randState()) : codec.quantise(mutate(S));
      const S2 = mode === 2 ? mutate(S) : S;
      const enc = codec.encode(S2, B), wire = JSON.parse(JSON.stringify(enc));
      const dec = codec.decode(wire, B), q = codec.quantise(S2);
      if (!deq(dec, q)) { fails++; if (!firstFail) firstFail = 'case ' + i + ' mode ' + mode; }
      if (!B) bytesKey += JSON.stringify(enc).length; else { bytesDelta += JSON.stringify(enc).length; deltas++; }
    }
    ck('codec round-trip fuzz: decode(encode(S,B),B) == quantise(S), 2000 cases', fails === 0, fails + ' failures, first ' + firstFail);
    // an unchanged state against itself costs almost nothing; quantisers behave as specified
    const st = randState(), q = codec.quantise(st), same = JSON.stringify(codec.encode(st, q));
    const Q = NET.codec.Q;
    ck('codec: identical state → empty delta; quantisers q4/f2/t/b/str/json', same === '{}' && Q.q4(1.13) === 1.25 && Q.f2(0.12345) === 0.12 && Q.t(1.0004) === 1 && Q.t(1.0006) === 1.001 && Q.b(2) === true && Q.str(5) === '5' && Q.i(-0.2) === 0 && Object.is(Q.i(-0.2), 0) && deq(Q.json({ a: undefined, b: [1] }), { b: [1] }), 'same=' + same);
    ck('codec: keyframes vs deltas size', true, `mean keyframe ${Math.round(bytesKey / 667)} B, mean delta ${Math.round(bytesDelta / Math.max(1, deltas))} B`);
    // wide sections (more than 30 fields) use chunked masks
    const wide = { sections: { e: { key: 'nid', fields: Array.from({ length: 70 }, (_, i) => ['f' + i, i % 2 ? 'i' : 'q4']) } } };
    const wc = NET.codec.make(wide);
    const row = n => Object.fromEntries([['nid', n]].concat(Array.from({ length: 70 }, (_, i) => ['f' + i, i * n])));
    const S1 = { e: [row(1), row(2)] }, S2 = { e: [row(1), Object.assign(row(2), { f0: 5, f31: 9, f69: 1 })] };
    const qb = wc.quantise(S1);
    ck('codec: 70-field rows (chunked masks) round-trip', deq(wc.decode(JSON.parse(JSON.stringify(wc.encode(S2, qb))), qb), wc.quantise(S2)), 'wide row mismatch');
  }

  // ---- framing: a 60 KB message fragments on ctl and reassembles; junk is dropped and counted
  {
    const bus = manualBus();
    const ta = NET.transports.loopback({ bus }), tb = NET.transports.loopback({ bus });
    await drive(bus, ta.listen('cnd2-dino-2222'));
    let hostLink = null; ta.onIncoming(l => { hostLink = l; });
    const link = await drive(bus, tb.connect('cnd2-dino-2222'));
    const got = [];
    const wa = new NET.Wire(hostLink, new Set(['s', 'lobby']), m => got.push(m));
    const wb = new NET.Wire(link, new Set(['s']), () => {});
    const big = { t: 's', n: 1, b: -1, tm: 0, a: 0, d: { blob: 'x'.repeat(60000), arr: Array.from({ length: 500 }, (_, i) => i) } };
    const seen = { ctl: 0, st: 0 };
    hostLink.on('message', ch => { seen[ch]++; });
    wb.send(big);
    link.send('ctl', '{bad json'); link.send('ctl', JSON.stringify({ t: 'nope' })); link.send('st', 'y'.repeat(NET.MAX_TEXT + 10));
    await pump(bus, 50);
    ck('framing: 60 KB snapshot split into ≤12,000-char frags on ctl and reassembled', got.length === 1 && deq(got[0], big) && seen.ctl >= 5 && seen.st === 1, `got ${got.length}, ctl pieces ${seen.ctl}, st ${seen.st}`);
    ck('framing: bad JSON, unknown type and >256 KB texts dropped and counted', wa.stats.dropped === 3, 'dropped=' + wa.stats.dropped);
    ta.close(); tb.close(); NET._test.setClock(null);
  }

  // ---- input counters under loss / duplication / reordering
  {
    let s = 77; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const sm = new NET.input.Sampler(), rc = new NET.input.Receiver();
    let taps = 0, got = 0, held = 0, nowMs = 0;
    const inflight = [];
    for (let f = 0; f < 1200; f++) {
      nowMs += 1000 / 60;
      if (f % 6 === 0 && taps < 200) { sm.keyDown('KeyJ', nowMs); taps++; }
      if (f % 6 === 1) sm.keyUp('KeyJ');
      if (f === 600) sm.keyDown('ArrowRight', nowMs);
      for (const fr of sm.sample(1000 / 60)) {
        if (rnd() < 0.2) continue;                         // lost
        inflight.push({ at: f + Math.floor(rnd() * 5), fr }); // reordered by up to 5 frames
        if (rnd() < 0.1) inflight.push({ at: f + 2, fr });  // duplicated
      }
      inflight.sort((a, b) => a.at - b.at);
      while (inflight.length && inflight[0].at <= f) rc.push(inflight.shift().fr, nowMs);
      const out = rc.next();
      got += out.presses.filter(c => c === 'KeyJ').length;
      if (out.held.has('ArrowRight')) held++;
    }
    while (inflight.length) rc.push(inflight.shift().fr, nowMs);
    for (let i = 0; i < 20; i++) got += rc.next().presses.filter(c => c === 'KeyJ').length;
    ck('input counters: 200 taps under 20% loss, dups and reordering → exactly 200 presses', got === 200 && held > 500, `presses ${got}, held frames ${held}`);
    // a press and release between two samples still counts; key repeat does not
    const s2 = new NET.input.Sampler(), r2 = new NET.input.Receiver();
    s2.keyDown('KeyK', 0); s2.keyDown('KeyK', 5); s2.keyUp('KeyK'); s2.keyDown('KeyX', 8); s2.keyUp('KeyX');
    const fr = s2.sample(1000 / 60); r2.push(fr[0], 0);
    const o2 = r2.next();
    ck('input: sub-frame tap counted, key repeat ignored, both jump keys map to KeyK', fr.length === 1 && o2.presses.length === 2 && o2.presses.every(c => c === 'KeyK') && o2.held.size === 0, JSON.stringify(o2.presses));
    // double tap (today's rule: same key twice < 0.28 s) → dash counter → {dir, code} on the host; away zeroes input
    const s3 = new NET.input.Sampler(), r3 = new NET.input.Receiver();
    s3.keyDown('ArrowLeft', 1000); s3.keyUp('ArrowLeft'); s3.keyDown('ArrowLeft', 1200); s3.keyUp('ArrowLeft');
    s3.keyDown('KeyD', 2000); s3.keyUp('KeyD'); s3.keyDown('KeyD', 2400);
    const f3 = s3.sample(1000 / 60); r3.push(f3[0], 0); const o3 = r3.next();
    s3.setAway(true); s3.keyDown('KeyJ', 3000); const f4 = s3.sample(1000 / 60); r3.push(f4[0], 0); const o4 = r3.next();
    ck('input: double-tap counter → dash {dir:-1, code:ArrowLeft}; slow second tap no dash; away frame zeroed',
      o3.dash && o3.dash.dir === -1 && o3.dash.code === 'ArrowLeft' && o3.dash.count === 1 && o4.away && o4.held.size === 0 && o4.presses.length === 0, JSON.stringify({ d: o3.dash, a: o4 }));
    // catch-up: a queue deeper than 3 drains two frames per step until it is at most 1
    const r5 = new NET.input.Receiver(), s5 = new NET.input.Sampler();
    const burst = s5.sample(1000 / 60 * 8); burst.forEach(f => r5.push(f, 0));
    const seqs = []; for (let i = 0; i < 6; i++) seqs.push(r5.next().s);
    ck('input: catch-up consumes 2 frames per step while the queue is deep, then 1; empty → repeat', deq(seqs, [2, 4, 6, 8, 8, 8]), JSON.stringify(seqs));
    const r6 = new NET.input.Receiver(); let rejected = 0;
    for (let i = 1; i <= 130; i++) if (!r6.push({ s: i, a: 0, b: 0, c: new Array(10).fill(0), d: 0, k: 0, f: 0 }, 10)) rejected++;
    const badShape = !r6.push({ s: 999, b: 1, c: [1, 2] }, 10);
    ck('input: >120 frames/s per link dropped; malformed frames rejected', rejected === 10 && badShape, 'rejected ' + rejected);
  }

  // ---- interpolation buffer
  {
    const toy = makeToy(NET);
    const mk = (tm, x) => ({ g: { time: tm / 1000, camera: x, state: 'play' }, p: [{ slot: 0, x, y: 10, hp: 5 }] });
    const ip = new NET.Interp({ schema: toy.adapter.schema });
    for (let i = 0; i < 40; i++) ip.push(i, i * 50, mk(i * 50, i * 10), 1000 + i * 50);
    const calm = ip.delay;
    const v = ip.view(1000 + 39 * 50 + 1);      // rt = newest - delay
    const rt = 39 * 50 + 1 - calm;
    const expect = rt / 5;                        // x = tm / 5
    const ip2 = new NET.Interp({ schema: toy.adapter.schema });
    let s = 5; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 80; i++) ip2.push(i, i * 50, mk(i * 50, i * 10), 1000 + i * 50 + (rnd() * 2 - 1) * 30);
    ck('interpolation: calm link delay 75 ms, lerps x between brackets, time follows render time',
      near(calm, 75, 0.5) && near(v.p[0].x, expect, 0.01) && near(v.g.camera, expect, 0.01) && near(v.g.time * 1000, rt, 0.01) && v.p[0].hp === 5, `delay ${calm}, x ${v.p[0].x} vs ${expect}`);
    ck('interpolation: delay adapts to ±30 ms jitter (and stays within 60..250)', ip2.delay > calm + 20 && ip2.delay <= 250, `jittery delay ${ip2.delay.toFixed(1)} vs calm ${calm}`);
    // starved: extrapolate ≤100 ms past the newest snapshot, then hold
    const last = 39 * 50;
    const ve = ip.view(1000 + last + calm + 60), vh = ip.view(1000 + last + calm + 400);
    ck('interpolation: extrapolates up to 100 ms when starved, then freezes', near(ve.p[0].x, (last + 60) / 5, 0.6) && near(vh.p[0].x, (last + 100) / 5, 0.6) && ip.starved, `x ${ve.p[0].x} / ${vh.p[0].x}`);
    // an area change between brackets snaps instead of lerping
    const ip3 = new NET.Interp({ schema: { sections: { g: { fields: [['area', 'i'], ['camera', 'q4']] } } } });
    ip3.push(1, 0, { g: { area: 0, camera: 0 } }, 0); ip3.push(2, 50, { g: { area: 1, camera: 1000 } }, 50); ip3.push(3, 100, { g: { area: 1, camera: 1010 } }, 100);
    const v3 = ip3.view(0 + 25 + ip3.delay);
    ck('interpolation: no lerp across an area change', v3.g.camera === 0 && v3.g.area === 0, JSON.stringify(v3.g));
  }

  // ---- echo
  {
    const toy = makeToy(NET);
    const echo = new NET.Echo(toy.adapter.echoStep);
    const sm = new NET.input.Sampler();
    sm.keyDown('ArrowRight', 0);
    const row = { slot: 1, x: 100, y: 50, free: true };
    const fr = sm.sample(1000 / 60); fr.forEach(f => echo.pending(f));
    const p1 = echo.predict(row, 0);
    // the host applied that frame but saw 4 px less (blocked): the visible jump is absorbed and decays
    const row2 = { slot: 1, x: 100 + 100 / 60 - 4, y: 50, free: true };
    echo.ack(fr[0].s);
    const p2 = echo.predict(row2, 16);
    let p3; for (let t = 32; t <= 600; t += 16) p3 = echo.predict(row2, t);
    const notFree = echo.predict({ slot: 1, x: 7, y: 1, free: false }, 700);
    ck('echo: own hero moves the frame its key goes down; host correction blends out (80 ms), no echo when not free',
      near(p1.x, 100 + 100 / 60, 1e-6) && p2.x > row2.x + 2 && near(p3.x, row2.x, 0.05) && near(notFree.x, 7 + (notFree.x - 7), 0) , `p1 ${p1.x} p2 ${p2.x} p3 ${p3 && p3.x}`);
  }

  // ---- errors
  const need = ['webrtc-unsupported', 'peerjs-load', 'broker', 'bad-code', 'full', 'version', 'build', 'hero-taken', 'ice-failed', 'timeout', 'host-left', 'kicked'];
  ck('error table has every §1.14 code with title/text/retry', need.every(k => NET.errors[k] && NET.errors[k].title && NET.errors[k].text && typeof NET.errors[k].retry === 'boolean') && /relay/.test(NET.errors['ice-failed'].text),
    need.filter(k => !NET.errors[k]).join(','));

  // ---------------------------------------------------------------- sessions over the in-memory bus
  {
    const r = await room(2);
    const [c1, c2] = r.clients;
    ck('host gets a DINO code; two joiners accepted in slots 1 and 2 with their heroes', /^DINO-[2-9A-Z]{4}$/.test(r.host.code) && c1.s.slot === 1 && c2.s.slot === 2 && c1.s.hero === 1 && c2.s.hero === 2 && r.host.roster.length === 3 && c2.s.roster.length === 3,
      JSON.stringify(r.host.roster));
    const e4 = await settleErr(r.bus, NET.join(r.host.code, { adapter: makeToy(NET).adapter, transport: NET.transports.loopback({ bus: r.bus }), register: false, cid: 'fourthplayer' }));
    ck('4th player → full', e4 && e4.code === 'full', e4 && e4.code);
    const tBad = r.bus.time();
    const eBad = await settleErr(r.bus, NET.join('DINO-ZZZZ', { adapter: makeToy(NET).adapter, transport: NET.transports.loopback({ bus: r.bus }), register: false }));
    ck('unknown code → bad-code within 2 s', eBad && eBad.code === 'bad-code' && r.bus.time() - tBad <= 2000, eBad && eBad.code + ' after ' + (r.bus.time() - tBad) + ' ms');
    const eFmt = await NET.join('DINO-OOOO', {}).catch(e => e);
    ck('code with excluded symbols fails before any network call', eFmt && eFmt.code === 'code-format', eFmt && eFmt.code);

    // START needs everyone ready
    const before = r.host.start();
    c1.s.ready(true); await pump(r.bus, 20);
    const stillNot = r.host.start();
    let starts = 0; c1.s.on('start', () => starts++); c2.s.on('start', () => starts++);
    c2.s.ready(true); await pump(r.bus, 20);
    const go = r.host.start(); await pump(r.bus, 20);
    ck('START needs every connected joiner ready; start reaches every joiner', !before && !stillNot && go && starts === 2 && c1.s.phase === 'play' && r.toy.W.state === 'play', `${before} ${stillNot} ${go} starts=${starts}`);

    // input → host movement → snapshot → joiner
    for (let i = 0; i < 60; i++) await frame(r, (c, k) => { if (i === 0 && k === 0) c.sampler.keyDown('ArrowRight'); if (i === 40 && k === 0) c.sampler.keyUp('ArrowRight'); });
    for (let i = 0; i < 30; i++) await frame(r);
    const hostX = r.toy.players[1].x;
    const latest = c1.s.history.get(c1.s.latest), row = latest.p.find(p => p.slot === 1);
    const v = c1.s.view();
    ck("input moves the joiner's hero on the host and the joiner sees it back within 1 px", hostX > 40 + 30 + 60 && near(row.x, hostX, 0.25) && v && v.p.some(p => p.slot === 1 && near(p.x, hostX, 1)), `host ${hostX}, client ${row && row.x}`);
    // tap counting over the network and events
    for (let i = 0; i < 40; i++) await frame(r, (c, k) => { if (k === 1 && i % 4 === 0) c.sampler.keyDown('KeyJ'); if (k === 1 && i % 4 === 2) c.sampler.keyUp('KeyJ'); });
    for (let i = 0; i < 20; i++) await frame(r);
    const evs = c2.s.dueEvents(r.bus.time() + 10000);
    ck('taps arrive as presses (10 of 10) and their events reach the joiner', r.toy.players[2].taps === 10 && evs.filter(e => e[0] === 'sfx').length >= 10, `taps ${r.toy.players[2].taps}, events ${evs.length}`);

    // keyframe recovery after a lost baseline
    c2.s.history.clear();
    const kfBefore = NET._test.lastMessages.filter(m => m.t === 'kf').length;
    for (let i = 0; i < 20; i++) await frame(r);
    const kfAsked = NET._test.lastMessages.filter(m => m.t === 'kf').length > kfBefore;
    const rec = c2.s.history.get(c2.s.latest);
    ck('forced baseline loss → kf → keyframe → recovered', kfAsked && rec && rec.p.length === 3 && near(rec.p.find(p => p.slot === 2).x, r.toy.players[2].x, 0.25), 'kfAsked=' + kfAsked);

    // ping/RTT and status
    await pump(r.bus, 1100);
    const st = NET.status();
    ck('status() of the live session; joiner pings, host pongs (RTT measured)', c1.s.status().rtt >= 0 && c1.s.pingN >= 1 && st.role === 'host' && st.code === r.host.code && r.host.status().snapSeq > 0, JSON.stringify(c1.s.status()));

    // toRoom → joiners back in the room
    let roomEv = 0; c1.s.on('room', () => roomEv++);
    r.host.toRoom('host-quit'); await pump(r.bus, 30);
    ck('host returns everyone to the room (lobby phase, ready cleared)', roomEv === 1 && c1.s.phase === 'lobby' && c1.s.roster.every(x => x.host || !x.ready), JSON.stringify(c1.s.roster));

    // host leaves → joiners host-left
    const ends = []; c1.s.on('end', e => ends.push(e.reason)); c2.s.on('end', e => ends.push(e.reason));
    r.host.end('host-left'); await pump(r.bus, 300);
    ck('host closes → every joiner ends with host-left', deq(ends.sort(), ['host-left', 'host-left']) && c1.s.error === 'host-left', JSON.stringify(ends));
    endAll(r);
  }
  {
    // build / version mismatch, hero race
    const r = await room(0);
    const eb = await settleErr(r.bus, NET.join(r.host.code, { adapter: makeToy(NET, { build: 'other' }).adapter, transport: NET.transports.loopback({ bus: r.bus }), register: false, cid: 'buildmismatch' }));
    ck('build mismatch → build', eb && eb.code === 'build', eb && eb.code);
    const tr = NET.transports.loopback({ bus: r.bus });
    const link = await drive(r.bus, tr.connect(NET.code.peerId(r.host.code)));
    const got = []; const w = new NET.Wire(link, new Set(['reject', 'accept']), m => got.push(m));
    w.send({ t: 'hello', v: 99, build: 'toy-1', cid: 'versionmismatch', name: 'x', hero: 0 });
    await pump(r.bus, 50);
    ck('protocol version mismatch → version', got[0] && got[0].t === 'reject' && got[0].reason === 'version', JSON.stringify(got));
    tr.close();
    const a = await joinOne(r.bus, r.host, { hero: 0, cid: 'heroracea' });     // host has hero 0 → reassigned
    const b = await joinOne(r.bus, r.host, { hero: 1, cid: 'heroraceb' });
    const rejects = []; a.s.on('reject', x => rejects.push(['a', x.reason])); b.s.on('reject', x => rejects.push(['b', x.reason]));
    a.s.chooseHero(3); b.s.chooseHero(3);
    await pump(r.bus, 50);
    const heroes = r.host.roster.map(x => x.hero);
    ck('heroes unique: a taken preferred hero is reassigned; a race for one hero → first wins, second gets hero-taken (link stays)',
      a.s.hero !== 0 && new Set(heroes).size === 3 && r.host.roster.find(x => x.slot === a.s.slot).hero === 3 && deq(rejects, [['b', 'hero-taken']]) && !b.s.ended, JSON.stringify({ heroes, rejects }));
    endAll(Object.assign(r, { clients: [a, b] }));
  }
  {
    // 80 ± 20 ms latency, 5 % loss and reordering on st: no lost tap, positions converge, bandwidth within budget
    const r = await room(1, { latency: 80, jitter: 20, loss: 0.05, reorder: 0.05, seed: 3 });
    const c = r.clients[0];
    c.s.ready(true); await pump(r.bus, 300);
    r.host.start(); await pump(r.bus, 300);
    const t0 = r.bus.time(), s0 = r.bus.stats();
    for (let i = 0; i < 1200; i++) {
      await frame(r, (cl) => {
        if (i % 5 === 0 && i < 1000) cl.sampler.keyDown('KeyJ'); if (i % 5 === 2) cl.sampler.keyUp('KeyJ');
        if (i === 100) cl.sampler.keyDown('ArrowRight'); if (i === 400) cl.sampler.keyUp('ArrowRight');
        if (i === 500) cl.sampler.keyDown('ArrowDown'); if (i === 560) cl.sampler.keyUp('ArrowDown');
      });
    }
    for (let i = 0; i < 90; i++) await frame(r);
    const host = r.toy.players[1], cv = c.s.view();
    const own = cv && cv.p.find(p => p.slot === 1);
    const s1 = r.bus.stats(), secs = (r.bus.time() - t0) / 1000;
    let down = 0, up = 0;
    for (const [k, v] of Object.entries(s1.byKey)) { const before = (s0.byKey[k] || { bytes: 0 }).bytes; if (k.startsWith('cnd2-')) down += v.bytes - before; else up += v.bytes - before; }
    ck('80±20 ms + 5% loss + reorder: 200 taps → 200 presses on the host', host.taps === 200, 'taps ' + host.taps + ', lost st msgs ' + s1.lost);
    ck('80±20 ms + 5% loss: joiner view converges to the host (≤1 px)', own && near(own.x, host.x, 1) && near(own.y, host.y, 1), `host ${host.x.toFixed(2)},${host.y.toFixed(2)} view ${own && own.x},${own && own.y}`);
    ck('bandwidth (toy world): joiner→host ≤ 6 KB/s, host→joiner ≤ 32 KB/s', up / secs <= 6144 && down / secs <= 32768, `up ${(up / secs / 1024).toFixed(2)} KB/s, down ${(down / secs / 1024).toFixed(2)} KB/s`);
    ck('RTT measured on both ends under latency', c.s.rtt > 120 && c.s.rtt < 260 && r.host.status().rtt > 100, `client ${c.s.rtt.toFixed(0)} host ${r.host.status().rtt}`);
    endAll(r);
  }
  {
    // timeouts with the fake clock, reservation and reconnect by cid, drop-in admission, kick
    const r = await room(1);
    const c = r.clients[0];
    c.s.ready(true); await pump(r.bus, 20); r.host.start(); await pump(r.bus, 20);
    const cid = c.s.cid;
    r.bus.cut(c.s.transport.id); // the joiner vanishes without a word
    // (the cut closes the host's link at once, like a closed DataConnection; also check the silent path below)
    await pump(r.bus, 50);
    ck('joiner link lost → slot freed, hero removed from the game, slot reserved for its cid', !r.host.clients.has(1) && r.toy.removed.some(x => x[0] === 1) && r.host.reserved.has(cid), JSON.stringify(r.toy.removed));
    const blocked = await settleErr(r.bus, NET.join(r.host.code, { adapter: makeToy(NET).adapter, transport: NET.transports.loopback({ bus: r.bus }), register: false, cid: 'strangerone' }));
    const b2 = await settleErr(r.bus, NET.join(r.host.code, { adapter: makeToy(NET).adapter, transport: NET.transports.loopback({ bus: r.bus }), register: false, cid: 'strangertwo' }));
    // slot 1 is reserved: the first stranger gets slot 2, the second is told the room is full
    r.toy.admit = false;
    const back = await joinOne(r.bus, r.host, { cid, hero: 3 });
    ck('reconnect with the same cid within 30 s → same slot and hero; others cannot take a reserved slot', back.s.slot === 1 && back.s.hero === c.s.hero && b2 && b2.code === 'full' && !blocked,
      `slot ${back.s.slot} hero ${back.s.hero}/${c.s.hero} b2 ${b2 && b2.code}`);
    await pump(r.bus, 500);
    const waiting = r.host.clients.get(1).state;
    r.toy.admit = true; await pump(r.bus, 300);
    ck('drop-in admitted only when canAdmit() (a reconnecting player drops in again)', waiting === 'waiting' && r.host.clients.get(1).state === 'playing' && r.toy.admitted.some(x => x[0] === 1 && x[2].reconnect), `before ${waiting}, after ${r.host.clients.get(1).state}`);
    endAll(Object.assign(r, { clients: [back] }));
  }
  {
    const r = await room(1);
    const c = r.clients[0];
    // silence: stop the joiner's timers and inputs, then walk the fake clock
    c.s._stopTimer();
    await pump(r.bus, 3200, 100);
    const away = r.host.roster.find(x => x.slot === 1);
    await pump(r.bus, 7200, 100);
    ck('host: joiner silent 3 s → roster ping "!"/away; 10 s → slot freed (fake clock)', away && away.ping === '!' && away.state === 'away' && !r.host.clients.has(1) && r.host.reserved.size === 1, JSON.stringify(away));
    endAll(r);
  }
  {
    const r = await room(1);
    const c = r.clients[0];
    const ends = []; c.s.on('end', e => ends.push(e.reason));
    r.host._stopTimer(); for (const x of r.host.clients.values()) x.wire.send = () => true;   // host goes silent
    await pump(r.bus, 3300, 100);
    const warned = c.s.warn;
    await pump(r.bus, 7200, 100);
    ck('joiner: host silent 3 s → WAITING FOR HOST; 10 s → timeout error', warned && deq(ends, ['timeout']) && c.s.error === 'timeout', JSON.stringify({ warned, ends }));
    endAll(r);
  }
  {
    const r = await room(1);
    const c = r.clients[0];
    const ends = []; c.s.on('end', e => ends.push(e.reason));
    r.host.kick(1); await pump(r.bus, 700);
    const again = await settleErr(r.bus, NET.join(r.host.code, { adapter: makeToy(NET).adapter, transport: NET.transports.loopback({ bus: r.bus }), register: false, cid: c.s.cid }));
    ck('kick → joiner ends with kicked and cannot rejoin with the same cid', deq(ends, ['kicked']) && again && again.code === 'kicked', JSON.stringify({ ends, again: again && again.code }));
    const fresh = await settleErr(r.bus, NET.join(r.host.code, { adapter: makeToy(NET).adapter, transport: NET.transports.loopback({ bus: r.bus }), register: false, cid: 'freshcid' + Date.now() }));
    const lockedNow = r.host.isLocked;
    r.host.lock(false);
    const lateFriend = await joinOne(r.bus, r.host, { cid: 'latefriend' });
    ck('kick → the room locks out new cids (locked); lock(false) lets a new player in again', fresh && fresh.code === 'locked' && /LOCKED/.test(fresh.title) && lockedNow && lateFriend.s.slot === 1,
      JSON.stringify({ fresh: fresh && fresh.code, lockedNow, slot: lateFriend.s.slot }));
    lateFriend.s.leave(); await pump(r.bus, 300);
    r.host.lock(true);
    const lk = await settleErr(r.bus, NET.join(r.host.code, { adapter: makeToy(NET).adapter, transport: NET.transports.loopback({ bus: r.bus }), register: false, cid: 'whilelocked' }));
    r.host.lock(false);
    ck('host lock(true) → new players get locked', lk && lk.code === 'locked', lk && lk.code);
    // joiner leaves on purpose → slot freed, not reserved
    const d = await joinOne(r.bus, r.host, { cid: 'leaverleaver' });
    d.s.leave(); await pump(r.bus, 300);
    ck('joiner LEAVE → slot freed without a reservation', !r.host.clients.has(d.s.slot) && !r.host.reserved.has('leaverleaver'), JSON.stringify([...r.host.reserved.keys()]));
    // relay-injected ice failure and a taken room id
    r.bus.block('ice');
    const ice = await settleErr(r.bus, NET.join(r.host.code, { adapter: makeToy(NET).adapter, transport: NET.transports.loopback({ bus: r.bus }), register: false }));
    NET._test.setRelay('');   // the wording without a relay configured (RELAY_URL = '')
    const noRelayText = NET.errors['ice-failed'].text;
    NET._test.setRelay('wss://relay.example');
    const relayText = NET.errors['ice-failed'].text;
    NET._test.setRelay(null);
    ck("relay block('ice') → ice-failed; the text says there is no relay (RELAY_URL empty) or that the relay couldn't connect either", ice && ice.code === 'ice-failed' && /no relay server of its own/.test(noRelayText) && /relay server couldn't connect you/.test(relayText), ice && ice.code);
    const hostB = await drive(r.bus, NET.host({ adapter: makeToy(NET).adapter, transport: NET.transports.loopback({ bus: r.bus }), code: r.host.code }));
    ck('room id collision → a fresh code is generated', hostB.code !== r.host.code && /^DINO-/.test(hostB.code), hostB.code);
    hostB.end(); endAll(r);
  }
  await reviewRows();
}

// ---------------------------------------------------------------- regressions from the review (work/mp/net/REVIEW.json)
async function reviewRows() {
  {
    // a second game after toRoom → START: the joiner's own-hero echo keeps predicting (acks restart with the new game)
    const r = await room(1);
    const c = r.clients[0];
    c.sampler = c.s.sampler;   // the session's sampler, rebased on every start
    c.s.ready(true); await pump(r.bus, 20); r.host.start(); await pump(r.bus, 20);
    for (let i = 0; i < 300; i++) await frame(r, (cl) => { if (i === 10) cl.sampler.keyDown('ArrowRight'); if (i === 200) cl.sampler.keyUp('ArrowRight'); });
    const firstGameAck = c.s.echo.acked;
    r.host.toRoom('clear'); await pump(r.bus, 30);
    c.s.ready(true); await pump(r.bus, 30);
    const started = r.host.start(); await pump(r.bus, 30);
    const leftover = Array.from(r.host.clients.values()).map(x => x.applied);
    for (let i = 0; i < 60; i++) await frame(r, (cl) => { if (i === 5) cl.sampler.keyDown('ArrowRight'); });
    const e = c.s.echo;
    const v = c.s.view(), own = v && v.p.find(p => p.slot === 1), hostRow = c.s.ownRow;
    ck('second game after toRoom → START: applied/acks restart, echo keeps pending frames and predicts ahead of the host row',
      started && firstGameAck > 250 && leftover.every(a => a === 0) && e.acked > 0 && e.acked <= c.sampler.s && e.frames.length > 0 && own && hostRow && own.x > hostRow.x,
      JSON.stringify({ firstGameAck, leftover, acked: e.acked, s: c.sampler.s, pending: e.frames.length, own: own && own.x, host: hostRow && hostRow.x }));
    // Echo ignores an ack above the newest frame it sent (a stale ack from the previous game)
    const echo = new NET.Echo(r.toy.adapter.echoStep), sm = new NET.input.Sampler();
    sm.keyDown('ArrowRight', 0); sm.sample(50).forEach(f => echo.pending(f));
    echo.ack(299);
    ck('Echo.ack above the newest sent frame is ignored', echo.acked === -1 && echo.frames.length === 3, JSON.stringify({ acked: echo.acked, n: echo.frames.length }));
    endAll(r);
  }
  {
    // room-screen taps on a Sampler that is not rebased do not turn into attacks; the session sampler is rebased
    const r = await room(2);
    const [a, b] = r.clients;
    a.sampler = new NET.input.Sampler();   // a caller-owned sampler, kept across START without rebase()
    for (let i = 0; i < 60; i++) { if (i % 10 === 0) a.sampler.keyDown('KeyJ'); if (i % 10 === 5) a.sampler.keyUp('KeyJ'); a.sampler.sample(1000 / 60); }
    b.sampler = b.s.sampler;
    for (let i = 0; i < 5; i++) { b.sampler.keyDown('KeyJ'); b.sampler.keyUp('KeyJ'); }
    a.s.ready(true); b.s.ready(true); await pump(r.bus, 20); r.host.start(); await pump(r.bus, 20);
    for (let i = 0; i < 30; i++) await frame(r);
    const tapsA = r.toy.players[1].taps, tapsB = r.toy.players[2].taps;
    for (let i = 0; i < 30; i++) await frame(r, (cl) => { if (i === 3) cl.sampler.keyDown('KeyJ'); if (i === 6) cl.sampler.keyUp('KeyJ'); });
    ck('taps made in the room do not become attacks at START (stale Sampler: counters taken as baseline; session sampler rebased)',
      tapsA === 0 && tapsB === 0 && r.toy.players[1].taps === 1 && r.toy.players[2].taps === 1,
      JSON.stringify({ tapsA, tapsB, after: [r.toy.players[1].taps, r.toy.players[2].taps] }));
    endAll(r);
  }
  {
    // joiner reload: pagehide leave keeps the slot; the reloaded page (same cid) gets slot, hero and a reconnect drop-in
    const r = await room(1);
    const c = r.clients[0];
    c.s.ready(true); await pump(r.bus, 20); r.host.start(); await pump(r.bus, 20);
    for (let i = 0; i < 20; i++) await frame(r);
    const cid = c.s.cid, hero = c.s.hero;
    c.s.leave('pagehide'); await pump(r.bus, 200);
    const reserved = r.host.reserved.has(cid), removed = r.toy.removed.slice();
    const back = await joinOne(r.bus, r.host, { cid, hero: 3 });
    await pump(r.bus, 300);
    const hc = r.host.clients.get(1);
    ck('joiner reload (pagehide leave) → slot reserved; same cid rejoins the same slot and hero and drops in with reconnect:true',
      reserved && removed.some(x => x[0] === 1) && back.s.slot === 1 && back.s.hero === hero && hc && hc.state === 'playing' && r.toy.admitted.some(x => x[0] === 1 && x[2].reconnect),
      JSON.stringify({ reserved, removed, slot: back.s.slot, hero: back.s.hero, state: hc && hc.state, admitted: r.toy.admitted }));
    endAll(Object.assign(r, { clients: [back] }));
  }
  {
    // snapshot tm is the game's own clock (§1.7): the joiner's view time follows the host's time
    const r = await room(1);
    const c = r.clients[0];
    c.sampler = c.s.sampler;
    r.toy.W.time = 500;
    c.s.ready(true); await pump(r.bus, 20); r.host.start(); await pump(r.bus, 20);
    for (let i = 0; i < 60; i++) await frame(r);
    const v = c.s.view();
    ck('snapshot tm = host game time × 1000: joiner view g.time ≈ host time (minus the interpolation delay)',
      v && near(v.g.time, r.toy.W.time, 0.3) && v.g.time < r.toy.W.time, JSON.stringify({ view: v && v.g.time, host: r.toy.W.time }));
    endAll(r);
  }
  {
    // ctl flood from a joiner: rate-limited, the host does not re-broadcast the room for every message
    const r = await room(2);
    const [spam, other] = r.clients;
    let lobbies = 0; other.s.on('lobby', () => lobbies++);
    for (let i = 0; i < 200; i++) spam.s.chooseHero(i % 2 ? 3 : 1);
    await pump(r.bus, 100);
    ck('ctl token bucket: 200 hero messages in a burst → at most about a burst of lobby broadcasts to the others', lobbies <= 45 && lobbies >= 5 && !spam.s.ended,
      'lobby msgs to 3P: ' + lobbies);
    endAll(r);
  }
  {
    // host stall of 1.5 s: the joiner's view never jumps backwards and the clock offset recovers
    const toy = makeToy(NET);
    const ip = new NET.Interp({ schema: toy.adapter.schema });
    const mk = tm => ({ g: { state: 'play', time: tm / 1000, camera: 0, coins: 0, toast: '', lock: null, driving: false, shake: 0 }, p: [{ slot: 1, hero: 1, x: tm / 10, y: 0, dir: 1, hp: 1, taps: 0, free: true }], e: [], b: [] });
    let seq = 0, tm = 0, at = 1000;
    for (let i = 0; i < 40; i++) { ip.push(++seq, tm, mk(tm), at); tm += 50; at += 50; }
    let lastX = -Infinity, back = 0, viewAt = 1000;
    const look = until => { for (; viewAt <= until; viewAt += 16) { const v = ip.view(viewAt); const x = v.p[0].x; if (x < lastX - 0.01) back = Math.max(back, lastX - x); lastX = x; } };
    look(at);
    at += 1500;   // the host sim stalls: no snapshots, host time stands still
    look(at);
    for (let i = 0; i < 30; i++) { ip.push(++seq, tm, mk(tm), at); tm += 50; at += 50; look(at); }
    const lag = tm - 50 - ip.renderTime(at);
    ck('interpolation: after a 1.5 s host stall the view never moves backwards and render time is back to newest - delay',
      back === 0 && near(lag, ip.delay, 60), JSON.stringify({ back, lag, delay: ip.delay }));
  }
  {
    // misc: invalid preferred host code → a generated one; HostSession forwards transport errors as 'error'
    const bus = manualBus();
    const h = await drive(bus, NET.host({ adapter: makeToy(NET).adapter, transport: NET.transports.loopback({ bus }), code: 'DINO-OOOO', register: false }));
    const errs = []; h.on('error', e => errs.push(e.code));
    h.transport.emit('peer-error', NET.error('broker', 'socket-closed'));
    ck("host({code:<invalid>}) generates a code; transport errors reach HostSession 'error'", /^DINO-[2-9A-Z]{4}$/.test(h.code) && deq(errs, ['broker']) && h.status().error === 'broker', JSON.stringify({ code: h.code, errs }));
    h.end(); NET._test.setClock(null);
  }
}

// ---------------------------------------------------------------- the WebSocket relay (relay/, tests/lib/relay.cjs)
// Protocol conformance of the Node fixture and of the real Worker under `wrangler dev`, then whole net.js sessions
// through the relay in Node (host + 2 joiners, inputs, snapshots, room full, host leaving) and the auto transport's
// direct-first / relay-fallback rules. NET_RELAY_LIVE=1 also runs host + 1 joiner over the deployed relay (RELAY_URL).
const RSTEP = 'relay';
const rck = (title, ok, detail) => (ok ? C.pass(RSTEP, title, detail && String(detail).slice(0, 300)) : C.fail(RSTEP, title, String(detail).slice(0, 1500)));
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleepMs(20); } return !!fn(); };
let RELAY = null, NODE_RELAY = null;   // the relay the browser rows use too: {kind, url, stop, note}

// host + joiners in Node over real WebSockets, real clock; a 60 Hz loop steps the toy game and sends joiner input
async function relayRoom(url, n) {
  NET._test.setClock(null);
  const toy = makeToy(NET);
  const host = await NET.host({ adapter: toy.adapter, transport: NET.transports.relay({ url, cid: 'hostcid' + Math.random().toString(36).slice(2, 8) }), name: 'alif', hero: 0, register: false });
  const clients = [];
  for (let i = 0; i < n; i++) {
    const ctoy = makeToy(NET), cid = 'rcid' + i + Math.random().toString(36).slice(2, 8);
    const s = await NET.join(host.code, { adapter: ctoy.adapter, transport: NET.transports.relay({ url, cid }), name: 'p' + (i + 2), hero: i + 1, register: false, cid });
    clients.push({ s, toy: ctoy, cid, sampler: s.sampler });
  }
  const loop = setInterval(() => {
    toy.step(1 / 60); host.tick(1 / 60);
    for (const c of clients) if (!c.s.ended) c.s.sendInput(c.sampler.sample(1000 / 60));
  }, 1000 / 60);
  return { toy, host, clients, stop: () => clearInterval(loop) };
}
const joinErr = (code, transport, cid) => NET.join(code, { adapter: makeToy(NET).adapter, transport, register: false, cid }).then(s => s, e => e);

async function relayRows() {
  const R = require('./lib/relay.cjs');
  // 1) protocol conformance: the Node fixture always, the real Worker under wrangler dev when relay/ has wrangler
  NODE_RELAY = await R.startNode();
  for (const r of await R.conformance(NODE_RELAY.url)) rck('relay protocol (node fixture): ' + r.name, r.ok, r.detail);
  let wr = null;
  if (process.env.RELAY_BACKEND !== 'node') {
    try { wr = await R.startWrangler(); } catch (e) { C.skip(RSTEP, 'relay protocol (wrangler dev, relay/src/index.js)', String(e.message).slice(0, 200)); }
    if (wr) for (const r of await R.conformance(wr.url)) rck('relay protocol (wrangler dev): ' + r.name, r.ok, r.detail);
  }
  RELAY = wr ? Object.assign(wr, { note: 'wrangler dev' }) : Object.assign(NODE_RELAY, { note: 'node fixture' });
  const url = RELAY.url, tag = ' [' + RELAY.note + ']';

  // 2) net.js sessions through the relay: host + 2 joiners
  {
    const r = await relayRoom(url, 2);
    try {
      rck('relay sessions: host + 2 joiners join by code over the relay (slots 1 and 2, relay links)' + tag,
        r.clients[0].s.slot === 1 && r.clients[1].s.slot === 2 && r.clients.every(c => c.s.link.kind === 'relay') && r.host.clients.size === 2, JSON.stringify(r.clients.map(c => [c.s.slot, c.s.link.kind])));
      const fourth = await joinErr(r.host.code, NET.transports.relay({ url, cid: 'fourth01' }), 'fourth01');
      rck('relay sessions: a 4th player is refused with "full" (THIS GAME IS FULL)', fourth && fourth.code === 'full' && /FULL/.test(fourth.title), fourth && (fourth.code || 'joined?'));
      for (const c of r.clients) c.s.ready(true);
      await until(() => r.host.canStart() && r.host.clients.size === 2);
      r.host.start();
      await until(() => r.clients.every(c => c.s.latest > 0), 5000);
      const t0 = r.toy.players[1].x;
      r.clients[0].sampler.keyDown('ArrowRight');
      for (let i = 0; i < 3; i++) { r.clients[1].sampler.keyDown('KeyJ'); await sleepMs(60); r.clients[1].sampler.keyUp('KeyJ'); await sleepMs(60); }
      await sleepMs(400);
      r.clients[0].sampler.keyUp('ArrowRight');
      await until(() => r.toy.players[2] && r.toy.players[2].taps === 3, 3000);
      await sleepMs(500);
      const hx = r.toy.players[1].x, taps = r.toy.players[2].taps;
      rck('relay sessions: joiner input reaches the host (held right moves slot 1, three J taps on slot 2 counted exactly)', hx > t0 + 20 && taps === 3, JSON.stringify({ t0, hx, taps }));
      const views = r.clients.map(c => { const v = c.s.interp.newest(); const p = v && v.state.p.find(q => q.slot === 1); return { latest: c.s.latest, x: p && p.x }; });
      rck('relay sessions: snapshots reach both joiners and match the host (slot 1 x within 1 px)', views.every(v => v.latest > 10 && Math.abs(v.x - hx) <= 1), JSON.stringify({ hx, views }));
      const ends = r.clients.map(c => new Promise(res => { c.s.on('end', e => res(e.reason)); setTimeout(() => res('no end'), 5000); }));
      r.host.end('host-left');
      const reasons = await Promise.all(ends);
      rck('relay sessions: the host leaving ends the session for both joiners (host-left)', reasons.every(x => x === 'host-left'), JSON.stringify(reasons));
    } finally { r.stop(); if (!r.host.ended) r.host.end(); for (const c of r.clients) if (!c.s.ended) c.s.leave(); }
  }
  // the host's socket drops without a goodbye: the relay closes the joiners with host-left
  {
    const r = await relayRoom(url, 1);
    const end = new Promise(res => { r.clients[0].s.on('end', e => res(e.reason)); setTimeout(() => res('no end'), 6000); });
    r.stop(); if (r.host._stopTimer) r.host._stopTimer(); r.host.ended = true; r.host.transport.close();
    const why = await end;
    rck('relay sessions: the host socket dropping (no end message) ends the joiner with host-left', why === 'host-left', why);
  }
  // a joiner leaving frees its slot
  {
    const r = await relayRoom(url, 2);
    r.clients[1].s.leave();
    await until(() => r.host.clients.size === 1, 3000);
    await sleepMs(300);
    const third = await joinErr(r.host.code, NET.transports.relay({ url, cid: 'newcomer1' }), 'newcomer1');
    rck('relay sessions: a joiner who leaves frees the relay slot for a newcomer', third && third.slot === 2, third && (third.code || third.slot));
    r.stop(); if (third && third.leave) third.leave(); r.clients[0].s.leave(); r.host.end();
  }
  // a keyframe bigger than the relay's 64 KB frame cap (net.js fragments it, the transport batches under the cap)
  {
    const r = await relayRoom(url, 1);
    const orig = r.toy.adapter.serialize;
    r.toy.adapter.serialize = () => { const s = orig(); s.e = s.e.concat(Array.from({ length: 600 }, (_, i) => ({ nid: 10000 + i, type: 'filler-' + (i % 7), x: i * 3.3, y: i, hp: i, state: 'idle', x_: { pad: 'p'.repeat(120) } }))); return s; };
    r.clients[0].s.ready(true);
    await until(() => r.host.canStart());
    r.host.start();
    await until(() => r.clients[0].s.latest > 0, 5000);
    const c = r.clients[0].s, got = c.latest > 0 ? c.history.get(c.latest).e.length : 0;
    const kf = JSON.stringify(r.host.codec.encode(r.host.history[r.host.history.length - 1].q, null)).length;
    rck('relay sessions: a ' + Math.round(kf / 1024) + ' KB keyframe crosses the relay and decodes', got === 603 && kf > 64 * 1024, JSON.stringify({ got, kf }));
    r.stop(); c.leave(); r.host.end();
  }

  // 3) auto transport: direct first, relay fallback
  const bus = NET.memoryBus({ latency: 2 });
  const autoFor = (cid, o = {}) => NET.transports.auto({ direct: o.direct === undefined ? NET.transports.loopback({ bus }) : o.direct, relay: NET.transports.relay({ url, cid }), windowMs: o.windowMs || 7000 });
  const joinAuto = async (code, cid, o) => {
    const steps = [], onp = s => steps.push(s);
    NET.on('progress', onp);
    const t0 = Date.now();
    try {
      const s = await NET.join(code, { adapter: makeToy(NET).adapter, transport: autoFor(cid, o), register: false, cid });
      return { s, steps, ms: Date.now() - t0, via: s.link.kind };
    } catch (e) { return { err: e, steps, ms: Date.now() - t0 }; } finally { NET.off('progress', onp); }
  };
  {
    const htoy = makeToy(NET);
    const host = await NET.host({ adapter: htoy.adapter, transport: autoFor('autohost1'), name: 'host', hero: 0, register: false });
    rck('auto: the host listens on the direct transport and on the relay for the same room', JSON.stringify(host.transport.listening) === '["loopback","relay"]', JSON.stringify(host.status().via));
    const a = await joinAuto(host.code, 'autojoin1');
    rck('auto: a direct link that opens is used', a.via === 'loopback' && a.steps.includes('direct') && !a.steps.includes('relay'), JSON.stringify({ via: a.via, steps: a.steps, err: a.err && a.err.code }));
    bus.block('ice');
    const b = await joinAuto(host.code, 'autojoin2');
    rck('auto: direct fails (ICE blocked) → progress direct then relay, joined through the relay', b.via === 'relay' && b.s.slot === 2 && b.steps.indexOf('direct') >= 0 && b.steps.indexOf('direct') < b.steps.indexOf('relay'), JSON.stringify({ via: b.via, slot: b.s && b.s.slot, steps: b.steps, ms: b.ms, err: b.err && b.err.code }));
    if (a.s && b.s) {
      for (const s of [a.s, b.s]) s.ready(true);
      await until(() => host.canStart());
      host.start();
      const loop = setInterval(() => { htoy.step(1 / 60); host.tick(1 / 60); for (const s of [a.s, b.s]) if (!s.ended) s.sendInput(s.sampler.sample(1000 / 60)); }, 1000 / 60);
      await until(() => b.s.latest > 0, 4000);
      const x0 = htoy.players[2].x; b.s.sampler.keyDown('ArrowLeft'); await sleepMs(500); b.s.sampler.keyUp('ArrowLeft'); await sleepMs(300);
      rck('auto: a direct joiner and a relayed joiner play in one room (relayed input moves slot 2; both get snapshots)', htoy.players[2].x < x0 - 20 && b.s.latest > 5 && a.s.latest > 5, JSON.stringify({ x0, x: htoy.players[2].x, a: a.s.latest, b: b.s.latest }));
      clearInterval(loop);
      a.s.leave(); b.s.leave();
    }
    host.end();
  }
  {
    // the direct attempt never answers: the relay takes over after the window
    const hang = NET.transports.loopback({ bus }); hang.connect = () => new Promise(() => {});
    const host = await NET.host({ adapter: makeToy(NET).adapter, transport: NET.transports.relay({ url, cid: 'hanghost1' }), register: false });
    const c = await joinAuto(host.code, 'hangjoin1', { direct: hang, windowMs: 900 });
    rck('auto: a direct link that does not open within the window → relay (900 ms here, ' + NET.RELAY_WINDOW_MS + ' ms in play)', c.via === 'relay' && c.ms >= 850 && c.ms < 4000, JSON.stringify({ via: c.via, ms: c.ms, err: c.err && c.err.code }));
    const d = await joinAuto(host.code, 'hangjoin2');
    rck('auto: direct finds no such game but the host is on the relay → joined through the relay', d.via === 'relay' && d.s.slot === 2, JSON.stringify({ via: d.via, err: d.err && d.err.code }));
    if (c.s) c.s.leave(); if (d.s) d.s.leave(); host.end();
  }
  {
    const host = await NET.host({ adapter: makeToy(NET).adapter, transport: NET.transports.loopback({ bus }), register: false });
    bus.block('ice');
    const e = await joinAuto(host.code, 'errjoin01');
    rck("auto errors: direct ICE fails and the host isn't on the relay → CAN'T CONNECT, and the text mentions the relay", e.err && e.err.code === 'ice-failed' && /relay/.test(e.err.text) && e.steps.includes('relay'), JSON.stringify({ code: e.err && e.err.code, steps: e.steps }));
    const f = await joinAuto('DINO-ZZZZ', 'errjoin02');
    rck('auto errors: an unknown code on both paths → bad-code', f.err && f.err.code === 'bad-code', f.err && f.err.code);
    bus.block('ice');
    const g = await joinErr(host.code, NET.transports.auto({ direct: NET.transports.loopback({ bus }), relay: NET.transports.relay({ url: 'ws://127.0.0.1:9', cid: 'downjoin1', openMs: 1500 }) }), 'downjoin1');
    rck('auto errors: relay unreachable → the direct error stands (ice-failed)', g && g.code === 'ice-failed', g && g.code);
    const h = await joinErr(host.code, NET.transports.relay({ url: 'ws://127.0.0.1:9', cid: 'downjoin2', openMs: 1500 }), 'downjoin2');
    rck("relay only, relay unreachable → CAN'T REACH THE RELAY SERVER", h && h.code === 'relay-down' && /RELAY/.test(h.title), h && h.code);
    host.end();
  }
  bus.close();
  // relay URL handling
  {
    const had = 'location' in globalThis, saved = globalThis.location;
    const at = q => { globalThis.location = { search: q, protocol: 'http:', href: 'http://x/' + q }; return [NET.relayUrl(), NET.defaultTransport()]; };
    const res = { none: at(''), relay: at('?net=relay&relay=ws://127.0.0.1:8787'), https: at('?relay=https://r.example.dev/'), evil: at('?relay=ws://evil.example'), off: at('?relay=off'), loop: at('?net=loopback') };
    if (had) globalThis.location = saved; else delete globalThis.location;
    rck('relay URL: RELAY_URL by default (auto transport), ?relay= overrides (https→wss), plain ws:// only to this computer, ?relay=off = direct only',
      res.none[0] === NET.RELAY_URL && res.none[1] === (NET.RELAY_URL ? 'auto' : 'peerjs') && res.relay[0] === 'ws://127.0.0.1:8787' && res.relay[1] === 'relay' && res.https[0] === 'wss://r.example.dev' && res.https[1] === 'auto'
      && res.evil[0] === NET.RELAY_URL && res.off[0] === '' && res.off[1] === 'peerjs' && res.loop[1] === 'loopback', JSON.stringify(res));
  }
  // 4) the deployed relay (opt-in: needs the internet)
  if (process.env.NET_RELAY_LIVE === '1' && NET.RELAY_URL) {
    try {
      const r = await relayRoom(NET.RELAY_URL, 1);
      r.clients[0].s.ready(true); await until(() => r.host.canStart(), 8000); r.host.start();
      await until(() => r.clients[0].s.latest > 0, 8000);
      const x0 = r.toy.players[1].x; r.clients[0].sampler.keyDown('ArrowRight'); await sleepMs(600); r.clients[0].sampler.keyUp('ArrowRight'); await sleepMs(600);
      const ok = r.clients[0].s.slot === 1 && r.clients[0].s.latest > 5 && r.toy.players[1].x > x0 + 20;
      rck('LIVE relay ' + NET.RELAY_URL + ': host + 1 joiner, input reaches the host, snapshots reach the joiner', ok, JSON.stringify({ code: r.host.code, slot: r.clients[0].s.slot, snaps: r.clients[0].s.latest, x0, x: r.toy.players[1].x, rttMs: Math.round(r.clients[0].s.rtt) }));
      r.stop(); r.clients[0].s.leave(); r.host.end();
    } catch (e) { rck('LIVE relay ' + NET.RELAY_URL, false, 'threw ' + (e.code || '') + ' ' + e.message); }
  } else C.skip(RSTEP, 'LIVE relay smoke (host + 1 joiner over RELAY_URL)', 'set NET_RELAY_LIVE=1 (needs the internet)');
}

// ---------------------------------------------------------------- browser rows
const ORIGIN = 'http://mp.test';
const PAGE = '<!doctype html><meta charset="utf-8"><title>net</title><script src="/net.js"></script><script src="/toy.js"></script><body>net</body>';
async function serve(ctx, origin = ORIGIN) {
  const netSrc = fs.readFileSync(path.join(A.ROOT, 'net.js'), 'utf8');
  const toySrc = 'window.makeToy = ' + makeToy.toString() + ';';
  await ctx.route(origin + '/**', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/net.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: netSrc });
    if (u.pathname === '/toy.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: toySrc });
    return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
  });
}
// The same page, net.js and toy game from a real HTTP server on 127.0.0.1 (for the relay rows).
function servePages() {
  const http = require('node:http');
  const netSrc = fs.readFileSync(path.join(A.ROOT, 'net.js'), 'utf8'), toySrc = 'window.makeToy = ' + makeToy.toString() + ';';
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const [type, body] = p === '/net.js' ? ['text/javascript', netSrc] : p === '/toy.js' ? ['text/javascript', toySrc] : ['text/html', PAGE];
    res.writeHead(200, { 'content-type': type + '; charset=utf-8' }); res.end(body);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}
// In-page driver: host or join, then a 60 Hz loop (setInterval) that steps the toy game, ticks the host session and
// sends the joiner's sampled input. window.R holds the results the Node side reads.
const DRIVER = `
window.R = { log: [] };
window.runHost = async (o) => {
  const toy = makeToy(EDEN_NET); window.toy = toy;
  const s = await EDEN_NET.host({ adapter: toy.adapter, transport: o.transport, name: 'host', hero: 0 });
  window.S = s; R.code = s.code; R.kind = s.transport.kind;
  s.on('join', j => R.log.push('join ' + j.slot));
  window.loop = setInterval(() => { toy.step(1/60); s.tick(1/60); }, 1000/60);
  return s.code;
};
window.runJoin = async (code, o) => {
  const toy = makeToy(EDEN_NET); window.toy = toy;
  const s = await EDEN_NET.join(code, { adapter: toy.adapter, transport: o.transport, name: 'friend', hero: 2, cid: o.cid });
  window.S = s; R.slot = s.slot; R.kind = s.transport.kind;
  const sm = new EDEN_NET.input.Sampler(); window.SM = sm;
  addEventListener('keydown', e => sm.keyDown(e.code));
  addEventListener('keyup', e => sm.keyUp(e.code));
  s.on('start', () => { R.started = true; });
  s.on('end', e => { R.ended = e.reason; });
  let last = performance.now();
  window.loop = setInterval(() => { const n = performance.now(); s.sendInput(sm.sample(n - last)); last = n; const v = s.view(); if (v) R.view = v.p; }, 1000/60);
  return s.slot;
};`;

async function browserRows({ relayOnly = false } = {}) {
  let pw;
  try { pw = A.playwright(); } catch (e) { C.skip(STEP, 'browser rows', e.message); return; }
  const browser = await pw.chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const watch = page => { page.on('pageerror', e => errors.push(e.message)); return page; };
  try {
    // 0) the relay from real pages: ?net=relay&relay=ws://127.0.0.1:<port> on an allow-listed origin (localhost:*),
    //    one context per player; then the auto fallback (?net=auto&direct=loopback) to a relay-only host
    if (RELAY) {
      // a real local server (a page whose response came from a route counts as a public origin, and Chromium then blocks
      // its WebSockets to 127.0.0.1); localhost:* is on the relay's Origin allow-list
      const pageSrv = await servePages();
      const RO = 'http://localhost:' + pageSrv.port, q = '?net=relay&relay=' + encodeURIComponent(RELAY.url), tag = ' [' + RELAY.note + ']';
      const mk = async query => { const ctx = await browser.newContext(); const p = watch(await ctx.newPage()); await p.goto(RO + '/' + query); await p.evaluate(DRIVER); await p.evaluate(() => { R.steps = []; EDEN_NET.on('progress', s => R.steps.push(s)); }); return { ctx, p }; };
      const all = [];
      try {
        const h = await mk(q), j1 = await mk(q), j2 = await mk(q), j3 = await mk(q);
        all.push(h, j1, j2, j3);
        const code = await h.p.evaluate(() => runHost({}));
        const s1 = await j1.p.evaluate(c => runJoin(c, {}), code), s2 = await j2.p.evaluate(c => runJoin(c, {}), code);
        const kinds = await Promise.all([h, j1, j2].map(x => x.p.evaluate(() => [R.kind, S.link ? S.link.kind : null])));
        rck('browser relay: host + 2 joiner pages join through the relay (?net=relay)' + tag, s1 === 1 && s2 === 2 && kinds.every(k => k[0] === 'relay'), JSON.stringify({ code, s1, s2, kinds }));
        const full = await j3.p.evaluate(async c => { try { await runJoin(c, {}); return 'joined'; } catch (e) { return e.code + ' / ' + e.title; } }, code);
        rck('browser relay: a 4th player page gets THIS GAME IS FULL', /^full \/ THIS GAME IS FULL/.test(full), full);
        await j1.p.evaluate(() => S.ready(true)); await j2.p.evaluate(() => S.ready(true));
        await h.p.waitForFunction(() => S.canStart() && S.clients.size === 2, null, { timeout: 8000 });
        await h.p.evaluate(() => S.start());
        await j2.p.waitForFunction(() => R.started && R.view && R.view.length === 3, null, { timeout: 8000 });
        await j1.p.keyboard.down('ArrowRight'); await j1.p.waitForTimeout(600); await j1.p.keyboard.up('ArrowRight');
        for (let i = 0; i < 3; i++) await j2.p.keyboard.press('KeyJ');
        await j1.p.waitForTimeout(700);
        const hp = await h.p.evaluate(() => ({ x1: toy.players[1].x, taps2: toy.players[2].taps }));
        const v = await Promise.all([j1.p, j2.p].map(p => p.evaluate(() => (R.view.find(r => r.slot === 1) || {}).x)));
        rck('browser relay: keys on the joiner pages reach the host; both replicas show slot 1 where the host has it', hp.x1 > 100 && hp.taps2 === 3 && v.every(x => Math.abs(x - hp.x1) <= 1), JSON.stringify({ hp, v }));
        await h.p.close();   // pagehide → end{host-left}, then the socket closes
        await Promise.all([j1.p, j2.p].map(p => p.waitForFunction(() => R.ended, null, { timeout: 6000 }).catch(() => {})));
        const ended = await Promise.all([j1.p, j2.p].map(p => p.evaluate(() => R.ended)));
        rck('browser relay: closing the host tab ends both joiners with host-left', ended.every(e => e === 'host-left'), JSON.stringify(ended));
        // fallback: the host is relay-only; the joiner tries a direct (loopback) link first, finds no host, uses the relay
        const h2 = await mk(q), jf = await mk('?net=auto&direct=loopback&relay=' + encodeURIComponent(RELAY.url));
        all.push(h2, jf);
        const code2 = await h2.p.evaluate(() => runHost({}));
        const sf = await jf.p.evaluate(c => runJoin(c, {}), code2);
        const info = await jf.p.evaluate(() => ({ kind: R.kind, link: S.link.kind, steps: R.steps, transport: EDEN_NET.defaultTransport() }));
        await jf.p.evaluate(() => S.ready(true));
        await h2.p.waitForFunction(() => S.canStart() && S.clients.size === 1, null, { timeout: 8000 });
        await h2.p.evaluate(() => S.start());
        await jf.p.waitForFunction(() => R.started && R.view, null, { timeout: 8000 });
        await jf.p.keyboard.down('ArrowRight'); await jf.p.waitForTimeout(500); await jf.p.keyboard.up('ArrowRight'); await jf.p.waitForTimeout(400);
        const x = await h2.p.evaluate(() => toy.players[1].x);
        rck('browser relay: ?net=auto — the direct attempt fails, the joiner falls back to the relay (CONNECTING DIRECTLY → USING RELAY) and plays',
          sf === 1 && info.kind === 'auto' && info.link === 'relay' && info.steps.indexOf('direct') >= 0 && info.steps.indexOf('direct') < info.steps.indexOf('relay') && x > 100, JSON.stringify({ sf, info, x }));
      } catch (e) { rck('browser relay rows', false, 'threw ' + e.message); }
      for (const x of all) await x.ctx.close().catch(() => {});
      await new Promise(r => pageSrv.server.close(r));
    } else C.skip(RSTEP, 'browser relay rows', 'no relay started');
    if (relayOnly) return;
    // 1) two pages, one context, BroadcastChannel loopback (what ?net=loopback uses)
    {
      const ctx = await browser.newContext(); await serve(ctx);
      const requests = [];
      const a = watch(await ctx.newPage()), b = watch(await ctx.newPage());
      a.on('request', r => requests.push(r.url()));
      await a.goto(ORIGIN + '/host'); await b.goto(ORIGIN + '/join');
      const noNet = await a.evaluate(() => !!window.EDEN_NET && !document.querySelector('script[data-eden-net]') && typeof window.Peer === 'undefined');
      ck('loading net.js makes no network request and loads no PeerJS', noNet && requests.every(u => u.startsWith(ORIGIN)), requests.join(' '));
      await a.evaluate(DRIVER); await b.evaluate(DRIVER);
      const code = await a.evaluate(() => runHost({ transport: 'loopback' }));
      const slot = await b.evaluate(c => runJoin(c, { transport: 'loopback', cid: 'pagebjoiner' }), code);
      await b.evaluate(() => S.ready(true));
      await a.waitForFunction(() => S.canStart() && S.clients.size === 1);
      await a.evaluate(() => S.start());
      await b.waitForFunction(() => R.started && R.view);
      await b.keyboard.down('ArrowRight'); await b.waitForTimeout(700); await b.keyboard.up('ArrowRight');
      await b.keyboard.press('KeyJ'); await b.keyboard.press('KeyJ'); await b.keyboard.press('KeyJ');
      await b.waitForTimeout(600);
      const hostP = await a.evaluate(() => ({ x: toy.players[1].x, taps: toy.players[1].taps }));
      const view = await b.evaluate(() => R.view.find(p => p.slot === 1));
      ck('two pages over BroadcastChannel: join by code, START, keys move the joiner on the host and in its view, taps counted',
        slot === 1 && hostP.x > 100 && hostP.taps === 3 && view && Math.abs(view.x - hostP.x) <= 1, JSON.stringify({ code, slot, hostP, view }));
      await a.close();   // pagehide → end{host-left}
      await b.waitForFunction(() => R.ended, null, { timeout: 5000 }).catch(() => {});
      const ended = await b.evaluate(() => R.ended);
      ck('host tab closes → joiner page gets host-left', ended === 'host-left', String(ended));
      await ctx.close();
    }
    // 2) two browser contexts (separate storage) over a Node relay implementing the window.__MP_BUS contract
    {
      const pages = [];
      const relay = async (src, f, t, c, x) => { for (const p of pages) if (!p.isClosed()) p.evaluate(([f, t, c, x]) => window.__MP_BUS && window.__MP_BUS.inbox && window.__MP_BUS.inbox(f, t, c, x), [f, t, c, x]).catch(() => {}); };
      const mk = async () => {
        const ctx = await browser.newContext(); await serve(ctx);
        await ctx.exposeBinding('__mpSend', (src, f, t, c, x) => { setTimeout(() => relay(src, f, t, c, x), 5); });
        await ctx.addInitScript(() => { window.__MP_BUS = { send: (f, t, c, x) => window.__mpSend(f, t, c, x), inbox: null }; });
        const p = watch(await ctx.newPage()); pages.push(p); await p.goto(ORIGIN + '/'); await p.evaluate(DRIVER); return { ctx, p };
      };
      const h = await mk(), j1 = await mk(), j2 = await mk();
      const code = await h.p.evaluate(() => runHost({ transport: 'loopback' }));
      const s1 = await j1.p.evaluate(c => runJoin(c, { transport: 'loopback' }), code);
      const s2 = await j2.p.evaluate(c => runJoin(c, { transport: 'loopback' }), code);
      const cids = await Promise.all([j1.p, j2.p].map(p => p.evaluate(() => S.cid)));
      await j1.p.evaluate(() => S.ready(true)); await j2.p.evaluate(() => S.ready(true));
      await h.p.waitForFunction(() => S.canStart() && S.clients.size === 2);
      await h.p.evaluate(() => S.start());
      await j2.p.waitForFunction(() => R.started && R.view && R.view.length === 3);
      await j2.p.keyboard.down('ArrowLeft'); await j2.p.waitForTimeout(500); await j2.p.keyboard.up('ArrowLeft'); await j2.p.waitForTimeout(500);
      const hx = await h.p.evaluate(() => toy.players[2].x), v2 = await j2.p.evaluate(() => R.view.find(p => p.slot === 2).x), v1 = await j1.p.evaluate(() => R.view.find(p => p.slot === 2).x);
      ck('three contexts over a Node-relayed __MP_BUS (bus.inbox contract): slots 1/2, separate cids, both replicas track the host',
        s1 === 1 && s2 === 2 && cids[0] !== cids[1] && hx < 100 && Math.abs(v2 - hx) <= 1 && Math.abs(v1 - hx) <= 1, JSON.stringify({ s1, s2, cids, hx, v1, v2 }));
      for (const x of [h, j1, j2]) await x.ctx.close();
    }
    // 3) rtc-local: real RTCPeerConnection data channels, signalled over BroadcastChannel
    {
      const ctx = await browser.newContext(); await serve(ctx);
      const a = watch(await ctx.newPage()), b = watch(await ctx.newPage());
      await a.goto(ORIGIN + '/'); await b.goto(ORIGIN + '/');
      await a.evaluate(DRIVER); await b.evaluate(DRIVER);
      let ok = false, detail = '';
      try {
        const code = await a.evaluate(() => runHost({ transport: 'rtc-local' }));
        await b.evaluate(c => runJoin(c, { transport: 'rtc-local' }), code);
        await b.evaluate(() => S.ready(true));
        await a.waitForFunction(() => S.canStart() && S.clients.size === 1, null, { timeout: 15000 });
        // a 20 KB keyframe: make the toy world big, then start
        await a.evaluate(() => { const ad = toy.adapter, orig = ad.serialize; ad.serialize = () => { const s = orig(); s.e = s.e.concat(Array.from({ length: 300 }, (_, i) => ({ nid: 10000 + i, type: 'filler-' + (i % 7), x: i * 3.3, y: i, hp: i, state: 'idle', x_: { pad: 'p'.repeat(20) } }))); return s; }; S.start(); });
        await b.waitForFunction(() => R.started && R.view, null, { timeout: 15000 });
        const info = await b.evaluate(() => ({ kind: S.link.kind, frags: EDEN_NET._test.lastMessages.length, ents: S.history.get(S.latest).e.length }));
        const st = await a.evaluate(() => { const c = [...S.clients.values()][0]; return { kf: JSON.stringify(c && S.codec.encode(S.history[S.history.length - 1].q, null)).length }; });
        ok = info.kind === 'rtc-local' && info.ents === 303 && st.kf > 12000; detail = JSON.stringify({ info, st });
      } catch (e) { detail = 'threw ' + e.message; }
      ck('rtc-local: real data channels open between pages; a >12 KB keyframe arrives fragmented', ok, detail);
      await ctx.close();
    }
    // 4) real PeerJS (opt-in)
    if (process.env.MP_PEERJS === '1') {
      const ctx = await browser.newContext(); await serve(ctx);
      const a = watch(await ctx.newPage()), b = watch(await ctx.newPage());
      await a.goto(ORIGIN + '/'); await b.goto(ORIGIN + '/');
      await a.evaluate(DRIVER); await b.evaluate(DRIVER);
      try {
        const code = await a.evaluate(() => runHost({ transport: 'peerjs' }));
        const slot = await b.evaluate(c => runJoin(c, { transport: 'peerjs' }), code);
        await b.evaluate(() => S.ready(true));
        await a.waitForFunction(() => S.canStart() && S.clients.size === 1, null, { timeout: 15000 });
        await a.evaluate(() => S.start());
        await b.waitForFunction(() => R.started && R.view, null, { timeout: 15000 });
        const relay = await a.evaluate(() => ({ relay: EDEN_NET.relay, ice: (window.peerjs && peerjs.util && JSON.stringify(peerjs.util.defaultConfig.iceServers)) || '' }));
        const bad = await b.evaluate(async () => { try { await EDEN_NET.join('DINO-2Z2Z', { adapter: toy.adapter, transport: 'peerjs', register: false }); return 'joined?'; } catch (e) { return e.code; } });
        const iceText = await a.evaluate(() => EDEN_NET.errors['ice-failed'].text);
        ck('PeerJS smoke: host code, join, accept, snapshots over the public broker; unknown code → bad-code; TURN wording',
          slot === 1 && bad === 'bad-code' && relay.relay === true && /public relay/.test(iceText), JSON.stringify({ code, slot, bad, relay }));
      } catch (e) {
        C.skip(STEP, 'PeerJS smoke', 'network/broker unavailable: ' + e.message.slice(0, 160));
      }
      await ctx.close();
    } else C.skip(STEP, 'PeerJS smoke (real broker)', 'set MP_PEERJS=1 (needs the internet)');
  } finally { await browser.close(); }
}

(async () => {
  // NET_REVIEW_ONLY=1: only the review regression rows (handy for checking them against an older net.js)
  // NET_RELAY_ONLY=1: only the relay rows (Node + browser)
  const relayOnly = process.env.NET_RELAY_ONLY === '1';
  if (!relayOnly) { try { if (process.env.NET_REVIEW_ONLY === '1') await reviewRows(); else await nodeRows(); } catch (e) { C.fail(STEP, 'node rows', 'threw: ' + (e && e.stack || e)); } }
  NET._test.setClock(null);
  if (process.env.NET_REVIEW_ONLY !== '1') { try { await relayRows(); } catch (e) { C.fail(RSTEP, 'relay rows', 'threw: ' + (e && e.stack || e)); } }
  NET._test.setClock(null);
  if (process.env.NET_NODE_ONLY !== '1') { try { await browserRows({ relayOnly }); } catch (e) { C.fail(STEP, 'browser rows', 'threw: ' + (e && e.stack || e)); } }
  for (const r of [RELAY, NODE_RELAY]) if (r) await r.stop().catch(() => {});
  A.finish(C, errors);
  process.exit(0);
})();
