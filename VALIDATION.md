# Validation — October 4, 2026

Tested in Chromium on Windows. **114 browser checks passed (51 campaign/audio checks and 63 armed-action/movement checks), with no uncaught runtime exceptions.**

The latest checks exercise every combination of four heroes and six firearms at point-blank range, checking exact projectile damage and ammo without added melee damage. They also check empty-weapon behavior, cancellation of a queued punch on pickup, targets behind the hero, held double-tap running, four distinct dash states, Thornmaw's live retreat, the Crown Engine phase and its announced spillway surge. Gun grips, running attacks and the floodgate boss were visually inspected.

Campaign/audio coverage: four heroes; supplied stage music, pause/mute, boss-intro-to-loop transitions; melee timing/direction; pistol ammo and lanes; shotgun spread; Uzi bursts; rifle penetration; rocket splash; grenade flight; special health/weapon drop; knockdowns; jumping; calming dinosaurs; rod breakage; knife stab/throw; attack-button pickup; fourteen weapons; six encounters and boss completion per chapter; final mechanical phase; ending; saved unlocks; Sound Room; metadata/duration for all 27 MP3s; offline launch with music; mobile layout and touch jump.

Transition checks accelerate encounters through test helpers. A separate deterministic playthrough uses normal keyboard movement, attacks, jumps, specials and pickups, without forcing damage or teleporting. It completed all six updated Story chapters and both final boss phases. Its roughly 7-minute total is a test-agent traversal time, not a human campaign-length estimate.

The earlier input pass covered a simulated gamepad alongside keyboard input, gamepad jump, three-life exhaustion, chapter retry and touch attack. The latest regression pass rechecked mobile layout/touch jump, the Sound Room and offline launch. Scenery margins, floor crops and weapon orientation were inspected.

Original ROM hashes are checked before packaging. MP3 and weapon-sheet originals are read-only inputs; delivery copies are separate.

## Reproduce tests

From the repository root:

1. `npm install --prefix tests`
2. `npm exec --prefix tests -- playwright install chromium`
3. In another terminal: `python -m http.server 8766 --bind 127.0.0.1`
4. `node tests/regression.cjs`
5. `node tests/bot.cjs`
6. `node tests/armed-actions.cjs`

Reports and screenshots go to ignored `tests/results/`. Test dependencies are optional; play and deployment require no installation or build.

## Limits

Automated completion does not prove ideal balance or replace human playtesting. The campaign remains short. Full Arcade-difficulty completion and physical controllers were not tested. Chromium was tested; Firefox, Safari and physical phones were not individually tested. Phone/touch and controllers were simulated. Local validation and a GitHub push do not establish a successful Vercel deployment.
