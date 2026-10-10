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
    deal({ id: 'b', name: 'Pinecrest', amount: 24000, stage_id: 'demo', stage: 'Demo', stage_order: 2, close_date: '2026-10-01' }),
    deal({ id: 'c', name: 'Fernway', amount: 40000, stage_id: 'proposal', stage: 'Proposal', stage_order: 3 }),
    deal({ id: 'd', name: 'Cobalt Labs', owner: 'Priya', amount: 24000 }),
    deal({ id: 'e', name: 'Meridian', amount: 90000 }),
  ]);
  const curr = snap('2026-10-05', [
    deal({ id: 'a', name: 'Quarry', owner: 'Leo', amount: 120000, close_date: '2027-01-15' }),
    deal({ id: 'b', name: 'Pinecrest', amount: 24000, stage_id: 'discovery', stage: 'Discovery', stage_order: 0, close_date: '2026-10-10', last_activity: '2026-09-18' }),
    deal({ id: 'c', name: 'Fernway', amount: 40000, stage_id: 'negotiation', stage: 'Negotiation', stage_order: 4, next_step: '' }),
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
    '**How the open pipeline changed**',
    '- Sep 28 open pipeline: $298,000',
    '- New deals: +$90,000 (1)',
    '- Won: -$24,000 (1)',
    '- Lost: -$90,000 (1)',
    '- Oct 5 open pipeline: $274,000',
    '',
    '**Look at these first** (2)',
    '- Quarry, $120K, Leo: close date slipped (slipped into Q1 2027; large deal)',
    '- Pinecrest, $24K, Dana: close date slipped, moved back a stage, no activity in 14+ days (3 warning signs)',
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

test('the bridge walks last open total to this one, then names amount changes, removals and reopens', () => {
  const prev = snap('2026-09-28', [
    deal({ id: 'a', name: 'Sable', amount: 60000 }),
    deal({ id: 'b', name: 'Kestrel', owner: 'Priya', amount: 48000, stage: 'Discovery' }),
    deal({ id: 'c', name: 'Orchard', owner: 'Leo', amount: 32000, status: 'lost', stage: 'Closed lost' }),
    deal({ id: 'd', name: 'Lumen', amount: 90000 }),
    deal({ id: 'e', name: 'Oakmont', owner: 'Priya', amount: 40000 }),
  ]);
  const curr = snap('2026-10-05', [
    deal({ id: 'a', name: 'Sable', amount: 90000 }),
    deal({ id: 'c', name: 'Orchard', owner: 'Leo', amount: 32000, stage: 'Demo' }),
    deal({ id: 'd', name: 'Lumen', amount: 95000, status: 'won', stage: 'Closed won' }),
    deal({ id: 'e', name: 'Oakmont', owner: 'Priya', amount: 32000.5 }),
    deal({ id: 'f', name: 'Sundial', amount: 120000 }),
  ]);
  const out = renderBrief(compare(prev, curr, '2026-10-05'));
  assert.ok(out.includes([
    '**How the open pipeline changed**',
    '- Sep 28 open pipeline: $238,000',
    '- New deals: +$120,000 (1)',
    '- Reopened: +$32,000 (1)',
    '- Amount increases: +$35,000 (2)',
    '- Amount decreases: -$7,999.50 (1)',
    '- Won: -$95,000 (1)',
    '- Removed from HubSpot: -$48,000 (1)',
    '- Oct 5 open pipeline: $274,000.50',
    '',
  ].join('\n')), out);
  assert.ok(out.includes('**Amount changed** (3)\n- Lumen, $95K, Dana: $90,000 → $95,000, then won\n- Sable, $90K, Dana: $60,000 → $90,000\n- Oakmont, $32K, Priya: $40,000 → $32,000.50\n'), out);
  assert.ok(out.includes('**Reopened** (1)\n- Orchard, $32K, Leo: was lost, now in Demo\n'), out);
  assert.ok(out.includes('**Removed from HubSpot** (1)\n- Kestrel, $48K, Priya: was open in Discovery, not returned by HubSpot now (deleted, archived or merged)\n'), out);
});

test('an unchanged pipeline prints no bridge', () => {
  const s = (date) => snap(date, [deal({ id: 'a' })]);
  assert.doesNotMatch(renderBrief(compare(s('2026-09-28'), s('2026-10-05'), '2026-10-05')), /How the open pipeline changed/);
});

test('close date passed has its own section, on a first run and a weekly one', () => {
  const s = (date) => snap(date, [deal({ id: 'a', name: 'Orchard AI', owner: 'Leo', amount: 32000, close_date: '2026-09-30' })]);
  for (const prev of [null, s('2026-09-28')]) {
    const out = renderBrief(compare(prev, s('2026-10-05'), '2026-10-05'));
    assert.ok(out.includes('**Close date passed** (1)\n- Orchard AI, $32K, Leo: close date was Sep 30, 5 days ago\n'), out);
  }
});

test('each look-first line says why the deal is there', () => {
  const prev = snap('2026-09-28', [
    deal({ id: 'q', name: 'Quarry', owner: 'Leo', amount: 120000, close_date: '2026-10-19' }),
    deal({ id: 'h', name: 'Halcyon', owner: 'Leo', amount: 24000, close_date: '2026-10-03' }),
    deal({ id: 's', name: 'Small', amount: 1000 }),
  ]);
  const curr = snap('2026-10-05', [
    deal({ id: 'q', name: 'Quarry', owner: 'Leo', amount: 120000, close_date: '2027-01-15' }),
    deal({ id: 'h', name: 'Halcyon', owner: 'Leo', amount: 24000, close_date: '2026-12-19', last_activity: '2026-09-14' }),
    deal({ id: 's', name: 'Small', amount: 1000 }),
  ]);
  const out = renderBrief(compare(prev, curr, '2026-10-05'));
  assert.ok(out.includes([
    '**Look at these first** (2)',
    '- Quarry, $120K, Leo: close date slipped (slipped into Q1 2027; large deal)',
    '- Halcyon, $24K, Leo: close date slipped, no activity in 14+ days (2 warning signs)',
    '',
  ].join('\n')), out);
});

test('every deal line links to the deal in HubSpot when the snapshot has its url', () => {
  const url = 'https://app.hubspot.com/contacts/1234567/record/0-3/1';
  const prev = snap('2026-09-28', [deal({ id: '1', name: 'Quarry', amount: 120000, close_date: '2026-10-19' }), deal({ id: '2', name: 'Gone', amount: 5000 })]);
  const curr = snap('2026-10-05', [deal({ id: '1', name: 'Quarry', amount: 120000, close_date: '2027-01-15', url }), deal({ id: '3', name: 'Plain', amount: 1000 })]);
  const out = renderBrief(compare(prev, curr, '2026-10-05'));
  assert.ok(out.includes(`- [Quarry](${url}), $120K, Dana: Oct 19 → Jan 15 (+88 days)\n`), out);
  assert.ok(out.includes('- Plain, $1K, Dana\n'), out);
  assert.ok(out.includes('- Gone, $5K, Dana: was open'), out);
});

test('a deal name with square brackets or a url with a parenthesis cannot break the link', () => {
  const curr = snap('2026-10-05', [deal({ id: '1', name: 'Acme [EU]', next_step: '', url: 'https://app.hubspot.com/x(1)' })]);
  const out = renderBrief(compare(null, curr, '2026-10-05'));
  assert.ok(out.includes('- [Acme \\[EU\\]](https://app.hubspot.com/x%281%29), $10K, Dana: no next step\n'), out);
});

test('toSlack turns Markdown deal links into Slack links, escaping the name', () => {
  assert.equal(
    toSlack('- [Acme \\[EU\\] & <Co>](https://app.hubspot.com/x%281%29), $10K, Dana: no next step'),
    '• <https://app.hubspot.com/x%281%29|Acme [EU] &amp; &lt;Co&gt;>, $10K, Dana: no next step',
  );
});

test('grouped by owner: headline and bridge stay on top, then one heading per owner, largest open total first', () => {
  const prev = snap('2026-09-28', [
    deal({ id: 'a', name: 'Quarry', owner: 'Leo', amount: 50000, close_date: '2026-11-01' }),
    deal({ id: 'b', name: 'Sable', owner: 'Dana', amount: 90000 }),
    deal({ id: 'c', name: 'Kestrel', owner: 'Priya', amount: 10000 }),
  ]);
  const curr = snap('2026-10-05', [
    deal({ id: 'a', name: 'Quarry', owner: 'Leo', amount: 50000, close_date: '2026-11-20' }),
    deal({ id: 'b', name: 'Sable', owner: 'Dana', amount: 90000 }),
    deal({ id: 'd', name: 'Sundial', owner: 'Dana', amount: 20000 }),
  ]);
  const out = renderBrief(compare(prev, curr, '2026-10-05', { largeDeal: false }), { groupBy: 'owner' });
  assert.equal(out, [
    '# Monday pipeline brief, week of Oct 5',
    '',
    'Compared with the snapshot from Sep 28.',
    '',
    'Open pipeline $160K across 3 deals, up $10K on last week.',
    'Closed 0 won and 0 lost.',
    '',
    '**How the open pipeline changed**',
    '- Sep 28 open pipeline: $150,000',
    '- New deals: +$20,000 (1)',
    '- Removed from HubSpot: -$10,000 (1)',
    '- Oct 5 open pipeline: $160,000',
    '',
    '## Dana, open $110K across 2 deals',
    '',
    '**New this week** (1)',
    '- Sundial, $20K, Dana',
    '',
    '## Leo, open $50K across 1 deal',
    '',
    '**Slipped close dates** (1)',
    '- Quarry, $50K, Leo: Nov 1 → Nov 20 (+19 days)',
    '',
    '## Priya, open $0 across 0 deals',
    '',
    '**Removed from HubSpot** (1)',
    '- Kestrel, $10K, Priya: was open in Qualified, not returned by HubSpot now (deleted, archived or merged)',
    '',
  ].join('\n'));
});

test('a group with nothing in any section says so', () => {
  const s = (date) => snap(date, [deal({ id: 'a', owner: 'Dana' }), deal({ id: 'b', owner: 'Leo', next_step: '' })]);
  const out = renderBrief(compare(s('2026-09-28'), s('2026-10-05'), '2026-10-05', { largeDeal: false }), { groupBy: 'owner' });
  assert.ok(out.includes('## Dana, open $10K across 1 deal\n\nNothing flagged.\n'), out);
  assert.ok(out.includes('## Leo, open $10K across 1 deal\n\n**No next step, or no activity in 14+ days** (1)\n'), out);
  assert.doesNotMatch(out, /Nothing flagged this week/);
});

test('grouped by pipeline uses the pipeline label, and each group keeps the cap of 10', () => {
  const deals = Array.from({ length: 12 }, (_, i) => deal({ id: `r${i}`, name: `R${i}`, pipeline_id: 'ren', pipeline: 'Renewals', amount: (i + 1) * 1000 }));
  const out = renderBrief(compare(snap('2026-09-28', []), snap('2026-10-05', [...deals, deal({ id: 's', name: 'S' })]), '2026-10-05'), { groupBy: 'pipeline' });
  assert.ok(out.includes('## Renewals, open $78K across 12 deals\n\n**New this week** (12)\n'), out);
  assert.ok(out.includes('- and 2 more ($3K)\n'), out);
  assert.ok(out.includes('## Sales Pipeline, open $10K across 1 deal\n\n**New this week** (1)\n- S, $10K, Dana\n'), out);
});

test('a first run can be grouped too', () => {
  const out = renderBrief(compare(null, snap('2026-10-05', [deal({ id: 'a', name: 'A', owner: 'Leo', next_step: '' })]), '2026-10-05'), { groupBy: 'owner' });
  assert.ok(out.endsWith('Open pipeline $10K across 1 deal.\n\n## Leo, open $10K across 1 deal\n\n**No next step, or no activity in 14+ days** (1)\n- A, $10K, Leo: no next step\n'), out);
});

test('toSlack turns group headings into bold lines', () => {
  assert.equal(toSlack('## Dana, open $10K across 1 deal'), '*Dana, open $10K across 1 deal*');
});

test('a pipeline transfer has its own section, flat and in Slack', () => {
  const prev = snap('2026-09-28', [deal({ id: 't', name: 'Tessellate', owner: 'Marcus', amount: 40000, stage: 'Discovery' })]);
  const curr = snap('2026-10-05', [deal({ id: 't', name: 'Tessellate', owner: 'Marcus', amount: 40000, pipeline_id: 'ren', pipeline: 'Renewals', stage_id: 'up', stage: 'Upcoming' })]);
  const out = renderBrief(compare(prev, curr, '2026-10-05'));
  assert.ok(out.includes('**Moved to another pipeline** (1)\n- Tessellate, $40K, Marcus: Sales Pipeline (Discovery) → Renewals (Upcoming)\n'), out);
  assert.ok(toSlack(out).includes('*Moved to another pipeline* (1)\n• Tessellate, $40K, Marcus: Sales Pipeline (Discovery) → Renewals (Upcoming)\n'));
});

test('grouped by pipeline, a transfer shows under the old pipeline and the new one, so neither heading vanishes', () => {
  const prev = snap('2026-09-28', [deal({ id: 't', name: 'Tessellate', amount: 40000, stage: 'Discovery' })]);
  const curr = snap('2026-10-05', [deal({ id: 't', name: 'Tessellate', amount: 40000, pipeline_id: 'ren', pipeline: 'Renewals', stage_id: 'up', stage: 'Upcoming' })]);
  const out = renderBrief(compare(prev, curr, '2026-10-05', { largeDeal: false }), { groupBy: 'pipeline' });
  const line = '- Tessellate, $40K, Dana: Sales Pipeline (Discovery) → Renewals (Upcoming)\n';
  assert.ok(out.includes(`## Renewals, open $40K across 1 deal\n\n**Moved to another pipeline** (1)\n${line}`), out);
  assert.ok(out.includes(`## Sales Pipeline, open $0 across 0 deals\n\n**Moved to another pipeline** (1)\n${line}`), out);
});

test('a deal name with no url is escaped like a linked one, so it cannot fake a link', () => {
  const curr = snap('2026-10-05', [deal({ id: '1', name: '[Click](https://evil.example)', next_step: '' })]);
  const out = renderBrief(compare(null, curr, '2026-10-05'));
  assert.ok(out.includes('- \\[Click\\](https://evil.example), $10K, Dana: no next step\n'), out);
  assert.ok(!toSlack(out).includes('<https://evil.example'), toSlack(out));
  assert.ok(toSlack(out).includes('• [Click](https://evil.example), $10K, Dana: no next step'), toSlack(out));
});

test('a deal name with no url cannot ping a Slack channel', () => {
  const curr = snap('2026-10-05', [deal({ id: '1', name: 'Acme <!here> & co', next_step: '' })]);
  const slack = toSlack(renderBrief(compare(null, curr, '2026-10-05')));
  assert.ok(slack.includes('• Acme &lt;!here&gt; &amp; co, $10K, Dana: no next step'), slack);
  assert.doesNotMatch(slack, /<!here>/);
});

test('a newline in a deal or owner name never breaks a line of the brief', () => {
  const curr = snap('2026-10-05', [
    deal({ id: '1', name: 'Two\nLines', owner: 'Da\r\nna', next_step: '' }),
    deal({ id: '2', name: 'Linked\nName', next_step: '', url: 'https://app.hubspot.com/x' }),
  ]);
  const out = renderBrief(compare(null, curr, '2026-10-05'));
  assert.ok(out.includes('- Two Lines, $10K, Da na: no next step\n'), out);
  assert.ok(out.includes('- [Linked Name](https://app.hubspot.com/x), $10K, Dana: no next step\n'), out);
});

// Links in rendered output: Markdown [text](url) not preceded by a backslash, and Slack <url|text>.
const markdownLinks = (text) => [...text.matchAll(/(?<!\\)\[(?:\\.|[^\]\\])*\]\((https?:[^)\s]*)\)/g)].map((m) => m[1]);
const slackLinks = (text) => [...text.matchAll(/<(https?:[^|>]*)(\|[^>]*)?>/g)].map((m) => m[1]);

