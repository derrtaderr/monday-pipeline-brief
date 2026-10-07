import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.mjs';
import { capture } from './helpers/io.mjs';
import { fakeFetch, happyRoutes, respond } from './helpers/fake-hubspot.mjs';

const TOKEN = ['pat', 'na1', '11111111-2222-3333-4444-555555555555'].join('-');
const HOOK = 'https://hooks.slack.com/services/T000/B000/XXXXSECRETXXXX';
const NOW = new Date(2026, 9, 5, 7, 0, 0);

async function run(slackResponse) {
  const routes = happyRoutes();
  routes['/services/T000/B000/XXXXSECRETXXXX'] = [slackResponse];
  const fetch = fakeFetch(routes);
  const stdout = capture();
  const stderr = capture();
  const dir = mkdtempSync(join(tmpdir(), 'mpb-slack-'));
  const code = await main(['run', '--dir', dir], {
    env: { HUBSPOT_TOKEN: TOKEN, SLACK_WEBHOOK_URL: HOOK }, fetch, sleep: async () => {}, stdout, stderr, now: NOW, cwd: dir,
  });
  return { code, fetch, out: stdout.text, err: stderr.text, dir };
}

test('with SLACK_WEBHOOK_URL set, run posts the brief as Slack mrkdwn', async () => {
  const r = await run(() => new Response('ok', { status: 200 }));
  assert.equal(r.code, 0, r.err);
  const post = r.fetch.calls.find((c) => c.method === 'POST');
  assert.equal(post.url, HOOK);
  assert.equal(post.headers['content-type'], 'application/json');
  assert.ok(!('authorization' in post.headers), 'the HubSpot token must never go to Slack');
  assert.match(r.err, /Posted the brief to Slack/);
});

test('the Slack payload is the mrkdwn version of the brief', async () => {
  let body;
  const routes = happyRoutes();
  routes['/services/T000/B000/XXXXSECRETXXXX'] = [() => new Response('ok', { status: 200 })];
  const inner = fakeFetch(routes);
  const fetch = async (url, init) => { if (init?.method === 'POST') body = JSON.parse(init.body); return inner(url, init); };
  const dir = mkdtempSync(join(tmpdir(), 'mpb-slack-'));
  await main(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN, SLACK_WEBHOOK_URL: HOOK }, fetch, sleep: async () => {}, stdout: capture(), stderr: capture(), now: NOW, cwd: dir });
  assert.match(body.text, /^\*Monday pipeline brief, week of Oct 5\*/);
  assert.ok(!body.text.includes('**'));
});

test('a failed Slack post exits 3, keeps the brief on disk, and never echoes the webhook URL', async () => {
  const r = await run(() => respond(404, 'no_service'));
  assert.equal(r.code, 3);
  assert.ok(existsSync(join(r.dir, 'brief-2026-10-05.md')));
  assert.match(r.err, /Slack post failed \(status 404\)/);
  assert.match(r.err, /brief is saved/);
  assert.ok(!r.err.includes(HOOK) && !r.err.includes('XXXXSECRETXXXX'));
});

test('an unreachable Slack webhook is reported the same way', async () => {
  const r = await run(() => { throw new TypeError(`fetch failed for ${HOOK}`); });
  assert.equal(r.code, 3);
  assert.match(r.err, /Slack post failed \(could not connect\)/);
  assert.ok(!r.err.includes('XXXXSECRETXXXX'));
});

test('Slack text is capped under 35,000 characters on a line boundary with a note', async () => {
  const { slackText } = await import('../src/slack.mjs');
  const long = Array.from({ length: 2000 }, (_, i) => `- Deal ${i}, $1K, Dana: no next step`).join('\n');
  const text = slackText(long);
  assert.ok(text.length <= 35000, `got ${text.length}`);
  assert.match(text, /• Deal \d+, \$1K, Dana: no next step\n_Brief cut short for Slack\. The full brief is in the saved file\._$/);
  assert.equal(slackText('- short'), '• short');
});

test('the Slack text carries the honest comparison wording and the skipped file', async () => {
  const { slackText } = await import('../src/slack.mjs');
  const { compare } = await import('../src/compare.mjs');
  const { renderBrief } = await import('../src/render.mjs');
  const d = { id: 'a', name: 'A', owner: 'Dana', pipeline_id: 'p', stage_order: 1, status: 'open', amount: 39000, close_date: null, next_step: 'x', last_activity: '2026-10-04' };
  const md = renderBrief(compare({ date: '2026-09-21', deals: [] }, { date: '2026-10-05', deals: [d] }, '2026-10-05'), { skipped: [{ file: 'snapshot-2026-09-28.json', reason: 'not valid JSON' }] });
  const text = slackText(md);
  assert.match(text, /Skipped unreadable snapshot-2026-09-28\.json/);
  assert.match(text, /Compared with the snapshot from Sep 21, 2 weeks ago\./);
  assert.match(text, /up \$39K since Sep 21\./);
  assert.doesNotMatch(text, /last week/);
});

const BAD_HOOKS = {
  'the README placeholder': 'https://hooks.slack.com/services/...',
  'a placeholder with a single-character ellipsis': 'https://hooks.slack.com/services/T000/B000/…',
  'a URL that is not a Slack incoming webhook': 'https://example.com/services/T000/B000/XXXXSECRETXXXX',
  'plain http': 'http://hooks.slack.com/services/T000/B000/XXXXSECRETXXXX',
};

for (const [name, hook] of Object.entries(BAD_HOOKS)) {
  test(`SLACK_WEBHOOK_URL set to ${name} is a named setup error, exit 1, before HubSpot is called, URL never printed`, async () => {
    const fetch = fakeFetch(happyRoutes());
    const stdout = capture();
    const stderr = capture();
    const dir = mkdtempSync(join(tmpdir(), 'mpb-slack-'));
    const code = await main(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN, SLACK_WEBHOOK_URL: hook }, fetch, sleep: async () => {}, stdout, stderr, now: NOW, cwd: dir });
    assert.equal(code, 1);
    assert.equal(fetch.calls.length, 0, 'nothing is fetched');
    assert.match(stderr.text, /SLACK_WEBHOOK_URL is not a Slack incoming webhook URL/);
    assert.match(stderr.text, /Nothing was fetched from HubSpot/);
    assert.ok(!existsSync(join(dir, 'brief-2026-10-05.md')));
    const runLog = readFileSync(join(dir, 'run.log'), 'utf8');
    for (const t of [stdout.text, stderr.text, runLog]) {
      assert.ok(!t.includes(hook) && !t.includes('XXXXSECRETXXXX') && !t.includes('example.com'), 'the URL is never printed');
    }
  });
}
