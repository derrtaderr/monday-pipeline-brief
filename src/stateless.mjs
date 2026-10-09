// Stateless mode: rebuild last week's snapshot from HubSpot property history instead of reading
// one from disk. statelessRead is the read path, buildStateless turns what it read into the two
// snapshots compare() takes, and compareStateless is compare() with the could-not-rebuild bucket.

import { HubSpotError } from './hubspot.mjs';
import { buildSnapshot } from './snapshot.mjs';
import { compare } from './compare.mjs';
import { cents } from './bridge.mjs';
import { rebuildAt, layoutsAt, archivedBatches, closeDateMoves } from './history.mjs';

// Stateless mode will not run on this portal. The CLI exits 5 with the message.
export class StatelessRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'StatelessRefusal';
  }
}

export const MULTI_CURRENCY_MESSAGE = 'This HubSpot portal uses more than one currency. Stateless mode has not been validated on multi-currency portals, so it will not rebuild last week from history here. Run without --since or --as-of to use stored snapshots, which work on any portal.';

// The read path for one as-of instant T. Currency first: a portal with any exchange rate has more
// than one currency, and nothing else is read. Then live deals with history (50 per page), the
// recycle bin without history, the deals archived after T batch read with history (50 per call),
// pipelines with one audit each, and owners.
export async function statelessRead(client, T) {
  let rates;
  try {
    rates = await client.listExchangeRates();
  } catch (err) {
    if (err instanceof HubSpotError && err.status === 403) throw new StatelessRefusal(err.message);
    throw err;
  }
  if (rates.length) throw new StatelessRefusal(MULTI_CURRENCY_MESSAGE);
  const live = await client.listDealsWithHistory();
  const archivedList = await client.listArchivedDeals();
  const archived = [];
  for (const ids of archivedBatches(archivedList, T)) archived.push(...await client.readArchivedWithHistory(ids));
  const pipelines = await client.listPipelines();
  const audits = new Map();
  for (const p of pipelines) audits.set(p.id, await client.pipelineAudit(p.id));
  const owners = await client.listOwners();
  return { live, archived, archivedListed: archivedList.length, pipelines, audits, owners };
}

// The previous snapshot rebuilt at T (with the stage layout at T), today's snapshot from the live
// listing's current properties, the deals that could not be rebuilt (each with its snapshot row at
// T, atT, when it has properties at T), and how many times each deal's close date was pushed later
// since T.
export function buildStateless({ live, archived, pipelines, audits, owners, T, now, previousDate, date }) {
  // One record per deal id. A paging overlap can list a deal twice, and a deal archived between
  // the two listings is in both; the archived copy (read last, with full history) wins.
  const seen = new Set();
  const records = [...archived, ...live].filter((r) => !seen.has(String(r.id)) && seen.add(String(r.id)));
  const atT = rebuildAt(records, T);
  const layoutT = layoutsAt(pipelines, audits, T);
  // A stage at T that the layout at T does not hold (a deleted pipeline or stage, or an audit that
  // starts after T) gives no status then. buildSnapshot would call it open; here it is unknown.
  const inLayout = new Set(layoutT.flatMap((p) => (p.stages ?? []).map((s) => `${p.id}/${s.id}`)));
  const known = (row) => inLayout.has(`${row.pipeline_id}/${row.stage_id}`);
  const STATUS_FIELDS = ['status', 'stage_order'];
  const rebuilt = buildSnapshot({ deals: atT.deals, pipelines: layoutT, owners, takenAt: T, date: previousDate });
  const previous = { ...rebuilt, deals: rebuilt.deals.filter(known) };
  const rows = new Map(buildSnapshot({ deals: atT.unknown.filter((u) => u.properties), pipelines: layoutT, owners, takenAt: T, date: previousDate }).deals.map((x) => [x.id, x]));
  const unknown = [
    ...atT.unknown.map(({ properties, createdAt, url, ...u }) => {
      const row = rows.get(u.id);
      if (!row) return u;
      const fields = known(row) ? u.fields : [...u.fields, ...STATUS_FIELDS.filter((f) => !u.fields.includes(f))];
      return { ...u, fields, atT: row };
    }),
    ...rebuilt.deals.filter((row) => !known(row)).map((row) => ({ id: row.id, reason: 'layout', fields: STATUS_FIELDS, atT: row })),
  ].filter((u, i, all) => all.findIndex((x) => x.id === u.id) === i);
  const current = buildSnapshot({ deals: live, pipelines, owners, takenAt: now, date });
  const pushes = new Map();
  for (const r of records) {
    const n = closeDateMoves(r.propertiesWithHistory?.closedate, T, now);
    if (n > 0) pushes.set(String(r.id), n);
  }
  return { previous, current, unknown, pushes };
}

