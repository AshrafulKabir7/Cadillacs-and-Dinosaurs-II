#!/usr/bin/env node
// Scriptable MAME harness for the original Cadillacs & Dinosaurs (romset "dino").
//
//   node tools/re/mame/run.cjs <plan.json> [--dry] [--quiet]
//
// Turns a JSON plan into a self-contained Lua autoboot script (the plan is embedded as a Lua table literal),
// runs MAME 0.289 headless, and writes everything to work/re/runs/<plan.name>/ :
//   frames.jsonl   one JSON object per dumped frame (OBJ list, CPS-A/B registers, palettes, RAM ...)
//   snap-fNNNNNN.png  MAME screen snapshots (384x224, exactly what the arcade shows)
//   scroll-fNNNNNN.bin / ram-fNNNNNN.bin  optional binary dumps
//   summary.json   plan, timing, frame range, files, states saved, MAME exit code and filtered log
//   plan.lua       the generated script (kept for reproducibility)
// See tools/re/mame/README.md for the plan format, boot recipes, save states and the OBJ coordinate transform.
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '../../..');
const MAME = process.env.MAME_EXE || 'E:/tools/mame/mame.exe';
const ROMPATH = process.env.MAME_ROMPATH || 'E:/tools/mame/roms';
const STATES = process.env.MAME_STATES || 'E:/tools/mame/states';
const RUNS = path.join(REPO, 'work/re/runs');
const fwd = p => p.replace(/\\/g, '/');

// ---------- plan normalisation ----------
const num = (v, what) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\s*(0x[0-9a-f]+|\$[0-9a-f]+|-?\d+)\s*$/i.test(v)) {
    const s = v.trim(); return s[0] === '$' ? parseInt(s.slice(1), 16) : Number(s);
  }
  throw new Error(`plan: ${what} must be a number or hex string, got ${JSON.stringify(v)}`);
};

const KEY_ALIASES = {
  right: 'P1 Right', left: 'P1 Left', down: 'P1 Down', up: 'P1 Up',
  attack: 'P1 Button 1', a: 'P1 Button 1', b1: 'P1 Button 1', jump: 'P1 Button 2', b: 'P1 Button 2', b2: 'P1 Button 2',
  coin: 'Coin 1', start: '1 Player Start', service: 'Service Mode',
};

// Default coin/start timing (frames after power-on). Coins during the boot/warning screens (before ~frame 300) are
// ignored; the title shows INSERT COIN from ~320. See README "Boot recipes" for how these were found.
const COIN_START_DEFAULT = { coin: 330, start: 370, hold: 6 };

