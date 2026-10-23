/* Objectives are required in play, not just described in intermission text. Each chapter's objective is a link of
   Marshal Sable's supply chain (STORY.md): prison labor, Crown cargo, the nursery, the Sink salvage, the signal, the dam.
   Task: [kind, name, tuning target, radio line when done, collared crews freed (final chapter)]. */
window.EDEN_MISSIONS=[
 {title:'FREE THE PRISONERS',verb:'Pods opened',tasks:[
  ['pod','PRISON POD · NET MENDER',0,'HANNAH: A fisherman, sedated. He’s waking up. You’re safe now.'],
  ['pod','PRISON POD · LAMPLIGHTER',0,'JACK: Another one. Dragged off for a bucket of water.'],
  ['pod','PODS · MANIFEST CASE',0,'HANNAH: A manifest. Every pod is signed over to Marshal Sable.']]},
 {title:'SEIZE THE CROWN CARGO',verb:'Cargo seized',tasks:[
  ['cargo','CARGO WAGON A',0,'JACK: Wagon’s down. Pressure regulators, stamped TO THE CROWN.'],
  ['cargo','CARGO WAGON B',0,'HANNAH: Something’s moving under this tarp. Small. Scaly. Collared.'],
  ['gate','TOLL BARRIER WINCH',0,'MESS: The chain’s off the causeway. Let’s roll!']]},
 {title:'SILENCE THE NURSERY',verb:'Lures silenced',tasks:[
  ['beacon','PEN SONIC LURE',0,'HANNAH: The raptors in the pens are calming down.'],
  ['beacon','RIVER SONIC LURE',0,'MUSTAPHA: Collars are going quiet all along the river.'],
  ['beacon','NEST APPROACH LURE',0,'HANNAH: One signal left: the driver at the nest itself.']]},
 {title:'FLOOD THE DIG',verb:'Sea valves opened',tasks:[
  ['valve','SEA VALVE · TANK ROW',0,'MESS: Water’s coming in. The pumps can’t keep up.'],
  ['valve','SEA VALVE · SCAFFOLDS',0,'JACK: Half the dig is under water. Keep going!'],
  ['valve','SEA VALVE · THRONE DRAIN',0,'HANNAH: The dig is drowning. Now, what did the marshal order from here?']]},
 {title:'JAM THE COMMAND SIGNAL',verb:'Channels jammed',tasks:[
  ['tuner','CONTROL CHANNEL A',2,'HANNAH: Channel A is ours. The brass floor just went quiet.'],
  ['tuner','CONTROL CHANNEL B',3,'JACK: Half her graft subjects are standing around confused.'],
  ['tuner','CONTROL CHANNEL C',1,'HANNAH: Her relays are dead. Only the big dish is left. Now for Echo.']]},
 {title:'BREAK THE COLLAR PYLONS',verb:'Pylons broken',tasks:[
  ['gate','COLLAR PYLON A',0,'HANNAH: Pylon down! Two crews are out of their collars, and on our side!',2],
  ['gate','COLLAR PYLON B',0,'MESS: More of them are turning on Sable’s guard!',1],
  ['gate','COLLAR PYLON C',0,'CONSCRIPT: The hum in our heads is gone. Point us at the marshal.',1]]}
];
