/* The Crown Tide, revision 3 (work/story3/STORYLINE.md; the canonical story is STORY.md). Six months after Fessenden's
   laboratory was destroyed, the surviving Black Marketeers take dinosaurs alive under Marshal Sable, who dresses his men as
   a protective militia. Eight stages follow his network from the city docks to the Crown dam, where he plans the Crown
   Tide: a deliberate flood that drives the valley's animals and people onto his fenced ridges.
   Eight stages; each has three areas, six sections, 12-13 locked fights, an elite and a boss, and plays in about four
   minutes. Internal ids stay ch1..ch8 (= stages 1..8; STAGE_DATA, tools/re/levels/ch<N>.json). Encounter fields: w =
   reinforcement waves, from = R/L/B (both)/T (drop from above), task = mission task index, elite = mid-boss, say = radio
   line when the fight starts, after = radio line when the elite dies.
   Human gangs dominate the first half; the second half reveals the experiments (graft subjects, TYROG). Dinosaurs are
   animals: a beaten raptor runs off, it never serves anyone. Stage 8's regulars are Sable's Crown Guard (level.guard
   names them on the HUD), in small, readable waves.
   TODO (revision 3, later step): three new general enemies (Crown Militiaman: stages 1, 5, 7, 8; Trapper: 2, 6; Hybrid
   Enforcer: 6, 7, 8, see work/story3/PLAN.md) replace some of the raider / knifer / mutant slots in these waves; the
   sections that will carry them say so in a `todo` field.
   Text is stored in sentence case and drawn in upper case in the ROM 8x16 font. Boss text is data (bossCard, bossToast,
   bossSay, bossLines, bossDefeat, phase2, releaseSay, lastCopy). The field names are the engine's: phase2 is a boss's
   second form (Cinder's Overdrive rig, Echo's walker), lastCopy is CROWNBACK (Sable after the treatment).
   Stage recipes: tools/re/levels/ch<N>.json, shipped as stage-data.js; section.stage is the key. */
