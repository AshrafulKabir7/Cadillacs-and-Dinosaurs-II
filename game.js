/* Cadillacs & Dinosaurs II: Fessenden's Legacy — original local fan-game engine. */
(() => {
'use strict';
const canvas=document.querySelector('#game'),ctx=canvas.getContext('2d'),overlay=document.querySelector('#overlay');
const A=window.ARCADE_ASSETS,sheet=new Image();sheet.src=A.sheet;
const W=768,H=432;
const HEROES=[
 {id:'mustapha',name:'MUSTAPHA',nickname:'MOSTAFA',tag:'THE FLYING KICK',hp:120,speed:180,power:21,color:'#d5ec69',special:'Tornado kick'},
 {id:'jack',name:'JACK TENREC',nickname:'',tag:'THE ALL-ROUNDER',hp:140,speed:145,power:23,color:'#7dc4de',special:'Dino uppercut'},
 {id:'hannah',name:'HANNAH DUNDEE',nickname:'',tag:'THE SWIFT STRIKER',hp:110,speed:166,power:19,color:'#efaa77',special:'Spiral flash'},
 {id:'mess',name:'MESS O\'BRADOVICH',nickname:'',tag:'THE HEAVY HITTER',hp:170,speed:122,power:29,color:'#b5cc85',special:'Knuckle bomb'}
];
const LEVELS=window.EDEN_CAMPAIGN,CFG=window.COMBAT_CONFIG;
const normalizeDifficulty=k=>CFG.difficulty[k]?k:CFG.aliases[k]||'normal';
const rules=()=>CFG.difficulty[normalizeDifficulty(difficulty)];
const weaponClass=type=>Object.values(CFG.weapons).find(w=>w.types.includes(type));
const SELECT_ORDER=[1,2,0,3];let selectionChapter=0;
const selectionImages=Object.fromEntries(Object.entries(ARCADE_SELECTION).map(([id,src])=>{const im=new Image();im.onload=()=>{if(state==='select')paintSelection();};im.src=src;return [id,im];}));
const rand=(a,b)=>a+Math.random()*(b-a),clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),approach=(x,y,s)=>x<y?Math.min(x+s,y):Math.max(x-s,y);
const keys=new Set(),pressed=new Set(),touchKeys=new Set(),padKeys=new Set();
const TOUCH=document.documentElement.classList.contains('touch-ui');let stickId=null;
function resetInput(){keys.clear();pressed.clear();touchKeys.clear();padKeys.clear();lastDirection={key:'',time:0};dashKey='';dashTime=0;
  stickId=null;document.querySelectorAll('.touch-controls .held').forEach(b=>b.classList.remove('held'));document.getElementById('stick')?.classList.remove('active','running');const k=document.getElementById('stick-knob');if(k)k.style.transform='';}
let state='menu',selected=0,difficulty='normal',levelIndex=0,level=LEVELS[0],time=0,last=0,camera=0,shake=0,flash=0,hitstop=0;
let player,enemies=[],allies=[],objects=[],drops=[],particles=[],bullets=[],zones=[],floating=[],wave=0,lock=null,bossSpawned=false,cleared=false,stageTimer=0;
let plan=null,encIndex=0,encounter=null,sectionIndex=-1,driving=false,parkedCar=null,radio=null,radioQueue=[],alliesFreed=0;
let score=0,lives=3,combo=0,comboTimer=0,bestCombo=0,kills=0,runTime=0,toast='',toastTime=0,started=false;
// Free-play coins: a credit is dropped on the continue screen (or any time with Enter) and spent to respawn in place.
let coins=0,continueTimer=0,coinPending=0;
let save={unlocked:0,checkpoint:null,best:0},settings={music:true,sfx:true};
try{save={...save,...JSON.parse(localStorage.getItem('last-eden-save')||'{}')};settings={...settings,...JSON.parse(localStorage.getItem('last-eden-settings')||'{}')};}catch{}
save.unlocked=clamp(Number(save.unlocked)||0,0,5);
function persist(){try{localStorage.setItem('last-eden-save',JSON.stringify(save));localStorage.setItem('last-eden-settings',JSON.stringify(settings));}catch{}}
function checkpoint(){save.checkpoint={level:levelIndex,section:Math.max(0,sectionIndex),hero:selected,difficulty,score,lives};persist();}
let audio;
function unlockAudio(){if(!audio){const AC=window.AudioContext||window.webkitAudioContext;if(AC)audio=new AC();}if(audio?.state==='suspended')audio.resume();soundtrack.unlock();}
function tone(freq,dur=.12,type='square',vol=.04,end){if(!audio)return;const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);if(end)o.frequency.exponentialRampToValueAtTime(Math.max(20,end),audio.currentTime+dur);g.gain.setValueAtTime(vol,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+dur);o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+dur);}
// Original arcade effects, identified by matching each supplied sample against the reference video's audio.
// Synthesized tones remain for everything else and as a fallback.
const SAMPLE_FOR={hit:'punch',heavy:'kick',slam:'slam',gun:'pistol',enemygun:'pistol',rifle:'rifle',shotgun:'rifle',uzi:'uzi',explosion:'explosion'};
const samplePool={};
function sample(name){
  const pool=samplePool[name]||(samplePool[name]=[]);let a=pool.find(v=>v.paused||v.ended);
  if(!a){if(pool.length>=5)a=pool[0];else{a=new Audio('assets/sfx/'+name+'.mp3');pool.push(a);}}
  try{a.currentTime=0;a.volume=name==='enemygun'?.45:.85;const p=a.play();if(p)p.catch(()=>{});}catch{return false;}
  return true;
}
function sfx(name){if(!settings.sfx)return;unlockAudio();if(SAMPLE_FOR[name]&&sample(SAMPLE_FOR[name]==='pistol'&&name==='enemygun'?'pistol':SAMPLE_FOR[name]))return;if(['gun','shotgun','rocket','explosion','swing'].includes(name)&&audio){const dur=name==='explosion'?.55:name==='rocket'?.25:name==='shotgun'?.2:name==='swing'?.07:.09;const b=audio.createBuffer(1,Math.ceil(audio.sampleRate*dur),audio.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);const n=audio.createBufferSource(),g=audio.createGain(),f=audio.createBiquadFilter();n.buffer=b;f.type='lowpass';f.frequency.value=name==='explosion'?750:name==='swing'?1600:3500;g.gain.value=name==='swing'?.05:.13;n.connect(f).connect(g).connect(audio.destination);n.start();}if(name==='hit'){tone(130,.09,'sawtooth',.09,35);tone(630,.045,'square',.025,60);}if(name==='jump')tone(190,.15,'triangle',.06,550);if(name==='gun')tone(900,.09,'sawtooth',.065,50);if(name==='pickup'){tone(440,.1,'square',.04);setTimeout(()=>tone(660,.1,'square',.04),70);}if(name==='special'){tone(90,.35,'sawtooth',.07,600);tone(440,.25,'triangle',.04,100);}if(name==='hurt')tone(180,.2,'sawtooth',.06,40);if(name==='clear'){[392,494,587,784].forEach((f,i)=>setTimeout(()=>tone(f,.3,'triangle',.05),i*100));}}

const soundtrack = new ArcadeSoundtrack();
// `scale` sizes each weapon sheet sprite against the arcade: a rifle spans about three quarters of a hero's height,
// a handgun a quarter and a knife less than that; the previous uniform scale drew them up to twice too large.
const WEAPONS = {
  gun: {name:'GUN', ammo:6, cooldown:.32, damage:32, sprite:[263,40,34,24], recoil:4, scale:.78},
  uzi: {name:'UZI', ammo:48, cooldown:.29, damage:15, burst:3, sprite:[506,101,45,29], left:true, recoil:3, scale:.8},
  shotgun: {name:'SHOTGUN', ammo:6, cooldown:.66, damage:56, spread:56, pierce:3, sprite:[10,154,60,25], left:true, recoil:8, scale:.85},
  rifle: {name:'RIFLE', ammo:6, cooldown:.74, damage:70, pierce:2, sprite:[10,225,78,21], recoil:7, scale:.8},
  m16: {name:'M-16A1', ammo:60, cooldown:.28, damage:21, burst:3, sprite:[13,315,81,21], recoil:5, scale:.78},
  bazooka: {name:'BAZOOKA', ammo:4, cooldown:.85, damage:108, explosive:true, sprite:[7,408,81,22], left:true, recoil:10, scale:.85},
  knife: {name:'KNIFE', ammo:10, cooldown:.28, damage:33, melee:true, range:96, sprite:[11,754,43,28], scale:.5},
  rod: {name:'ROD', ammo:8, cooldown:.49, damage:48, melee:true, range:112, sprite:[8,595,68,20], scale:.8},
  stick: {name:'STICK', ammo:8, cooldown:.32, damage:28, melee:true, range:86, sprite:[11,649,46,22], scale:.8},
  club: {name:'CLUB', ammo:16, cooldown:.44, damage:42, melee:true, range:108, sprite:[8,711,63,26], scale:.8},
  torch: {name:'TORCH', ammo:12, cooldown:.46, damage:48, melee:true, range:104, sprite:[854,683,38,54], scale:.75},
  grenade: {name:'GRENADE', ammo:2, cooldown:.5, damage:100, thrown:true, sprite:[10,513,22,21], scale:.8},
  dynamite: {name:'DYNAMITE', ammo:2, cooldown:.5, damage:125, thrown:true, sprite:[4,486,43,26], scale:.8},
  stone: {name:'STONE', ammo:1, cooldown:.4, damage:32, thrown:true, sprite:[15,455,17,19], scale:.8}
};
const weaponScale=type=>CFG.sockets.scale*(WEAPONS[type]?.scale||1);
// The final chapter uses the original game's last-stage themes; its last copy gets the original final boss theme.
const STAGE_TRACKS = [['06','07','08'],['16','17','22'],['13','14','07'],['20','21','22'],['08','17','20'],['29','20','30']];
const BOSS_TRACKS = ['10','19','15','24','24','15'];
const stageMusic = () => STAGE_TRACKS[levelIndex][Math.min(2,Math.floor(Math.max(0,sectionIndex)/2))];
// Heavy weapons carried by one enemy in every third fight; they drop it when beaten.
const CARRIED = [['shotgun','gun','rod'],['uzi','grenade','club'],['rifle','club','knife'],['m16','dynamite','torch'],['bazooka','m16','grenade'],['bazooka','m16','shotgun']];
// Hostile copies of the heroes are colour-inverted with a violet glow; freed copies keep the heroes' colours with a gold glow.
const CLONE_FILTER='hue-rotate(180deg) saturate(1.3) brightness(.92) drop-shadow(0 0 3px #b16cff)';
const ALLY_FILTER='sepia(.3) saturate(1.25) brightness(1.05) drop-shadow(0 0 4px #ffd257)';
const CAR_SCALE=1.15,CAR_REACH=128;
// Cadillac handling: the car carries momentum, leans into lane changes, and the road streams under it (`road` is the
// extra scenery scroll that keeps the highway moving even while the screen is locked for a fight).
const CAR={accel:720,drag:420,top:275,reverse:-175,cruise:95,laneAccel:1150,laneTop:185,road:330,boost:260};
let road=0;
let effects = [], lastHitEnemy = null, bossIntro = 0, dashTime = 0, dashKey = '', lastDirection = {key:'',time:0};
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
function weaponSprite(g,type,x,y,scale=1,dir=1,angle=0,grip=.35) {
  const data=WEAPONS[type];if(!data||!weaponArt.ready)return;
  const [sx,sy,w,h]=data.sprite;
  g.save();g.translate(Math.round(x),Math.round(y));g.rotate(angle);g.scale(dir*scale*(data.left?-1:1),scale);
  g.imageSmoothingEnabled=false;g.drawImage(weaponArt,sx,sy,w,h,-w*(data.left?1-grip:grip),-h*.5,w,h);g.restore();
}
function music(dt) {
  document.querySelector('#sound').textContent=settings.music||settings.sfx?'SOUND ON':'SOUND OFF';
  soundtrack.update(settings.music,state==='paused'||document.hidden,settings.volume??.52);
  if(state==='paused'||state==='guide')return;
  let key=state, sequence;
  if(['menu','chapters'].includes(state)) sequence=[{id:'01',loop:false},{id:'02',loop:false},'01'];
  else if(state==='credits')sequence=['38'];
  else if(state==='select')sequence=['03'];
  else if(state==='brief')sequence=[{id:levelIndex===0?'04':'05',loop:false},stageMusic()];
  else if(state==='play') {
    const boss=enemies.find(e=>e.boss&&!e.dead);
    key=`play-${levelIndex}-${boss?`boss-${boss.phase}`:Math.floor(Math.max(0,sectionIndex)/2)}`;
    sequence=boss?boss.type==='fessenden'?['32']:[{id:levelIndex===3||levelIndex===4?'23':levelIndex===2?'18':'09',seconds:3.2},BOSS_TRACKS[levelIndex]]:[stageMusic()];
  } else if(state==='clear')sequence=[{id:'11',loop:false},{id:['26','27','28'][levelIndex%3],loop:false},'06'];
  else if(state==='ending')sequence=[{id:'33',loop:false},'06'];
  else if(state==='continue')sequence=[{id:'35',loop:false},{id:'36',loop:false}];
  else if(state==='gameover')sequence=[{id:'37',loop:false}];
  if(sequence)soundtrack.cue(key+(state==='brief'||state==='clear'?levelIndex:''),sequence);
}
function dropWeapon() {
  if(player.weapon)drops.push({x:player.x-player.dir*20,y:player.y+5,type:player.weapon,ammo:player.ammo,life:60});
  player.weapon=null;player.ammo=0;player.pendingStrike=null;player.burst=null;
}
function explode(x,y,damage,friendly=true,r=96) {
  effects.push({x,y,age:0,life:.65,type:'explosion'});shake=CFG.fx.explosion.shake;explosionParticles(x,y);sfx('explosion');
  for(const e of enemies)if(friendly&&!e.dead&&Math.hypot(e.x-x,(e.y-y)*1.6)<r)damageEnemy(e,damage,Math.sign(e.x-x)*48,true,false,{blast:true});
  if(friendly&&mission?.active)damageObjective(damage,x,y,r,Math.sign(mission.active.x-x)||1);
  if(!friendly&&Math.hypot(player.x-x,(player.y-y)*1.6)<r)damagePlayer(damage,x);
  for(const o of objects)if(o.hp>0&&Math.hypot(o.x-x,o.y-y)<r)breakObject(o,damage);
}
function breakObject(o,power) {
  o.hp-=power;burst(o.x,o.y-30,'#c3925d',10);
  if(o.hp<=0){if(o.content!=='food'||Math.random()<rules().propFoodChance){const c=o.content;drops.push(c==='food'?foodDrop(o.x,o.y):c==='bonus'?bonusDrop(o.x,o.y):c==='ammo'?{x:o.x,y:o.y,type:'ammo',food:'ammo',life:999}:{x:o.x,y:o.y,type:c,life:90});}score+=100;}
}
function weaponAttack() {
  const w=WEAPONS[player.weapon];if(!w)return false;player.moveState=null;
  player.pendingStrike=null;player.dashVelocity=0;
  const type=player.weapon;player.attackTotal=w.cooldown;player.attack=w.cooldown;player.attackKind=w.melee?'weapon-melee':w.thrown?'throw':'fire';player.recoil=w.recoil||0;
  if(player.ammo<=0){throwHeldWeapon();return true;}
  if(w.melee){
    const close=enemies.some(e=>!e.dead&&Math.abs(e.x-player.x)<w.range&&Math.abs(e.y-player.y)<36);
    // A knife is thrown only when there is someone ahead to throw it at; otherwise the stab just misses and the knife stays in hand.
    const ahead=enemies.some(e=>!e.dead&&e.onstage&&Math.sign(e.x-player.x)===player.dir&&Math.abs(e.x-player.x)<380&&Math.abs(e.y-player.y)<40);
    if(type==='knife'&&!close&&ahead){bullets.push({x:player.x,y:player.y,z:48,vx:player.dir*490,vy:0,friendly:true,damage:45,life:1.2,kind:'thrown',weapon:type,age:0});player.weapon=null;player.ammo=0;}
    else if(type==='knife'&&!close){sfx('swing');return true;}
    else {meleeStrike(w.range,w.damage*(selected===2?1.25:1),type!=='knife',null,{melee:true,weapon:type,sharp:type==='knife'});if(--player.ammo<=0){player.weapon=type==='rod'?'stick':null;player.ammo=type==='rod'?Math.round(8*rules().meleeDurability):0;}}
    sfx('hit');return true;
  }
  if(w.thrown){bullets.push({x:player.x+player.dir*20,y:player.y,z:50,vx:player.dir*220,vy:0,friendly:true,damage:w.damage,life:type==='dynamite'?1.15:.85,kind:'lob',weapon:type,age:0});if(--player.ammo<=0)player.weapon=null;sfx('jump');return true;}
  const shots=Math.min(w.burst||1,player.ammo);
  emitGunRound(type);player.burst=shots>1?{weapon:type,remaining:shots-1,next:.085}:null;
  return true;
}

