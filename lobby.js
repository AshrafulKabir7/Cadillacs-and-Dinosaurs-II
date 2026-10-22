/* lobby.js — PLAY WITH FRIENDS: the online co-op lobby (work/mp/MULTIPLAYER.md §2, §5.2).
 *
 * window.EDEN_LOBBY draws the Host / Join / code entry / room / error screens as a DOM overlay inside a container the
 * caller passes (default: .game-shell), in the game's own panel style (it reuses .panel, .menu-buttons, .primary and
 * .secondary from style.css and adds its own rules from lobby.css, linked on first open). It talks to the network only
 * through window.EDEN_NET's documented API (§5.1) and to the game only through the adapter (§5.3):
 *   adapter.heroes, adapter.selectOrder, adapter.chapters(), adapter.difficulties(),
 *   adapter.startGame(cfg) (host, after START), adapter.enterReplica(cfg) (joiner, on start), adapter.exitReplica(reason),
 *   adapter.stopGame(reason) (host leaving mid-game).
 * It never reads game globals, makes no network request until HOST or JOIN is chosen, and renders every string that came
 * over the network with textContent.
 *
 * API (§5.2):
 *   open({ adapter, net, mode:'menu'|'host'|'join', code, container, onExit, onStart, transport, notices })
 *   close({ leave })                hide the overlay (leave:true also leaves / ends the live session)
 *   autoJoinFromUrl({ adapter, net, container, onExit, onStart }) -> boolean     (?join=CODE; strips it from the URL)
 *   showBanner(kind, data), hideBanner()       'waiting-host','host-paused','unstable','gameover-wait','clear-wait','drop-in'
 *   notice(text, slot)              a short in-game line ("2P MUSTAPHA JOINED"); join/leave notices are automatic
 *   confirmLeave() -> Promise<boolean>         in-game Esc dialog (joiner: leave; host: end the game for everyone)
 *   status() -> { open, screen, code, slot, role, roster, error, phase, inGame }
 *   SCREENS
 */
