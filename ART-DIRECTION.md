# Art direction

Since the rebuild on the 1993 ROM data (steps G0–G8), the sequel draws only the arcade's own art. Nothing on screen is generated imagery: the heroes, enemies, bosses, weapons, items, effects, the Cadillac, the stages, the fonts and the HUD are read from the ROM and recomposed. What is new is the arrangement (stage layouts, palettes, story), never the drawing. The rules below keep it looking like the cabinet and keep it a sequel rather than a replay.

## Framing

- The view is the cabinet's 384 × 224 screen. One world unit is one arcade pixel; the canvas is 768 × 448 and every pass draws through one 2× transform, so sprites and stage pixels are exactly 2 × 2 canvas pixels.
- The picture is shown at the arcade monitor's 4:3 by default; the Sound Room switches to square pixels (12:7). The switch is CSS only.
- Sprites are drawn at one arcade pixel per art pixel, feet on their ROM origin, with no smoothing, no CSS filters and no recolouring by pixel reads: every colour change is a palette map over slot-indexed sheets (`sprites.js`), the way the hardware reloads its palette slots.
- The HUD, the boss cards, the chapter cards, the intermission panels and the stage-clear tally use the ROM fonts at the cabinet's coordinates; the top bar matches a cabinet frame within 0 px per element.
- Fades are 16 brightness steps, flashes additive rects; the screen pass (HUD) never shakes, because the cabinet's scroll1 HUD never moves.

## Stage palettes

Stage pages are composed from the arcade's tiles and recoloured with palette operations on the 12-bit palette words, never on pixels; results are quantised back to 4 bits per channel, so they stay in the arcade's colour space. The operations are `borrow` (a row from another stage or area), `hsl`, `tint`, and the presets `night`, `fire`, `flood`, `lab` and `ruin` (`tools/re/build/palettes.cjs`; ARCHITECTURE §3.4). The presets are tuned by eye against the videos; they are not ROM facts.

## New villains from old bodies

A sequel villain is an original body with a new palette, the way the arcade itself made Walther from Vice T.'s body. A boss palette is accepted only when (ENEMIES §6.1):

1. every colour comes from a ROM palette row (`tools/re/build/palette-pick.cjs` lists the rows whose ramp fits a slot);
2. the new clothing slots differ from every original palette of that body in at least 6 of 16 pens;
3. skin, outline and eye pens are unchanged.

The contact sheet `work/re/pack/boss-palettes.png` shows each original next to its new palette, for the user to judge. A copy that keeps its own name (LOT 07 · Heavy, LOT 00 · Fessenden) keeps its home colours.

## Originality gates (the sequel rule)

`node tools/re/build-game-assets.cjs check` fails a stage when (ARCHITECTURE §3.7, §3.8):

- a verbatim run (consecutive columns from consecutive source columns of one original area, identity palette, no patches) is longer than 512 px;
- an original area has more than 60 % of its columns used anywhere in the sequel (a warning above 35 %);
- a boss-lock window comes from an original boss segment window;
- a return visit (chapter 4's Sink areas, the Under World six months after the blast) does not recolour every slice, patch at least 25 % of its cells and change the camera, lock and exit layout.

Seams, walkability, the test-safe start of chapter 1, the budgets and determinism are gated too. Each chapter's review sheet (`node tools/re/build-game-assets.cjs review ch<N>`) shows the areas at 1× with seams, bands, locks, the priority pixels and the camera path; they were shown to the user before all six chapters were switched on.

## What is still drawn in code

The mission objects that have no identified ROM record (cold pods, valves, tuners, pylons, beacons, the spillway gate and wheels, chains, cargo), the shadows, the world labels and the easy-mode tells. They are drawn small, in arcade proportions, and are listed in `ROM_FX.notes.props`.

## History

The generated scenery and the generated boss sprites of the October 5 version, with their exact prompts, are recorded in [docs/ART-DIRECTION.md](docs/ART-DIRECTION.md). Those files were retired in G8 (see [SOURCE-NOTES.md](SOURCE-NOTES.md)); git history keeps them.
