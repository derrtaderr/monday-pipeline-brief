---
name: monday-pipeline-brief user flow
read_by: the pre-release walkthrough (walks the build against this), and any change to src/cli.mjs
---

# Flow: monday-pipeline-brief v1

User: a RevOps manager or head of sales at a 50 to 500 person B2B SaaS company on HubSpot who
rebuilds the Monday pipeline update by hand. Comfortable pasting a command into a terminal;
not necessarily a developer.

## Entry points

1. **README on GitHub** (from a launch post). Reads the problem, sees the sample brief.
2. **`node bin/monday-brief.mjs demo`** from a clone, or `npx github:derrtaderr/monday-pipeline-brief demo`. No token.
3. **`run`** with `HUBSPOT_TOKEN` set, by hand the first time, then from cron or launchd weekly.
4. **`help`**, `--help` after any command, or no arguments: prints usage, exit 0.

## Happy path

1. Runs `demo`. Sees the full sample brief in the terminal, exit 0. Decides it is worth 5 minutes.
2. Creates a HubSpot service key (or, on older accounts, a private app) with `crm.objects.deals.read` and `crm.objects.owners.read`, copies the `pat-` token.
3. `export HUBSPOT_TOKEN=...`, runs `run`.
4. **First run state (one snapshot).** Brief says "This is the first snapshot. A comparison needs two weekly runs, so the week-over-week sections start next week.", shows the open pipeline total and the "No next step, or no activity in 14+ days" list. Writes `~/.monday-pipeline-brief/snapshot-DATE.json` and `brief-DATE.md` (the same folder scheduled runs use) and appends a line to `run.log`. stderr: `Saved ... in <dir>`. Exit 0.
5. Schedules it weekly using the README's cron or launchd block.
6. **Second weekly run (activation).** Brief opens with "Compared with the snapshot from <date>.", the headline with delta and won/lost, "Look at these first", then slipped, moved back, stale, moved forward, new, closed. Exit 0.
7. Optional: sets `SLACK_WEBHOOK_URL`; the brief also posts to Slack as mrkdwn; stderr "Posted the brief to Slack."

## States

"run.log line" means one redacted line appended to `<dir>/run.log`. New folders are created 0700 and every file the run writes is created 0600.

