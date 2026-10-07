// Compare two snapshots and return the structured facts the brief is written from.

import { daysBetween } from './format.mjs';

export const STALE_DAYS = 14;

const byAmount = (get = (x) => x) => (a, b) => get(b).amount - get(a).amount;
const sum = (deals) => deals.reduce((n, d) => n + d.amount, 0);

function staleReason(d, today, nextStep) {
  if (nextStep && !d.next_step) return 'no-next-step';
  if (!d.last_activity || daysBetween(d.last_activity, today) >= STALE_DAYS) return 'no-activity';
  return null;
}

export const FLAG_TEXT = {
  slipped: 'close date slipped',
  back: 'moved back a stage',
  'no-next-step': 'no next step',
  'no-activity': 'no activity in 14+ days',
};

export function compare(previous, current, today, { nextStep = true } = {}) {
  const prev = new Map((previous?.deals ?? []).map((d) => [d.id, d]));
  const open = current.deals.filter((d) => d.status === 'open');

  const stale = open
    .map((deal) => ({ deal, reason: staleReason(deal, today, nextStep) }))
    .filter((s) => s.reason)
    .sort(byAmount((s) => s.deal));

  const result = {
    firstRun: !previous,
    nextStepCheck: nextStep,
    date: current.date,
    previousDate: previous?.date ?? null,
    open: { total: sum(open), count: open.length },
    previousOpenTotal: previous ? sum(previous.deals.filter((d) => d.status === 'open')) : null,
    won: [], lost: [], slipped: [], back: [], forward: [], newDeals: [], lookFirst: [],
    stale,
    unknownStage: (() => {
      const unknown = open.filter((d) => d.stage_order === null || d.stage_order === undefined);
      return { count: unknown.length, total: sum(unknown) };
    })(),
  };
  if (!previous) return result;

  for (const d of current.deals) {
    const p = prev.get(d.id);
    if (!p) result.newDeals.push(d);
    if (d.status !== 'open' && (!p || p.status === 'open')) result[d.status].push(d);
    if (!p || d.status !== 'open' || p.status !== 'open') continue;
    if (d.close_date && p.close_date && d.close_date > p.close_date) {
      result.slipped.push({ deal: d, from: p.close_date, days: daysBetween(p.close_date, d.close_date) });
    }
    if (d.pipeline_id === p.pipeline_id && d.stage_order !== null && p.stage_order !== null) {
      if (d.stage_order < p.stage_order) result.back.push({ deal: d, from: p.stage });
      if (d.stage_order > p.stage_order) result.forward.push({ deal: d, from: p.stage });
    }
  }
  for (const key of ['won', 'lost', 'newDeals']) result[key].sort(byAmount());
  for (const key of ['slipped', 'back', 'forward']) result[key].sort(byAmount((r) => r.deal));

  const flags = new Map();
  const flag = (deal, text) => {
    if (!flags.has(deal.id)) flags.set(deal.id, { deal, flags: [] });
    flags.get(deal.id).flags.push(text);
  };
  for (const r of result.slipped) flag(r.deal, FLAG_TEXT.slipped);
  for (const r of result.back) flag(r.deal, FLAG_TEXT.back);
  for (const s of stale) flag(s.deal, FLAG_TEXT[s.reason]);
  result.lookFirst = [...flags.values()].filter((f) => f.flags.length > 1).sort(byAmount((f) => f.deal));
  return result;
}
