/* These objectives are required in play, not just described in intermission text.
   Task: [kind, name, tuning target, radio line when done, clones freed (final chapter)]. */
window.EDEN_MISSIONS=[
 {title:'OPEN THE COLD PODS',verb:'Pods opened',tasks:[
  ['pod','COLD POD · LOT 07',0,'HANNAH: There’s a man in there. The same man you knocked out in the lab.'],
  ['pod','COLD POD · LOT 12',0,'JACK: Another copy. Same face, same tattoo, still breathing.'],
  ['pod','PODS · MANIFEST CASE',0,'HANNAH: A manifest. The pods were sold to Marshal Sable.']]},
 {title:'RECOVER THE STASIS PODS',verb:'Pods recovered',tasks:[
  ['cargo','STASIS POD A',0,'JACK: Pod secured. Keep that convoy in sight.'],
  ['cargo','STASIS POD B',0,'HANNAH: Something’s moving inside this one.'],
  ['gate','TOLL BARRIER WINCH',0,'MESS: The chain’s off the Skyway. Let’s roll.']]},
 {title:'SILENCE THE NURSERY',verb:'Lures silenced',tasks:[
  ['beacon','RIDGE SONIC LURE',0,'HANNAH: The raptors on the ridge are slowing down.'],
  ['beacon','RIVER SONIC LURE',0,'MUSTAPHA: Collars are going quiet all along the river.'],
  ['beacon','NEST APPROACH LURE',0,'HANNAH: One signal left — at the nest itself.']]},
 {title:'COOL THE VAT FORGE',verb:'Valves secured',tasks:[
  ['valve','VAT COOLANT BYPASS',0,'MESS: Coolant is off. Those vats won’t set.'],
  ['valve','FURNACE FEED',0,'JACK: Furnace is starving. Half the line just stopped.'],
  ['valve','VAT MOULD PRESS',0,'HANNAH: The press is jammed. No more lids for Echo.']]},
 {title:'JAM THE COMMAND SIGNAL',verb:'Channels jammed',tasks:[
  ['tuner','CONTROL CHANNEL A',2,'HANNAH: Channel A is ours. The vat hall just went quiet.'],
  ['tuner','CONTROL CHANNEL B',3,'JACK: Half her clones are standing around confused.'],
  ['tuner','CONTROL CHANNEL C',1,'HANNAH: Her signal is dead in this sector. Now for Echo.']]},
 {title:'FREE THE CLONES',verb:'Pylons broken',tasks:[
  ['gate','COMMAND PYLON A',0,'HANNAH: Pylon down! The Mirror Gang is waking up — on our side!',2],
  ['gate','COMMAND PYLON B',0,'MESS: More of them are turning on Sable’s troops!',1],
  ['gate','COMMAND PYLON C',0,'FREED CLONE: The voice in our heads is gone. Point us at Sable.',1]]}
];
