// Node-only data checks for the campaign text: CAMPAIGN.md §15.2 (1)–(8) plus the PLAN §6 WP-F anchors.
// Run from the repo root: node tests/campaign.cjs
// Inputs: campaign.js, mission-data.js, soundtrack-data.js (always); tools/re/levels/ch1..8.json (revision 3: eight stages) (the authored stage
// recipes, PLAN §4.2) when present, else the CAMPAIGN.md §12.2 EDEN_STAGES listing embedded below; stage-data.js when
// present; work/re/extract/stages/stages.json and work/re/extract/{enemies,bosses}/*.json when present (git-ignored
// ROM extracts; the checks that need them are reported as SKIP when they are absent).
// Flags: CAMPAIGN_STRICT=1 makes check (1) fail on any piece that straddles more than one floor run (default: WARN);
// CAMPAIGN_HP_GATE=1|0 forces check (8) to fail or only warn (default: fail on authored recipes, warn on the fallback).
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..'),rel=p=>path.join(ROOT,p),exists=p=>fs.existsSync(rel(p));
const STRICT=process.env.CAMPAIGN_STRICT==='1',HP_GATE=process.env.CAMPAIGN_HP_GATE;
fs.mkdirSync(rel('tests/results'),{recursive:true});

// ---------------------------------------------------------------- reporting
const rows=[];const row=(status,name,detail)=>{rows.push({status,name,detail});console.log(status.padEnd(5)+name+(detail?'  '+detail:''));};
const check=(name,ok,detail)=>row(ok?'PASS':'FAIL',name,ok?'':detail);
const warn=(name,detail)=>row('WARN',name,detail),skip=(name,detail)=>row('SKIP',name,detail);
const fmt=v=>JSON.stringify(v);

// ---------------------------------------------------------------- shipped data
const loadGlobals=file=>{const w={};vm.runInNewContext(fs.readFileSync(rel(file),'utf8'),{window:w},{filename:file});return w;};
const camp=loadGlobals('campaign.js'),miss=loadGlobals('mission-data.js'),snd=loadGlobals('soundtrack-data.js');
const CAMPAIGN=camp.EDEN_CAMPAIGN,INTRO=camp.EDEN_INTRO,ENDING=camp.EDEN_ENDING,MISSIONS=miss.EDEN_MISSIONS,SOUNDTRACK=snd.SOUNDTRACK;
const STAGE_DATA=exists('stage-data.js')?loadGlobals('stage-data.js').STAGE_DATA:null;

// ---------------------------------------------------------------- spec tables (CAMPAIGN.md §4.1, §4.4, §15.2 (7); ENEMIES.md §0, §2.6)
const KIND_IDS=['warden','thorne','truck','cinder','ironclub','glassback','echo','sable'];          // stage boss kinds (revision 3); CROWNBACK is 'fessenden'
const ENCOUNTERS=[12,12,13,12,12,13,12,13],LENGTHS=[7776,7840,6688,7776,6496,7776,6496,6496];
const CAST_IDS={ferris:'raider',gneiss:'raider',driver:'raider',blade:'knifer',razor:'knifer',knife:'knifer',poacherJ:'gunner',skinner:'gunner',gutter:'gunner',bomber:'gunner',dyna:'gunner',hammerT:'brute',blkElmer:'brute',wrenchT:'brute',naguri:'brute',lashT:'brute',bludge:'mutant',tyrog:'regent',ride:'biker',jump:'biker',hopper:'raptor',mirror:'mirror',militiaman:'militia',trapper:'trapper'};
const CHAPTER_POOLS=[   // game.js CAST_POOLS, stage order (harbor, swamp, causeway, sink, valley, biodome, observatory, dam)
 {raider:['ferris','gneiss'],knifer:['blade'],gunner:['poacherJ'],brute:['blkElmer','hammerT'],raptor:['hopper'],militia:['militiaman']},
 {raider:['ferris','gneiss'],knifer:['blade'],gunner:['poacherJ','skinner'],brute:['hammerT','lashT'],raptor:['hopper'],trapper:['trapper']},
 {raider:['driver','ferris'],knifer:['razor'],gunner:['dyna','skinner'],brute:['wrenchT','hammerT'],biker:['ride','jump']},
 {raider:['gneiss','driver'],knifer:['razor'],gunner:['bomber','gutter'],brute:['wrenchT','blkElmer'],mutant:['bludge'],regent:['tyrog']},
 {raider:['ferris','driver'],knifer:['blade','razor'],gunner:['poacherJ','skinner'],brute:['hammerT','blkElmer'],raptor:['hopper'],militia:['militiaman']},
 {raider:['gneiss','driver'],knifer:['blade','knife'],gunner:['skinner','gutter'],brute:['wrenchT','blkElmer'],mutant:['bludge'],regent:['tyrog'],raptor:['hopper'],trapper:['trapper'],hybrid:['enforcer']},
 {raider:['driver'],knifer:['razor','knife'],gunner:['gutter','bomber'],brute:['lashT','blkElmer'],mutant:['bludge'],regent:['tyrog'],militia:['militiaman'],hybrid:['enforcer']},
 {raider:['gneiss','driver'],knifer:['razor','blade'],gunner:['gutter','skinner'],brute:['blkElmer','hammerT'],mutant:['bludge'],regent:['tyrog'],militia:['militiaman'],hybrid:['enforcer']}];
// ROM type file and variant behind each cast id (enemies/<type>.json variants[].hp.byLevel; R HOPPER from bosses/dinonics.json).
const CAST_ROM={ferris:['chinpira','A'],gneiss:['chinpira','B'],driver:['chinpira','C'],blade:['knifeman','A'],razor:['knifeman','B'],knife:['knifeonly','A'],poacherJ:['mituryou','A'],skinner:['mituryou','B'],gutter:['mituryou','C'],bomber:['thurow','BOMB'],dyna:['thurow','DYNA'],hammerT:['hutori','A'],blkElmer:['hutori','B'],wrenchT:['hutori','C'],naguri:['naguri','A'],lashT:['ishinage','A'],bludge:['kameleon','A'],tyrog:['kingkimo','A'],ride:['bike','RIDE'],jump:['bike','JUMP'],hopper:['dinonics','R HOPPER']};
const MIRROR_HP=150;                                                                    // hero copies have no ROM body: today's BASE_HP.mirror
const LV=[9,10,10,11,12,12,13,14],HP_ROM=rom=>Math.round(40+0.9*rom);                 // ENEMIES.md §0 at CFG.difficulty.enemyHealth 1 (K.LV, eight stages)
const CURRENT_BUDGET=[5164,5638,4589,6043,6107,7339,6816,4998];                                   // revision 3 reference: the eight stages as authored (2026-10-24)
const HP_EXEMPT=[2];                                                                    // stage 3 (the causeway): bikers, the old chapter-2 exemption (PLAN RC7)
const BOSS_WINDOWS={E1a2:464,E2a2:0,E3a0:32752,E4a2:1136,E5a1:4544,E6a2:4096,E7a3:1264,E8a3:4384}; // original boss segment windows (source X from)
const FRAMING_CAM_Y={E1a0:256,E1a2:255,E2a0:64,E2a1:64,E5a0:512,E6a1:256,E8a1:768,E8a2:512,E8a3:256}; // §4.1 source framing; every other area 0
const FONT_GLYPHS=new Set([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?\'’“”-·/()']); // ROM_UI font coverage (PLAN §4.1 ui)
const RENDER_SUBST=[[/…/g,'...'],[/—/g,'-'],[/‘/g,'’']];                                // the renderer's substitutions before the font lookup
const render=s=>RENDER_SUBST.reduce((t,[re,to])=>t.replace(re,to),String(s).toUpperCase());

