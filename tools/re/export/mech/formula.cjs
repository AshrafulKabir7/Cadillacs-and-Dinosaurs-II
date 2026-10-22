// Damage formulas of the original Cadillacs & Dinosaurs as decoded from the code (see static.cjs), used to predict
// every hit measured live. The random factors are enumerated, so a prediction is the SET of values the game can
// produce for that hit; a measurement is "explained" when it is in the set.
//   heroHit   : 0x2B904 (melee and grab hits; attacker = hero)          -> record 0xA26FC[hero] + id*4
//   weaponHit : 0x2BA2A (weapon objects / thrown items / projectiles)    -> same records, hero by the object's +0x03
//   enemyHit  : 0x6422  (enemy attack on a hero)                         -> record 0xA2EA4 + id*8
'use strict';
const R = require('../../rom.cjs');
const u8 = a => R.prg[a], u16 = a => R.u16(a), u32 = a => R.u32(a) >>> 0;

function heroRecord(heroId, attackId) { const a = u32(0xA26FC + heroId * 4) + attackId * 4; return [...R.prg.slice(a, a + 8)]; }
function enemyRecord(attackId) { const a = 0xA2EA4 + attackId * 8; return [...R.prg.slice(a, a + 8)]; }

// the 32 random entries of a 0x40-byte word block -> distinct values
const block = (t, off) => { const s = new Set(); for (let k = 0; k < 32; k++) s.add(u16(t + off + k * 2)); return [...s]; };
function hpBlocks(hp) { // 0x2B9B2..0x2B9C8: one 0x40 step per 100 HP above the first, D3 = HP left in the current bar
  let d2 = 0, d3 = hp & 0xFFFF;
  while (d3 > 100) { d2 += 0x40; d3 -= 100; }
  return { bars: d2, rest: d3 };
}
function bandOff(rest) { return rest >= 0x4B ? 0 : rest >= 0x32 ? 0x40 : rest >= 0x19 ? 0x80 : 0xC0; }

// common pre-power part of 0x2B904 / 0x2BA2A
function preMods(D, { victimR84, victimB2e, victimAttackId, attackId }) {
  const flags = [];
  if (victimB2e === 4) { const m = u16(0xA320C + victimAttackId * 2); if (m) { D = (D * m) >>> 5; flags.push(`counter x${m}/32`); } }
  const w = 0xA32FA + victimR84;
  if (attackId === (u8(w) * 2 & 0xFF)) { D = (D * u8(w + 1)) >>> 5; flags.push(`weakness x${u8(w + 1)}/32`); }
  else if (attackId === (u8(w + 2) * 2 & 0xFF)) { D = (D * u8(w + 3)) >>> 5; flags.push(`weakness x${u8(w + 3)}/32`); }
  return { D, flags };
}
function tail(D, victimHp, longShift) {
  const { bars, rest } = hpBlocks(victimHp);
  const out = new Set();
  for (const f1 of block(0x2BC4E, Math.min(bars, 9 * 0x40))) for (const f2 of block(0x2BB4E, bandOff(rest))) {
    let v = ((D * f1) & 0xFFFF) * f2;                 // mulu.w: the second multiply uses the low word of D*f1
    v = longShift ? (v >>> 10) : (((v & 0xFFFF) >>> 10) | 0);   // 0x2BA1C lsr.w (melee) vs 0x2BB4A lsr.l (weapons)
    if (longShift) { out.add(v & 0xFFFF); } else { out.add(v === 0 ? 1 : v); }
  }
  return [...out].sort((a, b) => a - b);
}
// melee / grab: 0x2B904
function heroHit({ heroId, attackId, power = 32, victimR84 = 0, rank = 0, victimHp = 100, victimB2e = 0, victimAttackId = 0 }) {
  const rec = heroRecord(heroId, attackId);
  let { D, flags } = preMods(rec[0], { victimR84, victimB2e, victimAttackId, attackId });
  D = D * power;
  D = (D * u8(0x2BECE + victimR84 * 8 + rank)) >>> 10; if (D === 0) D = 1;
  return { record: rec, flags, values: tail(D, victimHp, false) };
}
// weapon object: 0x2BA2A (power from the owner player when +0x02 >= 0)
function weaponHit({ heroId, attackId, power = 32, ownerPlayer = 0, victimR84 = 0, rank = 0, victimHp = 100, victimB2e = 0, victimAttackId = 0, blunt = null }) {
  const rec = heroRecord(heroId, attackId);
  if (attackId === 0x6C || attackId === 0x6E) return { record: rec, flags: ['fixed damage (0x111C6): signed b0, cannot drop HP below 1'], values: [(rec[0] << 24) >> 24] };
  let D = rec[0], flags = [];
  if (blunt != null) { const c = blunt; const m = c <= 0x0F ? 32 : c <= 0x1E ? 0x28 : c <= 0x2D ? 0x30 : 0x40; if (m !== 32) { D = (D * m) >>> 5; flags.push(`charge x${m}/32`); } }
  const p = preMods(D, { victimR84, victimB2e, victimAttackId, attackId }); D = p.D; flags = flags.concat(p.flags);
  if (ownerPlayer >= 0) D = D * power;
  D = (D * u8(0x2BECE + victimR84 * 8 + rank)) >>> 10; if (D === 0) D = 1;
  const vals = new Set(), { bars, rest } = hpBlocks(victimHp);
  for (const f1 of block(0x2BC4E, Math.min(bars, 9 * 0x40))) for (const f2 of block(0x2BB4E, bandOff(rest))) vals.add((((D * f1) & 0xFFFF) * f2) >>> 10);
  return { record: rec, flags, values: [...vals].map(v => v & 0xFFFF).sort((a, b) => a - b) };
}
// enemy on hero: 0x6422
function enemyHit({ attackId, attackerR84 = 0, rank = 0, heroId = 0, heroHp = 100 }) {
  const rec = enemyRecord(attackId);
  let D = (rec[0] * u8(0x2C3AE + attackerR84 * 8 + (rank & 0x1F))) >>> 5;
  const band = heroHp >= 0x4C ? 0 : heroHp >= 0x33 ? 0x40 : heroHp >= 0x1A ? 0x80 : 0xC0;
  const out = new Set();
  for (const r of block(0x2C896, band)) {
    let d = (D - r) << 16 >> 16; if (d < 0) d = 1;   // sub.w; bpl -> else 1  (0 stays 0 here, then max(.,1) below)
    d = (d * u16(0x2C88E + heroId * 2)) >>> 5;
    d = (d * u16(0x2C996 + ((heroHp >> 2) & 0x1E))) >>> 5; if (d === 0) d = 1;
    if (heroHp !== 1 && d >= heroHp && d - heroHp < 5) d = heroHp - 1;
    out.add(d);
  }
  return { record: rec, values: [...out].sort((a, b) => a - b) };
}
module.exports = { heroRecord, enemyRecord, heroHit, weaponHit, enemyHit, hpBlocks, bandOff };
