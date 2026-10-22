// Build manifest: sha256 of every input and output per target -> tools/re/build/manifest.json (PLAN §5.1).
//   read() -> manifest object            update(target, {inputs, outputs, extra}) -> merges and writes
//   verify() -> {ok, stale, missing}     romParts() / romVerify() / romSha1()      hashFile(p, algo)
// Paths are stored relative to the repo root with forward slashes. No timestamps; the Node and zlib versions
// are recorded because PNG bytes are only reproducible for one zlib build (check compares decoded pixels).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PATH = path.join(__dirname, 'manifest.json');
const ROM_DIR = process.env.DINO_ROMS || 'E:/mostafa/dino';
const PROGRAM_ROMS = ['cde_23a.8f', 'cde_22a.7f', 'cde_21a.6f'];
const GFX_ROMS = ['cd-1m.3a', 'cd-3m.5a', 'cd-2m.4a', 'cd-4m.6a', 'cd-5m.7a', 'cd-7m.9a', 'cd-6m.8a', 'cd-8m.10a'];

const rel = p => path.relative(ROOT, path.resolve(ROOT, p)).split(path.sep).join('/');
const abs = p => path.resolve(ROOT, p);
function hashBuffer(buf, algo = 'sha256') { return crypto.createHash(algo).update(buf).digest('hex'); }
function hashFile(p, algo = 'sha256') { return hashBuffer(fs.readFileSync(abs(p)), algo); }
function hashMap(paths, algo = 'sha256') {
  const out = {};
  for (const p of [...new Set(paths.map(rel))].sort()) if (fs.existsSync(abs(p))) out[p] = hashFile(p, algo);
  return out;
}
const md5Of = paths => hashMap(paths, 'md5');

function skeleton() { return { version: 1, tool: 'tools/re/build-game-assets.cjs', node: process.version, zlib: process.versions.zlib, rom: null, targets: {} }; }
function read() {
  if (!fs.existsSync(PATH)) return skeleton();
  try { return JSON.parse(fs.readFileSync(PATH, 'utf8')); } catch (e) { return skeleton(); }
}
function write(m) {
  const emit = require('./emit.cjs');
  return emit.json(PATH, m);
}
// Merge one target's record. inputs/outputs: path lists (hashed here) or ready {path: sha256} maps.
// A path recorded under several targets (the `manifest` target lists every shipped output beside the builder's own
// record) is kept in sync: the hashes just computed replace that path's hash in every other record, so a standalone
// `check` after a single-target rebuild sees the manifest fresh (no record is ever older than the newest build).
function update(target, { inputs = [], outputs = [], extra = null, rom = false } = {}) {
  const m = read();
  m.version = 1; m.tool = 'tools/re/build-game-assets.cjs'; m.node = process.version; m.zlib = process.versions.zlib;
  const rec = { inputs: Array.isArray(inputs) ? hashMap(inputs) : inputs, outputs: Array.isArray(outputs) ? hashMap(outputs) : outputs };
  if (extra) rec.extra = extra;
  m.targets[target] = rec;
  for (const [t, other] of Object.entries(m.targets)) {
    if (t === target) continue;
    for (const kind of ['inputs', 'outputs']) for (const [p, h] of Object.entries(rec[kind] || {})) {
      if (other.outputs && Object.prototype.hasOwnProperty.call(other.outputs, p)) other.outputs[p] = h;
      if (other.inputs && Object.prototype.hasOwnProperty.call(other.inputs, p)) other.inputs[p] = h;
    }
  }
  if (rom) m.rom = romSummary();
  write(m);
  return m;
}
// Every recorded output must still hash the same on disk (R18: stale generated files).
function verify() {
  const m = read(), stale = [], missing = [];
  for (const [t, rec] of Object.entries(m.targets || {})) for (const [p, h] of Object.entries(rec.outputs || {})) {
    if (!fs.existsSync(abs(p))) missing.push(`${t}: ${p}`);
    else if (hashFile(p) !== h) stale.push(`${t}: ${p}`);
  }
  return { ok: !stale.length && !missing.length, stale, missing, targets: Object.keys(m.targets || {}) };
}

// ROM part hashes (the files are only hashed, never copied or decoded here).
function romParts() {
  const out = {};
  for (const f of [...PROGRAM_ROMS, ...GFX_ROMS]) { const p = path.join(ROM_DIR, f); out[f] = fs.existsSync(p) ? hashBuffer(fs.readFileSync(p)) : null; }
  return out;
}
// Cross-check with original-rom-hashes.json at the repo root.
function romVerify() {
  const want = JSON.parse(fs.readFileSync(path.join(ROOT, 'original-rom-hashes.json'), 'utf8'));
  const have = romParts(), mismatches = [], missing = [];
  for (const [f, h] of Object.entries(have)) {
    if (!h) { missing.push(f); continue; }
    if (want[f] && want[f].sha256 !== h) mismatches.push(f);
  }
  return { ok: !mismatches.length && !missing.length, mismatches, missing };
}
// sha1 of the three program ROMs concatenated in load order: the `build.rom` field of every SPRITE_DATA family.
let romSha1Cache = null;
function romSha1() {
  if (romSha1Cache) return romSha1Cache;
  const h = crypto.createHash('sha1');
  for (const f of PROGRAM_ROMS) h.update(fs.readFileSync(path.join(ROM_DIR, f)));
  return (romSha1Cache = h.digest('hex'));
}
function romSummary() {
  const v = romVerify();
  return { dir: ROM_DIR, sha1: v.missing.length ? null : romSha1(), parts: romParts(), verified: v.ok, mismatches: v.mismatches, missing: v.missing };
}

module.exports = { ROOT, PATH, ROM_DIR, PROGRAM_ROMS, GFX_ROMS, rel, abs, hashBuffer, hashFile, hashMap, md5Of, read, write, update, verify, romParts, romVerify, romSha1, romSummary, skeleton };
