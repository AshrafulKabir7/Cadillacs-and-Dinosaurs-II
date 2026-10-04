# Validation — October 4, 2026

Tested in Chromium on Windows. **51 browser checks passed with no uncaught runtime exceptions.**

Coverage: four heroes; supplied stage music, pause/mute, boss-intro-to-loop transitions; melee timing/direction; pistol ammo and lanes; shotgun spread; Uzi bursts; rifle penetration; rocket splash; grenade flight; special health/weapon drop; knockdowns; jumping; calming dinosaurs; rod breakage; knife stab/throw; attack-button pickup; fourteen weapons; six encounters and boss completion per chapter; final transformation; ending; saved unlocks; Sound Room; metadata/duration for all 27 MP3s; offline launch with music; mobile layout and touch jump.

Transition checks accelerate encounters through test helpers. A separate playthrough uses normal keyboard movement, attacks, jumps, specials and pickups, without forcing damage or teleporting. It completed all six Story chapters and both final boss forms. It caught a Cadillac reverse-movement problem, which was corrected.

Additional input checks cover a simulated gamepad alongside keyboard input, gamepad jump, three-life exhaustion, chapter retry and touch attack. Gameplay, bosses, the transformed final boss, Sound Room and a 390-pixel touch viewport were visually inspected. Scenery margins and weapon orientation were corrected.

Original ROM hashes are checked before packaging. MP3 and weapon-sheet originals are read-only inputs; delivery copies are separate.

## Reproduce tests

From the repository root:

1. `npm install --prefix tests`
2. `npm exec --prefix tests -- playwright install chromium`
3. In another terminal: `python -m http.server 8766 --bind 127.0.0.1`
4. `node tests/regression.cjs`
5. `node tests/bot.cjs`

Reports and screenshots go to ignored `tests/results/`. Test dependencies are optional; play and deployment require no installation or build.

## Limits

Automated completion does not prove ideal balance or replace human playtesting. The campaign remains short. Full Arcade-difficulty completion and physical controllers were not tested. Chromium was tested; Firefox, Safari and physical phones were not individually tested. Phone/touch and controllers were simulated. Local validation and a GitHub push do not establish a successful Vercel deployment.
