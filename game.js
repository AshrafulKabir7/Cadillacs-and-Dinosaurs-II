/* Cadillacs & Dinosaurs II: The Crown Tide — original local fan-game engine. */
(() => {
'use strict';
const canvas=document.querySelector('#game'),ctx=canvas.getContext('2d'),overlay=document.querySelector('#overlay');
// Arcade framing (ARCHITECTURE D1/D2, §1.2): one world unit is one arcade pixel and the view is the 384x224 cabinet
// screen, drawn on the 768x448 canvas through one x2 transform (beginFrame). Every distance and speed below is in arcade
// px and px/s (the canvas-px values of the old 1.35-scale engine divided by 1.35; tools/re/units-audit.cjs lists them).
// LEG scales the code-drawn canvas-px art left (objective props, world labels, easy-mode tells) into world units.
const W=384,H=224,PX=2,LEG=1/1.35;
const HEROES=[
 {id:'mustapha',name:'MUSTAPHA',nickname:'MOSTAFA',tag:'THE FLYING KICK',hp:120,speed:133,power:21,color:'#d5ec69',special:'Tornado kick'},
 {id:'jack',name:'JACK TENREC',nickname:'',tag:'THE ALL-ROUNDER',hp:140,speed:107,power:23,color:'#7dc4de',special:'Dino uppercut'},
 {id:'hannah',name:'HANNAH DUNDEE',nickname:'',tag:'THE SWIFT STRIKER',hp:110,speed:123,power:19,color:'#efaa77',special:'Spiral flash'},
 {id:'mess',name:'MESS O\'BRADOVICH',nickname:'',tag:'THE HEAVY HITTER',hp:170,speed:90,power:29,color:'#b5cc85',special:'Knuckle bomb'}
];
const LEVELS=window.EDEN_CAMPAIGN,CFG=window.COMBAT_CONFIG;
const normalizeDifficulty=k=>CFG.difficulty[k]?k:CFG.aliases[k]||'normal';
const rules=()=>CFG.difficulty[normalizeDifficulty(difficulty)];
// The player's walk, depth and run speeds in px/s: the sequel's table (HEROES[].speed, depth x.64, run x1.68), or with
// CFG.romWalk (HEROES O1, PLAN RC6) the ROM's own (0x50E4 walk/depth, 0x5064 run; ROM_HEROES hero.speed, px/f x60).
function heroV(h){const s=CFG.romWalk&&RIG()?.hero(h.id)?.speed;return s?.walk?{walk:s.walk*60,lane:s.walkDepth*60,run:s.run*60}:{walk:h.speed,lane:h.speed*.64,run:h.speed*1.68};}
const weaponClass=type=>Object.values(CFG.weapons).find(w=>w.types.includes(type));
const SELECT_ORDER=[1,2,0,3];let selectionChapter=0;
// The select screen's portraits (selection-art.js, 119 KB of PNG data) load once the title is up, off the start-up
// budget (ARCHITECTURE §5.3); the select screen paints them as they decode.
let selectionImages={};
function loadSelectionArt(){if(loadSelectionArt.started)return;loadSelectionArt.started=true;
  const build=()=>{selectionImages=Object.fromEntries(Object.entries(window.ARCADE_SELECTION||{}).map(([id,src])=>{const im=new Image();im.onload=()=>{if(state==='select')paintSelection();};im.src=src;return [id,im];}));};
  if(window.ARCADE_SELECTION){build();return;}const sc=document.createElement('script');sc.src='selection-art.js';sc.onload=build;sc.onerror=()=>{loadSelectionArt.started=false;};document.head.appendChild(sc);}
const rand=(a,b)=>a+Math.random()*(b-a),clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),approach=(x,y,s)=>x<y?Math.min(x+s,y):Math.max(x-s,y);
const keys=new Set(),pressed=new Set(),touchKeys=new Set(),padKeys=new Set();
// The input source down()/tap() read (MULTIPLAYER §3.3): this machine's keys, pad and touch (LOCAL_IN), or another
// player's source while the update runs that player (a joiner's frames on the host, a scripted test source).
const LOCAL_IN={keys,pressed,pad:padKeys,touch:touchKeys,local:true};let IN=LOCAL_IN;
const TOUCH=document.documentElement.classList.contains('touch-ui');let stickId=null;
function resetInput(){keys.clear();pressed.clear();touchKeys.clear();padKeys.clear();lastDirection={key:'',time:0};dashKey='';dashTime=0;
  stickId=null;document.querySelectorAll('.touch-controls .held').forEach(b=>b.classList.remove('held'));document.getElementById('stick')?.classList.remove('active','running');const k=document.getElementById('stick-knob');if(k)k.style.transform='';}
let state='menu',selected=0,difficulty='normal',levelIndex=0,level=LEVELS[0],time=0,last=0,camera=0,cameraY=0,viewX=0,shake=0,flash=0,hitstop=0;
let player,enemies=[],allies=[],objects=[],drops=[],particles=[],bullets=[],zones=[],floating=[],wave=0,lock=null,bossSpawned=false,cleared=false,stageTimer=0;
let plan=null,encIndex=0,encounter=null,sectionIndex=-1,driving=false,parkedCar=null,radio=null,radioQueue=[],alliesFreed=0;
let score=0,lives=3,combo=0,comboTimer=0,bestCombo=0,kills=0,runTime=0,toast='',toastTime=0,started=false;
// Free-play coins: a credit is dropped on the continue screen (or any time with Enter) and spent to respawn in place.
let coins=0,continueTimer=0,coinPending=0;
// ---------------------------------------------------------------- 1-3 players (MULTIPLAYER.md §3.2, D-MP7)
// `player` stays "the player being processed": usePlayer(p) swaps it with the per-player globals (hero, score, lives,
// combo, the last foe, the input source, the double-tap state, the hero clips) while the update and the HUD loop over
// players[0..2]. Outside any loop the context is this machine's player (players[localSlot], players[0] in single
// player), so with one player every code path runs exactly as before. NETROLE: 'off' (single player, no network),
// 'host' (the only simulation; joiners' input arrives as frames) or 'client' (a replica that draws the host's snapshots).
const MAXP=3,SLOT_PEN=['#f8d838','#5ab4ff','#ff6a4a'];
let players=[],localSlot=0,NETROLE='off',NID=0,ctxPlayer=null,NPRES=0,lastDriver=null;
const makeInput=()=>({keys:new Set(),pressed:new Set(),pad:new Set(),touch:new Set(),local:false});
// replicated entities carry a counter id (never Math.random), non-enumerable so snapshots keep their shape
function nidOf(o){if(!o)return -1;if(o.nid==null)Object.defineProperty(o,'nid',{value:++NID,writable:true,configurable:true,enumerable:false});return o.nid;}
function freshHeroAnim(){const R=window.HeroRig;return {main:R?R.player():null,legs:R?R.player():null,want:null,flame:null,swing:null,force:null,sel:null};}
function attachMp(p,slot,hero,name){
  Object.defineProperty(p,'mp',{value:{slot,hero,name:String(name||''),score:0,lives:3,combo:0,comboTimer:0,bestCombo:0,lastHitEnemy:null,hudFoe:null,lastHeld:null,
    dashTime:0,dashKey:'',lastDirection:{key:'',time:0},dashTap:0,heroAnim:null,in:null,cont:null,out:false,away:false,tag:0,mx:0,my:0,moved:0},enumerable:false,configurable:true});
  nidOf(p);return p;}
const isP=v=>!!(v&&v.mp);
const isLiveP=v=>isP(v)&&players[v.mp.slot]===v;
function saveCtx(p){const m=p.mp;m.score=score;m.lives=lives;m.combo=combo;m.comboTimer=comboTimer;m.bestCombo=bestCombo;m.lastHitEnemy=lastHitEnemy;m.hudFoe=hudFoe;m.lastHeld=lastHeld;
  m.dashTime=dashTime;m.dashKey=dashKey;m.lastDirection=lastDirection;m.dashTap=dashTap;m.heroAnim=heroAnim;m.in=IN;}
function loadCtx(p){const m=p.mp;player=p;selected=m.hero;score=m.score;lives=m.lives;combo=m.combo;comboTimer=m.comboTimer;bestCombo=m.bestCombo;lastHitEnemy=m.lastHitEnemy;hudFoe=m.hudFoe;
  lastHeld=m.lastHeld;dashTime=m.dashTime;dashKey=m.dashKey;lastDirection=m.lastDirection;dashTap=m.dashTap;heroAnim=m.heroAnim||(m.heroAnim=freshHeroAnim());IN=m.in||LOCAL_IN;ctxPlayer=p;}
function usePlayer(p){if(!p||!p.mp||ctxPlayer===p)return;if(ctxPlayer&&ctxPlayer.mp)saveCtx(ctxPlayer);loadCtx(p);}
function withPlayer(p,fn){if(!p||p===ctxPlayer||!p.mp)return fn();const prev=ctxPlayer;usePlayer(p);try{return fn();}finally{if(prev&&prev.mp)usePlayer(prev);}}
const present=()=>players.filter(Boolean);
const multi=()=>NPRES>1;
function refreshPlayers(){NPRES=players.filter(Boolean).length;}
const localPlayer=()=>players[localSlot]||players.find(Boolean)||player;
// in a continue count, out of credits: not on the field
const onField=p=>!!p&&!p.mp.cont&&!p.mp.out;
// the Cadillac's driver: the lowest slot on the field; everyone else present rides in the back (§3.11)
function driverP(){if(!multi())return player;for(const p of players)if(onField(p))return p;return players.find(Boolean)||player;}
const passenger=p=>driving&&multi()&&p!==driverP();
// who can be hit and fought: on the field, and in the car only the driver (the car takes the hits)
const hitPlayers=()=>driving?[driverP()]:present().filter(onField);
const active=()=>hitPlayers().filter(p=>p.hp>0&&!p.dying&&!p.down);
const camPlayers=()=>{if(driving){const d=driverP();return d?[d]:[];}return present().filter(onField);};
function leadPlayer(){if(!multi())return player;let a=null;for(const p of camPlayers())if(!a||p.x>a.x)a=p;return a||players[0]||player;}
function nearestPlayer(x,y){let best=null,bd=1e9;for(const p of active()){const d=Math.hypot(p.x-x,(p.y-y)*1.4);if(d<bd){bd=d;best=p;}}if(best)return best;for(const p of camPlayers()){const d=Math.abs(p.x-x);if(d<bd){bd=d;best=p;}}return best;}
// the player an enemy fights (§3.5 T): its update runs in that player's context
function targetPlayerOf(e){
  if(!multi())return player;
  if(driving)return driverP();
  if(e.thrown&&e.state==='fly'&&e.byP&&players[e.byP.mp.slot]===e.byP)return e.byP;
  const t=e.tp;if(t&&players[t.mp.slot]===t&&onField(t)&&!(e.boss&&e.state==='walk'))return t;
  if(e.boss){const n=nearestPlayer(e.x,e.y);if(n)e.tp=n;return n||localPlayer();}   // a boss re-chooses between its moves
  hostileTargetMP(e);return e.tp&&players[e.tp.mp.slot]===e.tp?e.tp:localPlayer();
}
// arcade scaling (D-MP9): boss and elite HP x1.20 / x1.46 for 2 / 3 players; one more in the crowd per extra player
const bossScale=()=>NPRES>1?[1,1.2,1.46][Math.min(3,NPRES)-1]:1;
const crowdLimit=()=>rules().crowdLimit+(NPRES>1?NPRES-1:0);
let save={unlocked:0,checkpoint:null,best:0},settings={music:true,sfx:true,aspect:'4:3'};
try{save={...save,...JSON.parse(localStorage.getItem('last-eden-save')||'{}')};settings={...settings,...JSON.parse(localStorage.getItem('last-eden-settings')||'{}')};}catch{}
save.unlocked=clamp(Number(save.unlocked)||0,0,5);
// Display aspect (ARCHITECTURE D3, §1.4): the cabinet's 4:3 by default, square pixels (12:7) as a setting. CSS only; the
// canvas bitmap never changes.
const ASPECTS=['4:3','12:7'];if(!ASPECTS.includes(settings.aspect))settings.aspect='4:3';
function applyAspect(){document.documentElement.classList.toggle('square-pixels',settings.aspect==='12:7');}
applyAspect();
function persist(){try{localStorage.setItem('last-eden-save',JSON.stringify(save));localStorage.setItem('last-eden-settings',JSON.stringify(settings));}catch{}}
// Checkpoints save {area, section} (ARCHITECTURE §2.4); resuming starts the section, which knows its area.
function checkpoint(){if(NETROLE==='client')return;if(multi()&&ctxPlayer!==localPlayer()){withPlayer(localPlayer(),checkpoint);return;}const k=Math.max(0,sectionIndex);save.checkpoint={level:levelIndex,area:plan?.sections?.[k]?.area??0,section:k,hero:selected,difficulty,score,lives};persist();}
let audio;
function unlockAudio(){if(!audio){const AC=window.AudioContext||window.webkitAudioContext;if(AC)audio=new AC();}if(audio?.state==='suspended')audio.resume();soundtrack.unlock();}
function tone(freq,dur=.12,type='square',vol=.04,end){if(!audio)return;const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);if(end)o.frequency.exponentialRampToValueAtTime(Math.max(20,end),audio.currentTime+dur);g.gain.setValueAtTime(vol,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+dur);o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+dur);}
// Original arcade effects, identified by matching each supplied sample against the reference video's audio.
// Synthesized tones remain for everything else and as a fallback.
const SAMPLE_FOR={hit:'punch',heavy:'kick',slam:'slam',gun:'pistol',enemygun:'pistol',rifle:'rifle',shotgun:'rifle',uzi:'uzi',explosion:'explosion'};
const samplePool={};
function sample(name,vol=.85,max=5){
  const pool=samplePool[name]||(samplePool[name]=[]);let a=pool.find(v=>v.paused||v.ended);
  if(!a){if(pool.length>=max)a=pool[0];else{a=new Audio('assets/sfx/'+name+'.mp3');pool.push(a);}}
  try{a.currentTime=0;a.volume=vol;const p=a.play();if(p)p.catch(()=>{});}catch{return null;}
  return a;
}
function sfx(name){if(!settings.sfx)return;unlockAudio();if(name.startsWith('vo:')){playVoice(name.slice(3));return;}if(SAMPLE_FOR[name]&&sample(SAMPLE_FOR[name]==='pistol'&&name==='enemygun'?'pistol':SAMPLE_FOR[name]))return;if(['gun','shotgun','rocket','explosion','swing'].includes(name)&&audio){const dur=name==='explosion'?.55:name==='rocket'?.25:name==='shotgun'?.2:name==='swing'?.07:.09;const b=audio.createBuffer(1,Math.ceil(audio.sampleRate*dur),audio.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);const n=audio.createBufferSource(),g=audio.createGain(),f=audio.createBiquadFilter();n.buffer=b;f.type='lowpass';f.frequency.value=name==='explosion'?750:name==='swing'?1600:3500;g.gain.value=name==='swing'?.05:.13;n.connect(f).connect(g).connect(audio.destination);n.start();}if(name==='hit'){tone(130,.09,'sawtooth',.09,35);tone(630,.045,'square',.025,60);}if(name==='jump')tone(190,.15,'triangle',.06,550);if(name==='gun')tone(900,.09,'sawtooth',.065,50);if(name==='pickup'){tone(440,.1,'square',.04);setTimeout(()=>tone(660,.1,'square',.04),70);}if(name==='special'){tone(90,.35,'sawtooth',.07,600);tone(440,.25,'triangle',.04,100);}if(name==='hurt')tone(180,.2,'sawtooth',.06,40);if(name==='clear'){[392,494,587,784].forEach((f,i)=>setTimeout(()=>tone(f,.3,'triangle',.05),i*100));}}
// Original arcade voices (assets/sfx/voice, built by tools/audio/build-voices.cjs; work/audio/VOICES.md says which clip
// is which and how it was identified). voice(kind) speaks for the current hero (`selected`) or, for the shared kinds, for
// the enemies and bosses. Each kind has a cooldown (per hero for the hero kinds) so a brawl stays readable, its variants
// rotate without the same clip twice running, and the pick uses its own counter, never Math.random (the seeded suites
// keep their random sequence). The chosen clip travels as sfx('vo:<file>'), so a joiner hears the host's voices; each
// page plays at most VOICE_MAX at once, and a high-priority voice (a death, a boss, a cheer) cuts the oldest one.
// Nothing is downloaded at startup: a stage start warms the files up once (voicePrefetch), and a voice that has not
// loaded yet simply starts late.
const VOICE={
  jump:{hannah:['hannah-jumpkick'],mustapha:['mustapha-jumpkick','mustapha-jumpkick2'],jack:['jack-jump'],mess:['mess-attack']},
  hop:{hannah:['hannah-jump']},
  attack:{hannah:['hannah-attack'],mustapha:['mustapha-attack'],jack:['jack-attack'],mess:['mess-attack']},
  throw:{hannah:['hannah-attack'],mustapha:['mustapha-attack'],jack:['jack-attack2'],mess:['mess-attack2']},
  special:{hannah:['hannah-jumpkick'],mustapha:['mustapha-jumpkick2'],jack:['jack-attack2'],mess:['mess-attack2']},
  death:{hannah:['hannah-death'],mustapha:['mustapha-death'],jack:['jack-death'],mess:['mess-death']},
  food:{hannah:['hannah-food'],mustapha:['mustapha-food'],jack:['jack-food'],mess:['mess-food']},
  win:{hannah:['hannah-win'],mustapha:['mustapha-win'],jack:['jack-win'],mess:['mess-win']},
  enemyDeath:['enemy-scream2','enemy-grunt'],enemyHurt:['enemy-grunt','enemy-scream2'],
  bossTaunt:['boss-laugh','boss-laugh2'],bossHurt:['enemy-scream'],bossTransform:['monster-roar','boss-laugh2'],bossDeath:['enemy-scream'],
  roar:['monster-roar'],go:['go']};
const VOICE_CD={jump:.7,hop:1.2,attack:1.1,throw:.8,special:.6,death:2.5,food:1.5,win:3,enemyDeath:.45,enemyHurt:1.6,bossTaunt:5,bossHurt:2.5,bossTransform:2.5,bossDeath:3,roar:2.5,go:4};
const VOICE_HIGH=new Set(['death','win','bossTaunt','bossTransform','bossDeath','roar','go']),VOICE_MAX=2;
const voiceFiles=()=>[...new Set(Object.values(VOICE).flatMap(v=>Array.isArray(v)?v:Object.values(v).flat()))];
let voiceNext={},voiceLast={},voiceTurn=0;const voiceLive=[],voiceLog=[];
// -> the clip for this event, or null (no clip for this hero, or the kind is cooling down); `now` in seconds
function voicePick(kind,who=HEROES[selected]?.id,now=performance.now()/1000){
  const V=VOICE[kind];if(!V)return null;const list=Array.isArray(V)?V:V[who];if(!list||!list.length)return null;
  const key=Array.isArray(V)?kind:kind+'.'+who;if(now<(voiceNext[key]||0))return null;voiceNext[key]=now+(VOICE_CD[kind]??1);
  let i=0;if(list.length>1){voiceTurn=(voiceTurn*1103515245+12345)>>>0;i=(voiceTurn>>>16)%list.length;if(list[i]===voiceLast[key])i=(i+1)%list.length;}
  voiceLast[key]=list[i];return list[i];
}
function voice(kind,who){if(!settings.sfx||NETROLE==='client')return null;const f=voicePick(kind,who);if(f)sfx('vo:'+(VOICE_HIGH.has(kind)?'!':'')+f);return f;}
// local playback of one clip (`!name` = high priority); returns true when it started
function playVoice(name){
  const high=name[0]==='!',file=high?name.slice(1):name;if(!voiceFiles().includes(file))return false;
  for(let i=voiceLive.length-1;i>=0;i--)if(voiceLive[i].paused||voiceLive[i].ended)voiceLive.splice(i,1);
  if(voiceLive.length>=VOICE_MAX){if(!high)return false;const old=voiceLive.shift();try{old.pause();}catch{}}
  const a=sample('voice/'+file,.8,2);if(!a)return false;if(!voiceLive.includes(a))voiceLive.push(a);voiceLog.push(file);if(voiceLog.length>40)voiceLog.shift();return true;
}
let voiceWarm=false;
function voicePrefetch(){if(voiceWarm||!settings.sfx)return;voiceWarm=true;for(const f of voiceFiles()){const k='voice/'+f,pool=samplePool[k]||(samplePool[k]=[]);if(!pool.length){const a=new Audio();a.preload='auto';a.src='assets/sfx/'+k+'.mp3';pool.push(a);}}}

const soundtrack = new ArcadeSoundtrack();
// Weapon gameplay stays the sequel's (ammo, damage, pierce, single-shot cooldowns; HEROES §7.1, O2 off). The ROM decides
// how each weapon is drawn and how it fires (ROM_HEROES.weapon / .fx, G3d): shot cadence, projectiles, flights, fuses and
// effects. The arcade has no recoil (HEROES D14). B. KNIFE (bknife, blunt class, ROM
// weapon 0x12) is the original game's big knife, coloured per chapter by the OBJ palette page (D21, KI7).
const WEAPONS = {
  gun: {name:'GUN', ammo:6, cooldown:.32, damage:32},
  uzi: {name:'UZI', ammo:48, cooldown:.29, damage:15, burst:3},
  shotgun: {name:'SHOTGUN', ammo:6, cooldown:.66, damage:56, spread:41, pierce:3},
  rifle: {name:'RIFLE', ammo:6, cooldown:.74, damage:70, pierce:2},
  m16: {name:'M-16A1', ammo:60, cooldown:.28, damage:21, burst:3},
  bazooka: {name:'BAZOOKA', ammo:4, cooldown:.85, damage:108, explosive:true},
  knife: {name:'KNIFE', ammo:10, cooldown:.28, damage:33, melee:true, range:71, throwDamage:45},
  rod: {name:'ROD', ammo:8, cooldown:.49, damage:48, melee:true, range:83},
  stick: {name:'STICK', ammo:8, cooldown:.32, damage:28, melee:true, range:64, throwDamage:36},
  club: {name:'CLUB', ammo:16, cooldown:.44, damage:42, melee:true, range:80},
  bknife: {name:'B.KNIFE', ammo:10, cooldown:.42, damage:44, melee:true, range:77},
  torch: {name:'TORCH', ammo:12, cooldown:.46, damage:48, melee:true, range:77},
  grenade: {name:'GRENADE', ammo:2, cooldown:.5, damage:100, thrown:true},
  dynamite: {name:'DYNAMITE', ammo:2, cooldown:.5, damage:125, thrown:true},
  stone: {name:'STONE', ammo:1, cooldown:.4, damage:32, thrown:true}
};
// Music is campaign data (CAMPAIGN §4.6, PLAN §7 G6 1): level.music.stage gives one cue per section, intro → boss at the
// boss, `engine` for Sable at the gate controls and `lastCopy` (32, the original final boss theme) for CROWNBACK. The original
// soundtrack's ids (soundtrack-data.js); '06'/'09'/'10' are the chapter-1 anchors regression.cjs pins.
const stageMusic = () => {const S=level.music?.stage||[];return S[clamp(Math.max(0,sectionIndex),0,S.length-1)]||'06';};
// Heavy weapons carried by one enemy in every third fight; they drop it when beaten.
const CARRIED = [['shotgun','gun','rod'],['uzi','grenade','club'],['rifle','club','knife'],['m16','dynamite','torch'],['bazooka','m16','grenade'],['bazooka','m16','shotgun']];
// The Cadillac is the ROM car at one arcade px per art px (car(), G3b). CAR_SCALE is the old vector car's 0.85 and only
// places the road dust and the boost exhaust (roadDust), which land on the ROM car's rear wheel and tail.
const CAR_SCALE=1.15*LEG,CAR_REACH=95,CAR_EDGE=122;
// Cadillac handling: the car carries momentum, leans into lane changes, and the road streams under it (`road` is the
// extra scenery scroll that keeps the highway moving even while the screen is locked for a fight).
const CAR={accel:533,drag:311,top:204,reverse:-130,cruise:70,laneAccel:852,laneTop:137,road:244,boost:193};
// The periodic road (ARCHITECTURE §2.5, PLAN §7 G2 5): a driving area loops its art every `loop.period` px (HELL ROAD's
// own trick). While a driving lock holds the camera the stream grows at CAR.road; after the lock it runs on to the next
// period boundary and then returns to 0, so the layers are back at layerX = cam.x without a jump (STAGE_RENDER keeps the
// rowscroll and far-layer phases across such a reset). `road` is the total distance streamed (snapshot.road) and
// `roadStream` the offset the stage is drawn with.
let road=0,roadStream=0;
let effects = [], lastHitEnemy = null, bossIntro = 0, dashTime = 0, dashKey = '', lastDirection = {key:'',time:0};
// dashTap counts double-taps: each one can latch a persisting run once (KI22, update()).
let dashTap = 0;
function music(dt) {
  document.querySelector('#sound').textContent=settings.music||settings.sfx?'SOUND ON':'SOUND OFF';
  soundtrack.update(settings.music,state==='paused'||document.hidden,settings.volume??.52);
  if(state==='paused'||state==='guide')return;
  let key=state, sequence;
  if(['menu','chapters'].includes(state)) sequence=[{id:'01',loop:false},{id:'02',loop:false},'01'];
  else if(state==='credits')sequence=['38'];
  else if(state==='select')sequence=['03'];
  // the attract story plays to 04 (CAMPAIGN §4.7); a chapter card to 04 (chapter 1) or 05, then the first section's cue
  else if(state==='attract')sequence=['04'];
  else if(state==='brief')sequence=[{id:levelIndex===0?'04':'05',loop:false},stageMusic()];
  else if(state==='play') {
    const boss=enemies.find(e=>e.boss&&!e.dead),M=level.music||{};
    // the key names the cue, not the section, so two sections on the same cue keep the track running
    key=`play-${levelIndex}-${boss?`boss-${boss.type}-${boss.phase}`:stageMusic()}`;
    sequence=boss?boss.type==='fessenden'?[M.lastCopy||'32']:boss.type==='sable'&&boss.phase===2&&M.engine?[M.engine]:[{id:M.intro||'09',seconds:3.2},M.boss||'10']:[stageMusic()];
  } else if(state==='clear')sequence=[{id:'11',loop:false},{id:['26','27','28'][levelIndex%3],loop:false},'06'];
  else if(state==='ending')sequence=[{id:'33',loop:false},'06'];
  else if(state==='continue')sequence=[{id:'35',loop:false},{id:'36',loop:false}];
  else if(state==='gameover')sequence=[{id:'37',loop:false}];
  if(sequence)soundtrack.cue(key+(state==='brief'||state==='clear'?levelIndex:''),sequence);
}
// ---------------------------------------------------------------- hero weapons on ROM data (PLAN §7 G3d, HEROES §7)
// ROM_HEROES.weapon[type] (shot, flash, sparks, smoke, casing, back-blast, spins, ground records) and ROM_HEROES.fx
// (casing, explosion, dynamite, BOOM, debris, thrown flights and fuses, the hurl, torch flame) are pure data, ready with
// the script; only the drawing waits for the fx sheet (nothing is drawn before it decodes).
function ROMW(type){const R=RIG();return R&&type?R.data.weapon[type]||null:null;}
function ROMFX(){const R=RIG();return R?R.data.fx||null:null;}
const BURST_CLS=new Set(['smg','m16']);
// every record of a weapon set (spins, rotations, ground): such a record inside an effect list is an extraction slip (the
// bazooka puff list opens with 3035, a knife spin record) and is left out of the drawn effect
let weaponRecSet=null;
function fxSeq(seq){const R=RIG();if(!seq||!R)return seq;if(!weaponRecSet){weaponRecSet=new Set();for(const w of Object.values(R.data.weapon))for(const k of ['fastSpin','rot','ground'])for(const e of w[k]||[])weaponRecSet.add(Array.isArray(e)?e[0]:e);}
  return seq.filter(e=>!weaponRecSet.has(Array.isArray(e)?e[0]:e));}
// ROM frame sequences [[rec, dur], …] (a bare record counts 1 f): length in frames, the record on show f frames in
// (null past the end), and the same as a loop.
const seqLen=s=>s.reduce((n,e)=>n+(Array.isArray(e)?(e[1]||1):1),0);
function seqAt(s,f){if(!s)return null;for(const e of s){const r=Array.isArray(e)?e[0]:e,d=Array.isArray(e)?(e[1]||1):1;if(f<d)return r;f-=d;}return null;}
function seqCycle(s,f){const n=s?seqLen(s):0;return n?seqAt(s,((Math.floor(f)%n)+n)%n):null;}
// One fx record at one arcade px per art px, its origin at (x, y - z), facing dir (art faces left), in the chapter's OBJ
// palette page. false while the fx sheet is not decoded.
function fxDraw(rec,x,y,z,dir){const R=RIG();return !!(R&&rec!=null&&R.draw(ctx,[{fam:'fx',sheet:'items',rec,x:0,y:0}],x,y,z,dir>0?1:-1,CFG.sockets.scale,'hero'));}
// A weapon record (held rotation, fast spin or ground record) with, for the torch, its flame (HEROES §7.10, KI6): the
// burning chain on its own clock at the rotation's offset (ri = rotation index 0-15); the ground record lies with its
// knob to the right, so its flame is the level torch's offset 0 mirrored onto the knob. The held torch's flame is HeroRig.flame in updateHeroAnim.
function drawWeaponRec(type,rec,x,y,z,dir,ri=-1){
  const R=RIG();if(!R||rec==null)return false;const parts=[{fam:'fx',sheet:'items',rec,x:0,y:0}];
  if(type==='torch'){const TF=ROMFX()?.torchFlame,ch=TF?.burning;if(ch&&ch.length){const o0=TF.offsets[ri>=0?ri%16:0]||[0,0],o=ri>=0?o0:[-o0[0]-7,o0[1]+2],fr=ch[Math.floor(time*60/(ch[0][1]||4))%ch.length];parts.push({fam:'fx',sheet:'items',rec:fr[0],x:o[0],y:o[1]});}}
  return !!R.draw(ctx,parts,x,y,z,dir>0?1:-1,CFG.sockets.scale,'hero');
}
// A point on the held weapon at `at` = [fwd, up] from its origin on the shot frame (HEROES §7.3: the muzzle is
// origin + [-fwd, -up] in native space), in the world: x, and z above the floor.
function weaponPoint(type,at){const R=RIG(),m=R&&R.muzzle(HEROES[selected].id,type),S=CFG.sockets.scale;if(!m||!at)return null;
  return {x:player.x-player.dir*(m.origin[0]-at[0])*S,z:(at[1]-m.origin[1])*S+player.z};}
function dropWeapon() {
  // Knocked loose, the weapon pops out of the hand spinning through its ROM rotations (10 f each) and lands on its
  // ground record (HEROES §7.12).
  if(player.weapon)drops.push({x:player.x-player.dir*15,y:player.y+4,type:player.weapon,ammo:player.ammo,life:60,loose:true,z:32,vz:90,dir:player.dir});
  player.weapon=null;player.ammo=0;player.pendingStrike=null;player.burst=null;player.swing=null;player.pushV=0;
}
// An explosion: the ROM fireball (ROM_HEROES.fx.explosion = records 378-393, or `kind:'dynamite'` = 460-469 then
// 2140-2142) at height z, plus the debris and smoke particles. Damage and radius stay the sequel's.
function explode(x,y,damage,friendly=true,r=71,opts=null) {
  const F=ROMFX(),kind=opts?.kind||'explosion',seq=F&&F[kind];
  effects.push({x,y,z:opts?.z,age:0,life:seq?seqLen(seq)/60:.65,type:'explosion',seq:kind});shake=CFG.fx.explosion.shake;explosionParticles(x,y);sfx('explosion');
  for(const e of enemies)if(friendly&&!e.dead&&Math.hypot((e.boss?hx(e,x):e.x)-x,(e.y-y)*1.6)<r)damageEnemy(e,damage,Math.sign(e.x-x)*36,true,false,{blast:true});
  if(friendly&&mission?.active)damageObjective(damage,x,y,r,Math.sign(mission.active.x-x)||1);
  if(!friendly){if(multi()){for(const p of hitPlayers())if(Math.hypot(p.x-x,(p.y-y)*1.6)<r)withPlayer(p,()=>damagePlayer(damage,x,false,opts?.hit||null));}else if(Math.hypot(player.x-x,(player.y-y)*1.6)<r)damagePlayer(damage,x,false,opts?.hit||null);}
  for(const o of objects)if(o.hp>0&&Math.hypot(o.x-x,o.y-y)<r)breakObject(o,damage);
}
function breakObject(o,power) {
  o.hp-=power;burst(o.x,o.y-22,'#c3925d',10);
  // a broken ROM container is knocked over (its lying pose, anim 1 of the set, for 12 frames) as its item pops out; the
  // set has no break frames (anims 2+ are the rolling frames of a thrown one; ROM_FX.containers)
  if(o.hp<=0&&!o.boss){const P=propOf(o.type),C=P&&window.ROM_FX.containers?.[P.container],rec=C?.anims?.[1]?.[0]?.[0];if(rec!=null)effects.push({type:'container',seq:[[rec,12]],x:o.x,y:o.y,z:0,dir:-1,age:0,life:.2});}
  if(o.hp<=0){if(o.content&&(o.content!=='food'||Math.random()<rules().propFoodChance)){const c=o.content;drops.push(c==='food'?foodDrop(o.x,o.y):c==='bonus'?bonusDrop(o.x,o.y):c==='ammo'?{x:o.x,y:o.y,type:'ammo',food:'ammo',life:999}:{x:o.x,y:o.y,type:c,life:90});}score+=100;}
}
// The hero's ROM stab box (0x62AE per hero: fwd, xoff, xRange, dOff, dRange; HEROES D17, §7.7): a target counts when
// 0 <= x + dir*fwd - target.x + xoff < xRange and 0 <= y - target.y + dOff < dRange (0x6248, unsigned compares).
// Enemies, breakable objects and an objective target count, so a knife beside a crate still stabs.
function inStabBox(tx,ty){const b=RIG()?.hero(HEROES[selected].id)?.stab||[56,56,112,16,32],S=CFG.sockets.scale,u=player.x+player.dir*b[0]*S-tx+b[1]*S,v=player.y-ty+b[3]*S;return u>=0&&u<b[2]*S&&v>=0&&v<b[4]*S;}
function stabTargets(){
  const out=[];for(const e of enemies)if(!e.dead&&!e.dying&&!e.waiting&&e.state!=='held'&&e.state!=='flee'&&inStabBox(e.boss?hx(e,player.x):e.x,e.y))out.push({kind:'enemy',t:e});
  for(const o of objects)if(o.hp>0&&inStabBox(o.x,o.y))out.push({kind:'object',t:o});
  const t=mission?.active;if(t&&t.kind==='beacon'&&!t.done&&inStabBox(t.x,t.y))out.push({kind:'objective',t});
  return out;
}
function weaponAttack() {
  const w=WEAPONS[player.weapon];if(!w)return false;player.moveState=null;
  player.pendingStrike=null;player.dashVelocity=0;
  const type=player.weapon,cls=rigClass(type);player.attackTotal=w.cooldown;player.attack=w.cooldown;player.attackKind=w.melee?'weapon-melee':w.thrown?'throw':'fire';heroAct(w.thrown?'throwable':cls);
  player.runLatch=0;player.swing=null;
  if(player.ammo<=0){throwHeldWeapon();return true;}
  if(w.melee){
    // A blade (knife, stick) stabs when anything is inside the hero's ROM stab box and is thrown otherwise (D17); a blunt
    // weapon swings. The throw releases on frame 0 of attack.throwable (ev2); a stab or a swing lands on its clip's ev1
    // frame (stab after 1-6 f, swing after 6-7 f; D11) and the attack lasts at least the whole clip (§7.7 attack lock).
    const blade=cls?cls==='blade':type==='knife';
    if(blade&&!stabTargets().length){heroThrow(type,w.throwDamage||w.damage);player.weapon=null;player.ammo=0;player.attackKind='throw';heroAnim.swing='throwable';
      player.attack=player.attackTotal=Math.max(w.cooldown,heroClipLen('attack.throwable',0));sfx('swing');}
    else {const role=heroClassRole(cls,'attack'),hit=heroClipEvent(role,f=>f[4]===1,0);
      player.attack=player.attackTotal=Math.max(w.cooldown,heroClipLen(role,0));
      player.swing={t:hit,type,range:w.range,power:w.damage*(selected===2?1.25:1),stab:blade};sfx('swing');if(hit<=0)resolveSwing();}
    return true;
  }
  // Grenade, dynamite and stone leave the hand on frame 0 of the throw clip (ev2) and fly on the ROM flights (D16).
  if(w.thrown){heroThrow(type,w.damage);player.attack=player.attackTotal=Math.max(w.cooldown,heroClipLen('attack.throwable',0));if(--player.ammo<=0)player.weapon=null;sfx('jump');return true;}
  // Firing (D12): a single-shot gun fires on the press (fire-clip frame 0) and keeps its sequel cooldown (O2 off); the
  // Uzi and the M-16 fire 3 rounds a press, one per smg clip (7/7/5/9 f), the first on the press, and the fire state
  // lasts the ROM's 3-round length (20/20/14/26 f) instead of the sequel's .29/.28 s.
  const RW=ROMW(type),burst=BURST_CLS.has(cls)&&w.burst;
  if(burst&&RW?.fireState){const fs=(RW.fireState[HEROES[selected].id]||20)/60;player.attack=player.attackTotal=fs;}
  const shots=Math.min(w.burst||1,player.ammo);
  emitGunRound(type,0);player.burst=shots>1?{weapon:type,remaining:shots-1,next:burstGap(type),k:0}:null;
  return true;
}
// The gap between the rounds of a burst: the hero's smg clip at its full ROM durations (the arcade restarts the clip for
// every round; gaps measured 7 f Jack, 9 f Mess, HEROES §7.4).
function burstGap(type){const t=heroClipTiming(heroClassRole(rigClass(type),'attack'));return t?t.f.reduce((n,f)=>n+(f[2]===0?256:f[2]),0)/60:.085;}

// The weapon blow of a stab or a swing, on its clip's event frame (player.swing, set by weaponAttack). Each blow that
// lands its frame uses one hit of the weapon (a rod breaks into a stick); a blow cut short by a hit or a pickup uses none.
// A stab hits what is inside the stab box on its frame (the box that chose the stab, D17); a swing keeps its reach.
function resolveSwing(){
  const s=player.swing;player.swing=null;if(!s||player.weapon!==s.type)return;
  const opts={melee:true,weapon:s.type,sharp:s.type==='knife'},kd=s.type!=='knife';
  if(s.stab){for(const {kind,t} of stabTargets()){if(kind==='enemy')damageEnemy(t,s.power,player.dir*(kd?31:6),kd,false,opts);else if(kind==='object')breakObject(t,s.power);else damageObjective(s.power,player.x,player.y,Math.abs(t.x-player.x)+1,player.dir);}}
  else meleeStrike(s.range,s.power,s.type!=='knife',null,opts);
  if(--player.ammo<=0){player.weapon=s.type==='rod'?'stick':null;player.ammo=s.type==='rod'?Math.round(8*rules().meleeDurability):0;}
}
function meleeStrike(range,power,knockdown=false,struck=null,opts=null) {
  let hits=0;
  for(const e of enemies){const ex=e.boss?hx(e,player.x):e.x;if(!e.dead&&e.state!=='held'&&!struck?.includes(e.id)&&Math.abs(e.y-player.y)<(e.boss?bossDepth(e):27)&&Math.abs(ex-player.x)<range&&(Math.abs(ex-player.x)<12||Math.sign(ex-player.x)===player.dir)){if(damageEnemy(e,power,player.dir*(knockdown?31:6),knockdown,false,opts)){struck?.push(e.id);hits++;}}}
  for(const o of objects)if(o.hp>0&&!struck?.includes('box'+o.x)&&Math.abs(o.y-player.y)<27&&Math.abs(o.x-player.x)<range&&Math.sign(o.x-player.x)===player.dir){breakObject(o,power);struck?.push('box'+o.x);}
  const id='task'+mission?.active?.name;if(!struck?.includes(id)&&damageObjective(power,player.x,player.y,range,player.dir))struck?.push(id);
  return hits;
}
// Aimed rounds (Uzi, M-16: ROM shot.aimed) steer toward the nearest enemy ahead within reach and 32 px of the lane, at
// most 2 px/f across.
function aimVy(x0,vx,life){
  const dir=Math.sign(vx)||1,reach=Math.abs(x0-player.x)+Math.abs(vx)*life+16;let best=null,bd=1e9;
  for(const e of enemies){if(e.dead||e.dying||e.waiting||e.state==='flee'||e.state==='held')continue;const d=(e.x-player.x)*dir;if(d<-8||d>reach||Math.abs(e.y-player.y)>32)continue;if(d<bd){bd=d;best=e;}}
  if(!best)return 0;const t=Math.max(1/60,Math.abs(best.x-x0)/Math.abs(vx));return clamp((best.y-player.y)/t,-120,120);
}
// One round (HEROES §7.4-§7.5): the ROM projectile from the ROM muzzle with its speed and the hero's life (range):
// bullets 8 px/f (gun, rifle) and 12 px/f (Uzi, M-16, aimed), six shotgun pellets (10.5-13 px/f, 16-20 f, fanned across
// the lanes; they share one hit list and pierce count), the rocket from 1.75 px/f accelerating .174 px/f². Then the muzzle
// flash, sparks, smoke, back-blast and a casing (every rifle and shotgun shot, the odd rounds of a burst). Damage, pierce
// and lane spread stay the sequel's. No recoil (D14): the bazooka pushes the hero back over the next frames (§7.6).
// `k` is the round's index in its burst.
function emitGunRound(type,k=0){
  const w=WEAPONS[type],profile=weaponClass(type),RW=ROMW(type),shot=RW&&RW.shot,id=HEROES[selected].id,S=CFG.sockets.scale,dir=player.dir;
  if(profile&&profile.recoilPixels)player.x=clamp(player.x-dir*profile.recoilPixels,camera+16,camera+367);
  // The ROM muzzle of the hero's shot frame (HEROES §7.3): `muzzle` ahead of the feet, `y` above them.
  const mount=gunMount(),muzzle=mount.muzzle;
  const base={x:player.x+dir*muzzle,sweepFrom:player.x,y:player.y,z:mount.y+player.z,vy:0,friendly:true,damage:w.damage*(selected===2?1.25:1),weapon:type,spread:w.spread||19,pierce:w.pierce||1,hits:[],age:0,hero:true,dir};if(multi())base.ps=player.mp.slot;
  if(!shot)bullets.push({...base,vx:dir*(w.explosive?333:637),life:w.spread?.33:1.15,kind:w.explosive?'rocket':'bullet'});
  else if(shot.kind==='pellet'){const group={pierce:base.pierce};shot.pellets.forEach((p,i)=>bullets.push({...base,vx:dir*p.v*60*S,vy:(p.travel[1]||0)/p.life*60*S,life:p.life/60,kind:'bullet',pellet:i,group,spread:i===0?base.spread:19}));}
  else if(shot.kind==='rocket')bullets.push({...base,vx:dir*(shot.v0||shot.v)*60*S,ax:dir*shot.a*3600*S,life:(shot.life[id]||25)/60,kind:'rocket',puff:0});
  else{const vx=dir*shot.v*60*S,life=(shot.life[id]||10)/60;bullets.push({...base,vx,vy:shot.aimed?aimVy(base.x,vx,life):0,life,kind:'bullet'});}
  player.ammo--;player.shotT=0;
  // Burst weapons play one burst sample per trigger pull.
  if(!(['uzi','m16'].includes(type)&&player.burst))sfx(type==='bazooka'?'rocket':type==='gun'?'gun':type==='uzi'||type==='m16'?'uzi':'rifle');
  gunFx(type,k,mount);
  if(type==='bazooka'){const P=RIG()?.hero(id)?.bazookaPush||[8,1];player.pushV=-dir*P[0]*60*S;player.pushA=(P[1]||1)*3600*S;}
}
function gunFx(type,k,mount){
  const RW=ROMW(type),F=ROMFX(),dir=player.dir,S=CFG.sockets.scale,profile=weaponClass(type);
  if(!RW||!F){
    effects.push({type:'muzzle',x:player.x+dir*mount.muzzle,y:player.y-mount.y-player.z,dir,age:0,life:.065,weapon:type});
    if(profile?.shells){const p=profile.ejection;particles.push({kind:'shell',x:player.x+dir*(mount.x+p[0]),y:player.y-mount.y-player.z+p[1],ground:player.y-1,vx:-dir*rand(41,70),vy:-rand(56,89),life:1.1,maxLife:1.1,size:3,color:type==='shotgun'?'#da7252':'#e6c15a'});}
    return;
  }
  const add=(kind,part,more)=>{const seq=part&&fxSeq(part.seq);if(!seq||!seq.length)return;const p=weaponPoint(type,part.at);if(p)effects.push({type:kind,seq,x:p.x,y:player.y,z:p.z,dir,age:0,life:seqLen(seq)/60,weapon:type,...more});};
  add('muzzle',RW.flash);
  // sparks fly forward from their point, fanned up and down (no random call)
  // the 'sparks' are smoke puffs (2166-2170; the bazooka's big clouds 2154-2158; the shotgun's 2159-2164) blown forward
  if(RW.sparks&&RW.sparks.seq&&RW.sparks.seq.length){const s=RW.sparks,n=s.n||1;for(let i=0;i<n;i++){const a=n>1?(i-(n-1)/2)*.45:0;add('gunspark',s,{vx:dir*Math.cos(a)*(s.v||3)*60*S,vz:Math.sin(a)*(s.v||3)*60*S,life:Math.max(s.life||6,1)/60});}}
  // the 'smoke' object (pool D 0x04 sub 6, one per shot at the weapon, 20 f) is the arcade's lettering: POW! (2590-2592)
  // for the single-shot guns, TA (2598) and KA (2599) on alternate rounds of a burst; lettering is never mirrored
  add('shottext',RW.smoke2&&k%2?RW.smoke2:RW.smoke,{text:true});add('backblast',RW.backBlast);
  if(RW.casing&&(!RW.casing.everyOther||k%2===0)){const p=weaponPoint(type,RW.casing.at),C=F.casing;
    if(p&&C)particles.push({kind:'shell',rom:true,seq:C.rec,dir,age:0,x:p.x,y:player.y-p.z,ground:player.y-1,vx:dir*C.v[0]*60*S,vy:-C.v[1]*60*S,g:C.g*3600*S,life:(C.life[0]+Math.floor(rand(0,C.life[1]-C.life[0]+1)))/60,maxLife:C.life[1]/60,size:3,color:type==='shotgun'?'#da7252':'#e6c15a'});}
}
// A throw from the hand (HEROES D16, ROM_HEROES.fx.thrown): grenade and dynamite arc (vx 4, vh 2.5 px/f, gravity
// .21875 px/f², about 36 f in the air from the release height) and lie on the ground until their fuse (grenade 57 f,
// dynamite 135 f with its fuse anim); a knife, stick, stone or any other weapon flies straight at 9.5 px/f (12 when
// thrown on the run) with a slight drag, spinning, from the hero's release height (53/50/57/58), until it hits something
// or leaves the screen.
function heroThrow(type,damage){
  const F=ROMFX(),T=F?.thrown,S=CFG.sockets.scale,dir=player.dir,h=(T?.releaseH?.[HEROES[selected].id]??53)*S+player.z;
  if(type==='grenade'||type==='dynamite'){const A=T?.arc||{vx:4,vh:2.5,g:-0.21875},fuse=(type==='grenade'?T?.grenadeFuse??57:T?.dynamiteFuse??135)/60;
    bullets.push({x:player.x,y:player.y,z:h,vx:dir*A.vx*60*S,vy:0,vz:A.vh*60*S,g:Math.abs(A.g)*3600*S,friendly:true,damage,life:fuse,kind:'lob',weapon:type,age:0,hero:true,dir,...(multi()?{ps:player.mp.slot}:{})});return;}
  const row=(player.run&&player.move?T?.throwable?.alt:T?.throwable?.normal)||{vx:9.5,ax:-0.0078};
  bullets.push({x:player.x,y:player.y,z:h,vx:dir*row.vx*60*S,ax:dir*(row.ax||0)*3600*S,vy:0,friendly:true,damage,life:1.5,kind:'thrown',weapon:type,age:0,hero:true,dir,...(multi()?{ps:player.mp.slot}:{})});
}
// O3 (the user's decision, over the arcade discard D15): an empty gun is hurled at the enemy when the fire clip of its
// last round ends; E throws any held weapon the same way. It flies like a thrown knife (ROM_HEROES.fx.hurl), hits for
// 42 (a knife 45), rebounds off what it hits and lies there 63 f; a grenade or dynamite thrown by E still goes off.
function throwHeldWeapon(){
  if(!player.weapon)return;const type=player.weapon,w=WEAPONS[type];heroAct('throwable');
  heroThrow(type,w?.thrown?w.damage:w?.throwDamage||ROMFX()?.hurl?.damage||42);
  player.weapon=null;player.ammo=0;player.burst=null;player.pendingStrike=null;player.swing=null;player.runLatch=0;player.pushV=0;player.attack=.26;player.attackTotal=.26;player.attackKind='throw';sfx('swing');
}
function updateEmptyGun(){
  const w=WEAPONS[player.weapon];
  if(!w||w.melee||w.thrown||player.ammo>0||player.burst||player.hurt>0||player.pickup>0||player.z>0||player.grab||player.special>0||player.dropIn)return;
  if(player.attack>0&&(player.attackKind!=='fire'||player.shotT<heroClipLen(heroClassRole(rigClass(player.weapon),'attack'),0)))return;
  throwHeldWeapon();
}
function updateBurst(dt){
  const b=player.burst;if(!b)return;
  if(player.weapon!==b.weapon||player.hurt>0||player.special>0||player.attackKind!=='fire'){player.burst=null;return;}
  b.next-=dt;
  while(b.next<=1e-9&&b.remaining>0&&player.ammo>0){emitGunRound(b.weapon,++b.k);b.remaining--;b.next+=burstGap(b.weapon);}
  if(b.remaining<=0||player.ammo<=0)player.burst=null;
}
// A grenade or dynamite stick goes off: the ROM fireball (dynamite: its own 460-469/2140-2142 blast) with BOOM (2583-2586)
// and debris (2835-2840); a grenade adds two effect-only blasts 10 and 20 f later (+67/+77 f, HEROES §7.8).
function detonate(b){
  const F=ROMFX(),dyn=b.weapon==='dynamite';blowKind=b.friendly?'throw':null;try{explode(b.x,b.y,b.damage,b.friendly,71,{kind:dyn?'dynamite':'explosion'});}finally{blowKind=null;}if(!F)return;
  if(!dyn&&F.explosion)for(const [d,dx] of [[10,-12],[20,12]])effects.push({type:'explosion',seq:'explosion',x:b.x+dx,y:b.y,age:-d/60,life:seqLen(F.explosion)/60});
  if(F.boom)effects.push({type:'boom',seq:F.boom,x:b.x,y:b.y,z:dyn?82:62,dir:-1,text:true,age:0,life:seqLen(F.boom)/60});
  if(F.debris)[[-1,1.6,3.4],[1,1.4,3],[-1,.7,4],[1,.9,4.4]].forEach(([s,vx,vz],i)=>effects.push({type:'debris',seq:F.debris.map(r=>[r,2]),loop:true,x:b.x,y:b.y,z:8,dir:s,vx:s*vx*60,vz:vz*60,g:.25*3600,age:0,life:.55+i*.05}));
}
// A thrown weapon that hits rebounds (vx -1.8 px/f, falling at .2594 px/f²), lies on its ground record 63 f and blinks out
// (HEROES §7.8; drawing only, snapshot.discards).
let discards=[];
function reboundThrown(b){
  const F=ROMFX(),R=F?.thrown?.rebound||{vx:-1.8,v0:-0.1263,g:-0.2594},S=CFG.sockets.scale,d=Math.sign(b.vx)||b.dir||1;
  discards.push({weapon:b.weapon,x:b.x,y:b.y,z:b.z,vx:-d*Math.abs(R.vx)*60*S,vz:R.v0*60*S,g:Math.abs(R.g)*3600*S,dir:d,age:0,t:0,lie:(F?.thrown?.lie??63)/60,landed:false});
}
function updateDiscards(dt){
  for(const d of discards){d.age+=dt;if(!d.landed){d.x+=d.vx*dt;d.vz-=d.g*dt;d.z+=d.vz*dt;if(d.z<=0){d.z=0;d.landed=true;}}else if((d.t+=dt)>=d.lie)d.gone=true;}
  discards=discards.filter(d=>!d.gone);
}
function drawDiscard(d){
  const RW=ROMW(d.weapon),x=d.x-viewX;if(!RW||x<-60||x>W+60)return;
  if(!d.landed){const sp=RW.fastSpin||[],f=Math.floor(d.age*60);if(sp.length){const i=Math.floor(f)%sp.length;drawWeaponRec(d.weapon,sp[i][0],x,d.y,d.z,d.dir,i);}return;}
  if(d.lie-d.t<16/60&&Math.floor(d.t*30)%2)return;   // blinks out over its last 16 frames
  drawWeaponRec(d.weapon,RW.ground?.[0]?.[0],x,d.y,0,d.dir,-1);
}
function clearEnemyHazards(owner){for(const b of bullets)if(b.owner===owner)b.life=0;for(const z of zones)if(z.owner===owner)z.cancelled=true;}
// Anyone an enemy can hurt: the player and any freed conscripts still fighting.
// With 2-3 players: every player on the field (in the car only the driver), each hit in its own context (§3.5 A).
const fighters=()=>[...(multi()?hitPlayers():[player]),...allies.filter(a=>a.hp>0&&a.state!=='down'&&a.state!=='retreat')];
function strike(v,amount,fromX,ignoreAir=false,hit=null){if(v===player)damagePlayer(amount,fromX,ignoreAir,hit);else if(isP(v))withPlayer(v,()=>damagePlayer(amount,fromX,ignoreAir,hit));else hurtAlly(v,amount,fromX);}
// Thurow's bomb arcs onto the lane it was thrown at and goes off there (r 40); TYROG's parasites drop, then crawl at the
// hero for 2 s and bite a hero on the ground (a jump avoids them: air:false).
function updateHostileObject(b,dt){
  b.age=(b.age||0)+dt;
  if(b.kind==='bomb'){b.t+=dt;const p=Math.min(1,b.t/b.T);b.x=b.x0+(b.x1-b.x0)*p;b.y=b.y0+(b.y1-b.y0)*p;b.z=b.z0*(1-p)+Math.sin(p*Math.PI)*b.h;
    if(p>=1){b.life=0;b.z=0;if(b.slag){for(const v of fighters())if(Math.hypot((v.x-b.x)*.8,v.y-b.y)<b.r&&v.z<19)strike(v,b.damage,b.x,false,b.hit||null);burst(b.x,b.y-6,'#ff9a3b',10);
      if(b.burn)zones.push({owner:b.owner,x:b.x,y:b.y,r:b.burn.r||30,t:b.burn.t||1.5,total:b.burn.t||1.5,friendly:false,damage:6,air:true,style:'fire',linger:true,tick:.25});}
      else explode(b.x,b.y,b.damage,false,b.r,{kind:'dynamite',z:0,hit:b.hit});}return;}
  b.life-=dt;
  if(b.z>0){b.vz-=630*dt;b.z=Math.max(0,b.z+b.vz*dt);b.x+=b.vx*dt;return;}
  const t=multi()?nearestPlayer(b.x,b.y)||player:player,d=Math.sign(t.x-b.x)||b.dir;b.dir=d;b.vx=d*48;b.x+=b.vx*dt;b.y=approach(b.y,t.y,24*dt);
  if(!driving&&t.z<6&&t.inv<=0&&Math.abs(t.x-b.x)<12&&Math.abs(t.y-b.y)<10){strike(t,b.damage,b.x,false,b.hit);b.life=0;}
}
function updateProjectiles(dt) {
  // a hero's round, throw or rocket credits the player who fired it (§3.7): its hits run in that player's context
  for(const b of bullets){const o=b.ps!=null&&multi()?players[b.ps]:null;if(o&&o!==ctxPlayer)withPlayer(o,()=>stepBullet(b,dt));else stepBullet(b,dt);}
  // a thrown enemy knife, hit or miss, ends on the floor as a knife anyone can pick up (ENEMIES §2.8)
  for(const b of bullets)if(b.enemyKnife&&b.life<=0&&!b.dropped){b.dropped=true;const L=lock||{left:camera,right:camera+W};drops.push({x:clamp(b.x,L.left+16,L.right-16),y:b.y,type:'knife',life:60,loose:true,z:Math.max(8,b.z*.5),vz:60,dir:Math.sign(b.vx)||1});}
  bullets=bullets.filter(b=>b.life>0);for(const fx of effects)fx.age+=dt;effects=effects.filter(fx=>fx.age<fx.life);
}
function stepBullet(b,dt){
  {
    if(b.life<=0)return;
    if(b.kind==='bomb'||b.kind==='parasite'){updateHostileObject(b,dt);return;}
    if(b.group&&b.group.pierce<=0){b.life=0;return;}
    const from=b.sweepFrom??b.x;delete b.sweepFrom;
    b.age=(b.age||0)+dt;b.x+=b.vx*dt;b.y+=(b.vy||0)*dt;b.life-=dt;
    if(b.ax){const v0=b.vx;b.vx+=b.ax*dt;if(b.kind==='thrown'&&Math.sign(b.vx)!==Math.sign(v0))b.vx=0;}
    // grenade and dynamite: the ROM arc, then they lie where they land until the fuse runs out
    if(b.kind==='lob'){
      if(!b.landed){b.vz-=(b.g||630)*dt;b.z+=(b.vz||0)*dt;if(b.z<=0){b.z=0;b.vz=0;b.vx=0;b.landed=true;}}
      if(b.life<=0)detonate(b);return;
    }
    // the rocket trails a small smoke puff every 2 f (the pistol's puff records 2166-2170)
    if(b.kind==='rocket'&&b.hero){const P=ROMW('gun')?.sparks?.seq;if(P){b.puff=(b.puff||0)+dt;while(b.puff>=2/60-1e-9){b.puff-=2/60;effects.push({type:'trail',seq:P.map(e=>[e[0],2]),x:b.x-Math.sign(b.vx)*14,y:b.y,z:b.z,dir:Math.sign(b.vx)||1,age:0,life:2*P.length/60});}}}
    if(b.kind==='thrown'&&b.hero&&(b.x<camera-48||b.x>camera+W+48))b.life=0;
    const intersects=(x,r)=>x>=Math.min(from,b.x)-r&&x<=Math.max(from,b.x)+r;
    if(b.friendly&&b.life>0){
      const targets=[];
      for(const e of enemies)if(!e.dead&&e.state!=='flee'&&!b.hits?.includes(e.id)&&e.inv<=0&&(e.boss&&bossSpan(e)?intersects(hx(e,b.x),2):intersects(e.x,16))&&Math.abs(b.y-e.y)<(e.boss?Math.max(b.spread||20,bossDepth(e)-6):b.spread||20)&&b.z>e.z+4&&b.z<e.z+(e.state==='down'?24:e.boss?119:83))targets.push({kind:'enemy',target:e});
      for(const o of objects)if(o.hp>0&&intersects(o.x,19)&&Math.abs(b.y-o.y)<22&&b.z<74)targets.push({kind:'object',target:o});
      const task=mission?.active;if(task?.kind==='beacon'&&intersects(task.x,17)&&Math.abs(b.y-task.y)<24&&b.z<81)targets.push({kind:'objective',target:task});
      targets.sort((a,c)=>Math.abs(a.target.x-from)-Math.abs(c.target.x-from));
      const P=b.group||b;blowKind=b.kind==='thrown'?'throw':null;
      for(const item of targets){
        if(b.life<=0)break;const t=item.target;
        if(b.kind==='rocket'){explode(t.x,b.y,b.damage,true,89,{z:b.z});b.life=0;b.done=true;break;}
        if(item.kind==='enemy'){if(!damageEnemy(t,b.damage,Math.sign(b.vx)*9,b.weapon==='rifle'||b.weapon==='shotgun',false,{bullet:b.kind==='bullet',sharp:b.weapon==='knife',weapon:b.weapon,hitZ:b.z}))continue;b.hit=true;effects.push({type:'pow',x:t.x-Math.sign(b.vx)*9,y:b.y-b.z,age:0,life:.32});(b.hits||(b.hits=[])).push(t.id);P.pierce=(P.pierce||1)-1;if(P.pierce<=0)b.life=0;}
        else {if(item.kind==='objective')damageObjective(b.damage,t.x,b.y,30,Math.sign(b.vx));else breakObject(t,b.damage);b.hit=true;b.life=0;}
      }
      blowKind=null;
      if(b.kind==='thrown'&&b.hero&&b.hit&&b.life<=0)reboundThrown(b);
    }else if(!b.friendly)for(const v of fighters()){
      const car=isP(v)&&driving;
      if(intersects(v.x,car?74:17)&&Math.abs(b.y-v.y)<19&&b.z>=v.z+(car?0:6)&&b.z<=v.z+(car?59:b.zHi||78)){strike(v,b.damage,b.x-Math.sign(b.vx)*30,true,b.hit||null);b.life=0;b.struck=true;break;}
    }
    // a rocket that runs out of life bursts where it is (ROM life 22-26 f, about 90-100 px from the muzzle)
    if(b.kind==='rocket'&&b.hero&&b.life<=0&&!b.done){b.done=true;explode(b.x,b.y,b.damage,b.friendly,89,{z:b.z});}
  }
}
// A weapon in flight (a knife, stick or stone thrown, the hurled empty gun, a grenade or dynamite in the air) spins
// through its ROM fast-spin records (ROM_HEROES.weapon[t].fastSpin, 1 f each; HEROES §7.8) at one arcade px per art px,
// in the chapter's object palette, about its own origin; a landed grenade shows its ground record and dynamite its fuse
// anim (1838/1839). Nothing is drawn until the fx sheet is ready.
function drawThrown(b,x){
  const RW=ROMW(b.weapon),dir=Math.sign(b.vx)||b.dir||1,f=Math.floor((b.age||0)*60+1e-6);
  if(RW){let rec=null,ri=-1;
    if(b.kind==='lob'&&b.landed)rec=b.weapon==='dynamite'&&RW.fuse?seqCycle(RW.fuse,f):RW.ground?.[0]?.[0];
    else if(RW.fastSpin&&RW.fastSpin.length){const n=seqLen(RW.fastSpin);let t=f%n;ri=0;while(ri<RW.fastSpin.length-1&&t>=(RW.fastSpin[ri][1]||1))t-=RW.fastSpin[ri++][1]||1;rec=RW.fastSpin[ri][0];}
    if(rec!=null)drawWeaponRec(b.weapon,rec,x,b.y,b.z,dir,ri);}
}
// A hero round in flight: its ROM record(s) cycling (gun 2127; rifle/Uzi 3509/3510; M-16 3510/3511; pellets 2138,
// 3361-3363; rocket 2132), the record origin at the round's tip.
function drawRomShot(b,x){
  const RW=ROMW(b.weapon),rec=RW?.shot?.rec;if(!rec||!rec.length)return false;
  return fxDraw(seqCycle(rec,(b.age||0)*60+1e-6+(b.pellet||0)),x,b.y,b.z,Math.sign(b.vx)||1);
}
// A ROM effect {seq, x, y (lane), z (height), dir, vx?, vz?, g?, loop?}: its record on show `age` in, moving ballistically.
function drawRomFx(fx){
  const f=fx.age*60+1e-6,rec=fx.loop?seqCycle(fx.seq,f):seqAt(fx.seq,Math.floor(f));if(rec==null)return true;
  const t=fx.age,z=Math.max(0,(fx.z||0)+(fx.vz||0)*t-(fx.g||0)*t*t/2);
  return fxDraw(rec,fx.x+(fx.vx||0)*t-viewX,fx.y,z,fx.text?-1:fx.dir||1);
}
// Enemy projectiles are their ROM objects (ENEMIES §2.8): the knife in flight (0x6FB6A:32 spinning), the poacher's
// round (0x6FB1A:0), Thurow's bomb / dynamite turning through its rotation anims (0x5F0AC:* / 0x5F128:*) and TYROG's
// parasites (0x71408:10 leaping, :11 crawling, in their own +0x23 map), in the thrower's palette map.
const ROT_KEYS={};
function rotKeys(set){if(ROT_KEYS[set])return ROT_KEYS[set];const A=ROME()?.anims||{};return (ROT_KEYS[set]=Object.keys(A).filter(k=>k.startsWith(set+':')).sort((p,q)=>(+p.split(':')[1])-(+q.split(':')[1])));}
function drawEnemyShot(b,x,y){
  if(b.art?.fam==='bosses'){const a=bAnim(b.art.key);if(a)drawRomFrame(a.f[frameIdx(a,(b.age||0)*60)][0],x,y,b.dir||Math.sign(b.vx)||1,b.art.map,'bosses');return true;}
  if(b.kind==='bomb'){const ks=rotKeys(b.art.set),a=ks.length&&eAnim(ks[Math.floor((b.age||0)*15)%ks.length]);if(a)drawRomFrame(a.f[0][0],x,y,b.dir,b.art.map);return true;}
  if(b.kind==='parasite'){const a=eAnim(b.z>0?'0x71408:10':'0x71408:11');if(a)drawRomFrame(a.f[frameIdx(a,(b.age||0)*60)][0],x,y,b.dir,a.pal||null);return true;}
  const a=b.art&&eAnim(b.art.key);if(!a)return false;
  drawRomFrame(a.f[frameIdx(a,(b.age||0)*60)][0],x,y,Math.sign(b.vx)||b.dir||1,b.art.map);return true;
}
function drawEffects() {
  const F=ROMFX();
  // Hero rounds and rockets are ROM records; other enemy and ally rounds are a tracer line.
  for(const b of bullets){if(b.delay>0)continue;const x=b.x-viewX,y=b.y-b.z;
    if(!b.hero&&!b.friendly&&drawEnemyShot(b,x,y))continue;
    if(b.kind==='lob'||b.kind==='thrown'){shadow(ctx,x,b.y,6);drawThrown(b,x);}
    else if(b.hero&&drawRomShot(b,x))continue;
    else if(b.kind==='rocket'){const rr=ROMW('bazooka')?.shot?.rec;if(rr)fxDraw(seqCycle(rr,(b.age||0)*60),x,b.y,b.z,Math.sign(b.vx)||1);rect(ctx,x-Math.sign(b.vx)*22,y-1,Math.sign(b.vx)*13,2,'#ffb33b');}
    else {rect(ctx,x,y,Math.sign(b.vx)*(b.weapon==='shotgun'?20:13),1,b.friendly?'#fff7c5':'#ff8662');if(b.weapon==='shotgun'){rect(ctx,x-4,y-6,7,1,'#ffdc7c');rect(ctx,x-4,y+6,7,1,'#ffdc7c');}}
  }
  for(const fx of effects){
    if(fx.age<0)continue;
    if(fx.type==='erom'){const a=eAnim(fx.key);if(a)drawRomFrame(a.f[frameIdx(a,fx.age*60,true)][0],fx.x-viewX,fx.y-(fx.z||0),fx.dir,fx.map);continue;}
    // boss effects: Crownback's split plates flying off, the spillway surge, Breakwater's snapped harness chain sliding with the road
    // a generated body's effect frame (Overdrive's muzzle burst) at its origin
    if(fx.type==='gfx'){const a=bAnim(fx.key);if(a)drawRomFrame(a.f[0][0],fx.x-viewX,fx.y-(fx.z||0),fx.dir,fx.map,'bosses');continue;}
    if(fx.type==='brom'){const a=bAnim(fx.key);if(a){const t=fx.age,z=Math.max(0,(fx.z||0)+fx.vz*t-fx.g*t*t/2);ctx.save();ctx.globalAlpha=clamp((fx.life-fx.age)/.4,0,1);drawRomFrame(a.f[0][0],fx.x+fx.vx*t-viewX,fx.y-z,fx.dir,fx.map,'bosses');ctx.restore();}continue;}
    if(fx.type==='surge'){const k=fx.age/fx.life;ctx.save();ctx.globalAlpha=1-k;ctx.fillStyle='#5bbfda';ctx.beginPath();ctx.ellipse(fx.x-viewX,fx.y,40+120*k,12+10*k,0,0,Math.PI*2);ctx.fill();ctx.restore();continue;}
    if(fx.type==='chain'){const cx=fx.x+fx.vx*fx.age-viewX;drawChainLine(cx-40,fx.y-3,cx+40,fx.y-3,'S1A2');continue;}
    // every explosion is the ROM fireball (centred 28 px above the floor unless it has a height) or dynamite's blast
    if(fx.type==='explosion'){const seq=F&&F[fx.seq||'explosion'];if(seq){const rec=seqAt(seq,Math.floor(fx.age*60+1e-6));if(rec==null||fxDraw(rec,fx.x-viewX,fx.y,fx.z??(fx.seq==='dynamite'?0:28),1))continue;}}
    else if(Array.isArray(fx.seq)){drawRomFx(fx);continue;}
    // the hit spark is the ROM impact (1405-1407) and the round's POW the ROM lettering (2590-2592, never mirrored), each
    // played over the effect's life
    if(fx.type==='spark'||fx.type==='pow'){const seq=fx.type==='spark'?F?.impact:ROMW('gun')?.smoke?.seq;if(seq){const n=seqLen(seq);fxDraw(seqAt(seq,Math.min(n-1,Math.floor(fx.age/fx.life*n))),fx.x-viewX,fx.y-(fx.type==='pow'?fx.age*19:0),0,fx.type==='pow'?-1:1);}continue;}
    if(fx.type==='muzzle'){ctx.save();ctx.translate(Math.round(fx.x-viewX),Math.round(fx.y));ctx.scale(fx.dir*LEG,LEG);const n=Math.floor(fx.age*90)%2,l=fx.weapon==='bazooka'?38:fx.weapon==='shotgun'?31:22;poly(ctx,[[0,-3],[l*.35,-6],[l*.2,-11],[l,-4+n*6],[l*.52,0],[l*.82,7],[l*.24,5],[0,3]],'#ee8e39');poly(ctx,[[0,-2],[l*.34,-5],[l*.72,0],[l*.24,4],[0,2]],'#fff4b2');rect(ctx,0,-1,10,2,'#ffffff');ctx.restore();}}
}
function soundRoom(back=menu) {
  state='jukebox';
  panel(`<section class="panel small-panel sound-panel"><p class="eyebrow">THE ORIGINAL ARCADE SOUND</p><h2>SOUND ROOM.</h2><div class="audio-settings"><button class="secondary" id="music-toggle">MUSIC ${settings.music?'ON':'OFF'}</button><button class="secondary" id="sfx-toggle">EFFECTS ${settings.sfx?'ON':'OFF'}</button><button class="secondary" id="aspect-toggle" title="4:3 is the arcade monitor; square pixels shows the 384x224 picture unstretched">SCREEN ${settings.aspect==='12:7'?'SQUARE PIXELS':'4:3 ARCADE'}</button><label>Music volume <input id="music-volume" type="range" min="0" max="100" value="${Math.round((settings.volume??.52)*100)}"></label></div><div class="track-list">${SOUNDTRACK.map(t=>`<button class="track" data-track="${t.id}"><span>${t.id}</span>${t.title.replace(/ \(1\)$/, '')}<small>${Math.floor(t.duration/60)}:${Math.floor(t.duration%60).toString().padStart(2,'0')}</small></button>`).join('')}</div><p class="sound-note">27 tracks · Choose a track to listen. The campaign changes music with each area and boss.</p><button id="sound-back" class="primary">← BACK</button></section>`);
  bindButton('music-toggle',()=>{settings.music=!settings.music;persist();soundRoom(back);});
  bindButton('sfx-toggle',()=>{settings.sfx=!settings.sfx;persist();soundRoom(back);});
  bindButton('aspect-toggle',()=>{settings.aspect=settings.aspect==='12:7'?'4:3':'12:7';applyAspect();persist();soundRoom(back);});
  document.getElementById('music-volume').addEventListener('input',e=>{settings.volume=Number(e.target.value)/100;persist();});
  document.querySelectorAll('[data-track]').forEach(b=>b.addEventListener('click',()=>{unlockAudio();settings.music=true;persist();soundtrack.cue('preview-'+b.dataset.track,[b.dataset.track]);document.querySelectorAll('[data-track]').forEach(v=>v.classList.toggle('selected',v===b));}));
  bindButton('sound-back',back);
}

function bindButton(id,fn){document.getElementById(id)?.addEventListener('click',()=>{unlockAudio();fn();});}
function panel(html){overlay.innerHTML=html;document.querySelector('#pause').style.display=state==='play'?'block':'none';document.body.classList.toggle('in-play',state==='play');}
// The title (CAMPAIGN §11.1): the original logo from the ROM (ROM_UI.logo, drawn into #title-logo once the ui sheet has
// decoded; the HTML heading stays until then and for screen readers), the subtitle and a blinking INSERT COIN in the
// arcade font, the eyebrow, deck and note. After 20 s without input the attract story (EDEN_INTRO) plays (attract()).
function menu(){state='menu';lock=null;keys.clear();menuIdle=0;attractSeq=null;SR.require(0);const cp=save.checkpoint;panel(`<section class="panel title-panel"><p class="eyebrow">EASTCOAST 2513 · SIX MONTHS LATER</p><canvas id="title-logo" class="title-logo" width="384" height="136" aria-hidden="true"></canvas><h1>CADILLACS &<br>DINOSAURS <span>II</span></h1><div class="subtitle">II · THE CROWN TIDE</div><p class="deck">Fessenden is dead and the sea took the coast. Now Marshal Sable holds the water.<br>Four heroes. Six chapters. One dam.</p><div class="menu-buttons title-actions"><div class="menu-main"><button class="primary" id="newgame">START ADVENTURE →</button><button class="secondary" id="mp-open">PLAY WITH FRIENDS</button>${cp?`<button class="secondary" id="continue">CONTINUE · CH 0${cp.level+1}</button>`:''}</div><div class="menu-more"><button class="secondary" id="chapters">CHAPTERS</button><button class="secondary" id="story">THE STORY SO FAR</button><button class="secondary" id="guide">HOW TO PLAY</button><button class="secondary" id="jukebox">SOUND ROOM</button></div></div><p class="title-note">A FAN-MADE SEQUEL · MADE FOR MOSTAFA</p></section>`);bindButton('newgame',()=>characterSelect(0));bindButton('mp-open',openLobby);bindButton('continue',()=>{const s=save.checkpoint;selected=clamp(s.hero,0,3);difficulty=normalizeDifficulty(s.difficulty);score=s.score||0;lives=s.lives||3;startStage(clamp(s.level,0,5),{section:s.section|0});});bindButton('chapters',chapters);bindButton('story',attract);bindButton('guide',()=>guide(menu));bindButton('jukebox',()=>soundRoom(menu));drawTitleLogo();}
// The attract story (CAMPAIGN §4.7, §11.1): the five EDEN_INTRO panels in the 1993 five-beat shape, typed at 2 characters
// per frame, each held 3.5 s (or skipped with a button), then back to the title. Any key or a click on the screen
// returns to the title; PRESS START begins a game, as the cabinet's start button does in its attract loop.
const MENU_IDLE=20;
let menuIdle=0,attractSeq=null;
function attract(){state='attract';keys.clear();attractSeq={k:0,t:0};panel(`<section class="panel dock-panel attract-dock"><p class="eyebrow">THE CROWN TIDE · THE STORY SO FAR</p><div class="menu-buttons"><button class="primary" id="newgame">PRESS START →</button><button class="secondary" id="attract-title">TITLE</button></div></section>`);bindButton('newgame',()=>characterSelect(0));bindButton('attract-title',menu);}
function updateAttract(dt){
  const list=window.EDEN_INTRO||[];if(!attractSeq||!list.length){menu();return;}
  attractSeq.t+=dt*60;const p=list[attractSeq.k];
  if(attractSeq.t>=panelFrames(p)+PANEL_HOLD){attractSeq.k++;attractSeq.t=0;if(attractSeq.k>=list.length)menu();}
}
// The title logo: ROM_UI.logo (the 1993 mark, OBJ records re-rendered from the graphics ROM, KI5) with the sequel's
// subtitle and a blinking INSERT COIN in the arcade font. Nothing is drawn (the HTML heading stays) until the ui sheet
// has decoded; render() calls it again while the title shows, for the blink.
function drawTitleLogo(){
  const c=document.getElementById('title-logo'),SP=window.SPRITES,U=window.ARCADE_UI;if(!c||!SP||!U||!SP.familyReady?.('ui'))return false;
  const g=c.getContext('2d');g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,c.width,c.height);g.imageSmoothingEnabled=false;
  if(!SP.drawRec(g,'ui','logo','ui',48,0,false))return false;
  U.text(g,'II · THE CROWN TIDE',192,100,{font:16,align:'center',pen:'yellow',outline:true});
  if(Math.floor(time*60/32)%2===0)U.text(g,'INSERT COIN',192,124,{align:'center',pen:'orange',outline:true});
  c.closest('.title-panel')?.classList.add('rom-logo');return true;
}
function paintSelection(){
 const c=document.querySelector('#selection-banner'),stats=document.querySelector('#selection-stats');if(!c||!stats)return;
 const g=c.getContext('2d'),j=selectionImages.jack,h=selectionImages.hannah,chosen=selectionImages[HEROES[selected].id];if(!j||!h||!chosen)return;g.imageSmoothingEnabled=false;
 // The two native frames let us show each portrait without the baked-in 1P cursor.
 if(j.complete&&j.naturalWidth&&h.complete&&h.naturalWidth){g.drawImage(h,0,0,384,144,0,0,384,144);g.drawImage(j,115,88,85,21,115,88,85,21);
   // A free-play selector has no coin timer; a small title occupies the timer's original position.
   g.fillStyle='#fffae9';g.fillRect(166,4,43,38);g.fillStyle='#1748bc';g.font='bold 9px monospace';g.textAlign='center';g.fillText('CHOOSE',187,16);g.fillText('HERO',187,28);}
 if(chosen.complete&&chosen.naturalWidth){const q=stats.getContext('2d');q.imageSmoothingEnabled=false;q.drawImage(chosen,0,144,128,80,0,0,128,80);}
}
function characterSelect(startAt=selectionChapter){loadSelectionArt();selectionChapter=startAt;state='select';difficulty=normalizeDifficulty(difficulty);
 const h=HEROES[selected],ratings=CFG.heroRatings[h.id];
 panel(`<section class="panel character-panel arcade-select"><div class="select-heading"><button id="back" class="secondary">← BACK</button><span>PLAYER SELECT · FOUR HEROES</span></div><div class="classic-roster"><canvas id="selection-banner" width="384" height="144" aria-label="Original portraits of Jack, Hannah, Mustapha and Mess"></canvas><div class="portrait-buttons">${SELECT_ORDER.map(i=>`<button class="portrait-choice ${i===selected?'selected':''}" data-hero="${i}" aria-label="Choose ${HEROES[i].name}" aria-pressed="${i===selected}"><span>${i===selected?'1P':'SELECT'}</span></button>`).join('')}</div></div><div class="classic-select-bottom"><canvas id="selection-stats" width="128" height="80" aria-label="${h.name}: Power ${ratings[0]}, Speed ${ratings[1]}, Skill ${ratings[2]} out of five"></canvas><div class="select-options"><div class="difficulty">${Object.entries(CFG.difficulty).map(([key,v],i)=>`<button id="${['story-mode','normal-mode','arcade-mode'][i]}" data-mode="${key}" aria-pressed="${difficulty===key}" class="${difficulty===key?'selected':''}">${v.label}</button>`).join('')}</div><p class="difficulty-note">${rules().description}</p><button id="begin" class="primary">LET'S GO →</button></div></div></section>`);
 document.querySelectorAll('[data-hero]').forEach(b=>b.onclick=()=>{selected=+b.dataset.hero;characterSelect(startAt);sfx('pickup');});
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{difficulty=b.dataset.mode;characterSelect(startAt);});
 bindButton('begin',()=>{score=0;lives=3;kills=0;bestCombo=0;runTime=0;startStage(startAt);});bindButton('back',menu);paintSelection();
}
// The chapter list keeps each chapter's `brief` (PLAN §7 G6 2: the card and the intermission panels open a chapter in
// play; the brief is the chapter-select text): it shows for the chapter under the pointer or the focus.
function chapters(){state='chapters';const brief=i=>i>save.unlocked?'Clear the chapter before it to unlock this one.':LEVELS[i].brief;
  panel(`<section class="panel small-panel"><p class="eyebrow">THE CROWN TIDE</p><h2>SIX CHAPTERS. ONE TRAIL.</h2><p>Clear a chapter to unlock it here. Progress saves at every section of a chapter.</p><div class="level-grid">${LEVELS.map((l,i)=>`<button data-level="${i}" ${i>save.unlocked?'disabled':''}><span>CHAPTER 0${i+1} ${i>save.unlocked?'· LOCKED':''}</span>${l.name}</button>`).join('')}</div><p class="chapter-brief" id="chapter-brief"><b>CHAPTER 01 · ${LEVELS[0].area.split('/')[1].trim()}</b><br>${brief(0)}</p><div class="menu-buttons"><button id="back" class="secondary">← MAIN MENU</button></div></section>`);
  document.querySelectorAll('[data-level]').forEach(b=>{b.onclick=()=>characterSelect(+b.dataset.level);const show=()=>{const i=+b.dataset.level,el=document.getElementById('chapter-brief');if(el)el.innerHTML=`<b>CHAPTER 0${i+1} · ${LEVELS[i].area.split('/')[1].trim()}</b><br>${brief(i)}`;};b.addEventListener('mouseenter',show);b.addEventListener('focus',show);});bindButton('back',menu);}
function guide(back){state='guide';panel(`<section class="panel small-panel"><p class="eyebrow">ARCADE FIELD GUIDE</p><h2>GET BACK IN THE FIGHT.</h2><div class="controls-list"><strong>WASD / ↑↓←→</strong><span>Move along the street and between lanes.</span><strong>J / Z</strong><span>Unarmed: tap or hold for punch, punch, kick, finisher; the chain continues only while blows connect. Standing on a weapon: crouch and pick it up. Holding a gun: fire only, even at close range. An empty gun is hurled at the enemy.</span><strong>GRAB</strong><span>Walk into an enemy to grab them. J knees; back + J throws them over your shoulder into the others; the fourth J throws forward.</span><strong>K / X</strong><span>Jump. Dodge shockwaves and low attacks.</span><strong>L / C</strong><span>Special move, also J + K together. Costs health when it hits; drops your weapon.</span><strong>E / V</strong><span>At a console or pod: hold to operate, or tap to tune the marked channel. Elsewhere: pick up or throw a weapon.</span><strong>SHIFT</strong><span>Run left or right, or double tap ← / →. Guns stay at the hip while you run. Run + attack: Mustapha’s flying kick, Jack’s slide, Hannah’s knee or Mess’s body splash.</span><strong>ESC / P</strong><span>Pause. Gamepad: stick / D-pad, X hit, A jump, Y special, B pick.</span></div><p>Enemies arrive from the edges of the screen or drop from above — watch both sides. Break barrels for food and weapons. Finish the marked objective to open the route. In the last chapter every collar pylon you break frees conscripts, and they fight on your side. Highway: steer into enemies, J bash, K boost, L ram.</p><div class="menu-buttons"><button id="back" class="primary">GOT IT →</button></div></section>`);bindButton('back',back);}

// Chapter layout (ARCHITECTURE §2.4, §4.3; PLAN §4.2, §7 G2): a chapter is STAGE_DATA's areas, each in its own x space
// (0..w), joined by fades. A campaign section names its STAGE_DATA section (`stage`): its x0 and length in the area, its
// locks (absolute area x, one per ordinary encounter in order), its boss lock and its props. A fight's lock fires when the
// CAMERA reaches the lock x and then holds the screen [x, x+384]; skipTo and checkpoints put the hero LOCK_LEAD px into it.
const LOCK_LEAD=189,CAM_LEAD=192,OBJ_MARGIN=[96,64];
const SD=window.STAGE_DATA,STG=window.STAGE,SR=window.STAGE_RENDER;
// a chapter's boss art (the lazy sheets of its generated boss bodies) loads with the chapter, like its stage pages
const bossArt=i=>window.SEQUEL_RENDER?.bossArt?.(i);
const chapterKey=i=>'ch'+(i+1);
let areaIndex=0,fade=null,roadRate=0;
const curArea=()=>plan?.areas?.[areaIndex]?.data||null;
// Every arcade weapon turns up in the containers, plus food, score items and ammunition.
const LOOT=['food','gun','bonus','rod','shotgun','food','uzi','grenade','food','rifle','club','ammo','m16','dynamite','food','bazooka','knife','torch','food','stone','bonus','food'];
const BREAKABLE=new Set(['crate','barrel']);
function buildPlan(i){
  const ch=SD.chapters[chapterKey(i)],areas=ch.areas.map((a,k)=>({index:k,id:a.id,w:a.w,h:a.h,data:a,x0:0}));
  let length=0;for(const a of areas){a.x0=length;length+=a.w;}
  const sections=[],encounters=[];let n=i*3;
  LEVELS[i].sections.forEach((s,si)=>{
    const ref=SD.sections[s.stage],ar=areas[ref.area],def=(ar.data.sections||[]).find(d=>d.id===s.stage)||{locks:[],props:[]},props=def.props||[];
    const sec={index:si,name:s.name,say:s.say,drive:!!s.drive,x:ref.x0,len:ref.len,area:ref.area,first:encounters.length,stage:s.stage,cap:s.cap||def.cap||null,props,set:def.set||[],scenery:def.scenery||[],cast:def.cast||null,objects:[],drops:[]};
    // Containers and drops are the section's authored props (G6: every container is STAGE_DATA data; the old loot run of
    // one container per 385 px now lives in the recipes, tools/re/levels/ch<N>.json, at the same places and in the same
    // order, so the chapter counter n still gives the same lanes and contents). A crate is drawn as the ROM's oil drum
    // (DRAMCAN), a barrel as TARU (ROM_FX.props, drawObject).
    for(const p of props.filter(p=>BREAKABLE.has(p.kind)||p.kind==='drop')){if(p.kind==='drop')sec.drops.push({x:sec.x+p.x,type:p.type});else{sec.objects.push({x:sec.x+p.x,lane:(22+(n*37)%80)/109,type:p.kind,content:p.content||LOOT[n%LOOT.length]});n++;}}
    const parked=props.find(p=>p.kind==='parked-car');if(parked)sec.parkedCar=sec.x+parked.x;
    sections.push(sec);
    let k=0;
    s.enc.forEach((e,j)=>{
      const id=`${s.stage}/${j}`,seg=(ar.data.camera||[]).find(c=>c.id===id);
      let x=seg?seg.x:e.boss?def.bossLock:(def.locks||[])[k];if(!e.boss)k++;
      if(!Number.isFinite(x))x=sec.x+192+448*j;   // not expected: tests/campaign.cjs checks the lock count of every section
      x=clamp(x,0,Math.max(0,ar.w-W));
      encounters.push({...e,x,cam:x,lockId:id,section:si,area:ref.area});
    });
  });
  return {areas,sections,encounters,length};
}
// The walkable band and mask (ARCHITECTURE §4.3): STAGE.bandAt/walkable/resolveMove on the current area; positions beyond
// the map ends use the edge column. The authored hazard rects (pits, water edges: terrain classes are not decoded) are
// no-go zones for every body.
const bandOf=(x=player?player.x:0)=>{const a=curArea(),b=(a&&STG.bandAt(a,x))||[128,216];return {top:b[0],bottom:b[1],mid:(b[0]+b[1])/2,h:b[1]-b[0]};};
// A depth lane as a fraction of the band: 0 the back edge, 1 the front edge (today's fixed lanes, CODE-MAP §9.4).
const laneY=(f,x)=>{const b=bandOf(x);return b.top+f*b.h;};
function hazardAt(x,y){const a=curArea();if(!a||!a.hazards)return null;for(const h of a.hazards){const r=h.rect;if(x>=r[0]&&x<r[0]+r[2]&&y>=r[1]&&y<r[1]+r[3])return r;}return null;}
// Moves a body from (x0,y0) toward (x1,y1) over the walk mask: STAGE.resolveMove tries x, then y, then applies the screen
// and lock clamps in opts. A step that would end in a hazard keeps whichever axis stays clear; a body already inside one
// (knocked in) is pushed out across the nearer edge.
function walkTo(x0,y0,x1,y1,opts){
  const a=curArea();if(!a)return {x:x1,y:y1};
  const r=STG.resolveMove(a,x0,y0,x1,y1,opts),h=hazardAt(r.x,r.y);if(!h)return r;
  if(!hazardAt(r.x,y0)&&STG.walkable(a,r.x,y0))return {x:r.x,y:y0};
  if(!hazardAt(x0,r.y)&&STG.walkable(a,x0,r.y))return {x:x0,y:r.y};
  if(!hazardAt(x0,y0)&&STG.walkable(a,x0,y0))return {x:x0,y:y0};
  const b=bandOf(r.x),out=[h[1]-1,h[1]+h[3]].filter(y=>y>=b.top&&y<=b.bottom&&!hazardAt(r.x,y)).sort((p,q)=>Math.abs(p-r.y)-Math.abs(q-r.y));
  return out.length?{x:r.x,y:out[0]}:r;
}
// A spot for a prop or mission object at about x on lane fraction f, so it can be walked up to from either side: the lane
// is taken in the band shared by the columns x±48 (no band step under it, at least 24 px of it) and kept 64 x 32 px clear
// of the hazard rects, trying the other lanes and then x moves of 32 px inside [lo, hi] (only the lane moves when lo=hi).
function hazardNear(x,y,mx,my){const a=curArea();for(const h of a?.hazards||[]){const r=h.rect;if(x>r[0]-mx&&x<r[0]+r[2]+mx&&y>r[1]-my&&y<r[1]+r[3]+my)return true;}return false;}
function spotAt(x,f,lo=x,hi=x){
  for(const d of [0,-32,32,-64,64,-96,96,-128,128]){
    const cx=clamp(x+d,lo,hi);let top=-1e9,bottom=1e9;for(let k=-48;k<=48;k+=16){const b=bandOf(cx+k);top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}
    if(bottom-top>=24)for(const g of [f,1-f,.5,.2,.8]){const y=top+g*(bottom-top);if(!hazardNear(cx,y,64,32))return {x:cx,y};}
    if(lo===hi)break;
  }
  const cx=clamp(x,lo,hi);return {x:cx,y:laneY(f,cx)};
}
// Props of the current area's sections from `from` on (PLAN §7 G2 6): containers, drops and the parked Cadillac at their
// section x on a band lane. Mission objects (pods, cargo, gates, beacons, valves, tuners) appear with their encounter
// (createTaskFor). `supply` (a chapter start or a checkpoint) adds the start kit: a weapon unless the section authors a
// drop, and a meal (the one foodDrop call of the old placeProps, so the seeded random sequence is unchanged).
function placeProps(from,supply=false){
  for(const s of plan.sections){if(s.index<from||s.area!==areaIndex)continue;
    for(const o of s.objects)objects.push({x:o.x,y:spotAt(o.x,o.lane).y,hp:28,type:o.type,content:o.content});
    for(const d of s.drops)drops.push({x:d.x,y:spotAt(d.x,.7).y,type:d.type,life:999});
    if(s.parkedCar!==undefined)parkedCar={x:s.parkedCar,y:spotAt(s.parkedCar,.51).y};}
  const s=plan.sections[from];if(!supply||s.drive)return;
  const x=from?s.x+89:170;if(!s.drops.length)drops.push({x,y:laneY(.7,x),type:levelIndex===0&&from===0?'gun':'shotgun',life:999});drops.push(foodDrop(x+30,laneY(.83,x),999,true));
}
// Puts the hero at the start of area k (or of section `from` inside it) on a fresh screen: the fighters, shots, drops and
// props of the old area go, this area's props are placed and the freed conscripts regroup behind the hero.
function enterArea(k,from=plan.sections.findIndex(s=>s.area===k),supply=false){
  areaIndex=k;const a=curArea(),sec=plan.sections[from],first=plan.sections.findIndex(s=>s.area===k)===from;
  lock=null;encounter=null;fade=null;enemies=[];bullets=[];discards=[];zones=[];effects=[];particles=[];floating=[];crown=null;spillWheels=[];bossObjs=[];bossCard=null;drops=[];objects=[];scenery=[];parkedCar=null;lastHitEnemy=null;
  if(mission)mission.items=mission.items.filter(t=>t===mission.active&&!t.done);
  roadStream=0;roadRate=0;SR.resetStream(a);
  const x=first?a.start.x:sec.x+60,b=bandOf(x);
  // every player in, slot order, 24 px apart on lanes 12 px above and below the first (§3.6)
  const y0=clamp(first?a.start.y:b.top+.62*b.h,b.top,b.bottom),ps=multi()?present():[player];
  ps.forEach((p,k)=>{const bk=bandOf(x-24*k);p.x=x-24*k;p.y=k?clamp(y0+[0,-12,12][k],bk.top,bk.bottom):y0;p.z=0;p.vz=0;p.vx=0;p.vy=0;});const lp0=ps[0];
  const next=plan.encounters.find(e=>e.area===k&&e.section>=from);
  camera=first?0:clamp(sec.x,0,Math.min(Math.max(0,a.w-W),next?next.cam:Infinity));cameraY=STG.pathY(a,camera);
  allies.forEach((al,j)=>{al.x=lp0.x-44-j*33;const ab=bandOf(al.x);al.y=clamp(lp0.y+al.lane,ab.top+4,ab.bottom-4);al.state='enter';al.target=null;});
  placeProps(from,supply);
}
// Area exits fade the brightness down in 16 steps of 2 frames, switch the area and camera, and fade back in (ARCHITECTURE
// §2.4, §4.5). The simulation waits during the fade.
const FADE_STEP=2/60;
function startFade(to){const k=plan.areas.findIndex(a=>a.id===to);if(k<0||k===areaIndex)return;SR.require(levelIndex);fade={to:k,t:0,out:true};}
function switchArea(k){enterArea(k);const first=plan.sections.findIndex(s=>s.area===k);encIndex=Math.max(encIndex,plan.encounters.findIndex(e=>e.area===k));enterSection(first);}
function updateFade(dt){fade.t+=dt;if(fade.t<16*FADE_STEP-1e-9)return;if(fade.out){const k=fade.to;switchArea(k);fade={to:k,t:0,out:false};}else fade=null;}
const fadeAlpha=()=>{if(!fade)return 0;const b=Math.min(15,Math.floor(fade.t/FADE_STEP+1e-9));return fade.out?b/15:1-b/15;};
// ---------------------------------------------------------------- presentation (PLAN §7 G6; CAMPAIGN §4.7, §11)
// The arcade's screens, drawn on the canvas by ARCADE_UI in arcade screen px: the chapter card and the intermission
// panels (state 'brief'), the area caption, the stage-clear tally, the attract story, the ending beats and the staff
// roll. Every clock below counts 60 Hz frames of the update (never the wall clock), so a step of the test API advances
// them exactly as play does; the HTML overlay only carries the buttons (and the long prose: the clear text, the end).
// Nothing here calls Math.random. Text is typed at ARCADE_UI's 2 characters per frame (CAMPAIGN D11).
const PANEL_HOLD=210,CARD_HOLD=90,BOX_HOLD=90,TALLY_FRAMES=210,CAPTION_FRAMES=150;
const UI=()=>window.ARCADE_UI||null;
const typeRate=()=>UI()?.LIMITS?.typeRate||2;
const panelChars=p=>[...(p?.lines||[]),...(p?.lines2||[])].join('').length;
const panelFrames=p=>Math.ceil(panelChars(p)/typeRate());
let card=null,caption=null,clearSeq=null,finalBlow=false,stageKills=0,blowKind=null;
// The chapter card (ROM_UI.card: the 1993 title-card panel re-rendered from the ROM, its map with a blinking marker,
// "CHAPTER N" and the name typed under it; chapter 1 first shows card.pre, as EPISODE 1 opened on a caption), then the
// chapter's inter[] panels (layouts A/B/C, ROM portraits), then play. A checkpoint resume shows the card only.
function startCard(i,start){card={i,start,phase:'card',k:0,t:0,pre:i===0&&start===0&&level.card?.pre?level.card.pre:null};preloadPics();}
const cardPanels=()=>card&&card.start===0?(level.inter||[]):[];
const cardFrames=()=>(card.pre?(UI()?.TIMING?.pre||120):0)+Math.ceil((('CHAPTER '+(card.i+1)).length+level.name.length)/typeRate());
function updateCard(dt){
  if(!card)return;card.t+=dt*60;
  if(card.phase==='card'){if(card.t>=cardFrames()+CARD_HOLD)nextCard();}
  else if(card.phase==='panel'){if(card.t>=panelFrames(cardPanels()[card.k])+PANEL_HOLD)nextCard();}
  else if(card.phase==='wait'&&SR.ready(levelIndex))enterPlay();
}
function nextCard(){
  const P=cardPanels();
  if(card.phase==='card'&&P.length){card.phase='panel';card.k=0;card.t=0;return;}
  if(card.phase==='panel'&&card.k+1<P.length){card.k++;card.t=0;return;}
  // the card sequence ends on the chapter's first screen; play waits for its stage pages (ARCHITECTURE §5.5)
  if(SR.ready(levelIndex))enterPlay();else{card.phase='wait';card.t=0;}
}
// a button finishes the typing first, then moves on
function cardAdvance(){if(!card||state!=='brief')return;const full=card.phase==='card'?cardFrames():card.phase==='panel'?panelFrames(cardPanels()[card.k]):0;if(card.t<full)card.t=full;else nextCard();}
// Play begins: the chapter's `dialog` goes on the radio first (CAMPAIGN §14 startStage), ahead of the section's line.
function enterPlay(){if(state!=='brief')return;const fresh=!card||card.start===0;card=null;state='play';panel('');resetInput();canvas.focus();if(fresh)queueDialog();voice('go');}
function queueDialog(){const lines=String(level.dialog||'').split('\n').map(s=>s.trim()).filter(l=>l&&radio?.text!==l&&!radioQueue.includes(l));radioQueue=lines.concat(radioQueue);}
// The intermission pictures (CAMPAIGN §4.7 picture table). Each shipped PNG (STAGE_DATA.pics, WP-E) is its picture's
// ROM-cell background (tools/re/levels/pics.json); the subject the table puts in it (pics.json `sprites`: FERRIS
// rolling a crate, the prison pods, the frosted crate, the manifest, the convoy, the hatchling, Glassback asleep, the
// ledger, Echo's sound bars, her four unfinished copies, MARSHAL SABLE and a guard) is drawn over it here from the ROM records in their palette maps,
// one arcade px per art px, once the background and the sprite families have decoded. The composed picture replaces
// the PNG in ARCADE_UI (registerPic); until then a panel shows the background alone. A picture with a `live` part
// redraws it over the still every frame from the panel's own clock (picFrame). Nothing here calls Math.random.
function preloadPics(){const P=SD?.pics||{};for(const id of Object.keys(P))picBase(id);}
const PIC_W=224,PIC_H=96,picDone={},picBases={},picFails={};
// the shipped background, kept apart from the composed picture that replaces it in ARCADE_UI
function picBase(id){const U=UI(),P=SD?.pics?.[id];if(!U||!P)return null;return picBases[id]||(picBases[id]=U.resolvePic(id,P.w,P.h));}
function picCanvas(w=PIC_W,h=PIC_H){const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.imageSmoothingEnabled=false;return {c,g};}
const famsReady=l=>(l||[]).every(f=>f==='rig'?!!RIG()?.ready:!!window.SPRITES?.familyReady?.(f));
// one anim frame of an ENEMY_KINDS kind (ref ['main', n] or ['down', n]) in its palette map (or its gel map), feet at (x, y)
function kindFrameTo(g,kind,v,ref,k,x,y,dir,gel=false){const a=eAnim(EK?.resolve(kind,v,ref)),F=ROME(),t=EK?.typeOf(kind,v);if(!a||!F?.palMap||!t)return false;
  const f=a.f[clamp(k,0,a.f.length-1)];return drawRomFrame(f[0],x,y,dir,F.palMap[`${t}:${v}${gel?'/gel':''}`],'enemies',g);}
// one frame of a boss body's main set (ROM_BOSSES.bodies) in one of its palettes
function bodyFrameTo(g,body,n,k,x,y,dir,pal){const b=ROMB()?.bodies?.[body],a=b&&bAnim(`${b.main}:${n}`);if(!a)return false;
  const f=a.f[clamp(k,0,a.f.length-1)];return drawRomFrame(f[0],x,y,dir,b.pal?.[pal]||pal,'bosses',g);}
// an fx record (the containers) in an OBJ page's colours, feet at (x, y)
function fxTo(g,rec,x,y,dir,page){const R=RIG();return !!(R&&rec!=null&&R.draw(g,[{fam:'fx',sheet:'items',rec,x:0,y:0,mapKey:page}],x,y,0,dir>0?1:-1,1,'hero'));}
// a console screen (the manifest, the ledger): dark glass, scanlines, rows in the 8x8 font
function monitorTo(g,x,y,w,h,rows){const U=UI();if(!U)return false;
  rect(g,x-4,y-4,w+8,h+8,'#26343a');rect(g,x-4,y-4,w+8,1,'#6d8388');rect(g,x-4,y+h+3,w+8,1,'#10181b');rect(g,x,y,w,h,'#041611');for(let j=1;j<h;j+=2)rect(g,x,y+j,w,1,'#0a241a');
  rows.forEach(([s,pen],i)=>U.text(g,s,x+w/2,y+5+i*12,{font:8,align:'center',pen,shadow:false,trace:false}));return true;}
// a prison pod on its side (the mission pod turned over): frame, end caps, the sedated prisoner inside, sedative and frosted glass
function coldPodTo(g,x,y,w,h,sleeper){
  rect(g,x+10,y+h,6,5,'#1b2a2e');rect(g,x+w-16,y+h,6,5,'#1b2a2e');rect(g,x,y,w,h,'#4b5d63');rect(g,x+2,y+2,w-4,h-4,'#0c2224');
  g.save();g.beginPath();g.rect(x+2,y+2,w-4,h-4);g.clip();rect(g,x+2,y+2,w-4,h-4,'#3fbf8a30');const ok=sleeper();rect(g,x+2,y+2,w-4,h-4,'#3fbf8a50');
  for(let i=0;i<7;i++)rect(g,x+12+i*Math.floor((w-24)/6),y+h-6-(i*9)%(h-10),2,2,'#c8ffe0');g.restore();
  rect(g,x+6,y+4,w-12,2,'#ffffff38');rect(g,x+6,y+h-6,w-12,1,'#ffffff20');
  for(let i=0;i<11;i++){const fx=x+4+(i*41)%(w-12),fy=i%2?y+2:y+h-4;rect(g,fx,fy,3+(i%3)*2,2,'#e2f6ff88');}
  for(const ex of [x-6,x+w-2]){rect(g,ex,y-3,8,h+6,'#6f8288');rect(g,ex,y-3,8,1,'#a9bcc0');rect(g,ex+3,y+4,2,h-8,'#4b5d63');}
  return ok;}
const PIC_ART={
  // ch1 #0: two FERRIS (walk frames) roll a sequel crate (DRAMCAN's rolling frames) along the burning quay
  'p-barge-fire':{need:['enemies','fx','rig'],still(g){const D=FXF()?.containers?.drum?.anims?.[2];if(!D)return false;
    return kindFrameTo(g,'raider','A',['main',1],3,74,88,1)&&fxTo(g,D[2][0],152,93,1,'S1A0')&&kindFrameTo(g,'raider','A',['main',1],0,120,94,1);}},
  // ch1 #1: two prison pods close up, a sedated FERRIS behind each pane, green through the sedative (his gel map; Chinpira down 2, the flat frame)
  'p-pod-face':{need:['enemies'],still(g){let ok=true;
    for(const [x,y,d] of [[22,14,-1],[74,52,1]])ok=coldPodTo(g,x,y,136,30,()=>kindFrameTo(g,'raider','A',['down',2],1,x+68,y+27,d,true))&&ok;return ok;}},
  // attract #1: a frosted cold crate (DRAMCAN lying) swung up out of the bay on a sling
  'p-salvage-boats':{need:['fx','rig'],still(g){const rec=FXF()?.containers?.drum?.anims?.[1]?.[0]?.[0];if(rec==null)return false;
    const T=picCanvas();if(!fxTo(T.g,rec,150,60,1,'S1A0'))return false;
    T.g.globalCompositeOperation='source-atop';rect(T.g,0,0,PIC_W,PIC_H,'#d6f2ffa0');for(let i=0;i<26;i++)rect(T.g,110+(i*29)%80,27+(i*11)%34,2+(i%3),1,i%3?'#f4fcff':'#9fc8dc');T.g.globalCompositeOperation='source-over';
    g.strokeStyle='#b9a678';g.lineWidth=1;g.beginPath();g.moveTo(150.5,0);g.lineTo(150.5,9);g.moveTo(150.5,9);g.lineTo(118.5,30);g.moveTo(150.5,9);g.lineTo(182.5,30);g.stroke();rect(g,148,7,5,4,'#7c858c');
    g.drawImage(T.c,0,0);for(let i=0;i<8;i++)rect(g,116+i*9,61+(i*5)%11,1,2,'#9fd8ff');return true;}},
  // ch2 #0: Rook's manifest on a console screen, in the scroll1 font: the pods signed over as labor for the Crown
  'p-manifest':{need:['ui'],still:g=>monitorTo(g,20,20,184,44,[['PRISON LABOR · WASSOON','grey'],['PODS 07 / 09 / 12 / 31','acid'],['FOR THE CROWN WORKS','grey']])},
  // ch2 #1: three bikers ride escort on a pod wagon (the convoy flatbed) across the causeway. Two lanes, back to front:
  // the third rider's front wheel noses in at the left edge, the lead rider is ahead on the far lane, the wagon rolls
  // between the lanes and one rider runs beside it on the near lane; every rider's feet are low enough (y >= 70) for
  // the whole rider to fit under the top edge (G6 verify r2 #4)
  'p-convoy':{need:['enemies'],still(g){let ok=kindFrameTo(g,'biker','R',['main',0],1,30,74,1);ok=kindFrameTo(g,'biker','R',['main',0],2,180,74,1)&&ok;
    g.save();g.translate(112,94);g.scale(LEG,LEG);cargoArt(g,0,0,0,false);g.restore();return kindFrameTo(g,'biker','R',['main',0],0,-52,96,1)&&ok;}},
  // ch3 #0: a hatchling (small raptor 0x4DBA0) curled in its egg, one VICE chain link for a collar
  'p-hatchling':{need:['enemies','bosses'],still(g){const cx=112,cy=58;
    g.save();g.fillStyle='#3fbf8a38';g.beginPath();g.ellipse(cx,cy,42,30,0,0,Math.PI*2);g.fill();g.restore();
    const ok=kindFrameTo(g,'hatchling','A',['main',2],0,cx+6,cy+18,-1);
    g.save();g.fillStyle='#5fe0a830';g.beginPath();g.ellipse(cx,cy,42,30,0,0,Math.PI*2);g.fill();g.strokeStyle='#a8f4cc99';g.lineWidth=1;g.stroke();
    g.strokeStyle='#ffffff66';g.beginPath();g.ellipse(cx-6,cy-8,30,18,0,Math.PI*1.1,Math.PI*1.45);g.stroke();g.restore();
    return drawChainLine(cx+4,cy-9,cx+4,cy-9,'S1A2',g)&&ok;}},
  // ch3 #2: Headkeeper Thorne (her own body, idle) at her nest, the sonic driver humming beside her (the boss rebuild:
  // the AROSAURUS stand-in no longer ships)
  'p-regent-asleep':{need:['bosses'],still(g){const b=ROMB()?.bodies?.thorne;if(!b)return false;
    g.save();g.translate(196,90);g.scale(LEG,LEG);consoleArt(g,0,0,'#efaa71',true);g.restore();
    return bodyFrameTo(g,'thorne',0,0,120,92,-1,b.use);}},
  // ch4 #0: the handlers' ledger on a console screen: Echo's graft samples, all out of the Sink, and the marshal's order
  'p-ledger':{need:['ui'],still:g=>monitorTo(g,20,20,184,44,[['SAMPLES: THE SINK','acid'],['ADAPTIVE TRIAL 01-11','grey'],['PRIORITY: THE MARSHAL','grey']])},
  // ch5 #1 (layout C, so a narrower crop that leaves room for the line beside it): Echo is a voice, never a face, so the
  // console's speaker grille with her sound bars moving with her voice
  'p-echo-speaker':{need:[],size:[144,88],crop:[40,4],still(g){rect(g,28,10,88,68,'#1c262a');rect(g,28,10,88,1,'#6d8388');rect(g,31,13,82,62,'#06100d');
    for(let y=16;y<72;y+=4)for(let x=34;x<110;x+=4)rect(g,x,y,2,2,'#14221e');return true;},
    live(g,t){const n=12,env=.25+.75*Math.abs(Math.sin(t*.031));for(let i=0;i<n;i++){const a=.1+.9*env*Math.abs(Math.sin(t*.23+i*.9)*Math.cos(t*.11+i*.37)),h=Math.max(2,Math.round(a*26)&~1);
      for(let y=0;y<h;y+=2){const c=y>=20?'#e8402c':y>=14?'#f8d838':'#9dff6d';rect(g,36+i*6,44-y,4,1,c);rect(g,36+i*6,45+y,4,1,c);}}}},
  // Echo's four unfinished copies of the gang (hero idle frames in the clone palette) on black; no panel shows it now
  'p-mirror-gang':{need:['rig','heroes'],bg:false,still(g){const R=RIG();let n=0;
    [1,2,0,3].forEach((h,k)=>{const id=HEROES[h].id,clip=R.clip(id,'idle');if(clip&&R.draw(g,R.parts(id,{full:{clip,k:0}},null),34+k*52,92,0,1,1,'mirror-'+id))n++;});return n===4;}},
  // ch6 #2: MARSHAL SABLE (his own body; VICE T. in the sable map without it) raising the pistol at the dam, from the knee up, and one of
  // his Crown Guard (POACHER J idle) at his shoulder
  'p-sable':{need:['bosses','enemies'],still(g){const guard=kindFrameTo(g,'gunner','A',['main',0],0,58,106,1);return (ROMB()?.bodies?.sable?bodyFrameTo(g,'sable',2,0,140,118,-1,'home'):bodyFrameTo(g,'richmond',13,2,140,118,-1,'sable'))&&guard;}},
};
// compose a picture once its background and families are ready; true once ARCADE_UI holds the composed picture. A
// subject whose records cannot be drawn with everything decoded is given up after 90 tries (the background stays).
function composePic(id){
  const A=PIC_ART[id],U=UI();if(!A||!U)return false;if(picDone[id])return true;if(!famsReady(A.need)||(picFails[id]|0)>90)return false;
  const base=A.bg===false?null:picBase(id);if(A.bg!==false&&!base?.img)return false;
  const [w,h]=A.size||[PIC_W,PIC_H],[sx,sy]=A.crop||[0,0],S=picCanvas(w,h);
  if(base)S.g.drawImage(base.img,sx,sy,w,h,0,0,w,h);else rect(S.g,0,0,w,h,'#000000');
  if(!A.still(S.g)){picFails[id]=(picFails[id]|0)+1;return false;}
  const out=A.live?picCanvas(w,h):S;if(A.live)out.g.drawImage(S.c,0,0);
  picDone[id]={still:S.c,c:out.c,g:out.g};U.registerPic(id,out.c,w,h);return true;
}
// before a panel draws: compose its picture, and redraw its live part for frame t of the panel
function picFrame(id,t){if(!id||!composePic(id))return;const P=picDone[id],A=PIC_ART[id];if(!A.live)return;P.g.drawImage(P.still,0,0);A.live(P.g,Math.max(0,t||0));}
// The ROM title-card panel as one picture (224x120: emblem, map, plate, bottom line), built once from the ui sheet.
let cardPanelPic=null;
function romCardPanel(){
  if(cardPanelPic)return cardPanelPic;const SP=window.SPRITES,U=window.ROM_UI,id=U?.cardFrame;if(!SP||!U||!id||!SP.familyReady?.('ui'))return null;
  const r=U.rect?.ui?.[id];if(!r)return null;const c=document.createElement('canvas');c.width=r[2];c.height=r[3];const g=c.getContext('2d');
  if(!SP.drawRec(g,'ui',id,U.map||'ui',0,0,false))return null;return (cardPanelPic={img:c,w:r[2],h:r[3],id});
}
// The card is drawn over the chapter's first screen with the hero standing at the start, as the 1993 title card is
// (stages/screens/card3-f0300: the panel at the top of the stage, EPISODE N and the typed name under it); the ROM panel
// sits at (80,0), so its map rows land where ARCADE_UI.card puts the map and the marker (80,16). The intermission
// panels are full black screens (layouts A/B/C).
let noPic=null;
function drawCardScreen(){
  const U=UI();if(!U||!card)return;
  if(card.phase==='card'||card.phase==='wait'){
    const t=card.phase==='wait'?Infinity:card.t,pre=card.pre&&t<(U.TIMING?.pre||120),pic=pre?null:romCardPanel();
    if(pic){ctx.drawImage(pic.img,80,0);if(!noPic){noPic=document.createElement('canvas');noPic.width=noPic.height=1;}}
    U.card(ctx,{pre:card.pre,chapter:card.i+1,name:level.name,marker:level.card?.marker,t,...(pic?{map:{img:noPic,w:224,h:96},frame:false}:{})});
  }else{rect(ctx,0,0,W,H,'#000000');const p=cardPanels()[card.k];if(p)picFrame(p.pic,card.t);if(p)U.panel(ctx,{...p,typed:card.t,accent:level.accent,hero:HEROES[selected].id});}
}
// Stage clear (CAMPAIGN §4.7): CHAPTER N CLEAR and the tally (VITALITY = hp x 100, ENEMIES = the chapter's beaten
// enemies x 100, FINAL BLOW = 20 000 when a special or a thrown weapon finished the boss, TOTAL, which is the clear
// bonus) over the hero's victory pose; then the chapter's `end` text is typed in the panel.
function updateClear(dt){
  if(!clearSeq)return;clearSeq.t+=dt*60;
  if(!clearSeq.story&&clearSeq.t>=TALLY_FRAMES)clearStory();
  if(clearSeq.story){clearSeq.typed+=dt*60*typeRate();const el=document.getElementById('clear-end'),n=Math.min(level.end.length,Math.floor(clearSeq.typed));if(el&&+el.dataset.n!==n){el.textContent=level.end.slice(0,n);el.dataset.n=n;}}
}
function clearNext(){if(levelIndex<5)startStage(levelIndex+1);else ending();}
function clearStory(){
  clearSeq.story=true;const T=clearSeq.tally;
  panel(`<section class="panel small-panel"><p class="eyebrow">CHAPTER 0${levelIndex+1} COMPLETE</p><h2>${levelIndex===5?'THE CROWN HAS FALLEN.':'KEEP THE ENGINE RUNNING.'}</h2><p id="clear-end" data-n="0"></p><p style="color:var(--acid)">CLEAR BONUS ${T.total} · SCORE ${score.toString().padStart(6,'0')} · BEST COMBO ${bestCombo} · ${Math.floor(stageTimer/60)}:${Math.floor(stageTimer%60).toString().padStart(2,'0')}</p><div class="menu-buttons"><button id="next" class="primary">${levelIndex===5?'SEE THE ENDING':'NEXT CHAPTER'} →</button></div></section>`);bindButton('next',clearNext);
}
// The players of a chapter (§3.2): single player one hero (`selected`, today's score and lives); a host's roster (START)
// or the players already in (the next chapter, a retry, a restart) keep their heroes, scores and lives (a player out
// of credits comes back with 3). This machine's player takes the globals, the others start their own.
function buildPlayers(roster){
  if(ctxPlayer&&ctxPlayer.mp)saveCtx(ctxPlayer);
  const old=players;let list;
  if(roster&&roster.length)list=roster.filter(r=>r&&r.slot>=0&&r.slot<MAXP).map(r=>({slot:r.slot|0,hero:r.hero|0,name:r.name}));
  else if(NETROLE==='host'&&old.some(Boolean))list=old.filter(Boolean).map(p=>({slot:p.mp.slot,hero:p.mp.hero,name:p.mp.name}));
  else list=[{slot:0,hero:selected}];
  if(!list.some(r=>r.slot===localSlot))list.unshift({slot:localSlot,hero:selected});
  players=[];
  for(const r of list){
    if(players[r.slot])continue;
    const loc=r.slot===localSlot,hero=clamp(loc&&!roster?selected:r.hero,0,3),prev=old[r.slot],p=attachMp(freshHero(HEROES[hero].hp*rules().playerHealth),r.slot,hero,r.name||prev?.mp.name),m=p.mp;
    if(loc){m.score=score;m.lives=lives;m.combo=combo;m.comboTimer=comboTimer;m.bestCombo=bestCombo;m.lastHitEnemy=lastHitEnemy;m.hudFoe=hudFoe;m.lastHeld=lastHeld;
      m.dashTime=dashTime;m.dashKey=dashKey;m.lastDirection=lastDirection;m.dashTap=dashTap;m.heroAnim=heroAnim;m.in=LOCAL_IN;}
    else{if(prev){m.score=prev.mp.score;m.lives=prev.mp.out||prev.mp.lives<=0?3:prev.mp.lives;m.bestCombo=prev.mp.bestCombo;m.in=prev.mp.in;}m.in=m.in||makeInput();m.heroAnim=freshHeroAnim();}
    players[r.slot]=p;
  }
  refreshPlayers();lastDriver=null;loadCtx(players[localSlot]);
  if(multi())for(const p of present())p.mp.tag=2;
}
// A hero on the field at a chapter start (or a drop-in): the per-hero state the update and the clips read.
function freshHero(hp){return {x:0,y:0,z:0,vz:0,dir:1,hp,maxhp:hp,hurt:0,inv:1.5,attack:0,attackTotal:.38,special:0,specialCd:0,comboStep:0,weapon:null,ammo:0,move:false,run:false,anim:null,boost:0,boostCd:0,knocked:false,attackKind:"combo",pendingStrike:null,moveState:null,freeze:0,comboWin:0,comboHit:false,grab:null,grabCd:0,pickup:0,pickTarget:null,land:0,walkDist:0,runDist:0,roll:0,vx:0,vy:0,bank:0,bump:0,dust:0,
    // G3c ROM timing (HEROES §6): each state's length and its clip; `*Total` is the state's length, so the clip frame on
    // show is the elapsed time (total - remaining). runLatch: the KI22 run that persists after the stick is released.
    landRole:'land',landTotal:0,hurtRole:'hurt',knockRole:'knock',hurtTotal:0,pickupTotal:0,pickAt:0,specialTotal:0,shotT:9,swing:null,
    dashPhase:null,dashT:0,airRole:null,airAttacked:false,jumpRole:null,turnAt:-9,runLatch:0,dropIn:false,dying:false,downT:0,victoryT:null,
    // G3d: the bazooka push (px/s, braking px/s²; HEROES §7.6) and the Uzi/M-16 walking burst (ROM state 0x1E).
    pushV:0,pushA:0,walkFire:false,
    // G4: the KI21 stun meter (10, refilled at a knockdown and 2 s after the last hit).
    stun:10,stunT:0};}
function startStage(i,opts={}){
  if(typeof opts==='boolean')opts={skipBrief:opts};
  levelIndex=i;level=LEVELS[i];plan=buildPlan(i);level.length=plan.length;
  buildPlayers(opts.roster);
  enemies=[];allies=[];objects=[];drops=[];particles=[];bullets=[];discards=[];zones=[];floating=[];effects=[];scenery=[];crown=null;spillWheels=[];bossObjs=[];bossCard=null;bossIntro=0;lastHitEnemy=null;dashTime=0;wave=0;lock=null;bossSpawned=false;cleared=false;stageTimer=0;combo=0;comboTimer=0;shake=0;flash=0;hitstop=0;
  encIndex=0;encounter=null;sectionIndex=-1;radio=null;radioQueue=[];alliesFreed=0;parkedCar=null;road=0;roadStream=0;cameraY=0;fade=null;initMission();
  card=null;caption=null;clearSeq=null;endSeq=null;endLot=null;lastLot00=null;finalBlow=false;blowKind=null;stageKills=kills;
  // The chapter's stage pages load lazily (area 0 first); the simulation never waits for them (ARCHITECTURE §5.5).
  // STAGE.use makes an area index or id (STAGE.bandAt(0, x)) refer to this chapter.
  SR.require(i);bossArt(i);STG.use(chapterKey(i));heroRigChapter(i);heroAnimReset();voicePrefetch();
  const start=clamp(opts.section|0,0,plan.sections.length-1),sec=plan.sections[start];
  encIndex=sec.first;
  // Objectives finished before this checkpoint stay finished, including conscripts already freed.
  if(start>0)for(const e of plan.encounters.slice(0,sec.first))if(e.task!==undefined){mission.completed++;alliesFreed+=mission.spec.tasks[e.task][4]||0;}
  driving=!!sec.drive;enterArea(sec.area,start,true);enterSection(start,true);
  for(let k=0;k<alliesFreed;k++)spawnAlly(k,true);
  resetInput();started=true;toast=driving?(TOUCH?'STICK STEERS · HIT BASHES · JUMP BOOSTS':'STEER ↑↓ · RAM ENEMIES · J BASH · K BOOST'):start?'CHECKPOINT · '+sec.name:TOUCH?'STICK MOVES · PUSH TO THE EDGE TO RUN · HIT · JUMP · PICK':'MOVE → · J ATTACK · K JUMP · E PICK UP';toastTime=6;
  // LAST_EDEN.start (the tests and the bot) skips the card, its panels and the opening dialog.
  if(opts.skipBrief){state='play';panel('');canvas.focus();return;}
  // The card state (PLAN §7 G6 2): the canvas shows the chapter card and the intermission panels; the overlay keeps
  // NEXT and ENTER (#enter-stage skips straight to play, as Enter does).
  const resume=start?`<p class="dock-note">RESUMING AT SECTION ${start+1} · ${sec.name}</p>`:'';
  state='brief';startCard(i,start);panel(`<section class="panel dock-panel card-dock"><p class="eyebrow">CHAPTER 0${i+1} · ${level.area.split('/')[1].trim()} · ${level.name}</p>${resume}<div class="menu-buttons"><button id="card-next" class="secondary">NEXT ›</button><button id="enter-stage" class="primary">${driving?'START YOUR ENGINE':'ENTER THE CHAPTER'} →</button></div></section>`);bindButton('card-next',cardAdvance);bindButton('enter-stage',enterPlay);
  // ENTER waits until the chapter's first two screens of stage pages are decoded (ARCHITECTURE §5.5), 5 s at most.
  const go=document.getElementById('enter-stage');
  if(go&&!SR.ready(i)){go.disabled=true;const t0=performance.now(),poll=setInterval(()=>{if(!go.isConnected||state!=='brief'){clearInterval(poll);return;}if(SR.ready(i)||performance.now()-t0>5000){go.disabled=false;clearInterval(poll);}},100);}
}
function enterSection(k,quiet=false){
  sectionIndex=k;const s=plan.sections[k];
  if(!!s.drive!==driving)setDriving(!!s.drive);
  else if(!quiet){toast=s.name;toastTime=3.5;}
  // The first section of an area carries the area caption (CAMPAIGN §4.7, §15.2 (6)): ROM 8x16 text on scroll1 row 23
  // for 2.5 s once the fade is over (update advances it only in play, outside fades). Section names stay checkpoint toasts.
  if(s.cap&&plan.sections.findIndex(x=>x.area===s.area)===k)caption={text:s.cap,t:0};
  if(s.say)say(s.say);
  spawnScenery(s);
  checkpoint();
}
// in or out of the Cadillac (a section's drive flag, or a boss that stops the convoy on the road)
function setDriving(on){
  {
    driving=!!on;flash=.45;shake=5;const ps=multi()?present():[player],lp=multi()?driverP():player;
    for(const p of ps){p.z=0;p.vz=0;p.pickup=0;p.vx=0;p.vy=0;p.bank=0;p.bump=0;}
    if(driving){for(const p of ps)withPlayer(p,dropWeapon);parkedCar=null;toast='BACK IN THE CADILLAC!';}
    // On foot the Cadillac stays where the section parks it (a 'parked-car' prop), else beside the hero; the riders get
    // out behind the driver.
    else{ps.forEach((p,k)=>{if(p!==lp){p.x=lp.x-26*k;p.y=lp.y;}});const ahead=!!parkedCar&&parkedCar.x>lp.x+W/2;if(!parkedCar)parkedCar={x:lp.x-22,y:clamp(lp.y,laneY(.15,lp.x),laneY(.88,lp.x))};toast=ahead?'ON FOOT · THE CADILLAC WAITS AHEAD':'ON FOOT · THE CADILLAC WAITS HERE';}
    toastTime=3.5;
  }
}
function pause(by='host'){if(NETROLE==='client'){window.EDEN_LOBBY?.confirmLeave?.();return;}if(state==='play'){state='paused';netPause(true,by);resetInput();panel(`<section class="panel small-panel"><p class="eyebrow">TAKE A BREATHER</p><h2>PAUSED.</h2><p>Chapter 0${levelIndex+1} · ${level.name}<br>Section ${sectionIndex+1} of ${plan.sections.length} · ${plan.sections[sectionIndex].name}<br>Your checkpoint is saved at the start of this section.</p><div class="menu-buttons"><button id="resume" class="primary">RESUME →</button><button id="controls" class="secondary">CONTROLS</button><button id="pause-sound" class="secondary">AUDIO SETTINGS</button>${TOUCH&&!root.classList.contains('standalone')?`<button id="pause-full" class="secondary">${isFull()?'EXIT FULLSCREEN':'FULLSCREEN'}</button>`:''}<button id="restart" class="secondary">RESTART SECTION</button>${mpHosting()?'<button id="mp-end" class="secondary">END GAME FOR EVERYONE</button>':'<button id="quit" class="secondary">MAIN MENU</button>'}</div></section>`);bindButton('resume',resume);bindButton('mp-end',mpToRoom);bindButton('pause-sound',()=>soundRoom(()=>{state='play';pause();}));bindButton('pause-full',()=>{toggleFull();setTimeout(()=>{if(state==='paused'){state='play';pause();}},450);});bindButton('controls',()=>guide(()=>{state='play';pause();}));bindButton('restart',()=>startStage(levelIndex,{section:sectionIndex}));bindButton('quit',()=>{checkpoint();menu();});}else if(state==='paused')resume();}
function resume(){state='play';netPause(false);panel('');resetInput();canvas.focus();}
function gameover(){state='gameover';save.best=Math.max(save.best,score);persist();const at=Math.max(0,sectionIndex);panel(`<section class="panel small-panel"><p class="eyebrow">THE COUNT RAN OUT</p><h2>GAME OVER.</h2><p>No coin dropped in time. The gang can regroup at the start of section ${at+1}: ${plan.sections[at].name}.<br>Score ${score.toString().padStart(6,'0')} · Best combo ${bestCombo}</p><div class="menu-buttons"><button id="retry" class="primary">TRY AGAIN →</button><button id="quit" class="secondary">MAIN MENU</button></div></section>`);bindButton('retry',()=>{lives=3;startStage(levelIndex,{section:at});});bindButton('quit',()=>mpHosting()?mpToRoom():menu());}
function stageClear(){if(cleared)return;cleared=true;state='clear';player.victoryT=0;player.runLatch=0;voice('win');if(!driving){player.z=0;player.vz=0;player.dropIn=false;}
  const vitality=Math.max(0,Math.round(player.hp))*100,beaten=Math.max(0,kills-stageKills)*100,blow=finalBlow?20000:0,total=vitality+beaten+blow;
  score+=total;caption=null;clearSeq={t:0,story:false,typed:0,tally:{chapter:levelIndex+1,vitality,enemies:beaten,finalBlow:blow,total}};
  // 2-3 players: everyone strikes the pose; each gets the clear bonus with their own vitality (the tally shows this
  // machine's numbers); joiners save the unlock too
  if(multi())for(const p of present())if(p!==player)withPlayer(p,()=>{player.victoryT=0;player.runLatch=0;voice('win');if(!driving){player.z=0;player.vz=0;player.dropIn=false;}score+=Math.max(0,Math.round(player.hp))*100+beaten+blow;});
  if(NETROLE==='host')hostEv('unlock',Math.min(5,levelIndex+1));
  save.unlocked=Math.max(save.unlocked,Math.min(5,levelIndex+1));save.best=Math.max(save.best,score);sfx('clear');save.checkpoint=levelIndex<5?{level:levelIndex+1,section:0,hero:selected,difficulty,score,lives}:null;persist();
  panel(`<section class="panel dock-panel clear-dock"><p class="eyebrow">CHAPTER 0${levelIndex+1} COMPLETE</p><div class="menu-buttons"><button id="next" class="primary">${levelIndex===5?'SEE THE ENDING':'NEXT CHAPTER'} →</button></div></section>`);bindButton('next',clearNext);}
// ---------------------------------------------------------------- the ending (CAMPAIGN §11.2-§11.4; EDEN_ENDING)
// The beats of EDEN_ENDING in order (STORY.md, "Nobody owns the water"): 'fall' and 'alarm' (dialogue boxes over the
// dimmed floodgate: Crownback lies in the spillway, the gates stick open), 'run' (the hero and the four freed conscripts
// run for the gatehouse through the dam gallery, one conscript stumbles), 'choice' (your own hero's box, then the hero
// runs back and lifts him: the 1993 beat of going back for Hannah, not re-enacted), 'dawn' (a picture panel), 'road'
// (the sunset road: Mustapha and Mess walk, the Cadillac pulls up with Jack and Hannah, six boxes, the car drives off
// and Mustapha and Mess run after it, as in 1993) and 'thanks' (the staff roll, then THANK YOU), then the §11.3 panel. The sunset road is the Coral Causeway's E3a0 loop
// (chapter 2's stage pages) in the 1993 ending's sunset light; while its pages load, the p-sunset-road picture stands in.
let endSeq=null,endActors=[],endCar=null,rollT=0,endLot=null,lastLot00=null;
const END_BEATS=()=>window.EDEN_ENDING||[];
const endBeat=()=>endSeq?END_BEATS()[endSeq.k]||null:null;
const END_RUN=300,END_CHOICE_OUT=200,END_ROAD_IN=270,END_ROAD_OUT=200,END_THANKS=240,END_RUN_V=210;
function ending(){
  // without a chapter in play (a test hook from the title) there is no stage for the in-stage beats: the final panel only
  if(!started||!player||!plan){state='ending';save.checkpoint=null;persist();endSeq={k:END_BEATS().length,t:0,box:0,done:true};endActors=[];endCar=null;endingPanel();return;}
  state='ending';save.checkpoint=null;persist();caption=null;radio=null;radioQueue=[];bossCard=null;toastTime=0;drops=[];floating=[];bullets=[];effects=[];particles=[];
  SR.require(1);endSeq={k:-1,t:0,box:0,done:false};endActors=[];endCar=null;endLot=endLotSetup();
  panel(`<section class="panel dock-panel ending-dock"><p class="eyebrow">THE CROWN TIDE · THE END</p><div class="menu-buttons"><button id="ending-next" class="secondary">NEXT ›</button><button id="ending-skip" class="primary">SKIP →</button></div></section>`);
  bindButton('ending-next',endAdvance);bindButton('ending-skip',endingPanel);
  nextBeat();
}
// The 'fall' beat (CAMPAIGN §11.2 #1): under Sable's box CROWNBACK lies fallen in the spillway (its stand-in body, main 10)
// where it was beaten, with the plates it still had, in its own colours, while the spillway water sprays over it. After
// the fight the beaten Crownback itself (its defeat remnant, held behind the tally) is the beat's actor: it leaves
// `enemies`, so it is drawn once (G6 verify r2 #1). When the ending opens without the fight (a test hook) it lies in
// front of the hero. Drawn only: no particles, no Math.random. It fades out in the alarm.
function endLotSetup(){
  const rem=enemies.find(e=>e.type==='fessenden'&&e.boss&&e.defeat);enemies=enemies.filter(e=>e.type!=='fessenden');
  const lie=crownKey(11);if(levelIndex!==5||!player||!BDEF.fessenden||!bodyOf({type:'fessenden'})||!bAnim(lie))return null;
  const xf=BDEF.fessenden?.defeat?.crossfade||1.5;
  if(rem){rem.ba={key:lie,t:0,hold:true};Object.assign(rem,{dead:9,z:0,fallT:0,remnant:true,hidden:false,dissolve:false,flashMap:null,jetT:0});Object.assign(rem.defeat,{said:true,done:true});return rem;}
  const x=lastLot00?lastLot00.x:clamp(player.x+130,camera+70,camera+W-40),y=lastLot00?lastLot00.y:player.y;
  // a real defeat whose remnant is gone lies where it was beaten
  return {type:'fessenden',boss:true,x,y,z:0,dir:lastLot00?lastLot00.dir:(x>player.x?-1:1),hp:0,maxhp:1,dead:9,fallT:0,ba:{key:lie,t:0,hold:true},defeat:{kind:'lot00',t:lastLot00?xf:0,said:true,done:true}};
}
function drawEndLot(beat){
  const e=endLot;if(!e||!endSeq)return;const fade=beat==='alarm'?clamp(1-endSeq.t/24,0,1):1;if(fade<=0)return;
  ctx.save();ctx.translate(0,-Math.round(cameraY));ctx.globalAlpha*=fade;e.drawn=drawCrownback(e,e.x-viewX,e.y-(e.z||0));
  const t=e.fallT||0,x0=e.x-viewX;
  // spillway spray over the fallen body, and the water sheet running over its feet
  for(let i=0;i<16;i++){const u=t-(i%8)*.09;if(u<=0)continue;const z=(110+(i*37)%100)*u-210*u*u;if(z<0)continue;rect(ctx,x0+((i*13)%60-30)+(i%2?1:-1)*(24+(i*29)%70)*u,e.y-40-z,2,2,i%3?'#cfeeff':'#6fb6e0');}
  {const k=clamp(t/1.2,0,1);if(k>0)rect(ctx,0,Math.round(e.y-6*k),W,Math.round(6*k)+2,'rgba(90,170,225,.35)');}
  ctx.restore();
}
// frames a box needs: typing plus the hold
const boxFrames=b=>panelFrames(b)+BOX_HOLD;
function endBoxes(b){return b?.boxes||[];}
function beatFrames(b){
  if(!b)return 0;
  if(b.beat==='run')return END_RUN;
  if(b.beat==='choice')return boxFrames(b)+END_CHOICE_OUT;
  if(b.beat==='dawn')return panelFrames({lines:[b.caption]})+PANEL_HOLD;
  if(b.beat==='road')return END_ROAD_IN+endBoxes(b).reduce((n,x)=>n+boxFrames(x),0)+END_ROAD_OUT;
  if(b.beat==='thanks')return rollFrames()+END_THANKS;
  return boxFrames(b);
}
// the staff roll's length in frames: ARCADE_UI.staffRoll scrolls 0.5 px a frame, 16 px a line, a gap after each group
const rollFrames=()=>{const L=(UI()?.STAFF_ROLL||[]).reduce((n,[,names])=>n+2+names.length,0);return L?Math.ceil((H+L*16+16)/.5):600;};
function nextBeat(){
  endSeq.k++;endSeq.t=0;endSeq.box=0;const b=endBeat();
  if(!b){endingPanel();return;}
  if(b.beat==='alarm'){shake=6;flash=.3;}
  if(b.beat==='run')endRunSetup();
  if(b.beat==='road')endRoadSetup();
}
// NEXT: finish the typing of the box on show, else move on (a road box at a time)
function endAdvance(){
  if(state!=='ending'||!endSeq||endSeq.done)return;const b=endBeat();if(!b)return;
  if(b.beat==='road'){const r=endRoadBox(b);if(r){if(r.t<panelFrames(r.box))endSeq.t+=panelFrames(r.box)-r.t;else endSeq.t+=boxFrames(r.box)-r.t;return;}}
  const typing=b.beat==='dawn'?panelFrames({lines:[b.caption]}):b.lines?panelFrames(b):0;
  if(b.lines&&endSeq.t<typing){endSeq.t=typing;return;}
  if(b.beat==='choice'&&endSeq.t<boxFrames(b)){endSeq.t=boxFrames(b);return;}
  nextBeat();
}
// the road box on show: {box, i, t} (t frames into it), null outside the boxes
function endRoadBox(b){let t=endSeq.t-END_ROAD_IN;if(t<0)return null;const B=endBoxes(b);for(let i=0;i<B.length;i++){const f=boxFrames(B[i]);if(t<f)return {box:B[i],i,t};t-=f;}return null;}
// an ending actor: a hero's ROM clips through the hero clip player (animateClone), drawn in its own colours ('hero'), or
// a freed conscript (`conscript`: hero -1, FERRIS on his ROM records inside the gold outline, animateConscript)
function endActor(hero,x,y,o={}){return Object.assign({hero,x,y,z:0,dir:1,state:'walk',moving:false,running:false,ally:true,hp:1,maxhp:1,hurt:0,inv:0,strikeFlash:0,freeze:0,v:0,freed:true},o);}
const endConscript=(x,y,o={})=>endActor(-1,x,y,Object.assign({conscript:true,v:CONSCRIPT.v},o));
const animActor=(a,dt,moved)=>a.conscript?animateConscript(a,dt,moved):animateClone(a,dt,moved);
function endRunSetup(){endLot=null;
  // the dam gallery (ch6 a1) when the chapter is loaded, else the arena the chapter ended in
  if(plan&&plan.areas.length>1&&levelIndex===5){enterArea(1);}
  allies=[];enemies=[];bullets=[];zones=[];effects=[];objects=[];drops=[];floating=[];scenery=[];player.victoryT=null;player.weapon=null;player.ammo=0;player.hurt=0;player.special=0;player.attack=0;player.pickup=0;player.dir=1;
  const b=bandOf(player.x);player.y=b.top+b.h*.55;
  // the other players run with the hero, a step behind on their own lanes
  if(multi())present().forEach((p,k)=>{if(p===player)return;Object.assign(p,{victoryT:null,weapon:null,ammo:0,hurt:0,special:0,attack:0,pickup:0,dir:1,z:0,down:false,dying:false});p.mp.cont=null;p.mp.out=false;p.x=player.x-20*(k||1);p.y=clamp(player.y+(k%2?-12:12),b.top,b.bottom);});
  // the four freed conscripts run for the gatehouse a step behind the gang; the first one stumbles
  endActors=[0,1,2,3].map(k=>{const x=player.x-44-k*34,bb=bandOf(x);return endConscript(x,clamp(player.y+[-19,16,-6,27][k],bb.top+4,bb.bottom-4));});
  endSeq.stumbler=endActors[0];endSeq.lift=null;endSeq.camHold=null;caption={text:endBeat()?.caption||'',t:0};
}
function endRoadSetup(){
  const A2=SD.chapters.ch2?.areas?.[0],band=x=>{const r=A2&&STG.bandAt(A2,x);return r?{top:r[0],bottom:r[1]}:{top:140,bottom:216};},lane=(x,f)=>{const b=band(x);return b.top+(b.bottom-b.top)*f;};
  endSeq.road={area:A2,cam:{x:0,y:A2?STG.pathY(A2,0):0}};const cy=endSeq.road.cam.y;
  endActors=[endActor(0,-40,lane(0,.42)-cy,{freed:false,moving:true}),endActor(3,-80,lane(0,.62)-cy,{freed:false,moving:true})];
  endCar={x:-260,y:lane(0,.86)-cy,v:330,roll:0,stopX:258,state:'in'};
  caption=null;
}
function endMove(a,dt,vx){const ox=a.x,oy=a.y;a.x+=vx*dt;a.moving=Math.abs(vx)>1;a.dir=vx<0?-1:vx>0?1:a.dir;animActor(a,dt,Math.hypot(a.x-ox,a.y-oy));}
// the hero in the ending's choice beat: runs at vx (0: stands), its clips from updateHeroAnim as in the run beat
function endHeroMove(dt,vx){const px=player.x;player.move=Math.abs(vx)>1;player.run=player.move;if(vx)player.dir=vx<0?-1:1;player.x+=vx*dt;updateHeroAnim(dt,player.x-px);}
function updateEnding(dt){
  if(!endSeq||endSeq.done){if(state==='ending')rollT+=dt*60;return;}
  const b=endBeat();if(!b){endingPanel();return;}
  endSeq.t+=dt*60;shake=Math.max(0,shake-dt*22);flash=Math.max(0,flash-dt);
  if(caption){caption.t+=dt*60;if(caption.t>=CAPTION_FRAMES)caption=null;}
  if(b.beat==='fall'&&endLot){if(endLot.ba)endLot.ba.t+=dt*60;endLot.defeat.t+=dt;endLot.fallT+=dt;}
  if(b.beat==='run'){
    const t=endSeq.t,px=player.x;player.move=true;player.run=true;player.dir=1;
    const ar=curArea(),maxX=ar?ar.w-24:player.x+999;player.x=Math.min(maxX,player.x+END_RUN_V*dt);
    for(const a of endActors){if(a===endSeq.stumbler&&t>=150){if(a.state!=='down'){a.state='down';a.moving=false;a.running=false;}animActor(a,dt,0);continue;}a.running=true;a.state='walk';endMove(a,dt,END_RUN_V);}
    // the camera follows the runners until the conscript stumbles, then holds on him while the others run on out of shot
    if(t<150){camera=clamp(player.x-150,0,Math.max(0,(ar?.w||W)-W));if(ar)cameraY=STG.pathY(ar,camera);}
    updateHeroAnim(dt,player.x-px);
    if(multi())for(const p of present())if(p!==player)withPlayer(p,()=>{const qx=player.x;player.move=true;player.run=true;player.dir=1;player.x=Math.min(maxX,player.x+END_RUN_V*dt);updateHeroAnim(dt,player.x-qx);});
  }else if(b.beat==='choice'){
    // your own hero goes back for the conscript who fell, lifts him, and the two run on together
    const fallen=endSeq.stumbler,t=endSeq.t-boxFrames(b);
    if(t<0)endHeroMove(dt,0);
    else if(fallen){
      if(endSeq.lift==null){if(player.x>camera+W+30)player.x=camera+W+30;endHeroMove(dt,-END_RUN_V);if(player.x<=fallen.x+22){player.x=fallen.x+22;endSeq.lift=t;player.dir=-1;fallen.state='rise';}}
      else if(t-endSeq.lift<40){endHeroMove(dt,0);animActor(fallen,dt,0);}
      else{fallen.state='walk';fallen.running=true;endMove(fallen,dt,END_RUN_V);endHeroMove(dt,END_RUN_V);}
    }
    for(const a of endActors)if(a!==fallen&&a.x<camera+W+80)endMove(a,dt,END_RUN_V);
  }else if(b.beat==='road'){
    const t=endSeq.t,c=endCar,out=t>=beatFrames(b)-END_ROAD_OUT;
    for(const a of endActors){const stopAt=a.hero===0?122:86;
      if(out){a.running=true;endMove(a,dt,230);}else if(a.x<stopAt){a.running=false;endMove(a,dt,Math.min(54,(stopAt-a.x)*4));}else{a.moving=false;a.dir=1;animActor(a,dt,0);}}
    if(c){if(out){c.state='out';c.v=Math.min(420,c.v+300*dt);}else if(t>=110){c.v=c.x<c.stopX?Math.max(12,Math.min(330,(c.stopX-c.x)*2.4)):0;if(c.x>=c.stopX){c.x=c.stopX;c.v=0;}}else c.v=0;
      c.x+=c.v*dt;c.roll+=c.v*dt;}
  }
  if(endSeq.t>=beatFrames(b))nextBeat();
}
// §11.3: the final panel (the fallback and the last screen; the road stays behind it with THANK YOU)
function endingPanel(){
  if(state!=='ending')return;if(endSeq){endSeq.done=true;endSeq.k=END_BEATS().length;}rollT=0;
  const me=HEROES[selected];
  panel(`<section class="panel small-panel"><p class="eyebrow">THE CROWN TIDE · THE END</p><h2>NOBODY OWNS THE WATER.</h2><p>Morning finds the Crown dam running at half. The gang did not blow it: the coast needs it. Hannah set the gates to a slow, even release, the kind the coast can live with, the collars came off every conscript on the gallery, and downstream the taps run again. Rook, Cinder and Echo stand trial in Wassoon. Breakwater grazes on the causeway, and Glassback keeps her nest.</p><p style="color:var(--acid)">MUSTAPHA: Every tap on the coast is running.<br>HANNAH: And his seal comes off every door in Wassoon.<br>JACK: Fessenden tried it. Sable tried it. Nature always balances itself.<br>MESS: Hey… that car seats two up front. Jack? JACK!</p><p>The Cadillac pulls away, and Mustapha and Mess run after it, just like last time.</p><p>${me.name} drives home with the gang · ${kills} enemies defeated · ${Math.floor(runTime/60)} minutes · score ${score}<br>All six chapters are now available.</p><div class="menu-buttons"><button id="chapters" class="primary">PLAY A CHAPTER →</button><button id="credits" class="secondary">CREDITS</button><button id="quit" class="secondary">MAIN MENU</button></div></section>`);bindButton('chapters',()=>mpHosting()?mpToRoom():chapters());bindButton('credits',credits);bindButton('quit',()=>mpHosting()?mpToRoom():menu());}
// §11.4: the staff roll over the sunset road (red categories, white names), then THANK YOU and the credits text.
function credits(){state='credits';rollT=0;SR.require(1);panel(`<section class="panel dock-panel credits-dock"><p class="eyebrow">THANKS FOR PLAYING</p><div class="menu-buttons"><button id="credits-text" class="secondary">ABOUT THIS GAME</button><button id="quit" class="primary">MAIN MENU →</button></div></section>`);bindButton('quit',()=>mpHosting()?mpToRoom():menu());bindButton('credits-text',creditsText);}
function creditsText(){panel(`<section class="panel small-panel"><p class="eyebrow">THANKS FOR PLAYING</p><h2>FOR THE OLD ARCADE DAYS.</h2><p>An unofficial fan sequel made for Mostafa. It continues the story of Capcom’s 1993 arcade game six months after Dr. Fessenden’s death in the Under World beneath the City in the Sea. The heroes, enemies, bosses and dinosaurs are the original arcade sprites, decoded from the ROM files the user supplied; new characters are original bodies in new palettes, the way the arcade made Walther from Vice T. Every stage is a new layout built from the original arcade’s tiles, blocks and palettes.</p><p>New story, levels, encounters, combat engine and boss behaviours were made for this game. Original soundtrack supplied by the user. Original Cadillacs and Dinosaurs arcade game and artwork: Capcom. Characters and setting derive from Xenozoic Tales by Mark Schultz.</p><div class="menu-buttons"><button id="quit" class="primary">MAIN MENU →</button></div></section>`);bindButton('quit',menu);}
// ---------------------------------------------------------------- G6 drawing (arcade screen px, under beginFrame)
function drawAttract(){const U=UI(),list=window.EDEN_INTRO||[];rect(ctx,0,0,W,H,'#000000');if(!U||!attractSeq)return;const p=list[attractSeq.k];if(p){picFrame(p.pic,attractSeq.t);U.panel(ctx,{...p,typed:attractSeq.t});}}
// the tally over the dimmed victory pose; once the story panel is up, only the dim
function drawClear(){const U=UI();if(!clearSeq||!U||clearSeq.story){rect(ctx,0,0,W,H,clearSeq?.story?'#0b1a16aa':'#0b1a1688');return;}U.tally(ctx,{...clearSeq.tally,t:Math.floor(clearSeq.t),dim:.55});}
// which screen an ending beat draws on: the world (fall, alarm, run, choice), a picture panel (dawn) or the sunset road
const endScene=()=>{if(state==='credits')return 'road';const b=endBeat();if(!endSeq||endSeq.done||!b)return 'road';return b.beat==='dawn'?'pic':b.beat==='road'||b.beat==='thanks'?'road':'world';};
// a hero's 72x72 ROM portrait as a canvas (the ui sheet in its own map); 'self' boxes show the selected hero's face
function portraitCanvas(who){const SP=window.SPRITES,U=window.ROM_UI,i=UI()?.PORTRAIT_INDEX?.[who];if(!SP||!U||i==null||!SP.familyReady?.('ui'))return null;
  const rec='0x'+i.toString(16).toUpperCase().padStart(2,'0'),r=U.rect?.ui?.[rec];if(!r)return null;const c=document.createElement('canvas');c.width=r[2];c.height=r[3];return SP.drawRec(c.getContext('2d'),'ui',rec,U.portraits?.map||'ui',0,0,false)?c:null;}
function boxOpts(b,typed){const me=HEROES[selected].id;return {who:b.who==='self'?me:b.who,hero:me,lines:b.lines,typed,accent:level.accent};}
function drawEndWorld(){
  const U=UI(),b=endBeat();if(!U||!b||!endSeq||endSeq.done)return;
  if(b.beat==='fall'||b.beat==='alarm'){rect(ctx,0,0,W,H,'rgba(0,0,0,.45)');drawEndLot(b.beat);
    // the alarm: harmless water rises at the foot of the screen while the dam lets go
    if(b.beat==='alarm'){const k=Math.min(1,endSeq.t/180);rect(ctx,0,H-Math.round(k*36),W,Math.round(k*36),'rgba(70,150,215,.4)');}
    U.dialogue(ctx,boxOpts(b,endSeq.t));}
  else if(b.beat==='choice'&&endSeq.t<boxFrames(b)){rect(ctx,0,0,W,H,'rgba(0,0,0,.35)');U.dialogue(ctx,boxOpts(b,endSeq.t));}
}
// an ending actor: a hero through the hero clip player in its own colours ('hero'), or a freed conscript (drawConscript)
function drawEndActor(a,x,y){
  if(a.conscript||a.hero<0)return drawConscript(a,x,y);
  const R=RIG(),st=NETROLE==='client'?null:animateClone(a,0,0),body=st?{full:st.main}:a.rig?{full:{clip:a.rig[0],k:a.rig[1]}}:null;if(!R||!body||st&&!st.main.clip)return false;const id=HEROES[a.hero].id,parts=R.parts(id,body,null);
  return a.freed?drawOutlined(parts,x,y,a.z,a.dir,CFG.sockets.scale,'freed-'+id,'#ffd257'):R.draw(ctx,parts,x,y,a.z,a.dir,CFG.sockets.scale,'hero');
}
// The ending car: the ROM's own ending records (3489/3490: the Cadillac with Jack at the wheel and Hannah beside him,
// ROM_FX.cadillac.anims.ending, S3A0 colours) on the arrival car's wheels; the HELL ROAD car with Jack is the fallback.
function drawEndCar(c){
  const C=window.ROM_FX?.cadillac,SP=window.SPRITES,E=C?.anims?.ending;if(!C||!SP||!SP.familyReady?.('fx'))return false;
  if(!E||!E.length)return car(ctx,c.x,c.y,{hero:1,roll:c.roll,moving:c.v>0,t:time});
  const map=C.mapKey||'S3A0',A=C.arrival?.wheels||{dx:[77,-75],dy:3},Wh=C.wheels,bx=Math.round(c.x),by=Math.round(c.y)-C.ground,ph=Math.floor((c.roll||0)/16)&1;
  shadow(ctx,bx,Math.round(c.y)+1,118,5);
  for(const dx of A.dx)SP.drawRec(ctx,'fx',Wh.steer[Wh.straight][ph],map,bx+dx,by+A.dy,false);
  return SP.drawRec(ctx,'fx',seqCycle(E,time*60),map,bx,by,false);
}
// The sunset road: chapter 2's HELL ROAD loop (E3a0) under the 1993 ending's sunset light (a multiply ramp); the
// p-sunset-road picture stands in while chapter 2's pages load.
function drawRoad(){
  const A2=SD.chapters.ch2?.areas?.[0];
  if(A2&&SR.ready(1)){const cam={x:0,y:Math.round(STG.pathY(A2,0))};SR.back(ctx,A2,cam,time,{road:0});SR.front(ctx,A2,cam,time,{road:0});
    ctx.save();ctx.globalCompositeOperation='multiply';const gr=ctx.createLinearGradient(0,0,0,H);gr.addColorStop(0,'#ff7e48');gr.addColorStop(.5,'#ffb47a');gr.addColorStop(1,'#d2785a');ctx.fillStyle=gr;ctx.fillRect(0,0,W,H);ctx.restore();return;}
  rect(ctx,0,0,W,H,'#000000');const U=UI();if(U)U.drawPic(ctx,U.resolvePic('p-sunset-road',224,96),80,64);
}
function drawRoadCast(){const list=[...endActors.map(a=>({y:a.y,fn:()=>drawEndActor(a,a.x,a.y),sh:()=>shadow(ctx,a.x,a.y)})),...(endCar?[{y:endCar.y,fn:()=>drawEndCar(endCar),sh:()=>{}}]:[])].sort((p,q)=>p.y-q.y);for(const d of list)d.sh();for(const d of list)d.fn();}
function drawEndScene(){
  const U=UI(),b=state==='ending'&&endSeq&&!endSeq.done?endBeat():null,thanks=(END_BEATS().find(x=>x.beat==='thanks')||{}).lines||['THANK YOU FOR PLAYING','A FAN SEQUEL MADE FOR MOSTAFA'];
  if(b&&b.beat==='dawn'){rect(ctx,0,0,W,H,'#000000');if(U)U.panel(ctx,{layout:'A',pic:b.pic,lines:[b.caption],typed:endSeq.t});return;}
  drawRoad();
  if(state==='credits'){if(U){if(rollT<rollFrames())U.staffRoll(ctx,rollT);else U.thanks(ctx,thanks);}return;}
  drawRoadCast();if(!U)return;
  if(b&&b.beat==='road'){const r=endRoadBox(b);if(r)U.dialogue(ctx,boxOpts(r.box,r.t));}
  else if(b&&b.beat==='thanks'){if(endSeq.t<rollFrames())U.staffRoll(ctx,endSeq.t);else U.thanks(ctx,b.lines||thanks);}
  else U.thanks(ctx,thanks);
}
// Echo's clean tank row in the vat hall (CAMPAIGN §9.1 S4; the ch5 recipe's section 5-4 overlay heroTanks): the four
// heroes' copies float behind the glass of the E8a0 tanks, idle frames in the clone palette, in place of the 1993
// specimens, with name plates TENREC / DUNDEE / CAIRO / O'BRADOVICH over the tank numbers. All four are in the vat hall:
// section 5-4 is cut from E8a0 592-1104 (G6 verify r2 #3), so tanks 05-08 stand at area x 30, 175, 320, 464 and the
// opening screen, where Jack's "all four of us" line plays, shows three of them. Tanks 07 and 08 hold the same copies
// again where E8a0 864-1120 returns in the lens hall (x 2096, 2240). Stage art, drawn over the back layers and under
// every fighter; a slow bob, no Math.random.
const HERO_TANKS=[[30,'jack','TENREC'],[175,'hannah','DUNDEE'],[320,'mess','O’BRADOVICH'],[464,'mustapha','CAIRO'],[2096,'mess','O’BRADOVICH'],[2240,'mustapha','CAIRO']];
function drawHeroTanks(){
  const R=RIG(),U=UI();if(!R?.ready)return;
  for(const [ax,id,plate] of HERO_TANKS){const x=ax-viewX;if(x<-60||x>W+60)continue;const clip=R.clip(id,'idle');if(!clip)continue;
    ctx.save();ctx.beginPath();ctx.rect(x-41,20,82,85);ctx.clip();rect(ctx,x-41,20,82,85,'#3f9a8edd');
    for(let j=0;j<5;j++)rect(ctx,x-34+j*16,20+((time*22+j*31)%85),2,2,'#c8fff0');
    R.draw(ctx,R.parts(id,{full:{clip,k:0}},null),x,101+Math.round(Math.sin(time*1.3+ax)*1.5),0,ax%2?1:-1,1,'mirror-'+id);
    rect(ctx,x-41,20,82,85,'#8ff0d433');rect(ctx,x-36,24,4,76,'#ffffff30');rect(ctx,x-29,24,2,76,'#ffffff1c');ctx.restore();
    if(U){const w=plate.length*8+6;rect(ctx,x-w/2,110,w,11,'#0b2a26');rect(ctx,x-w/2,110,w,1,'#9fe0c8');rect(ctx,x-w/2,120,w,1,'#06150f');U.text(ctx,plate,x,111,{font:8,align:'center',pen:'acid',shadow:false});}}
}
// The radio strip in the ROM 8x16 font (PLAN §7 G6 4, CAMPAIGN §4.7): two rows in the tall strip (8,46)-(376,78), above
// the feet band at y 81; JACK, HANNAH, MUSTAPHA and MESS speak with their ROM face (the P1 block faces), every other
// speaker with a name tag in the chapter's accent. Lines are stored
// in sentence case and drawn upper case; a line of up to 72 characters wraps to two rows. The strip keeps its colour,
// at 61 % so a fighter in the upper walk band still shows through it (G6 verify #3).
const RADIO_FACE={JACK:'jack',HANNAH:'hannah',MUSTAPHA:'mustapha',MESS:'mess'};
function drawRadioFace(who,x,y){
  const SP=window.SPRITES,U=window.ROM_UI;if(!SP||!U||!SP.familyReady?.('ui'))return false;
  if(who!=='fessenden'){const rec=U.hudFaces?.[who];return !!rec&&SP.drawRec(ctx,'ui',rec,'ui',x,y,false);}
  const l=SP.locate('ui','0x04');if(!l)return false;const c=SP.canvasFor(l.key,U.portraits?.map||'ui',null,l.r);if(!c)return false;const r=l.r;
  ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(c,r[0]+12,r[1]+16,48,48,x,y,24,24);ctx.restore();return true;
}
function drawRadio(){
  const [rx,ry,rw,rh]=LAYOUT_ARCADE.radio,U=UI();rect(ctx,rx,ry,rw,rh,'#0d202b9c');rect(ctx,rx,ry+rh-1,rw,1,'#3f5c57');
  const text=String(radio.text),m=/^([A-Z?][A-Z ?.'’]*):\s*(.*)$/.exec(text),name=m?m[1]:'',body=m?m[2]:text,who=RADIO_FACE[name];
  if(!U){label(text,rx+rw/2,ry+rh/2+2,5,'#c8e7d4','center');return;}
  let x=rx+4;if(who&&drawRadioFace(who,rx+3,ry+4))x=rx+31;
  const tag=name&&!(who&&x>rx+4)?name+': ':'',cols=Math.floor((rx+rw-3-x)/8),rows=U.wrap(tag+body,cols).slice(0,2);
  rows.forEach((row,i)=>{const y=ry+i*16;if(i===0&&tag){U.text(ctx,tag,x,y,{font:16,pen:level.accent||'yellow'});U.text(ctx,row.slice(tag.length),x+U.measure(tag).w,y,{font:16});}else U.text(ctx,row,x,y,{font:16});});
}
// Hero copies have no ROM body (ENEMY_KINDS.K.MIRROR_HP); every other regular's HP is its variant's ROM HP at the
// chapter's arcade level through K.HP (kindHp, ENEMIES §0); this table is only the fallback without enemy-kinds.js.
const BASE_HP={brute:125,gunner:68,raptor:90,knifer:82,mutant:138,biker:125,regent:150,slicer:160,mirror:150,zeke:58};
// Boss HP is BOSS_DEFS[kind].hp (enemy-kinds.js, CAMPAIGN §12.4) times BOSS_HP_LEVER (the boss driver, G5); this table is
// the fallback for a boss kind without a def.
const BOSS_HP=[760,860,840,940,940,720];
// Bosses call reinforcements from both edges at two thirds and one third of their health.
const BOSS_GUARDS=[['raider','knifer','gunner'],['biker','biker','gunner'],['raptor','raptor','raptor'],['brute','gunner','knifer'],['mutant','regent','gunner'],['raider','knifer','gunner']];
function bossReinforce(e){e.calls=(e.calls||0)+1;BOSS_GUARDS[levelIndex].forEach((type,j)=>arrive(type,j%2?'L':'R',j));toast='REINFORCEMENTS · WATCH BOTH SIDES';toastTime=2.5;}
// Every regular is an ENEMY_KINDS kind in one of its ROM variants (e.v, ENEMIES §1.2): spawnEnemy gives it the kind's
// first variant (so the test dummies and the seeded random order stay as they were: id, timer, anim, the old clone roll's
// draw, hero),
// arrive() picks the encounter's variant without a random call. HP = the variant's ROM HP at the chapter's arcade level
// (kindHp) times the difficulty's enemyHealth; a boss's HP is its BOSS_DEFS hp (bossHpOf, with the PLAN §8.2 HP lever).
function spawnEnemy(x,y,type='raider',boss=false) {
  const v=boss?null:defaultVariant(type),base=boss?bossHpOf(type):(kindHpOf(type,v)??BASE_HP[type]??80),hp=base*rules().enemyHealth*(boss?bossScale():1);
  // STORY.md: ordinary enemies are poachers, conscripts, graft subjects and guards, beaten the ordinary way; the only
  // copy is the Mirror Test (`mirror`). The draw the old clone roll made stays, so the seeded random order holds.
  const e={id:Math.random(),x,y,z:0,vx:0,vz:0,dir:-1,hp,maxhp:hp,type,boss,phase:1,state:'walk',timer:rand(.8,1.8),hurt:0,inv:0,anim:rand(0,1),dead:0,attack:0,attackNo:0,hitChain:0,hitTimer:0,recovery:0,onstage:true,delay:0,
    clone:(!boss&&!['mutant','regent','mirror'].includes(type)&&Math.random(),!boss&&type==='mirror'),hero:Math.floor(Math.random()*4)};
  if(v){e.v=v;e.knife=type==='knifer';e.stun=10;}
  enemies.push(e);nidOf(e);return e;
}
// Gives an enemy another variant of its kind (CAMPAIGN §4.4 cast, an elite's `variant`): its HP, knife and colours.
function setVariant(e,V,palAlt){
  if(!romKind(e)||!V||!EK.variantData(e.type,V))return e;
  const keepHp=e.hp===e.maxhp;e.v=V;e.knife=e.type==='knifer';e.palAlt=palAlt||regentAlt(e)||null;
  const hp=(kindHpOf(e.type,V)??e.maxhp/rules().enemyHealth)*rules().enemyHealth;if(keepHp){e.hp=e.maxhp=hp;}
  return e;
}
// The chapter default variant pools (CAMPAIGN §4.4), overridden per section by STAGE_DATA `cast`: cast ids -> [kind, V].
const CAST_POOLS=[
  {raider:['ferris','gneiss'],knifer:['blade'],gunner:['poacherJ'],brute:['blkElmer','hammerT']},
  {raider:['driver','ferris'],knifer:['razor'],gunner:['dyna','skinner'],brute:['wrenchT','hammerT'],biker:['ride','jump']},
  {raider:['gneiss','poacherJ'],knifer:['blade'],gunner:['skinner','gutter'],brute:['hammerT','blkElmer'],raptor:['hopper']},
  {raider:['gneiss','driver'],knifer:['razor'],gunner:['bomber','gutter'],brute:['wrenchT','blkElmer'],mutant:['bludge'],regent:['tyrog']},
  {raider:['driver'],knifer:['razor','knife'],gunner:['gutter','bomber'],brute:['lashT','blkElmer'],mutant:['bludge'],regent:['tyrog']},
  {raider:['gneiss','driver'],knifer:['razor','blade'],gunner:['gutter','skinner'],brute:['blkElmer'],mutant:['bludge'],regent:['tyrog']}];
// 'raider:C' pins a variant, 'raider:gneiss' a cast id; otherwise pool[(wave + j) % n] (the wave index inside the
// encounter and the slot), the same rule tests/enemies.cjs (5) budgets the chapters with. No random call.
function castVariant(type,pin,j,wi){
  if(!EK||!EK[type]||!EK[type].variants)return null;const K=EK[type];
  if(pin){if(K.variants[pin]!==undefined)return pin;const c=EK.CAST[pin];if(c&&c[0]===type)return c[1];}
  const sec=plan?.sections?.[sectionIndex],pool=[].concat((sec?.cast&&sec.cast[type])||CAST_POOLS[levelIndex]?.[type]||[]).map(id=>EK.CAST[id]).filter(c=>c&&c[0]===type&&EK.variantData(type,c[1]));
  if(!pool.length)return null;return pool[((wi|0)+(j|0))%pool.length][1];
}
// Reinforcements walk or run in from beyond the screen edges, or drop from above, one after another.
function arrive(type,side,j,wi=encounter?.next||0){
  const [kind,pin]=String(type).split(':');type=kind;
  // Nobody stands on a moving highway: a foot gunner in a driving section is a roadside Thurow DYNA (ENEMIES §2.5): he
  // runs in along the verge, throws one stick of dynamite at the car's lane and runs off.
  const roadside=driving&&type==='gunner';
  // Side entries start fully off screen; their lane is a slot inside the band at the entry edge (ARCHITECTURE §2.4).
  // Drops start above the HUD (y - z < view.y - 16).
  // A side entry's lane lies in the band of both its entry column and the spot it walks to (bands step between columns).
  // The anchor stands 52 px beyond the edge, or further for a wide body: its entrance frames' reach ahead of the origin
  // plus ENTRY_PAD (entryReach: bikes 89, R HOPPER 63, TYROG 61, knife men 59), so the whole drawn frame starts off screen.
  const L=lock||{left:camera,right:camera+W},laneIn=b=>b.top+8+((j*41+wave*23+(encounter?.next||0)*17)%Math.max(1,b.h-16));let e;
  const V=roadside?'T':castVariant(type,pin,j,wi);
  if(side==='T'&&!driving&&type!=='biker'){const x=L.left+111+((j*173+wave*61)%(W-222)),lane=laneIn(bandOf(x));e=spawnEnemy(x,lane,type);e.z=lane-cameraY+52;e.vz=0;e.state='drop';}
  else{const s=side==='L'?-1:1,off=Math.max(52,entryReach(type,V)+ENTRY_PAD),x=s>0?Math.max(L.right,camera+W)+off+j*59:Math.min(L.left,camera)-off-j*59,enterX=s>0?L.right-81-j*34:L.left+81+j*34;
    const b0=bandOf(x),b1=bandOf(enterX),top=Math.max(b0.top,b1.top),bottom=Math.min(b0.bottom,b1.bottom),b=bottom-top>=16?{top,h:bottom-top}:b0;
    e=spawnEnemy(x,roadside?(j%2?b.top+3:b.top+b.h-3):laneIn(b),type);e.state='enter';e.dir=-s;e.onstage=false;e.enterX=enterX;e.from=s;}
  setVariant(e,V);
  e.delay=j*.55;e.waiting=enemies.filter(v=>v!==e&&!v.dead&&!v.dying&&!v.waiting&&v.state!=='flee'&&!v.setPiece).length>=crowdLimit();return e;
}
function startEncounter(enc){
  // The lock is the screen at the camera trigger: lock = {left: x, right: x + 384} (ARCHITECTURE §2.3-§2.4).
  wave++;if(enc.cam!==undefined)camera=enc.cam;lock={left:camera,right:camera+W};
  encounter={spec:enc,next:0,timer:0,eliteSpawned:false,np:NPRES>1?NPRES:1};
  if(enc.task!==undefined)createTaskFor(enc.task);
  if(enc.say)say(enc.say);
  if(enc.boss){spawnBoss();return;}
  spawnNextWave();startSetPieces(enc);
  toast=lock&&enc.from==='T'?'LOOK UP!':enc.from==='B'||enc.from==='L'?'AMBUSH · WATCH BOTH SIDES':driving?'INTERCEPT THE ESCORT':'INCOMING';toastTime=2;
}
// Set pieces enter from off screen and never count as fights (CAMPAIGN §4.5); all are off on easy. ZEKE swoops in at the
// first lock of a section whose stage sets it (chapter 2's 50 %: every other such section); the Naguri vignette comes
// with its encounter's `set`.
function startSetPieces(enc){
  if(!setPiecesOn()||!plan)return;const sec=plan.sections[enc.section],first=plan.encounters.findIndex(e=>e.section===enc.section)===plan.encounters.indexOf(enc);
  if(first&&(sec?.set||[]).includes('zeke')&&(levelIndex!==1||enc.section%2===1))spawnZeke(enc.section%2?1:-1);
  if(enc.set==='naguri-vignette')spawnVignette();
}
function spawnNextWave(){
  const spec=encounter.spec,waves=spec.w||[];if(encounter.next>=waves.length)return false;
  const lineup=[...waves[encounter.next]];{const np=encounter.np||1,n0=lineup.length;for(let j=0;j<np-1&&n0;j++)lineup.push(lineup[j%n0]);}if(rules().extraWaveEnemy)lineup.push(driving?'biker':encounter.next%2?'knifer':'gunner');
  // The first wave keeps the encounter's entrance; later waves alternate sides so fights never feel scripted.
  const from=encounter.next===0?spec.from||'R':spec.from==='T'?'B':encounter.next%2?(spec.from==='L'?'R':'L'):spec.from||'R';
  lineup.forEach((type,j)=>{const e=arrive(type,from==='B'?(j%2?'L':'R'):from,j);if(j===0&&encounter.next===0&&wave%3===0)e.loot=CARRIED[levelIndex][(wave/3)%3];});
  encounter.next++;encounter.timer=0;return true;
}
// An elite is its kind's ROM variant at native scale (ENEMIES §2.9: no `scale`), in its own palette context when the
// campaign names one (PACK ALPHA t74-e8a0-pal31, BROOD MOTHER t10-e6a2-pal29 + drowned). Its `after` line is read from
// the encounter (CODE-MAP §15.1: the campaign put it there, so it never played) and, as a belt-and-braces copy, from the
// elite itself (CAMPAIGN D13).
// the Mirror Test (chapter 5) copies a hero nobody is playing (O-MP5); single player: the hero select's offset as before
function mirrorHero(k){if(!multi())return (selected+k)%4;const used=new Set(present().map(p=>p.mp.hero));let h=((players[0]?players[0].mp.hero:selected)+k)%4;for(let i=0;i<4&&used.has(h);i++)h=(h+1)%4;return h;}
function spawnElite(spec){
  // the elite's variant is known before it arrives, so arrive() places it by that variant's entrance reach
  const V=castVariant(spec.type,spec.variant,0,0),pal=String(spec.palette||'');
  encounter.eliteSpawned=true;const e=arrive(V?spec.type+':'+V:spec.type,'R',0);e.delay=.3;e.elite=true;e.clone=spec.type==='mirror';e.name=spec.name;e.after=encounter.spec.after||spec.after||null;e.fleeOnDefeat=!!spec.flee;
  setVariant(e,V||e.v,e.type==='regent'&&pal?'brood':e.type==='raptor'&&/pal31/.test(pal)?'alpha':null);
  if(e.type==='regent'&&pal)e.brood=true;
  e.hp=e.maxhp=spec.hp*rules().enemyHealth*bossScale();if(spec.type==='mirror')e.hero=mirrorHero(spec.hero||0);
  toast=spec.name+' · INCOMING';toastTime=3;sfx('special');voice(spec.type==='raptor'||spec.type==='regent'?'roar':'bossTaunt');return e;
}
// KI15 (enemies VERIFY #3): a wrecked bike respawns its rider as a GNEISS (Chinpira B) thrown from 32 px up at the bike's
// x; he fights on in the wave. The Tide Outrider himself is thrown clear and stays down (CAMPAIGN §6.3).
function bikeRider(bike,kdir){
  const s=kdir||-bike.dir||1,r=spawnEnemy(bike.x,bike.y,'raider');setVariant(r,'B');
  Object.assign(r,{state:'fly',z:32,vz:110,vx:s*70,bounces:0,onstage:bike.onstage,inv:.25,dir:-s,from:bike.from});
  if(bike.elite)Object.assign(r,{dying:true,inv:99});
  return r;
}
function updateEncounter(){
  if(!encounter||encounter.spec.boss)return;
  const alive=enemies.filter(e=>!e.dead&&e.state!=='flee'&&!e.setPiece).length,waves=encounter.spec.w||[];
  if(encounter.next<waves.length){if(alive<=1||encounter.timer>16)spawnNextWave();}
  else if(encounter.spec.elite&&!encounter.eliteSpawned&&alive<=1)spawnElite(encounter.spec.elite);
}
const encounterSpawned=()=>encounter&&(encounter.spec.boss?bossSpawned:encounter.next>=(encounter.spec.w||[]).length&&(!encounter.spec.elite||encounter.eliteSpawned));

let mission=null;
function initMission(){const spec=EDEN_MISSIONS[levelIndex];mission={completed:0,total:spec.tasks.length,active:null,items:[],spec};radio=null;}
function say(text){if(text&&radio?.text!==text&&!radioQueue.includes(text))radioQueue.push(text);}
// a beaten boss's last lines go on the radio at once, ahead of the fight's queued chatter (the clear waits for them, G5)
function sayNow(text){if(!text)return;radioQueue=radioQueue.filter(t=>t!==text);if(radio?.text!==text)radio={text,ttl:4.6};}
function createObjective(kind,name,x,y,target=0,bossTask=false,taskIndex=-1){
  const item={kind,name,x,y,target,channel:0,progress:0,hp:kind==='beacon'?bossTask?300:80:1,maxhp:kind==='beacon'?bossTask?300:80:1,done:false,bossTask,taskIndex};
  mission.items.push(item);mission.active=item;
  toast=kind==='beacon'?'DESTROY THE SONIC LURE':kind==='cargo'?'RAM THE CARGO WAGON':kind==='tuner'?`TUNE CHANNEL ${target} · E TO STEP`:kind==='pod'?'HOLD E / PICK TO OPEN THE POD':'HOLD E / PICK TO OPERATE';toastTime=3.5;return item;
}
// Mission objects stand where their section authors them (STAGE_DATA props: pods, gates, beacons, valves, tuners, by name,
// else the nearest of their kind in the area), pulled inside the locked screen by OBJ_MARGIN, on a spot reachable from
// both sides (spotAt). The convoy cargo keeps its place at the lock's right side, inside the car's reach but not under it
// (its prop only says which lock carries it).
function createTaskFor(n){
  const [kind,name,target]=mission.spec.tasks[n];let x=lock.right-(driving?75:88);
  if(!driving){
    const mid=(lock.left+lock.right)/2,list=plan.sections.filter(s=>s.area===areaIndex).flatMap(s=>s.props.filter(p=>p.kind===kind).map(p=>({x:s.x+p.x,name:p.name})));
    const p=list.find(q=>q.name===name)||list.sort((a,b)=>Math.abs(a.x-mid)-Math.abs(b.x-mid))[0];
    if(p){const at=spotAt(p.x,n%2?.31:.75,lock.left+OBJ_MARGIN[0],lock.right-OBJ_MARGIN[1]);createObjective(kind,name,at.x,at.y,target||0,false,n);return;}
  }
  createObjective(kind,name,x,laneY(n%2?.31:.75,x),target||0,false,n);
}
function objectiveNear(){const t=mission?.active;return t&&!t.done&&Math.abs(t.x-player.x)<(driving?96:48)&&Math.abs(t.y-player.y)<32&&player.z===0;}
function interactMission(tapped=false){
  const t=mission?.active;if(!objectiveNear()||!t||t.kind==='beacon'||t.kind==='cargo')return false;
  if(t.kind==='tuner'&&tapped){t.channel=(t.channel+1)%4;sfx('pickup');if(t.channel===t.target)completeObjective();}
  return true;
}
function completeObjective(){
  const t=mission?.active;if(!t||t.done)return;t.done=true;t.progress=1;mission.completed++;mission.active=null;score+=800;sfx('pickup');burst(t.x,t.y-36,'#ace1b4',18);
  const task=mission.spec.tasks[t.taskIndex];if(task?.[3])say(task[3]);if(task?.[4])freeConscripts(task[4]);
  if(t.kind==='valve')zones=zones.filter(z=>z.style!=='vent');
  // ch3: the NEST SONIC DRIVER steers Thorne's pack and keeps Glassback standing: smashed, she is open to the end (x1.5)
  // and, held at her HP floor, she falls at once
  if(t.bossTask&&levelIndex===2){for(const e of enemies)if(e.boss&&!e.dead&&!e.dying){e.vulnT=999;e.vulnMul=1.5;if(e.phase===2&&e.hp<=1&&e.state!=='mutate'){finalBlow=blowKind==='special'||blowKind==='throw';e.inv=0;damageEnemy(e,99);}}say(level.driverDeadSay);toast='THE DRIVER IS DEAD · HIT HER NOW';toastTime=2;}
  if(t.bossTask&&levelIndex===5){say(level.spillwaySay);spawnLastCopy();}
}
// The spillway opens and the smashed control chair cracks (STORY.md chapter 6): Sable will not lose the gates, takes the
// unfinished Crown treatment and becomes CROWNBACK (BOSS_DEFS.fessenden, the engine's id): he steps out of the cracked
// chair to lock.right - 120 and transforms there (crownSpawn, crownMutate: about 2.9 s, invulnerable); card CROWNBACK ·
// THE CROWN TREATMENT, toast, lastCopy.say[0], his line for the front player's hero (lastCopy.byHero), say[1].
function spawnLastCopy(){
  if(!lock)lock={left:camera,right:camera+W};encounter={spec:{boss:true},next:0,timer:0};bossSpawned=true;cleared=false;
  const ly=laneY(.62,lock.right),D=BDEF.fessenden,t=D?.intro?.t||3.4;
  const b=crownSpawn(lock.right-(parseInt(String(D?.intro?.settle||'').split('-')[1])||120),ly);b.hp=b.maxhp=bossHpOf('fessenden')*rules().enemyHealth*bossScale();bossIntro=t;setBossCard(b.name,level.lastCopy?.card||D?.intro?.card||'CROWNBACK',t,true);
  if(crown){crown.cracked=true;crown.occupied=false;crown.stalled=false;}
  flash=.8;shake=14;toast=level.lastCopy?.toast||'SABLE TAKES THE UNFINISHED TREATMENT';toastTime=4.5;sfx('explosion');burst(crown?crown.x:lock.right-96,(crown?crown.y:ly)-60,'#cfeeff',26);
  const lc=level.lastCopy||{};say(lc.say?.[0]);say(lc.byHero?.[HEROES[multi()?leadPlayer().mp.hero:selected].id]);say(lc.say?.[1]);makeWheels();
}
function damageObjective(power,x=player.x,y=player.y,range=67,dir=player.dir){
  const t=mission?.active;if(!t||t.kind!=='beacon'||t.done)return false;
  if(Math.abs(t.x-x)>range||Math.abs(t.y-y)>28||(Math.abs(t.x-x)>11&&Math.sign(t.x-x)!==dir))return false;
  t.hp-=power;burst(t.x,t.y-30,'#8fdde2',8);driverHit(t);if(t.hp<=0)completeObjective();return true;
}
function updateMission(dt){
  if(radio){radio.ttl-=dt;if(radio.ttl<=0)radio=null;}
  if(!radio&&radioQueue.length)radio={text:radioQueue.shift(),ttl:4.6};
  const t=mission?.active;if(!t)return;
  // 2-3 players (§3.9): any player on the field in reach holding E works it, at the one-player rate
  if(multi()){const ps=present().filter(p=>onField(p)&&!passenger(p));
    if(t.kind==='cargo'){const p=ps.find(q=>withPlayer(q,objectiveNear));if(p)withPlayer(p,completeObjective);return;}
    if(t.kind==='beacon'||t.kind==='tuner')return;
    const p=ps.find(q=>withPlayer(q,()=>objectiveNear()&&down('KeyE','KeyV')&&player.hurt<=0&&player.attack<=0&&!player.move));
    if(p){t.progress+=dt/(t.bossTask?1.4:.85);if(t.progress>=1)withPlayer(p,completeObjective);}else t.progress=Math.max(0,t.progress-dt*.7);
    return;}
  if(t.kind==='cargo'){if(objectiveNear())completeObjective();return;}
  if(t.kind==='beacon'||t.kind==='tuner')return;
  if(objectiveNear()&&down('KeyE','KeyV')&&player.hurt<=0&&player.attack<=0&&!player.move){t.progress+=dt/(t.bossTask?1.4:.85);if(t.progress>=1)completeObjective();}
  else t.progress=Math.max(0,t.progress-dt*.7);
}
// Objective props are code-drawn art at their old size next to the heroes (LEG).
function drawMissionItem(t){
  const sx=t.x-viewX;if(sx<-74||sx>W+74)return;
  ctx.save();ctx.translate(Math.round(sx),Math.round(t.y));ctx.scale(LEG,LEG);try{drawMissionArt(t,0,0);}finally{ctx.restore();}
}
// The prison pod's sleeper: a sedated Wassoon fisherman, FERRIS sitting and hugging his knees (Chinpira main 11), green
// through the sedative (his gel map), one arcade px per art px inside the pod's legacy art (ENEMIES §2.7.3: no CSS filter).
function podOccupant(x,y){const a=eAnim(EK?.stateAnim('raider','A','sit')),F=ROME();if(!a||!F)return;ctx.save();ctx.scale(1/LEG,1/LEG);drawRomFrame(a.f[0][0],x*LEG,y*LEG,-1,F.palMap['chinpira:A/gel']);ctx.restore();}
// the convoy flatbed and its stasis pod (also the pod wagon of the p-convoy picture)
function cargoArt(g,x,y,spin,done){
  rect(g,x-62,y-16,124,7,'#2d3a3a');rect(g,x-58,y-27,116,12,'#55655f');rect(g,x-58,y-27,116,3,'#8a9a90');rect(g,x+58,y-22,26,4,'#6d7d78');
  for(const wx of [-40,38]){circle(g,x+wx,y-7,12,'#141a1e');circle(g,x+wx,y-7,7,'#9aa5ad');circle(g,x+wx,y-7,3,'#2a3238');rect(g,x+wx+Math.cos(spin)*5-1,y-7+Math.sin(spin)*5-1,2,2,'#3a434a');}
  rect(g,x-35,y-63,70,36,'#223332');rect(g,x-31,y-60,62,29,done?'#557363':'#968a5b');rect(g,x-5,y-61,10,32,'#d3c798');rect(g,x-25,y-50,19,9,'#304843');
  rect(g,x+10,y-55,14,18,done?'#2c4a3c':'#5fd39a');rect(g,x+13,y-52,8,12,'#bff3d6');
  for(const sx of [-33,27]){rect(g,x+sx,y-30,6,4,'#8a9a90');}
}
// the objective console (valves, relays, beacons: the nest sonic driver of the p-regent-asleep picture), mast optional
function consoleArt(g,x,y,glow,mast){
  rect(g,x-23,y-63,46,64,'#142d34');rect(g,x-20,y-60,40,51,'#496671');rect(g,x-16,y-55,32,23,'#152d31');rect(g,x-12,y-51,24,14,glow);
  for(let i=0;i<3;i++)rect(g,x-14+i*11,y-23,6,7,i===0?glow:'#89988e');rect(g,x-27,y-9,54,9,'#273d40');
  if(mast){rect(g,x-2,y-91,4,29,'#9aaea5');for(let j=0;j<3;j++)rect(g,x-17+j*4,y-86+j*8,34-j*8,3,glow);}
}
function drawMissionArt(t,x,y){
  shadow(ctx,x,y,25,6);
  const glow=t.done?'#a9de9a':t.kind==='beacon'?'#efaa71':levelIndex===5&&t.kind==='gate'?'#c08cff':'#7fdfd5';
  if(t.kind==='cargo'){
    // A convoy cargo wagon keeping pace with the Cadillac; ramming it knocks its crate loose.
    shadow(ctx,x,y,62,6);cargoArt(ctx,x,y,road/(9*LEG),t.done);
  }else if(t.kind==='pod'){
    // Rook's prison pod: frosted glass, green sedative and a sedated prisoner, numbered like cargo.
    rect(ctx,x-24,y-12,48,12,'#2a3a3f');rect(ctx,x-20,y-92,40,82,'#0c2224');
    if(!t.done){rect(ctx,x-18,y-88,36,76,'#3fbf8a66');ctx.save();ctx.beginPath();ctx.rect(x-18,y-88,36,76);ctx.clip();podOccupant(x+2,y-12+Math.sin(time*2)*2);ctx.restore();for(let i=0;i<4;i++)rect(ctx,x-12+i*8,y-14-((time*28+i*19)%70),2,2,'#c8ffe0');}
    else{rect(ctx,x-18,y-30,36,18,'#3fbf8a44');rect(ctx,x-14,y-86,4,30,'#bfe9ff55');}
    rect(ctx,x-16,y-86,4,72,'#ffffff22');rect(ctx,x-22,y-96,44,8,'#4b5d63');rect(ctx,x-9,y-104,18,8,'#6f8288');
    label(['07','09','12'][t.taskIndex]||'31',x+12,y-74,8,t.done?'#89a395':'#c7f4dc','center');
  }else if(t.kind==='gate'&&levelIndex===5){
    // Collar pylon broadcasting Echo's command signal to the conscripts' collars.
    rect(ctx,x-18,y-16,36,16,'#2b2f3c');rect(ctx,x-9,y-112,18,98,'#3b3f52');rect(ctx,x-5,y-108,10,90,t.done?'#2a2535':'#8656d8');
    if(!t.done){ctx.strokeStyle='#c49bff88';for(let i=0;i<3;i++){const r=(time*40+i*20)%60;ctx.beginPath();ctx.ellipse(x,y-112,r,r*.35,0,0,Math.PI*2);ctx.stroke();}rect(ctx,x-3,y-100+((time*60)%80),6,6,'#f0e2ff');}
    else{rect(ctx,x-12,y-70,24,4,'#16131c');rect(ctx,x+2,y-60,10,3,'#16131c');}
    rect(ctx,x-24,y-122,48,10,'#4a4f63');ctx.strokeStyle=glow;ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y-46,11,0,Math.PI*2);ctx.stroke();
  }else{
    const mast=t.kind==='relay'||t.kind==='beacon';consoleArt(ctx,x,y,glow,mast);
    if(mast){if(!t.done){ctx.strokeStyle=glow+'77';ctx.beginPath();ctx.ellipse(x,y-79,12+(time*18)%35,7+(time*9)%17,0,0,Math.PI*2);ctx.stroke();}}
    if(t.kind==='valve'||t.kind==='gate'){ctx.strokeStyle=glow;ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y-40,13,0,Math.PI*2);ctx.stroke();rect(ctx,x-2,y-53,4,26,'#273d40');}
  }
  if(t.done){label('✓',x,y-(t.kind==='gate'&&levelIndex===5?130:t.kind==='pod'?112:79),17,glow,'center');return;}
  const tall=t.kind==='gate'&&levelIndex===5?40:t.kind==='pod'?18:0;
  const hint=t.kind==='beacon'?'J / FIRE · SILENCE':t.kind==='cargo'?'RAM TO COLLECT':t.kind==='tuner'?`E · ${t.channel} → ${t.target}`:'HOLD E / PICK';
  label(t.name,x,y-106-tall,9,'#e6e6c4','center');label(hint,x,y-92-tall,10,glow,'center');
  rect(ctx,x-30,y-76-tall,60,4,'#10222b');rect(ctx,x-30,y-76-tall,60*(t.kind==='beacon'?t.hp/t.maxhp:t.progress),4,glow);
}
// Screen pass, arcade screen px. G7: the mission count, the freed conscripts and the objective arrow are HUD lines in the top
// rect (hudLines); this pass keeps the radio chatter in its reserved strip (arcade 8,46-376,78), above the feet band, so
// it never hides the fighters or the car.
function missionHud(){
  if(radio)drawRadio();
}

function spawnBoss() {
  // Once a boss is in, the next chapter's stage pages start loading (ARCHITECTURE §5.5; two chapters stay decoded).
  if(levelIndex<5){SR.require(levelIndex+1);bossArt(levelIndex+1);}
  bossSpawned=true;if(!lock)lock={left:camera,right:camera+W};if(!encounter)encounter={spec:{boss:true},next:0,timer:0};
  const type=level.kind,D=BDEF[type],t=D?.intro?.t||2.4,b=spawnEnemy(lock.right+111,laneY(.55,lock.right),type,true);
  b.name=D?.name||level.boss;b.pi=0;b.useN={};b.said={};b.calls=0;
  // the dam's gate controls (the Crown bake, a control chair under glass) stand in the floodgate arena from the start:
  // Sable takes the chair at his phase 2; its feet line sits in the back of the band, low enough that the glass (114 px
  // up) clears the radio strip
  if(type==='sable'){const x=lock.right-96,bb=bandOf(x);crown={x,y:clamp(Math.max(bb.top+18,cameraY+176),bb.top+18,bb.bottom-12),cracked:false,occupied:false,stalled:false};}
  // Krag's convoy halts on the causeway: everybody out of the Cadillac, the haulmaster comes on foot
  if(driving&&D?.onFoot){parkedCar={x:lock.left+58,y:laneY(.2,lock.left+58)};setDriving(false);toast='THE CONVOY HALTS · EVERYBODY OUT';toastTime=3;}
  if(type==='truck'&&driving){b.y=player.y;bossIntroSetup(b,{t,enterX:Math.min(lock.right-90,player.x+150)});}else bossIntroSetup(b,{t});
  bossIntro=t;setBossCard(b.name,level.bossCard||'',t);
  toast=level.bossToast||b.name;toastTime=4;for(const line of level.bossSay||[])say(line);voice('bossTaunt');
  if(levelIndex===2){mission.total=4;const x=lock.right-64;createObjective('beacon',D?.driver?.name||'NEST SONIC DRIVER',x,laneY(.83,x),0,true);}
  sfx('special');
}
// Freed conscripts (STORY.md chapter 6): every collar pylon broken frees collared Wassoon prisoners, who join from behind
// the player and fight beside the gang. Each fights with one hero's numbers (speed, power), in turn, so the help is the
// same as before; he is FERRIS on his ROM records inside a gold outline (CONSCRIPT, drawConscript).
function spawnAlly(k,quiet=false){
  const order=[1,2,3,0],hero=(selected+order[k%4])%4,hp=rules().allyHealth,L=lock||{left:camera};
  const b=bandOf(L.left),lp=leadPlayer();allies.push({id:'ally'+k,ally:true,conscript:true,v:CONSCRIPT.v,hero,lane:[-19,16,-6,27][k%4],x:L.left-44-k*33,y:clamp(lp.y+[-19,16,-6,27][k%4],b.top+4,b.bottom-4),z:0,dir:1,hp,maxhp:hp,state:'enter',timer:.4,anim:rand(0,1),hurt:0,inv:0,calm:0,strikeFlash:0,moving:false});
  if(!quiet)popup(lp.x,lp.y-89,'A CONSCRIPT IS FREE','#ffe08a');
}
function freeConscripts(n){for(let i=0;i<n;i++)spawnAlly(alliesFreed++);toast='FREED CONSCRIPTS JOIN THE FIGHT';toastTime=3;flash=.25;}
function hurtAlly(a,amount,fromX){
  if(a.inv>0||a.hp<=0)return;a.hp-=amount*.8;a.hurt=.3;a.inv=.4;a.calm=0;a.x+=fromX<a.x?13:-13;a.state='walk';burst(a.x,a.y-33,'#ffe08a',6);sfx('hit');
  if(a.hp<=0){a.state='down';a.timer=1.3;popup(a.x,a.y-74,'CONSCRIPT FALLS BACK','#ffe08a');}
}
function updateAlly(a,dt){
  const ox=a.x,oy=a.y;a.anim+=dt;a.hurt=Math.max(0,a.hurt-dt);a.inv=Math.max(0,a.inv-dt);a.timer-=dt;a.strikeFlash=Math.max(0,a.strikeFlash-dt);a.calm+=dt;a.moving=false;
  if(a.state==='down'){if(a.timer<=0)a.state='retreat';return;}
  if(a.state==='retreat'){a.x-=148*dt;a.dir=-1;a.moving=true;if(a.x<camera-104)a.remove=true;return;}
  if(a.calm>3&&a.hp<a.maxhp)a.hp=Math.min(a.maxhp,a.hp+8*dt);
  if(a.hurt>0)return;
  if(a.state==='windup'){if(a.timer<=0){const t=a.target;a.strikeFlash=.22;if(t&&!t.dead&&Math.abs((t.boss?hx(t,a.x):t.x)-a.x)<(t.boss?44:61)&&Math.abs(t.y-a.y)<(t.boss?bossDepth(t):27))damageEnemy(t,HEROES[a.hero].power*(t.boss||t.elite?.3:.62),a.dir*12,false,true);a.state='walk';a.timer=rand(.35,.75);}return;}
  let t=null,best=1e9;
  for(const e of enemies){if(e.dead||e.dying||e.state==='flee'||e.setPiece||!e.onstage||e.delay>0||(e.state==='drop'&&e.z>22)||(e.boss&&e.state==='intro'))continue;const d=Math.hypot(e.x-a.x,(e.y-a.y)*1.5);if(d<best){best=d;t=e;}}
  const speed=HEROES[a.hero].speed*.82;
  if(t){
    const want=t.boss?24:37,dist=Math.abs((t.boss?hx(t,a.x):t.x)-a.x);a.dir=Math.sign(t.x-a.x)||a.dir;
    if(dist>want){a.x+=a.dir*speed*(dist>119?1.5:1)*dt;a.moving=true;}
    const ty=t.y+(a.lane>0?4:-4);if(Math.abs(a.y-ty)>2){a.y=approach(a.y,ty,speed*.6*dt);a.moving=true;}
    if(dist<want+16&&Math.abs(t.y-a.y)<19&&a.timer<=0){a.target=t;a.state='windup';a.timer=.26;}
  }else{
    const lp=leadPlayer(),bb=bandOf(a.x),tx=lp.x-lp.dir*(59+Math.abs(a.lane)),ty=clamp(lp.y+a.lane,bb.top+4,bb.bottom-4),far=Math.abs(tx-a.x);
    if(far>13){a.dir=Math.sign(tx-a.x);a.x+=a.dir*speed*(far>193?1.7:1)*dt;a.moving=true;}
    if(Math.abs(a.y-ty)>3){a.y=approach(a.y,ty,speed*.6*dt);a.moving=true;}
  }
  if(a.state==='enter'&&(!lock||a.x>lock.left+22))a.state='walk';
  if(lock&&a.state!=='enter')a.x=clamp(a.x,lock.left+15,lock.right-15);const r=walkTo(ox,oy,a.x,a.y);a.x=r.x;a.y=r.y;
}

function popup(x,y,text,color='#e9ecd1'){floating.push({x,y,text,color,life:1.15});}
// Particle motion is in arcade px/s; sizes stay in the legacy art scale (drawParticles draws them under LEG).
function burst(x,y,color,n=12){for(let i=0;i<n;i++)particles.push({x,y,vx:rand(-89,89),vy:rand(-104,44),life:rand(.18,.55),size:rand(2,5),color});}
// Knocked-down and defeated fighters are flung back in an arc, bounce once and slide, as in the arcade game.
// Knockdowns throw an enemy back about a body length and a half, as in the arcade, not across the screen.
// A ROM body flies on its down-set anim (ENEMIES §2.3): fly (down 3), flyHeld (down 2, hit out of a hold) or the throw
// (down 8); the spin and the fall are in the art, so nothing is rotated.
function launch(e,dir,power=1,fling=null){e.state='fly';e.vx=fling?fling.vx:dir*(78+41*power);e.vz=fling?fling.vz:122+37*power;e.z=Math.max(e.z,2);e.bounces=0;e.inv=Math.max(e.inv,.25);e.hitChain=0;e.flyHeld=false;e.thrown=false;e.slam=false;if(e.vx)e.dir=-Math.sign(e.vx);}
function bloodBurst(e,dir,opts){
 const f=CFG.fx.blood,n=opts.sharp?f.knifeCount:f.count;
 for(let i=0;i<n;i++)particles.push({kind:'blood',x:e.x+dir*6,y:e.y-(opts.hitZ||(44+e.z)),ground:e.y-1,vx:dir*rand(...f.speed),vy:rand(-74,19),life:rand(...f.life),size:i%3?2:3,color:f.colors[i%f.colors.length]});
}
function explosionParticles(x,y){
 const f=CFG.fx.explosion;
 for(let i=0;i<f.fragments;i++)particles.push({kind:'debris',x,y:y-15,ground:y,vx:rand(-163,163),vy:rand(-193,-48),life:rand(.55,1.05),size:rand(2,5),color:i%2?'#fac45d':'#816b58'});
 for(let i=0;i<f.smoke;i++)particles.push({kind:'smoke',x:x+rand(-22,22),y:y-rand(12,44),vx:rand(-19,19),vy:rand(-48,-22),life:f.smokeLife+rand(-.15,.2),maxLife:f.smokeLife+.2,size:rand(8,15),color:i%2?'#74787c':'#41474c',float:true});
}
function updateParticles(dt){
 for(const p of particles){p.life-=dt;if(p.age!=null)p.age+=dt;if(p.rest)continue;p.x+=p.vx*dt;p.y+=p.vy*dt;if(!p.float)p.vy+=(p.g??CFG.fx.gravity)*dt;
   // a ROM casing (vx -2, vh 4 px/f, gravity .28 px/f², 30-33 f) does not bounce: it stops on the floor (HEROES §7.5)
   if(p.ground!==undefined&&p.y>=p.ground){p.y=p.ground;if(p.rom)p.rest=true;else if(p.kind==='blood'){p.rest=true;p.life=CFG.fx.blood.groundLife;}else if(!p.bounced){p.vy=-Math.abs(p.vy)*.28;p.vx*=.55;p.bounced=true;}else p.rest=true;}}
 particles=particles.filter(p=>p.life>0).slice(-CFG.fx.maxParticles);
}
function drawParticles(){
 for(const p of particles){if(p.rom&&p.seq&&fxDraw(seqCycle(p.seq,p.age*60+1e-6),p.x-viewX,p.y,0,p.dir||1))continue;
   ctx.save();ctx.globalAlpha=clamp(p.life/(p.kind==='smoke'?p.maxLife:.25),0,1);ctx.translate(Math.round(p.x-viewX),Math.round(p.y));ctx.scale(LEG,LEG);const x=0,y=0;
   if(p.kind==='smoke'){const unit=Math.max(2,Math.round((p.size+(p.maxLife-p.life)*15)/7));for(let row=0;row<7;row++){const w=[3,5,7,7,7,5,3][row];rect(ctx,x-w*unit/2,y+(row-3)*unit,w*unit,unit,p.color);}rect(ctx,x-unit*2,y-unit*2,unit*3,unit,'#8d9294');rect(ctx,x-unit*3,y-unit,unit,unit*2,'#666e73');}
   else if(p.kind==='shell')rect(ctx,x,y,p.rest?4:2,p.rest?2:4,p.color);
   else if(p.kind==='blood')rect(ctx,x,y,p.rest?5:Math.abs(p.vx)>74?4:2,p.rest?1:p.size,p.color);
   else rect(ctx,x,y,p.size,p.size,p.color);ctx.restore();}
}
function damageEnemy(e,amount,knock=0,forceDown=false,byAlly=false,opts=null) {
  if(e.waiting||e.dead||e.dying||e.inv>0||e.state==='flee'||(e.state==='drop'&&e.z>30)||e.delay>0||e.captive||e.state==='submerged')return false;
  const heavy=forceDown||!!opts?.heavy,melee=!!opts?.melee,kdir=Math.sign(knock)||-e.dir||1,R=romKind(e);
  // A Naguri group beating its captive is a set piece until someone hits one of them: then both turn on the hero as the
  // Hutori handlers of the same HUD name (CAMPAIGN §4.5) and count as fighters. ZEKE drops out of the sky on any hit.
  if(e.setPiece&&e.v==='N')provokeNaguri(e);
  if(e.type==='zeke'){e.hp-=amount;e.state='flee';e.vz=-1;e.inv=9;e.hurt=.15;lastHitEnemy=e;score+=Math.floor(amount*3);effects.push({type:'spark',x:e.x,y:e.y-e.z-20,age:0,life:.13});sfx('hit');kills+=e.hp<=0?1:0;return true;}
  // Bosses (G5): a car-fought truck boss (BOSS_DEFS.truck without onFoot; Krag / Ironclub is fought on foot) takes only rams (x2 in its head-up window, x0.5 otherwise) and gunfire (a call without opts,
  // the driving special or a test hook, counts in full); the open windows (Sable's reload, Glassback calmed, the gate
  // controls after a surge, Crownback staggered or with his guard broken) take x1.5.
  if(e.boss&&e.type==='truck'&&!BDEF.truck?.onFoot&&!opts?.self){const H=BDEF.truck?.hurt||{},m=!opts?1:opts.ram||opts.car?(e.state==='recover'&&e.mvName==='recover'?H.ramInRecover??2:.5):opts?.bullet?H.gun??1:H.other??0;sparkBurst(e.x+e.dir*60,e.y-46,4);if(!m)return false;amount*=m;}
  if(e.boss&&e.vulnT>0)amount*=e.vulnMul||1.5;
  const before=e.hp;
  e.hp-=amount;e.hurt=e.boss?.07:byAlly?.04:.15;e.inv=.055;if(e.boss?!(defOf(e)?.stationary||e.type==='fessenden'||e.type==='truck'):e.state==='fly')e.x+=knock*(e.boss?.25:.3);else if(!e.boss&&!heavy&&e.state!=='held'&&e.state!=='down')e.x+=knock*(e.elite?.5:1);   // a planted boss (the gate controls, Crownback, Krag's arena) is never shoved
  if(lock&&e.onstage)e.x=clamp(e.x,lock.left+21,lock.right-31);
  e.hitChain=e.hitTimer>0?e.hitChain+1:1;e.hitTimer=1.1;
  // Mid-bosses shrug off single knockdowns and need longer chains. Freed conscripts' blows hurt without
  // interrupting every move, so a guard can still trade punches with them. ROM enemies: the hurt pose lasts the
  // ROM's 10 f (down 0 / down 1); a body already lying stays down (a heavy blow plays the body slam, down 6); a bike is
  // never knocked over without being wrecked (its rider has no hurt pose of his own).
  if(R&&e.state==='down'){if(heavy){e.slamT=0;e.slam=true;e.timer=Math.max(e.timer,.5);}}
  else if(!e.boss&&e.state!=='held'&&e.state!=='fly'){if(e.type!=='biker'&&((forceDown&&(!e.elite||e.hitChain>=2))||e.hitChain>=(e.elite?5:byAlly?4:melee?5:3))){launch(e,kdir,heavy?1.2:.8,opts?.fling);if(e.hp>0)voice(e.type==='raptor'?'roar':'enemyHurt');}else if(!byAlly){e.state='hurt';e.timer=R?10/60:e.elite?.16:.25;}}
  else if(e.state==='held'&&forceDown){launch(e,kdir,1.2,opts?.fling);e.flyHeld=true;}
  // Hitstop: attacker and victim both hold the impact frame; the victim shakes. Heavier blows hold longer.
  if(!byAlly){lastHitEnemy=e;combo++;comboTimer=2;bestCombo=Math.max(bestCombo,combo);score+=Math.floor(amount*3);
    const stop=melee?(heavy?.16:.1):opts?.bullet?.04:.06;e.freeze=Math.max(e.freeze||0,stop);if(melee)player.freeze=Math.max(player.freeze||0,stop);shake=Math.max(shake,heavy?5:2);}
  if(!opts?.bullet)effects.push({type:'spark',x:e.x+kdir*-9,y:e.y-(e.boss?e.type==='fessenden'?88:62:46)-e.z,age:0,life:heavy?.2:.13,big:heavy});
  if(e.boss&&melee&&heavy&&e.hp>0)bossKnock(e,kdir);
  if((opts?.bullet||opts?.sharp)&&!(e.type==='truck'&&(e.phase===2||!BDEF.truck?.onFoot))&&!(e.type==='sable'&&e.phase===2))bloodBurst(e,kdir,opts);else burst(e.x,e.y-39-e.z,'#ffe2a1',opts?.bullet?8:4);if(!opts?.bullet)sfx(heavy?'heavy':'hit');
  if(e.boss&&e.hp>0)bossThresholds(e,before);
  if(e.hp<=0){
    // the tally's FINAL BLOW (CAMPAIGN §4.7): a special or a thrown weapon finished this boss (the last boss down counts)
    if(e.boss)finalBlow=!byAlly&&(blowKind==='special'||blowKind==='throw');
    if(e.boss){if(!bossDown(e,kdir)&&e.after)say(e.after);return true;}
    if(e.type==='raptor'){e.state='flee';e.timer=1.2;e.hp=1;e.inv=2;e.dir=1;score+=e.elite?1200:300;kills++;voice('roar');if(e.after)say(e.after);return true;}
    // The beaten Mirror Test staggers away; a Crown Guard officer with `flee` drops his keys and runs.
    if(e.elite&&(e.type==='mirror'||e.fleeOnDefeat)){voice('enemyDeath');e.state='flee';e.timer=1.6;e.hp=1;e.inv=3;e.dir=1;score+=1500;kills++;clearEnemyHazards(e.id);if(e.after)say(e.after);return true;}
    // BROOD MOTHER: beaten, she dives back into the flood and does not resurface (CAMPAIGN §8.3; treated as flee).
    if(e.brood){voice('roar');e.state='flee';e.sink=true;e.timer=1;e.hp=1;e.inv=9;score+=1200;kills++;clearEnemyHazards(e.id);if(e.after)say(e.after);return true;}
    {e.dying=true;e.inv=99;voice('enemyDeath');if(e.type==='biker'){e.state='dead';e.z=0;e.dead=1;e.wreck=true;}else if(e.state!=='fly')launch(e,kdir,1.4,opts?.fling);}
    // A beaten rider's bike goes up in a fireball, as in the arcade's highway stage, and its rider tumbles off the wreck
    // (KI15: the ROM respawns him as a GNEISS falling from 32 px; he is a fighter of this wave, so the lock waits for
    // him). The Tide Outrider is thrown clear and stays down (CAMPAIGN §6.3).
    if(e.type==='biker'){effects.push({x:e.x,y:e.y,age:0,life:.6,type:'explosion'});explosionParticles(e.x,e.y);sfx('explosion');shake=Math.max(shake,9);bikeRider(e,kdir);}
    clearEnemyHazards(e.id);score+=e.elite?1200:250;kills++;
    if(e.type==='mirror'){e.dissolve=true;burst(e.x,e.y-40,'#8af0b0',16);}   // a copy of a hero (only the Mirror Test's kind) melts
    if(e.after)say(e.after);
    const knifeOut=e.type==='knifer'&&e.knife!==false;if(e.type==='knifer')e.knife=false;
    if(driving){if(e.elite||Math.random()<rules().foodChance*1.5)drops.push(foodDrop(e.x,e.y,60,!!e.elite));}
    // a beaten enemy's weapon is knocked loose: it pops up spinning and lands on its ground record (drawDrop)
    else if(e.loot)drops.push({x:e.x,y:e.y,type:e.loot,life:60,loose:true,z:32,vz:90,dir:e.dir});
    else if(e.type==='gunner'&&e.v!=='T'&&e.v!=='U')drops.push({x:e.x,y:e.y,type:levelIndex>2?'uzi':'gun',life:60,loose:true,z:32,vz:90,dir:e.dir});
    else if(knifeOut)drops.push({x:e.x,y:e.y,type:'knife',life:60,loose:true,z:32,vz:90,dir:e.dir});
    else if(e.elite||Math.random()<rules().foodChance)drops.push(foodDrop(e.x,e.y,999,!!e.elite));
    else if(Math.random()<.08)drops.push(bonusDrop(e.x,e.y));
  }
  return true;
}

// KI21 (mechanics 0x1C08A): the hero has a stun meter of 10. Every enemy hit takes its 0xA2EA4 stun byte off it, and the
// hero is knocked down when the meter reaches 0, when the attack carries the knockdown flag (the record's reaction byte
// of 4 or more: the heavy reactions; 0 and 2 are the flinches the live runs show on 29/29 + 23/23 hits), when the hero is
// airborne (a jump or a dash), or when the hit takes the last life. Otherwise it is a flinch. The meter refills to 10 at
// a knockdown and 120 frames after the last hit. Hits without a ROM record (boss moves without one, zones, the test hook) keep
// the sequel rule: 20 or more damage knocks down. CFG.heroStun=false restores that rule for every hit.
// KI19 (0x6422): a hit that would overkill the hero by less than 5 (x1.2 for the 120-HP hero) leaves 1 HP, unless the
// hero is already on 1 HP.
function damagePlayer(amount,fromX,ignoreAir=false,hit=null) {
  if(testNoDamage||player.inv>0||(!ignoreAir&&player.z>21)||player.special>0||player.boost>0)return;
  // In the Cadillac a hit is a jolt, not a knockdown: the car keeps rolling. On foot the ROM clips set the lengths
  // (HEROES §6.6): a light hit is the hurt clip (10 f Jack, 15 f the others; hurtBack from behind: 10/8/8/15), a
  // knockdown is the knock clip (16 f thrown back, 24 f for a hard fall, then the bounces to lying) and the get-up
  // (26/33/30/29 f), with 20 invulnerable frames after it (mechanics get-up rule). Knocked from behind falls face down.
  const back=!driving&&Math.sign(fromX-player.x)===-player.dir,dmg=amount*rules().damageTaken;
  if(player.hp-dmg<=0&&dmg-player.hp<6&&player.hp>1)player.hp=1;else player.hp-=dmg;
  let knock;
  if(CFG.heroStun!==false&&hit&&hit.stun!=null){player.stun=Math.max(0,(player.stun??10)-hit.stun);player.stunT=2;knock=player.stun<=0||(hit.react|0)>=4||player.z>0||player.attackKind==='dash'&&player.attack>0;}
  else knock=amount>=20;
  player.knocked=!driving&&knock;if(player.knocked)player.stun=10;
  if(driving)player.hurt=.3;
  else if(player.knocked){player.knockRole=amount>=40?'knockHard':back?'knockFace':'knock';player.hurt=heroClipLen(player.knockRole,.6)+heroClipLen('getup',.25);}
  else{player.hurtRole=back?'hurtBack':'hurt';player.hurt=heroClipLen(player.hurtRole,.3);}
  player.hurtTotal=player.hurt;player.inv=player.knocked?player.hurt+20/60:.65;
  player.x+=fromX<player.x?17:-17;player.attack=0;player.pendingStrike=null;player.moveState=null;player.swing=null;player.freeze=0;releaseGrab();player.z=0;player.vz=0;combo=0;comboTimer=0;player.pickup=0;player.pickTarget=null;
  player.burst=null;player.runLatch=0;player.dashPhase=null;player.dropIn=false;if(player.knocked)dropWeapon();shake=6;flash=.06;sfx('hurt');if(player.hp<=0||player.knocked&&player.knockRole==='knockHard')voice('death');burst(player.x,player.y-33,'#eea575',8);
  // A lost life: the death fall (knockHard, the ROM's death fall) and a moment lying, then the next life drops in from
  // the top of the screen (startDropIn; HEROES §6.6). The last life goes to the continue count.
  if(player.hp<=0){lives--;if(lives>0){player.hp=player.maxhp;dropWeapon();player.knocked=!driving;player.dying=!driving;if(!driving){player.knockRole='knockHard';player.hurt=player.hurtTotal=heroClipLen('knockHard',.65)+1;}else player.hurt=0;player.inv=player.hurt+3;toast=multi()?`${player.mp.slot+1}P · ${lives} LIVES REMAINING`:`${lives} LIVES REMAINING`;toastTime=3;checkpoint();}else if(multi())mpStartContinue();else startContinue();}
}
// The respawn drop-in (HEROES §6.6; ROM caller 0x18C04): the hero falls in from the top of the screen on the jumpFwd
// clip ("respawn / join drop-in") with the normal gravity and lands; no control until the feet touch the floor.
function startDropIn(){player.dying=false;player.knocked=false;player.hurt=0;player.z=Math.max(48,player.y-cameraY+8);player.vz=0;player.dropIn=true;player.inv=3;player.jumpRole='jumpFwd';player.airAttacked=false;player.attack=0;player.runLatch=0;}
// Arcade continue: the hero lies where they fell while a ten-second count runs. Dropping a coin (Enter, attack, the touch
// HIT button or a pad button) spends a credit and the hero gets up on the same spot with full health and lives; the
// enemies are still there. If the count reaches zero it is game over.
function startContinue(){
  // The hero falls on the death fall clip (knockHard) and stays on its lying frame (player.downT runs the clip).
  state='continue';continueTimer=10;coinPending=0;player.down=true;player.downT=0;player.dying=false;player.dropIn=false;player.hurt=0;player.knocked=false;player.attack=0;player.moveState=null;player.pendingStrike=null;player.swing=null;player.burst=null;player.runLatch=0;player.z=0;player.vz=0;releaseGrab();
  bullets=bullets.filter(b=>b.friendly);zones=[];resetInput();panel('');toast='';toastTime=0;
  // The crowd stands off while the count runs instead of freezing mid-swing.
  for(const e of enemies)if(!e.dead&&!e.dying&&['windup','charge','leap'].includes(e.state)){e.state='walk';e.timer=1.5;e.strikeFlash=0;clearEnemyHazards(e.id);}
}
function insertCoin(){coins++;sfx('pickup');if(state==='play'){toast='CREDIT '+coins;toastTime=1.5;}}
function updateContinue(dt){
  gamepad();player.downT+=dt;
  if(coinPending>0){coinPending-=dt;if(coinPending<=0)respawn();pressed.clear();return;}
  continueTimer-=dt;
  if(tap('Enter','NumpadEnter','KeyJ','KeyZ','Space')){insertCoin();coinPending=.9;}
  else if(continueTimer<=0)gameover();
  pressed.clear();
}
function respawn(){
  coins=Math.max(0,coins-1);lives=3;player.hp=player.maxhp;player.inv=3;player.hurt=0;player.knocked=false;player.down=false;player.z=0;player.vz=0;dropWeapon();if(!driving)startDropIn();
  for(const e of enemies)if(!e.dead&&!e.dying&&['windup','charge','leap'].includes(e.state)){e.state='walk';e.timer=1.2;clearEnemyHazards(e.id);}
  state='play';panel('');resetInput();toast='PLAYER 1 · CONTINUE';toastTime=2.5;sfx('special');voice('go');flash=.3;checkpoint();
}
// 2-3 players (§3.10): a last life does not stop the game. The hero lies on the death fall's lying frame while that
// player's own 10-s count runs on its HUD block; a coin (Enter or attack) spends a shared credit and drops the hero back
// in on the spot with full health and 3 lives. At 0 the player is out: the slot calls JOIN-IN again and a coin brings
// them back any time, score kept (O-MP8). Game over when every player is out.
function mpStartContinue(){
  const m=player.mp;m.cont={t:10,pending:0};player.down=true;player.downT=0;player.dying=false;player.dropIn=false;player.hurt=0;player.knocked=false;player.attack=0;player.moveState=null;player.pendingStrike=null;player.swing=null;player.burst=null;player.runLatch=0;player.z=0;player.vz=0;releaseGrab();dropWeapon();
  toast=`${m.slot+1}P · CONTINUE?`;toastTime=2;
  for(const e of enemies)if(e.tp===player)e.tp=null;
  if(!active().length)for(const e of enemies)if(!e.dead&&!e.dying&&['windup','charge','leap'].includes(e.state)){e.state='walk';e.timer=1.5;e.strikeFlash=0;clearEnemyHazards(e.id);}
}
function mpDownStep(dt){
  const m=player.mp,coin=tap('Enter','NumpadEnter','KeyJ','KeyZ','Space');m.mx=player.x;m.my=player.y;m.moved=0;
  if(m.cont){player.downT+=dt;
    if(m.cont.pending>0){m.cont.pending-=dt;if(m.cont.pending<=0)mpRespawn();return;}
    m.cont.t-=dt;
    if(coin){insertCoin();m.cont.pending=.9;}
    else if(m.cont.t<=0){m.cont=null;m.out=true;player.down=false;toast=`${m.slot+1}P · GAME OVER`;toastTime=2.5;if(present().every(p=>p.mp.out))mpAllOut=true;}
    return;}
  if(m.out&&coin){insertCoin();mpRespawn();}
}
let mpAllOut=false;
function mpRespawn(){
  const m=player.mp,b=bandOf(camera+W/2);coins=Math.max(0,coins-1);lives=3;
  if(m.out){player.x=clamp(camera+64+40*m.slot,camera+32,camera+W-32);player.y=clamp(b.mid+[0,-12,12][m.slot],b.top,b.bottom);}
  else player.x=clamp(player.x,camera+32,camera+W-32);
  m.cont=null;m.out=false;player.hp=player.maxhp;player.inv=3;player.hurt=0;player.knocked=false;player.down=false;player.z=0;player.vz=0;dropWeapon();
  if(!driving)startDropIn();m.tag=2;toast=`${m.slot+1}P · CONTINUE`;toastTime=2;sfx('special');voice('go');
}
// A passenger in the Cadillac (§3.11): rides with the driver; its attack is a side bash out of the back seat.
function passengerStep(dt){
  const d=driverP(),m=player.mp,seat=Math.max(1,present().filter(q=>q!==d).indexOf(player)+1);
  player.x=d.x-6-14*seat;player.y=d.y;player.z=0;player.dir=d.dir;player.vx=d.vx;player.roll=d.roll;m.mx=player.x;m.my=player.y;m.moved=0;
  for(const k of ['inv','hurt','attack','special','specialCd','boost','boostCd'])player[k]=Math.max(0,player[k]-dt);
  if(tap('KeyJ','KeyZ','Space')&&player.attack<=0){const side=seat%2?-1:1,ox=player.x;player.attack=player.attackTotal=.5;player.x=d.x+side*40;player.dir=side;meleeStrike(CAR_REACH*.6,46,true,null,{car:true});player.x=ox;player.dir=d.dir;sfx('hit');}
  if(tap('Enter','NumpadEnter'))insertCoin();
}
// The in-place continue (CAMPAIGN D18: the user's 10-s count over the fallen hero, not the 1993 Vice T. screen) in the
// ROM font: CONTINUE? and the count over the lanes, the coin call, how to drop one, and CREDIT n at the foot of the
// screen as the cabinet prints it. It is a transient card; the top HUD stays where it is.
function drawContinue(){
  rect(ctx,0,0,W,H,'#05100f99');const n=Math.max(0,Math.ceil(continueTimer)),U=UI();
  if(!U){label('CONTINUE? '+n,W/2,100,12,'#ffd23c','center');return;}
  U.text(ctx,'CONTINUE?',192,64,{font:16,align:'center',snap:true,pen:'yellow',outline:true});
  U.text(ctx,String(n),192,84,{scale:3,align:'center',pen:'red',outline:true});
  if(coinPending>0)U.text(ctx,'CREDIT '+coins+' · PLAYER 1 START',192,120,{align:'center',pen:'orange',outline:true});
  else if(Math.floor(time*60/U.TIMING.blink)%2===0)U.text(ctx,'INSERT COIN',192,120,{align:'center',pen:'orange',outline:true});
  U.text(ctx,TOUCH?'TAP HIT TO DROP A COIN':'PRESS ENTER OR J TO DROP A COIN',192,136,{align:'center',pen:'grey'});
  U.text(ctx,'CREDIT '+coins,192,200,{align:'center'});
}

function shoot(x,y,dir,friendly=true,damage=18,speed=459,owner=null){bullets.push({x,y,owner,z:driving?21:36,vx:dir*speed,vy:0,friendly,damage,life:1.5,color:friendly?'#fff4af':'#ef8f68'});}
const nearbyDrop=(rx,ry,weaponsOnly)=>{let best=null,dist=1e9;for(const d of drops){if(d.claimed||(weaponsOnly&&PICKUPS.has(d.type)))continue;const dx=Math.abs(d.x-player.x),dy=Math.abs(d.y-player.y);if(dx<rx&&dy<ry&&dx+dy<dist){dist=dx+dy;best=d;}}return best;};
// Picking something up is the ROM crouch, main:10 (11 f): the item reaches the hand on its ev1 frame (after 10 f) and
// the weapon shows in its stance afterwards (HEROES §6.1 row 2, §6.5).
function startPickup(d){heroAct();player.moveState=null;player.swing=null;player.runLatch=0;player.dashPhase=null;player.pickup=player.pickupTotal=heroClipLen('pickup',.26);player.pickAt=Math.min(player.pickup,heroClipEvent('pickup',f=>f[4]===1,.14));
  player.pickTarget=d;d.claimed=true;player.attack=0;player.pendingStrike=null;player.burst=null;player.dashVelocity=0;player.attackKind='ready';if(Math.abs(d.x-player.x)>4)player.dir=Math.sign(d.x-player.x);}
function updatePickup(dt){
  if(player.pickup<=0)return;const before=player.pickup;player.pickup=Math.max(0,player.pickup-dt);const at=player.pickupTotal-player.pickAt+1e-9;
  if(before>at&&player.pickup<=at){
    const d=player.pickTarget;player.pickTarget=null;if(!d||!drops.includes(d))return;drops.splice(drops.indexOf(d),1);sfx('pickup');score+=75;
    if(PICKUPS.has(d.type)){consumeItem(d);}
    else{dropWeapon();player.weapon=d.type;player.ammo=d.ammo??Math.max(1,Math.round((WEAPONS[d.type]?.ammo??1)*(WEAPONS[d.type]?.melee?rules().meleeDurability:1)));toast=`${WEAPONS[player.weapon]?.name||player.weapon} · ${player.ammo} ${WEAPONS[player.weapon]?.melee?'HITS':'SHOTS'}`;toastTime=2;}
  }
}
// Ground combo on the ROM clips (HEROES D10, §6.2): punch, punch, kick, finisher. Each move plays its start clip
// (p1/p2 = punch:0, kick = punch:3, fin = punch:4) at its 60 Hz durations and lands the blow on the first active frame;
// a blow that connects switches to the shorter contact clip (p1Hit, kickHit, finHit), starting on its frame 0, which is
// the same active record. The chain only continues when the previous blow connected, as in the original. The grab's
// knee (knee1/knee2) hits on its ev1 frame and the grab throw (throwFwd/throwBack) lets go on its first event frame
// (Jack 13 f, Mustapha 13 f, Hannah 17 f, Mess 31 f; §6.4). `frames` and `k` are the clip's own frames.
const MOVE={p1:{reach:62,power:1},p2:{reach:62,power:1},kick:{reach:73,power:1.25},fin:{reach:79,power:1.75,heavy:true},knee:{power:.85},throw:{}};
// clip -> [{i, d (s), hit}], the hit on the first frame that passes `test`
function moveFrames(t,test){const hitAt=t.f.findIndex(test);return t.f.map((f,i)=>({i,d:(i+1<t.at.length?t.at[i+1]:t.len)-t.at[i],hit:i===hitAt}));}
function startMove(name,extra={}){
  heroAct();
  const role=extra.role||name,t=heroClipTiming(role),grab=name==='knee'||name==='throw';
  // no ROM data (never in a normal load): today's three-frame fallback with the hit on frame 1
  const frames=t?moveFrames(t,grab?f=>f[4]!==0:f=>f[5]!==0):[0,1,2].map(i=>({i,d:i<1?.055:i===1?.12:.075,hit:i===1}));
  if(!frames.some(f=>f.hit))frames[Math.min(1,frames.length-1)].hit=true;
  player.moveState={name,role,contact:grab?null:RIG()?.clip(HEROES[selected].id,role)?.contact||null,frames,k:0,t:0,struck:[],landed:false,...extra};player.attackKind='combo';
  player.attackTotal=frames.reduce((a,f)=>a+f.d,0);player.attack=player.attackTotal;player.pendingStrike=null;player.swing=null;player.runLatch=0;
  if(frames[0].hit){moveHit(player.moveState);contactClip(player.moveState);}if(name!=='throw')sfx('swing');if(name==='fin'||name==='knee')voice('attack');else if(name==='throw')voice('throw');
}
// a landed combo blow goes on in its contact clip (frame 0 = the same active record); true when it switched
function contactClip(m){
  if(!m.landed||!m.contact||m.switched)return false;const t=heroClipTiming(m.contact);if(!t)return false;
  m.role=m.contact;m.switched=true;m.frames=moveFrames(t,()=>false);m.k=0;m.t=0;return true;
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
  while(m.k<m.frames.length&&m.t>=m.frames[m.k].d-1e-9){m.t-=m.frames[m.k].d;m.k++;if(m.k<m.frames.length&&m.frames[m.k].hit){moveHit(m);if(contactClip(m))break;}}
  if(m.k>=m.frames.length){player.moveState=null;player.attack=0;player.comboWin=.42;player.comboHit=m.landed;if(!m.landed)player.comboStep=-1;}
  else player.attack=Math.max(player.attack,.01);
}
// Walking into an ordinary enemy grabs them. Attack knees; back + attack throws over the shoulder;
// the fourth attack throws forward. A thrown body flies, bowls over others and bounces.
function updateGrab(dt,dx){
  const g=player.grab;
  if(!g){
    if(driving||player.weapon||player.grabCd>0||player.attack>0||player.hurt>0||player.z>0||player.pickup>0||player.special>0||!dx)return;
    // Grabbable = the kind has a ROM held set (ENEMIES §2.3, RC8): BLUDGE and TYROG now, never a raptor, a bike or ZEKE.
    const e=enemies.find(o=>!o.dead&&!o.dying&&!o.boss&&!o.elite&&!o.setPiece&&o.onstage&&!(o.delay>0)&&!o.z&&['walk','hurt','windup','recover'].includes(o.state)&&(romKind(o)?eTable(o)?.grab!==false:!['raptor','biker','mutant','regent'].includes(o.type))&&Math.abs(o.x-player.x)<27&&Math.abs(o.y-player.y)<8&&Math.sign(o.x-player.x)===dx);
    if(e){player.grab={e,t:0,hits:0};e.state='held';e.timer=0;e.hitChain=0;clearEnemyHazards(e.id);player.dir=dx;player.moveState=null;toast=TOUCH?'GRAB · HIT KNEES · BACK + HIT THROWS':'GRAB · J KNEE · BACK + J THROW';toastTime=1.6;}
    return;
  }
  const e=g.e;g.t+=dt;
  if(e.dead||e.dying||e.state!=='held'||player.hurt>0||player.special>0){releaseGrab();return;}
  if(!player.moveState||player.moveState.name!=='throw'){e.x=player.x+player.dir*22;e.y=player.y+1;e.dir=-player.dir;e.z=0;}
  if(g.t>1.8&&!player.moveState){e.state='walk';e.timer=.45;e.x+=player.dir*15;releaseGrab();}
}
function releaseGrab(){const g=player.grab;if(g&&g.e.state==='held'){g.e.state='walk';g.e.timer=.5;}player.grab=null;player.grabCd=.5;}
function grabAttack(){
  const g=player.grab,dxk=(down('ArrowRight','KeyD')?1:0)-(down('ArrowLeft','KeyA')?1:0),back=dxk===-player.dir;
  if(back||g.hits>=3){
    const e=g.e,h=HEROES[selected],dir=back?-player.dir:player.dir;
    startMove('throw',{back,role:back?'throwBack':'throwFwd',onRelease:()=>{if(e.state!=='held'){releaseGrab();return;}e.state='walk';e.x=player.x+dir*(back?7:21);e.z=22;
      damageEnemy(e,h.power*2.3,dir*22,true,false,{melee:true,heavy:true,fling:{vx:dir*185,vz:222}});e.thrown=true;if(multi())e.byP=player;player.grab=null;player.grabCd=.7;if(back)player.dir=dir;}});
    return;
  }
  g.hits++;startMove('knee',{role:g.hits%2?'knee1':'knee2'});
}
function attack() {
  if(state!=='play'||player.hurt>0||player.attack>0||player.special>0||bossIntro>0||player.pickup>0||player.dropIn)return;
  if(player.grab){grabAttack();return;}
  if(!driving&&!player.weapon&&player.z===0){const d=nearbyDrop(22,13,true);if(d){startPickup(d);return;}}
  if(driving){player.attack=.5;player.attackTotal=.5;player.boost=.5;meleeStrike(CAR_REACH+33,62,true,null,{car:true});sfx('hit');return;}
  // D9 (HEROES §1, §6.1 rows 8-9): in the air an attack is the jump kick and on the run it is the dash, armed or not
  // (all 60 armed ROM runs; 44 of them run + attack, every class); the weapon fires, swings or is thrown only from the
  // ground at walking pace, and is drawn at the kick's and the dash's holds.
  const h=HEROES[selected],grounded=player.z<=6&&!player.run;
  if(grounded&&weaponAttack())return;
  if(grounded){const step=player.comboWin>0&&player.comboHit?(player.comboStep+1)%4:0;player.comboStep=step;startMove(['p1','p2','kick','fin'][step]);return;}
  // Dash and air attacks strike on their ROM clips' active frames (HEROES §6.3), once per target. The dash (run +
  // attack; it ends a persisting run, KI22) is Jack's 27-f slide or the others' flying kick held until they land, then
  // dashEnd; the motion stays the sequel's (dashVelocity, the hop). In the air: airRun after a running take-off, airLate
  // when a forward jump is past its apex, else airKick; the attack lasts until the landing, which is then a hard one.
  player.attackKind=player.z>6?'air':'dash';player.comboStep=-1;heroAct();player.runLatch=0;
  const dash=player.attackKind==='dash',role=dash?'dash':player.jumpRole==='jumpRun'?'airRun':player.jumpRole==='jumpFwd'&&player.vz<0?'airLate':'airKick';
  if(!dash){player.airRole=role;player.airAttacked=true;voice('jump');}else{player.dashPhase='dash';player.dashT=0;voice('attack');}
  player.attackTotal=heroClipLen(role,dash?.52:.45);player.attack=player.attackTotal;
  player.pendingStrike={role,t:0,range:dash?93:80,power:h.power*1.5,down:true,struck:[]};
  if(dash){player.dashVelocity=player.dir*[326,281,244,259][selected];if(selected!==1){player.z=12;player.vz=selected===3?126:104;}}
  sfx('swing');
}
// The end of the dash's strike phase: Jack's slide has run its clip, a hopping hero has landed. dashEnd (main:13)
// follows, with no strike and no slide.
function endDash(){player.dashPhase='end';player.dashT=0;player.pendingStrike=null;player.dashVelocity=0;player.attack=player.attackTotal=heroClipLen('dashEnd',.2);}

// The jump clip is chosen at take-off (HEROES §6.1 row 13): jumpRun from a run, jumpBack when the hero turned in the
// last 3 frames (ROM +0xAB), jumpFwd while moving, else jumpUp; it plays by time and holds its last frame until landing.
function jump(){if(player.z>0||player.hurt>0||player.pickup>0||player.dropIn)return;if(driving){if(player.boostCd<=0){player.boost=1.15;player.boostCd=3;player.inv=1.2;sfx('jump');}return;}
  player.jumpRole=player.run?'jumpRun':time-player.turnAt<3/60+1e-9?'jumpBack':player.move?'jumpFwd':'jumpUp';player.airAttacked=false;
  player.vz=263;player.z=.1;sfx('jump');voice('hop');}
// The mega crash's ROM clip is punch:8 (Jack 39 f, Mustapha 118 f, Hannah 36 f, Mess 54 f; HEROES §6.3); its damage stays
// on the call (regression L29-L31 read it at once). MEGA_ROM_LOCK: G4 took PLAN §8.2's R1 lever 'mega lock' (HEROES R1
// fallback): with the G4 enemies (ROM HP, chapter 6 at 313 s on average over six seeds against the 300-s gate, and no
// earlier lever moving it: telegraph, cadence, the wave cut, boss HP steps and the hurt lengths each changed the mean by
// under 8 s) the hero is locked for the sequel's 0.65 s and the ROM clip plays that long (Mustapha's 1.97 s tornado is
// cut short). true restores the ROM length; G8's balance pass decides with the bot. Re-measured in the G4 fix pass (the
// bot plays Mustapha, whose 1.97 s tornado deals its damage on the call and then only locks him): true = ch6 319 s mean
// over 10 seeds (308-329) and the bot run 308 s; true plus every earlier lever stacked (telegraph easy 1.8, cadence
// x0.67, ch6 boss HP -30%, hurt/knockdown lengths reverted) still 303 s (287-320). So it stays false.
const MEGA_ROM_LOCK=false;
function special() {
  if(player.specialCd>0||player.hurt>0||bossIntro>0||player.pickup>0||player.dropIn)return;
  const len=driving||!MEGA_ROM_LOCK?.65:heroClipLen('mega',.65);
  heroAct();player.special=player.specialTotal=len;player.specialCd=Math.max(1.9,len+.1);player.inv=.8;player.attack=0;player.pendingStrike=null;player.moveState=null;player.swing=null;player.runLatch=0;player.dashPhase=null;releaseGrab();
  if(!driving)dropWeapon();let hits=0;blowKind='special';
  for(const e of enemies)if(!e.dead&&e.state!=='flee'&&Math.hypot(((e.boss?hx(e,player.x):e.x)-player.x)*.8,e.y-player.y)<104){if(damageEnemy(e,HEROES[selected].power*2.2,Math.sign(e.x-player.x)*34,true))hits++;}
  if(hits&&!driving)player.hp=Math.max(1,player.hp-8);
  for(const o of objects)if(o.hp>0&&Math.abs(o.x-player.x)<85&&Math.abs(o.y-player.y)<48)breakObject(o,99);
  damageObjective(HEROES[selected].power*2.2,player.x,player.y,104,player.dir);blowKind=null;
  sfx('special');voice('special');shake=6;burst(player.x,player.y-30,HEROES[selected].color,22);
}

function pickup() {
  if(player.hurt>0||player.z>0||player.pickup>0||player.dropIn)return;
  if(interactMission(true)||driving||wheelNear())return;
  const d=nearbyDrop(33,18,false);if(d){startPickup(d);return;}
  if(player.weapon)throwHeldWeapon();
}

// ================================================================ the boss driver (PLAN §7 G5; ENEMIES §6.1; CAMPAIGN §5.4-§10.4, §12.4)
// Every boss fights its BOSS_DEFS record (enemy-kinds.js) on its ROM body (ROM_BOSSES, sprite-data-bosses.js), drawn at one
// arcade px per art px in the palette the build chose for the body (bodies.<body>.use: rook, ironhide, t60-e2a1-pal30,
// cinder, slicevat, sable; Crownback's stand-in its home S8A3; the gate controls the crown bake). The executor (ENEMIES §6.1 DECISION):
// the phase's pattern is a cycle on e.pi and a move whose `when` fails is skipped, never re-rolled (no Math.random
// anywhere here); the windup is max(frames before the blow x T, 0.25 s) / bossTempo and the blow lands on the anim's
// active frame (or the authored release / shot frame); zones are drawn only for the arena (flood, fire, steam, tide, the
// slams), a melee swing carries no ellipse (the swing in the anim is the tell). Kept from before: the intro state,
// bossReinforce at 66 % / 33 % with BOSS_GUARDS (bossCall), the boss card. New: knockdowns behind CFG.bossKnockdown
// (a finisher, at most once per 4 s, armour on active frames; Breakwater, Glassback, the gate controls and Crownback are exempt),
// bossLines thresholds said once, the card / toast / lines / music from the chapter's campaign data.
const ROMB=()=>window.ROM_BOSSES||window.SPRITE_DATA?.families?.bosses||null;
const BDEF=window.BOSS_DEFS||{};
const bAnim=key=>key?ROMB()?.anims?.[key]||null:null;
const bLen=key=>animLen(bAnim(key));
// PLAN §8.2 levers: K.BOSS_DMG (CAMPAIGN's damage numbers already carry its 0.8, ENEMIES §6.1) and boss HP in -10 % steps
// per fight (chapter 6's three forms keep G3d's one step: Sable 720, the gate controls 945, Crownback 1035).
const BOSS_HP_LEVER={sable:.9,fessenden:.9};
const bossDmg=(v,k=0)=>Math.max(1,Math.round((Array.isArray(v)?v[k%v.length]:v??14)*((EKK.BOSS_DMG??.8)/.8)));
function bossHpOf(type,phase=1){const d=BDEF[type],hp=phase===2&&d?.phase2?d.phase2.hp:d?d.hp:BOSS_HP[levelIndex];return hp*(BOSS_HP_LEVER[type]??1);}
// Sable at the gate controls is his phase 2 (CAMPAIGN §10.4): his def with phase2's name, moves and pattern, stationary.
// Krag's second form (IRONCLUB) is his phase2 on its own body: the def with phase2's name, body, moves, pattern and defeat.
let SABLE2=null;const PHASE2={};
function defOf(e){const d=BDEF[e?.type];if(!d)return null;if(e.type==='sable'&&e.phase===2&&d.phase2)return SABLE2||(SABLE2=Object.assign({},d,{name:d.phase2.name,moves:d.phase2.moves,phases:[{at:1,pattern:d.phase2.pattern}],stationary:true,clone:false}));
  if(e.phase===2&&d.phase2&&d.phase2.body)return PHASE2[e.type]||(PHASE2[e.type]=Object.assign({},d,d.phase2,{phases:d.phase2.phases||[{at:1,pattern:d.phase2.pattern}],clone:false}));return d;}
const bodyOf=e=>{const d=defOf(e),B=ROMB();return d&&B&&B.bodies?B.bodies[d.body]||null:null;};
function bossMap(e,gel){const b=bodyOf(e);if(!b||!b.pal)return null;return gel?b.pal.gel||null:b.pal[b.use]||b.pal.home||null;}
const BOSS_DEPTH=26;
const bossDepth=e=>e&&e.type==='sable'&&e.phase===2?58:e&&e.type==='fessenden'?34:27;
// Anim references of BOSS_DEFS: 'main:9', 'main:12>9' (a pre anim, then the move), 'main:7|2' (alternatives, taken in
// turn), 'main:20..27' (a speed range), 'main:17r' (backwards), '0x6FDEC/18' (absolute), 'hit:2', and Crownback's
// '<part> main:n'. A bare number inherits the set named before it ('main:12>9' = main 12 then main 9).
function bSet(e,part,set){const b=bodyOf(e);if(!b)return null;
  if(b.parts&&part&&part!=='body'){const p=b.parts.find(q=>q.id===(part==='neck'?'neckA':part));return p?p.set:null;}
  return set==='hit'?b.hit:set==='grab'?b.grab:b.main;}
function bSpec(e,spec){
  if(!spec)return null;
  return kc(`bs|${e.type}|${bodyOf(e)?.main||''}|${spec}`,()=>{
    let s=String(spec).trim(),part=null,set=null;const pm=/^(body|arm2|arm|neckA|neckB|neck|line)\s+(.+)$/.exec(s);if(pm){part=pm[1];s=pm[2];}
    const one=t=>{t=t.trim();const rev=/r$/.test(t);if(rev)t=t.slice(0,-1);
      const ab=/^0x([0-9A-Fa-f]+)[/:](\d+)$/.exec(t);if(ab)return {keys:['0x'+ab[1].toUpperCase()+':'+ab[2]],rev};
      const m=/^(?:(main|hit|grab):)?(\d+)(?:\.\.(\d+))?$/.exec(t);if(!m)return null;if(m[1])set=m[1];const S=bSet(e,part,set||'main');if(!S)return null;
      const a=+m[2],z=m[3]!=null?+m[3]:a,keys=[];for(let k=a;k<=z;k++)keys.push(S+':'+k);return {keys,rev};};
    const gt=s.split('>'),pre=gt.length>1?one(gt[0]):null,alts=gt[gt.length-1].split('|').map(one);
    if(alts.some(x=>!x||!x.keys.every(k=>bAnim(k))))return null;
    return {part,pre:pre&&bAnim(pre.keys[0])?pre.keys[0]:null,alts:alts.map(x=>x.keys),rev:alts[0].rev};
  });
}
const frW=fid=>ROMB()?.frames?.[fid]?.[3]||0;
// One move of a boss, taken the `alt`-th time: its anim, the frame it lands on (first active frame; the authored release;
// a pistol's shot frames = the anim's narrow recoil frames; else the widest frame), the frames before it, and its record.
function bInfo(e,name,alt=0,raw=null){
  const d=defOf(e),mv=raw||d?.moves?.[name];if(!mv)return null;
  return kc(`bi|${e.type}|${e.phase|0}|${name}|${alt%2}`,()=>{
    const kind=mv.kind||'strike',sp=bSpec(e,mv.a||(e.type==='cinder'&&(kind==='lob'||kind==='volley')?'main:11':null)),keys=sp?sp.alts[alt%sp.alts.length]:null;
    const key=keys?keys[kind==='rush'?keys.length-1:Math.min(keys.length-1,3)]:null,an=bAnim(key),pre=sp?.pre||null;
    let acts=[],hit=0;
    if(an){const n=an.f.length,ws=an.f.map(f=>frW(f[0]));acts=an.f.map((f,i)=>f[2]?i:-1).filter(i=>i>=0);
      if(mv.release!=null||(!mv.a&&e.type==='cinder'))hit=mv.release??0;
      else if((kind==='volley'||kind==='shot')&&acts.length)hit=acts[0];   // a generated body flags its muzzle-flash frames
      else if(kind==='volley'||kind==='shot'){const mn=Math.min(...ws),mx=Math.max(...ws),sf=ws.map((w,i)=>mn<mx&&w===mn?i:-1).filter(i=>i>=0);acts=sf.length?sf:[Math.min(1,n-1)];hit=acts[0];}
      else if(kind==='leap')hit=pre?0:Math.min(1,n-1);
      else if(kind==='rush'||kind==='move')hit=acts.length?acts[0]:0;
      else if(acts.length)hit=acts[0];
      else hit=ws.indexOf(Math.max(...ws));
      hit=clamp(hit,0,n-1);if(!acts.length||kind==='leap'||kind==='rush')acts=[hit];}
    let hitT=0;if(an)for(let i=0;i<hit;i++)hitT+=an.f[i][1];
    const preT=pre?bLen(pre):0,len=animLen(an),pa=bAnim(pre);
    // a crossover (mv.to, Slice's flip 'main:2>11'): the pre anim is the jump itself, so only its crouch frame is the windup
    const preWind=kind==='leap'&&mv.to&&pa?pa.f[0][1]:preT;
    // how far the body reaches ahead on the blow (the art faces left: a frame's ox is its reach toward the target)
    const reach=mv.reach??(an?ROMB().frames[an.f[hit][0]][5]+6:60);
    return {name,mv,kind,key,an,pre,preT,preWind,hit,hitT,acts,len,rev:!!sp?.rev,wind:preWind+(kind==='leap'&&mv.to?0:hitT),reach,rec:an?.atk||null,keys:keys||[]};
  });
}
const bossHitRec=I=>I?.mv?.knock?{stun:10,react:10}:I?.rec?{stun:I.rec.stun,react:I.rec.react}:null;
// The boss's own anim player: e.ba = {key, t (ROM frames), hold, rev}; drawn frame = bFrame(e).
function bPlay(e,key,o=null){if(!key)return;if(e.ba&&e.ba.key===key&&o?.keep&&e.ba.pin==(o?.pin??null))return;e.ba={key,t:o?.t??0,hold:o?.hold!==false,rev:!!o?.rev,pin:o?.pin??null};}
function bFrame(e,s=e.ba){const a=s&&bAnim(s.key);if(!a)return null;const len=animLen(a);const i=s.pin!=null?Math.min(a.f.length-1,s.pin):s.rev?frameIdx(a,Math.max(0,len-1e-3-s.t),true):frameIdx(a,s.t,s.hold);return {a,i,fid:a.f[i][0],key:s.key};}
const bIdleKey=e=>{const b=bodyOf(e);return b?b.main+(BDEF[e.type]?.body==='arosaurus'?':2':':0'):null;};
const bIdle=e=>{bPlay(e,bIdleKey(e),{keep:true,hold:false,pin:BDEF[e.type]?.body==='arosaurus'?0:null});};
const bWalkKey=e=>{const d=defOf(e),sp=bSpec(e,d?.walkA||d?.intro?.walk||'main:1');return sp?sp.alts[0][Math.min(sp.alts[0].length-1,3)]:null;};
// --------------------------------------------------------------- spawning, intros, cards
let crown=null,spillWheels=[],bossCard=null,bossObjs=[],testNoOverlays=false,testHudOnly=false,testNoDamage=false;
function setBossCard(name,sub,t=2.4,pink=false){bossCard={name,sub:sub||'',t,total:t,pink};}
function bossIntroSetup(e,o){
  const D=defOf(e),I=D?.intro||{},t=o.t??I.t??2.4,L=lock||{left:camera,right:camera+W};
  const wk=I.jumpIn?bSpec(e,I.jumpIn)?.alts[0][0]:bWalkKey(e),wa=bAnim(wk);
  // fully off screen: its walk frames' reach ahead of the origin plus ENTRY_PAD (the G4 rule for every arrival)
  const reach=wa?wa.f.reduce((m,f)=>Math.max(m,ROMB().frames[f[0]][5]),0):60,x=Math.max(L.right,camera+W)+Math.max(52,reach+ENTRY_PAD);
  e.x=o.x??x;e.enterX=o.enterX??L.right-(o.settle??126);e.dir=-1;e.state='intro';e.timer=t;e.introT=t;e.inv=t;e.onstage=false;
  e.introSpeed=Math.max(100,Math.abs(e.x-e.enterX)/(t*.6));bPlay(e,wk,{hold:false});
}
function bossIntroTick(e,dt){
  const D=defOf(e),I=D?.intro||{};
  if(Math.abs(e.x-e.enterX)>.5){e.x=approach(e.x,e.enterX,e.introSpeed*dt);e.moving=true;markStage(e);if(I.jumpIn){const p=1-Math.abs(e.x-e.enterX)/Math.max(1,e.introDist||(e.introDist=Math.abs(e.x-e.enterX)+1e-6));e.z=Math.sin(Math.min(1,p)*Math.PI)*34;}
    if(!I.jumpIn)bPlay(e,bWalkKey(e),{hold:false,keep:true});}
  else{e.z=0;e.onstage=true;const sp=bSpec(e,I.pose||I.then||I.roar);if(sp){const k=sp.pre&&e.ba?.key!==sp.alts[0][0]&&!(e.posed)?sp.pre:sp.alts[0][0];if(!e.posed){bPlay(e,k);e.posed=k;if(I.slam){shake=Math.max(shake,12);sfx('slam');burst(e.x+e.dir*40,e.y-4,'#b9b28f',22);if(level.bossTaunt)sayNow(level.bossTaunt);}}else if(e.ba.key===sp.pre&&e.ba.t>=bLen(sp.pre))bPlay(e,sp.alts[0][0]);}else bIdle(e);}
  if(e.timer<=0){e.state='walk';e.timer=.45;e.onstage=true;e.z=0;e.posed=null;bIdle(e);}
}
// --------------------------------------------------------------- choosing the next move (deterministic, ENEMIES §6.1)
function bossPhase(e){const d=defOf(e),f=e.hp/e.maxhp;let ph=d?.phases?.[0]||null,k=0;(d?.phases||[]).forEach((p,i)=>{if(f<=p.at+1e-9){ph=p;k=i;}});if(e.phIdx!==k){e.phIdx=k;e.pi=0;}return ph;}
const liveAdds=()=>enemies.filter(v=>!v.dead&&!v.dying&&!v.boss&&v.state!=='flee'&&!v.setPiece).length;
function bossWhen(e,name){
  const mv=defOf(e)?.moves?.[name];if(!mv)return false;const t=player,d=Math.abs(t.x-e.x),f=e.hp/e.maxhp,L=lock||{left:camera,right:camera+W};
  if(mv.kind==='state'||mv.kind==='script'||(mv.kind==='env'&&(mv.every||mv.at!=null))||(mv.kind==='summon'&&(mv.at!=null||mv.once!=null)))return false;   // arena timers and thresholds, not pattern moves
  if(mv.from!=null&&f>mv.from)return false;
  if(mv.within!=null&&d>mv.within)return false;
  if(mv.proj==='barrel'&&bossObjs.filter(o=>o.rolling&&o.hp>0).length>=(mv.max||2))return false;
  if(mv.ifAliveBelow!=null&&liveAdds()>=mv.ifAliveBelow)return false;
  if(mv.behind&&!(Math.sign(t.x-e.x)===-e.dir&&d<(mv.r||60)+30))return false;
  if(mv.when==='cornered'&&Math.min(e.x-L.left,L.right-e.x)>78)return false;
  if(mv.when&&typeof mv.when==='object'){if(mv.when.dx&&(d<mv.when.dx[0]||d>mv.when.dx[1]))return false;if(mv.when.hpBelow!=null&&f>=mv.when.hpBelow)return false;}
  return true;
}
function bossNext(e){const pat=bossPhase(e)?.pattern||[];for(let i=0;i<pat.length;i++){const n=pat[(e.pi+i)%pat.length];if(bossWhen(e,n)){e.pi+=i;return n;}}return null;}
// where the boss stands for a move: [min, max] distance to its target and whether it lines up its lane
function bossWindow(e,I){const mv=I.mv;switch(I.kind){
  case 'strike':return [0,Math.max(30,I.reach-14)];
  case 'zone':return mv.style?[0,999]:mv.behind?[0,mv.r||60]:[0,Math.max(30,(mv.r||56)-8)];
  case 'pull':return [70,(mv.reach||190)-20];
  case 'lob':return [90,240];
  case 'rush':return mv.within?[0,mv.within]:[70,280];
  case 'leap':return mv.range?[mv.range[0]+6,mv.range[1]-10]:mv.when==='cornered'?[0,999]:[60,200];
  case 'volley':case 'shot':return [100,250];
  case 'jet':return [70,190];
  default:return [0,999];}}
const bossLane=I=>['strike','zone','pull','rush','volley','shot','jet'].includes(I.kind)&&!I.mv.style&&!I.mv.lanes;
// --------------------------------------------------------------- the walk: spacing, facing, then the next move
const BOSS_GAP=.55;   // s of idle after a move's anim (the boss cadence; bossTempo divides it)
function bossThink(e,dt,ox,oy){
  const D=defOf(e),t=player;if(!D)return;
  const sd=Math.sign(t.x-e.x)||e.dir;
  if(D.stationary)e.dir=-1;
  else if(e.type==='raptor'&&e.phase===2){if(sd!==e.dir){e.turnT=(e.turnT||0)+dt;if(e.turnT>.6){e.dir=sd;e.turnT=0;}}else e.turnT=0;}   // a big animal turns late (the tail punishes its back)
  else e.dir=sd;
  if(e.hurt>0&&!D.stationary){if(D.flinch&&!(e.flinchCd>0)&&!(e.flinch>0)){e.flinch=.22;e.flinchCd=2.5;}if(!(e.flinch>0))bIdle(e);return;}
  if(D.near&&!e.next&&!(e.nearCd>0)&&fighters().some(v=>Math.abs(v.x-e.x)<D.near.r&&Math.abs(v.y-e.y)<BOSS_DEPTH)){e.next=D.near.move;e.nearCd=D.near.cd||2.5;}
  const name=e.next||bossNext(e),I=name?bInfo(e,name,e.useN?.[name]||0):null;
  // a stationary boss (Sable at the gate controls) attacks from where it stands: no spacing, no lane
  const win=I&&!D.stationary?bossWindow(e,I):[0,9999],lane=I&&!D.stationary?bossLane(I):false,d=Math.abs(t.x-e.x);
  let moved=false;
  if(!D.stationary){
    const sp=enemySpeed(e)*(e.drowsy>0?.45:1)*(e.tempoMul||1)*(e.walkMul||defOf(e)?.walkMul||1),L=lock||{left:camera,right:camera+W};
    const want=d<win[0]?win[0]+8:d>win[1]?win[1]-8:null;
    if(want!=null&&!e.planted){const tx=clamp(t.x-sd*want,L.left+30,L.right-30);if(Math.abs(tx-e.x)>2){e.x=approach(e.x,tx,sp*dt);moved=true;}}
    if(lane&&Math.abs(e.y-t.y)>3){e.y=approach(e.y,t.y,sp*.6*dt);moved=true;}
    bossTether(e);const r=walkTo(ox,oy,e.x,e.y);e.x=r.x;e.y=r.y;
  }
  e.moving=moved;
  if(moved)bPlay(e,e.drowsy>0&&bSpec(e,'main:2')?bSpec(e,'main:2').alts[0][0]:bWalkKey(e),{keep:true,hold:false});else bIdle(e);
  e.waitT=(e.waitT||0)+dt;
  const inWin=d>=win[0]-6&&d<=win[1]+6&&(!lane||Math.abs(e.y-t.y)<20);
  if(I&&e.timer<=0&&e.onstage&&(inWin||e.waitT>2.4||e.next))startBossMove(e,name,I);
}
const bossTempo=e=>rules().bossTempo*(e.tempoMul||1)*(defOf(e)?.tempo||1);
const MOVE_TOAST={hook:'HOOK!',gaff:'GAFF!',barrel:'BARREL!',crane:'CRANE!',tail:'TAIL SWIPE!',roar:'ROAR!',slag:'ROCK!',surge:'SURGE!',drain:'SONIC BURST · CHANGE LANES',reload:'RELOAD!',roll:'JUMP THE ROLL',drop:'MOVE AWAY FROM THE LANDING',flurry:'BACK AWAY FROM THE HOOK',sweep:'JUMP THE SWEEP',lash:'CHANGE LANES',fan:'CHANGE LANES',flip:'SHE IS GOING OVER YOU',steam:'STEP OUT OF THE STEAM',grenade:'KEEP MOVING',rivets:'CHANGE LANES',stomp:'SIDESTEP THE STOMP',lunge:'SIDESTEP THE LUNGE',turrets:'CHANGE LANES',vents:'JUMP THE STEAM VENT',summon:'REINFORCEMENTS INCOMING',whip:'CHANGE LANES · THE CHAIN',thrust:'CHANGE LANES · THE PROD',swing:'BACK AWAY FROM THE STAFF',whistle:'THE PACK IS COMING',pounce:'MOVE AWAY FROM THE LANDING',slam:'JUMP THE SHOCKWAVE',drive:'CHANGE LANES · THE DRIVER',ring:'CHANGE LANES · THE RING',beam:'DISHES GLOWING · CHANGE LANES',overheat:'THE ENGINE OVERHEATS · HIT IT',quake:'JUMP THE SHOCKWAVE',cannon:'RED GAUGE · CHANGE LANES',vent:'STEAM · STAND CLEAR',jam:'HIS ARM IS STUCK · HIT HIM',screech:'THE PACK ANSWERS HER',charge:'SIDESTEP THE CHARGE',smash:'JUMP THE SHOCKWAVE',roll:'SIDESTEP THE ROLL · HIT HIM AS HE UNCURLS',gatearm:'BACK AWAY FROM THE GATE ARM',jet:'WATER JET · CHANGE LANES',brace:'SURGE · CHANGE LANES',rush:'SIDESTEP THE RUSH',rope:'BACK AWAY FROM THE ROPE',stuck:'HIS HOOK IS STUCK · HIT HIM'};
function startBossMove(e,name,I){
  const mv=I.mv;e.useN=e.useN||{};e.useN[name]=(e.useN[name]||0)+1;
  if(e.next===name)e.next=null;else e.pi++;
  e.mvName=name;e.mvI=I;e.state='windup';e.target=player;e.hitList=[];e.waitT=0;e.rec=null;e.shotN=0;
  const tell=mv.tell??mv.telegraph??(mv.style==='flood'?mv.t:0)??0;
  e.windT=e.timer=Math.max(I.wind/60,.25,tell||0)/bossTempo(e);e.wx=player.x;e.wy=player.y;
  if(MOVE_TOAST[name]){toast=MOVE_TOAST[name];toastTime=1.3;}
  // moves whose danger is placed at the windup: the arena zones (they count down by themselves), the crane's shadow
  if(I.kind==='zone'&&mv.style){const st=mv.style==='slam'?'steam':mv.style;zones.push({owner:e.id,x:player.x,y:player.y,r:mv.r||70,t:e.windT,total:e.windT,friendly:false,damage:bossDmg(mv.dmg??26),air:true,style:st});}
  if(I.kind==='env'&&mv.style==='flood'){for(const off of mv.zones||[-70,0,70])zones.push({owner:e.id,x:player.x+off,y:player.y,r:mv.r||43,t:mv.t||1.25,total:mv.t||1.25,friendly:false,damage:bossDmg(mv.dmg??24),air:mv.air===true,style:'flood'});if(e.type==='sable'&&e.phase===2)e.surgeOpen=mv.t||1.25;}
  if(name==='crane'){e.crane={x:player.x,y:player.y};zones.push({owner:e.id,mark:true,style:'crane',x:player.x,y:player.y,r:mv.r||40,t:e.windT+.45,total:e.windT+.45,friendly:false,damage:0});}
  if(I.kind==='pull'){e.gaff={x0:e.x,y:e.y,len:0,max:mv.reach||190};}
  if(I.kind==='jet')crownJetStart(e,I);
  if(I.kind==='leap'&&name==='flip')e.flipTo=player.x-player.dir*52;
  bPlay(e,I.pre||I.key,{rev:I.rev});
}
// --------------------------------------------------------------- the blow (end of the windup) and its follow-ups
function bossFrontHit(e,I,opts={}){
  const reach=opts.r??I.reach,back=opts.behind,dmg=bossDmg(opts.dmg??I.mv.dmg,e.useN?.[I.name]-1||0);let n=0;
  for(const v of fighters()){if(e.hitList.includes(v)||beyondChain(e,v))continue;const dx=(v.x-e.x)*e.dir;
    if((back?dx<=8&&dx>=-reach:dx>=-12&&dx<=reach)&&Math.abs(v.y-e.y)<(I.mv.depth??BOSS_DEPTH)&&(I.mv.air!==false||v.z<10)){strike(v,dmg,e.x,I.mv.air===true,bossHitRec(I));e.hitList.push(v);n++;}}
  return n;
}
function bossFire(e){
  const I=e.mvI;if(!I){e.state='walk';e.timer=.3;return;}
  const mv=I.mv,L=lock||{left:camera,right:camera+W};e.strikeFlash=.2;
  bPlay(e,I.key,{t:I.hitT,rev:I.rev});
  const rest=Math.max(0,I.len-I.hitT),recover=(extra=0)=>{e.state='recover';e.timer=(rest/60+extra+BOSS_GAP)/bossTempo(e);};
  const evAt=frames=>frames.filter(f=>f>I.hit).map(f=>({f}));
  switch(I.kind){
    case 'strike':{bossFrontHit(e,I);const hits=mv.hits||1;e.rec={ev:evAt(I.acts).slice(0,hits-1),hit:'front'};recover();return;}
    case 'zone':{if(mv.style){recover();return;}
      if(mv.cloud){zones.push({owner:e.id,x:e.x,y:e.y,r:mv.r||70,t:mv.t||1.6,total:mv.t||1.6,linger:true,tick:0,friendly:false,damage:bossDmg(mv.dmg??9),air:false,style:'steam'});sfx('special');recover();return;}
      if(mv.shock){const sx=e.x+e.dir*30;if(mv.ringFx!=null){const fb=ROMB()?.bodies?.[defOf(e)?.fx];if(fb)effects.push({type:'gfx',key:fb.main+':'+mv.ringFx,map:fb.pal?.[fb.use]||fb.pal?.home,x:sx,y:e.y,z:0,dir:e.dir,age:0,life:.4});}zones.push({owner:e.id,x:sx,y:e.y,r:mv.r||84,t:.06,total:.06,friendly:false,damage:bossDmg(mv.dmg??24),air:true,knock:!!mv.knock,style:'land'});burst(sx,e.y-4,'#b9b28f',18);burst(sx+e.dir*24,e.y-2,'#8a7a5a',10);shake=Math.max(shake,9);sfx('slam');recover();return;}
      // a zone with authored blows per active frame (Crownback's tail: behind him, then round the front)
      if(mv.hits){e.hitList=[];bossFrontHit(e,I,mv.hits[0]);e.rec={ev:evAt(I.acts).slice(0,mv.hits.length-1).map((x,k)=>Object.assign(x,{k:k+1})),hit:'hits'};recover();return;}
      const n=mv.ticks||I.acts.length,step=Math.max(1,Math.round(I.acts.length/n)),ev=I.acts.filter((f,i)=>i%step===0).slice(0,n);
      e.hitList=[];bossFrontHit(e,I,{r:mv.r,behind:mv.behind});e.rec={ev:evAt(ev),hit:mv.behind?'behind':'zone'};recover();return;}
    case 'pull':{const v=player,dx=(v.x-e.x)*e.dir;e.gaff={x0:e.x,y:e.y,len:mv.reach||190,max:mv.reach||190,t:.35};
      const caught=dx>0&&dx<=(mv.reach||190)&&Math.abs(v.y-e.y)<=(mv.lane||20)&&v.inv<=0&&v.z<22;if(!caught&&mv.miss)e.next=mv.miss;
      if(caught){strike(v,bossDmg(mv.dmg),e.x,false,mv.knock?{stun:10,react:10}:{stun:0,react:0});
        // pulled to 52 px in front, held 0.3 s, then 0.4 s invulnerable (CAMPAIGN §5.4), then the hook
        const r=walkTo(v.x,v.y,e.x+e.dir*(mv.pullTo||52),v.y,{cam:{x:camera,y:cameraY},lock});v.x=r.x;player.hurt=player.hurtTotal=Math.max(player.hurt,.3);player.inv=Math.max(player.inv,.7);e.gaff.len=Math.abs(v.x-e.x);if(mv.then)e.next=mv.then;}
      recover();e.timer=Math.min(e.timer,.35);return;}
    case 'lob':{bossLob(e,I);if(mv.then&&(mv.thenBelow==null||e.hp/e.maxhp<mv.thenBelow))e.next=mv.then;recover(mv.then?-.2:0);return;}
    case 'rush':{const vx=Math.abs(EK?.bossVx?EK.bossVx(mv)*60:mv.vx||260)||260;e.state='charge';e.spin0=e.x;e.vx=e.dir*vx;e.chargeLeft=mv.len||Math.min(320,Math.abs(player.x-e.x)+90);e.timer=Math.min(1.4,e.chargeLeft/vx+.05);e.hitList=[];bPlay(e,I.key,{t:I.hitT,hold:false});return;}
    case 'move':{const back=mv.back?mv.back[1]:80,tx=clamp(e.x-e.dir*back,L.left+30,L.right-30);e.state='charge';e.vx=(tx-e.x)/.5;e.chargeLeft=Math.abs(tx-e.x);e.timer=.5;e.hitList=null;bPlay(e,I.key,{rev:true});return;}
    case 'leap':{bossLeapStart(e,I);return;}
    case 'volley':case 'shot':{bossShoot(e,I,0);e.shotN=1;e.rec={ev:I.an&&I.kind==='volley'&&!mv.proj?evAt(I.acts).slice(0,(mv.n||I.acts.length)-1):[],hit:'shot'};recover();return;}
    case 'summon':{bossSummon(e,mv);recover(.4);return;}
    case 'window':case 'taunt':case 'tell':{if(mv.hurt){e.vulnT=mv.t||.5;e.vulnMul=mv.hurt;}if(mv.line&&!e.said?.[mv.line]){(e.said=e.said||{})[mv.line]=true;say(level.bossLines?.[mv.line]);}
      e.state='recover';e.timer=Math.max((mv.t||0),I.len/60)/bossTempo(e)+(I.kind==='tell'?0:BOSS_GAP*.5);bPlay(e,I.key,{t:I.hitT});return;}
    case 'env':{if(e.mvName==='crane'&&e.crane)bossCrane(e);recover(.3);return;}
    case 'jet':{crownJetFire(e,I);recover();return;}
  }
  recover();
}
// recover: the rest of the move's anim with its later blows (a second bite, the flurry's spins, the pistol's shots), then
// idle until the cadence has passed
function bossRecover(e,dt){
  const r=e.rec,I=e.mvI;
  if(r&&I&&r.ev.length&&e.ba&&e.ba.key===I.key){const fi=bFrame(e)?.i??0;while(r.ev.length&&fi>=r.ev[0].f){const ev=r.ev.shift();e.hitList=[];
    if(r.hit==='shot')bossShoot(e,I,e.shotN++);else if(r.hit==='hits')bossFrontHit(e,I,I.mv.hits[ev.k]||{});else bossFrontHit(e,I,r.hit==='zone'?{r:I.mv.r}:r.hit==='behind'?{r:I.mv.r,behind:true}:{});}}
  if(e.gaff){e.gaff.t=(e.gaff.t||.3)-dt;if(e.gaff.t<=0)e.gaff=null;}
  if(e.ba&&bAnim(e.ba.key)&&e.ba.t>=bLen(e.ba.key)&&(!r||!r.ev.length))bIdle(e);
  if(e.timer<=0){e.state='walk';e.timer=0;e.rec=null;}
}
function bossCharge(e,dt){
  const I=e.mvI,L=lock||{left:camera,right:camera+W},step=e.vx*dt;e.x+=step;e.chargeLeft-=Math.abs(step);e.moving=true;
  if(e.hitList&&I)for(const v of fighters()){if(e.hitList.includes(v)||beyondChain(e,v))continue;if(Math.abs(v.x-e.x)<40&&Math.abs(v.y-e.y)<BOSS_DEPTH&&(I.mv.air!==false||v.z<10)){strike(v,bossDmg(I.mv.dmg,(e.useN?.[I.name]||1)-1),e.x-e.dir*44,I.mv.air===true,bossHitRec(I));e.hitList.push(v);}}
  const nx=clamp(e.x,L.left+22,L.right-31),wall=nx!==e.x;e.x=nx;
  if(e.chargeLeft<=0||e.timer<=0||wall){e.state='recover';e.timer=(BOSS_GAP+.35)/bossTempo(e);e.rec=null;bIdle(e);
    const A=I?.mv?.after,ak=A&&bSpec(e,A.a)?.alts[0][0];if(ak){bPlay(e,ak,{hold:true});e.timer=Math.max(e.timer,A.t||.9);if(A.hurt){e.vulnT=A.t||.9;e.vulnMul=A.hurt;}}}
}
function bossLeapStart(e,I){
  const mv=I.mv,L=lock||{left:camera,right:camera+W},v=player;let tx=v.x,ty=v.y,h=60,T=.6;
  if(mv.to){tx=e.flipTo??(v.x-v.dir*52);h=52;T=Math.max(.4,(I.preT-(I.preWind||0))/60);}
  else if(mv.range){const d=clamp(Math.abs(v.x-e.x),mv.range[0],mv.range[1]);tx=e.x+e.dir*d;h=26;T=.5;}
  else if(mv.when==='cornered'){const away=e.x-L.left<L.right-e.x?1:-1;tx=e.x+away*150;ty=e.y;h=40;T=.6;e.dir=away;}
  e.state='leap';e.leapT=e.timer=T;e.leapH=h;e.startX=e.x;e.startY=e.y;e.targetX=clamp(tx,L.left+24,L.right-24);const b=bandOf(e.targetX);e.targetY=clamp(ty,b.top,b.bottom);e.hitList=[];
  if(mv.shadow)zones.push({owner:e.id,mark:true,style:'pounce',x:e.targetX,y:e.targetY,r:mv.r||50,t:T,total:T,friendly:false,damage:0});
  const sp=bSpec(e,mv.a);if(mv.to&&sp&&sp.pre)bPlay(e,sp.pre,{t:I.preWind||0});else bPlay(e,sp&&sp.pre?sp.alts[0][0]:I.key,{t:sp&&sp.pre?0:I.hitT});
}
function bossLeap(e,dt){
  const I=e.mvI,p=clamp(1-e.timer/e.leapT,0,1);e.x=e.startX+(e.targetX-e.startX)*p;e.y=e.startY+(e.targetY-e.startY)*p;e.z=Math.sin(p*Math.PI)*e.leapH;
  if(I&&I.mv.r==null&&e.mvName!=='flip')for(const v of fighters()){if(e.hitList.includes(v)||beyondChain(e,v))continue;if(Math.abs(e.x-v.x)<34&&Math.abs(e.y-v.y)<BOSS_DEPTH&&v.z<40){strike(v,bossDmg(I.mv.dmg),e.x-e.dir*20,false,bossHitRec(I));e.hitList.push(v);}}
  if(e.timer>0)return;
  e.z=0;
  if(I&&I.mv.r)zones.push({owner:e.id,x:e.x,y:e.y,r:I.mv.r,t:.12,total:.12,friendly:false,damage:bossDmg(I.mv.dmg),air:true,style:'land'});
  // the flip lands behind the hero and lashes (main 11, its long frame) at once
  if(e.mvName==='flip'&&I){const sp=bSpec(e,I.mv.a),k2=sp?.alts[0][0],raw={a:null,kind:'strike',reach:111,dmg:I.mv.dmg};e.dir=Math.sign(player.x-e.x)||e.dir;
    const an=bAnim(k2);if(an){const ws=an.f.map(f=>frW(f[0])),hit=ws.indexOf(Math.max(...ws));let hitT=0;for(let i=0;i<hit;i++)hitT+=an.f[i][1];
      e.mvI={name:'flip',mv:raw,kind:'strike',key:k2,an,pre:null,preT:0,hit,hitT,acts:[hit],len:animLen(an),rev:false,wind:hitT,reach:111,rec:null,keys:[k2]};e.state='windup';e.windT=e.timer=Math.max(hitT/60*.5,.25)/bossTempo(e);e.hitList=[];bPlay(e,k2);return;}}
  e.state='recover';e.timer=(BOSS_GAP+.4)/bossTempo(e);e.rec=null;bIdle(e);
}
// --------------------------------------------------------------- projectiles: barrels, slag, grenades, knives, rounds
const BOSS_ROUND={key:'0x6FB1A:0'};   // the poacher's round object (ROM_ENEMIES): the pistol bullet 0xEC is not extracted
function bossLob(e,I){
  const mv=I.mv,v=player,L=lock||{left:camera,right:camera+W},B=ROMB();
  // the barrel is a breakable object (objects: any hit breaks it, 1 HP) that rolls along his lane (bossObjs)
  if(mv.proj==='barrel'){const o={type:'barrel',boss:true,rolling:true,hideT:mv.hide||0,x:e.x+e.dir*(mv.dx||30),y:e.y,z:0,hp:1,vx:e.dir*(mv.vx||190),dmg:bossDmg(mv.dmg),knock:!!mv.knock,roll:0,content:null,owner:e.id};bossObjs.push(o);objects.push(o);sfx('swing');return;}
  const tf=bodyOf(e)?.throwFrame,sp=tf?.spawn||{dx:16,h:48},x0=e.x-e.dir*sp.dx,x1=clamp(v.x,L.left+16,L.right-16);
  if(mv.proj==='rock:3'||e.mvName==='slag'){bullets.push({kind:'bomb',slag:true,x:x0,y:e.y,z:sp.h,x0,y0:e.y,z0:sp.h,x1,y1:v.y,h:40,t:0,T:mv.arc||.8,friendly:false,damage:bossDmg(mv.dmg),r:24,burn:mv.burn||null,owner:e.id,life:3,age:0,dir:e.dir,art:{fam:'bosses',key:'0x71408:8',map:'S5A1'}});sfx('swing');return;}
  bullets.push({kind:'bomb',x:x0,y:e.y,z:sp.h,x0,y0:e.y,z0:sp.h,x1,y1:v.y,h:44,t:0,T:.8,friendly:false,damage:bossDmg(mv.dmg),r:mv.r||56,owner:e.id,life:3,age:0,dir:e.dir,art:{fam:'bosses',key:'0x71408:0',map:B?.bodies?.['boss-projectiles']?.pal?.home||'S5A1'}});sfx('swing');
}
function bossShoot(e,I,k){
  const mv=I.mv,dir=e.dir,lanes=mv.lanes||[0];
  if(e.type==='sable'&&e.phase===2){   // the gate controls' turrets: fireballs from both blue tank columns
    const c=crown||{x:e.x,y:e.y};for(const [j,off] of [[0,-24],[1,0],[2,24]].map(([j,o])=>[j,o]))bullets.push({x:c.x+(j===1?-100:-96),y:c.y+off,z:60,vx:-220,vy:0,friendly:false,damage:bossDmg(mv.dmg??18),owner:e.id,life:2.2,age:0,dir:-1,art:{fam:'bosses',key:'0x71408:12',map:'S5A1'}});sfx('enemygun');return;}
  if(mv.cannon){const m=mv.muzzle||{dx:60,dz:70},x=e.x+dir*m.dx,fx=defOf(e)?.fx,fb=fx&&ROMB()?.bodies?.[fx];
    const pb=mv.projBody&&ROMB()?.bodies?.[mv.projBody],art=pb?{fam:'bosses',key:pb.main+':0',map:pb.pal?.[pb.use]||pb.pal?.home}:{fam:'bosses',key:'0x71408:12',map:'S5A1'};
    bullets.push({x,y:e.y,z:m.dz,zHi:m.dz+10,vx:dir*(mv.vx||300),vy:0,friendly:false,damage:bossDmg(mv.dmg),owner:e.id,life:1.6,age:0,dir,hit:bossHitRec(I),art});
    if(fb&&!mv.projBody)effects.push({type:'gfx',key:fb.main+':0',map:fb.pal?.[fb.use]||fb.pal?.home,x,y:e.y,z:m.dz,dir,age:0,life:16/60});sfx('explosion');shake=Math.max(shake,4);return;}
  if(mv.proj&&/knife/.test(mv.proj)){for(const off of lanes)bullets.push({x:e.x+dir*20,y:e.y+off,z:44,vx:dir*250,vy:0,friendly:false,damage:bossDmg(mv.dmg),owner:e.id,life:1.6,age:0,dir,art:{fam:'bosses',key:'0x71408:7',map:'S5A1'}});sfx('swing');return;}
  // a generated body (Sable's) fires from its muzzle-flash frame: the round leaves the gun tip (the frame's reach) at the
  // def's muzzle height, and the frame draws its own flash
  const D=defOf(e),fr=D?.muzzle?ROMB()?.frames?.[bFrame(e)?.fid]:null,mz=D?.muzzle||70;
  const off=I.kind==='shot'?0:lanes[k%lanes.length],m=ROME()?.palMap,map=m?m[`${EK?.typeOf?.('gunner','A')}:A`]:null,x=e.x+dir*(fr?fr[5]-2:43);
  bullets.push({x,y:e.y+off,z:mz,zHi:Math.max(78,mz+8),vx:dir*(I.kind==='shot'?360:252),vy:0,friendly:false,damage:bossDmg(mv.dmg),owner:e.id,life:1.6,age:0,dir,hit:bossHitRec(I),art:{key:BOSS_ROUND.key,map}});
  if(!D?.muzzle)effects.push({type:'erom',key:'0x57E0E:1',map,x,y:e.y,z:70,dir,age:0,life:16/60});sfx('enemygun');
}
function bossSummon(e,mv){
  const n=mv.n||2,type=mv.type||'raider';
  for(let j=0;j<n;j++){const a=arrive(type,mv.from==='R'?'R':j%2?'L':'R',j);if(mv.hp){a.hp=a.maxhp=mv.hp*rules().enemyHealth;}}
  toast='REINFORCEMENTS INCOMING';toastTime=2;
}
// The crane (Rook, from 40 %): 0.9 s of shadow at the hero, then a crate drops from above the screen (r 52); it stays as a
// breakable crate (food in every third, CAMPAIGN §5.4).
function bossCrane(e){const c=e.crane;e.crane=null;e.cranes=(e.cranes||0)+1;const z=c.y-cameraY+40;
  bossObjs.push({type:'crate',boss:true,falling:true,x:c.x,y:c.y,z,vz:-120,hp:28,dmg:bossDmg(BDEF.warden?.moves?.crane?.dmg??28),r:BDEF.warden?.moves?.crane?.r||52,content:e.cranes%3===0?'food':null,owner:e.id});sfx('swing');}
function updateBossObjects(dt){
  const L=lock||{left:camera,right:camera+W};
  for(const o of bossObjs){if(o.hp<=0)continue;
    if(o.falling){o.vz-=900*dt;o.z+=o.vz*dt;if(o.z<=0){o.z=0;o.falling=false;shake=Math.max(shake,8);burst(o.x,o.y,'#b9b28f',14);sfx('slam');
        for(const v of fighters())if(Math.hypot((v.x-o.x)*.8,v.y-o.y)<o.r&&v.z<30)strike(v,o.dmg,o.x,false,{stun:10,react:10});
        objects.push(o);}continue;}
    if(o.rolling){if(o.hideT>0){o.hideT-=dt;continue;}o.x+=o.vx*dt;o.roll+=Math.abs(o.vx*dt);
      for(const v of fighters())if(Math.abs(v.x-o.x)<14&&Math.abs(v.y-o.y)<11&&v.z<12&&v.inv<=0){strike(v,o.dmg,o.x-Math.sign(o.vx)*20,false,o.knock?{stun:10,react:10}:null);o.hp=0;burst(o.x,o.y-12,'#c3925d',10);break;}
      if(o.x<L.left-40||o.x>L.right+40)o.hp=0;}}
  if(objects.some(o=>o.boss&&o.hp<=0&&o.rolling))objects=objects.filter(o=>!(o.boss&&o.rolling&&o.hp<=0));
  bossObjs=bossObjs.filter(o=>o.hp>0&&!(!o.falling&&!o.rolling));
}
const FXF=()=>window.ROM_FX||window.SPRITE_DATA?.families?.fx||null;
// the rolling barrel is TARU's rolling anim (fx containers.barrel anim 2), the crane's crate the sequel crate prop (DRAMCAN)
// the rolling barrel of a generated Rook body (BOSS_DEFS.warden.keg: his keg frame), else the ROM TARU
function bossKeg(){const D=BDEF.warden,b=D&&ROMB()?.bodies?.[D.body],a=b&&D.keg&&bAnim(b.main+':'+String(D.keg).split(':')[1]);return a?{fid:a.f[0][0],map:b.pal?.[b.use]||b.pal?.home}:null;}
function drawBossObject(o){const x=o.x-viewX;if(x<-60||x>W+60)return;const C=FXF()?.containers;
  if(o.type==='barrel'){const K=bossKeg();if(K){if(o.hideT>0)return;const fr=ROMB().frames[K.fid],q=Math.floor((o.roll||0)/14)%4,d=Math.sign(o.vx)||1;ctx.save();ctx.translate(Math.round(x),Math.round(o.y-(o.z||0)-fr[4]/2));ctx.rotate(-d*q*Math.PI/2);drawBossFrame(K.fid,0,Math.round(fr[4]/2),1,K.map);ctx.restore();return;}
    const seq=C?.barrel?.anims?.[2],rec=seq?seq[Math.floor(o.roll/6)%seq.length][0]:C?.barrel?.rec;if(rec!=null&&fxDraw(rec,x,o.y,0,Math.sign(o.vx)||1))return;}
  else{const rec=FXF()?.props?.crate?.rec??C?.drum?.rec;if(rec!=null&&fxDraw(rec,x,o.y,o.z,1))return;}
  legacy(ctx,x,o.y-o.z,()=>{rect(ctx,-14,-30,28,30,'#9b7b4c');});
}
// --------------------------------------------------------------- arena: thresholds, timers, tether, drowsiness
// bossCall(e, k): the reinforcements at 66 % (k 0) and 33 % (k 1). BOSS_GUARDS stay the default (Krag / Ironclub too); a car-fought truck bellows for
// two bikers from behind, Glassback roars for two R HOPPERs at 66 %, Echo's 33 % call is her graft subjects, Crownback's
// 66 % is the first plate breaking off (no call) and its 33 % the guards of the collapse phase.
function bossCall(e,k){
  const D=defOf(e);e.calls=k+1;
  if(e.type==='fessenden'){if(k===1){bossSummon(e,BDEF.fessenden?.phases?.[2]?.summon||{type:'raider',n:2});}return;}
  if(e.type==='truck'&&!BDEF.truck?.onFoot){bPlay(e,bSpec(e,'main:1')?.alts[0][0]);for(let j=0;j<2;j++)arrive('biker','L',j);toast='BELLOW · RIDERS FROM BEHIND';toastTime=2.5;return;}
  if(e.type==='raptor'&&k===0){e.roarT=.5;const ck=bSpec(e,defOf(e)?.callA||'main:10')?.alts[0][0];if(ck&&['walk','recover'].includes(e.state))bPlay(e,ck);sfx('special');voice('roar');arrive('raptor','R',0);arrive('raptor','L',1);toast='THE PACK ANSWERS!';toastTime=2;return;}
  if(e.type==='echo'&&k===1){const u=D.moves?.grafts;if(u){say(level.bossLines?.p33);bossSummon(e,u);return;}}
  bossReinforce(e);e.calls=k+1;   // bossReinforce counts its own call
}
function bossThresholds(e,before){
  const f=e.hp/e.maxhp,b=before/e.maxhp,D=defOf(e),lines=e.type==='fessenden'?level.lastCopy?.lines:e.phase===2&&level.phase2?level.phase2?.lines:level.bossLines;e.said=e.said||{};
  for(const [k,line] of Object.entries(lines||{})){const m=/^p(\d+)$/.exec(k);if(m&&f<+m[1]/100&&!e.said[k]){e.said[k]=true;say(line);}}
  for(const [k,at] of [[0,.66],[1,.33]])if(e.hp>0&&(e.calls||0)===k&&f<at){bossCall(e,k);break;}   // one call per blow, as before
  // scripted thresholds: Rook gets desperate (25 %), Echo's sonic burst (66 %)
  for(const [n,mv] of Object.entries(D?.moves||{})){if(e.said['@'+n])continue;
    if(mv.kind==='script'&&f<mv.at){e.said['@'+n]=true;Object.assign(e,{state:'script',timer:mv.inv||1.2,inv:Math.max(e.inv,mv.inv||1.2),tempoNext:mv.tempo||1,rec:null,gaff:null,next:null});bPlay(e,bSpec(e,mv.a||'main:18')?.alts[0][0]);if(mv.line)say(level.bossLines?.[mv.line]);toast=mv.toast||'ROOK GETS DESPERATE';toastTime=1.6;if(mv.shake){shake=Math.max(shake,mv.shake);sfx('special');}}
    if(mv.kind==='env'&&mv.at!=null&&f<mv.at&&mv.style==='flood'){e.said['@'+n]=true;for(const off of mv.zones||[-70,0,70])zones.push({owner:e.id,x:player.x+off,y:player.y,r:mv.r||43,t:mv.t||1.25,total:mv.t||1.25,friendly:false,damage:bossDmg(mv.dmg??24),air:mv.air===true,style:'flood'});toast=MOVE_TOAST[n]||'CHANGE LANES';toastTime=1.6;}}
}
// timers of the arena (CAMPAIGN §5.4 tide from 60 % every 10 s; §8.4 Cinder's pump surge from 50 % every 8 s), the vulnerable
// windows, Rook's tempo once he is desperate, Glassback's calming and her leash to the nest
function bossArena(e,dt){
  const D=defOf(e);if(!D||e.state==='intro'||e.state==='transform'||e.state==='mutate')return;
  e.vulnT=Math.max(0,(e.vulnT||0)-dt);e.drowsy=Math.max(0,(e.drowsy||0)-dt);
  if(e.surgeOpen>0&&(e.surgeOpen-=dt)<=0){const H=BDEF.sable?.phase2?.hurtAfterSurge||{};e.vulnT=H.t||3;e.vulnMul=H.mult||1.5;}   // the controls are open while the water drops
  const f=e.hp/e.maxhp;
  for(const [n,mv] of Object.entries(D.moves||{})){if(mv.kind!=='env'||!mv.every||f>(mv.from??1))continue;
    const k='T'+n;e[k]=(e[k]??Math.min(3,mv.every))-dt;if(e[k]>0)continue;e[k]=mv.every;
    if(mv.band){const b=bandOf(lock?(lock.left+lock.right)/2:e.x),y0=b.bottom-((mv.band[1]-mv.band[0])||32);zones.push({owner:e.id,x:lock?(lock.left+lock.right)/2:e.x,y:(y0+b.bottom)/2,band:[y0,b.bottom],r:W,t:mv.tell||1,total:mv.tell||1,friendly:false,damage:bossDmg(mv.dmg),air:mv.air===true,knock:!!mv.knock,style:'tide'});toast='THE TIDE · GET OFF THE FRONT';toastTime=1.6;}
    else{for(const off of mv.zones||[-70,70])zones.push({owner:e.id,x:player.x+off,y:player.y,r:mv.r||43,t:mv.t||1.25,total:mv.t||1.25,friendly:false,damage:bossDmg(mv.dmg),air:mv.air===true,style:'flood'});
      if(mv.a&&['walk','recover'].includes(e.state)){e.state='recover';e.timer=Math.max(e.timer,.6);e.rec=null;bPlay(e,bSpec(e,mv.a)?.alts[0][0]);}toast=MOVE_TOAST[n]||'CHANGE LANES';toastTime=1.6;}}
}
function bossDriver(){const t=mission?.active;return levelIndex===2&&t&&t.bossTask&&t.kind==='beacon'&&!t.done?t:null;}
function bossTether(e){const D=BDEF[e.type],dr=D?.tether&&bossDriver();if(!dr)return;const lo=dr.x-D.tether,hi=dr.x+D.tether;if(e.x<lo||e.x>hi){e.x=clamp(e.x,lo,hi);if(!e.said?.leash&&e.state==='walk'){(e.said=e.said||{}).leash=true;say(level.bossLines?.leash);}}}
// beyond her leash is a safe rest (CAMPAIGN §7.4): Glassback will not leave her nest, so her blows never reach a fighter
// standing more than her tether from the driver beside it
function beyondChain(e,v){const D=BDEF[e.type],dr=D?.tether&&e.type==='raptor'&&bossDriver();return !!dr&&Math.abs(v.x-dr.x)>D.tether;}
// the nest driver's thirds (ch3): each third of its HP lost calms Glassback for 3 s, taking x1.5 (CAMPAIGN §7.4)
function driverHit(t){if(levelIndex!==2||!t.bossTask)return;const third=Math.floor((t.maxhp-t.hp)/(t.maxhp/3));if(third>(t.thirds||0)&&t.hp>0){t.thirds=third;const r=enemies.find(e=>e.boss&&e.type==='raptor'&&!e.dead&&e.state!=='mutate');const mv=r&&defOf(r)?.moves?.drowsy;
  if(r&&mv){r.drowsy=mv.t||3;r.vulnT=mv.t||3;r.vulnMul=mv.hurt||1.5;if(['walk','recover'].includes(r.state)){const k=bSpec(r,defOf(r)?.flinch||'main:15')?.alts[0][0];if(k)bPlay(r,k);}say(level.bossLines?.driverHit);toast='THE DRIVER SPARKS · SHE STAGGERS';toastTime=1.6;}}}
// --------------------------------------------------------------- knockdowns, defeats, Sable's phases
function bossKnock(e,kdir){
  const b=bodyOf(e);if(CFG.bossKnockdown===false||!b?.hit||['truck','fessenden','raptor'].includes(e.type)||(e.type==='sable'&&e.phase===2))return false;
  // damageEnemy has already set this hit's e.inv (.055) and refuses a blow while an older one runs (the rise's), so the
  // guard here is the state, the 4-s spacing and the armour of an active frame on show (ENEMIES §6.1)
  const f=bFrame(e);if(!['walk','recover','windup'].includes(e.state)||(f&&f.a.f[f.i][2])||stageTimer-(e.kdAt??-99)<4)return false;
  const key=b.hit+':2',len=bLen(key)||48;e.kdAt=stageTimer;Object.assign(e,{state:'down',timer:len/60,vx:kdir*90,mvI:null,rec:null,next:null,gaff:null,crane:null,z:0});bPlay(e,key);sfx('slam');voice('bossHurt');shake=Math.max(shake,6);return true;
}
function bossDownTick(e,dt){const L=lock||{left:camera,right:camera+W};e.x=clamp(e.x+e.vx*dt,L.left+21,L.right-31);e.vx=approach(e.vx,0,240*dt);
  if(e.state==='down'&&e.timer<=0){const k=bodyOf(e)?.hit+':4';e.state='rise';e.timer=Math.max(.2,bLen(k)/60);e.inv=Math.max(e.inv,e.timer);bPlay(e,k);}
  else if(e.state==='rise'&&e.timer<=0){e.state='walk';e.timer=.3;bIdle(e);}}
// hp <= 0: true when the boss lives on (a phase change: Sable to the controls, Krag's trial dose; Glassback's floor), else the defeat script runs
function bossDown(e,kdir){
  const L=lock||{left:camera,right:camera+W};
  if(e.type==='sable'&&e.phase===1){clearEnemyHazards(e.id);Object.assign(e,{z:0,phase:2,calls:0,state:'transform',timer:2.7,inv:2.7,attackNo:0,pi:0,phIdx:-1,useN:{},said:{},mvI:null,rec:null,next:null,tempoMul:1});e.hp=e.maxhp=bossHpOf('sable',2)*rules().enemyHealth*bossScale();
    flash=.65;shake=12;voice('bossTaunt');toast=level.phase2?.toast||'SABLE TAKES THE GATE CONTROLS';toastTime=4;effects.push({x:e.x,y:e.y,age:0,life:.8,type:'explosion'});say(level.phase2?.say);e.name=BDEF.sable?.phase2?.name||'SABLE · GATE CONTROLS';bPlay(e,bWalkKey(e),{hold:false});return true;}
  const D0=BDEF[e.type];
  if(D0?.phase2?.body&&D0.transform&&e.phase!==2){const T=D0.transform,t=T.t||2.4,P=D0.phase2,kb=ROMB()?.bodies?.[D0.body],ib=ROMB()?.bodies?.[P.body];clearEnemyHazards(e.id);
    Object.assign(e,{z:0,vx:0,phase:2,calls:0,state:'mutate',timer:t,inv:t,attackNo:0,pi:0,phIdx:-1,useN:{},said:{},mvI:null,rec:null,next:null,tempoMul:1,flinch:0});e.hp=e.maxhp=bossHpOf(e.type,2)*rules().enemyHealth*bossScale();e.name=P.name||e.name;
    const [fa,ta]=T.anims||[5,9];bPlay(e,kb&&ib?comboAnim(P.body+':serum',kb.main+':'+fa,ib.main+':'+ta):null,{hold:true});
    flash=.5;shake=10;toast=level.phase2?.toast||(e.name+'!');toastTime=3.5;say(level.phase2?.say);setBossCard(e.name,level.phase2?.card||'',t,true);sfx('special');voice('bossTransform');return true;}
  // while the driver hums Glassback cannot be beaten (phase2.driver.hpFloor)
  if(e.type==='raptor'&&defOf(e)?.driver?.hpFloor&&bossDriver()){e.hp=1;e.state='recover';e.timer=1.4;e.inv=1.4;e.rec=null;toast='THE DRIVER KEEPS HER STANDING · SMASH IT';toastTime=2;return true;}
  if(e.type==='truck'&&!BDEF.truck?.onFoot){clearEnemyHazards(e.id);Object.assign(e,{hp:1,state:'flee',timer:2.4,inv:9,dir:1,z:0,collar:false});score+=2000;kills++;say(level.bossDefeat);voice('bossHurt');sparkBurst(e.x+e.dir*60,e.y-48,18);toast='THE HARNESS BREAKS';toastTime=2.5;
    effects.push({type:'chain',x:e.x-30,y:e.y,age:0,life:2,vx:-(roadRate||CAR.road)});bPlay(e,bodyOf(e)?.main+':0');return true;}
  clearEnemyHazards(e.id);e.z=0;e.state='dead';e.mvI=null;e.rec=null;e.gaff=null;score+=2000;kills++;
  // defeats (STORY.md): Rook is knocked down and arrested, Cinder cowers and surrenders, Echo kneels and is arrested, the
  // gate controls are smashed ('engine', the engine's name), Crownback falls in the spillway ('lot00', the engine's name)
  const D=defOf(e),kind=e.type==='sable'?'engine':e.type==='fessenden'?'lot00':D?.defeat?.arrest&&bSpec(e,D.defeat.anim)?'arrest':e.type==='cinder'?'surrender':e.type==='echo'?'kneel':'knock';
  if(kind!=='engine')voice(kind==='lot00'?'roar':'bossDeath');
  e.defeat={kind,t:0,said:false};e.dead=kind==='surrender'?(D.defeat?.t||2.6)+.3:kind==='kneel'?2.4:kind==='lot00'?(BDEF.fessenden?.defeat?.crossfade||1.5)+.4:kind==='engine'?.5:kind==='arrest'?6:1.9;
  if(kind==='engine'){say(level.phase2?.defeat);if(crown){crown.occupied=false;crown.stalled=true;}mission.total=4;createObjective('gate','FINAL SPILLWAY RELEASE',L.right-125,laneY(.64,L.right-125),0,true);say(level.gateSay);}
  else if(kind==='lot00'){sayNow(level.lastCopy?.lines?.defeat);
    // he rears up, staggers, falls over and lies in the spillway (main 9, held on its last frame)
    e.jetT=0;e.flinch=0;bPlay(e,crownKey(9),{hold:true});lastLot00={x:e.x,y:e.y,dir:e.dir};}
  else if(kind==='knock'){const k=bodyOf(e)?.hit;bPlay(e,k?k+':2':bIdleKey(e));sayNow(level.bossDefeat);}
  else if(kind==='surrender')bPlay(e,bodyOf(e)?.main+':8');
  else if(kind==='arrest')bPlay(e,bSpec(e,D.defeat.anim).alts[0][0],{hold:true});
  else if(kind==='kneel')bPlay(e,bodyOf(e)?.hit+':5',{hold:false});
  return false;
}
// the defeat scripts (the chapter clear waits for d.done, the last line; after it they keep stepping behind the clear
// panel, drawing only, and no Math.random call): Rook falls and stays down (arrested; the body blinks out late);
// Cinder cowers (main 8 frames 0-4 only: no MORGUE frame) and surrenders with bossDefeat at 1.65 s; Echo's dizzy -> kneel,
// then bossDefeat (arrested); Crownback falls over (body main 10) and Sable's last words go on the radio
function bossDeadTick(e,dt){
  const d=e.defeat;if(!d)return;d.t+=dt;if(e.ba)e.ba.t+=dt*60;
  if(d.kind==='knock'&&d.t>=1.0)d.done=true;
  if(d.kind==='arrest'){if(d.t>=1.3&&!d.said){d.said=true;sayNow(level.bossDefeat);}if(d.said&&d.t>=1.6)d.done=true;}
  if(d.kind==='surrender'){if(e.ba&&e.ba.t>=50)e.ba.t=49.9;if(d.t>=1.65&&!d.said){d.said=true;sayNow(level.bossDefeat);}if(d.said)d.done=true;}
  if(d.kind==='kneel'){if(d.t>=.8&&!d.k){d.k=1;bPlay(e,bodyOf(e)?.hit+':4');}if(e.ba&&e.ba.key.endsWith(':4')&&e.ba.t>=bLen(e.ba.key)-1)e.ba.t=bLen(e.ba.key)-1;if(d.t>=1.4&&!d.said){d.said=true;sayNow(level.bossDefeat);}if(d.said)d.done=true;}
  if(d.kind==='lot00'){if(d.t>=1.2&&!d.said){d.said=true;sayNow(level.lastCopy?.lines?.after);}if(d.said)d.done=true;}
}
function sparkBurst(x,y,n=10){effects.push({type:'spark',x,y,age:0,life:.2,big:true});burst(x,y,'#ffe39a',n);}
// Sable's move to the controls (2.7 s): he walks (main 1) to the control chair and sits behind its glass; then the controls fight
function sableTransform(e,dt){
  const c=crown;if(c&&!c.occupied){const tx=c.x;e.dir=Math.sign(tx-e.x)||-1;e.x=approach(e.x,tx,170*dt);e.y=approach(e.y,c.y,60*dt);e.moving=true;bPlay(e,bWalkKey(e),{keep:true,hold:false});if(Math.abs(e.x-tx)<2){c.occupied=true;e.hidden=true;}}
  if(e.timer<=0){e.state='walk';e.timer=.6;e.hidden=true;if(c){e.x=c.x;e.y=c.y;c.occupied=true;}setBossCard(defOf(e)?.name||'SABLE · GATE CONTROLS',level.phase2?.card||'',2.4);}
}
// --------------------------------------------------------------- the per-tick dispatch for every boss
function updateBoss(e,dt,ox,oy){
  if(e.type!=='fessenden'&&e.jetT>0)crownJetTick(e,dt);
  if(!(e.freeze>0)&&e.ba)e.ba.t+=dt*60*(e.state==='walk'&&e.moving&&e.drowsy>0?.5:1);
  bossArena(e,dt);
  if(e.type==='fessenden'){crownUpdate(e,dt,ox,oy);return;}
  if(e.type==='truck'&&driving&&!BDEF.truck?.onFoot){mackUpdate(e,dt);return;}
  bossState(e,dt,ox,oy);
  if(e.state!=='intro'&&e.state!=='flee')bossTether(e);   // Glassback's leash to her nest holds through every move (charges and leaps too)
}
function bossState(e,dt,ox,oy){
  e.flinchCd=Math.max(0,(e.flinchCd||0)-dt);e.nearCd=Math.max(0,(e.nearCd||0)-dt);
  if(e.flinch>0){if(e.state!=='walk')e.flinch=0;else{e.flinch-=dt;const k=bSpec(e,defOf(e)?.flinch)?.alts[0][0];if(k)bPlay(e,k,{keep:true});if(e.flinch>0)return;bIdle(e);}}
  switch(e.state){
    case 'intro':bossIntroTick(e,dt);return;
    case 'transform':sableTransform(e,dt);return;
    case 'mutate':if(e.timer<=0){e.state='walk';e.timer=.4;e.inv=0;bIdle(e);}return;
    case 'script':if(e.timer<=0){e.state='walk';e.timer=.2;e.tempoMul=e.tempoNext||1;bIdle(e);}return;
    case 'down':case 'rise':bossDownTick(e,dt);return;
    case 'windup':if(e.timer<=0)bossFire(e);else if(e.mvI){const I=e.mvI,p=clamp(1-e.timer/Math.max(1e-3,e.windT),0,1);if(I.pre&&e.ba?.key===I.pre){e.ba.t=Math.min(I.preT,p*(I.preWind??I.preT));if(p>=1-1e-6&&(I.preWind??I.preT)>=I.preT)bPlay(e,I.key);}else if(e.ba?.key===I.key)e.ba.t=Math.min(I.hitT-.01,p*I.hitT);if(e.gaff)e.gaff.len=p*e.gaff.max*.4;}return;
    case 'recover':bossRecover(e,dt);return;
    case 'charge':bossCharge(e,dt);return;
    case 'leap':bossLeap(e,dt);return;
  }
  if(lock&&e.onstage)e.x=clamp(e.x,lock.left+21,lock.right-31);
  bossThink(e,dt,ox,oy);
}
// --------------------------------------------------------------- hurt boxes: the span a hit is tested against
// Bosses are wide: a blow lands when it reaches the nearest point of the body's hurt span (the frame box on show,
// Crownback's parts, the gate controls' glass) instead of the feet origin.
function bossSpan(e){
  if(!e||!e.boss)return null;
  if(e.type==='sable'&&e.phase===2){const C=ROMB()?.crownEngine,g=C?.glass||[-48,-114,104,44],c=crown||e;return [c.x+g[0],c.x+g[0]+g[2]];}
  // Crownback: his idle body (head to hips), never the swinging tail or the extended arm
  if(e.type==='fessenden'){const a=bAnim(bIdleKey(e)),fr=a&&ROMB().frames[a.f[0][0]];if(fr){const x0=e.dir>0?e.x-(fr[3]-fr[5]):e.x-fr[5];return e.dir>0?[x0+fr[3]*.4,x0+fr[3]*.9]:[x0+fr[3]*.1,x0+fr[3]*.6];}}
  const f=bFrame(e);if(!f)return null;const fr=ROMB().frames[f.fid],x0=e.dir>0?e.x-(fr[3]-fr[5]):e.x-fr[5];return [x0+fr[3]*.18,x0+fr[3]*.82];
}
function hx(e,x){const s=bossSpan(e);return s?clamp(x,s[0],s[1]):e.x;}
// --------------------------------------------------------------- drawing
function drawBossFrame(fid,x,y,dir,map){return drawRomFrame(fid,x,y,dir,map,'bosses');}
// the chain (VICE T.'s 0x945CC): links cut from its long straight frame (angle 6) stamped along a line
function drawChainLine(x0,y0,x1,y1,map,g=ctx){
  const a=bAnim('0x945CC:6'),B=ROMB(),SP=window.SPRITES;if(!a||!B||!SP||!SP.familyReady('bosses'))return false;const fr=B.frames[a.f[0][0]];const c=SP.canvasFor(fr[0],map||'S1A2','bosses',[fr[1],fr[2],fr[3],fr[4]]);if(!c)return false;
  const sx=fr[1]+Math.round(fr[3]*.5)-4,sy=fr[2]+Math.round(fr[4]*.5)-4,n=Math.max(1,Math.floor(Math.hypot(x1-x0,y1-y0)/7));
  for(let i=0;i<=n;i++){const p=i/n;g.drawImage(c,sx,sy,8,8,Math.round(x0+(x1-x0)*p-4),Math.round(y0+(y1-y0)*p-4),8,8);}
  return true;
}
// the map of a generated body's frame: its sheet b-<id> belongs to body <id> (two bodies meet in a transformation)
function genMap(e,fid,gel){const B=ROMB(),sh=B?.frames?.[fid]?.[0],b=typeof sh==='string'&&sh.startsWith('b-')?B.bodies?.[sh.slice(2)]:null;if(!b?.source||!b.pal)return null;return gel?b.pal.gel||null:b.pal[b.use]||b.pal.home||null;}
// a two-body anim (a transformation): body A's anim then body B's, built once
function comboAnim(key,a,b){const B=ROMB();if(!B?.anims)return null;if(B.anims[key])return key;const x=bAnim(a),y=bAnim(b);if(!x||!y)return null;B.anims[key]={f:x.f.concat(y.f).map(f=>[f[0],f[1]]),loop:0,name:key};return key;}
function drawBoss(e,x,y){
  if(e.testHidden)return true;   // test.hideEnemy: the body (and its harness chain) only, the sequel tells drawn around it stay
  if(e.hidden&&!(e.dead>0&&e.type!=='sable'))return true;
  if(e.type==='sable'&&e.phase===2)return true;     // the gate controls draw as the arena's crown prop (drawCrown)
  if(e.type==='fessenden')return drawCrownback(e,x,y);
  const f=bFrame(e);if(!f)return false;
  if(e.dead>0&&!e.dissolve&&e.defeat?.kind==='knock'&&e.dead<.6&&Math.floor(e.dead*30)%2)return true;
  let map=e.flashMap==='gel'?bossMap(e,true)||bossMap(e):bossMap(e);{const gm=genMap(e,f.fid,e.flashMap==='gel');if(gm)map=gm;}
  if(e.gaff&&defOf(e)?.chain!==false)drawChainLine(x+e.dir*30,y-56,x+e.dir*(30+e.gaff.len),y-40,'S1A2');
  if(e.type==='truck'&&!BDEF.truck?.onFoot&&e.collar!==false)drawChainLine(x+e.dir*58,y-40,x+e.dir*4,y-3,'S1A2');   // the cargo harness chain hangs from Breakwater's harness
  const D=defOf(e),spin=e.state==='charge'&&D?.moves?.[e.mvName]?.spin;
  if(spin){const fr=ROMB().frames[f.fid],cx=x+(e.dir>0?(fr[3]-fr[5])-fr[3]/2:fr[3]/2-fr[5]),cy=y-fr[6]+fr[4]/2,q=Math.floor(Math.abs(e.x-(e.spin0??e.x))/18)%4;ctx.save();ctx.translate(Math.round(cx),Math.round(cy));ctx.rotate(-e.dir*q*Math.PI/2);const ok=drawBossFrame(f.fid,Math.round(x-cx),Math.round(y-cy),e.dir,map);ctx.restore();return ok;}
  {const R=D?.rig&&e.defeat&&f.i>=(D.rigFrom??2)&&bSpec(e,D.rig);if(R){const rf=bAnim(R.alts[0][0]).f[0][0];const side=Math.sign((lock?(lock.left+lock.right)/2:camera+W/2)-e.x)||-e.dir;drawBossFrame(rf,x+side*(D.rigDx??40),y,e.dir,genMap(e,rf)||map);}}
  const ok=drawBossFrame(f.fid,x,y,e.dir,map);
  if(ok&&e.jetT>0)drawCrownJet(e,x,y);
  if(ok&&e.dissolve){const gm=bossMap(e,true);if(gm){ctx.save();ctx.globalAlpha*=e.dead>0?clamp(1-(e.dead-0)/.75,.35,1):.35;drawBossFrame(f.fid,x,y,e.dir,gm);ctx.restore();}}
  return ok;
}
function bossShadowW(e){const f=bFrame(e),fr=f&&ROMB().frames[f.fid];if(fr&&(fr[8]&1))return 0;return fr?Math.max(20,Math.round(fr[3]*.32)):31;}
// The gate controls: the E8a3 throne-and-capsule bake (ROM_BOSSES.crownEngine) standing in for the dam's control chair, at
// lock.right - 96, y-sorted at its feet line, never an fg page (RISK R9); Sable's idle frame shows inside the glass while
// he sits in it; cracked once he leaves it for the treatment.
function drawCrown(c){
  const C=ROMB()?.crownEngine,x=c.x-viewX;if(!C||x<-140||x>W+140)return;
  const fid=c.cracked?C.frames.cracked:C.frames.idle,map=c.cracked||c.stalled?C.pal?.dark||C.pal?.crown:C.pal?.crown||'crown';
  drawBossFrame(fid,x,c.y,-1,map);
  if(c.occupied&&!c.cracked){const g=C.glass,B=ROMB().bodies,S=B.sable||B.richmond,a=bAnim(S.main+':0');if(a){ctx.save();ctx.beginPath();ctx.rect(Math.round(x+g[0]),Math.round(c.y+g[1]),g[2],g[3]);ctx.clip();drawBossFrame(a.f[0][0],x+4,c.y+g[1]+g[3]+(B.sable?54:58),-1,B.sable?S.pal[S.use]||S.pal.home:S.pal?.sable||'sable');ctx.restore();}}
  if(c.stalled&&!c.cracked&&Math.floor(time*12)%5===0)rect(ctx,x-10+((time*97)%40),c.y-120+((time*53)%30),2,2,'#fff2a8');
}
// ================================================================ CROWNBACK: Sable after the Crown treatment (CAMPAIGN §10.4; BOSS-SPECS 6c)
// One generated body ('crownback', sprite-data-boss-crownback.js) fought through the boss driver above on BOSS_DEFS.fessenden's
// moves and phase patterns. Around the driver (crownUpdate): the treatment (Sable walks out of the cracked control chair and
// plays his transform frames, then Crownback's: invulnerable, nothing hurts anyone), the phase modes (planted 100-66 % at a
// slower walk, wading 66-33 %, guard broken 33-0 %: x1.5 to the end), a roar at each threshold, the spillway wheels'
// stagger (the hurt frame, x1.5), the pressure-release jet
// (a marked lane during the gill tell, then the water along it) and the defeat (roar, stagger, fall, lying in the
// spillway: no gel, no explosion). Every frame is drawn in its own body's palette (the treatment mixes Sable's frames and
// Crownback's).
const CROWN_TF='crownback:treatment';
const crownKey=n=>{const b=bodyOf({type:'fessenden'});return b?b.main+':'+n:null;};
// the treatment as one anim: Sable's main 9 (inject, swell, half-grown), then Crownback's main 10 (half-grown, roaring)
function crownTfKey(){const B=ROMB();if(!B?.anims)return null;if(B.anims[CROWN_TF])return CROWN_TF;
  const S=B.bodies?.sable,C=B.bodies?.crownback,a=S&&B.anims[S.main+':9'],b=C&&B.anims[C.main+':10'];if(!a||!b)return null;
  B.anims[CROWN_TF]={f:a.f.concat(b.f).map(x=>[x[0],x[1]]),loop:0,t:'crownback',name:'treatment'};return CROWN_TF;}
const sableWalkKey=()=>{const S=ROMB()?.bodies?.sable;return S?S.main+':1':null;};
function crownMap(e,fid,gel){const B=ROMB(),b=B?.bodies?.[B?.frames?.[fid]?.[0]==='b-sable'?'sable':'crownback'];if(!b?.pal)return bossMap(e,gel);return gel?b.pal.gel||null:b.pal[b.use]||b.pal.home||null;}
const jetMove=e=>{const m=defOf(e)?.moves||{};return Object.values(m).find(v=>v&&v.kind==='jet')||{};};
const crownMouth=e=>jetMove(e).mouth||{dx:86,z:95};
// the spillway after the gate controls: Sable steps out of the cracked chair (lock.right - 96) to lock.right - 120 and
// takes the treatment there
function crownSpawn(x,y){
  const D=BDEF.fessenden,I=D?.intro||{},t=I.t||3.4,c=crown,b=spawnEnemy(c?c.x-12:x,c?c.y+4:y,'fessenden',true);
  Object.assign(b,{name:D?.name||'CROWNBACK',phase:3,calls:0,pi:0,useN:{},said:{},dir:-1,state:'mutate',timer:t,introT:t,inv:t,onstage:true,enterX:x,enterY:y,mutWalk:true,z:0});
  bPlay(b,sableWalkKey()||crownTfKey(),{hold:false});return b;
}
function crownMutate(e,dt){
  if(e.mutWalk){e.x=approach(e.x,e.enterX,110*dt);e.y=approach(e.y,e.enterY,60*dt);e.dir=-1;e.moving=true;
    if(Math.abs(e.x-e.enterX)<1&&Math.abs(e.y-e.enterY)<1){e.mutWalk=false;e.x=e.enterX;e.y=e.enterY;bPlay(e,crownTfKey(),{hold:true});sfx('special');voice('bossTransform');}}
  if(e.timer<=0){e.state='walk';e.timer=.45;e.inv=0;e.mutWalk=false;e.x=e.enterX;e.y=e.enterY;bIdle(e);}
}
function crownPhaseK(e){const f=e.hp/e.maxhp;let k=0;(BDEF.fessenden?.phases||[]).forEach((p,i)=>{if(f<=p.at+1e-9)k=i;});return k;}
const crownModeOf=e=>BDEF.fessenden?.phases?.[e.modeK|0]?.mode||'planted';
function crownStop(e){clearEnemyHazards(e.id);e.jetT=0;e.mvI=null;e.rec=null;e.next=null;}
function crownUpdate(e,dt,ox,oy){
  if(e.state==='mutate'){crownMutate(e,dt);return;}
  if(e.jetT>0)crownJetTick(e,dt);
  const k=crownPhaseK(e),phs=BDEF.fessenden?.phases||[];
  if(e.modeK==null)e.modeK=k;
  else if(k>e.modeK){e.modeK=k;const ph=phs[k]||{};
    if(ph.mode==='collapse'){e.vulnMul=ph.bodyHurt||1.5;e.vulnT=999;toast='HIS GUARD BREAKS · HIT HIM!';toastTime=2;}
    else if(ph.mode==='wading'){toast='CROWNBACK WADES OUT OF THE CHANNEL';toastTime=2;}
    if(ph.roar&&!['stagger','charge','leap'].includes(e.state)){crownStop(e);e.state='roar';e.timer=.75;bPlay(e,crownKey(8));shake=Math.max(shake,6);sfx('special');voice('roar');}}
  e.walkMul=phs[e.modeK]?.speed||1;e.planted=crownModeOf(e)==='planted';   // planted behind the shield arm: he turns and lines up his lane, never walks out
  if(e.state==='stagger'){e.stagger=Math.max(0,(e.stagger||0)-dt);if(e.stagger<=0){e.state='walk';e.timer=.3;bIdle(e);}return;}
  if(e.state==='roar'){if(e.timer<=0){e.state='walk';e.timer=.2;bIdle(e);}return;}
  bossState(e,dt,ox,oy);
  // he keeps to the front of the band: his raised frames (170 px) stay on screen
  {const b=bandOf(e.x);if(e.state!=='dead')e.y=clamp(e.y,Math.min(b.bottom-4,b.top+40),b.bottom-2);}
}
// the pressure-release jet: water from the mouth along his lane (mv.len px), mv.t s; the lane was marked during the tell
function crownJetStart(e,I){const mv=I.mv,m=crownMouth(e),x0=e.x+e.dir*m.dx,x1=x0+e.dir*(mv.len||240);
  zones.push({owner:e.id,style:'jet',lane:[Math.min(x0,x1),Math.max(x0,x1)],x:(x0+x1)/2,y:e.y,r:(mv.lane||14)*2,t:e.windT+(mv.t||.55),t0Fire:mv.t||.55,total:e.windT,friendly:false,damage:0});}
function crownJetFire(e,I){e.jetT=I.mv.t||.55;e.jetLen=0;e.jetHit=[];sfx('special');}
function crownJetTick(e,dt){
  const mv=jetMove(e),m=crownMouth(e),len=mv.len||240;e.jetT=Math.max(0,e.jetT-dt);e.jetLen=Math.min(len,(e.jetLen||0)+len*7*dt);
  for(const v of fighters()){if(e.jetHit.includes(v))continue;const dx=(v.x-e.x)*e.dir;
    if(dx>=m.dx-10&&dx<=m.dx+e.jetLen&&Math.abs(v.y-e.y)<(mv.lane||14)&&v.z<Math.max(m.z,m.zEnd??0)+12){strike(v,bossDmg(mv.dmg??26),e.x,false,{stun:10,react:10});e.jetHit.push(v);}}
}
function drawCrownJet(e,x,y){
  const J=ROMB()?.bodies?.[defOf(e)?.jet||'crownjet'],a=J&&bAnim(J.main+':0');if(!a||!(e.jetLen>0))return;const fid=a.f[0][0],fr=ROMB().frames[fid],m=crownMouth(e),step=Math.max(24,fr[3]-26),map=J.pal?.[J.use]||J.pal?.home;
  // a beam aimed down at the lane (mouth.zEnd): the stamps step from the emitters' height to zEnd over mouth.slope px
  const zAt=d=>m.zEnd==null?m.z:m.z+(m.zEnd-m.z)*Math.min(1,d/(m.slope||80)),zl=Math.min(m.z,m.zEnd??m.z),zh=Math.max(m.z,m.zEnd??m.z);
  const x0=x+e.dir*m.dx,n=Math.ceil(e.jetLen/step);ctx.save();ctx.beginPath();ctx.rect(Math.round(Math.min(x0,x0+e.dir*e.jetLen)),y-zh-50,Math.round(e.jetLen)+1,zh-zl+100);ctx.clip();
  for(let k=n-1;k>=0;k--)drawBossFrame(fid,x0+e.dir*k*step,y-zAt(k*step)+((k+Math.floor(time*20))%2),e.dir,map);
  ctx.restore();
}
function drawCrownback(e,x,y){
  const f=bFrame(e);if(!f)return false;const gel=e.flashMap==='gel';
  const ok=drawBossFrame(f.fid,x,y,e.dir,(gel&&crownMap(e,f.fid,true))||crownMap(e,f.fid));
  if(ok&&e.jetT>0)drawCrownJet(e,x,y);
  return ok;
}
// The spillway wheels (CAMPAIGN §10.4 phases A-B): two gate objects at lock.left + 90 and the lock's centre; held 1 s they
// send a surge into the channel that knocks Crownback off his brace for 4 s (body flinch 15-22) and opens him to x1.5;
// 12 s to recharge.
function makeWheels(){const L=lock||{left:camera,right:camera+W},W0=BDEF.fessenden?.phases?.[0]?.wheels||{};
  spillWheels=[L.left+90,(L.left+L.right)/2].map(x=>({x,y:laneY(.3,x),charge:0,cd:0,spin:0,hold:W0.hold||1,recharge:W0.recharge||12,stagger:W0.stagger||4,hurt:W0.hurt||1.5}));
  say(level.lastCopy?.lines?.wheel);}
const wheelNear=()=>!driving&&player?spillWheels.find(w=>w.cd<=0&&Math.abs(w.x-player.x)<34&&Math.abs(w.y-player.y)<24&&player.z===0)||null:null;
function updateWheels(dt){
  if(!spillWheels.length)return;const boss=enemies.find(e=>e.type==='fessenden'&&e.boss&&!e.dead);if(!boss){spillWheels=[];return;}
  for(const w of spillWheels){w.cd=Math.max(0,w.cd-dt);w.spin+=dt*(w.charge>0?6:.4);}
  // any player on the field holding E at a wheel (slot order, the first wins)
  const hold=()=>{const q=wheelNear();return q&&down('KeyE','KeyV')&&player.hurt<=0&&player.attack<=0?q:null;};let w=null;
  if(multi()){for(const p of present())if(onField(p)&&(w=withPlayer(p,hold)))break;}else w=hold();
  if(w&&crownModeOf(boss)!=='collapse'&&!['intro','mutate','dead'].includes(boss.state)){w.charge+=dt;if(w.charge>=w.hold){w.charge=0;w.cd=w.recharge;
      crownStop(boss);Object.assign(boss,{state:'stagger',stagger:w.stagger,vulnT:w.stagger,vulnMul:w.hurt,z:0,flinch:0});bPlay(boss,crownKey(7),{hold:true});effects.push({type:'surge',x:boss.x,y:boss.y,age:0,life:.9});shake=Math.max(shake,8);sfx('explosion');toast='WHEEL! · THE RIVER HITS HIM';toastTime=2;}}
  else for(const v of spillWheels)v.charge=Math.max(0,v.charge-dt*.7);
}
function drawWheel(w){const x=w.x-viewX;if(x<-30||x>W+30)return;
  shadow(ctx,x,w.y,16,4);rect(ctx,x-3,w.y-43,6,43,'#3d4c4e');circle(ctx,x,w.y-43,16,w.cd>0?'#4d5c58':'#6f8a86');circle(ctx,x,w.y-43,11,'#203033');
  for(let k=0;k<6;k++){const a=w.spin+k*Math.PI/3;rect(ctx,x+Math.cos(a)*11-1.5,w.y-43+Math.sin(a)*11-1.5,3,3,w.cd>0?'#8b968c':'#e2d27a');}
  if(w.charge>0){rect(ctx,x-15,w.y-68,30,4,'#152322');rect(ctx,x-15,w.y-68,30*clamp(w.charge/w.hold,0,1),4,'#8fe4ed');}
  else if(w.cd<=0&&Math.floor(time*3)%2)label('E',x,w.y-63,7,'#ffe08a','center');}
// ================================================================ a truck boss fought from the Cadillac (the former BREAKWATER on MACK's body; CAMPAIGN §6.4; PLAN §7 G5f).
// Unused while BOSS_DEFS.truck is Krag / Ironclub (onFoot): kept for a car-fought chapter-2 boss.
// The screen is locked and the road streams under it, so Breakwater's x is screen-relative: pacing alongside the car is
// standing still on screen. Only rams and gunfire hurt it: rams x2 during its head-up window (recover), x0.5 otherwise; a
// boosted ram knocks it airborne (anim 3) into that window. Hits land on the collar: sparks, never blood.
function mackLane(){const car=player,b=bandOf(car.x),up=car.y-b.top>b.bottom-car.y;return clamp(car.y+(up?-40:40),b.top+2,b.bottom-2);}
function mackContact(e,dmg,knock){const car=player;if(Math.abs(hx(e,car.x)-car.x)<26&&Math.abs(car.y-e.y)<21&&!e.hitList.includes(car)){e.hitList.push(car);strike(car,dmg,e.x,true,null);if(knock){car.vx-=220;car.x-=18;car.bump=.3;shake=Math.max(shake,8);}sparkBurst(e.x+e.dir*60,e.y-44,8);return true;}return false;}
function mackUpdate(e,dt){
  const car=player,Lk=lock||{left:camera,right:camera+W},key=n=>bSpec(e,'main:'+n)?.alts[0][0];
  e.hitList=e.hitList||[];
  if(e.state==='intro'){bossIntroTick(e,dt);if(e.state!=='intro'){e.state='walk';e.timer=.3;}return;}
  if(e.state==='air'){const p=clamp(1-e.timer/.6,0,1);e.z=Math.sin(p*Math.PI)*30;bPlay(e,key(3),{keep:true});if(e.timer<=0){e.z=0;e.mvName='recover';e.state='recover';e.timer=(BDEF.truck?.moves?.recover?.t||1.2)/bossTempo(e);bPlay(e,key(5));}return;}
  const mv=e.mvName&&BDEF.truck?.moves?.[e.mvName];
  if(e.state==='walk'){
    const name=e.next||bossNext(e);if(!name){bPlay(e,key(0),{keep:true});return;}
    e.useN=e.useN||{};e.useN[name]=(e.useN[name]||0)+1;if(e.next===name)e.next=null;else e.pi++;e.mvName=name;e.hitList=[];const m=BDEF.truck.moves[name];
    if(name==='pace'){e.state='pace';e.timer=(m.t||2)/bossTempo(e);e.dir=1;}
    else if(name==='gore'){e.state='windup';e.timer=e.windT=(m.tell||.6)/bossTempo(e);e.dir=1;bPlay(e,key(4));toast='SIDESTEP THE GORE';toastTime=1.3;}
    else if(name==='headon'){e.state='windup';e.phase2h=0;e.hy=null;e.timer=e.windT=1.4;e.dir=1;bPlay(e,key(2),{hold:false});toast='CHANGE LANES · IT IS COMING BACK';toastTime=1.6;}
    else if(name==='recover'){e.state='recover';e.timer=(m.t||1.2)/bossTempo(e);bPlay(e,key(5));}
    else{e.state='recover';e.timer=.4;}
    return;}
  if(e.state==='pace'){const tx=car.x+30,ty=mackLane(),vx=clamp((tx-e.x)*3,-240,240);e.x+=vx*dt;e.y=approach(e.y,ty,90*dt);e.dir=1;
    bPlay(e,Math.abs(vx)>60?key(2):key(7),{keep:true,hold:false});mackContact(e,bossDmg(mv?.dmg??12),false);if(e.timer<=0)e.state='walk';return;}
  if(e.state==='windup'&&e.mvName==='gore'){e.x=approach(e.x,car.x-80,160*dt);e.y=approach(e.y,mackLane(),60*dt);e.dir=1;
    if(e.timer<=0){e.state='charge';e.timer=1.1;e.vx=EK?.bossVx?EK.bossVx(mv,0)*60:300;e.hitList=[];bPlay(e,key(2),{hold:false});}return;}
  if(e.state==='windup'&&e.mvName==='headon'){
    // it runs off the right edge (1.4 s at most), then the tell: the '!' in the car's lane for the full tell (CAMPAIGN §6.4
    // 1.0 s, never shorter on a faster tempo) before it charges back from beyond the edge
    if(!e.phase2h){e.dir=1;e.x+=320*dt;if(e.x>Lk.right+150||e.timer<=0){e.x=Math.max(e.x,Lk.right+150);e.phase2h=1;e.hy=car.y;e.dir=-1;e.timer=e.windT=Math.max(mv?.tell||1,(mv?.tell||1)/bossTempo(e));}return;}
    e.dir=-1;e.y=approach(e.y,e.hy,200*dt);
    if(e.timer<=0){e.x=Math.max(e.x,Lk.right+150);e.state='charge';e.timer=1.6;e.vx=-420;e.hitList=[];e.y=e.hy??car.y;e.dir=-1;bPlay(e,key(2),{hold:false});}return;}
  if(e.state==='charge'){e.x+=e.vx*dt;markStage(e);
    if(e.mvName==='gore'){e.y=approach(e.y,car.y,140*dt);mackContact(e,bossDmg(mv?.dmg??24),true);if(e.x>car.x+120||e.timer<=0)e.state='walk';}
    else{const m=mv||{};if(Math.abs(hx(e,car.x)-car.x)<26&&Math.abs(car.y-e.y)<21&&!e.hitList.includes(car)){e.hitList.push(car);strike(car,bossDmg(m.dmgCar??20),e.x,true,null);car.vx-=160;car.bump=.3;shake=Math.max(shake,10);
        e.inv=0;damageEnemy(e,(m.dmgSelf??40),26,false,false,{self:true});sparkBurst(e.x-40,e.y-44,14);e.x=car.x+130;if(e.state==='charge')e.state='walk';}
      else if(e.x<car.x-170||e.timer<=0){e.dir=1;e.state='walk';}}
    return;}
  if(e.state==='recover'){e.x=approach(e.x,clamp(e.x,Lk.left+60,Lk.right-40),120*dt);if(e.timer<=0)e.state='walk';return;}
  e.state='walk';
}

// ================================================================ the enemy driver (PLAN §7 G4; ENEMIES §2-§3, §7)
// Every regular, elite, rider and dinosaur is an ENEMY_KINDS kind (enemy-kinds.js) in one of its ROM variants (e.v),
// drawn from that variant's ROM records (ROM_ENEMIES, sprite-data-enemies.js) at one arcade px per art px through its
// palette map. The state machine is the sequel's (enter, drop, walk, windup, recover, charge, leap, hurt, held, fly,
// down, rise, flee, plus pickup and dizzy); a per-state clock (e.ps, e.stT) and the anim resolver (animateEnemy: e.ak,
// e.aF, e.af, e.fid) give every state its ROM anim. Walking advances by the distance walked; a windup stretches over the
// frames before the attack's first active frame (wind x T x telegraph) and the blow is tested on that frame; recover
// plays the rest of the anim and idles to the kind's cadence. Damage, stun and reaction come from the attack's 0xA2EA4
// record at the chapter's arcade level (K.DMG). Bosses run the boss driver above (BOSS_DEFS, G5) and the hero copies (HeroRig, G3b) keep the drivers
// further down. No Math.random here: attack choice is a cycle on e.attackNo and variants come from the cast (arrive).
const EK=window.ENEMY_KINDS||null,EKK=EK?EK.K:{telegraph:{easy:1.6,normal:1,hard:1},DEPTH:26};
const ROME=()=>window.ROM_ENEMIES||window.SPRITE_DATA?.families?.enemies||null;
const romKind=e=>!!(EK&&e&&!e.boss&&e.type!=='mirror'&&EK[e.type]&&EK[e.type].type&&!EK[e.type].parked&&!EK[e.type].scenery&&e.v);
const KC=new Map(),kc=(k,f)=>{let v=KC.get(k);if(v===undefined){v=f();KC.set(k,v);}return v;};
const eTable=e=>kc(`t|${e.type}|${e.v}`,()=>EK.table(e.type,e.v)||null);
const stKey=(e,st,k=0)=>kc(`s|${e.type}|${e.v}|${st}|${k}`,()=>EK.stateAnim(e.type,e.v,st,k)||null);
const hasSt=(e,st)=>!!stKey(e,st);
const eAnim=key=>key?ROME()?.anims?.[key]||null:null;
const animLen=a=>a?a.f.reduce((n,f)=>n+f[1],0):0;
const keyLen=key=>animLen(eAnim(key));
// How far an anim's frames reach ahead of the body's origin: the art faces left, so a body facing the screen reaches
// its frame's ox toward it (drawRomFrame), the widest frame of the anim. entryReach = that of the anim a kind:variant
// enters on (resolveAnim's 'enter'); side entries and set pieces start ENTRY_PAD beyond it, which also covers the
// screen shake (14 x LEG < 11 px).
const ENTRY_PAD=12;
function animReach(key){const a=eAnim(key),F=ROME();if(!a||!F)return 0;return kc(`r|${key}`,()=>a.f.reduce((m,f)=>Math.max(m,F.frames[f[0]]?.[5]||0),0));}
function entryReach(type,V){if(!EK||!V||!EK[type]||!ROME())return 0;const r=resolveAnim({type,v:V,state:'enter',ps:'enter',stT:0});if(!r)return 0;
  // a knife man's knife reaches past his fist on the run-in (knifeRun: up to 55 + the pose's ox 10)
  let m=animReach(r.key);const KR=type==='knifer'&&EK.knifer.knifeRun,p=KR&&KR.keys.includes(r.key)&&eAnim(KR.pose),fr=p&&ROME().frames[p.f[0][0]];
  if(fr)for(const f of KR.f)m=Math.max(m,fr[5]-f[0]);return m;}
// The frame index t ROM frames into anim a (ENEMIES §2.2 `time` mode): past its end it loops back to a.loop, or holds
// the last frame (hold, or a null loop).
function frameIdx(a,t,hold=false){
  const f=a.f,n=f.length;let i=0;t=Math.max(0,t);
  for(;i<n;i++){if(t<f[i][1]-1e-6)return i;t-=f[i][1];}
  if(hold||a.loop==null)return n-1;
  const L=Math.min(n-1,a.loop|0);let len=0;for(let k=L;k<n;k++)len+=f[k][1];if(len<=0)return n-1;t%=len;
  for(i=L;i<n;i++){if(t<f[i][1]-1e-6)return i;t-=f[i][1];}return n-1;
}
function defaultVariant(type){const k=EK&&EK[type];if(!k||!k.variants||k.hero||k.parked||k.scenery)return null;return Object.keys(k.variants).find(V=>EK.variantData(type,V))||null;}
function kindHpOf(type,V){if(!EK||!EK[type])return null;if(EK[type].hero)return EKK.MIRROR_HP;return V?EK.kindHp(type,V,levelIndex,'normal'):null;}
// TYROG's +0x23 colour per chapter (ENEMIES §2.7, KI13): slot 30 in ch5, 29 in ch6, its home 31 elsewhere.
function regentAlt(e){return e.type!=='regent'?null:levelIndex===4?'30':levelIndex===5?'29':null;}
function enemyMap(e,gel){const F=ROME();if(!F||!F.palMap||!e.v)return null;const base=`${EK.typeOf(e.type,e.v)}:${e.v}`;return gel?F.palMap[base+'/gel']:(e.palAlt&&F.palMap[`${base}/${e.palAlt}`])||F.palMap[base];}
const telegraph=()=>EKK.telegraph?.[normalizeDifficulty(difficulty)]??1;
const setPiecesOn=()=>normalizeDifficulty(difficulty)!=='easy';
function cadenceOf(e){const c=eTable(e)?.cadence;return typeof c==='number'?c:c&&c[e.v]!=null?c[e.v]:45;}
const rageMul=e=>e.rage>0?CFG.fx.rage.damage:1;
// One attack of a variant: its anim, the frame it hits (first active frame, or the authored hit / release / fire frame),
// the ROM frames before that frame, the tell before it (a leap shows its crouch frame or its pre anim; a charge or a spit
// whose anim is active from its first frame gets 12 f), and its 0xA2EA4 record: damage at the chapter's arcade level.
function atkInfo(e,a){
  if(!a)return null;
  return kc(`a|${e.type}|${e.v}|${a.id}|${levelIndex}`,()=>{
    const key=EK.resolve(e.type,e.v,a.a),an=eAnim(key),pre=a.pre?EK.resolve(e.type,e.v,a.pre):null,kind=a.kind||'melee';
    const fire=a.fire!=null&&typeof a.fire==='object'?a.fire[e.v]:a.fire;
    let hit=0,lift=0;if(an){const n=an.f.length;hit=an.act&&an.act.length?an.act[0]:Array.isArray(a.hit)&&a.hit.length?a.hit[0]:a.release!=null?a.release:fire!=null?fire:Math.min(1,n-1);hit=Math.max(0,Math.min(hit,n-1));
      // an aimed shot (a.aim): the windup ends where the firing pose begins; its frames before the fire frame are the lift
      if(a.aim&&!(an.act&&an.act.length)){let h=hit;while(h>0&&an.f[h-1][0]===an.f[hit][0])h--;for(let i=h;i<hit;i++)lift+=an.f[i][1];hit=h;}}
    let hitT=0;if(an)for(let i=0;i<hit;i++)hitT+=an.f[i][1];
    const crouch=an&&an.f.length>1&&hit>0?an.f[0][1]:0;
    const wind=kind==='leap'?Math.max(9,pre?keyLen(pre):crouch):Math.max(kind==='rush'||kind==='spit'?12:3,hitT);
    const vd=EK.variantData(e.type,e.v),rec=an?.atk;
    const dmg=a.dmg!=null?a.dmg:rec&&EKK.DMG?EKK.DMG(rec.tbl,vd&&vd.rankRow,EKK.lvl(levelIndex,'normal')):14;
    return {a,key,an,pre,kind,hit,hitT,lift,crouch,wind,len:animLen(an),dmg,stun:rec?.stun??4,react:rec?.react??0,win:a.reach||a.range||null};
  });
}
const hitOf=I=>({stun:I.stun,react:I.react});
// An attack fits a distance: melee up to its reach, the others inside their [min, max] window; a hit-and-run throw has
// none (it is thrown from wherever the thrower stands).
function fits(e,I,d){const w=I.win||(I.kind==='rush'?[0,e.type==='biker'?237:140]:null);if(!w)return true;return d>=(I.kind==='melee'?0:w[0])&&d<=w[1];}
// The next attack of the cycle (ENEMY_KINDS.attackCycle: the weights repeat an entry) that fits the distance, starting at
// e.attackNo; the elite signatures (PACK ALPHA's high pounce every third attack, LOT 07 HEAVY's belly charge and body
// press on every second) come first. Deterministic.
function chooseAttack(e,d){
  const tb=eTable(e);if(!tb)return null;
  if(e.elite){let id=null;if(e.type==='raptor'&&e.attackNo%3===2)id='highPounce';else if(e.type==='brute'&&e.attackNo%2===1)id=e.attackNo%4===1?'charge':'press';
    const a=id&&(tb.atk||[]).find(x=>x.id===id);if(a&&fits(e,atkInfo(e,a),d))return a;}
  const cyc=EK.attackCycle(e.type,e.v,e.type==='knifer'?e.knife!==false:true);if(!cyc.length)return null;
  // while the enemy is spacing itself for the head of the cycle (spacingFor), it waits for that attack
  const sp=e.space,head=cyc[e.attackNo%cyc.length];
  if(sp&&!sp.done&&sp.id===head.id)return fits(e,atkInfo(e,head),d)&&Math.abs(d-sp.want)<=6.5?head:null;
  for(let i=0;i<cyc.length;i++){const a=cyc[(e.attackNo+i)%cyc.length];if(fits(e,atkInfo(e,a),d)){e.attackNo+=i;return a;}}
  return null;
}
// Spacing for the next attack (G4 verify #2). At its stop the enemy's next attack in the cycle may not fit the distance
// (TYROG's leap from 60 px against his 56-px stop, RAZOR's slash at 40-60 against 72, a knife man's throws,
// the body press, the R HOPPER pounce, BLUDGE's kick): the cycle skipped it, so in a duel it never came. Now the enemy
// first steps in (aiming 8 px inside a melee reach) or backs off on its walk (aiming 12 px inside the window's near
// edge) to within 6 px of that spot, and then plays it. It gives up, and takes the next attack that fits as before, when the spot lies outside
// the lock or more than 64 px away (a knife man's long throw stays for far targets), or after the walk's time plus
// 0.6 s (0.8-2.2 s). Only at the stop: an enemy still closing in keeps choosing
// whatever fits (a leap from afar). The gunner keeps his own spacing (stop 168, backing off below 107) and spaces only for his shot; the
// hit-and-run throwers have none. No random call.
function spacingFor(e,t,d,stop,dt){
  if(onceThrower(e))return null;
  const cyc=EK.attackCycle(e.type,e.v,e.type==='knifer'?e.knife!==false:true);if(!cyc.length){e.space=null;return null;}
  const a=cyc[e.attackNo%cyc.length];if(e.space&&e.space.id!==a.id)e.space=null;
  // a poacher spaces himself only for his shot (backing off from a rolled-in or rolling-lunge range); his melee moves
  // come when a hero closes in (fix pass: after the roll the cycle always skipped the shots against a standing hero)
  if(e.type==='gunner'&&atkInfo(e,a)?.kind!=='shot'){e.space=null;return null;}
  if(e.space){if(e.space.done)return null;e.space.t+=dt;if(e.space.t>e.space.lim){e.space.done=true;return null;}return e.space;}
  const I=atkInfo(e,a);if(!I||!I.win||d>stop+6||fits(e,I,d))return null;
  const w=I.win;let want;
  if(d>w[1])want=w[1]-Math.min(8,(w[1]-w[0])/4);
  else if(I.kind!=='melee'&&d<w[0])want=w[0]+Math.min(12,(w[1]-w[0])/3);
  else return null;
  const L=lock||{left:camera,right:camera+W},tx=t.x-e.dir*want;
  if(Math.abs(want-d)>64||tx<L.left+21||tx>L.right-31){e.space={id:a.id,done:true};return null;}
  e.space={id:a.id,want,t:0,lim:clamp(Math.abs(want-d)/Math.max(1,enemySpeed(e)*.7)+.6,.8,2.2)};return e.space;
}
function startWindup(e,a,t){const I=atkInfo(e,a);e.move=a;e.state='windup';e.target=t;e.attackNo++;e.space=null;e.timer=e.windT=Math.max(1/60,I.wind/60*telegraph());e.strikeFlash=0;}
// After the blow: the rest of the attack anim (or `restF` frames of its last frame), an optional follow-up anim (the
// brute's catch breath, his get-up from the belly flop), then idle until the kind's cadence has passed since the attack
// began (ENEMIES §2.5 step 4). Recover ticks at the difficulty's recovery rate as before.
function endAttack(e,I,then=null,restF=null){
  const rest=restF??Math.max(0,I.len-I.hitT);e.state='recover';e.rec={key:I.key,t0:restF!=null?Math.max(0,I.len-1):I.hitT,len:rest,then};
  e.timer=(rest+(then?then.f:0)+Math.max(0,cadenceOf(e)-I.len))/60;
}
// The blow on the attack's active (or release / fire) frame, at the end of the windup.
function romStrike(e){
  const a=e.move,I=atkInfo(e,a);if(!I){e.state='recover';e.timer=.4;return;}
  const v=e.target&&(e.target===player||isLiveP(e.target)||allies.includes(e.target))?e.target:player;e.strikeFlash=.2;
  if(I.kind==='leap'){startLeap(e,I,v);return;}
  if(I.kind==='rush'){startCharge(e,I);return;}
  if(I.kind==='throw')throwKnife(e,I);
  else if(I.kind==='shot'){if(I.lift>0)e.pendingShot={t:I.lift/60};else enemyShot(e,I);}
  else if(I.kind==='lob')throwBomb(e,I,v);
  else if(I.kind==='spit')spitParasites(e,I,v);
  else{const dx=v.x-e.x;if(Math.abs(dx)<=I.win[1]+(e.elite?6:0)&&(Math.sign(dx)===e.dir||Math.abs(dx)<12)&&Math.abs(e.y-v.y)<EKK.DEPTH)strike(v,I.dmg*rageMul(e),e.x,false,hitOf(I));}
  if(a.once)e.spent=true;
  e.bit=e.type==='raptor'&&/bite/i.test(a.id);
  endAttack(e,I);
}
// R HOPPER's hop back (main 29; ENEMIES §2.5): after a bite, while its target is attacking, a short leap backwards.
function startEvade(e){const L=lock||{left:camera,right:camera+W},tx=clamp(e.x-e.dir*56,L.left+24,L.right-31),b=bandOf(tx);Object.assign(e,{state:'leap',move:null,evade:true,leapT:.4,timer:.4,leapH:16,startX:e.x,startY:e.y,targetX:tx,targetY:clamp(e.y,b.top,b.bottom),hitList:[],bit:false});}
// Leaps (jump kicks, the knifer's leaping attack, pounces, the brute's body press, TYROG's dive): the whole flight is
// the active window, one hit per target; a body press lands with its zone (r 40).
function startLeap(e,I,v){
  const a=I.a,L=lock||{left:camera,right:camera+W},tx=clamp(v.x,L.left+30,L.right-30),b=bandOf(tx);
  e.state='leap';e.leapT=e.timer=a.arc?.t??.5;e.leapH=a.arc?.h??30;e.startX=e.x;e.startY=e.y;e.targetX=tx;e.targetY=clamp(v.y,b.top,b.bottom);e.hitList=[];
}
function romLeap(e){
  const I=atkInfo(e,e.move),p=clamp(1-e.timer/e.leapT,0,1);
  e.x=e.startX+(e.targetX-e.startX)*p;e.y=e.startY+(e.targetY-e.startY)*p;e.z=Math.sin(p*Math.PI)*e.leapH;
  if(I)for(const v of fighters()){if(e.hitList.includes(v))continue;if(Math.abs(e.x-v.x)<28&&Math.abs(e.y-v.y)<EKK.DEPTH&&v.z<40){strike(v,I.dmg*rageMul(e),e.x-e.dir*20,false,hitOf(I));e.hitList.push(v);}}
  if(e.timer<=0){e.z=0;e.evade=false;if(!I){e.state='recover';e.timer=.5;return;}
    if(I.a.r)zones.push({owner:e.id,x:e.x,y:e.y,r:I.a.r,t:.12,total:.12,friendly:false,damage:I.dmg,air:true});
    const then=I.a.then?stKey(e,I.a.then):null;endAttack(e,I,then?{key:then,f:keyLen(then)}:null,8);}
}
// Charges (the belly charge, the raptor's run attack, the gunner's rolling lunge, a bike's ram): every frame is active,
// one hit per target; the brute then catches his breath (main 13, 0.8 s: an authentic opening).
function startCharge(e,I){const a=I.a;e.state='charge';e.vx=e.dir*(e.type==='biker'?252:a.vx?a.vx*60:200);e.timer=e.type==='biker'?.55:clamp((I.len-I.hitT)/60,.35,.7);e.hitList=[];}
function romCharge(e,dt){
  const I=atkInfo(e,e.move);e.x+=e.vx*dt;
  if(I)for(const v of fighters()){if(e.hitList.includes(v))continue;if(Math.abs(e.x-v.x)<(e.type==='biker'?44:34)&&Math.abs(e.y-v.y)<EKK.DEPTH){strike(v,I.dmg*rageMul(e),e.x-e.dir*44,false,hitOf(I));e.hitList.push(v);}}
  if(lock)e.x=clamp(e.x,lock.left+22,lock.right-31);
  if(e.timer<=0){if(!I){e.state='recover';e.timer=.5;return;}const then=I.a.then?stKey(e,I.a.then):null;endAttack(e,I,then?{key:then,f:I.a.then==='breath'?48:keyLen(then)}:null,0);}
}
// The knife man's throw (main 12 / 28 / 31): the knife object 0x6FB6A flies from 64 px ahead at 64 px up (ENEMIES
// §2.8), spinning; it leaves him unarmed, and wherever it stops (a hit or a miss) it lies on the floor as a knife.
function throwKnife(e,I){
  const s=I.a.spawn||{dx:64,h:64},dir=e.dir;e.knife=false;sfx('swing');
  bullets.push({x:e.x+dir*s.dx,y:e.y,z:s.h,vx:dir*244,vy:0,friendly:false,damage:I.dmg,owner:e.id,life:1.2,kind:'thrown',weapon:'knife',age:0,dir,enemyKnife:true,hit:hitOf(I),art:{key:eTable(e)?.obj?.spin||'0x6FB6A:32',map:enemyMap(e)}});
}
// The poacher's aimed shot (main 15: the 48-frame aim is the windup; the firing pose's 3-frame lift follows in recover,
// e.pendingShot, and a hit in it cancels the shot): the muzzle flash 0x57E0E:1 and the round 0x6FB1A:0 on the 1-frame
// fire frame, from 43 px ahead, 68 px up. Its damage was not captured live and stays the sequel's 14.
function enemyShot(e,I){
  const m=I.a.muzzle||{dx:43,h:68},dir=e.dir,x=e.x+dir*m.dx,map=enemyMap(e);
  bullets.push({x,y:e.y,z:m.h,vx:dir*252,vy:0,friendly:false,damage:I.dmg,owner:e.id,life:1.5,age:0,dir,hit:hitOf(I),art:{key:I.a.obj||'0x6FB1A:0',map}});
  effects.push({type:'erom',key:I.a.flash||'0x57E0E:1',map,x,y:e.y,z:m.h,dir,age:0,life:16/60});sfx('enemygun');
}
// Thurow's bomb / dynamite (main 7): an arc onto the target's lane in 0.8 s, then the blast (r 40; id 106).
function throwBomb(e,I,v){
  const set=e.v==='U'?'0x5F0AC':'0x5F128',L=lock||{left:camera,right:camera+W},x1=clamp(v.x,L.left+16,L.right-16);
  bullets.push({kind:'bomb',x:e.x+e.dir*12,y:e.y,z:48,x0:e.x+e.dir*12,y0:e.y,z0:48,x1,y1:v.y,h:44,t:0,T:I.a.arc?.t??.8,friendly:false,damage:I.dmg,r:I.a.r||40,owner:e.id,life:2,age:0,dir:e.dir,hit:hitOf(I),art:{set,map:enemyMap(e)}});sfx('swing');
}
// TYROG's spit (main 22): two parasites (0x71408:10 leap, :11 crawl) land 60 px ahead and crawl at the target for 2 s;
// a ground hazard that a jump avoids (air:false). Their damage was not captured: 10.
function spitParasites(e,I,v){
  const n=I.a.n||2,dir=e.dir;
  for(let k=0;k<n;k++)bullets.push({kind:'parasite',x:e.x+dir*(40+k*14),y:e.y+(k?7:-7),z:72,vx:dir*(40+k*20),vz:40,friendly:false,damage:I.a.dmg||10,owner:e.id,life:(I.a.crawl||2)+.8,age:0,dir,hit:hitOf(I)});
}
// The walking AI of a ROM kind (the sequel's crowd rules: target, flank routes, attack slots, the lock clamp; ENEMIES
// §2.5 for the stops, reaches and moves).
const ROM_STOP={raider:57,knifer:72,gunner:168,brute:72,raptor:46,mutant:46,regent:56,biker:132};
const onceThrower=e=>(e.type==='gunner'&&(e.v==='T'||e.v==='U'))||(e.type==='knifer'&&e.v==='P');
function startExit(e){const mid=lock?(lock.left+lock.right)/2:camera+W/2;e.state='flee';e.exitDir=e.from||(e.x<mid?-1:1);e.dir=e.exitDir;e.timer=6;e.move=null;}
function knifeNear(e){const r=eTable(e)?.pickupRange||118;let best=null,bd=1e9;for(const d of drops){if(d.type!=='knife'||d.claimed||d.vz!=null||(d.z||0)>0)continue;const dd=Math.abs(d.x-e.x);if(dd<r&&Math.abs(d.y-e.y)<48&&dd<bd){bd=dd;best=d;}}return best;}
// A hazard rect (pit, water edge) just ahead of a walking enemy, on its lane: it steers to the lane past the hazard's
// nearer edge first instead of pushing into it (the walk mask would hold it there; G4 bot, ch4 a2's pit).
function detourY(e,y){
  const a=curArea();if(!a||!a.hazards)return y;
  for(const h of a.hazards){const r=h.rect,x0=r[0]-14,x1=r[0]+r[2]+14,ahead=e.dir>0?e.x<x1&&e.x+40>x0:e.x>x0&&e.x-40<x1;
    if(!ahead||(e.y<r[1]-2&&y<r[1]-2)||(e.y>r[1]+r[3]+2&&y>r[1]+r[3]+2))continue;
    const b=bandOf(e.x),opts=[r[1]-3,r[1]+r[3]+3].filter(v=>v>=b.top&&v<=b.bottom);if(opts.length)return opts.sort((p,q)=>Math.abs(p-e.y)-Math.abs(q-e.y))[0];}
  return y;
}
// The target's lane lies across a hazard straight above or below an enemy that has no x to cover (a hero in the strip
// under ch4 a2's pit, the raider on its far edge: neither could reach the other). The enemy first walks out past the
// hazard's nearer x edge (16 px clear, inside the lock); then its lane is free (G4 fix pass, natural play on normal).
function detourX(e,y){
  const a=curArea();if(!a||!a.hazards||Math.abs(e.y-y)<=2)return null;
  const lo=Math.min(e.y,y),hi=Math.max(e.y,y),L=lock||{left:camera,right:camera+W};
  for(const h of a.hazards){const r=h.rect;if(e.x<r[0]-6||e.x>r[0]+r[2]+6||hi<=r[1]||lo>=r[1]+r[3])continue;
    const xs=[r[0]-16,r[0]+r[2]+16].filter(x=>x>L.left+21&&x<L.right-31).sort((p,q)=>Math.abs(p-e.x)-Math.abs(q-e.x));return xs.length?xs[0]:null;}
  return null;
}
function romThink(e,dt,ox,oy){
  if(e.state==='captive'){captiveThink(e);return;}
  if(e.setPiece&&e.v==='N'){naguriThink(e);return;}
  const once=onceThrower(e);
  if(once&&e.spent){startExit(e);return;}
  // A knife man without his knife goes for the nearest knife on the floor and picks it up (main 21; ENEMIES §2.5).
  if(e.type==='knifer'&&e.knife===false&&!once){const d=knifeNear(e);if(d){
    const sp=enemySpeed(e);e.dir=Math.sign(d.x-e.x)||e.dir;e.x=approach(e.x,d.x,sp*dt);e.y=approach(e.y,d.y,sp*.6*dt);e.moving=true;
    if(Math.abs(e.x-d.x)<4&&Math.abs(e.y-d.y)<3){e.state='pickup';e.timer=Math.max(.2,keyLen(stKey(e,'pickup'))/60);e.seekDrop=d;e.moving=false;}
    if(lock&&e.onstage)e.x=clamp(e.x,lock.left+21,lock.right-31);const r=walkTo(ox,oy,e.x,e.y);e.x=r.x;e.y=r.y;return;}}
  if(e.brood&&broodMove(e))return;
  const t=hostileTarget(e);
  e.dir=Math.sign(t.x-e.x)||e.dir;const distance=Math.abs(t.x-e.x),dy=Math.abs(t.y-e.y);
  if(e.bit&&(t===player||isLiveP(t))&&(t.attack>0||t.moveState)&&distance<64&&dy<EKK.DEPTH){startEvade(e);return;}
  const speed=enemySpeed(e),stop=once?Infinity:e.type==='knifer'&&e.knife===false?45:ROM_STOP[e.type]??eTable(e)?.stop??57;
  const flank=!once&&e.id<rules().flankChance&&enemies.some(o=>o!==e&&!o.dead&&!o.waiting&&!o.setPiece&&Math.abs(o.x-t.x)<rules().flankDistance&&Math.abs(o.y-t.y)<18);
  const canAttack=enemies.filter(o=>o!==e&&!o.dead&&['windup','charge','leap'].includes(o.state)).length<rules().attackSlots;
  e.flankCooldown=Math.max(0,(e.flankCooldown||0)-dt);
  // POACHER's forward roll (main 4 [7x5], ENEMIES §2.5 'close the gap'): once, ready to attack with his target 90-150 px
  // away, he rolls toward it at 2.5 px/f (87 px over the anim) and attacks from close range on landing; his back-off rule
  // (below 107 px) resumes after that attack. Not while driving, never out of the lock.
  if(e.type==='gunner'&&!once&&!driving&&!e.rolled&&canAttack&&e.onstage&&e.timer<=0&&distance>=90&&distance<=150&&dy<EKK.DEPTH-2&&hasSt(e,'roll')){
    const len=Math.max(.2,keyLen(stKey(e,'roll'))/60),L=lock||{left:camera,right:camera+W},tx=e.x+e.dir*150*len;
    if(tx>L.left+21&&tx<L.right-31){e.rolled=true;e.state='roll';e.timer=len;e.vx=e.dir*150;e.target=t;return;}
  }
  if(rules().flankRear&&flank&&!e.flankRoute&&!e.flankCooldown&&distance<119){e.flankRoute={side:Math.sign(e.x-t.x)||1,ttl:1.4};e.flankCooldown=3.5;}
  if(e.flankRoute){
    const fb=bandOf(t.x),route=e.flankRoute,tx=clamp(t.x-route.side*53,(lock?.left??camera)+24,(lock?.right??camera+W)-31),ty=clamp(t.y+(e.id>.5?33:-33),fb.top+3,fb.bottom-2);
    route.ttl-=dt;e.x=approach(e.x,tx,speed*1.18*dt);e.y=approach(e.y,ty,speed*.8*dt);e.moving=true;{const r=walkTo(ox,oy,e.x,e.y);e.x=r.x;e.y=r.y;}
    if(Math.abs(e.x-tx)<6||route.ttl<=0){e.flankRoute=null;e.timer=Math.min(e.timer,.12);}return;
  }
  // ready to attack at its stop: space itself for the next attack of the cycle (spacingFor)
  const sp=canAttack&&e.onstage&&e.timer<=0&&dy<EKK.DEPTH-2?spacingFor(e,t,distance,stop,dt):null,goal=sp?sp.want:stop;
  const tb=bandOf(t.x);let targetY=once?e.y:flank&&!e.flankCooldown?clamp(t.y+(e.id>.5?28:-28),tb.top+3,tb.bottom-2):t.y;if(distance>goal-6)targetY=detourY(e,targetY);
  const sideX=distance>goal-6?null:detourX(e,targetY);
  e.moving=distance>goal-6||Math.abs(e.y-targetY)>2;e.backing=false;
  if(distance>goal-6)e.x+=e.dir*speed*dt;
  else if(sideX!=null)e.x=approach(e.x,sideX,speed*dt);
  e.y=approach(e.y,targetY,speed*.6*dt);
  // a poacher backs off a close target to shoot (today's rule), walking backwards on his fast crouch (main 30)
  if(e.type==='gunner'&&!once&&distance<107){e.x-=e.dir*speed*.7*dt;e.moving=true;e.backing=true;}
  // backing off to the next attack's window (spacingFor), on the walk at 0.7 speed, still facing the target
  else if(sp&&distance<sp.want-6){e.x-=e.dir*speed*.7*dt;e.moving=true;e.backing=true;}
  e.taunting=!e.moving&&!canAttack;
  if(canAttack&&e.onstage&&e.timer<=0&&(once||dy<EKK.DEPTH-2)){const a=chooseAttack(e,distance);if(a)startWindup(e,a,t);}
  if(lock&&e.onstage)e.x=clamp(e.x,lock.left+21,lock.right-31);const r=walkTo(ox,oy,e.x,e.y);e.x=r.x;e.y=r.y;
}
// BROOD MOTHER (the ch4 elite, CAMPAIGN §8.3): `submerge` (hidden and invulnerable 1.0 s, a 0.9 s ripple at the hero,
// then she bursts out there: r 63, 30; at most once every 12 s) and `brood` (her roar, main 4: two BLUDGE emerge
// beyond the lock edges, at most two alive). Both are spent from her attack cycle.
function broodMove(e){
  if(e.timer>0||!e.onstage)return false;const B=EK.regent?.brood||{},sub=B.submerge||{hidden:1,tell:.9,r:63,dmg:30,every:12};
  if(e.attackNo%4===3&&stageTimer-(e.subAt??-99)>=sub.every){e.attackNo++;e.subAt=stageTimer;e.state='submerged';e.timer=sub.hidden+sub.tell;e.subTell=sub.tell;e.subZone=false;e.inv=e.timer+.1;clearEnemyHazards(e.id);return true;}
  if(e.attackNo%5===2&&enemies.filter(o=>o.broodling&&!o.dead&&!o.dying).length<2){e.attackNo++;
    for(const [s,j] of [['L',0],['R',1]]){const m=arrive('mutant',s,j);m.broodling=true;m.delay=.4+j*.3;}
    const roar=stKey(e,'roar');e.state='recover';e.rec={key:roar,t0:0,len:keyLen(roar),then:null};e.timer=keyLen(roar)/60+.3;toast='THE BROOD COMES OUT OF THE WATER';toastTime=1.6;return true;}
  return false;
}
function submergedUpdate(e){
  const B=EK.regent?.brood?.submerge||{r:63,dmg:30};
  if(!e.subZone&&e.timer<=e.subTell){e.subZone=true;const b=bandOf(player.x);e.x=player.x;e.y=clamp(player.y,b.top,b.bottom);zones.push({owner:e.id,x:e.x,y:e.y,r:B.r||63,t:e.subTell,total:e.subTell,friendly:false,damage:B.dmg||30,air:false,style:'flood'});}
  if(e.timer<=0){e.state='recover';e.rec=null;e.timer=.45;e.inv=.2;}
}
// The Naguri vignette (CAMPAIGN §4.5): two Naguri drag a collared R HOPPER in from beyond the lock's right edge and beat
// it (Naguri main 2). They do not fight until one is hit; then both become the Hutori handlers of the same HUD name
// (HAMMER T.). The raptor calms and leaves once both captors are down.
function naguriThink(e){
  const cap=enemies.find(o=>o.id===e.captiveOf);if(cap)e.dir=Math.sign(cap.x-e.x)||e.dir;e.moving=false;
  if(!cap||cap.state!=='captive')provokeNaguri(e);
}
function provokeNaguri(e){for(const n of enemies)if(n.setPiece&&n.v==='N'&&n.captiveOf===e.captiveOf){setVariant(n,'A');n.setPiece=false;n.state='walk';n.timer=.4;}}
function captiveThink(e){
  e.moving=false;const captors=enemies.filter(o=>o.captiveOf===e.id&&!o.dead&&!o.dying);
  if(!captors.length){e.state='flee';e.timer=2;e.dir=1;e.setPiece=true;}
}
function spawnVignette(){
  const L=lock||{left:camera,right:camera+W},b=bandOf(L.right-90),y=b.top+b.h*.55,x=L.right+Math.max(70,entryReach('raptor','A')+ENTRY_PAD);
  const cap=spawnEnemy(x,y,'raptor');Object.assign(cap,{setPiece:true,captive:true,state:'enter',enterX:L.right-96,dir:-1,onstage:false,clone:false,from:1});
  [[-30,-10],[34,10]].forEach(([dx,dy],k)=>{const n=spawnEnemy(x+dx+24,clamp(y+dy,b.top+3,b.bottom-3),'brute');setVariant(n,'N');Object.assign(n,{setPiece:true,state:'enter',enterX:L.right-96+dx,dir:-1,onstage:false,captiveOf:cap.id,clone:false,from:1,delay:k*.2});});
}
// ZEKE (pteranodon, ENEMIES §3): a set piece that swoops from beyond either edge at the hero's head height across the
// hero's lane (fly 0, swoop 7), twice, then leaves; a jump or a lane change avoids it; one hit knocks it out of the sky
// (it flies off upward). While driving the swoop hits the car. Never counted as a fighter.
function spawnZeke(side){
  const L=lock||{left:camera,right:camera+W},off=Math.max(96,(EK?Math.max(...['fly','turn'].map(st=>animReach(EK.stateAnim('zeke','A',st,0)))):0)+ENTRY_PAD),x=side>0?L.right+off:L.left-off,b=bandOf(player.x);
  const e=spawnEnemy(x,clamp(player.y,b.top,b.bottom),'zeke');Object.assign(e,{setPiece:true,state:'swoop',dir:-side,z:driving?34:52,passes:0,onstage:true,clone:false,hitList:[]});return e;
}
function zekeUpdate(e,dt){
  const L=lock||{left:camera,right:camera+W};
  if(e.state==='flee'){e.z+=110*dt;e.x+=e.dir*150*dt;e.moving=true;if(e.z>220||e.x<L.left-140||e.x>L.right+140)e.remove=true;return;}
  e.moving=true;e.x+=e.dir*180*dt;const b=bandOf(e.x);e.y=approach(e.y,clamp(player.y,b.top,b.bottom),40*dt);
  const I=atkInfo(e,eTable(e)?.atk?.[0]);
  if(I)for(const v of multi()?hitPlayers():[player])if(!e.hitList.includes(v)&&Math.abs(e.x-v.x)<(driving?60:22)&&Math.abs(e.y-v.y)<(driving?21:14)&&v.z<(driving?99:12)){strike(v,I.dmg,e.x,true,hitOf(I));e.hitList.push(v);}
  if((e.dir>0&&e.x>L.right+110)||(e.dir<0&&e.x<L.left-110)){if(++e.passes>=2||!lock)e.remove=true;else{e.dir=-e.dir;e.hitList=[];}}
}
// Scenery actors (CAMPAIGN §4.5): archaeopteryx flocks and pteranodons in the sky, ankylosaurus / maiasaura herds behind
// the band, hatchlings scurrying through. ROM anims in their own maps, drawn in the sprite pass; no collision, no random
// call; off on easy like every set piece.
let scenery=[];
function spawnScenery(sec){
  if(!setPiecesOn()||!sec)return;const L=camera,b=bandOf(camera+W/2),sky=cameraY+56;   // sky actors fly under the HUD and radio rects (y 44-60)
  for(const id of sec.scenery||[]){
    // a flock: distant archaeopteryx flapping between their two far frames (0x5708C:0/1) and one small group (0x5674E:0)
    if(id==='flock'){for(let k=0;k<3;k++)scenery.push({id,type:'archaeopteryx',v:'A',keys:['0x5708C:0','0x5708C:1'],x:L+W+30+k*34,y:sky+14+(k%2)*11,z:0,vx:-58-k*4,t:k*5});scenery.push({id,type:'archaeopteryx',v:'B',key:'0x5674E:0',x:L+W+190,y:sky+22,z:0,vx:-66,t:9});}
    else if(id==='pteranodon-bg')scenery.push({id,type:'pteranodonBg',v:'A',key:'0x5326A:0',x:L+W+80,y:sky+22,z:0,vx:-48,t:0});
    else if(id==='herd')[['ankirosaurs','A','0x5F4F8:0',0],['maiasura','M','0x600E0:0',30],['ankirosaurs','A','0x5F4F8:0',62]].forEach(([type,v,key,dx],k)=>scenery.push({id,type,v,key,x:L-50-dx,y:b.top-3-k,z:0,vx:22,t:k*9}));
    else if(id==='hatchlings')for(let k=0;k<3;k++)scenery.push({id,type:'smallRaptor',v:'A',key:'0x4DBA0:3',x:L+W+Math.max(30,animReach('0x4DBA0:3')+ENTRY_PAD)+k*28,y:b.top+b.h*(.3+.25*k),z:0,vx:-150,t:k*5});
  }
}
function updateScenery(dt){
  for(const s of scenery){s.t+=dt*60;s.x+=s.vx*dt;
    if(s.id==='hatchlings')for(const p of multi()?present():[player])if(Math.abs(s.x-p.x)<60&&Math.abs(s.y-p.y)<24){s.vx=(s.x<p.x?-1:1)*180;break;}
    if(s.x<camera-160||s.x>camera+W+160)s.gone=true;}
  scenery=scenery.filter(s=>!s.gone);
}
function drawScenery(s){const a=eAnim(s.keys?s.keys[Math.floor(s.t/12)%s.keys.length]:s.key),F=ROME();if(!a||!F)return;const i=frameIdx(a,s.t);drawRomFrame(a.f[i][0],s.x-viewX,s.y-s.z,s.vx>0?1:-1,F.palMap[`${s.type}:${s.v}`]);}
// Speeds: a ROM kind walks at ENEMY_KINDS.kindSpeed (px/frame); bikes keep the sequel's 111 px/s screen-relative approach
// (their ROM 4.37 px/f is the road speed); bosses and hero copies as before.
const ENEMY_SPEED={brute:44,raptor:102,mutant:76,knifer:85,regent:81,slicer:71,biker:111};
function enemySpeed(e){
  const base=e.boss?e.phase===2?78:e.phase===3?87:59:e.type==='mirror'?HEROES[e.hero].speed*(e.elite?.72:.58):e.type==='biker'?ENEMY_SPEED.biker:romKind(e)?(EK.kindSpeed(e.type,e.v)||1.1)*60:ENEMY_SPEED[e.type]||70;
  return base*rules().enemySpeed*(e.rage>0&&!(e.rageWarning>0)?CFG.fx.rage.speed:1);
}
// The ROM walk speed (px/frame) the walk and run anims are timed for: their frames advance with the distance walked.
const romWalk=e=>Math.max(.3,EK.kindSpeed(e.type,e.v)||1);
function meleeDamage(e){return ['brute','mutant','regent'].includes(e.type)?24:e.type==='slicer'?22:e.type==='mirror'?e.elite?18:14:14;}
// Enemies go for whoever is closest: the player or a freed conscript.
function hostileTarget(e){if(multi())return hostileTargetMP(e);let best=player,bd=Math.hypot(player.x-e.x,(player.y-e.y)*1.4)*.85;for(const a of allies){if(a.hp<=0||a.state==='down'||a.state==='retreat')continue;const d=Math.hypot(a.x-e.x,(a.y-e.y)*1.4);if(d<bd){bd=d;best=a;}}return best;}
// 2-3 players (§3.7): the nearest player on the field (distance x0.85 as before), sticky (another must be under 0.7 x the
// current target's distance), and a player already fought by two or more others counts 48 px further for each one beyond
// the first (the crowd spreads over the players); freed conscripts as before
function hostileTargetMP(e){
  const C=active(),dist=p=>Math.hypot(p.x-e.x,(p.y-e.y)*1.4)*.85;let best=null,bd=1e9;
  for(const p of C){let d=dist(p);if(p!==e.tp){let n=0;for(const o of enemies)if(o!==e&&o.tp===p&&!o.dead&&!o.dying)n++;if(n>=2)d+=48*(n-1);}if(d<bd){bd=d;best=p;}}
  if(e.tp&&best!==e.tp&&C.includes(e.tp)){const d0=dist(e.tp);if(bd>=.7*d0){best=e.tp;bd=d0;}}
  if(!best){best=nearestPlayer(e.x,e.y)||localPlayer();bd=dist(best);}
  e.tp=best;let t=best;
  for(const a of allies){if(a.hp<=0||a.state==='down'||a.state==='retreat')continue;const d=Math.hypot(a.x-e.x,(a.y-e.y)*1.4);if(d<bd){bd=d;t=a;}}
  return t;
}
function markStage(e){if(!e.onstage&&(!lock||(e.x>lock.left+13&&e.x<lock.right-13)))e.onstage=true;}
// The first update in a new state (the clock's state change): a knockdown makes a knife man drop his knife (the arcade
// rule; he picks it up again after rising) and counts toward the dizzy rule.
function enemyStateEntered(e){
  if(e.state!=='recover')e.pendingShot=null;   // a hit during the poacher's lift cancels his shot
  if(e.state==='fly'&&!e.dying){
    if(e.type==='knifer'&&e.knife&&!onceThrower(e)){e.knife=false;drops.push({x:e.x-e.dir*10,y:e.y,type:'knife',life:60,loose:true,z:Math.max(24,e.z+20),vz:90,dir:-e.dir});}
    e.kd=(e.kd||[]).filter(t=>stageTimer-t<6);e.kd.push(stageTimer);
  }
}
const dropKey=e=>stKey(e,'fall')||stKey(e,'drop')||stKey(e,'leapDown')||stKey(e,'jump')||stKey(e,'rear')||stKey(e,'crouch')||stKey(e,'idle');
const landKey=e=>stKey(e,'emerge')||stKey(e,'land')||stKey(e,'crouch')||stKey(e,'idle');
const riseLen=e=>Math.max(.15,keyLen(stKey(e,'rise'))/60);
// The anim of the current state (ENEMIES §2.2): {key, t: ROM frames into it (hold: no loop) | dist: px per anim frame
// (walk and run, on distance) | k: a pinned frame ('last') | nothing: by time, looping}.
function resolveAnim(e){
  const S=k=>stKey(e,k),stF=(e.state!==e.ps?0:e.stT||0)*60;
  if(e.type==='biker')return {key:(e.v==='J'&&(e.state==='enter'||e.state==='charge')&&S('jumpIn'))||S('ride')};
  if(e.type==='zeke')return e.state==='flee'?{key:S('up')||S('fly')}:{key:Math.abs(e.x-player.x)<90?S('turn'):S('fly')};
  switch(e.state){
    // a corpse lies on the lie-still frame of its death anim (down 9 / 10 end on it; the body already fell on its fly
    // anim); TYROG's death anim (main 36) is its lying twitch and plays
    case 'dead':{if(e.type==='regent')return {key:S('dead'),t:stF};return {key:e.thrown&&S('deadThrown')||S('dead'),k:'last'};}
    case 'fly':{if(e.type==='raptor')return {key:S('fly'),t:stF,hold:true};const key=e.thrown?S('thrownLand'):e.flyHeld?S('flyHeld'):S('fly'),a=eAnim(key);if(!a)return null;
      if(e.flyHeld)return {key,t:stF,hold:true};return {key,k:e.bounces<1?0:Math.min(a.f.length-1,2)};}
    case 'down':{if(e.slam&&S('slam'))return {key:S('slam'),t:(e.slamT||0)*60,hold:true};if(e.type==='raptor')return {key:S('down'),k:'last'};
      return {key:e.thrown?S('thrownLand'):e.flyHeld?S('flyHeld'):S('fly'),k:'last'};}
    case 'rise':return e.riseFrom==='drop'?{key:landKey(e),t:stF,hold:true}:{key:S('rise'),t:stF,hold:true};
    case 'dizzy':return {key:S('dizzy')||S('idle')};
    case 'hurt':return {key:EK.stateAnim(e.type,e.v,'hurt',(e.hitChain+1)%2)||S('hurt'),t:stF,hold:true};
    case 'held':{const gp=multi()?players.find(p=>p&&p.grab&&p.grab.e===e)||player:player,g=gp?.grab,ms=gp?.moveState;
      if(g&&g.e===e&&ms&&ms.name==='knee'&&S('kneed'))return {key:S('kneed'),k:clamp(g.hits-1,0,4)};
      if(g&&g.e===e&&ms&&ms.name==='throw'){const key=EK.stateAnim(e.type,e.v,'thrown',0);if(key)return {key,k:clamp(ms.k|0,0,3)};}
      return {key:S('held'),k:0};}
    // side entries run in (the kind's run, else its walk; ENEMIES §2.4)
    case 'enter':return {key:S('run')||S('walk'),dist:romWalk(e)};
    case 'drop':return {key:dropKey(e),t:stF,hold:true};
    case 'pickup':return {key:S('pickup'),t:stF,hold:true};
    case 'roll':return {key:S('roll')||S('walk'),t:stF,hold:true};
    case 'flee':return e.sink?{key:S('crawl')||S('idle')}:{key:S('flee')||S('walk'),dist:romWalk(e)};
    case 'submerged':return null;
    case 'captive':return {key:Math.floor(time*1.6)%3===2&&S('hurt')||S('idle')};
    case 'windup':{const I=atkInfo(e,e.move);if(!I||!I.an)return {key:S('idle')};
      if(I.pre)return {key:I.pre,t:e.windT?Math.min(keyLen(I.pre)-.01,stF/60/e.windT*keyLen(I.pre)):stF,hold:true};
      const span=I.kind==='leap'?I.crouch:I.hitT;if(span<=0)return {key:I.key,k:0};
      return {key:I.key,t:Math.min(span-.01,e.windT?stF/60/e.windT*span:stF/telegraph()),hold:true};}
    case 'recover':{const r=e.rec;if(r){if(stF<r.len)return {key:r.key,t:r.t0+stF,hold:true};if(r.then&&stF<r.len+r.then.f)return {key:r.then.key,t:stF-r.len,hold:true};}
      return {key:e.taunting&&S('taunt')||S('idle')};}
    case 'charge':{const I=atkInfo(e,e.move);return I?{key:I.key,t:I.hitT+stF}:{key:S('walk'),dist:romWalk(e)};}
    case 'leap':{if(e.evade)return {key:EK.resolve(e.type,e.v,eTable(e)?.evade),t:stF,hold:true};const I=atkInfo(e,e.move);return I?{key:I.key,t:(I.pre?0:I.crouch)+stF,hold:true}:{key:S('idle')};}
  }
  // walk, intro: walking frames by distance (backing off: the fast crouch), else idle or the taunt at the stop
  if(e.setPiece&&e.v==='N')return {key:S('beat')||S('idle')};
  if(e.moving&&(S('walk')||S('run')))return {key:e.backing&&S('walkFast')||S('walk')||S('run'),dist:romWalk(e)};
  return {key:e.taunting&&S('taunt')||S('idle')};
}
// Advances the anim of a ROM enemy (dt 0 = resolve the frame for drawing). Hitstop holds the frame.
function animateEnemy(e,dt,moved){
  if(NETROLE==='client'||!romKind(e)&&e.type!=='zeke')return;   // a replica shows the host's frame (fid)
  if(e.freeze>0)dt=moved=0;
  const r=resolveAnim(e),a=r&&eAnim(r.key);if(!a){e.ak=null;e.fid=null;return;}
  if(r.key!==e.ak){e.ak=r.key;e.aF=0;}
  let i;
  if(r.k!=null)i=r.k==='last'?a.f.length-1:Math.min(a.f.length-1,r.k);
  else if(r.t!=null)i=frameIdx(a,r.t,r.hold);
  else{e.aF+=r.dist?moved/r.dist:dt*60;i=frameIdx(a,e.aF);}
  e.af=i;e.fid=a.f[i][0];
}
function updateEnemy(e,dt) {
  const ox=e.x,oy=e.y;   // walking moves resolve from here over the walk mask (walkTo)
  if(e.waiting){if(enemies.filter(v=>v!==e&&!v.dead&&!v.dying&&!v.waiting&&v.state!=='flee'&&!v.setPiece).length>=crowdLimit())return;e.waiting=false;}
  e.rageCooldown=Math.max(0,(e.rageCooldown||0)-dt);e.rage=Math.max(0,(e.rage||0)-dt);e.rageWarning=Math.max(0,(e.rageWarning||0)-dt);e.rammed=Math.max(0,(e.rammed||0)-dt);
  if(rules().dinosaurRage&&e.type==='raptor'&&!e.boss&&!e.setPiece&&e.onstage&&!e.dead&&!e.dying&&e.hp<e.maxhp*CFG.fx.rage.threshold&&e.state==='walk'&&!e.rageCooldown){e.rage=CFG.fx.rage.duration+CFG.fx.rage.warning;e.rageWarning=CFG.fx.rage.warning;e.rageCooldown=CFG.fx.rage.cooldown;toast='DINOSAUR RAGE · KEEP YOUR DISTANCE';toastTime=1.6;}
  if(e.rageWarning>0)return;
  if(e.freeze>0){e.freeze-=dt;e.inv=Math.max(0,e.inv-dt);e.hurt=Math.max(e.hurt,.02);return;}
  // the per-state clock (ENEMIES §2.2): seconds in the current state, held by hitstop (above)
  if(e.state!==e.ps){e.ps=e.state;e.stT=0;if(romKind(e))enemyStateEntered(e);}e.stT+=dt;
  e.anim+=dt;e.strikeFlash=Math.max(0,(e.strikeFlash||0)-dt);e.moving=false;e.hurt=Math.max(0,e.hurt-dt);e.inv=Math.max(0,e.inv-dt);e.hitTimer=Math.max(0,e.hitTimer-dt);
  if(e.delay>0){e.delay-=dt;return;}
  if(e.type==='zeke'){zekeUpdate(e,dt);return;}
  const R=romKind(e);
  const tempo=e.state==='walk'?(e.boss?rules().bossTempo:rules().aggression):['recover','down','hurt'].includes(e.state)?(e.boss?rules().bossTempo:1/rules().recovery):1;
  e.timer-=dt*tempo;
  if(e.dead){if(e.boss&&e.defeat)bossDeadTick(e,dt);e.dead-=dt;if(e.dissolve&&!(e.boss&&e.defeat)&&Math.random()<dt*16)particles.push({x:e.x+rand(-12,12),y:e.y-rand(6,52),vx:rand(-9,9),vy:rand(-59,-26),life:rand(.4,.8),size:rand(2,4),color:'#8ff0b8',float:true});if(e.dead<=0)e.remove=true;return;}
  if(e.state==='flee'){
    if(e.sink){if(e.timer<=0)e.remove=true;return;}
    // a hit-and-run thrower runs back off screen the way he came; a calmed dinosaur trots off to the right (as before)
    if(e.exitDir){const L=lock||{left:camera,right:camera+W};e.dir=e.exitDir;e.x+=e.exitDir*Math.max(150,enemySpeed(e))*dt;e.moving=true;if(e.x<L.left-70||e.x>L.right+70||e.timer<=0)e.remove=true;return;}
    e.x+=215*dt;e.dir=1;e.moving=true;if(e.timer<=0)e.remove=true;return;}
  if(e.state==='enter'){e.dir=Math.sign(e.enterX-e.x)||e.dir;e.x=approach(e.x,e.enterX,enemySpeed(e)*(R&&onceThrower(e)?1:1.3)*dt);e.moving=true;markStage(e);if(Math.abs(e.x-e.enterX)<1){e.state=e.captive?'captive':'walk';e.timer=rand(.35,.8);e.onstage=true;}return;}
  if(e.state==='held')return;
  if(e.state==='fly'){
    e.x+=(e.vx||0)*dt;e.vz-=852*dt;e.z+=e.vz*dt;e.spin=(e.spin||0)+dt;if(lock&&e.onstage)e.x=clamp(e.x,lock.left+9,lock.right-18);
    // A thrown body bowls over anyone standing in its path.
    if(e.thrown&&e.z<70)for(const o of enemies)if(o!==e&&!o.dead&&!o.dying&&!o.boss&&!o.setPiece&&!['fly','held','down'].includes(o.state)&&o.inv<=0&&Math.abs(o.x-e.x)<25&&Math.abs(o.y-e.y)<16)damageEnemy(o,HEROES[selected].power*1.3,Math.sign(e.vx)*22,true,false,{heavy:true});
    if(e.z<=0){e.z=0;
      if(e.bounces++<1){e.vz=Math.abs(e.vz)*.2+30;e.vx*=.3;sfx('slam');shake=Math.max(shake,e.thrown?8:4);burst(e.x,e.y-3,'#b9b28f',9);}
      // ROM bodies lie 80 f and blink out over 60 f (ENEMIES §2.3); the Mirror Test cross-fades to gel over 0.75 s instead.
      else{e.vx=0;if(e.dying){e.dead=e.dissolve?.75:R?140/60:1;e.state='dead';}else{e.state='down';e.timer=e.elite?.55:.8;e.inv=Math.max(e.inv,.6);e.slam=false;}}}
    return;
  }
  if(e.state==='drop'){e.vz-=667*dt;e.z=Math.max(0,e.z+e.vz*dt);if(e.z<=0){e.state='rise';e.riseFrom='drop';e.timer=R?Math.max(.15,keyLen(landKey(e))/60):.28;burst(e.x,e.y,'#8b9470',6);shake=Math.max(shake,2);}return;}
  // Bosses run their BOSS_DEFS fight (the boss driver above): intro, moves, arena, knockdowns, Crownback's parts, Breakwater's road.
  if(e.boss){updateBoss(e,dt,ox,oy);return;}
  if(e.state==='intro'){if(e.enterX!==undefined){e.x=approach(e.x,e.enterX,(e.type==='truck'?193:111)*dt);e.moving=Math.abs(e.x-e.enterX)>1;}if(e.timer<=0){e.state='walk';e.timer=e.boss?.45:.65;e.onstage=true;}return;}
  markStage(e);
  if(e.state==='submerged'){submergedUpdate(e);return;}
  // ROM: rise = the get-up anim's length (FERRIS 25 f, HAMMER T. 16, POACHER and BLADE 20, TYROG 33, BLUDGE 35);
  // the third knockdown within 6 s leaves a ROM enemy dizzy for 1.2 s after it (ENEMIES §2.3 option, on).
  if(e.state==='down'){if(e.slam)e.slamT=(e.slamT||0)+dt;if(e.timer<=0){e.state='rise';e.riseFrom='down';e.slam=false;e.timer=R?riseLen(e):.32;e.inv=Math.max(e.inv,e.timer);}return;}
  if(e.state==='rise'){if(e.timer<=0){if(R&&(e.kd||[]).length>=3&&hasSt(e,'dizzy')){e.kd=[];e.state='dizzy';e.timer=1.2;}else{e.state='walk';e.timer=e.boss?.45:.65;}}return;}
  // an aimed shot leaves on its fire frame, the lift after the windup (romStrike; ROM pace, held by hitstop above)
  if(e.state==='recover'&&e.pendingShot){e.pendingShot.t-=dt;if(e.pendingShot.t<=1e-6||e.timer<=0){e.pendingShot=null;const I=atkInfo(e,e.move);if(I)enemyShot(e,I);}}
  if(['transform','recover','dizzy'].includes(e.state)){if(e.timer<=0){e.state='walk';e.timer=e.boss?.45:.65;e.rec=null;}return;}
  if(e.state==='pickup'){if(e.timer<=0){const d=e.seekDrop;if(d&&drops.includes(d)&&!d.claimed){drops.splice(drops.indexOf(d),1);e.knife=true;}e.seekDrop=null;e.state='walk';e.timer=.3;}return;}
  if(e.hurt>0)return;
  if(e.state==='hurt'){if(e.timer<=0){e.state='walk';e.timer=.55;}return;}
  if(e.state==='windup'){
    if(e.timer<=0){if(R)romStrike(e);else{
      const v=e.target&&(e.target===player||isLiveP(e.target)||allies.includes(e.target))?e.target:player;
      if(e.action==='rush'){e.state='charge';e.timer=.55;e.vx=e.dir*(e.type==='mirror'?281:e.type==='biker'?252:222);e.hitList=[];return;}
      if(['gunner','biker'].includes(e.type)){const reach=e.type==='gunner'?49:22;shoot(e.x+e.dir*reach,e.y,e.dir,false,14,252,e.id);if(e.type==='gunner'&&!driving)effects.push({type:'muzzle',x:e.x+e.dir*reach,y:e.y-46,dir:e.dir,age:0,life:.07});sfx('enemygun');}
      else if(e.action==='knife'){bullets.push({x:e.x+e.dir*22,y:e.y,z:36,vx:e.dir*244,vy:0,friendly:false,damage:17,owner:e.id,life:1.5,kind:'thrown',weapon:'knife',age:0});}
      else if(e.action==='leap'){e.state='leap';e.timer=.85;e.startX=e.x;e.startY=e.y;e.targetX=clamp(v.x,(lock?.left??camera)+30,(lock?.right??camera+W)-30);e.targetY=v.y;return;}
      else{e.strikeFlash=.2;if(Math.abs(e.x-v.x)<(e.elite?70:63)&&Math.abs(e.y-v.y)<26)strike(v,meleeDamage(e)*(e.rage>0?CFG.fx.rage.damage:1),e.x);}
      e.state='recover';e.timer=e.type==='brute'?.8:e.elite?.45:.5;
    }}return;
  }
  if(e.state==='leap'){
    if(R){romLeap(e);return;}
    const p=clamp(1-e.timer/.85,0,1);e.x=e.startX+(e.targetX-e.startX)*p;e.y=e.startY+(e.targetY-e.startY)*p;e.z=Math.sin(p*Math.PI)*(e.boss?89:59);
    if(e.timer<=0){e.z=0;zones.push({owner:e.id,x:e.x,y:e.y,r:e.boss?67:46,t:.12,total:.12,friendly:false,damage:e.boss?28:20,air:true});e.state='recover';e.timer=e.boss?1.3:.8;}return;
  }
  if(e.state==='charge'){
    if(R){romCharge(e,dt);return;}
    e.x+=e.vx*dt;
    for(const v of fighters()){if(e.hitList?.includes(v))continue;if(Math.abs(e.x-v.x)<(e.type==='truck'?81:56)&&Math.abs(e.y-v.y)<27){strike(v,(e.boss?28:e.type==='mirror'?20:24)*(e.rage>0?CFG.fx.rage.damage:1),e.x-e.dir*44);(e.hitList||(e.hitList=[])).push(v);}}
    if(lock)e.x=clamp(e.x,lock.left+22,lock.right-31);
    if(e.timer<=0){e.state='recover';e.timer=e.boss?1.35:.9;}return;
  }
  // the poacher's forward roll (romThink): no contact damage; on landing he attacks at once
  if(e.state==='roll'){e.x+=e.vx*dt;e.moving=true;if(lock)e.x=clamp(e.x,lock.left+21,lock.right-31);{const r=walkTo(ox,oy,e.x,e.y);e.x=r.x;e.y=r.y;}if(e.timer<=0){e.state='walk';e.timer=0;}return;}
  if(e.state==='captive'){captiveThink(e);return;}
  // Anyone still outside the locked screen (for example knocked back while entering) walks straight back in.
  if(!e.onstage&&lock){const inside=e.x>lock.right?lock.right-52:lock.left+52;e.dir=Math.sign(inside-e.x)||e.dir;e.x=approach(e.x,inside,enemySpeed(e)*1.2*dt);e.moving=true;markStage(e);return;}
  if(R){romThink(e,dt,ox,oy);return;}
  const t=e.boss?player:hostileTarget(e);
  e.dir=Math.sign(t.x-e.x)||e.dir;const distance=Math.abs(t.x-e.x),dy=Math.abs(t.y-e.y);
  // Hero copies keep the sequel's AI (bosses run the boss driver, G5).
  const speed=enemySpeed(e),range=e.type==='gunner'?174:e.type==='biker'?132:e.boss?(e.type==='fessenden'?111:89):39;
  const flank=!e.boss&&e.id<rules().flankChance&&enemies.some(o=>o!==e&&!o.dead&&!o.waiting&&!o.setPiece&&Math.abs(o.x-t.x)<rules().flankDistance&&Math.abs(o.y-t.y)<18);
  const canAttack=e.boss||enemies.filter(o=>o!==e&&!o.dead&&['windup','charge','leap'].includes(o.state)).length<rules().attackSlots;
  e.flankCooldown=Math.max(0,(e.flankCooldown||0)-dt);
  if(rules().flankRear&&flank&&!e.flankRoute&&!e.flankCooldown&&distance<119){e.flankRoute={side:Math.sign(e.x-t.x)||1,ttl:1.4};e.flankCooldown=3.5;}
  if(e.flankRoute){
    const fb=bandOf(t.x),route=e.flankRoute,tx=clamp(t.x-route.side*53,(lock?.left??camera)+24,(lock?.right??camera+W)-31),ty=clamp(t.y+(e.id>.5?33:-33),fb.top+3,fb.bottom-2);
    route.ttl-=dt;e.x=approach(e.x,tx,speed*1.18*dt);e.y=approach(e.y,ty,speed*.8*dt);e.moving=true;{const r=walkTo(ox,oy,e.x,e.y);e.x=r.x;e.y=r.y;}
    if(Math.abs(e.x-tx)<6||route.ttl<=0){e.flankRoute=null;e.timer=Math.min(e.timer,.12);}return;
  }
  const tb=bandOf(t.x);let targetY=flank&&!e.flankCooldown?clamp(t.y+(e.id>.5?28:-28),tb.top+3,tb.bottom-2):t.y;if(distance>range-6)targetY=detourY(e,targetY);
  e.moving=distance>range-6||Math.abs(e.y-targetY)>2;
  if(distance>range-6)e.x+=e.dir*speed*dt;
  e.y=approach(e.y,targetY,speed*.6*dt);
  if(canAttack&&e.onstage&&!e.boss&&e.timer<=0&&dy<24){
    const lunge=e.type==='mirror'&&e.elite&&distance>81&&distance<200;
    const leap=e.type==='mirror'&&e.elite&&distance>104&&distance<222&&e.attackNo%3===2;
    if(leap){e.action='leap';e.state='windup';e.timer=.6;e.target=t;e.attackNo++;return;}
    if(lunge){e.action='rush';e.state='windup';e.timer=.55;e.target=t;e.attackNo++;return;}
  }
  if(canAttack&&e.onstage&&e.timer<=0&&distance<range+19&&dy<(e.boss?96:24)){e.target=t;e.action='melee';e.state='windup';e.timer=e.elite?.3:.38;e.attackNo++;}
  if(lock&&e.onstage)e.x=clamp(e.x,lock.left+21,lock.right-31);const r=walkTo(ox,oy,e.x,e.y);e.x=r.x;e.y=r.y;
}

function gamepad(){const pads=navigator.getGamepads?.()||[];const p=Array.from(pads).find(Boolean);if(!p){padKeys.clear();return;}const map=['KeyK','KeyE','KeyJ','KeyL'];for(let i=0;i<4;i++){if(p.buttons[i]?.pressed){if(!padKeys.has(map[i]))pressed.add(map[i]);padKeys.add(map[i]);}else padKeys.delete(map[i]);}for(const [key,on] of [['ArrowLeft',p.axes[0]<-.3||p.buttons[14]?.pressed],['ArrowRight',p.axes[0]>.3||p.buttons[15]?.pressed],['ArrowUp',p.axes[1]<-.3||p.buttons[12]?.pressed],['ArrowDown',p.axes[1]>.3||p.buttons[13]?.pressed]]){if(on)padKeys.add(key);else padKeys.delete(key);}if(p.buttons[9]?.pressed&&!gamepad.pauseHeld)pause();gamepad.pauseHeld=p.buttons[9]?.pressed;}
const down=(...ks)=>ks.some(k=>IN.keys.has(k)||IN.pad.has(k)),tap=(...ks)=>ks.some(k=>IN.pressed.has(k));
// One step of the hero being processed (MULTIPLAYER §3.4a): timers, input, movement and the first clamp, band and hazard
// slides, landing, grabs, moves, strikes and the buttons. With 2-3 players it runs once per player in slot order, in
// that player's context; a player in a continue count or out runs its count instead, a passenger rides in the car.
function controlStep(dt){
  const m=player.mp;
  if(m&&(m.cont||m.out)){mpDownStep(dt);return;}
  if(m&&passenger(player)){passengerStep(dt);return;}
  const h=HEROES[selected];if(!down(dashKey))dashTime=0;
  const frozen=player.freeze>0;
  for(const k of ['inv','hurt','attack','special','specialCd','boost','boostCd','land','freeze','comboWin','grabCd'])if(!(frozen&&k==='attack'))player[k]=Math.max(0,player[k]-dt);
  player.shotT+=dt;if(player.stunT>0){player.stunT-=dt;if(player.stunT<=0)player.stun=10;}
  if(player.dying&&player.hurt<=0)startDropIn();if(player.hurt<=0)player.knocked=false;
  // Jack's dash slides for its whole clip (27 f) and then recovers on dashEnd (the hopping heroes end theirs on landing).
  if(player.attackKind==='dash'&&player.dashPhase==='dash'&&!frozen){player.dashT+=dt;if(player.attack<=0||(selected===1&&player.dashT>=heroClipLen('dash',.45)-1e-9))endDash();}
  updatePickup(dt);
  let dx=(down('ArrowRight','KeyD')?1:0)-(down('ArrowLeft','KeyA')?1:0),dy=(down('ArrowDown','KeyS')?1:0)-(down('ArrowUp','KeyW')?1:0);
  // KI22 (mechanics VERIFY #2): a double-tap run goes on after the stick is released, until the opposite direction
  // (which walks), a hit, a pickup, a grab, a special, an attack (run + attack is the dash) or the car. Vertical input
  // steers it. Each double-tap latches once (dashTap), so holding the key after a dash runs as before but no longer
  // latches. Shift and the touch stick's rim stay plain run modifiers. CFG.runPersist=false restores the old rule.
  if(driving||CFG.runPersist===false)player.runLatch=0;
  else{
    if(player.runLatch&&(dx===-player.runLatch||player.hurt>0||player.grab||player.special>0||player.pickup>0||player.dropIn))player.runLatch=0;
    const tapDir=dashTime>0&&down(dashKey)?(dashKey==='ArrowRight'||dashKey==='KeyD'?1:-1):0;
    if(tapDir&&dx===tapDir&&player.latchTap!==dashTap&&player.hurt<=0&&player.pickup<=0&&!player.grab){player.runLatch=dx;player.latchTap=dashTap;}
    if(player.runLatch&&!dx)dx=player.runLatch;
  }
  // Running is a horizontal sprint; lane changes while running are slower so the stride stays readable.
  player.run=!driving&&!!dx&&player.pickup<=0&&(down('ShiftLeft','ShiftRight','TouchRun')||(dashTime>0&&down(dashKey))||dx===player.runLatch);player.move=!!(dx||dy);
  if(dx&&player.attack<=0&&player.pickup<=0&&!player.grab){if(player.dir!==dx)player.turnAt=time;player.dir=dx;}
  const px=player.x,py=player.y;
  player.walkFire=false;if(driving||player.hurt>0)player.pushV=0;
  if(driving)updateCar(dt,dx,dy,bossIntro<=0&&!frozen);
  else if(player.hurt<=0&&player.special<=0&&bossIntro<=0&&player.pickup<=0&&!frozen&&!player.grab&&!player.dropIn){
    // The Uzi and M-16 burst walks (ROM state 0x1E, HEROES §7.4): while their fire state lasts and a horizontal direction
    // is held, the hero walks at walk speed, still facing his fire (smgWalkFire torso over legsWalk); every other attack
    // on the ground holds him in place.
    const walkFire=player.attack>0&&player.attackKind==='fire'&&player.z<=0&&!!dx&&BURST_CLS.has(rigClass(player.weapon));
    if(walkFire){player.walkFire=true;player.run=false;}
    const V=heroV(h),speed=player.run?FIREARMS.has(player.weapon)?V.walk*1.5:V.run:V.walk,lane=V.lane*(player.run?.5:1);
    const drag=player.attack>0&&player.z<=0&&!walkFire?0:1;
    player.x+=dx*speed*drag*dt;player.y+=dy*lane*drag*dt;
    if(dx&&dy&&!player.run){player.x-=dx*speed*drag*dt*.22;player.y-=dy*lane*drag*dt*.22;}
    if(player.attack>0&&player.attackKind==='dash'){player.x+=(player.dashVelocity||0)*dt;player.dashVelocity=approach(player.dashVelocity,0,444*dt);}
    // The bazooka shot pushes the hero back over the next frames (ROM 0x19CD8: vx 8/10/12/6 px/f braking 1 px/f² before
    // each step, so v(v-1)/2 = 28/45/66/15 px; HEROES §7.6), never past 24 px inside a locked arena's edges; a hit stops it.
    if(player.pushV){player.pushV=approach(player.pushV,0,(player.pushA||3600)*dt);let nx=player.x+player.pushV*dt;if(lock){const lo=lock.left+24,hi=lock.right-24;nx=player.pushV<0?Math.max(nx,Math.min(player.x,lo)):Math.min(nx,Math.max(player.x,hi));}player.x=nx;}
  }
  const tx=player.x;clampPlayer(true,px,py);
  // Pushing into a band step (a floor edge whose lane does not hold the hero's y) slides the hero toward the next floor's
  // lane at lane speed instead of stopping dead against it; pushing into a hazard rect (a pit, a water edge) slides him
  // the same way toward its nearer edge (G4: the bot, like a player holding right, was stuck at ch4 a1's pit).
  if(!driving&&dx&&Math.abs(player.x-tx)>.01&&Math.abs(player.x-px)<.01){const nb=bandOf(px+dx*16),hz=hazardAt(px+dx*14,player.y);let ty=null;
    if(player.y<nb.top||player.y>nb.bottom)ty=clamp(player.y,nb.top+1,nb.bottom-1);
    else if(hz){const b=bandOf(px),o=[hz[1]-2,hz[1]+hz[3]+2].filter(v=>v>=b.top&&v<=b.bottom).sort((p,q)=>Math.abs(p-player.y)-Math.abs(q-player.y));if(o.length)ty=o[0];}
    if(ty!=null){const r=walkTo(player.x,player.y,player.x,approach(player.y,ty,heroV(h).lane*dt),{cam:{x:camera,y:cameraY},lock});player.y=r.y;}}
  // ...and pushing straight up or down into one slides him along it toward its nearer x edge (G4 fix pass: the bot, held
  // up in the strip under ch4 a2's pit with a valve beyond it, stood there for good).
  if(!driving&&dy&&!dx&&player.z===0&&Math.abs(player.y-py)<.01){const hz=hazardAt(player.x,player.y+dy*4);
    if(hz){const L=lock||{left:camera,right:camera+W},o=[hz[0]-3,hz[0]+hz[2]+3].filter(x=>x>L.left+16&&x<L.right-16).sort((p,q)=>Math.abs(p-player.x)-Math.abs(q-player.x));
      if(o.length){const r=walkTo(player.x,player.y,approach(player.x,o[0],heroV(h).walk*dt),player.y,{cam:{x:camera,y:cameraY},lock});player.x=r.x;}}}
  const mx=player.x,my=player.y;
  const moved=Math.hypot(player.x-px,player.y-py);player.roll+=player.x-px;
  if(player.run&&player.z===0){const before=player.runDist;player.runDist+=moved;if(Math.floor(player.runDist/50)>Math.floor(before/50))particles.push({x:player.x-player.dir*10,y:player.y-3,vx:-player.dir*rand(15,37),vy:-rand(11,26),life:.35,size:rand(3,5),color:'#b9b28f',float:true});}
  else if(player.move)player.walkDist+=moved;
  // Landing (HEROES §6.1 row 16, §6.5): the land clip (main:6, 7-10 f), or landHard (main:30, 18-22 f) after an air
  // attack, which ends with the landing; a hopping dash lands into dashEnd; the drop-in hands control back.
  if(player.z>0&&!frozen){player.vz-=630*dt;player.z+=player.vz*dt;if(player.z<=0){player.z=0;player.vz=0;
    if(player.attackKind==='dash'&&player.dashPhase==='dash'&&player.attack>0)endDash();
    else{const hard=player.airAttacked;player.landRole=hard?'landHard':'land';player.land=player.landTotal=heroClipLen(player.landRole,hard?.3:.1);player.airAttacked=false;}
    player.dropIn=false;if(player.attackKind==='air'){player.attack=0;player.pendingStrike=null;}burst(player.x,player.y,'#8b9470',4);}}
  // an armed hero's dash and jump kick strike on their clips (D9); any other pending strike ends with a weapon in hand
  if(player.weapon&&player.attackKind!=='dash'&&player.attackKind!=='air')player.pendingStrike=null;
  updateGrab(dt,dx);updateMove(dt);
  // A stab or a swing lands on its event frame (resolveSwing); dash and air attacks strike on the active frames of their
  // clip (pendingStrike.role), once per target, and the strike ends after the clip's last active frame.
  if(player.swing&&!frozen){player.swing.t-=dt;if(player.swing.t<=1e-9)resolveSwing();}
  if(player.pendingStrike&&!frozen){const hit=player.pendingStrike;hit.t+=dt;const tm=heroClipTiming(hit.role);
    let on,over;if(tm){const k=heroFrameAt(tm,hit.t),last=tm.f.reduce((n,f,i)=>f[5]?i:n,-1);on=!!tm.f[k][5];over=k>last;}else{on=hit.t>=.08;over=hit.t>=.42;}
    if(on)meleeStrike(hit.range,hit.power,hit.down,hit.struck,{melee:true,heavy:true});if(over)player.pendingStrike=null;}
  if(tap('KeyJ','KeyZ','Space')&&tap('KeyK','KeyX'))special();
  else{if(down('KeyJ','KeyZ','Space'))attack();if(tap('KeyK','KeyX'))jump();}
  if(tap('KeyL','KeyC'))special();if(tap('KeyE','KeyV'))pickup();if(tap('Enter','NumpadEnter'))insertCoin();
  updateBurst(dt);updateEmptyGun();
  if(m){m.mx=mx;m.my=my;m.moved=moved;if(m.tag>0)m.tag=Math.max(0,m.tag-dt);}
}
// the joiners' attack / jump presses advance the chapter card and the ending's boxes too (the cabinet's any-start rule)
function remoteAdvance(fn){if(!multi())return;for(const p of present()){const I=p.mp.in;if(I&&I!==LOCAL_IN&&['KeyJ','KeyK','KeyZ','KeyX','Space'].some(k=>I.pressed.has(k)))fn();}}
function clearPresses(){pressed.clear();for(const p of players)if(p&&p.mp.in&&p.mp.in!==LOCAL_IN)p.mp.in.pressed.clear();}
// the first player (slot order) close enough to eat a drop; in the car the driver scoops it up
function dropEater(d){
  for(const p of multi()?present():[player]){if(multi()&&(!onField(p)||passenger(p)))continue;
    if(driving?Math.abs(d.x-p.x)<81&&Math.abs(d.y-p.y)<24:Math.hypot(d.x-p.x,d.y-p.y)<20)return p;}
  return null;}
// a new driver (the old one went into a continue count or left) takes over the car where it is, without stopping
function mpDriver(){if(!driving){lastDriver=null;return;}const d=driverP();
  if(lastDriver&&d!==lastDriver){for(const k of ['x','y','vx','vy','bank','roll','dir','boost'])d[k]=lastDriver[k];d.z=0;d.dropIn=false;}lastDriver=d;}
function update(dt) {
  // At a chapter clear the hero holds the ROM victory pose behind the clear panel (HEROES §6.6; victoryT runs the clip).
  time+=dt;music(dt);if(state==='continue'){updateContinue(dt);return;}if(state!=='play'){if(state==='clear'&&player)for(const p of multi()?present():[player])if(p.victoryT!=null)p.victoryT+=dt;if(state==='clear')for(const e of enemies)if(e.boss&&e.defeat&&e.dead>0)bossDeadTick(e,dt);
    // the presentation screens run on the update's frames (G6): the title's idle count into the attract story, the
    // chapter card and its panels, the clear tally, the ending beats and the staff roll
    if(state==='menu'){if(lobbyOpen())menuIdle=0;else menuIdle+=dt;if(menuIdle>=MENU_IDLE&&SEQUEL_RENDER.ready&&!document.hidden&&(window.EDEN_INTRO||[]).length)attract();}
    else if(state==='attract')updateAttract(dt);else if(state==='brief'){remoteAdvance(cardAdvance);updateCard(dt);}else if(state==='clear')updateClear(dt);else if(state==='ending'){remoteAdvance(endAdvance);updateEnding(dt);}else if(state==='credits')rollT+=dt*60;
    clearPresses();return;}gamepad();if(state!=='play')return;
  if(fade){updateFade(dt);clearPresses();return;}
  if(caption){caption.t+=dt*60;if(caption.t>=CAPTION_FRAMES)caption=null;}
  stageTimer+=dt;runTime+=dt;bossIntro=Math.max(0,bossIntro-dt);
  const camBefore=camera,L0=ctxPlayer;
  try{
  if(multi()){mpDriver();for(const p of players)if(p)withPlayer(p,()=>controlStep(dt));}else controlStep(dt);
  updateMission(dt);
  for(const d of [...drops]){d.life-=dt;
    // a weapon knocked loose pops out of the hand and falls back (drawn spinning until it lands, drawDrop)
    if(d.vz!=null){d.vz-=630*dt;d.z=(d.z||0)+d.vz*dt;if(d.z<=0){d.z=0;d.vz=null;}}
    // On the highway, dropped food slides back with the road stream; the Cadillac scoops it up by driving over it.
    if(driving){d.x-=roadRate*dt;if(d.x<camera-67){drops.splice(drops.indexOf(d),1);continue;}}
    // food, score items and ammunition go to the first player in reach (slot order, §3.8)
    const eater=PICKUPS.has(d.type)&&!d.claimed?dropEater(d):null;
    if(eater){if(eater===player)consumeItem(d);else withPlayer(eater,()=>consumeItem(d));}else if(d.life<=0&&!d.claimed)drops.splice(drops.indexOf(d),1);}
  // The Mirror Test and the freed conscripts run their ROM clips after their own update, walk clips by the distance moved (G3b;
  // drawing only, no random call).
  // ROM enemies advance their anim clock after their update too (animateEnemy: walk frames by the distance walked).
  // 2-3 players: each enemy runs in the context of the player it fights (§3.5 T, §3.7)
  if(multi()){for(const e of enemies){const ox=e.x,oy=e.y;withPlayer(targetPlayerOf(e),()=>{updateEnemy(e,dt);const moved=Math.hypot(e.x-ox,e.y-oy);if(e.type==='mirror')animateClone(e,dt,moved);else animateEnemy(e,dt,moved);});}}
  else for(const e of enemies){const ox=e.x,oy=e.y;updateEnemy(e,dt);const moved=Math.hypot(e.x-ox,e.y-oy);if(e.type==='mirror')animateClone(e,dt,moved);else animateEnemy(e,dt,moved);}
  enemies=enemies.filter(e=>!e.remove);
  updateScenery(dt);
  for(const a of allies){const ox=a.x,oy=a.y;updateAlly(a,dt);animateConscript(a,dt,Math.hypot(a.x-ox,a.y-oy));}allies=allies.filter(a=>!a.remove);
  if(driving){if(multi())withPlayer(driverP(),ramEnemies);else ramEnemies();}
  updateProjectiles(dt);updateDiscards(dt);updateBossObjects(dt);updateWheels(dt);if(bossCard){bossCard.t-=dt;if(bossCard.t<=0)bossCard=null;}
  for(const z of zones){if(z.cancelled||!z.linger)continue;z.tick-=dt;if(z.tick<=0){z.tick=.5;for(const v of fighters())if(Math.hypot((v.x-z.x)*.8,v.y-z.y)<z.r&&v.z<19)strike(v,z.damage,z.x,false,{stun:2,react:0});}}
  for(const z of zones){if(z.cancelled)continue;z.t-=dt;if(z.lane||z.mark)continue;if(z.linger){if(z.t<=0)z.cancelled=true;continue;}if(z.band&&z.t<=0){for(const v of fighters())if(v.y>=z.band[0]-2&&v.y<=z.band[1]+2&&(!z.air||v.z<19))strike(v,z.damage,v.x+20,!z.air,z.knock?{stun:10,react:10}:null);burst(z.x,z.band[1]-8,'#c9f1ff',24);shake=7;continue;}if(z.t<=0){const quiet=['land','steam','slam','fire','flood'].includes(z.style);burst(z.x,z.y-15,z.friendly?'#efb36d':z.style==='fire'?'#ff9a3b':z.style==='steam'?'#eef4f2':z.style==='land'?'#b9b28f':z.style==='flood'?'#9fe3f2':'#c7ea91',quiet?(z.style==='flood'?22:14):24);if(!quiet)effects.push({x:z.x,y:z.y,age:0,life:.55,type:'explosion'});shake=quiet?Math.max(shake,4):7;if(z.friendly){for(const e of enemies)if(Math.hypot((e.x-z.x)*.8,e.y-z.y)<z.r)damageEnemy(e,z.damage,Math.sign(e.x-z.x)*26,true);}else for(const v of fighters())if(Math.hypot((v.x-z.x)*.8,v.y-z.y)<z.r&&(!z.air||v.z<19))strike(v,z.damage,z.x,!z.air,z.knock?{stun:10,react:10}:null);}}
  zones=zones.filter(z=>!z.cancelled&&z.t>0);
  // Foundry vents and lab discharges announce their location before activating.
  if(!bossSpawned&&lock&&sectionIndex>=1&&(levelIndex===3||levelIndex===4)&&!(levelIndex===3&&!mission.active)&&Math.floor(stageTimer/9)>Math.floor((stageTimer-dt)/9)){const vx=leadPlayer().x+67;zones.push({x:vx,y:laneY(levelIndex===3?.79:.15,vx),r:43,t:1.25,total:1.25,friendly:false,damage:18,air:true,style:'vent'});}
  updateParticles(dt);
  for(const f of floating){f.y-=22*dt;f.life-=dt;}floating=floating.filter(f=>f.life>0);
  if(multi()){for(const p of present())withPlayer(p,()=>{if(comboTimer>0){comboTimer-=dt;if(comboTimer<=0)combo=0;}});}
  else if(comboTimer>0){comboTimer-=dt;if(comboTimer<=0)combo=0;}toastTime=Math.max(0,toastTime-dt);shake=Math.max(0,shake-dt*22);flash=Math.max(0,flash-dt);
  if(encounter)encounter.timer+=dt;updateEncounter();
  // A fight is over once every enemy is down for good or on its way out: the bodies lie 80 f and blink out 60 f
  // (ENEMIES §2.3), calmed dinosaurs, beaten copies and hit-and-run throwers leave (flee: they can no longer be hit), and
  // none of them holds the lock; set pieces (ZEKE, a Naguri group not yet provoked) never count (CAMPAIGN §4.5). A beaten
  // boss's defeat script plays out first, up to its dissolve or its last line (bossDeadTick: Rook 1.0 s, Slice 1.4 s, Cinder
  // 1.65 s, Crownback's lines.after 1.2 s; CAMPAIGN §10.4 'lines.after; then clear'), so the clear panel never hides it.
  if(lock&&encounterSpawned()&&enemies.every(e=>e.dead||e.dying||e.setPiece||e.state==='flee')&&!mission.active&&!enemies.some(e=>e.boss&&e.defeat&&e.defeat.kind!=='engine'&&!e.defeat.done&&!e.remove)){const boss=encounter.spec.boss;lock=null;encounter=null;if(boss){stageClear();return;}toast='GO →';toastTime=2.5;score+=500;voice('go');}
  {const nx=plan.sections[sectionIndex+1];if(nx&&nx.area===areaIndex&&leadPlayer().x>=nx.x)enterSection(sectionIndex+1);}
  updateCamera(dt);
  // A fight starts when the camera reaches its lock trigger, as the ROM's camera segments do (ARCHITECTURE §2.4).
  if(!fade&&!lock&&!encounter&&encIndex<plan.encounters.length&&plan.encounters[encIndex].area===areaIndex&&camera>=plan.encounters[encIndex].cam)startEncounter(plan.encounters[encIndex++]);
  // The periodic road (ARCHITECTURE §2.5): while a driving lock holds the camera the stage streams at CAR.road; after the
  // lock the stream runs on to the area's next loop-period boundary and then returns to 0 (no visible jump). Wheels and
  // dust keep the old road flow (whatever the camera did not cover), which also keeps the dust's random draws as before.
  if(driving){const flow=Math.max(0,CAR.road*dt-(camera-camBefore)),P=curArea()?.loop?.period||0;let f=flow;
    if(!lock){if(P&&roadStream>0){const edge=Math.ceil(roadStream/P-1e-9)*P;f=Math.min(flow,edge-roadStream);roadStream+=f;if(roadStream>=edge-1e-6)roadStream=0;}else f=0;}
    else roadStream+=f;
    road+=f;roadRate=dt>0?f/dt:0;if(multi())withPlayer(driverP(),()=>{player.roll+=flow;roadDust(flow);});else{player.roll+=flow;roadDust(flow);}}
  if(multi()){for(const p of present())withPlayer(p,()=>{const m=p.mp;if(!m.out&&!passenger(p))clampPlayer(false,m.mx,m.my);updateHeroAnim(dt,m.moved);});}
  else{const m=player.mp;clampPlayer(false,m.mx,m.my);updateHeroAnim(dt,m.moved);}
  if(mpAllOut){mpAllOut=false;withPlayer(localPlayer(),gameover);}
  clearPresses();
  }finally{if(L0&&ctxPlayer!==L0)usePlayer(L0);}
}
// The arcade camera (ARCHITECTURE §2.1, §2.3; ROM 0x20A22): it follows to the right only, at most 6 px per 60 Hz frame,
// holding the lead hero at or left of screen x `lead` (the area's follow segment, 192 by default), never past the next
// lock trigger of this area, and stays put while locked. cameraY follows the area's keyframed path (STAGE.pathY). Freed-
// freed conscripts never drive it. The area's exit segment fires once its fights are done, the camera stands on it and the
// hero pushes on past the lead: a fade to the next area (fx 'fade'), or a straight switch (fx 'continue').
const nextTrigger=()=>{const e=plan.encounters[encIndex];return e&&e.area===areaIndex?e.cam:Infinity;};
function camLead(a){let L=CAM_LEAD;for(const c of a.camera||[]){if(c.x>camera)break;if(c.mode==='follow'&&c.lead)L=c.lead;}return L;}
function updateCamera(dt){
  const a=curArea();
  if(lock){camera=lock.left;cameraY=STG.pathY(a,camera);return;}
  // D-MP8: the leading player pushes the screen only while the trailing one is more than 16 px inside the left edge
  // (one player: lead = trail, today's rule)
  let lead=player.x-camera,trail=lead;if(multi()){const C=camPlayers();if(C.length){lead=-1e9;trail=1e9;for(const p of C){lead=Math.max(lead,p.x-camera);trail=Math.min(trail,p.x-camera);}}}
  const k=dt*60,next=nextTrigger(),L=camLead(a);
  let d=0;if(lead>64&&lead>=L)d=(lead-trail>=L-16)?clamp(trail-16,0,6):Math.min(6,lead-L);
  camera=Math.min(camera+d*k,Math.max(camera,next));camera=clamp(camera,0,Math.max(0,a.w-W));cameraY=STG.pathY(a,camera);
  const exit=(a.camera||[]).find(c=>c.mode==='exit');
  if(exit&&!fade&&next===Infinity&&!encounter&&!bossSpawned&&camera>=Math.min(exit.x,Math.max(0,a.w-W))&&lead>=L){
    if(exit.fx==='fade')startFade(exit.to);else{const n=plan.areas.findIndex(r=>r.id===exit.to);if(n>=0&&n!==areaIndex)switchArea(n);}
  }
}
// The player clamp (ARCHITECTURE §2.3, §4.3; ROM 0x4FCE): on foot the move from (x0,y0) resolves over the walk mask and the
// hazards, then feet x in [cam.x+16, cam.x+367] (and the lock), y in the band. The Cadillac's nose and tail stay on screen
// (CAR_EDGE either side of the driver) and its wheels on the band. `move` is the movement pass (it damps the car).
function clampPlayer(move,x0=player.x,y0=player.y){
  if(driving){
    const lo=camera+CAR_EDGE,hi=camera+W-CAR_EDGE,cx=clamp(player.x,lo,hi);
    if(move&&cx!==player.x)player.vx*=.2;player.x=cx;
    const b=bandOf(player.x);player.y=clamp(player.y,b.top,b.bottom);if(move&&(player.y===b.top||player.y===b.bottom))player.vy=0;return;
  }
  const r=walkTo(x0,y0,player.x,player.y,{cam:{x:camera,y:cameraY},lock});player.x=r.x;player.y=r.y;
}
// The Cadillac carries momentum. Throttle (→) builds speed, brake (←) backs off, and releasing both coasts to a slow
// cruise between fights or to a standstill while the screen is locked, so the car never drifts into the edge by itself.
function updateCar(dt,dx,dy,control){
  const target=!control?0:dx>0?CAR.top:dx<0?CAR.reverse:lock?0:CAR.cruise;
  player.vx=approach(player.vx,target,(dx&&control?CAR.accel:CAR.drag)*dt);player.brake=player.vx>target+30;   // brake lights (drawing only)
  player.vy=approach(player.vy,control?dy*CAR.laneTop:0,CAR.laneAccel*dt);
  player.x+=(player.vx+(player.boost>0?CAR.boost:0))*dt;player.y+=player.vy*dt;
  player.bank=approach(player.bank,player.vy/CAR.laneTop,5*dt);player.bump=Math.max(0,player.bump-dt);
}
// Dust kicks up behind the rear wheel as the road passes; boosting adds exhaust flame at the tail.
function roadDust(flow){
  player.dust+=flow;if(player.dust<25)return;player.dust=0;const s=CAR_SCALE;
  particles.push({x:player.x-96*s,y:player.y-2+rand(-2,2),vx:-rand(44,89),vy:-rand(9,22),life:rand(.3,.5),size:rand(3,6),color:'#c9bb95',float:true});
  if(player.boost>0)for(let i=0;i<2;i++)particles.push({x:player.x-150*s,y:player.y-24*s+rand(-3,3),vx:-rand(133,222),vy:rand(-15,15),life:rand(.12,.22),size:rand(3,5),color:i?'#ffb33b':'#ff6a3b',float:true});
}
// Running into an enemy is one impact, not a stream of hits: the faster the car, the harder they are flung. A rider
// already swerving into the car gets to land the hit unless the Cadillac is boosting.
function ramEnemies(){
  for(const e of enemies){
    if(e.dead||e.dying||!e.onstage||e.delay>0||e.rammed>0||['intro','fly','down','rise','held'].includes(e.state))continue;
    if(e.state==='charge'&&player.boost<=0)continue;
    if(Math.abs((e.boss?hx(e,player.x):e.x)-player.x)>=(e.boss?60:CAR_REACH)||Math.abs(e.y-player.y)>=(e.boss?26:21))continue;
    const speed=Math.abs(player.vx)+(player.boost>0?CAR.boost:0),dir=Math.sign(e.x-player.x)||player.dir,heavy=speed>89;
    e.rammed=.5;
    // A full-speed ram takes most of a rider's health; a boosted one finishes him, as the arcade car does.
    // Damage keeps the old canvas-px formula (60 + 0.2 x speed at 1.35 px per arcade px).
    if(!damageEnemy(e,heavy?60+speed*.27:12,dir*22,heavy,false,{heavy,ram:true,fling:heavy&&!e.boss?{vx:dir*(148+speed*.55),vz:193+speed*.35}:null}))continue;
    // a boosted ram knocks Breakwater into its head-up window (CAMPAIGN §6.4), at most once per 3 s
    if(e.boss&&e.type==='truck'&&player.boost>0&&heavy&&e.hp>0&&!['flee','dead'].includes(e.state)&&stageTimer-(e.airAt??-9)>3){e.airAt=stageTimer;e.state='air';e.timer=.6;e.mvName='recover';}
    player.bump=.3;shake=Math.max(shake,heavy?7:3);if(heavy)sfx('slam');
  }
}

function rect(g,x,y,w,h,c){g.fillStyle=c;g.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
function poly(g,pts,c){g.fillStyle=c;g.beginPath();pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fill();}
function circle(g,x,y,r,c){g.fillStyle=c;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();}
// Title and menu backdrop: chapter 1's first area, panning slowly back and forth (its pages load at start-up).
function menuBackdrop(){
  const a=SD.chapters.ch1.areas[0],span=Math.max(1,a.w-W),t=(time*12)%(2*span),cam={x:Math.round(t<span?t:2*span-t),y:0};
  SR.back(ctx,a,cam,time);SR.front(ctx,a,cam,time);
}
// The title cast (HEROES §9.2): the parked Cadillac with Jack at the wheel and the other three heroes beside it, all ROM
// records drawn at half size - one art pixel per pixel of the 2x canvas, so nothing is resampled - which keeps the title
// screen's composition around the HTML panel. The title and the credits show each hero's victory pose (the last frame of
// main:14); hero select and the chapter list show idle frame 0. Nothing is drawn until the sprite sheets are decoded.
function menuCast(){
  const R=RIG(),pose=!started||state==='menu'||state==='credits'?'victory':'idle';
  ctx.save();ctx.translate(90,205);ctx.scale(.5,.5);car(ctx,0,0,{hero:1,t:time});ctx.restore();
  if(!R)return;
  HEROES.forEach((h,i)=>{if(i===1)return;const c=R.clip(h.id,pose)||R.clip(h.id,'idle');if(!c)return;
    R.draw(ctx,R.parts(h.id,{full:{clip:c,k:pose==='victory'?c.f.length-1:0}},null),200+i*45,212,0,1,.5,'hero');});
}
// Ground shadow: the old 25/42/78 canvas-px ellipses are 19/31/58 arcade px (ARCHITECTURE §4.4); legacy art drawn under
// LEG passes its own canvas-px sizes and h 6.
// SHADOWS: 0 draws inline (menus), 1 is the shadow pass, 2 the sprite pass (inline shadow calls do nothing: the pass
// before the sprites already drew them, as the ROM appends every shadow sprite after all objects, 0x14EC0).
let SHADOWS=0;
function shadow(g,x,y,w=19,h=4){if(SHADOWS===2)return;g.fillStyle='#10271b66';g.beginPath();g.ellipse(x,y,w,h,0,0,Math.PI*2);g.fill();}
// Draws legacy canvas-px art around a world point: translate to the (whole-pixel) anchor, then scale by k (LEG by default).
function legacy(g,x,y,fn,k=LEG){g.save();g.translate(Math.round(x),Math.round(y));g.scale(k,k);try{fn();}finally{g.restore();}}
// New antagonist: a flood-control crawler, animated with pistons and treads.
// The Cadillac is the ROM's own car object (WP-J, ROM_FX.cadillac; HEROES §9.1, KI12): body record 1097 (1098 = brake
// lights on) and its two wheels in the S3A0 colours - the rear wheel spinning, the front one turned by the steering
// index (0/1 toward the viewer, 2 straight, 3/4 away) - then the hero's own seated record (main:29 `drive`) on the
// driver's seat (0,-32), back to front as the ROM draws them (0x8BDDC). The art faces right; one arcade px per art px.
// (x, y) is the road point under the car: the body rides `ground` px above it plus the ROM bump table, the wheels stay on
// the road (depth + 1 = 1 px up). What the ROM picks at random follows the clock (when a bump starts) and the distance
// rolled (the 1-px wheel jitter) instead, so drawing never calls Math.random. Returns false (nothing drawn) until the fx sheet is ready.
// o: {hero: index at the wheel (-1 or absent = parked, empty), roll: px rolled, moving, bank: -1..1 (+ = steering down
// the screen), bump: seconds left of a ram jolt (0.3 s), brake: the brake-lights record, t: seconds (driver's clip, road bumps)}
const carFrameAt=(c,t)=>{const total=c.f.reduce((n,f)=>n+(f[2]||256),0);let m=Math.floor(Math.max(0,t)*60)%Math.max(1,total);for(let k=0;k<c.f.length;k++){m-=c.f[k][2]||256;if(m<0)return k;}return 0;};
function car(g,x,y,o={}){
  const C=window.ROM_FX?.cadillac,SP=window.SPRITES;if(!C||!SP||!SP.familyReady('fx'))return false;
  const map=C.mapKey||'S3A0',Wh=C.wheels,roll=Math.max(0,o.roll||0),moving=!!o.moving;
  // a bump plays the 15-frame table (t = 15..1, one entry per 60 Hz frame): a ram jolt, or while the car rolls one bump
  // every 32 frames (15 bumping, 17 at rest: about the half of the time the ROM's random starts give)
  const n=Math.floor((o.t||0)*60)%32,t=o.bump>0?Math.max(1,Math.min(15,Math.ceil(o.bump/.3*15))):moving&&n<15?15-n:0,bob=t?C.bob.table[t]||0:0;
  const bx=Math.round(x),by=Math.round(y)-C.ground-bob,ph=Math.floor(roll/16)&1,steer=clamp(Math.round(Wh.straight-2*(o.bank||0)),0,Wh.steer.length-1);
  shadow(g,bx,Math.round(y)+1,118,5);
  const jit=k=>moving&&((Math.floor(roll/4)+k)&1)?-1:0;
  SP.drawRec(g,'fx',Wh.steer[Wh.straight][ph],map,bx+Wh.rear.dx,by+Wh.rear.dy+bob+jit(0),false);
  SP.drawRec(g,'fx',Wh.steer[steer][ph],map,bx+Wh.front.dx,by+Wh.front.dy+bob+jit(1),false);
  SP.drawRec(g,'fx',(o.brake?C.anims.brake:C.anims.drive)[0][0],map,bx,by,false);
  const R=RIG();
  // 2-3 players: the riders in the passenger seat and the back seat (seats 1 and 2), seated on the drive clip
  if(o.passengers&&R)o.passengers.forEach((h,i)=>{const st=C.seats[i+1];if(!st||!HEROES[h])return;const id=HEROES[h].id,c=R.clip(id,'drive');if(c)R.draw(g,R.parts(id,{full:{clip:'drive',k:carFrameAt(c,(o.t||0)+.3*(i+1))}},null),bx+st.dx,by+st.dy,0,st.flip?1:-1,1,'hero');});
  if(o.hero>=0&&R&&HEROES[o.hero]){
    const id=HEROES[o.hero].id,c=R.clip(id,'drive'),seat=C.seats[0];
    // the seated records already face right (seat 0 is not flipped): dir -1 draws them as stored
    if(c)R.draw(g,R.parts(id,{full:{clip:'drive',k:carFrameAt(c,o.t||0)}},null),bx+seat.dx,by+seat.dy,0,-1,1,'hero');
  }
  return true;
}
// ---------------------------------------------------------------- the Mirror Test and the ending's heroes through HeroRig (PLAN §7 G3b)
// Echo's Mirror Test (chapter 5) and the heroes of the ending's road are the heroes' own ROM clips (HEROES §8): one clip
// player per fighter, chosen from today's AI state (§8.2), ticked at the end of every update (walk clips by the distance
// moved, §3.5) and drawn in a palette map of the hero sheet: 'mirror-<id>' (the copy's swapped clothing ramps), 'hero'
// and 'gel' for the beaten copy (§8.3, ENEMIES §2.7). No CSS filter, no hurt flash (it has no arcade equivalent). The clip
// state lives in a WeakMap, so the fighter objects keep their shape; nothing here changes gameplay or calls Math.random.
const cloneAnims=new WeakMap();
const CLONE_COMBO=['p1','kick','fin'],CLONE_LYING=new Set(['knock','knockHard','knockFace','lieBack']);
const firstAct=c=>{const i=c?c.f.findIndex(f=>f[5]):-1;return i<0?0:i;};
// -> {role, air?, windup?, strike?, loco?}, first match wins. The combo clip follows attackNo % 3 (allies, which have no
// attackNo, take their own strike count); 'lie' keeps the knock clip that ends lying, or collapses through 'knock'.
function cloneSel(e,st){
  const combo=CLONE_COMBO[(((e.attackNo??st.n)|0)%3+3)%3];
  if(e.state==='fly')return {role:e.dying?'knockHard':'knock',air:e.z>4};
  if(e.dead||e.state==='dead'||e.state==='down'||(e.ally&&e.state==='retreat'&&e.hp<=0))return {role:'lie'};
  if(e.state==='held')return {role:e.hurt>0?'hurt':'heldStruggle'};
  if(e.hurt>0||e.state==='hurt')return {role:'hurt'};
  if(e.state==='rise')return {role:'getup'};
  if(e.state==='charge')return {role:'dash'};
  if(e.state==='leap'||e.z>4)return {role:e.strikeFlash>0?'airKick':'jumpFwd'};
  if(e.strikeFlash>0)return {role:combo,strike:true};
  if(e.state==='windup')return {role:combo,windup:true};
  if(e.moving)return {role:e.running?'run':'walk',loco:true};   // running: the ending's actors (G6)
  return {role:'idle'};
}
// Runs after the fighter's update (dt, distance moved) and with dt 0 before each draw. As for the player, a clip starts
// when the selection changes and then runs on by itself; a strike restarts on every new strikeFlash. The windup plays
// the combo clip up to the frame before its first active frame and holds it; the strike starts on the active frame and
// goes on into the contact clip (HEROES D10), which continues into idle - once it has, the fighter shows walk or idle for
// the rest of today's strikeFlash. A knock holds its fly pose while airborne. Walk stays selected for 0.1 s after the
// fighter stops, so a copy hovering on its lane does not flicker between walk and idle.
function animateClone(e,dt,moved){
  const R=RIG();if(!R||!e||e.hero==null||!HEROES[e.hero])return null;
  const id=HEROES[e.hero].id;let st=cloneAnims.get(e);
  if(!st){st={main:R.player(),want:null,sf:0,n:0,struck:false,done:false,still:1,sel:null};cloneAnims.set(e,st);}
  const A=st.main;let sel=cloneSel(e,st);if(sel.role==='run'&&!R.clip(id,'run'))sel={role:'walk',loco:true};
  if(st.struck&&!sel.strike)st.n++;st.struck=!!sel.strike;
  const newStrike=!!sel.strike&&(e.strikeFlash||0)>st.sf+1e-6;if(newStrike)st.done=false;
  if(sel.strike&&st.done)sel=e.moving?{role:'walk',loco:true}:{role:'idle'};
  if(sel.loco)st.still=0;else if(dt>0)st.still+=dt;
  if(sel.role==='idle'&&A.role==='walk'&&A.hero===id&&st.still<.1)sel={role:'walk',loco:true};
  st.sel=sel;
  let role=sel.role,fresh=false;const play=(r,k=0)=>{R.play(A,id,r,{restart:true,k});fresh=true;};
  const key=sel.strike?role+'!':sel.windup?role+'~':role;
  if(role==='lie'){if(!(A.clip&&A.hero===id&&CLONE_LYING.has(A.role)))play('knock');role=A.role;}
  else if(key!==st.want||newStrike){
    if(sel.strike)play(role,firstAct(R.clip(id,role)));
    else if(sel.windup)play(role,0);
    else if(role==='idle'&&A.clip&&A.hero===id&&A.clip.next&&!A.ended){}       // a strike runs on into idle by itself
    else if(A.role!==role||A.hero!==id||!A.clip)play(role);
  }
  st.want=key;st.sf=e.strikeFlash||0;
  if(dt>0&&!fresh&&A.clip&&!(e.freeze>0)){
    if(sel.loco){const sp=R.hero(id).speed||{},v=sel.role==='run'?(sp.run||(sp.walk||1.6)*1.68):(sp.walk||1.6);R.advance(A,moved/(v*CFG.sockets.scale*(e.scale||1)));}
    else if(sel.air&&A.k===0){}                                                // the fly pose holds while in the air
    else if(sel.windup&&A.role===role){const act=firstAct(A.clip);if(A.k<act-1)R.tick(A,dt);if(A.k>=act){A.k=Math.max(0,act-1);A.t=1;}}
    else R.tick(A,dt);
    if(sel.strike&&A.role===role){const c=R.clip(id,role),ct=c&&c.contact;if(ct&&R.clip(id,ct)&&A.k>firstAct(A.clip))R.play(A,id,ct,{restart:true});}
  }
  if(sel.strike&&!fresh&&A.role!==role&&A.role!==R.clip(id,role)?.contact)st.done=true;     // gone on into idle
  return st;
}
// LAST_EDEN.snapshot: the clip the Mirror Test or an ending hero shows, {role, id, k, rec, map}
function cloneInfo(e){if(e.conscript||!(e.hero>=0))return null;const st=cloneAnims.get(e),f=st&&RIG()?.frame(st.main);if(!f)return null;const id=HEROES[e.hero].id;
  return {role:st.main.role,id:st.main.clip.id,k:st.main.k,rec:f[0],map:e.ally?'freed-'+id:e.dissolve?'gel':'mirror-'+id};}
// HeroRig parts in a 1-px gold outline (ENEMIES §2.7.4; LAST_EDEN.test.art.outlined): the parts are drawn once into a scratch canvas, a copy of it
// is stamped at the four 1-px offsets and filled gold through its own alpha, the sprite goes on top, and the parts' box
// (+1 px) is kept as its own small canvas per pose (LRU 96): a pose seen before is one draw and no canvas is touched (G8:
// re-stamping one shared scratch per ally cost 5.4 Mpx and a pipeline flush per ally a frame at the clone war). No
// pixel is read back (file:// safe). The scratch holds any hero frame: feet at (128,156), 256x176.
const OUTLINE={w:256,h:176,fx:128,fy:156,a:null,cache:new Map()};
function drawOutlined(parts,x,y,z,dir,S,map,color){
  const R=RIG();if(!R)return false;
  const key=[map,color,dir,S,...parts.map(p=>[p.fam,p.sheet,p.rec,p.x,p.y,p.flip?1:0,p.mapKey].join())].join('|'),C=OUTLINE.cache;let o=C.get(key);
  if(o){C.delete(key);C.set(key,o);}
  else{
    if(!OUTLINE.a){OUTLINE.a=document.createElement('canvas');OUTLINE.a.width=OUTLINE.w;OUTLINE.a.height=OUTLINE.h;}
    const a=OUTLINE.a,ga=a.getContext('2d');ga.clearRect(0,0,a.width,a.height);if(!R.draw(ga,parts,OUTLINE.fx,OUTLINE.fy,0,dir,S,map))return false;
    // the parts' box about the feet (either facing: +-the widest reach), 1 px of outline around it, inside the scratch
    let rx=0,y0=0,y1=0;for(const p of parts){const r=window.SPRITES.locate(p.fam||'heroes',p.rec,p.fam==='heroes'?p.sheet:null)?.r;if(r){const u=p.flip?p.x+r[4]:p.x-r[4];rx=Math.max(rx,Math.abs(u),Math.abs(p.flip?u-r[2]:u+r[2]));y0=Math.min(y0,p.y-r[5]);y1=Math.max(y1,p.y-r[5]+r[3]);}}
    const bx=Math.max(0,OUTLINE.fx-Math.ceil(rx*S)-1),by=Math.max(0,OUTLINE.fy+Math.floor(y0*S)-1),bw=Math.min(a.width,OUTLINE.fx+Math.ceil(rx*S)+1)-bx,bh=Math.min(a.height,OUTLINE.fy+Math.ceil(y1*S)+1)-by;
    const c=document.createElement('canvas');c.width=bw+2;c.height=bh+2;const g=c.getContext('2d');
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])g.drawImage(a,bx,by,bw,bh,1+dx,1+dy,bw,bh);
    g.globalCompositeOperation='source-in';g.fillStyle=color;g.fillRect(0,0,c.width,c.height);g.globalCompositeOperation='source-over';g.drawImage(a,bx,by,bw,bh,1,1,bw,bh);
    C.set(key,o={c,dx:bx-1-OUTLINE.fx,dy:by-1-OUTLINE.fy});if(C.size>96)C.delete(C.keys().next().value);
  }
  ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(o.c,Math.round(x)+o.dx,Math.round(y-(z||0))+o.dy);ctx.restore();
  return true;
}
// variant 'mirror' (the Mirror Test; beaten, it cross-fades to gel) or 'freed' (outlined). False until HeroRig is ready.
function drawHeroClone(e,variant){
  const R=RIG(),st=NETROLE==='client'?null:animateClone(e,0,0),body=st?{full:st.main}:e.rig?{full:{clip:e.rig[0],k:e.rig[1]}}:null;if(!R||!body||st&&!st.main.clip)return false;
  const id=HEROES[e.hero].id,parts=R.parts(id,body,null),x=e.x-viewX+(e.freeze>0?(Math.floor(time*50)%2?1:-1):0),S=CFG.sockets.scale*(e.scale||1);
  if(variant==='freed')return drawOutlined(parts,x,e.y,e.z,e.dir,S,'freed-'+id,'#ffd257');
  const ok=R.draw(ctx,parts,x,e.y,e.z,e.dir,S,(e.half?'half-':'mirror-')+id);
  if(ok&&e.dissolve){ctx.save();ctx.globalAlpha*=e.dead>0?1:.5;R.draw(ctx,parts,x,e.y,e.z,e.dir,S,'gel');ctx.restore();}
  return ok;
}
// ---------------------------------------------------------------- freed conscripts on their ROM records (STORY.md chapter 6)
// A freed conscript is a collared Wassoon prisoner, FERRIS (Chinpira A, the fishermen of chapter 1's pods) on his own ROM
// records, chosen from the ally's AI state the way resolveAnim chooses a ROM enemy's: walk (or the ending's run) by the
// distance moved, the jab (main 3) held on its first frame through the windup and played on from its active frame at the
// strike, the hurt pose, lying on his knock-down frame, the get-up. Drawn inside a 1-px gold outline so he never reads as
// one of Sable's guards. Nothing here changes gameplay or calls Math.random.
const CONSCRIPT={type:'raider',v:'A',jab:['main',3],outline:'#ffd257'};
const cKey=(a,st,k=0)=>stKey({type:CONSCRIPT.type,v:a.v||CONSCRIPT.v},st,k);
function conscriptAnim(a){
  const S=st=>cKey(a,st),V=a.v||CONSCRIPT.v;
  if(a.state==='down'||(a.state==='retreat'&&a.hp<=0&&!a.moving))return {key:S('fly'),k:'last'};
  if(a.state==='rise')return {key:S('rise'),t:(a.stT||0)*60,hold:true};
  if(a.hurt>0)return {key:EK.stateAnim(CONSCRIPT.type,V,'hurt',0)||S('hurt'),t:Math.max(0,.3-a.hurt)*60,hold:true};
  const jab=EK.resolve(CONSCRIPT.type,V,CONSCRIPT.jab),ja=eAnim(jab);
  if(ja&&(a.strikeFlash>0||a.state==='windup')){let act=ja.f.findIndex(f=>f[2]);if(act<0)act=0;let hitT=0;for(let i=0;i<act;i++)hitT+=ja.f[i][1];
    return a.strikeFlash>0?{key:jab,t:hitT+(.22-a.strikeFlash)*60,hold:true}:{key:jab,k:0};}
  if(a.moving)return {key:(a.running&&S('run'))||S('walk'),dist:Math.max(.3,EK.kindSpeed(CONSCRIPT.type,V)||1)*(a.running?1.6:1)};
  return {key:S('idle')};
}
// runs after the conscript's update (dt, distance moved) and with dt 0 before each draw; a replica shows the host's frame
function animateConscript(a,dt,moved){
  if(!a||NETROLE==='client'||!EK||!ROME())return;
  if(a.state!==a.ps){a.ps=a.state;a.stT=0;}a.stT=(a.stT||0)+dt;
  const r=conscriptAnim(a),an=r&&eAnim(r.key);if(!an){a.fid=null;return;}
  if(r.key!==a.ak){a.ak=r.key;a.aF=0;}
  let i;if(r.k!=null)i=r.k==='last'?an.f.length-1:Math.min(an.f.length-1,r.k);else if(r.t!=null)i=frameIdx(an,r.t,r.hold);else{a.aF+=r.dist?moved/r.dist:dt*60;i=frameIdx(an,a.aF);}
  a.af=i;a.fid=an.f[i][0];
}
// One ROM enemy frame inside a 1-px outline of `color`, its origin (the feet) at (x, y): the frame is stamped at the
// four 1-px offsets into its own small canvas, filled with the colour through its alpha, and the frame goes on top;
// one canvas per frame, facing, map and colour (LRU 64). No pixel is read back (file:// safe).
const ROM_OUTLINE=new Map();
function drawOutlinedRom(fid,x,y,dir,map,color){
  const F=ROME(),SP=window.SPRITES;if(!F||!SP||fid==null||!map||!SP.familyReady('enemies'))return false;
  const fr=F.frames[fid];if(!fr)return false;const key=fid+'|'+(dir>0?1:-1)+'|'+map+'|'+color;let o=ROM_OUTLINE.get(key);
  if(o){ROM_OUTLINE.delete(key);ROM_OUTLINE.set(key,o);}
  else{const src=SP.canvasFor(fr[0],map,'enemies',[fr[1],fr[2],fr[3],fr[4]]);if(!src)return false;
    const w=fr[3],h=fr[4],c=document.createElement('canvas');c.width=w+2;c.height=h+2;const g=c.getContext('2d');g.imageSmoothingEnabled=false;
    const stamp=(dx,dy)=>{g.save();g.translate(1+dx,1+dy);if(dir>0){g.translate(w,0);g.scale(-1,1);}g.drawImage(src,fr[1],fr[2],w,h,0,0,w,h);g.restore();};
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])stamp(dx,dy);
    g.globalCompositeOperation='source-in';g.fillStyle=color;g.fillRect(0,0,c.width,c.height);g.globalCompositeOperation='source-over';stamp(0,0);
    // the art faces left: facing right mirrors it about the origin (drawRomFrame), so its left edge is x - (w - ox)
    o={c,dx:(dir>0?-(w-fr[5]):-fr[5])-1,dy:-fr[6]-1};ROM_OUTLINE.set(key,o);if(ROM_OUTLINE.size>64)ROM_OUTLINE.delete(ROM_OUTLINE.keys().next().value);}
  ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(o.c,Math.round(x)+o.dx,Math.round(y)+o.dy);ctx.restore();return true;
}
// a freed conscript at screen x (an ally, or an ending actor); a replica draws the host's frame (rig ['rom', fid])
function drawConscript(a,x,y){
  if(NETROLE==='client'){if(a.rig&&a.rig[0]==='rom')a.fid=a.rig[1];}else animateConscript(a,0,0);
  const F=ROME(),map=F?.palMap?.[`${EK?.typeOf?.(CONSCRIPT.type,a.v||CONSCRIPT.v)||'chinpira'}:${a.v||CONSCRIPT.v}`];
  return drawOutlinedRom(a.fid,x,y-(a.z||0),a.dir,map,CONSCRIPT.outline);
}
function drawAlly(a){
  const x=a.x-viewX;if(x<-111||x>W+111)return;ctx.save();shadow(ctx,x,a.y);if(a.inv>0&&Math.floor(time*16)%2===0)ctx.globalAlpha=.75;
  drawConscript(a,x,a.y);
  if(a.state!=='retreat'){legacy(ctx,x,a.y-a.z,()=>poly(ctx,[[0,-118],[5,-112],[0,-106],[-5,-112]],'#ffe08a'));legacy(ctx,x,a.y,()=>{rect(ctx,-18,-128,36,3,'#3a321a');rect(ctx,-18,-128,36*a.hp/a.maxhp,3,'#ffe08a');});}
  ctx.restore();
}
// One ROM_ENEMIES frame [sheet, x, y, w, h, ox, oy, rec, flags] with its origin (the feet) at (x, y) in palette map
// `map` (ENEMIES §2.9 drawRom): one arcade px per art px, the art faces left, so a body facing right is mirrored about
// its origin. No filter, no rotation, no hurt flash. False until the enemies family has decoded.
function drawRomFrame(fid,x,y,dir,map,fam='enemies',g=ctx){
  const F=fam==='bosses'?ROMB():ROME(),SP=window.SPRITES;if(!F||!SP||!map||fid==null||!SP.familyReady(fam))return false;
  const fr=F.frames[fid];if(!fr)return false;
  const c=SP.canvasFor(fr[0],map,fam,[fr[1],fr[2],fr[3],fr[4]]);if(!c)return false;
  g.save();g.imageSmoothingEnabled=false;g.translate(Math.round(x),Math.round(y));if(dir>0)g.scale(-1,1);
  g.drawImage(c,fr[1],fr[2],fr[3],fr[4],-fr[5],-fr[6],fr[3],fr[4]);g.restore();return true;
}
// The knife man's knife is its own object (0xF0, set 0x6FB6A): its pose and offset for the body frame on show come from
// ROM_ENEMIES.objects.knifeHand.attach (logged live, ±1 px), drawn in front of the hand; a frame never logged takes the
// nearest earlier frame of the same anim (ENEMIES §2.8, §10.2). The run-in (main 2) has no rows there: its knife in the
// leading fist comes from ENEMY_KINDS.knifer.knifeRun (the same live logs; G4 verify #7).
function drawKnifeInHand(e,x,y,map){
  const A=ROME()?.objects?.knifeHand?.attach;if(!A||!e.ak)return;
  let r=null;for(let k=e.af;k>=0&&!r;k--)r=A[`${e.ak}:${k}`];
  const KR=EK?.knifer?.knifeRun;if(!r&&KR&&KR.keys.includes(e.ak)){const f=KR.f[Math.min(KR.f.length-1,e.af|0)];if(f)r=[f[0],f[1],KR.pose];}
  if(!r)return;
  const pose=eAnim(r[2]);if(pose)drawRomFrame(pose.f[0][0],x-e.dir*r[0],y+r[1],e.dir,map);
}
// A ROM enemy: its state's frame, a corpse blinking out over its last 60 frames (on even 2-frame slices), a copy
// cross-fading into its gel map ('<type>:<V>/gel', ENEMIES §2.7.3) while it dissolves, a knife man's knife.
function drawRomEnemy(e,x,y){
  animateEnemy(e,0,0);if(e.wreck||e.state==='submerged')return true;if(e.fid==null)return false;
  if(e.dead>0&&!e.dissolve&&e.dead<1&&Math.floor(e.dead*30)%2)return true;
  const map=enemyMap(e);ctx.save();if(e.sink)ctx.globalAlpha*=clamp(e.timer,0,1);
  const ok=drawRomFrame(e.fid,x,y,e.dir,map);
  if(ok&&e.dissolve){ctx.save();ctx.globalAlpha*=e.dead>0?.35+.65*clamp(1-e.dead/.75,0,1):.35;drawRomFrame(e.fid,x,y,e.dir,enemyMap(e,true));ctx.restore();}
  if(ok&&e.type==='knifer'&&e.knife)drawKnifeInHand(e,x,y,map);
  ctx.restore();return ok;
}
// The engine's ground shadow under a ROM enemy, except where its record carries its own shadow blocks (flags bit 0:
// R HOPPER, ZEKE and others; ENEMIES §2.9), under a wreck or a submerged body.
function enemyShadow(e,x){
  if(e.wreck||e.state==='submerged'||e.sink)return;const fr=e.fid!=null?ROME()?.frames?.[e.fid]:null;if(fr&&(fr[8]&1))return;
  shadow(ctx,x,e.y,e.type==='brute'||e.type==='regent'?24:e.type==='biker'?28:19);
}
function drawFighter(e) {
  if(e.waiting||(e.testHidden&&!e.boss)||(e.delay>0&&!e.onstage&&e.state!=='drop'))return;
  const x=e.x-viewX+(e.freeze>0?(Math.floor(time*50)%2?1:-1):0),y=e.y-e.z;if(x<-207||x>W+207)return;ctx.save();
  const R=romKind(e)||e.type==='zeke',easy=normalizeDifficulty(difficulty)==='easy';
  if(!R&&!e.boss&&e.dead)ctx.globalAlpha=clamp(e.dead/.75,0,1);
  if(e.boss&&e.dead>0&&!['lot00','arrest'].includes(e.defeat?.kind))ctx.globalAlpha=clamp(e.dead/.6,0,1);
  if(e.rage>0)legacy(ctx,x,y,()=>{rect(ctx,-21,-117,42,15,'#611f29');label(e.rageWarning>0?'! RAGE !':'RAGE',0,-106,10,'#ffc16e','center');});
  // Regulars, elites, riders and dinosaurs are their ROM records (drawRomEnemy); the Mirror Test is a HeroRig sprite in the
  // 'mirror-<id>' palette (G3b); bosses are their ROM bodies (drawBoss, G5).
  if(R)drawRomEnemy(e,x,y);
  else if(e.type==='mirror')drawHeroClone(e,'mirror');
  else if(e.boss)drawBoss(e,x,y);
  // Breakwater's head-on: a 1-s '!' in the car's lane at the right edge (CAMPAIGN §6.4: the tell of a move from off screen)
  if(e.type==='truck'&&e.state==='windup'&&e.mvName==='headon'&&e.phase2h)legacy(ctx,W-18,e.hy,()=>label('!',0,-40,30,'#ff7b4a','center'));
  // The windup '!', the mini HP bar and the leap's landing ellipse are sequel tells: on easy only (ENEMIES §2.5, §11 HUD
  // notes; the arcade has none: its foe bar is the HUD's, PLAN §7 G7).
  if(e.state==='windup'&&easy&&!(e.type==='sable'&&e.phase===2))legacy(ctx,x,y,()=>label('!',0,-(e.boss?(e.type==='fessenden'?168:120):112),24,'#ffbf71','center'));
  if(easy&&!e.boss&&!e.elite&&!e.setPiece&&e.hp<e.maxhp&&!e.dead&&e.state!=='flee')legacy(ctx,x,e.y,()=>{rect(ctx,-23,-112,46,4,'#172e24');rect(ctx,-23,-112,46*clamp(e.hp/e.maxhp,0,1),4,'#e7b16e');});
  if(e.state==='leap'&&easy){ctx.strokeStyle='#ffbf71';ctx.beginPath();ctx.ellipse(e.targetX-viewX,e.targetY,e.boss?41:30,e.boss?15:11,0,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}

const FIREARMS=new Set(['gun','uzi','shotgun','rifle','m16','bazooka']);

// ---------------------------------------------------------------- the player through HeroRig (PLAN §7 G3a, G3c)
// The ROM clips draw the hero (HEROES §5-§6) and the ROM hold tables place the weapon on every frame: each frame's hold
// index picks one of the weapon's pre-drawn rotations and its origin in the hero's own feet space (§7.2), so there is no
// grip point, stance table or rotation any more. Walk and run clips advance by the distance moved at the hero's ROM
// speed (§3.5); idle, stances and jumps play by time. Since G3c every timed state of the hero (combo moves, knee and
// throw, stab and swing, pickup, special, hurt, knockdown and get-up, dash and dashEnd, air attacks, landing, firing,
// the death fall and the victory pose) lasts its ROM clip and lands its blow on the clip's event or active frame: the
// gameplay clocks below read the clip data (pure data, ready with the script, not with the sheets), and the drawn clip
// is pinned to the state's own clock, so the frame on screen is the frame the game logic is on.
const RIG=()=>window.HeroRig&&HeroRig.data?HeroRig:null;
const isLoco=role=>/^(walk|runStart|run|legsWalk|legsRun)$|^(walkTorso|runTorso)\./.test(role||'');
const isRunClip=role=>/^(runStart|run|legsRun)$|^runTorso\./.test(role||'');
// ROM clip timing for gameplay (HEROES D5): a clip's frames last their 60 Hz durations (0 = 256), the first one
// max(1, dur-1) (KI11, HeroRig.ROM_START_TRIM), exactly as HeroRig plays them. -> {f, at:[frame start s], len s}
const clipTimes=new WeakMap();
function heroClipTiming(role,hero=selected){
  const R=RIG(),c=R&&HEROES[hero]?R.clip(HEROES[hero].id,role):null;if(!c||!c.f||!c.f.length)return null;
  let t=clipTimes.get(c);if(t)return t;
  const trim=R.ROM_START_TRIM!==false,at=[];let s=0;
  c.f.forEach((f,i)=>{at.push(s);const d=f[2]===0?256:f[2];s+=(i===0&&trim?Math.max(1,d-1):d)/60;});
  t={role,f:c.f,at,len:s};clipTimes.set(c,t);return t;
}
// the clip's length in seconds (fb without ROM data)
function heroClipLen(role,fb){const t=heroClipTiming(role);return t?t.len:fb;}
// seconds from the clip's start to its first frame that passes test(frame) (an event or active frame)
function heroClipEvent(role,test,fb){const t=heroClipTiming(role);if(!t)return fb;const k=t.f.findIndex(test);return k<0?fb:t.at[k];}
// the frame on show `s` seconds into the clip (the last frame holds)
function heroFrameAt(t,s){let k=0;while(k+1<t.at.length&&s>=t.at[k+1]-1e-9)k++;return k;}
// the hero's role for a weapon class (h.cls[cls][key]: 'attack' = swing/stab/throw/fire clip, 'stand' = stance)
function heroClassRole(cls,key){const R=RIG(),h=R?R.hero(HEROES[selected].id):null;return (h&&cls&&h.cls[cls]&&h.cls[cls][key])||(key==='attack'?'attack.throwable':'idle');}
// `main`/`legs` are the clip players; `want` is the free-running role last started ('@role' after a pinned state).
// (a let since G9b: every player has its own, usePlayer swaps it in)
let heroAnim={main:null,legs:null,want:null,flame:null,swing:null,force:null,sel:null};
function heroAnimReset(){const R=window.HeroRig;Object.assign(heroAnim,{main:R?R.player():null,legs:R?R.player():null,want:null,flame:null,swing:null,force:null,sel:null});}
// `swing` is the ROM weapon class whose attack clip the move plays (blade stab, blunt swing, throwable throw).
function heroAct(swing=null){heroAnim.swing=swing;}
const rigClass=type=>RIG()?.data.weapon[type]?.cls||null;
// Held weapons take the chapter's OBJ palette page (0x8E8E; B. KNIFE and YOROI change colour per chapter, KI7).
function heroRigChapter(i){const R=window.HeroRig,p=window.STAGE_DATA?.chapters?.[chapterKey(i)]?.objPage,maps=(window.ROM_FX||window.SPRITE_DATA?.families?.fx)?.pal?.maps;if(R)R.objPage=p&&maps&&maps[p]?p:null;}
// Which clip shows now (HEROES §6.1, first match wins). Firearms keep the armed-* pose strings.
// -> {pose, role (full body or torso), legs? (split body: legsWalk/legsRun under a weapon torso), lift?, at?|k?}
// `at` (seconds into the clip) or `k` (a move's frame) pins the clip to the state's own clock; without them the clip runs
// by itself (idle and stances, walk and run by distance, the jump by time, the grab hold).
function heroRoles(){
  const R=RIG(),id=HEROES[selected].id,h=R?R.hero(id):null,w=player.weapon,cls=rigClass(w),C=h&&cls?h.cls[cls]:null;
  const air=player.z>0,mv=player.move,fire=FIREARMS.has(w),has=r=>!!(R&&r&&R.clip(id,r)),gone=(total,left)=>Math.max(0,(total||0)-left);
  const run=pose=>C&&has(C.runTorso)?{pose,role:C.runTorso,legs:'legsRun'}:{pose,role:'runStart'};
  const walk=pose=>C&&has(C.walkTorso)?{pose,role:C.walkTorso,legs:'legsWalk'}:{pose,role:'walk'};
  const stand=C&&has(C.stand)?C.stand:'idle';
  // the chapter is cleared: main:14 (Mustapha's ends on the thumbs-up, rec 295), its last frame held
  if(player.victoryT!=null)return {pose:'victory',role:'victory',at:player.victoryT};
  if(player.pickup>0)return {pose:'pickup',role:'pickup',at:gone(player.pickupTotal,player.pickup)};
  if(player.grab){const m=player.moveState;if(m&&(m.name==='throw'||m.name==='knee'))return {pose:m.name==='throw'?'throw':'grab',role:m.role,k:m.k};return {pose:'grab',role:'grab'};}
  if(player.special>0)return {pose:'special',role:'mega',at:gone(player.specialTotal,player.special)};
  // the last life: the death fall (knockHard), then its lying frame under the continue count
  if(player.down)return {pose:'down',role:'knockHard',at:player.downT};
  // knocked flat: thrown back on the knock clip's first frame (lifted as it flies), the bounces to lying, then the get-up;
  // a lost life holds the lying frame until the next life drops in
  if(player.hurt>0&&player.knocked){const t=gone(player.hurtTotal,player.hurt),kt=heroClipTiming(player.knockRole),kl=kt?kt.len:.6,fly=kt?kt.at[1]||kl:.28;
    if(player.dying||t<kl)return {pose:'knocked',role:player.knockRole,at:t,lift:t<fly?Math.sin(t/fly*Math.PI)*18:0};
    return {pose:'knocked',role:'getup',at:t-kl};}
  if(player.hurt>0)return {pose:'hurt',role:player.hurtRole,at:gone(player.hurtTotal,player.hurt)};
  if(player.attack>0&&player.attackKind==='dash')return player.dashPhase==='end'?{pose:'dash',role:'dashEnd',at:gone(player.attackTotal,player.attack)}:{pose:'dash',role:'dash',at:player.dashT};
  if(player.attack>0&&player.attackKind==='air')return {pose:'air',role:player.airRole||'airKick',at:gone(player.attackTotal,player.attack)};
  // combo moves (start or contact clip) and the grab throw after its release, on the move's own frame
  const m=player.moveState;if(m)return {pose:'attack',role:m.role,k:m.k};
  // a stab, a swing or a throw plays its clip once; the stance shows for the rest of the cooldown
  if(player.attack>0&&(player.attackKind==='weapon-melee'||player.attackKind==='throw')){const s=heroAnim.swing&&h?.cls[heroAnim.swing],role=s&&has(s.attack)?s.attack:'attack.throwable',t=gone(player.attackTotal,player.attack);
    return t<heroClipLen(role,0)?{pose:'attack',role,at:t}:{pose:'attack',role:stand};}
  // every shot plays the class's fire clip from frame 0 (shotT); the stance shows for the rest of the cooldown (§6.1 row 12)
  if(fire&&player.attack>0&&player.attackKind==='fire'){const role=C&&has(C.attack)?C.attack:stand;
    // the Uzi/M-16 walking burst (G3d): the smgWalkFire torso, one clip per round, over legsWalk, then the walking torso
    if(player.walkFire&&C){if(has(C.walkFire)&&player.shotT<heroClipLen(C.walkFire,0))return {pose:'fire',role:C.walkFire,legs:'legsWalk',at:player.shotT};return has(C.walkTorso)?{pose:'fire',role:C.walkTorso,legs:'legsWalk'}:{pose:'fire',role:'walk'};}
    return player.shotT<heroClipLen(role,0)?{pose:'fire',role,at:player.shotT}:{pose:'fire',role:stand};}
  if(air)return {pose:fire?'armed-jump':'jump',role:player.jumpRole||(player.run?'jumpRun':mv?'jumpFwd':'jumpUp')};
  if(mv)return player.run?run(fire?'armed-run':'run'):walk(fire?'armed-walk':'walk');
  if(player.land>0)return {pose:fire?'armed-ready':'land',role:player.landRole||'land',at:gone(player.landTotal,player.land)};
  return {pose:fire?'armed-ready':'idle',role:stand};
}
// updateHeroAnim (HEROES §11): runs at the end of every update (dt, distance moved) and again with dt 0 before each draw,
// so a state changed outside the update (a control call, a test hook) shows at once. A pinned state shows the frame of
// its own clock (the clip is never ticked, so hitstop holds it with the state); a free-running role starts when the
// selection changes, then runs on by itself (looping or holding), and is not ticked in the update that started it, so
// its first frame shows its full (KI11-trimmed) length. Hitstop freezes the clips (D5).
function updateHeroAnim(dt,moved){
  if(!player)return;
  if(driving){player.pose='driving';return;}
  const R=RIG(),A=heroAnim;
  const sel=heroRoles();player.pose=sel.pose;A.sel=sel;
  if(!R)return;
  if(!A.main)A.main=R.player();if(!A.legs)A.legs=R.player();
  const id=HEROES[selected].id,sp=R.hero(id).speed||{},rate=role=>(isRunClip(role)?(sp.run||sp.walk*1.68):sp.walk)||1.6;
  if(A.force){R.play(A.main,id,A.force.role,{restart:true,k:A.force.k});A.sel={...sel,legs:null,lift:0};A.want=null;}
  else{
    const role=R.clip(id,sel.role)?sel.role:'idle';
    if(sel.k!=null||sel.at!=null){
      const t=heroClipTiming(role),k=t?(sel.k!=null?Math.max(0,Math.min(sel.k|0,t.f.length-1)):heroFrameAt(t,sel.at)):0;
      if(A.main.role!==role||A.main.hero!==id||!A.main.clip)R.play(A.main,id,role,{restart:true});
      A.main.k=k;A.main.t=t&&sel.at!=null?Math.max(0,(k+1<t.at.length?t.at[k+1]:t.len)-sel.at):0;A.main.done=false;A.main.ended=false;A.want='@'+role;
      // a pinned torso over walking legs (the walking burst): the legs advance by the distance moved
      if(sel.legs){const r0=A.legs.role,h0=A.legs.hero;R.play(A.legs,id,sel.legs);if(dt>0&&!(player.freeze>0)&&A.legs.role===r0&&A.legs.hero===h0)R.advance(A.legs,moved/rate(sel.legs));}
    }else{
      let fresh=false,legsFresh=false;
      if(A.want!==role){
        // a role already showing carries on when it is selected next, unless a pinned state showed in between
        if(A.main.role!==role||A.main.hero!==id||String(A.want).startsWith('@')){R.play(A.main,id,role,{restart:true});fresh=true;}
        A.want=role;
      }
      if(sel.legs){const r0=A.legs.role,h0=A.legs.hero;R.play(A.legs,id,sel.legs);legsFresh=A.legs.role!==r0||A.legs.hero!==h0;}
      if(dt>0&&!(player.freeze>0)){
        if(!fresh){if(isLoco(A.main.role))R.advance(A.main,moved/rate(A.main.role));else R.tick(A.main,dt);}
        if(sel.legs&&!legsFresh)R.advance(A.legs,moved/rate(sel.legs));
      }
    }
    // the torch flame keeps its own clock (HEROES §7.10, KI6), placed where the torch was one update earlier
    if(player.weapon==='torch'){if(dt>0){A.flame=A.flame||R.flame();R.flameUpdate(A.flame,id,sel.legs?{torso:A.main,legs:A.legs}:{full:A.main},'torch',{dt,running:!!(player.move&&player.run),x:player.x,z:player.z,dir:player.dir});}}
    else A.flame=null;
  }
  const f=R.frame(A.main),lf=A.sel.legs?R.frame(A.legs):null;
  player.anim=f?{hero:id,role:A.main.role,id:A.main.clip.id,k:A.main.k,rec:f[0],hold:f[3],legs:lf?{role:A.legs.role,id:A.legs.clip.id,k:A.legs.k,rec:lf[0]}:null}:null;
}
// The muzzle of the next shot in game units (HEROES §7.3): the weapon origin on the shot frame of the hero's attack clip
// plus the ROM spawn offset (fwd, up). `muzzle` is ahead of the feet and `y` above them; no frame carries a drawn-in gun.
function gunMount(){
  const R=RIG(),m=R&&player.weapon?R.muzzle(HEROES[selected].id,player.weapon):null,S=CFG.sockets.scale;
  return m?{x:-m.x*S,y:-m.y*S,muzzle:-m.x*S,held:true,gunDrawn:false}:{x:0,y:0,muzzle:0,held:true,gunDrawn:false};
}
// snapshot.held: the weapon part of the last draw {weapon, rec, hold, lx, ly, w, h, origin} in native feet space
// (tight top-left lx/ly = origin - (ox, oy); the art faces left).
let lastHeld=null;
function drawPlayer() {
  if(NETROLE==='client'){drawReplicaPlayer();return;}
  lastHeld=null;
  const x=player.x-viewX,y=player.y-player.z;ctx.save();if(!driving)shadow(ctx,x,player.y,20);   // the car draws its own
  if(player.inv>0&&Math.floor(time*16)%2===0)ctx.globalAlpha=.65;
  if(driving){player.pose='driving';car(ctx,x,y,{hero:selected,roll:player.roll,moving:true,bank:player.bank,bump:player.bump,brake:player.brake,t:time,passengers:multi()?present().filter(passenger).map(q=>q.mp.hero):null});}
  else {
    updateHeroAnim(0,0);
    const R=RIG(),A=heroAnim,sel=A.sel,id=HEROES[selected].id;
    if(R&&sel&&A.main?.clip){
      const body=sel.legs?{torso:A.main,legs:A.legs}:{full:A.main};let w=player.weapon&&R.hero(id).hold[player.weapon]?player.weapon:null;
      // HEROES §7.9: from the round that empties a rifle or an M-16 to its hurl the hold table shows the empty club pose
      // (rifle-empty / m16-empty, pose slots 2 and 6) at the same hold
      if(w&&player.ammo<=0&&R.hero(id).hold[w+'-empty'])w+='-empty';
      R.draw(ctx,R.parts(id,body,w,w==='torch'&&A.flame?{flame:A.flame}:null),x,player.y-(sel.lift||0),player.z,player.dir,CFG.sockets.scale,'hero');
      const held=w?R.weaponAt(id,body,w):null;
      if(held)lastHeld={weapon:w,rec:held.rec,hold:held.hold,lx:held.lx,ly:held.ly,w:held.w,h:held.h,origin:held.origin};
    }
  }
  // the special ring grows over the mega crash's own length (Mustapha's 118 f tornado included)
  if(player.special>0){const k=clamp(1-player.special/(player.specialTotal||.65),0,1);ctx.strokeStyle=HEROES[selected].color;ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(x,y-30,63*(.28+.72*k),24,0,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}
// Containers are the ROM's own breakable objects (PLAN §7 G6 3; ROM_FX.props → ROM_FX.containers): a crate is DRAMCAN,
// the oil drum the 1993 streets place and break (the ROM has no wooden crate), a barrel is TARU; anim 0 standing, in the
// chapter's OBJ palette page at one arcade px per art px. A plain vector box stands in until the fx sheet decodes.
const propOf=type=>{const P=window.ROM_FX?.props?.[type];return P&&P.rec!=null?P:null;};
function drawObject(o){if(o.hp<=0)return;if(o.boss){drawBossObject(o);return;}const x=o.x-viewX;if(x<-44||x>W+44)return;const P=propOf(o.type),C=P&&window.ROM_FX.containers?.[P.container],rec=C?.anims?.[0]?.[0]?.[0]??P?.rec;if(rec!=null&&fxDraw(rec,x,o.y,0,-1))return;legacy(ctx,x,o.y,()=>{shadow(ctx,0,0,23,6);rect(ctx,-23,-46,46,46,'#3b4c33');rect(ctx,-21,-44,42,40,'#9b7b4c');for(let j=0;j<3;j++)rect(ctx,-18+j*13,-42,2,38,'#5e603e');rect(ctx,-23,-43,46,6,'#bf9959');rect(ctx,-23,-9,46,6,'#bf9959');});}
// Food, score items and ammunition are the arcade's own item records (ROM_FX.items.frames: name -> rec, heal, score,
// kind), drawn at their ROM origin on the ground.
const ITEMS=window.ROM_FX.items;
const PICKUPS=new Set(['food','bonus','ammo']);
const FOOD_WEIGHTS=[['hamburger',12],['hotdog',10],['pizza',10],['salad',8],['steak',6],['barbecue',4],['roast',4],['lobster',4],['sushi',3],['cake',5],['fries',6],['pudding',4],['parfait',4],['donut',8],['coffee',6],['croissant',6],['gum',5],['chocolate',5]];
const BONUS_WEIGHTS=[['sunglasses',10],['necklace',6],['ring',6],['pouch',5],['pearls',4],['ammonite',4],['skull',2],['goldbar',3],['diamond',2]];
function pickWeighted(list){let t=0;for(const [,w] of list)t+=w;let r=Math.random()*t;for(const [k,w] of list){r-=w;if(r<=0)return k;}return list[0][0];}
// Food never times out on the ground (as in the arcade); `rich` picks from the big meals for elite drops and section starts.
function foodDrop(x,y,life=999,rich=false){return {x,y,type:'food',food:pickWeighted(rich?FOOD_WEIGHTS.filter(f=>(ITEMS.frames[f[0]]?.heal||0)>=48):FOOD_WEIGHTS),life};}
function bonusDrop(x,y,life=999){return {x,y,type:'bonus',food:pickWeighted(BONUS_WEIGHTS),life};}
function consumeItem(d){
  const f=ITEMS.frames[d.food]||ITEMS.frames.hamburger||{heal:48,score:1000};const i=drops.indexOf(d);if(i>=0)drops.splice(i,1);d.claimed=true;sfx('pickup');
  if(d.type==='food'){voice('food');const heal=Math.round(player.maxhp*(f.heal||48)/100);
    // Eaten at full health, a meal is worth its points instead, as on the cabinet.
    if(player.hp>=player.maxhp-.5){score+=f.score||1000;popup(player.x,player.y-71,'+'+(f.score||1000),'#ffe08a');}else{player.hp=Math.min(player.maxhp,player.hp+heal);popup(player.x,player.y-71,d.food.toUpperCase()+' +'+heal,'#d5ec69');}}
  else if(d.type==='bonus'){score+=f.score||1000;popup(player.x,player.y-71,'+'+(f.score||1000),'#ffe08a');}
  else if(d.type==='ammo'){const w=WEAPONS[player.weapon];if(w&&!w.melee&&!w.thrown){player.ammo=w.ammo;popup(player.x,player.y-71,'AMMO FULL','#9ad1ff');}else{score+=1000;popup(player.x,player.y-71,'+1000','#ffe08a');}}
}
function drawDrop(d) {
  // Items are ROM records, drawn at one arcade px per art px. A weapon on the ground is its ROM ground record at 1x about
  // its origin (HEROES §7.1, §7.12; no longer the legacy sheet at x0.85); knocked loose it spins through its 16 ROM
  // rotations (10 f each) until it lands. The torch keeps its flame on the ground.
  if(d.claimed)return;const x=d.x-viewX,y=d.y+Math.sin(time*4+d.x)*1.5;if(x<-44||x>W+44)return;shadow(ctx,x,d.y,12);
  if(PICKUPS.has(d.type)){const f=ITEMS.frames[d.food]||ITEMS.frames.hamburger;if(f)fxDraw(f.rec,x,Math.round(y),0,-1);}
  else{const RW=ROMW(d.type),air=d.z>0&&RW?.rot?.length,ri=air?Math.floor((60-d.life)*6)%RW.rot.length:-1;
    if(RW)drawWeaponRec(d.type,air?RW.rot[ri]:RW.ground?.[0]?.[0],x,d.y,d.z||0,d.dir||-1,ri);}
  if(Math.hypot(d.x-player.x,d.y-player.y)<48&&!PICKUPS.has(d.type))legacy(ctx,x,y,()=>label((TOUCH?'HIT / PICK · ':'J / E · ')+(WEAPONS[d.type]?.name||d.type.toUpperCase()),0,-35,10,'#f0e0a8','center'));
}
// World labels use the legacy canvas-px sizes under LEG (offset 1); the screen pass (HUD, cards, continue) draws in arcade
// screen px at half the old canvas sizes, so its drop shadow is half a pixel (screenText).
let screenText=false;
function label(text,x,y,size=12,color='#ecebcf',align='left'){const o=screenText?.5:1;ctx.font=`bold ${size}px Consolas, monospace`;ctx.textAlign=align;ctx.fillStyle='#12261e';ctx.fillText(text,x+o,y+o);ctx.fillStyle=color;ctx.fillText(text,x,y);}
const ENEMY_LABEL={raider:'POACHER',knifer:'KNIFER',gunner:'GUNNER',brute:'HEAVY',raptor:'RAPTOR',mutant:'GRAFT',biker:'RIDER',regent:'REGENT',slicer:'BRAWLER',mirror:'MIRROR TEST'};
// Regulars show their variant's ROM HUD name (ENEMIES §1.3: FERRIS, GNEISS, BLADE, POACHER J, HAMMER T., R HOPPER, TYROG...),
// except a chapter's `guard` name for its human regulars (chapter 6: CROWN GUARD); copies their hero's name, elites and
// bosses their own; ENEMY_LABEL is the fallback without enemy-kinds.js.
const GUARD_KINDS=new Set(['raider','knifer','gunner','brute']);
function enemyLabel(e){if(level?.guard&&!e.elite&&!e.boss&&!e.setPiece&&GUARD_KINDS.has(e.type))return level.guard;return e.elite?e.name:e.boss?(e.type==='sable'&&e.phase===2?BDEF.sable?.phase2?.name||'SABLE · GATE CONTROLS':e.name||level.boss):e.type==='mirror'?HEROES[e.hero]?.name||ENEMY_LABEL.mirror:(romKind(e)||e.type==='zeke')&&EK.variantData(e.type,e.v)?.hud||ENEMY_LABEL[e.type]||e.type.toUpperCase();}
// ---------------------------------------------------------------- the cabinet HUD (PLAN §7 G7; ARCHITECTURE §1.7)
// Arcade screen px, the ROM font (ARCADE_UI.text) and ROM pieces (ROM_UI, built by sprites-ui.cjs §3/§3b from the tables
// the cabinet's draw routines read). ROM_UI.hud.layout holds the cabinet positions, read from the live scroll1 dumps of
// stg-ep1-walk: the P1 block is the face (0,0), "=lives" (24,0), the score right-aligned to x 128 on row 0, the name
// (24,8) and the life bar (24,16); under it the last foe's face (0,24), name (24,24) and bar (24,32). INSERT COIN and
// JOIN-IN take turns in the slots at x 136 / 264 (y 16-31). The weapon panel is the cabinet's (0,208)-(120,224) (0x23A24).
// The sequel's own lines (toasts, the mission, the objective arrow, the special, the combo) use the cells the 1-player
// cabinet leaves empty right of the P1 block: rows y 0-15 and y 34-41 from x 136. Nothing of the HUD draws below y 44
// except the weapon panel and transient cards (boss card, GO, caption, radio, continue). LAST_EDEN.layout reports the
// rects in canvas px, with font:'rom' once the ROM glyphs decode (tests/lib/arcade.cjs reads it as the G7 marker).
const LAYOUT_ARCADE={hud:[0,0,W,44],radio:[8,46,368,32],weapon:[0,208,120,16]};
const LAYOUT=Object.fromEntries(Object.entries(LAYOUT_ARCADE).map(([k,r])=>[k,r.map(v=>v*PX)]));
const HUD_FALLBACK={face:[0,0],lives:[24,0],scoreRight:[128,0],name:[24,8],bar:[24,16],foe:{face:[0,24],name:[24,24],bar:[24,32]},insertCoin:[[136,16],[264,16]],joinIn:[[152,16],[280,16]],blink:{period:128,joinIn:[0,48],insertCoin:[64,112]}};
const hudData=()=>window.ROM_UI||null;
const hudLayout=()=>hudData()?.hud?.layout||HUD_FALLBACK;
const css24=c=>'#'+(c>>>0).toString(16).padStart(6,'0');
// a ui record through a palette map (the cabinet pieces use `hud`: slot = scroll1 palette row); false until it can draw
function hudRec(rec,x,y,map='hud'){const SP=window.SPRITES;try{return !!rec&&!!SP&&!!SP.familyReady?.('ui')&&SP.drawRec(ctx,'ui',rec,map,x,y,false);}catch(e){return false;}}
// one 8-px cell of a ui record strip (the score digits)
function hudCell(rec,i,x,y){const SP=window.SPRITES;try{if(!rec||!SP?.familyReady?.('ui'))return false;const l=SP.locate('ui',rec);if(!l)return false;const c=SP.canvasFor(l.key,'hud',null,l.r);if(!c)return false;ctx.drawImage(c,l.r[0]+i*8,l.r[1],8,l.r[3],x,y,8,l.r[3]);return true;}catch(e){return false;}}
// HUD text in the ROM 8x8 font (ARCADE_UI.text); the legacy label only while arcade-ui.js is missing
function hudText(str,x,y,o={}){const U=UI();if(U)return U.text(ctx,str,x,y,Object.assign({font:8},o));label(String(str),x,y+7,6,'#f8f8f8',o.align||'left');return null;}
// The cabinet life bar (0x16446 player, 0x174F2 foe): 8-px tiles from x, a left cap, k mids and a right cap, where k is the
// ROM count for the bar length `len` (len-6 in 8-px steps): a 1-px border (pen 3) round 12+8k px of interior, `fill` px of
// it in the fill pen from the left and the rest in the `under` pen.
function hudBar(x,y,len,fill,cols){let k=0;if(len>6){let d=len-6;while((d-=8)>0)k++;}const inner=8*k+12,f=clamp(Math.round(fill),0,inner),x0=x+1,x1=x+8*(k+2)-2;
 rect(ctx,x0,y,x1-x0+1,8,css24(cols[0]));rect(ctx,x0+1,y+1,inner,6,css24(cols[2]));if(f>0)rect(ctx,x0+1,y+1,f,6,css24(cols[1]));return {x0,x1,inner,fill:f};}
const BAR_P1=[0xffffff,0xffee00,0xee0000];
const BAR_CYCLE=[[0xffffff,0xffee00,0xee0000],[0xffffff,0x990099,0xffee00],[0xffffff,0x55ee55,0x990099],[0xffffff,0x0000dd,0x55ee55],[0xffffff,0xeeccbb,0x0000dd],[0xffffff,0xee44aa,0xeeccbb],[0xffffff,0x77ccff,0xee44aa],[0xffffff,0x00aaaa,0x77ccff]];
// The foe bar (0x17834): min(maxHP,100) px long; the HP shows modulo 100 (100 stays 100) in the colours of its 100-HP
// layer, cycling through the ROM's eight (0x17892): every layer's `under` is the fill of the layer below it.
function foeBarState(hp,maxhp){const h=Math.max(0,Math.ceil(hp)),layer=h>0?Math.ceil(h/100)-1:0,cyc=hudData()?.lifeBar?.foe?.cycle||BAR_CYCLE;return {len:Math.min(100,Math.max(1,Math.round(maxhp))),fill:h-layer*100,layer,cols:cyc[layer%cyc.length]};}
// Foe faces (0x179B6): regulars by their variant's ROM HUD name (the +0x03 index), bosses by their body, copies by their
// hero (the kind-2 faces of 0x17A82).
const BODY_FACE={butcher:'0x0F',torikeratopss:'0x11',arosaurus:'0x07',morgan:'0x15',slice:'0x05',richmond:'0x0C',fessenden:'0x22',sable:'0x0C',crownback:'0x22',rook:'0x0F',krag:'0x11',ironclub:'0x11',thorne:'0x07',glassback:'0x07',cinder:'0x15',overdrive:'0x15',echo:'0x05',engine:'0x05'};
const FACE_BY_TYPE={'thurow:T':'0x24','thurow:U':'0x1D','naguri:N':'0x1E','knifeonly:P':'0x1C'};   // names the ROM table lists twice
const hex2=i=>'0x'+i.toString(16).toUpperCase().padStart(2,'0');
function foeFaceRec(e){const F=hudData()?.foeFaces;if(!F||!e)return null;
 if(e.type==='mirror')return F.hero[HEROES[e.hero]?.id]||null;
 if(e.boss){const b=BDEF[e.type]?.body;return BODY_FACE[b]?F.enemy[BODY_FACE[b]]||null:null;}
 if(!(romKind(e)||e.type==='zeke'))return null;const t=EK.typeOf?.(e.type,e.v),o=FACE_BY_TYPE[t+':'+e.v];if(o)return F.enemy[o]||null;
 const i=(F.names||[]).indexOf(EK.variantData(e.type,e.v)?.hud);return i>=0?F.enemy[hex2(i)]||null:null;}
// The P1 block has 13 cells for a name (x 24-127; slot 2's INSERT COIN starts at x 136, so a 14th cell would run into it).
// A longer sequel name keeps the part after its last ' · ' (SABLE · GATE CONTROLS -> GATE CONTROLS), else its last word
// (FOREMAN CINDER -> CINDER, MARSHAL SABLE -> SABLE), cut to 13 cells.
const HUD_NAME_CELLS=13;
function hudName(s){s=String(s||'').toUpperCase().trim();if(s.length<=HUD_NAME_CELLS)return s;const i=s.lastIndexOf(' · ');if(i>=0)return hudName(s.slice(i+3));const w=s.split(/\s+/);return w[w.length-1].slice(0,HUD_NAME_CELLS);}
function foeName(e){if(e.type==='mirror'&&!e.elite){const n=hudData()?.foeFaces?.heroNames?.[HEROES[e.hero]?.id];if(n)return n;}return hudName(enemyLabel(e));}
// The foe slot: the boss, else the elite on stage, else the last enemy hit. A beaten one stays for 1 s with an empty bar,
// as the cabinet keeps the slot 60 frames after the hit that takes the HP to 0.
let hudFoe=null;
function currentFoe(){const live=e=>e&&!e.dead&&!e.dying&&e.hp>0&&enemies.includes(e);
 const f=enemies.find(e=>e.boss&&!e.dead)||enemies.find(e=>e.elite&&!e.dead&&e.state!=='flee'&&e.onstage)||(live(lastHitEnemy)?lastHitEnemy:null);
 if(f){hudFoe={e:f,t:time};return f;}
 if(hudFoe&&time-hudFoe.t<1&&hudFoe.e===lastHitEnemy)return hudFoe.e;hudFoe=null;return null;}
// The weapon panel (0x23A24): a firearm shows its icon, the rounds right-aligned in 2 cells (red at or under the ROM's low
// count), its name and the 12-tile ammo strip (2 units a tile: rounds x 4/4/1/1/4/6, (rounds+1)>>1 for UZI and M-16A1);
// every other weapon shows the ARM icon and its name at x 32.
function weaponPanel(){if(NETROLE==='client'&&!players[localSlot])return;const w=player.weapon;if(!w||driving)return;const P=hudData()?.weaponPanel,ammo=Math.max(0,player.ammo|0);
 const fire=FIREARMS.has(w),name=(P?.names?.[w]||WEAPONS[w]?.name||w).toUpperCase(),[ix,iy]=P?.icon||[0,208];
 hudRec(P?.icons?.[fire?w:'arm'],ix,iy);
 if(!fire){const [nx,ny]=P?.otherName||[32,208];hudText(name,nx,ny);return;}
 const [ax,ay]=P?.ammo||[32,208,2],low=ammo<=(P?.lowAmmo?.[w]??2);hudText(String(Math.min(99,ammo)),ax+16,ay,{align:'right',pen:low?'#ff0000':'#ffffff'});
 const [nx,ny]=P?.name||[48,208];hudText(' '+name,nx,ny);
 const half=(P?.halfUnits||['uzi','m16']).includes(w),k=P?.units?.[w]??4,[sx,sy,n]=P?.strip||[24,216,12];let u=half?(ammo+1)>>1:ammo*k;
 for(let i=0;i<n;i++){const rec=u>=2?P?.tiles?.full:u===1?P?.tiles?.half:null;if(rec)hudRec(rec,sx+i*8,sy);u=Math.max(0,u-2);}}
// The ROM font has no arrows: a HUD line spells them with the glyphs it has (MOVE → -> MOVE >, STEER ↑↓ -> STEER UP/DOWN).
const hudArrows=t=>String(t).toUpperCase().replace(/→/g,'>').replace(/←/g,'<').replace(/↑↓|↓↑/g,'UP/DOWN').replace(/↑/g,'UP').replace(/↓/g,'DOWN');
// The sequel's lines in the free cells of the top rect (x 136-376): a toast (two rows of 31 cells, y 0-15) or, without
// one, the mission (row 0) and the lock hint or the objective arrow (row 1); the special and the combo on y 34.
function hudLines(){
 if(toastTime>0&&toast){const U=UI(),txt=hudArrows(toast),rows=U?U.wrap(txt,31).slice(0,2):[txt];rect(ctx,132,0,W-132,16,'#05100fb0');rows.forEach((r,i)=>hudText(r,258,(rows.length===1?4:0)+i*8,{align:'center',pen:'#e0e8a8'}));}
 else{
  if(mission){hudText(`${mission.spec.verb.toUpperCase()} ${mission.completed}/${mission.total}`,136,0,{pen:'#afded4'});
   const n=allies.filter(a=>a.state!=='retreat').length;if(n)hudText('FREED ×'+n,376,0,{align:'right',pen:'#ffe08a'});}
  const t=mission?.active,off=t&&(t.x-camera<22||t.x-camera>W-22);
  if(off)hudText(t.x<player.x?'< OBJECTIVE':'OBJECTIVE >',t.x<player.x?136:376,8,{align:t.x<player.x?'left':'right',pen:'#99e5d8'});
  else if(lock&&!bossSpawned)hudText(enemies.length?'CLEAR THE AREA':'COMPLETE THE OBJECTIVE',136,8,{pen:'#d4cf9e'});}
 const h=HEROES[selected];
 if(player.specialCd>0)hudText('SPECIAL '+Math.ceil(player.specialCd)+'S',136,34,{pen:'#a6b797'});else hudText(driving?'L · RAM READY':'L · '+h.special.toUpperCase(),136,34,{pen:'#d5ec69'});
 if(combo>=2)hudText(combo+' HIT COMBO',376,34,{align:'right',pen:'#d5ec69'});}
// INSERT COIN / JOIN-IN take turns (stg-ep1-walk: a 128-frame cycle of JOIN-IN 48 frames, 16 off, INSERT COIN 48, 16 off);
// with credits in, both turns call JOIN-IN.
function coinSlots(){const L=hudLayout(),B=L.blink||HUD_FALLBACK.blink,f=Math.floor(time*60)%B.period,U=hudData()?.hud;
 const join=f>=B.joinIn[0]&&f<B.joinIn[1],ins=f>=B.insertCoin[0]&&f<B.insertCoin[1];if(!join&&!ins)return;
 const asJoin=join||coins>0;for(let s=0;s<2;s++){const at=asJoin?L.joinIn[s]:L.insertCoin[s];if(!hudRec(asJoin?U?.joinIn:U?.insertCoin,at[0],at[1]))hudText(asJoin?'JOIN-IN':'INSERT COIN',at[0]+(asJoin?40:56),at[1]+4,{align:'center',pen:'orange',outline:true});}}
// ---- 2-3 players (§3.12): the cabinet's three blocks at x 0 / 128 / 256, each its player's face, lives, score, name and
// bar (CONTINUE? n during that player's count) over its own foe row; an empty or spent slot calls INSERT COIN / JOIN-IN
// (steady JOIN-IN while a joiner waits for the next break). The toast moves to a centred line under the radio strip,
// the mission counter and this machine's special and combo to the foot of the screen beside its weapon panel.
const slotAt=(s,p)=>[p[0]+128*(s-1),p[1]];
let joinWait=0;
function hudSlotCall(s){const L=hudLayout(),B=L.blink||HUD_FALLBACK.blink,f=Math.floor(time*60)%B.period,U=hudData()?.hud,wait=(joinWait>>s)&1;
 const join=wait||f>=B.joinIn[0]&&f<B.joinIn[1],ins=!wait&&f>=B.insertCoin[0]&&f<B.insertCoin[1];if(!join&&!ins)return;
 const asJoin=join||coins>0,at=slotAt(s,asJoin?L.joinIn[0]:L.insertCoin[0]);if(!hudRec(asJoin?U?.joinIn:U?.insertCoin,at[0],at[1]))hudText(asJoin?'JOIN-IN':'INSERT COIN',at[0]+(asJoin?40:56),at[1]+4,{align:'center',pen:'orange',outline:true});}
function hudBlock(ox,s){const L=hudLayout(),R=hudData(),h=HEROES[selected],m=player.mp;
 if(!hudRec(R?.hudFaces?.[h.id],L.face[0]+ox,L.face[1],'ui'))rect(ctx,L.face[0]+ox,L.face[1],23,23,'#1a2a4a');
 hudText('='+Math.max(0,Math.min(9,lives)),L.lives[0]+ox,L.lives[1]);
 const sc=String(Math.max(0,Math.floor(score)));for(let i=0;i<sc.length;i++){const x=L.scoreRight[0]+ox-8*(sc.length-i);if(!hudCell(R?.hud?.score,+sc[i],x,L.scoreRight[1]))hudText(sc[i],x,L.scoreRight[1],{pen:'#99ccff'});}
 hudText(R?.hud?.names?.[h.id]||h.name,L.name[0]+ox,L.name[1]);
 if(m&&m.cont){if(Math.floor(time*60/16)%2===0)hudText('CONTINUE? '+Math.max(0,Math.ceil(m.cont.t)),L.bar[0]+ox,L.bar[1],{pen:'orange'});}
 else{const r=clamp(player.hp/player.maxhp,0,1);hudBar(L.bar[0]+ox,L.bar[1],100,player.hp>0?Math.max(1,Math.round(100*r)):0,R?.lifeBar?.pens?.colours||BAR_P1);}
 const foe=currentFoe();if(foe){hudRec(foeFaceRec(foe),L.foe.face[0]+ox,L.foe.face[1]);hudText(foeName(foe),L.foe.name[0]+ox,L.foe.name[1]);const st=foeBarState(foe.dying||foe.dead?0:foe.hp,foe.maxhp);hudBar(L.foe.bar[0]+ox,L.foe.bar[1],st.len,st.fill,st.cols);}}
function hudLinesMP(){
 const U=UI(),y=bossCard?122:84;
 if(toastTime>0&&toast){const txt=hudArrows(toast),rows=U?U.wrap(txt,42).slice(0,2):[txt];rect(ctx,20,y-2,W-40,rows.length*8+4,'#05100fb0');rows.forEach((r,i)=>hudText(r,192,y+i*8,{align:'center',pen:'#e0e8a8'}));}
 if(mission){hudText(`${mission.spec.verb.toUpperCase()} ${mission.completed}/${mission.total}`,376,216,{align:'right',pen:'#afded4'});const n=allies.filter(a=>a.state!=='retreat').length;if(n)hudText('FREED ×'+n,376,208,{align:'right',pen:'#ffe08a'});}
 const t=mission?.active,off=t&&player&&(t.x-camera<22||t.x-camera>W-22);
 if(off)hudText(t.x<player.x?'< OBJECTIVE':'OBJECTIVE >',t.x<player.x?128:376,198,{align:t.x<player.x?'left':'right',pen:'#99e5d8'});
 if(player&&player.mp&&onField(player)){const h=HEROES[selected];if(player.specialCd>0)hudText('SPECIAL '+Math.ceil(player.specialCd)+'S',128,208,{pen:'#a6b797'});else hudText(driving?'L · RAM READY':'L · '+h.special.toUpperCase(),128,208,{pen:'#d5ec69'});
  if(combo>=2)hudText(combo+' HIT COMBO',128,216,{pen:'#d5ec69'});}}
function hudMP(){
 for(let s=0;s<MAXP;s++){const p=players[s];if(p&&!p.mp.out)withPlayer(p,()=>hudBlock(128*s,s));else if(s>0||p)hudSlotCall(s);}
 weaponPanel();hudLinesMP();hudTail();}
function hudTail(){
 // the boss card (bossCard, phase2.card, lastCopy.card): a transient card under the radio strip (y 84-120)
 if(bossCard&&UI()){const c=bossCard,frames=Math.max(1,Math.round(c.total*60)),t=clamp(Math.floor((c.total-c.t)*60),0,frames-1);UI().bossCard(ctx,{name:c.name,sub:c.sub,t,frames,y:84,accent:c.pink?'pink':(level.accent||'red')});}
 // GO: the arcade's blinking call to move on (a transient card at the right edge of the lanes)
 if(!bossSpawned&&!lock&&toastTime<=0&&state==='play'&&Math.floor(time*60/32)%2===0){hudText('GO',360,96,{font:16,align:'right',pen:'yellow',outline:true});rect(ctx,362,103,6,2,'#f8d838');for(let i=0;i<4;i++)rect(ctx,368+i,100+i,1,8-2*i,'#f8d838');}}
function hud(){if(multi()||NETROLE==='client'){hudMP();return;}const L=hudLayout(),R=hudData(),h=HEROES[selected];
 // P1 block: face, lives, score, name, life bar
 if(!hudRec(R?.hudFaces?.[h.id],L.face[0],L.face[1],'ui'))rect(ctx,L.face[0],L.face[1],23,23,'#1a2a4a');
 hudText('='+Math.max(0,Math.min(9,lives)),L.lives[0],L.lives[1]);
 const sc=String(Math.max(0,Math.floor(score)));for(let i=0;i<sc.length;i++){const x=L.scoreRight[0]-8*(sc.length-i);if(!hudCell(R?.hud?.score,+sc[i],x,L.scoreRight[1]))hudText(sc[i],x,L.scoreRight[1],{pen:'#99ccff'});}
 hudText(R?.hud?.names?.[h.id]||h.name,L.name[0],L.name[1]);
 const r=clamp(player.hp/player.maxhp,0,1);hudBar(L.bar[0],L.bar[1],100,player.hp>0?Math.max(1,Math.round(100*r)):0,R?.lifeBar?.pens?.colours||BAR_P1);
 // the foe row
 const foe=currentFoe();if(foe){hudRec(foeFaceRec(foe),L.foe.face[0],L.foe.face[1]);hudText(foeName(foe),L.foe.name[0],L.foe.name[1]);const s=foeBarState(foe.dying||foe.dead?0:foe.hp,foe.maxhp);hudBar(L.foe.bar[0],L.foe.bar[1],s.len,s.fill,s.cols);}
 coinSlots();weaponPanel();hudLines();
 // the boss card (bossCard, phase2.card, lastCopy.card): a transient card under the radio strip (y 84-120)
 if(bossCard&&UI()){const c=bossCard,frames=Math.max(1,Math.round(c.total*60)),t=clamp(Math.floor((c.total-c.t)*60),0,frames-1);UI().bossCard(ctx,{name:c.name,sub:c.sub,t,frames,y:84,accent:c.pink?'pink':(level.accent||'red')});}
 // GO: the arcade's blinking call to move on (a transient card at the right edge of the lanes)
 if(!bossSpawned&&!lock&&toastTime<=0&&state==='play'&&Math.floor(time*60/32)%2===0){hudText('GO',360,96,{font:16,align:'right',pen:'yellow',outline:true});rect(ctx,362,103,6,2,'#f8d838');for(let i=0;i<4;i++)rect(ctx,368+i,100+i,1,8-2*i,'#f8d838');}}
// One transform for the world pass and the screen pass (ARCHITECTURE §1.2): x2, with the shake in whole arcade px.
function beginFrame(sx,sy){ctx.setTransform(PX,0,0,PX,PX*sx,PX*sy);ctx.imageSmoothingEnabled=false;}
// the players' sprite entries: one per player on the field (a passenger rides in the car, an out player is gone)
function playerDraws(carShadow){
  if(!multi()&&NETROLE!=='client')return [{y:player.y,fn:drawPlayer,sh:()=>{const x=player.x-viewX;if(driving)carShadow(x,player.y-player.z);else shadow(ctx,x,player.y,20);}}];
  return present().filter(p=>!p.mp.out&&!passenger(p)).map(p=>({y:p.y,fn:()=>withPlayer(p,drawPlayer),sh:()=>{const x=p.x-viewX;if(driving)carShadow(x,p.y-p.z);else shadow(ctx,x,p.y,20);}}));
}
// 1P / 2P / 3P over a hero's head in its slot colour for 2 s after a start, a drop-in or a continue (the arcade's start
// markers), and over this machine's hero while two heroes overlap
function drawTags(){const me=localPlayer();
  for(const p of present()){if(p.mp.out||passenger(p))continue;const near=p===me&&present().some(q=>q!==p&&!q.mp.out&&Math.abs(q.x-p.x)<24&&Math.abs(q.y-p.y)<16);
    if(!(p.mp.tag>0)&&!near)continue;legacy(ctx,p.x-viewX,p.y-p.z,()=>label((p.mp.slot+1)+'P',0,-132,13,SLOT_PEN[p.mp.slot]||'#ffffff','center'));}}
function render(){ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();
 // The camera and every world position are rounded separately (never x - camera), so sprites cannot slide against the floor.
 let sx=0,sy=0;if(shake>0){sx=Math.round(rand(-shake,shake)*LEG);sy=Math.round(rand(-shake/2,shake/2)*LEG);}beginFrame(sx,sy);viewX=Math.round(camera);screenText=false;
 // G6 screens: the attract story, the chapter card and its panels, the sunset road and the picture beats of the ending,
 // the staff roll (presentation(), below); the title, hero select and chapter list keep the stage backdrop and cast.
 if(state==='attract')drawAttract();
 else if(!started||['menu','select','chapters'].includes(state)){menuBackdrop();rect(ctx,0,0,W,H,'#0a221ec0');menuCast();rect(ctx,0,0,W,H,'#05131030');if(state==='menu')drawTitleLogo();}
 else if(state==='brief'&&card&&card.phase==='panel')drawCardScreen();
 else if(state==='credits'||(state==='ending'&&endScene()!=='world'))drawEndScene();
 else{
 // The world pass in the ARCHITECTURE §4.1 order: the stage's back layers (far layer, playfield pages with the loop and
 // rowscroll, animated cells), ground decals, every shadow, the y-sorted sprites, effects and particles, then the stage's
 // priority pixels (fg pages) over all of them. World y is drawn relative to cameraY; the stage passes take the camera.
 const ar=curArea(),cam={x:viewX,y:Math.round(cameraY)},sopt={road:roadStream};
 if(ar)SR.back(ctx,ar,cam,time,sopt);else rect(ctx,0,0,W,H,'#000000');
 ctx.save();ctx.translate(0,-cam.y);if(levelIndex===4&&ar?.id==='a2')drawHeroTanks();
 for(const z of zones){if(z.style==='land')continue;const x=z.x-viewX;
  // Crownback's jet lane: a water strip along his lane while the gills open, brighter while the jet runs
  if(z.mark){const k=clamp(1-z.t/z.total,0,1),rr=z.r*(.45+.55*k);ctx.fillStyle=`rgba(6,10,14,${(.28+.4*k).toFixed(3)})`;ctx.beginPath();ctx.ellipse(x,z.y,rr,rr*.36,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#e8d27a';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(x,z.y,z.r,z.r*.36,0,0,Math.PI*2);ctx.stroke();continue;}
  if(z.lane){const x0=Math.round(z.lane[0]-viewX),w=Math.round(z.lane[1]-z.lane[0]),tell=z.t>z.t0Fire,p=tell?.5+.5*Math.sin(time*18):1;ctx.fillStyle=tell?`rgba(91,191,218,${(.18+.14*p).toFixed(3)})`:'rgba(143,228,237,.42)';ctx.fillRect(x0,Math.round(z.y-z.r*.5),w,Math.round(z.r));ctx.fillStyle='#8fe4ed';for(let i=0;i<w;i+=10)if(((i/10)|0)%2===0){rect(ctx,x0+i,Math.round(z.y-z.r*.5),6,1,'#8fe4ed');rect(ctx,x0+i,Math.round(z.y+z.r*.5)-1,6,1,'#8fe4ed');}continue;}
  if(z.band){const k=z.t/z.total;ctx.fillStyle='#c9f1ff'+(k>0?'40':'90');ctx.fillRect(Math.round(lock?lock.left-viewX:0),z.band[0],W,z.band[1]-z.band[0]);for(let i=0;i<12;i++)rect(ctx,((i*37+time*60)%W),z.band[0]+((i*13)%Math.max(1,z.band[1]-z.band[0])),6,1,'#f2fbff');continue;}
  ctx.fillStyle=z.style==='flood'?'#5bbfda55':z.style==='fire'?'#ff8a3a44':z.style==='steam'?'#e8eef055':z.friendly?'#efb36638':'#e77d5a30';ctx.beginPath();ctx.ellipse(x,z.y,z.r,z.r*.4,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle=z.style==='flood'?'#8fe4ed':z.friendly?'#e8bd76':'#efa36b';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(x,z.y,z.r*(z.t/z.total),z.r*.4*(z.t/z.total),0,0,Math.PI*2);ctx.stroke();}
 // Each sprite entry carries its shadow (sh), drawn in the shadow pass with the sizes its draw call used before G2.
 const carShadow=(x,y)=>shadow(ctx,Math.round(x),Math.round(y)+1,118,5);
 const draws=[...objects.filter(o=>o.hp>0).map(o=>({y:o.y,fn:()=>drawObject(o),sh:()=>{const x=o.x-viewX;if(x>=-44&&x<=W+44)legacy(ctx,x,o.y,()=>shadow(ctx,0,0,23,6));}})),
  ...drops.map(d=>({y:d.y,fn:()=>drawDrop(d),sh:()=>{const x=d.x-viewX;if(!d.claimed&&x>=-44&&x<=W+44)shadow(ctx,x,d.y,12);}})),
  ...discards.map(d=>({y:d.y,fn:()=>drawDiscard(d),sh:()=>{const x=d.x-viewX;if(x>=-60&&x<=W+60)shadow(ctx,x,d.y,8);}})),
  ...enemies.map(e=>({y:e.y,fn:()=>drawFighter(e),sh:()=>{if(e.waiting||e.testHidden||(e.delay>0&&!e.onstage&&e.state!=='drop'))return;const x=e.x-viewX;if(x<-207||x>W+207)return;if(romKind(e)||e.type==='zeke'){enemyShadow(e,x);return;}if(e.boss){if(e.hidden||(e.type==='sable'&&e.phase===2))return;const w=bossShadowW(e);if(w)shadow(ctx,x,e.y,w);return;}shadow(ctx,x,e.y,19);}})),
  ...bossObjs.filter(o=>!objects.includes(o)).map(o=>({y:o.y,fn:()=>drawBossObject(o),sh:()=>{const x=o.x-viewX;if(x>=-44&&x<=W+44)shadow(ctx,x,o.y,o.falling?Math.max(6,22-o.z/12):14);}})),
  ...spillWheels.map(w=>({y:w.y,fn:()=>drawWheel(w),sh:()=>{}})),
  ...scenery.map(sc=>({y:sc.y,fn:()=>drawScenery(sc),sh:()=>{}})),
  ...allies.map(a=>({y:a.y,fn:()=>drawAlly(a),sh:()=>{const x=a.x-viewX;if(x>=-111&&x<=W+111)shadow(ctx,x,a.y);}})),
  ...(state==='ending'?endActors:[]).map(a=>({y:a.y,fn:()=>drawEndActor(a,a.x-viewX,a.y),sh:()=>{const x=a.x-viewX;if(x>=-111&&x<=W+111)shadow(ctx,x,a.y);}})),
  ...playerDraws(carShadow)];
 if(crown)draws.push({y:crown.y,fn:()=>drawCrown(crown),sh:()=>{const x=crown.x-viewX;if(x>-140&&x<W+140)shadow(ctx,x,crown.y+1,100,6);}});
 if(parkedCar&&!driving)draws.push({y:parkedCar.y,fn:()=>car(ctx,parkedCar.x-viewX,parkedCar.y),sh:()=>carShadow(parkedCar.x-viewX,parkedCar.y)});
 for(const item of mission?.items||[])draws.push({y:item.y,fn:()=>drawMissionItem(item),sh:()=>{const x=item.x-viewX;if(x>=-74&&x<=W+74)legacy(ctx,x,item.y,()=>{shadow(ctx,0,0,25,6);if(item.kind==='cargo')shadow(ctx,0,0,62,6);});}});
 draws.sort((a,b)=>a.y-b.y);
 SHADOWS=1;for(const d of draws)d.sh();for(const b of bullets)if(!(b.delay>0)&&(b.kind==='lob'||b.kind==='thrown'||b.kind==='bomb'||b.kind==='parasite'))shadow(ctx,b.x-viewX,b.y,b.kind==='parasite'?4:6);
 SHADOWS=2;try{draws.forEach(d=>d.fn());drawEffects();drawParticles();if(multi()&&state==='play')drawTags();}finally{SHADOWS=0;}
 ctx.restore();
 if(ar)SR.front(ctx,ar,cam,time,sopt);
 ctx.save();ctx.translate(0,-cam.y);for(const f of floating)legacy(ctx,f.x-viewX,f.y,()=>label(f.text,0,0,12,f.color,'center'));ctx.restore();
 // Screen pass: HUD, radio, cards and the continue screen in arcade screen px.
 // The ending's in-stage beats are cinematic: no HUD, the dialogue boxes and the caption only.
 // The screen pass does not shake: the cabinet's HUD is scroll1, which the quake never moves (G7).
 beginFrame(0,0);if(testHudOnly)rect(ctx,0,0,W,H,'#ff00ff');screenText=true;const cine=state==='ending'||state==='brief';if(!testNoOverlays&&!cine){hud();if(state!=='clear')missionHud();}
 if(caption&&!testNoOverlays&&UI()&&['play','paused','ending'].includes(state))UI().caption(ctx,caption.text,Math.floor(caption.t));
 if(state==='continue')drawContinue();else if(state==='clear')drawClear();else if(state==='brief')drawCardScreen();else if(cine)drawEndWorld();else if(state!=='play')rect(ctx,0,0,W,H,'#0b1a1688');}
 // An area fade darkens the world and screen passes in 16 brightness steps (ARCHITECTURE §4.5).
 if(fade)rect(ctx,0,0,W,H,`rgba(0,0,0,${fadeAlpha()})`);
 if(flash>0)rect(ctx,0,0,W,H,`rgba(226,239,170,${Math.min(.5,flash)})`);screenText=false;ctx.restore();}
// The simulation advances by the real elapsed time of every displayed frame, split into steps no longer than
// about a sixtieth of a second. A fixed 60 Hz accumulator skipped or doubled updates on 72, 120 and 144 Hz
// displays, which showed as a hitch in the hero's walk several times a second.
// A joiner (NETROLE 'client') never runs update(): clientFrame samples its input, applies the host's interpolated
// snapshot, replays the host's events and draws. The host hands every step to the session (snapshots, events, input).
function frame(now){const elapsed=Math.min(.1,Math.max(0,(now-last)/1000||1/60));last=now;
  if(NETROLE==='client'){clientStep(elapsed);render();requestAnimationFrame(frame);return;}
  const steps=Math.max(1,Math.round(elapsed*60)),dt=elapsed/steps;for(let i=0;i<steps;i++)stepSim(dt);render();requestAnimationFrame(frame);}
function stepSim(dt){
  if(replayQ)while(replayQ.length&&replayQ[0][0]<=stepNo){const [,slot,held,press]=replayQ.shift();mpInput(slot,{held,press});}
  update(dt);stepNo++;if(NETROLE==='host')netTick(dt);}
window.addEventListener('keydown',e=>{menuIdle=0;
  // a joiner's keys go to its input sampler (60 Hz frames to the host); Esc / P asks whether to leave the game
  if(NETROLE==='client'){unlockAudio();clientKey(e,true);return;}
  // the attract story: Enter starts a game (the cabinet's start button), any other key returns to the title
  if(state==='attract'){e.preventDefault();unlockAudio();if(!e.repeat){if(e.code==='Enter'||e.code==='NumpadEnter')characterSelect(0);else menu();}return;}
  // the chapter card and the ending: a button finishes the typing, then moves on (Enter still skips the card)
  if(!e.repeat&&['KeyJ','KeyK','KeyZ','KeyX','Space'].includes(e.code)){if(state==='brief'){e.preventDefault();cardAdvance();return;}if(state==='ending'){e.preventDefault();endAdvance();return;}}
  const use=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyW','KeyA','KeyS','KeyD','KeyJ','KeyK','KeyL','KeyZ','KeyX','KeyC','KeyE','KeyV','ShiftLeft','ShiftRight','Enter','Escape','KeyP'];if(use.includes(e.code)&&(state==='play'||['ArrowLeft','ArrowRight','Enter','Escape','KeyP'].includes(e.code)))e.preventDefault();unlockAudio();if(e.code==='Escape'||e.code==='KeyP'){if(!e.repeat){if(state==='play'||state==='paused')pause();else if(e.code==='Escape'&&['select','chapters','guide','credits','jukebox'].includes(state))menu();}return;}if(!e.repeat&&['ArrowLeft','ArrowRight','KeyA','KeyD'].includes(e.code)){const now=performance.now()/1000;if(lastDirection.key===e.code&&now-lastDirection.time<.28){dashTime=1.6;dashKey=e.code;dashTap++;}lastDirection={key:e.code,time:now};}if(!keys.has(e.code))pressed.add(e.code);keys.add(e.code);if(e.code==='Enter'&&!e.repeat){if(state==='menu')characterSelect(0);else if(state==='select')document.getElementById('begin')?.click();else if(state==='brief')document.getElementById('enter-stage')?.click();else if(state==='clear')document.getElementById('next')?.click();else if(state==='ending')endAdvance();else if(state==='gameover')document.getElementById('retry')?.click();}if(state==='select'&&!e.repeat&&['ArrowLeft','ArrowRight'].includes(e.code)){selected=SELECT_ORDER[(SELECT_ORDER.indexOf(selected)+(e.code==='ArrowRight'?1:3))%4];characterSelect();}});
window.addEventListener('keyup',e=>{keys.delete(e.code);if(NETROLE==='client')clientKey(e,false);});
// any pointer input restarts the title's idle count; a click on the screen during the attract story returns to the title
window.addEventListener('pointerdown',()=>{menuIdle=0;},{capture:true});
document.querySelector('.game-shell')?.addEventListener('pointerdown',e=>{if(state==='attract'&&!e.target.closest?.('button'))menu();});window.addEventListener('blur',()=>{if(NETROLE==='client'){mpSampler()?.setAway(true);return;}resetInput();if(state==='play')pause('host-away');});window.addEventListener('focus',()=>{if(NETROLE==='client')mpSampler()?.setAway(false);});document.addEventListener('visibilitychange',()=>{if(NETROLE==='client'){mpSampler()?.setAway(document.hidden);return;}if(document.hidden&&state==='play')pause('host-away');});
function touchKey(code,on){if(NETROLE==='client'){const S=mpSampler();if(S){if(on)S.keyDown(code,performance.now());else S.keyUp(code);}}if(on&&!touchKeys.has(code)){touchKeys.add(code);if(!keys.has(code))pressed.add(code);keys.add(code);}else if(!on&&touchKeys.has(code)){touchKeys.delete(code);keys.delete(code);}}
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
bindButton('pause',pause);bindButton('home',()=>{if(NETROLE==='client'){window.EDEN_LOBBY?.confirmLeave?.();return;}if(state==='play')pause();else if(mpHosting())mpToRoom();else menu();});bindButton('sound',()=>{const on=settings.music||settings.sfx;settings.music=!on;settings.sfx=!on;document.querySelector('#sound').textContent=on?'SOUND OFF':'SOUND ON';persist();});document.querySelector('#sound').textContent=settings.music||settings.sfx?'SOUND ON':'SOUND OFF';// Fullscreen. Desktop keeps the playfield-only fullscreen. Touch devices fullscreen the whole page so the controls
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
// ================================================================ online co-op: host adapter, snapshots, replica (MULTIPLAYER.md §1.9-§1.12, §3.15, §5.3)
// net.js (window.EDEN_NET) and lobby.js (window.EDEN_LOBBY) reach the game only through MP_ADAPTER. The host's update()
// is the only simulation: every step the session gets the step (input frames for the joiners' players, 20 Hz delta
// snapshots of NET_SCHEMA, the step's events). A joiner never runs update(): it applies the interpolated snapshot to the
// same globals render() reads, replays the events (sounds, particles, effects, floating scores) and draws. Nothing here
// runs, and no network is touched, until a player chooses PLAY WITH FRIENDS (or opens a ?join= link).
const NET_SCHEMA={timeField:'time',playerSection:'p',sections:{
  g:{fields:[['state','str'],['level','i'],['area','i'],['section','i'],['enc','i'],['wave','i'],['time','t'],['camera','q4'],['cameraY','q4'],['road','q4'],['roadStream','q4'],['driving','b'],['lock','json'],
    ['bossSpawned','b'],['bossIntro','f2'],['fade','json'],['shake','f2'],['flash','f2'],['coins','i'],['continueTimer','f2'],['coinPending','f2'],['toast','str'],['toastTime','f1'],['radio','str'],['caption','json'],
    ['card','json'],['tally','json'],['bossCard','json'],['mission','json'],['crown','json'],['parkedCar','json'],['wheels','json'],['difficulty','str'],['stageTimer','f1'],['kills','i'],['cleared','b'],['rollT','f1'],
    ['joinWait','i'],['end','json'],['ecar','json'],['elot','json']]},
  p:{key:'slot',fields:[['slot','i'],['nid','i'],['hero','i'],['x','q4'],['y','q4'],['z','q4'],['dir','i'],['hp','f1'],['maxhp','f1'],['lives','i'],['score','i'],['combo','i'],['weapon','str'],['ammo','i'],['inv','f2'],
    ['special','f2'],['specialTotal','f2'],['specialCd','f1'],['flags','i'],['an','json'],['cont','f1'],['bank','f2'],['bump','f2'],['roll','q4'],['boost','f2'],['lastHit','i'],['tag','f1'],['name','str']]},
  e:{key:'nid',fields:[['nid','i'],['type','str'],['v','str'],['x','q4'],['y','q4'],['z','q4'],['dir','i'],['hp','f1'],['maxhp','f1'],['state','str'],['fl','i'],['dead','f2'],['delay','f2'],['freeze','f2'],['fid','i'],
    ['ak','str'],['af','i'],['name','str'],['hero','i'],['phase','i'],['timer','f2'],['rage','f2'],['rageWarning','f2'],['palAlt','str'],['flashMap','str'],['mvName','str'],['hy','q4'],['tx','q4'],['ty','q4'],
    ['strikeFlash','f2'],['inv','f2'],['hurt','f2'],['ba','json'],['lot','json'],['gaff','i'],['defeat','json'],['rig','json'],['tp','i']]},
  a:{key:'nid',fields:[['nid','i'],['hero','i'],['x','q4'],['y','q4'],['z','q4'],['dir','i'],['hp','f1'],['maxhp','f1'],['state','str'],['inv','f2'],['rig','json']]},
  b:{key:'nid',fields:[['nid','i'],['kind','str'],['weapon','str'],['x','q4'],['y','q4'],['z','q4'],['vx','q4'],['vy','q4'],['friendly','b'],['hero','b'],['age','f2'],['delay','f2'],['landed','b'],['pellet','i'],['dir','i'],['art','json'],['color','str']]},
  d:{key:'nid',fields:[['nid','i'],['type','str'],['food','str'],['x','q4'],['y','q4'],['z','q4'],['claimed','b'],['life','f1'],['dir','i']]},
  o:{key:'nid',fields:[['nid','i'],['type','str'],['x','q4'],['y','q4'],['z','q4'],['hp','f1'],['boss','b'],['rolling','b'],['falling','b'],['roll','q4'],['vx','q4']]},
  bo:{key:'nid',fields:[['nid','i'],['type','str'],['x','q4'],['y','q4'],['z','q4'],['hp','f1'],['boss','b'],['rolling','b'],['falling','b'],['roll','q4'],['vx','q4']]},
  z:{key:'nid',fields:[['nid','i'],['x','q4'],['y','q4'],['r','q4'],['t','f2'],['total','f2'],['band','json'],['style','str'],['friendly','b']]},
  x:{key:'nid',fields:[['nid','i'],['weapon','str'],['x','q4'],['y','q4'],['z','q4'],['dir','i'],['age','f2'],['t','f2'],['lie','f2'],['landed','b']]},
  sc:{key:'nid',fields:[['nid','i'],['id','str'],['type','str'],['v','str'],['key','str'],['keys','json'],['x','q4'],['y','q4'],['z','q4'],['vx','q4'],['t','f1']]},
  ea:{key:'nid',fields:[['nid','i'],['hero','i'],['x','q4'],['y','q4'],['z','q4'],['dir','i'],['freed','b'],['own','b'],['state','str'],['rig','json']]},
}};
const PF=['run','move','dying','down','dropIn','knocked','walkFire','brake','free','cont','out','away','victory','grab','coin'];
const EF=['boss','elite','clone','setPiece','onstage','waiting','hidden','dying','dissolve','knife','wreck','sink','half','testHidden','brood','collarOff','phase2h','moving','remnant'];
const bitsOf=list=>{let f=0;list.forEach((v,i)=>{if(v)f|=1<<i;});return f;};
const bit=(f,i)=>!!((f|0)&(1<<i));
const r1=v=>typeof v==='number'?Math.round(v*10)/10:v,r2=v=>typeof v==='number'?Math.round(v*100)/100:v;
const mpSess=()=>window.EDEN_NET&&window.EDEN_NET.session||null;
const mpSampler=()=>{const S=mpSess();return S&&S.role==='client'?S.sampler:null;};
// ---------------------------------------------------------------- host: events (§1.10)
// One-shot and cosmetic things travel as events: sounds, the particle helpers (each page runs its own random draws),
// floating scores, and every new effect or loose particle the step created (sent once, then aged on the joiner).
let EV=[],evDepth=0,stepNo=0,inputRec=null,replayQ=null;
const pSeen=new WeakSet(),fxSeen=new WeakSet();
function hostLive(){const S=mpSess();return NETROLE==='host'&&!!S&&S.role==='host'&&S.phase==='play'&&!!S.clients&&S.clients.size>0;}
function hostEv(...ev){if(NETROLE!=='host'||!hostLive())return;EV.push(ev);if(EV.length>600)EV.splice(0,EV.length-600);}
function fxCall(ev,fn){if(NETROLE!=='host')return fn();const n0=particles.length,f0=effects.length;if(evDepth===0)hostEv(...ev);evDepth++;
  try{return fn();}finally{evDepth--;for(let i=n0;i<particles.length;i++)pSeen.add(particles[i]);for(let i=f0;i<effects.length;i++)fxSeen.add(effects[i]);}}
const _sfx=sfx,_burst=burst,_bloodBurst=bloodBurst,_explosionParticles=explosionParticles,_sparkBurst=sparkBurst,_popup=popup;
sfx=name=>fxCall(['sfx',name],()=>_sfx(name));
burst=(x,y,color,n=12)=>fxCall(['burst',r1(x),r1(y),color,n],()=>_burst(x,y,color,n));
bloodBurst=(e,dir,opts)=>fxCall(['blood',r1(e.x),r1(e.y),r1(e.z||0),dir,opts&&opts.sharp?1:0,r1(opts&&opts.hitZ||0)],()=>_bloodBurst(e,dir,opts));
explosionParticles=(x,y)=>fxCall(['expl',r1(x),r1(y)],()=>_explosionParticles(x,y));
sparkBurst=(x,y,n=10)=>fxCall(['spark',r1(x),r1(y),n],()=>_sparkBurst(x,y,n));
popup=(x,y,text,color='#e9ecd1')=>fxCall(['popup',r1(x),r1(y),String(text),color],()=>_popup(x,y,text,color));
function packObj(o){const out={};for(const k in o){const v=o[k];if(v==null||typeof v==='function')continue;if(typeof v==='number')out[k]=r2(v);else if(typeof v==='object'){if(Array.isArray(v)?v.length<=64:Object.keys(v).length<=16)out[k]=v;}else out[k]=v;}return out;}
function emitDiffs(){if(!hostLive())return;
  for(const f of effects)if(!fxSeen.has(f)){fxSeen.add(f);hostEv('fx',packObj(f));}
  for(const p of particles)if(!pSeen.has(p)){pSeen.add(p);hostEv('pt',packObj(p));}}
function netTick(dt){
  const S=mpSess();if(!S||S.role!=='host'||typeof S.tick!=='function')return;
  let jw=0;if(S.clients)for(const c of S.clients.values())if(c.state==='waiting'&&c.ready)jw|=1<<c.slot;joinWait=jw;
  emitDiffs();S.tick(dt);
}
// ---------------------------------------------------------------- host: snapshot (§1.9)
function freeOf(p){return state==='play'&&!fade&&!driving&&onField(p)&&p.hurt<=0&&p.special<=0&&bossIntro<=0&&p.pickup<=0&&!(p.freeze>0)&&!p.grab&&!p.dropIn&&p.attack<=0&&p.z<=0&&!p.down&&!p.dying;}
function anOf(p){const A=p.mp.heroAnim;if(driving||!A||!A.main||!A.main.clip)return null;const L=A.sel&&A.sel.legs&&A.legs&&A.legs.clip?A.legs:null;return [A.main.role,A.main.k,L?L.role:null,L?L.k:0,Math.round((A.sel&&A.sel.lift)||0)];}
function pRow(p){const m=p.mp;return {slot:m.slot,nid:nidOf(p),hero:m.hero,x:p.x,y:p.y,z:p.z,dir:p.dir,hp:p.hp,maxhp:p.maxhp,lives:m.lives,score:m.score,combo:m.combo,weapon:p.weapon||'',ammo:p.ammo|0,
  inv:p.inv,special:p.special,specialTotal:p.specialTotal,specialCd:p.specialCd,
  flags:bitsOf([p.run,p.move,p.dying,p.down,p.dropIn,p.knocked,p.walkFire,p.brake,freeOf(p),!!m.cont,m.out,m.away,p.victoryT!=null,!!p.grab,!!(m.cont&&m.cont.pending>0)]),
  an:anOf(p),cont:m.cont?m.cont.t:0,bank:p.bank,bump:p.bump,roll:p.roll,boost:p.boost,lastHit:m.lastHitEnemy&&enemies.includes(m.lastHitEnemy)?nidOf(m.lastHitEnemy):-1,tag:m.tag||0,name:m.name||''};}
function rigOf(e){if(e.conscript)return e.fid!=null?['rom',e.fid]:null;if(e.type!=='mirror'&&!e.ally)return null;const i=cloneInfo(e);return i?[i.id,i.k]:null;}
function eRow(e){return {nid:nidOf(e),type:e.type,v:e.v||'',x:e.x,y:e.y,z:e.z||0,dir:e.dir,hp:e.hp,maxhp:e.maxhp,state:e.state||'',
  fl:bitsOf([e.boss,e.elite,e.clone,e.setPiece,e.onstage,e.waiting,e.hidden,e.dying,e.dissolve,e.knife,e.wreck,e.sink,e.half,e.testHidden,e.brood,e.collar===false,e.phase2h,e.moving,e.remnant]),
  dead:e.dead||0,delay:e.delay||0,freeze:e.freeze||0,fid:e.fid??-1,ak:e.ak||'',af:e.af|0,name:e.name||'',hero:e.hero|0,phase:e.phase|0,timer:e.sink?e.timer:0,rage:e.rage||0,rageWarning:e.rageWarning||0,
  palAlt:e.palAlt||'',flashMap:e.flashMap||'',mvName:e.mvName||'',hy:e.hy||0,tx:e.state==='leap'?e.targetX:0,ty:e.state==='leap'?e.targetY:0,strikeFlash:e.strikeFlash||0,inv:e.inv||0,hurt:e.hurt||0,
  ba:e.boss&&e.ba?{key:e.ba.key,t:r1(e.ba.t||0),hold:!!e.ba.hold,rev:!!e.ba.rev,pin:e.ba.pin??null}:null,lot:e.type==='fessenden'?{mode:crownModeOf(e),stagger:r2(e.stagger||0)}:null,jet:e.jetT>0?Math.round(e.jetLen||0):0,gaff:e.gaff?Math.round(e.gaff.len||0):-1,
  defeat:e.defeat?{kind:e.defeat.kind,t:r2(e.defeat.t||0)}:null,rig:rigOf(e),tp:e.tp&&e.tp.mp?e.tp.mp.slot:-1};}
const oRow=o=>({nid:nidOf(o),type:o.type,x:o.x,y:o.y,z:o.z||0,hp:o.hp,boss:!!o.boss,rolling:!!o.rolling,falling:!!o.falling,roll:o.roll||0,vx:o.vx||0});
function mpSerialize(){
  if(ctxPlayer&&ctxPlayer.mp)saveCtx(ctxPlayer);
  const g={state,level:levelIndex,area:areaIndex,section:sectionIndex,enc:encIndex,wave,time,camera,cameraY,road,roadStream,driving,lock:lock?{left:lock.left,right:lock.right}:null,bossSpawned,bossIntro,
    fade:fade?{to:fade.to,t:r2(fade.t),out:!!fade.out}:null,shake,flash,coins,continueTimer,coinPending,toast:toastTime>0?String(toast||''):'',toastTime,radio:radio?String(radio.text):'',
    caption:caption?{text:caption.text,t:Math.floor(caption.t)}:null,card:card?{i:card.i,start:card.start,phase:card.phase,k:card.k,t:Math.floor(card.t),pre:card.pre||null}:null,
    tally:clearSeq?{t:Math.floor(clearSeq.t),story:!!clearSeq.story,tally:clearSeq.tally}:null,bossCard:bossCard?{name:bossCard.name,sub:bossCard.sub,t:r2(bossCard.t),total:bossCard.total,pink:!!bossCard.pink}:null,
    mission:mission?{completed:mission.completed,total:mission.total,active:mission.active?mission.items.indexOf(mission.active):-1,items:mission.items.map(t=>({kind:t.kind,name:t.name,x:t.x,y:t.y,target:t.target,channel:t.channel,progress:r2(t.progress),hp:r2(t.hp),maxhp:t.maxhp,done:!!t.done,bossTask:!!t.bossTask}))}:null,
    crown:crown?{...crown}:null,parkedCar:parkedCar?{x:parkedCar.x,y:parkedCar.y}:null,wheels:spillWheels.map(w=>({x:w.x,y:w.y,charge:r2(w.charge),cd:r1(w.cd),spin:r1(w.spin),hold:w.hold})),
    difficulty:normalizeDifficulty(difficulty),stageTimer,kills,cleared,rollT,joinWait,
    end:endSeq?{k:endSeq.k,t:Math.floor(endSeq.t),box:endSeq.box,done:!!endSeq.done,lift:endSeq.lift??null,stumbler:endActors.indexOf(endSeq.stumbler)}:null,
    ecar:endCar?{x:endCar.x,y:endCar.y,v:endCar.v,roll:r1(endCar.roll),stopX:endCar.stopX,state:endCar.state}:null,
    elot:endLot?{x:endLot.x,y:endLot.y,dir:endLot.dir,dead:endLot.dead,fallT:r2(endLot.fallT||0),remnant:!!endLot.remnant,defeat:endLot.defeat?{kind:endLot.defeat.kind,t:r2(endLot.defeat.t||0)}:null,ba:endLot.ba?{key:endLot.ba.key,t:r1(endLot.ba.t||0),hold:true}:null}:null};
  return {g,p:present().map(pRow),e:enemies.map(eRow),a:allies.map(a=>({nid:nidOf(a),hero:a.hero,x:a.x,y:a.y,z:a.z||0,dir:a.dir,hp:a.hp,maxhp:a.maxhp,state:a.state,inv:a.inv||0,rig:rigOf(a)})),
    b:bullets.map(b=>({nid:nidOf(b),kind:b.kind||'',weapon:b.weapon||'',x:b.x,y:b.y,z:b.z||0,vx:b.vx||0,vy:b.vy||0,friendly:!!b.friendly,hero:!!b.hero,age:b.age||0,delay:b.delay||0,landed:!!b.landed,pellet:b.pellet|0,dir:b.dir||0,art:b.art||null,color:b.color||''})),
    d:drops.map(d=>({nid:nidOf(d),type:d.type,food:d.food||'',x:d.x,y:d.y,z:d.z||0,claimed:!!d.claimed,life:d.life,dir:d.dir||0})),
    o:objects.map(oRow),bo:bossObjs.filter(o=>!objects.includes(o)).map(oRow),
    z:zones.map(z=>({nid:nidOf(z),x:z.x,y:z.y,r:z.r,t:z.t,total:z.total,band:z.band||null,lane:z.lane||null,t0Fire:z.t0Fire||0,mark:!!z.mark,style:z.style||'',friendly:!!z.friendly})),
    x:discards.map(d=>({nid:nidOf(d),weapon:d.weapon,x:d.x,y:d.y,z:d.z||0,dir:d.dir,age:d.age,t:d.t,lie:d.lie,landed:!!d.landed})),
    sc:scenery.map(s=>({nid:nidOf(s),id:s.id,type:s.type,v:s.v,key:s.key||'',keys:s.keys||null,x:s.x,y:s.y,z:s.z||0,vx:s.vx,t:s.t})),
    ea:(state==='ending'?endActors:[]).map(a=>({nid:nidOf(a),hero:a.hero,x:a.x,y:a.y,z:a.z||0,dir:a.dir,freed:!!a.freed,own:!!a.own,state:a.state||'',rig:rigOf(a)}))};
}
// ---------------------------------------------------------------- host: players joining, leaving, input (§3.10, §3.3)
const mpReserve={};
function mpAddPlayer(slot,hero,o={}){
  slot=slot|0;if(slot<1||slot>=MAXP||NETROLE==='client'||!started||!players[0]||players[slot])return false;
  const used=new Set(present().map(p=>p.mp.hero));let h=clamp(hero|0,0,3);if(used.has(h))h=[...SELECT_ORDER,0,1,2,3].find(k=>!used.has(k));if(h==null)return false;
  if(ctxPlayer&&ctxPlayer.mp)saveCtx(ctxPlayer);
  const p=attachMp(freshHero(HEROES[h].hp*rules().playerHealth),slot,h,o.name),m=p.mp;m.in=makeInput();m.heroAnim=freshHeroAnim();
  const res=o.reconnect?mpReserve[slot]:null;if(res&&res.hero===h){m.score=res.score;m.lives=Math.max(1,res.lives);}delete mpReserve[slot];
  const lp=leadPlayer()||players[0],x0=clamp(camera+64+40*slot,camera+24,camera+W-24),x=lock?clamp(x0,lock.left+24,lock.right-24):x0,b=bandOf(x);
  p.x=x;p.y=clamp(b.mid+[0,-12,12][slot],b.top,b.bottom);p.dir=1;
  players[slot]=p;refreshPlayers();
  if(driving){p.x=lp.x;p.y=lp.y;}else if(o.dropIn!==false)withPlayer(p,startDropIn);
  m.tag=2;toast=`${slot+1}P ${String((o.name&&!/^[1-3]P$/i.test(o.name))?o.name:HEROES[h].name).toUpperCase()} JOINED`;toastTime=2.5;
  return true;
}
function mpRemovePlayer(slot,reason){
  const p=players[slot];if(!p||slot===0||slot===localSlot)return false;
  if(ctxPlayer&&ctxPlayer.mp)saveCtx(ctxPlayer);
  mpReserve[slot]={hero:p.mp.hero,score:p.mp.score,lives:p.mp.lives};
  withPlayer(p,()=>{releaseGrab();dropWeapon();});
  players[slot]=null;refreshPlayers();
  for(const e of enemies){if(e.tp===p)e.tp=null;if(e.target===p)e.target=null;if(e.byP===p)e.byP=null;}
  if(ctxPlayer===p)loadCtx(localPlayer());
  if(reason!=='reconnect'){toast=`${slot+1}P LEFT`;toastTime=2;}
  return true;
}
// a joiner's decoded frame (net.js Receiver.next): held keys (a press counts as held for its step, so a tap shorter
// than one host step still attacks), presses, the joiner-side double tap, away (§1.8)
function mpSetRemoteInput(slot,fr){
  const p=players[slot];if(!p||slot===localSlot||!fr)return;const m=p.mp,I=m.in&&m.in!==LOCAL_IN?m.in:(m.in=makeInput());
  I.keys=new Set(fr.held||[]);for(const c of fr.presses||[]){I.pressed.add(c);I.keys.add(c);}
  if(fr.dash&&fr.dash.code){m.dashTime=1.6;m.dashKey=fr.dash.code;m.dashTap+=fr.dash.count||1;}
  m.away=!!fr.away;
  if(inputRec)inputRec.push([stepNo,slot,[...I.keys],[...(fr.presses||[])]]);
}
// a scripted input source (tests, bots, a local second player later): held keys stay held until the next call
function mpInput(slot,{held=[],press=[]}={}){
  const p=players[slot];if(!p)return false;
  if(p.mp.in===LOCAL_IN||(p===ctxPlayer&&IN===LOCAL_IN)){keys.clear();for(const k of held)keys.add(k);for(const k of press)pressed.add(k);return true;}
  const I=p.mp.in||(p.mp.in=makeInput());I.keys=new Set(held);for(const k of press){I.pressed.add(k);I.keys.add(k);}return true;
}
// ---------------------------------------------------------------- client: the replica (§3.15, §1.12)
const RC={e:new Map(),a:new Map(),b:new Map(),d:new Map(),o:new Map(),bo:new Map(),z:new Map(),x:new Map(),sc:new Map(),ea:new Map()};
let replicaLot=null,padPrev=new Set();
function rsync(sec,rows,fix){
  const M=RC[sec],out=[],seen=new Set();
  for(const r of rows||[]){if(!r)continue;let o=M.get(r.nid);
    if(!o){o={};Object.defineProperty(o,'nid',{value:r.nid,writable:true,configurable:true,enumerable:false});M.set(r.nid,o);}
    for(const k in r)if(k!=='nid')o[k]=r[k];if(fix)fix(o,r);out.push(o);seen.add(r.nid);}
  for(const k of [...M.keys()])if(!seen.has(k))M.delete(k);
  return out;
}
function replicaChapter(i){
  levelIndex=clamp(i|0,0,5);level=LEVELS[levelIndex];plan=buildPlan(levelIndex);level.length=plan.length;SR.require(levelIndex);bossArt(levelIndex);STG.use(chapterKey(levelIndex));heroRigChapter(levelIndex);
  const spec=EDEN_MISSIONS[levelIndex];mission={completed:0,total:spec.tasks.length,active:null,items:[],spec};started=true;areaIndex=-1;
}
function applyView(v){
  const g=v.g||{},prev=state;
  if(g.level!=null&&(g.level!==levelIndex||!plan||!started))replicaChapter(g.level);
  if(g.area!=null&&plan&&g.area!==areaIndex&&plan.areas[g.area]){areaIndex=g.area;SR.resetStream(curArea());}
  if(ctxPlayer&&ctxPlayer.mp)saveCtx(ctxPlayer);
  if(typeof g.state==='string'&&g.state)state=g.state;
  if(typeof g.time==='number')time=g.time;
  camera=g.camera??camera;cameraY=g.cameraY??cameraY;road=g.road??road;roadStream=g.roadStream??roadStream;driving=!!g.driving;lock=g.lock||null;bossSpawned=!!g.bossSpawned;bossIntro=g.bossIntro||0;
  fade=g.fade||null;shake=g.shake||0;flash=g.flash||0;coins=g.coins|0;continueTimer=g.continueTimer||0;coinPending=g.coinPending||0;toast=g.toast||'';toastTime=g.toast?g.toastTime||0:0;
  radio=g.radio?{text:g.radio,ttl:1}:null;caption=g.caption||null;card=g.card?{...g.card}:null;clearSeq=g.tally?{t:g.tally.t,story:g.tally.story,typed:0,tally:g.tally.tally}:null;bossCard=g.bossCard||null;
  if(mission&&g.mission){const M=g.mission;mission.completed=M.completed;mission.total=M.total;mission.items=M.items||[];mission.active=M.active>=0?mission.items[M.active]||null:null;}
  crown=g.crown||null;parkedCar=g.parkedCar||null;spillWheels=g.wheels||[];sectionIndex=g.section??sectionIndex;encIndex=g.enc??encIndex;wave=g.wave|0;difficulty=g.difficulty||difficulty;
  stageTimer=g.stageTimer||0;kills=g.kills|0;cleared=!!g.cleared;rollT=g.rollT||0;joinWait=g.joinWait|0;
  enemies=rsync('e',v.e,(e,r)=>{EF.forEach((k,i)=>{e[k]=bit(r.fl,i);});e.collar=e.collarOff?false:undefined;e.fid=r.fid>=0?r.fid:null;e.ak=r.ak||null;e.v=r.v||undefined;e.targetX=r.tx;e.targetY=r.ty;
    e.gaff=r.gaff>=0?{len:r.gaff}:null;e.jetT=r.jet>0?1:0;e.jetLen=r.jet||0;e.palAlt=r.palAlt||null;e.flashMap=r.flashMap||null;});
  allies=rsync('a',v.a,a=>{a.ally=true;a.freed=true;a.conscript=true;});
  bullets=rsync('b',v.b,b=>{b.art=b.art||undefined;b.color=b.color||undefined;});
  drops=rsync('d',v.d,d=>{d.food=d.food||undefined;});objects=rsync('o',v.o);bossObjs=rsync('bo',v.bo);zones=rsync('z',v.z,z=>{z.band=z.band||undefined;z.lane=z.lane||undefined;});
  discards=rsync('x',v.x);scenery=rsync('sc',v.sc,s=>{s.key=s.key||undefined;s.keys=s.keys||undefined;});endActors=rsync('ea',v.ea,a=>{a.conscript=a.hero<0;});
  endSeq=g.end?{...g.end,stumbler:endActors[g.end.stumbler]||null}:null;endCar=g.ecar||null;
  if(g.elot){replicaLot=replicaLot||{type:'fessenden',boss:true,z:0};Object.assign(replicaLot,g.elot);endLot=replicaLot;}else endLot=null;
  // the players: one replica object per slot; this machine's own row is the echo-predicted one (session.view)
  const next=[],S=mpSess(),own=S&&S.ownRow;
  for(const r of v.p||[]){if(!r||!(r.slot>=0&&r.slot<MAXP))continue;let p=players[r.slot];
    if(!p||p.mp.hero!==r.hero){p=attachMp(freshHero(r.maxhp||100),r.slot,r.hero,r.name);p.mp.in=makeInput();p.mp.heroAnim=freshHeroAnim();}
    const m=p.mp,f=r.flags|0,ox=p.x,oy=p.y;p.nid=r.nid;
    Object.assign(p,{x:r.x,y:r.y,z:r.z,dir:r.dir,hp:r.hp,maxhp:r.maxhp,weapon:r.weapon||null,ammo:r.ammo,inv:r.inv,special:r.special,specialTotal:r.specialTotal,specialCd:r.specialCd,bank:r.bank,bump:r.bump,roll:r.roll,boost:r.boost,
      run:bit(f,0),move:bit(f,1),dying:bit(f,2),down:bit(f,3),dropIn:bit(f,4),knocked:bit(f,5),walkFire:bit(f,6),brake:bit(f,7),victoryT:bit(f,12)?1:null});
    m.score=r.score;m.lives=r.lives;m.combo=r.combo;m.cont=bit(f,9)?{t:r.cont,pending:bit(f,14)?1:0}:null;m.out=bit(f,10);m.away=bit(f,11);m.tag=r.tag;m.name=r.name;m.an=r.an;
    m.lastHitEnemy=r.lastHit>=0?RC.e.get(r.lastHit)||null:null;
    // own walking echo: while this machine moves its hero ahead of the host's clip, a local walk clip shows (§1.12)
    if(r.slot===localSlot&&own&&ox!=null){const d=Math.hypot(p.x-ox,p.y-oy),R=RIG(),moving=Math.abs(p.x-own.x)+Math.abs(p.y-own.y)>.5&&d>.05;
      m.echoOn=!!(R&&moving&&m.an&&!isLoco(m.an[0])&&bit(f,8));
      if(m.echoOn){const id=HEROES[r.hero].id,sp=R.hero(id).speed||{};m.echoA=m.echoA||R.player();R.play(m.echoA,id,'walk');R.advance(m.echoA,d/(sp.walk||1.6));}}
    else m.echoOn=false;
    next[r.slot]=p;}
  players=next;refreshPlayers();
  const L=localPlayer();if(L&&L.mp)loadCtx(L);
  if(state!==prev)onReplicaState(prev);
}
function onReplicaState(prev){
  panel('');const LB=window.EDEN_LOBBY;if(!LB)return;
  if(state==='clear')LB.showBanner('clear-wait');else if(state==='gameover')LB.showBanner('gameover-wait');else if(prev==='clear'||prev==='gameover')LB.hideBanner();
}
function drawReplicaPlayer(){
  const x=player.x-viewX,y=player.y-player.z,m=player.mp;ctx.save();if(!driving)shadow(ctx,x,player.y,20);
  if(player.inv>0&&Math.floor(time*16)%2===0)ctx.globalAlpha=.65;
  if(driving)car(ctx,x,y,{hero:selected,roll:player.roll,moving:true,bank:player.bank,bump:player.bump,brake:player.brake,t:time,passengers:present().filter(passenger).map(q=>q.mp.hero)});
  else{const R=RIG(),an=m.an,id=HEROES[selected].id;
    if(R&&R.ready&&an){let body=an[2]?{torso:{clip:an[0],k:an[1]},legs:{clip:an[2],k:an[3]}}:{full:{clip:an[0],k:an[1]}};if(m.echoOn&&m.echoA&&m.echoA.clip)body={full:m.echoA};
      let w=player.weapon&&R.hero(id).hold[player.weapon]?player.weapon:null;if(w&&player.ammo<=0&&R.hero(id).hold[w+'-empty'])w+='-empty';
      R.draw(ctx,R.parts(id,body,w),x,player.y-(an[4]||0),player.z,player.dir,CFG.sockets.scale,'hero');}}
  if(player.special>0){const k=clamp(1-player.special/(player.specialTotal||.65),0,1);ctx.strokeStyle=HEROES[selected].color;ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(x,y-30,63*(.28+.72*k),24,0,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}
function fireEvent(ev){
  if(!Array.isArray(ev))return;const [k,...a]=ev,n=v=>typeof v==='number'&&isFinite(v)?v:0;
  switch(k){
    case 'sfx':if(typeof a[0]==='string')_sfx(a[0]);break;
    case 'burst':_burst(n(a[0]),n(a[1]),String(a[2]||'#ffffff'),clamp(n(a[3])||12,0,40));break;
    case 'blood':_bloodBurst({x:n(a[0]),y:n(a[1]),z:n(a[2])},n(a[3])||1,{sharp:!!a[4],hitZ:n(a[5])});break;
    case 'expl':_explosionParticles(n(a[0]),n(a[1]));break;
    case 'spark':_sparkBurst(n(a[0]),n(a[1]),clamp(n(a[2])||10,0,40));break;
    case 'popup':_popup(n(a[0]),n(a[1]),String(a[2]??''),String(a[3]||'#e9ecd1'));break;
    case 'fx':if(a[0]&&typeof a[0]==='object'&&effects.length<300)effects.push({...a[0]});break;
    case 'pt':if(a[0]&&typeof a[0]==='object'&&particles.length<CFG.fx.maxParticles)particles.push({...a[0]});break;
    case 'unlock':{const u=clamp(n(a[0]),0,5);if(u>save.unlocked){save.unlocked=u;persist();}break;}
    default:break;   // 'notice': the lobby shows join / leave notices from the roster
  }
}
// §1.12: today's walk rule for the joiner's own hero while the host says it may walk (the `free` flag)
function echoStep(row,f,dt){
  if(!row||!bit(row.flags,8)||!plan||!curArea())return row;
  const b=f.b|0,dx=((b>>1)&1)-(b&1),dy=((b>>3)&1)-((b>>2)&1);if(!dx&&!dy)return row;
  const run=!!((b>>8)&1)&&!!dx,V=heroV(HEROES[row.hero]||HEROES[0]),speed=run?FIREARMS.has(row.weapon)?V.walk*1.5:V.run:V.walk,lane=V.lane*(run?.5:1);
  let x=row.x+dx*speed*dt,y=row.y+dy*lane*dt;if(dx&&dy&&!run){x-=dx*speed*dt*.22;y-=dy*lane*dt*.22;}
  const r=walkTo(row.x,row.y,x,y,{cam:{x:camera,y:cameraY},lock});return Object.assign({},row,{x:r.x,y:r.y,dir:dx||row.dir});
}
function clientKey(e,on){
  if(on&&(e.code==='Escape'||e.code==='KeyP')){e.preventDefault();if(!e.repeat)window.EDEN_LOBBY?.confirmLeave?.();return;}
  const S=mpSampler();if(!S)return;
  if(on){if(S.away)S.setAway(false);if(S.keyDown(e.code,performance.now())&&state==='play')e.preventDefault();}else S.keyUp(e.code);
}
function clientPad(){
  const S=mpSampler(),pads=navigator.getGamepads?.()||[],p=Array.from(pads).find(Boolean),now=new Set();
  if(p){['KeyK','KeyE','KeyJ','KeyL'].forEach((c,i)=>{if(p.buttons[i]?.pressed)now.add(c);});
    if(p.axes[0]<-.3||p.buttons[14]?.pressed)now.add('ArrowLeft');if(p.axes[0]>.3||p.buttons[15]?.pressed)now.add('ArrowRight');if(p.axes[1]<-.3||p.buttons[12]?.pressed)now.add('ArrowUp');if(p.axes[1]>.3||p.buttons[13]?.pressed)now.add('ArrowDown');
    if(p.buttons[9]?.pressed){if(!padPrev.has('Start')&&!lobbyOpen())window.EDEN_LOBBY?.confirmLeave?.();now.add('Start');}}
  if(S&&!lobbyOpen()){for(const c of now)if(c!=='Start'&&!padPrev.has(c))S.keyDown(c,performance.now());for(const c of padPrev)if(c!=='Start'&&!now.has(c))S.keyUp(c);}
  padPrev=now;
}
// the joiner's frame (no update): input frames out, the interpolated view in, the host's events, local cosmetics
function clientStep(dt){
  const S=mpSess();if(!S||S.role!=='client')return;
  clientPad();
  if(S.sampler){const fr=S.sampler.sample(dt*1000);if(fr.length)S.sendInput(fr);}
  const now=performance.now(),v=S.view(now);if(v)MP_ADAPTER.applyView(v);
  for(const ev of S.dueEvents(now))MP_ADAPTER.fireEvent(ev);   // through the adapter, so a test (or a recorder) can wrap it
  updateParticles(dt);for(const f of floating){f.y-=22*dt;f.life-=dt;}floating=floating.filter(f=>f.life>0);
  for(const fx of effects)fx.age+=dt;effects=effects.filter(fx=>fx.age<fx.life);
  music(dt);
}
function mpClearWorld(){
  if(ctxPlayer&&ctxPlayer.mp)saveCtx(ctxPlayer);
  players=[];refreshPlayers();ctxPlayer=null;IN=LOCAL_IN;localSlot=0;lastDriver=null;EV=[];joinWait=0;mpAllOut=false;
  for(const M of Object.values(RC))M.clear();replicaLot=null;
  enemies=[];allies=[];objects=[];drops=[];particles=[];bullets=[];discards=[];zones=[];floating=[];effects=[];scenery=[];bossObjs=[];spillWheels=[];crown=null;bossCard=null;lock=null;encounter=null;fade=null;
  card=null;caption=null;clearSeq=null;endSeq=null;endLot=null;endActors=[];endCar=null;radio=null;radioQueue=[];driving=false;parkedCar=null;started=false;
}
// ---------------------------------------------------------------- the adapter (§5.3) and the lobby
const fnv=s=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h.toString(16).padStart(8,'0');};
let buildId=null;
const MP_ADAPTER={
  get build(){return buildId||(buildId=fnv(JSON.stringify([1,CFG,LEVELS.map(l=>l.name),NET_SCHEMA,HEROES.map(h=>[h.id,h.hp,h.speed,h.power])])));},
  heroes:HEROES.map((h,i)=>({id:i,name:h.name,color:h.color,portrait:()=>portraitCanvas(h.id)})),
  selectOrder:SELECT_ORDER.slice(),
  chapters:()=>LEVELS.map((l,i)=>({index:i,name:l.name,unlocked:i<=save.unlocked})),
  difficulties:()=>Object.entries(CFG.difficulty).map(([key,v])=>({key,label:v.label})),
  schema:NET_SCHEMA,
  // host
  startGame(cfg={}){
    NETROLE='host';localSlot=0;const r0=(cfg.roster||[]).find(r=>r&&r.slot===0);
    selected=clamp(r0?r0.hero|0:selected,0,3);difficulty=normalizeDifficulty(cfg.difficulty);score=0;lives=3;kills=0;bestCombo=0;runTime=0;coins=0;
    for(const k of Object.keys(mpReserve))delete mpReserve[k];
    startStage(clamp(cfg.chapter|0,0,5),{skipBrief:true,section:cfg.section|0,roster:cfg.roster&&cfg.roster.length?cfg.roster:null});
    if(!(cfg.section|0))queueDialog();
  },
  canAdmit(o){if(state!=='play'||fade||driving||bossIntro>0||bossSpawned||bossCard||!started||!players[0])return false;if(!lock)return true;return !!(o&&o.waitedMs>30000);},
  addPlayer:(slot,hero,o)=>mpAddPlayer(slot,hero,o||{}),
  removePlayer:(slot,reason)=>mpRemovePlayer(slot,reason),
  setRemoteInput:(slot,fr)=>mpSetRemoteInput(slot,fr),
  remoteButton(slot,name){if(name==='advance'){if(state==='brief')cardAdvance();else if(state==='ending')endAdvance();}},
  serialize:()=>mpSerialize(),
  drainEvents(){const e=EV;EV=[];return e;},
  playerState(slot){const p=players[slot];if(!p)return null;return p.mp.out?'out':p.mp.cont?'continue':'playing';},
  pause(){},
  stopGame(reason){mpClearWorld();const S=mpSess();NETROLE=S&&!S.ended&&S.role==='host'?'host':'off';menu();},
  // client
  enterReplica(cfg={}){
    mpClearWorld();NETROLE='client';localSlot=clamp(cfg.slot|0,1,MAXP-1);difficulty=normalizeDifficulty(cfg.difficulty);state='play';plan=null;
    resetInput();panel('');canvas.focus();
    const S=mpSampler();if(S)for(const c of keys)S.keyDown(c,performance.now());
  },
  applyView:v=>applyView(v),
  fireEvent:ev=>fireEvent(ev),
  echoStep:(row,f,dt)=>echoStep(row,f,dt),
  localInput:{attach(){},detach(){}},
  exitReplica(reason){mpClearWorld();NETROLE='off';window.EDEN_LOBBY?.hideBanner?.();menu();},
};
const lobbyOpen=()=>{try{return !!(window.EDEN_LOBBY&&window.EDEN_LOBBY.status().open);}catch(e){return false;}};
const mpHosting=()=>{const S=mpSess();return NETROLE==='host'&&!!S&&S.role==='host'&&!S.ended&&S.phase==='play';};
function netPause(on,by='host'){if(NETROLE!=='host')return;const S=mpSess();if(S&&S.role==='host'&&S.phase==='play'&&typeof S.pause==='function')S.pause(!!on,by);}
function mpToRoom(){const L=window.EDEN_LOBBY;if(L&&L.showRoom){L.showRoom();return;}const S=mpSess();if(S&&S.toRoom)S.toRoom('host-quit');}
function mpLobbyExit(){const S=mpSess();if(!S||S.ended){if(NETROLE==='client')mpClearWorld();NETROLE='off';}if(NETROLE==='off'&&state!=='select')menu();}
const lobbyOpts=()=>({adapter:MP_ADAPTER,net:window.EDEN_NET,onExit:mpLobbyExit,onStart:()=>{}});
function openLobby(){ensureMP().then(ok=>{const L=window.EDEN_LOBBY;if(!ok||!L||!window.EDEN_NET){toast='ONLINE PLAY COULD NOT LOAD';toastTime=3;return;}L.open({...lobbyOpts(),mode:'menu'});});}
// net.js and lobby.js load when a player first chooses PLAY WITH FRIENDS (single player never downloads them); with
// the page itself for a test or dev page (?net=), a share link (?join=) or a joiner's reload (net.js's rejoin key)
const MP_SRC=['net.js','lobby.js'];let mpLoad=null;
function ensureMP(){if(window.EDEN_NET&&window.EDEN_LOBBY)return Promise.resolve(true);if(mpLoad)return mpLoad;
  mpLoad=MP_SRC.reduce((p,f)=>p.then(ok=>ok&&new Promise(res=>{if(f==='net.js'?window.EDEN_NET:window.EDEN_LOBBY)return res(true);const sc=document.createElement('script');sc.src=f;sc.onload=()=>res(true);sc.onerror=()=>res(false);document.body.appendChild(sc);})),Promise.resolve(true))
    .then(ok=>{if(!ok)mpLoad=null;return ok;});return mpLoad;}
const MP_EAGER=/[?&](net|join)=/.test(location.search)||(()=>{try{return !!sessionStorage.getItem('cnd2-mp-rejoin');}catch(e){return false;}})();
if(MP_EAGER&&document.readyState==='loading'&&!window.EDEN_NET)for(const f of MP_SRC)document.write('<script src="'+f+'"></script>');
// ?join=DINO-XXXX opens the join screen and connects (the lobby strips the parameter); a joiner's reload rejoins its room
function mpBoot(){const L=window.EDEN_LOBBY,N=window.EDEN_NET;if(!L||!N)return;
  try{if(L.autoJoinFromUrl(lobbyOpts()))return;const rc=typeof N.rejoinCode==='function'?N.rejoinCode():null;if(rc)L.open({...lobbyOpts(),mode:'join',code:rc});}catch(e){console.error(e);}}
// the snapshot's player rows (§3.17): the same shape as snapshot.player plus slot, hero, score, lives, cont, out, seat
function netView(){let st=null;try{st=window.EDEN_NET?window.EDEN_NET.status():null;}catch(e){st=null;}return {role:NETROLE,code:st&&st.code||null,slot:localSlot,rtt:st&&st.rtt||0,snapSeq:st&&st.snapSeq!=null?st.snapSeq:-1,delay:st&&st.delay||0,kbpsIn:st&&st.kbpsIn||0,kbpsOut:st&&st.kbpsOut||0};}
function pview(p){if(!p)return null;const m=p.mp,me=p===ctxPlayer;return {...p,pickTarget:null,grab:p.grab?{t:p.grab.t,hits:p.grab.hits,type:p.grab.e.type}:null,moveState:p.moveState?{name:p.moveState.name,k:p.moveState.k}:null,
  slot:m.slot,hero:m.hero,nid:p.nid,score:me?score:m.score,lives:me?lives:m.lives,cont:m.cont?m.cont.t:null,out:!!m.out,seat:passenger(p)?1:0,name:m.name||''};}
// A narrow, explicit test interface keeps campaign checks reproducible.
// Arcade units (ARCHITECTURE §8, PLAN §4.6): positions, view, band and lock are arcade px in the area's own space; layout is
// canvas px. `rules` carries the reaches and lanes the tests read instead of literals.
const RULES={units:'arcade',reach:Object.fromEntries(['p1','p2','kick','fin'].map(k=>[k,MOVE[k].reach])),dashReach:93,airReach:80,meleeLane:27,bulletLane:19,shotgunSpread:41,grab:[27,8],pickup:[33,18],attackPickup:[22,13],autoCollect:20,special:104,clamp:[16,367],carEdge:CAR_EDGE,carReach:CAR_REACH,lockLead:LOCK_LEAD,camLead:CAM_LEAD,camStep:6};
window.LAST_EDEN={render, get state(){return state;},
 voice:{map:VOICE,cooldown:VOICE_CD,max:VOICE_MAX,files:voiceFiles,pick:voicePick,say:voice,play:playVoice,reset:()=>{voiceNext={};voiceLast={};voiceTurn=0;voiceLog.length=0;for(const a of voiceLive.splice(0))try{a.pause();}catch{}},get live(){return voiceLive.filter(a=>!a.paused&&!a.ended).length;},get log(){return [...voiceLog];}},get units(){return {world:'arcade',px:PX,aspect:settings.aspect};},get layout(){return {hud:[...LAYOUT.hud],radio:[...LAYOUT.radio],weapon:[...LAYOUT.weapon],font:UI()?.romFonts?'rom':'authored'};},get snapshot(){const b=bandOf(player?player.x:0),ar=plan?.areas?.[areaIndex];return {units:'arcade',view:{x:camera,y:cameraY,w:W,h:H},cameraY,area:ar?{index:ar.index,id:ar.id,w:ar.w,h:ar.h}:null,band:{top:b.top,bottom:b.bottom,mid:b.mid},areaLength:ar?ar.w:0,fade:fade?{to:fade.to,out:fade.out,t:fade.t}:null,roadStream,rules:JSON.parse(JSON.stringify(RULES)),difficulty:normalizeDifficulty(difficulty),road,coins,continueTimer,held:lastHeld?{...lastHeld}:null,difficultyRules:{...rules()},particles:particles.map(p=>({...p})),gunSocket:player?.weapon&&weaponClass(player.weapon)?gunMount():null,mission:mission?{completed:mission.completed,total:mission.total,active:mission.active?{...mission.active}:null}:null,artReady:SEQUEL_RENDER.ready,posesReady:!!RIG()?.ready,state,level:levelIndex,wave,score,lives,section:sectionIndex,encounter:encIndex,driving,camera,length:level.length,plan:plan?{areas:plan.areas.map(a=>({index:a.index,id:a.id,w:a.w,h:a.h,x0:a.x0})),sections:plan.sections.map(s=>({index:s.index,name:s.name,say:s.say,drive:s.drive,x:s.x,len:s.len,area:s.area,first:s.first,stage:s.stage,cap:s.cap,props:s.props.map(p=>({...p}))})),encounters:plan.encounters.map(e=>({x:e.x,cam:e.cam,lockId:e.lockId,area:e.area,section:e.section,task:e.task,boss:!!e.boss,elite:e.elite?.name||null}))}:null,lock:lock?{...lock}:null,bullets:bullets.map(b=>({...b})),discards:discards.map(d=>({...d})),zones:zones.map(z=>({...z})),effects:effects.map(f=>f.type),audio:soundtrack.status,player:player?{...player,pickTarget:null,grab:player.grab?{t:player.grab.t,hits:player.grab.hits,type:player.grab.e.type}:null,moveState:player.moveState?{name:player.moveState.name,k:player.moveState.k}:null}:null,enemies:enemies.map(e=>({...e,nid:e.nid,target:null,tp:null,byP:null,hitList:null,...(e.type==='mirror'?{rig:cloneInfo(e)}:{}),...(e.type==='fessenden'?{lot:{mode:crownModeOf(e),stagger:e.stagger||0}}:{})})),allies:allies.map(a=>({...a,target:null,rig:cloneInfo(a),rom:a.conscript?{key:a.ak||null,frame:a.af|0,fid:a.fid??null}:null})),objects:objects.map(o=>({...o})),drops:drops.map(d=>({...d})),scenery:scenery.map(c=>({...c})),crown:crown?{...crown}:null,wheels:spillWheels.map(w=>({...w})),bossObjects:bossObjs.map(o=>({...o})),bossCard:bossCard?{...bossCard}:null,radio:radio?radio.text:null,radioQueue:[...radioQueue],unlocked:save.unlocked,
  // G6 presentation: the card state, the area caption, the clear tally, the ending beat, the attract story
  card:card?{i:card.i,start:card.start,phase:card.phase,k:card.k,t:card.t,pre:card.pre}:null,caption:caption?{...caption}:null,tally:clearSeq?{...clearSeq.tally,t:clearSeq.t,story:clearSeq.story}:null,
  ending:endSeq?{k:endSeq.k,beat:endBeat()?.beat||null,t:endSeq.t,done:!!endSeq.done,actors:endActors.map(a=>({hero:a.hero,x:a.x,y:a.y,state:a.state,own:!!a.own,freed:!!a.freed,conscript:!!a.conscript})),car:endCar?{...endCar}:null,area:areaIndex,lot:endLot?{x:endLot.x,y:endLot.y,dir:endLot.dir,key:endLot.ba?.key||null,map:bossMap(endLot),gelMap:bossMap(endLot,true),parts:bFrame(endLot)?1:0,drawn:!!endLot.drawn,remnant:!!endLot.remnant}:null}:null,attract:attractSeq?{...attractSeq}:null,menuIdle,checkpoint:save.checkpoint?{...save.checkpoint}:null,
  // §3.17: every player in slot order, this machine's slot, the network status, the sim time (on a joiner the shown time)
  players:[0,1,2].map(k=>pview(players[k])),localSlot,net:NETROLE==='off'?null:netView(),time};},
 start:(i=0,hero=0,mode='story',section=0)=>{selected=clamp(hero,0,3);difficulty=normalizeDifficulty(mode);score=0;lives=3;startStage(clamp(i,0,5),{skipBrief:true,section});},step:(dt=1/60)=>NETROLE==='client'?clientStep(dt):stepSim(dt),controls:{attack,jump,special,pickup,coin:insertCoin},
 test:{loadChapter:i=>window.SEQUEL_RENDER?SEQUEL_RENDER.loadChapter(i):SR.require(i),damageObjective:n=>damageObjective(n,mission.active?.x,mission.active?.y,74,1),completeObjective,equip:(type,ammo)=>{player.pushV=0;player.pendingStrike=null;player.swing=null;player.dashPhase=null;player.attack=0;player.pickup=0;player.weapon=type;player.ammo=type?ammo??WEAPONS[type].ammo:0;},
  // spawnEnemy(x, y, 'kind[:V|:castId]', boss): a variant can be named (G4).
  spawnEnemy:(x,y,type='raider',boss=false)=>{const [k,V]=String(type).split(':'),e=spawnEnemy(x,y,k,boss);if(V)setVariant(e,castVariant(k,V,0,0)||V);return e;},drop:(type,x,y,food)=>drops.push({type,x,y,life:999,food:food||(type==='food'?'hamburger':type==='bonus'?'goldbar':type==='ammo'?'ammo':undefined)}),// move(x, y, area): arcade px in the area's own space; `area` (index or id) switches to that area first. The camera
  // stays where it is (skipTo moves it), so two renders with the hero moved compare the same view; the next step applies
  // the clamps.
  move:(x,y,area)=>{if(area!=null&&plan){const k=typeof area==='number'?area:plan.areas.findIndex(a=>a.id===area);if(k>=0&&k<plan.areas.length&&k!==areaIndex){enterArea(k);encIndex=Math.max(encIndex,plan.encounters.findIndex(e=>e.area===k));enterSection(plan.sections.findIndex(s=>s.area===k),true);}}
   player.x=x;player.y=y;},lane:f=>laneY(f,player.x),damageEnemy:(i,n)=>damageEnemy(enemies[i],n),damagePlayer:n=>damagePlayer(n,player.x-30),
  // clearFighters also beats whoever a beaten fighter leaves behind (KI15: a wrecked bike's rider), up to four passes.
  clearFighters:()=>{if(encounter&&!encounter.spec.boss){encounter.next=(encounter.spec.w||[]).length;encounter.eliteSpawned=true;}for(let pass=0;pass<4;pass++){const live=enemies.filter(e=>!e.dead&&!e.dying&&!e.setPiece&&e.state!=='flee');if(!live.length)break;live.forEach(e=>{e.waiting=false;e.inv=0;e.delay=0;if(e.state==='drop'){e.z=0;e.state='walk';}if(e.state==='submerged')e.state='walk';damageEnemy(e,9999);if(e.phase===2&&e.hp>0){e.inv=0;damageEnemy(e,9999);}});}},
  finishEncounter:()=>{completeObjective();LAST_EDEN.test.clearFighters();completeObjective();},
  // skipTo(k) puts the camera on fight k's lock trigger and the hero LOCK_LEAD px into its window (its area and section
  // switch with it), so the next step starts it.
  skipTo:n=>{const enc=plan.encounters[n];fade=null;lock=null;encounter=null;enemies=[];if(mission.active&&!mission.active.done)mission.active=null;
   if(enc.area!==areaIndex){enterArea(enc.area);enterSection(plan.sections.findIndex(s=>s.area===enc.area));}
   encIndex=n;camera=enc.cam;cameraY=STG.pathY(curArea(),camera);player.x=Math.min(enc.cam+LOCK_LEAD,curArea().w-17);{const b=bandOf(player.x);player.y=clamp(player.y,b.top,b.bottom);}
   if(multi())present().forEach((p,k)=>{if(p===player)return;p.x=Math.max(enc.cam+24,player.x-24*(k||1));const b=bandOf(p.x);p.y=clamp(p.y,b.top,b.bottom);});
   while(sectionIndex<enc.section&&plan.sections[sectionIndex+1]?.area===areaIndex)enterSection(sectionIndex+1);},
  // spawnBoss() is plan-based: it moves to the boss fight's lock (area and section included), then brings the boss in.
  spawnBoss:()=>{const k=plan.encounters.findIndex(e=>e.boss);if(!lock&&k>=0&&encIndex<=k){LAST_EDEN.test.skipTo(k);encIndex=k+1;lock={left:camera,right:camera+W};}spawnBoss();},
  // say(text) shows a radio line now (say(null) clears it), so a render can be compared with and without one.
  say:t=>{radio=t?{text:String(t),ttl:4.6}:null;},
  // toast(text, seconds) shows a toast in the HUD's free cells (G7); toast(null) clears it, so a test can render the HUD
  // without one. hud() reports what the HUD shows: the foe row ({type, v, name, face, bar}) or null, and the coin call
  // of this frame ({phase 0-127, call}).
  toast:(t,s=2)=>{toast=t?String(t):'';toastTime=t?s:0;},
  // hudName(s): the foe row's 13-cell form of a name (framing G7 checks every name the campaign can put there)
  hudName:s=>hudName(s),
  hud:()=>{const e=currentFoe(),b=e?foeBarState(e.dying||e.dead?0:e.hp,e.maxhp):null,B=hudLayout().blink||HUD_FALLBACK.blink,f=Math.floor(time*60)%B.period,call=f>=B.joinIn[0]&&f<B.joinIn[1]?'JOIN-IN':f>=B.insertCoin[0]&&f<B.insertCoin[1]?(coins>0?'JOIN-IN':'INSERT COIN'):null;
   return {font:UI()?.romFonts?'rom':'authored',foe:e?{type:e.type,v:e.v||null,boss:!!e.boss,name:foeName(e),face:foeFaceRec(e),bar:{len:b.len,fill:b.fill,layer:b.layer,cols:b.cols}}:null,coin:{phase:f,call},weapon:player?.weapon||null};},
  // pose(role, k) holds the hero on frame k of a HeroRig role (compare-frames scenes such as the victory thumbs-up);
  // pose(null) gives the clip choice back to the game state. Returns snapshot.player.anim.
  pose:(role,k=0)=>{heroAnim.force=role?{role,k:k|0}:null;if(player)updateHeroAnim(0,0);return player?.anim?{...player.anim}:null;},
  // freeClones is the engine's old name for freeing the chapter 6 conscripts (the tests keep it)
  freeClones:freeConscripts,freeConscripts,clear:stageClear,
  // G6: open a chapter on its card and panels (start() skips them), the title, the attract story, the ending, the
  // credits, and the NEXT buttons of the card and of the ending
  startCard:(i=0,hero=0,mode='story',section=0)=>{selected=clamp(hero,0,3);difficulty=normalizeDifficulty(mode);score=0;lives=3;startStage(clamp(i,0,5),{section});return state;},
  menu:()=>{menu();return state;},attract:()=>{attract();return state;},ending:()=>{ending();return state;},credits:()=>{credits();return state;},cardAdvance,endAdvance,
  // G6 fix: compose an intermission picture now (true once its sprite overlay is in ARCADE_UI), redraw a live one at frame t
  composePic:id=>composePic(id),picFrame:(id,t)=>{picFrame(id,t);return !!picDone[id];},picArt:()=>Object.fromEntries(Object.entries(PIC_ART).map(([id,A])=>[id,{size:A.size||[PIC_W,PIC_H],crop:A.crop||[0,0],bg:A.bg!==false,live:!!A.live,done:!!picDone[id]}])),
  // force a boss's next move: bossMove(i, name) below
  // G5 (compare-frames s20-s26): the boss as its ROM records put it on screen now ({type, fid, key, w, h, box:[x,y,w,h]} in
  // arcade px of the view; the gate controls their bake), and hideEnemy(i, on) leaves one
  // fighter (sprite, shadow, chain) out of the next renders, so two renders without a step isolate its pixels
  bossBox:i=>{const e=enemies[i],B=ROMB();if(!e||!e.boss||!B)return null;let P=[];
   if(e.type==='sable'&&e.phase===2){const C=B.crownEngine;if(C&&crown)P=[{fid:crown.cracked?C.frames.cracked:C.frames.idle,x:crown.x,y:crown.y,dir:-1}];}
   else{const f=bFrame(e);if(f)P=[{fid:f.fid,x:e.x,y:e.y-e.z,dir:e.dir,key:f.key}];}
   let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const p of P){const fr=B.frames[p.fid];if(!fr)continue;const L=p.dir>0?p.x-(fr[3]-fr[5]):p.x-fr[5],T=p.y-fr[6];x0=Math.min(x0,L);x1=Math.max(x1,L+fr[3]);y0=Math.min(y0,T);y1=Math.max(y1,T+fr[4]);}
   if(x1<x0)return null;return {type:e.type,name:e.name||null,fid:P[0].fid,key:P[0].key||null,parts:P.length,w:x1-x0,h:y1-y0,box:[x0-camera,y0-cameraY,x1-x0,y1-y0]};},
  // noDamage(true): the hero takes no damage (screenshots of a whole boss fight)
  noDamage:(on=true)=>{testNoDamage=!!on;return testNoDamage;},
  hideEnemy:(i,on=true)=>{const e=enemies[i];if(!e)return false;e.testHidden=!!on;return true;},
  // overlays(false) leaves the HUD, radio and mission strips out of the next renders (a tall boss's head sits under them)
  overlays:(on=true)=>{testNoOverlays=!on;return !testNoOverlays;},
  // hudOnly(true) paints the screen pass over a flat #ff00ff key instead of the world, so a test reads the HUD pixels
  // alone (framing G7, compare-frames s30: the cabinet element boxes)
  hudOnly:(on=true)=>{testHudOnly=!!on;return testHudOnly;},
  bossMove:(i,name)=>{const e=enemies[i];if(!e||!e.boss)return false;e.next=name;e.timer=0;e.waitT=9;if(!['intro','transform','mutate','dead','flee'].includes(e.state)){e.state='walk';e.z=0;e.rec=null;e.gaff=null;}return true;},
  // G4 (PLAN §4.6): the sequel HP of a kind's variant at this chapter's arcade level (before the difficulty), the ROM anim
  // an enemy is showing ({key, frame, fid, state, v}), a reinforcement arriving ('raider:C' pins a variant) and the set
  // pieces ('zeke' [side], 'naguri-vignette', a scenery id) for checks on any difficulty.
  kindHp:(type,V)=>kindHpOf(type,V||defaultVariant(type)),
  romAnimOf:i=>{const e=enemies[i];if(!e)return null;animateEnemy(e,0,0);return e.ak?{key:e.ak,frame:e.af,fid:e.fid,state:e.state,v:e.v}:null;},
  arrive:(type,side='R',j=0)=>arrive(type,side,j),
  setPiece:(id,side=1)=>id==='zeke'?spawnZeke(side):id==='naguri-vignette'?spawnVignette():(spawnScenery({scenery:[id]}),scenery.length),
  // the G3b drawers for visual checks: art.car(g,x,y,o), art.outlined(parts,x,y,z,dir,S,map,color) (draws on the game ctx)
  art:{car,outlined:drawOutlined}},
 mp:{adapter:MP_ADAPTER,role:()=>NETROLE,localSlot:()=>localSlot,addPlayer:(slot,hero,o)=>mpAddPlayer(slot,hero,o||{}),removePlayer:slot=>mpRemovePlayer(slot,'left'),input:mpInput,
  players:()=>{if(ctxPlayer&&ctxPlayer.mp)saveCtx(ctxPlayer);return [0,1,2].map(k=>{const p=players[k];if(!p)return null;const m=p.mp;return {slot:k,hero:m.hero,x:p.x,y:p.y,z:p.z,hp:p.hp,lives:m.lives,score:m.score,cont:m.cont?m.cont.t:null,out:!!m.out,seat:passenger(p)?1:0,target:null};});},
  targetOf:i=>{const t=enemies[i]&&enemies[i].tp;return t&&t.mp&&players[t.mp.slot]===t?t.mp.slot:null;},
  // inputLog(true) records every joiner frame the host applies ([step, slot, held, presses]); replay(log) feeds a log back
  // into scripted sources on one page, step by step: a reported multiplayer bug becomes a network-free repro (§3.16)
  inputLog:on=>{const r=inputRec;inputRec=on?[]:null;return r;},replay:log=>{replayQ=Array.isArray(log)?log.slice():null;stepNo=0;return !!replayQ;},
  schema:()=>NET_SCHEMA}};
// Chapter 1's pages load at start-up for the title backdrop and the first chapter (SEQUEL_RENDER.ready waits on them).
SR.require(0);preloadPics();
menu();requestAnimationFrame(frame);setTimeout(loadSelectionArt,0);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mpBoot);else mpBoot();
// ?online (the home page's PLAY WITH FRIENDS) opens the online lobby straight away; the parameter is stripped, so a reload
// shows the title. A ?join= link wins: mpBoot already took it to the join screen.
if(/[?&]online(?:[=&#]|$)/.test(location.search)&&!/[?&]join=/i.test(location.search)){try{const u=new URL(location.href);u.searchParams.delete('online');history.replaceState(history.state,'',u.pathname+u.search+u.hash);}catch(e){/* file:// in some browsers */}openLobby();}
window.SPRITES.whenReady(ok=>{if(!ok)panel('<section class="panel small-panel"><h2>ARTWORK COULD NOT LOAD.</h2><p>Keep the sprite-data-*.js files, game.js and play.html in the same folder, then open play.html again.</p></section>');else if(state==='select')characterSelect();});
})();
