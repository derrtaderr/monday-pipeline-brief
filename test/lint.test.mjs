import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LINT = fileURLToPath(new URL('../scripts/lint.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const lint = (root) => spawnSync(process.execPath, [LINT, root], { encoding: 'utf8' });

function repo({ readme = 'fine\n', pkg = {}, code = 'export const x = 1;\n' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mpb-lint-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'README.md'), readme);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', ...pkg }));
  writeFileSync(join(dir, 'src', 'a.mjs'), code);
  return dir;
}

test('lint passes on this repository', () => {
  const r = lint(ROOT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('lint fails on an em dash in the README', () => {
  const r = lint(repo({ readme: 'a — b\n' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /em dash/);
});

test('lint fails on a runtime dependency', () => {
  const r = lint(repo({ pkg: { dependencies: { leftpad: '1.0.0' } } }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /runtime dependencies/);
});

test('lint fails on a syntax error', () => {
  const r = lint(repo({ code: 'export const = ;\n' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a\.mjs/);
});

// Built at run time so this test file never carries the strings it hunts for.
const MAKER_PATHS = [['', 'Users', 'someone', 'x'].join('/'), ['life', 'os'].join('_'), ['WIR', 'ING.md'].join('')];

for (const text of MAKER_PATHS) {
  test(`lint fails on maker-internal exhaust in any shipped file: ${text.slice(0, 6)}`, () => {
    const dir = repo();
    mkdirSync(join(dir, '.vibecodepm'));
    writeFileSync(join(dir, '.vibecodepm', 'notes.md'), `see ${text}\n`);
    const r = lint(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /maker-internal/);
    assert.match(r.stderr, /notes\.md/);
  });
}

test('no maker notes file ships in the repository', async () => {
  const { existsSync } = await import('node:fs');
  assert.ok(!existsSync(join(ROOT, ['WIR', 'ING.md'].join(''))));
});

// Review-log and planning language reads as process, not product, in a public repo.
const PROCESS_NOTES = [['ship', 'check'].join('-'), ['fix', 'wave 1'].join(' '), ['review', 'pass 2'].join(' '), ['demand', 'test'].join('-'), ['tal', 'ly'].join(''), ['proto', 'type'].join('')];

for (const text of PROCESS_NOTES) {
  test(`lint fails on process notes in any shipped file: ${text.slice(0, 5)}`, () => {
    const dir = repo();
    writeFileSync(join(dir, 'SPEC.md'), `see the ${text} here\n`);
    const r = lint(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SPEC\.md:1 has a process note/);
  });
}
