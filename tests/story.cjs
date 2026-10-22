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
 // Arcade px (ARCHITECTURE §7): the view is 384x224; M is the middle of the feet band.
 const W=384,M=()=>g.snapshot.band.mid;
 // A fresh enemy is off screen if it starts beyond the locked view or above the top edge of the view.
 const offscreen=(e,s)=>e.state==='drop'?e.y-e.z<s.view.y:(e.x<s.lock.left-32||e.x>s.lock.right+32);

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
 check('The boss walks in from beyond the right edge',boss&&boss.x>s.lock.right);ticks(150);s=g.snapshot;boss=s.enemies.find(e=>e.boss);check('The boss finishes its entrance on screen',boss.x<s.lock.right-44);
 g.test.damageEnemy(s.enemies.indexOf(s.enemies.find(e=>e.boss)),boss.maxhp*.4);ticks(1);s=g.snapshot;
 check('Boss reinforcements at two thirds health arrive from both edges',s.enemies.filter(e=>!e.boss).length>=3&&s.enemies.filter(e=>!e.boss).every(e=>offscreen(e,s)));
 check('Enemies never wind up an attack while still off screen',(()=>{let early=0;for(const i of [0,2,4]){g.start(i);g.test.skipTo(1);for(let k=0;k<400;k++){g.step(1/60);if(g.snapshot.enemies.some(e=>!e.onstage&&e.state==='windup'))early++;}}return early===0;})());

 // Running: steady anchors, horizontal only, run frames by distance.
 // Running uses the original frame records, anchored at the feet by the arcade's own layout tables.
 // ROM clips by role (HEROES §10.1): the run cycle main:9 is 8 frames, entered through the 10-frame runStart main:2.
 const RH=ROM_HEROES.hero,clipOf=(id,r)=>RH[id].anim[r],oyOf=(id,rec)=>SPRITES.rect('heroes',rec,id)[5];
 check('Every hero runs on the eight-frame arcade run cycle (after its run start) and walks on twelve frames',['mustapha','jack','hannah','mess'].every(id=>clipOf(id,'run').f.length===8&&clipOf(id,'runStart').f.length>=9&&clipOf(id,'walk').f.length===12&&clipOf(id,'run').f.every(f=>{const oy=oyOf(id,f[0]);return oy>40&&oy<100;})));
 g.start(0);g.test.move(148,M());ticks(100);key('ShiftLeft',true);key('KeyW',true);ticks(3);check('Shift with only up/down is not a run',!g.snapshot.player.run);key('KeyW',false);key('KeyD',true);ticks(3);g.render();check('Shift with a horizontal direction runs with the run pose',g.snapshot.player.run&&g.snapshot.player.pose==='run');
 const x0=g.snapshot.player.x;ticks(30);check('Running is faster than walking',g.snapshot.player.x-x0>93);key('KeyD',false);key('ShiftLeft',false);
 g.start(0);ticks(100);key('ArrowUp',true);key('ArrowUp',false);key('ArrowUp',true);ticks(3);check('Double-tapping up does not start a sideways run',!g.snapshot.player.run);key('ArrowUp',false);

 // Weapons: crouching pickup and two-handed armed movement.
 for(let hero=0;hero<4;hero++){
  g.start(0,hero);ticks(100);{const gun=g.snapshot.drops.find(d=>d.type==='gun');g.test.move(gun.x,gun.y);}g.controls.pickup();g.render();const crouch=g.snapshot.player.pose==='pickup'&&!g.snapshot.player.weapon;ticks(4);const midway=!g.snapshot.player.weapon;ticks(14);
  check(`Hero ${hero+1}: picking up a gun is a short crouch and the gun arrives during it`,crouch&&midway&&g.snapshot.player.weapon==='gun');
  key('KeyD',true);ticks(8);g.render();const walk=g.snapshot.player.pose;key('ShiftLeft',true);ticks(8);g.render();const run=g.snapshot.player.pose;key('ShiftLeft',false);key('KeyD',false);g.controls.jump();ticks(6);g.render();const air=g.snapshot.player.pose;
  check(`Hero ${hero+1}: a carried gun stays in both hands while walking, running and jumping`,walk==='armed-walk'&&run==='armed-run'&&air==='armed-jump');
 }
 // Every firearm is visible in its stance and on the shot frame of its fire clip: the hold of that frame has an entry
 // for the weapon in the hero's ROM hold table (HEROES §7.2-§7.3).
 check('Every hero carries long guns on arcade torso sprites over 12 walking and 8 running leg frames, and shows every firearm in its stance and on the shot frame',['mustapha','jack','hannah','mess'].every(id=>clipOf(id,'legsWalk').f.length===12&&clipOf(id,'legsRun').f.length===8&&['gun','rifle','uzi','m16','shotgun','bazooka'].every(w=>{const cls=ROM_HEROES.weapon[w].cls,C=RH[id].cls[cls],st=clipOf(id,C.stand).f[0],at=clipOf(id,C.attack).f,shot=at[Math.min(cls==='smg'||cls==='m16'?1:0,at.length-1)],hold=RH[id].hold[w];return st[3]>=0&&!!hold[st[3]]&&shot[3]>=0&&!!hold[shot[3]]&&HeroRig.muzzle(id,w)!==null;})));
 check('A weapon out of reach is no longer grabbed by the attack button',(()=>{g.start(0);ticks(100);g.test.move(111,M());g.test.drop('rifle',159,M());g.controls.attack();return g.snapshot.player.pickup===0;})());
 // Record pin (ARCHITECTURE §7 L54-55, PLAN §7 G3a): every jumpUp/jumpFwd frame is in the main:3/4 jump set 218-227 (HEROES §10.1),
 // never the torch-holding frame or the legs-only fragment; and the jump the game draws is one of them.
 {g.start(0,0);ticks(100);g.controls.jump();ticks(6);g.render();const live=g.snapshot.player.anim;
 check('Mustapha’s jump no longer uses the torch-holding frame or the legs-only fragment',['jumpUp','jumpFwd'].every(r=>clipOf('mustapha',r).f.every(f=>f[0]>=218&&f[0]<=227))&&live&&live.rec>=218&&live.rec<=227);}
 // ENEMIES §8 (PLAN §7 G4): every gunner state and attack of every variant resolves inside the Mituryou sets (POACHER J,
 // SKINNER, GUTTER: main, down, held) or the Thurow ones (DYNA, BOMB), and a live poacher's aimed shot draws from them.
 {const SETS=new Set(['0x6C57A','0x6CA24','0x6CF3E','0x2EFEC','0x2F176','0x2F2F6','0x30D2C','0x30D84','0x30DDC','0x5B77C','0x5B606','0x30132','0x2FFAA','0x31094','0x31048']),bad=[];
  for(const V of Object.keys(ENEMY_KINDS.gunner.variants)){const t=ENEMY_KINDS.table('gunner',V);
   for(const [st,ref] of Object.entries(t.st||{})){if(st==='variants')continue;const k=ENEMY_KINDS.stateAnim('gunner',V,st);if(!k||!SETS.has(k.split(':')[0]))bad.push(V+' '+st+' '+k);}
   for(const a of t.atk||[]){if(a.variants&&!a.variants.includes(V))continue;const k=ENEMY_KINDS.resolve('gunner',V,a.a);if(!k||!SETS.has(k.split(':')[0]))bad.push(V+' '+a.id+' '+k);}}
  g.start(0,0,'normal');ticks(100);const M2=g.snapshot.band.mid;g.test.move(g.snapshot.view.x+60,M2);const p=g.test.spawnEnemy(g.snapshot.view.x+250,M2,'gunner');p.dir=-1;p.timer=0;const pi=g.snapshot.enemies.length-1;const live=new Set();
  for(let i=0;i<240;i++){ticks(1);const a=g.test.romAnimOf(pi);if(a)live.add(a.key.split(':')[0]);}
  check(`Armed poachers draw only poacher records (every gunner state and attack in the Mituryou/Thurow sets; live ${[...live].join(',')})${bad.length?' '+bad.slice(0,4).join(' | '):''}`,!bad.length&&live.size>0&&[...live].every(s=>SETS.has(s)));}

 // The Cadillac and the on-foot toll fort.
 g.start(1,1);g.render();check('Chapter 2 starts in the Cadillac with the hero at the wheel',g.snapshot.driving&&g.snapshot.player.pose==='driving');
 const foot=g.snapshot.plan.sections.findIndex(s=>!s.drive);g.test.skipTo(g.snapshot.plan.sections[foot].first);check('The Cadillac parks for the on-foot toll fort',!g.snapshot.driving);
 g.test.skipTo(g.snapshot.plan.sections[5].first);check('The chase resumes in the Cadillac for the convoy boss',g.snapshot.driving);

 // The clone war: freed copies fight hostile copies.
 g.start(5,0,'story',3);ticks(5);g.test.freeClones(2);ticks(90);const a0=g.snapshot.allies[0];g.test.move(a0.x+244,g.snapshot.band.top+12);
 const enemy=g.test.spawnEnemy(a0.x+52,a0.y,'mirror');
 const hostile=g.snapshot.enemies.length-1;let allyHit=false,enemyHit=false;const ehp=enemy.hp;
 for(let i=0;i<600&&!(allyHit&&enemyHit);i++){g.step(1/60);const s=g.snapshot;if(s.allies.some(a=>a.hp<a.maxhp))allyHit=true;const e=s.enemies[hostile];if(e&&(e.hp<ehp||e.dead))enemyHit=true;}
 check('Freed clones attack hostile clones without the player',enemyHit);
 check('Hostile clones turn on the freed clones',allyHit);
 g.start(5,1,'story',4);check('A checkpoint after the pylons keeps the freed clones and the finished objectives',g.snapshot.allies.length===4&&g.snapshot.mission.completed===3);
 g.start(5,2,'story',3);const mirrors=g.snapshot.allies.length;g.test.skipTo(g.snapshot.plan.encounters.findIndex(e=>e.task===0));g.step(1/60);g.test.finishEncounter();ticks(2);check('Breaking the first command pylon frees two copies of the heroes',mirrors===0&&g.snapshot.allies.length===2&&g.snapshot.allies.every(a=>a.hero!==2));

 // Checkpoints at every section.
 g.start(0,0);const sec=g.snapshot.plan.sections[3];g.test.skipTo(sec.first);check('Entering a section saves a checkpoint there',g.snapshot.checkpoint.section===3);
 g.start(0,0,'story',3);check('Resuming at a section keeps earlier objectives complete',g.snapshot.mission.completed===1&&g.snapshot.player.x>sec.x);

 // The elite's `after` radio line plays when the elite is beaten (CODE-MAP §15.1: it never did; fixed in G4, CAMPAIGN D13).
 {g.start(0,0);const k=g.snapshot.plan.encounters.findIndex(e=>e.elite);g.test.skipTo(k);g.step(1/60);let elite=null;
  for(let i=0;i<1800&&!elite;i++){g.step(1/60);if(i%15===0)g.snapshot.enemies.forEach((e,j)=>{if(!e.elite&&!e.dead&&!e.dying&&e.onstage)g.test.damageEnemy(j,99999);});elite=g.snapshot.enemies.find(e=>e.elite)||null;}
  const want=EDEN_CAMPAIGN[0].sections.flatMap(s=>s.enc).find(e=>e.elite).after;
  if(elite){for(let i=0;i<120&&!g.snapshot.enemies.find(e=>e.elite)?.onstage;i++)g.step(1/60);const j=g.snapshot.enemies.findIndex(e=>e.elite);if(j>=0)g.test.damageEnemy(j,99999);}
  const s=g.snapshot,lines=[s.radio,...(s.radioQueue||[])];
  check('An elite’s after line is queued on the radio when the elite is beaten',!!elite&&!!want&&lines.includes(want));}

 return out;
}).catch(e=>[{name:'Story checks threw: '+e.message,passed:false}]);
// G6 presentation (PLAN §7 G6, CAMPAIGN §4.7, §11): the card, the intermission panels, the captions, the music cues,
// the tally, the ending beats, the staff roll and the attract story, all on the canvas through ARCADE_UI. Async: a card
// leads into play only once its chapter's first stage pages are decoded (ARCHITECTURE §5.5), so the chapter is loaded
// first (the checks above released chapter 1's pages).
const g6=await page.evaluate(async()=>{
 const g=LAST_EDEN,out=[];const check=(name,value)=>out.push({name,passed:!!value});
 const key=(code,on)=>window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));
 const until=(cond,max)=>{let n=0;while(!cond()&&n<max){g.step(1/60);n++;}return n;};
 const load=async i=>{await SEQUEL_RENDER.loadChapter(i);for(let k=0;k<100&&!STAGE_RENDER.ready(i);k++)await new Promise(r=>setTimeout(r,20));};
 {const C=EDEN_CAMPAIGN[0];await load(0);let st=g.test.startCard(0,1,'story');const c0=g.snapshot.card;
  check('A chapter opens on its card (state brief): chapter 1 shows the EASTCOAST 2513 caption first',st==='brief'&&c0&&c0.phase==='card'&&c0.pre===C.card.pre&&!!window.ARCADE_UI);
  const seen=[];until(()=>{const c=g.snapshot.card;if(c&&c.phase==='panel'&&!seen.includes(c.k))seen.push(c.k);return g.state==='play';},6000);
  const s=g.snapshot,dialog=C.dialog.split('\n');
  check(`The card leads through every intermission panel (${seen.length}/${C.inter.length}) into play`,g.state==='play'&&seen.length===C.inter.length&&seen.every((k,i)=>k===i));
  check('Play opens with the chapter dialog on the radio, ahead of the section line',[s.radio,...s.radioQueue].filter(Boolean).slice(0,dialog.length).join('|')===dialog.join('|'));
  await load(1);g.test.startCard(1,1,'story');document.getElementById('enter-stage').click();check('ENTER skips the card and the panels',g.state==='play'&&!g.snapshot.card);
  await load(0);g.test.startCard(0,1,'story',3);const c3=g.snapshot.card;let panels=false;until(()=>{if(g.snapshot.card?.phase==='panel')panels=true;return g.state==='play';},2000);
  check('A checkpoint resume shows the card only',c3&&c3.start===3&&!c3.pre&&!panels&&g.state==='play');
  // a button finishes the typing, then moves on
  g.test.startCard(2,1,'story');g.step(1/60);g.test.cardAdvance();const typed=g.snapshot.card;g.test.cardAdvance();const next=g.snapshot.card;
  check('NEXT finishes the typing first, then turns to the first panel',typed.phase==='card'&&typed.t>2&&next.phase==='panel'&&next.k===0);}
 {g.start(0,1);let s=g.snapshot;const capA=s.caption?.text;g.step(1/60);const id0=g.snapshot.audio.id;
  const a1=s.plan.encounters.findIndex(e=>e.area===1);g.test.skipTo(a1);const capB=g.snapshot.caption?.text;until(()=>!g.snapshot.caption,400);const gone=!g.snapshot.caption;
  check('Each area opens with its caption on row 23 for 2.5 s (WASSOON HARBOR, THE JAIL QUAY)',capA===EDEN_CAMPAIGN[0].sections[0].cap&&capB===EDEN_CAMPAIGN[0].sections[2].cap&&gone);
  const cues=[];for(const k of [0,4,8]){g.test.skipTo(k);g.step(1/60);cues.push([g.snapshot.section,g.snapshot.audio.id]);}
  check(`Music follows the chapter's cue per section (${JSON.stringify(cues)})`,id0===EDEN_CAMPAIGN[0].music.stage[0]&&cues.every(([sec,id])=>id===EDEN_CAMPAIGN[0].music.stage[sec]));}
 {// the radio strip draws in the ROM 8x16 font (ARCADE_UI.text, traced) inside layout.radio
  g.start(0,1);g.test.say('ROOK: Never seen you before in my life. And it’s a short life.');const glyphs=[];ARCADE_UI.trace=e=>glyphs.push(e);g.render();ARCADE_UI.trace=null;g.test.say(null);
  const R=g.layout.radio.map(v=>v/2),inStrip=glyphs.filter(e=>e.font===16&&e.y>=R[1]&&e.y+16<=R[1]+R[3]+1);
  check('Radio lines are drawn upper case in the 8x16 font, wrapped to two rows inside the radio strip',inStrip.length>=40&&new Set(inStrip.map(e=>e.y)).size===2&&inStrip.every(e=>e.ch===e.ch.toUpperCase()));}
 {// the tally: VITALITY hp x 100, ENEMIES the chapter's beaten enemies x 100, FINAL BLOW 20 000 for a special finish
  g.start(0,1);const score0=g.snapshot.score,hp=Math.round(g.snapshot.player.hp);g.test.clear();const T=g.snapshot.tally;
  check('The stage clear shows the tally and pays its total',g.state==='clear'&&T.vitality===hp*100&&T.enemies===0&&T.finalBlow===0&&T.total===T.vitality+T.enemies+T.finalBlow&&g.snapshot.score===score0+T.total);
  until(()=>g.snapshot.tally.story,400);check('After the tally the chapter end is typed in the panel',g.snapshot.tally.story&&!!document.getElementById('clear-end'));
  g.start(0,1);g.test.spawnBoss();until(()=>{const b=g.snapshot.enemies.find(e=>e.boss);return b&&b.state!=='intro';},400);
  const bi=g.snapshot.enemies.findIndex(e=>e.boss);g.test.damageEnemy(bi,g.snapshot.enemies[bi].hp-3);
  const bossHp=()=>g.snapshot.enemies.find(e=>e.boss)?.hp;
  for(let tries=0;tries<24&&bossHp()>0;tries++){until(()=>{const b=g.snapshot.enemies.find(e=>e.boss);return b&&b.inv<=0&&!['script','intro','down','leap'].includes(b.state);},120);
   const b=g.snapshot.enemies.find(e=>e.boss),p=g.snapshot.player;g.test.move(b.x-36,b.y);g.step(1/60);if(p.specialCd<=0&&p.hurt<=0)g.controls.special();g.step(1/60);if(bossHp()>0)until(()=>false,20);}
  const killed=!(bossHp()>0);g.snapshot.enemies.forEach((e,j)=>{if(!e.boss&&!e.dead&&!e.dying)g.test.damageEnemy(j,99999);});until(()=>g.state==='clear',900);
  check('A special that finishes the boss scores the FINAL BLOW 20 000',killed&&g.state==='clear'&&g.snapshot.tally.finalBlow===20000);}
 {// containers are ROM records from the stage recipes: every on-foot section authors its own
  let bad=[];for(let i=0;i<6;i++){g.start(i);const P=g.snapshot.plan;for(const s of P.sections){const box=s.props.filter(p=>p.kind==='crate'||p.kind==='barrel');if(!s.drive&&!box.length)bad.push(s.stage+' none');for(const p of box){const r=ROM_FX.props[p.kind];if(!r||r.rec==null)bad.push(s.stage+' '+p.kind);}}}
  check('Every on-foot section authors its containers, each a ROM container record (crate = DRAMCAN, barrel = TARU)',bad.length===0);}
 {// the ending: EDEN_ENDING's beats in order, then the final panel
  g.start(5,1,'story',5);g.test.freeClones(4);g.test.clear();g.test.ending();const beats=[],stumbled=[],carStops=[];let n=0;
  while(n<12000&&!g.snapshot.ending.done){g.step(1/60);n++;if(n%10)continue;const e=g.snapshot.ending;if(e.beat&&beats[beats.length-1]!==e.beat)beats.push(e.beat);if(e.beat==='run'&&e.actors.some(a=>a.state==='down'))stumbled.push(n);if(e.beat==='road'&&e.car&&e.car.v===0)carStops.push(n);if(n%600===0)g.render();}
  g.render();
  check(`The ending plays EDEN_ENDING's beats in order (${beats.join(' ')})`,JSON.stringify(beats)===JSON.stringify(EDEN_ENDING.map(b=>b.beat))&&g.state==='ending'&&!!document.getElementById('chapters'));
  check('In the ending a freed copy stumbles in the spire halls and the Cadillac pulls up on the sunset road',stumbled.length>0&&carStops.length>0);
  // the staff roll is traced: red categories and white names in the ROM font over the road (chapter 2's E3a0 loop, many
  // colours, not a blank screen), then THANK YOU once the roll has passed (G6 verify #7)
  await load(1);g.test.credits();for(let i=0;i<300;i++)g.step(1/60);let gl=[];ARCADE_UI.trace=e=>gl.push(e);g.render();ARCADE_UI.trace=null;
  // (from file:// the stage pages taint the canvas, which only drawing them can do: then the road counts as drawn)
  const pens=new Set(gl.map(e=>e.pen)),cv=document.getElementById('game'),cols=new Set();let px=null;try{px=cv.getContext('2d').getImageData(0,Math.floor(cv.height*.62),cv.width,Math.floor(cv.height*.3)).data;}catch(e){for(let i=0;i<40;i++)cols.add(i);}
  if(px)for(let i=0;i<px.length;i+=28)cols.add(px[i]<<16|px[i+1]<<8|px[i+2]);const roll=gl.length>=20&&pens.has('red')&&pens.has('white');
  for(let i=0;i<1400;i++)g.step(1/60);gl=[];ARCADE_UI.trace=e=>gl.push(e);g.render();ARCADE_UI.trace=null;const thanks=gl.map(e=>e.ch).join('').includes('THANKYOU');
  check(`The credits roll the staff list (red categories, white names) over the sunset road, then THANK YOU (${cols.size} road colours)`,g.state==='credits'&&roll&&cols.size>=40&&thanks);}
 {// the title plays the attract story after 20 s without input; a key returns to the title
  g.test.menu();for(let i=0;i<60*20+2;i++)g.step(1/60);const a=g.snapshot.attract;g.render();
  until(()=>g.snapshot.attract?.k===1,2000);const k1=g.snapshot.attract?.k;key('KeyJ',true);key('KeyJ',false);
  check('After 20 s on the title the attract story plays its panels; a key returns to the title',a&&a.k===0&&k1===1&&g.state==='menu');}
 return out;
}).catch(e=>[{name:'G6 story checks threw: '+e.message,passed:false}]);
checks.push(...g6);
// G6 verify fixes: the ending opens on LOT 00's fall (CAMPAIGN §11.2 #1); every picture of the §4.7 table carries its
// subject (pics.json `sprites`) over its shipped background, Echo's sound bars move; the ch5 vat hall tanks hold the
// hero copies under their name plates (CAMPAIGN §9.1 S4).
const subjectPics=Object.entries(JSON.parse(fs.readFileSync('tools/re/levels/pics.json','utf8')).pics).filter(([,p])=>(p.sprites||[]).length).map(([id])=>id);
const g6b=await page.evaluate(async ids=>{
 const g=LAST_EDEN,out=[];const check=(name,value)=>out.push({name,passed:!!value});
 const load=async i=>{await SEQUEL_RENDER.loadChapter(i);for(let k=0;k<100&&!STAGE_RENDER.ready(i);k++)await new Promise(r=>setTimeout(r,20));};
 {g.start(5,1,'story',5);g.test.freeClones(4);g.test.clear();g.test.ending();const L0=g.snapshot.ending?.lot;let gel=0,drawn=false,n=0;
  while(n<600&&g.snapshot.ending?.beat==='fall'){g.step(1/60);n++;const l=g.snapshot.ending.lot;if(l)gel=Math.max(gel,l.gel);if(n===30){g.render();drawn=!!g.snapshot.ending.lot?.drawn;}}
  while(n<1200&&g.snapshot.ending?.beat!=='run'){g.step(1/60);n++;}
  check(`The ending opens on LOT 00 falling (body main 10) and turning to gel under Fessenden’s box (gel ${gel.toFixed(2)})`,!!L0&&L0.key==='0x64452:10'&&L0.gel===0&&L0.parts>=3&&drawn&&gel>=.9&&g.snapshot.ending?.beat==='run'&&!g.snapshot.ending.lot);}
 // G6 verify r2 #1: the player's path (beat LOT 00, wait out the tally, SEE THE ENDING). The beaten LOT 00 falls over
 // (body main 10) at its defeat; in the fall beat it is that same body, drawn once (it leaves the enemy list), still gel.
 {const ticks=n=>{for(let i=0;i<n;i++)g.step(1/60);},key=(code,on)=>window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));
  g.start(5,1,'story');g.test.spawnBoss();ticks(170);g.test.damageEnemy(0,9999);ticks(180);g.test.damageEnemy(0,9999);ticks(110);
  const t=g.snapshot.mission.active;if(t){g.test.move(t.x,t.y);key('KeyE',true);ticks(100);key('KeyE',false);}ticks(240);
  const bi=g.snapshot.enemies.findIndex(e=>e.type==='fessenden');if(bi>=0)g.test.damageEnemy(bi,99999);
  let n=0,fell=null;while(g.state!=='clear'&&n<900){g.step(1/60);n++;if(n===20)fell=g.snapshot.enemies.find(e=>e.type==='fessenden')?.lot?.parts?.body?.key||null;}
  const rem=g.snapshot.enemies.find(e=>e.type==='fessenden'),rx=rem?rem.x:NaN;ticks(360);document.getElementById('next')?.click();
  const L1=g.snapshot.ending?.lot;let once=true,gelMin=1,seen=0,drawn=false;n=0;
  while(n<1200&&['fall','alarm'].includes(g.snapshot.ending?.beat)){g.step(1/60);n++;const s=g.snapshot;if(s.enemies.some(e=>e.type==='fessenden'))once=false;const l=s.ending.lot;
   if(l&&s.ending.beat==='fall'){seen++;gelMin=Math.min(gelMin,l.gel);if(seen===20){g.render();drawn=!!g.snapshot.ending.lot?.drawn;}}}
  check(`After the real fight LOT 00 falls over at its defeat and the ending’s fall beat shows that body once, where it was beaten and still gel (gel ≥ ${gelMin.toFixed(2)})`,fell==='0x64452:10'&&!!rem&&!!L1&&L1.remnant&&L1.key==='0x64452:10'&&Math.abs(L1.x-rx)<1&&once&&seen>0&&drawn&&gelMin>=.99&&g.snapshot.ending?.beat==='run');}
 {for(let k=0;k<400&&!ids.every(id=>g.test.composePic(id));k++)await new Promise(r=>setTimeout(r,25));
  const art=g.test.picArt(),file=location.protocol==='file:',img=src=>new Promise(r=>{const im=new Image();im.onload=()=>r(im);im.onerror=()=>r(null);im.src=src;});
  const px=(im,sx,sy,w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.drawImage(im,sx,sy,w,h,0,0,w,h);return x.getImageData(0,0,w,h).data;};
  const diff=(a,b)=>{let k=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>48)k++;return k/(a.length/4);};
  const rows=[];for(const id of ids){const A=art[id],P=ARCADE_UI.resolvePic(id),S=STAGE_DATA.pics[id];if(!A||!A.done||!P?.img){rows.push(id+':none');continue;}
   if(file){rows.push(id+':1');continue;}   // a file:// background taints the canvas: composed is all that can be read
   g.test.picFrame(id,30);const [w,h]=A.size,[sx,sy]=A.crop,base=await img(S.file);if(!base){rows.push(id+':nobase');continue;}
   rows.push(id+':'+diff(px(P.img,0,0,w,h),px(base,sx,sy,w,h)).toFixed(2));}
  const bad=rows.filter(r=>!(parseFloat(r.split(':')[1])>=.05));
  check(`Every picture with a subject in the CAMPAIGN §4.7 table is composed with it over its background (${rows.join(' ')})`,ids.length>=11&&bad.length===0);
  let moved=file;if(!file){const P=ARCADE_UI.resolvePic('p-echo-speaker'),[w,h]=art['p-echo-speaker'].size;g.test.picFrame('p-echo-speaker',10);const a=px(P.img,0,0,w,h);g.test.picFrame('p-echo-speaker',47);moved=diff(a,px(P.img,0,0,w,h))>.01;}
  check('Echo’s picture is her speaker grille with sound bars that move (layout C leaves room for the line beside it)',moved&&art['p-echo-speaker'].live&&32+art['p-echo-speaker'].size[0]<192);}
 {await load(4);g.start(4,1,'story',3);g.test.say(null);g.step(1/60);const gl=[];ARCADE_UI.trace=e=>gl.push(e);g.render();ARCADE_UI.trace=null;const txt=gl.filter(e=>e.font===8).map(e=>e.ch).join('');
  check('In the vat hall the hero copies float in Echo’s tanks: the opening screen shows the plates TENREC, DUNDEE and O’BRADOVICH',g.snapshot.section===3&&txt.includes('TENREC')&&txt.includes('DUNDEE')&&txt.includes('BRADOVICH'));}
 return out;
},subjectPics).catch(e=>[{name:'G6 verify-fix checks threw: '+e.message,passed:false}]);
checks.push(...g6b);
checks.push({name:'No browser exceptions in story checks',passed:errors.length===0});
fs.writeFileSync('tests/results/story-report.json',JSON.stringify({passed:checks.filter(c=>c.passed).length,checks,errors},null,2));await browser.close();
for(const row of checks)console.log((row.passed?'PASS ':'FAIL ')+row.name);
for(const row of checks)assert.ok(row.passed,row.name);assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({passed:checks.length,errors}));
})().catch(e=>{console.error(e);process.exit(1);});
