// Heroes family of the ROM sprite data (PLAN §4.1 "heroes", §5.2 `sprites heroes`; HEROES §3–§5, §10; KI6, KI8,
// KI11, KI12). Writes:
//   sprite-data-heroes.js                SPRITE_DATA.add('heroes', …): four slot-indexed sheets (jack, mustapha, hannah,
//                                        mess; R = OBJ slot, G = pen), tight record boxes, palette rows and maps, the
//                                        role -> clip tables, hold tables, bob tables, weapon / fx timing data (incl.
//                                        the thrown-gun "hurl" the user chose for empty guns), and the frozen
//                                        ARCADE_HEROES compatibility lists (until G3 removes the last reader)
//   tests/fixtures/rom-heroes-golden.json   ~400 part lists predicted by tools/re/export/lib/model.cjs predict() from
//                                        the MAME validation runs (only when the runs exist and `out` is the repo root,
//                                        or with golden:true / `node tools/re/build/sprites-heroes.cjs golden`)
//   work/re/build/sheets/heroes-*.png    the packed sheets coloured with the home map (review)
//   work/re/pack/heroes-<id>.png         contact sheets drawn through HeroRig.parts(): every role, every weapon class
//                                        on its class roles, both facings (review)
//
// Records are re-rendered from the ROM (model.cjs recBlocks + rom.cjs tiles, exactly the validated renderer) into
// (slot, pen) indices, trimmed to their opaque box and checked pixel for pixel against the extract atlases
// (atlas-<hero>.png coloured with ROM set 0). The sheets are palette PNGs (colour type 3) whose PLTE entry i is
// (R = slot, G = pen, B = 0), so a browser decodes them to exactly the PLAN §4.1 indexed encoding; their IDAT is one
// zlib stream whose deflate body ends on a sync flush and whose rows use only the None/Sub filters, so sprites.js can
// splice several sheets into one PNG and swap the PLTE without inflating anything (the synchronous ARCADE_HEROES
// compatibility sheets today's game.js reads at parse time).
//
// API (PLAN §5.3):  build({rom, extract, config, out, rgba, lib, log, golden}) -> {files, report}
// CLI:              node tools/re/build/sprites-heroes.cjs [golden] [--out <dir>] [--rgba]
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), vm = require('vm'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const HEROES = ['jack', 'mustapha', 'hannah', 'mess'];                  // ROM character order (heroes.json, 0x50E4 …)
const GAME_INDEX = { mustapha: 0, jack: 1, hannah: 2, mess: 3 };       // game.js HEROES order
const CLASSES = { throwable: '0x201', blade: '0x202', blunt: '0x203', pistol: '0x204', rifle: '0x205', smg: '0x206', m16: '0x207', shotgun: '0x208', bazooka: '0x209', container: '0x20A' };
const FIREARMS = ['gun', 'rifle', 'uzi', 'm16', 'shotgun', 'bazooka'];
const WEAPON_TYPES = ['gun', 'rifle', 'uzi', 'm16', 'shotgun', 'bazooka', 'knife', 'stick', 'rod', 'bknife', 'club', 'torch', 'dynamite', 'grenade', 'stone'];
const OBSERVED = new Set(['observed', 'observed (as tail)', 'observed + table', 'table']);

// Fixed-index roles (HEROES §4.3, §10.1). Indices were confirmed live or cross-checked per hero; extra roles beyond
// the §10.1 table are the anims §4.3 neither ships nor excludes (main 7/12/20, punch 1/7, set5 0/3) plus the KI12
// driving pose. Everything §4.3 lists as "not shipped" stays out.
const FIXED_ROLES = {
  idle: 'main:0', walk: 'main:1', runStart: 'main:2', jumpUp: 'main:3', jumpFwd: 'main:4', jumpBack: 'main:5', land: 'main:6',
  jumpFwdLate: 'main:7', jumpRun: 'main:8', run: 'main:9', pickup: 'main:10', legsRun: 'main:11', jumpBackLate: 'main:12',
  dashEnd: 'main:13', victory: 'main:14', legsWalk: 'main:16', leap: 'main:20', lift: 'main:22', drive: 'main:29', landHard: 'main:30',
  p1: 'punch:0', p2: 'punch:0', jab: 'punch:1', p1Hit: 'punch:2', kick: 'punch:3', fin: 'punch:4', kickHit: 'punch:5', finHit: 'punch:6',
  finAlt: 'punch:7', mega: 'punch:8', airLate: 'punch:10', airKick: 'punch:11', dash: 'punch:12', airRun: 'punch:13',
  hurt: 'set3:0', knock: 'set3:2', getup: 'set3:3', dizzy: 'set3:4', hurtBack: 'set3:6', knockFace: 'set3:7', knockHard: 'set3:8', lieBack: 'set3:11',
  grab: 'set4:0', knee1: 'set4:1', knee2: 'set4:2', throwFwd: 'set4:3', throwBack: 'set4:4',
  heldPose: 'set5:0', heldStruggle: 'set5:1', heldThrown: 'set5:2', heldRelease: 'set5:3',
};
const CONTACT = { p1: 'p1Hit', p2: 'p1Hit', kick: 'kickHit', fin: 'finHit' };   // D10 start -> contact clip
const LEGS_CLIPS = { 'main:16': 'walk', 'main:11': 'run' };                       // legs clip -> bob table (model.cjs)
// The §10.1 / §10.2 roles the acceptance requires for all four heroes (tests/rom-heroes.cjs checks the same list).
const SPEC_ROLES = ['idle', 'walk', 'runStart', 'run', 'legsWalk', 'legsRun', 'jumpUp', 'jumpFwd', 'jumpBack', 'jumpRun', 'land', 'landHard', 'pickup', 'lift', 'victory',
  'p1', 'p2', 'p1Hit', 'kick', 'kickHit', 'fin', 'finHit', 'dash', 'dashEnd', 'airKick', 'airRun', 'airLate', 'mega', 'grab', 'knee1', 'knee2', 'throwFwd', 'throwBack',
  'hurt', 'hurtBack', 'knock', 'knockFace', 'knockHard', 'lieBack', 'getup', 'dizzy', 'heldStruggle', 'heldThrown', 'drive'];

// Frozen ARCADE_HEROES compatibility lists (PLAN §4.6; CODE-MAP §4.2, §12.A): today's arcade-heroes.js frame order,
// list names, records, hand/grip points and gunDrawn flag, so game.js keeps drawing (and every suite keeps its record
// pins) when sprites.js replaces that file's global. Frame = [rec, hand|0, grip|0, flags (1 = gunDrawn)]; only the
// sheet coordinates are recomputed from the ROM sheets. Removed with the view in G3.
const COMPAT_FRAMES = [[171,[-24,-62],[-23,-61],0],[176,[-3,-40],[-7,-75],0],[177,[-12,-39],[-11,-36],0],[178,[-19,-39],[-19,-38],0],[179,[-29,-43],[-29,-43],0],[180,[-19,-39],[-19,-38],0],[181,[-12,-39],[-11,-36],0],[182,[-2,-39],[-6,-74],0],[183,[-12,-40],[-12,-39],0],[184,[-21,-42],[-21,-40],0],[185,[-29,-42],[-29,-41],0],[186,[-21,-42],[-21,-40],0],[187,[-12,-40],[-12,-39],0],[200,[-39,-35],[-38,-34],0],[201,[-40,-55],[-40,-52],0],[202,[-39,-53],[-38,-52],0],[203,[-38,-54],[-38,-54],0],[204,[-40,-60],[-40,-59],0],[205,[-38,-53],[-38,-53],0],[206,[-39,-53],[-38,-52],0],[207,[-40,-56],[-40,-53],0],[208,[-39,-55],[-38,-54],0],[217,[-17,-41],[-16,-39],0],[218,[-15,-78],[-14,-76],0],[219,[-24,-60],[-23,-55],0],[287,[-14,-29],[-24,-39],0],[228,[-33,-70],[-32,-60],0],[229,[-72,-69],[-72,-69],0],[231,[-21,-59],[-20,-59],0],[232,[-71,-53],[-68,-53],0],[233,[-46,-61],[-45,-60],0],[235,[-20,-48],[-20,-48],0],[236,[-88,-60],[-87,-59],0],[237,[-63,-59],[-82,-70],0],[238,[-37,-63],[-55,-76],0],[241,[-55,-48],[-51,-44],0],[316,[26,-63],[-4,-69],0],[317,[2,-63],[-2,-68],0],[252,[-40,-66],[-40,-63],0],[253,[-19,-64],[-22,-68],0],[254,[-40,-55],[-39,-50],0],[255,[-50,-50],[-50,-48],0],[280,[-22,-70],[-22,-68],0],[283,[-15,-78],[-14,-76],0],[296,[-23,-58],[-21,-58],0],[297,[-24,-45],[-24,-42],0],[302,[-50,-54],[-49,-54],0],[301,0,0,0],[309,[-2,-44],[0,-45],0],[308,[-2,-60],[0,-61],0],[313,[-2,-66],[-6,-68],0],[314,[-23,-64],[-23,-62],0],[315,[-36,-62],[-35,-59],0],[294,[-19,-61],[-18,-48],0],[259,[-40,-66],[-39,-63],0],[260,[-32,-66],[-31,-63],0],[256,[-17,-65],[-16,-64],0],[257,[-24,-63],[-23,-63],0],[284,[-32,-59],[-31,-56],0],[288,[-40,-56],[-40,-55],0],[188,0,0,0],[189,0,0,0],[190,0,0,0],[191,0,0,0],[192,0,0,0],[193,0,0,0],[194,0,0,0],[195,0,0,0],[196,0,0,0],[197,0,0,0],[198,0,0,0],[199,0,0,0],[209,0,[23,-41],0],[210,[2,-34],[2,-35],0],[211,[-14,-29],[-14,-29],0],[212,[20,-36],[-16,-28],0],[213,0,[23,-41],0],[214,[1,-32],[1,-32],0],[215,[-13,-30],[-11,-32],0],[216,[-17,-30],[-17,-28],0],[269,0,0,0],[0,[-21,-59],[-20,-57],0],[4,[-11,-41],[-11,-41],0],[5,[-16,-42],[-16,-41],0],[6,[-23,-42],[-22,-41],0],[7,[-31,-46],[-30,-46],0],[8,[-23,-42],[-22,-41],0],[9,[-17,-41],[-17,-40],0],[10,[-11,-41],[-11,-41],0],[11,[-23,-43],[-22,-42],0],[12,[-24,-46],[-24,-44],0],[13,[-29,-48],[-29,-47],0],[14,[-24,-46],[-24,-44],0],[15,[-23,-43],[-22,-42],0],[16,[-64,-32],[-64,-28],0],[17,[-45,-58],[-46,-59],0],[18,[-35,-46],[-34,-43],0],[19,[-22,-36],[-25,-68],0],[20,[-39,-55],[-39,-50],0],[21,[-40,-58],[-40,-57],0],[22,[-39,-55],[-39,-50],0],[23,[-22,-36],[-25,-68],0],[24,[-35,-46],[-34,-43],0],[25,[-24,-41],[-24,-38],0],[26,[-15,-77],[-14,-74],0],[27,[-32,-61],[-32,-58],0],[113,[-20,-29],[-20,-28],0],[35,[-36,-64],[-37,-65],0],[36,[-67,-65],[-67,-66],0],[37,[-35,-53],[-34,-52],0],[38,[-51,-52],[-50,-52],0],[39,[-35,-65],[-39,-69],0],[40,[-39,-65],[-43,-69],0],[47,[-31,-60],[-30,-58],0],[114,[-32,-44],[-32,-43],0],[115,[-20,-54],[-20,-52],0],[116,[-32,-60],[-32,-58],0],[97,[-9,-44],[-5,-42],0],[98,[-30,-65],[-30,-63],0],[99,[-64,-31],[-64,-29],0],[111,[-12,-73],[-11,-69],0],[112,[-12,-81],[-10,-70],0],[121,[-29,-59],[-28,-57],0],[122,[-23,-48],[-23,-47],0],[124,[-3,-37],[-2,-36],0],[126,0,0,0],[135,[-5,-39],[-5,-49],0],[136,0,[-15,-34],0],[141,[-14,-33],[-22,-61],0],[142,[-14,-32],[-23,-57],0],[143,[-14,-32],[-24,-53],0],[120,[-22,-89],[-20,-76],0],[51,[-28,-64],[-28,-63],0],[50,[-37,-65],[-37,-63],0],[95,[-39,-55],[-38,-53],0],[94,[-11,-60],[-16,-69],0],[151,0,[-5,-47],0],[152,0,[-5,-47],0],[153,0,[-5,-46],0],[154,0,[-5,-45],0],[155,0,[-5,-46],0],[156,0,[-5,-47],0],[157,0,[-5,-47],0],[158,0,[-5,-47],0],[159,0,[-5,-46],0],[160,0,[-2,-45],0],[161,0,[-4,-46],0],[162,0,[-5,-47],0],[163,0,[-5,-46],0],[164,0,[-5,-44],0],[165,0,[-5,-41],0],[166,0,[-5,-43],0],[167,0,[-5,-46],0],[168,0,[-5,-43],0],[169,0,[-5,-41],0],[170,0,[-5,-44],0],[74,0,[-2,-47],0],[605,[-28,-43],[-28,-41],0],[608,[-23,-42],[-23,-40],0],[609,[-19,-38],[-18,-37],0],[610,[-17,-38],[-16,-37],0],[611,[-11,-39],[-10,-37],0],[612,[-14,-42],[-14,-40],0],[613,[-21,-44],[-21,-42],0],[614,[-24,-44],[-24,-42],0],[615,[-21,-44],[-21,-42],0],[616,[-14,-42],[-14,-40],0],[617,[-11,-39],[-10,-37],0],[618,[-17,-38],[-16,-37],0],[619,[-19,-38],[-18,-37],0],[620,[-55,-41],[-55,-39],0],[621,[-42,-60],[-46,-64],0],[622,[-24,-44],[-24,-41],0],[623,[-20,-38],[-19,-37],0],[624,[-33,-47],[-32,-42],0],[625,[-46,-58],[-45,-58],0],[626,[-33,-47],[-32,-42],0],[627,[-20,-38],[-19,-37],0],[628,[-24,-44],[-24,-41],0],[638,[9,-29],[-17,-37],0],[636,[-34,-73],[-33,-73],0],[637,[-31,-78],[-30,-75],0],[633,[-21,-30],[-20,-28],0],[675,[-31,-44],[-30,-43],0],[676,[-39,-46],[-39,-44],0],[677,[-71,-58],[-70,-56],0],[678,[-31,-52],[-31,-50],0],[679,[-36,-72],[-36,-75],0],[680,[-77,-56],[-76,-55],0],[681,[-31,-42],[-30,-28],0],[697,[-45,-52],[-44,-50],0],[682,[-31,-64],[-31,-57],0],[672,[-37,-71],[-37,-72],0],[666,[-32,-81],[-24,-75],0],[668,[-63,-30],[-62,-29],0],[669,[-39,-37],[-38,-33],0],[630,[-16,-80],[-15,-75],0],[632,[-32,-64],[-31,-59],0],[756,[12,-40],[-2,-67],0],[775,[18,-40],[-5,-75],0],[766,[-18,-51],[-19,-57],0],[768,0,0,0],[762,[-26,-30],[-26,-29],0],[761,[-19,-52],[-18,-51],0],[772,[-24,-41],[-24,-39],0],[773,[-24,-39],[-24,-37],0],[774,[-24,-38],[-24,-36],0],[631,[-29,-71],[-28,-69],0],[719,[-56,-60],[-56,-58],0],[720,[-40,-60],[-40,-58],0],[716,[-34,-53],[-33,-51],0],[717,[-55,-60],[-55,-63],0],[712,[-30,-55],[-30,-53],0],[714,[-30,-55],[-30,-53],0],[700,0,0,0],[701,0,0,0],[702,0,0,0],[703,0,0,0],[704,0,0,0],[705,0,0,0],[706,0,0,0],[707,0,0,0],[708,0,0,0],[709,0,0,0],[710,0,0,0],[711,0,0,0],[744,[28,-30],[29,-28],0],[745,[15,-29],[17,-28],0],[746,[-3,-29],0,0],[747,[-14,-29],[-15,-28],0],[748,0,0,0],[749,[19,-29],[21,-28],0],[750,[4,-30],[5,-28],0],[751,[-7,-30],[-8,-28],0],[1425,[-21,-61],[-21,-62],0],[1434,[-9,-62],[-9,-61],0],[1435,[-10,-41],[-10,-38],0],[1436,[-14,-43],[-14,-40],0],[1437,[-22,-41],[-21,-41],0],[1438,[-15,-43],[-15,-40],0],[1439,[-10,-41],[-10,-38],0],[1440,[-9,-62],[-9,-61],0],[1441,[-10,-41],[-10,-38],0],[1442,[-15,-44],[-15,-41],0],[1443,[-19,-44],[-19,-41],0],[1444,[-15,-43],[-15,-40],0],[1445,[-9,-41],[-9,-38],0],[1458,[-45,-32],[-44,-32],0],[1459,[-40,-54],[-40,-53],0],[1460,[-32,-44],[-31,-44],0],[1461,[-17,-53],[-16,-54],0],[1462,[-32,-44],[-32,-44],0],[1463,[-40,-61],[-39,-61],0],[1464,[-32,-44],[-32,-44],0],[1465,[-17,-53],[-16,-54],0],[1466,[-32,-44],[-31,-44],0],[1481,[-35,-29],[-35,-28],0],[1475,[-9,-61],[-9,-61],0],[1476,[-19,-65],[-19,-65],0],[1534,[-27,-29],[-32,-28],0],[1511,[-32,-62],[-32,-62],0],[1512,[-62,-63],[-67,-65],0],[1513,[-4,-44],[-3,-59],0],[1514,[-53,-46],[-55,-48],0],[1538,[-36,-58],[-36,-56],0],[1539,[-11,-47],[-78,-56],0],[1540,[-92,-59],[-96,-61],0],[1517,[-93,-50],[-95,-53],0],[1528,[-36,-60],[-52,-67],0],[1530,[-25,-43],[-23,-43],0],[1535,[-29,-40],[-28,-41],0],[1533,[-33,-52],[-33,-52],0],[1536,[-7,-81],[-4,-60],0],[1484,[-19,-59],[-19,-59],0],[1485,[-46,-45],[-46,-45],0],[1489,[-45,-39],[-43,-39],0],[1490,0,0,0],[1496,[-9,-42],[-9,-41],0],[1495,[-9,-58],[-9,-57],0],[1501,[-25,-44],[-27,-53],0],[1502,[-26,-42],[-29,-52],0],[1503,[-26,-44],[-31,-47],0],[1431,[-19,-82],[-15,-76],0],[1558,[-31,-48],[-31,-48],0],[1559,[-29,-48],[-29,-48],0],[1561,[-27,-63],[-27,-63],0],[1556,[-44,-55],[-44,-55],0],[1552,[-28,-54],[-28,-54],0],[1554,[-34,-54],[-34,-54],0],[1446,0,0,0],[1447,0,0,0],[1448,0,0,0],[1449,0,0,0],[1450,0,0,0],[1451,0,0,0],[1452,0,0,0],[1453,0,0,0],[1454,0,0,0],[1455,0,0,0],[1456,0,0,0],[1457,0,0,0],[1467,[20,-34],[20,-34],0],[1468,[9,-30],[9,-30],0],[1469,0,0,0],[1470,[-4,-31],[-5,-28],0],[1471,[21,-29],[21,-29],0],[1472,[2,-30],[3,-29],0],[1473,0,0,0],[1474,[-4,-31],[-4,-29],0],[1548,0,0,0],[93,[-22,-61],[-24,-61],0],[86,[-42,-63],[-44,-63],1],[95,[-36,-53],[-38,-53],0],[96,[-33,-53],[-35,-53],0],[91,[-20,-44],[-22,-44],0],[88,[-33,-63],[-35,-63],0],[89,[-29,-44],[-31,-44],0],[92,[-37,-59],[-39,-59],0],[84,0,0,0],[261,[-22,-56],[-24,-56],0],[262,[-35,-62],[-37,-62],0],[267,[-30,-54],[-32,-54],0],[270,[-30,-54],[-32,-54],0],[285,[-21,-58],[-23,-58],0],[1549,[-29,-58],[-31,-58],0],[1563,[-31,-55],[-33,-55],0],[1553,[-24,-50],[-26,-50],0],[1565,[3,-63],[1,-63],0],[721,[-34,-62],[-36,-62],0],[722,[-28,-53],[-30,-53],0],[727,[-36,-62],[-38,-62],0],[714,[-28,-53],[-30,-53],0],[712,[-28,-53],[-30,-53],0]];
const COMPAT_LISTS = {"mustapha":{"idle":[0],"walk":[1,2,3,4,5,6,7,8,9,10,11,12],"run":[13,14,15,16,17,18,19,20,21],"jump":[22,23,24],"crouch":[25],"p1":[26,27],"p2":[26,27],"kick":[28,29,30],"fin":[31,32,33,34],"air":[35],"grab":[36,37],"knee":[38],"throw":[39,40,41],"lift":[42,43],"hurt":[44],"hurt2":[45],"fly":[46],"lying":[47],"getup":[48,49],"dizzy":[50,51,52],"win":[53],"gunStand":[54],"gunFire":[55],"pistolStand":[56],"pistolFire":[57],"torsoWalk":[58],"torsoRun":[59],"legsWalk":[60,61,62,63,64,65,66,67,68,69,70,71],"legsRun":[72,73,74,75,76,77,78,79],"legsStand":[80],"bazookaStand":[320],"bazookaFire":[320],"shotStand":[319],"bazStand":[320],"uziStand":[321],"uziTorso":[322],"shotTorso":[323]},"jack":{"idle":[81],"walk":[82,83,84,85,86,87,88,89,90,91,92,93],"run":[94,95,96,97,98,99,100,101,102],"jump":[103,104,105],"crouch":[106],"p1":[107,108],"p2":[107,108],"kick":[109,110],"fin":[111,112],"air":[113],"grab":[114],"knee":[115,116],"throw":[117,118,119],"lift":[120,121],"hurt":[122],"hurt2":[123],"fly":[124],"lying":[125],"getup":[126,127],"dizzy":[128,129,130],"win":[131],"gunStand":[312],"gunFire":[313],"pistolStand":[310],"pistolFire":[311],"torsoWalk":[312],"torsoRun":[314],"legsWalk":[136,137,138,139,140,141,142,143,144,145,146,147],"legsRun":[148,149,150,151,152,153,154,155],"legsStand":[156],"bazookaStand":[317],"bazookaFire":[317],"rifleStand":[315],"longTorso":[316],"bazTorso":[317],"armedLegs":[318]},"hannah":{"idle":[234],"walk":[235,236,237,238,239,240,241,242,243,244,245,246],"run":[247,248,249,250,251,252,253,254,255],"jump":[256,257,258],"crouch":[259],"p1":[260,261],"p2":[260,261],"kick":[262,263],"fin":[264,265,266],"air":[267],"grab":[268],"knee":[269],"throw":[270,271],"lift":[272],"hurt":[273],"hurt2":[274],"fly":[275],"lying":[276],"getup":[277,278],"dizzy":[279,280,281],"win":[282],"gunStand":[283],"gunFire":[284],"pistolStand":[285],"pistolFire":[286],"torsoWalk":[287],"torsoRun":[288],"legsWalk":[289,290,291,292,293,294,295,296,297,298,299,300],"legsRun":[301,302,303,304,305,306,307,308],"legsStand":[309],"bazookaStand":[327],"bazookaFire":[327],"uziTorso":[324],"shotStand":[325],"shotTorso":[326],"bazStand":[327]},"mess":{"idle":[157],"walk":[158,159,160,161,162,163,164,165,166,167,168,169],"run":[170,171,172,173,174,175,176,177,178],"jump":[179,180,181],"crouch":[182],"p1":[183,184],"p2":[183,185],"kick":[186,187],"fin":[188,189],"air":[190],"grab":[191],"knee":[192],"throw":[193,194,195],"lift":[196,197],"hurt":[198],"hurt2":[199],"fly":[200],"lying":[201],"getup":[202,203],"dizzy":[204,205,206],"win":[207],"gunStand":[208],"gunFire":[209],"pistolStand":[210],"pistolFire":[211],"torsoWalk":[212],"torsoRun":[213],"legsWalk":[214,215,216,217,218,219,220,221,222,223,224,225],"legsRun":[226,227,228,229,230,231,232,233],"legsStand":[214],"bazookaStand":[329],"bazookaFire":[329],"shotStand":[328],"bazStand":[329],"uziStand":[330],"uziTorso":[331],"shotTorso":[332]}};

// ------------------------------------------------------------------------------------------------ small helpers
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const md5 = p => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const hex = n => '0x' + n.toString(16).toUpperCase();
const r4 = v => Math.round(v * 10000) / 10000;
function adler32(buf, a = 1, b = 0) { for (let i = 0; i < buf.length; i++) { a = (a + buf[i]) % 65521; b = (b + a) % 65521; } return { a, b, v: ((b << 16) | a) >>> 0 }; }
function fnv(codes) { let h = 0x811C9DC5; for (const c of codes) { h ^= c & 0xFFFF; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
const clipId = (list, index) => `${list}:${index}`;
const parseId = id => { const i = id.lastIndexOf(':'); return { list: id.slice(0, i), index: +id.slice(i + 1) }; };

// ------------------------------------------------------------------------------------------------ records
// One ROM record -> tight (slot, pen) image; code = slot*16 + pen, 0xFFFF = transparent. Same block order, flips,
// tile wrap and uniform-record attribute rule as model.cjs/draw.cjs (block 0 ends on top).
function makeRenderer(M, R) {
  const cache = new Map();
  return function renderRec(rec) {
    if (cache.has(rec)) return cache.get(rec);
    const blocks = M.recBlocks(rec); let out = null;
    if (blocks.length) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const b of blocks) { x0 = Math.min(x0, b.lx); y0 = Math.min(y0, b.ly); x1 = Math.max(x1, b.lx + 16 * b.bw); y1 = Math.max(y1, b.ly + 16 * b.bh); }
      const W = x1 - x0, H = y1 - y0, code = new Uint16Array(W * H).fill(0xFFFF);
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i], fx = !!(b.attr & 0x20), fy = !!(b.attr & 0x40), pal = b.attr & 31;
        for (let r = 0; r < b.bh; r++) for (let c = 0; c < b.bw; c++) {
          const col = fx ? b.bw - 1 - c : c, row = fy ? b.bh - 1 - r : r;
          const t = R.tile((b.code & ~0xF) + ((b.code + col) & 0xF) + 0x10 * row);
          for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
            const p = t[(fy ? 15 - y : y) * 16 + (fx ? 15 - x : x)]; if (p === 15) continue;
            code[(b.ly - y0 + r * 16 + y) * W + (b.lx - x0 + c * 16 + x)] = pal * 16 + p;
          }
        }
      }
      let tx0 = W, ty0 = H, tx1 = -1, ty1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (code[y * W + x] !== 0xFFFF) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
      if (tx1 >= 0) {
        const w = tx1 - tx0 + 1, h = ty1 - ty0 + 1, img = new Uint16Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = code[(y + ty0) * W + x + tx0];
        out = { rec, w, h, ox: -x0 - tx0, oy: -y0 - ty0, code: img, full: { w: W, h: H, ox: -x0, oy: -y0 } };
      }
    }
    cache.set(rec, out); return out;
  };
}

