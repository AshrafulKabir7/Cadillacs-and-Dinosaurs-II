# Assets and gameplay references

The supplied dino directory contains CPS-1 ROM images, not the original source project. This is a newly written browser game; it does not emulate the original at runtime.

## ROM graphics

Graphics ROMs were interleaved into a four-megabyte region and decoded into 16×16 tiles with four bitplanes. Original palettes and sprite placement were read from emulated graphics memory. The first atlas contains 194 poses/objects. A later update added **90 selected combat poses**: raiders, knife fighters, poachers, heavy enemies, raptors, a larger tyrannosaur-shaped creature, mutants, a blond heavy fighter, an orange clawed mutant and a motorcycle. Incomplete and overlapping frames were omitted from that atlas. The reference video shows that the tyrannosaur silhouette matches Fessenden's final mutated form (pink in the original); an earlier note called it Tyrog-derived, which the video does not support.

Rook, Cinder, Echo and Sable have original generated ready/attack sprites; Echo is recast as Fessenden's former assistant, Dr. Echo. The Chapter 3 boss, Fessenden Beast · Copy 01, uses the larger recovered creature tinted towards the original's pink. Older boss-adapted frames remain in the atlas but do not render the four human bosses. The Crown Engine is canvas artwork with a cockpit, hydraulic hammer, cannon, tracks and damage smoke. Copies of the heroes (the Mirror Gang and freed clones) reuse the decoded hero animation with a colour filter. Timing and encounters are this game's implementation.

The earlier hero correction added **28 selected poses** in `hero-art.js` / `assets/hero-actions.png`: aiming, recoil, three running frames, a dash strike and an aerial strike for each hero. Aiming and dash art was recovered through controlled local arcade captures. Firing uses full-body aiming/recoil poses and never selects an unarmed attack animation for gunfire. Per-hero grip coordinates align the supplied gun sprites. Atlas frame metadata identifies its local capture and frame number.

Technical references:

