// Online co-op suite (work/mp/MULTIPLAYER.md §4, §5.5).
//
//   node tools/serve.cjs 8766            (or let this suite start it on the default GAME_URL)
//   node tests/multiplayer.cjs           rows of steps that have not landed are SKIP with the reason
//   ARCADE_STEP=G9a node tests/multiplayer.cjs     the G9a rows (net.js, lobby.js, harness + mock game) must run
//   ARCADE_STEP=G9b node tests/multiplayer.cjs     ... and the game.js integration rows
//   node tests/multiplayer.cjs --record-sp         record tests/fixtures/sp-trace.json on the CURRENT game.js
//                                                   (--record-sp=<file> writes elsewhere; the fixture also keeps the
//                                                   single-player LAST_EDEN.snapshot key list)
//                                                   (the G9b agent runs this once before it edits game.js)
//   node tests/multiplayer.cjs --only=T1           run one tier (T0 units, T1 harness, T2 game single page,
//                                                   T3 game over loopback, T4 rtc-local, T5 PeerJS)
//   MP_RTC=1 / MP_PEERJS=1                          enable the G9c tiers (T5 needs the internet)
//
// Tiers: T0 net.js units in a blank page (no game, no bus) · T1 net.js + lobby.js on tests/fixtures/mp-harness.html with
// the mock game over the Node loopback bus (tests/lib/mp.cjs) · T2 LAST_EDEN.mp on one page, no network · T3 index.html
// on 2-4 pages over the bus · T4/T5 real WebRTC.
'use strict';
const fs = require('node:fs'), path = require('node:path');
const A = require('./lib/arcade.cjs'), MP = require('./lib/mp.cjs');

