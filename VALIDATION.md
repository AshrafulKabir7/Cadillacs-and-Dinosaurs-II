# Validation — October 5, 2026

**388 browser checks passed** in Chromium on Windows, with no uncaught browser exceptions reported. The latest feature suite tests the video-based specification; existing combat, campaign, audio, offline, mobile and fullscreen suites also passed.

| Suite | Coverage | Passed |
|---|---|---:|
| regression | Campaign, all weapons, audio, offline, portrait mobile | 51 |
| armed | All heroes and guns, empty guns, interruption, bosses | 64 |
| combat | Combos, grabs, throws, original animations and sound | 27 |
| story | Entrances, checkpoints, driving and clone allies | 41 |
| sequel | Projectiles, objectives, recoil, landscape touch and offline art | 35 |
| mobile | Touch input, orientation layouts and fullscreen | 45 |
| specification | Selection, three tiers, sockets, recoil, FX, crowd queue, flanking and rage | 125 |

## Full campaign completion

A deterministic input-driven player completed all six Easy chapters, including objectives, mid-bosses, the final clone war and both final boss phases. It uses ordinary movement, attack, jump, special, pickup and interaction inputs, without teleports, forced damage or health changes. Each chapter retains six sections and multiple waves. The bot is a progression smoke test, not a guarantee that a human player will find the balance ideal.

| Chapter | Simulated duration | Lives lost |
|---|---:|---:|
| 1 · Drowned Harbor | 8:01 | 0 |
| 2 · Coral Causeway | 7:48 | 0 |
| 3 · Verdant Biodome | 7:31 | 0 |
| 4 · Geothermal Forge | 8:22 | 0 |
| 5 · Skyhook Radar Fortress | 8:09 | 0 |
| 6 · Crown Spire | 8:05 | 0 |

## Latest checks and visual review

- Original 384×224 selection captures load for all four heroes, in the original portrait order. Keyboard navigation follows that order; Easy, Normal and Arcade Mania reach gameplay, checkpoints and Continue correctly. Original Power/Speed/Skill ratings are restored.
- Configuration JSON and its offline JavaScript copy match. Each tier changes actual health, recovery, boss decision/recovery timing and melee durability; standard firearm ammo caps remain consistent. Legacy difficulty values migrate.
- Easy queues excess reinforcements off screen and admits a waiting enemy when a slot opens. Mania flankers cross behind the player, and wounded dinosaurs visibly wait through their rage warning before moving.
- Every hero and firearm class is checked in both directions for shared muzzle/projectile coordinates, physical recoil and casing rules. Existing tests cover all six guns at point-blank range, empty weapons, pickup cancellation and remaining ammo after drops. An armed attack does not also punch.
- Knife/bullet blood, bare-handed sparks, mechanical-hit sparks, fire/smoke/fragments, effect expiry and recoil boundaries are tested.
- All 27 supplied music tracks decode. Stage, boss intro/battle, pause, mute, Sound Room and local-file audio work.
- Five new environments decode, including offline launch. Lossless WebP runtime copies were verified pixel-for-pixel against the original generated PNGs; source images are unchanged. Scenery runtime transfer is 12.11 MiB instead of a 21.53 MiB base64 JavaScript bundle. Runtime images are requested as ordinary local files.
- Inspected actual browser screenshots of the restored selector on desktop and portrait phone, all four heroes running with a horizontal shotgun, all five new environments, the Regent/Cinder/Echo/Sable arenas, M16 impact and rocket explosion. Radio messages and lower weapon HUD occupy separate rows.
- Mobile tests use real multi-touch events in Chromium emulation at 390×844, 844×390 and 667×375. They cover steering, diagonals, running, simultaneous move/attack, release, jump, fullscreen exit and the iPhone-style fullscreen fallback.

## Reproduce

From the repository root, install the optional development dependencies with `npm install --prefix tests` and Chromium with `npm exec --prefix tests -- playwright install chromium`. Serve the root on port 8766 (or set `GAME_URL`). Run:

```text
node tests/specification.cjs
node tests/regression.cjs
node tests/armed-actions.cjs
node tests/combat.cjs
node tests/story.cjs
node tests/sequel.cjs
node tests/mobile.cjs
node tests/bot.cjs
```

Reports and screenshots live in ignored `tests/results/`. `python tools/build-config.py` synchronizes JSON tuning changes. No test tooling or build step is needed to play or deploy.

## Limits

The source-video review sampled specified sequences rather than every frame of the full playthrough. This is a fan-game approximation of selected arcade mechanics, not a frame-perfect emulator. The original portrait band and stat panel are retained; difficulty controls replace unused join-in space, and the game remains single-player. New human bosses have a smaller animation set than the recovered original heroes. Full-campaign timing is for Easy; Normal and Mania were checked for their specific behavior but not given a complete human balance pass. Physical phones/controllers, Safari and Firefox were not tested. Local checks and a GitHub push do not establish a successful Vercel production deployment.