// ---------------------------------------------------------------- CAMPAIGN.md §12.2 EDEN_STAGES (the six-chapter fallback; stale since revision 3, used only without tools/re/levels/*.json)
// [src, x0, x1, flip?] slices; `same` copies another section's loop; lengths, locks and bossLock as in the spec.
const SPEC_STAGES={
 '1-1':{area:'a0',len:1344,locks:[640,960],s2:[['E4a0',352,864],['E1a2',176,464],['E4a0',352,864],['E4a0',352,384]]},
 '1-2':{area:'a0',len:1024,locks:[192,640],s2:[['E7a0',512,1024],['E7a0',512,1024,'flip']]},
 '1-3':{area:'a1',len:1024,locks:[192,640],s2:[['E4a2',0,512],['E4a2',0,512,'flip']]},
 '1-4':{area:'a1',len:1024,locks:[192,640],s2:[['E4a0',352,864,'flip'],['E7a0',512,1024]]},
 '1-5':{area:'a2',len:1024,locks:[192,640],s2:[['E1a0',928,1312],['E1a0',928,1312,'flip'],['E1a0',928,1184]]},
 '1-6':{area:'a2',len:1152,locks:[192],bossLock:768,s2:[['E1a2',176,464],['E4a0',352,864],['E4a0',512,864,'flip']]},
 '2-1':{area:'a0',len:1344,locks:[640,960],drive:true,loop:{src:'E3a0',x0:15872,period:3840}},
 '2-2':{area:'a0',len:1024,locks:[192,640],drive:true,same:'2-1'},
 '2-3':{area:'a0',len:1024,locks:[192,640],drive:true,same:'2-1'},
 '2-4':{area:'a1',len:1024,locks:[192,640],s2:[['E6a0',0,512],['E6a0',0,512,'flip']]},
 '2-5':{area:'a1',len:1024,locks:[192,640],s2:[['E5a0',1696,2208],['E6a0',864,1120],['E5a0',1696,1952,'flip']]},
 '2-6':{area:'a2',len:1152,locks:[192],bossLock:768,drive:true,same:'2-1'},
 '3-1':{area:'a0',len:1344,locks:[640,960],s2:[['E5a0',0,512],['E5a0',512,1024],['E5a0',0,320,'flip']]},
 '3-2':{area:'a0',len:1024,locks:[192,640],s2:[['E6a0',1216,1728],['E6a0',1216,1728,'flip']]},
 '3-3':{area:'a1',len:1024,locks:[192,640],s2:[['E2a0',256,768],['E2a0',256,768,'flip']]},
 '3-4':{area:'a1',len:1024,locks:[192,640],s2:[['E6a1',1792,2304],['E6a1',1792,2304,'flip']]},
 '3-5':{area:'a2',len:1024,locks:[192,640],s2:[['E2a1',1504,1856],['E2a1',2880,3328],['E2a1',1504,1728,'flip']]},
 '3-6':{area:'a2',len:1536,locks:[192,640],bossLock:1152,s2:[['E6a1',0,512],['E6a1',256,768,'flip'],['E6a1',2848,3168],['E6a1',2848,3040,'flip']]},
 '4-1':{area:'a0',len:1344,locks:[640,960],s2:[['E7a0',1792,2304],['E7a0',2560,2800],['E7a0',1792,2304,'flip'],['E8a1',2992,3072]]},
 '4-2':{area:'a0',len:1024,locks:[192,640],s2:[['E8a0',0,512],['E8a0',128,640]]},
 '4-3':{area:'a1',len:1024,locks:[192,640],s2:[['E8a1',2992,3392],['E8a2',1792,2416]]},
 '4-4':{area:'a1',len:1024,locks:[192,640],s2:[['E8a2',2304,2816],['E8a2',2816,3328]]},
 '4-5':{area:'a2',len:1024,locks:[192,640],s2:[['E8a3',3824,4272],['E8a3',4400,4784],['E8a3',3824,4016,'flip']]},
 '4-6':{area:'a2',len:1152,locks:[192],bossLock:768,s2:[['E8a1',1504,1664],['E8a2',1792,2304],['E8a2',2304,2784,'flip']]},
 '5-1':{area:'a0',len:1344,locks:[640,960],s2:[['E5a0',1696,2208],['E5a0',1696,2208,'flip'],['E5a0',1696,2016]]},
 '5-2':{area:'a1',len:1024,locks:[192,640],s2:[['E4a2',512,768],['E4a2',512,768,'flip'],['E7a2',336,848]]},
 '5-3':{area:'a1',len:1024,locks:[192,640],s2:[['E7a2',1360,1872],['E7a2',1360,1872,'flip']]},
 '5-4':{area:'a2',len:1024,locks:[192,640],s2:[['E8a0',896,1152],['E7a3',0,256],['E8a0',896,1152,'flip'],['E7a3',0,256,'flip']]},
 '5-5':{area:'a2',len:1024,locks:[192,640],s2:[['E7a3',0,512],['E7a3',0,512,'flip']]},
 '5-6':{area:'a2',len:1152,locks:[192],bossLock:768,s2:[['E8a0',896,1152],['E7a2',336,848,'flip'],['E4a2',512,768],['E4a2',512,640,'flip']]},
 '6-1':{area:'a0',len:1344,locks:[640,960],s2:[['E1a2',176,464],['E1a0',928,1312],['E1a2',176,464,'flip'],['E1a0',928,1312,'flip']]},
 '6-2':{area:'a0',len:1024,locks:[192,640],s2:[['E1a1',112,592],['E1a1',112,592,'flip'],['E1a1',112,176]]},
 '6-3':{area:'a1',len:1024,locks:[192,640],s2:[['E1a1',112,592,'flip'],['E6a0',1216,1728],['E1a1',112,144]]},
 '6-4':{area:'a1',len:1536,locks:[192,640,1152],s2:[['E6a0',1216,1728,'flip'],['E8a1',2992,3392],['E6a0',1216,1728],['E8a1',2992,3104]]},
 '6-5':{area:'a2',len:1024,locks:[192,640],s2:[['E8a2',2304,2816],['E8a2',2304,2816,'flip']]},
 '6-6':{area:'a2',len:1152,locks:[192],bossLock:768,s2:[['E1a1',112,432],['E8a1',1504,1664],['E8a1',1504,1664,'flip'],['E1a1',112,432,'flip'],['E8a1',2992,3184]]}};

