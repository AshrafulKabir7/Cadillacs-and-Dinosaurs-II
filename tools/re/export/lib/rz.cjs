// Rizin / REA helpers for the export scripts (static analysis of work/re/dino-prg.bin, offset == address).
//   pd(addr, n)            -> disassembly text of n instructions at addr (plain rizin, cached in work/re/extract/.rzcache)
//   rea(label, cmds, dir)  -> runs the commands through REA, keeps the evidence record in <dir>/<label>.json/.txt,
//                             returns {id, text}. Use it for key findings.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '../../../..');
const BIN = path.join(ROOT, 'work/re/dino-prg.bin').replace(/\\/g, '/');
const RZBIN = 'E:/tools/rizin/rizin-win-installer-clang_cl-64/bin';
const CACHE = path.join(ROOT, 'work/re/extract/.rzcache');
const PRE = 'e scr.color=0; e asm.arch=m68k; e asm.cpu=68000; e asm.bits=32; e asm.bytes=true; ';
const env = () => ({ ...process.env, PATH: RZBIN + path.delimiter + process.env.PATH });

function rz(cmds) {
  fs.mkdirSync(CACHE, { recursive: true });
  const key = crypto.createHash('sha1').update(cmds).digest('hex').slice(0, 16), f = path.join(CACHE, key + '.txt');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const out = execFileSync(path.join(RZBIN, 'rizin.exe'), ['-q', '-c', PRE + cmds, BIN], { env: env(), maxBuffer: 64 << 20 }).toString().replace(/\r/g, '');
  fs.writeFileSync(f, out);
  return out;
}
const pd = (addr, n = 40) => rz(`pd ${n} @ 0x${addr.toString(16)}`);

function rea(label, cmds, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const jf = path.join(dir, label + '.json'), tf = path.join(dir, label + '.txt');
  if (fs.existsSync(jf)) { const j = JSON.parse(fs.readFileSync(jf, 'utf8')); return { id: j.evidence_id, text: j.raw_result.stdout.replace(/\r/g, '') }; }
  // through Git Bash, as tools/re/rea-ev.sh does (the npm shim needs a shell; bash keeps the argument intact)
  const raw = execFileSync('bash', ['-c', 'export PATH="/e/tools/rizin/rizin-win-installer-clang_cl-64/bin:$PATH"; rea execute-rizin-command "$0" "$1" --format json 2>/dev/null', BIN, PRE + cmds], { maxBuffer: 64 << 20 }).toString();
  const j = JSON.parse(raw);
  fs.writeFileSync(jf, JSON.stringify(j, null, 1));
  fs.writeFileSync(tf, j.raw_result.stdout.replace(/\r/g, ''));
  return { id: j.evidence_id, text: j.raw_result.stdout.replace(/\r/g, '') };
}
module.exports = { rz, pd, rea, BIN };
