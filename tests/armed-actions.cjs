const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
fs.mkdirSync('tests/results',{recursive:true});
const BASE=require('./lib/arcade.cjs').BASE;   // the game page, play.html on GAME_URL (index.html is the home page)

(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),checks=[],errors=[];
 const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
 page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE);await page.click('#sound');
 const rows=await page.evaluate(()=>{
  const g=LAST_EDEN,results=[],guns={gun:[6,32,1],uzi:[48,15,3],shotgun:[6,56,1],rifle:[6,70,1],m16:[60,21,3],bazooka:[4,108,1]};
  // Arcade px (ARCHITECTURE §7): M is the middle of the feet band at the player.
  const M=()=>g.snapshot.band.mid;
  function ticks(n){for(let i=0;i<n;i++)g.step(.016);}
  function target(x){const e=g.test.spawnEnemy(x,M(),'brute');e.hp=e.maxhp=10000;e.state='recover';e.timer=1000;return e;}
  for(let hero=0;hero<4;hero++){
   for(const [weapon,[ammo,damage,shots]] of Object.entries(guns)){
    g.start(0,hero);g.test.move(74,M());const e=target(100);g.test.equip(weapon);g.controls.attack();g.render();
    // The ROM muzzle height (HEROES §10.3, 48-69 arcade px) lies inside the enemy hit window (z+4 .. z+83).
    const armedPose=g.snapshot.player.pose==='fire'&&g.snapshot.gunSocket.held===true&&g.snapshot.gunSocket.y>4&&g.snapshot.gunSocket.y<83;ticks(50);
    const expected=damage*shots*(hero===2?1.25:1);
    results.push([`Hero ${hero+1}: ${weapon} hits at point-blank range without extra melee damage`,armedPose&&g.snapshot.player.ammo===ammo-shots&&Math.abs(e.maxhp-e.hp-expected)<.01&&g.snapshot.player.pendingStrike===null]);
    // An empty gun is hurled at the enemy as soon as the hero is free, never silently swapped for a punch.
    e.state='recover';e.timer=1000;ticks(90);g.test.equip(weapon,0);g.step(1/60);const thrown=g.snapshot.bullets.some(b=>b.kind==='thrown'&&b.weapon===weapon),pose=g.snapshot.player.attackKind;ticks(40);
    results.push([`Hero ${hero+1}: empty ${weapon} is thrown at the enemy instead of punching or lingering`,thrown&&pose==='throw'&&g.snapshot.player.weapon===null&&g.snapshot.player.ammo===0&&g.snapshot.player.pendingStrike===null]);
   }
   g.start(0,hero);g.test.move(74,M());const e=target(107);g.controls.attack();g.test.drop('gun',74,M());g.controls.pickup();const crouch=g.snapshot.player.pickup>0;ticks(25);const punched=e.hp<e.maxhp;g.controls.attack();ticks(25);
   results.push([`Hero ${hero+1}: picking up a gun crouches, cancels a pending punch and then fires`,crouch&&!punched&&g.snapshot.player.weapon==='gun'&&Math.abs(e.maxhp-e.hp-32*(hero===2?1.25:1))<.01]);
  }
  g.start(0);g.test.move(74,M());const e=target(47);g.test.equip('gun');g.controls.attack();ticks(25);results.push(['Gunfire does not hit a close target behind the hero',e.hp===e.maxhp]);
  // G5 (PLAN §7 5b, CAMPAIGN §7.4; revision 3: stage 2): Headkeeper Thorne will not leave her collar winch (the boss task
  // beside her): she never goes more than BOSS_DEFS.thorne.tether (260 px) from it, wherever the hero leads her.
  {g.start(1,0,'story');g.test.spawnBoss();ticks(160);const s0=g.snapshot,dr=s0.mission.active,teth=BOSS_DEFS.thorne.tether;let far=0;
   for(const [dx,f] of [[18,.5],[18,.2],[200,.8],[18,.83]]){g.test.move(s0.lock.left+dx,g.test.lane(f));for(let i=0;i<150;i++){g.step(.016);const b=g.snapshot.enemies.find(e=>e.boss);if(b&&b.state!=='intro'&&b.state!=='flee')far=Math.max(far,Math.abs(b.x-dr.x));}}
   results.push([`Thorne never strays more than her ${teth}-px leash from the collar winch (max ${far.toFixed(1)} px)`,teth===260&&far>0&&far<=teth+.5]);}
  // CAMPAIGN §7.4: beyond her leash is a safe rest. A hero more than the tether from the winch (lock.left + 20) is never
  // reached by Thorne's blows, while one inside her reach is.
  {const hits=dx=>{g.start(1,0,'story');g.test.spawnBoss();ticks(160);const L=g.snapshot.lock,dr=g.snapshot.mission.active;let lost=0,last=g.snapshot.player.hp,lives=g.snapshot.lives;
    for(let i=0;i<600;i++){g.test.move(L.left+dx,g.snapshot.player.y);g.step(.016);const p=g.snapshot.player;if(p.hp<last)lost+=last-p.hp;last=p.hp;}return {lost:lost+(lives-g.snapshot.lives)*999,far:Math.abs(dr.x-(L.left+dx))};};
   const out=hits(20),inn=hits(150);
   results.push([`Beyond Thorne's leash is a safe rest (a hero ${out.far.toFixed(0)} px from the winch loses ${out.lost.toFixed(0)} HP; ${inn.far.toFixed(0)} px away, ${inn.lost.toFixed(0)} HP)`,out.far>BOSS_DEFS.thorne.tether&&out.lost===0&&inn.far<BOSS_DEFS.thorne.tether&&inn.lost>0]);}
  // Revision 3: Thorne stays human in stage 2. Smashing her winch opens her (x1.5); beaten, she goes into the river and
  // escapes (defeat 'escape': no transformation, no arrest). Glassback is a separate stage-6 fight, already transformed.
  g.start(1);g.test.spawnBoss();ticks(160);g.test.damageObjective(9999);ticks(2);results.push(['Smashing Thorne’s collar winch opens her to x1.5',g.snapshot.enemies[0].type==='thorne'&&g.snapshot.enemies[0].vulnMul===1.5&&!g.snapshot.mission.active]);
  g.test.damageEnemy(0,9999);ticks(2);results.push(['Beaten, Thorne escapes into the river (no transformation, no arrest)',g.snapshot.enemies[0].type==='thorne'&&g.snapshot.enemies[0].phase===1&&g.snapshot.enemies[0].defeat?.kind==='escape']);
  g.start(5);g.test.spawnBoss();ticks(170);results.push(['Stage 6’s boss is GLASSBACK, fought already transformed',g.snapshot.enemies[0].type==='glassback'&&g.snapshot.enemies[0].name==='GLASSBACK'&&g.snapshot.enemies[0].phase===1]);
  {const b0=g.snapshot.enemies[0];g.test.damageEnemy(0,b0.hp-b0.maxhp*.3);ticks(2);results.push(['Damaging Glassback’s harness (35 %) starts her uncontrolled final rush',g.snapshot.enemies[0].state==='script'||g.snapshot.enemies[0].tempoMul>1]);}
  g.start(7);g.test.spawnBoss();ticks(160);g.test.damageEnemy(0,9999);ticks(30);{const b=g.snapshot.enemies.find(e=>e.boss&&!e.dead);results.push(['Beaten, Sable takes the treatment at once (no gate-controls phase): CROWNBACK transforms',!!b&&b.type==='fessenden'&&b.state==='mutate'&&g.snapshot.mission.active==null]);}
  return results;
 });for(const [name,ok] of rows)check(name,ok);
 // HEROES O4 (the user: "I should be able to pick drums"): PICK UP beside an oil drum or a barrel lifts it on the ROM
 // lift clip; it is carried overhead on the container class (stand / walkTorso over legsWalk / containerJump, ROM holds),
 // slower and never running, jumps the low kind-3 hop, and ATTACK throws it: it knocks the first foe down for its
 // damage, breaks and drops what it held. A hit while carrying drops and breaks it.
 const drums=await page.evaluate(()=>{
  const g=LAST_EDEN,out=[],M=()=>g.snapshot.band.mid,held=new Set();function ticks(n){for(let i=0;i<n;i++)g.step(.016);}
  function key(code,on){if(on!==held.has(code)){window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));on?held.add(code):held.delete(code);}}
  for(let hero=0;hero<4;hero++){const type=hero%2?'barrel':'crate',id=type==='crate'?'container-drum':'container-barrel',rec=type==='crate'?1861:1873,dmg=type==='crate'?64:56;
   g.start(0,hero);g.test.clearFighters();g.test.move(200,M());ticks(2);const o=g.test.prop(type,228,g.snapshot.player.y,'gun');
   g.controls.pickup();ticks(4);const lift=g.snapshot.player.pose==='lift'&&g.snapshot.player.anim?.role==='lift'&&g.snapshot.player.weapon===null&&o.hp>0;ticks(30);g.render();
   const p=g.snapshot.player,carried=p.weapon===id&&p.pose==='carry'&&p.anim.role==='stand.container'&&o.hp<=0&&g.snapshot.held?.rec===rec&&g.snapshot.held.origin[1]<-60;
   out.push([`Hero ${hero+1}: PICK UP lifts the ${type==='crate'?'oil drum':'barrel'} on the ROM lift clip and carries it overhead`,lift&&carried]);
   let x0=g.snapshot.player.x;key('KeyD',true);key('ShiftLeft',true);ticks(30);g.render();const w=g.snapshot.player,v=(w.x-x0)/(30*.016),walkV=HeroRig.hero(HeroRig.data.gameOrder[hero]).speed.walk*60;
   out.push([`Hero ${hero+1}: carrying, the hero walks on walkTorso.container at .94 of the walk and cannot run (${v.toFixed(1)} px/s)`,w.pose==='carry-walk'&&w.anim.role==='walkTorso.container'&&w.anim.legs?.role==='legsWalk'&&!w.run&&Math.abs(v-walkV*.94)<2&&g.snapshot.held?.weapon===id]);
   key('ShiftLeft',false);g.controls.jump();ticks(3);const jr=g.snapshot.player.anim.role;let top=0,n=0;for(;n<90&&g.snapshot.player.z>0;n++){top=Math.max(top,g.snapshot.player.z);ticks(1);}key('KeyD',false);
   out.push([`Hero ${hero+1}: a carrying jump is the ROM's low container hop (${top.toFixed(1)} px, ${n} ticks) on containerJump`,/^containerJump/.test(jr)&&top>8&&top<30&&n<40&&g.snapshot.player.weapon===id]);
   ticks(20);g.test.move(200,M());ticks(1);const P=g.snapshot.player,e=g.test.spawnEnemy(P.x+120,P.y,'brute');e.hp=e.maxhp=1000;e.state='recover';e.timer=1000;const ex=e.x;
   g.controls.attack();ticks(2);const role=g.snapshot.player.anim.role;ticks(12);let flew=false;for(let i=0;i<80&&g.snapshot.bullets.some(b=>b.kind==='container');i++){flew=true;ticks(1);}ticks(2);
   const gun=g.snapshot.drops.find(d=>d.type==='gun'&&Math.abs(d.x-ex)<40);
   out.push([`Hero ${hero+1}: ATTACK throws it (attack.container); it knocks the brute down for ${dmg}, breaks and drops its gun`,role==='attack.container'&&flew&&g.snapshot.player.weapon===null&&Math.abs(e.maxhp-e.hp-dmg)<.01&&['fly','down'].includes(e.state)&&!!gun]);
   g.test.equip(id);ticks(1);g.test.damagePlayer(5);ticks(1);
   out.push([`Hero ${hero+1}: a hit while carrying drops the container, which breaks`,g.snapshot.player.weapon===null&&g.snapshot.effects.includes('container')]);
  }
  for(const k of held)window.dispatchEvent(new KeyboardEvent('keyup',{code:k,bubbles:true}));
  // ATTACK while walking towards a container attacks (only PICK UP lifts, unlike ROM 0x5B68); E lifts, E again throws
  g.start(0,1);g.test.clearFighters();g.test.move(200,M());ticks(2);g.test.prop('crate',226,g.snapshot.player.y,'food');key('KeyD',true);ticks(1);g.controls.attack();const swung=!!g.snapshot.player.attack;key('KeyD',false);ticks(40);
  const punched=g.snapshot.player.weapon===null;g.test.clearFighters();g.test.prop('crate',g.snapshot.player.x+24,g.snapshot.player.y,'food');g.controls.pickup();ticks(40);const lifted=g.snapshot.player.weapon==='container-drum';g.controls.pickup();ticks(14);
  out.push(['ATTACK towards a drum attacks; PICK UP lifts it and PICK UP again throws it',swung&&punched&&lifted&&g.snapshot.player.weapon===null&&g.snapshot.bullets.some(b=>b.kind==='container'&&b.vx>0)]);
  return out;
 });for(const [name,ok] of drums)check(name,ok);
 // Real input: running persists while its direction stays held (the release is the KI22 check below).
 await page.evaluate(()=>LAST_EDEN.start(0));await page.keyboard.press('ArrowRight');await page.keyboard.down('ArrowRight');
 await page.evaluate(()=>{for(let i=0;i<125;i++)LAST_EDEN.step(.016);});check('Double-tap running does not expire after 1.6 seconds while held',await page.evaluate(()=>LAST_EDEN.snapshot.player.run));
 await page.keyboard.up('ArrowRight');
 // KI22 (mechanics VERIFY #2, PLAN §7 G3c): after a double-tap run the hero keeps running when the stick is released,
 // until another input; the opposite direction walks.
 await page.evaluate(()=>LAST_EDEN.start(0));await page.keyboard.press('KeyD');await page.keyboard.down('KeyD');await page.evaluate(()=>{for(let i=0;i<3;i++)LAST_EDEN.step(.016);});await page.keyboard.up('KeyD');
 await page.evaluate(()=>{for(let i=0;i<60;i++)LAST_EDEN.step(.016);});check('A double-tap run persists after the direction is released',await page.evaluate(()=>LAST_EDEN.snapshot.player.run===true));
 await page.keyboard.down('KeyA');check('The opposite direction ends the persisting run within 3 ticks',await page.evaluate(()=>{let off=false;for(let i=0;i<3&&!off;i++){LAST_EDEN.step(.016);off=LAST_EDEN.snapshot.player.run===false;}return off;}));await page.keyboard.up('KeyA');
 for(let hero=0;hero<4;hero++){
  await page.evaluate(h=>{LAST_EDEN.start(0,h);LAST_EDEN.test.move(89,LAST_EDEN.snapshot.band.mid);},hero);await page.keyboard.down('Shift');await page.keyboard.down('ArrowRight');
  await page.evaluate(()=>{LAST_EDEN.step(.016);LAST_EDEN.controls.attack();LAST_EDEN.render();});
  check(`Hero ${hero+1}: run attack uses the dash state and correct ground/air motion`,await page.evaluate(h=>{const p=LAST_EDEN.snapshot.player;return p.pose==='dash'&&(h===1?p.z===0:p.z>0);},hero));
  await page.locator('.game-shell').screenshot({path:`tests/results/dash-${hero}.png`});await page.keyboard.up('Shift');await page.keyboard.up('ArrowRight');
 }
 // D9 (HEROES §1, §12; PLAN §7 G3d): with a gun in hand, run + attack is the dash, not a shot.
 for(let hero=0;hero<4;hero++){
  await page.evaluate(h=>{LAST_EDEN.start(0,h);LAST_EDEN.test.move(89,LAST_EDEN.snapshot.band.mid);LAST_EDEN.test.equip('gun');},hero);await page.keyboard.down('Shift');await page.keyboard.down('ArrowRight');
  await page.evaluate(()=>{LAST_EDEN.step(.016);LAST_EDEN.controls.attack();LAST_EDEN.render();});
  check(`Hero ${hero+1}: armed run + attack is the dash and fires no round`,await page.evaluate(()=>{const p=LAST_EDEN.snapshot.player;return p.pose==='dash'&&p.attackKind==='dash'&&p.weapon==='gun'&&p.ammo===6&&!LAST_EDEN.snapshot.bullets.some(b=>b.friendly);}));
  await page.keyboard.up('Shift');await page.keyboard.up('ArrowRight');
 }
 check('No browser exceptions during armed and movement checks',errors.length===0);
 fs.writeFileSync('tests/results/armed-report.json',JSON.stringify({passed:checks.length,checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,errors},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
