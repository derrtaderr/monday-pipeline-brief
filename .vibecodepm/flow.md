---
name: monday-pipeline-brief user flow
read_by: the pre-release walkthrough (walks the build against this), and any change to src/cli.mjs
---

# Flow: monday-pipeline-brief v1 (updated for v0.3)

User: a RevOps manager or head of sales at a 50 to 500 person B2B SaaS company on HubSpot who
rebuilds the Monday pipeline update by hand. Comfortable pasting a command into a terminal;
not necessarily a developer.

## Entry points

1. **README on GitHub** (from a launch post). Reads the problem, sees the sample brief.
2. **`node bin/monday-brief.mjs demo`** from a clone, or `npx github:derrtaderr/monday-pipeline-brief#v0.3.1 demo`. No token.
3. **`run --since 7d`** (stateless) with `HUBSPOT_TOKEN` set, by hand the first time, then from a GitHub Action weekly; or **`run`** (stored snapshots), by hand the first time, then from cron or launchd weekly.
4. **`help`**, `--help` after any command, or no arguments: prints usage, exit 0.

## Happy path

1. Runs `demo`. Sees the full sample brief in the terminal, exit 0. Decides it is worth 5 minutes.
2. Creates a HubSpot service key (or, on older accounts, a private app) with `crm.objects.deals.read`, `crm.objects.owners.read` and `settings.currencies.read` (the third only stateless mode reads; the quickstart asks for all three), copies the `pat-` token.
3. `export HUBSPOT_TOKEN=...`, runs `run`.
4. **First run state (one snapshot).** Brief says "This is the first snapshot. A comparison needs two weekly runs, so the week-over-week sections start next week.", shows the open pipeline total, the "Close date passed" list and the "No next step, or no activity in 14+ days" list. Writes `~/.monday-pipeline-brief/snapshot-DATE.json` and `brief-DATE.md` (the same folder scheduled runs use) and appends a line to `run.log`. stderr: `Saved ... in <dir>`. Exit 0.
5. Schedules it weekly using the README's cron or launchd block.
6. **Second weekly run (activation).** Brief opens with "Compared with the snapshot from <date>.", the headline with delta and won/lost, "How the open pipeline changed" (the dollar bridge from last week's open total to this week's, in exact dollars that add up), "Look at these first" (each line ends with why it is there: warning signs, large deal, or slipped into a later quarter), then close date passed, slipped, moved back, stale, moved forward, changed stage, moved to another pipeline, amount changed, new, reopened, closed, removed from HubSpot. Each deal name links to its HubSpot record. Exit 0.
6a. Optional: `--group-by owner` (or `pipeline`, or `MONDAY_BRIEF_GROUP_BY`) keeps the headline and bridge on top, then one heading per rep or pipeline with its own sections. `--large-deal AMOUNT` (or `MONDAY_BRIEF_LARGE_DEAL`, or `off`) sets what counts as a large deal; the default is the largest open deals, at most 10% of them (at least one, unless every deal above $0 has the same amount and they outnumber that limit).
7. Optional: sets `SLACK_WEBHOOK_URL`; the brief also posts to Slack as mrkdwn; stderr "Posted the brief to Slack."

## Stateless path (v0.3)

1. Creates the key with a third scope, `settings.currencies.read`, and runs `run --since 7d` (or `--as-of <ISO instant>`, or `MONDAY_BRIEF_SINCE=7d`).
2. **First run is a full brief.** It opens "Compared with HubSpot as of <date>, rebuilt from property history.", then the same sections as the second weekly run in the happy path (step 6 above), with no first-snapshot message. Deals HubSpot's history could not rebuild are in "Could not rebuild as of <date>" and on a "Could not rebuild" bridge line; the start line splits rebuilt from partly rebuilt amounts and the headline says what the start total leaves out. stderr: "Stateless run: compared with HubSpot as of <instant>; no snapshot was saved." Exit 0. Nothing is written except `--out`; no snapshot folder, no run.log.
3. Schedules it with `examples/github-action.yml` in a repository of their own; the brief goes to Slack.

