// Curated reading of the story text: who speaks, who is who, what each scene is. Every entry says whether it was
// OBSERVED (seen in a live run snapshot, the ROM or the disassembly; the evidence is named) or INFERRED (a reading of
// observed data that was not checked directly). Research tooling only.
'use strict';

// Portrait index (D0 of 0x84736) -> character. Portrait art: tile maps [0x8463E + i*4] (9x9 scroll1 tiles), palette
// [0x8461A + i*2]. Identified from the live snapshots named in `seen`.
const PORTRAITS = {
  0x00: { name: 'Jack Tenrec', seen: 'story-inter6-jack f101; story-ep1-jack f2664; story-ending f4150 (0x0A)', status: 'OBSERVED' },
  0x01: { name: 'Hannah Dundee', seen: 'story-ep1-hannah f2664 (black-haired woman in a red frame, FESS MESS character 2 -> dialogue[1] with "HEY CREEP!"); the ending set uses 0x0B for her (story-ending f4750)', status: 'OBSERVED' },
  0x02: { name: 'Mustapha Cairo', seen: 'story-inter4-jack f101 (cap with a P badge, green shirt: "JACK,LOOK..." when Jack plays); story-ep2-mustapha f3651 (FESS MESS character 1 -> portrait 2); story-ending f4030 (0x0C)', status: 'OBSERVED' },
  0x03: { name: 'Mess O\'Bradovich', seen: 'story-ep1-mess f2709 (big bald man with a moustache, FESS MESS character 3 -> dialogue[3] with "HEY CREEP!"); story-inter6-mess f101 draws the same tile map (0xA35A8, portraits 3, 0xD and 0x11 share it) with the intermission screen\'s scroll1 palette 0x13, where he appears dark-haired', status: 'OBSERVED' },
  0x04: { name: 'Dr. Fessenden', seen: 'story-ep8-jack f10595, f13590 (bald old man in a lab coat)', status: 'OBSERVED' },
  0x05: { name: 'Vice T.', seen: 'story-ep1-jack f2837 (blond spiked hair, the E1 boss with the chained raptor)', status: 'OBSERVED' },
  0x06: { name: 'The Butcher', seen: 'story-ep2-jack f3563 (bald, grinning; the machete boss of E2)', status: 'OBSERVED' },
  0x07: { name: 'Morgan', seen: 'story-ep5-jack f6846, f7479 (green scarf; HUD MORGAN)', status: 'OBSERVED' },
  0x08: { name: 'the village elder', seen: 'story-ep5-jack f6421 (white-bearded old man of the burning village)', status: 'OBSERVED' },
  0x09: { name: 'Slice', seen: 'story-ep4-jack f6431 (orange-haired knife fighter, the E4 boss in Jack\'s garage)', status: 'OBSERVED' },
  0x0A: { name: 'Jack Tenrec (ending portrait set)', seen: 'story-ending f4150-f4570', status: 'OBSERVED' },
  0x0B: { name: 'Hannah Dundee (ending portrait set)', seen: 'story-ending f4750', status: 'OBSERVED' },
  0x0C: { name: 'Mustapha Cairo (ending portrait set)', seen: 'story-ending f4030', status: 'OBSERVED' },
  0x0D: { name: 'Mess O\'Bradovich (ending portrait set, never called)', seen: 'same tile map and palette as portrait 3 (0xA35A8 / 0x13 in the tables at 0x8463E / 0x8461A); no call site loads D0 = 0x0D', status: 'OBSERVED (tables), unused' },
};
const PORTRAIT_FREE = 'the first hero no player is using (0xE034: lowest character id not in play; portrait order Jack, Hannah, Mustapha, Mess)';
const PORTRAIT_PLAYER = 'the hero of the first active player (0xE0AA)';

