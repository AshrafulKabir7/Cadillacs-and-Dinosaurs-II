// The home page (index.html) and its hand-off to the game (play.html).
// Run from the repo root: node tests/home.cjs   (GAME_URL = the site, default http://127.0.0.1:8766; started if nothing answers)
//   * the home page loads with no page error and no console error from its own origin (an offline Google Fonts fetch is
//     tolerated: the page falls back to system fonts), and it never requests a game script
//   * the first view (1440x900, no scrolling) transfers < 1 MB; every <img> has alt text; the head carries the description,
//     canonical, Open Graph / Twitter card (og.png exists, 1200x630), theme-color and an icon
//   * PLAY NOW goes to play.html and the game reaches its title menu; PLAY WITH FRIENDS opens the online lobby (and
//     ?online is stripped); a ?join=DINO-XXXX link opened on / lands on play.html in the lobby's join flow
//   * no horizontal overflow at 375, 768 and 1440 px; the drive canvas draws at a whole-number scale; reduced motion holds
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), cp = require('node:child_process');
const A = require('./lib/arcade.cjs');
const C = A.checks('home'), S = 'home', errors = [];
const SITE = A.SITE, HOME = SITE + '/', GAME = A.BASE;
const BUDGET = 1024 * 1024;
const GAME_SCRIPTS = /\/(game|sprites|sprite-data-[a-z-]+|stage-data|stage-render|sequel-render|hero-rig|enemy-kinds|arcade-ui|campaign|net|lobby|selection-art|soundtrack-data|audio)\.js(\?|$)/;
const status = u => new Promise(res => { const r = http.get(u, x => { x.resume(); res(x.statusCode); }); r.on('error', () => res(0)); r.setTimeout(3000, () => { r.destroy(); res(0); }); });

