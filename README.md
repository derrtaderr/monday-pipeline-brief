# monday-pipeline-brief

Every Monday someone on your team rebuilds the pipeline update by hand. HubSpot stores what is true about each deal right now, not what changed since last week, so someone exports the deals, opens last week's export next to it, and hunts for what moved.

This tool remembers for you. Each week it saves a snapshot of your HubSpot deals to your own disk, compares it with last week's, and writes the brief: which close dates slipped, which deals went backward, which have no next step or no recent activity, and the short list of deals with more than one of those problems at once.

It is free, it runs on your machine with your own HubSpot key, and it has zero dependencies. Nothing is sent anywhere except HubSpot (to read deals) and, if you ask for it, your own Slack webhook.

**v0.1, early.** The HubSpot side is tested against HubSpot's published API specs and against recorded responses. It has now been run on one real HubSpot portal, with a custom pipeline and a service key, on test data: every stage move, slipped close date, close, new deal and next step change came out right. That is one portal, so it is not yet confirmed on many real portals. If you try it, please report problems in GitHub Issues, and tell us when it worked in GitHub Discussions. Both help.

## What the brief looks like

This is the real output of `node bin/monday-brief.mjs demo` (or `npx github:derrtaderr/monday-pipeline-brief demo`), run on a fictional pipeline (every company and rep name is made up):

<!-- demo-output:start -->
```markdown
# Monday pipeline brief, week of Oct 5

Compared with the snapshot from Sep 28.

Open pipeline $1.25M across 21 deals, up $156K on last week.
Closed 2 won ($114K) and 1 lost ($90K).

**Look at these first** (more than one warning sign)
- Halcyon, $24K, Leo: close date slipped, no activity in 14+ days

**Slipped close dates** (3)
- Quarry, $120K, Leo: Oct 19 → Jan 15 (+88 days)
- Sable, $90K, Dana: Nov 6 → Dec 5 (+29 days)
- Halcyon, $24K, Leo: Oct 3 → Dec 19 (+77 days)

**Moved back a stage** (2)
- Driftwood, $60K, Dana: Proposal → Qualified
- Pinecrest, $24K, Dana: Demo → Discovery

**No next step, or no activity in 14+ days** (4)
- Vantage Freight, $90K, Dana: no next step
- Arcadia, $48K, Marcus: no activity since Sep 18
- Kestrel, $48K, Priya: no activity since Sep 11
- Halcyon, $24K, Leo: no activity since Sep 14

**Moved forward** (3)
- Fernway, $40K, Leo: Proposal → Negotiation
- Oakmont, $40K, Priya: Qualified → Demo
- Brightline, $18K, Priya: Demo → Proposal

**New this week** (4)
- Sundial, $120K, Dana
- Beacon Pay, $90K, Marcus
- Granite, $75K, Priya
- Tidewater, $75K, Leo

**Closed** (3)
- Lumen Health, $90K, Dana: won
- Cobalt Labs, $24K, Priya: won
- Meridian, $90K, Dana: lost
```
<!-- demo-output:end -->

Try it yourself in ten seconds, no HubSpot account needed:

```bash
git clone https://github.com/derrtaderr/monday-pipeline-brief
cd monday-pipeline-brief
node bin/monday-brief.mjs demo
```

## Five minute quickstart

You need Node 20 or newer and HubSpot admin rights (super admin, or permission to create service keys or private apps).

1. **Create a service key in HubSpot.** Settings, then Development, then Legacy Apps (or search the settings for "service key"), then **Create a service key**. Name it "Monday brief" and add exactly these two read scopes:
   - `crm.objects.deals.read`
   - `crm.objects.owners.read`

   Create the key. On its page, the "Service Key" box has Show and Copy buttons; copy the key (it starts with `pat-`, for example `pat-na1-` or `pat-na2-` depending on your region). That is your `HUBSPOT_TOKEN`.

   **Older accounts that still offer private apps** can use one instead: Settings, then Integrations, then Private Apps, then **Create a private app**. On the Scopes tab tick the same two read scopes, create the app and copy its access token (it also starts with `pat-`).

   To revoke access later, open the key under Service Keys and press Delete (for a private app, delete the app).
2. **Put the token in your environment.** Never paste it into a file you commit.
   ```bash
   export HUBSPOT_TOKEN="paste your pat- token here"
   ```
   Replace everything between the quotes with the token you copied. If it is run exactly as shown, the tool rejects the placeholder on purpose and fetches nothing.
3. **Run it.**
   ```bash
   npx github:derrtaderr/monday-pipeline-brief run
   # or, from a clone:
   node bin/monday-brief.mjs run
   ```
   Every run, manual or scheduled, uses one folder: `~/.monday-pipeline-brief` in your home directory. The tool creates it. The first run saves `snapshot-YYYY-MM-DD.json` and writes `brief-YYYY-MM-DD.md` there, and adds a line to `run.log`. A comparison needs two weekly runs, so the first brief says so plainly and shows only the current-state parts (open pipeline total and the stale next step list).
