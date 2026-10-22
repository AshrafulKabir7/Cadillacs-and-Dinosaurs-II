// mp-mock-game.js — a toy game behind the multiplayer adapter (work/mp/MULTIPLAYER.md §5.3), so net.js, lobby.js and
// tests/multiplayer.cjs (tier T1) run end to end before game.js is integrated (G9b).
//
// World: 384x224 arcade px. Up to 3 coloured hero boxes (slot 0..2) walk at 100 px/s (x1.68 with run), lanes at x0.64;
// attack fires a bullet (credited to the shooter's slot); three enemy boxes wander on a fixed path, lose 1 hp per bullet
// hit and come back after 1 s. Camera: the §3.6 rule (scrolls only while the leader is past the follow line and nobody
// trails off the left edge). A `time` clock in seconds. state 'lobby' | 'play'.
//
// Roles: 'off' (nothing runs), 'host' (simulates in its own rAF loop, or through MOCK_GAME.step(dt) when the page
// stubs rAF, and calls EDEN_NET.session.tick(dt) after every step), 'client' (replica: samples this page's keys at 60 Hz
// into EDEN_NET.input.Sampler frames, sends them, and draws session.view()).
//
// MOCK_GAME = { adapter, step(dt), frame(nowMs), snapshot(), role(), events[], reset() }
(function () {
  'use strict';
  const W = 384, H = 224, L = 192, BAND = [120, 200], SPEED = 100, RUN = 1.68, LANE = 0.64;
  const HEROES = [['MUSTAPHA', '#d5ec69'], ['JACK TENREC', '#7dc4de'], ['HANNAH DUNDEE', '#efaa77'], ["MESS O'BRADOVICH", '#b5cc85']];
  // Every quantiser and section kind (§1.9): g one row, p keyed by slot, e and b keyed by nid, a json field.
  const schema = {
    timeField: 'time',
    sections: {
      g: { fields: [['state', 'str'], ['time', 't'], ['camera', 'q4'], ['coins', 'i'], ['shake', 'f2'], ['lockOn', 'b'], ['banner', 'json'], ['wave', 'f1'], ['phase', 'f3']] },
      p: { key: 'slot', fields: [['slot', 'i'], ['nid', 'i'], ['hero', 'i'], ['x', 'q4'], ['y', 'q4'], ['z', 'q4'], ['dir', 'i'], ['hp', 'i'], ['score', 'i'], ['run', 'b'], ['free', 'b'], ['inv', 'f2']] },
      e: { key: 'nid', fields: [['nid', 'i'], ['type', 'str'], ['x', 'q4'], ['y', 'q4'], ['hp', 'i'], ['hurt', 'f2'], ['dead', 'b']] },
      b: { key: 'nid', fields: [['nid', 'i'], ['x', 'q4'], ['y', 'q4'], ['vx', 'q4'], ['slot', 'i']] },
    },
  };
  const W0 = () => ({ state: 'lobby', time: 0, camera: 0, coins: 0, shake: 0, lockOn: false, banner: null, wave: 0, phase: 0, players: [null, null, null], enemies: [], bullets: [] });
  let world = W0(), role = 'off', localSlot = 0, nid = 0, sampler = null, events = [], fired = [], lastFrame = null;
  const inputs = [0, 1, 2].map(() => ({ held: new Set(), presses: [] }));
  const local = { held: new Set(), presses: [] };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---- this page's keys: the host's own slot reads them directly, a joiner forwards them to the Sampler
  const KEYMAP = { KeyA: 'ArrowLeft', ArrowLeft: 'ArrowLeft', KeyD: 'ArrowRight', ArrowRight: 'ArrowRight', KeyW: 'ArrowUp', ArrowUp: 'ArrowUp', KeyS: 'ArrowDown', ArrowDown: 'ArrowDown',
    KeyJ: 'KeyJ', KeyZ: 'KeyJ', Space: 'KeyJ', KeyK: 'KeyK', KeyX: 'KeyK', KeyL: 'KeyL', KeyC: 'KeyL', KeyE: 'KeyE', KeyV: 'KeyE', ShiftLeft: 'ShiftLeft', ShiftRight: 'ShiftLeft', Enter: 'Enter' };
  const typing = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
  addEventListener('keydown', e => {
    if (typing(e)) return;
    const c = KEYMAP[e.code]; if (!c) return;
    if (role === 'client' && sampler) { sampler.keyDown(e.code, performance.now()); return; }
    if (!local.held.has(c)) local.presses.push(c);
    local.held.add(c);
  });
  addEventListener('keyup', e => {
    const c = KEYMAP[e.code]; if (!c) return;
    if (sampler) sampler.keyUp(e.code);
    local.held.delete(c);
  });
  addEventListener('blur', () => { local.held.clear(); if (sampler && sampler.setAway) sampler.setAway(true); });
  addEventListener('focus', () => { if (sampler && sampler.setAway) sampler.setAway(false); });

  const makePlayer = (slot, hero) => ({ slot, nid: ++nid, hero, x: world.camera + 64 + 40 * slot, y: 150 + (slot - 1) * 12, z: 0, dir: 1, hp: 40, score: 0, run: false, free: true, inv: 0 });
  const spawnEnemies = () => { world.enemies = [0, 1, 2].map(k => ({ nid: ++nid, type: ['brute', 'knifer', 'gunner'][k], k, x: 0, y: 0, hp: 3, hurt: 0, dead: false, back: 0 })); placeEnemies(); };
  function placeEnemies() {
    for (const e of world.enemies) { e.x = world.camera + 230 + e.k * 40 + Math.sin(world.time * 0.9 + e.k * 2) * 40; e.y = 140 + e.k * 18 + Math.cos(world.time * 0.6 + e.k) * 10; }
  }
  const sfx = (...ev) => events.push(ev);

  // ---- the host simulation (one step)
  function update(dt) {
    if (world.state !== 'play') return;
    world.time += dt; world.wave = Math.floor(world.time / 5); world.phase = (world.time % 1); world.shake = Math.max(0, world.shake - dt);
    for (const p of world.players) {
      if (!p) continue;
      const src = p.slot === localSlot ? local : inputs[p.slot], held = src.held, presses = src.presses.splice(0);
      p.run = held.has('ShiftLeft');
      const s = SPEED * (p.run ? RUN : 1);
      const dx = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0), dy = (held.has('ArrowDown') ? 1 : 0) - (held.has('ArrowUp') ? 1 : 0);
      const k = dx && dy ? 0.78 : 1;
      p.x += dx * s * k * dt; p.y += dy * s * LANE * k * dt; if (dx) p.dir = dx;
      p.inv = Math.max(0, p.inv - dt);
      for (const c of presses) {
        if (c === 'KeyJ') { world.bullets.push({ nid: ++nid, x: p.x + p.dir * 12, y: p.y, vx: 240 * p.dir, slot: p.slot, t: 0 }); sfx('sfx', 'shot'); }
        if (c === 'Enter') world.coins++;
      }
    }
    placeEnemies();
    for (const e of world.enemies) { e.hurt = Math.max(0, e.hurt - dt); if (e.dead && (e.back -= dt) <= 0) { e.dead = false; e.hp = 3; } }
    for (const b of world.bullets) {
      b.x += b.vx * dt; b.t += dt;
      for (const e of world.enemies) {
        if (e.dead || b.t > 1 || Math.abs(b.x - e.x) > 10 || Math.abs(b.y - e.y) > 10) continue;
        b.t = 9; e.hp--; e.hurt = 0.2; world.shake = 0.1;
        const p = world.players[b.slot]; if (p) p.score += 100;
        sfx('popup', e.x, e.y - 20, '+100', '#ffe08a');
        if (e.hp <= 0) { e.dead = true; e.back = 1; sfx('burst', e.x, e.y, '#eea575', 8); }
      }
    }
    world.bullets = world.bullets.filter(b => b.t < 1);
    // camera: §3.6
    const cam = world.players.filter(Boolean);
    if (cam.length) {
      const lead = Math.max(...cam.map(p => p.x)) - world.camera, trail = Math.min(...cam.map(p => p.x)) - world.camera;
      let d = 0; if (lead > 64 && lead >= L) d = (lead - trail >= L - 16) ? clamp(trail - 16, 0, 6) : Math.min(6, lead - L);
      world.camera += d;
      for (const p of cam) { p.x = clamp(p.x, world.camera + 16, world.camera + W - 17); p.y = clamp(p.y, BAND[0], BAND[1]); }
    }
    const S = window.EDEN_NET && EDEN_NET.session;
    if (S && S.role === 'host' && typeof S.tick === 'function') S.tick(dt);
  }

  // ---- the joiner's frame: sample input, draw the session's interpolated view
  function clientFrame(nowMs, dtMs) {
    const S = window.EDEN_NET && EDEN_NET.session;
    if (!S || S.role !== 'client') return;
    if (sampler) { const fr = sampler.sample(dtMs); if (fr.length) S.sendInput(fr); }
    const v = S.view(nowMs);
    if (v) adapter.applyView(v);
    if (S.dueEvents) for (const ev of S.dueEvents(nowMs)) adapter.fireEvent(ev);
  }

  const adapter = {
    build: 'mp-mock-1',
    heroes: HEROES.map(([name, color], id) => ({ id, name, color })),
    selectOrder: [1, 2, 0, 3],
    chapters: () => ['WASSOON', 'THE CORAL CAUSEWAY', 'THE VERDANT BIODOME'].map((name, index) => ({ index, name, unlocked: true })),
    difficulties: () => [{ key: 'easy', label: 'EASY' }, { key: 'normal', label: 'NORMAL' }, { key: 'hard', label: 'ARCADE MANIA' }],
    schema,
    // host
    startGame(cfg) {
      role = 'host'; localSlot = 0; world = W0(); world.state = 'play'; events = [];
      for (const r of (cfg && cfg.roster) || [{ slot: 0, hero: 0 }]) world.players[r.slot] = makePlayer(r.slot, r.hero);
      spawnEnemies();
    },
    canAdmit: () => world.state === 'play',
    addPlayer(slot, hero) { if (slot >= 0 && slot < 3) { world.players[slot] = makePlayer(slot, hero); events.push(['notice', (slot + 1) + 'P JOINED']); } },
    removePlayer(slot) { if (slot > 0 && slot < 3) world.players[slot] = null; },
    setRemoteInput(slot, f) { const i = inputs[slot]; if (!i || !f) return; i.held = f.away ? new Set() : new Set(f.held || []); for (const c of f.presses || []) i.presses.push(c); },
    remoteButton() {},
    serialize() {
      const g = world;
      return {
        g: { state: g.state, time: g.time, camera: g.camera, coins: g.coins, shake: g.shake, lockOn: g.lockOn, banner: g.banner, wave: g.wave, phase: g.phase },
        p: g.players.filter(Boolean).map(p => ({ ...p })),
        e: g.enemies.map(e => ({ nid: e.nid, type: e.type, x: e.x, y: e.y, hp: e.hp, hurt: e.hurt, dead: e.dead })),
        b: g.bullets.map(b => ({ nid: b.nid, x: b.x, y: b.y, vx: b.vx, slot: b.slot })),
      };
    },
    drainEvents() { const e = events; events = []; return e; },
    pause() {},
    stopGame() { role = 'off'; world = W0(); },
    // client
    enterReplica(cfg) {
      role = 'client'; localSlot = cfg && cfg.slot != null ? cfg.slot : 1; world = W0(); world.state = 'play';
      sampler = window.EDEN_NET && EDEN_NET.input ? new EDEN_NET.input.Sampler() : null;
      for (const c of local.held) if (sampler) sampler.keyDown(c, performance.now());
    },
    applyView(v) {
      const g = v.g || {};
      for (const k of ['state', 'time', 'camera', 'coins', 'shake', 'lockOn', 'banner', 'wave', 'phase']) if (g[k] !== undefined) world[k] = g[k];
      world.players = [null, null, null]; for (const p of v.p || []) if (p && p.slot >= 0 && p.slot < 3) world.players[p.slot] = { ...p };
      world.enemies = (v.e || []).map(e => ({ ...e })); world.bullets = (v.b || []).map(b => ({ ...b }));
    },
    fireEvent(ev) { fired.push(ev); if (fired.length > 200) fired.shift(); },
    // §1.12: today's walk rule, only while the host says the hero is free
    echoStep(row, f, dt) {
      if (!row || !row.free) return row;
      const b = f.b | 0, run = (b >> 8) & 1, dx = ((b >> 1) & 1) - (b & 1), dy = ((b >> 3) & 1) - ((b >> 2) & 1), k = dx && dy ? 0.78 : 1, s = SPEED * (run ? RUN : 1);
      const r = { ...row, x: row.x + dx * s * k * dt, y: clamp(row.y + dy * s * LANE * k * dt, BAND[0], BAND[1]) };
      if (dx) r.dir = dx;
      r.x = clamp(r.x, world.camera + 16, world.camera + W - 17);
      return r;
    },
    localInput: { attach(s) { sampler = s; }, detach() { sampler = null; } },
    exitReplica() { role = 'off'; sampler = null; world = W0(); },
  };

  // ---- drawing
  const canvas = () => document.getElementById('game');
  function draw() {
    const c = canvas(); if (!c) return; const g = c.getContext('2d'), k = c.width / W;
    g.setTransform(k, 0, 0, k, 0, 0); g.fillStyle = '#10141c'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2a3140'; g.fillRect(0, BAND[0] - 10, W, BAND[1] - BAND[0] + 20);
    const cx = Math.round(world.camera);
    g.fillStyle = '#3c4658'; for (let x = -(cx % 32); x < W; x += 32) g.fillRect(x, BAND[0] - 10, 1, BAND[1] - BAND[0] + 20);
    for (const e of world.enemies) if (!e.dead) { g.fillStyle = e.hurt > 0 ? '#fff' : '#8a8f99'; g.fillRect(e.x - cx - 8, e.y - 24, 16, 24); }
    for (const p of world.players) if (p) { g.fillStyle = (HEROES[p.hero] || HEROES[0])[1]; g.fillRect(p.x - cx - 8, p.y - 28, 16, 28); g.fillStyle = '#fff'; g.font = '8px monospace'; g.fillText((p.slot + 1) + 'P', p.x - cx - 6, p.y - 31); }
    g.fillStyle = '#ffe08a'; for (const b of world.bullets) g.fillRect(b.x - cx - 2, b.y - 14, 4, 2);
    g.fillStyle = '#fff'; g.font = '8px monospace';
    world.players.forEach((p, s) => g.fillText(p ? `${s + 1}P ${String(p.score).padStart(6, '0')}` : (s ? 'INSERT COIN' : ''), 8 + 128 * s, 10));
    g.fillText(`${role.toUpperCase()} ${world.state.toUpperCase()} T ${world.time.toFixed(2)}`, 8, H - 6);
  }

  function frame(nowMs) {
    const dtMs = lastFrame == null ? 1000 / 60 : Math.min(100, nowMs - lastFrame); lastFrame = nowMs;
    if (role === 'client') clientFrame(nowMs, dtMs);
    else if (role === 'host') { let left = dtMs / 1000; while (left > 1e-6) { const d = Math.min(left, 1 / 60); update(d); left -= d; } }
    draw();
  }
  const loop = t => { frame(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);

  window.MOCK_GAME = {
    adapter, schema,
    step(dt = 1 / 60) { if (role === 'client') clientFrame(performance.now(), dt * 1000); else update(dt); draw(); },
    frame,
    role: () => role,
    get events() { return fired.slice(); },
    snapshot: () => ({ role, localSlot, state: world.state, time: world.time, camera: world.camera, coins: world.coins,
      players: world.players.map(p => p && { ...p }), enemies: world.enemies.map(e => ({ ...e })), bullets: world.bullets.map(b => ({ ...b })) }),
    reset() { role = 'off'; sampler = null; world = W0(); events = []; fired = []; },
  };
})();