| State | What the user sees | Exit | Files written |
|---|---|---|---|
| Demo | Sample brief on stdout (and `--out FILE` if given) | 0 | only `--out` |
| Demo, `--out` unwritable | Brief on stdout, then "Could not write the demo brief to <file> (<code>). The brief above was printed but not saved." | 4 | none |
| First run, one snapshot | First-snapshot message, open total, stale list | 0 | snapshot, brief, run.log line |
| Normal weekly run | Full brief | 0 | snapshot, brief, run.log line |
| Nothing changed | Headline "flat on last week", "Nothing flagged this week." | 0 | snapshot, brief, run.log line |
| Same-day re-run | Today's snapshot overwritten; still compares with the same earlier baseline | 0 | snapshot (overwritten), brief (overwritten), run.log line |
| Ad-hoc mid-week run, then the scheduled run | The scheduled brief compares with the newest snapshot at least 6 days old, not the mid-week one; with none that old, the newest earlier one | 0 | snapshot, brief, run.log line |
| Skipped week(s) (machine asleep or off, job missed) | Compares with the newest snapshot at least 6 days old. A gap of 6 to 8 days reads "last week"; any other gap reads "Compared with the snapshot from Sep 21, 2 weeks ago.", "up $39K since Sep 21", "New since Sep 21", "Nothing flagged since Sep 21.", and the heading drops "week of" | 0 | snapshot, brief, run.log line |
| Missing token | "HUBSPOT_TOKEN is not set. Create a HubSpot service key (or a private app on older accounts) as the README quickstart shows..." and a pointer to `demo` | 1 | run.log line only |
| Malformed token (smart quotes, spaces, non-ASCII) | "HUBSPOT_TOKEN has characters a HubSpot token never has (smart quotes, spaces or non-ASCII letters...)" "Nothing was fetched from HubSpot." Immediate, no retries, token never printed | 1 | run.log line only |
| SLACK_WEBHOOK_URL is a placeholder or not a Slack webhook URL | "SLACK_WEBHOOK_URL is not a Slack incoming webhook URL (it should start with https://hooks.slack.com/ ...). Paste the webhook URL Slack gave you, or remove the line to skip Slack." "Nothing was fetched from HubSpot." The URL is never printed | 1 | run.log line only |
| Bad token (401) | "HubSpot rejected the token (401). Check that HUBSPOT_TOKEN holds a current HubSpot service key or private app token for this portal." "No snapshot or brief was written." | 2 | run.log line only |
| Missing scope (403) | "HubSpot refused <path> (403). The HubSpot service key or private app needs the crm.objects.deals.read and crm.objects.owners.read scopes." "No snapshot or brief was written." | 2 | run.log line only |
| Rate limited (429) | Silent retry honouring Retry-After (over 60 s: stop at once, exit 2), else 1s, 2s, 4s, 8s, 16s. If still limited: "HubSpot kept rate limiting <path> (429) after 5 retries. Try again in a few minutes." | 0 or 2 | on a successful retry: snapshot, brief, run.log line; on failure: run.log line only |
| HubSpot 5xx or network down | Same retry; then "HubSpot request to <path> failed with status N." or "Could not reach HubSpot..." | 2 | run.log line only |
| Slack webhook failure | "Slack post failed (status N | could not connect). The brief is saved at <file>. Check SLACK_WEBHOOK_URL." The URL is never echoed | 3 | snapshot, brief, run.log line |
| Unreadable previous snapshot (truncated, hand-edited, other schema) | stderr and the brief itself: "Skipped unreadable snapshot-DATE.json (<reason>)." Falls back to the next older readable snapshot (labelled with its real age), else first-run mode opening "No earlier snapshot could be read." | 0 | snapshot, brief, run.log line |
| Unwritable snapshot folder | "Cannot write to the snapshot folder <dir> (EACCES). Choose a folder you can write to with --dir or MONDAY_BRIEF_DIR." HubSpot is not called; a "could not add a line to run.log" warning follows | 1 | none |
| Unreadable snapshot folder (writable, not readable) | "Cannot read the snapshot folder <dir> (EACCES). Choose a folder you can read and write with --dir or MONDAY_BRIEF_DIR." HubSpot is not called | 1 | run.log line only |
| Unwritable `--out` location, or `--out` is a folder | "Cannot write the brief to <file> (<code>). Choose a location you can write to with --out. Nothing was fetched from HubSpot." | 1 | run.log line only |
| Snapshot write fails after HubSpot was read (disk full) | "Could not save today's snapshot in <dir> (<code>). No snapshot or brief was written." | 4 | run.log line, if the folder still takes one |
| Brief write fails after the snapshot was saved | Brief on stdout, then "Could not write the brief to <file> (<code>). Today's snapshot was saved as snapshot-DATE.json in <dir>..." | 4 | snapshot, run.log line |
| run.log cannot be written | "Warning: could not add a line to <dir>/run.log (<code>)." Exit code unchanged | unchanged | everything else as normal |
| Deals in unreadable stages | Brief line and stderr "Warning: N deals ($X) are in stages we couldn't read (archived or deleted in HubSpot), counted as open." | 0 | snapshot, brief, run.log line |
| Team does not use Next step | Run with `--no-next-step` or `MONDAY_BRIEF_NEXT_STEP=off`; section becomes "No activity in 14+ days" | 0 | snapshot, brief, run.log line |
| Huge pipeline | Each section shows the 10 largest then "and N more ($X)"; Slack text kept under 35,000 characters | 0 | snapshot, brief, run.log line |
| Scheduled run did not happen | `tail ~/.monday-pipeline-brief/run.log` shows no new line; README points to a missing or misnamed `~/.monday-brief.env` (the shell stops before the tool starts; `ls -l ~/.monday-brief.env`), `which node`, macOS privacy controls (TCC) on ~/Documents, ~/Desktop, ~/Downloads, cron mail, `launchctl list`, `/tmp/monday-brief.launchd.log` (status messages only; launchd stdout goes to /dev/null) | n/a | n/a |
| `help`, `--help`, `run --help`, `demo --help` | Usage on stdout | 0 | none |
| Unknown command or option | Message plus usage on stderr | 1 | none |
| Unexpected error during `run` | "Unexpected error: <message with secrets redacted>" | 1 | run.log line, possibly a snapshot |

## Recovery

- Missing, malformed or rejected token: fix `HUBSPOT_TOKEN` (paste the raw token, no quotes inside the value), re-run. Nothing partial was written, so history is not corrupted.
- 403: add the scope to the service key or private app (HubSpot rotates nothing), re-run.
- 429 or 5xx: re-run later; a same-day re-run simply overwrites today's snapshot.
- Unwritable `--out` or a failed write (exit 4): fix the location or free disk space and re-run; a same-day re-run overwrites today's snapshot.
- Slack failure: the brief file is already on disk; fix the webhook and re-run (same-day re-run is safe), or paste the file.
- Lost snapshot folder: history restarts; the next run is a first run again and says so.
