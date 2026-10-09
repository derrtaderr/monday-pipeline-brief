// Minimal HubSpot CRM v3 client: deals, deal pipelines, owners, and for stateless mode deal
// property history, pipeline audits and the portal's exchange rates.
// The token lives only in the Authorization header. Error messages are built from status
// codes and endpoint paths, never from request headers or response bodies.

const BASE = 'https://api.hubapi.com';
const MAX_RETRIES = 5;
const MAX_WAIT_SECONDS = 60;
export const DEAL_PROPERTIES = [
  'dealname', 'amount', 'amount_in_home_currency', 'closedate', 'dealstage', 'pipeline', 'hubspot_owner_id', 'hs_next_step', 'notes_last_updated', 'createdate',
];
// Stateless mode also reads which records a deal absorbed in a merge (no history needed).
export const HISTORY_READ_PROPERTIES = [...DEAL_PROPERTIES, 'hs_merged_object_ids'];
// HubSpot caps a page, or a batch read, at 50 records when property history is requested.
export const HISTORY_PAGE = 50;
export const CURRENCY_SCOPE = 'settings.currencies.read';

export class HubSpotError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'HubSpotError';
    this.status = status;
  }
}

function errorFor(status, path) {
  if (status === 401) {
    return new HubSpotError('HubSpot rejected the token (401). Check that HUBSPOT_TOKEN holds a current HubSpot service key or private app token for this portal.', 401);
  }
  if (status === 403) {
    return new HubSpotError(`HubSpot refused ${path} (403). The HubSpot service key or private app needs the crm.objects.deals.read and crm.objects.owners.read scopes.`, 403);
  }
  if (status === 429) return new HubSpotError(`HubSpot kept rate limiting ${path} (429) after ${MAX_RETRIES} retries. Try again in a few minutes.`, 429);
  return new HubSpotError(`HubSpot request to ${path} failed with status ${status}.`, status);
}

const retryable = (status) => status === 429 || status >= 500;

// A HubSpot service key or private app token (pat-<region>-..., any region) is printable ASCII
// with no spaces or quotes. Anything else (smart quotes, a stray space, a non-ASCII letter,
// usually from copying out of a document) can never be sent as a header, so it is rejected
// before any request.
export function validToken(token) {
  return typeof token === 'string' && /^[\x21-\x7e]+$/.test(token) && !/["'`]/.test(token);
}

export const BAD_TOKEN_MESSAGE = 'HUBSPOT_TOKEN has characters a HubSpot token never has (smart quotes, spaces or non-ASCII letters, usually from copying it out of a document or chat). Copy the token again from the service key (or private app) page in HubSpot and paste the raw token, with no quotes inside the value (export HUBSPOT_TOKEN=pat-... is fine).';

export function createHubSpotClient({ token, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), baseUrl = BASE }) {
  // body: a JSON request body (POST). notFound: the value a 404 returns instead of failing.
  async function request(method, path, params = {}, { body, notFound } = {}) {
    if (!validToken(token)) throw new HubSpotError(BAD_TOKEN_MESSAGE);
    const url = new URL(path, baseUrl);
    // Built outside the retry loop: a header that cannot be sent is not a network failure.
    let headers;
    try {
      headers = new Headers({ authorization: `Bearer ${token}`, accept: 'application/json' });
      if (body) headers.set('content-type', 'application/json');
    } catch {
      throw new HubSpotError(BAD_TOKEN_MESSAGE);
    }
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      } catch {
        if (attempt < MAX_RETRIES) { await sleep(1000 * 2 ** attempt); continue; }
        throw new HubSpotError(`Could not reach HubSpot at ${path}. Check the network connection.`);
      }
      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throw new HubSpotError(`HubSpot's response from ${path} was not valid JSON (status ${res.status}).`, res.status);
        }
      }
      if (res.status === 404 && notFound !== undefined) return notFound;
      if (retryable(res.status) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        if (retryAfter > MAX_WAIT_SECONDS) {
          throw new HubSpotError(`HubSpot rate limited ${path} and asked to wait ${retryAfter} seconds. Try again later.`, res.status);
        }
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw errorFor(res.status, path);
    }
  }

  const get = (path, params) => request('GET', path, params);

  async function listAll(path, params = {}) {
    const out = [];
    let after;
    do {
      const page = await get(path, { limit: '100', ...params, after });
      out.push(...(page.results ?? []));
      after = page.paging?.next?.after;
    } while (after);
    return out;
  }

  return {
    listDeals: () => listAll('/crm/v3/objects/deals', { properties: DEAL_PROPERTIES.join(',') }),
    listPipelines: async () => (await get('/crm/v3/pipelines/deals')).results ?? [],
    listOwners: async () => [
      ...(await listAll('/crm/v3/owners')),
      ...(await listAll('/crm/v3/owners', { archived: 'true' })),
    ],
    // Live deals with full property history, 50 per page.
    listDealsWithHistory: () => listAll('/crm/v3/objects/deals', {
      limit: String(HISTORY_PAGE), properties: HISTORY_READ_PROPERTIES.join(','), propertiesWithHistory: DEAL_PROPERTIES.join(','),
    }),
    // The recycle bin, without history: the archived list returns at most one version per
    // property, so history is read through readArchivedWithHistory instead. Each record carries archivedAt.
    listArchivedDeals: () => listAll('/crm/v3/objects/deals', { archived: 'true', properties: 'createdate' }),
    readArchivedWithHistory: async (ids) => {
      if (ids.length > HISTORY_PAGE) throw new Error(`a history batch read takes at most ${HISTORY_PAGE} ids (got ${ids.length})`);
      const res = await request('POST', '/crm/v3/objects/deals/batch/read', { archived: 'true' }, {
        body: { inputs: ids.map((id) => ({ id: String(id) })), properties: HISTORY_READ_PROPERTIES, propertiesWithHistory: DEAL_PROPERTIES },
      });
      // A partial read (207 with errors, or fewer records than asked) is never used: a deal
      // missing here would silently drop out of last week's pipeline.
      const results = res.results ?? [];
      if ((res.errors?.length ?? 0) > 0 || Number(res.numErrors) > 0 || results.length !== ids.length) {
        throw new HubSpotError(`HubSpot's batch read of archived deals returned ${results.length} of ${ids.length} deals${res.errors?.length ? ` with ${res.errors.length} errors` : ''}. A partial read is never used; try again later.`, 207);
      }
      return results;
    },
    // Every change to one pipeline, newest first. A pipeline with no audit (a 404) reads as none.
    pipelineAudit: async (id) => (await request('GET', `/crm/v3/pipelines/deals/${encodeURIComponent(id)}/audit`, {}, { notFound: { results: [] } })).results ?? [],
    listExchangeRates: async () => {
      try {
        return (await get('/settings/v3/currencies/exchange-rates/current')).results ?? [];
      } catch (err) {
        if (err instanceof HubSpotError && err.status === 403) {
          throw new HubSpotError(`HubSpot refused the currency settings (403). Stateless mode needs the ${CURRENCY_SCOPE} scope to check that the portal uses one currency; add it to the service key or private app, or run without --since for stored snapshots.`, 403);
        }
        throw err;
      }
    },
  };
}
