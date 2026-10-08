# Handling review — October 8, 2026

Sources: the boss-fight video at 03:28–03:46 (1440 × 1080, 60 fps) and the full playthrough's highway stage at roughly 05:45–07:15 (640 × 360, 30 fps), sampled at one and ten frames per second. This pass compared the Cadillac section and the hero's basic movement with the game, not every frame of either video.

| Observation in the arcade | Found in this game | Implemented consequence |
|---|---|---|
| The car keeps rolling the whole time: the desert, cacti and rocks stream past under it even while riders fight alongside, and the car itself holds a lane position rather than sliding to the edge of the screen. | The car auto-advanced at a fixed speed into the right edge of the locked screen and sat there with its nose cut off; the road stood still during fights. | Velocity-based handling with throttle, brake, coast and a standstill while locked; the scenery scrolls at road speed throughout driving sections; the whole car always stays on screen. |
| Riders pull up beside the car at motorcycle speed, ride level with it, then swing in or shoot; a beaten bike leaves a fireball. | Riders behaved like foot gunners: slow approach, standing off at long range, no swerve, no explosion. | Rider speed 150, alongside range, alternating shoot / swerve, explosion on defeat; foot gunners in driving sections ride instead. |
| Rammed enemies are flung away in one impact; the car bounces. | Contact dealt a stream of small hits every tick. | One impact per contact scaled by speed, with a bounce and shake. |
| Walking and running are perfectly even at the cabinet's 59.6 Hz. | On this 72 Hz / 141 Hz machine the fixed 60 Hz accumulator skipped one update every few frames (measured walk deltas 3,3,3,3,3,0 px). | Variable-step simulation; measured deltas are now uniform at every refresh rate. |

# Latest reference verification — October 5, 2026

Source: the user-supplied `YTDown.com_YouTube_Media_VQtsqjuc0kA_Cadillacs-And-Dinosaurs-ARCADE-2-players-60FPS_004_360p (1).mp4`. Media probing reports **640×360, 30 fps, 46:15.063**; the filename's 60FPS label is not the actual stream rate.

Sampled the opening selection frames (00:00–00:03) and two-second sequences at 00:39, 00:47, 05:27, 10:00 and 13:48 at six samples per second. This is a review of those sequences, not a claim to have watched every frame of the 46-minute video. Native selection screens were also captured directly from the supplied ROM in MAME for all four heroes.

| Observation | Implemented consequence |
|---|---|
| Four large portraits in Jack/Hannah/Mustapha/Mess order, with lower Power/Speed/Skill diamonds | Use original captured art and ratings. Preserve the portrait band and selected stat panel; put free-play difficulty controls in the unused join-in space. |
| Horizontal gun carry while moving/running | Replace upright running carry with horizontal two-handed torso over moving legs. |
| Firing stance, directional muzzle, lower weapon/ammo display | Match sockets across pose, gun, projectile and flash; add lower icon/ammo panel and small backward recoil. |
| Red directional hit sprays | Knife and firearm impacts emit red pixel sprays on biological targets. |
| Bright explosion frames followed by expanding smoke | Keep the supplied fiery frames and add smoke, fragments and shake. |

At 00:47 Hannah is largely carrying the M16 and jumping; Mustapha fires in the nearby sequence. The reference supports the carrying poses, but does not independently prove every hero/weapon/state combination or every proposed tuning number. Those combinations are tested in the browser and remain fan-game approximations. New scenery and boss concepts are designed for this sequel; the previous game's stages are not reused as its campaign.

The following section records the earlier video review and its historical findings. Where it describes upright running carry or the repeated Fessenden beast, the latest implementation above and `docs/COMBAT-DESIGN.md` supersede it.

---

# Gameplay video review

Reference: the user-supplied `YTDown.com_YouTube_Media_Inhoeri2BQc_Cadillacs-Dinosaurs-Arcade-all-boss-fights_001_1080p.mp4`. The file is a 15:43 boss-fight montage, 1440 × 1080 at 60 fps. It was read locally and is not included in the repository or deployment.

All passes sampled the video; none claims that every frame was watched.

## Arcade feel pass

Contact sheets every 3 seconds, then 8–30 fps sequences, were compared with this game. Mustapha's on-screen poses were matched to decoded ROM frame records by palette-snapped pixel comparison at arcade resolution (scores are the share of sprite pixels that agree).

| Time | Matched records | What it showed |
|---|---|---|
| 79.37–80.30 | 228 → 229 (held 0.33 s), 231 → 232, 235 → 236 (held 0.27 s) → 237 → 238, all 0.89–0.93 | The ground combo is punch, punch, kick, finisher. The striking frame is held while the victim shakes: long hitstop is the core of the “smash” feel. |
| 264.0, 269.75–270.0 | 259 stance, 260 firing (0.87–0.88) | A rifle is held level at the hip with both hands; firing uses a separate recoil frame. |
| 256.5–258.2 | torso 284 (0.75) | Walking with a rifle uses a torso sprite drawn over the separate walking legs. |
| 266.6, 268.4–269.0 | run legs 209–212 with torso 288 (0.84–0.87) | Running with a rifle: running legs, leaning torso, rifle upright against the chest. |
| 107.5, 109.0 | walk 179, stance 256 (0.95–0.96) | A handgun stays in the hand on the ordinary walk; standing uses the handgun stance. |
| 76–77, 79–81, 180–186 | — | Grabbed enemies are kneed and thrown; knocked-down enemies fly back in an arc, bounce and lie down; hits show a yellow starburst, gun hits a “POW!”. |

