// Minimal HubSpot CRM v3 client: deals, deal pipelines, owners.
// The token lives only in the Authorization header. Error messages are built from status
// codes and endpoint paths, never from request headers or response bodies.

const BASE = 'https://api.hubapi.com';
const MAX_RETRIES = 5;
const MAX_WAIT_SECONDS = 60;
export const DEAL_PROPERTIES = [
  'dealname', 'amount', 'amount_in_home_currency', 'closedate', 'dealstage', 'pipeline', 'hubspot_owner_id', 'hs_next_step', 'notes_last_updated', 'createdate',
];

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
  async function get(path, params = {}) {
    if (!validToken(token)) throw new HubSpotError(BAD_TOKEN_MESSAGE);
    const url = new URL(path, baseUrl);
    // Built outside the retry loop: a header that cannot be sent is not a network failure.
    let headers;
    try {
      headers = new Headers({ authorization: `Bearer ${token}`, accept: 'application/json' });
    } catch {
      throw new HubSpotError(BAD_TOKEN_MESSAGE);
    }
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, { method: 'GET', headers });
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
  };
}
