const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
require('node:fs').mkdirSync('tests/results',{recursive:true});
const BASE=process.env.GAME_URL||'http://127.0.0.1:8766';
(async()=>{
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const checks=[],errors=[];
 const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
 page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE);
 await page.click('#newgame');check('Four playable heroes',await page.locator('[data-hero]').count()===4);await page.click('#begin');await page.click('#enter-stage');
 await page.waitForFunction(()=>LAST_EDEN.snapshot.audio.ready===4&&LAST_EDEN.snapshot.audio.playing);
 check('Stage plays supplied Four Heroes audio',await page.evaluate(()=>LAST_EDEN.snapshot.audio.id==='06'));
 await page.keyboard.press('Escape');await page.waitForTimeout(80);check('Pause suspends soundtrack',await page.evaluate(()=>!LAST_EDEN.snapshot.audio.playing));await page.click('#resume');
 await page.click('#sound');await page.waitForTimeout(80);check('Mute stops supplied soundtrack',await page.evaluate(()=>!LAST_EDEN.snapshot.audio.playing));
 await page.evaluate(()=>{LAST_EDEN.start(0);LAST_EDEN.test.move(3900,350);LAST_EDEN.test.spawnBoss();});await page.click('#sound');await page.waitForFunction(()=>LAST_EDEN.snapshot.audio.id==='09');check('Boss arrival starts the supplied intro',true);await page.waitForFunction(()=>LAST_EDEN.snapshot.audio.id==='10'&&LAST_EDEN.snapshot.audio.playing);check('Boss intro advances into looping battle track',true);await page.click('#sound');
 const combat=await page.evaluate(()=>{
  const g=LAST_EDEN,results=[];function ticks(n){for(let i=0;i<n;i++)g.step(.016);}
  function setup(){g.start(0);g.test.move(150,346);}
  function enemy(x=255,y=346,type='raider'){const e=g.test.spawnEnemy(x,y,type);e.state='recover';e.timer=20;return e;}
  setup();let e=enemy(207);g.controls.attack();results.push(['Melee waits for the impact frame',e.hp===e.maxhp]);ticks(9);results.push(['Melee damages enemy in front',e.hp<e.maxhp]);
  setup();e=enemy(104);g.controls.attack();ticks(12);results.push(['Melee does not hit behind the hero',e.hp===e.maxhp]);
  setup();e=enemy(150);g.controls.attack();ticks(12);results.push(['Overlapping targets remain hittable at arena boundaries',e.hp<e.maxhp]);
  setup();e=enemy();let side=enemy(255,386);g.test.equip('gun');g.controls.attack();ticks(20);results.push(['Pistol starts with six shots and spends one',g.snapshot.player.ammo===5]);results.push(['Pistol respects lane aiming',e.hp<e.maxhp&&side.hp===side.maxhp]);
  setup();e=enemy();side=enemy(255,386);g.test.equip('shotgun');g.controls.attack();ticks(20);results.push(['Shotgun blast reaches adjacent lane',e.hp<e.maxhp&&side.hp<side.maxhp]);
  setup();e=enemy(300,346,'brute');g.test.equip('uzi');g.controls.attack();ticks(40);results.push(['Uzi fires a three-round burst',g.snapshot.player.ammo===45&&Math.abs(e.maxhp-e.hp-45)<.1]);
  setup();e=enemy();side=enemy(300);g.test.equip('rifle');g.controls.attack();ticks(25);results.push(['Rifle penetrates two targets',e.hp<e.maxhp&&side.hp<side.maxhp]);
  setup();e=enemy(300,346,'brute');side=enemy(320,380,'brute');g.test.equip('bazooka');g.controls.attack();ticks(40);results.push(['Four-shot bazooka causes splash damage',g.snapshot.player.ammo===3&&e.hp<e.maxhp&&side.hp<side.maxhp]);
  setup();e=enemy(335,346,'brute');g.test.equip('grenade');g.controls.attack();ticks(80);results.push(['Grenade arcs and explodes',g.snapshot.bullets.length===0&&e.hp<e.maxhp]);
  setup();g.test.equip('gun',2);g.controls.special();results.push(['Special drops weapon with remaining ammo',!g.snapshot.player.weapon&&g.snapshot.drops.some(d=>d.type==='gun'&&d.ammo===2)]);results.push(['Whiffed special does not cost health',g.snapshot.player.hp===g.snapshot.player.maxhp]);
  setup();e=enemy(205);g.controls.special();results.push(['Connecting special costs eight health',g.snapshot.player.hp===g.snapshot.player.maxhp-8]);
  setup();g.test.equip('shotgun',3);ticks(110);g.test.damagePlayer(24);results.push(['Heavy hit knocks down and drops weapon',g.snapshot.player.knocked&&!g.snapshot.player.weapon&&g.snapshot.drops.some(d=>d.type==='shotgun'&&d.ammo===3)]);
  setup();ticks(110);g.controls.jump();ticks(9);let hp=g.snapshot.player.hp;g.test.damagePlayer(24);results.push(['Jump avoids grounded hit',g.snapshot.player.hp===hp]);
  setup();e=enemy(255,346,'raptor');g.test.damageEnemy(0,1000);results.push(['Defeated dinosaur calms and leaves',e.state==='flee']);ticks(90);results.push(['Calmed dinosaur exits the encounter',g.snapshot.enemies.length===0]);
  setup();g.test.equip('rod',1);e=enemy(205);g.controls.attack();results.push(['Broken rod becomes a stick',g.snapshot.player.weapon==='stick']);
  setup();e=enemy(205);g.test.equip('knife');g.controls.attack();results.push(['Nearby knife stabs instead of being thrown',g.snapshot.player.weapon==='knife'&&e.hp<e.maxhp]);
  setup();e=enemy(320);g.test.equip('knife');g.controls.attack();ticks(30);results.push(['Distant knife attack throws the blade',!g.snapshot.player.weapon&&e.hp<e.maxhp]);
  setup();g.test.move(230,360);g.controls.attack();const crouched=g.snapshot.player.pickup>0&&!g.snapshot.player.weapon;ticks(20);results.push(['Attack button crouches and picks up a nearby weapon',crouched&&g.snapshot.player.weapon==='gun']);
  setup();for(const type of ['gun','uzi','shotgun','rifle','m16','bazooka','knife','rod','stick','club','torch','grenade','dynamite','stone']){g.test.equip(type);g.controls.attack();ticks(70);}results.push(['All fourteen weapon types execute without a runtime error',true]);
  return results;
 });for(const [name,ok] of combat)check(name,ok);
 for(let level=0;level<6;level++){
  const result=await page.evaluate(i=>{const g=LAST_EDEN;g.start(i,i%4);function ticks(n){for(let k=0;k<n;k++)g.step(.033);}const plan=g.snapshot.plan,last=plan.encounters.length-1;if(plan.sections.length!==6)throw new Error('Chapter '+i+' needs six sections');for(let w=0;w<last;w++){g.test.skipTo(w);g.step(.016);if(g.snapshot.wave!==w+1)throw new Error(`Missing encounter ${i}:${w}`);g.test.finishEncounter();ticks(70);}g.test.skipTo(last);g.step(.016);ticks(82);const boss=g.snapshot.enemies.find(e=>e.boss);if(!boss)throw new Error('No boss '+i);let phase=true;if(i===5){g.test.damageEnemy(g.snapshot.enemies.findIndex(e=>e.boss),9999);phase=g.snapshot.enemies.some(e=>e.phase===2&&e.hp>0);}g.test.finishEncounter();ticks(55);
   // The final chapter has one more boss after the spillway: the last copy (LOT 00 · FESSENDEN).
   let lastCopy=null;if(i===5){lastCopy=g.snapshot.enemies.find(e=>e.type==='fessenden'&&e.boss);g.test.finishEncounter();ticks(90);}return {state:g.state,phase,lastCopy:!!lastCopy,unlocked:g.snapshot.unlocked};},level);
  check(`Chapter ${level+1} has six sections of encounters and a completable boss`,result.state==='clear');if(level===5){check('Final boss advances to the Crown Engine phase',result.phase);check('The spillway releases the last copy of Fessenden as a final boss',result.lastCopy);}
  if(level<5){await page.click('#next');check(`Chapter ${level+1} continues to next briefing`,await page.evaluate(()=>LAST_EDEN.state==='brief'));}
 }
 await page.click('#next');check('Campaign reaches ending',await page.evaluate(()=>LAST_EDEN.state==='ending'));await page.reload();check('Chapter unlocks persist',await page.evaluate(()=>LAST_EDEN.snapshot.unlocked===5));
 await page.click('#jukebox');check('Sound room exposes all 36 unique tracks',await page.locator('[data-track]').count()===36);await page.click('[data-track="24"]');await page.waitForFunction(()=>LAST_EDEN.snapshot.audio.id==='24'&&LAST_EDEN.snapshot.audio.playing&&LAST_EDEN.snapshot.audio.ready===4);check('Sound room plays selected MP3',true);
 // Verify each MP3 parses and can be decoded in the actual browser media element.
 const audio=await page.evaluate(async()=>{const results=[];for(const t of SOUNDTRACK){const a=new Audio();a.preload='metadata';const ok=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),6000);a.onloadedmetadata=()=>{clearTimeout(timer);resolve(a.duration>0);};a.onerror=()=>{clearTimeout(timer);resolve(false);};a.src=t.file;});results.push({id:t.id,ok});a.pause();a.removeAttribute('src');a.load();}return results;});check('All 27 audio files load and report duration',audio.every(x=>x.ok));
 await page.goto(require('node:url').pathToFileURL(require('node:path').resolve('index.html')).href);await page.click('#newgame');await page.click('#begin');await page.click('#enter-stage');await page.waitForFunction(()=>LAST_EDEN.snapshot.audio.ready===4);check('Offline file launch plays local music',await page.evaluate(()=>LAST_EDEN.state==='play'&&LAST_EDEN.snapshot.audio.playing));
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(BASE);await mobile.tap('#newgame');await mobile.tap('#begin');await mobile.tap('#enter-stage');check('Mobile layout has no horizontal overflow',await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check('Touch attack control is visible',await mobile.locator('[data-key="KeyJ"]').isVisible());await mobile.tap('[data-key="KeyK"]');await mobile.waitForFunction(()=>LAST_EDEN.snapshot.player.z>0);check('Touch jump activates physics',await mobile.evaluate(()=>LAST_EDEN.snapshot.player.z>0));await mobile.screenshot({path:'tests/results/mobile-play.png'});
 check('No browser runtime exceptions',errors.length===0);const report={passed:checks.length,checks,errors,audio,at:new Date().toISOString()};fs.writeFileSync('tests/results/regression-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
