// Node-only checks of the ROM heroes family (PLAN §6 WP-B; HEROES §5, §10, §13.2; KI6, KI8, KI11, KI12):
//   (1) envelope: SPRITE_DATA.add('heroes', …) v1, indexed sheets <= 1024x1024 whose decoded pixels match `sum`,
//       every rect inside its sheet, the palette maps the runtime needs
//   (2) golden: HeroRig.parts() reproduces every part list in tests/fixtures/rom-heroes-golden.json exactly (record,
//       origin, draw order, torso bob, weapon origin and record, torch flame with the one-frame lag and the depth
//       alternation), and the shipped sheets reproduce the predicted hero pixels (hash) in both facings
//   (3) roles: every HEROES §10.1 / §10.2 role resolves for all four heroes; record and length spot checks
//   (4) muzzle: HeroRig.muzzle() equals the HEROES §10.3 table for every hero x firearm
//   (5) timing: first-active frames, throw releases, pickup event, clip successors (D5, D10, §6.2, §6.4)
//   (6) ARCADE_HEROES compatibility view (CODE-MAP §12.A pins) and its spliced sheets, pixel for pixel
//   (7) empty guns are hurled (user decision, HEROES O3) and the thrown-gun art/data is complete; with sprite-data-fx.js
//       present, every weapon record the heroes reference is on an fx sheet
//   (8) optional browser pass (Playwright, when installed; ROM_HEROES_BROWSER=0 skips): the colouriser decodes and
//       verifies the sheets, canvasFor <= 5 ms/Mpx, the LRU stays in budget, HeroRig.draw renders
// Run from the repo root: node tests/rom-heroes.cjs   (exit 1 on any FAIL; writes tests/results/rom-heroes.json)
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..'), rel = p => path.join(ROOT, p), exists = p => fs.existsSync(rel(p));
const png = require(rel('tools/re/build/png.cjs'));

const rows = [];
const row = (status, name, detail) => { rows.push({ status, name, detail: detail || '' }); console.log(status.padEnd(5) + name + (detail ? '  ' + detail : '')); };
const check = (name, ok, detail) => row(ok ? 'PASS' : 'FAIL', name, ok ? '' : detail);
const skip = (name, detail) => row('SKIP', name, detail);
const J = v => JSON.stringify(v);

// ---------------------------------------------------------------- load the runtime in a sandbox (no DOM)
function sandbox(files) {
  const w = { atob, btoa, setTimeout, clearTimeout, console };
  w.window = w; w.globalThis = w; vm.createContext(w);
  for (const f of files) vm.runInContext(fs.readFileSync(rel(f), 'utf8'), w, { filename: f });
  return w;
}
const W = sandbox(['sprites.js', 'sprite-data-heroes.js', 'hero-rig.js']);
const F = W.ROM_HEROES, R = W.HeroRig, A = W.ARCADE_HEROES;
const HEROES = ['jack', 'mustapha', 'hannah', 'mess'];

// ---------------------------------------------------------------- (1) envelope and sheets
check('(1) sprites.js publishes ROM_HEROES from SPRITE_DATA.add(\'heroes\', …) and HeroRig reads it', !!F && F === W.SPRITE_DATA.families.heroes && F.v === 1 && F.family === 'heroes' && R && R.data === F, `ROM_HEROES=${!!F}`);
check('(1) the family is indexed (RC2) with the four hero sheets', F.mode === 'indexed' && J(Object.keys(F.sheets).sort()) === J(HEROES.slice().sort()), `${F.mode} ${Object.keys(F.sheets)}`);
const dec = {}; let sumsOk = true, sizeOk = true, rectOk = true, encOk = true; const sumBad = [];
for (const h of HEROES) {
  const s = F.sheets[h], img = png.fromDataURL(s.png); dec[h] = img;
  if (img.width !== s.w || img.height !== s.h || s.w > 1024 || s.h > 1024) sizeOk = false;
  if (png.fnvIndexed(img.rgba).toString(16) !== String(s.sum).replace(/^0x/, '')) { sumsOk = false; sumBad.push(h); }
  for (let q = 0; q < img.rgba.length; q += 4) if (img.rgba[q + 3] && (img.rgba[q + 3] !== 255 || img.rgba[q] > 31 || img.rgba[q + 1] > 14 || img.rgba[q + 2] !== 0)) { encOk = false; break; }
  for (const r of Object.values(F.rect[h])) if (r[0] < 0 || r[1] < 0 || r[0] + r[2] > img.width || r[1] + r[3] > img.height) rectOk = false;
}
check('(1) sheets decode at their declared size, <= 1024x1024', sizeOk);
check('(1) decoded pixels match every sheet `sum` (FNV-1a over R<<4|G)', sumsOk, sumBad.join(','));
check('(1) pixels are R = slot, G = pen (0-14), B = 0, A = 255 or transparent', encOk);
check('(1) every record box lies inside its sheet', rectOk);
const bytes = fs.statSync(rel('sprite-data-heroes.js')).size;
check('(1) sprite-data-heroes.js fits its 0.9 MB budget (PLAN §5.4)', bytes <= 0.9 * 1048576, `${bytes} bytes`);
const needMaps = ['hero', ...HEROES.flatMap(h => ['hero', 'mirror', 'freed', 'half'].map(v => `${v}-${h}`)), 'gel', 'flash'];
const missMaps = needMaps.filter(k => !F.pal.maps[k] || F.pal.maps[k].length !== 32 || F.pal.maps[k].some(rk => F.pal.rows[rk] == null || F.pal.rows[rk].length !== 16));
check('(1) palette maps hero-/mirror-/freed-/half-<id>, gel, flash resolve every slot to a 16-colour row', !missMaps.length, missMaps.join(','));
const slotOf = { jack: 0, hannah: 1, mustapha: 2, mess: 3 };
check('(1) a mirror map recolours only its hero\'s OBJ slot, and changes that row', HEROES.every(h => { const m = F.pal.maps[`mirror-${h}`], s = slotOf[h]; return m.every((rk, i) => (i === s ? rk !== i : rk === i)) && J(F.pal.rows[m[s]]) !== J(F.pal.rows[s]); }));

