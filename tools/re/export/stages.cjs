#!/usr/bin/env node
// Stage backgrounds of the original Cadillacs & Dinosaurs (MAME "dino", the user's own ROM set): decode, capture,
// validate and export. Research tooling only; nothing here edits the game.
//
//   node tools/re/export/stages.cjs static          ROM-only: render every area map (scroll2/scroll3/terrain) -> work/re/extract/stages/
//   node tools/re/export/stages.cjs live [ep ...]   MAME: walk each episode (invuln + killAll + bot) and record the camera,
//                                                   scroll registers, tilemaps and palettes (runs stg-ep<N>-walk), one MAME at a time
//   node tools/re/export/stages.cjs depth [ep ...]  MAME: depth probes per area (P1 sweeps Up/Down, runs stg-depth-e<N>a<M>)
//   node tools/re/export/stages.cjs screens         MAME: title, select, intermission/title-card captures (runs stg-screens-*)
//   node tools/re/export/stages.cjs validate        compare: layer decode vs MAME snapshots (sprite-free frames of the walks),
//                                                   ROM maps vs live tilemaps, palettes, parallax, HELL ROAD rowscroll, terrain
//   node tools/re/export/stages.cjs priority        MAME: replay parts of 3 walks with OBJ dumps; full-frame check with sprites
//   node tools/re/export/stages.cjs build           crop + composite the per-area images, dynamic/animated tiles, palette
//                                                   animation, captions, screens, stages.json, contact sheets
//   node tools/re/export/stages.cjs all             static, live, screens, validate, priority, build in order
//   (also: cmp <run>, rowscroll, validate-layers, priority-check, screens-export; REA evidence: stages-evidence.cjs)
//
// The decoders are tools/re/export/lib/cps-scroll.cjs (CPS-1 scroll layers as MAME draws them) and
// tools/re/export/lib/stage-rom.cjs (the game's map/block/chunk tables). Outputs: work/re/extract/stages/.
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../rom.cjs');
const S = require('./lib/cps-scroll.cjs');
const G = require('./lib/stage-rom.cjs');
const TR = require('./lib/terrain.cjs');

const REPO = path.resolve(__dirname, '../../..');
const OUT = path.join(REPO, 'work/re/extract/stages');
const RUNS = path.join(REPO, 'work/re/runs');
const hex = G.hex;
const mkdir = d => fs.mkdirSync(d, { recursive: true });
const writeJSON = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 1));
const rt = () => require('../runtime/rt.cjs');

// ---------------------------------------------------------------- on-screen text (title cards, captions, dialogue)
// Text is drawn on scroll1 with an 8x16 font: top tile code c, bottom tile c + 0x10. Mapping read off live screens
// whose text is known (OBSERVED): A-O = 0x160-0x16E, P-X = 0x190-0x198, Y = 0x582, Z = 0x583, 1-7 = 0x584-0x58A
// (from "EPISODE 1..7"), 8 = 0x35D ("EPISODE 8"), space = 0x680 (bottom 0x690), 0x33F = "!". Punctuation uses the
// 8x8 ASCII font in one half: ',' in the top half is an apostrophe. The ROM keeps these strings as tile words
// (e.g. 0xE54E..), not ASCII, which is why tools/re/text.cjs does not find them.
const FONT16 = new Map();
'ABCDEFGHIJKLMNO'.split('').forEach((c, i) => FONT16.set(0x160 + i, c));
'PQRSTUVWX'.split('').forEach((c, i) => FONT16.set(0x190 + i, c));
FONT16.set(0x582, 'Y'); FONT16.set(0x583, 'Z'); for (let d = 1; d <= 7; d++) FONT16.set(0x583 + d, String(d));
FONT16.set(0x35d, '8'); FONT16.set(0x33f, '!'); FONT16.set(0x680, ' ');
// second copy of the font (tile sheet read off the ROM, scratch sheet glyphs2.png): 0x330-0x33F = 7 8 9 A..L !,
// 0x350-0x35F = N O P Q R S T U V ? X Y Z 8 9 0 (so '8' = 0x35D as seen on the EPISODE 8 card, '9' = 0x35E, '0' = 0x35F,
// '?' = 0x359: the "? ???" of the E5/E8 dialogue are real question marks)
'789ABCDEFGHIJKL!'.split('').forEach((c, i) => FONT16.set(0x330 + i, c));
'NOPQRSTUV?XYZ890'.split('').forEach((c, i) => FONT16.set(0x350 + i, c));
// dialogue-box border tiles that also come in (c, c + 0x10) pairs: not glyphs
const BOXTILES = new Set([0x16f, 0x503, 0x50a, 0x581, 0x5cb, 0x5db, 0x8cf, 0x500, 0x501, 0x502, 0x5c8, 0x5c9, 0x5ca, 0x5d0, 0x5d1, 0x5d2]);
function textLines(F) {
  const Rg = S.regs(F), sx = Rg.s[1].x, sy = Rg.s[1].y, out = [];
  for (let r = 0; r < 27; r++) {
    let t = '', known = 0, unk = 0;
    for (let c = 0; c < 48; c++) {
      const tx = ((c * 8 + 64 + sx) & 511) >> 3, ty = ((r * 8 + 16 + sy) & 511) >> 3, tb = ((r * 8 + 24 + sy) & 511) >> 3;
      const e = S.tileEntry(F, 1, tx, ty).code, b = S.tileEntry(F, 1, tx, tb).code;
      if (b === e + 0x10 && FONT16.has(e)) { t += FONT16.get(e); if (e !== 0x680) known++; continue; }
      if (BOXTILES.has(e)) { t += ' '; continue; }
      if ((e === 0x20 || e === 0x680) && b > 0x20 && b < 0x7f) { t += String.fromCharCode(b); continue; }
      if (e > 0x20 && e < 0x7f && (b === 0x20 || b === 0x680 || b === 0x690)) { t += e === 0x2c ? "'" : String.fromCharCode(e); continue; }
      if (b === e + 0x10 && e !== 0x20) { unk++; t += ' '; continue; } // graphics drawn in (c, c + 0x10) pairs: speaker portraits (0xB00..), box borders
      t += ' ';
    }
    t = t.replace(/\s+/g, ' ').trim();
    if (known >= 3 && unk <= known / 4) out.push({ row: r, text: t });
  }
  return out;
}
// every distinct text line seen in a run (dumped frames), with the first frame and the stage/area/main state then
function runTexts(run) {
  const hk = new Map(readHook(run).map(r => [r.n, r])), seen = new Map();
  for (const fr of readFrames(run)) {
    if (!fr.scroll) continue;
    const h = hk.get(fr.f) || {};
    const main = h.m !== undefined ? h.m : (fr.ram && fr.ram.FF84D0 ? parseInt(fr.ram.FF84D0.slice(0, 2), 16) : null);
    for (const l of textLines(S.loadFrame(run, fr))) {
      if (main === 0xc && l.row < 5) continue; // HUD
      const k = l.row + ':' + l.text;
      if (!seen.has(k)) seen.set(k, { run, f: fr.f, row: l.row, text: l.text, stage: h.st, area: h.ar, main });
    }
  }
  return [...seen.values()];
}
let TEXTS = null;
function texts() {
  if (TEXTS) return TEXTS;
  TEXTS = { cards: {}, captions: {}, all: [] };
  for (const p of screensPlans()) {
    const L = runTexts(p.name); TEXTS.all.push(...L);
    const ep = /card(\d)/.exec(p.name);
    if (ep) {
      const n = +ep[1], epi = L.filter(x => x.text === `EPISODE ${n}`), title = L.filter(x => x.row === 20 && epi.length && x.f >= epi[0].f && x.f <= epi[0].f + 60).sort((a, b) => b.text.length - a.text.length)[0];
      if (epi.length) TEXTS.cards[n] = { text: `EPISODE ${n}`, title: title ? title.text : null, run: p.name, frame: epi[0].f };
    }
  }
  for (let ep = 1; ep <= 8; ep++) for (const run of runsOf(ep)) {
    const L = runTexts(run); TEXTS.all.push(...L);
    for (const x of L) {
      if (x.main !== 0xc || x.area === undefined) continue;
      const isCaption = x.row === 23 || (x.row === 24 && /^[0-9A-Z ]+$/.test(x.text) && x.text.length <= 16);
      const k = `${ep}/${x.area}`;
      if (isCaption && !TEXTS.captions[k]) TEXTS.captions[k] = { text: x.text, run, frame: x.f, row: x.row };
    }
  }
  return TEXTS;
}

