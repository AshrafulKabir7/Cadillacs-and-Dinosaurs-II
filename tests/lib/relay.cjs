// Relay test helpers: start the WebSocket relay for a suite and check it against the protocol of relay/src/index.js.
//
//   const R = require('./lib/relay.cjs');
//   const relay = await R.start();          // {kind:'wrangler'|'node', url:'ws://127.0.0.1:<port>', http, stop(), note}
//   const rows = await R.conformance(relay.url);   // [{name, ok, detail}]
//
// Backends: 'wrangler' runs the real Worker locally (`wrangler dev` from relay/node_modules, a local workerd with the
// Durable Object; no Cloudflare account involved), 'node' is tests/fixtures/relay-node.cjs (same protocol, no
// dependencies). RELAY_BACKEND=node|wrangler|auto picks one (auto, the default: wrangler when relay/ has it installed
// and it comes up, else node — the returned `note` says why).
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), https = require('node:https'), cp = require('node:child_process'), net = require('node:net');
const { startRelay } = require('../fixtures/relay-node.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const RELAY_DIR = path.join(ROOT, 'relay');
const WRANGLER = path.join(RELAY_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const get = (u, headers = {}, ms = 4000) => new Promise(res => {
  const req = (/^https:/.test(u) ? https : http).get(u, { headers }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res({ status: r.statusCode, body: b })); });
  req.on('upgrade', (r, sock) => { sock.destroy(); res({ status: r.statusCode, body: '' }); });
  req.on('error', e => res({ status: 0, body: e.message }));
  req.setTimeout(ms, () => { req.destroy(); res({ status: 0, body: 'timeout' }); });
});
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') { try { cp.execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* gone */ } }
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (x) { /* gone */ } } }
}

