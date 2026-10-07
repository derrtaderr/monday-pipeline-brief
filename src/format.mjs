// Small formatting helpers shared by the brief renderer.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

export function money(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000).toLocaleString('en-US')}K`;
  return `$${Math.round(n)}`;
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
