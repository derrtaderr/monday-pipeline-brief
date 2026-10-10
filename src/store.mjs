// Snapshot files on the user's own disk: <dir>/snapshot-YYYY-MM-DD.json

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { writePrivate } from './files.mjs';
import { join } from 'node:path';
import { SCHEMA } from './snapshot.mjs';
import { daysBetween } from './format.mjs';

const NAME = /^snapshot-(\d{4}-\d{2}-\d{2})\.json$/;

export function writeSnapshot(dir, snapshot) {
  const file = join(dir, `snapshot-${snapshot.date}.json`);
  writePrivate(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  return file;
}

// Returns the parsed snapshot, or throws an Error whose message says what is wrong with it.
function readSnapshot(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error('not valid JSON');
  }
  if (!data || typeof data !== 'object') throw new Error('not a snapshot object');
  if (data.schema !== SCHEMA) throw new Error(`written in schema ${data.schema ?? 'unknown'}, this version reads schema ${SCHEMA}`);
  if (!Array.isArray(data.deals)) throw new Error('missing its deals list');
  data.deals.forEach((d, i) => {
    if (!d || typeof d !== 'object' || d.id === undefined || d.id === null) throw new Error(`deal ${i + 1} has no id`);
    d.id = String(d.id);
    d.amount = Number(d.amount) || 0;
  });
  // One record per deal id (the first), as buildSnapshot writes them.
  const seen = new Set();
  data.deals = data.deals.filter((d) => !seen.has(d.id) && seen.add(d.id));
  return data;
}

// The weekly baseline: a snapshot WEEK_DAYS old is preferred (the window the brief calls "last
// week"); else one at least BASELINE_DAYS old.
export const WEEK_DAYS = [7, 8];
export const BASELINE_DAYS = 6;

// The previous snapshot: the newest readable one 7 or 8 days old, so a run by hand on Tuesday
// (6 days old by next Monday) never displaces last Monday's; else the newest readable one at
// least BASELINE_DAYS old, so a late run last week still beats one from two weeks ago; failing
// that, the newest readable earlier one. Unreadable files that were tried are skipped and reported.
export function findPrevious(dir, date) {
  const skipped = [];
  if (!existsSync(dir)) return { snapshot: null, skipped };
  const dates = readdirSync(dir)
    .map((f) => NAME.exec(f)?.[1])
    .filter((d) => d && d < date)
    .sort()
    .reverse();
  const age = (d) => daysBetween(d, date);
  const week = dates.filter((d) => age(d) >= WEEK_DAYS[0] && age(d) <= WEEK_DAYS[1]);
  const old = dates.filter((d) => age(d) >= BASELINE_DAYS && !week.includes(d));
  const recent = dates.filter((d) => age(d) < BASELINE_DAYS);
  for (const d of [...week, ...old, ...recent]) {
    const file = `snapshot-${d}.json`;
    try {
      const snapshot = readSnapshot(join(dir, file));
      snapshot.date ??= d;
      return { snapshot, skipped };
    } catch (err) {
      skipped.push({ file, reason: err.message });
    }
  }
  return { snapshot: null, skipped };
}