// ---------------------------------------------------------------- (2) golden part lists
const G = exists('tests/fixtures/rom-heroes-golden.json') ? JSON.parse(fs.readFileSync(rel('tests/fixtures/rom-heroes-golden.json'), 'utf8')) : null;
const body = b => (b.full ? { full: { clip: b.full[0], k: b.full[1] } } : { torso: { clip: b.torso[0], k: b.torso[1] }, legs: { clip: b.legs[0], k: b.legs[1] } });
const fnv = codes => { let h = 0x811C9DC5; for (const c of codes) { h ^= c & 0xFFFF; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
function compose(hero, parts, face) {                       // hero records only, screen space relative to the feet
  const px = new Map(); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) {
    if (p.fam !== 'heroes') continue;
    const r = F.rect[p.sheet][p.rec], img = dec[p.sheet];
    for (let v = 0; v < r[3]; v++) for (let u = 0; u < r[2]; u++) {
      const q = ((r[1] + v) * img.width + r[0] + u) * 4; if (!img.rgba[q + 3]) continue;
      const nx = p.x - r[4] + u, ny = p.y - r[5] + v, sx = face ? -nx - 1 : nx;
      px.set(sx + ',' + ny, img.rgba[q] * 16 + img.rgba[q + 1]);
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (ny < y0) y0 = ny; if (ny > y1) y1 = ny;
    }
  }
  const codes = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const c = px.get(x + ',' + y); codes.push(c == null ? 0xFFFF : c); }
  return { box: [x0, y0, x1 + 1, y1 + 1], hash: fnv(codes).toString(16) };
}
if (!G) skip('(2) golden part lists', 'tests/fixtures/rom-heroes-golden.json missing (node tools/re/build/sprites-heroes.cjs golden)');
else {
  const TF = F.fx.torchFlame; let ok = 0, pix = 0, flames = 0, flameOk = 0; const bad = [], badPix = [];
  const stats = { split: 0, weapon: 0, bob: 0, byHero: {} };
  for (const s of G.samples) {
    const b = body(s.body); let fl = null;
    if (s.flame) {
      flames++; fl = R.flame();
      R.flameUpdate(fl, s.hero, body(s.flame.prev.body), 'torch', { x: s.flame.prev.x, z: s.flame.prev.z, dir: s.flame.prev.face ? 1 : -1, dt: 0 });
      fl.chain = s.flame.chain; fl.k = s.flame.k; fl.t = 1; fl.parity = TF.depthAlt.indexOf(s.flame.dd) ^ 1;   // the flame clock is free-running: take its phase
      R.flameUpdate(fl, s.hero, b, 'torch', { x: s.flame.cur.x, z: s.flame.cur.z, dir: s.face ? 1 : -1, dt: 0, running: s.flame.chain === 'running' });
    }
    const got = R.parts(s.hero, b, s.weapon, { flame: fl }), want = s.parts.map(p => p.slice());
    if (s.flame) { const fp = ['flame', s.flame.rec, s.flame.x, s.flame.y]; if (s.flame.front) want.push(fp); else want.unshift(fp); }
    const g2 = got.map(p => [p.tag, p.rec, p.x, p.y]);
    const flipOk = !s.flame || (got.find(p => p.tag === 'flame') || {}).flip === s.flame.flip;
    if (J(g2) === J(want) && flipOk) { ok++; if (s.flame) flameOk++; } else if (bad.length < 6) bad.push(`${s.run}@${s.f} ${s.hero} ${J(s.body)} ${s.weapon}: got ${J(g2)} want ${J(want)}`);
    const c = compose(s.hero, got, s.face);
    if (J(c.box) === J(s.box) && c.hash === s.hash) pix++; else if (badPix.length < 6) badPix.push(`${s.run}@${s.f} ${s.hero} box ${J(c.box)} vs ${J(s.box)} hash ${c.hash} vs ${s.hash}`);
    if (s.body.legs) stats.split++; if (s.weapon && s.parts.some(p => p[0] === 'weapon')) stats.weapon++; if (s.bob && (s.bob[1] || s.bob[2])) stats.bob++;
    stats.byHero[s.hero] = (stats.byHero[s.hero] || 0) + 1;
  }
  const n = G.samples.length;
  check(`(2) golden set is ~400 samples over all four heroes (${n}: ${J(stats.byHero)}; ${stats.split} split, ${stats.bob} with a torso bob, ${stats.weapon} with a weapon, ${flames} torch flames)`, n >= 350 && HEROES.every(h => stats.byHero[h] >= 60) && stats.split >= 50 && stats.bob >= 10 && stats.weapon >= 200 && flames >= 20);
  check(`(2) HeroRig.parts() reproduces every golden part list exactly (${ok}/${n})`, ok === n, bad.join('\n      '));
  check(`(2) torch flame: one frame behind the torch, depth +2 behind / -1 in front (${flameOk}/${flames})`, flames > 0 && flameOk === flames);
  check(`(2) the shipped sheets reproduce the model's hero pixels in the sample facing (${pix}/${n})`, pix === n, badPix.join('\n      '));
  check('(2) golden fixture was built from the shipped heroes.json', G.md5 && G.md5.heroes === F.build.md5.heroes, `${G.md5 && G.md5.heroes} vs ${F.build.md5.heroes}`);
}

