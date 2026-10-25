const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
fs.mkdirSync('tests/results',{recursive:true});
const BASE=require('./lib/arcade.cjs').BASE;   // the game page, play.html on GAME_URL (index.html is the home page)

// Checks for the handling polish: frame pacing independent of the display rate, Cadillac momentum and lean,
// the streaming road, rider behaviour, the radio strip position and the last copy (Fessenden) after the Crown Engine.
(async()=>{const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;let seed=777;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};});
await page.goto(BASE);await page.waitForFunction(()=>SEQUEL_RENDER.ready&&window.ARCADE_HEROES,null,{polling:100});await page.click('#sound');
const checks=await page.evaluate(()=>{
 const g=LAST_EDEN,out=[];const check=(name,value)=>out.push({name,passed:!!value});
 const ticks=(n,dt=1/60)=>{for(let i=0;i<n;i++)g.step(dt);},key=(code,on)=>window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));
 const release=()=>['KeyA','KeyD','KeyW','KeyS','KeyJ','KeyK','KeyL','KeyE','ShiftLeft'].forEach(k=>key(k,false));
 const car=()=>g.snapshot.player;
 // Arcade px (ARCHITECTURE §7): M is the middle of the feet band.
 const M=()=>g.snapshot.band.mid;

 // Movement advances by elapsed time, so a 72 Hz or 144 Hz display walks the same distance per second as 60 Hz.
 g.start(0,0,'normal');ticks(10);key('KeyD',true);const x0=car().x;ticks(60);const at60=car().x-x0;
 g.start(0,0,'normal');ticks(10);key('KeyD',true);const x1=car().x;ticks(72,1/72);const at72=car().x-x1;
 g.start(0,0,'normal');ticks(10);key('KeyD',true);const x2=car().x;ticks(144,1/144);const at144=car().x-x2;release();
 check(`One second of walking covers the same ground at 60, 72 and 144 updates per second (${at60.toFixed(1)} / ${at72.toFixed(1)} / ${at144.toFixed(1)} px)`,Math.abs(at60-at72)<2&&Math.abs(at60-at144)<2&&at60>100);
 const steps=[];g.start(0,0,'normal');ticks(10);key('KeyD',true);for(let i=0;i<40;i++){const a=car().x;g.step(1/72);steps.push(car().x-a);}release();
 check('Every 72 Hz step moves the hero by the same amount (no skipped frames)',steps.every(d=>Math.abs(d-steps[0])<.01)&&steps[0]>1);

 // The Cadillac builds speed, coasts down instead of stopping dead, and never drifts into the screen edge while locked.
 g.start(2,0,'normal');ticks(5);const startX=car().x;key('KeyD',true);ticks(6);const early=car().vx;ticks(60);const top=car().vx;key('KeyD',false);ticks(12);const coasting=car().vx;ticks(90);
 check(`Throttle builds speed over time (${early.toFixed(0)} → ${top.toFixed(0)} px/s) and the car moved forward`,early>0&&early<top&&top>148&&car().x>startX+111);
 check(`Releasing the throttle coasts down (${coasting.toFixed(0)} px/s) rather than stopping instantly`,coasting>0&&coasting<top);
 g.start(2,0,'normal');ticks(5);const plan=g.snapshot.plan;g.test.skipTo(0);g.step(1/60);ticks(30);let s=g.snapshot;
 check('The first highway fight locks the screen with riders entering from off screen',s.lock&&s.enemies.length>0&&s.enemies.every(e=>e.type==='biker'));
 ticks(180);release();ticks(120);const held=car().x,hp0=car().hp;ticks(120);s=g.snapshot;
 // A rider's hit jolts the car 23 px; apart from that, an unattended car must not creep toward the edge.
 const drift=car().x-held,jolted=car().hp<hp0;
 check(`With no input in a locked fight the car stays put (${drift.toFixed(1)} px drift${jolted?', after being hit':''}) and the whole car remains on screen`,Math.abs(car().vx)<1&&(Math.abs(drift)<1||jolted)&&car().x>=s.lock.left+118&&car().x<=s.lock.right-118);
 check('The highway keeps streaming under the car while the screen is locked',s.road>296&&s.driving);
 key('KeyS',true);ticks(14);const lean=car().bank;const vyDown=car().vy;key('KeyS',false);ticks(40);
 check(`Steering down leans the car (bank ${lean.toFixed(2)}) and the lean settles when released`,lean>.3&&vyDown>74&&Math.abs(car().bank)<.1);
 key('KeyA',true);ticks(50);check(`Brake / reverse backs the car up (${car().vx.toFixed(0)} px/s)`,car().vx<-74);release();ticks(30);

 // Ramming is a single impact per enemy that flings them; a beaten rider's bike explodes.
 // (G4 fix pass: bikes now start beyond the edge by their 89-px frame reach, so their entry and charge timings shift and at
 // tick 240 neither rider may be riding level (mid-charge or still entering); wait up to 3 s more for one in its ride.)
 g.start(2,0,'normal');ticks(5);g.test.skipTo(0);g.step(1/60);ticks(240);s=g.snapshot;
 let rider=s.enemies.find(e=>!e.dead&&e.onstage&&e.state==='walk');for(let i=0;i<180&&!rider;i++){ticks(1);s=g.snapshot;rider=s.enemies.find(e=>!e.dead&&e.onstage&&e.state==='walk');}
 if(rider){g.test.move(rider.x-193,rider.y);key('KeyD',true);ticks(10);g.controls.jump();ticks(45);release();}
 s=g.snapshot;const hitRider=s.enemies.find(e=>e.id===rider?.id);
 check('Ramming a rider at speed flings him off the bike',!!hitRider&&(hitRider.state==='fly'||hitRider.state==='down'||hitRider.dying||hitRider.hp<hitRider.maxhp));
 check('Drops on the highway slide back with the road',(()=>{g.test.drop('food',car().x+222,car().y);const d0=g.snapshot.drops.at(-1).x;ticks(30);const d=g.snapshot.drops.find(v=>v.type==='food');return !d||d.x<d0-74;})());
 const made=g.test.spawnEnemy(car().x+163,car().y,'biker');const idx=g.snapshot.enemies.findIndex(e=>e.id===made.id);g.test.damageEnemy(idx,99999);
 check('A beaten rider’s bike goes up in an explosion',g.snapshot.effects.includes('explosion')&&g.snapshot.enemies[idx].dying);
 g.start(2,1,'normal');ticks(5);g.test.skipTo(g.snapshot.plan.encounters.findIndex(e=>e.task===0));g.step(1/60);ticks(30);
 check('Convoy pods are carried on a flatbed that must be rammed',g.snapshot.mission.active?.kind==='cargo');
 // The radio strip has its own rect above the feet band (ARCHITECTURE §1.7): a line changes the pixels inside layout.radio
 // (most of them: the strip is drawn) and none in the lanes below arcade y 81.
 // A pixel row: from file:// the stage pages taint the canvas (getImageData throws, ARCHITECTURE §5.1), so it is an
 // environment SKIP there and required over http, like the G2/G7 pixel rows of tests/framing.cjs.
 if(location.protocol==='file:')out.push({name:'Radio chatter is drawn in its strip above the feet band, not across the lanes (http only: the canvas is tainted under file://)',passed:true,skipped:true});
 else check('Radio chatter is drawn in its strip above the feet band, not across the lanes',(()=>{const L=g.layout.radio,c=document.getElementById('game').getContext('2d'),W2=c.canvas.width,H2=c.canvas.height;
  g.start(0,0,'normal');g.test.say(null);g.render();const a=c.getImageData(0,0,W2,H2).data;g.test.say('JACK: Radio check from the sea wall.');g.render();const b=c.getImageData(0,0,W2,H2).data;g.test.say(null);
  let inside=0,total=0,below=0;for(let y=0;y<H2;y++)for(let x=0;x<W2;x++){const q=(y*W2+x)*4,d=Math.abs(a[q]-b[q])+Math.abs(a[q+1]-b[q+1])+Math.abs(a[q+2]-b[q+2])>24;if(x>=L[0]&&x<L[0]+L[2]&&y>=L[1]&&y<L[1]+L[3]){total++;if(d)inside++;}else if(y>=2*81&&d)below++;}
  return L[1]+L[3]<=2*81&&inside>total*.5&&below===0;})());

 // Riders swerve into the car and no longer shoot (ENEMIES §2.5: the ROM has no rider firing pose); a gunner arriving on the
 // highway is a roadside Thurow DYNA, whose dynamite is the hostile projectile (ENEMIES §8, PLAN §7 G4: polish L54
 // renamed). skipTo(1)'s waves are bikers only, so the thrower is brought in with test.arrive.
 g.start(2,0,'normal');ticks(5);g.test.skipTo(1);g.step(1/60);let rushes=0,shots=0,riderShots=0,thrower=null;
 for(let i=0;i<900;i++){if(i===60)thrower=g.test.arrive('gunner','R',0);g.step(1/60);const t=g.snapshot,bikers=new Set(t.enemies.filter(e=>e.type==='biker').map(e=>e.id));if(t.enemies.some(e=>e.type==='biker'&&e.state==='charge'))rushes++;if(t.bullets.some(b=>!b.friendly&&b.kind==='bomb'))shots++;if(t.bullets.some(b=>!b.friendly&&bikers.has(b.owner)))riderShots++;}
 check(`Riders charge the car (${rushes} charge ticks) and never shoot (${riderShots}); roadside dynamite flies (${shots} ticks, ${thrower?thrower.v:'no thrower'})`,rushes>0&&riderShots===0&&shots>0&&thrower?.v==='T');

 // Revision 3 (stage 8): beaten, Sable takes the unfinished treatment at once (no gate controls, no spillway): Mustapha's
 // release line goes on the radio, Sable walks to the crest and transforms (his own frames, then Crownback's: the
 // 'crownback:treatment' anim), invulnerable while it plays; then Crownback fights on his own body.
 g.start(7,5,'story');ticks(5);g.test.skipTo(g.snapshot.plan.encounters.length-1);g.step(1/60);ticks(200);
 s=g.snapshot;const sable=s.enemies.findIndex(e=>e.boss);g.test.damageEnemy(sable,s.enemies[sable].maxhp+1);ticks(2);s=g.snapshot;
 const last=s.enemies.find(e=>e.type==='fessenden');
 check('Beaten, Sable takes the treatment at once: Mustapha disengages the release (radio), then CROWNBACK comes in as a boss with no gate-controls phase',!!last&&last.boss&&last.name==='CROWNBACK'&&last.state==='mutate'&&!s.enemies.some(e=>e.boss&&e.type==='sable'&&e.phase===2&&!e.dead)&&[s.radio,...(s.radioQueue||[])].includes(EDEN_CAMPAIGN[7].releaseSay)&&!s.mission.active&&g.state==='play');
 {const keys=new Set();let hurt=false;const fi=()=>g.snapshot.enemies.findIndex(x=>x.type==='fessenden');for(let i=0;i<200;i++){g.step(1/60);const e=g.snapshot.enemies[fi()];if(e?.ba)keys.add(e.ba.key);if(i===90&&e){const h=e.hp;g.test.damageEnemy(fi(),50);hurt=g.snapshot.enemies[fi()].hp<h;}}
  check(`The treatment plays Sable's walk, then his transform frames into Crownback's, and he cannot be hurt meanwhile (${[...keys].join(', ')})`,keys.has('sable:1')&&keys.has('crownback:treatment')&&!hurt);}
 ticks(60);s=g.snapshot;const beast=s.enemies.find(e=>e.type==='fessenden');
 check('Crownback finishes the treatment on the crest and starts attacking',beast&&beast.x<s.lock.right-44&&!['intro','mutate'].includes(beast.state));
 {let drew=true;try{g.render();}catch(e){drew=false;}const bx=g.test.bossBox(s.enemies.indexOf(beast));
  check(`Crownback draws on his generated body ('crownback' frames, ${bx?bx.w+'x'+bx.h:'none'} px) without errors`,drew&&!!bx&&/^crownback:/.test(beast.ba?.key||'')&&bx.h>=130&&bx.h<=200);}
 g.test.clearFighters();ticks(90);
 check('Beating Crownback ends the stage and leads to the ending',g.state==='clear');
 check('The stage ending and story text describe Sable’s transformation into Crownback and his fall into the discharge works',/Crownback/.test(EDEN_CAMPAIGN[7].end)&&/discharge works/.test(EDEN_CAMPAIGN[7].end)&&/treatment/.test(EDEN_CAMPAIGN[7].brief)&&/CROWNBACK/.test(EDEN_CAMPAIGN[7].lastCopy.card));

 // Arcade gun stances decoded from the ROM (HEROES §10.2, PLAN §7 G3a): Jack's clips by record, the rec2 under-layer included.
 const RA=ROM_HEROES.hero.jack.anim,recs=(r,i)=>RA[r].f.map(f=>f[i]).join();
 check('Jack’s gun stances are his real arcade records: stand.pistol 75 over 74, attack.pistol 86/87 over 84, stand.rifle 77, attack.rifle 77/88',recs('stand.pistol',0)==='75'&&recs('stand.pistol',1)==='74'&&recs('attack.pistol',0)==='86,87'&&recs('attack.pistol',1)==='84,84'&&recs('stand.rifle',0)==='77'&&recs('attack.rifle',0)==='77,88');
 // Held weapons are placed by the ROM hold tables: the drawn record and its tight box equal the hold of the current frame.
 const heldFor=(hero,type,walk)=>{g.start(0,hero,'normal');ticks(5);g.test.equip(type,6);g.test.move(222,M());if(walk){key('KeyD',true);ticks(12);}g.render();const s=g.snapshot,h=s.held;key('KeyD',false);
  if(h){const id=ROM_HEROES.gameOrder[hero],a=s.player.anim,e=ROM_HEROES.hero[id].hold[type][a.hold],r=SPRITES.rect('fx',h.rec);h.rom=!!e&&e[0]===h.rec&&r&&h.w===r[2]&&h.h===r[3]&&h.lx===h.origin[0]-r[4]&&h.ly===h.origin[1]-r[5]&&(a.legs||(h.origin[0]===e[1]&&h.origin[1]===e[2]));}return h;};
 check('Every hero holds the rifle across the body: muzzle well ahead of the hold origin, stock back past it (ROM hold)',[0,1,2,3].every(h=>{const s=heldFor(h,'rifle');return s&&s.rom&&s.w===74&&s.lx<s.origin[0]-30&&s.lx+s.w>s.origin[0]+10;}));
 check('The Uzi and shotgun are held in front of the chest in both hands, at the arcade sprite size',[0,1,2,3].every(h=>['uzi','shotgun'].every(t=>{const s=heldFor(h,t);return s&&s.rom&&s.w===(t==='uzi'?40:47)&&s.ly<-40&&s.ly>-80;})));
 check('Every hero shoulders the bazooka at chest-to-shoulder height',[0,1,2,3].every(h=>{const s=heldFor(h,'bazooka');return s&&s.rom&&s.w===72&&s.ly<=-60;}));
 check('The held weapon stays at the ROM hold while walking (walking torsos, bob applied)',[0,1,2,3].every(h=>{const s=heldFor(h,'rifle',true);return s&&s.rom&&s.lx<s.origin[0];}));
 g.start(0,0,'normal');ticks(5);g.test.equip('knife',10);g.test.move(222,M());ticks(1);g.render();const kIdle=g.snapshot.held;key('KeyD',true);ticks(12);g.render();const kWalk=g.snapshot.held;key('KeyD',false);
 check('A knife stands upright in the fist at rest (rec 1685) and is carried level at the hip when walking (arcade 08:36, 10:28)',kIdle&&kIdle.rec===1685&&kIdle.w===9&&kWalk&&kWalk.w>kWalk.h&&kWalk.ly>kIdle.ly);
 // With no enemy around, a knife still stabs: it must be able to break a crate (it once did nothing and stalled a sonic lure).
 g.start(0,0,'normal');ticks(5);g.test.equip('knife',10);const crate=g.snapshot.objects[0];g.test.move(crate.x-37,crate.y);ticks(1);const crateHp=crate.hp;key('KeyD',true);ticks(1);key('KeyD',false);g.controls.attack();ticks(20);
 check('A knife with nobody to throw at stabs objects instead of doing nothing',g.snapshot.objects[0].hp<crateHp||g.snapshot.objects[0].hp<=0);
 g.start(0,1,'normal');ticks(5);g.test.equip('gun',6);g.test.move(222,M());g.controls.attack();g.render();s=g.snapshot;
 check('Jack fires the handgun on his ROM fire clip, the bullet leaving the ROM muzzle (hold origin + spawn offset)',s.gunSocket.held===true&&s.gunSocket.gunDrawn===false&&Math.abs(s.bullets[0].x-(s.player.x+s.gunSocket.muzzle))<.001&&s.player.pose==='fire'&&s.player.anim&&s.player.anim.id==='weapon:11');
 g.test.equip('bazooka',4);g.render();check('The bazooka is held high on the shoulder',g.snapshot.gunSocket.y>59);

 // Arcade food and score items: heal by the cabinet's shares, pay points at full health, ammunition refills the gun.
 g.start(0,0,'normal');ticks(100);g.test.move(222,M());g.test.damagePlayer(60);ticks(90);const hurt=g.snapshot.player.hp;g.test.drop('food',222,M(),'hamburger');ticks(2);
 check(`A hamburger restores 48 % of the bar (${Math.round(hurt)} → ${Math.round(g.snapshot.player.hp)})`,Math.round(g.snapshot.player.hp-hurt)===Math.round(g.snapshot.player.maxhp*.48));
 g.test.drop('food',222,M(),'steak');ticks(2);const score0=g.snapshot.score;g.test.drop('food',222,M(),'barbecue');ticks(2);check('A barbecue eaten at full health pays 10,000 points instead',g.snapshot.score-score0===10000&&g.snapshot.player.hp===g.snapshot.player.maxhp);
 g.test.drop('bonus',222,M(),'goldbar');ticks(2);check('A gold bar pays 10,000 points',g.snapshot.score-score0===20000);
 g.test.equip('rifle',1);g.test.drop('ammo',222,M(),'ammo');ticks(2);check('Ammunition refills the held gun',g.snapshot.player.ammo===6);
 check('Every container loot type is an arcade weapon or item',(()=>{g.start(0,0,'normal');return g.snapshot.objects.every(o=>['food','bonus','ammo','gun','rod','shotgun','uzi','grenade','rifle','club','m16','dynamite','bazooka','knife','torch','stone'].includes(o.content));})());
 // G5 (PLAN §7 5a, CAMPAIGN §5.4): WARDEN ROOK fights on BOSS_DEFS. His barrel is a breakable object rolling along his lane
 // (one shot breaks it); from 40 % the crane drops a crate from above the screen (y - z < view.y) that stays as a breakable
 // container; from 60 % the tide covers the front of the band and cannot be jumped (air:false).
 g.start(0,0,'story');ticks(5);g.test.spawnBoss();ticks(170);s=g.snapshot;let bi=s.enemies.findIndex(e=>e.boss);
 g.test.move(s.lock.left+40,g.test.lane(.5));g.test.equip('gun',6);s=g.snapshot;g.test.move(s.lock.left+40,s.enemies[bi].y);g.test.bossMove(bi,'barrel');let barrel=null;
 for(let i=0;i<120&&!barrel;i++){ticks(1);barrel=g.snapshot.objects.find(o=>o.boss&&o.type==='barrel'&&o.rolling&&o.hp>0);}
 if(barrel){key('KeyD',true);ticks(1);key('KeyD',false);for(let i=0;i<120;i++){const b=g.snapshot.objects.find(o=>o.boss&&o.type==='barrel'&&o.hp>0);if(!b||Math.abs(b.x-g.snapshot.player.x)<90)break;ticks(1);}g.controls.attack();for(let i=0;i<40&&g.snapshot.objects.some(o=>o.boss&&o.type==='barrel'&&o.hp>0);i++)ticks(1);}
 check('Rook rolls a barrel along his lane as a breakable object, and one shot breaks it',!!barrel&&barrel.hp===1&&!g.snapshot.objects.some(o=>o.boss&&o.type==='barrel'&&o.hp>0));
 s=g.snapshot;g.test.damageEnemy(bi,s.enemies[bi].hp-s.enemies[bi].maxhp*.39);g.test.bossMove(bi,'crane');let craneBox=null;
 for(let i=0;i<150&&!craneBox;i++){ticks(1);craneBox=g.snapshot.bossObjects.find(o=>o.type==='crate'&&o.falling);}
 const cy=craneBox?craneBox.y-craneBox.z:null,vy=g.snapshot.view.y;let landed=null;for(let i=0;i<120&&!landed;i++){ticks(1);landed=g.snapshot.objects.find(o=>o.boss&&o.type==='crate'&&!o.falling&&o.hp>0);}
 check(`From 40 % the crane drops a crate from above the screen (y - z ${cy==null?'?':cy.toFixed(0)} < view.y ${vy.toFixed(0)}) that stays as a breakable crate`,craneBox&&cy<vy&&!!landed);
 g.start(0,0,'story');ticks(5);g.test.spawnBoss();ticks(170);s=g.snapshot;bi=s.enemies.findIndex(e=>e.boss);g.test.damageEnemy(bi,s.enemies[bi].maxhp*.45);let tide=null;
 for(let i=0;i<300&&!tide;i++){ticks(1);tide=g.snapshot.zones.find(z=>z.style==='tide');}
 check('From 60 % the tide surges over the front of the band: a zone that cannot be jumped (air:false)',!!tide&&tide.air===false&&tide.band&&tide.band[1]>tide.band[0]);
 // The boss rebuild (stage 7): DR. ECHO's dish ring flies down her lane as its own sprite (echoring); at 0 HP she boards
 // the ECHO ENGINE (invulnerable), whose beam marks its lane during the glowing tell before it fires.
 g.start(6,0,'story');ticks(5);g.test.spawnBoss();ticks(170);s=g.snapshot;bi=s.enemies.findIndex(e=>e.boss);g.test.move(s.enemies[bi].x-150,s.enemies[bi].y);ticks(1);
 g.test.bossMove(bi,'ring');let ring=null;for(let i=0;i<120&&!ring;i++){ticks(1);ring=g.snapshot.bullets.find(b=>!b.friendly&&b.art&&b.art.key==='echoring:0');}
 check('Echo raises her dish and fires a ring down her lane (its own sprite)',!!ring&&Math.abs(ring.y-g.snapshot.enemies[bi].y)<1);
 g.test.damageEnemy(bi,99999);ticks(2);const eb=g.snapshot.enemies[bi];let ehurt=false;ticks(60);{const h=g.snapshot.enemies[bi].hp;g.test.damageEnemy(bi,40);ehurt=g.snapshot.enemies[bi].hp<h;}ticks(120);s=g.snapshot;
 check('At 0 HP Echo boards the ECHO ENGINE (invulnerable while boarding) and fights on in it',eb.state==='mutate'&&eb.phase===2&&!ehurt&&s.enemies[bi].name==='ECHO ENGINE'&&/^engine:/.test(s.enemies[bi].ba?.key||''));
 g.test.move(s.enemies[bi].x-150,s.enemies[bi].y);g.test.bossMove(bi,'beam');let lane=null,fired=false;for(let i=0;i<120&&!fired;i++){ticks(1);const z=g.snapshot.zones.find(z=>z.lane);if(z&&!lane)lane=z;if(g.snapshot.enemies[bi].jetT>0)fired=true;}
 check('The Engine marks its beam lane during the tell, then fires the sonic beam',!!lane&&fired);
 // Revision 3: no spillway wheels (the river never fights for the heroes); Crownback's plates break off in stages, the
 // shield arm cracking at 66 % (he wades out with a roar) and his guard collapsing at 33 % (x1.5 to the end).
 g.start(7,0,'story');ticks(5);g.test.spawnBoss();ticks(170);g.test.damageEnemy(0,99999);ticks(230);
 s=g.snapshot;let li=s.enemies.findIndex(e=>e.type==='fessenden'&&!e.dead);
 check('No spillway wheels in the Crownback fight',li>=0&&(s.wheels||[]).length===0);
 {const L0=g.snapshot.enemies[li];g.test.damageEnemy(li,L0.hp-L0.maxhp*.6);}ticks(8);const p1=g.snapshot.enemies[li];g.test.damageEnemy(li,p1.hp-p1.maxhp*.3);ticks(8);const p2=g.snapshot.enemies[li];
 check('Crownback changes phase in stages: wading out with a roar at 66 %, his guard broken (x1.5) at 33 %',p1.lot.mode==='wading'&&p1.ba?.key==='crownback:8'&&p2.lot.mode==='collapse'&&p2.vulnT>100);
 // Stage 3 (revision 3): HAULMASTER KRAG is human only, fought on foot when the convoy halts; beaten he is held (arrest).
 g.start(2,0,'story');ticks(5);g.test.spawnBoss();ticks(2);s=g.snapshot;bi=s.enemies.findIndex(e=>e.boss);
 check('Stage 3: the convoy halts at the boss and the gang fights HAULMASTER KRAG on foot',!s.driving&&s.enemies[bi]?.name==='HAULMASTER KRAG');
 ticks(170);g.test.damageEnemy(bi,99999);ticks(2);s=g.snapshot;const k0=s.enemies[bi];
 check('Beaten, Krag stays human: no trial dose, he is held (his hurt frame) and the stage clears',k0.type==='truck'&&k0.phase===1&&k0.defeat?.kind==='arrest'&&(()=>{let n=0;g.snapshot.enemies.forEach((e,j)=>{if(!e.boss&&!e.dead)g.test.damageEnemy(j,99999);});while(g.state!=='clear'&&n<600){ticks(1);n++;}return g.state==='clear';})());
 // Stage 5: IRONCLUB, Sable's shock captain (revision 3: two forms). He fights first as the ARMOURED CAPTAIN ('ironcap':
 // the haymaker, the double slam, the stomping charge); beaten, he sheds the armour (ironcap main 5 then ironclub main 9)
 // into the plated body ('ironclub'), rolls along his lane as a ball, then uncurls open (x1.5); beaten, he stays plated (held).
 g.start(4,0,'story');ticks(5);g.test.spawnBoss();ticks(2);s=g.snapshot;bi=s.enemies.findIndex(e=>e.boss);
 {const keys=new Set();for(let i=0;i<170;i++){ticks(1);const e=g.snapshot.enemies[bi];if(e?.ba)keys.add(e.ba.key);}s=g.snapshot;
  check(`Stage 5's boss is IRONCLUB, first in his armour on the captain's body (${[...keys].join(', ')})`,s.enemies[bi].type==='ironclub'&&s.enemies[bi].name==='IRONCLUB'&&s.enemies[bi].phase===1&&[...keys].some(k=>/^ironcap:/.test(k))&&![...keys].some(k=>/^ironclub:/.test(k)));}
 {g.test.damageEnemy(bi,99999);const keys=new Set();let inv=true;for(let i=0;i<200;i++){ticks(1);const e=g.snapshot.enemies[bi];if(e?.ba)keys.add(e.ba.key);if(i<120&&e.state==='mutate'&&!(e.inv>0))inv=false;}s=g.snapshot;
  check(`Beaten in his armour, he sheds it (the bursting plates, then the roar) and fights on as plated IRONCLUB (${[...keys].join(', ')})`,s.enemies[bi].phase===2&&!s.enemies[bi].dead&&inv&&[...keys].some(k=>/^ironclub:(serum|9)/.test(k))&&/^ironclub:/.test(s.enemies[bi].ba?.key||''));}
 g.test.move(s.enemies[bi].x-150,s.enemies[bi].y);g.test.bossMove(bi,'roll');let rolled=false,open=null;for(let i=0;i<200&&!open;i++){ticks(1);const e=g.snapshot.enemies[bi];if(e.state==='charge'&&e.ba?.key==='ironclub:5')rolled=true;if(rolled&&e.state==='recover'&&e.ba?.key==='ironclub:6')open=e;}
 check('Ironclub rolls along his lane as a ball, then uncurls open (x1.5)',rolled&&!!open&&open.vulnT>0&&open.vulnMul===1.5);
 ticks(60);g.test.damageEnemy(bi,99999);let n=0;while(g.state!=='clear'&&n<600){ticks(1);n++;}const kd=g.snapshot.enemies.find(e=>e.type==='ironclub');
 check('Beating Ironclub holds him (no dissolve, his defeat anim held) and clears the stage',g.state==='clear'&&(!kd||kd.defeat?.kind==='arrest'));
 // CAMPAIGN §8.4 / §10.4 ('lines.after; then clear'): a beaten boss's defeat script plays before the chapter clears. Since
 // the boss rebuild Cinder is beaten as Overdrive Cinder: he climbs out of his broken rig (the arrest script), his surrender
 // goes on the radio at 1.3 s, and only then does the clear panel come up (STORY.md: he talks).
 {g.start(3,0,'story');ticks(5);g.test.spawnBoss();ticks(170);g.test.clearFighters();ticks(60);const mid=g.state,c=g.snapshot.enemies.find(e=>e.type==='cinder');const melting=!!c&&c.defeat?.kind==='arrest'&&c.phase===2&&!c.defeat.done&&!c.dissolve&&c.flashMap!=='gel';
  let t=60;while(g.state!=='clear'&&t<180){ticks(1);t++;}const line=g.snapshot.radio;
  check(`A beaten boss's defeat script plays before the chapter clears (Overdrive Cinder climbs out of his rig and surrenders, no melt; clear after ${(t/60).toFixed(2)} s)`,mid==='play'&&melting&&g.state==='clear'&&t/60>=1.3-1e-6&&t/60<=1.8&&line===EDEN_CAMPAIGN[3].bossDefeat);}
 return out;
}).catch(e=>[{name:'Polish checks threw: '+e.message,passed:false}]);
checks.push({name:'No browser exceptions in polish checks',passed:errors.length===0});
fs.writeFileSync('tests/results/polish-report.json',JSON.stringify({passed:checks.filter(c=>c.passed).length,checks,errors},null,2));await browser.close();
for(const row of checks)console.log((row.skipped?'SKIP ':row.passed?'PASS ':'FAIL ')+row.name);
for(const row of checks)assert.ok(row.passed,row.name);assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({passed:checks.length,errors}));
})().catch(e=>{console.error(e);process.exit(1);});