function meleeStrike(range,power,knockdown=false,struck=null,opts=null) {
  let hits=0;
  for(const e of enemies)if(!e.dead&&e.state!=='held'&&!struck?.includes(e.id)&&Math.abs(e.y-player.y)<36&&Math.abs(e.x-player.x)<range&&(Math.abs(e.x-player.x)<16||Math.sign(e.x-player.x)===player.dir)){if(damageEnemy(e,power,player.dir*(knockdown?42:8),knockdown,false,opts)){struck?.push(e.id);hits++;}}
  for(const o of objects)if(o.hp>0&&!struck?.includes('box'+o.x)&&Math.abs(o.y-player.y)<36&&Math.abs(o.x-player.x)<range&&Math.sign(o.x-player.x)===player.dir){breakObject(o,power);struck?.push('box'+o.x);}
  const id='task'+mission?.active?.name;if(!struck?.includes(id)&&damageObjective(power,player.x,player.y,range,player.dir))struck?.push(id);
  return hits;
}
function emitGunRound(type){
  const w=WEAPONS[type],profile=weaponClass(type);
  player.x=clamp(player.x-player.dir*profile.recoilPixels,lock?lock.left+24:24,lock?lock.right-24:level.length-24);
  // Frames that already contain the gun (Jack's arcade pistol-firing torso) place the muzzle at the hand point itself.
  const mount=gunMount(),muzzle=mount.x+(mount.gunDrawn?0:w.sprite[2]*(1-profile.grip)*weaponScale(type));
  bullets.push({x:player.x+player.dir*muzzle,sweepFrom:player.x,y:player.y,z:mount.y+player.z,vx:player.dir*(w.explosive?450:860),vy:0,friendly:true,damage:w.damage*(selected===2?1.25:1),life:w.spread?.33:1.15,kind:w.explosive?'rocket':'bullet',weapon:type,spread:w.spread||25,pierce:w.pierce||1,hits:[],age:0});
  player.ammo--;player.recoil=w.recoil||0;
  // Burst weapons play one burst sample per trigger pull.
  if(!(['uzi','m16'].includes(type)&&player.burst))sfx(type==='bazooka'?'rocket':type==='gun'?'gun':type==='uzi'||type==='m16'?'uzi':'rifle');
  effects.push({type:'muzzle',x:player.x+player.dir*muzzle,y:player.y-mount.y-player.z,dir:player.dir,age:0,life:.065,weapon:type});
  if(profile.shells){const p=profile.ejection;particles.push({kind:'shell',x:player.x+player.dir*(mount.x+p[0]),y:player.y-mount.y-player.z+p[1],ground:player.y-1,vx:-player.dir*rand(55,95),vy:-rand(75,120),life:1.1,maxLife:1.1,size:3,color:type==='shotgun'?'#da7252':'#e6c15a'});}
}
// An empty gun is hurled at the enemy as soon as the last shot's recoil ends, the way the arcade heroes discard a
// spent weapon; it hits like a thrown object and is gone.
function throwHeldWeapon(){
  if(!player.weapon)return;
  bullets.push({x:player.x,y:player.y,z:45,vx:player.dir*400,vy:0,friendly:true,damage:42,life:1.3,kind:'thrown',weapon:player.weapon,age:0});
  player.weapon=null;player.ammo=0;player.burst=null;player.pendingStrike=null;player.attack=.26;player.attackTotal=.26;player.attackKind='throw';player.recoil=0;sfx('swing');
}
function updateEmptyGun(){
  const w=WEAPONS[player.weapon];
  if(w&&!w.melee&&!w.thrown&&player.ammo<=0&&player.attack<=0&&player.hurt<=0&&player.pickup<=0&&player.z<=0&&!player.burst&&!player.grab)throwHeldWeapon();
}
function updateBurst(dt){
  const b=player.burst;if(!b)return;
  if(player.weapon!==b.weapon||player.hurt>0||player.special>0||player.attackKind!=='fire'){player.burst=null;return;}
  b.next-=dt;
  while(b.next<=0&&b.remaining>0&&player.ammo>0){emitGunRound(b.weapon);b.remaining--;b.next+=.085;}
  if(b.remaining<=0||player.ammo<=0)player.burst=null;
}
function clearEnemyHazards(owner){for(const b of bullets)if(b.owner===owner)b.life=0;for(const z of zones)if(z.owner===owner)z.cancelled=true;}
// Anyone an enemy can hurt: the player and any freed clones still fighting.
const fighters=()=>[player,...allies.filter(a=>a.hp>0&&a.state!=='down'&&a.state!=='retreat')];
function strike(v,amount,fromX,ignoreAir=false){if(v===player)damagePlayer(amount,fromX,ignoreAir);else hurtAlly(v,amount,fromX);}
function updateProjectiles(dt) {
  for(const b of bullets){
    if(b.life<=0)continue;
    const from=b.sweepFrom??b.x;delete b.sweepFrom;
    b.age=(b.age||0)+dt;b.x+=b.vx*dt;b.y+=(b.vy||0)*dt;b.life-=dt;
    if(b.kind==='lob'){
      b.z=16+Math.sin(Math.min(1,b.age/(b.weapon==='dynamite'?1.15:.85))*Math.PI)*75;
      if(b.weapon==='grenade'&&enemies.some(e=>!e.dead&&Math.abs(e.x-b.x)<28&&Math.abs(e.y-b.y)<30)&&b.age>.25)b.life=0;
      if(b.life<=0){if(b.weapon==='stone'){for(const e of enemies)if(Math.hypot(e.x-b.x,e.y-b.y)<55)damageEnemy(e,b.damage,30,true);}else explode(b.x,b.y,b.damage,b.friendly);}continue;
    }
    const intersects=(x,r)=>x>=Math.min(from,b.x)-r&&x<=Math.max(from,b.x)+r;
    if(b.friendly){
      const targets=[];
      for(const e of enemies)if(!e.dead&&e.state!=='flee'&&!b.hits?.includes(e.id)&&e.inv<=0&&intersects(e.x,e.boss?45:22)&&Math.abs(b.y-e.y)<(b.spread||27)&&b.z>e.z+5&&b.z<e.z+(e.state==='down'?32:e.boss?160:112))targets.push({kind:'enemy',target:e});
      for(const o of objects)if(o.hp>0&&intersects(o.x,25)&&Math.abs(b.y-o.y)<30&&b.z<100)targets.push({kind:'object',target:o});
      const task=mission?.active;if(task?.kind==='beacon'&&intersects(task.x,23)&&Math.abs(b.y-task.y)<32&&b.z<110)targets.push({kind:'objective',target:task});
      targets.sort((a,c)=>Math.abs(a.target.x-from)-Math.abs(c.target.x-from));
      for(const item of targets){
        if(b.life<=0)break;const t=item.target;
        if(b.kind==='rocket'){explode(t.x,b.y,b.damage,true,120);b.life=0;break;}
        if(item.kind==='enemy'){if(!damageEnemy(t,b.damage,Math.sign(b.vx)*12,b.weapon==='rifle'||b.weapon==='shotgun',false,{bullet:b.kind==='bullet',sharp:b.weapon==='knife',weapon:b.weapon,hitZ:b.z}))continue;effects.push({type:'pow',x:t.x-Math.sign(b.vx)*12,y:b.y-b.z,age:0,life:.32});(b.hits||(b.hits=[])).push(t.id);b.pierce=(b.pierce||1)-1;if(b.pierce<=0)b.life=0;}
        else {if(item.kind==='objective')damageObjective(b.damage,t.x,b.y,40,Math.sign(b.vx));else breakObject(t,b.damage);b.life=0;}
      }
    }else for(const v of fighters()){
      const car=v===player&&driving;
      if(intersects(v.x,car?100:23)&&Math.abs(b.y-v.y)<25&&b.z>=v.z+(car?0:8)&&b.z<=v.z+(car?80:105)){strike(v,b.damage,b.x-Math.sign(b.vx)*40,true);b.life=0;break;}
    }
  }
  bullets=bullets.filter(b=>b.life>0);for(const fx of effects)fx.age+=dt;effects=effects.filter(fx=>fx.age<fx.life);
}
function drawEffects() {
  for(const b of bullets){if(b.delay>0)continue;const x=b.x-camera,y=b.y-b.z;
    if(b.kind==='lob'||b.kind==='thrown'){shadow(ctx,x,b.y,8);weaponSprite(ctx,b.weapon,x,y,.85*(WEAPONS[b.weapon]?.scale||1),1,b.age*9);}
    else if(b.kind==='rocket'){weaponSprite(ctx,'bazooka',x,y,.45,Math.sign(b.vx));rect(ctx,x-Math.sign(b.vx)*30,y-2,Math.sign(b.vx)*18,4,'#ffb33b');}
    else {rect(ctx,x,y,Math.sign(b.vx)*(b.weapon==='shotgun'?27:17),2,b.friendly?'#fff7c5':'#ff8662');if(b.weapon==='shotgun'){rect(ctx,x-5,y-8,10,2,'#ffdc7c');rect(ctx,x-5,y+8,10,2,'#ffdc7c');}}
  }
  for(const fx of effects){
    if(fx.type==='spark'&&weaponArt.ready){const seq=fx.big?[[12,988,18,18],[127,985,39,31],[179,968,68,60]]:[[12,988,18,18],[127,985,39,31]],r=seq[Math.min(seq.length-1,Math.floor(fx.age/fx.life*seq.length))],k=fx.big?1.2:.95;ctx.drawImage(weaponArt,r[0],r[1],r[2],r[3],Math.round(fx.x-camera-r[2]*k/2),Math.round(fx.y-r[3]*k/2),Math.round(r[2]*k),Math.round(r[3]*k));}
    if(fx.type==='pow'&&weaponArt.ready){const seq=[[34,10,22,11],[59,9,25,13],[91,7,32,15]],r=seq[Math.min(2,Math.floor(fx.age/fx.life*4))];ctx.drawImage(weaponArt,r[0],r[1],r[2],r[3],Math.round(fx.x-camera-r[2]*.7),Math.round(fx.y-r[3]*.7-fx.age*26),Math.round(r[2]*1.4),Math.round(r[3]*1.4));}
    if(fx.type==='muzzle'){ctx.save();ctx.translate(Math.round(fx.x-camera),Math.round(fx.y));ctx.scale(fx.dir,1);const n=Math.floor(fx.age*90)%2,l=fx.weapon==='bazooka'?38:fx.weapon==='shotgun'?31:22;poly(ctx,[[0,-3],[l*.35,-6],[l*.2,-11],[l,-4+n*6],[l*.52,0],[l*.82,7],[l*.24,5],[0,3]],'#ee8e39');poly(ctx,[[0,-2],[l*.34,-5],[l*.72,0],[l*.24,4],[0,2]],'#fff4b2');rect(ctx,0,-1,10,2,'#ffffff');ctx.restore();}
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
function panel(html){overlay.innerHTML=html;document.querySelector('#pause').style.display=state==='play'?'block':'none';document.body.classList.toggle('in-play',state==='play');}
function menu(){state='menu';lock=null;keys.clear();const cp=save.checkpoint;panel(`<section class="panel title-panel"><p class="eyebrow">SIX MONTHS AFTER FESSENDEN’S LAB BURNED</p><h1>CADILLACS &<br>DINOSAURS <span>II</span></h1><div class="subtitle">FESSENDEN’S LEGACY</div><p class="deck">The doctor is dead. His work is walking again.<br>Four heroes. Six chapters. An army of copies.</p><div class="menu-buttons"><button class="primary" id="newgame">START ADVENTURE →</button>${cp?`<button class="secondary" id="continue">CONTINUE · CH 0${cp.level+1}</button>`:''}<button class="secondary" id="chapters">CHAPTERS</button><button class="secondary" id="guide">HOW TO PLAY</button><button class="secondary" id="jukebox">SOUND ROOM</button></div><p class="title-note">A FAN-MADE SEQUEL · MADE FOR MOSTAFA</p></section>`);bindButton('newgame',()=>characterSelect(0));bindButton('continue',()=>{const s=save.checkpoint;selected=clamp(s.hero,0,3);difficulty=normalizeDifficulty(s.difficulty);score=s.score||0;lives=s.lives||3;startStage(clamp(s.level,0,5),{section:s.section|0});});bindButton('chapters',chapters);bindButton('guide',()=>guide(menu));bindButton('jukebox',()=>soundRoom(menu));}
function paintSelection(){
 const c=document.querySelector('#selection-banner'),stats=document.querySelector('#selection-stats');if(!c||!stats)return;
 const g=c.getContext('2d'),j=selectionImages.jack,h=selectionImages.hannah,chosen=selectionImages[HEROES[selected].id];g.imageSmoothingEnabled=false;
 // The two native frames let us show each portrait without the baked-in 1P cursor.
 if(j.complete&&j.naturalWidth&&h.complete&&h.naturalWidth){g.drawImage(h,0,0,384,144,0,0,384,144);g.drawImage(j,115,88,85,21,115,88,85,21);
   // A free-play selector has no coin timer; a small title occupies the timer's original position.
   g.fillStyle='#fffae9';g.fillRect(166,4,43,38);g.fillStyle='#1748bc';g.font='bold 9px monospace';g.textAlign='center';g.fillText('CHOOSE',187,16);g.fillText('HERO',187,28);}
 if(chosen.complete&&chosen.naturalWidth){const q=stats.getContext('2d');q.imageSmoothingEnabled=false;q.drawImage(chosen,0,144,128,80,0,0,128,80);}
}
function characterSelect(startAt=selectionChapter){selectionChapter=startAt;state='select';difficulty=normalizeDifficulty(difficulty);
 const h=HEROES[selected],ratings=CFG.heroRatings[h.id];
 panel(`<section class="panel character-panel arcade-select"><div class="select-heading"><button id="back" class="secondary">← BACK</button><span>PLAYER SELECT · FOUR HEROES</span></div><div class="classic-roster"><canvas id="selection-banner" width="384" height="144" aria-label="Original portraits of Jack, Hannah, Mustapha and Mess"></canvas><div class="portrait-buttons">${SELECT_ORDER.map(i=>`<button class="portrait-choice ${i===selected?'selected':''}" data-hero="${i}" aria-label="Choose ${HEROES[i].name}" aria-pressed="${i===selected}"><span>${i===selected?'1P':'SELECT'}</span></button>`).join('')}</div></div><div class="classic-select-bottom"><canvas id="selection-stats" width="128" height="80" aria-label="${h.name}: Power ${ratings[0]}, Speed ${ratings[1]}, Skill ${ratings[2]} out of five"></canvas><div class="select-options"><div class="difficulty">${Object.entries(CFG.difficulty).map(([key,v],i)=>`<button id="${['story-mode','normal-mode','arcade-mode'][i]}" data-mode="${key}" aria-pressed="${difficulty===key}" class="${difficulty===key?'selected':''}">${v.label}</button>`).join('')}</div><p class="difficulty-note">${rules().description}</p><button id="begin" class="primary">LET'S GO →</button></div></div></section>`);
 document.querySelectorAll('[data-hero]').forEach(b=>b.onclick=()=>{selected=+b.dataset.hero;characterSelect(startAt);sfx('pickup');});
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{difficulty=b.dataset.mode;characterSelect(startAt);});
 bindButton('begin',()=>{score=0;lives=3;kills=0;bestCombo=0;runTime=0;startStage(startAt);});bindButton('back',menu);paintSelection();
}
function chapters(){state='chapters';panel(`<section class="panel small-panel"><p class="eyebrow">FESSENDEN’S LEGACY</p><h2>SIX CHAPTERS. ONE TRAIL.</h2><p>Clear a chapter to unlock it here. Progress saves at every section of a chapter.</p><div class="level-grid">${LEVELS.map((l,i)=>`<button data-level="${i}" ${i>save.unlocked?'disabled':''}><span>CHAPTER 0${i+1} ${i>save.unlocked?'· LOCKED':''}</span>${l.name}</button>`).join('')}</div><div class="menu-buttons"><button id="back" class="secondary">← MAIN MENU</button></div></section>`);document.querySelectorAll('[data-level]').forEach(b=>b.onclick=()=>characterSelect(+b.dataset.level));bindButton('back',menu);}
function guide(back){state='guide';panel(`<section class="panel small-panel"><p class="eyebrow">ARCADE FIELD GUIDE</p><h2>GET BACK IN THE FIGHT.</h2><div class="controls-list"><strong>WASD / ↑↓←→</strong><span>Move along the street and between lanes.</span><strong>J / Z</strong><span>Unarmed: tap or hold for punch, punch, kick, finisher; the chain continues only while blows connect. Standing on a weapon: crouch and pick it up. Holding a gun: fire only, even at close range. Empty gun: E to discard.</span><strong>GRAB</strong><span>Walk into an enemy to grab them. J knees; back + J throws them over your shoulder into the others; the fourth J throws forward.</span><strong>K / X</strong><span>Jump. Dodge shockwaves and low attacks.</span><strong>L / C</strong><span>Special move, also J + K together. Costs health when it hits; drops your weapon.</span><strong>E / V</strong><span>At a console or pod: hold to operate, or tap to tune the marked channel. Elsewhere: pick up or throw a weapon.</span><strong>SHIFT</strong><span>Run left or right, or double tap ← / →. Guns stay at the hip while you run. Run + attack: Mustapha’s flying kick, Jack’s slide, Hannah’s knee or Mess’s body splash.</span><strong>ESC / P</strong><span>Pause. Gamepad: stick / D-pad, X hit, A jump, Y special, B pick.</span></div><p>Enemies arrive from the edges of the screen or drop from above — watch both sides. Break barrels for food and weapons. Finish the marked objective to open the route. Copies dissolve into green gel. In the last chapter, freed clones fight on your side. Highway: steer into enemies, J bash, K boost, L ram.</p><div class="menu-buttons"><button id="back" class="primary">GOT IT →</button></div></section>`);bindButton('back',back);}

// Chapter layout: sections in order, fights spaced along the road, the boss at the end.
const ENC_GAP=600,SECTION_GAP=260;
function buildPlan(i){
  const sections=[],encounters=[];let x=600;
  LEVELS[i].sections.forEach((s,si)=>{
    sections.push({index:si,name:s.name,say:s.say,drive:!!s.drive,x:x-300,first:encounters.length});
    for(const e of s.enc){encounters.push({...e,x,section:si});x+=ENC_GAP;}
    x+=SECTION_GAP;
  });
  return {sections,encounters,length:encounters[encounters.length-1].x+560};
}
function placeProps(from){
  // Every arcade weapon turns up in the containers, plus food, score items and ammunition.
  const loot=['food','gun','bonus','rod','shotgun','food','uzi','grenade','food','rifle','club','ammo','m16','dynamite','food','bazooka','knife','torch','food','stone','bonus','food'];let n=levelIndex*3;
  plan.sections.forEach((s,si)=>{if(si<from||s.drive)return;const end=plan.sections[si+1]?.x??level.length-300;
    for(let x=si===0?300:s.x+260;x<end-120;x+=520){objects.push({x,y:306+(n*37)%80,hp:28,type:n%3===0?'crate':'barrel',content:loot[n%loot.length]});n++;}});
  const s=plan.sections[from];if(s.drive)return;
  const x=from?s.x+120:230;drops.push({x,y:360,type:levelIndex===0&&from===0?'gun':'shotgun',life:999});drops.push(foodDrop(x+40,375,999,true));
}
function startStage(i,opts={}){
  if(typeof opts==='boolean')opts={skipBrief:opts};
  levelIndex=i;level=LEVELS[i];plan=buildPlan(i);level.length=plan.length;const hero=HEROES[selected],hp=hero.hp*rules().playerHealth;
  player={x:130,y:352,z:0,vz:0,dir:1,hp,maxhp:hp,hurt:0,inv:1.5,attack:0,attackTotal:.38,special:0,specialCd:0,comboStep:0,weapon:null,ammo:0,move:false,run:false,anim:0,boost:0,boostCd:0,recoil:0,knocked:false,attackKind:"combo",pendingStrike:null,moveState:null,freeze:0,comboWin:0,comboHit:false,grab:null,grabCd:0,pickup:0,pickTarget:null,land:0,walkDist:0,runDist:0,roll:0,vx:0,vy:0,bank:0,bump:0,dust:0};
  enemies=[];allies=[];objects=[];drops=[];particles=[];bullets=[];zones=[];floating=[];effects=[];bossIntro=0;lastHitEnemy=null;dashTime=0;wave=0;lock=null;bossSpawned=false;cleared=false;stageTimer=0;combo=0;comboTimer=0;shake=0;flash=0;hitstop=0;
  encIndex=0;encounter=null;sectionIndex=-1;radio=null;radioQueue=[];alliesFreed=0;parkedCar=null;road=0;initMission();
  const start=clamp(opts.section|0,0,plan.sections.length-1),sec=plan.sections[start];
  if(start>0){
    player.x=sec.x+40;encIndex=sec.first;
    // Objectives finished before this checkpoint stay finished, including clones already freed.
    for(const e of plan.encounters.slice(0,sec.first))if(e.task!==undefined){mission.completed++;alliesFreed+=mission.spec.tasks[e.task][4]||0;}
    if(LEVELS[i].sections.slice(0,start).some(s=>s.drive)&&!sec.drive)parkedCar={x:plan.sections.find(s=>s.index>0&&!s.drive&&plan.sections[s.index-1].drive).x-30,y:340};
  }
  driving=!!sec.drive;camera=clamp(player.x-255,0,level.length-W+180);placeProps(start);enterSection(start,true);
  for(let k=0;k<alliesFreed;k++)spawnAlly(k,true);
  resetInput();started=true;toast=driving?(TOUCH?'STICK STEERS · HIT BASHES · JUMP BOOSTS':'STEER ↑↓ · RAM ENEMIES · J BASH · K BOOST'):start?'CHECKPOINT · '+sec.name:TOUCH?'STICK MOVES · PUSH TO THE EDGE TO RUN · HIT · JUMP · PICK':'MOVE → · J ATTACK · K JUMP · E PICK UP';toastTime=6;
  if(opts.skipBrief){state='play';panel('');canvas.focus();return;}
  const resume=start?`<p style="color:var(--acid)">RESUMING AT SECTION ${start+1} · ${sec.name}</p>`:'';
  state='brief';panel(`<section class="panel small-panel"><p class="eyebrow">CHAPTER 0${i+1} · ${level.area.split('/')[1].trim()}</p><h2>${level.name}</h2><p>${level.brief}</p><p style="color:var(--acid);white-space:pre-line">${level.dialog}</p>${resume}<div class="menu-buttons"><button id="enter-stage" class="primary">${driving?'START YOUR ENGINE':'ENTER THE CHAPTER'} →</button></div></section>`);bindButton('enter-stage',()=>{state='play';panel('');resetInput();canvas.focus();});}
function enterSection(k,quiet=false){
  sectionIndex=k;const s=plan.sections[k];
  if(!!s.drive!==driving){
    driving=!!s.drive;flash=.45;shake=5;player.z=0;player.vz=0;player.pickup=0;player.vx=0;player.vy=0;player.bank=0;player.bump=0;
    if(driving){dropWeapon();parkedCar=null;toast='BACK IN THE CADILLAC!';}
    else{parkedCar={x:player.x-30,y:clamp(player.y,300,380)};toast='ON FOOT · THE CADILLAC WAITS HERE';}
    toastTime=3.5;
  }else if(!quiet){toast=s.name;toastTime=3.5;}
  if(s.say)say(s.say);
  checkpoint();
}
function pause(){if(state==='play'){state='paused';resetInput();panel(`<section class="panel small-panel"><p class="eyebrow">TAKE A BREATHER</p><h2>PAUSED.</h2><p>Chapter 0${levelIndex+1} · ${level.name}<br>Section ${sectionIndex+1} of ${plan.sections.length} · ${plan.sections[sectionIndex].name}<br>Your checkpoint is saved at the start of this section.</p><div class="menu-buttons"><button id="resume" class="primary">RESUME →</button><button id="controls" class="secondary">CONTROLS</button><button id="pause-sound" class="secondary">AUDIO SETTINGS</button>${TOUCH&&!root.classList.contains('standalone')?`<button id="pause-full" class="secondary">${isFull()?'EXIT FULLSCREEN':'FULLSCREEN'}</button>`:''}<button id="restart" class="secondary">RESTART SECTION</button><button id="quit" class="secondary">MAIN MENU</button></div></section>`);bindButton('resume',resume);bindButton('pause-sound',()=>soundRoom(()=>{state='play';pause();}));bindButton('pause-full',()=>{toggleFull();setTimeout(()=>{if(state==='paused'){state='play';pause();}},450);});bindButton('controls',()=>guide(()=>{state='play';pause();}));bindButton('restart',()=>startStage(levelIndex,{section:sectionIndex}));bindButton('quit',()=>{checkpoint();menu();});}else if(state==='paused')resume();}
function resume(){state='play';panel('');resetInput();canvas.focus();}
function gameover(){state='gameover';save.best=Math.max(save.best,score);persist();const at=Math.max(0,sectionIndex);panel(`<section class="panel small-panel"><p class="eyebrow">THE COUNT RAN OUT</p><h2>GAME OVER.</h2><p>No coin dropped in time. The gang can regroup at the start of section ${at+1}: ${plan.sections[at].name}.<br>Score ${score.toString().padStart(6,'0')} · Best combo ${bestCombo}</p><div class="menu-buttons"><button id="retry" class="primary">TRY AGAIN →</button><button id="quit" class="secondary">MAIN MENU</button></div></section>`);bindButton('retry',()=>{lives=3;startStage(levelIndex,{section:at});});bindButton('quit',menu);}
function stageClear(){if(cleared)return;cleared=true;state='clear';score+=2500+Math.floor(player.hp*10);save.unlocked=Math.max(save.unlocked,Math.min(5,levelIndex+1));save.best=Math.max(save.best,score);sfx('clear');save.checkpoint=levelIndex<5?{level:levelIndex+1,section:0,hero:selected,difficulty,score,lives}:null;persist();panel(`<section class="panel small-panel"><p class="eyebrow">CHAPTER 0${levelIndex+1} COMPLETE</p><h2>${levelIndex===5?'THE COPIES ARE FREE.':'KEEP THE ENGINE RUNNING.'}</h2><p>${level.end}</p><p style="color:var(--acid)">SCORE ${score.toString().padStart(6,'0')} · BEST COMBO ${bestCombo} · ${Math.floor(stageTimer/60)}:${Math.floor(stageTimer%60).toString().padStart(2,'0')}</p><div class="menu-buttons"><button id="next" class="primary">${levelIndex===5?'SEE THE ENDING':'NEXT CHAPTER'} →</button></div></section>`);bindButton('next',()=>levelIndex<5?startStage(levelIndex+1):ending());}
function ending(){state='ending';save.checkpoint=null;persist();const me=HEROES[selected];panel(`<section class="panel small-panel"><p class="eyebrow">FESSENDEN’S LEGACY · THE END</p><h2>NOBODY’S COPY.</h2><p>Morning finds the Crown dam quiet. The vat hall is flooded, Echo’s archive is ash, and a green stain on the spillway is all that is left of Fessenden’s last copy. Marshal Sable sits in a cell the freed clones built themselves. Not one of the copies goes back into a tank.</p><p>The Mirror Gang stands at the edge of the spillway, watching the river run free. Your clone looks a lot like you — a little younger, a lot less sure. “Guess I need my own name,” it says.</p><p style="color:var(--acid)">MUSTAPHA: Take “Mostafa”. Nobody spells it right anyway.<br>MESS: Can we go home now? Before anybody grows a fifth one of me?<br>JACK: Everybody in. The Cadillac seats four — the copies can follow in the truck.</p><p>${me.name} drives home with the gang · ${kills} enemies defeated · ${Math.floor(runTime/60)} minutes · score ${score}<br>All six chapters are now available.</p><div class="menu-buttons"><button id="chapters" class="primary">PLAY A CHAPTER →</button><button id="credits" class="secondary">CREDITS</button><button id="quit" class="secondary">MAIN MENU</button></div></section>`);bindButton('chapters',chapters);bindButton('credits',credits);bindButton('quit',menu);}
function credits(){state='credits';panel(`<section class="panel small-panel"><p class="eyebrow">THANKS FOR PLAYING</p><h2>FOR THE OLD ARCADE DAYS.</h2><p>An unofficial fan sequel created for Mostafa's next adventure. It continues the story of Capcom's 1993 arcade game after Dr. Fessenden's defeat. Original character graphics were recovered from the arcade ROM files supplied by the user.</p><p>New story, levels, encounters, combat engine and boss behaviors were created for this game. Original soundtrack supplied by the user. New scenery and human boss artwork were generated for this sequel; the original heroes and regular enemy artwork are retained. Original Cadillacs and Dinosaurs arcade game and artwork: Capcom. Characters and setting derive from Xenozoic Tales by Mark Schultz.</p><div class="menu-buttons"><button id="quit" class="primary">MAIN MENU →</button></div></section>`);bindButton('quit',menu);}
const BASE_HP={brute:125,gunner:68,raptor:90,knifer:82,mutant:138,biker:125,regent:150,slicer:160,mirror:150};
const BOSS_HP=[760,860,840,940,940,800];
// Bosses call reinforcements from both edges at two thirds and one third of their health.
const BOSS_GUARDS=[['raider','knifer','gunner'],['biker','biker','gunner'],['raptor','raptor','raptor'],['brute','gunner','knifer'],['mutant','regent','gunner'],['mirror','mirror','regent']];
function bossReinforce(e){e.calls=(e.calls||0)+1;BOSS_GUARDS[levelIndex].forEach((type,j)=>arrive(type,j%2?'L':'R',j));toast='REINFORCEMENTS · WATCH BOTH SIDES';toastTime=2.5;}
function spawnEnemy(x,y,type='raider',boss=false) {
  const base=boss?BOSS_HP[levelIndex]:(BASE_HP[type]||80),hp=base*rules().enemyHealth;
  const e={id:Math.random(),x,y,z:0,dir:-1,hp,maxhp:hp,type,boss,phase:1,state:'walk',timer:rand(.8,1.8),hurt:0,inv:0,anim:rand(0,1),dead:0,attack:0,attackNo:0,hitChain:0,hitTimer:0,recovery:0,onstage:true,delay:0,
    clone:!boss&&(['mutant','regent','mirror'].includes(type)||Math.random()<(level.clones||0)),hero:Math.floor(Math.random()*4)};
  enemies.push(e);return e;
}
// Reinforcements walk or run in from beyond the screen edges, or drop from above, one after another.
function arrive(type,side,j){
  // Nobody stands on a moving highway: foot gunners in the driving sections ride in as armed bikers instead.
  if(driving&&type==='gunner')type='biker';
  const L=lock||{left:camera,right:camera+W},lane=clamp(296+((j*41+wave*23+(encounter?.next||0)*17)%92),290,388);let e;
  if(side==='T'&&!driving&&type!=='biker'){const x=L.left+150+((j*173+wave*61)%(W-300));e=spawnEnemy(x,lane,type);e.z=lane+70;e.vz=0;e.state='drop';}
  else{const s=side==='L'?-1:1,x=s>0?L.right+70+j*80:L.left-70-j*80;e=spawnEnemy(x,lane,type);e.state='enter';e.dir=-s;e.onstage=false;e.enterX=s>0?L.right-110-j*46:L.left+110+j*46;}
  e.delay=j*.55;e.waiting=enemies.filter(v=>v!==e&&!v.dead&&!v.dying&&!v.waiting&&v.state!=='flee').length>=rules().crowdLimit;return e;
}
function startEncounter(enc){
  wave++;const cam=clamp(player.x-255,0,level.length-W+180);lock={left:cam,right:cam+W};
  encounter={spec:enc,next:0,timer:0,eliteSpawned:false};
  if(enc.task!==undefined)createTaskFor(enc.task);
  if(enc.say)say(enc.say);
  if(enc.boss){spawnBoss();return;}
  spawnNextWave();
  toast=lock&&enc.from==='T'?'LOOK UP!':enc.from==='B'||enc.from==='L'?'AMBUSH · WATCH BOTH SIDES':driving?'INTERCEPT THE ESCORT':'INCOMING';toastTime=2;
}
function spawnNextWave(){
  const spec=encounter.spec,waves=spec.w||[];if(encounter.next>=waves.length)return false;
  const lineup=[...waves[encounter.next]];if(rules().extraWaveEnemy)lineup.push(driving?'biker':encounter.next%2?'knifer':'gunner');
  // The first wave keeps the encounter's entrance; later waves alternate sides so fights never feel scripted.
  const from=encounter.next===0?spec.from||'R':spec.from==='T'?'B':encounter.next%2?(spec.from==='L'?'R':'L'):spec.from||'R';
  lineup.forEach((type,j)=>{const e=arrive(type,from==='B'?(j%2?'L':'R'):from,j);if(j===0&&encounter.next===0&&wave%3===0)e.loot=CARRIED[levelIndex][(wave/3)%3];});
  encounter.next++;encounter.timer=0;return true;
}
function spawnElite(spec){
  encounter.eliteSpawned=true;const e=arrive(spec.type,'R',0);e.delay=.3;e.elite=true;e.clone=true;e.name=spec.name;e.scale=spec.scale;e.after=spec.after;
  e.hp=e.maxhp=spec.hp*rules().enemyHealth;if(spec.type==='mirror')e.hero=(selected+(spec.hero||0))%4;
  toast=spec.name+' · INCOMING';toastTime=3;sfx('special');return e;
}
function updateEncounter(){
  if(!encounter||encounter.spec.boss)return;
  const alive=enemies.filter(e=>!e.dead&&e.state!=='flee').length,waves=encounter.spec.w||[];
  if(encounter.next<waves.length){if(alive<=1||encounter.timer>16)spawnNextWave();}
  else if(encounter.spec.elite&&!encounter.eliteSpawned&&alive<=1)spawnElite(encounter.spec.elite);
}
const encounterSpawned=()=>encounter&&(encounter.spec.boss?bossSpawned:encounter.next>=(encounter.spec.w||[]).length&&(!encounter.spec.elite||encounter.eliteSpawned));

let mission=null;
function initMission(){const spec=EDEN_MISSIONS[levelIndex];mission={completed:0,total:spec.tasks.length,active:null,items:[],spec};radio=null;}
function say(text){if(text&&radio?.text!==text&&!radioQueue.includes(text))radioQueue.push(text);}
function createObjective(kind,name,x,y,target=0,bossTask=false,taskIndex=-1){
  const item={kind,name,x,y,target,channel:0,progress:0,hp:kind==='beacon'?bossTask?300:80:1,maxhp:kind==='beacon'?bossTask?300:80:1,done:false,bossTask,taskIndex};
  mission.items.push(item);mission.active=item;
  toast=kind==='beacon'?'DESTROY THE SONIC LURE':kind==='cargo'?'STEER INTO THE POD CRATE':kind==='tuner'?`TUNE CHANNEL ${target} · E TO STEP`:kind==='pod'?'HOLD E / PICK TO OPEN THE POD':'HOLD E / PICK TO OPERATE';toastTime=3.5;return item;
}
function createTaskFor(n){const [kind,name,target]=mission.spec.tasks[n];createObjective(kind,name,lock.right-(driving?150:175),n%2?318:366,target||0,false,n);}
function objectiveNear(){const t=mission?.active;return t&&!t.done&&Math.abs(t.x-player.x)<(driving?130:65)&&Math.abs(t.y-player.y)<43&&player.z===0;}
function interactMission(tapped=false){
  const t=mission?.active;if(!objectiveNear()||!t||t.kind==='beacon'||t.kind==='cargo')return false;
  if(t.kind==='tuner'&&tapped){t.channel=(t.channel+1)%4;sfx('pickup');if(t.channel===t.target)completeObjective();}
  return true;
}
function completeObjective(){
  const t=mission?.active;if(!t||t.done)return;t.done=true;t.progress=1;mission.completed++;mission.active=null;score+=800;sfx('pickup');burst(t.x,t.y-48,'#ace1b4',18);
  const task=mission.spec.tasks[t.taskIndex];if(task?.[3])say(task[3]);if(task?.[4])freeClones(task[4]);
  if(t.kind==='valve')zones=zones.filter(z=>z.style!=='vent');
  if(t.bossTask&&levelIndex===2){for(const e of enemies)if(e.boss&&!e.dead){e.hp=1;e.state='flee';e.timer=1.8;e.inv=3;e.z=0;e.dir=1;clearEnemyHazards(e.id);}say('HANNAH: The driver is dead. Let it go — it never asked to be born.');}
  if(t.bossTask&&levelIndex===5){say('MUSTAPHA: Spillway open! The turbines are drowning — the vats are going dark!');spawnLastCopy();}
}
// The last tank in the vat hall never held one of the gang. Echo grew a copy of Fessenden himself from the archive's
// own sample and dosed it with his serum; when the power dies, the tank cracks and the beast from the jungle lab is back.
function spawnLastCopy(){
  if(!lock)lock={left:camera,right:camera+W};encounter={spec:{boss:true},next:0,timer:0};bossSpawned=true;cleared=false;
  const b=spawnEnemy(lock.right+210,352,'fessenden',true);b.hp=b.maxhp=1150*rules().enemyHealth;b.name='LOT 00 · FESSENDEN';b.phase=3;b.calls=0;
  b.timer=3.2;b.state='intro';b.inv=3.2;b.enterX=lock.right-240;b.dir=-1;b.clone=true;bossIntro=3.2;
  flash=.8;shake=14;toast='THE LAST TANK CRACKS OPEN';toastTime=4.5;sfx('explosion');effects.push({x:lock.right-120,y:352,age:0,life:.8,type:'explosion'});explosionParticles(lock.right-120,352);
  say('HANNAH: That tank was never one of ours. She grew HIM. Fessenden — serum and all.');say('JACK: It isn’t him. It’s a copy. Copies can be deleted.');
}
function damageObjective(power,x=player.x,y=player.y,range=90,dir=player.dir){
  const t=mission?.active;if(!t||t.kind!=='beacon'||t.done)return false;
  if(Math.abs(t.x-x)>range||Math.abs(t.y-y)>38||(Math.abs(t.x-x)>15&&Math.sign(t.x-x)!==dir))return false;
  t.hp-=power;burst(t.x,t.y-40,'#8fdde2',8);if(t.hp<=0)completeObjective();return true;
}
function updateMission(dt){
  if(radio){radio.ttl-=dt;if(radio.ttl<=0)radio=null;}
  if(!radio&&radioQueue.length)radio={text:radioQueue.shift(),ttl:4.6};
  const t=mission?.active;if(!t)return;
  if(t.kind==='cargo'){if(objectiveNear())completeObjective();return;}
  if(t.kind==='beacon'||t.kind==='tuner')return;
  if(objectiveNear()&&down('KeyE','KeyV')&&player.hurt<=0&&player.attack<=0&&!player.move){t.progress+=dt/(t.bossTask?1.4:.85);if(t.progress>=1)completeObjective();}
  else t.progress=Math.max(0,t.progress-dt*.7);
}
function drawMissionItem(t){
  const x=t.x-camera,y=t.y;if(x<-100||x>W+100)return;shadow(ctx,x,y,25);
  const glow=t.done?'#a9de9a':t.kind==='beacon'?'#efaa71':levelIndex===5&&t.kind==='gate'?'#c08cff':'#7fdfd5';
  if(t.kind==='cargo'){
    // A convoy flatbed keeping pace with the Cadillac; ramming it knocks the stasis pod loose.
    const spin=road/9;shadow(ctx,x,y,62);
    rect(ctx,x-62,y-16,124,7,'#2d3a3a');rect(ctx,x-58,y-27,116,12,'#55655f');rect(ctx,x-58,y-27,116,3,'#8a9a90');rect(ctx,x+58,y-22,26,4,'#6d7d78');
    for(const wx of [-40,38]){circle(ctx,x+wx,y-7,12,'#141a1e');circle(ctx,x+wx,y-7,7,'#9aa5ad');circle(ctx,x+wx,y-7,3,'#2a3238');rect(ctx,x+wx+Math.cos(spin)*5-1,y-7+Math.sin(spin)*5-1,2,2,'#3a434a');}
    rect(ctx,x-35,y-63,70,36,'#223332');rect(ctx,x-31,y-60,62,29,t.done?'#557363':'#968a5b');rect(ctx,x-5,y-61,10,32,'#d3c798');rect(ctx,x-25,y-50,19,9,'#304843');
    rect(ctx,x+10,y-55,14,18,t.done?'#2c4a3c':'#5fd39a');rect(ctx,x+13,y-52,8,12,'#bff3d6');
    for(const sx of [-33,27]){rect(ctx,x+sx,y-30,6,4,'#8a9a90');}
  }else if(t.kind==='pod'){
    // Refrigerated clone pod from Fessenden's lab: frosted glass, green gel and a sleeping copy.
    rect(ctx,x-24,y-12,48,12,'#2a3a3f');rect(ctx,x-20,y-92,40,82,'#0c2224');
    if(!t.done){rect(ctx,x-18,y-88,36,76,'#3fbf8a66');const f=COMBAT_ART.frames[COMBAT_ART.groups.raider.walk[0]];ctx.save();ctx.beginPath();ctx.rect(x-18,y-88,36,76);ctx.clip();drawCombat(ctx,f,x+2,y-12+Math.sin(time*2)*2,.82,-1,'brightness(.45) sepia(1) hue-rotate(80deg) saturate(2)');ctx.restore();for(let i=0;i<4;i++)rect(ctx,x-12+i*8,y-14-((time*28+i*19)%70),2,2,'#c8ffe0');}
    else{rect(ctx,x-18,y-30,36,18,'#3fbf8a44');rect(ctx,x-14,y-86,4,30,'#bfe9ff55');}
    rect(ctx,x-16,y-86,4,72,'#ffffff22');rect(ctx,x-22,y-96,44,8,'#4b5d63');rect(ctx,x-9,y-104,18,8,'#6f8288');
    label('F',x+12,y-74,10,t.done?'#89a395':'#c7f4dc','center');
  }else if(t.kind==='gate'&&levelIndex===5){
    // Command pylon broadcasting Echo's control signal.
    rect(ctx,x-18,y-16,36,16,'#2b2f3c');rect(ctx,x-9,y-112,18,98,'#3b3f52');rect(ctx,x-5,y-108,10,90,t.done?'#2a2535':'#8656d8');
    if(!t.done){ctx.strokeStyle='#c49bff88';for(let i=0;i<3;i++){const r=(time*40+i*20)%60;ctx.beginPath();ctx.ellipse(x,y-112,r,r*.35,0,0,Math.PI*2);ctx.stroke();}rect(ctx,x-3,y-100+((time*60)%80),6,6,'#f0e2ff');}
    else{rect(ctx,x-12,y-70,24,4,'#16131c');rect(ctx,x+2,y-60,10,3,'#16131c');}
    rect(ctx,x-24,y-122,48,10,'#4a4f63');ctx.strokeStyle=glow;ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y-46,11,0,Math.PI*2);ctx.stroke();
  }else{
    rect(ctx,x-23,y-63,46,64,'#142d34');rect(ctx,x-20,y-60,40,51,'#496671');rect(ctx,x-16,y-55,32,23,'#152d31');rect(ctx,x-12,y-51,24,14,glow);
    for(let i=0;i<3;i++)rect(ctx,x-14+i*11,y-23,6,7,i===0?glow:'#89988e');rect(ctx,x-27,y-9,54,9,'#273d40');
    if(t.kind==='relay'||t.kind==='beacon'){rect(ctx,x-2,y-91,4,29,'#9aaea5');for(let j=0;j<3;j++)rect(ctx,x-17+j*4,y-86+j*8,34-j*8,3,glow);if(!t.done){ctx.strokeStyle=glow+'77';ctx.beginPath();ctx.ellipse(x,y-79,12+(time*18)%35,7+(time*9)%17,0,0,Math.PI*2);ctx.stroke();}}
    if(t.kind==='valve'||t.kind==='gate'){ctx.strokeStyle=glow;ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y-40,13,0,Math.PI*2);ctx.stroke();rect(ctx,x-2,y-53,4,26,'#273d40');}
  }
  if(t.done){label('✓',x,y-(t.kind==='gate'&&levelIndex===5?130:t.kind==='pod'?112:79),17,glow,'center');return;}
  const tall=t.kind==='gate'&&levelIndex===5?40:t.kind==='pod'?18:0;
  const hint=t.kind==='beacon'?'J / FIRE · SILENCE':t.kind==='cargo'?'RAM TO COLLECT':t.kind==='tuner'?`E · ${t.channel} → ${t.target}`:'HOLD E / PICK';
  label(t.name,x,y-106-tall,9,'#e6e6c4','center');label(hint,x,y-92-tall,10,glow,'center');
  rect(ctx,x-30,y-76-tall,60,4,'#10222b');rect(ctx,x-30,y-76-tall,60*(t.kind==='beacon'?t.hp/t.maxhp:t.progress),4,glow);
}
function missionHud(){
  if(!mission)return;rect(ctx,14,147,290,28,'#101f25d9');label(`${mission.spec.verb.toUpperCase()} ${mission.completed}/${mission.total}`,23,166,10,'#afded4');
  if(allies.length)label(`FREED CLONES ×${allies.filter(a=>a.state!=='retreat').length}`,23,186,10,'#ffe08a');
  const t=mission.active;if(t&&(t.x-camera<30||t.x-camera>W-30))label(t.x<player.x?'← OBJECTIVE':'OBJECTIVE →',t.x<player.x?24:W-24,208,11,'#99e5d8',t.x<player.x?'left':'right');
  // Radio chatter runs in a strip under the status bar, over the sky, so it never hides the fighters or the car.
  if(radio){rect(ctx,0,68,W,24,'#0d202bee');rect(ctx,0,91,W,1,'#3f5c57');label('RADIO',14,84,8,'#7fb09a');label(radio.text,W/2+16,84,10,'#c8e7d4','center');}
}

