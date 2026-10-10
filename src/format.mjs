// Small formatting helpers shared by the brief renderer.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY_MS = 86400000;

// The sum of the deals' amounts.
export const sumAmounts = (deals) => deals.reduce((n, d) => n + d.amount, 0);

// Short dollars for headlines and deal lines: $750, $24K, $1.25M, $1.00B. Each unit takes over
// where the smaller one would round to 1,000 of itself ($999,500 is $1.00M, never $1,000K), and
// an amount that rounds to zero is $0, never -$0.
export function money(n) {
  const abs = Math.abs(n);
  if (Math.round(abs) === 0) return '$0';
  const sign = n < 0 ? '-' : '';
  if (Math.round(abs / 1e4) >= 100000) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (Math.round(abs / 1000) >= 1000) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (Math.round(abs) >= 1000) return `${sign}$${Math.round(abs / 1000).toLocaleString('en-US')}K`;
  return `${sign}$${Math.round(abs)}`;
}

// Exact dollars from integer cents, for lines that must visibly add up: $1,094,000 or $0.30.
export function exactMoney(cents) {
  if (cents < 0) return `-${exactMoney(-cents)}`;
  const whole = Math.floor(cents / 100).toLocaleString('en-US');
  const rest = cents % 100;
  return rest ? `$${whole}.${String(rest).padStart(2, '0')}` : `$${whole}`;
}

// Dates are plain YYYY-MM-DD strings; parse as UTC so the local zone never shifts a day.
function utc(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function daysBetween(from, to) {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}
