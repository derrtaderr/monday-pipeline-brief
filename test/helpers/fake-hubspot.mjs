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
    calls.push({ url: String(url), key, headers: init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers ?? {}, method: init.method ?? 'GET' });
    const queue = routes[key];
    if (!queue || !queue.length) throw new Error(`no recorded response for ${key}`);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next();
  };
  fn.calls = calls;
  return fn;
}
