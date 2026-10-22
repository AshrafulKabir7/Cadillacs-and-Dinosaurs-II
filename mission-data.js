/* Objectives are required in play, not just described in intermission text.
   Task: [kind, name, tuning target, radio line when done, clones freed (final chapter)]. */
window.EDEN_MISSIONS=[
 {title:'OPEN THE COLD PODS',verb:'Pods opened',tasks:[
  ['pod','COLD POD · LOT 07',0,'HANNAH: A man asleep in green gel. Mess knocked him cold in the lab!'],
  ['pod','COLD POD · LOT 12',0,'JACK: Another one. Same face, same chain tattoo. Still breathing.'],
  ['pod','PODS · MANIFEST CASE',0,'HANNAH: A manifest. Every pod is sold to a Marshal Sable.']]},
 {title:'RECOVER THE STASIS PODS',verb:'Pods recovered',tasks:[
  ['cargo','STASIS POD A',0,'JACK: Pod secured. Keep that convoy in sight.'],
  ['cargo','STASIS POD B',0,'HANNAH: Something’s moving inside this one. Small. Scaly.'],
  ['gate','TOLL BARRIER WINCH',0,'MESS: The chain’s off the causeway. Let’s roll!']]},
 {title:'SILENCE THE NURSERY',verb:'Lures silenced',tasks:[
  ['beacon','PEN SONIC LURE',0,'HANNAH: The raptors in the pens are calming down.'],
  ['beacon','RIVER SONIC LURE',0,'MUSTAPHA: Collars are going quiet all along the river.'],
  ['beacon','NEST APPROACH LURE',0,'HANNAH: One signal left, at the nest itself.']]},
 {title:'FLOOD THE DIG',verb:'Sea valves opened',tasks:[
  ['valve','SEA VALVE · TANK ROW',0,'MESS: Water’s coming in. The pumps can’t keep up.'],
  ['valve','SEA VALVE · SCAFFOLDS',0,'JACK: Half the dig is under water. Keep going!'],
  ['valve','SEA VALVE · THRONE DRAIN',0,'HANNAH: The dig is drowning. Now, what was she after?']]},
 {title:'JAM THE COMMAND SIGNAL',verb:'Channels jammed',tasks:[
  ['tuner','CONTROL CHANNEL A',2,'HANNAH: Channel A is ours. The brass floor just went quiet.'],
  ['tuner','CONTROL CHANNEL B',3,'JACK: Half her copies are standing around confused.'],
  ['tuner','CONTROL CHANNEL C',1,'HANNAH: Her signal is dead for miles. Now for Echo.']]},
 {title:'FREE THE CLONES',verb:'Pylons broken',tasks:[
  ['gate','COMMAND PYLON A',0,'HANNAH: Pylon down! The Mirror Gang is waking up, on our side!',2],
  ['gate','COMMAND PYLON B',0,'MESS: More of them are turning on Sable’s troops!',1],
  ['gate','COMMAND PYLON C',0,'FREED CLONE: The voice in our heads is gone. Point us at Sable.',1]]}
];
