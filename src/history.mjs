// Rebuild deals as they stood at a past instant from HubSpot deal property history.
// Pure functions only; the read path that feeds them is in stateless.mjs.

import { HISTORY_PAGE } from './hubspot.mjs';

// The value of one property at instant `at`: the newest version written at or before it.
// Versions in the same millisecond keep HubSpot's newest-first order: the first listed wins.
// Undefined when the property had no value yet (or HubSpot kept no history for it).
export function valueAt(versions, at) {
  const t = at.getTime();
  let best;
  for (const v of versions ?? []) {
    const ts = Date.parse(v.timestamp);
    if (ts <= t && (!best || ts > Date.parse(best.timestamp))) best = v;
  }
  return best?.value;
}

// The snapshot fields compare() reads to find a change, each with the HubSpot properties it is
// built from. (deal_currency and deal_currency_amount only label an amount change as an
// exchange-rate move; a value that cannot be rebuilt is null, which never labels one.)
export const COMPARE_FIELDS = {
  stage_id: ['dealstage'],
  status: ['dealstage', 'pipeline'],
  stage_order: ['dealstage', 'pipeline'],
  pipeline_id: ['pipeline'],
  amount: ['amount', 'amount_in_home_currency'],
  close_date: ['closedate'],
  owner: ['hubspot_owner_id'],
  next_step: ['hs_next_step'],
  last_activity: ['notes_last_updated'],
};
// The fields compare() and the bridge read from the PREVIOUS snapshot. owner, next_step and
// last_activity are read from today's snapshot only, so a capped history on them never stops a
// deal from being rebuilt (their value at T is left null).
export const UNKNOWN_FIELDS = ['stage_id', 'status', 'stage_order', 'pipeline_id', 'amount', 'close_date'];
export const MERGE_SOURCE = 'MERGE_OBJECTS';
const STAGE_FIELDS = ['stage_id', 'status', 'stage_order'];

// Every deal record (live, plus archived ones read through batch read with full history) as it
// stood at instant `at`, split into deals rebuilt in the raw shape buildSnapshot reads, and deals
// that could not be rebuilt, with the compare fields that are unknown and why.
//   - Archived at or before `at`, or created after it: absent.
//   - Merged after `at` (hs_merged_object_ids set and a MERGE_OBJECTS version after `at`): the
//     record's history mixes both source deals, so every compare field is unknown.
//   - A field in UNKNOWN_FIELDS whose source history hit the 20-version cap after `at`: unknown. This is
//     checked BEFORE the existence rule, so a deal whose capped stage history starts after `at`
//     is unknown, never dropped or new.
//   - Every version of every property after `at` (a backdated import): absent.
//   - Otherwise, no dealstage version at or before `at`: it existed, its stage then is unknown.
export function rebuildAt(records, at) {
  const t = at.getTime();
  const deals = [];
  const unknown = [];
  for (const r of records) {
    const h = r.propertiesWithHistory ?? {};
    if (r.archived && r.archivedAt && Date.parse(r.archivedAt) <= t) continue;
    const created = Date.parse(valueAt(h.createdate, at) ?? r.createdAt);
    if (!(created <= t)) continue;
    // HubSpot writes createdate when it creates the record, so a full createdate history with no
    // version at or before `at` means the record did not exist then (an import backdates the
    // value, never the version).
    if (h.createdate?.length && knownAt(h.createdate, at) && valueAt(h.createdate, at) === undefined) continue;
    const id = String(r.id);
    // A backdated import: HubSpot holds no version of any property at or before `at`, so the deal
    // did not exist in HubSpot then, whatever its createdate says. Absent, before the cap check.
    const versionsAll = Object.values(h).flat().filter(Boolean);
    if (versionsAll.length && versionsAll.every((v) => Date.parse(v.timestamp) > t)) continue;
    const mergedAfter = String(r.properties?.hs_merged_object_ids ?? '').trim() !== ''
      && Object.values(h).some((vs) => (vs ?? []).some((v) => v.sourceType === MERGE_SOURCE && Date.parse(v.timestamp) > t));
    if (mergedAfter) {
      const sources = String(r.properties.hs_merged_object_ids).split(';').map((x) => x.trim()).filter(Boolean);
      unknown.push({ id, reason: 'merged', fields: UNKNOWN_FIELDS, sources });
      continue;
    }
    const fields = UNKNOWN_FIELDS.filter((f) => COMPARE_FIELDS[f].some((p) => !knownAt(h[p], at)));
    if (fields.length) {
      // Its properties at T, every property whose capped history cannot answer left null. The run
      // turns them into a snapshot row (atT) with the stage layout at T, for compareStateless.
      unknown.push({ id, reason: 'capped', fields, createdAt: r.createdAt, url: r.url, properties: propertiesAt(h, at) });
      continue;
    }
    // It existed then (some property has a version at or before `at`) but no stage version is
    // in force: its stage, and so its status, then is unknown. Never absent, so never New.
    if (valueAt(h.dealstage, at) === undefined) {
      unknown.push({ id, reason: 'no-stage', fields: STAGE_FIELDS, createdAt: r.createdAt, url: r.url, properties: propertiesAt(h, at) });
      continue;
    }
    deals.push({ id, createdAt: r.createdAt, url: r.url, properties: propertiesAt(h, at) });
  }
  return { deals, unknown };
}

