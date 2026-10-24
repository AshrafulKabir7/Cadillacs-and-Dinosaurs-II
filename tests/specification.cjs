const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const BASE=require('./lib/arcade.cjs').BASE;   // the game page, play.html on GAME_URL (index.html is the home page)

fs.mkdirSync('tests/results',{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;let n=764;Math.random=()=>{n=(n*1664525+1013904223)>>>0;return n/4294967296;};});
 await page.goto(BASE);await page.waitForFunction(()=>SEQUEL_RENDER.ready,null,{polling:100});await page.click('#sound');await page.click('#newgame');
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
  // Arcade px (ARCHITECTURE §7): M is the middle of the feet band.
  const M=()=>g.snapshot.band.mid;
  const dummy=(x=296,y=M(),type='brute')=>{const e=g.test.spawnEnemy(x,y,type);e.hp=e.maxhp=10000;e.state='recover';e.timer=999;return e;};
  for(const tier of ['easy','normal','hard']){
   g.start(0,0,tier);const r=COMBAT_CONFIG.difficulty[tier],base=g.test.spawnEnemy(444,M(),'brute');
   // ENEMIES §8 (PLAN §7 G4): a brute is HAMMER T. at the chapter's arcade level (LV 9: 98 HP), times the tier's enemyHealth
   test(`${tier}: actual hero/enemy health uses the selected tier`,g.snapshot.player.maxhp===120*r.playerHealth&&Math.abs(base.maxhp-g.test.kindHp('brute','A')*r.enemyHealth)<.001&&g.test.kindHp('brute','A')===98);
   g.test.move(74,M());g.test.drop('rod',74,M());g.controls.pickup();ticks(20);test(`${tier}: melee pickups use configured durability`,g.snapshot.player.ammo===Math.round(8*r.meleeDurability));
   g.start(0,0,tier);g.test.move(74,M());g.test.drop('m16',74,M());g.controls.pickup();ticks(20);test(`${tier}: normal firearm ammo caps stay intact`,g.snapshot.player.ammo===60);
   g.start(0,0,tier);const d=dummy(444,M(),'raptor');d.hp=d.maxhp*.4;d.state='walk';d.timer=20;g.step(1/60);
   test(`${tier}: dinosaur rage follows the tier`,tier==='hard'?d.rageWarning>0&&!d.moving:!d.rageWarning);
   if(tier==='hard'){const startX=d.x;ticks(20);test('Rage telegraphs before the dinosaur moves',d.x===startX);ticks(30);test('The warned dinosaur becomes active after its warning',d.rage>0&&d.rageWarning===0&&d.x<startX);}
   g.start(0,0,tier);const e=dummy();e.state='recover';e.timer=1;ticks(12);test(`${tier}: recovery timers use configuration`,Math.abs(e.timer-(1-.2/r.recovery))<.0001);
   g.start(0,0,tier);const boss=g.test.spawnEnemy(444,M(),'warden',true);boss.state='recover';boss.timer=2;ticks(12);test(`${tier}: boss tempo uses configuration`,Math.abs(boss.timer-(2-.2*r.bossTempo))<.0001);
  }
  g.start(0,0,'story');test('Legacy Story saves map to Easy',g.snapshot.difficulty==='easy');g.start(0,0,'arcade');test('Legacy Arcade saves map to Arcade Mania',g.snapshot.difficulty==='hard');
  // Queue a real encounter behind five stationary opponents; killing one admits exactly one arrival.
  g.start(0,0,'easy');g.test.skipTo(0);const x=g.snapshot.player.x;for(let i=0;i<5;i++)dummy(x+74+i*26,M());g.step(1/60);
  const waiting=g.snapshot.enemies.filter(e=>e.waiting).length;
  test('Easy crowd cap queues excess reinforcements off screen',waiting>0&&g.snapshot.enemies.filter(e=>!e.waiting&&!e.dead&&!e.dying).length===5);
  g.test.damageEnemy(0,99999);ticks(1);test('A defeated enemy releases one queued reinforcement',g.snapshot.enemies.filter(e=>e.waiting).length===waiting-1);
  g.start(0,0,'hard');g.test.move(133,M());dummy(152);const flanker=dummy(178);flanker.state='walk';flanker.timer=5;const fx=flanker.x;ticks(1);test('Mania enemies plan a route behind an occupied target',!!flanker.flankRoute);ticks(45);test('A flanker crosses behind the player instead of queuing in front',flanker.x<133&&flanker.x<fx);
  // Original sampled firearm frames and all six guns, mirrored in both directions.
  for(let hero=0;hero<4;hero++)for(const dir of [-1,1])for(const type of ['gun','shotgun','uzi','m16','bazooka']){
   g.start(0,hero,'normal');g.test.move(126,M());key(dir<0?'KeyA':'KeyD',true);ticks(1);key(dir<0?'KeyA':'KeyD',false);g.test.move(126,M());g.test.equip(type);
   const before=g.snapshot.player.x,profile=Object.values(COMBAT_CONFIG.weapons).find(w=>w.types.includes(type));g.controls.attack();g.render();let s=g.snapshot;
   // Every gun fires from the ROM muzzle: the weapon's hold origin on the shot frame plus the spawn offset (HEROES §7.3).
   // The gun is always held (no frame has a drawn-in gun since G3a), so only the held branch remains. gunSocket is in
   // game units already (gunMount applies CFG.sockets.scale), so the muzzle is not scaled again here.
   const shot=s.bullets[0],expected=s.gunSocket.held?s.player.x+dir*s.gunSocket.muzzle:NaN;
   test(`Hero ${hero} ${type} facing ${dir}: muzzle, projectile and recoil align`,Math.abs(s.player.x-(before-dir*profile.recoilPixels))<.001&&Math.abs(shot.x-expected)<.001&&Math.sign(shot.vx)===dir&&shot.z===s.gunSocket.y&&s.player.pose==='fire');
   test(`Hero ${hero} ${type} facing ${dir}: shell behavior matches weapon`,s.particles.filter(p=>p.kind==='shell').length===(profile.shells?1:0));
  }
  g.start(0);g.test.move(74,M());dummy(155);g.test.equip('m16');g.controls.attack();ticks(8);test('Automatic bullet impacts emit red directional blood',g.snapshot.particles.some(p=>p.kind==='blood'&&p.vx>0&&COMBAT_CONFIG.fx.blood.colors.includes(p.color)));
  // Blows land on their ROM frames (PLAN §7 G3c): the stab on its ev1 frame (after 5 f), the punch on p1's active frame
  // (after 1 f), so the cut is read after the stab and the punch's spark is looked for over the 9 ticks (its .13 s life
  // ends before tick 9 now that the blow lands at once).
  g.start(0);g.test.move(74,M());dummy(111);g.test.equip('knife');g.controls.attack();ticks(12);test('A close knife cut emits blood',g.snapshot.particles.some(p=>p.kind==='blood'));
  g.start(0);g.test.move(74,M());dummy(111);g.controls.attack();let punchSpark=false;for(let i=0;i<9;i++){g.step(1/60);if(g.snapshot.effects.includes('spark'))punchSpark=true;}test('A bare-handed punch uses impact sparks',punchSpark&&!g.snapshot.particles.some(p=>p.kind==='blood'));
  // ENEMIES §8 (PLAN §7 G4): the 'truck' dummy is gone from the regulars; a round into a crate (machinery, sequel.cjs L27) sparks.
  g.start(0);{const o=g.snapshot.objects[0];g.test.move(o.x-90,o.y);g.test.equip('gun');g.controls.attack();ticks(16);const c=g.snapshot.objects.find(b=>b.x===o.x&&b.y===o.y);test('Bullets hitting machinery (a crate) make sparks rather than blood',!!c&&c.hp<o.hp&&!g.snapshot.particles.some(p=>p.kind==='blood'));}
  // Chapter 2's boss keeps the kind id 'truck' (HAULMASTER KRAG -> IRONCLUB since the boss rebuild): rounds hitting
  // Ironclub's armour plates (phase 2) spark, never bleed.
  g.start(0);{g.test.move(74,M());const m=g.test.spawnEnemy(170,M(),'truck',true);m.phase=2;m.state='recover';m.timer=999;m.inv=0;g.test.equip('gun');g.controls.attack();ticks(20);test('Rounds hitting Ironclub (truck, phase 2) spark on his armour plates rather than bleed',m.hp<m.maxhp&&!g.snapshot.particles.some(p=>p.kind==='blood'));}
  g.start(0);g.test.move(74,M());dummy(152);g.test.equip('bazooka');g.controls.attack();ticks(16);test('A rocket impact creates fire, smoke and fragments',g.snapshot.effects.includes('explosion')&&g.snapshot.particles.some(p=>p.kind==='smoke')&&g.snapshot.particles.some(p=>p.kind==='debris'));ticks(150);test('Transient explosion particles expire',!g.snapshot.particles.some(p=>['smoke','debris'].includes(p.kind)));
  g.start(0);g.test.move(g.snapshot.view.x+18,M());g.test.equip('bazooka');g.controls.attack();test('Recoil cannot leave the playable left boundary',g.snapshot.player.x>=g.snapshot.view.x+16);
  return out;
 });checks.push(...rows);
 // Stage pages (ARCHITECTURE §7 L54, PLAN §7 G2): every page STAGE_DATA names, in all six chapters, decodes at its declared
 // size. The chapters load one after another because at most two stay decoded (ARCHITECTURE §5.5): a load of all six at
 // once would release the first four before they could be measured. Floor 72 pages (was 120): since the 2026-10-22 one-place
 // recipes every area has one far-layer span instead of one per section, so the six chapters ship 84 pages.
 check('Every stage page of the six chapters decodes at its declared size',await page.evaluate(async()=>{const bad=[];let n=0;for(let i=0;i<6;i++){await SEQUEL_RENDER.loadChapter(i);for(const p of STAGE_RENDER.pages(i)){n++;if(!p.loaded||(p.layer==='anim'?!(p.nw>0&&p.nh>0):p.nw!==p.w||p.nh!==p.h))bad.push(i+':'+p.src+' '+p.nw+'x'+p.nh+' vs '+p.w+'x'+p.h);}}if(bad.length)console.error('stage pages: '+bad.slice(0,5).join('; '));return n>=72&&bad.length===0;}));
 check('No browser exceptions',errors.length===0);
 fs.writeFileSync('tests/results/specification-report.json',JSON.stringify({passed:checks.filter(c=>c.passed).length,checks,errors},null,2));await browser.close();
 for(const c of checks)if(!c.passed)console.error('FAIL '+c.name);assert.ok(checks.every(c=>c.passed));console.log(JSON.stringify({passed:checks.length,errors}));
})().catch(e=>{console.error(e);process.exit(1);});