Sound effects were identified by normalised cross-correlation of each supplied sample with the video audio: 0066 (car-stage explosions, up to 0.61), 0068 (rifle shot, 0.52), 0076 (pistol hit with POW, 0.64), 0085 (Uzi bursts, 0.41–0.44), 0072 (bodies landing, 56 matches), 007E (aligned with the finishing kick at 80.01 s). 0064, a short impact thump, is used for light punches; that choice is by sound shape rather than a strong match.

Defects found by this comparison and fixed:

| Before | After |
|---|---|
| Every press played all eight attack frames (punches and kicks together) in 0.3 s | One move per press: punch, punch, kick, finisher, each with its own frames and timing |
| 0.035 s global freeze per hit | Attacker and victim hold the impact frame 0.10 s (0.16 s for finishers); the victim shakes |
| Knockdowns teleported the enemy back and laid it down | Flung in an arc, one bounce, slide, lie, get up; defeated enemies are flung before fading |
| No grabs or throws | Grab by walking in; knees; over-the-shoulder and forward throws that bowl over others |
| Long guns held on composite poses at weapon scale 1.12 | Arcade hip stance, torso-over-legs walking and upright carry, at the hero's scale |
| Hurt frames were an idle frame (Mustapha), a fragment (Hannah) and a special-move frame (Mess) | Original hurt, flung, lying and get-up records for every hero |

## Fessenden's Legacy pass

A contact sheet every 15 seconds located the relevant sections, then single frames were examined.

| Time | Observation | Used for |
|---|---|---|
| 03:28–03:46 | The Cadillac is a long, low steel-blue convertible with tailfins, a rolled cream top behind the seats, chrome side trim, a dark lower body, a skirted rear wheel and a large front wheel; the hero drives with head and shoulders visible behind a wraparound windscreen. | The redrawn Cadillac replaces a generic green sedan. |
| 01:44–01:50 | A handgun is carried in one hand at the side, or raised beside the shoulder. | Pistols stay in the hand; firing still uses the aiming pose. |
| 04:14–04:44 | A rifle is held level at the hip in both hands while walking and standing; it is fired from the hip. | Armed walking, running and jumping poses. |
| 14:00–15:20 | Fessenden's final form is a pink tyrannosaur-shaped monster. | The Chapter 3 copy of the beast and the story's link to the serum. |

Defects reproduced in the previous build of this game, then fixed:

| Scenario | Before | After |
|---|---|---|
| Running (all heroes) | Run frames anchored at different body points: the hero jumped 30–60 source pixels per frame | One hip anchor for every run and walk frame; frames follow distance |
| Walking with a gun | Full walking stride with the gun floating near the hip, angled down | Aiming torso over walking legs; gun level in both hands |
| Running with a rifle | Walking frames sped up, rifle floating and pointing at the ground | Aiming torso over running legs |
| Picking up a weapon | Instant swap from up to 58 px away, with no animation | Short crouch, only when standing on the weapon |
| Mustapha's jump | Torch-holding frame, then a legs-only fragment | Clean airborne and crouch frames |
| A poacher firing | Attack frames were a triceratops and a doubled sprite | Aiming frame with a muzzle flash |
| Encounter start | Enemies appeared in the middle of the screen | Screen locks; enemies enter from beyond the edges or drop from above |
| Chapter length | About one minute for the test player | 7.2–8.2 minutes for the test player |

## Earlier pass

The earlier review sampled at roughly 30-second intervals and examined short motion sequences near 00:37, 06:19 and 14:27.

- Around 00:37, Mustapha fires a handgun with a planted stance, separate recoil and decreasing ammunition. His fist does not also strike during the shot.
- Around 06:19, melee impacts lead into recognizable hit reactions and knockdowns.
- Around 14:27, running, jumping and a horizontal flying attack have different silhouettes. The ground shadow preserves the landing position during airborne motion.
- Across the sampled fights, bosses commit to recognizable actions with intervals for the player to respond.

| Scenario | Before | After |
|---|---|---|
| Fire while holding lane-down for eight 16 ms ticks | Hero slid 14.75 px | Feet stay planted |
| Fire above a grounded enemy's head | Enemy lost 32 health | Shot misses |
| Uzi fire interrupted by a heavy hit | All three queued rounds still appeared | Already-fired round continues; remaining rounds are cancelled and ammo retained in the dropped gun |
| Special against an invulnerable enemy | Hero lost eight health | No health cost without a successful hit |

This is a new browser engine informed by the reference. The review does not establish frame-perfect animation, every original action, or the absence of every possible glitch.
