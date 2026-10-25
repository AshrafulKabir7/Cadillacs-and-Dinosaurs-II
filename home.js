/* home.js — the home page: the game's sprites animated with their ROM frame timings (assets/home/art.js, made by
   tools/home/build-home-art.cjs), the Coral Causeway drive in the hero (the stage's own scroll3 / rowscroll speeds), the
   sticky nav, scroll reveals and the saved-checkpoint note. No dependency, nothing from the game's runtime is loaded. */
(function () {
  'use strict';
  const ART = window.HOME_ART || { sprites: {}, layers: {} };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reduce.matches;
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const loadImg = src => new Promise(res => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

  // ------------------------------------------------------------------ sprites
  // <span class="spr" data-spr="name" [data-flip] [data-scale="2"] [data-x="40" data-y="90"]>: one strip, one frame shown
  const live = new Set(), all = [];
  function setAnim(s, name, opts) {
    const m = ART.sprites[name]; if (!m) return false;
    const st = s.el.style;
    st.setProperty('--w', m.w); st.setProperty('--h', m.h); st.setProperty('--n', m.n); st.setProperty('--ax', m.ax); st.setProperty('--ay', m.ay); st.setProperty('--k', 0);
    if (!s.img) { s.img = document.createElement('img'); s.img.alt = ''; s.img.decoding = 'async'; if (!s.eager) s.img.loading = 'lazy'; s.el.appendChild(s.img); }
    s.img.width = m.w * m.n; s.img.height = m.h; s.img.src = m.src;
    s.m = m; s.name = name; s.k = 0; s.t = (m.d ? m.d[0] : 30) / 60; s.once = opts && opts.once ? opts.then : null;
    return true;
  }
  function initSprite(el) {
    const s = { el, eager: !!el.closest('.hero') };
    if (el.dataset.flip != null) el.style.setProperty('--fx', -1);
    if (el.dataset.scale) el.style.setProperty('--u', el.dataset.scale + 'px');
    if (el.dataset.x) { el.style.setProperty('--x', el.dataset.x + '%'); el.style.setProperty('--y', el.dataset.y + '%'); }
    if (!setAnim(s, el.dataset.spr)) return null;
    el._spr = s; all.push(s); return s;
  }
  function tick(s, dt) {
    const m = s.m; if (!m || m.n < 2) return;
    s.t -= dt; let guard = 0;
    while (s.t <= 0 && guard++ < 64) {
      if (s.k + 1 >= m.n) {
        if (s.once) { const back = s.once; setAnim(s, back); return; }
        s.k = m.loop != null && m.loop < m.n ? m.loop : 0;
      } else s.k++;
      s.t += (m.d ? m.d[s.k] : 6) / 60;
    }
    s.el.style.setProperty('--k', s.k);
  }

  // ------------------------------------------------------------------ the drive (hero)
  const drive = { canvas: document.getElementById('drive'), D: 0, t: 0, on: true, ready: false };
  function layout() {
    const hero = document.querySelector('.hero'); if (!hero) return;
    const w = hero.clientWidth, h = window.innerHeight || 800;
    const s = Math.max(1, Math.min(4, Math.round(w / 430), Math.floor(h * 0.62 / 224) || 1));
    hero.style.setProperty('--s', s);
    hero.style.setProperty('--ls', w >= 700 ? 2 : 1);
    drive.s = s;
    if (drive.canvas) { drive.W = Math.ceil(w / s); drive.canvas.width = drive.W; drive.canvas.height = 224; drive.g = drive.canvas.getContext('2d'); drive.g.imageSmoothingEnabled = false; }
    if (drive.ready) drawDrive();
  }
  function frameOf(m, t) {
    if (!m || !m.d) return 0; const total = m.d.reduce((a, b) => a + b, 0); let f = Math.floor(t * 60) % total, k = 0;
    while (k < m.n - 1 && f >= m.d[k]) { f -= m.d[k]; k++; } return k;
  }
  function blitSprite(g, img, m, k, x, y, flip) {
    if (!img || !m) return;
    if (flip) { g.save(); g.translate(Math.round(x), 0); g.scale(-1, 1); g.drawImage(img, k * m.w, 0, m.w, m.h, -m.ax, Math.round(y) - m.ay, m.w, m.h); g.restore(); }
    else g.drawImage(img, k * m.w, 0, m.w, m.h, Math.round(x) - m.ax, Math.round(y) - m.ay, m.w, m.h);
  }
  function drawDrive() {
    const g = drive.g, L = ART.layers, W = drive.W, I = drive.img; if (!g || !I) return;
    const mod = (a, n) => ((a % n) + n) % n;
    g.fillStyle = L.bg || '#444477'; g.fillRect(0, 0, W, 224);
    if (I.sky) { const tw = I.sky.width, o = mod(Math.floor(drive.D / (1 << (L.sky.shift || 3))), tw); for (let x = -o; x < W; x += tw) g.drawImage(I.sky, x, 0); }
    if (I.road) {
      const tw = I.road.width, rs = L.rowscroll || { rows: 0 }, y0 = L.road.y, rows = rs.rows || 0;
      for (let i = 0; i < rows; i++) { const f = rs.den ? (rs.base + i) / rs.den : 1, o = mod(Math.round(drive.D * f), tw); for (let x = -o; x < W; x += tw) g.drawImage(I.road, 0, i, tw, 1, x, y0 + i, tw, 1); }
      const o = mod(Math.round(drive.D), tw), h = I.road.height - rows; for (let x = -o; x < W; x += tw) g.drawImage(I.road, 0, rows, tw, h, x, y0 + rows, tw, h);
    }
    const S = ART.sprites, car = S.car, cw = car ? car.w : 257;
    const cx = Math.round((W - cw) / 2) + (W < 420 ? 22 : 44);
    const t = drive.t, sway = still() ? 0 : Math.sin(t * 0.8) * 10;
    // Mustapha and Mess run after the car, as at the end of the 1993 game
    const narrow = W < 420;
    if (!narrow) blitSprite(g, I.mess, S['hero-mess-run'], frameOf(S['hero-mess-run'], t), cx - 116 + sway, 211, true);
    if (car) blitSprite(g, I.car, car, Math.floor(t * 30) % car.n, cx, 204, false);
    blitSprite(g, I.mustapha, S['hero-mustapha-run'], frameOf(S['hero-mustapha-run'], t + .13), cx - (narrow ? 44 : 58) - sway * .6, 216, true);
  }
  async function startDrive() {
    if (!drive.canvas || !ART.layers.sky) return;
    const S = ART.sprites, L = ART.layers;
    const [sky, road, car, mustapha, mess] = await Promise.all([L.sky.src, L.road.src, S.car && S.car.src, S['hero-mustapha-run'] && S['hero-mustapha-run'].src, S['hero-mess-run'] && S['hero-mess-run'].src].map(s => s ? loadImg(s) : null));
    drive.img = { sky, road, car, mustapha, mess }; drive.ready = true; drawDrive();
    document.querySelector('.scene')?.classList.add('live');
  }

  // ------------------------------------------------------------------ one loop for everything that moves
  let last = 0, rafId = 0;
  function loop(now) {
    rafId = 0;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0); last = now;
    if (!still()) {
      for (const s of live) tick(s, dt);
      if (drive.ready && drive.on) { drive.t += dt; drive.D += 150 * dt; drawDrive(); }
    }
    if (!document.hidden && !still()) rafId = requestAnimationFrame(loop);
  }
  const kick = () => { if (!rafId && !still() && !document.hidden) { last = 0; rafId = requestAnimationFrame(loop); } };

  // ------------------------------------------------------------------ hero cards: the special move on hover / tap
  function heroCards() {
    for (const b of $$('.hstage[data-hero]')) {
      const el = b.querySelector('.spr'), id = b.dataset.hero;
      const play = () => { const s = el && el._spr; if (!s || still()) return; if (s.name !== `hero-${id}-idle`) return; setAnim(s, `hero-${id}-special`, { once: true, then: `hero-${id}-idle` }); live.add(s); kick(); };
      b.addEventListener('click', play);
      b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') play(); });
      b.addEventListener('pointerenter', () => { const m = ART.sprites[`hero-${id}-special`]; if (m && !b._pre) { b._pre = loadImg(m.src); } }, { once: true });
    }
  }

  // ------------------------------------------------------------------ nav, reveals, checkpoint
  function nav() {
    const n = document.getElementById('nav'); if (!n) return;
    const upd = () => n.classList.toggle('solid', window.scrollY > 24);
    upd(); window.addEventListener('scroll', upd, { passive: true });
  }
  function reveals() {
    const els = $$('.reveal');
    if (still() || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(e => io.observe(e));
  }
  function resume() {
    const p = document.getElementById('resume'); if (!p) return;
    let cp = null; try { cp = (JSON.parse(localStorage.getItem('last-eden-save') || '{}') || {}).checkpoint || null; } catch (e) { cp = null; }
    if (!cp || typeof cp.level !== 'number') return;
    // the eight stages (revision 3); a save from the six-chapter game is migrated by game.js when the title loads
    const names = ['the City in the Sea', 'the Swamp Forest', 'the Coral Causeway', 'the Sink', 'Crown Valley', 'the Verdant Biodome', 'the Observatory', 'the Crown dam'];
    p.textContent = `Welcome back. Your checkpoint in stage 0${cp.level + 1}, ${names[cp.level] || ''}, is saved: choose Continue on the title screen.`;
    p.hidden = false;
  }

  // ------------------------------------------------------------------ start
  function init() {
    $$('.spr[data-spr]').forEach(initSprite);
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => { for (const e of es) { const s = e.target._spr; if (!s) continue; if (e.isIntersecting) live.add(s); else live.delete(s); } kick(); }, { rootMargin: '120px' });
      all.forEach(s => io.observe(s.el));
      const hero = document.querySelector('.hero');
      if (hero) new IntersectionObserver(es => { drive.on = es[0].isIntersecting; kick(); }).observe(hero);
    } else all.forEach(s => live.add(s));
    layout(); startDrive().then(kick);
    let rt = 0; window.addEventListener('resize', () => { cancelAnimationFrame(rt); rt = requestAnimationFrame(layout); });
    document.addEventListener('visibilitychange', kick);
    if (reduce.addEventListener) reduce.addEventListener('change', () => { if (still()) { all.forEach(s => s.el.style.setProperty('--k', 0)); drawDrive(); } kick(); });
    heroCards(); nav(); reveals(); resume(); kick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
