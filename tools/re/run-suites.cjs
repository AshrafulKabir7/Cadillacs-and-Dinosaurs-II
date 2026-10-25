// Scratch harness for the sequential game.js steps (PLAN §0 G0, §7 rules, §8.1): runs every suite in tests/*.cjs one
// after the other from the repo root, plus a file:// smoke launch, and records the outcome per step.
//
//   node tools/re/run-suites.cjs [--step G1] [--url http://127.0.0.1:8766] [--only a,b] [--skip a,b] [--bot] [--retries N] [--no-file]
//
// --step     sets ARCADE_STEP for the suites (tests/lib/arcade.cjs: the SKIPs of steps <= it become failures) and
//            names the result file tests/results/suites-<step>.json (default: no ARCADE_STEP, file suites-latest.json)
// --url      GAME_URL (default $GAME_URL or http://127.0.0.1:8766). When nothing answers there and the host is
//            127.0.0.1/localhost, `node tools/serve.cjs <port>` is started for the run and stopped afterwards. Port
//            8790 (the user's preview server) is never started or stopped by this script.
// --bot      also runs tests/bot.cjs and copies its report to tests/results/bot-<step>.json (PLAN §8.2)
// --retries  re-runs a failed suite up to N times (timing gates such as rom-heroes (8) under load); every attempt is
//            recorded, and a suite counts as passed only when its last attempt exits 0
// --no-file  skips the file:// smoke launch
// Exit code 1 when any suite (or the smoke launch) fails. Nothing here touches git or the game files.
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TESTS = path.join(ROOT, 'tests'), RESULTS = path.join(TESTS, 'results'), LOGS = path.join(RESULTS, 'logs');
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def; };
const flag = name => argv.includes(name);
const list = s => (s ? String(s).split(',').map(x => x.trim().replace(/\.cjs$/, '')).filter(Boolean) : null);

const STEP = opt('--step', process.env.ARCADE_STEP || '');
const URL_ = opt('--url', process.env.GAME_URL || 'http://127.0.0.1:8766');
const ONLY = list(opt('--only', '')), SKIP = list(opt('--skip', '')) || [];
const RETRIES = Math.max(0, +opt('--retries', 0) || 0);
// The nine original suites first (PLAN §8.1 order), then the new ones; bot only on request (it is a timing gate).
const ORDER = ['armed-actions', 'combat', 'polish', 'regression', 'sequel', 'specification', 'story', 'mobile', 'framing', 'enemies', 'campaign', 'ui', 'rom-heroes', 'assets', 'perf'];

function suites() {
  const found = fs.readdirSync(TESTS).filter(f => f.endsWith('.cjs')).map(f => f.slice(0, -4));
  let names = ORDER.filter(n => found.includes(n)).concat(found.filter(n => !ORDER.includes(n) && n !== 'bot').sort());
  if (ONLY) names = names.filter(n => ONLY.includes(n));
  names = names.filter(n => !SKIP.includes(n));
  if (flag('--bot') && found.includes('bot') && !SKIP.includes('bot')) names.push('bot');
  return names;
}

const answers = u => new Promise(res => {
  const req = http.get(u, r => { r.resume(); res(r.statusCode > 0 && r.statusCode < 500); });
  req.on('error', () => res(false)); req.setTimeout(3000, () => { req.destroy(); res(false); });
});
async function ensureServer() {
  if (await answers(URL_)) return null;
  const u = new URL(URL_);
  if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) || !/^http:$/.test(u.protocol)) throw new Error(`nothing answers at ${URL_}`);
  const port = +(u.port || 80);
  if (port === 8790) throw new Error('port 8790 is the user\'s preview server: start it yourself or pass another --url');
  const child = cp.spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.cjs'), String(port)], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { if (await answers(URL_)) return child; await new Promise(r => setTimeout(r, 100)); }
  child.kill(); throw new Error(`tools/serve.cjs ${port} did not come up`);
}

// The last JSON object printed by a suite ({passed, failed, ...} or the regression report), best effort.
function summary(out) {
  const objs = [];
  for (const m of out.matchAll(/\{[^{}]*"(?:passed|suite)"[^{}]*\}/g)) { try { objs.push(JSON.parse(m[0])); } catch (e) { /* not JSON */ } }
  const last = objs[objs.length - 1] || null;
  const fails = out.split(/\r?\n/).filter(l => /^\s*FAIL\b/.test(l)).slice(0, 12);
  return { last, fails };
}

