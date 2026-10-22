#!/usr/bin/env node
// Draw-pipeline probe: runs MAME with the debugger (headless) and logs, per game frame,
//   B  builder start (0x13FC8): frame counter, A4 (OBJ buffer)
//   X  0x13FD0: D0 (stored to 0xFFE9B6), camX 0xFF8744
//   Y  0x13FE2: D0 (stored to 0xFFE9B8), camY 0xFF8748, 0xFF84DC
//   N  0x1404A: object count 0xFFE7C0
//   D  0x1405A: one line per drawn object with the fields the draw code reads
//   E  0x14076: A4 at the end marker
// plus both OBJ buffers each frame (hook.jsonl) and the PCs that read the ROM header longs 0xFFFF0..0xFFFFF.
//   node tools/re/verify-live/drawrun.cjs <name> <state> <frames> [extra-plan.json]
'use strict';
const fs = require('fs'), path = require('path');
const VL = require('./vl.cjs');

const BP = [
  [0x13FC8, 'printf "B %X %X",w@ff8000,a4'],
  [0x13FD0, 'printf "X %X %X %X",w@ff8000,d0,w@ff8744'],
  [0x13FE2, 'printf "Y %X %X %X %X",w@ff8000,d0,w@ff8748,b@ff84dc'],
  [0x1404A, 'printf "N %X %X",w@ff8000,w@ffe7c0'],
  [0x1405A, 'printf "D %X %X %X %X %X %X %X %X %X %X %X %X %X %X %X %X %X %X",w@ff8000,d0,w@(a0+8),w@(a0+c),w@(a0+10),b@(a0+24),d@(a0+28),b@(a0+25),b@(a0+23),w@(a0+3c),w@(a0+3e),d@(a0+30),b@(a0+53),w@(a0+4c),w@(a0+4),b@(a0+2e),w@(d@(a0+28)),w@(d@(a0+28)+2)'],
  [0x14064, 'printf "S %X %X",w@ff8000,a4'],
  [0x14076, 'printf "E %X %X",w@ff8000,a4'],
];

function hookLua(extra) {
  const bps = BP.map(([a, act]) => `CPU.debug:bpset(0x${a.toString(16)}, '1', '${act.replace(/'/g, "\\'")}; g')`).join('\n');
  return `${bps}
-- ROM header readers: aggregate PCs of every read of 0xFFFF0..0xFFFFF
HDR = {}
HDRTAP = space:install_read_tap(0xFFFF0, 0xFFFFF, "hdr", function(offset, data, mask)
  local k = string.format("%X@%X", CPU.state["CURPC"].value, offset)
  HDR[k] = (HDR[k] or 0) + 1
end)
local function objbuf(base)
  local t = {}
  for i = 0, 255 do
    local o = base + i * 8
    local s = HEX(o, 8)
    t[#t + 1] = s
    if rw(o + 6) == 0xFF00 then break end
  end
  return table.concat(t, ",")
end
function PEEK(n)
  HLOG(fmt('{"n":%d,"fc":%d,"cps":%d,"b0":"%s","b1":"%s"}', n, rw(0xFF8000), cpsa:read_u16(0), objbuf(0x900000), objbuf(0x904000)))
end
function FINAL(n)
  local f = io.open(OUT .. "/hdr-readers.json", "w")
  local parts = {}
  for k, v in pairs(HDR) do parts[#parts + 1] = fmt('"%s":%d', k, v) end
  f:write("{" .. table.concat(parts, ",") .. "}")
  f:close()
end
${extra || ''}`;
}

async function main() {
  const [name, state, frames, extraFile] = process.argv.slice(2);
  const extra = extraFile ? JSON.parse(fs.readFileSync(extraFile, 'utf8')) : {};
  const plan = Object.assign({ name, frames: +frames, loadState: state, debug: true, snapshotEvery: { from: 0, to: +frames - 1, every: 20 } }, extra);
  plan.hook = hookLua(extra.hook);
  const s = await VL.runPlan(plan);
  if (!s.ok) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { hookLua };