// ---------------------------------------------------------------- (3) roles
const SPEC_ROLES = ['idle', 'walk', 'runStart', 'run', 'legsWalk', 'legsRun', 'jumpUp', 'jumpFwd', 'jumpBack', 'jumpRun', 'land', 'landHard', 'pickup', 'lift', 'victory',
  'p1', 'p2', 'p1Hit', 'kick', 'kickHit', 'fin', 'finHit', 'dash', 'dashEnd', 'airKick', 'airRun', 'airLate', 'mega', 'grab', 'knee1', 'knee2', 'throwFwd', 'throwBack',
  'hurt', 'hurtBack', 'knock', 'knockFace', 'knockHard', 'lieBack', 'getup', 'dizzy', 'heldStruggle', 'heldThrown', 'drive'];
const CLS = ['throwable', 'blade', 'blunt', 'pistol', 'rifle', 'smg', 'm16', 'shotgun', 'bazooka', 'container'];
const missing = [];
for (const h of HEROES) {
  for (const r of SPEC_ROLES) if (!R.clip(h, r)) missing.push(`${h}.${r}`);
  for (const c of CLS) { if (!R.clip(h, `stand.${c}`)) missing.push(`${h}.stand.${c}`); if (!R.clip(h, `attack.${c}`)) missing.push(`${h}.attack.${c}`); }
  for (const c of ['rifle', 'smg', 'm16', 'shotgun', 'bazooka', 'container']) if (!R.clip(h, `walkTorso.${c}`)) missing.push(`${h}.walkTorso.${c}`);
  for (const r of ['runTorso.guns', 'smgWalkFire', 'smgWalkFire.m16', 'runThrow', 'attack.container.0', 'attack.container.4', 'containerJump.rise', 'containerJump.fall', 'containerJump.fwd']) if (!R.clip(h, r)) missing.push(`${h}.${r}`);
  if (h !== 'jack' && !R.clip(h, 'runTorso.blunt')) missing.push(`${h}.runTorso.blunt`);
}
check('(3) every HEROES §10.1 / §10.2 role resolves for all four heroes', !missing.length, missing.join(', '));
check('(3) class tables: pistol and the knife walk/run on the plain clips; Jack has no blunt run torso (§4.3)', HEROES.every(h => { const c = F.hero[h].cls; return !c.pistol.walkTorso && !c.pistol.runTorso && !c.blade.walkTorso && !c.blade.runTorso && c.rifle.runTorso === 'runTorso.guns'; }) && F.hero.jack.cls.blunt.runTorso === null && !R.clip('jack', 'runTorso.blunt') && ['mustapha', 'hannah', 'mess'].every(h => F.hero[h].cls.blunt.runTorso === 'runTorso.blunt'));
const recs = (h, r) => R.clip(h, r).f.map(f => f[0] + (f[1] >= 0 ? '+' + f[1] : '')).filter((s, i, a) => !i || s !== a[i - 1]).join(',');   // §10 lists records, repeats folded
const spot = [
  ['jack', 'stand.pistol', '75+74'], ['jack', 'attack.pistol', '86+84,87+84'], ['jack', 'stand.rifle', '77'], ['jack', 'attack.rifle', '77,88'],
  ['mustapha', 'stand.rifle', '259'], ['mustapha', 'attack.rifle', '259,260'], ['mustapha', 'walkTorso.rifle', '284'], ['mustapha', 'runTorso.guns', '288'],
  ['mustapha', 'stand.shotgun', '261'], ['mustapha', 'walkTorso.shotgun', '285'], ['mustapha', 'stand.smg', '270+269'], ['hannah', 'stand.smg', '1552+1548'],
  ['mess', 'stand.blade', '605'], ['mess', 'dash', '699'], ['jack', 'dash', '41'], ['mustapha', 'pickup', '287'], ['jack', 'drive', '2700'], ['mustapha', 'drive', '2696,2697'], ['hannah', 'drive', '2698,2699'], ['mess', 'drive', '2701'],
  ['jack', 'stand.throwable', '35'], ['mustapha', 'stand.throwable', R.clip('mustapha', 'idle') ? recs('mustapha', 'idle') : '?'],
];
const spotBad = spot.filter(([h, r, w]) => !R.clip(h, r) || recs(h, r) !== w).map(([h, r, w]) => `${h}.${r}=${R.clip(h, r) ? recs(h, r) : 'none'} (want ${w})`);
check('(3) §10.2 / KI12 record spot checks (Jack pistol over 84, Mustapha 259/260/284/288, drive main:29 …)', !spotBad.length, spotBad.join('; '));
const lenOf = (h, r) => R.length(h, r);
const LENS = { idle: [800, 230, 230, 270], walk: [48, 48, 48, 48], runStart: [54, 43, 43, 43], run: [40, 32, 32, 32], legsRun: [40, 32, 32, 32], victory: [33, 183, 181, 175], mega: [39, 118, 36, 54],
  getup: [26, 33, 30, 29], hurt: [10, 15, 15, 15], hurtBack: [10, 8, 8, 15], knock: [32, 32, 32, 32], knockHard: [40, 40, 40, 40], dash: [27, 91, 90, 90], pickup: [11, 11, 11, 11], land: [7, 10, 10, 10], landHard: [22, 18, 22, 22],
  p1: [10, 12, 8, 10], kick: [16, 18, 12, 13], fin: [19, 22, 19, 21], throwBack: [23, 23, 23, 47], 'attack.smg': [7, 7, 5, 9] };
