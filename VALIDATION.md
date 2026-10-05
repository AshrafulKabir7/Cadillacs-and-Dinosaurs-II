# Validation — October 5, 2026 (arcade feel update)

Tested in Chromium (Playwright 1.62.1) on Windows. **253 browser checks passed: 35 mobile touch checks, 27 combat/gun/sound checks, 41 story/update checks, 35 sequel/combat/mobile checks, 64 armed-action checks and 51 campaign/audio checks. No uncaught browser exceptions were reported.**

## Chapter length

A separate deterministic player completed **all six Story chapters**, every required objective, every mid-boss and both final boss phases using movement, attack, jump, special, pickup and interact controls. It uses no teleports, forced damage, health changes or completion helpers. `tests/bot.cjs` fails if any chapter clears in under seven simulated minutes.

| Chapter | Simulated time | Deaths |
|---|---|---|
| 1 · The Drowned Harbor | 7.9 min | 0 |
| 2 · The Green Highway | 7.8 min | 1 |
| 3 · The Verdant Basin | 7.3 min | 1 |
| 4 · The Ashen Foundry | 8.6 min | 0 |
| 5 · The Tide Archive | 8.0 min | 1 |
| 6 · The Crown Barrier | 7.8 min | 0 |

The test player fights efficiently, grabs and throws when it walks into enemies, and uses specials whenever two enemies are close, so these times are a lower bound for skilled play rather than an estimate of a typical human run. Timings vary by a few tens of seconds with the random sequence; after grabs and throws made fights quicker, Chapter 2 received five more encounters to stay above seven minutes. Chapter 2 was re-timed after that change; the others were timed just before it with otherwise identical code.2 and 7.7 minutes across runs.

## Mobile touch checks (`tests/mobile.cjs`)

Real touch input is sent through Chromium DevTools touch events on emulated phones at 390×844 (portrait), 844×390 and 667×375 (landscape). For each: menus are tapped through to gameplay; holding the stick walks; sliding the thumb across turns the hero; diagonals move on both axes; the stick rim runs; a second finger attacks while moving; releasing stops the hero; jump works; the playfield and controls fit without scrolling, with a playfield at least 370 px wide and an attack button at least 64 px. The desktop page keeps its layout. Physical phones were not tested.

## Combat, gun and sound checks (`tests/combat.cjs`)

- For all four heroes: the combo runs punch, punch, kick, finisher; hitstop holds attacker and victim together; the finisher sends the enemy flying. A missed blow restarts the combo; ordinary hits do not knock down before the finisher.
- Connecting punches show an impact spark; pistol hits show POW. Knockdowns arc, lie down and rise; defeated enemies are flung before fading.
- Walking into an enemy grabs them; attack knees; back + attack throws over the shoulder; the thrown body knocks down an enemy in its path; bosses cannot be grabbed.
- Mustapha uses arcade records 259/260 for the rifle stance and 284/288 to carry it; long guns use the hip stance, torso-over-legs walk and upright running carry.
- All shipped arcade sound effects load.

## Story and update checks (`tests/story.cjs`)

- Chapter 1 continues from Fessenden's death in the first game; every chapter ending sets up the next; the final chapter is the clone war, and its pylons free four copies.
- Every chapter has six sections, at least sixteen fights, a mid-boss and a boss.
- **Off-screen entrances:** 80+ sampled fresh enemies across all chapters, first waves and reinforcement waves, all start beyond the locked screen edges or above the top edge. Bosses walk in from beyond the right edge; boss reinforcements arrive from both edges. No enemy winds up an attack while still off screen.
- **Running:** every run and walk frame of every hero shares one hip anchor; Shift with only up/down is not a run; running is faster than walking; double-tapping up does not start a run.
- **Weapons:** for all four heroes, picking up a gun is a crouch with the gun arriving mid-crouch, and the gun stays in both hands while walking, running and jumping. Every armed pose has a grip. A weapon out of reach is not grabbed. Mustapha's jump avoids the torch frame and the legs-only fragment. Gunners no longer use the triceratops frame.
- **Cadillac:** Chapter 2 starts in the car with the hero at the wheel, parks for the toll fort and resumes for the convoy boss.
- **Clone war:** freed clones damage a hostile clone without the player; hostile clones damage freed clones; breaking the first pylon frees two copies of the other heroes; a checkpoint after the pylons keeps all four freed clones and the finished objectives.
- **Checkpoints:** entering a section saves it; resuming keeps earlier objectives complete.

## Existing suites (updated for the new layout)

- `tests/regression.cjs`: four heroes, music cues and boss music, melee and weapon behaviour, crouching pickup, every chapter's encounters and boss, campaign end, unlock persistence, Sound Room, all 27 audio files, offline launch and the portrait mobile layout.
- `tests/armed-actions.cjs`: every hero with every firearm (point-blank damage, ammo, firing pose, empty-gun behaviour), pickup during a pending punch, the Fessenden beast copy's sonic-driver retreat, Sable's Crown Engine phase and spillway surge, held running and run attacks.
- `tests/sequel.cjs`: planted firing, overhead misses, burst cancellation, special cost, dash contact, projectile order, crate cover, knockdown/rise, pause input reset, cold pods, sonic lures, valves, radio tuning, the final spillway, boss art loading, landscape touch controls and offline loading.

The fullscreen check now records which element the game asks to make fullscreen (the whole cabinet, so touch controls stay visible). In this environment headless Chromium refused fullscreen whenever a second page was open — the previous version's own test failed the same way — so the check no longer depends on that permission.

## Visual review

Screenshots were inspected for: pickup crouch, armed walking/running for all four heroes, run cycles, enemies entering, the Cadillac with each hero driving, the parked Cadillac, bikers riding and crashing, drop-in entrances, mid-boss intros and health bars, the Mirror Clone, the Fessenden beast copy, the gunner's firing pose, lab clone tanks and the clone war.

## Reproduce

From the repository root:

1. `npm install --prefix tests`
2. `npm exec --prefix tests -- playwright install chromium`
3. In another terminal: `python -m http.server 8766 --bind 127.0.0.1` (any static server works; set `GAME_URL` to use another address)
4. `node tests/mobile.cjs`, `node tests/combat.cjs` and `node tests/story.cjs`
5. `node tests/regression.cjs`
6. `node tests/armed-actions.cjs`
7. `node tests/sequel.cjs`
8. `node tests/bot.cjs` (add a chapter number, 0–5, to time one chapter)

Reports and screenshots go to ignored `tests/results/`. Test dependencies are optional; play and deployment need no installation or build. JavaScript syntax and Git whitespace checks also pass.

## Limits

Automated completion does not prove ideal balance or replace human playtesting, especially for difficulty over a 45-minute campaign. Arcade difficulty was not timed. Mustapha’s armed poses were confirmed against the video; the other heroes’ gun stances and carrying torsos were chosen from their own records by layout order and pose, without video confirmation. Weapon positions use the measured front hand of each frame and can be a few pixels off. Most sound labels are strong matches; the light-punch sound is a best fit by shape. Copies of the heroes reuse hero animation with a colour filter. Physical controllers, physical phones, Firefox and Safari were not separately tested. Local testing does not establish a successful Vercel deployment.
