#!/usr/bin/env node
// tools/art/gen-home.cjs - the home page key art through the Codex CLI's image generation (as gen-codex.cjs / gen-bg.cjs).
// The user's mockup (work/home-art/ref-mockup.png) is attached as the composition and style reference; every image is
// painted WITHOUT text, so the page sets the title, the copy and the buttons in HTML.
//
//   node tools/art/gen-home.cjs --list            the image ids
//   node tools/art/gen-home.cjs --run key-bg ...  generate into work/home-art/<id>.png (skips existing; --force redoes)
//   node tools/art/gen-home.cjs --run-all         every missing image, --jobs N at a time (default 2)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..'), OUT = path.join(ROOT, 'work', 'home-art'), REF = 'ref-mockup.png';

const STYLE = 'Painted key art in the style of a modern remaster poster for a 1990s Capcom arcade beat-\'em-up: bold ink outlines, rich cel-shaded painting, warm sunset light against teal jungle shadows, high detail, cinematic depth.';
const CAST = 'The four heroes of Cadillacs & Dinosaurs: JACK TENREC (tall, brown swept hair, open light-blue work shirt with rolled sleeves, leather holster harness, jeans, aiming a pistol), HANNAH DUNDEE (long dark violet-black hair, red cropped shirt tied at the waist, grey trousers, gun belt), MUSTAPHA CAIRO (green baseball cap with a plain front, green short-sleeved shirt, olive trousers, muscular, confident), MESS O\'BRADOVICH (huge, muscular, ginger hair, yellow sleeveless vest, fingerless gloves).';
const NO_TEXT = 'Absolutely no text, letters, numbers, logos, title, UI, buttons, frames or watermarks anywhere in the image.';
const IMAGES = {
  'key-bg': `The scenery of the attached mockup with NO characters, NO car and NO text: a ruined, overgrown coastal city at sunset, skyscraper ruins wrapped in jungle, waterfalls pouring off broken bridges, a huge T-rex head roaring from the jungle at the upper left, two silhouetted helicopters and a flying pterosaur against the orange-pink sky, raptors on rocks at the right, a broken steel bridge and a river in the lower right, dense foliage in the foreground corners. Keep the centre and lower half calm (open sky and distant ruins) because a title and characters are laid over it.`,
  'key-heroes': `Only the characters and the car from the attached mockup, on a perfectly flat solid magenta background (#FF00FF, no gradient, no shadow on the background, no ground, no scenery): ${CAST} Arrange them exactly like the mockup: Jack at the left aiming his pistol up-left, Hannah in front in the centre-left, Mustapha centre-right looking at the viewer, Mess at the right with clenched fists; a red 1950s Cadillac convertible with glowing headlights at the far left behind Jack, its front cut by the left edge. The figures are seen from the hips or knees up and fill the lower three quarters of the image, cut off by the bottom edge; their heads sit in the middle third. Crisp edges against the magenta, no magenta inside the characters.`,
  'slide-road': `A new scene in the same style: the red 1950s Cadillac convertible racing along a coral causeway road over turquoise water at golden hour, the four heroes riding in it (${CAST} small in the car, seen from the side and behind), raptors running alongside and a big armoured cargo hauler truck with a crane chasing behind, spray and dust, palm-lined ruined coast in the distance. Leave the left half of the upper area calmer for text.`,
  'slide-dam': `A new scene in the same style: a colossal concrete dam at night in heavy rain, floodlights, waterfalls thundering from its spillways, a gold crown emblem on the dam wall; on the dam crest a scarred military marshal in a long green coat with a brass shoulder brace and a heavy blade, and looming behind him the silhouette of a huge armoured dinosaur-man hybrid with a massive shield-like arm. Lightning over the mountains. Leave the left half of the upper area calmer for text.`,
  // the hero-select portraits (game.js characterSelect): one hero each, cut from the same painting's style
  ...Object.fromEntries([['jack', 'JACK TENREC (left in the reference; brown swept hair, light-blue open work shirt, holster harness), holding his pistol up beside his face'], ['hannah', 'HANNAH DUNDEE (second from left; long violet-black hair, red tied shirt, grey trousers), hand on her hip'], ['mustapha', 'MUSTAPHA CAIRO (third; green cap, green shirt, olive trousers), arms crossed'], ['mess', "MESS O'BRADOVICH (right; ginger hair, yellow sleeveless vest, huge arms, fingerless gloves), fist raised"]].map(([id, who]) => [`sel-${id}`, { ref: 'key-heroes.png', text: `ONE character only: ${who}, exactly as painted in the attached image (same face, hair, outfit and painting style). Alone, seen from the knees up, facing the viewer at a slight three-quarter angle, confident heroic pose, centred, filling the full height of a portrait image with the head in the upper quarter. Perfectly flat solid magenta background (#FF00FF), no gradient, no ground, no shadow, crisp edges, no magenta inside the character.` }])),
  'slide-wild': `A new scene in the same style: a vast glass biodome overgrown with jungle, its glass panes cracked with giant claw marks, a herd of freed dinosaurs (triceratops, a brachiosaur neck, raptors) running out through a broken gate into a misty valley at sunrise, broken cages and snapped collars on the ground. Leave the left half of the upper area calmer for text.`,
};
const spec = id => typeof IMAGES[id] === 'string' ? { ref: REF, text: IMAGES[id] } : IMAGES[id];
const prompt = (id, file) => [
  `Use your image generation tool to generate ONE image (${id.startsWith('sel-') ? 'tall portrait, about 1024x1536' : 'wide landscape, about 1536x1024'}).`,
  spec(id).ref === REF ? `REFERENCE: the attached image ${REF} is the user's website mockup; use it for the painting style, palette and (where asked) the composition only. Do not copy its text, logo, buttons or frame.` : `REFERENCE: the attached image ${spec(id).ref} shows the four heroes; copy the named one exactly.`,
  `SUBJECT: ${spec(id).text}`, `STYLE: ${STYLE}`, NO_TEXT,
  `Save the generated PNG unchanged (no resize, no recolour, no post-processing) as ${file} in the current directory.`].join('\n');

