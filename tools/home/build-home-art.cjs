#!/usr/bin/env node
// Home page art (index.html): renders the game's own sprites and stage pages into small PNG strips under assets/home/
// and writes assets/home/art.js (window.HOME_ART: the strips' cell sizes, feet anchors and frame durations).
// Nothing here is new art: every pixel comes from the shipped sprite-data-*.js families (drawn with SPRITES / HeroRig,
// the game's own colouriser) and the assets/stages pages, rendered by play.html in headless Chromium.
//
//   node tools/home/build-home-art.cjs [--url http://127.0.0.1:8797]   (default: starts tools/serve.cjs on 8797)
//
// Outputs (all committed, all small; the home page loads them lazily below the first view):
//   logo.png                 the ROM title logo (play.html's #title-logo canvas)
//   hero-<id>-<anim>.png     HeroRig clips (idle, walk, special, victory) at native size, art facing left
//   boss-<id>-idle.png       the chapter bosses and their second forms (idle loops)
//   car.png                  the Cadillac on the Coral Causeway (body, wheels and Jack at the wheel; captured in play)
//   drive-sky.png            ch2/a0 scroll3 cut to its 256 px period; drive-road.png scroll2 road rows cut to 128 px
//   ch<N>.png                each chapter's boss arena (stage layers only, 384x224)
//   og.png                   the 1200x630 social card
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..'), OUT = path.join(ROOT, 'assets', 'home');
const png = require(path.join(ROOT, 'tools', 're', 'build', 'png.cjs'));
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const URL_ = opt('--url', 'http://127.0.0.1:8797');
const { chromium } = require(path.join(ROOT, 'tests', 'node_modules', 'playwright'));