// ---------------------------------------------------------------- recipe model: { id, area, len, locks[], bossLock, drive, loop, pieces[{src,x0,x1,at,w}], cast }
function modelFromSpec(){const out={};for(const [id,s] of Object.entries(SPEC_STAGES)){const base=s.same?SPEC_STAGES[s.same]:s;let at=0;const pieces=(base.s2||[]).map(p=>{const q={src:p[0],x0:p[1],x1:p[2],flip:p[3]==='flip',at,w:p[2]-p[1]};at+=q.w;return q;});out[id]={id,area:s.area,len:s.len,locks:s.locks.slice(),bossLock:s.bossLock??null,drive:!!s.drive,loop:base.loop?{src:base.loop.src,x0:base.loop.x0,x1:base.loop.x0+base.loop.period}:null,pieces,cast:null};}return out;}
function modelFromRecipes(){const out={};for(let n=1;n<=8;n++){const r=JSON.parse(fs.readFileSync(rel(`tools/re/levels/ch${n}.json`),'utf8'));
 for(const area of r.areas||[]){const areaPieces=[];for(const p of area.s2||[]){if(!p.slice)continue;const sl=p.slice,src=sl.src||('E'+sl.ep+'a'+sl.area),[x0,x1]=sl.x,at=(p.at||[0,0])[0];areaPieces.push({src,x0,x1,flip:!!(p.flip||p.mirror),at,w:x1-x0});}
  const loop=area.loop&&!area.paint?{src:area.loop.src||('E'+area.loop.ep+'a'+area.loop.area),x0:area.loop.x0,x1:area.loop.x0+area.loop.period}:null;
  for(const s of area.sections||[]){const x0=s.x0,len=s.len,pieces=areaPieces.filter(p=>p.at<x0+len&&p.at+p.w>x0).map(p=>({...p,at:p.at-x0}));
   out[s.id]={id:s.id,area:area.id,len,locks:(s.locks||[]).map(x=>x-x0),bossLock:s.bossLock==null?null:s.bossLock-x0,drive:!!(s.drive||area.drive),loop:pieces.length?null:loop,pieces,paint:!!area.paint,cast:s.cast||area.cast||null,source:r.id};}}}
 return out;}
const haveRecipes=[1,2,3,4,5,6,7,8].every(n=>exists(`tools/re/levels/ch${n}.json`));
let STAGES,stageSource;
try{STAGES=haveRecipes?modelFromRecipes():modelFromSpec();stageSource=haveRecipes?'tools/re/levels/ch1..8.json':'CAMPAIGN.md §12.2 fallback (tools/re/levels/*.json not found)';}
catch(e){STAGES=modelFromSpec();stageSource='CAMPAIGN.md §12.2 fallback';check('Stage recipes parse (PLAN §4.2 shape)',false,e.message);}
console.log('stage recipes: '+stageSource);

// ---------------------------------------------------------------- extracts (optional)
const STAGES_JSON=exists('work/re/extract/stages/stages.json')?JSON.parse(fs.readFileSync(rel('work/re/extract/stages/stages.json'),'utf8')):null;
const AREAS={};if(STAGES_JSON)for(const ep of STAGES_JSON.episodes)for(const ar of ep.areas)AREAS['E'+ep.ep+'a'+ar.area]=ar;
const ENEMY_DIR='work/re/extract/enemies',BOSS_DIR='work/re/extract/bosses';
const haveEnemies=exists(ENEMY_DIR+'/chinpira.json')&&exists(BOSS_DIR+'/dinonics.json');
const romJson=f=>JSON.parse(fs.readFileSync(rel(f),'utf8'));