function spawnBoss() {
  bossSpawned=true;if(!lock)lock={left:camera,right:camera+W};if(!encounter)encounter={spec:{boss:true},next:0,timer:0};
  const b=spawnEnemy(lock.right+150,344,level.kind,true);b.timer=2.4;b.state='intro';b.inv=2.4;b.enterX=lock.right-170;b.dir=-1;bossIntro=2.4;
  toast=level.boss+' · '+['BREAK THE BLOCKADE','RAM THE ESCORT','SILENCE THE DRIVER','DODGE THE CLEAVES','BREAK HER RHYTHM','STOP THE MARSHAL'][levelIndex];toastTime=4;
  if(levelIndex===2){mission.total=4;createObjective('beacon','NEST SONIC DRIVER',lock.right-260,375,0,true);}
  sfx('special');
}
// Freed clones join from behind the player, in the order the Mirror Gang was beaten; your own copy comes last.
function spawnAlly(k,quiet=false){
  const order=[1,2,3,0],hero=(selected+order[k%4])%4,hp=rules().allyHealth,L=lock||{left:camera};
  allies.push({id:'ally'+k,ally:true,hero,lane:[-26,22,-8,36][k%4],x:L.left-60-k*45,y:clamp(player.y+[-26,22,-8,36][k%4],290,388),z:0,dir:1,hp,maxhp:hp,state:'enter',timer:.4,anim:rand(0,1),hurt:0,inv:0,calm:0,strikeFlash:0,moving:false});
  if(!quiet)popup(player.x,player.y-120,'A CLONE BREAKS FREE','#ffe08a');
}
function freeClones(n){for(let i=0;i<n;i++)spawnAlly(alliesFreed++);toast='FREED CLONES JOIN THE FIGHT';toastTime=3;flash=.25;}
function hurtAlly(a,amount,fromX){
  if(a.inv>0||a.hp<=0)return;a.hp-=amount*.8;a.hurt=.3;a.inv=.4;a.calm=0;a.x+=fromX<a.x?18:-18;a.state='walk';burst(a.x,a.y-45,'#ffe08a',6);sfx('hit');
  if(a.hp<=0){a.state='down';a.timer=1.3;popup(a.x,a.y-100,'CLONE FALLS BACK','#ffe08a');}
}
function updateAlly(a,dt){
  a.anim+=dt;a.hurt=Math.max(0,a.hurt-dt);a.inv=Math.max(0,a.inv-dt);a.timer-=dt;a.strikeFlash=Math.max(0,a.strikeFlash-dt);a.calm+=dt;a.moving=false;
  if(a.state==='down'){if(a.timer<=0)a.state='retreat';return;}
  if(a.state==='retreat'){a.x-=200*dt;a.dir=-1;a.moving=true;if(a.x<camera-140)a.remove=true;return;}
  if(a.calm>3&&a.hp<a.maxhp)a.hp=Math.min(a.maxhp,a.hp+8*dt);
  if(a.hurt>0)return;
  if(a.state==='windup'){if(a.timer<=0){const t=a.target;a.strikeFlash=.22;if(t&&!t.dead&&Math.abs(t.x-a.x)<(t.boss?130:82)&&Math.abs(t.y-a.y)<36)damageEnemy(t,HEROES[a.hero].power*(t.boss||t.elite?.3:.62),a.dir*16,false,true);a.state='walk';a.timer=rand(.35,.75);}return;}
  let t=null,best=1e9;
  for(const e of enemies){if(e.dead||e.dying||e.state==='flee'||!e.onstage||e.delay>0||(e.state==='drop'&&e.z>30)||(e.boss&&e.state==='intro'))continue;const d=Math.hypot(e.x-a.x,(e.y-a.y)*1.5);if(d<best){best=d;t=e;}}
  const speed=HEROES[a.hero].speed*.82;
  if(t){
    const want=t.boss?105:50,dist=Math.abs(t.x-a.x);a.dir=Math.sign(t.x-a.x)||a.dir;
    if(dist>want){a.x+=a.dir*speed*(dist>160?1.5:1)*dt;a.moving=true;}
    const ty=t.y+(a.lane>0?6:-6);if(Math.abs(a.y-ty)>2){a.y=approach(a.y,ty,speed*.6*dt);a.moving=true;}
    if(dist<want+22&&Math.abs(t.y-a.y)<26&&a.timer<=0){a.target=t;a.state='windup';a.timer=.26;}
  }else{
    const tx=player.x-player.dir*(80+Math.abs(a.lane)),ty=clamp(player.y+a.lane,290,388),far=Math.abs(tx-a.x);
    if(far>18){a.dir=Math.sign(tx-a.x);a.x+=a.dir*speed*(far>260?1.7:1)*dt;a.moving=true;}
    if(Math.abs(a.y-ty)>3){a.y=approach(a.y,ty,speed*.6*dt);a.moving=true;}
  }
  if(a.state==='enter'&&(!lock||a.x>lock.left+30))a.state='walk';
  if(lock&&a.state!=='enter')a.x=clamp(a.x,lock.left+20,lock.right-20);a.y=clamp(a.y,284,393);
}

