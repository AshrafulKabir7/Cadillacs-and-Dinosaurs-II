# Combat implementation and tuning

The executable configuration is `combat-config.json`. Run `python tools/build-config.py` after editing it; this regenerates `combat-config.js` for offline `file://` play. The browser regression checks compare both versions. No network fetch or production build is required.

## Firearm state machine (Prompt A)

| State / input | Animation and behavior |
|---|---|
| Unarmed + attack | Original punch → punch → kick → finisher; a missed hit resets the chain. |
| Pick up | Crouch, cancel pending punches, attach the weapon midway through the crouch. |
| Armed idle | `gunStand` for shotgun/rifle/Uzi/M16/bazooka; `pistolStand` for the handgun. |
| Walk / run | Horizontal grip from `torsoWalk`, over the original `legsWalk` / `legsRun`; handgun torso from `pistolStand`. No upright gun sprite on a run. |
| Jump | Original airborne legs with an armed torso, raised by physical jump height. |
| Attack with ammo | `attackKind = fire`; fire a projectile, consume one round, recoil backwards, flash at the barrel, eject a casing where appropriate. Movement input is locked for the firing action. Airborne shots retain height and cannot hit underneath the hero. |
| Burst | Uzi/M16 emit up to three rounds at 85 ms spacing. Each round spends ammunition and applies recoil. Hits, specials, changing weapons or running out of ammo cancel remaining rounds. |
| Recovery | Return from `gunFire`/`pistolFire` to the ready pose; never queue an unarmed punch. |
| Empty | Keep the empty gun and display 00 SHOTS. Attack never silently becomes a punch. E/PICK throws it or swaps it for a nearby pickup. |
| Heavy hit / special | Drop the weapon with its remaining ammunition; cancel burst and attack. |

Sprites face left in the source atlas. Each frame stores `hand: [x,y]` relative to its feet. At runtime: `handX = playerX + (-x + offsetX) * scale * facing`; `handY = playerY - jumpZ + (y + offsetY) * scale`. Scale is 1.35. The weapon uses its own sheet orientation exactly once; the source gun sprite is not assumed to face the same way as the hero. State offsets are explicit in `sockets` (zero by default, because the recovered frame hand coordinates supply the per-hero offset).

| Hero | Long ready | Long fire | Moving two-handed torso | Pistol ready | Pistol fire |
|---|---|---|---|---|---|
| Mustapha | -40, -66 | -32, -66 | -32, -59 | -17, -65 | -24, -63 |
| Jack | -28, -64 | -37, -65 | -39, -55 | -28, -64 | -37, -65 |
| Hannah | -31, -48 | -29, -48 | -28, -54 | -27, -63 | -44, -55 |
| Mess | -56, -60 | -40, -60 | -30, -55 | -34, -53 | -55, -60 |

The projectile and muzzle flash share the firing socket. Barrel reach is `spriteWidth * (1 - grip) * scale`, added in the facing direction. Render the torso and weapon first, then projectiles and flashes; each hero remains sorted by ground lane. Muzzle flashes alternate small amber/white pixel polygons. Casings eject from a separate offset near the receiver, arc, bounce once and fade. The revolver and launcher do not eject automatic-weapon casings. Recoil is an actual 1.5–7 pixel backward move per round, clamped inside the arena. The lower-left HUD displays the original weapon icon, name and remaining shots/hits, below radio messages.

| Class | Weapons | Grip | Recoil per round | Casing |
|---|---|---|---|---|
| Handgun / Magnum | GUN (six-shot revolver) | .35 | 2 px | No |
| Shotgun / rifle | SHOTGUN, RIFLE | .68 | 5 px | Yes |
| Automatic | UZI, M16 | .68 | 1.5 px | Yes |
| Launcher | BAZOOKA | .68 | 7 px | No |

Existing ammunition caps stay six for gun/shotgun/rifle, 48 Uzi, 60 M16, four bazooka. There is no separate Magnum pickup. The four classes organize the existing six firearm types.

## Combat FX and difficulty (Prompt C)

Knife cuts and firearm impacts on living targets emit red pixel sprays in the impact direction. A normal punch produces an impact starburst. Mechanical targets produce sparks, and defeated clones retain their green dissolution. Blood settles briefly on the floor; explosions use the supplied fiery frames plus rising, expanding smoke and fragments. Effects expire, with a global cap of 420 particles. The JSON contains color palettes, particle counts, gravity, lifetimes, rage timing and explosion shake.

Difficulty applies at the start of a run and persists in section checkpoints. Legacy `story` saves map to Easy; `arcade` maps to Arcade Mania. Old save keys and hero indices remain compatible.

| Parameter | Easy | Normal | Arcade Mania |
|---|---:|---:|---:|
| Player health | 1.4 | 1 | 1 |
| Enemy / boss health | 0.84 | 1 | 1.2 |
| Damage taken | 0.7 | 1 | 1 |
| Enemy movement speed | 0.93 | 1 | 1.14 |
| Decision timer speed | 0.85 | 1 | 1.35 |
| Recovery duration | 1.12 | 1 | 0.8 |
| Boss decision/recovery tempo | 1 | 1 | 1.3 |
| Crowd limit | 5 | 7 | 10 |
| Simultaneous attack slots | 2 | 3 | 5 |
| Food drop chance | 0.36 | 0.22 | 0.1 |
| Food-container payout chance | 1 | 0.8 | 0.45 |
| Melee pickup durability | 1.25 | 1 | 0.8 |
| Flanking chance | 0.25 | 0.65 | 1 |

Values modifying health/speed/duration/durability are multipliers; probabilities are 0–1. Standard down recovery is 0.8 seconds (48 frames at 60 Hz), before the tier multiplier; elite recovery is 0.55 seconds. Boss windup/landing durations remain readable and synchronized with hazard markers; Mania accelerates decisions and recovery rather than desynchronizing those markers.

Enemies beyond the crowd cap wait outside the visible arena. They enter as a slot opens; queued enemies still belong to the encounter and cannot be damaged or omitted from its completion condition. Easy restricts simultaneous attackers to two. Mania adds an enemy to each wave, lets five enemies prepare attacks together, and routes flankers around the player's occupied front to attack from behind. On Mania, wounded dinosaurs below half health announce RAGE for 0.7 seconds before gaining 1.38× movement speed and 1.25× melee/charge damage for four seconds, with a nine-second retrigger cooldown. Easy and Normal do not activate rage. Burgers, BBQ and steaks all restore 45 health; stage-start food remains guaranteed. Melee durability scales only on fresh pickups, so dropping/recollecting a weapon cannot refill it.

## Verification

`node tests/specification.cjs` covers original selection art/order, all difficulty choices and persistence, configuration sync, firearm ammo caps, recovery and boss timing, queued reinforcements, flanking, rage warnings, both facing directions for every hero and firearm class, casing rules, directional blood, explosion cleanup and offline scenery loading. Existing suites exercise every weapon, every chapter, bosses, objectives, supplied audio, touch and fullscreen. See `VALIDATION.md` for results and limits.
