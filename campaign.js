/* The Crown Tide: the sequel starts six months after the exact 1993 ending (see STORY.md). Marshal Sable seizes the
   Crown dam and holds the flooded coast hostage with water; every chapter boss runs one link of his supply chain, and at
   the dam he takes the unfinished Crown treatment and becomes CROWNBACK.
   Six chapters; each has three areas, six sections, 12-13 locked fights, an elite and a boss, and plays in four to
   five minutes. Encounter fields: w = reinforcement waves, from = R/L/B (both)/T (drop from above), task = mission
   task index, elite = mid-boss, say = radio line when the fight starts, after = radio line when the elite dies.
   Chapter 6's human regulars are Sable's Crown Guard (level.guard names them on the HUD); its collared conscripts are
   freed by the pylons (EDEN_MISSIONS) and fight beside the gang. Text is stored in sentence case and drawn in upper case in the ROM 8x16 font. Boss text is data (bossCard,
   bossToast, bossSay, bossLines, bossDefeat, phase2, spillwaySay, gateSay, lastCopy). The field names are the engine's
   and stay as they are: phase2 is a boss's second form (Sable at the gate controls; Krag as IRONCLUB after his trial dose),
   lastCopy is CROWNBACK.
   Stage recipes: EDEN_STAGES (CAMPAIGN.md §12.2), authored under tools/re/levels/ch<N>.json and shipped as
   stage-data.js; section.stage is the key. */
