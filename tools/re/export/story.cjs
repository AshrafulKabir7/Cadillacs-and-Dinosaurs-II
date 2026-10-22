#!/usr/bin/env node
// Story and on-screen text of the original Cadillacs & Dinosaurs (MAME "dino", the user's World set): decode the
// text tables from the ROM, capture where and in which order they appear in live MAME runs, and write the script.
// Research tooling only; nothing here edits the game.
//
//   node tools/re/export/story.cjs static      ROM-only decode -> work/re/extract/story/story-static.json (no live part)
//   node tools/re/export/story.cjs live [run]  MAME runs with a read tap on every text block (story-* runs), one at a time
//   node tools/re/export/story.cjs build       static + live -> story.json, SCRIPT.md, CAST.md, EPISODES.md, blocks/*.png
//   node tools/re/export/story.cjs all         static, live, build
//   node tools/re/export/story.cjs events <run>   print the text events of one run (debug)
//
// Libraries: tools/re/export/lib/story-rom.cjs (formats, fonts, scanner), lib/story-live.cjs (taps, plans),
// lib/story-data.cjs (decoded tables, code-derived data), lib/story-build.cjs (live appearances, script order),
// lib/story-notes.cjs + lib/story-episodes.cjs (curated speakers, cast, episodes), lib/story-write.cjs (outputs).
// REA evidence for the key routines: sh tools/re/export/story-rea.sh -> work/re/extract/story/evidence/.
'use strict';
const fs = require('fs'), path = require('path');
const T = require('./lib/story-rom.cjs');
const L = require('./lib/story-live.cjs');
const D = require('./lib/story-data.cjs');
const W = require('./lib/story-write.cjs');

const REPO = path.resolve(__dirname, '../../..');
const OUT = path.join(REPO, 'work/re/extract/story');
const hex = T.hex;
const mkdir = d => fs.mkdirSync(d, { recursive: true });

// ---------------------------------------------------------------- watch set for the live tap
function watchSet() {
  const S = D.staticDecode();
  const watch = new Set(), tables = new Set();
  for (const b of S.blocks) { watch.add(b.addr); if (b.font === 'blank') tables.add(b.addr); }
  for (const b of S.byteBlocks) watch.add(b.addr & ~1);
  for (const t of S.tables) for (const e of t.entries) { watch.add(e.at); if (!S.blocks.some(b => b.addr === e.at)) tables.add(e.at); }
  const addrs = [...watch].sort((a, b) => a - b);
  const ranges = [];
  for (const a of addrs) {
    const r = ranges[ranges.length - 1];
    if (r && a - r[1] <= 0x200) r[1] = a + 1; else ranges.push([a, a + 1]);
  }
  return { watch: addrs, ranges, tables: [...tables] };
}

