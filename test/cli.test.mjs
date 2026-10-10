import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, chmodSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, invocationFor } from '../src/cli.mjs';
import { writeSnapshot } from '../src/store.mjs';
import { capture } from './helpers/io.mjs';
import { fakeFetch, happyRoutes, respond, fixture } from './helpers/fake-hubspot.mjs';

const TOKEN = ['pat', 'na1', '11111111-2222-3333-4444-555555555555'].join('-');
const NOW = new Date(2026, 9, 5, 7, 0, 0); // local Oct 5 2026
const tmp = () => mkdtempSync(join(tmpdir(), 'mpb-cli-'));
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

async function run(argv, opts = {}) {
  const stdout = capture();
  if (opts.tty) stdout.isTTY = true;
  const stderr = capture();
  const fetch = opts.fetch ?? fakeFetch(happyRoutes());
  const code = await main(argv, { env: opts.env ?? {}, fetch, sleep: async () => {}, stdout, stderr, now: opts.now ?? NOW, cwd: opts.cwd ?? tmp(), home: opts.home ?? tmp() });
  return { code, out: stdout.text, err: stderr.text, fetch };
}

test('demo prints the sample brief with no token', async () => {
  const r = await run(['demo']);
  assert.equal(r.code, 0);
  assert.match(r.out, /^# Monday pipeline brief, week of Oct 5\n/);
  assert.match(r.out, /Open pipeline \$1\.29M across 23 deals/);
  assert.equal(r.fetch.calls.length, 0);
});

test('demo --out also writes the brief to a file', async () => {
  const file = join(tmp(), 'brief.md');
  const r = await run(['demo', '--out', file]);
  assert.equal(r.code, 0);
  assert.equal(readFileSync(file, 'utf8'), r.out);
  assert.match(r.err, new RegExp(`Saved the demo brief to ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n$`));
});

test('help and no arguments print usage', async () => {
  for (const argv of [['help'], [], ['--help']]) {
    const r = await run(argv);
    assert.equal(r.code, 0);
    assert.match(r.out, /node bin\/monday-brief\.mjs run/);
    assert.match(r.out, /node bin\/monday-brief\.mjs demo/);
    assert.doesNotMatch(r.out, /^\s+monday-brief /m);
  }
});

test('usage names the token as a HubSpot service key or private app token', async () => {
  const r = await run(['help']);
  assert.match(r.out.replace(/\s+/g, ' '), /HUBSPOT_TOKEN HubSpot service key or private app token \(scopes crm\.objects\.deals\.read, crm\.objects\.owners\.read, and settings\.currencies\.read for stateless mode\)/);
  assert.doesNotMatch(r.out, /Private app access token/);
});

test('an unknown command exits 1 with usage on stderr', async () => {
  const r = await run(['frobnicate']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Unknown command "frobnicate"/);
});

test('run without HUBSPOT_TOKEN exits 1 and says how to fix it', async () => {
  const r = await run(['run']);
  assert.equal(r.code, 1);
  assert.match(r.err, /HUBSPOT_TOKEN is not set/);
  assert.match(r.err, /Create a HubSpot service key \(or a private app on older accounts\)/);
  assert.match(r.err, /run: node bin\/monday-brief\.mjs demo/);
  assert.equal(r.fetch.calls.length, 0);
});

test('first run writes a snapshot and a brief that says two runs are needed', async () => {
  const dir = join(tmp(), 'snaps');
  const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(readdirSync(dir).sort(), ['brief-2026-10-05.md', 'run.log', 'snapshot-2026-10-05.json']);
  const snap = JSON.parse(readFileSync(join(dir, 'snapshot-2026-10-05.json'), 'utf8'));
  assert.equal(snap.deals.length, 6);
  assert.match(r.out, /A comparison needs two weekly runs/);
  assert.equal(readFileSync(join(dir, 'brief-2026-10-05.md'), 'utf8'), r.out);
  assert.match(r.err, /Saved snapshot-2026-10-05\.json and brief-2026-10-05\.md/);
});

test('a later run compares against the newest earlier snapshot', async () => {
  const dir = tmp();
  writeSnapshot(dir, {
    schema: 1, taken_at: '2026-09-28T07:00:00.000Z', date: '2026-09-28', source: 'hubspot',
    deals: [{ id: '5001', name: 'Northwind', owner: 'Dana Ruiz', pipeline_id: 'default', pipeline: 'Sales Pipeline', stage_id: 'presentationscheduled', stage: 'Demo', stage_order: 2, status: 'open', amount: 75000, close_date: '2026-11-02', next_step: 'Pricing call', last_activity: '2026-09-27' }],
  });
  const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Compared with the snapshot from Sep 28\./);
  assert.match(r.out, /- Northwind, \$75K, Dana Ruiz: Nov 2 → Dec 2 \(\+30 days\)/);
  assert.match(r.out, /- Northwind, \$75K, Dana Ruiz: Demo → Qualified/);
});