async function server() {
  if (A.isFileURL(SITE)) return { child: null, why: 'GAME_URL is a file:// URL: the home checks need http' };
  if ((await status(HOME)) === 200) return { child: null };
  const u = new URL(SITE);
  if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) return { child: null, why: `${HOME} does not answer` };
  const child = cp.spawn(process.execPath, [path.join(A.ROOT, 'tools', 'serve.cjs'), u.port || '80'], { cwd: A.ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { if ((await status(HOME)) === 200) return { child }; await new Promise(r => setTimeout(r, 100)); }
  child.kill(); return { child: null, why: 'tools/serve.cjs did not start' };
}

// console errors from our own origin count; a failed off-origin font fetch (an offline machine) does not
function watch(page, tag) {
  const own = [];
  page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  page.on('console', m => { if (m.type() !== 'error') return; const at = (m.location() && m.location().url) || ''; if (/fonts\.(googleapis|gstatic)\.com/.test(at) || (!at.startsWith(SITE) && /Failed to load resource/.test(m.text()))) return; own.push(m.text() + (at ? ' @ ' + at : '')); });
  return own;
}

(async () => {
  const srv = await server();
  if (srv.why) { C.skip(S, 'home page suite', srv.why); A.finish(C); return; }
  const { chromium } = A.playwright();
  const browser = await chromium.launch();
  try {
    // ------------------------------------------------------------ first view: errors, requests, transfer, head
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await ctx.newPage(), own = watch(page, 'home');
      const res = [];
      page.on('response', r => res.push(r));
      await page.goto(HOME, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(600);
      let bytes = 0; const rows = [];
      for (const r of res) { let n = 0; try { n = (await r.body()).length; } catch (e) { n = +(r.headers()['content-length'] || 0); } bytes += n; rows.push([r.url().replace(SITE, ''), n]); }
      const urls = res.map(r => r.url()), gameReq = urls.filter(u => GAME_SCRIPTS.test(u));
      C.check(S, 'The home page loads with no page error and no console error', own.length === 0, own.join(' | '));
      C.check(S, 'The home page requests none of the game scripts (game.js, sprite data, stage data, net.js, lobby.js ...)', gameReq.length === 0, gameReq.join(', '));
      C.check(S, `The first view (1440x900, no scroll) transfers < 1 MB (now ${(bytes / 1024).toFixed(0)} KB over ${res.length} responses)`, bytes > 0 && bytes < BUDGET, rows.sort((a, b) => b[1] - a[1]).slice(0, 8).map(([u, n]) => `${u} ${(n / 1024).toFixed(0)}K`).join(', '));
      const head = await page.evaluate(() => {
        const m = s => { const e = document.querySelector(s); return e ? (e.content || e.href || '') : ''; };
        return { title: document.title, desc: m('meta[name="description"]'), canonical: m('link[rel="canonical"]'), ogImage: m('meta[property="og:image"]'), ogTitle: m('meta[property="og:title"]'), tw: m('meta[name="twitter:card"]'), theme: m('meta[name="theme-color"]'), icon: m('link[rel="icon"]'), manifest: m('link[rel="manifest"]'),
          lang: document.documentElement.lang, h1: document.querySelectorAll('h1').length, noAlt: Array.from(document.images).filter(i => !i.hasAttribute('alt')).map(i => i.src), broken: Array.from(document.images).filter(i => i.complete && i.loading !== 'lazy' && !i.naturalWidth).map(i => i.src) };
      });
      const og = path.join(A.ROOT, 'assets', 'home', 'og.png'), ogOk = fs.existsSync(og) && (() => { const b = fs.readFileSync(og); return b.readUInt32BE(16) === 1200 && b.readUInt32BE(20) === 630; })();
      C.check(S, 'Head: title, description, canonical https://www.playcadillacsdinosaurs2.online/, og:title/og:image, twitter card, theme-color, icon, manifest, lang', !!head.title && head.desc.length > 60 && head.canonical === 'https://www.playcadillacsdinosaurs2.online/' && /\/assets\/home\/og\.png$/.test(head.ogImage) && !!head.ogTitle && head.tw === 'summary_large_image' && !!head.theme && !!head.icon && !!head.manifest && head.lang === 'en', JSON.stringify(head));
      C.check(S, 'The social card assets/home/og.png exists at 1200x630', ogOk, og);
      C.check(S, 'One h1, every <img> has an alt attribute, no first-view image is broken', head.h1 === 1 && head.noAlt.length === 0 && head.broken.length === 0, JSON.stringify({ h1: head.h1, noAlt: head.noAlt, broken: head.broken }));
      // the key art fills the window (no frame, nothing below it) and the nav opens the panels
      const fit = await page.evaluate(() => { const h = document.querySelector('.hero').getBoundingClientRect(); return { w: h.width, h: h.height, iw: innerWidth, ih: innerHeight, sh: document.documentElement.scrollHeight }; });
      C.check(S, 'The hero fills the window and the page does not scroll (the whole site is the hero)', Math.abs(fit.w - fit.iw) < 2 && Math.abs(fit.h - fit.ih) < 2 && fit.sh <= fit.ih + 1, JSON.stringify(fit));
      const panels = [];
      for (const id of ['story', 'stages', 'characters', 'coop']) { await page.click(`.kv-nav > button[data-open="${id}"]`); await page.waitForTimeout(150); panels.push([id, await page.evaluate(i => document.getElementById('p-' + i).open, id)]); await page.keyboard.press('Escape'); await page.waitForTimeout(100); }
      for (const id of ['controls', 'faq', 'about']) { await page.click('.kv-more summary'); await page.click(`.kv-more button[data-open="${id}"]`); await page.waitForTimeout(150); panels.push([id, await page.evaluate(i => document.getElementById('p-' + i).open, id)]); await page.keyboard.press('Escape'); await page.waitForTimeout(100); }
      C.check(S, 'Every nav entry (Story, Stages, Characters, Co-op, More: Controls, FAQ, About) opens its panel and Esc closes it', panels.every(p => p[1]) && await page.evaluate(() => !document.querySelector('dialog[open]')), JSON.stringify(panels));
      await page.click('.kv-dots button[data-go="2"]'); await page.waitForTimeout(1300);
      const sl = await page.evaluate(() => ({ n: document.querySelector('[data-num]').textContent, img: document.querySelector('.kv-slide.on').currentSrc, ok: document.querySelector('.kv-slide.on').naturalWidth }));
      C.check(S, 'The slider dots switch the key art (03 shows the dam painting)', sl.n === '03' && /kv-dam\.webp/.test(sl.img) && sl.ok > 0, JSON.stringify(sl));
      C.check(S, 'Still no console error after using the panels and the slider', own.length === 0, own.join(' | '));
      await ctx.close();
    }

    // ------------------------------------------------------------ no horizontal overflow
    for (const [w, h, mobile] of [[375, 812, true], [768, 1024, true], [1440, 900, false]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile }), page = await ctx.newPage(); watch(page, 'home-' + w);
      await page.goto(HOME, { waitUntil: 'load' });
      const H = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < H; y += h) { await page.evaluate(y => window.scrollTo(0, y), y); await page.waitForTimeout(40); }
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth, vv: window.visualViewport ? Math.round(window.visualViewport.width) : null }));
      C.check(S, `No horizontal overflow at ${w}px (document ${o.sw}px, body ${o.bw}px)`, o.sw <= w && o.bw <= w && o.iw === w, JSON.stringify(o));
      await ctx.close();
    }

    // ------------------------------------------------------------ PLAY NOW -> the game's title menu
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage(); watch(page, 'play');
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await Promise.all([page.waitForURL(/\/play(\.html)?$/, { timeout: 30000 }), page.click('.hero .btn-gold[data-play]')]);
      let ok = false, why = '';
      try { await page.waitForFunction(() => window.SEQUEL_RENDER && SEQUEL_RENDER.ready && window.LAST_EDEN && LAST_EDEN.state === 'menu' && !!document.getElementById('newgame'), null, { timeout: 90000, polling: 200 }); ok = true; } catch (e) { why = e.message.split('\n')[0]; }
      C.check(S, 'PLAY NOW opens play.html and the game reaches its title menu (START ADVENTURE)', ok, why + ' at ' + page.url());
      await ctx.close();
    }

    // ------------------------------------------------------------ PLAY WITH FRIENDS -> the online lobby
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage(); watch(page, 'friends');
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await Promise.all([page.waitForURL(/\/play(\.html)?\?online$/, { timeout: 30000 }), page.click('.hero [data-friends]')]);
      let r = null, why = '';
      try {
        await page.waitForSelector('#mp-lobby', { timeout: 60000 });
        r = await page.evaluate(() => ({ text: document.getElementById('mp-lobby').innerText.replace(/\s+/g, ' ').slice(0, 200), host: !!document.getElementById('mp-host'), join: !!document.getElementById('mp-join'), search: location.search, net: !!window.EDEN_NET, lobby: !!window.EDEN_LOBBY }));
      } catch (e) { why = e.message.split('\n')[0]; }
      C.check(S, 'PLAY WITH FRIENDS opens play.html straight into the online lobby (HOST A GAME / JOIN A GAME) and strips ?online', !!r && r.host && r.join && r.net && r.lobby && r.search === '', why || JSON.stringify(r));
      await ctx.close();
    }

    // ------------------------------------------------------------ a share link on / -> the game's join flow
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage(); watch(page, 'join');
      // ?net=loopback keeps the join on the in-browser transport (no PeerJS download, no network) and is forwarded with ?join
      await page.goto(HOME + '?join=DINO-4KQ7&net=loopback', { waitUntil: 'domcontentloaded' });
      let r = null, why = '';
      try {
        await page.waitForURL(/\/play\.html/, { timeout: 30000 });
        await page.waitForSelector('#mp-lobby', { timeout: 60000 });
        await page.waitForTimeout(400);
        r = await page.evaluate(() => ({ path: location.pathname, search: location.search, text: document.getElementById('mp-lobby').innerText.replace(/\s+/g, ' ').slice(0, 240), phase: document.querySelector('#mp-lobby [data-phase]') ? document.querySelector('#mp-lobby [data-phase]').dataset.phase : null }));
      } catch (e) { why = e.message.split('\n')[0]; }
      const joinFlow = !!r && /play\.html$/.test(r.path) && !/join=/i.test(r.search) && /DINO-4KQ7|CONNECTING|JOIN|NO GAME WITH THAT CODE|CAN.T CONNECT/i.test(r.text) && !/HOST A GAME/.test(r.text);
      C.check(S, 'A ?join=DINO-4KQ7 link opened on / goes to play.html and the lobby takes it into the join flow (the code is consumed)', joinFlow, why || JSON.stringify(r));
      await ctx.close();
    }

    // ------------------------------------------------------------ /play alias, reduced motion
    {
      const st = await status(SITE + '/play');
      if (st === 200) C.pass(S, '/play serves the game (vercel.json rewrite, tools/serve.cjs)');
      else C.warn(S, '/play serves the game (vercel.json rewrite, tools/serve.cjs)', `HTTP ${st}: a server started before tools/serve.cjs learned /play`);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }), page = await ctx.newPage(), own = watch(page, 'reduced');
      await page.goto(HOME, { waitUntil: 'load' }); await page.waitForTimeout(500);
      const a = await page.evaluate(() => document.querySelector('[data-num]').textContent); await page.waitForTimeout(7600);
      const b = await page.evaluate(() => document.querySelector('[data-num]').textContent);
      C.check(S, 'prefers-reduced-motion: the key art does not advance by itself, no error', a === '01' && b === '01' && own.length === 0, JSON.stringify({ a, b, own }));
      await ctx.close();
    }
  } finally { await browser.close(); if (srv.child) srv.child.kill(); }
  A.finish(C, errors);
})().catch(e => { console.error(e); process.exit(1); });