const lenBad = []; for (const [r, l] of Object.entries(LENS)) HEROES.forEach((h, i) => { if (lenOf(h, r) !== l[i]) lenBad.push(`${h}.${r}=${lenOf(h, r)} (want ${l[i]})`); });
check('(3) clip lengths equal HEROES §10.1 (idle, walk, run, victory, mega crash, getup, hurt, knock, dash, …)', !lenBad.length, lenBad.join('; '));
check('(3) the run cycle has 8 frames, runStart >= 9, walk 12, legsWalk 12, legsRun 8 (story L40/L52 new form)', HEROES.every(h => R.clip(h, 'run').f.length === 8 && R.clip(h, 'runStart').f.length >= 9 && R.clip(h, 'walk').f.length === 12 && R.clip(h, 'legsWalk').f.length === 12 && R.clip(h, 'legsRun').f.length === 8));
check('(3) every Mustapha jumpUp/jumpFwd record is in 218-227 (story L55 new form)', ['jumpUp', 'jumpFwd'].every(r => R.clip('mustapha', r).f.every(f => f[0] >= 218 && f[0] <= 227)));
check('(3) legs clips carry the bob index and their table (main:16 walk, main:11 run)', HEROES.every(h => R.clip(h, 'legsWalk').bob === 'walk' && R.clip(h, 'legsRun').bob === 'run' && R.clip(h, 'legsWalk').f.every(f => f.length === 7) && F.hero[h].bob.walk.length === 12 && F.hero[h].bob.run.length === 8));
check('(3) KI8: the inferred / static / visual label roles are listed per hero for a sheet check', HEROES.every(h => Array.isArray(F.hero[h].inferred) && F.hero[h].inferred.some(s => /^dizzy=/.test(s)) && F.hero[h].inferred.some(s => /^heldThrown=/.test(s))), HEROES.map(h => `${h}: ${F.hero[h].inferred.length}`).join(' '));
check('(3) ROM_HEROES.hero.<id>.anim keeps the HEROES §4.2 shape (combat L44-45 new form)', F.hero.mustapha.anim['stand.rifle'].f[0][0] === 259 && F.hero.mustapha.anim['attack.rifle'].f.map(f => f[0]).join() === '259,260' && F.hero.mustapha.anim['walkTorso.rifle'].f[0][0] === 284 && F.hero.mustapha.anim['runTorso.guns'].f[0][0] === 288 && F.hero.jack.anim.p1.id === 'punch:0' && F.hero.jack.anim.p1.contact === 'p1Hit' && F.hero.jack.anim.p1.next === 'idle');

// ---------------------------------------------------------------- (4) muzzle table (HEROES §10.3: ahead x height, hold, record, origin)
const MZ = `jack gun 0 55 1633 -40 -61 60 67|jack rifle 0 60 1888 -14 -60 54 65|jack uzi 1 66 1649 -15 -50 44 55|jack m16 1 58 1768 3 -41 51 48|jack shotgun 0 57 1665 1 -41 45 48|jack bazooka 0 62 1752 -16 -58 50 65|mustapha gun 0 50 1633 -20 -63 40 69|mustapha rifle 0 52 1892 -14 -60 54 65|mustapha uzi 1 57 1649 -14 -53 43 58|mustapha m16 1 55 1768 0 -42 54 49|mustapha shotgun 0 62 1665 -15 -53 61 60|mustapha bazooka 0 59 1752 -17 -62 51 69|hannah gun 0 47 1633 -36 -54 56 60|hannah rifle 0 52 1890 -6 -60 46 65|hannah uzi 1 50 1649 -5 -46 34 51|hannah m16 1 50 1768 -5 -46 59 53|hannah shotgun 0 49 1665 -7 -46 53 53|hannah bazooka 0 59 1752 -11 -52 45 59|mess gun 0 73 1633 -48 -61 68 67|mess rifle 0 68 1895 -16 -60 56 65|mess uzi 1 72 1649 0 -54 29 59|mess m16 1 72 1768 0 -54 54 61|mess shotgun 0 75 1665 -12 -42 58 49|mess bazooka 0 76 1752 -34 -56 68 63`.split('|').map(s => s.split(' '));
const mzBad = MZ.filter(([h, w, k, hold, rec, ox, oy, ah, ht]) => { const m = R.muzzle(h, w); return !m || m.k !== +k || m.hold !== +hold || m.rec !== +rec || m.origin[0] !== +ox || m.origin[1] !== +oy || -m.x !== +ah || -m.y !== +ht; }).map(r => r.slice(0, 2).join('.'));
check('(4) HeroRig.muzzle() = HEROES §10.3 for all 24 hero x firearm rows (shot frame, hold, record, origin, ahead x height)', !mzBad.length, mzBad.join(', '));