test('an owner name shaped like a link stays text, grouped by owner, in Markdown and Slack', () => {
  const evilOwner = '[Owner](https://evil.com/owner)';
  const url = 'https://app.hubspot.com/contacts/1/record/0-3/1';
  const curr = snap('2026-10-05', [deal({ id: '1', owner: evilOwner, name: '<!here> [Click](https://evil.com) \\] tail\\', next_step: '', url })]);
  const out = renderBrief(compare(null, curr, '2026-10-05'), { groupBy: 'owner' });
  assert.deepEqual(markdownLinks(out), [url], out);
  assert.deepEqual(slackLinks(toSlack(out)), [url], toSlack(out));
  assert.ok(toSlack(out).includes(`<${url}|&lt;!here&gt; [Click](https://evil.com) \\] tail\\>, $10K, [Owner](https://evil.com/owner): no next step`), toSlack(out));
});

test('hostile text in every CRM field (deal name, owner, stage, pipeline) never becomes a link', () => {
  const evil = (tag) => `[${tag}](https://evil.com/${tag}) <!here> \\[x\\](https://evil.com/esc) <a href="https://evil.com/${tag}/a">Click</a> <https://evil.com/${tag}/auto> &amp; \\`;
  const url = (id) => `https://app.hubspot.com/contacts/1/record/0-3/${id}`;
  const hostile = (over) => deal({ owner: evil('owner'), pipeline: evil('pipeline'), stage: evil('stage'), ...over });
  const prev = snap('2026-09-28', [
    hostile({ id: 'back', stage_id: 'late', stage_order: 3 }),
    hostile({ id: 'move', pipeline_id: 'p1' }),
    hostile({ id: 'gone', name: evil('gone') }),
    hostile({ id: 'reopen', status: 'lost' }),
  ]);
  const curr = snap('2026-10-05', [
    hostile({ id: 'back', name: evil('name'), stage_id: 'early', stage_order: 0, url: url('back') }),
    hostile({ id: 'move', pipeline_id: 'p2', pipeline: evil('newpipe'), stage: evil('newstage'), url: url('move') }),
    hostile({ id: 'reopen', url: url('reopen') }),
    hostile({ id: 'fresh', name: evil('fresh'), next_step: '' }),
  ]);
  const result = compare(prev, curr, '2026-10-05');
  const expected = [url('back'), url('move'), url('reopen')];
  for (const groupBy of [null, 'owner', 'pipeline']) {
    const out = renderBrief(result, { groupBy });
    assert.deepEqual([...new Set(markdownLinks(out))].sort(), expected, `markdown, ${groupBy}\n${out}`);
    assert.deepEqual([...new Set(slackLinks(toSlack(out)))].sort(), expected, `slack, ${groupBy}\n${toSlack(out)}`);
    assert.doesNotMatch(toSlack(out), /<!here>/);
    // No raw HTML or autolink from CRM text reaches the Markdown: the brief itself writes no <.
    assert.doesNotMatch(out, /<a/, `markdown <a, ${groupBy}`);
    assert.doesNotMatch(out, /</, `markdown raw <, ${groupBy}`);
    assert.match(out, /&lt;a href="https:\/\/evil\.com\/name\/a">Click&lt;\/a> &lt;https:\/\/evil\.com\/name\/auto> &amp;amp;/);
    // Slack escapes each character once: no &amp;lt; from a double escape.
    assert.match(toSlack(out), /&lt;a href="https:\/\/evil\.com\/name\/a"&gt;Click&lt;\/a&gt; &lt;https:\/\/evil\.com\/name\/auto&gt; &amp;amp;/);
    assert.doesNotMatch(toSlack(out), /&amp;lt;|&amp;gt;/);
    assert.match(out, /Moved back a stage/);
    assert.match(out, /Moved to another pipeline/);
    assert.match(out, /Reopened/);
    assert.match(out, /Removed from HubSpot/);
  }
});