// The first real-portal run: few activities logged, deals created that day. A 0.1.0 snapshot
// (no `created` field) is the baseline, so old snapshots keep working.
test('a real-shaped portal with little logged activity: only honest stale flags, against a 0.1.0 baseline', async () => {
  const dir = tmp();
  writeSnapshot(dir, {
    schema: 1, taken_at: '2026-09-28T07:00:00.000Z', date: '2026-09-28', source: 'hubspot',
    deals: [{ id: '900000000102', name: 'Copperfield Supply', owner: 'Leo', pipeline_id: 'default', pipeline: 'Sales Pipeline', stage_id: 'presentationscheduled', stage: 'Demo', stage_order: 2, status: 'open', amount: 42000, close_date: '2026-11-20', next_step: 'Send pricing', last_activity: null }],
  });
  const routes = happyRoutes();
  routes['/crm/v3/objects/deals'] = [() => respond(200, fixture('deals-real-shape.json'))];
  const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN }, fetch: fakeFetch(routes) });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Compared with the snapshot from Sep 28\./);
  assert.match(r.out, /- \[Larkspur Analytics\]\(https:\/\/app-na2\.hubspot\.com\/contacts\/12345678\/record\/0-3\/900000000101\), \$60K/);
  const plain = r.out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const section = (title) => plain.split(`**${title}**`)[1]?.split('\n\n')[0] ?? '';
  assert.deepEqual(section('No next step, or no activity in 14+ days').split('\n').slice(1), [
    '- Larkspur Analytics, $60K, Dana Ruiz: no next step',
    '- Copperfield Supply, $42K, Leo: no activity logged since it was created Sep 20',
    '- Bramblewood Cafe, $1K, Unassigned: no next step',
  ]);
  assert.deepEqual(section('Look at these first').split('\n').slice(1), [
    '- Larkspur Analytics, $60K, Dana Ruiz: no next step (large deal)',
    '- Copperfield Supply, $42K, Leo: close date slipped, no activity in 14+ days (2 warning signs)',
  ]);
  assert.doesNotMatch(r.out, /next step set, no activity logged/);
  const snap = JSON.parse(readFileSync(join(dir, 'snapshot-2026-10-05.json'), 'utf8'));
  assert.equal(snap.deals.find((d) => d.id === '900000000101').created, '2026-10-05');
});

test('the snapshot directory comes from --dir, then MONDAY_BRIEF_DIR, then ~/.monday-pipeline-brief', async () => {
  const cwd = tmp();
  const home = tmp();
  await run(['run'], { env: { HUBSPOT_TOKEN: TOKEN }, cwd, home });
  assert.ok(existsSync(join(home, '.monday-pipeline-brief', 'snapshot-2026-10-05.json')));
  assert.ok(!existsSync(join(cwd, 'pipeline-snapshots')));
  const envDir = join(cwd, 'from-env');
  await run(['run'], { env: { HUBSPOT_TOKEN: TOKEN, MONDAY_BRIEF_DIR: envDir }, cwd });
  assert.ok(existsSync(join(envDir, 'snapshot-2026-10-05.json')));
});

test('an empty MONDAY_BRIEF_DIR is treated as unset, not as the current folder', async () => {
  const cwd = tmp();
  const home = tmp();
  const r = await run(['run'], { env: { HUBSPOT_TOKEN: TOKEN, MONDAY_BRIEF_DIR: '' }, cwd, home });
  assert.equal(r.code, 0);
  assert.ok(existsSync(join(home, '.monday-pipeline-brief', 'snapshot-2026-10-05.json')));
  assert.deepEqual(readdirSync(cwd), []);
});

test('--out puts the brief somewhere else', async () => {
  const dir = tmp();
  const out = join(tmp(), 'monday.md');
  const r = await run(['run', '--dir', dir, '--out', out], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(out, 'utf8'), r.out);
  assert.deepEqual(readdirSync(dir).sort(), ['run.log', 'snapshot-2026-10-05.json']);
});

test('a 401 exits 2, writes no snapshot or brief, and explains the token problem', async () => {
  const routes = happyRoutes();
  routes['/crm/v3/objects/deals'] = [() => respond(401, fixture('error-401.json'))];
  const dir = join(tmp(), 'snaps');
  const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN }, fetch: fakeFetch(routes) });
  assert.equal(r.code, 2);
  assert.match(r.err, /HubSpot rejected the token \(401\)/);
  assert.match(r.err, /No snapshot or brief was written\./);
  assert.deepEqual(readdirSync(dir), ['run.log']);
  assert.match(readFileSync(join(dir, 'run.log'), 'utf8'), /exit=2 .*HubSpot rejected the token \(401\)/);
});

test('a corrupted previous snapshot is named, skipped, and today is still saved', async () => {
  const dir = tmp();
  writeSnapshot(dir, { schema: 1, date: '2026-09-21', deals: [] });
  writeFileSync(join(dir, 'snapshot-2026-09-28.json'), '{"schema": 1, "deals": [');
  const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /Skipped snapshot-2026-09-28\.json \(not valid JSON\)/);
  assert.match(r.out, /Skipped unreadable snapshot-2026-09-28\.json \(not valid JSON\)\.\n\nCompared with the snapshot from Sep 21, 2 weeks ago\./);
  assert.match(r.out, /since Sep 21\./);
  assert.doesNotMatch(r.out, /last week/);
  assert.ok(existsSync(join(dir, 'snapshot-2026-10-05.json')));
});

test('with no readable previous snapshot the run falls back to first-run mode', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'snapshot-2026-09-28.json'), 'garbage');
  const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Skipped unreadable snapshot-2026-09-28\.json \(not valid JSON\)\.\n\nNo earlier snapshot could be read\./);
  assert.ok(existsSync(join(dir, 'snapshot-2026-10-05.json')));
});

test('every run appends one line to run.log in the snapshot folder', async () => {
  const dir = tmp();
  await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN } });
  await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN }, now: new Date(2026, 9, 12, 7, 0, 0) });
  const lines = readFileSync(join(dir, 'run.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^2026-10-05T\S+ exit=0 .*Saved snapshot-2026-10-05\.json/);
  assert.match(lines[1], /^2026-10-12T\S+ exit=0 .*Saved snapshot-2026-10-12\.json/);
});

test('a missing token is logged to run.log too, so a scheduled run that lost its env is visible', async () => {
  const dir = tmp();
  const r = await run(['run', '--dir', dir], { env: { MONDAY_BRIEF_DIR: dir } });
  assert.equal(r.code, 1);
  assert.match(readFileSync(join(dir, 'run.log'), 'utf8'), /exit=1 HUBSPOT_TOKEN is not set/);
});

