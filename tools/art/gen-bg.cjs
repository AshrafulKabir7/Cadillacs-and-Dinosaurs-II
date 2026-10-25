#!/usr/bin/env node
// tools/art/gen-bg.cjs - painted stage backgrounds through the Codex CLI's image generation (prompts in
// tools/art/bg-prompts.json). One image = two stacked 1536x512 strips; tools/art/import-bg.cjs turns them into stage art.
//
//   node tools/art/gen-bg.cjs --list                  every <stage>/<image> id
//   node tools/art/gen-bg.cjs --print st1/a0-1        the exact prompt (paste it into any image generator)
//   node tools/art/gen-bg.cjs --run st1/a0-1 [...]    generate those images into work/bg/gen/<stage>/<stage>-<image>.png
//   node tools/art/gen-bg.cjs --run-all [st1 st2 ...] every missing image (of those stages), --jobs N at a time (default 3)
// Options: --exe <codex.exe> (default: newest %LOCALAPPDATA%/OpenAI/Codex/bin/*/codex.exe, or env CODEX_EXE),
//          --timeout <s> (default 480), --force (regenerate even if the file exists).
// The first image of a stage is attached to the later ones as the look to match, so a stage keeps one palette.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'bg-prompts.json'), 'utf8'));
const GEN = path.join(ROOT, 'work', 'bg', 'gen');
// style references (original arcade backgrounds, used for the rendering style only)
const STYLE = { st1: 'quay', st2: 'forest', st3: 'wastes', st4: 'mine', st5: 'yard', st6: 'grove', st7: 'hall', st8: 'furnace' };

const stage = id => { const s = DATA.stages.find(x => x.id === id); if (!s) throw new Error(`no stage '${id}'`); return s; };
const imageOf = ref => { const [sid, iid] = ref.split('/'); const s = stage(sid), im = s.images.find(x => x.id === iid); if (!im) throw new Error(`no image '${ref}'`); return { s, im }; };
const fileOf = (s, im) => `${s.id}-${im.id}.png`;
const outOf = (s, im) => path.join(GEN, s.id, fileOf(s, im));

function prompt(s, im, matchFirst) {
  return [
    DATA.style,
    matchFirst ? `The second attached image is an earlier background of this SAME stage: match its palette, lighting, materials and pixel size exactly so the two can sit side by side in one level (but draw the new scene below, not a copy).` : '',
    im.drive ? DATA.driveLayout : DATA.layout,
    `STAGE: "${s.name}". LIGHT AND MOOD: ${s.light}.`,
    `STRIP A (top half): ${im.a}.`,
    `STRIP B (bottom half, continuing to the right): ${im.b}.`,
    DATA.finish.replace('{file}', fileOf(s, im)),
  ].filter(Boolean).join('\n\n');
}

function findExe(arg) {
  if (arg) return arg;
  if (process.env.CODEX_EXE) return process.env.CODEX_EXE;
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
  const hits = fs.existsSync(base) ? fs.readdirSync(base).map(d => path.join(base, d, 'codex.exe')).filter(f => fs.existsSync(f)) : [];
  hits.sort((p, q) => fs.statSync(q).mtimeMs - fs.statSync(p).mtimeMs);
  if (!hits.length) throw new Error('codex.exe not found: open the Codex app once, or pass --exe');
  return hits[0];
}

function run(ref, opt) {
  const { s, im } = imageOf(ref), out = outOf(s, im), dir = path.join(GEN, s.id, im.id);
  if (fs.existsSync(out) && !opt.force) { console.log(`skip ${ref}: exists`); return Promise.resolve(out); }
  fs.mkdirSync(dir, { recursive: true });
  const style = path.join(dir, 'style.png'); fs.copyFileSync(path.join(ROOT, 'assets', 'reference', `${STYLE[s.id] || 'quay'}.png`), style);
  const first = s.images[0], firstOut = outOf(s, first), match = im !== first && fs.existsSync(firstOut);
  const imgs = ['style.png']; if (match) { fs.copyFileSync(firstOut, path.join(dir, 'match.png')); imgs.push('match.png'); }
  const text = prompt(s, im, match); fs.writeFileSync(path.join(dir, 'prompt.txt'), text);
  const exe = findExe(opt.exe), t0 = Date.now();
  console.log(`codex: ${ref} -> ${path.relative(ROOT, out)}`);
  return new Promise(resolve => {
    // `-i <file>...` takes every following argument as an image, so the prompt goes in on stdin ('-')
    const ch = cp.spawn(exe, ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-i', ...imgs, '-'], { cwd: dir, windowsHide: true });
    let log = ''; ch.stdout.on('data', d => { log += d; }); ch.stderr.on('data', d => { log += d; });
    ch.stdin.end(text);
    const kill = setTimeout(() => ch.kill(), opt.timeout * 1000);
    ch.on('close', code => {
      clearTimeout(kill); fs.writeFileSync(path.join(dir, 'log.txt'), log);
      const made = path.join(dir, fileOf(s, im));
      if (fs.existsSync(made)) { fs.copyFileSync(made, out); console.log(`  ok ${ref} (${Math.round((Date.now() - t0) / 1000)} s)`); resolve(out); }
      else { console.log(`  FAIL ${ref} (exit ${code}); see ${path.relative(ROOT, path.join(dir, 'log.txt'))}`); resolve(null); }
    });
  });
}

async function runAll(refs, opt) {
  // the first image of each stage goes first so the rest can match it
  const firsts = refs.filter(r => stage(r.split('/')[0]).images[0].id === r.split('/')[1]);
  const rest = refs.filter(r => !firsts.includes(r));
  const pool = async list => { const q = list.slice(); const work = async () => { while (q.length) await run(q.shift(), opt); }; await Promise.all(Array.from({ length: Math.min(opt.jobs, q.length) }, work)); };
  await pool(firsts); await pool(rest);
}

if (require.main === module) {
  const a = process.argv.slice(2), opt = { timeout: 480, jobs: 3 };
  const val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  if (val('--exe')) opt.exe = val('--exe'); if (val('--timeout')) opt.timeout = +val('--timeout'); if (val('--jobs')) opt.jobs = +val('--jobs'); opt.force = a.includes('--force');
  const all = DATA.stages.flatMap(s => s.images.map(im => `${s.id}/${im.id}`));
  const after = k => { const i = a.indexOf(k); return i < 0 ? [] : a.slice(i + 1).filter(x => !x.startsWith('--') && !/^\d+$/.test(x)); };
  if (a.includes('--list')) all.forEach(r => console.log(r));
  else if (val('--print')) { const { s, im } = imageOf(val('--print')); console.log(prompt(s, im, im !== s.images[0])); }
  else if (a.includes('--run')) runAll(after('--run'), opt);
  else if (a.includes('--run-all')) { const st = after('--run-all'); runAll(all.filter(r => !st.length || st.includes(r.split('/')[0])).filter(r => opt.force || !fs.existsSync(outOf(...Object.values(imageOf(r))))), opt); }
  else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 12).join('\n')); process.exit(2); }
}
module.exports = { prompt, DATA };
