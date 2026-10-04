/* Cadillacs & Dinosaurs II: Last Eden — original local fan-game engine. */
(() => {
'use strict';
const canvas=document.querySelector('#game'),ctx=canvas.getContext('2d'),overlay=document.querySelector('#overlay');
const A=window.ARCADE_ASSETS,sheet=new Image();sheet.src=A.sheet;
const W=768,H=432,GROUND=254,FLOOR=407;
const HEROES=[
 {id:'mustapha',name:'MUSTAPHA',nickname:'MOSTAFA',tag:'THE FLYING KICK',hp:120,speed:180,power:21,color:'#d5ec69',special:'Tornado kick'},
 {id:'jack',name:'JACK TENREC',nickname:'',tag:'THE ALL-ROUNDER',hp:140,speed:145,power:23,color:'#7dc4de',special:'Dino uppercut'},
 {id:'hannah',name:'HANNAH DUNDEE',nickname:'',tag:'THE SWIFT STRIKER',hp:110,speed:166,power:19,color:'#efaa77',special:'Spiral smash'},
 {id:'mess',name:'MESS O\'BRADOVICH',nickname:'',tag:'THE HEAVY HITTER',hp:170,speed:122,power:29,color:'#b5cc85',special:'Knuckle bomb'}
];
const LEVELS=[
 {name:'THE DROWNED HARBOR',area:'01 / CITY OF THE LOST',theme:'harbor',length:4200,boss:'WARDEN ROOK',kind:'warden',sky:['#354e58','#c3936d'],road:['#505b46','#323e37'],accent:'#efb36d',brief:'Six months after Fessenden fell, a black convoy arrives at the harbor. Its cargo: living dinosaurs. Its destination: a place marked EDEN.',dialog:'JACK: Those cages are headed inland.\nMUSTAPHA: Then we follow the tire tracks.',end:'Rook drops a convoy manifest. Someone called Dr. Mara Voss is harvesting the last unaltered dinosaur bloodlines. A highway leads toward her hidden laboratory.'},
 {name:'THE GREEN HIGHWAY',area:'02 / CONVOY PURSUIT',theme:'highway',drive:true,length:4300,boss:'IRON CONVOY',kind:'truck',sky:['#395947','#afad68'],road:['#52544d','#353a34'],accent:'#d2df7b',brief:'Jack brings the Cadillac out of retirement. The convoy is racing along the abandoned expressway. Cut off its armored escort before it reaches the jungle.',dialog:'JACK: Everybody buckle up.\nHANNAH: You did fix the brakes, right?',end:'The convoy carries a wounded young dinosaur, not a weapon. Hannah frees it. A locator on its cage points to the Verdant Basin. The old world is waking up.'},
 {name:'THE VERDANT BASIN',area:'03 / INTO THE WILD',theme:'jungle',length:4400,boss:'THORNMAW',kind:'raptor',sky:['#203b35','#6e9270'],road:['#4c5b32','#293c29'],accent:'#accb6d',brief:'The jungle has swallowed the suburbs. Voss has turned its hunting grounds into a testing field. Her spores drive the dinosaurs into a frenzy.',dialog:'HANNAH: That growth is changing them.\nMESS: We find the source. We break it.',end:'Thornmaw falls. The surviving animals flee as their control collars go dark. A pipeline carries the same glowing spores into the old industrial district.'},
 {name:'THE ASHEN FOUNDRY',area:'04 / FIRE UNDER THE CITY',theme:'foundry',length:4450,boss:'FOREMAN CINDER',kind:'cinder',sky:['#2f3238','#83533c'],road:['#53504b','#313632'],accent:'#eea05c',brief:'Inside the foundry, stolen engines power a serum refinery. Voss is building an army, and a former poacher now guards her furnace gates.',dialog:'MUSTAPHA: This place smells like trouble.\nJACK: Trouble with a very large power bill.',end:'Cinder\'s refinery collapses. Behind the furnace is an elevator to a pre-cataclysm research station. Its logs call Voss\'s project the Pale Regent.'},
 {name:'THE MIRROR LAB',area:'05 / PROJECT REGENT',theme:'lab',length:4400,boss:'SENTINEL ECHO',kind:'echo',sky:['#152c36','#35595e'],road:['#4e6664','#283e43'],accent:'#7bd6c9',brief:'The lab grows creatures that should never exist. Sentinel Echo learns from every intruder. Destroy its chambers before it can finish mapping the heroes.',dialog:'HANNAH: She isn\'t saving the species.\nJACK: She\'s replacing them.',end:'Echo shatters. Voss broadcasts from the seed vault below: "The world had its chance. Eden will belong to a stronger species." The final descent begins.'},
 {name:'THE LAST EDEN',area:'06 / THE SEED VAULT',theme:'eden',length:4650,boss:'DR. MARA VOSS',kind:'regent',sky:['#132d29','#507659'],road:['#46634c','#263b31'],accent:'#d5ec69',brief:'An ancient vault protects the seeds of a living world. Voss has wired it to her mutation reactor. Shut it down before the last natural refuge becomes a breeding ground.',dialog:'VOSS: I offered this world a future.\nMUSTAPHA: A future needs a choice.',end:'The reactor goes silent. Daylight reaches Eden for the first time in centuries. Voss\'s army loses its control signal, and the dinosaurs return to the wild.'}
];
const rand=(a,b)=>a+Math.random()*(b-a),clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),approach=(x,y,s)=>x<y?Math.min(x+s,y):Math.max(x-s,y);
const keys=new Set(),pressed=new Set(),touchKeys=new Set(),padKeys=new Set();
let state='menu',selected=0,difficulty='story',levelIndex=0,level=LEVELS[0],time=0,last=0,camera=0,shake=0,flash=0,hitstop=0;
let player,enemies=[],objects=[],drops=[],particles=[],bullets=[],zones=[],floating=[],wave=0,lock=null,bossSpawned=false,cleared=false,stageTimer=0;
let score=0,lives=3,combo=0,comboTimer=0,bestCombo=0,kills=0,runTime=0,toast='',toastTime=0,started=false;
let save={unlocked:0,checkpoint:null,best:0},settings={music:true,sfx:true},musicStep=0,musicTimer=0;
try{save={...save,...JSON.parse(localStorage.getItem('last-eden-save')||'{}')};settings={...settings,...JSON.parse(localStorage.getItem('last-eden-settings')||'{}')};}catch{}
save.unlocked=clamp(Number(save.unlocked)||0,0,5);
function persist(){try{localStorage.setItem('last-eden-save',JSON.stringify(save));localStorage.setItem('last-eden-settings',JSON.stringify(settings));}catch{}}
function checkpoint(){save.checkpoint={level:levelIndex,hero:selected,difficulty,score,lives};persist();}
let audio;
function unlockAudio(){if(!audio){const AC=window.AudioContext||window.webkitAudioContext;if(AC)audio=new AC();}if(audio?.state==='suspended')audio.resume();soundtrack.unlock();}
function tone(freq,dur=.12,type='square',vol=.04,end){if(!audio)return;const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);if(end)o.frequency.exponentialRampToValueAtTime(Math.max(20,end),audio.currentTime+dur);g.gain.setValueAtTime(vol,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+dur);o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+dur);}
function sfx(name){if(!settings.sfx)return;unlockAudio();if(['gun','shotgun','rocket','explosion','swing'].includes(name)&&audio){const dur=name==='explosion'?.55:name==='rocket'?.25:name==='shotgun'?.2:name==='swing'?.07:.09;const b=audio.createBuffer(1,Math.ceil(audio.sampleRate*dur),audio.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);const n=audio.createBufferSource(),g=audio.createGain(),f=audio.createBiquadFilter();n.buffer=b;f.type='lowpass';f.frequency.value=name==='explosion'?750:name==='swing'?1600:3500;g.gain.value=name==='swing'?.05:.13;n.connect(f).connect(g).connect(audio.destination);n.start();}if(name==='hit'){tone(130,.09,'sawtooth',.09,35);tone(630,.045,'square',.025,60);}if(name==='jump')tone(190,.15,'triangle',.06,550);if(name==='gun')tone(900,.09,'sawtooth',.065,50);if(name==='pickup'){tone(440,.1,'square',.04);setTimeout(()=>tone(660,.1,'square',.04),70);}if(name==='special'){tone(90,.35,'sawtooth',.07,600);tone(440,.25,'triangle',.04,100);}if(name==='hurt')tone(180,.2,'sawtooth',.06,40);if(name==='clear'){[392,494,587,784].forEach((f,i)=>setTimeout(()=>tone(f,.3,'triangle',.05),i*100));}}


