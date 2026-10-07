import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHubSpotClient, HubSpotError } from '../src/hubspot.mjs';
import { fakeFetch, happyRoutes, respond, fixture } from './helpers/fake-hubspot.mjs';

const TOKEN = ['pat', 'na1', '11111111-2222-3333-4444-555555555555'].join('-');

function client(routes, sleeps = []) {
  const fetch = fakeFetch(routes);
  const c = createHubSpotClient({ token: TOKEN, fetch, sleep: async (ms) => { sleeps.push(ms); } });
  return { c, fetch, sleeps };
}

test('listDeals follows paging.next.after until the last page', async () => {
  const { c, fetch } = client(happyRoutes());
  const deals = await c.listDeals();
  assert.deepEqual(deals.map((d) => d.id), ['5001', '5002', '5003', '5004', '5005', '5006']);
  assert.deepEqual(fetch.calls.map((x) => x.key), ['/crm/v3/objects/deals', '/crm/v3/objects/deals?after=5002']);
});

test('listDeals asks for 100 per page and exactly the properties the brief uses', async () => {
  const { c, fetch } = client(happyRoutes());
  await c.listDeals();
  const u = new URL(fetch.calls[0].url);
  assert.equal(u.origin, 'https://api.hubapi.com');
  assert.equal(u.searchParams.get('limit'), '100');
  assert.deepEqual(u.searchParams.get('properties').split(',').sort(), [
    'amount', 'amount_in_home_currency', 'closedate', 'dealname', 'dealstage', 'hs_next_step', 'hubspot_owner_id', 'notes_last_updated', 'pipeline',
  ]);
});

test('the token goes in the Authorization header and never in a URL', async () => {
  const { c, fetch } = client(happyRoutes());
  await c.listDeals();
  await c.listPipelines();
  await c.listOwners();
  for (const call of fetch.calls) {
    assert.equal(call.headers.authorization, `Bearer ${TOKEN}`);
    assert.ok(!call.url.includes(TOKEN));
  }
});

test('listPipelines returns pipelines with stages', async () => {
  const { c } = client(happyRoutes());
  const pipelines = await c.listPipelines();
  assert.deepEqual(pipelines.map((p) => p.id), ['default', 'renewals']);
});

test('listOwners includes archived owners so former reps still resolve', async () => {
  const { c } = client(happyRoutes());
  const owners = await c.listOwners();
  assert.deepEqual(owners.map((o) => o.id), ['101', '102', '103', '199']);
});

test('a 429 waits for Retry-After seconds, then retries', async () => {
  const routes = happyRoutes();
  routes['/crm/v3/pipelines/deals'] = [
    () => respond(429, fixture('error-429.json'), { 'retry-after': '3' }),
    () => respond(200, fixture('pipelines.json')),
  ];
  const { c, sleeps } = client(routes);
  const pipelines = await c.listPipelines();
  assert.equal(pipelines.length, 2);
  assert.deepEqual(sleeps, [3000]);
});

