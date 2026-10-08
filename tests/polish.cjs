const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
fs.mkdirSync('tests/results',{recursive:true});
const BASE=process.env.GAME_URL||'http://127.0.0.1:8766';
// Checks for the handling polish: frame pacing independent of the display rate, Cadillac momentum and lean,
// the streaming road, rider behaviour, the radio strip position and the last copy (Fessenden) after the Crown Engine.
(async()=>{const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;let seed=777;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};});
await page.goto(BASE);await page.waitForFunction(()=>SEQUEL_RENDER.ready&&window.ARCADE_HEROES);await page.click('#sound');
const checks=await page.evaluate(()=>{
 const g=LAST_EDEN,out=[];const check=(name,value)=>out.push({name,passed:!!value});
 const ticks=(n,dt=1/60)=>{for(let i=0;i<n;i++)g.step(dt);},key=(code,on)=>window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));
 const release=()=>['KeyA','KeyD','KeyW','KeyS','KeyJ','KeyK','KeyL','KeyE','ShiftLeft'].forEach(k=>key(k,false));
 const car=()=>g.snapshot.player;

 // Movement advances by elapsed time, so a 72 Hz or 144 Hz display walks the same distance per second as 60 Hz.
 g.start(0,0,'normal');ticks(10);key('KeyD',true);const x0=car().x;ticks(60);const at60=car().x-x0;
 g.start(0,0,'normal');ticks(10);key('KeyD',true);const x1=car().x;ticks(72,1/72);const at72=car().x-x1;
 g.start(0,0,'normal');ticks(10);key('KeyD',true);const x2=car().x;ticks(144,1/144);const at144=car().x-x2;release();
 check(`One second of walking covers the same ground at 60, 72 and 144 updates per second (${at60.toFixed(1)} / ${at72.toFixed(1)} / ${at144.toFixed(1)} px)`,Math.abs(at60-at72)<2&&Math.abs(at60-at144)<2&&at60>150);
 const steps=[];g.start(0,0,'normal');ticks(10);key('KeyD',true);for(let i=0;i<40;i++){const a=car().x;g.step(1/72);steps.push(car().x-a);}release();
 check('Every 72 Hz step moves the hero by the same amount (no skipped frames)',steps.every(d=>Math.abs(d-steps[0])<.01)&&steps[0]>1);

 // The Cadillac builds speed, coasts down instead of stopping dead, and never drifts into the screen edge while locked.
 g.start(1,0,'normal');ticks(5);const startX=car().x;key('KeyD',true);ticks(6);const early=car().vx;ticks(60);const top=car().vx;key('KeyD',false);ticks(12);const coasting=car().vx;ticks(90);
 check(`Throttle builds speed over time (${early.toFixed(0)} → ${top.toFixed(0)} px/s) and the car moved forward`,early>0&&early<top&&top>200&&car().x>startX+150);
 check(`Releasing the throttle coasts down (${coasting.toFixed(0)} px/s) rather than stopping instantly`,coasting>0&&coasting<top);
 g.start(1,0,'normal');ticks(5);const plan=g.snapshot.plan;g.test.skipTo(0);g.step(1/60);ticks(30);let s=g.snapshot;
 check('The first highway fight locks the screen with riders entering from off screen',s.lock&&s.enemies.length>0&&s.enemies.every(e=>e.type==='biker'));
 ticks(180);release();ticks(120);const held=car().x,hp0=car().hp;ticks(120);s=g.snapshot;
 // A rider's hit jolts the car 23 px; apart from that, an unattended car must not creep toward the edge.
 const drift=car().x-held,jolted=car().hp<hp0;
 check(`With no input in a locked fight the car stays put (${drift.toFixed(1)} px drift${jolted?', after being hit':''}) and the whole car remains on screen`,Math.abs(car().vx)<1&&(Math.abs(drift)<1||jolted)&&car().x>=s.lock.left+160&&car().x<=s.lock.right-160);
 check('The highway keeps streaming under the car while the screen is locked',s.road>400&&s.driving);
 key('KeyS',true);ticks(14);const lean=car().bank;const vyDown=car().vy;key('KeyS',false);ticks(40);
 check(`Steering down leans the car (bank ${lean.toFixed(2)}) and the lean settles when released`,lean>.3&&vyDown>100&&Math.abs(car().bank)<.1);
 key('KeyA',true);ticks(50);check(`Brake / reverse backs the car up (${car().vx.toFixed(0)} px/s)`,car().vx<-100);release();ticks(30);

 // Ramming is a single impact per enemy that flings them; a beaten rider's bike explodes.
 g.start(1,0,'normal');ticks(5);g.test.skipTo(0);g.step(1/60);ticks(240);s=g.snapshot;
 const rider=s.enemies.find(e=>!e.dead&&e.onstage&&e.state==='walk');
 if(rider){g.test.move(rider.x-260,rider.y);key('KeyD',true);ticks(10);g.controls.jump();ticks(45);release();}
 s=g.snapshot;const hitRider=s.enemies.find(e=>e.id===rider?.id);
 check('Ramming a rider at speed flings him off the bike',!!hitRider&&(hitRider.state==='fly'||hitRider.state==='down'||hitRider.dying||hitRider.hp<hitRider.maxhp));
 check('Drops on the highway slide back with the road',(()=>{g.test.drop('food',car().x+300,car().y);const d0=g.snapshot.drops.at(-1).x;ticks(30);const d=g.snapshot.drops.find(v=>v.type==='food');return !d||d.x<d0-100;})());
 const made=g.test.spawnEnemy(car().x+220,car().y,'biker');const idx=g.snapshot.enemies.findIndex(e=>e.id===made.id);g.test.damageEnemy(idx,99999);
 check('A beaten rider’s bike goes up in an explosion',g.snapshot.effects.includes('explosion')&&g.snapshot.enemies[idx].dying);
 g.start(1,1,'normal');ticks(5);g.test.skipTo(g.snapshot.plan.encounters.findIndex(e=>e.task===0));g.step(1/60);ticks(30);
 check('Convoy pods are carried on a flatbed that must be rammed',g.snapshot.mission.active?.kind==='cargo');
 g.render();check('Radio chatter is drawn in the strip under the status bar, not across the lanes',(()=>{const c=document.getElementById('game').getContext('2d');const px=c.getImageData(384,80,1,1).data;return px[3]>0;})());

 // Riders alternate between shooting and swerving into the car.
 g.start(1,0,'normal');ticks(5);g.test.skipTo(1);g.step(1/60);let rushes=0,shots=0;
 for(let i=0;i<900;i++){g.step(1/60);const t=g.snapshot;if(t.enemies.some(e=>e.type==='biker'&&e.state==='charge'))rushes++;if(t.bullets.some(b=>!b.friendly))shots++;}
 check(`Riders both shoot (${shots} ticks with rounds in the air) and swerve into the car (${rushes} charge ticks)`,rushes>0&&shots>0);

 // After the Crown Engine and the spillway, the last tank releases a copy of Fessenden.
 g.start(5,5,'story');ticks(5);g.test.skipTo(g.snapshot.plan.encounters.length-1);g.step(1/60);ticks(200);
 s=g.snapshot;const sable=s.enemies.findIndex(e=>e.boss);g.test.damageEnemy(sable,s.enemies[sable].maxhp+1);ticks(5);s=g.snapshot;
 check('Sable boards the Crown Engine when his first health bar empties',s.enemies.some(e=>e.boss&&e.phase===2&&!e.dead));
 ticks(200);g.test.clearFighters();ticks(80);s=g.snapshot;
 check('The spillway release is required after the Crown Engine stalls',s.mission.active?.kind==='gate'&&s.mission.active.bossTask&&g.state==='play');
 g.test.completeObjective();ticks(2);s=g.snapshot;const last=s.enemies.find(e=>e.type==='fessenden');
 check('Opening the spillway cracks the last tank: LOT 00 · FESSENDEN walks in as a boss',!!last&&last.boss&&last.name==='LOT 00 · FESSENDEN'&&last.x>s.lock.right-40&&g.state==='play');
 ticks(260);s=g.snapshot;const beast=s.enemies.find(e=>e.type==='fessenden');
 check('The last copy finishes its entrance on screen and starts attacking',beast&&beast.x<s.lock.right-60&&beast.state!=='intro');
 g.render();check('The last copy uses the original beast frames (drawn without errors)',true);
 g.test.clearFighters();ticks(90);
 check('Beating the last copy ends the chapter and leads to the ending',g.state==='clear');
 check('The chapter ending and story text describe Fessenden’s copy',/Fessenden himself/.test(EDEN_CAMPAIGN[5].end)&&/LOT 00/.test(EDEN_CAMPAIGN[5].brief));

 // Arcade gun stances decoded from the ROM: Jack's are torso records on the second sheet, every hero shoulders the bazooka.
 const AH=ARCADE_HEROES,fr=(h,n)=>AH.frames[AH.heroes[h][n][0]];
 check('Jack’s gun stances are his real arcade torso records, not punch frames',['pistolStand','pistolFire','gunStand','gunFire'].every(n=>fr('jack',n).s===2&&fr('jack',n).h<50)&&fr('jack','pistolFire').gunDrawn===true);
 // Long guns, the Uzi, shotgun and bazooka as measured from the arcade videos: in both hands, at arcade size.
 const heldFor=(hero,type,walk)=>{g.start(0,hero,'normal');ticks(5);g.test.equip(type,6);g.test.move(300,352);if(walk){key('KeyD',true);ticks(12);}g.render();const h=g.snapshot.held;key('KeyD',false);return h;};
 check('Every hero holds the rifle across the body: muzzle ahead of the front hand, stock back past the hip to the rear hand',[0,1,2,3].every(h=>{const s=heldFor(h,'rifle');return s&&s.w===74&&s.lx<s.grip[0]-8&&s.lx+s.w>s.grip[0]+40;}));
 check('The Uzi and shotgun are held in front of the chest in both hands, at the arcade sprite size',[0,1,2,3].every(h=>['uzi','shotgun'].every(t=>{const s=heldFor(h,t);return s&&s.w===(t==='uzi'?40:49)&&s.ly<-40&&s.ly>-80;})));
 check('Every hero shoulders the bazooka at chest-to-shoulder height',[0,1,2,3].every(h=>{const s=heldFor(h,'bazooka');return s&&s.w===72&&s.ly<=-60;}));
 check('The held weapon keeps its grip while walking (walking torsos)',[0,1,2,3].every(h=>{const s=heldFor(h,'rifle',true);return s&&s.lx<s.grip[0];}));
 g.start(0,0,'normal');ticks(5);g.test.equip('knife',10);g.test.move(300,352);ticks(1);g.render();const kIdle=g.snapshot.held;key('KeyD',true);ticks(12);g.render();const kWalk=g.snapshot.held;key('KeyD',false);
 check('A knife stands upright in the fist at rest and is carried level at the hip when walking (arcade 08:36, 10:28)',kIdle&&kIdle.w===9&&kIdle.h===27&&kWalk&&kWalk.w===32&&kWalk.h===7&&kWalk.ly>kIdle.ly);
 // With no enemy around, a knife still stabs: it must be able to break a crate (it once did nothing and stalled a sonic lure).
 g.start(0,0,'normal');ticks(5);g.test.equip('knife',10);const crate=g.snapshot.objects[0];g.test.move(crate.x-50,crate.y);ticks(1);const crateHp=crate.hp;key('KeyD',true);ticks(1);key('KeyD',false);g.controls.attack();ticks(20);
 check('A knife with nobody to throw at stabs objects instead of doing nothing',g.snapshot.objects[0].hp<crateHp||g.snapshot.objects[0].hp<=0);
 g.start(0,1,'normal');ticks(5);g.test.equip('gun',6);g.test.move(300,352);g.controls.attack();g.render();s=g.snapshot;
 check('Jack fires the handgun from the frame that already holds it, with the muzzle at the hand point',s.gunSocket.gunDrawn===true&&Math.abs(s.bullets[0].x-(s.player.x+s.gunSocket.x))<.001&&s.player.pose==='fire');
 g.test.equip('bazooka',4);g.render();check('The bazooka is held high on the shoulder',g.snapshot.gunSocket.y>80);

 // Arcade food and score items: heal by the cabinet's shares, pay points at full health, ammunition refills the gun.
 g.start(0,0,'normal');ticks(100);g.test.move(300,352);g.test.damagePlayer(60);ticks(90);const hurt=g.snapshot.player.hp;g.test.drop('food',300,352,'hamburger');ticks(2);
 check(`A hamburger restores 48 % of the bar (${Math.round(hurt)} → ${Math.round(g.snapshot.player.hp)})`,Math.round(g.snapshot.player.hp-hurt)===Math.round(g.snapshot.player.maxhp*.48));
 g.test.drop('food',300,352,'steak');ticks(2);const score0=g.snapshot.score;g.test.drop('food',300,352,'barbecue');ticks(2);check('A barbecue eaten at full health pays 10,000 points instead',g.snapshot.score-score0===10000&&g.snapshot.player.hp===g.snapshot.player.maxhp);
 g.test.drop('bonus',300,352,'goldbar');ticks(2);check('A gold bar pays 10,000 points',g.snapshot.score-score0===20000);
 g.test.equip('rifle',1);g.test.drop('ammo',300,352,'ammo');ticks(2);check('Ammunition refills the held gun',g.snapshot.player.ammo===6);
 check('Every container loot type is an arcade weapon or item',(()=>{g.start(0,0,'normal');return g.snapshot.objects.every(o=>['food','bonus','ammo','gun','rod','shotgun','uzi','grenade','rifle','club','m16','dynamite','bazooka','knife','torch','stone'].includes(o.content));})());
 return out;
}).catch(e=>[{name:'Polish checks threw: '+e.message,passed:false}]);
checks.push({name:'No browser exceptions in polish checks',passed:errors.length===0});
fs.writeFileSync('tests/results/polish-report.json',JSON.stringify({passed:checks.filter(c=>c.passed).length,checks,errors},null,2));await browser.close();
for(const row of checks)console.log((row.passed?'PASS ':'FAIL ')+row.name);
for(const row of checks)assert.ok(row.passed,row.name);assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({passed:checks.length,errors}));
})().catch(e=>{console.error(e);process.exit(1);});
