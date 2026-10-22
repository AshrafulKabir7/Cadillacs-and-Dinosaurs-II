// Story text export: merge the static decode (lib/story-data.cjs) with the live runs (lib/story-live.cjs) and write
// story.json, SCRIPT.md, CAST.md, EPISODES.md and the block renders. Research tooling only.
'use strict';
const fs = require('fs'), path = require('path');
const R = require('../../rom.cjs');
const T = require('./story-rom.cjs');
const D = require('./story-data.cjs');
const L = require('./story-live.cjs');
const N = require('./story-notes.cjs');
const hex = T.hex;

// ---------------------------------------------------------------- live: accepted text appearances per run
// A text block read counts when the reading PC is inside a printer; a pointer-table read counts when the reading
// instruction is the table's known reader, or when the entry's text is printed in the same or next two frames (the
// 68000 prefetch after a branch also reads table words; those reads are dropped).
const PRINTER_PCS = [[0xB300, 0xB400], [0xBAE, 0xF1C], [0x84F72, 0x85088], [0x7EC48, 0x7EEB4], [0x9DD00, 0x9DD80]];
const READERS = { dialogue: [0x847B4], captions: [0x87008], fessMess: [0x8457A], fessLines: [0x81B68], titleCards: [0xC6C6], titleCards2: [0x7D136], continueTaunts: [0xF184, 0xF188], continueTauntsJP: [0xF170, 0xF174], scroller: [0x7E33E, 0x7E342] };
const inPrinter = pc => PRINTER_PCS.some(([a, b]) => pc >= a && pc < b);

function runAppearances(run, S) {
  const ev = L.readEvents(run);
  if (!ev.length) return null;
  const byAddr = new Map(S.blocks.map(b => [b.addr, b]));
  const byteAddr = new Map(S.byteBlocks.map(b => [b.addr & ~1, b]));
  const entryOf = new Map(); for (const t of S.tables) for (const e of t.entries) entryOf.set(e.at, { table: t.id, index: e.index, target: e.target });
  let state = { m: null, st: null, ar: null, cid: null };
  const textReads = [], out = [];
  for (const e of ev) if (e.t === 'rd' && inPrinter(e.pc) && (byAddr.has(e.a) || byteAddr.has(e.a))) textReads.push(e);
  const printedAt = new Map(); for (const e of textReads) { if (!printedAt.has(e.a)) printedAt.set(e.a, []); printedAt.get(e.a).push(e.f); }
  const pending = [];
  for (const e of ev) {
    if (e.t === 'st') { state = { m: e.m, s1: e.s1, st: e.st, ar: e.ar, cid: e.cid, at: e.at }; continue; }
    if (e.t !== 'rd') continue;
    const ent = entryOf.get(e.a);
    if (ent && !byAddr.has(e.a)) {
      const fs_ = printedAt.get(ent.target) || [];
      const paired = fs_.some(f => f >= e.f && f <= e.f + 2);
      const known = (READERS[ent.table] || []).includes(e.pc);
      if (ent.table === 'fessMess' && known) { out.push({ run, f: e.f, kind: 'script', table: ent.table, index: ent.index, target: ent.target, pc: e.pc, state: { ...state } }); continue; }
      if (paired || known) pending.push({ f: e.f, ent, pc: e.pc, paired });
      if (known && !paired) out.push({ run, f: e.f, kind: 'text', addr: ent.target, via: { table: ent.table, index: ent.index }, pc: e.pc, state: { ...state }, emptyEnglish: true });
      continue;
    }
    if (!inPrinter(e.pc)) continue;
    if (byAddr.has(e.a) || byteAddr.has(e.a)) {
      const via = pending.filter(p => p.paired && p.ent.target === e.a && e.f - p.f <= 2).pop();
      out.push({ run, f: e.f, kind: byAddr.has(e.a) ? 'text' : 'ascii', addr: e.a, via: via ? { table: via.ent.table, index: via.ent.index } : null, pc: e.pc, state: { ...state } });
    }
  }
  return out;
}

