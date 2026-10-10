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

test('version 0.3.1, with changelog entries for it, 0.3.0, 0.2.1, 0.2.0, 0.1.1 and 0.1.0, newest first', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '0.3.1');
  const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const order = ['## 0.3.1', '## 0.3.0', '## 0.2.1', '## 0.2.0', '## 0.1.1', '## 0.1.0'];
  for (const h of order) assert.match(log, new RegExp(`^${h.replace(/\./g, '\\.')}\\b`, 'm'));
  for (let i = 1; i < order.length; i++) assert.ok(log.indexOf(order[i - 1]) < log.indexOf(order[i]), 'newest first');
});
