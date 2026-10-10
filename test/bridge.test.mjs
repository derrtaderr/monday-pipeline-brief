import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../src/compare.mjs';
import { randomPair } from './helpers/random-snapshots.mjs';
import { renderBrief } from '../src/render.mjs';

const TODAY = '2026-10-05';
function deal(over) {
  return {
    id: 'x', name: 'X', owner: 'Dana', pipeline_id: 'default', pipeline: 'Sales Pipeline',
    stage_id: 's1', stage: 'Qualified', stage_order: 1, status: 'open', amount: 10000,
    close_date: '2026-12-01', next_step: 'Call', last_activity: '2026-10-01', ...over,
  };
}
const snap = (date, deals) => ({ schema: 1, date, deals });
const cents = (n) => Math.round(n * 100);
const openCents = (s) => s.deals.filter((d) => d.status === 'open').reduce((n, d) => n + cents(d.amount), 0);

function balances(b) {
  return b.start + b.new.cents + b.reopened.cents + b.increases.cents - b.decreases.cents
    - b.won.cents - b.lost.cents - b.removed.cents;
}

test('the bridge balances on 500 generated snapshot pairs', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const { previous, current } = randomPair(seed);
    const { bridge: b } = compare(previous, current, TODAY);
    assert.equal(b.start, openCents(previous), `seed ${seed}: start`);
    assert.equal(b.end, openCents(current), `seed ${seed}: end`);
    assert.equal(balances(b), b.end, `seed ${seed}: bridge does not balance`);
  }
});

test('every bridge line is per deal and named the way the brief needs', () => {
  const r = compare(
    snap('2026-09-28', [
      deal({ id: 'up', amount: 100 }),
      deal({ id: 'down', amount: 500 }),
      deal({ id: 'same', amount: 70 }),
      deal({ id: 'wonUp', amount: 200 }),
      deal({ id: 'lostDown', amount: 300 }),
      deal({ id: 'gone', amount: 40 }),
      deal({ id: 'goneClosed', amount: 999, status: 'won' }),
      deal({ id: 'back', amount: 60, status: 'lost' }),
      deal({ id: 'stillClosed', amount: 1, status: 'won' }),
    ]),
    snap(TODAY, [
      deal({ id: 'up', amount: 150 }),
      deal({ id: 'down', amount: 450 }),
      deal({ id: 'same', amount: 70 }),
      deal({ id: 'wonUp', amount: 250, status: 'won' }),
      deal({ id: 'lostDown', amount: 280, status: 'lost' }),
      deal({ id: 'back', amount: 65 }),
      deal({ id: 'stillClosed', amount: 5, status: 'lost' }),
      deal({ id: 'fresh', amount: 30 }),
      deal({ id: 'fastWin', amount: 20, status: 'won' }),
    ]),
    TODAY,
  );
  const b = r.bridge;
  assert.equal(b.start, cents(100 + 500 + 70 + 200 + 300 + 40));
  assert.deepEqual(b.new, { cents: cents(50), count: 2 });
  assert.deepEqual(b.reopened, { cents: cents(65), count: 1 });
  assert.deepEqual(b.increases, { cents: cents(50 + 50), count: 2 });
  assert.deepEqual(b.decreases, { cents: cents(50 + 20), count: 2 });
  assert.deepEqual(b.won, { cents: cents(250 + 20), count: 2 });
  assert.deepEqual(b.lost, { cents: cents(280), count: 1 });
  assert.deepEqual(b.removed, { cents: cents(40), count: 1 });
  assert.equal(b.end, cents(150 + 450 + 70 + 65 + 30));
  assert.equal(balances(b), b.end);
  assert.deepEqual(r.amountChanged.map((a) => [a.deal.id, a.from, a.to]), [
    ['down', 500, 450], ['lostDown', 300, 280], ['wonUp', 200, 250], ['up', 100, 150],
  ]);
  assert.deepEqual(r.removed.map((d) => d.id), ['gone']);
  assert.deepEqual(r.reopened.map((x) => [x.deal.id, x.from]), [['back', 'lost']]);
});

test('cent amounts never knock the bridge out of balance', () => {
  const r = compare(
    snap('2026-09-28', [deal({ id: 'a', amount: 0.1 }), deal({ id: 'b', amount: 0.2 })]),
    snap(TODAY, [deal({ id: 'a', amount: 0.3 }), deal({ id: 'b', amount: 0.2 })]),
    TODAY,
  );
  assert.deepEqual(r.bridge.increases, { cents: 20, count: 1 });
  assert.equal(r.bridge.end, 50);
});

test('a first run has no bridge', () => {
  assert.equal(compare(null, snap(TODAY, [deal({})]), TODAY).bridge, null);
});

test('an unbalanced bridge is an error, never a number (duplicate ids are the one way in)', () => {
  const prev = snap('2026-09-28', [deal({ id: 'dup', amount: 10 })]);
  const curr = snap(TODAY, [deal({ id: 'dup', amount: 10 }), deal({ id: 'dup', amount: 20 })]);
  assert.throws(() => compare(prev, curr, TODAY), (err) => /does not add up/.test(err.message) && !/\d/.test(err.message));
});

// Read the rendered bridge back as numbers: the start, each signed line, the end.
function renderedBridge(text) {
  const block = text.slice(text.indexOf('**How the open pipeline changed**'));
  const lines = block.split('\n').slice(1, block.split('\n').indexOf(''));
  const value = (l) => Math.round(Number(/\$([\d,.]+)/.exec(l)[1].replace(/,/g, '')) * 100);
  const start = value(lines[0]);
  const end = value(lines.at(-1));
  const steps = lines.slice(1, -1).map((l) => (/: \+\$/.test(l) ? 1 : /: -\$/.test(l) ? -1 : NaN) * value(l));
  return { start, end, steps };
}

test('the printed bridge adds up on every generated pair that has one', () => {
  let printed = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const { previous, current } = randomPair(seed);
    const out = renderBrief(compare(previous, current, TODAY));
    if (!out.includes('**How the open pipeline changed**')) continue;
    printed++;
    const { start, end, steps } = renderedBridge(out);
    assert.ok(steps.every(Number.isFinite), `seed ${seed}: every middle line is signed`);
    assert.equal(start + steps.reduce((a, b) => a + b, 0), end, `seed ${seed}: printed bridge does not add up\n${out}`);
  }
  assert.ok(printed > 400, `only ${printed} pairs printed a bridge`);
});

// The balance check's message reaches stderr ("Unexpected error: ...") and run.log, which can be
// a log others read, so it carries no figures.
test('a bridge that does not balance fails with a message that holds no amount', async () => {
  const { assertBalanced } = await import('../src/bridge.mjs');
  assert.doesNotThrow(() => assertBalanced(12345, 12345));
  assert.throws(() => assertBalanced(12345, 67890), (err) => /does not add up/.test(err.message) && !/\d/.test(err.message));
});
