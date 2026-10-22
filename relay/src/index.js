// cnd2-relay: a WebSocket relay for Cadillacs & Dinosaurs II online co-op (net.js transport 'relay').
//
// Players whose networks block WebRTC (mobile data and ISP CGNAT, campus and office networks) still reach each other
// over wss:// on port 443 through this Worker. It is a dumb forwarder: one Durable Object per room code, one host and at
// most two joiners, nothing stored. Runs on the Cloudflare Workers free plan (SQLite-backed Durable Object class).
//
// HTTP
//   GET /health                                  -> 200 "ok"
//   GET /room/DINO-XXXX?role=host|join&cid=<id>  -> WebSocket upgrade, routed to the room's Durable Object
//       code: "DINO-" + 4 of 23456789ABCDEFGHJKMNPQRSTUVWXYZ (net.js code.normalize form; case-insensitive here)
//       cid:  [A-Za-z0-9_-]{4,32} (the client id net.js sends in its hello)
//   400 bad code/role/cid · 403 Origin not allowed · 404 other paths · 426 not a WebSocket request
//
// Frames (both directions; text or binary, the payload is never parsed or changed)
//   text:   "<peer>|<ch>\n<payload>"    binary: [header length N][N bytes of ASCII "<peer>|<ch>"][payload]
//   client -> relay: <peer> is the destination. The host addresses one joiner by its relay id, or "*" for all joiners;
//                    a joiner's frames always go to the host (its <peer> is ignored).
//   relay -> client: <peer> is the source ("h" = the host, "j…" = a joiner). <ch> (1-8 lowercase letters, net.js uses
//                    "ctl" and "st") is passed through untouched.
//   Control, as text "@\n<json>":
//     relay -> any:    {"op":"welcome","id","role"}      the socket is in the room
//                      {"op":"close","code","reason"}    sent just before every close the relay starts (codes below)
//     relay -> host:   {"op":"joined","id","cid"} / {"op":"left","id"}
//     host  -> relay:  {"op":"close","id"}               disconnect one joiner (close code 4010)
//   Keep-alive: the text "ping" is answered "pong" without waking the room.
//
// Close codes: 4000 host-left · 4001 room-full · 4002 host-exists · 4004 no-host · 4005 replaced (same cid connected
// again) · 4009 too-big (message over 64 KB) · 4010 closed-by-host · 4029 rate-limit.
//
// Limits: one host and two joiners per room, 64 KB per message, a token bucket per socket (messages beyond it are
// dropped; a socket that keeps flooding is closed), Origin allow-list (ALLOWED_ORIGINS var; requests without an Origin
// header — non-browser tools — are let through, since any such tool could send a fake one anyway).
// tests/fixtures/relay-node.cjs implements this same protocol in Node for the offline test suites.

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RE = new RegExp('^DINO-[' + ALPHABET + ']{4}$');
const CID_RE = /^[A-Za-z0-9_-]{4,32}$/;
const PEER_RE = /^[A-Za-z0-9_*-]{1,16}$/, CH_RE = /^[a-z]{1,8}$/;
const DEFAULT_ORIGINS = 'https://cadillacsanddinosaurs2.vercel.app,http://localhost:*,http://127.0.0.1:*';
const MAX_JOINERS = 2;
const MAX_BYTES = 64 * 1024;
// messages per second and burst: the host sends snapshots, events and keyframe fragments to two joiners
// (~200/s at most); a joiner sends 60 input frames a second plus pings
const RATE = { host: { perSec: 600, burst: 1200 }, join: { perSec: 200, burst: 400 } };
const FLOOD_CLOSE = 2000;   // dropped messages before the socket is closed
const CLOSE = { hostLeft: [4000, 'host-left'], full: [4001, 'room-full'], hostExists: [4002, 'host-exists'], noHost: [4004, 'no-host'],
  replaced: [4005, 'replaced'], tooBig: [4009, 'too-big'], byHost: [4010, 'closed-by-host'], rate: [4029, 'rate-limit'] };