function normalise(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('plan must be a JSON object');
  if (!plan.name || !/^[A-Za-z0-9._-]+$/.test(plan.name)) throw new Error('plan.name is required ([A-Za-z0-9._-])');
  const frames = num(plan.frames, 'frames');
  if (!(frames > 0)) throw new Error('plan.frames must be > 0');
  const P = { name: plan.name, frames, inputs: [], pokes: [], snapshots: [], saves: [] };
  if (plan.loadState) P.loadState = String(plan.loadState);
  const saves = plan.saveStateAt ? (Array.isArray(plan.saveStateAt) ? plan.saveStateAt : [plan.saveStateAt]) : [];
  for (const s of saves) {
    if (!s.name || !/^[A-Za-z0-9._-]+$/.test(s.name)) throw new Error('saveStateAt.name must be [A-Za-z0-9._-]');
    P.saves.push({ frame: num(s.frame, 'saveStateAt.frame'), name: s.name });
  }
  const keyName = k => KEY_ALIASES[String(k).toLowerCase()] || String(k);
  for (const r of plan.inputs || []) {
    const from = num(r.from, 'inputs.from'), to = r.to === undefined ? from : num(r.to, 'inputs.to');
    P.inputs.push({ from, to, keys: (r.keys || []).map(keyName) });
  }
  if (plan.coinStart) {
    const c = Object.assign({}, COIN_START_DEFAULT, typeof plan.coinStart === 'object' ? plan.coinStart : {});
    P.inputs.unshift({ from: num(c.coin, 'coinStart.coin'), to: num(c.coin, 'coinStart.coin') + num(c.hold, 'hold') - 1, keys: ['Coin 1'] });
    P.inputs.unshift({ from: num(c.start, 'coinStart.start'), to: num(c.start, 'coinStart.start') + num(c.hold, 'hold') - 1, keys: ['1 Player Start'] });
  }
  for (const p of plan.pokes || []) {
    const size = p.size === undefined ? 1 : num(p.size, 'pokes.size');
    if (![1, 2, 4].includes(size)) throw new Error('pokes.size must be 1, 2 or 4');
    const from = num(p.from === undefined ? 0 : p.from, 'pokes.from');
    const rel = p.rel || null;
    if (rel && !['obj', 'pal'].includes(rel)) throw new Error('pokes.rel must be "obj" or "pal"');
    P.pokes.push({ from, to: p.to === undefined ? from : num(p.to, 'pokes.to'), addr: num(p.addr, 'pokes.addr'), size, value: num(p.value, 'pokes.value'), rel });
  }
  for (const s of plan.snapshots || []) P.snapshots.push(num(s, 'snapshots[]'));
  if (plan.snapshotEvery) {
    const e = plan.snapshotEvery, from = num(e.from || 0, 'snapshotEvery.from'), to = num(e.to === undefined ? frames - 1 : e.to, 'snapshotEvery.to'), ev = num(e.every || 60, 'snapshotEvery.every');
    for (let f = from; f <= to; f += ev) P.snapshots.push(f);
  }
  if (plan.dump) {
    const d = plan.dump;
    P.dump = {
      from: num(d.from === undefined ? 0 : d.from, 'dump.from'), to: num(d.to === undefined ? frames - 1 : d.to, 'dump.to'),
      every: num(d.every || 1, 'dump.every'), obj: d.obj !== false, cpsA: d.cpsA !== false, palette: !!d.palette,
      allPalettes: !!d.allPalettes, scroll: !!d.scroll, ramFile: !!d.ramFile, objAll: !!d.objAll,
      ram: (d.ram || []).map(r => [num(r[0], 'dump.ram start'), num(r[1], 'dump.ram len')]),
    };
  }
  P.regions = (plan.regions || []).map(r => ({ frame: num(r.frame || 0, 'regions.frame'), tag: String(r.tag), offset: num(r.offset || 0, 'regions.offset'), len: num(r.len, 'regions.len'), file: String(r.file || (String(r.tag).replace(/[^A-Za-z0-9]/g, '') + '.bin')) }));
  for (const r of P.regions) if (!/^[A-Za-z0-9._-]+$/.test(r.file)) throw new Error('regions.file must be a plain file name');
  P.stopWhen = plan.stopWhen ? { addr: num(plan.stopWhen.addr, 'stopWhen.addr'), size: num(plan.stopWhen.size || 1, 'stopWhen.size'), value: num(plan.stopWhen.value, 'stopWhen.value'), after: num(plan.stopWhen.after || 0, 'stopWhen.after') } : null;
  return P;
}

// ---------- Lua generation ----------
function lua(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('non-finite number'); return String(v); }
  if (typeof v === 'string') return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
  if (Array.isArray(v)) return '{' + v.map(lua).join(', ') + '}';
  return '{' + Object.entries(v).map(([k, x]) => `[${lua(k)}] = ${lua(x)}`).join(', ') + '}';
}