4. **Optional, post to Slack.** Create a Slack incoming webhook for your channel and set it:
   ```bash
   export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
   ```
   Replace the whole URL with the one Slack gave you. The tool refuses a URL that still holds the `...` and stops before calling HubSpot.
5. **Schedule it weekly** (see below). From the second week on, you get the full brief.

### Options

| Setting | How | Default |
|---|---|---|
| HubSpot token | `HUBSPOT_TOKEN` env var (required for `run`) | none |
| Slack webhook | `SLACK_WEBHOOK_URL` env var | off |
| Snapshot folder | `--dir DIR`, else `MONDAY_BRIEF_DIR` (a leading `~` means your home folder, even inside quotes) | `~/.monday-pipeline-brief` |
| Brief file | `--out FILE` (`--dir=DIR` and `--out=FILE` also work) | `<snapshot folder>/brief-YYYY-MM-DD.md` |
| Skip the Next step check | `--no-next-step`, or `MONDAY_BRIEF_NEXT_STEP=off` | on |

The token and the webhook URL are read from the environment only. There is deliberately no flag for them, so they stay out of your shell history. If you do change the folder, change it everywhere you run the tool, or your history splits in two.

### Schedule it weekly

The tool does not schedule itself. Use what your machine already has. Scheduled jobs need fixed paths, so clone the repo once (`git clone https://github.com/derrtaderr/monday-pipeline-brief`) and fill in two paths below:

- `/path/to/node` is the output of `which node` in your terminal (for example `/opt/homebrew/bin/node` on Apple Silicon Macs, `/usr/local/bin/node` on Intel Macs, `/usr/bin/node` on many Linux machines). cron and launchd do not see your shell's PATH, so a bare `node` fails there.
- `/path/to/monday-pipeline-brief` is where you cloned the repo.

**On a Mac, do not clone it into `~/Documents`, `~/Desktop` or `~/Downloads`.** macOS privacy controls (TCC) stop cron and launchd jobs from reading those folders unless you grant Full Disk Access, so the scheduled run fails silently while the same command works in your terminal. A folder such as `~/tools/monday-pipeline-brief` avoids this. The same applies to `--dir` and `--out`: a scheduled job cannot write a snapshot folder or brief inside those protected folders either. (The default snapshot folder `~/.monday-pipeline-brief` is not affected.)

Put the secrets in a file only you can read, not in the schedule itself. Create it empty and private first:

```bash
touch ~/.monday-brief.env
chmod 600 ~/.monday-brief.env
nano ~/.monday-brief.env    # or open it in any text editor
```

and give it these lines. The Slack line is optional and starts commented out; to post to Slack, paste your webhook URL over the `...` and delete the leading `# `. The tool refuses a URL that still holds the `...`.

```bash
export HUBSPOT_TOKEN="paste your pat- token here"
# export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
```

The name must be exactly `.monday-brief.env`, with the leading dot, in your home folder. The schedule reads it before the tool starts.

If you also set `MONDAY_BRIEF_DIR` in this file, give an absolute path or one that starts with `~` (for example `~/pipeline-history`). A relative path is resolved against the scheduler's working directory, not your home folder, so scheduled runs would write somewhere other than your manual runs.

**cron (Linux or macOS)**, every Monday at 7:00. Copy this line into a text editor first:

```cron
0 7 * * 1 . $HOME/.monday-brief.env && /path/to/node /path/to/monday-pipeline-brief/bin/monday-brief.mjs run > /dev/null
```

Replace both placeholders, `/path/to/node` and `/path/to/monday-pipeline-brief`, with your real paths. Then run `crontab -e` and add the filled-in line.

Check that no placeholder is left in your schedule. This should print nothing:

```bash
crontab -l | grep /path/to
```

The `> /dev/null` throws away the printed copy of the brief, so cron does not mail your deals to the local mailbox. The brief is already saved in `~/.monday-pipeline-brief`, and `run.log` is the record of every run. Cron still mails a short status line each week (file names and totals, never deal names), plus any error. Add `2> /dev/null` to the line if you want no mail at all.

**Test the cron job now.** Run the exact cron command by hand, with your real paths filled in, in the same shell cron uses, then read the log:

```bash
/bin/sh -c '. $HOME/.monday-brief.env && /path/to/node /path/to/monday-pipeline-brief/bin/monday-brief.mjs run > /dev/null'
tail ~/.monday-pipeline-brief/run.log
```

