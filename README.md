# Cadillacs & Dinosaurs II: Fessenden's Legacy

An unofficial single-player fan sequel for Mostafa's next adventure. Mustapha, Jack, Hannah and Mess return six months after the first game's ending for six chapters, mid-bosses, six bosses and a final clone war.

Fessenden died when his laboratory blew apart — but his assistant, Dr. Echo, saved his archive and finished his cloning work. Copies of the poachers the gang beat are walking the harbor, a copy of Fessenden's beast guards a raptor nursery, and the Mirror Gang — copies of the four heroes — waits at the Crown dam. [Read the sequel script](STORY.md).

![Fessenden's Legacy gameplay](preview.png)

## Play or deploy

Open **index.html** or **PLAY GAME.bat**. Keep the whole folder, including `assets/audio`. Offline play requires no installation or emulator.

For **Vercel**, import this repository, choose **Other**, leave build/install commands empty, and use output directory **`.`**. The root `vercel.json` supplies those settings. No environment variables are needed. [DEPLOYMENT.md](DEPLOYMENT.md) also covers GitHub Pages.

## Arcade feel update

Checked frame by frame against the user’s 15-minute arcade video, using the original game’s own sprite data.

- **The heroes now use the arcade’s own animation frames.** All four heroes are drawn from frame records decoded from the supplied ROM’s sprite tables, anchored at the feet exactly as the arcade places them: 12-frame walk, 9-frame run, jumps, crouch, punches, kicks, finishers, grabs, knees, throws, hurt, knockdown, lying, getting up and victory poses.
- **Guns are held the arcade way.** Long guns use the original hip stance (Mustapha records 259/260) and are carried on the arcade’s separate torso sprites over the walking legs (284) or running legs (288), upright in front of the chest while running. Handguns use the arm’s-length stance and stay in the hand while walking. Every gun sits at the hand point measured on each frame, at the same scale as the hero, with the weapon sheet’s pre-drawn upright sprites for carrying.
- **Punches that smash.** The ground combo is the original punch, punch, kick, finisher, and it only continues while blows connect. Each hit has hitstop (attacker and victim hold the impact frame and the victim shakes), an impact starburst from the original effects sheet, and screen shake. Finishers and knockdowns fling enemies back in an arc; they bounce once, slide, lie down and get up. Defeated enemies are flung before they fade. Gun hits show the arcade’s “POW!”.
- **Grab and throw.** Walk into an ordinary enemy to grab them. J knees; back + J throws them over your shoulder; the fourth J throws forward. A thrown body bowls over anyone in its path.
- **Original sound effects.** Punch, kick, body-slam, pistol, rifle/shotgun, Uzi/M-16 and explosion sounds come from the supplied arcade sound-effect set, identified by matching each sample against the video’s audio.

## Story and level update


- **A story that continues the first game.** Every chapter grows out of Fessenden's lab: copied poachers at the harbor, a pod convoy on the road home, a nursery bred from his pens, a vat forge, Echo's rebuilt laboratory and the Mirror Gang. Each chapter ending leads into the next chapter, and radio dialogue carries the story during play.
- **The last chapter is a clone war.** Fight copies of the other three heroes and then your own copy. Breaking Echo's command pylons frees them; freed clones (gold glow) fight Sable's controlled clones (violet glow, inverted colours) alongside you, including during the final boss.
- **Chapters last about 7–8 minutes.** Each chapter has six sections, 21–26 fights with several reinforcement waves, a mid-boss and a boss who calls reinforcements at two thirds and one third of its health. A deterministic test player clears each chapter in 7.3–8.6 simulated minutes; human play is usually slower.
- **Enemies arrive from off screen.** Each fight locks the screen; enemies walk or run in from beyond either edge, drop from above the top of the screen, or ride in. They cannot attack until they are on screen. Bosses walk in. Weapons come from enemies and crates rather than appearing from nowhere.
- **Gun pickup.** Picking up a weapon is a short crouch, and only when you stand on it. (Holding and carrying guns is described under Arcade feel above.)
- **Running.** Running is horizontal only (double-tap ← / → or hold Shift), raises dust and now uses the arcade’s 9-frame run cycle.
- **The original Cadillac.** The car is now the arcade's long steel-blue convertible with tailfins, a rolled cream top, a skirted rear wheel, whitewall tires, chrome trim and your hero visible at the wheel. Chapter 2 mixes driving with an on-foot toll fort where the Cadillac waits.
- **Other glitches fixed:** armed poachers no longer flash into a triceratops sprite when they fire; Mustapha's jump no longer shows him holding a torch; bikers sit on their bikes facing forward and crash when knocked down; checkpoints now save at every section.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Move / steer | WASD or arrows | Left stick / D-pad |
| Attack / pick up a weapon you are standing on | J, Z or Space | X / left face button |
| Grab / knee / throw | Walk into an enemy, then J; back + J throws | — |
| Jump / Cadillac boost | K or X | A / bottom face button |
| Special / ram | L or C; also tap attack + jump together | Y / top face button |
| Interact / pick up / throw | E or V | B / right face button |
| Run | Shift + ← / →, or double tap ← / → | — |
| Pause | Esc or P | Start |

**Phones and tablets:** a thumb stick on the left and PICK/USE, SPECIAL, JUMP and HIT/FIRE buttons on the right. Slide your thumb anywhere in the stick to move (diagonals work); push it to the rim to run. Use a second finger for the buttons while moving; hold PICK/USE at consoles. In portrait the controls sit below the playfield; in landscape the playfield fills the screen height and the controls float over its lower corners. Tap ⛶ for fullscreen: the header disappears, the playfield fills the screen and Android locks to landscape; ✕ or the pause menu exits. iPhone Safari has no page fullscreen, so it fills the screen instead; for true fullscreen on iPhone use Share → Add to Home Screen, which launches the game without browser bars. The desktop page is unchanged. Connect a controller and press a button to activate it.

Hold attack for combos. Jump first, then attack for a flying kick; attack while running for a dash strike. Specials cost eight health **when they hit an enemy** and drop the held weapon. Heavy hits also drop weapons, retaining ammunition.

Pistols, shotguns and rifles carry six rounds; bazookas carry four. Uzis and M-16A1s fire bursts. Shotguns hit a wider lane, rifles penetrate and rockets cause splash damage. **While holding a firearm, J only fires. Empty guns do not switch to melee: use E to throw or swap them.** Knives stab nearby enemies or are thrown at distant ones. Broken rods become sticks. Grenades and dynamite arc before exploding.

At a cold pod, valve, winch or pylon, **hold E / PICK** while standing still. At a radio, tap E until its display matches the marked channel. Attack sonic lures and drive into pod crates. Both the enemies and the active objective must be cleared to open the next area.

Break containers for supplies; walk over food to heal. Change lanes for charges, volleys and blue spillway-surge markers; jump over shockwaves. Attack during recovery. In the Cadillac, steer into enemies; J bashes, K boosts and L rams.

## Campaign and saving

1. **The Drowned Harbor** — *Faces from the Lab* — Lot 07 · Heavy, Warden Rook.
2. **The Green Highway** — *The Pod Convoy* — Lot 31 · Outrider, Iron Convoy.
3. **The Verdant Basin** — *The Nursery* — Pack Alpha, Fessenden Beast · Copy 01.
4. **The Ashen Foundry** — *The Vat Forge* — Lot 12 · Brawler, Foreman Cinder.
5. **The Tide Archive** — *Dr. Echo* — Mirror Clone, Dr. Echo.
6. **The Crown Barrier** — *Mirror War* — the Mirror Gang, your own clone, Marshal Sable and the Crown Engine.

Story gives extra health and gentler damage. Arcade increases enemy health, speed and encounter size. Three lives per attempt; after a game over you continue from the start of the current section.

Progress saves at the start of every section and at chapter completion in browser local storage. Continue resumes at the saved section, with earlier objectives (and freed clones) kept. Cleared chapters unlock for replay. Browser/site origins have separate saves; clearing browser data removes progress.

Audio begins after a click or keypress. SOUND toggles all audio. **Sound Room / Audio Settings** provides independent music/effects switches, music volume and every track. Switching away pauses active play.

## Development

- `game.js`: combat, input, chapter layout, encounters and entrances, allies, rendering and boss state machines.
- `campaign.js`, `mission-data.js`: story, chapter sections, fights, mid-bosses, dialogue and required objectives.
- `arcade-heroes.js`: hero animation frames decoded from the arcade ROM’s sprite tables, with feet origins and hand points (`assets/arcade-heroes.png` is a reference copy). `assets/sfx/`: the selected arcade sound effects.
- `audio.js`, `soundtrack-data.js`, `assets/audio/`: soundtrack and source manifest.
- `assets.js`, `hero-art.js`, `combat-art.js`, `weapon-art.js`, `sequel-art.js`: embedded artwork for local-file loading. `sequel-render.js` draws the scenery and human bosses.
- [STORY.md](STORY.md), [SOURCE-NOTES.md](SOURCE-NOTES.md), [VALIDATION.md](VALIDATION.md), [VIDEO-REVIEW.md](VIDEO-REVIEW.md): story, provenance, testing and reference review.
- `tests/`: optional development tests, including `tests/combat.cjs` (combat feel, guns, sounds), `tests/story.cjs` (story and levels) and `tests/bot.cjs`, which fails if any chapter clears in under seven minutes. No test dependency is required to play or deploy.

There is no production build step. `LAST_EDEN.snapshot` and explicitly named `LAST_EDEN.test` helpers support testing (the object keeps its earlier name so saves and tests stay compatible). This follows selected arcade mechanics; it is not a frame-perfect recreation or an official sequel.

## Credits

Original artwork and music: **Capcom, Cadillacs and Dinosaurs (1993)**. Characters and setting: **Mark Schultz's Xenozoic Tales**. Earlier background references retained with credits: **shunninghuang**, via [Sprite Database](https://spritedatabase.net/game/597). Active scenery and human boss designs are original generated assets. Weapon sheet and MP3s were supplied by the user. New fan-game engine, story and encounters were created for this project. Source ROMs and Downloads files remain unchanged.