const LUA_BODY = String.raw`
-- ===== harness body (generated by tools/re/mame/run.cjs; do not edit by hand) =====
local P = PLAN
local OUT = P.out
local machine = manager.machine
local scr = machine.screens[":screen"]
local space = machine.devices[":maincpu"].spaces["program"]
local shares = machine.memory.shares
local cpsa, cpsb, gfxram = shares[":cps_a_regs"], shares[":cps_b_regs"], shares[":gfxram"]
local fmt = string.format

-- input fields by name; the player/system ports win over DIP switches on a name clash
local fields = {}
for tag, port in pairs(machine.ioport.ports) do
  for name, f in pairs(port.fields) do
    if fields[name] == nil or tag == ":IN0" or tag == ":IN1" or tag == ":IN2" then fields[name] = f end
  end
end
local used = {}
for _, r in ipairs(P.inputs) do
  for _, k in ipairs(r.keys) do
    if not fields[k] then error("unknown input field '" .. k .. "'") end
    used[k] = true
  end
end

local log = io.open(OUT .. "/lua-log.txt", "w")
local function say(...) local t = {...} for i = 1, #t do t[i] = tostring(t[i]) end local s = table.concat(t, " ") print(s) log:write(s, "\n") log:flush() end
local jf = nil
if P.dump then jf = io.open(OUT .. "/frames.jsonl", "w") end

-- gfx ram base from a CPS-A register, as MAME's cps1_base(): (reg*256) & ~(boundary-1), masked to 0x3ffff
local function gbase(reg, boundary)
  local b = (cpsa:read_u16(reg) * 256) & ~(boundary - 1)
  return b & 0x3ffff
end

local function hexrange(addr, len)
  local s = space:read_range(addr, addr + len - 1, 8)
  return (s:gsub(".", function(c) return fmt("%02X", c:byte()) end))
end

local function words_json(share, n)
  local t = {}
  for i = 0, n - 1 do t[#t + 1] = tostring(share:read_u16(i * 2)) end
  return "[" .. table.concat(t, ",") .. "]"
end

local function obj_json()
  local base = gbase(0, 0x800)
  local t, count = {}, 0
  for i = 0, 255 do
    local o = base + i * 8
    local x, y, code, attr = gfxram:read_u16(o), gfxram:read_u16(o + 2), gfxram:read_u16(o + 4), gfxram:read_u16(o + 6)
    if attr == 0xFF00 and not P.dump.objAll then break end
    count = count + 1
    local sx, sy = (x & 0x1ff) - 64, (y & 0x1ff) - 16
    if sx < -256 then sx = sx + 512 end
    if sy < -256 then sy = sy + 512 end
    t[#t + 1] = fmt('{"i":%d,"x":%d,"y":%d,"code":%d,"attr":%d,"pal":%d,"flipX":%s,"flipY":%s,"bw":%d,"bh":%d,"sx":%d,"sy":%d}',
      i, x, y, code, attr, attr & 31, (attr & 0x20) ~= 0 and "true" or "false", (attr & 0x40) ~= 0 and "true" or "false",
      ((attr >> 8) & 15) + 1, ((attr >> 12) & 15) + 1, sx, sy)
  end
  return fmt('"objBase":%d,"objCount":%d,"obj":[%s]', 0x900000 + base, count, table.concat(t, ","))
end

local function write_bin(name, addr, len)
  local f = io.open(OUT .. "/" .. name, "wb")
  f:write(space:read_range(addr, addr + len - 1, 8))
  f:close()
end

local function dump_frame(n)
  local parts = { fmt('"f":%d,"mf":%d', n, scr:frame_number()) }
  if P.dump.cpsA then
    parts[#parts + 1] = '"cpsA":' .. words_json(cpsa, 32)
    parts[#parts + 1] = '"cpsB":' .. words_json(cpsb, 32)
  end
  if P.dump.obj then parts[#parts + 1] = obj_json() end
  if P.dump.palette or P.dump.allPalettes then
    local pb = gbase(0x0A, 0x400)
    local len = P.dump.allPalettes and 0x1800 or 0x400  -- OBJ = first 32 palettes x 16 words
    parts[#parts + 1] = fmt('"palBase":%d,"pal":"%s"', 0x900000 + pb, hexrange(0x900000 + pb, len))
  end
  if P.dump.scroll then
    local s = {}
    for k = 1, 3 do
      local b = gbase(2 * k, 0x4000)
      local file = fmt("scroll%d-f%06d.bin", k, n)
      write_bin(file, 0x900000 + b, 0x4000)
      s[#s + 1] = fmt('"s%d":{"base":%d,"x":%d,"y":%d,"file":"%s"}', k, 0x900000 + b, cpsa:read_u16(0x0C + (k - 1) * 4), cpsa:read_u16(0x0E + (k - 1) * 4), file)
    end
    local rb = gbase(0x08, 0x800)
    local rfile = fmt("rowscroll-f%06d.bin", n)
    write_bin(rfile, 0x900000 + rb, 0x800)
    s[#s + 1] = fmt('"rowscroll":{"base":%d,"file":"%s"}', 0x900000 + rb, rfile)
    parts[#parts + 1] = '"scroll":{' .. table.concat(s, ",") .. '}'
  end
  if #P.dump.ram > 0 then
    local r = {}
    for _, rr in ipairs(P.dump.ram) do r[#r + 1] = fmt('"%06X":"%s"', rr[1], hexrange(rr[1], rr[2])) end
    parts[#parts + 1] = '"ram":{' .. table.concat(r, ",") .. '}'
  end
  if P.dump.ramFile then
    local file = fmt("ram-f%06d.bin", n)
    write_bin(file, 0xFF0000, 0x10000)
    parts[#parts + 1] = fmt('"ramFile":"%s"', file)
  end
  jf:write("{", table.concat(parts, ","), "}\n")
end

local function apply_inputs(n)
  local on = {}
  for _, r in ipairs(P.inputs) do
    if n >= r.from and n <= r.to then for _, k in ipairs(r.keys) do on[k] = true end end
  end
  for k in pairs(used) do fields[k]:set_value(on[k] and 1 or 0) end
end

local function apply_pokes(n)
  for _, p in ipairs(P.pokes) do
    if n >= p.from and n <= p.to then
      local a = p.addr
      -- rel "obj"/"pal": addr is an offset from the OBJ/palette base the CPS-A registers point at right now
      if p.rel == "obj" then a = 0x900000 + gbase(0, 0x800) + p.addr
      elseif p.rel == "pal" then a = 0x900000 + gbase(0x0A, 0x400) + p.addr end
      if p.size == 1 then space:write_u8(a, p.value)
      elseif p.size == 2 then space:write_u16(a, p.value)
      else space:write_u32(a, p.value) end
    end
  end
end

local function read_sized(addr, size)
  if size == 1 then return space:read_u8(addr) elseif size == 2 then return space:read_u16(addr) else return space:read_u32(addr) end
end

local snaps = {}
for _, f in ipairs(P.snapshots) do snaps[f] = true end
local saves = {}
local exit_at = P.frames
for _, s in ipairs(P.saves) do saves[s.frame] = s.name; if s.frame + 2 > exit_at then exit_at = s.frame + 2 end end

if P.loadState then
  machine:load(P.loadState)   -- scheduled: happens before the first frame below (frame 0 is the first post-load frame)
  say("load state", P.loadState)
end

local n = 0
local stopped = false
local snap_count, dump_count = 0, 0
apply_inputs(0)
apply_pokes(0)

local function on_frame()
  if stopped then return end
  if P.dump and n >= P.dump.from and n <= P.dump.to and ((n - P.dump.from) % P.dump.every) == 0 then
    dump_frame(n); dump_count = dump_count + 1
  end
  for _, r in ipairs(P.regions) do
    if r.frame == n then
      local reg = machine.memory.regions[r.tag]
      if not reg then error("unknown memory region " .. r.tag) end
      local f = io.open(OUT .. "/" .. r.file, "wb")
      local chunk = {}
      for i = 0, r.len - 1 do
        chunk[#chunk + 1] = reg:read_u8(r.offset + i)
        if #chunk == 4096 then f:write(string.char(table.unpack(chunk))); chunk = {} end
      end
      if #chunk > 0 then f:write(string.char(table.unpack(chunk))) end
      f:close()
      say("region", r.tag, "dumped to", r.file)
    end
  end
  if snaps[n] then scr:snapshot(fmt("snap-f%06d.png", n)); snap_count = snap_count + 1 end
  if saves[n] then machine:save(saves[n]); say("save state", saves[n], "at frame", n, "machine frame", scr:frame_number()) end
  if P.stopWhen and n >= P.stopWhen.after and read_sized(P.stopWhen.addr, P.stopWhen.size) == P.stopWhen.value then
    say("stopWhen hit at frame", n)
    exit_at = n + 1
    if not saves[n] then exit_at = n end
  end
  if n >= exit_at then
    stopped = true
    local s = io.open(OUT .. "/lua-summary.json", "w")
    s:write(fmt('{"lastFrame":%d,"machineFrame":%d,"dumped":%d,"snapshots":%d}', n, scr:frame_number(), dump_count, snap_count))
    s:close()
    if jf then jf:close() end
    say("exit at frame", n)
    log:close()
    machine:exit()
    return
  end
  n = n + 1
  apply_inputs(n)
  apply_pokes(n)
end

if emu.add_machine_frame_notifier then
  FRAME_SUB = emu.add_machine_frame_notifier(on_frame)
else
  emu.register_frame_done(on_frame)
end
`;

