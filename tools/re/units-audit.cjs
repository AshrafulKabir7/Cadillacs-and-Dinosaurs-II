#!/usr/bin/env node
// Units audit for the G1 conversion of game.js to arcade pixels (PLAN §7 G1 (3), ARCHITECTURE §1.6, risk R2).
//
//   node tools/re/units-audit.cjs [--file game.js] [--base <git-rev>] [--out work/re/design/units-audit.tsv] [--all]
//   node tools/re/units-audit.cjs --apply <reviewed.tsv> [--file game.js]
//
// Lists every numeric literal >= 4 in the file that is code (not inside a string, template text, comment or regex), with
// its line, column, enclosing function, a short context and a suggested tag:
//   dist | speed | accel  world distances, px/s, px/s^2 (convert: old canvas px / 1.35, rounded)
//   time | count | hp     seconds, counts, health, damage, score (never convert)
//   ui                    HUD / panel / screen-pass coordinates (re-laid in arcade screen px, halved)
//   art                   legacy canvas-px drawing (kept, drawn under LEG = 1/1.35)
//   index                 sheet rectangles, record numbers, palette indices (never convert)
//   review                anything the heuristics cannot place
// With --base <rev> (for example HEAD) the literals are aligned with the same file at that revision (lines by LCS on their
// number-blind shape, then tokens inside each paired line), so every row also shows the old value and the ratio: a
// converted distance reads ~1.35, a halved HUD coordinate 2, an untouched literal 1. Rows whose tag says dist/speed/accel
// but whose value did not change are the ones to look at (a missed literal); a ratio near 1.35^2 is a double conversion.
// --apply rewrites the rows of a reviewed TSV whose `tag` column is dist, speed or accel and whose `status` is not
// `converted` as Math.round(v/1.35) (the codemod of ARCHITECTURE §1.6). Nothing here touches git.
'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; }, flag = k => argv.includes(k);
const FILE = path.resolve(ROOT, opt('--file', 'game.js')), BASE = opt('--base', null), OUT = path.resolve(ROOT, opt('--out', 'work/re/design/units-audit.tsv'));
const MIN = 4, RATIO = 1.35;

// ---------------------------------------------------------------- tokenizer (strings, templates with ${}, comments, regex)
const KW_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
function tokenize(src) {
  const toks = []; let i = 0, line = 1, lineStart = 0; const stack = [];   // stack of template depths: brace depth at '${'
  let depth = 0;
  const push = (type, start, end) => toks.push({ type, text: src.slice(start, end), start, line, col: start - lineStart + 1 });
  const prevSig = () => { for (let k = toks.length - 1; k >= 0; k--) return toks[k]; return null; };
  const nl = (from, to) => { for (let k = from; k < to; k++) if (src.charCodeAt(k) === 10) { line++; lineStart = k + 1; } };
  const scanTemplate = () => {   // at the char after a backtick or after the '}' closing a ${ }
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; return 'end'; }
      if (c === '$' && src[i + 1] === '{') { i += 2; stack.push(depth); depth++; return 'expr'; }
      if (c === '\n') { line++; lineStart = i + 1; }
      i++;
    }
    return 'end';
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; lineStart = i + 1; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2), end = e < 0 ? src.length : e + 2; nl(i, end); i = end; continue; }
    if (c === '"' || c === "'") { const s = i; i++; while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; } i++; push('str', s, i); continue; }
    if (c === '`') { const s = i; i++; const r = scanTemplate(); push('tpl', s, i); continue; }
    if (c === '}' && stack.length && depth - 1 === stack[stack.length - 1]) { depth--; stack.pop(); const s = i; i++; scanTemplate(); push('tpl', s, i); continue; }
    if (c === '/') {
      const p = prevSig(), regexOk = !p || (p.type === 'punct' && !/^[)\]}]$/.test(p.text)) || (p.type === 'id' && KW_BEFORE_REGEX.has(p.text));
      if (regexOk) { const s = i; i++; let cls = false; while (i < src.length) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; i++; } i++; while (/[a-z]/i.test(src[i] || '')) i++; push('re', s, i); continue; }
    }
    const num = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(src.slice(i, i + 40));
    if (num && !(c === '.' && !/\d/.test(src[i + 1] || ''))) { push('num', i, i + num[0].length); i += num[0].length; continue; }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 80));
    if (id) { push('id', i, i + id[0].length); i += id[0].length; continue; }
    const pu = /^(?:=>|\.\.\.|\?\.(?!\d)|\?\?=?|===|!==|==|!=|<=|>=|&&=?|\|\|=?|\*\*|\+\+|--|[+\-*/%&|^]=|<<|>>>?|[{}()[\];,.<>+\-*/%&|^!~?:=@#])/.exec(src.slice(i, i + 4));
    const t = pu ? pu[0] : c; if (t === '{') depth++; else if (t === '}') depth--;
    push('punct', i, i + t.length); i += t.length;
  }
  return toks;
}