test('a snapshot folder that cannot be created is a named setup error, exit 1, before HubSpot is called', async () => {
  const parent = tmp();
  writeFileSync(join(parent, 'a-file'), 'x');
  const dir = join(parent, 'a-file', 'snaps');
  const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 1);
  assert.match(r.err, /Cannot write to the snapshot folder .*a-file\/snaps \(ENOTDIR\)/);
  assert.match(r.err, /--dir or MONDAY_BRIEF_DIR/);
  assert.equal(r.fetch.calls.length, 0);
});

test('a read-only snapshot folder is a named setup error, exit 1', { skip: process.getuid?.() === 0 }, async () => {
  const dir = tmp();
  chmodSync(dir, 0o500);
  try {
    const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN } });
    assert.equal(r.code, 1);
    assert.match(r.err, /Cannot write to the snapshot folder .* \(EACCES\)/);
  } finally {
    chmodSync(dir, 0o700);
  }
});

test('messages use the command the user actually ran', async () => {
  const stdout = capture();
  await main(['help'], { env: {}, stdout, stderr: capture(), now: NOW, cwd: tmp(), invocation: 'npx github:derrtaderr/monday-pipeline-brief' });
  assert.match(stdout.text, /npx github:derrtaderr\/monday-pipeline-brief run/);
  const stderr = capture();
  await main(['run'], { env: {}, stdout: capture(), stderr, now: NOW, cwd: tmp(), home: tmp(), invocation: 'npx github:derrtaderr/monday-pipeline-brief' });
  assert.match(stderr.text, /run: npx github:derrtaderr\/monday-pipeline-brief demo/);
});

test('invocationFor tells npx, clone and absolute-path runs apart', () => {
  assert.equal(invocationFor('/home/a/.npm/_npx/abc/node_modules/monday-pipeline-brief/bin/monday-brief.mjs', '/x'), `npx github:derrtaderr/monday-pipeline-brief#v${PKG.version}`);
  assert.equal(invocationFor('/home/a/monday-pipeline-brief/bin/monday-brief.mjs', '/home/a/monday-pipeline-brief'), 'node bin/monday-brief.mjs');
  assert.equal(invocationFor('/home/a/monday-pipeline-brief/bin/monday-brief.mjs', '/tmp'), 'node /home/a/monday-pipeline-brief/bin/monday-brief.mjs');
});

test('--no-next-step and MONDAY_BRIEF_NEXT_STEP=off turn the next step check off', async () => {
  for (const [argv, env] of [[['--no-next-step'], {}], [[], { MONDAY_BRIEF_NEXT_STEP: 'off' }]]) {
    const dir = tmp();
    const r = await run(['run', '--dir', dir, ...argv], { env: { HUBSPOT_TOKEN: TOKEN, ...env } });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /\*\*No activity in 14\+ days\*\*/);
    assert.doesNotMatch(r.out, /no next step/);
  }
});

test('run warns on stderr about deals in unreadable stages', async () => {
  const r = await run(['run', '--dir', tmp()], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /Warning: 1 deal is in a stage we couldn't read/);
  assert.match(r.out, /1 deal \(\$1K\) is in a stage we couldn't read/, 'the brief keeps the total');
});

// F8: stderr ends up in logs (a public GitHub Action's log is readable by anyone who can read the
// repository), so it carries counts only, never a dollar amount.
test('stderr never carries a dollar amount, in stored or stateless mode', async () => {
  const stored = await run(['run', '--dir', tmp()], { env: { HUBSPOT_TOKEN: TOKEN } });
  const sl = await stateless(['run', '--since', '7d']);
  for (const r of [stored, sl]) {
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /\$\d/, r.err);
  }
});

test('a token pasted with smart quotes fails at once with exit 1, names the cause, and never prints the token', async () => {
  const dir = tmp();
  const bad = `“${TOKEN}”`;
  const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: bad } });
  assert.equal(r.code, 1);
  assert.match(r.err, /HUBSPOT_TOKEN has characters a HubSpot token never has \(smart quotes/);
  assert.doesNotMatch(r.err, /Could not reach HubSpot/);
  assert.equal(r.fetch.calls.length, 0);
  const log = readFileSync(join(dir, 'run.log'), 'utf8');
  for (const text of [r.err, r.out, log]) assert.ok(!text.includes('11111111-2222'), 'token leaked');
  assert.ok(!existsSync(join(dir, 'snapshot-2026-10-05.json')));
});

test('an --out location that cannot be written is a named setup error, exit 1, before HubSpot is called', async () => {
  const parent = tmp();
  writeFileSync(join(parent, 'a-file'), 'x');
  const out = join(parent, 'a-file', 'brief.md');
  const dir = tmp();
  const r = await run(['run', '--dir', dir, '--out', out], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 1);
  assert.match(r.err, /Cannot write the brief to .*a-file\/brief\.md \((EEXIST|ENOTDIR)\)\. Choose a location you can write to with --out\. Nothing was fetched from HubSpot\./);
  assert.doesNotMatch(r.err, /Unexpected error/);
  assert.equal(r.fetch.calls.length, 0);
});

test('a brief write that fails after HubSpot was read exits 4 and says today\'s snapshot was saved', async () => {
  const dir = tmp();
  const out = join(dir, 'brief-2026-10-05.md');
  mkdirSync(out); // the default brief path is taken by a folder: fails at write time
  const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 4);
  assert.match(r.err, new RegExp(`Could not write the brief to ${out} \\(EISDIR\\)\\. Today's snapshot was saved as snapshot-2026-10-05\\.json in ${dir}\\.`));
  assert.doesNotMatch(r.err, /Unexpected error/);
  assert.ok(existsSync(join(dir, 'snapshot-2026-10-05.json')));
  assert.match(readFileSync(join(dir, 'run.log'), 'utf8'), /exit=4 .*Could not write the brief/);
});

