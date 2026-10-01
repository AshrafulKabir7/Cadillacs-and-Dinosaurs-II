# Source and asset notes

The supplied `dino` folder contains CPS-1 arcade ROM images, not the source project for the original game. The filenames and graphics layout were identified using the official MAME driver for Cadillacs and Dinosaurs:

- https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1.cpp
- https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1_v.cpp
- https://docs.mamedev.org/luascript/index.html

## Recovered graphics

The eight `cd-*m` graphics ROMs were interleaved into their original four-megabyte graphics region. Tiles were decoded as 16×16 pixels with four bitplanes. Sprite placement and palette data were read from emulated graphics memory during short captures of each of the four heroes. The result is an atlas of 194 recovered poses and objects, including the heroes, two enemy appearances and a barrel.

The runtime embeds that atlas in `assets.js`; it does not run the original arcade program or require MAME. The recovered characters retain their original colored pixel artwork. Only selected complete poses are used by the game. Other captured poses remain in the atlas as editing references. Some captured enemy poses contain overlapping objects; the game selects the clean poses.

The new environments, Cadillac, dinosaur enemies and Pale Regent are drawn by this game's canvas code. Several human bosses use recovered enemy artwork with a changed palette or additional equipment. The synthesized music and effects are new; the original QSound soundtrack is not used.

This is a newly written browser game, not a ROM patch. It has no dependency on an emulator, external website, downloaded font, game engine package, installation service or remote account.

## Extraction details

For the extraction process only, official MAME was run without audio. The supplied set lacked several unused board-logic dumps and the QSound firmware expected by that MAME build. A temporary research archive used zero-filled placeholders for those missing files. Those placeholders were not added to the original folder, are not represented as authentic dumps, and are not used by this game. Emulation was used solely to read graphics and palettes; original arcade music was not recovered.

Original ROM files were only read. Their recorded SHA-256 hashes were rechecked after completion. `original-rom-hashes.json` contains the manifest.

## Attribution

Cadillacs and Dinosaurs arcade game and original artwork: Capcom, 1993. Original characters and setting derive from Mark Schultz's Xenozoic Tales. This personal fan project is unofficial and is not affiliated with or endorsed by the original creators. New fan-game source code, story and procedural graphics are in this folder and can be edited directly.
