# Assets and gameplay references

The supplied `dino` directory contains the CPS-1 ROM images of Capcom's *Cadillacs and Dinosaurs* (1993), not its source. This is a newly written browser game: it does not emulate the original at run time, and no ROM, emulator or ROM archive is part of the project. The ROMs were only ever read; their hashes are kept in `original-rom-hashes.json`.

Since the rebuild (steps G0–G8, `work/re/design/PLAN.md`), **every sprite and stage pixel the game draws is the arcade's own**, read from the ROM, re-rendered slot-indexed and recoloured at run time through the arcade's own palette rows. The sections below say which ROM tables each shipped file comes from and how that was checked.

## How the shipped art is made

`node tools/re/build-game-assets.cjs all` (Node 22, the ROM set in `DINO_ROMS`, default `E:/mostafa/dino`) builds every generated file from the ROM and the research extracts in `work/re/extract/` (not committed):

- the program ROMs `cde_23a.8f`, `cde_22a.7f`, `cde_21a.6f`, concatenated with every byte pair swapped (`work/re/dino-prg.bin`), and the graphics ROMs `cd-1m … cd-8m` interleaved into a 4 MB tile region (16 × 16 tiles, 128 bytes each: per 8-byte row the four bitplanes of pixels 0–7, then of pixels 8–15, MSB first; pen 15 is transparent);
- the decoders in `tools/re/` (`rom.cjs`, `stage-rom.cjs`, `cps-scroll.cjs`) and the exporters in `tools/re/export/` that wrote the research dumps;
- the build modules in `tools/re/build/` (deterministic PNG encoder, MaxRects atlas packer, 12-bit palette operations, stage composer and validator, stable JS writer).

Each run records the sha256 of every input and output, the Node and zlib versions and the ROM's sha1 (`f6f64930…`) in `tools/re/build/manifest.json`. `node tools/re/build-game-assets.cjs check` rebuilds everything into `work/re/build-check/` and compares **decoded pixels** and JSON with the shipped files, runs the stage gates (ARCHITECTURE §3.7) and the budgets, and refuses tracked files over 2 MB outside `assets/audio` and any `.bin` or `.zip`. `tests/assets.cjs` runs that check as the asset gate. Sprite sheets carry an FNV checksum of their indexed pixels; `sprites.js` verifies it when it decodes a sheet (`SPRITES.verified`).

## Shipped files and their ROM sources