function originAllowed(origin, list) {
  if (!origin) return true;
  for (const raw of String(list || DEFAULT_ORIGINS).split(',')) {
    const pat = raw.trim();
    if (!pat) continue;
    if (pat === origin) return true;
    if (pat.endsWith(':*') && origin.startsWith(pat.slice(0, -1)) && /^\d{1,5}$/.test(origin.slice(pat.length - 1))) return true;
    if (pat.endsWith(':*') && origin === pat.slice(0, -2)) return true;   // http://localhost (port 80)
  }
  return false;
}

const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname === '/') return text(url.pathname === '/' ? 'cnd2-relay ok' : 'ok');
    const m = /^\/room\/([^/]+)$/.exec(url.pathname);
    if (!m) return text('not found', 404);
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return text('expected a WebSocket upgrade', 426);
    if (!originAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) return text('origin not allowed', 403);
    let code = '';
    try { code = decodeURIComponent(m[1]).toUpperCase(); } catch (e) { return text('bad room code', 400); }
    if (!CODE_RE.test(code)) return text('bad room code', 400);
    const role = url.searchParams.get('role'), cid = url.searchParams.get('cid') || '';
    if (role !== 'host' && role !== 'join') return text('role must be host or join', 400);
    if (!CID_RE.test(cid)) return text('bad client id', 400);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const fwd = new URL(request.url);
    fwd.pathname = '/room/' + code;
    return stub.fetch(new Request(fwd.toString(), request));
  },
};