const soundtrack = new ArcadeSoundtrack();
const WEAPONS = {
  gun: {name:'GUN', ammo:6, cooldown:.32, damage:32, sprite:[263,40,34,24], recoil:4},
  uzi: {name:'UZI', ammo:48, cooldown:.29, damage:15, burst:3, sprite:[506,101,45,29], left:true, recoil:3},
  shotgun: {name:'SHOTGUN', ammo:6, cooldown:.66, damage:56, spread:56, pierce:3, sprite:[10,154,60,25], left:true, recoil:8},
  rifle: {name:'RIFLE', ammo:6, cooldown:.74, damage:70, pierce:2, sprite:[10,225,78,21], recoil:7},
  m16: {name:'M-16A1', ammo:60, cooldown:.28, damage:21, burst:3, sprite:[13,315,81,21], recoil:5},
  bazooka: {name:'BAZOOKA', ammo:4, cooldown:.85, damage:108, explosive:true, sprite:[7,408,81,22], left:true, recoil:10},
  knife: {name:'KNIFE', ammo:10, cooldown:.28, damage:33, melee:true, range:96, sprite:[11,754,43,28]},
  rod: {name:'ROD', ammo:8, cooldown:.49, damage:48, melee:true, range:112, sprite:[8,595,68,20]},
  stick: {name:'STICK', ammo:8, cooldown:.32, damage:28, melee:true, range:86, sprite:[11,649,46,22]},
  club: {name:'CLUB', ammo:16, cooldown:.44, damage:42, melee:true, range:108, sprite:[8,711,63,26]},
  torch: {name:'TORCH', ammo:12, cooldown:.46, damage:48, melee:true, range:104, sprite:[854,683,38,54]},
  grenade: {name:'GRENADE', ammo:2, cooldown:.5, damage:100, thrown:true, sprite:[10,513,22,21]},
  dynamite: {name:'DYNAMITE', ammo:2, cooldown:.5, damage:125, thrown:true, sprite:[4,486,43,26]},
  stone: {name:'STONE', ammo:1, cooldown:.4, damage:32, thrown:true, sprite:[15,455,17,19]}
};
const SCENES = [
 ['ruins','hall','ruins'], ['wastes','wastes','yard'], ['forest','grove','mine'],
 ['yard','fire','furnace'], ['lab','tanks','lab'], ['grove','tanks','vault']
];
const SECTION_NAMES = [
 ['SMUGGLERS’ QUAY','THE CUSTOMS HOUSE','ROOK’S BLOCKADE'],
 ['BROKEN EXPRESSWAY','CONVOY INTERCEPT','THE LAST ESCORT'],
 ['POACHERS’ TRAIL','THE DEEP CANOPY','THORNMAW’S NEST'],
 ['SCRAPYARD GATES','SERUM REFINERY','THE FURNACE FLOOR'],
 ['OBSERVATION WING','THE GROWTH CHAMBERS','ECHO’S CORE'],
 ['THE BURIED GARDEN','REGENT INCUBATOR','THE SEED VAULT']
];
const STAGE_TRACKS = [['06','07','08'],['16','17','22'],['13','14','07'],['20','21','22'],['08','17','20'],['25','13','14']];
const BOSS_TRACKS = ['10','19','15','24','24','15'];
const ENCOUNTERS = [
 [['raider','raider'],['gunner','raider','brute'],['raider','knifer','gunner'],['brute','raider','raider'],['gunner','knifer','brute'],['brute','gunner','raider']],
 [['biker','biker'],['biker','biker','gunner'],['biker','biker','biker'],['biker','gunner','biker'],['biker','biker','gunner'],['biker','biker','biker']],
 [['raider','knifer'],['raptor','raider','gunner'],['raptor','raptor','knifer'],['brute','gunner','raider'],['raptor','brute','gunner'],['raptor','raptor','brute']],
 [['brute','raider'],['knifer','gunner','brute'],['brute','brute','raider'],['gunner','knifer','gunner'],['brute','gunner','raider'],['brute','knifer','gunner']],
 [['gunner','knifer'],['mutant','gunner','raider'],['mutant','raptor','gunner'],['brute','mutant','knifer'],['mutant','gunner','gunner'],['mutant','mutant','brute']],
 [['raptor','brute'],['mutant','gunner','raptor'],['brute','mutant','knifer'],['mutant','raptor','gunner'],['mutant','mutant','brute'],['mutant','gunner','brute']]
];
const stageMusic = () => STAGE_TRACKS[levelIndex][Math.min(2,Math.floor(Math.max(0,wave-1)/2))];
let section = -1, effects = [], lastHitEnemy = null, bossIntro = 0, dashTime = 0, dashKey = '', lastDirection = {key:'',time:0};
const worldImages = {};
function keyedImage(source, key) {
  const img = new Image(), surface = document.createElement('canvas');
  img.onload = () => {
    surface.width = img.width; surface.height = img.height;
    const g = surface.getContext('2d');g.drawImage(img,0,0);
    const pixels = g.getImageData(0,0,img.width,img.height), d = pixels.data;
    for(let i=0;i<d.length;i+=4) if(key==='blue' ? d[i]<25&&d[i+1]<25&&d[i+2]>230 : d[i]>235&&d[i+1]<25&&d[i+2]>235) d[i+3]=0;
    g.putImageData(pixels,0,0);surface.ready=true;
  };
  img.src=source;return surface;
}
const weaponArt=keyedImage(WORLD_ART.weapons,'blue');
for(const [name,asset] of Object.entries(WORLD_ART.scenes)) worldImages[name]=keyedImage(asset.src,'magenta');
function weaponSprite(g,type,x,y,scale=1,dir=1,angle=0) {
  const data=WEAPONS[type];if(!data||!weaponArt.ready)return;
  const [sx,sy,w,h]=data.sprite;
  g.save();g.translate(Math.round(x),Math.round(y));g.rotate(angle);g.scale(dir*scale*(data.left?-1:1),scale);
  g.imageSmoothingEnabled=false;g.drawImage(weaponArt,sx,sy,w,h,-w*(data.left?.65:.35),-h*.5,w,h);g.restore();
}
function stageBackdrop(g,idx,cam,t) {
  const part=Math.min(2,Math.floor(Math.max(0,(idx===levelIndex?wave:0)-1)/2));
  const name=SCENES[idx][part], art=worldImages[name], data=WORLD_ART.scenes[name];
  if(!art?.ready)return false;
  const sky=g.createLinearGradient(0,0,0,H);sky.addColorStop(0,LEVELS[idx].sky[0]);sky.addColorStop(1,LEVELS[idx].sky[1]);g.fillStyle=sky;g.fillRect(0,0,W,H);
  if(idx===0||idx===1||idx===3)for(let i=-1;i<7;i++)building(g,i*180-(cam*.2%180),245,120,130+noise(i+idx)*65,i);
  else{rect(g,0,68,W,215,'#234638');for(let i=-1;i<8;i++)tree(g,i*135-(cam*.18%135),265,1.15);}
  // Sheets contain credit strips below the scene; only scene rectangles are drawn.
  const scale=1.65, width=data.width*scale;
  const sectionStart=part*1110;
  const sx=clamp((cam-sectionStart)*.74,0,Math.max(0,width-W));
  const floors={ruins:182,hall:152,forest:155,grove:142,mine:155,yard:142,fire:160,furnace:136,lab:128,tanks:146,vault:133,wastes:137};
  const fy=floors[name]||150;
  g.drawImage(art,0,Math.max(0,fy-134),data.width,134,-sx,62,width,221);
  const patches={ruins:[260,184,520,54],hall:[90,157,700,65],forest:[64,157,205,34],grove:[820,146,820,76],mine:[0,168,384,52],yard:[400,164,512,58],fire:[0,176,512,42],furnace:[0,160,384,62],lab:[0,145,768,74],tanks:[100,162,800,58],vault:[512,148,500,60],wastes:[0,158,768,62]};
  const [gx,gy,gw,gh]=patches[name]||patches.ruins, tileW=gw*scale;
  for(let x=-(cam%tileW);x<W;x+=tileW)g.drawImage(art,gx,gy,gw,gh,x,283,tileW,149);
  if(idx===1){rect(g,0,254,W,178,'#363a34');for(let k=0;k<3;k++)for(let j=-1;j<9;j++)rect(g,j*120-((cam+t*120)%120),288+k*51,57,3,'#cdc5a0');rect(g,0,253,W,7,'#b7b398');}
  // New mission landmarks distinguish the sequel route from the source scenes.
  const marker=740+part*1010-cam;
  if(marker>-200&&marker<W+200){rect(g,marker,162,7,103,'#26322b');rect(g,marker-70,154,149,45,'#152d2b');rect(g,marker-66,158,141,2,LEVELS[idx].accent);label(['EDEN CARGO →','RESTRICTED / 02','VAULT ACCESS →'][part],marker+4,180,10,LEVELS[idx].accent,'center');}
  if(idx===3)for(let i=0;i<13;i++){const px=(i*97+t*18)%W,py=245-(t*38+i*41)%180;rect(g,px,py,2,3,'#ffbd6988');}
  if(idx>=4){g.fillStyle='#65d5c20a';g.fillRect(0,68,W,364);for(let i=0;i<6;i++)rect(g,(i*143+cam*.2)%W,98+(i*47)%158,2,2,'#baf2d1');}
  return true;
}
function music(dt) {
  document.querySelector('#sound').textContent=settings.music||settings.sfx?'SOUND ON':'SOUND OFF';
  soundtrack.update(settings.music,state==='paused'||document.hidden,settings.volume??.52);
  if(state==='paused'||state==='guide')return;
  let key=state, sequence;
  if(['menu','chapters','credits'].includes(state)) sequence=[{id:'01',loop:false},{id:'02',loop:false},'01'];
  else if(state==='select')sequence=['03'];
  else if(state==='brief')sequence=[{id:levelIndex===0?'04':'05',loop:false},stageMusic()];
  else if(state==='play') {
    const boss=enemies.find(e=>e.boss&&!e.dead);
    key=`play-${levelIndex}-${boss?`boss-${boss.phase}`:Math.floor(Math.max(0,wave-1)/2)}`;
    sequence=boss?[{id:levelIndex===3||levelIndex===4?'23':levelIndex===2?'18':'09',seconds:3.2},BOSS_TRACKS[levelIndex]]:[stageMusic()];
  } else if(state==='clear')sequence=[{id:'11',loop:false},{id:['26','27','28'][levelIndex%3],loop:false},'06'];
  else if(state==='ending')sequence=[{id:'28',loop:false},'06'];
  else if(state==='gameover')sequence=['02'];
  if(sequence)soundtrack.cue(key+(state==='brief'||state==='clear'?levelIndex:''),sequence);
}
function dropWeapon() {
  if(player.weapon)drops.push({x:player.x-player.dir*20,y:player.y+5,type:player.weapon,ammo:player.ammo,life:60});
  player.weapon=null;player.ammo=0;
}
function explode(x,y,damage,friendly=true,r=96) {
  effects.push({x,y,age:0,life:.65,type:'explosion'});shake=10;sfx('explosion');
  for(const e of enemies)if(friendly&&!e.dead&&Math.hypot(e.x-x,(e.y-y)*1.6)<r)damageEnemy(e,damage,Math.sign(e.x-x)*48,true);
  if(!friendly&&Math.hypot(player.x-x,(player.y-y)*1.6)<r)damagePlayer(damage,x);
  for(const o of objects)if(o.hp>0&&Math.hypot(o.x-x,o.y-y)<r)breakObject(o,damage);
}
function breakObject(o,power) {
  o.hp-=power;burst(o.x,o.y-30,'#c3925d',10);
  if(o.hp<=0){drops.push({x:o.x,y:o.y,type:o.content,life:90});score+=100;}
}
function weaponAttack() {
  const w=WEAPONS[player.weapon];if(!w)return false;
  const type=player.weapon;player.attackTotal=w.cooldown;player.attack=w.cooldown;player.attackKind='weapon';player.recoil=w.recoil||0;
  if(player.ammo<=0){
    if(type==='rifle'||type==='m16'){meleeStrike(100,34,true);sfx('hit');}
    else {bullets.push({x:player.x,y:player.y,z:45,vx:player.dir*380,vy:0,friendly:true,damage:30,life:1,kind:'thrown',weapon:type,age:0});player.weapon=null;}
    return true;
  }
  if(w.melee){
    const close=enemies.some(e=>!e.dead&&Math.abs(e.x-player.x)<w.range&&Math.abs(e.y-player.y)<36);
    if(type==='knife'&&!close){bullets.push({x:player.x,y:player.y,z:48,vx:player.dir*490,vy:0,friendly:true,damage:45,life:1.2,kind:'thrown',weapon:type,age:0});player.weapon=null;player.ammo=0;}
    else {meleeStrike(w.range,w.damage*(selected===2?1.25:1),type!=='knife');if(--player.ammo<=0){player.weapon=type==='rod'?'stick':null;player.ammo=type==='rod'?8:0;}}
    sfx('hit');return true;
  }
  if(w.thrown){bullets.push({x:player.x+player.dir*20,y:player.y,z:50,vx:player.dir*220,vy:0,friendly:true,damage:w.damage,life:type==='dynamite'?1.15:.85,kind:'lob',weapon:type,age:0});if(--player.ammo<=0)player.weapon=null;sfx('jump');return true;}
  const shots=Math.min(w.burst||1,player.ammo);
  for(let i=0;i<shots;i++)bullets.push({x:player.x+player.dir*(type==='gun'?55:80),y:player.y,z:65+player.z,vx:player.dir*(w.explosive?450:860),vy:0,friendly:true,damage:w.damage*(selected===2?1.25:1),life:w.spread?.33:1.15,kind:w.explosive?'rocket':'bullet',weapon:type,delay:i*.085,spread:w.spread||25,pierce:w.pierce||1,hits:[],age:0});
  player.ammo-=shots;player.x-=player.dir*(w.recoil||0);sfx(type==='bazooka'?'rocket':type==='shotgun'?'shotgun':'gun');
  effects.push({type:'muzzle',x:player.x+player.dir*(type==='gun'?55:84),y:player.y-65-player.z,dir:player.dir,age:0,life:.085});
  if(player.ammo===0){toast='EMPTY · E THROW / PICK UP ANOTHER WEAPON';toastTime=2;}
  return true;
}
function meleeStrike(range,power,knockdown=false) {
  let hits=0;
  for(const e of enemies)if(!e.dead&&Math.abs(e.y-player.y)<36&&Math.abs(e.x-player.x)<range&&(Math.abs(e.x-player.x)<16||Math.sign(e.x-player.x)===player.dir)){damageEnemy(e,power,player.dir*(knockdown?42:8),knockdown);hits++;}
  for(const o of objects)if(o.hp>0&&Math.abs(o.y-player.y)<36&&Math.abs(o.x-player.x)<range&&Math.sign(o.x-player.x)===player.dir)breakObject(o,power);
  return hits;
}
function updateProjectiles(dt) {
  for(const b of bullets){
    if(b.delay>0){b.delay-=dt;continue;}
    b.age=(b.age||0)+dt;b.x+=b.vx*dt;b.y+=(b.vy||0)*dt;b.life-=dt;
    if(b.kind==='lob'){b.z=16+Math.sin(Math.min(1,b.age/(b.weapon==='dynamite'?1.15:.85))*Math.PI)*75;if(b.weapon==='grenade'&&enemies.some(e=>!e.dead&&Math.abs(e.x-b.x)<28&&Math.abs(e.y-b.y)<30)&&b.age>.25)b.life=0;if(b.life<=0){if(b.weapon==='stone'){for(const e of enemies)if(Math.hypot(e.x-b.x,e.y-b.y)<55)damageEnemy(e,b.damage,30,true);}else explode(b.x,b.y,b.damage,b.friendly);}continue;}
    if(b.friendly){for(const e of enemies)if(!e.dead&&!b.hits?.includes(e.id)&&Math.abs(b.x-e.x)<(e.boss?45:22)&&Math.abs(b.y-e.y)<(b.spread||27)){
      if(b.kind==='rocket'){explode(b.x,b.y,b.damage,true,120);b.life=0;break;}
      damageEnemy(e,b.damage,Math.sign(b.vx)*12,b.weapon==='rifle'||b.weapon==='shotgun');
      (b.hits||(b.hits=[])).push(e.id);b.pierce=(b.pierce||1)-1;if(b.pierce<=0){b.life=0;break;}
    }}else if(Math.abs(b.x-player.x)<(level.drive?64:23)&&Math.abs(b.y-player.y)<25){damagePlayer(b.damage,b.x-Math.sign(b.vx)*40);b.life=0;}
    if(b.life>0&&b.friendly)for(const o of objects)if(o.hp>0&&Math.abs(b.x-o.x)<25&&Math.abs(b.y-o.y)<30){breakObject(o,b.damage);if(b.kind==='rocket')explode(b.x,b.y,b.damage);b.life=0;break;}
  }
  bullets=bullets.filter(b=>b.life>0);
  for(const fx of effects)fx.age+=dt;effects=effects.filter(fx=>fx.age<fx.life);
}
function drawEffects() {
  for(const b of bullets){if(b.delay>0)continue;const x=b.x-camera,y=b.y-b.z;
    if(b.kind==='lob'||b.kind==='thrown'){shadow(ctx,x,b.y,8);weaponSprite(ctx,b.weapon,x,y,.85,1,b.age*9);}
    else if(b.kind==='rocket'){weaponSprite(ctx,'bazooka',x,y,.45,Math.sign(b.vx));rect(ctx,x-Math.sign(b.vx)*30,y-2,Math.sign(b.vx)*18,4,'#ffb33b');}
    else {rect(ctx,x,y,Math.sign(b.vx)*(b.weapon==='shotgun'?27:17),2,b.friendly?'#fff7c5':'#ff8662');if(b.weapon==='shotgun'){rect(ctx,x-5,y-8,10,2,'#ffdc7c');rect(ctx,x-5,y+8,10,2,'#ffdc7c');}}
  }
  for(const fx of effects){if(fx.type==='muzzle'&&weaponArt.ready){ctx.save();ctx.translate(fx.x-camera,fx.y);ctx.scale(fx.dir,1);ctx.drawImage(weaponArt,90,4,38,24,0,-12,38,24);ctx.restore();}
    if(fx.type==='explosion'&&weaponArt.ready){const frames=[[260,794,83,73],[348,782,101,87],[448,782,144,84],[596,781,155,89],[762,786,120,83],[883,787,128,86]];const r=frames[Math.min(5,Math.floor(fx.age/fx.life*6))];ctx.drawImage(weaponArt,...r,fx.x-camera-r[2]*.65,fx.y-r[3]*1.3,r[2]*1.3,r[3]*1.3);}}
}
function soundRoom(back=menu) {
  state='jukebox';
  panel(`<section class="panel small-panel sound-panel"><p class="eyebrow">THE ORIGINAL ARCADE SOUND</p><h2>SOUND ROOM.</h2><div class="audio-settings"><button class="secondary" id="music-toggle">MUSIC ${settings.music?'ON':'OFF'}</button><button class="secondary" id="sfx-toggle">EFFECTS ${settings.sfx?'ON':'OFF'}</button><label>Music volume <input id="music-volume" type="range" min="0" max="100" value="${Math.round((settings.volume??.52)*100)}"></label></div><div class="track-list">${SOUNDTRACK.map(t=>`<button class="track" data-track="${t.id}"><span>${t.id}</span>${t.title.replace(/ \(1\)$/, '')}<small>${Math.floor(t.duration/60)}:${Math.floor(t.duration%60).toString().padStart(2,'0')}</small></button>`).join('')}</div><p class="sound-note">27 tracks · Choose a track to listen. The campaign changes music with each area and boss.</p><button id="sound-back" class="primary">← BACK</button></section>`);
  bindButton('music-toggle',()=>{settings.music=!settings.music;persist();soundRoom(back);});
  bindButton('sfx-toggle',()=>{settings.sfx=!settings.sfx;persist();soundRoom(back);});
  document.getElementById('music-volume').addEventListener('input',e=>{settings.volume=Number(e.target.value)/100;persist();});
  document.querySelectorAll('[data-track]').forEach(b=>b.addEventListener('click',()=>{unlockAudio();settings.music=true;persist();soundtrack.cue('preview-'+b.dataset.track,[b.dataset.track]);document.querySelectorAll('[data-track]').forEach(v=>v.classList.toggle('selected',v===b));}));
  bindButton('sound-back',back);
}