const CONVENTIONS = {
  images: 'PNG RGBA, ROM palettes at full brightness (word | 0xF000, MAME colour n*0x11*(0x0F+2B)/0x2D = n*17), pen 15 transparent',
  worldAxes: 'X grows right; h (map height) grows up. A map pixel (X, h) is on screen at x = X - camX, y = camY + 239 - h. A sprite with feet at depth d and height 0 stands on map row h = d (screen y = camY + 240 - d, MEMORY-MAP V05).',
  areaImages: 'ep<N>-area<M>-scroll2/terrain/composite.png cover the world rectangle in stages.json areas[].world (image x = X - x0, image y = h1 - 1 - h); scroll3 images cover areas[].scroll3World in scroll3 space (X3 = camX >> shift)',
  romMaps: 'rom/ep<N>-map<M>-*.png are the whole maps from the ROM tables (image x = X, image y = mapHeight - 1 - h)',
  terrain: 'colour by behaviour class of the type (word 0 of 0x1370C + type*16, see decode "terrain-collision"): red = class 0x00 types 1-8 (one-sided push walls: 1/5 up, 2/6 down, 3/7 left, 4/8 right), yellow = 0x04 slopes and diagonal walls, orange = 0x08 corner pushes, teal = 0x0C platform edges, cyan = 0x10 platforms (interior raises the floor by the stage platform height, edges push below it), green = 0x14 no-op (type 21), purple = 0x18 diagonal walls, white = 0x1C platform edge + diagonal, blue = 0x20 water (type 63, wading); type 0 (free) is transparent',
  depthBand: 'areas[].floorProfile = [[x0, x1, hMin, hMax + 1, raisedFloor], ...] per map X (h = depth + floor, the map row the feet stand on; null = no walkable run), floorRuns = the same per 16-px column; depth (+0x10) = h - floor(X) with floor from areas[].depth.floorList; E7 area 1 uses the 512x256 collision map (X and h wrap)',
};
// status: OBSERVED = seen in the disassembly / ROM tables / live runs; INFERRED = deduced, not directly checked.
// evidence: REA labels resolved to ids from work/re/extract/stages/evidence/evidence.json at build time.
const DECODE_FACTS = [
  { id: 'cpsa-regs', status: 'OBSERVED', fact: 'CPS-A words: 0 OBJ, 1/2/3 scroll1/2/3 base, 4 rowscroll ("other") base, 5 palette base, 6..11 scroll1/2/3 x/y, 16 rowscroll offset, 17 video control. This game: scroll bases 0x9080/0x90C0/0x9100 (0x908000/0x90C000/0x910000), palette 0x9140, rowscroll base 0x9158 (title screens move the scroll2/3 bases to 0x91C0/0x9200).', evidence: ['s02-irq-bases', 's03-video-palette-ctrl'] },
  { id: 'tilemaps', status: 'OBSERVED', fact: '64x64 tiles per layer, 2 words per tile (code, attr), 0x4000 bytes. Memory offset of (col,row): scroll1 (row&0x1f)+(col<<5)+((row&0x20)<<6), scroll2 (row&0x0f)+(col<<4)+((row&0x30)<<6), scroll3 (row&7)+(col<<3)+((row&0x38)<<6) (MAME cps1 scan functions; the game computes the same addresses at 0x20650, 0x214C0, 0x23090).', evidence: ['s06-map-address', 's11-scroll3-address'] },
  { id: 'attr', status: 'OBSERVED', fact: 'attr bits 0-4 palette (page 1/2/3), bit 5 flipX, bit 6 flipY, bits 7-8 priority group; bits 10-15 of scroll2 attributes are the terrain type read by the collision code (rol #6 & 0x3F at 0x13646), not used by the video hardware.', evidence: ['s19-terrain-lookup'] },
  { id: 'gfx', status: 'OBSERVED', fact: 'Code units are 64 bytes (one 8x8 tile) of the 4 MB graphics. scroll1 code c = bytes c*64, left half of each 8-byte row for even tilemap columns, right half for odd (MAME get_tile0_info: gfxset = BIT(tile_index, 5)); scroll2 code c = bytes c*128 (same 16x16 format as OBJ); scroll3 code (c & 0x3FFF, get_tile2_info) = bytes c*512 (32x32, 16 bytes per row). Gfx bank mapper CD63B as read from MAME master src/mame/capcom/cps1_v.cpp (mapper_CD63B_table, "verified from PAL dump"): two ranges for ALL gfx types, 0x00000-0x07FFF bank 0 and 0x08000-0x0FFFF bank 1 in 8x8-tile units (gfxrom_bank_mapper shifts the code by 0/1/1/3 for scroll1/OBJ/scroll2/scroll3 before the lookup; bank sizes 0x8000 + 0x8000), i.e. the identity over the whole ROM for every layer. The per-layer ranges the previous report quoted (scroll1 0x0000-0x0FFF, OBJ 0x1000-0xDFFF, scroll2 0x8000-0xDFFF, scroll3 0xE000-0xFFFF) were a recollection of an older table and are withdrawn; the decoder no longer restricts codes. Rendering confirms it: every code the game used decoded to the pixels MAME showed (validation).', source: 'https://raw.githubusercontent.com/mamedev/mame/master/src/mame/capcom/cps1_v.cpp (fetched 2026-10-21)' },
  { id: 'screen', status: 'OBSERVED', fact: 'Visible 384x224 = bitmap (64..447, 16..239); tilemap x = bitmap x + scrollX, y = bitmap y + scrollY. scroll2 registers: x = camX - 0x40, y = 0x300 - camY; scroll3: x = X3 - 0x40, y = 0x700 - Y3; scroll1: x = [0xFF86C4] - 0x40, y = 0x100 - [0xFF86C8]; the game latches each camera one frame (0xFF885C..0xFF8870) before writing.', evidence: ['s01-scroll-regs'] },
  { id: 'rowscroll', status: 'OBSERVED', fact: 'Rowscroll (video control bit 0) is used only in EPISODE 3 HELL ROAD (0x20710 sets bit 0 of 0xFF8026, written to 0x800122 at 0x826); scroll2 row i uses scrollX + other[(i + offset) & 0x3FF]. Live HELL ROAD frames matched pixel-exact with it.', evidence: ['s05-hellroad-rowscroll', 's03-video-palette-ctrl'] },
  { id: 'hellroad-rowscroll', status: 'OBSERVED', fact: 'HELL ROAD rowscroll band (0x23390): only rowscroll words 0x90-0xAF (screen rows 128-159, offset 0) are non-zero; word 0x90+i = ((camX - (32-i)*(camX>>1)) - camX) >> 5 (& 0xFF when >= 0x180) with the RAM camera X of the previous frame, i.e. row 159 scrolls at ~63/64 of the camera and row 128 at 1/2 (a perspective ground band). Emulating the routine reproduced every live word.', evidence: ['s23-hellroad-rowscroll-values'] },
  { id: 'player-clamp', status: 'OBSERVED', fact: 'Player clamp 0x4FCE (from the player handler, 0x18E98): X - camX - 0x10 in [0, 0x160) and (depth + floor) - camY - 0x10 in [0, 0x90), i.e. the feet stay within screen x 16..367 and screen y 81..224 (y = camY + 240 - depth - floor). This is only the screen window; the lane limits the player feels come from the terrain push walls (see terrain-collision). In E7 area 1 (0xFF84DC set) fixed limits are used instead (0x500C).', evidence: ['s24-player-screen-clamp'] },
  { id: 'terrain-collision', status: 'OBSERVED', fact: 'Collision 0x1309C (callers 0x12CD0/0x12E3C, retried up to 5 times while it returns carry): type = scroll2 attribute bits 10-15 at (X, h = depth + floor); type 0 returns at once (free). Behaviour entry 0x1370C + type*16: class word 0 -> jump table 0x1313E. Class 0 types 1-8 are one-sided push walls (word 1: 0 up, 4 down, 8 left, 0xC right; word 5 = repeat), so the lane limits of every area are terrain, not the screen clamp (E1 area 0: free cells only at h 288..335 under push-down cells, as the live probes show). Class 4 slopes: floor slope lifts the feet to s = (((w2 ? x : 15-x) >> w3) + w4 + 1) inside the cell, ceiling slope pushes them down to 15 - s, w1 8/0xC are diagonal walls from the h fraction (E8 area 2 ramp: types 28-31 ceilings y <= 14/10/6/2 - (x >> 2), E7 area 0 types 52/53 floors y >= (x >> 1) + 1/9, both matching the live feet exactly). Class 8 corner pushes always move one axis. Classes 0xC/0x10/0x1C are platform cells against the stage platform height word[0x12C40 + stage*2] (0xFF86B0: E1 0x20, E2 0x40, E3 0x20, E4 0x10, E5-E8 0x20): the interior raises the floor (+0x56), the edges push while the object is below it. Class 0x18 diagonal walls. Class 0x14 (type 21) and 0x20 (type 63 water, 0x13646 lowers the height = wading) leave the position alone. lib/terrain.cjs emulates it; the emulation left all 1,546 on-ground samples of the verifier\'s probe runs in place (see validation.depth).', evidence: ['s19-terrain-lookup', 's25-terrain-classes', 's26-terrain-push-walls', 's27-terrain-slopes', 's28-terrain-corners-platforms', 's29-terrain-diagonals', 's30-platform-height-and-floor-pointer', 's33-collision-caller'] },
  { id: 'floor-lists', status: 'OBSERVED', fact: 'Floor height +0x54 (ground level under the feet; depth + floor is the map row used by the terrain lookup and the screen position) comes from per-stage/area lists at 0x12C30 (pointer 0xFF86AC, advanced with the camera by 0x12C90), 12-byte entries (mode, x0, x1, w3, w4, flags) read by 0x12FE4/0x1302C for the first entry with x1 >= X: mode 0 flat floor w4 (byte 7 -> +0x52), mode 1 slope w3 + (X - x0)/4 when w4 == 0, else w3 - 1 - (X - x0)/4; flag 0x100 -> +0x53 (wading). Non-zero floors: E2 areas 0/1 (mud swamp: 64, ramps to 0 and 24, then 56), E6 areas 1/2 (30 / 1), E8 area 1 (16, wading) and E8 area 2 (256 falling to 128 and 0: the descending cave; live floor 255 at X 512).', evidence: ['s32-floor-list', 's30-platform-height-and-floor-pointer'] },
  { id: 'e7a1-collision-map', status: 'OBSERVED', fact: 'E7 area 1 (0xFF84DC set): the collision reads a 32x16-cell map at 0x91C000/0x91C400 built by 0x12C16 -> 0x12C50 from blocks 0xC/0xD of the chunk-word table 0x141DC8 (128 bytes per block) and the 16-byte chunks at 0x16E188, column-major (64 bytes per 16-px column). The lookup 0x136E4 masks X with 0x1F0 and h with 0xF0, so the map repeats over the 14336-px shaft; the clamp is fixed (0x500C: X 0x10..0x170, depth 0x10..0xA0). Live: P1 keeps depth 32..63 and X 128..319 (the free cells of the map) while the camera scrolls the shaft.', evidence: ['s31-collision-map-builder', 's34-e7a1-lookup', 's24-player-screen-clamp'] },
  { id: 'scroll3-beyond-width', status: 'OBSERVED', fact: 'The scroll3 streamer never checks the width byte of the area entry: 0x230BE reads block map[(X3 >> 8) * rows + (Y3 >> 8)] for every X3 the camera reaches, so past the declared columns it shows whatever follows the block map in ROM. E2 map 0 declares 6 columns, but with shift 1 over the 3840-px playfield the camera reaches X3 1856 + 384 and the 3 columns that follow are real jungle blocks (the live cells equal the ROM read past the width); E6/E7/E8 map 0 stream blank blocks there. The ROM maps are rendered to every reachable column (G.cols3Needed) and the live comparison covers them.', evidence: ['s11-scroll3-address', 's09-scroll3-area'] },
  { id: 'layer-control', status: 'OBSERVED', fact: 'CPS-B layer control = word 0x0A (0x80014A), written from 0xFF8028: 0x12D6 = draw order scroll3, scroll2, sprites, scroll1; E7 area 1 uses 0x06D6 = scroll3, scroll2, scroll1, sprites (scroll1 is an extra background there). Palette control = word 0x04 (0x3F, all 6 pages). Priority pen masks for groups 0-3 = words 0x0C, 0x0E, 0x00, 0x02. This matches MAME master cps1_v.cpp: dino uses CPS_B_21_QS2 (ctrl 0x0a, priority {0x0c, 0x0e, 0x00, 0x02}, palctrl 0x04, "layer enable never used"); render_layers draws sprites first and then l1..l3 with l_n = (layercontrol >> 6/8/10/12) & 3, the masks are cps_b_regs[priority[i]/2] ^ 0xFFFF applied with set_transmask (pens in the mask cover the sprites), the background is pen 0xBFF, and scroll2 rowscroll (video control bit 0) adds other[(row + otheroffs) & 0x3FF].', source: 'https://raw.githubusercontent.com/mamedev/mame/master/src/mame/capcom/cps1_v.cpp (fetched 2026-10-21)', evidence: ['s03-video-palette-ctrl', 's04-area-load', 's13-priority'] },
  { id: 'map-format', status: 'OBSERVED', fact: 'scroll2 maps: area table 0x21580 (10-byte entries: width, rows, block map, camera X0, Y0) -> column-major block map of 256x256 blocks -> 8x8 chunks of 32x32 (L2 table 0x2155E per stage, chunk word at block*128 + cx*16 + 14 - cy*2) -> 2x2 tiles (L3 table 0x21454 per stage, 16 bytes per chunk). scroll3: area table 0x2311E, block map & 0x7F, block data 0x177288 + block*256 of 8x8 32x32 tiles. Every live tilemap of the 9 walks matched these ROM renders except cells the game rewrites (doors, windows, priority/terrain patches, animated tiles).', evidence: ['s04-area-load', 's06-map-address', 's07-chunk-tiles', 's09-scroll3-area', 's11-scroll3-address'] },
  { id: 'world', status: 'OBSERVED', fact: 'World X grows right, map height h grows up; map pixel (X, h) is on screen at (X - camX, camY + 239 - h). Collision samples h = depth + floor (P1 +0x54) in the same map, so the walkable floor is the terrain-class-0 region of the playfield map.', evidence: ['s01-scroll-regs', 's19-terrain-lookup'] },
  { id: 'parallax', status: 'OBSERVED', fact: 'scroll3 X3 = camX >> shift with shift = byte[0x22DE4 + word[0x22DE4 + stage*2] + area] (E1 3,0,3; E2 1,1,5; E3 3; E4 1,1,2; E5 1,1; E6 1,1,1; E7 2,4,0,0; E8 1,1,1, continuing areas keep the previous shift). Y3 = y0_3 + ((camY - y0_2) >> shift) where byte[0x22E54 + stage*4 + area] != 0 (E1 a2, E7 a1, E8 a1), else y0_3; segment state 5 sets Y3 = camY/16 - 0x60, state 9 Y3 = 0x200 - ([0xFF8798] - camY)/2.', evidence: ['s10-scroll3-parallax'] },
  { id: 'palettes', status: 'OBSERVED', fact: 'Area palettes from ROM (0x8A44): OBJ = 32 indices at long[0x8E8E + s*16 + a*4] into 0xB7A52 (32 bytes each), scroll1 = 0xBBA52, scroll2 = long[0x8AE0 + s*16 + a*4], scroll3 = long[0x8C52 + s*16 + a*4]. Stored at brightness 0; fades step the nibble to 0xF. Live pages matched the ROM pages at area start (12-bit); some areas animate palettes afterwards (see paletteAnimation).', evidence: ['s12-palettes', 's14-obj-palettes', 's15-fades'] },
  { id: 'segments', status: 'OBSERVED', fact: 'Segment script 0x21B2A (word offset per stage, 16-byte segments): +0 camera-X trigger (camera-Y trigger when byte +0xF is set, E7 area 1), +2 camera-Y limit/trigger, +4 scroll lead (when +0xD set), +6/+8 vertical follow margins (when +0xC set), +0xA area, +0xB state, +0xE state after a lock. A segment fires when camX >= trigger; its state picks the camera behaviour (table 0x2092E). State names in stages.json are INFERRED from the handler code.', evidence: ['s16-segments', 's17-segment-dispatch', 's18-camera-follow'] },
  { id: 'areas', status: 'OBSERVED', fact: 'An area whose first segment has trigger 0 starts with a fade and a fresh map (state 1 -> 0x20C6A -> 0x20766); the others continue the previous map (state 8 at 0x20E78 only increments the area byte): E2 area 1, E5 area 1, E6 area 2 and E8 area 3.', evidence: ['s20-area-continue', 's21-area-exit'] },
  { id: 'title-screens', status: 'OBSERVED', fact: 'Title, select and intermission screens are drawn from blocks by 0x20454 (scroll1 chunks 0x15CFE8), 0x204CA (scroll2 chunks 0x175378, blocks 0x145DC8) and 0x20592 (scroll3 blocks 0x177288); exported here from live captures (screens/).', evidence: ['s22-title-screens'] },
];

// ---------------------------------------------------------------- live capture (MAME)
// Per-frame log (PEEK, before the harness dump of that frame): camera, scroll registers, P1, stage/area/controller.
const WALK_LUA = String.raw`
local W = { lastX = 0, stuck = 0, mode = 0, modeT = 0, endAt = nil, upFirst = true }
function PEEK(n)
  local main = rb(0xFF84D0)
  HLOG(fmt('{"n":%d,"mf":%d,"m":%d,"st":%d,"ar":%d,"cx":%d,"cy":%d,"x3":%d,"y3":%d,"x1":%d,"y1":%d,"c5":%d,"c6":%d,"seg":%d,"px":%d,"ph":%d,"pd":%d,"p0":%d,"pv":%d,"s1x":%d,"s1y":%d,"s2x":%d,"s2y":%d,"s3x":%d,"s3y":%d,"vc":%d,"lc":%d,"dc":%d,"t":%d,"in":%d,"br":%d,"p54":%d}',
    n, scr:frame_number(), main, rb(0xFF84D9), rb(0xFF8786), rw(0xFF8744), rw(0xFF8748), rw(0xFF87E4), rw(0xFF87E8), rw(0xFF86C4), rw(0xFF86C8),
    rb(0xFF8741), rb(0xFF8742), rb(0xFF87A8), rw(0xFFB27C), rsw(0xFFB280), rw(0xFFB284), rb(0xFFB274), rb(0xFFB27B),
    cpsa:read_u16(0x0C), cpsa:read_u16(0x0E), cpsa:read_u16(0x10), cpsa:read_u16(0x12), cpsa:read_u16(0x14), cpsa:read_u16(0x16),
    cpsa:read_u16(0x22), cpsb:read_u16(0x0A), rb(0xFF84DC), rw(0xFF84E8), W.mode, space:read_u16(0x900000 + gbase(0x0A, 0x400) + 0x800) >> 12, rw(0xFFB2C8)))
  if (main == 8 or main == 0x1C) and n > 100 and not W.endAt then W.endAt = n + (BOT_TAIL or 30) end
  -- stall stop: the camera, area and stage have not changed for STALL frames (e.g. a boss that ENEMY CLEAR cannot end)
  local key = rw(0xFF8744) * 65536 + rw(0xFF8748) + rb(0xFF8786) * 7 + rb(0xFF84D9) * 131
  if key ~= W.key then W.key = key W.since = n end
  if not W.endAt and n > 600 and n - W.since > (STALL or 900) then W.endAt = n + 1 HLOG(fmt('{"stall":%d}', n)) end
  if W.endAt and n >= W.endAt then exit_at = n end
end
function HOOK(n)
  -- bot: Right is held by plan.inputs. When P1 stops gaining X for BOT_PATIENCE frames, switch between
  -- right, right+up and right+down; keep whichever mode makes progress (stairs and slopes need one of them).
  local px = rw(0xFFB27C)
  if px > W.lastX then W.lastX = px W.stuck = 0 else W.stuck = W.stuck + 1 end
  if px + 64 < W.lastX then W.lastX = px end
  if W.stuck > (BOT_PATIENCE or 40) then W.mode = (W.mode + 1) % 3 W.stuck = 0 end
  fields["P1 Up"]:set_value(W.mode == 1 and 1 or 0)
  fields["P1 Down"]:set_value(W.mode == 2 and 1 or 0)
  if TIMER_WORD then ww(0xFF84E8, TIMER_WORD) end
  -- unstick: when the camera has not moved for TELEPORT_AFTER frames in a free-scroll segment (state 0) and P1 stands
  -- on the ground, move P1 right onto the nearest passable cell (terrain class 0, read from the live scroll2 tilemap
  -- attribute bits 10-15 and the behaviour table 0x1370C, as the collision code 0x1309C does)
  if TELEPORT_AFTER and W.since and n - W.since > TELEPORT_AFTER and rb(0xFF8741) == 0 and rsw(0xFFB280) == rsw(0xFFB2C8) then
    local cam, px, pd, fl = rw(0xFF8744), rw(0xFFB27C), rw(0xFFB284), rsw(0xFFB2C8)
    local b = gbase(4, 0x4000)
    local function pass(X, h)
      if h < 0 then return false end
      local col, row = (X >> 4) & 0x3f, ((1023 - h) >> 4) & 0x3f
      local attr = space:read_u16(0x900000 + b + ((row & 0x0f) + (col << 4) + ((row & 0x30) << 6)) * 4 + 2)
      return space:read_u16(0x1370C + (attr >> 10) * 16) == 0
    end
    local done = false
    for dx = 160, 32, -16 do
      if px + dx < cam + 360 and not done then
        for k = 0, 40 do
          local dd = ((k % 2 == 0) and 1 or -1) * ((k + 1) // 2) * 8
          local h = pd + fl + dd
          if pass(px + dx, h) and pass(px + dx, h + 8) and pass(px + dx, h - 8) then
            ww(0xFFB27C, px + dx) ww(0xFFB284, pd + dd)
            HLOG(fmt('{"teleport":%d,"from":[%d,%d],"to":[%d,%d],"cam":%d}', n, px, pd, px + dx, pd + dd, cam))
            done = true W.since = n break
          end
        end
      end
    end
    if not done then W.since = n - TELEPORT_AFTER // 2 end
  end
  if EXTRA_HOOK then EXTRA_HOOK(n) end
end
`;