// ------------------------------------------------------------------------------------------------ PNG (spliceable)
// Palette PNG whose IDAT = 78 DA | deflate body ending on a sync flush | 03 00 (empty final block) | adler32, rows
// filtered with None or Sub only (no row depends on the previous one), so bodies of equal-width sheets concatenate.
function encodeSpliceable(png, w, h, idx, plte, trns) {
  const stride = w + 1, rawNone = Buffer.alloc(stride * h), rawSub = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    rawNone[y * stride] = 0; rawSub[y * stride] = 1;
    for (let x = 0; x < w; x++) { const v = idx[y * w + x]; rawNone[y * stride + 1 + x] = v; rawSub[y * stride + 1 + x] = (v - (x ? idx[y * w + x - 1] : 0)) & 255; }
  }
  const opt = { level: 9, memLevel: 9, windowBits: 15, finishFlush: zlib.constants.Z_SYNC_FLUSH };
  const bNone = zlib.deflateRawSync(rawNone, opt), bSub = zlib.deflateRawSync(rawSub, opt);
  const useSub = bSub.length < bNone.length, raw = useSub ? rawSub : rawNone, body = useSub ? bSub : bNone;
  if (!(body.length >= 4 && body[body.length - 4] === 0 && body[body.length - 3] === 0 && body[body.length - 2] === 0xFF && body[body.length - 1] === 0xFF)) throw new Error('sprites-heroes: deflate body does not end on a sync flush');
  const ad = adler32(raw), zd = Buffer.alloc(2 + body.length + 2 + 4);
  zd[0] = 0x78; zd[1] = 0xDA; body.copy(zd, 2); zd[2 + body.length] = 0x03; zd[3 + body.length] = 0x00; zd.writeUInt32BE(ad.v, 4 + body.length);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  const buf = Buffer.concat([png.SIG, png.chunk('IHDR', ihdr), png.chunk('PLTE', plte), png.chunk('tRNS', trns), png.chunk('IDAT', zd), png.chunk('IEND', Buffer.alloc(0))]);
  return { buf, raw, body, filter: useSub ? 'sub' : 'none' };
}

