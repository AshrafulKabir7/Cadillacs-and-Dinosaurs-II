/* SEQUEL_RENDER: the readiness facade every suite waits on (ARCHITECTURE §5.4, PLAN §4.6 and RC11). The stages are
   STAGE_RENDER pages (stage-render.js, stage-data.js, since G2) and the bosses are their ROM bodies (ROM_BOSSES,
   sprite-data-bosses.js, drawn by game.js on BOSS_DEFS since G5): the generated boss canvases of SEQUEL_ART.bosses are gone. */
(() => {
  let latched=false;
  const heroRigReady=()=>{const R=window.HeroRig;if(!R)return true;const r=typeof R.ready==='function'?R.ready():R.ready;return r!==false;};
  window.SEQUEL_RENDER={
    // Sprites decoded and verified (every family, the bosses included), the hero rig and chapter 1's first two screens of
    // stage pages (STAGE_RENDER.ready starts the load). Latched once true, so reading it later (snapshot.artReady) never
    // reorders the two-chapter page cache by re-requesting chapter 1.
    get ready(){
      if(latched)return true;
      const S=window.SPRITES,R=window.STAGE_RENDER;
      const ok=!!S&&S.ready&&S.verified&&heroRigReady()&&!!R&&R.ready('ch1');
      if(ok)latched=true;return ok;
    },
    // Every BOSS_DEFS body plus LOT 00's parts and the Crown Engine bake (PLAN §4.6); bossCount counts the ones that ship.
    get bossRoster(){return window.BOSS_DEFS?Object.values(BOSS_DEFS).map(b=>b.body).filter(Boolean).concat(['fessenden','crownEngine']):[];},
    get bossCount(){const S=window.SPRITES;return S&&typeof S.has==='function'?this.bossRoster.filter(id=>S.has('bosses',id)).length:0;},
    loadChapter:i=>window.STAGE_RENDER?STAGE_RENDER.require(i):Promise.resolve(0),
    pagesLoaded:i=>window.STAGE_RENDER?STAGE_RENDER.loaded(i):0,
  };
})();