function walkPlan(ep, { frames = 24000, every = 8, snapEvery = 60, hideEvery = 480, hero = 'jack', extra = '', name = null, loadState = null, cheats = null } = {}) {
  return {
    name: name || `stg-ep${ep}-walk`,
    frames,
    loadState: loadState || `stage${ep}-${hero}`,
    cheats: cheats || [{ cheat: 'invuln' }, { cheat: 'killAll', every: 45, from: 30 }],
    inputs: [{ from: 2, to: frames - 1, keys: ['right'] }],
    dump: { from: 0, to: frames - 1, every, obj: false, cpsA: true, allPalettes: true, scroll: true },
    snapshotEvery: { from: 0, to: frames - 1, every: snapEvery },
    // sprite-free frames for the layer validation: the OBJ end marker poked at frame f empties exactly snapshot f
    // (tools/re/mame/README.md, "Timing"); f is a multiple of the dump interval, so the tilemaps are dumped too
    pokes: Array.from({ length: Math.floor((frames - 1) / hideEvery) }, (_, k) => ({ from: (k + 1) * hideEvery, to: (k + 1) * hideEvery, rel: 'obj', addr: 6, size: 2, value: 0xff00 })),
    hook: 'TIMER_WORD = 0x0300\nTELEPORT_AFTER = 240\n' + extra + '\n' + WALK_LUA,
  };
}

async function live(eps) {
  for (const ep of eps) {
    for (const opts of [LIVE_OPTS[ep] || {}, ...(EXTRA_WALKS[ep] || [])]) {
      const plan = walkPlan(ep, opts);
      const t0 = Date.now();
      const s = await rt().runPlan(plan, { quiet: true });
      const log = readHook(plan.name);
      const last = log[log.length - 1] || {};
      console.log(`[live] ${plan.name}: ok ${s.ok}, ${((Date.now() - t0) / 1000).toFixed(1)} s, frames ${s.lastFrame}, end main ${hex(last.m || 0)} stage ${last.st} area ${last.ar} camX ${last.cx}`);
    }
  }
}
// per-episode tweaks of the walk, and extra walks for areas the main walk cannot reach (a lock that ENEMY CLEAR
// does not end): E7 area 3 is entered with the warpArea cheat (its first segment has trigger 0)
const LIVE_OPTS = {};
const EXTRA_WALKS = {
  7: [{ name: 'stg-ep7b-walk', frames: 12000, cheats: [{ cheat: 'invuln' }, { cheat: 'killAll', every: 45, from: 60 }, { cheat: 'warpArea', area: 3, at: 10 }] }],
};
const runsOf = ep => [`stg-ep${ep}-walk`, ...(EXTRA_WALKS[ep] || []).map(x => x.name)];
const hookOf = ep => runsOf(ep).flatMap(r => readHook(r).map(x => Object.assign(x, { run: r })));

function readHook(name) {
  const f = path.join(RUNS, name, 'hook.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{"n"')).map(l => JSON.parse(l));
}
function readFrames(name) {
  const f = path.join(RUNS, name, 'frames.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// ---------------------------------------------------------------- stage / area structure (ROM)
// Areas come from the segment script. An area whose first segment has trigger 0 starts with a cut (fade, new map:
// 0x20C6A -> 0x20766); any other area continues the map of the area before it (state 8 at 0x20E78: area++ only).
function stageInfo(s) {
  const sc = G.script(s), areas = [];
  for (const a of G.stageAreas(s)) {
    const segs = sc.segs.filter(g => g.area === a), first = segs[0];
    const cut = first.i === 0 || first.trigger === 0;
    const prev = areas[areas.length - 1];
    const mapArea = cut ? a : prev.mapArea;
    areas.push({ area: a, segs, cut, mapArea, firstTrigger: first.trigger, lastTrigger: segs[segs.length - 1].trigger });
  }
  return { s, ep: s + 1, script: sc, areas };
}
const INFO = []; for (let s = 0; s < G.NSTAGE; s++) INFO.push(stageInfo(s));
const mapAreaOf = (s, a) => { const i = INFO[s].areas.find(x => x.area === a); return i ? i.mapArea : a; };

// cached ROM renders per (stage, map area)
const ROMCACHE = new Map();
function romMaps(s, ma) {
  const k = s * 16 + ma;
  // scroll3 is rendered to every column the camera can stream (G.cols3Needed), not just the declared width
  if (!ROMCACHE.has(k)) ROMCACHE.set(k, { m2: G.renderMap2(s, ma), m3: G.renderMap3(s, ma, { cols: G.cols3Needed(s, ma) || null }) });
  return ROMCACHE.get(k);
}
// terrain type under a map pixel of (stage, map area): the scroll2 attribute bits 10-15 (E7 area 1: the 0x91C000 map)
const SHAFT = TR.e7ShaftMap();
function typeAtFn(s, ma) {
  if (s === 6 && ma === 1) return SHAFT.typeAt;
  const m = romMaps(s, ma).m2; if (!m) return () => -1;
  const cw = m.img.w >> 4;
  return (X, h) => { const x = wrapX2(s, X), iy = m.img.h - 1 - h; if (x < 0 || x >= m.img.w || iy < 0 || iy >= m.img.h) return -1; return m.img.terrain[(iy >> 4) * cw + (x >> 4)]; };
}
const wrapX2 = (s, X) => { if (s === 2) { let x = X; while (x >= 0x4d00) x -= 0xf00; return x; } return X; };
const wrapX3 = (s, X) => { if (s === 2) { let x = X; while (x >= 0xa00) x -= 0x100; return x; } return X; };

// ---------------------------------------------------------------- live vs ROM
// Compare one dumped frame's visible scroll2/scroll3 windows (pen + palette per pixel, and the 16x16 tile entries of
// scroll2 including the terrain bits) with the ROM render of the area's map at the same world position.
function compareFrame(run, fr, hk) {
  const F = S.loadFrame(run, fr), Rg = S.regs(F), s = hk.st, ma = mapAreaOf(s, hk.ar), { m2, m3 } = romMaps(s, ma);
  const res = { n: fr.f, st: s, ar: hk.ar, ma, main: hk.m };
  const camX = (Rg.s[2].x + 64) & 0xffff, camY = (0x300 - Rg.s[2].y) & 0xffff;
  res.camX = camX; res.camY = camY;
  if (m2) {
    const L = S.screenLayer(F, 2), img = m2.img;
    let same = 0, tot = 0, out = 0;
    // world position of each screen pixel from the tilemap pixel MAME shows there (handles HELL ROAD's rowscroll)
    for (let y = 0; y < 224; y++) for (let x = 0; x < 384; x++) {
      const q = y * 384 + x, X = wrapX2(s, camX - 256 + ((L.tx[q] - camX + 256) & 0x3ff)), h = camY - 256 + (((1023 - L.ty[q]) - camY + 256) & 0x3ff), iy = img.h - 1 - h;
      if (X < 0 || X >= img.w || iy < 0 || iy >= img.h) { out++; continue; }
      const p = iy * img.w + X; tot++;
      if (L.pen[q] === img.pen[p] && (L.pen[q] === 15 || L.pal[q] === img.pal[p])) same++;
    }
    // tile entries (code + full attribute word) of the visible cells
    let tsame = 0, ttot = 0;
    const x0 = camX & ~15, h0 = (camY + 16) & ~15;
    for (let X = x0; X < camX + 384; X += 16) for (let h = h0; h < camY + 240; h += 16) {
      const Xw = wrapX2(s, X); if (Xw < 0 || Xw >= img.w || h < 0 || h >= img.h) continue;
      const tx = (X & 0x3ff) >> 4, ty = ((1023 - h) & 0x3ff) >> 4, live = S.tileEntry(F, 2, tx, ty);
      const rom = img.tiles.get(`${Xw >> 4},${(img.h - 1 - h) >> 4}`);
      ttot++; if (rom && rom.code === live.code && rom.attr === live.attr) tsame++;
    }
    Object.assign(res, { s2: { same, tot, out, pct: tot ? +(100 * same / tot).toFixed(3) : null }, s2tiles: { same: tsame, tot: ttot } });
  }
  const X3 = (Rg.s[3].x + 64) & 0xffff, Y3 = (0x700 - Rg.s[3].y) & 0xffff;
  res.X3 = X3; res.Y3 = Y3;
  if (m3) {
    const L = S.screenLayer(F, 3), img = m3.img;
    let same = 0, tot = 0, out = 0;
    for (let y = 0; y < 224; y++) for (let x = 0; x < 384; x++) {
      const q = y * 384 + x, X = wrapX3(s, X3 + x), h = Y3 + 239 - y, iy = img.h - 1 - h;
      if (X < 0 || X >= img.w || iy < 0 || iy >= img.h) { out++; continue; }
      const p = iy * img.w + X; tot++;
      if (L.pen[q] === img.pen[p] && (L.pen[q] === 15 || L.pal[q] === img.pal[p])) same++;
    }
    res.s3 = { same, tot, out, pct: tot ? +(100 * same / tot).toFixed(3) : null };
  }
  // palettes (12-bit colour, brightness ignored) against the ROM pages of the current area
  const P = G.palettes(s, hk.ar), w = F.pal.words, cmp = (off, rom) => { let k = 0; for (let i = 0; i < 512; i++) if ((w[off + i] & 0xfff) === (rom[i] & 0xfff)) k++; return k; };
  res.pal = { obj: cmp(0, P.obj.words), s1: cmp(512, P.scroll1.words), s2: cmp(1024, P.scroll2.words), s3: cmp(1536, P.scroll3.words), bright: w[1024] >> 12 };
  return res;
}

function compareRun(run) {
  const hk = new Map(readHook(run).map(r => [r.n, r]));
  const out = [];
  for (const fr of readFrames(run)) {
    if (!fr.scroll) continue;
    const h = hk.get(fr.f); if (!h || h.m !== 0xc) continue;
    out.push(compareFrame(run, fr, h));
  }
  return out;
}

// ---------------------------------------------------------------- images
const newRGBA = (w, h) => ({ w, h, d: new Uint8Array(w * h * 4) });
const savePNG = (file, im) => { mkdir(path.dirname(file)); R.writePNG(file, im.w, im.h, im.d); };
const loadPNG = file => { const p = R.readPNG(fs.readFileSync(file)); return { w: p.w, h: p.h, d: new Uint8Array(p.data) }; };
const FONT = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111', '-': '000000111000000', '.': '000000000000010', ' ': '000000000000000', ':': '000010000010000', '+': '000010111010000', '/': '001001010100100', '=': '000111000111000', "'": '010010000000000', x: '000101010101000', '(': '010100100100010', ')': '010001001001010', ',': '000000000010100',
};
function text(im, x0, y0, str, sc = 2, col = [255, 255, 120]) {
  [...String(str).toUpperCase()].forEach((ch, n) => {
    const g = FONT[ch] || FONT[' '];
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r * 3 + q] === '1') for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) {
      const x = x0 + n * 4 * sc + q * sc + b, y = y0 + r * sc + a; if (x < 0 || y < 0 || x >= im.w || y >= im.h) continue;
      const d = (y * im.w + x) * 4; im.d[d] = col[0]; im.d[d + 1] = col[1]; im.d[d + 2] = col[2]; im.d[d + 3] = 255;
    }
  });
}

// terrain colours by behaviour class (first word of the 16-byte entry at 0x1370C + type*16; 0x20 is handled as 0x14)
const TERRAIN_TABLE = 0x1370c;
const terrainClass = t => R.u16(TERRAIN_TABLE + t * 16);
const CLASS_RGB = { 0x00: [230, 50, 50], 0x04: [240, 230, 40], 0x08: [240, 140, 30], 0x0c: [40, 160, 160], 0x10: [40, 220, 230], 0x14: [60, 220, 90], 0x18: [170, 60, 230], 0x1c: [255, 255, 255], 0x20: [60, 120, 255] };

// sample the ROM maps in world coordinates (X right, h up), with the HELL ROAD wraps
function px2(s, ma, X, h) {
  const m = romMaps(s, ma).m2; if (!m) return -1;
  const x = wrapX2(s, X), iy = m.img.h - 1 - h;
  if (x < 0 || x >= m.img.w || iy < 0 || iy >= m.img.h) return -1;
  return iy * m.img.w + x;
}
function px3(s, ma, X, h) {
  const m = romMaps(s, ma).m3; if (!m) return -1;
  const x = wrapX3(s, X), iy = m.img.h - 1 - h;
  if (x < 0 || x >= m.img.w || iy < 0 || iy >= m.img.h) return -1;
  return iy * m.img.w + x;
}