function runOne(name, env) {
  const t0 = Date.now();
  const r = cp.spawnSync(process.execPath, [path.join('tests', name + '.cjs')], { cwd: ROOT, env, encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 64 * 1048576 });
  const out = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '');
  return { status: r.status, signal: r.signal || null, error: r.error ? r.error.message : null, seconds: +((Date.now() - t0) / 1000).toFixed(1), out };
}

// file:// launch: the page must become ready, run a chapter and render with no page error (PLAN §7: every step stays
// playable from file://). Uses the shared helpers so it waits on the same gate as the suites.
async function fileSmoke() {
  const A = require(path.join(TESTS, 'lib', 'arcade.cjs'));
  const { browser, page, errors } = await A.launch();
  try {
    await A.prepare(page, { seed: 15454 });
    await A.open(page, { file: true, sound: false });
    const r = await page.evaluate(() => {
      const g = LAST_EDEN, out = { sprites: window.SPRITES ? { ready: SPRITES.ready, verified: SPRITES.verified } : null, compat: !!(window.ARCADE_HEROES && ARCADE_HEROES.compat) };
      for (let level = 0; level < window.EDEN_CAMPAIGN.length; level++) { g.start(level, level % 4); for (let i = 0; i < 90; i++) g.step(1 / 60); g.render(); }
      out.state = g.state; return out;
    });
    const ok = !errors.length && r.state === 'play' && (!r.sprites || (r.sprites.ready && r.sprites.verified));
    return { ok, detail: r, errors };
  } finally { await browser.close(); }
}

(async () => {
  fs.mkdirSync(LOGS, { recursive: true });
  const names = suites(), tag = STEP || 'latest';
  const server = await ensureServer();
  const env = Object.assign({}, process.env, { GAME_URL: URL_, NODE_PATH: [path.join(TESTS, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter) });
  if (STEP) env.ARCADE_STEP = STEP; else delete env.ARCADE_STEP;
  const rows = [];
  try {
    for (const name of names) {
      const attempts = [];
      for (let a = 0; a <= RETRIES; a++) {
        const r = runOne(name, env), s = summary(r.out);
        fs.writeFileSync(path.join(LOGS, `${tag}-${name}${a ? '-' + a : ''}.log`), r.out);
        attempts.push({ status: r.status, signal: r.signal, error: r.error, seconds: r.seconds, summary: s.last, fails: s.fails });
        if (r.status === 0) break;
      }
      const last = attempts[attempts.length - 1], passed = last.status === 0;
      rows.push({ suite: name, passed, attempts });
      console.log(`${passed ? 'PASS' : 'FAIL'}  ${name.padEnd(14)} ${String(last.seconds).padStart(6)} s  ${attempts.length > 1 ? `(${attempts.length} attempts) ` : ''}${last.summary ? JSON.stringify(last.summary).slice(0, 160) : ''}`);
      for (const f of last.fails) console.log('        ' + f.slice(0, 220));
      if (name === 'bot' && passed && fs.existsSync(path.join(RESULTS, 'bot-report.json'))) fs.copyFileSync(path.join(RESULTS, 'bot-report.json'), path.join(RESULTS, `bot-${tag}.json`));
    }
    let smoke = null;
    if (!flag('--no-file') && !(ONLY && !ONLY.includes('file'))) {
      try { smoke = await fileSmoke(); } catch (e) { smoke = { ok: false, errors: [String(e && e.message || e)] }; }
      console.log(`${smoke.ok ? 'PASS' : 'FAIL'}  file:// smoke   ${JSON.stringify(smoke.detail || {})} ${smoke.errors && smoke.errors.length ? smoke.errors.join(' | ') : ''}`);
    }
    const report = { step: STEP || null, url: URL_, at: new Date().toISOString(), node: process.version, suites: rows, fileSmoke: smoke, passed: rows.every(r => r.passed) && (!smoke || smoke.ok) };
    fs.writeFileSync(path.join(RESULTS, `suites-${tag}.json`), JSON.stringify(report, null, 2));
    console.log(`${report.passed ? 'ALL GREEN' : 'FAILURES'}: ${rows.filter(r => r.passed).length}/${rows.length} suites${smoke ? `, file:// ${smoke.ok ? 'ok' : 'failed'}` : ''} -> tests/results/suites-${tag}.json`);
    process.exitCode = report.passed ? 0 : 1;
  } finally { if (server) server.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
