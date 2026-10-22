// Builds work/re/memory-map.json: the verified reverse-engineering foundation of the original
// Cadillacs & Dinosaurs (CPS-1, MAME set "dino"), merged from the harness, static (REA/Rizin) and runtime (MAME)
// phases and the two adversarial verifiers (static re-check, live MAME debugger re-check).
//
//   node tools/re/build-memory-map.cjs          (run from the repo root; exits 1 if a ROM self-check fails)
//
// Rule: a fact is VERIFIED only if at least one verifier confirmed it and none refuted it. Refuted claims appear only
// under "rejected", with the correction. Everything else is "unverified" (harness self-validated facts, single-source
// observations, inferences). The human-readable companion is tools/re/MEMORY-MAP.md; keep both in step.
//
// The ROM self-checks re-read the tables quoted below straight from the program image (rom.cjs) so that a typo in
// this file cannot silently survive. They do not replace the verifiers' evidence; they only guard the transcription.
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./rom.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'work', 're', 'memory-map.json');
const p = R.prg;
const u8 = (a) => p[a], u16 = (a) => p.readUInt16BE(a), s16 = (a) => p.readInt16BE(a), u32 = (a) => p.readUInt32BE(a);
const hex = (n, w = 0) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');
// Text in this ROM: optional colour byte(s) < 0x20, ASCII, terminated by '@' (0x40).
function romString(a, max = 24) {
  let s = '';
  for (let i = 0; i < max; i++) { const c = p[a + i]; if (c === 0x40) break; if (c >= 32 && c < 127) s += String.fromCharCode(c); }
  return s.trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Evidence ids (full REA evidence ids; the record files live in the folders named in meta.evidenceDirs)
const EV = {
  // static phase (work/re/static/evidence)
  s01: 'ev_7450753066cd4b8d0acd7b59769bdd754d2f8a3d9608bd526d3f497b18f5d75b', s02: 'ev_bbccda8bb29d9eb20cb50b24dbc76a0610803127eced8fd8d024cecf7954a984',
  s03: 'ev_cc2316d550b83d00106dff0649ad048bdfec2127af90f4a2dcccfbb37d42c2c7', s04: 'ev_949e431ad1ae06e66e24765a81e9314721060f764400feebbc5ffb6a1f4757c9',
  s05: 'ev_99e9ab820bb9e258b30253ad03e744e25a54742ab9db0e9d379a093f82c97584', s06: 'ev_64ac156ad05c63bed02957d2be7a722ff5c4606d68874565542900e1c0e84886',
  s07: 'ev_46e7b40a28ff29b1d1db26bcd3cb72229c3e0cbd8b3fd07dea775c881c4539d4', s08: 'ev_25dcf8e883b7cfc96b2f070ec070d429d63f8a1751c2a79971ecc502c191804d',
  s09: 'ev_929d18a4512b255f024a7b3178ad69389b6a255ede4ac11d93bfd8b2fab87a3a', s10: 'ev_00349197591ad89913901b433751ed642a58896e06b89d68939c11f846196248',
  s11: 'ev_7603a534682feb5c0459f1a323c70ee6f07644ff7f6851cc9e60667ee0407f42', s12: 'ev_e4fc41dfd29409a3439dac56cd2f36f43aa6cf32cf206d250879fc4e17847e69',
  s13: 'ev_9a5e937137c9b82ffac92e1519c1b7de537a9de33ed04e99645e44be010d3a11', s14: 'ev_2aa5256b492a490cefb8bed9c9149769fe0f4945c9aa8a9155baf7b616d9858f',
  s15: 'ev_ea87f4663815f4e119b99095f32410911c115f0a0cd073699fea729131ddb547', s16: 'ev_c84169a5fd5edc4aec9f729bf3ecc1ba4318d54e9734ab9f71f39ed0149f46ad',
  s17: 'ev_4c7700f315a83ab4e12a5cab8a65462e07ca8ec1e3d54296c0d78318ce376585', s18: 'ev_915caaf6867cd830ce0b4a9f69495241ef8c2c5397de59c9d3c6c2f87585e552',
  s19: 'ev_43877dcc7d664e584a2b622539e5bfbc82f4564548f423efed2cdd1ccad788b7', s20: 'ev_d0a17f29d027033b452f708f533c4abe2da521a8c5df7061829f86432237213f',
  s21: 'ev_7166efc95a5d3b90ab4b840cf48263169dc625522353efcac78ca246e9db785f', s22: 'ev_664e34b1de700284619cdae7095726621e434907782fe62d4f2bd191da160b7d',
  s23: 'ev_ddbb7f8de1c9567882811738c89a4142d7125c57c271b8bf513a24e5d47323a4', s24: 'ev_2eafd4cfd192073acb4f26cb7385bf10bce04a9f6eeebda7ad9352f2e48b91be',
  s25: 'ev_e6748f8e26d0d627c181f8a750a380f69823d1d259135a9815246523a4ede22d', s26: 'ev_8b11a0c55a543c2f372a9f50d3eb651406799b628aa6dcf8a7dcc6f0ed858d61',
  s27: 'ev_730d2e5e8079381b9194fac55643045a99350d39683608a8ff848a2711411287', s28: 'ev_e8af49558b459c4e63b7f287aef69715b0011da8884ebecb24787b7573a38480',
  s29: 'ev_59c6d79e7eeb185a3050c74328e0bd91bb3e6edd7eb40488433f2dda2e74b8ab', s30: 'ev_5cecc3af80d2c79b60895b7360a33af26b1422f633e68eb6450c12b12b517a47',
  s31: 'ev_284641b2dfa78df11feb4c0da8ff674cb323bbfe47a2e95c276eb741860dd337', s32: 'ev_f214435c5c63880f6a3960f23d0f3293ce1633c7a0e5afd8ecf4dc043c83ded5',
  s33: 'ev_a47ff8ab83340513f6b698acf35d6f641f12ab5b0e5f8efe95f862d76a12cacb', s34: 'ev_dc3a10c51200542c360933246256a1b7eca9abcb7ac46e815af77cb53735c9b9',
  s35: 'ev_9269abc7ae71c3a1bdfcecf892da9ca85cdc710047ce60e9208f483bb05c7916', s36: 'ev_561cc3fd6e487b1e5f6ef707565c40d1cc8973c0296290c64c6d3d80ff345673',
  s37: 'ev_583a2737fbfebb2c5df67aeb83d04eb00c39b79fe1aa1b15b2cc7243db912080', s38: 'ev_6e3e659a0aba6754acd66b0a126cbe255eba9b8e4f563c7dfa764d12dc86afb6',
  s39: 'ev_83c27a952dda044b976e58a4cf33ec909240e56e018899eb37c6b9fe15aa34ab', s40: 'ev_040244ed9bcda67fc046fe5e8535e91046a8cec532db9fca9e70cc06c6013e17',
  s41: 'ev_2c5c22f8a8c0b84e0b9bd73da0675148b9de8de645850a057f16eeeae622287b', s42: 'ev_b2d6b36243c03fef1cbe17078f1601b32a6c97efd4e2607b6b4c557226a4c02a',
  // static verifier (work/re/verify-static/evidence)
  c01hdr: 'ev_b050cb5d82315796f3a28107c9736afc25f7d1569bbd7af1f581a0c43e99097e', c01refs: 'ev_2bd68f11a6b8589497259b6fcc2145ebc794adfbf2530feb5b48973adbb5dc2e',
  c02: 'ev_2502f73e0537da286ae4e06e2e43219b17310934fefb6a64bb8aecdad186173f', c04: 'ev_cbcd7917c5fddc6b53d30b9c9b3d31a1412faebe295f8dbd0cee0c68a32604e3',
  c05: 'ev_8b5223b6628c8ac734e00f1eaf0b820bf567b1d9290405bb3cd75077754aaa41', c06: 'ev_2c9c2dd425c3203dcfcc5b2859d03bbb8517071dad925b631eff3baad2c0a20a',
  c08: 'ev_88cf1e82edd52e1cbf7fbac811bf0a704632a20f8aa8b9870277a51ca4097bfc', c10: 'ev_ec1d7b4cd3c568aab2b29902a5c5a543686467e5e88c43288f1be6ffeb13c0c9',
  c11: 'ev_7e83d00ea1ab6519f4b7c9070b9613a88c2734e47d391e91c50e7505ed4296cc', c12: 'ev_69221442ce7af4962448a7bc763262c81c9749636bc8bd7e73714693126e0e5e',
  c13: 'ev_e0a52ddcf4028794423859ed576658bc5fa502627647cb7ff81e3ad203262002', c15: 'ev_9c98cfdc6f24499e26b4acf11e97f7901f012e8d45484c0dfeecf489cc63fea8',
  c16: 'ev_82fdf06c1728f5c1695ea9dd3038163c9ccd8dfc911951305f8bd6e5d9cf5928', c17: 'ev_7c1443fd6d7ba638fad637e34618d12571b9a967676803a22a3728d375a8a404',
  c18: 'ev_559aa7d096f8862c89ff4c6490e513394d9c9790c8785562b6830690eb61272c', c19: 'ev_fc91b765662226bd39689b8052fc795b08b9800e74fc034a943132ed43f36449',
  c20: 'ev_afb60ac10849c3578479cdf2fe5cc6b38df360ff3dd992294fea755845950b8a', c21: 'ev_a3d4ad8db69703f0d1836335ec7e9af6b34d7d553f3609e554edfe937d9ad3cc',
  c24: 'ev_b81ebf85f3034792fcd75374882610b988afd1aa89bcec17d8c5161fd5dde8fb', c31: 'ev_a091ef0b1468fc53bffec5e1f51fe0e7121068ac559a4d019800ae07b6dad123',
  c32: 'ev_d551bc6b43908452061edfdafb690805f59a298c0176c77413788a82b37cfc00', c36: 'ev_d9e430421870bc278f1bb1e43a8077f95fc9d28aee7ea262a66f98f8d74417d8',
  c37: 'ev_fd4e641094d1cda75355ced4a1b798b5bb05c924bf5bda4bc840b348be33830f', c39: 'ev_bd38ee2f9a84e5686dab8421860e0271b228a0ee7c666947d02938eb9b7e147a',
  c48: 'ev_4bb3df1631d5c4ad47becd2472b983334caa960b0c72467b4067f5ef548089e2',
  // live verifier (work/re/verify-live/evidence)
  vl01: 'ev_aa6a8b113f8fa275cac7347a7c3ac68705785cef30c82133c5138e932a0230b6', vl02: 'ev_91c46fcae2de46b584d6c7838f42649771f21d4f2c923ff51f15d14369ab6cf3',
  vl03: 'ev_22af3f44a03824c0270def4a8e2e3cc5c23310c2cb84a49a0da15c92163e29aa', vl04: 'ev_4500dd3f8803388f962adbb2216ff2150638bb480e16ff1286eb766040b4ad0c',
  vl05: 'ev_62658378d74d04d0b349370952c6803afcca27fae77c8aeea4312b4de0a44460', vl06: 'ev_53cd829f43e3f487f6887ba445d9174a6a6965c6bcc49cd2d562ef4b3711e476',
  vl07: 'ev_8637ad52c9c26af057de920acdb022b6feedda73d0f49a803fe7fc5cced05ab7', vl08: 'ev_90ad1c002273d3a3fb6ca0666eb096e7eb1d0b2dd27c8541940bc7cbff8072d4',
  vl09: 'ev_41fdf3ae20e6f7335de7f93a10394e476f58818853487e20f9d549ffd573e411', vl10: 'ev_7450753066cd4b8d0acd7b59769bdd754d2f8a3d9608bd526d3f497b18f5d75b',
  // runtime phase (work/re/runtime/evidence)
  rt01: 'ev_31822c47e1f1dd97d0507c32b194655ea0bb17f71ed9c0a6ef72fece8633f941', rt02: 'ev_772527ab9999b14a605eb47f74acd93c4ab0599ed19fc491766d07fb341e1612',
  rt03: 'ev_8251ff878caaa8f98c4c623d68c99d5d5307d6aa4c0467ebd87c4f9eb0b70ca8', rt04: 'ev_f67a98556a92f3b78630006fcb7be60a32547aff62d856717fb4c4e7543f1721',
  rt05: 'ev_49fcad0f5725b502e09215f032e022130081eecd442bbe005c005c22e1869c2a', rt06: 'ev_955d383fb04b1faceb6b626328f4422e7e8e3ec47723443f4d5df0b674f2b3a3',
  rt07: 'ev_87ee5af8d8f90f8ddbd14f782c680c746a10726dc6f486daf504d4d1d0434c33', rt08: 'ev_7a4434be40617bad7ad23b5789b8d922af9c8f220b7df6e9ad75a55720dabebc',
  rt09: 'ev_b53b45d4c560cc682e0dc3705c25af8505044675fe3713e1649cc98502d013e5', rt10: 'ev_bef9f04b2570b5fd7146de95c75701e9ee455550f87814bd27fadfbb98dba991',
  rt11: 'ev_25d0f6dd96fae4c6d5c514c44a9973562a5b7519a39ea919adf6ecf22073ab59', rt12: 'ev_b1ab86ca9e74f334fdaa09c6f279973602225129e02e1c8d50ea37d7327a11cf',
  rt13: 'ev_44a6bc5ab4b77d5108cee11e8a68302427ab826b6a75f583c2a5028c205c7d2d', rt14: 'ev_9f46ca12328452d225b652b04af0dda78a7a9cd21d130129830195f62aac3ef2',
  rt15: 'ev_96a76a67d02419cc0ea75945ad915c936e5f42551695b6f2e1de41b1246d601c', rt16: 'ev_bd6267343b8bdda5f59723126eedbccc6c286fdb57bd9be7101eae9b4f1fa2ab',
  rt16b: 'ev_e2b8301e5a68cc06626962c2328041e3581a819059aa9ef4dea06553bb847cb5', rt17: 'ev_51e0be35af3bd9aae5a528479930abaf5a37c55f82cfefc4dbac7f28c2b7e0e4',
  rt18: 'ev_4e62b8c50bfc6ed7f426cdd354e434a19f8aacdcbd604c423a9951873f5726e9', rt19: 'ev_b491c81bb2bfaebfe5a4e2ffcfc6f106b6001f795c6a695b8c680a0e138aff1a',
  rt20: 'ev_03e21adff10e41bfaadb2d0afa32ad28928594318b300df74127ee0b6afc82b8', rt21: 'ev_9e5a6b358609e5046272bef8403e02f13977db035c02e466fb277b89f322f39a',
  rt22: 'ev_20ff1bd94bf49ca0ea260551f9b401ab29a47554ed5d19304a06f012cb3bbc78', rt23: 'ev_5a30e8b82a4bef78baffff88a81a4f947782b01879e10fe97a37c163f60a7287',
  rt24: 'ev_23acb02181218bc43d0763544a43832a648eb51cf43fdf190cbc6aa6ff93dff5',
  // harness phase (work/re/harness)
  hIrqA: 'ev_62e713653c9c0012d72fd1e9a042ebda2494eb00085c1b6892f90fe1a9efcfc0', hIrqB: 'ev_d87d740a5670c6f1533317e964a4ce95480cac3f17d852f0db6b7b2eaae93a26',
};
const ev = (...k) => k.map((x) => { if (!EV[x]) throw new Error('unknown evidence key ' + x); return EV[x]; });

// ---------------------------------------------------------------------------------------------------------------
// VERIFIED facts. source = the phase that made the claim; verdicts = what each verifier said.
const C = 'confirmed', CC = 'confirmed with correction', U = 'unverifiable', NA = 'not checked';
const verified = [
  // A. ROM tables and rendering
  { id: 'V01', area: 'rom-tables', name: 'Frame-record and layout tables are reached only through the ROM header at 0xFFFF0', source: 'static', verdicts: { static: CC, live: CC },
    fact: '0xFFFF0 holds 0xFFDFFFF0; 0xFFFF4 = long 0x000D0CF4 (frame-record pointer table), 0xFFFF8 = word 0x0DB9 (3513 records), 0xFFFFA = long 0x000D43D8 (layout table), 0xFFFFE = word 0x09D4 (2516). Readers: movea.l 0xFFFF4 at 0x141AE/0x14244/0x14294; movea.l 0xFFFFA at 0x142D8/0x143D0/0x144AE/0x14674. No code references 0xD0CF4/0xD43D8 directly and nothing reads the counts.',
    corrections: ['The claim said "0xFFFF0 holds ptr 0xD0CF4"; the pointer is at 0xFFFF4 (both verifiers).'],
    evidence: { rea: ev('s01', 's02', 'c01hdr', 'c01refs', 'vl10'), runs: ['vl-hdr', 'vl-draw-* (hdr-readers.json read taps)'] } },
  { id: 'V02', area: 'rendering', name: 'Sprite-list builder 0x13FA6 and OBJ double buffer', source: 'static', verdicts: { static: C, live: C },
    fact: 'A5 = 0xFF8000 everywhere (lea 0x8000.w,A5 at reset 0x41A). The builder writes OBJ RAM 0x900000 when word 0xFFE9B4 != 0, else 0x904000 (0x13FB4), and toggles 0xFFE9B4 with not.w at 0x14098. 0xFFE9B6 = camX(0xFF8744) - 0x40 (0x13FC8); 0xFFE9B8 = camY(0xFF8748), forced 0 while byte 0xFF84DC != 0 (0x13FD4). Every list ends with words (0, 0x100, 0, 0xFF00) written at 0x14076/0x1407C; shadow sprites from 0x14EC0 are written between the object entries and that marker. The IRQ2 vblank handler (0x542; test at 0x554-0x564) then shows 0x9000 when 0xFFE9B4 == 0, else 0x9040, i.e. the buffer just built.',
    evidence: { rea: ev('s03', 'c02', 'hIrqA'), runs: ['vl-draw-* debugger breakpoints: 1,790/1,790 frames toggle, camX-0x40 and camY 1,798/1,798, marker 1,790/1,790', 'vl-dbgtest'] } },
  { id: 'V03', area: 'rendering', name: 'Draw registration and depth sort', source: 'static', verdicts: { static: C, live: C },
    fact: '0x49C0 registers an object if obj+0x01 != 0; 0x49CA first calls the on-screen test 0x16FA (sets/clears obj+0x01) and skips off-screen objects. Each registration pushes word (obj address low word) then word obj+0x10 (depth) downward from 0xFFE9B0 (write pointer 0xFFE7C2, reset at 0x1406A), count 0xFFE7C0. Bubble sort 0x14002 (unsigned long compare) and draw loop 0x1404A draw in ascending (depth<<16 | addr): smallest depth (nearest the viewer) first. CPS-1 hardware gives the earliest OBJ entry priority, so nearer objects are on top; on a depth tie the lower RAM address is on top.',
    evidence: { rea: ev('s09', 's38', 's04', 'c02'), runs: ['vl-draw-wade: pushes == 0xFFE7C0 in 151/151 frames', 'draw order ascending in 1,798/1,798 frames, key high word == obj+0x10 in 10,858/10,858 objects'] } },
  { id: 'V04', area: 'rendering', name: 'Per-object draw 0x141F8 and OBJ write', source: 'static', verdicts: { static: CC, live: CC },
    fact: 'A3 = frame pointer obj+0x28. Frame word0 >= 0: record = word0/4 via [0xFFFF4]; frame word1 >= 0: a second record at the same origin (0x14294). word0 < 0 (bit15): composite part list at A3 = fp + 2 + word1 (count-1, then per part dx (negated when mirrored), dy, rec*4, flag word); word0 = 0x8000|rec*4 is then used only for the +0x4C clip bytes. Origin: D4 = x - (camX-0x40), D5 = height + depth - camY (no camera when obj+0x25 bit7 = screen space). OBJ X = D4 + layout.x, or when obj+0x24 != 0: D4 - layout.x - 16*w with flipX toggled (bchg #5). OBJ Y = (0x100 - D5) mod 0x200 + layout.y. obj+0x23 bit7: its low 5 bits replace every block palette. Per-block cull: drawn when X <= 0x1C0 and X + 16*w >= 0x40. obj+0x25 bit0 = split body (0x14136: legs record from +0x30 at the feet, torso from +0x28 at +0x3C/+0x3E). Entries are written with movem.w D0-D3,(A4).',
    corrections: ['The composite part-list offset is frame word 1 (A3 = fp + 2 + w1), not part of word 0 (live REA vl07, static c04).',
      'Two paths are not described by the claim and break an exact rebuild when present: obj+0x25 bit6 -> 0x147FE, and the pair path 0x14114 (obj+0x05 == 4 and +0x2E == 0x0C, holder +0x2E == 0x0E; order chosen by holder+0x62). The uniform-attribute mirror path uses a fixed -16, equivalent because all 261 non-bit15 records are 1 block wide.'],
    evidence: { rea: ev('s05', 's06', 's07', 's08', 'c04', 'vl07'), runs: ['tools/re/verify-live/drawmodel.cjs rebuilt every OBJ entry: vl-draw-jack 340/340 frames, vl-draw-mus-uzi 200/200, vl-draw-s5 300/300, vl-draw-screen 50/50, vl-draw-s3 283/300, vl-draw-s8 279/300 (every miss has an object on 0x147FE or 0x14114)', 'palette-override.png (P1 +0x23 = 0x85 drew in palette 5)'] } },
  { id: 'V05', area: 'rendering', name: 'Screen transform from RAM', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'Read RAM one frame before the OBJ dump: screen feetX = X - camX (0xFF8744); screen feetY = camY (0xFF8748) - (depth + height) + 240. Block top-left: sx = feetX + layout.x (as stored) or feetX - layout.x - 16*w with flip toggled (mirrored); sy = feetY + layout.y. Equivalent to the OBJ formula of V04 with the CPS-1 visible origin (64,16).',
    evidence: { rea: ev('rt17', 'c04'), runs: ['work/re/runtime/validation.json: P1 7,242/7,242 frames; enemies 18,100/18,490 (390 whole-object blink frames, 0 partial); items 4,817/4,818', 'vl-p1-pokes (X 1056->1116 moved the feet 159->213)'] } },
  { id: 'V06', area: 'rendering', name: 'Facing byte +0x24', source: 'runtime', verdicts: { static: C, live: C },
    fact: '+0x24 = 0: art drawn as stored (ROM sprite art faces LEFT); non-zero (1): mirrored, faces right. Tested at 0x142FA/0x144BE.',
    evidence: { rea: ev('c04'), runs: ['rt-p1-pokes and vl-p1-pokes: poke 0 at f120 -> unflipped from f121, poke 1 at f150 -> flipped from f151'] } },
  { id: 'V07', area: 'rendering', name: 'A held weapon is drawn in front of its holder', source: 'static', verdicts: { static: C, live: C },
    fact: '0x24AC0 copies holder+0x10 (depth) to the weapon every frame and no held handler writes weapon+0x10, so both sort with the same depth; the weapon (pool A, 0xFF8874..) has a lower address than the players (0xFFB274..) and is drawn first, i.e. on top. The pair path 0x14114 does not apply to held weapons (their +0x05 is 8 and weapon frames have byte 6 = 0).',
    evidence: { rea: ev('s38', 's17', 'c10', 'c02'), runs: ['vl-draw-mus-uzi: weapon 0x99B4 registered with P1 depth 0x128 and drawn before P1 in 201/201 frames'] } },
  // B. Objects
  { id: 'V08', area: 'objects', name: 'Object pools', source: 'static', verdicts: { static: C, live: C },
    fact: 'players 0xFFB274, 3 x 0x180 (lea at 0x6714/0x671C/0x6724). Pool A items/weapons 0xFF8874, 24 x 0xC0 (init 0x4C1A, alloc 0x4818, free 0x48D4, run dispatch 0x233F0). Pool B enemies 0xFFC8F4, 24 x 0xE0 (0x4C48, 0x483C, 0x48FC, 0x2346C). Pool C special 0xFFB6F4, 24 x 0xC0 (0x4C76, 0x4860, 0x4938, 0x2362E). Pool D effects 0xFF9A74, 48 x 0x80 (0x4CA4, 0x4884, 0x4964, 0x237E6). Pool E 0xFFDDF4, 16 x 0x80 (0x4CCC, alloc 0x48A8). Run loops jump through table[obj+0x20] (0x233E8/0x23464/0x23626/0x237DE).',
    evidence: { rea: ev('s10', 's11', 's23', 's36', 'c05'), runs: ['vl-pools-s1/s5/s8: 13 allocs and 21 frees inside the bases, stride-aligned; 22,630 dispatches with A6 in its pool and A1 == table[obj+0x20] (work/re/verify-live/poolcheck.json)'], notes: 'Pool E allocator 0x48A8 never ran live.' } },
  { id: 'V09', area: 'objects', name: 'Common object struct key fields', source: 'static', verdicts: { static: C, live: C },
    fact: '+0x08 X, +0x0C height (up +), +0x10 depth (sort key), +0x20 type*4 (heroes char*4), +0x23 palette override, +0x24 facing, +0x25 bit0 split body / bit7 screen space, +0x26 subtype (x2 word; Chinpira reads the high byte), +0x28 frame pointer, +0x2C..+0x2F frame bytes 4-7 (+0x2F = frames left), +0x30 legs frame pointer, +0x38 bob table, +0x3C/+0x3E torso offset, +0x40 animation set, +0x60 hero frame word 10 (high byte = hold index), +0x6C HP or ammo, +0x70 weapon holder, +0xA0 weapon class, +0xA2 weapon pose slot*4, +0xB4/+0xB6 hero held weapon / class. See structs.object for addresses per field.',
    evidence: { rea: ev('c06', 'c10', 's05', 's17', 's12'), runs: ['vl-p1-pokes', 'armed-check.json (60 armed states)', 'bob 400/400'] } },
  { id: 'V10', area: 'objects', name: 'Debug spawn list 0x88DDA and type handlers', source: 'static', verdicts: { static: C, live: C },
    fact: '89 entries of 26 bytes: 16-char name, word class, word type (-> +0x20), word subtype (-> +0x26), word (-> +0x5C), word whose low byte -> +0x96. Spawner 0x88D76: class & 7 indexes 0x88DB6 = [0x483C pool B, 0x4860 pool C, 0, 0x4818 pool A]; copies X/height/depth from the spawning object. Handler = long at dispatch table + type.',
    evidence: { rea: ev('s24', 's23', 'c16', 'c05'), runs: ['vl-spawn-enemies (Chinpira_A/B/C ran 0x3383A every frame; Knife Man A -> 0x4020E; Hutori_A -> 0x3B828; Pteranodon -> 0x606D4; ITEM DRAMCAN landed in pool A; spawn-enemies.png)'], notes: 'FESS MESS (pool C, type 0xC8 -> 0x844B4) was not spawned live.' } },
  { id: 'V11', area: 'objects', name: 'Item/weapon pool free list', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'Pool A free list: count 0xFFE5F4, pointer 0xFFE5FE. Alloc 0x4818 pops a slot address word and decrements the count; free 0x48D4 pushes it back, increments the count and clears 10 longs (0x28 bytes).',
    evidence: { rea: ev('rt12', 'rt13', 'c36', 'c05'), runs: ['vl-give1-bazooka: slot 0x99B4 pushed back (count 23->24, pointer 0xE60A->0xE608), first 0x28 bytes cleared'] } },
  { id: 'V12', area: 'objects', name: 'Enemy array (pool B)', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'Pool B 0xFFC8F4, 24 x 0xE0, free count 0xFFE5F8, pointer 0xFFE602. +0x00 1 hittable / 2 not hittable (stunned, knocked down) / 0 free; +0x04 state 0 init, 2 alive, 4 dying (blinks), 6 removed now; +0x20 type, +0x26 subtype, +0x08/+0x0C/+0x10 position, +0x24 facing, +0x28 frame pointer, +0x6A/+0x6C max HP / HP.',
    evidence: { rea: ev('rt14', 'rt19', 'c36'), runs: ['validation.json (11 types)', 'vl-enemy-hp1: HP 1 died to the first punch, state 4 at f115, 6 at f236, freed at f237'] } },
  // C. Animation
  { id: 'V13', area: 'animation', name: 'Animation frame format and drivers', source: 'static', verdicts: { static: C, live: CC },
    fact: 'An animation set (obj+0x40) is a table of signed self-relative word offsets, one per animation. 10-byte frames: w0 rec*4 (bit15 composite), w1 rec2*4 or composite offset, bytes 4-6 -> obj+0x2C..0x2E, byte 7 = duration (bit7 = last frame; the following word is the loop offset), w8 -> obj+0x48. Start 0x120E (set + index), tick 0x121E (subq +0x2F, advance at 0), store 0x1236. 12-byte hero frames add w10 -> obj+0x60 (0x144C): start 0x13A0..0x13CC (list chosen by obj+0x03), tick 0x1426, store 0x143E. Legs: word at frame+4 -> +0x34; its sign-extended low byte indexes the +0x38 bob table (4 bytes per entry) into +0x3C/+0x3E.',
    corrections: ['Hero legs (12-byte frames) are started by 0x1506 (from 0x5CA6) and advanced by 0x1542; 0x12DE (10-byte legs) and 0x14C2 never ran for a hero (live, REA vl06).'],
    evidence: { rea: ev('s12', 's13', 's14', 's16', 'c06', 'vl06', 'rt18'), runs: ['animcheck.json over 60 vl-arm-* runs: hero +0x48 and +0x60 7,800/7,800, +0x2F reset 817/817, bytes 4-6 7,598/7,800 (game clears +0x2C in melee step 0x20); weapon 6,780 and enemy 27,225 frames 100 %'] } },
  { id: 'V14', area: 'animation', name: 'Record numbers in animation data are stored x4', source: 'static', verdicts: { static: C, live: C },
    fact: 'movea.l (A1,D0.w) on the pointer table [0xFFFF4] uses the frame word unscaled, so frames hold rec*4. Search ROM data for rec*4 (e.g. 176 -> 0x02C0 at 0x9F4C4, 228 -> 0x0390 at 0x9FEEC, 259 -> 0x040C at 0x9FBE2).',
    evidence: { rea: ev('s31', 'c08'), runs: ['vl-hdr live ROM reads', 'Mustapha fp 0x9FBE2 while record 259 is drawn'] } },
  { id: 'V15', area: 'animation', name: 'Current frame record and animation timer', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'Current record = ROM word at [+0x28] / 4 (plus word+2 / 4 when >= 0). +0x2C..+0x2E = frame bytes 4..6. +0x2F = frames left on the current frame, reset to byte7 & 0x7F on each advance, -1 per frame, frozen during hit-stop.',
    evidence: { rea: ev('rt18', 'c06'), runs: ['anim-check.cjs', 'live: reset on advance hero 817/817, weapon 89/89, enemy 525/525; +0x2F <= duration in 41,805/41,805 object-frames'] } },
  { id: 'V16', area: 'animation', name: 'Hero animation lists and Mustapha tables', source: 'static', verdicts: { static: C, live: C },
    fact: 'Six lists of 4 longs at 0x163E, 0x164E, 0x165E, 0x166E, 0x167E, 0x168E, in character-id order Jack, Mustapha, Hannah, Mess (0x163E = main set, 0x164E = punch set, 0x168E = weapon set). Mustapha main 0x9F414: anim0 idle 171 (hold 0x40), anim1 walk 176-187 (holds 0x4E, 0x01..0x0B), anim2 run 200-208, anims 3-5 jump 218-224, anim16 legs walk 188-199. Punches 0x9FECA: 228/229, 230-233, 234-238. Weapon set 0x9FB94: a0 256 hold 0x31 (pistol), a1 259 h34 (rifle), a2 261 h3A (shotgun, bazooka), a3 265 h36 (M16), a4 270+269 h38 (Uzi), a11 262-264 bazooka fire, a14 259->260 rifle fire, a15 267 h3E -> 271+269 h3F shotgun fire.',
    evidence: { rea: ev('s15', 's32', 's33', 's29', 'c06'), runs: ['vl-moves-mustapha', 'armed heroes fp in [0x168E + char*4]'], notes: 'Live did not show records 233/234 or the standing jump 218-224 (a running jump used 225-227).' } },
  { id: 'V17', area: 'animation', name: 'Chinpira (type 0x08) animations', source: 'static', verdicts: { static: C, live: C },
    fact: 'Init 0x3386C indexes 0x3387E by the subtype high byte (0/2/4): variants A/B/C set +0x03 = 0/1/0x1A, +0x84 = 0/4/0x68, +0x40 = 0x34892/0x34B90/0x34E7C. Set 0x34892: a0 idle 2422, a1 walk 2422,2426-2430, a2 taunt 2423-2425, a6 composite punches (parts 2431-2436 + 2473), a3-a5 2462-2468, a8 2461,2441,2472.',
    evidence: { rea: ev('s30', 's35', 'c18'), runs: ['vl-spawn-enemies', '32 Chinpira composites drawn exactly in vl-draw-jack'] } },
  { id: 'V18', area: 'animation', name: 'Enemy reaction animation tables (grab / throw / knock-down)', source: 'static', verdicts: { static: C, live: C },
    fact: 'Two 38-long tables indexed by enemy +0x84: 0x2E724 (read at 0x2B41A/0x326D6/0x4A6BE; sets of ~7 anims) and 0x2E68C (0x2B4A2/0x4A746; sets of ~12 anims); the chosen anim is started via 0x1236 directly (never stored in +0x40). Live: while a hero holds an enemy (hero +0x05 = 4) the enemy plays 0x2E724 anims 0 held, 1 kneed, 2-3 thrown; after the throw 0x2E68C anims 8 landing, 4 down, 2 get up.',
    evidence: { rea: ev('s42', 'c19'), runs: ['vl-grab-jack/hannah/mustapha (grab-jack.png)'] } },
  // D. Weapons
  { id: 'V19', area: 'weapons', name: 'Weapon id (item subtype +0x26) mapping', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'See tables.weapons. HUD name: 0x23CBE takes weapon+0x26 & 0xFFFE into the word table 0x23CDE (PC-relative offsets to colour byte + text + "@").',
    evidence: { rea: ev('rt15', 'rt16', 'rt16b', 'c37', 'c36'), runs: ['rt-give-* (give-hud-sheet.png, give-hold-sheet.png)', 'live: 15 Mustapha armed states show 6 RIFLE, 6 GUN, KNIFE, 48 UZI, 48 M-16A1, 6 SHOT GUN, 4 BAZOOKA, ROD, STICK, B. KNIFE, CLUB, TORCH, DYNAMITE, GRENADE, STONE'] } },
  { id: 'V20', area: 'weapons', name: 'Held weapon and ammo', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'Hero +0xB4 = held weapon (low word of its pool-A slot, 0 = empty hands), +0xB6 = its class. Weapon: +0x26 id, +0x6C ammo/uses (subq #1 per shot at 0x25212 / 0x256D0), +0x70 holder (0xB274 = P1), +0xA0 class.',
    evidence: { rea: ev('rt21', 'c12', 'c10', 's28'), runs: ['rt-spawn-rifle', 'vl-give-rifle30 (HUD 29 RIFLE / 28 RIFLE)'] } },
  { id: 'V21', area: 'weapons', name: 'Weapon pose slots (weapon +0xA2 / 4)', source: 'static', verdicts: { static: C, live: C },
    fact: 'See tables.poseSlots. Init writes +0xA2 in the 0x24D60 switch; other writers 0x25232 (8, emptied rifle), 0x256F0 (0x18, emptied M16), 0x25A36 (0x28, stick after lumber breaks; set 0x273FE swap at 0x25A28), 0x28D3E (0x3C, class 0x20A container).',
    evidence: { rea: ev('s21', 'c12'), runs: ['60 armed states', 'vl-give1-rifle/-m16', 'vl-rod-break', 'ITEM DRAMCAN spawn'] } },
  { id: 'V22', area: 'weapons', name: 'Weapon animation sets and rotation records', source: 'static', verdicts: { static: C, live: C },
    fact: 'Each weapon set (+0x40): anims 0-15 = spin starting at rotation k; a held weapon shows frame 0 of the anim chosen by the pose table (one of 16 rotations); anim 16 = fast spin (duration-1 frames on a separate rotation run); anim 17 = lying on the ground. Rifle anims 18-28 = aimed frames 1887-1896 then 2324. See tables.weaponAnimSets.',
    evidence: { rea: ev('s22', 'c13'), runs: ['live +0x40 values for 7 guns/knife', 'vl-spawn-items: all 15 items on anim 17 frame 0'] } },
  { id: 'V23', area: 'weapons', name: 'Held-weapon placement routine 0x24A9A', source: 'static', verdicts: { static: C, live: C },
    fact: 'Called at 0x251B0 from the held state 0x25178 (which checks holder+0xB4 == self and the class). hold = holder.b[0x60] (negative = hidden). (dx,dy) = s16 pair at [0x122230 + holder.0x20] + hold*4. weapon.x = holder.x + dx (minus dx when holder.0x24 != 0); weapon.h = holder.h + dy; if holder.0x25 bit0 (split body) also add holder.0x3C to x (sign by facing) and holder.0x3E to h. Depth (0x24AC0) and facing (0x24AFA) are copied. anim = s8 at ( long at ([0x120A20 + holder.0x20] + weapon.0xA2) ) + hold; negative = hidden; stored in weapon+0x22, then jsr 0x120E (frame 0 of that anim).',
    evidence: { rea: ev('s17', 's18', 's39', 'c10'), runs: ['armed-check.json: x, h, depth, facing, anim byte and +0x28 match the formula in 60/60 armed states', 'vl-drivers: 0x24A9A called from 0x25178 on 121/121 frames'] } },
  { id: 'V24', area: 'weapons', name: 'Stance and walk-torso selection by weapon class', source: 'static', verdicts: { static: C, live: C },
    fact: '0x5BDC/0x5C1C: [0x5C36 + char*4] -> 12 words indexed by the class low byte (holder+0xB6); 0x8000 (negative) -> plain idle (0x163E anim 0 via 0x5C10), else jmp 0x13CC with that anim of the 0x168E weapon set. Needs weapon +0x05 == 8 (held, 0x5BFE). Walking (0x5CA6): +0x25 = 1 (split body), +0x38 = [0x5D1C + char*4] bob table, torso anim from the 0x5D2C tables, legs = main anim 0x10 via 0x1506. See tables.stanceByClass.',
    evidence: { rea: ev('s26', 's27', 'c15'), runs: ['Mustapha idle fp == start of the 0x5C5E anim for classes 1-9 (live; 1 and 2 give the plain idle)', 'walking: +0x25 = 1, bob 0x5DCC/0x5D9C/0x5DFC'], notes: 'Class 10 (carried container) was not reached live.' } },
  // E. Player
  { id: 'V25', area: 'player', name: 'Player struct base', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'P1 0xFFB274, P2 0xFFB3F4, P3 0xFFB574 (stride 0x180), directly below pool C.',
    evidence: { rea: ev('c24'), runs: ['predict.cjs 7,242/7,242 P1 frames', 'vl-p2join (Coin 2 + 2P start filled 0xFFB3F4)', 'vl-p3-lives (0xFFB574)'] } },
  { id: 'V26', area: 'player', name: 'Position and velocity fields', source: 'runtime', verdicts: { static: C, live: C },
    fact: '+0x08 X, +0x0C height (up +), +0x10 depth / lane (larger = farther = higher on screen): 16.16 longs, integer in the high word (the draw code reads the words). Velocities 8.8 words: +0x14 X, +0x16 height, +0x18 depth; accelerations +0x1A (X), +0x1C (height = gravity), +0x1E (depth). Integrator 0x189C-0x18DE.',
    evidence: { rea: ev('c24'), runs: ['rt-p1-pokes, vl-p1-pokes (depth poke clamped to 335 by the game moved the sprite up 39 px; height 60 lifted it 60 px then it fell)'] } },
  { id: 'V27', area: 'player', name: 'Character id order', source: 'static', verdicts: { static: C, live: C },
    fact: 'obj+0x03 (and +0x20 = id*4): 0 Jack, 1 Mustapha, 2 Hannah, 3 Mess. Every per-character table uses this order. It differs from the select-screen order (Jack, Hannah, Mustapha, Mess, also the 0xB39E names and the 0xB444 stats) and from the OBJ palette order (0 Jack, 1 Hannah, 2 Mustapha, 3 Mess).',
    evidence: { rea: ev('s15', 'c24'), runs: ['every live state and run', 'HUD hero-name table 0x17D70 uses the id order'] } },
  { id: 'V28', area: 'player', name: 'Walk speeds by character', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'Table 0x50E4: 0x20 bytes per character (8 directions of (vx,vy) words). Horizontal walk speed (+0x14, 8.8): Jack 414, Mustapha 435, Hannah 422, Mess 409.',
    evidence: { rea: ev('c24', 'c31'), runs: ['rt-p1-moves-*, vl-moves-*'] } },
  { id: 'V29', area: 'player', name: 'Lives', source: 'runtime', verdicts: { static: C, live: C },
    fact: '+0xA3 (P1 0xFFB317), HUD "=N". Start value = byte 0xFFF77C & 3 (0x4DD6); decremented at 0x1BFD6 in the death state.',
    evidence: { rea: ev('rt02', 'rt23', 'c24', 'c32'), runs: ['rt-die2, rt-lives-cheat, vl-lives-dec (3->2 at PC 0x1BFD6)'] } },
  { id: 'V30', area: 'player', name: 'Score', source: 'runtime', verdicts: { static: C, live: C },
    fact: '+0x100 BCD long (P1 0xFFB374), added at 0xFFAC/0x10008 (4 x abcd). HUD redraw flags: 0xFF0ECC plus 0xFF0ECD + player byte +0x02 (0/1/2).',
    evidence: { rea: ev('rt06', 'c32'), runs: ['rt-score-cheat (HUD 123450)', 'vl-hud (HUD 987650)'] } },
  { id: 'V31', area: 'player', name: 'Invincibility', source: 'runtime', verdicts: { static: C, live: C },
    fact: '+0x00 = 1 playing and hittable, 2 playing but not hittable (0x4AC2 only lists objects with 1). +0xEC word timer (0x168 after a respawn at 0x18B9E, 0xB4 elsewhere) and +0xF9 byte timer (from 0x6C3A, 0x3C after the stage intro) count down; when one reaches 0 with the other at 0, +0x00 returns to 1 (0x18CD4-0x18D1E). +0x00 = 2 with both timers at 0 stays 2.',
    evidence: { rea: ev('rt03', 'rt04', 'rt05', 'c32'), runs: ['rt-ec-timer / vl-ec (+0xEC = 900 -> unhittable until f910)', 'vl-p0two'] } },
  { id: 'V32', area: 'player', name: 'Select-screen stat bars', source: 'static', verdicts: { static: C, live: C },
    fact: '0xB3F8/0xB3FE read 3 bytes per character at 0xB444 in select order: Jack 4/3/3, Hannah 2/4/5, Mustapha 3/5/3, Mess 5/2/4 (POWER/SPEED/SKILL, 5 boxes). Display only: never read during gameplay.',
    evidence: { rea: ev('s25', 'c20'), runs: ['vl-boot-stats (overriding 0xB444-0xB44F changed the bars; select-stats-override.png)', 'vl-hud: 0 reads in 420 gameplay frames'] } },
  // F. Game flow
  { id: 'V33', area: 'game-flow', name: 'Frame counters and main state', source: 'runtime', verdicts: { static: C, live: CC },
    fact: '0xFF8000 (word, addq at 0xA942) and 0xFF84DA (byte, 0xA946) count main-loop passes. 0xFF84D0 main state, dispatched x4 through 0xA958: 0 title/attract, 4 character select, 8 intermission/story + stage title card, 0xC gameplay (0xAAF6, which calls the sprite builder and the timer), 0x1C ending and staff roll.',
    corrections: ['The counters advance once per main-loop pass, not per video frame: they stay 0 for boot frames 0-389 and freeze during the select-confirm transition (f561-639) (live).'],
    evidence: { rea: ev('rt07', 'c39'), runs: ['rt-boot-state, vl-boot (0 -> 4 at f393/394 -> 0xC at f640)', 'ending.png'] } },
  { id: 'V34', area: 'game-flow', name: 'Stage id', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'Byte 0xFF84D9 = 0..7 for EPISODE 1..8. Stage clear 0xABE8: +1 & 7, clears area 0xFF8786 and 0xFF84D1/0xFF84D2, sets main state 8; after stage 7 the ending follows. Title cards: EPISODE 2 THE SWAMP FOREST, 3 HELL ROAD, 4 JACK\'S GARAGE, 5 VILLAGE OF FLAME, 6 JUNGLE AND MINE, 8 THE UNDER WORLD.',
    evidence: { rea: ev('rt08', 'rt22', 'c39'), runs: ['rt-warp-s1/-s4/-s7 (warp-titles.png)', 'warp3.png, warplive6.png'] } },
  { id: 'V35', area: 'game-flow', name: 'Area id and stage controller', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'Controller 0xFF873C (A5+0x73C): +0x05 state of the last triggered segment (= segment byte +0x0B), +0x08/+0x0C camera X/Y (0xFF8744/0xFF8748), +0x4A area (0xFF8786), +0x56 pointer to the next script segment (0xFF8792), +0x6C its index, +0x6D "exit reached". Scripts: 0x21B2A = word offset per stage, then 16-byte segments (+0 camera-X trigger, 0 = area start / no trigger; +0x0A area; +0x0B state). The area byte is written at 0x20C8E and 0x20D56 (move.b 0xA(A4),0x4A(A6)).',
    corrections: ['The runtime phase quoted PCs 0x20C94/0x20D5C; those are the next-instruction PCs reported by the write tap.'],
    evidence: { rea: ev('rt10', 'rt11', 'c39'), runs: ['rt-bot-s1-tap, vl-bot-s1: triggers 1032/1120/1232/1408/432/544/160/464 fired as camX passed them'] } },
  // G. Tooling built on the map
  { id: 'V36', area: 'tooling', name: 'Cheat invuln', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'Every frame: P1+0x00 = 2 (if 1 or 2) and +0xF9 = 0x3C.', evidence: { runs: ['rt-invuln / vl-cheat-invuln: 0 HP drops and 0 hurt frames in 1,500 frames; without it 7 hits, HP 100 -> 35'] } },
  { id: 'V37', area: 'tooling', name: 'Cheat give weapon with N ammo', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'Pop a pool-A slot like the spawner 0x88D76 (type 0, subtype = weapon id) at the hero feet; after the game init set +0x6A/+0x6C/+0x6E = N; hold P1 attack 3 frames to pick it up. Needs empty hands.',
    evidence: { runs: ['rt-give-* (all 15)', 'vl-give-rifle30, vl-give1-*'] } },
  { id: 'V38', area: 'tooling', name: 'Cheats warp / warpLive / warpArea', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'warp: stage byte while 0xFF84D0 == 4. warpLive: stage byte, area 0, 0xFF84D1 = 0, 0xFF84D2 = 0, 0xFF84D0 = 8 (same writes as stage clear 0xABE8). warpArea: controller +0x56/+0x6C = first zero-trigger segment of the area, +0x6D = 1, state 1.2.',
    evidence: { runs: ['warp3.png (EPISODE 3)', 'warplive6.png (EPISODE 6)', 'warparea2.png (47TH STREET)', 'rt-warparea-*'] } },
  { id: 'V39', area: 'tooling', name: 'Cheats killAll and freeze', source: 'runtime', verdicts: { static: C, live: C },
    fact: 'killAll spawns pool-B type 0x24 "ENEMY CLEAR" (0x3B7D6: +0x6C = 0 and +0x04 = 6 on every active pool-B slot, then frees itself). freeze restores each active pool-B slot from a snapshot every frame (Lua only).',
    evidence: { rea: ev('rt14'), runs: ['vl-killall (pool B empty the same frame)', 'vl-freeze'] } },
  { id: 'V40', area: 'tooling', name: 'Save states', source: 'runtime', verdicts: { static: U, live: C },
    fact: 'E:/tools/mame/states/dino/: 76 runtime states (stage1-<hero>-armed-<15 weapons> = 60, stage2..8-jack and -mustapha = 14, stage1-jack-area1/-area2) plus the harness stage1-* states; all 80 stage states reloaded with the expected stage byte, main state 0xC, char id, held subtype or area, and the hero moving with Right.',
    evidence: { runs: ['vl-states (79 in one session) + vl-arm-hannah-bazooka', 'work/re/runtime/states.json', 'work/re/harness/states.json'] } },
];

// ---------------------------------------------------------------------------------------------------------------
// Harness facts: self-validated against MAME screenshots by the harness phase; no verifier re-checked them.
const harness = [
  { id: 'H01', name: 'Sprite screen transform', fact: 'sx = (obj.x & 0x1FF) - 64, sy = (obj.y & 0x1FF) - 16 on the 384x224 screen', check: 'origin scan picked (-64,-16) in 9/9 frames', corroboratedBy: ['V05 (feet transform from RAM uses the same origin and reproduced 7,242/7,242 P1 frames)'] },
  { id: 'H02', name: 'Sprite tile codes', fact: 'OBJ code indexes the 4 MB graphics directly (bytes at code*128); highest code in stage 1 = 0x57A1, none >= 0x8000 in 29,852 entries', check: 'MAME :gfx region byte-identical to rom.cjs gfx', corroboratedBy: [] },
  { id: 'H03', name: 'Sprite decode accuracy', fact: 'precision 99.80 % (60,562/60,686), recall 100 % (60,529/60,529); the 124 misses lie under the scroll1 text layer', check: 'validate-obj.cjs with --nosprites replays', corroboratedBy: [] },
  { id: 'H04', name: 'Sprite and scroll timing', fact: 'OBJ list dumped at frame f is shown in snapshot f+1; scroll registers dumped at f are used for snapshot f; RAM at f-1 produces the OBJ list at f', check: 'lag scan, poke-timing2, scroll-lag (20/20)', corroboratedBy: ['V05 (live X poke: feetX = X - camX read one frame before the OBJ dump)'] },
  { id: 'H05', name: 'IRQ2 OBJ base select', fact: 'vblank IRQ2 (autovector 0x68) at 0x542: d0 = 0x9000, 0x9040 if word 0xFFE9B4 != 0, written to 0x800100; scroll bases from 0xFF802A/2C/2E', check: 'REA ' + EV.hIrqA + ', ' + EV.hIrqB, corroboratedBy: ['V02 (builder side of the same toggle)'] },
  { id: 'H06', name: 'Live sprite palettes', fact: 'OBJ palettes 0-31 = ROM palette set 0 at 0xB7A52 with brightness F; MAME colour c = n*0x11*(0x0F+2*B)/0x2D', check: 'palettes 0,1,2,3,6,7 compared word by word', corroboratedBy: [] },
  { id: 'H07', name: 'Mustapha idle = record 171', fact: 'live entries FA1/FB0/FE0/FF0 = record 171 mirrored, feet (159,200); record 174 also matched; Jack records 0,5,6,9,15,35,66', check: 'validate-mustapha, mustapha-idle-record', corroboratedBy: ['V16 (anim0 of 0x9F414 is record 171)'] },
  { id: 'H08', name: 'Boot recipe', fact: 'Coin 1 at 330-335, 1P Start 370-375, select ~400 (cursor on Jack), Right x0..3 at 430/445/460, Button 1 at 480-483; control returns Jack 1304, Hannah 1307, Mustapha 1320, Mess 1315', check: 'held-vs-idle divergence of 0xFFB27C (make-states.cjs)', corroboratedBy: ['V33 (main state 4 at f393/394, 0xC at f640)'] },
  { id: 'H09', name: 'Stage-1 save states', fact: 'stage1-jack (1302), -hannah (1305), -mustapha (1318), -mess (1313), -mess-intro (1200); a state saved at S resumes at boot frame S+1', check: 'held/idle verify runs', corroboratedBy: ['V40 (all stage states reloaded by the live verifier)'] },
  { id: 'H10', name: 'P1 world X word', fact: '0xFFB27C (1056 in every stage1 state)', check: 'make-states', corroboratedBy: ['V26 (0xFFB27C = integer word of P1 +0x08)'] },
  { id: 'H11', name: 'Camera X', fact: '0xFF8744; copy 0xFFE9B6 = camX - 64', check: 'camera-probe 202 frames', corroboratedBy: ['V02', 'V05'] },
  { id: 'H12', name: 'Camera Y', fact: '0xFF8748 (the harness had the depth sign inferred)', check: 'camera-probe', corroboratedBy: ['V05 settles it: feetY = camY - (depth + height) + 240'] },
  { id: 'H13', name: 'MAME -state option', fact: 'with -state the autoboot Lua never runs; load states from Lua (machine:load before the first frame)', check: 'probe', corroboratedBy: [] },
  { id: 'H14', name: 'CPS-A registers are write-only on the bus', fact: 'read the :cps_a_regs / :cps_b_regs shares instead of 0x800100', check: 'API probe', corroboratedBy: [] },
  { id: 'H15', name: 'Run cost', fact: '2-5 s per short run (6-9x real time), cold boot to 1500 frames ~4.5 s; parallel runs work', check: 'summary.json', corroboratedBy: [] },
];

// ---------------------------------------------------------------------------------------------------------------
// REJECTED: refuted by at least one verifier. "claim" is what was asserted; "correction" what the refuting verifier found.
const rejected = [
  { id: 'R1', name: 'Hold validation against the measured arcade truth', source: 'static', refutedBy: ['static'], confirmedBy: ['live (ROM/MAME side only)'],
    claim: 'The ROM formula reproduces the four measured arcade placements exactly.',
    correction: 'The ROM formula and MAME agree exactly (live, facing forced to 0, tight box of the weapon relative to the feet): rifle hold 0x34 -> rec 1892 top-left (-54,-68) 74x14; shotgun hold 0x3A -> rec 1665 (-43,-65); Uzi stance 270+269 hold 0x38 -> rec 1649 (-43,-64); knife hold 0x40 -> rec 1685 (-2,-77). The repo\'s measured values (game.js HOLD/KNIFE_UP rel + arcade-heroes.js grip) give rifle (-53,-68), shotgun (-39,-63) (from a 49x16 sheet sprite, not the 47x11 ROM record), Uzi (-41,-63) (measured on record 267, which is the shotgun-fire frame, hold 0x3E), knife (-2,-77): only the knife matches. Off by 1 px (rifle), 2/1 px (Uzi), 4/2 px (shotgun).',
    evidence: { rea: ev('c11', 's19', 's20', 's22'), runs: ['vl-native-mustapha-*'], tools: ['tools/re/vs-holds.cjs'] } },
  { id: 'R2', name: 'Weapon item init data: "empty guns become class 0x203"', source: 'static', refutedBy: ['live'], confirmedBy: ['static'],
    claim: 'Each shot does subq #1 on +0x6C and every emptied gun becomes a class-0x203 club.',
    correction: 'Init class/slot/count and -1 per shot are right (see tables.weapons). On the last round: rifle -> class 0x203 pose 2 and M16 -> 0x203 pose 6 (kept as clubs); revolver, Uzi and shotgun -> class 0x201 and the hero throws them away; the bazooka keeps 0x209 and is discarded (slot freed). Code: 0x2521E/0x256DC write #0x203; 0x2530A/0x25578/0x257EA write #0x201.',
    evidence: { rea: ev('vl08', 'c12'), runs: ['vl-give1-rifle/-gun/-uzi/-m16/-shotgun/-bazooka'] } },
  { id: 'R3', name: '0xB7472 is the complete animation-set list', source: 'static', refutedBy: ['live'], confirmedBy: ['static (format only)'],
    claim: 'The debug viewer table at 0xB7472 (187 entries: long pointer, word driver 0/4/8 -> 0xAB440 = [0x143E, 0x1236, 0x16C6], word palette group) lists all animation sets.',
    correction: 'The table and its format are real, but it is partial: 5 of the 37 distinct +0x40 sets seen live in 2,620 RAM dumps are missing (Chinpira_C 0x34E7C, Chinpira hit sets 0x577D2 and 0x57D84, pool D effect sets 0x96884 and 0x96D06), and the reaction-table sets (V18) are never stored in +0x40. Find sets from move.l #set,0x40(A6) xrefs and live +0x40 values instead. Owner-per-set in anim-sets.json is an unverified inference.',
    evidence: { rea: ev('s41', 'c17'), runs: ['2,620 RAM dumps (verify-live poolscan.cjs)'] } },
  { id: 'R4', name: 'Melee damage table: 120 4-byte entries per hero', source: 'static', refutedBy: ['static'], confirmedBy: ['live (formula only)'],
    claim: '0x10A34: A4 = [0xA26FC + attacker.0x20] + attacker.b[0x58]*4; 120 entries of [damage, stun, ?, ?].',
    correction: 'The pointer formula is right (Jack 0xA270C, Mustapha 0xA28EC, Hannah 0xA2ADC, Mess 0xA2CBC, 0x1E0 apart) but every value written to +0x58 is even (0..0x7A) and 0x10A34 reads 8 bytes: records are 8 bytes, 60 per hero, index = b[0x58]/2. Bytes: 0 damage (through modifier 0x2B904, then subtracted from victim +0x6C), 1 subtracted from victim +0x78 (stun meter), 2 -> victim +0x7B and +0x06 (reaction), 3 -> +0x59 of both, 4 -> jsr 0x962A (effect), 5 -> jsr 0xFFC8 (sound), 6 -> D5, 7 -> victim +0x9A. hero-damage.json odd attackIds are bytes 4-7 of the previous record. Live: Jack ids 0,0,2,4 read bytes 0x0A,0x0A,0x0F,0x1D and did 12,11,15,32 after the modifier. Indices 0x78/0x7A (written at 0x4212/0x422C/0x444A) would point past 0x1E0 (open). 0x12540 (grab attacks) is a second user of the same table.',
    evidence: { rea: ev('s37', 'c21', 'vl05'), runs: ['vl-dmg-jack, vl-dmg-jack-ov'], tools: ['tools/re/vs-58.cjs'] } },
  { id: 'R5', name: 'Wading clip bytes chosen by height parity', source: 'static', refutedBy: ['live'], confirmedBy: [],
    claim: '0x11D220 + rec*4 is copied to +0x4C; when +0x53 is set and height < 0x18, (+0x4C or +0x4D by height parity) blocks are dropped from the end of the record.',
    correction: '+0x4C = ROM[0x11D220 + rec*4] (rec = w1 if w1 >= 0, else w0 & 0x7FFF): hero 7,400/7,400, weapon 6,780, enemy 27,225 frames. Blocks dropped = byte [+0x4C + (((max(h,0)+8) >> 4) & 1)], i.e. +0x4C for h < 8, +0x4D for 8 <= h < 0x18, none above; only while +0x53 is set, applied to the first record when w1 < 0 (else the second). 0x14BC6 adds a splash sprite.',
    evidence: { rea: ev('s34', 'vl09'), runs: ['vl-draw-wade (150/150 frames)'] } },
  { id: 'R6', name: 'Player state bytes +0x04..+0x07', source: 'runtime', refutedBy: ['live'], confirmedBy: ['static (dispatch only)'],
    claim: '+0x05 reaction (0, 2 hurt, 4 down); +0x06 action (0 stand, 2 walk, 4 jump); +0x07 step (4 punch, 0x14 pick up, 0x16 fire, 0x0E intro pose).',
    correction: '+0x04: 0 init/respawn, 2 alive, 4 dead (dispatch table 0x18A72 = 0x18A82, 0x18CD4, 0x1BF42, and a state 6 at 0x18EB0). +0x05 (dispatch 0x18EA0): 0 normal, 2 hurt / knocked down (sub-steps in +0x06: 0x20 fall, 0x1E get up), 4 holding a grabbed enemy. +0x06: 0 on the ground, 2 running/dash, 4 jump. +0x07: 2 walk, 4 then 6/8/0xA/0xC punch combo, 0x14 pick up, 0x0E intro pose, 0x16 fire rifle/revolver/shotgun, 0x1C fire Uzi/M16, 0x22 fire bazooka.',
    evidence: { rea: ev('c24'), runs: ['vl-moves-*', 'vl-grab-*', 'vl-hp-hit', 'vl-timer'] } },
  { id: 'R7', name: 'Player HP +0x6E = HP shown in the bar', source: 'runtime', refutedBy: ['live'], confirmedBy: ['static'],
    claim: '+0x6A max, +0x6C HP, +0x6E HP shown in the bar.',
    correction: '+0x6A max HP and +0x6C HP (100 at start) are right. +0x6E is the HP before the last hit, copied from +0x6C at 0x10A4E/0x116C2/0x12556 just before damage (also queued for the enemy HUD at 0x16B6A). The bar is redrawn only on a hit and then shows +0x6C; poking +0x6E never changed it.',
    evidence: { rea: ev('vl04', 'c32', 'rt01'), runs: ['vl-hud, vl-hp, hp-hit-frames.png'] } },
  { id: 'R8', name: 'Stage timer: one second per 50 frames; credits at 0xFF847D', source: 'runtime', refutedBy: ['static', 'live'], confirmedBy: [],
    claim: '0xFF84E8 BCD M:SS, one second per 50 frames (tick 0xFF84EA reset to 0x32); 0xFF847D = credits.',
    correction: '0x1037E/0x103B2 run once per gameplay frame (jsr at 0xAB20): the tick counts 0x32..0 and the BCD second is taken on the following frame, so one displayed second = 51 frames (8 live measurements). At 0:00 the player dies one tick later. 0xFF847D counts coin-slot-1 credits only; a Coin 2 credit (HUD "CREDIT 1") left it at 0.',
    evidence: { rea: ev('rt20', 'c39', 'vl01'), runs: ['vl-hud, vl-timer, rt-bot-s1 (80 s -> death near f4200 fits 51)'] } },
  { id: 'R9', name: 'HUD enemy name mapping "not determined"', source: 'runtime', refutedBy: ['live'], confirmedBy: [], staticVerdict: U,
    claim: 'The mapping from HUD enemy names to enemy type/subtype is unknown (routine 0x17D2E).',
    correction: 'Determined live: on a hit, 0x16B60 queues {kind, enemy+0x03, +0x6A, +0x6E, +0x6C, obj} into the 16 x 16-byte queue at 0xFFEBDE (write index 0xFFEBD8); 0x16E46 copies kind/name into the HUD slot 0xFFEB98 (+4/+5); 0x17D2E draws table 0x17D78[+5] (hero table 0x17D70 when +4 == 2). Name index = enemy +0x03 (Chinpira A/B/C 0/1/0x1A = FERRIS/GNEISS/DRIVER). See tables.hudEnemyNames.',
    evidence: { rea: ev('vl02', 'vl03', 'c48'), runs: ['vl-hudname*'] } },
];

// ---------------------------------------------------------------------------------------------------------------
// UNVERIFIED: single-source observations, verifier side findings and inferences. Use with care.
const unverified = [
  { id: 'U01', kind: 'verifier side finding (live)', fact: 'Extra draw paths: obj+0x25 bit6 -> 0x147FE (frame pointer is a pointer to a record); pair path 0x14114 for grabs (obj+0x05 == 4, +0x2E == 0x0C, holder +0x2E == 0x0E, order by holder+0x62); 0x14BC6 wading splash (skipped when obj+0x25 bit5); 0x14EC0 shadow sprites appended after the objects.', evidence: 'verify-live drawcheck-vl-draw-s3/-s8 misses; static object-struct.json for bit5/bit6' },
  { id: 'U02', kind: 'verifier side finding (static)', fact: '8-byte animation driver 0x16AE/0x16C6 (driver 8 of the 0xB7472 viewer list).', evidence: 'REA ' + EV.c06 + ', ' + EV.c17 },
  { id: 'U03', kind: 'verifier side finding (live)', fact: 'Knife Man A (type 0x38): its first handler call re-spawns it in another slot and turns itself into type 0xF0.', evidence: 'vl-spawn-enemies' },
  { id: 'U04', kind: 'runtime observed', fact: '0xFF801B = P1 input bits (R 1, L 2, D 4, U 8, attack 0x10, jump 0x20); hero +0xA0/+0xA1 = input this/last frame; +0x22 = stick direction in 32nds (0 up, 8 right, 0x10 down, 0x18 left, 0xFF none).', evidence: 'rt-spawn-rifle, rt-p1-moves' },
  { id: 'U05', kind: 'runtime observed', fact: 'Jump start velocity and gravity are per character: rt-p1-moves saw +0x16 = 0x055B and +0x1C = -0x4A; vl-p1-pokes saw 1216 then -64 per frame. Hero not recorded for either.', evidence: 'rt-p1-moves, vl-p1-pokes' },
  { id: 'U06', kind: 'runtime inferred', fact: 'Hero +0x5E attack-press counter, +0x70 partner object (grab / last hit), +0x110 score copy (extend threshold?), +0xC4 fire request consumed by the weapon (0x251F4).', evidence: 'rt-fight; static 0x251F4' },
  { id: 'U07', kind: 'runtime observed', fact: '0xFF844A fade counter (0xF at area exit, area loads at 0); 0xFF84E6 starting-lives copy; stage-timer start values from 0x1033E.', evidence: 'rt-areawarp-*, REA ' + EV.rt23 + ', ' + EV.rt20 },
  { id: 'U08', kind: 'runtime observed', fact: 'Hero start table 0x4E56: word offset per stage, then per area 3 players x (X, height, depth); stage 1 area 0 P1 = (1056, 0, 296).', evidence: 'REA ' + EV.rt24 + ', ' + EV.rt09 },
  { id: 'U09', kind: 'runtime observed', fact: 'Areas per stage from the script table 0x21B2A: 3,3,1,3,2,3,4,4 (EPISODE 1..8). warpArea can enter E1 a1/a2, E2 a2, E4 a1/a2, E6 a1, E7 a1-a3, E8 a1/a2; E2 a1, E5 a1, E6 a2, E8 a3 start by scrolling (no zero-trigger segment). Segment words +2..+8 are camera/limit words (meaning not traced). Controller +0x06 sub-states (state 1: 0 init, 2 wait, 4 fade, 6 load, 8).', evidence: 'REA ' + EV.rt10 + '; rt-areawarp-*' },
  { id: 'U10', kind: 'static observed', fact: 'Frame bytes 4/5 (+0x2C/+0x2D), word 8 (+0x48, e.g. 0x2000/0x2100 in gun stances), the low byte of word 10, and +0x44 (0x103000 enemies, 0x100C00 weapons) are stored as described but their meaning (hit/attack boxes?) is untraced.', evidence: 'static report open questions' },
  { id: 'U11', kind: 'static observed', fact: 'Enemy HP and speed are written inside each handler or helpers (e.g. 0x31424, 0x35812 for Chinpira), not in a table. Census: Chinpira max HP 44/52, Knife Man 76, Subayai Zako 44, Torikeratopss 100.', evidence: 'static report; work/re/runtime/enemy-census.json' },
  { id: 'U12', kind: 'static observed', fact: 'Torch also spawns a pool-A type-0x18 object (0x24F6E). A carried container (ITEM DRAMCAN etc., class 0x20A) uses pose slot 15.', evidence: 'REA ' + EV.c12 },
  { id: 'U13', kind: 'static observed', fact: 'Weapon sets have anims above 17 that are only partly decoded: rifle 18-28 (aimed) and 29-44, M16 18-33 (2808-2815), dynamite fuse anims, container sets.', evidence: 'static report' },
  { id: 'U14', kind: 'static observed', fact: 'The hold-offset table 0x122230 holds 4 character pointers then 0 then 0xFFF9002A; Mess entries were sized at 96 from the pose tables (assumed). Mustapha main-set anim 27 (0x9FA6A) has no end flag after frame 7.', evidence: 'static report' },
  { id: 'U15', kind: 'runtime observed', fact: 'Enemy types seen in the stage states (enemy-census.json): stage 1 Chinpira 0x08, Subayai Zako 0x50, Knife Man 0x38, plus unnamed 0xDC/0xC4/0xD8/0xC8/0x3C/0xF0/0xA4; later stages Kameleon Man 0x18, Hutori 0x28, Mituryou Sya 0x34, N.Richmond 0x48, Arosaurus 0x60, Dinonics 0x74, Torikeratopss 0x98, Thurow Bomb/DYNA Zako 0x100, Bike Chinpira 0x118, Dinosaurs Naguri 0x13C, Pteranodon 0x148 and more.', evidence: 'work/re/runtime/enemy-census.json' },
  { id: 'U16', kind: 'live observed', fact: '0xFFF77C = 0x41 in this MAME setup (start lives = 0x41 & 3 = 1 as configured).', evidence: 'vl-lives-dec' },
];

// ---------------------------------------------------------------------------------------------------------------
// Data files written by earlier phases that still contain rejected statements.
const staleFiles = [
  { file: 'work/re/runtime/memory-map.json', issues: ['timer "one second every 50 frames" (R8: 51)', '+0x6E "HP shown in the HUD bar" (R7)', 'state-byte meanings +0x05..+0x07 (R6)', 'frame counter "+1 every game frame" (V33 correction)', 'p2p3status "not run-time tested" (V25: tested live)', 'credits 0xFF847D without the coin-2 caveat (R8)'], supersededBy: 'work/re/memory-map.json' },
  { file: 'work/re/static/hero-damage.json', issues: ['120 4-byte entries per hero; odd attackIds are really bytes 4-7 of the previous 8-byte record (R4)'] },
  { file: 'work/re/static/object-struct.json', issues: ['+0x4C/+0x4D "chosen by height parity" (R5)', '+0x6E "displayed HP" (R7)'] },
  { file: 'work/re/static/anim-sets.json', issues: ['treats 0xB7472 as the full set list; owner per set inferred (R3)'] },
  { file: 'work/re/static/weapon-items.json', issues: ['class 0x203 "also an emptied gun" is only true for rifle and M16 (R2)'] },
  { file: 'work/re/static/hold-validation.txt', issues: ['contains no measured comparison (R1)'] },
  { file: 'game.js HOLD / KNIFE_UP and arcade-heroes.js grips (the sequel itself)', issues: ['rifle, Uzi and shotgun placements are 1-4 px off the ROM/MAME truth; Uzi was measured on record 267, the shotgun-fire frame (R1)'] },
];

const openQuestions = {
  weaponHolds: [
    'Only Mustapha\'s four holds (rifle 0x34, shotgun 0x3A, Uzi 0x38, knife 0x40) were measured live. Generate every hold index x pose slot for all four heroes from 0x122230/0x120A20 (V23) and confirm a sample live in the 60 armed states, both facings, including split-body walking (torso offset +0x3C/+0x3E plus the per-character bob tables 0x5D9C/0x5DCC/0x5DFC/0x5E2C).',
    'Replace the repo\'s video-measured HOLD numbers with ROM-derived ones (R1): the Uzi stance is records 270+269 with hold 0x38, not record 267.',
    'Mess hold-table length (U14); class 10 carried-container stance (pose 15) never reached live.',
    'Firing: rifle aimed anims 18-28, M16 extra anims 18-33, bazooka 262-264, the shot/projectile object (static evidence 40-shot-object), muzzle flash and recoil timing; empty-gun outcomes per weapon (R2).',
  ],
  enemyAnimations: [
    'Only Chinpira (type 0x08) sets are decoded. For every other type (Hutori 0x28, Knife Man 0x38/0xF0, Subayai Zako 0x50, Mituryou Sya 0x34, Kameleon Man 0x18, N.Richmond 0x48, the dinosaurs 0x60/0x74/0x98/0x138/0x13C/0x140/0x148, bosses 0x7C/0x80/0x120/0x150, FESS MESS 0xC8 in pool C, ...), spawn it with the verified debug-list format (V10) in a stage state, read +0x40 and walk its sets with the verified frame format (V13). Do not rely on 0xB7472 (R3).',
    'Enemy palettes 5/9/13/14/25/29: carried by the record attrs or forced through +0x23 bit7 (V04)? Needed to colour extracted enemies correctly.',
    'Which flag makes dying/stunned enemies skip alternate frames (blink), and the meaning of frame bytes 4/5, word 8 and +0x44 (likely hit/attack boxes, U10).',
    'Reaction sets per type (0x2E68C/0x2E724 by +0x84, V18) and the 8-byte damage record bytes 2-7 (R4); indices 0x78/0x7A past the 60-record table.',
    'Sprite codes >= 0x8000 and MAME\'s CD63B bank mapper (never seen in stage 1; check stages 2-8).',
  ],
  stageBackgrounds: [
    'Nothing about the scroll layers is verified yet: decode scroll1/2/3 tile formats, tilemap layout and rowscroll from the harness dumps (dump.scroll, dump.allPalettes) and model CPS-B layer priority.',
    'Find where each stage/area tilemap lives in ROM (or capture it by scrolling the camera through each area from the stage<N>-* and area states and stitching the dumps).',
    'Script segments (0x21B2A): meaning of words +2..+8 (camera limits?) and bytes +0x0C..+0x0F; areas that start by scrolling (U09) need a scripted walk to reach.',
  ],
  storyText: [
    'Text format seen in verified tables: colour byte, ASCII, "@" terminator (0x17D78 enemy names, 0x17D70 hero names, 0x23CDE weapon names, 0xB39E select names). work/re/text-story.txt is an untriaged ASCII dump (tools/re/text.cjs).',
    'Trace main state 8 (intermission/story + title card, 0xD898) and the ending state 0x1C (0xAC48) to find the story-text tables, their per-stage order and the caption triggers (e.g. "47TH STREET", "TOP OF THE BUILDING", the stage-1 intro dialogue).',
    'Map each enemy type to its HUD name (+0x03 index into 0x17D78, R9) to name the cast: FESSENDEN is index 0x22, ZEKE 0x21, TYROG 2 0x23.',
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Structured tables (values re-read from ROM where possible).
function charLists() {
  const names = ['Jack', 'Mustapha', 'Hannah', 'Mess'];
  const lists = [['0x163E', 'main set'], ['0x164E', 'punch set'], ['0x165E', 'set 3'], ['0x166E', 'set 4'], ['0x167E', 'set 5'], ['0x168E', 'weapon set']];
  return lists.map(([a, what]) => ({ list: a, what, perChar: Object.fromEntries(names.map((n, c) => [n, hex(u32(parseInt(a, 16) + c * 4))])) }));
}
function stanceByClass() {
  const names = ['Jack', 'Mustapha', 'Hannah', 'Mess'];
  return names.map((n, c) => {
    const t = u32(0x5C36 + c * 4);
    const words = [...Array(12)].map((_, i) => u16(t + i * 2));
    return { char: n, table: hex(t), animIn0x168EByClassLowByte: words.map((w) => (w & 0x8000 ? null : w)), bobTable: hex(u32(0x5D1C + c * 4)), status: c === 1 ? 'verified live (classes 1-9)' : 'verified table format; values decoded statically' };
  });
}
function holdTables() {
  const names = ['Jack', 'Mustapha', 'Hannah', 'Mess'];
  return names.map((n, c) => ({ char: n, holdOffsets: hex(u32(0x122230 + c * 4)), poseRows: hex(u32(0x120A20 + c * 4)) }));
}
function hudEnemyNames() {
  const out = [];
  for (let i = 0; i < 0x24; i++) out.push({ index: hex(i, 2), name: romString(0x17D78 + u16(0x17D78 + i * 2)) });
  return out;
}
function spawnList() {
  const tables = { 0: 0x2346C, 1: 0x2362E, 3: 0x233F0 };
  const pools = { 0: 'B', 1: 'C', 3: 'A' };
  const out = [];
  for (let i = 0; i < 89; i++) {
    const a = 0x88DDA + i * 26;
    const name = p.slice(a, a + 16).toString('latin1').replace(/\0/g, ' ').trim();
    const cls = u16(a + 16), type = u16(a + 18), sub = u16(a + 20);
    const k = cls & 7;
    out.push({ i, addr: hex(a), name, class: cls, pool: pools[k] || '?', type: hex(type), subtype: hex(sub), handler: tables[k] !== undefined ? hex(u32(tables[k] + type)) : null });
  }
  return out;
}

const tables = {
  romHeader: { '0xFFFF4': '0x000D0CF4 frame-record pointer table', '0xFFFF8': '0x0DB9 = 3513 records', '0xFFFFA': '0x000D43D8 layout table', '0xFFFFE': '0x09D4 = 2516 layouts', factId: 'V01' },
  heroAnimLists: { factId: 'V16', lists: charLists() },
  weapons: { factIds: ['V19', 'V20', 'V21'], note: 'id = item subtype +0x26; pose = +0xA2/4; empty-gun outcome per R2',
    ids: [
      { id: '0x00', hud: 'RIFLE', class: '0x205', ammo: 6, pose: 1, emptied: 'class 0x203, pose 2 (club)' },
      { id: '0x02', hud: 'GUN', class: '0x204', ammo: 6, pose: 0, emptied: 'class 0x201, thrown away' },
      { id: '0x04', hud: 'KNIFE', class: '0x202', ammo: 6, pose: 3 },
      { id: '0x06', hud: 'UZI', class: '0x206', ammo: 48, pose: 4, emptied: 'class 0x201, thrown away' },
      { id: '0x08', hud: 'M-16A1', class: '0x207', ammo: 48, pose: 5, emptied: 'class 0x203, pose 6 (club)' },
      { id: '0x0A', hud: 'SHOT GUN', class: '0x208', ammo: 6, pose: 7, emptied: 'class 0x201, thrown away' },
      { id: '0x0C', hud: 'BAZOOKA', class: '0x209', ammo: 4, pose: 8, emptied: 'stays 0x209, discarded and freed' },
      { id: '0x0E', hud: 'ROD', class: '0x203', ammo: 10, pose: 9, emptied: 'breaks into a STICK (subtype 0x10, class 0x202, pose 10)' },
      { id: '0x10', hud: 'STICK', class: '0x202', ammo: 6, pose: 10 },
      { id: '0x12', hud: 'B. KNIFE', class: '0x203', ammo: 6, pose: 11 },
      { id: '0x14', hud: 'CLUB', class: '0x203', ammo: 10, pose: 12 },
      { id: '0x16', hud: 'TORCH', class: '0x203', ammo: 10, pose: 12 },
      { id: '0x18', hud: 'DYNAMITE', class: '0x201', ammo: 10, pose: 13 },
      { id: '0x1A', hud: 'GRENADE', class: '0x201', ammo: 10, pose: 14 },
      { id: '0x1C', hud: 'STONE', class: '0x201', ammo: 10, pose: 14 },
    ],
    classes: { '0x201': 'throwable', '0x202': 'blade', '0x203': 'blunt (also emptied rifle/M16)', '0x204': 'pistol', '0x205': 'rifle', '0x206': 'SMG (Uzi)', '0x207': 'M16', '0x208': 'shotgun', '0x209': 'bazooka', '0x20A': 'carried container (pose 15)' } },
  weaponAnimSets: { factId: 'V22', sets: [
    { weapon: 'rifle', set: '0x265F4', rotations: '1822-1829 / 3160-3167', heldSeen: '1888-1895 (aimed anims 19-26)', ground: 1840 },
    { weapon: 'revolver', set: '0x268BC', rotations: '1633-1640 / 2992-2999', heldSeen: '1634-1637', ground: 1843 },
    { weapon: 'knife', set: '0x26A3C', rotations: '1681-1688 / 3040-3047', heldSeen: '1683-1687', ground: 1853 },
    { weapon: 'Uzi', set: '0x26BBC', rotations: '1649-1656 / 3008-3015', heldSeen: '1649', ground: 1849 },
    { weapon: 'M16', set: '0x26D3C', rotations: '1768-1775 / 3128-3135', heldSeen: '1768', ground: 1842 },
    { weapon: 'shotgun', set: '0x26F7E', rotations: '1665-1672 / 3024-3031', heldSeen: '1665', ground: 1851 },
    { weapon: 'bazooka', set: '0x270FE', rotations: '1752-1759 / 3112-3119', heldSeen: '1752', ground: 1850 },
  ] },
  holdTables: { factId: 'V23', routine: '0x24A9A', holdOffsetTable: '0x122230', poseTable: '0x120A20', perChar: holdTables(),
    mustaphaLive: [
      { weapon: 'rifle', hold: '0x34', dxdy: [-14, 60], rec: 1892, topLeft: [-54, -68], size: [74, 14] },
      { weapon: 'shotgun', hold: '0x3A', dxdy: [2, 55], rec: 1665, topLeft: [-43, -65] },
      { weapon: 'Uzi (stance 270+269)', hold: '0x38', dxdy: [-16, 53], rec: 1649, topLeft: [-43, -64] },
      { weapon: 'knife (idle)', hold: '0x40', dxdy: [3, 54], rec: 1685, topLeft: [-2, -77] },
    ],
    convention: 'dx right +, dy up + (world units = pixels) for native left-facing art; topLeft is screen space (y down) relative to the holder feet; mirror for facing right: x\' = -(x + w)',
    fullTable: 'work/re/static/weapon-holds.json (all hold indices, statically decoded)' },
  stanceByClass: { factId: 'V24', standTable: '0x5C36', walkTorsoTable: '0x5D2C', bobTableList: '0x5D1C', perChar: stanceByClass() },
  statBars: { factId: 'V32', table: '0xB444', selectOrder: ['Jack', 'Hannah', 'Mustapha', 'Mess'], powerSpeedSkill: { Jack: [4, 3, 3], Hannah: [2, 4, 5], Mustapha: [3, 5, 3], Mess: [5, 2, 4] } },
  walkSpeeds: { factId: 'V28', table: '0x50E4', speed8_8: { Jack: 414, Mustapha: 435, Hannah: 422, Mess: 409 } },
  damageTable: { status: 'rejected claim R4, corrected layout', pointerTable: '0xA26FC', perChar: { Jack: '0xA270C', Mustapha: '0xA28EC', Hannah: '0xA2ADC', Mess: '0xA2CBC' }, record: '8 bytes, 60 per hero, index = b[0x58]/2' },
  hudEnemyNames: { status: 'correction of rejected claim R9 (live verifier only; strings re-read from ROM here)', table: '0x17D78', heroTable: '0x17D70', index: 'enemy obj+0x03', names: hudEnemyNames() },
  spawnList: { factId: 'V10', table: '0x88DDA', entryBytes: 26, note: 'decoded with the verified format; handler = long at pool dispatch table + type', entries: spawnList() },
  dispatchTables: { A: '0x233F0', B: '0x2346C', C: '0x2362E', D: '0x237E6' },
};

const structs = {
  note: 'A5 = 0xFF8000, so (d16,A5) = 0xFF8000 + d16. Positions are 16.16 longs; most code reads the integer word at the same offset.',
  pools: {
    players: { base: '0xFFB274', slots: 3, stride: '0x180', slotsAt: ['0xFFB274', '0xFFB3F4', '0xFFB574'], factIds: ['V08', 'V25'] },
    A_items_weapons: { base: '0xFF8874', slots: 24, stride: '0xC0', init: '0x4C1A', alloc: '0x4818', free: '0x48D4', freeCount: '0xFFE5F4', freePtr: '0xFFE5FE', dispatch: '0x233F0', factIds: ['V08', 'V11'] },
    B_enemies: { base: '0xFFC8F4', slots: 24, stride: '0xE0', init: '0x4C48', alloc: '0x483C', free: '0x48FC', freeCount: '0xFFE5F8', freePtr: '0xFFE602', dispatch: '0x2346C', factIds: ['V08', 'V12'] },
    C_special: { base: '0xFFB6F4', slots: 24, stride: '0xC0', init: '0x4C76', alloc: '0x4860', free: '0x4938', freeCount: '0xFFE5F6', freePtr: '0xFFE600', dispatch: '0x2362E', factIds: ['V08'] },
    D_effects: { base: '0xFF9A74', slots: 48, stride: '0x80', init: '0x4CA4', alloc: '0x4884', free: '0x4964', freeCount: '0xFFE5FA', freePtr: '0xFFE604', dispatch: '0x237E6', factIds: ['V08'] },
    E: { base: '0xFFDDF4', slots: 16, stride: '0x80', init: '0x4CCC', alloc: '0x48A8', factIds: ['V08'], note: 'use unknown; allocator never ran live' },
  },
  object: [
    { off: '0x00', size: 'b', name: 'active: 0 free, 1 active and hittable, 2 active but not hittable', status: 'verified', factIds: ['V12', 'V31'] },
    { off: '0x01', size: 'b', name: 'drawn: set/cleared by the on-screen test 0x16FA; 0x49C0 registers when non-zero', status: 'verified', factIds: ['V03'] },
    { off: '0x02', size: 'b', name: 'player number 0/1/2 (players)', status: 'verified', factIds: ['V30'] },
    { off: '0x03', size: 'b', name: 'heroes: character id (0 Jack, 1 Mustapha, 2 Hannah, 3 Mess); enemies: variant = HUD name index', status: 'verified (heroes); enemies per R9 correction', factIds: ['V27', 'R9'] },
    { off: '0x04', size: 'b', name: 'state (routine index): enemies 0 init, 2 alive, 4 dying, 6 removed; heroes 0 init, 2 alive, 4 dead', status: 'verified', factIds: ['V12', 'R6'] },
    { off: '0x05..0x07', size: 'b', name: 'sub-states; heroes see R6 correction; weapons +0x05: 0 ground, 4 being picked up, 8 held', status: 'see R6; weapon +0x05 == 8 verified (V24)', factIds: ['R6', 'V24'] },
    { off: '0x08', size: 'l', name: 'X (16.16)', status: 'verified', factIds: ['V09', 'V26'] },
    { off: '0x0C', size: 'l', name: 'height above ground (16.16, up +)', status: 'verified', factIds: ['V09', 'V26'] },
    { off: '0x10', size: 'l', name: 'depth / lane (16.16, larger = farther); draw sort key', status: 'verified', factIds: ['V03', 'V26'] },
    { off: '0x14 / 0x16 / 0x18', size: 'w', name: 'velocities X / height / depth (8.8)', status: 'verified', factIds: ['V26'] },
    { off: '0x1A / 0x1C / 0x1E', size: 'w', name: 'accelerations X / height (gravity) / depth', status: 'verified (+0x1C); +0x1A/+0x1E static only', factIds: ['V26'] },
    { off: '0x20', size: 'w', name: 'type*4 = dispatch index (heroes: char*4)', status: 'verified', factIds: ['V08', 'V09'] },
    { off: '0x22', size: 'b', name: 'weapons: current anim index (set by 0x24A9A); heroes: stick direction in 32nds', status: 'weapons verified (V23); heroes unverified (U04)', factIds: ['V23', 'U04'] },
    { off: '0x23', size: 'b', name: 'palette override: bit7 set -> low 5 bits replace every block palette', status: 'verified', factIds: ['V04'] },
    { off: '0x24', size: 'b', name: 'facing: 0 as stored (faces left), non-zero mirrored (faces right)', status: 'verified', factIds: ['V06'] },
    { off: '0x25', size: 'b', name: 'draw flags: bit0 split body, bit7 screen space; bit5 skip splash, bit6 pointer-to-record path 0x147FE', status: 'bit0/bit7 verified; bit5/bit6 unverified (U01)', factIds: ['V04', 'U01'] },
    { off: '0x26', size: 'w', name: 'subtype (x2; weapons: weapon id; Chinpira reads the high byte 0/2/4)', status: 'verified', factIds: ['V09', 'V17', 'V19'] },
    { off: '0x28', size: 'l', name: 'animation frame pointer (ROM)', status: 'verified', factIds: ['V13', 'V15'] },
    { off: '0x2C..0x2E', size: 'b', name: 'frame bytes 4..6 (meaning untraced)', status: 'storage verified', factIds: ['V13', 'U10'] },
    { off: '0x2F', size: 'b', name: 'frames left on the current frame', status: 'verified', factIds: ['V15'] },
    { off: '0x30', size: 'l', name: 'legs frame pointer (split body)', status: 'verified', factIds: ['V04', 'V09'] },
    { off: '0x34', size: 'w', name: 'legs frame word 2 (low byte = bob index)', status: 'verified', factIds: ['V13'] },
    { off: '0x38', size: 'l', name: 'torso bob table pointer (0x5D1C list)', status: 'verified', factIds: ['V13', 'V24'] },
    { off: '0x3C / 0x3E', size: 'w', name: 'torso offset dx / dy (split body; also added to held-weapon placement)', status: 'verified', factIds: ['V04', 'V23'] },
    { off: '0x40', size: 'l', name: 'animation set pointer', status: 'verified', factIds: ['V13'] },
    { off: '0x44', size: 'l', name: 'per-type constant (enemies 0x103000, weapons 0x100C00)', status: 'unverified (U10)' },
    { off: '0x48', size: 'w', name: 'frame word 8 (meaning untraced)', status: 'storage verified', factIds: ['V13'] },
    { off: '0x4C..0x4F', size: 'b', name: 'per-record wading-clip bytes from 0x11D220 + rec*4', status: 'see R5 correction', factIds: ['R5'] },
    { off: '0x53', size: 'b', name: 'wading flag (clip active while set)', status: 'see R5 correction', factIds: ['R5'] },
    { off: '0x58', size: 'b', name: 'attack id (always even; damage record = b/2)', status: 'see R4 correction', factIds: ['R4'] },
    { off: '0x60', size: 'w', name: 'heroes: frame word 10; high byte = weapon hold index', status: 'verified', factIds: ['V13', 'V23'] },
    { off: '0x6A / 0x6C', size: 'w', name: 'max HP / HP (weapons: +0x6C = ammo or uses)', status: 'verified', factIds: ['V12', 'V20', 'R7'] },
    { off: '0x6E', size: 'w', name: 'HP before the last hit', status: 'R7 correction (live only)', factIds: ['R7'] },
    { off: '0x70', size: 'w', name: 'weapons: holder object (0xB274 = P1); heroes: partner (inferred)', status: 'weapons verified; heroes unverified (U06)', factIds: ['V20', 'U06'] },
    { off: '0x78', size: 'b', name: 'stun meter (damage byte 1 subtracted)', status: 'R4 correction', factIds: ['R4'] },
    { off: '0x84', size: 'w', name: 'enemies: reaction-set index x4 into 0x2E68C / 0x2E724', status: 'verified', factIds: ['V17', 'V18'] },
    { off: '0xA0', size: 'w', name: 'weapons: class (0x201..0x20A)', status: 'verified', factIds: ['V20', 'R2'] },
    { off: '0xA2', size: 'w', name: 'weapons: pose slot x4', status: 'verified', factIds: ['V21', 'V23'] },
    { off: '0xA3', size: 'b', name: 'heroes: lives', status: 'verified', factIds: ['V29'] },
    { off: '0xB4 / 0xB6', size: 'w', name: 'heroes: held weapon object (pool-A low word, 0 = none) / its class', status: 'verified', factIds: ['V20', 'V24'] },
    { off: '0xEC', size: 'w', name: 'heroes: invulnerability timer', status: 'verified', factIds: ['V31'] },
    { off: '0xF9', size: 'b', name: 'heroes: second invulnerability timer', status: 'verified', factIds: ['V31'] },
    { off: '0x100', size: 'l', name: 'heroes: score (BCD)', status: 'verified', factIds: ['V30'] },
  ],
  stageController: { base: '0xFF873C', fields: [
    { off: '0x05', name: 'state of the last triggered segment (segment byte +0x0B)', status: 'verified', factIds: ['V35'] },
    { off: '0x06', name: 'sub-state', status: 'unverified (U09)' },
    { off: '0x08 / 0x0C', name: 'camera X / Y (0xFF8744 / 0xFF8748)', status: 'verified', factIds: ['V05', 'V35'] },
    { off: '0x4A', name: 'area (0xFF8786)', status: 'verified', factIds: ['V35'] },
    { off: '0x56', name: 'next script segment pointer (0xFF8792)', status: 'verified', factIds: ['V35'] },
    { off: '0x6C', name: 'next segment index (0xFF87A8)', status: 'verified', factIds: ['V35'] },
    { off: '0x6D', name: 'exit reached (0xFF87A9)', status: 'verified', factIds: ['V35'] },
  ], scriptTable: '0x21B2A' },
};

const globals = [
  { addr: '0xFF8000', size: 'w', name: 'main-loop counter', status: 'verified', factIds: ['V33'] },
  { addr: '0xFF84DA', size: 'b', name: 'main-loop counter (byte)', status: 'verified', factIds: ['V33'] },
  { addr: '0xFF84D0', size: 'b', name: 'main state (0 title, 4 select, 8 story/title card, 0xC gameplay, 0x1C ending)', status: 'verified', factIds: ['V33'] },
  { addr: '0xFF84D1 / 0xFF84D2', size: 'b / w', name: 'main sub-states (cleared by stage clear)', status: 'verified', factIds: ['V34', 'V38'] },
  { addr: '0xFF84D9', size: 'b', name: 'stage 0..7 = EPISODE 1..8', status: 'verified', factIds: ['V34'] },
  { addr: '0xFF8786', size: 'b', name: 'area (controller +0x4A)', status: 'verified', factIds: ['V35'] },
  { addr: '0xFF873C', size: 'struct', name: 'stage controller', status: 'verified', factIds: ['V35'] },
  { addr: '0xFF8744 / 0xFF8748', size: 'w', name: 'camera X / Y', status: 'verified', factIds: ['V05'] },
  { addr: '0xFF84DC', size: 'b', name: 'non-zero forces camera Y 0 in the sprite builder', status: 'verified', factIds: ['V02'] },
  { addr: '0xFFE9B4', size: 'w', name: 'OBJ buffer toggle', status: 'verified', factIds: ['V02'] },
  { addr: '0xFFE9B6 / 0xFFE9B8', size: 'w', name: 'camX - 0x40 / camY copies for the draw code', status: 'verified', factIds: ['V02'] },
  { addr: '0xFFE7C0 / 0xFFE7C2', size: 'w', name: 'draw registration count / write pointer (list grows down from 0xFFE9B0)', status: 'verified', factIds: ['V03'] },
  { addr: '0xFF0ECC / 0xFF0ECD..0xFF0ECF', size: 'b', name: 'HUD score redraw flags (any / per player)', status: 'verified', factIds: ['V30'] },
  { addr: '0xFF84E8', size: 'w', name: 'stage timer BCD M:SS (51 frames per second)', status: 'R8 correction', factIds: ['R8'] },
  { addr: '0xFF84EA', size: 'b', name: 'stage-timer tick (0x32..0)', status: 'R8 correction', factIds: ['R8'] },
  { addr: '0xFF847D', size: 'b', name: 'coin-slot-1 credits', status: 'R8 correction', factIds: ['R8'] },
  { addr: '0xFFF77C', size: 'b', name: 'configuration byte; & 3 = starting lives', status: 'verified', factIds: ['V29'] },
  { addr: '0xFFEBDE / 0xFFEBD8 / 0xFFEB98', size: 'struct', name: 'HUD hit queue (16 x 16 bytes) / its write index / HUD enemy slot', status: 'R9 correction (live only)', factIds: ['R9'] },
  { addr: '0xFF801B', size: 'b', name: 'P1 input bits', status: 'unverified (U04)' },
  { addr: '0xFF844A', size: 'b', name: 'fade counter', status: 'unverified (U07)' },
  { addr: '0xFF84E6', size: 'b', name: 'starting-lives copy', status: 'unverified (U07)' },
];

const cheats = { file: 'tools/re/runtime/cheats.cjs (plan.cheats in tools/re/runtime/rt.cjs plans)', factIds: ['V36', 'V37', 'V38', 'V39'],
  list: ['invuln', 'infhp', 'lives', 'score', 'give', 'warp', 'warpLive', 'warpArea', 'killAll', 'freeze'],
  notVerifiedByAVerifier: ['infhp', 'lives (poke only; lives field V29 is verified)', 'score (poke only; score field V30 is verified)'] };

// ---------------------------------------------------------------------------------------------------------------
// ROM self-checks: re-read the quoted constants from the program image.
const checks = [];
function check(name, ok, got) { checks.push({ name, ok: !!ok, got }); }
check('ROM header 0xFFFF0', [0, 2, 4, 6, 8, 10, 12, 14].map((o) => u16(0xFFFF0 + o).toString(16).padStart(4, '0')).join(' ') === 'ffdf fff0 000d 0cf4 0db9 000d 43d8 09d4',
  [0, 2, 4, 6, 8, 10, 12, 14].map((o) => u16(0xFFFF0 + o).toString(16).padStart(4, '0')).join(' '));
check('hold-offset pointers 0x122230', [0, 4, 8, 12].map((o) => u32(0x122230 + o)).join() === [0x122240, 0x1223A8, 0x1224E8, 0x12263C].join(), [0, 4, 8, 12].map((o) => hex(u32(0x122230 + o))).join(' '));
check('pose-row pointers 0x120A20', [0, 4, 8, 12].map((o) => u32(0x120A20 + o)).join() === [0x120A30, 0x121070, 0x1215B0, 0x121BF0].join(), [0, 4, 8, 12].map((o) => hex(u32(0x120A20 + o))).join(' '));
for (const h of tables.holdTables.mustaphaLive) {
  const a = 0x1223A8 + parseInt(h.hold, 16) * 4;
  check('Mustapha hold ' + h.hold + ' (dx,dy)', s16(a) === h.dxdy[0] && s16(a + 2) === h.dxdy[1], [s16(a), s16(a + 2)]);
}
check('stat bars 0xB444', [...p.slice(0xB444, 0xB450)].join() === '4,3,3,2,4,5,3,5,3,5,2,4', [...p.slice(0xB444, 0xB450)].join());
check('walk speeds 0x50E4', [0, 1, 2, 3].map((c) => s16(0x50E4 + c * 0x20 + 8)).join() === '414,435,422,409', [0, 1, 2, 3].map((c) => s16(0x50E4 + c * 0x20 + 8)).join());
check('hero list 0x163E / 0x168E', u32(0x1642) === 0x9F414 && u32(0x1692) === 0x9FB94 && u32(0x163E) === 0x9E41C && u32(0x168E) === 0x9EACC, [hex(u32(0x163E)), hex(u32(0x1642)), hex(u32(0x168E)), hex(u32(0x1692))]);
check('Mustapha stance words 0x5C5E', [...Array(12)].map((_, i) => u16(0x5C5E + i * 2).toString(16)).join(' ') === '8000 8000 8000 5 0 1 4 3 2 2 6 8000', [...Array(12)].map((_, i) => u16(0x5C5E + i * 2).toString(16)).join(' '));
check('bob tables 0x5D1C', [0, 4, 8, 12].map((o) => u32(0x5D1C + o)).join() === [0x5D9C, 0x5DCC, 0x5DFC, 0x5E2C].join(), [0, 4, 8, 12].map((o) => hex(u32(0x5D1C + o))).join(' '));
check('damage pointers 0xA26FC, 0x1E0 apart', [0, 4, 8, 12].map((o) => u32(0xA26FC + o)).join() === [0xA270C, 0xA28EC, 0xA2ADC, 0xA2CBC].join() && u32(0xA2700) - u32(0xA26FC) === 0x1E0, [0, 4, 8, 12].map((o) => hex(u32(0xA26FC + o))).join(' '));
check('record words x4 (0x9F4C4/0x9FEEC/0x9FBE2)', u16(0x9F4C4) === 176 * 4 && u16(0x9FEEC) === 228 * 4 && u16(0x9FBE2) === 259 * 4, [hex(u16(0x9F4C4)), hex(u16(0x9FEEC)), hex(u16(0x9FBE2))]);
const names = tables.hudEnemyNames.names;
check('HUD enemy names 0x17D78', names[0].name === 'FERRIS' && names[1].name === 'GNEISS' && names[0x1A].name === 'DRIVER' && names[0x22].name === 'FESSENDEN', [names[0].name, names[1].name, names[0x1A].name, names[0x22].name]);
check('HUD hero names 0x17D70 (id order)', [0, 1, 2, 3].map((i) => romString(0x17D70 + u16(0x17D70 + i * 2))).join() === 'JACK.T,MUSTAPHA,HANNAH,MESS', [0, 1, 2, 3].map((i) => romString(0x17D70 + u16(0x17D70 + i * 2))));
const wn = tables.weapons.ids.map((w, i) => romString(0x23CDE + u16(0x23CDE + i * 2)));
check('weapon names 0x23CDE', wn.join('|') === tables.weapons.ids.map((w) => w.hud).join('|'), wn);
const sl = tables.spawnList.entries;
const want = { 1: ['Chinpira_A', '0x8', '0x3383A'], 4: ['Hutori_A', '0x28', '0x3B828'], 11: ['Knife Man A', '0x38', '0x4020E'], 21: ['Pteranodon', '0x148', '0x606D4'], 50: ['FESS MESS', '0xC8', '0x844B4'], 54: ['ITEM RIFLE', '0x0', '0x24D44'] };
check('spawn list entries', Object.entries(want).every(([i, [n, t, h]]) => sl[i].name === n && sl[i].type === t && sl[i].handler === h), Object.keys(want).map((i) => [sl[i].name, sl[i].type, sl[i].handler]));
check('reaction tables are 38 longs apart', 0x2E724 - 0x2E68C === 38 * 4, hex(0x2E724 - 0x2E68C));

// ---------------------------------------------------------------------------------------------------------------
const doc = {
  meta: {
    title: 'Original Cadillacs & Dinosaurs (Capcom 1993, CPS-1, MAME set "dino") - verified memory map',
    generatedBy: 'tools/re/build-memory-map.cjs', generated: new Date().toISOString(), humanReadable: 'tools/re/MEMORY-MAP.md',
    rule: 'VERIFIED = confirmed by at least one verifier (static REA/Rizin re-check, or live MAME debugger re-check) and refuted by none. Refuted claims appear only in "rejected", with the correction. Everything else is unverified: harness self-validated facts (harnessSelfValidated) and single-source observations or inferences (unverified).',
    statusesUsedInTables: { verified: 'backed by a V-fact', 'R# correction': 'value from the refuting verifier; single source unless noted', unverified: 'see the U-list' },
    program: 'work/re/dino-prg.bin (byte-swapped program; file offset = 68000 address; reset PC 0x41A, SSP 0xFF0E66); tools/re/rom.cjs',
    mame: 'MAME 0.289, private romset E:/tools/mame/roms/dino (blank stand-ins for 6 PLDs and dl-1425.bin); always -sound none',
    evidenceDirs: { static: 'work/re/static/evidence', staticVerifier: 'work/re/verify-static/evidence', liveVerifier: 'work/re/verify-live/evidence', runtime: 'work/re/runtime/evidence', harness: 'work/re/harness/rea-*.json', runs: 'work/re/runs/<run>' },
    verifiers: {
      static: { tools: ['tools/re/vs-rea.sh', 'tools/re/vs-anim.cjs', 'tools/re/vs-holds.cjs', 'tools/re/vs-records.cjs', 'tools/re/vs-58.cjs'], result: '43 confirmed, 3 refuted, 2 unverifiable of 48 claims', file: 'work/re/verify-static/verdicts.json' },
      live: { tools: 'tools/re/verify-live/*.cjs (MAME -debug -debugger none + Lua breakpoints and taps)', result: '42 confirmed, 7 refuted of 49 claims', file: 'work/re/verify-live/verdicts.json' },
    },
    counts: { verified: verified.length, harnessSelfValidated: harness.length, unverified: unverified.length, rejected: rejected.length },
    conventions: {
      a5: 'A5 = 0xFF8000 in all game code; (d16,A5) = 0xFF8000 + d16',
      characterIdOrder: ['Jack', 'Mustapha', 'Hannah', 'Mess'],
      selectOrder: ['Jack', 'Hannah', 'Mustapha', 'Mess'],
      objPaletteOrder: ['Jack', 'Hannah', 'Mustapha', 'Mess'],
      artFacing: 'ROM sprite art faces left; facing byte +0x24 != 0 mirrors it',
      recordsInAnimData: 'stored as rec*4',
      worldAxes: 'X right +, height up +, depth larger = farther (higher on screen); screen feetY = camY - (depth + height) + 240',
      timing: 'RAM at frame f-1 -> OBJ list dumped at f -> screenshot f+1 (harness frame numbering)',
    },
  },
  verified, structs, globals, tables, cheats,
  saveStates: { dir: 'E:/tools/mame/states/dino', lists: ['work/re/harness/states.json', 'work/re/runtime/states.json'], factIds: ['V40', 'H09'] },
  harnessSelfValidated: harness, unverified, rejected, staleFiles, openQuestions, romChecks: checks,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
const bad = checks.filter((c) => !c.ok);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${verified.length} verified, ${harness.length} harness, ${unverified.length} unverified, ${rejected.length} rejected; ROM checks ${checks.length - bad.length}/${checks.length} ok`);
for (const b of bad) console.log('ROM CHECK FAILED:', b.name, JSON.stringify(b.got));
process.exit(bad.length ? 1 : 0);
