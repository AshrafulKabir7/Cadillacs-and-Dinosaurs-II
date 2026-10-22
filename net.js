// net.js — online co-op for Cadillacs & Dinosaurs II (work/mp/MULTIPLAYER.md §1 and §5.1). window.EDEN_NET.
//
// Host-authoritative: the host's browser runs the only simulation; joiners send 60 Hz input frames and draw
// interpolated 20 Hz delta snapshots. Transport: WebRTC data channels through PeerJS 1.5.4 (loaded lazily, only when
// the player chooses Host or Join), or a loopback bus for tests and local development, or real RTCPeerConnections
// signalled over that bus ('rtc-local'). Single-player and file:// play never touch the network: loading this file
// only defines window.EDEN_NET.
//
// Everything here is plain ES2020, no modules, no build step. It also loads in Node (module.exports) so tests/net.cjs
// can unit-test codes, the codec, input counters, interpolation and whole host/join sessions over the in-memory bus.
//
// Loopback bus contract (used by transports.loopback / transports.rtcLocal; implemented by memoryBus() and
// broadcastBus() here and by tests/lib/mp.cjs's window.__MP_BUS):
//   bus.send(fromId, toId, channel, text)       channel: 'ctl' | 'st' | '_' (link control, JSON text with an `op`)
//   delivery to subscribers as fn(fromId, toId, channel, text), registered through the first of these the bus has:
//     bus.subscribe(fn) / bus.onMessage(fn) / bus.addListener(fn)  (may return an unsubscribe function), or a settable
//     bus.inbox / bus.onmessage property (net.js installs one demultiplexer per bus object).
//   optional bus.claim(peerId) -> boolean|Promise<boolean>   (false = the id is already taken)
//   A relay may inject on channel '_' to toId: {"op":"fail","code":"ice-failed"} (fails a pending connect) and
//   {"op":"cut"} (closes every link of toId with reason 'cut'). Only 'st' may be lost or reordered; 'ctl' and '_'
//   must arrive in order. '_' ops between transports: claim/taken, connect/open, close, and rtc-offer/answer/ice.
(function (root) {
  'use strict';

  const PROTOCOL = 1, MAX_PLAYERS = 3;
  const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
  const PEERJS_FALLBACK_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  // The game's own WebSocket relay (relay/ in this repo, a Cloudflare Worker): players whose networks block direct
  // WebRTC connections (mobile data, ISP CGNAT, campus and office networks) play through it over wss:// on port 443.
  // Put the deployed Worker's address here, e.g. 'wss://cnd2-relay.<your-subdomain>.workers.dev' (relay/README.md).
  // Set to '' to turn the relay off: online play is then direct WebRTC only, exactly as before the relay existed. A page URL's ?relay=<url>
  // overrides it (testing: ws:// only to this computer, wss:// anywhere).
  const RELAY_URL = 'wss://cnd2-relay.ashrafulkabir2021.workers.dev';
  const RELAY_WINDOW_MS = 7000;   // how long a joiner tries the direct connection before it switches to the relay
  const RATES = { input: 60, snap: 20, keyframeMs: 2000, pingMs: 1000, warnMs: 3000, dropMs: 10000, reserveMs: 30000, lobbyMs: 2000, helloMs: 5000,
    linkBytesPerSec: 48 * 1024, ctlPerSec: 20, ctlBurst: 40, kickLockMs: 60000 };
  const FRAG = 12000, MAX_TEXT = 256 * 1024, HISTORY = 64;
  const ST_TYPES = new Set(['i', 's']);
  const TO_HOST = new Set(['hello', 'hero', 'ready', 'i', 'kf', 'ping', 'leave']);
  const TO_CLIENT = new Set(['accept', 'reject', 'lobby', 'start', 's', 'event', 'pong', 'pause', 'end']);

  // ------------------------------------------------------------------ clock, scheduler, emitter
  const perfNow = () => (root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now());
  let clockFn = null;
  const now = () => (clockFn ? clockFn() : perfNow());
  const tasks = [];
  let ticker = null;
  function ensureTicker() {
    if (ticker || !tasks.length) return;
    ticker = setInterval(poll, 50);
    if (ticker && typeof ticker.unref === 'function') ticker.unref();
  }
  function after(ms, fn) { const t = { at: now() + ms, fn, dead: false }; tasks.push(t); ensureTicker(); return () => { t.dead = true; }; }
  function every(ms, fn) {
    let cancel = null, stopped = false;
    const loop = () => { if (stopped) return; try { fn(); } finally { if (!stopped) cancel = after(ms, loop); } };
    cancel = after(ms, loop);
    return () => { stopped = true; if (cancel) cancel(); };
  }
  function poll() {
    for (let guard = 0; guard < 100; guard++) {
      const n = now(), due = [];
      for (let i = tasks.length - 1; i >= 0; i--) { const t = tasks[i]; if (t.dead) tasks.splice(i, 1); else if (t.at <= n) { tasks.splice(i, 1); due.push(t); } }
      if (!due.length) break;
      due.sort((a, b) => a.at - b.at);
      for (const t of due) safely(t.fn);
    }
    if (!tasks.length && ticker) { clearInterval(ticker); ticker = null; }
  }
  function raise(err) {
    if (typeof root.reportError === 'function') root.reportError(err);
    else setTimeout(() => { throw err; }, 0);
  }
  function safely(fn, ...args) { try { return fn(...args); } catch (e) { raise(e); return undefined; } }
  function emitter(o) {
    const h = Object.create(null);
    o.on = (e, fn) => { (h[e] || (h[e] = [])).push(fn); return o; };
    o.off = (e, fn) => { if (h[e]) h[e] = h[e].filter(f => f !== fn); return o; };
    o.once = (e, fn) => { const w = (...a) => { o.off(e, w); fn(...a); }; return o.on(e, w); };
    o.emit = (e, ...a) => { for (const fn of (h[e] || []).slice()) safely(fn, ...a); };
    return o;
  }

  const randomBytes = buf => {
    const c = root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto);
    if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(buf);
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
    return buf;
  };
  const RID = 'abcdefghijkmnpqrstuvwxyz23456789';
  function randomId(n = 12) { const b = randomBytes(new Uint8Array(n)); let s = ''; for (let i = 0; i < n; i++) s += RID[b[i] & 31]; return s; }

  // ------------------------------------------------------------------ errors (§1.14)
  let relayKnown = null;   // null: unknown (PeerJS not loaded), true: the PeerJS build lists TURN servers, false: STUN only
  const ERRORS = {
    'webrtc-unsupported': { title: "THIS BROWSER CAN'T PLAY ONLINE", text: 'Online co-op needs WebRTC. Try a current Chrome, Edge, Firefox or Safari.', retry: false },
    'peerjs-load': { title: "ONLINE PLAY COULDN'T START", text: "The online part of the game couldn't be downloaded. Check your internet connection (or an ad/script blocker) and try again.", retry: true },
    'broker': { title: "CAN'T REACH THE MATCHMAKING SERVER", text: "The free server that introduces players to each other isn't answering. Wait a minute and try again.", retry: true },
    'bad-code': { title: 'NO GAME WITH THAT CODE', text: 'Check the code with your friend. Codes look like DINO-4KQ7 and use the digits 2–9 and letters other than I, L and O. The host must keep the game open on the room screen or in play.', retry: true },
    'code-format': { title: "THAT ISN'T A GAME CODE", text: 'Codes use the digits 2–9 and letters other than I, L and O, like DINO-4KQ7.', retry: true },
    'full': { title: 'THIS GAME IS FULL', text: 'Three players are already in. Ask the host to start a new room, or wait for a slot.', retry: true },
    'locked': { title: 'THIS GAME IS LOCKED', text: "The host isn't letting new players in right now. Ask the host to unlock the room, then try again.", retry: true },
    'version': { title: 'DIFFERENT VERSIONS', text: "Your copy of the game is different from the host's. Both of you: reload the page, then try again.", retry: true },
    'build': { title: 'DIFFERENT VERSIONS', text: "Your copy of the game is different from the host's. Both of you: reload the page, then try again.", retry: true },
    'hero-taken': { title: 'HERO TAKEN', text: 'Another player took that hero — pick another.', retry: false, inline: true },
    'ice-failed': {
      title: "CAN'T CONNECT TO THE HOST",
      get text() {
        if (relayUrl()) {
          return "Your network (or the host's) blocks direct player-to-player connections — common on school, office, hotel and some mobile networks — " +
            "and the game's relay server couldn't connect you to the host either. Check that the host still has the room open and both of you are online, " +
            'then try again, or try another network, such as a phone hotspot.';
        }
        return "Your network (or the host's) blocks direct player-to-player connections — common on school, office, hotel and some mobile networks. " +
          (relayKnown ? "This game has no relay server of its own, and the public relay couldn't be reached either. " : 'This game has no relay server of its own. ') +
          'Try another network, such as a phone hotspot, or let another player host.';
      },
      retry: true,
    },
    'relay-down': { title: "CAN'T REACH THE RELAY SERVER", text: "The game's relay server isn't answering. Check your internet connection, wait a minute and try again.", retry: true },
    'timeout': { title: 'LOST THE CONNECTION', text: 'The host stopped answering.', retry: true },
    'host-left': { title: 'THE HOST LEFT THE GAME', text: 'The game ended because the host closed it.', retry: false },
    'host-quit': { title: 'THE HOST ENDED THE GAME', text: 'The host closed this room.', retry: false },
    'kicked': { title: 'REMOVED FROM THE GAME', text: 'The host removed you from this room.', retry: false },
    'cancelled': { title: 'CANCELLED', text: 'Online play was cancelled.', retry: true },
  };
  const REJECT_TO_ERROR = { version: 'version', build: 'build', full: 'full', locked: 'locked', kicked: 'kicked', closed: 'host-left', 'hero-taken': 'hero-taken' };
  const END_TO_ERROR = { 'host-left': 'host-left', 'host-quit': 'host-quit', kicked: 'kicked', timeout: 'timeout', closed: 'host-left' };
  function netError(code, detail) {
    const info = ERRORS[code] || { title: 'ONLINE PLAY ERROR', text: String(detail || code), retry: true };
    const e = new Error(info.title + (detail ? ' (' + detail + ')' : ''));
    e.code = code; e.title = info.title; e.text = info.text; e.retry = !!info.retry; e.detail = detail || '';
    return e;
  }
  const asNetError = (e, fallback = 'broker') => (e && e.code && ERRORS[e.code] ? e : netError(fallback, e && (e.message || e.type || String(e))));

  // ------------------------------------------------------------------ room codes (§1.3)
  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const code = {
    ALPHABET,
    make(rand = randomBytes) {
      const lim = 256 - (256 % ALPHABET.length);   // rejection sampling: no modulo bias
      let out = '';
      while (out.length < 4) {
        const buf = new Uint8Array(8); const r = rand(buf) || buf;
        for (let i = 0; i < r.length && out.length < 4; i++) if (r[i] < lim) out += ALPHABET[r[i] % ALPHABET.length];
      }
      return 'DINO-' + out;
    },
    // Why `text` isn't a code: null (it is one), 'empty', 'symbols' (0/O/1/I/L or others), 'length'.
    problem(text) {
      const s = code._core(text);
      if (!s) return 'empty';
      for (const ch of s) if (!ALPHABET.includes(ch)) return 'symbols';
      return s.length === 4 ? null : 'length';
    },
    _core(text) {
      let t = String(text == null ? '' : text);
      const m = /[?&#]join=([^&#\s]*)/i.exec(t);
      if (m) { try { t = decodeURIComponent(m[1]); } catch (e) { t = m[1]; } }
      let s = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (s.startsWith('DINO') && s.length > 4) s = s.slice(4);
      return s;
    },
    normalize(text) { return code.problem(text) ? null : 'DINO-' + code._core(text); },
    peerId(c) { const n = code.normalize(c); return n ? 'cnd2-' + n.toLowerCase() : null; },
    fromUrl(href) {
      if (href == null) href = root.location ? root.location.href : '';
      const m = /[?&]join=([^&#]*)/i.exec(String(href));
      if (!m) return null;
      let v = m[1]; try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* keep raw */ }
      return code.normalize(v);
    },
    shareUrl(c, loc) {
      if (loc === undefined) loc = root.location;
      const n = code.normalize(c);
      if (!n || !loc || !/^https?:$/.test(loc.protocol || '')) return null;
      const origin = loc.origin || (loc.protocol + '//' + loc.host);
      return origin + (loc.pathname || '/') + '?join=' + n;
    },
  };
  const cleanName = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);

  // ------------------------------------------------------------------ input frames (§1.8)
  const BUTTONS = ['left', 'right', 'up', 'down', 'attack', 'jump', 'special', 'pick', 'run', 'coin'];
  const CODES = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyJ', 'KeyK', 'KeyL', 'KeyE', 'ShiftLeft', 'Enter'];
  const KEYMAP = { KeyA: 0, ArrowLeft: 0, KeyD: 1, ArrowRight: 1, KeyW: 2, ArrowUp: 2, KeyS: 3, ArrowDown: 3, KeyJ: 4, KeyZ: 4, Space: 4,
    KeyK: 5, KeyX: 5, KeyL: 6, KeyC: 6, KeyE: 7, KeyV: 7, ShiftLeft: 8, ShiftRight: 8, TouchRun: 8, Enter: 9, NumpadEnter: 9 };
  const DASH_CODES = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };
  const isInt = v => Number.isInteger(v);

  class Sampler {
    constructor({ hz = 60, dashWindowMs = 280 } = {}) { this.step = 1000 / hz; this.dashWindowMs = dashWindowMs; this.reset(); }
    reset() {
      this.held = new Set(); this.away = false; this.rebase();
    }
    // New counter baseline (the host's Receiver resets to zero on every START / drop-in admission / reconnect): press
    // counters, the double-tap counter and the frame sequence go back to 0; held keys and the away flag are kept.
    // ClientSession calls this on its own `sampler` at every start; a caller keeping a Sampler of its own must too.
    rebase() { this.c = new Array(10).fill(0); this.d = 0; this.k = 0; this.s = 0; this.acc = 0; this.lastDir = { code: '', at: -1e9 }; }
    bits() { let b = 0; for (const c of this.held) b |= 1 << KEYMAP[c]; return b; }
    // Returns true when the code is one of the game's buttons (the caller may preventDefault).
    keyDown(c, nowMs = now()) {
      const bit = KEYMAP[c];
      if (bit === undefined) return false;
      if (this.held.has(c)) return true;              // key repeat
      const was = (this.bits() >> bit) & 1;
      this.held.add(c);
      if (!was) this.c[bit] = (this.c[bit] + 1) & 255;
      if (c in DASH_CODES) {                          // today's keydown rule: the same key twice within 0.28 s
        if (this.lastDir.code === c && nowMs - this.lastDir.at < this.dashWindowMs) { this.d = (this.d + 1) & 255; this.k = DASH_CODES[c]; }
        this.lastDir = { code: c, at: nowMs };
      }
      return true;
    }
    keyUp(c) { return this.held.delete(c); }
    setAway(on) { this.away = !!on; if (on) this.held.clear(); }
    frame() { return { t: 'i', s: ++this.s, a: -1, b: this.bits(), c: this.c.slice(), d: this.d, k: this.k, f: this.away ? 1 : 0 }; }
    // 0..n frames for the elapsed time on a fixed 60 Hz accumulator (at most 8 after a stall).
    sample(dtMs) {
      this.acc = Math.min(this.acc + Math.max(0, +dtMs || 0), this.step * 8);
      const out = [];
      while (this.acc >= this.step - 1e-6) { this.acc -= this.step; out.push(this.frame()); }
      return out;
    }
  }

  function validFrame(f) {
    if (!f || typeof f !== 'object' || !isInt(f.s) || f.s < 0 || !isInt(f.b) || !Array.isArray(f.c) || f.c.length !== 10) return false;
    for (const v of f.c) if (!isInt(v) || v < 0 || v > 255) return false;
    if (f.d !== undefined && (!isInt(f.d) || f.d < 0 || f.d > 255)) return false;
    if (f.k !== undefined && f.k !== -1 && f.k !== 0 && f.k !== 1) return false;
    if (f.f !== undefined && !isInt(f.f)) return false;
    return true;
  }

  // Host side: one queue per remote slot; next() is called once per host step (§1.7).
  class Receiver {
    constructor({ maxPerSecond = 120, maxPress = 8 } = {}) { this.maxPerSecond = maxPerSecond; this.maxPress = maxPress; this.reset(); }
    reset() {
      this.queue = []; this.lastSeq = 0; this.lastC = new Array(10).fill(0); this.lastD = 0; this.lastBits = 0; this.lastAway = false;
      this.catchup = false; this.win = { at: -1e9, n: 0 }; this.dropped = 0; this.fresh = true;
    }
    push(f, nowMs = now()) {
      if (!validFrame(f)) { this.dropped++; return false; }
      if (nowMs - this.win.at >= 1000) this.win = { at: nowMs, n: 0 };
      if (++this.win.n > this.maxPerSecond) { this.dropped++; return false; }
      if (f.s <= this.lastSeq || this.queue.some(q => q.s === f.s)) return false;
      let i = this.queue.length;
      while (i > 0 && this.queue[i - 1].s > f.s) i--;
      this.queue.splice(i, 0, { s: f.s, b: f.b & 1023, c: f.c.slice(), d: f.d | 0, k: f.k | 0, f: f.f | 0 });
      if (this.queue.length > 60) this.queue.splice(0, this.queue.length - 60);
      return true;
    }
    get depth() { return this.queue.length; }
    next() {
      if (this.queue.length > 3) this.catchup = true;
      if (this.catchup && this.queue.length <= 1) this.catchup = false;
      const take = Math.min(this.queue.length, this.catchup ? 2 : 1);
      if (!take) return { s: this.lastSeq, held: this.lastAway ? new Set() : codesOf(this.lastBits), presses: [], dash: null, away: this.lastAway, repeat: true };
      const f = this.queue.splice(0, take)[take - 1];
      // Counter baseline: after a reset the counters start from zero, which a rebased (or new) Sampler matches — its
      // first frames have s 1, 2, …. A first frame with a high s comes from a Sampler that was not rebased; its
      // counters are taken as the baseline instead of being turned into a burst of stale presses.
      if (this.fresh) { this.fresh = false; if (f.s > Receiver.BASELINE_SEQ) { this.lastC = f.c.slice(); this.lastD = f.d; } }
      const presses = [], away = !!(f.f & 1);
      for (let i = 0; i < 10; i++) {
        const n = Math.min((f.c[i] - this.lastC[i]) & 255, this.maxPress);
        if (!away) for (let j = 0; j < n; j++) presses.push(CODES[i]);
      }
      const dd = (f.d - this.lastD) & 255;
      const dash = dd > 0 && !away && f.k ? { dir: f.k, code: f.k < 0 ? 'ArrowLeft' : 'ArrowRight', count: dd } : null;
      this.lastC = f.c; this.lastD = f.d; this.lastBits = away ? 0 : f.b; this.lastAway = away; this.lastSeq = f.s;
      return { s: f.s, held: away ? new Set() : codesOf(f.b), presses, dash, away, repeat: false };
    }
  }
  Receiver.BASELINE_SEQ = 30;   // half a second of frames: more consecutive losses than that would be a dead link anyway
  function codesOf(bits) { const s = new Set(); for (let i = 0; i < 10; i++) if ((bits >> i) & 1) s.add(CODES[i]); return s; }

  // ------------------------------------------------------------------ snapshot codec (§1.9)
  // schema = { sections: { g:{fields:[[name,q],...]}, p:{key:'slot',fields}, e:{key:'nid',fields}, ... } }
  // State: singleton sections are plain objects, keyed sections arrays of row objects. Quantisers: q<n> (round(v*n)/n,
  // q4 = quarter px), f<d> (d decimals), i (integer), t (seconds carried as integer ms), b (boolean), str, json.
  // decode(encode(S, B), B) deep-equals quantise(S); B must be a quantised state (what quantise/decode return).
  // Decoded states share unchanged row objects with their baseline: treat them as immutable.
  const qcache = Object.create(null);
  function qspec(name) {
    if (qcache[name]) return qcache[name];
    let m, s;
    if ((m = /^q(\d+)$/.exec(name))) s = { kind: 'num', s: +m[1] };
    else if ((m = /^f(\d)$/.exec(name))) s = { kind: 'num', s: Math.pow(10, +m[1]) };
    else if (name === 'i') s = { kind: 'num', s: 1 };
    else if (name === 't') s = { kind: 'num', s: 1000 };
    else if (name === 'b') s = { kind: 'bool' };
    else if (name === 'str') s = { kind: 'str' };
    else if (name === 'json') s = { kind: 'json' };
    else throw new Error('net.js codec: unknown quantiser ' + name);
    s.name = name;
    return (qcache[name] = s);
  }
  // wire form: numbers as integers (or null), booleans 0/1, strings as text (indexed per payload), json as JSON text
  function toWire(sp, v) {
    switch (sp.kind) {
      case 'num': { if (typeof v !== 'number' || !isFinite(v)) return null; const r = Math.round(v * sp.s); return r || 0; }
      case 'bool': return v ? 1 : 0;
      case 'str': return v == null ? null : String(v);
      default: { if (v === undefined) return 'null'; const j = JSON.stringify(v); return j === undefined ? 'null' : j; }
    }
  }
  function fromWire(sp, w) {
    switch (sp.kind) {
      case 'num': return w === null ? null : (sp.s === 1 ? w : w / sp.s);
      case 'bool': return !!w;
      case 'str': return w;
      default: return JSON.parse(w);
    }
  }
  const Q = {};
  for (const n of ['q4', 'f1', 'f2', 'f3', 'i', 't', 'b', 'str', 'json']) Q[n] = v => fromWire(qspec(n), toWire(qspec(n), v));

  function makeCodec(schema) {
    const secs = [];
    for (const name of Object.keys((schema && schema.sections) || {})) {
      const def = schema.sections[name];
      const key = def.key || null;
      const fields = (def.fields || []).filter(f => f[0] !== key).map(f => ({ name: f[0], sp: qspec(f[1] || 'json') }));
      secs.push({ name, key, fields, chunks: Math.ceil(fields.length / 30) || 1 });
    }
    const wireRow = (sec, row) => sec.fields.map(f => toWire(f.sp, row ? row[f.name] : undefined));
    const rowOf = (sec, w, keyVal) => {
      const r = {};
      if (sec.key) r[sec.key] = keyVal;
      sec.fields.forEach((f, i) => { r[f.name] = fromWire(f.sp, w[i]); });
      return r;
    };
    const rowsOf = (sec, st) => { const v = st && st[sec.name]; return Array.isArray(v) ? v : []; };
    // Quantise one state: {secName: {rows:[...], wires:[...], keys:[...]}} plus the plain quantised state.
    function prep(state) {
      const out = { q: {}, w: {} };
      for (const sec of secs) {
        if (!sec.key) {
          const w = wireRow(sec, state ? state[sec.name] : null);
          out.w[sec.name] = w; out.q[sec.name] = rowOf(sec, w);
        } else {
          const seen = new Set(), keys = [], wires = new Map(), rows = [];
          for (const row of rowsOf(sec, state)) {
            if (!row || typeof row !== 'object') continue;
            const k = row[sec.key];
            if (k == null || (typeof k !== 'number' && typeof k !== 'string') || seen.has(k)) continue;
            seen.add(k); keys.push(k);
            const w = wireRow(sec, row); wires.set(k, w); rows.push(rowOf(sec, w, k));
          }
          out.w[sec.name] = { keys, wires }; out.q[sec.name] = rows;
        }
      }
      return out;
    }
    function quantise(state) { return prep(state).q; }
    function encodeVals(sec, w, strs) {
      return w.map((v, i) => {
        const sp = sec.fields[i].sp;
        if (sp.kind === 'str') return v === null ? null : strs(v);
        if (sp.kind === 'json') return JSON.parse(v);
        return v;
      });
    }
    function encode(state, base, opts) {
      const cur = prep(state);
      const bw = base ? prep(base).w : null;
      const strings = [], sidx = new Map();
      const strs = s => { let i = sidx.get(s); if (i === undefined) { i = strings.length; strings.push(s); sidx.set(s, i); } return i; };
      const d = {};
      if (!bw) d.k = 1;
      for (const sec of secs) {
        if (!sec.key) {
          const w = cur.w[sec.name];
          if (!bw) { d[sec.name] = encodeVals(sec, w, strs); continue; }
          const b = bw[sec.name], ch = [];
          w.forEach((v, i) => { if (v !== b[i]) ch.push([i, encodeVals({ fields: [sec.fields[i]] }, [v], strs)[0]]); });
          if (ch.length) d[sec.name] = ch;
          continue;
        }
        const c = cur.w[sec.name];
        if (!bw) {
          if (c.keys.length) d[sec.name] = c.keys.map(k => [k].concat(encodeVals(sec, c.wires.get(k), strs)));
          continue;
        }
        const b = bw[sec.name], changed = [], added = [], removed = [];
        for (const k of b.keys) if (!c.wires.has(k)) removed.push(k);
        for (const k of c.keys) {
          const w = c.wires.get(k), bwr = b.wires.get(k);
          if (!bwr) { added.push([k].concat(encodeVals(sec, w, strs))); continue; }
          const mask = new Array(sec.chunks).fill(0), vals = [];
          let any = false;
          w.forEach((v, i) => { if (v !== bwr[i]) { any = true; mask[(i / 30) | 0] += Math.pow(2, i % 30); vals.push(i); } });
          if (!any) continue;
          const ev = encodeVals({ fields: vals.map(i => sec.fields[i]) }, vals.map(i => w[i]), strs);
          changed.push([k, sec.chunks === 1 ? mask[0] : mask].concat(ev));
        }
        if (changed.length) d[sec.name] = changed;
        if (added.length) d['+' + sec.name] = added;
        if (removed.length) d['-' + sec.name] = removed;
        // order: base order minus removals, then additions; send the real order only when it differs
        const natural = b.keys.filter(k => c.wires.has(k)).concat(added.map(a => a[0]));
        if (natural.length !== c.keys.length || natural.some((k, i) => k !== c.keys[i])) (d.o || (d.o = {}))[sec.name] = c.keys.slice();
      }
      if (strings.length) d.$ = strings;
      return opts && opts.withQuantised ? { payload: d, q: cur.q } : d;
    }
    function decodeVal(sp, v, strs) {
      if (sp.kind === 'str') return v === null || v === undefined ? null : (strs[v] === undefined ? null : strs[v]);
      if (sp.kind === 'json') return v === undefined ? null : JSON.parse(JSON.stringify(v));
      if (sp.kind === 'bool') return !!v;
      return v === null || v === undefined ? null : (sp.s === 1 ? v : v / sp.s);
    }
    function decode(d, base) {
      if (!d || typeof d !== 'object') throw new Error('net.js codec: bad payload');
      const strs = Array.isArray(d.$) ? d.$ : [];
      const key = !!d.k;
      if (!key && !base) throw new Error('net.js codec: delta without a baseline');
      const out = {};
      for (const sec of secs) {
        const v = d[sec.name];
        if (!sec.key) {
          if (key) { const r = {}; sec.fields.forEach((f, i) => { r[f.name] = decodeVal(f.sp, Array.isArray(v) ? v[i] : undefined, strs); }); out[sec.name] = r; }
          else {
            const r = Object.assign({}, base[sec.name] || {});
            if (Array.isArray(v)) for (const [i, val] of v) { const f = sec.fields[i]; if (f) r[f.name] = decodeVal(f.sp, val, strs); }
            out[sec.name] = r;
          }
          continue;
        }
        const full = (arr) => {
          const r = {}; r[sec.key] = arr[0];
          sec.fields.forEach((f, i) => { r[f.name] = decodeVal(f.sp, arr[i + 1], strs); });
          return r;
        };
        if (key) { out[sec.name] = Array.isArray(v) ? v.map(full) : []; continue; }
        const rm = new Set(Array.isArray(d['-' + sec.name]) ? d['-' + sec.name] : []);
        const byKey = new Map();
        const rows = [];
        for (const r of (base[sec.name] || [])) if (!rm.has(r[sec.key])) { byKey.set(r[sec.key], rows.length); rows.push(r); }
        if (Array.isArray(v)) for (const arr of v) {
          const at = byKey.get(arr[0]);
          if (at === undefined) continue;
          const mask = arr[1], r = Object.assign({}, rows[at]);
          let j = 2;
          for (let i = 0; i < sec.fields.length; i++) {
            const m = Array.isArray(mask) ? mask[(i / 30) | 0] : mask;
            if (Math.floor(m / Math.pow(2, i % 30)) % 2) r[sec.fields[i].name] = decodeVal(sec.fields[i].sp, arr[j++], strs);
          }
          rows[at] = r;
        }
        const add = d['+' + sec.name];
        if (Array.isArray(add)) for (const arr of add) { byKey.set(arr[0], rows.length); rows.push(full(arr)); }
        const ord = d.o && d.o[sec.name];
        out[sec.name] = Array.isArray(ord) ? ord.map(k => rows[byKey.get(k)]).filter(Boolean) : rows;
      }
      return out;
    }
    return { encode, decode, quantise, sections: secs.map(s => ({ name: s.name, key: s.key, fields: s.fields.map(f => [f.name, f.sp.name]) })) };
  }

  // ------------------------------------------------------------------ interpolation (§1.12)
  const DEFAULT_LERP = ['x', 'y', 'z', 'camera', 'cameraY', 'viewX', 'road', 'roadStream', 'vx', 'vy', 'r'];
  class Interp {
    constructor({ min = 60, max = 250, schema = null, lerp = null, snapKeys = ['area', 'level'], timeField = 'time', extrapolateMs = 100, interval = 1000 / RATES.snap } = {}) {
      this.min = min; this.max = max; this.snapKeys = snapKeys; this.timeField = timeField; this.extrapolateMs = extrapolateMs;
      this.baseInterval = interval;
      this.keys = {}; this.lerpBySec = {};
      const secs = schema && schema.sections;
      if (secs) for (const n of Object.keys(secs)) {
        this.keys[n] = secs[n].key || null;
        this.lerpBySec[n] = new Set(lerp || (secs[n].fields || []).filter(f => /^q\d+$/.test(f[1] || '')).map(f => f[0]));
      }
      this.defaultLerp = new Set(lerp || DEFAULT_LERP);
      this.reset();
    }
    reset() { this.buf = []; this.interval = this.baseInterval; this.jitter = 0; this.offset = null; this.samples = []; this.lastView = null; this.lastSeq = -1; this.starved = false; this.newestAt = null; this.gapAt = null; this.lastShown = null; }
    get delay() { return Math.max(this.min, Math.min(this.max, 1.5 * this.interval + 2 * this.jitter)); }
    push(seq, tm, state, arrivalMs = now()) {
      if (seq <= this.lastSeq) return false;
      const prev = this.buf[this.buf.length - 1];
      if (prev && tm < prev.tm) return false;
      if (prev) {
        const expected = tm - prev.tm, actual = arrivalMs - prev.at;
        if (expected > 0) this.interval = this.interval * 0.9 + 0.1 * Math.min(expected, 500);
        // A gap: far more local time than host time passed between two snapshots (the host sim stalled — pause, fade,
        // hitch — or the network held packets back). Samples from before it may overstate the offset; they are dropped
        // once the arrivals after the gap span GAP_SETTLE ms (long enough for a held-back burst to be followed by
        // on-time packets, so a network hiccup does not pull the offset down).
        if (actual - expected > Interp.GAP_MS) this.gapAt = arrivalMs;
        else this.jitter = this.jitter * 0.9 + 0.1 * Math.min(Math.abs(actual - expected), 1000);
      }
      this.lastSeq = seq; this.newestAt = arrivalMs;
      this.buf.push({ seq, tm, state, at: arrivalMs, maps: null });
      while (this.buf.length > 2 && this.buf[1].tm < tm - 3000) this.buf.shift();
      if (this.buf.length > 64) this.buf.shift();
      this.samples.push({ at: arrivalMs, off: tm - arrivalMs });
      while (this.samples.length && this.samples[0].at < arrivalMs - 2000) this.samples.shift();
      if (this.gapAt !== null && arrivalMs - this.gapAt >= Interp.GAP_SETTLE) {
        const g = this.gapAt; this.gapAt = null;
        this.samples = this.samples.filter(s => s.at >= g);
      }
      return true;
    }
    _offset(nowMs) {
      if (!this.samples.length) return this.offset;
      let target = -Infinity; for (const s of this.samples) if (s.off > target) target = s.off;
      if (this.offset === null || Math.abs(target - this.offset) > 250) this.offset = target;
      else this.offset += Math.max(-2, Math.min(2, target - this.offset));
      return this.offset;
    }
    renderTime(nowMs = now()) { const off = this._offset(nowMs); return off === null ? null : nowMs + off - this.delay; }
    hostNow(nowMs = now()) { return this.offset === null ? null : nowMs + this.offset; }
    _map(entry, sec) {
      if (!entry.maps) entry.maps = {};
      if (!entry.maps[sec]) {
        const m = new Map(), rows = entry.state[sec] || [], key = this._key(sec, rows);
        for (const r of rows) if (r) m.set(r[key], r);
        entry.maps[sec] = m;
      }
      return entry.maps[sec];
    }
    _key(sec, rows) {
      if (this.keys[sec]) return this.keys[sec];
      const r = rows && rows[0];
      return r && 'nid' in r ? 'nid' : r && 'slot' in r ? 'slot' : 'id';
    }
    _lerpSet(sec) { return this.lerpBySec[sec] || this.defaultLerp; }
    _mix(sec, ra, rb, t) {
      const out = Object.assign({}, ra);
      if (!rb) return out;
      for (const f of this._lerpSet(sec)) {
        const a = ra[f], b = rb[f];
        if (typeof a === 'number' && typeof b === 'number') out[f] = a + (b - a) * t;
      }
      return out;
    }
    _blend(a, b, t) {
      const out = {};
      for (const sec of Object.keys(a.state)) {
        const va = a.state[sec];
        if (Array.isArray(va)) {
          const mb = b ? this._map(b, sec) : null, key = this._key(sec, va);
          out[sec] = va.map(r => (r ? this._mix(sec, r, mb ? mb.get(r[key]) : null, t) : r));
        } else if (va && typeof va === 'object') out[sec] = this._mix(sec, va, b ? b.state[sec] : null, t);
        else out[sec] = va;
      }
      return out;
    }
    view(nowMs = now()) {
      if (!this.buf.length) return null;
      // Shown time never runs backwards: after the offset is corrected downwards (a host stall), the view holds what it
      // last showed until render time catches up instead of rewinding.
      const raw = this.renderTime(nowMs);
      const rt = this.lastShown !== null && this.lastShown !== undefined && raw < this.lastShown ? this.lastShown : raw;
      let i = this.buf.length - 1;
      while (i > 0 && this.buf[i].tm > rt) i--;
      const a = this.buf[i], b = this.buf[i + 1];
      let out;
      this.starved = false;
      if (rt <= this.buf[0].tm) out = this._blend(this.buf[0], null, 0);
      else if (b) {
        const ga = a.state.g, gb = b.state.g;
        const snap = ga && gb && this.snapKeys.some(k => ga[k] !== gb[k]);
        out = this._blend(a, snap ? null : b, b.tm > a.tm ? (rt - a.tm) / (b.tm - a.tm) : 0);
      } else {
        // starved: extrapolate positions from the last two snapshots for up to extrapolateMs, then hold
        const p = this.buf[i - 1], ahead = Math.min(rt - a.tm, this.extrapolateMs);
        this.starved = rt - a.tm > this.extrapolateMs;
        if (p && a.tm > p.tm && ahead > 0 && !(p.state.g && a.state.g && this.snapKeys.some(k => p.state.g[k] !== a.state.g[k]))) {
          out = this._blend(a, p, -ahead / (a.tm - p.tm));
        } else out = this._blend(a, null, 0);
      }
      const shown = Math.max(this.buf[0].tm, b ? rt : Math.min(rt, a.tm + this.extrapolateMs));
      this.lastShown = shown;
      const tf = this.timeField;
      if (tf && out.g && typeof out.g[tf] === 'number') out.g[tf] = shown / 1000;
      this.lastView = out;
      return out;
    }
    newest() { return this.buf.length ? this.buf[this.buf.length - 1] : null; }
  }
  Interp.GAP_MS = 300; Interp.GAP_SETTLE = 200;

  // ------------------------------------------------------------------ own-hero echo (§1.12, D-MP13)
  class Echo {
    constructor(stepFn, { tau = 80, snap = 48, dt = 1 / 60, fields = ['x', 'y'] } = {}) {
      this.stepFn = stepFn; this.tau = tau; this.snapPx = snap; this.dt = dt; this.fields = fields; this.reset();
    }
    reset() { this.frames = []; this.acked = -1; this.sent = -1; this.lastRow = null; this.lastPred = null; this.lastMaxS = -1; this.corr = {}; this.lastNow = null; }
    pending(frame) {
      if (!frame || !isInt(frame.s)) return;
      if (frame.s <= this.sent) { this.frames = []; this.acked = -1; }   // the Sampler was rebased: a new sequence
      this.sent = frame.s;
      if (frame.s > this.acked) { this.frames.push(frame); if (this.frames.length > 120) this.frames.shift(); }
    }
    // An ack above the newest frame this Echo has sent belongs to an earlier sequence (a previous game's snapshots
    // still in flight, or a host that has not reset its counter yet): ignored, so it cannot freeze the prediction.
    ack(seq) { if (!isInt(seq) || seq <= this.acked || seq > this.sent) return; this.acked = seq; this.frames = this.frames.filter(f => f.s > seq); }
    _replay(row, maxS) {
      let r = Object.assign({}, row);
      for (const f of this.frames) { if (f.s > maxS) break; const n = this.stepFn(r, f, this.dt); if (n) r = n; }
      return r;
    }
    predict(row, nowMs = now()) {
      if (!row) return row;
      const maxS = this.frames.length ? this.frames[this.frames.length - 1].s : -1;
      if (row !== this.lastRow && this.lastPred) {
        const same = this._replay(row, this.lastMaxS);
        for (const f of this.fields) if (typeof same[f] === 'number' && typeof this.lastPred[f] === 'number') this.corr[f] = (this.corr[f] || 0) + this.lastPred[f] - same[f];
      }
      const pred = this._replay(row, Infinity);
      if (this.lastNow !== null) {
        const k = Math.exp(-Math.max(0, nowMs - this.lastNow) / this.tau);
        for (const f of this.fields) if (this.corr[f]) this.corr[f] *= k;
      }
      let err = 0; for (const f of this.fields) err = Math.max(err, Math.abs(this.corr[f] || 0));
      if (err > this.snapPx) this.corr = {};
      const out = Object.assign({}, pred);
      for (const f of this.fields) if (typeof out[f] === 'number' && this.corr[f]) { if (Math.abs(this.corr[f]) < 0.01) this.corr[f] = 0; else out[f] += this.corr[f]; }
      this.lastRow = row; this.lastPred = pred; this.lastMaxS = maxS; this.lastNow = nowMs;
      return out;
    }
  }

  // ------------------------------------------------------------------ framing and message tap (§1.4)
  const tap = [];
  function tapMsg(dir, ch, t, size) { tap.push({ dir, ch, t, size, at: now() }); if (tap.length > 200) tap.shift(); }
  function newStats() { return { bytesIn: 0, bytesOut: 0, msgsIn: 0, msgsOut: 0, dropped: 0, kbpsIn: 0, kbpsOut: 0, _win: { at: now(), i: 0, o: 0 } }; }
  function rollStats(st) {
    const n = now(), dt = n - st._win.at;
    if (dt < 1000) return;
    st.kbpsIn = Math.round(((st.bytesIn - st._win.i) * 8) / dt * 10) / 10;
    st.kbpsOut = Math.round(((st.bytesOut - st._win.o) * 8) / dt * 10) / 10;
    st._win = { at: n, i: st.bytesIn, o: st.bytesOut };
  }

  class Wire {
    // opts.bytesPerSec: inbound budget per link (host side); text beyond it in a 1 s window is dropped unparsed.
    constructor(link, accept, onMsg, stats, opts) {
      this.link = link; this.accept = accept; this.onMsg = onMsg; this.stats = stats || newStats();
      this.fragId = 0; this.frags = new Map();
      this.budget = opts && opts.bytesPerSec > 0 ? opts.bytesPerSec : 0; this.win = { at: -1e9, bytes: 0 }; this.overBudget = 0;
      link.on('message', (ch, text) => this._in(ch, text));
    }
    send(msg, ch) {
      if (!this.link.open) return false;
      ch = ch || (ST_TYPES.has(msg.t) ? 'st' : 'ctl');
      const text = JSON.stringify(msg);
      this.stats.msgsOut++; tapMsg('out', ch, msg.t, text.length);
      try {
        if (text.length <= FRAG) { this.link.send(ch, text); this.stats.bytesOut += text.length; return true; }
        const id = ++this.fragId, n = Math.ceil(text.length / FRAG);
        for (let i = 0; i < n; i++) {
          const piece = JSON.stringify({ t: 'frag', id, i, n, c: ch, d: text.slice(i * FRAG, (i + 1) * FRAG) });
          this.link.send('ctl', piece); this.stats.bytesOut += piece.length;
        }
        return true;
      } catch (e) { return false; }
    }
    _drop() { this.stats.dropped++; }
    _in(ch, text, inner) {
      if (typeof text !== 'string') {
        if (text && typeof TextDecoder !== 'undefined' && (text instanceof ArrayBuffer || ArrayBuffer.isView(text))) text = new TextDecoder().decode(text);
        else return this._drop();
      }
      if (!inner) {
        this.stats.bytesIn += text.length;
        if (this.budget) {
          const n = now();
          if (n - this.win.at >= 1000) this.win = { at: n, bytes: 0 };
          if ((this.win.bytes += text.length) > this.budget) { this.overBudget++; return this._drop(); }
        }
      }
      if (text.length > MAX_TEXT) return this._drop();
      let msg;
      try { msg = JSON.parse(text); } catch (e) { return this._drop(); }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return this._drop();
      if (msg.t === 'frag') {
        if (inner || !isInt(msg.id) || !isInt(msg.i) || !isInt(msg.n) || msg.n < 1 || msg.n > Math.ceil(MAX_TEXT / FRAG) || msg.i < 0 || msg.i >= msg.n || typeof msg.d !== 'string') return this._drop();
        let f = this.frags.get(msg.id);
        if (!f) {
          if (this.frags.size >= 8) this.frags.delete(this.frags.keys().next().value);
          f = { n: msg.n, parts: new Array(msg.n), got: 0, c: msg.c === 'st' ? 'st' : 'ctl', size: 0 }; this.frags.set(msg.id, f);
        }
        if (f.parts[msg.i] === undefined) { f.parts[msg.i] = msg.d; f.got++; f.size += msg.d.length; }
        if (f.size > MAX_TEXT) { this.frags.delete(msg.id); return this._drop(); }
        if (f.got === f.n) { this.frags.delete(msg.id); this._in(f.c, f.parts.join(''), true); }
        return undefined;
      }
      if (!this.accept.has(msg.t)) return this._drop();
      this.stats.msgsIn++; tapMsg('in', ch, msg.t, text.length);
      return safely(this.onMsg, msg, ch);
    }
  }

  // ------------------------------------------------------------------ links and buses (§1.2)
  function makeLink(id, remoteId, impl) {
    const l = emitter({ id, remoteId, open: true, kind: impl.kind || '' });
    l.send = (ch, text) => { if (l.open) impl.send(ch, text); };
    l.bufferedAmount = ch => (impl.buffered ? impl.buffered(ch) : 0);
    l.close = reason => {
      if (!l.open) return;
      l.open = false;
      if (impl.close) safely(impl.close, reason);
      l.emit('close', reason || 'closed');
    };
    l._remoteClosed = reason => { if (!l.open) return; l.open = false; if (impl.dispose) safely(impl.dispose); l.emit('close', reason || 'remote-close'); };
    return l;
  }

  const demux = new WeakMap();
  function subscribe(bus, fn) {
    let d = demux.get(bus);
    if (!d) {
      d = new Set(); demux.set(bus, d);
      const deliver = (f, t, c, x) => { for (const h of Array.from(d)) safely(h, f, t, c, x); };
      if (typeof bus.subscribe === 'function') bus.subscribe(deliver);
      else if (typeof bus.onMessage === 'function') bus.onMessage(deliver);
      else if (typeof bus.addListener === 'function') bus.addListener(deliver);
      else if ('onmessage' in bus && !('inbox' in bus)) bus.onmessage = deliver;
      else bus.inbox = deliver;
    }
    d.add(fn);
    return () => d.delete(fn);
  }

  let defaultBc = null;
  function broadcastBus(name = 'cnd2-mp') {
    if (typeof root.BroadcastChannel !== 'function') throw netError('webrtc-unsupported', 'BroadcastChannel missing');
    const bc = new root.BroadcastChannel(name), subs = new Set();
    const deliver = m => { if (m && typeof m === 'object') for (const fn of Array.from(subs)) safely(fn, m.f, m.t, m.c, m.x); };
    bc.onmessage = e => deliver(e.data);
    return {
      kind: 'broadcast',
      send(f, t, c, x) { const m = { f, t, c, x }; bc.postMessage(m); setTimeout(() => deliver(m), 0); },
      subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
      close() { bc.close(); subs.clear(); },
    };
  }

  // In-memory bus with latency/jitter/loss/reorder (seeded), realtime or manual time — for Node tests and same-page play.
  function memoryBus({ latency = 0, jitter = 0, loss = 0, reorder = 0, seed = 1, mode = 'realtime' } = {}) {
    let s = seed >>> 0 || 1;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const subs = new Set(), q = [], lastCtl = new Map(), cutIds = new Set(), blocks = [];
    const stats = { msgs: 0, bytes: 0, lost: 0, byKey: {} };
    let t = 0, seq = 0, timer = null;
    const clock = () => (mode === 'manual' ? t : now());
    const deliver = m => { for (const fn of Array.from(subs)) safely(fn, m.f, m.to, m.c, m.x); };
    function pump() {
      timer = null;
      const n = clock();
      q.sort((a, b) => a.at - b.at || a.seq - b.seq);
      while (q.length && q[0].at <= n) deliver(q.shift());
      if (q.length && mode !== 'manual') { timer = setTimeout(pump, Math.max(0, q[0].at - clock())); if (timer.unref) timer.unref(); }
    }
    function op(x) { try { return JSON.parse(x).op; } catch (e) { return null; } }
    const bus = {
      kind: 'memory',
      send(f, to, c, x) {
        if (cutIds.has(f) || cutIds.has(to)) return;
        if (c === '_' && op(x) === 'connect' && blocks.length) {
          const kind = blocks.shift();
          const reply = JSON.stringify({ op: 'fail', code: kind === 'ice' ? 'ice-failed' : kind, link: (JSON.parse(x) || {}).link });
          q.push({ at: clock() + latency, seq: ++seq, f: to, to: f, c: '_', x: reply });
          if (mode !== 'manual' && !timer) timer = setTimeout(pump, 0);
          return;
        }
        const k = f + '>' + to + ':' + c + ':' + ((/"t":"([a-z]+)"/.exec(x) || [])[1] || op(x) || '?');
        const e = stats.byKey[k] || (stats.byKey[k] = { msgs: 0, bytes: 0 });
        e.msgs++; e.bytes += x.length; stats.msgs++; stats.bytes += x.length;
        if (c === 'st' && loss && rnd() < loss) { stats.lost++; return; }
        let at = clock() + Math.max(0, latency + (jitter ? (rnd() * 2 - 1) * jitter : 0));
        if (c === 'st' && reorder && rnd() < reorder) at += 2 * jitter + 5;
        if (c !== 'st') { const pk = f + '>' + to; at = Math.max(at, lastCtl.get(pk) || 0); lastCtl.set(pk, at); }
        q.push({ at, seq: ++seq, f, to, c, x });
        if (mode !== 'manual') { if (timer) clearTimeout(timer); timer = setTimeout(pump, 0); if (timer.unref) timer.unref(); }
      },
      subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
      advance(ms) { t += ms; pump(); },
      flushAll(limit = 100000) {
        let n = 0;
        while (q.length && n++ < limit) { q.sort((a, b) => a.at - b.at || a.seq - b.seq); const m = q.shift(); if (mode === 'manual') t = Math.max(t, m.at); deliver(m); }
      },
      pending: () => q.length,
      time: () => clock(),
      stats: () => JSON.parse(JSON.stringify(stats)),
      cut(id) { cutIds.add(id); const ids = new Set(); for (const m of q) { if (m.f === id) ids.add(m.to); if (m.to === id) ids.add(m.f); } for (const k of lastCtl.keys()) { const [a, b] = k.split('>'); if (a === id) ids.add(b); if (b === id) ids.add(a); } for (let i = q.length - 1; i >= 0; i--) if (q[i].f === id || q[i].to === id) q.splice(i, 1); for (const o of ids) deliver({ f: id, to: o, c: '_', x: JSON.stringify({ op: 'cut' }) }); },
      uncut(id) { cutIds.delete(id); },
      block(kind = 'ice') { blocks.push(kind); },
      set(o) { if ('latency' in o) latency = o.latency; if ('jitter' in o) jitter = o.jitter; if ('loss' in o) loss = o.loss; if ('reorder' in o) reorder = o.reorder; },
      close() { subs.clear(); q.length = 0; if (timer) clearTimeout(timer); },
    };
    return bus;
  }

  function resolveBus(bus) {
    if (bus) return bus;
    if (root.__MP_BUS) return root.__MP_BUS;
    if (!defaultBc) defaultBc = broadcastBus();
    return defaultBc;
  }

  // ------------------------------------------------------------------ bus transports: loopback and rtc-local
  function busTransport(kind, { bus, name, connectTimeout = 1000, claimMs = 120, linkMs = 12000, iceServers = [] } = {}) {
    bus = resolveBus(bus);
    const t = emitter({ kind, id: null, closed: false });
    const links = new Map();       // remoteId -> link
    const pend = new Map();        // link token -> {resolve, reject, cancel}
    const claims = new Map();      // temp id -> reject
    const rtc = new Map();         // token -> {pc, chans, link}
    const myIds = new Set();
    let listening = false, incoming = null;
    const unsub = subscribe(bus, onEnv);
    const sendOp = (to, o) => bus.send(t.id, to, '_', JSON.stringify(o));

    function onEnv(from, to, ch, text) {
      if (t.closed || !myIds.has(to)) return;
      if (ch !== '_') { const l = links.get(from); if (l && l.open && kind === 'loopback') l.emit('message', ch, text); return; }
      let o; try { o = JSON.parse(text); } catch (e) { return; }
      if (!o || typeof o.op !== 'string') return;
      switch (o.op) {
        case 'claim': if (listening && to === t.id) bus.send(t.id, from, '_', JSON.stringify({ op: 'taken' })); break;
        case 'taken': { const rej = claims.get(to); if (rej) rej(); break; }
        case 'connect': {
          if (!listening || to !== t.id) break;
          const old = links.get(from); if (old) old._remoteClosed('replaced');
          sendOp(from, { op: 'open', link: o.link });
          if (kind === 'loopback') { const l = busLink(from); if (incoming) incoming(l); }
          else rtcAnswerSide(from, o.link);
          break;
        }
        case 'open': { const p = pend.get(o.link); if (p) p.opened(from); break; }
        case 'fail': { const p = o.link ? pend.get(o.link) : pend.values().next().value; if (p) p.fail(o.code || 'ice-failed'); break; }
        case 'close': case 'cut': {
          const l = links.get(from);
          if (o.op === 'cut' && !l) { for (const x of Array.from(links.values())) x._remoteClosed('cut'); break; }
          if (l) l._remoteClosed(o.op === 'cut' ? 'cut' : 'remote-close');
          break;
        }
        case 'rtc-offer': case 'rtc-answer': case 'rtc-ice': rtcSignal(from, o); break;
        default: break;
      }
    }

    function busLink(remote) {
      const l = makeLink(t.id, remote, {
        kind,
        send: (ch, text) => bus.send(t.id, remote, ch === 'st' ? 'st' : 'ctl', text),
        close: () => { sendOp(remote, { op: 'close' }); links.delete(remote); },
        dispose: () => links.delete(remote),
      });
      links.set(remote, l);
      return l;
    }

    // ---- rtc-local: real RTCPeerConnection, signalling over the bus
    function rtcLink(remote, token, pc, chans) {
      const l = makeLink(t.id, remote, {
        kind,
        send: (ch, text) => { const c = chans[ch] && chans[ch].readyState === 'open' ? chans[ch] : chans.ctl; c.send(text); },
        buffered: ch => (chans[ch] ? chans[ch].bufferedAmount : 0),
        close: () => { sendOp(remote, { op: 'close' }); links.delete(remote); rtc.delete(token); try { pc.close(); } catch (e) { /* closed */ } },
        dispose: () => { links.delete(remote); rtc.delete(token); try { pc.close(); } catch (e) { /* closed */ } },
      });
      for (const name of ['ctl', 'st']) chans[name].onmessage = e => l.open && l.emit('message', name, e.data);
      chans.ctl.onclose = () => l._remoteClosed('remote-close');
      pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') l._remoteClosed('ice-failed'); };
      links.set(remote, l);
      return l;
    }
    function newPc(remote, token) {
      if (typeof root.RTCPeerConnection !== 'function') throw netError('webrtc-unsupported');
      const pc = new root.RTCPeerConnection({ iceServers });
      pc.onicecandidate = e => { if (e.candidate) sendOp(remote, { op: 'rtc-ice', link: token, c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
      return pc;
    }
    function whenOpen(chans, cb) {
      const check = () => { if (chans.ctl && chans.st && chans.ctl.readyState === 'open' && chans.st.readyState === 'open') { cb(); return true; } return false; };
      for (const c of Object.values(chans)) if (c) c.addEventListener('open', check);
      return check;
    }
    function rtcAnswerSide(remote, token) {
      let pc;
      try { pc = newPc(remote, token); } catch (e) { return; }
      const chans = {}, ent = { pc, chans, remote, done: false };
      rtc.set(token, ent);
      const fire = () => { if (ent.done) return; ent.done = true; const l = rtcLink(remote, token, pc, chans); if (incoming) incoming(l); };
      pc.ondatachannel = e => { chans[e.channel.label] = e.channel; const c = whenOpen(chans, fire); c(); };
      after(linkMs, () => { if (!ent.done) { rtc.delete(token); try { pc.close(); } catch (e) { /* closed */ } } });
    }
    async function rtcSignal(from, o) {
      const ent = rtc.get(o.link);
      if (!ent) return;
      try {
        if (o.op === 'rtc-offer') {
          await ent.pc.setRemoteDescription(o.sdp);
          const ans = await ent.pc.createAnswer(); await ent.pc.setLocalDescription(ans);
          sendOp(from, { op: 'rtc-answer', link: o.link, sdp: { type: ans.type, sdp: ans.sdp } });
          for (const c of ent.early || []) await ent.pc.addIceCandidate(c).catch(() => {});
          ent.early = null; ent.ready = true;
        } else if (o.op === 'rtc-answer') {
          await ent.pc.setRemoteDescription(o.sdp);
          for (const c of ent.early || []) await ent.pc.addIceCandidate(c).catch(() => {});
          ent.early = null; ent.ready = true;
        } else if (o.op === 'rtc-ice') {
          if (!ent.ready) (ent.early || (ent.early = [])).push(o.c);
          else await ent.pc.addIceCandidate(o.c).catch(() => {});
        }
      } catch (e) { /* the link watchdog reports ice-failed */ }
    }

    t.listen = peerId => new Promise((resolve, reject) => {
      if (t.closed) return reject(netError('broker', 'transport closed'));
      const finish = () => { t.id = peerId; myIds.add(peerId); listening = true; resolve(); };
      if (typeof bus.claim === 'function') {
        return Promise.resolve(bus.claim(peerId)).then(ok => (ok === false ? reject(Object.assign(netError('broker', 'id taken'), { code: 'id-taken' })) : finish()), reject);
      }
      const tmp = 'lb-claim-' + randomId(8);
      myIds.add(tmp);
      let done = false;
      claims.set(tmp, () => { if (done) return; done = true; claims.delete(tmp); myIds.delete(tmp); reject(Object.assign(netError('broker', 'id taken'), { code: 'id-taken' })); });
      bus.send(tmp, peerId, '_', JSON.stringify({ op: 'claim' }));
      after(claimMs, () => { if (done) return; done = true; claims.delete(tmp); myIds.delete(tmp); finish(); });
      return undefined;
    });
    t.onIncoming = fn => { incoming = fn; };
    t.connect = peerId => new Promise((resolve, reject) => {
      if (t.closed) return reject(netError('broker', 'transport closed'));
      if (!t.id) { t.id = name || 'lb-' + randomId(10); myIds.add(t.id); }
      const token = randomId(10);
      let state = 'connecting';
      const cancelers = [];
      const done = () => { pend.delete(token); cancelers.forEach(c => c()); };
      const p = {
        fail: c => { if (state === 'done') return; state = 'done'; done(); const r = rtc.get(token); if (r) { rtc.delete(token); try { r.pc.close(); } catch (e) { /* closed */ } } reject(netError(c)); },
        opened: from => {
          if (state !== 'connecting') return;
          if (kind === 'loopback') { state = 'done'; done(); resolve(busLink(from)); return; }
          state = 'rtc';
          let pc; try { pc = newPc(from, token); } catch (e) { p.fail(e.code || 'webrtc-unsupported'); return; }
          const chans = { ctl: pc.createDataChannel('ctl', { ordered: true }), st: pc.createDataChannel('st', { ordered: false, maxRetransmits: 0 }) };
          const ent = { pc, chans, remote: from };
          rtc.set(token, ent);
          const c = whenOpen(chans, () => { if (state !== 'rtc') return; state = 'done'; done(); resolve(rtcLink(from, token, pc, chans)); });
          c();
          pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') p.fail('ice-failed'); };
          (async () => {
            try { const off = await pc.createOffer(); await pc.setLocalDescription(off); sendOp(from, { op: 'rtc-offer', link: token, sdp: { type: off.type, sdp: off.sdp } }); }
            catch (e) { p.fail('ice-failed'); }
          })();
        },
      };
      pend.set(token, p);
      cancelers.push(after(connectTimeout, () => { if (state === 'connecting') p.fail('bad-code'); }));
      cancelers.push(after(linkMs, () => { if (state === 'rtc') p.fail('ice-failed'); }));
      sendOp(peerId, { op: 'connect', link: token });
      return undefined;
    });
    t.close = () => {
      if (t.closed) return;
      for (const l of Array.from(links.values())) l.close('transport-closed');
      for (const p of Array.from(pend.values())) p.fail('cancelled');
      t.closed = true; listening = false; unsub();
    };
    t.links = () => Array.from(links.values());
    return t;
  }

  // ------------------------------------------------------------------ PeerJS (§1.2, D-MP12)
  let peerjsPromise = null;
  function peerCtor() {
    const pj = root.peerjs;
    return (pj && (pj.Peer || (pj.default && pj.default.Peer) || (typeof pj.default === 'function' && pj.default))) || (typeof root.Peer === 'function' ? root.Peer : null);
  }
  function detectRelay() {
    const pj = root.peerjs;
    const cfg = pj && pj.util && pj.util.defaultConfig;
    const list = (cfg && cfg.iceServers) || [];
    relayKnown = list.some(s => [].concat(s.urls || s.url || []).some(u => /^turns?:/i.test(u)));
    return relayKnown;
  }
  // TURN relay credentials from the site's own /api/turn (api/turn.js on Vercel). Without a relay, two players behind
  // strict NATs (mobile data, campus, office networks) can never reach each other. Same-origin http(s) only; any
  // failure falls back to PeerJS's defaults so a missing endpoint never blocks direct play.
  const BASE_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  async function relayServers(timeout = 5000) {
    const loc = root.location;
    if (!loc || !/^https?:$/.test(loc.protocol) || typeof root.fetch !== 'function') return [];
    try {
      const ctl = typeof root.AbortController === 'function' ? new root.AbortController() : null;
      const timer = ctl && setTimeout(() => ctl.abort(), timeout);
      const res = await root.fetch('/api/turn', { cache: 'no-store', signal: ctl && ctl.signal });
      if (timer) clearTimeout(timer);
      if (!res.ok) return [];
      const body = await res.json();
      const list = [].concat(body && body.iceServers || []).filter(s => s && (s.urls || s.url));
      if (list.some(s => [].concat(s.urls || s.url).some(u => /^turns?:/i.test(u)))) relayKnown = true;
      return list;
    } catch (e) { return []; }
  }
  function loadPeerJS({ timeout = 10000, urls = [PEERJS_URL, PEERJS_FALLBACK_URL] } = {}) {
    if (peerCtor()) { detectRelay(); return Promise.resolve(); }
    if (peerjsPromise) return peerjsPromise;
    if (!root.document) return Promise.reject(netError('peerjs-load', 'no document'));
    peerjsPromise = new Promise((resolve, reject) => {
      let finished = false;
      const end = err => { if (finished) return; finished = true; if (err) { peerjsPromise = null; reject(err); } else { detectRelay(); resolve(); } };
      const timer = setTimeout(() => end(netError('peerjs-load', 'timeout')), timeout);
      const tryUrl = i => {
        if (i >= urls.length) { clearTimeout(timer); return end(netError('peerjs-load', 'both CDNs failed')); }
        const s = root.document.createElement('script');
        s.src = urls[i]; s.async = true; s.crossOrigin = 'anonymous'; s.dataset.edenNet = 'peerjs';
        s.onload = () => { if (peerCtor()) { clearTimeout(timer); end(null); } else tryUrl(i + 1); };
        s.onerror = () => { s.remove(); tryUrl(i + 1); };
        (root.document.head || root.document.documentElement).appendChild(s);
      };
      tryUrl(0);
    });
    return peerjsPromise;
  }
  const PEER_ERR = {
    'unavailable-id': 'id-taken', 'peer-unavailable': 'bad-code', 'browser-incompatible': 'webrtc-unsupported', 'webrtc': 'ice-failed',
    'network': 'broker', 'server-error': 'broker', 'socket-error': 'broker', 'socket-closed': 'broker', 'ssl-unavailable': 'broker', 'invalid-key': 'broker', 'invalid-id': 'broker', 'disconnected': 'broker',
  };
  const peerErr = e => { const c = PEER_ERR[e && e.type] || 'broker'; const err = netError(c === 'id-taken' ? 'broker' : c, e && (e.type || e.message)); err.code = c; return err; };

  function peerjsTransport({ peerOptions = {}, brokerMs = 10000, linkMs = 12000, stGraceMs = 3000 } = {}) {
    const Peer = peerCtor();
    if (!Peer) throw netError('peerjs-load', 'PeerJS is not loaded');
    if (typeof root.RTCPeerConnection !== 'function') throw netError('webrtc-unsupported');
    const t = emitter({ kind: 'peerjs', id: null, peer: null, closed: false, brokerUp: false });
    const groups = new Map();   // remote peer id -> {ctl, st, link}
    let incoming = null, reconnecting = null;
    const opts = Object.assign({ debug: 0 }, peerOptions);

    function openPeer(id) {
      return new Promise((resolve, reject) => {
        const peer = id ? new Peer(id, opts) : new Peer(opts);
        t.peer = peer;
        let opened = false;
        const timer = setTimeout(() => { if (!opened) { reject(netError('broker', 'timeout')); try { peer.destroy(); } catch (e) { /* gone */ } } }, brokerMs);
        peer.on('open', pid => { opened = true; clearTimeout(timer); t.id = pid; t.brokerUp = true; t.emit('broker', true); resolve(peer); });
        peer.on('error', e => {
          const err = peerErr(e);
          if (!opened) { clearTimeout(timer); try { peer.destroy(); } catch (x) { /* gone */ } reject(err); return; }
          t.emit('peer-error', err);
        });
        peer.on('disconnected', () => {
          t.brokerUp = false; t.emit('broker', false);
          if (t.closed || reconnecting) return;
          reconnecting = every(5000, () => {
            if (t.closed || peer.destroyed) { reconnecting(); reconnecting = null; return; }
            if (!peer.disconnected) { reconnecting(); reconnecting = null; t.brokerUp = true; t.emit('broker', true); return; }
            try { peer.reconnect(); } catch (e) { /* try again */ }
          });
        });
        peer.on('connection', dc => adopt(dc));
      });
    }
    function group(remote) {
      let g = groups.get(remote);
      if (!g) { g = { remote, ctl: null, st: null, link: null, stTimer: null }; groups.set(remote, g); }
      return g;
    }
    function buildLink(g) {
      const l = makeLink(t.id, g.remote, {
        kind: 'peerjs',
        send: (ch, text) => { const dc = ch === 'st' && g.st && g.st.open ? g.st : g.ctl; dc.send(text); },
        buffered: ch => { const dc = ch === 'st' && g.st ? g.st : g.ctl; const c = dc && dc.dataChannel; return c ? c.bufferedAmount : 0; },
        close: () => { groups.delete(g.remote); try { g.ctl && g.ctl.close(); } catch (e) { /* gone */ } try { g.st && g.st.close(); } catch (e) { /* gone */ } },
        dispose: () => { groups.delete(g.remote); try { g.st && g.st.close(); } catch (e) { /* gone */ } },
      });
      g.link = l;
      return l;
    }
    function wire(g, dc) {
      dc.on('data', d => { if (g.link && g.link.open) g.link.emit('message', dc.label === 'st' ? 'st' : 'ctl', typeof d === 'string' ? d : d); });
      dc.on('close', () => { if (dc.label === 'ctl' && g.link) g.link._remoteClosed('remote-close'); });
      dc.on('error', () => { /* close follows */ });
    }
    function adopt(dc) {   // host: an incoming DataConnection
      const g = group(dc.peer);
      if (dc.label === 'st') g.st = dc; else g.ctl = dc;
      wire(g, dc);
      const ready = () => {
        if (g.link || !g.ctl || !g.ctl.open) return;
        if (g.st && !g.st.open && !g.stTimer) { g.stTimer = setTimeout(() => { g.stTimer = 'expired'; ready(); }, stGraceMs); return; }
        if (g.st && !g.st.open && g.stTimer !== 'expired') return;
        if (!g.st && g.stTimer !== 'expired') { if (!g.stTimer) g.stTimer = setTimeout(() => { g.stTimer = 'expired'; ready(); }, stGraceMs); return; }
        if (g.stTimer && g.stTimer !== 'expired') clearTimeout(g.stTimer);
        const l = buildLink(g);
        if (incoming) incoming(l);
      };
      dc.on('open', ready);
      if (dc.open) ready();
      setTimeout(() => { if (!g.link && groups.get(g.remote) === g) { groups.delete(g.remote); try { dc.close(); } catch (e) { /* gone */ } } }, linkMs);
    }

    t.listen = async peerId => {
      if (!peerId) throw netError('broker', 'no room id');   // never open a random-id Peer for a host
      if (t.peer && !t.peer.destroyed) { try { t.peer.destroy(); } catch (e) { /* gone */ } t.peer = null; }
      await openPeer(peerId);
    };
    t.onIncoming = fn => { incoming = fn; };
    t.connect = async peerId => {
      if (!t.peer) await openPeer(null);
      t.emit('progress', 'host');
      return new Promise((resolve, reject) => {
        const g = group(peerId);
        let settled = false;
        const fail = err => {
          if (settled) return; settled = true; clearTimeout(watch); t.off('peer-error', onErr); t.off('broker', onBroker);
          groups.delete(peerId); try { g.ctl && g.ctl.close(); g.st && g.st.close(); } catch (e) { /* gone */ } reject(err);
        };
        const watch = setTimeout(() => fail(netError('ice-failed', 'timeout')), linkMs);
        // While the data channels are still opening, the broker carries the signalling: an error from it (or the
        // broker dropping) means "can't reach the matchmaking server", not "your network blocks direct connections".
        const onErr = err => { if (err.code === 'bad-code' || err.code === 'ice-failed' || err.code === 'broker' || err.code === 'webrtc-unsupported') fail(err); };
        const onBroker = up => { if (!up && !(g.ctl && g.ctl.open)) fail(netError('broker', 'disconnected while connecting')); };
        t.on('peer-error', onErr); t.on('broker', onBroker);
        g.ctl = t.peer.connect(peerId, { label: 'ctl', reliable: true, serialization: 'raw' });
        g.st = t.peer.connect(peerId, { label: 'st', reliable: false, serialization: 'raw' });
        wire(g, g.ctl); wire(g, g.st);
        const ok = () => {
          if (settled) return;
          if (!g.ctl.open || (!g.st.open && !g.grace)) return;
          settled = true; clearTimeout(watch); t.off('peer-error', onErr); t.off('broker', onBroker);
          resolve(buildLink(g));
        };
        g.ctl.on('open', () => { setTimeout(() => { g.grace = true; ok(); }, stGraceMs); ok(); });
        g.st.on('open', ok);
        const pcWatch = setInterval(() => {
          if (settled) { clearInterval(pcWatch); return; }
          const pc = g.ctl && g.ctl.peerConnection;
          if (pc && (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed')) { clearInterval(pcWatch); fail(netError('ice-failed')); }
        }, 250);
      });
    };
    t.close = () => {
      if (t.closed) return;
      t.closed = true;
      if (reconnecting) { reconnecting(); reconnecting = null; }
      for (const g of Array.from(groups.values())) if (g.link) g.link.close('transport-closed');
      groups.clear();
      try { t.peer && t.peer.destroy(); } catch (e) { /* gone */ }
    };
    return t;
  }

  // ------------------------------------------------------------------ relay: one WebSocket per peer through relay/
  // Protocol (relay/src/index.js has the full description; tests/fixtures/relay-node.cjs is the same thing in Node):
  //   wss://<relay>/room/DINO-XXXX?role=host|join&cid=<client id>
  //   frames "<peer>|<ch>\n<payload>": to the relay <peer> is the destination (the host names a joiner's relay id,
  //   a joiner's frames always reach the host), from the relay it is the source. Control frames "@\n<json>":
  //   welcome{id,role}, joined{id,cid}, left{id}, close{code,reason} from the relay; close{id} from the host.
  //   Close codes: 4000 host-left, 4001 room-full, 4002 host-exists, 4004 no-host, 4005 replaced, 4009 too-big,
  //   4010 closed-by-host, 4029 rate-limit. "ping" is answered "pong" (keep-alive).
  // Batching: what a socket sends to one peer within batchMs goes out as one frame, the messages joined by "\n" (JSON
  // text never contains a raw newline; the frame is labelled "ctl" when any of them is), so a relayed player costs the
  // relay ~30 messages a second per direction instead of 60-80 (the free plan bills incoming messages). The relay
  // never looks inside a payload.
  let relayOverride = null;   // tests (Node): NET._test.setRelay(url | '' | null)
  function cleanRelay(v, fromPage) {
    let s = String(v == null ? '' : v).trim();
    if (!s || /^(off|none|0|false)$/i.test(s)) return '';
    s = s.replace(/^http(s?):\/\//i, 'ws$1://').replace(/\/+$/, '');
    const m = /^(wss?):\/\/([^/?#\s]+)(\/[^?#\s]*)?$/i.exec(s);
    if (!m) return null;
    // a page link may point at a test relay on this computer, or at any relay over wss:// (never plain ws:// elsewhere)
    if (fromPage && m[1].toLowerCase() === 'ws' && !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(m[2])) return null;
    return s;
  }
  function relayUrl() {
    const q = (root.location && root.location.search) || '';
    const m = /[?&]relay=([^&#]*)/i.exec(q);
    if (m) {
      let v = m[1]; try { v = decodeURIComponent(v); } catch (e) { /* keep raw */ }
      const u = cleanRelay(v, true);
      if (u !== null) return u;
    }
    return cleanRelay(relayOverride !== null ? relayOverride : RELAY_URL) || '';
  }
  const RELAY_CLOSE = { 4000: 'host-left', 4001: 'full', 4002: 'id-taken', 4004: 'bad-code', 4005: 'replaced', 4009: 'relay-down', 4010: 'host-left', 4029: 'relay-down' };
  function relayError(code) {
    const c = RELAY_CLOSE[code] || 'relay-down';
    if (c === 'id-taken') return Object.assign(netError('broker', 'room code taken on the relay'), { code: 'id-taken' });
    if (c === 'replaced') return netError('cancelled', 'replaced');
    return netError(c, c === 'relay-down' ? 'relay close ' + (code || 'abnormal') : '');
  }
  const relayRoom = peerId => code.normalize(String(peerId || '').replace(/^cnd2-/i, ''));

  function relayTransport({ url = relayUrl(), cid = null, openMs = 8000, keepAliveMs = 25000, reconnectMs = 4000, batchMs = 33, maxBatch = 48000 } = {}) {
    url = cleanRelay(url);
    if (!url) throw netError('relay-down', 'no relay configured');
    const WS = root.WebSocket;
    if (typeof WS !== 'function') throw netError('webrtc-unsupported', 'WebSocket missing');
    const t = emitter({ kind: 'relay', id: null, closed: false, brokerUp: false, url });
    const myCid = cid && /^[A-Za-z0-9_-]{4,32}$/.test(cid) ? cid : randomId(12);
    const links = new Map();   // host: joiner relay id -> link
    let incoming = null, hostSock = null, hostPeerId = null, reconnecting = null;

    // One socket: resolves {ws, id} on the relay's welcome; rejects with the mapped error if it closes first.
    function openSocket(peerId, role) {
      const room = relayRoom(peerId);
      if (!room) return Promise.reject(netError('bad-code', 'not a room id'));
      return new Promise((resolve, reject) => {
        let ws;
        try { ws = new WS(url + '/room/' + room + '?role=' + role + '&cid=' + encodeURIComponent(myCid)); } catch (e) { reject(netError('relay-down', e && e.message)); return; }
        try { ws.binaryType = 'arraybuffer'; } catch (e) { /* default */ }
        const sock = { ws, id: null, open: false, onMsg: null, onGone: null, timer: null, ka: null, queue: [], qlen: 0, flushT: null };
        let done = false;
        const fail = err => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch (e) { /* closing */ } reject(err); };
        const timer = setTimeout(() => fail(netError('relay-down', 'timeout')), openMs);
        const gone = (code, why) => {
          if (!done) { fail(relayError(code)); return; }
          if (!sock.open) return;
          sock.open = false; clearInterval(sock.ka); clearTimeout(sock.flushT);
          try { ws.close(1000); } catch (e) { /* closing */ }
          if (sock.onGone) safely(sock.onGone, code, why);
        };
        ws.onmessage = e => {
          const d = e.data;
          if (typeof d === 'string') {
            if (d === 'pong') return;
            if (d.charCodeAt(0) === 64 && d.charCodeAt(1) === 10) {   // "@\n"
              let o; try { o = JSON.parse(d.slice(2)); } catch (x) { return; }
              if (!o || typeof o.op !== 'string') return;
              if (o.op === 'welcome' && !done) {
                done = true; clearTimeout(timer); sock.id = String(o.id || ''); sock.open = true;
                sock.ka = setInterval(() => { try { if (ws.readyState === 1) ws.send('ping'); } catch (x) { /* closing */ } }, keepAliveMs);
                if (sock.ka && sock.ka.unref) sock.ka.unref();
                resolve(sock);
                return;
              }
              if (o.op === 'close') { gone(o.code | 0, o.reason || ''); return; }
              if (done && sock.onMsg) safely(sock.onMsg, '@', '', o);
              return;
            }
            const i = d.indexOf('\n'); if (i < 1 || !done || !sock.onMsg) return;
            const head = d.slice(0, i), bar = head.indexOf('|');
            const ch = head.slice(bar + 1) === 'st' ? 'st' : 'ctl', body = d.slice(i + 1);
            for (const part of body.split('\n')) if (part) sock.onMsg(head.slice(0, bar), ch, part);
            return;
          }
          if (!done || !sock.onMsg) return;
          const u8 = new Uint8Array(d && d.buffer ? d.buffer : d), n = u8[0];
          if (!n || u8.length < 1 + n) return;
          let head = ''; for (let k = 1; k <= n; k++) head += String.fromCharCode(u8[k]);
          const bar = head.indexOf('|');
          sock.onMsg(head.slice(0, bar), head.slice(bar + 1) === 'st' ? 'st' : 'ctl', u8.subarray(1 + n));
        };
        ws.onclose = e => gone(e && e.code, e && e.reason);
        ws.onerror = () => { /* the close event follows */ };
      });
    }
    function flush(sock) {
      sock.flushT = null;
      const q = sock.queue;
      sock.queue = []; sock.qlen = 0;
      if (!sock.open || !q.length) return;
      // one frame per destination for both channels (over the relay everything is reliable and ordered anyway, and the
      // sessions don't depend on the channel a message came in on), in send order, each frame under maxBatch characters
      const by = new Map();
      for (const m of q) { const l = by.get(m[0]); if (l) l.push(m); else by.set(m[0], [m]); }
      for (const [to, list] of by) {
        let buf = [], len = 0, ch = 'st';
        const out = () => { if (!buf.length) return; try { sock.ws.send(to + '|' + ch + '\n' + buf.join('\n')); } catch (e) { /* closing */ } buf = []; len = 0; ch = 'st'; };
        for (const [, c, text] of list) { if (len + text.length + 1 > maxBatch) out(); buf.push(text); len += text.length + 1; if (c !== 'st') ch = 'ctl'; }
        out();
      }
    }
    function queue(sock, to, ch, text) {
      if (!sock.open) return;
      if (typeof text !== 'string') {   // binary payloads are sent at once, unbatched
        const head = to + '|' + ch, u8 = text instanceof ArrayBuffer ? new Uint8Array(text) : new Uint8Array(text.buffer, text.byteOffset, text.byteLength);
        const buf = new Uint8Array(1 + head.length + u8.length); buf[0] = head.length;
        for (let k = 0; k < head.length; k++) buf[1 + k] = head.charCodeAt(k);
        buf.set(u8, 1 + head.length);
        flush(sock); try { sock.ws.send(buf); } catch (e) { /* closing */ }
        return;
      }
      sock.queue.push([to, ch === 'st' ? 'st' : 'ctl', text]); sock.qlen += text.length;
      if (sock.qlen >= maxBatch) flush(sock);
      else if (!sock.flushT) sock.flushT = setTimeout(() => flush(sock), batchMs);
    }

    // ---- host
    function hostLink(sock, rid) {
      const l = makeLink(t.id, rid, {
        kind: 'relay',
        send: (ch, text) => queue(sock, rid, ch, text),
        buffered: () => (sock.ws.bufferedAmount || 0) + sock.qlen,
        close: () => { links.delete(rid); flush(sock); if (sock.open) try { sock.ws.send('@\n' + JSON.stringify({ op: 'close', id: rid })); } catch (e) { /* closing */ } },
        dispose: () => links.delete(rid),
      });
      links.set(rid, l);
      return l;
    }
    function adoptHost(sock) {
      hostSock = sock;
      sock.onMsg = (from, ch, payload) => {
        if (from === '@') {
          const o = payload;
          if (o.op === 'joined' && typeof o.id === 'string') { const old = links.get(o.id); if (old) old._remoteClosed('replaced'); const l = hostLink(sock, o.id); if (incoming) incoming(l); }
          else if (o.op === 'left') { const l = links.get(o.id); if (l) l._remoteClosed('remote-close'); }
          return;
        }
        const l = links.get(from);
        if (l && l.open) l.emit('message', ch, payload);
      };
      sock.onGone = () => {
        if (hostSock !== sock) return;
        hostSock = null;
        for (const l of Array.from(links.values())) l._remoteClosed('cut');
        t.brokerUp = false; t.emit('broker', false);
        if (!t.closed) reconnect();
      };
      t.brokerUp = true; t.emit('broker', true);
    }
    function reconnect() {
      if (reconnecting || t.closed || !hostPeerId) return;
      reconnecting = setTimeout(() => {
        reconnecting = null;
        if (t.closed || hostSock) return;
        openSocket(hostPeerId, 'host').then(sock => { if (t.closed) { try { sock.ws.close(1000); } catch (e) { /* closing */ } return; } adoptHost(sock); },
          err => { if (err && err.code === 'id-taken') { t.emit('peer-error', netError('relay-down', 'room taken')); return; } reconnect(); });
      }, reconnectMs);
    }
    t.listen = async peerId => {
      if (t.closed) throw netError('relay-down', 'transport closed');
      if (hostSock) { const s = hostSock; hostSock = null; try { s.ws.close(1000); } catch (e) { /* closing */ } }
      const sock = await openSocket(peerId, 'host');
      if (t.closed) { try { sock.ws.close(1000); } catch (e) { /* closing */ } throw netError('cancelled'); }
      t.id = peerId; hostPeerId = peerId;
      adoptHost(sock);
    };
    t.onIncoming = fn => { incoming = fn; };

    // ---- joiner
    t.connect = async peerId => {
      if (t.closed) throw netError('relay-down', 'transport closed');
      t.emit('progress', 'relay');
      const sock = await openSocket(peerId, 'join');
      if (t.closed) { try { sock.ws.close(1000); } catch (e) { /* closing */ } throw netError('cancelled'); }
      t.id = sock.id; t.brokerUp = true;
      const l = makeLink(sock.id, peerId, {
        kind: 'relay',
        send: (ch, text) => queue(sock, 'h', ch, text),
        buffered: () => (sock.ws.bufferedAmount || 0) + sock.qlen,
        close: () => { flush(sock); sock.open = false; clearInterval(sock.ka); try { sock.ws.close(1000, 'left'); } catch (e) { /* closing */ } },
        dispose: () => { sock.open = false; clearInterval(sock.ka); try { sock.ws.close(1000); } catch (e) { /* closing */ } },
      });
      sock.onMsg = (from, ch, payload) => { if (from === 'h' && l.open) l.emit('message', ch, payload); };
      sock.onGone = code => l._remoteClosed(code === 4000 || code === 4010 ? 'remote-close' : code === 4005 ? 'replaced' : 'cut');
      links.set('h', l);
      return l;
    };
    t.close = () => {
      if (t.closed) return;
      t.closed = true;
      if (reconnecting) { clearTimeout(reconnecting); reconnecting = null; }
      for (const l of Array.from(links.values())) l.close('transport-closed');
      links.clear();
      if (hostSock) { const s = hostSock; hostSock = null; flush(s); s.open = false; clearInterval(s.ka); try { s.ws.close(1000); } catch (e) { /* closing */ } }
      t.brokerUp = false;
    };
    t.links = () => Array.from(links.values());
    return t;
  }

  // ------------------------------------------------------------------ auto: direct first, the relay as the fallback
  // Host: listens on both (the same room code on the PeerJS broker and on the relay), so a joiner reaches it either way;
  // one of the two failing is not fatal. Joiner: tries the direct link first ('direct' progress); when it fails, or has
  // not opened after windowMs, it connects through the relay ('relay' progress) and drops the slower direct attempt.
  function autoTransport({ direct = null, relay = null, windowMs = RELAY_WINDOW_MS } = {}) {
    const parts = [direct, relay].filter(Boolean);
    if (!parts.length) throw netError('webrtc-unsupported', 'no transport');
    const t = emitter({ kind: 'auto', id: null, closed: false, brokerUp: false, via: null, listening: [] });
    const up = p => !p.closed && p.brokerUp !== false;
    const update = () => { const u = parts.some(up); if (u !== t.brokerUp) { t.brokerUp = u; t.emit('broker', u); } };
    for (const p of parts) if (p.on) {
      p.on('broker', update);
      p.on('peer-error', e => t.emit('peer-error', e));
      p.on('progress', s => { if (s === 'relay') t.emit('progress', s); });
    }
    t.onIncoming = fn => { for (const p of parts) p.onIncoming(fn); };
    t.listen = async peerId => {
      const res = await Promise.allSettled(parts.map(p => p.listen(peerId)));
      const taken = res.find(r => r.status === 'rejected' && r.reason && r.reason.code === 'id-taken');
      if (taken) throw taken.reason;
      t.listening = parts.filter((p, i) => res[i].status === 'fulfilled').map(p => p.kind);
      if (!t.listening.length) throw res[0].reason;
      t.id = peerId; t.brokerUp = parts.some(up);
      // a part that could not open the room (the broker or the relay unreachable) is reported, the room runs on the other
      res.forEach((r, i) => { if (r.status === 'rejected') t.emit('peer-error', Object.assign(asNetError(r.reason), { part: parts[i].kind })); });
      // the relay could not be reached when the room opened: keep trying in the background, so joiners whose direct
      // link fails can still come in once it answers
      const retry = p => { const h = setTimeout(() => {
        if (t.closed || p.closed || t.id !== peerId) return;
        p.listen(peerId).then(() => { if (!t.listening.includes(p.kind)) t.listening.push(p.kind); update(); }, e => { if (!(e && e.code === 'id-taken')) retry(p); });
      }, 10000); if (h && h.unref) h.unref(); };
      res.forEach((r, i) => { if (r.status === 'rejected' && parts[i].kind === 'relay' && !(r.reason && r.reason.code === 'id-taken')) retry(parts[i]); });
    };
    t.connect = peerId => {
      if (!direct) return relay.connect(peerId).then(l => { t.via = 'relay'; t.id = relay.id; return l; });
      if (!relay) return direct.connect(peerId).then(l => { t.via = direct.kind; t.id = direct.id; return l; });
      return new Promise((resolve, reject) => {
        let settled = false, relayStarted = false, directDone = false, directErr = null, relayErr = null;
        t.emit('progress', 'direct');
        const win = setTimeout(goRelay, windowMs);
        const won = (l, via, loser) => {
          settled = true; clearTimeout(win); t.via = via; t.id = via === 'relay' ? relay.id : direct.id;
          setTimeout(() => { try { loser.close(); } catch (e) { /* closed */ } }, 0);
          resolve(l);
        };
        const finish = () => {
          settled = true; clearTimeout(win);
          const rc = relayErr && relayErr.code;
          let err;
          if (!relayErr) err = directErr;
          else if (rc === 'full' || rc === 'host-left' || rc === 'cancelled') err = relayErr;
          else if (rc === 'bad-code') err = directErr && directErr.code === 'ice-failed' ? directErr : relayErr;   // the host is not on the relay
          else err = directErr || relayErr;                                                                         // the relay is unreachable
          reject(err);
        };
        direct.connect(peerId).then(l => {
          directDone = true;
          if (settled) { l.close('superseded'); return; }
          won(l, direct.kind, relay);
        }, e => {
          directDone = true; directErr = e;
          if (settled) return;
          if (!relayStarted) goRelay(); else if (relayErr) finish();
        });
        function goRelay() {
          if (relayStarted || settled) return;
          relayStarted = true; clearTimeout(win);
          relay.connect(peerId).then(l => {
            if (settled) { l.close('superseded'); return; }
            won(l, 'relay', direct);
          }, e => { relayErr = e; if (settled) return; if (directDone) finish(); /* else the direct attempt may still open */ });
        }
      });
    };
    t.close = () => { if (t.closed) return; t.closed = true; for (const p of parts) try { p.close(); } catch (e) { /* closed */ } };
    t.parts = { direct, relay };
    return t;
  }

  const transports = {
    peerjs: opts => peerjsTransport(opts),
    relay: (opts = {}) => relayTransport(opts),
    auto: (opts = {}) => autoTransport(opts),
    loopback: (opts = {}) => busTransport('loopback', opts),
    rtcLocal: (opts = {}) => busTransport('rtc-local', opts),
  };
  transports['rtc-local'] = transports.rtcLocal;
  function defaultTransport() {
    const q = root.location && root.location.search || '';
    const m = /[?&]net=([a-z-]+)/i.exec(q);
    if (m && /^loopback$/i.test(m[1])) return 'loopback';
    if (m && /^rtc(-local)?$/i.test(m[1])) return 'rtc-local';
    if (m && /^relay$/i.test(m[1])) return 'relay';
    if (m && /^auto$/i.test(m[1])) return 'auto';
    if (m && /^(peerjs|direct)$/i.test(m[1])) return 'peerjs';
    return relayUrl() ? 'auto' : 'peerjs';
  }
  // The direct half of 'auto': PeerJS, or (tests, ?direct=loopback|rtc-local) a bus transport.
  function directKind() {
    const m = /[?&]direct=([a-z-]+)/i.exec((root.location && root.location.search) || '');
    if (m && /^loopback$/i.test(m[1])) return 'loopback';
    if (m && /^rtc(-local)?$/i.test(m[1])) return 'rtc-local';
    return 'peerjs';
  }
  async function peerjsDirect(progress) {
    if (typeof root.RTCPeerConnection !== 'function') throw netError('webrtc-unsupported');
    progress('loading');
    const [, ice] = await Promise.all([loadPeerJS(), relayServers()]);
    progress('broker');
    return transports.peerjs(ice.length ? { peerOptions: { config: { iceServers: BASE_ICE.concat(ice) } } } : undefined);
  }
  async function makeTransport(spec, progress, opts = {}) {
    if (spec && typeof spec === 'object') return spec;
    const kind = spec || defaultTransport();
    if (kind === 'peerjs') return peerjsDirect(progress);
    if (kind === 'relay') return transports.relay({ cid: opts.cid });
    if (kind === 'auto') {
      if (!relayUrl()) return peerjsDirect(progress);
      let direct = null;
      const dk = directKind();
      // PeerJS missing (blocked CDN, no WebRTC) is not fatal here: the relay still works
      try { direct = dk === 'peerjs' ? await peerjsDirect(progress) : transports[dk](); } catch (e) { direct = null; }
      return transports.auto({ direct, relay: transports.relay({ cid: opts.cid }) });
    }
    if (!transports[kind]) throw netError('broker', 'unknown transport ' + kind);
    return transports[kind]();
  }

  // ------------------------------------------------------------------ shared session bits
  const NET = emitter({});
  const REJOIN_KEY = 'cnd2-mp-rejoin';
  let pendingOp = null;     // {cancel} while host()/join() is connecting
  function storage(kind) { try { const s = root[kind]; s.getItem('x'); return s; } catch (e) { return null; } }
  function clientId() {
    const s = storage('sessionStorage');
    let id = s && s.getItem('cnd2-mp-cid');
    if (!id || !/^[a-z0-9]{12}$/.test(id)) { id = randomId(12); if (s) try { s.setItem('cnd2-mp-cid', id); } catch (e) { /* private mode */ } }
    return id;
  }
  const heroCount = adapter => (adapter && Array.isArray(adapter.heroes) && adapter.heroes.length) || 4;
  const schemaOf = adapter => (adapter && adapter.schema) || null;

  // ------------------------------------------------------------------ host session (§1.6, §5.1)
  class HostSession {
    constructor({ adapter, transport, code: roomCode, name, hero, lobby = {}, manual = false }) {
      emitter(this);
      this.role = 'host'; this.adapter = adapter || {}; this.transport = transport; this.code = roomCode;
      this.phase = 'lobby';
      this.settings = { chapter: lobby.chapter | 0, difficulty: lobby.difficulty || 'normal', unlocked: lobby.unlocked == null ? 1 : lobby.unlocked, section: 0 };
      this.me = { slot: 0, name: cleanName(name) || '1P', hero: isInt(hero) && hero >= 0 ? hero : 0 };
      this.clients = new Map(); this.pending = new Set(); this.reserved = new Map(); this.banned = new Set();
      this.simMs = 0; this.timeBase = 0; this.lastSnapMs = -Infinity; this.snapSeq = 0; this.history = []; this.eventSeq = 0; this.slow = false;
      this.paused = { on: false, by: '' };
      this.locked = false; this.lockedUntil = 0;   // lock(on) by the host; a kick also locks out new players for kickLockMs
      this.stats = newStats();
      this.codec = schemaOf(this.adapter) ? makeCodec(schemaOf(this.adapter)) : null;
      this.ended = false;
      this.lastLobbyAt = now();
      this._stopTimer = manual ? null : every(250, () => this.poll());
      transport.onIncoming(link => this._incoming(link));
      if (transport.on) {
        transport.on('broker', up => { this.brokerUp = up; this.emit('status', this.status()); });
        // broker/PeerJS errors after the room is open (the room keeps running; joiners already in are unaffected)
        transport.on('peer-error', err => { if (this.ended) return; this.lastError = err; this.emit('error', err); NET.emit('error', err); });
      }
      this.brokerUp = true;
    }
    get slot() { return 0; }
    get roster() {
      const st = slot => (this.adapter.playerState ? this.adapter.playerState(slot) : null);
      const list = [{ slot: 0, name: this.me.name, hero: this.me.hero, ready: true, host: true, ping: 0, state: this.phase === 'play' ? (st(0) || 'playing') : 'lobby' }];
      for (const c of Array.from(this.clients.values()).sort((a, b) => a.slot - b.slot)) {
        const state = c.warn ? 'away' : c.state === 'playing' ? (st(c.slot) || 'playing') : c.state;
        list.push({ slot: c.slot, name: c.name, hero: c.hero, ready: c.ready, host: false, ping: c.warn ? '!' : Math.round(c.rtt || 0), state });
      }
      return list;
    }
    _lobbyMsg() { return { t: 'lobby', phase: this.phase, roster: this.roster, chapter: this.settings.chapter, difficulty: this.settings.difficulty, unlocked: this.settings.unlocked, locked: this.isLocked }; }
    get isLocked() { return this.locked || now() < this.lockedUntil; }
    // Host toggle: while locked, only players already in the room (or holding a reserved slot) can (re)connect.
    lock(on = true) { this.locked = !!on; if (!on) this.lockedUntil = 0; this._broadcastLobby(); this.emit('status', this.status()); return this.locked; }
    // Host clock in ms, the game's own sim time (§1.7: tm = round(host time × 1000)); simMs between snapshots.
    _hostMs() { return Math.round(this.simMs + this.timeBase); }
    _syncTime(state) {
      const schema = schemaOf(this.adapter), tf = schema && schema.timeField !== undefined ? schema.timeField : 'time';
      const g = state && state.g;
      if (tf && g && typeof g[tf] === 'number' && isFinite(g[tf])) this.timeBase = g[tf] * 1000 - this.simMs;
    }
    _resetLink(c) { c.receiver.reset(); c.acked = -1; c.kfWant = true; c.ackFrameSeq = -1; c.applied = 0; c.sentAt.clear(); }
    _broadcastLobby() {
      const m = this._lobbyMsg();
      for (const c of this.clients.values()) c.wire.send(m);
      this.lastLobbyAt = now();
      this.emit('roster', m.roster); NET.emit('roster', m.roster);
    }
    _heroTaken(h, exceptSlot) {
      if (exceptSlot !== 0 && this.me.hero === h) return true;
      for (const c of this.clients.values()) if (c.slot !== exceptSlot && c.hero === h) return true;
      const n = now();   // a reserved slot keeps its hero for the reconnect
      for (const r of this.reserved.values()) if (r.slot !== exceptSlot && r.hero === h && r.until > n) return true;
      return false;
    }
    _freeHero(pref, slot) {
      const n = heroCount(this.adapter);
      if (isInt(pref) && pref >= 0 && pref < n && !this._heroTaken(pref, slot)) return pref;
      const order = (this.adapter.selectOrder && this.adapter.selectOrder.length ? this.adapter.selectOrder : []).concat(Array.from({ length: n }, (_, i) => i));
      for (const h of order) if (h >= 0 && h < n && !this._heroTaken(h, slot)) return h;
      return 0;
    }
    _incoming(link) {
      if (this.ended) { link.close('ended'); return; }
      const p = { link, at: now(), done: false };
      p.wire = new Wire(link, TO_HOST, msg => this._fromPending(p, msg), this.stats, { bytesPerSec: RATES.linkBytesPerSec });
      this.pending.add(p);
      link.on('close', () => { this.pending.delete(p); });
    }
    _reject(wire, reason, detail) {
      wire.send({ t: 'reject', reason, detail: detail || (ERRORS[REJECT_TO_ERROR[reason]] || {}).text || '' });
      after(500, () => wire.link.close('rejected'));
    }
    _fromPending(p, msg) {
      if (p.done) return;
      if (msg.t !== 'hello') return;
      p.done = true; this.pending.delete(p);
      const wire = p.wire;
      if (msg.v !== PROTOCOL) return this._reject(wire, 'version');
      if (this.adapter.build != null && msg.build !== this.adapter.build) return this._reject(wire, 'build');
      const cid = typeof msg.cid === 'string' && /^[A-Za-z0-9_-]{4,32}$/.test(msg.cid) ? msg.cid : null;
      if (!cid) return this._reject(wire, 'version', 'bad hello');
      if (this.banned.has(cid)) return this._reject(wire, 'kicked');
      let slot = null, restore = null;
      for (const c of this.clients.values()) if (c.cid === cid) { slot = c.slot; restore = c; }
      if (restore) {
        this.clients.delete(slot); restore.replaced = true; restore.link.close('replaced');
        restore = { slot, hero: restore.hero, wasPlaying: restore.state === 'playing' };
        if (restore.wasPlaying && this.adapter.removePlayer) safely(() => this.adapter.removePlayer(slot, 'reconnect'));
      }
      else {
        const r = this.reserved.get(cid);
        if (r && r.until > now()) { slot = r.slot; restore = r; }
        this.reserved.delete(cid);
      }
      if (slot === null && this.isLocked) return this._reject(wire, 'locked');
      if (slot === null) {
        for (let s = 1; s < MAX_PLAYERS && slot === null; s++) if (!this.clients.has(s) && !this._slotReserved(s)) slot = s;
        if (slot === null) return this._reject(wire, 'full');
      }
      const hero = this._freeHero(restore ? restore.hero : msg.hero, slot);
      const c = {
        slot, cid, link: p.link, wire, name: cleanName(msg.name) || (slot + 1) + 'P', hero, ready: false,
        state: this.phase === 'play' ? 'waiting' : 'lobby', lastHeard: now(), rtt: 0, warn: false,
        receiver: new Receiver(), acked: -1, ackFrameSeq: -1, applied: 0, kfWant: true, kfSim: -Infinity, kfAskAt: -1e9,
        waitingSince: now(), sentAt: new Map(), reconnect: !!restore, bucket: { n: RATES.ctlBurst, at: now() },
      };
      if (restore && restore.wasPlaying && this.phase === 'play') { c.ready = true; c.waitingSince = now(); }
      wire.onMsg = m => this._fromClient(c, m);
      this.clients.set(slot, c);
      p.link.on('close', reason => this._linkClosed(c, reason));
      wire.send({ t: 'accept', v: PROTOCOL, slot, room: this.code, cid, roster: this.roster, lobby: { phase: this.phase, chapter: this.settings.chapter, difficulty: this.settings.difficulty, unlocked: this.settings.unlocked }, rates: { snap: RATES.snap, input: RATES.input }, hostTime: this._hostMs(), locked: this.isLocked });
      this._broadcastLobby();
      this.emit('join', { slot, name: c.name, hero: c.hero, reconnect: c.reconnect });
      return undefined;
    }
    _slotReserved(s) { const n = now(); for (const r of this.reserved.values()) if (r.slot === s && r.until > n) return true; return false; }
    _fromClient(c, msg) {
      if (this.clients.get(c.slot) !== c) return;
      c.lastHeard = now();
      if (c.warn) { c.warn = false; this._broadcastLobby(); }
      if (msg.t !== 'i') {   // ctl token bucket: a joiner cannot make the host re-broadcast the room in a loop
        const n = now(), b = c.bucket;
        b.n = Math.min(RATES.ctlBurst, b.n + (n - b.at) * RATES.ctlPerSec / 1000); b.at = n;
        if (b.n < 1 && msg.t !== 'leave') { c.ctlDropped = (c.ctlDropped || 0) + 1; this.stats.dropped++; return; }
        b.n -= 1;
      }
      switch (msg.t) {
        case 'i': {
          if (c.state !== 'playing') return;
          if (c.receiver.push(msg) && isInt(msg.a) && msg.s > c.ackFrameSeq) {
            c.ackFrameSeq = msg.s;
            if (msg.a > c.acked) {
              const sent = c.sentAt.get(msg.a);
              if (sent !== undefined) { const r = now() - sent; c.rtt = c.rtt ? c.rtt * 0.8 + 0.2 * r : r; c.sentAt.delete(msg.a); }
              c.acked = msg.a;
            }
          }
          return;
        }
        case 'hero': {
          const h = msg.hero;
          if (!isInt(h) || h < 0 || h >= heroCount(this.adapter)) return;
          if (c.state === 'playing') return;
          if (this._heroTaken(h, c.slot)) { c.wire.send({ t: 'reject', reason: 'hero-taken', detail: ERRORS['hero-taken'].text }); c.wire.send(this._lobbyMsg()); return; }
          c.hero = h; this._broadcastLobby(); return;
        }
        case 'ready': {
          c.ready = !!msg.on;
          if (c.ready && this.phase === 'play' && c.state === 'waiting') c.waitingSince = now();
          this._broadcastLobby(); this.emit('ready', { slot: c.slot, on: c.ready });
          if (this.phase === 'play') this.admitWaiting();
          return;
        }
        case 'kf': c.kfWant = true; return;
        case 'ping': if (typeof msg.c === 'number') c.wire.send({ t: 'pong', n: msg.n, c: msg.c, h: this._hostMs() }); return;
        case 'leave': {
          // pagehide = a reload or a closed tab, not a decision to leave: keep the slot for the cid like a lost link (§1.13)
          const unload = msg.reason === 'pagehide';
          this._drop(c, unload ? 'closed' : 'left', unload); c.link.close('left'); return;
        }
        default: return;
      }
    }
    _linkClosed(c, reason) {
      if (c.replaced || this.clients.get(c.slot) !== c) return;
      this._drop(c, reason === 'cut' || reason === 'timeout' ? 'timeout' : 'closed', true);
    }
    _drop(c, reason, reserve) {
      if (this.clients.get(c.slot) !== c) return;
      this.clients.delete(c.slot);
      const wasPlaying = c.state === 'playing';
      if (wasPlaying && this.adapter.removePlayer) safely(() => this.adapter.removePlayer(c.slot, reason));
      if (reserve) this.reserved.set(c.cid, { slot: c.slot, hero: c.hero, name: c.name, until: now() + RATES.reserveMs, wasPlaying });
      if (this.phase === 'play') this._event([['notice', (c.slot + 1) + 'P LEFT']]);
      this._broadcastLobby();
      this.emit('leave', { slot: c.slot, name: c.name, reason });
    }
    _event(list) {
      if (!list || !list.length) return;
      const m = { t: 'event', n: ++this.eventSeq, tm: this._hostMs(), list };
      for (const c of this.clients.values()) if (c.state === 'playing') c.wire.send(m);
    }
    poll() {
      if (this.ended) return;
      const n = now();
      for (const c of Array.from(this.clients.values())) {
        const silent = n - c.lastHeard;
        if (silent > RATES.dropMs) { this._drop(c, 'timeout', true); c.link.close('timeout'); continue; }
        if (silent > RATES.warnMs && !c.warn) { c.warn = true; this._broadcastLobby(); }
      }
      for (const p of Array.from(this.pending)) if (n - p.at > RATES.helloMs) { this.pending.delete(p); p.link.close('no-hello'); }
      for (const [cid, r] of Array.from(this.reserved)) if (r.until <= n) this.reserved.delete(cid);
      if (n - this.lastLobbyAt >= RATES.lobbyMs) this._broadcastLobby();
      rollStats(this.stats);
      if (this.phase === 'play' && this.clients.size) this.admitWaiting();
    }
    setLobby({ chapter, difficulty, unlocked } = {}) {
      if (chapter != null && isInt(+chapter)) this.settings.chapter = +chapter;
      if (difficulty != null) this.settings.difficulty = String(difficulty);
      if (unlocked != null && isInt(+unlocked)) this.settings.unlocked = +unlocked;
      this._broadcastLobby();
    }
    setName(name) { this.me.name = cleanName(name) || '1P'; this._broadcastLobby(); }
    chooseHero(h) {
      if (!isInt(h) || h < 0 || h >= heroCount(this.adapter) || this._heroTaken(h, 0)) return false;
      this.me.hero = h; this._broadcastLobby(); return true;
    }
    canStart() { return this.phase === 'lobby' && Array.from(this.clients.values()).every(c => c.ready); }
    start() {
      if (this.ended) return false;
      if (!this.canStart()) return false;
      this.phase = 'play';
      for (const c of this.clients.values()) { c.state = 'playing'; this._resetLink(c); }
      const roster = [{ slot: 0, hero: this.me.hero, name: this.me.name }].concat(Array.from(this.clients.values()).sort((a, b) => a.slot - b.slot).map(c => ({ slot: c.slot, hero: c.hero, name: c.name })));
      const cfg = { chapter: this.settings.chapter, section: this.settings.section || 0, difficulty: this.settings.difficulty, roster };
      this.history = []; this.lastSnapMs = -Infinity;
      if (this.adapter.startGame) this.adapter.startGame(cfg);
      if (this.adapter.serialize) this._syncTime(safely(() => this.adapter.serialize()));
      for (const c of this.clients.values()) c.wire.send(Object.assign({ t: 'start' }, cfg));
      this._broadcastLobby();
      this.emit('start', cfg); NET.emit('start', Object.assign({ role: 'host', slot: 0 }, cfg));
      return true;
    }
    // Back to the room screen for everybody (chapter clear/QUIT/ending, or END GAME FOR EVERYONE); the room stays open.
    toRoom(reason = 'host-quit') {
      if (this.ended || this.phase === 'lobby') return;
      this.phase = 'lobby';
      for (const c of this.clients.values()) { c.state = 'lobby'; c.ready = false; this._resetLink(c); }
      if (this.adapter.stopGame) safely(() => this.adapter.stopGame(reason));
      const m = Object.assign(this._lobbyMsg(), { reason });
      for (const c of this.clients.values()) c.wire.send(m);
      this.lastLobbyAt = now();
      this.emit('lobby', m); this.emit('roster', m.roster); NET.emit('roster', m.roster);
    }
    admitWaiting() {
      if (this.phase !== 'play' || this.ended) return 0;
      let n = 0;
      for (const c of this.clients.values()) {
        if (c.state !== 'waiting' || !c.ready) continue;
        const waitedMs = now() - c.waitingSince;
        const ok = this.adapter.canAdmit ? !!this.adapter.canAdmit({ slot: c.slot, waitedMs }) : true;
        if (!ok) continue;
        c.state = 'playing'; this._resetLink(c);
        if (this.adapter.addPlayer) this.adapter.addPlayer(c.slot, c.hero, { dropIn: true, name: c.name, reconnect: c.reconnect });
        const roster = this.roster.map(r => ({ slot: r.slot, hero: r.hero, name: r.name }));
        c.wire.send({ t: 'start', chapter: this.settings.chapter, section: this.settings.section || 0, difficulty: this.settings.difficulty, roster, dropIn: true });
        this._event([['notice', (c.slot + 1) + 'P ' + c.name + ' JOINED']]);
        n++;
        this.emit('admit', { slot: c.slot, hero: c.hero, name: c.name });
      }
      if (n) this._broadcastLobby();
      return n;
    }
    kick(slot) {
      const c = this.clients.get(slot);
      if (!c) return false;
      c.wire.send({ t: 'end', reason: 'kicked' });
      this.banned.add(c.cid);
      // the ban is keyed on a cid the joiner makes up, so also keep new players out for a while (lock(false) lifts it)
      this.lockedUntil = Math.max(this.lockedUntil, now() + RATES.kickLockMs);
      this._drop(c, 'kicked', false);
      after(500, () => c.link.close('kicked'));
      return true;
    }
    pause(on, by = 'host') {
      this.paused = { on: !!on, by: on ? by : '' };
      for (const c of this.clients.values()) c.wire.send({ t: 'pause', on: !!on, by: this.paused.by });
      if (this.adapter.pause) safely(() => this.adapter.pause(!!on, by));
    }
    // The game calls this after every update step (dtSim in seconds of sim time).
    tick(dtSim) {
      if (this.ended || this.phase !== 'play') return;
      this.simMs += Math.max(0, +dtSim || 0) * 1000;
      for (const c of this.clients.values()) {
        if (c.state !== 'playing') continue;
        const fr = c.receiver.next();
        if (c.warn) { fr.held = new Set(); fr.presses = []; fr.dash = null; fr.away = true; }
        if (!fr.repeat) c.applied = fr.s;
        if (this.adapter.setRemoteInput) this.adapter.setRemoteInput(c.slot, fr);
      }
      const ev = this.adapter.drainEvents ? this.adapter.drainEvents() : null;
      if (ev && ev.length) this._event(ev);
      if (this.clients.size) this.admitWaiting();
      const interval = 1000 / RATES.snap * (this.slow ? 2 : 1);
      if (this.simMs - this.lastSnapMs >= interval - 0.5) {
        this.lastSnapMs = this.simMs - this.lastSnapMs > 2 * interval ? this.simMs : this.lastSnapMs + interval;
        this._snapshot();
      }
    }
    // The game may call this instead of letting tick() deliver input (pull model): one decoded frame for the slot.
    nextInput(slot) { const c = this.clients.get(slot); return c && c.state === 'playing' ? c.receiver.next() : null; }
    _snapshot() {
      const playing = Array.from(this.clients.values()).filter(c => c.state === 'playing');
      if (!this.codec || !this.adapter.serialize || !playing.length) return;
      const raw = this.adapter.serialize();
      this._syncTime(raw);
      const q = this.codec.quantise(raw);
      const n = ++this.snapSeq, at = now(), tm = this._hostMs();
      this.history.push({ n, q });
      if (this.history.length > HISTORY) this.history.shift();
      const cache = new Map();
      let maxBuf = 0;
      for (const c of playing) {
        let base = null;
        if (c.acked >= 0 && !c.kfWant && this.simMs - c.kfSim < RATES.keyframeMs) base = this.history.find(h => h.n === c.acked) || null;
        const bkey = base ? base.n : -1;
        let d = cache.get(bkey);
        if (!d) { d = this.codec.encode(q, base ? base.q : null); cache.set(bkey, d); }
        if (!base) { c.kfWant = false; c.kfSim = this.simMs; }
        c.sentAt.set(n, at);
        if (c.sentAt.size > HISTORY) c.sentAt.delete(c.sentAt.keys().next().value);
        c.wire.send({ t: 's', n, b: bkey, tm, a: c.applied, d }, 'st');
        maxBuf = Math.max(maxBuf, c.link.bufferedAmount('st'));
      }
      if (maxBuf > 64 * 1024) this.slow = true;
      else if (this.slow && maxBuf < 16 * 1024) this.slow = false;
    }
    end(reason = 'host-quit') {
      if (this.ended) return;
      this.ended = true; this.phase = 'ended';
      for (const c of this.clients.values()) c.wire.send({ t: 'end', reason });
      for (const p of this.pending) p.wire.send({ t: 'reject', reason: 'closed', detail: ERRORS['host-left'].text });
      if (this._stopTimer) this._stopTimer();
      const tr = this.transport;
      after(150, () => tr.close());
      if (NET.session === this) NET.session = null;
      this.emit('end', { reason }); NET.emit('end', { role: 'host', reason });
    }
    leave() { this.end('host-left'); }
    status() {
      const cs = Array.from(this.clients.values());
      return { role: 'host', code: this.code, slot: 0, phase: this.phase, roster: this.roster, rtt: cs.length ? Math.round(Math.max(...cs.map(c => c.rtt || 0))) : 0,
        delay: 0, snapSeq: this.snapSeq, kbpsIn: this.stats.kbpsIn, kbpsOut: this.stats.kbpsOut, dropped: this.stats.dropped + cs.reduce((a, c) => a + c.receiver.dropped, 0),
        error: this.lastError ? this.lastError.code : null, brokerUp: this.brokerUp, slow: this.slow, transport: this.transport.kind, via: this.transport.listening || [this.transport.kind], relay: relayKnown, paused: this.paused.on, locked: this.isLocked };
    }
  }

  // ------------------------------------------------------------------ client session
  class ClientSession {
    constructor({ adapter, transport, link, code: roomCode, cid, name, hero, manual = false }) {
      emitter(this);
      this.role = 'client'; this.adapter = adapter || {}; this.transport = transport; this.link = link; this.code = roomCode;
      this.cid = cid; this.name = cleanName(name); this.hero = isInt(hero) ? hero : -1;
      this.slot = -1; this.roster = []; this.phase = 'connecting'; this.settings = {};
      this.stats = newStats();
      this.wire = new Wire(link, TO_CLIENT, m => this._msg(m), this.stats);
      const schema = schemaOf(this.adapter);
      this.codec = schema ? makeCodec(schema) : null;
      this.playerSection = (schema && schema.playerSection) || 'p';
      this.playerKey = (schema && schema.sections && schema.sections[this.playerSection] && schema.sections[this.playerSection].key) || 'slot';
      this.interp = new Interp({ schema, timeField: schema && schema.timeField !== undefined ? schema.timeField : 'time' });
      this.echo = typeof this.adapter.echoStep === 'function' ? new Echo((row, f, dt) => this.adapter.echoStep(row, f, dt)) : null;
      this.history = new Map(); this.latest = -1; this.ownRow = null; this.events = [];
      // The joiner's input sampler: rebased on every start (the host's counters restart from zero then). Feed it
      // keyDown/keyUp/setAway and send sampler.sample(dtMs); a caller using a Sampler of its own must rebase() it on 'start'.
      this.sampler = new Sampler();
      this.locked = false;
      this.rtt = 0; this.pingN = 0; this.lastHeard = now(); this.lastPing = -1e9; this.warn = false; this.kfAskAt = -1e9;
      this.paused = { on: false, by: '' }; this.ended = false; this.error = null; this.inputSeq = 0;
      link.on('close', reason => { if (!this.ended) this._end(this.phase === 'connecting' ? 'closed' : (reason === 'cut' ? 'timeout' : 'host-left')); });
      this._stopTimer = manual ? null : every(250, () => this.poll());
    }
    _handshake(timeoutMs = RATES.helloMs) {
      return new Promise((resolve, reject) => {
        this._hs = { resolve, reject };
        this.wire.send({ t: 'hello', v: PROTOCOL, build: this.adapter.build != null ? String(this.adapter.build) : '', cid: this.cid, name: this.name, hero: this.hero });
        after(timeoutMs, () => { if (this._hs) { const hs = this._hs; this._hs = null; this._end('timeout', true); hs.reject(netError('timeout', 'no answer to hello')); } });
      });
    }
    _msg(m) {
      this.lastHeard = now();
      if (this.warn) { this.warn = false; this.emit('status', this.status()); NET.emit('status', this.status()); }
      switch (m.t) {
        case 'accept': {
          if (!this._hs || !isInt(m.slot)) return;
          this.slot = m.slot; this.roster = Array.isArray(m.roster) ? m.roster : [];
          const lb = m.lobby || {};
          this.phase = lb.phase || 'lobby'; this.settings = { chapter: lb.chapter, difficulty: lb.difficulty, unlocked: lb.unlocked }; this.locked = !!m.locked;
          const mine = this.roster.find(r => r.slot === this.slot); if (mine) this.hero = mine.hero;
          const hs = this._hs; this._hs = null;
          this.emit('accept', m); hs.resolve(this);
          return;
        }
        case 'reject': {
          if (m.reason === 'hero-taken') { this.emit('reject', { reason: m.reason, detail: m.detail, fatal: false }); return; }
          const code = REJECT_TO_ERROR[m.reason] || 'host-left';
          if (this._hs) { const hs = this._hs; this._hs = null; this._end(code, true); hs.reject(netError(code, m.detail)); return; }
          this.emit('reject', { reason: m.reason, detail: m.detail, fatal: true });
          this._end(code);
          return;
        }
        case 'lobby': {
          if (Array.isArray(m.roster)) this.roster = m.roster;
          const prev = this.phase;
          if (typeof m.phase === 'string') this.phase = m.phase;
          if (m.phase === 'lobby') this._started = false;
          this.settings = { chapter: m.chapter, difficulty: m.difficulty, unlocked: m.unlocked }; this.locked = !!m.locked;
          const mine = this.roster.find(r => r.slot === this.slot); if (mine) this.hero = mine.hero;
          this.emit('lobby', m); this.emit('roster', this.roster); NET.emit('roster', this.roster);
          if (m.phase === 'lobby' && prev === 'play') { this._resetView(); this.emit('room', { reason: m.reason || '' }); }
          return;
        }
        case 'start': {
          this.phase = 'play'; this._started = true;
          this._resetView();
          const cfg = { slot: this.slot, roster: m.roster, chapter: m.chapter, section: m.section, difficulty: m.difficulty, dropIn: !!m.dropIn };
          this.emit('start', cfg); NET.emit('start', Object.assign({ role: 'client' }, cfg));
          return;
        }
        case 's': return this._snap(m);
        case 'event': {
          if (!Array.isArray(m.list)) return;
          this.events.push({ n: m.n, tm: typeof m.tm === 'number' ? m.tm : 0, list: m.list, at: now() });
          if (this.events.length > 600) this.events.splice(0, this.events.length - 600);
          return;
        }
        case 'pong': {
          if (typeof m.c === 'number') { const r = now() - m.c; if (r >= 0 && r < 60000) this.rtt = this.rtt ? this.rtt * 0.7 + 0.3 * r : r; }
          return;
        }
        case 'pause': this.paused = { on: !!m.on, by: m.by || '' }; this.emit('pause', this.paused); return;
        case 'end': this._end(END_TO_ERROR[m.reason] || 'host-left'); return;
        default: return;
      }
    }
    _resetView() { this.history.clear(); this.latest = -1; this.ownRow = null; this.events = []; this.interp.reset(); if (this.echo) this.echo.reset(); this.sampler.rebase(); }
    _snap(m) {
      if (!this.codec || !isInt(m.n) || !isInt(m.b) || !m.d || typeof m.d !== 'object') { this.stats.dropped++; return; }
      if (m.n <= this.latest) return;
      let base = null;
      if (m.b !== -1) {
        base = this.history.get(m.b);
        if (!base) { if (now() - this.kfAskAt > 250) { this.kfAskAt = now(); this.wire.send({ t: 'kf', base: m.b }); } this.stats.dropped++; return; }
      }
      let q;
      try { q = this.codec.decode(m.d, base); } catch (e) { this.stats.dropped++; return; }
      this.history.set(m.n, q);
      while (this.history.size > HISTORY) this.history.delete(this.history.keys().next().value);
      this.latest = m.n;
      this.interp.push(m.n, typeof m.tm === 'number' ? m.tm : 0, q, now());
      const rows = q[this.playerSection];
      this.ownRow = Array.isArray(rows) ? rows.find(r => r && r[this.playerKey] === this.slot) || null : null;
      if (this.echo && isInt(m.a)) this.echo.ack(m.a);
      this.emit('snapshot', m.n);
    }
    poll() {
      if (this.ended) return;
      const n = now();
      if (n - this.lastPing >= RATES.pingMs && this.phase !== 'connecting') { this.lastPing = n; this.wire.send({ t: 'ping', n: ++this.pingN, c: n }); }
      const silent = n - this.lastHeard;
      if (silent > RATES.dropMs) { this._end('timeout'); return; }
      if (silent > RATES.warnMs && !this.warn) { this.warn = true; this.emit('status', this.status()); NET.emit('status', this.status()); }
      rollStats(this.stats);
    }
    chooseHero(h) { if (isInt(h)) { this.wire.send({ t: 'hero', hero: h }); } }
    ready(on = true) { this.wire.send({ t: 'ready', on: !!on }); }
    joinIn(hero) { if (isInt(hero)) this.chooseHero(hero); this.ready(true); }
    sendInput(frames) {
      if (this.ended || this.phase !== 'play') return;
      for (const f of [].concat(frames || [])) {
        f.a = this.latest;
        this.wire.send(f, 'st');
        if (this.echo) this.echo.pending(f);
      }
    }
    view(nowMs = now()) {
      const v = this.interp.view(nowMs);
      if (!v) return null;
      if (this.echo && this.ownRow && Array.isArray(v[this.playerSection])) {
        const own = this.echo.predict(this.ownRow, nowMs);
        v[this.playerSection] = v[this.playerSection].map(r => (r && r[this.playerKey] === this.slot ? own : r));
        if (!v[this.playerSection].some(r => r && r[this.playerKey] === this.slot)) v[this.playerSection].push(own);
      }
      return v;
    }
    dueEvents(nowMs = now()) {
      if (!this.events.length) return [];
      const rt = this.interp.renderTime(nowMs);
      const out = [], keep = [];
      for (const e of this.events) (rt === null || e.tm <= rt || nowMs - e.at >= 250 ? out : keep).push(e);
      this.events = keep;
      const list = [];
      for (const e of out) for (const ev of e.list) list.push(ev);
      return list;
    }
    leave(reason = 'left') {
      if (this.ended) return;
      this.wire.send({ t: 'leave', reason: String(reason).slice(0, 32) });
      const link = this.link;
      after(100, () => link.close('left'));
      this._end('left');
    }
    _end(reason, silent) {
      if (this.ended) return;
      this.ended = true; this.phase = 'ended';
      if (this._hs) { const hs = this._hs; this._hs = null; silent = true; hs.reject(netError(ERRORS[reason] ? reason : 'host-left')); }
      if (this._stopTimer) this._stopTimer();
      this.error = reason === 'left' ? null : (ERRORS[reason] ? reason : 'host-left');
      const tr = this.transport, link = this.link;
      if (reason !== 'left') { link.close(reason); }
      after(150, () => { try { tr.close(); } catch (e) { /* closed */ } });
      if (NET.session === this) NET.session = null;
      if (silent) return;
      const info = { reason, error: this.error ? netError(this.error) : null };
      this.emit('end', info); NET.emit('end', Object.assign({ role: 'client' }, info));
      if (info.error) { this.emit('error', info.error); NET.emit('error', info.error); }
    }
    status() {
      return { role: 'client', code: this.code, slot: this.slot, phase: this.phase, roster: this.roster, rtt: Math.round(this.rtt), delay: Math.round(this.interp.delay),
        snapSeq: this.latest, kbpsIn: this.stats.kbpsIn, kbpsOut: this.stats.kbpsOut, dropped: this.stats.dropped, error: this.error, warn: this.warn,
        transport: this.transport.kind, via: this.link && this.link.kind, relay: relayKnown, paused: this.paused.on };
    }
  }

  // ------------------------------------------------------------------ entry points
  function cancelPending() { if (pendingOp) { const p = pendingOp; pendingOp = null; p.cancel(); } }
  function progress(step) { NET.emit('progress', step); }
  // opts.register === false keeps a session out of EDEN_NET.session (several sessions in one page/process: tests).
  function replaceSession(s, register) { if (register === false) return; const old = NET.session; if (old && old !== s && !old.ended) { if (old.role === 'host') old.end('host-left'); else old.leave('replaced'); } NET.session = s; }

  async function host(opts = {}) {
    cancelPending();
    let cancelled = false, transport = null;
    pendingOp = { cancel: () => { cancelled = true; if (transport) transport.close(); } };
    const hostCid = opts.cid || clientId();
    try {
      transport = await makeTransport(opts.transport, progress, { cid: hostCid });
      if (cancelled) { transport.close(); throw netError('cancelled'); }
      progress('broker');
      let roomCode = null;
      for (let i = 0; i < 5 && !roomCode; i++) {
        const c = (i === 0 && opts.code && code.normalize(opts.code)) || code.make();
        try { await transport.listen(code.peerId(c)); roomCode = c; }
        catch (e) {
          if (cancelled) throw netError('cancelled');
          if (e && e.code === 'id-taken') {
            if ((transport.kind === 'peerjs' || transport.kind === 'auto') && !(opts.transport && typeof opts.transport === 'object')) { transport.close(); transport = await makeTransport(opts.transport, progress, { cid: hostCid }); }
            continue;
          }
          throw asNetError(e);
        }
      }
      if (!roomCode) throw netError('broker', 'no free room code');
      if (cancelled) { transport.close(); throw netError('cancelled'); }
      const s = new HostSession(Object.assign({}, opts, { transport, code: roomCode }));
      replaceSession(s, opts.register);
      pendingOp = null;
      s.on('end', () => { if (NET.session === s) NET.session = null; });
      NET.emit('status', s.status());
      return s;
    } catch (e) {
      if (transport && !cancelled) try { transport.close(); } catch (x) { /* closed */ }
      if (pendingOp && !cancelled) pendingOp = null;
      const err = cancelled ? netError('cancelled') : asNetError(e);
      if (!cancelled) NET.emit('error', err);
      throw err;
    }
  }

  async function join(codeText, opts = {}) {
    cancelPending();
    const roomCode = code.normalize(codeText);
    if (!roomCode) { const err = netError(code.problem(codeText) === 'symbols' ? 'code-format' : 'bad-code', 'format'); NET.emit('error', err); throw err; }
    let cancelled = false, transport = null;
    pendingOp = { cancel: () => { cancelled = true; if (transport) transport.close(); } };
    const cid = opts.cid || clientId();
    try {
      transport = await makeTransport(opts.transport, progress, { cid });
      if (cancelled) { transport.close(); throw netError('cancelled'); }
      if (transport.on) transport.on('progress', progress);
      progress(transport.kind === 'peerjs' ? 'broker' : transport.kind === 'relay' ? 'relay' : 'host');
      const link = await transport.connect(code.peerId(roomCode));
      if (cancelled) { link.close('cancelled'); throw netError('cancelled'); }
      progress('hello');
      const s = new ClientSession(Object.assign({}, opts, { transport, link, code: roomCode, cid }));
      await s._handshake();
      if (cancelled) { s.leave('cancelled'); throw netError('cancelled'); }
      replaceSession(s, opts.register);
      pendingOp = null;
      NET.emit('status', s.status());
      return s;
    } catch (e) {
      if (transport && !cancelled) try { transport.close(); } catch (x) { /* closed */ }
      if (pendingOp && !cancelled) pendingOp = null;
      const err = cancelled ? netError('cancelled') : asNetError(e, 'bad-code');
      if (!cancelled) NET.emit('error', err);
      throw err;
    }
  }

  function status() {
    const s = NET.session;
    if (!s) return { role: 'off', code: null, slot: 0, phase: 'off', roster: [], rtt: 0, delay: 0, snapSeq: -1, kbpsIn: 0, kbpsOut: 0, dropped: 0, error: null };
    return s.status();
  }

  if (root.addEventListener) {
    root.addEventListener('pagehide', () => {
      const s = NET.session;
      if (!s || s.ended) return;
      if (s.role === 'host') { s.end('host-left'); return; }
      // a joiner's reload: remember the room so the reloaded page can rejoin into its reserved slot (rejoinCode())
      const st = storage('sessionStorage');
      if (st && s.code) try { st.setItem(REJOIN_KEY, JSON.stringify({ code: s.code, at: Date.now() })); } catch (e) { /* private mode */ }
      s.leave('pagehide');
    });
  }
  // The room a joiner was in when its page unloaded less than reserveMs ago (read once: the key is removed). The lobby
  // calls this at boot and joins that code again; the host gives back the same slot, hero, score and lives (§1.13).
  function rejoinCode() {
    const st = storage('sessionStorage');
    if (!st) return null;
    let v = null;
    try { v = JSON.parse(st.getItem(REJOIN_KEY) || 'null'); st.removeItem(REJOIN_KEY); } catch (e) { return null; }
    if (!v || typeof v.at !== 'number' || Date.now() - v.at > RATES.reserveMs - 1000 || Date.now() < v.at) return null;
    return code.normalize(v.code);
  }

  Object.assign(NET, {
    PROTOCOL, MAX_PLAYERS, PEERJS_URL, PEERJS_FALLBACK_URL, RELAY_URL, RELAY_WINDOW_MS, RATES, FRAG, MAX_TEXT,
    code,
    loadPeerJS, transports, defaultTransport, relayUrl, memoryBus, broadcastBus,
    host, join, cancel: cancelPending, session: null, status, rejoinCode,
    input: { BUTTONS, CODES, KEYMAP, Sampler, Receiver, validFrame },
    codec: { make: makeCodec, Q },
    Interp, Echo, Wire, HostSession, ClientSession,
    errors: ERRORS, error: netError, cleanName,
    _test: {
      clock: { now }, setClock(fn) { clockFn = typeof fn === 'function' ? fn : null; }, poll, lastMessages: tap,
      makeLink, subscribe, after, setRelay(url) { relayOverride = url === null || url === undefined ? null : String(url); },
    },
  });
  Object.defineProperty(NET, 'relay', { enumerable: true, get: () => relayKnown });   // true: PeerJS lists TURN servers
  root.EDEN_NET = NET;
  if (typeof module === 'object' && module && module.exports) module.exports = NET;
})(typeof window !== 'undefined' ? window : globalThis);
