// tests/lobby.cjs — the PLAY WITH FRIENDS lobby (lobby.js, work/mp/MULTIPLAYER.md §2, §5.2) on its own harness page
// (tests/fixtures/lobby-harness.html) with a scripted EDEN_NET stub (tests/fixtures/lobby-net-stub.js): every screen and
// id of §2.2, code entry and normalisation, host / join / room / hero uniqueness / ready / start, drop-in, notices,
// banners, the leave dialog, every error of §1.14, ?join= links, keyboard isolation from the game, phones (portrait and
// landscape, touch), file:// and untrusted names. When net.js exists, two pages also meet over its loopback transport.
//
//   node tools/serve.cjs 8766 &   then   node tests/lobby.cjs        (GAME_URL overrides the server)
'use strict';
const fs = require('node:fs'), path = require('node:path'), url = require('node:url');
const A = require('./lib/arcade.cjs');
const STEP = 'G9a';
const HARNESS = A.SITE + '/tests/fixtures/lobby-harness.html';
const C = A.checks('lobby');
const errors = [];

async function main() {
  const { chromium } = A.playwright();
  const browser = await chromium.launch({ headless: true });
  const newPage = async (opts = {}) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts.ctx || {}));
    if (opts.clipboard) { try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(A.BASE).origin }); } catch (e) { /* older engines */ } }
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push((opts.tag || 'page') + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|net::/.test(m.text())) errors.push((opts.tag || 'page') + ' console: ' + m.text()); });
    const requests = [];
    page.on('request', r => requests.push(r.url()));
    page.requests = requests;
    return page;
  };
  const go = async (page, q = '') => { await page.goto(HARNESS + q, { waitUntil: 'load' }); await page.waitForFunction(() => window.EDEN_LOBBY && window.EDEN_NET); };
  const st = page => page.evaluate(() => EDEN_LOBBY.status());
  const screen = async (page, id, t = 3000) => { await page.waitForFunction(id => EDEN_LOBBY.status().screen === id, id, { timeout: t }); return true; };
  const calls = page => page.evaluate(() => NET_STUB.calls.map(c => c[0]));
  const text = (page, sel) => page.$eval(sel, n => n.textContent);
  const visible = (page, sel) => page.$eval(sel, n => !n.hidden && !n.closest('[hidden]') && n.offsetParent !== null).catch(() => false);

  // ---------------------------------------------------------------- load
  const page = await newPage({ tag: 'main', clipboard: true });
  let up = true;
  try { await go(page); } catch (e) { up = false; C.fail(STEP, 'Harness loads', `${HARNESS}: ${e.message} (serve the repo: node tools/serve.cjs 8766)`); }
  if (!up) { await browser.close(); return A.finish(C, errors); }

  C.check(STEP, 'EDEN_LOBBY exposes the §5.2 API', await page.evaluate(() => ['open', 'close', 'autoJoinFromUrl', 'showBanner', 'hideBanner', 'confirmLeave', 'status'].every(k => typeof EDEN_LOBBY[k] === 'function')
    && JSON.stringify(EDEN_LOBBY.SCREENS) === JSON.stringify(['mp-menu', 'mp-connecting', 'mp-join-screen', 'mp-room', 'mp-error-screen', 'mp-leave-confirm'])), 'missing members');
  C.check(STEP, 'Loading the lobby makes no network request and adds no DOM', page.requests.every(u => u.startsWith(A.SITE) || u.startsWith('data:')) && !(await page.$('#mp-lobby')) && !(await page.evaluate(() => !!window.Peer)),
    page.requests.filter(u => !u.startsWith(A.SITE)).join(', '));

  // ---------------------------------------------------------------- online menu
  await page.click('#mp-open');
  await screen(page, 'mp-menu');
  const menu = await page.evaluate(() => { const r = document.querySelector('#mp-lobby'); return { inShell: r.parentElement.classList.contains('game-shell'), role: r.getAttribute('role'), live: r.getAttribute('aria-live'),
    ids: ['#mp-host', '#mp-join', '#mp-back', '#mp-name'].every(s => document.querySelector(s)), title: r.textContent.includes('PLAY WITH FRIENDS · UP TO 3 PLAYERS'), privacy: r.textContent.includes('can see your IP address'),
    css: !!document.querySelector('link#mp-lobby-style[href$="lobby.css"]'), styled: getComputedStyle(r).position, focus: document.activeElement && document.activeElement.id }; });
  C.check(STEP, 'Online menu: dialog in .game-shell with HOST / JOIN / BACK, tips and privacy line', menu.inShell && menu.role === 'dialog' && menu.live === 'polite' && menu.ids && menu.title && menu.privacy, JSON.stringify(menu));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#mp-lobby')).position === 'absolute', null, { timeout: 3000 }).catch(() => {});
  C.check(STEP, 'lobby.css is linked next to lobby.js and applies', menu.css && await page.evaluate(() => getComputedStyle(document.querySelector('#mp-lobby')).position === 'absolute' && getComputedStyle(document.querySelector('#mp-lobby')).zIndex === '7'), JSON.stringify(menu));
  C.check(STEP, 'Focus starts on HOST A GAME', menu.focus === 'mp-host', 'focus: ' + menu.focus);

  // Keys go to the lobby, not to the game's window keydown handler.
  await page.evaluate(() => { KEYS_SEEN.length = 0; });
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  const navd = await page.evaluate(() => ({ seen: KEYS_SEEN.slice(), screen: EDEN_LOBBY.status().screen }));
  C.check(STEP, 'Arrow keys move the focus, Enter presses, and the game sees no key while the lobby is open', navd.seen.length === 0 && navd.screen === 'mp-join-screen', JSON.stringify(navd));

  // ---------------------------------------------------------------- join screen and code entry
  await screen(page, 'mp-join-screen');
  const field = await page.$eval('#mp-code-input', n => ({ im: n.getAttribute('inputmode'), cap: n.getAttribute('autocapitalize'), ac: n.getAttribute('autocomplete'), max: n.getAttribute('maxlength'), ph: n.placeholder }));
  C.check(STEP, 'Code field attributes (§2.2; maxlength 200 so a pasted share link fits)', field.im === 'text' && field.cap === 'characters' && field.ac === 'off' && field.max === '200' && field.ph === 'DINO-____', JSON.stringify(field));
  const typeCode = async v => { await page.fill('#mp-code-input', v); return page.evaluate(() => ({ dis: document.querySelector('#mp-join-go').disabled, pre: document.querySelector('#mp-code-preview').textContent, valid: document.querySelector('#mp-code-preview').dataset.valid, err: document.querySelector('#mp-error').textContent })); };
  const c0 = await typeCode('');
  const c1 = await typeCode('dino 4kq7');
  const c2 = await typeCode('DINO-4KO7');
  const c3 = await typeCode('https://cadillacsanddinosaurs2.vercel.app/?join=dino-4kq7');
  const c4 = await typeCode('4k');
  const c5 = await typeCode('din');
  const c6 = await typeCode('4KQ7X');
  const c7 = await typeCode('https://cadillacsanddinosaurs2.vercel.app/');
  C.check(STEP, 'A link without ?join= says so', c7.dis && /no game code/.test(c7.err), JSON.stringify(c7));
  C.check(STEP, 'JOIN stays disabled until the code normalises', c0.dis && !c1.dis && c2.dis && !c3.dis && c4.dis && c5.dis && c6.dis, JSON.stringify({ c0, c1, c2, c3, c4 }));
  C.check(STEP, 'Live preview shows DINO-4KQ7 for "dino 4kq7", a pasted link and partial input', c1.pre === 'DINO-4KQ74KQ7'.slice(0, 9) && c1.valid === 'yes' && c3.pre === 'DINO-4KQ7' && c4.pre === 'DINO-4K__' && c5.pre === 'DINO-____' && !c5.err, JSON.stringify({ c1, c3, c4, c5 }));
  C.check(STEP, 'An excluded symbol (O) explains the alphabet before any network call', /digits 2–9 and letters other than I, L and O/.test(c2.err) && !(await calls(page)).includes('join'), JSON.stringify(c2));
  C.check(STEP, 'Too many characters explains the code length', /4 characters/.test(c6.err), JSON.stringify(c6));

  // Name: cleaned to [A-Z0-9 ] and 12 characters, remembered.
  await page.fill('#mp-name', 'mo<b>sta-fa!! the great');
  const nm = await page.evaluate(() => ({ v: document.querySelector('#mp-name').value, s: localStorage.getItem('cnd2-mp-name') }));
  C.check(STEP, 'Name field keeps A-Z, 0-9 and spaces, max 12, remembered in localStorage', nm.v === 'MOBSTAFA THE' && nm.s === 'MOBSTAFA THE', JSON.stringify(nm));

  // Escape backs out.
  await page.focus('#mp-code-input'); await page.keyboard.press('Escape');
  C.check(STEP, 'Esc on the join screen returns to the online menu', (await st(page)).screen === 'mp-menu', (await st(page)).screen);

  // ---------------------------------------------------------------- join flow (joiner, slot 1)
  await page.click('#mp-join');
  await page.fill('#mp-code-input', 'dino4kq7');
  await page.evaluate(() => { NET_STUB.cfg.delay = 400; });
  await page.click('#mp-join-go');
  await screen(page, 'mp-connecting');
  const conn = await page.evaluate(() => ({ step: document.querySelector('#mp-step').textContent, cancel: !!document.querySelector('#mp-cancel') }));
  C.check(STEP, 'Connecting screen shows the step line and CANCEL', /LOADING ONLINE PLAY|MATCHMAKING/.test(conn.step) && conn.cancel, JSON.stringify(conn));
  await screen(page, 'mp-room', 4000);
  const j = await page.evaluate(() => NET_STUB.calls.find(c => c[0] === 'join'));
  C.check(STEP, 'JOIN loads PeerJS first, then joins with the normalised code, name, hero and a client id', (await calls(page)).indexOf('loadPeerJS') < (await calls(page)).indexOf('join') && j[1] === 'DINO-4KQ7' && j[2].name === 'MOBSTAFA THE' && /^[a-z0-9]{12}$/.test(j[2].cid) && j[2].transport === 'peerjs', JSON.stringify(j));
  const room = await page.evaluate(() => {
    const q = s => document.querySelector(s), slots = [...document.querySelectorAll('[data-mp-slot]')].map(n => n.dataset.state);
    const heroes = [...document.querySelectorAll('[data-mp-hero]')].map(b => ({ h: +b.dataset.mpHero, dis: b.disabled, pressed: b.getAttribute('aria-pressed'), tag: b.querySelector('.mp-hero-tag').textContent }));
    return { code: q('#mp-code').textContent, slots, heroes, start: q('#mp-start').hidden, ready: !q('#mp-ready').hidden, chDis: q('#mp-chapter').disabled, chap: q('#mp-chapter').selectedOptions[0].textContent, dif: q('#mp-difficulty').value,
      kick: [...document.querySelectorAll('[data-mp-kick]')].some(n => !n.hidden), status: q('#mp-status').textContent, phase: q('#mp-room').dataset.phase };
  });
  C.check(STEP, 'Room (joiner): code, slots 1P player / 2P you / 3P empty', room.code === 'DINO-4KQ7' && room.slots.join() === 'player,you,empty', JSON.stringify(room));
  C.check(STEP, 'Hero picker in select order 1,2,0,3; the host’s hero is disabled and tagged 1P; mine is pressed', room.heroes.map(x => x.h).join() === '1,2,0,3' && room.heroes[0].dis && room.heroes[0].tag === '1P' && room.heroes.filter(x => x.pressed === 'true').length === 1, JSON.stringify(room.heroes));
  C.check(STEP, 'Joiner sees READY, no START, no KICK, the host’s chapter/difficulty read-only', room.start && room.ready && !room.kick && room.chDis && /CHAPTER 03/.test(room.chap) && room.dif === 'normal', JSON.stringify(room));
  // pick a hero, then ready
  await page.click('[data-mp-hero="0"]');
  const pick = await page.evaluate(() => ({ c: NET_STUB.calls.filter(c => c[0] === 'client.chooseHero').map(c => c[1]), p: document.querySelector('[data-mp-hero="0"]').getAttribute('aria-pressed'), st: localStorage.getItem('cnd2-mp-hero') }));
  C.check(STEP, 'Picking a free hero sends chooseHero and shows it pressed at once', pick.c.includes(0) && pick.p === 'true' && pick.st === '0', JSON.stringify(pick));
  await page.click('#mp-ready');
  const rdy = await page.evaluate(() => ({ c: NET_STUB.calls.filter(c => c[0] === 'client.ready').map(c => c[1]), t: document.querySelector('#mp-ready').textContent, p: document.querySelector('#mp-ready').getAttribute('aria-pressed'),
    locked: [...document.querySelectorAll('[data-mp-hero]')].filter(b => b.getAttribute('aria-pressed') !== 'true').every(b => b.disabled), status: document.querySelector('#mp-status').textContent }));
  C.check(STEP, 'READY toggles, sends ready(true) and locks the hero choice', rdy.c[0] === true && rdy.t.startsWith('READY') && rdy.p === 'true' && rdy.locked && /WAITING FOR 1P/.test(rdy.status), JSON.stringify(rdy));
  // hero race lost
  await page.evaluate(() => NET_STUB.last.emit('reject', { t: 'reject', reason: 'hero-taken' }));
  C.check(STEP, 'A lost hero race shows the inline hero-taken line and keeps the room', (await text(page, '#mp-error')) === 'Another player took that hero — pick another.' && (await st(page)).screen === 'mp-room', await text(page, '#mp-error'));
  // a third player joins and leaves -> notices
  await page.evaluate(() => { const s = NET_STUB.last; s.emit('lobby', { phase: 'lobby', chapter: 2, difficulty: 'hard', unlocked: 3, roster: s.roster.concat([{ slot: 2, name: '<img src=x onerror="window.PWN=1">', hero: 2, ready: false, host: false, ping: '!', state: 'lobby' }]) }); });
  const third = await page.evaluate(() => ({ slots: [...document.querySelectorAll('[data-mp-slot]')].map(n => n.dataset.state), notes: [...document.querySelectorAll('.mp-notice')].map(n => n.textContent), name: document.querySelector('[data-mp-slot="2"] .mp-slot-name').textContent,
    img: document.querySelectorAll('#mp-lobby img').length, pwn: !!window.PWN, ping: document.querySelector('[data-mp-slot="2"] .mp-slot-ping').textContent, dif: document.querySelector('#mp-difficulty').value, h2: document.querySelector('[data-mp-hero="2"]').disabled, status: document.querySelector('#mp-status').textContent }));
  C.check(STEP, '3P joining: slot fills, notice "3P HANNAH JOINED", the hero is taken, difficulty follows the host', third.slots.join() === 'player,you,player' && third.notes.includes('3P HANNAH JOINED') && third.h2 && third.dif === 'hard' && /3P IS CHOOSING/.test(third.status), JSON.stringify(third));
  C.check(STEP, 'A hostile name renders as plain text (cleaned, no markup, no script)', third.img === 0 && !third.pwn && third.name === 'IMG SRCX ONE' && third.ping === 'NO SIGNAL', JSON.stringify(third));
  await page.evaluate(() => { const s = NET_STUB.last; s.emit('lobby', { phase: 'lobby', roster: s.roster }); });
  C.check(STEP, '3P leaving: notice "3P LEFT" and the slot is empty again', await page.evaluate(() => [...document.querySelectorAll('.mp-notice')].some(n => n.textContent === '3P LEFT') && document.querySelector('[data-mp-slot="2"]').dataset.state === 'empty'), 'no leave notice');

  // start -> replica
  await page.evaluate(() => { LOBBY_EVENTS.length = 0; ADAPTER_CALLS.length = 0; NET_STUB.last.emit('start', { t: 'start', chapter: 2, section: 0, difficulty: 'hard', roster: [{ slot: 0, hero: 1, name: 'ALIF' }, { slot: 1, hero: 0, name: 'MOBSTAFA THE' }] }); });
  const started = await page.evaluate(() => ({ s: EDEN_LOBBY.status(), a: ADAPTER_CALLS.slice(), e: LOBBY_EVENTS.slice(), hidden: document.querySelector('#mp-lobby').hidden }));
  C.check(STEP, 'start: enterReplica(slot, roster, chapter, difficulty) then onStart, and the lobby hides', started.a[0] && started.a[0][0] === 'enterReplica' && started.a[0][1].slot === 1 && started.a[0][1].chapter === 2 && started.a[0][1].difficulty === 'hard' && started.e[0] && started.e[0][0] === 'start' && started.hidden && !started.s.open && started.s.inGame, JSON.stringify(started));
  // in-game notices and banners
  await page.evaluate(() => { const s = NET_STUB.last; s.emit('lobby', { phase: 'play', roster: s.roster.concat([{ slot: 2, name: '', hero: 3, ready: false, host: false, ping: 50, state: 'waiting' }]) }); });
  C.check(STEP, 'In game: a drop-in shows "3P MESS JOINED" over the canvas without opening the lobby', await page.evaluate(() => [...document.querySelectorAll('#mp-layer .mp-notice')].some(n => n.textContent === '3P MESS JOINED') && document.querySelector('#mp-lobby').hidden), 'no in-game notice');
  await page.evaluate(() => NET_STUB.last.emit('pause', { t: 'pause', on: true, by: 'host' }));
  const b1 = await page.evaluate(() => ({ t: document.querySelector('#mp-status-banner').textContent, h: document.querySelector('#mp-status-banner').hidden }));
  await page.evaluate(() => NET_STUB.last.emit('pause', { t: 'pause', on: false }));
  const b2 = await page.evaluate(() => document.querySelector('#mp-status-banner').hidden);
  await page.evaluate(() => EDEN_LOBBY.showBanner('clear-wait'));
  const b3 = await text(page, '#mp-status-banner');
  await page.evaluate(() => EDEN_LOBBY.hideBanner());
  C.check(STEP, 'Banners: host pause shows "1P PAUSED THE GAME" and clears on resume; showBanner kinds', b1.t === '1P PAUSED THE GAME' && !b1.h && b2 && b3 === 'CHAPTER CLEAR · WAITING FOR 1P', JSON.stringify({ b1, b2, b3 }));
  const pe = await page.evaluate(() => getComputedStyle(document.querySelector('#mp-layer')).pointerEvents);
  C.check(STEP, 'The in-game layer never takes clicks', pe === 'none', pe);
  // leave dialog: STAY then LEAVE
  let leaveP = page.evaluate(() => EDEN_LOBBY.confirmLeave());
  await screen(page, 'mp-leave-confirm');
  const lc = await page.evaluate(() => ({ t: document.querySelector('#mp-lobby h2').textContent, stay: !!document.querySelector('#mp-stay'), go: !!document.querySelector('#mp-leave-go') }));
  await page.click('#mp-stay');
  const stayed = await leaveP;
  C.check(STEP, 'Leave dialog: "LEAVE THIS GAME?" with STAY / LEAVE; STAY resolves false and returns to play', lc.t === 'LEAVE THIS GAME?' && lc.stay && lc.go && stayed === false && !(await st(page)).open && (await st(page)).inGame, JSON.stringify(lc));
  leaveP = page.evaluate(() => EDEN_LOBBY.confirmLeave());
  await screen(page, 'mp-leave-confirm');
  await page.evaluate(() => { ADAPTER_CALLS.length = 0; LOBBY_EVENTS.length = 0; });
  await page.click('#mp-leave-go');
  const left = await leaveP;
  const lv = await page.evaluate(() => ({ c: NET_STUB.calls.filter(c => c[0] === 'client.leave').length, a: ADAPTER_CALLS.map(c => c.join(':')), e: LOBBY_EVENTS.map(c => c.join(':')), s: EDEN_LOBBY.status() }));
  C.check(STEP, 'LEAVE resolves true, sends leave, exits the replica and calls onExit("left")', left === true && lv.c === 1 && lv.a.includes('exitReplica:left') && lv.e.includes('exit:left') && !lv.s.open && !lv.s.role, JSON.stringify(lv));

  // ---------------------------------------------------------------- host flow
  await page.evaluate(() => { NET_STUB.cfg.delay = 20; EDEN_LOBBY.open(lobbyOpts({ mode: 'menu' })); });
  await page.click('#mp-host');
  await screen(page, 'mp-room', 4000);
  const hs = await page.evaluate(() => { const q = s => document.querySelector(s); const h = NET_STUB.calls.find(c => c[0] === 'host');
    return { h, code: q('#mp-code').textContent, start: q('#mp-start').textContent, sdis: q('#mp-start').disabled, ready: q('#mp-ready').hidden, link: !q('#mp-copy-link').hidden, share: !q('#mp-share').hidden,
      chOpts: [...q('#mp-chapter').options].map(o => o.textContent), chDis: q('#mp-chapter').disabled, difOpts: [...q('#mp-difficulty').options].map(o => o.value), slots: [...document.querySelectorAll('[data-mp-slot]')].map(n => n.dataset.state),
      status: q('#mp-status').textContent, mine: [...document.querySelectorAll('[data-mp-hero]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => +b.dataset.mpHero) }; });
  C.check(STEP, 'HOST: loads PeerJS, hosts with lobby {chapter, difficulty, unlocked} and the last-used hero', hs.h && hs.h[1].lobby.unlocked === 3 && hs.h[1].lobby.difficulty === 'normal' && hs.h[1].lobby.chapter === 0 && hs.h[1].hero === 0 && hs.mine[0] === 0, JSON.stringify(hs.h));
  C.check(STEP, 'Room text has no stray null/undefined', await page.evaluate(() => !/(null|undefined|NaN)/.test(document.querySelector('#mp-room').textContent)), await page.evaluate(() => document.querySelector('#mp-room').textContent.slice(0, 200)));
  C.check(STEP, 'Host room: DINO code, START ALONE enabled, no READY, slots you/empty/empty', /^DINO-[2-9A-HJKMNP-Z]{4}$/.test(hs.code) && /START ALONE/.test(hs.start) && !hs.sdis && hs.ready && hs.slots.join() === 'you,empty,empty' && /WAITING FOR PLAYERS/.test(hs.status), JSON.stringify(hs));
  C.check(STEP, 'Host chooses among unlocked chapters and the three difficulties; COPY LINK shown over http; SHARE only with navigator.share', hs.chOpts.length === 3 && /CHAPTER 01/.test(hs.chOpts[0]) && !hs.chDis && hs.difOpts.join() === 'easy,normal,hard' && hs.link && hs.share === await page.evaluate(() => !!navigator.share), JSON.stringify(hs));
  // copy code / link
  await page.click('#mp-copy-code');
  await page.waitForFunction(() => document.querySelector('#mp-copy-code').textContent !== 'COPY CODE', null, { timeout: 2000 }).catch(() => {});
  const cc = await page.evaluate(async () => ({ b: document.querySelector('#mp-copy-code').textContent, clip: await navigator.clipboard.readText().catch(() => null) }));
  await page.click('#mp-copy-link');
  await page.waitForFunction(() => document.querySelector('#mp-copy-link').textContent !== 'COPY LINK', null, { timeout: 2000 }).catch(() => {});
  const cl = await page.evaluate(async () => ({ b: document.querySelector('#mp-copy-link').textContent, clip: await navigator.clipboard.readText().catch(() => null) }));
  C.check(STEP, 'COPY CODE / COPY LINK copy "DINO-4KQ7" and "<page>?join=DINO-4KQ7" and read COPIED ✓', cc.b === 'COPIED ✓' && cc.clip === 'DINO-4KQ7' && cl.b === 'COPIED ✓' && cl.clip === HARNESS + '?join=DINO-4KQ7', JSON.stringify({ cc, cl }));
  await page.waitForTimeout(1700);
  C.check(STEP, 'Copy buttons return to their label after 1.5 s', (await text(page, '#mp-copy-code')) === 'COPY CODE', await text(page, '#mp-copy-code'));
  // settings
  await page.selectOption('#mp-chapter', '2'); await page.selectOption('#mp-difficulty', 'hard');
  const sl = await page.evaluate(() => NET_STUB.calls.filter(c => c[0] === 'host.setLobby').map(c => c[1]));
  C.check(STEP, 'Changing chapter / difficulty calls setLobby', sl.some(p => p.chapter === 2) && sl.some(p => p.difficulty === 'hard'), JSON.stringify(sl));
  // a joiner arrives, not ready
  await page.evaluate(() => NET_STUB.last._add({ slot: 1, name: 'MOSTAFA', hero: 2, ready: false }));
  const j1 = await page.evaluate(() => ({ dis: document.querySelector('#mp-start').disabled, t: document.querySelector('#mp-start').textContent, st: document.querySelector('#mp-status').textContent, kick: !document.querySelector('[data-mp-kick="1"]').hidden, kick2: !document.querySelector('[data-mp-kick="2"]').hidden,
    h2: document.querySelector('[data-mp-hero="2"]').disabled, ping: document.querySelector('[data-mp-slot="1"] .mp-slot-ping').textContent, note: [...document.querySelectorAll('.mp-notice')].map(n => n.textContent) }));
  C.check(STEP, '2P joins: START disabled ("2P IS CHOOSING…"), KICK on slot 2P only, Hannah taken, ping shown, notice', j1.dis && /^START/.test(j1.t) && !/ALONE/.test(j1.t) && /2P IS CHOOSING/.test(j1.st) && j1.kick && !j1.kick2 && j1.h2 && j1.ping === '40 MS' && j1.note.includes('2P HANNAH JOINED'), JSON.stringify(j1));
  await page.click('[data-mp-hero="2"]', { force: true }).catch(() => {});
  C.check(STEP, 'A taken hero cannot be picked', !(await page.evaluate(() => NET_STUB.calls.some(c => c[0] === 'host.chooseHero' && c[1] === 2))), 'host picked a taken hero');
  await page.click('[data-mp-hero="3"]');
  C.check(STEP, 'Host changes hero through the session', await page.evaluate(() => NET_STUB.calls.some(c => c[0] === 'host.chooseHero' && c[1] === 3) && document.querySelector('[data-mp-slot="0"] .mp-face').dataset.hero === '3'), 'no host hero change');
  // A hero the session refuses (net.js: held 30 s for a joiner who lost the connection) is not shown as picked.
  await page.evaluate(() => { const s = NET_STUB.last; s.__chooseHero = s.chooseHero; s.chooseHero = hh => { NET_STUB.calls.push(['host.chooseHero.refused', hh]); return false; }; });
  await page.click('[data-mp-hero="0"]');
  const held = await page.evaluate(() => ({ p: [...document.querySelectorAll('[data-mp-hero][aria-pressed="true"]')].map(b => +b.dataset.mpHero), face: document.querySelector('[data-mp-slot="0"] .mp-face').dataset.hero, err: document.querySelector('#mp-error').textContent, store: localStorage.getItem('cnd2-mp-hero') }));
  await page.evaluate(() => { const s = NET_STUB.last; s.chooseHero = s.__chooseHero; });
  C.check(STEP, 'Host: a hero the session refuses (held for a reconnect) stays unpicked and says why', held.p.join() === '3' && held.face === '3' && /held for a player/.test(held.err) && held.store === '3', JSON.stringify(held));
  await page.evaluate(() => NET_STUB.last._set(1, { ready: true }));
  const j2 = await page.evaluate(() => ({ dis: document.querySelector('#mp-start').disabled, st: document.querySelector('#mp-status').textContent }));
  C.check(STEP, 'Everyone ready enables START ("ALL READY")', !j2.dis && /ALL READY/.test(j2.st), JSON.stringify(j2));
  // 3P, then a kick
  await page.evaluate(() => NET_STUB.last._add({ slot: 2, name: 'RAFI', hero: 1, ready: false }));
  C.check(STEP, 'Three players: every slot filled, START waits for 3P', await page.evaluate(() => [...document.querySelectorAll('[data-mp-slot]')].every(n => n.dataset.state !== 'empty') && document.querySelector('#mp-start').disabled), 'slots/start');
  await page.click('[data-mp-kick="2"]');
  C.check(STEP, 'KICK removes 3P through the session', await page.evaluate(() => NET_STUB.calls.some(c => c[0] === 'host.kick' && c[1] === 2) && document.querySelector('[data-mp-slot="2"]').dataset.state === 'empty' && !document.querySelector('#mp-start').disabled), 'kick');
  // START
  await page.evaluate(() => { ADAPTER_CALLS.length = 0; LOBBY_EVENTS.length = 0; });
  await page.click('#mp-start');
  const sg = await page.evaluate(() => ({ a: ADAPTER_CALLS.slice(), e: LOBBY_EVENTS.slice(), s: EDEN_LOBBY.status(), started: NET_STUB.calls.some(c => c[0] === 'host.start') }));
  const cfg = sg.a[0] && sg.a[0][1];
  C.check(STEP, 'START: session.start, then adapter.startGame({chapter, section, difficulty, roster}) and onStart; lobby hides', sg.started && sg.a[0][0] === 'startGame' && cfg.chapter === 2 && cfg.difficulty === 'hard' && cfg.section === 0 && cfg.roster.length === 2 && cfg.roster[0].hero === 3 && sg.e[0][0] === 'start' && !sg.s.open && sg.s.inGame, JSON.stringify(sg));
  // host: END GAME FOR EVERYONE goes back to the room through session.toRoom (the room stays open)
  const endP = page.evaluate(() => EDEN_LOBBY.confirmLeave());
  await screen(page, 'mp-leave-confirm');
  const eg = await page.evaluate(() => ({ t: document.querySelector('#mp-lobby h2').textContent, b: document.querySelector('#mp-leave-go').textContent }));
  await page.evaluate(() => { ADAPTER_CALLS.length = 0; LOBBY_EVENTS.length = 0; });
  await page.click('#mp-leave-go');
  const egr = await endP;
  const eg2 = await page.evaluate(() => ({ s: EDEN_LOBBY.status(), toRoom: NET_STUB.calls.filter(c => c[0] === 'host.toRoom').map(c => c[1]), end: NET_STUB.calls.filter(c => c[0] === 'host.end').length, stop: ADAPTER_CALLS.filter(c => c[0] === 'stopGame').length, exit: LOBBY_EVENTS.length }));
  C.check(STEP, 'Host END GAME: "END THE GAME FOR EVERYONE?" -> session.toRoom("host-quit"), back in the open room, stopGame once', eg.t === 'END THE GAME FOR EVERYONE?' && eg.b === 'END GAME' && egr === true && eg2.toRoom.join() === 'host-quit' && eg2.end === 0 && eg2.stop === 1 && eg2.exit === 0 && eg2.s.screen === 'mp-room' && !eg2.s.inGame && eg2.s.role === 'host', JSON.stringify({ eg, eg2 }));
  // host: QUIT back to the room, then the room is reopened by the game
  await page.click('#mp-start');
  await page.evaluate(() => { ADAPTER_CALLS.length = 0; NET_STUB.calls.length = 0; EDEN_LOBBY.open(lobbyOpts()); });
  const rq = await page.evaluate(() => ({ s: EDEN_LOBBY.status(), toRoom: NET_STUB.calls.filter(c => c[0] === 'host.toRoom').length, stop: ADAPTER_CALLS.filter(c => c[0] === 'stopGame').length }));
  C.check(STEP, 'open() with a live session during play returns everyone to the room through toRoom (after QUIT / the credits)', rq.s.screen === 'mp-room' && !rq.s.inGame && rq.toRoom === 1 && rq.stop === 1, JSON.stringify(rq));
  // Esc on the room asks before leaving
  await page.focus('#mp-start'); await page.keyboard.press('Escape');
  await screen(page, 'mp-leave-confirm', 2000).catch(() => {});
  const esc = await page.evaluate(() => ({ s: EDEN_LOBBY.status().screen, t: document.querySelector('#mp-lobby h2').textContent }));
  await page.keyboard.press('Escape');
  await screen(page, 'mp-room', 2000).catch(() => {});
  C.check(STEP, 'Esc on the room asks "CLOSE THE ROOM?"; Esc again (STAY) returns to the room', esc.s === 'mp-leave-confirm' && esc.t === 'CLOSE THE ROOM?' && (await st(page)).screen === 'mp-room' && (await st(page)).role === 'host', JSON.stringify(esc));
  // host leaves the room
  await page.click('#mp-leave');
  C.check(STEP, 'Host CLOSE ROOM ends the session (host-left) and shows the online menu', await page.evaluate(() => NET_STUB.calls.some(c => c[0] === 'host.end' && c[1] === 'host-left') && EDEN_LOBBY.status().screen === 'mp-menu' && !EDEN_LOBBY.status().role), 'no end');
  // The game ends the host's own session itself (session.end('host-quit')): no error screen for the host, stopGame, onExit.
  await page.evaluate(() => EDEN_LOBBY.open(lobbyOpts({ mode: 'host', hero: 1 })));
  await screen(page, 'mp-room', 3000);
  const oneOff = await page.evaluate(() => NET_STUB.calls.filter(c => c[0] === 'host').pop()[1].hero);
  await page.click('#mp-start');
  await page.evaluate(() => { ADAPTER_CALLS.length = 0; LOBBY_EVENTS.length = 0; NET_STUB.last.emit('end', { reason: 'host-quit' }); });
  const hq = await page.evaluate(() => ({ s: EDEN_LOBBY.status(), stop: ADAPTER_CALLS.filter(c => c[0] === 'stopGame').map(c => c[1]), e: LOBBY_EVENTS.map(c => c.join(':')) }));
  C.check(STEP, 'Host session ended by the game (host-quit): no error screen, stopGame, onExit("host-quit")', !hq.s.open && !hq.s.error && !hq.s.role && hq.stop.join() === 'host-quit' && hq.e.includes('exit:host-quit'), JSON.stringify(hq));
  await page.evaluate(() => EDEN_LOBBY.open(lobbyOpts({ mode: 'menu' })));
  await page.click('#mp-host');
  await screen(page, 'mp-room', 3000);
  const nextHero = await page.evaluate(() => NET_STUB.calls.filter(c => c[0] === 'host').pop()[1].hero);
  C.check(STEP, 'One-off open() options (hero) do not leak into a later open', oneOff === 1 && nextHero === 3, JSON.stringify({ oneOff, nextHero }));
  await page.click('#mp-leave');

  // cancel while connecting
  await page.evaluate(() => { NET_STUB.cfg.delay = 500; });
  await page.click('#mp-host');
  await screen(page, 'mp-connecting');
  await page.click('#mp-cancel');
  await page.waitForTimeout(1200);
  C.check(STEP, 'CANCEL while connecting returns to the menu and never leaves a session open', await page.evaluate(() => EDEN_LOBBY.status().screen === 'mp-menu' && !EDEN_LOBBY.status().role && NET_STUB.calls.filter(c => c[0] === 'host').length === NET_STUB.calls.filter(c => c[0] === 'host.end').length), JSON.stringify(await st(page)));
  await page.evaluate(() => { NET_STUB.cfg.delay = 20; });

  // ---------------------------------------------------------------- errors (§1.14), verbatim from EDEN_NET.errors
  const errorCases = [
    ['bad-code', 'join'], ['full', 'join'], ['build', 'join'], ['version', 'join'], ['ice-failed', 'join'], ['timeout', 'join'], ['broker', 'host'], ['peerjs-load', 'load'],
  ];
  const bad = [];
  for (const [code, where] of errorCases) {
    await page.evaluate(([code, where]) => { const c = NET_STUB.cfg; c.load = 'ok'; c.host = 'ok'; c.join = {}; if (where === 'load') c.load = code; else if (where === 'host') c.host = code; else c.join['DINO-4KQ7'] = code; EDEN_LOBBY.open(lobbyOpts({ mode: where === 'join' ? 'join' : 'host', code: 'DINO-4KQ7' })); }, [code, where]);
    try { await screen(page, 'mp-error-screen', 3000); } catch (e) { bad.push(code + ': no error screen'); continue; }
    const r = await page.evaluate(code => { const e = EDEN_NET.errors[code]; return { title: document.querySelector('#mp-lobby h2').textContent === e.title, text: document.querySelector('#mp-error-text').textContent === e.text, retry: !!document.querySelector('#mp-retry') === !!e.retry, back: !!document.querySelector('#mp-back'), st: EDEN_LOBBY.status().error }; }, code);
    if (!(r.title && r.text && r.retry && r.back && r.st === code)) bad.push(code + ' ' + JSON.stringify(r));
  }
  C.check(STEP, 'Every connect error shows EDEN_NET.errors[code] verbatim with TRY AGAIN when retry, and BACK', bad.length === 0, bad.join(' | '));
  // TRY AGAIN retries the same action and can succeed
  await page.evaluate(() => { NET_STUB.cfg.load = 'ok'; NET_STUB.cfg.host = 'ok'; NET_STUB.cfg.join = { 'DINO-4KQ7': 'bad-code' }; EDEN_LOBBY.open(lobbyOpts({ mode: 'join', code: 'DINO-4KQ7' })); });
  await screen(page, 'mp-error-screen');
  await page.evaluate(() => { NET_STUB.cfg.join = {}; });
  await page.click('#mp-retry');
  await screen(page, 'mp-room', 3000).catch(() => {});
  C.check(STEP, 'TRY AGAIN re-joins the same code', (await st(page)).screen === 'mp-room' && (await st(page)).code === 'DINO-4KQ7', JSON.stringify(await st(page)));
  // after joining: host leaves mid-game, kicked in the room
  await page.evaluate(() => NET_STUB.last.emit('start', { chapter: 0, difficulty: 'normal' }));
  // showRoom() during play must not forget that the replica is running (a later end still exits it)
  await page.evaluate(() => { EDEN_LOBBY.showRoom(); });
  const sr = await st(page);
  await page.evaluate(() => EDEN_LOBBY.close());
  C.check(STEP, 'showRoom() during play keeps inGame, so a later end still exits the replica', sr.screen === 'mp-room' && sr.inGame === true, JSON.stringify(sr));
  await page.evaluate(() => { ADAPTER_CALLS.length = 0; LOBBY_EVENTS.length = 0; NET_STUB.last.emit('end', { t: 'end', reason: 'host-left' }); });
  const hl = await page.evaluate(() => ({ s: EDEN_LOBBY.status(), t: document.querySelector('#mp-lobby h2').textContent, a: ADAPTER_CALLS.map(c => c.join(':')) }));
  await page.click('#mp-back');
  const hl2 = await page.evaluate(() => ({ e: LOBBY_EVENTS.map(c => c.join(':')), open: EDEN_LOBBY.status().open }));
  C.check(STEP, 'Host leaving mid-game: "THE HOST LEFT THE GAME", exitReplica, BACK → onExit("host-left")', hl.s.screen === 'mp-error-screen' && hl.t === 'THE HOST LEFT THE GAME' && hl.a.includes('exitReplica:host-left') && hl2.e.includes('exit:host-left') && !hl2.open, JSON.stringify({ hl, hl2 }));
  await page.evaluate(() => EDEN_LOBBY.open(lobbyOpts({ mode: 'join', code: 'DINO-4KQ7' })));
  await screen(page, 'mp-room', 3000);
  await page.evaluate(() => NET_STUB.last.emit('reject', { t: 'reject', reason: 'kicked' }));
  C.check(STEP, 'Kicked: "REMOVED FROM THE GAME", no TRY AGAIN, BACK → online menu', (await st(page)).screen === 'mp-error-screen' && (await text(page, '#mp-lobby h2')) === 'REMOVED FROM THE GAME' && !(await page.$('#mp-retry')) && (await page.click('#mp-back').then(() => st(page))).screen === 'mp-menu', 'kicked');
  // webrtc unsupported
  await page.evaluate(() => { window.__RTC = window.RTCPeerConnection; delete window.RTCPeerConnection; window.RTCPeerConnection = undefined; });
  await page.click('#mp-host');
  await screen(page, 'mp-error-screen', 3000).catch(() => {});
  C.check(STEP, 'No WebRTC: "THIS BROWSER CAN’T PLAY ONLINE" before PeerJS is fetched', (await st(page)).error === 'webrtc-unsupported' && !(await page.$('#mp-retry')), JSON.stringify(await st(page)));
  await page.evaluate(() => { window.RTCPeerConnection = window.__RTC; });

  // ---------------------------------------------------------------- game in progress: drop-in
  await page.evaluate(() => { NET_STUB.cfg.joinPhase = 'play'; NET_STUB.cfg.joinSlot = 2; EDEN_LOBBY.open(lobbyOpts({ mode: 'join', code: 'DINO-4KQ7' })); });
  await screen(page, 'mp-room', 3000);
  const dp = await page.evaluate(() => ({ phase: document.querySelector('#mp-room').dataset.phase, prog: document.querySelector('#mp-progress').textContent, ready: document.querySelector('#mp-ready').hidden, ji: !document.querySelector('#mp-joinin').hidden, slots: [...document.querySelectorAll('[data-mp-slot]')].map(n => n.dataset.state) }));
  C.check(STEP, 'Late joiner: data-phase="play", "GAME IN PROGRESS · CHAPTER 03 · DIFFICULTY NORMAL", JOIN IN instead of READY', dp.phase === 'play' && dp.prog === 'GAME IN PROGRESS · CHAPTER 03 · DIFFICULTY NORMAL' && dp.ready && dp.ji && dp.slots[2] === 'you', JSON.stringify(dp));
  // JOIN IN with a hero the host has not confirmed: ready waits for the roster; a hero-taken reject cancels the drop-in
  const tk = await page.evaluate(() => { NET_STUB.calls.length = 0; const b = [...document.querySelectorAll('[data-mp-hero]')].find(x => !x.disabled && x.getAttribute('aria-pressed') !== 'true'); b.click(); document.querySelector('#mp-joinin').click();
    const sent = NET_STUB.calls.map(c => c[0]); NET_STUB.last.emit('reject', { reason: 'hero-taken', detail: 'Another player took that hero — pick another.', fatal: false });
    return { sent, drop: EDEN_LOBBY.status().dropIn, dis: document.querySelector('#mp-joinin').disabled, err: document.querySelector('#mp-error').textContent, ji: document.querySelector('#mp-joinin').textContent }; });
  C.check(STEP, 'Drop-in with an unconfirmed hero sends only the hero; a hero-taken reject cancels the drop-in and says why', tk.sent.join() === 'client.chooseHero,client.chooseHero' && !tk.drop && !tk.dis && tk.ji === 'JOIN IN →' && /took that hero/.test(tk.err), JSON.stringify(tk));
  await page.click('#mp-joinin');
  const dp2 = await page.evaluate(() => ({ c: NET_STUB.calls.filter(c => c[0] === 'client.joinIn' && Number.isInteger(c[1])).length, st: document.querySelector('#mp-status').textContent, dis: document.querySelector('#mp-joinin').disabled }));
  C.check(STEP, 'JOIN IN asks the host and says "YOU’LL DROP IN AT THE NEXT BREAK IN THE FIGHTING"', dp2.c === 1 && dp2.dis && dp2.st === 'YOU’LL DROP IN AT THE NEXT BREAK IN THE FIGHTING', JSON.stringify(dp2));
  await page.evaluate(() => { ADAPTER_CALLS.length = 0; NET_STUB.last.emit('start', { t: 'start', chapter: 2, section: 1, difficulty: 'normal', dropIn: true }); });
  const dp3 = await page.evaluate(() => ADAPTER_CALLS[0]);
  C.check(STEP, 'Admission: enterReplica({dropIn:true, slot 2})', dp3 && dp3[0] === 'enterReplica' && dp3[1].dropIn === true && dp3[1].slot === 2 && dp3[1].section === 1, JSON.stringify(dp3));
  // host returns everyone to the room
  await page.evaluate(() => { ADAPTER_CALLS.length = 0; const s = NET_STUB.last; s.emit('lobby', { phase: 'lobby', roster: s.roster }); });
  C.check(STEP, 'lobby{phase:"lobby"} after a chapter brings a joiner back to the room (exitReplica "room")', (await st(page)).screen === 'mp-room' && await page.evaluate(() => ADAPTER_CALLS.some(c => c[0] === 'exitReplica' && c[1] === 'room')), JSON.stringify(await st(page)));
  await page.evaluate(() => { NET_STUB.cfg.joinPhase = 'lobby'; NET_STUB.cfg.joinSlot = 1; EDEN_LOBBY.close({ leave: true }); });

  // ---------------------------------------------------------------- ?join= link
  const lp = await newPage({ tag: 'link' });
  await go(lp, '?join=dino-4kq7&net=loopback');
  await screen(lp, 'mp-room', 4000).catch(() => {});
  const lk = await lp.evaluate(() => ({ auto: window.AUTO_JOINED, s: EDEN_LOBBY.status(), url: location.search, j: NET_STUB.calls.find(c => c[0] === 'join') }));
  C.check(STEP, 'A share link ?join= connects at once, strips join from the address bar, keeps ?net=', lk.auto === true && lk.s.screen === 'mp-room' && lk.j && lk.j[1] === 'DINO-4KQ7' && lk.url === '?net=loopback', JSON.stringify(lk));
  await lp.context().close();
  const lp2 = await newPage({ tag: 'badlink' });
  await go(lp2, '?join=DINO-0000');
  const lk2 = await lp2.evaluate(() => ({ s: EDEN_LOBBY.status(), err: document.querySelector('#mp-error') && document.querySelector('#mp-error').textContent, calls: NET_STUB.calls.length }));
  C.check(STEP, 'A broken link opens the join screen with an explanation and no network call', lk2.s.screen === 'mp-join-screen' && /isn’t valid/.test(lk2.err) && lk2.calls === 0, JSON.stringify(lk2));
  await lp2.context().close();

  // ---------------------------------------------------------------- phones (touch): portrait and landscape
  for (const [w, hgt, label] of [[390, 844, 'portrait 390x844'], [844, 390, 'landscape 844x390']]) {
    const mp = await newPage({ tag: label, ctx: { viewport: { width: w, height: hgt }, isMobile: true, hasTouch: true } });
    await go(mp, '?touch=1');
    await mp.tap('#mp-open');
    await mp.tap('#mp-host');
    await screen(mp, 'mp-room', 4000);
    await mp.evaluate(() => { NET_STUB.last._add({ slot: 1, name: 'MOSTAFA', hero: 2, ready: true }); NET_STUB.last._add({ slot: 2, name: 'RAFI', hero: 0, ready: true }); });
    await mp.waitForTimeout(200);
    const lay = await mp.evaluate(() => {
      const root = document.querySelector('#mp-lobby'), r = root.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
      const ctl = [...root.querySelectorAll('button,select,input')].filter(n => !n.hidden && n.offsetParent);
      const small = ctl.filter(n => n.getBoundingClientRect().height < 32 && !n.classList.contains('mp-kick')).map(n => n.id || n.className);
      const wide = [...root.querySelectorAll('*')].filter(n => n.getBoundingClientRect().right > vw + 1 && n.offsetParent).map(n => n.id || n.className).slice(0, 5);
      return { pos: getComputedStyle(root).position, full: r.left <= 0 && r.top <= 0 && r.right >= vw - 1 && r.bottom >= vh - 1, small, wide, scrollW: document.documentElement.scrollWidth <= vw + 1, overflow: getComputedStyle(root).overflowY, z: +getComputedStyle(root).zIndex };
    });
    C.check(STEP, `Phone ${label}: the lobby fills the screen above the touch controls, no sideways overflow`, lay.pos === 'fixed' && lay.full && lay.wide.length === 0 && lay.z >= 30 && lay.overflow === 'auto', JSON.stringify(lay));
    C.check(STEP, `Phone ${label}: every control is at least 32 px tall`, lay.small.length === 0, lay.small.join(', '));
    await mp.$eval('#mp-start', n => n.scrollIntoView());
    await mp.tap('#mp-start');
    C.check(STEP, `Phone ${label}: START is reachable by touch with three players`, await mp.evaluate(() => ADAPTER_CALLS.some(c => c[0] === 'startGame' && c[1].roster.length === 3)), 'START not tapped');
    await mp.context().close();
  }

  // ---------------------------------------------------------------- file://
  const fp = await newPage({ tag: 'file' });
  const furl = url.pathToFileURL(path.join(A.ROOT, 'tests', 'fixtures', 'lobby-harness.html')).href;
  await fp.goto(furl); await fp.waitForFunction(() => window.EDEN_LOBBY);
  await fp.click('#mp-open'); await fp.click('#mp-host');
  await screen(fp, 'mp-room', 4000);
  const fr = await fp.evaluate(() => ({ link: document.querySelector('#mp-copy-link').hidden, share: document.querySelector('#mp-share').hidden, code: document.querySelector('#mp-code').textContent, css: getComputedStyle(document.querySelector('#mp-lobby')).position }));
  C.check(STEP, 'file://: the room works, shows the code only (COPY LINK and SHARE hidden), lobby.css loads', fr.link && fr.share && fr.code === 'DINO-4KQ7' && fr.css === 'absolute', JSON.stringify(fr));
  await fp.context().close();

  // ---------------------------------------------------------------- the real net.js over its loopback transport (two pages, one context)
  const hasNet = fs.existsSync(path.join(A.ROOT, 'net.js'));
  await C.gated(STEP, 'Real net.js: host and join over ?net=loopback, hero uniqueness, START reaches both pages', hasNet, 'net.js not built yet', async () => {
    const ctx = await browser.newContext();
    const pa = await ctx.newPage(), pb = await ctx.newPage();
    for (const [p, t] of [[pa, 'net-host'], [pb, 'net-join']]) p.on('pageerror', e => errors.push(t + ': ' + e.message));
    const q = '?real=1&net=loopback';
    await pa.goto(HARNESS + q); await pb.goto(HARNESS + q);
    await pa.waitForFunction(() => window.EDEN_LOBBY && window.EDEN_NET && window.EDEN_NET.transports);
    await pa.click('#mp-open'); await pa.click('#mp-host');
    await screen(pa, 'mp-room', 8000);
    const code = await pa.$eval('#mp-code', n => n.textContent);
    await pb.waitForFunction(() => window.EDEN_LOBBY);
    await pb.click('#mp-open'); await pb.click('#mp-join');
    await pb.fill('#mp-code-input', code); await pb.click('#mp-join-go');
    await screen(pb, 'mp-room', 10000);
    await pa.waitForFunction(() => document.querySelector('[data-mp-slot="1"]').dataset.state !== 'empty', null, { timeout: 5000 });
    const hostHero = await pa.$eval('[data-mp-hero][aria-pressed="true"]', n => +n.dataset.mpHero);
    await pb.waitForFunction(h => document.querySelector(`[data-mp-hero="${h}"]`).disabled, hostHero, { timeout: 5000 });
    const free = await pb.$eval('[data-mp-hero]:not([disabled]):not([aria-pressed="true"])', n => +n.dataset.mpHero);
    await pb.click(`[data-mp-hero="${free}"]`); await pb.click('#mp-ready');
    await pa.waitForFunction(() => !document.querySelector('#mp-start').disabled, null, { timeout: 5000 });
    await pa.click('#mp-start');
    await pb.waitForFunction(() => ADAPTER_CALLS.some(c => c[0] === 'enterReplica'), null, { timeout: 5000 });
    const a = await pa.evaluate(() => ADAPTER_CALLS.filter(c => c[0] === 'startGame')), b = await pb.evaluate(() => ADAPTER_CALLS.filter(c => c[0] === 'enterReplica'));
    const ev = await pa.evaluate(() => LOBBY_EVENTS.filter(e => e[0] === 'start').length);
    await ctx.close();
    return (a.length === 1 && b.length === 1 && ev === 1 && b[0][1].slot === 1 && a[0][1].roster.length === 2 && new Set(a[0][1].roster.map(r => r.hero)).size === 2) || JSON.stringify({ a, b, ev });
  });

  await C.gated(STEP, 'Real net.js: bad code, a 4th player gets THIS GAME IS FULL, host leaving reaches joiners', hasNet, 'net.js not built yet', async () => {
    const ctx = await browser.newContext();
    const pages = [];
    for (let i = 0; i < 5; i++) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push('net' + i + ': ' + e.message)); await p.goto(HARNESS + '?real=1&net=loopback'); await p.waitForFunction(() => window.EDEN_LOBBY && window.EDEN_NET); pages.push(p); }
    const [h, j1, j2, j3, jx] = pages;
    const joinBy = async (p, code) => { await p.click('#mp-open'); await p.click('#mp-join'); await p.fill('#mp-code-input', code); await p.click('#mp-join-go'); };
    const out = {};
    await joinBy(jx, 'DINO-2222');
    await screen(jx, 'mp-error-screen', 6000).catch(() => {});
    out.bad = await jx.evaluate(() => EDEN_LOBBY.status().error);
    await h.click('#mp-open'); await h.click('#mp-host'); await screen(h, 'mp-room', 8000);
    const code = await h.$eval('#mp-code', n => n.textContent);
    for (const p of [j1, j2]) { await joinBy(p, code); await screen(p, 'mp-room', 10000); }
    await joinBy(j3, code);
    await screen(j3, 'mp-error-screen', 10000).catch(() => {});
    out.full = await j3.evaluate(() => ({ e: EDEN_LOBBY.status().error, t: document.querySelector('#mp-lobby h2') && document.querySelector('#mp-lobby h2').textContent }));
    out.heroes = await h.evaluate(() => EDEN_LOBBY.status().roster.map(e => e.hero));
    await h.click('#mp-leave');
    await screen(j1, 'mp-error-screen', 6000).catch(() => {});
    out.left = await j1.evaluate(() => ({ e: EDEN_LOBBY.status().error, t: document.querySelector('#mp-lobby h2') && document.querySelector('#mp-lobby h2').textContent }));
    await ctx.close();
    return (out.bad === 'bad-code' && out.full.e === 'full' && out.full.t === 'THIS GAME IS FULL' && out.heroes.length === 3 && new Set(out.heroes).size === 3
      && /^THE HOST (LEFT|ENDED) THE GAME$/.test(out.left.t)) || JSON.stringify(out);
  });

  await C.gated(STEP, 'Real net.js: a late joiner sees JOIN IN, picks a free hero, is admitted with it; host END GAME returns both to the room', hasNet, 'net.js not built yet', async () => {
    const ctx = await browser.newContext();
    const pa = await ctx.newPage(), pb = await ctx.newPage();
    for (const [p, t] of [[pa, 'drop-host'], [pb, 'drop-join']]) p.on('pageerror', e => errors.push(t + ': ' + e.message));
    await pa.goto(HARNESS + '?real=1&net=loopback'); await pb.goto(HARNESS + '?real=1&net=loopback');
    await pa.waitForFunction(() => window.EDEN_LOBBY && window.EDEN_NET && window.EDEN_NET.transports);
    await pb.waitForFunction(() => window.EDEN_LOBBY && window.EDEN_NET);
    await pa.evaluate(() => { HARNESS_ADAPTER.canAdmit = () => true; });
    await pa.click('#mp-open'); await pa.click('#mp-host'); await screen(pa, 'mp-room', 8000);
    const code = await pa.$eval('#mp-code', n => n.textContent);
    await pa.click('#mp-start');
    await pa.waitForFunction(() => EDEN_LOBBY.status().inGame, null, { timeout: 4000 });
    await pb.click('#mp-open'); await pb.click('#mp-join'); await pb.fill('#mp-code-input', code); await pb.click('#mp-join-go');
    await screen(pb, 'mp-room', 10000);
    await pb.waitForFunction(() => document.querySelector('#mp-room').dataset.phase === 'play' && EDEN_LOBBY.status().roster.some(e => e.slot === 1 && e.state === 'waiting'), null, { timeout: 5000 });
    await pb.waitForTimeout(1800); // past the lobby's own ready hold, several lobby broadcasts later
    const out = {};
    out.before = await pb.evaluate(() => ({ ji: document.querySelector('#mp-joinin')?.textContent, dis: document.querySelector('#mp-joinin')?.disabled, st: document.querySelector('#mp-status')?.textContent,
      drop: EDEN_LOBBY.status().dropIn, free: [...document.querySelectorAll('[data-mp-hero]')].filter(b => !b.disabled).length }));
    // pick a hero the host has not confirmed yet and press JOIN IN straight away
    out.pick = await pb.evaluate(() => { const b = [...document.querySelectorAll('[data-mp-hero]')].find(x => !x.disabled && x.getAttribute('aria-pressed') !== 'true'); b.click(); document.querySelector('#mp-joinin').click(); const j = document.querySelector('#mp-joinin'); return { hero: +b.dataset.mpHero, ji: j.textContent, dis: j.disabled }; }); // read at once: loopback admits within a few ms
    await pb.waitForFunction(() => ADAPTER_CALLS.some(c => c[0] === 'enterReplica'), null, { timeout: 8000 }).catch(() => {});
    out.enter = await pb.evaluate(() => ADAPTER_CALLS.filter(c => c[0] === 'enterReplica').map(c => c[1]));
    out.add = await pa.evaluate(() => ADAPTER_CALLS.filter(c => c[0] === 'addPlayer'));
    // END GAME FOR EVERYONE: both back in the open room
    await pa.evaluate(() => { ADAPTER_CALLS.length = 0; window.__left = EDEN_LOBBY.confirmLeave(); });
    await screen(pa, 'mp-leave-confirm', 3000);
    await pa.click('#mp-leave-go');
    await screen(pa, 'mp-room', 4000).catch(() => {});
    await pb.waitForFunction(() => EDEN_LOBBY.status().screen === 'mp-room' && !EDEN_LOBBY.status().inGame, null, { timeout: 5000 }).catch(() => {});
    out.room = { a: await pa.evaluate(() => ({ s: EDEN_LOBBY.status(), stop: ADAPTER_CALLS.filter(c => c[0] === 'stopGame').length, h2: document.querySelector('#mp-lobby h2')?.textContent, code: document.querySelector('#mp-code')?.textContent })),
      b: await pb.evaluate(() => ({ s: EDEN_LOBBY.status(), exit: ADAPTER_CALLS.filter(c => c[0] === 'exitReplica').map(c => c[1]) })) };
    await ctx.close();
    const ok = out.before.ji === 'JOIN IN →' && !out.before.dis && !out.before.drop && out.before.st === 'PICK A FREE HERO, THEN JOIN IN' && out.before.free >= 2
      && out.pick.ji === 'WAITING TO DROP IN…' && out.pick.dis
      && out.enter.length === 1 && out.enter[0].dropIn === true && out.enter[0].slot === 1
      && out.add.length === 1 && out.add[0][1] === 1 && out.add[0][2] === out.pick.hero
      && out.room.a.s.screen === 'mp-room' && out.room.a.s.role === 'host' && !out.room.a.s.inGame && out.room.a.stop === 1 && out.room.a.code === code
      && out.room.b.s.screen === 'mp-room' && out.room.b.s.role === 'client' && out.room.b.exit.includes('room');
    return ok || JSON.stringify(out);
  });

  await browser.close();
  return A.finish(C, errors);
}

main().catch(e => { console.error(e); C.fail(STEP, 'Suite ran to the end', e && e.stack || String(e)); A.finish(C, errors); });