// Every property's value at `at`; null when it had none yet or its capped history cannot answer.
function propertiesAt(h, at) {
  return Object.fromEntries(Object.entries(h).map(([k, versions]) => [k, knownAt(versions, at) ? valueAt(versions, at) ?? null : null]));
}

// How many times the close date slipped in (from, to]: the push count. Only a move to a later
// date counts; a pull-in does not, the first value a deal was created with does not, and a write
// that repeats the previous value does not. Nor does the close date HubSpot's own automation
// stamps when a deal closes (sourceId close-date-automation): that is the close, not a slip.
// A cleared close date ("") is not a date, so clearing it counts no slip, and neither does setting
// a date again after it was cleared (that compares against the empty value).
// HubSpot lists versions newest first, so two versions in the same millisecond are ordered by
// their original index: the one listed first is the later write.
export const CLOSE_AUTOMATION = 'close-date-automation';
export function closeDateMoves(versions, from, to) {
  const sorted = (versions ?? [])
    .map((v, i) => ({ v, i, ts: Date.parse(v.timestamp) }))
    .filter(({ v }) => v.sourceId !== CLOSE_AUTOMATION)
    .sort((a, b) => a.ts - b.ts || b.i - a.i);
  let slips = 0;
  for (let k = 1; k < sorted.length; k++) {
    const { v, ts } = sorted[k];
    const before = sorted[k - 1].v;
    if (ts > from.getTime() && ts <= to.getTime() && Date.parse(v.value) > Date.parse(before.value)) slips++;
  }
  return slips;
}

// One pipeline's stage layout as of instant `at`, from its audit (GET
// /crm/v3/pipelines/deals/{id}/audit, newest first, each entry carrying the full pipeline as
// rawObject). Returned in the shape GET /crm/v3/pipelines/deals gives, so buildSnapshot can
// read it. Null before the pipeline was created, or once a DELETE entry is in force.
export function layoutAsOf(audit, at) {
  let best;
  for (const e of audit ?? []) {
    const ts = Date.parse(e.timestamp);
    if (ts <= at.getTime() && (!best || ts > Date.parse(best.timestamp))) best = e;
  }
  if (!best || best.action === 'DELETE') return null;
  const p = JSON.parse(best.rawObject);
  return {
    id: p.pipelineId,
    label: p.label,
    stages: (p.stages ?? []).map((s) => ({ id: s.stageId, label: s.label, displayOrder: s.displayOrder, metadata: s.metadata })),
  };
}

// Every live pipeline's layout at `at`. A pipeline whose audit is missing (a 404) or empty
// falls back to today's layout; one whose audit starts after `at` did not exist yet, unless
// deals sat in it at `at` (inUse holds those pipeline ids): then HubSpot's change log simply does
// not reach back that far, and the oldest entry it kept stands in, marked with fallbackFrom (that
// entry's timestamp) so the brief can say so.
export function layoutsAt(pipelines, audits, at, inUse = new Set()) {
  return pipelines.flatMap((p) => {
    const audit = audits.get(p.id);
    if (!audit || !audit.length) return [p];
    const layout = layoutAsOf(audit, at);
    if (layout) return [layout];
    if (!inUse.has(p.id)) return [];
    const oldest = Math.min(...audit.map((e) => Date.parse(e.timestamp)));
    const first = layoutAsOf(audit, new Date(oldest));
    return first ? [{ ...first, fallbackFrom: new Date(oldest).toISOString() }] : [];
  });
}

// The archived list endpoint returns at most one version per property even when history is
// requested, so archived deals are listed without history and only those archived after `at`
// are read again through batch read (?archived=true), which returns full history, 50 per call.
export const HISTORY_BATCH = HISTORY_PAGE;
export function archivedBatches(list, at, size = HISTORY_BATCH) {
  // Each id once: a listing that pages over a change can return a deal twice.
  const ids = [...new Set(list.filter((r) => r.archivedAt && Date.parse(r.archivedAt) > at.getTime()).map((r) => String(r.id)))];
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

// HubSpot keeps the newest 20 versions of each deal property (knowledge base, "Export property
// history"; confirmed live by this spike). A property whose history is at the cap may have lost
// the version in force at an earlier instant, so its value there is unknown, not empty.
export const HISTORY_CAP = 20;
export function knownAt(versions, at) {
  if (!versions || versions.length < HISTORY_CAP) return true;
  return Math.min(...versions.map((v) => Date.parse(v.timestamp))) <= at.getTime();
}