// ---------------------------------------------------------------- speakers
function portraitName(i) { const p = N.PORTRAITS[i]; return p ? p.name : `portrait ${hex(i)}`; }
// dialogue line index -> the portrait(s) the code shows with it (static: every 0x84736 call and FESS MESS step)
function dialogueSpeakers(S) {
  const m = new Map();
  const add = (line, who, where) => { if (!m.has(line)) m.set(line, []); m.get(line).push({ who, where }); };
  for (const c of S.dialogueCalls) {
    if (c.line !== null && c.portrait !== null) add(c.line, c.portrait === 0x63 ? 'no portrait' : portraitName(c.portrait), `call at ${hex(c.pc)} (D0 ${hex(c.portrait)}, D1 ${hex(c.line)})`);
  }
  for (const s of S.fessMess) for (const st of s.steps) for (const op of st.ops) if (op.op === 'say' && op.line !== null) add(op.line, portraitName(op.portrait), `FESS MESS subtype ${s.subtype}, character ${s.cid}: step ${hex(st.routine)} (D0 ${hex(op.portrait)}, D1 ${hex(op.line)})`);
  // computed line numbers in the intermissions (OBSERVED in the code, t07/t08 evidence)
  for (let c = 0; c < 4; c++) {
    add(0x2A + c, 'the first hero no player is using', 'intermission before E4 0xDB34-0xDB46: D1 = 0x2A + player character (0xE0AA), D0 = free hero (0xE034)');
    add(0x2F + c, 'no portrait (radio call)', 'intermission before E5 0xDC0A-0xDC1E: D1 = 0x2F + player character, D0 = 0x63');
  }
  add(0x2E, N.PORTRAIT_PLAYER + ' (portrait only, blank text)', 'intermission before E6 0xDDFC-0xDE20');
  add(0x28, N.PORTRAIT_FREE + ' (portrait only, blank text)', 'intermission before E4 0xDB18-0xDB2E');
  add(0x29, N.PORTRAIT_FREE + ' (portrait only, blank text)', 'intermission before E4 0xDB18-0xDB2E (when that hero is Hannah)');
  add(0x33, N.PORTRAIT_FREE, 'intermission before E7 0xDEAE-0xDEC4');
  add(0x34, N.PORTRAIT_FREE + ' (when that hero is Hannah)', 'intermission before E7 0xDEAE-0xDEC4');
  return m;
}
function speakerOf(app, S, DS) {
  if (app.via && app.via.table === 'dialogue') {
    const list = DS.get(app.via.index) || [];
    const names = [...new Set(list.map(x => x.who))];
    return { who: names.join(' / ') || 'unknown', status: 'OBSERVED', basis: 'portrait set by the code: ' + [...new Set(list.map(x => x.where))].slice(0, 3).join('; ') };
  }
  const n = N.SPEAKERS[app.addr];
  if (n) return n;
  return null;
}

// ---------------------------------------------------------------- sections of the script (episode order)
const SECTIONS = [
  { id: 'attract', title: 'Attract mode (power-on, no coin)', runs: ['story-attract'] },
  { id: 'start', title: 'Coin, character select and the opening of EPISODE 1', runs: ['story-start-jack'], alt: ['story-start-hannah', 'story-start-mustapha', 'story-start-mess'], keep: a => a.f >= 330 && a.pc !== 0xB3DA && a.pc !== 0xB374 && a.pc !== 0xB37E },
  { id: 'ep1', ep: 1, title: 'EPISODE 1 (no title card is shown; the stage opens with "EASTCOAST 2513")', runs: ['story-ep1-jack'], alt: ['story-ep1-hannah', 'story-ep1-mess'] },
  { id: 'ep2', ep: 2, runs: ['story-inter2-jack', 'story-ep2-jack'], alt: ['story-inter2-mustapha', 'story-ep2-mustapha', 'story-inter2-hannah', 'story-inter2-mess'] },
  { id: 'ep3', ep: 3, runs: ['story-inter3-jack', 'story-ep3-jack'], alt: ['story-inter3-mustapha', 'story-ep3-mustapha', 'story-inter3-hannah', 'story-inter3-mess'] },
  { id: 'ep4', ep: 4, runs: ['story-inter4-jack', 'story-ep4-jack'], alt: ['story-inter4-mustapha', 'story-ep4-mustapha', 'story-inter4-hannah', 'story-inter4-mess'] },
  { id: 'ep5', ep: 5, runs: ['story-inter5-jack', 'story-ep5-jack'], alt: ['story-inter5-mustapha', 'story-ep5-mustapha', 'story-inter5-hannah', 'story-inter5-mess', 'story-ep5-mess'] },
  // story-ep6-grab-mustapha: the only run in which the second Tyrog grabs the hero (caption 0x5A); its other lines repeat ep6-jack's
  { id: 'ep6', ep: 6, runs: ['story-inter6-jack', 'story-ep6-jack', 'story-ep6-grab-mustapha'], alt: ['story-inter6-mustapha', 'story-ep6-mustapha', 'story-inter6-hannah', 'story-inter6-mess'] },
  { id: 'ep7', ep: 7, runs: ['story-inter7-jack', 'story-ep7-jack', 'story-ep7-a3-jack'], alt: ['story-inter7-mustapha', 'story-ep7-mustapha', 'story-inter7-hannah', 'story-inter7-mess'] },
  { id: 'ep8', ep: 8, runs: ['story-inter8-jack', 'story-ep8-jack', 'story-ep8-a3-jack', 'story-ep8-esc-jack', 'story-ep8-esc2-jack'], alt: ['story-inter8-mustapha', 'story-ep8-mustapha', 'story-inter8-hannah', 'story-inter8-mess'] },
  { id: 'continue', title: 'Continue screen and game over', runs: ['story-continue2', 'story-continue'], keep: a => !!(a.via && /continueTaunts/.test(a.via.table)) },
  { id: 'ending', title: 'Ending (main state 0x1C) and staff roll', runs: ['story-ending'], keep: a => a.state.m === 0x1C },
];
// does an appearance belong to this episode section? (walk runs end in the next intermission)
function belongs(sec, app) {
  if (sec.keep && !sec.keep(app)) return false;
  if (!sec.ep) return true;
  const st = app.state;
  if (/story-inter/.test(app.run)) return st.st === sec.ep - 1 || st.m === 8;
  return st.st === sec.ep - 1 && st.m !== 8 && st.m !== 0x1C;   // the E8 escape run continues into the ending (state 0x1C)
}

