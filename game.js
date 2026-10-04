/* Cadillacs & Dinosaurs II: Last Eden — original local fan-game engine. */
(() => {
'use strict';
const canvas=document.querySelector('#game'),ctx=canvas.getContext('2d'),overlay=document.querySelector('#overlay');
const A=window.ARCADE_ASSETS,sheet=new Image();sheet.src=A.sheet;
const W=768,H=432,GROUND=254,FLOOR=407;
const HEROES=[
 {id:'mustapha',name:'MUSTAPHA',nickname:'MOSTAFA',tag:'THE FLYING KICK',hp:120,speed:180,power:21,color:'#d5ec69',special:'Tornado kick'},
 {id:'jack',name:'JACK TENREC',nickname:'',tag:'THE ALL-ROUNDER',hp:140,speed:145,power:23,color:'#7dc4de',special:'Dino uppercut'},
 {id:'hannah',name:'HANNAH DUNDEE',nickname:'',tag:'THE SWIFT STRIKER',hp:110,speed:166,power:19,color:'#efaa77',special:'Spiral flash'},
 {id:'mess',name:'MESS O\'BRADOVICH',nickname:'',tag:'THE HEAVY HITTER',hp:170,speed:122,power:29,color:'#b5cc85',special:'Knuckle bomb'}
];
const LEVELS=window.EDEN_CAMPAIGN;
const rand=(a,b)=>a+Math.random()*(b-a),clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),approach=(x,y,s)=>x<y?Math.min(x+s,y):Math.max(x-s,y);
const keys=new Set(),pressed=new Set(),touchKeys=new Set(),padKeys=new Set();
function resetInput(){keys.clear();pressed.clear();touchKeys.clear();padKeys.clear();lastDirection={key:'',time:0};dashKey='';dashTime=0;}
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
const SECTION_NAMES = [
 ['THE SILENT DOCKS','STOLEN TRANSMITTER','ROOK’S BLOCKADE'],
 ['BROKEN EXPRESSWAY','THE GOVERNOR TANKER','THE LAST ESCORT'],
 ['THE BLOCKED RIDGE','SONIC LURE TRAIL','THORNMAW’S NEST'],
 ['SCRAPPED WATER PUMPS','THE MACHINE SHOP','CINDER’S PRESS'],
 ['THE PUMPING STATION','FALSE DIRECTIONS','THE RADIO RELAY'],
 ['THE SERVICE TUNNEL','RESERVOIR WALKWAY','THE CROWN FLOODGATE']
];
const STAGE_TRACKS = [['06','07','08'],['16','17','22'],['13','14','07'],['20','21','22'],['08','17','20'],['25','13','14']];
const BOSS_TRACKS = ['10','19','15','24','24','15'];
const ENCOUNTERS = [
 [['raider','raider'],['gunner','raider','brute'],['raider','knifer','gunner'],['brute','raider','raider'],['gunner','knifer','brute'],['brute','gunner','raider']],
 [['biker','biker'],['biker','biker','gunner'],['biker','biker','biker'],['biker','gunner','biker'],['biker','biker','gunner'],['biker','biker','biker']],
 [['raider','knifer'],['raptor','raider','gunner'],['raptor','raptor','knifer'],['brute','gunner','raider'],['raptor','brute','gunner'],['raptor','raptor','brute']],
 [['brute','raider'],['knifer','gunner','brute'],['brute','brute','raider'],['gunner','knifer','gunner'],['brute','gunner','raider'],['brute','knifer','gunner']],
 [['gunner','knifer'],['brute','gunner','raider'],['brute','raptor','gunner'],['brute','brute','knifer'],['brute','gunner','gunner'],['brute','brute','brute']],
 [['raptor','brute'],['brute','gunner','raptor'],['brute','brute','knifer'],['brute','raptor','gunner'],['brute','brute','brute'],['brute','gunner','brute']]
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
  player.weapon=null;player.ammo=0;player.pendingStrike=null;player.burst=null;
}
function explode(x,y,damage,friendly=true,r=96) {
  effects.push({x,y,age:0,life:.65,type:'explosion'});shake=10;sfx('explosion');
  for(const e of enemies)if(friendly&&!e.dead&&Math.hypot(e.x-x,(e.y-y)*1.6)<r)damageEnemy(e,damage,Math.sign(e.x-x)*48,true);
  if(friendly&&mission?.active)damageObjective(damage,x,y,r,Math.sign(mission.active.x-x)||1);
  if(!friendly&&Math.hypot(player.x-x,(player.y-y)*1.6)<r)damagePlayer(damage,x);
  for(const o of objects)if(o.hp>0&&Math.hypot(o.x-x,o.y-y)<r)breakObject(o,damage);
}
function breakObject(o,power) {
  o.hp-=power;burst(o.x,o.y-30,'#c3925d',10);
  if(o.hp<=0){drops.push({x:o.x,y:o.y,type:o.content,life:90});score+=100;}
}
function weaponAttack() {
  const w=WEAPONS[player.weapon];if(!w)return false;
  player.pendingStrike=null;player.dashVelocity=0;
  const type=player.weapon;player.attackTotal=w.cooldown;player.attack=w.cooldown;player.attackKind=w.melee?'weapon-melee':w.thrown?'throw':'fire';player.recoil=w.recoil||0;
  if(player.ammo<=0){player.attack=.2;player.recoil=0;toast='EMPTY · E TO THROW / SWAP';toastTime=1.2;return true;}
  if(w.melee){
    const close=enemies.some(e=>!e.dead&&Math.abs(e.x-player.x)<w.range&&Math.abs(e.y-player.y)<36);
    if(type==='knife'&&!close){bullets.push({x:player.x,y:player.y,z:48,vx:player.dir*490,vy:0,friendly:true,damage:45,life:1.2,kind:'thrown',weapon:type,age:0});player.weapon=null;player.ammo=0;}
    else {meleeStrike(w.range,w.damage*(selected===2?1.25:1),type!=='knife');if(--player.ammo<=0){player.weapon=type==='rod'?'stick':null;player.ammo=type==='rod'?8:0;}}
    sfx('hit');return true;
  }
  if(w.thrown){bullets.push({x:player.x+player.dir*20,y:player.y,z:50,vx:player.dir*220,vy:0,friendly:true,damage:w.damage,life:type==='dynamite'?1.15:.85,kind:'lob',weapon:type,age:0});if(--player.ammo<=0)player.weapon=null;sfx('jump');return true;}
  const shots=Math.min(w.burst||1,player.ammo);
  emitGunRound(type);player.burst=shots>1?{weapon:type,remaining:shots-1,next:.085}:null;
  return true;
}

function meleeStrike(range,power,knockdown=false,struck=null) {
  let hits=0;
  for(const e of enemies)if(!e.dead&&!struck?.includes(e.id)&&Math.abs(e.y-player.y)<36&&Math.abs(e.x-player.x)<range&&(Math.abs(e.x-player.x)<16||Math.sign(e.x-player.x)===player.dir)){if(damageEnemy(e,power,player.dir*(knockdown?42:8),knockdown)){struck?.push(e.id);hits++;}}
  for(const o of objects)if(o.hp>0&&!struck?.includes('box'+o.x)&&Math.abs(o.y-player.y)<36&&Math.abs(o.x-player.x)<range&&Math.sign(o.x-player.x)===player.dir){breakObject(o,power);struck?.push('box'+o.x);}
  const id='task'+mission?.active?.name;if(!struck?.includes(id)&&damageObjective(power,player.x,player.y,range,player.dir))struck?.push(id);
  return hits;
}
function emitGunRound(type){
  const w=WEAPONS[type],mount=gunMount(),muzzle=mount.x+w.sprite[2]*.65*1.12;
  bullets.push({x:player.x+player.dir*muzzle,sweepFrom:player.x,y:player.y,z:mount.y+player.z,vx:player.dir*(w.explosive?450:860),vy:0,friendly:true,damage:w.damage*(selected===2?1.25:1),life:w.spread?.33:1.15,kind:w.explosive?'rocket':'bullet',weapon:type,spread:w.spread||25,pierce:w.pierce||1,hits:[],age:0});
  player.ammo--;player.recoil=w.recoil||0;sfx(type==='bazooka'?'rocket':type==='shotgun'?'shotgun':'gun');
  effects.push({type:'muzzle',x:player.x+player.dir*muzzle,y:player.y-mount.y-player.z,dir:player.dir,age:0,life:.065});
  if(player.ammo===0){toast='EMPTY · E TO THROW / SWAP';toastTime=2;}
}
function updateBurst(dt){
  const b=player.burst;if(!b)return;
  if(player.weapon!==b.weapon||player.hurt>0||player.special>0||player.attackKind!=='fire'){player.burst=null;return;}
  b.next-=dt;
  while(b.next<=0&&b.remaining>0&&player.ammo>0){emitGunRound(b.weapon);b.remaining--;b.next+=.085;}
  if(b.remaining<=0||player.ammo<=0)player.burst=null;
}
function clearEnemyHazards(owner){for(const b of bullets)if(b.owner===owner)b.life=0;for(const z of zones)if(z.owner===owner)z.cancelled=true;}
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
      for(const o of objects)if(o.hp>0&&intersects(o.x,25)&&Math.abs(b.y-o.y)<30&&b.z<85)targets.push({kind:'object',target:o});
      const task=mission?.active;if(task?.kind==='beacon'&&intersects(task.x,23)&&Math.abs(b.y-task.y)<32&&b.z<110)targets.push({kind:'objective',target:task});
      targets.sort((a,c)=>Math.abs(a.target.x-from)-Math.abs(c.target.x-from));
      for(const item of targets){
        if(b.life<=0)break;const t=item.target;
        if(b.kind==='rocket'){explode(t.x,b.y,b.damage,true,120);b.life=0;break;}
        if(item.kind==='enemy'){if(!damageEnemy(t,b.damage,Math.sign(b.vx)*12,b.weapon==='rifle'||b.weapon==='shotgun'))continue;(b.hits||(b.hits=[])).push(t.id);b.pierce=(b.pierce||1)-1;if(b.pierce<=0)b.life=0;}
        else {if(item.kind==='objective')damageObjective(b.damage,t.x,b.y,40,Math.sign(b.vx));else breakObject(t,b.damage);b.life=0;}
      }
    }else if(intersects(player.x,level.drive?64:23)&&Math.abs(b.y-player.y)<25&&b.z>=player.z+(level.drive?0:8)&&b.z<=player.z+(level.drive?80:105)){
      damagePlayer(b.damage,b.x-Math.sign(b.vx)*40,true);b.life=0;
    }
  }
  bullets=bullets.filter(b=>b.life>0);for(const fx of effects)fx.age+=dt;effects=effects.filter(fx=>fx.age<fx.life);
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
function guide(back){state='guide';panel(`<section class="panel small-panel"><p class="eyebrow">ARCADE FIELD GUIDE</p><h2>GET BACK IN THE FIGHT.</h2><div class="controls-list"><strong>WASD / ↑↓←→</strong><span>Move along the street and between lanes.</span><strong>J / Z</strong><span>Unarmed: chain hits or use an aerial strike. Holding a gun: fire only, even at close range. Empty gun: E to discard. Attack over a weapon to pick it up.</span><strong>K / X</strong><span>Jump. Dodge shockwaves and low attacks.</span><strong>L / C</strong><span>Special move, also J + K together. Costs health when it hits; drops your weapon.</span><strong>E / V</strong><span>At a console: hold to operate, or tap to tune the marked channel. Elsewhere: pick up or throw a weapon.</span><strong>SHIFT</strong><span>Run, or double tap a direction. Run + attack: Mustapha’s flying kick, Jack’s slide, Hannah’s knee or Mess’s body splash.</span><strong>ESC / P</strong><span>Pause. Gamepad: stick / D-pad, X hit, A jump, Y special, B pick.</span></div><p>Break barrels for food and weapons. Finish the marked objective to open the route: hold E at relays/valves, tap E to tune radios, attack sonic lures, or drive into cargo. Red attack markers mean dodge or jump. Each gun has its own ammo and firing pattern. Knockdowns drop weapons. Highway: steer into enemies, J bash, K boost, L ram.</p><div class="menu-buttons"><button id="back" class="primary">GOT IT →</button></div></section>`);bindButton('back',back);}
function startStage(i,skipBrief=false){levelIndex=i;level=LEVELS[i];const hero=HEROES[selected];player={x:130,y:352,z:0,vz:0,dir:1,hp:hero.hp*(difficulty==='story'?1.4:1),maxhp:hero.hp*(difficulty==='story'?1.4:1),hurt:0,inv:1.5,attack:0,attackTotal:.38,special:0,specialCd:0,comboStep:0,weapon:null,ammo:0,move:false,run:false,anim:0,boost:0,boostCd:0,recoil:0,knocked:false,attackKind:"combo",pendingStrike:null};
 enemies=[];objects=[];drops=[];particles=[];bullets=[];zones=[];floating=[];effects=[];section=-1;bossIntro=0;lastHitEnemy=null;dashTime=0;wave=0;lock=null;camera=0;bossSpawned=false;cleared=false;stageTimer=0;combo=0;comboTimer=0;shake=0;flash=0;checkpoint();initMission();resetInput();hitstop=0;
 if(!level.drive){const loot=['gun','food','rod','shotgun','food','uzi','grenade','rifle','food','m16','dynamite','bazooka'];for(let j=0;j<12;j++)objects.push({x:300+j*315,y:310+(j*29)%76,hp:28,type:j%3===0?'crate':'barrel',content:loot[(j+levelIndex*2)%loot.length]});drops.push({x:230,y:360,type:levelIndex===0?'gun':'shotgun',life:999});drops.push({x:270,y:375,type:'food',life:999});}
 started=true;toast=level.drive?'STEER ↑↓ · RAM ENEMIES · J BASH · K BOOST':'MOVE → · J ATTACK · K JUMP · E PICK UP';toastTime=7;
 if(skipBrief){state='play';panel('');canvas.focus();return;}
 state='brief';panel(`<section class="panel small-panel"><p class="eyebrow">CHAPTER 0${i+1} · ${level.area.split('/')[1].trim()}</p><h2>${level.name}</h2><p>${level.brief}</p><p style="color:var(--acid);white-space:pre-line">${level.dialog}</p><div class="menu-buttons"><button id="enter-stage" class="primary">${level.drive?'START YOUR ENGINE':'ENTER THE CHAPTER'} →</button></div></section>`);bindButton('enter-stage',()=>{state='play';panel('');resetInput();canvas.focus();});}
