/* Fessenden's Legacy: the sequel starts six months after the exact 1993 ending (see STORY.md).
   Six chapters; each has three areas, six sections, 12-13 locked fights, an elite and a boss, and plays in four to
   five minutes. Encounter fields: w = reinforcement waves, from = R/L/B (both)/T (drop from above), task = mission
   task index, elite = mid-boss, say = radio line when the fight starts, after = radio line when the elite dies.
   Text is stored in sentence case and drawn in upper case in the ROM 8x16 font. Boss text is data (bossCard,
   bossToast, bossSay, bossLines, bossDefeat, phase2, spillwaySay, gateSay, lastCopy). Stage recipes: EDEN_STAGES
   (CAMPAIGN.md §12.2), authored under tools/re/levels/ch<N>.json and shipped as stage-data.js; section.stage is the key. */
window.EDEN_CAMPAIGN = [
 {name:'WASSOON',area:'01 / FACES FROM THE LAB',boss:'WARDEN ROOK',kind:'warden',clones:0.35,accent:'#8fb3e6',
  objPage:'S1A0',music:{stage:['06','06','07','07','08','08'],intro:'09',boss:'10'},
  card:{pre:'EASTCOAST 2513 · SIX MONTHS LATER',marker:'wassoon'},
  inter:[
   {layout:'A',pic:'p-barge-fire',lines:['HURRY UP! THE MARSHAL','WANTS THEM COLD.']},
   {layout:'A',pic:'p-pod-face',lines:['...BOSS? THIS ONE’S','BREATHING.']},
   {layout:'B',who:'mustapha',lines:['THAT’S BLK ELMER! WE PUT','HIM DOWN IN FESSENDEN’S LAB!']},
   {layout:'B',who:'hannah',lines:['NOBODY WALKED OUT OF THAT','LAB BUT US...']},
   {layout:'B',who:'jack',lines:['SOMEBODY’S MESSING WITH THE','BALANCE AGAIN.','THIS TIME WE FINISH IT.']}],
  brief:'Six months ago Dr. Fessenden took his own serum in the throne room of his Under World, the lab beneath the City in the Sea, and died a beast. The lab blew apart; Jack went back on foot for Hannah in the escape tunnel, and the Cadillac picked up Mustapha and Mess on the desert road at sunset. The captured Black Marketeers were shipped to Wassoon, Hannah’s city, to wait for the council’s judgement on a prison barge in the harbor. Tonight the gang is in Wassoon to testify. Then the harbor bells ring: the barge is burning, cold crates stamped with Fessenden’s seal are rolling ashore, and the men rolling them are men the gang watched fall in that lab.',
  dialog:'HANNAH: Nobody has ever broken out of Wassoon harbor.\nMUSTAPHA: Nobody comes back from the dead either. I saw them go down.\nJACK: Then let’s go ask them how they did it.',
  end:'Rook’s manifest lists cargo nobody should be able to sell: LOT 07, LOT 09, LOT 12, LOT 31. Men, numbered like stock, grown in cold pods. Lot 09 is the warden himself. Mess knew the face, and the face was the Butcher’s, the hunter the gang put down in the northern woods on the way to Fessenden. Somebody grew him again and gave him a new name. The seller signs as Dr. Echo, who ran the numbered tanks in Fessenden’s Bio Lab and slipped out before it blew. The buyer is Marshal Sable, the Wassoon lawman who took the captured Black Marketeers into custody six months ago and never brought a single one to trial. The jail-break was staged. The rest of the pods left at sundown on a convoy up the Coral Causeway.',
  bossCard:'WARDEN OF THE JAIL BARGE',bossToast:'WARDEN ROOK · BREAK THE BLOCKADE',
  bossSay:['MESS: Hey… I know that face.','ROOK: Never seen you before in my life. And it’s a short life.'],
  bossLines:{p60:'MUSTAPHA: The tide’s coming over the pier! Watch the front!',p40:'HANNAH: He’s swinging the crane! Watch for the shadow!',p25:'ROOK: Woods… why do I remember woods?'},
  bossDefeat:'ROOK: The woods. The hunt. My name was never… Rook.',
  sections:[
   {name:'THE SEA WALL',stage:'1-1',cap:'WASSOON HARBOR',say:'HANNAH: The jail barge is on fire! Who would attack Wassoon?',enc:[
     {w:[['raider','raider'],['raider','knifer']]},
     {w:[['knifer','raider'],['gunner','raider','knifer']],from:'L',say:'MUSTAPHA: Behind us! They came over the sea wall!'}]},
   {name:'THE COLD CRATES',stage:'1-2',say:'JACK: Fessenden’s seal on every crate. These came out of the lab.',enc:[
     {w:[['knifer','raider'],['raider','gunner','raider']],task:0},
     {w:[['brute','raider'],['knifer','knifer','gunner']],from:'L',say:'MESS: I know that face. He went down with the lab!'}]},
   {name:'THE CANNERY',stage:'1-3',cap:'THE JAIL QUAY',say:'MESS: Every one of these guys went down under the city. Every one!',enc:[
     {w:[['raider','knifer','raider'],['gunner','brute']],from:'T',say:'JACK: Off the cannery roof!'},
     {w:[['raider','knifer'],['gunner','raider']],say:'MESS: The big one’s mine. I flattened him in the Bio Lab!',
      elite:{type:'brute',variant:'blkElmer',name:'LOT 07 · HEAVY',hp:420,after:'JACK: He melted into green slime. That was never a man. It was a copy.'},
      after:'JACK: He melted into green slime. That was never a man. It was a copy.'}]},
   {name:'THE JAIL BARGE',stage:'1-4',say:'HANNAH: The barge is empty. Nobody broke out. They were let out.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider']],task:1},
     {w:[['knifer','gunner','raider'],['brute','knifer']],from:'T',say:'JACK: Up on the barge rail!'}]},
   {name:'THE BELL ROOFS',stage:'1-5',cap:'THE HARBOR GATE',say:'JACK: The pods are numbered. Somebody’s keeping count.',enc:[
     {w:[['knifer','raider','raider'],['gunner','brute','knifer']],from:'T',say:'HANNAH: They’re jumping the rooftops!'},
     {w:[['brute','gunner'],['raider','raider','knifer']],task:2}]},
   {name:'THE WARDEN’S GATE',stage:'1-6',say:'ROOK: Whatever you saw tonight, you didn’t see. Turn around.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider','raider'],['gunner','raider','raider']],from:'B'},
     {boss:true}]}]},

 {name:'THE CORAL CAUSEWAY',area:'02 / THE POD CONVOY',drive:true,boss:'LOT 44 · MACK',kind:'truck',clones:0.3,accent:'#e8a35a',
  objPage:'S3A0',music:{stage:['16','16','16','22','22','17'],intro:'18',boss:'19'},
  card:{marker:'causeway'},
  inter:[
   {layout:'B',who:'hannah',pic:'p-manifest',lines:['ROOK’S MANIFEST SAYS THE PODS','RIDE THE CORAL CAUSEWAY.'],lines2:['IT ONLY SURFACES AT','LOW TIDE.']},
   {layout:'A',pic:'p-convoy',lines:['MOVE IT! THE TIDE WON’T WAIT','AND NEITHER WILL THE MARSHAL.']},
   {layout:'B',who:'jack',lines:['SIX MONTHS IN THE SHOP.','LET’S SEE IF SHE STILL RUNS.','EVERYBODY IN THE CADILLAC!']}],
  brief:'Jack spent six months in the Mechanics’ yard rebuilding the Cadillac after the Under World. Tonight she runs again. Sable’s convoy is hauling Echo’s cold pods north over the Coral Causeway, an old highway the sea gives back only at low tide. Run down the outriders, knock the pods loose, drop the chain at the old toll post before the convoy reaches the mainland, and find out what is hauling the last wagon. It is not a truck.',
  dialog:'JACK: A road under the sea. Let’s hope the engine stays dry.\nMESS: And let’s hope those coral heads aren’t hungry.\nHANNAH: The tide turns in four minutes. Drive, Jack!',
  end:'The collar snaps. The big triceratops shakes its head, snorts at the Cadillac and trots off into the surf. Hannah pries open the last pod: a raptor hatchling asleep in green gel, wearing the same steel collar. The tag reads STOCK FROM TANK 03 · NURSERY · VERDANT BIODOME. Tank 03 stood in Fessenden’s Bio Lab with a raptor inside it; the gang ran right past it six months ago. The convoy’s logbook points inland, past the last settlement, to a ruined glass refinery dome on the jungle frontier, where Echo’s handlers are raising something much bigger. Sable’s voice, on the convoy radio: “Keep the pod, Tenrec. I have a whole nursery.”',
  bossCard:'VAT TRICERATOPS · CONVOY HAULER',bossToast:'LOT 44 · MACK · KNOCK THE COLLAR LOOSE',
  bossSay:['HANNAH: A triceratops on a leash! Don’t hurt it. Hit the collar!','MESS: Tell that to the triceratops!'],
  bossLines:{p66:'MUSTAPHA: It lifts its head after a charge. Ram it then!',p50:'JACK: The collar’s cracking. One more good hit!',p25:'MUSTAPHA: Water’s over the road. Finish it, Jack!'},
  bossDefeat:'HANNAH: Collar’s off. Go on, big fella. Go home.',
  sections:[
   {name:'LOW TIDE',stage:'2-1',cap:'THE CORAL CAUSEWAY',drive:true,say:'JACK: Tide’s out for an hour. Hang on to something.',enc:[
     {w:[['biker','biker'],['biker','gunner','biker']],from:'L',say:'MESS: Bikes on the causeway behind us!'},
     {w:[['biker','biker','biker'],['biker','biker'],['biker','biker']],from:'B',say:'MUSTAPHA: More bikes in the mirror!'}]},
   {name:'THE POD CONVOY',stage:'2-2',drive:true,say:'HANNAH: Pod wagons at twelve o’clock. Ram them loose, Jack!',enc:[
     {w:[['biker','biker','biker'],['biker','biker'],['biker','biker']],from:'B',say:'MUSTAPHA: Pteranodons! Keep your heads down!'},
     {w:[['biker','biker'],['biker','gunner','biker'],['biker','biker']],task:0}]},
   {name:'OUTRIDERS',stage:'2-3',drive:true,say:'MUSTAPHA: Big one on a bike, coming up fast!',enc:[
     {w:[['biker','biker','biker'],['biker','gunner'],['biker','biker']],from:'B',task:1},
     {w:[['biker','biker']],say:'JACK: That rider is Lot 31 from Rook’s manifest!',
      elite:{type:'biker',variant:'jump',name:'LOT 31 · OUTRIDER',hp:380,after:'HANNAH: The convoy’s stopping at the toll post. The road’s chained shut!'},
      after:'HANNAH: The convoy’s stopping at the toll post. The road’s chained shut!'}]},
   {name:'THE TOLL FORT',stage:'2-4',cap:'THE OLD TOLL POST',say:'JACK: Everybody out. That chain comes down on foot.',enc:[
     {w:[['raider','knifer'],['gunner','raider','brute']],from:'T',say:'MESS: Off the stockade wall!'},
     {w:[['knifer','raider','brute'],['gunner','gunner']],from:'L',say:'HANNAH: This was a Mechanics’ toll post. Sable just took it.'}]},
   {name:'THE BARRIER WINCH',stage:'2-5',say:'MESS: There’s the winch. Cover me while I crank it!',enc:[
     {w:[['gunner','raider','knifer'],['brute','gunner']],task:2},
     {w:[['raider','raider','knifer'],['brute','knifer','gunner']],from:'B',say:'MESS: Chain’s down! Jack, bring the car around!'}]},
   {name:'THE LAST WAGON',stage:'2-6',cap:'THE RISING TIDE',drive:true,say:'JACK: Back in the Cadillac. Something big is hauling the last pod.',enc:[
     {w:[['biker','biker','biker'],['biker','gunner'],['biker','biker','gunner']],from:'B'},
     {boss:true}]}]},

 {name:'THE VERDANT BIODOME',area:'03 / THE NURSERY',boss:'VERDANT REGENT',kind:'raptor',clones:0.4,accent:'#accb6d',
  objPage:'S2A0',music:{stage:['13','13','14','14','25','25'],intro:'18',boss:'15'},
  card:{marker:'frontier'},
  inter:[
   {layout:'B',who:'hannah',pic:'p-hatchling',lines:['A COLLAR ON A BABY RAPTOR?'],lines2:['SOMEBODY’S RAISING THEM','TO TAKE ORDERS.']},
   {layout:'B',who:'mustapha',pic:'p-dome',lines:['THE TAG SAYS VERDANT BIODOME.','AN OLD REFINERY DOME ON','THE JUNGLE FRONTIER.']},
   {layout:'A',pic:'p-regent-asleep',lines:['KEEP THE DRIVER RUNNING.','IF THE REGENT WAKES UP','HUNGRY... RUN.']}],
  brief:'Past the last settlement the road ends and the jungle begins. In a ruined glass refinery dome on the frontier, Echo’s handlers raise dinosaurs grown from the Bio Lab’s samples, lock steel collars on them and steer them with sonic lures. Wild herds are fleeing the noise. Knock the lures down, free what you can, and find out what sleeps at the heart of the dome, chained to a driver and built to rule the pack.',
  dialog:'HANNAH: Collars on every raptor. Somebody is steering them.\nMUSTAPHA: Remember the village? They said the dinosaurs went mad.\nJACK: They weren’t mad then either. Break the remote, not the dinosaur.',
  end:'With the driver dead, the Verdant Regent stops fighting and wanders back into the ferns, dragging its broken chain. It was Echo’s trial run for a living siege engine. In the handlers’ hut Hannah finds the farm ledger: every animal here was grown from samples hauled out of the Sink, the flooded crater under the City in the Sea where the Under World used to be. Echo’s salvage crews are down there now, pumping it dry and cutting toward the throne room where Fessenden died. Whatever is under that floor, Echo is paying Sable in dinosaurs to get it.',
  bossCard:'VAT ALLOSAURUS · LOT 50',bossToast:'VERDANT REGENT · SILENCE THE DRIVER',
  bossSay:['HANDLER: You broke my towers? Meet my best animal!','JACK: It’s waking up! Don’t fight it. Find the driver!'],
  bossLines:{p66:'MUSTAPHA: It’s calling the pack!',driverHit:'HANNAH: It’s getting drowsy. Keep hitting the driver!',leash:'MESS: It can’t reach past the chain. Stay wide!'},
  driverDeadSay:'HANNAH: The driver’s dead. Let it sleep. It never asked to be born.',
  sections:[
   {name:'THE LAST FENCE',stage:'3-1',cap:'THE GLASS PERIMETER',say:'MUSTAPHA: Last fence on the map. After this, it’s all jungle.',enc:[
     {w:[['raider','knifer'],['raptor','raider']]},
     {w:[['raptor','raptor'],['raider','gunner','raider']],from:'T',say:'HANNAH: Raptors in the trees. Look at those collars!'}]},
   {name:'THE COLLAR PENS',stage:'3-2',say:'JACK: An old refinery. They turned the glass hall into pens.',enc:[
     {w:[['raptor','raider'],['raptor','gunner','knifer']],task:0},
     {w:[['raptor','raptor','raider'],['brute','gunner']],from:'B',set:'naguri-vignette',say:'MESS: They’re beating a raptor! Get ’em off it!'}]},
   {name:'THE EGG RACKS',stage:'3-3',cap:'THE HATCHERY',say:'HANNAH: Egg racks under the glass. Hundreds, stamped with pen numbers.',enc:[
     {w:[['raptor','raptor'],['raider','knifer','raider']],from:'T',say:'JACK: They’re dropping out of the vines!'},
     {w:[['raptor','raider']],say:'MESS: That one’s twice the size of the others!',
      elite:{type:'raptor',variant:'hopper',palette:'t74-e8a0-pal31',name:'PACK ALPHA · VAT RAPTOR',hp:400,after:'HANNAH: Not dead. Calm. Its collar cracked. It’s just going home.'},
      after:'HANNAH: Not dead. Calm. Its collar cracked. It’s just going home.'}]},
   {name:'THE RIVER WALK',stage:'3-4',say:'JACK: Lure tower by the river. Knock it down.',enc:[
     {w:[['raptor','gunner','knifer'],['raptor','brute']],task:1},
     {w:[['raider','raider','raptor'],['gunner','gunner','knifer']],from:'L',say:'MUSTAPHA: Handlers on the bank. They’re calling the pack back!'}]},
   {name:'THE NEST TRAIL',stage:'3-5',cap:'THE NEST',say:'HANNAH: Listen. Something big is breathing up ahead.',enc:[
     {w:[['raptor','raptor','knifer'],['gunner','brute']],from:'T'},
     {w:[['raptor','raider','gunner'],['brute','raider','raptor']],task:2}]},
   {name:'THE REGENT’S NEST',stage:'3-6',say:'MUSTAPHA: A collar like a crown, on a beast that size. Built to rule.',enc:[
     {w:[['raptor','raider','gunner'],['gunner','raptor'],['brute','raider','knifer']],from:'L',say:'HANNAH: The handlers are cornered. They’re throwing everything at us!'},
     {w:[['raptor','raider','gunner'],['brute','raptor'],['brute','knifer','raptor']],from:'B'},
     {boss:true}]}]},

 {name:'THE SINK',area:'04 / WHERE IT ENDED',boss:'FOREMAN CINDER',kind:'cinder',clones:0.5,accent:'#5fc4b0',
  objPage:'S8A1',music:{stage:['30','30','29','29','20','20'],intro:'23',boss:'24'},
  card:{marker:'city-in-the-sea'},
  inter:[
   {layout:'B',who:'hannah',pic:'p-ledger',lines:['EVERY ANIMAL IN THAT LEDGER','CAME OUT OF THE SINK.'],lines2:['THE LAB. SIX MONTHS LATER.']},
   {layout:'B',who:'mess',lines:['I SAID I’D NEVER GO BACK','DOWN THERE.']},
   {layout:'B',who:'jack',lines:['LAST TIME, THAT PLACE BLEW','UP BEHIND US.','LET’S NOT STAY FOR ROUND TWO.']}],
  brief:'The gang goes back down. Six months after the blast, the Under World is a flooded crater beneath the City in the Sea that the locals call the Sink. The escape tunnel where Hannah fell now opens onto black water, the Bio Lab’s numbered tanks are shattered, and whatever was inside them got out. Echo’s salvage crews have pumped half the crater dry and are cutting toward the throne room where Fessenden died. Open the three sea valves, drown the dig, and find out what Echo came back for.',
  dialog:'MESS: I said I’d never come back down here.\nHANNAH: Then we make it quick.\nJACK: Last time this place blew up. Let’s not stay for round two.',
  end:'Cinder stabs a syringe of Fessenden’s serum into his own neck and starts to change, the way Morgan changed in the Village of Flame. Halfway through, he melts. The serum was made for one man; on a copy it only unmakes him. Dying, he gives the gang the truth. The floor where they fought Fessenden has been cut open. Under it was a drain tank that caught everything spilled in that fight, and its tag reads 4 DONORS: TENREC, DUNDEE, CAIRO, O’BRADOVICH, and a fifth entry with no name, only a number: 00. Echo has their blood, and Echo has him. “Not that doctor,” Cinder says. “His echo. Up at the observatory, on the cliffs.” Her salvage boats are already heading north.',
  bossCard:'FOREMAN OF THE DIG · LOT 05',bossToast:'FOREMAN CINDER · DODGE THE SLAG',
  bossSay:['MUSTAPHA: It’s Morgan! The little man from the Village of Flame!','CINDER: Morgan burned. I’m what came out of the vat.'],
  bossLines:{p50:'CINDER: Pumps! Give them the sea!',p25:'CINDER: The doctor gave me one dose. For emergencies.'},
  bossDefeat:'CINDER: It won’t… take. Made for one man. Never for us.',
  sections:[
   {name:'WHERE HANNAH FELL',stage:'4-1',cap:'THE SINK',say:'HANNAH: This is where I fell that night. Somebody else was down here.',enc:[
     {w:[['raider','brute'],['knifer','raider','gunner']]},
     {w:[['brute','raider'],['raider','gunner','raider']],from:'T',say:'JACK: Salvage crew on the ropes. Heads up!'}]},
   {name:'THE SHATTERED TANKS',stage:'4-2',say:'HANNAH: Every tank is broken. Tank 03 is empty. The raptor’s tank.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider']],task:0},
     {w:[['gunner','gunner','raider'],['raider','knifer','raider']],from:'B',say:'MESS: Something crawled out of the water. And it’s not a fish!'}]},
   {name:'THE DRAIN',stage:'4-3',cap:'THE DROWNED CAVES',say:'JACK: The drains run to the throne room. So did everything we spilled.',enc:[
     {w:[['raider','knifer','gunner'],['brute','raider']],from:'T',say:'MUSTAPHA: Off the pump scaffold!'},
     {w:[['gunner','raider']],say:'MESS: The water’s moving. Something big lives down here now.',
      elite:{type:'regent',variant:'tyrog',palette:'t10-e6a2-pal29',name:'BROOD MOTHER',hp:460,after:'JACK: She’s gone back under. Nobody follow her.'},
      after:'JACK: She’s gone back under. Nobody follow her.'}]},
   {name:'THE PUMP SCAFFOLDS',stage:'4-4',say:'HANNAH: Echo’s pumps. Open the sea valves and the dig floods.',enc:[
     {w:[['knifer','gunner','raider'],['brute','raider']],task:1},
     {w:[['raider','raider','knifer'],['gunner','brute','raider']],from:'T',say:'MUSTAPHA: Bombers on the scaffold!'}]},
   {name:'THE DROWNED THRONE',stage:'4-5',cap:'THE THRONE ROOM',say:'JACK: This is where he died. The capsule’s gone. The floor’s cut open.',enc:[
     {w:[['mutant','raider','gunner'],['brute','knifer']],from:'L'},
     {w:[['brute','gunner','knifer'],['mutant','raider','raider']],task:2}]},
   {name:'CINDER’S DIG',stage:'4-6',say:'CINDER: I burned once, in a village. Now I run the pumps.',enc:[
     {w:[['brute','raider','gunner'],['mutant','knifer','raider'],['mutant','knifer','raider']],from:'B'},
     {boss:true}]}]},

 {name:'THE OBSERVATORY',area:'05 / DR. ECHO',boss:'LOT 04 · SLICE',kind:'echo',clones:0.8,accent:'#7bd6c9',
  objPage:'S7A1',music:{stage:['21','21','08','08','07','07'],intro:'23',boss:'10'},
  card:{marker:'cliffs'},
  inter:[
   {layout:'B',who:'mustapha',pic:'p-observatory',lines:['AN OBSERVATORY FROM THE OLD','WORLD. THE DISH STILL TURNS.']},
   {layout:'C',pic:'p-echo-speaker',lines:['YOU BROKE HIS BODY.','YOU NEVER BROKE HIS WORK.']},
   {layout:'B',who:'hannah',lines:['THIS IS HANNAH DUNDEE.','WE’RE COMING IN TO FINISH IT.']}],
  brief:'On the cliffs north of the City in the Sea stands an observatory from the old world, its dome cracked open to the sky. Dr. Echo has built her laboratory inside it, copied room for room from Fessenden’s Vault: the same shelves, the same consoles, the same numbered tanks. Its dish sends the command signal that tells every collar and every copy what to do, and four of her tanks carry the heroes’ names. Jam the three control channels, get through the vat hall, and stop the woman who finished Fessenden’s work.',
  dialog:'ECHO: You broke his body. You never broke his work.\nHANNAH: This is Hannah Dundee. We’re coming in to finish it.\nMESS: Does she know there’s a tank with my name on it? Because I do.',
  end:'Slice’s copy goes to gel, and the voice in the dome stops mid-sentence. The gang finds Dr. Echo at her console with the dish already dark, and she surrenders without a fight: “You can’t punch an idea.” She tells them the rest herself. The Mirror Gang, four copies with the heroes’ fists and their memories up to the night Fessenden died, has already shipped to Marshal Sable at the Crown dam, with one sealed tank the manifests call only LOT 00. She plays Fessenden’s last recording to prove it: “Genius does not die. It is copied.” Hannah takes Echo’s command key. If it controls the copies, it can set them free. The council’s riders take Echo back to Wassoon.',
  bossCard:'ECHO’S BODYGUARD · GROWN AGAIN',bossToast:'LOT 04 · SLICE · BREAK HIS RHYTHM',
  bossSay:['JACK: Slice?! We beat you at my garage. Fessenden made you a lizard!','SLICE: I remember the tank, Jack. I remember the scales.'],
  bossLines:{p66:'ECHO: Drain tank six.',p50:'SLICE: Which one of me did you kill? The man or the lizard?',p33:'ECHO: Wake the unfinished ones.'},
  bossDefeat:'SLICE: …The voice stopped. Thanks.',
  sections:[
   {name:'THE CLIFF ROAD',stage:'5-1',cap:'THE CLIFF ROAD',say:'HANNAH: That dish is sending Echo’s orders. Her lab is under the dome.',enc:[
     {w:[['gunner','knifer'],['raider','mutant']]},
     {w:[['mutant','raider','gunner'],['knifer','brute']],from:'B',say:'MESS: Pteranodons off the cliff! Heads down!'}]},
   {name:'THE INSTRUMENT FLOOR',stage:'5-2',cap:'THE COPIED VAULT',say:'MUSTAPHA: Old-world brass. Somebody kept this place running for her.',enc:[
     {w:[['mutant','gunner'],['raider','knifer','mutant']],task:0},
     {w:[['regent','mutant','raider'],['gunner','knifer']],from:'L',say:'JACK: Lizard men! Out of the drains!'}]},
   {name:'THE COPIED ARCHIVE',stage:'5-3',say:'HANNAH: These are the Vault’s shelves. She copied the whole room.',enc:[
     {w:[['gunner','mutant','knifer'],['raider','brute']],from:'B'},
     {w:[['mutant']],say:'ECHO: Meet my best work. It learned everything from your blood.',
      elite:{type:'mirror',hero:1,name:'MIRROR TEST',hp:420,after:'MESS: It was fast, but it stopped to think. We never do.'},
      after:'MESS: It was fast, but it stopped to think. We never do.'}]},
   {name:'THE VAT HALL',stage:'5-4',cap:'THE VAT HALL',say:'JACK: That’s… us. All four of us, floating in green soup.',enc:[
     {w:[['knifer','gunner','knifer'],['mutant','brute']],task:1},
     {w:[['mutant','mutant','raider'],['regent','gunner']],from:'B',say:'MESS: There’s a tank with my name on it. Literally!'}]},
   {name:'THE BROADCAST ROOM',stage:'5-5',say:'JACK: Last channel. Jam it and her signal dies for miles.',enc:[
     {w:[['gunner','regent','raider'],['mutant','brute','knifer']],task:2},
     {w:[['mutant','brute','raider'],['gunner','gunner']],from:'T',say:'ECHO: Every channel you jam, I open two more.'}]},
   {name:'THE LENS HALL',stage:'5-6',say:'ECHO: He trusted me with everything. I’m only finishing what he started.',enc:[
     {w:[['regent','mutant','gunner'],['brute','knifer'],['brute','mutant','gunner']],from:'B',say:'HANNAH: Her bodyguard is waiting under the lens. I know that walk.'},
     {boss:true}]}]},

 {name:'THE CROWN SPIRE',area:'06 / MIRROR WAR',boss:'MARSHAL SABLE',kind:'sable',clones:1,accent:'#c9a0ff',
  objPage:'S8A2',music:{stage:['22','22','20','20','29','30'],intro:'09',boss:'15',engine:'24',lastCopy:'32'},
  card:{marker:'river-head'},
  inter:[
   {layout:'B',who:'mustapha',pic:'p-crown-dam',lines:['THE CROWN DAM. SABLE WIRED','ECHO’S LAST VATS INTO THE','TURBINES.']},
   {layout:'A',pic:'p-mirror-gang',lines:['WE REMEMBER THE LAB TOO.','WE REMEMBER EVERYTHING.']},
   {layout:'A',pic:'p-sable',lines:['WHY HIRE AN ARMY','WHEN YOU CAN GROW ONE?','MINE NEVER RUNS OUT.']},
   {layout:'B',who:'hannah',lines:['ECHO’S KEY CAN SET THEM FREE.','AND ONE TANK IS STILL SEALED.','LOT 00.']}],
  brief:'A crumbling gothic spire stands over the Crown dam, the last power the coast has left. Sable has wired Echo’s last vat hall into the dam turbines and set Fessenden’s salvaged throne capsule, dragged out of the Sink, at the heart of a machine he calls the Crown Engine. Behind the gates wait his clone army and the Mirror Gang, copies of all four of you. Hannah has Echo’s command key. Beat the copies, break the command pylons and turn Sable’s clones against him. One tank is still sealed, and the manifest only calls it LOT 00.',
  dialog:'SABLE: Why hire an army when you can grow one that never runs out?\nMUSTAPHA: Funny thing about copies. They remember who they came from.\nJACK: Fessenden promised us new lives. Let’s go see what he meant.',
  end:'The freed clones drag Sable out of the Crown Engine, and when the spillway drowns the turbines Fessenden’s old capsule cracks open. What climbs out was never one of the gang. Echo could never bring back Fessenden himself, only copies, and this was the one copy his serum was made for: grown from the drain under the throne room, from the beast he had already become, with his memory running to the second he died. It dies the way every copy dies, into green gel, and this time there is nothing left to grow another from. The command signal is gone. For the first time, every copy can choose for itself.',
  bossCard:'BOSS OF THE BLACK MARKETEERS',bossToast:'MARSHAL SABLE · STOP THE MARSHAL',
  bossSay:['SABLE: Six shots, Tenrec. That’s plenty.'],
  bossLines:{reload:'MUSTAPHA: He’s reloading! Now!',p60:'SABLE: Boys! Somebody earn your vat!'},
  phase2:{card:'FESSENDEN’S CAPSULE · DAM TURBINES',toast:'SABLE BOARDS THE CROWN ENGINE',say:'SABLE: Fessenden’s chair. Let’s see what it does for a living man.',lines:{p50:'HANNAH: Hit the capsule when the water drops!'},defeat:'MUSTAPHA: The engine’s stalling! He’s stuck in Fessenden’s chair!'},
  gateSay:'HANNAH: The engine’s dead. Open the spillway and drown the turbines!',
  spillwaySay:'MUSTAPHA: Spillway open! The turbines are drowning. The vats go dark!',
  lastCopy:{card:'THE LAST COPY',toast:'THE CAPSULE CRACKS OPEN',
   say:['HANNAH: The capsule’s cracking. Something’s inside!','JACK: It isn’t him. It’s a copy. Copies can be deleted.'],
   byHero:{mustapha:'FESSENDEN: Mr. Cairo. Still fixing engines? I fixed death.',jack:'FESSENDEN: Tenrec. You broke my body. Echo kept a spare.',hannah:'FESSENDEN: Miss Dundee. I offered you a new life. You still owe me one.',mess:'FESSENDEN: O’Bradovich. You hit hard. I mutate harder.'},
   lines:{wheel:'MESS: Turn the wheel! Hit it with the river!',p66:'HANNAH: One of its heads just melted!',p33:'MUSTAPHA: An arm’s gone. It’s falling apart. Keep hitting!',p20:'MESS: It’s going down! Finish the heads!',defeat:'FESSENDEN: No! Not again! I’m not finish—',after:'HANNAH: Nothing left to copy. It’s over.'}},
  sections:[
   {name:'THE SPIRE APPROACH',stage:'6-1',cap:'THE SPIRE TERRACES',say:'SABLE: Welcome to the Crown, heroes. I’ve made a few improvements.',enc:[
     {w:[['raider','gunner'],['mutant','knifer','raider']]},
     {w:[['mirror','gunner'],['regent','mutant','knifer']],from:'L',say:'MUSTAPHA: Copies of us in the ranks. Sable is mass-producing us!'}]},
   {name:'THE MIRROR GANG',stage:'6-2',say:'HANNAH: There they are. The Mirror Gang.',enc:[
     {w:[['mutant','gunner']],say:'JACK: Like fighting yourself in a funhouse.',
      elite:{type:'mirror',hero:1,name:'MIRROR CLONE',hp:400,after:'HANNAH: It’s not dissolving. It’s just… walking away.'},
      after:'HANNAH: It’s not dissolving. It’s just… walking away.'},
     {w:[['knifer','raider']],from:'B',say:'MESS: Another one. It even cracks its knuckles like us.',
      elite:{type:'mirror',hero:2,name:'MIRROR CLONE',hp:400}}]},
   {name:'YOU VS. YOU',stage:'6-3',cap:'THE SPIRE HALLS',say:'???: I remember the lab too. I remember everything you remember.',enc:[
     {w:[['mutant','knifer','gunner'],['brute','knifer']],from:'B'},
     {w:[['gunner']],say:'HANNAH: That one’s yours. Same moves. Same stubborn face.',
      elite:{type:'mirror',hero:0,name:'YOUR OWN CLONE',hp:520,after:'YOUR CLONE: …Why are you holding back? …Why am I?'},
      after:'YOUR CLONE: …Why are you holding back? …Why am I?'}]},
   {name:'BREAK THE COMMAND',stage:'6-4',say:'HANNAH: Echo’s key works! Every pylon we break frees another batch!',enc:[
     {w:[['mutant','gunner','raider'],['brute','knifer']],task:0},
     {w:[['knifer','mutant'],['gunner','brute','mirror']],from:'B',task:1},
     {w:[['mirror','regent','gunner'],['mutant','mirror']],from:'B',task:2}]},
   {name:'THE CLONE WAR',stage:'6-5',cap:'THE CROWN FLOODGATE',say:'JACK: Clones fighting clones. Stay with the ones on our side!',enc:[
     {w:[['mirror','mutant','knifer'],['mirror','gunner','brute']],from:'R'},
     {w:[['mirror','brute','mirror'],['regent','mirror','gunner']],from:'R',say:'FREED CLONE: We choose. Not Echo. Not Sable. Us.'}]},
   {name:'THE CROWN FLOODGATE',stage:'6-6',say:'SABLE: Every clone obeys whoever holds the signal. Today, that’s me.',enc:[
     {w:[['mirror','regent','gunner'],['mutant','mirror'],['mutant','mirror','knifer']],from:'B'},
     {boss:true}]}]}
];

