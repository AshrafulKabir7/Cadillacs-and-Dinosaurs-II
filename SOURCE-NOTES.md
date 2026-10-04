# Assets and gameplay references

The supplied dino directory contains CPS-1 ROM images, not the original source project. This is a newly written browser game; it does not emulate the original at runtime.

## ROM graphics

Graphics ROMs were interleaved into a four-megabyte region and decoded into 16×16 tiles with four bitplanes. Original palettes and sprite placement were read from emulated graphics memory. The first atlas contains 194 poses/objects. This update adds **90 selected combat poses**: raiders, knife fighters, poachers, heavy enemies, raptors, a larger dinosaur, mutants, Slice-derived and Tyrog-derived boss artwork, and a motorcycle. Incomplete and overlapping frames were omitted from the new atlas.

New named bosses are fan-sequel characters using adapted arcade art. The Pale Regent changes the palette and scale of recovered mutant artwork. Vehicles remain canvas drawings; some movement states reuse poses. Timing and encounters are this game's implementation.

Technical references:

- [Official MAME CPS-1 driver](https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1.cpp)
- [Official MAME video implementation](https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1_v.cpp)
- [MAME Lua API](https://docs.mamedev.org/luascript/index.html)
- [Archived MAME cheat metadata](https://github.com/libretro/mame2010-libretro/tree/master/metadata), used for stage selection and player health during local artwork capture.

Official MAME ran without sound for extraction. The supplied set lacked unused board-logic dumps and expected QSound firmware; temporary research used zero-filled placeholders for missing files. These are not authentic dumps and are neither distributed nor used by the game. No emulator or full ROM archive is included. The original ROM hash manifest is retained.

## Supplied weapons and music

`assets/reference/weapons.png` preserves the supplied weapon sheet. Runtime rectangles select weapons, muzzle flashes and explosions. Canvas color-keying removes blue; horizontal poses and facing direction are selected individually.

The 28 MP3 files contain **27 unique recordings**. Both Four Heroes files have identical SHA-256 hashes. `assets/audio/manifest.json` records source names, duplicates, input hashes, output sizes and durations. Delivery copies use 160 kbps MP3; originals were only read. Audio totals approximately 45.7 MB. Only the current cue loads, rather than the entire collection at startup.

Music is the supplied soundtrack. Combat effects are synthesized. Playback starts after user interaction. The Sound Room contains all distinct supplied tracks.

## Background artwork

Sheets contributed by **shunninghuang** at [Sprite Database](https://spritedatabase.net/game/597) remain in `assets/reference/`, including original credit strips. Runtime crops exclude strips from gameplay, key out magenta, and arrange scenery/floor sections into the sequel's areas. Mission signs, hazards and encounters are new.

Source pages: [Episode 1](https://spritedatabase.net/file/20058), [Episode 2](https://spritedatabase.net/file/20059), [Episode 4](https://spritedatabase.net/file/20061), [Episode 5](https://spritedatabase.net/file/20062), [Episode 6](https://spritedatabase.net/file/20063), [Episode 7](https://spritedatabase.net/file/20064), [Episode 8](https://spritedatabase.net/file/20065).

## Movement and combat

- [RQ87 gameplay reference](https://rq87.flyingomelette.com/RQ/CAD/game.html): running, pickups, weapon drops, calming dinosaurs and Cadillac contact attacks.
- [RQ87 weapon reference](https://rq87.flyingomelette.com/RQ/CAD/wep.html): firearm differences, ammunition, explosives, knife throwing and rod breakage.
- [RQ87 character reference](https://rq87.flyingomelette.com/RQ/CAD/char.html): movement, dash attacks and specials.

These informed selected mechanics. The new engine does not reproduce every original move, animation, AI rule or damage value. Cooperative grabs and team moves are outside this single-player version.

Original game, artwork and music: Capcom, 1993. Characters and setting derive from Mark Schultz's Xenozoic Tales. This unofficial fan project is unaffiliated with the original creators. No ownership of original assets is asserted.
