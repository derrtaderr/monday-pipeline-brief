import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demoBrief } from '../src/cli.mjs';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
// Scheduling stored mode with cron or launchd is an appendix at the end of the README.
const SCHEDULE = '## Appendix: schedule stored mode with cron or launchd';
const scheduleSection = () => {
  assert.ok(README.includes(SCHEDULE), 'README needs the stored-mode scheduling appendix');
  return README.slice(README.indexOf(SCHEDULE));
};

test('readme matches demo output', () => {
  const m = /<!-- demo-output:start -->\n```markdown\n([\s\S]*?)```\n<!-- demo-output:end -->/.exec(README);
  assert.ok(m, 'README needs a ```markdown block between the demo-output markers');
  assert.equal(m[1], demoBrief(), 'README example is stale: paste the output of `node bin/monday-brief.mjs demo`');
});

test('readme grouped example matches demo --group-by owner output', () => {
  const m = /<!-- demo-grouped-output:start -->\n```markdown\n([\s\S]*?)```\n<!-- demo-grouped-output:end -->/.exec(README);
  assert.ok(m, 'README needs a ```markdown block between the demo-grouped-output markers');
  assert.equal(m[1], demoBrief({ groupBy: 'owner' }), 'README grouped example is stale: paste the output of `node bin/monday-brief.mjs demo --group-by owner`');
});

test('readme states exactly what the stale next step check reads', () => {
  assert.match(README, /hs_next_step/);
  assert.match(README, /notes_last_updated/);
});

test('readme lists the three read scopes', () => {
  assert.match(README, /crm\.objects\.deals\.read/);
  assert.match(README, /crm\.objects\.owners\.read/);
  assert.match(README, /settings\.currencies\.read/);
});