(function () {
  'use strict';
  if (window.EDEN_LOBBY) return;

  const SCRIPT = document.currentScript;
  const CSS_HREF = (() => { try { return new URL('lobby.css', (SCRIPT && SCRIPT.src) || location.href).href; } catch (e) { return 'lobby.css'; } })();
  const SCREENS = ['mp-menu', 'mp-connecting', 'mp-join-screen', 'mp-room', 'mp-error-screen', 'mp-leave-confirm'];
  const TAGS = ['1P', '2P', '3P'];
  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const KEY_NAME = 'cnd2-mp-name', KEY_HERO = 'cnd2-mp-hero', KEY_CID = 'cnd2-mp-cid';
  const PRIVACY = 'Online play connects your browser directly to your friends’ browsers (they can see your IP address, as in any peer-to-peer game). The free PeerJS server only introduces you.';
  const PRIVACY_RELAY = ' When a network blocks direct connections, the game’s own relay server passes the game data between you instead (nothing is stored).';

  // The words of MULTIPLAYER.md §1.14. EDEN_NET.errors wins when it has the code; these cover a missing net.js and the
  // lobby-only codes (host-quit, unknown).
  const FALLBACK_ERRORS = {
    'webrtc-unsupported': { title: 'THIS BROWSER CAN’T PLAY ONLINE', text: 'Online co-op needs WebRTC. Try a current Chrome, Edge, Firefox or Safari.', retry: false },
    'peerjs-load': { title: 'ONLINE PLAY COULDN’T START', text: 'The online part of the game couldn’t be downloaded. Check your internet connection (or an ad/script blocker) and try again.', retry: true },
    'broker': { title: 'CAN’T REACH THE MATCHMAKING SERVER', text: 'The free server that introduces players to each other isn’t answering. Wait a minute and try again.', retry: true },
    'bad-code': { title: 'NO GAME WITH THAT CODE', text: 'Check the code with your friend. Codes look like DINO-4KQ7 and use the digits 2–9 and letters other than I, L and O. The host must keep the game open on the room screen or in play.', retry: true },
    'full': { title: 'THIS GAME IS FULL', text: 'Three players are already in. Ask the host to start a new room, or wait for a slot.', retry: true },
    'version': { title: 'DIFFERENT VERSIONS', text: 'Your copy of the game is different from the host’s. Both of you: reload the page, then try again.', retry: false },
    'build': { title: 'DIFFERENT VERSIONS', text: 'Your copy of the game is different from the host’s. Both of you: reload the page, then try again.', retry: false },
    'hero-taken': { title: 'HERO TAKEN', text: 'Another player took that hero — pick another.', retry: false },
    'ice-failed': { title: 'CAN’T CONNECT TO THE HOST', text: 'Your network (or the host’s) blocks direct player-to-player connections — common on school, office, hotel and some mobile networks — and the game’s relay server couldn’t connect you either. Check that the host still has the room open, then try again, or try another network, such as a phone hotspot.', retry: true },
    'relay-down': { title: 'CAN’T REACH THE RELAY SERVER', text: 'The game’s relay server isn’t answering. Check your internet connection, wait a minute and try again.', retry: true },
    'timeout': { title: 'LOST THE CONNECTION', text: 'The host stopped answering.', retry: true },
    'host-left': { title: 'THE HOST LEFT THE GAME', text: 'The game ended because the host closed it.', retry: false },
    'host-quit': { title: 'THE HOST ENDED THE GAME', text: 'The host closed the room. Ask for a new code to play again.', retry: false },
    'kicked': { title: 'REMOVED FROM THE GAME', text: 'The host removed you from this room.', retry: false },
    'unknown': { title: 'ONLINE PLAY STOPPED', text: 'Something went wrong with the connection. Try again.', retry: true },
  };
  // Transport / PeerJS error names that mean one of the codes above.
  const CODE_ALIASES = { 'peer-unavailable': 'bad-code', 'unavailable-id': 'broker', 'network': 'broker', 'server-error': 'broker',
    'socket-error': 'broker', 'socket-closed': 'broker', 'disconnected': 'broker', 'browser-incompatible': 'webrtc-unsupported',
    'closed': 'host-left', 'room-full': 'full', 'webrtc': 'webrtc-unsupported', 'load': 'peerjs-load' };
  const BANNERS = {
    'waiting-host': 'WAITING FOR HOST…', 'host-paused': '1P PAUSED THE GAME', 'unstable': 'CONNECTION UNSTABLE',
    'gameover-wait': 'GAME OVER · WAITING FOR 1P', 'clear-wait': 'CHAPTER CLEAR · WAITING FOR 1P',
    'drop-in': 'YOU’LL DROP IN AT THE NEXT BREAK IN THE FIGHTING',
  };
  const HELD_HERO = 'That hero is held for a player who lost the connection (for up to 30 seconds). Pick another.';
  const DEFAULT_HEROES = [{ id: 'mustapha', name: 'MUSTAPHA', color: '#d5ec69' }, { id: 'jack', name: 'JACK TENREC', color: '#7dc4de' },
    { id: 'hannah', name: 'HANNAH DUNDEE', color: '#efaa77' }, { id: 'mess', name: 'MESS O’BRADOVICH', color: '#b5cc85' }];
  const DEFAULT_DIFFICULTIES = [{ key: 'easy', label: 'EASY' }, { key: 'normal', label: 'NORMAL' }, { key: 'hard', label: 'ARCADE MANIA' }];

  const S = {
    root: null, layer: null, banner: null, notices: null, container: null,
    adapter: null, net: null, opts: {}, open: false, screen: null,
    session: null, role: null, code: null, slot: null, roster: [], phase: null,
    lobby: { chapter: 0, difficulty: 'normal', unlocked: 1 }, hostPrefs: { chapter: 0, difficulty: 'normal' }, error: null, lastAction: null, op: 0,
    ready: false, readyHold: 0, pendingHero: null, heroHold: 0, dropIn: false, dropInHero: null, dropInUntil: 0, inGame: false, endedGame: false,
    brokerDown: false, room: null, unsub: [], leaveResolve: null, stepTimer: 0, padTimer: 0, padPrev: {},
  };

  // ------------------------------------------------------------------ small helpers
  const store = {
    get(k, area = 'localStorage') { try { return window[area].getItem(k); } catch (e) { return null; } },
    set(k, v, area = 'localStorage') { try { window[area].setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const nowMs = () => (window.performance && performance.now ? performance.now() : Date.now());
  const cleanName = t => String(t || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trimStart().slice(0, 12);
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);

  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k === 'on') for (const e of Object.keys(v)) n.addEventListener(e, v[e]);
      else if (k === 'disabled' || k === 'hidden') n[k] = !!v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  }
  const $ = sel => (S.root ? S.root.querySelector(sel) : null);
  const btn = (id, label, cls, onClick, extra) => h('button', Object.assign({ id, type: 'button', class: cls, on: { click: onClick } }, extra || {}), label);

  function heroes() { const a = S.adapter && S.adapter.heroes; return Array.isArray(a) && a.length ? a : DEFAULT_HEROES; }
  function selectOrder() { const o = S.adapter && S.adapter.selectOrder; return Array.isArray(o) && o.length ? o : [1, 2, 0, 3].filter(i => i < heroes().length); }
  function heroName(i) { const H = heroes()[i]; return H ? String(H.name || H.id || 'HERO ' + (i + 1)).toUpperCase() : '—'; }
  const shortHero = i => heroName(i).split(/\s+/)[0];
  function chapters() {
    let c = null; try { c = S.adapter && S.adapter.chapters && S.adapter.chapters(); } catch (e) { c = null; }
    return Array.isArray(c) && c.length ? c.map((x, i) => ({ index: num(x.index, i), name: String(x.name || 'CHAPTER ' + (i + 1)), unlocked: x.unlocked !== false })) : [{ index: 0, name: 'CHAPTER 1', unlocked: true }];
  }
  function difficulties() {
    let d = null; try { d = S.adapter && S.adapter.difficulties && S.adapter.difficulties(); } catch (e) { d = null; }
    return Array.isArray(d) && d.length ? d.map(x => ({ key: String(x.key), label: String(x.label || x.key).toUpperCase() })) : DEFAULT_DIFFICULTIES;
  }
  const chapterLabel = i => { const c = chapters().find(x => x.index === i); return `CHAPTER ${String(i + 1).padStart(2, '0')}${c ? ' · ' + c.name.toUpperCase() : ''}`; };
  const difficultyLabel = k => { const d = difficulties().find(x => x.key === k); return d ? d.label : String(k || 'NORMAL').toUpperCase(); };

  function callAdapter(name, ...args) {
    const f = S.adapter && S.adapter[name];
    if (typeof f !== 'function') return undefined;
    try { return f.apply(S.adapter, args); } catch (e) { console.error('[lobby] adapter.' + name + ' failed', e); return undefined; }
  }
  function callback(name, ...args) { const f = S.opts[name]; if (typeof f === 'function') { try { f(...args); } catch (e) { console.error('[lobby] ' + name + ' failed', e); } } }

  // ------------------------------------------------------------------ room codes (EDEN_NET.code first, the spec's rules as a fallback)
  function ownNormalize(text) {
    let t = String(text || '').trim();
    const m = /[?&#]join=([^&#\s]+)/i.exec(t); if (m) { try { t = decodeURIComponent(m[1]); } catch (e) { t = m[1]; } }
    let s = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.startsWith('DINO')) s = s.slice(4);
    if (s.length !== 4 || [...s].some(c => !ALPHABET.includes(c))) return null;
    return 'DINO-' + s;
  }
  function normalize(text) {
    const c = S.net && S.net.code;
    if (c && typeof c.normalize === 'function') { try { return c.normalize(text) || null; } catch (e) { return null; } }
    return ownNormalize(text);
  }
  // What the code field shows while typing: the code so far, and why it cannot be a code (excluded symbols, too long).
  function parseCode(text) {
    const code = normalize(text);
    let t = String(text || '').trim();
    const m = /[?&#]join=([^&#\s]+)/i.exec(t); if (m) { try { t = decodeURIComponent(m[1]); } catch (e) { t = m[1]; } }
    let s = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code) return { code, typed: code.slice(5), msg: null };
    if (!m && /:\/\/|^www\.|\.(app|com|net|org)\b/i.test(t)) return { code: null, typed: '', msg: 'That link has no game code in it. Ask the host for the code or the share link.' };
    if (/^D?I?N?$/.test(s) && 'DINO'.startsWith(s)) return { code: null, typed: '', msg: null };
    if (s.startsWith('DINO')) s = s.slice(4);
    if (/[01ILO]/.test(s)) return { code: null, typed: s.replace(/[^2-9A-Z]/g, '').slice(0, 4), msg: 'Codes use the digits 2–9 and letters other than I, L and O.' };
    if (s.length > 4) return { code: null, typed: s.slice(0, 4), msg: 'A game code has 4 characters after DINO-, like DINO-4KQ7.' };
    return { code: null, typed: s, msg: null };
  }
  function shareUrl(code) {
    const c = S.net && S.net.code;
    if (c && typeof c.shareUrl === 'function') { try { return c.shareUrl(code) || null; } catch (e) { return null; } }
    if (!/^https?:$/.test(location.protocol)) return null;
    return location.origin + location.pathname + '?join=' + code;
  }
  function codeFromUrl() {
    const c = S.net && S.net.code;
    if (c && typeof c.fromUrl === 'function') { try { return c.fromUrl(location.href) || null; } catch (e) { /* fall through */ } }
    const m = /[?&]join=([^&#]+)/i.exec(location.search || '');
    return m ? ownNormalize(decodeURIComponent(m[1])) : null;
  }
  function clientId() {
    let cid = store.get(KEY_CID, 'sessionStorage');
    if (!cid || !/^[a-z0-9]{12}$/.test(cid)) {
      const a = new Uint8Array(12), abc = 'abcdefghijkmnpqrstuvwxyz23456789';
      try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < 12; i++) a[i] = Math.floor(Math.random() * 256); }
      cid = Array.from(a, b => abc[b % abc.length]).join('');
      store.set(KEY_CID, cid, 'sessionStorage');
    }
    return cid;
  }

  // ------------------------------------------------------------------ errors
  function codeOf(e) {
    if (!e) return 'unknown';
    let c = typeof e === 'string' ? e : ((e.error && e.error.code) || e.code || e.reason || e.type || '');
    if (!c && e.message && /webrtc|RTCPeerConnection/i.test(e.message)) c = 'webrtc-unsupported';
    c = String(c || 'unknown');
    return CODE_ALIASES[c] || c;
  }
  function errInfo(code) {
    const t = S.net && S.net.errors;
    const e = (t && t[code]) || FALLBACK_ERRORS[code] || FALLBACK_ERRORS.unknown;
    return { title: String(e.title || FALLBACK_ERRORS.unknown.title), text: String(e.text || ''), retry: !!e.retry };
  }

  // ------------------------------------------------------------------ DOM scaffolding
  function ensureCss() {
    if (S.opts.css === false) return;
    if (document.getElementById('mp-lobby-style') || document.querySelector('link[href$="lobby.css"]')) return;
    document.head.appendChild(h('link', { id: 'mp-lobby-style', rel: 'stylesheet', href: CSS_HREF }));
  }
  function ensureDom(container) {
    let c = typeof container === 'string' ? document.querySelector(container) : container;
    c = c || (S.container && S.container.isConnected ? S.container : null) || document.querySelector('.game-shell') || document.body;
    ensureCss();
    if (S.root && S.root.isConnected && S.container === c) return;
    if (S.root) { S.root.remove(); S.layer.remove(); }
    S.container = c;
    S.banner = h('div', { id: 'mp-status-banner', class: 'mp-banner', role: 'status', hidden: true });
    S.notices = h('div', { id: 'mp-notices', class: 'mp-notices', 'aria-live': 'polite' });
    S.layer = h('div', { id: 'mp-layer', class: 'mp-layer' }, S.banner, S.notices);
    S.root = h('div', { id: 'mp-lobby', class: 'mp-lobby', role: 'dialog', 'aria-modal': 'true', 'aria-live': 'polite', 'aria-label': 'Play with friends', hidden: true });
    S.root.addEventListener('keydown', onRootKey);
    c.appendChild(S.layer);
    c.appendChild(S.root);
  }
  function show(id, node) {
    ensureDom();
    clearTimeout(S.stepTimer);
    S.root.replaceChildren(node);
    S.root.dataset.screen = id;
    S.root.hidden = false;
    S.screen = id; S.open = true;
    if (id !== 'mp-room') S.room = null;
    document.documentElement.classList.add('mp-lobby-open');
    startPad();
    const f = node.querySelector('[data-mp-focus]:not([disabled]):not([hidden])') || focusables()[0];
    if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
  }
  function hideRoot() {
    if (!S.root) return;
    S.root.hidden = true; S.root.replaceChildren(); S.screen = null; S.open = false; S.room = null;
    document.documentElement.classList.remove('mp-lobby-open');
    stopPad();
  }
  const panel = (id, cls, ...kids) => h('section', { id, class: 'panel mp-panel ' + (cls || ''), 'data-mp-screen': id }, ...kids);
  const eyebrow = t => h('p', { class: 'eyebrow mp-eyebrow', text: t });
  const title = t => h('h2', { class: 'mp-title', text: t });

  // ------------------------------------------------------------------ keyboard, gamepad
  function focusables() {
    if (!S.root) return [];
    return [...S.root.querySelectorAll('button, input, select, [tabindex="0"]')].filter(n => !n.disabled && !n.hidden && n.offsetParent !== null && !n.closest('[hidden]'));
  }
  function moveFocus(d) {
    const f = focusables(); if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    const n = f[(i < 0 ? (d > 0 ? 0 : f.length - 1) : (i + d + f.length) % f.length)];
    try { n.focus({ preventScroll: false }); } catch (e) { n.focus(); }
  }
  function escAction() {
    if (S.screen === 'mp-room' && S.session) { confirmLeave(); return; } // Esc / pad B on the room asks before leaving
    const b = S.root && S.root.querySelector('[data-mp-esc]'); if (b && !b.disabled && !b.hidden) b.click();
  }
  function onRootKey(e) {
    if (!S.root || S.root.hidden) return;
    e.stopPropagation(); // the game's window keydown handler must not see keys meant for the lobby
    const t = e.target, tag = t && t.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA';
    if (e.key === 'Escape') { e.preventDefault(); escAction(); return; }
    if (tag === 'SELECT' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (!typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
      e.preventDefault(); moveFocus(e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1);
    }
  }
  // Keys pressed while the lobby is up but focus is elsewhere (the canvas, the page): keep them from the game.
  window.addEventListener('keydown', e => {
    if (!S.root || S.root.hidden || S.root.contains(e.target)) return;
    e.stopPropagation();
    if (['Tab', 'Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'Escape') escAction(); else moveFocus(e.key === 'ArrowUp' || e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1);
    }
  }, true);
  // Gamepad as keys while the lobby is open: d-pad / left stick move the focus, A (0) presses, B (1) backs out.
  function startPad() { if (!S.padTimer && navigator.getGamepads) S.padTimer = setInterval(pollPad, 50); }
  function stopPad() { clearInterval(S.padTimer); S.padTimer = 0; S.padPrev = {}; }
  function pollPad() {
    if (!S.root || S.root.hidden) return stopPad();
    let pads = []; try { pads = [...navigator.getGamepads()].filter(Boolean); } catch (e) { return; }
    const now = {};
    for (const p of pads) {
      const b = i => p.buttons[i] && p.buttons[i].pressed, ax = i => p.axes[i] || 0;
      if (b(12) || ax(1) < -0.6 || b(14) || ax(0) < -0.6) now.prev = 1;
      if (b(13) || ax(1) > 0.6 || b(15) || ax(0) > 0.6) now.next = 1;
      if (b(0)) now.ok = 1;
      if (b(1)) now.back = 1;
    }
    const edge = k => now[k] && !S.padPrev[k];
    if (edge('prev')) moveFocus(-1);
    if (edge('next')) moveFocus(1);
    if (edge('ok') && document.activeElement && S.root.contains(document.activeElement)) document.activeElement.click();
    if (edge('back')) escAction();
    S.padPrev = now;
  }

  // ------------------------------------------------------------------ portraits
  function portrait(hero, cls) {
    const H = heroes()[hero];
    const box = h('span', { class: 'mp-face' + (cls ? ' ' + cls : ''), 'data-hero': hero, 'aria-hidden': 'true' });
    box.style.setProperty('--hero', (H && H.color) || '#d5ec69');
    let p = H && H.portrait;
    if (typeof p === 'function') { try { p = p(); } catch (e) { p = null; } }
    if (p && p.tagName === 'CANVAS') {
      const c = document.createElement('canvas'); c.width = p.width; c.height = p.height;
      try { c.getContext('2d').drawImage(p, 0, 0); } catch (e) { /* tainted or empty */ }
      box.appendChild(c);
    } else if (p && p.tagName === 'IMG') box.appendChild(h('img', { src: p.src, alt: '' }));
    else if (typeof p === 'string') box.appendChild(h('img', { src: p, alt: '' }));
    else box.appendChild(h('span', { class: 'mp-face-initial', text: heroName(hero).charAt(0) }));
    return box;
  }

  // ------------------------------------------------------------------ screens: menu, join, connecting, error
  function nameField() {
    const input = h('input', { id: 'mp-name', class: 'mp-input mp-name', type: 'text', maxlength: '24', autocomplete: 'nickname', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'OPTIONAL', 'aria-label': 'Your name (optional)' });
    input.value = cleanName(store.get(KEY_NAME));
    input.addEventListener('input', () => { const v = cleanName(input.value); if (v !== input.value) input.value = v; store.set(KEY_NAME, v.trim()); });
    return h('label', { class: 'mp-field' }, h('span', { class: 'mp-label', text: 'YOUR NAME' }), input);
  }
  const myName = () => cleanName(store.get(KEY_NAME)).trim();

  function renderMenu() {
    S.error = null;
    show('mp-menu', panel('mp-menu', 'mp-small',
      eyebrow('PLAY WITH FRIENDS · UP TO 3 PLAYERS'),
      title('ONLINE CO-OP'),
      h('div', { class: 'mp-cabinet', 'aria-hidden': 'true' },
        TAGS.map((t, i) => h('span', { class: 'mp-cab-slot', 'data-slot': i }, h('b', { text: t }), h('i', { text: i ? 'JOIN-IN' : 'YOU' })))),
      nameField(),
      h('div', { class: 'menu-buttons mp-buttons' },
        btn('mp-host', 'HOST A GAME', 'primary', () => startHost(), { 'data-mp-focus': true }),
        btn('mp-join', 'JOIN A GAME', 'secondary', () => renderJoin('')),
        btn('mp-back', '← BACK', 'secondary', () => exitLobby('back'), { 'data-mp-esc': true })),
      h('p', { class: 'mp-tip', text: 'Each player picks a different hero. Your friends need your game code.' }),
      h('p', { class: 'mp-fine', text: PRIVACY + (relayOn() ? PRIVACY_RELAY : '') })));
  }

  function renderJoin(code, err) {
    const input = h('input', { id: 'mp-code-input', class: 'mp-input mp-code-input', type: 'text', inputmode: 'text', autocapitalize: 'characters', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', maxlength: '200', placeholder: 'DINO-____', 'aria-label': 'Game code', 'aria-describedby': 'mp-code-preview mp-error', 'data-mp-focus': true });
    const preview = h('div', { id: 'mp-code-preview', class: 'mp-code-preview', 'aria-live': 'polite' });
    const error = h('p', { id: 'mp-error', class: 'mp-error', role: 'alert' });
    const go = btn('mp-join-go', 'JOIN →', 'primary', () => { const p = parseCode(input.value); if (p.code) startJoin(p.code); }, { disabled: true });
    const update = () => {
      const p = parseCode(input.value);
      preview.replaceChildren(h('span', { class: 'mp-pre', text: 'DINO-' }), h('span', { class: 'mp-typed', text: p.typed }), h('span', { class: 'mp-blank', text: '____'.slice(p.typed.length) }));
      preview.dataset.valid = p.code ? 'yes' : 'no';
      error.textContent = p.msg || (err && input.value === code ? err : '');
      go.disabled = !p.code;
    };
    input.addEventListener('input', update);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); go.click(); } });
    input.value = code || '';
    show('mp-join-screen', panel('mp-join-screen', 'mp-small',
      eyebrow('PLAY WITH FRIENDS · JOIN A GAME'),
      title('ENTER THE GAME CODE'),
      h('label', { class: 'mp-field' }, h('span', { class: 'mp-label', text: 'GAME CODE OR LINK' }), input),
      preview,
      nameField(),
      error,
      h('div', { class: 'menu-buttons mp-buttons' }, go, btn('mp-back', '← BACK', 'secondary', () => renderMenu(), { 'data-mp-esc': true })),
      h('p', { class: 'mp-tip', text: 'Ask the host for the code on their room screen. Pasting the whole link works too.' })));
    update();
  }

  function renderConnecting(step) {
    show('mp-connecting', panel('mp-connecting', 'mp-small',
      eyebrow('PLAY WITH FRIENDS'),
      title('CONNECTING…'),
      h('p', { id: 'mp-step', class: 'mp-step', role: 'status', text: step }),
      h('div', { class: 'mp-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('div', { class: 'menu-buttons mp-buttons' }, btn('mp-cancel', 'CANCEL', 'secondary', cancelConnect, { 'data-mp-esc': true, 'data-mp-focus': true }))));
  }
  function setStep(t) { const n = $('#mp-step'); if (n) n.textContent = t; }

  function showError(code, detail) {
    S.error = code;
    const info = errInfo(code);
    const extra = detail && typeof detail === 'string' && detail !== info.text ? detail : '';
    const retry = info.retry && S.lastAction;
    show('mp-error-screen', panel('mp-error-screen', 'mp-small mp-error-panel',
      eyebrow('PLAY WITH FRIENDS'),
      title(info.title),
      h('p', { class: 'mp-error-text', id: 'mp-error-text', text: info.text }),
      extra ? h('p', { class: 'mp-fine', text: extra }) : null,
      h('div', { class: 'menu-buttons mp-buttons' },
        retry ? btn('mp-retry', 'TRY AGAIN', 'primary', retryLast, { 'data-mp-focus': true }) : null,
        btn('mp-back', '← BACK', 'secondary', () => { if (S.endedGame) { S.endedGame = false; exitLobby(code); } else renderMenu(); }, { 'data-mp-esc': true, 'data-mp-focus': !retry }))));
    callback('onError', code);
  }
  function retryLast() {
    const a = S.lastAction; if (!a) return renderMenu();
    if (a.kind === 'host') startHost(); else startJoin(a.code);
  }

  // ------------------------------------------------------------------ connecting
  async function makeTransport() {
    const net = S.net, o = S.opts.transport;
    if (o && typeof o === 'object') return o;
    const kind = typeof o === 'string' ? o : (net && typeof net.defaultTransport === 'function' ? net.defaultTransport() : 'peerjs');
    if (kind === 'peerjs') {
      if (typeof window.RTCPeerConnection !== 'function') throw { code: 'webrtc-unsupported' };
      if (typeof net.loadPeerJS === 'function') await net.loadPeerJS({ timeout: 10000 });
    }
    return kind;
  }
  // net.js reports 'loading' / 'broker' / 'host' / 'hello' while it connects (EDEN_NET 'progress').
  // 'direct' / 'relay': the auto transport tries a direct WebRTC link first, then falls back to the game's relay server.
  const STEP_TEXT = { loading: 'LOADING ONLINE PLAY', broker: 'REACHING THE MATCHMAKING SERVER', host: 'CONNECTING TO THE HOST', hello: 'CONNECTING TO THE HOST',
    direct: 'CONNECTING DIRECTLY…', relay: 'USING RELAY…' };
  function relayOn() { try { return !!(S.net && typeof S.net.relayUrl === 'function' && S.net.relayUrl()); } catch (e) { return false; } }
  function watchProgress(op, role) {
    const net = S.net;
    if (!net || typeof net.on !== 'function') return () => {};
    const fn = step => {
      if (op !== S.op || S.screen !== 'mp-connecting' || !STEP_TEXT[step]) return;
      if (step === 'direct' || step === 'relay') { clearTimeout(S.stepTimer); S.pathStep = step; }
      // once the path is known, the generic "connecting" steps keep saying which one (hello: USING RELAY… stays)
      if ((step === 'host' || step === 'hello') && S.pathStep) return;
      setStep(role === 'host' && step === 'broker' ? 'OPENING YOUR ROOM' : STEP_TEXT[step]);
    };
    S.pathStep = null;
    try { net.on('progress', fn); } catch (e) { return () => {}; }
    return () => { try { if (typeof net.off === 'function') net.off('progress', fn); } catch (e) { /* gone */ } };
  }
  function lobbyDefaults() {
    const ch = chapters().filter(c => c.unlocked), dif = difficulties();
    const want = S.opts.chapter != null ? +S.opts.chapter : S.hostPrefs.chapter;
    const chapter = ch.some(c => c.index === want) ? want : (ch[0] ? ch[0].index : 0);
    const dk = S.opts.difficulty || S.hostPrefs.difficulty;
    const difficulty = dif.some(d => d.key === dk) ? dk : (dif.find(d => d.key === 'normal') || dif[0]).key;
    return { chapter, difficulty, unlocked: Math.max(1, ch.length) };
  }
  function preferredHero() {
    const n = heroes().length;
    const o = S.opts.hero != null ? +S.opts.hero : NaN;
    if (o >= 0 && o < n) return o;
    const s = parseInt(store.get(KEY_HERO), 10);
    return s >= 0 && s < n ? s : selectOrder()[0];
  }

  async function startHost() {
    if (!S.net) { S.lastAction = { kind: 'host' }; return showError('peerjs-load'); }
    S.lastAction = { kind: 'host' };
    const op = ++S.op;
    renderConnecting('LOADING ONLINE PLAY');
    const unwatch = watchProgress(op, 'host');
    try {
      const transport = await makeTransport();
      if (op !== S.op) return;
      setStep('OPENING YOUR ROOM');
      S.lobby = lobbyDefaults();
      const hero = preferredHero();
      const sess = await S.net.host({ adapter: S.adapter, transport, name: myName(), hero, lobby: Object.assign({}, S.lobby) });
      if (op !== S.op) { try { sess && sess.end && sess.end('host-left'); } catch (e) { /* cancelled */ } return; }
      attach(sess, 'host', { hero });
      showRoom();
    } catch (e) {
      if (op === S.op && codeOf(e) !== 'cancelled') showError(codeOf(e), e && e.detail);
    } finally { unwatch(); }
  }

  async function startJoin(code) {
    S.lastAction = { kind: 'join', code };
    if (!S.net) return showError('peerjs-load');
    const op = ++S.op;
    renderConnecting('LOADING ONLINE PLAY');
    const unwatch = watchProgress(op, 'client');
    try {
      const transport = await makeTransport();
      if (op !== S.op) return;
      setStep('REACHING THE MATCHMAKING SERVER');
      S.stepTimer = setTimeout(() => { if (op === S.op && !S.pathStep) setStep('CONNECTING TO THE HOST ' + code); }, 1200);
      const hero = preferredHero();
      const sess = await S.net.join(code, { adapter: S.adapter, transport, name: myName(), hero, cid: clientId() });
      if (op !== S.op) { try { sess && sess.leave && sess.leave('cancel'); } catch (e) { /* cancelled */ } return; }
      attach(sess, 'client', { code });
      showRoom();
    } catch (e) {
      if (op === S.op && codeOf(e) !== 'cancelled') showError(codeOf(e), e && e.detail);
    } finally { unwatch(); }
  }
  function cancelConnect() { S.op++; try { if (S.net && typeof S.net.cancel === 'function') S.net.cancel(); } catch (e) { /* nothing pending */ } renderMenu(); }

  // ------------------------------------------------------------------ the live session
  function on(target, ev, fn) {
    if (!target || typeof target.on !== 'function') return;
    try { target.on(ev, fn); } catch (e) { return; }
    S.unsub.push(() => { try { if (typeof target.off === 'function') target.off(ev, fn); } catch (e) { /* gone */ } });
  }
  function attach(sess, role, info) {
    detach();
    S.session = sess; S.role = role; S.inGame = false; S.endedGame = false; S.dropIn = false; S.brokerDown = false; S.error = null;
    const st = safeStatus();
    S.code = sess.code || st.code || (info && info.code) || null;
    S.slot = role === 'host' ? 0 : num(sess.slot != null ? sess.slot : st.slot, 1);
    const lob = sess.lobby || {};
    S.phase = sess.phase || lob.phase || st.phase || 'lobby';
    if (role === 'client') S.lobby = { chapter: num(lob.chapter, S.lobby.chapter), difficulty: lob.difficulty || S.lobby.difficulty, unlocked: num(lob.unlocked, 1) };
    S.roster = sanitizeRoster(sess.roster || st.roster || []);
    if (!S.roster.length && role === 'host') S.roster = [{ slot: 0, name: myName(), hero: info.hero, ready: true, host: true, ping: 0, state: 'lobby' }];
    const me = S.roster.find(e => e.slot === S.slot);
    S.ready = role === 'host' ? true : !!(me && me.ready);
    S.pendingHero = null;
    if (role === 'host') {
      on(sess, 'roster', r => setRoster(r));
      for (const ev of ['join', 'leave', 'ready']) on(sess, ev, () => setRoster(sess.roster));
      on(sess, 'lobby', m => onLobby(m));
      on(sess, 'phase', p => onLobby({ phase: typeof p === 'string' ? p : p && p.phase }));
      on(sess, 'error', e => onHostError(e));
      on(sess, 'end', m => handleEnd(m));
    } else {
      on(sess, 'lobby', m => onLobby(m));
      on(sess, 'roster', r => setRoster(r));
      on(sess, 'reject', m => onReject(m));
      on(sess, 'start', m => beginClient(m));
      on(sess, 'pause', m => onPause(m));
      on(sess, 'end', m => handleEnd(m));
      on(sess, 'error', e => handleEnd(e));
    }
    on(S.net, 'status', s => onNetStatus(s));
    on(sess, 'status', s => onNetStatus(s));
  }
  function detach() {
    for (const f of S.unsub.splice(0)) f();
    S.session = null; S.role = null; S.ready = false; S.pendingHero = null; S.dropIn = false; S.dropInHero = null;
    S.code = null; S.slot = null; S.roster = [];
  }
  function safeStatus() { try { return (S.net && typeof S.net.status === 'function' && S.net.status()) || {}; } catch (e) { return {}; } }

  function sanitizeRoster(r) {
    if (!Array.isArray(r)) return [];
    const out = [];
    for (const e of r) {
      if (!e || typeof e !== 'object') continue;
      const slot = num(e.slot, -1), hero = num(e.hero, -1);
      if (!(slot >= 0 && slot < 3) || out.some(x => x.slot === slot)) continue;
      out.push({ slot, hero: hero >= 0 && hero < heroes().length ? hero : -1, name: cleanName(e.name).trim(), ready: !!e.ready || !!e.host, host: !!e.host || slot === 0,
        ping: typeof e.ping === 'number' ? Math.max(0, Math.round(e.ping)) : (e.ping === '!' ? '!' : null), state: typeof e.state === 'string' ? e.state : 'lobby' });
    }
    return out.sort((a, b) => a.slot - b.slot);
  }
  function setRoster(r) {
    if (!S.session) return;
    const next = sanitizeRoster(r);
    diffRoster(S.roster, next);
    S.roster = next;
    const me = next.find(e => e.slot === S.slot), t = nowMs();
    if (me) {
      if (S.role === 'client' && t > S.readyHold) S.ready = !!me.ready;
      if (S.pendingHero != null && (me.hero === S.pendingHero || t > S.heroHold)) S.pendingHero = null;
      // Drop-in (§2.3 flow 4). net.js marks every late joiner 'waiting' at once, before JOIN IN; only 'waiting' AND ready
      // means the host will admit us. JOIN IN with a hero the host hasn't confirmed yet waits for that confirmation
      // before it sends ready, so a hero rejected as taken never gets admitted under the host's fallback pick.
      if (S.dropInHero != null && inProgress()) {
        if (me.hero === S.dropInHero) { const hero = S.dropInHero; S.dropInHero = null; S.readyHold = t + 1500; sendJoinIn(hero); }
        else if (t > S.dropInUntil) { S.dropInHero = null; S.dropIn = false; }
      } else if (me.state === 'waiting' && t > S.readyHold) S.dropIn = !!me.ready;
    }
    updateRoom();
  }
  function diffRoster(prev, next) {
    if (S.opts.notices === false || !prev) return;
    for (const e of next) {
      if (e.slot === S.slot) continue;
      const p = prev.find(x => x.slot === e.slot);
      const who = `${TAGS[e.slot]} ${e.hero >= 0 ? shortHero(e.hero) : (e.name || 'PLAYER')}`;
      if (!p) notice(`${who} JOINED`, e.slot);
      else if (p.state !== 'away' && e.state === 'away') notice(`${TAGS[e.slot]} LOST THE CONNECTION…`, e.slot);
      else if (p.state === 'away' && e.state !== 'away') notice(`${TAGS[e.slot]} IS BACK`, e.slot);
    }
    for (const p of prev) if (p.slot !== S.slot && !next.some(x => x.slot === p.slot)) notice(`${TAGS[p.slot]} LEFT`, p.slot);
  }
  function onLobby(m) {
    if (!S.session || !m || typeof m !== 'object') return;
    const prevPhase = S.phase;
    if (typeof m.phase === 'string') S.phase = m.phase;
    if (S.role === 'client') {
      if (m.chapter != null) S.lobby.chapter = num(m.chapter, S.lobby.chapter);
      if (typeof m.difficulty === 'string') S.lobby.difficulty = m.difficulty;
      if (m.unlocked != null) S.lobby.unlocked = num(m.unlocked, S.lobby.unlocked);
    }
    if (Array.isArray(m.roster)) setRoster(m.roster);
    if (S.phase === 'ended') return handleEnd('host-quit');
    // After a chapter clear, QUIT or the credits the host brings everyone back to the room.
    if (S.phase === 'lobby' && prevPhase !== 'lobby' && S.inGame) {
      S.inGame = false; S.dropIn = false; hideBanner();
      if (S.role === 'client') { S.ready = false; callAdapter('exitReplica', 'room'); }
      showRoom();
      return;
    }
    updateRoom();
  }
  function onReject(m) {
    const reason = codeOf(m);
    if (reason === 'hero-taken') {
      S.pendingHero = null;
      if (S.dropInHero != null) { S.dropInHero = null; S.dropIn = false; }
      const e = $('#mp-error'); if (e) e.textContent = errInfo('hero-taken').text;
      updateRoom();
      return;
    }
    handleEnd(reason, m && m.detail);
  }
  function onPause(m) {
    const onState = m && typeof m === 'object' ? !!m.on : !!m;
    if (onState) showBanner('host-paused', m); else if (S.banner && S.banner.dataset.kind === 'host-paused') hideBanner();
  }
  function onHostError(e) {
    const c = codeOf(e);
    if (c === 'broker' && S.session) { S.brokerDown = true; updateRoom(); return; }
    if (e && e.fatal === false) return;
    if (['broker', 'peerjs-load', 'webrtc-unsupported'].includes(c) && S.session && !(e && e.fatal)) return;
    handleEnd(c);
  }
  function onNetStatus(s) {
    if (!s || typeof s !== 'object') return;
    if (s.role && S.role && s.role !== S.role) return;
    // Host: the broker connection (new players can't join while it is down). net.js: brokerUp; spec wording: brokerDown.
    if (S.role === 'host' && ('brokerUp' in s || 'brokerDown' in s)) { const down = 'brokerUp' in s ? s.brokerUp === false : !!s.brokerDown; if (down !== S.brokerDown) { S.brokerDown = down; updateRoom(); } }
    // Joiner in play: no snapshot for 3 s -> WAITING FOR HOST… (net.js: warn; spec wording: waitingHost).
    if (S.role === 'client' && S.inGame && ('warn' in s || 'waitingHost' in s)) {
      const w = 'warn' in s ? !!s.warn : !!s.waitingHost;
      if (w) showBanner('waiting-host'); else if (S.banner && S.banner.dataset.kind === 'waiting-host') hideBanner();
    }
  }
  function handleEnd(m, detail) {
    if (!S.session) return;
    const reason = codeOf(m);
    const wasInGame = S.inGame, role = S.role;
    if (reason === 'timeout' && role === 'client' && S.code) S.lastAction = { kind: 'join', code: S.code };
    S.op++;
    detach();
    hideBanner();
    if (wasInGame) {
      if (role === 'client') callAdapter('exitReplica', reason); else callAdapter('stopGame', reason);
    }
    S.inGame = false; S.endedGame = wasInGame; S.phase = 'ended';
    if (S.leaveResolve) { const r = S.leaveResolve; S.leaveResolve = null; r(false); }
    // The host's own game closed the room (session.end('host-quit'|'host-left') from the game): not an error for the host.
    if (role === 'host' && (reason === 'host-quit' || reason === 'host-left')) { S.endedGame = false; S.phase = null; S.error = null; return exitLobby(reason); }
    showError(reason, typeof detail === 'string' ? detail : (m && typeof m === 'object' && typeof m.detail === 'string' ? m.detail : ''));
  }

  // ------------------------------------------------------------------ the room
  function showRoom() {
    if (!S.session) return renderMenu();
    const r = S.room = {};
    const code = h('strong', { id: 'mp-code', class: 'mp-code', text: S.code || 'DINO-????' });
    r.code = code;
    r.copyCode = btn('mp-copy-code', 'COPY CODE', 'secondary', () => copyText(S.code, r.copyCode, 'COPY CODE'));
    r.copyLink = btn('mp-copy-link', 'COPY LINK', 'secondary', () => copyText(shareUrl(S.code), r.copyLink, 'COPY LINK'));
    r.share = btn('mp-share', 'SHARE…', 'secondary', shareCode);
    r.hint = h('p', { class: 'mp-code-hint' });
    r.progress = h('p', { id: 'mp-progress', class: 'mp-progress' });
    r.slots = [0, 1, 2].map(i => {
      const card = h('div', { class: 'mp-slot', 'data-mp-slot': i, 'data-state': 'empty' });
      card.style.setProperty('--slot', `var(--mp-p${i + 1})`);
      const kick = i ? btn(null, 'KICK', 'secondary mp-kick', () => { try { S.session && S.session.kick(i); } catch (e) { /* gone */ } }, { 'data-mp-kick': i, 'aria-label': `Remove ${TAGS[i]} from the room`, hidden: true }) : null;
      const parts = { card, face: h('div', { class: 'mp-slot-face' }), name: h('b', { class: 'mp-slot-name' }), hero: h('span', { class: 'mp-slot-hero' }), meta: h('span', { class: 'mp-slot-meta' }), ping: h('span', { class: 'mp-slot-ping' }), kick };
      card.append(h('span', { class: 'mp-slot-tag', text: TAGS[i] }), parts.face, h('div', { class: 'mp-slot-info' }, parts.name, parts.hero, h('div', { class: 'mp-slot-row' }, parts.meta, parts.ping)));
      if (kick) card.appendChild(kick);
      return parts;
    });
    r.heroes = selectOrder().map(i => {
      const b = h('button', { type: 'button', class: 'mp-hero', 'data-mp-hero': i, 'aria-pressed': 'false', 'aria-label': `Play as ${heroName(i)}` },
        portrait(i, 'mp-hero-face'), h('span', { class: 'mp-hero-name', text: shortHero(i) }), h('span', { class: 'mp-hero-tag' }));
      b.addEventListener('click', () => pickHero(i));
      return b;
    });
    r.chapter = h('select', { id: 'mp-chapter', class: 'mp-select', 'aria-label': 'Chapter' });
    r.chapter.addEventListener('change', () => setLobby({ chapter: +r.chapter.value }));
    r.difficulty = h('select', { id: 'mp-difficulty', class: 'mp-select', 'aria-label': 'Difficulty' });
    r.difficulty.addEventListener('change', () => setLobby({ difficulty: r.difficulty.value }));
    r.error = h('p', { id: 'mp-error', class: 'mp-error', role: 'alert' });
    r.status = h('p', { id: 'mp-status', class: 'mp-status', role: 'status' });
    r.ready = btn('mp-ready', 'READY', 'primary', toggleReady, { 'aria-pressed': 'false' });
    r.joinin = btn('mp-joinin', 'JOIN IN →', 'primary', joinIn);
    r.start = btn('mp-start', 'START →', 'primary', startGame);
    r.leave = btn('mp-leave', 'LEAVE', 'secondary', leaveRoom);
    r.tip = h('p', { class: 'mp-fine' });
    r.panel = panel('mp-room', 'mp-room-panel',
      h('div', { class: 'mp-room-head' },
        h('div', { class: 'mp-code-box' }, h('span', { class: 'mp-label', text: 'GAME CODE' }), code),
        h('div', { class: 'mp-code-actions' }, r.copyCode, r.copyLink, r.share)),
      r.hint, r.progress,
      h('div', { class: 'mp-slots' }, r.slots.map(s => s.card)),
      h('div', { class: 'mp-pick' }, h('span', { class: 'mp-label', text: 'CHOOSE YOUR HERO' }), h('div', { class: 'mp-heroes' }, r.heroes)),
      h('div', { class: 'mp-settings' },
        h('label', { class: 'mp-field' }, h('span', { class: 'mp-label', text: 'CHAPTER' }), r.chapter),
        h('label', { class: 'mp-field' }, h('span', { class: 'mp-label', text: 'DIFFICULTY' }), r.difficulty)),
      r.error,
      h('div', { class: 'mp-room-foot' }, r.status, h('div', { class: 'menu-buttons mp-buttons' }, r.ready, r.joinin, r.start, r.leave)),
      r.tip);
    show('mp-room', r.panel);
    S.room = r;
    updateRoom();
    const f = (S.role === 'host' ? r.start : (r.joinin.hidden ? r.heroes.find(b => !b.disabled) : r.heroes.find(b => !b.disabled))) || r.leave;
    if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
  }

  function inProgress() { return S.role === 'client' && !S.inGame && (S.phase === 'play' || S.phase === 'starting'); }
  function myEntry() { return S.roster.find(e => e.slot === S.slot) || null; }
  function myHero() { if (S.pendingHero != null) return S.pendingHero; const m = myEntry(); return m ? m.hero : -1; }

  function updateRoom() {
    const r = S.room;
    if (!r || S.screen !== 'mp-room' || !S.session) return;
    const host = S.role === 'host', prog = inProgress();
    r.panel.dataset.phase = prog ? 'play' : (S.phase || 'lobby');
    r.panel.dataset.role = host ? 'host' : 'client';
    r.code.textContent = S.code || 'DINO-????';
    const link = shareUrl(S.code);
    r.copyLink.hidden = !link;
    r.share.hidden = !(navigator.share && link);
    r.hint.textContent = host
      ? 'Send this code to one or two friends. They choose PLAY WITH FRIENDS → JOIN A GAME and type it.'
      : `YOU ARE ${TAGS[S.slot] || '2P'} IN THIS ROOM · HOST: ${(S.roster[0] && (S.roster[0].name || shortHero(S.roster[0].hero))) || '1P'}`;
    r.progress.textContent = prog ? `GAME IN PROGRESS · ${chapterLabel(S.lobby.chapter).split(' · ')[0]} · DIFFICULTY ${difficultyLabel(S.lobby.difficulty)}` : '';
    r.progress.hidden = !prog;

    // Slot cards.
    const mine = myHero();
    r.slots.forEach((s, i) => {
      const e = S.roster.find(x => x.slot === i);
      let st = 'empty';
      if (e) st = e.state === 'away' ? 'away' : e.state === 'waiting' ? 'waiting' : i === S.slot ? 'you' : 'player';
      s.card.dataset.state = st;
      const hero = e ? (i === S.slot ? mine : e.hero) : -1;
      if (s.face.dataset.hero !== String(hero)) { s.face.dataset.hero = String(hero); s.face.replaceChildren(hero >= 0 ? portrait(hero) : h('span', { class: 'mp-face-empty', text: '?' })); }
      if (!e) {
        s.name.textContent = 'OPEN';
        s.hero.textContent = '';
        s.meta.textContent = 'JOIN-IN';
        s.ping.textContent = '';
      } else {
        s.name.textContent = (e.name || (hero >= 0 ? shortHero(hero) : 'PLAYER')) + (i === S.slot ? ' (YOU)' : '');
        s.hero.textContent = hero >= 0 ? heroName(hero) : 'CHOOSING A HERO…';
        s.meta.textContent = st === 'away' ? 'AWAY' : st === 'waiting' ? 'JOINS AT NEXT BREAK' : e.host ? 'HOST · READY' : e.state === 'playing' ? 'PLAYING' : (i === S.slot ? S.ready : e.ready) ? 'READY ✓' : 'CHOOSING…';
        s.ping.textContent = e.host || i === S.slot ? '' : e.ping === '!' ? 'NO SIGNAL' : typeof e.ping === 'number' ? `${e.ping} MS` : '';
      }
      s.card.classList.toggle('is-ready', !!e && (e.host || (i === S.slot ? S.ready : e.ready)));
      if (s.kick) s.kick.hidden = !(host && e);
    });

    // Hero picker: a hero someone else has is taken; yours is pressed.
    const taken = new Map();
    for (const e of S.roster) if (e.slot !== S.slot && e.hero >= 0) taken.set(e.hero, e.slot);
    const locked = S.role === 'client' && ((!prog && S.ready) || (prog && S.dropIn));
    r.heroes.forEach(b => {
      const i = +b.dataset.mpHero, by = taken.get(i), me = i === mine;
      b.disabled = by != null || (locked && !me);
      b.setAttribute('aria-pressed', me ? 'true' : 'false');
      b.classList.toggle('is-taken', by != null);
      b.classList.toggle('is-locked', locked);
      b.querySelector('.mp-hero-tag').textContent = by != null ? TAGS[by] : me ? TAGS[S.slot] : '';
      b.style.setProperty('--slot', by != null ? `var(--mp-p${by + 1})` : `var(--mp-p${(S.slot || 0) + 1})`);
      b.setAttribute('aria-label', `Play as ${heroName(i)}${by != null ? ` (taken by ${TAGS[by]})` : me ? ' (your hero)' : ''}`);
    });

    // Chapter and difficulty: the host chooses, joiners see the host's choice.
    const chs = chapters(), dif = difficulties();
    const chOpts = host ? chs.filter(c => c.unlocked) : chs.filter(c => c.index === S.lobby.chapter);
    if (!chOpts.length) chOpts.push({ index: S.lobby.chapter, name: '' });
    const chKey = chOpts.map(c => c.index).join(',');
    if (r.chapter.dataset.key !== chKey) {
      r.chapter.dataset.key = chKey;
      r.chapter.replaceChildren(...chOpts.map(c => h('option', { value: c.index, text: chapterLabel(c.index) })));
    }
    r.chapter.value = String(S.lobby.chapter);
    if (r.difficulty.options.length !== dif.length) r.difficulty.replaceChildren(...dif.map(d => h('option', { value: d.key, text: d.label })));
    r.difficulty.value = S.lobby.difficulty;
    r.chapter.disabled = r.difficulty.disabled = !host;

    // Buttons.
    const others = S.roster.filter(e => !e.host);
    const allReady = others.every(e => e.ready || e.state === 'playing' || e.state === 'waiting');
    r.ready.hidden = host || prog;
    r.ready.textContent = S.ready ? 'READY ✓' : 'READY';
    r.ready.setAttribute('aria-pressed', S.ready ? 'true' : 'false');
    r.ready.classList.toggle('is-on', S.ready);
    r.ready.disabled = mine < 0;
    r.joinin.hidden = !prog;
    r.joinin.disabled = S.dropIn || mine < 0;
    r.joinin.textContent = S.dropIn ? 'WAITING TO DROP IN…' : 'JOIN IN →';
    r.start.hidden = !host;
    r.start.disabled = !allReady;
    r.start.textContent = others.length ? 'START →' : 'START ALONE →';
    r.leave.textContent = host ? 'CLOSE ROOM' : 'LEAVE';
    r.status.textContent = statusText(others, allReady);
    r.tip.textContent = host
      ? 'Keep this game in front while you play: browsers pause hidden tabs, and the whole game runs on your machine.'
      : 'The host runs the game. If the host closes it, the game ends for everyone.';
  }
  function statusText(others, allReady) {
    if (inProgress()) return S.dropIn ? BANNERS['drop-in'] : 'PICK A FREE HERO, THEN JOIN IN';
    const late = S.brokerDown ? ' · NEW PLAYERS CAN’T JOIN RIGHT NOW' : '';
    if (S.role === 'host') {
      if (!others.length) return 'WAITING FOR PLAYERS… SHARE THE CODE' + late;
      const nr = others.find(e => !e.ready && e.state !== 'playing');
      return (nr ? `${TAGS[nr.slot]} IS CHOOSING…` : 'ALL READY · PRESS START') + late;
    }
    if (myHero() < 0) return 'PICK A HERO';
    if (!S.ready) return 'PICK A HERO, THEN PRESS READY';
    const nr = others.find(e => e.slot !== S.slot && !e.ready);
    return nr ? `${TAGS[nr.slot]} IS CHOOSING…` : 'ALL READY · WAITING FOR 1P TO START';
  }

  function pickHero(i) {
    const s = S.session; if (!s) return;
    const e = $('#mp-error'); if (e) e.textContent = '';
    if (i === myHero()) return;
    S.pendingHero = i; S.heroHold = nowMs() + 1500;
    let ok;
    try {
      if (typeof s.chooseHero === 'function') ok = s.chooseHero(i);
      else if (typeof s.setLobby === 'function') s.setLobby({ hero: i });
    } catch (err) { ok = false; if (e) e.textContent = errInfo(codeOf(err)).text; }
    if (ok === false) {
      // net.js's HostSession.chooseHero refuses a hero held for a joiner who lost the connection (30 s reconnect hold).
      S.pendingHero = null;
      if (e && !e.textContent) e.textContent = S.role === 'host' ? HELD_HERO : errInfo('hero-taken').text;
    } else {
      store.set(KEY_HERO, String(i));
      if (S.role === 'host') { const me = myEntry(); if (me) me.hero = i; }
    }
    updateRoom();
  }
  function setLobby(patch) {
    if (S.role !== 'host' || !S.session) return;
    Object.assign(S.lobby, patch);
    for (const k of ['chapter', 'difficulty']) if (k in patch) S.hostPrefs[k] = patch[k];
    try { S.session.setLobby(Object.assign({ chapter: S.lobby.chapter, difficulty: S.lobby.difficulty }, patch)); } catch (e) { /* the session reports errors itself */ }
    updateRoom();
  }
  function toggleReady() {
    if (S.role !== 'client' || !S.session) return;
    S.ready = !S.ready; S.readyHold = nowMs() + 1500;
    try { S.session.ready(S.ready); } catch (e) { S.ready = !S.ready; }
    const me = myEntry(); if (me) me.ready = S.ready;
    updateRoom();
  }
  function joinIn() {
    if (S.role !== 'client' || !S.session || S.dropIn) return;
    const hero = myHero(), me = myEntry();
    if (hero < 0) return;
    S.dropIn = true; S.readyHold = nowMs() + 1500;
    if (!me || me.hero === hero) sendJoinIn(hero);
    else {
      // The host hasn't confirmed this pick yet: ask for the hero first, send ready once the roster shows it (setRoster).
      S.dropInHero = hero; S.dropInUntil = nowMs() + 4000;
      try { if (typeof S.session.chooseHero === 'function') S.session.chooseHero(hero); else sendJoinIn(hero); } catch (e) { S.dropIn = false; S.dropInHero = null; }
    }
    updateRoom();
  }
  function sendJoinIn(hero) {
    try {
      if (typeof S.session.joinIn === 'function') S.session.joinIn(hero);
      else { if (typeof S.session.chooseHero === 'function') S.session.chooseHero(hero); S.session.ready(true); }
    } catch (e) { S.dropIn = false; }
  }
  function leaveRoom() {
    const s = S.session, role = S.role;
    S.op++;
    detach();
    try { if (role === 'host') s.end('host-left'); else s.leave('left'); } catch (e) { /* already gone */ }
    S.phase = null;
    renderMenu();
  }

  // ------------------------------------------------------------------ starting the game
  function startGame() {
    const s = S.session;
    if (S.role !== 'host' || !s) return;
    const roster = S.roster.map(e => ({ slot: e.slot, hero: e.hero, name: e.name }));
    let cfg = { chapter: S.lobby.chapter, section: 0, difficulty: S.lobby.difficulty, roster };
    const say = t => { const n = $('#mp-error'); if (n) n.textContent = t; };
    const notReady = 'Everyone must press READY first.';
    // §5.2 has the lobby call adapter.startGame; net.js's HostSession.start() already calls it. Watch the adapter during
    // start() so the game is started exactly once whichever side does it.
    const A = S.adapter, orig = A && typeof A.startGame === 'function' ? A.startGame : null;
    let byNet = false;
    const restore = () => { if (orig) { try { A.startGame = orig; } catch (e) { /* frozen */ } } };
    if (orig) { try { A.startGame = function (c) { byNet = true; if (c && typeof c === 'object') cfg = Object.assign({}, cfg, c); return orig.apply(this, arguments); }; } catch (e) { /* frozen adapter */ } }
    let res;
    try { res = s.start(); } catch (e) { restore(); say(codeOf(e) === 'not-ready' ? notReady : errInfo(codeOf(e)).text); return; }
    const go = r => {
      restore();
      if (S.session !== s) return;
      if (r === false) { say(notReady); return; }
      if (r && typeof r === 'object' && Array.isArray(r.roster)) cfg = Object.assign({}, cfg, r);
      S.inGame = true; S.phase = 'play';
      hideRoot(); hideBanner();
      if (!byNet) callAdapter('startGame', cfg);
      callback('onStart', s, cfg);
    };
    if (res && typeof res.then === 'function') res.then(go, e => { restore(); say(errInfo(codeOf(e)).text); });
    else go(res);
  }
  function beginClient(m) {
    const s = S.session; if (!s || S.role !== 'client') return;
    m = m && typeof m === 'object' ? m : {};
    const cfg = { slot: S.slot, roster: Array.isArray(m.roster) ? m.roster : S.roster.map(e => ({ slot: e.slot, hero: e.hero, name: e.name })),
      chapter: num(m.chapter, S.lobby.chapter), section: num(m.section, 0), difficulty: typeof m.difficulty === 'string' ? m.difficulty : S.lobby.difficulty, dropIn: !!m.dropIn };
    S.lobby.chapter = cfg.chapter; S.lobby.difficulty = cfg.difficulty;
    S.inGame = true; S.dropIn = false; S.phase = 'play';
    if (S.leaveResolve) { const r = S.leaveResolve; S.leaveResolve = null; r(false); }
    hideRoot(); hideBanner();
    callAdapter('enterReplica', cfg);
    callback('onStart', s, cfg);
  }

  // ------------------------------------------------------------------ copy / share
  async function copyText(text, button, label) {
    if (!text) return;
    let ok = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
    if (!ok) {
      try {
        const ta = h('textarea', { readonly: true, class: 'mp-offscreen', 'aria-hidden': 'true' });
        ta.value = text; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      } catch (e) { ok = false; }
    }
    if (!ok && S.room) { try { const sel = getSelection(), rg = document.createRange(); rg.selectNodeContents(S.room.code); sel.removeAllRanges(); sel.addRange(rg); } catch (e) { /* nothing to select */ } }
    button.textContent = ok ? 'COPIED ✓' : 'SELECT & COPY';
    button.classList.toggle('is-done', ok);
    clearTimeout(button._mpT);
    button._mpT = setTimeout(() => { button.textContent = label; button.classList.remove('is-done'); }, 1500);
  }
  function shareCode() {
    const url = shareUrl(S.code);
    if (!navigator.share || !url) return;
    navigator.share({ title: 'Cadillacs & Dinosaurs II', text: `Play Cadillacs & Dinosaurs II with me! Code ${S.code} — ${url}`, url }).catch(() => { /* dismissed */ });
  }

  // ------------------------------------------------------------------ in-game: banners, notices, leave
  function showBanner(kind, data) {
    ensureDom();
    const text = (data && typeof data === 'object' && typeof data.text === 'string' && data.text) || BANNERS[kind] || String(kind || '');
    S.banner.textContent = text;
    S.banner.dataset.kind = kind;
    S.banner.hidden = false;
  }
  function hideBanner() { if (S.banner) { S.banner.hidden = true; S.banner.textContent = ''; delete S.banner.dataset.kind; } }
  function notice(text, slot) {
    ensureDom();
    const n = h('div', { class: 'mp-notice', text: String(text || '').slice(0, 60) });
    if (slot >= 0 && slot < 3) n.style.setProperty('--slot', `var(--mp-p${slot + 1})`);
    S.notices.appendChild(n);
    while (S.notices.children.length > 3) S.notices.firstChild.remove();
    setTimeout(() => n.classList.add('is-out'), 2600);
    setTimeout(() => n.remove(), 3000);
  }
  function confirmLeave() {
    if (!S.session) return Promise.resolve(false);
    if (S.leaveResolve) return Promise.resolve(false);
    return new Promise(resolve => {
      S.leaveResolve = resolve;
      const host = S.role === 'host', inGame = S.inGame;
      const toRoom = host && inGame && typeof S.session.toRoom === 'function';
      const done = v => { const r = S.leaveResolve; S.leaveResolve = null; if (r) r(v); };
      const head = inGame ? (host ? 'END THE GAME FOR EVERYONE?' : 'LEAVE THIS GAME?') : (host ? 'CLOSE THE ROOM?' : 'LEAVE THIS ROOM?');
      const tip = inGame
        ? (host ? (toRoom ? 'Everyone goes back to the room screen. The room stays open, so you can start again.' : 'Your friends will be sent back to the title.')
          : 'The others keep playing. You can join again with the same code.')
        : (host ? 'Your friends will be sent back to the title and this code stops working.' : 'You can join again with the same code.');
      show('mp-leave-confirm', panel('mp-leave-confirm', 'mp-small',
        eyebrow(host ? 'YOU ARE HOSTING' : `YOU ARE ${TAGS[S.slot] || '2P'}`),
        title(head),
        h('p', { class: 'mp-tip', text: tip }),
        h('div', { class: 'menu-buttons mp-buttons' },
          btn('mp-stay', 'STAY', 'primary', () => { if (S.inGame) hideRoot(); else showRoom(); done(false); }, { 'data-mp-esc': true, 'data-mp-focus': true }),
          btn('mp-leave-go', inGame ? (host ? 'END GAME' : 'LEAVE') : (host ? 'CLOSE ROOM' : 'LEAVE'), 'secondary', () => {
            if (inGame && S.inGame) leaveGame(); else if (S.session) leaveRoom(); else renderMenu();
            done(true);
          }))));
    });
  }
  function leaveGame() {
    const s = S.session, role = S.role, wasInGame = S.inGame;
    // Host: END GAME FOR EVERYONE returns everyone to the room and keeps it open (§2.2, HostSession.toRoom, which also
    // calls adapter.stopGame); its 'lobby' event brings this screen back through onLobby().
    if (role === 'host' && wasInGame && s && typeof s.toRoom === 'function') {
      try { s.toRoom('host-quit'); } catch (e) { /* the session reports errors itself */ }
      if (S.session === s && S.inGame) { S.inGame = false; S.phase = 'lobby'; hideBanner(); showRoom(); }
      return;
    }
    S.op++;
    detach();
    try { if (role === 'host') s.end('host-left'); else s.leave('quit'); } catch (e) { /* already gone */ }
    if (wasInGame) { if (role === 'client') callAdapter('exitReplica', 'left'); else callAdapter('stopGame', 'host-left'); }
    S.inGame = false; S.phase = null;
    hideBanner();
    exitLobby('left');
  }
  function exitLobby(reason) {
    hideRoot();
    callback('onExit', reason);
  }

  // ------------------------------------------------------------------ public API
  // Back to the room with a live session. During play the game keeps running (S.inGame stays true, so a later end
  // still calls exitReplica / stopGame); the host's room return goes through HostSession.toRoom.
  function returnToRoom() {
    if (S.inGame && S.phase === 'play') {
      if (S.role === 'host' && typeof S.session.toRoom === 'function') {
        const s = S.session;
        try { s.toRoom('host-quit'); } catch (e) { /* the session reports errors itself */ }
        if (S.session === s && S.inGame) { S.inGame = false; S.phase = 'lobby'; showRoom(); }
        return;
      }
      return showRoom();
    }
    S.inGame = false;
    return showRoom();
  }
  function open(opts) {
    opts = opts || {};
    // With a live session the options of the open that started it stay (transport, notices, callbacks); a fresh open
    // keeps only the callbacks, so one-off hero / chapter / difficulty / mode options never leak into a later open.
    const keep = {};
    if (S.session) Object.assign(keep, S.opts);
    else for (const k of ['onExit', 'onStart', 'onError']) if (k in S.opts) keep[k] = S.opts[k];
    S.opts = Object.assign(keep, opts);
    if (opts.adapter) S.adapter = opts.adapter;
    S.net = opts.net || S.net || window.EDEN_NET || null;
    ensureDom(opts.container);
    if (S.session) return returnToRoom();
    const mode = opts.mode || 'menu';
    if (mode === 'host') return startHost();
    if (mode === 'join') {
      const p = parseCode(opts.code || '');
      if (p.code && opts.connect !== false) return startJoin(p.code);
      return renderJoin(opts.code || '');
    }
    return renderMenu();
  }
  function close(o) {
    if (o && o.leave && S.session) {
      const s = S.session, role = S.role; S.op++; detach();
      try { if (role === 'host') s.end('host-left'); else s.leave('left'); } catch (e) { /* gone */ }
    }
    if (S.leaveResolve) { const r = S.leaveResolve; S.leaveResolve = null; r(false); }
    S.op++;
    hideRoot();
  }
  function autoJoinFromUrl(opts) {
    opts = opts || {};
    S.net = opts.net || S.net || window.EDEN_NET || null;
    const code = codeFromUrl();
    const raw = /[?&]join=([^&#]*)/i.exec(location.search || '');
    if (!raw) return false;
    let rawText = ''; try { rawText = decodeURIComponent(raw[1]).slice(0, 40); } catch (e) { rawText = raw[1].slice(0, 40); }
    try {
      const u = new URL(location.href); u.searchParams.delete('join');
      history.replaceState(history.state, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams : '') + u.hash);
    } catch (e) { /* file:// or sandboxed history */ }
    open(Object.assign({}, opts, { mode: 'join', code: code || rawText }));
    if (!code) { const e = $('#mp-error'); if (e) e.textContent = 'That link’s game code isn’t valid. ' + FALLBACK_ERRORS['bad-code'].text; }
    return true;
  }
  function status() {
    return { open: !!(S.root && !S.root.hidden), screen: S.screen, code: S.code, slot: S.slot, role: S.role,
      roster: S.roster.map(e => Object.assign({}, e)), error: S.error, phase: S.phase, inGame: S.inGame, ready: S.ready, dropIn: S.dropIn };
  }

  window.EDEN_LOBBY = { open, close, autoJoinFromUrl, showBanner, hideBanner, notice, confirmLeave, status, SCREENS,
    showRoom: () => { if (S.session) { ensureDom(); returnToRoom(); } },
    _normalize: normalize, _parseCode: parseCode };
})();