// ================================================================ 0. PLAN §6 WP-F anchors
const waves=ch=>ch.sections.flatMap(s=>s.enc.flatMap(e=>e.w||[]));
const countKind=(ch,k)=>waves(ch).flat().filter(t=>t===k).length;
const encCount=ch=>ch.sections.reduce((n,s)=>n+s.enc.length,0);
check('Eight stages of six sections',CAMPAIGN.length===8&&CAMPAIGN.every(c=>c.sections.length===6));
check('Kind ids are warden, thorne, truck, cinder, ironclub, glassback, echo, sable',CAMPAIGN.map(c=>c.kind).join()===KIND_IDS.join(),CAMPAIGN.map(c=>c.kind).join());
check('Encounters 12/12/13/12/12/13/12/13',CAMPAIGN.map(encCount).join('/')===ENCOUNTERS.join('/'),CAMPAIGN.map(encCount).join('/'));
// revision 3: every stage carries 45-70 regular wave slots (the dam's waves are the smallest: clear, readable fights)
{const slots=CAMPAIGN.map(c=>waves(c).flat().length);check('Every stage has 45-70 regular wave slots and the dam has the fewest per wave',slots.every(n=>n>=45&&n<=70)&&(()=>{const per=CAMPAIGN.map(c=>waves(c).flat().length/waves(c).length);return per[7]<=Math.min(...per.slice(0,7));})(),slots.join('/'));}
// STORY.md rule 8: human gangs dominate the first half, the experiments come in the second; dinosaurs are animals
// graft subjects: the old GRAFT (mutant) or Echo's volunteers, the Hybrid Enforcer
const grafts=c=>countKind(c,'mutant')+countKind(c,'hybrid');
check('Stages 1-3 and 5 are human gangs and animals (no graft subject, no TYROG); stages 6-8 carry graft subjects',[0,1,2,4].every(i=>grafts(CAMPAIGN[i])+countKind(CAMPAIGN[i],'regent')===0)&&[5,6,7].every(i=>grafts(CAMPAIGN[i])>=3),CAMPAIGN.map(grafts).join('/'));
check('Stage 3 S1 e1 wave 1 is biker, biker',fmt(CAMPAIGN[2].sections[0].enc[0].w[0])==='["biker","biker"]');
check('Stage 1 brief mentions Fessenden and the lab',/Fessenden/.test(CAMPAIGN[0].brief)&&/laborator/.test(CAMPAIGN[0].brief));
// revision 3 (work/story3/STORYLINE.md): the finale is Marshal Sable on the Crown dam, who takes the unfinished treatment
// and becomes CROWNBACK and falls into the discharge works; the four heroes then save the valley together.
check('Stage 8 is the Crown dam: brief names Sable and the unfinished treatment, end names Crownback and the discharge works, the final form is CROWNBACK',/CROWN DAM/.test(CAMPAIGN[7].name)&&/Sable/.test(CAMPAIGN[7].brief)&&/treatment/.test(CAMPAIGN[7].brief)&&/Crownback/.test(CAMPAIGN[7].end)&&/discharge works/.test(CAMPAIGN[7].end)&&/CROWNBACK/.test(CAMPAIGN[7].lastCopy.card));
{const all=JSON.stringify([CAMPAIGN,INTRO,ENDING,MISSIONS]);
 check('No campaign text resurrects Fessenden (no LOT 00, no Mirror War or clone war, no FESSENDEN speaker or portrait)',!/LOT 00|MIRROR WAR|CLONE WAR|FESSENDEN:/i.test(all)&&!ENDING.some(b=>b.who==='fessenden'||(b.boxes||[]).some(x=>x.who==='fessenden')),(all.match(/LOT 00|MIRROR WAR|CLONE WAR|FESSENDEN:/i)||[''])[0]);
 check('Revision 3 drops the old devices: no mirror test, clones, collar pylons, conscripts, command signal, spillway or drowned coast',!/MIRROR TEST|CLONE|PYLON|CONSCRIPT|COMMAND SIGNAL|SPILLWAY|DROWNED HALF|HALF THE COAST/i.test(all),(all.match(/MIRROR TEST|CLONE|PYLON|CONSCRIPT|COMMAND SIGNAL|SPILLWAY|DROWNED HALF|HALF THE COAST/i)||[''])[0]);
 check('Each stage end sets up the next place: swamp (1), causeway (2), laboratory ruins (3), Crown dam (4), Biodome (5), observatory (6), the gates (7)',/swamp/.test(CAMPAIGN[0].end)&&/causeway/.test(CAMPAIGN[1].end)&&/laboratory ruins/.test(CAMPAIGN[2].end)&&/Crown dam/.test(CAMPAIGN[3].end)&&/Biodome/.test(CAMPAIGN[4].end)&&/observatory/.test(CAMPAIGN[5].end)&&/gates/.test(CAMPAIGN[6].end));
 check('The ending carries the road gag (“It was here first.”) and the final card THE ROAD GOES ON',/IT WAS HERE FIRST/.test(ENDING.flatMap(b=>(b.boxes||[]).flatMap(x=>x.lines)).join(' '))&&fmt((ENDING.find(b=>b.beat==='thanks')||{}).lines)===fmt(['THE ROAD GOES ON','THANK YOU FOR PLAYING','A FAN SEQUEL MADE FOR MOSTAFA']));}
// STORY.md rule 6 (no clones): the 'mirror' kind is out of the campaign
{const uses=[];CAMPAIGN.forEach((c,i)=>c.sections.forEach(s=>s.enc.forEach(e=>{(e.w||[]).flat().forEach(k=>{if(String(k).split(':')[0]==='mirror')uses.push(`${s.stage} wave`);});if(e.elite&&e.elite.type==='mirror')uses.push(`${s.stage} elite ${e.elite.name}`);})));
 check('No mirror: no hero copy anywhere in the campaign',uses.length===0,uses.join(', '));}
check('Stage endings 1–7 set up the next stage (> 120 characters)',CAMPAIGN.slice(0,7).every(c=>c.end.length>120));
check('No task frees conscripts (no allies fight beside the gang in revision 3)',MISSIONS.every(m=>m.tasks.every(t=>!t[4])));
check('Stage 1 music: 06 first, intro 09, boss 10',CAMPAIGN[0].music.stage[0]==='06'&&CAMPAIGN[0].music.intro==='09'&&CAMPAIGN[0].music.boss==='10');
check('Every stage has one elite and ends with the boss',CAMPAIGN.every(c=>{const encs=c.sections.flatMap(s=>s.enc);return encs.filter(e=>e.elite).length>=1&&encs[encs.length-1].boss===true&&encs.slice(0,-1).every(e=>!e.boss);}));
check('Tasks 0, 1 and 2 appear once per stage and the missions have three tasks each',CAMPAIGN.every((c,i)=>{const t=c.sections.flatMap(s=>s.enc).map(e=>e.task).filter(x=>x!==undefined).sort();return t.join()==='0,1,2'&&MISSIONS[i].tasks.length===3;})&&MISSIONS.length===8);
check('Objectives: barge locks (1), restraint gear wrecked (2), cargo (3), winches (4), barriers (5), feeds (6), relay masts wrecked (7), the gatehouse controls (8)',fmt(MISSIONS.map(m=>m.tasks.map(t=>t[0]).join('+')))===fmt(['gate+gate+gate','beacon+beacon+beacon','cargo+cargo+gate','valve+valve+valve','gate+gate+gate','valve+valve+valve','beacon+beacon+beacon','gate+gate+gate']),fmt(MISSIONS.map(m=>m.title)));
check('Every section names its stage recipe and stage 3 drives S1–S3 only (S4–S6 on foot to Krag)',CAMPAIGN.every(c=>c.sections.every(s=>typeof s.stage==='string'))&&fmt(CAMPAIGN[2].sections.map(s=>!!s.drive))==='[true,true,true,false,false,false]'&&CAMPAIGN.every((c,i)=>i===2||c.sections.every(s=>!s.drive)));
check('The after line is on the encounter and inside the elite (D13)',CAMPAIGN.every(c=>c.sections.every(s=>s.enc.every(e=>!e.elite||!e.elite.after||e.after===e.elite.after))));
check('Boss text is data on every stage (bossCard, bossToast, bossSay, bossLines, and bossDefeat, driverDeadSay or lastCopy)',CAMPAIGN.every(c=>c.bossCard&&c.bossToast&&Array.isArray(c.bossSay)&&c.bossSay.length&&c.bossLines&&(c.bossDefeat||c.driverDeadSay||c.lastCopy)));
check('Stage 2 (Thorne) carries her winch line; stage 8 carries releaseSay and lastCopy with a line per hero, and no gate-controls phase',(()=>{const t=CAMPAIGN[1],c=CAMPAIGN[7];return t.driverDeadSay&&t.bossDefeat&&!c.phase2&&!c.gateSay&&!c.spillwaySay&&c.releaseSay&&c.lastCopy&&c.lastCopy.card&&c.lastCopy.toast&&c.lastCopy.say.length===2&&['mustapha','jack','hannah','mess'].every(h=>c.lastCopy.byHero[h])&&['p66','p33','p20','defeat','after'].every(k=>c.lastCopy.lines[k]);})());
check('Attract story (STORYLINE §5) has six panels and the ending has the eight beats with all four heroes in the roles',INTRO.length===6&&/SAME CAGES/.test(INTRO.flatMap(p=>p.lines).join(' '))&&fmt(ENDING.map(b=>b.beat))==='["fall","alarm","roles","run","board","dawn","road","thanks"]'&&fmt(ENDING[2].boxes.map(x=>x.who).sort())==='["hannah","jack","mess","mustapha"]');
check('Every stage names an objPage, a card marker and intermission panels',CAMPAIGN.every(c=>/^S\dA\d$/.test(c.objPage)&&c.card&&c.card.marker&&Array.isArray(c.inter)&&c.inter.length>=3));

