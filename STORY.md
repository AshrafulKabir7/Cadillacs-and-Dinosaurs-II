# The Crown Tide: story bible

Cadillacs & Dinosaurs II · The Crown Tide is an unofficial fan sequel to Capcom's 1993 arcade game. This file is the canonical story of the game as built. It follows the user's revised storyline of 24 October 2026 (`work/story3/STORYLINE.md`, revision 3). `campaign.js`, `mission-data.js`, `BOSS_DEFS` in `enemy-kinds.js`, the stage recipes in `tools/re/levels/ch1..ch8.json` and the tests all follow it.

The title screen, the page title and the staff roll read CADILLACS & DINOSAURS II · THE CROWN TIDE. Stage 1's card opens on the caption **EAST COAST — SIX MONTHS LATER**. 1993 is the original game's release year, not the year its events take place.

## Where the first game ended

Jack Tenrec, Hannah Dundee, Mustapha Cairo and Mess O'Bradovich fought their way from the Black Marketeers' poaching network to Dr. Simon Fessenden's experiments. Morgan became Morgue, Tyrog took human hosts, and Fessenden mutated into ever more monstrous forms before he fell. His laboratory exploded. Hannah fell during the escape and Jack turned back for her. Mustapha and Mess got outside and thought their friends were lost, until Jack and Hannah caught up in the Cadillac and the four headed home.

That victory is real. **Fessenden is dead and his main laboratory stays destroyed.** Nobody resurrects him, nobody reveals a hidden master behind him, and nothing claims his experiments created the world's dinosaurs.

## Premise

For six months the surviving Black Marketeers scatter into small gangs. Jack repairs the garage, Mustapha gets the Cadillac running properly, Hannah helps the settlements talk to each other again, and Mess turns up now and then with recovered supplies and an explanation nobody believes.

Beyond the old hunting grounds, someone is buying abandoned cages, recruiting former poachers and paying well for living dinosaurs. **Sable**, once a regional transport commander of the Black Marketeers (not the hidden mastermind of the first game), takes the title **Marshal**, dresses his men as a protective militia and promises to defend the settlements from dinosaur attacks. His scouts provoke the attacks; his uniforms then sell the protection, take the roads and recruit frightened people into his workforce.

Sable also bought an outlying research workshop that received samples and partial records before Fessenden's last battle. **Dr. Echo** worked there. She has spent six months adapting the incomplete experiments, and her hybrids are unstable, expensive and hard to keep alive. That is why Sable needs animals, equipment, workers and power. He runs his operation from an old hydroelectric dam above **Crown Valley**: its workshops make his machinery, its turbines power Echo's wards and its high roads overlook the valley's settlements and breeding grounds.

**The Crown Tide** is his planned mass capture. His men have blocked a diversion channel, built holding pens on the ridges and fenced the last migration routes. When the reservoir is full he will release a surge into the lowlands. The flood drives the surviving dinosaurs onto the fenced high ground and the people below the dam onto his roads, where his guards offer shelter for obedience and labor. He is willing to sacrifice anyone who cannot escape the water.

The heroes' job is concrete: stop the capture operation, free its prisoners, destroy the mutant production and prevent the deliberate flood.

### Rules the game makes true

1. **The first victory matters.** The Sink is a limited flooded salvage area at the edge of the ruins; it never drowned the coast.
2. **The new villains own their actions.** Sable did not cause the first game; Echo is not Fessenden, his clone or his ghost.
3. **Dinosaurs are animals.** They panic, bite anyone close, flee or ignore people. In play a beaten raptor runs off; no dinosaur serves anyone, and breaking a restraint never makes one loyal.
4. **Devices have limited jobs.** Radios communicate, prods hurt, collars restrain, support rigs keep damaged bodies going. Echo's observatory dishes coordinate guards and equipment; no signal controls minds.
5. **Mutation has consequences.** Ironclub, Glassback and Crownback do not turn back into people when beaten. The surviving subjects get care, not a cure.
6. **No clones.** There is no mirror fighter and there are no cloned heroes in tanks.
7. **One dam, one valley.** The stakes are a valley and the people and animals in it.
8. **Arcade rhythm.** Human gangs dominate the first half; the second half reveals the experiments.

## Cast

The heroes are the original arcade sprites with their original moves. The chosen hero fights on screen; the radio tells what the rest of the gang is doing, and all four appear together in the cutscenes.

