// Helpers over the unidasm listing work/re/static/full.dis (68000, offset == address).
// Research tooling only (sweeps); key findings are re-run through REA (tools/re/export/lib/rea.cjs).
'use strict';
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '../../../../work/re/static/full.dis');
let LINES = null, BYADDR = null;
function load() {
  if (LINES) return LINES;
  LINES = []; BYADDR = new Map();
  for (const l of fs.readFileSync(FILE, 'utf8').split('\n')) {
    const m = /^([0-9a-f]{6}): ((?:[0-9a-f]{4} ?)+)\s+(\S+)\s*(.*)$/.exec(l.replace(/\r$/, ''));
    if (!m) continue;
    const ins = { addr: parseInt(m[1], 16), bytes: m[2].trim(), op: m[3], args: m[4].trim(), text: (m[3] + ' ' + m[4]).trim() };
    ins.i = LINES.length; LINES.push(ins); BYADDR.set(ins.addr, ins);
  }
  return LINES;
}
const at = a => { load(); return BYADDR.get(a); };
function range(a, b) { load(); const s = at(a); if (!s) return []; const out = []; for (let i = s.i; i < LINES.length && LINES[i].addr < b; i++) out.push(LINES[i]); return out; }
function prev(ins, k = 1) { load(); return LINES[ins.i - k]; }
function next(ins, k = 1) { load(); return LINES[ins.i + k]; }
// all instructions whose text matches re
function grep(re) { load(); return LINES.filter(l => re.test(l.text)); }
// target of a jsr/jmp/bsr/bra/bcc with an absolute $hex operand
function target(ins) { const m = /^\$([0-9a-f]+)(?:\.[lw])?$/.exec(ins.args); return m ? parseInt(m[1], 16) : null; }
const hex = n => '0x' + n.toString(16).toUpperCase();
module.exports = { load, at, range, prev, next, grep, target, hex };
