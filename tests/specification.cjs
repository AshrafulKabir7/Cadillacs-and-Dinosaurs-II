const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const BASE=process.env.GAME_URL||'http://127.0.0.1:8766';
fs.mkdirSync('tests/results',{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;let n=764;Math.random=()=>{n=(n*1664525+1013904223)>>>0;return n/4294967296;};});
 await page.goto(BASE);await page.waitForFunction(()=>SEQUEL_RENDER.ready);await page.click('#sound');await page.click('#newgame');
 const checks=[];const check=(name,ok)=>checks.push({name,passed:!!ok});
 check('Portraits use the original Jack, Hannah, Mustapha, Mess order',await page.locator('[data-hero]').evaluateAll(bs=>bs.map(b=>b.dataset.hero).join()==='1,2,0,3'));
 check('All three difficulty choices are selectable',await page.locator('[data-mode]').count()===3);
 for(const hero of ['jack','hannah','mustapha','mess'])check(`Original ${hero} selection art loads`,await page.evaluate(id=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(i.width===384&&i.height===224);i.onerror=()=>resolve(false);i.src=ARCADE_SELECTION[id];}),hero));
 await page.click('[data-hero="1"]');await page.keyboard.press('ArrowRight');check('Selection arrows follow portrait order',await page.locator('[data-hero="2"]').getAttribute('aria-pressed')==='true');
 await page.click('#arcade-mode');await page.click('#begin');await page.click('#enter-stage');check('Selected difficulty reaches gameplay and its checkpoint',await page.evaluate(()=>LAST_EDEN.snapshot.difficulty==='hard'&&LAST_EDEN.snapshot.checkpoint.difficulty==='hard'));
 await page.reload();await page.click('#continue');await page.click('#enter-stage');check('Continue restores the saved difficulty',await page.evaluate(()=>LAST_EDEN.snapshot.difficulty==='hard'));
 const actual=await page.evaluate(()=>COMBAT_CONFIG);check('Embedded offline configuration matches the JSON source',JSON.stringify(actual)===JSON.stringify(JSON.parse(fs.readFileSync('combat-config.json','utf8'))));
 const rows=await page.evaluate(()=>{
  const g=LAST_EDEN,out=[],key=(code,on)=>window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true})),ticks=n=>{for(let i=0;i<n;i++)g.step(1/60);},test=(name,ok)=>out.push({name,passed:!!ok});
  const dummy=(x=400,y=345,type='brute')=>{const e=g.test.spawnEnemy(x,y,type);e.hp=e.maxhp=10000;e.state='recover';e.timer=999;return e;};
  for(const tier of ['easy','normal','hard']){
   g.start(0,0,tier);const r=COMBAT_CONFIG.difficulty[tier],base=g.test.spawnEnemy(600,350,'brute');
   test(`${tier}: actual hero/enemy health uses the selected tier`,g.snapshot.player.maxhp===120*r.playerHealth&&Math.abs(base.maxhp-125*r.enemyHealth)<.001);
   g.test.move(100,345);g.test.drop('rod',100,345);g.controls.pickup();ticks(20);test(`${tier}: melee pickups use configured durability`,g.snapshot.player.ammo===Math.round(8*r.meleeDurability));
   g.start(0,0,tier);g.test.move(100,345);g.test.drop('m16',100,345);g.controls.pickup();ticks(20);test(`${tier}: normal firearm ammo caps stay intact`,g.snapshot.player.ammo===60);
   g.start(0,0,tier);const d=dummy(600,345,'raptor');d.hp=d.maxhp*.4;d.state='walk';d.timer=20;g.step(1/60);
   test(`${tier}: dinosaur rage follows the tier`,tier==='hard'?d.rageWarning>0&&!d.moving:!d.rageWarning);
   if(tier==='hard'){const startX=d.x;ticks(20);test('Rage telegraphs before the dinosaur moves',d.x===startX);ticks(30);test('The warned dinosaur becomes active after its warning',d.rage>0&&d.rageWarning===0&&d.x<startX);}
   g.start(0,0,tier);const e=dummy();e.state='recover';e.timer=1;ticks(12);test(`${tier}: recovery timers use configuration`,Math.abs(e.timer-(1-.2/r.recovery))<.0001);
   g.start(0,0,tier);const boss=g.test.spawnEnemy(600,350,'warden',true);boss.state='recover';boss.timer=2;ticks(12);test(`${tier}: boss tempo uses configuration`,Math.abs(boss.timer-(2-.2*r.bossTempo))<.0001);
  }
  g.start(0,0,'story');test('Legacy Story saves map to Easy',g.snapshot.difficulty==='easy');g.start(0,0,'arcade');test('Legacy Arcade saves map to Arcade Mania',g.snapshot.difficulty==='hard');
  // Queue a real encounter behind five stationary opponents; killing one admits exactly one arrival.
  g.start(0,0,'easy');g.test.skipTo(0);const x=g.snapshot.player.x;for(let i=0;i<5;i++)dummy(x+100+i*35,345);g.step(1/60);
  const waiting=g.snapshot.enemies.filter(e=>e.waiting).length;
  test('Easy crowd cap queues excess reinforcements off screen',waiting>0&&g.snapshot.enemies.filter(e=>!e.waiting&&!e.dead&&!e.dying).length===5);
  g.test.damageEnemy(0,99999);ticks(1);test('A defeated enemy releases one queued reinforcement',g.snapshot.enemies.filter(e=>e.waiting).length===waiting-1);
  g.start(0,0,'hard');g.test.move(180,345);dummy(205);const flanker=dummy(240);flanker.state='walk';flanker.timer=5;const fx=flanker.x;ticks(1);test('Mania enemies plan a route behind an occupied target',!!flanker.flankRoute);ticks(45);test('A flanker crosses behind the player instead of queuing in front',flanker.x<180&&flanker.x<fx);
  // Original sampled firearm frames and all six guns, mirrored in both directions.
  for(let hero=0;hero<4;hero++)for(const dir of [-1,1])for(const type of ['gun','shotgun','uzi','m16','bazooka']){
   g.start(0,hero,'normal');g.test.move(170,345);key(dir<0?'KeyA':'KeyD',true);ticks(1);key(dir<0?'KeyA':'KeyD',false);g.test.move(170,345);g.test.equip(type);
   const before=g.snapshot.player.x,profile=Object.values(COMBAT_CONFIG.weapons).find(w=>w.types.includes(type));g.controls.attack();g.render();let s=g.snapshot;
   const shot=s.bullets[0],expected=s.player.x+dir*(s.gunSocket.x+({gun:34,shotgun:60,uzi:45,m16:81,bazooka:81}[type])*(1-profile.grip)*1.35);
   test(`Hero ${hero} ${type} facing ${dir}: muzzle, projectile and recoil align`,Math.abs(s.player.x-(before-dir*profile.recoilPixels))<.001&&Math.abs(shot.x-expected)<.001&&Math.sign(shot.vx)===dir&&shot.z===s.gunSocket.y&&s.player.pose==='fire');
   test(`Hero ${hero} ${type} facing ${dir}: shell behavior matches weapon`,s.particles.filter(p=>p.kind==='shell').length===(profile.shells?1:0));
  }
  g.start(0);g.test.move(100,345);dummy(210);g.test.equip('m16');g.controls.attack();ticks(8);test('Automatic bullet impacts emit red directional blood',g.snapshot.particles.some(p=>p.kind==='blood'&&p.vx>0&&COMBAT_CONFIG.fx.blood.colors.includes(p.color)));
  g.start(0);g.test.move(100,345);dummy(150);g.test.equip('knife');g.controls.attack();test('A close knife cut emits blood',g.snapshot.particles.some(p=>p.kind==='blood'));
  g.start(0);g.test.move(100,345);dummy(150);g.controls.attack();ticks(9);test('A bare-handed punch uses impact sparks',g.snapshot.effects.includes('spark')&&!g.snapshot.particles.some(p=>p.kind==='blood'));
  g.start(0);g.test.move(100,345);dummy(205,345,'truck');g.test.equip('gun');g.controls.attack();ticks(8);test('Bullets hitting machinery make sparks rather than blood',!g.snapshot.particles.some(p=>p.kind==='blood'));
  g.start(0);g.test.move(100,345);dummy(205);g.test.equip('bazooka');g.controls.attack();ticks(16);test('A rocket impact creates fire, smoke and fragments',g.snapshot.effects.includes('explosion')&&g.snapshot.particles.some(p=>p.kind==='smoke')&&g.snapshot.particles.some(p=>p.kind==='debris'));ticks(150);test('Transient explosion particles expire',!g.snapshot.particles.some(p=>['smoke','debris'].includes(p.kind)));
  g.start(0);g.test.move(25,345);g.test.equip('bazooka');g.controls.attack();test('Recoil cannot leave the playable left boundary',g.snapshot.player.x>=24);
  return out;
 });checks.push(...rows);
 check('Five new local environments all decode',await page.evaluate(()=>Promise.all(EDEN_ENVIRONMENTS.slice(1).map(src=>new Promise(resolve=>{const im=new Image();im.onload=()=>resolve(im.width>=768&&im.height>=432);im.onerror=()=>resolve(false);im.src=src;}))).then(a=>a.length===5&&a.every(Boolean))));
 check('No browser exceptions',errors.length===0);
 fs.writeFileSync('tests/results/specification-report.json',JSON.stringify({passed:checks.filter(c=>c.passed).length,checks,errors},null,2));await browser.close();
 for(const c of checks)if(!c.passed)console.error('FAIL '+c.name);assert.ok(checks.every(c=>c.passed));console.log(JSON.stringify({passed:checks.length,errors}));
})().catch(e=>{console.error(e);process.exit(1);});