| Hero | Role |
|---|---|
| Jack Tenrec | Mechanic, fighter and the one who reads animal behavior. Drives the Cadillac. "Same cages. New paint." "It was here first." |
| Hannah Dundee | Fighter, investigator and diplomat. Reads the manifests, turns the valley's residents against the racket, takes the dam plans, calls the gate sequence. |
| Mustapha Cairo | Fast fighter and engineer. Fixed the brakes; reads gauges and tells; disengages the release mechanism and repairs the governor. |
| Mess O'Bradovich | Powerful fighter with blunt humor, protective of the captive workers. Cranks the winches; holds the diversion gear. |

| Villain | Who | Stage |
|---|---|---|
| **Warden Rook** | Human jailer and dock commander with a boat hook and chain. | boss 1 |
| **Headkeeper Thorne** | Human hunter and animal handler: red braid, goggles, a long electric prod, bait for the raptors. Escapes into the river. | boss 2 |
| **Haulmaster Krag** | Human convoy commander with a chain round his fist. | boss 3 |
| **Foreman Cinder** | Salvage foreman in a powered rig; overloads it into Overdrive. | boss 4 |
| **Ironclub** | Sable's shock captain, a willing, paid subject of Echo's treatment: plated, club-tailed, cooling harness. | boss 5 |
| **Glassback** | Thorne after the treatment she took to win back Sable's favor; the support harness on her spine fails into a final rush. | boss 6 |
| **Dr. Echo / Echo Engine** | The workshop researcher who kept going after every failure; protects herself inside a maintenance walker. | boss 7 |
| **Marshal Sable / Crownback** | The marshal, pistol and powered shoulder brace over a voluntary graft; takes the unfinished treatment and becomes a single-headed, shield-armed armored hybrid. Falls into the discharge works. | boss 8 |

Elites (mid-bosses): the Frightened Raptor and the Barge Bosun (1), the Camp Handler (2), the Convoy Outrider (3), the Brood Mother (4), the Scout Captain (5), the Ward Orderly (6), Echo's Bodyguard (7), the Gate Captain and the Crown Sergeant (8). Stage 8's regulars are Sable's **Crown Guard**.

## Opening

Jack's garage, late afternoon. The Cadillac's hood is up, Mustapha is under it, Mess is eating the lunch that was meant to be shared, Hannah is back with news. A battered supply truck swerves into the yard and its driver staggers out with a broken iron restraint: "They're taking them alive now. City docks. They took the people who tried to stop them, too." Jack finds an old Black Marketeer stamp under a freshly painted crown, and the truck's radio announces Marshal Sable's men are protecting the coast from dangerous animals. "Same cages. New paint." "Good thing I fixed the brakes." "Good thing I finished lunch." (The attract story, `EDEN_INTRO`.)

## The eight stages

Each stage is three areas, six sections and twelve or thirteen locked fights, with a three-task objective, an elite and a boss, and plays in about four minutes. Internal ids stay `ch1`..`ch8`.

| St | Stage · subtitle | Route (areas) | Objective | Boss |
|---|---|---|---|---|
| 1 | City in the Sea · Old Trouble | the waterfront / the cargo sheds / the prison quay | FREE THE DOCKWORKERS (three barge locks) | Warden Rook |
| 2 | The Swamp Forest · Stolen Nests | the old hunting grounds / the river traps / the loading camp | WRECK THE RESTRAINT GEAR (prod rack, collar crates, tranquilizer station) | Headkeeper Thorne |
| 3 | The Coral Causeway · Run Them Down | the causeway (drive) / the bridge checkpoint / the bridge (drive) | STOP THE CONVOY (two cargo trailers, the checkpoint winch) | Haulmaster Krag |
| 4 | The Sink · What Was Left Behind | the Sink / the service tunnel / the flooded chambers | FREE THE WORKERS (three shaft winches) | Foreman Cinder → Overdrive |
| 5 | Crown Valley · The Protection Racket | the dry river crossing / the abandoned farms / the town square | OPEN THE BARRIERS (farm road, evacuation road, town square) | Ironclub |
| 6 | The Verdant Biodome · The Price of Power | the glass perimeter / the treatment wards / the test enclosure | SHUT THE TREATMENT WARDS (three treatment feeds) | Glassback |
| 7 | The Observatory · Echoes of Fessenden | the cliff road / the relay station / the research archive | SEIZE THE DAM PLANS (wreck three relay masts) | Dr. Echo → Echo Engine |
| 8 | The Crown Dam · No One Owns the Valley | the turbine galleries / the maintenance lifts / the gatehouse | REACH THE GATEHOUSE (two lift controls, the gatehouse door) | Marshal Sable → Crownback |

