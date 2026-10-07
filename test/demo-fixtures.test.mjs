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

test('demo brief keeps every seed section count and the headline numbers', () => {
  const out = renderBrief(compare(json('../demo/snapshot-2026-09-28.json'), json('../demo/snapshot-2026-10-05.json'), '2026-10-05'));
  const counts = (text) => [...text.matchAll(/^\*\*?([^*]+)\*\*? \((\d+)\)$/gm)].map((m) => [m[1].replace(/, or .*/, ''), m[2]]);
  const seed = read('./fixtures/seed/sample-brief.md');
  assert.deepEqual(counts(out), counts(seed));
  assert.match(out, /Open pipeline \$1\.25M across 21 deals, up \$156K on last week\./);
  assert.match(out, /Closed 2 won \(\$114K\) and 1 lost \(\$90K\)\./);
  assert.match(out, /\*\*Look at these first\*\* \(more than one warning sign\)\n- Halcyon, \$24K, Leo: close date slipped, no activity in 14\+ days\n\n/);
});
