import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSnapshot } from '../src/snapshot.mjs';

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/hubspot/${name}`, import.meta.url)));
const raw = {
  deals: [...fx('deals-page1.json').results, ...fx('deals-page2.json').results],
  pipelines: fx('pipelines.json').results,
  owners: [...fx('owners.json').results, ...fx('owners-archived.json').results],
  takenAt: new Date('2026-10-05T07:00:00.000Z'),
  date: '2026-10-05',
};
const snap = buildSnapshot(raw);
const byName = Object.fromEntries(snap.deals.map((d) => [d.name, d]));

test('snapshot carries schema, date and source', () => {
  assert.equal(snap.schema, 1);
  assert.equal(snap.date, '2026-10-05');
  assert.equal(snap.taken_at, '2026-10-05T07:00:00.000Z');
  assert.equal(snap.source, 'hubspot');
  assert.equal(snap.deals.length, 6);
});

test('stage label and order come from the pipeline displayOrder', () => {
  assert.equal(byName.Northwind.stage, 'Qualified');
  assert.equal(byName.Northwind.stage_order, 1);
  assert.equal(byName.Halcyon.stage_order, 4);
  assert.equal(byName.Northwind.pipeline, 'Sales Pipeline');
  assert.equal(byName.Northwind.pipeline_id, 'default');
});

test('won and lost come from stage metadata, not label text', () => {
  assert.equal(byName['Cobalt Labs'].status, 'won'); // label "Signed but billing"
  assert.equal(byName.Meridian.status, 'lost');
  assert.equal(byName['Acme renewal'].status, 'lost');
  assert.equal(byName.Halcyon.status, 'open'); // label "Won? (legacy label)" is open
  assert.equal(byName.Northwind.status, 'open');
});

test('owner ids resolve to names, including archived owners', () => {
  assert.equal(byName.Northwind.owner, 'Dana Ruiz');
  assert.equal(byName.Halcyon.owner, 'Leo');
  assert.equal(byName['Cobalt Labs'].owner, 'Morgan Ex');
  assert.equal(byName.Mystery.owner, 'nofirst@example.com');
  assert.equal(byName.Meridian.owner, 'Unassigned');
  assert.equal(byName['Acme renewal'].owner, 'Owner 555');
});

test('amounts, dates and next steps are normalised', () => {
  assert.equal(byName.Halcyon.amount, 24000.5);
  assert.equal(byName['Cobalt Labs'].amount, 26400); // amount_in_home_currency wins when present
  assert.equal(byName.Meridian.amount, 0);
  assert.equal(byName.Northwind.close_date, '2026-12-02');
  assert.equal(byName.Meridian.close_date, null);
  assert.equal(byName.Northwind.last_activity, '2026-10-01');
  assert.equal(byName.Halcyon.last_activity, null);
  assert.equal(byName.Halcyon.next_step, '');
  assert.equal(byName.Meridian.next_step, '');
  assert.equal(byName.Northwind.next_step, 'Pricing call');
});

test('an unknown stage keeps its id, has no order and counts as open', () => {
  assert.equal(byName.Mystery.stage, 'deleted-stage');
  assert.equal(byName.Mystery.stage_order, null);
  assert.equal(byName.Mystery.status, 'open');
});

test('snapshot deals hold only the documented fields', () => {
  assert.deepEqual(Object.keys(byName.Northwind).sort(), [
    'amount', 'close_date', 'id', 'last_activity', 'name', 'next_step', 'owner',
    'pipeline', 'pipeline_id', 'stage', 'stage_id', 'stage_order', 'status',
  ]);
});

// One pipeline, one stage with the given metadata, one deal in it: the deal's status.
function statusFor(metadata) {
  const stage = { id: 's1', label: 'Stage', displayOrder: 0, archived: false };
  if (metadata !== undefined) stage.metadata = metadata;
  const s = buildSnapshot({
    deals: [{ id: '1', properties: { dealname: 'D', pipeline: 'p1', dealstage: 's1', amount: '100' } }],
    pipelines: [{ id: 'p1', label: 'P', stages: [stage] }],
    owners: [],
    takenAt: new Date('2026-10-05T07:00:00.000Z'),
    date: '2026-10-05',
  });
  return s.deals[0].status;
}

test('without isClosed, a stage at probability 1 is won and at 0 is lost, in any spelling', () => {
  for (const p of ['1.0', '1', 1]) assert.equal(statusFor({ probability: p }), 'won', `probability ${JSON.stringify(p)}`);
  for (const p of ['0.0', '0', 0]) assert.equal(statusFor({ probability: p }), 'lost', `probability ${JSON.stringify(p)}`);
  for (const p of ['0.4', 0.4, '0.9']) assert.equal(statusFor({ probability: p }), 'open', `probability ${JSON.stringify(p)}`);
});

test('without isClosed or probability, a stage is open', () => {
  assert.equal(statusFor({}), 'open');
  assert.equal(statusFor(undefined), 'open');
  assert.equal(statusFor({ probability: '' }), 'open');
});

test('when isClosed is present it decides open or closed, and probability decides won or lost', () => {
  assert.equal(statusFor({ isClosed: 'true', probability: '1.0' }), 'won');
  assert.equal(statusFor({ isClosed: 'true', probability: '0.0' }), 'lost');
  assert.equal(statusFor({ isClosed: 'true' }), 'lost');
  assert.equal(statusFor({ isClosed: true, probability: 1 }), 'won');
  assert.equal(statusFor({ isClosed: true, probability: '0.0' }), 'lost');
  assert.equal(statusFor({ isClosed: 'false', probability: '1.0' }), 'open');
  assert.equal(statusFor({ isClosed: false, probability: '0.0' }), 'open');
});