// ---------------------------------------------------------------- static (ROM only)
function staticExport() {
  const dir = path.join(OUT, 'rom'); mkdir(dir);
  const maps = [];
  for (const I of INFO) {
    const s = I.s;
    for (const A of I.areas.filter(a => a.cut)) {
      const ma = A.area, { m2, m3 } = romMaps(s, ma), P = G.palettes(s, ma), e2 = G.areaEntry(G.T.area2, s, ma), e3 = G.areaEntry(G.T.area3, s, ma);
      const base = `ep${I.ep}-map${ma}`, rec = { ep: I.ep, map: ma, files: {} };
      if (m2) {
        savePNG(path.join(dir, `${base}-scroll2.png`), { w: m2.img.w, h: m2.img.h, d: G.toRGBA(m2.img, P.scroll2.rgb) });
        const t = newRGBA(m2.img.w, m2.img.h), cw = m2.img.w >> 4, used = {};
        for (let cy = 0; cy < (m2.img.h >> 4); cy++) for (let cx = 0; cx < cw; cx++) {
          const ty = m2.img.terrain[cy * cw + cx]; used[ty] = (used[ty] || 0) + 1; if (!ty) continue;
          const c = CLASS_RGB[terrainClass(ty)] || [128, 128, 128];
          for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = ((cy * 16 + y) * t.w + cx * 16 + x) * 4; const edge = x === 0 || y === 0; t.d[d] = c[0]; t.d[d + 1] = c[1]; t.d[d + 2] = c[2]; t.d[d + 3] = edge ? 220 : 150; }
        }
        savePNG(path.join(dir, `${base}-terrain.png`), t);
        rec.scroll2 = { entry: hex(e2.entry), widthByte: e2.b0, rows: e2.rows, blockMap: hex(e2.map), columnsInData: m2.W, size: [m2.img.w, m2.img.h], cameraStart: [e2.x0, e2.y0], L2: hex(m2.L2), L3: hex(m2.L3), ...m2.stats, palette: hex(P.scroll2.ptr) };
        rec.terrainTypes = Object.fromEntries(Object.entries(used).map(([k, v]) => [k, { cells: v, class: hex(terrainClass(+k), 2), behaviour: TR.describe(+k) }]));
        rec.files.scroll2 = `rom/${base}-scroll2.png`; rec.files.terrain = `rom/${base}-terrain.png`;
      }
      if (m3) {
        savePNG(path.join(dir, `${base}-scroll3.png`), { w: m3.img.w, h: m3.img.h, d: G.toRGBA(m3.img, P.scroll3.rgb) });
        const beyondBlank = (() => { if (m3.W <= e3.b0) return null; for (let q = 0; q < m3.img.w * m3.img.h; q++) if (m3.img.pen[q] !== 15 && (q % m3.img.w) >= e3.b0 * 256) return false; return true; })();
        rec.scroll3 = { entry: hex(e3.entry), columns: e3.b0, declaredColumns: e3.b0, renderedColumns: m3.W, columnsBeyondDeclared: m3.W - e3.b0, beyondDeclaredBlank: beyondBlank, rows: e3.rows, blockMap: hex(e3.map), size: [m3.img.w, m3.img.h], start: [e3.x0, e3.y0], ...m3.stats, palette: hex(P.scroll3.ptr), shift: G.shiftOf(s, ma), verticalParallax: !!G.vflagOf(s, ma), note: 'rendered to every column the camera can stream (the streamer ignores the width byte); columns past the declared width read the ROM after the block map, as the game does' };
        rec.files.scroll3 = `rom/${base}-scroll3.png`;
      } else rec.scroll3 = { entry: hex(e3.entry), none: true, note: 'no scroll3 map for this area (entry rows/columns 0); the layer keeps what it held' };
      if (s === 6 && ma === 1) {
        // scroll1 is not scrolled there (x = -0x40, y = 0x100): the visible part is tilemap (0..383, 272..495), a fixed
        // 384x224 screen layer drawn above scroll2 and below the sprites. The HUD shares its top rows at run time.
        const b = G.renderScroll1Bg(), full = G.toRGBA(b, P.scroll1.rgb), crop = newRGBA(384, 224);
        for (let y = 0; y < 224; y++) for (let x = 0; x < 384; x++) for (let k = 0; k < 4; k++) crop.d[(y * 384 + x) * 4 + k] = full[((y + 272) * 512 + x) * 4 + k];
        savePNG(path.join(OUT, 'ep7-area1-scroll1bg.png'), crop);
        rec.files.scroll1bg = 'ep7-area1-scroll1bg.png';
        rec.scroll1bg = { note: 'E7 area 1 draws scroll1 blocks 1 and 2 (0x20778 -> 0x205C6, blocks 0x138C48, chunks 0x15CFE8) and sets layer control 0x06D6 (scroll3, scroll2, scroll1, sprites). scroll1 stays at x = -0x40, y = 0x100, so this 384x224 image is a fixed screen layer over the shaft; it matched the live scroll1 tilemap except the HUD rows' };
        // the shaft's collision map (0x91C000, 32x16 cells of 16 px; image y = 255 - h)
        const cm = TR.e7ShaftMap(), ci = newRGBA(512, 256);
        for (let hc = 0; hc < 16; hc++) for (let c = 0; c < 32; c++) {
          const ty = cm.types[hc * 32 + c]; if (!ty) continue; const col = CLASS_RGB[terrainClass(ty)] || [128, 128, 128];
          for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = ((255 - (hc * 16 + y)) * 512 + c * 16 + x) * 4; ci.d[d] = col[0]; ci.d[d + 1] = col[1]; ci.d[d + 2] = col[2]; ci.d[d + 3] = (x === 0 || y === 0) ? 220 : 150; }
        }
        savePNG(path.join(dir, 'ep7-area1-collision.png'), ci); rec.files.collision = 'rom/ep7-area1-collision.png';
        rec.collisionMap = { size: [512, 256], blocks: ['0xC', '0xD'], blockTable: hex(TR.T.e7Blocks), chunkTable: hex(TR.T.e7Chunks), cells: Array.from({ length: 16 }, (_, hc) => Array.from({ length: 32 }, (_, c) => cm.types[hc * 32 + c])), typesUsed: Object.fromEntries([...new Set(cm.types)].filter(t => t).sort((x, y) => x - y).map(t => [t, TR.describe(t)])), note: 'E7 area 1 collision map built at 0x91C000/0x91C400 by 0x12C16 -> 0x12C50; cells[h >> 4][X >> 4] = terrain type; the lookup 0x136E4 wraps X at 512 and h at 256' };
      }
      maps.push(rec);
      console.log(`[static] ${base}: scroll2 ${m2 ? m2.img.w + 'x' + m2.img.h : '-'}, scroll3 ${m3 ? m3.img.w + 'x' + m3.img.h : '-'}`);
    }
  }
  return maps;
}

// ---------------------------------------------------------------- live summaries
// frames of a walk log that show a settled gameplay picture: main state 0xC, scroll2 palette at full brightness for
// this frame and the two frames before it (same run and area). After a fade-in the displayed scroll3 registers still
// hold the previous area's values for two frames at full brightness (e.g. stg-ep1-walk f1899: brightness 15 but
// s3x/s3y = X3 544 / Y3 0 of area 1; the live X3 0 / Y3 288 reach the registers at f1900).
function settled(log) {
  return log.filter((r, i) => {
    if (r.m !== 0xc || r.br !== 15) return false;
    for (let k = 1; k <= 2; k++) { const p = log[i - k]; if (!p || p.run !== r.run || p.n !== r.n - k || p.br !== 15 || p.m !== 0xc || p.ar !== r.ar || p.st !== r.st) return false; }
    return true;
  });
}
const dispCam = r => ({ camX: (r.s2x + 64) & 0xffff, camY: (0x300 - r.s2y) & 0xffff, X3: (r.s3x + 64) & 0xffff, Y3: (0x700 - r.s3y) & 0xffff });
const minmax = (v) => v.length ? [Math.min(...v), Math.max(...v)] : null;

function areaLive(ep, a) {
  const log = settled(hookOf(ep)).filter(r => r.st === ep - 1 && r.ar === a);
  if (!log.length) return null;
  const cams = log.map(dispCam);
  const ground = log.filter(r => r.ph === r.p54 && r.p0 !== 0);
  const s = ep - 1, ma = mapAreaOf(s, a), shift = shiftOf(s, ma);
  // parallax checks on the RAM values of the same frame, following the scroll3 update 0x22D70..0x22ED2:
  //  segment state 5 -> Y3 = max(0, (camY >> 4) - 0x60) while camY <= 0x2000, X3 kept (0x22E8C);
  //  state 9 -> Y3 from 0xFF8798 (not logged, not checked); states 0xE/0xF -> unchanged;
  //  other states (0x22E0A): nothing changes while the active segment's byte +0xF (controller +0x79) is set, else
  //  X3 = camX >> shift and Y3 = y0_3 + ((camY - y0_2) >> shift) when the vertical flag is set, else Y3 = y0_3
  const e2 = G.areaEntry(G.T.area2, s, ma), e3 = G.areaEntry(G.T.area3, s, ma), vflag = G.vflagOf(s, ma);
  const segs = INFO[s].script.segs;
  let px = 0, py = 0, checked = 0, frozen = 0, rule5 = 0;
  log.forEach((r, i) => {
    const prev = i ? log[i - 1] : null, active = segs[r.seg - 1], st = r.c5;
    let ex = null, ey = null;
    if (st === 5) { ex = prev ? prev.x3 : r.x3; ey = r.cy > 0x2000 ? (prev ? prev.y3 : r.y3) : Math.max(0, (r.cy >> 4) - 0x60); rule5++; }
    else if (st === 9) return;
    else if (st === 0xe || st === 0xf || (active && active.yTrigger)) { if (!prev) return; ex = prev.x3; ey = prev.y3; frozen++; }
    else { ex = (r.cx >>> shift) & 0xffff; ey = vflag ? (e3.y0 + ((r.cy - e2.y0) >> shift)) & 0xffff : e3.y0; }
    checked++; if (r.x3 === ex) px++; if (r.y3 === ey) py++;
  });
  return {
    frames: log.length, runs: log.map(r => r.run), firstFrame: log[0].n, lastFrame: log[log.length - 1].n,
    camX: minmax(cams.map(c => c.camX)), camY: minmax(cams.map(c => c.camY)), X3: minmax(cams.map(c => c.X3)), Y3: minmax(cams.map(c => c.Y3)),
    ramCamX: minmax(log.map(r => r.cx)), ramCamY: minmax(log.map(r => r.cy)),
    p1Depth: minmax(ground.map(r => r.pd)), p1Floor: minmax(ground.map(r => r.p54)), p1X: minmax(ground.map(r => r.px)), ground: ground.map(r => [r.px, r.pd + r.p54]),
    states: [...new Set(log.map(r => r.c5))].map(v => hex(v, 2)),
    layerControl: [...new Set(log.map(r => r.lc))].map(v => hex(v, 4)), videoControl: [...new Set(log.map(r => r.vc))].map(v => hex(v, 4)),
    rowscrollFrames: log.filter(r => r.vc & 1).length,
    parallaxX: { rule: `X3 = camX >> ${shift}`, framesMatching: px, of: checked, frozenFrames: frozen, state5Frames: rule5 },
    parallaxY: { rule: vflag ? `Y3 = ${e3.y0} + ((camY - ${e2.y0}) >> ${shift})` : `Y3 = ${e3.y0} (constant)`, framesMatching: py, of: checked },
    cams: log.map(r => [r.n, ...Object.values(dispCam(r))]),
  };
}
const shiftOf = (s, ma) => G.shiftOf(s, ma);

// Walkable band of an area from the ROM terrain, with the collision routine 0x1309C emulated for a grounded object
// (lib/terrain.cjs): per map X the run of h (= depth + floor) where the routine leaves the object in place, chosen
// as the run holding the live P1 ground samples at that X (walks + depth probes) and propagated to the other
// columns by overlap. Only type 0 (and the no-op/water classes) is free: types 1-8 are one-sided push walls, so the
// lane limits come from the map, not from the screen clamp.
function terrainBand(s, ma, X0, X1, h0, h1, samples, seedWindow) {
  return TR.bandProfile({ s, typeAt: typeAtFn(s, ma), X0, X1, h0, h1, samples, seedWindow });
}
// live P1 ground samples (height == floor, playing, inside the map) of an area from every run that logged them: the
// walks (fields px/pd/p54/ph/p0) and the depth probes stg-depth-* / vfy-depth-* (px/pd/fl/ph/p0). h = depth + floor.
const probeRuns = () => fs.existsSync(RUNS) ? fs.readdirSync(RUNS).filter(n => /^(stg-depth|vfy-depth)-/.test(n)).sort() : [];
function groundSamples(ep, a) {
  const s = ep - 1, out = [];
  const take = (rows, run) => { for (const r of rows) { if (r.m !== 0xc || !r.p0 || r.st !== s || r.ar !== a) continue; const fl = r.fl !== undefined ? r.fl : r.p54; if (fl === undefined || r.ph !== fl) continue; if (r.px >= 0x8000) continue; out.push({ X: r.px, h: r.pd + fl, depth: r.pd, floor: fl, run, n: r.n }); } };
  for (const run of runsOf(ep)) take(readHook(run), run);
  for (const run of probeRuns()) take(readHook(run), run);
  return out;
}
// classify a ground sample with the emulated routine: stable (left in place), atWall (pushed sideways by at most
// 8 px: the sample was logged after the move and before the push while the bot leaned on a wall), pushed, outsideMap
function classifySample(s, ma, q) {
  const t = typeAtFn(s, ma)(q.X, q.h); if (t < 0) return 'outsideMap';
  const c = TR.collide(s, t, q.X, q.h);
  return (c.dx === 0 && c.dh === 0) ? 'stable' : (c.dh === 0 && Math.abs(c.dx) <= 16 ? 'atWall' : 'pushed');
}

