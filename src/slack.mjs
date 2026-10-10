// Post the brief to a user-supplied Slack incoming webhook. The URL is a secret, so the
// result reports only a status code or "could not connect", never the URL itself.

import { basename } from 'node:path';
import { toSlack, SECTION_LIMIT } from './render.mjs';

// A Slack incoming webhook URL starts with https://hooks.slack.com/. One that still holds a
// placeholder ("..." as in the README example) or points anywhere else would fail every run
// after the brief is written, so the CLI rejects it up front.
export const BAD_WEBHOOK_MESSAGE = 'SLACK_WEBHOOK_URL is not a Slack incoming webhook URL (it should start with https://hooks.slack.com/ and hold no "..." placeholder or quotes). Paste the webhook URL Slack gave you, or remove the line to skip Slack.';

export function validSlackWebhook(url) {
  return url.startsWith('https://hooks.slack.com/') && !url.includes('...') && !url.includes('\u2026');
}

// Slack rejects message text much past 40,000 characters. Stay well under it.
export const SLACK_MAX = 35000;
// Fewer rows per section to try, in order, before the text is cut.
const FEWER_ROWS = [5, 3, 1];

// brief is the Markdown brief, or a function of the rows per section that renders it. Too long
// for Slack, a renderable brief is shown with fewer rows per section first, so every group and
// section keeps its heading and its "and N more" line; only if one row each does not fit is the
// text cut at a line. saved is the full brief's file, or null when nothing was saved.
export function slackText(brief, { max = SLACK_MAX, saved = null } = {}) {
  const render = typeof brief === 'function' ? brief : () => brief;
  const text = toSlack(render(SECTION_LIMIT));
  if (text.length <= max) return text;
  // The file name only: a local path would show the home folder to everyone in the channel.
  const where = saved ? `The full brief is saved as ${basename(saved)} on the machine that ran it.` : 'Run with --out FILE for the full brief.';
  if (typeof brief === 'function') {
    for (const limit of FEWER_ROWS) {
      const note = `_Each section shows its ${limit === 1 ? 'largest deal' : `${limit} largest deals`} here to fit Slack. ${where}_`;
      const fewer = toSlack(render(limit));
      if (fewer.length + note.length + 1 <= max) return `${fewer}\n${note}`;
    }
  }
  const note = `_Brief cut short for Slack. ${where}_`;
  const room = max - note.length - 1;
  return `${text.slice(0, text.lastIndexOf('\n', room))}\n${note}`;
}

export async function postToSlack(url, brief, fetch = globalThis.fetch, { saved = null } = {}) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: slackText(brief, { saved }) }),
    });
    return res.ok ? { ok: true } : { ok: false, reason: `status ${res.status}` };
  } catch {
    return { ok: false, reason: 'could not connect' };
  }
}
