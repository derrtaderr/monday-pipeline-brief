// Compare two snapshots and return the structured facts the brief is written from.

import { daysBetween } from './format.mjs';
import { buildBridge } from './bridge.mjs';

export const STALE_DAYS = 14;

const byAmount = (get = (x) => x) => (a, b) => get(b).amount - get(a).amount;
const sum = (deals) => deals.reduce((n, d) => n + d.amount, 0);

// With no logged activity, the deal's age stands in: a deal created under STALE_DAYS ago has
// not had time to go quiet. With no creation date either, it is flagged as before.
function staleReason(d, today, nextStep) {
  if (nextStep && !d.next_step) return 'no-next-step';
  const since = d.last_activity || d.created;
  if (!since || daysBetween(since, today) >= STALE_DAYS) return 'no-activity';
  return null;
}

// A stage is identified by its id, or by its label when a snapshot has no id.
const stageKey = (d) => `${d.pipeline_id}/${d.stage_id ?? d.stage}`;
const known = (order) => order !== null && order !== undefined;

// Today's stage order. When the current snapshot carries its pipelines' stage layout (v0.2
// and later), that is the order. Otherwise it is read from the deals that sit in each stage.
function currentLayout(current) {
  const fromSnapshot = new Map();
  if (Array.isArray(current.pipelines)) {
    for (const p of current.pipelines) for (const s of p.stages ?? []) fromSnapshot.set(`${p.id}/${s.id}`, s.order);
  }
  const fromDeals = new Map();
  for (const d of current.deals) if (known(d.stage_order)) fromDeals.set(stageKey(d), d.stage_order);
  return { fromSnapshot, fromDeals };
}

// A move needs the stage itself to change within one pipeline; a reorder alone is never a
// move. The direction compares both stages in today's stored layout when it lists both. When it
// lists the new stage but not the old one (deleted since), the two orders would come from two
// different layouts, so no direction is claimed: CHANGED. Without a stored layout (a 0.1
// snapshot), the current deals' orders are used, falling back to the old snapshot's order for a
// stage no current deal sits in; equal orders for two different stages are CHANGED too.
// Negative is back, positive forward, 0 no move (or a stage that cannot be read).
export const CHANGED = 'changed';
function stageMove(p, d, layout) {
  if (d.pipeline_id !== p.pipeline_id || stageKey(d) === stageKey(p)) return 0;
  const to = layout.fromSnapshot.get(stageKey(d));
  const from = layout.fromSnapshot.get(stageKey(p));
  if (known(to) && known(from)) return Math.sign(to - from) || CHANGED;
  if (known(to)) return CHANGED;
  if (!known(d.stage_order) || !known(p.stage_order)) return 0;
  return Math.sign(d.stage_order - (layout.fromDeals.get(stageKey(p)) ?? p.stage_order)) || CHANGED;
}

export const FLAG_TEXT = {
  slipped: 'close date slipped',
  back: 'moved back a stage',
  overdue: 'close date passed',
  'no-next-step': 'no next step',
  'no-activity': 'no activity in 14+ days',
};

// Large deals by default: the largest open deals, never more than LARGE_SHARE of them and at
// least one. When deals tied on one amount straddle the cut, the whole tied group is left
// out. If that would leave no large deal at all: when the tied group is every deal with a
// positive amount (all the same size), no deal is large; otherwise the tied deals are taken in
// deal id order (lowest HubSpot record id, normally the oldest record, first) up to the cap.
// A deal of $0 is never large. An explicit dollar setting makes every deal at or above it large.
export const LARGE_SHARE = 0.1;

export function largeDeals(open, setting) {
  if (setting === false || setting === null) return { rule: 'off', threshold: null, ids: new Set() };
  if (typeof setting === 'number') {
    return { rule: 'amount', threshold: setting, ids: new Set(open.filter((d) => d.amount > 0 && d.amount >= setting).map((d) => d.id)) };
  }
  const byId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });
  const sorted = open.filter((d) => d.amount > 0).sort((a, b) => b.amount - a.amount || byId(a, b));
  const cap = Math.max(1, Math.floor(open.length * LARGE_SHARE));
  let chosen = sorted.slice(0, cap);
  const edge = chosen.at(-1);
  if (edge && sorted[cap]?.amount === edge.amount) {
    const above = chosen.filter((d) => d.amount > edge.amount);
    if (above.length) chosen = above;
    else if (sorted.at(-1).amount === edge.amount) chosen = [];
  }
  return { rule: 'top', threshold: null, ids: new Set(chosen.map((d) => d.id)) };
}

const quarter = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return { key: y * 4 + Math.floor((m - 1) / 3), label: `Q${Math.floor((m - 1) / 3) + 1} ${y}` };
};

