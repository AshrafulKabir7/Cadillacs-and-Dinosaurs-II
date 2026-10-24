// Multiplayer test harness (work/mp/MULTIPLAYER.md §4.2, §5.4).
//
//   const MP = require('./lib/mp.cjs');
//   const bus = MP.bus({ latency: 40, jitter: 10, loss: 0.05, mode: 'realtime' });
//   const s = await MP.session({ players: 3, page: 'harness', bus });     // host + 2 joiners, one context each
//   const code = await MP.hostRoom(s.host, { hero: 0 });
//   await MP.joinRoom(s.joiners[0], code, { hero: 1 });
//   ...; await s.close();
//
// The loopback bus. Every page of a context the bus is attached to gets `window.__MP_BUS` before any of its scripts run
// (context.exposeBinding('__mpSend') + addInitScript). net.js's loopback transport uses it instead of a
// BroadcastChannel (which cannot cross Playwright contexts). It offers two styles, so whichever the transport speaks works:
//
//   directed   (net.js's loopback bus contract, see the net.js header)
//              __MP_BUS.claim(peerId) -> Promise<boolean>   claim a peer id for this page (false: another live page has it)
//              __MP_BUS.register(peerId) / unregister(peerId)   claim without asking / release
//              __MP_BUS.send(fromId, toId, channel, text)   'ctl' | 'st' | '_' (net.js link control); the from id is
//                                                            registered implicitly; toId '*' broadcasts to every other page
//              __MP_BUS.subscribe(fn) / onReceive(fn) / inbox = fn   fn(fromId, toId, channel, text)  (when none is set,
//                                                            a directed message goes to the 'message' listeners as
//                                                            {data: {from, to, channel, text}})
//              The relay injects on '_' what net.js expects from a network: {"op":"fail","code":"ice-failed","link"}
//              answering the next {"op":"connect"} after bus.block('ice'); {"op":"cut"} both ways on every link of a
//              peer after bus.cut(peerId); {"op":"close"} from every peer id of a page that closed.
//   broadcast  __MP_BUS.postMessage(data)            BroadcastChannel-compatible: every other page's
//              __MP_BUS.onmessage / addEventListener('message', fn)  receives {data} (a JSON copy)
//   presence   __MP_BUS.on('gone', fn) / ongone     fn(peerId): a peer's page closed or its link was cut
//              __MP_BUS.ids                          the peer ids used on this page; __MP_BUS.name = page name
//
// Node relays every message with a deterministic delay queue: latency (ms), jitter (ms, seeded uniform), loss and reorder
// (0..1, 'st' only: 'ctl' is reliable and ordered per link), seed. Modes: 'realtime' (a Node timer delivers when due, for
// pages that run their own rAF loop) or 'manual' (nothing moves until bus.advance(ms) / bus.flushAll(), for rAF-stubbed
// pages driven by step()). Channel of a broadcast message = data.channel || data.ch || data.c (else 'ctl').
// Messages longer than maxMessage (16 KB, the safe RTCDataChannel size) are still delivered but counted as oversize.
'use strict';
const http = require('node:http'), path = require('node:path'), { spawn } = require('node:child_process');
const A = require('./arcade.cjs');

