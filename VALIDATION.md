# Validation

Validated in Chromium on Windows on October 1, 2026.

## Campaign and gameplay

27 browser integration checks passed with no uncaught browser errors. They covered selection of all four hero buttons, character/difficulty selection, melee damage, special health cost and cooldown, jump physics, destructible crates and gun ammunition, airborne dodging, pause/resume, Cadillac movement and boost, all four encounters and boss completion in each of the six chapters, inter-chapter story scenes, the final boss's second phase, the ending, chapter unlocks and persistence after reload.

Campaign transition checks deliberately accelerated encounter completion to verify progression independently of combat balance. A separate automated playthrough used regular keyboard movement, attacks, jumps, specials and pickups without teleporting or forcing enemy damage. It completed all six chapters in Story mode, including both final boss forms. This uncovered a final-boss arena boundary problem; the boundary was corrected and the playthrough completed after the fix. Boss wind-ups are preserved under normal hits so they can execute their attacks during combat.

Additional input checks covered coexistence of keyboard and a connected gamepad, a simulated gamepad jump, three-life exhaustion, chapter retry, visibility of touch controls and a touch attack.

## Loading and layout

The game was launched through both a localhost server and a direct `file://` URL. Direct offline loading passed. Screenshots of the title, hero selection, gameplay and all six boss environments were reviewed. A 390-pixel phone layout and touch-device layout were checked. Hero selection was adjusted to keep the start button visible on the smaller screen.

The original arcade file hashes were checked again before packaging. The supplied ROM folder remained unchanged.

## Limits

Automated play verifies that the campaign can be completed; it does not replace human testing for enjoyment or fine balancing. The delivered campaign is intentionally short. Story-mode progression was played through automatically. Arcade selection and its changed statistics were checked, but a full Arcade playthrough was not performed. Physical gamepad hardware was not available; its mappings were tested with a simulated controller. Chromium was used for testing; other current browsers were not individually tested. Saving depends on the browser allowing local storage.