const combatSheet=new Image();combatSheet.src=COMBAT_ART.sheet;
function drawCombat(g,f,x,y,scale,dir,filter="none"){if(!f||!combatSheet.complete)return;g.save();g.translate(Math.round(x),Math.round(y));g.scale(-dir*scale,scale);g.filter=filter;g.drawImage(combatSheet,f.x,f.y,f.w,f.h,-f.anchor,-f.h,f.w,f.h);g.restore();}
function bindButton(id,fn){document.getElementById(id)?.addEventListener('click',()=>{unlockAudio();fn();});}
function panel(html){overlay.innerHTML=html;document.querySelector('#pause').style.display=state==='play'?'block':'none';}
function menu(){state='menu';lock=null;keys.clear();panel(`<section class="panel title-panel"><p class="eyebrow">THE OLD WORLD. A NEW FIGHT.</p><h1>CADILLACS &<br>DINOSAURS <span>II</span></h1><div class="subtitle">LAST EDEN</div><p class="deck">Four familiar heroes. Six new chapters.<br>One last chance for a world worth saving.</p><div class="menu-buttons"><button class="primary" id="newgame">START ADVENTURE →</button>${save.checkpoint?'<button class="secondary" id="continue">CONTINUE</button>':''}<button class="secondary" id="chapters">CHAPTERS</button><button class="secondary" id="guide">HOW TO PLAY</button><button class="secondary" id="jukebox">SOUND ROOM</button></div><p class="title-note">A FAN-MADE SEQUEL · MADE FOR MOSTAFA</p></section>`);bindButton('newgame',()=>characterSelect());bindButton('continue',()=>{const s=save.checkpoint;selected=clamp(s.hero,0,3);difficulty=s.difficulty==='arcade'?'arcade':'story';score=s.score||0;lives=s.lives||3;startStage(clamp(s.level,0,5));});bindButton('chapters',chapters);bindButton('guide',()=>guide(menu));bindButton('jukebox',()=>soundRoom(menu));}
function characterSelect(startAt=0){state='select';panel(`<section class="panel character-panel"><p class="eyebrow">CHOOSE YOUR HERO</p><h2>THE GANG IS BACK.</h2><div class="hero-grid">${HEROES.map((h,i)=>`<button class="hero-card ${i===selected?'selected':''}" data-hero="${i}"><div class="hero-art"><canvas width="100" height="110" id="portrait-${i}" aria-label="${h.name}"></canvas></div><div class="hero-name">${h.name}</div><div class="hero-tag">${h.tag}</div><div class="hero-stats"><span>POWER ${Math.round(h.power/6)}</span><span>SPEED ${Math.round(h.speed/36)}</span></div></button>`).join('')}</div><div class="select-row"><div class="difficulty"><button id="story-mode" class="${difficulty==='story'?'selected':''}">STORY</button><button id="arcade-mode" class="${difficulty==='arcade'?'selected':''}">ARCADE</button></div><span class="hint">${difficulty==='story'?'More health · forgiving fights':'Faster enemies · harder bosses'}</span><button id="begin" class="primary">LET'S GO →</button></div><div class="menu-buttons"><button id="back" class="secondary">← BACK</button></div></section>`);
 document.querySelectorAll('[data-hero]').forEach(b=>b.onclick=()=>{selected=+b.dataset.hero;characterSelect(startAt);sfx('pickup');});bindButton('story-mode',()=>{difficulty='story';characterSelect(startAt);});bindButton('arcade-mode',()=>{difficulty='arcade';characterSelect(startAt);});bindButton('begin',()=>{score=0;lives=3;kills=0;bestCombo=0;runTime=0;startStage(startAt);});bindButton('back',menu);HEROES.forEach((h,i)=>{const c=document.querySelector('#portrait-'+i),g=c.getContext('2d');g.imageSmoothingEnabled=false;drawFrame(g,A[h.id].frames[0],50,108,1.25,1);});}
function chapters(){state='chapters';panel(`<section class="panel small-panel"><p class="eyebrow">THE ROAD TO EDEN</p><h2>SIX CHAPTERS. ONE WORLD.</h2><p>Clear a chapter to unlock it here. Your campaign saves at the start of each chapter.</p><div class="level-grid">${LEVELS.map((l,i)=>`<button data-level="${i}" ${i>save.unlocked?'disabled':''}><span>CHAPTER 0${i+1} ${i>save.unlocked?'· LOCKED':''}</span>${l.name}</button>`).join('')}</div><div class="menu-buttons"><button id="back" class="secondary">← MAIN MENU</button></div></section>`);document.querySelectorAll('[data-level]').forEach(b=>b.onclick=()=>characterSelect(+b.dataset.level));bindButton('back',menu);}
function guide(back){state='guide';panel(`<section class="panel small-panel"><p class="eyebrow">ARCADE FIELD GUIDE</p><h2>GET BACK IN THE FIGHT.</h2><div class="controls-list"><strong>WASD / ↑↓←→</strong><span>Move along the street and between lanes.</span><strong>J / Z</strong><span>Chain punches into a knockdown. Attack in the air for a flying kick; attack over a weapon to pick it up.</span><strong>K / X</strong><span>Jump. Dodge shockwaves and low attacks.</span><strong>L / C</strong><span>Special move, also J + K together. Costs health when it hits; drops your weapon.</span><strong>E / V</strong><span>Pick up a nearby weapon or item. Throw your weapon if holding one.</span><strong>SHIFT</strong><span>Run, or double tap a direction. Attack while running for your hero’s dash strike.</span><strong>ESC / P</strong><span>Pause. Gamepad: stick / D-pad, X hit, A jump, Y special, B pick.</span></div><p>Break barrels for food and weapons. Walk to the right after clearing an encounter. Red attack markers mean dodge or jump. Each gun has its own ammo and firing pattern. Knockdowns drop weapons. Highway: steer into enemies, J bash, K boost, L ram.</p><div class="menu-buttons"><button id="back" class="primary">GOT IT →</button></div></section>`);bindButton('back',back);}
function startStage(i,skipBrief=false){levelIndex=i;level=LEVELS[i];const hero=HEROES[selected];player={x:130,y:352,z:0,vz:0,dir:1,hp:hero.hp*(difficulty==='story'?1.4:1),maxhp:hero.hp*(difficulty==='story'?1.4:1),hurt:0,inv:1.5,attack:0,attackTotal:.38,special:0,specialCd:0,comboStep:0,weapon:null,ammo:0,move:false,run:false,anim:0,boost:0,boostCd:0,recoil:0,knocked:false,attackKind:"combo",pendingStrike:null};
 enemies=[];objects=[];drops=[];particles=[];bullets=[];zones=[];floating=[];effects=[];section=-1;bossIntro=0;lastHitEnemy=null;dashTime=0;wave=0;lock=null;camera=0;bossSpawned=false;cleared=false;stageTimer=0;combo=0;comboTimer=0;shake=0;flash=0;checkpoint();
 if(!level.drive){const loot=['gun','food','rod','shotgun','food','uzi','grenade','rifle','food','m16','dynamite','bazooka'];for(let j=0;j<12;j++)objects.push({x:300+j*315,y:310+(j*29)%76,hp:28,type:j%3===0?'crate':'barrel',content:loot[(j+levelIndex*2)%loot.length]});drops.push({x:230,y:360,type:levelIndex===0?'gun':'shotgun',life:999});drops.push({x:270,y:375,type:'food',life:999});}
 started=true;toast=level.drive?'STEER ↑↓ · RAM ENEMIES · J BASH · K BOOST':'MOVE → · J ATTACK · K JUMP · E PICK UP';toastTime=7;
 if(skipBrief){state='play';panel('');canvas.focus();return;}
 state='brief';panel(`<section class="panel small-panel"><p class="eyebrow">CHAPTER 0${i+1} · ${level.area.split('/')[1].trim()}</p><h2>${level.name}</h2><p>${level.brief}</p><p style="color:var(--acid);white-space:pre-line">${level.dialog}</p><div class="menu-buttons"><button id="enter-stage" class="primary">${level.drive?'START YOUR ENGINE':'ENTER THE CHAPTER'} →</button></div></section>`);bindButton('enter-stage',()=>{state='play';panel('');keys.clear();pressed.clear();canvas.focus();});}
