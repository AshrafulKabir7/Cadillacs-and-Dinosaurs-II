# Runtime memory map tools (original Cadillacs & Dinosaurs, MAME `dino`)

Research tooling only. Nothing here ships with the game. Outputs go to the git-ignored `work/re/runtime/` and
`work/re/runs/`; save states go to `E:/tools/mame/states/dino/`.

| File | What it does |
|---|---|
| `rt.cjs` | `node tools/re/runtime/rt.cjs <plan.json>`. Same plan format as `tools/re/mame/run.cjs` (which it reuses unchanged), plus `plan.hook` (Lua with `HOOK(n)` / `PEEK(n)`, helpers `rb rw rl wb ww wl HLOG POOL_ALLOC`) and `plan.cheats`. `HLOG` lines go to `hook.jsonl`. MAME write taps work from the hook (`space:install_write_tap`, see `work/re/runtime/plans/bot-s1-tap.json`). |
| `cheats.cjs` | The cheats (Lua generators), see below. |
| `predict.cjs` | Predicts an actor's OBJ blocks from RAM (frame pointer -> ROM record, X, height, depth, facing, camera) and checks them against the dumped OBJ list. `validate(run, addr)` and `validatePool(run, base, n, stride)`. |
| `validate-all.cjs` | Runs `predict` over every per-frame run and writes `work/re/runtime/validation.json`. |
| `anim-check.cjs` | Checks the animation fields (+0x28 pointer, +0x2C..+0x2E frame bytes, +0x2F frames left) against the ROM frames. |
| `structdiff.cjs`, `ramscan.cjs`, `pool.cjs` | RAM-diff helpers: changing words of a struct, rarely-changing/monotone addresses, active slots of a pool. |
| `census.cjs` | Enemy census over the stage states -> `work/re/runtime/enemy-census.json`. |
| `make-runtime-states.cjs` | `armed` (stage1-<hero>-armed-<weapon>, 60 states) and `stages` (stage<N>-<hero>, N = 2..8). Writes `work/re/runtime/states.json`. |
| `memory-map.cjs` | Writes `work/re/runtime/memory-map.json`. |
| `crop.cjs`, `sheet.cjs` | Crop / labelled contact sheets of snapshots. |
| `rea-ev.sh` | Rizin through REA; evidence records in `work/re/runtime/evidence/`. |

## Cheats (`plan.cheats`)

```jsonc
"cheats": [
  {"cheat": "invuln"},                                   // never hit (the game's own +0x00 = 2 / +0xF9 timer)
  {"cheat": "infhp"},                                    // HP refilled every frame (hits still knock you down)
  {"cheat": "lives", "value": 9, "at": 2},
  {"cheat": "score", "value": "0x00123450", "at": 2},     // BCD, HUD refreshed
  {"cheat": "give", "weapon": "rifle", "ammo": 30, "at": 5}, // rifle gun knife uzi m16 shotgun bazooka rod stick bknife club torch dynamite grenade stone
  {"cheat": "warp", "stage": 5},                         // boot plans (coinStart + select inputs): start at EPISODE 5
  {"cheat": "warpLive", "stage": 5, "at": 10},           // from a running stage: intermission, then EPISODE 5
  {"cheat": "warpArea", "area": 2, "at": 10},            // inside the current stage (areas whose first segment has trigger 0)
  {"cheat": "killAll", "at": 200},                       // or {"every": 120, "from": 100}: the game's "ENEMY CLEAR" object
  {"cheat": "freeze", "from": 150, "to": 450}            // enemies frozen (slots restored every frame)
]
```

`give` needs empty hands (it logs an error to `hook.jsonl` otherwise) and presses P1 attack for three frames, three
frames after it spawns the item. Combine `warpLive`/`warp` with `warpArea` (after control returns) for "stage N, area M".

The validated map with its status and evidence per field is `work/re/runtime/memory-map.json` (written by
`memory-map.cjs`); validation totals are in `validation.json`, save states in `states.json`, REA records in `evidence/`.
