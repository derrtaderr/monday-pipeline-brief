import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../src/compare.mjs';
import { renderBrief, toSlack } from '../src/render.mjs';

function deal(over) {
  return {
    id: 'x', name: 'X', owner: 'Dana', pipeline_id: 'default', pipeline: 'Sales Pipeline',
    stage_id: 's1', stage: 'Qualified', stage_order: 1, status: 'open', amount: 10000,
    close_date: '2026-12-01', next_step: 'Call', last_activity: '2026-10-01', ...over,
  };
}
const snap = (date, deals) => ({ schema: 1, date, deals });

test('a deal with no logged activity, created 14+ days ago, says so with its creation date', () => {
  const curr = snap('2026-10-05', [deal({ id: 'c', name: 'Copperfield', owner: 'Leo', amount: 42000, last_activity: null, created: '2026-09-20' })]);
  for (const nextStep of [true, false]) {
    const out = renderBrief(compare(null, curr, '2026-10-05', { nextStep }));
    assert.ok(out.includes('- Copperfield, $42K, Leo: no activity logged since it was created Sep 20\n'), out);
  }
});

test('renders every section in order with counts', () => {
  const prev = snap('2026-09-28', [
    deal({ id: 'a', name: 'Quarry', owner: 'Leo', amount: 120000, close_date: '2026-10-19' }),
    deal({ id: 'b', name: 'Pinecrest', amount: 24000, stage: 'Demo', stage_order: 2, close_date: '2026-10-01' }),
    deal({ id: 'c', name: 'Fernway', amount: 40000, stage: 'Proposal', stage_order: 3 }),
    deal({ id: 'd', name: 'Cobalt Labs', owner: 'Priya', amount: 24000 }),
    deal({ id: 'e', name: 'Meridian', amount: 90000 }),
  ]);
  const curr = snap('2026-10-05', [
    deal({ id: 'a', name: 'Quarry', owner: 'Leo', amount: 120000, close_date: '2027-01-15' }),
    deal({ id: 'b', name: 'Pinecrest', amount: 24000, stage: 'Discovery', stage_order: 0, close_date: '2026-10-10', last_activity: '2026-09-18' }),
    deal({ id: 'c', name: 'Fernway', amount: 40000, stage: 'Negotiation', stage_order: 4, next_step: '' }),
    deal({ id: 'd', name: 'Cobalt Labs', owner: 'Priya', amount: 24000, status: 'won' }),
    deal({ id: 'e', name: 'Meridian', amount: 90000, status: 'lost' }),
    deal({ id: 'f', name: 'Beacon Pay', owner: 'Marcus', amount: 90000, last_activity: null }),
  ]);
  const expected = [
    '# Monday pipeline brief, week of Oct 5',
    '',
    'Compared with the snapshot from Sep 28.',
    '',
    'Open pipeline $274K across 4 deals, down $24K on last week.',
    'Closed 1 won ($24K) and 1 lost ($90K).',
    '',
    '**Look at these first** (more than one warning sign)',
    '- Pinecrest, $24K, Dana: close date slipped, moved back a stage, no activity in 14+ days',
    '',
    '**Slipped close dates** (2)',
    '- Quarry, $120K, Leo: Oct 19 → Jan 15 (+88 days)',
    '- Pinecrest, $24K, Dana: Oct 1 → Oct 10 (+9 days)',
    '',
    '**Moved back a stage** (1)',
    '- Pinecrest, $24K, Dana: Demo → Discovery',
    '',
    '**No next step, or no activity in 14+ days** (3)',
    '- Beacon Pay, $90K, Marcus: next step set, no activity logged',
    '- Fernway, $40K, Dana: no next step',
    '- Pinecrest, $24K, Dana: no activity since Sep 18',
    '',
    '**Moved forward** (1)',
    '- Fernway, $40K, Dana: Proposal → Negotiation',
    '',
    '**New this week** (1)',
    '- Beacon Pay, $90K, Marcus',
    '',
    '**Closed** (2)',
    '- Cobalt Labs, $24K, Priya: won',
    '- Meridian, $90K, Dana: lost',
    '',
  ].join('\n');
  assert.equal(renderBrief(compare(prev, curr, '2026-10-05')), expected);
});