test('a stage change with no judgeable direction gets its own section, old stage to new', () => {
  const lay = (...s) => [{ id: 'default', label: 'Sales Pipeline', stages: s.map((id, order) => ({ id, label: id, order, status: 'open' })) }];
  const prev = { ...snap('2026-09-28', [deal({ id: 'x', name: 'Xylo', stage_id: 'S', stage: 'S', stage_order: 0 })]), pipelines: lay('S', 'A', 'B') };
  const curr = { ...snap('2026-10-05', [deal({ id: 'x', name: 'Xylo', stage_id: 'B', stage: 'B', stage_order: 0 })]), pipelines: lay('B', 'A') };
  const out = renderBrief(compare(prev, curr, '2026-10-05', { largeDeal: false }));
  assert.ok(out.includes('**Changed stage** (1)\n- Xylo, $10K, Dana: S → B\n'), out);
  assert.doesNotMatch(out, /Nothing flagged/);
});

test('a transfer straight into a closed stage of another pipeline names the move on its Closed line', () => {
  const prev = snap('2026-09-28', [deal({ id: 'j', name: 'Jumper', amount: 30000 })]);
  const curr = snap('2026-10-05', [deal({ id: 'j', name: 'Jumper', amount: 30000, pipeline_id: 'onb', pipeline: 'Onboarding', status: 'won' })]);
  const result = compare(prev, curr, '2026-10-05', { largeDeal: false });
  const line = '- Jumper, $30K, Dana: won, moved from Sales Pipeline to Onboarding\n';
  assert.ok(renderBrief(result).includes(`**Closed** (1)\n${line}`), renderBrief(result));
  assert.ok(renderBrief(result).includes('- Won: -$30,000 (1)\n'), 'bridge unchanged');
  const grouped = renderBrief(result, { groupBy: 'pipeline' });
  assert.ok(grouped.includes(`## Sales Pipeline, open $0 across 0 deals\n\n**Closed** (1)\n${line}`), grouped);
  assert.ok(grouped.includes(`## Onboarding, open $0 across 0 deals\n\n**Closed** (1)\n${line}`), grouped);
});

