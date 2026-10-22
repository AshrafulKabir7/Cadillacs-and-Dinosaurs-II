// Animation labels for tools/re/export/bosses.cjs, keyed by animation SET address; the array index is the anim index.
// How they were chosen: the contact sheets (work/re/extract/bosses/<id>-sheet.png) for the pose, plus the live usage
// written next to each anim in <id>.json (state bytes +0x04..+0x07 when it starts, forward motion, rise, the attack id
// in +0x58 while it plays, hero damage seen while it plays, whether HP ran out during it). A trailing "?" marks a
// label taken from the art alone (the anim was never seen live, or its use was ambiguous).
// Shared sets are labelled once: MORGUE's set 0x6EA48 is also FESSENDEN's first form (type 0x178); TYROG's set 0x702C4
// is used by types 0x10, 0x120 and 0x16C (TYROG 2); SLISAUR's set has the same layout as SLICE's.
'use strict';
const SLICE = ['idle', 'walk (slow)', 'flip jump (crouch, leap, 4 somersault frames, land)', 'land (crouch -> stand)', 'walk (approach)', 'jab', 'overhand blade slash', 'lunging low blade sweep', 'long blade lash (wind-up, lash, recover)', 'blade wind-up pose (intro hold)', 'sway / taunt', 'blade lash after a jump', 'lunging low blade sweep (fast)'];
const VICE = ['idle', 'walk', 'jump (crouch, leap, hang)', 'crouch / landing', 'run', 'flex (arm raised)', 'walk with arms out (grapple approach)?', 'punch', 'feint jab?', 'lunging punch', 'kick', 'jump kick (crouch, leap, flying kick)', 'taunt (hold)', 'raise pistol', 'aim and fire pistol', 'raise pistol, reload?', 'fire pistol (long burst)', 'punch (short)', 'lunging punch (no recovery)', 'run (records 1236-1239, continues into anim 4)?', 'flex then punch', 'intro: shadow-boxing (60-frame wait, 3 punches)', 'airborne hold', 'leap (crouch -> airborne)', 'jump kick (variant)', 'scripted walk (continues outside the set, 0x45052)?', 'high jump (crouch -> airborne)'];
const WALTHER = VICE.slice();
WALTHER[13] = 'raise pistol'; WALTHER[19] = 'run (alt)?'; WALTHER[20] = 'run (alt)?'; WALTHER[21] = 'run (alt)?'; WALTHER[23] = 'jump kick';
const TYROG = ['idle (crouched, breathing)', 'crawl', 'leap', 'claw swipe (reach)', 'rear up and roar', 'stand up (rise from crouch)', 'stand up (rise, variant)', 'rising claw', 'hatchling hop (small red creature)?', 'hatchling crawl?', 'hatchling leap?', 'hatchling spin frame 1?', 'hatchling spin frame 2?', 'hatchling spin frame 3?', 'hatchling spin frame 4?', 'hatchling spin frame 5?', 'hatchling spin frame 6?', 'emerge (head pops up, alternating)?', 'empty / shadow-only frame?', 'crawl (alt)', 'crawl (short step)', 'airborne leap', 'pounce (airborne)', 'rear up (attack)', 'claw swipe (variant)', 'pounce landing', 'mutating poacher (red figure)?', 'rising slash', 'standing slash', 'slash and drop to crouch', 'rear up', 'stand up (rise, long)', 'hatchling crawl (alt)?', 'crawl (short, alt)', 'mutation from poacher, part 1 (bubbling body)', 'mutation from poacher, part 2 (standing torso)', 'lying, twitching (defeated)?', 'lying, twitching (alt)?', 'recover from crouch'];
const MORGUE = ['idle', 'walk', 'walk (alt) / sway', 'prowl low (4 frames)', 'claw swipe', 'raise claws / roar', 'breathing idle (claws)', 'charge on all fours', 'crouch down', 'crouch (2 frames)', 'rise (2 frames)?', 'transformation: MORGAN mutates into MORGUE (44 frames)', 'low claw combo', 'pounce (airborne)', 'raised-claw combo', 'stance (claws)', 'dash low', 'curled roll', 'drop to all fours and charge', 'curled crouch', 'FESSENDEN (human, lab coat) points and talks (67 frames)', 'crouched breathing (51 frames)', 'get up (lying -> crouch -> stand)', 'stand', 'FESSENDEN beast emerging (morph frames)', 'claw swipe (variant)', 'pounce', 'stand -> crouch', 'step (2 frames)', 'FESSENDEN beast (morph end)'];
const DINONICS = ['idle (crouched, breathing)', 'idle: sniff / look around', 'stand', 'alert: head bob', 'rear up and pounce', 'step (2 frames)', 'crouch', 'creep (low walk)', 'run (attack)', 'run', 'run (fast)', 'retreat (run back)', 'run (alt)', 'leaping pounce (high)', 'lunging bite', 'bite (jaws open)', 'step (2 frames, alt)', 'rear up (stand tall)', 'knocked back (airborne)', 'knocked down (fall -> lying)', 'recoil (hurt)', 'run (alt 2)', 'run (alt 3)', 'run attack', 'run attack (alt)', 'pounce leap (forward)', 'low bite', 'crouched bite', 'high leap', 'hop back', 'crouched snap'];
const AROSAURUS = ['sleep (lying)', 'sleep (breathing / stirring)', 'walk (speed 1, slowest)', 'walk (speed 2)', 'walk (speed 3)', 'walk (speed 4)', 'walk (speed 5)', 'walk (speed 6)', 'walk (speed 7)', 'walk (speed 8, fastest)', 'roar', 'snapping bite combo', 'rear up, crouch, lunge', 'tail swipe', 'rear up, crouch, lunge (slow)', 'lean forward', 'rear up (tall)', 'snapping bite combo (variant)', 'roar (variant)', 'rear up, crouch, lunge (variant)', 'stomp step (speed 1)', 'stomp step (speed 2)', 'stomp step (speed 3)', 'stomp step (speed 4)', 'stomp step (speed 5)', 'stomp step (speed 6)', 'stomp step (speed 7)', 'stomp step (speed 8)', 'tail swipe -> stand -> roar'];
module.exports = {
  // generic reaction sets (V18 tables 0x2E724 / 0x2E68C indexed by obj+0x84; every entry has the same layout)
  reactionHit: ['hurt (stagger)', 'hurt (stagger, 2)', 'knocked down (fly back, land, bounce)', 'knocked down (launched)', 'get up', 'dizzy (stunned loop)', 'hurt (stagger, 3)', 'knocked down (2)', 'thrown: landing', 'down: bounce', 'knocked down from the air'],
  reactionGrab: ['grabbed (held)', 'grabbed: kneed', 'thrown', 'thrown (2)', 'thrown (late entry)', 'thrown (last frame)'],
  sets: {
    '0x438F2': VICE,
    '0x43E54': WALTHER,
    '0x945CC': ['chain angle 0', 'chain angle 1', 'chain angle 2', 'chain angle 3', 'chain angle 4', 'chain angle 5', 'chain angle 6', 'chain angle 7', 'chain angle 8'],
    '0x6FDEC': ['idle', 'walk', 'overhead machete slash then thrust', 'double machete slash then thrust', 'crouch, hop, curl into a ball', 'kneel (2 frames)', 'fists up (2 frames)', 'rolling body press (curled ball)', 'lunging punch', 'machete thrust (lunge)', 'machete thrust (lunge, variant)', 'machete flurry (3 spinning slashes)', 'thrust ready (hold)', 'punch then thrust', 'thrust (hold)', 'uncurl: ball -> stand -> crouch', 'high jump (crouch -> leap)', 'lunging punch (variant)', 'chuckle / taunt, then kneel', 'dash punch (charging shoulder punch)', 'dash punch (hold)', 'land: ball -> stand', 'curled ball (hold)', 'stand upright', 'curled ball (airborne body press)', 'idle -> kneel', 'walk (variant)', 'kneel (hold)', 'walk (variant 2)'],
    '0x3906A': ['idle', 'fists up', 'overhead machete slash then thrust', 'double machete slash then thrust', 'kneel', 'kneel (hold)', 'walk', 'crouch, hop, curl', 'lunging punch', 'machete thrust', 'machete thrust (variant)', 'machete flurry', 'thrust ready', 'punch then thrust', 'thrust (hold)'],
    '0x50DFA': ['ride (seated)', 'ride fast (hair streaming)', 'ride (2 frames)', 'ride forward', 'lean forward / charge', 'lean back (brace)', 'knocked off the bike (fly, land, bounce)', 'look back', 'look back (variant)', 'side swipe from the bike', 'punch out to the side', 'ride, then raise fist (taunt)', 'reach out (clothesline charge)'],
    '0x51076': ['bike: riding (wheels turning)', 'bike: wheelie'],
    '0x4C90E': SLICE,
    '0x5D1C0': SLICE,
    '0x70F02': ['idle (hunched)', 'creep forward (walk)', 'point (2 frames)', 'point and accuse (taunt loop)', 'crouch and spring up', 'hop attack', 'lunging grab (dash)', 'jab (2 frames)', 'transformation start: cowers, flashes into MORGUE (21 frames)', 'crouch and spring up (variant)', 'point jab', 'head-butt', 'wring hands / taunt (8 frames)', 'lunge (2 frames)', 'lying -> get up -> run off', 'lying (hold)', 'cower / plead (4 frames)', 'hop forward'],
    '0x6EA48': MORGUE,
    '0x702C4': TYROG,
    '0x71A4E': ['red cage / rubble?', 'poacher idle', 'red blob growing (mutagen?)', 'poacher crouch', 'poacher lying', 'poacher hop', 'red blob shrinking', 'poacher (alt)', 'grey egg / shadow blob?', 'poacher hunched, white hair (mutating)', 'poacher mutating (red, 6 frames)', 'poacher lying (alt)'],
    '0x71D66': ['early mutant (red tendrils)', 'poacher mutating (41 frames)', 'Tyrog rises, rears up, crouches'],
    '0x678A0': ['rock', 'rock (small)', 'impact spark', 'rock (tumbling)', 'rock (tumbling 2)', 'white flash (explosion core)', 'impact spark (2)'],
    '0x67C3A': ['green slime blob', 'green slime splash', 'bone fragment', 'red hook / claw fragment', 'red hook (2)', 'green blob (small)', 'debris', 'debris (2)', 'debris (3)'],
    '0x69B1C': ['fireball', 'white flash', 'impact spark'],
    '0x64452': ['idle', 'walk', 'walk (fast)', 'open jaws (roar)', 'low lunge (body flat, airborne)', 'crouch (2 frames)', 'bite', 'chomp and hold (100 frames)', 'lean forward and bite', 'falls over (1)', 'falls over (2, on its back)', 'gore piece 1', 'gore piece 2', 'gore piece 3', 'gore piece 4', 'flinch / head turn (2 frames)?', 'shuffle (4 frames)', 'flinch b?', 'flinch c?', 'flinch d?', 'flinch e?', 'flinch f?', 'flinch g?'],
    '0x646A4': ['neck head: idle sway (4 frames)', 'neck head: lunge bite', 'neck head: raised', 'neck head: low', 'neck head: snap (2 frames)', 'neck head: rise and strike', 'neck head: pose 6 (extended)?', 'neck head: pose 7 (jaws open)?', 'neck head: pose 8 (raised high)?', 'neck head: pose 9 (curled)?', 'neck head: pose 10 (curled, jaws open)?'],
    '0x647D8': ['long arm: rest', 'long arm: raised', 'long arm: reach and grab', 'long arm: extend and retract', 'long arm: reach up', 'long arm: extend', 'long arm: folded'],
    '0x648AA': ['second arm: rest', 'second arm: extend', 'second arm: folded'],
    '0x712A0': ['line length 0', 'line length 1', 'line length 2', 'line length 3', 'line length 4', 'line length 5', 'line length 6', 'line length 7', 'line length 8', 'line length 9', 'line hold (attack)', 'line extending (20 frames)'],
    '0x4F4E4': DINONICS,
    '0x49574': AROSAURUS,
    '0x53BE4': ['stand', 'stand (head variant)', 'charge (run)', 'jump / knocked airborne', 'head down', 'head up', 'sleep (lying)', 'walk'],
    '0x611D2': ['fly (flap cycle)', 'fly up (flap)', 'glide back', 'glide', 'flap (variant)', 'wings up', 'swoop (low dive)', 'fly with turn'],
    '0x5326A': ['glide (8 frames)', 'glide (9 frames)', 'flap', 'flap (variant)', 'dive pose', 'glide pose', 'distant speck (6 frames)'],
    '0x5F4F8': ['walk', 'step (2 frames)', 'step (3 frames)', 'step (4 frames)'],
    '0x600E0': ['walk (4 frames)', 'walk (7 frames)'],
    '0x5674E': ['fly (flock)', 'fly fast (flock)'],
    '0x5708C': ['distant dot', 'distant dot (2)', 'fly (flap)', 'fly fast (flap)', 'glide'],
    '0x4837C': ['shadow'],
    '0x718EE': ['foot: stomp down', 'foot: raised', 'foot: lifting', 'foot: planted', 'foot: lifting (2)'],
    '0x4DBA0': ['walk', 'crouch', 'curled', 'run', 'run (fast)', 'jump', 'leap', 'land?'],
    '0x4FC22': ['pose'],
    '0x71408': ['grenade: spinning (16 frames)', 'dynamite: lying', 'knife: lying', 'rock: lying', 'stone: lying', 'grenade: spinning (same frames as anim 0)', 'dynamite: spinning', 'knife: spinning', 'rock: flying', 'stone: flying', 'green acid blob (2 frames)', 'green acid splash', 'fireball', 'explosion'],
    '0x5FB80': ['idle', 'walk', 'haymaker punch combo (wind-up, punch, recover x2)', 'stand', 'stand (variant)'],
    '0x5FCBA': ['idle', 'walk', 'haymaker punch combo (wind-up, punch, recover x2)', 'stand', 'stand (variant)'],
    '0x5FDF4': ['idle', 'walk', 'haymaker punch combo (wind-up, punch, recover x2)', 'stand', 'stand (variant)'],
  },
};