const MAX_MESSAGE = 16384;
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RE = new RegExp(`^DINO-[${ALPHABET}]{4}$`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rng = seed => { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// ---------------------------------------------------------------- page side of the bus
const BUS_PAGE = () => {
  if (window.__MP_BUS || typeof window.__mpSend !== 'function') return;
  const L = { message: new Set(), inbox: new Set(), gone: new Set() }, claims = new Map();
  let seq = 0, outbox = [];
  // Messages sent in one task go to Node in one binding call (a binding call is a CDP round trip).
  const flush = () => { const list = outbox; outbox = []; if (list.length) try { window.__mpSend({ k: 'batch', list }); } catch (e) { /* page closing */ } };
  const out = m => { seq++; m.n = seq; outbox.push(m); if (outbox.length === 1) queueMicrotask(flush); };
  addEventListener('pagehide', flush);
  const bus = {
    kind: 'node-relay', name: '', ids: new Set(), onmessage: null, inbox: null, ongone: null,
    register(id) { id = String(id); bus.ids.add(id); out({ k: 'reg', id }); return true; },
    claim(id) { id = String(id); return new Promise(res => { claims.set(id, res); out({ k: 'claim', id }); }); },
    subscribe(fn) { L.inbox.add(fn); return () => L.inbox.delete(fn); },
    unregister(id) { id = String(id); bus.ids.delete(id); out({ k: 'unreg', id }); },
    send(from, to, channel, text) {
      const raw = typeof text !== 'string';
      if (from != null) bus.ids.add(String(from));
      out({ k: 'send', from: from == null ? null : String(from), to: to == null ? '*' : String(to), channel: channel || 'ctl', text: raw ? JSON.stringify(text) : text, raw });
    },
    postMessage(data) { out({ k: 'bc', text: JSON.stringify(data) }); },
    addEventListener(type, fn) { (L[type] || L.message).add(fn); },
    removeEventListener(type, fn) { (L[type] || L.message).delete(fn); },
    onReceive(fn) { L.inbox.add(fn); return () => L.inbox.delete(fn); },
    on(type, fn) { (L[type] || L.inbox).add(fn); return () => (L[type] || L.inbox).delete(fn); },
    off(type, fn) { (L[type] || L.inbox).delete(fn); },
    close() {},
    __seq: () => seq,
    __deliver(batch) {
      for (const m of batch) {
        try {
          if (m.k === 'gone') { for (const fn of L.gone) fn(m.id); if (typeof bus.ongone === 'function') bus.ongone(m.id); continue; }
          if (m.k === 'claim-r') { if (m.ok) bus.ids.add(m.id); const r = claims.get(m.id); claims.delete(m.id); if (r) r(!!m.ok); continue; }
          if (m.k === 'name') { bus.name = m.name; continue; }
          if (m.k === 'bc') { const ev = { data: JSON.parse(m.text), type: 'message' }; if (typeof bus.onmessage === 'function') bus.onmessage(ev); for (const fn of L.message) fn(ev); continue; }
          const text = m.raw ? JSON.parse(m.text) : m.text;
          const direct = [...L.inbox]; if (typeof bus.inbox === 'function') direct.push(bus.inbox);
          if (direct.length) { for (const fn of direct) fn(m.from, m.to, m.channel, text); continue; }
          const ev = { data: { from: m.from, to: m.to, channel: m.channel, text }, type: 'message' };
          if (typeof bus.onmessage === 'function') bus.onmessage(ev); for (const fn of L.message) fn(ev);
        } catch (e) { setTimeout(() => { throw e; }); }   // surface handler errors as pageerror, keep delivering
      }
    },
  };
  Object.defineProperty(window, '__MP_BUS', { value: bus, configurable: true, writable: false });
};

// Frame counter + recorder used by the checks (every page; costs nothing until used).
const FRAMES_PAGE = () => {
  window.__MP_FRAMES = 0;
  const raf = window.requestAnimationFrame && window.requestAnimationFrame.bind(window);
  if (!raf) return;
  const tick = () => { window.__MP_FRAMES++; raf(tick); };
  try { raf(tick); } catch (e) { /* stubbed */ }
};

// ---------------------------------------------------------------- Node side of the bus
function bus(opts = {}) {
  const o = { latency: 0, jitter: 0, loss: 0, reorder: 0, seed: 1, mode: 'manual', maxMessage: MAX_MESSAGE, ...opts };
  let rand = rng(o.seed), now = 0, order = 0, pumpTimer = null, closed = false;
  const t0 = Date.now();
  const clock = () => o.mode === 'manual' ? now : Date.now() - t0;
  const queue = [];                       // {due, ord, to: page, msg}
  const pages = new Map();                // page -> {name, recv, sent?, inflight: Promise, ids:Set}
  const ids = new Map();                  // peerId -> page
  const lastDue = new Map();              // `${fromPage}>${toPage}` ctl ordering
  const cut = new Map();                  // peerId -> {silent}
  const filters = [];                     // fn(meta) -> true = drop
  const talked = new Map();               // peerId -> Set(peerId) it exchanged messages with
  const blocks = [];                      // pending bus.block() kinds, consumed by the next '_' connect
  const log = [];                         // last messages {at, from, to, channel, t, b, bytes, dropped}
  let S = null; const resetStats = () => { S = { since: clock(), sinceWall: Date.now(), links: {}, types: {}, totals: { msgs: 0, bytes: 0 }, dropped: 0, filtered: 0, undeliverable: 0, forged: 0, oversize: 0, maxMessage: 0, keyframes: 0, kfRequests: 0, consumed: {} }; };
  resetStats();

  const info = page => { let p = pages.get(page); if (!p) { p = { name: 'page' + pages.size, recv: 0, out: [], busy: false, done: Promise.resolve(), ids: new Set() }; pages.set(page, p); page.on('close', () => onClose(page)); } return p; };
  // Each page drains its own outbox: one evaluate per batch, the next batch as soon as the previous one returns, so a
  // busy page never holds up delivery to the others.
  const DELIVER = b => window.__MP_BUS && window.__MP_BUS.__deliver(b);
  function kick(page) {
    const P = info(page);
    if (page.isClosed()) { P.out.length = 0; return Promise.resolve(); }
    if (P.busy) return P.done;
    if (!P.out.length) return Promise.resolve();
    P.busy = true;
    const batch = P.out.splice(0);
    P.done = page.evaluate(DELIVER, batch).catch(() => null).then(() => { P.busy = false; return P.out.length ? kick(page) : null; });
    return P.done;
  }
  const nameOf = page => (pages.get(page) || {}).name || '?';
  const insert = item => { let lo = 0, hi = queue.length; while (lo < hi) { const m = (lo + hi) >> 1; const q = queue[m]; if (q.due < item.due || (q.due === item.due && q.ord < item.ord)) lo = m + 1; else hi = m; } queue.splice(lo, 0, item); };
  const meta = text => { if (typeof text !== 'string' || text[0] !== '{') return {}; try { const j = JSON.parse(text); return j && typeof j === 'object' ? { t: j.t || j.type || (j.op ? '_' + j.op : null), b: j.b, c: j.c || j.ch || j.channel, j } : {}; } catch (e) { return {}; } };
  const pair = (a, b) => { if (!a || !b || a === '*' || b === '*') return; (talked.get(a) || talked.set(a, new Set()).get(a)).add(b); (talked.get(b) || talked.set(b, new Set()).get(b)).add(a); };
  const direct = (page, batch) => { info(page).out.push(...batch); return kick(page); };
  const account = (from, to, channel, text, m, dropped) => {
    const bytes = Buffer.byteLength(text || '');
    const key = `${from}>${to}`, L = S.links[key] || (S.links[key] = { msgs: 0, bytes: 0, ctl: { msgs: 0, bytes: 0 }, st: { msgs: 0, bytes: 0 }, types: {} });
    const t = m.t || '?';
    if (!dropped) {
      L.msgs++; L.bytes += bytes; const C = L[channel] || (L[channel] = { msgs: 0, bytes: 0 }); C.msgs++; C.bytes += bytes;
      const T = L.types[t] || (L.types[t] = { msgs: 0, bytes: 0 }); T.msgs++; T.bytes += bytes;
      const G = S.types[t] || (S.types[t] = { msgs: 0, bytes: 0 }); G.msgs++; G.bytes += bytes;
      S.totals.msgs++; S.totals.bytes += bytes; S.maxMessage = Math.max(S.maxMessage, bytes);
      if (bytes > o.maxMessage) S.oversize++;
      if (t === 's' && m.b === -1) S.keyframes++;
      if (t === 'kf') S.kfRequests++;
    }
    log.push({ at: clock(), from, to, channel, t, b: m.b, bytes, dropped: !!dropped }); if (log.length > 5000) log.splice(0, log.length - 4000);
  };
  const enqueue = (toPage, msg, channel, fromKey) => {
    const st = channel === 'st';
    let delay = o.latency + (o.jitter ? (rand() * 2 - 1) * o.jitter : 0);
    if (st && o.reorder && rand() < o.reorder) delay += o.latency + 30;
    delay = Math.max(0, delay);
    let due = clock() + delay;
    if (!st) { const k = `${fromKey}>${nameOf(toPage)}`; due = Math.max(due, lastDue.get(k) || 0); lastDue.set(k, due); }
    insert({ due, ord: order++, to: toPage, msg });
    if (o.mode === 'realtime') pump();
  };
  // A relay-injected '_' envelope from `from` to `to`, ordered after the ctl traffic already in flight on that pair.
  const inject = (from, to, op) => { const pg = ids.get(to); if (!pg || pg.isClosed()) return; const text = JSON.stringify(op); account(from, to, '_', text, meta(text), false); enqueue(pg, { k: 'send', from, to, channel: '_', text, raw: false }, '_', from); };
  function recv(page, m) {
    if (closed) return;
    if (m.k === 'batch') { for (const x of m.list || []) recv(page, x); return; }
    const P = info(page); P.recv = Math.max(P.recv, m.n || 0);
    // A peer id belongs to the live page that registered it first (a DataChannel cannot send as another peer): a page
    // that registers or sends under another live page's id is counted as forged and dropped.
    const ownedElsewhere = id => { const o = id != null && ids.get(id); return !!o && o !== page && !o.isClosed(); };
    if (m.k === 'reg') { if (ownedElsewhere(m.id)) { S.forged++; return; } ids.set(m.id, page); P.ids.add(m.id); return; }
    if (m.k === 'unreg') { if (ids.get(m.id) === page) ids.delete(m.id); P.ids.delete(m.id); return; }
    if (m.k === 'claim') { const owner = ids.get(m.id), ok = !owner || owner === page || owner.isClosed(); if (ok) { ids.set(m.id, page); P.ids.add(m.id); } direct(page, [{ k: 'claim-r', id: m.id, ok }]); return; }
    if (m.k === 'bc') {
      const md = meta(m.text), channel = md.c === 'st' ? 'st' : 'ctl', inner = md.j && typeof md.j.text === 'string' ? meta(md.j.text) : {};
      const mm = inner.t ? inner : md;
      for (const [pg] of pages) {
        if (pg === page || pg.isClosed()) continue;
        if (drop(P.name, nameOf(pg), channel, mm, m.text)) continue;
        account(P.name, nameOf(pg), channel, m.text, mm, false); enqueue(pg, { k: 'bc', text: m.text }, channel, P.name);
      }
      return;
    }
    if (m.k === 'send') {
      if (m.from && ownedElsewhere(m.from)) { S.forged++; log.push({ at: clock(), from: m.from, to: m.to, channel: m.channel, forged: true, by: P.name }); return; }
      if (m.from) { const o = ids.get(m.from); if (!o || o.isClosed()) ids.set(m.from, page); P.ids.add(m.from); }
      const channel = m.channel === 'st' ? 'st' : (m.channel || 'ctl'), md = meta(m.text);
      if (channel === '_' && md.t === '_connect' && blocks.length) {   // bus.block(kind): this connect fails like a blocked network
        const kind = blocks.shift(); S.consumed[kind] = (S.consumed[kind] || 0) + 1;
        if (m.from) inject(m.to, m.from, { op: 'fail', code: kind === 'ice' ? 'ice-failed' : kind, link: md.j && md.j.link });
        return;
      }
      if (m.to !== '*') pair(m.from, m.to);
      const targets = m.to === '*' ? [...pages.keys()].filter(pg => pg !== page && !pg.isClosed()) : [ids.get(m.to)].filter(Boolean);
      if (!targets.length) { S.undeliverable++; log.push({ at: clock(), from: m.from, to: m.to, channel, t: md.t, undeliverable: true }); return; }
      for (const pg of targets) {
        if (pg.isClosed()) { S.undeliverable++; continue; }
        if ((m.from && cut.has(m.from)) || (m.to && cut.has(m.to))) { S.filtered++; continue; }
        if (drop(m.from || P.name, m.to, channel, md, m.text)) continue;
        account(m.from || P.name, m.to, channel, m.text, md, false); enqueue(pg, { k: 'send', from: m.from, to: m.to, channel, text: m.text, raw: !!m.raw }, channel, m.from || P.name);
      }
    }
  }
  function drop(from, to, channel, md, text) {
    for (const f of filters) if (f({ from, to, channel, t: md.t, b: md.b, msg: md.j, text })) { S.filtered++; log.push({ at: clock(), from, to, channel, t: md.t, filtered: true }); return true; }
    if (channel === 'st' && o.loss && rand() < o.loss) { S.dropped++; account(from, to, channel, text, md, true); return true; }
    return false;
  }
  // A closed tab closes its data channels: every peer it talked to gets {"op":"close"} from each of its ids (after the
  // messages already in flight on that pair), then a 'gone' presence notice.
  function onClose(page) {
    const P = pages.get(page); if (!P) return;
    const gone = [...P.ids].filter(id => ids.get(id) === page);
    for (const id of gone) for (const peer of talked.get(id) || []) inject(id, peer, { op: 'close' });
    for (const id of gone) ids.delete(id);
    for (const [pg] of pages) if (pg !== page && !pg.isClosed()) for (const id of gone) insert({ due: clock() + o.latency, ord: order++, to: pg, msg: { k: 'gone', id } });
    if (o.mode === 'realtime') pump();
  }
  // Move every queued message due at or before `upTo` to its page's outbox (in due order) and start the flushes; the
  // promise settles when those pages have taken everything.
  function deliver(upTo) {
    const touched = new Set();
    while (queue.length && queue[0].due <= upTo) { const q = queue.shift(); if (q.to.isClosed()) continue; info(q.to).out.push(q.msg); touched.add(q.to); }
    return Promise.all([...touched].map(kick)).then(() => touched.size);
  }
  function pump() {
    if (pumpTimer || closed || o.mode !== 'realtime') return;
    const wait = queue.length ? Math.max(0, Math.min(8, queue[0].due - clock())) : 4;
    pumpTimer = setTimeout(() => { pumpTimer = null; deliver(clock()); if (queue.length) pump(); }, wait);
  }
  // Wait until Node has received every message each live page has sent (exposeBinding calls are asynchronous).
  async function settle(timeout = 2000) {
    const end = Date.now() + timeout;
    for (const [pg, P] of pages) {
      if (pg.isClosed()) continue;
      const n = await pg.evaluate(() => window.__MP_BUS ? window.__MP_BUS.__seq() : 0).catch(() => 0);
      while (P.recv < n && Date.now() < end) await sleep(2);
    }
  }
  const api = {
    opts: o,
    get now() { return clock(); },
    // Attach to a BrowserContext (every page it opens) or to a single Page (before its goto).
    async attach(target, name) {
      const isPage = typeof target.goto === 'function';
      const ctx = isPage ? target.context() : target;
      if (!ctx.__mpBus) {
        ctx.__mpBus = api;
        await ctx.exposeBinding('__mpSend', (source, m) => recv(source.page, m));
        await ctx.addInitScript(BUS_PAGE);
        await ctx.addInitScript(FRAMES_PAGE);
        ctx.on('page', pg => info(pg));
      }
      if (isPage) api.name(target, name || nameOf(target));
      return api;
    },
    name(page, name) { info(page).name = name; if (!page.isClosed()) page.evaluate(n => { if (window.__MP_BUS) window.__MP_BUS.name = n; }, name).catch(() => {}); return api; },
    pageOf: id => ids.get(id) || null,
    idsOf: page => [...(info(page).ids)],
    peers: () => [...ids.entries()].map(([id, pg]) => ({ id, page: nameOf(pg), talked: [...(talked.get(id) || [])] })),
    async advance(ms = 0) { await settle(); now += ms; let guard = 0; while (queue.length && queue[0].due <= now && guard++ < 1000) { await deliver(now); await settle(); } },
    async flushAll(maxRounds = 200) { let r = 0; await settle(); while (queue.length && r++ < maxRounds) { const due = queue[queue.length - 1].due; if (o.mode === 'manual') now = Math.max(now, due); await deliver(Math.max(due, clock())); await settle(); } return r; },
    settle,
    pending: () => queue.length,
    set(patch) { Object.assign(o, patch); if (patch.seed != null) rand = rng(patch.seed); return api; },
    filter(fn) { filters.push(fn); return () => { const i = filters.indexOf(fn); if (i >= 0) filters.splice(i, 1); }; },
    // Simulate a dropped link: every message to or from peerId is dropped from now on. Unless silent, both ends of each
    // link it had get {"op":"cut"} (net.js closes the link with reason 'cut'; a joiner reports 'timeout').
    cut(peerId, { silent = false } = {}) {
      if (!silent) for (const peer of talked.get(peerId) || []) { inject(peerId, peer, { op: 'cut' }); inject(peer, peerId, { op: 'cut' }); }
      cut.set(peerId, { silent });
      if (!silent) for (const [p2] of pages) if (p2 !== ids.get(peerId) && !p2.isClosed()) insert({ due: clock(), ord: order++, to: p2, msg: { k: 'gone', id: peerId } });
      if (o.mode === 'realtime') pump();
      return () => cut.delete(peerId);
    },
    uncut(peerId) { cut.delete(peerId); },
    // The next loopback connect (a '_' {"op":"connect"}) fails with that error code ('ice' -> 'ice-failed').
    block(kind = 'ice', on = true) { if (on) blocks.push(kind); else blocks.length = 0; return api; },
    stats() {
      const el = Math.max(1, (o.mode === 'manual' ? clock() - S.since : Date.now() - S.sinceWall));
      const links = {};
      for (const [k, L] of Object.entries(S.links)) links[k] = { ...L, kBps: +(L.bytes / el).toFixed(2), stKBps: +((L.st ? L.st.bytes : 0) / el).toFixed(2), ctlKBps: +((L.ctl ? L.ctl.bytes : 0) / el).toFixed(2) };
      return { ...S, links, elapsedMs: el, pending: queue.length };
    },
    resetStats() { resetStats(); return api; },
    // Peak rate (KB/s) over any windowMs-long window since the last resetStats, per group (default: per link), from
    // the message log: {group: KBps}.
    peak({ windowMs = 1000, filter = () => true, by = e => e.from + '>' + e.to } = {}) {
      const since = S.since, groups = {};
      for (const e of log) if (e.at >= since && e.bytes != null && !e.dropped && filter(e)) (groups[by(e)] || (groups[by(e)] = [])).push(e);
      const out = {};
      for (const [k, list] of Object.entries(groups)) {
        let lo = 0, sum = 0, max = 0;
        for (let hi = 0; hi < list.length; hi++) { sum += list[hi].bytes; while (list[hi].at - list[lo].at >= windowMs) sum -= list[lo++].bytes; max = Math.max(max, sum); }
        out[k] = +(max / windowMs).toFixed(2);
      }
      return out;
    },
    log: (filter) => filter ? log.filter(filter) : log.slice(),
    async close() { closed = true; if (pumpTimer) clearTimeout(pumpTimer); queue.length = 0; },
  };
  return api;
}

// ---------------------------------------------------------------- server
let serverChild = null;
const ping = (u, ms = 1500) => new Promise(res => { const r = http.get(u, x => { x.resume(); res(x.statusCode); }); r.on('error', () => res(0)); r.setTimeout(ms, () => { r.destroy(); res(0); }); });
const baseDir = () => A.SITE;   // the site root; the game page is A.GAME_PAGE (play.html)
const urlOf = rel => baseDir() + '/' + rel.replace(/^\//, '');
// Make sure GAME_URL answers; when it is the default local address and nothing listens, start tools/serve.cjs there.
async function ensureServer() {
  if (A.isFileURL()) return { ok: false, why: 'GAME_URL is a file:// URL: multiplayer needs http' };
  const first = await ping(urlOf(A.GAME_PAGE));
  if (first === 200) return { ok: true, started: false };
  if (first) return { ok: false, why: `${urlOf(A.GAME_PAGE)} answers HTTP ${first}: another server is on that address (expected 200 from tools/serve.cjs)` };
  const m = /^http:\/\/(127\.0\.0\.1|localhost):(\d+)/.exec(baseDir());
  if (!m) return { ok: false, why: `${A.BASE} does not answer` };
  serverChild = spawn(process.execPath, [path.join(A.ROOT, 'tools', 'serve.cjs'), m[2]], { stdio: 'ignore', windowsHide: true });
  process.on('exit', () => { try { serverChild.kill(); } catch (e) { /* gone */ } });
  for (let i = 0; i < 40; i++) { await sleep(150); if ((await ping(urlOf(A.GAME_PAGE))) === 200) return { ok: true, started: true }; }
  return { ok: false, why: `could not start tools/serve.cjs on port ${m[2]}` };
}
const exists = async rel => (await ping(urlOf(rel))) === 200;
function stopServer() { if (serverChild) { try { serverChild.kill(); } catch (e) { /* gone */ } serverChild = null; } }

// ---------------------------------------------------------------- in-page helpers (window.MPT)
// Installed on every session page after load. Adapter- and snapshot-shape tolerant: the mock game (MOCK_GAME) and the
// integrated game (LAST_EDEN.mp) are both read through these.
const MPT_SOURCE = `(() => {
  const N = () => window.EDEN_NET || null, LB = () => window.EDEN_LOBBY || null;
  const game = () => window.LAST_EDEN && window.LAST_EDEN.mp ? window.LAST_EDEN : null;
  const mock = () => window.MOCK_GAME || null;
  const adapter = () => { const g = game(); if (g) return g.mp.adapter; const m = mock(); return m ? (m.adapter || m) : null; };
  const num = v => typeof v === 'number' && isFinite(v) ? v : null;
  const rowsOf = v => Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [];
  // Normalised world: {time, state, camera, role, players:[{slot,hero,x,y,z,hp,score,lives}|null], ents:{key:{nid,x,y}}}
  const world = () => {
    const g = game();
    let s;
    if (g) {
      const S = g.snapshot;
      s = { time: num(S.time), state: S.state, camera: S.camera, players: S.players || [S.player && { ...S.player, slot: 0, hero: S.player.hero }],
            enemies: (S.enemies || []).map(e => ({ nid: e.nid, x: e.x, y: e.y, z: e.z, hp: e.hp, dead: e.dead })), bullets: (S.bullets || []).map(b => ({ nid: b.nid, x: b.x, y: b.y })),
            role: g.mp.role ? g.mp.role() : null, localSlot: S.localSlot, net: S.net };
    } else if (mock()) {
      const m = mock(); s = typeof m.snapshot === 'function' ? m.snapshot() : (m.snapshot || {});
    } else return null;
    const players = [null, null, null];
    rowsOf(s.players || s.p).forEach((p, i) => { if (!p) return; const slot = num(p.slot) != null ? p.slot : i; if (slot >= 0 && slot < 3) players[slot] = { slot, hero: p.hero, x: p.x, y: p.y, z: p.z || 0, hp: p.hp, score: p.score, lives: p.lives, nid: p.nid }; });
    const ents = {};
    for (const [sec, list] of [['e', s.enemies || s.e], ['b', s.bullets || s.b]]) for (const r of rowsOf(list)) if (r && r.nid != null) ents[sec + r.nid] = { nid: r.nid, x: r.x, y: r.y };
    const role = s.role != null ? (typeof s.role === 'function' ? s.role() : s.role) : (mock() && typeof mock().role === 'function' ? mock().role() : mock() && mock().role) || null;
    return { time: num(s.time != null ? s.time : s.g && s.g.time), state: s.state != null ? s.state : s.g && s.g.state, camera: num(s.camera != null ? s.camera : s.g && s.g.camera), role, players, ents };
  };
  const status = () => { try { return N() && N().status ? N().status() : null; } catch (e) { return { error: 'status threw: ' + e.message }; } };
  const lobby = () => { try { return LB() && LB().status ? LB().status() : null; } catch (e) { return null; } };
  const vis = sel => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]'); };
  const text = sel => { const el = document.querySelector(sel); return el ? el.textContent.trim() : null; };
  const step = dt => { const g = game(), m = mock(); if (g) return g.step(dt); if (m && typeof m.step === 'function') return m.step(dt); };
  // A serialized host state (adapter.serialize(), the NET_SCHEMA shape) in the world() form: players by slot, entities
  // keyed by section + nid ('e' for an enemy section, 'b' for a bullet section).
  const fromRaw = (raw, schema) => {
    if (!raw || typeof raw !== 'object') return null;
    const sch = schema || {}, secs = sch.sections || {}, ps = sch.playerSection || 'p', tf = sch.timeField !== undefined ? sch.timeField : 'time';
    const g = raw.g || {}, t = num(g[tf] != null ? g[tf] : raw[tf]);
    const players = [null, null, null];
    rowsOf(raw[ps]).forEach((p, i) => { if (!p) return; const slot = num(p.slot) != null ? p.slot : i; if (slot >= 0 && slot < 3) players[slot] = { slot, hero: p.hero, x: +p.x, y: +p.y, z: +(p.z || 0), hp: p.hp, nid: p.nid }; });
    const ents = {};
    for (const [name, sec] of Object.entries(secs)) {
      if (name === ps || !sec || sec.key !== 'nid') continue;
      const pre = name === 'e' || /enem/i.test(name) ? 'e' : name === 'b' || /bullet/i.test(name) ? 'b' : name;
      for (const r of rowsOf(raw[name])) if (r && r.nid != null) ents[pre + r.nid] = { nid: r.nid, x: +r.x, y: +r.y };
    }
    return { time: t, state: g.state != null ? g.state : raw.state, players, ents };
  };
  // Record the host's world. With adapter.serialize (net.js calls it once per snapshot, 20 Hz) every call is recorded:
  // the exact states the joiners receive, at no extra cost to the host frame. Without it, world() every animation frame.
  const rec = { on: false, list: [], mode: null, unwrap: null };
  const record = (on = true, max = 600) => {
    if (rec.unwrap) { rec.unwrap(); rec.unwrap = null; }
    rec.list = []; rec.on = on; if (!on) return rec.mode;
    const A = adapter();
    if (A && typeof A.serialize === 'function') {
      rec.mode = 'serialize';
      const f = A.serialize, own = Object.prototype.hasOwnProperty.call(A, 'serialize');
      A.serialize = function () { const raw = f.apply(this, arguments); try { const w = fromRaw(raw, A.schema); if (w && rec.on) { rec.list.push(w); if (rec.list.length > max) rec.list.shift(); } } catch (e) { /* a test helper never breaks the host */ } return raw; };
      rec.unwrap = () => { if (own) A.serialize = f; else delete A.serialize; };
      return rec.mode;
    }
    rec.mode = 'raf';
    const raf = window.requestAnimationFrame.bind(window); const tick = () => { if (!rec.on) return; const w = world(); if (w) { rec.list.push(w); if (rec.list.length > max) rec.list.shift(); } raf(tick); }; raf(tick);
    return rec.mode;
  };
  // Decoded snapshots by n: the host's quantised history (array of {n, q}) or the joiner's decoded history (Map n -> q),
  // both net.js session internals. ns: the snapshot numbers wanted (default: the newest 'limit').
  const history = (ns, limit = 12) => {
    const s = N() && N().session; if (!s || !s.history) return null;
    const H = s.history, out = {};
    if (H instanceof Map) { const keys = ns || [...H.keys()].slice(-limit); for (const n of keys) if (H.has(n)) out[n] = H.get(n); return out; }
    if (Array.isArray(H)) { const list = H.filter(h => h && (!ns || ns.includes(h.n))); for (const h of (ns ? list : list.slice(-limit))) out[h.n] = h.q; return out; }
    return null;
  };
  const schema = () => { const A = adapter(); try { return A && A.schema ? JSON.parse(JSON.stringify(A.schema)) : null; } catch (e) { return null; } };
  return { N, LB, game, mock, adapter, world, status, lobby, vis, text, step, record, recorded: () => rec.list, rec, fromRaw, history, schema };
})()`;

async function installMPT(page) { await page.evaluate(`window.MPT = ${MPT_SOURCE}; true`); }

// What exists on a page (gates).
async function probe(page) {
  return page.evaluate(() => {
    const N = window.EDEN_NET, L = window.EDEN_LOBBY, M = window.MOCK_GAME, G = window.LAST_EDEN;
    const keys = o => o ? Object.keys(o) : [];
    return {
      href: location.href, net: !!N, lobby: !!L, mock: !!M, game: !!G, mp: !!(G && G.mp), adapter: !!((G && G.mp && G.mp.adapter) || (M && (M.adapter || M))),
      netKeys: keys(N), lobbyKeys: keys(L), mockKeys: keys(M), mpKeys: keys(G && G.mp),
      transports: N && N.transports ? keys(N.transports) : [], peerLoaded: typeof window.Peer !== 'undefined', bus: !!window.__MP_BUS,
    };
  });
}

// ---------------------------------------------------------------- sessions
let sharedBrowser = null;
async function browserFor(opts = {}) {
  if (opts.browser) return { browser: opts.browser, own: false };
  if (opts.shared !== false) { if (!sharedBrowser || !sharedBrowser.isConnected()) sharedBrowser = await A.playwright().chromium.launch({ headless: opts.headless !== false }); return { browser: sharedBrowser, own: false }; }
  return { browser: await A.playwright().chromium.launch({ headless: opts.headless !== false }), own: true };
}
async function closeShared() { if (sharedBrowser) { await sharedBrowser.close().catch(() => {}); sharedBrowser = null; } }

const pageUrl = (kind, query = {}) => {
  const rel = kind === 'game' ? A.GAME_PAGE : kind === 'harness' ? 'tests/fixtures/mp-harness.html' : kind;
  const q = new URLSearchParams({ net: 'loopback', ...query }); for (const [k, v] of [...q]) if (v === null || v === 'null') q.delete(k);
  const s = q.toString(); return urlOf(rel) + (s ? '?' + s : '');
};

async function waitLoaded(page, kind, timeout = 30000) {
  if (kind === 'game') await A.waitReady(page, timeout);
  else await page.waitForFunction(() => document.readyState === 'complete', null, { timeout });
  await installMPT(page);
}

// Opens one page per player, each in its own context (separate sessionStorage/localStorage, so a separate cid).
async function session({ players = 2, page = 'harness', url = null, bus: B = null, seed = null, raf = false, mobile = false, query = {}, browser = null, headless = true, names = null, open = true, timeout = 30000 } = {}) {
  const { browser: br, own } = await browserFor({ browser, headless });
  B = B || bus({ mode: raf ? 'manual' : 'realtime' });
  const errors = [], contexts = [], pages = [], requests = [];
  const sess = { browser: br, bus: B, contexts, pages, errors, requests, host: null, joiners: [], kind: page, url };
  sess.open = async (name, q = query) => {
    const ctx = await br.newContext(mobile ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } : { viewport: { width: 1100, height: 760 } });
    await B.attach(ctx);
    const pg = await ctx.newPage();
    B.name(pg, name);
    pg.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    pg.on('request', r => requests.push({ page: name, url: r.url() }));
    await A.prepare(pg, { seed, raf });
    contexts.push(ctx); pages.push(pg);
    if (open) { await pg.goto(url || pageUrl(page, q), { timeout }); await waitLoaded(pg, page, timeout); B.name(pg, name); }
    return pg;
  };
  const list = names || ['host', 'j1', 'j2', 'j3'].slice(0, players);
  for (const n of list) await sess.open(n);
  sess.host = pages[0]; sess.joiners = pages.slice(1);
  sess.close = async () => { await B.close(); for (const c of contexts) await c.close().catch(() => {}); if (own) await br.close().catch(() => {}); };
  return sess;
}

// ---------------------------------------------------------------- lobby / session driving
const visible = (page, sel) => page.evaluate(s => window.MPT ? MPT.vis(s) : !!document.querySelector(s), sel).catch(() => false);
async function waitFor(page, fn, arg, timeout = 8000, poll = 50) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { last = await page.evaluate(fn, arg).catch(e => ({ __err: e.message })); if (last && !last.__err) return last; await sleep(poll); }
  return null;
}
async function useLobby(page, via) {
  if (via === 'api') return false;
  const p = await page.evaluate(() => ({ lobby: !!window.EDEN_LOBBY })).catch(() => ({}));
  if (via === 'lobby' && !p.lobby) throw new Error('EDEN_LOBBY is not loaded on this page');
  return !!p.lobby;
}
// Open the lobby's online menu: the game's own #mp-open button when there is one, else EDEN_LOBBY.open().
async function openLobby(page, mode = 'menu') {
  if (await visible(page, '#mp-host') || await visible(page, '#mp-join')) return;
  if (await visible(page, '#mp-open')) { await page.click('#mp-open'); if (await waitFor(page, () => MPT.vis('#mp-host') || MPT.vis('#mp-join'), null, 3000)) return; }
  await page.evaluate(mode => EDEN_LOBBY.open({ adapter: MPT.adapter(), net: window.EDEN_NET, mode }), mode);
  await waitFor(page, () => MPT.vis('#mp-host') || MPT.vis('#mp-join') || MPT.vis('#mp-code') || MPT.vis('#mp-code-input'), null, 3000);
}
// API path (no lobby): hosts through EDEN_NET.host and keeps the session in window.__mpSess.
const API_HELPERS = `(() => {
  const transport = () => { const N = window.EDEN_NET; const T = N.transports.loopback; return T(window.__MP_BUS ? { bus: window.__MP_BUS } : {}); };
  // Count adapter calls so the API path only calls startGame/enterReplica itself when net.js has not.
  const A = MPT.adapter(), calls = window.__mpCalls = window.__mpCalls || { startGame: 0, enterReplica: 0, addPlayer: [], setRemoteInput: 0, presses: {} };
  if (A && !A.__mpWrapped) {
    A.__mpWrapped = true;
    for (const k of ['startGame', 'enterReplica']) if (typeof A[k] === 'function') { const f = A[k]; A[k] = function (...a) { calls[k]++; return f.apply(this, a); }; }
    if (typeof A.addPlayer === 'function') { const f = A.addPlayer; A.addPlayer = function (...a) { let can = null; try { can = typeof A.canAdmit === 'function' ? !!A.canAdmit() : null; } catch (e) { /* */ } let at = null; const G = window.LAST_EDEN && window.LAST_EDEN.mp ? window.LAST_EDEN : null;
        if (G) { try { const S = G.snapshot; at = { state: S.state, lock: S.lock || null, driving: !!S.driving, fade: S.fade || null, bossCard: S.bossCard || null, encounter: S.encounter }; } catch (e) { at = { err: e.message }; } }
        else { const w = MPT.world(); at = { state: w && w.state }; }
        calls.addPlayer.push({ slot: a[0], hero: a[1], canAdmit: can, ...at, at: performance.now() }); return f.apply(this, a); }; }
    if (typeof A.setRemoteInput === 'function') { const f = A.setRemoteInput; A.setRemoteInput = function (slot, fr) { calls.setRemoteInput++; const pr = fr && (fr.presses || []); for (const c of pr) { const k = slot + ':' + c; calls.presses[k] = (calls.presses[k] || 0) + 1; } return f.apply(this, arguments); }; }
  }
  return { transport, calls };
})()`;
async function apiHelpers(page) { await page.evaluate(`window.__mpApi = ${API_HELPERS}; true`); }

// Host a room. Returns the room code ('DINO-XXXX'). opts.via: 'lobby' | 'api' | auto (lobby when EDEN_LOBBY is loaded).
async function hostRoom(page, { hero = 0, chapter = 0, difficulty = 'normal', name = 'HOST', via = null, timeout = 10000 } = {}) {
  await apiHelpers(page);
  if (await useLobby(page, via)) {
    await openLobby(page);
    await page.click('#mp-host');
    const ok = await waitFor(page, () => { const t = MPT.text('#mp-code'); return t && /DINO-/.test(t) ? t : (MPT.vis('#mp-error-screen') ? { error: (MPT.lobby() || {}).error || MPT.text('#mp-error-screen') } : null); }, null, timeout);
    if (!ok || ok.error) throw new Error('hosting failed: ' + JSON.stringify(ok));
    await pickHero(page, hero);
    if (await page.locator('#mp-chapter').count()) await page.selectOption('#mp-chapter', String(chapter)).catch(() => {});
    if (await page.locator('#mp-difficulty').count()) await page.selectOption('#mp-difficulty', difficulty).catch(() => {});
    return (await page.evaluate(() => MPT.text('#mp-code'))).match(/DINO-[A-Z0-9]{4}/)[0];
  }
  return page.evaluate(async ({ hero, chapter, difficulty, name }) => {
    const s = await EDEN_NET.host({ adapter: MPT.adapter(), transport: __mpApi.transport(), name, hero, lobby: { chapter, difficulty, unlocked: 6 } });
    window.__mpSess = s; return s.code;
  }, { hero, chapter, difficulty, name });
}
async function pickHero(page, hero) {
  if (hero == null || hero < 0) return;
  if (await useLobby(page)) {
    const sel = `[data-mp-hero="${hero}"]`;
    if (await page.locator(sel).count()) { if (await page.locator(sel).getAttribute('aria-pressed') !== 'true') await page.click(sel, { timeout: 1500 }).catch(() => {}); }
    return;
  }
  await page.evaluate(h => { const s = window.__mpSess; if (s && s.chooseHero) s.chooseHero(h); }, hero);
}
// Join a room. Returns {slot, error, screen}. error = EDEN_NET error code when it fails.
async function joinRoom(page, code, { hero = -1, name = null, via = null, timeout = 10000 } = {}) {
  await apiHelpers(page);
  if (await useLobby(page, via)) {
    await openLobby(page);
    if (await visible(page, '#mp-join')) await page.click('#mp-join');
    await page.waitForSelector('#mp-code-input', { state: 'visible', timeout: 3000 });
    await page.fill('#mp-code-input', code);
    if (name && await page.locator('#mp-name').count()) await page.fill('#mp-name', name);
    await page.click('#mp-join-go');
    const r = await waitForJoin(page, timeout);
    if (r && r.slot != null && hero >= 0) await pickHero(page, hero);
    return r || { error: 'no answer', screen: null };
  }
  return page.evaluate(async ({ code, hero, name, timeout }) => {
    try {
      const s = await Promise.race([EDEN_NET.join(code, { adapter: MPT.adapter(), transport: __mpApi.transport(), name: name || ('P' + Math.floor(Math.random() * 90 + 10)), hero }), new Promise((_, rej) => setTimeout(() => rej({ code: 'test-timeout' }), timeout))]);
      window.__mpSess = s;
      if (s.on) s.on('start', cfg => setTimeout(() => { if (!__mpApi.calls.enterReplica) { const A = MPT.adapter(); A.enterReplica({ ...(cfg || {}), slot: s.slot, roster: (cfg && cfg.roster) || s.roster }); } }, 50));
      return { slot: s.slot, error: null };
    } catch (e) { return { slot: null, error: (e && (e.code || e.reason)) || String(e && e.message || e) }; }
  }, { code, hero, name, timeout });
}
async function waitForJoin(page, timeout) {
  return waitFor(page, () => {
    const L = MPT.lobby() || {}, S = MPT.status() || {};
    if (L.screen === 'mp-error-screen' || MPT.vis('#mp-error-screen')) return { slot: null, error: L.error || S.error || 'error', screen: 'mp-error-screen', title: MPT.text('#mp-error-screen') };
    const slot = L.slot != null ? L.slot : S.slot;
    if ((L.screen === 'mp-room' || MPT.vis('#mp-room')) && slot != null && slot > 0) return { slot, error: null, screen: 'mp-room' };
    return null;
  }, null, timeout);
}
async function ready(page, on = true) {
  if (await useLobby(page)) {
    const b = page.locator('#mp-ready'); if (!await b.count()) return;
    // own ready flag: the roster entry of this page's slot, else the button's aria-pressed
    const mine = await page.evaluate(() => { const st = MPT.status() || {}, L = MPT.lobby() || {}; const slot = L.slot != null ? L.slot : st.slot; const r = (st.roster || L.roster || []).find(x => x && x.slot === slot); return r ? !!r.ready : null; });
    const pressed = mine != null ? mine : (await b.getAttribute('aria-pressed')) === 'true';
    if (pressed !== on) await b.click({ timeout: 3000 });
    return;
  }
  await page.evaluate(on => window.__mpSess && __mpSess.ready(on), on);
}
// A late joiner asks to drop in: the lobby's JOIN IN button when it is enabled (the lobby may already have asked when
// the hero was picked: then it reads WAITING TO DROP IN and is disabled), else the session's joinIn().
async function joinIn(page) {
  if (await useLobby(page)) {
    const st = await page.evaluate(() => { const b = document.querySelector('#mp-joinin'); return b ? { vis: MPT.vis('#mp-joinin'), dis: b.disabled } : null; });
    if (st && st.vis && !st.dis) await page.click('#mp-joinin', { timeout: 3000 });
    return;
  }
  await page.evaluate(() => { const s = (window.EDEN_NET && EDEN_NET.session) || window.__mpSess; if (s && s.joinIn) s.joinIn(); });
}
async function start(hostPage, { timeout = 8000 } = {}) {
  if (await useLobby(hostPage)) {
    const ok = await waitFor(hostPage, () => { const b = document.querySelector('#mp-start'); return b && !b.disabled ? true : null; }, null, timeout);
    if (!ok) throw new Error('#mp-start never became enabled');
    await hostPage.click('#mp-start');
  } else {
    await hostPage.evaluate(async () => { await __mpSess.start(); });
    await sleep(150);
    await hostPage.evaluate(() => { if (!__mpApi.calls.startGame) { const s = __mpSess; MPT.adapter().startGame({ chapter: 0, section: 0, difficulty: 'normal', roster: (s.roster || []).map(r => ({ slot: r.slot, hero: r.hero, name: r.name })) }); } });
  }
}
// Host + joiners in a started game. Returns {code, slots}.
async function startAll(sess, { heroes = [0, 1, 2], via = null } = {}) {
  const code = await hostRoom(sess.host, { hero: heroes[0], via });
  const slots = [];
  for (let i = 0; i < sess.joiners.length; i++) { const r = await joinRoom(sess.joiners[i], code, { hero: heroes[i + 1], via }); if (r.error) throw new Error(`joiner ${i + 1}: ${r.error}`); slots.push(r.slot); }
  for (const j of sess.joiners) await ready(j, true);
  await start(sess.host);
  return { code, slots };
}

// ---------------------------------------------------------------- inputs, state
const KEYS = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', attack: 'KeyJ', jump: 'KeyK', special: 'KeyL', pick: 'KeyE', run: 'ShiftLeft', coin: 'Enter' };
const keyOf = c => KEYS[c] || c;
// Hold or release a key on that page's local input. synthetic:true dispatches a KeyboardEvent on window (no focus needed).
async function hold(page, code, on = true, { synthetic = false } = {}) {
  code = keyOf(code);
  if (synthetic) return page.evaluate(([c, o]) => window.dispatchEvent(new KeyboardEvent(o ? 'keydown' : 'keyup', { code: c, key: c, bubbles: true })), [code, on]);
  if (on) await page.keyboard.down(code); else await page.keyboard.up(code);
}
async function press(page, code, opts = {}) { await hold(page, code, true, opts); await sleep(opts.ms || 20); await hold(page, code, false, opts); }
async function blurInputs(page) { await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); }).catch(() => {}); }
const net = page => page.evaluate(() => MPT.status());
const lobbyStatus = page => page.evaluate(() => MPT.lobby());
const snap = page => page.evaluate(() => MPT.world());
const frames = page => page.evaluate(() => window.__MP_FRAMES || 0);