function pause(){if(state==='play'){state='paused';resetInput();panel(`<section class="panel small-panel"><p class="eyebrow">TAKE A BREATHER</p><h2>PAUSED.</h2><p>Chapter 0${levelIndex+1} · ${level.name}<br>Your checkpoint is saved at the start of this chapter.</p><div class="menu-buttons"><button id="resume" class="primary">RESUME →</button><button id="controls" class="secondary">CONTROLS</button><button id="pause-sound" class="secondary">AUDIO SETTINGS</button><button id="restart" class="secondary">RESTART CHAPTER</button><button id="quit" class="secondary">MAIN MENU</button></div></section>`);bindButton('resume',resume);bindButton('pause-sound',()=>soundRoom(()=>{state='play';pause();}));bindButton('controls',()=>guide(()=>{state='play';pause();}));bindButton('restart',()=>startStage(levelIndex));bindButton('quit',()=>{checkpoint();menu();});}else if(state==='paused')resume();}
function resume(){state='play';panel('');resetInput();canvas.focus();}
function gameover(){state='gameover';save.best=Math.max(save.best,score);persist();panel(`<section class="panel small-panel"><p class="eyebrow">THE FIGHT ISN'T OVER</p><h2>CONTINUE?</h2><p>The gang regroups at the start of this chapter. No coins needed.<br>Score ${score.toString().padStart(6,'0')} · Best combo ${bestCombo}</p><div class="menu-buttons"><button id="retry" class="primary">TRY AGAIN →</button><button id="quit" class="secondary">MAIN MENU</button></div></section>`);bindButton('retry',()=>{lives=3;startStage(levelIndex);});bindButton('quit',menu);}
function stageClear(){if(cleared)return;cleared=true;state='clear';score+=2500+Math.floor(player.hp*10);save.unlocked=Math.max(save.unlocked,Math.min(5,levelIndex+1));save.best=Math.max(save.best,score);sfx('clear');save.checkpoint=levelIndex<5?{level:levelIndex+1,hero:selected,difficulty,score,lives}:null;persist();panel(`<section class="panel small-panel"><p class="eyebrow">CHAPTER 0${levelIndex+1} COMPLETE</p><h2>${levelIndex===5?'EDEN IS FREE.':'KEEP THE ENGINE RUNNING.'}</h2><p>${level.end}</p><p style="color:var(--acid)">SCORE ${score.toString().padStart(6,'0')} · BEST COMBO ${bestCombo}</p><div class="menu-buttons"><button id="next" class="primary">${levelIndex===5?'SEE THE ENDING':'NEXT CHAPTER'} →</button></div></section>`);bindButton('next',()=>levelIndex<5?startStage(levelIndex+1):ending());}
function ending(){state='ending';save.checkpoint=null;persist();panel(`<section class="panel small-panel"><p class="eyebrow">LAST EDEN · THE END</p><h2>A WORLD WORTH SAVING.</h2><p>The spillway opens one gate at a time. The old river fills. On the ridge, families make room for a herd and its young. No one has to buy permission to survive.</p><p>Sable faces the settlements he tried to drown. The water keys stay with them. At Last Eden, Hannah hangs a radio beside the first public well. Jack’s Cadillac is already pointing home.</p><p style="color:var(--acid)">MESS: Tell me we’re finally going home.<br>MUSTAPHA: After breakfast. Saving the world makes me hungry.</p><p>${kills} enemies defeated · ${Math.floor(runTime/60)} minutes · score ${score}<br>All six chapters are now available.</p><div class="menu-buttons"><button id="chapters" class="primary">PLAY A CHAPTER →</button><button id="credits" class="secondary">CREDITS</button><button id="quit" class="secondary">MAIN MENU</button></div></section>`);bindButton('chapters',chapters);bindButton('credits',credits);bindButton('quit',menu);}
function credits(){state='credits';panel(`<section class="panel small-panel"><p class="eyebrow">THANKS FOR PLAYING</p><h2>FOR THE OLD ARCADE DAYS.</h2><p>An unofficial fan sequel created for Mostafa's next adventure. Original character graphics were recovered from the arcade ROM files supplied by the user.</p><p>New story, levels, environments, combat engine, boss behaviors created for this game. Original soundtrack supplied by the user. New scenery and human boss artwork were generated for this sequel; the original heroes and regular enemy artwork are retained. Original Cadillacs and Dinosaurs arcade game and artwork: Capcom. Characters and setting derive from Xenozoic Tales by Mark Schultz.</p><div class="menu-buttons"><button id="quit" class="primary">MAIN MENU →</button></div></section>`);bindButton('quit',menu);}
function spawnEnemy(x,y,type='raider',boss=false) {
  const base=boss?[540,670,620,690,710,540][levelIndex]:({brute:125,gunner:68,raptor:74,knifer:82,mutant:138,biker:85}[type]||80);
  const hp=base*(difficulty==='story'?.84:1.2);
  const e={id:Math.random(),x,y,z:0,dir:-1,hp,maxhp:hp,type,boss,phase:1,state:'walk',timer:rand(.8,1.8),hurt:0,inv:0,anim:0,dead:0,attack:0,attackNo:0,hitChain:0,hitTimer:0,recovery:0,palette:'13',hue:0};
  enemies.push(e);return e;
}