// ---------------------------------------------------------------- build
function buildArea(I, A, live, opts) {
  const s = I.s, ep = I.ep, a = A.area, ma = A.mapArea, { m2, m3 } = romMaps(s, ma), P = G.palettes(s, ma);
  const base = `ep${ep}-area${a}`, rec = { ep, area: a, mapArea: ma, cut: A.cut, files: {} };
  // world rectangle shown by the camera in this area (union of all settled windows), or the whole map
  let rx0, rx1, rh0, rh1, r3;
  if (live && live.camX) {
    rx0 = live.camX[0]; rx1 = live.camX[1] + 384; rh0 = live.camY[0] + 16; rh1 = live.camY[1] + 240;
    r3 = { x0: live.X3[0], x1: live.X3[1] + 384, h0: live.Y3[0] + 16, h1: live.Y3[1] + 240 };
    rec.extentSource = 'live camera (displayed scroll registers) over the settled frames of the walk';
    // the walks start at control (E1 starts after the intro scroll) and some end at a lock ENEMY CLEAR cannot open:
    // widen X to the segment triggers of the area (cut areas start at camera X 0, 0x20766)
    const yTrig = A.segs.some(g => g.yTrigger), shift = G.shiftOf(s, ma);
    if (!yTrig) {
      const tmin = A.cut ? 0 : rx0, tmax = Math.max(...A.segs.map(g => g.trigger)) + 384;
      if (tmin < rx0 || tmax > rx1) {
        rec.extentSource += `; X widened from ${rx0}..${rx1} to the segment triggers ${Math.min(rx0, tmin)}..${Math.max(rx1, tmax)} (ROM, not observed live)`;
        rec.observedX = [rx0, rx1];
        rx0 = Math.min(rx0, tmin); rx1 = Math.max(rx1, tmax);
        r3.x0 = Math.min(r3.x0, rx0 >>> shift); r3.x1 = Math.max(r3.x1, ((rx1 - 384) >>> shift) + 384);
      }
    }
  } else if (m2) {
    rx0 = 0; rx1 = m2.img.w; rh0 = 0; rh1 = m2.img.h; r3 = m3 ? { x0: 0, x1: m3.img.w, h0: 0, h1: m3.img.h } : null;
    rec.extentSource = 'whole ROM map (camera range not observed live)';
  }
  if (!m2) return rec;
  const W = rx1 - rx0, H = rh1 - rh0;
  rec.world = { x: [rx0, rx1], h: [rh0, rh1], note: 'image x = X - x[0]; image y = h[1] - 1 - h (h = map height, up)' };
  // scroll2 crop
  const i2 = newRGBA(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = px2(s, ma, rx0 + x, rh1 - 1 - y); if (p < 0) continue;
    const v = m2.img.pen[p]; if (v === 15) continue;
    const c = P.scroll2.rgb[m2.img.pal[p]][v], d = (y * W + x) * 4; i2.d[d] = c[0]; i2.d[d + 1] = c[1]; i2.d[d + 2] = c[2]; i2.d[d + 3] = 255;
  }
  savePNG(path.join(OUT, `${base}-scroll2.png`), i2); rec.files.scroll2 = `${base}-scroll2.png`; rec.scroll2Size = [W, H];
  // terrain crop
  const it = newRGBA(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = px2(s, ma, rx0 + x, rh1 - 1 - y); if (p < 0) continue;
    const iy = (p / m2.img.w) | 0, ix = p % m2.img.w, ty = m2.img.terrain[(iy >> 4) * (m2.img.w >> 4) + (ix >> 4)]; if (!ty) continue;
    const c = CLASS_RGB[terrainClass(ty)] || [128, 128, 128], d = (y * W + x) * 4; it.d[d] = c[0]; it.d[d + 1] = c[1]; it.d[d + 2] = c[2]; it.d[d + 3] = ((ix & 15) === 0 || (iy & 15) === 0) ? 220 : 150;
  }
  savePNG(path.join(OUT, `${base}-terrain.png`), it); rec.files.terrain = `${base}-terrain.png`;
  // scroll3 crop
  let i3 = null;
  if (m3 && r3) {
    const W3 = r3.x1 - r3.x0, H3 = r3.h1 - r3.h0; i3 = newRGBA(W3, H3);
    for (let y = 0; y < H3; y++) for (let x = 0; x < W3; x++) {
      const p = px3(s, ma, r3.x0 + x, r3.h1 - 1 - y); if (p < 0) continue;
      const v = m3.img.pen[p]; if (v === 15) continue;
      const c = P.scroll3.rgb[m3.img.pal[p]][v], d = (y * W3 + x) * 4; i3.d[d] = c[0]; i3.d[d + 1] = c[1]; i3.d[d + 2] = c[2]; i3.d[d + 3] = 255;
    }
    savePNG(path.join(OUT, `${base}-scroll3.png`), i3); rec.files.scroll3 = `${base}-scroll3.png`;
    rec.scroll3World = { x: [r3.x0, r3.x1], h: [r3.h0, r3.h1] }; rec.scroll3Size = [W3, H3];
  }
  // composite: replay the camera path; each frame's screen = scroll2 over scroll3 (ROM maps, displayed scroll values),
  // first every 16th full window, then the centre band (x 160..223) of every frame on top, so each column carries the
  // scroll3 offset the game used when that column was at the centre of the screen
  const ic = newRGBA(W, H);
  for (let q = 3; q < ic.d.length; q += 4) ic.d[q] = 0;
  const paint = (cam, xa, xb) => {
    for (let y = 0; y < 224; y++) for (let x = xa; x < xb; x++) {
      const X = cam[1] + x, h = cam[2] + 239 - y, cx = X - rx0, cy = rh1 - 1 - h;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      let c = null; const p = px2(s, ma, X, h);
      if (p >= 0 && m2.img.pen[p] !== 15) c = P.scroll2.rgb[m2.img.pal[p]][m2.img.pen[p]];
      else if (m3) { const p3 = px3(s, ma, cam[3] + x, cam[4] + 239 - y); if (p3 >= 0 && m3.img.pen[p3] !== 15) c = P.scroll3.rgb[m3.img.pal[p3]][m3.img.pen[p3]]; }
      const d = (cy * W + cx) * 4; if (c) { ic.d[d] = c[0]; ic.d[d + 1] = c[1]; ic.d[d + 2] = c[2]; } else { ic.d[d] = ic.d[d + 1] = ic.d[d + 2] = 0; } ic.d[d + 3] = 255;
    }
  };
  if (live && live.cams.length) {
    // synthetic camera positions for the widened (ROM-only) parts: same camera Y / scroll3 Y as the nearest live end
    const syn = [];
    if (rec.observedX) {
      const sh = G.shiftOf(s, ma), first = live.cams[0], last = live.cams[live.cams.length - 1];
      for (let X = rx0; X < rec.observedX[0]; X += 2) syn.push([0, X, first[2], X >>> sh, first[4]]);
      for (let X = rec.observedX[1] - 384; X <= rx1 - 384; X += 2) syn.push([0, X, last[2], X >>> sh, last[4]]);
    }
    const path2 = [...syn.filter(c => c[1] < live.cams[0][1]), ...live.cams, ...syn.filter(c => c[1] >= live.cams[0][1])];
    // pass 1: every 16th camera position (coverage); pass 2: whole screens taken each time the camera has moved a
    // full screen (384 px across or 224 px down/up) since the last one, so the image is a row of true screens
    path2.forEach((c, k) => { if (k % 16 === 0 || k === path2.length - 1) paint(c, 0, 384); });
    const screens = []; let last = null;
    for (const c of path2) if (!last || Math.abs(c[1] - last[1]) >= 384 || Math.abs(c[2] - last[2]) >= 224) { screens.push(c); last = c; }
    screens.push(path2[path2.length - 1]);
    screens.forEach(c => paint(c, 0, 384));
    rec.compositeScreens = screens.map(c => ({ camX: c[1], camY: c[2], X3: c[3], Y3: c[4] }));
    rec.compositeNote = 'scroll2 over scroll3 from the ROM maps, pasted as whole screens along the camera path of the walk (one per screen of camera travel; see compositeScreens), so scroll3 is exact inside each screen and jumps at the seams' + (syn.length ? '; widened parts use synthetic camera positions (X3 = camX >> shift, camera Y of the nearest live frame)' : '');
  } else {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = (y * W + x) * 4; if (i2.d[d + 3]) { ic.d[d] = i2.d[d]; ic.d[d + 1] = i2.d[d + 1]; ic.d[d + 2] = i2.d[d + 2]; ic.d[d + 3] = 255; } }
    rec.compositeNote = 'scroll2 only (no live camera path)';
  }
  savePNG(path.join(OUT, `${base}-composite.png`), ic); rec.files.composite = `${base}-composite.png`;
  rec.palettes = { scroll1: hex(P.scroll1.ptr), scroll2: hex(P.scroll2.ptr), scroll3: hex(P.scroll3.ptr), objList: hex(P.obj.list), objIndices: P.obj.idx, priorityMasks: G.priority(s, a).map(v => hex(v, 4)) };
  // walkable band (h = depth + floor) from the emulated collision routine, seeded with the live ground samples
  const samples = groundSamples(ep, a), stableS = samples.filter(q => classifySample(s, ma, q) === 'stable'), e2 = G.areaEntry(G.T.area2, s, ma);
  const camY0 = live && live.camY ? live.camY : [e2.y0, e2.y0];
  if (s === 6 && a === 1) rec.band = terrainBand(s, ma, 0, 512, 0, 256, stableS.map(q => [q.X & 0x1ff, q.h & 0xff]), [0x10, 0xa0]);
  else rec.band = terrainBand(s, ma, rx0, rx1, rh0, rh1, stableS.map(q => [q.X, q.h]), [camY0[0] + 16, camY0[0] + 0xa0]);
  const chk = { samples: samples.length, stable: 0, atWall: 0, pushed: 0, outsideMap: 0, inBand: 0, outsideArea: 0, notInBand: [], runs: [...new Set(samples.map(q => q.run))] };
  for (const q of samples) {
    const k = classifySample(s, ma, q); chk[k]++;
    if (k !== 'stable') continue;
    const ib = s === 6 && a === 1 ? rec.band.stableAt(q.X & 0x1ff, q.h & 0xff) : rec.band.stableAt(q.X, q.h);
    if (ib === null) chk.outsideArea++; // X outside the area image (walking off at the exit)
    else if (ib) chk.inBand++; else if (chk.notInBand.length < 12) chk.notInBand.push({ X: q.X, h: q.h, depth: q.depth, floor: q.floor, run: q.run, n: q.n });
  }
  rec.band.liveCheck = chk;
  rec.band.clamp = s === 6 && a === 1
    ? { rule: 'fixed while 0xFF84DC is set (0x500C): X 0x10..0x170, depth 0x10..0xA0; the collision map repeats every 256 px of h and 512 px of X (0x136E4 masks)', hRange: [0x10, 0x9f] }
    : { rule: 'player clamp 0x4FCE: camY + 16 <= h < camY + 0xA0 (feet on screen y 81..224); it only matters where the terrain band is taller than the screen window', liveCamY: live && live.camY ? live.camY : null, hRange: [camY0[0] + 16, camY0[1] + 0x9f] };
  if (s === 6 && a === 1) { rec.files.scroll1bg = 'ep7-area1-scroll1bg.png'; rec.scroll1bgNote = 'fixed 384x224 screen layer (scroll1 at x -0x40, y 0x100) drawn above scroll2 and below sprites, layer control 0x06D6'; }
  return rec;
}

// dynamic tiles: visible scroll2 cells whose live (code, attr) differs from the ROM map, from the dumped frames
function dynamicTiles(ep, a, ma, rec) {
  const s = ep - 1, { m2, m3 } = romMaps(s, ma); if (!m2 || !rec.world) return null;
  const P = G.palettes(s, ma), res = { note: 'cells the game rewrote at run time (doors, broken windows, priority/terrain patches, animated tiles); overlay = last state seen over a transparent canvas (magenta = transparent pixels of the new tile)' };
  const cells = { 2: new Map(), 3: new Map() }; let frames = 0;
  for (const run of runsOf(ep)) {
    const hk = new Map(readHook(run).map(r => [r.n, r]));
    for (const fr of readFrames(run)) {
      const h = hk.get(fr.f); if (!fr.scroll || !h || h.m !== 0xc || h.br !== 15 || h.st !== s || h.ar !== a) continue;
      frames++;
      for (const layer of [2, 3]) {
        if (layer === 3 && !m3) continue;
        const map = fs.readFileSync(path.join(RUNS, run, fr.scroll[`s${layer}`].file)), T = layer === 2 ? 16 : 32, N = layer === 2 ? 1024 : 2048;
        const cx = layer === 2 ? (fr.cpsA[8] + 64) & 0xffff : (fr.cpsA[10] + 64) & 0xffff, cy = layer === 2 ? (0x300 - fr.cpsA[9]) & 0xffff : (0x700 - fr.cpsA[11]) & 0xffff;
        for (let X = cx & -T; X < cx + 384; X += T) for (let hh = (cy + 16) & -T; hh < cy + 240; hh += T) {
          const rom = layer === 2 ? (() => { const Xw = wrapX2(s, X); if (Xw < 0 || Xw >= m2.img.w || hh < 0 || hh >= m2.img.h) return null; return m2.img.tiles.get(`${Xw >> 4},${(m2.img.h - 1 - hh) >> 4}`); })()
            : (() => { const Xw = wrapX3(s, X); if (Xw < 0 || Xw >= m3.img.w || hh < 0 || hh >= m3.img.h) return null; return G.map3Entry(s, ma, X, hh); })();
          if (!rom) continue;
          const o = S.scanOffset(layer, ((X & (N - 1)) / T) | 0, (((N - 1 - hh) & (N - 1)) / T) | 0) * 4, code = map.readUInt16BE(o), attr = map.readUInt16BE(o + 2);
          if (rom.code === code && rom.attr === attr) continue;
          const k = `${X},${hh}`, c = cells[layer].get(k) || { X, h: hh, rom, states: new Map(), first: fr.f, run };
          const sk = `${code},${attr}`; if (!c.states.has(sk)) c.states.set(sk, { code, attr, first: fr.f, n: 0 }); c.states.get(sk).n++;
          c.last = { code, attr }; cells[layer].set(k, c);
        }
      }
    }
  }
  res.framesSampled = frames;
  const base = `ep${ep}-area${a}`;
  for (const layer of [2, 3]) {
    const L = [...cells[layer].values()]; if (!L.length) continue;
    const T = layer === 2 ? 16 : 32, page = layer === 2 ? P.scroll2.rgb : P.scroll3.rgb;
    const blit = (im, code, attr, x0, y0) => {
      const c = S.mapCode(layer, code); if (c < 0) return;
      const t = S.tilePens(layer, c, 0), fx = attr & 0x20, fy = attr & 0x40;
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const ix = x0 + x, iy = y0 + y; if (ix < 0 || iy < 0 || ix >= im.w || iy >= im.h) continue;
        const v = t[(fy ? T - 1 - y : y) * T + (fx ? T - 1 - x : x)], d = (iy * im.w + ix) * 4;
        if (v === 15) { im.d[d] = 255; im.d[d + 1] = 0; im.d[d + 2] = 255; im.d[d + 3] = 90; continue; }
        const col = page[attr & 31][v]; im.d[d] = col[0]; im.d[d + 1] = col[1]; im.d[d + 2] = col[2]; im.d[d + 3] = 255;
      }
    };
    const codeChanged = L.filter(c => [...c.states.values()].some(st => st.code !== c.rom.code));
    const animated = L.filter(c => c.states.size >= 2); // two or more live states besides the ROM tile
    const info = { cells: L.length, codeChanged: codeChanged.length, attrOnly: L.length - codeChanged.length, animatedCells: animated.length };
    // overlay of the last state of every code-changed cell, in the area image space (scroll2) or scroll3 crop space
    const W0 = layer === 2 ? rec.world : rec.scroll3World;
    if (codeChanged.length && W0) {
      const W = W0.x[1] - W0.x[0], H = W0.h[1] - W0.h[0], ov = newRGBA(W, H);
      for (const c of codeChanged) blit(ov, c.last.code, c.last.attr, c.X - W0.x[0], W0.h[1] - 1 - (c.h + T - 1));
      const file = `${base}-dynamic-scroll${layer}.png`; savePNG(path.join(OUT, file), ov); info.overlay = file;
    }
    // animation sheet: one row per cell with >= 2 live states: ROM tile, then each live state in order of appearance
    if (animated.length) {
      const rows = animated.slice(0, 256), cols = Math.max(...rows.map(c => c.states.size)) + 1, sh = newRGBA(cols * (T + 2), rows.length * (T + 2));
      rows.forEach((c, r) => { blit(sh, c.rom.code, c.rom.attr, 0, r * (T + 2)); [...c.states.values()].forEach((st, k) => blit(sh, st.code, st.attr, (k + 1) * (T + 2), r * (T + 2))); });
      const file = `${base}-anim-scroll${layer}.png`; savePNG(path.join(OUT, file), sh); info.animSheet = file;
      info.animRows = rows.map((c, r) => ({ row: r, X: c.X, h: c.h, rom: [hex(c.rom.code, 4), hex(c.rom.attr, 4)], states: [...c.states.values()].map(st => [hex(st.code, 4), hex(st.attr, 4), st.n]) }));
    }
    info.list = L.slice(0, 300).map(c => ({ X: c.X, h: c.h, rom: [hex(c.rom.code, 4), hex(c.rom.attr, 4)], live: [...c.states.values()].map(st => `${hex(st.code, 4)}/${hex(st.attr, 4)}`), run: c.run, first: c.first }));
    res[`scroll${layer}`] = info;
  }
  return res;
}