function pause(){if(state==='play'){state='paused';keys.clear();pressed.clear();panel(`<section class="panel small-panel"><p class="eyebrow">TAKE A BREATHER</p><h2>PAUSED.</h2><p>Chapter 0${levelIndex+1} · ${level.name}<br>Your checkpoint is saved at the start of this chapter.</p><div class="menu-buttons"><button id="resume" class="primary">RESUME →</button><button id="controls" class="secondary">CONTROLS</button><button id="pause-sound" class="secondary">AUDIO SETTINGS</button><button id="restart" class="secondary">RESTART CHAPTER</button><button id="quit" class="secondary">MAIN MENU</button></div></section>`);bindButton('resume',resume);bindButton('pause-sound',()=>soundRoom(()=>{state='play';pause();}));bindButton('controls',()=>guide(()=>{state='play';pause();}));bindButton('restart',()=>startStage(levelIndex));bindButton('quit',()=>{checkpoint();menu();});}else if(state==='paused')resume();}
function resume(){state='play';panel('');keys.clear();pressed.clear();canvas.focus();}
function gameover(){state='gameover';save.best=Math.max(save.best,score);persist();panel(`<section class="panel small-panel"><p class="eyebrow">THE FIGHT ISN'T OVER</p><h2>CONTINUE?</h2><p>The gang regroups at the start of this chapter. No coins needed.<br>Score ${score.toString().padStart(6,'0')} · Best combo ${bestCombo}</p><div class="menu-buttons"><button id="retry" class="primary">TRY AGAIN →</button><button id="quit" class="secondary">MAIN MENU</button></div></section>`);bindButton('retry',()=>{lives=3;startStage(levelIndex);});bindButton('quit',menu);}
function stageClear(){if(cleared)return;cleared=true;state='clear';score+=2500+Math.floor(player.hp*10);save.unlocked=Math.max(save.unlocked,Math.min(5,levelIndex+1));save.best=Math.max(save.best,score);sfx('clear');save.checkpoint=levelIndex<5?{level:levelIndex+1,hero:selected,difficulty,score,lives}:null;persist();panel(`<section class="panel small-panel"><p class="eyebrow">CHAPTER 0${levelIndex+1} COMPLETE</p><h2>${levelIndex===5?'EDEN IS FREE.':'KEEP THE ENGINE RUNNING.'}</h2><p>${level.end}</p><p style="color:var(--acid)">SCORE ${score.toString().padStart(6,'0')} · BEST COMBO ${bestCombo}</p><div class="menu-buttons"><button id="next" class="primary">${levelIndex===5?'SEE THE ENDING':'NEXT CHAPTER'} →</button></div></section>`);bindButton('next',()=>levelIndex<5?startStage(levelIndex+1):ending());}
function ending(){state='ending';save.checkpoint=null;persist();panel(`<section class="panel small-panel"><p class="eyebrow">LAST EDEN · THE END</p><h2>A WORLD WORTH SAVING.</h2><p>Hannah opens the vault. Jack disconnects the reactor. Mess lifts the fallen gate, and Mustapha leads the rescued animals into the sunrise.</p><p>The Cadillac rolls home carrying four tired heroes, a box of seeds, and one very stubborn baby dinosaur.</p><p style="color:var(--acid)">MUSTAPHA: Same time next adventure?<br>JACK: Only if you're buying the fuel.</p><p>${kills} enemies defeated · ${Math.floor(runTime/60)} minutes · score ${score}<br>All six chapters are now available.</p><div class="menu-buttons"><button id="chapters" class="primary">PLAY A CHAPTER →</button><button id="credits" class="secondary">CREDITS</button><button id="quit" class="secondary">MAIN MENU</button></div></section>`);bindButton('chapters',chapters);bindButton('credits',credits);bindButton('quit',menu);}
function credits(){state='credits';panel(`<section class="panel small-panel"><p class="eyebrow">THANKS FOR PLAYING</p><h2>FOR THE OLD ARCADE DAYS.</h2><p>An unofficial fan sequel created for Mostafa's next adventure. Original character graphics were recovered from the arcade ROM files supplied by the user.</p><p>New story, levels, environments, combat engine, boss behaviors created for this game. Original soundtrack supplied by the user. Background sheets contributed by shunninghuang via Sprite Database. Original Cadillacs and Dinosaurs arcade game and artwork: Capcom. Characters and setting derive from Xenozoic Tales by Mark Schultz.</p><div class="menu-buttons"><button id="quit" class="primary">MAIN MENU →</button></div></section>`);bindButton('quit',menu);}
function spawnEnemy(x,y,type='raider',boss=false) {
  const base=boss?[540,670,620,690,710,540][levelIndex]:({brute:125,gunner:68,raptor:74,knifer:82,mutant:138,biker:85}[type]||80);
  const hp=base*(difficulty==='story'?.84:1.2);
  const e={id:Math.random(),x,y,z:0,dir:-1,hp,maxhp:hp,type,boss,phase:1,state:'walk',timer:rand(.8,1.8),hurt:0,inv:0,anim:0,dead:0,attack:0,attackNo:0,hitChain:0,hitTimer:0,recovery:0,palette:'13',hue:0};
  enemies.push(e);return e;
}

function spawnWave(n) {
  wave=n;lock={left:Math.max(0,player.x-185),right:Math.min(level.length+240,player.x+510)};
  const lineup=[...ENCOUNTERS[levelIndex][n-1]];
  if(difficulty==='arcade')lineup.push(n%2?'knifer':'gunner');
  lineup.forEach((type,j)=>spawnEnemy(j===lineup.length-1&&n%2===0?lock.left+24:player.x+315+j*43,302+(j*37)%88,type));
  const part=Math.min(2,Math.floor((n-1)/2));
  if(part!==section){section=part;toast=SECTION_NAMES[levelIndex][part];toastTime=3.5;}
  else {toast=level.drive?'INTERCEPT THE ESCORT':'AMBUSH · WATCH BOTH SIDES';toastTime=2;}
  if(n%2===0&&!level.drive){const weapons=[['shotgun','gun'],['uzi','grenade'],['rifle','club'],['m16','dynamite'],['bazooka','torch'],['bazooka','m16']][levelIndex];drops.push({x:player.x+95,y:378,type:weapons[(n/2)%2],life:90});}
}

function spawnBoss() {
  bossSpawned=true;wave=6;section=2;lock={left:level.length-570,right:level.length+100};
  const b=spawnEnemy(level.length-130,344,level.kind,true);b.timer=2.4;b.state='intro';b.inv=2.4;bossIntro=2.4;
  toast=level.boss+' · '+['BREAK THE BLOCKADE','RAM THE ESCORT','WATCH THE CHARGE','DODGE THE CLEAVES','BREAK ITS RHYTHM','STOP THE REGENT'][levelIndex];toastTime=4;
  sfx('special');
}

function popup(x,y,text,color='#e9ecd1'){floating.push({x,y,text,color,life:1.15});}
function burst(x,y,color,n=12){for(let i=0;i<n;i++)particles.push({x,y,vx:rand(-120,120),vy:rand(-140,60),life:rand(.18,.55),size:rand(2,5),color});}
function damageEnemy(e,amount,knock=0,forceDown=false) {
  if(e.dead||e.inv>0||e.state==='flee')return;
  e.hp-=amount;e.hurt=e.boss?.07:.15;e.inv=.055;e.x+=knock*(e.boss?.25:1);
  if(lock)e.x=clamp(e.x,lock.left+28,lock.right-42);
  e.hitChain=e.hitTimer>0?e.hitChain+1:1;e.hitTimer=1.1;
  if(!e.boss){if(forceDown||e.hitChain>=3){e.state='down';e.timer=.85;e.inv=.7;e.hitChain=0;}else{e.state='hurt';e.timer=.25;}}
  lastHitEnemy=e;combo++;comboTimer=2;bestCombo=Math.max(bestCombo,combo);score+=Math.floor(amount*3);
  burst(e.x,e.y-48,'#ffe2a1',8);sfx('hit');hitstop=.035;shake=3;
  if(e.hp<=0){
    if(e.boss&&e.type==='regent'&&e.phase===1){e.phase=2;e.hp=e.maxhp=850*(difficulty==='story'?.84:1.2);e.state='transform';e.timer=2.7;e.inv=2.7;e.attackNo=0;flash=.65;shake=12;toast='THE PALE REGENT · FINAL FORM';toastTime=4;effects.push({x:e.x,y:e.y,age:0,life:.8,type:'explosion'});return;}
    if(e.type==='raptor'&&!e.boss){e.state='flee';e.timer=1.2;e.hp=1;e.inv=2;e.dir=1;score+=300;kills++;return;}
    e.dead=1;e.state='dead';score+=e.boss?2000:250;kills++;
    if(!e.boss&&e.type==='gunner')drops.push({x:e.x,y:e.y,type:levelIndex>2?'uzi':'gun',life:60});
    else if(!e.boss&&e.type==='knifer')drops.push({x:e.x,y:e.y,type:'knife',life:60});
    else if(!e.boss&&Math.random()<.2)drops.push({x:e.x,y:e.y,type:'food',life:60});
  }
}

function damagePlayer(amount,fromX,ignoreAir=false) {
  if(player.inv>0||(!ignoreAir&&player.z>28)||player.special>0||player.boost>0)return;
  player.hp-=amount*(difficulty==='story'?.7:1);player.hurt=amount>=20?.85:.3;player.knocked=amount>=20;
  player.inv=amount>=20?1.25:.65;player.x+=fromX<player.x?23:-23;player.attack=0;player.pendingStrike=null;player.z=0;player.vz=0;combo=0;comboTimer=0;
  if(player.knocked)dropWeapon();shake=6;flash=.06;sfx('hurt');burst(player.x,player.y-45,'#eea575',8);
  if(player.hp<=0){lives--;if(lives>0){player.hp=player.maxhp;player.inv=3;player.hurt=0;player.knocked=false;dropWeapon();toast=`${lives} LIVES REMAINING`;toastTime=3;checkpoint();}else gameover();}
}