let mission=null,radio=null;
function initMission(){mission={completed:0,total:3,active:null,items:[],spec:EDEN_MISSIONS[levelIndex]};radio=null;}
function createObjective(kind,name,x,y,target=0,bossTask=false){
  const item={kind,name,x,y,target,channel:0,progress:0,hp:kind==='beacon'?bossTask?180:80:1,maxhp:kind==='beacon'?bossTask?180:80:1,done:false,bossTask};
  mission.items.push(item);mission.active=item;
  toast=kind==='beacon'?'DESTROY THE SONIC LURE':kind==='cargo'?'STEER INTO THE RECOVERY CRATE':kind==='tuner'?`TUNE CHANNEL ${target} · E TO STEP`:'HOLD E / PICK TO OPERATE';toastTime=3.5;return item;
}
function encounterObjective(n){if(n%2||mission.items.length>=3)return;const [kind,name,target]=mission.spec.tasks[n/2-1];createObjective(kind,name,Math.min(lock.right-95,player.x+205),n===4?305:367,target);}
function objectiveNear(){const t=mission?.active;return t&&!t.done&&Math.abs(t.x-player.x)<(level.drive?100:65)&&Math.abs(t.y-player.y)<43&&player.z===0;}
function interactMission(tapped=false){
  const t=mission?.active;if(!objectiveNear()||!t||t.kind==='beacon'||t.kind==='cargo')return false;
  if(t.kind==='tuner'&&tapped){t.channel=(t.channel+1)%4;sfx('pickup');if(t.channel===t.target)completeObjective();}
  return true;
}
function completeObjective(){
  const t=mission?.active;if(!t||t.done)return;t.done=true;t.progress=1;mission.completed++;mission.active=null;score+=800;sfx('pickup');burst(t.x,t.y-48,'#ace1b4',18);
  radio={text:levelIndex===0?'HANNAH: Another district can hear the warning.':levelIndex===1?'JACK: Cargo secured. Keep the tanker in sight.':levelIndex===2?'HANNAH: The herd has a way through.':levelIndex===3?'MESS: Pressure is off. Take the coupling.':levelIndex===4?'HANNAH: This channel is ours. Stay on high ground.':'JACK: The river route is ready.',ttl:4};
  if(t.kind==='valve')zones=zones.filter(z=>z.style!=='vent');
  if(t.bossTask&&levelIndex===2){for(const e of enemies)if(e.boss&&!e.dead){e.hp=1;e.state='flee';e.timer=1.5;e.inv=3;e.z=0;e.dir=1;clearEnemyHazards(e.id);}radio={text:'HANNAH: The nest is quiet. Let Thornmaw go.',ttl:5};}
}
function damageObjective(power,x=player.x,y=player.y,range=90,dir=player.dir){
  const t=mission?.active;if(!t||t.kind!=='beacon'||t.done)return false;
  if(Math.abs(t.x-x)>range||Math.abs(t.y-y)>38||(Math.abs(t.x-x)>15&&Math.sign(t.x-x)!==dir))return false;
  t.hp-=power;burst(t.x,t.y-40,'#8fdde2',8);if(t.hp<=0)completeObjective();return true;
}
function updateMission(dt){
  if(radio){radio.ttl-=dt;if(radio.ttl<=0)radio=null;}
  const t=mission?.active;if(!t)return;
  if(t.kind==='cargo'){if(objectiveNear())completeObjective();return;}
  if(t.kind==='beacon'||t.kind==='tuner')return;
  if(objectiveNear()&&down('KeyE','KeyV')&&player.hurt<=0&&player.attack<=0&&!player.move){t.progress+=dt/(t.bossTask?1.4:.85);if(t.progress>=1)completeObjective();}
  else t.progress=Math.max(0,t.progress-dt*.7);
}
function drawMissionItem(t){
  const x=t.x-camera,y=t.y;if(x<-100||x>W+100)return;shadow(ctx,x,y,25);
  const glow=t.done?'#a9de9a':t.kind==='beacon'?'#efaa71':'#7fdfd5';
  if(t.kind==='cargo'){
    rect(ctx,x-35,y-36,70,36,'#223332');rect(ctx,x-31,y-33,62,29,t.done?'#557363':'#968a5b');rect(ctx,x-5,y-34,10,32,'#d3c798');rect(ctx,x-25,y-23,19,9,'#304843');
  }else{
    rect(ctx,x-23,y-63,46,64,'#142d34');rect(ctx,x-20,y-60,40,51,'#496671');rect(ctx,x-16,y-55,32,23,'#152d31');rect(ctx,x-12,y-51,24,14,glow);
    for(let i=0;i<3;i++)rect(ctx,x-14+i*11,y-23,6,7,i===0?glow:'#89988e');rect(ctx,x-27,y-9,54,9,'#273d40');
    if(t.kind==='relay'||t.kind==='beacon'){rect(ctx,x-2,y-91,4,29,'#9aaea5');for(let j=0;j<3;j++)rect(ctx,x-17+j*4,y-86+j*8,34-j*8,3,glow);if(!t.done){ctx.strokeStyle=glow+'77';ctx.beginPath();ctx.ellipse(x,y-79,12+(time*18)%35,7+(time*9)%17,0,0,Math.PI*2);ctx.stroke();}}
    if(t.kind==='valve'||t.kind==='gate'){ctx.strokeStyle=glow;ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y-40,13,0,Math.PI*2);ctx.stroke();rect(ctx,x-2,y-53,4,26,'#273d40');}
  }
  if(t.done){label('✓',x,y-79,17,glow,'center');return;}
  const hint=t.kind==='beacon'?'J / FIRE · SILENCE':t.kind==='cargo'?'RAM TO COLLECT':t.kind==='tuner'?`E · ${t.channel} → ${t.target}`:'HOLD E / PICK';
  label(t.name,x,y-106,9,'#e6e6c4','center');label(hint,x,y-92,10,glow,'center');
  rect(ctx,x-30,y-76,60,4,'#10222b');rect(ctx,x-30,y-76,60*(t.kind==='beacon'?t.hp/t.maxhp:t.progress),4,glow);
}
function missionHud(){
  if(!mission)return;rect(ctx,14,125,290,28,'#101f25d9');label(`${mission.spec.verb.toUpperCase()} ${mission.completed}/${mission.total}`,23,144,10,'#afded4');
  const t=mission.active;if(t&&(t.x-camera<30||t.x-camera>W-30))label(t.x<player.x?'← OBJECTIVE':'OBJECTIVE →',t.x<player.x?24:W-24,176,11,'#99e5d8',t.x<player.x?'left':'right');
  if(radio){rect(ctx,15,H-82,W-30,25,'#0d202bf0');label(radio.text,W/2,H-65,10,'#c8e7d4','center');}
}