function findExe() {
  if (process.env.CODEX_EXE) return process.env.CODEX_EXE;
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
  const hits = fs.existsSync(base) ? fs.readdirSync(base).map(d => path.join(base, d, 'codex.exe')).filter(f => fs.existsSync(f)) : [];
  hits.sort((p, q) => fs.statSync(q).mtimeMs - fs.statSync(p).mtimeMs); if (!hits.length) throw new Error('codex.exe not found'); return hits[0];
}
// only this run's own Codex session folder (several jobs run at once)
function sessionImage(since, session) {
  const dir = path.join(os.homedir(), '.codex', 'generated_images', session || '-'); if (!session || !fs.existsSync(dir)) return null;
  let best = null; for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f), m = fs.statSync(p).mtimeMs; if (/\.png$/i.test(f) && m >= since && (!best || m > best.m)) best = { p, m }; }
  return best && best.p;
}
function run(id, force) {
  return new Promise(resolve => {
    const file = `${id}.png`, out = path.join(OUT, file);
    if (fs.existsSync(out) && !force) { console.log(`skip ${id}`); return resolve(true); }
    const t0 = Date.now() - 2000, text = prompt(id, file); fs.writeFileSync(path.join(OUT, `${id}.prompt.txt`), text);
    console.log(`codex: ${id}`);
    const ch = cp.spawn(findExe(), ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-i', spec(id).ref, '-'], { cwd: OUT, windowsHide: true });
    let log = ''; ch.stdout.on('data', d => log += d); ch.stderr.on('data', d => log += d); ch.stdin.end(text);
    const kill = setTimeout(() => ch.kill(), 480000);
    ch.on('close', code => {
      clearTimeout(kill); fs.writeFileSync(path.join(OUT, `${id}.log.txt`), log);
      if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < t0) { const g = sessionImage(t0, (/session id:\s*([0-9a-f-]+)/i.exec(log) || [])[1]); if (g) fs.copyFileSync(g, out); }
      const ok = fs.existsSync(out) && fs.statSync(out).mtimeMs >= t0; console.log(`  ${ok ? 'ok' : 'FAIL'} ${id} (exit ${code})`); resolve(ok);
    });
  });
}
if (require.main === module) {
  const a = process.argv.slice(2), force = a.includes('--force'), jobs = +(a[a.indexOf('--jobs') + 1] || 2) || 2;
  fs.mkdirSync(OUT, { recursive: true });
  if (a.includes('--list')) { console.log(Object.keys(IMAGES).join('\n')); process.exit(0); }
  const ids = a.includes('--run-all') ? Object.keys(IMAGES) : a.slice(a.indexOf('--run') + 1).filter(x => IMAGES[x]);
  if (!ids.length) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 8).join('\n')); process.exit(2); }
  (async () => { const q = [...ids]; await Promise.all(Array.from({ length: Math.min(jobs, q.length) }, async () => { while (q.length) await run(q.shift(), force); })); })();
}