test('an unchanged pipeline reads flat and says nothing is flagged', () => {
  const s = (date) => snap(date, [deal({ id: 'a' })]);
  const out = renderBrief(compare(s('2026-09-28'), s('2026-10-05'), '2026-10-05'));
  assert.match(out, /Open pipeline \$10K across 1 deal, flat on last week\./);
  assert.match(out, /Closed 0 won and 0 lost\./);
  assert.match(out, /Nothing flagged this week\./);
});

test('first run says a comparison needs two weekly runs and keeps current-state sections', () => {
  const out = renderBrief(compare(null, snap('2026-10-05', [deal({ id: 'a', name: 'Arcadia', next_step: '' })]), '2026-10-05'));
  assert.equal(out, [
    '# Monday pipeline brief, week of Oct 5',
    '',
    'This is the first snapshot. A comparison needs two weekly runs, so the week-over-week sections start next week.',
    '',
    'Open pipeline $10K across 1 deal.',
    '',
    '**No next step, or no activity in 14+ days** (1)',
    '- Arcadia, $10K, Dana: no next step',
    '',
  ].join('\n'));
});

test('toSlack converts markdown headings, bold and bullets to Slack mrkdwn', () => {
  assert.equal(toSlack('# Title\n\n**Slipped** (1)\n- A, $1K, Dana: x'), '*Title*\n\n*Slipped* (1)\n• A, $1K, Dana: x');
});

test('each section shows the top 10 by amount, then a count and total for the rest', () => {
  const deals = Array.from({ length: 13 }, (_, i) => deal({ id: `n${i}`, name: `Deal ${i}`, amount: (i + 1) * 1000 }));
  const out = renderBrief(compare(snap('2026-09-28', []), snap('2026-10-05', deals), '2026-10-05'));
  const section = out.slice(out.indexOf('**New this week** (13)'));
  const lines = section.split('\n').slice(1, 12);
  assert.equal(lines[0], '- Deal 12, $13K, Dana');
  assert.equal(lines[9], '- Deal 3, $4K, Dana');
  assert.equal(lines[10], '- and 3 more ($6K)');
});

test('the look-at-these-first list is capped the same way', () => {
  const prev = Array.from({ length: 12 }, (_, i) => deal({ id: `d${i}`, amount: 1000 * (i + 1), close_date: '2026-10-01' }));
  const curr = prev.map((d) => ({ ...d, close_date: '2026-11-01', next_step: '' }));
  const out = renderBrief(compare(snap('2026-09-28', prev), snap('2026-10-05', curr), '2026-10-05'));
  const look = out.slice(out.indexOf('**Look at these first**'), out.indexOf('**Slipped'));
  assert.equal(look.trim().split('\n').length, 12);
  assert.match(look, /- and 2 more \(\$3K\)\n/);
});

test('with the next step check off, the section is titled by what it checks', () => {
  const out = renderBrief(compare(null, snap('2026-10-05', [deal({ id: 'a', name: 'Old', next_step: '', last_activity: '2026-09-01' })]), '2026-10-05', { nextStep: false }));
  assert.match(out, /\*\*No activity in 14\+ days\*\* \(1\)\n- Old, \$10K, Dana: no activity since Sep 1\n/);
  assert.doesNotMatch(out, /next step/i);
});