| State | What the user sees | Exit | Files written |
|---|---|---|---|
| Portal with more than one currency | "This HubSpot portal uses more than one currency. Stateless mode has not been validated on multi-currency portals... Run without --since or --as-of to use stored snapshots" "No brief was written." | 5 | none |
| Token lacks settings.currencies.read | "HubSpot refused the currency settings (403). Stateless mode needs the settings.currencies.read scope..." "No brief was written." | 5 | none |
| Bad --since, --as-of, both, or --dir with either | Usage error naming the flag, plus usage | 1 | none |
| HubSpot failure during the read | The HubSpot message, then "No brief was written." | 2 | none |
| A batch read of archived deals comes back partial (207 with errors, or fewer records) | "HubSpot's batch read of archived deals returned N of M deals... A partial read is never used; try again later." "No brief was written." | 2 | none |
| stdout is not a terminal, no `--out`, no Slack | Brief on stdout, then "This run kept no copy of the brief of its own (no --out, no SLACK_WEBHOOK_URL). Unless standard output went to a file, add --out FILE or set SLACK_WEBHOOK_URL to keep it." (true for a pipe, a file redirect or /dev/null) | 0 | none |
| Slack post fails, no `--out` | "Slack post failed (...). The brief was printed above." in a terminal; elsewhere "This run kept no copy of the brief of its own; unless standard output went to a file, add --out FILE to keep one." | 3 | none |
| `--dir` while `MONDAY_BRIEF_SINCE` is set | "--dir is for stored snapshots, but MONDAY_BRIEF_SINCE turns on stateless mode... Unset MONDAY_BRIEF_SINCE to use --dir." plus usage | 1 | none |

## States

"run.log line" means one redacted line appended to `<dir>/run.log`. New folders are created 0700 and every file the run writes is created 0600.