### Stage 1 · City in the Sea · Old Trouble

A roundup on the waterfront: uniformed guards load fishermen and dockworkers onto a prison barge under official signs, with the old gang's weapons, stolen goods and dinosaur cages behind them. In the fish market a frightened raptor breaks loose and bites anyone close (the Frightened Raptor elite); beaten, its restraints break and it runs. The Barge Bosun carries the barge keys. Rook holds the prison quay with his boat hook and chain while cargo swings overhead (the crane) and the tide comes over the quay. Beaten, he is held, and the workers open the barge themselves. A freed mechanic knows the cages: capture-camp gear from the northern wetlands. "You think you've beaten the hunters? You've only missed the shipment."

### Stage 2 · The Swamp Forest · Stolen Nests

The old hunting grounds have fewer carcasses and more cages: egg baskets, tranquilizer gear, transport pens, and dead animals in the broken traps. Thorne's handlers use bait, electric prods and restraint collars; the raptors in the waves are hurt, frightened animals, and they run when beaten. Handlers beat a raptor on the trap line (the Naguri vignette). On the loading platform Thorne fights with her prod and staff and lobs bait that draws two raptors in; her COLLAR WINCH (the boss task) holds the camp's restraints, and smashing it breaks her advantage. Beaten, she goes off the collapsing platform into the river and escapes to a launch downstream, shouting for another chance. Beside a broken nest the gang frees a scarred young raptor that snaps at them and runs. Hannah finds the convoy's shipping tags and refrigerated containers with a laboratory mark Jack remembers. "Keep those containers closed."

### Stage 3 · The Coral Causeway · Run Them Down

The Cadillac chases the convoy across a highway exposed at low tide: bikers on both sides, cargo falling from the trailers, pteranodons, and a huge animal crossing the flooded road that both the car and the convoy swerve around. Ram the two cargo trailers loose, take the bridge checkpoint on foot and crank its winch, and run down Krag's armored hauler. At the hauler's lock the convoy halts and Krag fights on foot with his chain, his crew jumping down to help. Inside the hauler: living animals, medical supplies, old specimen containers. Sable on the convoy radio: "You destroyed a laboratory, Tenrec. Did you think the trade would disappear with it?" The transport map points to a salvage crew at the edge of the old laboratory ruins.

### Stage 4 · The Sink · What Was Left Behind

The campaign's one deliberate return. The Sink is a locally flooded excavation at the ruined complex; the lower laboratory is gone. In the damaged service tunnel Hannah remembers the escape ("I remember the way out. Let's make sure they use it."), and the gang breaks the shaft winches that keep captive workers in an unstable shaft. Cinder's crews strip generators, refrigeration and lifting gear; a Brood Mother lives in the flooded chambers. Cinder fights in his powered rig, overloads it into Overdrive when its armor breaks, and surrenders beside the wreck. His manifests show research and specimens went to an outlying workshop before the first game's last battle, with today's orders signed by Echo and paid for by Sable. Mustapha disables the machinery and Hannah takes the service maps. "We finished this place once. We're finishing the scavengers this time."

### Stage 5 · Crown Valley · The Protection Racket

The maintenance route comes out in a valley being reshaped for the Crown Tide: fences across the animal trails, starved channels, guards funnelling residents to fenced camps. Scouts drive raptors at the farmhouses and the militia arrives to sell protection; the Scout Captain flees when beaten. Hannah shows the residents the manifests, and they start opening their own barriers. Sable sends Ironclub, his shock captain, who sheds his outer armor at the start of the fight (a placeholder for a later armored-captain art step) and fights plated, curling into a rolling ball and venting his cooling harness. Beaten, he stays as he is. The captive technicians explain the dam: a release that drives animals and people uphill onto Sable's ridges. "He's building the cage before he starts the stampede." The families head west for an unfenced ridge; the gang goes upstream to the biodome.

### Stage 6 · The Verdant Biodome · The Price of Power