const enc = new TextEncoder(), dec = new TextDecoder();
const rid = () => { const b = new Uint8Array(6); crypto.getRandomValues(b); let s = 'j'; for (const x of b) s += ALPHABET[x % ALPHABET.length].toLowerCase(); return s; };
const isOpen = ws => ws.readyState === 1;
const safeSend = (ws, data) => { try { ws.send(data); return true; } catch (e) { return false; } };
const control = o => '@\n' + JSON.stringify(o);
// Every close the relay starts is announced first ({"op":"close","code","reason"}), so a client can act on it at once
// even when the closing handshake itself is slow to complete.
const safeClose = (ws, [code, reason]) => {
  if (isOpen(ws)) safeSend(ws, control({ op: 'close', code, reason }));
  try { ws.close(code, reason); } catch (e) { /* already closed */ }
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.buckets = new Map();   // socket id -> {n, at, dropped}; in memory only (it resets if the room hibernates)
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch (e) { /* older runtime */ }
  }

  sockets(tag) { return this.ctx.getWebSockets(tag).filter(isOpen); }
  info(ws) { try { return ws.deserializeAttachment() || {}; } catch (e) { return {}; } }

  // A refused socket is accepted through the hibernation API too (a plain accept() inside a Durable Object leaves a
  // socket the runtime reports as "Network connection lost"), told why, and closed.
  refuse(why) {
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server, ['refused']);
    server.serializeAttachment({ refused: true });
    safeClose(server, why);
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role'), cid = url.searchParams.get('cid') || '';
    const hosts = this.sockets('host'), joiners = this.sockets('join');
    if (role === 'host') {
      const old = hosts[0];
      if (old && this.info(old).cid !== cid) return this.refuse(CLOSE.hostExists);
      if (old) {   // the same host reconnecting (its old socket is stale): the old room is over
        old.serializeAttachment(Object.assign(this.info(old), { replaced: true }));
        safeClose(old, CLOSE.replaced);
        for (const j of joiners) safeClose(j, CLOSE.hostLeft);
      }
    } else {
      const host = hosts[0];
      if (!host) return this.refuse(CLOSE.noHost);
      let count = joiners.length;
      for (const j of joiners) {
        const a = this.info(j);
        if (a.cid !== cid) continue;
        j.serializeAttachment(Object.assign(a, { replaced: true }));
        safeClose(j, CLOSE.replaced);
        safeSend(host, control({ op: 'left', id: a.id }));
        count--;
      }
      if (count >= MAX_JOINERS) return this.refuse(CLOSE.full);
    }
    const id = role === 'host' ? 'h' : rid();
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server, [role, id]);
    server.serializeAttachment({ role, id, cid });
    if (role === 'join') safeSend(this.sockets('host')[0], control({ op: 'joined', id, cid }));
    safeSend(server, control({ op: 'welcome', id, role }));
    return new Response(null, { status: 101, webSocket: client });
  }

  allow(ws, a) {
    const r = RATE[a.role] || RATE.join, now = Date.now();
    let b = this.buckets.get(a.id);
    if (!b) { b = { n: r.burst, at: now, dropped: 0 }; this.buckets.set(a.id, b); }
    b.n = Math.min(r.burst, b.n + ((now - b.at) * r.perSec) / 1000); b.at = now;
    if (b.n >= 1) { b.n -= 1; return true; }
    if (++b.dropped >= FLOOD_CLOSE) safeClose(ws, CLOSE.rate);
    return false;
  }

  async webSocketMessage(ws, message) {
    const a = this.info(ws);
    if (a.replaced || a.refused || !a.role) return;
    const size = typeof message === 'string' ? message.length : message.byteLength;
    if (size > MAX_BYTES) { safeClose(ws, CLOSE.tooBig); return; }
    if (!this.allow(ws, a)) return;
    let header, rest;
    if (typeof message === 'string') {
      const i = message.indexOf('\n');
      if (i < 1 || i > 40) return;
      header = message.slice(0, i);
      if (header === '@') { if (a.role === 'host') this.hostControl(message.slice(i + 1)); return; }
      rest = message.slice(i + 1);
    } else {
      const u8 = new Uint8Array(message), n = u8[0];
      if (!n || n > 40 || u8.length < 1 + n) return;
      header = dec.decode(u8.subarray(1, 1 + n));
      rest = u8.subarray(1 + n);
    }
    const bar = header.indexOf('|'), to = header.slice(0, bar), ch = header.slice(bar + 1);
    if (bar < 1 || !PEER_RE.test(to) || !CH_RE.test(ch)) return;
    const out = (from) => {
      const h = from + '|' + ch;
      if (typeof rest === 'string') return h + '\n' + rest;
      const hb = enc.encode(h), buf = new Uint8Array(1 + hb.length + rest.length);
      buf[0] = hb.length; buf.set(hb, 1); buf.set(rest, 1 + hb.length);
      return buf;
    };
    if (a.role === 'join') { const host = this.sockets('host')[0]; if (host) safeSend(host, out(a.id)); return; }
    const targets = to === '*' ? this.sockets('join') : this.sockets(to).filter(s => this.info(s).role === 'join');
    if (!targets.length) return;
    const data = out('h');
    for (const t of targets) safeSend(t, data);
  }

  hostControl(json) {
    let o; try { o = JSON.parse(json); } catch (e) { return; }
    if (!o || o.op !== 'close' || typeof o.id !== 'string' || !PEER_RE.test(o.id)) return;
    for (const j of this.sockets(o.id)) if (this.info(j).role === 'join') safeClose(j, CLOSE.byHost);
  }

  gone(ws) {
    const a = this.info(ws);
    this.buckets.delete(a.id);
    if (a.replaced || !a.role) return;
    a.replaced = true;
    try { ws.serializeAttachment(a); } catch (e) { /* closed */ }
    if (a.role === 'host') { for (const j of this.sockets('join')) safeClose(j, CLOSE.hostLeft); return; }
    const host = this.sockets('host')[0];
    if (host) safeSend(host, control({ op: 'left', id: a.id }));
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    this.gone(ws);
  }

  async webSocketError(ws) { this.gone(ws); }
}
