// The dollar bridge: last snapshot's open total, walked line by line to this one's.
// Every amount is in integer cents so float rounding can never unbalance it.

export const cents = (amount) => Math.round((Number(amount) || 0) * 100);
const isOpen = (d) => d.status === 'open';

// The home-currency amount moved while the deal's own amount and currency did not: the exchange
// rate moved, not the deal. Unknown (false) when either snapshot lacks them.
export function exchangeRateOnly(p, d) {
  return Boolean(p.deal_currency) && p.deal_currency === d.deal_currency
    && p.deal_currency_amount != null && d.deal_currency_amount != null
    && cents(p.deal_currency_amount) === cents(d.deal_currency_amount);
}

// What an amount change can be told to be, for its line: 'exchange rate' (above), or 'currency
// unknown last week' when last week's snapshot predates the currency fields and the deal is in
// a foreign currency today (its own amount differs from its home amount), so an exchange-rate
// move cannot be ruled out. Null otherwise: a real change.
export const EXCHANGE_RATE = 'exchange rate';
export const CURRENCY_UNKNOWN = 'currency unknown last week';
export function amountNote(p, d) {
  if (exchangeRateOnly(p, d)) return EXCHANGE_RATE;
  if (p.deal_currency_amount === undefined && d.deal_currency && d.deal_currency_amount != null
    && cents(d.deal_currency_amount) !== cents(d.amount)) return CURRENCY_UNKNOWN;
  return null;
}
const line = () => ({ cents: 0, count: 0 });
const add = (l, c) => { l.cents += c; l.count += 1; };

// The bridge walked from the start must land on the open total. The message holds no figures:
// it reaches stderr and run.log, which can end up in a log other people read.
export function assertBalanced(walked, end) {
  if (walked !== end) throw new Error('the dollar bridge does not add up to the open total, so no brief was written. This is a bug; please report it in GitHub Issues');
}

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
    if (change) amountChanged.push({ deal: d, from: p.amount, to: d.amount, note: amountNote(p, d) });
    if (!isOpen(d)) add(b[d.status], now);
  }
  for (const p of previous.deals) {
    if (!seen.has(p.id) && isOpen(p)) { add(b.removed, cents(p.amount)); removed.push(p); }
  }

  const walked = b.start + b.new.cents + b.reopened.cents + b.increases.cents - b.decreases.cents
    - b.won.cents - b.lost.cents - b.removed.cents;
  assertBalanced(walked, b.end);
  return { bridge: b, amountChanged, removed, reopened };
}