test('a snapshot write that fails exits 4 and says nothing was saved', async () => {
  const dir = tmp();
  mkdirSync(join(dir, 'snapshot-2026-10-05.json'));
  const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 4);
  assert.match(r.err, /Could not save today's snapshot in .* \(EISDIR\)\. No snapshot or brief was written\./);
  assert.doesNotMatch(r.err, /Unexpected error/);
  assert.ok(!existsSync(join(dir, 'brief-2026-10-05.md')));
});

test('a run.log that cannot be written is a named warning and does not change the exit code', async () => {
  const dir = tmp();
  mkdirSync(join(dir, 'run.log'));
  const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 0);
  assert.match(r.err, /Warning: could not add a line to .*run\.log \(EISDIR\)/);
});

test('demo --out to a location that cannot be written is a named error, exit 4', async () => {
  const parent = tmp();
  writeFileSync(join(parent, 'a-file'), 'x');
  const file = join(parent, 'a-file', 'brief.md');
  const r = await run(['demo', '--out', file]);
  assert.equal(r.code, 4);
  assert.match(r.err, /Could not write the demo brief to .*a-file\/brief\.md \((EEXIST|ENOTDIR)\)\. The brief above was printed but not saved\./);
  assert.doesNotMatch(r.err, /Unexpected error/);
});

test('a leading ~ in MONDAY_BRIEF_DIR or --dir means the home directory', async () => {
  const home = tmp();
  const cwd = tmp();
  await run(['run'], { env: { HUBSPOT_TOKEN: TOKEN, MONDAY_BRIEF_DIR: '~/from-env' }, cwd, home });
  assert.ok(existsSync(join(home, 'from-env', 'snapshot-2026-10-05.json')));
  await run(['run', '--dir', '~/from-flag'], { env: { HUBSPOT_TOKEN: TOKEN }, cwd, home });
  assert.ok(existsSync(join(home, 'from-flag', 'snapshot-2026-10-05.json')));
  assert.ok(!existsSync(join(cwd, '~')), 'a literal ~ folder must not be created');
});

test('deal data is private: a new snapshot folder is 0700 and every file the run writes is 0600', { skip: process.platform === 'win32' }, async () => {
  const dir = join(tmp(), 'snaps');
  const out = join(tmp(), 'brief.md');
  const mode = (p) => statSync(p).mode & 0o777;
  let r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 0, r.err);
  assert.equal(mode(dir), 0o700);
  for (const f of ['snapshot-2026-10-05.json', 'brief-2026-10-05.md', 'run.log']) assert.equal(mode(join(dir, f)), 0o600, f);
  r = await run(['run', '--dir', dir, '--out', out], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 0, r.err);
  assert.equal(mode(out), 0o600);
});

test('a leading ~ in --out means the home directory, for run and demo', async () => {
  const home = tmp();
  let r = await run(['run', '--dir', tmp(), '--out', '~/briefs/run.md'], { env: { HUBSPOT_TOKEN: TOKEN }, home });
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(join(home, 'briefs', 'run.md')));
  r = await run(['demo', '--out', '~/demo.md'], { home });
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(join(home, 'demo.md')));
});

test('one layer of matching surrounding quotes is removed from folder and file values', async () => {
  const home = tmp();
  const cwd = tmp();
  await run(['run'], { env: { HUBSPOT_TOKEN: TOKEN, MONDAY_BRIEF_DIR: '"~/env dir"' }, cwd, home });
  assert.ok(existsSync(join(home, 'env dir', 'snapshot-2026-10-05.json')));
  const flagDir = join(tmp(), 'flag');
  const out = join(tmp(), 'out.md');
  const r = await run(['run', '--dir', `'${flagDir}'`, '--out', `"${out}"`], { env: { HUBSPOT_TOKEN: TOKEN }, cwd });
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(join(flagDir, 'snapshot-2026-10-05.json')));
  assert.ok(existsSync(out));
  assert.ok(!readdirSync(cwd).some((f) => /["']/.test(f)), 'no folder named with quotes');
});

test('--dir=DIR and --out=FILE work like the two-word forms', async () => {
  const dir = join(tmp(), 'eq');
  const out = join(tmp(), 'eq.md');
  const r = await run(['run', `--dir=${dir}`, `--out=${out}`], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(join(dir, 'snapshot-2026-10-05.json')));
  assert.equal(readFileSync(out, 'utf8'), r.out);
  const bad = await run(['run', '--dir='], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /--dir needs a value/);
});

test('run --help and demo --help print usage with exit 0 and do nothing else', async () => {
  for (const argv of [['run', '--help'], ['demo', '--help'], ['run', '-h']]) {
    const r = await run(argv, { env: { HUBSPOT_TOKEN: TOKEN } });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^monday-pipeline-brief: /);
    assert.equal(r.err, '');
    assert.equal(r.fetch.calls.length, 0);
  }
});

test('--out pointing at an existing folder is caught before HubSpot is called', async () => {
  const out = tmp();
  const r = await run(['run', '--dir', tmp(), '--out', out], { env: { HUBSPOT_TOKEN: TOKEN } });
  assert.equal(r.code, 1);
  assert.match(r.err, /Cannot write the brief to .* \(EISDIR\)\. Choose a location you can write to with --out\. Nothing was fetched from HubSpot\./);
  assert.equal(r.fetch.calls.length, 0);
});

test('a snapshot folder that is writable but not readable is a named setup error, exit 1, before HubSpot is called', { skip: process.getuid?.() === 0 || process.platform === 'win32' }, async () => {
  const dir = tmp();
  chmodSync(dir, 0o300);
  try {
    const r = await run(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN } });
    assert.equal(r.code, 1);
    assert.match(r.err, /Cannot read the snapshot folder .* \(EACCES\)\. Choose a folder you can read and write with --dir or MONDAY_BRIEF_DIR\./);
    assert.doesNotMatch(r.err, /Unexpected error/);
    assert.equal(r.fetch.calls.length, 0);
  } finally {
    chmodSync(dir, 0o700);
  }
});