function popup(x,y,text,color='#e9ecd1'){floating.push({x,y,text,color,life:1.15});}
function burst(x,y,color,n=12){for(let i=0;i<n;i++)particles.push({x,y,vx:rand(-120,120),vy:rand(-140,60),life:rand(.18,.55),size:rand(2,5),color});}
// Knocked-down and defeated fighters are flung back in an arc, bounce once and slide, as in the arcade game.
// Knockdowns throw an enemy back about a body length and a half, as in the arcade, not across the screen.
function launch(e,dir,power=1,fling=null){e.state='fly';e.vx=fling?fling.vx:dir*(105+55*power);e.vz=fling?fling.vz:165+50*power;e.z=Math.max(e.z,2);e.bounces=0;e.inv=Math.max(e.inv,.25);e.hitChain=0;if(e.vx)e.dir=-Math.sign(e.vx);}
function bloodBurst(e,dir,opts){
 const f=CFG.fx.blood,n=opts.sharp?f.knifeCount:f.count;
 for(let i=0;i<n;i++)particles.push({kind:'blood',x:e.x+dir*8,y:e.y-(opts.hitZ||(60+e.z)),ground:e.y-1,vx:dir*rand(...f.speed),vy:rand(-100,25),life:rand(...f.life),size:i%3?2:3,color:f.colors[i%f.colors.length]});
}
function explosionParticles(x,y){
 const f=CFG.fx.explosion;
 for(let i=0;i<f.fragments;i++)particles.push({kind:'debris',x,y:y-20,ground:y,vx:rand(-220,220),vy:rand(-260,-65),life:rand(.55,1.05),size:rand(2,5),color:i%2?'#fac45d':'#816b58'});
 for(let i=0;i<f.smoke;i++)particles.push({kind:'smoke',x:x+rand(-30,30),y:y-rand(16,60),vx:rand(-26,26),vy:rand(-65,-30),life:f.smokeLife+rand(-.15,.2),maxLife:f.smokeLife+.2,size:rand(8,15),color:i%2?'#74787c':'#41474c',float:true});
}
function updateParticles(dt){
 for(const p of particles){p.life-=dt;if(p.rest)continue;p.x+=p.vx*dt;p.y+=p.vy*dt;if(!p.float)p.vy+=CFG.fx.gravity*dt;
   if(p.ground!==undefined&&p.y>=p.ground){p.y=p.ground;if(p.kind==='blood'){p.rest=true;p.life=CFG.fx.blood.groundLife;}else if(!p.bounced){p.vy=-Math.abs(p.vy)*.28;p.vx*=.55;p.bounced=true;}else p.rest=true;}}
 particles=particles.filter(p=>p.life>0).slice(-CFG.fx.maxParticles);
}
function drawParticles(){
 for(const p of particles){ctx.save();ctx.globalAlpha=clamp(p.life/(p.kind==='smoke'?p.maxLife:.25),0,1);const x=Math.round(p.x-camera),y=Math.round(p.y);
   if(p.kind==='smoke'){const unit=Math.max(2,Math.round((p.size+(p.maxLife-p.life)*15)/7));for(let row=0;row<7;row++){const w=[3,5,7,7,7,5,3][row];rect(ctx,x-w*unit/2,y+(row-3)*unit,w*unit,unit,p.color);}rect(ctx,x-unit*2,y-unit*2,unit*3,unit,'#8d9294');rect(ctx,x-unit*3,y-unit,unit,unit*2,'#666e73');}
   else if(p.kind==='shell')rect(ctx,x,y,p.rest?4:2,p.rest?2:4,p.color);
   else if(p.kind==='blood')rect(ctx,x,y,p.rest?5:Math.abs(p.vx)>100?4:2,p.rest?1:p.size,p.color);
   else rect(ctx,x,y,p.size,p.size,p.color);ctx.restore();}
}
function damageEnemy(e,amount,knock=0,forceDown=false,byAlly=false,opts=null) {
  if(e.waiting||e.dead||e.dying||e.inv>0||e.state==='flee'||(e.state==='drop'&&e.z>40)||e.delay>0)return false;
  const heavy=forceDown||!!opts?.heavy,melee=!!opts?.melee,kdir=Math.sign(knock)||-e.dir||1;
  e.hp-=amount;e.hurt=e.boss?.07:byAlly?.04:.15;e.inv=.055;if(e.boss||e.state==='fly')e.x+=knock*(e.boss?.25:.3);else if(!heavy&&e.state!=='held')e.x+=knock*(e.elite?.5:1);
  if(lock&&e.onstage)e.x=clamp(e.x,lock.left+28,lock.right-42);
  e.hitChain=e.hitTimer>0?e.hitChain+1:1;e.hitTimer=1.1;
  // Mid-bosses shrug off single knockdowns and need longer chains. Freed clones' blows hurt without
  // interrupting every move, so a hostile copy can still trade punches with them.
  if(!e.boss&&e.state!=='held'&&e.state!=='fly'){if((forceDown&&(!e.elite||e.hitChain>=2))||e.hitChain>=(e.elite?5:byAlly?4:melee?5:3))launch(e,kdir,heavy?1.2:.8,opts?.fling);else if(!byAlly){e.state='hurt';e.timer=e.elite?.16:.25;}}
  else if(e.state==='held'&&forceDown)launch(e,kdir,1.2,opts?.fling);
  // Hitstop: attacker and victim both hold the impact frame; the victim shakes. Heavier blows hold longer.
  if(!byAlly){lastHitEnemy=e;combo++;comboTimer=2;bestCombo=Math.max(bestCombo,combo);score+=Math.floor(amount*3);
    const stop=melee?(heavy?.16:.1):opts?.bullet?.04:.06;e.freeze=Math.max(e.freeze||0,stop);if(melee)player.freeze=Math.max(player.freeze||0,stop);shake=Math.max(shake,heavy?5:2);}
  if(!opts?.bullet)effects.push({type:'spark',x:e.x+kdir*-12,y:e.y-(e.boss?84:62)-e.z,age:0,life:heavy?.2:.13,big:heavy});
  if((opts?.bullet||opts?.sharp)&&e.type!=='truck'&&!(e.type==='sable'&&e.phase===2))bloodBurst(e,kdir,opts);else burst(e.x,e.y-52-e.z,'#ffe2a1',opts?.bullet?8:4);if(!opts?.bullet)sfx(heavy?'heavy':'hit');
  if(e.boss&&e.hp>0&&(e.calls||0)<2&&e.hp<e.maxhp*[.66,.33][e.calls||0])bossReinforce(e);
  if(e.hp<=0){
    if(e.boss&&e.type==='sable'&&e.phase===1){clearEnemyHazards(e.id);e.z=0;e.phase=2;e.calls=0;e.hp=e.maxhp=1050*rules().enemyHealth;e.state='transform';e.timer=2.7;e.inv=2.7;e.attackNo=0;flash=.65;shake=12;toast='SABLE BOARDS THE CROWN ENGINE';toastTime=4;effects.push({x:e.x,y:e.y,age:0,life:.8,type:'explosion'});say('SABLE: You want to see what Cinder built me? Look up.');return true;}
    if(e.type==='raptor'&&e.boss&&mission.active?.bossTask){e.hp=1;e.state='recover';e.timer=1.4;e.inv=1.4;toast='SILENCE THE NEST DRIVER TO STOP THE BEAST';toastTime=2;return true;}
    if(e.type==='raptor'){e.state='flee';e.timer=1.2;e.hp=1;e.inv=2;e.dir=1;score+=e.elite?1200:300;kills++;if(e.after)say(e.after);return true;}
    // Beaten copies of the heroes stagger away instead of dissolving; the final chapter frees them.
    if(e.type==='mirror'&&e.elite){e.state='flee';e.timer=1.6;e.hp=1;e.inv=3;e.dir=1;score+=1500;kills++;clearEnemyHazards(e.id);if(e.after)say(e.after);return true;}
    if(e.boss){e.dead=1;e.z=0;e.state='dead';}else{e.dying=true;e.inv=99;if(e.state!=='fly')launch(e,kdir,1.4,opts?.fling);}
    // A beaten rider's bike goes up in a fireball, as in the arcade's highway stage.
    if(e.type==='biker'){effects.push({x:e.x,y:e.y,age:0,life:.6,type:'explosion'});explosionParticles(e.x,e.y);sfx('explosion');shake=Math.max(shake,9);}
    clearEnemyHazards(e.id);score+=e.boss?2000:e.elite?1200:250;kills++;
    if(e.clone){e.dissolve=true;burst(e.x,e.y-40,'#8af0b0',16);}
    if(e.after)say(e.after);
    if(e.boss&&e.type==='sable'&&e.phase===2){mission.total=4;createObjective('gate','FINAL SPILLWAY RELEASE',lock.right-250,354,0,true);}
    if(e.boss)return true;
    if(driving){if(e.elite||Math.random()<rules().foodChance*1.5)drops.push(foodDrop(e.x,e.y,60,!!e.elite));}
    else if(e.loot)drops.push({x:e.x,y:e.y,type:e.loot,life:60});
    else if(e.type==='gunner')drops.push({x:e.x,y:e.y,type:levelIndex>2?'uzi':'gun',life:60});
    else if(e.type==='knifer')drops.push({x:e.x,y:e.y,type:'knife',life:60});
    else if(e.elite||Math.random()<rules().foodChance)drops.push(foodDrop(e.x,e.y,999,!!e.elite));
    else if(Math.random()<.08)drops.push(bonusDrop(e.x,e.y));
  }
  return true;
}

function damagePlayer(amount,fromX,ignoreAir=false) {
  if(player.inv>0||(!ignoreAir&&player.z>28)||player.special>0||player.boost>0)return;
  // In the Cadillac a hit is a jolt, not a knockdown: the car keeps rolling.
  player.hp-=amount*rules().damageTaken;player.hurt=driving?.3:amount>=20?.85:.3;player.knocked=!driving&&amount>=20;
  player.inv=amount>=20?1.25:.65;player.x+=fromX<player.x?23:-23;player.attack=0;player.pendingStrike=null;player.moveState=null;player.freeze=0;releaseGrab();player.z=0;player.vz=0;combo=0;comboTimer=0;player.pickup=0;player.pickTarget=null;
  player.burst=null;if(player.knocked)dropWeapon();shake=6;flash=.06;sfx('hurt');burst(player.x,player.y-45,'#eea575',8);
  if(player.hp<=0){lives--;if(lives>0){player.hp=player.maxhp;player.inv=3;player.hurt=0;player.knocked=false;dropWeapon();toast=`${lives} LIVES REMAINING`;toastTime=3;checkpoint();}else startContinue();}
}
// Arcade continue: the hero lies where they fell while a ten-second count runs. Dropping a coin (Enter, attack, the touch
// HIT button or a pad button) spends a credit and the hero gets up on the same spot with full health and lives; the
// enemies are still there. If the count reaches zero it is game over.
function startContinue(){
  state='continue';continueTimer=10;coinPending=0;player.down=true;player.hurt=0;player.knocked=false;player.attack=0;player.moveState=null;player.pendingStrike=null;player.burst=null;player.z=0;player.vz=0;releaseGrab();
  bullets=bullets.filter(b=>b.friendly);zones=[];resetInput();panel('');toast='';toastTime=0;
  // The crowd stands off while the count runs instead of freezing mid-swing.
  for(const e of enemies)if(!e.dead&&!e.dying&&['windup','charge','leap'].includes(e.state)){e.state='walk';e.timer=1.5;e.strikeFlash=0;clearEnemyHazards(e.id);}
}
function insertCoin(){coins++;sfx('pickup');if(state==='play'){toast='CREDIT '+coins;toastTime=1.5;}}
function updateContinue(dt){
  gamepad();
  if(coinPending>0){coinPending-=dt;if(coinPending<=0)respawn();pressed.clear();return;}
  continueTimer-=dt;
  if(tap('Enter','NumpadEnter','KeyJ','KeyZ','Space')){insertCoin();coinPending=.9;}
  else if(continueTimer<=0)gameover();
  pressed.clear();
}
function respawn(){
  coins=Math.max(0,coins-1);lives=3;player.hp=player.maxhp;player.inv=3;player.hurt=0;player.knocked=false;player.down=false;player.z=0;player.vz=0;dropWeapon();
  for(const e of enemies)if(!e.dead&&!e.dying&&['windup','charge','leap'].includes(e.state)){e.state='walk';e.timer=1.2;clearEnemyHazards(e.id);}
  state='play';panel('');resetInput();toast='PLAYER 1 · CONTINUE';toastTime=2.5;sfx('special');flash=.3;checkpoint();
}
function drawContinue(){
  rect(ctx,0,0,W,H,'#05100f99');const n=Math.max(0,Math.ceil(continueTimer));
  coinText('CONTINUE?',W/2,188,30);coinText(String(n),W/2,262,62);
  if(coinPending>0)coinText('CREDIT '+coins+' · PLAYER 1 START',W/2,308,16);else if(Math.floor(time*2)%2===0)coinText('INSERT COIN',W/2,308,18);
  label(TOUCH?'TAP HIT TO DROP A COIN':'PRESS ENTER OR J TO DROP A COIN',W/2,338,10,'#d8e4c8','center');
}

function shoot(x,y,dir,friendly=true,damage=18,speed=620,owner=null){bullets.push({x,y,owner,z:driving?28:48,vx:dir*speed,vy:0,friendly,damage,life:1.5,color:friendly?'#fff4af':'#ef8f68'});}
const nearbyDrop=(rx,ry,weaponsOnly)=>{let best=null,dist=1e9;for(const d of drops){if(d.claimed||(weaponsOnly&&PICKUPS.has(d.type)))continue;const dx=Math.abs(d.x-player.x),dy=Math.abs(d.y-player.y);if(dx<rx&&dy<ry&&dx+dy<dist){dist=dx+dy;best=d;}}return best;};
// Picking something up is a short crouch; the item reaches the hand halfway through it.
function startPickup(d){player.moveState=null;player.pickup=.26;player.pickTarget=d;d.claimed=true;player.attack=0;player.pendingStrike=null;player.burst=null;player.dashVelocity=0;player.attackKind='ready';if(Math.abs(d.x-player.x)>6)player.dir=Math.sign(d.x-player.x);}
function updatePickup(dt){
  if(player.pickup<=0)return;const before=player.pickup;player.pickup=Math.max(0,player.pickup-dt);
  if(before>.12&&player.pickup<=.12){
    const d=player.pickTarget;player.pickTarget=null;if(!d||!drops.includes(d))return;drops.splice(drops.indexOf(d),1);sfx('pickup');score+=75;
    if(PICKUPS.has(d.type)){consumeItem(d);}
    else{dropWeapon();player.weapon=d.type;player.ammo=d.ammo??Math.max(1,Math.round((WEAPONS[d.type]?.ammo??1)*(WEAPONS[d.type]?.melee?rules().meleeDurability:1)));toast=`${WEAPONS[player.weapon]?.name||player.weapon} · ${player.ammo} ${WEAPONS[player.weapon]?.melee?'HITS':'SHOTS'}`;toastTime=2;}
  }
}
// Ground combo taken from the arcade frame records: punch, punch, kick, finisher. The second frame of each
// move lands the blow; the chain only continues when the previous blow connected, as in the original.
const MOVE={p1:{reach:84,power:1},p2:{reach:84,power:1},kick:{reach:98,power:1.25},fin:{reach:106,power:1.75,heavy:true},knee:{power:.85},throw:{}};
function startMove(name,extra={}){
  const list=AH.heroes[HEROES[selected].id][name],n=list.length,hitAt=Math.min(1,n-1),big=name==='fin'||name==='throw';
  const frames=list.map((_,i)=>({i,d:i<hitAt?(big?.085:.055):i===hitAt?(big?.16:.12):.075,hit:i===hitAt}));
  player.moveState={name,frames,k:0,t:0,struck:[],landed:false,...extra};player.attackKind='combo';
  player.attackTotal=frames.reduce((a,f)=>a+f.d,0);player.attack=player.attackTotal;player.pendingStrike=null;
  if(hitAt===0)moveHit(player.moveState);if(name!=='throw')sfx('swing');
}
function moveHit(m){
  const spec=MOVE[m.name]||MOVE.p1,h=HEROES[selected];
  if(m.onRelease){m.onRelease();m.landed=true;return;}
  if(m.name==='knee'){const e=player.grab?.e;if(e&&damageEnemy(e,h.power*spec.power,0,false,false,{melee:true}))m.landed=true;return;}
  if(meleeStrike(spec.reach,h.power*spec.power,!!spec.heavy,m.struck,{melee:true,heavy:!!spec.heavy}))m.landed=true;
}
function updateMove(dt){
  const m=player.moveState;if(!m)return;
  if(player.freeze>0){player.attack=Math.max(player.attack,.01);return;}
  m.t+=dt;
  while(m.k<m.frames.length&&m.t>=m.frames[m.k].d){m.t-=m.frames[m.k].d;m.k++;if(m.k<m.frames.length&&m.frames[m.k].hit)moveHit(m);}
  if(m.k>=m.frames.length){player.moveState=null;player.attack=0;player.comboWin=.42;player.comboHit=m.landed;if(!m.landed)player.comboStep=-1;}
  else player.attack=Math.max(player.attack,.01);
}
// Walking into an ordinary enemy grabs them. Attack knees; back + attack throws over the shoulder;
// the fourth attack throws forward. A thrown body flies, bowls over others and bounces.
function updateGrab(dt,dx){
  const g=player.grab;
  if(!g){
    if(driving||player.weapon||player.grabCd>0||player.attack>0||player.hurt>0||player.z>0||player.pickup>0||player.special>0||!dx)return;
    const e=enemies.find(o=>!o.dead&&!o.dying&&!o.boss&&!o.elite&&o.onstage&&!(o.delay>0)&&!o.z&&['walk','hurt','windup','recover'].includes(o.state)&&!['raptor','biker','mutant','regent'].includes(o.type)&&Math.abs(o.x-player.x)<36&&Math.abs(o.y-player.y)<11&&Math.sign(o.x-player.x)===dx);
    if(e){player.grab={e,t:0,hits:0};e.state='held';e.timer=0;e.hitChain=0;clearEnemyHazards(e.id);player.dir=dx;player.moveState=null;toast=TOUCH?'GRAB · HIT KNEES · BACK + HIT THROWS':'GRAB · J KNEE · BACK + J THROW';toastTime=1.6;}
    return;
  }
  const e=g.e;g.t+=dt;
  if(e.dead||e.dying||e.state!=='held'||player.hurt>0||player.special>0){releaseGrab();return;}
  if(!player.moveState||player.moveState.name!=='throw'){e.x=player.x+player.dir*30;e.y=player.y+1;e.dir=-player.dir;e.z=0;}
  if(g.t>1.8&&!player.moveState){e.state='walk';e.timer=.45;e.x+=player.dir*20;releaseGrab();}
}
function releaseGrab(){const g=player.grab;if(g&&g.e.state==='held'){g.e.state='walk';g.e.timer=.5;}player.grab=null;player.grabCd=.5;}
function grabAttack(){
  const g=player.grab,dxk=(down('ArrowRight','KeyD')?1:0)-(down('ArrowLeft','KeyA')?1:0),back=dxk===-player.dir;
  if(back||g.hits>=3){
    const e=g.e,h=HEROES[selected],dir=back?-player.dir:player.dir;
    startMove('throw',{onRelease:()=>{if(e.state!=='held'){releaseGrab();return;}e.state='walk';e.x=player.x+dir*(back?10:28);e.z=30;
      damageEnemy(e,h.power*2.3,dir*30,true,false,{melee:true,heavy:true,fling:{vx:dir*250,vz:300}});e.thrown=true;player.grab=null;player.grabCd=.7;if(back)player.dir=dir;}});
    return;
  }
  g.hits++;startMove('knee');
}
function attack() {
  if(state!=='play'||player.hurt>0||player.attack>0||player.special>0||bossIntro>0||player.pickup>0)return;
  if(player.grab){grabAttack();return;}
  if(!driving&&!player.weapon&&player.z===0){const d=nearbyDrop(30,18,true);if(d){startPickup(d);return;}}
  if(driving){player.attack=.5;player.attackTotal=.5;player.boost=.5;meleeStrike(CAR_REACH+45,62,true);sfx('hit');return;}
  if(weaponAttack())return;
  const h=HEROES[selected];
  if(player.z<=8&&!player.run){const step=player.comboWin>0&&player.comboHit?(player.comboStep+1)%4:0;player.comboStep=step;startMove(['p1','p2','kick','fin'][step]);return;}
  player.attackKind=player.z>8?'air':'dash';player.comboStep=-1;
  player.attackTotal=player.attackKind==='dash'?.52:.45;player.attack=player.attackTotal;
  player.pendingStrike={t:.08,range:player.attackKind==='dash'?125:108,power:h.power*1.5,down:true,active:.34,struck:[]};
  if(player.attackKind==='dash'){player.dashVelocity=player.dir*[440,380,330,350][selected];if(selected!==1){player.z=16;player.vz=selected===3?170:140;}}
  sfx('swing');
}

