# Cadillacs & Dinosaurs II: Last Eden

A complete, short, single-player fan campaign made for Mostafa's next adventure. Six new chapters connect the original arcade heroes to a new story, six bosses and a two-phase final battle. This is an unofficial fan sequel, not an official Capcom release or a modification of the original arcade ROM.

## Deploy online

Ready for **Vercel**: import this repository at [vercel.com/new](https://vercel.com/new), choose **Other**, and deploy from the repository root. `vercel.json` configures static hosting with no install or build commands. No environment variables are needed.

**GitHub Pages** is also supported: Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

See [DEPLOYMENT.md](DEPLOYMENT.md) for exact settings and links. Repository: [AshrafulKabir7/Cadillacs-and-Dinosaurs-II](https://github.com/AshrafulKabir7/Cadillacs-and-Dinosaurs-II).

## Play

Double-click **PLAY GAME.bat**, or open **index.html** in Chrome, Edge or Firefox. No installation, account, internet connection or original emulator is required. Keep the files in this folder together.

Choose Mustapha, Jack, Hannah or Mess. **Story** gives you extra health and forgiving enemies. **Arcade** makes enemies tougher and faster. Press Enter on the title screen, choose your hero, then press Enter twice to start.

| Action | Keyboard | Gamepad |
|---|---|---|
| Move / steer | WASD or arrow keys | Left stick / D-pad |
| Attack; hold for combos | J, Z or Space | X / left face button |
| Jump / Cadillac boost | K or X | A / bottom face button |
| Special / Cadillac ram | L or C | Y / top face button |
| Pick up / throw weapon | E or V | B / right face button |
| Run | Shift | — |
| Pause | Esc or P | Start |

Touch controls appear on devices with a touch-oriented pointer. Landscape orientation gives you a larger playfield. Gamepad layouts vary; connect the controller before playing and press a button to activate it.

## Campaign

1. **The Drowned Harbor** — track a dinosaur-smuggling convoy; defeat Warden Rook.
2. **The Green Highway** — fight from the Cadillac; destroy the Iron Convoy.
3. **The Verdant Basin** — cross the infected jungle; defeat Thornmaw.
4. **The Ashen Foundry** — destroy a mutation refinery; defeat Foreman Cinder.
5. **The Mirror Lab** — break the cloning station; defeat Sentinel Echo.
6. **The Last Eden** — stop Dr. Mara Voss, then survive her transformation into the Pale Regent.

Each chapter has four enemy encounters and a boss. Clear each encounter, then move right. The highway moves forward automatically; steer between lanes, fire with J, boost with K and ram nearby enemies with L. Steer left to aim your gun behind you.

Break crates and barrels to find food, guns and knives. Food restores health automatically when you walk over it. Pick up other items with E. Guns have 24 rounds; knives have 16 uses. Bombs appear as encounter rewards. J uses your equipped weapon, and E throws it when there is nothing nearby to pick up.

Jump and attack for a flying kick. Running attacks do extra damage. Your special hits nearby enemies and costs 8 health outside the Cadillac. Dodge the red/orange attack markers. Jump over boss shockwaves; step outside acid attack zones.

You have three lives, followed by unlimited chapter retries. Losing a life revives you where you are. Losing all three offers a restart of the chapter.

## Saving

Progress saves automatically at the **start of each chapter** and after chapter completion, using this browser's local storage. Continue restarts the saved chapter; it does not restore a fight halfway through. Cleared chapters unlock in the Chapters menu. Browser profiles and file locations may have separate saves. Clearing browser data removes the save. If local storage is blocked, the game still runs, but progress may not persist.

Audio begins after your first click or keypress. SOUND ON/OFF changes both music and effects. Use the fullscreen button for a larger view. Switching away from the game pauses it.

## Files and editing

- `index.html` — launcher and page structure.
- `style.css` — responsive arcade interface.
- `game.js` — complete game logic, six chapter definitions, story scenes, enemy/boss behavior, procedural environments, vehicles and original synthesized music.
- `assets.js` — embedded sprite atlas and animation metadata; this keeps offline loading reliable.
- `assets/sprites.png` — recovered character/enemy/barrel sprite atlas for inspection and editing.
- `STORY.md` — storyline, chapter details and boss guide, including ending spoilers.
- `SOURCE-NOTES.md` — asset provenance and technical notes.
- `VALIDATION.md` — what was tested and the limits of that testing.
- `DEPLOYMENT.md` and `vercel.json` — Vercel settings and GitHub Pages alternative.

To add a chapter or change a boss, edit `LEVELS` and the combat/boss functions in `game.js`. The game has no build step or external dependencies. Browser developer tools expose `LAST_EDEN.snapshot` and a small diagnostic interface useful for local testing.

## Credits

Original arcade game and recovered artwork: **Capcom, Cadillacs and Dinosaurs (1993)**. Original characters and setting: **Mark Schultz's Xenozoic Tales**. New fan-game engine, story, environments, boss designs and synthesized soundtrack were created for this project. The supplied original ROM files were left unchanged.
