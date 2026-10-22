#!/usr/bin/env node
// REA (Rizin) evidence for the stage-background decode: one disassembly per key routine/table, kept as REA records.
//   node tools/re/export/stages-evidence.cjs   -> work/re/extract/stages/evidence/<label>.json/.txt + evidence.json
// Research tooling only. Rizin settings follow tools/re/rea-ev.sh (68000, byte-swapped image, offset == address).
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '../../..');
const BIN = path.join(REPO, 'work/re/dino-prg.bin').replace(/\\/g, '/');
const OUT = path.join(REPO, 'work/re/extract/stages/evidence');
const RIZIN = 'E:/tools/rizin/rizin-win-installer-clang_cl-64/bin';
// the rea CLI is an npm package; run its script with this node (the npm shim is a shell script)
const REA = process.env.REA_MJS || path.join(process.env.APPDATA || 'C:/Users/ashra/AppData/Roaming', 'npm/node_modules/rea-agents/scripts/rea.mjs');

const ITEMS = [
  ['s01-scroll-regs', 'pd 30 @ 0x6c0', 'CPS-A scroll registers from the camera latches: s1x = [0xFF885C] - 0x40, s2x = camX - 0x40, s3x = X3 - 0x40, s1y = 0x100 - y, s2y = 0x300 - camY, s3y = 0x700 - Y3'],
  ['s02-irq-bases', 'pd 14 @ 0x564', 'IRQ2 writes the OBJ/scroll1/2/3 bases (0x800100-0x800106) from the RAM shadows 0xFF802A/2C/2E'],
  ['s03-video-palette-ctrl', 'pd 12 @ 0x800', 'CPS-B layer control 0x80014A from 0xFF8028; palette control 0x3F -> 0x800144; palette base 0x9140; video control 0x800122 = 0xFF8026 | flip'],
  ['s04-area-load', 'pd 52 @ 0x20766', 'area init: layer control 0x12D6 (E7 area 1: 0x06D6 + scroll1 background via 0x205C6), scroll2 area table 0x21580 (10-byte entries: width, rows, block map, camera X0/Y0), first screen drawn by 0x213F8'],
  ['s05-hellroad-rowscroll', 'pd 8 @ 0x20710', 'stage 3 (HELL ROAD) sets bit 0 of 0xFF8026 = CPS-A video control bit 0 = scroll2 rowscroll'],
  ['s06-map-address', 'pd 64 @ 0x214c0', 'scroll2 streaming: tilemap address from (X, Y) (0x214C0), block map lookup with the HELL ROAD wrap X >= 0x4D00 -> -0xF00 (0x214F0), block -> chunk word (0x2152C, table 0x2155E per stage)'],
  ['s07-chunk-tiles', 'pd 12 @ 0x2142a', 'chunk -> four 16x16 tiles (code, attr longs) from the per-stage table 0x21454, written left-top, left-bottom, right-top, right-bottom'],
  ['s08-stream-columns', 'pd 48 @ 0x2126e', 'per-frame streaming: new 32-px column at camX + 0x200 (right) or camX - 0x40 (left), rows from camY + 0x180 down'],
  ['s09-scroll3-area', 'pd 40 @ 0x22cc4', 'scroll3 controller 0xFF87DC: area table 0x2311E (same 10-byte format), initial screen'],
  ['s10-scroll3-parallax', 'pd 50 @ 0x22dc6', 'parallax: shift byte per stage/area at 0x22DE4, X3 = camX >> shift; vertical flag table 0x22E54, Y3 = y0_3 + ((camY - y0_2) >> shift); state 5 / 9 rules'],
  ['s11-scroll3-address', 'pd 40 @ 0x23090', 'scroll3 tilemap address, block map & 0x7F with the HELL ROAD wrap X >= 0xA00 -> -0x100, block data 0x177288 + block*256 (col*32 + 0x1C - row*4)'],
  ['s12-palettes', 'pd 40 @ 0x8a44', 'area palettes: OBJ list 0x8E8E, scroll1 0xBBA52, scroll2 table 0x8AE0, scroll3 table 0x8C20/0x8C52, priority 0x8D92'],
  ['s13-priority', 'pd 14 @ 0x8d92', 'priority masks per stage 0x8DEC (E7 per area 0x8DCC) -> CPS-B 0x0C, 0x0E, 0x00, 0x02'],
  ['s14-obj-palettes', 'pd 20 @ 0x8e4c', 'OBJ palettes: 32 palette indices per stage/area (table 0x8E8E) into 0xB7A52'],
  ['s15-fades', 'pd 30 @ 0x88b0', 'fades add +-0x1000 to every palette word (brightness nibble) per page'],
  ['s16-segments', 'pd 40 @ 0x2099a', 'segment script 0x21B2A: word offset per stage, 16-byte segments copied to the controller (+0x4C..+0x7B)'],
  ['s17-segment-dispatch', 'pd 30 @ 0x208dc', 'trigger test (camera X >= +0 or camera Y <= +2 when +0xF set) and the state dispatch table 0x2092E'],
  ['s18-camera-follow', 'pd 40 @ 0x20a22', 'camera X follows the lead player once he is +0x50 px right of it, at most 6 px per frame; Y follow 0x20B68'],
  ['s19-terrain-lookup', 'pd 40 @ 0x1309c', 'collision: tilemap attribute at (X, depth + floor) from the live scroll2 RAM, rol #6 -> terrain type, behaviour table 0x1370C'],
  ['s20-area-continue', 'pd 30 @ 0x20e78', 'state 8: next area without reload (area++, OBJ palettes, timer)'],
  ['s21-area-exit', 'pd 50 @ 0x20bf4', 'state 1: fade, then the next segment with trigger 0 starts the next area (0x20C6A -> 0xACD0, 0x20766)'],
  ['s23-hellroad-rowscroll-values', 'pd 26 @ 0x23370', 'HELL ROAD rowscroll band: rowscroll RAM words 0x90-0xAF (screen rows 128-159) = ((camX - (k+1)*(camX>>1)) - camX) >> 5 (& 0xFF when >= 0x180), k = 0 at row 159'],
  ['s24-player-screen-clamp', 'pd 24 @ 0x4fce; pd 3 @ 0x18e94', 'player clamp (jumped to from the player handler at 0x18E98): X - camX - 0x10 kept in [0, 0x160), (depth + floor) - camY - 0x10 kept in [0, 0x90); while 0xFF84DC is set (E7 area 1) the clamp uses fixed X 0x10..0x170 / depth 0x10..0xA0'],
  ['s22-title-screens', 'pd 30 @ 0x20454', 'non-stage screens (title/select/intermission) draw blocks with 0x20454 (scroll1, 0x15CFE8), 0x204CA (scroll2, 0x175378/0x145DC8), 0x20592 (scroll3, 0x177288)'],
  ['s25-terrain-classes', 'pd 26 @ 0x13112', 'collision 0x1309C: stage/area byte table 0x13B0C -> 0xFF86B2, class word of 0x1370C + type*16 dispatched through the jump table 0x1313E (0x20 handled as 0x14); 0x13134 returns no-collision, 0x13138 returns carry (retry)'],
  ['s26-terrain-push-walls', 'pd 36 @ 0x1315e', 'class 0 types 1-8: word 1 picks push up (depth += 16-(h&15)), down (depth -= (h&15)+1), left (X -= (X&15)+1), right (X += 16-(X&15)); word 5 set -> carry so the caller repeats'],
  ['s27-terrain-slopes', 'pd 56 @ 0x131fe', 'class 4: floor slope (feet lifted to s = ((x or 15-x) >> w3) + w4 + 1), ceiling slope (pushed down to 15 - s), diagonal walls in X from the h fraction'],
  ['s28-terrain-corners-platforms', 'pd 100 @ 0x132ca', 'class 8 corner pushes (always move one axis); class 0xC and 0x10 platform cells: interior raises the floor (+0x56 = 0xFF86B0), edges push while the object is below the platform height'],
  ['s29-terrain-diagonals', 'pd 70 @ 0x1350e', 'class 0x18 diagonal walls (push left / right to ((h fraction - w4) << w3)); class 0x1C platform edge (push down below the platform height) plus diagonal push right'],
  ['s30-platform-height-and-floor-pointer', 'pd 12 @ 0x12be4', 'per stage: 0xFF86B0 = word[0x12C40 + stage*2] (platform height), 0xFF86AC = floor list of the stage/area from 0x12C30; E7 area 1 (0xFF84DC) builds the collision map at 0x91C000/0x91C400 from blocks 0xC/0xD'],
  ['s31-collision-map-builder', 'pd 16 @ 0x12c50', 'E7 area 1 collision map: chunk words at 0x141DC8 + block*128, 16-byte chunks at 0x16E188, written column-major (64 bytes per 16-px column, 4 bytes per cell)'],
  ['s32-floor-list', 'pd 30 @ 0x12fe4; pd 30 @ 0x1302c', 'floor height +0x54 from the 12-byte list entry whose x1 >= X: flat (w4) with byte 7 -> +0x52, or slope w3 + (X-x0)/4 (w4 == 0) / w3 - 1 - (X-x0)/4; byte 0xA -> +0x53 (wading)'],
  ['s33-collision-caller', 'pd 10 @ 0x12cb4', 'the collision routine runs after the floor lookup and is retried up to 5 times while it returns carry'],
  ['s34-e7a1-lookup', 'pd 11 @ 0x136e4', 'E7 area 1 lookup: attribute at 0x91C000 + ((X & 0x1F0) << 2) + ((0xF0 - (h & 0xF0)) >> 2) + 2, so the map repeats every 512 px of X and 256 px of h'],
];

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2), prevF = path.join(OUT, 'evidence.json'), prev = fs.existsSync(prevF) ? JSON.parse(fs.readFileSync(prevF, 'utf8')) : [];
  const env = Object.assign({}, process.env, { PATH: RIZIN + path.delimiter + process.env.PATH });
  const index = [];
  for (const [label, cmd, claim] of ITEMS) {
    if (only.length && !only.includes(label)) { const p = prev.find(x => x.label === label); if (p) index.push(p); continue; }
    const full = `e scr.color=0; e asm.arch=m68k; e asm.cpu=68000; e asm.bits=32; e asm.bytes=true; ${cmd}`;
    let rec;
    try { rec = JSON.parse(execFileSync(process.execPath, [REA, 'execute-rizin-command', BIN, full, '--format', 'json'], { env, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).toString()); }
    catch (e) { index.push({ label, cmd, claim, error: String(e.message).slice(0, 200) }); console.log(label, 'ERROR'); continue; }
    fs.writeFileSync(path.join(OUT, label + '.json'), JSON.stringify(rec, null, 1));
    const stdout = (rec.raw_result && rec.raw_result.stdout || '').replace(/\r/g, '');
    fs.writeFileSync(path.join(OUT, label + '.txt'), stdout);
    index.push({ label, cmd, claim, evidence_id: rec.evidence_id, exit: rec.raw_result && rec.raw_result.exit_code, lines: stdout.split('\n').length });
    console.log(label, rec.evidence_id, 'exit', rec.raw_result && rec.raw_result.exit_code);
  }
  fs.writeFileSync(path.join(OUT, 'evidence.json'), JSON.stringify(index, null, 1));
}
main();