const ARGS = process.argv.slice(2);
const ONLY = (ARGS.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const tier = t => !ONLY.length || ONLY.includes(t);
const SP_FIXTURE = path.join(A.ROOT, 'tests', 'fixtures', 'sp-trace.json');
const RECORD = ARGS.find(a => a === '--record-sp' || a.startsWith('--record-sp='));
const RECORD_TO = RECORD && RECORD.includes('=') ? path.resolve(RECORD.slice(12)) : SP_FIXTURE;
const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const PEERJS_FALLBACK = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const ERROR_CODES = ['webrtc-unsupported', 'peerjs-load', 'broker', 'bad-code', 'full', 'version', 'build', 'hero-taken', 'ice-failed', 'timeout', 'host-left', 'kicked'];
const NET_REQ = /peerjs|cdn\.jsdelivr\.net|unpkg\.com|0\.peerjs\.com/i;
const sleep = MP.sleep;

const C = A.checks('multiplayer');
// like C.check, but a PASS keeps its detail (the measured numbers)
const chk = (step, title, ok, detail) => ok ? C.pass(step, title, detail) : C.fail(step, title, detail);
const allErrors = [], allRequests = [], busStats = [];
const S = {};   // what exists

// A session whose page errors/requests/bus stats are kept for the global rows.
// opts.tag marks the session's requests (the PeerJS tier's requests are expected and left out of the global row).
async function withSession(opts, fn) {
  const s = await MP.session(opts);
  try { return await fn(s); } finally {
    allErrors.push(...s.errors); allRequests.push(...s.requests.map(r => ({ ...r, tag: opts.tag || null }))); busStats.push(s.bus.stats());
    await s.close();
  }
}
const errCode = st => st && (st.error && (st.error.code || st.error) || null);

// §1.11 budget on the bus since the last resetStats: joiner -> host input <= 6 KB/s per joiner; host -> joiner <= 32 KB/s
// sustained and <= 64 KB/s in any 1 s window; events <= 4 KB/s per joiner; host upstream (all joiners) <= 100 KB/s.
function budget(s, hostPage, { joiners = 1 } = {}) {
  const bw = s.bus.stats(), hostIds = new Set([...s.bus.idsOf(hostPage), 'host']);
  const up = [], down = [], ev = []; let hostUp = 0;
  const sec = bw.elapsedMs / 1000;
  for (const [k, L] of Object.entries(bw.links)) {
    const [from, to] = k.split('>');
    if (hostIds.has(from)) { if (hostIds.has(to)) continue; down.push([to, L.kBps]); hostUp += L.bytes; ev.push([to, +(((L.types.event || {}).bytes || 0) / bw.elapsedMs).toFixed(2), (L.types.event || {}).msgs || 0]); }
    else if (hostIds.has(to)) up.push([from, L.kBps]);
  }
  const peaks = s.bus.peak({ filter: e => hostIds.has(e.from) && !hostIds.has(e.to) && e.channel !== '_' });
  const peakMax = Math.max(0, ...Object.values(peaks));
  const hostUpK = +(hostUp / bw.elapsedMs).toFixed(2);
  const bad = [];
  if (up.length < joiners) bad.push(`only ${up.length} joiner->host link(s) carried traffic`);
  if (down.length < joiners) bad.push(`only ${down.length} host->joiner link(s) carried traffic`);
  for (const [k, v] of up) if (v > 6) bad.push(`input ${k} ${v} KB/s > 6`);
  for (const [k, v] of down) if (v > 32) bad.push(`down ${k} ${v} KB/s > 32`);
  if (peakMax > 64) bad.push(`peak ${peakMax} KB/s > 64 in a 1 s window`);
  for (const [k, v] of ev) if (v > 4) bad.push(`events ${k} ${v} KB/s > 4`);
  if (hostUpK > 100) bad.push(`host upstream ${hostUpK} KB/s > 100`);
  const detail = `over ${sec.toFixed(1)} s: input up ${up.map(([k, v]) => k + ' ' + v).join(', ')}; down ${down.map(([k, v]) => k + ' ' + v).join(', ')} (1 s peak ${peakMax}); events ${ev.map(([k, v, n]) => `${k} ${v} (${n} msgs)`).join(', ')}; host upstream ${hostUpK} KB/s; largest message ${bw.maxMessage} B, keyframes ${bw.keyframes}`;
  return { ok: !bad.length, detail: (bad.length ? bad.join('; ') + ' — ' : '') + detail, bw };
}

// ================================================================ T0: net.js units (blank page, no bus)
const T0 = {
  // Canonical JSON (sorted keys; rows of keyed sections sorted by key) for exact state comparison.
  CANON: `(() => {
    const canon = (v, schema) => {
      const sort = (x) => Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.keys(x).sort().reduce((o, k) => (o[k] = sort(x[k]), o), {}) : (Object.is(x, -0) ? 0 : x);
      if (schema && schema.sections && v && typeof v === 'object') {
        v = { ...v };
        for (const [k, sec] of Object.entries(schema.sections)) if (sec.key && Array.isArray(v[k])) v[k] = [...v[k]].sort((a, b) => (a && a[sec.key]) - (b && b[sec.key]));
      }
      return JSON.stringify(sort(v));
    };
    return canon;
  })()`,
  SCHEMA: {
    sections: {
      g: { fields: [['state', 'str'], ['level', 'i'], ['time', 't'], ['camera', 'q4'], ['driving', 'b'], ['lock', 'json'], ['shake', 'f2'], ['rollT', 'f1'], ['bossIntro', 'f3']] },
      p: { key: 'slot', fields: [['slot', 'i'], ['nid', 'i'], ['hero', 'i'], ['x', 'q4'], ['y', 'q4'], ['z', 'q4'], ['hp', 'i'], ['weapon', 'str'], ['inv', 'f2'], ['an', 'json']] },
      e: { key: 'nid', fields: [['nid', 'i'], ['type', 'str'], ['x', 'q4'], ['y', 'q4'], ['hp', 'i'], ['boss', 'b'], ['dead', 'f2'], ['x_', 'json']] },
      b: { key: 'nid', fields: [['nid', 'i'], ['kind', 'str'], ['x', 'q4'], ['y', 'q4'], ['vx', 'q4'], ['friendly', 'b']] },
    },
  },
};

// The fuzz: random states from a schema (or mutations of a real serialized state), random baselines.
const FUZZ = `async ({ schema, base, cases, seed }) => {
  const canon = ${T0.CANON};
  let s = seed >>> 0; const R = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pick = a => a[Math.floor(R() * a.length)];
  const STR = ['idle', 'walk', 'hit', 'dead', 'brute', 'knifer', 'shotgun', '', 'quote"\\\\', 'ÄÖ ü', 'x'.repeat(40)];
  const val = (q, old) => {
    switch (q) {
      case 'q4': case 'f1': case 'f2': case 'f3': return R() < 0.15 ? 0 : (old != null && R() < 0.7 ? old + (R() - 0.5) * 30 : (R() - 0.3) * 2000);
      case 'i': return Math.round((R() - 0.2) * 500);
      case 't': return Math.round(R() * 3.6e6) / 1000 * 1000 + R();
      case 'b': return R() < 0.5;
      case 'str': return pick(STR);
      case 'json': return R() < 0.2 ? null : { a: Math.round(R() * 9), s: pick(STR), l: [1, 2, Math.round(R() * 5)] };
      default: return R() * 100;
    }
  };
  const C = schema.sections;
  const rowOf = (sec, key, old) => { const r = {}; for (const [f, q] of C[sec].fields) r[f] = f === C[sec].key ? key : (old && R() < 0.6 ? old[f] : val(q, old && old[f])); return r; };
  const fresh = () => {
    const st = {};
    for (const [k, sec] of Object.entries(C)) {
      if (!sec.key) { st[k] = rowOf(k, null, null); continue; }
      const n = Math.floor(R() * 6), used = new Set(), rows = [];
      for (let i = 0; i < n; i++) { let key = sec.key === 'slot' ? Math.floor(R() * 3) : Math.floor(R() * 200); if (used.has(key)) continue; used.add(key); rows.push(rowOf(k, key, null)); }
      st[k] = rows;
    }
    return st;
  };
  const mutate = (st, rate) => {
    const o = JSON.parse(JSON.stringify(st));
    for (const [k, sec] of Object.entries(C)) {
      if (!sec.key) { if (!o[k]) o[k] = {}; for (const [f, q] of sec.fields) if (R() < rate) o[k][f] = val(q, o[k][f]); continue; }
      let rows = Array.isArray(o[k]) ? o[k] : [];
      rows = rows.filter(() => R() > rate * 0.3);
      for (const r of rows) for (const [f, q] of sec.fields) if (f !== sec.key && R() < rate) r[f] = val(q, r[f]);
      if (R() < rate) { const keys = new Set(rows.map(r => r[sec.key])); let key = sec.key === 'slot' ? [0, 1, 2].find(x => !keys.has(x)) : Math.max(0, ...keys) + 1 + Math.floor(R() * 4); if (key != null) rows.push(rowOf(k, key, rows.length ? pick(rows) : null)); }
      o[k] = rows;
    }
    return o;
  };
  const codec = EDEN_NET.codec.make(schema);
  let fails = [], deltaBytes = 0, keyBytes = 0, small = 0;
  const t0 = performance.now();
  let prev = base || fresh();
  for (let i = 0; i < cases; i++) {
    const mode = R();
    const S = mode < 0.15 ? fresh() : mutate(prev, mode < 0.7 ? 0.05 : 0.4);
    const B = R() < 0.2 ? null : codec.quantise(mode < 0.5 ? prev : mutate(prev, 0.2));
    let got, want, enc;
    try {
      enc = codec.encode(S, B);
      const wire = JSON.parse(JSON.stringify(enc));      // it must survive the JSON wire
      got = canon(codec.decode(wire, B), schema); want = canon(codec.quantise(S), schema);
    } catch (e) { fails.push({ i, err: String(e && e.message || e) }); if (fails.length > 3) break; prev = S; continue; }
    if (got !== want) { fails.push({ i, base: !!B, got: got.slice(0, 300), want: want.slice(0, 300) }); if (fails.length > 3) break; }
    if (B && mode >= 0.15 && mode < 0.5) { small++; deltaBytes += JSON.stringify(enc).length; keyBytes += JSON.stringify(codec.encode(S, null)).length; }
    prev = S;
  }
  return { fails, ms: Math.round(performance.now() - t0), small, deltaAvg: small ? Math.round(deltaBytes / small) : 0, keyAvg: small ? Math.round(keyBytes / small) : 0 };
}`;

async function tierT0(browser) {
  const gate = S.net, why = 'net.js is not built yet (G9a net part): ' + MP.urlOf('net.js') + ' does not answer';
  const titles = ['room codes: alphabet, make, normalize, peerId, fromUrl, shareUrl', 'PeerJS pinned to 1.5.4 (jsDelivr, unpkg fallback) and not loaded by net.js itself',
    'codec round-trip fuzz: decode(encode(S,B),B) = quantise(S), 2,000 cases', 'fragmentation: a 60 KB text crosses a link intact in pieces <= 16 KB',
    'input press counters survive loss, duplication and reordering (200 taps)', 'double-tap counter -> dash on the receiver; a slow second tap is no dash',
    'interpolation delay stays in 60..250 ms and grows with arrival jitter', 'error table has every code of §1.14 with title, text, retry'];
  if (!gate) { for (const t of titles) C.skip('G9a', t, why); return; }
  const ctx = await browser.newContext();
  const page = await ctx.newPage(); const errors = [], requests = [];
  page.on('pageerror', e => errors.push('T0: ' + e.message)); page.on('request', r => requests.push({ page: 'T0', url: r.url() }));
  try {
    await page.goto(MP.urlOf('__mp-blank__'));
    await page.setContent('<!doctype html><title>mp units</title><body></body>');
    await page.addScriptTag({ url: MP.urlOf('net.js') });
    const has = await page.evaluate(() => { const N = window.EDEN_NET; return N ? { code: !!N.code, codec: !!(N.codec && N.codec.make), input: !!(N.input && N.input.Sampler && N.input.Receiver), interp: !!N.Interp, errors: !!N.errors, transports: !!(N.transports && N.transports.loopback && N.memoryBus), wire: typeof N.Wire === 'function', frag: Object.keys(N).filter(k => /frag/i.test(k)).concat(N._test ? Object.keys(N._test).filter(k => /frag/i.test(k)).map(k => '_test.' + k) : []) } : null; });
    if (!has) { for (const t of titles) C.fail('G9a', t, 'net.js loaded but window.EDEN_NET is missing' + (errors.length ? ': ' + errors[0] : '')); return; }

    await C.gated('G9a', titles[0], has.code, 'EDEN_NET.code missing (§5.1)', () => page.evaluate(({ alpha }) => {
      const K = EDEN_NET.code, bad = [];
      if (K.ALPHABET !== alpha) bad.push('ALPHABET ' + K.ALPHABET);
      const re = new RegExp('^DINO-[' + alpha + ']{4}$'), seen = new Set();
      for (let i = 0; i < 400; i++) { const c = K.make(); if (!re.test(c)) { bad.push('make() gave ' + c); break; } seen.add(c); }
      if (seen.size < 390) bad.push('make() repeats: ' + seen.size + ' distinct of 400');
      const ok = { 'DINO-4KQ7': 'DINO-4KQ7', 'dino4kq7': 'DINO-4KQ7', 'DINO 4KQ7': 'DINO-4KQ7', '4kq7': 'DINO-4KQ7', ' dino-4kq7 ': 'DINO-4KQ7', 'https://cadillacsanddinosaurs2.vercel.app/?join=DINO-4KQ7': 'DINO-4KQ7' };
      for (const [i, o] of Object.entries(ok)) if (K.normalize(i) !== o) bad.push(`normalize(${JSON.stringify(i)}) = ${JSON.stringify(K.normalize(i))}`);
      for (const i of ['DINO-0O1I', 'DINO-4KQ', 'DINO-4KQ77', '', 'DINO-LLLL', 'hello']) if (K.normalize(i) !== null) bad.push(`normalize(${JSON.stringify(i)}) should be null, got ${JSON.stringify(K.normalize(i))}`);
      if (K.peerId('DINO-4KQ7') !== 'cnd2-dino-4kq7') bad.push('peerId ' + K.peerId('DINO-4KQ7'));
      if (K.fromUrl('https://x.app/game/?join=dino-4kq7') !== 'DINO-4KQ7') bad.push('fromUrl ' + K.fromUrl('https://x.app/game/?join=dino-4kq7'));
      if (K.fromUrl('https://x.app/') !== null) bad.push('fromUrl without join should be null');
      const su = K.shareUrl('DINO-4KQ7', { origin: 'https://x.app', pathname: '/game/', protocol: 'https:', href: 'https://x.app/game/?net=loopback' });
      if (su !== 'https://x.app/game/?join=DINO-4KQ7') bad.push('shareUrl ' + su);
      if (K.shareUrl('DINO-4KQ7', { origin: 'null', pathname: '/E:/x/index.html', protocol: 'file:', href: 'file:///E:/x/index.html' }) !== null) bad.push('shareUrl on file: should be null');
      return bad.length ? bad.join('; ') : true;
    }, { alpha: MP.ALPHABET }));

    chk('G9a', titles[1], await page.evaluate(([u, f]) => window.EDEN_NET.PEERJS_URL === u && (!window.EDEN_NET.PEERJS_FALLBACK_URL || window.EDEN_NET.PEERJS_FALLBACK_URL === f) && typeof window.Peer === 'undefined', [PEERJS_URL, PEERJS_FALLBACK]) && !requests.some(r => NET_REQ.test(r.url)),
      `PEERJS_URL=${await page.evaluate(() => window.EDEN_NET.PEERJS_URL)} Peer=${await page.evaluate(() => typeof window.Peer)} requests=${requests.filter(r => NET_REQ.test(r.url)).map(r => r.url).join(',')}`);

    await C.gated('G9a', titles[2], has.codec, 'EDEN_NET.codec.make missing (§5.1)', async () => {
      const r = await page.evaluate(`(${FUZZ})(${JSON.stringify({ schema: T0.SCHEMA, base: null, cases: 2000, seed: 4242 })})`);
      if (r.fails.length) return `${r.fails.length} failing case(s) on the starter schema: ${JSON.stringify(r.fails[0]).slice(0, 600)}`;
      if (r.small && r.deltaAvg >= r.keyAvg) return `deltas are not smaller than keyframes (avg delta ${r.deltaAvg} B, keyframe ${r.keyAvg} B)`;
      C.pass('G9a', 'codec: small-change deltas are smaller than keyframes', `avg delta ${r.deltaAvg} B vs keyframe ${r.keyAvg} B over ${r.small} cases, ${r.ms} ms`);
      return true;
    });

    await C.gated('G9a', titles[3], has.transports && !!has.wire, 'EDEN_NET.Wire / transports.loopback / memoryBus missing', () => page.evaluate(async () => {
      // Host and client Wires (net.js's framing layer) over a loopback link pair on net.js's in-memory bus; measure
      // every text the bus carries.
      const N = EDEN_NET, bus = N.memoryBus({ mode: 'realtime' }); let max = 0, pieces = 0;
      const send = bus.send.bind(bus); bus.send = (f, t, c, x) => { max = Math.max(max, String(x).length); if (/"t":"frag"/.test(x)) pieces++; return send(f, t, c, x); };
      try {
        const h = N.transports.loopback({ bus }), c = N.transports.loopback({ bus });
        const id = 'cnd2-dino-frag';
        let got = null, resolve; const done = new Promise(r => { resolve = r; });
        let hostLink = null; h.onIncoming(link => { hostLink = link; });
        await h.listen(id);
        const link = await c.connect(id);
        new N.Wire(link, new Set(['event']), msg => { got = msg; resolve(); });
        let big = ''; for (let i = 0; big.length < 60000; i++) big += 'TEXT ' + i + ' "quoted" ü|';
        const msg = { t: 'event', n: 1, tm: 0, list: [['notice', big]] };
        for (let i = 0; i < 20 && !hostLink; i++) await new Promise(r => setTimeout(r, 25));
        if (!hostLink) return 'no host-side link opened';
        const hw = new N.Wire(hostLink, new Set(['hello']), () => {});
        hw.send(msg);
        await Promise.race([done, new Promise(r => setTimeout(r, 4000))]);
        try { link.close(); h.close(); c.close(); } catch (e) { /* */ }
        if (!got) return 'the 60 KB event never arrived';
        if (JSON.stringify(got) !== JSON.stringify(msg)) return 'the event arrived changed';
        if (max > 16384) return `a ${max}-char text crossed the bus: not split into <= 12,000-char frag pieces`;
        return pieces >= 5 ? true : `only ${pieces} frag pieces for ${JSON.stringify(msg).length} chars`;
      } catch (e) { return 'threw: ' + (e && (e.code || e.message) || e); }
    }));

    await C.gated('G9a', titles[4], has.input, 'EDEN_NET.input.Sampler/Receiver missing (§5.1)', () => page.evaluate(() => {
      const { Sampler, Receiver } = EDEN_NET.input;
      let s = 99; const R = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      const sm = new Sampler(), frames = []; let t = 0, taps = 0;
      for (let f = 0; f < 900; f++) {
        if (taps < 200 && f % 4 === 0) { sm.keyDown('KeyJ', t); sm.keyUp('KeyJ'); taps++; }
        if (f === 100) sm.keyDown('ArrowRight', t);
        if (f === 700) sm.keyUp('ArrowRight');
        t += 1000 / 60; frames.push(...sm.sample(1000 / 60));
      }
      if (frames.length < 850 || frames.length > 950) return `sampler produced ${frames.length} frames for 900 x 16.7 ms (expected ~900 at 60 Hz)`;
      // loss 5% (never the last frame), 5% duplicates, reorder within a window of 4
      const wire = [];
      frames.forEach((fr, i) => { if (i < frames.length - 1 && R() < 0.05) return; wire.push(JSON.parse(JSON.stringify(fr))); if (R() < 0.05) wire.push(JSON.parse(JSON.stringify(fr))); });
      for (let i = 0; i < wire.length - 4; i++) if (R() < 0.2) { const j = i + 1 + Math.floor(R() * 3); [wire[i], wire[j]] = [wire[j], wire[i]]; }
      // arrival times advance at 60 Hz (the receiver rate-limits a link to 120 frames per second)
      const rx = new Receiver(); let presses = 0, lastHeld = null, maxPer = 0, at = 0;
      const count = n => { const p = n.presses; const k = Array.isArray(p) ? p.filter(c => c === 'KeyJ').length : p && typeof p === 'object' ? (p.KeyJ || 0) : 0; maxPer = Math.max(maxPer, k); presses += k; lastHeld = n.held; };
      for (const fr of wire) { rx.push(fr, at += 1000 / 60); count(rx.next()); }
      for (let i = 0; i < 10; i++) count(rx.next());
      const held = lastHeld instanceof Set ? [...lastHeld] : Array.isArray(lastHeld) ? lastHeld : [];
      if (presses !== 200) return `${presses} KeyJ presses reached the receiver, expected 200 (wire ${wire.length} of ${frames.length} frames)`;
      if (held.includes('ArrowRight')) return 'ArrowRight still held after its release frame';
      // the held bit: right was down between frames 100 and 700
      const mid = new Receiver(); at = 0; for (const fr of frames.slice(0, 400)) mid.push(fr, at += 1000 / 60); let h2; for (let i = 0; i < 400; i++) h2 = mid.next();
      const hs = h2.held instanceof Set ? [...h2.held] : h2.held || [];
      if (!hs.includes('ArrowRight')) return 'ArrowRight not held in frame ~400';
      return true;
    }));

    await C.gated('G9a', titles[5], has.input, 'EDEN_NET.input missing', () => page.evaluate(() => {
      const { Sampler, Receiver } = EDEN_NET.input;
      const run = gapMs => {
        const sm = new Sampler(), rx = new Receiver(); let t = 1000, dash = null;
        const tick = () => { for (const f of sm.sample(1000 / 60)) { rx.push(f); const n = rx.next(); if (n.dash) dash = n.dash; } t += 1000 / 60; };
        sm.keyDown('ArrowRight', t); tick(); sm.keyUp('ArrowRight'); tick();
        const until = t + gapMs; while (t < until) tick();
        sm.keyDown('ArrowRight', t); tick(); tick(); sm.keyUp('ArrowRight'); for (let i = 0; i < 5; i++) tick();
        return dash;
      };
      const fast = run(150), slow = run(450);
      if (!fast) return 'two right taps 150 ms apart gave no dash on the receiver';
      if ((fast.dir != null ? fast.dir : fast.k) !== 1) return 'dash direction ' + JSON.stringify(fast);
      if (slow) return 'two taps 450 ms apart gave a dash (window is 0.28 s)';
      return true;
    }));

    await C.gated('G9a', titles[6], has.interp, 'EDEN_NET.Interp missing (§5.1)', () => page.evaluate(() => {
      const run = jit => {
        const I = new EDEN_NET.Interp({ min: 60, max: 250 }); let s = 7; const R = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        for (let n = 0; n < 80; n++) { const tm = n * 50, arr = 10000 + n * 50 + (R() * 2 - 1) * jit; I.push(n, tm, { g: { time: tm, camera: n * 2 }, p: [], e: [], b: [] }, arr); }
        const d = typeof I.delay === 'function' ? I.delay() : I.delay; const v = I.view(10000 + 80 * 50);
        return { d, v: !!v };
      };
      const calm = run(0), rough = run(40);
      if (!(calm.d >= 60 && calm.d <= 250)) return 'delay with steady 50 ms arrivals = ' + calm.d;
      if (!(rough.d > calm.d && rough.d <= 250)) return `delay did not grow with ±40 ms jitter (${calm.d} -> ${rough.d})`;
      if (!calm.v) return 'view() returned nothing after 80 snapshots';
      return true;
    }));

    await C.gated('G9a', titles[7], has.errors, 'EDEN_NET.errors missing', () => page.evaluate(codes => {
      const E = EDEN_NET.errors, bad = [];
      for (const c of codes) { const e = E[c]; if (!e || typeof e.title !== 'string' || !e.title || typeof e.text !== 'string' || typeof e.retry !== 'boolean') bad.push(c); }
      if (E['ice-failed'] && !/relay/i.test(E['ice-failed'].text)) bad.push('ice-failed text does not mention the relay');
      if (E['bad-code'] && !/DINO-/.test(E['bad-code'].text)) bad.push('bad-code text does not show the code shape');
      return bad.length ? 'missing or incomplete: ' + bad.join(', ') : true;
    }, ERROR_CODES));
  } finally {
    allErrors.push(...errors); allRequests.push(...requests);
    await ctx.close();
  }
}

// ================================================================ T1: net + lobby on the harness (mock game) over the bus
const t1Why = () => !S.net ? 'net.js is not built yet (G9a net part)' : !S.harness ? 'tests/fixtures/mp-harness.html is not built yet (G9a fixtures part)' : !S.mockOk ? 'the harness page has no MOCK_GAME adapter: ' + S.mockWhy : '';
const H = { page: 'harness' };
const roster = async page => { const st = await MP.net(page); return st && st.roster ? st.roster.filter(Boolean) : []; };
const playersOf = w => (w ? w.players : []).filter(Boolean);
const settleX = async (page, slot, ms = 2000) => { const end = Date.now() + ms; let last = null, same = 0; while (Date.now() < end) { const w = await MP.snap(page); const p = w && w.players[slot]; const x = p ? p.x : null; if (x != null && last != null && Math.abs(x - last) < 0.01) { if (++same >= 4) return x; } else same = 0; last = x; await sleep(30); } return last; };

async function tierT1() {
  const why = t1Why();
  const rows = {
    host: 'harness host shows a DINO-XXXX code', joinCode: 'join by code: the joiner gets slot 1 and both rosters list 2 players', link: 'join by ?join= link (lobby auto-join, parameter removed from the URL)',
    heroes: 'no duplicate heroes: every player has a different hero (host and joiners agree)', ready: 'START needs every connected joiner READY',
    started: 'START puts the host in play and the joiners in replica mode', within: 'joiners see the host\'s state within 30 frames',
    own: 'each player controls only their own hero', converge: 'joiners\' world matches the host\'s at equal sim time (players and entities by nid)',
    full: 'room full: a 4th player is rejected with full', leave: 'a joiner leaving frees its slot', hostLeft: 'host leaving ends the session: joiners get host-left',
    taps: '80±20 ms latency + 5 % loss: no tap lost in 200 taps, positions converge', kf: 'st outage longer than the baseline history -> keyframe -> the joiner recovers',
    echo: 'local echo: the joiner\'s own hero moves before the host has its input; corrects to the host after', rtt: 'ping/RTT reported to the joiner and in the host roster',
    bad: 'bad code -> bad-code within 2 s', build: 'build mismatch -> build', ice: 'blocked network -> ice-failed with the no-relay text',
    timeout: 'joiner silent 3 s -> away in the host roster, 10 s (fake clock) -> slot freed', cid: 'reconnect with the same cid -> same slot (held against another joiner)', dropIn: 'drop-in: a late joiner is admitted only when canAdmit()',
    bw: 'bandwidth within §1.11 (input <= 6 KB/s, down <= 32 KB/s sustained / 64 peak, events <= 4, host up <= 100)', sp: 'single-player harness page: no session, no PeerJS, no network request',
    race: 'hero race: two joiners pick the same free hero at once -> exactly one gets it', decoded: 'joiners\' decoded snapshots equal the host\'s quantised snapshots (same n)',
    version: 'protocol version mismatch -> version', jtimeout: 'joiner hears nothing 3 s -> unstable warning, 10 s (fake clock) -> timeout',
    hostile: 'hostile joiner: garbage, forged and out-of-range messages leave the host and the other players unharmed',
  };
  if (why) { for (const t of Object.values(rows)) C.skip('G9a', t, why); return; }
  const lobby = S.lobby, viaLobbyWhy = 'lobby.js is not built yet (G9a lobby part)';

  // ---- session A: 3 players, no latency
  await withSession({ ...H, players: 2 }, async s => {
    const [host, j1] = [s.host, s.joiners[0]];
    let code;
    try { code = await MP.hostRoom(host, { hero: 0 }); } catch (e) { C.fail('G9a', rows.host, e.message); return; }
    chk('G9a', rows.host, MP.CODE_RE.test(code), 'code ' + code);
    const r1 = await MP.joinRoom(j1, code, { hero: 0 });   // asks for the host's hero: must get another
    const ro = await roster(host);
    chk('G9a', rows.joinCode, r1.slot === 1 && ro.length === 2 && (await roster(j1)).length === 2, `join ${JSON.stringify(r1)} host roster ${JSON.stringify(ro)}`);
    // third player by share link
    let j2 = null;
    await C.gated('G9a', rows.link, lobby, viaLobbyWhy, async () => {
      j2 = await s.open('j2', { net: 'loopback', join: code });
      let r = await MP.waitForJoin(j2, 4000);
      let note = '';
      if (!r) { const did = await j2.evaluate(() => EDEN_LOBBY.autoJoinFromUrl({ adapter: MPT.adapter(), net: window.EDEN_NET })); note = ` (the harness did not auto-join; EDEN_LOBBY.autoJoinFromUrl() returned ${did})`; r = await MP.waitForJoin(j2, 6000); }
      const href = await j2.evaluate(() => location.href);
      if (!r || r.slot !== 2) return `link join gave ${JSON.stringify(r)}${note}`;
      if (/[?&]join=/.test(href)) return 'join= still in the address bar: ' + href;
      return true;
    });
    if (!j2) { j2 = await s.open('j2'); const r = await MP.joinRoom(j2, code, { hero: -1 }); if (r.error) C.fail('G9a', 'third player joins by code', r.error); }
    s.joiners = [j1, j2];
    // both joiners ask for the same free hero in the same instant (session API, no UI delay)
    {
      const taken = (await roster(host)).map(r => r.hero), free = [0, 1, 2, 3].find(h => !taken.includes(h));
      const before = (await roster(host)).filter(r => r.slot > 0).map(r => [r.slot, r.hero]);
      await Promise.all([j1, j2].map(pg => pg.evaluate(h => { const s2 = window.EDEN_NET && EDEN_NET.session || window.__mpSess; if (s2 && s2.chooseHero) s2.chooseHero(h); }, free)));
      await sleep(600);
      const after = await roster(host), aj1 = await roster(j1), aj2 = await roster(j2), hs = after.map(r => r.hero);
      const winners = after.filter(r => r.hero === free).length;
      chk('G9a', rows.race, free != null && winners === 1 && new Set(hs).size === hs.length && JSON.stringify(aj1.map(r => r.hero)) === JSON.stringify(hs) && JSON.stringify(aj2.map(r => r.hero)) === JSON.stringify(hs),
        `free hero ${free}; before ${JSON.stringify(before)}; host roster after ${JSON.stringify(after.map(r => [r.slot, r.hero]))}; joiners see ${aj1.map(r => r.hero)} / ${aj2.map(r => r.hero)}`);
    }
    await sleep(300);
    const heroes = (await roster(host)).map(r => r.hero), jHeroes = (await roster(j2)).map(r => r.hero);
    chk('G9a', rows.heroes, heroes.length === 3 && new Set(heroes).size === 3 && heroes.every(h => h >= 0 && h <= 3) && JSON.stringify(heroes) === JSON.stringify(jHeroes), `host roster heroes ${heroes} joiner ${jHeroes}`);
    // a 4th player
    const j3 = await s.open('j3');
    const r3 = await MP.joinRoom(j3, code, { hero: -1, timeout: 6000 });
    const st3 = await MP.net(j3);
    chk('G9a', rows.full, r3.slot == null && (r3.error === 'full' || errCode(st3) === 'full' || /FULL/i.test(r3.title || '')), `4th player: ${JSON.stringify(r3)} status ${JSON.stringify(st3 && st3.error)}`);
    await j3.close();
    // READY gating
    await MP.ready(j1, true); await sleep(200);
    const gate = lobby ? await host.evaluate(() => { const b = document.querySelector('#mp-start'); return b ? b.disabled : null; }) : await host.evaluate(async () => { try { await __mpSess.start(); return MPT.world().state === 'play' ? false : true; } catch (e) { return true; } });
    await MP.ready(j2, true); await sleep(300);
    const open = lobby ? await host.evaluate(() => { const b = document.querySelector('#mp-start'); return b ? !b.disabled : null; }) : true;
    chk('G9a', rows.ready, gate === true && open === true, `start blocked while 2P/3P not all ready: ${gate}; enabled when all ready: ${open}`);
    try { await MP.start(host); } catch (e) { C.fail('G9a', rows.started, e.message); return; }
    const okPlay = await MP.waitFor(host, () => { const w = MPT.world(); return w && w.state === 'play' ? true : null; }, null, 4000);
    const okRep = [];
    for (const j of [j1, j2]) okRep.push(await MP.waitFor(j, () => { const w = MPT.world(); return w && (w.role === 'client' || w.role === 'replica') && w.players.filter(Boolean).length === 3 ? true : null; }, null, 5000));
    chk('G9a', rows.started, okPlay && okRep.every(Boolean), `host play ${okPlay} joiners replica with 3 players ${okRep}`);
    for (const pg of [host, j1, j2]) await MP.blurInputs(pg);

    // joiners see the host's state within N frames
    await MP.hold(host, 'right', true); await sleep(500); await MP.hold(host, 'right', false);
    const hx = await settleX(host, 0); const f0 = [await MP.frames(j1), await MP.frames(j2)];
    const lag = [];
    for (const [i, j] of [j1, j2].entries()) { const r = await MP.waitFor(j, ({ hx }) => { const p = MPT.world().players[0]; return p && Math.abs(p.x - hx) <= 1 ? window.__MP_FRAMES : null; }, { hx }, 3000, 10); lag.push(r == null ? null : r - f0[i]); }
    chk('G9a', rows.within, lag.every(n => n != null && n <= 30), `frames until the joiners showed 1P at x=${hx && hx.toFixed(1)}: ${lag.join(', ')}`);

    // each player controls only their own hero
    const before = await MP.snap(host);
    await MP.hold(j1, 'right', true); await sleep(450); await MP.hold(j1, 'right', false);
    await MP.hold(j2, 'left', true); await sleep(450); await MP.hold(j2, 'left', false);
    await sleep(400);
    const after = await MP.snap(host);
    const dx = s2 => after.players[s2] && before.players[s2] ? after.players[s2].x - before.players[s2].x : NaN;
    chk('G9a', rows.own, dx(1) > 10 && dx(2) < -10 && Math.abs(dx(0)) < 0.5, `host saw dx 1P ${dx(0).toFixed(2)} 2P ${dx(1).toFixed(2)} 3P ${dx(2).toFixed(2)} (2P held right, 3P held left)`);

    // time-matched comparison: the rendered (interpolated) world against the host's serialized states around the
    // joiner's render time, and the decoded snapshots against the host's quantised ones
    const mode = await host.evaluate(() => MPT.record(true)); await sleep(1500);
    const cs = await MP.snap(j1), rec = await host.evaluate(() => MPT.recorded());
    if (cs && cs.time != null && rec.length && rec[0].time != null) { const r = MP.sameWorldTimed(rec, cs, { tol: 1.5 }); chk('G9a', rows.converge, r.ok && r.compared >= 3, `host records by ${mode}, bracket ${r.at}, joiner t ${cs.time}; compared ${r.compared}: ${r.diffs.slice(0, 4).join('; ')}`); }
    else { const p1 = await settleX(j1, 1), h1 = await settleX(host, 1); chk('G9a', rows.converge, p1 != null && Math.abs(p1 - h1) <= 1, `no sim time in the worlds (players only): 2P host ${h1} joiner ${p1}`); }
    await host.evaluate(() => MPT.record(false));
    { const d1 = await MP.decodedMatch(host, j1), d2 = await MP.decodedMatch(host, j2); chk('G9a', rows.decoded, d1.ok && d2.ok && d1.compared >= 5 && d2.compared >= 5, `2P compared ${d1.compared} (${d1.diffs.slice(0, 2).join('; ')}), 3P compared ${d2.compared} (${d2.diffs.slice(0, 2).join('; ')})`); }

    // ping / RTT (before the echo row's 150 ms latency, which the RTT averages would carry for seconds)
    s.bus.set({ latency: 40 }); await sleep(5000);
    const st1 = await MP.net(j1), ro2 = await roster(host);
    const rtt = st1 && st1.rtt, hp = (ro2.find(r => r.slot === 1) || {}).ping;
    chk('G9a', rows.rtt, rtt >= 60 && rtt <= 300 && typeof hp === 'number' && hp >= 40 && hp <= 400, `joiner rtt ${rtt} ms, host roster 2P ping ${hp} (bus latency 40 ms each way)`);

    // echo
    s.bus.set({ latency: 150 });
    await sleep(400);
    const e0 = await MP.snap(j1), h0 = await MP.snap(host);
    await MP.hold(j1, 'right', true);
    const ownMoved = await MP.waitFor(j1, ({ x }) => { const p = MPT.world().players[1]; return p && p.x - x > 0.5 ? window.__MP_FRAMES : null; }, { x: e0.players[1].x }, 600, 8);
    const hostAt = await MP.snap(host);
    await sleep(300); await MP.hold(j1, 'right', false);
    s.bus.set({ latency: 0 }); await sleep(1200);
    const fx = await settleX(j1, 1), hx1 = await settleX(host, 1);
    const hostMovedEarly = hostAt.players[1].x - h0.players[1].x;
    chk('G9a', rows.echo, ownMoved != null && hostMovedEarly < 0.5 && Math.abs(fx - hx1) <= 1,
      `joiner's own hero moved before the host saw input: ${ownMoved != null} (host dx then ${hostMovedEarly.toFixed(2)}); after release joiner x ${fx} host x ${hx1}`);

    // bandwidth (3 players, both joiners moving)
    s.bus.resetStats();
    for (let i = 0; i < 4; i++) { await MP.hold(j1, i % 2 ? 'left' : 'right', true); await MP.hold(j2, i % 2 ? 'up' : 'down', true); await sleep(500); await MP.hold(j1, i % 2 ? 'left' : 'right', false); await MP.hold(j2, i % 2 ? 'up' : 'down', false); await MP.press(j1, 'attack'); await sleep(450); }
    { const b = budget(s, host, { joiners: 2 }); chk('G9a', rows.bw, b.ok, '(mock game state) ' + b.detail); }

    // joiner leaves
    if (lobby && await MP.visible(j2, '#mp-leave')) await j2.click('#mp-leave'); else await j2.evaluate(() => { const s2 = window.EDEN_NET && EDEN_NET.session || window.__mpSess; if (s2 && s2.leave) s2.leave(); });
    const freed = await MP.waitFor(host, () => { const st = MPT.status(); const r = (st && st.roster || []).filter(Boolean); return !r.some(x => x.slot === 2) ? true : null; }, null, 3000);
    const gone = await MP.waitFor(host, () => !MPT.world().players[2] ? true : null, null, 3000);
    chk('G9a', rows.leave, !!freed && !!gone, `roster freed ${!!freed}, hero removed from the host world ${!!gone}`);

    // host leaves
    await host.close({ runBeforeUnload: true });
    const res = await MP.waitFor(j1, () => { const st = MPT.status() || {}, L = MPT.lobby() || {}; const e = st.error && (st.error.code || st.error) || L.error; return e ? { e, title: MPT.text('#mp-error-screen') } : (MPT.vis('#mp-error-screen') ? { e: null, title: MPT.text('#mp-error-screen') } : null); }, null, 12000);
    chk('G9a', rows.hostLeft, res && (res.e === 'host-left' || /HOST LEFT/i.test(res.title || '')), 'joiner saw ' + JSON.stringify(res));
  });

  // ---- session B: latency 80±20, 5 % loss
  await withSession({ ...H, players: 2, bus: MP.bus({ mode: 'realtime', latency: 80, jitter: 20, loss: 0.05, seed: 5 }) }, async s => {
    const [host, j1] = [s.host, s.joiners[0]];
    try { await MP.startAll(s, { heroes: [0, 2] }); } catch (e) { C.fail('G9a', rows.taps, 'could not start: ' + e.message); C.skip('G9a', rows.kf, 'session did not start'); return; }
    await MP.waitFor(j1, () => { const w = MPT.world(); return w && w.players[1] ? true : null; }, null, 5000);
    for (const pg of [host, j1]) await MP.blurInputs(pg);
    await host.evaluate(() => { __mpApi.calls.presses = {}; });
    for (let i = 0; i < 200; i++) { await MP.press(j1, 'attack', { ms: 8 }); await sleep(8); }
    await sleep(1500);
    const pr = await host.evaluate(() => __mpApi.calls.presses), n = pr['1:KeyJ'] || 0;
    await MP.hold(j1, 'right', true); await sleep(800); await MP.hold(j1, 'right', false); await sleep(1500);
    const hx = await settleX(host, 1), jx = await settleX(j1, 1), h0 = await settleX(j1, 0), hh0 = await settleX(host, 0);
    chk('G9a', rows.taps, n === 200 && Math.abs(hx - jx) <= 1 && Math.abs(h0 - hh0) <= 1, `host received ${n}/200 KeyJ presses from 2P (calls ${JSON.stringify(pr)}); 2P host ${hx} joiner ${jx}; 1P host ${hh0} joiner ${h0}`);

    // Forced baseline loss: snapshots to the joiner stop while the host moves, and the joiner loses its decoded
    // history (every baseline the host may still delta against). The next delta names a base the joiner does not have:
    // it must send kf, the host must answer with a keyframe (b = -1) at once, not at the next 2 s periodic keyframe,
    // and the joiner must catch up.
    s.bus.set({ loss: 0, jitter: 0, latency: 20 });
    const stop = s.bus.filter(m => m.channel === 'st' && m.t === 's');
    await MP.hold(host, 'right', true); await sleep(500); await MP.hold(host, 'right', false);
    const cleared = await j1.evaluate(() => { const s2 = window.EDEN_NET && EDEN_NET.session; if (!s2 || !(s2.history instanceof Map)) return false; s2.history.clear(); return true; });
    const tClear = s.bus.now, kf0 = s.bus.stats(); const k0 = kf0.keyframes, q0 = kf0.kfRequests;
    const tOpen = s.bus.now; stop();
    const hxs = await settleX(host, 0);
    const back = await MP.waitFor(j1, ({ hx }) => { const p = MPT.world().players[0]; return p && Math.abs(p.x - hx) <= 1 ? true : null; }, { hx: hxs }, 3000);
    const kf1 = s.bus.stats(), after = s.bus.log(e => e.at >= tClear);
    const req = after.find(e => e.t === 'kf' && !e.dropped), key = req && after.find(e => e.t === 's' && e.b === -1 && e.at >= req.at && !e.dropped);
    const answerMs = req && key ? Math.round(key.at - req.at) : null;
    chk('G9a', rows.kf, cleared && !!back && kf1.kfRequests > q0 && kf1.keyframes > k0 && answerMs != null && answerMs <= 500,
      `history cleared ${cleared}; joiner caught up ${!!back}; kf requests ${q0}->${kf1.kfRequests} (first ${req ? Math.round(req.at - tOpen) + ' ms after the outage' : 'none'}), keyframes ${k0}->${kf1.keyframes}, keyframe ${answerMs} ms after the request`);
  });

  // ---- session C: error paths
  await withSession({ ...H, players: 2 }, async s => {
    const [host, j1] = [s.host, s.joiners[0]];
    const code = await MP.hostRoom(host, { hero: 0 });
    let t = Date.now(); const rb = await MP.joinRoom(j1, code.slice(0, 5) + (code.slice(5) === '2222' ? '3333' : '2222'), { timeout: 5000 }); const ms = Date.now() - t;
    chk('G9a', rows.bad, rb.slot == null && (rb.error === 'bad-code' || /NO GAME/i.test(rb.title || '')) && ms <= 2500, `${JSON.stringify(rb)} after ${ms} ms`);
    if (lobby) {
      await j1.reload(); await MP.installMPT(j1);
      // an excluded character keeps JOIN disabled
      await MP.openLobby(j1); if (await MP.visible(j1, '#mp-join')) await j1.click('#mp-join');
      await j1.fill('#mp-code-input', 'DINO-0OIL');
      const dis = await j1.evaluate(() => document.querySelector('#mp-join-go').disabled);
      chk('G9a', 'join code with 0/O/1/I/L keeps JOIN disabled', dis === true, 'JOIN disabled: ' + dis);
      await j1.reload(); await MP.installMPT(j1);
    }
    await j1.evaluate(() => { const A2 = MPT.adapter(); try { Object.defineProperty(A2, 'build', { value: 'mismatch-0000', configurable: true, writable: true }); } catch (e) { A2.build = 'mismatch-0000'; } });
    const rv = await MP.joinRoom(j1, code, { timeout: 6000 });
    chk('G9a', rows.build, rv.slot == null && (rv.error === 'build' || /DIFFERENT VERSIONS/i.test(rv.title || '')), JSON.stringify(rv));
    await j1.reload(); await MP.installMPT(j1);
    // a client of another protocol version: its hello says v 2
    await C.gated('G9a', rows.version, await j1.evaluate(() => !!(window.EDEN_NET && EDEN_NET.Wire && EDEN_NET.Wire.prototype.send)), 'EDEN_NET.Wire.prototype.send missing', async () => {
      await j1.evaluate(() => { const W = EDEN_NET.Wire.prototype, f = W.send; W.send = function (m, ch) { return f.call(this, m && m.t === 'hello' ? { ...m, v: (EDEN_NET.PROTOCOL || 1) + 1 } : m, ch); }; });
      const rp = await MP.joinRoom(j1, code, { timeout: 6000 }), st = await MP.net(j1);
      return rp.slot == null && (rp.error === 'version' || errCode(st) === 'version') ? true : `join gave ${JSON.stringify(rp)}, status error ${JSON.stringify(st && st.error)}`;
    });
    await j1.reload(); await MP.installMPT(j1);
    s.bus.block('ice', true);
    t = Date.now(); const ri = await MP.joinRoom(j1, code, { timeout: 16000 }); const ims = Date.now() - t;
    const consumed = (s.bus.stats().consumed.ice || 0) > 0;
    s.bus.block('ice', false);
    if (!consumed) C.fail('G9a', rows.ice, `the join never sent a loopback '_' connect through the bus (join gave ${JSON.stringify(ri)})`);
    else {
      const text = await j1.evaluate(() => (window.EDEN_NET.errors['ice-failed'] || {}).text || '');
      chk('G9a', rows.ice, ri.slot == null && (ri.error === 'ice-failed' || /CAN'T CONNECT/i.test(ri.title || '')) && /relay/i.test(text), `${JSON.stringify(ri)} after ${ims} ms`);
    }
  });

  // ---- session D: host-side timeout (fake clock), reconnect by cid held against another joiner, joiner-side timeout
  await withSession({ ...H, players: 3 }, async s => {
    const [host, j1, j2] = [s.host, ...s.joiners];
    const hasClock = await host.evaluate(() => !!(window.EDEN_NET && EDEN_NET._test && typeof EDEN_NET._test.setClock === 'function'));
    const code = await MP.hostRoom(host, { hero: 0 });
    const r1 = await MP.joinRoom(j1, code, { hero: 3 });
    let timedOut = false;
    await C.gated('G9a', rows.timeout, hasClock && r1.slot === 1, hasClock ? 'join failed: ' + JSON.stringify(r1) : 'EDEN_NET._test.setClock missing (§5.1)', async () => {
      for (const id of s.bus.idsOf(j1)) s.bus.cut(id, { silent: true });
      await host.evaluate(() => { window.__mpOff = 0; EDEN_NET._test.setClock(() => performance.now() + window.__mpOff); });
      await host.evaluate(() => { window.__mpOff = 3500; });
      const away = await MP.waitFor(host, () => { const e = ((MPT.status() || {}).roster || []).find(x => x && x.slot === 1); return e && (e.state === 'away' || e.ping === '!') ? e : null; }, null, 1500);
      const warn = await roster(host);
      await host.evaluate(() => { window.__mpOff = 11000; });
      const freed = await MP.waitFor(host, () => { const r = ((MPT.status() || {}).roster || []).filter(Boolean); return !r.some(x => x.slot === 1) ? true : null; }, null, 4000);
      timedOut = !!freed;
      const w = warn.find(x => x.slot === 1) || {};
      if (!away) return `3.5 s after its last message slot 1 is not marked away (roster entry ${JSON.stringify(w)})`;
      return freed ? true : `slot 1 still in the roster 11 s after its last message (at 3.5 s it read ${JSON.stringify(w)})`;
    });
    // slot 1 is now reserved for j1's cid: a new joiner must not get it, and j1's reload must get it back
    await C.gated('G9a', rows.cid, r1.slot === 1 && timedOut, r1.slot !== 1 ? 'join failed' : 'the timeout row did not free slot 1', async () => {
      for (const id of s.bus.idsOf(j1)) s.bus.uncut(id);
      const rj2 = await MP.joinRoom(j2, code, { hero: 1 });
      const cid0 = await j1.evaluate(() => Object.keys(sessionStorage).map(k => k + '=' + sessionStorage.getItem(k)).join(';'));
      await j1.reload(); await MP.installMPT(j1);
      const r2 = await MP.joinRoom(j1, code, { hero: 3 });
      if (rj2.slot === 1) return `another joiner took the reserved slot 1 (${JSON.stringify(rj2)})`;
      if (rj2.slot !== 2) return `the other joiner got ${JSON.stringify(rj2)}, expected slot 2`;
      return r2.slot === 1 ? true : `rejoined in slot ${r2.slot} (${r2.error || ''}); sessionStorage ${cid0.slice(0, 120)}`;
    });
    // joiner side: the host goes silent for j2 (its links are cut without a notice); j2's own clock runs ahead
    const j2in = await roster(j2);
    await C.gated('G9a', rows.jtimeout, hasClock && j2in.some(r => r.slot === 2), hasClock ? 'j2 is not in the room: ' + JSON.stringify(j2in) : 'EDEN_NET._test.setClock missing', async () => {
      for (const id of s.bus.idsOf(j2)) s.bus.cut(id, { silent: true });
      await j2.evaluate(() => { window.__mpOff = 0; EDEN_NET._test.setClock(() => performance.now() + window.__mpOff); window.__mpOff = 3500; });
      const warn = await MP.waitFor(j2, () => { const st = MPT.status() || {}; return st.warn ? true : null; }, null, 1500);
      await j2.evaluate(() => { window.__mpOff = 11000; });
      const end = await MP.waitFor(j2, () => { const st = MPT.status() || {}, L = MPT.lobby() || {}; const e = st.error && (st.error.code || st.error) || L.error; return e ? { e, title: MPT.text('#mp-error-screen') } : null; }, null, 4000);
      for (const id of s.bus.idsOf(j2)) s.bus.uncut(id);
      if (!warn) return 'no warn in EDEN_NET.status() 3.5 s after the last host message';
      return end && end.e === 'timeout' ? true : `after 11 s of silence the joiner shows ${JSON.stringify(end)}`;
    });
  });

  // ---- session E: drop-in only when canAdmit()
  await withSession({ ...H, players: 2 }, async s => {
    const [host, j1] = [s.host, s.joiners[0]];
    const code = await MP.hostRoom(host, { hero: 0 });
    await MP.start(host);
    await MP.waitFor(host, () => MPT.world().state === 'play' ? true : null, null, 4000);
    await host.evaluate(() => { const A2 = MPT.adapter(), f = A2.canAdmit; window.__admit = false; A2.canAdmit = function () { return !!window.__admit && (typeof f === 'function' ? f.call(A2) : true); }; });
    const r = await MP.joinRoom(j1, code, { hero: 2 });
    await MP.joinIn(j1);
    const asked = await MP.waitFor(host, () => { const e = ((MPT.status() || {}).roster || []).find(x => x && x.slot === 1); return e && e.state === 'waiting' && e.ready ? e : null; }, null, 1500);
    if (lobby) {
      const st = await host.evaluate(() => ((MPT.status() || {}).roster || []).find(x => x && x.slot === 1) || null), ls = await MP.lobbyStatus(j1);
      chk('G9a', 'drop-in: the late joiner\'s JOIN IN reaches the host (state waiting + ready)', !!asked,
        `host roster 2P ${JSON.stringify(st)}; joiner lobby dropIn=${ls && ls.dropIn} ready=${ls && ls.ready}, JOIN IN ${JSON.stringify(await j1.evaluate(() => { const b = document.querySelector('#mp-joinin'); return b && { text: b.textContent, disabled: b.disabled }; }))}`);
    }
    if (!asked) await j1.evaluate(() => { const s2 = window.EDEN_NET && EDEN_NET.session; if (s2 && s2.joinIn) s2.joinIn(2); });   // ask through the session API so the canAdmit row still runs
    await sleep(1500);
    const early = await MP.snap(host), calls0 = await host.evaluate(() => __mpApi.calls.addPlayer.length);
    await host.evaluate(() => { window.__admit = true; });
    const ok = await MP.waitFor(host, () => MPT.world().players[1] ? true : null, null, 3000);
    const calls = await host.evaluate(() => __mpApi.calls.addPlayer);
    const rep = await MP.waitFor(j1, () => { const w = MPT.world(); return w && (w.role === 'client' || w.role === 'replica') && w.players[1] ? true : null; }, null, 4000);
    chk('G9a', rows.dropIn, r.slot === 1 && !early.players[1] && calls0 === 0 && !!ok && calls.length >= 1 && calls.every(c => c.canAdmit !== false) && !!rep,
      `join ${JSON.stringify(r)}; before canAdmit: hero present ${!!early.players[1]}, addPlayer calls ${calls0}; after: present ${!!ok}, calls ${JSON.stringify(calls)}, joiner in replica ${!!rep}`);
  });

  // ---- session F: a hostile joiner (j2) in a running 3-player game
  await withSession({ ...H, players: 3 }, async s => {
    const [host, j1, j2] = [s.host, ...s.joiners];
    const NAME = '<img src=x onerror="window.__pwned=1">';
    let code;
    try {
      code = await MP.hostRoom(host, { hero: 0 });
      const a = await MP.joinRoom(j1, code, { hero: 1 }), b = await MP.joinRoom(j2, code, { hero: 2, name: NAME });
      if (a.slot !== 1 || b.slot !== 2) throw new Error(`joins gave ${JSON.stringify(a)} ${JSON.stringify(b)}`);
      await MP.ready(j1, true); await MP.ready(j2, true); await MP.start(host);
      if (!await MP.waitFor(j1, () => { const w = MPT.world(); return w && (w.role === 'client' || w.role === 'replica') && w.players.filter(Boolean).length === 3 ? true : null; }, null, 6000)) throw new Error('the game did not start on 2P');
    } catch (e) { C.fail('G9a', rows.hostile, 'could not set up: ' + e.message); return; }
    for (const pg of [host, j1, j2]) await MP.blurInputs(pg);
    await sleep(500);
    const hostId = await host.evaluate(c => EDEN_NET.code.peerId(c), code);
    const j1Id = s.bus.idsOf(j1).find(id => s.bus.peers().some(p => p.id === id && p.talked.includes(hostId)));
    const j2Id = s.bus.idsOf(j2).find(id => s.bus.peers().some(p => p.id === id && p.talked.includes(hostId)));
    const errs0 = s.errors.length, forged0 = s.bus.stats().forged || 0;
    const before = await MP.snap(host), heroes0 = (await roster(host)).map(r => [r.slot, r.hero]);
    // through j2's own Wire: every message type the host accepts, with out-of-range or wrong-typed fields, plus types
    // only a host may send
    const sent = await j2.evaluate(() => {
      const s2 = EDEN_NET.session, w = s2 && s2.wire; if (!w) return 'no joiner wire';
      const big = Array(10).fill(255), list = [
        { t: 'hero', hero: 99 }, { t: 'hero', hero: -3 }, { t: 'hero', hero: '1' }, { t: 'hero', hero: 0 }, { t: 'ready', on: { x: 1 } },
        { t: 'i', s: 2 ** 40, a: -1, b: 1023, c: big, d: 255, k: 1, f: 0 }, { t: 'i', s: 'x', c: 'nope' }, { t: 'i', s: 3, c: Array(10).fill(99999) },
        { t: 'kf', base: 'zz' }, { t: 'kf', base: 1e12 }, { t: 'ping', c: 'x' }, { t: 'ping' }, { t: 'start' }, { t: 's', n: 1, b: -1, d: {} },
        { t: 'event', list: [['notice', '<img src=x onerror="window.__pwned=2">']] }, { t: 'frag', id: 1, i: 0, n: 99999, d: 'x' },
        { t: 'hello', v: 1, cid: 'someone-else', name: '<b>x</b>', hero: 1 }, { t: 'leave', reason: { r: 1 } },
      ];
      let n = 0; for (const m of list) { if (m.t === 'leave') continue; try { w.send(m, m.t === 'i' ? 'st' : 'ctl'); n++; } catch (e) { /* the sender may refuse */ } }
      return n;
    });
    // raw texts straight onto j2's own link, then input frames forged under 2P's peer id (a DataChannel cannot do this:
    // the bus must drop them and the host must not move 2P)
    await j2.evaluate(({ me, to }) => { for (const t of ['{{{', 'null', '[]', '"str"', '{"t":1}', '{"t":"i","s":1e400}', 'x'.repeat(15000)]) window.__MP_BUS.send(me, to, 'ctl', t); }, { me: j2Id, to: hostId });
    await j2.evaluate(({ as, to }) => { const sm = new EDEN_NET.input.Sampler(); sm.keyDown('ArrowRight', performance.now()); for (let i = 0; i < 30; i++) { const f = sm.frame(); f.s = 1e6 + i; window.__MP_BUS.send(as, to, 'st', JSON.stringify(f)); } }, { as: j1Id, to: hostId });
    await sleep(1500);
    const after = await MP.snap(host), heroes1 = (await roster(host)).map(r => [r.slot, r.hero]), st1 = await MP.net(j1);
    const hostErrs = s.errors.slice(errs0).filter(e => e.startsWith('host:')), forged = (s.bus.stats().forged || 0) - forged0;
    const pwned = []; for (const [n, pg] of [['host', host], ['2P', j1], ['3P', j2]]) if (await pg.evaluate(() => window.__pwned !== undefined || !!document.querySelector('img[src="x"]'))) pwned.push(n);
    const dx1 = after && before && after.players[1] && before.players[1] ? after.players[1].x - before.players[1].x : NaN;
    const okHeroes = JSON.stringify(heroes1.filter(([sl]) => sl !== 2)) === JSON.stringify(heroes0.filter(([sl]) => sl !== 2)) && heroes1.every(([, h]) => h >= 0 && h <= 3) && new Set(heroes1.map(([, h]) => h)).size === heroes1.length;
    chk('G9a', rows.hostile, !hostErrs.length && after && after.state === before.state && Math.abs(dx1) < 0.5 && forged >= 30 && !pwned.length && okHeroes && !(st1 && st1.error),
      `${sent} bad messages through j2's wire + 7 raw texts; host page errors ${hostErrs.length ? hostErrs.slice(0, 2).join(' | ') : 0}; state ${before.state}->${after && after.state}; 2P dx ${dx1.toFixed(2)} after 30 forged frames (bus dropped ${forged} as forged); markup ran or rendered on ${pwned.join(',') || 'no page'}; roster ${JSON.stringify(heroes0)} -> ${JSON.stringify(heroes1)}; 2P status error ${JSON.stringify(st1 && st1.error)}`);
  });

  // ---- single-player harness page
  await withSession({ ...H, players: 1, query: { net: null } }, async s => {
    await sleep(800);
    const st = await s.host.evaluate(() => ({ session: !!(window.EDEN_NET && EDEN_NET.session), peer: typeof window.Peer !== 'undefined', status: MPT.status() }));
    const foreign = s.requests.filter(r => !r.url.startsWith(MP.urlOf('')) && !/^data:|^blob:/.test(r.url));
    chk('G9a', rows.sp, !st.session && !st.peer && !foreign.length, `session ${st.session}, Peer ${st.peer}, foreign requests ${foreign.map(r => r.url).join(', ')}`);
  });
}

// ================================================================ T2/T3: the integrated game (G9b)
async function tierGame(browser) {
  const why = 'game.js integration (G9b) has not landed: LAST_EDEN.mp is missing on index.html';
  const t2 = {
    off: 'single-player: role off, localSlot 0, snapshot.players lists only 1P', keys: 'single-player LAST_EDEN.snapshot keys unchanged (fixture)', trace: 'single-player trace identical to tests/fixtures/sp-trace.json',
    add: 'addPlayer: up to 3 players, each a different hero; a 4th is refused', input: 'scripted input moves only that slot\'s hero', camera: 'camera never scrolls a trailing player off the left edge',
    spread: 'enemies spread their targets over the players', boss: 'boss HP scales with the player count (2P ~x1.20, 3P ~x1.46)', remove: 'removePlayer frees the slot and enemies re-target',
  };
  const t3 = {
    start: 'index.html over loopback: host + 2 joiners start chapter 1 with three heroes', own: 'game: each joiner controls only its own hero', dup: 'game: no duplicate heroes on any page',
    match: 'game: joiners\' players and enemies match the host at equal sim time', dropIn: 'game: drop-in admitted only between encounters (canAdmit, no lock, no boss, not driving)',
    full: 'game: a 4th player is rejected with full', hostLeft: 'game: host leaving ends the session cleanly for the joiners (back to single-player)',
    decoded: 'game: joiners\' decoded snapshots equal the host\'s quantised snapshots (same n)',
    events: 'game: host hits produce particles on every joiner (events replayed)', bw: 'game: bandwidth within §1.11 on the real game, 3 players (input <= 6, down <= 32 / 64 peak, events <= 4, host up <= 100 KB/s)',
    clear: 'game: chapter clear puts every page in clear', card: 'game: 2P\'s attack advances the chapter card on the host', noErr: 'game: no pageerror on any page of the 3-player session',
  };
  const lazy = 'game: plain index.html never requests PeerJS';
  const skipAll = (reason, withLazy = false) => { if (withLazy && (tier('T2') || tier('T3'))) C.skip('G9b', lazy, reason); if (tier('T2')) for (const t of Object.values(t2)) C.skip('G9b', t, reason); if (tier('T3')) for (const t of Object.values(t3)) C.skip('G9b', t, reason); };
  // probe index.html once
  const ctx = await browser.newContext(); const page = await ctx.newPage(); const errors = [], requests = [];
  page.on('pageerror', e => errors.push('game: ' + e.message)); page.on('request', r => requests.push({ page: 'game', url: r.url() }));
  let p;
  try {
    await A.prepare(page, { seed: 9090, raf: true });
    await page.goto(MP.urlOf('index.html')); await A.waitReady(page, 60000); await MP.installMPT(page);
    p = await MP.probe(page);
  } catch (e) { await ctx.close(); skipAll('index.html did not load: ' + e.message, true); return; }
  // plain index.html (no ?net=, no lobby use) after load and a little play: runs before and after the integration
  if (tier('T2') || tier('T3')) {
    await page.evaluate(() => { LAST_EDEN.start(0, 0, 'normal'); for (let i = 0; i < 30; i++) LAST_EDEN.step(1 / 60); }).catch(() => {});
    await sleep(300);
    chk('G9b', lazy, !requests.some(r => NET_REQ.test(r.url)) && !p.peerLoaded && !(await page.evaluate(() => typeof window.Peer !== 'undefined')), requests.filter(r => NET_REQ.test(r.url)).map(r => r.url).join(', ') || 'no PeerJS/CDN request, window.Peer undefined');
  }
  if (!p.mp) { await ctx.close(); skipAll(why); return; }

  if (tier('T2')) {
    const fx = fs.existsSync(SP_FIXTURE) ? JSON.parse(fs.readFileSync(SP_FIXTURE, 'utf8')) : null;
    const off = await page.evaluate(() => { const g = LAST_EDEN; g.start(0, 1, 'normal'); for (let i = 0; i < 30; i++) g.step(1 / 60); const S2 = g.snapshot; return { role: g.mp.role(), local: S2.localSlot, players: (S2.players || []).map(x => x ? x.hero : null), net: S2.net, hero: S2.player && S2.player.hero }; }).catch(e => ({ threw: e.message }));
    chk('G9b', t2.off, off.role === 'off' && (off.local === 0 || off.local == null) && off.players.filter(x => x != null).length === 1 && off.net == null, JSON.stringify(off));
    await C.gated('G9b', t2.keys, !!(fx && fx.keys), 'no tests/fixtures/sp-trace.json keys: run `node tests/multiplayer.cjs --record-sp` on the pre-G9b game.js', async () => {
      const keys = await page.evaluate(() => Object.keys(LAST_EDEN.snapshot));
      const missing = fx.keys.filter(k => !keys.includes(k)), extra = keys.filter(k => !fx.keys.includes(k) && !['players', 'localSlot', 'net', 'time'].includes(k));
      return !missing.length && !extra.length ? true : `missing ${missing.join(',')} extra ${extra.join(',')}`;
    });
    await C.gated('G9b', t2.trace, !!(fx && fx.traces), 'no tests/fixtures/sp-trace.json: run `node tests/multiplayer.cjs --record-sp` on the pre-G9b game.js', async () => {
      const now = await recordTrace(browser, fx.seed, fx.steps, fx.every);
      const bad = [];
      for (const [ch, hs] of Object.entries(fx.traces)) { const got = now.traces[ch] || []; const i = hs.findIndex((h, k) => h !== got[k]); if (i >= 0) bad.push(`chapter ${+ch + 1}: first difference at step ${(i + 1) * fx.every} (${hs[i]} vs ${got[i]})`); }
      return bad.length ? bad.join('; ') : true;
    });
    const mp = (fn, arg) => page.evaluate(fn, arg);
    await C.gated('G9b', t2.add, true, '', () => mp(() => {
      const g = LAST_EDEN; g.start(0, 0, 'normal'); for (let i = 0; i < 10; i++) g.step(1 / 60);
      g.mp.addPlayer(1, 1, { dropIn: false }); g.mp.addPlayer(2, 1, { dropIn: false });   // 3P asks for 2P's hero
      for (let i = 0; i < 60; i++) g.step(1 / 60);
      let fourth = 'accepted'; try { const r = g.mp.addPlayer(3, 3); if (r === false || r == null || !g.mp.players()[3]) fourth = 'refused'; } catch (e) { fourth = 'refused'; }
      const ps = g.mp.players().filter(Boolean), heroes = ps.map(q => q.hero);
      return ps.length === 3 && new Set(heroes).size === 3 && fourth === 'refused' ? true : `players ${JSON.stringify(heroes)}, 4th ${fourth}`;
    }));
    await C.gated('G9b', t2.input, true, '', () => mp(() => {
      const g = LAST_EDEN, x0 = g.mp.players().map(q => q && q.x);
      g.mp.input(1, { held: ['ArrowRight'] }); for (let i = 0; i < 40; i++) g.step(1 / 60); g.mp.input(1, { held: [] }); for (let i = 0; i < 10; i++) g.step(1 / 60);
      const x1 = g.mp.players().map(q => q && q.x), d = x1.map((x, i) => x - x0[i]);
      return d[1] > 5 && Math.abs(d[0]) < 0.5 && Math.abs(d[2]) < 0.5 ? true : 'dx per slot ' + d.map(v => v && v.toFixed(2));
    }));
    await C.gated('G9b', t2.camera, true, '', () => mp(() => {
      const g = LAST_EDEN; let worst = 99, cam0 = g.snapshot.camera;
      g.mp.input(0, { held: ['ArrowLeft'] }); for (let i = 0; i < 90; i++) g.step(1 / 60); g.mp.input(0, { held: [] });
      g.mp.input(1, { held: ['ArrowRight', 'ShiftLeft'] });
      for (let i = 0; i < 300; i++) { g.step(1 / 60); const cam = g.snapshot.camera; for (const q of g.mp.players()) if (q) worst = Math.min(worst, q.x - cam); }
      g.mp.input(1, { held: [] });
      return worst >= 15 ? true : `a hero stood ${worst.toFixed(1)} px from the left edge (camera ${cam0} -> ${g.snapshot.camera})`;
    }));
    await C.gated('G9b', t2.spread, (await mp(() => typeof LAST_EDEN.mp.targetOf)) === 'function', 'LAST_EDEN.mp.targetOf missing (§3.17)', () => mp(() => {
      const g = LAST_EDEN, cam = g.snapshot.camera, M = g.snapshot.band.mid;
      g.test.move(cam + 60, M); g.mp.input(0, { held: [] });
      const ps = g.mp.players(); void ps;
      for (let k = 0; k < 4; k++) g.test.spawnEnemy(cam + 150 + k * 20, M + (k % 2 ? 10 : -10), 'brute', false);
      for (let i = 0; i < 180; i++) g.step(1 / 60);
      const t = new Set(); g.snapshot.enemies.forEach((e, i) => { const s2 = g.mp.targetOf(i); if (s2 != null && !e.dead) t.add(s2); });
      return t.size >= 2 ? true : 'all enemies target slot(s) ' + [...t];
    }));
    await C.gated('G9b', t2.boss, true, '', () => mp(() => {
      const g = LAST_EDEN, type = window.BOSS_DEFS ? Object.keys(BOSS_DEFS)[0] : null; if (!type) return 'no BOSS_DEFS';
      const hpWith = n => { g.start(0, 0, 'normal'); g.step(1 / 60); for (let s2 = 1; s2 < n; s2++) g.mp.addPlayer(s2, s2, { dropIn: false }); const cam = g.snapshot.camera; const e = g.test.spawnEnemy(cam + 200, g.snapshot.band.mid, type, true); return e.maxhp || e.hp; };
      const h1 = hpWith(1), h2 = hpWith(2), h3 = hpWith(3), r2 = h2 / h1, r3 = h3 / h1;
      g.start(0, 0, 'normal');
      return r2 >= 1.05 && r2 <= 1.6 && r3 > r2 && r3 <= 2.1 ? true : `${type}: 1P ${h1}, 2P ${h2} (x${r2.toFixed(2)}), 3P ${h3} (x${r3.toFixed(2)})`;
    }));
    await C.gated('G9b', t2.remove, true, '', () => mp(() => {
      const g = LAST_EDEN; g.start(0, 0, 'normal'); g.step(1 / 60); g.mp.addPlayer(1, 1, { dropIn: false }); g.mp.addPlayer(2, 2, { dropIn: false });
      const cam = g.snapshot.camera, M = g.snapshot.band.mid; for (let k = 0; k < 3; k++) g.test.spawnEnemy(cam + 250 + k * 10, M, 'brute', false);
      for (let i = 0; i < 120; i++) g.step(1 / 60);
      g.mp.removePlayer(2); for (let i = 0; i < 120; i++) g.step(1 / 60);
      const t = g.snapshot.enemies.map((e, i) => g.mp.targetOf(i));
      return !g.mp.players()[2] && !t.includes(2) ? true : `slot 2 ${JSON.stringify(g.mp.players()[2])}, targets ${t}`;
    }));
  }
  allErrors.push(...errors); allRequests.push(...requests);
  await ctx.close();

  if (!tier('T3')) return;
  // T3: 3 pages of index.html over the bus
  await withSession({ page: 'game', players: 3 }, async s => {
    const [host, j1, j2] = [s.host, ...s.joiners];
    const later = rows => { for (const t of rows) C.fail('G9b', t, 'not reached: the session did not start'); };
    try { await MP.startAll(s, { heroes: [0, 1, 2] }); } catch (e) { C.fail('G9b', t3.start, e.message); later([t3.dup, t3.own, t3.match, t3.decoded, t3.events, t3.bw, t3.full, t3.clear, t3.card, t3.hostLeft]); return; }
    const okHost = await MP.waitFor(host, () => MPT.world().state === 'play' ? true : null, null, 8000);
    const okJ = []; for (const j of [j1, j2]) okJ.push(await MP.waitFor(j, () => { const w = MPT.world(); return w.role === 'client' && w.players.filter(Boolean).length === 3 ? true : null; }, null, 8000));
    chk('G9b', t3.start, !!okHost && okJ.every(Boolean), `host play ${!!okHost}, joiners ${okJ}`);
    for (const pg of [host, j1, j2]) await MP.blurInputs(pg);
    const heroSets = []; for (const pg of [host, j1, j2]) heroSets.push(playersOf(await MP.snap(pg)).map(q => q.hero));
    chk('G9b', t3.dup, heroSets.every(h => h.length === 3 && new Set(h).size === 3 && JSON.stringify(h) === JSON.stringify(heroSets[0])), JSON.stringify(heroSets));
    const b = await MP.snap(host);
    await MP.hold(j1, 'right', true); await sleep(500); await MP.hold(j1, 'right', false); await sleep(500);
    const a = await MP.snap(host); const d = [0, 1, 2].map(k => a.players[k] && b.players[k] ? a.players[k].x - b.players[k].x : NaN);
    chk('G9b', t3.own, d[1] > 5 && Math.abs(d[0]) < 0.5 && Math.abs(d[2]) < 0.5, 'host dx per slot ' + d.map(v => v.toFixed(2)));

    // equal sim time: the joiner's rendered world against the host's serialized states that bracket its render time
    // (interpolated like the joiner does, bullets left out); and the decoded snapshots against the host's, exactly
    const mode = await host.evaluate(() => MPT.record(true)); await sleep(1500);
    const cs = await MP.snap(j2), rec = await host.evaluate(() => MPT.recorded());
    await host.evaluate(() => MPT.record(false));
    const r = MP.sameWorldTimed(rec, cs, { tol: 1.5 });
    chk('G9b', t3.match, r.ok && r.compared >= 3, `host records by ${mode} (${rec.length}), bracket ${r.at}, joiner t ${cs && cs.time}; compared ${r.compared}: ${r.diffs.slice(0, 4).join('; ')}`);
    { const d1 = await MP.decodedMatch(host, j1), d2 = await MP.decodedMatch(host, j2); chk('G9b', t3.decoded, d1.ok && d2.ok && d1.compared >= 5 && d2.compared >= 5, `2P compared ${d1.compared} (${d1.diffs.slice(0, 2).join('; ')}), 3P compared ${d2.compared} (${d2.diffs.slice(0, 2).join('; ')})`); }

    // events: an enemy next to 1P is hit three times on the host; every joiner must replay particle events and show
    // particles near the hit
    {
      const foe = await host.evaluate(() => { const g = LAST_EDEN, S = g.snapshot, p = (S.players && S.players[0]) || S.player; const e = g.test.spawnEnemy(p.x + 70, p.y, 'brute', false); window.__mpFoe = e; return { nid: e.nid, x: e.x, y: e.y }; }).catch(e => ({ err: e.message }));
      const watch = [];
      for (const j of [j1, j2]) watch.push(await j.evaluate(() => {
        window.__mpFx = []; const A = MPT.adapter();
        if (!A || typeof A.fireEvent !== 'function') return 'poll';
        if (!A.__mpFx) {
          A.__mpFx = true; const f = A.fireEvent;
          A.fireEvent = function (ev) {
            const r2 = f.apply(this, arguments);
            try {
              const k = String(Array.isArray(ev) ? ev[0] : ev && (ev.k || ev.type || ev.t));
              if (/burst|blood|expl|spark/.test(k)) { const P = LAST_EDEN.snapshot.particles || []; window.__mpFx.push({ k, n: P.length }); }
            } catch (e) { /* never break the replica */ }
            return r2;
          };
        }
        return 'fireEvent';
      }));
      await sleep(400);
      s.bus.resetStats();
      const hits = await host.evaluate(async nid => {
        const g = LAST_EDEN; let n = 0;
        for (let k = 0; k < 3; k++) { const i = g.snapshot.enemies.findIndex(e => e.nid === nid); if (i < 0) break; if (window.__mpFoe) window.__mpFoe.inv = 0; g.test.damageEnemy(i, 1); n++; await new Promise(r2 => setTimeout(r2, 160)); }
        return n;
      }, foe.nid).catch(e => 'threw ' + e.message);
      const seen = [];
      for (const [i, j] of [j1, j2].entries()) {
        if (watch[i] === 'fireEvent') seen.push(await MP.waitFor(j, () => { const L = window.__mpFx || []; return L.some(x => x.n > 0) ? L.length : null; }, null, 2000, 30));
        else seen.push(await MP.waitFor(j, () => { const P = LAST_EDEN.snapshot.particles || []; return P.length > 0 ? 'particles ' + P.length : null; }, null, 2000, 20));
      }
      const st = s.bus.stats(), hostIds = new Set(s.bus.idsOf(host));
      const evMsgs = Object.entries(st.links).filter(([k]) => hostIds.has(k.split('>')[0])).map(([k, L]) => [k.split('>')[1], (L.types.event || {}).msgs || 0]);
      chk('G9b', t3.events, typeof hits === 'number' && hits >= 1 && seen.every(Boolean) && evMsgs.length >= 2 && evMsgs.every(([, n]) => n >= 1),
        `foe ${JSON.stringify(foe)}, ${hits} hit(s) on the host; joiners watched by ${watch.join('/')}, particle events with particles shown: ${JSON.stringify(seen)}; event messages per joiner ${JSON.stringify(evMsgs)}`);
    }

    // bandwidth on the real game: all three move and attack for ~5 s next to the foe
    {
      s.bus.resetStats();
      for (let i = 0; i < 5; i++) {
        const dirA = i % 2 ? 'left' : 'right', dirB = i % 2 ? 'up' : 'down';
        await MP.hold(j1, dirA, true); await MP.hold(j2, dirB, true); await MP.hold(host, dirA, true);
        await sleep(450);
        await MP.hold(j1, dirA, false); await MP.hold(j2, dirB, false); await MP.hold(host, dirA, false);
        await MP.press(j1, 'attack'); await MP.press(j2, 'attack'); await MP.press(host, 'attack');
        await sleep(450);
      }
      const bb = budget(s, host, { joiners: 2 });
      chk('G9b', t3.bw, bb.ok, bb.detail);
    }

    const j3 = await s.open('j3'); const code = (await MP.net(host)).code;
    const r3 = await MP.joinRoom(j3, code, { timeout: 6000 }); const st3 = await MP.net(j3);
    chk('G9b', t3.full, r3.slot == null && (r3.error === 'full' || errCode(st3) === 'full' || /FULL/i.test(r3.title || '')), JSON.stringify(r3));
    await j3.close();

    // chapter clear on the host -> every page in 'clear'
    await host.evaluate(() => LAST_EDEN.test.clear()).catch(() => {});
    const cl = []; for (const pg of [host, j1, j2]) cl.push(await MP.waitFor(pg, () => MPT.world().state === 'clear' ? true : null, null, 4000) || await pg.evaluate(() => MPT.world().state));
    chk('G9b', t3.clear, cl.every(v => v === true), `host / 2P / 3P: ${JSON.stringify(cl)}`);

    // NEXT CHAPTER on the host -> the chapter card; 2P's attack (twice: finish the typing, then move on) advances it
    // long before the card's own hold (typing + 90 frames) could
    {
      if (await MP.visible(host, '#next')) await host.click('#next').catch(() => {}); else await host.evaluate(() => { const bt = document.querySelector('#next'); if (bt) bt.click(); });
      const card0 = await MP.waitFor(host, () => { const S = LAST_EDEN.snapshot; return S.state === 'brief' && S.card ? { phase: S.card.phase, k: S.card.k, t: S.card.t } : null; }, null, 5000, 20);
      const tBrief = Date.now();
      await host.evaluate(() => { if (window.__mpApi) __mpApi.calls.presses = {}; });
      await MP.blurInputs(j1);
      await MP.press(j1, 'attack', { ms: 40 }); await sleep(120); await MP.press(j1, 'attack', { ms: 40 });
      const moved = card0 && await MP.waitFor(host, c => { const S = LAST_EDEN.snapshot; return S.state !== 'brief' || !S.card || S.card.phase !== c.phase || S.card.k !== c.k ? { state: S.state, card: S.card && { phase: S.card.phase, k: S.card.k } } : null; }, card0, 1500, 20);
      const ms = Date.now() - tBrief;
      const pr = await host.evaluate(() => window.__mpApi ? __mpApi.calls.presses : null);
      chk('G9b', t3.card, !!card0 && !!moved && ms < 1400 && (!pr || (pr['1:KeyJ'] || 0) >= 1),
        `card on the host ${JSON.stringify(card0)} -> ${JSON.stringify(moved)} ${ms} ms after it opened (the card holds >= 1.5 s by itself); host received ${JSON.stringify(pr)}`);
    }

    const sessErrors = s.errors.slice();
    chk('G9b', t3.noErr, !sessErrors.length, sessErrors.slice(0, 3).join(' | ') || 'none');
    await host.close({ runBeforeUnload: true });
    const res = [];
    for (const j of [j1, j2]) res.push(await MP.waitFor(j, () => { const st = MPT.status() || {}, L = MPT.lobby() || {}; const e = st.error && (st.error.code || st.error) || L.error; const off = LAST_EDEN.mp.role() === 'off'; return (e === 'host-left' || /HOST LEFT/i.test(MPT.text('#mp-error-screen') || '')) && off ? { e, off } : null; }, null, 12000));
    chk('G9b', t3.hostLeft, res.every(Boolean), JSON.stringify(res));
  });

  // drop-in: the late joiner asks while an encounter is locked; it must wait, and be admitted once the fight is over
  await withSession({ page: 'game', players: 2 }, async s => {
    const [host, j1] = [s.host, s.joiners[0]];
    const code = await MP.hostRoom(host, { hero: 0 }); await MP.start(host);
    await MP.waitFor(host, () => MPT.world().state === 'play' ? true : null, null, 8000);
    const k = await host.evaluate(() => { const g = LAST_EDEN, E = g.snapshot.plan.encounters, i = E.findIndex(e => !e.boss); if (i < 0) return -1; g.test.skipTo(i); return i; });
    const locked = k >= 0 && await MP.waitFor(host, () => { const S = LAST_EDEN.snapshot; return S.lock ? { lock: S.lock, encounter: S.encounter } : null; }, null, 4000, 30);
    await MP.joinRoom(j1, code, { hero: 3 });
    await MP.joinIn(j1);
    await sleep(2500);
    const during = await host.evaluate(() => ({ present: !!LAST_EDEN.mp.players()[1], lock: !!LAST_EDEN.snapshot.lock, calls: (window.__mpApi ? __mpApi.calls.addPlayer : []).length }));
    await host.evaluate(() => LAST_EDEN.test.finishEncounter()).catch(() => {});
    const ok = await MP.waitFor(host, () => LAST_EDEN.mp.players()[1] ? true : null, null, 30000, 200);
    const calls = await host.evaluate(() => __mpApi.calls.addPlayer);
    const clean = c => c.canAdmit === true && c.state === 'play' && !c.lock && !c.driving && !c.fade && !c.bossCard;
    chk('G9b', t3.dropIn, !!locked && !during.present && during.lock && during.calls === 0 && !!ok && calls.length >= 1 && calls.every(clean),
      `encounter ${k} locked ${JSON.stringify(locked)}; 2.5 s into the lock: 2P present ${during.present}, still locked ${during.lock}, addPlayer calls ${during.calls}; after the fight: admitted ${!!ok}, calls ${JSON.stringify(calls)}`);
  });
}

// ================================================================ G9c: real WebRTC tiers (env)
async function tierRTC() {
  const t4 = 'rtc-local: real RTCPeerConnection channels between two pages, a 20 KB keyframe arrives fragmented';
  const t5 = 'PeerJS smoke: host gets a code on the public broker, a joiner joins, one snapshot, leave';
  if (!tier('T4')) { /* not selected */ } else if (process.env.MP_RTC !== '1') await C.gated('G9c', t4, false, 'set MP_RTC=1 to run the rtc-local tier', null, { env: true });
  else if (!S.net || !S.harness || !S.mockOk) C.skip('G9c', t4, t1Why());
  else {
    await withSession({ ...H, players: 2 }, async s => {
      const has = await s.host.evaluate(() => !!(EDEN_NET.transports && EDEN_NET.transports.rtcLocal));
      if (!has) { C.skip('G9c', t4, 'EDEN_NET.transports.rtcLocal missing'); return; }
      const r = await Promise.all([
        // the joiner side receives through a Wire (reassembly); every raw data-channel text is measured
        s.host.evaluate(async () => {
          const N = EDEN_NET, t = N.transports.rtcLocal({ bus: window.__MP_BUS }); let got = null, max = 0, pieces = 0, ch = {};
          const p = new Promise(res => t.onIncoming(l => { l.on('message', (c, x) => { max = Math.max(max, x.length); pieces++; ch[c] = (ch[c] || 0) + 1; }); new N.Wire(l, new Set(['event']), m => { got = JSON.stringify(m).length; res(); }); }));
          await t.listen('cnd2-dino-rtcl'); await Promise.race([p, new Promise(r2 => setTimeout(r2, 15000))]); return { got, max, pieces, ch };
        }),
        (async () => { await sleep(500); return s.joiners[0].evaluate(async () => { const N = EDEN_NET, t = N.transports.rtcLocal({ bus: window.__MP_BUS }); const l = await t.connect('cnd2-dino-rtcl'); new N.Wire(l, new Set(['accept']), () => {}).send({ t: 'event', n: 1, tm: 0, list: [['notice', 'k'.repeat(20000)]] }); return l.kind || true; }); })(),
      ]).catch(e => [{ threw: e.message }]);
      const h = r[0] || {};
      chk('G9c', t4, h.got > 20000 && h.max <= 12100 && h.pieces >= 2, JSON.stringify(r));
    });
  }
  if (!tier('T5')) return;
  if (process.env.MP_PEERJS !== '1') { await C.gated('G9c', t5, false, 'set MP_PEERJS=1 to run the PeerJS smoke test (needs the internet)', null, { env: true }); return; }
  if (!S.net || !S.harness || !S.mockOk) { C.skip('G9c', t5, t1Why()); return; }
  await withSession({ ...H, players: 2, query: { net: null }, tag: 'T5' }, async s => {
    const host = s.host, j1 = s.joiners[0];
    let code;
    try { code = await host.evaluate(async () => { await EDEN_NET.loadPeerJS({ timeout: 10000 }); const s2 = await EDEN_NET.host({ adapter: MPT.adapter(), transport: EDEN_NET.transports.peerjs({}), name: 'HOST', hero: 0, lobby: { chapter: 0, difficulty: 'normal', unlocked: 6 } }); window.__mpSess = s2; return s2.code; }); }
    catch (e) { const r = await C.gated('G9c', t5, false, 'PeerJS or its broker unreachable: ' + e.message, null, { env: true }); void r; return; }
    const r = await j1.evaluate(async code => { try { await EDEN_NET.loadPeerJS({ timeout: 10000 }); const s2 = await EDEN_NET.join(code, { adapter: MPT.adapter(), transport: EDEN_NET.transports.peerjs({}), name: 'JOIN', hero: 1 }); window.__mpSess = s2; return { slot: s2.slot }; } catch (e) { return { error: e && (e.code || e.message) }; } }, code);
    if (r.error === 'broker' || r.error === 'peerjs-load') { await C.gated('G9c', t5, false, 'broker unreachable: ' + r.error, null, { env: true }); return; }
    await j1.evaluate(() => __mpSess.ready(true)).catch(() => {});
    await sleep(1000);
    await host.evaluate(() => __mpSess.start && __mpSess.start()).catch(() => {});
    await sleep(3000);
    const st = await MP.net(j1);
    await j1.evaluate(() => __mpSess.leave && __mpSess.leave()).catch(() => {});
    chk('G9c', t5, r.slot === 1 && st && st.snapSeq > 0, `join ${JSON.stringify(r)} status ${JSON.stringify(st)}`);
  });
}

// ================================================================ single-player trace (§4.3)
const TRACE_PAGE = `async ({ chapters, steps, every }) => {
  const g = LAST_EDEN, out = {};
  const key = (code, on) => window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const r = v => typeof v === 'number' ? +v.toFixed(3) : v;
  for (const ch of chapters) {
    g.start(ch, 0, 'normal'); const hs = []; const held = new Set();
    const set = (code, on) => { if (on && !held.has(code)) { held.add(code); key(code, true); } else if (!on && held.has(code)) { held.delete(code); key(code, false); } };
    for (let i = 1; i <= steps; i++) {
      const ph = i % 600;
      set('ArrowRight', ph < 420); set('ArrowLeft', ph >= 480 && ph < 520); set('ArrowUp', ph >= 200 && ph < 230); set('ArrowDown', ph >= 300 && ph < 330); set('ShiftLeft', ph >= 100 && ph < 160);
      if (i % 18 === 0) key('KeyJ', true); if (i % 18 === 3) key('KeyJ', false);
      if (i % 290 === 0) key('KeyK', true); if (i % 290 === 4) key('KeyK', false);
      if (i % 700 === 0) key('KeyE', true); if (i % 700 === 3) key('KeyE', false);
      g.step(1 / 60);
      if (i % every === 0) {
        const S = g.snapshot, p = S.player || {};
        hs.push(fnv(JSON.stringify({ st: S.state, x: r(p.x), y: r(p.y), hp: r(p.hp), score: S.score, cam: r(S.camera), e: (S.enemies || []).map(e => [r(e.x), r(e.y), r(e.hp), e.state]) })));
      }
    }
    for (const c of [...held]) set(c, false);
    out[ch] = hs;
  }
  return { traces: out, keys: Object.keys(g.snapshot) };
}`;
async function recordTrace(browser, seed = 9090, steps = 3600, every = 60, chapters = [0, 1, 5]) {
  const ctx = await browser.newContext(); const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await A.prepare(page, { seed, raf: true });
    await page.goto(MP.urlOf('index.html')); await A.waitReady(page, 60000);
    const r = await page.evaluate(`(${TRACE_PAGE})(${JSON.stringify({ chapters, steps, every })})`);
    if (errors.length) throw new Error('page errors while tracing: ' + errors.join(' | '));
    return { seed, steps, every, chapters, ...r };
  } finally { await ctx.close(); }
}

// ================================================================ main
(async () => {
  const srv = await MP.ensureServer();
  if (!srv.ok) { C.gated('G9a', 'multiplayer suite needs an http GAME_URL', false, srv.why, null, { env: true }); A.finish(C); return; }
  const { chromium } = A.playwright();
  const browser = await chromium.launch({ headless: true });
  try {
    if (RECORD) {
      const r = await recordTrace(browser);
      const game = fs.statSync(path.join(A.ROOT, 'game.js'));
      fs.mkdirSync(path.dirname(RECORD_TO), { recursive: true });
      fs.writeFileSync(RECORD_TO, JSON.stringify({ recorded: new Date().toISOString(), gameJs: { bytes: game.size, mtime: game.mtime.toISOString() }, ...r }, null, 1));
      console.log(`recorded ${RECORD_TO}: chapters ${r.chapters.map(c => c + 1).join(', ')}, ${r.steps} steps, ${Object.values(r.traces)[0].length} hashes each, ${r.keys.length} snapshot keys`);
      return;
    }
    S.net = await MP.exists('net.js'); S.lobbyFile = await MP.exists('lobby.js'); S.harness = await MP.exists('tests/fixtures/mp-harness.html');
    if (S.net && S.harness) {
      // the harness must actually provide the pieces
      await withSession({ ...H, players: 1 }, async s => { const p = await MP.probe(s.host); S.probe = p; S.mockOk = p.mock && p.adapter && p.net; S.mockWhy = JSON.stringify({ mock: p.mock, adapter: p.adapter, net: p.net, errors: s.errors.slice(0, 2) }); S.lobby = p.lobby; });
    }
    console.log(`multiplayer: net.js ${S.net ? 'yes' : 'no'}, lobby.js ${S.lobbyFile ? 'yes' : 'no'}, harness ${S.harness ? 'yes' : 'no'}${S.probe ? `, harness globals net=${S.probe.net} lobby=${S.probe.lobby} mock=${S.probe.mock} transports=${S.probe.transports}` : ''}`);
    if (tier('T0')) await tierT0(browser);
    if (tier('T1')) await tierT1();
    if (tier('T2') || tier('T3')) await tierGame(browser);
    await tierRTC();
    // global rows over every bus session
    if (tier('T1') || tier('T3')) {
      const ran = busStats.filter(b => b.totals.msgs > 0);
      if (!ran.length) C.skip('G9a', 'no bus message over 16 KB', 'no loopback session exchanged messages');
      else { const big = Math.max(...ran.map(b => b.maxMessage)), over = ran.reduce((n, b) => n + b.oversize, 0); chk('G9a', 'no bus message over 16 KB', over === 0, `${over} oversize, largest ${big} B`); }
      const foreign = allRequests.filter(r => r.tag !== 'T5' && NET_REQ.test(r.url));   // the PeerJS tier's own requests are expected
      if (!S.net) C.skip('G9a', 'loopback sessions never request PeerJS or any other host', 'net.js is not built yet');
      else chk('G9a', 'loopback sessions never request PeerJS or any other host', !foreign.length, foreign.map(r => `${r.page}: ${r.url}`).slice(0, 4).join(', '));
    }
  } catch (e) {
    C.fail('G9a', 'suite ran to the end', e && e.stack || String(e));
  } finally {
    await browser.close().catch(() => {}); await MP.closeShared(); MP.stopServer();
  }
  if (!RECORD) A.finish(C, allErrors, { extra: { have: { net: !!S.net, lobby: !!S.lobbyFile, harness: !!S.harness, mock: !!S.mockOk }, bus: busStats.map(b => ({ msgs: b.totals.msgs, bytes: b.totals.bytes, maxMessage: b.maxMessage, oversize: b.oversize, dropped: b.dropped, keyframes: b.keyframes })) } });
})();