const headings = (out) => out.split('\n').filter((l) => l.startsWith('## '));

test('grouped by pipeline, a renamed pipeline is one group under its new name', () => {
  const prev = snap('2026-09-28', [
    deal({ id: 'g', name: 'Gone Co', pipeline_id: 'p1', pipeline: 'Sales' }),
    deal({ id: 's', name: 'Stays', pipeline_id: 'p1', pipeline: 'Sales' }),
  ]);
  const curr = snap('2026-10-05', [deal({ id: 's', name: 'Stays', pipeline_id: 'p1', pipeline: 'New Business', next_step: '' })]);
  const out = renderBrief(compare(prev, curr, '2026-10-05', { largeDeal: false }), { groupBy: 'pipeline' });
  assert.deepEqual(headings(out), ['## New Business, open $10K across 1 deal'], out);
  assert.match(out, /Gone Co, \$10K, Dana: was open in Qualified/);
});

test('grouped by pipeline, a renamed pipeline takes its label from the stored layout even with no deal in it now', () => {
  const prev = snap('2026-09-28', [deal({ id: 'g', name: 'Gone Co', pipeline_id: 'p1', pipeline: 'Sales' })]);
  const curr = { ...snap('2026-10-05', []), pipelines: [{ id: 'p1', label: 'New Business', stages: [] }] };
  const out = renderBrief(compare(prev, curr, '2026-10-05', { largeDeal: false }), { groupBy: 'pipeline' });
  assert.deepEqual(headings(out), ['## New Business, open $0 across 0 deals'], out);
});

