const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
fs.mkdirSync('tests/results',{recursive:true});
const BASE=process.env.GAME_URL||'http://127.0.0.1:8766';
// Arcade feel: original combo frames, hitstop, sparks, knockdown flight, grabs and throws, gun stances and sounds.
(async()=>{const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;let seed=77;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};});
await page.goto(BASE);await page.waitForFunction(()=>SEQUEL_RENDER.ready&&window.ARCADE_HEROES);await page.click('#sound');
const checks=await page.evaluate(async()=>{
 const g=LAST_EDEN,out=[];const check=(name,value)=>out.push({name,passed:!!value});
 const ticks=n=>{for(let i=0;i<n;i++)g.step(1/60);},key=(code,on)=>window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));
 // Arcade px (ARCHITECTURE §7): M is the middle of the feet band.
 const M=()=>g.snapshot.band.mid;
 const setup=(hero=0)=>{g.start(0,hero);ticks(100);g.test.move(148,M());};
 const dummy=(x,type='raider',hp=900)=>{const e=g.test.spawnEnemy(x,M(),type);e.hp=e.maxhp=hp;e.state='recover';e.timer=99;return e;};

 // The combo chain uses the original records and only continues after a connecting blow.
 for(let hero=0;hero<4;hero++){setup(hero);const e=dummy(194);const names=[];let frozen=false,spark=false,flew=false;
  for(let i=0;i<140;i++){const p=g.snapshot.player;if(!p.attack)g.controls.attack();g.step(1/60);const s=g.snapshot;
   if(s.player.moveState&&names[names.length-1]!==s.player.moveState.name)names.push(s.player.moveState.name);
   if(s.player.freeze>0&&s.enemies[0]?.freeze>0)frozen=true;if(s.enemies[0]?.state==='fly')flew=true;}
  check(`Hero ${hero+1}: punch, punch, kick, finisher in order`,names.slice(0,4).join()==='p1,p2,kick,fin');
  check(`Hero ${hero+1}: hitstop holds the attacker and the victim together`,frozen);
  check(`Hero ${hero+1}: the finisher sends the enemy flying`,flew);
 }
 setup();dummy(194);g.controls.attack();let spark=false;for(let i=0;i<10;i++){g.step(1/60);if(g.snapshot.effects.includes('spark'))spark=true;}
 check('A punch that connects shows an impact spark',spark);
 setup();g.controls.attack();ticks(30);g.controls.attack();ticks(2);check('A missed blow restarts the combo at the first punch',g.snapshot.player.moveState?.name==='p1');
 setup();const lone=dummy(194);for(let i=0;i<10;i++){if(!g.snapshot.player.attack)g.controls.attack();ticks(1);}check('Ordinary hits do not knock the enemy down before the finisher',lone.state!=='fly'&&lone.state!=='down');

 // Knockdowns: flung back, one bounce, lying, rising.
 setup();const k=dummy(192);g.test.damageEnemy(0,1);k.inv=0;k.freeze=0;g.controls.special();const states=new Set();let bounced=false,lastZ=0,rising=false;
 for(let i=0;i<220;i++){g.step(1/60);states.add(k.state);if(k.state==='fly'){if(k.z>lastZ&&lastZ===0&&states.has('fly'))bounced=true;lastZ=k.z;}if(k.state==='rise')rising=true;}
 check('A knockdown arcs through the air, lies down and rises',states.has('fly')&&states.has('down')&&rising);
 setup();const d=dummy(194,'raider',30);g.test.damageEnemy(0,999);const dying=d.dying&&d.state==='fly';ticks(120);check('Defeated enemies are flung before they fade away',dying&&(d.dead>0||!g.snapshot.enemies.length));

 // Grabs and throws.
 setup(3);const held=g.test.spawnEnemy(185,M(),'raider');held.state='walk';held.timer=5;const bystander=dummy(89,'knifer',300);
 key('KeyD',true);ticks(12);key('KeyD',false);check('Walking into an enemy grabs them',g.snapshot.player.grab&&held.state==='held');
 const hp0=held.hp;g.controls.attack();ticks(20);check('Attack while holding delivers a knee strike',held.hp<hp0&&held.state==='held');
 // The grab throw lets go on its ROM release frame (HEROES §6.4: Mess 31 f; PLAN §7 G3c).
 key('KeyA',true);g.controls.attack();ticks(40);key('KeyA',false);check('Back + attack throws the enemy over the shoulder',held.state==='fly'&&held.thrown&&!g.snapshot.player.grab);
 const bhp=bystander.hp;ticks(40);check('A thrown body knocks down an enemy in its path',bystander.hp<bhp);
 setup();const boss=g.test.spawnEnemy(185,M(),'warden',true);boss.state='walk';boss.timer=5;key('KeyD',true);ticks(12);key('KeyD',false);check('Bosses cannot be grabbed',!g.snapshot.player.grab);
 // G5 (ENEMIES §6.1 DECISION, CFG.bossKnockdown): a boss with hit sets is knocked down by a finisher, at most once per 4 s
 // (WARDEN ROOK, its BUTCHER hit set 2 then get-up 4); MACK, the Regent, the Crown Engine and LOT 00 are exempt.
 {g.start(0,0,'easy');g.test.spawnBoss();ticks(170);const downs=[];let last='',lost=0;
  for(let k=0;k<1200;k++){const s=g.snapshot,i=s.enemies.findIndex(e=>e.boss&&!e.dead),e=s.enemies[i];if(!e)break;const p=s.player;
   if(Math.abs(p.x-e.x)>36||Math.abs(p.y-e.y)>4)g.test.move(e.x+(p.x<e.x?-32:32),e.y);if(k%5===0)g.controls.attack();if(e.hp<e.maxhp*.3)g.test.damageEnemy(i,-(e.maxhp*.5));
   const h0=e.hp;g.step(1/60);const e2=g.snapshot.enemies.find(x=>x.boss&&!x.dead);if(e2){lost+=Math.max(0,h0-e2.hp);if(e2.state==='down'&&last!=='down')downs.push(k/60);last=e2.state;}}
  const gap=downs.length>1?Math.min(...downs.slice(1).map((t,j)=>t-downs[j])):null;
  check(`A combo finisher knocks a boss down, at most once per 4 s (${downs.length} downs, closest ${gap==null?'-':gap.toFixed(2)} s apart)`,lost>0&&downs.length>=2&&gap>=4-1e-6);}

 // Gun handling uses the arcade stances and carries.
 // ROM clips by role (HEROES §10.2), and the record the game really draws once the rifle is in hand (PLAN §7 G3a).
 const RA=ROM_HEROES.hero.mustapha.anim;setup(0);g.test.equip('rifle');g.render();const liveRec=g.snapshot.player.anim&&g.snapshot.player.anim.rec;
 check('Mustapha uses arcade records 259/260 for the rifle stance and fire, 284/288 to carry it, and stands on 259 in game',RA['stand.rifle'].f[0][0]===259&&RA['attack.rifle'].f.map(f=>f[0]).join()==='259,260'&&RA['walkTorso.rifle'].f[0][0]===284&&RA['runTorso.guns'].f[0][0]===288&&liveRec===259);
 setup();g.test.equip('rifle');ticks(2);g.render();const stand=g.snapshot.player.pose;key('KeyD',true);ticks(10);g.render();const walk=g.snapshot.player.pose;key('ShiftLeft',true);ticks(8);g.render();const run=g.snapshot.player.pose;key('ShiftLeft',false);key('KeyD',false);
 check('Long guns: hip stance, torso-over-legs walk and a horizontal carry on the run',stand==='armed-ready'&&walk==='armed-walk'&&run==='armed-run');
 setup();const t=dummy(244);g.test.equip('gun');g.controls.attack();let pow=false;for(let i=0;i<20;i++){g.step(1/60);if(g.snapshot.effects.includes('pow'))pow=true;}pow=pow&&t.hp<t.maxhp;check('A pistol hit lands and is marked with POW',pow);

 // Original sound effects ship with the game: served over http (fetch), and on disk (checked in Node below, which is
 // also the whole check from file://, where fetch() of a local file always fails; ARCHITECTURE §5.1).
 if(location.protocol!=='file:'){const files=['punch','kick','slam','pistol','rifle','uzi','explosion'];const ok=await Promise.all(files.map(f=>fetch('assets/sfx/'+f+'.mp3').then(r=>r.ok&&r.headers.get('content-length')!=='0').catch(()=>false)));
 check('All arcade sound effects are present (served over http)',ok.every(Boolean));}
 return out;
}).catch(e=>[{name:'Combat checks threw: '+e.message,passed:false}]);
checks.push({name:'All arcade sound effects are present on disk (assets/sfx, non-empty)',passed:['punch','kick','slam','pistol','rifle','uzi','explosion'].every(f=>{try{return fs.statSync('assets/sfx/'+f+'.mp3').size>0;}catch(e){return false;}})});
checks.push({name:'No browser exceptions in combat checks',passed:errors.length===0});
fs.writeFileSync('tests/results/combat-report.json',JSON.stringify({passed:checks.filter(c=>c.passed).length,checks,errors},null,2));await browser.close();
for(const row of checks)console.log((row.passed?'PASS ':'FAIL ')+row.name);
for(const row of checks)assert.ok(row.passed,row.name);assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({passed:checks.length,errors}));
})().catch(e=>{console.error(e);process.exit(1);});