window.EDEN_CAMPAIGN = [
 {name:'WASSOON',area:'01 / THE PRISON BARGE',boss:'WARDEN ROOK',kind:'warden',accent:'#8fb3e6',
  objPage:'S1A0',music:{stage:['06','06','07','07','08','08'],intro:'09',boss:'10'},
  card:{pre:'EASTCOAST 2513 · SIX MONTHS LATER',marker:'wassoon'},
  inter:[
   {layout:'A',pic:'p-barge-fire',lines:['MOVE IT! THE MARSHAL WANTS','THEM ON THE LOW TIDE.']},
   {layout:'A',pic:'p-pod-face',lines:['SEDATED AND SEALED.','LABOR FOR THE CROWN.']},
   {layout:'B',who:'mustapha',lines:['THOSE ARE WASSOON MEN IN','THOSE PODS! FISHERMEN!']},
   {layout:'B',who:'hannah',lines:['THEIR CRIME? DRAWING WATER','WITHOUT A PERMIT.']},
   {layout:'B',who:'jack',lines:['SOMEBODY’S HOLDING THIS','COAST BY THE THROAT.','LET’S GO LOOSEN THE GRIP.']}],
  brief:'Six months ago Dr. Fessenden took his own serum in the throne room of his Under World, the lab beneath the City in the Sea, and died a beast. The lab blew apart, the sea poured in, and the floods that followed drowned half the coast. Into the mess stepped Marshal Sable, the Wassoon lawman who took the captured Black Marketeers into custody, promising clean water and safe roads. Now his men hold the water. Every ration notice in Wassoon carries his brass gate seal and the words “Order keeps the water flowing.” Tonight the gang is in Hannah’s city, and the harbor bells are ringing: Warden Rook’s prison barge is loading sealed pods by torchlight, and the men inside them are Wassoon fishermen whose only crime was drawing water without a permit.',
  dialog:'HANNAH: These are my people. Rationed, then arrested for being thirsty.\nMUSTAPHA: Every notice has the same brass seal. A floodgate: Sable’s.\nJACK: Then we start with the man loading the barge.',
  end:'Rook goes down on his own dock, and Hannah takes the manifest out of his vest. The pods were never bound for a court. They were labor, signed over to Marshal Sable and shipped at low tide up the Coral Causeway “for the works at the Crown.” Folded inside the manifest is a ration notice with the brass gate seal, and on its back someone has listed the cargo the convoy must not lose: pressure regulators, gate brass, and one crate marked BIODOME. Rook will answer to Wassoon. The convoy left an hour ago, and the tide is going out.',
  bossCard:'JAILER OF THE PRISON BARGE',bossToast:'WARDEN ROOK · STAY OFF HIS HOOK',
  bossSay:['ROOK: Ration breakers go to the Crown. You can swim there.','HANNAH: He lowers the hook before he pulls. Change lanes when it drops!'],
  bossTaunt:'ROOK: Nobody leaves my barge!',
  bossLines:{p60:'MUSTAPHA: The tide’s coming over the pier! Watch the front!',p50:'ROOK: Enough! Everybody into the water!',p40:'HANNAH: He’s working the crane! Watch for the shadow!',p25:'ROOK: The marshal swore nobody would come looking for these men!'},
  bossDefeat:'ROOK: All right! I only load the barge. The marshal signs for them.',
  sections:[
   {name:'THE SEA WALL',stage:'1-1',cap:'WASSOON HARBOR',say:'HANNAH: The prison barge is loading at night. That’s never a good sign.',enc:[
     {w:[['raider','raider'],['raider','knifer']]},
     {w:[['knifer','raider'],['gunner','raider','knifer']],from:'L',say:'MUSTAPHA: Behind us! They came over the sea wall!'}]},
   {name:'THE RATION SHEDS',stage:'1-2',say:'JACK: Ration notices on every shed. The same brass seal on every one.',enc:[
     {w:[['knifer','raider'],['raider','gunner','raider']],task:0},
     {w:[['brute','raider'],['knifer','knifer','gunner']],from:'L',say:'MESS: They’re guarding the water tanks, not the town!'}]},
   {name:'THE CANNERY',stage:'1-3',cap:'THE QUAY SHEDS',say:'MESS: Hooks and chains on every beam. This whole quay is a jail.',enc:[
     {w:[['raider','knifer','raider'],['gunner','brute']],from:'T',say:'JACK: Off the cannery roof!'},
     {w:[['raider','knifer'],['gunner','raider']],say:'MESS: The big one’s mine. He’s got the barge keys on his belt!',
      elite:{type:'brute',variant:'blkElmer',name:'BARGE BOSUN',hp:420,after:'JACK: Keys. Now let’s get those pods open.'},
      after:'JACK: Keys. Now let’s get those pods open.'}]},
   {name:'THE QUAY SHEDS',stage:'1-4',say:'HANNAH: Holding sheds. Nobody broke out. They were loaded up and sold.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider']],task:1},
     {w:[['knifer','gunner','raider'],['brute','knifer']],from:'T',say:'JACK: Up on the shed roofs!'}]},
   {name:'THE PRISON BARGE',stage:'1-5',cap:'THE JAIL QUAY',say:'JACK: The barge at the jail quay. The pods are numbered like cargo.',enc:[
     {w:[['knifer','raider','raider'],['gunner','brute','knifer']],from:'T',say:'HANNAH: They’re dropping off the barge rail!'},
     {w:[['brute','gunner'],['raider','raider','knifer']],task:2}]},
   {name:'THE WARDEN’S DOCK',stage:'1-6',say:'ROOK: Whatever you saw tonight, you didn’t see. Turn around.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider','raider'],['gunner','raider','raider']],from:'B'},
     {boss:true}]}]},

 {name:'THE CORAL CAUSEWAY',area:'02 / THE TIDE CONVOY',drive:true,boss:'HAULMASTER KRAG',kind:'truck',accent:'#e8a35a',
  objPage:'S3A0',music:{stage:['16','16','16','22','22','17'],intro:'18',boss:'19'},
  card:{marker:'causeway'},
  inter:[
   {layout:'B',who:'hannah',pic:'p-manifest',lines:['ROOK’S MANIFEST SAYS THE','CONVOY RIDES THE CAUSEWAY.'],lines2:['IT ONLY SURFACES AT','LOW TIDE.']},
   {layout:'A',pic:'p-convoy',lines:['MOVE IT! THE TIDE WON’T WAIT','AND NEITHER WILL THE MARSHAL.']},
   {layout:'B',who:'jack',lines:['SIX MONTHS IN THE SHOP.','LET’S SEE IF SHE STILL RUNS.','EVERYBODY IN THE CADILLAC!']}],
  brief:'Jack spent six months in the Mechanics’ yard rebuilding the Cadillac after the Under World. Tonight she runs again. Sable’s convoy is hauling Rook’s prisoners and a load of heavy freight north over the Coral Causeway, an old highway the sea gives back only at low tide. Run down the outriders, knock the cargo wagons loose, drop the chain at the old toll post before the convoy reaches the mainland, and stop the man who drives it. The crews call him Haulmaster Krag: a length of anchor chain wrapped round one fist and a temper to match. And somebody loaded a sealed medical case onto his last wagon at Wassoon, stamped CROWN TRIAL · CREW DOSE.',
  dialog:'JACK: A road under the sea. Let’s hope the engine stays dry.\nMESS: Krag rides the last wagon. Nobody gets past that chain.\nHANNAH: The tide turns in four minutes. Drive, Jack!',
  end:'Krag goes down on the wet road and stays down. The plates crumble off him like old plaster, and what is left is a haulmaster with a chain round his fist and a needle mark in his neck. In his wagon the gang finds the case he was guarding: empty trial vials under a tuning-fork seal, labelled CROWN TRIAL · CREW DOSE. Somebody is testing a treatment on Sable’s own men. Under the tarps rides the rest of the cargo: pressure regulators the size of a man, gate brass and rivets, all stencilled TO THE CROWN, and under the brass a crate of collared raptor hatchlings tagged VERDANT BIODOME · NURSERY STOCK. The convoy’s logbook points inland, past the last settlement, to a ruined glass dome on the jungle frontier. Then the convoy radio crackles with a calm, dry voice: “Keep the hatchlings, Tenrec. The Crown only needs the brass.”',
  bossCard:'HAULMASTER OF THE TIDE CONVOY',bossToast:'HAULMASTER KRAG · CHANGE LANES WHEN THE CHAIN WINDS UP',
  bossSay:['KRAG: End of the road, Tenrec. Everybody out of the car.','MESS: That chain covers a whole lane. Step out of line when he winds up!'],
  bossLines:{p66:'MUSTAPHA: He drops his guard after a charge!',p33:'HANNAH: He’s going for that medical case!'},
  bossDefeat:'HANNAH: It’s wearing off. He’s just a man again. Cuff him.',
  phase2:{card:'IRONCLUB · THE TRIAL DOSE',toast:'KRAG TAKES THE TRIAL DOSE',say:'KRAG: The doctor said one dose would kill a man. Let’s find out.',lines:{p66:'HANNAH: Plates on his back, a club for a tail. What did they give him?',p33:'MUSTAPHA: When he curls up, step aside. Hit him as he opens!',p20:'JACK: The plates are cracking. Finish it!'}},
  sections:[
   {name:'LOW TIDE',stage:'2-1',cap:'THE CORAL CAUSEWAY',drive:true,say:'JACK: Tide’s out for an hour. Hang on to something.',enc:[
     {w:[['biker','biker'],['biker','gunner','biker']],from:'L',say:'MESS: Bikes on the causeway behind us!'},
     {w:[['biker','biker','biker'],['biker','biker'],['biker','biker']],from:'B',say:'MUSTAPHA: More bikes in the mirror!'}]},
   {name:'THE TIDE CONVOY',stage:'2-2',drive:true,say:'HANNAH: Cargo wagons at twelve o’clock. Ram them loose, Jack!',enc:[
     {w:[['biker','biker','biker'],['biker','biker'],['biker','biker']],from:'B',say:'MUSTAPHA: Pteranodons! Keep your heads down!'},
     {w:[['biker','biker'],['biker','gunner','biker'],['biker','biker']],task:0,say:'MESS: Look at the reef. Something swept it flat with a club.'}]},
   {name:'OUTRIDERS',stage:'2-3',drive:true,say:'MUSTAPHA: Big one on a bike, coming up fast!',enc:[
     {w:[['biker','biker','biker'],['biker','gunner'],['biker','biker']],from:'B',task:1},
     {w:[['biker','biker']],say:'JACK: That’s the convoy boss. Knock him off and the wagons slow!',
      elite:{type:'biker',variant:'jump',name:'TIDE OUTRIDER',hp:380,after:'HANNAH: The convoy’s stopping at the toll post. The road’s chained shut!'},
      after:'HANNAH: The convoy’s stopping at the toll post. The road’s chained shut!'}]},
   {name:'THE TOLL FORT',stage:'2-4',cap:'THE OLD TOLL POST',say:'JACK: Everybody out. That chain comes down on foot.',enc:[
     {w:[['raider','knifer'],['gunner','raider','brute']],from:'T',say:'MESS: Off the stockade wall!'},
     {w:[['knifer','raider','brute'],['gunner','gunner']],from:'L',say:'HANNAH: This was a Mechanics’ toll post. Sable just took it.'}]},
   {name:'THE BARRIER WINCH',stage:'2-5',say:'MESS: There’s the winch. Cover me while I crank it!',enc:[
     {w:[['gunner','raider','knifer'],['brute','gunner']],task:2},
     {w:[['raider','raider','knifer'],['brute','knifer','gunner']],from:'B',say:'MESS: Chain’s down! Jack, bring the car around!'}]},
   {name:'THE LAST WAGON',stage:'2-6',cap:'THE RISING TIDE',drive:true,say:'JACK: Back in the Cadillac. Krag’s wagon is still ahead of us.',enc:[
     {w:[['biker','biker','biker'],['biker','gunner'],['biker','biker','gunner']],from:'B'},
     {boss:true}]}]},

 {name:'THE VERDANT BIODOME',area:'03 / THE NEST',boss:'HEADKEEPER THORNE',kind:'raptor',accent:'#accb6d',
  objPage:'S2A0',music:{stage:['13','13','14','14','25','25'],intro:'18',boss:'15'},
  card:{marker:'frontier'},
  inter:[
   {layout:'B',who:'hannah',pic:'p-hatchling',lines:['A COLLAR ON A BABY RAPTOR?'],lines2:['SOMEBODY’S RAISING THEM','TO TAKE ORDERS.']},
   {layout:'B',who:'mustapha',pic:'p-dome',lines:['THE TAG SAYS VERDANT BIODOME.','AN OLD GLASS DOME ON','THE JUNGLE FRONTIER.']},
   {layout:'A',pic:'p-regent-asleep',lines:['KEEP THE DRIVER HUMMING.','THE HEADKEEPER WANTS','THE PACK HUNGRY.']}],
  brief:'Past the last settlement the road ends and the jungle begins. In a ruined glass dome on the frontier, Sable’s hatchery raises dinosaurs for his crews: the keepers rob the wild nests, hatch the eggs on racks and steer the young in steel collars with sonic lures. The dome belongs to Headkeeper Thorne, who drives the whole pack from a sonic driver in the old nest and carries an electric prod for anything that bites back. Knock down the lures, free what you can, get to the nest and break her driver.',
  dialog:'HANNAH: Collars on every raptor. Somebody is steering them.\nMUSTAPHA: Claw marks on the glass, long ones. That is no raptor.\nJACK: Then we break the remote, not the dinosaur.',
  end:'The feathers fall out of her in handfuls, the claws shrink back to fingers, and Glassback is Headkeeper Thorne again, lying in the nest she stole. The gang cuffs her, and the eggs on the racks and the collared pack stay safe; the hatchery’s young go back to the wild nests they were taken from. Her hut tells the rest. The hatchery was only half of the work here: shelves of jars hold graft tissue, scaly and feathered patches grown on human skin, labelled ADAPTIVE TRIAL and signed by Dr. Echo, and one empty jar is the dose Thorne took. The ledger says every sample came out of the Sink, the drowned crater under the City in the Sea where Fessenden’s lab used to be, where Foreman Cinder’s divers are pumping the wreck dry for parts. One line is underlined twice: “Priority order for the marshal. Shoulder and arm.”',
  bossCard:'KEEPER OF THE HATCHERY',bossToast:'HEADKEEPER THORNE · BREAK HER DRIVER',
  bossSay:['THORNE: You broke my lures? My pack still answers me.','JACK: That driver steers the whole pack. Smash it!'],
  bossLines:{p66:'MUSTAPHA: The driver’s calling the pack in!',driverHit:'HANNAH: The driver’s sparking. It’s hurting her too!',leash:'MESS: She won’t leave that driver. Stay wide of it!'},
  driverDeadSay:'HANNAH: The driver’s dead. The pack is quiet. Now finish her!',
  bossDefeat:'HANNAH: The graft’s burning out. She’s human again. Cuff her.',
  phase2:{card:'GLASSBACK · THE ADAPTIVE GRAFT',toast:'THORNE TAKES THE GRAFT',say:'THORNE: Echo said the graft wasn’t ready. Neither are you.',lines:{p66:'MESS: Those claws are as long as my arm!',p33:'MUSTAPHA: Watch her crouch. She pounces where the shadow falls!',driverHit:'HANNAH: The driver’s sparking. It’s hurting her too!'}},
  sections:[
   {name:'THE LAST FENCE',stage:'3-1',cap:'THE GLASS PERIMETER',say:'MUSTAPHA: Last fence on the map. After this, it’s all jungle.',enc:[
     {w:[['raider','knifer'],['raptor','raider']]},
     {w:[['raptor','raptor'],['raider','gunner','raider']],from:'T',say:'HANNAH: Raptors in the trees. Look at those collars!'}]},
   {name:'THE COLLAR PENS',stage:'3-2',say:'JACK: Pens in the glass hall. They robbed every nest to fill them.',enc:[
     {w:[['raptor','raider'],['raptor','gunner','knifer']],task:0},
     {w:[['raptor','raptor','raider'],['brute','gunner']],from:'B',set:'naguri-vignette',say:'MESS: They’re beating a raptor! Get ’em off it!'}]},
   {name:'THE EGG RACKS',stage:'3-3',cap:'THE HATCHERY',say:'HANNAH: Stolen eggs on racks. Some are huge. They robbed a giant.',enc:[
     {w:[['raptor','raptor'],['raider','knifer','raider']],from:'T',say:'JACK: They’re dropping out of the vines!'},
     {w:[['raptor','raider']],say:'MESS: That one’s twice the size of the others!',
      elite:{type:'raptor',variant:'hopper',palette:'t74-e8a0-pal31',name:'PACK ALPHA',hp:400,after:'HANNAH: Not dead. Calm. Its collar cracked. It’s just going home.'},
      after:'HANNAH: Not dead. Calm. Its collar cracked. It’s just going home.'}]},
   {name:'THE RIVER WALK',stage:'3-4',say:'JACK: Lure tower by the river. Knock it down.',enc:[
     {w:[['raptor','gunner','knifer'],['raptor','brute']],task:1},
     {w:[['raider','raider','raptor'],['gunner','gunner','knifer']],from:'L',say:'MUSTAPHA: Handlers on the bank. They’re calling the pack back!'}]},
   {name:'THE NEST TRAIL',stage:'3-5',cap:'THE NEST',say:'HANNAH: Listen. Something big is breathing up ahead. And something hums.',enc:[
     {w:[['raptor','raptor','knifer'],['gunner','brute']],from:'T',say:'MESS: Jars of scaly skin, labelled ADAPTIVE TRIAL. I hate this place.'},
     {w:[['raptor','raider','gunner'],['brute','raider','raptor']],task:2}]},
   {name:'GLASSBACK’S NEST',stage:'3-6',say:'MUSTAPHA: A nest the size of a car, and somebody’s humming driver in it.',enc:[
     {w:[['raptor','raider','gunner'],['gunner','raptor'],['brute','raider','knifer']],from:'L',say:'HANNAH: The handlers are cornered. They’re throwing everything at us!'},
     {w:[['raptor','raider','gunner'],['brute','raptor'],['brute','knifer','raptor']],from:'B'},
     {boss:true}]}]},

 {name:'THE SINK',area:'04 / THE PUMP STATION',boss:'FOREMAN CINDER',kind:'cinder',accent:'#5fc4b0',
  objPage:'S8A1',music:{stage:['30','30','29','29','20','20'],intro:'23',boss:'24'},
  card:{marker:'city-in-the-sea'},
  inter:[
   {layout:'B',who:'hannah',pic:'p-ledger',lines:['EVERY SAMPLE IN THAT LEDGER','CAME OUT OF THE SINK.'],lines2:['FESSENDEN’S LAB. DROWNED.']},
   {layout:'B',who:'mess',lines:['I SAID I’D NEVER GO BACK','DOWN THERE.']},
   {layout:'B',who:'jack',lines:['LAST TIME, THAT PLACE BLEW','UP BEHIND US.','NOW SOMEBODY’S PUMPING IT DRY.']}],
  brief:'The gang goes back down. Six months after the blast, the Under World is a flooded crater beneath the City in the Sea that the locals call the Sink. Foreman Cinder’s salvage crews have built a pump station over it and are pumping the wreck dry, hauling Fessenden’s drowned equipment out piece by piece: tanks, needles, serum benches, anything Dr. Echo or the marshal will pay for. Cinder works the deep end himself, in a brass pressure suit, with a pile driver he uses on rock and people alike. Open the three sea valves, drown the dig, and find out what the marshal ordered from down here.',
  dialog:'MESS: I said I’d never come back down here.\nHANNAH: Hear that? Pumps, and something hammering the rock below.\nJACK: Last time this place blew up. Let’s not stay for round two.',
  end:'The overloaded rig cracks open plate by plate, Cinder climbs out of the wreck, and the foreman sits down in the mud beside it with his helmet open and his hands up. He talks. Echo paid for Fessenden’s notes and his serum benches; the marshal paid for everything else. At the bottom of the dig the gang finds what everything else means: a brass shoulder brace, the twin of the floodgate plate Sable wears, bolted to an anatomical test rig and wired to a pressure pump. Beside it lie the plans, stamped CROWN TREATMENT · UNFINISHED. “Fessenden’s serum, cut with Echo’s grafts,” Cinder says. “For one customer. The marshal’s arm is dying under that plate, and he means to grow a better one.” The plans are signed at the observatory on the cliffs, where Echo’s dish sends the signal that steers every collar on the coast.',
  bossCard:'SALVAGE FOREMAN · THE PUMP STATION',bossToast:'FOREMAN CINDER · WATCH HIS GAUGE',
  bossSay:['CINDER: You opened my valves? Then I’ll drive you into the rock.','MUSTAPHA: When he lifts that driver, jump the shockwave!'],
  bossLines:{p50:'CINDER: Pumps! Give them the sea!',p25:'CINDER: The marshal pays by the ton. You’re costing me a fortune!'},
  bossDefeat:'CINDER: Enough! The rig’s gone… I’ll talk. Get me out of the water.',
  phase2:{card:'OVERDRIVE CINDER · THE RIG AT FULL PRESSURE',toast:'CINDER OVERLOADS HIS RIG',say:'CINDER: Helmet down. Pressure up. Let’s see you dig through this.',lines:{p66:'MUSTAPHA: Red gauge on his arm! Get out of his lane!',p33:'HANNAH: The steam’s cooking him. Hit him when the arm sticks!'}},
  sections:[
   {name:'WHERE HANNAH FELL',stage:'4-1',cap:'THE SINK',say:'HANNAH: This is where I fell that night. Now it’s a salvage yard.',enc:[
     {w:[['raider','brute'],['knifer','raider','gunner']]},
     {w:[['brute','raider'],['raider','gunner','raider']],from:'T',say:'JACK: Salvage divers on the ropes. Heads up!'}]},
   {name:'THE SHATTERED TANKS',stage:'4-2',say:'HANNAH: Fessenden’s tanks, cracked open and stripped for parts.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider']],task:0},
     {w:[['gunner','gunner','raider'],['raider','knifer','raider']],from:'B',say:'MESS: They’re hauling his serum benches up in nets!'}]},
   {name:'THE DRAIN',stage:'4-3',cap:'THE PUMP STATION',say:'JACK: Pile-driver holes all down the walls. Somebody’s been busy.',enc:[
     {w:[['raider','knifer','gunner'],['brute','raider']],from:'T',say:'MUSTAPHA: Off the pump scaffold!'},
     {w:[['gunner','raider']],say:'MESS: The water’s moving. Something big lives down here now.',
      elite:{type:'regent',variant:'tyrog',palette:'t10-e6a2-pal29',name:'BROOD MOTHER',hp:460,after:'JACK: She’s gone back under. Nobody follow her.'},
      after:'JACK: She’s gone back under. Nobody follow her.'}]},
   {name:'THE PUMP SCAFFOLDS',stage:'4-4',say:'HANNAH: Cinder’s pumps. Open the sea valves and the dig floods.',enc:[
     {w:[['knifer','gunner','raider'],['brute','raider']],task:1},
     {w:[['raider','raider','knifer'],['gunner','brute','raider']],from:'T',say:'MUSTAPHA: Bombers on the scaffold!'}]},
   {name:'THE DIG CAVES',stage:'4-5',cap:'THE DIG',say:'JACK: They’ve dug right down to where he died. Stripped it to the bolts.',enc:[
     {w:[['mutant','raider','gunner'],['brute','knifer']],from:'L',say:'MESS: Scales on those guys. Like the jars in the dome!'},
     {w:[['brute','gunner','knifer'],['mutant','raider','raider']],task:2}]},
   {name:'CINDER’S DIG',stage:'4-6',say:'CINDER: I drive piles for a living. Rock, steel, heroes. Same price.',enc:[
     {w:[['brute','raider','gunner'],['mutant','knifer','raider'],['mutant','knifer','raider']],from:'B',say:'HANNAH: A shoulder brace on a test rig. That’s Sable’s plate!'},
     {boss:true}]}]},

 {name:'THE OBSERVATORY',area:'05 / DR. ECHO',boss:'DR. ECHO',kind:'echo',accent:'#7bd6c9',
  objPage:'S7A1',music:{stage:['21','21','08','08','07','07'],intro:'23',boss:'10'},
  card:{marker:'cliffs'},
  inter:[
   {layout:'B',who:'mustapha',pic:'p-observatory',lines:['AN OBSERVATORY FROM THE OLD','WORLD. THE DISH STILL TURNS.']},
   {layout:'C',pic:'p-echo-speaker',lines:['FESSENDEN DIED OF HIS','IDEAS. I INTEND TO','SURVIVE MINE.']},
   {layout:'B',who:'hannah',lines:['THIS IS HANNAH DUNDEE.','WE’RE COMING UP, DOCTOR.']}],
  brief:'On the cliffs north of the City in the Sea stands an observatory from the old world, its dome cracked open to the sky. Dr. Echo, who ran the numbered tanks in Fessenden’s Bio Lab and slipped out before it blew, has made it her laboratory. She believes the coast will keep drowning and people must adapt to survive it, so she grafts, and she broadcasts: her great crescent dish sends the command signal that steers every collar, lure and graft subject Sable owns. Jam the three control channels, get through her archive and her vat hall, and take the dish from the woman herself. She will not hide behind a speaker this time.',
  dialog:'ECHO: Turn back. You are walking into a broadcast, not a building.\nHANNAH: This is Hannah Dundee. We’re coming up, Doctor.\nMESS: She’s got a tank with my name on it, hasn’t she? I can feel it.',
  end:'The walker’s legs buckle, its dishes crack, the hum stops, and every collar on the coast goes quiet at once. Echo climbs out of the wreck, kneels with her hands up, sets down her tuning fork and lets Hannah take the command key off her belt. She never took her own serum; she built a machine to stand in for her. Then she tells them the rest herself. The Mirror Gang was her one indulgence: bodies grown from blood scraped off the Under World floor and drilled on the Vault’s old recordings of the gang. One test body was finished; the four in the vat hall never will be. Everything else was for Sable: the collars, the signal, the grafts, and the Crown treatment, Fessenden’s serum cut with her adaptive tissue, meant to give the marshal an arm that could hold a floodgate by itself. “He ordered a body that could outlast the flood,” she says. “I never said he could control it.” The treatment went to the Crown dam with him. The council’s riders take Echo back to Wassoon, to answer to the people her work has hurt.',
  bossCard:'THE SIGNAL DOCTOR · OBSERVATORY',bossToast:'DR. ECHO · STAY OUT OF THE DISH',
  bossSay:['ECHO: Fessenden built monsters. I build survivors. Hold still.','JACK: Watch the dish! When she raises it, change lanes!'],
  bossLines:{p66:'ECHO: Second relay. Full gain.',p50:'HANNAH: The dish is cooling down! Hit her while it vents!',p33:'ECHO: Every collar in the hall, to me!'},
  bossDefeat:'ECHO: Enough. Take the key. You will need it more than I do.',
  phase2:{card:'ECHO ENGINE · THE SOUND-WALKER',toast:'ECHO BOARDS HER ENGINE',say:'ECHO: I never test on myself. That is what machines are for.',lines:{p66:'JACK: The dishes glow before the beam. Change lanes!',p50:'HANNAH: It overheats after the beam! Hit it while it steams!',p33:'ECHO: Every collar in the hall, to me!'}},
  sections:[
   {name:'THE CLIFF ROAD',stage:'5-1',cap:'THE CLIFF ROAD',say:'HANNAH: That dish is sending Echo’s orders. Feel the hum in your teeth?',enc:[
     {w:[['gunner','knifer'],['raider','mutant']]},
     {w:[['mutant','raider','gunner'],['knifer','brute']],from:'B',say:'MESS: Pteranodons off the cliff! Heads down!'}]},
   {name:'THE INSTRUMENT FLOOR',stage:'5-2',cap:'THE COPIED VAULT',say:'MUSTAPHA: Old-world brass, all tuned to the dish. It’s a voice box.',enc:[
     {w:[['mutant','gunner'],['raider','knifer','mutant']],task:0},
     {w:[['regent','mutant','raider'],['gunner','knifer']],from:'L',say:'JACK: Graft subjects! Scales and collars, out of the drains!'}]},
   {name:'THE COPIED ARCHIVE',stage:'5-3',say:'HANNAH: The Vault’s shelves. She copied Fessenden’s whole archive.',enc:[
     {w:[['gunner','mutant','knifer'],['raider','brute']],from:'B'},
     {w:[['mutant']],say:'ECHO: My one indulgence. It learned to fight by watching you.',
      elite:{type:'mirror',hero:1,name:'MIRROR TEST',hp:420,after:'MESS: It moved like us. Nothing behind the eyes, though.'},
      after:'MESS: It moved like us. Nothing behind the eyes, though.'}]},
   {name:'THE VAT HALL',stage:'5-4',cap:'THE VAT HALL',say:'JACK: Tanks with our names on them. All four of us, half-grown.',enc:[
     {w:[['knifer','gunner','knifer'],['mutant','brute']],task:1},
     {w:[['mutant','mutant','raider'],['regent','gunner']],from:'B',say:'MESS: There’s a tank with my name on it. Literally!'}]},
   {name:'THE BROADCAST ROOM',stage:'5-5',say:'JACK: Last channel. Jam it and her signal dies for miles.',enc:[
     {w:[['gunner','regent','raider'],['mutant','brute','knifer']],task:2},
     {w:[['mutant','brute','raider'],['gunner','gunner']],from:'T',say:'ECHO: Every channel you jam, I open two more.'}]},
   {name:'THE DISH GALLERY',stage:'5-6',say:'ECHO: Sable will drown this coast to own it. I only wanted it to live.',enc:[
     {w:[['regent','mutant','gunner'],['brute','knifer'],['brute','mutant','gunner']],from:'B',say:'HANNAH: There she is, under the dish. Echo herself!'},
     {boss:true}]}]},

 {name:'THE CROWN DAM',area:'06 / THE CROWN TIDE',boss:'MARSHAL SABLE',kind:'sable',accent:'#c9a0ff',guard:'CROWN GUARD',
  objPage:'S8A2',music:{stage:['22','22','20','20','29','30'],intro:'09',boss:'15',engine:'24',lastCopy:'32'},
  card:{marker:'river-head'},
  inter:[
   {layout:'B',who:'mustapha',pic:'p-crown-dam',lines:['THE CROWN DAM. EVERY DROP','ON THE COAST RUNS THROUGH','THOSE GATES.']},
   {layout:'A',pic:'p-sable',lines:['ORDER KEEPS THE WATER','FLOWING. I AM THE ORDER.']},
   {layout:'B',who:'hannah',lines:['ECHO’S KEY CAN BREAK THE','COLLARS ON HIS CREWS.','AND THE TREATMENT IS','WITH HIM.']},
   {layout:'B',who:'jack',lines:['HE WANTS TO HOLD THE SEA','BACK WITH ONE HAND.','LET’S SEE HIM TRY.']}],
  brief:'The Crown dam holds back the flood that drowned the coast, and Marshal Sable holds the dam. His conscripts, Wassoon prisoners and ration breakers wearing Echo’s collars, work the gates; his Crown Guard holds the gallery; and the cargo the gang chased up the coast, the regulators and the gate brass, is bolted into the controls. With them he can starve any settlement downstream or drown it. Hannah has Echo’s command key. Break the collar pylons, free his crews, take the gate controls and stop the marshal. And remember Echo’s warning: the Crown treatment came here with him, and it is not finished.',
  dialog:'SABLE: You cost me a barge, a convoy and a doctor. Not the dam.\nHANNAH: Your dam? Wassoon dug it. Wassoon drinks from it.\nJACK: Then let’s go give it back.',
  end:'Crownback falls in the spillway, and the water he tried to hold goes over him. What is left when the surge passes is mostly the marshal: the ivory sash, the scar, one arm still locked inside a split brass plate. He chose the unfinished treatment rather than open a single gate, and the treatment did exactly what Echo said it would. The gang does not blow the dam; the coast needs it. Hannah sets the gates to a slow, even release, the kind the coast can live with, and the collars come off every conscript on the gallery. Downstream, the taps run again. Nobody owns the water now.',
  bossCard:'MARSHAL OF THE CROWN DAM',bossToast:'MARSHAL SABLE · WAIT FOR THE RELOAD',
  bossSay:['SABLE: Order keeps the water flowing, Tenrec. You are out of order.'],
  bossLines:{reload:'MUSTAPHA: He’s reloading! Now!',p60:'SABLE: Guard! Somebody earn your ration!'},
  phase2:{card:'SABLE AT THE GATE CONTROLS',toast:'SABLE TAKES THE GATE CONTROLS',say:'SABLE: Every gate on the coast answers to this chair. Watch.',lines:{p50:'HANNAH: Hit the controls when the water drops!'},defeat:'MUSTAPHA: The controls are smashed! He can’t work the gates now!'},
  gateSay:'HANNAH: His remote is dead! Open the spillway before the dam tops out!',
  spillwaySay:'MUSTAPHA: Spillway’s open! Wait… where’s Sable? What is he doing?',
  lastCopy:{card:'CROWNBACK · THE CROWN TREATMENT',toast:'SABLE TAKES THE UNFINISHED TREATMENT',
   say:['HANNAH: He’s injecting the treatment! Echo said it wasn’t finished!','SABLE: No gate will hold for me? Then I will be the gate.'],
   byHero:{mustapha:'SABLE: Cairo, the engineer. Tell me what a dam weighs.',jack:'SABLE: Tenrec. You fix broken machines. Fix this.',hannah:'SABLE: Envoy. Go tell Wassoon who holds the water now.',mess:'SABLE: O’Bradovich. You were always the strong one. Not today.'},
   lines:{wheel:'MESS: Turn the bypass wheel! Hit him with the river!',p66:'HANNAH: His shield arm is cracking!',p33:'MUSTAPHA: The plates are coming off. He can’t hold his brace!',p20:'MESS: He’s going down! Keep hitting!',defeat:'SABLE: The water… was mine… to hold…',after:'JACK: Nobody holds it now. Set the gates to a slow release.'}},
  sections:[
   {name:'THE SPILLWAY ROAD',stage:'6-1',cap:'THE DAM TERRACES',say:'SABLE: Welcome to the Crown, heroes. Mind the water.',enc:[
     {w:[['raider','gunner'],['mutant','knifer','raider']]},
     {w:[['brute','gunner'],['regent','mutant','knifer']],from:'L',say:'MUSTAPHA: Collared men in the ranks. Those are Rook’s prisoners!'}]},
   {name:'THE CROWN GUARD',stage:'6-2',say:'HANNAH: The marshal’s Crown Guard. His best, and his last.',enc:[
     {w:[['mutant','gunner']],say:'JACK: Gate captain. Knock him off the gallery!',
      elite:{type:'gunner',variant:'skinner',name:'GATE CAPTAIN',hp:400,flee:true,after:'HANNAH: He dropped his keys and ran. Smart man.'},
      after:'HANNAH: He dropped his keys and ran. Smart man.'},
     {w:[['knifer','raider']],from:'B',say:'MESS: Another captain. This one’s got the sluice keys.',
      elite:{type:'brute',variant:'wrenchT',name:'SLUICE CAPTAIN',hp:400}}]},
   {name:'THE GALLERY',stage:'6-3',cap:'THE DAM GALLERY',say:'SABLE: The gallery holds. My sergeant has never lost a fight.',enc:[
     {w:[['mutant','knifer','gunner'],['brute','knifer']],from:'B'},
     {w:[['gunner']],say:'HANNAH: That’s his sergeant. He’s held this gallery for years.',
      elite:{type:'brute',variant:'hammerT',name:'CROWN SERGEANT',hp:460,after:'JACK: He’s done. Hannah, the key. Let’s free these crews.'},
      after:'JACK: He’s done. Hannah, the key. Let’s free these crews.'}]},
   {name:'BREAK THE COLLARS',stage:'6-4',say:'HANNAH: Echo’s key works! Every pylon we break frees another crew!',enc:[
     {w:[['mutant','gunner','raider'],['brute','knifer']],task:0},
     {w:[['knifer','mutant'],['gunner','brute','knifer']],from:'B',task:1},
     {w:[['knifer','regent','gunner'],['mutant','raider']],from:'B',task:2}]},
   {name:'THE FLOODGATE GALLERY',stage:'6-5',cap:'THE CROWN FLOODGATE',say:'JACK: Freed crews against the guard. Stay with the ones on our side!',enc:[
     {w:[['brute','mutant','knifer'],['raider','gunner','brute']],from:'R'},
     {w:[['knifer','brute','raider'],['regent','brute','gunner']],from:'R',say:'CONSCRIPT: No more collars. No more permits. We choose now.'}]},
   {name:'THE CROWN FLOODGATE',stage:'6-6',say:'SABLE: Every man here drinks because I allow it. Today, so do you.',enc:[
     {w:[['brute','regent','gunner'],['mutant','knifer'],['mutant','raider','knifer']],from:'B'},
     {boss:true}]}]}
];