// Host steps n times (g.step or MOCK_GAME.step), the bus flushes, joiners run one frame each (manual/rAF-stubbed mode).
async function step(sess, n = 1, dt = 1 / 60) {
  for (let i = 0; i < n; i++) {
    await sess.host.evaluate(dt => MPT.step(dt), dt);
    await sess.bus.advance(dt * 1000);
    for (const j of sess.joiners) if (!j.isClosed()) await j.evaluate(dt => MPT.step(dt), dt);
    await sess.bus.advance(0);
  }
}

// Compare the host's world with a joiner's: players by slot, entities by nid. {ok, diffs, compared}
function sameWorld(hostSnap, clientSnap, { tol = 1, players = true, entities = true } = {}) {
  const diffs = []; let compared = 0;
  if (!hostSnap || !clientSnap) return { ok: false, diffs: ['missing snapshot'], compared };
  const d = (a, b) => Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
  if (players) for (let s = 0; s < 3; s++) {
    const h = hostSnap.players[s], c = clientSnap.players[s];
    if (!h && !c) continue;
    if (!h || !c) { diffs.push(`slot ${s}: ${h ? 'missing on the joiner' : 'extra on the joiner'}`); continue; }
    compared++; const e = d(h, c); if (e > tol) diffs.push(`slot ${s}: off by ${e.toFixed(2)} px (host ${h.x.toFixed(1)},${h.y.toFixed(1)} joiner ${c.x.toFixed(1)},${c.y.toFixed(1)})`);
    if (h.hero !== c.hero) diffs.push(`slot ${s}: hero ${h.hero} vs ${c.hero}`);
  }
  if (entities) for (const [k, h] of Object.entries(hostSnap.ents || {})) {
    const c = (clientSnap.ents || {})[k]; if (!c) continue;
    compared++; const e = d(h, c); if (e > tol) diffs.push(`${k}: off by ${e.toFixed(2)} px`);
  }
  return { ok: diffs.length === 0, diffs, compared };
}
// Time-matched comparison: the joiner's rendered world against the host's recorded states (MPT.record on the host:
// the serialized snapshots, 20 Hz) at the joiner's render time. The joiner draws a linear interpolation between the
// two snapshots around its render time, so the host side is interpolated the same way between the two records that
// bracket it; anything present in only one of them (spawned or removed in between) is not compared. Bullet sections
// ('b' keys) are left out by default (skip: []) — they are the fastest bodies and add nothing the players and enemies do
// not show. {ok, diffs, compared, at: [t0, t1]}
function sameWorldTimed(hostRecords, clientSnap, { tol = 1.5, skip = ['b'], players = true, slack = 0.012 } = {}) {
  if (!clientSnap || clientSnap.time == null) return { ok: false, diffs: ['the joiner world has no time'], compared: 0 };
  const t = clientSnap.time, recs = hostRecords.filter(r => r && r.time != null).sort((a, b) => a.time - b.time);
  if (!recs.length) return { ok: false, diffs: ['no host record with a time'], compared: 0 };
  let i = recs.findIndex(r => r.time >= t - 1e-9);
  let a, b;
  if (i === 0 && recs[0].time - t <= slack) { a = b = recs[0]; }
  else if (i > 0) { a = recs[i - 1]; b = recs[i]; }
  else if (i < 0 && t - recs[recs.length - 1].time <= slack) { a = b = recs[recs.length - 1]; }
  else return { ok: false, diffs: [`no host records bracket the joiner time t=${t} (host ${recs[0].time}..${recs[recs.length - 1].time})`], compared: 0 };
  const k = b.time > a.time ? (t - a.time) / (b.time - a.time) : 0;
  const lerp = (p, q) => p && q ? { ...q, x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k } : null;
  const host = { players: [0, 1, 2].map(s => lerp(a.players[s], b.players[s]) || (a.players[s] && b.players[s] ? null : (k < 0.5 ? a : b).players[s] || null)), ents: {} };
  for (const key of Object.keys(b.ents || {})) { if (skip.some(p => key.startsWith(p))) continue; const v = lerp((a.ents || {})[key], b.ents[key]); if (v) host.ents[key] = v; }
  const client = { players: clientSnap.players, ents: {} };
  for (const [key, v] of Object.entries(clientSnap.ents || {})) if (!skip.some(p => key.startsWith(p))) client.ents[key] = v;
  const r = sameWorld(host, client, { tol, players });
  return { ...r, at: [a.time, b.time] };
}