window.EDEN_CAMPAIGN = [
 // ---------------------------------------------------------------- stage 1
 {name:'CITY IN THE SEA',area:'01 / OLD TROUBLE',boss:'WARDEN ROOK',kind:'warden',accent:'#8fb3e6',
  objPage:'S1A0',music:{stage:['06','06','07','07','08','08'],intro:'09',boss:'10'},
  card:{pre:'EAST COAST — SIX MONTHS LATER',marker:'wassoon'},
  inter:[
   {layout:'A',pic:'p-barge-fire',lines:['MOVE THEM! THE MARSHAL','WANTS THAT BARGE FULL','BY THE TIDE.']},
   {layout:'B',who:'hannah',lines:['DOCKWORKERS. FISHERMEN.','MY CITY’S PEOPLE, IN','CHAINS.']},
   {layout:'B',who:'mess',lines:['NICE UNIFORMS.','SAME KNIVES AS','LAST YEAR.']},
   {layout:'B',who:'jack',lines:['SAME CAGES, NEW PAINT.','LET’S GO SCRAPE','IT OFF.']}],
  brief:'Six months after Fessenden’s laboratory went up, the City in the Sea wakes to a roundup. Guards with Marshal Sable’s crown on their sleeves are herding fishermen and dockworkers onto a prison barge, under official signs that promise protection from dangerous animals. Behind the signs are the old gang’s weapons, stolen goods and dinosaur cages. Clear the waterfront, break the barge locks and stop Warden Rook, the dock jailer with the boat hook and chain.',
  dialog:'HANNAH: Those are dockworkers on that barge. Fishermen.\nMESS: New uniforms. Same old Black Marketeer knives.\nJACK: Then we start with the man loading the barge.',
  end:'Rook goes down on his own quay, and the workers open the barge themselves. One of them, a mechanic, knows the cages at a glance: capture-camp gear from the northern wetlands, where the old hunting grounds run into the swamp. The animals taken there are not sold in the market. They are moved inland, alive. Rook spits on the planks. “You think you’ve beaten the hunters? You’ve only missed the shipment.” The capture route runs into the swamp forest, and the next load is already moving.',
  bossCard:'DOCK COMMANDER · THE PRISON QUAY',bossToast:'WARDEN ROOK · STAY OFF HIS HOOK',
  bossSay:['ROOK: Protection costs, friend. Today it costs you.','HANNAH: He lowers the hook before he pulls. Change lanes when it drops!'],
  bossTaunt:'ROOK: Nobody leaves my barge!',
  bossLines:{p60:'MUSTAPHA: The tide’s coming over the quay! Watch the front!',p50:'ROOK: Guards! Push them back below deck!',p40:'HANNAH: Cargo’s swinging overhead! Watch for the shadow!',p25:'ROOK: The marshal pays me to keep this quay quiet!'},
  bossDefeat:'ROOK: Beaten the hunters? You’ve only missed the shipment.',
  sections:[
   {name:'THE WATERFRONT',stage:'1-1',cap:'THE WATERFRONT',say:'HANNAH: A roundup on the docks, in uniform. That’s new.',enc:[
     {w:[['raider','militia'],['raider','knifer']]},
     {w:[['knifer','raider'],['gunner','militia','knifer']],from:'L',say:'MUSTAPHA: Behind us! They came over the sea wall!'}]},
   {name:'THE FISH MARKET',stage:'1-2',say:'MESS: Protection notices on every stall. Same crown on every one.',enc:[
     {w:[['knifer','raider'],['raider','gunner','raider']],task:0},
     {w:[['brute','raider'],['knifer','gunner']],from:'L',say:'HANNAH: A raptor broke loose in the market! It bites anyone close!',
      elite:{type:'raptor',name:'FRIGHTENED RAPTOR',hp:300,after:'JACK: Restraints are off. Let it run. It was only scared.'},
      after:'JACK: Restraints are off. Let it run. It was only scared.'}]},
   {name:'THE CARGO SHEDS',stage:'1-3',cap:'THE CARGO SHEDS',say:'MESS: Hooks and chains on every beam. These sheds are a jail.',enc:[
     {w:[['raider','knifer','raider'],['gunner','brute']],from:'T',say:'JACK: Off the shed roofs!'},
     {w:[['raider','knifer'],['gunner','raider']],say:'MESS: The big one’s mine. He’s got the barge keys on his belt!',
      elite:{type:'brute',variant:'blkElmer',name:'BARGE BOSUN',hp:420,after:'JACK: Keys. Now let’s open that barge.'},
      after:'JACK: Keys. Now let’s open that barge.'}]},
   {name:'THE CAGE STACKS',stage:'1-4',say:'HANNAH: Dinosaur cages stacked like crates. The people go in the hold.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider']],task:1},
     {w:[['knifer','gunner','raider'],['brute','knifer']],from:'T',say:'JACK: Up on the cage stacks!'}]},
   {name:'THE PRISON BARGE',stage:'1-5',cap:'THE PRISON QUAY',say:'JACK: The prison barge. They’re pushing the workers below deck.',enc:[
     {w:[['knifer','militia','raider'],['gunner','brute','knifer']],from:'T',say:'HANNAH: They’re dropping off the barge rail!'},
     {w:[['brute','gunner'],['militia','raider','knifer']],task:2}]},
   {name:'THE PRISON QUAY',stage:'1-6',say:'ROOK: Whatever you saw tonight, you didn’t see. Turn around.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider','raider'],['gunner','raider','raider']],from:'B'},
     {boss:true}]}]},

 // ---------------------------------------------------------------- stage 2
 {name:'THE SWAMP FOREST',area:'02 / STOLEN NESTS',boss:'HEADKEEPER THORNE',kind:'thorne',accent:'#accb6d',
  objPage:'S2A0',music:{stage:['13','13','14','14','25','25'],intro:'18',boss:'15'},
  card:{marker:'swamp'},
  inter:[
   {layout:'B',who:'hannah',pic:'p-manifest',lines:['THE CAGES CAME FROM A','CAMP IN THE NORTHERN','WETLANDS.']},
   {layout:'A',pic:'p-hatchling',lines:['EGG BASKETS. COLLARS.','TRANQUILIZER RIFLES.','THEY WANT THEM ALIVE.']},
   {layout:'A',pic:'p-regent-asleep',lines:['BAIT THE TRAILS. THE','HEADKEEPER WANTS EVERY','NEST EMPTY BY DARK.']},
   {layout:'B',who:'jack',lines:['FEWER CARCASSES, MORE','CAGES. THAT ISN’T','KINDER. IT’S BUSINESS.']}],
  brief:'The capture route runs north into the old hunting grounds, where the swamp forest meets the river. The grounds have changed: fewer carcasses, more cages. Headkeeper Thorne runs the camp with bait, electric prods and restraint collars, robbing nests and dragging the animals to a loading platform on the river. Her gear hurts and panics the animals; it gives her no magic hold over the forest. Wreck the restraint gear, free what you can and stop Thorne before the next load ships.',
  dialog:'HANNAH: Egg baskets and collars. This is a live-capture camp.\nMUSTAPHA: Bait buckets on every trail. They lure the animals in.\nJACK: Then we wreck the gear and let them go.',
  end:'Thorne goes off the collapsing platform into the river. By the time the gang reaches the bank she is a shape at a maintenance launch downstream, shouting into a radio for the Crown facility and one more chance. Beside a broken nest the gang frees a scarred young raptor; it snaps at Jack and is gone into the reeds, and nobody expected thanks. In the camp office Hannah finds shipping tags for a convoy already on the coastal causeway. Among the animal cages are refrigerated containers stamped with a laboratory mark Jack remembers from Fessenden’s operation. “Keep those containers closed,” he says.',
  bossCard:'HEADKEEPER OF THE CAPTURE CAMP',bossToast:'HEADKEEPER THORNE · WRECK HER COLLAR WINCH',
  bossSay:['THORNE: You let my stock go? I’ll catch it twice.','JACK: That winch holds every collar in the camp. Smash it!'],
  bossLines:{p66:'MUSTAPHA: She’s throwing bait! Raptors coming in!',p30:'THORNE: The forest isn’t on your side. It isn’t on anyone’s.',driverHit:'HANNAH: The winch is sparking! She’s losing her grip!',leash:'MESS: She won’t leave that winch. Stay wide of it!'},
  driverDeadSay:'HANNAH: The winch is down! The collars are loose! Now finish her!',
  bossDefeat:'THORNE: This isn’t over! The Crown pays for second chances!',
  sections:[
   {name:'THE HUNTING TRAILS',stage:'2-1',cap:'THE OLD HUNTING GROUNDS',say:'MUSTAPHA: The old hunting trails. Fewer bones. More cages.',enc:[
     {w:[['trapper','knifer'],['raider','gunner']]},
     {w:[['raptor','trapper'],['raider','gunner','knifer']],from:'T',say:'HANNAH: A collared raptor! It’s hurt and it’s angry. Careful!'}]},
   {name:'THE SNARE WALK',stage:'2-2',say:'HANNAH: Snares along the river. Dead animals in the broken ones.',enc:[
     {w:[['raider','knifer'],['gunner','raider','knifer']],from:'T',say:'JACK: Trappers in the trees!'},
     {w:[['raptor','raider','raider'],['brute','gunner']],from:'B',set:'naguri-vignette',say:'MESS: They’re beating a raptor! Get ’em off it!'}]},
   {name:'THE NESTING GROUND',stage:'2-3',cap:'THE NESTING GROUND',say:'HANNAH: Empty nests. They carried the eggs off in baskets.',enc:[
     {w:[['raider','raider'],['knifer','gunner','raider']],say:'MUSTAPHA: Every nest picked clean. Not one egg left.'},
     {w:[['raider','knifer']],task:0,say:'MESS: Smash that prod rack! And watch the one with the whip!',
      elite:{type:'brute',variant:'lashT',name:'CAMP HANDLER',hp:420,after:'HANNAH: His whip’s broken. So is his nerve.'},
      after:'HANNAH: His whip’s broken. So is his nerve.'}]},
   {name:'THE COLLAR PENS',stage:'2-4',say:'MUSTAPHA: Pens full of empty collars. They were ready for a whole herd.',enc:[
     {w:[['raptor','gunner','knifer'],['trapper','brute']],task:1},
     {w:[['trapper','raider','raptor'],['gunner','gunner','knifer']],from:'L',say:'MUSTAPHA: Handlers on the bank! They’re driving the pack at us!'}]},
   {name:'THE CAGE ROW',stage:'2-5',cap:'THE LOADING CAMP',say:'JACK: Cage row. Every one of these was a nest this morning.',enc:[
     {w:[['raptor','raider','knifer'],['gunner','brute']],from:'T',say:'MESS: Tranquilizer darts! Keep moving!'},
     {w:[['raptor','raider','gunner'],['brute','raider','knifer']],task:2}]},
   {name:'THE LOADING PLATFORM',stage:'2-6',say:'MUSTAPHA: The loading platform. And that has to be the headkeeper.',enc:[
     {w:[['raider','knifer','gunner'],['brute','raider'],['gunner','knifer','raptor']],from:'B',say:'HANNAH: The handlers are cornered. They’re throwing everything!'},
     {boss:true}]}]},

 // ---------------------------------------------------------------- stage 3
 {name:'THE CORAL CAUSEWAY',area:'03 / RUN THEM DOWN',drive:true,boss:'HAULMASTER KRAG',kind:'truck',accent:'#e8a35a',
  objPage:'S3A0',music:{stage:['16','16','16','22','22','17'],intro:'18',boss:'19'},
  card:{marker:'causeway'},
  inter:[
   {layout:'B',who:'hannah',pic:'p-manifest',lines:['SHIPPING TAGS. A CONVOY','ON THE CAUSEWAY.'],lines2:['THE ROAD ONLY SHOWS','AT LOW TIDE.']},
   {layout:'A',pic:'p-convoy',lines:['KEEP IT MOVING! THE','MARSHAL WANTS IT OVER','THE BRIDGE BY DARK.']},
   {layout:'B',who:'mustapha',lines:['I FIXED THE BRAKES.','DON’T MAKE ME FIX','THEM AGAIN, JACK.']},
   {layout:'B',who:'jack',lines:['EVERYBODY IN THE','CADILLAC. LET’S RUN','THEM DOWN.']}],
  brief:'The convoy from the swamp camp is crossing the Coral Causeway, an old highway the sea gives back only at low tide. Bikers ride escort on both sides, the trailers carry living animals and sealed laboratory containers, and at the far end a bridge checkpoint marks the edge of Sable’s protected territory. The Cadillac is back on the road. Knock the cargo trailers loose, open the checkpoint and stop Haulmaster Krag, who rides the last armored hauler with a chain round his fist.',
  dialog:'JACK: A road under the sea. Let’s hope she stays dry.\nMESS: Krag rides the last hauler. Nobody gets past that chain.\nHANNAH: The tide turns soon. Drive, Jack!',
  end:'Krag goes down on the wet road and stays down, and the gang boards his hauler. Inside are living animals, medical supplies and old specimen containers: some shipments are older than Fessenden’s defeat, others were collected last week to grow the new operation. Then the convoy radio clicks, and a calm, dry voice speaks. “You destroyed a laboratory, Tenrec. Did you think the trade would disappear with it?” Marshal Sable. The transport map in the cab shows one last salvage crew at the edge of the old laboratory ruins, with machinery and access plans for a service route into Crown Valley.',
  bossCard:'HAULMASTER OF THE CONVOY',bossToast:'HAULMASTER KRAG · CHANGE LANES WHEN THE CHAIN WINDS UP',
  bossSay:['KRAG: End of the road, Tenrec. Everybody out of the car.','MESS: That chain covers a whole lane. Step out of line when he winds up!'],
  bossLines:{p66:'MUSTAPHA: He drops his guard after a charge!',p50:'KRAG: Crew! Off the hauler and on them!',p33:'HANNAH: He’s slowing down. Keep him swinging!'},
  bossDefeat:'KRAG: All right! The marshal pays by the load. Go ask him.',
  sections:[
   {name:'THE COASTAL HIGHWAY',stage:'3-1',cap:'THE CORAL CAUSEWAY',drive:true,say:'JACK: Tide’s out for an hour. Hang on to something.',enc:[
     {w:[['biker','biker'],['biker','gunner','biker']],from:'L',say:'MESS: Bikes on the causeway behind us!'},
     {w:[['biker','biker','biker'],['biker','biker'],['biker','biker']],from:'B',say:'MUSTAPHA: More bikes in the mirror!'}]},
   {name:'THE TIDAL ROAD',stage:'3-2',cap:'THE LOW-TIDE CAUSEWAY',drive:true,say:'HANNAH: Those ruts are a heavy hauler’s. Ram the trailers loose, Jack!',enc:[
     {w:[['biker','biker','biker'],['biker','biker'],['biker','biker']],from:'B',say:'MUSTAPHA: Pteranodons! Keep your heads down!'},
     {w:[['biker','biker'],['biker','gunner','biker'],['biker','biker']],task:0,say:'MESS: Cargo’s falling off the trailers. Watch the road!'}]},
   {name:'THE MOVING CONVOY',stage:'3-3',drive:true,say:'MUSTAPHA: Something huge is crossing the flooded road! Swerve!',enc:[
     {w:[['biker','biker','biker'],['biker','gunner'],['biker','biker']],from:'B',task:1},
     {w:[['biker','biker']],say:'JACK: That’s the escort boss. Knock him off and the trucks slow!',
      elite:{type:'biker',variant:'jump',name:'CONVOY OUTRIDER',hp:380,after:'HANNAH: The convoy’s stopping at the bridge checkpoint!'},
      after:'HANNAH: The convoy’s stopping at the bridge checkpoint!'}]},
   {name:'THE SMASHED TOLLS',stage:'3-4',cap:'THE BRIDGE CHECKPOINT',say:'JACK: Everybody out. The checkpoint comes down on foot.',enc:[
     {w:[['raider','knifer'],['gunner','raider','brute']],from:'T',say:'MESS: Off the checkpoint wall!'},
     {w:[['knifer','raider','brute'],['gunner','gunner']],from:'L',say:'HANNAH: Sable’s crown on the barrier. This is his territory now.'}]},
   {name:'THE CHECKPOINT WINCH',stage:'3-5',say:'MESS: The winch is on that gantry. Cover me while I crank it!',enc:[
     {w:[['gunner','raider','knifer'],['brute','gunner']],task:2},
     {w:[['raider','raider','knifer'],['brute','knifer','gunner']],from:'B',say:'MESS: Barrier’s up! More of them coming over it!'},
     {w:[['raider','knifer'],['gunner','raider']],from:'R',say:'MUSTAPHA: One more crew, then the bridge. Krag’s up there!'}]},
   {name:'THE ARMORED HAULER',stage:'3-6',say:'JACK: That’s Krag’s hauler, parked. He’s on the bridge. On foot, go!',enc:[
     {w:[['biker','biker','biker'],['biker','gunner'],['biker','biker','gunner']],from:'B'},
     {boss:true}]}]},

 // ---------------------------------------------------------------- stage 4
 {name:'THE SINK',area:'04 / WHAT WAS LEFT BEHIND',boss:'FOREMAN CINDER',kind:'cinder',accent:'#5fc4b0',
  objPage:'S8A1',music:{stage:['30','30','29','29','20','20'],intro:'23',boss:'24'},
  card:{marker:'city-in-the-sea'},
  inter:[
   {layout:'A',pic:'p-sink-night',lines:['THE SINK. A FLOODED DIG','AT THE EDGE OF','FESSENDEN’S RUINS.']},
   {layout:'A',pic:'p-salvage-boats',lines:['STRIP THE GENERATORS.','THE MARSHAL PAYS','BY THE TON.']},
   {layout:'B',who:'mess',lines:['I SAID I’D NEVER','COME BACK HERE.']},
   {layout:'B',who:'jack',lines:['THE LAB STAYS DEAD.','WE’RE HERE FOR THE','SCAVENGERS.']}],
  brief:'The salvage crew works the Sink, a locally flooded excavation at the edge of the ruined laboratory complex. The lower laboratory is gone and stays gone; what is left are the perimeter chambers, and Foreman Cinder’s crews are stripping them of generators, refrigeration units and lifting gear, with captive workers forced down an unstable shaft to do the heavy lifting. Break the shaft winches, get the workers out and stop Cinder in his powered salvage rig.',
  dialog:'MESS: I said I’d never come back here.\nHANNAH: Pumps, and a pile driver hammering the rock below.\nJACK: The lab stays dead. We’re here for the scavengers.',
  end:'The overloaded rig cracks open, Cinder climbs out of the wreck with his hands up, and the gang gets the last workers up the ladders before the damaged shaft folds in behind them. The manifests in his site office say what the salvage was for: before Fessenden’s last battle, selected research and specimens were shipped to an outlying workshop, and the current orders are signed by Dr. Echo and paid for by Marshal Sable. Mustapha disables the salvage machinery, and Hannah takes the service maps, a maintenance route that comes out below the Crown dam. “We finished this place once,” Mess says. “We’re finishing the scavengers this time.”',
  bossCard:'SALVAGE FOREMAN · THE SINK',bossToast:'FOREMAN CINDER · WATCH HIS GAUGE',
  bossSay:['CINDER: You let my labor go? Then I’ll drive you into the rock.','MUSTAPHA: When he lifts that driver, jump the shockwave!'],
  bossLines:{p50:'CINDER: Pumps! Flood the chamber!',p25:'CINDER: The marshal pays by the ton. You’re costing me a fortune!'},
  bossDefeat:'CINDER: Enough! The rig’s gone… I’ll talk. Get me out of the water.',
  phase2:{card:'OVERDRIVE CINDER · THE RIG AT FULL PRESSURE',toast:'CINDER OVERLOADS HIS RIG',say:'CINDER: Helmet down. Pressure up. Let’s see you dig through this.',lines:{p66:'MUSTAPHA: Red gauge on his arm! Get out of his lane!',p33:'HANNAH: The hydraulics are failing. Hit him when the arm sticks!'}},
  sections:[
   {name:'THE RUINED FOUNDATIONS',stage:'4-1',cap:'THE SINK',say:'MUSTAPHA: A salvage yard on top of the old foundations.',enc:[
     {w:[['raider','brute'],['knifer','raider','gunner']]},
     {w:[['brute','raider'],['raider','gunner','raider']],from:'T',say:'JACK: Salvage crews on the ropes. Heads up!'}]},
   {name:'THE SERVICE TUNNEL',stage:'4-2',say:'HANNAH: They’re stripping the old tunnel for parts, not for Fessenden.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider']],task:0},
     {w:[['gunner','gunner','raider'],['raider','knifer','raider']],from:'B',say:'MESS: They’ve got workers hauling crates in chains!'}]},
   {name:'THE LOADING CHAMBERS',stage:'4-3',cap:'THE FLOODED CHAMBERS',say:'JACK: These old chambers, Hannah. You all right?',enc:[
     {w:[['raider','knifer','gunner'],['brute','raider']],from:'T',say:'HANNAH: I remember the way out. Let’s make sure they use it.'},
     {w:[['gunner','raider']],say:'MESS: The water’s moving. Something big lives down here now.',
      elite:{type:'regent',variant:'tyrog',palette:'t10-e6a2-pal29',name:'BROOD MOTHER',hp:460,after:'JACK: She’s gone back under. Nobody follow her.'},
      after:'JACK: She’s gone back under. Nobody follow her.'}]},
   {name:'THE SLUICE ROOM',stage:'4-4',say:'HANNAH: Chains on the wall, and the crews on the winches. Free them.',enc:[
     {w:[['knifer','gunner','raider'],['brute','raider']],task:1},
     {w:[['raider','raider','knifer'],['gunner','brute','raider']],from:'T',say:'MUSTAPHA: Bombers on the scaffold!'}]},
   {name:'THE SHAFT HEAD',stage:'4-5',cap:'THE SALVAGE SHAFT',say:'JACK: Rig-sized footprints. They’re sending people down that shaft.',enc:[
     {w:[['mutant','raider','gunner'],['brute','knifer']],from:'L',say:'MESS: Scales on that one. Something they dug out of the old tanks!'},
     {w:[['brute','gunner','knifer'],['mutant','raider','raider']],task:2}]},
   {name:'THE SALVAGE SHAFT',stage:'4-6',say:'CINDER: I drive piles for a living. Rock, steel, heroes. Same price.',enc:[
     {w:[['brute','raider','gunner'],['mutant','knifer','raider'],['mutant','knifer','raider']],from:'B',say:'HANNAH: The shaft is cracking. We get the workers out first!'},
     {boss:true}]}]},

 // ---------------------------------------------------------------- stage 5
 {name:'CROWN VALLEY',area:'05 / THE PROTECTION RACKET',boss:'IRONCLUB',kind:'ironclub',accent:'#d9b36a',
  objPage:'S1A0',music:{stage:['25','25','21','21','07','07'],intro:'09',boss:'10'},
  card:{marker:'valley'},
  inter:[
   {layout:'A',pic:'p-crown-dam',lines:['CROWN VALLEY. THE DAM','ABOVE, THE RIVER','STARVED BELOW.']},
   {layout:'A',pic:'p-sable',lines:['THE MILITIA WILL KEEP','YOU SAFE. BRING YOUR','WEAPONS, YOUR FOOD,','YOUR WORKERS.']},
   {layout:'B',who:'hannah',lines:['THE SCOUTS DRIVE THE','ANIMALS AT THE HOMES.','THEN THE UNIFORMS','COME.']},
   {layout:'B',who:'mustapha',lines:['SAME OUTFIT, SAME','CAGES. LET’S SHOW','THEM THE MANIFESTS.']}],
  brief:'The maintenance route comes out in Crown Valley, below the dam, and the valley is already being reshaped for something. Fences cut across the animal trails, the downstream channels run dry, and guards funnel the residents toward fenced camps on the high ground. At the settlements the gang sees the protection racket from both sides: scouts drive frightened dinosaurs at the homes, then the uniforms arrive to take weapons, supplies and workers in exchange for safety. Open the barriers, get the families out and face the captain Sable sends to crush them.',
  dialog:'HANNAH: Scouts drive the animals in. Then the uniforms sell protection.\nMESS: And the fences go where the animals used to walk.\nJACK: Let’s open those barriers.',
  end:'Ironclub crashes through the last barrier he was sent to hold and does not get up. The captain took Echo’s treatment willingly, for pay and promotion, and the plates do not come off now that he has lost. The captive technicians he guarded explain the dam: this was never about rationing water. A large release will drive the valley’s animals and its people uphill onto Sable’s fenced ridges. “He’s building the cage before he starts the stampede,” Hannah says. The technicians name the facility that supplies the hybrids, the Verdant Biodome up the service road, and while the freed families set out west for a ridge without fences, the gang heads upstream.',
  bossCard:'SABLE’S SHOCK CAPTAIN',bossToast:'IRONCLUB · JUMP HIS STOMPING CHARGE',
  bossSay:['IRONCLUB: The marshal said this town would be loud. Let’s make it short.','HANNAH: That armour’s bolted onto him. Crack it open!'],
  bossLines:{p66:'MUSTAPHA: He drops his head before he charges. Get out of his lane!',p33:'JACK: The armour’s splitting! Keep hitting!'},
  phase2:{card:'IRONCLUB · THE TREATMENT UNLEASHED',toast:'IRONCLUB SHEDS HIS ARMOUR',say:'IRONCLUB: Plates off. Now you see what the marshal paid for.',lines:{p66:'HANNAH: A club for a tail! He took the treatment willingly!',p50:'MUSTAPHA: When he curls up, step aside. Hit him as he opens!',p33:'JACK: That cooling harness is steaming. He can’t keep this up!',p20:'MESS: The plates are cracking. Finish it!'}},
  bossDefeat:'IRONCLUB: They promised… the plates… would make me unbeatable…',
  sections:[
   {name:'THE DRY RIVER',stage:'5-1',cap:'THE DRY RIVER CROSSING',say:'MUSTAPHA: A dry riverbed. Somebody upstream turned the water off.',enc:[
     {w:[['militia','raider'],['raider','knifer']]},
     {w:[['knifer','militia'],['gunner','raider','militia']],from:'L',say:'JACK: Militia on the bank behind us!'}]},
   {name:'THE FENCE LINE',stage:'5-2',cap:'THE ABANDONED FARMS',say:'HANNAH: Fences round every field, his face on the barn. Pens, not farms.',enc:[
     {w:[['knifer','raider'],['raider','gunner','raider']],task:0},
     {w:[['raptor','raider'],['knifer','gunner','raider']],from:'L',say:'MESS: Scouts are driving raptors at the farmhouses!'}]},
   {name:'THE ABANDONED FARMS',stage:'5-3',say:'JACK: Empty farms. The families were marched up to the camps.',enc:[
     {w:[['raider','knifer','raider'],['gunner','brute']],from:'T',say:'HANNAH: Off the barn roofs!'},
     {w:[['raider','knifer'],['gunner','raptor']],say:'MUSTAPHA: That’s the scout captain. He drives the animals in!',
      elite:{type:'gunner',variant:'skinner',name:'SCOUT CAPTAIN',hp:400,flee:true,after:'HANNAH: He dropped his whistle and ran. Smart man.'},
      after:'HANNAH: He dropped his whistle and ran. Smart man.'}]},
   {name:'THE EVACUATION ROAD',stage:'5-4',say:'HANNAH: The evacuation road, and a barrier across it. Open it!',enc:[
     {w:[['militia','gunner','knifer'],['brute','raider']],task:1},
     {w:[['knifer','gunner','militia'],['brute','knifer']],from:'T',say:'JACK: More militia off the checkpoint!'}]},
   {name:'THE PALISADE',stage:'5-5',cap:'THE FORTIFIED TOWN',say:'MESS: They walled the town like a pen. Something big went right through.',enc:[
     {w:[['knifer','raider','raider'],['gunner','brute','knifer']],from:'T',say:'HANNAH: Show them the manifests. The same crown is on the cages!'},
     {w:[['brute','gunner'],['raider','raider','knifer']],task:2}]},
   {name:'THE FORTIFIED SQUARE',stage:'5-6',say:'HANNAH: Look. The families are opening their own barriers.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider','raider'],['gunner','raider','raptor']],from:'B',say:'MUSTAPHA: Something big is coming down the road, smashing fences.'},
     {boss:true}]}]},

 // ---------------------------------------------------------------- stage 6
 {name:'THE VERDANT BIODOME',area:'06 / THE PRICE OF POWER',boss:'GLASSBACK',kind:'glassback',accent:'#9fdcae',
  objPage:'S2A0',music:{stage:['13','13','14','14','30','30'],intro:'18',boss:'15'},
  card:{marker:'frontier'},
  inter:[
   {layout:'B',who:'mustapha',pic:'p-dome',lines:['THE VERDANT BIODOME.','A RUINED GARDEN','UNDER GLASS.']},
   {layout:'A',pic:'p-hatchling',lines:['STOLEN EGGS ON RACKS.','THE ADULTS CHAINED','BESIDE THEM.']},
   {layout:'B',who:'hannah',lines:['SOME OF THE SUBJECTS','VOLUNTEERED. SOME','DIDN’T. WE HELP THE','ONES WHO WANT HELP.']},
   {layout:'B',who:'jack',lines:['THIS IS WHERE THE','HYBRIDS COME FROM.','LET’S SHUT IT DOWN.']}],
  brief:'Up the service road stands the Verdant Biodome, a ruined botanical complex that Echo’s people turned into a prison for animals and people. Adult dinosaurs are chained beside stolen eggs; beyond the pens are treatment wards, failed trials and a few completed hybrids. Some of the human subjects were coerced, others volunteered for strength, status or pay. Shut off the treatment feeds, open the occupied cells and reach the reinforced test enclosure, where somebody the gang has met before is waiting.',
  dialog:'HANNAH: Treatment wards. Some of these people were never asked.\nMESS: And some of them signed up. Watch which is which.\nJACK: Shut off the feeds and get to that enclosure.',
  end:'Glassback goes down in the test enclosure, still lean and scaled, still wearing the broken goggles and the red braid. The harness on her spine is wrecked; her body is not going to change back, and nobody pretends otherwise. The surviving subjects are moved with the freed attendants into a separate ward with its own emergency power, and the gang promises them care, not a cure. Then they destroy the active cultures and the production apparatus, while Hannah copies the records of every prisoner and every crime. At the control desk a schedule gives a time for the Crown Tide: dawn. Echo is running what is left of the operation from a converted observatory above the dam.',
  bossCard:'THORNE, AFTER THE TREATMENT',bossToast:'GLASSBACK · WATCH THE CROUCH, THEN THE POUNCE',
  bossSay:['THORNE: I asked her to make me faster than anything I ever hunted.','HANNAH: That voice… it’s Thorne. What did Echo do to her?'],
  bossLines:{p66:'MESS: Those claws are as long as my arm!',p50:'MUSTAPHA: Watch her crouch. She pounces where the shadow falls!',p35:'JACK: Her harness is splitting! Here comes everything she’s got!'},
  bossDefeat:'THORNE: Faster… than anything… I ever hunted…',
  sections:[
   {name:'THE NESTING BEDS',stage:'6-1',cap:'THE GLASS PERIMETER',say:'MUSTAPHA: Artificial nesting beds. Every egg in here was stolen.',enc:[
     {w:[['trapper','knifer'],['mutant','raider']]},
     {w:[['raptor','mutant'],['trapper','gunner','raider']],from:'T',say:'HANNAH: A raptor in a harness! It’s terrified. Careful!'}]},
   {name:'THE ANIMAL PENS',stage:'6-2',say:'JACK: Adults chained beside the eggs. That’s how they keep them calm.',enc:[
     {w:[['mutant','raider'],['raptor','gunner','knifer']],task:0},
     {w:[['raptor','mutant','raider'],['brute','gunner']],from:'B',say:'MESS: Guards with prods! They’re herding the subjects back in!'}]},
   {name:'THE PEN CORRIDOR',stage:'6-3',cap:'THE TREATMENT WARDS',say:'HANNAH: Bars, specimen tanks, cell doors. They kept people here too.',enc:[
     {w:[['hybrid','mutant'],['raider','knifer','raider']],from:'T',say:'JACK: Subjects off the gantry! Some of them want this fight!'},
     {w:[['mutant','raider']],say:'MESS: The orderly with the wrench runs this ward!',
      elite:{type:'brute',variant:'wrenchT',name:'WARD ORDERLY',hp:420,after:'HANNAH: Cell keys. Open every one that’s occupied.'},
      after:'HANNAH: Cell keys. Open every one that’s occupied.'}]},
   {name:'THE TREATMENT WARDS',stage:'6-4',say:'HANNAH: A treatment feed. Shut it and the wards go quiet.',enc:[
     {w:[['mutant','gunner','knifer'],['regent','brute']],task:1},
     {w:[['raider','raider','mutant'],['gunner','gunner','knifer']],from:'L',say:'MUSTAPHA: Guards coming back for the subjects!'}]},
   {name:'THE FAILED TRIALS',stage:'6-5',cap:'THE TEST ENCLOSURE',say:'JACK: Claw marks on the glass, gouged from the inside. Stay sharp.',enc:[
     {w:[['hybrid','raptor','knifer'],['gunner','brute']],from:'T',say:'MESS: Hybrids on the catwalks!'},
     {w:[['regent','raider','gunner'],['brute','raider','mutant']],task:2}]},
   {name:'THE TEST ENCLOSURE',stage:'6-6',say:'MUSTAPHA: The test enclosure. Something is breathing in there.',enc:[
     {w:[['mutant','raider','gunner'],['gunner','mutant'],['brute','raider','knifer']],from:'L',say:'HANNAH: The last guards are cornered. Watch your backs!'},
     {w:[['regent','mutant','gunner'],['brute','raptor'],['brute','knifer','mutant']],from:'B'},
     {boss:true}]}]},

 // ---------------------------------------------------------------- stage 7
 {name:'THE OBSERVATORY',area:'07 / ECHOES OF FESSENDEN',boss:'DR. ECHO',kind:'echo',accent:'#7bd6c9',
  objPage:'S7A1',music:{stage:['21','21','08','08','07','07'],intro:'23',boss:'24'},
  card:{marker:'cliffs'},
  inter:[
   {layout:'B',who:'mustapha',pic:'p-observatory',lines:['AN OLD OBSERVATORY','ON THE CLIFFS. THE','DISHES STILL TURN.']},
   {layout:'C',pic:'p-echo-speaker',lines:['HE PROVED A BODY','COULD CHANGE. I CAN','MAKE IT ENDURE.']},
   {layout:'B',who:'jack',lines:['ASK THE PEOPLE','DOWNSTAIRS WHAT THEY','THINK OF YOUR','IMPROVEMENT.']},
   {layout:'B',who:'hannah',lines:['THE DAM PLANS ARE IN','THERE. WE NEED THEM','BEFORE DAWN.']}],
  brief:'Above the dam stands a converted observatory: short-range radios, facility controls and Dr. Echo’s remaining research. Its dishes coordinate the guards and the equipment around the dam; they reach into nobody’s mind. Fessenden’s archived records lie among the salvage, files and screens, not a living ghost. Wreck the relay masts that run the guard network, get through the archive and take the dam’s working plans from Echo herself, before the Crown Tide starts at dawn.',
  dialog:'ECHO: The first experiments failed because he rushed them.\nHANNAH: This is Hannah Dundee. We’re coming up, Doctor.\nMESS: Those dishes run the guards. Let’s knock them down.',
  end:'The walker’s legs buckle and the control gallery comes down around it. Echo climbs out of the wreck and tries to bargain; Hannah takes the dam plans and leaves her with the freed workers’ guards, to explain herself once the people below are safe. Mustapha tries to stop the release from the observatory and finds the line dead: Sable has cut the gate controls off and moved his last loyal troops onto the dam. The radio crackles. “You have my workshops. You have my doctor. I still have the gates.” The plans show how to reopen the diversion route and let the reservoir down safely. Somebody has to reach the machinery by hand.',
  bossCard:'DR. ECHO · THE OBSERVATORY',bossToast:'DR. ECHO · STAY OUT OF THE RING',
  bossSay:['ECHO: He proved a body could change. I can make it endure.','JACK: Ask the people downstairs what they think of your improvement.'],
  bossLines:{p66:'HANNAH: She backs off to fire. Close the gap!',p33:'ECHO: Guards! Gallery level, now!'},
  bossDefeat:'ECHO: Wait. I can still be useful to you. Let me explain.',
  phase2:{card:'ECHO ENGINE · THE MAINTENANCE WALKER',toast:'ECHO BOARDS HER ENGINE',say:'ECHO: I never test on myself. That is what machines are for.',lines:{p66:'JACK: The cutters glow before the beam. Change lanes!',p50:'HANNAH: It overheats after the beam! Hit it while it steams!',p33:'MUSTAPHA: The hydraulics are failing! Keep at it!'}},
  sections:[
   {name:'THE CLIFF ROAD',stage:'7-1',cap:'THE CLIFF ROAD',say:'HANNAH: Those dishes run the guards. Every patrol answers to them.',enc:[
     {w:[['gunner','militia'],['raider','mutant']]},
     {w:[['mutant','militia','gunner'],['knifer','brute']],from:'B',say:'MESS: Pteranodons off the cliff! Heads down!'}]},
   {name:'THE RELAY STATION',stage:'7-2',cap:'THE RELAY STATION',say:'MUSTAPHA: Short-range radios. Wreck the masts and the guards go deaf.',enc:[
     {w:[['mutant','gunner'],['raider','knifer','mutant']],task:0},
     {w:[['regent','mutant','raider'],['gunner','knifer']],from:'L',say:'JACK: Hybrids out of the service ducts!'}]},
   {name:'THE RADIO ROOM',stage:'7-3',say:'HANNAH: Echo’s orders on every channel. Patrol routes, gate times.',enc:[
     {w:[['gunner','hybrid','knifer'],['raider','brute']],from:'B'},
     {w:[['knifer','gunner']],say:'MESS: That one guards the doctor. Watch the blades!',
      elite:{type:'knifer',variant:'razor',name:'ECHO’S BODYGUARD',hp:420,after:'JACK: Bodyguard’s down. The doctor is next.'},
      after:'JACK: Bodyguard’s down. The doctor is next.'}]},
   {name:'THE RESEARCH ARCHIVE',stage:'7-4',say:'JACK: Fessenden’s old files. Paper and screens. That’s all he is now.',enc:[
     {w:[['knifer','gunner','knifer'],['mutant','brute']],task:1},
     {w:[['mutant','mutant','raider'],['regent','gunner']],from:'B',say:'HANNAH: She kept every failure on file, and kept going.'}]},
   {name:'THE WALKER WORKSHOP',stage:'7-5',cap:'THE WALKER WORKS',say:'MUSTAPHA: Last relay mast. Down it and her guards are on their own.',enc:[
     {w:[['gunner','regent','raider'],['mutant','brute','knifer']],task:2},
     {w:[['mutant','brute','raider'],['gunner','gunner']],from:'T',say:'ECHO: Break every relay you like. I still have the gallery.'}]},
   {name:'THE CONTROL GALLERY',stage:'7-6',say:'ECHO: Sable wants the valley. I only wanted the work to survive.',enc:[
     {w:[['regent','mutant','gunner'],['brute','knifer'],['brute','mutant','gunner']],from:'B',say:'HANNAH: There she is, in the control gallery. Echo herself!'},
     {boss:true}]}]},

 // ---------------------------------------------------------------- stage 8
 {name:'THE CROWN DAM',area:'08 / NO ONE OWNS THE VALLEY',boss:'MARSHAL SABLE',kind:'sable',accent:'#c9a0ff',guard:'CROWN GUARD',
  objPage:'S8A2',music:{stage:['22','22','20','20','29','29'],intro:'09',boss:'19',lastCopy:'32'},
  card:{marker:'river-head'},
  inter:[
   {layout:'B',who:'mustapha',pic:'p-crown-dam',lines:['THE CROWN DAM. HE CUT','THE GATE CONTROLS OFF.','WE GO IN BY HAND.']},
   {layout:'A',pic:'p-sable',lines:['THEY’LL COME TO THE','HIGH ROADS. THEY’LL','TAKE MY FOOD AND','FOLLOW MY ORDERS.']},
   {layout:'B',who:'hannah',lines:['THEY’RE ALREADY','LEAVING BY A ROAD','HE DOESN’T CONTROL.']},
   {layout:'B',who:'jack',lines:['TURBINES, LIFTS,','GATEHOUSE, CREST.','LET’S GO.']}],
  brief:'Rain sweeps across the Crown dam. Below it, scattered lights mark the evacuation road; above it, the reservoir stands dangerously high. Sable has cut the gate controls off from the observatory and holds the dam with his last loyal Crown Guard and a few completed hybrids, who still fight as themselves. Fight through the turbine galleries and the maintenance lifts, reach the gatehouse and stop the marshal on the dam crest before the Crown Tide starts. Under his coat a powered brace covers a graft he took by choice, and Echo’s unfinished treatment is with him.',
  dialog:'SABLE: You cost me a barge, a convoy and a doctor. Not the dam.\nHANNAH: The valley is leaving by a road you don’t control.\nJACK: Then let’s go take the gates back.',
  end:'Crownback makes one last lunge for the gate mechanism. His damaged body and the collapsing gantry fail together, and the marshal goes down into the concrete discharge works below. He does not come back up. The reservoir is still dangerously high, and blowing the dam would only deliver the disaster he planned, so the gang puts the river back by hand. Jack restarts the old diesel backup, Mustapha repairs the release governor, Mess clears the jammed diversion mechanism and holds it in place, and Hannah talks to the people below and calls the sequence. Water runs into the diversion route, the gates open gradually, and the Crown Tide never reaches the valley.',
  bossCard:'MARSHAL OF THE CROWN DAM',bossToast:'MARSHAL SABLE · WAIT FOR THE RELOAD',
  bossSay:['SABLE: They’ll come to the high roads. They’ll follow my orders.','HANNAH: They’re already leaving by a road you don’t control.'],
  bossLines:{reload:'MUSTAPHA: He’s reloading! Now!',p60:'SABLE: Guard! Somebody earn your pay!',p30:'JACK: The brace on his arm is cracking!',brace:'HANNAH: His arm brace just snapped! Hit him now!'},
  releaseSay:'MUSTAPHA: Release mechanism’s off! No sudden flood. The gates are ours!',
  lastCopy:{card:'CROWNBACK · THE CROWN TREATMENT',toast:'SABLE TAKES THE UNFINISHED TREATMENT',
   say:['HANNAH: The treatment! Echo said it was never finished!','SABLE: If you won’t kneel to the marshal, kneel to this!'],
   byHero:{mustapha:'SABLE: Cairo. You fixed my gates. Fix this.',jack:'SABLE: Tenrec. You love dinosaurs. Look at me now.',hannah:'SABLE: Dundee. Go tell the valley who holds the gates.',mess:'SABLE: O’Bradovich. You were always the strong one. Not today.'},
   lines:{p66:'HANNAH: His shield arm is cracking!',p33:'MUSTAPHA: The plates are coming off. Hit his open side!',p20:'MESS: He’s going down! Keep hitting!',defeat:'SABLE: The gates… are… mine…',after:'JACK: The gantry’s gone, and so is he. Now we save the valley.'}},
  sections:[
   {name:'THE SERVICE BRIDGE',stage:'8-1',cap:'THE TURBINE GALLERIES',say:'SABLE: Welcome to the Crown, heroes. Mind the drop.',enc:[
     {w:[['militia','militia'],['gunner','militia'],['knifer','raider']],say:'JACK: Crown Guard! Get round those shields!'},
     {w:[['militia','knifer'],['raider','militia'],['brute']],from:'L',say:'MUSTAPHA: Crown Guard behind us! Off the service bridge!'}]},
   {name:'THE TURBINE HALL',stage:'8-2',say:'HANNAH: The turbine halls. This is what powers Echo’s wards.',enc:[
     {w:[['hybrid'],['militia','gunner'],['knifer','raider']],say:'JACK: A hybrid in the guard line. He chose this. Careful.'},
     {w:[['militia','militia'],['gunner']],from:'R',say:'MESS: Gate captain! He’s got the lift keys!',
      elite:{type:'gunner',variant:'skinner',name:'GATE CAPTAIN',hp:400,flee:true,after:'HANNAH: He dropped the lift keys and ran. Smart man.'},
      after:'HANNAH: He dropped the lift keys and ran. Smart man.'}]},
   {name:'THE MAINTENANCE PLATFORMS',stage:'8-3',cap:'THE MAINTENANCE LIFTS',say:'JACK: Narrow platforms. Watch the edges and take them one at a time.',enc:[
     {w:[['raider','knifer'],['gunner'],['raider','knifer']],from:'T',say:'MUSTAPHA: Off the gantry above!'},
     {w:[['brute'],['knifer','raider'],['gunner']],from:'B',say:'HANNAH: Up from the lower platform!'}]},
   {name:'THE GATEHOUSE',stage:'8-4',say:'HANNAH: Lift controls by the gate gears. Get them running, we go up.',enc:[
     {w:[['militia','gunner'],['militia','knifer']],task:0},
     {w:[['hybrid','raider'],['knifer']],from:'L',say:'MESS: A hybrid on the lift cage!'},
     {w:[['militia','gunner'],['brute','raider']],task:1}]},
   {name:'THE GATE CONTROL ROOM',stage:'8-5',cap:'THE GATE CONTROLS',say:'JACK: The release gears. Nobody touches them till Sable’s down.',enc:[
     {w:[['militia','militia'],['knifer']],from:'R',say:'MUSTAPHA: That’s the Crown sergeant. Big, and he’s never lost.',
      elite:{type:'brute',variant:'hammerT',name:'CROWN SERGEANT',hp:460,after:'JACK: He has now. The gatehouse door, Hannah!'},
      after:'JACK: He has now. The gatehouse door, Hannah!'},
     {w:[['militia','gunner'],['hybrid'],['raider','knifer']],task:2}]},
   {name:'THE DAM CREST',stage:'8-6',say:'SABLE: Every gate on this dam answers to me. Come and take one.',enc:[
     {w:[['militia','militia','gunner'],['hybrid'],['knifer','raider']],from:'B',say:'HANNAH: His last loyal guards. Then it’s him.'},
     {boss:true}]}]}
];