// ---------------------------------------------------------------- per-line view: functions, context, tags
const UI_FN = /^(hud|missionHud|drawContinue|label|coinText|menu|paintSelection|characterSelect|chapters|guide|soundRoom|pause|gameover|stageClear|ending|credits|panel|LAYOUT_ARCADE|render)$/;
const ART_FN = /^(draw\w*|car|truck|wheel|shadow|legacy\w*|background|weaponSprite|rect|poly|circle|beginFrame)$/;
const INDEX_FN = /^(WEAPONS|HOLD|KNIFE_UP|STANCE|FOOD_WEIGHTS|BONUS_WEIGHTS|STAGE_TRACKS|BOSS_TRACKS|SAMPLE_FOR|SELECT_ORDER|CARRIED|BOSS_GUARDS)$/;
// The enclosing top-level function (or top-level const) of every line: game.js keeps its functions at column 0.
function functionOf(lines) {
  const names = []; let cur = '(top)';
  for (const l of lines) { const m = /^(?:async\s+)?function\s+([\w$]+)|^(?:const|let)\s+([\w$]+)\s*=/.exec(l); if (m) cur = m[1] || m[2]; names.push(cur); }
  return names;
}
function suggest(fn, ctx, value) {
  const c = ctx;
  if (INDEX_FN.test(fn)) return 'index';
  if (/sprite:\[|\bs:\[|\[\d+,\d+,\d+,\d+\]/.test(c) && value === Math.round(value)) return 'index';
  if (UI_FN.test(fn)) return 'ui';
  // Inside a draw function only the drawing calls are art: distance-driven frames (walkDist/7), velocity thresholds and
  // hit-range checks there are gameplay units and must be converted like any other.
  if (/Dist\/|\bv[xyz]\b\s*[<>]|Math\.(hypot|abs)\([^)]*\)\s*</.test(c)) return /\bv[xyz]\b\s*[<>]/.test(c) ? 'speed' : 'dist';
  if (ART_FN.test(fn) && /\b(rect|poly|circle|label|drawImage|ellipse|translate|fillRect|arc|lineTo|moveTo|shadow|drawAH|drawFrame|drawCombat|drawPose|weaponSprite|scale)\(/.test(c)) return 'art';
  if (/Math\.random\(\)\*\d|%\d+|\*\d+\+wave|\bj\*\d+|\bn\*\d+|seed|0x/.test(c)) return 'count';
  if (/\b(hp|maxhp|damage|power|ammo|score|lives|coins|heal|kills|combo)\b/.test(c) && !/\bx\b|\by\b/.test(c.replace(/\b(hp|maxhp)\b/g, ''))) return 'count';
  if (/(timer|life|ttl|Cd|cooldown|delay|inv|hurt|bossIntro|toastTime|seconds|duration|time\*|\*time)/.test(c) && !/\*dt\b/.test(c)) return 'time';
  if (/\bv[xyz]\b|speed|vel|Velocity|accel|drag|top:|cruise|laneTop|boost|road:/.test(c)) return /\*dt|-=\d+\*dt|accel|drag|gravity|vz-=/.test(c) ? 'accel' : 'speed';
  if (/\b(x|y|z|r|range|reach|lane|left|right|top|bottom|dist|distance|enterX|targetX|width|w|h)\b/.test(c)) return 'dist';
  return 'review';
}

// ---------------------------------------------------------------- alignment with a base revision
function lcsPairs(a, b, eq) {   // classic LCS on two small arrays, returns [[i,j]...] of equal items
  const n = a.length, m = b.length, W = m + 1, T = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i * W + j] = eq(a[i], b[j]) ? T[(i + 1) * W + j + 1] + 1 : Math.max(T[(i + 1) * W + j], T[i * W + j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (eq(a[i], b[j])) { out.push([i, j]); i++; j++; } else if (T[(i + 1) * W + j] >= T[i * W + j + 1]) i++; else j++; }
  return out;
}
const shape = toks => toks.map(t => t.type === 'num' ? '#' : t.text);
function align(baseSrc, curSrc) {
  const bt = tokenize(baseSrc), ct = tokenize(curSrc), byLine = (toks, n) => { const L = Array.from({ length: n }, () => []); for (const t of toks) L[t.line - 1].push(t); return L; };
  const bl = byLine(bt, baseSrc.split('\n').length), cl = byLine(ct, curSrc.split('\n').length);
  const bs = bl.map(l => shape(l).join('\u0001')), cs = cl.map(l => shape(l).join('\u0001'));
  const pairs = lcsPairs(bs, cs, (x, y) => x === y && x !== '');
  // Unmatched stretches between anchors: pair lines in order by their best token similarity.
  const linePairs = [...pairs], anchors = [[-1, -1], ...pairs, [bl.length, cl.length]];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [b0, c0] = anchors[k], [b1, c1] = anchors[k + 1];
    const bi = [], ci = []; for (let i = b0 + 1; i < b1; i++) if (bl[i].length) bi.push(i); for (let j = c0 + 1; j < c1; j++) if (cl[j].length) ci.push(j);
    let from = 0;
    for (const j of ci) {
      let best = -1, score = 0; const cset = new Set(shape(cl[j]));
      for (let q = from; q < bi.length; q++) { const bsh = shape(bl[bi[q]]); let s = 0; for (const t of bsh) if (cset.has(t)) s++; s /= Math.max(bsh.length, cset.size); if (s > score) { score = s; best = q; } }
      if (best >= 0 && score > 0.35) { linePairs.push([bi[best], j]); from = best + 1; }
    }
  }
  const map = new Map();   // current token start -> base token
  for (const [i, j] of linePairs) {
    const a = bl[i], b = cl[j]; if (a.length * b.length > 4e6) continue;
    for (const [x, y] of lcsPairs(a, b, (p, q) => p.type === q.type && (p.type === 'num' || p.text === q.text))) if (b[y].type === 'num') map.set(b[y].start, a[x]);
  }
  return map;
}

// ---------------------------------------------------------------- audit
function audit() {
  const src = fs.readFileSync(FILE, 'utf8'), lines = src.split('\n'), fns = functionOf(lines), toks = tokenize(src);
  let baseMap = null;
  if (BASE) { const rel = path.relative(ROOT, FILE).replace(/\\/g, '/'); const base = cp.execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); baseMap = align(base, src); }
  const rows = [];
  for (const t of toks) {
    if (t.type !== 'num') continue; const v = Number(t.text); if (!(Math.abs(v) >= MIN) && !(baseMap && baseMap.get(t.start) && Math.abs(Number(baseMap.get(t.start).text)) >= MIN)) continue;
    const L = lines[t.line - 1], ctx = L.slice(Math.max(0, t.col - 41), t.col + t.text.length + 30).replace(/\t/g, ' ').trim(), fn = fns[t.line - 1];
    const row = { line: t.line, col: t.col, fn, value: t.text, tag: suggest(fn, L.slice(Math.max(0, t.col - 60), t.col + 20), v), ctx };
    if (baseMap) { const b = baseMap.get(t.start); if (!b) { row.base = ''; row.ratio = ''; row.status = 'new'; } else { const bv = Number(b.text); row.base = b.text; row.ratio = v ? (bv / v).toFixed(3) : ''; row.status = bv === v ? 'kept' : Math.abs(bv / v - RATIO) < 0.08 ? 'converted' : Math.abs(bv / v - 2) < 0.08 ? 'halved' : 'changed'; } }
    rows.push(row);
  }
  const cols = ['line', 'col', 'fn', 'value', ...(baseMap ? ['base', 'ratio', 'status'] : []), 'tag', 'ctx'];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, cols.join('\t') + '\n' + rows.map(r => cols.map(c => String(r[c] ?? '').replace(/[\t\n]/g, ' ')).join('\t')).join('\n') + '\n');
  const by = k => rows.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {});
  console.log(`${path.relative(ROOT, FILE)}: ${rows.length} numeric literals >= ${MIN} -> ${path.relative(ROOT, OUT)}`);
  console.log('by tag   ', JSON.stringify(by('tag')));
  if (baseMap) {
    console.log('by status', JSON.stringify(by('status')));
    const suspects = rows.filter(r => r.status === 'kept' && /^(dist|speed|accel)$/.test(r.tag));
    const doubled = rows.filter(r => r.ratio && Math.abs(Number(r.ratio) - RATIO * RATIO) < 0.1);
    console.log(`kept literals the heuristics call dist/speed/accel (review: a missed conversion or a deliberate keep): ${suspects.length}`);
    for (const r of (flag('--all') ? suspects : suspects.slice(0, 40))) console.log(`  L${r.line}:${r.col} ${r.fn} ${r.value} [${r.tag}]  ${r.ctx}`);
    if (doubled.length) { console.log(`ratio ~1.82 (converted twice?): ${doubled.length}`); for (const r of doubled) console.log(`  L${r.line}:${r.col} ${r.fn} ${r.base} -> ${r.value}  ${r.ctx}`); }
  }
  return rows;
}

