const {chromium,devices}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
fs.mkdirSync('tests/results',{recursive:true});
const BASE=process.env.GAME_URL||'http://127.0.0.1:8766';
// Mobile controls with real touch input (DevTools touch events): menus, thumb stick, buttons and layouts.
(async()=>{const browser=await chromium.launch({headless:true}),checks=[],errors=[];const check=(name,ok)=>checks.push({name,passed:!!ok});
for(const [name,vp] of [['portrait 390x844',{width:390,height:844}],['landscape 844x390',{width:844,height:390}],['small landscape 667x375',{width:667,height:375}]]){
 const ctx=await browser.newContext({...devices['Pixel 7'],viewport:vp,screen:vp});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(BASE);await p.waitForFunction(()=>window.SEQUEL_RENDER&&SEQUEL_RENDER.ready&&window.ARCADE_HEROES,null,{polling:100});
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
 check(`${name}: holding the stick walks the hero`,b.x-a.x>40&&!b.run); // arcade px (ARCHITECTURE §7)
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
// Fullscreen on touch devices: real fullscreen (Android/iPad) and the fill-the-screen fallback (iPhone Safari).
for(const [name,noApi] of [['fullscreen',false],['iPhone fallback fullscreen',true]]){
 const vp={width:844,height:390},ctx=await browser.newContext({...devices['Pixel 7'],viewport:vp,screen:vp}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 if(noApi)await p.addInitScript(()=>{delete Element.prototype.requestFullscreen;delete Element.prototype.webkitRequestFullscreen;});
 await p.goto(BASE);await p.waitForFunction(()=>window.SEQUEL_RENDER&&SEQUEL_RENDER.ready&&window.ARCADE_HEROES,null,{polling:100});
 const cdp=await ctx.newCDPSession(p),touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((pt,i)=>({x:pt.x,y:pt.y,id:pt.id??i}))});
 const tapSel=async sel=>{const r=await p.locator(sel).first().boundingBox();await touch('touchStart',[{x:r.x+r.width/2,y:r.y+r.height/2}]);await p.waitForTimeout(60);await touch('touchEnd',[]);await p.waitForTimeout(450);};
 await tapSel('#newgame');await tapSel('#begin');await tapSel('#enter-stage');await tapSel('#full');
 const st=await p.evaluate(()=>{const g=document.getElementById('game').getBoundingClientRect(),shown=e=>getComputedStyle(e).display!=='none';
   return {full:document.documentElement.classList.contains('is-full'),real:!!document.fullscreenElement,header:shown(document.querySelector('.masthead')),exit:shown(document.getElementById('full-exit')),gameH:g.height,innerH:innerHeight,
   fit:[...document.querySelectorAll('#game,#stick,[data-key],#full-exit')].filter(shown).every(e=>{const b=e.getBoundingClientRect();return b.top>=0&&b.left>=0&&b.bottom<=innerHeight+1&&b.right<=innerWidth+1;})};});
 check(`${name}: entering hides the header and fills the screen height`,st.full&&(noApi?!st.real:st.real)&&!st.header&&Math.abs(st.gameH-st.innerH)<2&&st.fit);
 check(`${name}: an exit button is shown`,st.exit);
 const sb=await p.locator('#stick').boundingBox(),x0=await p.evaluate(()=>LAST_EDEN.snapshot.player.x);await touch('touchStart',[{x:sb.x+sb.width*.75,y:sb.y+sb.height/2}]);await p.waitForTimeout(600);await touch('touchEnd',[]);
 check(`${name}: the stick still moves the hero`,await p.evaluate(x=>LAST_EDEN.snapshot.player.x-x>40,x0));
 await p.waitForTimeout(300);await tapSel('#pause');check(`${name}: the pause menu offers EXIT FULLSCREEN`,await p.evaluate(()=>document.getElementById('pause-full')?.textContent==='EXIT FULLSCREEN'));
 await tapSel('#pause-full');await p.waitForTimeout(300);await tapSel('#resume');await tapSel('#full');await tapSel('#full-exit');
 check(`${name}: the exit button restores the normal layout`,await p.evaluate(()=>!document.documentElement.classList.contains('is-full')&&!document.fullscreenElement&&getComputedStyle(document.querySelector('.masthead')).display!=='none'));
 await ctx.close();}
// The pause button is the only way to pause on touch: no stick or action button may cover it, in every layout, normal
// and fullscreen (G7 verify round 2: at the bottom right it sat under JUMP at 667x375 and 568x320). It also stays out
// of the cabinet HUD rows (arcade y 0-44 of 224). A real tap on its centre must pause the game.
for(const vp of [{width:390,height:844},{width:568,height:320},{width:667,height:375},{width:740,height:360},{width:844,height:390},{width:915,height:412}]){
 const ctx=await browser.newContext({...devices['Pixel 7'],viewport:vp,screen:vp}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(BASE);await p.waitForFunction(()=>window.SEQUEL_RENDER&&SEQUEL_RENDER.ready&&window.ARCADE_HEROES,null,{polling:100});
 const cdp=await ctx.newCDPSession(p),touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((pt,i)=>({x:pt.x,y:pt.y,id:pt.id??i}))});
 const tapSel=async sel=>{const r=await p.locator(sel).first().boundingBox();await touch('touchStart',[{x:r.x+r.width/2,y:r.y+r.height/2}]);await p.waitForTimeout(60);await touch('touchEnd',[]);await p.waitForTimeout(450);};
 await tapSel('#newgame');await tapSel('#begin');await tapSel('#enter-stage');
 for(const full of [false,true]){
  if(full)await tapSel('#full');
  const name=`${vp.width}x${vp.height}${full?' fullscreen':''}`;
  const st=await p.evaluate(()=>{const pb=document.getElementById('pause'),b=pb.getBoundingClientRect(),g=document.getElementById('game').getBoundingClientRect(),cx=(b.left+b.right)/2,cy=(b.top+b.bottom)/2,top=document.elementFromPoint(cx,cy);
    return {play:LAST_EDEN.state==='play',full:document.documentElement.classList.contains('is-full'),shown:getComputedStyle(pb).display!=='none'&&b.width>0,top:top&&(top.id||top.className||top.tagName),
     onScreen:b.left>=0&&b.top>=0&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1,clearOfHud:b.top>=g.top+g.height*44/224};});
  check(`${name}: the pause button is shown, on screen, below the HUD rows and topmost at its centre (top=${st.top})`,st.play&&st.full===full&&st.shown&&st.onScreen&&st.clearOfHud&&st.top==='pause');
  await tapSel('#pause');check(`${name}: a tap on the pause button pauses the game`,await p.evaluate(()=>LAST_EDEN.state==='paused'));
  if(await p.evaluate(()=>LAST_EDEN.state==='paused'))await tapSel('#resume');}
 await ctx.close();}
const d=await browser.newPage({viewport:{width:1280,height:900}});d.on('pageerror',e=>errors.push(e.message));await d.goto(BASE);await d.waitForFunction(()=>window.SEQUEL_RENDER&&SEQUEL_RENDER.ready,null,{polling:100});
check('Desktop keeps its layout: no touch controls, keyboard guide shown',await d.evaluate(()=>!document.documentElement.classList.contains('touch-ui')&&getComputedStyle(document.querySelector('.touch-controls')).display==='none'&&getComputedStyle(document.querySelector('.below')).display!=='none'));
check('No browser exceptions in mobile checks',errors.length===0);
fs.writeFileSync('tests/results/mobile-report.json',JSON.stringify({passed:checks.filter(c=>c.passed).length,checks,errors},null,2));await browser.close();
for(const row of checks)console.log((row.passed?'PASS ':'FAIL ')+row.name);
for(const row of checks)assert.ok(row.passed,row.name);console.log(JSON.stringify({passed:checks.length,errors}));
})().catch(e=>{console.error(e);process.exit(1);});