test('the brief says how many deals sit in stages we could not read', () => {
  const s = (date) => snap(date, [deal({ id: 'a', stage: 'gone', stage_order: null, amount: 24000 }), deal({ id: 'b' })]);
  for (const prev of [null, s('2026-09-28')]) {
    const out = renderBrief(compare(prev, s('2026-10-05'), '2026-10-05'));
    assert.match(out, /1 deal \(\$24K\) is in a stage we couldn't read \(archived or deleted in HubSpot\), counted as open\./);
  }
  const clean = renderBrief(compare(null, snap('2026-10-05', [deal({ id: 'b' })]), '2026-10-05'));
  assert.doesNotMatch(clean, /couldn't read/);
});

test('a zero count is written without a $0 amount', () => {
  const prev = snap('2026-09-28', [deal({ id: 'a', amount: 5000 })]);
  const out = renderBrief(compare(prev, snap('2026-10-05', [deal({ id: 'a', amount: 5000, status: 'won' })]), '2026-10-05'));
  assert.match(out, /Closed 1 won \(\$5K\) and 0 lost\./);
});

test('a comparison that is not about a week old says how old it is and never says "last week"', () => {
  const prev = snap('2026-09-21', [deal({ id: 'a', amount: 10000 })]);
  const curr = snap('2026-10-05', [deal({ id: 'a', amount: 10000 }), deal({ id: 'b', name: 'Sundial', amount: 39000 })]);
  const out = renderBrief(compare(prev, curr, '2026-10-05'));
  assert.match(out, /^Compared with the snapshot from Sep 21, 2 weeks ago\.$/m);
  assert.match(out, /Open pipeline \$49K across 2 deals, up \$39K since Sep 21\./);
  assert.match(out, /\*\*New since Sep 21\*\* \(1\)/);
  assert.doesNotMatch(out, /last week|New this week/);
});

test('an odd gap is counted in days, and flat reads "flat since"', () => {
  const s = (date) => snap(date, [deal({ id: 'a' })]);
  const ten = renderBrief(compare(s('2026-09-25'), s('2026-10-05'), '2026-10-05'));
  assert.match(ten, /Compared with the snapshot from Sep 25, 10 days ago\./);
  assert.match(ten, /flat since Sep 25\./);
  const one = renderBrief(compare(s('2026-10-04'), s('2026-10-05'), '2026-10-05'));
  assert.match(one, /Compared with the snapshot from Oct 4, 1 day ago\./);
});

test('a gap of 6 to 8 days keeps "last week" and "New this week"', () => {
  for (const date of ['2026-09-27', '2026-09-28', '2026-09-29']) {
    const out = renderBrief(compare(snap(date, []), snap('2026-10-05', [deal({ id: 'a' })]), '2026-10-05'));
    assert.match(out, /up \$10K on last week\./);
    assert.match(out, /\*\*New this week\*\* \(1\)/);
    assert.doesNotMatch(out, /ago\./);
  }
});

test('a skipped unreadable snapshot is named in the brief itself', () => {
  const skipped = [{ file: 'snapshot-2026-09-28.json', reason: 'not valid JSON' }];
  const out = renderBrief(compare(snap('2026-09-21', []), snap('2026-10-05', [deal({ id: 'a' })]), '2026-10-05'), { skipped });
  assert.match(out, /^# Monday pipeline brief, Oct 5\n\nSkipped unreadable snapshot-2026-09-28\.json \(not valid JSON\)\.\n\nCompared with the snapshot from Sep 21, 2 weeks ago\.\n/);
});

test('with every earlier snapshot unreadable, the brief does not claim to be the first snapshot', () => {
  const skipped = [{ file: 'snapshot-2026-09-28.json', reason: 'not valid JSON' }];
  const out = renderBrief(compare(null, snap('2026-10-05', [deal({ id: 'a' })]), '2026-10-05'), { skipped });
  assert.match(out, /Skipped unreadable snapshot-2026-09-28\.json \(not valid JSON\)\.\n\nNo earlier snapshot could be read\. A comparison needs two weekly runs/);
  assert.doesNotMatch(out, /This is the first snapshot/);
});

test('when the gap is not a week, neither the heading nor "nothing flagged" claims one', () => {
  const s = (date) => snap(date, [deal({ id: 'a' })]);
  const out = renderBrief(compare(s('2026-09-21'), s('2026-10-05'), '2026-10-05'));
  assert.match(out, /^# Monday pipeline brief, Oct 5\n/);
  assert.match(out, /Nothing flagged since Sep 21\./);
  assert.doesNotMatch(out, /week of|this week/);
  const weekly = renderBrief(compare(s('2026-09-28'), s('2026-10-05'), '2026-10-05'));
  assert.match(weekly, /^# Monday pipeline brief, week of Oct 5\n/);
  assert.match(weekly, /Nothing flagged this week\./);
});