// ---------------------------------------------------------------- live plans
// Frame numbers: plan frames (harness README). Boot recipe H08: coin 330-335, start 370-375, select by Right presses
// at 430/445/460, Button 1 at 480-483.
const HERO_RIGHTS = { jack: 0, hannah: 1, mustapha: 2, mess: 3 };
function plans() {
  const tap = L.tapLua(watchSet());
  const P = [];
  // attract mode from power-on, no coin: title, story intro, demo play, character profiles ... (two full cycles)
  P.push({ name: 'story-attract', frames: 24000, hook: tap + L.PLAIN_LUA, snapshotEvery: { from: 0, to: 23999, every: 120 } });
  // game start for each hero: select, stage 1 intro (plane, EASTCOAST 2513, the poachers' lines, the blast)
  for (const [hero, k] of Object.entries(HERO_RIGHTS)) {
    const inputs = [{ from: 480, to: 483, keys: ['P1 Button 1'] }];
    for (let i = 0; i < k; i++) inputs.push({ from: 430 + i * 15, to: 433 + i * 15, keys: ['P1 Right'] });
    P.push({ name: `story-start-${hero}`, frames: 1500, coinStart: true, inputs, hook: tap + L.PLAIN_LUA, snapshotEvery: { from: 600, to: 1499, every: 30 } });
  }
  // intermission + title card before each episode 2..8 (warpLive = the stage-clear writes). No invuln cheat here: the
  // intermission code picks the speaker from the players whose +0x00 is 1 (0xE034/0xE0AA), and invuln holds it at 2.
  // The stage-1 states still run the post-intro invulnerability (+0xF9), so P1 +0x00 is forced to 1 (timers 0) first.
  // After the title card the hero walks right (invulnerable from frame 100) so the first area's lines show too.
  for (const hero of ['jack', 'mustapha', 'hannah', 'mess']) for (let ep = 2; ep <= 8; ep++) P.push({ name: `story-inter${ep}-${hero}`, frames: 2600, loadState: `stage1-${hero}`, cheats: [{ cheat: 'warpLive', stage: ep, at: 10 }, { cheat: 'invuln', from: 100 }], inputs: [{ from: 700, to: 2599, keys: ['right'] }],
    pokes: [{ from: 6, to: 11, addr: '0xFFB36D', size: 1, value: 0 }, { from: 6, to: 11, addr: '0xFFB360', size: 2, value: 0 }, { from: 6, to: 11, addr: '0xFFB274', size: 1, value: 1 }], hook: tap + L.PLAIN_LUA, snapshotEvery: { from: 10, to: 2599, every: 60 } });
  // episode walks (invulnerable bot; grunts cleared the way ENEMY CLEAR does it, bosses fought to death; timer held)
  for (let ep = 1; ep <= 8; ep++) P.push(walkPlan(ep, 'jack', tap));
  // Mustapha: HP refill instead of invuln, because FESS MESS (0x84504) and the caption icons pick the front player among
  // the slots whose +0x00 is 1, which invuln holds at 2 (the Jack walks are unaffected: character 0 is the fallback)
  for (const ep of [2, 3, 4, 5, 6, 7, 8]) P.push(walkPlan(ep, 'mustapha', tap, { cheats: [{ cheat: 'infhp' }, { cheat: 'lives', value: 9, at: 2 }] }));
  // Hannah and Mess through EPISODE 1 (the Vice T. scene is a FESS MESS script, so their portraits 1 and 3 and their
  // columns of the script table show); same HP refill instead of invuln as for Mustapha
  for (const hero of ['hannah', 'mess']) P.push(walkPlan(1, hero, tap, { cheats: [{ cheat: 'infhp' }, { cheat: 'lives', value: 9, at: 2 }] }));
  // E7 area 3 and E8 area 3 (boss rooms) entered with warpArea, like the stage/boss exports did
  P.push(walkPlan(7, 'jack', tap, { name: 'story-ep7-a3-jack', frames: 12000, cheats: [{ cheat: 'invuln' }, { cheat: 'warpArea', area: 3, at: 10 }] }));
  P.push(walkPlan(8, 'jack', tap, { name: 'story-ep8-a3-jack', frames: 16000, cheats: [{ cheat: 'invuln' }, { cheat: 'warpArea', area: 3, at: 10 }] }));
  // E8 boss room again, long enough for the escape cut-scene after the final form dies (stage-clear step 6 waits up to
  // 0xE10 passes at 0xABA8 for the four JUMP PL. runners, then FESS MESS 7 and the exit) and the start of the ending
  P.push(walkPlan(8, 'jack', tap, { name: 'story-ep8-esc-jack', frames: 24000, cheats: [{ cheat: 'invuln' }, { cheat: 'warpArea', area: 3, at: 10 }], lua: 'STALL = 14000\nBOT_TAIL = 900\n' }));
  // the same with every input released once the boss is dead (the end-of-stage player script 0x18 of E8 area 3, table
  // 0x1D9B0, waits for the players to be idle before it spawns the JUMP PL. runners)
  P.push(walkPlan(8, 'jack', tap, { name: 'story-ep8-esc2-jack', frames: 24000, cheats: [{ cheat: 'invuln' }, { cheat: 'warpArea', area: 3, at: 10 }], lua: 'STALL = 14000\nBOT_TAIL = 900\n' }));
  // the TYROG grab line (caption 0x5A, spawned at 0x5E312/0x5E32A when a Tyrog whose subtype high byte is 0 or 1 grabs
  // a hero): Mustapha with HP refill (hittable), and in the boss room the bot stands still instead of fighting the
  // Tyrog types (0x10, 0x120, 0x12C, 0x130) until the line is read or 2400 frames pass
  P.push(walkPlan(6, 'mustapha', tap, { name: 'story-ep6-grab-mustapha', frames: 13000, cheats: [{ cheat: 'infhp' }, { cheat: 'lives', value: 9, at: 2 }],
    lua: 'NOFIGHT = {[0x120]=1}\nSTAND_MAX = 3000\nEND_ON_READ = 0x882F0\n' }));   // the first Tyrog (type 0x10) and the mutation objects are fought as usual: only 0x120 (0x5DD58) has the grab
  // the stage-clear victory quip (sprite balloon, pool D 0x14 set 0x92BF0): the end-of-stage player script sets +0xC0 of
  // the front hero (0x1E648) and the pose state 0x22BA spawns the random pair (0x6192). EPISODE 1 with Jack, pool D
  // logged, snapshots every 20 frames once the boss is dead (s1 = 4 at f3655 in story-ep1-jack)
  P.push(walkPlan(1, 'jack', tap, { name: 'story-victory-jack', frames: 4600, luaAfter: L.POOLD_LUA, snapshotEvery: { from: 3600, to: 4599, every: 20 } }));
  // "Need a hand?" (record 1605): the drop-in balloon (pool D 0x38, 0x18C30) plays anim 1 of set 0x93C82 when 0xFF84EF
  // is set (more than one player). P2 joins the stage-1 game (coin 2, 2P start, confirm) with pool D logged
  P.push({ name: 'story-join-p2', frames: 900, loadState: 'stage1-jack', inputs: [{ from: 10, to: 15, keys: ['Coin 2'] }, { from: 40, to: 45, keys: ['2 Players Start'] }, { from: 60, to: 62, keys: ['P2 Button 1'] }],
    hook: tap + L.PLAIN_LUA + L.POOLD_LUA, snapshotEvery: { from: 45, to: 600, every: 15 } });
  // the team-up cue balloons ("Let's go!" / "Let's roll!" / "Jump!" / "Let's fly!", 0x61F6 from 0x68FC): two heroes within
  // 32 px and the same lane for 90 frames (0x6836-0x6868). P2 (Hannah) joins, walks up to Jack, both stand still
  P.push({ name: 'story-teamup-p2', frames: 1500, loadState: 'stage1-jack', inputs: [{ from: 10, to: 15, keys: ['Coin 2'] }, { from: 40, to: 45, keys: ['2 Players Start'] }, { from: 60, to: 62, keys: ['P2 Button 1'] }, { from: 640, to: 668, keys: ['P2 Right'] }, { from: 640, to: 666, keys: ['P2 Down'] }],
    hook: tap + L.PLAIN_LUA + L.POOLD_LUA, snapshotEvery: { from: 600, to: 1100, every: 15 } });
  // EPISODE 5 played as Mess (no stage5-mess state: warpLive from the stage-1 state, intermission, then the walk to the
  // village): the Mess column of FESS MESS subtype 3 (its extra portrait step 0xA66D8) and Mess's intermission lines
  P.push(walkPlan(5, 'mess', tap, { name: 'story-ep5-mess', frames: 14000, loadState: 'stage1-mess',
    cheats: [{ cheat: 'warpLive', stage: 5, at: 10 }, { cheat: 'infhp' }, { cheat: 'lives', value: 9, at: 2 }],
    pokes: [{ from: 6, to: 11, addr: '0xFFB36D', size: 1, value: 0 }, { from: 6, to: 11, addr: '0xFFB360', size: 2, value: 0 }, { from: 6, to: 11, addr: '0xFFB274', size: 1, value: 1 }],
    inputs: [{ from: 700, to: 13999, keys: ['right'] }], lua: 'BOT_MIN_END = 1500\n' }));
  // ending (main state 0x1C, 0xAC48 -> 0xA69B8) entered from the episode 8 state, then the staff roll
  P.push({ name: 'story-ending', frames: 9000, loadState: 'stage8-jack', pokes: [{ from: 10, to: 10, addr: '0xFF84D1', size: 1, value: 0 }, { from: 10, to: 10, addr: '0xFF84D2', size: 2, value: 0 }, { from: 10, to: 10, addr: '0xFF84D0', size: 1, value: 0x1c }], hook: tap + L.PLAIN_LUA, snapshotEvery: { from: 10, to: 8999, every: 60 } });
  // continue screen (main state 0x10, entered at 0x6CA2 when no player is left) and game over: no life left, the timer
  // runs out (R8), no credit
  P.push({ name: 'story-continue2', frames: 4000, loadState: 'stage1-jack', pokes: [{ from: 2, to: 2, addr: '0xFFB317', size: 1, value: 0 }, { from: 5, to: 5, addr: '0xFF84E8', size: 2, value: 0x0002 }], hook: tap + L.PLAIN_LUA, snapshotEvery: { from: 60, to: 3999, every: 30 } });
  // respawn quips (speech balloons drawn as sprites): each hero loses a life to the timer every 700 frames; pool D
  // (effects) is logged whenever its content changes, with the record each slot draws
  for (const hero of ['jack', 'hannah', 'mustapha', 'mess']) P.push({ name: `story-quips-${hero}`, frames: 6400, loadState: `stage1-${hero}`,
    cheats: [{ cheat: 'lives', value: 9, at: 2 }], pokes: Array.from({ length: 9 }, (_, k) => ({ from: 5 + k * 700, to: 5 + k * 700, addr: '0xFF84E8', size: 2, value: 0x0002 })),
    hook: tap + L.PLAIN_LUA + L.POOLD_LUA, snapshotEvery: { from: 60, to: 6399, every: 20 } });
  // the respawn speech balloon as OBJ entries (to find its sprite record): Jack loses a life to the timer; OBJ list
  // dumped while the balloon is up
  P.push({ name: 'story-balloon-jack', frames: 640, loadState: 'stage1-jack', cheats: [{ cheat: 'lives', value: 9, at: 2 }], pokes: [{ from: 5, to: 5, addr: '0xFF84E8', size: 2, value: 0x0002 }],
    dump: { from: 520, to: 600, every: 8, obj: true, cpsA: true }, snapshots: [529, 545, 561, 577, 593], hook: tap + L.PLAIN_LUA });
  // in-place continue / game over: the timer runs out (R8) with no credit left
  P.push({ name: 'story-continue', frames: 2400, loadState: 'stage1-jack', pokes: [{ from: 5, to: 5, addr: '0xFF84E8', size: 2, value: 0x0002 }], hook: tap + L.PLAIN_LUA, snapshotEvery: { from: 60, to: 2399, every: 30 } });
  return P;
}
function walkPlan(ep, hero, tap, o = {}) {
  const frames = o.frames || 24000;
  return {
    name: o.name || `story-ep${ep}-${hero}`, frames, loadState: o.loadState || `stage${ep}-${hero}`,
    cheats: o.cheats || [{ cheat: 'invuln' }],   // enemies: the walk Lua clears grunts and fights bosses (lib/story-live.cjs)
    inputs: o.inputs || [{ from: 2, to: frames - 1, keys: ['right'] }],
    pokes: o.pokes,
    snapshotEvery: o.snapshotEvery || { from: 0, to: frames - 1, every: 600 },
    hook: tap + 'TIMER_WORD = 0x0300\nTELEPORT_AFTER = 240\n' + (o.lua || '') + L.WALK_LUA + (o.luaAfter || ''),
  };
}

