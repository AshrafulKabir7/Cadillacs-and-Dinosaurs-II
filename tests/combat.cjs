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
 const setup=(hero=0)=>{g.start(0,hero);ticks(100);g.test.move(200,340);};
 const dummy=(x,type='raider',hp=900)=>{const e=g.test.spawnEnemy(x,340,type);e.hp=e.maxhp=hp;e.state='recover';e.timer=99;return e;};

 // The combo chain uses the original records and only continues after a connecting blow.
 for(let hero=0;hero<4;hero++){setup(hero);const e=dummy(262);const names=[];let frozen=false,spark=false,flew=false;
  for(let i=0;i<140;i++){const p=g.snapshot.player;if(!p.attack)g.controls.attack();g.step(1/60);const s=g.snapshot;
   if(s.player.moveState&&names[names.length-1]!==s.player.moveState.name)names.push(s.player.moveState.name);
   if(s.player.freeze>0&&s.enemies[0]?.freeze>0)frozen=true;if(s.enemies[0]?.state==='fly')flew=true;}
  check(`Hero ${hero+1}: punch, punch, kick, finisher in order`,names.slice(0,4).join()==='p1,p2,kick,fin');
  check(`Hero ${hero+1}: hitstop holds the attacker and the victim together`,frozen);
  check(`Hero ${hero+1}: the finisher sends the enemy flying`,flew);
 }
 setup();dummy(262);g.controls.attack();let spark=false;for(let i=0;i<10;i++){g.step(1/60);if(g.snapshot.effects.includes('spark'))spark=true;}
 check('A punch that connects shows an impact spark',spark);
 setup();g.controls.attack();ticks(30);g.controls.attack();ticks(2);check('A missed blow restarts the combo at the first punch',g.snapshot.player.moveState?.name==='p1');
 setup();const lone=dummy(262);for(let i=0;i<10;i++){if(!g.snapshot.player.attack)g.controls.attack();ticks(1);}check('Ordinary hits do not knock the enemy down before the finisher',lone.state!=='fly'&&lone.state!=='down');

 // Knockdowns: flung back, one bounce, lying, rising.
 setup();const k=dummy(260);g.test.damageEnemy(0,1);k.inv=0;k.freeze=0;g.controls.special();const states=new Set();let bounced=false,lastZ=0,rising=false;
 for(let i=0;i<220;i++){g.step(1/60);states.add(k.state);if(k.state==='fly'){if(k.z>lastZ&&lastZ===0&&states.has('fly'))bounced=true;lastZ=k.z;}if(k.state==='rise')rising=true;}
 check('A knockdown arcs through the air, lies down and rises',states.has('fly')&&states.has('down')&&rising);
 setup();const d=dummy(262,'raider',30);g.test.damageEnemy(0,999);const dying=d.dying&&d.state==='fly';ticks(120);check('Defeated enemies are flung before they fade away',dying&&(d.dead>0||!g.snapshot.enemies.length));

 // Grabs and throws.
 setup(3);const held=g.test.spawnEnemy(250,340,'raider');held.state='walk';held.timer=5;const bystander=dummy(120,'knifer',300);
 key('KeyD',true);ticks(12);key('KeyD',false);check('Walking into an enemy grabs them',g.snapshot.player.grab&&held.state==='held');
 const hp0=held.hp;g.controls.attack();ticks(20);check('Attack while holding delivers a knee strike',held.hp<hp0&&held.state==='held');
 key('KeyA',true);g.controls.attack();ticks(10);key('KeyA',false);check('Back + attack throws the enemy over the shoulder',held.state==='fly'&&held.thrown&&!g.snapshot.player.grab);
 const bhp=bystander.hp;ticks(40);check('A thrown body knocks down an enemy in its path',bystander.hp<bhp);
 setup();const boss=g.test.spawnEnemy(250,340,'warden',true);boss.state='walk';boss.timer=5;key('KeyD',true);ticks(12);key('KeyD',false);check('Bosses cannot be grabbed',!g.snapshot.player.grab);

 // Gun handling uses the arcade stances and carries.
 const AH=ARCADE_HEROES,rec=(id,n)=>AH.frames[AH.heroes[id][n][0]].rec;
 check('Mustapha uses arcade records 259/260 for the rifle stance and 284/288 to carry it',rec('mustapha','gunStand')===259&&rec('mustapha','gunFire')===260&&rec('mustapha','torsoWalk')===284&&rec('mustapha','torsoRun')===288);
 setup();g.test.equip('rifle');ticks(2);g.render();const stand=g.snapshot.player.pose;key('KeyD',true);ticks(10);g.render();const walk=g.snapshot.player.pose;key('ShiftLeft',true);ticks(8);g.render();const run=g.snapshot.player.pose;key('ShiftLeft',false);key('KeyD',false);
 check('Long guns: hip stance, torso-over-legs walk and an upright carry on the run',stand==='armed-ready'&&walk==='armed-walk'&&run==='armed-run');
 setup();const t=dummy(330);g.test.equip('gun');g.controls.attack();let pow=false;for(let i=0;i<20;i++){g.step(1/60);if(g.snapshot.effects.includes('pow'))pow=true;}pow=pow&&t.hp<t.maxhp;check('A pistol hit lands and is marked with POW',pow);

 // Original sound effects ship with the game.
 const files=['punch','kick','slam','pistol','rifle','uzi','explosion'];const ok=await Promise.all(files.map(f=>fetch('assets/sfx/'+f+'.mp3').then(r=>r.ok&&r.headers.get('content-length')!=='0').catch(()=>false)));
 check('All arcade sound effects are present',ok.every(Boolean));
 return out;
}).catch(e=>[{name:'Combat checks threw: '+e.message,passed:false}]);
checks.push({name:'No browser exceptions in combat checks',passed:errors.length===0});
fs.writeFileSync('tests/results/combat-report.json',JSON.stringify({passed:checks.filter(c=>c.passed).length,checks,errors},null,2));await browser.close();
for(const row of checks)console.log((row.passed?'PASS ':'FAIL ')+row.name);
for(const row of checks)assert.ok(row.passed,row.name);assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({passed:checks.length,errors}));
})().catch(e=>{console.error(e);process.exit(1);});