const answers = u => new Promise(res => { const r = http.get(u, x => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.setTimeout(2000, () => { r.destroy(); res(false); }); });
async function server() {
  if (await answers(URL_ + '/play.html')) return null;
  const port = new URL(URL_).port || '80';
  const child = cp.spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.cjs'), port], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { if (await answers(URL_ + '/play.html')) return child; await new Promise(r => setTimeout(r, 100)); }
  child.kill(); throw new Error('serve.cjs did not start');
}

// Re-encode a canvas data URL as an indexed PNG when it has <= 256 colours (pixel art nearly always does).
function save(name, dataURL) {
  const img = png.decode(Buffer.from(dataURL.slice(dataURL.indexOf(',') + 1), 'base64'));
  const buf = png.encode({ width: img.width, height: img.height, rgba: img.rgba || img.data, palette: true, filters: 'auto' });
  fs.writeFileSync(path.join(OUT, name), buf);
  return buf.length;
}

// ------------------------------------------------------------------------------------------------ in the page
const PAGE = String.raw`
window.__HA = (() => {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; };
  const dur = d => (d === 0 ? 256 : d);
  // frames: [{boxes:[[x0,y0,x1,y1] relative to the feet], draw(g, fx, fy)}] -> one strip, equal cells, feet at (ax, ay)
  function strip(frames, pad) {
    pad = pad || 1; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const f of frames) for (const b of f.boxes) { x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const w = Math.ceil(x1 - x0), h = Math.ceil(y1 - y0), [c, g] = mk(w * frames.length, h);
    frames.forEach((f, i) => { g.save(); g.beginPath(); g.rect(i * w, 0, w, h); g.clip(); f.draw(g, i * w - x0, -y0); g.restore(); });
    return { url: c.toDataURL(), w, h, n: frames.length, ax: -x0, ay: -y0 };
  }
  function trim(c) {
    const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
  }
  // ---- heroes (HeroRig: the ROM clips, part lists and holds)
  function hero(id, role, weapon) {
    const H = HeroRig, S = SPRITES, clip = H.clip(id, role); if (!clip) return null;
    const frames = clip.f.map((f, k) => {
      const parts = H.parts(id, { full: { clip: role, k } }, weapon || null), boxes = [];
      for (const p of parts) { const l = S.locate(p.fam || 'heroes', p.rec, p.fam === 'heroes' ? p.sheet : null); if (!l) continue; const r = l.r; if (p.flip) boxes.push([p.x - (r[2] - r[4]), p.y - r[5], p.x + r[4], p.y - r[5] + r[3]]); else boxes.push([p.x - r[4], p.y - r[5], p.x - r[4] + r[2], p.y - r[5] + r[3]]); }
      return { boxes, d: dur(f[2]), draw: (g, x, y) => H.draw(g, parts, x, y, 0, -1, 1, 'hero') };
    }).filter(f => f.boxes.length);
    const s = strip(frames); s.d = frames.map(f => f.d); s.loop = clip.loop == null ? null : clip.loop; return s;
  }
  // ---- bosses (the generated boss bodies: SPRITE_DATA bosses frames named "<id>:<frame>")
  async function boss(id, name) {
    await SPRITES.loadSheets('bosses', ['b-' + id]);
    const B = ROM_BOSSES, an = Object.values(B.anims).find(a => a.t === id && a.name === name); if (!an) return null;
    const base = B.frames.findIndex(f => f && String(f[7]).startsWith(id + ':'));
    const rec = i => { const f = B.frames[i]; return f && String(f[7]).startsWith(id + ':') ? f[7] : B.frames[base + i] && B.frames[base + i][7]; };
    const frames = an.f.map(([i, d]) => { const r = rec(i), q = SPRITES.rect('bosses', r); return { boxes: [[-q[4], -q[5], q[2] - q[4], q[3] - q[5]]], d: dur(d), draw: (g, x, y) => SPRITES.drawRec(g, 'bosses', r, 'art-' + id, x, y, false) }; });
    const s = strip(frames); s.d = frames.map(f => f.d); return s;
  }
  // ---- stage layers (STAGE_RENDER.back/front at a camera, nothing else drawn)
  async function stage(ch, areaId, cam) {
    await STAGE_RENDER.require(ch);
    const [c, g] = mk(384, 224); const ref = 'ch' + (ch + 1) + '/' + areaId;
    for (let i = 0; i < 3; i++) { STAGE_RENDER.back(g, ref, cam, 1 + i / 60, {}); STAGE_RENDER.front(g, ref, cam, 1 + i / 60, { rain: false }); }
    return c.toDataURL();
  }
  // a page cut to its horizontal period (the smallest p whose columns repeat over the opaque rows)
  async function tile(src, y0, y1, guess) {
    const img = new Image(); img.src = src; await img.decode();
    const [c, g] = mk(img.naturalWidth, img.naturalHeight); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, same = (a, b) => { for (let y = y0; y < y1; y++) for (let k = 0; k < 4; k++) if (d[(y * W + a) * 4 + k] !== d[(y * W + b) * 4 + k]) return false; return true; };
    let period = null;
    for (const p of [guess, 64, 128, 256, 512].filter(Boolean)) { let ok = true; for (let x = 0; x + p < W && ok; x++) ok = same(x, x + p); if (ok) { period = p; break; } }
    if (!period) period = guess;
    const [o, og] = mk(period, y1 - y0); og.drawImage(c, 0, y0, period, y1 - y0, 0, 0, period, y1 - y0);
    return { url: o.toDataURL(), w: period, h: y1 - y0, y0 };
  }
  return { mk, strip, trim, hero, boss, stage, tile };
})();`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await server();
  const browser = await chromium.launch();
  const sizes = {}, art = { v: 1, sprites: {}, layers: {}, chapters: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await page.goto(URL_ + '/play.html');
    await page.waitForFunction(() => window.SEQUEL_RENDER && SEQUEL_RENDER.ready && window.ARCADE_HEROES && window.LAST_EDEN && window.HeroRig && HeroRig.ready, null, { timeout: 90000, polling: 100 });
    await page.evaluate(PAGE);
    const put = (name, s, extra) => { sizes[name + '.png'] = save(name + '.png', s.url); const m = { src: 'assets/home/' + name + '.png', w: s.w, h: s.h, n: s.n || 1, ax: s.ax || 0, ay: s.ay || 0 }; if (s.d) m.d = s.d; if (s.loop != null) m.loop = s.loop; Object.assign(m, extra || {}); art.sprites[name] = m; };

    // logo: the title screen draws it into #title-logo
    // (the title screen's blinking INSERT COIN line, the third block of rows when it is lit, is cut off)
    const logo = await page.evaluate(() => {
      LAST_EDEN.render(); const c = document.getElementById('title-logo'), b = __HA.trim(c), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, blocks = [];
      for (let y = b[1], open = null; y <= b[3]; y++) { let on = false; for (let x = b[0]; x < b[2] && !on && y < b[3]; x++) on = d[(y * c.width + x) * 4 + 3] > 0; if (on && open == null) open = y; if (!on && open != null) { blocks.push([open, y]); open = null; } }
      if (blocks.length >= 3) b[3] = blocks[blocks.length - 2][1];
      const [o, g] = __HA.mk(b[2] - b[0], b[3] - b[1]); g.drawImage(c, -b[0], -b[1]); return { url: o.toDataURL(), w: o.width, h: o.height };
    });
    put('logo', logo);

    // heroes
    for (const id of ['jack', 'hannah', 'mustapha', 'mess']) for (const [anim, role, weapon] of [['idle', 'idle'], ['walk', 'walk'], ['run', 'run'], ['special', 'mega'], ['victory', 'victory'], ['gun', 'attack.m16', 'm16']]) {
      const s = await page.evaluate(([id, role, weapon]) => __HA.hero(id, role, weapon), [id, role, weapon]);
      if (s) put(`hero-${id}-${anim}`, s); else console.warn('no clip', id, role);
    }
    // bosses: chapter boss, then its second form
    for (const id of ['rook', 'krag', 'ironclub', 'thorne', 'glassback', 'cinder', 'overdrive', 'echo', 'engine', 'sable', 'crownback']) {
      const s = await page.evaluate(id => __HA.boss(id, 'idle'), id);
      if (s) put(`boss-${id}-idle`, s); else console.warn('no boss anim', id);
    }

    // story pictures: the chapter-card panels as the game composes them (ARCADE_UI.resolvePic: backdrop + live cast)
    for (const id of ['p-barge-fire', 'p-pod-face', 'p-sable', 'p-convoy']) {
      const url = await page.evaluate(async id => {
        const g = LAST_EDEN; for (let k = 0; k < 400 && !g.test.composePic(id); k++) await new Promise(r => setTimeout(r, 25));
        g.test.picFrame(id, 30); const P = ARCADE_UI.resolvePic(id); if (!P || !P.img) return null;
        const im = P.img, [c, cg] = __HA.mk(im.width || im.naturalWidth, im.height || im.naturalHeight); cg.drawImage(im, 0, 0); return c.toDataURL();
      }, id);
      if (url) { sizes[id + '.png'] = save(id + '.png', url); art.pics = art.pics || {}; art.pics[id] = 'assets/home/' + id + '.png'; } else console.warn('no pic', id);
    }
    // drive layers (ch2/a0: scroll3 period 256, the road rows of scroll2 from y 128)
    const sky = await page.evaluate(() => __HA.tile('assets/stages/ch2/a0/s3-0-0-0.png', 0, 160, 256));
    sizes['drive-sky.png'] = save('drive-sky.png', sky.url); art.layers.sky = { src: 'assets/home/drive-sky.png', w: sky.w, h: sky.h, y: 0, shift: 3 };
    const road = await page.evaluate(() => __HA.tile('assets/stages/ch2/a0/s2-0-0.png', 128, 224, 128));
    sizes['drive-road.png'] = save('drive-road.png', road.url); art.layers.road = { src: 'assets/home/drive-road.png', w: road.w, h: road.h, y: 128 };
    art.layers.bg = await page.evaluate(() => STAGE_DATA.chapters.ch2.areas[0].bg);
    art.layers.rowscroll = await page.evaluate(() => STAGE_DATA.chapters.ch2.areas[0].rowscroll);

    // chapter arenas: the camera the boss lock puts on screen
    for (let ch = 0; ch < 6; ch++) {
      const r = await page.evaluate(async ch => {
        const g = LAST_EDEN; g.start(ch, 1); if (SEQUEL_RENDER.loadChapter) await SEQUEL_RENDER.loadChapter(ch);
        g.test.noDamage(true); g.test.spawnBoss(); for (let i = 0; i < 30; i++) g.step(1 / 60);
        const s = g.snapshot; return { area: s.area.id, view: s.view, url: await __HA.stage(ch, s.area.id, { x: s.view.x, y: s.view.y || 0 }) };
      }, ch);
      sizes[`ch${ch + 1}.png`] = save(`ch${ch + 1}.png`, r.url);
      art.chapters.push({ src: `assets/home/ch${ch + 1}.png`, area: r.area, cam: r.view.x });
    }

    // the Cadillac: chapter 2's drive, stage layers off, frames aligned on the car's left edge and floor
    const car = await page.evaluate(async () => {
      const g = LAST_EDEN; g.start(1, 1); g.test.noDamage(true);
      for (let i = 0; i < 400; i++) { g.step(1 / 60); if (i % 8 === 0) g.test.clearFighters(); }
      const cv = document.getElementById('game'), shots = [];
      const bk = STAGE_RENDER.back, fr = STAGE_RENDER.front; STAGE_RENDER.back = () => {}; STAGE_RENDER.front = () => {}; g.test.overlays(false);
      try {
        for (let k = 0; k < 8; k++) {
          g.step(1 / 60); g.test.clearFighters(); g.render();
          const [c, cg] = __HA.mk(cv.width / 2, cv.height / 2); cg.drawImage(cv, 0, 0, c.width, c.height);   // the canvas is 2x: back to arcade px
          shots.push({ c, b: __HA.trim(c), cam: g.snapshot.view.x });
        }
      } finally { STAGE_RENDER.back = bk; STAGE_RENDER.front = fr; g.test.overlays(true); }
      const frames = shots.filter(s => s.b).map(s => ({ boxes: [[0, s.b[1] - s.b[3], s.b[2] - s.b[0], 0]], d: 2, draw: (gg, x, y) => gg.drawImage(s.c, s.b[0], s.b[1], s.b[2] - s.b[0], s.b[3] - s.b[1], x, y - (s.b[3] - s.b[1]), s.b[2] - s.b[0], s.b[3] - s.b[1]) }));
      const st = __HA.strip(frames, 0); st.d = frames.map(f => f.d); return st;
    });
    put('car', car);

    // the social card, 1200x630: the drive at 3x, the car, the logo
    const og = await page.evaluate(async () => {
      const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });
      const [sky, road, logo, car] = await Promise.all(['assets/home/drive-sky.png', 'assets/home/drive-road.png', 'assets/home/logo.png', 'assets/home/car.png'].map(s => load(s + '?' + Date.now())));
      const [c, g] = __HA.mk(1200, 630), S = 3, top = 630 - 224 * S;
      g.fillStyle = STAGE_DATA.chapters.ch2.areas[0].bg; g.fillRect(0, 0, 1200, 630);
      for (let x = -40; x < 1200; x += sky.width * S) g.drawImage(sky, x, top, sky.width * S, sky.height * S);
      for (let x = -10; x < 1200; x += road.width * S) g.drawImage(road, x, top + 128 * S, road.width * S, road.height * S);
      const cw = car.width / 8;
      g.drawImage(car, 0, 0, cw, car.height, 1200 - cw * 3 + 70, 630 - car.height * 3 - 18, cw * 3, car.height * 3);
      const grad = g.createLinearGradient(0, 0, 820, 0); grad.addColorStop(0, 'rgba(6,9,20,.9)'); grad.addColorStop(.62, 'rgba(6,9,20,.62)'); grad.addColorStop(1, 'rgba(6,9,20,0)'); g.fillStyle = grad; g.fillRect(0, 0, 1200, 430);
      g.drawImage(logo, 60, 44, logo.width * 2, logo.height * 2);
      g.font = '700 30px "Segoe UI", Arial, sans-serif'; g.fillStyle = '#ffd76a'; g.fillText('PLAY FREE IN YOUR BROWSER · NO INSTALL', 64, 44 + logo.height * 2 + 46);
      g.font = '500 24px "Segoe UI", Arial, sans-serif'; g.fillStyle = '#e8eef5'; g.fillText('Unofficial fan sequel · six chapters · online co-op for 3', 64, 44 + logo.height * 2 + 84);
      return c.toDataURL();
    });
    const ogImg = png.decode(Buffer.from(og.slice(og.indexOf(',') + 1), 'base64'));
    const ogBuf = png.encode({ width: ogImg.width, height: ogImg.height, rgba: ogImg.rgba || ogImg.data, palette: true, filters: 'auto' });
    fs.writeFileSync(path.join(OUT, 'og.png'), ogBuf); sizes['og.png'] = ogBuf.length;

    if (errors.length) console.warn('page errors:', errors);
  } finally { await browser.close(); if (srv) srv.kill(); }

  fs.writeFileSync(path.join(OUT, 'art.js'), '// Generated by tools/home/build-home-art.cjs from the game\'s own sprite data and stage pages; do not edit by hand.\n' +
    'window.HOME_ART = ' + JSON.stringify(art) + ';\n');
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(sizes)) console.log(k.padEnd(28), (v / 1024).toFixed(1) + ' KB');
  console.log('total', (total / 1024).toFixed(1), 'KB ->', path.relative(ROOT, OUT));
})().catch(e => { console.error(e); process.exit(1); });
