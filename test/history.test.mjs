import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueAt, rebuildAt, closeDateMoves, layoutAsOf, layoutsAt, knownAt, HISTORY_CAP, COMPARE_FIELDS, UNKNOWN_FIELDS, archivedBatches } from '../src/history.mjs';

// The rebuilt deals alone.
const dealsAsOf = (records, at) => rebuildAt(records, at).deals;

// HubSpot returns versions newest first; the function must not depend on that order.
const STAGE = [
  { value: 'evaluation', timestamp: '2026-10-09T04:39:22.208Z' },
  { value: 'alignment', timestamp: '2026-10-09T04:39:12.156Z' },
];

test('valueAt returns the value in force at the instant', () => {
  assert.equal(valueAt(STAGE, new Date('2026-10-09T04:39:17Z')), 'alignment');
  assert.equal(valueAt(STAGE, new Date('2026-10-09T05:00:00Z')), 'evaluation');
});

test('valueAt counts a version written exactly at the instant', () => {
  assert.equal(valueAt(STAGE, new Date('2026-10-09T04:39:22.208Z')), 'evaluation');
});

test('valueAt is undefined before the first version, and for no history', () => {
  assert.equal(valueAt(STAGE, new Date('2026-10-09T04:00:00Z')), undefined);
  assert.equal(valueAt([], new Date()), undefined);
  assert.equal(valueAt(undefined, new Date()), undefined);
});

test('valueAt ignores input order', () => {
  assert.equal(valueAt([...STAGE].reverse(), new Date('2026-10-09T04:39:17Z')), 'alignment');
});

const record = (id, createdAt, extra = {}) => ({
  id,
  createdAt,
  url: `https://app.hubspot.com/contacts/1/record/0-3/${id}`,
  archived: false,
  propertiesWithHistory: {
    createdate: [{ value: createdAt, timestamp: createdAt }],
    dealstage: [
      { value: 'alignment', timestamp: '2026-10-09T04:39:22Z' },
      { value: 'discovery', timestamp: createdAt },
    ],
    hs_next_step: [],
  },
  ...extra,
});

test('dealsAsOf rebuilds each deal\'s properties as of the instant', () => {
  const [d] = dealsAsOf([record('1', '2026-10-09T04:39:11Z')], new Date('2026-10-09T04:39:17Z'));
  assert.equal(d.id, '1');
  assert.equal(d.properties.dealstage, 'discovery');
  assert.equal(d.properties.hs_next_step, null);
  assert.equal(d.createdAt, '2026-10-09T04:39:11Z');
  assert.match(d.url, /^https:/);
});

test('dealsAsOf leaves out a deal created after the instant', () => {
  const out = dealsAsOf([record('1', '2026-10-09T04:39:11Z'), record('2', '2026-10-09T04:39:28Z')], new Date('2026-10-09T04:39:17Z'));
  assert.deepEqual(out.map((d) => d.id), ['1']);
});

test('dealsAsOf keeps a deal archived after the instant and drops one archived before it', () => {
  const later = record('1', '2026-10-09T04:39:11Z', { archived: true, archivedAt: '2026-10-09T04:39:23Z' });
  const earlier = record('2', '2026-10-09T04:39:11Z', { archived: true, archivedAt: '2026-10-09T04:39:15Z' });
  const out = dealsAsOf([later, earlier], new Date('2026-10-09T04:39:17Z'));
  assert.deepEqual(out.map((d) => d.id), ['1']);
});

const CLOSE = [
  { value: '2026-12-31T00:00:00Z', timestamp: '2026-10-09T04:39:27Z' },
  { value: '2026-11-30T00:00:00Z', timestamp: '2026-10-09T04:39:21Z' },
  { value: '2026-11-30T00:00:00Z', timestamp: '2026-10-09T04:39:19Z' },
  { value: '2026-11-15T00:00:00Z', timestamp: '2026-10-09T04:39:11Z' },
];

test('closeDateMoves counts close-date changes inside the window', () => {
  assert.equal(closeDateMoves(CLOSE, new Date('2026-10-09T04:39:12Z'), new Date('2026-10-09T05:00:00Z')), 2);
  assert.equal(closeDateMoves(CLOSE, new Date('2026-10-09T04:39:22Z'), new Date('2026-10-09T05:00:00Z')), 1);
});

test('closeDateMoves does not count the first value or a rewrite of the same value', () => {
  assert.equal(closeDateMoves(CLOSE, new Date('2026-10-09T04:00:00Z'), new Date('2026-10-09T04:39:18Z')), 0);
  assert.equal(closeDateMoves(CLOSE, new Date('2026-10-09T04:39:20Z'), new Date('2026-10-09T04:39:22Z')), 0);
  assert.equal(closeDateMoves([], new Date(0), new Date()), 0);
});

