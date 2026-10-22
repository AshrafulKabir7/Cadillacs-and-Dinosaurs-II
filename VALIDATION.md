# Validation — October 22, 2026: the game rebuilt on the 1993 ROM data (steps G0–G8)

The game was rebuilt in nine sequential steps on art and data read from the arcade ROM (the plan is `work/re/design/PLAN.md`; each step's report is `work/re/impl/G*/REPORT.json`). Every step left `index.html` playable over http and from `file://`, with every suite green. This section is the state after the last step, G8 (legacy art retired, budgets enforced, balance pass).

## Suites (G8, Chromium headless on Windows 11, Node 22)

Over http (`node tools/serve.cjs 8766`, `node tools/re/run-suites.cjs --step G8`): **all 15 game suites pass**, plus the `file://` launch. Checks per suite: armed-actions 71, combat 29, polish 47, regression 53, sequel 37, specification 126, story 64, mobile 69, framing 19, enemies 44, campaign 44 (2 warnings: six source ranges framed on their own floor, three pieces over two floor runs, both handled by the builder), ui 100, rom-heroes 51 (1 skip: the retired `arcade-heroes.js` comparison), assets 24, perf 6 (with the baseline). No page errors.

From `file://` (`GAME_URL=file:///…/index.html`): every browser suite passes. Rows that cannot run there are environment skips, never failures: the five http-only pixel rows of `framing` and the radio-strip pixel row of `polish` (stage pages taint the canvas under `file://`, so `getImageData` throws), and the served-over-http half of combat's sound-effect row (`fetch` of a local file fails; the files are checked on disk instead). The Node-only suites (campaign, ui, assets) do not depend on the URL.

`rom-heroes` (8) is a wall-clock gate on the colouriser (at most 5 ms per Mpx). It is load-sensitive: on a busy machine it reads 6–10 ms/Mpx and passes on a retry. `run-suites.cjs --retries 2` records every attempt.

| Step | What landed | Last recorded runner result (`tests/results/suites-<step>.json`) |
|---|---|---|
| G0 | Node config builder, test helpers, run-suites harness | 16/16 |
| G1 | arcade framing: 768 × 448 canvas at 2×, arcade px units, camera, HUD rects | 16/16 |
| G2 | the ROM-built stages, parallax, fg pass, walk band, areas and fades, the driving loop | 14/15 in that file (rom-heroes' timing gate); the step's report has it green on a rerun |
| G3a–G3d | HeroRig on the ROM records: holds, timing, weapons, effects | all green |
| G4 | the enemy driver on `ENEMY_KINDS` | 14/15 in that file (assets); the step's report lists every suite green after its fix rounds |
| G5a–G5f | the bosses on `BOSS_DEFS`, from Rook to LOT 00 and Mack | all green |
| G6 | the campaign, cards, intermissions, captions, tally, attract, ending | 15/16 in that file (rom-heroes' timing gate); green on a rerun per the report |
| G7 | the cabinet HUD in the ROM font, continue screen, boss card | 16/16 |
| G8 | legacy art retired, asset gate, perf baseline, balance pass | 18/18 (the 15 game suites plus the three online co-op suites another workflow added in parallel), file:// ok |

## Full-campaign bot (`node tests/bot.cjs`: Easy, hero 0 = Mustapha, dt 0.033, seed 15454)

Simulated seconds per chapter (window 150–300 s; the user's target for a person is four to five minutes, and the bot is quicker than a person):

| Step | Ch1 | Ch2 | Ch3 | Ch4 | Ch5 | Ch6 | Lives lost |
|---|---:|---:|---:|---:|---:|---:|---|
| G0 | 208 | 169 | 213 | 214 | 211 | 261 | 1 (ch6) |
| G1 | 195 | 159 | 194 | 196 | 198 | 243 | 0 |
| G2 | 199 | 151 | 189 | 193 | 198 | 236 | 0 |
| G3a | 195 | 154 | 192 | 201 | 199 | 238 | 0 |
| G3c | 232 | 160 | 221 | 227 | 238 | 289 | 0 |
| G3d | 224 | 169 | 224 | 229 | 240 | 293 | 0 |
| G4 | 202 | 184 | 185 | 210 | 233 | 257 | 0 |
| G5 (a–f) | 197–200 | 184–190 | 190–205 | 210–219 | 216–222 | 265–274 | 0–1 |
| G6 | 200 | 185 | 190 | 210 | 218 | 265 | 1 (ch6) |
| G7 | 200 | 185 | 190 | 210 | 218 | 265 | 1 (ch6) |
| G8 cleanup only | 200 | 185 | 190 | 210 | 218 | 265 | 1 (ch6) |
| G8 + ROM walk speeds | 215 | 193 | 213 | 248 | 253 | 283 | 1 (ch6) |
| G8 + ROM walk + boss damage 1.0 | 215 | 196 | 209 | 241 | 250 | 281 | 1 (ch6) |
| **G8 final** (+ ch2 O12 bikers) | **215** | **217** | **214** | **231** | **237** | **279** | 1 (ch6) |

The G8 balance pass took three levers, measured one at a time with the bot: the heroes walk and run at the ROM's own speeds (`combat-config.json` `romWalk`, HEROES O1 / PLAN RC6: Mustapha 133 → 102 px/s walking, 58 px/s in depth, 204 px/s running), boss damage goes from 0.8 to the full CAMPAIGN numbers (`ENEMY_KINDS.K.BOSS_DMG` 1.0), and chapter 2 gets CAMPAIGN option O12, four extra two-bike waves (346 → 354 regular wave slots). Every chapter stays in the window; five of six now land in the 3.5–4.5 minute band the user asked the bot to aim at. Runs are in `tests/results/bot-G*.json` and `work/re/impl/G8/`.

## Visual checks (`node tools/re/compare-frames.cjs`, G8)

All 23 scenes of `tests/fixtures/visual-scenes.json` report **ok** (0 early, 0 skipped, 0 failed): hero idle and bbox height 79 (s01), every hero weapon hold against MAME snapshots and the videos (s02–s06, overlay fit 0.95–0.96 on the MAME frames), the knockdown sequence (s07), the brute's walk and charge and the knifer's knife (s08, s09), the four reference stages (s10–s13), every boss beside the hero with its ROM height ratio (s20–s26, e.g. Regent 1.684, LOT 00 1.639 against the ROM's 1.633), the top HUD and the continue screen (s30, s31; every HUD element within 0 px of the cabinet), and the card and panels (s40). Sheets and the report are in `work/re/impl/G8/visual/`.

G8 also checked its own drawing changes pixel for pixel: the ROM-font lines drawn from cached strips equal glyph-by-glyph drawing in six HUD states (0 px differ), the freed clones' cropped, cached gold outline equals the old full-scratch outline in 64 poses (0 px differ), and the items, hit spark, POW! and the hurled gun now draw from the ROM fx sheet (`work/re/impl/G8/shots/`).

## Budgets (`node tests/assets.cjs`, enforced from G8)

| Item | Budget | G8 |
|---|---|---|
| Eager download, non-audio (19 scripts + CSS) | ≤ 3.5 MB (3,670,016 bytes) | 3.500 MB (3,669,793 bytes; 223 bytes to spare) |
| `sprite-data-heroes.js` / `-fx` / `-enemies` / `-bosses` / `-ui` | 0.9 / 0.35 / 1.1 / 1.5 / 0.15 MB | 0.641 / 0.280 / 1.027 / 0.698 / 0.125 MB |
| `stage-data.js` | ≤ 0.15 MB | 0.063 MB |
| Stage pages | ≤ 1.0 MB per chapter, ≤ 5 MB in all, each ≤ 1024² | 140 pages, 1.389 MB in all |
| Any shipped file | ≤ 1.5 MB | largest `sprite-data-enemies.js` 1.03 MB |
| Tracked files | ≤ 2 MB outside `assets/audio`, no `.bin`/`.zip` | ok (the 12–22 MB legacy art is deleted) |

Before G8 the eager download was 12.9 MB (`sequel-art.js` alone 7.8 MB); at the start of the rebuild it was about 21.7 MB.

**Performance** (`node tests/perf.cjs`: the chapter 6 clone war with 8 fighters, LOT 00 and 6 freed allies, 300 step+render frames): mean render 3.4 ms, p95 8.9 ms, at most 64 `drawImage` calls a frame (limits 8 ms, 16 ms, 150). Before G8 it was 16 ms, 33 ms and 199. Two changes did it: the ROM-font text is drawn one cached strip per line instead of one glyph at a time, and each freed clone's gold outline is built once per pose and kept, instead of re-stamping one shared scratch canvas five times per ally per frame. The baseline is `tests/results/perf-baseline.json` (local and ignored: timings are per machine); with it the suite gates on the limits and on 1.5× the baseline mean, taking the best of up to three fresh-page runs.

## Reproduce

```text
node tools/serve.cjs 8766
$env:GAME_URL='http://127.0.0.1:8766'; node tools/re/run-suites.cjs --step G8 --retries 2
$env:GAME_URL='file:///E:/mostafa/Cadillacs-and-Dinosaurs-II/index.html'; node tests/sequel.cjs
$env:GAME_URL='http://127.0.0.1:8766'; node tests/bot.cjs
node tests/assets.cjs
node tools/re/compare-frames.cjs --out work/re/visual
```

Install the test dependencies once with `npm install` inside `tests/` and `npx playwright install chromium`. The bot takes about ten minutes. Reports go to the ignored `tests/results/`.

---

The sections below are the record from before the rebuild (October 8). Their commands and file names are superseded by the ones above.

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
