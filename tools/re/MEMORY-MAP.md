# Cadillacs & Dinosaurs (1993 arcade original): verified memory map

This is the reverse-engineering foundation for the sequel work. It covers the original CPS-1 game (MAME set `dino`,
the user's own ROM dump). It merges five research passes:

- **harness:** MAME capture tooling
- **static:** REA + Rizin disassembly
- **runtime:** RAM mapping in MAME
- **static verifier:** an independent REA/Rizin re-check
- **live verifier:** an independent MAME debugger re-check with breakpoints and taps

Nothing here ships with the game.

The machine-readable twin is `work/re/memory-map.json`, built by `node tools/re/build-memory-map.cjs` from the repo
root. The build also re-reads 19 of the quoted ROM constants from the program image and fails if any of them differ.
Keep this file and the build script in step.

## How to read this

| Label | Meaning |
|---|---|
| **V01–V40 verified** | At least one verifier confirmed the claim and none refuted it. A fact marked "with correction" includes a verifier's fix. |
| **H01–H15 harness** | The harness checked these itself against MAME screenshots, but no verifier re-checked them. Under the rules they are unverified. Where a verified fact covers the same ground, it is named. |
| **U01–U16 unverified** | Single-source observations, things the verifiers found on the side, and inferences. Use them, but check them first. |
| **R1–R9 rejected** | A verifier refuted the claim. The claim is listed only to say what is wrong, and the correction says what is true. A correction comes from the verifier that refuted the claim, so it is single-source unless noted otherwise. |

Evidence ids are REA records (`rea execute-rizin-command`), shortened here to their first 8 hex digits. The full ids
are in `work/re/memory-map.json`, and the record files are in these folders:

| Folder | Evidence |
|---|---|
| `work/re/static/evidence/` | static, `01`–`42` |
| `work/re/verify-static/evidence/` | static verifier, `c01`–`c48` |
| `work/re/verify-live/evidence/` | live verifier, `vl01`–`vl10` |
| `work/re/runtime/evidence/` | runtime, `rt01`–`rt24` |
| `work/re/harness/rea-*.json` | harness |

Each MAME run named here is in `work/re/runs/<run>/`. Runs starting `vl-` belong to the live verifier and runs starting
`rt-` to the runtime pass.

Scorecard:

| Verifier | Claims | Confirmed | Refuted | Unverifiable |
|---|---|---|---|---|
| Static | 48 | 43 | 3 | 2 |
| Live | 49 | 42 | 7 | 0 |

The outcome is 40 verified facts and 9 rejected claims.

## Conventions (all verified)

- **A5 base.** `A5 = 0xFF8000` throughout the game code (`lea 0x8000.w,A5` at reset 0x41A), so `(d16,A5)` means
  `0xFF8000 + d16`. Main RAM is `0xFF0000–0xFFFFFF`.
- **Program image.** `work/re/dino-prg.bin` is the byte-swapped program, with file offset equal to the 68000 address.
  `tools/re/rom.cjs` reads it.
- **Three character orders.** Do not mix them up:
  - **Character id** (`obj+0x03`, `obj+0x20 = id*4`): **0 Jack, 1 Mustapha, 2 Hannah, 3 Mess**. Every table indexed
    per character uses this order (V27).
  - **Select screen:** Jack, Hannah, Mustapha, Mess. The names at 0xB39E and the stats at 0xB444 follow it.
  - **OBJ palette:** 0 Jack, 1 Hannah, 2 Mustapha, 3 Mess.
- **Facing.** ROM sprite art faces left, and a non-zero facing byte `+0x24` mirrors it (V06).
- **Record numbers.** Animation data stores record numbers ×4. Search for `rec*4`, not for the record number (V14).
- **World axes.** X grows to the right and height grows upward. Depth grows away from the viewer, which is higher on
  screen. Screen feet: `feetX = X − camX` and `feetY = camY − (depth + height) + 240` (V05).
- **Timing** (harness frame numbering). RAM at frame f−1 builds the OBJ list dumped at f, which appears in screenshot
  f+1 (H04, V05).

## 1. ROM tables

**V01. ROM header (verified, with correction).** The frame-record and layout tables are reached only through the
header at 0xFFFF0:

| Address | Value | Meaning |
|---|---|---|
| 0xFFFF0 | 0xFFDFFFF0 | not a table pointer |
| 0xFFFF4 | long `0x000D0CF4` | frame-record pointer table |
| 0xFFFF8 | word 0x0DB9 | 3513 records |
| 0xFFFFA | long `0x000D43D8` | layout table |
| 0xFFFFE | word 0x09D4 | 2516 layouts |

- The code loads the record table with `movea.l 0xFFFF4` at 0x141AE, 0x14244 and 0x14294.
- It loads the layout table with `movea.l 0xFFFFA` at 0x142D8, 0x143D0, 0x144AE and 0x14674.
- No code refers to 0xD0CF4 or 0xD43D8 directly, and nothing reads the counts.

Correction: the original claim put the pointer at 0xFFFF0. Evidence: static `ev_74507530`, `ev_bbccda8b`; static
verifier `c01` `ev_b050cb5d`, `ev_2bd68f11`; live verifier `vl10`, plus read taps in `vl-draw-*/hdr-readers.json`.

## 2. Sprite pipeline

**V02. Sprite-list builder at 0x13FA6 and the OBJ double buffer (verified).**
- The builder writes OBJ RAM at 0x900000 when the word at 0xFFE9B4 is non-zero, and at 0x904000 otherwise (0x13FB4).
  It then flips 0xFFE9B4 (`not.w` at 0x14098).
- It keeps camera copies for the draw code:
  - 0xFFE9B6 = camX (0xFF8744) − 0x40.
  - 0xFFE9B8 = camY (0xFF8748). This is forced to 0 while the byte at 0xFF84DC is non-zero.
- Every list ends with the words (0, 0x100, 0, 0xFF00), written at 0x14076/0x1407C.
- Shadow sprites from 0x14EC0 are written between the object entries and that end marker.
- The IRQ2 vblank handler (0x542; the test is at 0x554–0x564) then selects 0x9000 if 0xFFE9B4 == 0 and 0x9040
  otherwise, so it shows the buffer that was just built.

Live check (`vl-draw-*` debugger breakpoints): the buffer toggled in 1,790 of 1,790 frames, and the camera copies were
right in 1,798 of 1,798. Evidence: `ev_cc2316d5`, `c02 ev_2502f73e`, harness `ev_62e71365`.

**V03. Draw registration and depth sort (verified).**
- 0x49C0 registers an object when `obj+0x01 != 0`. 0x49CA first runs the on-screen test 0x16FA, which sets or clears
  `obj+0x01`.
- Each registration pushes the object's address (low word), then its depth `obj+0x10`. The list grows downward from
  0xFFE9B0. The write pointer is at 0xFFE7C2 and the count at 0xFFE7C0.
- A bubble sort at 0x14002 (unsigned long compare) is followed by the draw loop at 0x1404A. Objects are drawn in
  ascending `(depth<<16 | addr)` order, so the **smallest depth (nearest the viewer) is drawn first**.
- The CPS-1 gives priority to earlier OBJ entries, so nearer objects end up on top. When two depths are equal, the
  lower RAM address is on top.

Live check (`vl-draw-wade`): the push count equalled 0xFFE7C0 in 151 of 151 frames, and the order matched in 1,798 of
1,798 frames. Evidence: `ev_929d18a4`, `ev_6e3e659a`, `ev_949e431a`.

**V04. Per-object draw at 0x141F8 (verified, with corrections).** The draw starts from the frame pointer: `A3 = obj+0x28`.

Which records a frame draws:
- If `w0 ≥ 0`, it draws record `w0/4` through `[0xFFFF4]`.
- If `w1 ≥ 0`, it also draws a second record at the same origin (0x14294).
- If `w0 < 0` (bit 15 set), the frame is a **composite**. The part list sits at `fp + 2 + w1`: first count−1, then for
  each part dx (negated when mirrored), dy, `rec*4` and a flag word.

Where the blocks go:
- The origin is `D4 = x − (camX−0x40)` and `D5 = height + depth − camY`. When `obj+0x25` bit 7 is set (screen space),
  the camera is not applied.
- `OBJ X = D4 + layout.x`. When `obj+0x24 ≠ 0` (mirrored), `OBJ X = D4 − layout.x − 16·w` instead and flipX is toggled.
- `OBJ Y = (0x100 − D5) mod 0x200 + layout.y`.
- A block is drawn when `X ≤ 0x1C0` and `X + 16·w ≥ 0x40`.
- Entries are written with `movem.w D0-D3,(A4)`.

Object flags:
- `obj+0x23` bit 7: the low 5 bits replace every block's palette.
- `obj+0x25` bit 0: split body (0x14136). The legs record comes from `+0x30` at the feet, and the torso from `+0x28`
  offset by `+0x3C/+0x3E`.

Corrections:
- **Composite offset.** The part-list offset is frame word 1 (`vl07 ev_8637ad52`). With bit 15 set, `w0 = 0x8000|rec*4`
  only feeds the wading-clip bytes.
- **Two paths the claim leaves out.** Both are listed under U01:
  - `obj+0x25` bit 6 sends the draw to 0x147FE.
  - The pair path at 0x14114 is used for grabs.
- **Fixed −16 mirror.** The uniform-attribute mirror path uses a fixed −16. That is equivalent, because all 261 such
  records are one block wide.

Live check: `tools/re/verify-live/drawmodel.cjs` rebuilt every OBJ entry exactly in these runs:

| Run | Frames exact |
|---|---|
| `vl-draw-jack` | 340 / 340 |
| `vl-draw-mus-uzi` | 200 / 200 |
| `vl-draw-s5` | 300 / 300 |
| `vl-draw-screen` | 50 / 50 |
| `vl-draw-s3` | 283 / 300 |
| `vl-draw-s8` | 279 / 300 |

Every miss in s3 and s8 involves one of the two paths left out. Evidence: `ev_99e9ab82`, `ev_64ac156a`, `ev_46e7b40a`,
`ev_25dcf8e8`, `c04 ev_cbcd7917`.

**V05. Screen transform from RAM (verified).** Read the RAM one frame before the OBJ dump:
- `feetX = X − camX`, `feetY = camY − (depth + height) + 240`.
- Block top-left as stored: `sx = feetX + layout.x`.
- Block top-left mirrored: `sx = feetX − layout.x − 16·w`, with flipX toggled.
- In both cases `sy = feetY + layout.y`.

Run `work/re/runtime/validation.json` reproduced these frames exactly:

| Actors | Frames exact | Misses |
|---|---|---|
| P1 | 7,242 / 7,242 | none |
| Enemies | 18,100 / 18,490 | 390 whole-object blink frames, none partial |
| Items | 4,817 / 4,818 | 1 |

Evidence: `rt17 ev_51e0be35`, `c04`.

**V06. Facing (verified).** `+0x24 = 0` draws the art as stored, facing left. Any non-zero value (the game writes 1)
mirrors it to face right. The tests are at 0x142FA/0x144BE. In `rt-p1-pokes` and `vl-p1-pokes`, each poke took effect
on the next frame.

**V07. A held weapon is drawn in front of its holder (verified).**
- 0x24AC0 copies the holder's depth to the weapon every frame, and nothing else writes the weapon's depth.
- On the tie, pool A (0xFF88xx) sorts before the player slots (0xFFB274 and up), so the weapon is drawn first and
  appears on top.
- In `vl-draw-mus-uzi` this held in 201 of 201 frames.

## 3. Object pools and the common object struct

**V08. Pools (verified).** Every pool's run loop jumps through its dispatch table indexed by `obj+0x20`.

| Pool | Base | Slots × stride | Init | Alloc / free | Free count / pointer | Dispatch |
|---|---|---|---|---|---|---|
| players | 0xFFB274 (P2 0xFFB3F4, P3 0xFFB574) | 3 × 0x180 | 0x6714 loop | – | – | (player handler 0x18A32) |
| A items, weapons | 0xFF8874 | 24 × 0xC0 | 0x4C1A | 0x4818 / 0x48D4 | 0xFFE5F4 / 0xFFE5FE | 0x233F0 |
| B enemies | 0xFFC8F4 | 24 × 0xE0 | 0x4C48 | 0x483C / 0x48FC | 0xFFE5F8 / 0xFFE602 | 0x2346C |
| C special (spawn-list class 1: FESS MESS, demo and ending objects) | 0xFFB6F4 | 24 × 0xC0 | 0x4C76 | 0x4860 / 0x4938 | 0xFFE5F6 / 0xFFE600 | 0x2362E |
| D effects | 0xFF9A74 | 48 × 0x80 | 0x4CA4 | 0x4884 / 0x4964 | 0xFFE5FA / 0xFFE604 | 0x237E6 |
| E (use unknown) | 0xFFDDF4 | 16 × 0x80 | 0x4CCC | 0x48A8 / – | 0xFFE5FC / 0xFFE606 | – |

Live check (`vl-pools-s1/s5/s8`): 13 allocations and 21 frees, plus 22,630 dispatches, were all consistent
(`work/re/verify-live/poolcheck.json`). Pool E's allocator never ran live. A freed slot is pushed back and its first
0x28 bytes are cleared (V11). Evidence: `ev_00349197`, `ev_7603a534`, `ev_ddbb7f8d`, `ev_561cc3fd`, `c05 ev_8b5223b6`.

**V09. Common object fields (verified).** Every pool uses this header. Positions are 16.16 longs, and the draw code
reads the integer word at the same offset.

| Offset | Meaning | Status |
|---|---|---|
| +0x00 | 0 free, 1 active and hittable, 2 active but not hittable | V12, V31 |
| +0x01 | drawn; set or cleared by the on-screen test 0x16FA | V03 |
| +0x03 | heroes: character id; enemies: variant, which is also the HUD name index | V27 / R9 |
| +0x04 | state (routine index) | V12, R6 |
| +0x05 | sub-state; weapons: 8 = held (0 on the ground, 4 being picked up) | V24 (8 = held); rest unverified |
| +0x08 / +0x0C / +0x10 | X / height / depth (16.16); depth is the draw sort key | V26, V03 |
| +0x14 / +0x16 / +0x18 | velocities (8.8) | V26 |
| +0x1A / +0x1C / +0x1E | accelerations; +0x1C is gravity | V26 (+0x1A/+0x1E static only) |
| +0x20 | type ×4 = dispatch index (heroes: id×4) | V08 |
| +0x22 | weapons: current anim (written by 0x24A9A) | V23 |
| +0x23 | palette override (bit 7 + 5-bit palette) | V04 |
| +0x24 | facing | V06 |
| +0x25 | bit 0 split body, bit 7 screen space (bits 5/6: U01) | V04 |
| +0x26 | subtype word (weapons: weapon id; Chinpira reads the high byte 0/2/4) | V09, V17, V19 |
| +0x28 | animation frame pointer (ROM) | V13, V15 |
| +0x2C..+0x2E / +0x2F | frame bytes 4–6 / frames left on this frame | V15 |
| +0x30 / +0x34 | legs frame pointer / legs frame word 2 (low byte = bob index) | V04, V13 |
| +0x38 / +0x3C / +0x3E | bob table pointer / torso dx / torso dy | V13, V24 |
| +0x40 | animation set pointer | V13 |
| +0x44 | per-type constant (enemies 0x103000, weapons 0x100C00) | unverified, U10 |
| +0x48 | frame word 8 (meaning untraced) | storage verified, V13 |
| +0x4C..+0x4F, +0x53 | wading-clip bytes and wading flag | R5 correction |
| +0x58 | attack id (always even) | R4 correction |
| +0x60 | heroes: frame word 10; **high byte = weapon hold index** | V13, V23 |
| +0x6A / +0x6C | max HP / HP (weapons: +0x6C = ammo or uses) | V12, V20 |
| +0x6E | HP before the last hit | R7 correction |
| +0x70 | weapons: holder object | V20 |
| +0x78 | stun meter (damage byte 1 is subtracted) | R4 correction |
| +0x84 | enemies: reaction-set index ×4 | V17, V18 |
| +0xA0 / +0xA2 | weapons: class / pose slot ×4 | V20, V21 |

**V10. Debug spawn list at 0x88DDA (verified).**
- The list has 89 entries of 26 bytes each: a 16-character name, then the words `class`, `type` (→ +0x20), `subtype`
  (→ +0x26) and `→ +0x5C`, then a word whose low byte goes to +0x96.
- The spawner at 0x88D76 uses `class & 7` to index 0x88DB6 = [0x483C pool B, 0x4860 pool C, 0, 0x4818 pool A]. It
  copies X, height and depth from the object that spawns it.
- Handler = long at (the pool's dispatch table + type).
- The full decoded list is in `memory-map.json → tables.spawnList`. It matches the static decode on all 89 entries.

Examples:

| Name | Type | Handler | Notes |
|---|---|---|---|
| ENEMY CLEAR | 0x24 | 0x3B7D6 | |
| Chinpira_A/B/C | 0x08 | 0x3383A | subtypes 0/0x200/0x400 |
| Hutori_A | 0x28 | 0x3B828 | |
| Knife Man A | 0x38 | 0x4020E | |
| Pteranodon | 0x148 | 0x606D4 | |
| FESS MESS | 0xC8 | 0x844B4 | pool C; not spawned live |
| ITEM RIFLE.. | 0 | 0x24D44 | pool A |

Live check (`vl-spawn-enemies`): each handler ran, and the sprites appeared (`spawn-enemies.png`). Evidence:
`ev_2eafd4cf`, `c16 ev_82fdf06c`.

**V11. Pool A free list (verified).** The allocator pops a slot address word and decrements the count. Free pushes the
slot back, increments the count and clears 10 longs. In `vl-give1-bazooka`, slot 0x99B4 went back with the count
going from 23 to 24.

**V12. Enemy array, pool B (verified).**
- `+0x00`: 1 hittable, 2 not hittable (stunned, knocked down).
- `+0x04`: 0 init, 2 alive, 4 dying (blinks, then frees itself), 6 removed immediately.
- `+0x20` type, `+0x26` subtype, `+0x28` frame, `+0x6A/+0x6C` max HP / HP.

In `vl-enemy-hp1`, a Chinpira poked to HP 1 died to the first punch, then went to state 4 at f115, state 6 at f236,
and was freed at f237.

## 4. Player struct (P1 0xFFB274, P2 0xFFB3F4, P3 0xFFB574)

**V25 (verified).** The three slots are 0x180 apart, directly below pool C. P2 and P3 were also filled by live joins
in `vl-p2join` and `vl-p3-lives`.

| Offset | P1 address | Meaning | Status |
|---|---|---|---|
| +0x00 | 0xFFB274 | 0 empty, 1 playing and hittable, 2 playing but not hittable | V31 |
| +0x02 | | player number 0/1/2 | V30 |
| +0x03 | 0xFFB277 | character id: 0 Jack, 1 Mustapha, 2 Hannah, 3 Mess | V27 |
| +0x04 | | 0 init/respawn, 2 alive, 4 dead (dispatch 0x18A72; a state 6 handler at 0x18EB0 exists) | R6 correction |
| +0x05 | | 0 normal, 2 hurt or knocked down, **4 holding a grabbed enemy** | R6 correction |
| +0x06 | | 0 on the ground, **2 running/dash**, 4 jump; while +0x05 = 2: 0x20 fall, 0x1E get up | R6 correction |
| +0x07 | | **2 walk**; 4, 6, 8, 0xA, 0xC punch combo; 0x0E intro pose; 0x14 pick up; 0x16 fire rifle/revolver/shotgun; 0x1C fire Uzi/M16; 0x22 fire bazooka | R6 correction |
| +0x08 | 0xFFB27C (integer word) | X, 16.16 | V26 |
| +0x0C | 0xFFB280 | height, 16.16 | V26 |
| +0x10 | 0xFFB284 | depth / lane, 16.16 (296 at the stage-1 start; the game clamps it, e.g. to 335) | V26 |
| +0x14 / +0x16 / +0x18 | 0xFFB288.. | X / height / depth velocity (8.8). Walk +0x14: Jack 414, Mustapha 435, Hannah 422, Mess 409 (table 0x50E4) | V26, V28 |
| +0x1A / +0x1C / +0x1E | | accelerations; +0x1C is gravity | V26 |
| +0x20 | | id ×4 | V27 |
| +0x23 / +0x24 / +0x25 | | palette override / facing / draw flags (bit 0 set while walking with a gun) | V04, V06, V24 |
| +0x28 / +0x2F | | frame pointer / frames left | V15 |
| +0x30, +0x34, +0x38, +0x3C/+0x3E | | legs frame, legs word, bob table, torso offset | V13 |
| +0x48 | | frame word 8 | V13 |
| +0x58 | | attack id (even) | R4 correction |
| +0x60 | | frame word 10, high byte = hold index | V23 |
| +0x6A / +0x6C | | max HP / HP (100 / 100 at the start) | V09 |
| +0x6E | | HP before the last hit. The bar shows +0x6C and is redrawn only on a hit | R7 correction |
| +0x78 | | stun meter | R4 correction |
| +0xA3 | 0xFFB317 | lives (HUD "=N"). Start = byte 0xFFF77C & 3 (0x4DD6); decremented at 0x1BFD6 | V29 |
| +0xB4 / +0xB6 | 0xFFB328 / 0xFFB32A | held weapon (pool-A low word, 0 = empty hands) / its class | V20 |
| +0xEC | | invulnerability timer, word (0x168 after a respawn, 0xB4 elsewhere) | V31 |
| +0xF9 | | second invulnerability timer, byte (0x3C after the stage intro) | V31 |
| +0x100 | 0xFFB374 | score, BCD long (added at 0xFFAC/0x10008) | V30 |

**V31. Invincibility rule (verified).** Only objects with `+0x00 == 1` enter the hit list (0x4AC2). While either timer
runs, `+0x00` stays at 2, and when a timer reaches 0 with the other also at 0, it goes back to 1 (0x18CD4–0x18D1E).
A poke of `+0x00 = 2` with both timers at 0 stays at 2.

**V30. Score redraw (verified).** The HUD score is redrawn when the flag 0xFF0ECC and the per-player flag
`0xFF0ECD + player` are set.

Unverified player fields:
- **U04:** `+0x22` stick direction, `+0xA0/+0xA1` input this/last frame.
- **U06:** `+0x5E` attack counter, `+0x70` partner, `+0xC4` fire request, `+0x110` score copy.
- **U05:** jump velocity and gravity per hero.

## 5. Animation

**V13. Frame format and drivers (verified, with correction).**
- An animation set (`obj+0x40`) is a table of signed, self-relative word offsets, one per animation.
- **10-byte frames:** `w0` = rec×4 (bit 15 = composite), `w1` = second rec×4 or the composite offset, bytes 4–6 go to
  `+0x2C..+0x2E`, byte 7 is the duration, and `w8` goes to `+0x48`.
  - Bit 7 of byte 7 marks the last frame; the word after it is the loop offset.
  - Driver: start at 0x120E, tick at 0x121E (`subq +0x2F`, advance at 0), store at 0x1236.
- **12-byte hero frames** add `w10 → +0x60` (stored at 0x144C).
  - Start at 0x13A0..0x13CC, which picks the list by `obj+0x03`; tick at 0x1426; store at 0x143E.
- **Legs.** The word at frame+4 goes to `+0x34`. Its sign-extended low byte indexes the `+0x38` bob table (4 bytes per
  entry), which gives `+0x3C/+0x3E`.

Correction: hero legs (12-byte frames) are started by 0x1506 (called from 0x5CA6) and advanced by 0x1542. 0x12DE (the
10-byte legs driver) and 0x14C2 never ran for a hero (`vl06 ev_53cd829f`).

Live check (`animcheck.json`, 60 armed runs):

| Field | Result |
|---|---|
| hero `+0x48` / `+0x60` | 7,800 / 7,800 each |
| `+0x2F` reset on advance | 817 / 817 |
| bytes 4–6 | 7,598 / 7,800 (the game clears +0x2C in melee step 0x20) |
| weapon frames | 6,780, all exact |
| enemy frames | 27,225, all exact |

Evidence: `ev_e4fc41df`, `ev_9a5e9371`, `ev_2aa5256b`, `ev_c84169a5`, `c06 ev_2c9c2dd4`, `rt18 ev_4e62b8c5`.

**V14. Records are stored ×4 (verified).** The pointer table is indexed with the frame word unscaled. For example,
0x9F4C4 = 0x02C0 (record 176), 0x9FEEC = 0x0390 (228) and 0x9FBE2 = 0x040C (259).

**V15. Current record and timer (verified).**
- The current record is the ROM word at `[+0x28]` divided by 4, plus the word at `+2` divided by 4 when it is ≥ 0.
- `+0x2F` resets to byte 7 & 0x7F on each advance, drops by 1 per frame, and freezes during hit-stop.
- Resets on advance matched for heroes 817/817, weapons 89/89 and enemies 525/525.

**V16. Hero animation lists (verified).** There are six lists, each holding 4 longs in character-id order.

| List | Contents | Jack | Mustapha | Hannah | Mess |
|---|---|---|---|---|---|
| 0x163E | main set | 0x9E41C | 0x9F414 | 0xA06AC | 0xA16F0 |
| 0x164E | punch set | 0x9EDFE | 0x9FECA | 0xA115A | 0xA1FFC |
| 0x165E | set 3 | 0x9F094 | 0xA0328 | 0xA13D8 | 0xA232E |
| 0x166E | set 4 | 0x9F252 | 0xA04FE | 0xA1596 | 0xA24E0 |
| 0x167E | set 5 | 0x9F30E | 0xA0596 | 0xA1622 | 0xA25DA |
| 0x168E | weapon set | 0x9EACC | 0x9FB94 | 0xA0E8C | 0xA1D32 |

Mustapha's sets:
- **Main, 0x9F414.**
  - Anim 0: idle 171 (hold 0x40).
  - Anim 1: walk 176–187 (holds 0x4E, then 0x01–0x0B).
  - Anim 2: run 200–208.
  - Anims 3–5: jump 218–224.
  - Anim 16: legs walk 188–199.
- **Punches, 0x9FECA:** 228/229, 230–233 and 234–238.
- **Weapon set, 0x9FB94:**

| Anim | Records | Hold | Used for |
|---|---|---|---|
| a0 | 256 | 0x31 | pistol |
| a1 | 259 | 0x34 | rifle |
| a2 | 261 | 0x3A | shotgun, bazooka |
| a3 | 265 | 0x36 | M16 |
| a4 | 270+269 | 0x38 | Uzi |
| a11 | 262–264 | | bazooka fire |
| a14 | 259 → 260 | | rifle fire |
| a15 | 267 → 271+269 | 0x3E → 0x3F | shotgun fire |

Records 233/234 and the standing jump 218–224 were not seen live; a running jump used 225–227. Evidence: `ev_ea87f466`,
`ev_f214435c`, `ev_a47ff8ab`, `ev_59c6d79e`.

**V17. Chinpira, type 0x08 (verified).** The init at 0x3386C uses the subtype's high byte (0/2/4) to pick variant
A, B or C:

| Variant | +0x03 | +0x84 | Set (+0x40) |
|---|---|---|---|
| A | 0 | 0 | 0x34892 |
| B | 1 | 4 | 0x34B90 |
| C | 0x1A | 0x68 | 0x34E7C |

Animations in set 0x34892:

| Anims | Records |
|---|---|
| a0 idle | 2422 |
| a1 walk | 2422, 2426–2430 |
| a2 taunt | 2423–2425 |
| a6 composite punches | parts 2431–2436 + 2473 |
| a3–a5 | 2462–2468 |
| a8 | 2461, 2441, 2472 |

**V18. Reaction tables (verified).** There are two tables of 38 longs, indexed by enemy `+0x84`. The chosen animation
is started through 0x1236 directly and never stored in `+0x40`.
- **0x2E724**, read at 0x2B41A/0x326D6/0x4A6BE. While a hero holds the enemy (hero `+0x05 = 4`), it plays anim 0 held,
  1 kneed and 2–3 thrown.
- **0x2E68C**, read at 0x2B4A2/0x4A746. After the throw it plays anim 8 landing, 4 down and 2 get up.

Seen live in `vl-grab-*` (`grab-jack.png`).

## 6. Weapons

**V19, V20, V21. Weapon ids, classes, ammo and pose slots (verified).**
- The weapon id is the item subtype at `+0x26`.
- The HUD name comes from 0x23CBE, which takes `+0x26 & 0xFFFE` into the PC-relative word table 0x23CDE. Each string is
  a colour byte, the text and an "@".
- The pose is `+0xA2/4`.
- Each shot does `subq #1,+0x6C` (0x25212 / 0x256D0).
- The holder has `+0xB4` = the weapon and `+0xB6` = its class. The weapon has `+0x70` = its holder.

| Id | HUD name | Class | Default ammo/uses | Pose | When used up (R2 correction) |
|---|---|---|---|---|---|
| 0x00 | RIFLE | 0x205 | 6 | 1 | becomes class 0x203, pose 2 (club) |
| 0x02 | GUN (revolver) | 0x204 | 6 | 0 | class 0x201, thrown away |
| 0x04 | KNIFE | 0x202 | 6 | 3 | |
| 0x06 | UZI | 0x206 | 48 | 4 | class 0x201, thrown away |
| 0x08 | M-16A1 | 0x207 | 48 | 5 | class 0x203, pose 6 (club) |
| 0x0A | SHOT GUN | 0x208 | 6 | 7 | class 0x201, thrown away |
| 0x0C | BAZOOKA | 0x209 | 4 | 8 | stays 0x209, discarded and its slot freed |
| 0x0E | ROD (lumber) | 0x203 | 10 | 9 | breaks into a STICK (subtype 0x10, class 0x202, pose 10) |
| 0x10 | STICK | 0x202 | 6 | 10 | |
| 0x12 | B. KNIFE | 0x203 | 6 | 11 | |
| 0x14 | CLUB | 0x203 | 10 | 12 | |
| 0x16 | TORCH | 0x203 | 10 | 12 | |
| 0x18 | DYNAMITE | 0x201 | 10 | 13 | |
| 0x1A | GRENADE | 0x201 | 10 | 14 | |
| 0x1C | STONE | 0x201 | 10 | 14 | |

Classes: 0x201 throwable, 0x202 blade, 0x203 blunt, 0x204 pistol, 0x205 rifle, 0x206 SMG, 0x207 M16, 0x208 shotgun,
0x209 bazooka, 0x20A carried container (pose 15).

Live check: the HUD showed each name in 15 armed states, and `vl-give-rifle30` showed "29 RIFLE" and then
"28 RIFLE". Evidence: `rt15`, `rt16`, `rt16b`, `c37 ev_fd4e6410`, `c12 ev_69221442`.

**V22. Weapon animation sets (verified).**
- Anims 0–15 spin, starting at rotation k.
- A held weapon shows frame 0 of the anim its pose table chooses, which is one of 16 rotations.
- Anim 16 is a fast spin on a separate rotation run.
- Anim 17 is the weapon lying on the ground.

| Weapon | Set (+0x40) | Rotations | Held records seen live | Ground |
|---|---|---|---|---|
| rifle | 0x265F4 | 1822–1829 / 3160–3167 | 1888–1895 (aimed anims 19–26; anims 18–28 = 1887–1896, then 2324) | 1840 |
| revolver | 0x268BC | 1633–1640 / 2992–2999 | 1634–1637 | 1843 |
| knife | 0x26A3C | 1681–1688 / 3040–3047 | 1683–1687 | 1853 |
| Uzi | 0x26BBC | 1649–1656 / 3008–3015 | 1649 | 1849 |
| M16 | 0x26D3C | 1768–1775 / 3128–3135 | 1768 | 1842 |
| shotgun | 0x26F7E | 1665–1672 / 3024–3031 | 1665 | 1851 |
| bazooka | 0x270FE | 1752–1759 / 3112–3119 | 1752 | 1850 |

**V23. Held-weapon placement at 0x24A9A (verified).** The held handler at 0x25178 calls it (at 0x251B0) every frame
after checking that `holder+0xB4 == self`. Step by step:

```
hold   = holder.b[0x60]                                ; < 0 -> hidden
(dx,dy)= s16 pair at  [0x122230 + holder.0x20] + hold*4
w.x    = holder.x + (holder.0x24 ? -dx : dx)           ; + holder.0x3C (signed by facing) if holder.0x25 bit0
w.h    = holder.h + dy                                 ; + holder.0x3E if split body
w.depth= holder.depth   (0x24AC0)    w.facing = holder.facing (0x24AFA)
row    = long at ([0x120A20 + holder.0x20] + w.0xA2)
anim   = s8 at row + hold  -> w.0x22                   ; < 0 -> hidden; then jsr 0x120E (frame 0)
```

Per-character tables (checked against the ROM by the build):

| Character | Hold offsets | Pose rows |
|---|---|---|
| Jack | 0x122240 | 0x120A30 |
| Mustapha | 0x1223A8 | 0x121070 |
| Hannah | 0x1224E8 | 0x1215B0 |
| Mess | 0x12263C | 0x121BF0 |

- Live check: x, h, depth, facing, the anim byte and the frame matched the formula in 60 of 60 armed states
  (`work/re/verify-live/armed-check.json`), and the routine ran on 121 of 121 frames.
- All hold indices are decoded statically in `work/re/static/weapon-holds.json`.
- The pixel positions measured live for Mustapha are under R1, because that claim was rejected for its comparison with
  `game.js`, not for the positions.

Evidence: `ev_4c7700f3`, `ev_915caaf6`, `ev_83c27a95`, `c10 ev_ec1d7b4c`.

**V24. Stance and walk torso by weapon class (verified).** Selection runs through 0x5BDC/0x5C1C:
- `[0x5C36 + id*4]` points to 12 words, indexed by the low byte of the class.
- 0x8000 means the plain idle (0x163E anim 0). Any other value plays that anim of the 0x168E weapon set.
- The weapon's `+0x05` must be 8 (held).
- Walking with a weapon (0x5CA6) sets `+0x25 = 1` (split body) and `+0x38 = [0x5D1C + id*4]`. The torso anim comes from
  the 0x5D2C tables, and the legs are main anim 0x10 (driven through 0x1506).

| Character | Words | Anim by class 0x201..0x20A | Bob table |
|---|---|---|---|
| Jack | 0x5C46 | 24, 24, 4, 0, 1, 6, 2, 2, 3, 5 | 0x5D9C |
| Mustapha | 0x5C5E | idle, idle, 5, 0, 1, 4, 3, 2, 2, 6 (verified live for classes 1–9) | 0x5DCC |
| Hannah | 0x5C76 | 4, 4, 0, 0, 2, 3, 3, 3, 4, 1 | 0x5DFC |
| Mess | 0x5C8E | idle, 27, 27, 0, 1, 2, 3, 3, 4, 5 | 0x5E2C |

The table format is verified for all four heroes, but only Mustapha's values were checked live; the others are
static decodes of the same table. Class 10 (the carried container) was not reached live.

## 7. Game flow, stages and HUD

**V33. Frame counters and main state (verified, with correction).**
- 0xFF8000 (word, 0xA942) and 0xFF84DA (byte, 0xA946) count **main-loop passes, not video frames**. Both stay 0 for
  boot frames 0–389 and freeze from f561 to f639 (correction).
- 0xFF84D0 is the main state, dispatched ×4 through 0xA958: 0 title/attract, 4 select, 8 intermission/story plus the
  title card (0xD898), 0xC gameplay (0xAAF6, which calls the sprite builder and the timer), 0x1C ending and staff roll.
- In `vl-boot`, the state went 0 → 4 at f393 and 4 → 0xC at f640.

**V34. Stage (verified).** The byte at 0xFF84D9 holds 0–7 for EPISODE 1–8.
- The stage clear at 0xABE8 adds 1 and masks with 7, clears the area 0xFF8786 and 0xFF84D1/0xFF84D2, and sets main
  state 8.
- After stage 7 comes the ending.
- Title cards seen: EPISODE 2 THE SWAMP FOREST, 3 HELL ROAD, 4 JACK'S GARAGE, 5 VILLAGE OF FLAME, 6 JUNGLE AND MINE,
  8 THE UNDER WORLD.

**V35. Area and stage controller at 0xFF873C (verified).**

| Field | Address | Meaning |
|---|---|---|
| +0x05 | | state of the last triggered segment (its byte +0x0B) |
| +0x08 / +0x0C | 0xFF8744 / 0xFF8748 | camera X / Y |
| +0x4A | 0xFF8786 | area |
| +0x56 | 0xFF8792 | next segment pointer |
| +0x6C | 0xFF87A8 | next segment index |
| +0x6D | 0xFF87A9 | exit reached |

- The script table at 0x21B2A holds a word offset per stage, then 16-byte segments: `+0` camera-X trigger (0 = area
  start, no trigger), `+0x0A` area, `+0x0B` state.
- The area byte is written by the instructions at 0x20C8E and 0x20D56. The runtime write tap reported the next PCs,
  0x20C94/0x20D5C.
- In `vl-bot-s1`, the triggers 1032/1120/1232/1408/432/544/160/464 fired as the camera passed them.

**V32. Select-screen stats (verified).** The table at 0xB444 uses select order, as POWER/SPEED/SKILL out of 5: Jack
4/3/3, Hannah 2/4/5, Mustapha 3/5/3, Mess 5/2/4. The game reads it only on the select screen, never during play.

**V28. Walk speed (verified).** The table at 0x50E4 has 0x20 bytes per character: 8 directions of (vx, vy).

HUD enemy names and the stage timer are rejected claims; the corrected facts are under R9 and R8.

## 8. Cheats and save states (verified)

The cheats are in `tools/re/runtime/cheats.cjs` and are used through `plan.cheats` in `tools/re/runtime/rt.cjs` plans.

- **V36 invuln.** Every frame it sets `+0x00 = 2` and `+0xF9 = 0x3C`. With it there were 0 hits in 1,500 frames;
  without it there were 7.
- **V37 give.** It spawns a pool-A item the way the spawner does, sets the ammo after the game's init, and holds attack
  for 3 frames. It works for all 15 weapons (`vl-give-rifle30` showed "29 RIFLE"). It needs empty hands.
- **V38 warp, warpLive and warpArea.**
  - **warp:** sets the stage byte during select.
  - **warpLive:** makes the same writes as the stage clear.
  - **warpArea:** sets controller `+0x56/+0x6C/+0x6D` and state 1.2.
  - Results: EPISODE 3 (`warp3.png`), EPISODE 6 (`warplive6.png`), and 47TH STREET (`warparea2.png`).
- **V39 killAll and freeze.**
  - **killAll:** uses the game's own pool-B type 0x24 "ENEMY CLEAR" (0x3B7D6) and empties pool B in the same frame.
  - **freeze:** restores each slot from a snapshot every frame, in Lua.
- `infhp`, `lives` and `score` are plain pokes of fields that are verified (V29, V30). The cheats themselves were not
  re-run by a verifier.

**V40 save states** (`E:/tools/mame/states/dino/`). There are 80 stage states, and the live verifier reloaded all of
them. Each showed the expected stage byte, main state 0xC, character id, held subtype or area, and the hero moved with
Right.

| States | Count |
|---|---|
| `stage1-<hero>-armed-<rifle,gun,knife,uzi,m16,shotgun,bazooka,rod,stick,bknife,club,torch,dynamite,grenade,stone>` | 60 |
| `stage2`…`stage8` for `-jack` and `-mustapha` | 14 |
| `stage1-jack-area1`, `stage1-jack-area2` | 2 |
| harness `stage1-jack`, `-hannah`, `-mustapha`, `-mess` | 4 |

There is also `stage1-mess-intro`. The lists are in `work/re/harness/states.json` and `work/re/runtime/states.json`.

## 9. Harness facts (self-validated; no verifier re-checked them)

| Id | Fact | How the harness checked it | Overlap with a verified fact |
|---|---|---|---|
| H01 | Sprite screen position `sx = (x & 0x1FF) − 64`, `sy = (y & 0x1FF) − 16` (384×224) | origin scan, 9/9 frames | V05 uses the same origin |
| H02 | An OBJ code indexes the 4 MB graphics directly (bytes at code×128); highest code in stage 1 is 0x57A1, none ≥ 0x8000 | MAME `:gfx` region byte-identical to `rom.cjs` | – |
| H03 | Decode precision 99.80 %, recall 100 %; the 124 misses are under the scroll1 text layer | `validate-obj.cjs` with `--nosprites` | – |
| H04 | OBJ list dumped at f is shown in screenshot f+1; scroll registers dumped at f are used for f | lag scan, poke-timing2, scroll-lag | V05 (X poke one frame early) |
| H05 | IRQ2 at 0x542 (autovector 0x68) writes 0x9000/0x9040 to 0x800100 and the scroll bases from 0xFF802A/2C/2E | REA `ev_62e71365`, `ev_d87d740a` | V02 |
| H06 | OBJ palettes 0–31 = ROM palette set 0 at 0xB7A52 at brightness F; MAME colour `n*0x11*(0x0F+2B)/0x2D` | word compare of palettes 0, 1, 2, 3, 6, 7 | – |
| H07 | Mustapha idle is record 171 (mirrored, feet at (159,200)); Jack records 0, 5, 6, 9, 15, 35, 66 matched | record matcher | V16 |
| H08 | Boot recipe: coin 330–335, start 370–375, Right ×0–3 at 430/445/460, Button 1 at 480–483; control at 1304/1307/1320/1315 | held-vs-idle divergence | V33 (state timings) |
| H09 | Stage-1 states saved at 1302/1305/1318/1313 (plus mess-intro at 1200) | verify runs | V40 |
| H10 | 0xFFB27C is P1's world X | `make-states` | V26 (integer word of +0x08) |
| H11 | 0xFF8744 is camera X; 0xFFE9B6 = camX − 64 | camera-probe | V02, V05 |
| H12 | 0xFF8748 is camera Y | camera-probe | V05 fixes the sign: `camY − (depth + height) + 240` |
| H13 | MAME's `-state` option stops the autoboot Lua; load states from Lua instead | probe | – |
| H14 | CPS-A registers read as 0 from the bus; read the `:cps_a_regs` / `:cps_b_regs` shares instead | probe | – |
| H15 | A short run takes 2–5 s (6–9× real time) | `summary.json` | – |

## 10. Unverified (single source or inferred)

- **U01.** Extra draw paths, seen by the live verifier and in static notes:
  - `obj+0x25` bit 6 → 0x147FE (the frame pointer points to a record).
  - The pair path 0x14114, used for grabs: `+0x05 == 4`, `+0x2E == 0x0C`, holder `+0x2E == 0x0E`, with the draw order
    picked by holder+0x62.
  - 0x14BC6, the wading splash; `obj+0x25` bit 5 skips it.
  - 0x14EC0 appends shadow sprites after all the objects.
- **U02.** There is an 8-byte animation driver at 0x16AE/0x16C6.
- **U03.** Knife Man A (type 0x38) moves itself to another slot on its first call and becomes type 0xF0.
- **U04.** 0xFF801B holds P1's input bits (R 1, L 2, D 4, U 8, attack 0x10, jump 0x20). Hero `+0xA0/+0xA1` hold the
  input this frame and last frame, and `+0x22` is the stick direction in 32nds.
- **U05.** Jump speed and gravity differ per character. `rt-p1-moves` saw `+0x16 = 0x055B` and `+0x1C = −0x4A`, while
  `vl-p1-pokes` saw 1216 and −64; which hero each run used was not recorded.
- **U06.** Hero fields: `+0x5E` counts attack presses, `+0x70` is a partner (grab or last hit), `+0xC4` is a fire
  request (0x251F4), and `+0x110` is a copy of the score.
- **U07.** 0xFF844A is a fade counter, 0xFF84E6 a copy of the starting lives, and 0x1033E holds the stage-timer start
  values.
- **U08.** Hero start table at 0x4E56: a word offset per stage, then 3 players × (X, height, depth) per area. Stage 1,
  area 0, P1 = (1056, 0, 296).
- **U09.** Areas per stage are 3, 3, 1, 3, 2, 3, 4, 4.
  - warpArea cannot reach E2 a1, E5 a1, E6 a2 or E8 a3, which start by scrolling.
  - Segment words +2..+8 and controller `+0x06` (its sub-states) are not traced.
- **U10.** The meanings of frame bytes 4/5, word 8, the low byte of word 10, and `+0x44` are unknown; they may be hit
  boxes.
- **U11.** Enemy HP and speed are set inside each handler (for example 0x31424 and 0x35812 for the Chinpira). The
  census saw max HP of 44/52 (Chinpira), 76 (Knife Man), 44 (Subayai Zako) and 100 (Torikeratopss).
- **U12.** The torch also spawns a pool-A object of type 0x18 (0x24F6E).
- **U13.** Weapon anims above 17 are only partly decoded: rifle 29–44, M16 18–33, the dynamite fuse, and the container
  sets.
- **U14.** 0x122230 holds 4 pointers, then 0, then 0xFFF9002A, and Mess's hold-table size (96) is assumed.
  Mustapha's anim 27 (0x9FA6A) has no end flag.
- **U15.** The enemy census of the stage states is in `work/re/runtime/enemy-census.json`, including unnamed types
  0xDC, 0xC4, 0xD8, 0xC8, 0x3C, 0xF0 and 0xA4 in stage 1.
- **U16.** In this MAME setup 0xFFF77C = 0x41, so the game starts with 1 life.

## 11. Rejected claims and their corrections

**R1. "The ROM hold formula reproduces the measured arcade placements exactly."** The static verifier refuted this;
the live verifier confirmed only the ROM/MAME side.

Correction: the ROM formula (V23) and MAME agree exactly. These are tight weapon boxes relative to the feet, art in its
native left-facing orientation, measured live in `vl-native-mustapha-*`:

| Weapon | Hold | Record | Top-left | Size |
|---|---|---|---|---|
| rifle | 0x34 | 1892 | (−54, −68) | 74×14 |
| shotgun | 0x3A | 1665 | (−43, −65) | |
| Uzi (stance 270+269) | 0x38 | 1649 | (−43, −64) | |
| knife (idle) | 0x40 | 1685 | (−2, −77) | |

The repo's own measured values do not match, except the knife. They come from `game.js` HOLD/KNIFE_UP plus the grips in
`arcade-heroes.js`:
- **Rifle:** (−53, −68), off by 1 px.
- **Shotgun:** (−39, −63), off by 4/2 px. It was measured on a 49×16 sheet sprite rather than the 47×11 ROM record.
- **Uzi:** (−41, −63), off by 2/1 px. It was measured on **record 267, which is the shotgun-fire frame (hold 0x3E)**,
  not the Uzi stance.
- **Knife:** (−2, −77), exact.

Evidence: `c11 ev_7e83d00e`, `tools/re/vs-holds.cjs`.

**R2. "Every emptied gun becomes a class-0x203 club."** The live verifier refuted this.

Correction: the init values and the −1 per shot are right. When the last round is fired:
- **Rifle:** becomes class 0x203 with pose 2.
- **M16:** becomes 0x203 with pose 6.
- **Revolver, Uzi, shotgun:** become 0x201 and are thrown away.
- **Bazooka:** stays 0x209 and is discarded, and its slot is freed.

The writes are at 0x2521E/0x256DC (`#0x203`) and 0x2530A/0x25578/0x257EA (`#0x201`) (`vl08 ev_90ad1c00`).

**R3. "0xB7472 lists every animation set."** The live verifier refuted this.

Correction: the table exists in the claimed format: 187 entries of a long pointer, a word driver (0, 4 or 8 → 0xAB440
= [0x143E, 0x1236, 0x16C6]) and a word palette group. It is partial, though:
- 5 of the 37 sets seen live are missing: 0x34E7C (Chinpira C), 0x577D2, 0x57D84, 0x96884 and 0x96D06.
- The reaction sets never pass through `+0x40` at all.

To find sets, use `move.l #set,0x40(A6)` cross-references and live `+0x40` values. The owner listed for each set in
`anim-sets.json` is a guess.

**R4. "Melee damage is 120 four-byte entries per hero."** The static verifier refuted this; the live verifier
confirmed only the formula.

Correction: the pointers are right (0xA26FC → Jack 0xA270C, Mustapha 0xA28EC, Hannah 0xA2ADC, Mess 0xA2CBC, each
0x1E0 apart). But `+0x58` is always even and 0x10A34 reads **8 bytes**, so there are **60 records of 8 bytes per
hero, at index `b[0x58]/2`**:

| Byte | Use |
|---|---|
| 0 | damage, through the modifier 0x2B904, then subtracted from victim `+0x6C` |
| 1 | subtracted from victim `+0x78` |
| 2 | → victim `+0x7B` and `+0x06` |
| 3 | → `+0x59` of both |
| 4 | → `jsr 0x962A` |
| 5 | → `jsr 0xFFC8` |
| 6 | → D5 |
| 7 | → victim `+0x9A` |

- Live check (`vl-dmg-jack`): Jack's ids 0, 0, 2, 4 did 12, 11, 15 and 32 damage after the modifier.
- 0x12540 (grab attacks) is a second user of the table.
- Indices 0x78/0x7A, written at 0x4212/0x422C/0x444A, would run past the end; that is still open.
- In `work/re/static/hero-damage.json`, every odd attack id is really bytes 4–7 of the record before it.

Evidence: `c21 ev_a3d4ad8d`, `vl05 ev_62658378`.

**R5. "Wading clip bytes are chosen by height parity."** The live verifier refuted this.

Correction: `+0x4C = ROM[0x11D220 + rec*4]`, where rec = w1 if w1 ≥ 0, otherwise `w0 & 0x7FFF`. This held for every
hero, weapon and enemy frame checked.
- The number of blocks dropped is the byte at `+0x4C + (((max(h,0)+8)>>4) & 1)`: `+0x4C` when h < 8, `+0x4D` when
  8 ≤ h < 0x18, and nothing above that.
- It only applies while `+0x53` is set.
- 0x14BC6 adds the splash sprite.

Evidence: `vl09 ev_41fdf3ae`, `vl-draw-wade` 150/150.

**R6. "Player state bytes: +0x06 = 2 is walk, +0x05 = 4 is down."** The live verifier refuted this. The corrected
values are in the section 4 table: walk is `+0x07 = 2` and run is `+0x06 = 2`. Holding a grabbed enemy is
`+0x05 = 4`, and a knock-down is `+0x05 = 2` with `+0x06 = 0x20/0x1E`. Fire steps are 0x16, 0x1C and 0x22.

**R7. "+0x6E is the HP shown in the bar."** The live verifier refuted this.

Correction: `+0x6E` is the HP before the last hit, copied at 0x10A4E/0x116C2/0x12556 (`vl04 ev_4500dd3f`). The bar
shows `+0x6C` and is redrawn only when the player is hit.

**R8. "The stage timer ticks once per 50 frames; credits are at 0xFF847D."** Both verifiers refuted this.

Correction: 0xFF84E8 is BCD M:SS, and the tick at 0xFF84EA counts 0x32..0. The second is taken on the following
frame, so **one second = 51 frames** (0x1037E/0x103B2, called from 0xAB20). When the clock reaches 0:00, the player
dies one tick later. 0xFF847D counts **coin-slot-1** credits only (`vl01 ev_aa6a8b11`).

**R9. "The HUD enemy-name mapping is unknown."** The live verifier refuted this.

Correction (determined live):
- On a hit, 0x16B60 queues `{kind, enemy+0x03, +0x6A, +0x6E, +0x6C, obj}` into a queue of 16 entries × 16 bytes at
  0xFFEBDE (write index 0xFFEBD8).
- 0x16E46 copies the kind and the name index into the HUD slot 0xFFEB98 (`+4/+5`).
- 0x17D2E draws `0x17D78[+5]`, or the hero table 0x17D70 when `+4 == 2`.
- **The name index is the enemy's `+0x03`.**

The names below were re-read from the ROM by the build:

| Index | Name | Index | Name | Index | Name |
|---|---|---|---|---|---|
| 0x00 | FERRIS | 0x0C | VICE T. | 0x18 | SLISAUR |
| 0x01 | GNEISS | 0x0D | WALTHER | 0x19 | TYROG |
| 0x02 | POACHER J | 0x0E | LASH T. | 0x1A | DRIVER |
| 0x03 | HAMMER T. | 0x0F | BUTCHER | 0x1B | TYROG |
| 0x04 | R HOPPER | 0x10 | BLUDGE | 0x1C | BLADE |
| 0x05 | SLICE | 0x11 | MACK | 0x1D | PUNK |
| 0x06 | BLADE | 0x12 | SKINNER | 0x1E | HAMMER T. |
| 0x07 | SHIVAT | 0x13 | GUTTER | 0x1F | BLK ELMER |
| 0x08 | PUNK | 0x14 | RAZOR | 0x20 | WRENCH T. |
| 0x09 | THUG | 0x15 | MORGAN | 0x21 | ZEKE |
| 0x0A | BLK ELMER | 0x16 | MORGUE | 0x22 | FESSENDEN |
| 0x0B | WRENCH T. | 0x17 | KNIFE | 0x23 | TYROG 2 |

The hero table (0x17D70) is in id order: JACK.T, MUSTAPHA, HANNAH, MESS. Chinpira A, B and C (`+0x03` = 0, 1, 0x1A)
show as FERRIS, GNEISS and DRIVER. Evidence: `vl02 ev_91c46fca`, `vl03 ev_22af3f44`.

## 12. Data files that still contain rejected statements

These are left as they were written; trust this file and `work/re/memory-map.json` over them.

- **`work/re/runtime/memory-map.json`.** Superseded by `work/re/memory-map.json`. Wrong or outdated in it:
  - the timer runs at 50 frames per second (R8);
  - `+0x6E` is the HP shown in the bar (R7);
  - the meanings of state bytes `+0x05..+0x07` (R6);
  - the counter advances "every game frame" (V33);
  - P2/P3 are "not run-time tested" (V25 tested them);
  - the credits note lacks the coin-2 caveat (R8).
- **`work/re/static/hero-damage.json`.** The odd attack ids are wrong (R4).
- **`work/re/static/object-struct.json`.** The wading "height parity" (R5) and `+0x6E` "displayed HP" (R7) are wrong.
- **`work/re/static/anim-sets.json`.** It treats 0xB7472 as complete (R3).
- **`work/re/static/weapon-items.json`.** It says 0x203 is "also an emptied gun", which is true only for the rifle and
  M16 (R2).
- **`work/re/static/hold-validation.txt`.** It contains no measured comparison (R1).
- **The sequel's `game.js` HOLD/KNIFE_UP and `arcade-heroes.js` grips.** The rifle, Uzi and shotgun are 1–4 px off,
  and the Uzi value comes from the wrong record (R1).

## 13. Open questions for the extraction phase

**Weapon holds**
1. Only Mustapha's four holds were measured live. Generate every hold index × pose slot for all four heroes from
   0x122230/0x120A20 (V23). Then check a sample live in the 60 armed states:
   - both facings;
   - split-body walking (torso `+0x3C/+0x3E` plus bob tables 0x5D9C/0x5DCC/0x5DFC/0x5E2C).
2. Replace the repo's HOLD values, which were measured from video, with values derived from the ROM. The Uzi stance is
   records 270+269 with hold 0x38 (R1).
3. Open details:
   - the size of Mess's hold table (U14);
   - the class-10 container stance (pose 15), which was never reached live;
   - the firing animations: rifle aimed 18–28, M16 18–33, bazooka 262–264;
   - the shot/projectile object (static evidence `40-shot-object`, `ev_040244ed`), muzzle flash and recoil;
   - what happens to each weapon when it runs out (R2).

**Enemy animations**
1. Only the Chinpira is decoded. For each other type:
   - spawn it from a stage state using the verified debug-list format (V10);
   - read `+0x40`;
   - walk its sets with the verified frame format (V13).

   Do not rely on 0xB7472 (R3). The types are in `memory-map.json → tables.spawnList`, about 50 enemy, boss and cut-scene
   entries: Hutori 0x28, Knife Man 0x38/0xF0, Subayai Zako 0x50, Mituryou Sya 0x34, Kameleon Man 0x18, N.Richmond
   0x48, the dinosaurs 0x60/0x74/0x98/0x138/0x13C/0x140/0x148, the bosses 0x7C/0x80/0x120/0x150, FESS MESS 0xC8 in pool
   C, and others.
2. Enemy palettes 5/9/13/14/25/29: do they come from the record attributes or from the `+0x23` override (V04)?
3. Still unknown:
   - the blink flag for dying or stunned enemies;
   - the meaning of frame bytes 4/5, word 8 and `+0x44` (probably hit boxes);
   - the reaction sets for each type (V18);
   - damage record bytes 2–7, and indices 0x78/0x7A (R4).
4. Sprite codes of 0x8000 and above, and MAME's CD63B bank mapper. These never appear in stage 1; check stages 2–8
   using the `stage<N>-*` states.

**Stage backgrounds**
1. Nothing about the scroll layers is verified yet. Next steps:
   - decode the scroll1/2/3 tile formats, the tilemap layout and rowscroll from the harness dumps (`dump.scroll`,
     `dump.allPalettes`);
   - model the CPS-B layer priority.
2. Find where each stage and area tilemap lives in the ROM. Alternatively, capture it by scrolling through each area
   from the `stage<N>-*` and `stage1-jack-area*` states and stitching the dumps.
3. In the script segments at 0x21B2A, words +2..+8 (probably camera limits) and bytes +0x0C..+0x0F are not traced.
   Areas that start by scrolling need a scripted walk (U09).

**Story text**
1. The text format of the verified tables is a colour byte, ASCII, then an "@" terminator. Examples: 0x17D78, 0x17D70,
   0x23CDE and the select names at 0xB39E. `work/re/text-story.txt` is a raw ASCII dump made with `tools/re/text.cjs`
   and has not been sorted.
2. Trace the routines that produce the story text:
   - main state 8 (intermission/story plus title card, 0xD898);
   - the ending state 0x1C (0xAC48);
   - the in-stage caption triggers (stage-1 intro dialogue, "47TH STREET", "TOP OF THE BUILDING").

   That will give the story-text tables and their order per stage.
3. Name the cast by mapping each enemy type's `+0x03` to the HUD name table (R9). For example FESSENDEN is index 0x22,
   ZEKE 0x21 and TYROG 2 0x23.

## 14. Regenerate and re-check

| Command | What it does |
|---|---|
| `node tools/re/build-memory-map.cjs` | rebuilds `work/re/memory-map.json` (19 ROM self-checks) |
| `node tools/re/static-extract.cjs` | static JSON in `work/re/static/` |
| `node tools/re/runtime/validate-all.cjs` | P1/enemy/item prediction (needs `work/re/runs/` per-frame runs) |
| `tools/re/verify-live/*.cjs` | live re-checks: `drawcheck.cjs`, `armed.cjs`, `animcheck.cjs`, `poolcheck.cjs` and others |
| `tools/re/vs-*.cjs` | static re-checks |
| `tools/re/mame/README.md` | harness plan format, frame numbering and gotchas |
| `tools/re/runtime/README.md` | cheats and the runtime tools |
