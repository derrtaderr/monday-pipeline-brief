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

test('stage moves need a stage change within the same pipeline', () => {
  const r = compare(
    snap('2026-09-28', [
      deal({ id: 'back', stage_id: 'demo', stage: 'Demo', stage_order: 2 }),
      deal({ id: 'fwd', stage_id: 'demo', stage: 'Demo', stage_order: 2 }),
      deal({ id: 'moved', stage_id: 'demo', stage: 'Demo', stage_order: 2 }),
      deal({ id: 'unknown', stage_id: 'demo', stage: 'Demo', stage_order: 2 }),
    ]),
    snap(TODAY, [
      deal({ id: 'back', stage_id: 'discovery', stage: 'Discovery', stage_order: 0 }),
      deal({ id: 'fwd', stage_id: 'proposal', stage: 'Proposal', stage_order: 3 }),
      deal({ id: 'moved', pipeline_id: 'renewals', stage_id: 'upcoming', stage: 'Upcoming', stage_order: 0 }),
      deal({ id: 'unknown', stage_id: 'gone', stage: 'gone', stage_order: null }),
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
    { largeDeal: false },
  );
  assert.deepEqual(ids(r.slipped), ['young']);
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.lookFirst, []);
});

test('new this week: deals absent from the previous snapshot', () => {
  const r = compare(snap('2026-09-28', [deal({ id: 'a' })]), snap(TODAY, [deal({ id: 'a' }), deal({ id: 'b' })]), TODAY);
  assert.deepEqual(ids(r.newDeals), ['b']);
});

test('look at these first: more than one flag, largest amount first (large-deal rule off)', () => {
  const r = compare(
    snap('2026-09-28', [
      deal({ id: 'two', amount: 10, close_date: '2026-10-01' }),
      deal({ id: 'three', amount: 50, close_date: '2026-10-01', stage_id: 'late', stage_order: 3 }),
      deal({ id: 'one', amount: 99, close_date: '2026-10-01' }),
    ]),
    snap(TODAY, [
      deal({ id: 'two', amount: 10, close_date: '2026-11-01', next_step: '' }),
      deal({ id: 'three', amount: 50, close_date: '2026-11-01', stage_order: 1, last_activity: null }),
      deal({ id: 'one', amount: 99, close_date: '2026-11-01' }),
    ]),
    TODAY,
    { largeDeal: false },
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

test('a pipeline reorder alone is never a stage move', () => {
  const r = compare(
    snap('2026-09-28', [
      deal({ id: 'a', stage_id: 'demo', stage: 'Demo', stage_order: 2 }),
      deal({ id: 'b', stage_id: 'proposal', stage: 'Proposal', stage_order: 3 }),
    ]),
    snap(TODAY, [
      deal({ id: 'a', stage_id: 'demo', stage: 'Demo', stage_order: 3 }),
      deal({ id: 'b', stage_id: 'proposal', stage: 'Proposal', stage_order: 2 }),
    ]),
    TODAY,
  );
  assert.deepEqual(r.forward, []);
  assert.deepEqual(r.back, []);
});

test('a real move during a reorder is judged in the current layout', () => {
  // Admin swapped Demo (was 2, now 3) and Proposal (was 3, now 2). Deal c went Demo -> Proposal,
  // which is backward in today's layout although the old orders say 2 -> 2.
  const r = compare(
    snap('2026-09-28', [
      deal({ id: 'c', stage_id: 'demo', stage: 'Demo', stage_order: 2 }),
      deal({ id: 'other', stage_id: 'demo', stage: 'Demo', stage_order: 2 }),
    ]),
    snap(TODAY, [
      deal({ id: 'c', stage_id: 'proposal', stage: 'Proposal', stage_order: 2 }),
      deal({ id: 'other', stage_id: 'demo', stage: 'Demo', stage_order: 3 }),
    ]),
    TODAY,
  );
  assert.deepEqual(ids(r.back), ['c']);
  assert.deepEqual(r.forward, []);
});

test('with no stage_id, the stage label is the stage identity', () => {
  const r = compare(
    snap('2026-09-28', [deal({ id: 'a', stage_id: null, stage: 'Demo', stage_order: 2 }), deal({ id: 'b', stage_id: null, stage: 'Demo', stage_order: 2 })]),
    snap(TODAY, [deal({ id: 'a', stage_id: null, stage: 'Demo', stage_order: 1 }), deal({ id: 'b', stage_id: null, stage: 'Proposal', stage_order: 3 })]),
    TODAY,
  );
  assert.deepEqual(r.back, []);
  assert.deepEqual(ids(r.forward), ['b']);
});

test('close date passed: open deals whose close date is before the snapshot date, its own flag', () => {
  const r = compare(
    snap('2026-09-28', [deal({ id: 'slipped-and-past', close_date: '2026-09-01' })]),
    snap(TODAY, [
      deal({ id: 'past', close_date: '2026-09-30', amount: 5 }),
      deal({ id: 'today', close_date: TODAY }),
      deal({ id: 'none', close_date: null }),
      deal({ id: 'closed', close_date: '2026-09-01', status: 'won' }),
      deal({ id: 'slipped-and-past', close_date: '2026-10-01', amount: 50 }),
    ]),
    TODAY,
  );
  assert.deepEqual(r.overdue.map((o) => [o.deal.id, o.days]), [['slipped-and-past', 4], ['past', 5]]);
  assert.deepEqual(ids(r.lookFirst), ['slipped-and-past']);
  assert.deepEqual(r.lookFirst[0].flags, ['close date slipped', 'close date passed']);
});

test('close date passed is current state, so a first run has it too', () => {
  const r = compare(null, snap(TODAY, [deal({ id: 'past', close_date: '2026-10-04' })]), TODAY);
  assert.deepEqual(r.overdue.map((o) => o.deal.id), ['past']);
});

// Every open deal flagged (empty next step), so look first lists exactly the large ones.
function allFlagged(amounts) {
  const deals = amounts.map((amount, i) => deal({ id: `d${String(i).padStart(2, '0')}`, amount, next_step: '' }));
  return compare(snap('2026-09-28', deals.map((d) => ({ ...d, next_step: 'Call' }))), snap(TODAY, deals), TODAY);
}

test('large deal default: never more than 10% of open deals, at least one', () => {
  const r = allFlagged([100, 90, 80, 50, 40, 30, 20, 10, 5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]); // 21 deals: at most 2
  assert.deepEqual(ids(r.lookFirst), ['d00', 'd01']);
  assert.deepEqual(r.lookFirst[0].reasons, ['large deal']);
  assert.deepEqual(ids(allFlagged([100, 90, 80]).lookFirst), ['d00']); // 3 deals: still one
});

test('30 deals all at $12K: when every deal with an amount is the same size, no deal is large', () => {
  assert.deepEqual(ids(allFlagged(Array(30).fill(12000)).lookFirst), []);
  assert.deepEqual(ids(allFlagged([...Array(30).fill(12000), 0, 0, 0, 0, 0]).lookFirst), [], '$0 deals do not break the tie');
});

test('a partial tie at the cut with nothing above it keeps the lowest-id tie-break', () => {
  const r = allFlagged([50, 50, 50, ...Array(17).fill(10)]); // 20 deals: at most 2; three tied at the top
  assert.deepEqual(ids(r.lookFirst).sort(), ['d00', 'd01']);
});

test('a lone deal, or a tie that fits under the cap, is not a tie at the cut', () => {
  assert.deepEqual(ids(allFlagged([100]).lookFirst), ['d00']);
  assert.deepEqual(ids(allFlagged([50, 50, ...Array(28).fill(0)]).lookFirst).sort(), ['d00', 'd01']); // 30 deals: at most 3
});

test('a tie that straddles the cut is left out whole when deals above it fill the set', () => {
  const r = allFlagged([100, 50, 50, 50, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]); // 20 deals: at most 2
  assert.deepEqual(ids(r.lookFirst), ['d00']);
});

test('a zero amount is never large', () => {
  assert.deepEqual(allFlagged([0]).lookFirst, []);
  assert.deepEqual(allFlagged(Array(10).fill(0)).lookFirst, []);
});

test('the large-deal threshold can be set in dollars, or turned off', () => {
  const prev = snap('2026-09-28', [deal({ id: 'a', amount: 60000 }), deal({ id: 'b', amount: 40000 })]);
  const curr = snap(TODAY, [deal({ id: 'a', amount: 60000, next_step: '' }), deal({ id: 'b', amount: 40000, next_step: '' })]);
  assert.deepEqual(ids(compare(prev, curr, TODAY, { largeDeal: 40000 }).lookFirst), ['a', 'b']);
  const off = compare(prev, curr, TODAY, { largeDeal: false });
  assert.equal(off.large.ids.size, 0);
  assert.deepEqual(off.lookFirst, []);
});

test('a single slip into a later calendar quarter puts a deal in look first, and says which quarter', () => {
  const r = compare(
    snap('2026-09-28', [
      deal({ id: 'cross', amount: 1, close_date: '2026-12-20' }),
      deal({ id: 'same-q', amount: 1, close_date: '2026-10-02' }),
      deal({ id: 'big', amount: 1000000, close_date: '2026-12-01' }),
    ]),
    snap(TODAY, [
      deal({ id: 'cross', amount: 1, close_date: '2027-01-05' }),
      deal({ id: 'same-q', amount: 1, close_date: '2026-12-31' }),
      deal({ id: 'big', amount: 1000000, close_date: '2026-12-01' }),
    ]),
    TODAY,
  );
  assert.deepEqual(ids(r.lookFirst), ['cross']);
  assert.deepEqual(r.lookFirst[0].reasons, ['slipped into Q1 2027']);
});

test('look-first reasons list every rule a deal meets', () => {
  const r = compare(
    snap('2026-09-28', [deal({ id: 'q', amount: 120000, close_date: '2026-10-19' }), deal({ id: 's', amount: 10 })]),
    snap(TODAY, [deal({ id: 'q', amount: 120000, close_date: '2027-01-15', next_step: '' }), deal({ id: 's', amount: 10 })]),
    TODAY,
  );
  assert.deepEqual(r.lookFirst[0].reasons, ['2 warning signs', 'slipped into Q1 2027', 'large deal']);
});

// A snapshot's stage layout, as buildSnapshot writes it: each pipeline's stages in order.
const layout = (...stages) => [{ id: 'default', label: 'Sales Pipeline', stages: stages.map((id, order) => ({ id, label: id, order, status: 'open' })) }];

test('a move into a reversed pipeline is judged in the current layout, even when the old stage is now empty', () => {
  // Last week A=0, B=1, C=2. An admin reverses it (C=0, B=1, A=2) and X moves A -> B, leaving A empty.
  const prev = { ...snap('2026-09-28', [deal({ id: 'x', stage_id: 'A', stage: 'A', stage_order: 0 })]), pipelines: layout('A', 'B', 'C') };
  const curr = { ...snap(TODAY, [deal({ id: 'x', stage_id: 'B', stage: 'B', stage_order: 1 })]), pipelines: layout('C', 'B', 'A') };
  const r = compare(prev, curr, TODAY);
  assert.deepEqual(ids(r.back), ['x']);
  assert.deepEqual(r.forward, []);
});

test('a stage moved to the end of the pipeline: a move out of it is judged in the current layout, not silent', () => {
  // Last week A=0, B=1, C=2. B is moved to the end (A=0, C=1, B=2) and X moves B -> C, leaving B empty.
  const prev = { ...snap('2026-09-28', [deal({ id: 'x', stage_id: 'B', stage: 'B', stage_order: 1 })]), pipelines: layout('A', 'B', 'C') };
  const curr = { ...snap(TODAY, [deal({ id: 'x', stage_id: 'C', stage: 'C', stage_order: 1 })]), pipelines: layout('A', 'C', 'B') };
  const r = compare(prev, curr, TODAY);
  assert.deepEqual(ids(r.back), ['x']);
});

test('a deal that moved to another pipeline is listed as a transfer, with where it came from', () => {
  const r = compare(
    snap('2026-09-28', [
      deal({ id: 't', pipeline_id: 'default', pipeline: 'Sales Pipeline', stage_id: 'demo', stage: 'Demo', amount: 50 }),
      deal({ id: 'stay', amount: 10 }),
      deal({ id: 'closed', status: 'lost' }),
    ]),
    snap(TODAY, [
      deal({ id: 't', pipeline_id: 'ren', pipeline: 'Renewals', stage_id: 'up', stage: 'Upcoming', amount: 50 }),
      deal({ id: 'stay', amount: 10 }),
      deal({ id: 'closed', status: 'lost', pipeline_id: 'ren', pipeline: 'Renewals' }),
    ]),
    TODAY,
  );
  assert.deepEqual(r.transferred.map((t) => [t.deal.id, t.fromPipeline, t.fromStage]), [['t', 'Sales Pipeline', 'Demo']]);
  assert.deepEqual(r.back, []);
  assert.deepEqual(r.forward, []);
});

test('a move out of a deleted stage during a reorder is reported as a stage change with no direction, not silent', () => {
  // Last week X sat in S (order 0). S is deleted and the pipeline reordered to B=0, A=1; X is now in B.
  // The old order comes from last week's layout and the new one from today's, so no direction is claimed.
  const prev = { ...snap('2026-09-28', [deal({ id: 'x', stage_id: 'S', stage: 'S', stage_order: 0 })]), pipelines: layout('S', 'A', 'B') };
  const curr = { ...snap(TODAY, [deal({ id: 'x', stage_id: 'B', stage: 'B', stage_order: 0 })]), pipelines: layout('B', 'A') };
  const r = compare(prev, curr, TODAY);
  assert.deepEqual(r.changedStage.map((m) => [m.deal.id, m.from]), [['x', 'S']]);
  assert.deepEqual(r.back, []);
  assert.deepEqual(r.forward, []);
  assert.deepEqual(r.lookFirst, []);
});

test('a deleted old stage never borrows last week\'s order for a direction', () => {
  // S was order 0, B order 2; S is deleted and B becomes 1. Mixing the two layouts would say "forward".
  const prev = { ...snap('2026-09-28', [deal({ id: 'x', stage_id: 'S', stage: 'S', stage_order: 0 })]), pipelines: layout('S', 'A', 'B') };
  const curr = { ...snap(TODAY, [deal({ id: 'x', stage_id: 'B', stage: 'B', stage_order: 1 })]), pipelines: layout('A', 'B') };
  const r = compare(prev, curr, TODAY);
  assert.deepEqual(r.changedStage.map((m) => m.deal.id), ['x']);
  assert.deepEqual(r.forward, []);
});

test('without a stored layout, two different stages at the same order are a stage change, not silence', () => {
  const r = compare(
    snap('2026-09-28', [deal({ id: 'x', stage_id: 'S', stage: 'S', stage_order: 0 })]),
    snap(TODAY, [deal({ id: 'x', stage_id: 'B', stage: 'B', stage_order: 0 })]),
    TODAY,
  );
  assert.deepEqual(r.changedStage.map((m) => m.deal.id), ['x']);
});

test('a first run and a quiet week have no stage changes', () => {
  assert.deepEqual(compare(null, snap(TODAY, [deal({})]), TODAY).changedStage, []);
  assert.deepEqual(compare(snap('2026-09-28', [deal({})]), snap(TODAY, [deal({})]), TODAY).changedStage, []);
});

test('a deal that went straight to a closed stage of another pipeline records the pipeline it left', () => {
  const r = compare(
    snap('2026-09-28', [
      deal({ id: 'jump', pipeline_id: 'default', pipeline: 'Sales Pipeline' }),
      deal({ id: 'plain' }),
      deal({ id: 'old', status: 'won', pipeline_id: 'default' }),
    ]),
    snap(TODAY, [
      deal({ id: 'jump', pipeline_id: 'onb', pipeline: 'Onboarding', status: 'won' }),
      deal({ id: 'plain', status: 'lost' }),
      deal({ id: 'old', status: 'won', pipeline_id: 'onb', pipeline: 'Onboarding' }),
      deal({ id: 'new', status: 'won', pipeline_id: 'onb', pipeline: 'Onboarding' }),
    ]),
    TODAY,
  );
  assert.deepEqual([...r.closedMoves].map(([id, m]) => [id, m.fromPipeline, m.fromPipelineId]), [['jump', 'Sales Pipeline', 'default']]);
  assert.deepEqual(r.bridge.won.count, 2);
  assert.deepEqual(r.transferred, []);
});

// F1: a deal closed at both ends of the comparison is never in the open pipeline, so it needs
// its own list or it vanishes.
test('a deal that flips between closed states, or whose closed amount changes, is Changed after closing, never Won or Lost', () => {
  const r = compare(
    snap('2026-09-28', [
      deal({ id: '9', amount: 250000, status: 'won' }),
      deal({ id: '10', amount: 40000, status: 'lost' }),
      deal({ id: '11', amount: 80000, status: 'won' }),
      deal({ id: '12', amount: 5000, status: 'won' }),
    ]),
    snap(TODAY, [
      deal({ id: '9', amount: 250000, status: 'lost' }),
      deal({ id: '10', amount: 45000, status: 'won' }),
      deal({ id: '11', amount: 95000, status: 'won' }),
      deal({ id: '12', amount: 5000, status: 'won' }),
    ]),
    TODAY,
  );
  assert.deepEqual(r.won, []);
  assert.deepEqual(r.lost, []);
  assert.deepEqual(r.changedAfterClose.map((c) => [c.deal.id, c.fromStatus, c.deal.status, c.fromAmount, c.deal.amount]), [
    ['9', 'won', 'lost', 250000, 250000],
    ['11', 'won', 'won', 80000, 95000],
    ['10', 'lost', 'won', 40000, 45000],
  ]);
  assert.equal(r.bridge.start, 0);
  assert.equal(r.bridge.end, 0);
});
