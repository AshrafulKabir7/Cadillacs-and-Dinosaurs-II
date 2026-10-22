#!/usr/bin/env node
// Adversarial live-verification runner (research only).
//   node tools/re/verify-live/vl.cjs <plan.json> [--quiet]
// Same plan format as tools/re/runtime/rt.cjs (plan.hook with HOOK/PEEK, plan.cheats, dumps, snapshots), plus
//   plan.debug : true -> MAME runs with "-debug -debugger none" so the hook can use the debugger
//                (DBG = manager.machine.debugger, CPU = maincpu device; CPU.debug:bpset(...)), and the
//                debugger console log is written to <run>/debug-console.txt at exit.
//   plan.preHook : Lua run before the state load (e.g. to install read/write taps)
// Outputs: work/re/runs/<name>/ as rt.cjs does.
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const RT = require('../runtime/rt.cjs');

const MAME = process.env.MAME_EXE || 'E:/tools/mame/mame.exe';
const ROMPATH = process.env.MAME_ROMPATH || 'E:/tools/mame/roms';
const fwd = p => p.replace(/\\/g, '/');

const DBG_LUA = String.raw`
-- ===== verify-live debugger glue =====
CPU = manager.machine.devices[":maincpu"]
DBG = manager.machine.debugger
if DBG then DBG.execution_state = "run" end
function CONSOLE_DUMP()
  if not DBG then return end
  local f = io.open(OUT .. "/debug-console.txt", "w")
  for _, l in ipairs(DBG.consolelog) do f:write(l, "\n") end
  f:close()
end
function REG(name) return CPU.state[name].value end
`;

function build(plan, outDir) {
  let { P, src } = RT.buildLua(plan, outDir);
  // glue after the harness locals exist (before "local n = 0" the hook block was inserted by rt.cjs)
  const a = '\n-- ===== runtime helpers (tools/re/runtime/rt.cjs) =====';
  if (!src.includes(a)) throw new Error('rt.cjs helpers marker not found');
  src = src.replace(a, '\n' + DBG_LUA + (plan.preHook || '') + '\n' + a);
  // dump the console just before exit
  const b = '    say("exit at frame", n)';
  if (!src.includes(b)) throw new Error('exit marker not found');
  src = src.replace(b, '    if CONSOLE_DUMP then CONSOLE_DUMP() end\n    if FINAL then FINAL(n) end\n' + b);
  return { P, src };
}

function runPlan(plan, { quiet = true } = {}) {
  const outDir = path.join(RT.RUNS, plan.name);
  const { P, src } = build(plan, outDir);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'mame'), { recursive: true });
  const luaFile = path.join(outDir, 'plan.lua');
  fs.writeFileSync(luaFile, src);
  fs.writeFileSync(path.join(outDir, 'plan.json'), JSON.stringify(plan, null, 2));
  const args = ['dino', '-rompath', ROMPATH, '-skip_gameinfo', '-nowindow', '-video', 'none', '-sound', 'none', '-nothrottle',
    '-snapshot_directory', fwd(outDir), '-state_directory', fwd(RT.STATES),
    '-cfg_directory', fwd(path.join(outDir, 'mame/cfg')), '-nvram_directory', fwd(path.join(outDir, 'mame/nvram')),
    '-diff_directory', fwd(path.join(outDir, 'mame/diff')), '-input_directory', fwd(path.join(outDir, 'mame/inp')),
    '-comment_directory', fwd(path.join(outDir, 'mame/comments')),
    '-autoboot_script', fwd(luaFile)];
  if (plan.debug) args.push('-debug', '-debugger', 'none');
  const t0 = Date.now();
  const exitFrames = Math.max(P.frames, ...P.saves.map(s => s.frame + 2));
  const timeoutMs = 120000 + (exitFrames / 60) * 1500;
  return new Promise(resolve => {
    const child = spawn(MAME, args, { cwd: path.join(outDir, 'mame'), windowsHide: true });
    let log = '';
    child.stdout.on('data', d => { log += d.toString(); }); child.stderr.on('data', d => { log += d.toString(); });
    const timer = setTimeout(() => { log += '\n[vl] timeout, killing MAME\n'; child.kill(); }, timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      let lua = null; try { lua = JSON.parse(fs.readFileSync(path.join(outDir, 'lua-summary.json'), 'utf8')); } catch (e) { }
      const files = fs.readdirSync(outDir).filter(f => f !== 'mame');
      const summary = {
        name: P.name, mameExit: code, seconds: (Date.now() - t0) / 1000, lastFrame: lua && lua.lastFrame,
        snapshots: files.filter(f => /^snap-f\d+\.png$/.test(f)).sort(), loadState: P.loadState || null,
        log: log.split(/\r?\n/).filter(l => l && !/CHECKSUM|EXPECTED|FOUND|might not run|-video none/i.test(l)),
        ok: code === 0 && !!lua, dir: fwd(outDir),
      };
      fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
      console.log(`[vl] ${P.name}: exit ${code}, ${summary.seconds.toFixed(1)} s, last ${summary.lastFrame}, snaps ${summary.snapshots.length}${summary.ok ? '' : '\n' + summary.log.slice(-20).join('\n')}`);
      resolve(summary);
    });
  });
}

async function main() {
  const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const res = await Promise.all(files.map(f => runPlan(JSON.parse(fs.readFileSync(f, 'utf8')))));
  if (res.some(s => !s.ok)) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { runPlan, build, readHook: RT.readHook, ramOf: RT.ramOf, readFrames: RT.readFrames, RUNS: RT.RUNS };