// Canonical JSON of a quantised snapshot (sorted keys, keyed sections sorted by their key, -0 as 0).
function canon(v, schema) {
  const sort = x => Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.keys(x).sort().reduce((o, k) => (x[k] === undefined ? o : (o[k] = sort(x[k]), o)), {}) : (Object.is(x, -0) ? 0 : x);
  if (schema && schema.sections && v && typeof v === 'object') {
    v = { ...v };
    for (const [k, sec] of Object.entries(schema.sections)) if (sec && sec.key && Array.isArray(v[k])) v[k] = [...v[k]].sort((a, b) => (a && a[sec.key]) - (b && b[sec.key]));
  }
  return JSON.stringify(sort(v));
}
// First differing path between two plain values (for the diff text).
function firstDiff(a, b, p = '') {
  if (a === b) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return `${p || '.'}: host ${JSON.stringify(a)} joiner ${JSON.stringify(b)}`.slice(0, 200);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
  return null;
}
// The joiner's decoded snapshots (EDEN_NET.session.history) against the host's quantised snapshots of the same numbers:
// the exact states, no interpolation, no echo. {ok, diffs, compared, ns}
async function decodedMatch(host, joiner, { count = 10 } = {}) {
  const J = await joiner.evaluate(c => MPT.history(null, c), count).catch(e => ({ __err: e.message }));
  if (!J || J.__err) return { ok: false, diffs: ['the joiner has no decoded history (EDEN_NET.session.history)' + (J && J.__err ? ': ' + J.__err : '')], compared: 0 };
  const ns = Object.keys(J).map(Number);
  const H = await host.evaluate(ns => ({ rows: MPT.history(ns), schema: MPT.schema() }), ns).catch(e => ({ __err: e.message }));
  if (!H || H.__err || !H.rows) return { ok: false, diffs: ['the host has no snapshot history (EDEN_NET.session.history)'], compared: 0 };
  const diffs = []; let compared = 0;
  for (const n of ns) {
    const h = H.rows[n]; if (!h) continue;
    compared++;
    const hc = canon(h, H.schema), jc = canon(J[n], H.schema);
    if (hc !== jc) diffs.push(`snapshot ${n}: ${firstDiff(JSON.parse(hc), JSON.parse(jc)) || 'differs'}`);
  }
  if (!compared) diffs.push(`no snapshot number in both histories (joiner ${ns.join(',')})`);
  return { ok: !diffs.length && compared > 0, diffs, compared, ns };
}

module.exports = { bus, session, closeShared, ensureServer, stopServer, exists, urlOf, pageUrl, probe, installMPT, hostRoom, joinRoom, pickHero, ready, joinIn, start, startAll, openLobby, waitFor, waitForJoin, visible, hold, press, blurInputs, net, lobbyStatus, snap, frames, step, sameWorld, sameWorldTimed, decodedMatch, canon, KEYS, ALPHABET, CODE_RE, MAX_MESSAGE, sleep, rng };