test('grouped by pipeline, a pipeline that has disappeared keeps its last label', () => {
  const prev = snap('2026-09-28', [deal({ id: 'g', name: 'Gone Co', pipeline_id: 'old', pipeline: 'Legacy' })]);
  const curr = snap('2026-10-05', [deal({ id: 's', name: 'Stays', next_step: '' })]);
  const out = renderBrief(compare(prev, curr, '2026-10-05', { largeDeal: false }), { groupBy: 'pipeline' });
  assert.deepEqual(headings(out), ['## Sales Pipeline, open $10K across 1 deal', '## Legacy, open $0 across 0 deals'], out);
});

test('grouped by pipeline, two pipelines with the same label stay apart, each heading followed by its id', () => {
  const curr = snap('2026-10-05', [
    deal({ id: 'a', name: 'Alpha', pipeline_id: 'east', pipeline: 'Sales', amount: 20000, next_step: '' }),
    deal({ id: 'b', name: 'Beta', pipeline_id: 'west', pipeline: 'Sales', next_step: '' }),
  ]);
  const out = renderBrief(compare(null, curr, '2026-10-05', { largeDeal: false }), { groupBy: 'pipeline' });
  assert.deepEqual(headings(out), ['## Sales (east), open $20K across 1 deal', '## Sales (west), open $10K across 1 deal'], out);
  assert.ok(out.includes('## Sales (west), open $10K across 1 deal\n\n**No next step, or no activity in 14+ days** (1)\n- Beta,'), out);
});

