// End-to-end colour check: the hero, its weapon, the torch flame, bubbles and ground items composed only from the
// exported atlases (PNG colours) and heroes.json placements, compared with MAME's real screenshots (RGB). This tests
// what the per-entry pixel validation cannot: the palette colours of the atlases against the live palette RAM.
// RAM dumped at frame s-2 builds the OBJ list dumped at s-1, which MAME shows in snapshot s (H04, V05).
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../../rom.cjs');
const L = require('./live.cjs');

function loadAtlas(dir, name) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `atlas-${name}.json`), 'utf8'));
  const png = R.readPNG(fs.readFileSync(path.join(dir, meta.image)));
  return { meta, png };
}
// draw one atlas frame with its origin at screen (fx, fy) into an RGBA buffer (W x H), mirrored if facing right
function blitFrame(buf, W, H, at, fr, fx, fy, mirror, kbuf = null, kind = 0) {
  for (let j = 0; j < fr.h; j++) for (let k = 0; k < fr.w; k++) {
    const q = ((fr.y + j) * at.png.w + fr.x + k) * 4; if (!at.png.data[q + 3]) continue;
    const X = mirror ? fx + (fr.ox - k) - 1 : fx + (k - fr.ox), Y = fy + (j - fr.oy);
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const p = (Y * W + X) * 4; buf[p] = at.png.data[q]; buf[p + 1] = at.png.data[q + 1]; buf[p + 2] = at.png.data[q + 2]; buf[p + 3] = 255; if (kbuf) kbuf[Y * W + X] = kind;
  }
}
const KIND = { 1: 'hero', 2: 'weapon', 3: 'torch flame', 4: 'ground item', 5: 'bubble' };
const pieces = f => f.parts ? f.parts.map(p => [p.rec, p.dx, p.dy]) : [[f.rec2, 0, 0], [f.rec, 0, 0]].filter(x => x[0] != null);

