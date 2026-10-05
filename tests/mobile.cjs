const {chromium,devices}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
fs.mkdirSync('tests/results',{recursive:true});
const BASE=process.env.GAME_URL||'http://127.0.0.1:8766';
// Mobile controls with real touch input (DevTools touch events): menus, thumb stick, buttons and layouts.
(async()=>{const browser=await chromium.launch({headless:true}),checks=[],errors=[];const check=(name,ok)=>checks.push({name,passed:!!ok});
for(const [name,vp] of [['portrait 390x844',{width:390,height:844}],['landscape 844x390',{width:844,height:390}],['small landscape 667x375',{width:667,height:375}]]){
 const ctx=await browser.newContext({...devices['Pixel 7'],viewport:vp,screen:vp});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(BASE);await p.waitForFunction(()=>window.SEQUEL_RENDER&&SEQUEL_RENDER.ready&&window.ARCADE_HEROES);
 const cdp=await ctx.newCDPSession(p),touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((pt,i)=>({x:pt.x,y:pt.y,id:pt.id??i}))});
 const box=sel=>p.locator(sel).first().boundingBox();
 // Tap the visible centre of a menu button with a real touch.
 const tapSel=async sel=>{const r=await box(sel);await touch('touchStart',[{x:r.x+r.width/2,y:r.y+r.height/2}]);await p.waitForTimeout(60);await touch('touchEnd',[]);await p.waitForTimeout(250);};
 check(`${name}: the touch layout is active`,await p.evaluate(()=>document.documentElement.classList.contains('touch-ui')));
 await tapSel('#newgame');await tapSel('#begin');await tapSel('#enter-stage');
 check(`${name}: menus can be tapped through to gameplay`,await p.evaluate(()=>LAST_EDEN.state==='play'));
 const st=await box('#stick'),cx=st.x+st.width/2,cy=st.y+st.height/2,R=st.width*.3;
 const P=()=>p.evaluate(()=>{const v=LAST_EDEN.snapshot.player;return {x:v.x,y:v.y,dir:v.dir,run:v.run};});
 let a=await P();await touch('touchStart',[{x:cx+R*.6,y:cy,id:1}]);await p.waitForTimeout(700);let b=await P();
 check(`${name}: holding the stick walks the hero`,b.x-a.x>60&&!b.run);
 await touch('touchMove',[{x:cx-R*.6,y:cy,id:1}]);await p.waitForTimeout(500);check(`${name}: sliding the thumb to the other side turns the hero`,(await P()).dir===-1);
 await touch('touchMove',[{x:cx+R*.6,y:cy-R*.6,id:1}]);a=await P();await p.waitForTimeout(400);b=await P();check(`${name}: diagonals move along both axes`,b.x>a.x&&b.y<a.y);
 await touch('touchMove',[{x:cx+R*1.2,y:cy,id:1}]);await p.waitForTimeout(200);check(`${name}: pushing the stick to its rim runs`,(await P()).run);
 const at=await box('[data-key="KeyJ"]');await touch('touchMove',[{x:cx+R*.6,y:cy,id:1},{x:at.x+at.width/2,y:at.y+at.height/2,id:2}]);await p.waitForTimeout(80);
 check(`${name}: a second finger attacks while moving, with pressed feedback`,await p.evaluate(()=>!!LAST_EDEN.snapshot.player.attack&&document.querySelector('[data-key="KeyJ"]').classList.contains('held')));
 await touch('touchEnd',[]);await p.waitForTimeout(150);const c=await P();await p.waitForTimeout(300);check(`${name}: releasing the stick stops the hero`,Math.abs((await P()).x-c.x)<1);
 const jb=await box('[data-key="KeyK"]');await touch('touchStart',[{x:jb.x+jb.width/2,y:jb.y+jb.height/2}]);await p.waitForTimeout(80);await touch('touchEnd',[]);await p.waitForTimeout(60);
 check(`${name}: the jump button jumps`,await p.evaluate(()=>LAST_EDEN.snapshot.player.z>0));
 const lay=await p.evaluate(()=>{const fit=[...document.querySelectorAll('#game,#stick,[data-key]')].every(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.top>=0&&r.left>=0&&r.bottom<=innerHeight+1&&r.right<=innerWidth+1;});const g=document.getElementById('game').getBoundingClientRect(),j=document.querySelector('[data-key="KeyJ"]').getBoundingClientRect();
   return {fit,noScroll:document.documentElement.scrollHeight<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1,canvasW:g.width,btn:j.width};});
 check(`${name}: playfield and controls fit without scrolling`,lay.fit&&lay.noScroll);
 check(`${name}: the playfield is at least 370 px wide and the attack button at least 64 px`,lay.canvasW>=370&&lay.btn>=64);
 await p.screenshot({path:`tests/results/mobile-${name.split(' ')[0]}-${vp.width}.png`});await ctx.close();}
const d=await browser.newPage({viewport:{width:1280,height:900}});d.on('pageerror',e=>errors.push(e.message));await d.goto(BASE);await d.waitForFunction(()=>window.SEQUEL_RENDER&&SEQUEL_RENDER.ready);
check('Desktop keeps its layout: no touch controls, keyboard guide shown',await d.evaluate(()=>!document.documentElement.classList.contains('touch-ui')&&getComputedStyle(document.querySelector('.touch-controls')).display==='none'&&getComputedStyle(document.querySelector('.below')).display!=='none'));
check('No browser exceptions in mobile checks',errors.length===0);
fs.writeFileSync('tests/results/mobile-report.json',JSON.stringify({passed:checks.filter(c=>c.passed).length,checks,errors},null,2));await browser.close();
for(const row of checks)console.log((row.passed?'PASS ':'FAIL ')+row.name);
for(const row of checks)assert.ok(row.passed,row.name);console.log(JSON.stringify({passed:checks.length,errors}));
})().catch(e=>{console.error(e);process.exit(1);});