test('grouped by pipeline, a transfer between two same-label pipelines lists under both', () => {
  const prev = snap('2026-09-28', [deal({ id: 't', name: 'Tess', pipeline_id: 'east', pipeline: 'Sales' })]);
  const curr = snap('2026-10-05', [deal({ id: 't', name: 'Tess', pipeline_id: 'west', pipeline: 'Sales' })]);
  const out = renderBrief(compare(prev, curr, '2026-10-05', { largeDeal: false }), { groupBy: 'pipeline' });
  assert.deepEqual(headings(out), ['## Sales (west), open $10K across 1 deal', '## Sales (east), open $0 across 0 deals'], out);
  assert.equal(out.match(/\*\*Moved to another pipeline\*\*/g).length, 2, out);
});

test('ordinary & and < in names print exactly as typed, in Markdown and (escaped once) in Slack', () => {
  const names = ['Johnson & Johnson', 'R&D', 'A < B', 'Q&A <3'];
  const curr = snap('2026-10-05', [
    ...names.map((name, i) => deal({ id: String(i), name, amount: 10000 * (i + 2), next_step: '' })),
    deal({ id: 'o', name: 'Owned', owner: "Pat O'Neil & Co", amount: 1000, next_step: '' }),
  ]);
  const out = renderBrief(compare(null, curr, '2026-10-05', { largeDeal: false }));
  for (const name of names) assert.ok(out.includes(`- ${name}, `), `${name}\n${out}`);
  assert.ok(out.includes("Pat O'Neil & Co: no next step"), out);
  assert.doesNotMatch(out, /&amp;|&lt;|&gt;/);
  const slack = toSlack(out);
  for (const name of names) {
    const once = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    assert.ok(slack.includes(`• ${once}, `), `${once}\n${slack}`);
  }
  assert.ok(slack.includes("Pat O'Neil &amp; Co: no next step"), slack);
  assert.doesNotMatch(slack, /&amp;amp;|&amp;lt;|&amp;gt;/);
});

test('a transfer or close between two same-label pipelines names each pipeline with its id, in every mode', () => {
  const prev = snap('2026-09-28', [
    deal({ id: 't', name: 'Tess', pipeline_id: 'east', pipeline: 'Sales' }),
    deal({ id: 'c', name: 'Cora', pipeline_id: 'east', pipeline: 'Sales' }),
  ]);
  const curr = snap('2026-10-05', [
    deal({ id: 't', name: 'Tess', pipeline_id: 'west', pipeline: 'Sales' }),
    deal({ id: 'c', name: 'Cora', pipeline_id: 'west', pipeline: 'Sales', status: 'won' }),
  ]);
  const result = compare(prev, curr, '2026-10-05', { largeDeal: false });
  for (const groupBy of [null, 'owner', 'pipeline']) {
    const out = renderBrief(result, { groupBy });
    assert.ok(out.includes('- Tess, $10K, Dana: Sales (east) (Qualified) → Sales (west) (Qualified)\n'), `${groupBy}\n${out}`);
    assert.ok(out.includes('- Cora, $10K, Dana: won, moved from Sales (east) to Sales (west)\n'), `${groupBy}\n${out}`);
  }
});