// Speakers of text that is not a portrait line (narration, captions, attract pages, the Fessenden monitor) and of the
// lines whose portrait depends on the players. Keyed by block address.
const SPEAKERS = {
  // attract story intro A (0x988C0): two image panels per page, no portraits
  0x98CC6: { who: 'fleeing townspeople', status: 'INFERRED', basis: 'story-attract f4850: panel of people running from a red tyrannosaur' },
  0x98D14: { who: 'a townsperson (reply)', status: 'INFERRED', basis: 'same page, second line (story-attract f4850)' },
  0x98D7E: { who: 'Mess and Mustapha', status: 'INFERRED', basis: 'story-attract f5092: panel of Mess (orange shirt) and Mustapha (cap) at a doorway' },
  0x98DE8: { who: 'a poacher (Black Marketeer)', status: 'INFERRED', basis: 'story-attract f5454: panel of poachers roping a green dinosaur' },
  0x98E50: { who: 'Hannah Dundee', status: 'INFERRED', basis: 'story-attract f5835: panel of Hannah at a window beside Mess and Mustapha' },
  0x98EE0: { who: 'a hero (black screen)', status: 'INFERRED', basis: 'story-attract f6167: text alone on black' },
  0x98F2A: { who: 'Jack Tenrec', status: 'OBSERVED', basis: 'story-attract f6287: full-screen close-up of Jack beside the text' },
  0x98F8A: { who: 'Jack Tenrec', status: 'OBSERVED', basis: 'story-attract f6287 (same page)' },
  // stage 1 opening (caption object, no portrait)
  0x87CE4: { who: 'the poacher gang leader (white-haired brute, cut-scene actor pool B type 0xE0)', status: 'INFERRED', basis: 'story-start-jack f957: he stands at the head of three poachers (pool B 0xDC) facing the hero; nobody else on screen' },
  0x87D2E: { who: 'the poacher gang leader', status: 'INFERRED', basis: 'continues 0x87CE4 (story-start-jack f989)' },
  0x87D58: { who: 'the poacher gang leader', status: 'INFERRED', basis: 'continues 0x87CE4 (story-start-jack f1111)' },
  0x87A26: { who: 'Vice T.', status: 'INFERRED', basis: 'spawned by the Vice T./Walther handler (type 0x48) at 0x427C0 (caption subtype 0x0B), after his portrait line; story-ep1-jack f2989' },
  0x87A72: { who: 'Vice T.', status: 'INFERRED', basis: 'continues 0x87A26 (caption 0x55, story-ep1-jack f3091)' },
  0x87E88: { who: 'the front hero', status: 'INFERRED', basis: 'E2 area 1 caption over skinned dinosaur carcasses (story-ep2-jack f2565); the caption object draws the front player\'s icon (0x87022)' },
  0x87EB6: { who: 'the front hero', status: 'INFERRED', basis: 'continues 0x87E88' },
  0x87FAC: { who: 'the front hero', status: 'INFERRED', basis: 'E5 opening caption (story-ep5-jack f103)' },
  0x87FF4: { who: 'the front hero', status: 'INFERRED', basis: 'continues 0x87FAC' },
  0x88026: { who: 'the front hero', status: 'INFERRED', basis: 'E5 opening, stampeding dinosaurs (story-ep5-jack f267)' },
  0x88166: { who: 'Slice (to his men)', status: 'INFERRED', basis: 'E4 opening, pool B type 0xAC script 0x55F2A spawns captions 0x38-0x3A; the gang barricades Jack\'s garage (story-inter4-jack f573)' },
  0x881AC: { who: 'Slice (to his men)', status: 'INFERRED', basis: 'continues 0x88166' },
  0x881D6: { who: 'Slice', status: 'INFERRED', basis: 'E4 opening, story-inter4-jack f1029' },
  0x88216: { who: 'a poacher about to take Fessenden\'s serum', status: 'OBSERVED', basis: 'story-ep6-jack f7996: KING K.K. DEMO2 (pool C 0x13C) scene, a poacher at a crate; he turns into TYROG (f8572)' },
  0x88254: { who: 'the same poacher', status: 'OBSERVED', basis: 'story-ep6-jack f8118' },
  0x8829E: { who: 'the same poacher', status: 'OBSERVED', basis: 'story-ep6-jack f8340, as the mutation starts' },
  0x882F0: { who: 'the hero held by TYROG (Mustapha in the run)', status: 'OBSERVED', basis: 'story-ep6-grab-mustapha f9087, snapshot txt-f009095.png: the type-0x120 Tyrog (the one the poacher becomes) holds Mustapha while the line prints. Caption 0x5A is spawned only by that Tyrog\'s grab-hold state 0x5E2F8-0x5E32A (moveq 0x5A at 0x5E312/0x5E328), entered when its leap attack (0x5E24A, attack id 0x34) connects (0x5E044: +0x51 == 0); the first Tyrog (type 0x10, 0x36A64) has no grab line' },
  0x882D8: { who: 'a hero', status: 'INFERRED', basis: 'caption 0x59; no spawn site found with a constant (index comes from a script byte, 0x1DBB6 -> 0xFF84FD)' },
  0x8848A: { who: 'a hero to the player', status: 'INFERRED', basis: 'HELL ROAD, pool C 0x160 (0x8BF8A) spawned by 0x8BD24 when 0xFF85F6 >= 3; seen in the attract demo (story-attract f10423)' },
  0x884F0: { who: 'one of the heroes', status: 'INFERRED', basis: 'story-ending f70: all four heroes run through the collapsing lab tunnel (CADDI. DEMO 2)' },
  0x8850A: { who: 'Jack Tenrec', status: 'OBSERVED', basis: 'story-ending f370: Jack kneels over Hannah, who has collapsed' },
  0x8851E: { who: 'Mustapha and Mess', status: 'OBSERVED', basis: 'story-ending f730: cut-in panel of Mustapha and Mess, who got out, looking back at the city' },
  0x87BD6: { who: 'a poacher hunter (blue hair, fur cloak, rifle) stalking dinosaurs', status: 'OBSERVED', basis: 'story-attract f12505: attract intro B; caption spawned by the pool B type 0x2C cut-scene actor (0x3D9F8)' },
  0x87BF8: { who: 'the same hunter', status: 'OBSERVED', basis: 'story-attract f12645' },
  0x9CBE6: { who: 'narration', status: 'OBSERVED', basis: 'story-attract f12772, over the jungle dinosaurs' },
  0x9CC64: { who: 'narration, completed by the title logo', status: 'OBSERVED', basis: 'story-attract f13132, then the title screen' },
  0x9CBB2: { who: 'narration', status: 'OBSERVED', basis: 'story-attract f11783' },
  0x9CDEC: { who: 'narration (red highlights)', status: 'OBSERVED', basis: 'story-attract f12005' },
  // intermissions
  0xE42A: { who: 'an informant (narration over a panel of the Butcher)', status: 'INFERRED', basis: 'story-inter2-jack f101: image of the Butcher, no portrait' },
  0xE500: { who: 'Hogg (biker boss) to his gang', status: 'INFERRED', basis: 'story-inter3-jack f102: image of the long-haired armoured biker on his bike' },
  0xE5AE: { who: 'the free hero (the portrait already on screen)', status: 'INFERRED', basis: 'story-inter4-jack f101: printed under the image of the wrecked garage while the portrait of the free hero (Mustapha when Jack plays) is shown with "JACK,LOOK..."' },
  0xE606: { who: 'the village elder (radio call)', status: 'OBSERVED', basis: 'story-inter5-jack f101: printed beside the elder\'s image' },
  0xE8B0: { who: 'the heroes', status: 'INFERRED', basis: 'story-inter5 f311, after the call is cut off' },
  0xE6B0: { who: PORTRAIT_PLAYER + ' (portrait printed with the blank line 0x2E; none for Hannah)', status: 'OBSERVED', basis: 'code 0xDDFC-0xDE2C; story-inter6-jack f101 shows Jack' },
  0xE74E: { who: 'the free hero', status: 'INFERRED', basis: 'story-inter7: lab-equipment image; the portrait line 0x33/0x34 follows' },
  0xE7DC: { who: 'Dr. Fessenden (on screen)', status: 'OBSERVED', basis: 'story-inter8-jack f101: image of Fessenden' },
  // E7 monitor
  0x81BE6: { who: 'Dr. Fessenden (monitor)', status: 'OBSERVED', basis: 'story-ep7-jack f14117: pool C type 0x88, COMPUTER ROOM' },
  0x81DCE: { who: 'Dr. Fessenden (monitor)', status: 'OBSERVED', basis: 'story-ep7-jack f14423' },
  0x81E74: { who: 'Dr. Fessenden (monitor), releasing SLISAUR', status: 'OBSERVED', basis: 'story-ep7-jack f14653' },
  // the ending's last screen
  0x8A956: { who: 'credits', status: 'OBSERVED', basis: 'story-ending f4936' },
  0x8A972: { who: 'credits', status: 'OBSERVED', basis: 'story-ending f4936' },
};

