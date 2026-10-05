/* Original environment and boss atlases. Playable heroes and regular enemy art stay unchanged. */
(() => {
  const landscape=new Image(),bossAtlas=new Image();
  landscape.src=SEQUEL_ART.environment;bossAtlas.src=SEQUEL_ART.bosses;
  const bossFrames={};let ready=false;
  bossAtlas.onload=()=>{
    // Extract the eight disconnected transparent sprites, even where their bounding boxes overlap.
    const c=document.createElement('canvas');c.width=bossAtlas.width;c.height=bossAtlas.height;
    const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(bossAtlas,0,0);
    const {data}=g.getImageData(0,0,c.width,c.height),seen=new Uint8Array(c.width*c.height),queue=new Int32Array(seen.length),parts=[];
    for(let p=0;p<seen.length;p++){
      if(seen[p]||data[p*4+3]<24)continue;
      let head=0,tail=1,minX=c.width,minY=c.height,maxX=0,maxY=0;queue[0]=p;seen[p]=1;
      while(head<tail){const at=queue[head++],x=at%c.width,y=Math.floor(at/c.width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for(const n of [x>0?at-1:-1,x<c.width-1?at+1:-1,y>0?at-c.width:-1,y<c.height-1?at+c.width:-1])if(n>=0&&!seen[n]&&data[n*4+3]>=24){seen[n]=1;queue[tail++]=n;}}
      if(tail<6000)continue;
      const part=document.createElement('canvas');part.width=maxX-minX+1;part.height=maxY-minY+1;const pg=part.getContext('2d'),pixels=pg.createImageData(part.width,part.height);
      for(let i=0;i<tail;i++){const at=queue[i],target=((Math.floor(at/c.width)-minY)*part.width+(at%c.width-minX))*4;pixels.data.set(data.subarray(at*4,at*4+4),target);}
      pg.putImageData(pixels,0,0);parts.push({image:part,x:minX,y:minY});
    }
    parts.sort((a,b)=>(Math.floor((a.y+80)/512)-Math.floor((b.y+80)/512))||a.x-b.x);
    ['warden','cinder','echo','sable'].forEach((name,i)=>{if(parts[i]&&parts[i+4])bossFrames[name]=[parts[i].image,parts[i+4].image];});
    ready=Object.keys(bossFrames).length===4;
  };
  const colors=['#244453','#596569','#244d3d','#463b30','#25374a','#7a7658'];
  function scene(g,index,camera,time){
    g.fillStyle=colors[index];g.fillRect(0,0,768,432);if(!landscape.complete||!landscape.naturalWidth)return;
    const col=index%2,row=Math.floor(index/2),pw=landscape.width/2,ph=landscape.height/3;
    const sx=col*pw,sy=row*ph,pan=camera*.05,first=Math.floor(pan/948);
    g.imageSmoothingEnabled=false;
    // The distant layer keeps drifting across long chapters; alternate copies are mirrored so the seams match.
    for(let k=first;k<=first+1;k++){g.save();g.translate(Math.round(k*948-pan+(k%2?948:0)),68);if(k%2)g.scale(-1,1);g.drawImage(landscape,sx,sy,pw,ph*.76,0,0,948,216);g.restore();}
    const shift=camera%768;
    for(let x=-shift,i=Math.floor(camera/768);x<768;x+=768,i++){
      g.save();g.translate(x+(i%2?768:0),284);if(i%2)g.scale(-1,1);
      g.drawImage(landscape,sx,sy+ph*.79,pw,ph*.205,0,0,768,148);g.restore();
    }
    g.fillStyle='#09141933';g.fillRect(0,279,768,7);
    if(index===0||index===4){g.strokeStyle='#badbea33';g.lineWidth=1;for(let i=0;i<42;i++){const x=(i*97-time*80-camera*.15)%850,y=(i*53+time*170)%400+68;g.beginPath();g.moveTo(x,y);g.lineTo(x-5,y+13);g.stroke();}}
    if(index===2||index===3){g.fillStyle=index===2?'#d8ed9177':'#ffc47588';for(let i=0;i<22;i++){const x=(i*83+Math.sin(time+i)*9-camera*.22)%800,y=260-((time*(index===3?27:8)+i*19)%175);g.fillRect(x,y,2,2);}}
  }
  function boss(g,e,x,y){
    const frames=bossFrames[e.type];if(!frames)return false;
    const attack=['windup','charge'].includes(e.state)||e.strikeFlash>0;
    const im=frames[attack?1:0],height=e.type==='cinder'?139:126,scale=height/frames[0].height;
    const bob=e.moving?Math.sin(e.anim*13)*1.5:Math.sin(e.anim*3)*.6;
    g.save();g.translate(Math.round(x),Math.round(y+bob));g.scale(-e.dir,1);
    if(e.dead||e.state==='down'){g.translate(0,-12);g.rotate(-1.25);}
    if(e.hurt>0)g.filter='brightness(1.5)';
    g.drawImage(im,-im.width*scale*.5,-im.height*scale,im.width*scale,im.height*scale);g.restore();return true;
  }
  window.SEQUEL_RENDER={scene,boss,get ready(){return ready&&landscape.complete;},get bossCount(){return Object.keys(bossFrames).length;}};
})();
