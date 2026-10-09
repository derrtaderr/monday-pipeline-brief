// Snapshot files on the user's own disk: <dir>/snapshot-YYYY-MM-DD.json

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA } from './snapshot.mjs';
import { daysBetween } from './format.mjs';

const NAME = /^snapshot-(\d{4}-\d{2}-\d{2})\.json$/;

export function writeSnapshot(dir, snapshot) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `snapshot-${snapshot.date}.json`);
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
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

// A snapshot at least this many days old counts as last week's baseline.
export const BASELINE_DAYS = 6;

// The previous snapshot: the newest readable one at least BASELINE_DAYS old, so an ad-hoc
// mid-week run never displaces the weekly baseline; failing that, the newest readable earlier
// one. Unreadable files that were tried are skipped and reported.
export function findPrevious(dir, date) {
  const skipped = [];
  if (!existsSync(dir)) return { snapshot: null, skipped };
  const dates = readdirSync(dir)
    .map((f) => NAME.exec(f)?.[1])
    .filter((d) => d && d < date)
    .sort()
    .reverse();
  const old = dates.filter((d) => daysBetween(d, date) >= BASELINE_DAYS);
  const recent = dates.filter((d) => daysBetween(d, date) < BASELINE_DAYS);
  for (const d of [...old, ...recent]) {
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