const raw = (version, stages) => JSON.stringify({
  pipelineId: 'default', label: `Sales v${version}`, version,
  stages: stages.map(([stageId, displayOrder]) => ({ stageId, label: stageId, displayOrder, metadata: { isClosed: 'false', probability: '0.5' } })),
});
// The pipeline audit, newest first, as GET /crm/v3/pipelines/deals/{id}/audit returns it.
const AUDIT = [
  { action: 'UPDATE', timestamp: '2026-10-07T06:32:24.449Z', rawObject: raw(1, [['b', 0], ['a', 1]]) },
  { action: 'CREATE', timestamp: '2026-10-07T06:32:24.345Z', rawObject: raw(0, [['a', 0], ['b', 1]]) },
];

test('layoutAsOf returns the pipeline layout in force at the instant, shaped like the pipelines API', () => {
  const before = layoutAsOf(AUDIT, new Date('2026-10-07T06:32:24.400Z'));
  assert.equal(before.id, 'default');
  assert.equal(before.label, 'Sales v0');
  assert.deepEqual(before.stages.map((s) => [s.id, s.displayOrder]), [['a', 0], ['b', 1]]);
  assert.equal(before.stages[0].metadata.probability, '0.5');
  const after = layoutAsOf(AUDIT, new Date('2026-10-08T00:00:00Z'));
  assert.deepEqual(after.stages.map((s) => [s.id, s.displayOrder]), [['b', 0], ['a', 1]]);
});

test('layoutAsOf is null before the pipeline existed or after it was deleted', () => {
  assert.equal(layoutAsOf(AUDIT, new Date('2026-10-01T00:00:00Z')), null);
  const deleted = [{ action: 'DELETE', timestamp: '2026-10-08T00:00:00Z', rawObject: raw(2, []) }, ...AUDIT];
  assert.equal(layoutAsOf(deleted, new Date('2026-10-09T00:00:00Z')), null);
});

// HubSpot keeps the newest 20 versions of a deal property; older ones are dropped.
const full = Array.from({ length: 20 }, (_, i) => ({ value: `v${i + 5}`, timestamp: new Date(Date.UTC(2026, 9, 9, 4, 43, 11 + i)).toISOString() }));

test('knownAt is false before the oldest version of a history that hit the cap', () => {
  assert.equal(HISTORY_CAP, 20);
  assert.equal(knownAt(full, new Date('2026-10-09T04:43:00Z')), false);
  assert.equal(knownAt(full, new Date('2026-10-09T04:43:11Z')), true);
});

test('knownAt is true for a history under the cap, at any instant', () => {
  assert.equal(knownAt(full.slice(0, 19), new Date('2026-10-09T04:00:00Z')), true);
  assert.equal(knownAt([], new Date('2026-10-09T04:00:00Z')), true);
});

test('closeDateMoves skips the close date HubSpot sets itself when a deal closes', () => {
  const won = [
    { value: '2026-10-09T04:39:22.906Z', timestamp: '2026-10-09T04:39:22.906Z', sourceType: 'INTERNAL_PROCESSING', sourceId: 'close-date-automation' },
    { value: '2026-10-15T00:00:00Z', timestamp: '2026-10-09T04:39:12.891Z', sourceType: 'INTEGRATION' },
  ];
  assert.equal(closeDateMoves(won, new Date('2026-10-09T04:39:15Z'), new Date('2026-10-09T05:00:00Z')), 0);
});

test('dealsAsOf leaves out a deal imported with a backdated createdate before its first stage version', () => {
  const imported = record('9', '2026-09-01T12:00:00Z');
  imported.propertiesWithHistory.createdate = [{ value: '2026-09-01T12:00:00Z', timestamp: '2026-10-09T04:45:17Z' }];
  imported.propertiesWithHistory.dealstage = [{ value: 'discovery', timestamp: '2026-10-09T04:45:17Z' }];
  assert.deepEqual(dealsAsOf([imported], new Date('2026-10-02T00:00:00Z')), []);
  assert.equal(dealsAsOf([imported], new Date('2026-10-09T05:00:00Z')).length, 1);
});

// Two versions written in the same millisecond: HubSpot lists the newer one first, so the
// lower original index is the later write.
test('valueAt breaks a same-millisecond tie on the original index: the first listed wins', () => {
  const tie = [
    { value: 'newer', timestamp: '2026-10-09T04:45:53.669Z' },
    { value: 'older', timestamp: '2026-10-09T04:45:53.669Z' },
    { value: 'first', timestamp: '2026-10-09T04:45:17.774Z' },
  ];
  assert.equal(valueAt(tie, new Date('2026-10-09T05:00:00Z')), 'newer');
});