function spawnWave(n) {
  wave=n;lock={left:Math.max(0,player.x-185),right:Math.min(level.length+240,player.x+510)};
  encounterObjective(n);
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
  toast=level.boss+' · '+['BREAK THE BLOCKADE','RAM THE ESCORT','WATCH THE CHARGE','DODGE THE CLEAVES','BREAK ITS RHYTHM','SAVE THE FLOODGATE'][levelIndex];toastTime=4;
  if(levelIndex===2){mission.total=4;createObjective('beacon','NEST SONIC DRIVER',level.length-275,375,0,true);}
  sfx('special');
}

function popup(x,y,text,color='#e9ecd1'){floating.push({x,y,text,color,life:1.15});}
function burst(x,y,color,n=12){for(let i=0;i<n;i++)particles.push({x,y,vx:rand(-120,120),vy:rand(-140,60),life:rand(.18,.55),size:rand(2,5),color});}
function damageEnemy(e,amount,knock=0,forceDown=false) {
  if(e.dead||e.inv>0||e.state==='flee')return false;
  e.hp-=amount;e.hurt=e.boss?.07:.15;e.inv=.055;e.x+=knock*(e.boss?.25:1);
  if(lock)e.x=clamp(e.x,lock.left+28,lock.right-42);
  e.hitChain=e.hitTimer>0?e.hitChain+1:1;e.hitTimer=1.1;
  if(!e.boss){if(forceDown||e.hitChain>=3){e.state='down';e.timer=.85;e.inv=.7;e.hitChain=0;}else{e.state='hurt';e.timer=.25;}}
  lastHitEnemy=e;combo++;comboTimer=2;bestCombo=Math.max(bestCombo,combo);score+=Math.floor(amount*3);
  burst(e.x,e.y-48,'#ffe2a1',8);sfx('hit');hitstop=.035;shake=3;
  if(e.hp<=0){
    if(e.boss&&e.type==='sable'&&e.phase===1){clearEnemyHazards(e.id);e.z=0;e.phase=2;e.hp=e.maxhp=850*(difficulty==='story'?.84:1.2);e.state='transform';e.timer=2.7;e.inv=2.7;e.attackNo=0;flash=.65;shake=12;toast='SABLE BOARDS THE CROWN ENGINE';toastTime=4;effects.push({x:e.x,y:e.y,age:0,life:.8,type:'explosion'});return true;}
    if(e.type==='raptor'&&e.boss&&mission.active?.bossTask){e.hp=1;e.state='recover';e.timer=1.4;e.inv=1.4;toast='SILENCE THE NEST DRIVER TO CALM THORNMAW';toastTime=2;return true;}
    if(e.type==='raptor'){e.state='flee';e.timer=1.2;e.hp=1;e.inv=2;e.dir=1;score+=300;kills++;return true;}
    e.dead=1;e.z=0;e.state='dead';clearEnemyHazards(e.id);score+=e.boss?2000:250;kills++;
    if(e.boss&&e.type==='sable'&&e.phase===2){mission.total=4;createObjective('gate','FINAL SPILLWAY RELEASE',level.length-250,354,0,true);}
    if(!e.boss&&e.type==='gunner')drops.push({x:e.x,y:e.y,type:levelIndex>2?'uzi':'gun',life:60});
    else if(!e.boss&&e.type==='knifer')drops.push({x:e.x,y:e.y,type:'knife',life:60});
    else if(!e.boss&&Math.random()<.2)drops.push({x:e.x,y:e.y,type:'food',life:60});
  }
  return true;
}

function damagePlayer(amount,fromX,ignoreAir=false) {
  if(player.inv>0||(!ignoreAir&&player.z>28)||player.special>0||player.boost>0)return;
  player.hp-=amount*(difficulty==='story'?.7:1);player.hurt=amount>=20?.85:.3;player.knocked=amount>=20;
  player.inv=amount>=20?1.25:.65;player.x+=fromX<player.x?23:-23;player.attack=0;player.pendingStrike=null;player.z=0;player.vz=0;combo=0;comboTimer=0;
  player.burst=null;if(player.knocked)dropWeapon();shake=6;flash=.06;sfx('hurt');burst(player.x,player.y-45,'#eea575',8);
  if(player.hp<=0){lives--;if(lives>0){player.hp=player.maxhp;player.inv=3;player.hurt=0;player.knocked=false;dropWeapon();toast=`${lives} LIVES REMAINING`;toastTime=3;checkpoint();}else gameover();}
}

function shoot(x,y,dir,friendly=true,damage=18,speed=620,owner=null){bullets.push({x,y,owner,z:level.drive?28:48,vx:dir*speed,vy:0,friendly,damage,life:1.5,color:friendly?'#fff4af':'#ef8f68'});}
function attack() {
  if(state!=='play'||player.hurt>0||player.attack>0||player.special>0||bossIntro>0)return;
  if(!level.drive&&!player.weapon&&player.z===0&&drops.some(d=>d.type!=='food'&&Math.hypot(d.x-player.x,d.y-player.y)<38)){pickup();player.attack=.2;return;}
  if(level.drive){player.attack=.5;player.attackTotal=.5;player.boost=.5;meleeStrike(155,48,true);sfx('hit');return;}
  if(weaponAttack())return;
  const h=HEROES[selected];player.comboStep=(player.comboStep+1)%3;
  player.attackKind=player.z>8?'air':player.run?'dash':'combo';
  player.attackTotal=player.attackKind==='dash'?.52:player.attackKind==='air'?.45:.3;
  player.attack=player.attackTotal;
  const finish=player.comboStep===2,reach=player.attackKind==='dash'?125:player.attackKind==='air'?108:79;
  player.pendingStrike={t:player.attackKind==='combo'?.095:.08,range:reach,power:h.power*(finish?1.45:1)*(player.attackKind==='combo'?1:1.5),down:finish||player.attackKind!=='combo',active:player.attackKind==='combo'?0:.34,struck:[]};
  if(player.attackKind==='dash'){player.dashVelocity=player.dir*[440,380,330,350][selected];if(selected!==1){player.z=16;player.vz=selected===3?170:140;}}
  sfx('swing');
}

function jump(){if(player.z>0||player.hurt>0)return;if(level.drive){if(player.boostCd<=0){player.boost=1.15;player.boostCd=3;player.inv=1.2;sfx('jump');}return;}player.vz=355;player.z=.1;sfx('jump');}
function special() {
  if(player.specialCd>0||player.hurt>0||bossIntro>0)return;
  player.special=.65;player.specialCd=1.9;player.inv=.8;player.attack=0;player.pendingStrike=null;
  if(!level.drive)dropWeapon();let hits=0;
  for(const e of enemies)if(!e.dead&&e.state!=='flee'&&Math.hypot((e.x-player.x)*.8,e.y-player.y)<140){if(damageEnemy(e,HEROES[selected].power*2.2,Math.sign(e.x-player.x)*46,true))hits++;}
  if(hits&&!level.drive)player.hp=Math.max(1,player.hp-8);
  for(const o of objects)if(o.hp>0&&Math.abs(o.x-player.x)<115&&Math.abs(o.y-player.y)<65)breakObject(o,99);
  damageObjective(HEROES[selected].power*2.2,player.x,player.y,140,player.dir);
  sfx('special');shake=6;burst(player.x,player.y-40,HEROES[selected].color,22);
}

function pickup() {
  if(player.hurt>0||player.z>0)return;
  if(interactMission(true)||level.drive)return;
  let nearest=null,dist=58;
  for(const d of drops){const dd=Math.hypot(d.x-player.x,(d.y-player.y)*1.2);if(dd<dist){dist=dd;nearest=d;}}
  if(nearest){
    if(nearest.type==='food'){player.hp=Math.min(player.maxhp,player.hp+45);popup(player.x,player.y-96,'+45 HEALTH','#d5ec69');}
    else{dropWeapon();player.attack=0;player.attackKind='ready';player.dashVelocity=0;player.weapon=nearest.type==='grenade'?'grenade':nearest.type;player.ammo=nearest.ammo??WEAPONS[player.weapon]?.ammo??1;toast=`${WEAPONS[player.weapon]?.name||player.weapon} · ${player.ammo} ${WEAPONS[player.weapon]?.melee?'HITS':'SHOTS'}`;toastTime=2;}
    drops.splice(drops.indexOf(nearest),1);sfx('pickup');score+=75;return;
  }
  if(player.weapon){bullets.push({x:player.x,y:player.y,z:45,vx:player.dir*400,vy:0,friendly:true,damage:42,life:1.3,kind:'thrown',weapon:player.weapon,age:0});player.weapon=null;player.ammo=0;sfx('swing');}
}