// opts: {J, dir, hero, stagepal: {slot: 'E2a2'} (use atlas-stagepal for those slots), items: true}
function checkRun(run, { J, dir, hero, area = null, crops = 0, cropDir = null }) {
  const W = 384, H = 224, P = L.P1;
  const at = {}; for (const k of ['jack', 'mustapha', 'hannah', 'mess', 'weapons', 'bubbles', 'stagepal']) at[k] = loadAtlas(dir, k);
  const byRec = (k, rec, pred = () => true) => at[k].meta.frames.find(f => f.rec === rec && pred(f));
  const hj = J.heroes[hero], idx = new Map();
  for (const [k, l] of Object.entries(hj.lists)) for (const an of l.anims) if (an.frames) an.frames.forEach((f, i) => { const a = parseInt(f.addr, 16); if (!idx.has(a)) idx.set(a, { k, an, i, f }); });
  const FL = J.companions.torchFlame, flIdx = new Map(); for (const an of Object.values(FL.anims)) for (const f of an.frames) flIdx.set(parseInt(f.addr, 16), f);
  const frames = L.readRun(run), byF = new Map(frames.map(f => [f.f, f]));
  const snaps = fs.readdirSync(path.join(L.RUNS, run)).filter(n => /^snap-f\d+\.png$/.test(n)).map(n => +n.slice(6, 12)).sort((a, b) => a - b);
  const rows = []; let tot = { px: 0, same: 0 }, made = 0; const byKind = {};
  for (const s of snaps) {
    const fr = byF.get(s - 2); if (!fr || !fr.mem) continue;
    const m = L.mem(fr); if (!m.has(0xFF8748) || !m.b(P + 1)) continue;
    const cam = { x: m.sw(0xFF8744), y: m.sw(0xFF8748) }, scr = (x, h, d) => [x - cam.x, cam.y - (d + h) + 240];
    const objs = [];   // {d, addr, draw: buf => ...}
    const x = m.sw(P + 8), h = m.sw(P + 0xC), d = m.sw(P + 0x10), face = m.b(P + 0x24), mirror = !!face, split = m.b(P + 0x25) & 1;
    const tf = idx.get(m.l(P + 0x28)); if (!tf) continue;
    const [feetX, feetY] = scr(x, h, d), heroPieces = [];
    let bdx = 0, bdy = 0;
    if (split) { const lf = idx.get(m.l(P + 0x30)); if (!lf) continue; const bi = (lf.f.b5 << 24) >> 24, e = (lf.k === 'main' && lf.an.index === 16 ? hj.bob.entries : hj.bob.run)[bi]; bdx = e.dx; bdy = e.dy; for (const [r, dx, dy] of pieces(lf.f)) heroPieces.push([r, dx, dy]); }
    const torso = pieces(tf.f).map(([r, dx, dy]) => [r, dx + bdx, dy + bdy]);
    objs.push({ d, addr: P, kind: 1, list: torso.concat(heroPieces).map(([r, dx, dy]) => ({ at: hj.key, fr: byRec(hj.key, r), x: feetX + (mirror ? -dx : dx), y: feetY - dy, mirror })) });
    const slotW = m.w(P + 0xB4);
    if (slotW) {
      const WA = 0xFF0000 | slotW;
      if (m.has(WA + 0xA2) && m.b(WA + 5) === 8 && tf.f.hold >= 0) {
        const slot = m.w(WA + 0xA2) >> 2, set = '0x' + m.l(WA + 0x40).toString(16).toUpperCase(), he = hj.holds.entries[tf.f.hold], anim = hj.poseRows[slot].anims[tf.f.hold];
        if (he && anim >= 0) {
          const wf = J.weaponSets[set].anims[anim].frames[0], dx = he.dx + bdx, dy = he.dy + bdy;
          objs.push({ d: m.sw(WA + 0x10), addr: WA, kind: 2, list: pieces(wf).map(([r, pdx, pdy]) => ({ at: 'weapons', fr: byRec('weapons', r), x: feetX + (mirror ? -(dx + pdx) : dx + pdx), y: feetY - dy - pdy, mirror })) });
        }
      }
    }
    // pool A: the torch flame and ground items (YOROI etc.), pool D: bubbles
    if (m.has(0xFF8874 + 24 * 0xC0 - 1)) for (let k = 0; k < 24; k++) {
      const a = 0xFF8874 + k * 0xC0; if (!m.b(a) || !m.b(a + 1)) continue;
      const type = m.w(a + 0x20), [sx, sy] = scr(m.sw(a + 8), m.sw(a + 0xC), m.sw(a + 0x10)), fp = m.l(a + 0x28), mir = !!m.b(a + 0x24);
      if (type === 0x18 && flIdx.has(fp)) objs.push({ d: m.sw(a + 0x10), addr: a, kind: 3, list: [{ at: 'weapons', fr: byRec('weapons', flIdx.get(fp).rec), x: sx, y: sy, mirror: mir }] });
      if (type === 0x14 && m.b(a + 5) !== 8 && area) {   // a container on the ground: its record in this area's colours
        const rec = R.prg.readUInt16BE(fp) >> 2, f2 = byRec('stagepal', rec, f => f.areas.includes(area)) ? 'stagepal' : 'weapons';
        const fr2 = f2 === 'stagepal' ? byRec('stagepal', rec, f => f.areas.includes(area)) : byRec('weapons', rec);
        if (fr2) objs.push({ d: m.sw(a + 0x10), addr: a, kind: 4, list: [{ at: f2, fr: fr2, x: sx, y: sy, mirror: mir }] });
      }
      if (type === 0x0 && m.b(a + 5) !== 8 && fp > 0 && fp + 4 <= R.prg.length) {   // a weapon item on the ground, in flight or being picked up: its current 10-byte frame (w0 = rec*4, w1 = second rec*4 drawn under it); stage-dependent slots from atlas-stagepal in the run's area
        const w0 = R.prg.readInt16BE(fp), w1 = R.prg.readInt16BE(fp + 2);
        if (w0 >= 0) {
          const recs = w1 >= 0 ? [w1 >> 2, w0 >> 2] : [w0 >> 2];
          objs.push({ d: m.sw(a + 0x10), addr: a, kind: 4, list: recs.map(rec => { const sp = area ? byRec('stagepal', rec, f => f.areas.includes(area)) : null; return { at: sp ? 'stagepal' : 'weapons', fr: sp || byRec('weapons', rec), x: sx, y: sy, mirror: mir }; }) });
        }
      }
    }
    if (m.has(0xFF9A74 + 48 * 0x80 - 1)) for (let k = 0; k < 48; k++) {
      const a = 0xFF9A74 + k * 0x80; if (!m.b(a) || m.w(a + 0x20) !== 0x14 || !m.b(a + 1) || m.b(a + 5) === 0) continue;
      const [sx, sy] = scr(m.sw(a + 8), m.sw(a + 0xC), m.sw(a + 0x10)), rec = R.prg.readUInt16BE(m.l(a + 0x28)) >> 2;
      objs.push({ d: m.sw(a + 0x10), addr: a, kind: 5, list: [{ at: 'bubbles', fr: byRec('bubbles', rec), x: sx, y: sy, mirror: false }] });
    }
    // CPS-1 priority: smaller depth first (on top), then lower address (V03); paint from the back
    objs.sort((a, b) => (a.d - b.d) || (a.addr - b.addr));
    const buf = new Uint8Array(W * H * 4), kbuf = new Uint8Array(W * H);
    for (let i = objs.length - 1; i >= 0; i--) for (let j = objs[i].list.length - 1; j >= 0; j--) { const p = objs[i].list[j]; if (p.fr) blitFrame(buf, W, H, at[p.at], p.fr, p.x, p.y, p.mirror, kbuf, objs[i].kind); }
    const snap = R.readPNG(fs.readFileSync(path.join(L.RUNS, run, `snap-f${String(s).padStart(6, '0')}.png`)));
    let n = 0, same = 0, x0 = W, y0 = H, x1 = 0, y1 = 0; const kn = {};
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      const p = (Y * W + X) * 4; if (!buf[p + 3]) continue; n++; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      const q = (Y * snap.w + X) * 4, ok = snap.data[q] === buf[p] && snap.data[q + 1] === buf[p + 1] && snap.data[q + 2] === buf[p + 2]; if (ok) same++;
      const kk = KIND[kbuf[Y * W + X]] || 'other'; const o = kn[kk] = kn[kk] || [0, 0]; o[0]++; if (ok) o[1]++; const t2 = byKind[kk] = byKind[kk] || { px: 0, same: 0 }; t2.px++; if (ok) t2.same++;
    }
    tot.px += n; tot.same += same;
    rows.push({ s, frame: `${tf.k}:${tf.an.index}.${tf.i}`, objects: objs.length, px: n, same, agreement: n ? +(same / n).toFixed(4) : null, byKind: kn });
    if (cropDir && made < crops && n) {
      made++;
      const pad = 10, cx0 = Math.max(0, x0 - pad), cy0 = Math.max(0, y0 - pad), cw = Math.min(W, x1 + pad) - cx0, ch = Math.min(H, y1 + pad) - cy0, S = 2, OW = (cw * 3 + 8) * S, OH = ch * S, img = new Uint8Array(OW * OH * 4);
      for (let Y = 0; Y < ch; Y++) for (let X = 0; X < cw; X++) {
        const q = ((cy0 + Y) * snap.w + cx0 + X) * 4, p = ((cy0 + Y) * W + cx0 + X) * 4;
        const A2 = [snap.data[q], snap.data[q + 1], snap.data[q + 2]], B = buf[p + 3] ? [buf[p], buf[p + 1], buf[p + 2]] : [96, 96, 104];
        const C = !buf[p + 3] ? [30, 30, 36] : (A2[0] === B[0] && A2[1] === B[1] && A2[2] === B[2]) ? [140, 140, 140] : [255, 0, 255];
        [A2, B, C].forEach((col, kk) => { for (let a = 0; a < S; a++) for (let c = 0; c < S; c++) { const o = (((Y * S + a) * OW) + (kk * (cw + 4) + X) * S + c) * 4; img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; img[o + 3] = 255; } });
      }
      R.writePNG(path.join(cropDir, `snapcheck-${run.replace('ex-heroes-', '')}-f${s}.png`), OW, OH, img);
    }
  }
  for (const o of Object.values(byKind)) o.agreement = o.px ? +(o.same / o.px).toFixed(5) : null;
  return { run, snapshots: rows.length, pixels: tot.px, pixelsSame: tot.same, agreement: tot.px ? tot.same / tot.px : null, byKind, rows };
}
module.exports = { checkRun };