test('closeDateMoves orders a same-millisecond tie by original index (first listed is newest)', () => {
  const tie = [
    { value: '2026-11-30T00:00:00Z', timestamp: '2026-10-09T04:39:21Z' },
    { value: '2026-12-31T00:00:00Z', timestamp: '2026-10-09T04:39:21Z' },
    { value: '2026-11-15T00:00:00Z', timestamp: '2026-10-09T04:39:11Z' },
  ];
  // Real order: Nov 15 -> Dec 31 (slip) -> Nov 30 (pull-in). One slip.
  assert.equal(closeDateMoves(tie, new Date('2026-10-09T04:39:12Z'), new Date('2026-10-09T05:00:00Z')), 1);
});

test('closeDateMoves counts only moves to a later date: a pull-in is not a slip', () => {
  const pull = [
    { value: '2026-11-01T00:00:00Z', timestamp: '2026-10-09T04:39:30Z' },
    { value: '2026-12-01T00:00:00Z', timestamp: '2026-10-09T04:39:20Z' },
    { value: '2026-11-15T00:00:00Z', timestamp: '2026-10-09T04:39:11Z' },
  ];
  assert.equal(closeDateMoves(pull, new Date('2026-10-09T04:39:12Z'), new Date('2026-10-09T05:00:00Z')), 1);
});

const LIVE = [{ id: 'default', label: 'Sales today', stages: [{ id: 'b', label: 'b', displayOrder: 0, metadata: {} }] }];

test('layoutsAt uses the audit when it has entries, and today\'s layout when the audit is empty or missing (a 404)', () => {
  assert.equal(layoutsAt(LIVE, new Map([['default', AUDIT]]), new Date('2026-10-07T06:32:24.400Z'))[0].label, 'Sales v0');
  assert.equal(layoutsAt(LIVE, new Map([['default', []]]), new Date('2026-10-07T06:32:24.400Z'))[0].label, 'Sales today');
  assert.equal(layoutsAt(LIVE, new Map(), new Date('2026-10-07T06:32:24.400Z'))[0].label, 'Sales today');
});

test('layoutsAt leaves out a pipeline whose audit says it did not exist yet', () => {
  assert.deepEqual(layoutsAt(LIVE, new Map([['default', AUDIT]]), new Date('2026-10-01T00:00:00Z')), []);
});

const T = new Date('2026-10-09T05:00:00Z');
const at = (sec) => new Date(Date.UTC(2026, 9, 9, 5, 0, sec)).toISOString();
const versions = (n, from, value = (i) => `v${i}`) => Array.from({ length: n }, (_, i) => ({ value: value(n - i), timestamp: at(from + n - i) })) ;
const deal = (id, history, extra = {}) => ({
  id, createdAt: '2026-10-09T04:00:00Z', archived: false, properties: {},
  propertiesWithHistory: {
    createdate: [{ value: '2026-10-09T04:00:00Z', timestamp: '2026-10-09T04:00:00Z' }],
    dealstage: [{ value: 's1', timestamp: '2026-10-09T04:00:00Z' }],
    amount: [{ value: '100', timestamp: '2026-10-09T04:00:00Z' }],
    ...history,
  },
  ...extra,
});

test('COMPARE_FIELDS names exactly the snapshot fields compare() reads', () => {
  assert.deepEqual(Object.keys(COMPARE_FIELDS).sort(), ['amount', 'close_date', 'last_activity', 'next_step', 'owner', 'pipeline_id', 'stage_id', 'stage_order', 'status'].sort());
});

test('rebuildAt: a deal whose capped dealstage history starts after T could not be rebuilt; it is never dropped', () => {
  const capped = deal('7', { dealstage: versions(20, 10) });
  const r = rebuildAt([capped], T);
  assert.deepEqual(r.deals, []);
  assert.deepEqual(r.unknown.map(({ id, reason, fields }) => ({ id, reason, fields })), [{ id: '7', reason: 'capped', fields: ['stage_id', 'status', 'stage_order'] }]);
});

test('rebuildAt: a capped property compare does not read leaves the deal rebuilt', () => {
  const r = rebuildAt([deal('8', { dealname: versions(20, 10) })], T);
  assert.deepEqual(r.unknown, []);
  assert.equal(r.deals[0].properties.dealstage, 's1');
});

test('rebuildAt: unknowns are tracked per field', () => {
  const r = rebuildAt([deal('9', { closedate: versions(20, 10) })], T);
  assert.deepEqual(r.unknown.map(({ id, reason, fields }) => ({ id, reason, fields })), [{ id: '9', reason: 'capped', fields: ['close_date'] }]);
});