// ---------------------------------------------------------------- (5) timing
function run(h, role, n, opts) { const a = R.player(), ev = R.play(a, h, role, opts).map(e => ({ ...e, f: 0 })); for (let i = 1; i <= n; i++) ev.push(...R.tick(a, 1 / 60).map(e => ({ ...e, f: i }))); return { a, ev }; }
const firstAct = (h, r, o) => (run(h, r, 60, o).ev.find(e => e.type === 'act') || {}).f;
const untr = r => J(HEROES.map(h => firstAct(h, r, { trim: false })));
check('(5) combo start clips hit on their first active frame: p1 1/1/1/2, kick 2/4/4/4, fin 4/5/4/6 frames after the press (§6.2, untrimmed)', untr('p1') === '[1,1,1,2]' && untr('kick') === '[2,4,4,4]' && untr('fin') === '[4,5,4,6]', `${untr('p1')} ${untr('kick')} ${untr('fin')}`);
check('(5) with the KI11 first-frame trim, p1 still never hits on the press itself (regression L19) and lands within 9 x .016 s', HEROES.every(h => firstAct(h, 'p1') >= 1 && firstAct(h, 'p1') / 60 <= 9 * 0.016) && HEROES.every((h, i) => { const t = firstAct(h, 'kick'), u = JSON.parse(untr('kick'))[i], d0 = R.clip(h, 'kick').f[0][2]; return t === (d0 > 1 ? u - 1 : u); }));
const release = h => (run(h, 'throwBack', 80, { trim: false }).ev.find(e => e.type === 'ev') || {}).f;
check('(5) grab throw releases on the first event: 13/13/17/31 frames (§6.4, untrimmed)', J(HEROES.map(release)) === '[13,13,17,31]', J(HEROES.map(release)));
const pk = run('jack', 'pickup', 30);
check('(5) pickup: ev1 after 10 frames untrimmed (9 trimmed), the clip ends at 11', (run('jack', 'pickup', 30, { trim: false }).ev.find(e => e.type === 'ev') || {}).f === 10 && (pk.ev.find(e => e.type === 'ev') || {}).f === 9 && (run('jack', 'pickup', 30, { trim: false }).ev.find(e => e.type === 'end') || {}).f === 11);
const p1 = run('jack', 'p1', 20);
check('(5) a punch continues into idle (ROM loopTarget) and a stance holds (loop on its last frame)', p1.a.role === 'idle' && run('jack', 'stand.rifle', 200).a.done === true);
const dts = [1 / 60, 0.016, 0.033, 1 / 72, 1 / 144].map(dt => { const a = R.player(); R.play(a, 'mess', 'p1'); let t = 0, hit = null; while (t < 0.5 && hit == null) { t += dt; if (R.tick(a, dt).some(e => e.type === 'act')) hit = t; } return hit; });
check('(5) clip time accumulates in seconds: the Mess p1 hit lands at 2/60 s for dt 1/60, .016, .033, 1/72, 1/144', dts.every(t => t != null && t >= 2 / 60 - 1e-9 && t < 2 / 60 + 0.034), J(dts.map(t => t && +t.toFixed(4))));
const lw = R.player(); R.play(lw, 'jack', 'legsWalk'); R.advance(lw, 4); const k4 = lw.k; R.advance(lw, 44);
check('(5) distance-driven advance walks the legs clip by ROM frames (4 f -> frame 1, 48 f -> back to frame 0)', k4 === 1 && lw.k === 0, `${k4} ${lw.k}`);

// ---------------------------------------------------------------- (6) ARCADE_HEROES compatibility view
const fr = (h, n) => A.frames[A.heroes[h][n][0]], lst = (h, n) => A.heroes[h][n].map(i => A.frames[i]);
check('(6) sprites.js sets window.ARCADE_HEROES to the compatibility view (333 frames, the legacy list names)', A && A.compat === true && A.frames.length === 333 && ['mustapha', 'jack', 'hannah', 'mess'].every(h => ['idle', 'walk', 'run', 'jump', 'crouch', 'p1', 'p2', 'kick', 'fin', 'air', 'grab', 'knee', 'throw', 'lift', 'hurt', 'hurt2', 'fly', 'lying', 'getup', 'dizzy', 'win', 'gunStand', 'gunFire', 'pistolStand', 'pistolFire', 'torsoWalk', 'torsoRun', 'legsWalk', 'legsRun', 'legsStand', 'bazookaStand', 'bazookaFire'].every(n => Array.isArray(A.heroes[h][n]))));
check('(6) combat L45: Mustapha gunStand/gunFire/torsoWalk/torsoRun are records 259/260/284/288', [fr('mustapha', 'gunStand').rec, fr('mustapha', 'gunFire').rec, fr('mustapha', 'torsoWalk').rec, fr('mustapha', 'torsoRun').rec].join() === '259,260,284,288');
check('(6) polish L74: Jack pistolStand/pistolFire/gunStand/gunFire are torso records (s===2, h<50), pistolFire.gunDrawn', ['pistolStand', 'pistolFire', 'gunStand', 'gunFire'].every(n => fr('jack', n).s === 2 && fr('jack', n).h < 50) && fr('jack', 'pistolFire').gunDrawn === true && fr('jack', 'pistolFire').rec === 86 && lst('jack', 'pistolStand').every(f => f.rec >= 84 && f.rec <= 96));
check('(6) story L40/L52: run 9 frames with 40<oy<100, walk 12, legsWalk 12, legsRun 8, torso/stance hand points', HEROES.every(h => lst(h, 'run').length === 9 && lst(h, 'run').every(f => f.oy > 40 && f.oy < 100) && lst(h, 'walk').length === 12 && lst(h, 'legsWalk').length === 12 && lst(h, 'legsRun').length === 8 && ['torsoWalk', 'torsoRun', 'gunStand', 'gunFire', 'pistolStand', 'pistolFire'].every(n => fr(h, n).hand && fr(h, n).hand[0] < 0 && fr(h, n).hand[1] < -30)));
const legacyRecs = () => { if (!exists('arcade-heroes.js')) return null; const w = sandbox(['arcade-heroes.js']); return w.ARCADE_HEROES; };
const L = legacyRecs();
if (L) {
  const same = L.frames.every((f, i) => A.frames[i].rec === f.rec && J(A.frames[i].hand || null) === J(f.hand || null) && J(A.frames[i].grip || null) === J(f.grip || null) && !!A.frames[i].gunDrawn === !!f.gunDrawn) && ['mustapha', 'jack', 'hannah', 'mess'].every(h => Object.keys(L.heroes[h]).length === Object.keys(A.heroes[h]).length && Object.keys(L.heroes[h]).every(n => J(A.heroes[h][n]) === J(L.heroes[h][n])));
  check('(6) the view keeps arcade-heroes.js frame order, records, list names, hand/grip points and gunDrawn exactly', same);
  // every opaque legacy pixel must land on an opaque pixel of the ROM record at the same feet-relative position (the
  // legacy decode cropped some edge rows/columns and has a few wrong pens; the ROM records are atlas-validated)
  const l1 = png.fromDataURL(L.sheet), l2 = png.fromDataURL(L.sheet2), c1 = png.fromDataURL(A.sheet), c2 = png.fromDataURL(A.sheet2), used = new Set(Object.values(L.heroes).flatMap(o => Object.values(o).flat()));
  let lp = 0, lmiss = 0, lcol = 0, grown = 0;
  L.frames.forEach((f, i) => {
    if (!used.has(i)) return; const a = A.frames[i], li = f.s === 2 ? l2 : l1, ni = a.s === 2 ? c2 : c1; if (a.w !== f.w || a.h !== f.h) grown++;
    for (let v = 0; v < f.h; v++) for (let u = 0; u < f.w; u++) {
      const q = ((f.y + v) * li.width + f.x + u) * 4; if (li.rgba[q + 3] < 128) continue; lp++;
      const au = u - f.anchor + a.anchor, av = v - f.oy + a.oy;
      if (au < 0 || av < 0 || au >= a.w || av >= a.h) { lmiss++; continue; }
      const o = ((a.y + av) * ni.width + a.x + au) * 4; if (!ni.rgba[o + 3]) { lmiss++; continue; }
      if (Math.abs(ni.rgba[o] - li.rgba[q]) > 8 || Math.abs(ni.rgba[o + 1] - li.rgba[q + 1]) > 8 || Math.abs(ni.rgba[o + 2] - li.rgba[q + 2]) > 8) lcol++;
    }
  });
  check(`(6) game.js draws the same pixels at the same feet position: all ${lp} opaque legacy pixels are on the ROM records (${lcol} differ in colour, ${grown} boxes regain cropped edges)`, lmiss === 0 && lcol < 0.001 * lp, `${lmiss} legacy pixels missing, ${lcol} colour differences`);
  if (exists('assets.js')) { const AS = sandbox(['assets.js']).ARCADE_ASSETS, mus = AS.mustapha; check('(6) story L55: Mustapha\'s jump frames do not share sheet coordinates with ARCADE_ASSETS frames 31/33', lst('mustapha', 'jump').every(f => ![31, 33].some(i => mus.frames[i].x === f.x && mus.frames[i].y === f.y))); }
} else skip('(6) legacy arcade-heroes.js comparison', 'arcade-heroes.js not present (retired)');
{
  const V2 = W.SPRITES.compatView(), t0 = Date.now(), s1 = V2.sheet, s2 = V2.sheet2, ms = Date.now() - t0, d1 = png.fromDataURL(s1), d2 = png.fromDataURL(s2), map = F.pal.maps[F.pal.home];   // a fresh view: nothing cached
  let n = 0, bad = 0;
  A.frames.forEach(f => {
    if (!f.w) return; const hero = f.s === 2 ? 'jack' : HEROES.find(h => h !== 'jack' && F.rect[h][f.rec]), r = F.rect[hero][f.rec], src = dec[hero], img = f.s === 2 ? d2 : d1;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const q = ((r[1] + y) * src.width + r[0] + x) * 4, o = ((f.y + y) * img.width + f.x + x) * 4; n++;
      if (!src.rgba[q + 3]) { if (img.rgba[o + 3]) bad++; continue; }
      const c = F.pal.rows[map[src.rgba[q]]][src.rgba[q + 1]];
      if (img.rgba[o + 3] !== 255 || img.rgba[o] !== ((c >> 16) & 255) || img.rgba[o + 1] !== ((c >> 8) & 255) || img.rgba[o + 2] !== (c & 255)) bad++;
    }
  });
  check(`(6) the spliced compat sheets (${d1.width}x${d1.height} + ${d2.width}x${d2.height}, built in ${ms} ms without inflating) show every frame in its home colours`, bad === 0 && n > 1e6 && d1.height === F.compat.sheet.h && d2.height === F.compat.sheet2.h, `${bad} of ${n} px wrong`);
}

