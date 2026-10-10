import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSnapshot, findPrevious } from '../src/store.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'mpb-store-'));
const snap = (date) => ({ schema: 1, date, deals: [] });

test('writeSnapshot creates the directory and writes snapshot-DATE.json', () => {
  const dir = join(tmp(), 'nested', 'snaps');
  const file = writeSnapshot(dir, snap('2026-10-05'));
  assert.equal(file, join(dir, 'snapshot-2026-10-05.json'));
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), snap('2026-10-05'));
});

test('findPrevious returns the newest week-old snapshot strictly before the date', () => {
  const dir = tmp();
  for (const d of ['2026-09-21', '2026-09-28', '2026-10-05']) writeSnapshot(dir, snap(d));
  writeFileSync(join(dir, 'snapshot-notes.json'), '{}');
  writeFileSync(join(dir, 'brief-2026-10-01.md'), 'x');
  assert.equal(findPrevious(dir, '2026-10-05').snapshot.date, '2026-09-28');
  assert.equal(findPrevious(dir, '2026-10-06').snapshot.date, '2026-09-28'); // 10-05 is 1 day old
  assert.equal(findPrevious(dir, '2026-10-12').snapshot.date, '2026-10-05');
});

test('findPrevious returns null for a missing or empty directory', () => {
  const dir = tmp();
  assert.deepEqual(findPrevious(dir, '2026-10-05'), { snapshot: null, skipped: [] });
  assert.deepEqual(findPrevious(join(dir, 'nope'), '2026-10-05'), { snapshot: null, skipped: [] });
  assert.ok(!existsSync(join(dir, 'nope')));
});

function writeRaw(dir, date, text) {
  writeFileSync(join(dir, `snapshot-${date}.json`), text);
}

test('a truncated previous snapshot is skipped by name and the next older valid one is used', () => {
  const dir = tmp();
  writeSnapshot(dir, snap('2026-09-21'));
  writeRaw(dir, '2026-09-28', '{"schema": 1, "date": "2026-09-28", "deals": [');
  const r = findPrevious(dir, '2026-10-05');
  assert.equal(r.snapshot.date, '2026-09-21');
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].file, 'snapshot-2026-09-28.json');
  assert.match(r.skipped[0].reason, /not valid JSON/);
});

test('a snapshot missing its deals list is skipped', () => {
  const dir = tmp();
  writeRaw(dir, '2026-09-28', JSON.stringify({ schema: 1, date: '2026-09-28' }));
  const r = findPrevious(dir, '2026-10-05');
  assert.equal(r.snapshot, null);
  assert.match(r.skipped[0].reason, /deals/);
});

test('a deal without an id is skipped as unreadable', () => {
  const dir = tmp();
  writeRaw(dir, '2026-09-28', JSON.stringify({ schema: 1, date: '2026-09-28', deals: [{ name: 'x' }] }));
  assert.match(findPrevious(dir, '2026-10-05').skipped[0].reason, /deal 1 has no id/);
});

test('a snapshot from a different schema version is skipped with the version named', () => {
  const dir = tmp();
  writeRaw(dir, '2026-09-28', JSON.stringify({ schema: 2, date: '2026-09-28', deals: [] }));
  assert.match(findPrevious(dir, '2026-10-05').skipped[0].reason, /schema 2/);
});

test('hand-edited amounts are coerced to numbers on load', () => {
  const dir = tmp();
  writeRaw(dir, '2026-09-28', JSON.stringify({ schema: 1, date: '2026-09-28', deals: [{ id: 'a', amount: '1500' }, { id: 'b', amount: 'n/a' }] }));
  const deals = findPrevious(dir, '2026-10-05').snapshot.deals;
  assert.equal(deals[0].amount, 1500);
  assert.equal(deals[1].amount, 0);
});

test('an ad-hoc mid-week snapshot does not displace the one about a week old', () => {
  const dir = tmp();
  for (const d of ['2026-09-28', '2026-10-02']) writeSnapshot(dir, snap(d)); // Monday cron, then a Friday run by hand
  assert.equal(findPrevious(dir, '2026-10-05').snapshot.date, '2026-09-28');
});

test('a snapshot exactly 6 days old counts as the weekly baseline; 5 days old does not', () => {
  const dir = tmp();
  for (const d of ['2026-09-21', '2026-09-29', '2026-09-30']) writeSnapshot(dir, snap(d));
  assert.equal(findPrevious(dir, '2026-10-05').snapshot.date, '2026-09-29');
});

test('with nothing 6 or more days old, the newest earlier snapshot is used', () => {
  const dir = tmp();
  for (const d of ['2026-10-01', '2026-10-03']) writeSnapshot(dir, snap(d));
  assert.equal(findPrevious(dir, '2026-10-05').snapshot.date, '2026-10-03');
});

test('an unreadable week-old snapshot falls back to the next older readable one, then to the newest recent one', () => {
  const dir = tmp();
  writeSnapshot(dir, snap('2026-09-21'));
  writeRaw(dir, '2026-09-28', 'garbage');
  writeSnapshot(dir, snap('2026-10-02'));
  let r = findPrevious(dir, '2026-10-05');
  assert.equal(r.snapshot.date, '2026-09-21');
  assert.deepEqual(r.skipped.map((s) => s.file), ['snapshot-2026-09-28.json']);
  const only = tmp();
  writeRaw(only, '2026-09-28', 'garbage');
  writeSnapshot(only, snap('2026-10-02'));
  r = findPrevious(only, '2026-10-05');
  assert.equal(r.snapshot.date, '2026-10-02');
  assert.deepEqual(r.skipped.map((s) => s.file), ['snapshot-2026-09-28.json']);
});

test('a snapshot that lists a deal id twice loads it once, so the bridge can balance', () => {
  const dir = tmp();
  writeRaw(dir, '2026-09-28', JSON.stringify({ schema: 1, date: '2026-09-28', deals: [{ id: 1, amount: 5 }, { id: '1', amount: 7 }, { id: 2, amount: 1 }] }));
  const { snapshot } = findPrevious(dir, '2026-10-05');
  assert.deepEqual(snapshot.deals.map((d) => [d.id, d.amount]), [['1', 5], ['2', 1]]);
});

// F5: a run by hand on Tuesday is 6 days old by next Monday; last Monday's run, 7 days old, is
// still the weekly baseline.
test('a Tuesday run by hand does not become next Monday\'s baseline: a snapshot 7 or 8 days old wins', () => {
  const dir = tmp();
  for (const d of ['2026-09-28', '2026-09-29']) writeSnapshot(dir, snap(d)); // Monday cron, then Tuesday by hand
  assert.equal(findPrevious(dir, '2026-10-05').snapshot.date, '2026-09-28');
  const late = tmp();
  for (const d of ['2026-09-27', '2026-09-29']) writeSnapshot(late, snap(d));
  assert.equal(findPrevious(late, '2026-10-05').snapshot.date, '2026-09-27');
});

test('with nothing 7 or 8 days old, the newest at least 6 days old is used, not one two weeks old', () => {
  const dir = tmp();
  for (const d of ['2026-09-21', '2026-09-29']) writeSnapshot(dir, snap(d)); // last week's run a day late
  assert.equal(findPrevious(dir, '2026-10-05').snapshot.date, '2026-09-29');
});
