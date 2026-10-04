# Gameplay video review

Reference: the user-supplied `YTDown.com_YouTube_Media_Inhoeri2BQc_Cadillacs-Dinosaurs-Arcade-all-boss-fights_001_1080p.mp4`. The file is a 15:43 boss-fight montage, 1440 × 1080 at 60 fps. It was read locally and is not included in the repository or deployment.

The review sampled the montage at roughly 30-second intervals and examined short motion sequences near 00:37, 06:19 and 14:27. This was a sampled review, not a claim that every video frame was watched.

## Observations used

- Around 00:37, Mustapha fires a handgun with a planted stance, separate recoil and decreasing ammunition. His fist does not also strike during the shot.
- Around 06:19, melee impacts lead into recognizable hit reactions and knockdowns.
- Around 14:27, running, jumping and a horizontal flying attack have different silhouettes. The ground shadow preserves the landing position during airborne motion.
- Across the sampled fights, bosses commit to recognizable actions with intervals for the player to respond.

## Reproduced in the previous build

The video provided the behavioral reference. These defects were reproduced separately in this browser game's engine:

| Scenario | Before | After |
|---|---|---|
| Fire while holding lane-down for eight 16 ms ticks | Hero slid 14.75 px | Feet stay planted |
| Fire above a grounded enemy's head | Enemy lost 32 health | Shot misses |
| Uzi fire interrupted by a heavy hit | All three queued rounds still appeared | Already-fired round continues; remaining rounds are cancelled and ammo retained in the dropped gun |
| Special against an invulnerable enemy | Hero lost eight health | No health cost without a successful hit |

Additional fixes include continuous contact checks during a dash, one hit per target per dash, nearest-first swept bullet collision, crate obstruction, separate knockdown/rise states, cleanup of defeated boss hazards, input reset on pause and a fixed 60 Hz simulation. Holding attack and then pressing jump no longer accidentally triggers a special; deliberately tapping both together still does.

## Sequel direction

The heroes, ordinary enemies, supplied weapon sheet and 27 unique supplied music tracks are preserved. The harbor warning network, cargo recovery, sonic-lure rescue, pressure valves, radio tuning and final spillway operation are new playable tasks. The story follows the original escape, then introduces Sable's water blockade and the refuge called Last Eden. It does not replay the first game's stage sequence or resurrect Fessenden.

This is a new browser engine informed by the reference. The review does not establish frame-perfect animation, every original action, or the absence of every possible glitch.
