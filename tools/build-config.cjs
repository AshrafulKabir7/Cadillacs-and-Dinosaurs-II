// Regenerates combat-config.js from combat-config.json (compact JSON, source key order, UTF-8, LF). It began as the Node
// port of the retired tools/build-config.py and kept its output byte for byte; G8 renamed the header to this script.
// Usage: node tools/build-config.cjs [--out <file>] [--check]
//   --out    write somewhere else (the default is <repo>/combat-config.js)
//   --check  do not write; exit 1 if the shipped file differs from a fresh build
'use strict';
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HEADER = '// Generated from combat-config.json by tools/build-config.cjs.\n';

// Returns the exact text of combat-config.js for the given JSON source text.
function render(jsonText) {
  const c = JSON.parse(jsonText);
  return HEADER + 'window.COMBAT_CONFIG = ' + JSON.stringify(c) + ';\n';
}

// build({root, out}) -> {out, text, changed}
function build({ root = ROOT, out = null, write = true } = {}) {
  const src = path.join(root, 'combat-config.json');
  const dst = out || path.join(root, 'combat-config.js');
  const text = render(fs.readFileSync(src, 'utf8'));
  const old = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : null;
  const changed = old !== text;
  if (write && changed) fs.writeFileSync(dst, text, 'utf8');
  return { src, out: dst, text, changed };
}

module.exports = { ROOT, HEADER, render, build };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : null;
  if (argv.includes('--check')) {
    const r = build({ out, write: false });
    if (r.changed) { console.error(`combat-config: ${path.relative(ROOT, r.out)} differs from a fresh build of combat-config.json`); process.exit(1); }
    console.log(`combat-config: ${path.relative(ROOT, r.out)} is up to date (${Buffer.byteLength(r.text)} bytes)`);
  } else {
    const r = build({ out });
    console.log(`combat-config: ${r.changed ? 'wrote' : 'unchanged'} ${path.relative(ROOT, r.out)} (${Buffer.byteLength(r.text)} bytes)`);
  }
}
