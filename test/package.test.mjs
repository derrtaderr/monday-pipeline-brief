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

test('version 0.1.1, with a changelog entry for it and for 0.1.0', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '0.1.1');
  const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(log, /^## 0\.1\.1\b/m);
  assert.match(log, /^## 0\.1\.0\b/m);
  assert.ok(log.indexOf('## 0.1.1') < log.indexOf('## 0.1.0'), 'newest first');
});