async function live(names) {
  const all = plans();
  const sel = names.length ? all.filter(p => names.some(n => p.name === n || p.name.startsWith(n))) : all;
  await L.runSeq(sel);
}

// ---------------------------------------------------------------- events of a run (debug)
function events(run) {
  const S = D.staticDecode();
  const byAddr = new Map(S.blocks.map(b => [b.addr, b]));
  const entryOf = new Map(); for (const t of S.tables) for (const e of t.entries) entryOf.set(e.at, { t, e });
  for (const e of L.readEvents(run)) {
    if (e.t === 'st') { console.log(`f${e.f} STATE main ${hex(e.m)} sub ${e.s1}/${e.s2} stage ${e.st} area ${e.ar} attract ${e.at} region ${e.rg} p1 ${e.p1} cid ${e.cid}`); continue; }
    if (e.t !== 'rd') { console.log(JSON.stringify(e)); continue; }
    const b = byAddr.get(e.a), te = entryOf.get(e.a);
    const what = b ? `${b.font} "${D.blockText(b)}"` : te ? `table ${te.t.id}[${te.e.index}] -> ${te.e.target !== undefined ? hex(te.e.target) : ''}` : '?';
    console.log(`f${e.f} READ ${hex(e.a)} pc ${hex(e.pc)} a6 ${hex(e.a6)}  ${what}`);
  }
}

async function main() {
  const [cmd = 'build', ...args] = process.argv.slice(2);
  mkdir(OUT);
  if (cmd === 'static' || cmd === 'all') W.writeStatic(OUT);
  if (cmd === 'live' || cmd === 'all') await live(args);
  if (cmd === 'build' || cmd === 'all') W.writeAll(OUT, { plans: plans().map(p => p.name) });
  if (cmd === 'events') events(args[0]);
  if (cmd === 'plans') console.log(plans().map(p => p.name).join('\n'));
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { plans, watchSet };