// palette animation: slots of the scroll1/2/3 pages whose colours change during the area (12-bit, brightness ignored),
// each distinct content looked up as a ROM palette index (32-byte units from 0xB7A52)
let PALIDX = null;
function romPaletteIndex(words) {
  if (!PALIDX) {
    PALIDX = new Map();
    for (let k = 0; G.T.palBase + (k + 1) * 32 <= R.REC_TABLE; k++) {
      const key = Array.from({ length: 16 }, (_, i) => R.u16(G.T.palBase + k * 32 + i * 2) & 0xfff).join(',');
      if (!PALIDX.has(key)) PALIDX.set(key, k);
    }
  }
  const k = PALIDX.get(words.map(w => w & 0xfff).join(','));
  return k === undefined ? null : k;
}
function paletteAnimation(ep, a) {
  const s = ep - 1, slots = new Map(); let frames = 0;
  for (const run of runsOf(ep)) {
    const hk = new Map(readHook(run).map(r => [r.n, r]));
    for (const fr of readFrames(run)) {
      const h = hk.get(fr.f); if (!fr.pal || !h || h.m !== 0xc || h.br !== 15 || h.st !== s || h.ar !== a) continue;
      frames++;
      for (const page of [0, 1, 2, 3]) for (let p = 0; p < 32; p++) {
        const o = (page * 512 + p * 16) * 4, hexs = fr.pal.slice(o, o + 64);
        const key = page + ':' + p, v = slots.get(key) || new Map();
        if (!v.has(hexs)) v.set(hexs, { first: fr.f, run, count: 0 });
        v.get(hexs).count++; slots.set(key, v);
      }
    }
  }
  const out = [], startIdx = G.palettes(s, a).obj.idx;
  for (const [key, v] of slots) {
    const [page, p] = key.split(':').map(Number);
    const states = [...v.entries()].map(([hx, i]) => { const w = []; for (let k = 0; k < 16; k++) w.push(parseInt(hx.slice(k * 4, k * 4 + 4), 16)); const ri = romPaletteIndex(w); return { romPalette: ri === null ? null : hex(G.T.palBase + ri * 32), romIndex: ri, frames: i.count, first: i.first, run: i.run }; });
    // OBJ: report a slot whenever a sampled content is not the area-start palette (the game reloads slots for the
    // enemies and bosses that appear, possibly before the first sampled frame); scroll pages: contents that change
    if (page === 0 ? states.every(st => st.romIndex === startIdx[p]) : v.size < 2) continue;
    out.push({ layer: ['obj', 'scroll1', 'scroll2', 'scroll3'][page], palette: p, areaStart: page === 0 ? startIdx[p] : undefined, states });
  }
  const scroll = out.filter(x => x.layer !== 'obj'), obj = out.filter(x => x.layer === 'obj');
  return { framesSampled: frames, animatedSlots: scroll.length, slots: scroll, objSlotsReloaded: obj.length, objSlots: obj, objNote: 'OBJ slots whose sampled contents (every 8th frame) differ from the area-start set palettes.objIndices (areaStart): the game reloads slots for the enemies and bosses that appear; romIndex is the index into 0xB7A52 (32-byte units) like objIndices, null = not a ROM palette (e.g. a fade step)' };
}

// ---------------------------------------------------------------- validation
function layerValidation(eps) {
  const out = [];
  for (const ep of eps) for (const run of runsOf(ep)) {
    const frames = readFrames(run), hk = new Map(readHook(run).map(r => [r.n, r]));
    for (const fr of frames) {
      if (!fr.scroll || fr.f === 0 || fr.f % 480 !== 0) continue;
      const snapF = path.join(RUNS, run, `snap-f${String(fr.f).padStart(6, '0')}.png`); if (!fs.existsSync(snapF)) continue;
      const F = S.loadFrame(run, fr), c = S.composite(F, {}), snap = loadPNG(snapF), cmp = S.compareRGBA(c.rgba, snap.d, 384, 224);
      const h = hk.get(fr.f) || {}, miss = {};
      if (cmp.same !== cmp.total) for (let q = 0; q < 384 * 224; q++) {
        if (c.rgba[q * 4] === snap.d[q * 4] && c.rgba[q * 4 + 1] === snap.d[q * 4 + 1] && c.rgba[q * 4 + 2] === snap.d[q * 4 + 2]) continue;
        const top = [1, 2, 3].find(l => c.scr[l].pen[q] !== 15), k = top ? `scroll${top}/${c.scr[top].pal[q]}` : 'background'; miss[k] = (miss[k] || 0) + 1;
      }
      out.push({ run, ep, f: fr.f, st: h.st, ar: h.ar, main: h.m, bright: F.pal.words[1024] >> 12, order: c.regs.order, priority: c.regs.priority.map(v => hex(v, 4)), rowscroll: c.regs.rowscroll, same: cmp.same, total: cmp.total, pct: +(100 * cmp.agreement).toFixed(3), mismatchByLayerPalette: miss });
    }
  }
  return out;
}

function romVsLive(eps, every = 4) {
  const per = [];
  for (const ep of eps) {
    const byArea = new Map();
    for (const run of runsOf(ep)) {
    const hk = new Map(readHook(run).map(r => [r.n, r]));
    let k = 0;
    for (const fr of readFrames(run)) {
      if (!fr.scroll) continue;
      const h = hk.get(fr.f); if (!h || h.m !== 0xc || h.br !== 15) continue;
      if ((k++ % every) !== 0) continue;
      const r = compareFrame(run, fr, h), key = `${h.st}/${h.ar}`;
      if (!byArea.has(key)) byArea.set(key, []); byArea.get(key).push(r);
    }
    }
    for (const [key, v] of byArea) {
      const s2 = v.filter(x => x.s2 && x.s2.tot), s3 = v.filter(x => x.s3 && x.s3.tot);
      const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
      per.push({
        ep, area: +key.split('/')[1], frames: v.length,
        scroll2: { framesExact: s2.filter(x => x.s2.same === x.s2.tot).length, of: s2.length, pixels: +(100 * sum(s2, x => x.s2.same) / Math.max(1, sum(s2, x => x.s2.tot))).toFixed(3), worst: s2.length ? Math.min(...s2.map(x => x.s2.pct)) : null, tiles: [sum(s2, x => x.s2tiles.same), sum(s2, x => x.s2tiles.tot)] },
        scroll3: { framesExact: s3.filter(x => x.s3.same === x.s3.tot).length, of: s3.length, pixels: +(100 * sum(s3, x => x.s3.same) / Math.max(1, sum(s3, x => x.s3.tot))).toFixed(3), worst: s3.length ? Math.min(...s3.map(x => x.s3.pct)) : null },
        palettes: { obj: Math.min(...v.map(x => x.pal.obj)), scroll1: Math.min(...v.map(x => x.pal.s1)), scroll2: Math.min(...v.map(x => x.pal.s2)), scroll3: Math.min(...v.map(x => x.pal.s3)), of: 512 },
      });
      console.log(`[validate] ep${ep} area ${key.split('/')[1]}: ${JSON.stringify(per[per.length - 1])}`);
    }
  }
  return per;
}

// on-ground P1 samples: the ROM terrain class under the feet (h = depth + floor, the collision lookup at 0x1309C)
function terrainCheck(eps) {
  const out = [];
  for (const ep of eps) {
    const s = ep - 1, log = settled(hookOf(ep)).filter(r => r.ph === r.p54 && r.p0 !== 0);
    const cls = {};
    for (const r of log) {
      const ma = mapAreaOf(s, r.ar), m = romMaps(s, ma).m2; if (!m) continue;
      const x = wrapX2(s, r.px), h = r.pd + r.p54, iy = m.img.h - 1 - h;
      if (x < 0 || x >= m.img.w || iy < 0 || iy >= m.img.h) { cls.outside = (cls.outside || 0) + 1; continue; }
      const t = m.img.terrain[(iy >> 4) * (m.img.w >> 4) + (x >> 4)], k = `type${t}/class${hex(terrainClass(t), 2)}`;
      cls[k] = (cls[k] || 0) + 1;
    }
    out.push({ ep, samples: log.length, classes: cls });
  }
  return out;
}

// ---------------------------------------------------------------- screens (title, select, intermission, title cards)
function screensPlans() {
  const plans = [{
    name: 'stg-screens-boot', frames: 1330, coinStart: true,
    inputs: [{ from: 480, to: 483, keys: ['P1 Button 1'] }],
    dump: { from: 0, to: 1329, every: 10, obj: true, cpsA: true, allPalettes: true, scroll: true, ram: [['0xFF84D0', 16]] },
    snapshotEvery: { from: 0, to: 1329, every: 10 },
  }];
  for (let ep = 1; ep <= 8; ep++) plans.push({
    name: `stg-screens-card${ep}`, frames: 1100, loadState: 'stage1-jack',
    cheats: [{ cheat: 'invuln' }, { cheat: 'warpLive', stage: ep, at: 10 }],
    dump: { from: 10, to: 1099, every: 10, obj: true, cpsA: true, allPalettes: true, scroll: true, ram: [['0xFF84D0', 16]] },
    snapshotEvery: { from: 10, to: 1099, every: 10 },
  });
  return plans;
}
async function screensRun() {
  for (const p of screensPlans()) { const s = await rt().runPlan(p, { quiet: true }); console.log(`[screens] ${p.name}: ok ${s.ok}, frames ${s.lastFrame}`); }
}
// export one frame per distinct screen: per-layer screen renders, composite, MAME snapshot
function screensExport() {
  const dir = path.join(OUT, 'screens'); fs.rmSync(dir, { recursive: true, force: true }); mkdir(dir);
  const list = [];
  for (const p of screensPlans()) {
    const frames = readFrames(p.name), kept = [];
    for (const fr of frames) {
      if (!fr.scroll || !fr.pal) continue;
      const F = S.loadFrame(p.name, fr), mainState = fr.ram ? parseInt(fr.ram.FF84D0.slice(0, 2), 16) : null;
      // gameplay frames are covered by the area images; keep them only when a title card (EPISODE n) is on screen
      if (mainState === 0xc && !textLines(F).some(l => /^EPISODE/.test(l.text))) continue;
      // skip fades and the frame right after a warp (palette brightness below 0xF on any scroll page)
      if ([512, 1024, 1536].some(o => (F.pal.words[o] >> 12) !== 0xf) || (p.name !== 'stg-screens-boot' && fr.f < 20)) continue;
      const c = S.composite(F, {});
      let lit = 0; for (let q = 0; q < 384 * 224; q++) if (c.rgba[q * 4] + c.rgba[q * 4 + 1] + c.rgba[q * 4 + 2] > 30) lit++;
      if (lit < 384 * 224 * 0.05) { continue; }
      // keep a frame only when it differs from every frame kept so far in this run by more than 35 % of the pixels
      const differs = k => { let dif = 0; for (let q = 0; q < 384 * 224; q += 3) if (Math.abs(c.rgba[q * 4] - k[q * 4]) + Math.abs(c.rgba[q * 4 + 1] - k[q * 4 + 1]) + Math.abs(c.rgba[q * 4 + 2] - k[q * 4 + 2]) > 60) dif++; return dif > 384 * 224 / 3 * 0.35; };
      if (!kept.every(differs)) continue;
      kept.push(c.rgba);
      const Rg = c.regs, tag = `${p.name.replace('stg-screens-', '')}-f${String(fr.f).padStart(4, '0')}`;
      const rec = { run: p.name, f: fr.f, mf: fr.mf, main: fr.ram ? hex(parseInt(fr.ram.FF84D0.slice(0, 2), 16), 2) : null, layerOrder: Rg.order, layerControl: hex(Rg.layerControl, 4), video: hex(Rg.video, 4), scroll: Rg.s, files: {} };
      for (const l of [1, 2, 3]) {
        const L = c.scr[l], page = F.pal.pages[S.LAYER[l].page], im = newRGBA(384, 224);
        for (let q = 0; q < 384 * 224; q++) { const v = L.pen[q]; if (v === 15) continue; const col = page[L.pal[q]][v]; im.d[q * 4] = col[0]; im.d[q * 4 + 1] = col[1]; im.d[q * 4 + 2] = col[2]; im.d[q * 4 + 3] = 255; }
        savePNG(path.join(dir, `${tag}-scroll${l}.png`), im); rec.files[`scroll${l}`] = `screens/${tag}-scroll${l}.png`;
      }
      savePNG(path.join(dir, `${tag}-composite.png`), { w: 384, h: 224, d: c.rgba }); rec.files.composite = `screens/${tag}-composite.png`;
      // sprite layer (title logo, portraits, intermission actors) from the OBJ list dumped at this frame: the list dumped
      // at f is what MAME shows at f+1 (sprite DMA), so it is one frame of motion apart from the layers above
      if (fr.obj && fr.obj.length) {
        const O = require('../mame/obj.cjs'), spr = O.renderObj(fr), full = S.composite(F, { sprites: spr });
        savePNG(path.join(dir, `${tag}-sprites.png`), { w: 384, h: 224, d: spr.rgba }); rec.files.sprites = `screens/${tag}-sprites.png`;
        savePNG(path.join(dir, `${tag}-full.png`), { w: 384, h: 224, d: full.rgba }); rec.files.full = `screens/${tag}-full.png`;
        rec.sprites = { entries: fr.obj.length, note: 'OBJ list dumped at this frame (shown by MAME one frame later); full = layers + sprites with the CPS-B priority masks' };
      }
      const snapF = path.join(RUNS, p.name, `snap-f${String(fr.f).padStart(6, '0')}.png`);
      if (fs.existsSync(snapF)) { fs.copyFileSync(snapF, path.join(dir, `${tag}-snap.png`)); rec.files.snap = `screens/${tag}-snap.png`; const snap = loadPNG(snapF), cmp = S.compareRGBA(c.rgba, snap.d, 384, 224); rec.matchVsSnapshotPct = +(100 * cmp.agreement).toFixed(2); }
      list.push(rec);
    }
  }
  return list;
}

// ---------------------------------------------------------------- contact sheet
function gridSheet(items, file, { cols = 6, scale = 0.5 } = {}) {
  const w = Math.round(384 * scale), h = Math.round(224 * scale), rows = Math.ceil(items.length / cols), W = cols * (w + 4) + 4, H = rows * (h + 18) + 4, sheet = newRGBA(W, H);
  for (let q = 0; q < sheet.d.length; q += 4) { sheet.d[q] = 32; sheet.d[q + 1] = 32; sheet.d[q + 2] = 40; sheet.d[q + 3] = 255; }
  items.forEach((it, k) => {
    const im = loadPNG(path.join(OUT, it.file)), ox = 4 + (k % cols) * (w + 4), oy = 4 + Math.floor(k / cols) * (h + 18);
    text(sheet, ox, oy, it.label, 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (Math.min(im.h - 1, Math.floor(y / scale)) * im.w + Math.min(im.w - 1, Math.floor(x / scale))) * 4, d = ((oy + 14 + y) * W + ox + x) * 4; sheet.d[d] = im.d[s]; sheet.d[d + 1] = im.d[s + 1]; sheet.d[d + 2] = im.d[s + 2]; }
  });
  savePNG(path.join(OUT, file), sheet);
  return { file, size: [W, H] };
}