function jump(){if(player.z>0||player.hurt>0||player.pickup>0)return;if(driving){if(player.boostCd<=0){player.boost=1.15;player.boostCd=3;player.inv=1.2;sfx('jump');}return;}player.vz=355;player.z=.1;sfx('jump');}
function special() {
  if(player.specialCd>0||player.hurt>0||bossIntro>0||player.pickup>0)return;
  player.special=.65;player.specialCd=1.9;player.inv=.8;player.attack=0;player.pendingStrike=null;player.moveState=null;releaseGrab();
  if(!driving)dropWeapon();let hits=0;
  for(const e of enemies)if(!e.dead&&e.state!=='flee'&&Math.hypot((e.x-player.x)*.8,e.y-player.y)<140){if(damageEnemy(e,HEROES[selected].power*2.2,Math.sign(e.x-player.x)*46,true))hits++;}
  if(hits&&!driving)player.hp=Math.max(1,player.hp-8);
  for(const o of objects)if(o.hp>0&&Math.abs(o.x-player.x)<115&&Math.abs(o.y-player.y)<65)breakObject(o,99);
  damageObjective(HEROES[selected].power*2.2,player.x,player.y,140,player.dir);
  sfx('special');shake=6;burst(player.x,player.y-40,HEROES[selected].color,22);
}

function pickup() {
  if(player.hurt>0||player.z>0||player.pickup>0)return;
  if(interactMission(true)||driving)return;
  const d=nearbyDrop(44,24,false);if(d){startPickup(d);return;}
  if(player.weapon)throwHeldWeapon();
}

function bossMove(e) {
  const patterns={warden:['jab','charge','slam'],truck:['volley','charge','bombard'],raptor:['charge','leap','charge'],cinder:['cleave','charge','fire'],echo:['volley','leap','summon'],sable:e.phase===2?['slam','flood','volley','charge']:['volley','jab','summon'],fessenden:e.hp<e.maxhp*.5?['charge','cleave','leap','slam','charge','summon']:['cleave','charge','slam','leap']};
  e.action=patterns[e.type][e.attackNo++%patterns[e.type].length];e.state='windup';e.timer=['charge','leap'].includes(e.action)?.85:.72;
  const beast=e.type==='fessenden';
  e.dir=Math.sign(player.x-e.x)||-1;e.targetX=player.x;e.targetY=player.y;e.startX=e.x;e.startY=e.y;
  if(e.action==='flood'){for(const offset of [-95,0,95])zones.push({owner:e.id,x:player.x+offset,y:player.y,r:58,t:1.25,total:1.25,friendly:false,damage:30,air:false,style:'flood'});e.timer=1.25;}
  if(['slam','pulse','acid','cleave','fire','bombard'].includes(e.action)){
    const x=e.action==='cleave'?e.x+e.dir*(beast?118:72):e.action==='fire'?e.x+e.dir*130:player.x;
    zones.push({owner:e.id,x,y:e.action==='cleave'?e.y:player.y,r:e.action==='slam'?(beast?135:112):e.action==='fire'?95:beast?98:75,t:e.timer,total:e.timer,friendly:false,damage:e.phase===2?32:beast?30:24,air:e.action!=='acid',style:e.action});
  }
  toast={flood:'CHANGE LANES · SPILLWAY SURGE',charge:'SIDESTEP THE CHARGE',leap:'MOVE AWAY FROM THE LANDING',slam:beast?'JUMP THE STOMP':'JUMP THE SHOCKWAVE',cleave:beast?'BACK AWAY FROM THE JAWS':'BACK AWAY FROM THE CLEAVE',acid:'LEAVE THE MARKED AREA',spines:'CHANGE LANES',volley:'CHANGE LANES',fire:'JUMP OR STEP ASIDE',pulse:'JUMP THE PULSE',summon:'REINFORCEMENTS INCOMING',jab:'DODGE THE COMBO',bombard:'KEEP MOVING'}[e.action];toastTime=1.3;
}

function executeBoss(e) {
  e.strikeFlash=.23;
  if(e.action==='volley'||e.action==='spines')for(let j=-1;j<=1;j++){shoot(e.x+e.dir*35,e.y+j*32,e.dir,false,20,330,e.id);}
  if(e.action==='charge'){e.state='charge';e.timer=.65;e.vx=e.dir*(e.type==='truck'?420:e.type==='fessenden'?520:450);e.hitList=[];return;}
  if(e.action==='leap'){e.state='leap';e.timer=.85;e.startX=e.x;e.startY=e.y;return;}
  if(e.action==='jab')for(const v of fighters())if(Math.abs(v.x-e.x)<115&&Math.abs(v.y-e.y)<39)strike(v,24,e.x);
  // Reinforcements walk in from both edges; in the final chapter they are copies of the heroes.
  if(e.action==='summon'&&enemies.filter(v=>!v.dead&&!v.boss).length<2){const types=levelIndex===5?['mirror','mirror']:['knifer','gunner'];arrive(types[0],'R',0);arrive(types[1],'L',1);}
  e.state='recover';e.timer=e.type==='sable'&&e.phase===2?.7:e.type==='fessenden'?.95:1.1;
}
const ENEMY_SPEED={brute:60,raptor:138,mutant:102,knifer:115,regent:110,slicer:96,biker:150};
function enemySpeed(e){return (e.boss?e.phase===2?105:e.phase===3?118:80:e.type==='mirror'?HEROES[e.hero].speed*(e.elite?.72:.58):ENEMY_SPEED[e.type]||94)*rules().enemySpeed*(e.rage>0&&!(e.rageWarning>0)?CFG.fx.rage.speed:1);}
function meleeDamage(e){return ['brute','mutant','regent'].includes(e.type)?24:e.type==='slicer'?22:e.type==='mirror'?e.elite?18:14:14;}
// Enemies go for whoever is closest: the player or a freed clone.
function hostileTarget(e){let best=player,bd=Math.hypot(player.x-e.x,(player.y-e.y)*1.4)*.85;for(const a of allies){if(a.hp<=0||a.state==='down'||a.state==='retreat')continue;const d=Math.hypot(a.x-e.x,(a.y-e.y)*1.4);if(d<bd){bd=d;best=a;}}return best;}
function markStage(e){if(!e.onstage&&(!lock||(e.x>lock.left+18&&e.x<lock.right-18)))e.onstage=true;}

function updateEnemy(e,dt) {
  if(e.waiting){if(enemies.filter(v=>v!==e&&!v.dead&&!v.dying&&!v.waiting&&v.state!=='flee').length>=rules().crowdLimit)return;e.waiting=false;}
  e.rageCooldown=Math.max(0,(e.rageCooldown||0)-dt);e.rage=Math.max(0,(e.rage||0)-dt);e.rageWarning=Math.max(0,(e.rageWarning||0)-dt);e.rammed=Math.max(0,(e.rammed||0)-dt);
  if(rules().dinosaurRage&&e.type==='raptor'&&e.onstage&&!e.dead&&!e.dying&&e.hp<e.maxhp*CFG.fx.rage.threshold&&e.state==='walk'&&!e.rageCooldown){e.rage=CFG.fx.rage.duration+CFG.fx.rage.warning;e.rageWarning=CFG.fx.rage.warning;e.rageCooldown=CFG.fx.rage.cooldown;toast='DINOSAUR RAGE · KEEP YOUR DISTANCE';toastTime=1.6;}
  if(e.rageWarning>0)return;
  if(e.freeze>0){e.freeze-=dt;e.inv=Math.max(0,e.inv-dt);e.hurt=Math.max(e.hurt,.02);return;}
  e.anim+=dt;e.strikeFlash=Math.max(0,(e.strikeFlash||0)-dt);e.moving=false;e.hurt=Math.max(0,e.hurt-dt);e.inv=Math.max(0,e.inv-dt);e.hitTimer=Math.max(0,e.hitTimer-dt);
  if(e.delay>0){e.delay-=dt;return;}
  const tempo=e.state==='walk'?(e.boss?rules().bossTempo:rules().aggression):['recover','down','hurt'].includes(e.state)?(e.boss?rules().bossTempo:1/rules().recovery):1;
  e.timer-=dt*tempo;
  if(e.dead){e.dead-=dt;if(e.dissolve&&Math.random()<dt*16)particles.push({x:e.x+rand(-16,16),y:e.y-rand(8,70),vx:rand(-12,12),vy:rand(-80,-35),life:rand(.4,.8),size:rand(2,4),color:'#8ff0b8',float:true});if(e.dead<=0)e.remove=true;return;}
  if(e.state==='flee'){e.x+=290*dt;e.dir=1;e.moving=true;if(e.timer<=0)e.remove=true;return;}
  if(e.state==='enter'){e.dir=Math.sign(e.enterX-e.x)||e.dir;e.x=approach(e.x,e.enterX,enemySpeed(e)*1.3*dt);e.moving=true;markStage(e);if(Math.abs(e.x-e.enterX)<1){e.state='walk';e.timer=rand(.35,.8);e.onstage=true;}return;}
  if(e.state==='held')return;
  if(e.state==='fly'){
    e.x+=e.vx*dt;e.vz-=1150*dt;e.z+=e.vz*dt;e.spin=(e.spin||0)+dt;if(lock)e.x=clamp(e.x,lock.left+12,lock.right-24);
    // A thrown body bowls over anyone standing in its path.
    if(e.thrown&&e.z<95)for(const o of enemies)if(o!==e&&!o.dead&&!o.dying&&!o.boss&&!['fly','held','down'].includes(o.state)&&o.inv<=0&&Math.abs(o.x-e.x)<34&&Math.abs(o.y-e.y)<22)damageEnemy(o,HEROES[selected].power*1.3,Math.sign(e.vx)*30,true,false,{heavy:true});
    if(e.z<=0){e.z=0;
      if(e.bounces++<1){e.vz=Math.abs(e.vz)*.2+40;e.vx*=.3;sfx('slam');shake=Math.max(shake,e.thrown?8:4);burst(e.x,e.y-4,'#b9b28f',9);}
      else{e.vx=0;e.thrown=false;if(e.dying){e.dead=1;e.state='dead';}else{e.state='down';e.timer=e.elite?.55:.8;e.inv=Math.max(e.inv,.6);}}}
    return;
  }
  if(e.state==='drop'){e.vz-=900*dt;e.z=Math.max(0,e.z+e.vz*dt);if(e.z<=0){e.state='rise';e.timer=.28;burst(e.x,e.y,'#8b9470',6);shake=Math.max(shake,2);}return;}
  if(e.state==='intro'){if(e.enterX!==undefined){e.x=approach(e.x,e.enterX,(e.type==='truck'?260:150)*dt);e.moving=Math.abs(e.x-e.enterX)>1;}if(e.timer<=0){e.state='walk';e.timer=e.boss?.45:.65;e.onstage=true;}return;}
  markStage(e);
  if(e.state==='down'){if(e.timer<=0){e.state='rise';e.timer=.32;e.inv=Math.max(e.inv,.32);}return;}
  if(['transform','rise','recover'].includes(e.state)){if(e.timer<=0){e.state='walk';e.timer=e.boss?.45:.65;}return;}
  if(e.hurt>0)return;
  if(e.state==='hurt'){if(e.timer<=0){e.state='walk';e.timer=.55;}return;}
  if(e.state==='windup'){
    if(e.timer<=0){if(e.boss)executeBoss(e);else{
      const v=e.target&&(e.target===player||allies.includes(e.target))?e.target:player;
      if(e.action==='rush'){e.state='charge';e.timer=.55;e.vx=e.dir*(e.type==='mirror'?380:e.type==='biker'?340:300);e.hitList=[];return;}
      if(['gunner','biker'].includes(e.type)){const reach=e.type==='gunner'?66:30;shoot(e.x+e.dir*reach,e.y,e.dir,false,14,340,e.id);if(e.type==='gunner'&&!driving)effects.push({type:'muzzle',x:e.x+e.dir*reach,y:e.y-62,dir:e.dir,age:0,life:.07});sfx('enemygun');}
      else if(e.action==='knife'){bullets.push({x:e.x+e.dir*30,y:e.y,z:48,vx:e.dir*330,vy:0,friendly:false,damage:17,owner:e.id,life:1.5,kind:'thrown',weapon:'knife',age:0});}
      else if(e.action==='leap'){e.state='leap';e.timer=.85;e.startX=e.x;e.startY=e.y;e.targetX=clamp(v.x,(lock?.left??camera)+40,(lock?.right??camera+W)-40);e.targetY=v.y;return;}
      else{e.strikeFlash=.2;if(Math.abs(e.x-v.x)<(e.elite?95:85)&&Math.abs(e.y-v.y)<35)strike(v,meleeDamage(e)*(e.rage>0?CFG.fx.rage.damage:1),e.x);}
      e.state='recover';e.timer=e.type==='brute'?.8:e.elite?.45:.5;
    }}return;
  }
  if(e.state==='leap'){
    const p=clamp(1-e.timer/.85,0,1);e.x=e.startX+(e.targetX-e.startX)*p;e.y=e.startY+(e.targetY-e.startY)*p;e.z=Math.sin(p*Math.PI)*(e.boss?120:80);
    if(e.timer<=0){e.z=0;zones.push({owner:e.id,x:e.x,y:e.y,r:e.boss?90:62,t:.12,total:.12,friendly:false,damage:e.boss?28:20,air:true});e.state='recover';e.timer=e.boss?1.3:.8;}return;
  }
  if(e.state==='charge'){
    e.x+=e.vx*dt;
    for(const v of fighters()){if(e.hitList?.includes(v))continue;if(Math.abs(e.x-v.x)<(e.type==='truck'?110:75)&&Math.abs(e.y-v.y)<37){strike(v,(e.boss?28:e.type==='mirror'?20:24)*(e.rage>0?CFG.fx.rage.damage:1),e.x-e.dir*60);(e.hitList||(e.hitList=[])).push(v);}}
    if(lock)e.x=clamp(e.x,lock.left+30,lock.right-42);
    if(e.timer<=0){e.state='recover';e.timer=e.boss?1.35:.9;}return;
  }
  // Anyone still outside the locked screen (for example knocked back while entering) walks straight back in.
  if(!e.onstage&&lock){const inside=e.x>lock.right?lock.right-70:lock.left+70;e.dir=Math.sign(inside-e.x)||e.dir;e.x=approach(e.x,inside,enemySpeed(e)*1.2*dt);e.moving=true;markStage(e);return;}
  const t=e.boss?player:hostileTarget(e);
  e.dir=Math.sign(t.x-e.x)||e.dir;const distance=Math.abs(t.x-e.x),dy=Math.abs(t.y-e.y);
  // Riders pull up alongside the Cadillac's bumper, then alternate between shooting and swerving into it.
  const speed=enemySpeed(e),range=e.type==='gunner'?235:e.type==='biker'?178:e.boss?(e.type==='fessenden'?150:120):53*Math.min(1.3,e.scale||1);
  const flank=!e.boss&&e.id<rules().flankChance&&enemies.some(o=>o!==e&&!o.dead&&!o.waiting&&Math.abs(o.x-t.x)<rules().flankDistance&&Math.abs(o.y-t.y)<24);
  const canAttack=e.boss||enemies.filter(o=>o!==e&&!o.dead&&['windup','charge','leap'].includes(o.state)).length<rules().attackSlots;
  e.flankCooldown=Math.max(0,(e.flankCooldown||0)-dt);
  if(rules().flankRear&&flank&&!e.flankRoute&&!e.flankCooldown&&distance<160){e.flankRoute={side:Math.sign(e.x-t.x)||1,ttl:1.4};e.flankCooldown=3.5;}
  if(e.flankRoute){
    const route=e.flankRoute,tx=clamp(t.x-route.side*72,(lock?.left??camera)+32,(lock?.right??camera+W)-42),ty=clamp(t.y+(e.id>.5?44:-44),288,390);
    route.ttl-=dt;e.x=approach(e.x,tx,speed*1.18*dt);e.y=approach(e.y,ty,speed*.8*dt);e.moving=true;
    if(Math.abs(e.x-tx)<8||route.ttl<=0){e.flankRoute=null;e.timer=Math.min(e.timer,.12);}return;
  }
  const targetY=flank&&!e.flankCooldown?clamp(t.y+(e.id>.5?38:-38),288,390):t.y;
  e.moving=distance>range-8||Math.abs(e.y-targetY)>2;
  if(distance>range-8)e.x+=e.dir*speed*dt;
  e.y=approach(e.y,targetY,speed*.6*dt);
  if(e.type==='gunner'&&distance<145){e.x-=e.dir*speed*.7*dt;e.moving=true;}
  if(canAttack&&e.onstage&&!e.boss&&e.timer<=0&&dy<32){
    const lunge=(e.type==='brute'&&distance>95&&distance<250)||(e.type==='slicer'&&distance>100&&distance<240)||(e.type==='mirror'&&e.elite&&distance>110&&distance<270);
    const leap=(e.type==='regent'&&distance>90&&distance<210)||(e.type==='mirror'&&e.elite&&distance>140&&distance<300&&e.attackNo%3===2);
    if(e.type==='knifer'&&distance>115&&distance<280){e.action='knife';e.state='windup';e.timer=.6;e.target=t;return;}
    if(e.type==='biker'&&e.attackNo%2===1&&distance<320){e.action='rush';e.state='windup';e.timer=.45;e.target=t;e.attackNo++;return;}
    if(leap){e.action='leap';e.state='windup';e.timer=.6;e.target=t;e.attackNo++;return;}
    if(lunge){e.action='rush';e.state='windup';e.timer=e.type==='brute'?.75:.55;e.target=t;e.attackNo++;return;}
  }
  if(canAttack&&e.onstage&&e.timer<=0&&distance<range+25&&dy<(e.boss?130:32)){e.target=t;if(e.boss)bossMove(e);else{e.action='melee';e.state='windup';e.timer=e.type==='brute'?.62:e.elite?.3:.38;e.attackNo++;}}
  if(lock&&e.onstage)e.x=clamp(e.x,lock.left+28,lock.right-42);e.y=clamp(e.y,284,393);
}

