#!/usr/bin/env node
// tools/art/gen-codex.cjs - the boss sprite generation prompts (tools/art/boss-prompts.json) as exact text, import specs
// and optional runs through the Codex CLI's built-in image generation (the generator verified on this machine,
// 2026-10-22; it uses the Codex app's existing sign-in, no API key).
//
//   node tools/art/gen-codex.cjs --list                      every <boss>/<sheet> id
//   node tools/art/gen-codex.cjs --print rook/03-hook        the exact prompt (paste it into any image generator)
//   node tools/art/gen-codex.cjs --spec rook                 write work/art/specs/rook.json (import spec for all sheets)
//   node tools/art/gen-codex.cjs --markdown                  the prompt appendix of work/art/PRODUCTION.md
//   node tools/art/gen-codex.cjs --run rook/00-model         generate one sheet with Codex into work/art/gen/rook/
//   node tools/art/gen-codex.cjs --run-all rook              every missing sheet of a boss, in order (00-model first)
// Options: --exe <codex.exe> (default: newest %LOCALAPPDATA%/OpenAI/Codex/bin/*/codex.exe, or env CODEX_EXE),
//          --timeout <s> (default 420), --force (regenerate even if the file exists).
// Sheets after 00-model attach work/art/gen/<boss>/<boss>-00-model.png as the locked model: look at the model first
// and regenerate it until it is right, because every other sheet copies it.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'boss-prompts.json'), 'utf8'));
const T = DATA.text;
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));
const boss = id => { const b = DATA.bosses.find(x => x.id === id); if (!b) throw new Error(`no boss '${id}' (have ${DATA.bosses.map(x => x.id).join(', ')})`); return b; };
const sheetOf = ref => { const [bid, sid] = ref.split('/'); const b = boss(bid), s = b.sheets.find(x => x.id === sid || x.id.startsWith(sid + '-') || x.id.split('-')[0] === sid); if (!s) throw new Error(`no sheet '${ref}'`); return { b, s }; };
const fileOf = (b, s) => `${b.id}-${s.id}.png`;
const genDir = b => path.join(ROOT, 'work', 'art', 'gen', b.id);

function prompt(b, s) {
  const model = s.id === '00-model', file = fileOf(b, s), n = s.poses.length;
  const ref = model ? fill(T.refBoard, { ref: path.basename(b.board), panel: b.panel }) : fill(T.refModel, { ref: `${b.id}-00-model.png` });
  const poses = s.poses.map(([name, desc], i) => `${i + 1}. ${desc === '@ref' ? T.refPose : desc}`).join('\n');
  return [
    `Use your image generation tool to generate ONE image${model ? ' (square, about 1024x1024)' : ' (wide landscape, about 1536x1024)'}: ${model ? 'a single arcade game sprite' : 'an arcade game sprite pose sheet'} of ${b.name} for a 1990s side-scrolling beat-'em-up.`,
    ref,
    `CHARACTER (locked, identical in every image): ${b.lock}`,
    `LAYOUT: ${model ? T.single : fill(T.sheet, { n })}`,
    `${model ? 'POSE' : 'POSES (left to right)'}:\n${poses}`,
    `VIEW: ${T.view}`,
    `STYLE: ${T.style}`,
    `BACKGROUND: ${T.background}`,
    fill(T.finish, { file }),
  ].join('\n');
}

function spec(b) {
  const inputs = b.sheets.map(s => {
    const names = s.poses.map(p => p[0]);
    const inp = { file: `work/art/gen/${b.id}/${fileOf(b, s)}`, names, ref: 0 };
    if (names.length > 1) inp.split = 'auto';
    return inp;
  });
  const air = {}; for (const a of b.anims) Object.assign(air, a.air || {});
  return {
    id: b.id, name: b.name, height: b.height, maxW: b.maxW, bg: '#FF00FF',
    palette: { mode: 'ramps' }, clean: { smooth: 1 }, anchor: b.id === 'breakwater' || b.id === 'glassback' || b.id === 'crownback' ? 'torso' : 'feet',
    air, inputs,
    anims: b.anims.map(a => { const o = Object.assign({}, a); delete o.air; return o; }),
  };
}

