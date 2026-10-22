// Story text export: writers for story.json, SCRIPT.md, CAST.md and EPISODES.md. Research tooling only.
'use strict';
const fs = require('fs'), path = require('path');
const T = require('./story-rom.cjs');
const D = require('./story-data.cjs');
const B = require('./story-build.cjs');
const N = require('./story-notes.cjs');
const E = require('./story-episodes.cjs');
const hex = T.hex;
const md = s => String(s).replace(/\|/g, '\\|');

function evidenceIds(OUT) {
  const f = path.join(OUT, 'evidence', 'evidence.jsonl');
  if (!fs.existsSync(f)) return {};
  const m = {};
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) { try { const j = JSON.parse(l); m[j.label] = j.evidence_id; } catch (e) { /* skip */ } }
  return m;
}

// ---------------------------------------------------------------- static-only story.json (no live runs needed)
function staticJSON(S) {
  const blockInfo = b => {
    const dec = T.decodeWordBlock(b, b.font === 'blank' ? 'narrow' : b.font);
    const lines = T.screenLines(dec);
    return { addr: hex(b.addr), end: hex(b.end), font: b.font, lang: b.font === 'other' ? 'ja' : b.font === 'blank' ? 'blank' : b.font === 'service' ? 'service' : 'en', raw: dec.lines.map(l => ({ col: l.col, row: l.row, attr: l.attr, text: l.text })), screen: lines.map(l => l.text), rich: lines.map(l => l.rich) };
  };
  return {
    region: { word: hex(D.REGION.addr), writtenAt: hex(D.REGION.writtenAt), value: D.REGION.value, meaning: '0 Japan, 1 USA, 2 World ("ETC" on the version screen); this set writes 2, so every region switch picks the English table', readers: D.REGION.uses.map(a => hex(a)) },
    formats: {
      wordBlock: 'header {col byte, row byte, attr word}; one word per character; 0x2F2F = next header follows; 0x4040 = end; drawn on scroll1 at 0x90A000 + col*0x80 + row*4',
      byteBlock: 'header {col, row, colour}; ASCII; "/" = next header; "@" = end (8x8 font, printers 0x0BAE/0x0BB6)',
      printers: Object.fromEntries(Object.entries(D.PRINTERS).map(([a, k]) => [hex(+a), k])),
      punctuation: { '0x2727': "' (tile 0x2C in the top half)", '0x5E5E': '" (tile 0x22 top)', '0x2C2C': ', (tile 0x2C bottom)', '0x2E2E': '. (tile 0x2E bottom)', '0x5B5B': 'tile 0x18F one column back', '0x5D5D': 'tile 0x1BF two rows down', '0x7E7E': 'dakuten over the previous char (Japanese)', '0x2829': 'handakuten (Japanese)' },
      fonts: {
        narrow: Object.fromEntries([...T.NARROW].map(([c, ch]) => [hex(c), ch])),
        wide: Object.fromEntries([...T.WIDE].map(([c, ch]) => [hex(c), ch])),
        service: Object.fromEntries([...T.SERVICE].map(([c, ch]) => [hex(c), ch])),
      },
    },
    tables: S.tables.map(t => ({ id: t.id, at: hex(t.at), entries: t.n, kind: t.kind, code: t.code, note: t.note, targets: t.entries.map(e => hex(e.target)) })),
    fessMess: S.fessMess.map(x => ({ subtype: x.subtype, character: x.cid, routine: hex(x.routine), table: hex(x.table), steps: x.steps.map(s => ({ at: hex(s.at), routine: hex(s.routine), ops: s.ops.map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? hex(v) : v]))) })) })),
    dialogueCalls: S.dialogueCalls.map(c => ({ pc: hex(c.pc), portrait: c.portrait === null ? null : hex(c.portrait), line: c.line === null ? null : hex(c.line), lineAdd: c.lineAdd === null ? null : hex(c.lineAdd), screen: c.screen === null ? null : hex(c.screen) })),
    printerCalls: S.printerCalls.map(c => ({ pc: hex(c.pc), printer: hex(c.printer), kind: c.kind, text: c.text === null ? null : hex(c.text) })),
    staffRoll: { at: hex(D.STAFF.at), entries: S.staff.map(s => s.text), note: 'STUFF ROLL (pool C 0x15C, 0x8B60E) scrolls these 12-byte entries (11 characters + "@") up the right side of the screen in the ending' },
    captionSpawns: {
      code: S.captionSpawns.code, tables: Object.fromEntries(Object.entries(S.captionSpawns.tables).map(([k, v]) => [k, hex(v)])), allocators: S.captionSpawns.pools.map(hex),
      note: 'OBSERVED (REA t23): in-stage captions are spawn-list entries of type 0x108 (pool 1 = pool C) with subtype = caption index; trigger = camera X (camera Y in vertical areas, 0xFF84DC) at which the walker 0xFC7A spawns the entry. Caption indices 0x59, 0x5D and 0x5E appear in no list.',
      lists: S.captionSpawns.lists.map(l => ({ episode: l.stage + 1, area: l.area, at: hex(l.at), end: hex(l.end), entries: l.entries, listB: hex(l.listB) })),
      captions: S.captionSpawns.captions.map(c => { const t = S.tables.find(x => x.id === 'captions').entries[c.caption].target; const b = S.blocks.find(x => x.addr === t); return { episode: c.stage + 1, area: c.area, at: hex(c.at), trigger: c.trigger, caption: hex(c.caption), text: hex(t), lines: b ? T.screenLines(T.decodeWordBlock(b, b.font === 'blank' ? 'narrow' : b.font)).map(l => l.text) : [], lang: b ? (b.font === 'other' ? 'ja' : b.font === 'blank' ? 'blank' : 'en') : null }; }),
    },
    blocks: S.blocks.map(blockInfo),
    byteBlocks: S.byteBlocks.map(b => ({ addr: hex(b.addr), lines: b.lines.map(l => ({ col: l.col, row: l.row, colour: l.colour, text: l.text })) })),
    portraits: Object.fromEntries(Object.entries(N.PORTRAITS).map(([i, p]) => [hex(+i, 2), p])),
  };
}

