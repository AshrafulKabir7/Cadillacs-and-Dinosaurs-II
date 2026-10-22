// tests/fixtures/relay-node.cjs — the relay/ Cloudflare Worker's protocol (relay/src/index.js) in plain Node, no
// dependencies, for the offline test suites: same paths, query, validation, frames, control messages, close codes and
// limits. tests/lib/relay.cjs starts it (or `wrangler dev` on the real Worker) and checks both against one conformance list.
//
//   const { startRelay } = require('./relay-node.cjs');
//   const r = await startRelay({ port: 0 });   // r.url = 'ws://127.0.0.1:<port>', r.close(), r.rooms
//   node tests/fixtures/relay-node.cjs [port]  // standalone
'use strict';
const http = require('node:http'), crypto = require('node:crypto');

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RE = new RegExp('^DINO-[' + ALPHABET + ']{4}$');
const CID_RE = /^[A-Za-z0-9_-]{4,32}$/, PEER_RE = /^[A-Za-z0-9_*-]{1,16}$/, CH_RE = /^[a-z]{1,8}$/;
const DEFAULT_ORIGINS = 'https://cadillacsanddinosaurs2.vercel.app,http://localhost:*,http://127.0.0.1:*';
const MAX_JOINERS = 2, MAX_BYTES = 64 * 1024, FLOOD_CLOSE = 2000;
const RATE = { host: { perSec: 600, burst: 1200 }, join: { perSec: 200, burst: 400 } };
const CLOSE = { hostLeft: [4000, 'host-left'], full: [4001, 'room-full'], hostExists: [4002, 'host-exists'], noHost: [4004, 'no-host'],
  replaced: [4005, 'replaced'], tooBig: [4009, 'too-big'], byHost: [4010, 'closed-by-host'], rate: [4029, 'rate-limit'] };

function originAllowed(origin, list) {
  if (!origin) return true;
  for (const raw of String(list || DEFAULT_ORIGINS).split(',')) {
    const pat = raw.trim();
    if (!pat) continue;
    if (pat === origin) return true;
    if (pat.endsWith(':*') && origin.startsWith(pat.slice(0, -1)) && /^\d{1,5}$/.test(origin.slice(pat.length - 1))) return true;
    if (pat.endsWith(':*') && origin === pat.slice(0, -2)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- minimal RFC 6455 server socket
function frame(op, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | op, len]) : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  return Buffer.concat([head, payload]);
}
class Sock {
  constructor(socket, onMessage, onClose) {
    this.socket = socket; this.onMessage = onMessage; this.onClose = onClose;
    this.buf = Buffer.alloc(0); this.frag = null; this.readyState = 1; this.attachment = {}; this.tags = [];
    socket.on('data', d => this._data(d));
    socket.on('close', () => this._gone(1006, ''));
    socket.on('error', () => this._gone(1006, ''));
  }
  send(data) {
    if (this.readyState !== 1) return false;
    try { this.socket.write(typeof data === 'string' ? frame(1, Buffer.from(data, 'utf8')) : frame(2, Buffer.from(data))); return true; } catch (e) { return false; }
  }
  close(code = 1000, reason = '') {
    if (this.readyState !== 1) return;
    this.readyState = 2;
    const r = Buffer.from(String(reason).slice(0, 120), 'utf8'), p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0); r.copy(p, 2);
    try { this.socket.write(frame(8, p)); } catch (e) { /* gone */ }
    this.closeTimer = setTimeout(() => this.socket.destroy(), 1000);
  }
  _gone(code, reason) {
    if (this.readyState === 3) return;
    this.readyState = 3; clearTimeout(this.closeTimer);
    try { this.socket.destroy(); } catch (e) { /* gone */ }
    this.onClose(this, code, reason);
  }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 15, masked = b[1] & 0x80;
      let len = b[1] & 127, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > 4 * MAX_BYTES) { this._gone(1009, 'too big'); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (b.length < need) return;
      let payload = b.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const m = b.subarray(off, off + 4), u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = payload[i] ^ m[i & 3]; payload = u; }
      else payload = Buffer.from(payload);
      this.buf = b.subarray(need);
      if (op === 8) {   // close: answer it and end
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        if (this.readyState === 1) { this.readyState = 2; try { this.socket.write(frame(8, payload.subarray(0, 2))); } catch (e) { /* gone */ } }
        try { this.socket.end(); } catch (e) { /* gone */ }
        this._gone(code, payload.subarray(2).toString('utf8'));
        return;
      }
      if (op === 9) { try { this.socket.write(frame(10, payload)); } catch (e) { /* gone */ } continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2) this.frag = { op, parts: [payload] };
      else if (op === 0 && this.frag) this.frag.parts.push(payload);
      else continue;
      if (!fin) continue;
      const all = Buffer.concat(this.frag.parts), kind = this.frag.op;
      this.frag = null;
      if (this.readyState === 1) this.onMessage(this, kind === 1 ? all.toString('utf8') : new Uint8Array(all));
    }
  }
}

