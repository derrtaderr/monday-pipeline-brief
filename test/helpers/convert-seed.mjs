// Converts the seed fixture rows (an older row format) into schema-1 snapshots.
// The seed rows carry a next_step_date field that HubSpot does not have. HubSpot has
// notes_last_updated (last activity), so the one documented mapping is:
//   last_activity = min(next_step_date, snapshot date minus 2 days)
// An overdue next step keeps its old date (still stale); a future one becomes recent activity.

const STAGES = ['Discovery', 'Qualified', 'Demo', 'Proposal', 'Negotiation'];
const CLOSED = { won: { stage: 'Closed won', order: 5 }, lost: { stage: 'Closed lost', order: 6 } };

function minusDays(iso, n) {
  const t = Date.parse(`${iso}T00:00:00Z`) - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function convertSeed(rows, date) {
  const recent = minusDays(date, 2);
  return {
    schema: 1,
    taken_at: `${date}T07:00:00.000Z`,
    date,
    source: 'demo',
    deals: rows.map((r) => {
      const closed = CLOSED[r.status];
      const stage = closed ? closed.stage : r.stage;
      return {
        id: r.id,
        name: r.name,
        owner: r.owner,
        pipeline_id: 'default',
        pipeline: 'Sales Pipeline',
        stage_id: stage.toLowerCase().replace(/ /g, ''),
        stage,
        stage_order: closed ? closed.order : STAGES.indexOf(r.stage),
        status: r.status,
        amount: r.amount,
        close_date: r.close_date,
        next_step: r.next_step ?? '',
        last_activity: r.next_step_date && r.next_step_date < recent ? r.next_step_date : recent,
      };
    }),
  };
}