| State | What the user sees | Exit | Files written |
|---|---|---|---|
| Demo | Sample brief on stdout (and `--out FILE` if given), then one stderr line: "This was sample data from a made-up HubSpot portal, so its links go nowhere useful. Set HUBSPOT_TOKEN and run `<command> run --since 7d` for your own pipeline." | 0 | only `--out` |
| Demo, `--out` unwritable | Brief on stdout, then "Could not write the demo brief to <file> (<code>). The brief above was printed but not saved." | 4 | none |
| First run, one snapshot | First-snapshot message, open total, close date passed list, stale list | 0 | snapshot, brief, run.log line |
| Normal weekly run | Full brief | 0 | snapshot, brief, run.log line |
| Nothing changed | Headline "flat on last week", no bridge (every line would be zero), "Nothing flagged this week." | 0 | snapshot, brief, run.log line |
| Grouped run (`--group-by owner` or `pipeline`) | Headline and bridge for the whole pipeline, then "## <rep or pipeline>, open $X across N deals" headings in order of open total, each with its sections (10 per section per group) or "Nothing flagged." | 0 | snapshot, brief, run.log line |
| Two owners with the same name | Each is told apart on every line and heading: "Dana Ruiz (dana@example.com)", or "Dana Ruiz (owner 102)" when the email does not tell them apart; `--group-by owner` gives each its own heading (grouped by owner id) | 0 | as for the mode |
| Brief too long for Slack | Slack copy re-rendered with 5, then 3, then 1 rows per section, ending "_Each section shows its N largest deals here to fit Slack. ..._"; only if one row each does not fit, cut at a line with "_Brief cut short for Slack. ..._". Either note gives the saved brief's file name "on the machine that ran it", or "Run with --out FILE for the full brief." | 0 | as for the mode |
| Pipeline change log starts after the comparison date (stateless), with deals in it then | Its stages then are read from the oldest settings HubSpot kept; one line under "Compared with HubSpot as of ...": "<pipeline>: its change log in HubSpot starts after <date>, so its stages on <date> are read from the oldest settings HubSpot kept for it." | 0 | none (stdout, --out, Slack) |
| Pipeline reordered in HubSpot settings | No deal is listed as moved unless its stage changed | 0 | snapshot, brief, run.log line |
| A deal left a stage that has since been deleted | Listed under "Changed stage", old stage to new, with no back or forward | 0 | snapshot, brief, run.log line |
| Deal deleted or archived since last week | Listed under "Removed from HubSpot" and as a bridge line | 0 | snapshot, brief, run.log line |
| Deal closed at both ends, but flipped (won to lost, lost to won) or its amount moved | Listed under "Changed after closing" ("was won, now lost", "won amount $X → $Y"); the headline adds "N deals changed after closing."; not in the Closed counts and not a bridge line (never open) | 0 | as for the mode |
| Baseline written by v0.1 (no deal links) | Loads as before; deals that exist only in that snapshot (removed deals) show a plain name | 0 | snapshot, brief, run.log line |
| `--large-deal` or `MONDAY_BRIEF_LARGE_DEAL` not an amount | "--large-deal needs an amount in dollars such as 50000, 50K or 1.5M, or off (got "...")" plus usage. Nothing fetched | 1 | none |
| `--group-by` or `MONDAY_BRIEF_GROUP_BY` not owner or pipeline | "--group-by must be owner or pipeline (got "...")" plus usage. Nothing fetched | 1 | none |
| Same-day re-run | Today's snapshot overwritten; still compares with the same earlier baseline | 0 | snapshot (overwritten), brief (overwritten), run.log line |
| Ad-hoc mid-week run, then the scheduled run | The scheduled brief compares with the newest snapshot 7 or 8 days old, not the mid-week one (a Tuesday run is 6 days old by Monday); with none that age, the newest at least 6 days old; with none that old, the newest earlier one | 0 | snapshot, brief, run.log line |
| Skipped week(s) (machine asleep or off, job missed) | Compares with the newest snapshot 7 or 8 days old, else the newest at least 6 days old. A gap of 6 to 8 days reads "last week"; any other gap reads "Compared with the snapshot from Sep 21, 2 weeks ago.", "up $39K since Sep 21", "New since Sep 21", "Nothing flagged since Sep 21.", and the heading drops "week of" | 0 | snapshot, brief, run.log line |
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
| Deals in unreadable stages | Brief line "N deals ($X) are in stages we couldn't read (archived or deleted in HubSpot), counted as open." and stderr "Warning: N deals are in stages we couldn't read (archived or deleted in HubSpot), counted as open." (counts only on stderr) | 0 | snapshot, brief, run.log line |
| Team does not use Next step | Run with `--no-next-step` or `MONDAY_BRIEF_NEXT_STEP=off`; section becomes "No activity in 14+ days" | 0 | snapshot, brief, run.log line |
| Huge pipeline | Each section shows the 10 largest then "and N more ($X)"; Slack text kept under 35,000 characters | 0 | snapshot, brief, run.log line |
| Scheduled run did not happen | `tail ~/.monday-pipeline-brief/run.log` shows no new line; README points to a missing or misnamed `~/.monday-brief.env` (the shell stops before the tool starts; `ls -l ~/.monday-brief.env`), `which node`, macOS privacy controls (TCC) on ~/Documents, ~/Desktop, ~/Downloads, cron mail, `launchctl list`, `/tmp/monday-brief.launchd.log` (status messages only; launchd stdout goes to /dev/null) | n/a | n/a |
| `help`, `--help`, `run --help`, `demo --help` | Usage on stdout | 0 | none |
| Unknown command or option | Message plus usage on stderr | 1 | none |
| `demo --dir` | "--dir is for run; demo reads bundled sample data" plus usage on stderr | 1 | none |
| Unexpected error during `run` | "Unexpected error: <message with secrets redacted>" | 1 | run.log line, possibly a snapshot |

## Recovery

- Missing, malformed or rejected token: fix `HUBSPOT_TOKEN` (paste the raw token, no quotes inside the value), re-run. Nothing partial was written, so history is not corrupted.
- 403: add the scope to the service key or private app (HubSpot rotates nothing), re-run.
- 429 or 5xx: re-run later; a same-day re-run simply overwrites today's snapshot.
- Unwritable `--out` or a failed write (exit 4): fix the location or free disk space and re-run; a same-day re-run overwrites today's snapshot.
- Slack failure: the brief file is already on disk; fix the webhook and re-run (same-day re-run is safe), or paste the file.
- Lost snapshot folder: history restarts; the next run is a first run again and says so.