- [Official MAME CPS-1 driver](https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1.cpp)
- [Official MAME video implementation](https://github.com/mamedev/mame/blob/master/src/mame/capcom/cps1_v.cpp)
- [MAME Lua API](https://docs.mamedev.org/luascript/index.html)
- [Archived MAME cheat metadata](https://github.com/libretro/mame2010-libretro/tree/master/metadata), used for stage selection and player health during local artwork capture.

Official MAME ran without sound for extraction. The supplied set lacked unused board-logic dumps and expected QSound firmware; temporary research used zero-filled placeholders for missing files. These are not authentic dumps and are neither distributed nor used by the game. No emulator or full ROM archive is included. The original ROM hash manifest is retained.

## Hero frames decoded from the arcade sprite tables (arcade feel update)

`arcade-heroes.js` replaces the earlier load-time composites (`hero-poses.js`, removed). Its frames come directly from the original game's data in the supplied ROM set, which was only read:

- The 68000 program (`cde_23a.8f`, `cde_22a.7f`, `cde_21a.6f`, byte-swapped) holds a table of 3,513 frame-record pointers at 0xD0CF4 and 2,516 layout pointers at 0xD43D8. A record lists its tiles (with a size/flip/palette attribute when flag 0x8000 is set, otherwise single 16×16 tiles) and a layout index; a layout gives each block's signed offset from the character's feet.
- Tiles are decoded from the graphics ROMs as before. Each hero's 16-colour palette was solved by aligning a decoded record with the same frame in the previously recovered atlas.
- Records were identified for each hero (walk, walking legs, run, running legs, jump, crouch, combo, grab, knee, throw, hurt, flung, lying, get-up, dizzy, victory, gun stances and gun-carrying torsos). Mustapha's were confirmed against the reference video; the other heroes' were chosen from their own record sets by matching layout order and pose (for example Mess's 13 gun stances 716–728 align with Mustapha's 256–268).
- Separate shadow blocks are dropped (the game draws its own shadow). The front hand of each frame is measured from its skin colours and used to place held weapons; Mustapha's rifle-stance hand (40 px forward, 66 px up) agrees with the video measurement (about 35 and 62).

Weapons are drawn from the supplied sheet at the heroes' scale. Carrying a long gun while running uses the sheet's pre-drawn upright sprites. Hit sparks are the sheet's starburst frames; gun hits use its “POW!” sprites.

## Arcade sound effects

The user's `Arcade - Cadillacs & Dinosaurs - Miscellaneous - Sound Effects.zip` contains 36 unlabelled WAV files. They were extracted to a scratch folder (the zip is unchanged) and labelled by cross-correlating each against the reference video's audio; [VIDEO-REVIEW.md](VIDEO-REVIEW.md) lists the matches. Eight are shipped as small mono MP3s in `assets/sfx/`: punch (0064), kick (007E), slam (0072), pistol (0076), rifle (0068), uzi (0085), explosion (0066) and machine gun (005D). Other effects remain synthesized.

## Corrected recovered frame lists

- The gunner's attack list contained frame 73 (a triceratops) and frame 75 (two overlapping gunners), so armed poachers flashed into a dinosaur when firing. It now uses an aiming frame with a muzzle flash.
- The orange mutant's knockdown frame was an unrelated soldier; it now uses its own crouch.
- The chopper sprite faces the opposite way to every other recovered sprite, so it is mirrored to match its rider; riders are drawn above the saddle.

## Supplied weapons and music

`assets/reference/weapons.png` preserves the supplied weapon sheet. Runtime rectangles select weapons, muzzle flashes and explosions. Canvas color-keying removes blue; horizontal poses and facing direction are selected individually.

The 28 MP3 files contain **27 unique recordings**. Both Four Heroes files have identical SHA-256 hashes. `assets/audio/manifest.json` records source names, duplicates, input hashes, output sizes and durations. Delivery copies use 160 kbps MP3; originals were only read. Audio totals approximately 45.7 MB. Only the current cue loads, rather than the entire collection at startup.

Music is the supplied soundtrack. Hit, slam, gun and explosion effects use the supplied arcade samples listed above; other effects are synthesized. Playback starts after user interaction. The Sound Room contains all distinct supplied tracks.

## Background artwork

Sheets contributed by **shunninghuang** at [Sprite Database](https://spritedatabase.net/game/597) remain in `assets/reference/`, including original credit strips. These are retained research assets. `world-art.js` and these backgrounds are not loaded by `index.html` and are excluded from the Vercel upload. The active six environments and four human boss designs were generated for this sequel. Exact prompts, files and the built-in generation method are recorded in [ART-DIRECTION.md](ART-DIRECTION.md). Mission objects, story props (cold pods, egg racks, vats, clone tanks), hazards, the Cadillac and the final machine are drawn in code.

Source pages: [Episode 1](https://spritedatabase.net/file/20058), [Episode 2](https://spritedatabase.net/file/20059), [Episode 4](https://spritedatabase.net/file/20061), [Episode 5](https://spritedatabase.net/file/20062), [Episode 6](https://spritedatabase.net/file/20063), [Episode 7](https://spritedatabase.net/file/20064), [Episode 8](https://spritedatabase.net/file/20065).

## Movement and combat

The user's local all-boss-fights video is the main behavioural reference. [VIDEO-REVIEW.md](VIDEO-REVIEW.md) records the sampled portions, observations, reproduced bugs and fixes. The MP4 remains an unchanged local input and is not redistributed.

- [Goh_Billy's GameFAQs move list, supplied by the user](https://gamefaqs.gamespot.com/arcade/575551-cadillacs-and-dinosaurs/faqs/53882): indexed excerpts were accessible, though the full page blocked direct retrieval. These establish different character actions and attack/jump inputs; they are references, not this sequel's script.
- [ninjasrok's GameFAQs walkthrough](https://gamefaqs.gamespot.com/arcade/575551-cadillacs-and-dinosaurs/faqs/45433): indexed material corroborates the four distinct running attacks and enemy attack patterns.
- [The supplied Namu enemy-list URL](https://en.namu.wiki/w/%EC%BA%90%EB%94%9C%EB%9D%BD%26%EB%8B%A4%EC%9D%B4%EB%85%B8%EC%86%8C%EC%96%B4/%EC%A0%81%EA%B5%B0%20%EC%9D%BC%EB%9E%8C) could not be retrieved. Its complete contents were not reviewed; no claim of exact Namu roster coverage is made.

- [RQ87 gameplay reference](https://rq87.flyingomelette.com/RQ/CAD/game.html): running, pickups, weapon drops, calming dinosaurs and Cadillac contact attacks.
- [RQ87 weapon reference](https://rq87.flyingomelette.com/RQ/CAD/wep.html): firearm differences, ammunition, explosives, knife throwing and rod breakage.
- [RQ87 character reference](https://rq87.flyingomelette.com/RQ/CAD/char.html): movement, dash attacks and specials.

These informed selected mechanics. The new engine does not reproduce every original move, animation, AI rule or damage value. Cooperative grabs and team moves are outside this single-player version.

An intentional input difference: an empty firearm stays in the hero's hands and J produces no melee attack. E discards/swaps it. This addresses the requested gun-versus-punch behavior; original empty-rifle clubbing is not active in this version.

## Story continuity

The opening follows the original ending: Fessenden injects himself with his serum, his laboratory collapses, Jack helps Hannah escape, and the Cadillac brings the four friends home. The ending account was cross-checked against the [arcade game's plot summary](https://en.wikipedia.org/wiki/Cadillacs_and_Dinosaurs_(video_game)) and against the final fight in the reference video. The sequel builds on three consequences of that night — the surviving archive, the blood samples taken in the lab and Fessenden's post-serum sample — and on the poachers' hunting grounds and the Cadillac drive. Dr. Echo, Marshal Sable, the numbered clone lots, the Mirror Gang, the command signal, the Crown dam and all dialogue are new fan fiction. Chapter transitions use text panels; in-chapter story is delivered as radio dialogue.

The Cadillac drawing follows the driving section of the reference video (about 03:28–03:46): a long steel-blue convertible with tailfins, a rolled cream top, chrome side trim, a skirted rear wheel and the driver visible behind a wraparound windscreen.

Original game, artwork and music: Capcom, 1993. Characters and setting derive from Mark Schultz's Xenozoic Tales. This unofficial fan project is unaffiliated with the original creators. No ownership of original assets is asserted.