// Each pipeline id's label: today's (the stored layout, else today's deals), falling back to the
// last snapshot's for a pipeline that is gone today.
function pipelineLabels(previous, current) {
  const labels = new Map();
  const from = (snapshot) => {
    for (const d of snapshot?.deals ?? []) if (d.pipeline_id != null && d.pipeline != null) labels.set(d.pipeline_id, d.pipeline);
    for (const p of Array.isArray(snapshot?.pipelines) ? snapshot.pipelines : []) if (p.id != null && p.label != null) labels.set(p.id, p.label);
  };
  from(previous);
  from(current);
  return labels;
}

export function compare(previous, current, today, { nextStep = true, largeDeal } = {}) {
  const prev = new Map((previous?.deals ?? []).map((d) => [d.id, d]));
  const open = current.deals.filter((d) => d.status === 'open');

  const stale = open
    .map((deal) => ({ deal, reason: staleReason(deal, today, nextStep) }))
    .filter((s) => s.reason)
    .sort(byAmount((s) => s.deal));

  const result = {
    firstRun: !previous,
    large: largeDeals(open, largeDeal),
    nextStepCheck: nextStep,
    date: current.date,
    previousDate: previous?.date ?? null,
    open: { total: sum(open), count: open.length },
    openDeals: open,
    previousOpenTotal: previous ? sum(previous.deals.filter((d) => d.status === 'open')) : null,
    won: [], lost: [], slipped: [], back: [], forward: [], changedStage: [], transferred: [], newDeals: [], lookFirst: [],
    bridge: null, amountChanged: [], removed: [], reopened: [], closedMoves: new Map(),
    stale,
    overdue: open
      .filter((d) => d.close_date && d.close_date < current.date)
      .map((deal) => ({ deal, days: daysBetween(deal.close_date, current.date) }))
      .sort(byAmount((o) => o.deal)),
    unknownStage: (() => {
      const unknown = open.filter((d) => d.stage_order === null || d.stage_order === undefined);
      return { count: unknown.length, total: sum(unknown) };
    })(),
  };
  result.pipelineLabels = pipelineLabels(previous, current);
  if (!previous) return result;
  const layout = currentLayout(current);
  Object.assign(result, buildBridge(previous, current));

  for (const d of current.deals) {
    const p = prev.get(d.id);
    if (!p) result.newDeals.push(d);
    if (d.status !== 'open' && (!p || p.status === 'open')) result[d.status].push(d);
    // Closed straight into another pipeline: no transfer line (it is not open), so the Closed line names the move.
    if (p && p.status === 'open' && d.status !== 'open' && d.pipeline_id !== p.pipeline_id) {
      result.closedMoves.set(d.id, { fromPipeline: p.pipeline ?? p.pipeline_id, fromPipelineId: p.pipeline_id });
    }
    if (!p || d.status !== 'open' || p.status !== 'open') continue;
    if (d.close_date && p.close_date && d.close_date > p.close_date) {
      const to = quarter(d.close_date);
      const intoQuarter = to.key > quarter(p.close_date).key ? to.label : null;
      result.slipped.push({ deal: d, from: p.close_date, days: daysBetween(p.close_date, d.close_date), intoQuarter });
    }
    if (d.pipeline_id !== p.pipeline_id) {
      result.transferred.push({ deal: d, fromPipeline: p.pipeline ?? p.pipeline_id, fromPipelineId: p.pipeline_id, fromStage: p.stage });
    }
    const move = stageMove(p, d, layout);
    if (move === CHANGED) result.changedStage.push({ deal: d, from: p.stage });
    else if (move < 0) result.back.push({ deal: d, from: p.stage });
    else if (move > 0) result.forward.push({ deal: d, from: p.stage });
  }
  for (const key of ['won', 'lost', 'newDeals', 'removed']) result[key].sort(byAmount());
  for (const key of ['slipped', 'back', 'forward', 'changedStage', 'transferred', 'amountChanged', 'reopened']) result[key].sort(byAmount((r) => r.deal));

  const flags = new Map();
  const flag = (deal, text) => {
    if (!flags.has(deal.id)) flags.set(deal.id, { deal, flags: [] });
    flags.get(deal.id).flags.push(text);
  };
  for (const r of result.slipped) flag(r.deal, FLAG_TEXT.slipped);
  for (const r of result.back) flag(r.deal, FLAG_TEXT.back);
  for (const o of result.overdue) flag(o.deal, FLAG_TEXT.overdue);
  for (const s of stale) flag(s.deal, FLAG_TEXT[s.reason]);
  const quarterSlip = new Map(result.slipped.filter((s) => s.intoQuarter).map((s) => [s.deal.id, s.intoQuarter]));
  const large = (d) => result.large.ids.has(d.id);
  for (const f of flags.values()) {
    f.reasons = [];
    if (f.flags.length > 1) f.reasons.push(`${f.flags.length} warning signs`);
    if (quarterSlip.has(f.deal.id)) f.reasons.push(`slipped into ${quarterSlip.get(f.deal.id)}`);
    if (large(f.deal)) f.reasons.push('large deal');
  }
  result.lookFirst = [...flags.values()].filter((f) => f.reasons.length).sort(byAmount((f) => f.deal));
  return result;
}
