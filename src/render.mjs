// Write the brief as markdown, and convert it to Slack mrkdwn.

import { money, exactMoney, shortDate, daysBetween } from './format.mjs';
import { cents } from './bridge.mjs';

const STALE_TITLE = 'No next step, or no activity in 14+ days';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Every piece of CRM text (deal name, owner, stage label, pipeline label, group heading, and the
// label of a deal record link) is made safe for one Markdown line wherever it renders: line
// breaks become spaces; an & that would start a character reference (&name; &#1; &#x1;) becomes
// &amp;, and a < that would start an HTML tag, comment or <autolink> (< then a letter, /, ! or ?)
// becomes &lt;, so no raw HTML or autolink survives in any Markdown viewer while "R&D" or "A < B"
// print as typed; and brackets and backslashes are escaped, so no CRM text can
// end a line or become link markup, in Markdown or (via toSlack) Slack. (A bare web address
// inside a name stays plain text; Slack or GitHub may still auto-link it on display, which the
// brief cannot prevent without altering the name.) The name links to the HubSpot record when
// the snapshot holds the url (0.1 snapshots do not); parentheses in the url are escaped.
const oneLine = (text) => String(text ?? '').replace(/\s*[\r\n]+\s*/g, ' ');
const escapeName = (name) => oneLine(name)
  .replace(/&(?=[A-Za-z][A-Za-z0-9]*;|#[0-9]+;|#[xX][0-9a-fA-F]+;)/g, '&amp;')
  .replace(/<(?=[A-Za-z/!?])/g, '&lt;')
  .replace(/[[\]\\]/g, '\\$&');
const linked = (d) => (d.url
  ? `[${escapeName(d.name)}](${d.url.replace(/\(/g, '%28').replace(/\)/g, '%29')})`
  : escapeName(d.name));
const who = (d) => `${linked(d)}, ${money(d.amount)}, ${escapeName(d.owner)}`;

function staleDetail({ deal, reason }, nextStepCheck) {
  if (reason === 'no-next-step') return 'no next step';
  if (deal.last_activity) return `no activity since ${shortDate(deal.last_activity)}`;
  if (deal.created) return `no activity logged since it was created ${shortDate(deal.created)}`;
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

const BRIDGE_LINES = [
  ['new', 'New deals', 1], ['reopened', 'Reopened', 1], ['increases', 'Amount increases', 1],
  ['decreases', 'Amount decreases', -1], ['won', 'Won', -1], ['lost', 'Lost', -1],
  ['removed', 'Removed from HubSpot', -1], ['couldNotRebuild', 'Could not rebuild', 1],
];

// The reconciliation from the last open total to this one, in exact dollars so the printed
// lines add up. Zero lines are left out; with every line zero there is nothing to explain.
function bridgeLines(r) {
  const b = r.bridge;
  const steps = BRIDGE_LINES.filter(([key]) => b[key]?.cents);
  if (!steps.length) return [];
  // Stateless: how much of the start was rebuilt, and how much came from partly rebuilt deals.
  const sb = r.startBreakdown;
  const split = sb?.knownCount ? ` (${exactMoney(sb.rebuilt)} rebuilt + ${exactMoney(sb.known)} from ${plural(sb.knownCount, 'deal')} only partly rebuilt)` : '';
  return [
    '**How the open pipeline changed**',
    `- ${shortDate(r.previousDate)} open pipeline: ${exactMoney(b.start)}${split}`,
    ...steps.map(([key, label, sign]) => `- ${label}: ${sign > 0 ? '+' : '-'}${exactMoney(b[key].cents)} (${b[key].count})`),
    `- ${shortDate(r.date)} open pipeline: ${exactMoney(b.end)}`,
    '',
  ];
}

const amountChange = ({ deal, from, to }) =>
  `${who(deal)}: ${exactMoney(cents(from))} → ${exactMoney(cents(to))}${deal.status === 'open' ? '' : `, then ${deal.status}`}`;

const stageRow = (m) => [m.deal, `${who(m.deal)}: ${escapeName(m.from)} → ${escapeName(m.deal.stage)}`];

// The two ends of a pipeline move, as text. A label that two pipelines share, or the same label
// at both ends, is followed by the pipeline id, so a move never reads "Sales → Sales".
function pipelineEnds(r, fromId, fromLabel, d) {
  const toLabel = d.pipeline ?? d.pipeline_id;
  const count = new Map();
  for (const label of r.pipelineLabels?.values() ?? []) count.set(label, (count.get(label) ?? 0) + 1);
  const same = fromLabel === toLabel;
  const name = (id, label) => ((same || count.get(label) > 1) && id != null && id !== label ? `${label} (${id})` : label);
  return [escapeName(name(fromId, fromLabel)), escapeName(name(d.pipeline_id, toLabel))];
}

// A deal that closed straight into another pipeline says so, and when grouped by pipeline it
// also shows under the pipeline it left.
const closedRow = (r) => (d) => {
  const m = r.closedMoves?.get(d.id);
  if (!m) return [d, `${who(d)}: ${d.status}`];
  const [from, to] = pipelineEnds(r, m.fromPipelineId, m.fromPipeline, d);
  return [d, `${who(d)}: ${d.status}, moved from ${from} to ${to}`, { pipeline: [m.fromPipelineId ?? m.fromPipeline] }];
};

const transferRow = (r) => (t) => {
  const [from, to] = pipelineEnds(r, t.fromPipelineId, t.fromPipeline, t.deal);
  return [t.deal, `${who(t.deal)}: ${from} (${escapeName(t.fromStage)}) → ${to} (${escapeName(t.deal.stage)})`, { pipeline: [t.fromPipelineId ?? t.fromPipeline] }];
};

const overdueRows = (r) => r.overdue.map(({ deal, days }) => [deal, `${who(deal)}: close date was ${shortDate(deal.close_date)}, ${plural(days, 'day')} ago`]);

export const GROUP_BY = ['owner', 'pipeline'];
// Owner groups are keyed by owner name; pipeline groups by pipeline id (the label when a
// snapshot has no id), so a renamed pipeline stays one group and two with one label stay two.
const groupKey = (groupBy) => (d) => (groupBy === 'owner' ? d.owner ?? 'Unassigned' : d.pipeline_id ?? d.pipeline ?? 'No pipeline');

// Writes the deal sections, either flat or once per owner or pipeline. Returns whether any
// section had a row.
function dealSections(out, sections, r, groupBy) {
  if (!groupBy) {
    const before = out.length;
    for (const [title, rows] of sections) section(out, title, rows);
    return out.length > before;
  }
  const key = groupKey(groupBy);
  const label = (k) => (groupBy === 'pipeline' ? r.pipelineLabels?.get(k) ?? k : k);
  const groups = new Map();
  const group = (k) => {
    if (!groups.has(k)) groups.set(k, { key: k, name: String(label(k)), total: 0, count: 0 });
    return groups.get(k);
  };
  for (const d of r.openDeals) {
    const g = group(key(d));
    g.total += d.amount;
    g.count += 1;
  }
  // A row may also belong to other groups (a pipeline transfer shows under its old pipeline).
  const also = (row) => row[2]?.[groupBy] ?? [];
  for (const [, rows] of sections) for (const row of rows) [key(row[0]), ...also(row)].forEach(group);
  // Two pipelines with one label: each heading is followed by its id.
  const named = new Map();
  for (const g of groups.values()) named.set(g.name, (named.get(g.name) ?? 0) + 1);
  for (const g of groups.values()) if (named.get(g.name) > 1) g.name = `${g.name} (${g.key})`;
  const ordered = [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name) || String(a.key).localeCompare(String(b.key)));
  for (const g of ordered) {
    out.push(`## ${escapeName(g.name)}, open ${money(g.total)} across ${plural(g.count, 'deal')}`, '');
    const before = out.length;
    for (const [title, rows] of sections) section(out, title, rows.filter((row) => key(row[0]) === g.key || also(row).includes(g.key)));
    if (out.length === before) out.push('Nothing flagged.', '');
  }
  return true;
}

export function renderBrief(r, { skipped = [], groupBy = null } = {}) {
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
    dealSections(out, [['Close date passed', overdueRows(r)], [staleTitle, staleRows]], r, groupBy);
    return out.join('\n');
  }

  const delta = r.open.total - r.previousOpenTotal;
  const trend = delta === 0 ? 'flat' : `${delta > 0 ? 'up' : 'down'} ${money(Math.abs(delta))}`;
  out.push(
    r.stateless
      ? `Compared with HubSpot as of ${words.compared}, rebuilt from property history.`
      : `Compared with the snapshot from ${words.compared}.`,
    '',
    `${openLine}, ${trend} ${words.trend}${leftOut(r)}.`,
    `Closed ${closedCount(r.won, 'won')} and ${closedCount(r.lost, 'lost')}.`,
    '',
  );
  if (unknownStageLine(r.unknownStage)) out.push(unknownStageLine(r.unknownStage), '');
  out.push(...bridgeLines(r));
  const sections = [
    ['Look at these first', r.lookFirst.map((f) => [f.deal, `${who(f.deal)}: ${f.flags.join(', ')} (${f.reasons.join('; ')})`])],
    ['Close date passed', overdueRows(r)],
    ['Slipped close dates', r.slipped.map((s) => [s.deal, `${who(s.deal)}: ${shortDate(s.from)} → ${shortDate(s.deal.close_date)} (+${s.days} days${pushes(r, s.deal)})`])],
    ['Moved back a stage', r.back.map(stageRow)],
    [staleTitle, staleRows],
    ['Moved forward', r.forward.map(stageRow)],
    ['Changed stage', r.changedStage.map(stageRow)],
    ['Moved to another pipeline', r.transferred.map(transferRow(r))],
    ['Amount changed', r.amountChanged.map((a) => [a.deal, amountChange(a)])],
    [words.newTitle, r.newDeals.map((d) => [d, who(d)])],
    ['Reopened', r.reopened.map(({ deal, from }) => [deal, `${who(deal)}: was ${from}, now in ${escapeName(deal.stage)}`])],
    ['Closed', [...r.won, ...r.lost].map(closedRow(r))],
    ['Removed from HubSpot', r.removed.map((d) => [d, `${who(d)}: was open in ${escapeName(d.stage)}, not returned by HubSpot now (deleted, archived or merged)`])],
  ];
  if (r.stateless) sections.push([`Could not rebuild as of ${shortDate(r.previousDate)}`, (r.couldNotRebuild ?? []).map(couldNotRebuildRow(r))]);
  if (!dealSections(out, sections, r, groupBy)) out.push(`Nothing flagged ${words.period}.`, '');
  return out.join('\n');
}

// Stateless only. What the start total leaves out: each merged record counts as its sources.
function leftOut(r) {
  const sb = r.startBreakdown;
  if (!sb) return '';
  const parts = [
    sb.mergedSources ? `${plural(sb.mergedSources, 'deal')} merged since then` : null,
    sb.unknownCount ? `${plural(sb.unknownCount, 'deal')} whose state then could not be rebuilt` : null,
  ].filter(Boolean);
  return parts.length ? ` (the ${shortDate(r.previousDate)} total leaves out ${parts.join(' and ')})` : '';
}

// Stateless only. A deal whose close date moved later two or more times since the comparison
// date says how many; one push is the Slipped line itself.
const pushes = (r, deal) => {
  const n = r.pushes?.get(deal.id) ?? 0;
  return n >= 2 ? `, pushed ${n} times` : '';
};

const FIELD_WORDS = { stage_id: 'stage', status: 'stage', stage_order: 'stage', pipeline_id: 'pipeline', amount: 'amount', close_date: 'close date' };
const listWords = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] ?? '');