// Bottom-left skyline packing at a fixed width (1024, so the four sheets splice): items by height, width, record
// descending/ascending; each goes to the lowest (then leftmost) spot. Deterministic; ~86 % fill on the hero records
// against ~55 % for a 1024x1024 MaxRects bin, i.e. 35 % less memory per colourised canvas. Checked by atlas-pack.check.
function skyline(items, W, pad) {
  const list = items.slice().sort((a, b) => b.h - a.h || b.w - a.w || a.id - b.id), sky = new Int32Array(W), places = [];
  for (const it of list) {
    const w = it.w + pad, h = it.h + pad; let bx = -1, by = Infinity;
    for (let x = 0; x + w <= W; x++) { let y = 0; for (let k = x; k < x + w; k++) if (sky[k] > y) y = sky[k]; if (y < by) { by = y; bx = x; } }
    if (bx < 0) throw new Error(`skyline: item ${it.id} is wider than ${W}`);
    for (let k = bx; k < bx + w; k++) sky[k] = by + h;
    places.push({ id: it.id, x: bx, y: by, w: it.w, h: it.h });
  }
  places.sort((a, b) => a.id - b.id);
  const h = Math.max(...places.map(p => p.y + p.h));
  if (h > 1024) throw new Error(`skyline: sheet height ${h} > 1024`);
  return { sheets: [{ w: W, h, places }] };
}

