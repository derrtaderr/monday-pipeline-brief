import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.mjs';
import { writeSnapshot } from '../src/store.mjs';
import { capture } from './helpers/io.mjs';
import { fakeFetch, happyRoutes, respond, statelessRoutes } from './helpers/fake-hubspot.mjs';

// Shaped like a real HubSpot service key or private app token.
const TOKEN = ['pat', 'na1', '8c1f2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f'].join('-');
const HOOK = 'https://hooks.slack.com/services/T000/B000/XXXXSECRETXXXX';
const NOW = new Date(2026, 9, 5, 7, 0, 0);

function allFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? allFiles(p) : [p];
  });
}

// Each scenario with the exit code it must end in, so a path that stops early (and so leaks
// nothing because it did nothing) cannot pass as the path it names.
const scenarios = {
  'first run': [0, () => happyRoutes()],
  'second run': [0, () => happyRoutes()],
  '401': [2, () => ({ ...happyRoutes(), '/crm/v3/objects/deals': [() => respond(401, { message: `bad token ${TOKEN}` })] })],
  '403': [2, () => ({ ...happyRoutes(), '/crm/v3/owners': [() => respond(403, { message: TOKEN })] })],
  '429 forever': [2, () => ({ ...happyRoutes(), '/crm/v3/pipelines/deals': [() => respond(429, { message: TOKEN })] })],
  'network down': [2, () => ({ ...happyRoutes(), '/crm/v3/pipelines/deals': [() => { throw new TypeError(`connect failed ${TOKEN}`); }] })],
  'not json': [2, () => ({ ...happyRoutes(), '/crm/v3/pipelines/deals': [() => new Response(`<html>${TOKEN}</html>`, { status: 200 })] })],
  'unexpected error': [1, () => ({ ...happyRoutes(), '/crm/v3/owners': [() => ({ get ok() { throw new Error(`boom Bearer ${TOKEN} ${HOOK}`); } })] })],
  'slack down': [3, () => ({ ...happyRoutes(), '/services/T000/B000/XXXXSECRETXXXX': [() => respond(500, TOKEN)] })],
};

for (const [name, [expected, routes]] of Object.entries(scenarios)) {
  test(`no token or webhook URL in any output: ${name}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mpb-leak-'));
    if (name === 'second run') writeSnapshot(dir, { schema: 1, date: '2026-09-28', deals: [] });
    const outFile = join(dir, 'out', 'brief.md');
    const stdout = capture();
    const stderr = capture();
    const r = routes();
    r['/services/T000/B000/XXXXSECRETXXXX'] ??= [() => new Response('ok')];
    const code = await main(['run', '--dir', dir, '--out', outFile], {
      env: { HUBSPOT_TOKEN: TOKEN, SLACK_WEBHOOK_URL: HOOK }, fetch: fakeFetch(r), sleep: async () => {}, stdout, stderr, now: NOW, cwd: dir,
    });
    assert.equal(code, expected, stderr.text);
    const texts = [stdout.text, stderr.text, ...allFiles(dir).map((f) => readFileSync(f, 'utf8'))];
    for (const t of texts) {
      assert.ok(!t.includes(TOKEN), `token leaked in ${name}`);
      assert.ok(!t.includes('8c1f2d3e-4a5b'), `token fragment leaked in ${name}`);
      assert.ok(!t.includes('XXXXSECRETXXXX'), `webhook leaked in ${name}`);
    }
  });
}

test('an unexpected error exits 1 with a redacted message', async () => {
  const stderr = capture();
  const r = { ...happyRoutes(), '/crm/v3/owners': [() => ({ get ok() { throw new Error(`boom Bearer ${TOKEN}`); } })] };
  const dir = mkdtempSync(join(tmpdir(), 'mpb-leak-'));
  const code = await main(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN }, fetch: fakeFetch(r), sleep: async () => {}, stdout: capture(), stderr, now: NOW, cwd: dir });
  assert.equal(code, 1);
  assert.match(stderr.text, /Unexpected error: boom Bearer \[redacted\]/);
});

test('a non-JSON HubSpot response is a plain HubSpot error, exit 2', async () => {
  const stderr = capture();
  const r = { ...happyRoutes(), '/crm/v3/pipelines/deals': [() => new Response('<html>', { status: 200 })] };
  const dir = mkdtempSync(join(tmpdir(), 'mpb-leak-'));
  const code = await main(['run', '--dir', dir], { env: { HUBSPOT_TOKEN: TOKEN }, fetch: fakeFetch(r), sleep: async () => {}, stdout: capture(), stderr, now: NOW, cwd: dir });
  assert.equal(code, 2);
  assert.match(stderr.text, /not valid JSON/);
});

const statelessScenarios = {
  'stateless run': [0, () => statelessRoutes()],
  'stateless currency 403': [5, () => ({ ...statelessRoutes(), '/settings/v3/currencies/exchange-rates/current': [() => respond(403, { message: TOKEN })] })],
  'stateless batch read 401': [2, () => ({ ...statelessRoutes(), '/crm/v3/objects/deals/batch/read': [() => respond(401, { message: TOKEN })], '/crm/v3/objects/deals/batch/read?archived=true': [() => respond(401, { message: TOKEN })] })],
  'stateless slack down': [3, () => ({ ...statelessRoutes(), '/services/T000/B000/XXXXSECRETXXXX': [() => respond(500, TOKEN)] })],
};

for (const [name, [expected, routes]] of Object.entries(statelessScenarios)) {
  test(`no token or webhook URL in any output: ${name}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mpb-leak-'));
    const outFile = join(dir, 'out', 'brief.md');
    const stdout = capture();
    const stderr = capture();
    const r = routes();
    r['/services/T000/B000/XXXXSECRETXXXX'] ??= [() => new Response('ok')];
    const code = await main(['run', '--since', '7d', '--out', outFile], {
      env: { HUBSPOT_TOKEN: TOKEN, SLACK_WEBHOOK_URL: HOOK }, fetch: fakeFetch(r), sleep: async () => {}, stdout, stderr, now: NOW, cwd: dir, home: dir,
    });
    assert.equal(code, expected, stderr.text);
    const texts = [stdout.text, stderr.text, ...allFiles(dir).map((f) => readFileSync(f, 'utf8'))];
    for (const t of texts) {
      assert.ok(!t.includes(TOKEN), `token leaked in ${name}`);
      assert.ok(!t.includes('8c1f2d3e-4a5b'), `token fragment leaked in ${name}`);
      assert.ok(!t.includes('XXXXSECRETXXXX'), `webhook leaked in ${name}`);
    }
  });
}
