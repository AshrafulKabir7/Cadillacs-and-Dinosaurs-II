// A scripted stand-in for net.js (window.EDEN_NET, work/mp/MULTIPLAYER.md §5.1) for tests/lobby.cjs. It implements the
// API the lobby uses — code helpers, errors, loadPeerJS, transports, defaultTransport, host(), join(), status(), on/off —
// with in-page fake sessions the test drives through window.NET_STUB (no network at all).
(function () {
  'use strict';
  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const calls = [];
  const rec = (name, ...args) => { calls.push([name, ...args.map(a => (a && typeof a === 'object' && !Array.isArray(a) ? Object.assign({}, a, { adapter: undefined, transport: a.transport && (a.transport.kind || a.transport) }) : a))]); };

  function emitter(o) {
    const L = {};
    o.on = (ev, fn) => { (L[ev] = L[ev] || []).push(fn); };
    o.off = (ev, fn) => { L[ev] = (L[ev] || []).filter(f => f !== fn); };
    o.emit = (ev, ...a) => { for (const f of (L[ev] || []).slice()) f(...a); };
    o.listeners = ev => (L[ev] || []).length;
    return o;
  }
  const code = {
    ALPHABET,
    make() { const a = new Uint8Array(4); crypto.getRandomValues(a); return 'DINO-' + Array.from(a, b => ALPHABET[b % 31]).join(''); },
    normalize(text) {
      let t = String(text || '').trim();
      const m = /[?&#]join=([^&#\s]+)/i.exec(t); if (m) t = decodeURIComponent(m[1]);
      let s = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (s.startsWith('DINO')) s = s.slice(4);
      if (s.length !== 4 || [...s].some(c => !ALPHABET.includes(c))) return null;
      return 'DINO-' + s;
    },
    peerId: c => 'cnd2-' + String(c).toLowerCase(),
    fromUrl(href = location.href) { const m = /[?&]join=([^&#]+)/i.exec(href); return m ? code.normalize(decodeURIComponent(m[1])) : null; },
    shareUrl(c, loc = location) { return /^https?:$/.test(loc.protocol) ? loc.origin + loc.pathname + '?join=' + c : null; },
  };
  const errors = {
    'webrtc-unsupported': { title: 'THIS BROWSER CAN’T PLAY ONLINE', text: 'Online co-op needs WebRTC. Try a current Chrome, Edge, Firefox or Safari.', retry: false },
    'peerjs-load': { title: 'ONLINE PLAY COULDN’T START', text: 'The online part of the game couldn’t be downloaded. Check your internet connection (or an ad/script blocker) and try again.', retry: true },
    'broker': { title: 'CAN’T REACH THE MATCHMAKING SERVER', text: 'The free server that introduces players to each other isn’t answering. Wait a minute and try again.', retry: true },
    'bad-code': { title: 'NO GAME WITH THAT CODE', text: 'Check the code with your friend. Codes look like DINO-4KQ7 and use the digits 2–9 and letters other than I, L and O. The host must keep the game open on the room screen or in play.', retry: true },
    'full': { title: 'THIS GAME IS FULL', text: 'Three players are already in. Ask the host to start a new room, or wait for a slot.', retry: true },
    'version': { title: 'DIFFERENT VERSIONS', text: 'Your copy of the game is different from the host’s. Both of you: reload the page, then try again.', retry: false },
    'build': { title: 'DIFFERENT VERSIONS', text: 'Your copy of the game is different from the host’s. Both of you: reload the page, then try again.', retry: false },
    'hero-taken': { title: '', text: 'Another player took that hero — pick another.', retry: false },
    'ice-failed': { title: 'CAN’T CONNECT TO THE HOST', text: 'Your network (or the host’s) blocks direct player-to-player connections — common on school, office, hotel and some mobile networks. This game has no relay server of its own. Try another network, such as a phone hotspot, or let another player host.', retry: true },
    'timeout': { title: 'LOST THE CONNECTION', text: 'The host stopped answering.', retry: true },
    'host-left': { title: 'THE HOST LEFT THE GAME', text: 'The game ended because the host closed it.', retry: false },
    'kicked': { title: 'REMOVED FROM THE GAME', text: 'The host removed you from this room.', retry: false },
  };

  // Behaviour the test sets before clicking: { load: 'ok'|errCode, host: 'ok'|errCode, join: {CODE: 'ok'|errCode}, delay ms,
  // joinSlot, joinPhase, joinRoster, transport: 'peerjs'|'loopback' }
  const cfg = { load: 'ok', host: 'ok', join: {}, delay: 30, joinSlot: 1, joinPhase: 'lobby', joinRoster: null, joinLobby: null, transport: 'peerjs', hostCode: 'DINO-4KQ7' };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const fail = c => Promise.reject(Object.assign(new Error(c), { code: c }));

  function hostSession(o) {
    const s = emitter({ role: 'host', code: cfg.hostCode, phase: 'lobby', lobby: Object.assign({ phase: 'lobby' }, o.lobby),
      roster: [{ slot: 0, name: o.name || '', hero: o.hero, ready: true, host: true, ping: 0, state: 'lobby' }] });
    s.setLobby = p => { rec('host.setLobby', p); Object.assign(s.lobby, p); if ('hero' in p) s.roster[0].hero = p.hero; };
    s.chooseHero = hh => { rec('host.chooseHero', hh); s.roster[0].hero = hh; s.emit('roster', s.roster); };
    s.start = () => { rec('host.start'); s.phase = 'play'; return { chapter: s.lobby.chapter, section: 0, difficulty: s.lobby.difficulty, roster: s.roster.map(e => ({ slot: e.slot, hero: e.hero, name: e.name })) }; };
    s.kick = slot => { rec('host.kick', slot); s.roster = s.roster.filter(e => e.slot !== slot); s.emit('roster', s.roster); };
    s.end = r => { rec('host.end', r); s.phase = 'ended'; };
    // Like net.js HostSession.toRoom: everyone back to the room, the room stays open, adapter.stopGame, a 'lobby' event.
    s.toRoom = r => { rec('host.toRoom', r); if (s.phase !== 'play') return; s.phase = 'lobby'; if (o.adapter && o.adapter.stopGame) o.adapter.stopGame(r); s.emit('lobby', { t: 'lobby', phase: 'lobby', roster: s.roster, reason: r }); s.emit('roster', s.roster); };
    s.tick = () => {};
    // test helpers
    s._add = e => { s.roster = s.roster.filter(x => x.slot !== e.slot).concat([Object.assign({ name: '', hero: -1, ready: false, host: false, ping: 40, state: 'lobby' }, e)]).sort((a, b) => a.slot - b.slot); s.emit('join', e); s.emit('roster', s.roster); };
    s._set = (slot, patch) => { s.roster = s.roster.map(e => e.slot === slot ? Object.assign({}, e, patch) : e); s.emit('roster', s.roster); };
    s._remove = slot => { s.roster = s.roster.filter(e => e.slot !== slot); s.emit('leave', { slot }); s.emit('roster', s.roster); };
    return s;
  }
  function clientSession(codeText, o) {
    const slot = cfg.joinSlot;
    const roster = cfg.joinRoster || [{ slot: 0, name: 'ALIF', hero: 1, ready: true, host: true, ping: 0, state: cfg.joinPhase === 'play' ? 'playing' : 'lobby' },
      { slot, name: o.name || '', hero: o.hero, ready: false, host: false, ping: 41, state: cfg.joinPhase === 'play' ? 'lobby' : 'lobby' }];
    const s = emitter({ role: 'client', code: codeText, slot, phase: cfg.joinPhase, roster,
      lobby: Object.assign({ phase: cfg.joinPhase, chapter: 2, difficulty: 'normal', unlocked: 3 }, cfg.joinLobby || {}) });
    s.chooseHero = hh => { rec('client.chooseHero', hh); };
    s.ready = on => { rec('client.ready', on); };
    s.joinIn = hh => { rec('client.joinIn', hh); };
    s.leave = r => { rec('client.leave', r); };
    s.sendInput = () => {};
    s.view = () => null;
    s.dueEvents = () => [];
    return s;
  }

  const net = emitter({
    PROTOCOL: 1, MAX_PLAYERS: 3, PEERJS_URL: 'stub', PEERJS_FALLBACK_URL: 'stub',
    code, errors,
    loadPeerJS(o) { rec('loadPeerJS', o); return wait(cfg.delay).then(() => (cfg.load === 'ok' ? undefined : fail(cfg.load))); },
    transports: { peerjs: o => ({ kind: 'peerjs', o }), loopback: o => ({ kind: 'loopback', o }), rtcLocal: o => ({ kind: 'rtc-local', o }) },
    defaultTransport: () => cfg.transport,
    session: null,
    host(o) {
      rec('host', o);
      return wait(cfg.delay).then(() => {
        if (cfg.host !== 'ok') return fail(cfg.host);
        net.session = hostSession(o); NET_STUB.sessions.push(net.session); return net.session;
      });
    },
    join(c, o) {
      rec('join', c, o);
      return wait(cfg.delay).then(() => {
        const r = cfg.join[c] || 'ok';
        if (r !== 'ok') return fail(r);
        net.session = clientSession(c, o); NET_STUB.sessions.push(net.session); return net.session;
      });
    },
    status() { const s = net.session; return s ? { role: s.role, code: s.code, slot: s.role === 'host' ? 0 : s.slot, phase: s.phase, roster: s.roster } : { role: null }; },
  });
  window.EDEN_NET = net;
  window.NET_STUB = { cfg, calls, sessions: [], get last() { return this.sessions[this.sessions.length - 1]; }, names: () => calls.map(c => c[0]) };
})();