// One deal HubSpot's history could not rebuild at the comparison date: a merge since then (its
// sources named), or more than 20 changes to a property the comparison reads (HubSpot keeps 20).
// The deal shows as it is today, or as it was then when it is gone today.
const couldNotRebuildRow = (r) => (u) => {
  const then = shortDate(r.previousDate);
  // Gone today with no row at T (a merge result archived since): its id is all there is.
  const deal = u.deal ?? u.atT ?? { id: u.id, name: `Deal ${u.id}`, amount: 0, owner: null, pipeline_id: null, url: null };
  const label = u.deal || u.atT ? who(deal) : escapeName(deal.name);
  let text;
  if (u.reason === 'layout') {
    text = `its stage on ${then} is not in the pipeline settings HubSpot kept for that date (a deleted pipeline or stage), so its state then is unknown`;
  } else if (u.reason === 'merged') {
    text = `merged since ${then} from records ${listWords(u.sources ?? [])}, so what they held then is unknown`;
  } else {
    const words = listWords([...new Set(u.fields.map((f) => FIELD_WORDS[f] ?? f))]);
    const state = u.partial ? `; ${u.atT.status} then${u.atT.status === 'open' ? ` at ${exactMoney(cents(u.atT.amount))}` : ''}` : ', so its state then is unknown';
    text = `more than 20 changes to its ${words} since ${then}${state}`;
  }
  // The amount then, when its history can answer, even if the state then cannot be rebuilt.
  if (!u.partial && u.atT && !u.fields.includes('amount')) text += ` (amount then ${exactMoney(cents(u.atT.amount))})`;
  const removed = r.removed?.some((x) => x.id === u.id) ? ' (also under Removed from HubSpot)' : '';
  return [deal, `${label}: ${text}${u.deal ? '' : `, gone from HubSpot now${removed}`}`];
};