| File | Content | ROM tables and sources |
|---|---|---|
| `sprite-data-heroes.js` (`ROM_HEROES`, `ARCADE_HEROES` view) | the four heroes' records, animations (frame tuples with duration, hold, event, action), weapon holds and muzzle points, weapon and effect timing, palette maps (home, mirror, freed, half, gel, flash) | frame records 0xD0CF4 (3,513 pointers) and layouts 0xD43D8 (2,516; each block's offset from the feet); hold tables from 0x122240; object palettes 0xB7A52 (32 rows of 16 RGB444 words per set; rows 0–3 Jack, Hannah, Mustapha, Mess); walk and depth speeds 0x50E4, run sets 0x5064, 0x53A2; stab boxes 0x62AE; torch flame chains 0x29CB6/0x29CF4 with offsets 0x29C26; jump tables from the live game; the driving pose (main 29) |
| `sprite-data-fx.js` (`ROM_FX`) | weapons (ground, rotations, fast spins, empty poses, fuses), muzzle flashes, rounds, casings, sparks, POW!/TA/KA, explosions, BOOM, debris, bubbles, food, score items and ammunition, containers, the Cadillac with its wheels and driver seat | the same record and palette tables; the chapter colours are the area palette pages of 0x8E8E (keys `S<episode>A<area>`); the B. KNIFE and YOROI colours pinned to rows 29 and 488 (KI7); item records chosen per ROM food/score subtype; the Cadillac by `tools/re/export/cadillac.cjs` (draw order 0x8BDDC, bump table, wheel steering) |
| `sprite-data-enemies.js` (`ROM_ENEMIES`) | 18 ROM types (the regular enemies with their variants, and the dinosaurs and birds) with animations, attack windows, the knife object and projectiles | records and animation sets per type; attack data 0xA2EA4 + id × 8 (damage, stun, reaction, hit-stop); rank rows 0x2C3AE; HP 0x31454; damage formula 0x6422; each variant's home palette rows plus its `+0x23` overrides (TYROG pinned to the S6A2 rows, KI13; LASH T.'s ball slot 23 to row 63, KI17); knife object 0xF0 / set 0x6FB6A; rounds and bombs 0x6FB1A, 0x5F0AC, 0x5F128; parasites 0x71408 |
| `sprite-data-bosses.js` (`ROM_BOSSES`) | Butcher, Mack, Shivat, Morgan, Slice, Vice T., Fessenden's six-part final form, the Crown Engine and the boss projectiles, in the sequel's boss palettes | the boss records and animations (`work/re/extract/bosses/`, logged live in MAME), the throne-room capsule cells of episode 8 area 3 baked into one sprite, palettes built from ROM rows (ENEMIES §6.1) |
| `sprite-data-ui.js` (`ROM_UI`) | the 8 × 8 and 8 × 16 fonts, the title logo, story portraits 0x00–0x0D, the chapter card frame and map, the HUD pieces | scroll1 font tiles (codes 0x0000–0x0FFF); portraits 0x8463E / 0x8461A; P1 face and names 0x16396 / 0x16426; foe faces 0x16E46, 0x179B6, 0x17A1E, 0x17A6E, 0x17A82, 0x17ABE and names 0x17D70 / 0x17D78; foe bar 0x174F2 / 0x17834 with its colour cycle 0x17892; weapon panel 0x23A24, icons 0x23AC6, ARM 0x23B52 and 0x23B62–0x23EB4; score digit tiles 0x124–0x12D; JOIN-IN tiles 0x620–0x639; the card and logo from the MAME screens `card3 f0300` and `boot f0330` |
| `stage-data.js`, `assets/stages/` | 140 stage pages (scroll2, scroll3, priority foreground, animated cells), 18 areas, bands, camera, locks, props, intermission pictures | scroll2/scroll3 block maps 0x21580 / 0x2311E rendered through `stage-rom.cjs`; camera segments 0x21B2A; terrain classes 0x1370C (walk band = class 0 base type inside the screen clamp, KI1); rowscroll per row at camX × (32 + i) / 64 (0x23390); the stage palettes; the recipes in `tools/re/levels/ch1.json` … `ch6.json` and `pics.json` |
| `enemy-kinds.js` | `ENEMY_KINDS` and `BOSS_DEFS`: kinds, variants, HP formula, attack choice, boss moves | hand-written on the ROM data above (ENEMIES §2, CAMPAIGN §12.4) |
| `selection-art.js` | the hero select screen | native 384 × 224 screenshots of the original select screen, captured from the ROM set with MAME (`assets/reference/select-*.png`) |
| `combat-config.js` | tuning | `combat-config.json` through `tools/build-config.cjs` |

## How it was checked

- `work/re/verify-extract/{heroes,enemies,bosses,stages,mechanics}/` hold the independent checks of every extraction (`VERIFY.json`, `heroes/RECHECK.json`): records re-rendered against MAME snapshots, live palettes, damage records, the band depths of `stages/depth-check.json` and the scroll3 extension of `stages/s3-beyond.json`. The issues they found are absorbed as PLAN §2 KI1–KI24.
- `tests/fixtures/rom-heroes-golden.json` (about 400 sampled hero frames) is compared with `HeroRig.parts()` by `tests/rom-heroes.cjs`.
- `tests/fixtures/hud-cabinet.json`, made by `tools/re/hud-cabinet.cjs` from the MAME scroll1 dumps of `work/re/runs/stg-ep1-walk`, is the cabinet HUD the framing suite compares with (every element within 0 px).
- `tools/re/compare-frames.cjs` sets up 23 scenes and compares them with MAME snapshots and frames of the two reference videos (VALIDATION.md).
- The stage review sheets (`node tools/re/build-game-assets.cjs review ch<N>`, `work/re/levels/`) were shown to the user before the chapters were un-stubbed.

## Arcade sound effects