test('readme only shows commands that exist for clone and npx users', () => {
  assert.doesNotMatch(README, /`monday-brief /, 'there is no global monday-brief command for clone users');
  assert.match(README, /node bin\/monday-brief\.mjs demo/);
  assert.match(README, /npx github:derrtaderr\/monday-pipeline-brief#v\d+\.\d+\.\d+ run/, 'npx commands pin a release tag');
  assert.doesNotMatch(README, /npx (--yes )?github:derrtaderr\/monday-pipeline-brief (run|demo)/, 'no unpinned npx command');
});

function block(lang) {
  const m = new RegExp('```' + lang + '\\n([\\s\\S]*?)```').exec(README);
  assert.ok(m, `README needs a ${lang} block`);
  return m[1];
}

test('scheduled runs use the same snapshot folder as the manual quickstart run', () => {
  const quickstart = README.slice(README.indexOf('## Five minute quickstart'), README.indexOf('### Options'));
  const schedule = scheduleSection();
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
  const schedule = scheduleSection();
  assert.match(schedule, /~\/Documents/);
  assert.match(schedule, /~\/Desktop/);
  assert.match(schedule, /~\/Downloads/);
  assert.match(schedule, /Full Disk Access/);
  assert.doesNotMatch(README, /usually a wrong `\/path\/to\/node`\./);
  assert.match(schedule, /No new line on a Monday[^\n]*(TCC|privacy)/);
});

test('readme explains scheduled versus ad-hoc runs and a Mac asleep at the scheduled time', () => {
  const schedule = scheduleSection();
  assert.match(schedule, /by hand mid-week/);
  assert.match(schedule, /7 or 8 days old/);
  assert.match(schedule, /Tuesday/);
  const flow = readFileSync(new URL('../.vibecodepm/flow.md', import.meta.url), 'utf8');
  assert.match(flow.split('\n').find((l) => l.startsWith('| Ad-hoc mid-week run')), /7 or 8 days old/);
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
  const schedule = scheduleSection();
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

test('the readme marks the release v0.3, early, says what it was tested against, and asks for reports', () => {
  const top = README.slice(0, README.indexOf('## What the brief looks like'));
  assert.match(top, /v0\.3, early/);
  assert.match(top, /stateless mode[^\n]*test portal/i);
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

test('the quickstart asks for exactly three read scopes, no write scope', () => {
  assert.match(QUICKSTART, /`crm\.objects\.deals\.read`/);
  assert.match(QUICKSTART, /`crm\.objects\.owners\.read`/);
  assert.match(QUICKSTART, /`settings\.currencies\.read`/);
  assert.match(QUICKSTART, /exactly these three read scopes/);
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

test('the opener promises the outcome and claims nothing about what HubSpot cannot do', () => {
  const top = README.slice(0, README.indexOf('## What the brief looks like'));
  assert.match(top.split('\n')[2], /^Know what changed in your HubSpot pipeline before Monday's meeting\./);
  assert.doesNotMatch(top, /HubSpot stores|only current state|right now, not what changed|can't produce|cannot produce/i);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.doesNotMatch(pkg.description, /can't produce|cannot produce/i);
});

test('help text, the options table and the section docs describe the same large-deal default', async () => {
  const { usage } = await import('../src/cli.mjs');
  const PHRASE = 'the largest open deals, at most 10% of them (at least one, unless every deal above $0 has the same amount and they outnumber that limit)';
  assert.ok(usage().replace(/\s+/g, ' ').includes(PHRASE), 'help text');
  const table = README.slice(README.indexOf('### Options'), README.indexOf('### Run it every week'));
  assert.ok(table.split('\n').find((l) => l.startsWith('| Large deal')).includes(PHRASE), 'options table');
  assert.match(README, /tied on the same amount[^\n]*left out[^\n]*lowest HubSpot record id/);
  assert.match(README, /every open deal with an amount is the same size, no deal is large/);
  const flow = readFileSync(new URL('../.vibecodepm/flow.md', import.meta.url), 'utf8');
  assert.ok(flow.replace(/\s+/g, ' ').includes(PHRASE), 'flow.md 6a');
  const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.doesNotMatch(log, /When every open deal with an amount is the same size, no deal is a large deal\./, 'changelog short form is broader than the rule');
  assert.doesNotMatch(README + usage(), /top 10% of (your )?open deals/);
});

test('the readme and flow.md list every section a first-run brief prints', () => {
  const quick = README.slice(README.indexOf('## Five minute quickstart'), README.indexOf('### Options'));
  assert.match(quick, /first brief[^\n]*open pipeline total[^\n]*Close date passed[^\n]*stale next step list/);
  const flow = readFileSync(new URL('../.vibecodepm/flow.md', import.meta.url), 'utf8');
  assert.match(flow.split('\n').find((l) => l.startsWith('4. **First run state')), /"Close date passed"/);
  assert.match(flow.split('\n').find((l) => l.startsWith('| First run, one snapshot |')), /close date passed/);
});

test('the readme demo section says the demo links point at a made-up portal', () => {
  const demo = README.slice(README.indexOf('## What the brief looks like'), README.indexOf('<!-- demo-output:start -->'));
  assert.match(demo, /links point at a made-up HubSpot portal/);
});

test('limitations say Slack formatting characters in HubSpot names still format in Slack', () => {
  const lim = README.slice(README.indexOf('## Limitations'), README.indexOf('## Did it help?'));
  assert.match(lim, /Slack[^\n]*\*bold\*[^\n]*links, mentions and HTML in names are always neutralised/);
});

test('the readme and changelog say a live run lists Changed stage when the old stage was deleted', () => {
  const line = README.split('\n').find((l) => l.startsWith('- **Moved back a stage / Moved forward / Changed stage.**'));
  assert.match(line, /On a live run[^\n]*Changed stage[^\n]*deleted/);
  assert.doesNotMatch(line, /written by v0\.1 and has no stored stage order/);
  const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.doesNotMatch(log, /A baseline from 0\.1 whose stage orders give no direction/);
});

test('the exit code table names every usage error: bad --group-by, bad --large-deal, demo --dir', () => {
  const table = README.slice(README.indexOf('## Exit codes'), README.indexOf('## Limitations'));
  const one = table.split('\n').find((l) => l.startsWith('| 1 |'));
  assert.match(one, /--group-by/);
  assert.match(one, /--large-deal/);
  assert.match(one, /demo --dir/);
});

test('the quickstart leads with the stateless path: run it once against your portal', () => {
  const stateless = QUICKSTART.search(/npx github:derrtaderr\/monday-pipeline-brief#v\d+\.\d+\.\d+ run --since 7d/);
  assert.ok(stateless > 0, 'the quickstart runs --since 7d');
  assert.match(QUICKSTART, /run it once against your portal/i);
  const stored = QUICKSTART.search(/npx github:derrtaderr\/monday-pipeline-brief(#v[\d.]+)? run\n/);
  assert.ok(stored === -1 || stored > stateless, 'stored mode comes after the stateless path');
});

test('the GitHub Action example in the readme is the workflow file under examples/, keeps no state, and never prints the brief to the log', () => {
  const file = readFileSync(new URL('../examples/github-action.yml', import.meta.url), 'utf8');
  const m = /```yaml\n([\s\S]*?)```/.exec(README);
  assert.ok(m, 'README needs a yaml block');
  assert.equal(m[1], file, 'README example is stale: paste examples/github-action.yml');
  assert.match(file, /run --since 7d > \/dev\/null/);
  const guard = file.indexOf('test -n "$SLACK_WEBHOOK_URL"');
  assert.ok(guard > 0 && guard < file.indexOf('npx'), 'the job fails fast when the Slack secret is missing, before it reads HubSpot');
  assert.match(file, /secrets\.HUBSPOT_TOKEN/);
  assert.doesNotMatch(file, /actions\/cache|upload-artifact/, 'stateless: nothing is kept between runs');
  assert.match(README, /examples\/github-action\.yml/);
  assert.match(README, /\.github\/workflows\//);
});

test('the exit code table names exit 5, stateless mode refused, and the stateless usage errors', () => {
  const table = README.slice(README.indexOf('## Exit codes'), README.indexOf('## Limitations'));
  assert.match(table, /\| 5 \| [^\n]*more than one currency[^\n]*settings\.currencies\.read/);
  const one = table.split('\n').find((l) => l.startsWith('| 1 |'));
  assert.match(one, /--since/);
  assert.match(one, /--as-of/);
});

test('limitations no longer claim the tool cannot rebuild earlier weeks, and name what stateless mode loses', () => {
  const lim = README.slice(README.indexOf('## Limitations'), README.indexOf('## Did it help?'));
  assert.doesNotMatch(lim, /It cannot reconstruct earlier weeks\./);
  const s = README.slice(README.indexOf('## Stateless mode'), README.indexOf('## Exactly what each section checks'));
  for (const re of [/merge/i, /20 /, /restored/i, /permanently deleted|hard delete/i, /more than one currency/, /archived[^\n]*moments|seconds/i]) assert.match(s, re);
});

test('the options table lists --since, --as-of and MONDAY_BRIEF_SINCE', () => {
  const table = README.slice(README.indexOf('### Options'), README.indexOf('### Run it every week'));
  assert.match(table, /--since 7d/);
  assert.match(table, /--as-of/);
  assert.match(table, /MONDAY_BRIEF_SINCE/);
});

test('Did it help? and metrics.md count a stateless first run with changes as activation', () => {
  const ask = README.slice(README.indexOf('## Did it help?'), README.indexOf('## Development'));
  assert.match(ask, /--since 7d/);
  assert.match(ask, /first run/i);
  const metrics = readFileSync(new URL('../.vibecodepm/metrics.md', import.meta.url), 'utf8');
  const v03 = metrics.slice(metrics.indexOf('## v0.3'));
  assert.ok(metrics.includes('## v0.3'), 'metrics.md has a v0.3 section');
  assert.match(v03, /first `run --since 7d`/);
  assert.match(v03, /activation/i);
});

test('the README and the Action pin the release this package.json describes', () => {
  const action = readFileSync(new URL('../examples/github-action.yml', import.meta.url), 'utf8');
  for (const [name, text] of [['README', README], ['Action', action]]) {
    const pins = [...text.matchAll(/github:derrtaderr\/monday-pipeline-brief#(\S+)/g)].map((m) => m[1]);
    assert.ok(pins.length, `${name} pins a release`);
    for (const pin of pins) assert.equal(pin, `v${VERSION}`, `${name} pins #${pin}, package.json is ${VERSION}`);
  }
});