// ================================================================ 1. source ranges lie on flat full-band floor runs (stages.json floorRuns)
const touched=(ar,x0,x1)=>ar.floorRuns.filter(r=>r.x1>x0&&r.x0<x1);
if(!STAGES_JSON)skip('(1) Floor runs: work/re/extract/stages/stages.json is not present');
else{let bad=[],straddle=[],framing=[],n=0;const seen=new Set();
 for(const s of Object.values(STAGES)){const list=s.loop?[{src:s.loop.src,x0:s.loop.x0,x1:s.loop.x1}]:s.pieces;
  for(const p of list){n++;const ar=AREAS[p.src];const tag=`${s.id} ${p.src} ${p.x0}-${p.x1}`;if(!ar){bad.push(tag+': no such area');continue;}
   const [wx0,wx1]=ar.world.x,[wh0,wh1]=ar.world.h,camY=FRAMING_CAM_Y[p.src]||0;
   if(p.x0<wx0||p.x1>wx1){bad.push(tag+`: outside the area rect ${wx0}-${wx1}`);continue;}
   if(wh1-wh0<224){bad.push(tag+`: the area is only ${wh1-wh0} rows tall`);continue;}
   const runs=touched(ar,p.x0,p.x1),len=p.x1-p.x0;if(!runs.length){bad.push(tag+': no floor run');continue;}
   if(runs.some(r=>r.raised)){bad.push(tag+': touches a raised run');continue;}
   const cover=new Map();let nullTotal=0,nullMax=0;
   for(const r of runs){const c=Math.min(r.x1,p.x1)-Math.max(r.x0,p.x0);if(!r.floor){nullTotal+=c;nullMax=Math.max(nullMax,c);continue;}const k=fmt(r.floor);cover.set(k,(cover.get(k)||0)+c);}
   const [band,covered]=[...cover.entries()].sort((a,b)=>b[1]-a[1])[0]||[null,0];const floor=band&&JSON.parse(band);
   if(!band||covered/len<0.5){bad.push(tag+`: no single floor band covers half of the piece (${fmt([...cover.entries()])}, null ${nullTotal})`);continue;}
   if(floor[1]-floor[0]<16){bad.push(tag+`: floor band ${band} is under 16 rows`);continue;}
   if(nullMax>64||nullTotal/len>0.5){bad.push(tag+`: null floor ${nullTotal} px (longest ${nullMax})`);continue;}
   // The §4.1 framing puts the screen clamp (feet rows 81–224) at h [camY+16, camY+159]; the floor band must sit inside it or cover it.
   const lo=Math.max(camY+16,floor[0]),hi=Math.min(camY+159,floor[1]);
   if(hi-lo<Math.min(143,floor[1]-floor[0])){const key=p.src+' '+p.x0;if(!seen.has(key)){seen.add(key);framing.push(`${p.src} ${p.x0}-${p.x1}: floor ${band} vs §4.1 camY ${camY}; frame it at camY ${Math.max(floor[1]-159,wh0-16)}..${Math.min(floor[0]-16,wh1-240)} (h [${floor[0]},${floor[0]+224}])`);}}
   if(runs.length>1)straddle.push(tag+': runs '+runs.map(r=>`${r.x0}-${r.x1}:${fmt(r.floor)}`).join(' '));}}
 check(`(1) Every source range lies inside its area on a walkable floor band (${n} pieces)`,bad.length===0,bad.join(' | '));
 if(framing.length)warn(`(1) ${framing.length} source ranges need their own h framing (the §4.1 camY does not hold where the original floor descends)`,framing.join(' | '));
 if(straddle.length){if(STRICT)check('(1) strict: every piece lies inside one floor run',false,straddle.join(' | '));else warn(`(1) ${straddle.length} pieces straddle more than one floor run (doorway or ramp columns; the builder patches or trims them, KI1; CAMPAIGN_STRICT=1 fails them)`,straddle.join(' | '));}
 else check('(1) strict: every piece lies inside one floor run',true);}

// ================================================================ 2. widths, locks, lengths
{let bad=[];const perChapter=CAMPAIGN.map((c,i)=>{let len=0,locks=0;for(const s of c.sections){const st=STAGES[s.stage];if(!st){bad.push(`${s.stage}: no recipe`);continue;}len+=st.len;locks+=st.locks.length+(st.bossLock!=null?1:0);
  // painted areas (work/story3/PAINT-FORMAT.md) have no ROM slices: their strips overlap and tile the area, gate 1 of
  // levels-validate.cjs (paintSeams) checks their coverage instead
  if(!st.loop&&!st.paint){const sum=st.pieces.reduce((n,p)=>n+p.w,0);if(sum!==st.len)bad.push(`${s.stage}: pieces sum to ${sum}, len ${st.len}`);}
  const n=s.enc.length,l=st.locks.length+(st.bossLock!=null?1:0);if(l!==n)bad.push(`${s.stage}: ${l} locks for ${n} encounters`);
  if(s.enc.some(e=>e.boss)!==(st.bossLock!=null))bad.push(`${s.stage}: boss lock and boss encounter disagree`);
  if(!!s.drive!==!!st.drive)bad.push(`${s.stage}: drive flag differs between campaign and recipe`);}
  return {len,locks};});
 check('(2) Σ piece widths = len and lock count = encounter count in every section',bad.length===0,bad.join(' | '));
 check('(2) Stage lengths 7776/7840/6688/7776/6496/7776/6496/6496 (> 6000)',fmt(perChapter.map(c=>c.len))===fmt(LENGTHS)&&perChapter.every(c=>c.len>6000),fmt(perChapter.map(c=>c.len)));
 check('(2) Stage lock counts 12/12/13/12/12/13/12/13',fmt(perChapter.map(c=>c.locks))===fmt(ENCOUNTERS),fmt(perChapter.map(c=>c.locks)));}