**launchd (macOS)**, create the folder if it does not exist (`mkdir -p ~/Library/LaunchAgents`) and save the file below as `~/Library/LaunchAgents/com.example.monday-brief.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.monday-brief</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string><string>-c</string>
    <string>. $HOME/.monday-brief.env &amp;&amp; /path/to/node /path/to/monday-pipeline-brief/bin/monday-brief.mjs run</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/tmp/monday-brief.launchd.log</string>
</dict>
</plist>
```

Before you load it: in the saved file, replace both placeholders, `/path/to/node` and `/path/to/monday-pipeline-brief`, with your real paths. `plutil -lint` does not catch a placeholder left behind, so check that none is left. This prints nothing when the file is filled in:

```bash
grep /path/to ~/Library/LaunchAgents/com.example.monday-brief.plist
```

Then load it:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.monday-brief.plist
```

(On older macOS versions, `launchctl load ~/Library/LaunchAgents/com.example.monday-brief.plist`.)

**Test the launchd job now.** Start it once without waiting for Monday, give it a few seconds, then read the log:

```bash
launchctl kickstart -k gui/$(id -u)/com.example.monday-brief
tail ~/.monday-pipeline-brief/run.log
```

**After editing the plist**, unload the old copy first, because launchd will not load a job that is already loaded:

```bash
launchctl bootout gui/$(id -u)/com.example.monday-brief
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.monday-brief.plist
```

The brief is already saved in `~/.monday-pipeline-brief`, so the launchd job throws its printed copy away (`StandardOutPath` is `/dev/null`) instead of leaving your deals in a `/tmp` file other users can read. Only status messages and errors go to `/tmp/monday-brief.launchd.log`.

**Where scheduled runs log, and how to check one ran.**

- Every run appends one line to `~/.monday-pipeline-brief/run.log` with the time, the exit code and what happened (secrets removed). Check it with `tail ~/.monday-pipeline-brief/run.log`. A Monday line with `exit=0` means the brief was written.
- No new line on a Monday means the job never started the tool. The usual causes are a missing or misnamed `~/.monday-brief.env` (the schedule reads it first, and without it the shell stops before the tool starts; check with `ls -l ~/.monday-brief.env`), a wrong `/path/to/node`, and on a Mac the repo sitting in `~/Documents`, `~/Desktop` or `~/Downloads`, which macOS privacy controls (TCC) hide from scheduled jobs (move the clone; granting Full Disk Access also works, but it is a much wider permission than this tool needs). For cron, check your system mail or run the cron line by hand. For launchd, run `launchctl list | grep monday-brief` (the middle number is the last exit code) and read `/tmp/monday-brief.launchd.log`, where launchd writes anything printed before the tool could log.

**Scheduled and ad-hoc runs.** You can also run it by hand mid-week. Each brief compares with the newest snapshot that is at least 6 days old, so a Friday run by hand does not replace last Monday as the baseline for the next Monday brief. Only when there is no snapshot that old does it compare with the newest earlier one.

If a week is skipped, for example because the Mac was asleep or off at the scheduled time and cron does not catch up, the next run says how old its comparison is ("Compared with the snapshot from Sep 21, 2 weeks ago", and "up $39K since Sep 21" instead of "on last week"), so a gap is visible rather than hidden. launchd runs a job it missed while the Mac was asleep as soon as it wakes, so on a laptop prefer launchd, or pick a time the machine is usually on. If a snapshot file is unreadable (truncated or hand-edited), the brief names it ("Skipped unreadable snapshot-2026-09-28.json (not valid JSON).") and compares with the next older one.

## Exactly what each section checks

All deals in all deal pipelines are read. "Open" means the deal's stage is not a closed stage.

- **Headline.** Sum of the deal amount over open deals now, and the change from the previous snapshot's open total. Won and lost: deals that are closed now and were open last week (or did not exist last week). Won means a closed stage with probability 100%; lost means any other closed stage. This comes from HubSpot's stage settings, never from the stage name.
- **Stages we couldn't read.** If an open deal's stage is missing from the pipeline settings HubSpot returns (usually an archived or deleted stage), the brief and the terminal say how many deals and how much money that is. Those deals are counted as open and are left out of stage-move checks.
- **Look at these first.** Open deals with more than one of these flags: close date slipped, moved back a stage, no next step or no activity in 14+ days.
- **Slipped close dates.** Open deals whose `closedate` is later than last week.
- **Moved back a stage / Moved forward.** Open deals whose stage position changed, using the stage order you set in HubSpot's pipeline settings. A deal moved to a different pipeline is not counted as a stage move.
- **No next step, or no activity in 14+ days.** HubSpot has a free-text "Next step" field (`hs_next_step`) but no next step due date, so the brief checks two things on open deals:
  - `hs_next_step` is empty, or
  - `hs_next_step` is filled in, but `notes_last_updated` (HubSpot's "Last Activity Date", the last logged call, email, meeting or note) is 14 or more days old. If no activity has ever been logged, the deal's creation date (`createdate`) stands in: a deal created less than 14 days ago is not flagged, and an older one reads "no activity logged since it was created Sep 20".

  An empty Next step is flagged on any open deal, even one created today, because the next step is the one field that says what happens next and filling it takes seconds.

  It does not use "Last modified date", because workflows and integrations update that on deals nobody has touched.

  **If your team does not use the Next step field**, every open deal would land here. Run with `--no-next-step` (or put `export MONDAY_BRIEF_NEXT_STEP=off` in your env file) and the section becomes "No activity in 14+ days", checking only `notes_last_updated` (and `createdate` when nothing is logged).
- **New this week.** Deals that were not in the previous snapshot.
- **Closed.** The won and lost deals from the headline.

Lists are sorted by amount, largest first. Each section shows its 10 largest deals, then one line such as "and 37 more ($1.2M)", so a big pipeline still gives a short brief; the section heading always carries the full count. Empty sections are left out. The Slack message is also kept under 35,000 characters, below Slack's limit; if it ever has to be cut, it says so and the saved file is the full brief.

## Where your data goes

- Snapshots are plain JSON on your disk, one file per week, kept private: folders and files the tool creates get permissions 0700 (folders) and 0600 (snapshots, briefs, `run.log`), and existing ones keep their permissions, so if you point `--dir` at a folder you already have, check who can read it. Each snapshot holds only these fields per deal: id, name, owner name, pipeline, stage, stage order, open/won/lost, amount, close date, next step text, last activity date and creation date.
- The token is sent only to `api.hubapi.com` in the Authorization header. It is never written to a snapshot, the brief, a log or an error message, and a test checks that across every success and failure path.
- No telemetry. The tool never phones home.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Brief written (and posted, if Slack is set) |
| 1 | Setup problem found before HubSpot is called: `HUBSPOT_TOKEN` not set or pasted with smart quotes or spaces, a `SLACK_WEBHOOK_URL` that is not a Slack incoming webhook URL (for example the `...` placeholder), a snapshot folder you cannot read or write, an `--out` location you cannot write to or that is a folder (for example `EACCES`), or an unknown option. Nothing is fetched from HubSpot. Also used for an unexpected error, printed as "Unexpected error: ..." with secrets removed |
| 2 | HubSpot refused or failed (bad token, missing scope, still rate limited after 5 retries). Nothing is written except a line in `run.log` |
| 3 | The brief was written, but the Slack post failed |
| 4 | HubSpot was read but a file could not be written (for example a full disk). The message names the file and says whether today's snapshot was saved. `demo --out` uses this code too |

If `run.log` itself cannot be written, the run prints a warning and keeps its exit code.

Rate limits (HTTP 429) and HubSpot server errors are retried up to 5 times, waiting as long as HubSpot asks up to 60 seconds per wait. If HubSpot asks for a longer wait, the run stops with exit 2 and you can simply run it again later.

## Limitations

- HubSpot only. No Salesforce yet.
- History starts on your first run. It cannot reconstruct earlier weeks.
- All deal pipelines are combined into one brief.
- Amounts: each deal uses `amount_in_home_currency` (HubSpot's conversion to your company currency) when HubSpot returns it, and falls back to `amount` when it does not. If your portal has multiple currencies turned off, that is simply `amount`. No other currency conversion is done.
- A deal deleted between runs is not listed anywhere; its amount simply leaves the open total.
- Dates are taken as the calendar date HubSpot returns (UTC), which can differ by a day from what you see in your time zone.
- The stale check uses last logged activity, which is only as good as your team's logging.
- Closed stages come from each stage's "closed" setting in HubSpot. If HubSpot ever sends a stage without it, the tool falls back to the stage's probability: 100% counts as won, 0% as lost, anything else as open. A closed stage with another probability would then count as open, and an open custom stage set to 0% probability with no `isClosed` would be counted as lost.

## Did it help?

If you ran it for two weeks and got a brief with real changes in it, please open a GitHub Discussion or an issue and say so, even in one line. There is no telemetry, so that is the only way we learn whether this is worth building further (Salesforce is next if it is). Feature requests are welcome there too.

## Development

```bash
npm test        # all tests, including a check that the example above matches `demo` output
npm run lint    # syntax check, no em dashes in this README, no runtime dependencies
```

The contract tests check the recorded HubSpot responses and the client's requests against HubSpot's published OpenAPI specs. The specs are HubSpot's and are not copied into this repo, so those tests skip until you fetch them:

```bash
node scripts/fetch-hubspot-specs.mjs /tmp/hubspot-specs && HUBSPOT_SPEC_DIR=/tmp/hubspot-specs npm test
```

MIT licensed.
