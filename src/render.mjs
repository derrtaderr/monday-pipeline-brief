// Write the brief as markdown, and convert it to Slack mrkdwn.

import { money, shortDate, daysBetween } from './format.mjs';

const STALE_TITLE = 'No next step, or no activity in 14+ days';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const who = (d) => `${d.name}, ${money(d.amount)}, ${d.owner}`;

function staleDetail({ deal, reason }, nextStepCheck) {
  if (reason === 'no-next-step') return 'no next step';
  if (deal.last_activity) return `no activity since ${shortDate(deal.last_activity)}`;
  return nextStepCheck ? 'next step set, no activity logged' : 'no activity logged';
}

export const SECTION_LIMIT = 10;

// rows are [deal, text] pairs, already sorted largest first. Show the top SECTION_LIMIT,
// then one line with how many more and what they add up to.
function capped(rows) {
  const lines = rows.slice(0, SECTION_LIMIT).map(([, text]) => `- ${text}`);
  const rest = rows.slice(SECTION_LIMIT);
  if (rest.length) lines.push(`- and ${rest.length} more (${money(rest.reduce((n, [d]) => n + d.amount, 0))})`);
  return lines;
}

function section(out, title, rows) {
  if (!rows.length) return;
  out.push(`**${title}** (${rows.length})`, ...capped(rows), '');
}

export function unknownStageLine({ count, total }) {
  if (!count) return null;
  const subject = count === 1 ? `1 deal (${money(total)}) is in a stage` : `${count} deals (${money(total)}) are in stages`;
  return `${subject} we couldn't read (archived or deleted in HubSpot), counted as open.`;
}

// "Last week" is only true when the previous snapshot is about a week old (6 to 8 days).
// Any other gap names the date and how long ago it was.
function comparisonWords(previousDate, date) {
  const gap = daysBetween(previousDate, date);
  const since = shortDate(previousDate);
  if (gap >= 6 && gap <= 8) return { week: true, compared: since, trend: 'on last week', newTitle: 'New this week', period: 'this week' };
  const ago = gap % 7 === 0 ? plural(gap / 7, 'week') : plural(gap, 'day');
  return { week: false, compared: `${since}, ${ago} ago`, trend: `since ${since}`, newTitle: `New since ${since}`, period: `since ${since}` };
}

export function renderBrief(r, { skipped = [] } = {}) {
  // The heading claims a week only when the comparison spans one (or there is none yet).
  const words = r.firstRun ? null : comparisonWords(r.previousDate, r.date);
  const heading = !words || words.week ? `week of ${shortDate(r.date)}` : shortDate(r.date);
  const out = [`# Monday pipeline brief, ${heading}`, ''];
  for (const s of skipped) out.push(`Skipped unreadable ${s.file} (${s.reason}).`);
  if (skipped.length) out.push('');
  const openLine = `Open pipeline ${money(r.open.total)} across ${plural(r.open.count, 'deal')}`;
  const staleRows = r.stale.map((s) => [s.deal, `${who(s.deal)}: ${staleDetail(s, r.nextStepCheck !== false)}`]);
  const staleTitle = r.nextStepCheck === false ? 'No activity in 14+ days' : STALE_TITLE;

  if (r.firstRun) {
    out.push(
      `${skipped.length ? 'No earlier snapshot could be read.' : 'This is the first snapshot.'} A comparison needs two weekly runs, so the week-over-week sections start next week.`,
      '',
      `${openLine}.`,
      '',
    );
    if (unknownStageLine(r.unknownStage)) out.push(unknownStageLine(r.unknownStage), '');
    section(out, staleTitle, staleRows);
    return out.join('\n');
  }

  const delta = r.open.total - r.previousOpenTotal;
  const trend = delta === 0 ? 'flat' : `${delta > 0 ? 'up' : 'down'} ${money(Math.abs(delta))}`;
  out.push(
    `Compared with the snapshot from ${words.compared}.`,
    '',
    `${openLine}, ${trend} ${words.trend}.`,
    `Closed ${closedCount(r.won, 'won')} and ${closedCount(r.lost, 'lost')}.`,
    '',
  );
  if (unknownStageLine(r.unknownStage)) out.push(unknownStageLine(r.unknownStage), '');
  if (r.lookFirst.length) {
    out.push('**Look at these first** (more than one warning sign)',
      ...capped(r.lookFirst.map((f) => [f.deal, `${who(f.deal)}: ${f.flags.join(', ')}`])), '');
  }
  const before = out.length;
  section(out, 'Slipped close dates', r.slipped.map((s) => [s.deal, `${who(s.deal)}: ${shortDate(s.from)} → ${shortDate(s.deal.close_date)} (+${s.days} days)`]));
  section(out, 'Moved back a stage', r.back.map((m) => [m.deal, `${who(m.deal)}: ${m.from} → ${m.deal.stage}`]));
  section(out, staleTitle, staleRows);
  section(out, 'Moved forward', r.forward.map((m) => [m.deal, `${who(m.deal)}: ${m.from} → ${m.deal.stage}`]));
  section(out, words.newTitle, r.newDeals.map((d) => [d, who(d)]));
  section(out, 'Closed', [...r.won, ...r.lost].map((d) => [d, `${who(d)}: ${d.status}`]));
  if (out.length === before && !r.lookFirst.length) out.push(`Nothing flagged ${words.period}.`, '');
  return out.join('\n');
}

function closedCount(deals, label) {
  return deals.length ? `${deals.length} ${label} (${money(sum(deals))})` : `0 ${label}`;
}

function sum(deals) {
  return deals.reduce((n, d) => n + d.amount, 0);
}

export function toSlack(markdown) {
  return markdown
    .split('\n')
    .map((line) => line.replace(/^# (.*)$/, '*$1*').replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/^- /, '• '))
    .join('\n');
}
