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
  // L2 E1 V5 E1 L2 = 11 +15 bookend = 26, mult 3, x3 mirror
  assert.equal(r.total, 26 * 3 * 3);
});

test('scribe preview matches the real play', () => {
  const run = runWithRack('GHOSTLY');
  run.charms = ['scribe'];
  const preview = GW.evaluate(run, run.round.rack, true);
  const real = GW.playWord(run, ids(run, 7));
  assert.equal(preview.total, real.total);
  assert.equal(run.charmState.scribe, 1);
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
  assert.equal(run.round.rack.length, GW.RACK_SIZE);
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
  assert.equal(run.round.rack.length, GW.RACK_SIZE);
  for (const t of before) assert.ok(!run.round.rack.includes(t));
});

test('same seed gives the same opening rack', () => {
  const a = GW.newRun(42).round.rack.map(t => t.letter).join('');
  const b = GW.newRun(42).round.rack.map(t => t.letter).join('');
  assert.equal(a, b);
});

console.log(`\n${passed} passed`);