function bossMove(e) {
  const patterns={warden:['jab','charge','slam'],truck:['volley','charge','bombard'],raptor:['charge','leap','charge'],cinder:['cleave','charge','fire'],echo:['volley','leap','summon'],sable:e.phase===2?['slam','flood','volley','charge']:['volley','jab','summon']};
  e.action=patterns[e.type][e.attackNo++%patterns[e.type].length];e.state='windup';e.timer=['charge','leap'].includes(e.action)?.85:.72;
  e.dir=Math.sign(player.x-e.x)||-1;e.targetX=player.x;e.targetY=player.y;e.startX=e.x;e.startY=e.y;
  if(e.action==='flood'){for(const offset of [-95,0,95])zones.push({owner:e.id,x:player.x+offset,y:player.y,r:58,t:1.25,total:1.25,friendly:false,damage:30,air:false,style:'flood'});e.timer=1.25;}
  if(['slam','pulse','acid','cleave','fire','bombard'].includes(e.action)){
    const x=e.action==='cleave'?e.x+e.dir*72:e.action==='fire'?e.x+e.dir*130:player.x;
    zones.push({owner:e.id,x,y:e.action==='cleave'?e.y:player.y,r:e.action==='slam'?112:e.action==='fire'?95:75,t:e.timer,total:e.timer,friendly:false,damage:e.phase===2?32:24,air:e.action!=='acid',style:e.action});
  }
  toast={flood:'CHANGE LANES · SPILLWAY SURGE',charge:'SIDESTEP THE CHARGE',leap:'MOVE AWAY FROM THE LANDING',slam:'JUMP THE SHOCKWAVE',cleave:'BACK AWAY FROM THE CLEAVE',acid:'LEAVE THE MARKED AREA',spines:'CHANGE LANES',volley:'CHANGE LANES',fire:'JUMP OR STEP ASIDE',pulse:'JUMP THE PULSE',summon:'REINFORCEMENTS INCOMING',jab:'DODGE THE COMBO',bombard:'KEEP MOVING'}[e.action];toastTime=1.3;
}

function executeBoss(e) {
  e.strikeFlash=.23;
  if(e.action==='volley'||e.action==='spines')for(let j=-1;j<=1;j++){shoot(e.x+e.dir*35,e.y+j*32,e.dir,false,20,330,e.id);}
  if(e.action==='charge'){e.state='charge';e.timer=.65;e.vx=e.dir*(e.type==='truck'?420:450);return;}
  if(e.action==='leap'){e.state='leap';e.timer=.85;e.startX=e.x;e.startY=e.y;return;}
  if(e.action==='jab'&&Math.abs(player.x-e.x)<115&&Math.abs(player.y-e.y)<39)damagePlayer(24,e.x);
  if(e.action==='summon'&&enemies.filter(v=>!v.dead&&!v.boss).length<2){spawnEnemy(e.x-100,310,'knifer');spawnEnemy(e.x+70,382,'gunner');}
  e.state='recover';e.timer=e.type==='sable'&&e.phase===2?.7:1.1;
}

function updateEnemy(e,dt) {
  e.anim+=dt;e.strikeFlash=Math.max(0,(e.strikeFlash||0)-dt);e.moving=false;e.hurt=Math.max(0,e.hurt-dt);e.inv=Math.max(0,e.inv-dt);e.hitTimer=Math.max(0,e.hitTimer-dt);e.timer-=dt;
  if(e.dead){e.dead-=dt;if(e.dead<=0)e.remove=true;return;}
  if(e.state==='flee'){e.x+=290*dt;if(e.timer<=0)e.remove=true;return;}
  if(e.state==='down'){if(e.timer<=0){e.state='rise';e.timer=.32;e.inv=Math.max(e.inv,.32);}return;}
  if(['intro','transform','rise','recover'].includes(e.state)){if(e.timer<=0){e.state='walk';e.timer=e.boss?.45:.65;}return;}
  if(e.hurt>0)return;
  if(e.state==='hurt'){if(e.timer<=0){e.state='walk';e.timer=.55;}return;}
  if(e.state==='windup'){
    if(e.timer<=0){if(e.boss)executeBoss(e);else{
      if(['gunner','biker'].includes(e.type))shoot(e.x+e.dir*25,e.y,e.dir,false,14,340,e.id);
      else if(e.action==='knife'){bullets.push({x:e.x+e.dir*30,y:e.y,z:48,vx:e.dir*330,vy:0,friendly:false,damage:17,owner:e.id,life:1.5,kind:'thrown',weapon:'knife',age:0});}
      else if(e.action==='rush'){e.state='charge';e.timer=.55;e.vx=e.dir*300;return;}
      else if(Math.abs(e.x-player.x)<85&&Math.abs(e.y-player.y)<35)damagePlayer(e.type==='brute'||e.type==='mutant'?24:14,e.x);
      e.state='recover';e.timer=e.type==='brute'?.8:.5;
    }}return;
  }
  if(e.state==='leap'){
    const p=clamp(1-e.timer/.85,0,1);e.x=e.startX+(e.targetX-e.startX)*p;e.y=e.startY+(e.targetY-e.startY)*p;e.z=Math.sin(p*Math.PI)*120;
    if(e.timer<=0){e.z=0;zones.push({owner:e.id,x:e.x,y:e.y,r:90,t:.12,total:.12,friendly:false,damage:28,air:true});e.state='recover';e.timer=1.3;}return;
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
  e.moving=distance>range-8||Math.abs(e.y-targetY)>2;
  if(distance>range-8)e.x+=e.dir*speed*dt;
  e.y=approach(e.y,targetY,speed*.6*dt);
  if(e.type==='gunner'&&distance<145){e.x-=e.dir*speed*.7*dt;e.moving=true;}
  if(!e.boss&&e.timer<=0&&dy<32&&((e.type==='brute'&&distance>95&&distance<250)||(e.type==='knifer'&&distance>115&&distance<280))){e.action=e.type==='brute'?'rush':'knife';e.state='windup';e.timer=e.type==='brute'?.75:.6;return;}
  if(e.timer<=0&&distance<range+25&&dy<(e.boss?130:32)){if(e.boss)bossMove(e);else{e.action='melee';e.state='windup';e.timer=e.type==='brute'?.62:.38;}}
  if(lock)e.x=clamp(e.x,lock.left+28,lock.right-42);e.y=clamp(e.y,284,393);
}

function gamepad(){const pads=navigator.getGamepads?.()||[];const p=Array.from(pads).find(Boolean);if(!p){padKeys.clear();return;}const map=['KeyK','KeyE','KeyJ','KeyL'];for(let i=0;i<4;i++){if(p.buttons[i]?.pressed){if(!padKeys.has(map[i]))pressed.add(map[i]);padKeys.add(map[i]);}else padKeys.delete(map[i]);}for(const [key,on] of [['ArrowLeft',p.axes[0]<-.3||p.buttons[14]?.pressed],['ArrowRight',p.axes[0]>.3||p.buttons[15]?.pressed],['ArrowUp',p.axes[1]<-.3||p.buttons[12]?.pressed],['ArrowDown',p.axes[1]>.3||p.buttons[13]?.pressed]]){if(on)padKeys.add(key);else padKeys.delete(key);}if(p.buttons[9]?.pressed&&!gamepad.pauseHeld)pause();gamepad.pauseHeld=p.buttons[9]?.pressed;}
const down=(...ks)=>ks.some(k=>keys.has(k)||padKeys.has(k)),tap=(...ks)=>ks.some(k=>pressed.has(k));
function update(dt) {
  time+=dt;music(dt);if(state!=='play'){pressed.clear();return;}gamepad();if(state!=='play')return;
  if(hitstop>0){hitstop-=dt;return;}
  stageTimer+=dt;runTime+=dt;const h=HEROES[selected];player.anim+=dt;bossIntro=Math.max(0,bossIntro-dt);if(!down(dashKey))dashTime=0;
  for(const k of ['inv','hurt','attack','special','specialCd','boost','boostCd'])player[k]=Math.max(0,player[k]-dt);
  player.recoil=approach(player.recoil||0,0,30*dt);if(player.hurt<=0)player.knocked=false;
  let dx=(down('ArrowRight','KeyD')?1:0)-(down('ArrowLeft','KeyA')?1:0),dy=(down('ArrowDown','KeyS')?1:0)-(down('ArrowUp','KeyW')?1:0);
  player.run=(!!dx||!!dy)&&(down('ShiftLeft','ShiftRight')||(dashTime>0&&down(dashKey)));player.move=!!(dx||dy);
  if(dx&&player.attack<=0)player.dir=dx;
  if(player.hurt<=0&&player.special<=0&&bossIntro<=0){
    const speed=level.drive?205:h.speed*(player.run?1.68:1);const drag=player.attack>0&&player.z<=0&&!level.drive?0:1;
    player.x+=(dx*speed*drag+(level.drive&&dx>=0?105*(player.boost>0?2.5:1):0))*dt;player.y+=dy*speed*.64*drag*dt;
    if(dx&&dy){player.x-=dx*speed*drag*dt*.22;player.y-=dy*speed*.64*drag*dt*.22;}
    if(player.attack>0&&player.attackKind==='dash'){player.x+=(player.dashVelocity||0)*dt;player.dashVelocity=approach(player.dashVelocity,0,600*dt);}
  }
  player.x=clamp(player.x,lock?lock.left+30:camera+25,lock?lock.right-70:level.length+130);player.y=clamp(player.y,284,393);
  if(player.z>0){player.vz-=850*dt;player.z+=player.vz*dt;if(player.z<=0){player.z=0;player.vz=0;if(player.attackKind==='air'){player.attack=0;player.pendingStrike=null;}burst(player.x,player.y,'#8b9470',4);}}
  if(player.weapon)player.pendingStrike=null;
  if(player.pendingStrike){const hit=player.pendingStrike;hit.t-=dt;if(hit.t<=0){meleeStrike(hit.range,hit.power,hit.down,hit.struck);hit.active-=dt;if(hit.active<=0)player.pendingStrike=null;}}
  if(tap('KeyJ','KeyZ','Space')&&tap('KeyK','KeyX'))special();
  else{if(down('KeyJ','KeyZ','Space'))attack();if(tap('KeyK','KeyX'))jump();}
  if(tap('KeyL','KeyC'))special();if(tap('KeyE','KeyV'))pickup();
  updateBurst(dt);updateMission(dt);
  for(const d of [...drops]){d.life-=dt;if(d.type==='food'&&Math.hypot(d.x-player.x,d.y-player.y)<27){player.hp=Math.min(player.maxhp,player.hp+45);popup(player.x,player.y-90,'+45 HEALTH','#d5ec69');drops.splice(drops.indexOf(d),1);sfx('pickup');}else if(d.life<=0)drops.splice(drops.indexOf(d),1);}
  for(const e of enemies)updateEnemy(e,dt);enemies=enemies.filter(e=>!e.remove);
  if(level.drive)for(const e of enemies)if(!e.dead&&Math.abs(e.x-player.x)<98&&Math.abs(e.y-player.y)<29&&e.state!=='intro')damageEnemy(e,player.boost>0?28:13,25,true);
  updateProjectiles(dt);
  for(const z of zones){if(z.cancelled)continue;z.t-=dt;if(z.t<=0){burst(z.x,z.y-20,z.friendly?'#efb36d':'#c7ea91',24);effects.push({x:z.x,y:z.y,age:0,life:.55,type:'explosion'});shake=7;if(z.friendly){for(const e of enemies)if(Math.hypot((e.x-z.x)*.8,e.y-z.y)<z.r)damageEnemy(e,z.damage,Math.sign(e.x-z.x)*35,true);}else if(Math.hypot((player.x-z.x)*.8,player.y-z.y)<z.r&&(!z.air||player.z<25))damagePlayer(z.damage,z.x,!z.air);}}
  zones=zones.filter(z=>!z.cancelled&&z.t>0);
  // Foundry vents and lab discharges announce their location before activating.
  if(!bossSpawned&&lock&&wave>=3&&(levelIndex===3||levelIndex===4)&&!(levelIndex===3&&!mission.active)&&Math.floor(stageTimer/9)>Math.floor((stageTimer-dt)/9))zones.push({x:player.x+90,y:levelIndex===3?370:300,r:58,t:1.25,total:1.25,friendly:false,damage:18,air:true,style:'vent'});
  for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=320*dt;p.life-=dt;}particles=particles.filter(p=>p.life>0);
  for(const f of floating){f.y-=30*dt;f.life-=dt;}floating=floating.filter(f=>f.life>0);
  if(comboTimer>0){comboTimer-=dt;if(comboTimer<=0)combo=0;}toastTime=Math.max(0,toastTime-dt);shake=Math.max(0,shake-dt*22);flash=Math.max(0,flash-dt);
  if(lock&&enemies.length===0&&!mission.active){lock=null;toast=bossSpawned?'PATH TO EDEN IS CLEAR':'GO →';toastTime=2.5;if(bossSpawned){stageClear();return;}drops.push({x:player.x+90,y:player.y,type:wave%2?'food':'grenade',life:75});score+=500;}
  if(!lock&&!bossSpawned&&wave<6&&player.x>390+wave*555)spawnWave(wave+1);
  if(!lock&&wave>=6&&!bossSpawned&&mission.completed>=3&&player.x>level.length-450)spawnBoss();
  const target=clamp(player.x-255,0,level.length-W+180);camera=approach(camera,target,500*dt);pressed.clear();
}