// compare() for a rebuilt previous snapshot. Each could-not-rebuild entry may carry atT, its
// snapshot row at T (built from its properties at T with the stage layout at T).
//   - Status at T known (status is not among its unknown fields) and either closed at T, or open
//     with a known amount: a partial deal. It joins the previous snapshot with its unknown close
//     date left empty (so no slip is claimed) and, when closed, an unknown amount set to 0 (never
//     read for a closed deal). compare() then treats it like any other deal: an open one counts
//     in the start, and if it is gone today it leaves through Removed from HubSpot.
//   - Anything else (status unknown, open with an unknown amount, or a merge): its state at T is
//     unknown. It stays out of the start, out of New, Won and Lost, and today's open amount goes to
//     its own bridge line, so the bridge still walks to the live open total.
export function compareStateless(previous, current, unknown, today, opts) {
  const partial = unknown.filter((u) => u.reason === 'capped' && u.atT && !u.fields.includes('status')
    && (u.atT.status !== 'open' || !u.fields.includes('amount')));
  const partialIds = new Set(partial.map((u) => u.id));
  const rows = partial.map((u) => ({
    ...u.atT,
    close_date: u.fields.includes('close_date') ? null : u.atT.close_date,
    amount: u.fields.includes('amount') ? 0 : u.atT.amount,
  }));
  const r = compare({ ...previous, deals: [...previous.deals, ...rows] }, current, today, opts);
  const byId = new Map(current.deals.map((x) => [x.id, x]));
  const rest = unknown.filter((u) => !partialIds.has(u.id));
  const ids = new Set(rest.map((u) => u.id));
  const b = r.bridge;
  b.couldNotRebuild = { cents: 0, count: 0 };
  for (const id of ids) {
    const deal = byId.get(id);
    if (!deal) continue;
    const c = cents(deal.amount);
    b.new.cents -= c; b.new.count -= 1;
    if (deal.status !== 'open') { b[deal.status].cents -= c; b[deal.status].count -= 1; }
    else { b.couldNotRebuild.cents += c; b.couldNotRebuild.count += 1; }
  }
  const openRows = rows.filter((x) => x.status === 'open');
  const known = openRows.reduce((n, x) => n + cents(x.amount), 0);
  r.startBreakdown = {
    rebuilt: b.start - known, known, knownCount: openRows.length,
    // A merged record stands for every source it absorbed.
    mergedSources: rest.filter((u) => u.reason === 'merged').reduce((n, u) => n + (u.sources?.length || 1), 0),
    unknownCount: rest.filter((u) => u.reason !== 'merged').length,
  };
  r.newDeals = r.newDeals.filter((x) => !ids.has(x.id));
  r.won = r.won.filter((x) => !ids.has(x.id));
  r.lost = r.lost.filter((x) => !ids.has(x.id));
  r.couldNotRebuild = unknown.map((u) => ({ ...u, partial: partialIds.has(u.id), deal: byId.get(u.id) ?? null }));
  r.stateless = true;
  // How many times each deal's close date was pushed later since T, for the Slipped lines.
  r.pushes = opts?.pushes ?? new Map();
  const walked = b.start + b.new.cents + b.reopened.cents + b.increases.cents - b.decreases.cents
    - b.won.cents - b.lost.cents - b.removed.cents + b.couldNotRebuild.cents;
  if (walked !== b.end) throw new Error(`stateless bridge does not balance: walked to ${walked} cents, open total is ${b.end}`);
  return r;
}