// ------------------------------------------------------------------------------------------------ clips and roles
function frameTuple(f, legs) {
  const act = (f.b6 & 4) && (parseInt(f.w8, 16) & 0xFF) ? 1 : 0;
  const t = [f.rec, f.rec2 == null ? -1 : f.rec2, f.dur, f.hold, f.b4 || 0, act];
  if (legs) t.push((f.b5 << 24) >> 24);
  return t;
}
function makeClip(hj, id) {
  const { list, index } = parseId(id), L = hj.lists[list];
  const an = L && L.anims[index]; if (!an || !an.frames || !an.frames.length) return null;
  if (an.frames.some(f => f.parts || f.composite)) throw new Error(`sprites-heroes: ${hj.key} ${id} has composite frames`);
  const legs = !!LEGS_CLIPS[id];
  const c = { f: an.frames.map(f => frameTuple(f, legs)), st: an.status || 'unknown' };
  const last = an.frames.length - 1;
  const tgt = an.loopTarget && an.loopTarget.list != null ? an.loopTarget : null;     // ROM loopTarget (another anim)
  if (tgt) { c.next = clipId(tgt.list, tgt.anim); if (tgt.frame) c.nextK = tgt.frame; }
  else if (Number.isInteger(an.loopFrame)) c.loop = an.loopFrame;
  else c.loop = last;                                              // unknown successor: hold the last frame
  if (legs) c.bob = LEGS_CLIPS[id];
  if (an.name) c.name = String(an.name).slice(0, 120);
  return c;
}
function resolveRoles(hj) {
  const roles = {}, cls = {};
  const w = n => (n == null ? null : clipId('weapon', n));
  for (const [role, id] of Object.entries(FIXED_ROLES)) roles[role] = id;
  const S = hj.stance.standAnimByClass, WT = hj.stance.walkTorsoAnimByClass, AT = hj.attackTable.byClass;
  const runGuns = w(hj.runTorso.gunsAtLeast0x205);
  // HEROES §4.3: Jack has no split-body blunt run (the 0x1A15C note; weapon:23 never ran in his blunt runs)
  const runBlunt = hj.key === 'jack' ? null : w(hj.runTorso.blunt0x203);
  roles['runTorso.guns'] = runGuns; if (runBlunt) roles['runTorso.blunt'] = runBlunt;
  for (const [name, code] of Object.entries(CLASSES)) {
    const stand = w(S[code]) || 'main:0', walkT = w(WT[code]), attack = w(AT[code]);
    roles[`stand.${name}`] = stand; if (walkT) roles[`walkTorso.${name}`] = walkT; if (attack) roles[`attack.${name}`] = attack;
    const n = parseInt(code, 16);
    const runT = name === 'container' ? null : n >= 0x205 ? 'runTorso.guns' : n === 0x203 && runBlunt ? 'runTorso.blunt' : null;
    cls[name] = { code, stand: `stand.${name}`, walkTorso: walkT ? `walkTorso.${name}` : null, runTorso: runT, attack: attack ? `attack.${name}` : null };
  }
  roles['smgWalkFire.smg'] = w(hj.smgWalkFireTorso.uzi0x206); roles['smgWalkFire.m16'] = w(hj.smgWalkFireTorso.m16_0x207); roles.smgWalkFire = roles['smgWalkFire.smg'];
  cls.smg.walkFire = 'smgWalkFire.smg'; cls.m16.walkFire = 'smgWalkFire.m16';
  roles.runThrow = w(hj.runAttackThrowTorso.anim);
  hj.attackTable.containerBySubtype.slice(0, 5).forEach((n, k) => { roles[`attack.container.${k}`] = w(n); });   // KI9: 0..4 only
  const CJ = hj.containerJumps;
  roles['containerJump.rise'] = w(CJ.rise.anim); roles['containerJump.fall'] = w(CJ.fall.anim); roles['containerJump.fwd'] = w(CJ.forward.anim);
  roles.containerJump = roles['containerJump.rise']; roles.jumpWeapon = roles['containerJump.rise']; roles.jumpWeaponDir = roles['containerJump.fwd'];
  for (const k of Object.keys(roles)) if (!roles[k]) delete roles[k];
  return { roles, cls };
}