function closedCount(deals, label) {
  return deals.length ? `${deals.length} ${label} (${money(sum(deals))})` : `0 ${label}`;
}

function sum(deals) {
  return deals.reduce((n, d) => n + d.amount, 0);
}

const slackEscape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Markdown links become Slack links; a [ after a backslash is escaped CRM text, never the start
// of a link. Everything else on the line has Markdown escapes undone (backslashes, and the
// &amp; and &lt; that escapeName writes, in one pass, so nothing is decoded twice) and then has
// every &, < and > escaped for Slack once, so no text from the CRM can become a Slack link or mention.
const LINK = /(?<!\\)\[((?:\\.|[^\]\\])*)\]\((https:\/\/[^)\s]+)\)/g;
const DECODE = { '&amp;': '&', '&lt;': '<' };
const slackPlain = (text) => slackEscape(text.replace(/\\([[\]\\])/g, '$1').replace(/&(?:amp|lt);/g, (e) => DECODE[e]));
function slackLine(line) {
  let out = '';
  let at = 0;
  for (const m of line.matchAll(LINK)) {
    out += slackPlain(line.slice(at, m.index)) + `<${m[2]}|${slackPlain(m[1])}>`;
    at = m.index + m[0].length;
  }
  return out + slackPlain(line.slice(at));
}

export function toSlack(markdown) {
  return markdown
    .split('\n')
    .map((line) => slackLine(line)
      .replace(/^##? (.*)$/, '*$1*').replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/^- /, '• '))
    .join('\n');
}