// ---------------------------------------------------------------- (7) empty guns: the hurl
const FA = ['gun', 'rifle', 'uzi', 'm16', 'shotgun', 'bazooka'];
check('(7) every firearm is hurled when empty (user decision over D15), with its fast-spin and ground records', FA.every(t => F.weapon[t].empty === 'hurl' && F.weapon[t].fastSpin.length >= 8 && F.weapon[t].fastSpin.every(([rec, d]) => rec > 0 && d > 0) && F.weapon[t].ground.length >= 1) && J(F.fx.hurl.weapons) === J(FA), FA.map(t => `${t}:${F.weapon[t].empty}/${F.weapon[t].fastSpin.length}`).join(' '));
const H7 = F.fx.hurl;
check('(7) the hurl flight is the ROM throwable flight (9.5 px/f, 12 on the run, from the release height) through attack.throwable, with a rebound and the sequel damage', H7.clip === 'attack.throwable' && H7.release === 2 && H7.v === 9.5 && H7.vRun === 12 && H7.ax < 0 && H7.rebound && H7.rebound.vx < 0 && H7.rebound.g < 0 && H7.lie > 0 && H7.damage === 42 && J(HEROES.map(h => F.hero[h].releaseH)) === '[53,50,57,58]' && HEROES.every(h => R.clip(h, 'attack.throwable').f.some(f => f[4] === 2)), J(H7));
check('(7) the arcade discard (D15) and the rifle/M16 empty club poses stay available as data', F.fx.discard && F.fx.discard.vh > 0 && F.fx.discard.g < 0 && F.weapon.rifle.emptyPose === 'rifle-empty' && F.weapon.m16.emptyPose === 'm16-empty' && HEROES.every(h => Object.keys(F.hero[h].hold['rifle-empty'] || {}).length > 10 && Object.keys(F.hero[h].hold['m16-empty'] || {}).length > 10));
check('(7) weapon timing data: shot speed/life per hero, muzzle offsets, casing, torch flame chains and the 33 KI6 offsets', FA.every(t => F.weapon[t].muzzle && F.weapon[t].shot && HEROES.every(h => F.weapon[t].shot.life[h] > 0)) && F.fx.torchFlame.burning.length === 6 && F.fx.torchFlame.running.length === 4 && F.fx.torchFlame.offsets.length === 33 && J(F.fx.torchFlame.depthAlt) === '[2,-1]' && F.weapon.rifle.casing && !F.weapon.gun.casing);
const life = t => J(HEROES.map(h => F.weapon[t].shot.life[h]));
check('(7) KI10: per-hero bullet life gun 10/12/11/9, rifle 10/10/11/11 f; Uzi/M16 12 px/f (Hannah\'s 6.5 artefact not used)', life('gun') === '[10,12,11,9]' && life('rifle') === '[10,10,11,11]' && F.weapon.uzi.shot.v === 12 && F.weapon.m16.shot.v === 12 && F.weapon.gun.shot.v === 8, `${life('gun')} ${life('rifle')}`);
const fxFile = ['sprite-data-fx.js'].find(exists);
if (fxFile) {
  const WF = sandbox(['sprites.js', fxFile, 'sprite-data-heroes.js']), FX = WF.ROM_FX, S = WF.SPRITES;
  const miss = F.weaponRecs.filter(r => !S.locate('fx', r));
  check(`(7) every weapon/flame record the heroes reference (${F.weaponRecs.length}: holds, rotations, fast spin, ground, fuse, flame) is on an fx sheet`, !!FX && !miss.length, `${miss.length} missing: ${miss.slice(0, 20).join(',')}`);
} else skip('(7) weapon records on the fx sheet', 'sprite-data-fx.js not shipped yet (WP-D)');

