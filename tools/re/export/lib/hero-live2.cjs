// Live summaries for the second pass of the heroes export: team-up moves, the victory pose and its catchphrase
// bubble, the Cadillac seat at the EPISODE 2 / 4 starts, first-frame timing of started animations, carried containers.
// Every number comes from the runs named in the result (work/re/runs/<run>/).
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../../rom.cjs');
const L = require('./live.cjs');
const M = require('./model.cjs');
const { u16, s16, u32, prg } = R;
const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();
const KEYS = ['jack', 'mustapha', 'hannah', 'mess'];
const exists = run => fs.existsSync(path.join(L.RUNS, run, 'frames.jsonl'));
const hookLines = run => { const f = path.join(L.RUNS, run, 'hook.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : []; };

// ------------------------------------------------------------------------------------------------ first frame
// For every live start (lib/labels.cjs rules): how long the first frame stayed before the driver advanced to the
// anim's second frame, minus its duration byte.
function firstFrame(events, heroesStatic) {
  const hx = s => parseInt(s, 16);
  const byHero = heroesStatic.map(h => { const m = new Map(); for (const l of h.lists) for (const an of l.anims) if (!an.terminator) an.frames.forEach((f, i) => { const a = hx(f.addr); if (!m.has(a)) m.set(a, { f, i, an }); }); return m; });
  const by = {}, tot = { starts: 0, histogram: {} };
  for (const r of events) {
    const evs = r.events.filter(e => e.tap === 'fp'); let last = null;
    for (let k = 0; k < evs.length; k++) {
      const e = evs[k], prev = last; last = e.value;
      if (!e.start || !e.start.length || prev === e.value) continue;
      let n = k + 1; while (n < evs.length && evs[n].value === e.value) n++; if (n >= evs.length) continue;
      const info = byHero[r.hero].get(hx(e.value)); if (!info || info.i !== 0) continue;
      const succ = info.an.frames[1] ? hx(info.an.frames[1].addr) : (info.an.loopTo ? hx(info.an.loopTo) : null);
      if (hx(evs[n].value) !== succ) continue;
      const d = (evs[n].f - e.f) - (info.f.dur || 256), c = hex(hx(e.caller));
      const o = by[c] = by[c] || { starts: 0, histogram: {} }; o.starts++; o.histogram[d] = (o.histogram[d] || 0) + 1;
      tot.starts++; tot.histogram[d] = (tot.histogram[d] || 0) + 1;
    }
  }
  const rows = Object.entries(by).sort((a, b) => b[1].starts - a[1].starts).map(([caller, o]) => {
    const mode = +Object.entries(o.histogram).sort((a, b) => b[1] - a[1])[0][0];
    return { caller, starts: o.starts, heldMinusDur: o.histogram, usual: mode };
  });
  return {
    rule: 'A newly started animation shows its first frame for dur - 1 frames in most code paths: the state handler that starts it (0x13A0..0x13CC -> 0x143E sets +0x2F = dur) ticks it (0x1426) in the same frame. Paths that start an anim and return without ticking show dur frames (usual 0 below). Later frames and loop targets always last exactly dur (V15). Positive values are the game logic holding a frame (charge, combo window, landing).',
    totals: tot, byCaller: rows,
    method: 'write taps on +0x28 in every ex-heroes-* run: frames from the start write to the write of the second frame, minus the first frame\'s duration byte',
  };
}

// ------------------------------------------------------------------------------------------------ team-up
// 0x6710 (per frame, every player): two players standing idle (+0xA0 == 0, +0x05 == 0, not carrying, not in a
// special state) within 32 px in x and 0..15 px in depth for 90 frames (+0xC2 countdown from 0x5A) -> 0x686E:
// the initiator gets ground state 0x1A (main 15), the partner the state bytes (+0x06, +0x07) of table 0x6902 row =
// initiator id (8 bytes per row, the same pair 4 times): Jack 02 04 (team-up run), Mustapha 04 24, Hannah 04 22,
// Mess 04 26; the bubble 0x61F6 shows the initiator's team line. While the initiator's frame byte b4 is 0, 0x6922
// attaches the partner: offset table long [0x6994 + initiator id*16 + partner id*4] indexed by the initiator's frame
// byte b5 (4 bytes per entry: dx, dh); x mirrored by the initiator's facing, depth = initiator depth - 1, facing =
// initiator facing, partner anim restarted at frame b5 (0x13EA). Initiator b4 != 0 releases the partner.
function teamUp(heroesStatic) {
  const states = [0, 1, 2, 3].map(c => ({ initiator: KEYS[c], partnerState: `2.0.${prg[0x6902 + c * 8].toString(16)}.${prg[0x6902 + c * 8 + 1].toString(16)}` }));
  const partnerAnim = { '2.0.2.4': 'main:23 (team-up run, then main 25)', '2.0.4.24': 'main:26', '2.0.4.22': 'main:27', '2.0.4.26': 'main:28' };
  const lines = { 0: "Let's go!", 1: "Let's roll!", 2: 'Jump!', 3: "Let's fly!" };
  const offsets = [];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    if (a === b) continue;
    const t = u32(0x6994 + a * 16 + b * 4), ini = heroesStatic[a].lists[0].anims[15];
    const n = Math.max(...ini.frames.map(f => f.b5)) + 1;
    offsets.push({ initiator: KEYS[a], partner: KEYS[b], table: hex(t), byInitiatorB5: Array.from({ length: n }, (_, k) => ({ b5: k, dx: s16(t + k * 4), dh: s16(t + k * 4 + 2) })) });
  }
  // live: both players dumped every frame in ex-heroes-team-<p1>-<p2>
  const live = [];
  for (const o of offsets) {
    for (const [run, P, Q] of [[`ex-heroes-team-${o.initiator}-${o.partner}`, 0xFFB274, 0xFFB3F4], [`ex-heroes-team-${o.partner}-${o.initiator}`, 0xFFB3F4, 0xFFB274]]) {
      if (!exists(run)) continue;
      let checked = 0, exact = 0, first = null;
      for (const fr of L.readRun(run)) {
        if (!fr.mem) continue; const m = L.mem(fr);
        if (!m.has(Q + 0x90)) continue;
        if (m.b(P + 7) !== 0x1A || m.b(P + 0x2C) !== 0 || m.w(Q + 0x70) !== (P & 0xFFFF)) continue;
        const qs = `${m.b(Q + 4).toString(16)}.${m.b(Q + 5).toString(16)}.${m.b(Q + 6).toString(16)}.${m.b(Q + 7).toString(16)}`;
        if (!Object.keys(partnerAnim).includes(qs) || m.b(Q + 0x90) !== 2) continue;   // +0x90 == 2: attached (0x1B11C / 0x1A354 ...)
        const e = o.byInitiatorB5[m.b(P + 0x2D)]; if (!e) continue;
        checked++;
        const ex = m.sw(P + 8) + (m.b(P + 0x24) ? -e.dx : e.dx), eh = m.sw(P + 0xC) + e.dh;
        if (ex === m.sw(Q + 8) && eh === m.sw(Q + 0xC) && m.sw(Q + 0x10) === m.sw(P + 0x10) - 1) exact++; else if (!first) first = { f: fr.f, expect: [ex, eh], ram: [m.sw(Q + 8), m.sw(Q + 0xC)] };
      }
      if (checked) live.push({ run, initiator: o.initiator, partner: o.partner, framesAttached: checked, positionExact: exact, firstMiss: first || undefined });
    }
  }
  return {
    trigger: '0x6710: two idle players (no input, not carrying a container, +0x05 == 0) within |dx| < 32 and 0 <= depth difference < 16 for 90 frames (+0xC2 = 0x5A countdown); the one whose countdown ends first is the initiator',
    initiatorAnim: 'main:15 (ground state 0x1A, 0x19A7C), then +0xEC = 0xB4 (180 frames invulnerable)',
    partnerStateTable: { at: '0x6902', rows: states.map(s => ({ ...s, anim: partnerAnim[s.partnerState], line: lines[KEYS.indexOf(s.initiator)] })) },
    attach: { at: '0x6922', offsets: '0x6994', rule: 'while the initiator\'s frame b4 == 0: partner x = initiator x + dx (negated when the initiator faces right), height = initiator height + dh, depth = initiator depth - 1, facing = initiator facing, partner anim restarted at frame index = initiator b5 (0x13EA); released when the initiator\'s frame b4 != 0', tables: offsets },
    bubble: 'the initiator\'s team line (0x61F6, subtype byte [0x6244 + id]): Jack "Let\'s go!", Mustapha "Let\'s roll!", Hannah "Jump!", Mess "Let\'s fly!"; shown at once (+0x5C = 1) for 120 frames',
    live: { runs: live, note: 'ex-heroes-team-<p1>-<p2> (P2 joins with coin 2, the hook puts P1 next to P2; the second round swaps the roles). Checked: frames where the initiator is in state 0x1A with frame b4 == 0 and the partner in its team state.' },
  };
}

// ------------------------------------------------------------------------------------------------ victory + bubbles
function bubblesLive(runs, J, BUB) {
  const out = [];
  for (const run of runs) {
    if (!exists(run)) continue;
    const hook = hookLines(run).filter(x => x.bubble);
    const frames = L.readRun(run), byF = new Map(frames.map(f => [f.f, f]));
    const groups = new Map();
    for (const b of hook) { const g = groups.get(b.bubble + ':' + b.sub) || []; g.push(b); groups.set(b.bubble + ':' + b.sub, g); }
    for (const [k, g] of groups) {
      // split into separate lives (gap > 1 frame)
      let life = [g[0]];
      const lives = [life];
      for (let i = 1; i < g.length; i++) { if (g[i].n !== g[i - 1].n + 1) { life = []; lives.push(life); } life.push(g[i]); }
      for (const lv of lives) {
        const spawn = lv[0], last = lv[lv.length - 1];
        // shown = the bubble's record is in the OBJ list built from that frame (dumped at n + 1); the hook's "st" is +0x04
        const inObj = b => { const f1 = byF.get(b.n + 1); if (!f1 || !f1.obj) return null; const codes = []; M.place(R.prg.readUInt16BE(b.fp >>> 0) >> 2, 192, 112, false, null, 'b', codes); const c0 = codes.map(x => x.code);
          for (let i = 0; i + c0.length <= f1.obj.length; i++) { let ok = true; for (let c = 0; c < c0.length; c++) if (f1.obj[i + c].code !== c0[c]) { ok = false; break; } if (ok) return f1.obj.slice(i, i + c0.length); } return null; };
        const shownList = lv.filter(b => inObj(b)), shown = shownList[0];
        const owner = (spawn.holder || 'B274').toUpperCase(), P = 0xFF0000 | parseInt(owner, 16);
        const fr = byF.get(spawn.n) || byF.get(spawn.n - 1);
        let rel = null, ownerB4 = null;
        if (fr && fr.mem) { const m = L.mem(fr); if (m.has(P + 8)) rel = [spawn.x - m.sw(P + 8), spawn.h - m.sw(P + 0xC), spawn.d - m.sw(P + 0x10)]; }
        if (shown) { const f2 = byF.get(shown.n); if (f2 && f2.mem) { const m = L.mem(f2); if (m.has(P + 0x2C)) ownerB4 = m.b(P + 0x2C); } }
        const rec = R.prg.readUInt16BE(spawn.fp >>> 0) >> 2;
        // pixels: the bubble's OBJ entries (dumped at f + 1) vs its record placed from RAM x/h/depth
        let px = { union: 0, same: 0, frames: 0 };
        for (const b of shownList) {
          const f0 = byF.get(b.n), f1 = byF.get(b.n + 1); if (!f0 || !f0.mem || !f1 || !f1.obj) continue;
          const m = L.mem(f0); if (!m.has(0xFF8748)) continue;
          const cam = { x: m.sw(0xFF8744), y: m.sw(0xFF8748) }, blocks = [];
          M.place(R.prg.readUInt16BE(b.fp >>> 0) >> 2, b.x - cam.x, cam.y - (b.d + b.h) + 240, false, null, 'bubble', blocks);
          const mm = inObj(b) || [];
          const cmp = M.compareBufs(M.rasterise(blocks), M.rasterise(mm)); px.union += cmp.union; px.same += cmp.same; px.frames++;
        }
        out.push({ run, slot: k.split(':')[0], subtype: spawn.sub, rec, text: BUB.TEXT[rec], spawnedAt: spawn.n, firstShown: shown ? shown.n : null, ownerFrameB4WhenShown: ownerB4, lastFrame: last.n, lastShown: shownList.length ? shownList[shownList.length - 1].n : null, framesShown: shownList.length, fromOwner: rel, ownerSlot: hex(P), pixels: px });
      }
    }
  }
  return out;
}
function victory(J, events, BUB) {
  const runs = KEYS.map(k => `ex-heroes-victory-${k}`).filter(exists);
  const starts = [];
  for (const r of events.filter(e => runs.includes(e.run))) for (const e of r.events) if (e.start && e.start.length && ['0x199c8', '0x19a18'].includes(e.caller)) starts.push({ run: r.run, f: e.f, anims: e.start, state: e.state });
  const states = [];
  for (const run of runs) {
    let prev = null, seq = [];
    for (const fr of L.readRun(run)) { if (!fr.mem) continue; const m = L.mem(fr), P = L.P1; const s = [4, 5, 6, 7].map(o => m.b(P + o).toString(16)).join('.'); if (s !== prev) { seq.push(`f${fr.f} ${s} h${m.sw(P + 0xC)}`); prev = s; } }
    states.push({ run, stateSequence: seq.slice(0, 16) });
  }
  return {
    entry: '0x19996 (ground state 0x18): from idle when +0x10E is set (0x19176, the extra-life flag set at 0x6BCC when the score passes the next threshold) or from the stage-clear check 0x1E200 (every present player, 0xFF8503 = 1)',
    choice: '+0x10E set: main 14, no bubble (extra life); else +0xC0 set (this player defeated the boss: 0x6148 called by the boss handlers): catchphrase bubble 0x6192 (one of two lines, random bit) + main 14; else main 17 (stage clear for the other players)',
    jump: 'with main 14, Mustapha (0x1ADA6, state 2.0.4.18) and Hannah (0x1AE62, state 2.0.4.1A) jump: vh 3.0 (+0x16 = 0x300), gravity -0x45 / 256 per frame (0x1ADC6); Jack and Mess pose on the ground',
    after: 'when the pose ends: back to idle unless the stage is clearing (0xFF8503); the extra-life path ends with 0x18C1E and 180 frames of invulnerability (+0xEC = 0xB4)',
    live: { runs, method: 'a MAME read tap on P1 +0x10E answers 1 to the test at 0x19176 once (RAM stays 0): frame 30 with +0xC0 = 1 (bubble path), frame 300 with +0xC0 = 0 (main 17 path)', starts, states, bubbles: bubblesLive(runs, J, BUB) },
  };
}

// ------------------------------------------------------------------------------------------------ the Cadillac seat
function car(events) {
  const runs = ['ex-heroes-car-e2-jack', 'ex-heroes-car-e4-jack', 'ex-heroes-car-e3-mustapha'].filter(exists);
  const out = [];
  for (const run of runs) {
    const r = events.find(e => e.run === run); if (!r) continue;
    const seat = r.events.find(e => e.start && e.start.includes('main:29'));
    const out1 = seat ? r.events.find(e => e.f > seat.f && e.start && e.start.length && e.caller !== '0x18e78') : null;
    let path0 = null;
    if (seat) {
      const fr = L.readRun(run).filter(f => f.mem && f.f >= seat.f && (!out1 || f.f <= out1.f));
      const xs = fr.map(f => { const m = L.mem(f); return [f.f, m.sw(L.P1 + 8), m.sw(L.P1 + 0xC), m.sw(L.P1 + 0x10), m.b(L.P1 + 1)]; });
      path0 = { first: xs[0], last: xs[xs.length - 1], drawnFrames: xs.filter(x => x[4]).length, frames: xs.length };
    }
    out.push({ run, seatedAt: seat ? seat.f : null, seatedState: seat ? seat.state : null, jumpOut: out1 ? { f: out1.f, anims: out1.start, caller: out1.caller, state: out1.state } : null, heroPath: path0 });
  }
  return {
    anim: 'main:29 (records Jack 2700, Mustapha 2696/2697, Hannah 2698/2699, Mess 2701): the hero seen in the driver seat',
    code: '0x18AB6 (player init, +0x05 = 0): area 0 of EPISODE 2 or 4 (stage byte 1 / 3): the first present player gets main 29, +0x24 = 0, +0x51 = 1, +0x25 = 0x10, state 2.0.4.32 (P2 / P3 get main 6 facing right when a lower player exists)',
    live: { runs, results: out, note: 'warpLive from stage 1: the Cadillac drives in with the seated hero; he jumps out with main 4 in state 2.0.4.32, falls (main 7) and lands (main 6). EPISODE 3 (HELL ROAD) starts on foot: in 2,200 frames the driving section was not reached, so the car object and its controls are not covered; the reference video at 03:28 shows Mustapha in the same seated pose (records 2696/2697).' },
  };
}

module.exports = { firstFrame, teamUp, victory, car, bubblesLive, hookLines };
