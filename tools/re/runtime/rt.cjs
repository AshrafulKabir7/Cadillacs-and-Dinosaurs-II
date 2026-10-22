#!/usr/bin/env node
// Runtime memory-map tooling for the original Cadillacs & Dinosaurs (MAME romset "dino").
// Thin layer over tools/re/mame/run.cjs (left untouched): same plan format, plus
//   plan.hook   : Lua source run once at load time. It may define
//                   function HOOK(n)  -- called at the end of frame n-1, right after that frame's inputs/pokes for
//                                     -- frame n were written (same timing as plan.pokes)
//                   function PEEK(n)  -- called at the start of frame n's callback (after the frame ran, before
//                                     -- dump/snapshot), good for reading state
//                 It can use every local of the harness body (space, machine, scr, fmt, say, fields, cpsa, gfxram ...)
//                 plus the helpers defined below: rb/rw/rl (read), wb/ww/wl (write), HLOG(jsonString) -> hook.jsonl
//   plan.cheats : list of named cheats from cheats.cjs, expanded into Lua (see that file).
// Outputs go to work/re/runs/<name>/ exactly as run.cjs does (frames.jsonl, snapshots, summary.json, plan.lua) plus
// hook.jsonl when the hook logs.
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const H = require('../mame/run.cjs');

const MAME = process.env.MAME_EXE || 'E:/tools/mame/mame.exe';
const ROMPATH = process.env.MAME_ROMPATH || 'E:/tools/mame/roms';
const STATES = H.STATES, RUNS = H.RUNS;
const fwd = p => p.replace(/\\/g, '/');

const HELPERS = String.raw`
-- ===== runtime helpers (tools/re/runtime/rt.cjs) =====
function rb(a) return space:read_u8(a) end
function rw(a) return space:read_u16(a) end
function rl(a) return space:read_u32(a) end
function rsw(a) local v = space:read_u16(a) if v >= 0x8000 then v = v - 0x10000 end return v end
function wb(a, v) space:write_u8(a, v & 0xff) end
function ww(a, v) space:write_u16(a, v & 0xffff) end
function wl(a, v) space:write_u32(a, v & 0xffffffff) end
local hookf = nil
function HLOG(s) if not hookf then hookf = io.open(OUT .. "/hook.jsonl", "w") end hookf:write(s, "\n") hookf:flush() end
function HEX(a, len) local s = space:read_range(a, a + len - 1, 8) return (s:gsub(".", function(c) return fmt("%02X", c:byte()) end)) end
-- pop one slot from a pool free list exactly like the game's allocators at 0x4818.. (count word, pointer word)
function POOL_ALLOC(countAddr, ptrAddr)
  local cnt = rw(countAddr)
  if cnt == 0 then return nil end
  local p = 0xFF0000 | rw(ptrAddr)
  local slot = 0xFF0000 | rw(p)
  ww(ptrAddr, (p + 2) & 0xffff)
  ww(countAddr, cnt - 1)
  return slot
end
`;

function buildLua(plan, outDir) {
  const P = H.normalise(plan);
  let src = H.generateLua(P, outDir);
  const hook = [HELPERS, plan.hook || '', require('./cheats.cjs').cheatLua(plan.cheats || [])].join('\n');
  const a = '\nlocal n = 0\n';
  if (!src.includes(a)) throw new Error('run.cjs body changed: cannot find "local n = 0"');
  src = src.replace(a, '\n' + hook + '\n' + a);
  const b = '  n = n + 1\n  apply_inputs(n)\n  apply_pokes(n)\nend';
  if (!src.includes(b)) throw new Error('run.cjs body changed: cannot find the frame tail');
  src = src.replace(b, '  n = n + 1\n  apply_inputs(n)\n  apply_pokes(n)\n  if HOOK then HOOK(n) end\nend');
  const c = 'local function on_frame()\n  if stopped then return end\n';
  if (!src.includes(c)) throw new Error('run.cjs body changed: cannot find on_frame head');
  src = src.replace(c, c + '  if PEEK then PEEK(n) end\n');
  return { P, src };
}