function shoot(x,y,dir,friendly=true,damage=18,speed=620){bullets.push({x,y,z:level.drive?28:48,vx:dir*speed,vy:0,friendly,damage,life:1.5,color:friendly?'#fff4af':'#ef8f68'});}
function attack() {
  if(player.hurt>0||player.attack>0||player.special>0||bossIntro>0)return;
  if(!level.drive&&!player.weapon&&player.z===0&&drops.some(d=>d.type!=='food'&&Math.hypot(d.x-player.x,d.y-player.y)<38)){pickup();player.attack=.2;return;}
  if(level.drive){player.attack=.5;player.attackTotal=.5;player.boost=.5;meleeStrike(155,48,true);sfx('hit');return;}
  if(weaponAttack())return;
  const h=HEROES[selected];player.comboStep=(player.comboStep+1)%3;
  player.attackKind=player.z>8?'air':player.run?'dash':'combo';
  player.attackTotal=player.attackKind==='dash'?.52:player.attackKind==='air'?.45:.3;
  player.attack=player.attackTotal;
  const finish=player.comboStep===2,reach=player.attackKind==='dash'?125:player.attackKind==='air'?108:79;
  player.pendingStrike={t:player.attackKind==='combo'?.095:.08,range:reach,power:h.power*(finish?1.45:1)*(player.attackKind==='combo'?1:1.5),down:finish||player.attackKind!=='combo'};
  if(player.attackKind==='dash'){player.dashVelocity=player.dir*(selected===0?440:320);if(selected===0){player.z=16;player.vz=140;}}
  sfx('swing');
}

function jump(){if(player.z>0||player.hurt>0)return;if(level.drive){if(player.boostCd<=0){player.boost=1.15;player.boostCd=3;player.inv=1.2;sfx('jump');}return;}player.vz=355;player.z=.1;sfx('jump');}
function special() {
  if(player.specialCd>0||player.hurt>0||bossIntro>0)return;
  player.special=.65;player.specialCd=1.9;player.inv=.8;player.attack=0;player.pendingStrike=null;
  if(!level.drive)dropWeapon();let hits=0;
  for(const e of enemies)if(!e.dead&&e.state!=='flee'&&Math.hypot((e.x-player.x)*.8,e.y-player.y)<140){damageEnemy(e,HEROES[selected].power*2.2,Math.sign(e.x-player.x)*46,true);hits++;}
  if(hits&&!level.drive)player.hp=Math.max(1,player.hp-8);
  for(const o of objects)if(o.hp>0&&Math.abs(o.x-player.x)<115&&Math.abs(o.y-player.y)<65)breakObject(o,99);
  sfx('special');shake=6;burst(player.x,player.y-40,HEROES[selected].color,22);
}

function pickup() {
  if(player.hurt>0||player.z>0||level.drive)return;
  let nearest=null,dist=58;
  for(const d of drops){const dd=Math.hypot(d.x-player.x,(d.y-player.y)*1.2);if(dd<dist){dist=dd;nearest=d;}}
  if(nearest){
    if(nearest.type==='food'){player.hp=Math.min(player.maxhp,player.hp+45);popup(player.x,player.y-96,'+45 HEALTH','#d5ec69');}
    else{dropWeapon();player.weapon=nearest.type==='grenade'?'grenade':nearest.type;player.ammo=nearest.ammo??WEAPONS[player.weapon]?.ammo??1;toast=`${WEAPONS[player.weapon]?.name||player.weapon} · ${player.ammo} ${WEAPONS[player.weapon]?.melee?'HITS':'SHOTS'}`;toastTime=2;}
    drops.splice(drops.indexOf(nearest),1);sfx('pickup');score+=75;return;
  }
  if(player.weapon){bullets.push({x:player.x,y:player.y,z:45,vx:player.dir*400,vy:0,friendly:true,damage:42,life:1.3,kind:'thrown',weapon:player.weapon,age:0});player.weapon=null;player.ammo=0;sfx('swing');}
}

function bossMove(e) {
  const patterns={warden:['jab','charge','volley'],truck:['volley','charge','bombard'],raptor:['charge','acid','leap'],cinder:['cleave','charge','fire'],echo:['volley','leap','summon'],regent:e.phase===2?['slam','charge','spines','leap']:['volley','pulse','summon']};
  e.action=patterns[e.type][e.attackNo++%patterns[e.type].length];e.state='windup';e.timer=['charge','leap'].includes(e.action)?.85:.72;
  e.dir=Math.sign(player.x-e.x)||-1;e.targetX=player.x;e.targetY=player.y;e.startX=e.x;e.startY=e.y;
  if(['slam','pulse','acid','cleave','fire','bombard'].includes(e.action)){
    const x=e.action==='cleave'?e.x+e.dir*72:e.action==='fire'?e.x+e.dir*130:player.x;
    zones.push({x,y:e.action==='cleave'?e.y:player.y,r:e.action==='slam'?112:e.action==='fire'?95:75,t:e.timer,total:e.timer,friendly:false,damage:e.phase===2?32:24,air:e.action!=='acid',style:e.action});
  }
  toast={charge:'SIDESTEP THE CHARGE',leap:'MOVE AWAY FROM THE LANDING',slam:'JUMP THE SHOCKWAVE',cleave:'BACK AWAY FROM THE CLEAVE',acid:'LEAVE THE MARKED AREA',spines:'CHANGE LANES',volley:'CHANGE LANES',fire:'JUMP OR STEP ASIDE',pulse:'JUMP THE PULSE',summon:'REINFORCEMENTS INCOMING',jab:'DODGE THE COMBO',bombard:'KEEP MOVING'}[e.action];toastTime=1.3;
}

function executeBoss(e) {
  if(e.action==='volley'||e.action==='spines')for(let j=-1;j<=1;j++){shoot(e.x+e.dir*35,e.y+j*32,e.dir,false,20,330);}
  if(e.action==='charge'){e.state='charge';e.timer=.65;e.vx=e.dir*(e.type==='truck'?420:450);return;}
  if(e.action==='leap'){e.state='leap';e.timer=.85;e.startX=e.x;e.startY=e.y;return;}
  if(e.action==='jab'&&Math.abs(player.x-e.x)<115&&Math.abs(player.y-e.y)<39)damagePlayer(24,e.x);
  if(e.action==='summon'&&enemies.filter(v=>!v.dead&&!v.boss).length<2){spawnEnemy(e.x-100,310,levelIndex===5?'mutant':'knifer');spawnEnemy(e.x+70,382,'gunner');}
  e.state='recover';e.timer=e.type==='regent'&&e.phase===2?.7:1.1;
}

function updateEnemy(e,dt) {
  e.anim+=dt;e.hurt=Math.max(0,e.hurt-dt);e.inv=Math.max(0,e.inv-dt);e.hitTimer=Math.max(0,e.hitTimer-dt);e.timer-=dt;
  if(e.dead){e.dead-=dt;if(e.dead<=0)e.remove=true;return;}
  if(e.state==='flee'){e.x+=290*dt;if(e.timer<=0)e.remove=true;return;}
  if(['intro','transform','down','recover'].includes(e.state)){if(e.timer<=0){e.state='walk';e.timer=e.boss?.45:.65;}return;}
  if(e.hurt>0)return;
  if(e.state==='hurt'){if(e.timer<=0){e.state='walk';e.timer=.55;}return;}
  if(e.state==='windup'){
    if(e.timer<=0){if(e.boss)executeBoss(e);else{
      if(['gunner','biker'].includes(e.type))shoot(e.x+e.dir*25,e.y,e.dir,false,14,340);
      else if(Math.abs(e.x-player.x)<85&&Math.abs(e.y-player.y)<35)damagePlayer(e.type==='brute'||e.type==='mutant'?24:14,e.x);
      e.state='recover';e.timer=e.type==='brute'?.8:.5;
    }}return;
  }
  if(e.state==='leap'){
    const p=clamp(1-e.timer/.85,0,1);e.x=e.startX+(e.targetX-e.startX)*p;e.y=e.startY+(e.targetY-e.startY)*p;e.z=Math.sin(p*Math.PI)*120;
    if(e.timer<=0){e.z=0;zones.push({x:e.x,y:e.y,r:90,t:.12,total:.12,friendly:false,damage:28,air:true});e.state='recover';e.timer=1.3;}return;
  }
  if(e.state==='charge'){
    e.x+=e.vx*dt;if(Math.abs(e.x-player.x)<(e.type==='truck'?110:75)&&Math.abs(e.y-player.y)<37)damagePlayer(28,e.x-e.dir*60);
    if(lock)e.x=clamp(e.x,lock.left+30,lock.right-42);
    if(e.timer<=0){e.state='recover';e.timer=1.35;}return;
  }
  e.dir=Math.sign(player.x-e.x)||e.dir;const distance=Math.abs(player.x-e.x),dy=Math.abs(player.y-e.y);
  const speed=(e.boss?e.phase===2?105:80:({brute:60,raptor:138,mutant:102,knifer:115}[e.type]||94))*(difficulty==='arcade'?1.14:1);
  const range=['gunner','biker'].includes(e.type)?235:e.boss?120:53;
  const flank=!e.boss&&enemies.some(o=>o!==e&&!o.dead&&Math.abs(o.x-player.x)<70&&Math.abs(o.y-player.y)<24);
  const targetY=flank?clamp(player.y+(e.id>.5?38:-38),288,390):player.y;
  if(distance>range-8)e.x+=e.dir*speed*dt;
  e.y=approach(e.y,targetY,speed*.6*dt);
  if(e.type==='gunner'&&distance<145)e.x-=e.dir*speed*.7*dt;
  if(e.timer<=0&&distance<range+25&&dy<(e.boss?130:32)){if(e.boss)bossMove(e);else{e.state='windup';e.timer=e.type==='brute'?.62:.38;}}
  if(lock)e.x=clamp(e.x,lock.left+28,lock.right-42);e.y=clamp(e.y,284,393);
}