function gamepad(){const pads=navigator.getGamepads?.()||[];const p=Array.from(pads).find(Boolean);if(!p){padKeys.clear();return;}const map=['KeyK','KeyE','KeyJ','KeyL'];for(let i=0;i<4;i++){if(p.buttons[i]?.pressed){if(!padKeys.has(map[i]))pressed.add(map[i]);padKeys.add(map[i]);}else padKeys.delete(map[i]);}for(const [key,on] of [['ArrowLeft',p.axes[0]<-.3||p.buttons[14]?.pressed],['ArrowRight',p.axes[0]>.3||p.buttons[15]?.pressed],['ArrowUp',p.axes[1]<-.3||p.buttons[12]?.pressed],['ArrowDown',p.axes[1]>.3||p.buttons[13]?.pressed]]){if(on)padKeys.add(key);else padKeys.delete(key);}if(p.buttons[9]?.pressed&&!gamepad.pauseHeld)pause();gamepad.pauseHeld=p.buttons[9]?.pressed;}
const down=(...ks)=>ks.some(k=>keys.has(k)||padKeys.has(k)),tap=(...ks)=>ks.some(k=>pressed.has(k));
function update(dt) {
  time+=dt;music(dt);if(state==='continue'){updateContinue(dt);return;}if(state!=='play'){pressed.clear();return;}gamepad();if(state!=='play')return;
  stageTimer+=dt;runTime+=dt;const h=HEROES[selected];player.anim+=dt;bossIntro=Math.max(0,bossIntro-dt);if(!down(dashKey))dashTime=0;
  const frozen=player.freeze>0;
  for(const k of ['inv','hurt','attack','special','specialCd','boost','boostCd','land','freeze','comboWin','grabCd'])if(!(frozen&&k==='attack'))player[k]=Math.max(0,player[k]-dt);
  player.recoil=approach(player.recoil||0,0,30*dt);if(player.hurt<=0)player.knocked=false;
  updatePickup(dt);
  let dx=(down('ArrowRight','KeyD')?1:0)-(down('ArrowLeft','KeyA')?1:0),dy=(down('ArrowDown','KeyS')?1:0)-(down('ArrowUp','KeyW')?1:0);
  // Running is a horizontal sprint; lane changes while running are slower so the stride stays readable.
  player.run=!driving&&!!dx&&player.pickup<=0&&(down('ShiftLeft','ShiftRight','TouchRun')||(dashTime>0&&down(dashKey)));player.move=!!(dx||dy);
  if(dx&&player.attack<=0&&player.pickup<=0&&!player.grab)player.dir=dx;
  const px=player.x,py=player.y,camBefore=camera;
  if(driving)updateCar(dt,dx,dy,bossIntro<=0&&!frozen);
  else if(player.hurt<=0&&player.special<=0&&bossIntro<=0&&player.pickup<=0&&!frozen&&!player.grab){
    const speed=h.speed*(player.run?FIREARMS.has(player.weapon)?1.5:1.68:1),lane=h.speed*.64*(player.run?.5:1);
    const drag=player.attack>0&&player.z<=0?0:1;
    player.x+=dx*speed*drag*dt;player.y+=dy*lane*drag*dt;
    if(dx&&dy&&!player.run){player.x-=dx*speed*drag*dt*.22;player.y-=dy*lane*drag*dt*.22;}
    if(player.attack>0&&player.attackKind==='dash'){player.x+=(player.dashVelocity||0)*dt;player.dashVelocity=approach(player.dashVelocity,0,600*dt);}
  }
  // The whole car stays on screen: its tail and nose reach about 160 px either side of the driver.
  const edge=driving?165:30,cx=clamp(player.x,lock?lock.left+edge:camera+(driving?165:25),lock?lock.right-edge:level.length+130);
  if(driving&&cx!==player.x)player.vx*=.2;player.x=cx;player.y=clamp(player.y,284,393);if(driving&&(player.y===284||player.y===393))player.vy=0;
  const moved=Math.hypot(player.x-px,player.y-py);player.roll+=player.x-px;
  if(player.run&&player.z===0){const before=player.runDist;player.runDist+=moved;if(Math.floor(player.runDist/68)>Math.floor(before/68))particles.push({x:player.x-player.dir*14,y:player.y-3,vx:-player.dir*rand(20,50),vy:-rand(15,35),life:.35,size:rand(3,5),color:'#b9b28f',float:true});}
  else if(player.move)player.walkDist+=moved;
  if(player.z>0&&!frozen){player.vz-=850*dt;player.z+=player.vz*dt;if(player.z<=0){player.z=0;player.vz=0;player.land=.1;if(player.attackKind==='air'){player.attack=0;player.pendingStrike=null;}burst(player.x,player.y,'#8b9470',4);}}
  if(player.weapon)player.pendingStrike=null;
  updateGrab(dt,dx);updateMove(dt);
  if(player.pendingStrike&&!frozen){const hit=player.pendingStrike;hit.t-=dt;if(hit.t<=0){meleeStrike(hit.range,hit.power,hit.down,hit.struck,{melee:true,heavy:true});hit.active-=dt;if(hit.active<=0)player.pendingStrike=null;}}
  if(tap('KeyJ','KeyZ','Space')&&tap('KeyK','KeyX'))special();
  else{if(down('KeyJ','KeyZ','Space'))attack();if(tap('KeyK','KeyX'))jump();}
  if(tap('KeyL','KeyC'))special();if(tap('KeyE','KeyV'))pickup();if(tap('Enter','NumpadEnter'))insertCoin();
  updateBurst(dt);updateEmptyGun();updateMission(dt);
  for(const d of [...drops]){d.life-=dt;
    // On the highway, dropped food slides back with the road; the Cadillac scoops it up by driving over it.
    if(driving){d.x-=CAR.road*dt;if(d.x<camera-90){drops.splice(drops.indexOf(d),1);continue;}}
    const reach=driving?Math.abs(d.x-player.x)<110&&Math.abs(d.y-player.y)<32:Math.hypot(d.x-player.x,d.y-player.y)<27;
    if(PICKUPS.has(d.type)&&!d.claimed&&reach){consumeItem(d);}else if(d.life<=0&&!d.claimed)drops.splice(drops.indexOf(d),1);}
  for(const e of enemies)updateEnemy(e,dt);enemies=enemies.filter(e=>!e.remove);
  for(const a of allies)updateAlly(a,dt);allies=allies.filter(a=>!a.remove);
  if(driving)ramEnemies();
  updateProjectiles(dt);
  for(const z of zones){if(z.cancelled)continue;z.t-=dt;if(z.t<=0){burst(z.x,z.y-20,z.friendly?'#efb36d':'#c7ea91',24);effects.push({x:z.x,y:z.y,age:0,life:.55,type:'explosion'});shake=7;if(z.friendly){for(const e of enemies)if(Math.hypot((e.x-z.x)*.8,e.y-z.y)<z.r)damageEnemy(e,z.damage,Math.sign(e.x-z.x)*35,true);}else for(const v of fighters())if(Math.hypot((v.x-z.x)*.8,v.y-z.y)<z.r&&(!z.air||v.z<25))strike(v,z.damage,z.x,!z.air);}}
  zones=zones.filter(z=>!z.cancelled&&z.t>0);
  // Foundry vents and lab discharges announce their location before activating.
  if(!bossSpawned&&lock&&sectionIndex>=1&&(levelIndex===3||levelIndex===4)&&!(levelIndex===3&&!mission.active)&&Math.floor(stageTimer/9)>Math.floor((stageTimer-dt)/9))zones.push({x:player.x+90,y:levelIndex===3?370:300,r:58,t:1.25,total:1.25,friendly:false,damage:18,air:true,style:'vent'});
  updateParticles(dt);
  for(const f of floating){f.y-=30*dt;f.life-=dt;}floating=floating.filter(f=>f.life>0);
  if(comboTimer>0){comboTimer-=dt;if(comboTimer<=0)combo=0;}toastTime=Math.max(0,toastTime-dt);shake=Math.max(0,shake-dt*22);flash=Math.max(0,flash-dt);
  if(encounter)encounter.timer+=dt;updateEncounter();
  if(lock&&encounterSpawned()&&enemies.length===0&&!mission.active){const boss=encounter.spec.boss;lock=null;encounter=null;if(boss){stageClear();return;}toast='GO →';toastTime=2.5;score+=500;}
  if(plan.sections[sectionIndex+1]&&player.x>=plan.sections[sectionIndex+1].x)enterSection(sectionIndex+1);
  if(!lock&&!encounter&&encIndex<plan.encounters.length&&player.x>=plan.encounters[encIndex].x)startEncounter(plan.encounters[encIndex++]);
  const target=lock?lock.left:clamp(player.x-255,0,level.length-W+180);camera=approach(camera,target,500*dt);
  // The highway always streams past at road speed: whatever the camera did not cover, the scenery scroll makes up.
  if(driving){const flow=Math.max(0,CAR.road*dt-(camera-camBefore));road+=flow;player.roll+=flow;roadDust(flow);}
  pressed.clear();
}
// The Cadillac carries momentum. Throttle (→) builds speed, brake (←) backs off, and releasing both coasts to a slow
// cruise between fights or to a standstill while the screen is locked, so the car never drifts into the edge by itself.
function updateCar(dt,dx,dy,control){
  const target=!control?0:dx>0?CAR.top:dx<0?CAR.reverse:lock?0:CAR.cruise;
  player.vx=approach(player.vx,target,(dx&&control?CAR.accel:CAR.drag)*dt);
  player.vy=approach(player.vy,control?dy*CAR.laneTop:0,CAR.laneAccel*dt);
  player.x+=(player.vx+(player.boost>0?CAR.boost:0))*dt;player.y+=player.vy*dt;
  player.bank=approach(player.bank,player.vy/CAR.laneTop,5*dt);player.bump=Math.max(0,player.bump-dt);
}
// Dust kicks up behind the rear wheel as the road passes; boosting adds exhaust flame at the tail.
function roadDust(flow){
  player.dust+=flow;if(player.dust<34)return;player.dust=0;const s=CAR_SCALE;
  particles.push({x:player.x-96*s,y:player.y-2+rand(-2,2),vx:-rand(60,120),vy:-rand(12,30),life:rand(.3,.5),size:rand(3,6),color:'#c9bb95',float:true});
  if(player.boost>0)for(let i=0;i<2;i++)particles.push({x:player.x-150*s,y:player.y-24*s+rand(-4,4),vx:-rand(180,300),vy:rand(-20,20),life:rand(.12,.22),size:rand(3,5),color:i?'#ffb33b':'#ff6a3b',float:true});
}
// Running into an enemy is one impact, not a stream of hits: the faster the car, the harder they are flung. A rider
// already swerving into the car gets to land the hit unless the Cadillac is boosting.
function ramEnemies(){
  for(const e of enemies){
    if(e.dead||e.dying||!e.onstage||e.delay>0||e.rammed>0||['intro','fly','down','rise','held'].includes(e.state))continue;
    if(e.state==='charge'&&player.boost<=0)continue;
    if(Math.abs(e.x-player.x)>=CAR_REACH||Math.abs(e.y-player.y)>=29)continue;
    const speed=Math.abs(player.vx)+(player.boost>0?CAR.boost:0),dir=Math.sign(e.x-player.x)||player.dir,heavy=speed>120;
    e.rammed=.5;
    // A full-speed ram takes most of a rider's health; a boosted one finishes him, as the arcade car does.
    if(!damageEnemy(e,heavy?60+speed*.2:12,dir*30,heavy,false,{heavy,fling:heavy?{vx:dir*(200+speed*.55),vz:260+speed*.35}:null}))continue;
    player.bump=.3;shake=Math.max(shake,heavy?7:3);if(heavy)sfx('slam');
  }
}