// ------------------------------------------------------------------------------------------------ weapon / fx data
const seqOf = s => String(s || '').split(/\s+/).filter(Boolean).map(t => { const m = /^(?:\d+\+)?(-|\d+)x(\d+)$/.exec(t); return m ? [m[1] === '-' ? -1 : +m[1], +m[2]] : null; }).filter(Boolean);
function lsq(xs, ys) { const n = xs.length; let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; } const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n; return { a, b }; }
// ROM integration (v += g; h += v): per-frame step d_t = v0 + g*t (t = 1..n) -> v0, g by least squares
function fitFall(path) { const d = [], t = []; for (let i = 1; i < path.length; i++) { d.push(path[i] - path[i - 1]); t.push(i); } const f = lsq(t, d); return { v0: r4(f.a), g: r4(f.b) }; }
function weaponData(H) {
  const V = Object.fromEntries(H.weaponVariants.map(v => [v.key, v]));
  const PW = H.firing.perWeapon, ST = H.firing.static, MT = Object.fromEntries(ST.muzzleTable.rows.map(r => [r.class, r]));
  const BT = Object.fromEntries(ST.bulletTable.rows.map(r => [parseInt(r.subtype, 16), r]));
  const cname = code => Object.keys(CLASSES).find(k => CLASSES[k] === code);
  const out = {};
  for (const t of WEAPON_TYPES) {
    const v = V[t], set = H.weaponSets[v.set], W = H.weapons.find(x => x.key === t);
    const fr0 = k => set.anims[k] && set.anims[k].frames ? set.anims[k].frames[0].rec : null;
    const d = { cls: cname(v.cls), code: v.cls, slot: v.slot, set: v.set, romId: W ? W.id : null, romUses: W ? W.ammo : null,
      rot: Array.from({ length: 16 }, (_, k) => fr0(k)), fastSpin: set.anims[16].frames.map(f => [f.rec, f.dur]),
      ground: set.anims[17].frames.map(f => [f.rec, f.dur]) };
    if (t === 'dynamite' && set.anims[18] && set.anims[18].frames) d.fuse = set.anims[18].frames.map(f => [f.rec, f.dur]);
    if (FIREARMS.includes(t)) {
      const jr = PW[t].jack, kinds = jr.spawnedPerKind || [];
      const proj = kinds.filter(k => k.pool === 'A' && ['0xC', '0x28', '0x1C'].includes(k.type));
      const p0 = proj[0], kind = p0.type === '0xC' ? 'bullet' : p0.type === '0x28' ? 'pellet' : 'rocket';
      d.muzzle = p0.spawnFromWeaponOrigin.slice();
      const lifeBy = {}; for (const h of HEROES) { const r = PW[t][h]; const ks = (r && r.spawnedPerKind || []).filter(k => k.pool === 'A' && k.type === p0.type); lifeBy[h] = ks.length ? Math.max(...ks.map(k => k.lifeFrames.mode)) : null; }   // free-flight life: the mode (max picks up slot reuse; VERIFY #5)
      const shot = { kind, v: p0.pxPerFrame, life: lifeBy };
      if (kind === 'bullet') { const row = BT[parseInt(p0.sub, 16)]; shot.rec = row.flightAnim.map(a => [a.rec, a.dur]); shot.aimed = !!row.aimed; shot.attackId = row.attackId; shot.v = row.vx; }
      if (kind === 'pellet') { shot.pellets = proj.map(k => ({ sub: k.sub, v: k.meanOverFirst4, life: k.lifeFrames.max, travel: k.travel })); shot.rec = [2138, 3361, 3362, 3363]; }
      if (kind === 'rocket') { shot.rec = seqOf(p0.recordSequence).filter(s => s[0] >= 0); shot.v = shot.v0 = p0.meanOverFirst4; shot.a = 0.174; shot.lifeRange = [p0.lifeFrames.min, p0.lifeFrames.max]; shot.note = 'v0 1.75 px/f accelerating; a = 0.174 px/f^2 fits 92 px in 24 f (HEROES §7.4)'; }
      d.shot = shot;
      const fx = (sub) => kinds.find(k => k.pool === 'D' && k.type === '0x4' && k.sub === sub && (k.delayAfterShot.mode | 0) <= 1);
      const flashSub = { gun: '0xF', rifle: '0x10', uzi: '0x12', m16: '0x12', shotgun: '0x11', bazooka: '0x13' }[t];
      const fl = fx(flashSub); if (fl) d.flash = { at: fl.spawnFromWeaponOrigin, seq: seqOf(fl.recordSequence) };
      if (t === 'bazooka') { const bb = fx('0x14'); if (bb) d.backBlast = { at: bb.spawnFromWeaponOrigin, seq: seqOf(bb.recordSequence) }; }
      const sm = fx('0x6') || fx('0x9'); if (sm) d.smoke = { at: sm.spawnFromWeaponOrigin, seq: seqOf(sm.recordSequence) };
      const sm2 = fx('0xA'); if (sm2 && sm !== sm2) d.smoke2 = { at: sm2.spawnFromWeaponOrigin, seq: seqOf(sm2.recordSequence) };
      const sp = kinds.find(k => k.pool === 'D' && k.type === '0x7C'); const mt = MT[v.cls];
      d.sparks = sp && mt && mt.sparks !== 0 ? { n: Math.round(sp.perShot), at: sp.spawnFromWeaponOrigin, v: sp.pxPerFrame, life: sp.lifeFrames.mode, seq: seqOf(sp.recordSequence).filter(s => s[0] >= 0) } : null;
      d.casing = mt && mt.casing ? { at: mt.casingAt, everyOther: t === 'uzi' || t === 'm16' } : null;
      const fs0 = {}; for (const h of HEROES) fs0[h] = PW[t][h] ? PW[t][h].fireStateFrames : null;
      d.fireState = fs0;
      if (t === 'bazooka') { const push = {}; for (const h of HEROES) push[h] = PW[t][h] ? PW[t][h].pushBackPx : null; d.push = push; }
      // USER DECISION (overrides HEROES D15): an empty gun is HURLED at the enemy (HEROES O3), drawn with the ROM spin.
      d.empty = 'hurl';
      d.emptyPose = t === 'rifle' ? 'rifle-empty' : t === 'm16' ? 'm16-empty' : null;
      const thr = {}; for (const h of HEROES) { const r = PW[t][h], tw = r && r.thrown && r.thrown[0]; thr[h] = tw ? { from: tw.fromFeet, air: tw.airFrames } : null; }
      d.romDiscard = thr;                                           // the arcade's own pop-up discard (D15), kept for reference
    }
    if (t === 'torch') d.flame = true;
    out[t] = d;
  }
  // the empty club poses of the rifle and M16 (R2): own pose slots, same sets
  for (const k of ['rifle-empty', 'm16-empty']) { const v = V[k]; out[k] = { cls: 'blunt', code: v.cls, slot: v.slot, set: v.set, of: v.weapon }; }
  for (const k of ['stone-b', 'stone-c']) { const v = V[k], set = H.weaponSets[v.set]; out[k] = { cls: 'throwable', code: v.cls, slot: v.slot, set: v.set, of: 'stone', rot: Array.from({ length: 16 }, (_, i) => set.anims[i].frames[0].rec), ground: set.anims[17].frames.map(f => [f.rec, f.dur]) }; }
  return out;
}
function fxData(H) {
  const PW = H.firing.perWeapon, FL = H.companions.torchFlame, ST = H.firing.static;
  const kindsOf = (w, h = 'jack') => (PW[w][h] && PW[w][h].spawnedPerKind) || [];
  const find = (w, pred) => kindsOf(w).find(pred);
  const cas = find('rifle', k => k.type === '0x84');
  const gr = find('grenade', k => k.pool === 'A' && k.type === '0x4'), boom = find('grenade', k => k.type === '0x4' && k.sub === '0x4');
  const dyn = find('dynamite', k => k.pool === 'A' && k.type === '0x4');
  const imp = find('gun', k => k.type === '0x4' && k.sub === '0x0');
  const debris = kindsOf('bazooka').filter(k => k.type === '0x54').flatMap(k => seqOf(k.recordSequence).filter(s => s[0] >= 2835 && s[0] <= 2840).map(s => s[0]));
  const smgSmoke = [find('uzi', k => k.type === '0x4' && k.sub === '0x9'), find('uzi', k => k.type === '0x4' && k.sub === '0xA')].filter(Boolean).flatMap(k => seqOf(k.recordSequence));
  const gunThrow = PW.gun.jack.thrown[0], knifeThrow = PW.knife.jack.thrown[0];
  const disc = fitFall(gunThrow.path.map(p => p[1]));
  // knife flight: straight at 9.5 px/f until it hits (x stops growing), then the rebound + fall
  const kp = knifeThrow.path; let hit = kp.findIndex((p, i) => i && p[0] < kp[i - 1][0]); if (hit < 0) hit = kp.length;
  const reb = kp.slice(hit - 1), rebVx = reb.length > 2 ? r4((reb[reb.length - 1][0] - reb[0][0]) / (reb.length - 1)) : -2;
  const landI = reb.findIndex((p, i) => i && p[1] < 0), fall = fitFall(reb.slice(0, landI > 0 ? landI + 1 : reb.length).map(p => p[1]));
  const bubbles = {}; for (const ph of H.bubbles.perHero) { const key = HEROES[ph.id]; bubbles[key] = { victory: ph.victory.map(b => b.rec), teamUp: ph.teamUp ? ph.teamUp.rec : null }; }
  const throwV = ST.throwVelocities;
  return {
    casing: cas ? { rec: seqOf(cas.recordSequence), v: [-2, 4], g: 0.28, life: [cas.lifeFrames.min, cas.lifeFrames.max], note: 'pool D 0x84: vx -2.0 away from the facing, vh 4.0, gravity 0.28, life 30 + 0..3 (0x96D2A)' } : null,
    impact: imp ? seqOf(imp.recordSequence).filter(s => s[0] >= 1405) : [[1405, 2], [1406, 3], [1407, 3]],
    explosion: gr ? seqOf(gr.recordSequence).filter(s => s[0] >= 0) : null,
    dynamite: dyn ? seqOf(dyn.recordSequence).filter(s => s[0] >= 0) : null,
    boom: boom ? seqOf(boom.recordSequence) : null,
    debris: [...new Set(debris)].sort((a, b) => a - b),
    smgSmoke,
    thrown: { throwable: throwV.throwable, blade: throwV.blade, arc: { vx: 4, vh: 2.5, g: -0.21875, air: PW.grenade.jack.thrown[0].airFrames }, grenadeFuse: 57, dynamiteFuse: 135,
      releaseH: Object.fromEntries(HEROES.map(h => [h, PW.knife[h].thrown[0].fromFeet[1]])), rebound: { vx: rebVx, v0: fall.v0, g: fall.g }, lie: knifeThrow.gone != null ? knifeThrow.gone - knifeThrow.releasedAt - knifeThrow.airFrames : 60 },
    // USER DECISION: empty guns are thrown at the enemy (HEROES O3 "hurl"). The ROM turns an empty revolver, Uzi or
    // shotgun into a class 0x201 throwable (firing.static.emptyWeapons, R2), so the hurl uses the throwable flight
    // (0x26534: 9.5 px/f, -0.0078 px/f^2, 12 px/f on the run) from the hero's release height, the gun's fast-spin
    // records (anim 16) in flight, the knife's rebound on a hit, then the ground record; attack.throwable plays and
    // the gun leaves the hand on its release event (ev 2). Damage stays sequel gameplay (42, throwHeldWeapon).
    hurl: { clip: 'attack.throwable', release: 2, v: throwV.throwable.normal.vx, ax: throwV.throwable.normal.ax, vRun: throwV.throwable.alt.vx, h: 'releaseH',
      spin: 'weapon.<type>.fastSpin', ground: 'weapon.<type>.ground', rebound: { vx: rebVx, v0: fall.v0, g: fall.g }, lie: knifeThrow.gone != null ? knifeThrow.gone - knifeThrow.releasedAt - knifeThrow.airFrames : 60, damage: 42,
      weapons: FIREARMS.slice(), from: 'user decision (O3) over HEROES D15; flight = firing.static.throwVelocities.throwable, rebound fitted from ex-heroes-arm-jack-knife' },
    // the arcade's own discard (HEROES D15): pops straight up, spins, falls, vanishes; no damage. Kept for reference.
    discard: { vh: disc.v0, g: disc.g, life: gunThrow.airFrames, from: 'ex-heroes-arm-jack-gun thrown path (least squares on the per-frame steps)' },
    torchFlame: {
      burning: FL.anims.burning.frames.map(f => [f.rec, f.dur]), running: FL.anims.running.frames.map(f => [f.rec, f.dur]),
      offsets: FL.offsetTable.entries.map(e => e.origin.slice()),      // native [dx, y-down] from the torch origin, by torch frame b5/4
      lag: 1, depthAlt: [2, -1], note: KI6_NOTE,
    },
    bubbles,
  };
}
const KI6_NOTE = 'KI6: flame = the torch as it was one frame earlier (origin + offsets[b5/4], facing) at depth torch+2 / torch-1 on alternate frames: +2 is 2 px higher and behind the hero, -1 is 1 px lower and in front; the running chain plays while the holder runs, the burning chain otherwise (restarted when the run ends); the flame shows one frame after the torch does';

