// REA evidence records for the key code behind the mechanics export (one `rea execute-rizin-command` per site;
// records are kept in work/re/extract/mechanics/evidence/<label>.json/.txt and their ids in evidence.json).
// Re-running is cheap: lib/rz.cjs rea() reuses an existing record.
'use strict';
const fs = require('fs'), path = require('path');
const RZ = require('../lib/rz.cjs');

const SITES = [
  ['m01-hero-hit-melee', 0x10A1E, 60, 'hero melee hit: record 0xA26FC[id]+(+0x58)*4, modifier 0x2B904, HP/stun/reaction/hit-stop/sound/score/effect, mega crash HP cost'],
  ['m02-hero-dmg-modifier', 0x2B904, 80, 'hero damage modifier: counter 0xA320C, weakness 0xA32FA, power +0xC6, victim factor 0x2BECE, random factors 0x2BC4E/0x2BB4E'],
  ['m03-weapon-dmg-modifier', 0x2BA2A, 70, 'weapon-object damage modifier (owner power via 0x2B002, lsr.l)'],
  ['m04-weapon-hit', 0x11072, 60, 'weapon object hit: same record table by the object +0x03, ids 0x6C/0x6E fixed, blunt charge 0x11262'],
  ['m05-blunt-charge', 0x11262, 16, 'blunt weapon charge factor by holder +0x80'],
  ['m06-enemy-hit', 0x116B2, 40, 'enemy -> hero hit: record 0xA2EA4 + id*8, modifier 0x6422, +0xF6 = 0x78'],
  ['m07-enemy-dmg-modifier', 0x6422, 50, 'enemy damage modifier: 0x2C3AE rank row, 0x2C896 random reduction, 0x2C88E hero toughness, 0x2C996 low-HP factor, survive-with-1'],
  ['m08-hero-power', 0x11738, 18, 'hero power +0xC6 re-roll from 0x2C9B6 by HP band'],
  ['m09-speed-select', 0x5036, 20, 'speed table select 0x5064/0x50A4'],
  ['m10-timer-reset', 0x1031A, 10, 'stage timer start value 0x1033E[stage*8+area*2]'],
  ['m11-timer-tick', 0x1037E, 60, 'timer tick (51 frames per second) and pause conditions'],
  ['m12-time-over', 0x10400, 50, 'time over: HP 0 for live heroes / HELL ROAD +3:00; add-time routine 0x104A8'],
  ['m13-score-add', 0xFFC8, 50, 'score add: BCD long 0x10292 + code, player flags'],
  ['m14-food-pickup', 0x28AA4, 40, 'food: heal word[0x28B10+(sub-1)*4] or score at full HP'],
  ['m15-score-item-pickup', 0x2A10E, 30, 'score item: byte 0x2A164[sub-1]; E3 subtype 12 -> 0x8BD24'],
  ['m16-magazine', 0x284B4, 60, 'ammo magazine refill table 0x2855A'],
  ['m17-drop', 0x24B36, 80, 'item drop by +0x96 from 0xB64F2 / 0xB6D12'],
  ['m18-cadillac-spawn', 0x8BD24, 50, 'E3 item 12 spawns the Cadillac (three pool-C type 0x160) and sets 0xFF84D5/0xFF84DB/0xFF850E'],
  ['m19-lives-extend', 0x6B98, 60, 'extend thresholds 0x6BFE; +0xF9 table 0x6C3A; lives start 0x4DD6'],
  ['m20-lives-start', 0x4DC2, 12, 'hero HP 100 and lives = 0xFFF77C & 3'],
  ['m21-settings-pack', 0xAC7BC, 60, 'EEPROM settings packed into 0xFFF77A/B/C'],
  ['m22-rank-start', 0x17F8A, 60, 'rank at game start from GAME DIFFICULTY and play time; per-episode add/clamp 0x1823A'],
  ['m23-rank-effective', 0x18592, 40, 'rank clamp by players and effective rank 0x1860C -> 0xFF85EE'],
  ['m24-rank-events', 0x1843C, 60, 'rank events by lives in stock'],
  ['m25-hp-regular', 0x31424, 12, 'enemy HP word[0x31454 + (+0x03)*64 + rank*2]'],
  ['m26-hp-boss', 0x31E14, 16, 'boss HP word[0x31E52 + idx*48 + players*16 + (rank&0x1C)>>1]'],
  ['m27-mega-crash-start', 0x1968E, 6, 'mega crash budget +0xEE = 0x14'],
  ['m28-punch-hitstop', 0x19464, 30, 'attacker hit-stop: +0x59 counts down before the animation advances'],
  ['m29-jump-table', 0x1AC06, 20, 'running jump attack velocities per hero (0x1BF2A..)'],
  ['m30-iframes-respawn', 0x18B9E, 4, 'respawn i-frames +0xEC = 0x168'],
  ['m31-iframe-countdown', 0x18CD4, 40, 'i-frame countdown +0xEC / +0xF9 -> +0x00 back to 1 (V31)'],
  ['m32-hero-stun-check', 0x1C08A, 12, 'hero stun meter +0x78 == 0 test'],
  ['m33-dip-copy', 0x7C8, 16, 'DIP ports copied inverted to 0xFF8022..24 (debug switches)'],
  ['m34-rank-timer', 0x186CC, 60, 'rank +1 when 0xFF85F8 underflows; reload from 0x187B8[0xFF85F6]'],
  ['m35-grab-hit', 0x12528, 40, 'grab hits (knees/throws): 0x2B904, stun, release at 0, hit-stop byte dropped at 0x125A2'],
  ['m36-car-ram', 0x121D8, 60, 'Cadillac ram: enemy record 0xA2EA4 + car(+0x58)*8, fixed damage, score 0x1C'],
  ['m37-car-damage', 0x12454, 50, 'damage to the Cadillac from enemy attack objects (fixed b0)'],
  ['m38-continue', 0xE9E6, 60, 'continue screen state 0x10: counters 20 and 100 per player (+0xB0/+0xB1)'],
  ['m39-jump-select', 0x5364, 32, 'jump parameter select long[0x53A2 + kind*16 + id*4] + 12*(stick+1)'],
  ['m40-rank-death', 0x184E2, 50, 'rank on death: 0x187E0 by difficulty, 0x187F4 adjust of 0xFF85F6'],
  ['m41-body-hit', 0x118D2, 30, 'thrown/flying enemy hits another: enemy record 0x11 fixed damage'],
  ['m42-hit-pass', 0x10540, 50, 'collision passes and the Cadillac-only passes (0xFF8518)'],
  ['m43-hero-hit-decision', 0x1C06E, 30, 'hero hit reaction: knockdown when HP == 0, stun +0x78 == 0, +0x5A != 0 (attack flag) or +0x51 != 0 (airborne), else flinch'],
  ['m44-script-init', 0xFBF4, 16, 'area start: spawner 0xFF866C gets the list A / list B row pointers from 0xFC2E / 0xFC4E by stage and area'],
  ['m45-script-run', 0xFC6E, 70, 'spawn-list interpreter: camera-X triggers, command rows (bit 7) through 0xFD56, pool by flags & 7, spawn fields'],
  ['m46-script-commands', 0xFD46, 40, 'command dispatch table 0xFD60: skip, enemy-mix re-roll, 0xFF85F2/F4, SET TIMER (0xFD9C), ADD TIME (0xFDA4); list-B conditions 0xFDAE'],
  ['m47-event-object', 0x7B336, 80, 'event (wave) object type 0x3C: chain pointer by subtype, wait on the enemy count 0xFF84F3 / timeout 0xFF850C, row execution through 0xFDAE'],
  ['m48-event-end', 0x7B464, 40, 'event chain end: wait for all heroes idle, end action by the terminator low bits (exit flag 0xFF87A9 / stage end)'],
  ['m49-run-handler', 0x1A012, 50, 'run state: 240-frame limit +0xFA, speed set by frame byte 4, attack -> dash, jump -> running jump, steering test (new - old + 4) & 0x1C'],
  ['m50-stick-input', 0x1BDEC, 30, 'direction input: with nothing held the remembered stick direction +0x22 keeps its speed row (run persistence); air control 0x1BE3C table 0x1BE66'],
  ['m51-double-tap', 0x1922A, 30, 'double-tap run start: +0xBC window, direction codes 0x19292, lockout +0xFC, container check'],
  ['m52-airborne-flag', 0x12CF2, 30, 'airborne flag +0x51: set above the floor, cleared at the landing'],
  ['m53-respawn-time', 0x1BFC6, 30, 'death with lives left: lives -= 1, rank event, HP reset, +3:30 to the stage timer (0x10482)'],
  ['m54-timer-display', 0x810BA, 50, 'mid-screen timer digits: shown at <= 3:00 for 300 frames at :00 / :30, continuously at <= 0:15, red palette at <= 1:00'],
  ['m55-stun-refill', 0x18DC6, 10, 'stun meter refill 120 frames after the last hit (+0xF6)'],
];

function run(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ids = {};
  for (const [label, addr, n, what] of SITES) {
    let r = null;
    for (let k = 0; k < 4 && !r; k++) { try { r = RZ.rea(label, `pd ${n} @ 0x${addr.toString(16)}`, dir); } catch (e) { console.log(label, 'retry', k + 1); } }
    if (!r) throw new Error('REA failed for ' + label);
    ids[label] = { id: r.id, addr: '0x' + addr.toString(16).toUpperCase(), instructions: n, what };
    console.log(label, r.id.slice(0, 16));
  }
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(ids, null, 1));
  return ids;
}
module.exports = { run, SITES };
