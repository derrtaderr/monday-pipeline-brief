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

function ownerName(o) {
  const full = `${o.firstName ?? ''} ${o.lastName ?? ''}`.trim();
  return full || o.email || `Owner ${o.id}`;
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
  const ownerNames = new Map(owners.map((o) => [String(o.id), ownerName(o)]));

  return {
    schema: SCHEMA,
    taken_at: takenAt.toISOString(),
    date,
    source,
    deals: deals.map((d) => {
      const p = d.properties ?? {};
      const stage = stages.get(`${p.pipeline}/${p.dealstage}`);
      const ownerId = p.hubspot_owner_id ? String(p.hubspot_owner_id) : null;
      return {
        id: String(d.id),
        name: p.dealname ?? `Deal ${d.id}`,
        owner: ownerId ? ownerNames.get(ownerId) ?? `Owner ${ownerId}` : 'Unassigned',
        pipeline_id: p.pipeline ?? null,
        pipeline: pipelineLabels.get(p.pipeline) ?? p.pipeline ?? null,
        stage_id: p.dealstage ?? null,
        stage: stage?.label ?? p.dealstage ?? null,
        stage_order: stage?.order ?? null,
        status: stage?.status ?? 'open',
        amount: dealAmount(p),
        close_date: isoDay(p.closedate),
        next_step: (p.hs_next_step ?? '').trim(),
        last_activity: isoDay(p.notes_last_updated),
        // The createdate property, else the record's createdAt (required by HubSpot's spec).
        created: isoDay(p.createdate ?? d.createdAt),
      };
    }),
  };
}