test('a 429 without Retry-After backs off exponentially', async () => {
  const routes = happyRoutes();
  routes['/crm/v3/pipelines/deals'] = [
    () => respond(429, {}), () => respond(429, {}), () => respond(200, fixture('pipelines.json')),
  ];
  const { c, sleeps } = client(routes);
  await c.listPipelines();
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('a 5xx is retried the same way', async () => {
  const routes = happyRoutes();
  routes['/crm/v3/owners'] = [() => respond(502, {}), () => respond(200, fixture('owners.json'))];
  const { c, sleeps } = client(routes);
  await c.listOwners();
  assert.deepEqual(sleeps, [1000]);
});

test('rate limiting that never clears gives up after 5 retries with a plain error', async () => {
  const routes = happyRoutes();
  routes['/crm/v3/pipelines/deals'] = [() => respond(429, fixture('error-429.json'))];
  const { c, sleeps, fetch } = client(routes);
  await assert.rejects(c.listPipelines(), (err) => {
    assert.ok(err instanceof HubSpotError);
    assert.equal(err.status, 429);
    assert.match(err.message, /rate limit/i);
    assert.ok(!err.message.includes(TOKEN));
    return true;
  });
  assert.equal(fetch.calls.length, 6);
  assert.deepEqual(sleeps, [1000, 2000, 4000, 8000, 16000]);
});

test('a 401 fails at once with a message about the token, without the token', async () => {
  const routes = happyRoutes();
  routes['/crm/v3/objects/deals'] = [() => respond(401, { message: `Authentication credentials not found ${TOKEN}` })];
  const { c, fetch } = client(routes);
  await assert.rejects(c.listDeals(), (err) => {
    assert.equal(err.status, 401);
    assert.match(err.message, /HUBSPOT_TOKEN/);
    assert.ok(!err.message.includes(TOKEN));
    return true;
  });
  assert.equal(fetch.calls.length, 1);
});

test('a 403 names the scopes the private app needs', async () => {
  const routes = happyRoutes();
  routes['/crm/v3/owners'] = [() => respond(403, fixture('error-403.json'))];
  const { c } = client(routes);
  await assert.rejects(c.listOwners(), /crm\.objects\.owners\.read/);
});

test('a network failure becomes a plain HubSpotError', async () => {
  const c = createHubSpotClient({ token: TOKEN, fetch: async () => { throw new TypeError('fetch failed'); }, sleep: async () => {} });
  await assert.rejects(c.listPipelines(), (err) => err instanceof HubSpotError && /could not reach HubSpot/i.test(err.message));
});

test('a Retry-After over 60 seconds fails cleanly instead of sleeping', async () => {
  const routes = happyRoutes();
  routes['/crm/v3/pipelines/deals'] = [() => respond(429, {}, { 'retry-after': '3600' }), () => respond(200, fixture('pipelines.json'))];
  const { c, sleeps } = client(routes);
  await assert.rejects(c.listPipelines(), (err) => {
    assert.equal(err.status, 429);
    assert.match(err.message, /asked to wait 3600 seconds/);
    return true;
  });
  assert.deepEqual(sleeps, []);
});

for (const [name, bad] of [
  ['smart quotes', `“${TOKEN}”`],
  ['a non-ASCII letter', `${TOKEN}é`],
  ['an inner space', 'pat-na1 11111111'],
  ['straight quotes', `"${TOKEN}"`],
]) {
  test(`a token with ${name} fails at once, is never sent, and is never retried`, async () => {
    const sleeps = [];
    const fetch = fakeFetch(happyRoutes());
    const c = createHubSpotClient({ token: bad, fetch, sleep: async (ms) => { sleeps.push(ms); } });
    await assert.rejects(c.listDeals(), (err) => {
      assert.ok(err instanceof HubSpotError);
      assert.match(err.message, /HUBSPOT_TOKEN/);
      assert.doesNotMatch(err.message, /could not reach/i);
      assert.ok(!err.message.includes(TOKEN) && !err.message.includes('11111111'));
      return true;
    });
    assert.equal(fetch.calls.length, 0);
    assert.deepEqual(sleeps, []);
  });
}

test('validToken accepts a real-shaped private app token', async () => {
  const { validToken } = await import('../src/hubspot.mjs');
  assert.equal(validToken(TOKEN), true);
  assert.equal(validToken('“pat”'), false);
});

test('the bad-token hint says to paste the raw token with no quotes inside the value', async () => {
  const { BAD_TOKEN_MESSAGE } = await import('../src/hubspot.mjs');
  assert.match(BAD_TOKEN_MESSAGE, /paste the raw token/i);
  assert.match(BAD_TOKEN_MESSAGE, /no quotes inside the value/);
  assert.doesNotMatch(BAD_TOKEN_MESSAGE, /plain straight quotes/);
});
