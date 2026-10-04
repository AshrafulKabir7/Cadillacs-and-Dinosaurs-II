const {chromium}=require('playwright');
const fs=require('fs');
require('node:fs').mkdirSync('tests/results',{recursive:true});
(async()=>{const b=await chromium.launch({headless:true});const p=await b.newPage();await p.addInitScript(()=>{let seed=15454;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};});await p.goto('http://127.0.0.1:8766');await p.click('#sound');const results=[];
 for(let level=0;level<6;level++){
  const result=await p.evaluate(level=>{const g=LAST_EDEN;g.start(level,0,'story');const held=new Set();function key(k,on){if(on&&!held.has(k)){window.dispatchEvent(new KeyboardEvent('keydown',{code:k,bubbles:true}));held.add(k);}if(!on&&held.has(k)){window.dispatchEvent(new KeyboardEvent('keyup',{code:k,bubbles:true}));held.delete(k);}}
   let n=0,minhp=1000;for(;n<22000&&g.state==='play';n++){const s=g.snapshot,v=s.player;minhp=Math.min(minhp,v.hp);const targets=s.enemies.filter(e=>!e.dead);targets.sort((a,b)=>Math.hypot(a.x-v.x,a.y-v.y)-Math.hypot(b.x-v.x,b.y-v.y));const e=targets[0];let dx=1,dy=0;if(e){const dd=e.x-v.x,range=level===1?45:v.weapon==='gun'?190:43;dx=Math.abs(dd)>range?Math.sign(dd):(Math.sign(dd)===v.dir?0:Math.sign(dd));dy=Math.abs(e.y-v.y)>7?Math.sign(e.y-v.y):0;if(e.state==='windup'&&Math.abs(dd)<130&&v.z===0&&n%8===0)g.controls.jump();if(targets.filter(t=>Math.hypot(t.x-v.x,t.y-v.y)<120).length>1&&v.hp>25&&v.specialCd<=0)g.controls.special();}
    key('KeyD',dx>0);key('KeyA',dx<0);key('KeyW',dy<0);key('KeyS',dy>0);key('KeyJ',!!e);if(n%30===0)g.controls.pickup();g.step(.033);}
   for(const k of held)window.dispatchEvent(new KeyboardEvent('keyup',{code:k,bubbles:true}));return {level:level+1,state:g.state,frames:n,seconds:Math.round(n*.033),wave:g.snapshot.wave,lives:g.snapshot.lives,minhp,remaining:g.snapshot.enemies.filter(e=>!e.dead).map(e=>({type:e.type,hp:e.hp,x:e.x})),x:g.snapshot.player.x};},level);
  results.push(result);
 }
 console.log(JSON.stringify(results,null,2));fs.writeFileSync('tests/results/bot-report.json',JSON.stringify(results,null,2));await b.close();if(results.some(r=>r.state!=='clear'))throw new Error('A chapter did not complete');})().catch(e=>{console.error(e);process.exit(1);});
