import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../src/compare.mjs';

const TODAY = '2026-10-05';
function deal(over) {
  return {
    id: 'x', name: 'X', owner: 'Dana', pipeline_id: 'default', pipeline: 'Sales Pipeline',
    stage_id: 's1', stage: 'Qualified', stage_order: 1, status: 'open', amount: 10000,
    close_date: '2026-12-01', next_step: 'Call', last_activity: '2026-10-01', ...over,
  };
}
const snap = (date, deals) => ({ schema: 1, date, deals });
const ids = (rows) => rows.map((r) => (r.deal ?? r).id);

test('open totals and delta compare open deals only', () => {
  const r = compare(
    snap('2026-09-28', [deal({ id: 'a', amount: 100 }), deal({ id: 'b', amount: 50, status: 'won' })]),
    snap(TODAY, [deal({ id: 'a', amount: 300 }), deal({ id: 'c', amount: 20 })]),
    TODAY,
  );
  assert.equal(r.open.total, 320);
  assert.equal(r.open.count, 2);
  assert.equal(r.previousOpenTotal, 100);
});

test('closed since last week: open last week or new, and closed now', () => {
  const r = compare(
    snap('2026-09-28', [
      deal({ id: 'w', amount: 10 }), deal({ id: 'l', amount: 20 }), deal({ id: 'old', status: 'won' }),
    ]),
    snap(TODAY, [
      deal({ id: 'w', amount: 10, status: 'won' }), deal({ id: 'l', amount: 20, status: 'lost' }),
      deal({ id: 'old', status: 'won' }), deal({ id: 'fast', amount: 5, status: 'won' }),
    ]),
    TODAY,
  );
  assert.deepEqual(ids(r.won), ['w', 'fast']);
  assert.deepEqual(ids(r.lost), ['l']);
});

test('slipped close dates: open deals whose close date moved later, with days', () => {
  const r = compare(
    snap('2026-09-28', [deal({ id: 'a', close_date: '2026-10-19' }), deal({ id: 'b', close_date: '2026-11-01' }), deal({ id: 'n', close_date: null })]),
    snap(TODAY, [deal({ id: 'a', close_date: '2027-01-15' }), deal({ id: 'b', close_date: '2026-10-20' }), deal({ id: 'n', close_date: '2026-12-01' })]),
    TODAY,
  );
  assert.deepEqual(ids(r.slipped), ['a']);
  assert.equal(r.slipped[0].from, '2026-10-19');
  assert.equal(r.slipped[0].days, 88);
});

test('stage moves use stage_order within the same pipeline only', () => {
  const r = compare(
    snap('2026-09-28', [
      deal({ id: 'back', stage: 'Demo', stage_order: 2 }),
      deal({ id: 'fwd', stage: 'Demo', stage_order: 2 }),
      deal({ id: 'moved', stage: 'Demo', stage_order: 2 }),
      deal({ id: 'unknown', stage: 'Demo', stage_order: 2 }),
    ]),
    snap(TODAY, [
      deal({ id: 'back', stage: 'Discovery', stage_order: 0 }),
      deal({ id: 'fwd', stage: 'Proposal', stage_order: 3 }),
      deal({ id: 'moved', pipeline_id: 'renewals', stage: 'Upcoming', stage_order: 0 }),
      deal({ id: 'unknown', stage: 'gone', stage_order: null }),
    ]),
    TODAY,
  );
  assert.deepEqual(ids(r.back), ['back']);
  assert.equal(r.back[0].from, 'Demo');
  assert.deepEqual(ids(r.forward), ['fwd']);
});

test('stale: open deals with no next step, or no activity in 14 or more days', () => {
  const r = compare(
    snap('2026-09-28', []),
    snap(TODAY, [
      deal({ id: 'empty', next_step: '' }),
      deal({ id: 'old', last_activity: '2026-09-21' }), // exactly 14 days
      deal({ id: 'fresh', last_activity: '2026-09-22' }), // 13 days
      deal({ id: 'never', last_activity: null }),
      deal({ id: 'closed', next_step: '', status: 'lost' }),
    ]),
    TODAY,
  );
  assert.deepEqual(ids(r.stale).sort(), ['empty', 'never', 'old']);
  assert.equal(r.stale.find((s) => s.deal.id === 'empty').reason, 'no-next-step');
  assert.equal(r.stale.find((s) => s.deal.id === 'old').reason, 'no-activity');
});

