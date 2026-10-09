// Small formatting helpers shared by the brief renderer.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

export function money(n) {
  if (n < 0) return `-${money(-n)}`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000).toLocaleString('en-US')}K`;
  return `$${Math.round(n)}`;
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
