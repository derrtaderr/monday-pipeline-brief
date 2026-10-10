import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePrivate, FILE_MODE, DIR_MODE } from '../src/files.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'mpb-files-'));

// A write that fails part way (a full disk, say) must never leave a half-written file in place
// of the old one: the text goes to a temp file in the same folder, then is renamed over it.
test('a write that fails part way leaves the old file whole and no temp file behind', () => {
  const dir = tmp();
  const file = join(dir, 'snapshot-2026-10-05.json');
  writeFileSync(file, 'old and whole');
  const halfThenFull = (path, text, opts) => {
    writeFileSync(path, text.slice(0, 3), opts);
    throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
  };
  assert.throws(() => writePrivate(file, 'new text that does not fit', { write: halfThenFull }), { code: 'ENOSPC' });
  assert.equal(readFileSync(file, 'utf8'), 'old and whole');
  assert.deepEqual(readdirSync(dir), ['snapshot-2026-10-05.json']);
});

test('a write that fails with nothing there before leaves no file at all', () => {
  const dir = tmp();
  const fail = () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); };
  assert.throws(() => writePrivate(join(dir, 'brief.md'), 'x', { write: fail }), { code: 'ENOSPC' });
  assert.deepEqual(readdirSync(dir), []);
});

test('a new file is private, and an existing file keeps its permissions', { skip: process.platform === 'win32' }, () => {
  const dir = join(tmp(), 'new');
  writePrivate(join(dir, 'a.md'), 'a');
  assert.equal(statSync(dir).mode & 0o777, DIR_MODE);
  assert.equal(statSync(join(dir, 'a.md')).mode & 0o777, FILE_MODE);
  const shared = join(dir, 'b.md');
  writeFileSync(shared, 'old');
  chmodSync(shared, 0o640);
  writePrivate(shared, 'new');
  assert.equal(readFileSync(shared, 'utf8'), 'new');
  assert.equal(statSync(shared).mode & 0o777, 0o640);
});

test('a target that is a folder fails with EISDIR and leaves no temp file', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'brief.md'));
  assert.throws(() => writePrivate(join(dir, 'brief.md'), 'x'), { code: 'EISDIR' });
  assert.deepEqual(readdirSync(dir), ['brief.md']);
});