// ================================================================ 3. cast ids, elite variants and palettes
{let bad=[];for(const [i,c] of CAMPAIGN.entries()){const kinds=new Set(waves(c).flat());for(const k of kinds)if(!(CHAPTER_POOLS[i][k]||[]).length)bad.push(`ch${i+1}: no §4.4 pool for kind ${k}`);
  for(const s of c.sections){const st=STAGES[s.stage];if(st&&st.cast)for(const [k,pool] of Object.entries(st.cast))for(const id of [].concat(pool))if(CAST_IDS[id]!==k)bad.push(`${s.stage}: cast ${k} has ${id}`);
   for(const e of s.enc){if(!e.elite)continue;const el=e.elite;if(!(el.type in CHAPTER_POOLS[i])&&el.type!=='mirror')bad.push(`${s.stage}: elite type ${el.type}`);
    if(el.variant&&CAST_IDS[el.variant]!==el.type)bad.push(`${s.stage}: elite variant ${el.variant} is not a ${el.type}`);
    if(el.type==='mirror'&&!(el.hero>=0&&el.hero<=2))bad.push(`${s.stage}: mirror hero offset ${el.hero}`);
    if(typeof el.hp!=='number'||el.scale!==undefined)bad.push(`${s.stage}: elite needs hp and no scale`);}}}
 check('(3) Every cast id and elite variant is a §4.4 id and every wave kind has a variant pool',bad.length===0,bad.join(' | '));
 const palettes=CAMPAIGN.flatMap(c=>c.sections.flatMap(s=>s.enc.filter(e=>e.elite&&e.elite.palette).map(e=>[s.stage,e.elite.palette])));
 if(!exists(ENEMY_DIR)||!exists(BOSS_DIR))skip('(3) Elite palette contexts: the enemy/boss extracts are not present',palettes.map(p=>p[1]).join(', '));
 else{const ctx=new Set();for(const f of fs.readdirSync(rel(BOSS_DIR))){const m=/-(t[0-9a-f]+-e\da\d(?:-pal\d+)?)-atlas\.json$/.exec(f);if(m)ctx.add(m[1]);}
  for(const f of fs.readdirSync(rel(ENEMY_DIR))){const m=/^([a-z]+)-([a-z0-9]+)-s(\d)a(\d)-p(\d+)\.atlas\.json$/.exec(f);if(!m)continue;try{const t=romJson(`${ENEMY_DIR}/${m[1]}.json`);ctx.add(`t${parseInt(t.objType,16).toString(16)}-e${m[3]}a${m[4]}-pal${m[5]}`);}catch{}}
  const missing=palettes.filter(([,p])=>!ctx.has(p));check('(3) Every elite palette is an extracted atlas context',missing.length===0,missing.map(m=>m.join(':')).join(', ')+` (known: ${[...ctx].filter(c=>/^t(74|10)-/.test(c)).join(' ')})`);}}

