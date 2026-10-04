const {chromium}=require('playwright');
const fs=require('node:fs');
fs.mkdirSync('tests/results',{recursive:true});
(async()=>{const browser=await chromium.launch({headless:true}),page=await browser.newPage(),results=[];
await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;let seed=15454;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};});
await page.goto('http://127.0.0.1:8766');await page.click('#sound');
for(let level=0;level<6;level++){
 const result=await page.evaluate(level=>{const g=LAST_EDEN;g.start(level,0,'story');const held=new Set();
 function key(code,on){if(on!==held.has(code)){window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));on?held.add(code):held.delete(code);}}
 let n=0,minhp=1000;
 // No teleports, direct damage, health changes, or completion helpers.
 for(;n<30000&&g.state==='play';n++){
  const s=g.snapshot,v=s.player;minhp=Math.min(minhp,v.hp);const targets=s.enemies.filter(e=>!e.dead&&e.state!=='flee');
  targets.sort((a,b)=>Math.hypot(a.x-v.x,a.y-v.y)-Math.hypot(b.x-v.x,b.y-v.y));
  const task=s.mission.active,e=targets[0],taskFirst=task&&(targets.length===0||task.bossTask||level===1);
  let dx=1,dy=0,fight=false,operate=false;
  if(taskFirst){const dd=task.x-v.x;dx=Math.abs(dd)>(level===1?30:task.kind==='beacon'?48:18)?Math.sign(dd):0;dy=Math.abs(task.y-v.y)>8?Math.sign(task.y-v.y):0;
   if(task.kind==='beacon'){if(Math.abs(dd)<70&&Math.abs(task.y-v.y)<25){fight=true;if(Math.sign(dd)!==v.dir)dx=Math.sign(dd);}}
   else if(task.kind==='tuner'){operate=dx===0&&dy===0&&n%8===0;}
   else operate=dx===0&&dy===0;
  }else if(e){const dd=e.x-v.x,range=level===1?45:v.weapon&&['gun','uzi','rifle','m16','shotgun','bazooka'].includes(v.weapon)?180:48;
   dx=Math.abs(dd)>range?Math.sign(dd):Math.sign(dd)!==v.dir?Math.sign(dd):0;dy=Math.abs(e.y-v.y)>7?Math.sign(e.y-v.y):0;
   fight=Math.abs(dd)<range+12&&Math.abs(e.y-v.y)<26;
   if(e.state==='windup'&&Math.abs(dd)<130&&v.z===0&&n%8===0)g.controls.jump();
   if(targets.filter(t=>Math.hypot(t.x-v.x,t.y-v.y)<120).length>1&&v.hp>25&&v.specialCd<=0)g.controls.special();
  }
  key('KeyD',dx>0);key('KeyA',dx<0);key('KeyW',dy<0);key('KeyS',dy>0);key('KeyJ',fight);key('KeyE',operate);
  if(!taskFirst&&v.weapon&&v.ammo===0)g.controls.pickup();
  g.step(.033);
 }
 for(const k of held)window.dispatchEvent(new KeyboardEvent('keyup',{code:k,bubbles:true}));
 return {level:level+1,state:g.state,frames:n,seconds:Math.round(n*.033),wave:g.snapshot.wave,lives:g.snapshot.lives,minhp,mission:g.snapshot.mission,remaining:g.snapshot.enemies.filter(e=>!e.dead).map(e=>({type:e.type,hp:e.hp,x:e.x})),x:g.snapshot.player.x};
 },level);results.push(result);
}
fs.writeFileSync('tests/results/bot-report.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));await browser.close();if(results.some(r=>r.state!=='clear'))throw new Error('A chapter did not complete');
})().catch(e=>{console.error(e);process.exit(1);});
