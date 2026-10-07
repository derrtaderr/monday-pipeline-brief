import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('the package ships only what a user runs: bin, src, demo, README, LICENSE', () => {
  const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const files = JSON.parse(r.stdout)[0].files.map((f) => f.path).sort();
  for (const f of files) {
    assert.match(f, /^(bin\/|src\/|demo\/|README\.md$|LICENSE$|package\.json$)/, `${f} should not ship`);
  }
  assert.ok(files.includes('bin/monday-brief.mjs'));
  assert.ok(files.includes('demo/snapshot-2026-10-05.json'));
});