function rect(g,x,y,w,h,c){g.fillStyle=c;g.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
function poly(g,pts,c){g.fillStyle=c;g.beginPath();pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fill();}
function noise(n){return Math.abs(Math.sin(n*127.1+311.7)*43758.5453)%1;}
function tree(g,x,y,s=1,theme='jungle'){g.save();g.translate(Math.round(x),y);g.scale(s,s);rect(g,-9,-138,19,145,'#26382e');rect(g,1,-127,7,132,'#48543a');poly(g,[[-3,-130],[-36,-183],[-20,-188],[10,-125]],'#344537');const colors=theme==='harbor'?['#315e42','#497c4b','#6c8e53']:['#274a35','#3b6140','#577444','#6f8a50'];for(let k=0;k<30;k++){const xx=(noise(k+x)-.5)*135,yy=-130-noise(k*8+x)*70;rect(g,xx,yy,24+noise(k+4)*25,10+noise(k+7)*18,colors[k%4]);}for(let k=0;k<6;k++)rect(g,-3+k*2,-185+k*12,3,11,'#6c8447');g.restore();}
function building(g,x,y,w,h,seed=1){rect(g,x,y-h,w,h,'#334a48');rect(g,x+5,y-h+3,w-9,h-3,'#425b54');rect(g,x+w-15,y-h+3,14,h,'#2c403d');for(let yy=y-h+12;yy<y-8;yy+=17)for(let xx=x+9;xx<x+w-18;xx+=17){rect(g,xx,yy,8,11,noise(xx+yy+seed)>.7?'#8e9d71':'#243e3d');rect(g,xx,yy,8,2,'#607c69');}for(let j=0;j<7;j++){const xx=x+noise(j+seed)*w;rect(g,xx,y-h+noise(j+8)*h,4,30,'#607847');}poly(g,[[x,y-h],[x+12,y-h-8],[x+w-9,y-h-8],[x+w,y-h]],'#62766a');}
function background(g,idx,cam,t){SEQUEL_RENDER.scene(g,idx,cam,t);}
function drawFrame(g,f,x,y,scale=1.35,dir=1,filter='none'){if(!f||!sheet.complete)return;g.save();g.imageSmoothingEnabled=false;g.translate(Math.round(x),Math.round(y));g.scale(-dir*scale,scale);g.filter=filter;g.drawImage(sheet,f.x,f.y,f.w,f.h,-f.anchor,-f.h,f.w,f.h);g.restore();}
function shadow(g,x,y,w=25){g.fillStyle='#10271b66';g.beginPath();g.ellipse(x,y,w,6,0,0,Math.PI*2);g.fill();}
function drawDino(g,x,y,s,dir,color='#849955',mutant=false,t=0){g.save();g.translate(Math.round(x),Math.round(y));g.scale(dir*s,s);const leg=Math.sin(t*10)*7;poly(g,[[-77,-30],[-127,-18],[-112,-10],[-51,-13],[-13,8],[31,-4],[36,-53],[73,-77],[90,-104],[45,-112],[29,-104],[15,-86],[-6,-65],[-38,-55]],'#20382d');poly(g,[[-74,-29],[-119,-17],[-49,-24],[-17,0],[25,-6],[28,-56],[71,-83],[83,-101],[45,-106],[32,-98],[19,-78],[-9,-61],[-37,-50]],color);poly(g,[[-39,-48],[-20,-57],[11,-57],[22,-39],[11,-12],[-16,-6]],mutant?'#c6d1af':'#adba75');poly(g,[[17,-65],[38,-69],[42,-59],[26,-53],[25,-34],[15,-37]],'#cad391');poly(g,[[42,-97],[78,-99],[88,-91],[43,-83]],'#2c4132');for(let j=0;j<5;j++)poly(g,[[47+j*7,-96],[50+j*7,-88],[53+j*7,-96]],'#e6e7c7');rect(g,54,-105,8,5,mutant?'#ef9360':'#ecdb77');rect(g,56,-105,3,5,'#162f23');poly(g,[[-6,-9],[-12+leg,12],[-31+leg,24],[-4+leg,24],[14,-1]],'#4d633a');poly(g,[[15,-2],[27-leg,15],[8-leg,24],[37-leg,24],[37,-9]],color);rect(g,-31+leg,21,29,4,'#ddd8ad');rect(g,8-leg,21,29,4,'#ddd8ad');if(mutant){for(let j=0;j<5;j++)poly(g,[[-39+j*15,-49+j*2],[-32+j*15,-70+j*2],[-23+j*15,-50+j*2]],'#d3dfb9');for(let j=0;j<3;j++)rect(g,-30+j*12,-32,5,8,'#90d88b');}g.restore();}
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
function car(g,x,y,scale=1,boost=false,t=0){g.save();g.translate(x,y);g.scale(scale,scale);shadow(g,0,4,72);poly(g,[[-77,-31],[-57,-53],[-27,-59],[26,-57],[45,-39],[78,-34],[87,-11],[75,-3],[-73,-3],[-86,-11]],'#1b3029');poly(g,[[-78,-29],[-51,-46],[39,-42],[77,-30],[82,-13],[-79,-13]],'#78ac79');poly(g,[[-39,-53],[-24,-57],[23,-55],[35,-43],[-48,-44]],'#d7d1a0');poly(g,[[-37,-52],[-24,-54],[-5,-54],[-5,-43],[-46,-44]],'#315653');poly(g,[[0,-54],[23,-52],[32,-43],[0,-43]],'#315653');rect(g,-75,-26,150,5,'#a8c394');rect(g,-64,-13,127,5,'#496e51');rect(g,69,-25,13,8,'#fff1bd');rect(g,-81,-23,7,8,'#d4945e');rect(g,-86,-11,171,4,'#ddd7ae');for(const xx of [-48,50]){g.fillStyle='#17231e';g.beginPath();g.arc(xx,-3,16,0,Math.PI*2);g.fill();g.fillStyle='#829a83';g.beginPath();g.arc(xx,-3,9,0,Math.PI*2);g.fill();rect(g,xx-2,-9,4,12,'#c4c9a6');rect(g,xx-6,-5,12,4,'#c4c9a6');}rect(g,3,-27,13,3,'#d4daba');rect(g,22,-22,15,2,'#314e3d');if(boost){poly(g,[[-85,-17],[-124-Math.sin(t*20)*18,-4],[-105,-20],[-137,-27],[-84,-23]],'#eaaa56');poly(g,[[-85,-17],[-117,-11],[-104,-23],[-84,-21]],'#e9df91');}g.restore();}
function truck(g,e,x,y){g.save();g.translate(x,y);shadow(g,0,5,110);rect(g,-92,-96,123,79,'#46564b');rect(g,-89,-91,118,11,'#728069');rect(g,-84,-74,105,47,'#2c4037');for(let j=0;j<5;j++)rect(g,-80+j*21,-69,3,40,'#687958');poly(g,[[25,-68],[66,-68],[94,-47],[106,-25],[100,-8],[23,-8]],'#7d8662');rect(g,34,-62,31,23,'#263e38');rect(g,73,-40,23,11,'#c6c59a');rect(g,26,-25,73,8,'#425b44');rect(g,-97,-13,202,7,'#bbc29c');for(const xx of [-62,64]){g.fillStyle='#192f25';g.beginPath();g.arc(xx,-7,22,0,Math.PI*2);g.fill();g.fillStyle='#91a27b';g.beginPath();g.arc(xx,-7,11,0,Math.PI*2);g.fill();}rect(g,-25,-113,43,13,'#596c54');rect(g,-57,-109,36,7,'#a8b28a');g.restore();}
function drawFighter(e) {
  const x=e.x-camera,y=e.y-e.z;ctx.save();shadow(ctx,x,e.y,e.boss?42:25);
  if(e.dead)ctx.globalAlpha=clamp(e.dead/.75,0,1);
  const name=e.type==='warden'?'echo':e.type==='cinder'?'brute':e.type==='raptor'&&e.boss?'thornmaw':e.type==='raptor'&&e.state==='flee'?'calmraptor':e.type==='sable'?'gunner':e.type==='biker'?'knifer':e.type;
  if(e.type==='sable'&&e.phase===2)drawCrownEngine(ctx,e,x,y);
  else if(e.type==='truck')truck(ctx,e,x,y);
  else if(e.boss&&SEQUEL_RENDER.boss(ctx,e,x,y)){}
  else {
    const data=COMBAT_ART.groups[name]||COMBAT_ART.groups.raider;
    const action=e.dead||e.state==='down'?'down':e.hurt>0?'hurt':['windup','charge','leap'].includes(e.state)?'attack':e.state==='rise'?'rise':'walk';
    const seq=data[action]||data.walk;const n=seq[action==='rise'?Math.min(seq.length-1,Math.floor((.32-e.timer)/.32*seq.length)):action==='walk'&&!e.moving?0:Math.floor(e.anim*(action==='walk'?8:5))%seq.length];
    const f=COMBAT_ART.frames[n];const scale=e.boss?(e.type==='sable'&&e.phase===2?1.9:e.type==='raptor'?1.25:1.65):e.type==='raptor'?1.1:1.3;
    let filter=e.type==='sable'&&e.phase===2?'saturate(.3) brightness(1.45)':e.type==='echo'?'hue-rotate(100deg)':e.type==='cinder'?'hue-rotate(325deg)':e.type==='warden'?'hue-rotate(335deg)':'none';
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

const heroSheet=new Image();heroSheet.src=HERO_ART.sheet;
const FIREARMS=new Set(['gun','uzi','shotgun','rifle','m16','bazooka']);
function heroActionFrame(action,index=0){const data=HERO_ART[HEROES[selected].id],seq=data[action];return HERO_ART.frames[seq[index%seq.length]];}
function drawHeroAction(g,f,x,y,scale,dir){if(!heroSheet.complete)return;g.save();g.translate(Math.round(x),Math.round(y));g.scale(-dir*scale,scale);g.drawImage(heroSheet,f.x,f.y,f.w,f.h,-f.anchor,-f.h,f.w,f.h);g.restore();}
function gunMount(recoil=false){
  const f=heroActionFrame(recoil?'recoil':'aim'),grips=recoil?{jack:[9,4],hannah:[24,23],mustapha:[8,9],mess:[10,8]}:{jack:[7,16],hannah:[24,24],mustapha:[13,21],mess:[11,17]},grip=grips[HEROES[selected].id];
  return {x:(f.anchor-grip[0])*1.35,y:(f.h-grip[1])*1.35};
}
function drawPlayer() {
  const x=player.x-camera,y=player.y-player.z;ctx.save();shadow(ctx,x,player.y,level.drive?72:27);
  if(player.inv>0&&Math.floor(time*16)%2===0)ctx.globalAlpha=.65;
  player.pose='idle';
  if(level.drive){player.pose='driving';car(ctx,x,y,1,player.boost>0||player.special>0,time);}
  else {
    const data=A[HEROES[selected].id],armed=FIREARMS.has(player.weapon);
    if(armed&&player.hurt<=0&&player.special<=0){
      // Firing uses a complete aiming/recoil pose; walking keeps the original full-body stride.
      const recoiling=player.attack>0&&player.attackKind==='fire'&&player.attack/player.attackTotal>.78&&player.recoil>0,aim=heroActionFrame(recoiling?'recoil':'aim'),mount=gunMount(recoiling),recoil=player.recoil||0;
      player.pose=player.attack>0&&player.attackKind==='fire'?'fire':player.move?'armed-walk':'armed-ready';
      if(player.move&&player.attack<=0&&player.z===0){
        const walk=data.frames[data.walk[Math.floor(player.anim*(player.run?16:10))%data.walk.length]];
        drawFrame(ctx,walk,x,y,1.35,player.dir);
        weaponSprite(ctx,player.weapon,x+player.dir*(19+Math.sin(player.anim*10)*3),y-46,1.12,player.dir,.4*player.dir);
      }else {
        drawHeroAction(ctx,aim,x,y,1.35,player.dir);
        weaponSprite(ctx,player.weapon,x+player.dir*(mount.x-recoil*.2),y-mount.y,1.12,player.dir,recoiling?-.32*player.dir:0);
      }
    }else {
      let anim=player.special>0?'special':player.hurt>0?'hurt':player.attack>0&&player.attackKind!=='ready'?'attack':player.z>0?'jump':player.move?'walk':'idle';
      let list=data[anim],frame=player.attack>0&&anim==='attack'?Math.floor((1-player.attack/player.attackTotal)*list.length):player.special>0?Math.floor((.65-player.special)*18):Math.floor(player.anim*(anim==='walk'?player.run?16:10:6));
      let chosen=list[frame%list.length];player.pose=anim;
      if(player.knocked&&player.hurt>0){ctx.save();ctx.translate(x,y-10);ctx.rotate(-player.dir*1.2);drawFrame(ctx,data.frames[data.hurt[0]],0,0,1.35,player.dir);ctx.restore();}
      else if(anim==='attack'&&['dash','air'].includes(player.attackKind)){player.pose=player.attackKind;drawHeroAction(ctx,heroActionFrame(player.attackKind),x,y,1.35,player.dir);}
      else if(anim==='walk'&&player.run){player.pose='run';drawHeroAction(ctx,heroActionFrame('run',Math.floor(player.anim*14)),x,y,1.35,player.dir);}
      else drawFrame(ctx,data.frames[chosen],x,y,1.35,player.dir);
      if(player.weapon&&player.hurt<=0){const melee=WEAPONS[player.weapon]?.melee;const swing=melee&&player.attack>0?Math.sin((1-player.attack/player.attackTotal)*Math.PI)*-1.7*player.dir:0;weaponSprite(ctx,player.weapon,x+player.dir*32,y-56,1.12,player.dir,swing);}
    }
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
 const b=enemies.find(e=>e.boss&&!e.dead);if(b){rect(ctx,193,H-41,382,24,'#0e231bdd');rect(ctx,203,H-30,362,7,'#384a35');rect(ctx,204,H-29,360*Math.max(0,b.hp/b.maxhp),5,b.phase===2?'#d5ec69':'#e9a56b');label(b.type==='sable'&&b.phase===2?'SABLE / CROWN ENGINE':level.boss,W/2,H-35,10,'#efdfb8','center');}
 else{rect(ctx,18,H-19,130,3,'#2c4534');rect(ctx,18,H-19,130*clamp(player.x/level.length,0,1),3,'#9aad6b');label('CHAPTER 0'+(levelIndex+1),18,H-25,9,'#b8c59d');}
 if(combo>=2){label(combo+' HIT',W-22,102,27,'#d5ec69','right');label('COMBO',W-25,116,10,'#b7c69c','right');}
 if(toastTime>0){rect(ctx,W/2-250,78,500,25,'#153023dc');label(toast,W/2,95,11,'#e0e8a8','center');}
 if(player.specialCd>0){label('SPECIAL '+Math.ceil(player.specialCd)+'s',18,112,10,'#a6b797');}else label(level.drive?'L · RAM READY':'L · '+h.special.toUpperCase(),18,112,9,'#d5ec69');}
function render(){ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,W,H);ctx.save();if(shake>0)ctx.translate(rand(-shake,shake),rand(-shake/2,shake/2));
 if(!started||['menu','select','chapters','credits'].includes(state)){background(ctx,0,time*9,time);rect(ctx,0,0,W,H,'#0a221ec0');car(ctx,125,415,1.1,false,time);HEROES.forEach((h,i)=>{drawFrame(ctx,A[h.id].frames[0],340+i*90,424,1.1,1);});rect(ctx,0,0,W,H,'#05131030');}
 else{background(ctx,levelIndex,camera,time);for(const z of zones){const x=z.x-camera;ctx.fillStyle=z.style==='flood'?'#5bbfda55':z.friendly?'#efb36638':'#e77d5a30';ctx.beginPath();ctx.ellipse(x,z.y,z.r,z.r*.4,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=z.style==='flood'?'#8fe4ed':z.friendly?'#e8bd76':'#efa36b';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,z.y,z.r*(z.t/z.total),z.r*.4*(z.t/z.total),0,0,Math.PI*2);ctx.stroke();}
 const draws=[...objects.filter(o=>o.hp>0).map(o=>({y:o.y,fn:()=>drawObject(o)})),...drops.map(d=>({y:d.y,fn:()=>drawDrop(d)})),...enemies.map(e=>({y:e.y,fn:()=>drawFighter(e)})),{y:player.y,fn:drawPlayer}];for(const item of mission?.items||[])draws.push({y:item.y,fn:()=>drawMissionItem(item)});draws.sort((a,b)=>a.y-b.y);draws.forEach(d=>d.fn());drawEffects();for(const p of particles)rect(ctx,p.x-camera,p.y,p.size,p.size,p.color);for(const f of floating)label(f.text,f.x-camera,f.y,12,f.color,'center');hud();missionHud();
 if(lock&&!bossSpawned){label(enemies.length?'CLEAR THE AREA':'COMPLETE THE OBJECTIVE',W/2,123,9,'#d4cf9e','center');}else if(!bossSpawned&&toastTime<=0){label('GO →',W-38,220,19,'#d5ec69','right');}if(state!=='play')rect(ctx,0,0,W,H,'#0b1a1688');}
 if(flash>0)rect(ctx,0,0,W,H,`rgba(226,239,170,${Math.min(.5,flash)})`);ctx.restore();}
let accumulator=0;
function frame(now){const elapsed=Math.min(.1,Math.max(0,(now-last)/1000||1/60));last=now;accumulator+=elapsed;while(accumulator>=1/60){update(1/60);accumulator-=1/60;}render();requestAnimationFrame(frame);}
window.addEventListener('keydown',e=>{const use=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyW','KeyA','KeyS','KeyD','KeyJ','KeyK','KeyL','KeyZ','KeyX','KeyC','KeyE','KeyV','ShiftLeft','ShiftRight','Enter','Escape','KeyP'];if(use.includes(e.code)&&(state==='play'||['ArrowLeft','ArrowRight','Enter','Escape','KeyP'].includes(e.code)))e.preventDefault();unlockAudio();if(e.code==='Escape'||e.code==='KeyP'){if(!e.repeat){if(state==='play'||state==='paused')pause();else if(e.code==='Escape'&&['select','chapters','guide','credits','jukebox'].includes(state))menu();}return;}if(!e.repeat&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyS'].includes(e.code)){const now=performance.now()/1000;if(lastDirection.key===e.code&&now-lastDirection.time<.28){dashTime=1.6;dashKey=e.code;}lastDirection={key:e.code,time:now};}if(!keys.has(e.code))pressed.add(e.code);keys.add(e.code);if(e.code==='Enter'&&!e.repeat){if(state==='menu')characterSelect();else if(state==='select')document.getElementById('begin')?.click();else if(state==='brief')document.getElementById('enter-stage')?.click();else if(state==='clear')document.getElementById('next')?.click();else if(state==='gameover')document.getElementById('retry')?.click();}if(state==='select'&&!e.repeat&&['ArrowLeft','ArrowRight'].includes(e.code)){selected=(selected+(e.code==='ArrowRight'?1:3))%4;characterSelect();}});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{resetInput();if(state==='play')pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='play')pause();});
document.querySelectorAll('[data-key]').forEach(b=>{const k=b.dataset.key;const release=()=>{keys.delete(k);touchKeys.delete(k);};b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);unlockAudio();if(!keys.has(k))pressed.add(k);keys.add(k);touchKeys.add(k);});b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);});
bindButton('pause',pause);bindButton('home',()=>{if(state==='play')pause();else menu();});bindButton('sound',()=>{const on=settings.music||settings.sfx;settings.music=!on;settings.sfx=!on;document.querySelector('#sound').textContent=on?'SOUND OFF':'SOUND ON';persist();});document.querySelector('#sound').textContent=settings.music||settings.sfx?'SOUND ON':'SOUND OFF';bindButton('full',()=>{if(document.fullscreenElement)document.exitFullscreen();else document.querySelector(matchMedia('(pointer:coarse)').matches?'.cabinet':'.game-shell').requestFullscreen?.().catch(()=>{});});
// A narrow, explicit test interface keeps campaign checks reproducible.
window.LAST_EDEN={render, get state(){return state;},get snapshot(){return {mission:mission?{completed:mission.completed,total:mission.total,active:mission.active?{...mission.active}:null}:null,artReady:SEQUEL_RENDER.ready,state,level:levelIndex,wave,score,lives,section,lock:lock?{...lock}:null,bullets:bullets.map(b=>({...b})),zones:zones.map(z=>({...z})),audio:soundtrack.status,player:player?{...player}:null,enemies:enemies.map(e=>({...e})),objects:objects.map(o=>({...o})),drops:drops.map(d=>({...d})),unlocked:save.unlocked};},start:(i=0,hero=0,mode='story')=>{selected=clamp(hero,0,3);difficulty=mode;score=0;lives=3;startStage(clamp(i,0,5),true);},step:(dt=1/60)=>update(dt),controls:{attack,jump,special,pickup},test:{damageObjective:n=>damageObjective(n,mission.active?.x,mission.active?.y,100,1),completeObjective,equip:(type,ammo)=>{player.pendingStrike=null;player.attack=0;player.weapon=type;player.ammo=ammo??WEAPONS[type].ammo;},spawnEnemy,drop:(type,x,y)=>drops.push({type,x,y,life:90}),move:(x,y)=>{player.x=x;player.y=y;},damageEnemy:(i,n)=>damageEnemy(enemies[i],n),damagePlayer:n=>damagePlayer(n,player.x-40),finishEncounter:()=>{completeObjective();enemies.forEach(e=>{e.inv=0;damageEnemy(e,9999);if(e.phase===2&&e.hp>0){e.inv=0;damageEnemy(e,9999);}});completeObjective();},spawnBoss,clear:stageClear}};
sheet.onload=()=>{if(state==='select')characterSelect();};sheet.onerror=()=>panel('<section class="panel small-panel"><h2>ARTWORK COULD NOT LOAD.</h2><p>Keep assets.js, game.js and index.html in the same folder, then open index.html again.</p></section>');menu();requestAnimationFrame(frame);
})();