/* Attract story, in the 1993 five-beat shape (picture panels, then portraits), all new lines. */
window.EDEN_INTRO=[
 {layout:'A',pic:'p-sink-night',lines:['SIX MONTHS AGO THE SEA','POURED INTO FESSENDEN’S LAB.']},
 {layout:'A',pic:'p-salvage-boats',lines:['THE FLOOD TOOK THE COAST.','SALVAGERS TOOK HIS LAB.']},
 {layout:'B',who:'mustapha',lines:['AND THE MARSHAL TOOK','THE CROWN DAM. EVERY TAP','ON THE COAST IS HIS.']},
 {layout:'B',who:'hannah',lines:['WATER BY PERMIT ONLY.','EVERY PERMIT CARRIES','HIS BRASS SEAL.']},
 {layout:'B',who:'jack',lines:['A DROWNED COAST AND ONE','MAN HOLDING THE TAP.','THAT’S NO KIND OF BALANCE.']}
];

/* Ending cut-scene beats (ending() state; §11 of CAMPAIGN.md). Dialogue boxes keep the 30-character panel limit.
   'sable' speaks with a name tag (no villain has a ROM portrait); 'self' is the selected hero, who goes back for the
   conscript who fell. */
window.EDEN_ENDING=[
 {beat:'fall',who:'sable',lines:['THE WATER...','WAS MINE... TO HOLD...']},
 {beat:'alarm',who:'mustapha',lines:['THE GATES ARE STUCK OPEN!','GET OFF THE SPILLWAY! MOVE!']},
 {beat:'run',caption:'TO THE GATEHOUSE!'},
 {beat:'choice',who:'self',lines:['GET UP. NOBODY GETS','LEFT ON THIS DAM.']},
 {beat:'dawn',pic:'p-dam-dawn',caption:'MORNING. THE WATER RUNS FREE.'},
 {beat:'road',pic:'p-sunset-road',boxes:[
   {who:'mustapha',lines:['THE GATES RUN AT HALF.','EVERY TAP ON THE COAST','IS RUNNING.']},
   {who:'hannah',lines:['AND HIS SEAL COMES OFF','EVERY DOOR IN WASSOON.']},
   {who:'jack',lines:['FESSENDEN TRIED IT. SABLE','TRIED IT. NATURE ALWAYS','BALANCES ITSELF.']},
   {who:'mess',lines:['LOOK! A BABY ANKYLOSAUR','BY THE CAUSEWAY!']},
   {who:'mustapha',lines:['HE NEEDS A NAME. MOSTAFA.','NOBODY SPELLS IT RIGHT','ANYWAY.']},
   {who:'mess',lines:['HEY... THAT CAR SEATS TWO','UP FRONT. JACK? JACK!']}]},
 {beat:'thanks',lines:['THANK YOU FOR PLAYING','A FAN SEQUEL MADE FOR MOSTAFA']}
];
