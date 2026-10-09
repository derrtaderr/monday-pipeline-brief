// Converts the seed fixture rows (an older row format) into schema-1 snapshots.
// The seed rows carry a next_step_date field that HubSpot does not have. HubSpot has
// notes_last_updated (last activity), so the one documented mapping is:
//   last_activity = min(next_step_date, snapshot date minus 2 days)
// An overdue next step keeps its old date (still stale); a future one becomes recent activity.
// Every deal gets a record url in HubSpot's shape, on a made-up portal id.
// A row names its pipeline ("Renewals"); without one it is in the Sales Pipeline. Between the
// two demo weeks an admin moved the Renewals stage "Contacted" ahead of "Upcoming", so deals
// in those stages change stage_order without moving, and deleted the Renewals stage "Paused",
// so a deal that left it is a stage change with no direction. Both pipelines have closed
// stages after their open ones.

const SALES = ['Discovery', 'Qualified', 'Demo', 'Proposal', 'Negotiation'];
const RENEWALS = {
  '2026-09-28': ['Upcoming', 'Contacted', 'Paused', 'Negotiating'],
  '2026-10-05': ['Contacted', 'Upcoming', 'Negotiating'],
};
const CLOSED = { won: { stage: 'Closed won' }, lost: { stage: 'Closed lost' } };
const stageId = (label) => label.toLowerCase().replace(/ /g, '');

function minusDays(iso, n) {
  const t = Date.parse(`${iso}T00:00:00Z`) - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

const stages = (open) => [
  ...open.map((label, order) => ({ id: stageId(label), label, order, status: 'open' })),
  ...Object.entries(CLOSED).map(([status, c], i) => ({ id: stageId(c.stage), label: c.stage, order: open.length + i, status })),
];

function layout(date) {
  return [
    { id: 'default', label: 'Sales Pipeline', stages: stages(SALES) },
    { id: 'renewals', label: 'Renewals', stages: stages(RENEWALS[date] ?? RENEWALS['2026-09-28']) },
  ];
}

export function convertSeed(rows, date) {
  const recent = minusDays(date, 2);
  const pipelines = layout(date);
  return {
    schema: 1,
    taken_at: `${date}T07:00:00.000Z`,
    date,
    source: 'demo',
    pipelines,
    deals: rows.map((r) => {
      const closed = CLOSED[r.status];
      const stage = closed ? closed.stage : r.stage;
      const pipeline = pipelines.find((p) => p.label === (r.pipeline ?? 'Sales Pipeline'));
      return {
        id: r.id,
        name: r.name,
        owner: r.owner,
        pipeline_id: pipeline.id,
        pipeline: pipeline.label,
        stage_id: stageId(stage),
        stage,
        stage_order: pipeline.stages.find((s) => s.label === stage).order,
        status: r.status,
        amount: r.amount,
        close_date: r.close_date,
        next_step: r.next_step ?? '',
        last_activity: r.next_step_date && r.next_step_date < recent ? r.next_step_date : recent,
        url: `https://app.hubspot.com/contacts/1234567/record/0-3/${r.id}`,
      };
    }),
  };
}
