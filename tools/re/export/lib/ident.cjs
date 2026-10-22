// Identify a ROM frame address as (list, anim, frame) of a hero, and summarise tap logs.
'use strict';
const S = require('./hero-static.cjs');
let A = null;
function all() { return A || (A = S.decodeAll()); }
function ident(c, addr) {
  const h = all().heroes[c];
  const hits = h.frameIndex.get(addr) || [];
  return hits;
}
// anims whose first frame is addr
function starts(c, addr) {
  const h = all().heroes[c]; const out = [];
  for (const l of h.lists) for (const an of l.anims) if (!an.terminator && parseInt(an.addr, 16) === addr) out.push(l.key + ':' + an.index);
  return out;
}
module.exports = { all, ident, starts };