// ------------------------------------------------------------------------------------------------ the build
function build(opts = {}) {
  const lib = opts.lib || {};
  const png = lib.png || require('./png.cjs'), atlas = lib.atlas || require('./atlas-pack.cjs'), emit = lib.emit || require('./emit.cjs');
  const palettes = lib.palettes || require('./palettes.cjs');
  const log = opts.log || (() => {});
  const extract = opts.extract || path.join(ROOT, 'work', 're', 'extract');
  const out = opts.out || ROOT, rgba = !!opts.rgba;
  const R = opts.rom || require('../rom.cjs'), M = require('../export/lib/model.cjs');
  const heroesJson = path.join(extract, 'heroes', 'heroes.json'), mechJson = path.join(extract, 'mechanics', 'mechanics.json');
  const H = readJSON(heroesJson), MECH = readJSON(mechJson);
  const renderRec = makeRenderer(M, R);
  const inputs = [heroesJson, mechJson, ...HEROES.flatMap(h => [path.join(extract, 'heroes', `atlas-${h}.json`), path.join(extract, 'heroes', `atlas-${h}.png`)]), path.join(ROOT, 'tools/re/export/lib/model.cjs'), path.join(ROOT, 'tools/re/rom.cjs')];
  const report = { inputs: inputs.map(rel), warnings: [], labels: {}, atlasCheck: {}, sheets: {}, sizes: {} };

  // 1. roles, clips, records per hero
  const heroData = {}, recSets = {};
  for (const hj of H.heroes) {
    const key = hj.key, { roles, cls } = resolveRoles(hj), clips = {};
    for (const id of new Set(Object.values(roles))) { const c = makeClip(hj, id); if (!c) { report.warnings.push(`${key}: role clip ${id} missing`); continue; } clips[id] = c; }
    for (const [role, id] of Object.entries(roles)) if (!clips[id]) delete roles[role];
    // successors of shipped clips that are not shipped themselves: hold their last frame instead (logged)
    for (const [id, c] of Object.entries(clips)) if (c.next && !clips[c.next]) { report.warnings.push(`${key}: ${id} continues into unshipped ${c.next}; holds its last frame`); delete c.next; delete c.nextK; c.loop = c.f.length - 1; }
    const recs = new Set();
    for (const c of Object.values(clips)) for (const t of c.f) { recs.add(t[0]); if (t[1] >= 0) recs.add(t[1]); }
    for (const [, li] of Object.entries(COMPAT_LISTS[key])) for (const i of li) recs.add(COMPAT_FRAMES[i][0]);
    recSets[key] = recs;
    // KI8: shipped roles whose ROM label is not observed / table-selected, for a sheet check before G3c uses them
    report.labels[key] = Object.entries(roles).filter(([, id]) => !OBSERVED.has(clips[id].st)).map(([r, id]) => `${r}=${id} (${clips[id].st})`);
    heroData[key] = { hj, roles, cls, clips };
  }
  // compat frames whose record belongs to another hero's range would land on the wrong sheet: check
  for (const key of HEROES) for (const i of new Set(Object.values(COMPAT_LISTS[key]).flat())) { const rec = COMPAT_FRAMES[i][0]; if (!recSets[key].has(rec)) throw new Error(`compat ${key} frame ${i} rec ${rec}`); }

  // 2. render, trim and verify every record against the extract atlas (coloured with ROM set 0)
  const set0 = R.paletteSet(0), pal0 = (code) => set0[code >> 4][code & 15];
  const images = {}, codesUsed = new Set();
  for (const key of HEROES) {
    const aj = readJSON(path.join(extract, 'heroes', `atlas-${key}.json`)), ap = png.read(path.join(extract, 'heroes', `atlas-${key}.png`));
    const byRec = new Map(aj.frames.map(f => [f.rec, f]));
    const chk = { records: 0, inAtlas: 0, pixels: 0, mismatches: 0, notInAtlas: [] };
    images[key] = {};
    for (const rec of [...recSets[key]].sort((a, b) => a - b)) {
      const im = renderRec(rec); if (!im) throw new Error(`sprites-heroes: ${key} record ${rec} renders empty`);
      images[key][rec] = im; chk.records++;
      for (const c of im.code) if (c !== 0xFFFF) codesUsed.add(c);
      const af = byRec.get(rec);
      if (!af) { chk.notInAtlas.push(rec); continue; }
      chk.inAtlas++;
      for (let y = 0; y < af.h; y++) for (let x = 0; x < af.w; x++) {
        const nx = x - af.ox, ny = y - af.oy, mx = nx + im.ox, my = ny + im.oy;
        const c = mx >= 0 && my >= 0 && mx < im.w && my < im.h ? im.code[my * im.w + mx] : 0xFFFF;
        const q = ((af.y + y) * ap.width + af.x + x) * 4, a = ap.rgba[q + 3];
        if (c === 0xFFFF && !a) continue;
        chk.pixels++;
        if (c === 0xFFFF || !a) { chk.mismatches++; continue; }
        const rgb = pal0(c); if (rgb[0] !== ap.rgba[q] || rgb[1] !== ap.rgba[q + 1] || rgb[2] !== ap.rgba[q + 2]) chk.mismatches++;
      }
    }
    report.atlasCheck[key] = chk;
    if (chk.mismatches) throw new Error(`sprites-heroes: ${key} records differ from atlas-${key}.png in ${chk.mismatches} px`);
  }

  // 3. one global PLTE: entry 0 transparent, then every used (slot, pen) ascending
  const codes = [...codesUsed].sort((a, b) => a - b);
  if (codes.length > 255) throw new Error(`sprites-heroes: ${codes.length} (slot, pen) codes do not fit one PLTE`);
  const codeIndex = new Map(codes.map((c, i) => [c, i + 1]));
  const homeRGB = c => { const [r, g, b] = pal0(c); return [r, g, b]; };
  const plte = Buffer.alloc((codes.length + 1) * 3), trns = Buffer.alloc(codes.length + 1, 255); trns[0] = 0;
  codes.forEach((c, i) => { const e = rgba ? homeRGB(c) : [c >> 4, c & 15, 0]; plte[(i + 1) * 3] = e[0]; plte[(i + 1) * 3 + 1] = e[1]; plte[(i + 1) * 3 + 2] = e[2]; });

  // 4. pack and encode the four sheets (width fixed to 1024 so they splice)
  const sheets = {}, rect = {}, raws = {}, sheetPNG = {};
  for (const key of HEROES) {
    const recs = Object.keys(images[key]).map(Number);
    const items = recs.map(r => ({ id: r, w: images[key][r].w, h: images[key][r].h }));
    const pk = skyline(items, 1024, 1), pc = atlas.check(pk, items, { max: 1024, pad: 1 });
    if (!pc.ok) throw new Error(`sprites-heroes: ${key} packing: ${pc.errors.slice(0, 3).join('; ')}`);
    const sh = pk.sheets[0], W = 1024, Hh = sh.h, idx = new Uint8Array(W * Hh), rc = {};
    const vis = new Uint8Array(W * Hh * 4);
    for (const p of sh.places) {
      const im = images[key][p.id];
      for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) { const c = im.code[y * im.w + x]; if (c === 0xFFFF) continue; const q = (p.y + y) * W + p.x + x; idx[q] = codeIndex.get(c); const [r, g, b] = homeRGB(c); vis.set([r, g, b, 255], q * 4); }
      rc[p.id] = [p.x, p.y, im.w, im.h, im.ox, im.oy];
    }
    const enc = encodeSpliceable(png, W, Hh, idx, plte, trns);
    const dec = png.decode(enc.buf);
    for (let q = 0; q < W * Hh; q++) { const i = idx[q], a = dec.rgba[q * 4 + 3]; if (i === 0 ? a !== 0 : (a !== 255 || (!rgba && (dec.rgba[q * 4] !== codes[i - 1] >> 4 || dec.rgba[q * 4 + 1] !== (codes[i - 1] & 15) || dec.rgba[q * 4 + 2] !== 0)))) throw new Error(`sprites-heroes: ${key} sheet does not round-trip at pixel ${q}`); }
    sheets[key] = { png: png.dataURL(enc.buf), w: W, h: Hh, sum: png.fnvIndexed(dec.rgba).toString(16) };
    rect[key] = rc; raws[key] = enc.raw; sheetPNG[key] = { vis, w: W, h: Hh, filter: enc.filter, bytes: enc.buf.length };
    report.sheets[key] = { w: W, h: Hh, records: recs.length, pngBytes: enc.buf.length, filter: enc.filter, fill: r4(sh.places.reduce((n, p) => n + p.w * p.h, 0) / (W * Hh)) };
  }
  // compat stacks (PLAN §4.6): sheet = mustapha + hannah + mess spliced vertically, sheet2 = jack (all Jack frames s:2)
  const stack = ids => ({ ids, h: ids.reduce((n, k) => n + sheets[k].h, 0), adler: hex(adler32(Buffer.concat(ids.map(k => raws[k]))).v) });

  // 5. palette rows and maps (PLAN §4.1: hero-<id> = set 0, mirror-/freed-/half-<id>, gel, flash)
  const rows = {}; for (let s = 0; s < 32; s++) rows[s] = set0[s].map(([r, g, b]) => (r << 16) | (g << 8) | b);
  const ident = () => Array.from({ length: 32 }, (_, s) => s);
  const maps = { hero: ident() };
  const hand = palettes.HAND;
  for (const [i, h] of ['jack', 'hannah', 'mustapha', 'mess'].entries()) {            // OBJ slot = index (palettes.HERO_NAMES)
    maps[`hero-${h}`] = ident();
    for (const v of ['mirror', 'freed', 'half']) {
      const name = `${v}-${h}`, hr = hand[name] && hand[name][i]; if (!hr) throw new Error(`palettes.HAND.${name} missing slot ${i}`);
      rows[palettes.handKey(name, i)] = hr.slice(); const m = ident(); m[i] = palettes.handKey(name, i); maps[name] = m;
    }
  }
  for (const v of ['gel', 'flash']) { const hr = hand[v] && hand[v]['*']; rows[v] = hr.slice(); maps[v] = Array.from({ length: 32 }, () => v); }

  // 6. per-hero data
  const hero = {};
  const locoPer = MECH.heroes.locomotion.perHero, jumpKinds = MECH.heroes.locomotion.jumpTables.kinds;
  for (const key of HEROES) {
    const { hj, roles, cls, clips } = heroData[key];
    const hold = {};
    for (const p of hj.holdPlacements) for (const [wk, wv] of Object.entries(p.weapons)) {
      if (wv.hidden || wv.anim < 0 || wv.rec == null) continue;
      const e = [wv.rec, wv.origin[0], wv.origin[1]]; if (wk === 'torch' && wv.flame) e.push(wv.flame.offsetIndex);
      (hold[wk] = hold[wk] || {})[p.hold] = e;
    }
    const lp = locoPer[key], walk0 = MECH.heroes.locomotion.speedTables.sets[0].per[hj.name];
    const jump = {};
    for (const k of jumpKinds) { const ph = k.perHero && k.perHero[hj.name]; if (!ph) continue; jump[k.kind] = { use: k.use, by: Object.fromEntries(Object.entries(ph.byStick).map(([dir, j]) => [dir, [r4(j.vx / 256), r4(j.vh / 256), r4(j.g / 256), r4(j.vd / 256), j.airFrames]])) }; }
    hero[key] = {
      rom: hj.id, game: GAME_INDEX[key], name: hj.name, palSlot: hj.palette, sheet: key,
      speed: { walk: r4(walk0.dirs.find(d => d.dir === 'right').vxPx), walkDepth: r4(walk0.dirs.find(d => d.dir === 'up').vdPx), run: r4(lp.run_.sustained.pxPerFrame), runStart: { px: r4(lp.run_.burst.pxPerFrame), frames: lp.run_.burst.frames[0] }, note: '8.8 px/frame (0x50E4 set 0 walk, 0x5064 sets 1/2 run); unused until G3c / HEROES O1' },
      jump: { kinds: jump, fields: '[vx, vh, g, vdepth, airFrames] px/frame' },
      stab: [hj.stabBox.fwd, hj.stabBox.xoff, hj.stabBox.xRange, hj.stabBox.dOff, hj.stabBox.dRange],
      bazookaPush: [hj.bazookaRecoil.vx, hj.bazookaRecoil.ax],
      releaseH: H.firing.perWeapon.knife[key].thrown[0].fromFeet[1],
      bob: { walk: hj.bob.entries.map(e => [e.dx, e.dy]), run: hj.bob.run.map(e => [e.dx, e.dy]), note: '[dx, dyUp]: torso and weapon at (+dx, -dyUp) native, by the legs frame b5 (walk table for legs main:16, run table for main:11)' },
      cls, roles, clips, hold,
      contact: CONTACT,
      inferred: report.labels[key],
    };
  }
  const weapon = weaponData(H), fx = fxData(H);
  const weaponRecs = new Set();
  for (const k of HEROES) for (const hw of Object.values(hero[k].hold)) for (const e of Object.values(hw)) weaponRecs.add(e[0]);
  for (const w of Object.values(weapon)) { for (const r of w.rot || []) if (r != null) weaponRecs.add(r); for (const s of [...(w.fastSpin || []), ...(w.ground || []), ...(w.fuse || [])]) weaponRecs.add(s[0]); }
  for (const s of [...fx.torchFlame.burning, ...fx.torchFlame.running]) weaponRecs.add(s[0]);

  // 7. the family object
  const rom = (() => { try { return require('./manifest.cjs').romSha1(); } catch (e) { return null; } })();
  const fam = {
    v: 1, family: 'heroes', mode: rgba ? 'rgba' : 'indexed',
    build: { from: ['work/re/extract/heroes/heroes.json', 'work/re/extract/heroes/atlas-<hero>.png', 'work/re/extract/mechanics/mechanics.json'], md5: { heroes: md5(heroesJson), mechanics: md5(mechJson) }, tool: 'tools/re/build-game-assets.cjs sprites heroes (tools/re/build/sprites-heroes.cjs)', rom },
    sheets, rect,
    pal: { rows, maps, home: 'hero' },
    order: HEROES.slice(), gameOrder: ['mustapha', 'jack', 'hannah', 'mess'],
    hero, weapon, fx,
    weaponRecs: [...weaponRecs].sort((a, b) => a - b),
    weaponFamily: 'fx',
    units: { space: 'native left-facing feet space, x right, y down (HEROES §3.1)', time: '60 Hz frames; dur 0 = 256', tuple: '[rec, rec2 (-1 none), dur, hold (<0 hidden), ev (b4), act, bob (legs clips)]', scale: 'arcade px (CFG.sockets.scale = 1 from G1)' },
    compat: { v: 1, sheet: stack(['mustapha', 'hannah', 'mess']), sheet2: stack(['jack']), plte: codes.map(c => [c >> 4, c & 15]), frames: COMPAT_FRAMES, lists: COMPAT_LISTS, note: 'ARCADE_HEROES compatibility view (PLAN §4.6), built by sprites.js; removed in G3' },
  };
  const file = path.join(out, 'sprite-data-heroes.js');
  const res = emit.module(file, "SPRITE_DATA.add('heroes',", fam);
  report.sizes['sprite-data-heroes.js'] = res.bytes;
  if (res.bytes > 0.9 * 1048576) report.warnings.push(`sprite-data-heroes.js is ${res.bytes} bytes > 0.9 MB budget`);
  log(`sprites heroes: ${HEROES.map(k => `${k} ${report.sheets[k].w}x${report.sheets[k].h} ${report.sheets[k].records} rec`).join(', ')}; ${codes.length} codes; ${(res.bytes / 1048576).toFixed(3)} MB`);
  log(`sprites heroes: atlas check ${HEROES.map(k => `${k} ${report.atlasCheck[k].inAtlas}/${report.atlasCheck[k].records} rec, ${report.atlasCheck[k].mismatches} px off`).join('; ')}`);
  for (const k of HEROES) log(`sprites heroes: KI8 inferred-label roles ${k}: ${report.labels[k].join(', ') || 'none'}`);
  for (const w of report.warnings) log(`sprites heroes: WARN ${w}`);
  const files = [file];

  // 8. review images (work/, git-ignored) and the golden fixture
  const isRoot = path.resolve(out) === path.resolve(ROOT);
  if (opts.review !== false && isRoot) {
    const dir = path.join(ROOT, 'work', 're', 'build', 'sheets'); fs.mkdirSync(dir, { recursive: true });
    for (const k of HEROES) png.write(path.join(dir, `heroes-${k}.png`), { width: sheetPNG[k].w, height: sheetPNG[k].h, rgba: sheetPNG[k].vis });
    try { report.contact = contactSheets({ fam, renderRec, R, palettes, png, out: path.join(ROOT, 'work', 're', 'pack') }); log(`sprites heroes: contact sheets ${report.contact.files.map(rel).join(', ')}`); }
    catch (e) { report.warnings.push(`contact sheets: ${e.stack || e.message}`); log(`sprites heroes: WARN contact sheets ${e.message}`); }
  }
  const wantGolden = opts.golden != null ? opts.golden : isRoot;
  if (wantGolden) {
    const g = goldenFixture({ H, M, fam, renderRec, log });
    if (g) { const gf = path.join(out, 'tests', 'fixtures', 'rom-heroes-golden.json'); emit.json(gf, g, { indent: 0 }); files.push(gf); report.golden = g.counts; log(`sprites heroes: golden ${g.samples.length} samples -> ${rel(gf)}`); }
    else log('sprites heroes: golden skipped (work/re/runs not present); the committed fixture is kept');
  }
  report.summary = { sheets: report.sheets, bytes: res.bytes, codes: codes.length, atlasCheck: report.atlasCheck, inferredLabelRoles: report.labels, warnings: report.warnings.length, golden: report.golden || null };
  return { files, report };
}

