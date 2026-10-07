import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demoBrief } from '../src/cli.mjs';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('readme matches demo output', () => {
  const m = /<!-- demo-output:start -->\n```markdown\n([\s\S]*?)```\n<!-- demo-output:end -->/.exec(README);
  assert.ok(m, 'README needs a ```markdown block between the demo-output markers');
  assert.equal(m[1], demoBrief(), 'README example is stale: paste the output of `node bin/monday-brief.mjs demo`');
});

test('readme states exactly what the stale next step check reads', () => {
  assert.match(README, /hs_next_step/);
  assert.match(README, /notes_last_updated/);
});

test('readme lists the two read scopes', () => {
  assert.match(README, /crm\.objects\.deals\.read/);
  assert.match(README, /crm\.objects\.owners\.read/);
});

test('readme only shows commands that exist for clone and npx users', () => {
  assert.doesNotMatch(README, /`monday-brief /, 'there is no global monday-brief command for clone users');
  assert.match(README, /node bin\/monday-brief\.mjs demo/);
  assert.match(README, /npx github:derrtaderr\/monday-pipeline-brief run/);
});

function block(lang) {
  const m = new RegExp('```' + lang + '\\n([\\s\\S]*?)```').exec(README);
  assert.ok(m, `README needs a ${lang} block`);
  return m[1];
}

test('scheduled runs use the same snapshot folder as the manual quickstart run', () => {
  const quickstart = README.slice(README.indexOf('## Five minute quickstart'), README.indexOf('### Options'));
  const schedule = README.slice(README.indexOf('### Schedule it weekly'), README.indexOf('## Exactly what each section checks'));
  assert.match(quickstart, /~\/\.monday-pipeline-brief/);
  assert.match(schedule, /~\/\.monday-pipeline-brief\/run\.log/);
  for (const text of [quickstart, schedule]) {
    assert.doesNotMatch(text, /MONDAY_BRIEF_DIR=|--dir |pipeline-snapshots/, 'a second folder would split history');
  }
});

test('cron and launchd recipes use an absolute node path from `which node` and the same command', () => {
  const RUN = '/path/to/node /path/to/monday-pipeline-brief/bin/monday-brief.mjs run';
  const cron = block('cron');
  const plist = block('xml');
  assert.match(README, /`which node`/);
  for (const recipe of [cron, plist]) {
    assert.ok(recipe.includes(RUN), 'recipe must call node by absolute path');
    assert.doesNotMatch(recipe, /\/usr\/local\/bin\/node|(^|[\s>])node bin\//);
    assert.doesNotMatch(recipe, />>/, 'a shell redirect into a folder that may not exist fails before node starts');
  }
});

test('readme says where scheduled runs log and how to check one ran', () => {
  assert.match(README, /tail ~\/\.monday-pipeline-brief\/run\.log/);
  assert.match(README, /\/tmp\/monday-brief\.launchd\.log/);
  assert.match(README, /launchctl list \| grep monday-brief/);
});

test('the exit code table is true for every write failure', () => {
  const table = README.slice(README.indexOf('## Exit codes'), README.indexOf('## Limitations'));
  assert.match(table, /\| 1 \| .*--out.*Nothing is fetched from HubSpot/);
  assert.match(table, /\| 4 \| .*whether today's snapshot was saved/);
  assert.match(table, /\| 2 \| .*a line in `run\.log`/);
});

test('readme describes the skipped-week wording the brief actually uses', () => {
  assert.match(README, /Compared with the snapshot from Sep 21, 2 weeks ago/);
  assert.match(README, /Skipped unreadable snapshot-/);
});

test('the launchd recipe never sends the brief to a world-readable /tmp log', () => {
  const plist = block('xml');
  assert.match(plist, /<key>StandardOutPath<\/key><string>\/dev\/null<\/string>/);
  assert.doesNotMatch(plist, /StandardOutPath<\/key><string>\/tmp/);
  assert.match(README, /0700/);
  assert.match(README, /0600/);
});

test('readme warns macOS users that scheduled jobs cannot read Documents, Desktop or Downloads (TCC)', () => {
  const schedule = README.slice(README.indexOf('### Schedule it weekly'), README.indexOf('## Exactly what each section checks'));
  assert.match(schedule, /~\/Documents/);
  assert.match(schedule, /~\/Desktop/);
  assert.match(schedule, /~\/Downloads/);
  assert.match(schedule, /Full Disk Access/);
  assert.doesNotMatch(README, /usually a wrong `\/path\/to\/node`\./);
  assert.match(schedule, /No new line on a Monday[^\n]*(TCC|privacy)/);
});

test('readme explains scheduled versus ad-hoc runs and a Mac asleep at the scheduled time', () => {
  const schedule = README.slice(README.indexOf('### Schedule it weekly'), README.indexOf('## Exactly what each section checks'));
  assert.match(schedule, /by hand mid-week/);
  assert.match(schedule, /at least 6 days old/);
  assert.match(schedule, /asleep/);
  assert.match(schedule, /2 weeks ago/);
  assert.match(schedule, /launchctl bootstrap gui\/\$\(id -u\)/);
  assert.match(schedule, /launchctl load/); // mentioned as the fallback
});

test('the exit code table names unexpected errors', () => {
  const table = README.slice(README.indexOf('## Exit codes'), README.indexOf('## Limitations'));
  assert.match(table, /\| 1 \| .*unexpected error/i);
});

test('readme permissions line applies to what the tool creates; existing folders and files keep theirs', () => {
  assert.match(README, /folders and files the tool creates/);
  assert.match(README, /existing ones keep their permissions/);
});

test('the macOS privacy note also covers --dir and --out inside protected folders', () => {
  const schedule = README.slice(README.indexOf('### Schedule it weekly'), README.indexOf('## Exactly what each section checks'));
  assert.match(schedule, /--dir.*--out.*(Documents|protected)|--out.*--dir.*(Documents|protected)/);
});

test('the repo ignores nothing it does not create', () => {
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.doesNotMatch(ignore, /pipeline-snapshots/);
});

test('every HUBSPOT_TOKEN placeholder in the readme is one the token check rejects, so it cannot be run literally', async () => {
  const { validToken } = await import('../src/hubspot.mjs');
  const values = [...README.matchAll(/HUBSPOT_TOKEN="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(values.length >= 2, 'quickstart and env file both show the token line');
  for (const v of values) assert.equal(validToken(v), false, `placeholder ${v} passes the token check`);
});

const scheduleSection = () => README.slice(README.indexOf('### Schedule it weekly'), README.indexOf('## Exactly what each section checks'));

test('the launchd recipe shows how to test it now and how to reinstall after editing', () => {
  const s = scheduleSection();
  assert.match(s, /launchctl kickstart -k gui\/\$\(id -u\)\/com\.example\.monday-brief/);
  assert.match(s, /tail ~\/\.monday-pipeline-brief\/run\.log/);
  const bootout = s.indexOf('launchctl bootout gui/$(id -u)/com.example.monday-brief');
  assert.ok(bootout > 0, 'reinstall step uses bootout');
  assert.ok(s.indexOf('launchctl bootstrap gui/$(id -u)', bootout) > bootout, 'bootstrap again after bootout');
});

test('the cron recipe shows how to test it now by running the exact cron line by hand', () => {
  const s = scheduleSection();
  const cronLine = block('cron').trim().replace(/^(\S+\s+){5}/, '');
  assert.ok(s.includes(`/bin/sh -c '${cronLine}'`), 'the cron command, run by hand in the same shell cron uses');
});

test('the readme shows how to create the env file (chmod 600) and the LaunchAgents folder', () => {
  const s = scheduleSection();
  assert.match(s, /chmod 600 ~\/\.monday-brief\.env/);
  assert.match(s, /mkdir -p ~\/Library\/LaunchAgents/);
  const create = s.indexOf('chmod 600 ~/.monday-brief.env');
  assert.match(s.slice(create - 400, create), /touch ~\/\.monday-brief\.env|cat > ~\/\.monday-brief\.env/);
});

test('the /path/to placeholders in the schedule recipes are called out right after each recipe', () => {
  const s = scheduleSection();
  for (const lang of ['cron', 'xml']) {
    const end = s.indexOf('```', s.indexOf('```' + lang) + 3) + 3;
    assert.match(s.slice(end, end + 300), /\/path\/to\/node.*\/path\/to\/monday-pipeline-brief|Replace both `\/path\/to/, `${lang} recipe has a placeholder callout`);
  }
});