// ---------------------------------------------------------------- the Room (the Durable Object's logic)
const control = o => '@\n' + JSON.stringify(o);
const isOpen = ws => ws && ws.readyState === 1;
const safeClose = (ws, [code, reason]) => { if (isOpen(ws)) ws.send(control({ op: 'close', code, reason })); ws.close(code, reason); };
const rid = () => { let s = 'j'; for (const x of crypto.randomBytes(6)) s += ALPHABET[x % ALPHABET.length].toLowerCase(); return s; };

class Room {
  constructor() { this.socks = new Set(); this.buckets = new Map(); }
  sockets(tag) { return [...this.socks].filter(s => isOpen(s) && s.tags.includes(tag)); }
  accept(ws, tags, att) { ws.tags = tags; ws.attachment = att; this.socks.add(ws); }
  connect(ws, role, cid) {
    const hosts = this.sockets('host'), joiners = this.sockets('join');
    const refuse = why => { this.accept(ws, ['refused'], { refused: true }); safeClose(ws, why); };
    if (role === 'host') {
      const old = hosts[0];
      if (old && old.attachment.cid !== cid) return refuse(CLOSE.hostExists);
      if (old) { old.attachment.replaced = true; safeClose(old, CLOSE.replaced); for (const j of joiners) safeClose(j, CLOSE.hostLeft); }
    } else {
      const host = hosts[0];
      if (!host) return refuse(CLOSE.noHost);
      let count = joiners.length;
      for (const j of joiners) {
        if (j.attachment.cid !== cid) continue;
        j.attachment.replaced = true; safeClose(j, CLOSE.replaced);
        host.send(control({ op: 'left', id: j.attachment.id })); count--;
      }
      if (count >= MAX_JOINERS) return refuse(CLOSE.full);
    }
    const id = role === 'host' ? 'h' : rid();
    this.accept(ws, [role, id], { role, id, cid });
    if (role === 'join') { const h = this.sockets('host')[0]; if (h) h.send(control({ op: 'joined', id, cid })); }
    ws.send(control({ op: 'welcome', id, role }));
    return undefined;
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
  message(ws, message) {
    const a = ws.attachment;
    if (a.replaced || a.refused || !a.role) return;
    const size = typeof message === 'string' ? message.length : message.byteLength;
    if (size > MAX_BYTES) { safeClose(ws, CLOSE.tooBig); return; }
    if (typeof message === 'string' && message === 'ping') { ws.send('pong'); return; }
    if (!this.allow(ws, a)) return;
    let header, rest;
    if (typeof message === 'string') {
      const i = message.indexOf('\n');
      if (i < 1 || i > 40) return;
      header = message.slice(0, i);
      if (header === '@') { if (a.role === 'host') this.hostControl(message.slice(i + 1)); return; }
      rest = message.slice(i + 1);
    } else {
      const n = message[0];
      if (!n || n > 40 || message.length < 1 + n) return;
      header = Buffer.from(message.subarray(1, 1 + n)).toString('utf8');
      rest = message.subarray(1 + n);
    }
    const bar = header.indexOf('|'), to = header.slice(0, bar), ch = header.slice(bar + 1);
    if (bar < 1 || !PEER_RE.test(to) || !CH_RE.test(ch)) return;
    const out = from => {
      const h = from + '|' + ch;
      if (typeof rest === 'string') return h + '\n' + rest;
      const hb = Buffer.from(h), buf = new Uint8Array(1 + hb.length + rest.length);
      buf[0] = hb.length; buf.set(hb, 1); buf.set(rest, 1 + hb.length);
      return buf;
    };
    if (a.role === 'join') { const host = this.sockets('host')[0]; if (host) host.send(out(a.id)); return; }
    const targets = to === '*' ? this.sockets('join') : this.sockets(to).filter(s => s.attachment.role === 'join');
    const data = out('h');
    for (const t of targets) t.send(data);
  }
  hostControl(json) {
    let o; try { o = JSON.parse(json); } catch (e) { return; }
    if (!o || o.op !== 'close' || typeof o.id !== 'string' || !PEER_RE.test(o.id)) return;
    for (const j of this.sockets(o.id)) if (j.attachment.role === 'join') safeClose(j, CLOSE.byHost);
  }
  gone(ws) {
    this.socks.delete(ws);
    const a = ws.attachment;
    this.buckets.delete(a.id);
    if (a.replaced || a.refused || !a.role) return;
    a.replaced = true;
    if (a.role === 'host') { for (const j of this.sockets('join')) safeClose(j, CLOSE.hostLeft); return; }
    const host = this.sockets('host')[0];
    if (host) host.send(control({ op: 'left', id: a.id }));
  }
}

// ---------------------------------------------------------------- HTTP front (the Worker's fetch)
function startRelay({ port = 0, host = '127.0.0.1', allowedOrigins = DEFAULT_ORIGINS } = {}) {
  const rooms = new Map();
  const stats = { upgrades: 0, refused: 0, messages: 0 };
  const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(body); };
  // the same checks, in the same order, as relay/src/index.js; returns [status, body] or {code, role, cid}
  const check = req => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health' || url.pathname === '/') return [200, url.pathname === '/' ? 'cnd2-relay ok' : 'ok'];
    const m = /^\/room\/([^/]+)$/.exec(url.pathname);
    if (!m) return [404, 'not found'];
    if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return [426, 'expected a WebSocket upgrade'];
    if (!originAllowed(req.headers.origin, allowedOrigins)) return [403, 'origin not allowed'];
    let code = '';
    try { code = decodeURIComponent(m[1]).toUpperCase(); } catch (e) { return [400, 'bad room code']; }
    if (!CODE_RE.test(code)) return [400, 'bad room code'];
    const role = url.searchParams.get('role'), cid = url.searchParams.get('cid') || '';
    if (role !== 'host' && role !== 'join') return [400, 'role must be host or join'];
    if (!CID_RE.test(cid)) return [400, 'bad client id'];
    return { code, role, cid };
  };
  const server = http.createServer((req, res) => { const r = check(req); if (Array.isArray(r)) reply(res, r[0], r[1]); else reply(res, 426, 'expected a WebSocket upgrade'); });
  server.on('upgrade', (req, socket) => {
    const r = check(req);
    if (Array.isArray(r)) { socket.end(`HTTP/1.1 ${r[0]} ${http.STATUS_CODES[r[0]]}\r\ncontent-type: text/plain\r\ncontent-length: ${Buffer.byteLength(r[1])}\r\nconnection: close\r\n\r\n${r[1]}`); return; }
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n'); return; }
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    stats.upgrades++;
    let room = rooms.get(r.code);
    if (!room) { room = new Room(); rooms.set(r.code, room); }
    const ws = new Sock(socket, (w, m) => { stats.messages++; room.message(w, m); }, w => { room.gone(w); if (!room.socks.size) rooms.delete(r.code); });
    room.connect(ws, r.role, r.cid);
    if (ws.attachment.refused) stats.refused++;
  });
  const conns = new Set();
  server.on('connection', s => { conns.add(s); s.on('close', () => conns.delete(s)); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const p = server.address().port;
      resolve({ kind: 'node', url: `ws://${host}:${p}`, http: `http://${host}:${p}`, port: p, rooms, stats,
        close: () => new Promise(res => { for (const s of conns) s.destroy(); server.close(() => res()); }) });
    });
  });
}

module.exports = { startRelay, originAllowed, CLOSE };
if (require.main === module) startRelay({ port: +(process.argv[2] || 8788) }).then(r => console.log('relay-node listening on ' + r.url));