function rect(g,x,y,w,h,c){g.fillStyle=c;g.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
function poly(g,pts,c){g.fillStyle=c;g.beginPath();pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fill();}
function circle(g,x,y,r,c){g.fillStyle=c;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();}
function background(g,idx,cam,t){SEQUEL_RENDER.scene(g,idx,cam,t);}
function drawFrame(g,f,x,y,scale=1.35,dir=1,filter='none'){if(!f||!sheet.complete)return;g.save();g.imageSmoothingEnabled=false;g.translate(Math.round(x),Math.round(y));g.scale(-dir*scale,scale);g.filter=filter;g.drawImage(sheet,f.x,f.y,f.w,f.h,-f.anchor,-f.h,f.w,f.h);g.restore();}
// Draws any pose: built poses carry their own image; recovered atlas frames default to the hero sheet.
function drawPose(g,f,x,y,scale,dir,filter='none',img=f?.img||sheet){if(!f||!img.complete&&!(img instanceof HTMLCanvasElement))return;g.save();g.imageSmoothingEnabled=false;g.translate(Math.round(x),Math.round(y));g.scale(-dir*scale,scale);g.filter=filter;g.drawImage(img,f.x,f.y,f.w,f.h,-f.anchor,-f.h,f.w,f.h);g.restore();}
function shadow(g,x,y,w=25){g.fillStyle='#10271b66';g.beginPath();g.ellipse(x,y,w,6,0,0,Math.PI*2);g.fill();}
// New antagonist: a flood-control crawler, animated with pistons and treads.
function drawCrownEngine(g,e,x,y) {
  g.save();g.translate(Math.round(x),Math.round(y));g.scale(e.dir,1);
  const step=e.state==='charge'?Math.sin(e.anim*35)*3:Math.sin(e.anim*5);
  const warn=e.state==='windup',slamming=warn&&e.action==='slam';
  shadow(g,0,5,96);
  for(const side of [-1,1]){
    rect(g,side*48-40,-24,81,27,'#152322');
    rect(g,side*48-38,-24,77,5,'#54666a');
    for(let k=0;k<6;k++){rect(g,side*48-34+k*12+step,-16,8,15,'#727c70');rect(g,side*48-32+k*12+step,-14,3,7,'#b1b8a0');}
  }
  g.translate(0,step*.3);
  poly(g,[[-78,-31],[-61,-84],[-38,-104],[39,-104],[69,-79],[80,-31]],'#172d31');
  poly(g,[[-73,-33],[-57,-78],[-32,-97],[36,-97],[63,-75],[75,-33]],'#567075');
  poly(g,[[-67,-36],[-52,-74],[-29,-89],[33,-89],[58,-70],[66,-36]],'#87988a');
  rect(g,-29,-94,63,58,'#263c40');rect(g,-22,-86,49,41,'#15292f');
  rect(g,-18,-82,40,22,'#427779');rect(g,-16,-80,35,3,'#85c2b6');
  // Sable remains visible in the cockpit; the second phase is machinery, not a mutation.
  rect(g,-6,-77,14,15,'#c89c6b');rect(g,-8,-79,18,5,'#273331');
  rect(g,-6,-67,15,10,'#5c6559');rect(g,-13,-57,31,5,'#85928a');
  rect(g,-23,-53,48,9,warn?'#df8758':'#a9bd79');
  for(const sx of [-58,44]){rect(g,sx,-70,15,26,'#30484b');for(let k=0;k<4;k++)rect(g,sx+2,-68+k*6,11,2,'#122a2c');}
  for(let k=0;k<5;k++)poly(g,[[-54+k*22,-33],[-42+k*22,-33],[-47+k*22,-26],[-59+k*22,-26]],'#d8b761');
  const lift=slamming?18:0;
  poly(g,[[36,-76],[83,-102-lift],[94,-92-lift],[48,-57]],'#233d41');
  poly(g,[[44,-77],[83,-96-lift],[87,-91-lift],[48,-68]],'#b8c1ab');
  rect(g,77,-112-lift,28,22,'#597078');rect(g,81,-109-lift,26,10,'#d6b970');
  rect(g,88,-94-lift,12,49+lift,'#bcc5b2');rect(g,84,-94-lift,4,48+lift,'#627c7b');
  rect(g,73,-48,38,18,'#233b3e');rect(g,76,-48,35,5,'#dfba67');
  rect(g,-67,-89,25,8,'#647e7e');rect(g,-93,-86,31,7,'#c0c7ad');
  if(warn){rect(g,1,-113,7,9,'#f09e66');rect(g,-7,-108,23,2,'#f5d392');}
  if(e.hp<e.maxhp*.5){for(let i=0;i<3;i++)rect(g,-47+i*11,-100-((e.anim*25+i*17)%42),12,7,'#a8b7a566');}
  g.restore();
}
function wheel(g,x,y,roll){
  circle(g,x,y,18,'#121419');circle(g,x,y,14,'#e3e7ea');circle(g,x,y,11,'#1a1d22');circle(g,x,y,9,'#c6d2dd');circle(g,x,y,3,'#6d7e90');
  for(let k=0;k<5;k++){const a=roll/18+k*Math.PI*2/5;rect(g,x+Math.cos(a)*6-1,y+Math.sin(a)*6-1,2,2,'#5d6e80');}
}
// Jack's Cadillac, as in the original arcade driving stage: a long steel-blue convertible with tailfins,
// a rolled cream top, a skirted rear wheel and the driver visible behind the wraparound windscreen.
function car(g,x,y,scale=1,boost=false,t=0,hero=-1,roll=0,bank=0,bump=0){
  g.save();g.translate(Math.round(x),Math.round(y));g.scale(scale,scale);
  shadow(g,0,1,142);
  // A driven car leans into lane changes, lifts its nose under boost, rumbles on the road and bounces on impacts.
  const moving=hero>=0;if(moving){g.rotate(bank*.05+(boost?-.02:0));g.translate(0,-Math.sin(Math.min(1,bump/.3)*Math.PI)*7);}
  wheel(g,-80,-18,roll);
  g.translate(0,Math.round(boost?Math.sin(t*34)*1.4:moving?Math.sin(t*23)*.8:0));
  // Cockpit: seats, the driver, then the door line over the lap.
  poly(g,[[-66,-39],[-62,-49],[-16,-50],[6,-44],[6,-38],[-66,-38]],'#2a2321');
  rect(g,-62,-55,11,17,'#c9ad74');rect(g,-60,-53,7,13,'#e2c992');rect(g,-24,-57,10,19,'#c9ad74');rect(g,-22,-55,6,15,'#e2c992');
  if(hero>=0){const d=A[HEROES[hero].id],f=d.frames[d.idle[0]];g.save();g.beginPath();g.rect(-52,-120,60,81);g.clip();drawFrame(g,f,-12,58-f.h*.5,1.08,1);g.restore();}
  // Body silhouette with outline.
  const body=[[-138,-12],[-140,-25],[-131,-31],[-129,-53],[-118,-51],[-98,-45],[-72,-41],[6,-41],[16,-41],[62,-40],[102,-38],[120,-34],[130,-28],[136,-22],[136,-13],[126,-9],[95,-8],[-50,-8],[-58,-17],[-104,-17],[-112,-9],[-132,-10]];
  poly(g,body.map(([px,py])=>[px+(px>0?1.5:-1.5),py+(py<-20?-1.5:1.5)]),'#13203a');
  poly(g,body,'#5b8dc8');
  poly(g,[[-129,-50],[-118,-48],[-98,-42],[-72,-38],[102,-35],[120,-31],[129,-26],[-131,-28]],'#79a9dc');
  poly(g,[[-127,-50],[-118,-49],[-100,-44],[-74,-40.5],[100,-37.5],[118,-33.5],[118,-31.5],[-128,-46]],'#bde0fa');
  poly(g,[[-50,-8],[60,-8],[58,-14],[-48,-15]],'#121a2a');
  poly(g,[[-136,-14],[-58,-17],[-50,-8],[-132,-10]],'#355f96');
  // Front wheel arch and wheel.
  g.fillStyle='#0d1626';g.beginPath();g.arc(74,-13,23,Math.PI,0);g.lineTo(97,-8);g.lineTo(51,-8);g.fill();
  wheel(g,74,-18,roll);
  poly(g,[[-104,-17],[-58,-17],[-56,-19],[-106,-19]],'#e6f1fb');
  // Chrome side spear, door seam and handle.
  poly(g,[[-122,-30],[98,-28],[98,-26],[-60,-27],[-104,-21],[-108,-22],[-62,-29],[-122,-28]],'#eef6ff');
  rect(g,-60,-27,150,1,'#7d93aa');rect(g,-9,-38,1,22,'#2b4a74');rect(g,-22,-34,7,2,'#eef6ff');
  // Rolled convertible top behind the rear seat.
  g.fillStyle='#e8d8a8';g.beginPath();g.ellipse(-82,-45,17,6,-.05,0,Math.PI*2);g.fill();rect(g,-96,-46,28,2,'#b49c66');rect(g,-90,-42,18,1,'#b49c66');
  // Wraparound windscreen.
  poly(g,[[4,-41],[10,-62],[27,-59],[24,-41]],'#cbeeff55');g.strokeStyle='#eef6ff';g.lineWidth=2;g.beginPath();g.moveTo(4,-41);g.lineTo(10,-62);g.lineTo(27,-59);g.lineTo(24,-41);g.stroke();
  // Nose: headlight, grille, bumper bullets and hood ornament.
  circle(g,121,-31,6,'#eef6ff');circle(g,121,-31,4,'#fff6c8');rect(g,127,-24,8,9,'#1a2333');for(let k=0;k<3;k++)rect(g,127,-23+k*3,8,1,'#d9e6f1');
  poly(g,[[118,-15],[137,-17],[139,-11],[120,-9]],'#e3edf6');circle(g,135,-20,4,'#f4f9ff');poly(g,[[98,-38],[108,-43],[111,-38]],'#eef6ff');
  // Tail: fin light and rear bumper.
  rect(g,-131,-52,4,8,'#ff4d3d');rect(g,-130,-51,2,3,'#ffc0b0');poly(g,[[-141,-24],[-130,-25],[-128,-11],[-140,-11]],'#e3edf6');
  if(boost){poly(g,[[-140,-15],[-178-Math.sin(t*20)*16,-9],[-160,-18],[-186,-24],[-140,-21]],'#eaaa56');poly(g,[[-140,-16],[-166,-13],[-156,-20],[-140,-19]],'#e9df91');}
  g.restore();
}
function truck(g,e,x,y){g.save();g.translate(x,y);shadow(g,0,5,110);rect(g,-92,-96,123,79,'#46564b');rect(g,-89,-91,118,11,'#728069');rect(g,-84,-74,105,47,'#2c4037');for(let j=0;j<5;j++)rect(g,-80+j*21,-69,3,40,'#687958');poly(g,[[25,-68],[66,-68],[94,-47],[106,-25],[100,-8],[23,-8]],'#7d8662');rect(g,34,-62,31,23,'#263e38');rect(g,73,-40,23,11,'#c6c59a');rect(g,26,-25,73,8,'#425b44');rect(g,-97,-13,202,7,'#bbc29c');for(const xx of [-62,64]){g.fillStyle='#192f25';g.beginPath();g.arc(xx,-7,22,0,Math.PI*2);g.fill();g.fillStyle='#91a27b';g.beginPath();g.arc(xx,-7,11,0,Math.PI*2);g.fill();}rect(g,-25,-113,43,13,'#596c54');rect(g,-57,-109,36,7,'#a8b28a');g.restore();}
// Copies of the heroes reuse the recovered hero animation: walk, combo, run strike, jump kick and hurt poses.
function drawHeroClone(e,filter){
  const id=HEROES[e.hero].id,x=e.x-camera+(e.freeze>0?(Math.floor(time*50)%2?2:-2):0),y=e.y-e.z,s=1.35*(e.scale||1),F=(n,i=0)=>ahFrame(id,n,i);
  let f;
  if(e.dead||e.state==='down'||(e.ally&&e.state==='retreat'&&e.hp<=0))f=F('lying');
  else if(e.state==='fly')f=F('fly');
  else if(e.hurt>0||e.state==='hurt'||e.state==='held')f=F('hurt');
  else if(e.state==='charge'){f=HERO_ART.frames[HERO_ART[id].dash[0]];drawPose(ctx,f,x,y,s,e.dir,filter,heroSheet);return;}
  else if(e.state==='leap'||e.z>4)f=F('air');
  else if(e.strikeFlash>0)f=F(['p1','kick','fin'][(e.attackNo||0)%3],1);
  else if(e.state==='windup')f=F('p1',0);
  else if(e.moving)f=F('walk',Math.floor(e.anim*12));
  else f=F('idle');
  drawAH(ctx,f,x,y,e.dir,filter,s);
}
function drawAlly(a){
  const x=a.x-camera;if(x<-150||x>W+150)return;ctx.save();shadow(ctx,x,a.y,25);if(a.inv>0&&Math.floor(time*16)%2===0)ctx.globalAlpha=.75;
  drawHeroClone(a,ALLY_FILTER+(a.hurt>0?' brightness(1.5)':''));
  if(a.state!=='retreat'){poly(ctx,[[x,a.y-a.z-118],[x+5,a.y-a.z-112],[x,a.y-a.z-106],[x-5,a.y-a.z-112]],'#ffe08a');rect(ctx,x-18,a.y-128,36,3,'#3a321a');rect(ctx,x-18,a.y-128,36*a.hp/a.maxhp,3,'#ffe08a');}
  ctx.restore();
}
// Bikers sit on the saddle: only the rider's upper body is drawn above the seat line.
function drawBiker(e,x,y,f,scale,filter){
  const s=scale/1.3,bike=COMBAT_ART.frames[305];
  // The recovered chopper faces the opposite way to every other sprite, so it is mirrored to match its rider.
  // A knocked-down rider is thrown clear while the bike skids over on its side.
  if(e.dead||e.state==='down'||e.state==='fly'){ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.rotate(e.dir*.55);drawCombat(ctx,bike,0,6,1.05*s,-e.dir,filter);ctx.restore();drawCombat(ctx,f,x+e.dir*70*s,y,1.2*s,e.dir,filter);return;}
  drawCombat(ctx,bike,x,y+4,1.05*s,-e.dir,filter);
  ctx.save();ctx.beginPath();ctx.rect(x-140,y-260,280,260-38*s);ctx.clip();
  drawCombat(ctx,f,x+e.dir*30*s,y+30*s,1.2*s,e.dir,filter);ctx.restore();
}
function drawFighter(e) {
  if(e.waiting||(e.delay>0&&!e.onstage&&e.state!=='drop'))return;
  const x=e.x-camera+(e.freeze>0?(Math.floor(time*50)%2?2:-2):0),y=e.y-e.z;if(x<-280||x>W+280)return;ctx.save();shadow(ctx,e.x-camera,e.y,e.boss?(e.type==='fessenden'?78:42):25*Math.min(1.5,e.scale||1));
  if(e.dead)ctx.globalAlpha=clamp(e.dead/.75,0,1);
  if(e.rage>0){rect(ctx,x-21,y-117,42,15,'#611f29');label(e.rageWarning>0?'! RAGE !':'RAGE',x,y-106,10,'#ffc16e','center');}
  const glow=e.clone&&!e.dead&&!e.boss?' drop-shadow(0 0 2px #7dffb0)':'',gel=' sepia(1) hue-rotate(70deg) saturate(3) brightness(1.2)';
  if(e.type==='mirror')drawHeroClone(e,(e.dissolve?CLONE_FILTER+gel:CLONE_FILTER)+(e.hurt>0?' brightness(1.6)':''));
  else if(e.type==='sable'&&e.phase===2)drawCrownEngine(ctx,e,x,y);
  else if(e.type==='truck')truck(ctx,e,x,y);
  else if(e.boss&&SEQUEL_RENDER.boss(ctx,e,x,y)){}
  else {
    const name=e.type==='warden'||e.type==='slicer'||e.type==='echo'?'echo':e.type==='cinder'?'brute':e.type==='raptor'&&e.boss?'raptor':e.type==='raptor'&&e.state==='flee'?'calmraptor':e.type==='sable'?'gunner':e.type==='biker'?'knifer':e.type==='fessenden'?'thornmaw':e.type;
    const data=COMBAT_ART.groups[name]||COMBAT_ART.groups.raider;
    const flying=e.state==='fly',action=e.dead||e.state==='down'||flying?'down':e.hurt>0||e.state==='held'?'hurt':['windup','charge','leap'].includes(e.state)||e.strikeFlash>0?'attack':e.state==='rise'?'rise':'walk';
    const seq=data[action]||data.walk;const n=seq[action==='rise'?Math.min(seq.length-1,Math.floor((.32-e.timer)/.32*seq.length)):action==='walk'&&!e.moving?0:Math.floor(e.anim*(action==='walk'?8:5))%seq.length];
    const f=COMBAT_ART.frames[n];const scale=e.boss?(e.type==='raptor'?1.85:e.type==='fessenden'?1.5:1.65):e.scale||(e.type==='raptor'?1.1:1.3);
    // The Regent uses the familiar dinosaur anatomy, with a new armor harness and control collar. Fessenden's copy is
    // the serum beast from the end of the first game, in its pink skin.
    let filter=e.type==='raptor'&&e.boss?'hue-rotate(18deg) saturate(.85)':e.type==='fessenden'?'hue-rotate(292deg) saturate(1.25) brightness(1.08)':e.type==='echo'?'hue-rotate(100deg)':e.type==='cinder'?'hue-rotate(325deg)':e.type==='warden'?'hue-rotate(335deg)':'none';
    filter=e.dissolve?gel:filter+glow;if(e.hurt>0)filter+=' brightness(1.6)';
    if(e.type==='biker')drawBiker(e,x,y,f,scale,filter);
    else if(flying){ctx.save();ctx.translate(Math.round(x),Math.round(y-8));ctx.rotate((e.thrown?e.spin*6:e.vz>0?-.16:.1)*e.dir);drawCombat(ctx,f,0,8,scale,e.dir,filter);ctx.restore();}
    else drawCombat(ctx,f,x,y,scale,e.dir,filter);
    if(e.type==='raptor'&&e.boss&&e.state!=='flee'){
      ctx.save();ctx.translate(Math.round(x),Math.round(y+(e.moving?Math.sin(e.anim*8)*2:0)));ctx.scale(e.dir,1);
      poly(ctx,[[-28,-75],[-20,-94],[11,-94],[28,-80],[18,-69]],'#233c43');poly(ctx,[[-24,-76],[-17,-89],[9,-89],[22,-79],[15,-74]],'#859a98');rect(ctx,-16,-87,24,3,'#ccd5bd');
      for(const bx of [-18,6]){rect(ctx,bx,-85,3,3,'#e6dcba');rect(ctx,bx,-78,3,3,'#273d45');}for(let v=0;v<3;v++)rect(ctx,-9+v*5,-84,3,9,'#3d565b');
      rect(ctx,18,-95,9,26,'#253d46');rect(ctx,21,-94,4,22,e.state==='windup'?'#ef8557':'#a7e4da');rect(ctx,-11,-101,6,12,'#475b60');rect(ctx,-10,-105,4,5,'#dca458');ctx.restore();
    }
    if(e.type==='knifer'&&e.state==='windup')weaponSprite(ctx,'knife',x+e.dir*32,y-45,1,e.dir);
  }
  if(e.state==='windup'){label('!',x,y-(e.boss?(e.type==='fessenden'?212:158):112*Math.min(1.4,e.scale||1)),24,'#ffbf71','center');}
  if(!e.boss&&!e.elite&&e.hp<e.maxhp&&!e.dead&&e.state!=='flee'){rect(ctx,x-23,e.y-112,46,4,'#172e24');rect(ctx,x-23,e.y-112,46*e.hp/e.maxhp,4,'#e7b16e');}
  if(e.state==='leap'){ctx.strokeStyle='#ffbf71';ctx.beginPath();ctx.ellipse(e.targetX-camera,e.targetY,e.boss?55:40,e.boss?20:15,0,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}

const heroSheet=new Image();heroSheet.src=HERO_ART.sheet;
const FIREARMS=new Set(['gun','uzi','shotgun','rifle','m16','bazooka']);
function heroActionFrame(action,index=0){const data=HERO_ART[HEROES[selected].id],seq=data[action];return HERO_ART.frames[seq[index%seq.length]];}
function drawHeroAction(g,f,x,y,scale,dir){if(!heroSheet.complete)return;g.save();g.translate(Math.round(x),Math.round(y));g.scale(-dir*scale,scale);g.drawImage(heroSheet,f.x,f.y,f.w,f.h,-f.anchor,-f.h,f.w,f.h);g.restore();}
const AH=window.ARCADE_HEROES,ahSheet=new Image();ahSheet.src=AH.sheet;
// A second sheet holds the armed stances decoded later (Jack's real gun torsos and every hero's shouldered bazooka).
const ahSheet2=new Image();if(AH.sheet2)ahSheet2.src=AH.sheet2;
const stanceKind=()=>player.weapon==='bazooka'?'launcher':LONG_GUNS.has(player.weapon)?'twoHanded':'handgun';
const ahFrame=(id,name,i=0)=>{const list=AH.heroes[id][name];return AH.frames[list[((i%list.length)+list.length)%list.length]];};
const myFrame=(name,i=0)=>ahFrame(HEROES[selected].id,name,i);
function drawAH(g,f,x,y,dir,filter='none',scale=1.35){const img=f?.s===2?ahSheet2:ahSheet;if(!f||!img.complete)return;g.save();g.imageSmoothingEnabled=false;g.translate(Math.round(x),Math.round(y));g.scale(-dir*scale,scale);g.filter=filter;g.drawImage(img,f.x,f.y,f.w,f.h,-f.anchor,-f.oy,f.w,f.h);g.restore();}
const LONG_GUNS=new Set(Object.values(CFG.weapons).filter(w=>w.twoHanded).flatMap(w=>w.types));
// Hand coordinates in original frame space; facing is applied only here.
function handPoint(f,dir,scale=CFG.sockets.scale,offset=[0,0]){const h=f?.hand||[-26,-60];return {x:(-h[0]+offset[0])*scale*dir,y:(h[1]+offset[1])*scale};}
function gunMount(){const spec=CFG.sockets.recoil,f=myFrame(spec[stanceKind()]),p=handPoint(f,1,CFG.sockets.scale,spec.offset);return {x:p.x,y:-p.y,gunDrawn:!!f?.gunDrawn};}
function drawArmedComposite(g,torso,legs,x,y,dir){
 // The arcade's own walking and running torsos are torso-only records whose bottom edge meets the top of the
 // separate leg records, so they are simply drawn one over the other. Only a full-body ready pose used as a torso
 // (the handgun stance over jumping legs) needs clipping, and then at the hip line of the full-body frames.
 if(torso.h<50){drawAH(g,legs,x,y,dir);drawAH(g,torso,x,y,dir);return;}
 const seam=legs.h<60?-legs.oy*CFG.sockets.scale:-40*CFG.sockets.scale;
 g.save();g.beginPath();g.rect(x-160,y+seam,320,200);g.clip();drawAH(g,legs,x,y,dir);g.restore();
 g.save();g.beginPath();g.rect(x-160,y-210,320,210+seam);g.clip();drawAH(g,torso,x,y,dir);g.restore();
}
// Screen offset of a pose's hand or grip point (pose coordinates measured from the top-left).
const posePoint=(f,p,s=1.35)=>({x:(f.anchor-p[0])*s,y:(f.h-p[1])*s});
function drawPlayer() {
  const x=player.x-camera,y=player.y-player.z;ctx.save();shadow(ctx,x,player.y,driving?96:27);
  if(player.inv>0&&Math.floor(time*16)%2===0)ctx.globalAlpha=.65;
  player.pose='idle';
  if(driving){player.pose='driving';car(ctx,x,y,CAR_SCALE,player.boost>0||player.special>0,time,selected,player.roll,player.bank,player.bump);}
  else {
    const data=A[HEROES[selected].id],armed=FIREARMS.has(player.weapon),long=LONG_GUNS.has(player.weapon),dir=player.dir;
    const walkI=Math.floor(player.walkDist/10),runI=Math.floor(player.runDist/22);
    const hold=(f,type,grip,angle=0,kick=0,offset=[0,0])=>{if(f?.gunDrawn)return;const p=handPoint(f,dir,CFG.sockets.scale,offset);weaponSprite(ctx,type,x+p.x-dir*kick,y+p.y,weaponScale(type),dir,angle,grip);};
    if(player.pickup>0){
      // Crouch to collect; the weapon is in hand once the crouch is half done.
      player.pose='pickup';const f=myFrame('crouch');drawAH(ctx,f,x,y,dir);
      if(player.weapon&&player.pickup<=.12)hold(f,player.weapon,LONG_GUNS.has(player.weapon)?.68:.35);
    }else if(player.grab){
      const m=player.moveState;player.pose=m?.name==='throw'?'throw':'grab';
      drawAH(ctx,m?myFrame(m.name,m.frames[Math.min(m.k,m.frames.length-1)].i):myFrame('grab'),x,y,dir);
    }else if(armed&&player.hurt<=0&&player.special<=0){
      const firing=player.attack>0&&player.attackKind==='fire',recoiling=firing&&player.recoil>1,air=player.z>0;
      const pose=firing?(recoiling?'recoil':'recovery'):air?'jump':player.move?(player.run?'run':'walk'):'idle';
      const spec=CFG.sockets[pose],f=myFrame(spec[stanceKind()]);
      player.pose=firing?'fire':air?'armed-jump':player.move?(player.run?'armed-run':'armed-walk'):'armed-ready';
      if(!long&&player.move&&!air&&!firing){
        // A handgun stays in the swinging hand on the ordinary walk and run, as in the arcade; it is only raised to fire.
        const wf=myFrame(player.run?'run':'walk',player.run?runI:walkI);drawAH(ctx,wf,x,y,dir);hold(wf,player.weapon,.35,.5*dir);
      }else{
        if(air||player.move){const legs=air?myFrame('jump',player.vz>0?1:2):myFrame(player.run?'legsRun':'legsWalk',player.run?runI:walkI);drawArmedComposite(ctx,f,legs,x,y,dir);}
        else if(f.h<50)drawArmedComposite(ctx,f,myFrame('legsStand'),x,y,dir); // arcade torso-only stances stand on the standing legs
        else drawAH(ctx,f,x,y,dir);
        hold(f,player.weapon,weaponClass(player.weapon).grip,0,0,spec.offset);
      }
    }else {
      const m=player.moveState;let f=null;
      if(player.special>0){player.pose='special';const list=data.special;drawFrame(ctx,data.frames[list[Math.floor((.65-player.special)*18)%list.length]],x,y,1.35,dir);}
      else if(player.down){player.pose='down';drawAH(ctx,myFrame('lying'),x,y,dir);}
      else if(player.hurt>0&&player.knocked){
        // Knocked flat: thrown back, lying, then climbing to the feet.
        player.pose='knocked';const t=.85-player.hurt;f=t<.28?myFrame('fly'):t<.6?myFrame('lying'):myFrame('getup',t<.72?0:1);
        drawAH(ctx,f,x,y-(t<.28?Math.sin(t/.28*Math.PI)*24:0),dir);f=null;
      }
      else if(player.hurt>0){player.pose='hurt';f=myFrame('hurt');drawAH(ctx,f,x,y,dir);}
      else if(player.attack>0&&['dash','air'].includes(player.attackKind)){player.pose=player.attackKind;drawHeroAction(ctx,heroActionFrame(player.attackKind),x,y,1.35,dir);}
      else if(m){player.pose='attack';f=myFrame(m.name,m.frames[Math.min(m.k,m.frames.length-1)].i);drawAH(ctx,f,x,y,dir);}
      else if(player.attack>0&&['weapon-melee','throw'].includes(player.attackKind)){player.pose='attack';f=myFrame('p1',player.attack/player.attackTotal>.55?0:1);drawAH(ctx,f,x,y,dir);}
      else if(player.z>0){player.pose='jump';f=myFrame('jump',player.vz>120?1:2);drawAH(ctx,f,x,y,dir);}
      else if(player.move&&player.run){player.pose='run';f=myFrame('run',runI);drawAH(ctx,f,x,y,dir);}
      else if(player.move){player.pose='walk';f=myFrame('walk',walkI);drawAH(ctx,f,x,y,dir);}
      else if(player.land>0){player.pose='land';f=myFrame('crouch');drawAH(ctx,f,x,y,dir);}
      else {player.pose='idle';f=myFrame('idle');drawAH(ctx,f,x,y,dir);}
      // Melee weapons sit in the hand of the current frame.
      if(player.weapon&&player.hurt<=0&&f&&!armed){const melee=WEAPONS[player.weapon]?.melee,swing=melee&&player.attack>0?Math.sin((1-player.attack/player.attackTotal)*Math.PI)*-1.7*dir:0;hold(f,player.weapon,.3,melee&&!swing?-.9*dir:player.weapon==='knife'?.15*dir:swing);}
    }
  }
  if(player.special>0){ctx.strokeStyle=HEROES[selected].color;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y-40,85*(1-player.special/.9),32,0,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}
function drawObject(o){if(o.hp<=0)return;const x=o.x-camera;if(x<-60||x>W+60)return;shadow(ctx,x,o.y,23);if(o.type==='barrel'){drawFrame(ctx,A.enemies['5'][0],x,o.y,1,1);}else{rect(ctx,x-23,o.y-46,46,46,'#3b4c33');rect(ctx,x-21,o.y-44,42,40,'#9b7b4c');for(let j=0;j<3;j++)rect(ctx,x-18+j*13,o.y-42,2,38,'#5e603e');rect(ctx,x-23,o.y-43,46,6,'#bf9959');rect(ctx,x-23,o.y-9,46,6,'#bf9959');}}
// Food, score items and ammunition are the arcade's own item sprites, set on the ground at their bottom centre.
const ITEMS=window.ARCADE_ITEMS||{frames:{}},itemSheet=new Image();if(ITEMS.sheet)itemSheet.src=ITEMS.sheet;
const PICKUPS=new Set(['food','bonus','ammo']);
const FOOD_WEIGHTS=[['hamburger',12],['hotdog',10],['pizza',10],['salad',8],['steak',6],['barbecue',4],['roast',4],['lobster',4],['sushi',3],['cake',5],['fries',6],['pudding',4],['parfait',4],['donut',8],['coffee',6],['croissant',6],['gum',5],['chocolate',5]];
const BONUS_WEIGHTS=[['sunglasses',10],['necklace',6],['ring',6],['pouch',5],['pearls',4],['ammonite',4],['skull',2],['goldbar',3],['diamond',2]];
function pickWeighted(list){let t=0;for(const [,w] of list)t+=w;let r=Math.random()*t;for(const [k,w] of list){r-=w;if(r<=0)return k;}return list[0][0];}
// Food never times out on the ground (as in the arcade); `rich` picks from the big meals for elite drops and section starts.
function foodDrop(x,y,life=999,rich=false){return {x,y,type:'food',food:pickWeighted(rich?FOOD_WEIGHTS.filter(f=>(ITEMS.frames[f[0]]?.heal||0)>=48):FOOD_WEIGHTS),life};}
function bonusDrop(x,y,life=999){return {x,y,type:'bonus',food:pickWeighted(BONUS_WEIGHTS),life};}
function consumeItem(d){
  const f=ITEMS.frames[d.food]||ITEMS.frames.hamburger||{heal:48,score:1000};const i=drops.indexOf(d);if(i>=0)drops.splice(i,1);d.claimed=true;sfx('pickup');
  if(d.type==='food'){const heal=Math.round(player.maxhp*(f.heal||48)/100);
    // Eaten at full health, a meal is worth its points instead, as on the cabinet.
    if(player.hp>=player.maxhp-.5){score+=f.score||1000;popup(player.x,player.y-96,'+'+(f.score||1000),'#ffe08a');}else{player.hp=Math.min(player.maxhp,player.hp+heal);popup(player.x,player.y-96,d.food.toUpperCase()+' +'+heal,'#d5ec69');}}
  else if(d.type==='bonus'){score+=f.score||1000;popup(player.x,player.y-96,'+'+(f.score||1000),'#ffe08a');}
  else if(d.type==='ammo'){const w=WEAPONS[player.weapon];if(w&&!w.melee&&!w.thrown){player.ammo=w.ammo;popup(player.x,player.y-96,'AMMO FULL','#9ad1ff');}else{score+=1000;popup(player.x,player.y-96,'+1000','#ffe08a');}}
}
function drawDrop(d) {
  if(d.claimed)return;const x=d.x-camera,y=d.y+Math.sin(time*4+d.x)*2;if(x<-60||x>W+60)return;shadow(ctx,x,d.y,16);
  if(PICKUPS.has(d.type)){const f=ITEMS.frames[d.food]||ITEMS.frames.hamburger;if(f&&itemSheet.complete){const S=1.35;ctx.imageSmoothingEnabled=false;ctx.drawImage(itemSheet,f.x,f.y,f.w,f.h,Math.round(x-f.w*S/2),Math.round(y-f.h*S),Math.round(f.w*S),Math.round(f.h*S));}}
  else weaponSprite(ctx,d.type==='grenade'?'grenade':d.type,x,y-12,.85*(WEAPONS[d.type]?.scale||1),1);
  if(Math.hypot(d.x-player.x,d.y-player.y)<65&&!PICKUPS.has(d.type))label((TOUCH?'HIT / PICK · ':'J / E · ')+(WEAPONS[d.type]?.name||d.type.toUpperCase()),x,y-35,10,'#f0e0a8','center');
}
// Story set dressing along the back of the floor: Fessenden's cold pods at the harbor, egg racks in the
// nursery, unfinished vats in the foundry and, in Echo's halls, tanks holding copies of the four heroes.
function drawProp(kind,x,k){
  const y=286;
  if(kind==='crates'){rect(ctx,x-46,y-44,92,44,'#3a3326');rect(ctx,x-43,y-41,40,38,'#7d6643');rect(ctx,x+3,y-41,40,38,'#6f5a3c');rect(ctx,x-30,y-76,60,32,'#2b3b3e');rect(ctx,x-27,y-73,54,26,'#8fd8c0aa');rect(ctx,x-25,y-71,8,22,'#ffffff33');label('F',x+18,y-54,10,'#d8fff0','center');rect(ctx,x-38,y-24,22,3,'#c9b27c');}
  else if(kind==='eggs'){rect(ctx,x-40,y-62,80,4,'#5c4128');rect(ctx,x-40,y-32,80,4,'#5c4128');rect(ctx,x-42,y-66,4,66,'#4a3320');rect(ctx,x+38,y-66,4,66,'#4a3320');for(let i=0;i<4;i++){ctx.fillStyle='#e9e0bf';ctx.beginPath();ctx.ellipse(x-27+i*18,y-71,6,8,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(x-27+i*18,y-41,6,8,0,0,Math.PI*2);ctx.fill();}}
  else if(kind==='vats'){rect(ctx,x-30,y-12,60,12,'#2d2a28');rect(ctx,x-24,y-92,48,80,'#1b2b2c');rect(ctx,x-21,y-89,42,74,'#9fd6d322');rect(ctx,x-19,y-87,6,68,'#ffffff22');rect(ctx,x-28,y-100,56,10,k%2?'#8a5b3b':'#4b4f52');label('UNFIT',x,y-50,8,'#e7b16e88','center');}
  else if(kind==='tanks'){
    rect(ctx,x-27,y-14,54,14,'#26343a');rect(ctx,x-23,y-110,46,98,'#0b2426');rect(ctx,x-21,y-106,42,92,'#3fbf8a55');
    const hero=HEROES[k%4],d=A[hero.id];ctx.save();ctx.beginPath();ctx.rect(x-21,y-106,42,92);ctx.clip();drawFrame(ctx,d.frames[d.idle[0]],x+2,y-12+Math.sin(time*1.6+k)*2,.95,k%2?-1:1,'brightness(.55) sepia(1) hue-rotate(95deg) saturate(2.4)');ctx.restore();
    for(let i=0;i<3;i++)rect(ctx,x-12+i*10,y-16-((time*24+i*23+k*7)%88),2,2,'#c8ffe0');rect(ctx,x-18,y-104,4,86,'#ffffff22');rect(ctx,x-29,y-120,58,12,'#3e4e55');rect(ctx,x-12,y-127,24,7,'#5b6c72');
    label(`${hero.name.split(' ')[0].slice(0,4)}-${String(k+1).padStart(2,'0')}`,x,y-3,8,'#c8ffe0','center');
  }
}
function drawProps(){
  const kind=[driving?null:'crates',null,'eggs','vats','tanks','tanks'][levelIndex];if(!kind||!plan)return;
  const gap=430,first=Math.floor((camera-80)/gap);
  for(let k=first;k<=first+3;k++){const wx=k*gap+150;if(wx<300||wx>level.length-500)continue;const x=wx-camera*1;if(x<-90||x>W+90)continue;if(levelIndex===2&&(sectionIndex<1||sectionIndex>3))continue;drawProp(kind,x,k);}
}

function label(text,x,y,size=12,color='#ecebcf',align='left'){ctx.font=`bold ${size}px Consolas, monospace`;ctx.textAlign=align;ctx.fillStyle='#12261e';ctx.fillText(text,x+1,y+1);ctx.fillStyle=color;ctx.fillText(text,x,y);}
// Cabinet-style text: yellow letters with a burnt-orange outline, as the arcade draws INSERT COIN and the continue screen.
function coinText(text,x,y,size=14){ctx.font=`bold ${size}px Consolas, monospace`;ctx.textAlign='center';ctx.lineJoin='round';ctx.lineWidth=Math.max(2.5,size/5);ctx.strokeStyle='#8a3608';ctx.strokeText(text,x,y);ctx.fillStyle='#ffd23c';ctx.fillText(text,x,y);}
const ENEMY_LABEL={raider:'POACHER',knifer:'KNIFER',gunner:'GUNNER',brute:'HEAVY',raptor:'RAPTOR',mutant:'MUTANT',biker:'RIDER',regent:'REGENT',slicer:'BRAWLER',mirror:'MIRROR CLONE'};
function enemyLabel(e){return e.elite?e.name:e.boss?(e.type==='sable'&&e.phase===2?'CROWN ENGINE':e.name||level.boss):ENEMY_LABEL[e.type]||e.type.toUpperCase();}
// The top band follows the arcade cabinet: the player's slot on the left (portrait, lives, score, name and rank, a yellow
// health bar, then the current enemy's name and bar), and the two empty player slots calling for coins.
function hud(){rect(ctx,0,0,W,68,'#0c1d19e6');rect(ctx,0,67,W,1,'#678258');const h=HEROES[selected];const fr=A[h.id].frames[0];
 rect(ctx,10,9,46,50,'#1a2e33');ctx.save();ctx.beginPath();ctx.rect(12,11,42,46);ctx.clip();drawFrame(ctx,fr,34,118,1.25,1);ctx.restore();rect(ctx,12,11,42,2,h.color);
 label('='+lives,62,21,11,'#dfe6ff');label(score.toString().padStart(6,'0'),250,21,13,'#9ad1ff','right');
 label(h.name,62,38,12,'#f6f2e2');label('1ST',250,38,11,'#f6f2e2','right');
 rect(ctx,62,43,189,10,'#2a2a24');rect(ctx,63,44,187*clamp(player.hp/player.maxhp,0,1),8,player.hp/player.maxhp>.3?'#f6d43a':'#ff6b4a');
 const foe=enemies.find(e=>e.boss&&!e.dead)||enemies.find(e=>e.elite&&!e.dead&&e.state!=='flee'&&e.onstage)||(lastHitEnemy&&lastHitEnemy.hp>0&&!lastHitEnemy.dead&&enemies.includes(lastHitEnemy)?lastHitEnemy:null);
 if(foe){const r=clamp(foe.hp/foe.maxhp,0,1);label(enemyLabel(foe),62,63,8,'#ffd8a8');rect(ctx,152,56,99,7,'#2a2a24');rect(ctx,153,57,97*r,5,foe.type==='fessenden'?'#ff8bd0':foe.boss?'#e9a56b':foe.elite?'#c99cff':'#5fdc5f');rect(ctx,153+97*r,57,97*(1-r),5,'#6a2a7a');}
 if(Math.floor(time*1.6)%3!==2){const call=coins>0?'JOIN-IN':'INSERT COIN';coinText(call,W/2,42);coinText(call,W/2+256,42);}
 if(player.weapon&&!driving){rect(ctx,15,H-72,160,33,'#071a20e8');rect(ctx,15,H-72,160,1,'#758f90');weaponSprite(ctx,player.weapon,43,H-56,.6,1);label(WEAPONS[player.weapon].name,79,H-59,8,'#f4dda0');label(String(player.ammo).padStart(2,'0')+(WEAPONS[player.weapon].melee?' HITS':' SHOTS'),79,H-46,11,player.ammo?'#f5f0d2':'#ff725e');}
 const b=enemies.find(e=>e.boss&&!e.dead)||enemies.find(e=>e.elite&&!e.dead&&e.state!=='flee'&&e.onstage);
 rect(ctx,18,H-19,130,3,'#2c4534');rect(ctx,18,H-19,130*clamp(player.x/level.length,0,1),3,'#9aad6b');label(`CH 0${levelIndex+1} · ${level.name} · ${sectionIndex+1}/${plan.sections.length} ${plan.sections[sectionIndex]?.name||''}`,18,H-25,9,'#b8c59d');
 label('CREDIT '+coins,W/2,H-8,10,'#e9e2c4','center');label(driving?'CADILLAC · RAM / BOOST':'',W-20,H-8,9,'#adc197','right');
 if(combo>=2){label(combo+' HIT',W-22,124,27,'#d5ec69','right');label('COMBO',W-25,138,10,'#b7c69c','right');}
 if(toastTime>0){rect(ctx,W/2-250,100,500,25,'#153023dc');label(toast,W/2,117,11,'#e0e8a8','center');}
 // Boss arrival card: the name hangs over the arena while the boss walks in.
 if(bossIntro>0&&b){const a=Math.min(1,bossIntro*2,(2.4-Math.min(2.4,bossIntro))*1.5);ctx.save();ctx.globalAlpha=Math.max(0,a);rect(ctx,0,196,W,58,'#07110dcc');rect(ctx,0,196,W,2,b.type==='fessenden'?'#ff8bd0':'#e9a56b');rect(ctx,0,252,W,2,b.type==='fessenden'?'#ff8bd0':'#e9a56b');label(b.name||level.boss,W/2,228,24,b.type==='fessenden'?'#ffc3e6':'#ffe2b0','center');label(b.type==='fessenden'?'THE LAST COPY FROM THE ARCHIVE':level.area.split('/')[1].trim(),W/2,245,9,'#c9d4b8','center');ctx.restore();}
 if(player.specialCd>0){label('SPECIAL '+Math.ceil(player.specialCd)+'s',18,134,10,'#a6b797');}else label(driving?'L · RAM READY':'L · '+h.special.toUpperCase(),18,134,9,'#d5ec69');}
function render(){ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,W,H);ctx.save();if(shake>0)ctx.translate(rand(-shake,shake),rand(-shake/2,shake/2));
 if(!started||['menu','select','chapters','credits'].includes(state)){background(ctx,0,time*9,time);rect(ctx,0,0,W,H,'#0a221ec0');car(ctx,180,410,.95,false,time,1,time*60);HEROES.forEach((h,i)=>{if(i!==1)drawFrame(ctx,A[h.id].frames[0],400+i*90,424,1.1,1);});rect(ctx,0,0,W,H,'#05131030');}
 else{background(ctx,levelIndex,camera+road,time);drawProps();for(const z of zones){const x=z.x-camera;ctx.fillStyle=z.style==='flood'?'#5bbfda55':z.friendly?'#efb36638':'#e77d5a30';ctx.beginPath();ctx.ellipse(x,z.y,z.r,z.r*.4,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=z.style==='flood'?'#8fe4ed':z.friendly?'#e8bd76':'#efa36b';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,z.y,z.r*(z.t/z.total),z.r*.4*(z.t/z.total),0,0,Math.PI*2);ctx.stroke();}
 const draws=[...objects.filter(o=>o.hp>0).map(o=>({y:o.y,fn:()=>drawObject(o)})),...drops.map(d=>({y:d.y,fn:()=>drawDrop(d)})),...enemies.map(e=>({y:e.y,fn:()=>drawFighter(e)})),...allies.map(a=>({y:a.y,fn:()=>drawAlly(a)})),{y:player.y,fn:drawPlayer}];
 if(parkedCar&&!driving)draws.push({y:parkedCar.y,fn:()=>car(ctx,parkedCar.x-camera,parkedCar.y,CAR_SCALE,false,0,-1,0)});
 for(const item of mission?.items||[])draws.push({y:item.y,fn:()=>drawMissionItem(item)});draws.sort((a,b)=>a.y-b.y);draws.forEach(d=>d.fn());drawEffects();drawParticles();for(const f of floating)label(f.text,f.x-camera,f.y,12,f.color,'center');hud();missionHud();
 if(lock&&!bossSpawned){label(enemies.length?'CLEAR THE AREA':'COMPLETE THE OBJECTIVE',W/2,145,9,'#d4cf9e','center');}else if(!bossSpawned&&!lock&&toastTime<=0){label('GO →',W-38,220,19,'#d5ec69','right');}if(state==='continue')drawContinue();else if(state!=='play')rect(ctx,0,0,W,H,'#0b1a1688');}
 if(flash>0)rect(ctx,0,0,W,H,`rgba(226,239,170,${Math.min(.5,flash)})`);ctx.restore();}
// The simulation advances by the real elapsed time of every displayed frame, split into steps no longer than
// about a sixtieth of a second. A fixed 60 Hz accumulator skipped or doubled updates on 72, 120 and 144 Hz
// displays, which showed as a hitch in the hero's walk several times a second.
function frame(now){const elapsed=Math.min(.1,Math.max(0,(now-last)/1000||1/60));last=now;const steps=Math.max(1,Math.round(elapsed*60)),dt=elapsed/steps;for(let i=0;i<steps;i++)update(dt);render();requestAnimationFrame(frame);}
window.addEventListener('keydown',e=>{const use=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyW','KeyA','KeyS','KeyD','KeyJ','KeyK','KeyL','KeyZ','KeyX','KeyC','KeyE','KeyV','ShiftLeft','ShiftRight','Enter','Escape','KeyP'];if(use.includes(e.code)&&(state==='play'||['ArrowLeft','ArrowRight','Enter','Escape','KeyP'].includes(e.code)))e.preventDefault();unlockAudio();if(e.code==='Escape'||e.code==='KeyP'){if(!e.repeat){if(state==='play'||state==='paused')pause();else if(e.code==='Escape'&&['select','chapters','guide','credits','jukebox'].includes(state))menu();}return;}if(!e.repeat&&['ArrowLeft','ArrowRight','KeyA','KeyD'].includes(e.code)){const now=performance.now()/1000;if(lastDirection.key===e.code&&now-lastDirection.time<.28){dashTime=1.6;dashKey=e.code;}lastDirection={key:e.code,time:now};}if(!keys.has(e.code))pressed.add(e.code);keys.add(e.code);if(e.code==='Enter'&&!e.repeat){if(state==='menu')characterSelect(0);else if(state==='select')document.getElementById('begin')?.click();else if(state==='brief')document.getElementById('enter-stage')?.click();else if(state==='clear')document.getElementById('next')?.click();else if(state==='gameover')document.getElementById('retry')?.click();}if(state==='select'&&!e.repeat&&['ArrowLeft','ArrowRight'].includes(e.code)){selected=SELECT_ORDER[(SELECT_ORDER.indexOf(selected)+(e.code==='ArrowRight'?1:3))%4];characterSelect();}});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{resetInput();if(state==='play')pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='play')pause();});
function touchKey(code,on){if(on&&!touchKeys.has(code)){touchKeys.add(code);if(!keys.has(code))pressed.add(code);keys.add(code);}else if(!on&&touchKeys.has(code)){touchKeys.delete(code);keys.delete(code);}}
const stickEl=document.getElementById('stick'),knobEl=document.getElementById('stick-knob');
function setStick(x,y){
  const dead=.3,run=Math.abs(x)>.8;touchKey('ArrowRight',x>dead);touchKey('ArrowLeft',x<-dead);touchKey('ArrowDown',y>dead);touchKey('ArrowUp',y<-dead);touchKey('TouchRun',run);
  if(knobEl)knobEl.style.transform=x||y?`translate(${x*62}%,${y*62}%)`:'';stickEl?.classList.toggle('running',run);
}
function moveStick(e){const r=stickEl.getBoundingClientRect(),R=r.width*.3;let x=(e.clientX-(r.left+r.width/2))/R,y=(e.clientY-(r.top+r.height/2))/R;const m=Math.hypot(x,y);if(m>1){x/=m;y/=m;}setStick(x,y);}
if(stickEl){
  stickEl.addEventListener('pointerdown',e=>{e.preventDefault();if(stickId!==null)return;stickId=e.pointerId;try{stickEl.setPointerCapture(e.pointerId);}catch{}unlockAudio();stickEl.classList.add('active');moveStick(e);});
  stickEl.addEventListener('pointermove',e=>{if(e.pointerId===stickId){e.preventDefault();moveStick(e);}});
  const endStick=e=>{if(e.pointerId!==stickId)return;stickId=null;stickEl.classList.remove('active');setStick(0,0);};
  for(const t of ['pointerup','pointercancel','lostpointercapture'])stickEl.addEventListener(t,endStick);
  stickEl.addEventListener('contextmenu',e=>e.preventDefault());
}
document.querySelectorAll('[data-key]').forEach(b=>{const k=b.dataset.key;let id=null;
  const release=e=>{if(e.pointerId!==id)return;id=null;b.classList.remove('held');touchKey(k,false);};
  b.addEventListener('pointerdown',e=>{e.preventDefault();id=e.pointerId;try{b.setPointerCapture(e.pointerId);}catch{}unlockAudio();b.classList.add('held');touchKey(k,true);navigator.vibrate?.(8);});
  for(const t of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(t,release);
  b.addEventListener('contextmenu',e=>e.preventDefault());});
bindButton('pause',pause);bindButton('home',()=>{if(state==='play')pause();else menu();});bindButton('sound',()=>{const on=settings.music||settings.sfx;settings.music=!on;settings.sfx=!on;document.querySelector('#sound').textContent=on?'SOUND OFF':'SOUND ON';persist();});document.querySelector('#sound').textContent=settings.music||settings.sfx?'SOUND ON':'SOUND OFF';// Fullscreen. Desktop keeps the playfield-only fullscreen. Touch devices fullscreen the whole page so the controls
// come along, hide the page header and lock to landscape where the browser allows it. iPhone Safari has no page
// fullscreen, so it gets a fill-the-screen mode instead (and Add to Home Screen opens the game without browser bars).
const root=document.documentElement,fsElement=()=>document.fullscreenElement||document.webkitFullscreenElement;
const isFull=()=>root.classList.contains('is-full');
async function enterTouchFull(){
  const req=root.requestFullscreen||root.webkitRequestFullscreen;let real=false;
  if(req){try{await req.call(root,{navigationUI:'hide'});real=true;}catch{}}
  root.classList.add('is-full');root.classList.toggle('pseudo-full',!real);
  try{await screen.orientation?.lock?.('landscape');}catch{}
  window.scrollTo(0,0);resetInput();
  if(!real&&/iPhone|iPod/.test(navigator.userAgent)){toast='FOR TRUE FULLSCREEN: SHARE → ADD TO HOME SCREEN';toastTime=5;}
}
async function exitTouchFull(){
  if(fsElement()){try{await (document.exitFullscreen||document.webkitExitFullscreen).call(document);}catch{}}
  try{screen.orientation?.unlock?.();}catch{}
  if(!root.classList.contains('standalone'))root.classList.remove('is-full','pseudo-full');resetInput();
}
function toggleFull(){
  if(TOUCH){isFull()&&!root.classList.contains('standalone')?exitTouchFull():enterTouchFull();return;}
  if(document.fullscreenElement)document.exitFullscreen();else document.querySelector('.game-shell').requestFullscreen?.().catch(()=>{});
}
bindButton('full',toggleFull);bindButton('full-exit',toggleFull);
// Leaving fullscreen with the system back gesture or swipe also restores the normal layout.
for(const ev of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(ev,()=>{if(TOUCH&&!fsElement()&&!root.classList.contains('pseudo-full')&&!root.classList.contains('standalone'))root.classList.remove('is-full');resetInput();});
// Launched from the home screen: already fullscreen.
if(TOUCH&&(matchMedia('(display-mode: fullscreen)').matches||matchMedia('(display-mode: standalone)').matches||navigator.standalone))root.classList.add('is-full','standalone');
// A narrow, explicit test interface keeps campaign checks reproducible.
window.LAST_EDEN={render, get state(){return state;},get snapshot(){return {difficulty:normalizeDifficulty(difficulty),road,coins,continueTimer,difficultyRules:{...rules()},particles:particles.map(p=>({...p})),gunSocket:player?.weapon&&weaponClass(player.weapon)?gunMount():null,mission:mission?{completed:mission.completed,total:mission.total,active:mission.active?{...mission.active}:null}:null,artReady:SEQUEL_RENDER.ready,posesReady:ahSheet.complete,state,level:levelIndex,wave,score,lives,section:sectionIndex,encounter:encIndex,driving,camera,length:level.length,plan:plan?{sections:plan.sections.map(s=>({...s})),encounters:plan.encounters.map(e=>({x:e.x,section:e.section,task:e.task,boss:!!e.boss,elite:e.elite?.name||null}))}:null,lock:lock?{...lock}:null,bullets:bullets.map(b=>({...b})),zones:zones.map(z=>({...z})),effects:effects.map(f=>f.type),audio:soundtrack.status,player:player?{...player,pickTarget:null,grab:player.grab?{t:player.grab.t,hits:player.grab.hits,type:player.grab.e.type}:null,moveState:player.moveState?{name:player.moveState.name,k:player.moveState.k}:null}:null,enemies:enemies.map(e=>({...e,target:null,hitList:null})),allies:allies.map(a=>({...a,target:null})),objects:objects.map(o=>({...o})),drops:drops.map(d=>({...d})),unlocked:save.unlocked,checkpoint:save.checkpoint?{...save.checkpoint}:null};},
 start:(i=0,hero=0,mode='story',section=0)=>{selected=clamp(hero,0,3);difficulty=normalizeDifficulty(mode);score=0;lives=3;startStage(clamp(i,0,5),{skipBrief:true,section});},step:(dt=1/60)=>update(dt),controls:{attack,jump,special,pickup,coin:insertCoin},
 test:{damageObjective:n=>damageObjective(n,mission.active?.x,mission.active?.y,100,1),completeObjective,equip:(type,ammo)=>{player.pendingStrike=null;player.attack=0;player.pickup=0;player.weapon=type;player.ammo=type?ammo??WEAPONS[type].ammo:0;},spawnEnemy,drop:(type,x,y,food)=>drops.push({type,x,y,life:999,food:food||(type==='food'?'hamburger':type==='bonus'?'goldbar':type==='ammo'?'ammo':undefined)}),move:(x,y)=>{player.x=x;player.y=y;},damageEnemy:(i,n)=>damageEnemy(enemies[i],n),damagePlayer:n=>damagePlayer(n,player.x-40),
  clearFighters:()=>{if(encounter&&!encounter.spec.boss){encounter.next=(encounter.spec.w||[]).length;encounter.eliteSpawned=true;}enemies.forEach(e=>{e.waiting=false;e.inv=0;e.delay=0;if(e.state==='drop'){e.z=0;e.state='walk';}damageEnemy(e,9999);if(e.phase===2&&e.hp>0){e.inv=0;damageEnemy(e,9999);}});},
  finishEncounter:()=>{completeObjective();LAST_EDEN.test.clearFighters();completeObjective();},
  skipTo:n=>{const enc=plan.encounters[n];lock=null;encounter=null;enemies=[];if(mission.active&&!mission.active.done)mission.active=null;encIndex=n;player.x=enc.x;camera=clamp(player.x-255,0,level.length-W+180);while(plan.sections[sectionIndex+1]&&player.x>=plan.sections[sectionIndex+1].x)enterSection(sectionIndex+1);},
  freeClones,spawnBoss,clear:stageClear}};
sheet.onload=()=>{if(state==='select')characterSelect();};sheet.onerror=()=>panel('<section class="panel small-panel"><h2>ARTWORK COULD NOT LOAD.</h2><p>Keep assets.js, game.js and index.html in the same folder, then open index.html again.</p></section>');menu();requestAnimationFrame(frame);
})();