test('troubleshooting names a missing or misnamed env file as a top cause of no new line on a Monday', () => {
  const s = scheduleSection();
  const para = s.slice(s.indexOf('No new line on a Monday'));
  assert.match(para.slice(0, 600), /~\/\.monday-brief\.env/);
});

test('the readme marks the release v0.1, early, says what it was tested against, and asks for reports', () => {
  const top = README.slice(0, README.indexOf('## What the brief looks like'));
  assert.match(top, /v0\.1, early/);
  assert.match(top, /HubSpot's published API specs/);
  assert.match(top, /not yet confirmed on many real portals/);
  assert.match(top, /GitHub Issues/);
  assert.match(top, /Discussions/);
});

test('the exit code table and the flow name a SLACK_WEBHOOK_URL that is not a Slack webhook as a setup error', () => {
  const table = README.slice(README.indexOf('## Exit codes'), README.indexOf('## Limitations'));
  assert.match(table, /\| 1 \| [^\n]*`SLACK_WEBHOOK_URL`[^\n]*Nothing is fetched from HubSpot/);
  const flow = readFileSync(new URL('../.vibecodepm/flow.md', import.meta.url), 'utf8');
  assert.match(flow, /\| SLACK_WEBHOOK_URL is a placeholder or not a Slack webhook URL \| "SLACK_WEBHOOK_URL is not a Slack incoming webhook URL[^|]*\| 1 \| run\.log line only \|/);
});

test('the env file example comments the optional Slack line out, and every Slack URL shown is one the CLI rejects', async () => {
  const { validSlackWebhook } = await import('../src/slack.mjs');
  const s = scheduleSection();
  const env = s.slice(s.indexOf('export HUBSPOT_TOKEN='), s.indexOf('```', s.indexOf('export HUBSPOT_TOKEN=')));
  assert.match(env, /^# export SLACK_WEBHOOK_URL=/m, 'the optional line is commented out');
  assert.doesNotMatch(env, /^export SLACK_WEBHOOK_URL=/m);
  const urls = [...README.matchAll(/SLACK_WEBHOOK_URL="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(urls.length >= 2);
  for (const u of urls) assert.equal(validSlackWebhook(u), false, `${u} would be posted to`);
});

test('each schedule recipe has you fill in the /path/to placeholders before installing it, then test it', () => {
  const s = scheduleSection();
  const callout = /Replace both placeholders, `\/path\/to\/node` and `\/path\/to\/monday-pipeline-brief`/i;
  const launchd = s.slice(s.indexOf('**launchd (macOS)**'), s.indexOf('**After editing the plist**'));
  const fill = launchd.search(callout);
  const check = launchd.indexOf('grep /path/to ~/Library/LaunchAgents/com.example.monday-brief.plist');
  const install = launchd.indexOf('launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.monday-brief.plist');
  const kick = launchd.indexOf('launchctl kickstart');
  assert.ok(fill > 0 && launchd.indexOf('```xml') < fill, 'launchd placeholder callout follows the plist');
  assert.ok(check > fill, 'a check that no placeholder is left, since plutil -lint passes an unfilled plist');
  assert.ok(install > check, 'bootstrap comes after the fill-in and the check');
  assert.ok(kick > install, 'test it now comes after bootstrap');
  const cron = s.slice(s.indexOf('**cron (Linux or macOS)**'), s.indexOf('**launchd (macOS)**'));
  const cronFill = cron.search(callout);
  const crontab = cron.indexOf('crontab -e');
  assert.ok(cronFill > 0 && cron.indexOf('```cron') < cronFill, 'cron placeholder callout follows the cron line');
  assert.ok(crontab > cronFill, 'crontab -e comes after the fill-in');
  assert.ok(cron.indexOf('Test the cron job now') > crontab);
});

test('the cron recipe sends stdout to /dev/null like launchd, and says run.log is the record', () => {
  const cron = block('cron').trim();
  assert.match(cron, /monday-brief\.mjs run > \/dev\/null$/);
  const s = scheduleSection();
  const after = s.slice(s.indexOf('```cron'), s.indexOf('**Test the cron job now.**'));
  assert.match(after, /run\.log` is the record/);
  assert.match(after, /local mail/);
});

test('the env file section says MONDAY_BRIEF_DIR must be absolute or start with ~, and why', () => {
  const s = scheduleSection();
  const env = s.slice(s.indexOf('Put the secrets in a file'), s.indexOf('**cron (Linux or macOS)**'));
  assert.match(env, /`MONDAY_BRIEF_DIR`[^\n]*absolute[^\n]*`~`[^\n]*working (directory|folder)/);
});

test('flow.md names a missing or misnamed env file as a cause of a scheduled run that did not happen', () => {
  const flow = readFileSync(new URL('../.vibecodepm/flow.md', import.meta.url), 'utf8');
  const state = flow.split('\n').find((l) => l.startsWith('| Scheduled run did not happen |'));
  assert.ok(state);
  assert.match(state, /missing or misnamed `~\/\.monday-brief\.env`/);
});

test('limitations say an open custom stage at 0% with no isClosed would be counted as lost', () => {
  const lim = README.slice(README.indexOf('## Limitations'), README.indexOf('## Did it help?'));
  assert.match(lim, /open custom stage set to 0% probability[^\n]*`isClosed`[^\n]*counted as lost/);
});

const QUICKSTART = README.slice(README.indexOf('## Five minute quickstart'), README.indexOf('### Options'));

test('the quickstart leads with a HubSpot service key and keeps a short private app path for older accounts', () => {
  const serviceKey = QUICKSTART.indexOf('Create a service key');
  const privateApp = QUICKSTART.indexOf('Create a private app');
  assert.ok(serviceKey > -1, 'quickstart names the "Create a service key" button');
  assert.ok(privateApp > serviceKey, 'the private app path comes after the service key path');
  assert.match(QUICKSTART, /Settings, then Development, then Legacy Apps/);
  assert.match(QUICKSTART, /older accounts/i);
  assert.doesNotMatch(README, /project-based/i, 'never send users to a project-based app');
});

test('the quickstart asks for exactly the two read scopes, no write scope', () => {
  assert.match(QUICKSTART, /`crm\.objects\.deals\.read`/);
  assert.match(QUICKSTART, /`crm\.objects\.owners\.read`/);
  assert.doesNotMatch(README, /crm\.objects\.deals\.write/);
});

test('the readme says how to revoke a service key', () => {
  assert.match(README, /Service Keys[^\n]*Delete/);
});

test('the readme says, honestly, that it has run on one real HubSpot portal', () => {
  assert.match(README, /one real HubSpot portal/);
  assert.match(README, /custom pipeline/);
  assert.match(README, /service key/);
  assert.match(README, /test data/);
});

test('the readme stale definition covers deals with no logged activity by their creation date', () => {
  assert.match(README, /createdate/);
  assert.match(README, /created less than 14 days ago/);
});