// Cast, places, factions (CAST.md). `evidence` points at ROM text, the HUD name table (R9, 0x17D78) or live runs.
const CAST = {
  heroes: [
    { name: 'Jack Tenrec', hud: 'JACK.T', id: 0, profile: 0x9B0F8, notes: 'mechanic and shaman (attract profile: "PART MECHANIC, PART SHAMAN", 182 cm / 78 kg, special "GOOD ABILITY"); owns the garage (E3 intermission "JACK\'S GARAGE", E4 "IN MY GARAGE?"); drives the Cadillac in the ending.' },
    { name: 'Hannah Dundee', hud: 'HANNAH.D', id: 2, profile: 0x9B192, notes: 'diplomat and explorer (170 cm / 53 kg, "ITEM SKILLED"); rides with Jack in the ending ("LET\'S GO HOME!").' },
    { name: 'Mustapha Cairo', hud: 'MUSTAPHA', id: 1, profile: 0x9B224, notes: 'engineer, "JACK\'S FRIEND" (198 cm / 68 kg, "FLYING KICK"); cap and green shirt; greets Jack and Hannah in the ending.' },
    { name: 'Mess O\'Bradovich', hud: 'MESS', id: 3, profile: 0x9B2C2, notes: '"ELUSIVE PAST" (205 cm / 97 kg, "HIGH POWERED"); walks out of the desert with Mustapha in the ending.' },
  ],
};

module.exports = { PORTRAITS, PORTRAIT_FREE, PORTRAIT_PLAYER, SPEAKERS, CAST };