test('a pipeline label shared with another pipeline carries its id on a transfer line, even when the two ends differ', () => {
  const prev = snap('2026-09-28', [
    deal({ id: 't', name: 'Tess', pipeline_id: 'east', pipeline: 'Sales' }),
    deal({ id: 'o', name: 'Other', pipeline_id: 'west', pipeline: 'Sales' }),
  ]);
  const curr = snap('2026-10-05', [
    deal({ id: 't', name: 'Tess', pipeline_id: 'ren', pipeline: 'Renewals' }),
    deal({ id: 'o', name: 'Other', pipeline_id: 'west', pipeline: 'Sales' }),
  ]);
  const out = renderBrief(compare(prev, curr, '2026-10-05', { largeDeal: false }));
  assert.ok(out.includes('- Tess, $10K, Dana: Sales (east) (Qualified) → Renewals (Qualified)\n'), out);
});

// F1 repro: deal 9 won at $250K last week, lost this week.
test('a deal won last week and lost this week is listed under Changed after closing, flat, grouped and in Slack', () => {
  const prev = snap('2026-09-28', [deal({ id: '9', name: 'Ironbridge', amount: 250000, status: 'won' }), deal({ id: 'o', amount: 1000 })]);
  const curr = snap('2026-10-05', [deal({ id: '9', name: 'Ironbridge', amount: 250000, status: 'lost' }), deal({ id: 'o', amount: 1000 }),
    deal({ id: '10', name: 'Keystone', owner: 'Leo', amount: 60000, status: 'won' })]);
  prev.deals.push(deal({ id: '10', name: 'Keystone', owner: 'Leo', amount: 50000, status: 'won' }));
  const r = compare(prev, curr, '2026-10-05');
  const out = renderBrief(r);
  assert.match(out, /Closed 0 won and 0 lost\. 2 deals changed after closing\.\n/);
  assert.ok(out.includes('**Changed after closing** (2)\n- Ironbridge, $250K, Dana: was won, now lost\n- Keystone, $60K, Leo: won amount $50,000 → $60,000\n'), out);
  assert.doesNotMatch(out, /Nothing flagged/);
  assert.doesNotMatch(out, /\*\*Closed\*\*/);
  const grouped = renderBrief(r, { groupBy: 'owner' });
  assert.match(grouped, /## Leo[^\n]*\n\n\*\*Changed after closing\*\* \(1\)\n- Keystone, \$60K, Leo: won amount \$50,000 → \$60,000\n/);
  assert.match(toSlack(out), /\*Changed after closing\* \(2\)\n• Ironbridge, \$250K, Dana: was won, now lost\n/);
  const both = compare(snap('2026-09-28', [deal({ id: '9', name: 'Ironbridge', amount: 250000, status: 'won' })]),
    snap('2026-10-05', [deal({ id: '9', name: 'Ironbridge', amount: 200000, status: 'lost' })]), '2026-10-05');
  assert.match(renderBrief(both), /- Ironbridge, \$200K, Dana: was won, now lost, \$250,000 → \$200,000\n/);
  assert.match(renderBrief(both), /Closed 0 won and 0 lost\. 1 deal changed after closing\.\n/);
});

// F4: --group-by owner keys on the owner id, so two reps who share a name stay two groups.
test('grouping by owner keys on owner_id; a row from an older snapshot joins the id that carries its name today', () => {
  const prev = snap('2026-09-28', [
    deal({ id: 'gone', name: 'Old Deal', owner: 'Leo', amount: 5000 }), // an older snapshot: no owner_id
  ]);
  const curr = snap('2026-10-05', [
    deal({ id: 'a', name: 'Alpha', owner: 'Dana', owner_id: '1', amount: 30000, next_step: '' }),
    deal({ id: 'b', name: 'Beta', owner: 'Dana', owner_id: '2', amount: 20000, next_step: '' }),
    deal({ id: 'c', name: 'Gamma', owner: 'Leo', owner_id: '3', amount: 10000, next_step: '' }),
  ]);
  const out = renderBrief(compare(prev, curr, '2026-10-05'), { groupBy: 'owner' });
  assert.deepEqual([...out.matchAll(/^## (.+), open/gm)].map((m) => m[1]), ['Dana (owner 1)', 'Dana (owner 2)', 'Leo']);
  const leo = out.slice(out.indexOf('## Leo'));
  assert.match(leo, /Old Deal/);
  assert.match(leo, /Gamma/);
});

// F7: the home-currency amount moved, the deal's own amount and currency did not: an exchange rate.
test('an amount change from the exchange rate alone is labelled, open or closed; older snapshots get no label', () => {
  const fx = (id, home, own, status = 'open') => deal({ id, name: `Deal ${id}`, amount: home, deal_currency: 'EUR', deal_currency_amount: own, status });
  const prev = snap('2026-09-28', [fx('a', 26400, 24000), fx('b', 26400, 24000), fx('c', 11000, 10000, 'won'), deal({ id: 'd', name: 'Deal d', amount: 5000 })]);
  const curr = snap('2026-10-05', [fx('a', 26880, 24000), fx('b', 27500, 25000), fx('c', 11200, 10000, 'won'), deal({ id: 'd', name: 'Deal d', amount: 5200 })]);
  const out = renderBrief(compare(prev, curr, '2026-10-05'));
  assert.match(out, /- Deal a, \$27K, Dana: \$26,400 → \$26,880 \(exchange rate\)\n/);
  assert.match(out, /- Deal b, \$28K, Dana: \$26,400 → \$27,500\n/);
  assert.match(out, /- Deal d, \$5K, Dana: \$5,000 → \$5,200\n/);
  // A closed deal moved only by the exchange rate is not a change after closing: not listed, not counted.
  assert.doesNotMatch(out, /Deal c/);
  assert.doesNotMatch(out, /changed after closing/);
});

// an old foreign-currency closed deal would otherwise be listed every week.
test('a closed deal whose home amount moved only with the exchange rate is never listed or counted; a flip still is', () => {
  const won = (id, home, status = 'won') => deal({ id, name: `Deal ${id}`, amount: home, deal_currency: 'EUR', deal_currency_amount: 1000, status });
  const prev = snap('2026-09-28', [won('w', 1100), won('f', 1100)]);
  const curr = snap('2026-10-05', [won('w', 1150), won('f', 1150, 'lost')]);
  const r = compare(prev, curr, '2026-10-05');
  assert.deepEqual(r.changedAfterClose.map((c) => c.deal.id), ['f']);
  const out = renderBrief(r);
  assert.match(out, /Closed 0 won and 0 lost\. 1 deal changed after closing\.\n/);
  assert.match(out, /- Deal f, \$1K, Dana: was won, now lost, \$1,100 → \$1,150 \(exchange rate\)\n/);
  assert.doesNotMatch(out, /Deal w/);
});

// the first comparison after upgrading has no currency fields last week. A
// foreign-currency deal (its own amount differs from its home amount) cannot be told apart from
// an exchange-rate move, so its amount change says so; a home-currency deal's change is a real edit.
test('in the first week after upgrading, a foreign-currency amount change says the currency last week is unknown', () => {
  const old = (id, home, status) => deal({ id, name: `Deal ${id}`, amount: home, status });
  const now = (id, home, own, cur, status) => deal({ id, name: `Deal ${id}`, amount: home, deal_currency: cur, deal_currency_amount: own, status });
  const prev = snap('2026-09-28', [old('a', 1100, 'won'), old('b', 2000, 'won'), old('c', 5000, 'open')]);
  const curr = snap('2026-10-05', [now('a', 1150, 1000, 'EUR', 'won'), now('b', 2500, 2500, 'USD', 'won'), now('c', 5500, 5000, 'EUR', 'open')]);
  const out = renderBrief(compare(prev, curr, '2026-10-05'));
  assert.match(out, /- Deal a, \$1K, Dana: won amount \$1,100 → \$1,150 \(currency unknown last week\)\n/);
  assert.match(out, /- Deal b, \$3K, Dana: won amount \$2,000 → \$2,500\n/);
  assert.match(out, /- Deal c, \$6K, Dana: \$5,000 → \$5,500 \(currency unknown last week\)\n/);
});


// The headline change is the bridge's end minus its start, in cents, so a float sum can never
// print "down $0" when the bridge says nothing moved.
test('the headline change comes from the bridge cents, not a float sum', () => {
  const prev = snap('2026-09-28', [deal({ id: 'a', amount: 0.1 }), deal({ id: 'b', amount: 0.2 })]);
  const curr = snap('2026-10-05', [deal({ id: 'a', amount: 0.3 }), deal({ id: 'b', amount: 0 })]);
  const out = renderBrief(compare(prev, curr, '2026-10-05'));
  assert.match(out, /Open pipeline \$0 across 2 deals, flat on last week\./);
});

test('a grouped brief with nothing in any group still ends with its closing line', () => {
  const r = compare(snap('2026-09-28', []), snap('2026-10-05', []), '2026-10-05');
  for (const groupBy of ['owner', 'pipeline']) assert.match(renderBrief(r, { groupBy }), /Nothing flagged this week\.\n$/);
});
