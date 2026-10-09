// A recorded-response stand-in for fetch. Routes are matched on pathname and the `after` /
// `archived` query params; each route can hold a queue of responses (for 429 then 200).
import { readFileSync } from 'node:fs';

export const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/hubspot/${name}`, import.meta.url), 'utf8'));

export function respond(status, body, headers = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function happyRoutes() {
  return {
    '/crm/v3/objects/deals': [() => respond(200, fixture('deals-page1.json'))],
    '/crm/v3/objects/deals?after=5002': [() => respond(200, fixture('deals-page2.json'))],
    '/crm/v3/pipelines/deals': [() => respond(200, fixture('pipelines.json'))],
    '/crm/v3/owners': [() => respond(200, fixture('owners.json'))],
    '/crm/v3/owners?archived=true': [() => respond(200, fixture('owners-archived.json'))],
  };
}

export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    const keyParams = ['after', 'archived'].filter((k) => u.searchParams.has(k)).map((k) => `${k}=${u.searchParams.get(k)}`);
    const key = u.pathname + (keyParams.length ? `?${keyParams.join('&')}` : '');
    calls.push({ url: String(url), key, headers: init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers ?? {}, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    const queue = routes[key];
    if (!queue || !queue.length) throw new Error(`no recorded response for ${key}`);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next();
  };
  fn.calls = calls;
  return fn;
}

// Stateless mode: a small portal with property history. T for `run --since 7d` on the CLI tests'
// NOW (local Oct 5 2026, 07:00) is local Sep 28, 07:00; BEFORE is well before it, AFTER after it.
const BEFORE = '2026-09-20T00:00:00.000Z';
const AFTER = '2026-10-02T12:00:00.000Z';
const ver = (value, timestamp) => ({ value, timestamp, sourceType: 'CRM_UI' });
function historyDeal(id, history, extra = {}) {
  const h = {
    dealname: [ver(`History deal ${id}`, BEFORE)], createdate: [ver(BEFORE, BEFORE)], pipeline: [ver('default', BEFORE)],
    dealstage: [ver('appointmentscheduled', BEFORE)], amount: [ver('10000', BEFORE)], closedate: [ver('2026-11-01T00:00:00.000Z', BEFORE)],
    hubspot_owner_id: [ver('101', BEFORE)], hs_next_step: [ver('call', BEFORE)], notes_last_updated: [ver('2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')],
    ...history,
  };
  return {
    id, createdAt: BEFORE, url: `https://app.hubspot.com/contacts/1/record/0-3/${id}`, archived: false,
    properties: Object.fromEntries(Object.entries(h).map(([k, vs]) => [k, vs[0]?.value ?? null])),
    propertiesWithHistory: h, ...extra,
  };
}
export function statelessRoutes() {
  return {
    '/settings/v3/currencies/exchange-rates/current': [() => respond(200, { results: [] })],
    '/crm/v3/objects/deals': [() => respond(200, { results: [
      historyDeal('7001', { dealstage: [ver('qualifiedtobuy', AFTER), ver('appointmentscheduled', BEFORE)] }),
      historyDeal('7002', { closedate: [ver('2026-12-15T00:00:00.000Z', '2026-10-03T00:00:00.000Z'), ver('2026-11-20T00:00:00.000Z', AFTER), ver('2026-11-01T00:00:00.000Z', BEFORE)] }),
    ], paging: { next: { after: 'h2' } } })],
    '/crm/v3/objects/deals?after=h2': [() => respond(200, { results: [
      historyDeal('7003', { createdate: [ver(AFTER, AFTER)], dealstage: [ver('appointmentscheduled', AFTER)], amount: [ver('5000', AFTER)] }, { createdAt: AFTER }),
    ] })],
    '/crm/v3/objects/deals?archived=true': [() => respond(200, { results: [
      { id: '7004', archived: true, archivedAt: AFTER, properties: { createdate: BEFORE } },
      { id: '6999', archived: true, archivedAt: '2026-09-01T00:00:00.000Z', properties: { createdate: BEFORE } },
    ] })],
    '/crm/v3/objects/deals/batch/read?archived=true': [() => respond(200, { results: [
      historyDeal('7004', { amount: [ver('8000', BEFORE)] }, { archived: true, archivedAt: AFTER }),
    ] })],
    '/crm/v3/pipelines/deals': [() => respond(200, fixture('pipelines.json'))],
    '/crm/v3/pipelines/deals/default/audit': [() => respond(200, { results: [] })],
    '/crm/v3/pipelines/deals/renewals/audit': [() => respond(404, { message: 'not found' })],
    '/crm/v3/owners': [() => respond(200, fixture('owners.json'))],
    '/crm/v3/owners?archived=true': [() => respond(200, fixture('owners-archived.json'))],
  };
}