The user's `Arcade - Cadillacs & Dinosaurs - Miscellaneous - Sound Effects.zip` contains 36 unlabelled WAV files. They were extracted to a scratch folder (the zip is unchanged) and labelled by cross-correlating each against the reference video's audio; [VIDEO-REVIEW.md](VIDEO-REVIEW.md) lists the matches. Eight are shipped as small mono MP3s in `assets/sfx/`: punch (0064), kick (007E), slam (0072), pistol (0076), rifle (0068), uzi (0085), explosion (0066) and machine gun (005D). Other effects are synthesized.

## Supplied music

The 28 supplied MP3 files contain **27 unique recordings** (both Four Heroes files have identical SHA-256 hashes). `assets/audio/manifest.json` records source names, duplicates, input hashes, output sizes and durations. Delivery copies use 160 kbps MP3; the originals were only read. Only the current cue loads. The Sound Room contains every distinct track.

## Movement and combat references

The user's local all-boss-fights video and the two-player video are the main behavioural references ([arcade-reference timestamps in VIDEO-REVIEW.md](VIDEO-REVIEW.md)); MAME runs of the ROM set gave the rest (frame timing, holds, damage, speeds). The MP4s remain unchanged local inputs and are not redistributed.

- [Goh_Billy's GameFAQs move list, supplied by the user](https://gamefaqs.gamespot.com/arcade/575551-cadillacs-and-dinosaurs/faqs/53882): indexed excerpts only; the full page blocked direct retrieval.
- [ninjasrok's GameFAQs walkthrough](https://gamefaqs.gamespot.com/arcade/575551-cadillacs-and-dinosaurs/faqs/45433): the four running attacks and enemy attack patterns.
- [RQ87 gameplay](https://rq87.flyingomelette.com/RQ/CAD/game.html), [weapon](https://rq87.flyingomelette.com/RQ/CAD/wep.html) and [character](https://rq87.flyingomelette.com/RQ/CAD/char.html) references: running, pickups, weapon drops, calming dinosaurs, Cadillac contact attacks, firearm differences, specials.
- The supplied Namu enemy-list URL could not be retrieved; no claim of its roster is made.

Intentional differences from the arcade: an empty firearm is hurled at the enemy (the user asked for it; the arcade drops it), the sequel's weapon gameplay values (ammunition, damage, pierce) are kept, and cooperative grabs and team moves are outside this single-player game.

Technical references: the [MAME CPS-1 driver](https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1.cpp) and [video implementation](https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1_v.cpp), the [MAME Lua API](https://docs.mamedev.org/luascript/index.html). MAME ran headless without sound for extraction, from a private rompath outside the repository; missing board-logic and QSound files were zero-filled placeholders for research only and are neither distributed nor used by the game.

## Story continuity

The sequel starts from the original ending as the arcade played it: Fessenden injects himself with his serum and dies a beast in the throne room, Jack goes back on foot for Hannah in the escape tunnel, Mustapha and Mess walk out across the desert and the Cadillac picks them up at sunset. The account was cross-checked against the [arcade game's plot summary](https://en.wikipedia.org/wiki/Cadillacs_and_Dinosaurs_(video_game)), the final fight in the reference video and the ROM's own ending script (`work/re/extract/story/`). Dr. Echo, Marshal Sable, the numbered lots, the Mirror Gang, the command signal, the Crown dam and all dialogue are new fan fiction ([STORY.md](STORY.md)).

Original game, artwork and music: Capcom, 1993. Characters and setting derive from Mark Schultz's Xenozoic Tales. This unofficial fan project is unaffiliated with the original creators. No ownership of original assets is asserted.

## Retired in G8

Before the rebuild the game drew from hand-assembled and generated art: an atlas of recovered poses and generated boss sprites (`assets.js`, `combat-art.js`, `hero-art.js`, `sequel-art.js`), the supplied weapon sheet colour-keyed at load (`weapon-art.js`), the first hero and item decodes (`arcade-heroes.js`, `arcade-items.js`), five generated scenery images (`environment-art.js`, `assets/scenery/`, the originals in `assets/original/`) and the earlier background sheets (`world-art.js`). G8 deleted them; git history keeps them. The background sheets by **shunninghuang** ([Sprite Database](https://spritedatabase.net/game/597)) remain in `assets/reference/` as research material with their credit strips; they are not loaded by the game and are excluded from deployment. The generation record of the retired scenery stays in [docs/ART-DIRECTION.md](docs/ART-DIRECTION.md) for history.