function runPlan(plan, { quiet = true } = {}) {
  const outDir = path.join(RUNS, plan.name);
  const { P, src } = buildLua(plan, outDir);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'mame'), { recursive: true });
  const luaFile = path.join(outDir, 'plan.lua');
  fs.writeFileSync(luaFile, src);
  fs.writeFileSync(path.join(outDir, 'plan.json'), JSON.stringify(plan, null, 2));
  if (P.loadState && !fs.existsSync(path.join(STATES, 'dino', P.loadState + '.sta'))) return Promise.reject(new Error(`state ${P.loadState} not found`));
  const args = ['dino', '-rompath', ROMPATH, '-skip_gameinfo', '-nowindow', '-video', 'none', '-sound', 'none', '-nothrottle',
    '-snapshot_directory', fwd(outDir), '-state_directory', fwd(STATES),
    '-cfg_directory', fwd(path.join(outDir, 'mame/cfg')), '-nvram_directory', fwd(path.join(outDir, 'mame/nvram')),
    '-diff_directory', fwd(path.join(outDir, 'mame/diff')), '-input_directory', fwd(path.join(outDir, 'mame/inp')),
    '-autoboot_script', fwd(luaFile)];
  const t0 = Date.now();
  const exitFrames = Math.max(P.frames, ...P.saves.map(s => s.frame + 2));
  const timeoutMs = 90000 + (exitFrames / 60) * 600;
  return new Promise(resolve => {
    const child = spawn(MAME, args, { cwd: path.join(outDir, 'mame'), windowsHide: true });
    let log = '';
    const onData = d => { log += d.toString(); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const timer = setTimeout(() => { log += '\n[rt] timeout, killing MAME\n'; child.kill(); }, timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      let lua = null; try { lua = JSON.parse(fs.readFileSync(path.join(outDir, 'lua-summary.json'), 'utf8')); } catch (e) { }
      const files = fs.readdirSync(outDir).filter(f => f !== 'mame');
      const summary = {
        name: P.name, plan, mameExit: code, seconds: (Date.now() - t0) / 1000, lastFrame: lua && lua.lastFrame,
        machineFrameAtExit: lua && lua.machineFrame, framesDumped: lua && lua.dumped,
        snapshots: files.filter(f => /^snap-f\d+\.png$/.test(f)).sort(),
        statesSaved: P.saves.map(s => ({ name: s.name, frame: s.frame, exists: fs.existsSync(path.join(STATES, 'dino', s.name + '.sta')) })),
        loadState: P.loadState || null,
        log: log.split(/\r?\n/).filter(l => l && !/CHECKSUM|EXPECTED|FOUND|might not run|-video none/i.test(l)),
        ok: code === 0 && !!lua, dir: fwd(outDir),
      };
      fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
      if (!quiet || !summary.ok) console.log(`[rt] ${P.name}: exit ${code}, ${summary.seconds.toFixed(1)} s, last ${summary.lastFrame}, snaps ${summary.snapshots.length}${summary.ok ? '' : '\n' + summary.log.slice(-15).join('\n')}`);
      resolve(summary);
    });
  });
}

function readHook(name) {
  const f = path.join(RUNS, name, 'hook.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
// full 64 KB RAM dump of frame n of a run (dump.ramFile) as a Buffer indexed by (addr - 0xFF0000)
function ramOf(name, n) { return fs.readFileSync(path.join(RUNS, name, `ram-f${String(n).padStart(6, '0')}.bin`)); }

async function main() {
  const args = process.argv.slice(2);
  const plan = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  const s = await runPlan(plan, { quiet: false });
  if (!s.ok) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { runPlan, buildLua, readHook, ramOf, readFrames: H.readFrames, RUNS, STATES };
