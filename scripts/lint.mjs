// Zero-dependency lint gate: syntax-check every .mjs, no em dashes in README prose,
// no runtime dependencies, no maker-internal paths in any shipped file. Usage: node scripts/lint.mjs [root]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url));
const problems = [];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    if (f === 'node_modules' || f.startsWith('.')) return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

for (const file of walk(root).filter((f) => f.endsWith('.mjs'))) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) problems.push(`syntax error in ${relative(root, file)}\n${r.stderr.trim()}`);
}

readFileSync(join(root, 'README.md'), 'utf8').split('\n').forEach((line, i) => {
  if (line.includes('—')) problems.push(`README.md:${i + 1} has an em dash`);
});

// Maker exhaust: home-directory paths and notes about the workspace this was built in.
// Every file counts, dot folders included, except .git, node_modules and Finder litter.
const EXHAUST = [/\/Users\//, /life[_]os/, /WIR[I]NG/];
function walkAll(dir) {
  return readdirSync(dir).flatMap((f) => {
    if (f === '.git' || f === 'node_modules' || f === '.DS_Store') return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walkAll(p) : [p];
  });
}
// Review-log and planning language: a public repo reads as a product, not a build diary.
const PROCESS = [/ship-[c]heck/i, /fix [w]ave/i, /review [p]ass/i, /demand.[t]est/i, /\b[t]ally\b/i, /proto[t]ype/i];
for (const file of walkAll(root)) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (EXHAUST.some((re) => re.test(line))) problems.push(`${relative(root, file)}:${i + 1} has a maker-internal path or note`);
    if (PROCESS.some((re) => re.test(line))) problems.push(`${relative(root, file)}:${i + 1} has a process note`);
  });
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (Object.keys(pkg.dependencies ?? {}).length) problems.push('package.json has runtime dependencies; this project ships with none');

if (problems.length) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('lint ok\n');