function gamepad(){const pads=navigator.getGamepads?.()||[];const p=Array.from(pads).find(Boolean);if(!p){padKeys.clear();return;}const map=['KeyK','KeyE','KeyJ','KeyL'];for(let i=0;i<4;i++){if(p.buttons[i]?.pressed){if(!padKeys.has(map[i]))pressed.add(map[i]);padKeys.add(map[i]);}else padKeys.delete(map[i]);}for(const [key,on] of [['ArrowLeft',p.axes[0]<-.3||p.buttons[14]?.pressed],['ArrowRight',p.axes[0]>.3||p.buttons[15]?.pressed],['ArrowUp',p.axes[1]<-.3||p.buttons[12]?.pressed],['ArrowDown',p.axes[1]>.3||p.buttons[13]?.pressed]]){if(on)padKeys.add(key);else padKeys.delete(key);}if(p.buttons[9]?.pressed&&!gamepad.pauseHeld)pause();gamepad.pauseHeld=p.buttons[9]?.pressed;}
const down=(...ks)=>ks.some(k=>keys.has(k)||padKeys.has(k)),tap=(...ks)=>ks.some(k=>pressed.has(k));
function update(dt) {
  time+=dt;music(dt);if(state!=='play'){pressed.clear();return;}gamepad();if(state!=='play')return;
  if(hitstop>0){hitstop-=dt;return;}
  stageTimer+=dt;runTime+=dt;const h=HEROES[selected];player.anim+=dt;bossIntro=Math.max(0,bossIntro-dt);dashTime=Math.max(0,dashTime-dt);
  for(const k of ['inv','hurt','attack','special','specialCd','boost','boostCd'])player[k]=Math.max(0,player[k]-dt);
  player.recoil=approach(player.recoil||0,0,30*dt);if(player.hurt<=0)player.knocked=false;
  let dx=(down('ArrowRight','KeyD')?1:0)-(down('ArrowLeft','KeyA')?1:0),dy=(down('ArrowDown','KeyS')?1:0)-(down('ArrowUp','KeyW')?1:0);
  player.run=down('ShiftLeft','ShiftRight')||(dashTime>0&&down(dashKey));player.move=!!(dx||dy);
  if(dx&&player.attack<=0)player.dir=dx;
  if(player.hurt<=0&&player.special<=0&&bossIntro<=0){
    const speed=level.drive?205:h.speed*(player.run?1.68:1);const drag=player.attack>0&&!level.drive?.18:1;
    player.x+=(dx*speed*drag+(level.drive&&dx>=0?105*(player.boost>0?2.5:1):0))*dt;player.y+=dy*speed*.64*dt;
    if(dx&&dy){player.x-=dx*speed*drag*dt*.22;player.y-=dy*speed*.64*dt*.22;}
    if(player.attack>0&&player.attackKind==='dash'){player.x+=(player.dashVelocity||0)*dt;player.dashVelocity=approach(player.dashVelocity,0,600*dt);}
  }
  player.x=clamp(player.x,lock?lock.left+30:camera+25,lock?lock.right-70:level.length+130);player.y=clamp(player.y,284,393);
  if(player.z>0){player.vz-=850*dt;player.z+=player.vz*dt;if(player.z<=0){player.z=0;player.vz=0;burst(player.x,player.y,'#8b9470',4);}}
  if(player.pendingStrike){player.pendingStrike.t-=dt;if(player.pendingStrike.t<=0){const hit=player.pendingStrike;meleeStrike(hit.range,hit.power,hit.down);player.pendingStrike=null;}}
  if(down('KeyJ','KeyZ','Space')&&tap('KeyK','KeyX'))special();
  else{if(down('KeyJ','KeyZ','Space'))attack();if(tap('KeyK','KeyX'))jump();}
  if(tap('KeyL','KeyC'))special();if(tap('KeyE','KeyV'))pickup();
  for(const d of [...drops]){d.life-=dt;if(d.type==='food'&&Math.hypot(d.x-player.x,d.y-player.y)<27){player.hp=Math.min(player.maxhp,player.hp+45);popup(player.x,player.y-90,'+45 HEALTH','#d5ec69');drops.splice(drops.indexOf(d),1);sfx('pickup');}else if(d.life<=0)drops.splice(drops.indexOf(d),1);}
  for(const e of enemies)updateEnemy(e,dt);enemies=enemies.filter(e=>!e.remove);
  if(level.drive)for(const e of enemies)if(!e.dead&&Math.abs(e.x-player.x)<98&&Math.abs(e.y-player.y)<29&&e.state!=='intro')damageEnemy(e,player.boost>0?28:13,25,true);
  updateProjectiles(dt);
  for(const z of zones){z.t-=dt;if(z.t<=0){burst(z.x,z.y-20,z.friendly?'#efb36d':'#c7ea91',24);effects.push({x:z.x,y:z.y,age:0,life:.55,type:'explosion'});shake=7;if(z.friendly){for(const e of enemies)if(Math.hypot((e.x-z.x)*.8,e.y-z.y)<z.r)damageEnemy(e,z.damage,Math.sign(e.x-z.x)*35,true);}else if(Math.hypot((player.x-z.x)*.8,player.y-z.y)<z.r&&(!z.air||player.z<25))damagePlayer(z.damage,z.x,!z.air);}}
  zones=zones.filter(z=>z.t>0);
  // Foundry vents and lab discharges announce their location before activating.
  if(!bossSpawned&&lock&&wave>=3&&(levelIndex===3||levelIndex===4)&&Math.floor(stageTimer/9)>Math.floor((stageTimer-dt)/9))zones.push({x:player.x+90,y:levelIndex===3?370:300,r:58,t:1.25,total:1.25,friendly:false,damage:18,air:true});
  for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=320*dt;p.life-=dt;}particles=particles.filter(p=>p.life>0);
  for(const f of floating){f.y-=30*dt;f.life-=dt;}floating=floating.filter(f=>f.life>0);
  if(comboTimer>0){comboTimer-=dt;if(comboTimer<=0)combo=0;}toastTime=Math.max(0,toastTime-dt);shake=Math.max(0,shake-dt*22);flash=Math.max(0,flash-dt);
  if(lock&&enemies.length===0){lock=null;toast=bossSpawned?'PATH TO EDEN IS CLEAR':'GO →';toastTime=2.5;if(bossSpawned){stageClear();return;}drops.push({x:player.x+90,y:player.y,type:wave%2?'food':'grenade',life:75});score+=500;}
  if(!lock&&!bossSpawned&&wave<6&&player.x>390+wave*555)spawnWave(wave+1);
  if(!lock&&wave>=6&&!bossSpawned&&player.x>level.length-450)spawnBoss();
  const target=clamp(player.x-255,0,level.length-W+180);camera=approach(camera,target,500*dt);pressed.clear();
}

