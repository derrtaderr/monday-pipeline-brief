import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convertSeed } from './helpers/convert-seed.mjs';
import { compare } from '../src/compare.mjs';
import { renderBrief } from '../src/render.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const DATES = ['2026-09-28', '2026-10-05'];

for (const date of DATES) {
  test(`demo snapshot ${date} is the documented conversion of the seed fixture`, () => {
    assert.deepEqual(
      json(`../demo/snapshot-${date}.json`),
      convertSeed(json(`./fixtures/seed/snapshot-${date}.json`), date),
    );
  });
}

const demo = (opts) => renderBrief(compare(json('../demo/snapshot-2026-09-28.json'), json('../demo/snapshot-2026-10-05.json'), '2026-10-05'), opts);
const strip = (text) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

test('the demo brief shows every section the brief can write', () => {
  const out = demo();
  const titles = [...out.matchAll(/^\*\*([^*]+)\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(titles, [
    'How the open pipeline changed', 'Look at these first', 'Close date passed', 'Slipped close dates',
    'Moved back a stage', 'No next step, or no activity in 14+ days', 'Moved forward', 'Changed stage', 'Moved to another pipeline', 'Amount changed',
    'New this week', 'Reopened', 'Closed', 'Changed after closing', 'Removed from HubSpot',
  ]);
});

test('the demo shows each new v0.2 case on a named deal', () => {
  const out = strip(demo());
  assert.match(out, /- Northwind, \$90K, Dana: \$75,000 → \$90,000\n/);
  assert.match(out, /- Westfield, \$60K, Dana: \$75,000 → \$60,000\n/);
  assert.match(out, /- Lumen Health, \$96K, Dana: \$90,000 → \$96,000, then won\n/);
  assert.match(out, /- Juniper Bio, \$40K, Leo: was open in Discovery/);
  assert.match(out, /- Marlowe Systems, \$30K, Marcus: was lost, now in Demo\n/);
  assert.match(out, /- Orchard AI, \$32K, Leo: close date was Sep 30, 5 days ago\n/);
  assert.match(out, /- Halcyon, \$24K, Leo: close date slipped, no activity in 14\+ days \(2 warning signs\)\n/);
  assert.match(out, /- Quarry, \$120K, Leo: close date slipped \(slipped into Q1 2027; large deal\)\n/);
  assert.match(demo(), /- \[Quarry\]\(https:\/\/app\.hubspot\.com\/contacts\/1234567\/record\/0-3\/D105\), \$120K, Leo/);
});

test('the demo grouped by owner gives every rep a heading', () => {
  const out = demo({ groupBy: 'owner' });
  assert.deepEqual([...out.matchAll(/^## (\w+),/gm)].map((m) => m[1]), ['Dana', 'Leo', 'Priya', 'Marcus']);
});

test('the demo has two pipelines, a transfer between them, and a reorder that moves no deal', () => {
  const out = strip(demo());
  assert.match(out, /\*\*Moved to another pipeline\*\* \(1\)\n- Tessellate, \$40K, Marcus: Sales Pipeline \(Discovery\) → Renewals \(Upcoming\)\n/);
  const curr = json('../demo/snapshot-2026-10-05.json');
  const prev = json('../demo/snapshot-2026-09-28.json');
  const order = (s, id) => s.deals.find((d) => d.id === id).stage_order;
  assert.notEqual(order(prev, 'D125'), order(curr, 'D125'), 'Pemberton sits in a stage the admin reordered');
  assert.doesNotMatch(out, /Pemberton/, 'a reorder alone is never a move');
  const grouped = strip(demo({ groupBy: 'pipeline' }));
  assert.deepEqual([...grouped.matchAll(/^## ([^,]+),/gm)].map((m) => m[1]), ['Sales Pipeline', 'Renewals']);
  assert.equal(grouped.match(/Tessellate, \$40K, Marcus: Sales Pipeline \(Discovery\) → Renewals \(Upcoming\)/g).length, 2);
});

test('the demo shows a stage change out of a deleted stage, and a close straight into another pipeline', () => {
  const out = strip(demo());
  assert.match(out, /\*\*Changed stage\*\* \(1\)\n- Wrenfield Clinics, \$12K, Priya: Paused → Negotiating\n/);
  assert.match(out, /- Harbor Freightworks, \$15K, Leo: won, moved from Sales Pipeline to Renewals\n/);
  const prev = json('../demo/snapshot-2026-09-28.json');
  const curr = json('../demo/snapshot-2026-10-05.json');
  const stages = (s) => s.pipelines.find((p) => p.id === 'renewals').stages.map((st) => st.label);
  assert.ok(stages(prev).includes('Paused') && !stages(curr).includes('Paused'), 'Paused was deleted between the weeks');
  const grouped = strip(demo({ groupBy: 'pipeline' }));
  assert.equal(grouped.match(/Harbor Freightworks, \$15K, Leo: won, moved from Sales Pipeline to Renewals/g).length, 2);
});

test('the demo shows a deal won last week and lost this week under Changed after closing, outside the Closed counts', () => {
  const out = strip(demo());
  assert.match(out, /\*\*Changed after closing\*\* \(1\)\n- Ironbridge Logistics, \$45K, Marcus: was won, now lost\n/);
  assert.match(out, /Closed 3 won \(\$135K\) and 1 lost \(\$90K\)\. 1 deal changed after closing\.\n/);
});
