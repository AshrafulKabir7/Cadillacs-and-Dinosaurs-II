# Validation — October 8, 2026

**413 browser checks passed** in Chromium on Windows, with no uncaught browser exceptions reported. A new suite covers the handling polish (frame pacing, Cadillac momentum, riders, the radio strip and the last copy); the existing suites were updated for the new finale and the larger soundtrack and also passed.

| Suite | Coverage | Passed |
|---|---|---:|
| regression | Campaign, all weapons, audio (36 tracks), offline, portrait mobile, the last copy | 52 |
| armed | All heroes and guns, empty guns, interruption, bosses | 64 |
| combat | Combos, grabs, throws, original animations and sound | 27 |
| story | Entrances, checkpoints, driving and clone allies | 41 |
| sequel | Projectiles, objectives, recoil, the spillway and last copy, landscape touch and offline art | 36 |
| mobile | Touch input, orientation layouts and fullscreen | 45 |
| specification | Selection, three tiers, sockets, recoil, FX, crowd queue, flanking and rage | 125 |
| polish | 60/72/144 Hz pacing, throttle/coast/brake, lock standstill, lean, streaming road, ram, bike explosion, sliding drops, flatbed pods, radio strip, rider shoot/swerve, Crown Engine → spillway → LOT 00 → ending | 23 |

## Full campaign completion

The deterministic input-driven player completed all six Easy chapters, including objectives, mid-bosses, the final clone war, both Crown Engine phases, the spillway release and the last copy of Fessenden. It uses ordinary movement, attack, jump/boost, special, pickup and interaction inputs, without teleports, forced damage or health changes. Its driving logic was updated for the momentum model (it bashes riders from alongside and boosts into rams instead of trying to park on top of them).

| Chapter | Simulated duration | Lives lost |
|---|---:|---:|
| 1 · Drowned Harbor | 8:01 | 0 |
| 2 · Coral Causeway | 8:08 | 0 |
| 3 · Verdant Biodome | 7:16 | 0 |
| 4 · Geothermal Forge | 8:25 | 0 |
| 5 · Skyhook Radar Fortress | 8:19 | 0 |
| 6 · Crown Spire (incl. the last copy) | 8:06 | 0 |

## Handling checks and visual review

- **Frame pacing.** A requestAnimationFrame probe in the real browser on this machine's 72 Hz and 141 Hz displays measured the hero's per-frame movement before and after the change: before, one frame in six moved 0 px (3,3,3,3,3,0 at 72 Hz); after, every frame moves the same amount (1.25 px per frame at 141 Hz for a 180 px/s walk). The suite confirms a second of walking covers 180 px at 60, 72 and 144 updates per second.
- **Cadillac.** Throttle builds from 0 to 275 px/s over about half a second, releasing coasts (191 px/s after 0.2 s), the brake reverses at 175 px/s, an unattended car in a locked fight drifts 0 px and keeps its whole body on screen, steering leans the body, and the scenery scroll advances throughout a locked fight.
- **Riders.** In 15 simulated seconds of a highway fight riders both fired and swerved into the car. A full-speed ram flings a rider; a beaten rider leaves an explosion effect.
- **Finale.** Draining Sable's first bar boards the Crown Engine; wrecking it leaves the spillway task; completing the task releases LOT 00 · FESSENDEN from beyond the right edge with a name card and the original final boss theme; beating it clears the chapter and the ending plays the original ending theme.
- **Screenshots inspected** in the browser: the harbor fight with the radio strip under the status bar, the highway with the car leaning and dust, riders alongside, the flatbed pod being rammed (2-hit combo), the toll fort with the parked Cadillac, Warden Rook's arrival card, the pink last copy entering and biting.

## Reproduce

From the repository root, install the optional development dependencies with `npm install` inside `tests/` and Chromium with `npx playwright install chromium`. Serve the root with any static server (for example a small Node server) and point the suites at it with `GAME_URL`:

```text
node tests/specification.cjs
node tests/regression.cjs
node tests/armed-actions.cjs
node tests/combat.cjs
node tests/story.cjs
node tests/sequel.cjs
node tests/mobile.cjs
node tests/polish.cjs
node tests/bot.cjs
```

Reports and screenshots live in ignored `tests/results/`. `python tools/build-config.py` synchronizes JSON tuning changes. No test tooling or build step is needed to play or deploy.

## Limits

The video comparison sampled the two driving sequences and the hero's basic movement rather than every frame. This is a fan-game approximation of selected arcade mechanics, not a frame-perfect emulator. The last copy uses the original beast frames with a colour shift rather than new animation. Full-campaign timing is for Easy; Normal and Mania were exercised by the suites but not given a complete human balance pass. Physical phones/controllers, Safari and Firefox were not tested. Local checks and a GitHub push do not establish a successful Vercel production deployment.