async function realShapedRun(argv, env = {}) {
  const dir = tmp();
  writeSnapshot(dir, {
    schema: 1, taken_at: '2026-09-28T07:00:00.000Z', date: '2026-09-28', source: 'hubspot',
    deals: [{ id: '900000000102', name: 'Copperfield Supply', owner: 'Leo', pipeline_id: 'default', pipeline: 'Sales Pipeline', stage_id: 'presentationscheduled', stage: 'Demo', stage_order: 2, status: 'open', amount: 42000, close_date: '2026-11-20', next_step: 'Send pricing', last_activity: null }],
  });
  const routes = happyRoutes();
  routes['/crm/v3/objects/deals'] = [() => respond(200, fixture('deals-real-shape.json'))];
  return run(['run', '--dir', dir, ...argv], { env: { HUBSPOT_TOKEN: TOKEN, ...env }, fetch: fakeFetch(routes) });
}
const lookFirstNames = (out) => (out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').split('**Look at these first**')[1]?.split('\n\n')[0] ?? '').split('\n').slice(1).map((l) => l.split(',')[0].slice(2));

test('--large-deal and MONDAY_BRIEF_LARGE_DEAL set the large-deal threshold or turn it off; the flag wins', async () => {
  const cases = [
    [[], {}, ['Larkspur Analytics', 'Copperfield Supply']],
    [['--large-deal', 'off'], {}, ['Copperfield Supply']],
    [[], { MONDAY_BRIEF_LARGE_DEAL: 'off' }, ['Copperfield Supply']],
    [['--large-deal=100K'], {}, ['Copperfield Supply']],
    [['--large-deal', '1K'], { MONDAY_BRIEF_LARGE_DEAL: 'off' }, ['Larkspur Analytics', 'Copperfield Supply', 'Bramblewood Cafe']],
  ];
  for (const [argv, env, names] of cases) {
    const r = await realShapedRun(argv, env);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(lookFirstNames(r.out), names, JSON.stringify([argv, env]));
  }
});

test('a large-deal value that is not an amount is a usage error before HubSpot is called', async () => {
  for (const [argv, env] of [[['--large-deal', 'lots'], {}], [[], { MONDAY_BRIEF_LARGE_DEAL: '50 grand' }], [['--large-deal'], {}]]) {
    const r = await run(['run', ...argv], { env: { HUBSPOT_TOKEN: TOKEN, ...env } });
    assert.equal(r.code, 1, JSON.stringify([argv, env]));
    assert.match(r.err, /large-deal|MONDAY_BRIEF_LARGE_DEAL/i);
    assert.equal(r.fetch.calls.length, 0);
  }
});

test('large-deal amounts read as dollars, with K and M suffixes, a $ sign, commas and off', async () => {
  const { largeDealSetting } = await import('../src/cli.mjs');
  assert.equal(largeDealSetting('50000'), 50000);
  assert.equal(largeDealSetting('50K'), 50000);
  assert.equal(largeDealSetting('$50k'), 50000);
  assert.equal(largeDealSetting('1.5M'), 1500000);
  assert.equal(largeDealSetting('75,000'), 75000);
  assert.equal(largeDealSetting('OFF'), false);
  assert.equal(largeDealSetting(undefined), undefined);
  assert.equal(largeDealSetting(''), undefined);
  assert.throws(() => largeDealSetting('-5'));
});

test('--group-by and MONDAY_BRIEF_GROUP_BY group the brief by owner or pipeline; the flag wins', async () => {
  const cases = [
    [['--group-by', 'owner'], {}, /^## Dana Ruiz, open /m],
    [['--group-by=pipeline'], {}, /^## Sales Pipeline, open /m],
    [[], { MONDAY_BRIEF_GROUP_BY: 'Owner' }, /^## Dana Ruiz, open /m],
    [['--group-by', 'pipeline'], { MONDAY_BRIEF_GROUP_BY: 'owner' }, /^## Sales Pipeline, open /m],
  ];
  for (const [argv, env, heading] of cases) {
    const r = await realShapedRun(argv, env);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, heading, JSON.stringify([argv, env]));
  }
  const flat = await realShapedRun([]);
  assert.doesNotMatch(flat.out, /^## /m);
});

test('a --group-by value other than owner or pipeline is a usage error before HubSpot is called', async () => {
  for (const [argv, env] of [[['--group-by', 'team'], {}], [[], { MONDAY_BRIEF_GROUP_BY: 'region' }]]) {
    const r = await run(['run', ...argv], { env: { HUBSPOT_TOKEN: TOKEN, ...env } });
    assert.equal(r.code, 1);
    assert.match(r.err, /group-by|MONDAY_BRIEF_GROUP_BY/i);
    assert.match(r.err, /owner or pipeline/);
    assert.equal(r.fetch.calls.length, 0);
  }
});

test('demo --group-by owner prints the sample brief grouped by rep', async () => {
  const r = await run(['demo', '--group-by', 'owner']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^## Dana, open /m);
  assert.match(r.out, /^## Leo, open /m);
});

test('after the demo brief, one line on stderr says it was sample data and what to run next', async () => {
  const r = await run(['demo']);
  assert.equal(r.code, 0);
  assert.equal(r.err, 'This was sample data from a made-up HubSpot portal, so its links go nowhere useful. Set HUBSPOT_TOKEN and run `node bin/monday-brief.mjs run --since 7d` for your own pipeline.\n');
  assert.doesNotMatch(r.out, /sample data/);
});

test('demo --dir is a usage error, exit 1, with nothing printed to stdout', async () => {
  for (const argv of [['demo', '--dir', '/tmp/x'], ['demo', '--dir=/tmp/x']]) {
    const r = await run(argv);
    assert.equal(r.code, 1, argv.join(' '));
    assert.equal(r.out, '');
    assert.match(r.err, /^--dir is for run; demo reads bundled sample data\n\nmonday-pipeline-brief/);
  }
});

// Stateless mode: run --since / --as-of.
import { statelessRoutes } from './helpers/fake-hubspot.mjs';

const stateless = (argv, opts = {}) => run(argv, { ...opts, env: { HUBSPOT_TOKEN: TOKEN, ...opts.env }, fetch: opts.fetch ?? fakeFetch(opts.routes ?? statelessRoutes()) });

test('run --since 7d rebuilds last week from history and prints the brief, writing nothing to disk', async () => {
  const home = tmp();
  const cwd = tmp();
  const r = await stateless(['run', '--since', '7d'], { home, cwd });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^# Monday pipeline brief, week of Oct 5\n/);
  assert.match(r.out, /^Compared with HubSpot as of Sep 28, rebuilt from property history\.$/m);
  assert.match(r.out, /\*\*Moved forward\*\* \(1\)\n- \[History deal 7001\]/);
  assert.match(r.out, /\*\*New this week\*\* \(1\)\n- \[History deal 7003\]/);
  assert.match(r.out, /\*\*Removed from HubSpot\*\* \(1\)\n- \[History deal 7004\]/);
  assert.match(r.out, /History deal 7002\]\([^)]*\), \$10K, Dana Ruiz: Nov 1 → Dec 15 \(\+44 days, pushed 2 times\)/);
  assert.deepEqual(readdirSync(home), [], 'no snapshot folder, no run.log');
  assert.deepEqual(readdirSync(cwd), []);
  assert.match(r.err, /stateless/i);
  assert.match(r.err, /no snapshot was saved/i);
});

test('run --since reads the currency settings first, then the history read path', async () => {
  const r = await stateless(['run', '--since', '7d']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.fetch.calls.map((c) => `${c.method} ${c.key}`), [
    'GET /settings/v3/currencies/exchange-rates/current',
    'GET /crm/v3/objects/deals', 'GET /crm/v3/objects/deals?after=h2',
    'GET /crm/v3/objects/deals?archived=true',
    'POST /crm/v3/objects/deals/batch/read?archived=true',
    'GET /crm/v3/pipelines/deals', 'GET /crm/v3/pipelines/deals/default/audit', 'GET /crm/v3/pipelines/deals/renewals/audit',
    'GET /crm/v3/owners', 'GET /crm/v3/owners?archived=true',
  ]);
  assert.deepEqual(r.fetch.calls[4].body.inputs, [{ id: '7004' }], 'only the deal archived after T is batch read');
});

test('run --as-of takes an ISO instant with a zone', async () => {
  const r = await stateless(['run', '--as-of', '2026-09-28T12:00:00Z']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Compared with HubSpot as of Sep 28, rebuilt from property history\.$/m);
});

test('MONDAY_BRIEF_SINCE turns on stateless mode for scheduled jobs; the flag wins', async () => {
  const r = await stateless(['run'], { env: { MONDAY_BRIEF_SINCE: '7d' } });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /rebuilt from property history/);
  const flag = await stateless(['run', '--since', '3d'], { env: { MONDAY_BRIEF_SINCE: '7d' } });
  assert.match(flag.out, /^Compared with HubSpot as of Oct 2, 3 days ago, rebuilt from property history\.$/m);
});

for (const [name, argv, pattern] of [
  ['--since without a day count', ['run', '--since', '7'], /--since needs a number of days from 1 to 90, such as 7d/],
  ['--since 0d', ['run', '--since', '0d'], /--since needs a number of days from 1 to 90/],
  ['--since 91d', ['run', '--since', '91d'], /--since needs a number of days from 1 to 90/],
  ['--as-of with no zone', ['run', '--as-of', '2026-09-28T05:00:00'], /--as-of needs an ISO instant with a time and a zone/],
  ['--as-of a date only', ['run', '--as-of', '2026-09-28'], /--as-of needs an ISO instant with a time and a zone/],
  ['--as-of in the future', ['run', '--as-of', '2026-10-06T00:00:00Z'], /--as-of must be in the past/],
  ['--as-of over 90 days ago', ['run', '--as-of', '2026-06-01T00:00:00Z'], /at most 90 days ago/],
  ['--since and --as-of together', ['run', '--since', '7d', '--as-of', '2026-09-28T05:00:00Z'], /--since or --as-of, not both/],
  ['--dir with --since', ['run', '--since', '7d', '--dir', '/tmp/x'], /--dir is for stored snapshots; stateless mode \(--since or --as-of\) keeps no snapshot folder/],
]) {
  test(`a usage error, exit 1, nothing fetched: ${name}`, async () => {
    const r = await stateless(argv);
    assert.equal(r.code, 1);
    assert.match(r.err, pattern);
    assert.equal(r.fetch.calls.length, 0);
  });
}

test('a portal with more than one currency refuses stateless mode with exit 5, and reads no deal', async () => {
  const routes = statelessRoutes();
  routes['/settings/v3/currencies/exchange-rates/current'] = [() => respond(200, { results: [{ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', conversionRate: '1.08' }] })];
  const r = await stateless(['run', '--since', '7d'], { routes });
  assert.equal(r.code, 5);
  assert.match(r.err, /more than one currency/);
  assert.match(r.err, /without --since or --as-of/);
  assert.equal(r.out, '');
  assert.equal(r.fetch.calls.length, 1);
});

test('a token without settings.currencies.read refuses stateless mode with exit 5, naming the scope', async () => {
  const routes = statelessRoutes();
  routes['/settings/v3/currencies/exchange-rates/current'] = [() => respond(403, fixture('error-403.json'))];
  const r = await stateless(['run', '--since', '7d'], { routes });
  assert.equal(r.code, 5);
  assert.match(r.err, /settings\.currencies\.read/);
  assert.equal(r.fetch.calls.length, 1);
});

test('a HubSpot failure in stateless mode exits 2 and says no brief was written', async () => {
  const routes = statelessRoutes();
  routes['/crm/v3/objects/deals?archived=true'] = [() => respond(401, {})];
  const r = await stateless(['run', '--since', '7d'], { routes });
  assert.equal(r.code, 2);
  assert.match(r.err, /HubSpot rejected the token \(401\)/);
  assert.match(r.err, /No brief was written/);
  assert.equal(r.out, '');
});

test('stateless --out writes the brief there and nothing else', async () => {
  const home = tmp();
  const file = join(tmp(), 'brief.md');
  const r = await stateless(['run', '--since', '7d', '--out', file], { home });
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(file, 'utf8'), r.out);
  assert.deepEqual(readdirSync(home), []);
});

test('stateless mode posts to Slack when SLACK_WEBHOOK_URL is set', async () => {
  const routes = statelessRoutes();
  routes['/services/T000/B000/XXXX'] = [() => respond(200, 'ok')];
  const r = await stateless(['run', '--since', '7d'], { routes, env: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/XXXX' } });
  assert.equal(r.code, 0, r.err);
  const post = r.fetch.calls.find((c) => c.key === '/services/T000/B000/XXXX');
  assert.match(post.body.text, /rebuilt from property history/);
  assert.match(r.err, /Posted the brief to Slack/);
});

test('help documents stateless mode, its scope and exit code 5', async () => {
  const r = await run(['help']);
  assert.match(r.out, /--since 7d/);
  assert.match(r.out, /--as-of/);
  assert.match(r.out, /settings\.currencies\.read/);
  assert.match(r.out, /MONDAY_BRIEF_SINCE/);
});

test('a partial batch read in stateless mode exits 2 and prints no brief', async () => {
  const routes = statelessRoutes();
  routes['/crm/v3/objects/deals/batch/read?archived=true'] = [() => respond(207, { results: [], numErrors: 1, errors: [{ message: 'not found' }] })];
  const r = await stateless(['run', '--since', '7d'], { routes });
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
  assert.match(r.err, /No brief was written/);
});

for (const day of ['2026-09-31', '2026-02-30']) {
  test(`--as-of rejects a calendar date that does not exist: ${day}`, async () => {
    const r = await stateless(['run', '--as-of', `${day}T12:00:00Z`]);
    assert.equal(r.code, 1);
    assert.match(r.err, new RegExp(`--as-of names a date that does not exist \\(${day}\\)`));
    assert.equal(r.fetch.calls.length, 0);
  });
}

test('stateless mode with no --out and no Slack, printing to something other than a terminal, says the brief went nowhere else', async () => {
  const r = await stateless(['run', '--since', '7d']);
  assert.equal(r.code, 0, r.err);
  // m4: true whether stdout is a pipe, a file redirect or /dev/null: the run itself kept nothing.
  assert.match(r.err, /This run kept no copy of the brief of its own \(no --out, no SLACK_WEBHOOK_URL\)\. Unless standard output went to a file, add --out FILE or set SLACK_WEBHOOK_URL to keep it\./);
  assert.doesNotMatch(r.err, /not saved or posted anywhere/);
  const tty = await stateless(['run', '--since', '7d'], { tty: true });
  assert.doesNotMatch(tty.err, /kept no copy/);
  const saved = await stateless(['run', '--since', '7d', '--out', join(tmp(), 'b.md')]);
  assert.doesNotMatch(saved.err, /kept no copy/);
});

test('a failed Slack post in stateless mode never claims the brief was printed above when stdout is not a terminal', async () => {
  const routes = statelessRoutes();
  routes['/services/T000/B000/XXXX'] = [() => respond(500, 'no')];
  const env = { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/XXXX' };
  const r = await stateless(['run', '--since', '7d'], { routes, env });
  assert.equal(r.code, 3);
  assert.doesNotMatch(r.err, /printed above/);
  assert.match(r.err, /Slack post failed \(status 500\)\. This run kept no copy of the brief of its own; unless standard output went to a file, add --out FILE to keep one\./);
  const routes2 = statelessRoutes();
  routes2['/services/T000/B000/XXXX'] = [() => respond(500, 'no')];
  const tty = await stateless(['run', '--since', '7d'], { routes: routes2, env, tty: true });
  assert.match(tty.err, /The brief was printed above\./);
});

test('--dir refused because MONDAY_BRIEF_SINCE turned on stateless mode names that variable', async () => {
  const r = await stateless(['run', '--dir', '/tmp/x'], { env: { MONDAY_BRIEF_SINCE: '7d' } });
  assert.equal(r.code, 1);
  assert.match(r.err, /--dir is for stored snapshots, but MONDAY_BRIEF_SINCE turns on stateless mode, which keeps no snapshot folder\. Unset MONDAY_BRIEF_SINCE to use --dir\./);
});

// F2: every npx command the CLI prints for an npx user (help, the missing-token hint, the demo
// footer) pins this release, so it never runs whatever the repository holds later.
test('every npx command the CLI prints is pinned to this version', async () => {
  const invocation = invocationFor('/home/a/.npm/_npx/abc/node_modules/monday-pipeline-brief/bin/monday-brief.mjs', '/x');
  const texts = [];
  for (const argv of [['help'], ['run'], ['demo'], ['run', '--since', '7d'], ['frobnicate']]) {
    const stdout = capture();
    const stderr = capture();
    await main(argv, { env: {}, stdout, stderr, now: NOW, cwd: tmp(), home: tmp(), invocation });
    texts.push(stdout.text, stderr.text);
  }
  const all = texts.join('\n');
  const commands = [...all.matchAll(/npx (?:--yes )?github:\S+/g)].map((m) => m[0]);
  assert.ok(commands.length >= 5, all);
  for (const c of commands) assert.equal(c, `npx github:derrtaderr/monday-pipeline-brief#v${PKG.version}`);
});

// F6: the Slack cut note names the saved brief in stored mode, and asks for --out in stateless
// mode, where no file exists unless --out was given.
const MANY = 1500;
function slackBody(fetch) {
  const post = fetch.calls.find((c) => c.url.startsWith('https://hooks.slack.com/'));
  return post.body.text;
}
test('a brief cut for Slack names the saved file in stored mode, and asks for --out in stateless mode', async () => {
  const hook = 'https://hooks.slack.com/services/T000/B000/XXXX';
  const deals = Array.from({ length: MANY }, (_, i) => ({ id: String(9000 + i), properties: { dealname: `Deal ${i}`, pipeline: 'default', dealstage: 'appointmentscheduled', amount: '1000', closedate: '2026-12-01', hubspot_owner_id: String(i), hs_next_step: '', notes_last_updated: '2026-10-04', createdate: '2026-09-01' } }));
  const routes = happyRoutes();
  routes['/crm/v3/objects/deals'] = [() => respond(200, { results: deals })];
  routes['/services/T000/B000/XXXX'] = [() => new Response('ok')];
  const dir = tmp();
  const stored = await run(['run', '--dir', dir, '--group-by', 'owner'], { env: { HUBSPOT_TOKEN: TOKEN, SLACK_WEBHOOK_URL: hook }, fetch: fakeFetch(routes) });
  assert.equal(stored.code, 0, stored.err);
  assert.ok(slackBody(stored.fetch).endsWith('_Brief cut short for Slack. The full brief is saved as brief-2026-10-05.md on the machine that ran it._'));
  assert.ok(!slackBody(stored.fetch).includes(dir), 'no local path in Slack');

  const ver = (value) => [{ value, timestamp: '2026-09-01T00:00:00.000Z', sourceType: 'CRM_UI' }];
  const history = deals.map((d) => ({ ...d, createdAt: '2026-09-01T00:00:00.000Z', archived: false, propertiesWithHistory: Object.fromEntries(Object.entries(d.properties).map(([k, v]) => [k, ver(v)])) }));
  const sroutes = statelessRoutes();
  sroutes['/crm/v3/objects/deals'] = [() => respond(200, { results: history })];
  sroutes['/services/T000/B000/XXXX'] = [() => new Response('ok')];
  const sl = await stateless(['run', '--since', '7d', '--group-by', 'owner'], { routes: sroutes, env: { SLACK_WEBHOOK_URL: hook } });
  assert.equal(sl.code, 0, sl.err);
  assert.ok(slackBody(sl.fetch).endsWith('_Brief cut short for Slack. Run with --out FILE for the full brief._'), slackBody(sl.fetch).slice(-200));
  const out = join(tmp(), 'b.md');
  const sroutes2 = { ...sroutes, '/crm/v3/objects/deals': [() => respond(200, { results: history })], '/services/T000/B000/XXXX': [() => new Response('ok')] };
  const saved = await stateless(['run', '--since', '7d', '--group-by', 'owner', '--out', out], { routes: sroutes2, env: { SLACK_WEBHOOK_URL: hook } });
  assert.equal(saved.code, 0, saved.err);
  assert.ok(slackBody(saved.fetch).endsWith('_Brief cut short for Slack. The full brief is saved as b.md on the machine that ran it._'));
});

test('stateless: a pipeline whose change log starts after the comparison date is read from its oldest entry, and the brief says so', async () => {
  const p = fixture('pipelines.json').results.find((x) => x.id === 'default');
  const raw = JSON.stringify({ pipelineId: p.id, label: p.label, stages: p.stages.map((st) => ({ stageId: st.id, label: st.label, displayOrder: st.displayOrder, metadata: st.metadata })) });
  const routes = statelessRoutes();
  routes['/crm/v3/pipelines/deals/default/audit'] = [() => respond(200, { results: [{ action: 'UPDATE', timestamp: '2026-10-01T00:00:00.000Z', rawObject: raw }] })];
  const r = await stateless(['run', '--since', '7d'], { routes });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(`^${p.label}: its change log in HubSpot starts after Sep 28, so its stages on Sep 28 are read from the oldest settings HubSpot kept for it\\.$`, 'm'));
  assert.doesNotMatch(r.out, /Could not rebuild/);
});

// The stateless stderr line names the same comparison date the brief does (the local date of the
// instant), with the exact instant in UTC after it.
test('the stateless stderr line and the brief agree on the comparison date', async () => {
  const r = await stateless(['run', '--since', '7d']);
  assert.equal(r.code, 0, r.err);
  const instant = new Date(NOW.getTime() - 7 * 86400000);
  assert.match(r.out, /as of Sep 28, rebuilt/);
  assert.ok(r.err.includes(`compared with HubSpot as of 2026-09-28, local time (${instant.toISOString()} in UTC)`), r.err);
});
