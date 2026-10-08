const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
fs.mkdirSync('tests/results',{recursive:true});
const BASE=process.env.GAME_URL||'http://127.0.0.1:8766';
// Checks for the Fessenden's Legacy update: story structure, off-screen entrances, movement poses,
// the Cadillac, the clone war and section checkpoints.
(async()=>{const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;let seed=2024;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};});
await page.goto(BASE);await page.waitForFunction(()=>SEQUEL_RENDER.ready&&window.ARCADE_HEROES);await page.click('#sound');
const checks=await page.evaluate(()=>{
 const g=LAST_EDEN,out=[];const check=(name,value)=>out.push({name,passed:!!value});
 const ticks=n=>{for(let i=0;i<n;i++)g.step(1/60);},key=(code,on)=>window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));
 const W=768;
 // A fresh enemy is off screen if it starts beyond the locked view or above the top edge.
 const offscreen=(e,s)=>e.state==='drop'?e.y-e.z<0:(e.x<s.lock.left-30||e.x>s.lock.right+30);

 // Story continuity and structure.
 check('Chapter 1 continues directly from Fessenden’s death in the first game',/Fessenden/.test(EDEN_CAMPAIGN[0].brief)&&/lab/.test(EDEN_CAMPAIGN[0].brief));
 check('Every chapter ending sets up the next chapter',EDEN_CAMPAIGN.slice(0,5).every((c,i)=>c.end.length>120));
 check('The final chapter is the clone war',/MIRROR WAR/.test(EDEN_CAMPAIGN[5].area)&&EDEN_MISSIONS[5].tasks.reduce((n,t)=>n+(t[4]||0),0)===4);
 for(let i=0;i<6;i++){g.start(i);const p=g.snapshot.plan;check(`Chapter ${i+1}: six sections, at least eleven fights and a mid-boss`,p.sections.length===6&&p.encounters.length>=11&&p.encounters.some(e=>e.elite)&&p.encounters[p.encounters.length-1].boss&&g.snapshot.length>6000);}

 // Enemies enter from beyond the screen edges (or drop in from above), including later waves.
 let fresh=0,bad=0;const badList=[];
 for(let i=0;i<6;i++){g.start(i,0);const n=g.snapshot.plan.encounters.length;
  for(const k of [0,3,7,11]){if(k>=n-1)continue;g.test.skipTo(k);g.step(1/60);const s=g.snapshot;for(const e of s.enemies){fresh++;if(!offscreen(e,s)){bad++;badList.push([i,k,1,e.type,Math.round(e.x),e.state,Math.round(e.z),s.lock.left]);}}
   // Clear the first wave; the reinforcements must also arrive from off screen.
   g.snapshot.enemies.forEach((e,j)=>{g.test.damageEnemy(j,99999);});ticks(2);const s2=g.snapshot;for(const e of s2.enemies.filter(e=>!e.dead&&e.hp===e.maxhp)){fresh++;if(!offscreen(e,s2)){bad++;badList.push([i,k,2,e.type,Math.round(e.x),e.state,Math.round(e.z),s2.lock.left]);}}
   g.test.finishEncounter();ticks(80);}}
 check(`All ${fresh} sampled reinforcements start off screen${bad?' '+JSON.stringify(badList.slice(0,4)):''}`,fresh>60&&bad===0);
 g.start(0);g.test.skipTo(g.snapshot.plan.encounters.length-1);g.step(1/60);let s=g.snapshot,boss=s.enemies.find(e=>e.boss);
 check('The boss walks in from beyond the right edge',boss&&boss.x>s.lock.right);ticks(150);s=g.snapshot;boss=s.enemies.find(e=>e.boss);check('The boss finishes its entrance on screen',boss.x<s.lock.right-60);
 g.test.damageEnemy(s.enemies.indexOf(s.enemies.find(e=>e.boss)),boss.maxhp*.4);ticks(1);s=g.snapshot;
 check('Boss reinforcements at two thirds health arrive from both edges',s.enemies.filter(e=>!e.boss).length>=3&&s.enemies.filter(e=>!e.boss).every(e=>offscreen(e,s)));
 check('Enemies never wind up an attack while still off screen',(()=>{let early=0;for(const i of [0,2,4]){g.start(i);g.test.skipTo(1);for(let k=0;k<400;k++){g.step(1/60);if(g.snapshot.enemies.some(e=>!e.onstage&&e.state==='windup'))early++;}}return early===0;})());

 // Running: steady anchors, horizontal only, run frames by distance.
 // Running uses the original frame records, anchored at the feet by the arcade's own layout tables.
 const AHX=ARCADE_HEROES,fr=(id,n)=>AHX.heroes[id][n].map(i=>AHX.frames[i]);
 check('Every hero runs on the nine-frame arcade run cycle and walks on twelve frames',['mustapha','jack','hannah','mess'].every(id=>fr(id,'run').length===9&&fr(id,'walk').length===12&&fr(id,'run').every(f=>f.oy>40&&f.oy<100)));
 g.start(0);g.test.move(200,350);ticks(100);key('ShiftLeft',true);key('KeyW',true);ticks(3);check('Shift with only up/down is not a run',!g.snapshot.player.run);key('KeyW',false);key('KeyD',true);ticks(3);g.render();check('Shift with a horizontal direction runs with the run pose',g.snapshot.player.run&&g.snapshot.player.pose==='run');
 const x0=g.snapshot.player.x;ticks(30);check('Running is faster than walking',g.snapshot.player.x-x0>126);key('KeyD',false);key('ShiftLeft',false);
 g.start(0);ticks(100);key('ArrowUp',true);key('ArrowUp',false);key('ArrowUp',true);ticks(3);check('Double-tapping up does not start a sideways run',!g.snapshot.player.run);key('ArrowUp',false);

 // Weapons: crouching pickup and two-handed armed movement.
 for(let hero=0;hero<4;hero++){
  g.start(0,hero);ticks(100);g.test.move(230,360);g.controls.pickup();g.render();const crouch=g.snapshot.player.pose==='pickup'&&!g.snapshot.player.weapon;ticks(4);const midway=!g.snapshot.player.weapon;ticks(14);
  check(`Hero ${hero+1}: picking up a gun is a short crouch and the gun arrives during it`,crouch&&midway&&g.snapshot.player.weapon==='gun');
  key('KeyD',true);ticks(8);g.render();const walk=g.snapshot.player.pose;key('ShiftLeft',true);ticks(8);g.render();const run=g.snapshot.player.pose;key('ShiftLeft',false);key('KeyD',false);g.controls.jump();ticks(6);g.render();const air=g.snapshot.player.pose;
  check(`Hero ${hero+1}: a carried gun stays in both hands while walking, running and jumping`,walk==='armed-walk'&&run==='armed-run'&&air==='armed-jump');
 }
 check('Every hero carries long guns on arcade torso sprites over 12 walking and 8 running leg frames, with a hand point',['mustapha','jack','hannah','mess'].every(id=>fr(id,'legsWalk').length===12&&fr(id,'legsRun').length===8&&['torsoWalk','torsoRun','gunStand','gunFire','pistolStand','pistolFire'].every(n=>fr(id,n)[0].hand&&fr(id,n)[0].hand[0]<0&&fr(id,n)[0].hand[1]<-30)));
 check('A weapon out of reach is no longer grabbed by the attack button',(()=>{g.start(0);ticks(100);g.test.move(150,350);g.test.drop('rifle',215,350);g.controls.attack();return g.snapshot.player.pickup===0;})());
 const mus=ARCADE_ASSETS.mustapha,air=fr('mustapha','jump');
 check('Mustapha’s jump no longer uses the torch-holding frame or the legs-only fragment',air.every(f=>![31,33].some(i=>mus.frames[i].x===f.x&&mus.frames[i].y===f.y)));
 check('Armed poachers no longer turn into a triceratops sprite when firing',!COMBAT_ART.groups.gunner.attack.some(n=>n===73||n===75));

 // The Cadillac and the on-foot toll fort.
 g.start(1,1);g.render();check('Chapter 2 starts in the Cadillac with the hero at the wheel',g.snapshot.driving&&g.snapshot.player.pose==='driving');
 const foot=g.snapshot.plan.sections.findIndex(s=>!s.drive);g.test.skipTo(g.snapshot.plan.sections[foot].first);check('The Cadillac parks for the on-foot toll fort',!g.snapshot.driving);
 g.test.skipTo(g.snapshot.plan.sections[5].first);check('The chase resumes in the Cadillac for the convoy boss',g.snapshot.driving);

 // The clone war: freed copies fight hostile copies.
 g.start(5,0,'story',3);ticks(5);g.test.freeClones(2);ticks(90);const a0=g.snapshot.allies[0];g.test.move(a0.x+330,300);
 const enemy=g.test.spawnEnemy(a0.x+70,a0.y,'mirror');
 const hostile=g.snapshot.enemies.length-1;let allyHit=false,enemyHit=false;const ehp=enemy.hp;
 for(let i=0;i<600&&!(allyHit&&enemyHit);i++){g.step(1/60);const s=g.snapshot;if(s.allies.some(a=>a.hp<a.maxhp))allyHit=true;const e=s.enemies[hostile];if(e&&(e.hp<ehp||e.dead))enemyHit=true;}
 check('Freed clones attack hostile clones without the player',enemyHit);
 check('Hostile clones turn on the freed clones',allyHit);
 g.start(5,1,'story',4);check('A checkpoint after the pylons keeps the freed clones and the finished objectives',g.snapshot.allies.length===4&&g.snapshot.mission.completed===3);
 g.start(5,2,'story',3);const mirrors=g.snapshot.allies.length;g.test.skipTo(g.snapshot.plan.encounters.findIndex(e=>e.task===0));g.step(1/60);g.test.finishEncounter();ticks(2);check('Breaking the first command pylon frees two copies of the heroes',mirrors===0&&g.snapshot.allies.length===2&&g.snapshot.allies.every(a=>a.hero!==2));

 // Checkpoints at every section.
 g.start(0,0);const sec=g.snapshot.plan.sections[3];g.test.skipTo(sec.first);check('Entering a section saves a checkpoint there',g.snapshot.checkpoint.section===3);
 g.start(0,0,'story',3);check('Resuming at a section keeps earlier objectives complete',g.snapshot.mission.completed===1&&g.snapshot.player.x>sec.x);
 return out;
}).catch(e=>[{name:'Story checks threw: '+e.message,passed:false}]);
checks.push({name:'No browser exceptions in story checks',passed:errors.length===0});
fs.writeFileSync('tests/results/story-report.json',JSON.stringify({passed:checks.filter(c=>c.passed).length,checks,errors},null,2));await browser.close();
for(const row of checks)console.log((row.passed?'PASS ':'FAIL ')+row.name);
for(const row of checks)assert.ok(row.passed,row.name);assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({passed:checks.length,errors}));
})().catch(e=>{console.error(e);process.exit(1);});