// ------------------------------------------------------------------------------------------------ HeroRig in Node
function loadRig(fam) {
  const win = { SPRITE_DATA: { families: { heroes: fam }, add(n, f) { this.families[n] = f; } } };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'hero-rig.js'), 'utf8'), ctx, { filename: 'hero-rig.js' });
  return win.HeroRig;
}

// ------------------------------------------------------------------------------------------------ contact sheets
// Every role (frame 0 and the whole clip as a strip) and every weapon class on its class roles, both facings, drawn
// through HeroRig.parts() with records rendered from the ROM (weapons in their own OBJ slots; slots 23-31 with the
// S1A0 map, which is what ch1 uses).
function contactSheets({ fam, renderRec, R, palettes, png, out }) {
  const D = require('../export/lib/draw.cjs');
  const rig = loadRig(fam); if (!rig) throw new Error('hero-rig.js did not define HeroRig');
  const set0 = R.paletteSet(0), s1 = palettes.objMap(1, 0);
  const colour = c => { const slot = c >> 4, pen = c & 15; if (slot >= 23) { const row = palettes.rowRGB(s1[slot]); const v = row[pen]; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; } return set0[slot][pen]; };
  const blitPart = (cv, p, fx, fy, dir) => {
    const im = renderRec(p.rec); if (!im) return;
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
      const c = im.code[y * im.w + x]; if (c === 0xFFFF) continue;
      const nx = p.x - im.ox + x, ny = p.y - im.oy + y, flip = p.flip ? -1 : 1;
      const sx = dir > 0 ? fx - nx * flip - 1 : fx + nx * flip; cv.set(sx, fy + ny, colour(c));
    }
  };
  const W = 1600, files = [];
  const WEAP = { throwable: 'grenade', blade: 'knife', blunt: 'club', pistol: 'gun', rifle: 'rifle', smg: 'uzi', m16: 'm16', shotgun: 'shotgun', bazooka: 'bazooka', container: 'container-rock' };
  for (const key of HEROES) {
    const hd = fam.hero[key], cells = [];
    const clipOf = role => { const id = hd.roles[role]; return id ? { id, c: hd.clips[id] } : null; };
    for (const role of Object.keys(hd.roles).sort()) { const r = clipOf(role); if (r) cells.push({ label: `${role} ${r.id}`, body: k => ({ full: { clip: r.id, k } }), n: r.c.f.length, weapon: null }); }
    for (const [cn, ci] of Object.entries(hd.cls)) {
      const wk = WEAP[cn];
      for (const which of ['stand', 'attack']) if (ci[which]) { const id = hd.roles[ci[which]]; cells.push({ label: `${cn} ${which} ${id} ${wk}`, body: k => ({ full: { clip: id, k } }), n: hd.clips[id].f.length, weapon: wk }); }
      if (ci.walkTorso) { const id = hd.roles[ci.walkTorso]; cells.push({ label: `${cn} walk ${id}+main:16 ${wk}`, body: k => ({ torso: { clip: id, k: 0 }, legs: { clip: 'main:16', k } }), n: hd.clips['main:16'].f.length, weapon: wk }); }
      else cells.push({ label: `${cn} walk main:1 ${wk}`, body: k => ({ full: { clip: 'main:1', k } }), n: 12, weapon: wk });
      if (ci.runTorso) { const id = hd.roles[ci.runTorso]; cells.push({ label: `${cn} run ${id}+main:11 ${wk}`, body: k => ({ torso: { clip: id, k: 0 }, legs: { clip: 'main:11', k } }), n: hd.clips['main:11'].f.length, weapon: wk }); }
      else cells.push({ label: `${cn} run main:9 ${wk}`, body: k => ({ full: { clip: 'main:9', k } }), n: hd.clips['main:9'].f.length, weapon: wk });
    }
    const CW = 120, CH = 120, perRow = 12, rowsN = cells.reduce((n, c) => n + 1, 0);
    const cv = new D.Canvas(W, 24 + rowsN * (CH + 14), [24, 26, 30, 255]);
    cv.text(`${key.toUpperCase()} - HEROES FAMILY CONTACT SHEET (HeroRig.parts, ROM records) - LEFT: FACING LEFT  RIGHT: FACING RIGHT`, 6, 6, [255, 230, 120]);
    cells.forEach((cell, i) => {
      const y0 = 24 + i * (CH + 14);
      cv.text(cell.label, 6, y0, [200, 210, 220]);
      const n = Math.min(cell.n, perRow / 2 | 0);
      for (let k = 0; k < n; k++) for (const dir of [-1, 1]) {
        const col = (dir < 0 ? 0 : n) + k, fx = 10 + col * CW + CW / 2, fy = y0 + CH;
        if (fx + CW / 2 > W) continue;
        cv.fill(fx - CW / 2 + 2, y0 + 10, CW - 4, CH - 8, (k + (dir > 0 ? 1 : 0)) & 1 ? [40, 44, 52, 255] : [34, 38, 46, 255]);
        let parts; try { parts = rig.parts(key, cell.body(k), cell.weapon, {}); } catch (e) { cv.text('ERR', fx - 10, fy - 30, [255, 80, 80]); continue; }
        for (const p of parts) blitPart(cv, p, fx, fy, dir);
        cv.cross(fx, fy, [255, 0, 255], 2);
      }
    });
    fs.mkdirSync(out, { recursive: true });
    const f = path.join(out, `heroes-${key}.png`); cv.png(f); files.push(f);
  }
  return { files };
}