function generateLua(P, outDir) {
  return `-- Generated by tools/re/mame/run.cjs for plan "${P.name}" on ${new Date().toISOString()}\nPLAN = ${lua(Object.assign({ out: fwd(outDir) }, P))}\n${LUA_BODY}`;
}

// ---------- run ----------
// runPlan(plan, {quiet}) -> Promise<summary>. Used by main() and by other scripts (make-states.cjs, validate-obj.cjs).
function runPlan(raw, { quiet = true, dry = false } = {}) {
  const P = normalise(raw);
  const outDir = path.join(RUNS, P.name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'mame'), { recursive: true });
  fs.mkdirSync(STATES, { recursive: true });
  const luaFile = path.join(outDir, 'plan.lua');
  fs.writeFileSync(luaFile, generateLua(P, outDir));
  fs.writeFileSync(path.join(outDir, 'plan.json'), JSON.stringify(raw, null, 2));
  if (P.loadState && !fs.existsSync(path.join(STATES, 'dino', P.loadState + '.sta'))) {
    return Promise.reject(new Error(`state ${P.loadState} not found in ${STATES}/dino`));
  }
  const mameArgs = ['dino', '-rompath', ROMPATH, '-skip_gameinfo', '-nowindow', '-video', 'none', '-sound', 'none', '-nothrottle',
    '-snapshot_directory', fwd(outDir), '-state_directory', fwd(STATES),
    '-cfg_directory', fwd(path.join(outDir, 'mame/cfg')), '-nvram_directory', fwd(path.join(outDir, 'mame/nvram')),
    '-diff_directory', fwd(path.join(outDir, 'mame/diff')), '-input_directory', fwd(path.join(outDir, 'mame/inp')),
    '-autoboot_script', fwd(luaFile)];
  if (dry) { console.log(MAME, mameArgs.join(' ')); return Promise.resolve(null); }
  const t0 = Date.now();
  // generous timeout: MAME runs ~8-10x realtime here; allow 2x realtime + 60 s
  const exitFrames = Math.max(P.frames, ...P.saves.map(s => s.frame + 2));
  const timeoutMs = 60000 + (exitFrames / 60) * 500;
  return new Promise(resolve => {
    const child = spawn(MAME, mameArgs, { cwd: path.join(outDir, 'mame'), windowsHide: true });
    let log = '';
    const onData = d => { const s = d.toString(); log += s; if (!quiet) for (const line of s.split(/\r?\n/)) if (line && !/CHECKSUM|EXPECTED|FOUND|-video none|might not run/i.test(line)) process.stdout.write(line + '\n'); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const timer = setTimeout(() => { log += '\n[harness] timeout, killing MAME\n'; child.kill(); }, timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      const seconds = (Date.now() - t0) / 1000;
      let lua = null; try { lua = JSON.parse(fs.readFileSync(path.join(outDir, 'lua-summary.json'), 'utf8')); } catch (e) { /* MAME died early */ }
      const files = fs.readdirSync(outDir).filter(f => f !== 'mame');
      const summary = {
        name: P.name, plan: raw, mameExit: code, seconds, speedX: lua ? +((lua.lastFrame + 1) / 59.637 / seconds).toFixed(2) : null,
        lastFrame: lua && lua.lastFrame, machineFrameAtExit: lua && lua.machineFrame, framesDumped: lua && lua.dumped,
        snapshots: files.filter(f => /^snap-f\d+\.png$/.test(f)).sort(),
        statesSaved: P.saves.map(s => ({ name: s.name, frame: s.frame, file: fwd(path.join(STATES, 'dino', s.name + '.sta')), exists: fs.existsSync(path.join(STATES, 'dino', s.name + '.sta')) })),
        loadState: P.loadState || null,
        log: log.split(/\r?\n/).filter(l => l && !/CHECKSUM|EXPECTED|FOUND/.test(l)),
        ok: code === 0 && !!lua, dir: fwd(outDir),
      };
      fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
      if (!quiet || !summary.ok) console.log(`[run.cjs] ${P.name}: exit ${code}, ${seconds.toFixed(1)} s, frames 0..${summary.lastFrame}, ${summary.framesDumped || 0} dumped, ${summary.snapshots.length} snapshots -> ${fwd(outDir)}`);
      resolve(summary);
    });
  });
}

// Read a run's frames.jsonl into an array of objects.
function readFrames(name) {
  const f = path.join(RUNS, name, 'frames.jsonl');
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function main() {
  const args = process.argv.slice(2), planFile = args.find(a => !a.startsWith('--'));
  if (!planFile) { console.error('usage: node tools/re/mame/run.cjs <plan.json> [--dry] [--quiet]'); process.exit(2); }
  const raw = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const quiet = args.includes('--quiet');
  runPlan(raw, { quiet, dry: args.includes('--dry') }).then(s => {
    if (!s) return;
    if (quiet && s.ok) console.log(`[run.cjs] ${s.name}: exit ${s.mameExit}, ${s.seconds.toFixed(1)} s, frames 0..${s.lastFrame}, ${s.framesDumped || 0} dumped, ${s.snapshots.length} snapshots -> ${s.dir}`);
    if (!s.ok) process.exitCode = 1;
  }, e => { console.error(e.message); process.exitCode = 3; });
}

if (require.main === module) main();
module.exports = { runPlan, readFrames, normalise, generateLua, lua, RUNS, STATES, REPO };
