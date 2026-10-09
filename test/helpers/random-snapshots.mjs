// Seeded random snapshot pairs for property-style tests. Every pair mixes the cases the bridge
// must handle: open to open (amount up, down, same), open to won or lost (with amount changes),
// open and removed, new and open, new and already closed, closed and reopened, closed and gone,
// unknown stages, pipeline moves and cent amounts.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES = ['open', 'open', 'open', 'won', 'lost'];

export function randomPair(seed) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const amount = () => {
    const kind = r();
    if (kind < 0.1) return 0;
    if (kind < 0.3) return Math.round(r() * 1e7) / 100; // cents
    return Math.round(r() * 500) * 1000;
  };
  const deal = (id) => ({
    id: String(id), name: `Deal ${id}`, owner: pick(['Dana', 'Leo', 'Priya']),
    pipeline_id: pick(['default', 'renewals']), pipeline: 'P',
    stage_id: pick(['a', 'b', 'c']), stage: 'S', stage_order: r() < 0.1 ? null : Math.floor(r() * 4),
    status: pick(STATUSES), amount: amount(),
    close_date: `2026-${pick(['09', '10', '11', '12'])}-1${Math.floor(r() * 9)}`,
    next_step: r() < 0.2 ? '' : 'Call', last_activity: '2026-10-01', created: '2026-08-01',
  });
  const n = 1 + Math.floor(r() * 30);
  const prev = [];
  const curr = [];
  for (let i = 0; i < n; i++) {
    const before = deal(i);
    const fate = r();
    if (fate < 0.15) { prev.push(before); continue; } // removed
    if (fate < 0.3) { curr.push(deal(i)); continue; } // new
    prev.push(before);
    const after = { ...before };
    if (r() < 0.5) after.amount = amount();
    if (r() < 0.4) after.status = pick(STATUSES);
    if (r() < 0.2) after.pipeline_id = pick(['default', 'renewals']);
    if (r() < 0.3) after.stage_id = pick(['a', 'b', 'c']);
    curr.push(after);
  }
  return {
    previous: { schema: 1, date: '2026-09-28', deals: prev },
    current: { schema: 1, date: '2026-10-05', deals: curr },
  };
}