function build(OUT, { plans }) {
  const S = D.staticDecode();
  const DS = dialogueSpeakers(S);
  const byAddr = new Map(S.blocks.map(b => [b.addr, b]));
  const byteAddr = new Map(S.byteBlocks.map(b => [b.addr & ~1, b]));
  // live appearances of every run
  const runs = {};
  for (const name of plans) { const a = runAppearances(name, S); if (a) runs[name] = a; }
  const seen = new Map();   // addr -> [ {run, f} ]
  for (const [run, apps] of Object.entries(runs)) for (const a of apps) if (a.addr !== undefined) { if (!seen.has(a.addr)) seen.set(a.addr, []); seen.get(a.addr).push({ run, f: a.f }); }

  const blockInfo = b => {
    const dec = T.decodeWordBlock(b, b.font === 'blank' ? 'narrow' : b.font);
    const lines = T.screenLines(dec);
    return { addr: hex(b.addr), end: hex(b.end), font: b.font, lang: b.font === 'other' ? 'ja' : b.font === 'blank' ? 'blank' : 'en', raw: dec.lines.map(l => ({ col: l.col, row: l.row, attr: l.attr, text: l.text })), screen: lines.map(l => l.text), rich: lines.map(l => l.rich) };
  };
  const textOf = addr => { const b = byAddr.get(addr); if (b) return T.screenLines(T.decodeWordBlock(b, b.font === 'blank' ? 'narrow' : b.font)); const y = byteAddr.get(addr); return y ? y.lines.map(l => ({ text: l.text.trim(), rich: l.text.trim() })).filter(l => l.text) : []; };

  // script: sections in play order
  const script = [];
  for (const sec of SECTIONS) {
    const title = sec.title || `EPISODE ${sec.ep}`;
    const items = [], have = new Set(), keys = new Set();
    for (const run of sec.runs) {
      for (const a of runs[run] || []) {
        if (a.kind === 'script' || a.addr === undefined) continue;
        if (!belongs(sec, a)) continue;
        const key = a.addr + (a.via ? '/' + a.via.table + a.via.index : '');
        if (have.has(a.addr)) { const it = items.find(x => x.addr === a.addr); if (it) it.repeats++; continue; }
        have.add(a.addr); keys.add(key);
        const lines = textOf(a.addr);
        const b = byAddr.get(a.addr);
        if (!lines.length && !a.emptyEnglish) continue;          // eraser blocks
        if (b && b.font === 'blank' && !a.emptyEnglish && !(a.via && a.via.table === 'captions')) continue;
        items.push({ addr: a.addr, via: a.via, run: a.run, f: a.f, state: a.state, kind: a.kind, repeats: 0, lines, emptyEnglish: !lines.length, speaker: speakerOf(a, S, DS), key });
      }
    }
    // variants seen only in the alternative-hero runs: another text block, or the same block reached through another
    // table entry (the per-hero dialogue entries 0x0-0x3 etc. share one text and differ only in the portrait)
    const variants = [];
    for (const run of sec.alt || []) for (const a of runs[run] || []) {
      if (a.addr === undefined || a.kind === 'script' || !belongs(sec, a)) continue;
      const key = a.addr + (a.via ? '/' + a.via.table + a.via.index : '');
      if (keys.has(key) || (have.has(a.addr) && !(a.via && a.via.table === 'dialogue'))) continue;
      const lines = textOf(a.addr); if (!lines.length) continue;
      have.add(a.addr); keys.add(key);
      variants.push({ addr: a.addr, via: a.via, run, f: a.f, lines, speaker: speakerOf(a, S, DS) });
    }
    script.push({ id: sec.id, ep: sec.ep || null, title, runs: sec.runs.filter(r => runs[r]), items, variants });
  }

  // English blocks never seen in a run
  const unseen = S.blocks.filter(b => (b.font === 'narrow' || b.font === 'wide') && !seen.has(b.addr)).map(b => {
    const refs = [];
    for (const t of S.tables) for (const e of t.entries) if (e.target === b.addr) refs.push(`${t.id}[${hex(e.index)}]`);
    for (const c of S.printerCalls) if (c.text === b.addr) refs.push(`${c.kind} call at ${hex(c.pc)}`);
    return { addr: b.addr, lines: T.screenLines(T.decodeWordBlock(b, b.font)), refs };
  }).filter(x => x.lines.length);

  // block renders (English and title-card blocks), as evidence of the font mapping
  const bdir = path.join(OUT, 'blocks'); fs.mkdirSync(bdir, { recursive: true });
  let renders = 0;
  for (const b of S.blocks) {
    if (b.font !== 'narrow' && b.font !== 'wide') continue;
    const viaTypewriter = S.tables.find(t => /titleCards/.test(t.id) && t.entries.some(e => e.target === b.addr));
    const im = T.renderBlock(b, viaTypewriter ? 'typewriter' : b.font === 'wide' ? 'wide' : 'narrow', 2);
    if (!im) continue;
    R.writePNG(path.join(bdir, `${hex(b.addr, 5)}.png`), im.w, im.h, im.rgba); renders++;
  }

  // portraits cropped from the live snapshots (scroll1 position of the 0x84736 call: x = col*8, y = row*8 - 16)
  const pdir = path.join(OUT, 'portraits'); fs.mkdirSync(pdir, { recursive: true });
  const portraitShots = [];
  for (const [i, p] of Object.entries(N.PORTRAITS)) {
    const m = /(story-[\w-]+) f(\d+)/.exec(p.seen); if (!m || p.status !== 'OBSERVED') continue;
    const dir = path.join(L.RUNS, m[1]); if (!fs.existsSync(dir)) continue;
    const f = +m[2];
    const cand = fs.readdirSync(dir).filter(n => /^(txt|snap)-f\d+\.png$/.test(n)).map(n => ({ n, f: +/(\d+)/.exec(n)[1] })).sort((a, b) => Math.abs(a.f - f) - Math.abs(b.f - f))[0];
    if (!cand) continue;
    const img = R.readPNG(fs.readFileSync(path.join(dir, cand.n)));
    // find the 72x72 portrait box: the call screen position is known per call site (0x90A29C boss lines, 0x90A108 / 0x90A150 intermissions)
    for (const [x0, y0] of [[40, 40], [16, 0], [16, 144]]) {
      let lit = 0; for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) { const o = ((y0 + y) * img.w + x0 + x) * 4; if (img.data[o] + img.data[o + 1] + img.data[o + 2] > 60) lit++; }
      if (lit > 72 * 72 * 0.6) {
        const out = new Uint8Array(72 * 72 * 4);
        for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) { const s = ((y0 + y) * img.w + x0 + x) * 4, d = (y * 72 + x) * 4; out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = 255; }
        const file = `portrait-${hex(+i, 2)}.png`;
        R.writePNG(path.join(pdir, file), 72, 72, out);
        portraitShots.push({ index: hex(+i, 2), name: p.name, file: 'portraits/' + file, from: `${m[1]}/${cand.n}`, box: [x0, y0, 72, 72] });
        break;
      }
    }
  }
  return { S, runs, script, unseen, renders, portraitShots, blockInfo, byAddr, byteAddr, DS, seen, textOf };
}

module.exports = { build, runAppearances, dialogueSpeakers, SECTIONS, PRINTER_PCS, READERS };
