# Assets and gameplay references

The supplied dino directory contains CPS-1 ROM images, not the original source project. This is a newly written browser game; it does not emulate the original at runtime.

## ROM graphics

Graphics ROMs were interleaved into a four-megabyte region and decoded into 16×16 tiles with four bitplanes. Original palettes and sprite placement were read from emulated graphics memory. The first atlas contains 194 poses/objects. This update adds **90 selected combat poses**: raiders, knife fighters, poachers, heavy enemies, raptors, a larger dinosaur, mutants, Slice-derived and Tyrog-derived boss artwork, and a motorcycle. Incomplete and overlapping frames were omitted from the new atlas.

Rook, Cinder, Echo and Sable now have original generated ready/attack sprites. Thornmaw retains the larger recovered dinosaur artwork. Older boss-adapted frames remain in the atlas but no longer render these four human bosses. The Crown Engine is new canvas artwork with a cockpit, hydraulic hammer, cannon, tracks and damage smoke. Vehicles remain canvas drawings; some movement states reuse poses. Timing and encounters are this game's implementation.

The hero correction adds **28 selected poses** in `hero-art.js` / `assets/hero-actions.png`: aiming, recoil, three running frames, a dash strike and an aerial strike for each hero. Aiming and dash art was recovered through controlled local arcade captures. The firearm renderer uses full-body aiming/recoil poses when firing and the original full-body stride with a lowered weapon while walking. This removes the previous torso/leg clipping seam. It never selects an unarmed attack animation for gunfire. Per-hero grip coordinates align the supplied gun sprites. Atlas frame metadata identifies its local capture and frame number.

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

Sheets contributed by **shunninghuang** at [Sprite Database](https://spritedatabase.net/game/597) remain in `assets/reference/`, including original credit strips. These are retained research assets. `world-art.js` and these backgrounds are no longer loaded by `index.html` and are excluded from the Vercel upload. The active six environments and four human boss designs were generated for this sequel. Exact prompts, files and the built-in generation method are recorded in [ART-DIRECTION.md](ART-DIRECTION.md). Mission consoles, hazards and the final machine are drawn in code.

Source pages: [Episode 1](https://spritedatabase.net/file/20058), [Episode 2](https://spritedatabase.net/file/20059), [Episode 4](https://spritedatabase.net/file/20061), [Episode 5](https://spritedatabase.net/file/20062), [Episode 6](https://spritedatabase.net/file/20063), [Episode 7](https://spritedatabase.net/file/20064), [Episode 8](https://spritedatabase.net/file/20065).

## Movement and combat

The latest pass also used the user's local all-boss-fights video. [VIDEO-REVIEW.md](VIDEO-REVIEW.md) records the sampled portions, observations, reproduced bugs and fixes. The MP4 remains an unchanged local input and is not redistributed.


- [Goh_Billy's GameFAQs move list, supplied by the user](https://gamefaqs.gamespot.com/arcade/575551-cadillacs-and-dinosaurs/faqs/53882): indexed excerpts were accessible, though the full page blocked direct retrieval. These establish different character actions and attack/jump inputs; they are references, not this sequel's script.
- [ninjasrok's GameFAQs walkthrough](https://gamefaqs.gamespot.com/arcade/575551-cadillacs-and-dinosaurs/faqs/45433): indexed material corroborates the four distinct running attacks and enemy attack patterns.
- [The supplied Namu enemy-list URL](https://en.namu.wiki/w/%EC%BA%90%EB%94%9C%EB%9D%BD%26%EB%8B%A4%EC%9D%B4%EB%85%B8%EC%86%8C%EC%96%B4/%EC%A0%81%EA%B5%B0%20%EC%9D%BC%EB%9E%8C) could not be retrieved. Its complete contents were not reviewed; no claim of exact Namu roster coverage is made.

- [RQ87 gameplay reference](https://rq87.flyingomelette.com/RQ/CAD/game.html): running, pickups, weapon drops, calming dinosaurs and Cadillac contact attacks.
- [RQ87 weapon reference](https://rq87.flyingomelette.com/RQ/CAD/wep.html): firearm differences, ammunition, explosives, knife throwing and rod breakage.
- [RQ87 character reference](https://rq87.flyingomelette.com/RQ/CAD/char.html): movement, dash attacks and specials.

These informed selected mechanics. The new engine does not reproduce every original move, animation, AI rule or damage value. Cooperative grabs and team moves are outside this single-player version.

An intentional input difference: an empty firearm stays in the hero's hands and J produces no melee attack. E discards/swaps it. This addresses the requested gun-versus-punch behavior; original empty-rifle clubbing is not active in this version.

## Story continuity

The opening follows the original ending: Fessenden's laboratory collapses, Jack helps Hannah escape, and both return in the Cadillac to rejoin Mustapha and Mess. The ending account was cross-checked against the [arcade game's plot summary](https://en.wikipedia.org/wiki/Cadillacs_and_Dinosaurs_(video_game)). The water blockade, Marshal Sable, evacuation ridge, Crown Engine, dialogue and ensuing six-chapter scenario are new fan fiction. Chapter transitions use text panels rather than animated cinematics.

Original game, artwork and music: Capcom, 1993. Characters and setting derive from Mark Schultz's Xenozoic Tales. This unofficial fan project is unaffiliated with the original creators. No ownership of original assets is asserted.
