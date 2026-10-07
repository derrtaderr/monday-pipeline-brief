// The spec fetch script, run with a stand-in fetch: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, SPEC_SHA, SPEC_FILES, MARKER, checkSpecDir } from '../scripts/fetch-hubspot-specs.mjs';
import { capture } from './helpers/io.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'mpb-specs-'));

test('a full download writes the three spec files and, last, a marker holding the pinned commit', async () => {
  const dir = tmp();
  const fetch = async () => {
    assert.ok(!existsSync(join(dir, MARKER)), 'the marker must not exist while files are still downloading');
    return new Response('{}', { status: 200 });
  };
  const code = await main(dir, { fetch, stdout: capture(), stderr: capture() });
  assert.equal(code, 0);
  for (const f of Object.values(SPEC_FILES)) assert.ok(existsSync(join(dir, f.saveAs)), f.saveAs);
  assert.equal(readFileSync(join(dir, MARKER), 'utf8').trim(), SPEC_SHA);
  assert.equal(checkSpecDir(dir), null);
});

test('a download that fails part way leaves no marker, even where an old one existed', async () => {
  const dir = tmp();
  writeFileSync(join(dir, MARKER), `${SPEC_SHA}\n`);
  let n = 0;
  const fetch = async () => (++n === 2 ? new Response('nope', { status: 404 }) : new Response('{}', { status: 200 }));
  const stderr = capture();
  const code = await main(dir, { fetch, stdout: capture(), stderr });
  assert.equal(code, 1);
  assert.match(stderr.text, /status 404/);
  assert.ok(!existsSync(join(dir, MARKER)));
  assert.match(checkSpecDir(dir), /re-run the fetch script/);
});

test('checkSpecDir names a missing or mismatched marker and says to re-run the fetch script', () => {
  const dir = tmp();
  assert.match(checkSpecDir(dir), new RegExp(`${MARKER} is missing.*re-run the fetch script: node scripts/fetch-hubspot-specs\\.mjs`));
  writeFileSync(join(dir, MARKER), 'b'.repeat(40));
  assert.match(checkSpecDir(dir), new RegExp(`were fetched at bbbbbbb.*not the pinned ${SPEC_SHA.slice(0, 7)}.*re-run the fetch script`));
});

test('offline, the fetch script prints one plain line (no stack trace), exits 1 and leaves no marker', async () => {
  const dir = tmp();
  const fetch = async () => { throw new TypeError('fetch failed'); };
  const stderr = capture();
  const code = await main(dir, { fetch, stdout: capture(), stderr });
  assert.equal(code, 1);
  assert.match(stderr.text, /^Could not reach raw\.githubusercontent\.com to download PublicApiSpecs\/CRM\/Deals\/[^\n]+ \(fetch failed\)\. Check your connection and run this again\.\n$/);
  assert.doesNotMatch(stderr.text, /\n\s+at /);
  assert.ok(!existsSync(join(dir, MARKER)));
});
