#!/usr/bin/env node
// Screenshots of the home page and the game page for review: work/home/shots/ (git-ignored).
//   node tools/home/shots.cjs [--url http://127.0.0.1:8798]   (default: starts tools/serve.cjs on 8798)
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..'), OUT = path.join(ROOT, 'work', 'home', 'shots');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const URL_ = opt('--url', 'http://127.0.0.1:8798');
const { chromium } = require(path.join(ROOT, 'tests', 'node_modules', 'playwright'));
const answers = u => new Promise(res => { const r = http.get(u, x => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.setTimeout(2000, () => { r.destroy(); res(false); }); });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let srv = null;
  if (!(await answers(URL_ + '/'))) { srv = cp.spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.cjs'), new URL(URL_).port], { cwd: ROOT, stdio: 'ignore' }); for (let i = 0; i < 60 && !(await answers(URL_ + '/')); i++) await new Promise(r => setTimeout(r, 100)); }
  const browser = await chromium.launch();
  try {
    for (const [name, vp, mobile] of [['home-1440', { width: 1440, height: 900 }, false], ['home-375', { width: 375, height: 812 }, true]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
      const page = await ctx.newPage(), errs = [];
      page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      await page.goto(URL_ + '/', { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, name + '-top.png') });
      // walk down so the lazy images load and the reveals fire, then a full-page shot
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < h; y += vp.height / 2) { await page.evaluate(y => window.scrollTo(0, y), y); await page.waitForTimeout(120); }
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT, name + '-full.png'), fullPage: true });
      console.log(name, 'height', h, 'errors', errs.length ? errs : 'none');
      await ctx.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await ctx.newPage();
    await page.goto(URL_ + '/play.html'); await page.waitForFunction(() => window.SEQUEL_RENDER && SEQUEL_RENDER.ready && window.LAST_EDEN, null, { timeout: 90000, polling: 200 });
    await page.waitForTimeout(1500); await page.screenshot({ path: path.join(OUT, 'game-1440.png') });
    await page.goto(URL_ + '/play.html?online'); await page.waitForSelector('#mp-lobby', { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'game-lobby-1440.png') });
    await ctx.close();
  } finally { await browser.close(); if (srv) srv.kill(); }
  console.log('->', path.relative(ROOT, OUT));
})().catch(e => { console.error(e); process.exit(1); });
