import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { demoBrief } from '../src/cli.mjs';

const BIN = fileURLToPath(new URL('../bin/monday-brief.mjs', import.meta.url));

test('bin runs demo from a clone with exit 0', () => {
  const r = spawnSync(process.execPath, [BIN, 'demo'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, demoBrief());
});

test('bin run without a token exits 1', () => {
  const r = spawnSync(process.execPath, [BIN, 'run'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /HUBSPOT_TOKEN is not set/);
});
