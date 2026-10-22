# MAME harness for the original Cadillacs & Dinosaurs

Scripts that drive the original arcade game (MAME romset `dino`, the user's own dump) headless and record exactly
what it draws. Everything here is research tooling; nothing in this folder ships with the game, and every output goes
to the git-ignored `work/` folder.

The verified map of the game's RAM, ROM tables and code is in `tools/re/MEMORY-MAP.md`; its machine-readable twin is
`work/re/memory-map.json` (`node tools/re/build-memory-map.cjs`). The map uses fact ids: V = verified, H = harness
fact, U = unverified, R = rejected. This README keeps only what the harness needs and refers to those ids. The
runtime tools (cheats, prediction) are in `tools/re/runtime/README.md`.

| File | What it does |
|---|---|
| `run.cjs` | `node tools/re/mame/run.cjs <plan.json> [--quiet] [--dry]`. Turns a JSON plan into a self-contained Lua script (the plan is embedded as a Lua table, so Lua never parses JSON), runs MAME, and writes `work/re/runs/<name>/`. It also exports `runPlan(plan) -> Promise<summary>` and `readFrames(name)`. |
| `make-states.cjs` | `node tools/re/mame/make-states.cjs [jack hannah mustapha mess]`. Rebuilds the stage 1 save states from a cold boot, finds the frame where control starts, and checks each state. Writes `work/re/harness/states.json`. |
| `obj.cjs` | CPS-1 OBJ helpers: MAME palette conversion, block expansion, `renderObj(frame)`, `compare(render, snapshot)`, `matchRecords(entries)` (matches live sprites back to ROM frame records). |
| `validate-obj.cjs` | `node tools/re/mame/validate-obj.cjs <run> [frames…] [--nosprites <run2>]`. Renders the dumped OBJ list, compares it with MAME's snapshot, scans the frame lag and screen origin, and matches hero sprites to ROM records. |
| `contact.cjs` | `node tools/re/mame/contact.cjs <runDir> [out.png] [--cols 8] [--scale 0.5]`. Makes a contact sheet of a run's snapshots, labelled with frame numbers. |
| `side.cjs` | `node tools/re/mame/side.cjs out.png a.png b.png …`. Puts images side by side. |
| `examples/*.json` | Ready-made plans: boot to the select screen, Jack walking (with full dumps), a sprite-free replay of that walk, Mustapha idle (matched to record 171), and a scroll/palette/RAM dump. |

Paths can be changed with environment variables: `MAME_EXE` (default `E:/tools/mame/mame.exe`, MAME 0.289),
`MAME_ROMPATH` (`E:/tools/mame/roms`, the private copy with blank stand-ins for the six PLDs and the QSound
`dl-1425.bin`; MAME warns "WRONG CHECKSUMS" for those, which is expected) and `MAME_STATES` (`E:/tools/mame/states`).
Never point `MAME_ROMPATH` at `E:/mostafa/dino`; that folder holds the user's original set and is read-only.
Each run uses `-video none -sound none -nothrottle` and its own cfg/nvram folders (`<run>/mame/`), so runs don't
affect each other and several can run in parallel. Typical cost: 2–5 s per run (about 6–9× real time).

## Plan format

```jsonc
{
  "name": "stage1-jack-walk",            // required, [A-Za-z0-9._-]; output dir work/re/runs/<name>/ (wiped first)
  "frames": 240,                         // required; the run exits after this many frames (later if a save needs it)
  "loadState": "stage1-jack",            // optional; E:/tools/mame/states/dino/<name>.sta
  "saveStateAt": {"frame": 1302, "name": "stage1-jack"},   // optional; an object or an array of them
  "coinStart": true,                     // optional; true = Coin 1 at 330-335, 1P Start at 370-375 (from power-on)
                                         //   or {"coin": 330, "start": 370, "hold": 6}
  "inputs": [ {"from": 0, "to": 180, "keys": ["P1 Right", "P1 Button 1"]} ],
  "pokes":  [ {"from": 30, "to": 40, "addr": "0xFF1234", "size": 2, "value": "0x0005"},
              {"from": 30, "rel": "obj", "addr": 6, "size": 2, "value": "0xFF00"} ],
  "dump": { "from": 0, "to": 240, "every": 1,
            "obj": true, "cpsA": true,          // both default to true when "dump" is present
            "palette": false,                 // the 32 OBJ palettes (0x400 bytes at the palette base)
            "allPalettes": false,             // all 6 pages (0x1800 bytes): OBJ, scroll1, scroll2, scroll3, stars
            "scroll": false,                  // raw scroll1/2/3 tilemaps + rowscroll -> binary files, plus scroll X/Y
            "ram": [["0xFFB270", 64]],        // hex strings in frames.jsonl
            "ramFile": false,                 // full 64 KB main RAM per dumped frame -> ram-fNNNNNN.bin
            "objAll": false },                // keep going past the 0xFF00 end marker (all 256 slots)
  "snapshots": [30, 60],                     // snap-fNNNNNN.png (384x224, MAME's real screen)
  "snapshotEvery": {"from": 30, "to": 240, "every": 30},
  "regions": [{"frame": 0, "tag": ":gfx", "offset": 0, "len": 4194304, "file": "gfx.bin"}],   // memory-region dump
  "stopWhen": {"addr": "0xFFB27C", "size": 2, "value": 1100, "after": 0}                  // stop early when RAM == value
}
```

- Numbers can be JSON numbers or hex strings (`"0x900000"`, `"$FF00"`).
- Key names are MAME field names: `P1 Right`, `P1 Left`, `P1 Down`, `P1 Up`, `P1 Button 1` (attack),
  `P1 Button 2` (jump), `Coin 1`, `1 Player Start`, `Service Mode`, and the same for P2/P3. Short aliases also work:
  `right left up down attack jump coin start`.
- `pokes[].rel`: `"obj"` or `"pal"` makes `addr` an offset from the OBJ/palette base that the CPS-A registers point
  at **at the moment of the write**. You need this because the game double-buffers the OBJ list (see below).

### Frame numbering (read this before trusting a frame number)

- Frame *n* is the *n*-th `frame_done` callback, counted from 0. From power-on, frame *n* is MAME screen frame *n*.
- With `loadState`, the state is loaded before the first frame, so frame 0 is the first frame after the save. A
  state saved at frame *S* of its plan resumes at boot frame *S+1* (`frames.jsonl` field `mf` = MAME's frame number).
- Inputs and pokes for frame *n* are written at the end of frame *n−1*, after that frame's dump and snapshot, so
  frame *n*'s game code sees them. Frame 0's inputs are set before the first frame.
- In each callback the order is dump → snapshot → save state → stopWhen check → write inputs/pokes for the next frame.

### Outputs (`work/re/runs/<name>/`)

`frames.jsonl` has one JSON object per dumped frame:

```jsonc
{"f": 60, "mf": 1363,
 "cpsA": [36864, 37056, ...32 words], "cpsB": [...32 words],   // :cps_a_regs / :cps_b_regs shares (0x800100 / 0x800140)
 "objBase": 9437184, "objCount": 4,
 "obj": [{"i":0, "x":215, "y":120, "code":4001, "attr":34, "pal":2, "flipX":true, "flipY":false,
          "bw":1, "bh":1, "sx":151, "sy":104}],                 // sx/sy = screen pixel of the block's top-left
 "palBase": 9519104, "pal": "F111FFCA…",                        // big-endian words, hex
 "scroll": {"s1": {"base":…, "x":…, "y":…, "file":"scroll1-f000005.bin"}, …, "rowscroll": {…}},
 "ram": {"FFB270": "0000…"}, "ramFile": "ram-f000060.bin"}
```

There is also `summary.json` (plan, exit code, seconds, frame range, snapshots, states saved, filtered MAME log;
`ok: true` when MAME exited cleanly), `plan.lua` (the exact script that ran), `plan.json` and `lua-log.txt`.

## Boot recipes (observed, MAME 0.289, World set `dino`)

Counted in frames from power-on:

| Frames | What's on screen / what to press |
|---|---|
| 0–90 | black / boot |
| 90–200 | "Cadillacs & Dinosaurs" version text |
| 210–300 | WARNING (export notice) |
| ~320 | title screen, "INSERT COIN". **Coins before ~300 are ignored** (an earlier probe with a coin at frame 30 got no credit) |
| 330–335 | `Coin 1`, which gives 1 CREDIT |
| 370–375 | `1 Player Start` |
| ~400 | character select, cursor on Jack; order left to right is Jack, Hannah, Mustapha, Mess; 10-second timer (the timeout picks Jack at ~1000) |
| 430–433, 445–448, 460–463 | `P1 Right` ×0/1/2/3 for Jack/Hannah/Mustapha/Mess (separate presses; each moves the cursor one step) |
| 480–483 | `P1 Button 1` to confirm |
| ~660 | stage 1 intro: the Ferris gang's plane, then the poachers line up with a dialogue caption |
| ~1255 | the hero's scripted blast scatters the gang, and the HUD appears |
| 1304–1320 | **control returns** (hero-dependent, see below) |

The main state byte 0xFF84D0 goes 0 (title) → 4 (select) at about frame 393 and → 0xC (gameplay) at frame 640 (V33).
The game's own counters (0xFF8000, 0xFF84DA) count main-loop passes, not video frames: they stay 0 until about frame
389 and freeze during the select-confirm transition. Always count frames with the harness (`f` / `mf`), not with
0xFF8000.

"Control returns" was measured, not guessed: `make-states.cjs` runs the recipe twice, once holding `P1 Right` from
frame 1000 and once idle. The first frame where P1's world X (`0xFFB27C`) differs between the two runs is the first
frame where the game obeys the stick. The state is saved two frames earlier, at a frame with no input held.

## Save states (`E:/tools/mame/states/dino/`)

| State | Hero | Saved at boot frame | Control from | Check (load + hold Right) |
|---|---|---|---|---|
| `stage1-jack` | Jack | 1302 | 1304 | P1 X moves on plan frame 1; 1056 → 1120 in 40 frames; idle stays 1056 |
| `stage1-hannah` | Hannah | 1305 | 1307 | moves on frame 1; 1056 → 1121 |
| `stage1-mustapha` | Mustapha | 1318 | 1320 | moves on frame 1; 1056 → 1123 |
| `stage1-mess` | Mess | 1313 | 1315 | moves on frame 1; 1056 → 1119 |
| `stage1-mess-intro` | Mess | 1200 | (none yet) | stage 1 intro during the dialogue, before the blast; resumes at boot frame 1201 |

In all four `stage1-*` states the hero's feet are at screen (159, 200), the hero faces right (mirrored), and the gang
is still flying off screen from the intro blast. Each hero is still in the end pose of its blast. These are the ROM
records matched on plan frames 0–1 (`statecheck-*` runs): Jack 73 (10/10 blocks; Jack shares palette 0 with other
sprites, so it isn't counted as an exact group match), Hannah 1547, Mustapha 219, Mess 696. Contact images: `work/re/harness/stage1-states.png` and `stage1-states2.png`.
Details for each hero, with the exact inputs, are in `work/re/harness/states.json`.

The runtime pass added 76 more states to the same folder, rebuilt with `tools/re/runtime/make-runtime-states.cjs` and
listed in `work/re/runtime/states.json`:
- `stage1-<hero>-armed-<weapon>`: all 4 heroes × 15 weapons;
- `stage2`–`stage8` for `-jack` and `-mustapha`;
- `stage1-jack-area1` and `stage1-jack-area2`.

The live verifier reloaded all 80 stage states and checked each one (V40).

States depend on this MAME version (0.289) and on this romset, including the blank PLD and QSound stand-ins. If
either changes, rebuild them with `node tools/re/mame/make-states.cjs` (about 1 minute for all four).

## OBJ decode: validated transform

**Screen position.** The CPS-1 sprite list sits at the OBJ base given by the CPS-A register at 0x800100:
`addr = 0x900000 + ((reg << 8) & 0x3FFFF)`, aligned to 0x800. Each entry is 4 words: X, Y, code, attr. attr bits:
palette 0–4, flipX 0x20, flipY 0x40, block width−1 in bits 8–11, block height−1 in bits 12–15. An attr of 0xFF00 ends
the list. The screen pixel of an entry's top-left is:

```
sx = (x & 0x1FF) - 64        sy = (y & 0x1FF) - 16        (visible screen 384 x 224)
```

**Tile codes.** OBJ codes index the 4 MB graphics directly: tile bytes start at `code * 128`, which is
`rom.cjs tile(code)`. No offset or bank is needed. MAME's own `:gfx` region was dumped and is byte-identical to
`rom.cjs`'s `gfx` buffer, and every code seen in stage 1 is below 0x8000 (highest 0x57A1 across 29,852 entries).

**Blocks.** A bw×bh entry expands to tile `(code & ~0xF) + ((code + col) & 0xF) + 0x10*row`. Columns wrap inside a
16-tile row. flipX/flipY reverse the column/row order and mirror each tile. Entries are drawn from last to first, so
entry 0 ends up on top. Pen 15 is transparent.

**Colour.** Palette words are `BRGB`, converted the way MAME does it:
`c = n * 0x11 * (0x0F + 2*B) / 0x2D` (integer). Live OBJ palettes 0–31 equal ROM palette set 0 (`rom.cjs paletteSet`)
with the brightness nibble set to F, so the ROM table at 0xB7A52 is the real in-game palette.

**Timing.** The OBJ list dumped at frame *f* is what snapshot *f+1* shows. CPS-A registers, including the scroll
registers, dumped at frame *f* are the ones used for snapshot *f*. So sprites trail the tilemaps by one frame, which
is the CPS-1 sprite DMA delay. Measurements:
- The lag scan from −2 to +2 gives 100 % agreement only at lag −1, in every frame that has motion.
- Sprite-free replays: a poke at frame *f* with `{rel:"obj", addr:6, value:0xFF00}` empties exactly snapshot *f*.
- A scroll2 image-shift measurement over 20 frames matched the register deltas at lag 0 every time.
- P1's world X in RAM leads the OBJ list by one more frame: RAM at *f−1* → OBJ dump *f* → snapshot *f+1*.

**Double buffering.** The OBJ base alternates between 0x900000 and 0x904000 (register 0x9000/0x9040) every frame. The
IRQ2 vblank handler at 0x542 (autovector 0x68) does this. It loads `#$9000`, tests the word at 0xFFE9B4, switches to
`#$9040` if that word is nonzero, and writes the result to 0x800100. It then writes the scroll1/2/3 bases from RAM
shadows at 0xFF802A/2C/2E. REA evidence: `ev_62e713653c9c0012d72fd1e9a042ebda2494eb00085c1b6892f90fe1a9efcfc0`
(vector table and 0x53E–0x582) and `ev_d87d740a5670c6f1533317e964a4ce95480cac3f17d852f0db6b7b2eaae93a26`
(0x582–0x62E). A raw poke at a fixed OBJ address only hits every other frame's list, so use `rel: "obj"`.

The builder side has since been verified, both statically and with live breakpoints (V02). The sprite-list builder at
0x13FA6:
- writes 0x900000 when 0xFFE9B4 is non-zero and 0x904000 when it is zero;
- then flips the word with `not.w` at 0x14098.

The IRQ therefore shows the list that was just built. Every list ends with the words (0, 0x100, 0, 0xFF00). Shadow
sprites (0x14EC0) sit between the object entries and that end marker.

**Validation results.** Nine gameplay frames were checked: Mustapha idle and a pteranodon pass, and Jack walking,
fighting and jumping in crowds of up to 56 entries. The sprite-free replays (`--nosprites`) were used for recall.
- Precision: 60,562 of 60,686 rendered sprite pixels match the snapshot exactly (99.80 %).
- Recall: 60,529 of 60,529 visible sprite pixels are reproduced (100 %).
- Every one of the 124 non-matching pixels is covered by the scroll1 HUD/caption layer ("JOIN-IN", "INSERT COIN",
  "TOP OF THE BUILDING"), which has priority over sprites. The scan for the best screen origin picked (−64, −16) every
  time.

Reports and overlays are in `work/re/harness/validate/` and the totals in `work/re/harness/validation.json`. In the
overlays, sprite pixels that match are drawn in their own colour, pixels that don't match are magenta, and the
background is dimmed.

## Mapping live sprites back to ROM frame records

`obj.cjs matchRecords(entries)` groups a hero's entries (same palette: Jack 0, Hannah 1, Mustapha 2, Mess 3) and
finds the ROM record (`rom.cjs parseRecord`) that has the same tile codes, the same block sizes and the same relative
layout:

```
facing as stored (no mirror):  sx = feetX + layout.x                 attr.flipX = record flipX
mirrored (facing right):       sx = feetX - layout.x - 16*bw         attr.flipX = record flipX ^ 1
both:                          sy = feetY + layout.y                 (layout = rom.cjs offs, relative to the feet)
```

Proof: in `stage1-mustapha` the four live entries `0xFA1/0x22`, `0xFB0/0x2222`, `0xFE0/0x222`, `0xFF0/0x222` are
**record 171** (`FA1/0002 @(-8,-96)`, `FB0/2202 @(-24,-80)`, `FE0/0202 @(-24,-32)`, `FF0/0202 @(-24,-16)`). The
match is 4 of 4 blocks, mirrored, with the feet at screen (159, 200), at plan frames 30, 120 and 260. Mustapha's idle
cycle also shows record 174 (11 of 11). Jack's walk and fight gave exact matches to records 0, 5, 6, 9, 15, 35 and 66.
The ROM sprite art faces left, and the game sets flipX to face right.

`matchRecords` compares a group against one record at a time, but one animation frame can draw more than one record
(V04). Matching every frame needs the actor's RAM instead. The cases:
- **Second record.** A second record is drawn at the same origin when frame word 1 is ≥ 0. Examples are Mustapha's Uzi
  stance (270 + 269) and the shotgun-fire frame (271 + 269).
- **Composite.** When bit 15 of frame word 0 is set, the frame is a composite: a part list at `fp + 2 + word1`, with
  each part offset by its own (dx, dy). The Chinpira punches work this way.
- **Split body.** When `obj+0x25` bit 0 is set (walking with a gun), the legs record comes from `+0x30` at the feet,
  and the torso is offset by `+0x3C/+0x3E`.
- **Weapons.** A held weapon is its own object (pool A) that shares the hero's depth, and it is drawn first, so it
  appears on top (V07).
- **Palette.** A palette can be forced per actor through `obj+0x23` bit 7, whose low 5 bits replace every block's
  palette.

`tools/re/runtime/predict.cjs` handles the records drawn by frame words 0 and 1. `tools/re/verify-live/drawmodel.cjs`
also handles composites and split bodies, and its output matched the OBJ list exactly in 1,452 of the 1,490 frames
checked.

## RAM addresses the harness relies on

The full verified map is in `tools/re/MEMORY-MAP.md`. The rows below are the ones harness plans use most. The P1
struct base is 0xFFB274 (V25).

| Address | Meaning | Status |
|---|---|---|
| 0xFFB27C | P1 world X: the integer word of P1 `+0x08` (16.16), 1056 at every `stage1-*` state | verified (V26) |
| 0xFFB280 | P1 height (integer word of `+0x0C`; up is positive) | verified (V26) |
| 0xFFB284 | P1 depth / lane (integer word of `+0x10`; larger = farther = higher on screen; 296 at the stage 1 start) | verified (V26) |
| 0xFFB288 | P1 X velocity `+0x14` (8.8; walk 414/435/422/409 for Jack/Mustapha/Hannah/Mess) | verified (V26, V28) |
| 0xFF8744 | camera X: `screen feetX = X(f−1) − camX(f−1)` for OBJ dump *f* | verified (V05) |
| 0xFF8748 | camera Y: `screen feetY = camY − (depth + height) + 240`, read at f−1 | verified (V05). The old row here had the depth term's sign as inferred; that is now settled |
| 0xFFE9B6 / 0xFFE9B8 | camera X − 0x40 / camera Y, copied by the sprite builder (camera Y is forced to 0 while 0xFF84DC != 0) | verified (V02) |
| 0xFFE9B4 | OBJ buffer toggle. The builder writes 0x900000 when it is non-zero, then flips it; IRQ2 shows 0x900000 when it is 0, else 0x904000 | verified (V02) |
| 0xFF84D0 / 0xFF84D9 / 0xFF8786 | main state / stage (0–7 = EPISODE 1–8) / area | verified (V33, V34, V35) |

## Gotchas

- **Don't use MAME's `-state` command-line option.** With it, the autoboot Lua never runs. `run.cjs` loads states
  from Lua (`machine:load(name)` before the first frame), which works.
- `machine:save(name)` / `machine:load(name)` use `<state_directory>/dino/<name>.sta`.
  `screen:snapshot(file)` writes to `<snapshot_directory>/<file>` with no system subfolder.
- CPS-A registers are write-only on the bus: reading 0x800100 through the program space returns 0. The harness reads
  the `:cps_a_regs` / `:cps_b_regs` memory shares instead, which hold what the game wrote.
- `space:read_range(a, b, 8)` returns bytes in address order (big-endian words). Width 16 doesn't do what you'd
  expect, so the harness only uses width 8.
- Without `-cfg_directory`/`-nvram_directory`, MAME writes `cfg/` and `nvram/` into the current folder. `run.cjs`
  gives each run its own.
- Coins inserted during boot (before about frame 300) are lost.
- Pixel comparisons must use MAME's palette formula above. Plain `n*17` is only right at brightness F, which is what
  the game uses in stage 1 but not during fades.
- Sprites can be hidden behind scroll1 (HUD text and captions), so a mismatch over HUD text is priority, not a decode
  error. Use a `--nosprites` replay to get the true visible-sprite mask.
- Static frames match at every lag, so only judge timing on frames with motion.
- In Git Bash heredocs, `\\` inside a quoted `'EOF'` heredoc sent to `node -` can come out as a single backslash. Write
  scripts to files instead of piping them through heredocs.

## Open questions

- MAME's CD63B bank mapper wasn't checked for OBJ codes ≥ 0x8000. Stage 1 never uses them; later stages might.
- Sprite/tilemap priority masks (CPS-B layer control, `cpsB` words) aren't modelled in `obj.cjs`. A full-screen
  rebuild would also need the scroll1/2/3 tilemap decode (the raw dumps already exist via `dump.scroll`).
- The P1 struct is now mapped; see `tools/re/MEMORY-MAP.md`, section 4. 0xFFB284 is depth, and 0xFFB288 is the X
  velocity, not a position.
- Enemy palettes: enemies use palettes 5, 9, 13, 14, 25 and 29 at run time. The game can force a palette per actor
  through `obj+0x23` bit 7 (V04). Whether each enemy uses that override or carries the palette in its record
  attributes hasn't been checked. `matchRecords` matches on code and layout, not on palette.
- The two draw paths that `drawmodel.cjs` doesn't model, `obj+0x25` bit 6 (0x147FE) and the grab pair path 0x14114,
  appear in stages 3 and 8 (U01).
