// Private, atomic file writes. Deal data is private: new folders are 0700 and new files 0600; a
// file that already exists keeps its permissions. A write goes to a temp file in the same folder
// and is renamed over the target, so a write that fails part way (a full disk) never leaves a
// half-written file, and the old one, if any, stays whole.

import { mkdirSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

// write is for tests: the function that writes the temp file (fs.writeFileSync's signature).
export function writePrivate(file, text, { write = writeFileSync } = {}) {
  mkdirSync(dirname(file), { recursive: true, mode: DIR_MODE });
  let mode = FILE_MODE;
  try {
    const stat = statSync(file);
    if (stat.isDirectory()) throw Object.assign(new Error(`${file} is a folder`), { code: 'EISDIR' });
    mode = stat.mode & 0o777;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const temp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
  try {
    write(temp, text, { mode });
    renameSync(temp, file);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}
