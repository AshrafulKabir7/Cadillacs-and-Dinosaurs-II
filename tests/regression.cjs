const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
require('node:fs').mkdirSync('tests/results',{recursive:true});
const BASE=require('./lib/arcade.cjs').BASE;   // the game page, play.html on GAME_URL (index.html is the home page)

(async()=>{
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const checks=[],errors=[];
 const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
 page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE);
 await page.click('#newgame');check('Four playable heroes',await page.locator('[data-hero]').count()===4);await page.click('#begin');await page.click('#enter-stage');
 await page.waitForFunction(()=>LAST_EDEN.snapshot.audio.ready===4&&LAST_EDEN.snapshot.audio.playing);
 check('Stage plays supplied Four Heroes audio',await page.evaluate(()=>LAST_EDEN.snapshot.audio.id==='06'));
 await page.keyboard.press('Escape');await page.waitForTimeout(80);check('Pause suspends soundtrack',await page.evaluate(()=>!LAST_EDEN.snapshot.audio.playing));await page.click('#resume');
 await page.click('#sound');await page.waitForTimeout(80);check('Mute stops supplied soundtrack',await page.evaluate(()=>!LAST_EDEN.snapshot.audio.playing));
 await page.evaluate(()=>{LAST_EDEN.start(0);LAST_EDEN.test.spawnBoss();});await page.click('#sound');await page.waitForFunction(()=>LAST_EDEN.snapshot.audio.id==='09');check('Boss arrival starts the supplied intro',true);await page.waitForFunction(()=>LAST_EDEN.snapshot.audio.id==='10'&&LAST_EDEN.snapshot.audio.playing);check('Boss intro advances into looping battle track',true);await page.click('#sound');
 const combat=await page.evaluate(()=>{
  const g=LAST_EDEN,results=[];function ticks(n){for(let i=0;i<n;i++)g.step(.016);}
  // Arcade px (ARCHITECTURE §7): M is the middle of the feet band.
  const M=()=>g.snapshot.band.mid;
  function setup(){g.start(0);g.test.move(111,M());}
  function enemy(x=189,y=M(),type='raider'){const e=g.test.spawnEnemy(x,y,type);e.state='recover';e.timer=20;return e;}
  setup();let e=enemy(153);g.controls.attack();results.push(['Melee waits for the impact frame',e.hp===e.maxhp]);ticks(9);results.push(['Melee damages enemy in front',e.hp<e.maxhp]);
  setup();e=enemy(77);g.controls.attack();ticks(12);results.push(['Melee does not hit behind the hero',e.hp===e.maxhp]);
  setup();e=enemy(111);g.controls.attack();ticks(12);results.push(['Overlapping targets remain hittable at arena boundaries',e.hp<e.maxhp]);
  setup();e=enemy();let side=enemy(189,M()+30);g.test.equip('gun');g.controls.attack();ticks(20);results.push(['Pistol starts with six shots and spends one',g.snapshot.player.ammo===5]);results.push(['Pistol respects lane aiming',e.hp<e.maxhp&&side.hp===side.maxhp]);
  setup();e=enemy();side=enemy(189,M()+30);g.test.equip('shotgun');g.controls.attack();ticks(20);results.push(['Shotgun blast reaches adjacent lane',e.hp<e.maxhp&&side.hp<side.maxhp]);
  setup();e=enemy(222,M(),'brute');g.test.equip('uzi');g.controls.attack();ticks(40);results.push(['Uzi fires a three-round burst',g.snapshot.player.ammo===45&&Math.abs(e.maxhp-e.hp-45)<.1]);
  setup();e=enemy();side=enemy(222);g.test.equip('rifle');g.controls.attack();ticks(25);results.push(['Rifle penetrates two targets',e.hp<e.maxhp&&side.hp<side.maxhp]);
  setup();e=enemy(222,M(),'brute');side=enemy(237,M()+25,'brute');g.test.equip('bazooka');g.controls.attack();ticks(40);results.push(['Four-shot bazooka causes splash damage',g.snapshot.player.ammo===3&&e.hp<e.maxhp&&side.hp<side.maxhp]);
  setup();e=enemy(248,M(),'brute');g.test.equip('grenade');g.controls.attack();ticks(80);results.push(['Grenade arcs and explodes',g.snapshot.bullets.length===0&&e.hp<e.maxhp]);
  setup();g.test.equip('gun',2);g.controls.special();results.push(['Special drops weapon with remaining ammo',!g.snapshot.player.weapon&&g.snapshot.drops.some(d=>d.type==='gun'&&d.ammo===2)]);results.push(['Whiffed special does not cost health',g.snapshot.player.hp===g.snapshot.player.maxhp]);
  setup();e=enemy(152);g.controls.special();results.push(['Connecting special costs eight health',g.snapshot.player.hp===g.snapshot.player.maxhp-8]);
  setup();g.test.equip('shotgun',3);ticks(110);g.test.damagePlayer(24);results.push(['Heavy hit knocks down and drops weapon',g.snapshot.player.knocked&&!g.snapshot.player.weapon&&g.snapshot.drops.some(d=>d.type==='shotgun'&&d.ammo===3)]);
  setup();ticks(110);g.controls.jump();ticks(9);let hp=g.snapshot.player.hp;g.test.damagePlayer(24);results.push(['Jump avoids grounded hit',g.snapshot.player.hp===hp]);
  setup();e=enemy(189,M(),'raptor');g.test.damageEnemy(0,1000);results.push(['Defeated dinosaur calms and leaves',e.state==='flee']);ticks(90);results.push(['Calmed dinosaur exits the encounter',g.snapshot.enemies.length===0]);
  // Weapon blows land on their ROM event frame (HEROES D11: swing ev1 after 7-8 f, stab ev1 after 6 f; PLAN §7 G3c).
  setup();g.test.equip('rod',1);e=enemy(152);g.controls.attack();ticks(15);results.push(['Broken rod becomes a stick',g.snapshot.player.weapon==='stick']);
  setup();e=enemy(152);g.test.equip('knife');g.controls.attack();ticks(12);results.push(['Nearby knife stabs instead of being thrown',g.snapshot.player.weapon==='knife'&&e.hp<e.maxhp]);
  // The knife throws when nothing is inside the hero's ROM stab box (0x62AE; HEROES D17): Mustapha's box reaches 128 px,
  // so the distant target stands 149 px ahead (126 px is a stab for him; it was outside Jack's 112-px box).
  setup();e=enemy(260);g.test.equip('knife');g.controls.attack();ticks(30);results.push(['Distant knife attack throws the blade',!g.snapshot.player.weapon&&e.hp<e.maxhp]);
  setup();{const gun=g.snapshot.drops.find(d=>d.type==='gun');g.test.move(gun.x,gun.y);}g.controls.attack();const crouched=g.snapshot.player.pickup>0&&!g.snapshot.player.weapon;ticks(20);results.push(['Attack button crouches and picks up a nearby weapon',crouched&&g.snapshot.player.weapon==='gun']);
  setup();for(const type of ['gun','uzi','shotgun','rifle','m16','bazooka','knife','rod','stick','club','torch','grenade','dynamite','stone','bknife']){g.test.equip(type);g.controls.attack();ticks(70);g.render();}results.push(['All fifteen weapon types (B. KNIFE included) execute and draw without a runtime error',true]);
  return results;
 });for(const [name,ok] of combat)check(name,ok);
 const NCH=await page.evaluate(()=>EDEN_CAMPAIGN.length);   // eight stages since revision 3
 for(let level=0;level<NCH;level++){
  const result=await page.evaluate(i=>{const g=LAST_EDEN,L=EDEN_CAMPAIGN.length-1;g.start(i,i%4);function ticks(n){for(let k=0;k<n;k++)g.step(.033);}const plan=g.snapshot.plan,last=plan.encounters.length-1;if(plan.sections.length!==6)throw new Error('Stage '+i+' needs six sections');for(let w=0;w<last;w++){g.test.skipTo(w);g.step(.016);if(g.snapshot.wave!==w+1)throw new Error(`Missing encounter ${i}:${w}`);g.test.finishEncounter();ticks(70);}g.test.skipTo(last);g.step(.016);ticks(82);const boss=g.snapshot.enemies.find(e=>e.boss);if(!boss)throw new Error('No boss '+i);let phase=true;if(i===L){g.test.damageEnemy(g.snapshot.enemies.findIndex(e=>e.boss),9999);phase=!g.snapshot.enemies.some(e=>e.type==='sable'&&e.phase===2&&e.hp>0);}g.test.finishEncounter();ticks(55);
   // The final stage has one more boss: beaten, Sable takes the unfinished treatment and becomes CROWNBACK (no gate controls).
   let lastCopy=null;if(i===L){lastCopy=g.snapshot.enemies.find(e=>e.type==='fessenden'&&e.boss);g.test.finishEncounter();ticks(90);}return {state:g.state,phase,lastCopy:!!lastCopy,unlocked:g.snapshot.unlocked};},level);
  check(`Stage ${level+1} has six sections of encounters and a completable boss`,result.state==='clear');if(level===NCH-1){check('The final boss has no gate-controls phase',result.phase);check('Beaten, Sable returns as CROWNBACK, the final boss',result.lastCopy);}
  if(level<NCH-1){await page.click('#next');check(`Stage ${level+1} continues to next briefing`,await page.evaluate(()=>LAST_EDEN.state==='brief'));}
 }
 await page.click('#next');check('Campaign reaches ending',await page.evaluate(()=>LAST_EDEN.state==='ending'));await page.reload();check('Stage unlocks persist (all eight)',await page.evaluate(()=>LAST_EDEN.snapshot.unlocked===7));
 await page.click('#jukebox');check('Sound room exposes all 36 unique tracks',await page.locator('[data-track]').count()===36);await page.click('[data-track="24"]');await page.waitForFunction(()=>LAST_EDEN.snapshot.audio.id==='24'&&LAST_EDEN.snapshot.audio.playing&&LAST_EDEN.snapshot.audio.ready===4);check('Sound room plays selected MP3',true);
 // Verify each MP3 parses and can be decoded in the actual browser media element.
 const audio=await page.evaluate(async()=>{const results=[];for(const t of SOUNDTRACK){const a=new Audio();a.preload='metadata';const ok=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),6000);a.onloadedmetadata=()=>{clearTimeout(timer);resolve(a.duration>0);};a.onerror=()=>{clearTimeout(timer);resolve(false);};a.src=t.file;});results.push({id:t.id,ok});a.pause();a.removeAttribute('src');a.load();}return results;});check('All 27 audio files load and report duration',audio.every(x=>x.ok));
 // Original arcade voices (work/audio/VOICES.md): every event maps to a shipped clip that decodes, the cooldown holds a
 // kind back, variants never repeat back to back, at most VOICE_MAX play at once (a high-priority voice cuts the oldest).
 const vfiles=await page.evaluate(()=>LAST_EDEN.voice.files());
 check('Voice events name existing assets/sfx/voice files',vfiles.length>=20&&vfiles.every(f=>{try{return fs.statSync('assets/sfx/voice/'+f+'.mp3').size>1000;}catch(e){return false;}}));
 const vaudio=await page.evaluate(async files=>{const out=[];for(const f of files){const a=new Audio();a.preload='metadata';out.push(await new Promise(res=>{const t=setTimeout(()=>res(false),6000);a.onloadedmetadata=()=>{clearTimeout(t);res(a.duration>.1&&a.duration<2);};a.onerror=()=>{clearTimeout(t);res(false);};a.src='assets/sfx/voice/'+f+'.mp3';}));a.removeAttribute('src');a.load();}return out;},vfiles);
 check('Every voice clip decodes in the browser (0.1-2 s)',vaudio.every(Boolean));
 const vrules=await page.evaluate(()=>{const V=LAST_EDEN.voice;V.reset();const heroes=['jack','mustapha','hannah','mess'];
  const perHero=['jump','attack','throw','special','death','food','win'].every(k=>heroes.every(h=>(V.map[k][h]||[]).length>0));
  const cd=V.cooldown.enemyDeath,a=V.pick('enemyDeath',null,100),held=V.pick('enemyDeath',null,100+cd*.5),b=V.pick('enemyDeath',null,100+cd+.01);
  const seq=[];for(let i=0;i<12;i++)seq.push(V.pick('enemyDeath',null,200+i*(cd+.01)));const noRepeat=seq.every((f,i)=>f&&(i===0||f!==seq[i-1]));
  const hero=V.pick('death','hannah',300)==='hannah-death'&&V.pick('death','hannah',300.1)===null&&V.pick('death','jack',300.1)==='jack-death';
  V.reset();const p1=V.play('enemy-grunt'),p2=V.play('enemy-scream'),p3=V.play('enemy-scream2'),live=V.live,p4=V.play('!boss-laugh');V.reset();
  return {perHero,cool:!!a&&held===null&&!!b,noRepeat,hero,cap:p1&&p2&&!p3&&live<=V.max&&p4,seq};});
 check('Every hero has jump, attack, throw, special, death, food and win voices',vrules.perHero);
 check('A voice kind cools down (a second call inside the cooldown is dropped)',vrules.cool);
 check('Enemy screams rotate without the same clip twice running',vrules.noRepeat);
 check('Hero voices cool down per hero (Hannah screams with her own clip)',vrules.hero);
 check('At most two voices play at once; a high-priority voice cuts in',vrules.cap);
 await page.goto(require('node:url').pathToFileURL(require('node:path').resolve('play.html')).href);await page.waitForFunction(()=>window.SEQUEL_RENDER&&SEQUEL_RENDER.ready,null,{polling:100});check('Offline file launch loads the stage pages',await page.evaluate(()=>SEQUEL_RENDER.pagesLoaded(0)>0));await page.click('#newgame');await page.click('#begin');await page.click('#enter-stage');await page.waitForFunction(()=>LAST_EDEN.snapshot.audio.ready===4);check('Offline file launch plays local music',await page.evaluate(()=>LAST_EDEN.state==='play'&&LAST_EDEN.snapshot.audio.playing));
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(BASE);await mobile.tap('#newgame');await mobile.tap('#begin');await mobile.tap('#enter-stage');check('Mobile layout has no horizontal overflow',await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check('Touch attack control is visible',await mobile.locator('[data-key="KeyJ"]').isVisible());await mobile.tap('[data-key="KeyK"]');await mobile.waitForFunction(()=>LAST_EDEN.snapshot.player.z>0);check('Touch jump activates physics',await mobile.evaluate(()=>LAST_EDEN.snapshot.player.z>0));await mobile.screenshot({path:'tests/results/mobile-play.png'});
 check('No browser runtime exceptions',errors.length===0);const report={passed:checks.length,checks,errors,audio,at:new Date().toISOString()};fs.writeFileSync('tests/results/regression-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
