// Live-run helpers for the export scripts: plan building, the animation-caller tap, and run readers.
// One MAME process at a time (the machine has little free RAM): runSeq() runs plans strictly in sequence.
'use strict';
const fs = require('fs'), path = require('path');
const VL = require('../../verify-live/vl.cjs');
const R = require('../../rom.cjs');

const P1 = 0xFFB274;
const HERO_KEYS = ['jack', 'mustapha', 'hannah', 'mess'];   // character id order

// Lua: write taps on P1 +0x28 (torso/main frame pointer) and +0x30 (legs frame pointer). Each write logs the frame,
// the written word, the writing PC and the long at the active A7 (USP: the game runs in user mode; the return address of the jsr that started or ticked the
// animation: the start entries 0x13A0..0x13CC branch to 0x143E without pushing, so [SP] is the caller).
// PEEK logs a compact per-frame record of the P1 fields the labelling needs.
const TAP_LUA = String.raw`
local cpu = manager.machine.devices[":maincpu"]
local FRN = 0
local PB = ${P1}
local function stk() if (cpu.state["SR"].value & 0x2000) ~= 0 then return cpu.state["SP"].value & 0xFFFFFF end return cpu.state["USP"].value & 0xFFFFFF end
local function retaddr() return space:read_u32(stk()) end
EXTAPS = {}
EXTAPS[1] = space:install_write_tap(PB + 0x28, PB + 0x2B, "exfp", function(o, d, m)
  HLOG(fmt('{"t":"fp","f":%d,"o":%d,"d":%d,"m":%d,"pc":%d,"r":%d,"r2":%d}', FRN, o - PB, d, m, cpu.state["CURPC"].value, retaddr(), space:read_u32(stk() + 4)))
end)
EXTAPS[2] = space:install_write_tap(PB + 0x30, PB + 0x33, "exlp", function(o, d, m)
  HLOG(fmt('{"t":"lp","f":%d,"o":%d,"d":%d,"m":%d,"pc":%d,"r":%d,"r2":%d}', FRN, o - PB, d, m, cpu.state["CURPC"].value, retaddr(), space:read_u32(stk() + 4)))
end)
local PEEK0 = PEEK
function PEEK(n)
  FRN = n
  if PEEK0 then PEEK0(n) end
end
`;

// Same taps for several player slots (P1 0xFFB274, P2 0xFFB3F4): tag "fp"/"lp" for P1, "fp2"/"lp2" for P2. Used by the
// 2-player team-up runs; TAP_LUA above is kept byte-identical so the earlier runs are not re-run by runSeq().
function tapLuaFor(players) {
  let s = String.raw`
local cpu = manager.machine.devices[":maincpu"]
local FRN = 0
local function stk() if (cpu.state["SR"].value & 0x2000) ~= 0 then return cpu.state["SP"].value & 0xFFFFFF end return cpu.state["USP"].value & 0xFFFFFF end
local function retaddr() return space:read_u32(stk()) end
EXTAPS = {}
`;
  players.forEach(({ base, tag }, k) => {
    for (const [off, t] of [[0x28, 'fp'], [0x30, 'lp']]) s += String.raw`
EXTAPS[#EXTAPS + 1] = space:install_write_tap(${base + off}, ${base + off + 3}, "ex${t}${tag}", function(o, d, m)
  HLOG(fmt('{"t":"${t}${tag}","f":%d,"o":%d,"d":%d,"m":%d,"pc":%d,"r":%d,"r2":%d}', FRN, o - ${base}, d, m, cpu.state["CURPC"].value, retaddr(), space:read_u32(stk() + 4)))
end)
`;
  });
  s += String.raw`
local PEEK0 = PEEK
function PEEK(n)
  FRN = n
  if PEEK0 then PEEK0(n) end
end
`;
  return s;
}

function seqInputs(steps) {          // steps: [{at, len, keys}] -> plan inputs
  return steps.map(s => ({ from: s.at, to: s.at + (s.len || 1) - 1, keys: s.keys }));
}

async function runSeq(plans, { force = false } = {}) {
  const out = [];
  for (const p of plans) {
    const dir = path.join(VL.RUNS, p.name);
    if (!force && fs.existsSync(path.join(dir, 'summary.json'))) {
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
      const same = fs.existsSync(path.join(dir, 'plan.json')) && fs.readFileSync(path.join(dir, 'plan.json'), 'utf8') === JSON.stringify(p, null, 2);
      if (s.ok && same) { out.push(s); continue; }
    }
    out.push(await VL.runPlan(p));
  }
  return out;
}

// frames.jsonl reader with RAM ranges decoded into Buffers keyed by address
function readRun(name) {
  const frames = VL.readFrames(name);
  for (const fr of frames) if (fr.ram) { const m = {}; for (const [k, v] of Object.entries(fr.ram)) m[parseInt(k, 16)] = Buffer.from(v, 'hex'); fr.mem = m; }
  return frames;
}
// read helpers over a frame's dumped ranges
function mem(fr) {
  const ranges = Object.entries(fr.mem || {}).map(([a, b]) => [+a, b]);
  const find = a => { for (const [s, b] of ranges) if (a >= s && a < s + b.length) return [b, a - s]; throw new Error('address not dumped 0x' + a.toString(16)); };
  return {
    b: a => { const [b, o] = find(a); return b[o]; },
    sb: a => { const [b, o] = find(a); return b.readInt8(o); },
    w: a => { const [b, o] = find(a); return b.readUInt16BE(o); },
    sw: a => { const [b, o] = find(a); return b.readInt16BE(o); },
    l: a => { const [b, o] = find(a); return b.readUInt32BE(o); },
    has: a => { try { find(a); return true; } catch (e) { return false; } },
  };
}
function readHook(name) { return VL.readHook(name); }

// combine the word writes of the taps into long writes: [{t, f, value, pc, r, r2}]
// tags: "fp"/"lp" (P1) or "fp2"/"lp2" (P2 in the team-up runs); `tag` selects which player's taps to return
function tapLongs(hook, tag = '') {
  const out = []; let pend = null;
  for (const e of hook) {
    if (e.t !== 'fp' + tag && e.t !== 'lp' + tag) continue;
    const base = e.t.startsWith('fp') ? 0x28 : 0x30;
    if (e.o === base) pend = { ...e, hi: e.d };
    else if (e.o === base + 2 && pend && pend.t === e.t) { out.push({ t: e.t.replace(/\d$/, ''), f: e.f, value: ((pend.hi << 16) | e.d) >>> 0, pc: e.pc, r: e.r, r2: e.r2 }); pend = null; }
  }
  return out;
}

module.exports = { P1, HERO_KEYS, TAP_LUA, tapLuaFor, seqInputs, runSeq, readRun, mem, readHook, tapLongs, RUNS: VL.RUNS };
