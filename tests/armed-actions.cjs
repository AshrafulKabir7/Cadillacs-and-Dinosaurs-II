const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
fs.mkdirSync('tests/results',{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),checks=[],errors=[];
 const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
 page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8766');await page.click('#sound');
 const rows=await page.evaluate(()=>{
  const g=LAST_EDEN,results=[],guns={gun:[6,32,1],uzi:[48,15,3],shotgun:[6,56,1],rifle:[6,70,1],m16:[60,21,3],bazooka:[4,108,1]};
  function ticks(n){for(let i=0;i<n;i++)g.step(.016);}
  function target(x){const e=g.test.spawnEnemy(x,346,'brute');e.hp=e.maxhp=10000;e.state='recover';e.timer=1000;return e;}
  for(let hero=0;hero<4;hero++){
   for(const [weapon,[ammo,damage,shots]] of Object.entries(guns)){
    g.start(0,hero);g.test.move(100,346);const e=target(135);g.test.equip(weapon);g.controls.attack();g.render();
    const armedPose=g.snapshot.player.pose==='fire';ticks(50);
    const expected=damage*shots*(hero===2?1.25:1);
    results.push([`Hero ${hero+1}: ${weapon} hits at point-blank range without extra melee damage`,armedPose&&g.snapshot.player.ammo===ammo-shots&&Math.abs(e.maxhp-e.hp-expected)<.01&&g.snapshot.player.pendingStrike===null]);
    e.state='recover';e.timer=1000;ticks(90);g.test.equip(weapon,0);const hp=e.hp;for(let i=0;i<4;i++){g.controls.attack();ticks(25);}
    results.push([`Hero ${hero+1}: empty ${weapon} never punches or auto-discards`,e.hp===hp&&g.snapshot.player.weapon===weapon&&g.snapshot.player.ammo===0]);
   }
   g.start(0,hero);g.test.move(100,346);const e=target(145);g.controls.attack();g.test.drop('gun',100,346);g.controls.pickup();g.controls.attack();ticks(25);
   results.push([`Hero ${hero+1}: picking up a gun cancels a pending punch`,Math.abs(e.maxhp-e.hp-32*(hero===2?1.25:1))<.01]);
  }
  g.start(0);g.test.move(100,346);const e=target(64);g.test.equip('gun');g.controls.attack();ticks(25);results.push(['Gunfire does not hit a close target behind the hero',e.hp===e.maxhp]);
  g.start(2);g.test.move(3980,350);g.test.spawnBoss();ticks(160);g.test.damageEnemy(0,9999);results.push(['Thornmaw retreats alive instead of dying',g.snapshot.enemies[0].state==='flee']);
  g.start(5);g.test.move(4300,350);g.test.spawnBoss();ticks(160);g.test.damageEnemy(0,9999);ticks(190);const b=g.snapshot.enemies.find(e=>e.boss);results.push(['Sable survives into the mechanical Crown Engine phase',b.type==='sable'&&b.phase===2&&b.hp>0]);
  for(let i=0;i<700&&!g.snapshot.zones.some(z=>z.style==='flood');i++)g.step(.016);
  results.push(['Crown Engine announces a spillway surge that requires changing lanes',g.snapshot.zones.some(z=>z.style==='flood'&&!z.air&&z.total===1.25)]);
  return results;
 });for(const [name,ok] of rows)check(name,ok);
 // Real input: running persists while its direction stays held, then ends on release.
 await page.evaluate(()=>LAST_EDEN.start(0));await page.keyboard.press('ArrowRight');await page.keyboard.down('ArrowRight');
 await page.evaluate(()=>{for(let i=0;i<125;i++)LAST_EDEN.step(.016);});check('Double-tap running does not expire after 1.6 seconds while held',await page.evaluate(()=>LAST_EDEN.snapshot.player.run));
 await page.keyboard.up('ArrowRight');await page.evaluate(()=>LAST_EDEN.step(.016));check('Releasing the direction ends double-tap running',await page.evaluate(()=>!LAST_EDEN.snapshot.player.run));
 for(let hero=0;hero<4;hero++){
  await page.evaluate(h=>{LAST_EDEN.start(0,h);LAST_EDEN.test.move(120,350);},hero);await page.keyboard.down('Shift');await page.keyboard.down('ArrowRight');
  await page.evaluate(()=>{LAST_EDEN.step(.016);LAST_EDEN.controls.attack();LAST_EDEN.render();});
  check(`Hero ${hero+1}: run attack uses the dash state and correct ground/air motion`,await page.evaluate(h=>{const p=LAST_EDEN.snapshot.player;return p.pose==='dash'&&(h===1?p.z===0:p.z>0);},hero));
  await page.locator('.game-shell').screenshot({path:`tests/results/dash-${hero}.png`});await page.keyboard.up('Shift');await page.keyboard.up('ArrowRight');
 }
 check('No browser exceptions during armed and movement checks',errors.length===0);
 fs.writeFileSync('tests/results/armed-report.json',JSON.stringify({passed:checks.length,checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,errors},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