test('no logged activity: a deal created under 14 days ago is not stale, one created 14+ days ago is', () => {
  const r = compare(null, snap(TODAY, [
    deal({ id: 'today', last_activity: null, created: TODAY }),
    deal({ id: 'thirteen', last_activity: null, created: '2026-09-22' }),
    deal({ id: 'fourteen', last_activity: null, created: '2026-09-21' }),
    deal({ id: 'unknown-age', last_activity: null }),
  ]), TODAY);
  assert.deepEqual(ids(r.stale).sort(), ['fourteen', 'unknown-age']);
  assert.ok(r.stale.every((s) => s.reason === 'no-activity'));
});

test('a logged activity still decides staleness whatever the deal age', () => {
  const r = compare(null, snap(TODAY, [deal({ id: 'young-old-activity', created: '2026-09-30', last_activity: '2026-09-01' })]), TODAY);
  assert.deepEqual(ids(r.stale), ['young-old-activity']);
});

test('an empty next step is flagged on a brand-new deal; with the check off it is not', () => {
  const fresh = [deal({ id: 'new', next_step: '', last_activity: null, created: TODAY })];
  const on = compare(null, snap(TODAY, fresh), TODAY);
  assert.deepEqual(on.stale.map((s) => [s.deal.id, s.reason]), [['new', 'no-next-step']]);
  assert.deepEqual(compare(null, snap(TODAY, fresh), TODAY, { nextStep: false }).stale, []);
});

test('a young deal with no logged activity cannot reach look at these first on a slip alone', () => {
  const r = compare(
    snap('2026-09-28', [deal({ id: 'young', close_date: '2026-10-20', last_activity: null, created: '2026-09-25' })]),
    snap(TODAY, [deal({ id: 'young', close_date: '2026-11-20', last_activity: null, created: '2026-09-25' })]),
    TODAY,
  );
  assert.deepEqual(ids(r.slipped), ['young']);
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.lookFirst, []);
});

test('new this week: deals absent from the previous snapshot', () => {
  const r = compare(snap('2026-09-28', [deal({ id: 'a' })]), snap(TODAY, [deal({ id: 'a' }), deal({ id: 'b' })]), TODAY);
  assert.deepEqual(ids(r.newDeals), ['b']);
});

test('look at these first: more than one flag, largest amount first', () => {
  const r = compare(
    snap('2026-09-28', [
      deal({ id: 'two', amount: 10, close_date: '2026-10-01' }),
      deal({ id: 'three', amount: 50, close_date: '2026-10-01', stage_order: 3 }),
      deal({ id: 'one', amount: 99, close_date: '2026-10-01' }),
    ]),
    snap(TODAY, [
      deal({ id: 'two', amount: 10, close_date: '2026-11-01', next_step: '' }),
      deal({ id: 'three', amount: 50, close_date: '2026-11-01', stage_order: 1, last_activity: null }),
      deal({ id: 'one', amount: 99, close_date: '2026-11-01' }),
    ]),
    TODAY,
  );
  assert.deepEqual(ids(r.lookFirst), ['three', 'two']);
  assert.deepEqual(r.lookFirst[0].flags, ['close date slipped', 'moved back a stage', 'no activity in 14+ days']);
  assert.deepEqual(r.lookFirst[1].flags, ['close date slipped', 'no next step']);
});

test('lists sort by amount, largest first', () => {
  const r = compare(snap('2026-09-28', []), snap(TODAY, [deal({ id: 's', amount: 1 }), deal({ id: 'b', amount: 9 })]), TODAY);
  assert.deepEqual(ids(r.newDeals), ['b', 's']);
});

test('with no previous snapshot, only current-state results are produced', () => {
  const r = compare(null, snap(TODAY, [deal({ id: 'a', next_step: '' })]), TODAY);
  assert.equal(r.firstRun, true);
  assert.equal(r.previousOpenTotal, null);
  assert.deepEqual(ids(r.stale), ['a']);
  assert.deepEqual(r.newDeals, []);
  assert.deepEqual(r.lookFirst, []);
});

test('with the next step check off, only activity age makes a deal stale', () => {
  const r = compare(null, snap(TODAY, [
    deal({ id: 'empty-fresh', next_step: '' }),
    deal({ id: 'empty-old', next_step: '', last_activity: '2026-09-01' }),
    deal({ id: 'set-old', last_activity: '2026-09-01' }),
  ]), TODAY, { nextStep: false });
  assert.deepEqual(ids(r.stale).sort(), ['empty-old', 'set-old']);
  assert.ok(r.stale.every((s) => s.reason === 'no-activity'));
  assert.equal(r.nextStepCheck, false);
});

test('open deals in stages missing from pipeline metadata are counted and totalled', () => {
  const r = compare(null, snap(TODAY, [
    deal({ id: 'a', stage_order: null, amount: 500 }),
    deal({ id: 'b', stage_order: null, amount: 700 }),
    deal({ id: 'c' }),
  ]), TODAY);
  assert.deepEqual(r.unknownStage, { count: 2, total: 1200 });
});
