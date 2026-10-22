// Browser checks for the arcade framing (ARCHITECTURE §7 "New checks", §8; PLAN §3.3, G1–G7 additions).
// Run from the repo root: node tools/serve.cjs 8766  then  node tests/framing.cjs   (GAME_URL overrides the server)
//
// Every check names the integration step that enables it. Until that step lands the check is reported as SKIP and the
// suite exits 0 ("run green on a stub", PLAN §6 WP-H). ARCADE_STEP=G2 turns the SKIPs of steps <= G2 into failures
// (ARCADE_STEP=G3a only those up to G3's first sub-step; a bare G3 all of G3a..G3d).
//   G0  SPRITES.verified (sprites.js in index.html), SPRITE_DATA envelopes
//   G1  canvas 768x448, LAST_EDEN.units/layout, snapshot view/band/area/length, the band and screen clamps,
//       side spawns fully off screen (±32; ±48 from G4), drops above the HUD, hero height ≈ 35% of the screen
//   G2  a foreground pixel covers a sprite (http only: the canvas is not tainted)
//   G3b no ctx.filter during a ch6 clone-war render (palette maps replace CSS filters; a SKIP during G3a); the copies play
//       their hero's ROM clips in mirror-/freed- maps; the Cadillac is the ROM car with the main:29 driver
//   G4  every arrival of every wave (normal, set pieces on) draws its first ROM frame box fully off screen
//   G7  HUD pixels change only inside layout.hud / layout.weapon (nothing below arcade y 44 but the weapon panel);
//       HUD-only renders (a fight, the car, a boss) stay in those rects; the top HUD matches the cabinet within 2 px
//       per element (tests/fixtures/hud-cabinet.json)
'use strict';
const A = require('./lib/arcade.cjs');