// ---------------------------------------------------------------- codemod
function apply(tsvFile) {
  const src = fs.readFileSync(FILE, 'utf8'), lines = src.split('\n'), [head, ...body] = fs.readFileSync(tsvFile, 'utf8').trim().split('\n'), H = head.split('\t');
  const rows = body.map(l => Object.fromEntries(l.split('\t').map((v, i) => [H[i], v]))).filter(r => /^(dist|speed|accel)$/.test(r.tag) && r.status !== 'converted');
  rows.sort((a, b) => b.line - a.line || b.col - a.col);
  let n = 0;
  for (const r of rows) { const li = +r.line - 1, c = +r.col - 1, L = lines[li]; if (L.slice(c, c + r.value.length) !== r.value) { console.error(`L${r.line}:${r.col} expected ${r.value}, found ${L.slice(c, c + r.value.length)}: skipped`); continue; } lines[li] = L.slice(0, c) + String(Math.round(Number(r.value) / RATIO)) + L.slice(c + r.value.length); n++; }
  fs.writeFileSync(FILE, lines.join('\n')); console.log(`rewrote ${n} literals as round(v/${RATIO}) in ${path.relative(ROOT, FILE)}`);
}

if (require.main === module) { if (opt('--apply', null)) apply(path.resolve(ROOT, opt('--apply'))); else audit(); }
module.exports = { tokenize, align, suggest };