/* Attract story, in the 1993 five-beat shape (picture panels, then portraits), all new lines. */
window.EDEN_INTRO=[
 {layout:'A',pic:'p-sink-night',lines:['SIX MONTHS AGO THE SEA','POURED INTO FESSENDEN’S LAB.']},
 {layout:'A',pic:'p-salvage-boats',lines:['SOMETHING IS BEING HAULED','UP OUT OF THE SINK.']},
 {layout:'B',who:'mustapha',lines:['COLD CRATES WITH HIS SEAL.','SOLD BY THE LOT.']},
 {layout:'B',who:'hannah',lines:['AND THE MEN CARRYING THEM','ARE MEN WE SAW DIE.']},
 {layout:'B',who:'jack',lines:['FESSENDEN’S DEAD. WE WATCHED','THAT LAB GO UP.','SO WHO’S SHOPPING IN HIS','GRAVE?']}
];

/* Ending cut-scene beats (new ending() state; §11 of CAMPAIGN.md). Dialogue boxes keep the 30-character panel limit. */
window.EDEN_ENDING=[
 {beat:'fall',who:'fessenden',lines:['NO! NOT AGAIN!','I’M NOT FINISH—']},
 {beat:'alarm',who:'mustapha',lines:['THE DAM’S LETTING GO!','GET TO THE GALLERY! MOVE!']},
 {beat:'run',caption:'DON’T LOOK BACK!'},
 {beat:'choice',who:'clone',lines:['GET UP. I REMEMBER','HOW THIS GOES.']},
 {beat:'dawn',pic:'p-dam-dawn',caption:'MORNING ON THE CROWN.'},
 {beat:'road',pic:'p-sunset-road',boxes:[
   {who:'mustapha',lines:['EVERYBODY’S ALRIGHT!','...TWICE OVER.']},
   {who:'jack',lines:['TWICE NOW FESSENDEN TRIED','TO TIP THE SCALES.']},
   {who:'hannah',lines:['FESSENDEN TRIED TO CHEAT','NATURE TWICE. TWICE, NATURE','BALANCED ITSELF.']},
   {who:'clone',lines:['GUESS I NEED MY OWN NAME.']},
   {who:'mustapha',lines:['TAKE “MOSTAFA”. NOBODY','SPELLS IT RIGHT ANYWAY.']},
   {who:'mess',lines:['HEY... THAT CAR SEATS TWO','UP FRONT. JACK? JACK!']}]},
 {beat:'thanks',lines:['THANK YOU FOR PLAYING','A FAN SEQUEL MADE FOR MOSTAFA']}
];
