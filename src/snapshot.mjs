// Turn raw HubSpot API records into a schema-1 snapshot.
// Only the documented fields are copied, so nothing else from the API (or the request) can leak in.

export const SCHEMA = 1;

function isoDay(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);
  if (/^\d+$/.test(s)) return new Date(Number(s)).toISOString().slice(0, 10);
  return s.slice(0, 10);
}

// Multi-currency portals: amount_in_home_currency is the deal converted to the company
// currency. Use it when HubSpot returns it; otherwise fall back to amount.
function dealAmount(p) {
  const home = p.amount_in_home_currency;
  if (home !== null && home !== undefined && home !== '' && Number.isFinite(Number(home))) return Number(home);
  return Number(p.amount) || 0;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ownerName(o) {
  const full = `${o.firstName ?? ''} ${o.lastName ?? ''}`.trim();
  return full || o.email || `Owner ${o.id}`;
}

// Each owner id's display name. Two owners (two ids) with one name are told apart the way two
// pipelines with one label are: by email when that tells them apart, else by owner id.
function ownerLabels(owners) {
  const byId = new Map();
  for (const o of owners) if (!byId.has(String(o.id))) byId.set(String(o.id), o);
  const named = new Map();
  for (const [id, o] of byId) {
    const name = ownerName(o);
    if (!named.has(name)) named.set(name, []);
    named.get(name).push(id);
  }
  const labels = new Map();
  for (const [name, ids] of named) {
    for (const id of ids) {
      const email = byId.get(id).email;
      const unique = email && ids.filter((x) => byId.get(x).email === email).length === 1;
      labels.set(id, ids.length === 1 ? name : `${name} (${unique ? email : `owner ${id}`})`);
    }
  }
  return labels;
}

// isClosed decides open or closed when HubSpot sends it ("true"/"false" or a boolean), and
// probability then decides won (1) or lost (anything else). HubSpot's published API spec does
// not document isClosed, so when it is missing the status falls back to probability alone:
// exactly 1 is won, exactly 0 is lost, anything else (or no probability) is open.
function stageStatus(metadata = {}) {
  const raw = metadata.probability;
  const probability = raw === null || raw === undefined || String(raw).trim() === '' ? NaN : Number(raw);
  if (metadata.isClosed === undefined || metadata.isClosed === null) {
    if (probability === 1) return 'won';
    if (probability === 0) return 'lost';
    return 'open';
  }
  if (String(metadata.isClosed) !== 'true') return 'open';
  return probability === 1 ? 'won' : 'lost';
}

export function buildSnapshot({ deals, pipelines, owners, takenAt, date, source = 'hubspot' }) {
  const stages = new Map();
  const pipelineLabels = new Map();
  for (const p of pipelines) {
    pipelineLabels.set(p.id, p.label);
    for (const s of p.stages ?? []) {
      stages.set(`${p.id}/${s.id}`, { label: s.label, order: s.displayOrder, status: stageStatus(s.metadata) });
    }
  }
  const ownerNames = ownerLabels(owners);
  // Paging can return a deal twice when deals change mid-listing. Keep the first copy.
  const seen = new Set();
  const unique = deals.filter((d) => !seen.has(String(d.id)) && seen.add(String(d.id)));

  return {
    schema: SCHEMA,
    taken_at: takenAt.toISOString(),
    date,
    source,
    // The full stage layout at snapshot time, so a later brief can judge stage moves in the
    // pipeline order that was current, even for stages no deal sits in.
    pipelines: pipelines.map((p) => ({
      id: p.id,
      label: p.label,
      stages: [...(p.stages ?? [])]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((s) => ({ id: s.id, label: s.label, order: s.displayOrder, status: stageStatus(s.metadata) })),
    })),
    deals: unique.map((d) => {
      const p = d.properties ?? {};
      const stage = stages.get(`${p.pipeline}/${p.dealstage}`);
      const ownerId = p.hubspot_owner_id ? String(p.hubspot_owner_id) : null;
      return {
        id: String(d.id),
        name: p.dealname ?? `Deal ${d.id}`,
        owner: ownerId ? ownerNames.get(ownerId) ?? `Owner ${ownerId}` : 'Unassigned',
        owner_id: ownerId,
        pipeline_id: p.pipeline ?? null,
        pipeline: pipelineLabels.get(p.pipeline) ?? p.pipeline ?? null,
        stage_id: p.dealstage ?? null,
        stage: stage?.label ?? p.dealstage ?? null,
        stage_order: stage?.order ?? null,
        status: stage?.status ?? 'open',
        amount: dealAmount(p),
        // The deal's own currency and its amount in it, so a brief can tell an exchange-rate move
        // of the home-currency amount from a real change. Null when HubSpot does not return them.
        deal_currency: p.deal_currency_code || null,
        deal_currency_amount: numberOrNull(p.amount),
        close_date: isoDay(p.closedate),
        next_step: (p.hs_next_step ?? '').trim(),
        last_activity: isoDay(p.notes_last_updated),
        // The createdate property, else the record's createdAt (required by HubSpot's spec).
        created: isoDay(p.createdate ?? d.createdAt),
        // HubSpot's link to the deal record, for the brief. Only an https link is kept.
        url: typeof d.url === 'string' && d.url.startsWith('https://') ? d.url : null,
      };
    }),
  };
}