/* Attract story (STORYLINE §5, the opening cinematic): Jack's garage, a driver with a broken restraint, the radio, and
   the gang on the road. 'driver' is a name tag (no ROM portrait). */
window.EDEN_INTRO=[
 {layout:'A',pic:'p-sunset-road',lines:['JACK’S GARAGE. THE','CADILLAC IS HALF FIXED.','LIFE LOOKS ORDINARY.']},
 {layout:'B',who:'driver',pic:'p-barge-fire',lines:['THEY’RE TAKING THEM','ALIVE NOW.'],lines2:['CITY DOCKS. THEY TOOK','THE PEOPLE TOO.']},
 {layout:'A',pic:'p-sable',lines:['RADIO: MARSHAL SABLE’S','MEN PROTECT THE COAST','FROM DANGEROUS ANIMALS.']},
 {layout:'B',who:'jack',lines:['AN OLD BLACK MARKETEER','STAMP UNDER A FRESH','CROWN. SAME CAGES.','NEW PAINT.']},
 {layout:'B',who:'mustapha',lines:['GOOD THING I FIXED','THE BRAKES.']},
 {layout:'B',who:'mess',lines:['GOOD THING I','FINISHED LUNCH.']}
];

/* Ending (STORYLINE §7-8; ending() state). 'fall': Crownback lies in the discharge works; 'alarm': the reservoir is still
   too high; 'roles': the four heroes each do their part and the gates open gradually; 'run': all four run for the
   Cadillac while the crest walkway gives way behind them; 'board': into the car together; 'dawn': a picture panel;
   'road': the Cadillac with all four aboard stops for a large dinosaur crossing the road; 'thanks': the staff roll and
   the final card. Dialogue boxes keep the 30-character panel limit. */
