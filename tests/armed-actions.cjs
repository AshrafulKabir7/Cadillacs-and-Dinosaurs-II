const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
fs.mkdirSync('tests/results',{recursive:true});
const BASE=process.env.GAME_URL||'http://127.0.0.1:8766';
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
  // G5 (PLAN §7 5b, CAMPAIGN §7.4): Thorne / Glassback will not leave her nest (leashed to the nest driver beside it): she never goes more than BOSS_DEFS.raptor.tether
  // (260 px) from it, wherever the hero leads it (L554 reads the tether from BOSS_DEFS).
  {g.start(2,0,'story');g.test.spawnBoss();ticks(160);const s0=g.snapshot,dr=s0.mission.active,teth=BOSS_DEFS.raptor.tether;let far=0;
   for(const [dx,f] of [[18,.5],[18,.2],[200,.8],[18,.83]]){g.test.move(s0.lock.left+dx,g.test.lane(f));for(let i=0;i<150;i++){g.step(.016);const b=g.snapshot.enemies.find(e=>e.boss);if(b&&b.state!=='intro'&&b.state!=='flee')far=Math.max(far,Math.abs(b.x-dr.x));}}
   results.push([`Glassback never strays more than her ${teth}-px leash from the nest driver (max ${far.toFixed(1)} px)`,teth===260&&far>0&&far<=teth+.5]);}
  // CAMPAIGN §7.4: beyond her leash is a safe rest. A hero more than the tether from the driver (lock.left + 20) is never
  // reached by Glassback's blows, while one inside her reach is.
  {const hits=dx=>{g.start(2,0,'story');g.test.spawnBoss();ticks(160);const L=g.snapshot.lock,dr=g.snapshot.mission.active;let lost=0,last=g.snapshot.player.hp,lives=g.snapshot.lives;
    for(let i=0;i<600;i++){g.test.move(L.left+dx,g.snapshot.player.y);g.step(.016);const p=g.snapshot.player;if(p.hp<last)lost+=last-p.hp;last=p.hp;}return {lost:lost+(lives-g.snapshot.lives)*999,far:Math.abs(dr.x-(L.left+dx))};};
   const out=hits(20),inn=hits(150);
   results.push([`Beyond Glassback's leash is a safe rest (a hero ${out.far.toFixed(0)} px from the driver loses ${out.lost.toFixed(0)} HP; ${inn.far.toFixed(0)} px away, ${inn.lost.toFixed(0)} HP)`,out.far>BOSS_DEFS.raptor.tether&&out.lost===0&&inn.far<BOSS_DEFS.raptor.tether&&inn.lost>0]);}
  // The boss rebuild: chapter 3's boss is Headkeeper Thorne, who grafts herself into GLASSBACK at 0 HP (phase 2 on its own
  // body); the nest driver keeps Glassback standing (HP floor 1) and smashing it brings her down (arrested, not fled).
  g.start(2);g.test.spawnBoss();ticks(160);g.test.damageEnemy(0,9999);ticks(200);results.push(['Headkeeper Thorne grafts herself into Glassback at 0 HP',g.snapshot.enemies[0].phase===2&&g.snapshot.enemies[0].name==='GLASSBACK'&&g.snapshot.enemies[0].state!=='mutate']);
  g.test.damageEnemy(0,9999);results.push(['Glassback stays in the fight while the sonic driver is active',g.snapshot.enemies[0].hp===1&&g.snapshot.mission.active?.kind==='beacon']);g.test.damageObjective(9999);results.push(['Glassback falls (arrested, human again) when the sonic driver is destroyed',g.snapshot.enemies[0].defeat?.kind==='arrest']);
  g.start(5);g.test.spawnBoss();ticks(160);g.test.damageEnemy(0,9999);ticks(190);const b=g.snapshot.enemies.find(e=>e.boss);results.push(['Sable survives into the gate controls phase',b.type==='sable'&&b.phase===2&&b.hp>0]);
  for(let i=0;i<700&&!g.snapshot.zones.some(z=>z.style==='flood');i++)g.step(.016);
  results.push(['The gate controls announce a spillway surge that requires changing lanes',g.snapshot.zones.some(z=>z.style==='flood'&&!z.air&&z.total===1.25)]);
  return results;
 });for(const [name,ok] of rows)check(name,ok);
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
