/* Objectives are required in play, not just described in intermission text (STORY.md, revision 3: eight stages).
   Task: [kind, name, tuning target, radio line when done]. Kinds: gate / valve (hold E at the console), beacon (wreck
   it with attacks), cargo (ram it with the Cadillac), tuner (tap E to the marked channel; no stage uses it now).
   toast / hint (optional) replace the kind's default prompt on screen. */
window.EDEN_MISSIONS=[
 {title:'FREE THE DOCKWORKERS',verb:'Barge locks broken',toast:'HOLD E / PICK TO BREAK THE BARGE LOCK',tasks:[
  ['gate','BARGE LOCK · NET MENDERS',0,'HANNAH: The first lock’s off. Net menders, out you come!'],
  ['gate','BARGE LOCK · DOCKWORKERS',0,'MESS: Dockworkers out. Go on, run! We’ll hold them.'],
  ['gate','BARGE LOCK · THE HOLD',0,'MUSTAPHA: The hold is open. Only Rook’s quay is left.']]},
 {title:'WRECK THE RESTRAINT GEAR',verb:'Gear wrecked',toast:'WRECK THE RESTRAINT GEAR',hint:'J / FIRE · WRECK',tasks:[
  ['beacon','PROD RACK',0,'HANNAH: The prod rack is scrap. Let’s see them work without it.'],
  ['beacon','COLLAR CRATES',0,'MUSTAPHA: Collars smashed. Nobody chains these animals tonight.'],
  ['beacon','TRANQUILIZER STATION',0,'JACK: The darts are gone. One camp left to shut: hers.']]},
 {title:'STOP THE CONVOY',verb:'Convoy stopped',tasks:[
  ['cargo','CARGO TRAILER A',0,'JACK: Trailer’s down. Living animals in there. Let them out.'],
  ['cargo','CARGO TRAILER B',0,'HANNAH: Sealed containers with a lab mark. Leave them shut.'],
  ['gate','CHECKPOINT WINCH',0,'MESS: The barrier’s off the causeway. Krag’s just ahead!']]},
 {title:'FREE THE WORKERS',verb:'Winches broken',toast:'HOLD E / PICK TO BREAK THE SHAFT WINCH',tasks:[
  ['valve','SHAFT WINCH · YARD',0,'HANNAH: First crew is out of the chains. Up the ladder, go!'],
  ['valve','SHAFT WINCH · SCAFFOLDS',0,'MUSTAPHA: Scaffold crew is free. The salvage is slowing down.'],
  ['valve','SHAFT WINCH · CHAMBERS',0,'MESS: Last crew’s out. Now for the foreman.']]},
 {title:'OPEN THE BARRIERS',verb:'Barriers opened',toast:'HOLD E / PICK TO OPEN THE BARRIER',tasks:[
  ['gate','BARRIER · FARM ROAD',0,'HANNAH: The farm road is open. The families on this side are free.'],
  ['gate','BARRIER · EVACUATION ROAD',0,'JACK: The road west is clear. Get moving, all of you!'],
  ['gate','BARRIER · TOWN SQUARE',0,'MESS: The square is open. They’re helping each other out now.']]},
 {title:'SHUT THE TREATMENT WARDS',verb:'Feeds shut',toast:'HOLD E / PICK TO SHUT THE FEED',tasks:[
  ['valve','TREATMENT FEED · PENS',0,'HANNAH: The pen feed is off. The animals are waking up calmer.'],
  ['valve','TREATMENT FEED · WARDS',0,'MUSTAPHA: The wards are dark. The patients are safe in their beds.'],
  ['valve','TREATMENT FEED · TRIALS',0,'JACK: Last feed’s shut. Only the test enclosure is left.']]},
 {title:'SEIZE THE DAM PLANS',verb:'Relays wrecked',toast:'WRECK THE RELAY MAST',hint:'J / FIRE · WRECK',tasks:[
  ['beacon','RELAY MAST · STATION',0,'HANNAH: First mast down. The cliff patrols just lost their orders.'],
  ['beacon','RELAY MAST · ARCHIVE',0,'JACK: Half her guards are standing around asking each other questions.'],
  ['beacon','RELAY MAST · GALLERY',0,'MUSTAPHA: The network’s dead. Now for Echo and the dam plans.']]},
 {title:'REACH THE GATEHOUSE',verb:'Controls cleared',toast:'HOLD E / PICK TO RUN THE CONTROLS',tasks:[
  ['gate','LIFT CONTROL · LOWER',0,'MUSTAPHA: Lower lift’s running. Up we go.'],
  ['gate','LIFT CONTROL · UPPER',0,'JACK: Upper lift’s live. The gatehouse level is right above us.'],
  ['gate','GATEHOUSE DOOR',0,'HANNAH: The gatehouse is open. Sable’s out on the crest!']]}
];