function writeStatic(OUT) {
  const S = D.staticDecode();
  const j = Object.assign({ generatedBy: 'node tools/re/export/story.cjs static', liveRuns: null }, staticJSON(S));
  fs.writeFileSync(path.join(OUT, 'story-static.json'), JSON.stringify(j, null, 1));
  console.log(`[static] story-static.json: ${S.blocks.length} word blocks, ${S.byteBlocks.length} byte blocks, ${S.tables.length} tables`);
}

// ---------------------------------------------------------------- full build
function lineText(lines, rich = false) { return lines.map(l => md(rich ? l.rich : l.text)).join(' / '); }
function romRef(it) {
  const parts = [hex(it.addr)];
  if (it.via) parts.push(`${it.via.table}[${hex(it.via.index)}]`);
  return parts.join(' ');
}
function speakerCell(sp) { if (!sp) return ''; return `${md(sp.who)} *(${sp.status})*`; }

// sprite balloons: atlas PNG (RGBA, ROM palette set 0 at full brightness, transparent) + JSON frames
function balloonAtlas(OUT) {
  const R = require('../../rom.cjs');
  const bl = D.balloons();
  const ims = bl.records.map(r => Object.assign({ rec: r.rec, text: r.text }, R.recordRGBA(r.rec)));
  const W = 256, gap = 2; let x = gap, y = gap, rowH = 0; const frames = [];
  for (const im of ims) { if (x + im.w + gap > W) { x = gap; y += rowH + gap; rowH = 0; } frames.push({ rec: im.rec, text: im.text, x, y, w: im.w, h: im.h, ox: im.ox, oy: im.oy }); x += im.w + gap; rowH = Math.max(rowH, im.h); }
  const H = y + rowH + gap, out = new Uint8Array(W * H * 4);
  ims.forEach((im, k) => { const fr = frames[k]; for (let yy = 0; yy < im.h; yy++) for (let xx = 0; xx < im.w; xx++) { const sI = (yy * im.w + xx) * 4; if (!im.rgba[sI + 3]) continue; const d = ((fr.y + yy) * W + fr.x + xx) * 4; out[d] = im.rgba[sI]; out[d + 1] = im.rgba[sI + 1]; out[d + 2] = im.rgba[sI + 2]; out[d + 3] = 255; } });
  R.writePNG(path.join(OUT, 'balloons-atlas.png'), W, H, out);
  const j = Object.assign({ image: 'balloons-atlas.png', note: 'art as stored in the ROM (left-facing orientation; balloons are not mirrored text), palette set 0 at full brightness, (ox, oy) = record origin inside the frame box', frames }, bl);
  fs.writeFileSync(path.join(OUT, 'balloons-atlas.json'), JSON.stringify(j, null, 1));
  return j;
}