// F3: a git tag can be moved by whoever controls the repository, so pinning the tag is not a
// guarantee; a commit SHA is. Every action the workflow uses is pinned by full commit SHA.
test('the pinning note is honest about tags and says how to pin a commit SHA instead', () => {
  assert.doesNotMatch(README, /never runs with your HubSpot token until you change the tag/);
  const note = README.slice(README.indexOf('### Run it every week with GitHub Actions'), README.indexOf('## Stateless mode'));
  assert.match(note, /tag can be moved/);
  assert.ok(note.includes(`git ls-remote https://github.com/derrtaderr/monday-pipeline-brief refs/tags/v${VERSION}`), 'how to find the SHA');
  const action = readFileSync(new URL('../examples/github-action.yml', import.meta.url), 'utf8');
  assert.match(action, /# [^\n]*commit SHA[^\n]*\n/);
  const uses = [...action.matchAll(/uses: (\S+)(.*)/g)];
  assert.ok(uses.length);
  for (const [, ref, rest] of uses) {
    assert.match(ref, /@[0-9a-f]{40}$/, `${ref} is pinned by full commit SHA`);
    assert.match(rest, /# v\d+\.\d+\.\d+/, `${ref} says which version the SHA is`);
  }
});

// F7: amount_in_home_currency moves with exchange rates, so stored mode on a multi-currency
// portal is not simply "works": rate moves show as amount changes, labelled when the tool can tell.
test('the readme and the refusal no longer say stored mode simply works on a multi-currency portal', async () => {
  const { MULTI_CURRENCY_MESSAGE } = await import('../src/stateless.mjs');
  assert.doesNotMatch(README, /works on any portal|stored mode below works there/i);
  assert.doesNotMatch(MULTI_CURRENCY_MESSAGE, /work on any portal/);
  const lim = README.slice(README.indexOf('## Limitations'), README.indexOf('## Did it help?'));
  assert.match(lim.split('\n').find((l) => l.startsWith('- Amounts:')), /exchange rate[^\n]*\(exchange rate\)/);
});

test('the readme says how fast stored snapshots grow and how to prune them by hand; the tool deletes nothing', () => {
  const data = README.slice(README.indexOf('## Where your data goes'), README.indexOf('## Exit codes'));
  assert.match(data, /half a kilobyte per deal/);
  assert.match(data, /never deletes/);
  assert.ok(data.includes("find ~/.monday-pipeline-brief -name 'snapshot-*.json' -mtime +35 -delete"));
});

test('flow.md shows only the pinned npx command and names the v0.3.1 states', () => {
  const flow = readFileSync(new URL('../.vibecodepm/flow.md', import.meta.url), 'utf8');
  assert.doesNotMatch(flow, /npx (--yes )?github:derrtaderr\/monday-pipeline-brief(?!#v)/, 'no unpinned npx');
  assert.ok(flow.includes(`npx github:derrtaderr/monday-pipeline-brief#v${VERSION} demo`));
  assert.match(flow, /\| Two owners with the same name \|[^\n]*\(owner /);
  assert.match(flow, /\| Brief too long for Slack \|[^\n]*largest deals here to fit Slack/);
  assert.match(flow, /\| Pipeline change log starts after the comparison date[^|\n]*\|[^\n]*oldest settings HubSpot kept/);
});

test('the readme says snapshots hold the owner label, which can include an email', () => {
  const data = README.slice(README.indexOf('## Where your data goes'), README.indexOf('## Exit codes'));
  assert.match(data, /owner label[^\n]*email/);
});

test('the SHA recipe peels the tag and says release tags are lightweight, and the Action section says where secrets live', () => {
  const note = README.slice(README.indexOf('### Run it every week with GitHub Actions'), README.indexOf('## Stateless mode'));
  // Both refs: a lightweight tag answers on the first, an annotated one on the peeled ^{} line.
  assert.ok(note.includes(`git ls-remote https://github.com/derrtaderr/monday-pipeline-brief refs/tags/v${VERSION} 'refs/tags/v${VERSION}^{}'`));
  assert.match(note, /lightweight/);
  assert.match(note, /Settings → Secrets and variables → Actions/);
  const action = readFileSync(new URL('../examples/github-action.yml', import.meta.url), 'utf8');
  assert.ok(action.includes(`refs/tags/v${VERSION}^{}`));
});
