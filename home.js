/* home.js — the home page is the key-art hero alone (index.html): the slider, the panels the nav opens (<dialog>) and
   the saved-checkpoint note. No dependency, nothing from the game's runtime is loaded. */
(function () {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reduce.matches;
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ------------------------------------------------------------------ the key-art slider
  // Four paintings (01 the heroes over the title, 02-04 full scenes, loaded when first shown); the tagline and the line
  // under it change with the picture. Auto-advances every 7 s while the card is on screen, never with reduced motion.
  const SLIDES = [
    ['Classic heroes. A wilder world. A new adventure.', 'Cadillacs & Dinosaurs II: The Crown Tide brings the 1993 arcade legend back to life with eight new stages, new threats and an untamed world, free in your browser.'],
    ['The Cadillac is back on the road.', 'Floor it down the Coral Causeway with raptors at the doors and Krag\u2019s armoured hauler in the mirror.'],
    ['Stop the marshal. Save the valley.', 'Marshal Sable holds the Crown dam. Fight his guard, his blade and what the treatment makes of him.'],
    ['Nobody owns the wild.', 'Break the cages, cut the collars and let the herds run free across eight hand-painted stages.'],
  ];
  function slider() {
    const kv = document.querySelector('.kv'); if (!kv) return;
    const imgs = $$('.kv-slide', kv), dots = $$('.kv-dots button', kv), tag = kv.querySelector('[data-tag]'), lead = kv.querySelector('[data-lead]'), num = kv.querySelector('[data-num]');
    let cur = 0, timer = 0, pre = 0, seen = true, hover = false;
    // a slide carries a 1 px placeholder until it is first needed (data-src)
    const load = im => { if (im.dataset.src) { im.src = im.dataset.src; delete im.dataset.src; } };
    const show = i => {
      cur = (i + imgs.length) % imgs.length; load(imgs[cur]);
      imgs.forEach((e, k) => e.classList.toggle('on', k === cur)); dots.forEach((d, k) => d.setAttribute('aria-current', k === cur ? 'true' : 'false'));
      kv.dataset.slide = cur; tag.textContent = SLIDES[cur][0]; lead.textContent = SLIDES[cur][1]; num.textContent = String(cur + 1).padStart(2, '0');
      clearTimeout(pre); pre = setTimeout(() => load(imgs[(cur + 1) % imgs.length]), 5000);   // the next one shortly before it shows
    };
    const arm = () => { clearTimeout(timer); if (!still() && seen && !hover && !document.hidden) timer = setTimeout(() => { show(cur + 1); arm(); }, 7000); };
    dots.forEach((d, k) => d.addEventListener('click', () => { show(k); arm(); }));
    kv.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { hover = true; arm(); } });
    kv.addEventListener('pointerleave', () => { hover = false; arm(); });
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { seen = es[0].isIntersecting; arm(); }).observe(kv);
    document.addEventListener('visibilitychange', arm);
    show(0); arm();
  }


  // ------------------------------------------------------------------ panels (Story, Stages, Characters, Co-op, More)
  // a click on the backdrop closes the panel; Esc and the x close it natively
  function panels() {
    const more = document.querySelector('.kv-more');
    $$('[data-open]').forEach(b => b.addEventListener('click', () => {
      const d = document.getElementById('p-' + b.dataset.open); if (!d) return;
      if (more) more.open = false; if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    }));
    $$('dialog.panel').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
    document.addEventListener('click', e => { if (more && more.open && !more.contains(e.target)) more.open = false; });
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

  function init() { slider(); panels(); resume(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