// independent cross-checks of the decode and the live capture
// live sightings of the balloon records: pool D log lines {"t":"poold","o":[[slot,type,w0,x,h,d,facing],...]} of the runs
// that log pool D (story-quips-*, story-victory-*, story-join-*, story-teamup-*); w0 = frame word 0 = record*4. One
// sighting per run and record (its first frame).
function balloonLive() {
  const Lv = require('./story-live.cjs');
  const seen = {};
  const runs = fs.existsSync(Lv.RUNS) ? fs.readdirSync(Lv.RUNS).filter(n => /^story-(quips|victory|join|teamup)-/.test(n)).sort() : [];
  for (const run of runs) {
    const got = new Set();
    for (const e of Lv.readEvents(run)) {
      if (e.t !== 'poold') continue;
      for (const o of e.o) { const rec = o[2] >> 2; if (rec >= 1593 && rec <= 1609 && !got.has(rec)) { got.add(rec); (seen[rec] = seen[rec] || []).push({ run, f: e.f, rec, type: o[1], x: o[3], h: o[4], d: o[5] }); } }
    }
  }
  return seen;
}
function validation(r, OUT) {
  const S = r.S, v = {};
  // 1. title cards and area captions as decoded from live scroll1 tilemaps by the stage export (its own 8x16 font
  //    table read off live screens, tools/re/export/stages.cjs FONT16) vs this ROM decode of the same blocks
  const sf = path.join(OUT, '..', 'stages', 'stages.json');
  if (fs.existsSync(sf)) {
    const st = JSON.parse(fs.readFileSync(sf, 'utf8')); const checks = [];
    const cards = S.tables.find(t => t.id === 'titleCards');
    const textAt = a => { const b = S.blocks.find(x => x.addr === a); return b ? T.screenLines(T.decodeWordBlock(b, b.font)).map(l => l.text) : []; };
    for (const e of st.episodes) {
      if (e.titleCard) { const mine = textAt(cards.entries[8 + e.ep - 1].target); checks.push({ what: `EP${e.ep} title card`, stages: [e.titleCard.text, e.titleCard.title], rom: mine, ok: mine[0] === e.titleCard.text && mine[1] === e.titleCard.title }); }
      for (const a of e.areas) if (a.caption && a.caption.text) {
        const hit = S.blocks.filter(b => b.font === 'narrow').find(b => textAt(b.addr).join(' ') === a.caption.text);
        checks.push({ what: `EP${e.ep} area ${a.area} caption`, stages: a.caption.text, rom: hit ? hex(hit.addr) : null, ok: !!hit });
      }
    }
    v.stagesCaptions = { source: 'work/re/extract/stages/stages.json (live scroll1 decode, independent font table)', checked: checks.length, matched: checks.filter(c => c.ok).length, checks };
  }
  // 2. live capture coverage
  const en = S.blocks.filter(b => b.font === 'narrow' || b.font === 'wide');
  const seenEn = en.filter(b => r.seen.has(b.addr));
  v.liveCoverage = { englishBlocks: en.length, printedInRuns: seenEn.length, notPrinted: en.length - seenEn.length, runs: Object.keys(r.runs).length, textAppearances: Object.values(r.runs).reduce((s, a) => s + a.filter(x => x.addr !== undefined).length, 0) };
  // 3. region: the English table was the one read in every run that printed a region-switched text
  const jaRead = []; for (const [run, apps] of Object.entries(r.runs)) for (const a of apps) { const b = S.blocks.find(x => x.addr === a.addr); if (b && b.font === 'other') jaRead.push(`${run} f${a.f} ${hex(a.addr)}`); }
  v.region = { japaneseBlocksPrinted: jaRead.length, examples: jaRead.slice(0, 5), note: 'reads of Japanese blocks by a printer in the World set (expected 0); the continue screen also reads the Japanese offset table 0xF194 every 300 frames (0xF158) but prints only the English entry' };
  // 4. every script line printed by a known printer: PCs
  return v;
}