A ruined botanical complex turned into a prison for animals and people: adults chained beside stolen eggs, treatment wards, failed trials, a few completed hybrids. Some subjects were coerced, others volunteered; the graft subjects in the waves are the ones defending the operation. Shut the three treatment feeds, beat the Ward Orderly and open the occupied cells. In the test enclosure Thorne's voice comes first ("I asked her to make me faster than anything I ever hunted."), then Glassback: lean, scaled, hooked claws, a support harness along her spine, the red braid and broken goggles. At 35 % the harness splits and her final rush begins. Beaten, she stays Glassback. The survivors go to a separate ward with its own emergency power; the gang destroys the cultures and production gear; Hannah keeps the records. The schedule says the Crown Tide starts at dawn, run from Echo's observatory.

### Stage 7 · The Observatory · Echoes of Fessenden

Short-range radios, facility controls and Echo's remaining research. The dishes coordinate guards and equipment; wrecking the three relay masts leaves her patrols without orders. Fessenden's records are archived files, not a living mind. Echo's Bodyguard holds the radio room. Echo meets the gang in the control gallery ("He proved a body could change. I can make it endure." "Ask the people downstairs what they think of your improvement."), then boards the Echo Engine, a maintenance walker with hydraulic grippers, cutters and armor. Beaten, she tries to bargain; Hannah takes the dam plans and leaves her to the freed workers' guards. Mustapha finds the remote line dead. "You have my workshops. You have my doctor. I still have the gates."

### Stage 8 · The Crown Dam · No One Owns the Valley

Rain over the dam, the evacuation lights below, the reservoir dangerously high. The Crown Guard and a few completed hybrids hold the turbine galleries and the maintenance platforms in small, readable waves (no pylons, no freed conscripts, no gate-controls phase, no spillway minigame, no clones). Run the two lift controls, beat the Gate Captain (who drops the lift keys and runs) and the Crown Sergeant, open the gatehouse door and reach the dam crest. Sable fights with his pistol and his braced arm. Beaten, Mustapha disengages the mechanism set for a sudden release ("Release mechanism's off!"), and Sable takes the concentrated treatment Echo warned him was never finished: "If you won't kneel to the marshal, kneel to this!" CROWNBACK, single-headed and shield-armed, with the torn coat, the broken brace and the scarred face still his, fights on the crest; as his plates break he loses his guard. The fight is won by fighting: no flood helps. Beaten, he lunges for the gate mechanism, the gantry and his body fail together, and he falls into the discharge works. No survival tease.

## Finale and ending

The ending cut-scene (`EDEN_ENDING`):

1. **fall**: Crownback lies in the discharge works. HANNAH: "He went for the gates. The gantry gave way."
2. **alarm**: the reservoir is still too high, and blowing the dam would deliver the disaster Sable wanted.
3. **roles**: Jack restarts the old diesel backup, Mustapha repairs the release governor, Mess clears the jammed diversion mechanism and holds it, Hannah confirms the evacuation road is clear and calls the sequence. Water fills the diversion route and the gates open gradually; the Crown Tide never reaches the valley.
4. **run**: the crest walkway gives way behind them as **all four** run for the Cadillac together.
5. **board**: MUSTAPHA: "Everybody in. I'm not running home again." JACK: "Nobody's walking."
6. **dawn**: first light over the valley.
7. **road**: the holding pens come down, the animals are released, the dam goes to the people who run it. On the road home the scarred young raptor from the swamp watches the car from the verge and disappears into the green. A large dinosaur steps onto the road and Jack stops and waits. MESS: "We beat the whole gang, and we're still stuck in traffic?" JACK: "It was here first." The Cadillac rolls on with all four aboard; nobody runs after it.
8. **thanks**: the staff roll, then the final card: **THE ROAD GOES ON · THANK YOU FOR PLAYING · A FAN SEQUEL MADE FOR MOSTAFA**.

Echo and the captured officers face the communities they imprisoned. The records survive as evidence; the cultures and production equipment do not. The injured subjects stay in care.

## Still to come (later steps)

- **Painted backgrounds** for all 24 areas replace the ROM-cell placeholder scenery (`paint` areas in the stage builder). Today's recipes reuse older compositions: stage 2 uses the old biodome jungle, stage 5 the harbor streets, stage 6 the biodome, stage 8 the old spire / dam areas.
- **Three new general enemies**: the Crown Militiaman (stages 1, 5, 7, 8), the Trapper (2, 6) and the Hybrid Enforcer (6, 7, 8). The sections that will carry them are marked with a `todo` field in `campaign.js`.
- **Boss art**: Ironclub's armored first phase (he sheds it at the start of his fight), Sable's heavy blade swing, Thorne's bait throw pose.