function rect(g,x,y,w,h,c){g.fillStyle=c;g.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
function poly(g,pts,c){g.fillStyle=c;g.beginPath();pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fill();}
function noise(n){return Math.abs(Math.sin(n*127.1+311.7)*43758.5453)%1;}
function tree(g,x,y,s=1,theme='jungle'){g.save();g.translate(Math.round(x),y);g.scale(s,s);rect(g,-9,-138,19,145,'#26382e');rect(g,1,-127,7,132,'#48543a');poly(g,[[-3,-130],[-36,-183],[-20,-188],[10,-125]],'#344537');const colors=theme==='harbor'?['#315e42','#497c4b','#6c8e53']:['#274a35','#3b6140','#577444','#6f8a50'];for(let k=0;k<30;k++){const xx=(noise(k+x)-.5)*135,yy=-130-noise(k*8+x)*70;rect(g,xx,yy,24+noise(k+4)*25,10+noise(k+7)*18,colors[k%4]);}for(let k=0;k<6;k++)rect(g,-3+k*2,-185+k*12,3,11,'#6c8447');g.restore();}
function building(g,x,y,w,h,seed=1){rect(g,x,y-h,w,h,'#334a48');rect(g,x+5,y-h+3,w-9,h-3,'#425b54');rect(g,x+w-15,y-h+3,14,h,'#2c403d');for(let yy=y-h+12;yy<y-8;yy+=17)for(let xx=x+9;xx<x+w-18;xx+=17){rect(g,xx,yy,8,11,noise(xx+yy+seed)>.7?'#8e9d71':'#243e3d');rect(g,xx,yy,8,2,'#607c69');}for(let j=0;j<7;j++){const xx=x+noise(j+seed)*w;rect(g,xx,y-h+noise(j+8)*h,4,30,'#607847');}poly(g,[[x,y-h],[x+12,y-h-8],[x+w-9,y-h-8],[x+w,y-h]],'#62766a');}
function background(g,idx,cam,t){if(stageBackdrop(g,idx,cam,t))return;const l=LEVELS[idx],grad=g.createLinearGradient(0,0,0,270);grad.addColorStop(0,l.sky[0]);grad.addColorStop(1,l.sky[1]);g.fillStyle=grad;g.fillRect(0,0,W,H);if(l.theme==='harbor'||l.theme==='highway'){g.fillStyle='#e7c18a';g.beginPath();g.arc(585-cam*.025,92,35,0,Math.PI*2);g.fill();for(let j=0;j<4;j++)rect(g,0,65+j*13,W,3,l.sky[0]+'35');}
 if(l.theme==='harbor'||l.theme==='highway'||l.theme==='foundry'){for(let j=-1;j<12;j++){const x=j*94-((cam*.18)%94),h=50+noise(j+15)*125;building(g,x,225,65+noise(j)*34,h,j+8);}}
 if(l.theme==='harbor'){rect(g,0,207,W,47,'#677f6c');for(let j=0;j<14;j++)rect(g,(j*77+Math.sin(t+j)*8-cam*.1)%W,210+j%5*7,55,2,j%2?'#a9ad82':'#3c655a');for(let j=0;j<4;j++){const x=j*300-((cam*.5)%300);rect(g,x+22,127,8,118,'#283f3d');poly(g,[[x+22,134],[x+135,116],[x+148,123],[x+30,143]],'#2e4640');rect(g,x+132,120,2,61,'#394d45');}poly(g,[[0,244],[W,244],[W,281],[0,281]],'#4b6850');}
 if(l.theme==='jungle'||l.theme==='highway'||l.theme==='eden'){for(let j=-1;j<8;j++)tree(g,j*140-((cam*.27)%140),277,.95,l.theme);for(let j=-1;j<6;j++)tree(g,j*220-((cam*.55)%220),286,1.3,l.theme);}
 if(l.theme==='highway'){rect(g,0,217,W,13,'#526553');rect(g,0,228,W,6,'#abb58b');for(let j=-1;j<6;j++)rect(g,j*190-((cam*.6)%190),230,15,59,'#53604b');}
 if(l.theme==='foundry'){for(let j=-1;j<5;j++){const x=j*235-((cam*.45)%235);rect(g,x,74,180,180,'#373e38');rect(g,x+12,88,156,150,'#464b40');rect(g,x+48,26,34,110,'#3e4840');rect(g,x+53,26,6,92,'#69705a');for(let k=0;k<5;k++){rect(g,x+22+k*27,138,17,48,'#d48b4d');rect(g,x+25+k*27,140,10,41,'#f3b362');}rect(g,x+14,207,150,30,'#303b34');for(let k=0;k<7;k++)rect(g,x+16+k*23,207,12,4,'#b78c52');for(let k=0;k<5;k++)rect(g,x+55+Math.sin(t*.6+k)*13,12-k*16,35+k*8,12,'#73816a55');}}
 if(l.theme==='lab'||l.theme==='eden'){rect(g,0,0,W,255,l.theme==='lab'?'#1a333a':'#193a2e');for(let j=-1;j<5;j++){const x=j*245-((cam*.55)%245);rect(g,x,18,225,241,'#31534b');rect(g,x+8,27,209,220,'#233e3b');rect(g,x+13,34,197,3,l.accent);rect(g,x+24,61,65,166,'#466d5c');rect(g,x+29,68,55,151,'#325449');for(let k=0;k<7;k++)rect(g,x+33,80+k*18,47,2,'#719377');rect(g,x+111,76,66,141,'#253f43');rect(g,x+118,82,52,127,'#4a786d');if(l.theme==='lab'){drawDino(g,x+145,187,.38,-1,'#8eb89c',true,t);rect(g,x+118,82,52,127,'#82ebcb18');}else{for(let k=0;k<14;k++)rect(g,x+119+noise(k)*43,92+noise(k+2)*111,7,8,['#a5b868','#a58954','#6f9958'][k%3]);}rect(g,x+98,232,95,7,'#789e82');}if(l.theme==='eden'){for(let j=-1;j<5;j++)tree(g,j*260-((cam*.65)%260),290,.9);}}
 const ground=g.createLinearGradient(0,GROUND,0,H);ground.addColorStop(0,l.road[0]);ground.addColorStop(1,l.road[1]);g.fillStyle=ground;g.fillRect(0,GROUND,W,H-GROUND);rect(g,0,GROUND,W,8,'#8f9a6b');rect(g,0,GROUND+8,W,3,'#233c2d');
 if(l.drive){rect(g,0,GROUND+15,W,147,'#454b40');for(let lane=0;lane<3;lane++)for(let j=-1;j<9;j++)rect(g,j*115-((cam+t*95)%115),300+lane*43,54,3,'#b3b083');rect(g,0,414,W,3,'#8c966b');}
 else{for(let j=0;j<12;j++){const y=281+j*15;rect(g,0,y,W,1,'#243c324a');for(let k=-1;k<9;k++){const x=k*120+(j%2)*60-(cam%120);rect(g,x,y,1,15,'#a8af7920');}}for(let j=0;j<130;j++){const x=((noise(j+9)*W-cam*.85)%W+W)%W,y=275+noise(j+41)*150;rect(g,x,y,2+noise(j)*6,1,noise(j+1)>.5?'#9da76d45':'#16362666');}}
 if(l.theme==='harbor'){for(let j=-1;j<4;j++){const x=j*530-(cam%530);rect(g,x+340,245,9,28,'#2c4136');rect(g,x+380,245,9,28,'#2c4136');rect(g,x+335,241,59,7,'#6c7950');rect(g,x+347,250,31,3,'#9f9d65');}}
 if(l.theme==='foundry'){for(let j=-1;j<5;j++){const x=j*380-(cam%380);rect(g,x+50,262,90,15,'#a67e45');for(let k=0;k<9;k++)poly(g,[[x+50+k*10,262],[x+55+k*10,262],[x+65+k*10,277],[x+60+k*10,277]],'#323f35');}}
 for(let j=0;j<5;j++){const x=((j*237-cam*.72)%920+920)%920-60;const yy=241;poly(g,[[x,yy],[x+5,yy-18],[x+8,yy],[x+14,yy-12],[x+15,yy]],'#7a9254');}
}
function drawFrame(g,f,x,y,scale=1.35,dir=1,filter='none'){if(!f||!sheet.complete)return;g.save();g.imageSmoothingEnabled=false;g.translate(Math.round(x),Math.round(y));g.scale(-dir*scale,scale);g.filter=filter;g.drawImage(sheet,f.x,f.y,f.w,f.h,-f.anchor,-f.h,f.w,f.h);g.restore();}
function shadow(g,x,y,w=25){g.fillStyle='#10271b66';g.beginPath();g.ellipse(x,y,w,6,0,0,Math.PI*2);g.fill();}
function drawDino(g,x,y,s,dir,color='#849955',mutant=false,t=0){g.save();g.translate(Math.round(x),Math.round(y));g.scale(dir*s,s);const leg=Math.sin(t*10)*7;poly(g,[[-77,-30],[-127,-18],[-112,-10],[-51,-13],[-13,8],[31,-4],[36,-53],[73,-77],[90,-104],[45,-112],[29,-104],[15,-86],[-6,-65],[-38,-55]],'#20382d');poly(g,[[-74,-29],[-119,-17],[-49,-24],[-17,0],[25,-6],[28,-56],[71,-83],[83,-101],[45,-106],[32,-98],[19,-78],[-9,-61],[-37,-50]],color);poly(g,[[-39,-48],[-20,-57],[11,-57],[22,-39],[11,-12],[-16,-6]],mutant?'#c6d1af':'#adba75');poly(g,[[17,-65],[38,-69],[42,-59],[26,-53],[25,-34],[15,-37]],'#cad391');poly(g,[[42,-97],[78,-99],[88,-91],[43,-83]],'#2c4132');for(let j=0;j<5;j++)poly(g,[[47+j*7,-96],[50+j*7,-88],[53+j*7,-96]],'#e6e7c7');rect(g,54,-105,8,5,mutant?'#ef9360':'#ecdb77');rect(g,56,-105,3,5,'#162f23');poly(g,[[-6,-9],[-12+leg,12],[-31+leg,24],[-4+leg,24],[14,-1]],'#4d633a');poly(g,[[15,-2],[27-leg,15],[8-leg,24],[37-leg,24],[37,-9]],color);rect(g,-31+leg,21,29,4,'#ddd8ad');rect(g,8-leg,21,29,4,'#ddd8ad');if(mutant){for(let j=0;j<5;j++)poly(g,[[-39+j*15,-49+j*2],[-32+j*15,-70+j*2],[-23+j*15,-50+j*2]],'#d3dfb9');for(let j=0;j<3;j++)rect(g,-30+j*12,-32,5,8,'#90d88b');}g.restore();}
function drawRegent(g,e,x,y){g.save();g.translate(x,y);g.scale(e.dir,1);shadow(g,0,2,70);const bob=Math.sin(e.anim*3)*2;g.translate(0,bob);poly(g,[[-82,-40],[-150,-14],[-150,-5],[-64,-14],[-17,5],[52,-6],[59,-84],[90,-123],[108,-139],[105,-161],[48,-171],[28,-155],[14,-114],[-28,-101],[-66,-83]],'#233b35');poly(g,[[-80,-38],[-143,-11],[-56,-27],[-16,-1],[47,-9],[49,-86],[85,-128],[103,-142],[100,-157],[49,-165],[34,-147],[23,-104],[-29,-95],[-62,-78]],'#cbd2b5');poly(g,[[-55,-76],[-29,-92],[14,-97],[36,-75],[34,-33],[-12,-9],[-38,-28]],'#94a991');for(let k=0;k<6;k++)poly(g,[[-62+k*15,-81-k*4],[-59+k*15,-103-k*4],[-47+k*15,-84-k*4]],'#e9ebce');poly(g,[[43,-145],[101,-147],[112,-136],[47,-126]],'#263b36');for(let j=0;j<6;j++)poly(g,[[49+j*9,-146],[52+j*9,-132],[56+j*9,-146]],'#f3efd8');rect(g,67,-157,12,5,'#f6ab64');rect(g,71,-158,3,7,'#b7473c');poly(g,[[22,-100],[57,-104],[62,-95],[38,-87],[34,-52],[22,-57]],'#bbc9a7');poly(g,[[-14,-9],[-31,15],[-60,26],[-24,26],[8,-5]],'#98ab8a');poly(g,[[29,-8],[49,12],[23,25],[66,25],[58,-20]],'#d5dbc1');rect(g,-59,22,36,5,'#f0e8cc');rect(g,25,21,43,5,'#f0e8cc');rect(g,-33,-68,38,26,'#365e4d');rect(g,-28,-64,29,17,'#b7e280');rect(g,-22,-62,5,13,'#e5f2aa');for(let j=0;j<4;j++)rect(g,-39,-22-j*10,19,3,'#728e78');g.restore();}
function car(g,x,y,scale=1,boost=false,t=0){g.save();g.translate(x,y);g.scale(scale,scale);shadow(g,0,4,72);poly(g,[[-77,-31],[-57,-53],[-27,-59],[26,-57],[45,-39],[78,-34],[87,-11],[75,-3],[-73,-3],[-86,-11]],'#1b3029');poly(g,[[-78,-29],[-51,-46],[39,-42],[77,-30],[82,-13],[-79,-13]],'#78ac79');poly(g,[[-39,-53],[-24,-57],[23,-55],[35,-43],[-48,-44]],'#d7d1a0');poly(g,[[-37,-52],[-24,-54],[-5,-54],[-5,-43],[-46,-44]],'#315653');poly(g,[[0,-54],[23,-52],[32,-43],[0,-43]],'#315653');rect(g,-75,-26,150,5,'#a8c394');rect(g,-64,-13,127,5,'#496e51');rect(g,69,-25,13,8,'#fff1bd');rect(g,-81,-23,7,8,'#d4945e');rect(g,-86,-11,171,4,'#ddd7ae');for(const xx of [-48,50]){g.fillStyle='#17231e';g.beginPath();g.arc(xx,-3,16,0,Math.PI*2);g.fill();g.fillStyle='#829a83';g.beginPath();g.arc(xx,-3,9,0,Math.PI*2);g.fill();rect(g,xx-2,-9,4,12,'#c4c9a6');rect(g,xx-6,-5,12,4,'#c4c9a6');}rect(g,3,-27,13,3,'#d4daba');rect(g,22,-22,15,2,'#314e3d');if(boost){poly(g,[[-85,-17],[-124-Math.sin(t*20)*18,-4],[-105,-20],[-137,-27],[-84,-23]],'#eaaa56');poly(g,[[-85,-17],[-117,-11],[-104,-23],[-84,-21]],'#e9df91');}g.restore();}
function truck(g,e,x,y){g.save();g.translate(x,y);shadow(g,0,5,110);rect(g,-92,-96,123,79,'#46564b');rect(g,-89,-91,118,11,'#728069');rect(g,-84,-74,105,47,'#2c4037');for(let j=0;j<5;j++)rect(g,-80+j*21,-69,3,40,'#687958');poly(g,[[25,-68],[66,-68],[94,-47],[106,-25],[100,-8],[23,-8]],'#7d8662');rect(g,34,-62,31,23,'#263e38');rect(g,73,-40,23,11,'#c6c59a');rect(g,26,-25,73,8,'#425b44');rect(g,-97,-13,202,7,'#bbc29c');for(const xx of [-62,64]){g.fillStyle='#192f25';g.beginPath();g.arc(xx,-7,22,0,Math.PI*2);g.fill();g.fillStyle='#91a27b';g.beginPath();g.arc(xx,-7,11,0,Math.PI*2);g.fill();}rect(g,-25,-113,43,13,'#596c54');rect(g,-57,-109,36,7,'#a8b28a');g.restore();}
function drawFighter(e) {
  const x=e.x-camera,y=e.y-e.z;ctx.save();shadow(ctx,x,e.y,e.boss?42:25);
  if(e.dead)ctx.globalAlpha=clamp(e.dead/.75,0,1);
  const name=e.type==='warden'?'echo':e.type==='cinder'?'brute':e.type==='raptor'&&e.boss?'thornmaw':e.type==='raptor'&&e.state==='flee'?'calmraptor':e.type==='regent'?(e.phase===2?'regent':'mutant'):e.type==='biker'?'knifer':e.type;
  if(e.type==='truck')truck(ctx,e,x,y);
  else {
    const data=COMBAT_ART.groups[name]||COMBAT_ART.groups.raider;
    const action=e.dead||e.state==='down'?'down':e.hurt>0?'hurt':['windup','charge','leap'].includes(e.state)?'attack':e.state==='recover'?'rise':'walk';
    const seq=data[action]||data.walk;const n=seq[Math.floor(e.anim*(action==='walk'?8:5))%seq.length];
    const f=COMBAT_ART.frames[n];const scale=e.boss?(e.type==='regent'&&e.phase===2?1.9:e.type==='raptor'?1.25:1.65):e.type==='raptor'?1.1:1.3;
    let filter=e.type==='regent'&&e.phase===2?'saturate(.3) brightness(1.45)':e.type==='echo'?'hue-rotate(100deg)':e.type==='cinder'?'hue-rotate(325deg)':e.type==='warden'?'hue-rotate(335deg)':'none';
    if(e.hurt>0)filter+=' brightness(1.6)';
    drawCombat(ctx,f,x,y,scale,e.dir,filter);
    // Recovered poacher poses already include their held firearm.
    if(e.type==='knifer'&&e.state==='windup')weaponSprite(ctx,'knife',x+e.dir*32,y-45,1,e.dir);
    if(e.type==='biker'){const f=COMBAT_ART.frames[305];drawCombat(ctx,f,x,y+8,1.05,e.dir);}
  }
  if(e.state==='windup'){label('!',x,y-(e.boss?158:112),24,'#ffbf71','center');}
  if(!e.boss&&e.hp<e.maxhp&&!e.dead&&e.state!=='flee'){rect(ctx,x-23,e.y-112,46,4,'#172e24');rect(ctx,x-23,e.y-112,46*e.hp/e.maxhp,4,'#e7b16e');}
  if(e.state==='leap'){ctx.strokeStyle='#ffbf71';ctx.beginPath();ctx.ellipse(e.targetX-camera,e.targetY,55,20,0,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}

function drawPlayer() {
  const x=player.x-camera,y=player.y-player.z;ctx.save();shadow(ctx,x,player.y,level.drive?72:27);
  if(player.inv>0&&Math.floor(time*16)%2===0)ctx.globalAlpha=.65;
  if(level.drive)car(ctx,x,y,1,player.boost>0||player.special>0,time);
  else {
    const data=A[HEROES[selected].id];let anim=player.special>0?'special':player.hurt>0?'hurt':player.attack>0?'attack':player.z>0?'jump':player.move?'walk':'idle';
    let list=data[anim],frame=player.attack>0&&anim==='attack'?Math.floor((1-player.attack/player.attackTotal)*list.length):player.special>0?Math.floor((.65-player.special)*18):Math.floor(player.anim*(anim==='walk'?player.run?16:10:6));
    let chosen=list[frame%list.length];
    if(player.attack>0&&player.attackKind==='air')chosen=[4,28,27,28][selected];
    if(player.attack>0&&player.attackKind==='dash')chosen=[3,27,26,28][selected];
    if(player.weapon&&anim==='attack')chosen=data.attack[Math.min(1,data.attack.length-1)];
    if(player.knocked&&player.hurt>0){ctx.save();ctx.translate(x,y-10);ctx.rotate(-player.dir*1.2);drawFrame(ctx,data.frames[data.hurt[0]],0,0,1.35,player.dir);ctx.restore();}
    else drawFrame(ctx,data.frames[chosen],x,y,1.35,player.dir);
    if(player.weapon&&player.hurt<=0){const melee=WEAPONS[player.weapon]?.melee;const swing=melee&&player.attack>0?Math.sin((1-player.attack/player.attackTotal)*Math.PI)*-1.7*player.dir:0;weaponSprite(ctx,player.weapon,x+player.dir*(32-(player.recoil||0)),y-(melee?56:65),1,player.dir,swing);}
  }
  if(player.special>0){ctx.strokeStyle=HEROES[selected].color;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y-40,85*(1-player.special/.9),32,0,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}

function drawObject(o){if(o.hp<=0)return;const x=o.x-camera;shadow(ctx,x,o.y,23);if(o.type==='barrel'){drawFrame(ctx,A.enemies['5'][0],x,o.y,1,1);}else{rect(ctx,x-23,o.y-46,46,46,'#3b4c33');rect(ctx,x-21,o.y-44,42,40,'#9b7b4c');for(let j=0;j<3;j++)rect(ctx,x-18+j*13,o.y-42,2,38,'#5e603e');rect(ctx,x-23,o.y-43,46,6,'#bf9959');rect(ctx,x-23,o.y-9,46,6,'#bf9959');}}
function drawDrop(d) {
  const x=d.x-camera,y=d.y+Math.sin(time*4+d.x)*2;shadow(ctx,x,d.y,16);
  if(d.type==='food'){rect(ctx,x-12,y-13,24,10,'#d7bb73');rect(ctx,x-10,y-18,19,6,'#b25e42');rect(ctx,x-9,y-21,16,3,'#d28d55');rect(ctx,x-15,y-4,29,3,'#e4ddb0');}
  else weaponSprite(ctx,d.type==='grenade'?'grenade':d.type,x,y-12,.85,1);
  if(Math.hypot(d.x-player.x,d.y-player.y)<65&&d.type!=='food')label('J / E · '+(WEAPONS[d.type]?.name||d.type.toUpperCase()),x,y-35,10,'#f0e0a8','center');
}

function label(text,x,y,size=12,color='#ecebcf',align='left'){ctx.font=`bold ${size}px Consolas, monospace`;ctx.textAlign=align;ctx.fillStyle='#12261e';ctx.fillText(text,x+1,y+1);ctx.fillStyle=color;ctx.fillText(text,x,y);}
function hud(){rect(ctx,0,0,W,68,'#0c1d19dc');rect(ctx,0,67,W,1,'#678258');const h=HEROES[selected];const fr=A[h.id].frames[0];ctx.save();ctx.beginPath();ctx.rect(16,12,42,45);ctx.clip();drawFrame(ctx,fr,38,117,1.25,1);ctx.restore();rect(ctx,16,12,42,2,h.color);label(h.name,70,23,12,h.color);rect(ctx,70,31,182,10,'#374a35');rect(ctx,71,32,180*clamp(player.hp/player.maxhp,0,1),8,h.color);label(`${Math.ceil(player.hp)} / ${Math.ceil(player.maxhp)}   × ${lives}`,70,56,10,'#c1cba6');label(level.area,285,23,10,'#b0c19f');label(level.name,285,43,13,'#e6e7c8');label('SCORE '+score.toString().padStart(7,'0'),W-53,23,12,'#e1e6ba','right');label(level.drive?'CADILLAC · RAM / BOOST':player.weapon?(WEAPONS[player.weapon]?.name||player.weapon.toUpperCase())+' · '+player.ammo:'BARE HANDS',W-53,43,10,'#adc197','right');
 const b=enemies.find(e=>e.boss&&!e.dead);if(b){rect(ctx,193,H-41,382,24,'#0e231bdd');rect(ctx,203,H-30,362,7,'#384a35');rect(ctx,204,H-29,360*Math.max(0,b.hp/b.maxhp),5,b.phase===2?'#d5ec69':'#e9a56b');label(b.type==='regent'&&b.phase===2?'THE PALE REGENT':level.boss,W/2,H-35,10,'#efdfb8','center');}
 else{rect(ctx,18,H-19,130,3,'#2c4534');rect(ctx,18,H-19,130*clamp(player.x/level.length,0,1),3,'#9aad6b');label('CHAPTER 0'+(levelIndex+1),18,H-25,9,'#b8c59d');}
 if(combo>=2){label(combo+' HIT',W-22,102,27,'#d5ec69','right');label('COMBO',W-25,116,10,'#b7c69c','right');}
 if(toastTime>0){rect(ctx,W/2-250,78,500,25,'#153023dc');label(toast,W/2,95,11,'#e0e8a8','center');}
 if(player.specialCd>0){label('SPECIAL '+Math.ceil(player.specialCd)+'s',18,112,10,'#a6b797');}else label(level.drive?'L · RAM READY':'L · '+h.special.toUpperCase(),18,112,9,'#d5ec69');}
function render(){ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,W,H);ctx.save();if(shake>0)ctx.translate(rand(-shake,shake),rand(-shake/2,shake/2));
 if(!started||['menu','select','chapters','credits'].includes(state)){background(ctx,0,time*9,time);rect(ctx,0,0,W,H,'#0a221ec0');car(ctx,125,415,1.1,false,time);HEROES.forEach((h,i)=>{drawFrame(ctx,A[h.id].frames[0],340+i*90,424,1.1,1);});rect(ctx,0,0,W,H,'#05131030');}
 else{background(ctx,levelIndex,camera,time);for(const z of zones){const x=z.x-camera;ctx.fillStyle=z.friendly?'#efb36638':'#e77d5a30';ctx.beginPath();ctx.ellipse(x,z.y,z.r,z.r*.4,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=z.friendly?'#e8bd76':'#efa36b';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,z.y,z.r*(z.t/z.total),z.r*.4*(z.t/z.total),0,0,Math.PI*2);ctx.stroke();}
 const draws=[...objects.filter(o=>o.hp>0).map(o=>({y:o.y,fn:()=>drawObject(o)})),...drops.map(d=>({y:d.y,fn:()=>drawDrop(d)})),...enemies.map(e=>({y:e.y,fn:()=>drawFighter(e)})),{y:player.y,fn:drawPlayer}];draws.sort((a,b)=>a.y-b.y);draws.forEach(d=>d.fn());drawEffects();for(const p of particles)rect(ctx,p.x-camera,p.y,p.size,p.size,p.color);for(const f of floating)label(f.text,f.x-camera,f.y,12,f.color,'center');hud();
 if(lock&&!bossSpawned){label('CLEAR THE AREA',W/2,123,9,'#d4cf9e','center');}else if(!bossSpawned&&toastTime<=0){label('GO →',W-38,220,19,'#d5ec69','right');}if(state!=='play')rect(ctx,0,0,W,H,'#0b1a1688');}
 if(flash>0)rect(ctx,0,0,W,H,`rgba(226,239,170,${Math.min(.5,flash)})`);ctx.restore();}
function frame(now){const dt=Math.min(.033,(now-last)/1000||.016);last=now;update(dt);render();requestAnimationFrame(frame);}
window.addEventListener('keydown',e=>{const use=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyW','KeyA','KeyS','KeyD','KeyJ','KeyK','KeyL','KeyZ','KeyX','KeyC','KeyE','KeyV','ShiftLeft','ShiftRight','Enter','Escape','KeyP'];if(use.includes(e.code)&&(state==='play'||['ArrowLeft','ArrowRight','Enter','Escape','KeyP'].includes(e.code)))e.preventDefault();unlockAudio();if(e.code==='Escape'||e.code==='KeyP'){if(!e.repeat){if(state==='play'||state==='paused')pause();else if(e.code==='Escape'&&['select','chapters','guide','credits','jukebox'].includes(state))menu();}return;}if(!e.repeat&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyS'].includes(e.code)){const now=performance.now()/1000;if(lastDirection.key===e.code&&now-lastDirection.time<.28){dashTime=1.6;dashKey=e.code;}lastDirection={key:e.code,time:now};}if(!keys.has(e.code))pressed.add(e.code);keys.add(e.code);if(e.code==='Enter'&&!e.repeat){if(state==='menu')characterSelect();else if(state==='select')document.getElementById('begin')?.click();else if(state==='brief')document.getElementById('enter-stage')?.click();else if(state==='clear')document.getElementById('next')?.click();else if(state==='gameover')document.getElementById('retry')?.click();}if(state==='select'&&!e.repeat&&['ArrowLeft','ArrowRight'].includes(e.code)){selected=(selected+(e.code==='ArrowRight'?1:3))%4;characterSelect();}});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();pressed.clear();if(state==='play')pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='play')pause();});
document.querySelectorAll('[data-key]').forEach(b=>{const k=b.dataset.key;const release=()=>{keys.delete(k);touchKeys.delete(k);};b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);unlockAudio();if(!keys.has(k))pressed.add(k);keys.add(k);touchKeys.add(k);});b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);});
bindButton('pause',pause);bindButton('home',()=>{if(state==='play')pause();else menu();});bindButton('sound',()=>{const on=settings.music||settings.sfx;settings.music=!on;settings.sfx=!on;document.querySelector('#sound').textContent=on?'SOUND OFF':'SOUND ON';persist();});document.querySelector('#sound').textContent=settings.music||settings.sfx?'SOUND ON':'SOUND OFF';bindButton('full',()=>{if(document.fullscreenElement)document.exitFullscreen();else document.querySelector('.game-shell').requestFullscreen?.().catch(()=>{});});
// A narrow, explicit test interface keeps campaign checks reproducible.
window.LAST_EDEN={get state(){return state;},get snapshot(){return {state,level:levelIndex,wave,score,lives,section,lock:lock?{...lock}:null,bullets:bullets.map(b=>({...b})),zones:zones.map(z=>({...z})),audio:soundtrack.status,player:player?{...player}:null,enemies:enemies.map(e=>({...e})),objects:objects.map(o=>({...o})),drops:drops.map(d=>({...d})),unlocked:save.unlocked};},start:(i=0,hero=0,mode='story')=>{selected=clamp(hero,0,3);difficulty=mode;score=0;lives=3;startStage(clamp(i,0,5),true);},step:(dt=1/60)=>update(dt),controls:{attack,jump,special,pickup},test:{equip:(type,ammo)=>{player.weapon=type;player.ammo=ammo??WEAPONS[type].ammo;},spawnEnemy,drop:(type,x,y)=>drops.push({type,x,y,life:90}),move:(x,y)=>{player.x=x;player.y=y;},damageEnemy:(i,n)=>damageEnemy(enemies[i],n),damagePlayer:n=>damagePlayer(n,player.x-40),finishEncounter:()=>{enemies.forEach(e=>{e.inv=0;damageEnemy(e,9999);if(e.phase===2&&e.hp>0){e.inv=0;damageEnemy(e,9999);}});},spawnBoss,clear:stageClear}};
sheet.onload=()=>{if(state==='select')characterSelect();};sheet.onerror=()=>panel('<section class="panel small-panel"><h2>ARTWORK COULD NOT LOAD.</h2><p>Keep assets.js, game.js and index.html in the same folder, then open index.html again.</p></section>');menu();requestAnimationFrame(frame);
})();
