# Validation — October 8, 2026 (fourth pass)

**428 browser checks passed** in Chromium on Windows with no uncaught exceptions. The fourth pass replaced estimated weapon placements with holds measured from the arcade videos (see VIDEO-REVIEW.md) and added five checks: the rifle spans from ahead of the front hand back to the rear hand for all four heroes, the Uzi and shotgun sit in front of the chest at arcade size, the bazooka is shouldered, a knife is upright at rest and level on the move, and a knife with nobody to throw at still stabs crates and objectives. That last check came from a real bug the campaign bot hit: a knife swing with no enemy near did nothing, so a sonic lure could not be broken. The bot then cleared all six chapters in 2:50–4:17.

# Validation — October 8, 2026 (third pass)

**423 browser checks passed** in Chromium on Windows, with no uncaught browser exceptions reported. The third pass added ten checks to the polish suite for the decoded gun stances (Jack's torso records and the gun-in-hand firing frame, the shouldered bazooka for every hero) and the arcade items (recovery shares, points at full health, ammunition refills, container loot). The full-campaign bot completed all six chapters again (2:45–4:13, no deaths) with the new items in play.

## Headless captures inspected in the third pass

- Every hero with every gun (idle, firing, walking) at 2× zoom: Jack now holds long guns with both hands in front of the chest and fires the handgun from the arcade frame that contains the pistol (no doubled gun, muzzle flash at the hand point); all four shoulder the bazooka with the tube beside the head.
- The arcade food and score items laid out on the dock, then collected by walking over them (+10,000 popups for meals eaten at full health, score 020000).

# Validation — October 8, 2026 (second pass)

**413 browser checks passed** in Chromium on Windows, with no uncaught browser exceptions reported. The suites were updated for the shorter chapters, the thrown empty gun and the arcade continue; the polish suite from the morning pass also passed unchanged.

| Suite | Coverage | Passed |
|---|---|---:|
| regression | Campaign, all weapons, audio (36 tracks), offline, portrait mobile, the last copy | 52 |
| armed | All heroes and guns, empty guns thrown, interruption, bosses | 64 |
| combat | Combos, grabs, throws, original animations and sound | 27 |
| story | Entrances, checkpoints, driving, clone allies, eleven-plus fights per chapter | 41 |
| sequel | Projectiles, objectives, recoil, the spillway and last copy, landscape touch and offline art | 36 |
| mobile | Touch input, orientation layouts and fullscreen | 45 |
| specification | Selection, three tiers, sockets, recoil (with per-weapon sprite scale), FX, crowd queue, flanking and rage | 125 |
| polish | 60/72/144 Hz pacing, throttle/coast/brake, lock standstill, lean, streaming road, ram, bike explosion, sliding drops, flatbed pods, radio strip, rider shoot/swerve, Crown Engine → spillway → LOT 00 → ending | 23 |

## Full campaign completion

The deterministic input-driven player completed all six Easy chapters, including objectives, mid-bosses, the final clone war, both Crown Engine phases, the spillway release and the last copy of Fessenden, with ordinary inputs only. Chapters now have two fights of two waves per section (every objective fight kept), so the bot — quicker than a person — lands inside the 2.5–5 minute window the suite enforces; a human run is expected at four to five minutes.

| Chapter | Simulated duration | Lives lost |
|---|---:|---:|
| 1 · Drowned Harbor | 3:36 | 0 |
| 2 · Coral Causeway | 2:53 | 0 |
| 3 · Verdant Biodome | 3:22 | 0 |
| 4 · Geothermal Forge | 3:40 | 0 |
| 5 · Skyhook Radar Fortress | 3:41 | 0 |
| 6 · Crown Spire (incl. the last copy) | 4:14 | 0 |

## Visual checks (headless captures inspected)

- **Armed poses.** Rifle idle, walk, run and fire for Mustapha and Jack; the running torso now sits on the running legs with no gap (compared side by side with the previous build at 2× zoom). Handgun carried low in the walking and running hand, raised to fire. Knife at half size beside the hip, pointing forward on the stab.
- **Enemy frames.** Every brute, knifer and raider frame rendered on a baseline with its anchor: the brute's 48 px crouch fragment and the knifer's motorcycle-wreck "down" frame were identified and removed from the cycles. Brutes now walk upright through a fight; a knocked-down knifer flies about 100 px, bounces once and kneels before rising.
- **Cabinet HUD and continue.** The top bar during a fight (portrait, =3, score, MUSTAPHA 1ST, yellow bar, HEAVY with a green/purple bar, INSERT COIN blinking, JOIN-IN after a coin), the CONTINUE? count at 10 and 7 with the hero lying on the dock and the enemies standing off, the CREDIT 2 · PLAYER 1 START flash, the respawn on the same spot with full health, the game-over panel after the count expires (with the game-over jingle cued), and Warden Rook's bar in the slot.
- **Earlier pass (unchanged):** frame pacing at 72 and 141 Hz, Cadillac momentum, riders, the flatbed pods, the last copy's arrival and attacks.

## Reproduce

From the repository root, install the optional development dependencies with `npm install` inside `tests/` and Chromium with `npx playwright install chromium`. Serve the root with any static server and point the suites at it with `GAME_URL`:

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

Reports and screenshots live in ignored `tests/results/`. `python tools/build-config.py` synchronizes JSON tuning changes (the JS copy was updated by hand this pass and the regression suite confirms the two match). No test tooling or build step is needed to play or deploy.

## Limits

The video comparison sampled the knife, rifle, handgun, driving and knockdown sequences rather than every frame. This is a fan-game approximation of selected arcade mechanics, not a frame-perfect emulator. The knife stab reuses the punch frames with the knife held forward because the atlas has no dedicated stab record; the knifer's knockdown uses his kneeling frame because the atlas has no lying frame for him. The continue screen is single-player: the INSERT COIN / JOIN-IN slots are decorative. Full-campaign timing is for Easy; Normal and Mania were exercised by the suites but not given a complete human balance pass. Physical phones/controllers, Safari and Firefox were not tested. Local checks and a GitHub push do not establish a successful Vercel production deployment.