window.EDEN_ENDING=[
 {beat:'fall',who:'hannah',lines:['HE WENT FOR THE GATES.','THE GANTRY GAVE WAY.']},
 {beat:'alarm',who:'mustapha',lines:['THE RESERVOIR’S STILL','TOO HIGH. AND NOBODY','BLOWS THIS DAM.']},
 {beat:'roles',boxes:[
   {who:'jack',lines:['DIESEL BACKUP’S','RUNNING. YOU’VE','GOT POWER!']},
   {who:'mustapha',lines:['GOVERNOR’S FIXED. THE','GATES ANSWER ME NOW.']},
   {who:'mess',lines:['DIVERSION GEAR’S CLEAR.','I’VE GOT IT HELD!']},
   {who:'hannah',lines:['THE VALLEY ROAD IS','CLEAR. OPEN THEM.','SLOWLY.']}]},
 {beat:'run',caption:'TO THE CADILLAC!'},
 {beat:'board',boxes:[
   {who:'mustapha',lines:['EVERYBODY IN. I’M NOT','RUNNING HOME AGAIN.']},
   {who:'jack',lines:['NOBODY’S WALKING.']}]},
 {beat:'dawn',pic:'p-dam-dawn',caption:'FIRST LIGHT. THE RIVER RUNS.'},
 {beat:'road',pic:'p-sunset-road',boxes:[
   {who:'hannah',lines:['THE PENS ARE COMING','DOWN. THE ANIMALS','GO HOME.']},
   {who:'mustapha',lines:['AND THE DAM GOES TO','THE PEOPLE WHO RUN IT.']},
   {who:'mess',lines:['WE BEAT THE WHOLE GANG,','AND WE’RE STILL STUCK','IN TRAFFIC?']},
   {who:'jack',lines:['IT WAS HERE FIRST.']}]},
 {beat:'thanks',lines:['THE ROAD GOES ON','THANK YOU FOR PLAYING','A FAN SEQUEL MADE FOR MOSTAFA']}
];