function contactSheet(items, file, { maxW = 1600, scale = 0.25, maxH = 420 } = {}) {
  const cells = [];
  for (const it of items) {
    const im = loadPNG(path.join(OUT, it.file)), w = Math.max(1, Math.round(im.w * scale)), h = Math.max(1, Math.round(im.h * scale));
    const pieces = [];
    if (w >= h) { for (let x = 0; x < w; x += maxW) pieces.push({ sx: x, sy: 0, w: Math.min(maxW, w - x), h }); }
    else { for (let y = 0; y < h; y += maxH) pieces.push({ sx: 0, sy: y, w, h: Math.min(maxH, h - y) }); }
    cells.push({ it, im, w, h, pieces, vertical: w < h });
  }
  // layout: one block per item; horizontal pieces stacked, vertical pieces side by side
  let H = 0; const blocks = [];
  for (const c of cells) {
    const bw = c.vertical ? c.pieces.reduce((a, p) => a + p.w + 4, 0) : Math.min(maxW, c.w), bh = 14 + (c.vertical ? Math.min(maxH, c.h) : c.pieces.reduce((a, p) => a + p.h + 3, 0));
    blocks.push({ c, y: H, bw, bh }); H += bh + 8;
  }
  const W = maxW + 8, sheet = newRGBA(W, H);
  for (let q = 0; q < sheet.d.length; q += 4) { sheet.d[q] = 32; sheet.d[q + 1] = 32; sheet.d[q + 2] = 40; sheet.d[q + 3] = 255; }
  for (const b of blocks) {
    text(sheet, 4, b.y + 2, b.c.it.label, 2);
    let ox = 4, oy = b.y + 14;
    for (const p of b.c.pieces) {
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
        const sx = Math.min(b.c.im.w - 1, Math.floor((p.sx + x) / scale)), sy = Math.min(b.c.im.h - 1, Math.floor((p.sy + y) / scale)), s = (sy * b.c.im.w + sx) * 4;
        const dx = ox + x, dy = oy + y; if (dx >= W || dy >= H) continue; const d = (dy * W + dx) * 4;
        if (b.c.im.d[s + 3]) { sheet.d[d] = b.c.im.d[s]; sheet.d[d + 1] = b.c.im.d[s + 1]; sheet.d[d + 2] = b.c.im.d[s + 2]; }
      }
      if (b.c.vertical) ox += p.w + 4; else oy += p.h + 3;
    }
  }
  savePNG(path.join(OUT, file), sheet);
  return { file, size: [W, H] };
}

// ---------------------------------------------------------------- HELL ROAD rowscroll band
// 0x23390 (68000 word/long semantics reproduced): rowscroll RAM words 0xAF down to 0x90 (screen rows 159..128 with
// offset 0) get ((camX - (k+1)*(camX>>1)) - camX) >> 5, masked with 0xFF when >= 0x180, using the camera X of the
// frame before the one displayed (the RAM value the routine read). Row 159 then scrolls at about 63/64 of the camera,
// row 128 at 1/2: a perspective ground band.
function hellRoadRowscroll(camX) {
  const out = new Array(32); let D0w = camX & 0xffff; const D3w = (-D0w) & 0xffff; let D0 = (D0w << 16) >> 16; const D1 = D0 >> 1;
  for (let k = 0; k < 32; k++) {
    D0 = (D0 - D1) | 0; let D2 = (D0 & ~0xffff) | (((D0 & 0xffff) + D3w) & 0xffff); D2 = D2 >> 5;
    let w = D2 & 0xffff; if (w >= 0x180) w &= 0xff; out[31 - k] = w; // word 0x90 + (31 - k)
  }
  return out; // index i = rowscroll word 0x90 + i = screen row 128 + i (rowscroll offset 0)
}
function rowscrollCheck() {
  const run = 'stg-ep3-walk', hk = new Map(readHook(run).map(r => [r.n, r]));
  let ok = 0, tot = 0, frames = 0, otherRowsNonZero = 0; const samples = [];
  for (const fr of readFrames(run)) {
    const h = hk.get(fr.f), hp = hk.get(fr.f - 1); if (!fr.scroll || !h || !hp || h.m !== 0xc) continue;
    const o = fs.readFileSync(path.join(RUNS, run, fr.scroll.rowscroll.file)), pred = hellRoadRowscroll(hp.cx); frames++;
    for (let w = 0; w < 0x400; w++) { const v = o.readUInt16BE(w * 2); if (w >= 0x90 && w <= 0xaf) { tot++; if (v === pred[w - 0x90]) ok++; } else if (v) otherRowsNonZero++; }
    if (samples.length < 400 && frames % 4 === 1) samples.push([hp.cx, ...Array.from({ length: 32 }, (_, i) => o.readUInt16BE((0x90 + i) * 2))]);
  }
  writeJSON(path.join(OUT, 'ep3-rowscroll-samples.json'), { note: 'HELL ROAD: [camera X of the previous frame, rowscroll words 0x90..0xAF] per sampled frame of run stg-ep3-walk', samples });
  return { run, frames, words: tot, matched: ok, otherWordsNonZero: otherRowsNonZero, rows: [128, 159], routine: '0x23390', rule: 'word 0x90+i (screen row 128+i) = ((camX - (32-i)*(camX>>1)) - camX) >> 5, & 0xFF when >= 0x180; camX = RAM camera X of the previous frame', samples: 'ep3-rowscroll-samples.json' };
}

// ---------------------------------------------------------------- priority validation (sprites + layers)
// Replays part of a walk (same plan, so the same game) with the OBJ list dumped every frame and no sprite hiding, then
// rebuilds whole frames: layers in CPS-B order + sprites (OBJ dump f-1, tools/re/mame/obj.cjs) masked by the
// high-priority pens of scroll2, compared with MAME snapshot f.
const PRIO_RUNS = [
  { ep: 4, name: 'stg-prio-ep4', frames: 2700, from: 2300, to: 2699, why: 'E4 area 1: Jack walks behind the garage fence (scroll2 group pens over sprites)' },
  { ep: 1, name: 'stg-prio-ep1', frames: 1100, from: 740, to: 1099, why: 'E1 area 1: mansion hall with foreground pillars' },
  { ep: 7, name: 'stg-prio-ep7', frames: 4700, from: 4300, to: 4699, why: 'E7 area 1: layer control 0x06D6 (scroll1 as background)' },
];
async function priorityRun() {
  for (const p of PRIO_RUNS) {
    const plan = walkPlan(p.ep, Object.assign({}, LIVE_OPTS[p.ep] || {}, { name: p.name, frames: p.frames, hideEvery: 1e9, snapEvery: 1e9 }));
    plan.dump = { from: p.from, to: p.to, every: 1, obj: true, cpsA: true, allPalettes: true, scroll: true };
    plan.snapshotEvery = { from: p.from + 1, to: p.to, every: 3 };
    const s = await rt().runPlan(plan, { quiet: true });
    console.log(`[priority] ${p.name}: ok ${s.ok}, frames ${s.lastFrame}`);
  }
}
function priorityValidation() {
  const O = require('../mame/obj.cjs'), out = [];
  for (const p of PRIO_RUNS) {
    const frames = new Map(readFrames(p.name).map(x => [x.f, x])), hk = new Map(readHook(p.name).map(r => [r.n, r]));
    const res = { run: p.name, why: p.why, frames: 0, exact: 0, same: 0, total: 0, maskedSpritePixels: 0, framesWithMasking: 0, notExact: [] };
    for (const [f, fr] of frames) {
      const prev = frames.get(f - 1), snapF = path.join(RUNS, p.name, `snap-f${String(f).padStart(6, '0')}.png`);
      if (!prev || !fr.scroll || !fs.existsSync(snapF)) continue;
      const F = S.loadFrame(p.name, fr), spr = O.renderObj(prev), c = S.composite(F, { sprites: spr }), snap = loadPNG(snapF), cmp = S.compareRGBA(c.rgba, snap.d, 384, 224);
      res.frames++; res.same += cmp.same; res.total += cmp.total; if (cmp.same === cmp.total) res.exact++; else res.notExact.push({ f, pct: +(100 * cmp.agreement).toFixed(3), bright: F.pal.words[1024] >> 12 });
      res.maskedSpritePixels += c.maskedSpritePixels; if (c.maskedSpritePixels) res.framesWithMasking++;
      const h = hk.get(f); if (h) { res.area = h.ar; res.layerControl = hex(h.lc, 4); }
    }
    res.pixels = res.total ? +(100 * res.same / res.total).toFixed(4) : null; res.notExact = res.notExact.slice(0, 20);
    console.log('[priority]', JSON.stringify(res));
    out.push(res);
  }
  return out;
}

// ---------------------------------------------------------------- depth probes (MAME)
// Sweep the walkable band of an area: P1 (invuln, enemies cleared) alternates Up and Down while drifting right, so
// the ground samples (hook: every 2nd frame) touch the top and bottom lane limits at many X. Areas whose first
// segment has trigger 0 are entered with warpArea; the shaft (E7 area 1) also dumps its 0x91C000 collision map.
const DEPTH_HOOK = String.raw`
function PEEK(n)
  if n % 2 == 0 then
    HLOG(fmt('{"n":%d,"m":%d,"st":%d,"ar":%d,"cx":%d,"cy":%d,"px":%d,"ph":%d,"pd":%d,"fl":%d,"p0":%d,"p56":%d,"p51":%d,"b0":%d,"c5":%d}',
      n, rb(0xFF84D0), rb(0xFF84D9), rb(0xFF8786), rw(0xFF8744), rw(0xFF8748), rw(0xFFB27C), rsw(0xFFB280), rw(0xFFB284), rsw(0xFFB2C8), rb(0xFFB274), rsw(0xFFB2CA), rb(0xFFB2C5), rw(0xFF86B0), rb(0xFF8741)))
  end
end
`;
const DEPTH_PROBES = [
  { ep: 1, area: 0, state: 'stage1-jack' }, { ep: 1, area: 1, state: 'stage1-jack-area1' }, { ep: 1, area: 2, state: 'stage1-jack-area2' },
  { ep: 2, area: 0, state: 'stage2-jack' }, { ep: 2, area: 2, state: 'stage2-jack', warp: 2 },
  { ep: 3, area: 0, state: 'stage3-jack' },
  { ep: 4, area: 0, state: 'stage4-jack' }, { ep: 4, area: 1, state: 'stage4-jack', warp: 1 }, { ep: 4, area: 2, state: 'stage4-jack', warp: 2 },
  { ep: 5, area: 0, state: 'stage5-jack' },
  { ep: 6, area: 0, state: 'stage6-jack' }, { ep: 6, area: 1, state: 'stage6-jack', warp: 1 },
  { ep: 7, area: 0, state: 'stage7-jack' }, { ep: 7, area: 1, state: 'stage7-jack', warp: 1, shaft: true }, { ep: 7, area: 2, state: 'stage7-jack', warp: 2 }, { ep: 7, area: 3, state: 'stage7-jack', warp: 3 },
  { ep: 8, area: 0, state: 'stage8-jack' }, { ep: 8, area: 1, state: 'stage8-jack', warp: 1 }, { ep: 8, area: 2, state: 'stage8-jack', warp: 2 },
];
function depthPlan(p) {
  const segs = [[[], 90]]; for (let k = 0; k < 6; k++) segs.push([['up'], 110], [['down'], 170], [['right'], 50], [['right', 'up'], 40], [['right', 'down'], 40]);
  let f = 2; const inputs = []; for (const [keys, len] of segs) { if (keys.length) inputs.push({ from: f, to: f + len - 1, keys }); f += len; }
  const plan = { name: `stg-depth-e${p.ep}a${p.area}`, frames: f + 5, loadState: p.state, cheats: [{ cheat: 'invuln' }, { cheat: 'killAll', every: 30, from: 20 }], inputs, hook: DEPTH_HOOK, snapshots: [Math.floor(f / 2), f] };
  if (p.warp) plan.cheats.push({ cheat: 'warpArea', area: p.warp, at: 10 });
  if (p.shaft) plan.dump = { from: 200, to: 200, every: 1, obj: false, cpsA: false, ram: [['0x91C000', 2048]] };
  return plan;
}
async function depthRun(eps) {
  for (const p of DEPTH_PROBES) {
    if (!eps.includes(p.ep)) continue;
    const plan = depthPlan(p), s = await rt().runPlan(plan, { quiet: true }), log = readHook(plan.name);
    const g = log.filter(r => r.m === 0xc && r.st === p.ep - 1 && r.ar === p.area && r.p0 && r.ph === r.fl && r.px < 0x8000);
    console.log(`[depth] ${plan.name}: ok ${s.ok}, ${s.seconds.toFixed(1)} s, ground samples in the area ${g.length}, h ${g.length ? Math.min(...g.map(r => r.pd + r.fl)) + '..' + Math.max(...g.map(r => r.pd + r.fl)) : '-'}, 0xFF86B0 ${[...new Set(log.map(r => r.b0))].map(v => hex(v)).join('/')}`);
  }
}
// E7 area 1: compare the decoded collision map with the live 0x91C000 dump of the shaft probe (types per cell)
function shaftMapCheck() {
  const fr = readFrames('stg-depth-e7a1').find(x => x.ram && x.ram['91C000']); if (!fr) return null;
  const live = Buffer.from(fr.ram['91C000'], 'hex'), cm = TR.e7ShaftMap(); let same = 0, sameType = 0;
  for (let col = 0; col < 32; col++) for (let i = 0; i < 16; i++) {
    const o = col * 64 + i * 4, hc = 15 - i, q = hc * 32 + col;
    if (live.readUInt16BE(o) === cm.codes[q] && live.readUInt16BE(o + 2) === cm.attrs[q]) same++;
    if ((live.readUInt16BE(o + 2) >> 10) === cm.types[q]) sameType++;
  }
  return { run: 'stg-depth-e7a1', frame: fr.f, cells: 512, cellsExact: same, typesExact: sameType };
}

// ---------------------------------------------------------------- build / validate drivers
async function validateAll(eps, { layersOnly = false } = {}) {
  mkdir(OUT);
  const v = { layers: layerValidation(eps) };
  // a mismatch is explained when the frame is mid-fade or every wrong pixel uses a palette the area animates: the
  // palette RAM was rewritten after MAME latched it for that frame (MAME copies palettes when the base is written)
  for (const x of v.layers) {
    if (x.same === x.total) continue;
    const anim = new Set((paletteAnimation(x.ep, x.ar).slots || []).map(sl => `${sl.layer}/${sl.palette}`));
    x.explained = x.bright < 15 ? 'fade (brightness ' + x.bright + ')' : (Object.keys(x.mismatchByLayerPalette).every(k => anim.has(k)) ? 'animated palette(s) ' + Object.keys(x.mismatchByLayerPalette).join(', ') : null);
  }
  const L = v.layers; v.layersSummary = { frames: L.length, exact: L.filter(x => x.same === x.total).length, pixels: +(100 * L.reduce((a, x) => a + x.same, 0) / Math.max(1, L.reduce((a, x) => a + x.total, 0))).toFixed(4), worst: L.length ? Math.min(...L.map(x => x.pct)) : null, unexplained: L.filter(x => x.same !== x.total && !x.explained).length, fullBrightExact: L.filter(x => x.bright === 15 && x.same === x.total).length, fullBright: L.filter(x => x.bright === 15).length };
  console.log('[validate] layer decode vs MAME snapshots (sprites hidden):', JSON.stringify(v.layersSummary));
  if (layersOnly) return v;
  v.hellRoadRowscroll = rowscrollCheck();
  console.log('[validate] HELL ROAD rowscroll:', JSON.stringify(v.hellRoadRowscroll));
  v.romVsLive = romVsLive(eps);
  v.terrainUnderFeet = terrainCheck(eps);
  const vf = path.join(OUT, 'validation.json');
  if (fs.existsSync(vf)) { const old = JSON.parse(fs.readFileSync(vf, 'utf8')); if (old.priority) v.priority = old.priority; }
  writeJSON(vf, v);
  return v;
}