// ================================================================ 4. line limits and font coverage
{const radio=[],panels=[];const push=(where,s)=>{if(s!=null)radio.push([where,String(s)]);};
 CAMPAIGN.forEach((c,i)=>{const ch=`ch${i+1}`;c.dialog.split('\n').forEach(l=>push(ch+' dialog',l));(c.bossSay||[]).forEach(l=>push(ch+' bossSay',l));Object.values(c.bossLines||{}).forEach(l=>push(ch+' bossLines',l));
  ['bossDefeat','driverDeadSay','gateSay','spillwaySay','releaseSay','bossTaunt'].forEach(k=>push(ch+' '+k,c[k]));if(c.phase2){push(ch+' phase2.say',c.phase2.say);push(ch+' phase2.defeat',c.phase2.defeat);Object.values(c.phase2.lines||{}).forEach(l=>push(ch+' phase2.lines',l));}
  if(c.lastCopy){c.lastCopy.say.forEach(l=>push(ch+' lastCopy.say',l));Object.values(c.lastCopy.byHero).forEach(l=>push(ch+' lastCopy.byHero',l));Object.values(c.lastCopy.lines).forEach(l=>push(ch+' lastCopy.lines',l));}
  c.sections.forEach(s=>{push(s.stage+' say',s.say);s.enc.forEach(e=>{push(s.stage+' enc.say',e.say);push(s.stage+' after',e.after);if(e.elite)push(s.stage+' elite.after',e.elite.after);});});
  c.inter.forEach((p,k)=>panels.push([`${ch} inter[${k}]`,p]));});
 MISSIONS.forEach((m,i)=>m.tasks.forEach(t=>push(`ch${i+1} task`,t[3])));
 INTRO.forEach((p,k)=>panels.push([`intro[${k}]`,p]));ENDING.forEach((b,k)=>{if(b.lines)panels.push([`ending[${k}]`,b]);(b.boxes||[]).forEach((x,j)=>panels.push([`ending[${k}].boxes[${j}]`,x]));if(b.caption)panels.push([`ending[${k}].caption`,{lines:[b.caption]}]);});
 const over=radio.filter(([,l])=>l.length>72||render(l).length>72);
 check(`(4) Every radio, task and dialog line is ≤ 72 characters (${radio.length} lines, raw and rendered)`,over.length===0,over.map(([w,l])=>`${w}: ${l.length}`).join(', '));
 const badPanels=[];for(const [w,p] of panels){const lines=[...(p.lines||[]),...(p.lines2||[])];if(!lines.length)badPanels.push(w+': empty');if((p.lines||[]).length>4||(p.lines2||[]).length>4)badPanels.push(w+': over 4 lines');for(const l of lines)if(l.length>30)badPanels.push(`${w}: ${l.length} chars`);
  if(p.layout&&!['A','B','C'].includes(p.layout))badPanels.push(w+': layout '+p.layout);if(p.layout==='B'&&!p.who)badPanels.push(w+': layout B needs who');/* 'sable' and 'echo' are name tags (ARCADE_UI.drawPortrait: any other who is a name tag); story 2's fall beat is Sable's and its choice beat is 'self' (the selected hero) */if(p.who&&!['jack','hannah','mustapha','mess','self','sable','echo','driver'].includes(p.who))badPanels.push(w+': who '+p.who);}
 check(`(4) Every panel line is ≤ 30 characters with ≤ 4 lines per panel (${panels.length} panels)`,badPanels.length===0,badPanels.join(', '));
 const glyphs=new Map();for(const [w,l] of [...radio,...panels.flatMap(([w,p])=>[...(p.lines||[]),...(p.lines2||[])].map(l=>[w,l]))])for(const ch of render(l))if(!FONT_GLYPHS.has(ch))glyphs.set(ch,w);
 check('(4) Every rendered character is in the ROM font set (… → ..., — → -)',glyphs.size===0,[...glyphs].map(([g,w])=>`${fmt(g)} in ${w}`).join(', '));
 const tags=new Set();for(const [,l] of radio){const m=/^([A-Z?][A-Z ?.'’]*):/.exec(l);if(m)tags.add(m[1]);}
 // Story 2 adds CONSCRIPT (a freed collared dam worker at the Crown), KRAG and THORNE (the chapter 2 and 3 bosses since the boss rebuild,
 // a name tag like ROOK and CINDER); the old tags stay allowed.
 // revision 3 adds IRONCLUB (the stage 5 boss)
 const known=['JACK','HANNAH','MUSTAPHA','MESS','FESSENDEN','ECHO','ROOK','KRAG','THORNE','CINDER','IRONCLUB','SLICE','SABLE','HANDLER','???','YOUR CLONE','FREED CLONE','CONSCRIPT'];
 check('(4) Every speaker tag is a portrait name or a known name tag',[...tags].every(t=>known.includes(t)),[...tags].filter(t=>!known.includes(t)).join(', '));}

// ================================================================ 5. music cues
{const ids=new Set(SOUNDTRACK.map(t=>t.id));const bad=[];CAMPAIGN.forEach((c,i)=>{const m=c.music||{};if(!Array.isArray(m.stage)||m.stage.length!==6)bad.push(`ch${i+1}: stage cues ${fmt(m.stage)}`);
 for(const id of [...(m.stage||[]),m.intro,m.boss,m.engine,m.lastCopy].filter(x=>x!==undefined))if(!ids.has(id))bad.push(`ch${i+1}: cue ${id} not in SOUNDTRACK`);if(!m.intro||!m.boss)bad.push(`ch${i+1}: intro/boss cue missing`);});
 if(!CAMPAIGN[7].music.lastCopy)bad.push('ch8: lastCopy cue missing');
 check('(5) music.stage has six cues per stage and every cue id exists in SOUNDTRACK',bad.length===0,bad.join(', '));}

// ================================================================ 6. area captions
{const bad=[];for(const [i,c] of CAMPAIGN.entries()){let prev=null;for(const s of c.sections){const st=STAGES[s.stage];if(!st)continue;const first=st.area!==prev;prev=st.area;
  if(first&&!s.cap)bad.push(`${s.stage}: first section of ${st.area} has no cap`);if(!first&&s.cap)bad.push(`${s.stage}: cap on a later section of ${st.area}`);}
  const areas=[...new Set(c.sections.map(s=>STAGES[s.stage]?.area))];if(areas.length!==3)bad.push(`ch${i+1}: ${areas.length} areas`);}
 check('(6) Each cap sits on the first section of its area and every stage has three areas',bad.length===0,bad.join(', '));}

// ================================================================ 7. boss locks never come from an original boss window
{const bad=[];for(const s of Object.values(STAGES)){if(s.bossLock==null)continue;const list=s.loop?[{src:s.loop.src,x0:s.loop.x0,x1:s.loop.x1,at:0,w:s.len}]:s.pieces.filter(p=>p.at<s.len&&p.at+p.w>s.bossLock);
  for(const p of list){const from=BOSS_WINDOWS[p.src];if(from!==undefined&&p.x1>from)bad.push(`${s.id}: ${p.src} ${p.x0}-${p.x1} overlaps the original boss window from ${from}`);}}
 check('(7) No boss lock is sourced from an original boss window',bad.length===0,bad.join(' | '));}

// ================================================================ 8. ROM-affine HP budget per chapter (ENEMIES.md §2.6, ±15%)
if(!haveEnemies)skip('(8) HP budget: the enemy extracts are not present');
else{const rom={},GEN={militiaman:'militia',trapper:'trapper',enforcer:'hybrid'},genHp=t=>{const w=loadGlobals(`sprite-data-enemy-${t}.js`);return w.SPRITE_DATA.families[Object.keys(w.SPRITE_DATA.families)[0]].types[t].variants.A.hp;},
  // the revision-3 generated kinds have no ROM extract: their level table ships in sprite-data-enemy-<type>.js
  hpOf=id=>{if(id==='mirror')return null;if(GEN[id])return rom[GEN[id]]||(rom[GEN[id]]=genHp(GEN[id]));const [t,v]=CAST_ROM[id];if(!rom[t])rom[t]=romJson(t==='dinonics'?`${BOSS_DIR}/dinonics.json`:`${ENEMY_DIR}/${t}.json`);
  if(t==='dinonics')return rom[t].hp.regular.find(r=>r.name===v).byRank;return rom[t].variants.find(x=>x.id===v).hp.byLevel;};
 const budgets=CAMPAIGN.map((c,i)=>{let sum=0;const mix={};for(const s of c.sections){const st=STAGES[s.stage],pools={...CHAPTER_POOLS[i],...(st&&st.cast||{})};
   for(const e of s.enc)(e.w||[]).forEach((w,wi)=>w.forEach((kind,j)=>{const pool=[].concat(pools[kind]||[]);const id=pool.length?pool[(wi+j)%pool.length]:kind;const tbl=hpOf(id);sum+=tbl?HP_ROM(tbl[LV[i]]):MIRROR_HP;mix[id]=(mix[id]||0)+1;}));}
  return {budget:sum,current:CURRENT_BUDGET[i],ratio:+(sum/CURRENT_BUDGET[i]).toFixed(3),mix};});
 budgets.forEach((b,i)=>console.log(`      ch${i+1} ROM-affine ${b.budget} vs current ${b.current} ratio ${b.ratio}${HP_EXEMPT.includes(i)?' (exempt)':''} ${fmt(b.mix)}`));
 const out=budgets.map((b,i)=>[i,b]).filter(([i,b])=>!HP_EXEMPT.includes(i)&&Math.abs(b.ratio-1)>0.15).map(([i,b])=>`ch${i+1} ${b.ratio}`);
 const hard=HP_GATE==='1'||(HP_GATE!=='0'&&haveRecipes);
 if(out.length===0)check('(8) Regular HP budget within ±15% of the revision-3 reference (stage 3 exempt: the bikers)',true);
 else if(hard)check('(8) Regular HP budget within ±15% of the revision-3 reference (stage 3 exempt: the bikers)',false,out.join(', ')+'; lever: lighter section casts (A variants) in the recipes or wave trims (PLAN §8.2)');
 else warn('(8) Regular HP budget outside ±15% on the §4.4 default pools: '+out.join(', '),'gate once tools/re/levels/*.json carries section casts (CAMPAIGN_HP_GATE=1 forces it)');
 fs.writeFileSync(rel('tests/results/campaign-budget.json'),JSON.stringify(budgets,null,1));}

// ================================================================ stage-data.js consistency (once WP-E lands)
if(!STAGE_DATA)skip('stage-data.js is not present: section keys are checked against the recipes only');
else{const bad=[];for(const c of CAMPAIGN)for(const s of c.sections){const sec=STAGE_DATA.sections&&STAGE_DATA.sections[s.stage];if(!sec){bad.push(s.stage+': missing');continue;}
  const ch=STAGE_DATA.chapters[sec.chapter],area=ch&&ch.areas[sec.area],def=area&&(area.sections||[]).find(x=>x.id===s.stage);if(!def){bad.push(s.stage+': no section entry');continue;}
  const locks=(def.locks||[]).length+(def.bossLock!=null?1:0);if(locks!==s.enc.length)bad.push(`${s.stage}: ${locks} locks for ${s.enc.length} encounters`);}
 check('stage-data.js has every campaign stage key with lock count = encounter count',bad.length===0,bad.join(', '));}

// ================================================================ G6: the game reads the campaign data (PLAN §7 G6)
{const game=exists('game.js')?fs.readFileSync(rel('game.js'),'utf8'):'';
 // CAMPAIGN §12.5: every line the game says comes from campaign.js / mission-data.js; no speaker-tagged literal is left in game.js
 const literals=[...game.matchAll(/(['"`])((?:JACK|HANNAH|MUSTAPHA|MESS|FESSENDEN|ECHO|ROOK|CINDER|SLICE|SABLE|HANDLER|YOUR CLONE|FREED CLONE|\?\?\?): [^'"`]*)\1/g)].map(m=>m[2]);
 check('game.js says no hard-coded radio line (CAMPAIGN §12.5: lines are data)',game&&literals.length===0,literals.slice(0,3).join(' | '));
 check('game.js takes its music from level.music (no STAGE_TRACKS / BOSS_TRACKS tables)',game&&/level\.music/.test(game)&&!/STAGE_TRACKS|BOSS_TRACKS/.test(game));
 check('No "jungle lab" is left in game.js (CAMPAIGN §12.6: the Under World beneath the City in the Sea)',game&&!/jungle (lab|laboratory)/i.test(game));
 check('game.js wires the presentation: EDEN_INTRO, EDEN_ENDING, inter[], card, cap, ARCADE_UI',game&&['EDEN_INTRO','EDEN_ENDING','level.inter','level.card','s.cap','ARCADE_UI'].every(k=>game.includes(k)));}
{// every intermission, attract and ending picture is a STAGE_DATA picture whose PNG ships (WP-E)
 const pics=new Set();CAMPAIGN.forEach(c=>(c.inter||[]).forEach(p=>p.pic&&pics.add(p.pic)));INTRO.forEach(p=>p.pic&&pics.add(p.pic));ENDING.forEach(b=>b.pic&&pics.add(b.pic));
 if(!STAGE_DATA)skip('Pictures: stage-data.js is not present');
 else{const bad=[...pics].filter(id=>!STAGE_DATA.pics||!STAGE_DATA.pics[id]||!exists(STAGE_DATA.pics[id].file));check(`Every panel picture (${pics.size}) is a STAGE_DATA picture with its PNG`,bad.length===0,bad.join(', '));}}
{// the picture table's subjects (pics.json `sprites`: FERRIS, the pods, VICE T., the manifest text...) are drawn over the
 // shipped backgrounds by game.js (PIC_ART, G6 verify #1); the ch5 S4 recipe's heroTanks overlay is drawn too (verify #2)
 const game=exists('game.js')?fs.readFileSync(rel('game.js'),'utf8'):'',P=exists('tools/re/levels/pics.json')?JSON.parse(fs.readFileSync(rel('tools/re/levels/pics.json'),'utf8')).pics:{};
 const want=Object.entries(P).filter(([,p])=>(p.sprites||[]).length).map(([id])=>id),bad=want.filter(id=>!game.includes(`'${id}':{need:`));
 check(`Every picture whose subject is a sprite or text (${want.length}) has its overlay in game.js`,want.length>0&&bad.length===0,bad.join(', '));
 // revision 3: no cloned heroes: the vat-hall tank overlay is gone from game.js and from every recipe
 check('No cloned-hero tanks: game.js has no HERO_TANKS and no recipe carries a heroTanks overlay',!/HERO_TANKS=/.test(game)&&[1,2,3,4,5,6,7,8].every(n=>!exists(`tools/re/levels/ch${n}.json`)||!/heroTanks/.test(fs.readFileSync(rel(`tools/re/levels/ch${n}.json`),'utf8'))));}
{// containers: every on-foot section authors its own in the recipe (the old loot run lives in tools/re/levels), each a ROM container
 if(!STAGE_DATA)skip('Containers: stage-data.js is not present');
 else{const fxW={SPRITE_DATA:{families:{},add(n,f){this.families[n]=f;}}};fxW.window=fxW;let props=null;
  try{vm.runInNewContext(fs.readFileSync(rel('sprite-data-fx.js'),'utf8'),fxW,{filename:'sprite-data-fx.js'});props=fxW.SPRITE_DATA.families.fx.props;}catch(e){props=null;}
  const bad=[];for(const c of CAMPAIGN)for(const s of c.sections){const sec=STAGE_DATA.sections[s.stage],def=sec&&STAGE_DATA.chapters[sec.chapter].areas[sec.area].sections.find(x=>x.id===s.stage);if(!def)continue;
   const box=(def.props||[]).filter(p=>p.kind==='crate'||p.kind==='barrel');if(!s.drive&&!box.length)bad.push(s.stage+': no container');if(s.drive&&box.length)bad.push(s.stage+': container on the road');
   if(props)for(const p of box)if(!props[p.kind]||props[p.kind].rec==null)bad.push(s.stage+': '+p.kind+' is not a ROM container');}
  check('Every on-foot section authors its containers and each is a ROM container record (ROM_FX.props)',bad.length===0&&!!props,bad.join(', ')||(props?'':'sprite-data-fx.js has no props'));}}

// ---------------------------------------------------------------- summary
const failed=rows.filter(r=>r.status==='FAIL');
fs.writeFileSync(rel('tests/results/campaign-report.json'),JSON.stringify({source:stageSource,passed:rows.filter(r=>r.status==='PASS').length,failed:failed.length,warned:rows.filter(r=>r.status==='WARN').length,skipped:rows.filter(r=>r.status==='SKIP').length,checks:rows},null,1));
console.log(JSON.stringify({passed:rows.filter(r=>r.status==='PASS').length,failed:failed.length,warned:rows.filter(r=>r.status==='WARN').length,skipped:rows.filter(r=>r.status==='SKIP').length}));
if(failed.length){console.error('FAILED: '+failed.map(r=>r.name).join('; '));process.exit(1);}
