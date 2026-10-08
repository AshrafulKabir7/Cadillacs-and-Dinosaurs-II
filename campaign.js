/* Fessenden's Legacy — the sequel picks up six months after the first game's ending.
   Each chapter is six sections long and plays in about four to five minutes: two fights per section that enter from
   off screen, a mid-boss, then the boss. Encounter fields: w = reinforcement waves, from = R/L/B (both)/T (drop from
   above), task = mission task index, elite = mid-boss, say = radio line when the fight starts. */
window.EDEN_CAMPAIGN = [
 {name:'THE DROWNED HARBOR',area:'01 / FACES FROM THE LAB',theme:'harbor',boss:'WARDEN ROOK',kind:'warden',clones:0.35,accent:'#efb36d',
  brief:'Six months ago Dr. Fessenden injected himself with his own serum and died when his jungle laboratory blew apart. Jack and Hannah escaped in the Cadillac, and the poacher ring was broken. Tonight Mustapha’s radio crackles: poachers are unloading refrigerated crates at the harbor — crates stamped with Fessenden’s laboratory seal. Some of the men carrying them are men the gang watched fall in that lab.',
  dialog:'MUSTAPHA: I knocked that guy cold in Fessenden’s lab. Same scar. Same hat.\nHANNAH: Then why is he standing on the dock?\nJACK: Let’s go ask him.',
  end:'Rook’s cargo manifest lists “LOT 07, LOT 12, LOT 31” — people, numbered like stock. The buyer is Marshal Sable, who has taken over the Black Marketeers. The seller signs as Dr. Echo, Fessenden’s chief assistant, who walked out of the lab before it burned. The rest of the pods are already on a convoy heading up the Coral Causeway.',
  sections:[
   {name:'THE SILENT DOCKS',say:'MUSTAPHA: Poachers on our docks again. I thought we finished them for good.',enc:[
     {w:[['raider','raider'],['raider','knifer']]},
     {w:[['knifer','raider'],['gunner','raider','knifer']],from:'L',say:'HANNAH: Behind us! They came off a fishing boat.'}]},
   {name:'THE COLD CRATES',say:'HANNAH: That’s Fessenden’s seal on the crates. They came out of the jungle lab.',enc:[
     {w:[['knifer','raider'],['raider','gunner','raider']],task:0},
     {w:[['brute','raider'],['knifer','knifer','gunner']],from:'L'}]},
   {name:'FAMILIAR FACES',say:'MESS: I know these faces. Every one of them went down in the lab.',enc:[
     {w:[['raider','knifer','raider'],['gunner','brute']],from:'T',say:'JACK: They’re coming off the cargo stacks!'},
     {w:[['raider','knifer'],['gunner','raider']],elite:{type:'brute',name:'LOT 07 · HEAVY',hp:420,scale:1.6},say:'MESS: That one’s mine. He took a swing at me in the lab.',after:'JACK: He melted into green slime. That was never a man — it was a copy.'}]},
   {name:'THE LIGHTHOUSE LANE',say:'HANNAH: Copies grown from the dead. Fessenden’s work didn’t die with him.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider']],task:1},
     {w:[['knifer','gunner','raider'],['brute','knifer']],from:'T',say:'JACK: Up on the lighthouse catwalk!'}]},
   {name:'THE FUEL PIER',say:'JACK: The pods are labelled. Somebody is keeping count.',enc:[
     {w:[['knifer','raider','raider'],['gunner','brute','knifer']],from:'T'},
     {w:[['brute','gunner'],['raider','raider','knifer']],task:2}]},
   {name:'ROOK’S BLOCKADE',say:'ROOK: Whatever you saw tonight, you didn’t see it. Turn around.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider','raider'],['gunner','raider','raider']],from:'B'},
     {boss:true}]}]},

 {name:'THE CORAL CAUSEWAY',area:'02 / THE POD CONVOY',theme:'highway',drive:true,boss:'IRON CONVOY',kind:'truck',clones:0.3,accent:'#d2df7b',
  brief:'Sable’s convoy is hauling Dr. Echo’s stasis pods through a coral canyon on a highway exposed by the falling tide. Jack takes the wheel. Run down the outriders, recover the pods before they reach the toll fort, and reach the storm gate before the causeway floods.',
  dialog:'JACK: A road under the sea. Let’s hope the engine stays dry.\nMESS: And let’s hope those ribs in the coral aren’t hungry.',
  end:'Hannah pries open a recovered pod. Inside, a raptor hatchling sleeps in green gel, wearing a control collar. The tag reads: NURSERY — VERDANT BIODOME. STOCK: FESSENDEN’S PENS. The coordinates point to a refinery sealed inside a ruined glass bio-dome.',
  sections:[
   {name:'BROKEN EXPRESSWAY',drive:true,say:'JACK: The tide is turning. Hang on to something.',enc:[
     {w:[['biker','biker'],['biker','gunner','biker']],from:'L',say:'MESS: Bikes on the bridge behind us!'},
     {w:[['biker','biker','biker'],['biker','biker']],from:'B',say:'MESS: More bikes in the mirror!'}]},
   {name:'THE POD CONVOY',drive:true,say:'HANNAH: Pods at twelve o’clock. Ram the crates loose, Jack.',enc:[
     {w:[['biker','biker','biker'],['biker','biker']],from:'B'},
     {w:[['biker','biker'],['biker','gunner','biker']],task:0}]},
   {name:'OUTRIDERS',drive:true,say:'MUSTAPHA: Big one on a bike coming up behind us!',enc:[
     {w:[['biker','biker','biker'],['biker','gunner']],from:'B',task:1},
     {w:[['biker','biker']],elite:{type:'biker',name:'LOT 31 · OUTRIDER',hp:380,scale:1.35},say:'JACK: That rider is Lot 31 from the manifest.',after:'HANNAH: The convoy is stopping at the toll fort. The Skyway is chained shut.'}]},
   {name:'THE TOLL FORT',say:'JACK: Everybody out. Somebody has to drop that barrier on foot.',enc:[
     {w:[['raider','knifer'],['gunner','raider','brute']],from:'T',say:'JACK: Off the toll booth roofs!'},
     {w:[['knifer','raider','brute'],['gunner','gunner']],from:'L',say:'HANNAH: They’re pouring out of the toll booths.'}]},
   {name:'THE BARRIER WINCH',say:'MESS: There’s the winch. Cover me while I crank it.',enc:[
     {w:[['gunner','raider','knifer'],['brute','gunner']],task:2},
     {w:[['raider','raider','knifer'],['brute','knifer','gunner']],from:'B',say:'MESS: Barrier’s down! Jack, bring the car around!'}]},
   {name:'THE LAST ESCORT',drive:true,say:'JACK: Back in the Cadillac. That armored truck has the last of the pods.',enc:[
     {w:[['biker','biker','biker'],['biker','gunner'],['biker','biker','gunner']],from:'B'},
     {boss:true}]}]},

 {name:'THE VERDANT BIODOME',area:'03 / THE NURSERY',theme:'jungle',boss:'VERDANT REGENT',kind:'raptor',clones:0.4,accent:'#accb6d',
  brief:'Echo has converted an abandoned botanical refinery into a sealed dinosaur hatchery. Her handlers pipe nutrients through the cracked bio-dome and steer vat-grown raptors with sonic lures. At the heart of the dome waits the Verdant Regent, a prehistoric predator fitted with Cinder’s armor and Echo’s neural collar. Break the lures and free the creature before she breeds a whole armored pack.',
  dialog:'HANNAH: Collars on the raptors. Somebody is steering them.\nMUSTAPHA: Then let’s break the remote.',
  end:'Without the driver’s signal, the beast stops fighting and crashes off into the swamp. The Verdant Regent was Echo’s trial for a living siege engine: dinosaur muscle, steel armor and a command receiver. The collars were cast at Cinder’s foundry, and Hannah finds a vat schematic marked with four human outlines: M, J, H and M.',
  sections:[
   {name:'THE GLASS PERIMETER',say:'HANNAH: The old botanical dome. Echo’s running nutrient pipes through the refinery.',enc:[
     {w:[['raider','knifer'],['raptor','raider']]},
     {w:[['raptor','raptor'],['raider','gunner','raptor']],from:'T',say:'MUSTAPHA: Raptors in the canopy!'}]},
   {name:'COLLARED RAPTORS',say:'MUSTAPHA: Every raptor has the same stripe. Same collar. Same eyes.',enc:[
     {w:[['raptor','raider'],['raptor','gunner','knifer']],task:0},
     {w:[['raptor','raptor','raider'],['brute','gunner']],from:'B'}]},
   {name:'THE HATCHERY',say:'HANNAH: Hatching racks. Hundreds of eggs, all from Fessenden’s old pens.',enc:[
     {w:[['raptor','raptor'],['raider','knifer','raptor']],from:'T',say:'JACK: They’re dropping out of the trees!'},
     {w:[['raptor','raider']],elite:{type:'raptor',name:'PACK ALPHA · VAT RAPTOR',hp:400,scale:1.5},say:'MESS: That one’s twice the size of the others.',after:'HANNAH: It’s not dead — just calm. The alpha’s collar is cracked.'}]},
   {name:'THE RIVER WALK',say:'JACK: Lure tower by the river. Knock it down.',enc:[
     {w:[['raptor','gunner','knifer'],['raptor','brute']],task:1},
     {w:[['raider','raider','raptor'],['raptor','gunner','knifer']],from:'L'}]},
   {name:'THE NEST TRAIL',say:'HANNAH: Listen. Something big is breathing up ahead.',enc:[
     {w:[['raptor','raptor','knifer'],['gunner','brute']],from:'T'},
     {w:[['raptor','raider','gunner'],['brute','raptor','raptor']],task:2}]},
   {name:'THE REGENT’S NEST',say:'MUSTAPHA: Steel on its back and a radio on its neck. Somebody built that thing to fight.',enc:[
     {w:[['raptor','raider','raptor'],['gunner','raptor'],['brute','raptor','knifer']],from:'L',say:'HANNAH: The handlers are cornered. They’re throwing everything at us.'},
     {w:[['raptor','raptor','gunner'],['brute','raptor'],['brute','raptor','raptor']],from:'B'},
     {boss:true}]}]},

 {name:'THE GEOTHERMAL FORGE',area:'04 / THE VAT FORGE',theme:'foundry',boss:'FOREMAN CINDER',kind:'cinder',clones:0.5,accent:'#eea05c',
  brief:'Deep beneath the volcanic shelf, Cinder uses a geothermal generator to melt the coast’s water pumps into growth vats for Dr. Echo and armor for Sable’s army. The vats on his casting floor are sized for people. Shut the coolant lines that feed the vat moulds, then find out who those four outlines on the schematic are meant for.',
  dialog:'CINDER: Steel for the Marshal. Glass for the doctor. Everybody pays.\nJACK: Funny. I was going to send you the bill.',
  end:'Cinder spits out the truth: “The doctor says your blood is the best stock she ever found. She scraped it off the floor of Fessenden’s lab.” Every drop the gang spilled in the first fight was sampled by the lab’s machines. The four outlines are Mustapha, Jack, Hannah and Mess. The finished vats were shipped to Echo’s lab beneath the Skyhook radar fortress.',
  sections:[
   {name:'THE TURBINE DESCENT',say:'JACK: Those are the coast’s water pumps. He’s melting them down.',enc:[
     {w:[['raider','brute'],['knifer','raider','gunner']]},
     {w:[['brute','knifer'],['raider','gunner','raider']],from:'T',say:'MESS: Watch the gantry!'}]},
   {name:'VAT ASSEMBLY',say:'HANNAH: Growth vats. Big enough for a person. Dozens of them.',enc:[
     {w:[['raider','gunner','knifer'],['brute','raider']],task:0},
     {w:[['gunner','gunner','raider'],['brute','knifer','raider']],from:'B'}]},
   {name:'THE CASTING FLOOR',say:'MESS: Lot 12. I remember this one. Hit like a truck.',enc:[
     {w:[['raider','knifer','gunner'],['brute','raider']],from:'T',say:'MUSTAPHA: Off the catwalks — heads up!'},
     {w:[['gunner','raider']],elite:{type:'slicer',name:'LOT 12 · BRAWLER',hp:460,scale:1.45},say:'MESS: Still hits like a truck. Still slow like one.',after:'JACK: Another copy dissolving. How many of these did she grow?'}]},
   {name:'THE CATWALKS',say:'JACK: Furnace feed is up ahead. Kill it and the vats go cold.',enc:[
     {w:[['knifer','gunner','raider'],['brute','brute']],task:1},
     {w:[['raider','raider','knifer'],['gunner','brute','knifer']],from:'T'}]},
   {name:'THE MOULD PRESS',say:'HANNAH: That press stamps the vat lids. Jam it.',enc:[
     {w:[['mutant','raider','gunner'],['brute','knifer']],from:'L'},
     {w:[['brute','gunner','knifer'],['mutant','raider','raider']],task:2}]},
   {name:'CINDER’S FURNACE',say:'CINDER: Water belongs to whoever can hold the gate. So do people.',enc:[
     {w:[['brute','raider','gunner'],['mutant','knifer','brute'],['mutant','knifer','raider']],from:'B'},
     {boss:true}]}]},

 {name:'SKYHOOK RADAR FORTRESS',area:'05 / DR. ECHO',theme:'lab',boss:'DR. ECHO',kind:'echo',clones:0.8,accent:'#7bd6c9',
  brief:'On a cliff above the cloud line, Dr. Echo has hidden a new laboratory beneath the Skyhook poacher radar fortress. Rotating dishes spread commands from Fessenden’s recovered archive. Her command signal tells every clone what to do. Jam her control channels, get through the vat hall, and stop the woman who finished Fessenden’s work.',
  dialog:'ECHO: You broke his body. You never broke his work.\nHANNAH: This is Hannah Dundee. We’re coming down to finish it.',
  end:'Echo laughs from the floor. “Too late. The Mirror Gang already shipped to the Crown dam — four of you, with your fists and your memories right up to the night Fessenden died. Sable will send them through every settlement wearing your faces.” She plays one last recording. Fessenden’s voice: “Genius does not die. It is copied.” Hannah pockets Echo’s command key. If it can control the clones, it can set them free.',
  sections:[
   {name:'THE CLIFF ASCENT',say:'HANNAH: Those radar dishes are broadcasting Echo’s orders. Her archive is under the fortress.',enc:[
     {w:[['gunner','knifer'],['raider','mutant']]},
     {w:[['mutant','raider','gunner'],['knifer','brute']],from:'B'}]},
   {name:'THE VAT HALL',say:'JACK: That’s… us. All four of us, floating in green soup.',enc:[
     {w:[['mutant','gunner'],['raider','knifer','mutant']],task:0},
     {w:[['regent','mutant','raider'],['gunner','knifer']],from:'L',say:'MESS: There’s a tank with my name on it. Literally.'}]},
   {name:'MIRROR TEST',say:'ECHO: Meet my best work. It learned everything from your blood.',enc:[
     {w:[['gunner','mutant','knifer'],['regent','brute']],from:'B'},
     {w:[['mutant']],elite:{type:'mirror',hero:1,name:'MIRROR CLONE',hp:420},say:'HANNAH: It moves exactly like one of us.',after:'MESS: It was fast, but it stopped to think. We never do.'}]},
   {name:'THE ARCHIVE STACKS',say:'HANNAH: Fessenden’s notes. Every serum, every failure, every sample.',enc:[
     {w:[['regent','gunner','knifer'],['mutant','brute']],task:1},
     {w:[['mutant','mutant','raider'],['regent','gunner']],from:'B'}]},
   {name:'THE BROADCAST ROOM',say:'JACK: Last control channel. Jam it and her signal dies in this whole sector.',enc:[
     {w:[['gunner','regent','raider'],['mutant','brute','regent']],task:2},
     {w:[['mutant','brute','regent'],['gunner','gunner']],from:'T',say:'ECHO: Every channel you jam, I open two more.'}]},
   {name:'ECHO’S LAB',say:'ECHO: He trusted me with everything. I’m only finishing what he started.',enc:[
     {w:[['regent','mutant','gunner'],['brute','regent'],['brute','mutant','gunner']],from:'B'},
     {boss:true}]}]},

 {name:'THE CROWN SPIRE',area:'06 / MIRROR WAR',theme:'eden',boss:'MARSHAL SABLE',kind:'sable',clones:1,accent:'#d5ec69',
  brief:'A crumbling gothic skyscraper towers over the Crown dam. Sable has installed Echo’s last vat hall inside the spire and wired its command deck into the dam turbines. Behind the gates waits his clone army and the Mirror Gang — copies of all four heroes. Hannah has Echo’s command key. Beat the copies, break the command pylons and turn Sable’s clones against him. One tank in that hall is still sealed, and the manifest only calls it LOT 00.',
  dialog:'SABLE: Why hire an army when you can grow one that never runs out?\nMUSTAPHA: Funny thing about copies. They remember who they’re copied from.',
  end:'The Crown Engine stalls on the spillway and the freed clones drag Sable out of the cockpit. When the water drowns the turbines, the last tank in the vat hall cracks open — and what climbs out was never one of the gang. Echo grew Fessenden himself from the archive’s own sample and dosed the copy with his serum: the beast from the jungle lab, back for one more round. It dies the way the other copies did, into green gel, and this time there is nothing left to copy. Echo’s command signal is gone. For the first time, every copy can choose for itself.',
  sections:[
   {name:'THE SPIRE APPROACH',say:'SABLE: Welcome to the Crown, heroes. I’ve made a few improvements.',enc:[
     {w:[['raider','gunner'],['mutant','knifer','raider']]},
     {w:[['mirror','gunner'],['regent','mutant','knifer']],from:'L',say:'MUSTAPHA: Copies of us in the regular ranks. Sable is mass-producing us.'}]},
   {name:'THE MIRROR GANG',say:'HANNAH: There they are. The Mirror Gang.',enc:[
     {w:[['mutant','gunner']],elite:{type:'mirror',hero:1,name:'MIRROR CLONE',hp:400},say:'JACK: Like fighting yourself in a funhouse.'},
     {w:[['regent','raider']],from:'B',elite:{type:'mirror',hero:2,name:'MIRROR CLONE',hp:400}}]},
   {name:'YOU VS. YOU',say:'???: I remember the lab too. I remember everything you remember.',enc:[
     {w:[['mutant','regent','gunner'],['brute','knifer']],from:'B'},
     {w:[['gunner']],elite:{type:'mirror',hero:0,name:'YOUR OWN CLONE',hp:520},say:'HANNAH: That one is yours. Same moves. Same stubborn face.',after:'YOUR CLONE: …Why are you holding back? …Why am I?'}]},
   {name:'BREAK THE COMMAND',say:'HANNAH: Echo’s key works! Every pylon we break frees another batch.',enc:[
     {w:[['mutant','gunner','raider'],['regent','knifer']],task:0},
     {w:[['regent','mutant'],['gunner','brute','mirror']],from:'B',task:1},
     {w:[['mirror','regent','gunner'],['mutant','mirror']],from:'B',task:2}]},
   {name:'THE CLONE WAR',say:'JACK: Clones fighting clones. Stay with the ones on our side!',enc:[
     {w:[['mirror','mutant','regent'],['mirror','gunner','brute']],from:'R'},
     {w:[['mirror','brute','mirror'],['regent','mirror','gunner']],from:'R',say:'FREED CLONE: We choose. Not Echo. Not Sable. Us.'}]},
   {name:'THE CROWN FLOODGATE',say:'SABLE: Every clone obeys whoever holds the signal. Today that’s still me.',enc:[
     {w:[['mirror','regent','gunner'],['mutant','mirror'],['mutant','mirror','regent']],from:'B'},
     {boss:true}]}]}
];
