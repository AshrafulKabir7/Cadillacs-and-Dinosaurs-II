/* SEQUEL_RENDER: the readiness facade every suite waits on (ARCHITECTURE §5.4, PLAN §4.6 and RC11). The stages are
   STAGE_RENDER pages (stage-render.js, stage-data.js, since G2) and the bosses are their ROM bodies (ROM_BOSSES,
   sprite-data-bosses.js, drawn by game.js on BOSS_DEFS since G5): the generated boss canvases of SEQUEL_ART.bosses are gone. */
(() => {
  let latched=false,artState=0;   // boss art preload: 0 not started, 1 loading, 2 done
  const heroRigReady=()=>{const R=window.HeroRig;if(!R)return true;const r=typeof R.ready==='function'?R.ready():R.ready;return r!==false;};
  window.SEQUEL_RENDER={
    // Sprites decoded and verified (every family, the bosses included), the hero rig and chapter 1's first two screens of
    // stage pages (STAGE_RENDER.ready starts the load). Latched once true, so reading it later (snapshot.artReady) never
    // reorders the two-chapter page cache by re-requesting chapter 1.
    get ready(){
      if(latched)return true;
      const S=window.SPRITES,R=window.STAGE_RENDER;
      // ...and the boss art of every chapter (lazy sheets): fetched in the background once the start-up sprites are
      // ready, so the title and the menu never wait for it; only this flag (attract mode, the suites) does
      const ok=!!S&&S.ready&&S.verified&&heroRigReady()&&!!R&&R.ready('ch1')&&this.artReady();
      if(ok)latched=true;return ok;
    },
    // Every BOSS_DEFS body (a second form's phase2.body too) and the Crown Engine bake (PLAN §4.6); bossCount counts the
    // ones that ship. The rebuilt bosses' bodies are generated (sprite-data-boss-*.js), the others ROM bodies.
    get bossRoster(){return window.BOSS_DEFS?Object.values(BOSS_DEFS).flatMap(b=>[b.body,b.phase2&&b.phase2.body]).filter(Boolean).concat(['crownEngine']):[];},
    get bossCount(){const S=window.SPRITES;return S&&typeof S.has==='function'?this.bossRoster.filter(id=>S.has('bosses',id)).length:0;},
    // the chapter's stage pages and its boss art (the lazy sheets of its bosses' generated bodies: BOSS_DEFS body, phase2
    // body, jet / fx effects and `art`; chapter 6 is Sable's fight and CROWNBACK's)
    get artState(){return artState;},
    artReady(){const S=window.SPRITES;if(!S||typeof S.loadSheets!=='function')return true;if(artState===0&&S.ready)this.preloadArt();return artState===2;},
    preloadArt(){if(artState!==0)return;artState=1;Promise.all([0,1,2,3,4,5].map(i=>this.bossArt(i))).then(()=>{artState=2;});},
    loadChapter(i){const st=window.STAGE_RENDER?STAGE_RENDER.require(i):Promise.resolve(0);return Promise.all([st,this.bossArt(i)]).then(r=>r[0]);},
    bossArtIds(i){const C=window.EDEN_CAMPAIGN,D=window.BOSS_DEFS;if(!C||!D||!C[i])return [];const ids=[];
      const add=b=>{if(typeof b==='string'&&!ids.includes(b))ids.push(b);};
      const scan=d=>{if(!d)return;[d.body,d.jet,d.fx].forEach(add);if(Array.isArray(d.art))d.art.forEach(add);for(const m of Object.values(d.moves||{}))if(m)add(m.projBody);};
      for(const k of [C[i].kind].concat(i===5?['fessenden']:[])){const d=D[k];if(!d)continue;scan(d);scan(d.phase2);}
      return ids;},
    bossArt(i){const S=window.SPRITES;return S&&typeof S.loadSheets==='function'?S.loadSheets('bosses',this.bossArtIds(i).map(b=>'b-'+b)):Promise.resolve(0);},
    pagesLoaded:i=>window.STAGE_RENDER?STAGE_RENDER.loaded(i):0,
  };
  // the boss art preload starts as soon as the start-up sprites are decoded (after the title is up)
  // (sprites.js loads after this file: wait for the page's scripts)
  const go=()=>{const S0=window.SPRITES;if(S0&&typeof S0.whenReady==='function')S0.whenReady(()=>window.SEQUEL_RENDER.preloadArt());};
  if(typeof document!=='undefined'&&document.readyState!=='complete')window.addEventListener('load',go);else go();
})();
