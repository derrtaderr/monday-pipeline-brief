// The dollar bridge: last snapshot's open total, walked line by line to this one's.
// Every amount is in integer cents so float rounding can never unbalance it.

export const cents = (amount) => Math.round((Number(amount) || 0) * 100);
const isOpen = (d) => d.status === 'open';
const line = () => ({ cents: 0, count: 0 });
const add = (l, c) => { l.cents += c; l.count += 1; };

// Per deal (see docs/SPEC-v0.2.md for the table):
//   open -> open           amount change
//   open -> won/lost       amount change, then won/lost at the closing amount
//   open -> absent         removed at last amount
//   absent -> open         new
//   absent -> won/lost     new, then won/lost (nets to zero)
//   won/lost -> open       reopened
export function buildBridge(previous, current) {
  const prev = new Map(previous.deals.map((d) => [d.id, d]));
  const seen = new Set();
  const b = {
    start: previous.deals.filter(isOpen).reduce((n, d) => n + cents(d.amount), 0),
    end: current.deals.filter(isOpen).reduce((n, d) => n + cents(d.amount), 0),
    new: line(), reopened: line(), increases: line(), decreases: line(),
    won: line(), lost: line(), removed: line(),
  };
  const amountChanged = [];
  const removed = [];
  const reopened = [];

  for (const d of current.deals) {
    seen.add(d.id);
    const p = prev.get(d.id);
    const now = cents(d.amount);
    if (!p) {
      add(b.new, now);
      if (!isOpen(d)) add(b[d.status], now);
      continue;
    }
    if (!isOpen(p)) {
      if (isOpen(d)) { add(b.reopened, now); reopened.push({ deal: d, from: p.status }); }
      continue;
    }
    const change = now - cents(p.amount);
    if (change > 0) add(b.increases, change);
    if (change < 0) add(b.decreases, -change);
    if (change) amountChanged.push({ deal: d, from: p.amount, to: d.amount });
    if (!isOpen(d)) add(b[d.status], now);
  }
  for (const p of previous.deals) {
    if (!seen.has(p.id) && isOpen(p)) { add(b.removed, cents(p.amount)); removed.push(p); }
  }

  const walked = b.start + b.new.cents + b.reopened.cents + b.increases.cents - b.decreases.cents
    - b.won.cents - b.lost.cents - b.removed.cents;
  if (walked !== b.end) throw new Error(`bridge does not balance: walked to ${walked} cents, open total is ${b.end}`);
  return { bridge: b, amountChanged, removed, reopened };
}