function writeAll(OUT, { plans }) {
  const r = B.build(OUT, { plans });
  const S = r.S;
  const ev = evidenceIds(OUT);
  const balloons = balloonAtlas(OUT);
  const balloonSeen = balloonLive();
  balloons.liveSeen = balloonSeen;
  const order = [];
  let n = 0;
  for (const sec of r.script) for (const it of sec.items) order.push(Object.assign({ n: ++n, section: sec.id }, it));
  // ---- story.json
  const json = Object.assign({ generatedBy: 'node tools/re/export/story.cjs build' }, staticJSON(S), {
    evidence: ev,
    liveRuns: Object.fromEntries(Object.entries(r.runs).map(([k, v]) => [k, v.filter(a => a.addr !== undefined).map(a => ({ f: a.f, addr: hex(a.addr), via: a.via ? `${a.via.table}[${hex(a.via.index)}]` : null, pc: hex(a.pc), main: a.state.m, stage: a.state.st, area: a.state.ar, cid: a.state.cid }))])),
    script: r.script.map(sec => ({
      id: sec.id, episode: sec.ep, title: sec.title, runs: sec.runs,
      lines: sec.items.map(it => ({ addr: hex(it.addr), via: it.via ? `${it.via.table}[${hex(it.via.index)}]` : null, text: it.lines.map(l => l.text), rich: it.lines.map(l => l.rich), emptyEnglish: it.emptyEnglish, speaker: it.speaker, run: it.run, frame: it.f, repeats: it.repeats, main: it.state.m, stage: it.state.st, area: it.state.ar })),
      heroVariants: sec.variants.map(v => ({ addr: hex(v.addr), via: v.via ? `${v.via.table}[${hex(v.via.index)}]` : null, text: v.lines.map(l => l.text), run: v.run, frame: v.f, speaker: v.speaker })),
    })),
    notSeenLive: r.unseen.map(u => ({ addr: hex(u.addr), text: u.lines.map(l => l.text), refs: u.refs, note: E.UNSEEN_NOTES[u.addr] || null })),
    portraitImages: r.portraitShots,
    spriteBalloons: balloons,
    blockRenders: `blocks/<addr>.png (${r.renders} English blocks drawn with the ROM font, grey ramp, no palette)`,
    validation: validation(r, OUT),
    episodes: E.episodes(r),
    cast: E.cast(r),
  });
  fs.writeFileSync(path.join(OUT, 'story.json'), JSON.stringify(json, null, 1));

  // ---- SCRIPT.md
  const L = [];
  L.push('# Cadillacs & Dinosaurs (Capcom, 1993): the original script', '');
  L.push('Every line of story text in the user\'s World ROM set (MAME `dino`), in the order a player sees it, with the speaker, where it appears and the ROM address it comes from.');
  L.push('Generated by `node tools/re/export/story.cjs build` from the ROM (`tools/re/export/lib/story-rom.cjs`) and live MAME runs with a read tap on every text block (`work/re/runs/story-*`). Research material only.', '');
  L.push('**Language.** This set shows English. The region word 0xFF8032 is written once, `move.w #2` at 0xA736 (0 Japan, 1 USA, 2 World, shown as "ETC" on the version screen), and every printer that has both tables picks the English one when the word is not 0 (OBSERVED, live: 0xFF8032 = 2 in every run; REA `t05-region-titlecards`). The Japanese tables sit beside the English ones and are listed at the end. The boss-fight reference video is the Japanese version, so its text differs.', '');
  L.push('**Reading the tables.** *Line* is the text as drawn, `/` marks a line break on screen, **bold** words are printed in the highlight palette. Spelling is the ROM\'s (IMPOSIBLE, BELIVE, MUSTPHA, CREATER, GONN, COAL MANE are on screen exactly like that). *ROM* is the text block address, plus `table[index]` when it is reached through a pointer table (see the end of this file). *Seen* is the live run and frame where the line was printed. Speaker status: **OBSERVED** = seen in a snapshot or fixed by the code (portrait numbers), **INFERRED** = read from the scene.', '');
  L.push('## Contents', '');
  for (const sec of r.script) L.push(`- [${sec.title}](#${sec.title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')})`);
  L.push('- [Sprite speech balloons](#sprite-speech-balloons)', '- [Hero-dependent lines](#hero-dependent-lines)', '- [Staff roll](#staff-roll)', '- [In the ROM but not seen in these runs](#in-the-rom-but-not-seen-in-these-runs)', '- [Text tables and printers](#text-tables-and-printers)', '- [Japanese counterparts](#japanese-counterparts)', '');
  for (const sec of r.script) {
    L.push(`## ${sec.title}`, '');
    const intro = E.SECTION_INTRO[sec.id]; if (intro) L.push(intro, '');
    if (!sec.items.length) { L.push('*(no text captured in the runs)*', ''); continue; }
    L.push('| # | Speaker | Line | Where | ROM | Seen |', '|---|---|---|---|---|---|');
    for (const it of sec.items) {
      const o = order.find(x => x.addr === it.addr && x.section === sec.id);
      const where = E.whereOf(sec, it);
      const line = it.emptyEnglish ? '*(empty: the English entry has no text; the Japanese one does)*' : lineText(it.lines, true);
      L.push(`| ${o ? o.n : ''} | ${speakerCell(it.speaker)} | ${line} | ${md(where)} | ${romRef(it)} | ${it.run.replace('story-', '')} f${it.f}${it.repeats ? ` (x${it.repeats + 1})` : ''} |`);
    }
    L.push('');
    if (sec.variants.length) {
      L.push('Runs with another hero printed these instead:', '');
      for (const v of sec.variants) L.push(`- ${lineText(v.lines)} (${romRef(v)}; ${v.run.replace('story-', '')} f${v.f})${v.speaker ? ` - ${md(v.speaker.who)}` : ''}`);
      L.push('');
    }
    const notes = E.SECTION_NOTES[sec.id]; if (notes) L.push(...notes, '');
  }
  L.push('## Sprite speech balloons', '');
  L.push('Short quips drawn as sprites (the text is part of the graphics, so it is mixed case and not in any text table): records 1593-1609, atlas `balloons-atlas.png` / `.json`. Three objects draw them (REA `t22-balloons`, `t25-balloons-triggers`); animation-set offsets are relative to the table base (0x15E4).', '');
  L.push('- **Victory quips** (records 1593-1604, pool D type 0x14 at 0x92B7A, set 0x92BF0): when the stage boss is dead, the end-of-stage player script sets +0xC0 of the front player (the one with the largest X, 0x1E63C-0x1E64E) and that hero\'s victory pose 0x22BA (state 02/00/00/18, anim 0x11; taken when +0x10E == 0 and +0xC0 != 0) spawns one of his two quips at random (0x6192: anim [0x61E6 + id*4 + (random & 1)], id = character id). The balloon floats 0x60 above the hero for 2 x 120 frames.');
  L.push('- **Team-up cues** (the third balloon of each hero): when two heroes stand within 32 px and 16 of depth of each other for 90 frames (0x6836-0x6868, countdown +0xC3), the initiator takes state 02/00/00/1A with the other as partner (+0x70), the partner gets a move from table 0x6902 and the initiator\'s cue balloon shows (0x68FC -> 0x61F6, anim [0x6244 + id]). INFERRED trigger (read from the code); story-teamup-p2 (P2 walked next to P1, both idle) did not reach it.');
  L.push('- **Drop-in balloons** (records 1605/1606, pool D type 0x38 at 0x93B28, set 0x93C82, spawned at 0x18C30 by the hero drop-in 0x18BE2): "Need a hand?" (anim 1) when byte 0xFF84EF is set, i.e. another player is in the game, otherwise "They\'re gonna pay for this!" (anim 0); after it the player marker (anims 2-4, records 2603-2605 / 2717-2719 / 2720-2722 for P1/P2/P3).');
  L.push('- **Signs**: "DRIVE!" (1609) is the only frame of set 0x974EA, drawn by pool D type 0x98 (spawner 0x97414, handler 0x97430: blinking 24 of 32 frames, X per subtype from 0x974DA (128/256/384) or 0x974E0 (160/352) by byte 0xFF84CF, height 0xA0). Nothing calls the spawner and the pool D dispatch entry for type 0x98 (0x237E6 + 0x98) is 0: dead code. "BREAK!" (1608) and "Look out!" (1607) have no reference in the ROM; the record words found earlier at 0x2B8D0/0x4AB60/0x74388 are bytes of velocity tables.', '');
  L.push('| Record | Balloon | Who / when | Status |', '|---|---|---|---|');
  const BT = D.BALLOON_TEXT;
  const st = (recs, fallback) => { const hits = recs.flatMap(r => balloonSeen[r] || []); return hits.length ? 'OBSERVED live: ' + hits.map(h => `${h.run.replace('story-', '')} f${h.f} (record ${h.rec}, pool D type ${hex(h.type)})`).join('; ') : fallback; };
  for (const h of balloons.byHero) {
    L.push(`| ${h.pair.join(', ')} | ${h.pair.map(r => '"' + BT[r] + '"').join(' / ')} | ${h.hero}: victory quip after the stage boss dies, one of the two at random (set 0x92BF0 anims ${h.pairAnims.join('/')}) | ${st(h.pair, 'OBSERVED (code, records); not seen live for this hero (the trigger was seen with Jack)')} |`);
    L.push(`| ${h.cue} | "${BT[h.cue]}" | ${h.hero}: team-up cue (anim ${h.cueAnim}) | ${st([h.cue], 'OBSERVED (code, record); not seen live')} |`);
  }
  L.push(`| 1606 | "${BT[1606]}" | every hero, dropping in alone (the respawn after a lost life; 0xFF84EF == 0) | ${st([1606], 'not seen live')}; story-balloon-jack f577 OBJ codes 0x5593/0x55A0 = record 1606 |`);
  L.push(`| 1605 | "${BT[1605]}" | a hero dropping in while another player is in the game (0xFF84EF != 0): the join-in | ${st([1605], 'not seen live')} |`);
  L.push(`| 1607 | "${BT[1607]}" | no reference in the ROM | unused |`);
  L.push(`| 1608 | "${BT[1608]}" | no reference in the ROM | unused |`);
  L.push(`| 1609 | "${BT[1609]}" | pool D type 0x98 sign object (0x97414 / 0x97430, set 0x974EA), unreachable | unused (dead code) |`);
  L.push('');
  L.push('## Hero-dependent lines', '');
  L.push(...E.heroVariantsMD(S, r), '');
  L.push('## Staff roll', '');
  L.push(`Printed by STUFF ROLL (pool C type 0x15C, 0x8B60E; list at ${hex(D.STAFF.at)}, 12-byte entries) while Mustapha and Mess walk out of the desert (story-ending f1500-f3500, snapshots). In order:`, '');
  const staff = S.staff.map(s => s.text); while (staff.length && !staff[staff.length - 1]) staff.pop();
  L.push('```', ...staff.map(s => s || ''), '```', '', 'The entry at 0x8B900 is stored as "YUKI S%IKO"; the staff-roll printer (0x8B73E) draws "%" as an upside-down A (attribute bit 6), shown here as ∀.', '');
  L.push('## In the ROM but not seen in these runs', '');
  L.push('English blocks that no run printed. Most are reached through a table entry the runs did not trigger; some are unreferenced (dead) text.', '');
  L.push('| ROM | Text | Reached from | Note |', '|---|---|---|---|');
  for (const u of r.unseen) L.push(`| ${hex(u.addr)} | ${lineText(u.lines)} | ${md(u.refs.join(', ') || 'no reference found')} | ${md(E.UNSEEN_NOTES[u.addr] || (u.refs.some(x => /scroller/.test(x)) ? 'piece of the scrolling intro line; pool C 0x60 is spawned only by the uncalled intro variants (0x99144, 0x9B4C4)' : ''))} |`);
  L.push('');
  L.push('## Text tables and printers', '');
  L.push(...E.tablesMD(S, ev), '');
  L.push('## Japanese counterparts', '');
  L.push(...E.japaneseMD(S), '');
  fs.writeFileSync(path.join(OUT, 'SCRIPT.md'), L.join('\n'));

  // ---- CAST.md and EPISODES.md
  fs.writeFileSync(path.join(OUT, 'CAST.md'), E.castMD(r, json.cast).join('\n'));
  fs.writeFileSync(path.join(OUT, 'EPISODES.md'), E.episodesMD(r, json.episodes).join('\n'));
  console.log(`[build] script lines ${order.length}, not seen ${r.unseen.length}, block renders ${r.renders}, portraits ${r.portraitShots.length}`);
  return { r, json };
}

module.exports = { writeStatic, writeAll, staticJSON };