// ------------------------------------------------------------------------------------------------ golden fixture
// Samples real game states from the MAME validation runs (heroes.json validation.runs), predicts the OBJ blocks with
// model.cjs predict() (the 99.99 % validated model) and stores each frame's part list in native feet space plus a
// pixel hash of the hero records, so tests/rom-heroes.cjs can check HeroRig.parts() and the shipped sheets without the
// ROM or the runs. Torch samples carry the previous frame (KI6 lag) and the flame RAM truth.
function goldenFixture({ H, M, fam, renderRec, log }) {
  const RUNS = path.join(ROOT, 'work', 're', 'runs');
  if (!fs.existsSync(RUNS)) return null;
  const V = require('../export/lib/validate.cjs');
  M.setCull(false);
  const variants = H.weaponVariants;
  const keyOfWeapon = (w) => { const c = variants.filter(v => v.slot === w.slot && v.set === w.set); if (c.length === 1) return c[0].key; if (c.length > 1) { const torch = c.find(v => v.key === 'torch'), club = c.find(v => v.key === 'club'); if (torch && club) return w.sub === 0x16 ? 'torch' : 'club'; } return null; };
  const runs = H.validation.runs.filter(r => r.agreement === 1 || r.agreement > 0.998).map(r => ({ run: r.run, hero: HEROES[H.heroes.findIndex(h => h.name === r.hero)], kind: r.kind }));
  const FLI = new Map(); for (const [chain, an] of Object.entries(H.companions.torchFlame.anims)) an.frames.forEach((f, i) => FLI.set(parseInt(f.addr, 16), { chain, k: i, rec: f.rec }));
  const samples = [], counts = { runs: 0, frames: 0, candidates: 0, skippedClip: 0, skippedOther: 0, torch: 0, flame: 0, byHero: {} };
  const PER_RUN = 5;
  const toId = s => { const m = /^(\w+):(\d+)\.(\d+)$/.exec(s); return m ? { clip: `${m[1]}:${m[2]}`, k: +m[3] } : null; };
  const readFrames = run => {
    const file = path.join(RUNS, run, 'frames.jsonl'); if (!fs.existsSync(file)) return null;
    const lines = fs.readFileSync(file, 'utf8').split('\n'); const out = [];
    for (const ln of lines) { if (!ln) continue; const fr = JSON.parse(ln); if (fr.ram) { const m = {}; for (const [k, v] of Object.entries(fr.ram)) m[parseInt(k, 16)] = Buffer.from(v, 'hex'); fr.mem = m; delete fr.ram; } delete fr.obj; out.push(fr); }
    return out;
  };
  for (const { run, hero: key, kind } of runs) {
    const frames = readFrames(run); if (!frames) continue;
    counts.runs++;
    const hj = H.heroes[HEROES.indexOf(key)], hd = fam.hero[key], cache = {}, cands = [], seen = new Set();
    let prev = null;
    for (const fr of frames) {
      if (!fr.mem) { prev = null; continue; }
      let st; try { st = V.stateAt(fr); } catch (e) { prev = null; continue; }
      counts.frames++;
      const p = (st.f25 & 0x40) || !st.drawn ? { error: 'skip' } : M.predict(H, HEROES.indexOf(key), { ...st, cam: { x: st.x - 256, y: st.d + st.h + 60 } }, cache);
      const cur = { f: fr.f, st, p };
      if (!p.error) {
        const fp = toId(p.info.frame), lp = p.info.legs ? toId(p.info.legs) : null;
        const ok = fp && hd.clips[fp.clip] && (!lp || hd.clips[lp.clip]);
        if (!ok) counts.skippedClip++;
        else {
          const wkey = st.weapon ? keyOfWeapon(st.weapon) : null;
          if (st.weapon && !wkey) counts.skippedOther++;
          else {
            const k = `${p.info.frame}|${p.info.legs || ''}|${st.face}|${wkey || ''}|${p.info.hold}`;
            const torchFlame = wkey === 'torch' && st.flame && prev && prev.f === fr.f - 1 && prev.p && !prev.p.error;
            if (!seen.has(k) || (torchFlame && !seen.has(k + '|fl'))) { seen.add(k); if (torchFlame) seen.add(k + '|fl'); cands.push({ cur, prev, fp, lp, wkey, torchFlame }); }
          }
        }
      }
      prev = cur;
    }
    counts.candidates += cands.length;
    // deterministic pick: torch-flame frames first, then split frames, then frames with a visible weapon, evenly spread
    const score = c => (c.torchFlame ? 4 : 0) + (c.lp ? 2 : 0) + (c.cur.p.info.weaponRec != null ? 1 : 0);
    const pick = [];
    for (const s of [7, 6, 5, 4, 3, 2, 1, 0]) { const grp = cands.filter(c => score(c) === s); if (!grp.length) continue; const need = PER_RUN - pick.length; if (need <= 0) break; const step = grp.length / Math.min(need, grp.length); for (let i = 0; i < Math.min(need, grp.length); i++) pick.push(grp[Math.floor(i * step)]); }
    pick.sort((a, b) => a.cur.f - b.cur.f);
    for (const c of pick) {
      const s = goldenSample({ key, run, c, M, H, renderRec, FLI });
      if (!s) { counts.skippedOther++; continue; }
      samples.push(s); counts.byHero[key] = (counts.byHero[key] || 0) + 1; if (c.wkey === 'torch') counts.torch++; if (s.flame) counts.flame++;
    }
    void kind; void hj;
  }
  M.setCull(true);
  log(`sprites heroes: golden from ${counts.runs} runs, ${counts.frames} frames, ${counts.candidates} distinct poses, ${samples.length} samples (${counts.flame} with a torch flame)`);
  return { v: 1, model: 'tools/re/export/lib/model.cjs predict()', md5: fam.build.md5, note: 'parts back->front [tag, rec, x, y] in native left-facing feet space; hash = FNV-1a over slot*16+pen (0xFFFF transparent) of the hero records only, row-major over box [x0, y0, x1, y1) in screen space relative to the feet for the sample facing; flame = KI6 truth from the RAM flame object', counts, samples };
}
function partsFromBlocks(blocks, feetX, feetY, mirror, M) {
  // consecutive blocks of one (tag, rec) are one part; OBJ list order = front -> back
  const parts = [];
  for (let i = 0; i < blocks.length;) {
    const b = blocks[i], rb = M.recBlocks(b.rec); let j = i; while (j < blocks.length && blocks[j].tag === b.tag && blocks[j].rec === b.rec && j - i < rb.length) j++;
    // origin of the record from its first emitted block (culling is off, so block 0 is present)
    const k0 = 0, L = rb[k0];
    const x = mirror ? -(b.sx + L.lx + 16 * L.bw - feetX) : b.sx - L.lx - feetX, y = b.sy - L.ly - feetY;
    // every block must agree
    for (let q = i; q < j; q++) { const L2 = rb[q - i], bb = blocks[q]; const x2 = mirror ? -(bb.sx + L2.lx + 16 * L2.bw - feetX) : bb.sx - L2.lx - feetX; if (x2 !== x || bb.sy - L2.ly - feetY !== y) return null; }
    parts.push([b.tag, b.rec, x, y]); i = j;
  }
  return parts.reverse();
}
function rasterHash(blocks, feetX, feetY, M, R) {
  const W = 512, Hh = 400, buf = new Uint16Array(W * Hh).fill(0xFFFF);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const o = blocks[i], fx = !!(o.attr & 0x20), fy = !!(o.attr & 0x40), pal = o.attr & 31;
    for (let r = 0; r < o.bh; r++) for (let c = 0; c < o.bw; c++) {
      const col = fx ? o.bw - 1 - c : c, row = fy ? o.bh - 1 - r : r;
      const t = R.tile((o.code & ~0xF) + ((o.code + col) & 0xF) + 0x10 * row);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const pen = t[(fy ? 15 - y : y) * 16 + (fx ? 15 - x : x)]; if (pen === 15) continue;
        const X = o.sx + c * 16 + x, Y = o.sy + r * 16 + y; if (X < 0 || Y < 0 || X >= W || Y >= Hh) throw new Error('golden raster out of range');
        buf[Y * W + X] = pal * 16 + pen;
      }
    }
  }
  let x0 = W, y0 = Hh, x1 = -1, y1 = -1;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (buf[y * W + x] !== 0xFFFF) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const codes = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) codes.push(buf[y * W + x]);
  return { box: [x0 - feetX, y0 - feetY, x1 + 1 - feetX, y1 + 1 - feetY], hash: fnv(codes).toString(16) };
}
function goldenSample({ key, run, c, M, H, renderRec, FLI }) {
  const R = require('../rom.cjs');
  const { st, p } = c.cur, mirror = !!st.face, [feetX, feetY] = p.feet;
  const parts = partsFromBlocks(p.blocks, feetX, feetY, mirror, M); if (!parts) return null;
  const heroBlocks = p.blocks.filter(b => b.tag !== 'weapon'), ras = rasterHash(heroBlocks, feetX, feetY, M, R); if (!ras) return null;
  void renderRec;
  const s = { run, f: c.cur.f, hero: key, face: st.face ? 1 : 0, weapon: c.wkey, slot: st.weapon ? st.weapon.slot : null, hold: p.info.hold == null ? null : p.info.hold,
    body: c.lp ? { torso: [c.fp.clip, c.fp.k], legs: [c.lp.clip, c.lp.k] } : { full: [c.fp.clip, c.fp.k] }, parts, box: ras.box, hash: ras.hash };
  if (p.info.bob) s.bob = p.info.bob;
  if (c.torchFlame) {
    // KI6 truth: the flame object in RAM at f (position, depth, frame), the torch one frame earlier
    const pv = c.prev, pst = pv.st, pp = pv.p, fl = st.flame, ff = FLI.get(fl.fp);
    if (pp.info.weaponAt && pp.info.weaponAnim >= 0 && ff && fl.drawn) {
      const pfp = toIdG(pp.info.frame), plp = pp.info.legs ? toIdG(pp.info.legs) : null;
      const tf = H.weaponSets[pst.weapon.set].anims[pp.info.weaponAnim].frames[0], e = H.companions.torchFlame.offsetTable.entries[tf.b5 >> 2];
      const tx = pst.x + pp.info.weaponAt[0], th = pst.h + pp.info.weaponAt[1], ex = tx + (pst.face ? -e.dx : e.dx), eh = th + e.dy;
      if (ex === fl.x && eh === fl.h) {
        const dd = fl.d - st.weapon.d, nx = st.face ? -(fl.x - st.x) : fl.x - st.x, ny = -(fl.h - st.h) - (fl.d - st.d);
        s.flame = { rec: ff.rec, chain: ff.chain, k: ff.k, dd, x: nx, y: ny, front: fl.d < st.d, flip: (!!fl.face) !== (!!st.face),
          prev: { body: plp ? { torso: [pfp.clip, pfp.k], legs: [plp.clip, plp.k] } : { full: [pfp.clip, pfp.k] }, x: pst.x, z: pst.h, face: pst.face ? 1 : 0 }, cur: { x: st.x, z: st.h }, weaponDepth: st.weapon.d - st.d };
      }
    }
  }
  return s;
}
const toIdG = s => { const m = /^(\w+):(\d+)\.(\d+)$/.exec(s); return m ? { clip: `${m[1]}:${m[2]}`, k: +m[3] } : null; };

module.exports = { build, COMPAT_FRAMES, COMPAT_LISTS, FIXED_ROLES, SPEC_ROLES, CLASSES, HEROES, encodeSpliceable, adler32 };

if (require.main === module) {
  const argv = process.argv.slice(2), outI = argv.indexOf('--out');
  const out = outI >= 0 ? path.resolve(argv[outI + 1]) : ROOT;
  const golden = argv.includes('golden') ? true : argv.includes('--no-golden') ? false : undefined;
  const t0 = Date.now();
  const r = build({ out, rgba: argv.includes('--rgba'), golden, log: (...a) => console.log(...a) });
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${r.files.map(rel).join(', ')}`);
}
