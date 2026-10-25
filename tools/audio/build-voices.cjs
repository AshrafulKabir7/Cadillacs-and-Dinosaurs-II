// Builds assets/sfx/voice/*.mp3 from the original arcade voice samples (work/audio/VOICES.md says what each clip is).
//   node tools/audio/build-voices.cjs [--src "<folder with M01.wav, V01.wav ...>"] [--check]
// Each clip is decoded to mono 22 050 Hz, its leading and trailing silence trimmed (-42 dB below its peak, 15 ms kept),
// given a 3 ms fade-in and a 25 ms fade-out, and gained so its loudest 50 ms sits at -13 dBFS RMS (peaks limited to
// -1 dBFS), which puts the voices level with assets/sfx/*.mp3. Encoded with libmp3lame at 64 kbps like those files.
// --check only reports which outputs are missing. Needs ffmpeg on PATH. The source folder is read, never written.
'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..'), OUT = path.join(ROOT, 'assets', 'sfx', 'voice');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const SRC = opt('--src', 'E:/Arcade - Cadillacs & Dinosaurs - Voices - Voices');
const SR = 22050;

// output name -> source clip. Kept in step with VOICE in game.js (tests/regression.cjs checks every file it names).
const MAP = require('./voice-map.json').files;

// A map entry is a clip id ("V12") or {src, semitones}: semitones < 0 lowers the pitch (and the formants with it) without
// changing the length (ffmpeg rubberband), used to make Mustapha's shouts read as the man who eats (V31).
const entry = v => (typeof v === 'string' ? { src: v, semitones: 0 } : { semitones: 0, ...v });
function decode(file, semitones = 0) {
  const r = Math.pow(2, semitones / 12), af = semitones ? ['-af', `aresample=44100,rubberband=pitch=${r.toFixed(5)}:pitchq=quality`] : [];
  const buf = cp.execFileSync('ffmpeg', ['-v', 'error', '-i', file, ...af, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
}
function prepare(x) {
  const W = Math.round(0.01 * SR), env = [];
  for (let i = 0; i < x.length; i += W) { let s = 0, n = 0; for (let k = i; k < Math.min(x.length, i + W); k++) { s += x[k] * x[k]; n++; } env.push(Math.sqrt(s / n)); }
  const peak = Math.max(...env), thr = peak * Math.pow(10, -42 / 20);
  let a = env.findIndex(v => v > thr), b = env.length - 1; while (b > a && env[b] <= thr) b--;
  const keep = Math.round(0.015 * SR), s0 = Math.max(0, a * W - keep), s1 = Math.min(x.length, (b + 1) * W + keep);
  const y = Float32Array.from(x.subarray(s0, s1));
  // loudest 50 ms RMS -> -13 dBFS
  const L = Math.round(0.05 * SR); let best = 0; let acc = 0;
  for (let i = 0; i < y.length; i++) { acc += y[i] * y[i]; if (i >= L) acc -= y[i - L] * y[i - L]; best = Math.max(best, acc); }
  const rms = Math.sqrt(best / Math.min(L, y.length)), gain = Math.pow(10, -13 / 20) / Math.max(1e-6, rms);
  const lim = Math.pow(10, -1 / 20), fi = Math.round(0.003 * SR), fo = Math.round(0.025 * SR);
  for (let i = 0; i < y.length; i++) {
    let v = y[i] * gain; v = Math.abs(v) > lim * 0.8 ? Math.sign(v) * (lim * 0.8 + (lim * 0.2) * Math.tanh((Math.abs(v) - lim * 0.8) / (lim * 0.2))) : v;
    if (i < fi) v *= i / fi; if (i > y.length - fo) v *= (y.length - i) / fo; y[i] = v;
  }
  return { y, trimmed: [(s0 / SR).toFixed(3), (s1 / SR).toFixed(3)], gainDb: (20 * Math.log10(gain)).toFixed(1) };
}
function encode(y, out) {
  const r = cp.spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', String(SR), '-ac', '1', '-map_metadata', '-1', out], { input: Buffer.from(y.buffer, y.byteOffset, y.byteLength) });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${out}: ${r.stderr}`);
}

const names = Object.keys(MAP);
if (argv.includes('--check')) { const miss = names.filter(n => !fs.existsSync(path.join(OUT, n + '.mp3'))); console.log(miss.length ? 'missing: ' + miss.join(', ') : `all ${names.length} voice files present`); process.exit(miss.length ? 1 : 0); }
if (!fs.existsSync(SRC)) { console.error(`source folder not found: ${SRC} (pass --src)`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const name of names) {
  const e = entry(MAP[name]), src = path.join(SRC, e.src + '.wav'), out = path.join(OUT, name + '.mp3');
  const p = prepare(decode(src, e.semitones)); encode(p.y, out); const sz = fs.statSync(out).size; total += sz;
  console.log(`${name.padEnd(22)} <- ${e.src}${e.semitones ? ` (${e.semitones} st)` : ''}  ${(p.y.length / SR).toFixed(2)} s (kept ${p.trimmed.join('-')} s, ${p.gainDb} dB)  ${(sz / 1024).toFixed(1)} KB`);
}
console.log(`${names.length} files, ${(total / 1024).toFixed(1)} KB in ${path.relative(ROOT, OUT)}`);