(async () => {
  const { browser, page, errors } = await A.launch();
  await A.prepare(page, { seed: 4242 });
  await A.open(page);
  await A.install(page);
  const P = await A.probe(page), S = A.stepsOf(P), C = A.checks('framing'), http = !A.isFileURL(A.BASE);
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ---------------------------------------------------------------- G0
  await C.gated('G0', 'Sprite sheets decode with matching checksums (SPRITES.ready && SPRITES.verified)', !!P.sprites, 'sprites.js (G0)',
    () => (P.sprites.ready && P.sprites.verified) || `ready=${P.sprites.ready} verified=${P.sprites.verified}`);
  await C.gated('G0', 'Every SPRITE_DATA family carries the §4.1 envelope (v, mode, sheets, rect, pal)', P.families.length > 0, 'sprite-data-*.js (G0)',
    () => ev(() => { const bad = []; for (const [k, f] of Object.entries(SPRITE_DATA.families)) { if (!(f.v >= 1 && /^(indexed|rgba)$/.test(f.mode) && f.sheets && f.rect && f.pal && f.pal.rows && f.pal.maps)) bad.push(k); } return bad.length ? 'missing keys in: ' + bad.join(',') : true; }));

  // ---------------------------------------------------------------- G1 framing
  const G1 = S.G1, g1why = 'LAST_EDEN.units (G1)';
  await C.gated('G1', 'The canvas bitmap is 768x448 (384x224 arcade px at 2x)', G1, g1why, () => (P.canvas.w === 768 && P.canvas.h === 448) || `${P.canvas.w}x${P.canvas.h}`);
  await C.gated('G1', "LAST_EDEN.units is {world:'arcade', px:2, aspect:'4:3'|'12:7'}", G1, g1why,
    () => (P.units.world === 'arcade' && P.units.px === 2 && /^(4:3|12:7)$/.test(String(P.units.aspect))) || JSON.stringify(P.units));
  // G6 (PLAN §7 G6 4): radio lines are drawn in the ROM 8x16 font on two rows, so the strip is ARCADE_UI's tall form
  // (8,46,368,32); it still ends above the feet band at y 81 (ARCHITECTURE §1.7's reason for the strip, polish L50).
  const radioRect = S.G6 ? [16, 92, 736, 64] : [16, 92, 736, 28];
  // G7 (PLAN §7 G7): the weapon panel is the cabinet's, (0,208)-(120,224), where the ROM routine 0x23A24 draws it (rows
  // 26-27, columns 0-14; checked against the armed MAME snapshots); ARCHITECTURE §1.7 had reserved (8,198)-(136,220)
  // from the video ("about y 200-220") before the panel was decoded.
  const weaponRect = S.G7 ? [0, 416, 240, 32] : [16, 396, 256, 44];
  await C.gated('G1', `LAST_EDEN.layout rects lie inside the reserved HUD (y<44), radio (8,46,368,${S.G6 ? 32 : 14}) and weapon (${S.G7 ? '0,208,120,16: the cabinet panel' : '8,198,128,22'}) rects ×2`, G1 && !!P.layout, 'LAST_EDEN.layout (G1)', () => {
    const L = P.layout, inside = (r, R) => Array.isArray(r) && r.length === 4 && r[0] >= R[0] && r[1] >= R[1] && r[0] + r[2] <= R[0] + R[2] && r[1] + r[3] <= R[1] + R[3];
    const ok = inside(L.hud, [0, 0, 768, 88]) && inside(L.radio, radioRect) && L.radio[1] + L.radio[3] <= 2 * 81 && inside(L.weapon, weaponRect);
    return ok || JSON.stringify(L);
  });
  await C.gated('G1', 'snapshot exposes view 384x224, band top<mid<bottom, area, cameraY, areaLength and length = Σ area widths', G1, g1why, () => ev(() => {
    const g = LAST_EDEN; g.start(0, 1, 'easy'); const s = g.snapshot, bad = [];
    if (!(s.view && s.view.w === 384 && s.view.h === 224)) bad.push('view ' + JSON.stringify(s.view));
    if (!(s.band && s.band.top < s.band.mid && s.band.mid < s.band.bottom)) bad.push('band ' + JSON.stringify(s.band));
    if (!(s.area && typeof s.area.index === 'number' && s.area.w > 0 && s.area.h > 0)) bad.push('area ' + JSON.stringify(s.area));
    if (typeof s.cameraY !== 'number') bad.push('cameraY');
    if (!(s.areaLength > 0 && s.length >= s.areaLength)) bad.push(`areaLength ${s.areaLength} length ${s.length}`);
    if (s.units !== 'arcade') bad.push('units ' + s.units);
    if (window.STAGE_DATA && STAGE_DATA.chapters) { const ch = Object.values(STAGE_DATA.chapters)[0]; if (ch && ch.areas) { const sum = ch.areas.reduce((a, ar) => a + ar.w, 0); if (sum !== s.length) bad.push(`length ${s.length} != Σ areas ${sum}`); } }
    return bad.length ? bad.join('; ') : true;
  }));

  // The band and screen clamps, every chapter (ARCHITECTURE §2.3, §4.3).
  await C.gated('G1', 'The player never leaves bandAt(x) or the screen clamp [view.x+16, view.x+367] in any chapter', G1, g1why, () => ev(() => {
    const g = LAST_EDEN, bad = [], STG = window.STAGE || null;
    const bandAt = (s, x) => { if (!STG || typeof STG.bandAt !== 'function') return s.band; for (const a of [s.area.index, s.area.id, s.area]) { try { const b = STG.bandAt(a, x); if (b) return Array.isArray(b) ? { top: b[0], bottom: b[1] } : b; } catch (e) { /* try the next key */ } } return s.band; };
    const probeTick = (ch, what) => { const s = g.snapshot, p = s.player, b = bandAt(s, p.x), v = s.view; if (!b) return;
      if (p.y < b.top - 0.01 || p.y > b.bottom + 0.01) bad.push(`ch${ch + 1} ${what}: y ${p.y.toFixed(1)} outside [${b.top},${b.bottom}]`);
      if (p.x < v.x + 16 - 0.01 || p.x > v.x + 367 + 0.01) bad.push(`ch${ch + 1} ${what}: x ${p.x.toFixed(1)} outside [${v.x + 16},${v.x + 367}]`);
      if (STG && typeof STG.walkable === 'function' && !p.driving) { let w = null; for (const a of [s.area.index, s.area.id]) { try { w = STG.walkable(a, p.x, p.y); if (w !== undefined) break; } catch (e) { /* next */ } } if (w === false) bad.push(`ch${ch + 1} ${what}: not walkable at ${p.x.toFixed(0)},${p.y.toFixed(0)}`); } };
    for (let ch = 0; ch < 6; ch++) {
      g.start(ch, 1, 'easy'); let s = g.snapshot; const x0 = s.player.x;
      AT.move(x0, s.band.top - 60); g.step(1 / 60); probeTick(ch, 'teleport above');
      AT.move(x0, s.band.bottom + 60); g.step(1 / 60); probeTick(ch, 'teleport below');
      AT.move(x0, s.band.mid);
      for (const [code, n] of [['KeyW', 120], ['KeyS', 120], ['KeyA', 200], ['KeyD', 400]]) { AT.key(code, true); for (let i = 0; i < n; i++) { g.step(1 / 60); if (i % 5 === 0) probeTick(ch, code); } AT.key(code, false); }
      if (bad.length > 12) break;
    }
    return bad.length ? bad.slice(0, 6).join(' | ') + (bad.length > 6 ? ` (+${bad.length - 6})` : '') : true;
  }));

  // Side entries fully off screen, drops above the HUD, every spawn inside its band (ARCHITECTURE §2.4).
  const margin = S.G4 ? 48 : 32;
  await C.gated('G1', `Reinforcements enter fully off screen (±${margin} px) and drops start above the HUD, in every chapter and area`, G1, g1why, () => ev(margin => {
    const g = LAST_EDEN, bad = [], STG = window.STAGE || null; let sampled = 0, sloped = 0, skipped = 0; const areasSeen = new Set();
    const bandAt = (s, x) => { if (!STG || typeof STG.bandAt !== 'function') return null; for (const a of [s.area.index, s.area.id]) { try { const b = STG.bandAt(a, x); if (b) return Array.isArray(b) ? { top: b[0], bottom: b[1] } : b; } catch (e) { /* next */ } } return null; };
    for (let ch = 0; ch < 6; ch++) {
      g.start(ch, 1, 'easy'); const encs = g.snapshot.plan.encounters;
      for (let k = 0; k < encs.length; k++) {
        g.test.skipTo(k); let s = null; for (let t = 0; t < 10; t++) { g.step(1 / 60); s = g.snapshot; if (s.enemies.length) break; }
        if (!s || !s.enemies.length) { skipped++; continue; }
        const v = s.view, L = s.lock || { left: v.x, right: v.x + v.w }; areasSeen.add(`${ch}:${s.area && s.area.index}`);
        const b0 = bandAt(s, L.left), b1 = bandAt(s, L.right); if (b0 && b1 && (b0.top !== b1.top || b0.bottom !== b1.bottom)) sloped++;
        for (const e of s.enemies) {
          sampled++;
          if (e.state === 'drop' || (e.z > 0 && !e.onstage)) { if (!(e.y - e.z < v.y - 16)) bad.push(`ch${ch + 1} enc${k} ${e.type} drop y-z ${(e.y - e.z).toFixed(0)} >= view.y-16 ${v.y - 16}`); }
          else if (!e.onstage || e.state === 'enter' || e.state === 'intro') { if (!(e.x < L.left - margin || e.x > L.right + margin)) bad.push(`ch${ch + 1} enc${k} ${e.type} x ${e.x.toFixed(0)} inside [${L.left - margin},${L.right + margin}]`); }
          const b = bandAt(s, e.x); if (b && !e.boss && (e.y < b.top - 0.5 || e.y > b.bottom + 0.5)) bad.push(`ch${ch + 1} enc${k} ${e.type} lane ${e.y.toFixed(0)} outside band [${b.top},${b.bottom}]`);
        }
        if (bad.length > 20) break;
      }
    }
    const note = `${sampled} spawns in ${areasSeen.size} areas, ${sloped} sloped locks, ${skipped} encounters spawned nothing`;
    return bad.length ? bad.slice(0, 6).join(' | ') + ` (+${Math.max(0, bad.length - 6)}) [${note}]` : true;
  }, margin));

  // From G4 the enemies are ROM frames up to 148 px wide (bikes, R HOPPER, TYROG): the anchor check above cannot see a
  // wide body's front poking in at the edge. Every arrival of every wave of every encounter, every chapter, on normal
  // (set pieces on): on its first drawable tick the drawn frame box (ROM_ENEMIES frame w/ox/oy at the anim on show) lies
  // fully outside the view, beyond the side edge or above the top for drops. Hero copies (HeroRig parts) are bounded by
  // the widest walk/idle part reach of the four heroes. KI15 riders are thrown off a wreck on screen and are excluded.
  await C.gated('G4', 'Every arrival (side, drop, set piece) draws its first frame fully off screen, every wave of every chapter on normal', !!S.G4, 'ENEMY_KINDS + ROM enemy frames (G4)', () => ev(() => {
    const g = LAST_EDEN, F = window.ROM_ENEMIES || SPRITE_DATA.families.enemies, bad = [], n = { seen: 0, side: 0, drop: 0, setPiece: 0, mirror: 0 };
    const R = window.HeroRig, SP = window.SPRITES, S = (window.COMBAT_CONFIG && COMBAT_CONFIG.sockets && COMBAT_CONFIG.sockets.scale) || 1;
    let mirrorReach = 0;
    if (R && SP) for (const id of ['jack', 'mustapha', 'hannah', 'mess']) for (const role of ['walk', 'idle']) { const c = R.clip(id, role); if (!c) continue;
      for (let k = 0; k < c.f.length; k++) for (const p of R.parts(id, { full: { clip: role, k } }, null)) { const loc = SP.locate(p.fam || 'heroes', p.rec, p.fam === 'heroes' ? p.sheet : null); if (loc) mirrorReach = Math.max(mirrorReach, (loc.r[4] - p.x) * S); } }
    const rect = i => { const s = g.snapshot, e = s.enemies[i], a = g.test.romAnimOf(i); if (!a || a.fid == null) return null; const fr = F.frames[a.fid]; if (!fr) return null;
      const x0 = e.dir > 0 ? e.x + fr[5] - fr[3] : e.x - fr[5], y0 = (e.y - e.z) - fr[6]; return { x0, x1: x0 + fr[3], y0, y1: y0 + fr[4] }; };
    for (let ch = 0; ch < 6; ch++) {
      g.start(ch, 0, 'normal'); const encs = g.snapshot.plan.encounters.length;
      for (let k = 0; k < encs; k++) {
        g.start(ch, 0, 'normal'); g.step(1 / 60); g.step(1 / 60); g.test.skipTo(k); const seen = new Set();
        for (let t = 0; t < 2400; t++) {
          g.step(1 / 60); const s = g.snapshot; if (s.state !== 'play') break; const v = s.view;
          s.enemies.forEach((e, i) => {
            if (seen.has(e.id) || e.boss || e.waiting || (e.delay > 0 && !e.onstage && e.state !== 'drop')) return; seen.add(e.id); n.seen++;
            if (e.type === 'raider' && e.v === 'B' && e.state === 'fly') return;
            const tag = e.setPiece ? 'setPiece' : e.state === 'drop' ? 'drop' : (e.state === 'enter' || !e.onstage) ? 'side' : null; if (!tag) return; n[tag]++;
            let r = rect(i);
            if (!r && e.type === 'mirror') { n.mirror++; const x = e.x - (e.dir > 0 ? -mirrorReach : mirrorReach); r = { x0: Math.min(e.x, x), x1: Math.max(e.x, x), y0: e.y - e.z - 1, y1: e.y - e.z }; if (!mirrorReach) return; }
            if (!r) { bad.push(`ch${ch + 1} enc${k} ${e.type}:${e.v} ${tag}: no frame to measure`); return; }
            if (r.x0 < v.x + v.w && r.x1 > v.x && r.y0 < v.y + v.h && r.y1 > v.y) bad.push(`ch${ch + 1} enc${k} t${t} ${e.type}:${e.v} ${tag} ${e.state} drawn [${(r.x0 - v.x).toFixed(0)},${(r.x1 - v.x).toFixed(0)}]x[${(r.y0 - v.y).toFixed(0)},${(r.y1 - v.y).toFixed(0)}] in the view`);
          });
          if (t % 45 === 44) s.enemies.forEach((e, i) => { if (!e.boss && !e.dead && !e.dying && e.onstage && !e.setPiece && e.state !== 'enter' && e.state !== 'drop') g.test.damageEnemy(i, 99999); });
          if (!s.lock && t > 200 && !s.enemies.some(e => !e.dead)) break;
        }
        if (bad.length > 20) break;
      }
    }
    const note = `${n.seen} arrivals: ${n.side} side (${n.mirror} copies, reach ${Math.round(mirrorReach)}), ${n.drop} drops, ${n.setPiece} set pieces`;
    return bad.length ? bad.slice(0, 6).join(' | ') + ` (+${Math.max(0, bad.length - 6)}) [${note}]` : (n.side > 300 && n.drop > 0 && n.setPiece > 0) || `too few arrivals measured [${note}]`;
  }));

  // Hero height ≈ 35% of the screen: the drawn bbox of Jack idle equals the record height × scale × 2.
  await C.gated('G1', 'Jack idle is drawn at record height ×2 (about 35% of the screen)', G1, g1why, async () => {
    // From G2 the stage pages load lazily per chapter (two stay decoded): wait for chapter 1's, so no page arrives between
    // the two renders and the diff holds only the hero.
    const meta = await ev(async () => { if (window.SEQUEL_RENDER && typeof SEQUEL_RENDER.loadChapter === 'function') await SEQUEL_RENDER.loadChapter(0); const g = LAST_EDEN; g.start(0, 1, 'easy'); AT.move(AT.view().x + 150, AT.M()); g.render(); const s = g.snapshot, v = s.view;
      let rec = null, h = null; if (s.player.anim && s.player.anim.rec != null) rec = s.player.anim.rec;
      if (window.ARCADE_HEROES && ARCADE_HEROES.frames) { const fr = rec != null ? ARCADE_HEROES.frames.find(f => f.rec === rec) : ARCADE_HEROES.frames[ARCADE_HEROES.heroes.jack.idle[0]]; if (fr) h = fr.h; }
      const scale = (window.COMBAT_CONFIG && COMBAT_CONFIG.sockets && COMBAT_CONFIG.sockets.scale) || 1;
      return { feetX: (s.player.x - v.x) * 2, feetY: (s.player.y - v.y) * 2, recH: h, scale, px: g.units.px, rec }; });
    const a = await A.grab(page);
    await ev(() => { AT.move(AT.view().x + 150 + 120, AT.M()); LAST_EDEN.render(); });
    const b = await A.grab(page);
    const d = A.img.diff(a, b, 16), roi = [Math.round(meta.feetX - 80), 0, 160, Math.round(meta.feetY) + 1];
    const box = A.img.bbox(d.mask, d.image.width, d.image.height, roi);
    if (!box) return 'the player is not visible in the render (no pixel changed when moved)';
    const expected = meta.recH ? meta.recH * meta.scale * meta.px : null, frac = box.h / a.height;
    const ok = frac > 0.3 && frac < 0.42 && (expected === null || Math.abs(box.h - expected) <= 4);
    return ok || `drawn height ${box.h} canvas px (${(frac * 100).toFixed(1)}% of ${a.height}), expected ${expected} from record ${meta.rec} h ${meta.recH} × ${meta.scale} × ${meta.px}`;
  });

  // ---------------------------------------------------------------- G2 foreground pass (http only)
  await C.gated('G2', 'A foreground (fg) stage pixel covers the player sprite', S.G2 && http, http ? 'stage-render.js + STAGE_DATA pages (G2)' : 'http (file:// taints the canvas)', async () => {
    const pick = await page.evaluate(async () => {
      const g = LAST_EDEN, CH = STAGE_DATA.chapters || {}, ids = Object.keys(CH).sort();
      for (let ci = 0; ci < ids.length; ci++) {
        const ch = CH[ids[ci]]; for (let ai = 0; ai < (ch.areas || []).length; ai++) {
          const ar = ch.areas[ai]; if (!ar.fg || !ar.fg.length || ar.stub) continue;
          if (typeof SEQUEL_RENDER.loadChapter === 'function') { try { await SEQUEL_RENDER.loadChapter(ci); } catch (e) { /* pages may already be in */ } }
          for (const [col, row] of ar.fg) {
            const im = new Image(); im.src = `${ar.dir}fg-${col}-${row}.png`;
            const ok = await new Promise(r => { im.onload = () => r(true); im.onerror = () => r(false); }); if (!ok) continue;
            const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0);
            const data = cx.getImageData(0, 0, cv.width, cv.height).data, page = ar.page || 1024;
            for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) {
              const q = (y * cv.width + x) * 4; if (data[q + 3] !== 255) continue;
              const ax = col * page + x, ay = row * page + y; let b = null; try { b = STAGE.bandAt(ai, ax); } catch (e) { try { b = STAGE.bandAt(ar.id, ax); } catch (e2) { b = null; } }
              if (!b) continue; const top = Array.isArray(b) ? b[0] : b.top, bottom = Array.isArray(b) ? b[1] : b.bottom;
              const feet = Math.min(bottom, Math.max(top, ay + 40)); if (feet - ay < 12 || feet - ay > 70) continue;
              if (ax < 40 || ax > ar.w - 40) continue;
              return { chapter: ci, area: ai, ax, ay, feet, rgb: [data[q], data[q + 1], data[q + 2]], file: im.src };
            }
          }
        }
      }
      return null;
    });
    if (!pick) return 'no area with an opaque fg pixel over the band was found in STAGE_DATA';
    const placed = await ev(pick => { const g = LAST_EDEN; g.start(pick.chapter, 1, 'easy');
      const encs = g.snapshot.plan.encounters; let best = -1; encs.forEach((e, k) => { if ((e.area === undefined || e.area === pick.area) && e.x <= pick.ax + 200 && (best < 0 || e.x > encs[best].x)) best = k; });
      if (best >= 0) { g.test.skipTo(best); for (let i = 0; i < 5; i++) g.step(1 / 60); g.test.clearFighters(); for (let i = 0; i < 10; i++) g.step(1 / 60); }
      g.test.move(pick.ax, pick.feet, pick.area); for (let i = 0; i < 90; i++) g.step(1 / 60); g.test.move(pick.ax, pick.feet, pick.area); g.render();
      const s = g.snapshot, v = s.view; return { sx: (pick.ax - v.x) * 2, sy: (pick.ay - v.y) * 2, visible: pick.ax >= v.x && pick.ax < v.x + v.w && pick.ay >= v.y && pick.ay < v.y + v.h, area: s.area && s.area.index, px: s.player.x, py: s.player.y }; }, pick);
    if (!placed.visible) return `the fg pixel at area ${pick.area} (${pick.ax},${pick.ay}) is outside the view after placing the player (${JSON.stringify(placed)})`;
    const a = await A.grab(page);
    await ev(pick => { LAST_EDEN.test.move(pick.ax - 150, pick.feet, pick.area); LAST_EDEN.render(); }, pick);
    const b = await A.grab(page);
    const at = (im, x, y) => { const q = (Math.round(y) * im.width + Math.round(x)) * 4; return [im.rgba[q], im.rgba[q + 1], im.rgba[q + 2]]; };
    const p1 = at(a, placed.sx, placed.sy), p2 = at(b, placed.sx, placed.sy), same = p1.every((c, i) => Math.abs(c - p2[i]) <= 2);
    const d = A.img.diff(a, b, 16), moved = A.img.bbox(d.mask, d.image.width, d.image.height, [Math.max(0, placed.sx - 300 - 100), 0, 200, a.height]);
    const fgMatch = p1.every((c, i) => Math.abs(c - pick.rgb[i]) <= 8);
    return (same && !!moved) || `pixel under fg with player ${p1} / without ${p2} (fg page colour ${pick.rgb}, match ${fgMatch}); player visible elsewhere: ${!!moved}`;
  }, { env: !http });

  // ---------------------------------------------------------------- G3b palette maps, not CSS filters
  // G3a puts HeroRig behind the player only; G3b redraws clones and allies through palette maps ('mirror-<id>' /
  // 'freed-<id>') and deletes CLONE_FILTER/ALLY_FILTER (PLAN §7). The row therefore waits for 3b's signature in a ch6
  // clone-war render: either no ctx.filter is set at all, or a mirror-/freed- map reaches HeroRig.draw/parts or
  // SPRITES.canvasFor. While clones still go through CSS filters and no palette map is in sight (3a) it is a SKIP,
  // so the suite stays green after each sub-step; ARCADE_STEP=G3b (or G3) makes the SKIP a failure.
  const g3 = !S.G3 ? null : await ev(() => {
    const g = LAST_EDEN, proto = CanvasRenderingContext2D.prototype, d = Object.getOwnPropertyDescriptor(proto, 'filter'); let n = 0, maps = 0; const seen = new Set(), restore = [];
    if (d && d.set) { Object.defineProperty(proto, 'filter', { configurable: true, get() { return d.get.call(this); }, set(v) { if (v && v !== 'none') { n++; seen.add(String(v)); } d.set.call(this, v); } }); restore.push(() => Object.defineProperty(proto, 'filter', d)); }
    const isMap = a => typeof a === 'string' ? /^(mirror|freed)-/.test(a) : !!a && typeof a === 'object' && !(a instanceof CanvasRenderingContext2D) && !(a instanceof Node) && (Array.isArray(a) ? a.slice(0, 8) : Object.values(a)).some(v => typeof v === 'string' ? /^(mirror|freed)-/.test(v) : !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).some(w => typeof w === 'string' && /^(mirror|freed)-/.test(w)));
    const spy = (obj, names) => { for (const k of names) { if (!obj || typeof obj[k] !== 'function') continue; const o = obj[k]; obj[k] = function (...a) { if (a.some(isMap)) maps++; return o.apply(this, a); }; restore.push(() => { obj[k] = o; }); } };
    spy(window.HeroRig, ['draw', 'parts']); spy(window.HeroRig && window.HeroRig.prototype, ['draw', 'parts']); spy(window.SPRITES, ['canvasFor', 'colourise', 'colorise', 'colorize', 'sheet']);
    try {
      g.start(5, 0, 'easy', 4); AT.move(AT.view().x + 120, AT.M());
      for (const [t, dx, f] of [['mirror', 90, .3], ['mirror', 140, .7], ['brute', 200, .5], ['gunner', 240, .2]]) AT.spawn(t, AT.view().x + dx, AT.lane(f));
      try { g.test.freeClones(2); } catch (e) { /* optional */ }
      for (let i = 0; i < 30; i++) g.step(1 / 60); g.render();
      g.test.damagePlayer(5); for (let i = 0; i < 3; i++) g.step(1 / 60); g.render();
    } finally { for (const r of restore.reverse()) r(); }
    const s = g.snapshot; return { filters: n, seen: [...seen].slice(0, 4), maps, spied: !!(d && d.set), mirrors: s.enemies.filter(e => e.type === 'mirror').length, allies: (s.allies || []).length };
  });
  const g3b = !!g3 && (g3.filters === 0 || g3.maps > 0);
  await C.gated('G3b', 'No ctx.filter is set while rendering a ch6 clone-war frame (mirror/freed/flash are palette maps)', g3b,
    S.G3 ? `clones and allies are still drawn with CSS filters and no mirror-/freed- palette map reached HeroRig or SPRITES (G3b; ${g3.filters} filter sets over ${g3.mirrors} mirrors + ${g3.allies} allies)` : 'hero-rig.js (G3)',
    () => g3.filters === 0 || `${g3.filters} filter sets with ${g3.maps} palette-map calls: ${g3.seen.join(' ; ')}`);

  // G3b also moves the copies onto their hero's ROM clips (HEROES §8.2) and the Cadillac onto the ROM car (WP-J, §9.1).
  // Both rows wait for 3b's own traces - the snapshot's per-clone `rig` and LAST_EDEN.test.art - so they are SKIPs on a
  // 3a tree and failures from ARCADE_STEP=G3b on.
  const clones = !S.G3 ? null : await ev(() => {
    const g = LAST_EDEN, R = window.HeroRig, ids = R && R.data && R.data.gameOrder; if (!ids) return null;
    g.start(5, 0, 'easy', 4); AT.move(AT.view().x + 120, AT.M());
    for (const [t, dx, f] of [['mirror', 90, .3], ['mirror', 160, .7]]) AT.spawn(t, AT.view().x + dx, AT.lane(f));
    try { g.test.freeClones(2); } catch (e) { /* optional */ }
    const roles = new Set(), bad = []; let n = 0;
    for (let i = 0; i < 300; i++) {
      g.step(1 / 60); if (i % 6) continue; g.render(); const s = g.snapshot;
      for (const f of [...s.enemies.filter(e => e.type === 'mirror'), ...(s.allies || [])]) {
        if (!('rig' in f)) return null;                                  // no per-clone clip: G3b has not landed
        const id = ids[f.hero], r = f.rig; if (!r) { bad.push(`${f.ally ? 'ally' : 'mirror'} ${id}: no clip`); continue; }
        n++; roles.add(r.role);
        const want = (f.ally ? 'freed-' : f.dissolve ? 'gel' : 'mirror-') + (f.dissolve && !f.ally ? '' : id);
        if (r.map !== want) bad.push(`${id} map ${r.map} != ${want}`);
        const c = R.clip(id, r.role); if (!c || !c.f.some(fr => fr[0] === r.rec)) bad.push(`${id} ${r.role} rec ${r.rec} is not a frame of that clip`);
        if (!(window.ROM_HEROES.rect[id] && window.ROM_HEROES.rect[id][r.rec])) bad.push(`${id} rec ${r.rec} is not on the ${id} sheet`);
      }
      if (bad.length > 8) break;
    }
    return { n, roles: [...roles], bad };
  });
  await C.gated('G3b', 'Mirror clones and freed clones play their hero\'s ROM clips (HEROES §8.2) in the mirror-<id> / freed-<id> maps', !!clones,
    S.G3 ? 'the snapshot has no per-clone `rig` (clones are not on HeroRig clips yet: G3b)' : 'hero-rig.js (G3)', () => {
      if (clones.bad.length) return clones.bad.slice(0, 5).join(' | ');
      if (clones.n < 20 || clones.roles.length < 3 || !clones.roles.includes('walk')) return `too little was seen: ${clones.n} clone frames, roles ${clones.roles.join(',')}`;
      return true;
    });
  const cadillac = !S.G3 ? null : await ev(() => {
    const g = LAST_EDEN, art = g.test && g.test.art, C = window.ROM_FX && ROM_FX.cadillac; if (!art || !C) return null;
    g.start(1, 1, 'easy', 0); for (let i = 0; i < 30; i++) g.step(1 / 60);
    const recs = [], parts = [], SP = window.SPRITES, od = SP.drawRec, oh = HeroRig.draw;
    SP.drawRec = function (gx, fam, rec, map) { recs.push(`${fam}:${rec}:${map}`); return od.apply(this, arguments); };
    HeroRig.draw = function (gx, ps) { for (const p of ps || []) parts.push(p.rec); return oh.apply(this, arguments); };
    try { g.render(); } finally { SP.drawRec = od; HeroRig.draw = oh; }
    const drive = HeroRig.clip('jack', 'drive');
    return { driving: g.snapshot.driving, recs, parts, drive: drive ? drive.f.map(f => f[0]) : [], body: [C.anims.drive[0][0], C.anims.brake[0][0]], wheels: [].concat(...C.wheels.steer), map: C.mapKey || 'S3A0' };
  });
  await C.gated('G3b', 'The Cadillac is the ROM car: body 1097/1098 and both wheels in S3A0, Jack\'s main:29 drive record on the seat', !!cadillac,
    S.G3 ? 'LAST_EDEN.test.art (the ROM car, G3b) or ROM_FX.cadillac (WP-J) is missing' : 'hero-rig.js (G3)', () => {
      const c = cadillac, has = r => c.recs.includes(`fx:${r}:${c.map}`);
      if (!c.driving) return 'chapter 2 did not start in the car';
      if (!c.body.some(has)) return `no body record drawn: ${c.recs.join(',') || 'no ROM record at all'}`;
      if (c.recs.filter(s => c.wheels.some(w => s === `fx:${w}:${c.map}`)).length < 2) return `fewer than two wheel records: ${c.recs.join(',')}`;
      if (!c.parts.some(r => c.drive.includes(r))) return `the driver is not a main:29 record (${c.drive}): parts ${c.parts.join(',')}`;
      return true;
    });

  // ---------------------------------------------------------------- G7 HUD stays in its rects
  // Equipping a gun changes the weapon panel (allowed rect) and the hero's own sprite (a window around the feet);
  // any other changed pixel is HUD drawn outside its rects. Toasts are transient cards and are not triggered here.
  await C.gated('G7', 'HUD pixels change only inside layout.hud and layout.weapon (nothing below arcade y 44 but the weapon panel)', S.G7 && http, http ? 'ROM font HUD + LAST_EDEN.layout (G7)' : 'http (file:// taints the canvas)', async () => {
    // the rows above load and release other chapters' pages: chapter 1's must be decoded again before the two renders,
    // or the stage itself changes between them (G6 note: await SEQUEL_RENDER.loadChapter(i) after releasing pages)
    await ev(async () => { await SEQUEL_RENDER.loadChapter(0); });
    const m = await ev(() => { const g = LAST_EDEN; g.start(0, 1, 'easy'); AT.move(AT.view().x + 150, AT.M()); g.test.clearFighters(); for (let i = 0; i < 5; i++) g.step(1 / 60); g.test.equip(null); g.render(); const p = AT.playerScreen(); return { L: g.layout, fx: p.x * 2, fy: p.y * 2 }; });
    const a = await A.grab(page);
    await ev(() => { LAST_EDEN.test.equip('rifle'); LAST_EDEN.render(); });
    const b = await A.grab(page);
    const d = A.img.diff(a, b, 8), W = d.image.width, H = d.image.height, L = m.L, hero = [m.fx - 120, m.fy - 220, 240, 240]; let outside = 0, inside = 0, first = null;
    const inRect = (x, y, r) => r && x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d.mask[y * W + x]) { if (inRect(x, y, L.hud) || inRect(x, y, L.weapon) || inRect(x, y, hero)) inside++; else { outside++; if (!first) first = [x, y]; } }
    if (!inside && !outside) return 'equipping a rifle changed no pixel: neither the weapon panel nor the hero was drawn';
    return outside === 0 || `${outside} changed pixels outside the HUD rects and the hero window (first at canvas ${first}), ${inside} inside`;
  }, { env: !http });

  // PLAN §7 G7: the HUD never draws below arcade y 44 except the weapon panel and transient cards (pixel rows: http only,
  // like the G2 fg row: from file:// the stage pages taint the canvas and the grab is a resampled screenshot). HUD-only renders
  // (LAST_EDEN.test.hudOnly: the screen pass over a #ff00ff key) in three states with every persistent HUD element up and
  // no transient card (no toast, radio line, caption, boss card or GO): a locked chapter-1 fight with a mission task, a
  // foe hit twice (the foe row and a combo) and a rifle; chapter 2 in the car; the chapter-1 boss after its card.
  const hudOnlyMask = async () => { const im = await A.grab(page), a = A.img.downsample(im, 2), W = a.width, H = a.height, out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const q = (y * W + x) * 4; if (!(a.rgba[q] > 240 && a.rgba[q + 1] < 16 && a.rgba[q + 2] > 240)) out.push([x, y]); } return out; };
  await C.gated('G7', 'HUD-only renders draw nothing below arcade y 44 but the weapon panel (cabinet (0,208)-(120,224)): a locked fight, the car, a boss', S.G7 && http, http ? 'ROM font HUD + LAST_EDEN.layout (G7)' : 'http (file:// taints the canvas)', async () => {
    const bad = [], seen = [];
    const scenes = [
      ['fight', () => { const g = LAST_EDEN; g.start(0, 1, 'easy'); const k = g.snapshot.plan.encounters.findIndex(e => e.task !== undefined && !e.boss); g.test.skipTo(k); for (let i = 0; i < 40; i++) g.step(1 / 60);
        const p = g.snapshot.player, e = g.test.spawnEnemy(p.x + 70, p.y, 'raider'); e.hp = e.maxhp = 5000; e.state = 'recover'; e.timer = 999; const i = g.snapshot.enemies.findIndex(x => x.id === e.id); g.test.damageEnemy(i, 5); g.test.damageEnemy(i, 5);
        g.test.equip('rifle', 4); for (let t = 0; t < 200 && g.snapshot.caption; t++) g.step(1 / 60); return { lock: !!g.snapshot.lock, foe: g.test.hud().foe && g.test.hud().foe.name, mission: !!g.snapshot.mission }; }],
      ['car', () => { const g = LAST_EDEN; g.start(1, 1, 'easy'); g.test.skipTo(1); for (let i = 0; i < 40; i++) g.step(1 / 60); for (let t = 0; t < 200 && g.snapshot.caption; t++) g.step(1 / 60); return { driving: g.snapshot.driving, lock: !!g.snapshot.lock }; }],
      ['boss', () => { const g = LAST_EDEN; g.start(0, 1, 'easy'); g.test.spawnBoss(); for (let t = 0; t < 400 && (g.snapshot.bossCard || g.snapshot.caption); t++) g.step(1 / 60); return { foe: g.test.hud().foe && g.test.hud().foe.name, card: !!g.snapshot.bossCard }; }],
    ];
    for (const [name, fn] of scenes) {
      const st = await ev(fn); await ev(() => { const g = LAST_EDEN; g.test.toast(null); g.test.say(null); g.test.hudOnly(true); g.render(); });
      const px = await hudOnlyMask(); await ev(() => LAST_EDEN.test.hudOnly(false));
      const out = px.filter(([x, y]) => !(y < 44 || (x < 120 && y >= 208))), top = px.filter(([, y]) => y < 44).length, panel = px.filter(([x, y]) => x < 120 && y >= 208).length;
      seen.push(`${name} ${JSON.stringify(st)}: ${top} top px, ${panel} panel px`);
      if (!top) bad.push(`${name}: no HUD pixel in the top rect`);
      if (out.length) bad.push(`${name}: ${out.length} px outside (first at ${out[0]})`);
    }
    if (!seen[0].includes('"lock":true') || !/foe":"[A-Z]/.test(seen[0]) || !(seen[0].match(/(\d+) panel px/)[1] > 0)) bad.push('the fight scene lacks the lock, the foe row or the weapon panel: ' + seen[0]);
    return bad.length ? bad.join(' | ') + ' || ' + seen.join(' | ') : true;
  }, { env: !http });

  // G7 (verify #1): the foe name sits in the P1 block's 13 cells (x 24-127). A 14th cell would end at x 135, against slot 2's
  // INSERT COIN at x 136/137, and the two strings would run together. Every name the foe row can show is checked: the
  // bosses (BOSS_DEFS, each chapter's level.boss, the Crown Engine), the elites of EDEN_CAMPAIGN, the ROM HUD names of the
  // enemy variants and the fallback labels; then each chapter's boss is spawned and its live foe row is read.
  await C.gated('G7', 'Every foe name the HUD can show fits the P1 block (13 cells, x 24-127, clear of slot 2 at x 136), each chapter boss live', S.G7, 'ROM font HUD (G7)', async () => {
    const r = await ev(() => { const g = LAST_EDEN, U = ARCADE_UI, names = new Set(['CROWN ENGINE']), bad = [], live = [];
      for (const d of Object.values(window.BOSS_DEFS || {})) if (d && d.name) names.add(d.name);
      const walk = o => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk); if (o.elite && o.elite.name) names.add(o.elite.name); for (const v of Object.values(o)) walk(v); };
      walk(window.EDEN_CAMPAIGN); for (const L of window.EDEN_CAMPAIGN || []) if (L.boss) names.add(L.boss);
      const E = SPRITE_DATA.families.enemies; for (const t of Object.values((E && E.types) || {})) for (const v of Object.values(t.variants || {})) if (v && v.hud && !/^\(/.test(v.hud)) names.add(v.hud);
      for (const n of ['POACHER', 'KNIFER', 'GUNNER', 'HEAVY', 'RAPTOR', 'MUTANT', 'RIDER', 'REGENT', 'BRAWLER', 'MIRROR CLONE']) names.add(n);
      const fits = s => s && U.measure(s, { font: 8 }).w <= 104;
      for (const n of names) { const h = g.test.hudName(n); if (!fits(h)) bad.push(`${n} -> ${h} (${U.measure(h, { font: 8 }).w} px)`); if (U.missing(h).length) bad.push(`${h}: no glyph for ${U.missing(h).join('')}`); }
      for (let ch = 0; ch < (window.EDEN_CAMPAIGN || []).length; ch++) { g.start(ch, 1, 'easy'); g.test.spawnBoss(); for (let t = 0; t < 600 && g.snapshot.bossCard; t++) g.step(1 / 60); const f = g.test.hud().foe;
        live.push(`ch${ch + 1} ${f && f.name}`); if (!f || !f.boss) bad.push(`ch${ch + 1}: the foe row shows no boss`); else if (!fits(f.name)) bad.push(`ch${ch + 1}: ${f.name} (${U.measure(f.name, { font: 8 }).w} px)`); }
      return { n: names.size, bad, live }; });
    return r.n < 20 ? `only ${r.n} names collected` : r.bad.length ? r.bad.join(' | ') + ' || ' + r.live.join(', ') : true;
  });
  // the same over pixels (http only, like the other G7 pixel rows): the 14-letter bosses of chapters 3-5 in the INSERT COIN
  // turn keep their name inside x 24-127, so slot 2 keeps its gap
  await C.gated('G7', 'Pixel check: the 14-letter boss names (ch3-5) end by x 127 in the INSERT COIN turn, apart from slot 2', S.G7 && http, http ? 'ROM font HUD (G7)' : 'http (file:// taints the canvas)', async () => {
    const bad = [], seen = [];
    for (const ch of [2, 3, 4]) {
      const h = await ev(ch => { const g = LAST_EDEN; g.start(ch, 1, 'easy'); g.test.spawnBoss(); for (let t = 0; t < 600 && g.snapshot.bossCard; t++) g.step(1 / 60);
        for (let i = 0; i < 260; i++) { const h = g.test.hud(); if (h.coin.call === 'INSERT COIN' && h.coin.phase % 64 > 8) break; g.step(1 / 60); }
        g.test.toast(null); g.test.say(null); g.test.hudOnly(true); g.render(); return g.test.hud(); }, ch);
      const m = A.hudMask(await A.grab(page)); await ev(() => LAST_EDEN.test.hudOnly(false));
      const b = A.hudBoxes(m.mask, m.W), row = A.img.bbox(m.mask, m.W, m.H, [128, 24, 8, 8]);
      seen.push(`ch${ch + 1} ${h.foe && h.foe.name} ${JSON.stringify(b.foeName)} slot2 ${JSON.stringify(b.slot2)}`);
      if (h.coin.call !== 'INSERT COIN') bad.push(`ch${ch + 1}: the INSERT COIN turn never showed`);
      if (!b.foeName) bad.push(`ch${ch + 1}: no foe name drawn`);
      if (row) bad.push(`ch${ch + 1}: HUD pixels at x 128-135 on the foe name row (${JSON.stringify(row)})`);
      if (b.foeName && b.slot2 && b.slot2[0] - b.foeName[2] < 8) bad.push(`ch${ch + 1}: the foe name ends ${b.slot2[0] - b.foeName[2]} px before slot 2`);
    }
    return bad.length ? bad.join(' | ') + ' || ' + seen.join(' | ') : true;
  }, { env: !http });

  // PLAN §7 G7 acceptance (§8.3 s30): the top HUD matches the cabinet within 2 px per element. The cabinet boxes are
  // tests/fixtures/hud-cabinet.json (tools/re/hud-cabinet.cjs from the live scroll1 dumps of stg-ep1-walk f16/f72: JACK.T,
  // GNEISS in the foe row, JOIN-IN, then INSERT COIN); the game shows chapter 1 with Jack and a GNEISS hit once.
  const hudFix = (() => { try { return JSON.parse(require('fs').readFileSync(require('path').join(A.ROOT, 'tests', 'fixtures', 'hud-cabinet.json'), 'utf8')); } catch (e) { return null; } })();
  await C.gated('G7', 'The top HUD matches the cabinet frame within 2 px per element (face, lives, score, name, bar, foe face/name/bar, both coin slots)', S.G7 && !!hudFix && http, !http ? 'http (file:// taints the canvas)' : hudFix ? 'ROM font HUD (G7)' : 'tests/fixtures/hud-cabinet.json missing', async () => {
    await ev(() => { const g = LAST_EDEN; g.start(0, 1, 'easy'); AT.move(AT.view().x + 150, AT.M()); g.test.clearFighters(); for (let i = 0; i < 5; i++) g.step(1 / 60);
      const p = g.snapshot.player, e = g.test.spawnEnemy(p.x + 90, p.y, 'raider'); e.v = 'B'; e.hp = e.maxhp = 10000; e.state = 'recover'; e.timer = 999;
      g.test.damageEnemy(g.snapshot.enemies.findIndex(x => x.id === e.id), 5); g.step(1 / 60); });
    const bad = [];
    for (const [turn, call] of [['join', 'JOIN-IN'], ['insert', 'INSERT COIN']]) {
      const h = await ev(call => { const g = LAST_EDEN; for (let i = 0; i < 260; i++) { const h = g.test.hud(); if (h.coin.call === call && h.coin.phase % 64 > 8) break; g.step(1 / 60); } g.test.toast(null); g.test.say(null); g.test.hudOnly(true); g.render(); return g.test.hud(); }, call);
      const m = A.hudMask(await A.grab(page)); await ev(() => LAST_EDEN.test.hudOnly(false));
      if (h.coin.call !== call) { bad.push(`${turn}: the coin call never showed ${call}`); continue; }
      if (turn === 'join' && (!h.foe || h.foe.name !== 'GNEISS')) bad.push(`join: the foe row shows ${h.foe && h.foe.name}`);
      const cmp = A.hudCompare(A.hudBoxes(m.mask, m.W), hudFix.boxes[turn], 2, turn === 'insert' ? ['face', 'lives', 'score', 'name', 'bar', 'slot2', 'slot3'] : null);
      for (const [k, r] of Object.entries(cmp)) if (!r.ok) bad.push(`${turn} ${k}: game ${JSON.stringify(r.game)} cabinet ${JSON.stringify(r.cab)} (${r.d == null ? 'missing' : r.d + ' px'})`);
    }
    return bad.length ? bad.join(' | ') : true;
  }, { env: !http });

  await browser.close();
  A.finish(C, errors, { extra: { probe: P, steps: S, url: A.BASE } });
})().catch(e => { console.error(e); process.exit(1); });