// depth-band validation summary: every live on-ground P1 sample (walks + depth probes) against the emulated
// collision routine and the exported band
function depthSummary(episodes) {
  const perArea = [], tot = { samples: 0, stable: 0, atWall: 0, pushed: 0, outsideMap: 0, inBand: 0, outsideArea: 0 };
  for (const e of episodes) for (const a of e.areas) {
    const c = a.depth && a.depth.liveCheck; if (!c) continue;
    perArea.push({ ep: e.ep, area: a.area, samples: c.samples, stable: c.stable, atWall: c.atWall, pushed: c.pushed, outsideMap: c.outsideMap, inBand: c.inBand, outsideArea: c.outsideArea, notInBand: c.stable - c.inBand - c.outsideArea, runs: c.runs.length, band: a.depth.romWalkable ? [a.depth.romWalkable.min, a.depth.romWalkable.max] : null, depthRange: a.depth.depthRange ? [a.depth.depthRange.min, a.depth.depthRange.max] : null });
    for (const k of Object.keys(tot)) tot[k] += c[k] || 0;
  }
  return { note: 'live on-ground P1 samples (height == floor) of every walk and depth-probe run: stable = the emulated collision routine leaves the sample in place, atWall = pushed sideways by <= 16 px (sample logged after the move, before the push, while leaning on a wall), pushed = other, outsideMap; inBand = stable samples inside the exported per-X band, outsideArea = stable samples past the area image (walking off at the exit)', total: tot, perArea, shaftMap: shaftMapCheck() };
}

function decodeFacts() {
  const f = path.join(OUT, 'evidence/evidence.json'), ev = fs.existsSync(f) ? new Map(JSON.parse(fs.readFileSync(f, 'utf8')).map(x => [x.label, x.evidence_id])) : new Map();
  return DECODE_FACTS.map(d => Object.assign({}, d, { evidence: (d.evidence || []).map(l => ({ label: l, id: ev.get(l) || null, file: `evidence/${l}.txt` })) }));
}

function build(eps) {
  mkdir(OUT);
  const val = fs.existsSync(path.join(OUT, 'validation.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'validation.json'), 'utf8')) : null;
  const episodes = [], sheetItems = [];
  for (const I of INFO) {
    if (!eps.includes(I.ep)) continue;
    const s = I.s, epRec = {
      ep: I.ep, stageByte: s, titleCard: texts().cards[I.ep] || null,
      script: { table: hex(I.script.table), segments: I.script.segs.map(g => ({ i: g.i, addr: hex(g.addr), trigger: g.trigger, area: g.area, state: hex(g.state, 2), stateMeaning: G.STATE_NAMES[g.state] || null, w2: g.w2, w4: g.w4, w6: g.w6, w8: g.w8, followY: g.followY, leadFromSeg: g.leadFromSeg, nextState: hex(g.nextState, 2), yTrigger: g.yTrigger })) },
      priorityMasks: G.priority(s, 0).map(v => hex(v, 4)), layerControl: s === 6 ? { default: '0x12D6', area1: '0x06D6' } : '0x12D6',
      areas: [],
    };
    for (const A of I.areas) {
      const live = areaLive(I.ep, A.area);
      const rec = buildArea(I, A, live, {});
      const e2 = G.areaEntry(G.T.area2, s, A.mapArea), e3 = G.areaEntry(G.T.area3, s, A.mapArea), shift = G.shiftOf(s, A.mapArea);
      rec.caption = texts().captions[`${I.ep}/${A.area}`] || null;
      rec.textsSeen = texts().all.filter(x => x.stage === s && x.area === A.area && x.main === 0xc).map(x => ({ text: x.text, row: x.row, run: x.run, frame: x.f }));
      rec.segments = A.segs.map(g => g.i);
      rec.cameraLimits = {
        romTriggers: { first: A.firstTrigger, last: A.lastTrigger, note: 'camera-X triggers of the first and last segment of the area (Y triggers in E7 area 1); the last one is where the camera stops (lock, exit or boss)' },
        romStart: [e2.x0, e2.y0],
        live: live ? { camX: live.camX, camY: live.camY, ramCamX: live.ramCamX, ramCamY: live.ramCamY, frames: live.frames, runs: [...new Set(live.runs)], firstFrame: live.firstFrame, lastFrame: live.lastFrame } : null,
      };
      rec.parallax = { scroll2: 'x = camX - 0x40, y = 0x300 - camY (1:1 with the camera)', scroll3Shift: shift, scroll3Ratio: 1 / (1 << (shift & 63)), scroll3Rule: `X3 = camX >> ${shift}`, verticalParallax: !!G.vflagOf(s, A.mapArea), scroll3Start: [e3.x0, e3.y0], liveCheck: live ? { x: live.parallaxX, y: live.parallaxY } : null };
      const fl = TR.floorList(s, A.area), band = rec.band;
      const depthOf = (X, h) => h - (s === 6 && A.area === 1 ? 0 : TR.floorAt(fl, X));
      let dmin = null, dmax = null;
      if (band) for (const p of band.profile) { if (p[2] === null) continue; for (const X of [p[0], p[1] - 1]) { const a0 = depthOf(X, p[2]), a1 = depthOf(X, p[3] - 1); dmin = dmin === null ? Math.min(a0, a1) : Math.min(dmin, a0, a1); dmax = dmax === null ? Math.max(a0, a1) : Math.max(dmax, a0, a1); } }
      rec.depth = {
        romWalkable: band ? { min: band.min, max: band.max, columns: band.columns, columnsWithFloor: band.columnsWithFloor, seededColumns: band.seededColumns, note: 'map rows h (= depth + floor) where the emulated collision routine 0x1309C leaves a grounded player in place (lib/terrain.cjs), per map X: the run holding the live P1 ground samples at that X, propagated by overlap; floorRuns aggregate it per 16-px column ([min h, max h + 1]), floorProfile is the per-pixel version ([x0, x1, hMin, hMax + 1, raisedFloor]). Types 1-8 are push walls, so these are the lane limits the game enforces' } : null,
        depthRange: band ? { min: dmin, max: dmax, note: 'depth (+0x10) = h - floor(X) over the band, with floor from floorList' } : null,
        clamp: band ? band.clamp : null,
        floorList: { table: hex(fl.table), note: 'floor height +0x54 per X (0x12FE4 / 0x1302C): flat entries give floor, slope entries w3 +/- (X - x0) / 4; wading sets +0x53', entries: fl.entries.map(e => ({ addr: hex(e.addr), mode: e.mode, x0: e.x0, x1: e.x1, floor: e.floor, slope: e.slope, wading: e.wading })) },
        liveP1: live ? { depth: live.p1Depth, floor: live.p1Floor, x: live.p1X, note: 'on-ground P1 samples of the bot walk (not exhaustive)' } : null,
        liveCheck: band ? band.liveCheck : null,
      };
      rec.floorRuns = band ? band.floorRuns : null; rec.floorProfile = band ? band.profile : null; delete rec.band;
      if (s === 6 && A.area === 1) rec.depth.collisionMap = { file: 'rom/ep7-area1-collision.png', note: 'E7 area 1 collision map (512x256 cells of 16 px) built at 0x91C000 from blocks 0xC/0xD of 0x141DC8 and chunks 0x16E188 (0x12C16 -> 0x12C50); h and X wrap (0x136E4 masks h with 0xF0 and X with 0x1F0), so the band repeats every 256 px of the shaft' };
      if (live) rec.liveStates = { segmentStates: live.states, layerControl: live.layerControl, videoControl: live.videoControl, rowscrollFrames: live.rowscrollFrames };
      rec.dynamic = dynamicTiles(I.ep, A.area, A.mapArea, rec);
      rec.paletteAnimation = paletteAnimation(I.ep, A.area);
      if (val) rec.validation = (val.romVsLive || []).find(x => x.ep === I.ep && x.area === A.area) || null;
      epRec.areas.push(rec);
      if (rec.files.composite) sheetItems.push({ file: rec.files.composite, label: `EP${I.ep} AREA ${A.area}${rec.caption ? ' ' + rec.caption.text : ''} (${rec.scroll2Size ? rec.scroll2Size.join('x') : ''})` });
      console.log(`[build] ep${I.ep} area ${A.area}: ${rec.scroll2Size ? rec.scroll2Size.join('x') : '-'} ${rec.extentSource}`);
    }
    episodes.push(epRec);
  }
  const screens = screensExport();
  const sheet = contactSheet(sheetItems, 'contact-sheet.png');
  const screenSheet = screens.length ? gridSheet(screens.map(x => ({ file: x.files.composite, label: `${x.run.replace('stg-screens-', '')} F${x.f}` })), 'contact-screens.png') : null;
  const doc = {
    generatedBy: 'node tools/re/export/stages.cjs build', generated: new Date().toISOString(),
    conventions: CONVENTIONS, decode: decodeFacts(), episodes, screens, contactSheet: sheet.file, contactScreens: screenSheet && screenSheet.file,
    validation: val ? { layersSummary: val.layersSummary, layerFramesNotExact: (val.layers || []).filter(x => x.same !== x.total), priority: val.priority || null, hellRoadRowscroll: val.hellRoadRowscroll || null, terrainUnderFeet: val.terrainUnderFeet, depth: depthSummary(episodes), file: 'validation.json' } : { depth: depthSummary(episodes) },
  };
  writeJSON(path.join(OUT, 'stages.json'), doc);
  if (val) { val.depth = doc.validation.depth; writeJSON(path.join(OUT, 'validation.json'), val); }
  console.log('[build] wrote', path.join(OUT, 'stages.json'));
}

// ---------------------------------------------------------------- main
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const eps = rest.length ? rest.map(Number) : [1, 2, 3, 4, 5, 6, 7, 8];
  if (cmd === 'live') return live(eps);
  if (cmd === 'cmp') { // quick look: node stages.cjs cmp <run>
    const r = compareRun(rest[0]);
    const by = new Map();
    for (const x of r) { const k = `${x.st}/${x.ar}`; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
    for (const [k, v] of by) {
      const s2 = v.filter(x => x.s2), s3 = v.filter(x => x.s3);
      const full2 = s2.filter(x => x.s2.same === x.s2.tot).length, full3 = s3.filter(x => x.s3.same === x.s3.tot).length;
      const worst2 = s2.reduce((m, x) => Math.min(m, x.s2.pct), 100), worst3 = s3.reduce((m, x) => Math.min(m, x.s3.pct), 100);
      const tiles = s2.reduce((a, x) => [a[0] + x.s2tiles.same, a[1] + x.s2tiles.tot], [0, 0]);
      const pal = v.reduce((a, x) => [Math.min(a[0], x.pal.s2), Math.min(a[1], x.pal.s3), Math.min(a[2], x.pal.obj)], [512, 512, 512]);
      console.log(`st ${k}: ${v.length} frames; scroll2 100% in ${full2}/${s2.length} (worst ${worst2}), tiles ${tiles[0]}/${tiles[1]}; scroll3 100% in ${full3}/${s3.length} (worst ${worst3}); min pal match s2 ${pal[0]} s3 ${pal[1]} obj ${pal[2]}`);
      const bad = v.filter(x => (x.s2 && x.s2.same !== x.s2.tot) || (x.s3 && x.s3.same !== x.s3.tot)).slice(0, 6);
      for (const b of bad) console.log('   ', JSON.stringify(b));
    }
    return;
  }
  if (cmd === 'static' || cmd === 'all') { mkdir(OUT); writeJSON(path.join(OUT, 'rom-maps.json'), staticExport()); if (cmd === 'static') return; }
  if (cmd === 'live' || cmd === 'all') { if (cmd === 'all') { await live([1, 2, 3, 4, 5, 6, 7, 8]); await depthRun(eps); } }
  if (cmd === 'depth') return depthRun(eps);
  if (cmd === 'screens' || cmd === 'all') { await screensRun(); if (cmd === 'screens') return; }
  if (cmd === 'validate' || cmd === 'all') { await validateAll(eps); if (cmd === 'validate') return; }
  if (cmd === 'all') { await priorityRun(); const vf = path.join(OUT, 'validation.json'), old = JSON.parse(fs.readFileSync(vf, 'utf8')); writeJSON(vf, Object.assign(old, { priority: priorityValidation() })); }
  if (cmd === 'priority') { await priorityRun(); const vf = path.join(OUT, 'validation.json'), old = fs.existsSync(vf) ? JSON.parse(fs.readFileSync(vf, 'utf8')) : {}; writeJSON(vf, Object.assign(old, { priority: priorityValidation() })); return; }
  if (cmd === 'priority-check') { const vf = path.join(OUT, 'validation.json'), old = JSON.parse(fs.readFileSync(vf, 'utf8')); writeJSON(vf, Object.assign(old, { priority: priorityValidation() })); return; }
  if (cmd === 'rowscroll') { const vf = path.join(OUT, 'validation.json'), old = JSON.parse(fs.readFileSync(vf, 'utf8')); old.hellRoadRowscroll = rowscrollCheck(); console.log(JSON.stringify(old.hellRoadRowscroll)); writeJSON(vf, old); return; }
  if (cmd === 'screens-export') { const jf = path.join(OUT, 'stages.json'), doc = JSON.parse(fs.readFileSync(jf, 'utf8')); doc.screens = screensExport(); const sh = gridSheet(doc.screens.map(x => ({ file: x.files.composite, label: `${x.run.replace('stg-screens-', '')} F${x.f}` })), 'contact-screens.png'); doc.contactScreens = sh.file; writeJSON(jf, doc); console.log('[screens] exported', doc.screens.length); return; }
  if (cmd === 'validate-layers') { const vf = path.join(OUT, 'validation.json'), old = JSON.parse(fs.readFileSync(vf, 'utf8')), v = await validateAll(eps, { layersOnly: true }); writeJSON(vf, Object.assign(old, { layers: v.layers, layersSummary: v.layersSummary })); return; }
  if (cmd === 'build' || cmd === 'all') return build(eps);
  console.error('usage: node tools/re/export/stages.cjs static|live|screens|validate|priority|build|all');
  process.exitCode = 2;
}
if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = { walkPlan, readHook, readFrames, areaLive, terrainBand, groundSamples, classifySample, typeAtFn, hellRoadRowscroll, textLines, depthPlan, DEPTH_PROBES };
