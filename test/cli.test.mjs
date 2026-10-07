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

async function run(argv, opts = {}) {
  const stdout = capture();
  const stderr = capture();
  const fetch = opts.fetch ?? fakeFetch(happyRoutes());
  const code = await main(argv, { env: opts.env ?? {}, fetch, sleep: async () => {}, stdout, stderr, now: opts.now ?? NOW, cwd: opts.cwd ?? tmp(), home: opts.home ?? tmp() });
  return { code, out: stdout.text, err: stderr.text, fetch };
}

test('demo prints the sample brief with no token', async () => {
  const r = await run(['demo']);
  assert.equal(r.code, 0);
  assert.match(r.out, /^# Monday pipeline brief, week of Oct 5\n/);
  assert.match(r.out, /Open pipeline \$1\.25M across 21 deals/);
  assert.equal(r.fetch.calls.length, 0);
});

test('demo --out also writes the brief to a file', async () => {
  const file = join(tmp(), 'brief.md');
  const r = await run(['demo', '--out', file]);
  assert.equal(r.code, 0);
  assert.equal(readFileSync(file, 'utf8'), r.out);
  assert.equal(r.err, `Saved the demo brief to ${file}\n`);
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
  assert.match(r.out, /HUBSPOT_TOKEN\s+HubSpot service key or private app token \(scopes crm\.objects\.deals\.read, crm\.objects\.owners\.read\)/);
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
  const section = (title) => r.out.split(`**${title}**`)[1]?.split('\n\n')[0] ?? '';
  assert.deepEqual(section('No next step, or no activity in 14+ days').split('\n').slice(1), [
    '- Larkspur Analytics, $60K, Dana Ruiz: no next step',
    '- Copperfield Supply, $42K, Leo: no activity logged since it was created Sep 20',
    '- Bramblewood Cafe, $1K, Unassigned: no next step',
  ]);
  assert.deepEqual(section('Look at these first').split('\n').slice(1), [
    '- Copperfield Supply, $42K, Leo: close date slipped, no activity in 14+ days',
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
  assert.equal(invocationFor('/home/a/.npm/_npx/abc/node_modules/monday-pipeline-brief/bin/monday-brief.mjs', '/x'), 'npx github:derrtaderr/monday-pipeline-brief');
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
  assert.match(r.err, /Warning: 1 deal \(\$1K\) is in a stage we couldn't read/);
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
