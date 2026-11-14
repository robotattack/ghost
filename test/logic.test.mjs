// Run with: npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../src/words.js');
require('../src/logic.js');
const GW = globalThis.GW;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n${e.stack}`); process.exitCode = 1; }
}

// Build a run whose rack is exactly the given tiles.
function runWithRack(spec, seed = 1) {
  const run = GW.newRun(seed);
  run.round.rack = spec.split('').map(ch =>
    ch === '?' ? GW._test.makeTile(null, 'wild') : GW._test.makeTile(ch));
  return run;
}
const ids = (run, n) => run.round.rack.slice(0, n).map(t => t.id);

test('dictionary lookups', () => {
  assert.equal(GW.resolveWord('GHOST'), 'GHOST');
  assert.equal(GW.resolveWord('GHXST'), null);
  assert.equal(GW.resolveWord('QU?ZZES'), 'QUIZZES');
});

test('length multiplier', () => {
  assert.deepEqual([3, 4, 5, 8].map(GW.lengthMult), [1, 2, 3, 6]);
});

test('basic score = chips x mult', () => {
  const run = runWithRack('GHOST');
  const r = GW.evaluate(run, run.round.rack);
  // G3 H3 O1 S2 T2 = 11 chips, 5 letters -> mult 3
  assert.equal(r.chips, 11); assert.equal(r.mult, 3); assert.equal(r.total, 33);
});

test('wild tile scores 0 chips', () => {
  const run = runWithRack('QU?ZZES');
  const r = GW.evaluate(run, run.round.rack);
  // Q10 U2 (wild 0) Z10 Z10 E1 S2
  assert.equal(r.word, 'QUIZZES'); assert.equal(r.chips, 35);
});

test('rejects short, unknown and repeated words', () => {
  const run = runWithRack('CATCATXYZ');
  assert.equal(GW.evaluate(run, run.round.rack.slice(0, 2)).ok, false);
  assert.equal(GW.evaluate(run, run.round.rack.slice(6, 9)).ok, false);
  assert.equal(GW.playWord(run, ids(run, 3)).ok, true);
  run.round.rack.unshift(...'CAT'.split('').map(c => GW._test.makeTile(c)));
  const again = GW.playWord(run, ids(run, 3));
  assert.equal(again.ok, false); assert.match(again.error, /already/);
});

test('charms apply', () => {
  const run = runWithRack('LEVEL');
  run.charms = ['mirror', 'bookend'];
  const r = GW.evaluate(run, run.round.rack);
  // L2 E1 V5 E1 L2 = 11 chips, +20 bookends = 31; mult 3, ×5 mirror = 15
  assert.equal(r.total, 31 * 15);
});

test('scribe preview matches the real play', () => {
  const run = runWithRack('GHOSTLY');
  run.charms = ['scribe'];
  const preview = GW.evaluate(run, run.round.rack);
  const real = GW.playWord(run, ids(run, 7));
  assert.equal(preview.total, real.total);
  assert.equal(run.charmState.scribe, 2);
});

test('clearing a round opens the shop and pays out', () => {
  const run = runWithRack('QUIZZES');
  run.round.target = 10;
  const money = run.money;
  const r = GW.playWord(run, ids(run, 7));
  assert.equal(r.roundCleared, true);
  assert.equal(run.phase, 'shop');
  assert.equal(run.money, money + 4 + 3);
  GW.nextRound(run);
  assert.equal(run.phase, 'play'); assert.equal(run.roundIndex, 1);
  assert.equal(run.round.rack.length, GW.rules(run).rackSize);
});

test('running out of words loses the run', () => {
  const run = GW.newRun(7);
  run.round.wordsLeft = 1; run.round.target = 1e9;
  run.round.rack = 'CAT'.split('').map(c => GW._test.makeTile(c));
  GW.playWord(run, ids(run, 3));
  assert.equal(run.phase, 'lost');
});

test('swap replaces tiles and spends a swap', () => {
  const run = GW.newRun(3);
  const before = run.round.rack.slice(0, 4);
  assert.equal(GW.swapTiles(run, before.map(t => t.id)).ok, true);
  assert.equal(run.round.swapsLeft, 2);
  assert.equal(run.round.rack.length, GW.rules(run).rackSize);
  for (const t of before) assert.ok(!run.round.rack.includes(t));
});

test('same seed gives the same opening rack', () => {
  const a = GW.newRun(42).round.rack.map(t => t.letter).join('');
  const b = GW.newRun(42).round.rack.map(t => t.letter).join('');
  assert.equal(a, b);
});

test('charm order matters: +mult before ×mult is worth more', () => {
  const a = runWithRack('BOAT'); a.charms = ['openvowel', 'short'];
  const b = runWithRack('OATS'); b.charms = ['short', 'openvowel'];
  const c = runWithRack('OATS'); c.charms = ['openvowel', 'short'];
  // OATS: 1+1+2+2 = 6 chips, mult 2. +4 then ×3 = 18; ×3 then +4 = 10.
  assert.equal(GW.evaluate(c, c.round.rack).mult, 18);
  assert.equal(GW.evaluate(b, b.round.rack).mult, 10);
  assert.equal(GW.evaluate(a, a.round.rack).mult, 6); // BOAT: no vowel start, ×3 only
});

test('scoring events record each step', () => {
  const run = runWithRack('ESS');
  run.charms = ['sibilant'];
  const r = GW.evaluate(run, run.round.rack);
  // base, E chips, S chips, S sibilant, S chips, S sibilant
  assert.equal(r.events.length, 6);
  assert.deepEqual(r.events.filter(e => e.charm === 0).map(e => e.tile), [1, 2]);
  const last = r.events[r.events.length - 1];
  assert.equal(last.chipsNow, r.chips); assert.equal(last.multNow, r.mult);
});

test('copycat copies its right neighbour', () => {
  const run = runWithRack('OATS');
  run.charms = ['copycat', 'openvowel'];
  assert.equal(GW.evaluate(run, run.round.rack).mult, 2 + 4 + 4);
  run.charms = ['openvowel', 'copycat'];
  assert.equal(GW.evaluate(run, run.round.rack).mult, 2 + 4);
});

test('rule charms change the round', () => {
  const run = GW.newRun(5);
  run.charms = ['bigpockets', 'extradraft', 'recycler'];
  GW._test.finishRound(run); GW.nextRound(run);
  assert.equal(run.round.rack.length, 15);
  assert.equal(run.round.wordsLeft, 5);
  assert.equal(run.round.swapsLeft, 5);
});

test('mirror writing accepts backwards words with ×2', () => {
  const run = runWithRack('TSOHG');
  assert.equal(GW.evaluate(run, run.round.rack).ok, false);
  run.charms = ['backwards'];
  const r = GW.evaluate(run, run.round.rack);
  assert.equal(r.word, 'GHOST'); assert.equal(r.reversed, true); assert.equal(r.mult, 6);
});

test('fluent makes Y a vowel', () => {
  const run = runWithRack('MYTH');
  run.charms = ['starved'];
  assert.equal(GW.evaluate(run, run.round.rack).mult, 2); // no vowels at all
  run.charms = ['fluent', 'starved'];
  assert.equal(GW.evaluate(run, run.round.rack).mult, 4);
});

test('curses: lost letter, muffled, tax', () => {
  const run = runWithRack('STAR');
  run.round.curse = { id: 'lost', letter: 'S', check: GW.CURSES.find(c => c.id === 'lost').check };
  assert.match(GW.evaluate(run, run.round.rack).error, /banned/);

  const m = runWithRack('OATS');
  m.curseByRound[0] = m.round.curse = GW.CURSES.find(c => c.id === 'muted');
  m.charms = ['openvowel', 'sibilant'];
  assert.equal(GW.evaluate(m, m.round.rack).mult, 2 + 2); // open vowel silenced

  const t = runWithRack('CAT');
  t.round.curse = GW.CURSES.find(c => c.id === 'tax');
  t.money = 3;
  GW.playWord(t, ids(t, 3));
  assert.equal(t.money, 2);
});

test('wild resolves to a reading that passes the curse', () => {
  const run = runWithRack('?AT');
  const lost = Object.assign({}, GW.CURSES.find(c => c.id === 'lost'), { letter: 'B' });
  run.round.curse = lost;
  const r = GW.evaluate(run, run.round.rack);
  assert.equal(r.ok, true); assert.notEqual(r.word[0], 'B');
});

test('moving charms', () => {
  const run = GW.newRun(1);
  run.charms = ['a', 'b', 'c'];
  GW.moveCharm(run, 0, 2);
  assert.deepEqual(run.charms, ['b', 'c', 'a']);
  assert.equal(GW.moveCharm(run, 0, -1), false);
});

console.log(`\n${passed} passed`);
