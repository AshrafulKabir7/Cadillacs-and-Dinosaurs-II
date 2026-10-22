// Enemy attacks on the heroes in the original Cadillacs & Dinosaurs: the static attack ids each handler writes, the
// damage records and the exact damage model. Research only; never shipped.
//
// OBSERVED code (REA evidence e04, e05, e11 in work/re/extract/enemies/evidence/):
//   0x116B2  record = 0xA2EA4 + (attacker +0x58) * 8 (b0 damage, b1 stun, b2 reaction, b3..b7 as R4); hero +0x6E = +0x6C;
//            D1 = b0; jsr 0x6422; hero +0x6C -= D1 (clamped at 0)
//   0x6422   if word 0xFF84AA != 0 and bit 1 of byte 0xFF8024 is set: D1 = 0 (no damage) and return      (0x6422-0x6430, 0x64F2)
//            D1 = D1 * byte[0x2C3AE + (attacker +0x84) * 8 + (lvl & 0x1F)] >> 5     lvl = word 0xFF85EE  (0x6434-0x6452)
//            bracket = 0 (hero HP >= 0x4C), 0x40 (>= 0x33), 0x80 (>= 0x1A), 0xC0
//            D1 -= word[0x2C896 + bracket + (random & 0x3E)]; if D1 < 0: D1 = 1                         (0x6454-0x6496)
//            D1 = D1 * word[0x2C88E + hero id * 2] >> 5                                                   (0x6498-0x64AC)
//            D1 = D1 * word[0x2C996 + ((hero HP >> 2) & 0x1E)] >> 5; if D1 == 0: D1 = 1                   (0x64AE-0x64CA)
//            if hero HP != 1 and hero HP <= D1 and D1 - HP < 5: D1 = HP - 1 (the hero survives at 1 HP)  (0x64CC-0x64EC)
//   The reduction table is 0 everywhere except the last 1-3 entries of brackets 1-3 (2, 3 3, 4 4 4), so the random
//   term only matters below 76 HP.
'use strict';
const R = require('../rom.cjs');
const hex = (v, n = 0) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');

const ENEMY_DMG = 0xA2EA4, MULT_TABLE = 0x2C3AE, RED_TABLE = 0x2C896, HERO_TABLE = 0x2C88E, HPF_TABLE = 0x2C996;
const HEROES = ['Jack', 'Mustapha', 'Hannah', 'Mess'];   // character id order (V27)

// pool-B dispatch table 0x2346C (V08): handler per type; ranges = [handler, next higher handler)
const DISPATCH_B = 0x2346C, DISPATCH_B_TYPES = 0x198;
function handlers() {
  const m = new Map();
  for (let t = 0; t < DISPATCH_B_TYPES; t += 4) { const h = R.u32(DISPATCH_B + t); if (h > 0x400 && h < 0x100000) m.set(t, h); }
  return m;
}
const H = handlers();
const SORTED = [...new Set(H.values())].sort((a, b) => a - b);
function handlerOf(type) { return H.get(type) ?? null; }
function rangeOf(h) { return [h, SORTED.find(x => x > h) ?? h + 0x1000]; }

// move.b #id,($58,A6) = 1D7C 00ii 0058 inside [start, end)
function staticAttackIds(start, end) {
  const out = [];
  for (let a = start; a < end - 6; a += 2) if (R.u16(a) === 0x1D7C && R.u16(a + 4) === 0x0058 && (R.u16(a + 2) >> 8) === 0) out.push({ id: R.u16(a + 2) & 0xFF, at: a });
  return out;
}
// does the handler range ever write +0x84 (move.w #imm,($84,A6))? projectiles that do not inherit the previous occupant's
function writesR84(start, end) {
  const out = [];
  for (let a = start; a < end - 6; a += 2) if (R.u16(a) === 0x3D7C && R.u16(a + 4) === 0x0084) out.push({ value: R.u16(a + 2), at: a });
  return out;
}

function record(id) {
  const a = ENEMY_DMG + id * 8, b = [...R.prg.subarray(a, a + 8)];
  return { attackId: id, addr: hex(a), bytes: b.map(x => hex(x, 2)), damage: b[0], stun: b[1], reaction: b[2] };
}
const mult = (r84, lvl) => R.prg[MULT_TABLE + r84 * 8 + (lvl & 31)];
const bracketOf = hp => hp >= 0x4C ? 0 : hp >= 0x33 ? 0x40 : hp >= 0x1A ? 0x80 : 0xC0;

// exact 0x6422 + the 0x116B2 HP update; rand = the random word's (& 0x3E) offset 0..0x3E (even)
function damage(b0, r84, lvl, heroHp = 100, hero = 0, { rand = 0, bypass = false } = {}) {
  if (bypass) return 0;
  let d = (b0 * mult(r84, lvl)) >>> 5;
  d -= R.s16(RED_TABLE + bracketOf(heroHp) + (rand & 0x3E));
  if (d < 0) d = 1;
  d = (d * R.s16(HERO_TABLE + hero * 2)) >>> 5;
  d = (d * R.s16(HPF_TABLE + ((heroHp >> 2) & 0x1E))) >>> 5;
  if (d === 0) d = 1;
  if (heroHp !== 1 && heroHp <= d && d - heroHp < 5) d = heroHp - 1;
  return d;
}
function damageRange(b0, r84, lvl, heroHp = 100, hero = 0) {
  const all = Array.from({ length: 32 }, (_, i) => damage(b0, r84, lvl, heroHp, hero, { rand: i * 2 }));
  return { min: Math.min(...all), max: Math.max(...all) };
}
// prediction table for one attack id and attacker +0x84 (the multiplier row)
function predict(id, r84, lvl) {
  const b0 = R.prg[ENEMY_DMG + id * 8];
  return {
    multiplierRow: hex(MULT_TABLE + r84 * 8), r84: hex(r84, 2),
    jackFullHpByLevel: Array.from({ length: 32 }, (_, l) => damage(b0, r84, l, 100, 0)),
    byHeroFullHp: Object.fromEntries(HEROES.map((h, i) => [h, damage(b0, r84, lvl, 100, i)])),
    atLevel: lvl,
  };
}
const tables = () => ({
  heroFactor: Object.fromEntries(HEROES.map((h, i) => [h, R.s16(HERO_TABLE + i * 2)])),
  hpFactor: Array.from({ length: 16 }, (_, i) => R.s16(HPF_TABLE + i * 2)),
  reductionByBracket: [0, 0x40, 0x80, 0xC0].map(b => Array.from({ length: 32 }, (_, i) => R.s16(RED_TABLE + b + i * 2))),
});

module.exports = { ENEMY_DMG, MULT_TABLE, HEROES, handlerOf, rangeOf, staticAttackIds, writesR84, record, damage, damageRange, predict, mult, tables, hex };
