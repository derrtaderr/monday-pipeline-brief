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

test('created is the createdate day, else the record createdAt day', () => {
  // The hand-recorded pages carry no createdate property, only the top-level createdAt.
  assert.equal(byName.Northwind.created, '2026-08-03');
  const s = buildSnapshot({ ...raw, deals: [
    { id: '1', properties: { dealname: 'A', createdate: '2026-09-20T15:04:11.218Z' }, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: '2', properties: { dealname: 'B', createdate: null } },
  ] });
  assert.equal(s.deals[0].created, '2026-09-20');
  assert.equal(s.deals[1].created, null);
});

test('a real-shaped deals page becomes a correct snapshot', () => {
  const s = buildSnapshot({ ...raw, deals: fx('deals-real-shape.json').results });
  const d = Object.fromEntries(s.deals.map((x) => [x.name, x]));
  assert.deepEqual(d['Larkspur Analytics'], {
    id: '900000000101', name: 'Larkspur Analytics', owner: 'Dana Ruiz',
    pipeline_id: 'default', pipeline: 'Sales Pipeline', stage_id: 'qualifiedtobuy', stage: 'Qualified', stage_order: 1,
    status: 'open', amount: 60000, close_date: '2026-11-13', next_step: '', last_activity: null, created: '2026-10-05',
    url: 'https://app-na2.hubspot.com/contacts/12345678/record/0-3/900000000101',
  });
  assert.equal(d['Wrenfield Labs'].last_activity, '2026-10-01');
  assert.equal(d['Bramblewood Cafe'].owner, 'Unassigned');

});

test('an unknown stage keeps its id, has no order and counts as open', () => {
  assert.equal(byName.Mystery.stage, 'deleted-stage');
  assert.equal(byName.Mystery.stage_order, null);
  assert.equal(byName.Mystery.status, 'open');
});

test('snapshot deals hold only the documented fields', () => {
  assert.deepEqual(Object.keys(byName.Northwind).sort(), [
    'amount', 'close_date', 'created', 'id', 'last_activity', 'name', 'next_step', 'owner',
    'pipeline', 'pipeline_id', 'stage', 'stage_id', 'stage_order', 'status', 'url',
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

test('a deal HubSpot returns twice (a page shifted mid-listing) is kept once', () => {
  const s = buildSnapshot({ ...raw, deals: [
    { id: '1', properties: { dealname: 'A', amount: '10' } },
    { id: '1', properties: { dealname: 'A', amount: '10' } },
    { id: '2', properties: { dealname: 'B', amount: '20' } },
  ] });
  assert.deepEqual(s.deals.map((d) => d.id), ['1', '2']);
});

test('the deal url is kept only when it is an https link, else null', () => {
  const s = buildSnapshot({ ...raw, deals: [
    { id: '1', properties: { dealname: 'A' }, url: 'https://app.hubspot.com/contacts/1/record/0-3/1' },
    { id: '2', properties: { dealname: 'B' } },
    { id: '3', properties: { dealname: 'C' }, url: 'javascript:alert(1)' },
    { id: '4', properties: { dealname: 'D' }, url: 42 },
  ] });
  assert.deepEqual(s.deals.map((d) => d.url), ['https://app.hubspot.com/contacts/1/record/0-3/1', null, null, null]);
});

test('the snapshot stores each pipeline stage layout: id, label, order and status', () => {
  const s = buildSnapshot({
    deals: [],
    pipelines: [{ id: 'p1', label: 'Sales', stages: [
      { id: 'b', label: 'Demo', displayOrder: 1, metadata: { isClosed: 'false', probability: '0.4' } },
      { id: 'a', label: 'Lead', displayOrder: 0, metadata: { isClosed: 'false', probability: '0.1' } },
      { id: 'w', label: 'Won', displayOrder: 2, metadata: { isClosed: 'true', probability: '1.0' } },
    ] }],
    owners: [], takenAt: new Date('2026-10-05T07:00:00.000Z'), date: '2026-10-05',
  });
  assert.deepEqual(s.pipelines, [{ id: 'p1', label: 'Sales', stages: [
    { id: 'a', label: 'Lead', order: 0, status: 'open' },
    { id: 'b', label: 'Demo', order: 1, status: 'open' },
    { id: 'w', label: 'Won', order: 2, status: 'won' },
  ] }]);
});