test('rebuildAt: a merged record with a MERGE_OBJECTS version after T could not be rebuilt', () => {
  const merged = deal('10', { amount: [
    { value: '100', timestamp: at(30), sourceType: 'MERGE_OBJECTS' },
    { value: '50', timestamp: at(20) },
    { value: '100', timestamp: '2026-10-09T04:00:00Z' },
  ] }, { properties: { hs_merged_object_ids: '11;12' } });
  assert.deepEqual(rebuildAt([merged], T).unknown.map((u) => [u.id, u.reason, u.fields]), [['10', 'merged', UNKNOWN_FIELDS]]);
  assert.deepEqual(rebuildAt([merged], new Date(at(40))).unknown, []);
});

test('rebuildAt: a backdated import with an uncapped stage history is still absent before its first stage version', () => {
  const imported = deal('13', { dealstage: [{ value: 's1', timestamp: at(30) }] }, { createdAt: '2026-09-01T00:00:00Z' });
  assert.deepEqual(rebuildAt([imported], T), { deals: [], unknown: [] });
});

test('archivedBatches keeps only deals archived after T, in batch-read chunks of 50', () => {
  const list = Array.from({ length: 120 }, (_, i) => ({ id: String(i), archivedAt: i < 10 ? '2026-10-01T00:00:00Z' : '2026-10-09T00:00:00Z' }));
  const batches = archivedBatches(list, new Date('2026-10-05T00:00:00Z'));
  assert.deepEqual(batches.map((b) => b.length), [50, 50, 10]);
  assert.equal(batches[0][0], '10');
  assert.deepEqual(archivedBatches([{ id: '1', archivedAt: '2026-10-05T00:00:00Z' }], new Date('2026-10-05T00:00:00Z')), []);
});

// compare() and the bridge read owner, next_step and last_activity from today's snapshot only.
test('UNKNOWN_FIELDS are the fields compare() and the bridge read from the previous snapshot', () => {
  assert.deepEqual(UNKNOWN_FIELDS, ['stage_id', 'status', 'stage_order', 'pipeline_id', 'amount', 'close_date']);
});

test('rebuildAt: a capped owner, next step or activity history never sends a deal to could-not-rebuild', () => {
  for (const prop of ['notes_last_updated', 'hs_next_step', 'hubspot_owner_id']) {
    const r = rebuildAt([deal('14', { [prop]: versions(20, 10) })], T);
    assert.deepEqual(r.unknown, [], prop);
    assert.deepEqual(r.deals.map((x) => x.id), ['14'], prop);
  }
});

test('rebuildAt: a backdated import whose every property starts after T is absent, even with a capped stage history', () => {
  const imported = deal('15', {
    createdate: [{ value: '2026-09-01T00:00:00Z', timestamp: at(5) }],
    dealstage: versions(20, 10),
    amount: [{ value: '100', timestamp: at(5) }],
  }, { createdAt: '2026-09-01T00:00:00Z' });
  assert.deepEqual(rebuildAt([imported], T), { deals: [], unknown: [] });
});

test('closeDateMoves: clearing the close date, or setting one after it was cleared, is not a slip', () => {
  const cleared = [
    { value: '2026-12-31T00:00:00Z', timestamp: '2026-10-09T04:39:30Z' },
    { value: '', timestamp: '2026-10-09T04:39:20Z' },
    { value: '2026-11-15T00:00:00Z', timestamp: '2026-10-09T04:39:11Z' },
  ];
  assert.equal(closeDateMoves(cleared, new Date('2026-10-09T04:39:12Z'), new Date('2026-10-09T05:00:00Z')), 0);
});

test('rebuildAt: a merged record names its merge sources', () => {
  const merged = deal('20', { amount: [{ value: '100', timestamp: at(30), sourceType: 'MERGE_OBJECTS' }, { value: '100', timestamp: '2026-10-09T04:00:00Z' }] },
    { properties: { hs_merged_object_ids: '21;22' } });
  const [u] = rebuildAt([merged], T).unknown;
  assert.deepEqual(u.sources, ['21', '22']);
  assert.equal(u.properties, undefined);
});

test('rebuildAt: a capped deal carries its properties at T, with every property that cannot answer left null', () => {
  const [u] = rebuildAt([deal('23', { closedate: versions(20, 10), amount_in_home_currency: [{ value: '250', timestamp: '2026-10-09T04:00:00Z' }] })], T).unknown;
  assert.equal(u.reason, 'capped');
  assert.equal(u.properties.amount_in_home_currency, '250');
  assert.equal(u.properties.dealstage, 's1');
  assert.equal(u.properties.closedate, null);
  const [v] = rebuildAt([deal('24', { dealstage: versions(20, 10), amount: versions(20, 10, (i) => String(i)) })], T).unknown;
  assert.equal(v.properties.amount, null);
  assert.equal(v.properties.dealstage, null);
});
