#!/usr/bin/env node
// Screenshots of the game page (play.html): the title and its panels at desktop sizes, the touch layouts on a phone.
//   node tools/home/game-shots.cjs [--url http://127.0.0.1:8798]   -> work/home/shots/game-*.png
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..'), OUT = path.join(ROOT, 'work', 'home', 'shots');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const URL_ = opt('--url', 'http://127.0.0.1:8798');
const { chromium } = require(path.join(ROOT, 'tests', 'node_modules', 'playwright'));
const answers = u => new Promise(res => { const r = http.get(u, x => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.setTimeout(2000, () => { r.destroy(); res(false); }); });
const ready = page => page.waitForFunction(() => window.SEQUEL_RENDER && SEQUEL_RENDER.ready && window.LAST_EDEN && window.SPRITES && SPRITES.familyReady && SPRITES.familyReady('ui'), null, { timeout: 90000, polling: 200 });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let srv = null;
  if (!(await answers(URL_ + '/play.html'))) { srv = cp.spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.cjs'), new URL(URL_).port], { cwd: ROOT, stdio: 'ignore' }); for (let i = 0; i < 60 && !(await answers(URL_ + '/play.html')); i++) await new Promise(r => setTimeout(r, 100)); }
  const browser = await chromium.launch(), errs = [];
  const shot = async (page, name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `game-${name}.png`) }); console.log('game-' + name); };
  try {
    for (const [w, h] of [[1920, 1080], [1440, 900]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } }), page = await ctx.newPage();
      page.on('pageerror', e => errs.push(e.message));
      await page.goto(URL_ + '/play.html'); await ready(page); await page.waitForTimeout(1200);
      await shot(page, `${w}-title`);
      if (w === 1440) {
        await page.screenshot({ path: path.join(OUT, `game-${w}-full.png`), fullPage: true });
        for (const id of ['chapters', 'guide', 'jukebox']) { await page.click('#' + id); await shot(page, `${w}-${id}`); await page.evaluate(() => LAST_EDEN.test.menu()); await page.waitForTimeout(300); }
        await page.click('#newgame'); await shot(page, `${w}-select`);
        await page.click('#begin'); await page.waitForTimeout(600); await shot(page, `${w}-card`);
        await page.evaluate(() => { LAST_EDEN.start(0, 1); }); await page.waitForTimeout(800); await page.keyboard.press('Escape'); await shot(page, `${w}-pause`);
        await page.goto(URL_ + '/play.html?online'); await page.waitForSelector('#mp-lobby'); await shot(page, `${w}-lobby`);
      }
      await ctx.close();
    }
    for (const [name, vp] of [['375-portrait', { width: 375, height: 812 }], ['812-landscape', { width: 812, height: 375 }]]) {
      const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }), page = await ctx.newPage();
      page.on('pageerror', e => errs.push(e.message));
      await page.goto(URL_ + '/play.html'); await ready(page); await page.waitForTimeout(1200);
      await shot(page, name + '-title');
      await page.tap('#newgame'); await page.tap('#begin'); await page.waitForTimeout(400); await page.tap('#enter-stage').catch(() => {}); await page.waitForTimeout(900); await shot(page, name + '-play');
      await ctx.close();
    }
  } finally { await browser.close(); if (srv) srv.kill(); }
  console.log('errors', errs.length ? errs : 'none');
})().catch(e => { console.error(e); process.exit(1); });
