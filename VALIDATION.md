# Validation — October 5, 2026

Tested in Chromium on Windows. **150 browser checks passed: 51 campaign/audio checks, 64 armed-action checks and 35 sequel/combat/mobile checks. No uncaught browser exceptions were reported.**

The original hero atlases, regular enemy atlas and soundtrack files have no changes from the preceding revision. The four heroes and their original stats are retained. All 27 unique supplied music tracks still load.

## Latest checks

- Every combination of four heroes and six firearms: point-blank damage, ammo use, firing pose, no extra melee damage, and empty-weapon behavior.
- Planted firing for all heroes, overhead projectile misses, cancellation of interrupted bursts, special health cost only on a successful hit, travelling dash contact and one hit per target.
- Nearest-first projectile collision, crate obstruction, distinct knockdown/rise states, jump while holding attack, pause input cleanup and the existing character-specific dash actions.
- Required objective gating, interact without discarding a held gun, rocket damage to sonic lures, interrupted valve operation, radio tuning, living Thornmaw retreat, both Crown Engine phases and the final manual release.
- Four generated human boss designs load; all six environments were inspected in game. The supplied weapon art and recovered heroes/ordinary enemies remain active.
- Landscape touch controls and the playfield fit an 844 × 390 viewport. Holding the on-screen interact button completes a relay. Touch fullscreen includes the controls. A portrait layout, touch jump and audio are covered by the existing regression suite.
- Local-file launch loads the new embedded artwork and all four new human bosses without a web server. Existing offline soundtrack and Sound Room checks pass.

A separate deterministic player completed **all six Story chapters**, all **20 required mission tasks**, and both final boss phases using movement, attack, jump, special, pickup and interact controls. It uses no teleports, forced damage, health changes or objective-completion helpers. Its traversal time is about six simulated minutes; this is a regression run, not a human campaign-length estimate.

Focused transition tests do use explicit test helpers to set up encounters quickly. The independent player traversal is the check that the normal route remains completable.

## Reference review and source preservation

[VIDEO-REVIEW.md](VIDEO-REVIEW.md) records the sampled video sequences, observations and reproduced defects. The local MP4 was only read and is not distributed. The review was sampled, not frame-by-frame coverage of the entire montage.

Before packaging, SHA-256 checks verify all 23 source ROM files and the 28 supplied MP3 files. The supplied weapon sheet is compared byte for byte. No source asset is overwritten. Two new generated atlases and their exact prompts are documented in [ART-DIRECTION.md](ART-DIRECTION.md).

## Reproduce

From the repository root:

1. `npm install --prefix tests`
2. `npm exec --prefix tests -- playwright install chromium`
3. In another terminal: `python -m http.server 8766 --bind 127.0.0.1`
4. `node tests/regression.cjs`
5. `node tests/armed-actions.cjs`
6. `node tests/sequel.cjs`
7. `node tests/bot.cjs`

Reports and screenshots go to ignored `tests/results/`. Test dependencies are optional; play and deployment need no installation or build. JavaScript syntax and Git whitespace checks also pass.

## Limits

Automated completion does not prove ideal balance or remove the need for human playtesting. The campaign is short. Boss artwork has two generated poses with additional movement in code; this is not a frame-perfect arcade recreation. Full Arcade-difficulty completion, physical controllers, physical phones, Firefox and Safari were not separately tested. Phone input and viewport behavior were simulated in Chromium. Local testing and a GitHub push do not establish a successful Vercel deployment.