// ---------------------------------------------------------------- (8) optional browser pass
async function browser() {
  if (process.env.ROM_HEROES_BROWSER === '0') return skip('(8) browser colouriser pass', 'ROM_HEROES_BROWSER=0');
  let chromium; try { ({ chromium } = require(path.join(__dirname, 'node_modules', 'playwright'))); } catch (e) { try { ({ chromium } = require('playwright')); } catch (e2) { return skip('(8) browser colouriser pass', 'playwright not installed (npm install inside tests/)'); } }
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 900, height: 700 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.setContent('<!doctype html><html><body style="margin:0;background:#202428"><canvas id="c" width="880" height="660"></canvas></body></html>');
  for (const f of ['sprites.js', 'sprite-data-heroes.js', 'hero-rig.js']) await page.addScriptTag({ path: rel(f) });
  await page.waitForFunction(() => window.SPRITES && SPRITES.familyReady('heroes'), null, { timeout: 20000 });
  const r = await page.evaluate(() => {
    const out = { ready: SPRITES.ready, verified: SPRITES.verified, rig: HeroRig.ready, status: SPRITES.status() };
    const ids = ['jack', 'mustapha', 'hannah', 'mess'], maps = ['hero', 'mirror', 'freed', 'half', 'gel', 'flash'];
    // each call colours one full sheet (0.62-0.74 Mpx); cold = the very first use (JIT, raster init), steady state =
    // the median per-call rate over 5 more passes (other builds share this machine, so single timings are noisy)
    const rates = [], pass = () => { let ms = 0, mpx = 0; for (const h of ids) for (const v of maps) { const t0 = performance.now(), c = SPRITES.canvasFor(`heroes/${h}`, HeroRig.mapFor(v, h)), dt = performance.now() - t0; if (c) { const m = c.width * c.height / 1e6; mpx += m; ms += dt; rates.push(dt / m); } } return { ms, mpx }; };
    const cold = pass(); rates.length = 0; for (let i = 0; i < 5; i++) { SPRITES.flush(); pass(); }
    rates.sort((a, b) => a - b);
    out.coldMsPerMpx = cold.ms / cold.mpx; out.mpx = cold.mpx; out.msPerMpx = rates[rates.length >> 1]; out.p90 = rates[Math.floor(rates.length * 0.9)]; out.colourMs = out.msPerMpx * cold.mpx; out.stats = JSON.parse(JSON.stringify(SPRITES.stats));
    // pixel check: Jack idle record 0 in the home map vs ROM_HEROES rows
    const r0 = ROM_HEROES.rect.jack[0], cv = SPRITES.canvasFor('heroes/jack', 'hero-jack'), d = cv.getContext('2d').getImageData(r0[0], r0[1], r0[2], r0[3]).data;
    let opaque = 0, colourOk = 0; const rows = ROM_HEROES.pal.rows;
    const ref = new Set(rows[0].map(c => c >>> 0));
    for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { opaque++; if (ref.has(((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) >>> 0)) colourOk++; }
    out.idleOpaque = opaque; out.idleColourOk = colourOk;
    // draw every hero with each variant through HeroRig.draw (one transform, both facings)
    const g = document.getElementById('c').getContext('2d'); g.fillStyle = '#202428'; g.fillRect(0, 0, 880, 660);
    let drawn = 0; ids.forEach((h, i) => maps.forEach((v, j) => { const parts = HeroRig.parts(h, { full: { clip: 'idle', k: 0 } }, null); if (HeroRig.draw(g, parts, 60 + j * 140, 150 + i * 160, 0, j % 2 ? 1 : -1, 1.5, v)) drawn++; }));
    out.drawn = drawn;
    // LRU budget
    SPRITES.budget = 6 * 1048576; for (const h of ids) for (const v of maps) SPRITES.canvasFor(`heroes/${h}`, HeroRig.mapFor(v, h));
    out.lruBytes = SPRITES.stats.bytes; out.evicted = SPRITES.stats.evicted; SPRITES.budget = 48 * 1048576;
    out.compat = !!(window.ARCADE_HEROES && ARCADE_HEROES.compat);
    // lazy boxes: drawing a new variant colours only the boxes of the records drawn
    SPRITES.flush(); const b0 = SPRITES.stats.boxes, c0 = SPRITES.stats.colourised;
    const parts = HeroRig.parts('jack', { full: { clip: 'idle', k: 0 } }, null); HeroRig.draw(g, parts, 400, 600, 0, 1, 1, 'mirror');
    const cvm = SPRITES.canvasFor('heroes/jack', 'mirror-jack', null, ROM_HEROES.rect.jack[0]), rr = ROM_HEROES.rect.jack[0], other = ROM_HEROES.rect.jack[4];
    const dm = cvm.getContext('2d').getImageData(rr[0], rr[1], rr[2], rr[3]).data, mrow = new Set(ROM_HEROES.pal.rows[ROM_HEROES.pal.maps['mirror-jack'][0]].map(c => c >>> 0));
    let mo = 0, mok = 0; for (let i = 0; i < dm.length; i += 4) if (dm[i + 3]) { mo++; if (mrow.has(((dm[i] << 16) | (dm[i + 1] << 8) | dm[i + 2]) >>> 0)) mok++; }
    const dOther = cvm.getContext('2d').getImageData(other[0], other[1], other[2], other[3]).data; let otherOpaque = 0; for (let i = 3; i < dOther.length; i += 4) if (dOther[i]) otherOpaque++;
    out.lazy = { boxes: SPRITES.stats.boxes - b0, full: SPRITES.stats.colourised - c0, mirrorPx: mo, mirrorOk: mok, otherOpaque };
    return out;
  });
  // every shipped family (other packages' sprite-data-*.js as they land) decodes, verifies and colours
  const famFiles = fs.readdirSync(ROOT).filter(f => /^sprite-data-[\w-]+\.js$/.test(f)).sort();
  const p2 = await b.newPage(); p2.on('pageerror', e => errors.push(String(e)));
  await p2.setContent('<!doctype html><html><body></body></html>');
  await p2.addScriptTag({ path: rel('sprites.js') }); for (const f of famFiles) await p2.addScriptTag({ path: rel(f) });
  await p2.waitForFunction(() => SPRITES.status().every(s => s.state === 'ok' || s.state === 'bad'), null, { timeout: 60000 }).catch(() => {});
  const all = await p2.evaluate(() => {
    const st = SPRITES.status(), out = { ready: SPRITES.ready, verified: SPRITES.verified, sheets: st.length, bad: st.filter(s => s.state !== 'ok' || !s.ok).map(s => s.key), coloured: 0, failed: [] };
    for (const s of st) { const fam = s.key.split('/')[0], maps = SPRITES.maps(fam), m = maps[0]; const c = m ? SPRITES.canvasFor(s.key, m) : null; if (c && c.width === s.w && c.height === s.h) out.coloured++; else out.failed.push(`${s.key}|${m}`); }
    out.families = Object.keys(SPRITES.families); return out;
  });
  const shot = rel('tests/results/rom-heroes-variants.png'); fs.mkdirSync(path.dirname(shot), { recursive: true });
  await page.locator('#c').screenshot({ path: shot });
  const img2 = await page.evaluate(() => new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = ARCADE_HEROES.sheet; }));
  await b.close();
  check('(8) browser: every hero sheet decodes, checksums verify (SPRITES.ready && SPRITES.verified), HeroRig.ready', r.ready && r.verified && r.rig, J(r.status));
  check(`(8) browser: canvasFor colours a sheet at ${r.msPerMpx.toFixed(2)} ms/Mpx steady state (<= 5; p90 ${r.p90.toFixed(2)}; first use ${r.coldMsPerMpx.toFixed(1)}; 24 sheet x map canvases = ${r.mpx.toFixed(1)} Mpx)`, r.msPerMpx <= 5, J(r.stats));
  check('(8) browser: the home map gives Jack\'s idle frame only ROM row-0 colours', r.idleOpaque > 1000 && r.idleColourOk === r.idleOpaque, `${r.idleColourOk}/${r.idleOpaque}`);
  check(`(8) browser: HeroRig.draw renders all 4 heroes x 6 variants (${r.drawn}/24); screenshot tests/results/rom-heroes-variants.png`, r.drawn === 24);
  check(`(8) browser: the LRU evicts to stay inside its budget (${(r.lruBytes / 1048576).toFixed(1)} MB under a 6 MB budget, ${r.evicted} evicted)`, r.evicted > 0 && r.lruBytes <= 6 * 1048576 + 4 * 1048576);
  check('(8) browser: the ARCADE_HEROES compat sheet loads as an image (game.js ahSheet)', r.compat && img2 && img2.w === 1024 && img2.h === F.compat.sheet.h, J(img2));
  check(`(8) browser: a new variant colours only the record boxes HeroRig.draw uses (${r.lazy.boxes} boxes, ${r.lazy.full} full sheets) in that map's colours`, r.lazy.boxes >= 1 && r.lazy.full === 0 && r.lazy.mirrorPx > 1000 && r.lazy.mirrorOk === r.lazy.mirrorPx && r.lazy.otherOpaque === 0, J(r.lazy));
  check(`(8) browser: every shipped family sheet decodes, verifies its sum and colours (${all.families.join(', ')}: ${all.coloured}/${all.sheets} sheets from ${famFiles.join(', ')})`, all.sheets > 0 && !all.bad.length && all.coloured === all.sheets && all.verified, `bad ${all.bad.join(',')} failed ${all.failed.join(',')}`);
  check('(8) browser: no page errors', !errors.length, errors.join(' | '));
}

browser().catch(e => row('FAIL', '(8) browser pass threw', String(e && e.stack || e))).then(() => {
  fs.mkdirSync(rel('tests/results'), { recursive: true });
  fs.writeFileSync(rel('tests/results/rom-heroes.json'), JSON.stringify({ when: new Date().toISOString(), rows }, null, 1));
  const fails = rows.filter(r => r.status === 'FAIL').length;
  console.log(`\n${rows.filter(r => r.status === 'PASS').length} passed, ${fails} failed, ${rows.filter(r => r.status === 'SKIP').length} skipped`);
  process.exit(fails ? 1 : 0);
});