async function startWrangler({ port = null, timeout = 90000 } = {}) {
  if (!fs.existsSync(WRANGLER)) throw new Error('wrangler is not installed in relay/ (cd relay && npm install)');
  port = port || await freePort();
  const env = Object.assign({}, process.env, { WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' });
  const child = cp.spawn(process.execPath, [WRANGLER, 'dev', '--port', String(port), '--ip', '127.0.0.1', '--inspector-port', String(await freePort()), '--show-interactive-dev-session=false'],
    { cwd: RELAY_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
  let log = '';
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  process.on('exit', () => killTree(child));
  const httpUrl = `http://127.0.0.1:${port}`;
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error('wrangler dev exited: ' + log.slice(-600));
    const r = await get(httpUrl + '/health', {}, 1500);
    if (r.status === 200 && r.body === 'ok') return { kind: 'wrangler', url: `ws://127.0.0.1:${port}`, http: httpUrl, port, log: () => log, stop: async () => { killTree(child); await sleep(200); } };
    await sleep(300);
  }
  killTree(child);
  throw new Error('wrangler dev did not answer /health in ' + timeout + ' ms: ' + log.slice(-600));
}
async function startNode({ port = 0 } = {}) {
  const r = await startRelay({ port });
  return { kind: 'node', url: r.url, http: r.http, port: r.port, stats: r.stats, stop: () => r.close() };
}
async function start({ backend = process.env.RELAY_BACKEND || 'auto' } = {}) {
  if (backend === 'node') return Object.assign(await startNode(), { note: 'RELAY_BACKEND=node' });
  if (backend === 'wrangler') return Object.assign(await startWrangler(), { note: 'wrangler dev (relay/src/index.js)' });
  try { return Object.assign(await startWrangler(), { note: 'wrangler dev (relay/src/index.js)' }); }
  catch (e) { return Object.assign(await startNode(), { note: 'node fixture (wrangler dev unavailable: ' + String(e.message).slice(0, 160) + ')' }); }
}

// ---------------------------------------------------------------- protocol conformance (relay/src/index.js header)
function client(base, room, role, cid, opts = {}) {
  return new Promise(res => {
    const ws = new WebSocket(`${base}/room/${room}?role=${role}&cid=${cid}`);
    ws.binaryType = 'arraybuffer';
    const c = { ws, log: [], ctl: [], closed: null, id: null, closeOp: null };
    ws.onmessage = e => {
      const d = e.data;
      if (typeof d !== 'string') { const u = new Uint8Array(d); c.log.push({ bin: Array.from(u) }); return; }
      if (d.startsWith('@\n')) { const o = JSON.parse(d.slice(2)); c.ctl.push(o); if (o.op === 'welcome') { c.id = o.id; res(c); } if (o.op === 'close') { c.closeOp = o; res(c); } return; }
      c.log.push(d);
    };
    ws.onclose = e => { c.closed = { code: e.code, reason: e.reason }; res(c); };
    ws.onerror = () => {};
    setTimeout(() => res(c), opts.timeout || 4000);
  });
}
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(20); } return !!fn(); };
const closedWith = c => (c.closeOp ? c.closeOp.code : c.closed ? c.closed.code : null);

async function conformance(base, { room = null } = {}) {
  const httpBase = base.replace(/^ws/, 'http');
  const rows = [], row = (name, ok, detail) => rows.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  const code = room || 'DINO-' + Array.from({ length: 4 }, () => '23456789ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 31)]).join('');
  const up = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' };

  const health = await get(httpBase + '/health');
  row('GET /health -> 200 "ok"', health.status === 200 && health.body === 'ok', health);
  const plain = await get(`${httpBase}/room/${code}`);
  row('GET /room/<code> without an upgrade -> 426', plain.status === 426, plain);
  const bad = await Promise.all([
    get(`${httpBase}/room/DINO-0000?role=host&cid=abcd1234`, up), get(`${httpBase}/room/${code}?role=boss&cid=abcd1234`, up),
    get(`${httpBase}/room/${code}?role=host&cid=a`, up), get(`${httpBase}/nope`, up),
    get(`${httpBase}/room/${code}?role=join&cid=abcd1234`, Object.assign({ Origin: 'https://evil.example' }, up)),
    get(`${httpBase}/room/${code}?role=join&cid=abcd1234`, Object.assign({ Origin: 'http://localhost:5199' }, up)),
    get(`${httpBase}/room/${code}?role=join&cid=abcd1234`, Object.assign({ Origin: 'https://cadillacsanddinosaurs2.vercel.app' }, up)),
  ]);
  row('validation: bad code (0) / role / cid -> 400, unknown path -> 404, foreign Origin -> 403, allowed Origins -> 101',
    bad[0].status === 400 && bad[1].status === 400 && bad[2].status === 400 && bad[3].status === 404 && bad[4].status === 403 && bad[5].status === 101 && bad[6].status === 101, bad.map(b => b.status));

  const nohost = await client(base, code, 'join', 'early001');
  row('a joiner before any host -> close 4004 no-host', closedWith(nohost) === 4004, nohost.closeOp || nohost.closed);
  const h = await client(base, code.toLowerCase(), 'host', 'hostcid01');
  row('host -> welcome id "h" (room code case-insensitive)', h.id === 'h', h.ctl);
  const h2 = await client(base, code, 'host', 'othercid01');
  row('a second host with another cid -> close 4002 host-exists', closedWith(h2) === 4002, h2.closeOp || h2.closed);
  const j1 = await client(base, code, 'join', 'joincid01'), j2 = await client(base, code, 'join', 'joincid02');
  const j3 = await client(base, code, 'join', 'joincid03');
  await waitFor(() => h.ctl.filter(o => o.op === 'joined').length >= 2);
  const joined = h.ctl.filter(o => o.op === 'joined');
  row('two joiners get ids; the host hears joined{id,cid}; a third joiner -> close 4001 room-full',
    /^j[a-z0-9]{6}$/.test(j1.id) && j2.id && j1.id !== j2.id && joined.some(o => o.id === j1.id && o.cid === 'joincid01') && joined.some(o => o.id === j2.id) && closedWith(j3) === 4001,
    { j1: j1.id, j2: j2.id, joined, j3: j3.closeOp || j3.closed });

  j1.ws.send('whatever|ctl\n{"t":"hello","x":"a|b\\nc"}');
  h.ws.send(`${j1.id}|st\n{"t":"s","n":1}`);
  h.ws.send('*|ctl\n{"t":"lobby"}\n{"t":"lobby2"}');
  const bin = new Uint8Array([3, 104, 124, 99, 0, 255, 7]);   // [header length 3]["h|c"][payload 0 255 7]
  j2.ws.send(bin.buffer);
  j1.ws.send('ping');
  await waitFor(() => h.log.length >= 2 && j1.log.length >= 3 && j2.log.length >= 1);
  const hb = h.log.find(x => x.bin);
  row('routing: joiner -> host tagged with the joiner id (payload untouched); host -> one joiner and "*" -> all, tagged "h"',
    h.log.includes(`${j1.id}|ctl\n{"t":"hello","x":"a|b\\nc"}`) && j1.log.includes('h|st\n{"t":"s","n":1}') && j1.log.includes('h|ctl\n{"t":"lobby"}\n{"t":"lobby2"}') && j2.log.includes('h|ctl\n{"t":"lobby"}\n{"t":"lobby2"}') && !j2.log.includes('h|st\n{"t":"s","n":1}'),
    { h: h.log, j1: j1.log, j2: j2.log });
  const expectBin = [j2.id.length + 2].concat(Array.from(Buffer.from(j2.id + '|c'))).concat([0, 255, 7]);
  row('binary frames: header rewritten to the source, payload bytes untouched; "ping" -> "pong"',
    hb && JSON.stringify(hb.bin) === JSON.stringify(expectBin) && j1.log.includes('pong'), { got: hb, expectBin });

  const j1b = await client(base, code, 'join', 'joincid01');   // the same cid again (a reload): replaces the old socket
  await waitFor(() => closedWith(j1) !== null && h.ctl.some(o => o.op === 'left' && o.id === j1.id));
  row('the same joiner cid again -> the old socket closes 4005 replaced, the host hears left{old id} and joined{new id}',
    closedWith(j1) === 4005 && j1b.id && j1b.id !== j1.id && h.ctl.some(o => o.op === 'left' && o.id === j1.id) && h.ctl.some(o => o.op === 'joined' && o.id === j1b.id), { j1: j1.closeOp || j1.closed, j1b: j1b.id });

  h.ws.send('@\n' + JSON.stringify({ op: 'close', id: j1b.id }));
  await waitFor(() => closedWith(j1b) !== null && h.ctl.some(o => o.op === 'left' && o.id === j1b.id));
  row('host control close{id} -> that joiner closes 4010, the host hears left', closedWith(j1b) === 4010 && h.ctl.some(o => o.op === 'left' && o.id === j1b.id), j1b.closeOp || j1b.closed);

  const big = await client(base, code, 'join', 'bigcid01');
  big.ws.send('h|ctl\n' + 'x'.repeat(70000));
  await waitFor(() => closedWith(big) !== null);
  row('a message over 64 KB -> close 4009 too-big', closedWith(big) === 4009, big.closeOp || big.closed);

  h.ws.close(1000);
  await waitFor(() => closedWith(j2) !== null);
  row('the host leaves -> every joiner closes 4000 host-left', closedWith(j2) === 4000, j2.closeOp || j2.closed);
  const after = await client(base, code, 'join', 'late0001');
  row('after the host left the room is gone: a joiner -> 4004', closedWith(after) === 4004, after.closeOp || after.closed);
  for (const c of [h, j1, j2, j3, h2, j1b, big, after, nohost]) try { c.ws.close(); } catch (e) { /* closed */ }
  return rows;
}

module.exports = { start, startNode, startWrangler, conformance, WRANGLER, killTree, freePort };
