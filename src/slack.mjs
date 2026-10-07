// Post the brief to a user-supplied Slack incoming webhook. The URL is a secret, so the
// result reports only a status code or "could not connect", never the URL itself.

import { toSlack } from './render.mjs';

// A Slack incoming webhook URL starts with https://hooks.slack.com/. One that still holds a
// placeholder ("..." as in the README example) or points anywhere else would fail every run
// after the brief is written, so the CLI rejects it up front.
export const BAD_WEBHOOK_MESSAGE = 'SLACK_WEBHOOK_URL is not a Slack incoming webhook URL (it should start with https://hooks.slack.com/ and hold no "..." placeholder or quotes). Paste the webhook URL Slack gave you, or remove the line to skip Slack.';

export function validSlackWebhook(url) {
  return url.startsWith('https://hooks.slack.com/') && !url.includes('...') && !url.includes('\u2026');
}

// Slack rejects message text much past 40,000 characters. Stay well under it.
export const SLACK_MAX = 35000;
const CUT_NOTE = '_Brief cut short for Slack. The full brief is in the saved file._';

export function slackText(markdown, max = SLACK_MAX) {
  const text = toSlack(markdown);
  if (text.length <= max) return text;
  const room = max - CUT_NOTE.length - 1;
  return `${text.slice(0, text.lastIndexOf('\n', room))}\n${CUT_NOTE}`;
}

export async function postToSlack(url, markdown, fetch = globalThis.fetch) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: slackText(markdown) }),
    });
    return res.ok ? { ok: true } : { ok: false, reason: `status ${res.status}` };
  } catch {
    return { ok: false, reason: 'could not connect' };
  }
}