function findExe(arg) {
  if (arg) return arg;
  if (process.env.CODEX_EXE) return process.env.CODEX_EXE;
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
  const hits = fs.existsSync(base) ? fs.readdirSync(base).map(d => path.join(base, d, 'codex.exe')).filter(f => fs.existsSync(f)) : [];
  hits.sort((p, q) => fs.statSync(q).mtimeMs - fs.statSync(p).mtimeMs);
  if (!hits.length) throw new Error('codex.exe not found: install / open the Codex app once, or pass --exe');
  return hits[0];
}
function newestGenerated(since) {
  const root = path.join(os.homedir(), '.codex', 'generated_images'); if (!fs.existsSync(root)) return null;
  let best = null;
  for (const d of fs.readdirSync(root)) {
    const dir = path.join(root, d); if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f), m = fs.statSync(p).mtimeMs; if (/\.png$/i.test(f) && m >= since && (!best || m > best.m)) best = { p, m }; }
  }
  return best && best.p;
}
function run(ref, opt) {
  const { b, s } = sheetOf(ref), dir = genDir(b), out = path.join(dir, fileOf(b, s));
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(out) && !opt.force) { console.log(`skip ${ref}: ${path.relative(ROOT, out)} exists (--force to redo)`); return out; }
  const model = s.id === '00-model', refImg = model ? path.join(ROOT, b.board) : path.join(dir, `${b.id}-00-model.png`);
  if (!fs.existsSync(refImg)) throw new Error(`${ref}: reference ${path.relative(ROOT, refImg)} missing (generate and approve ${b.id}/00-model first)`);
  const local = path.join(dir, path.basename(refImg)); if (!fs.existsSync(local)) fs.copyFileSync(refImg, local);
  const text = prompt(b, s); fs.writeFileSync(out.replace(/\.png$/, '.prompt.txt'), text);
  const exe = findExe(opt.exe), t0 = Date.now() - 2000;
  console.log(`codex: ${ref} -> ${path.relative(ROOT, out)} (up to ${opt.timeout} s)`);
  // `-i <file>...` takes every following argument as an image, so the prompt goes in on stdin ('-')
  const r = cp.spawnSync(exe, ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-i', path.basename(local), '-'], { cwd: dir, input: text, encoding: 'utf8', timeout: opt.timeout * 1000, windowsHide: true });
  fs.writeFileSync(out.replace(/\.png$/, '.log.txt'), `${r.stdout || ''}\n${r.stderr || ''}`);
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < t0) {
    const g = newestGenerated(t0);                                  // the agent did not copy it: take Codex's own copy
    if (g) fs.copyFileSync(g, out);
  }
  if (!fs.existsSync(out)) throw new Error(`${ref}: no image (status ${r.status}${r.error ? ', ' + r.error.message : ''}); see ${path.relative(ROOT, out.replace(/\.png$/, '.log.txt'))}`);
  console.log(`  ok ${path.relative(ROOT, out)} (${Math.round((Date.now() - t0) / 1000)} s)`);
  return out;
}

function markdown() {
  const L = [];
  for (const b of DATA.bosses) {
    L.push(`### ${b.name} (\`${b.id}\`)`, '');
    for (const s of b.sheets) {
      L.push(`#### ${b.id}/${s.id} -> work/art/gen/${b.id}/${fileOf(b, s)}`, '', '```text', prompt(b, s), '```', '');
    }
  }
  return L.join('\n');
}

if (require.main === module) {
  const a = process.argv.slice(2), opt = { timeout: 420 };
  const val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  if (val('--exe')) opt.exe = val('--exe'); if (val('--timeout')) opt.timeout = +val('--timeout'); opt.force = a.includes('--force');
  try {
    if (a.includes('--list')) for (const b of DATA.bosses) for (const s of b.sheets) console.log(`${b.id}/${s.id}  (${s.poses.map(p => p[0]).join(', ')})`);
    else if (val('--print')) { const { b, s } = sheetOf(val('--print')); console.log(prompt(b, s)); }
    else if (val('--spec')) { const b = boss(val('--spec')), f = path.join(ROOT, 'work', 'art', 'specs', `${b.id}.json`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(spec(b), null, 2)); console.log(path.relative(ROOT, f)); }
    else if (a.includes('--markdown')) console.log(markdown());
    else if (val('--run')) run(val('--run'), opt);
    else if (val('--run-all')) { const b = boss(val('--run-all')); for (const s of b.sheets) run(`${b.id}/${s.id}`, opt); }
    else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 17).join('\n')); process.exit(2); }
  } catch (err) { console.error(err.message); process.exit(1); }
}
module.exports = { prompt, spec, markdown, DATA };
