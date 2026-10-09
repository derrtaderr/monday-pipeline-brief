# monday-pipeline-brief

Know what changed in your HubSpot pipeline before Monday's meeting.

It compares your HubSpot deals today with how they stood a week ago and writes a short brief: where the open pipeline went, dollar for dollar, which close dates slipped or passed, which deals moved back, changed amount, went quiet or left HubSpot, and the few deals to look at first, each with the reason it is there. Every deal links straight to its record in HubSpot.

Last week comes from one of two places. **Stateless mode** (`run --since 7d`) rebuilds it from HubSpot's own property history, so the very first run gives a full brief and nothing is kept between runs. **Stored mode** (`run`, the default) saves a snapshot of your deals to your own disk each week and compares with last week's file.

It is free, it runs on your machine (or in your own GitHub Action) with your own HubSpot key, and it has zero dependencies. Nothing is sent anywhere except HubSpot (to read deals) and, if you ask for it, your own Slack webhook.

**v0.3, early.** The HubSpot side is tested against HubSpot's published API specs and against recorded responses. v0.1 has been run on one real HubSpot portal, with a custom pipeline and a service key, on test data: every stage move, slipped close date, close, new deal and next step change came out right. The v0.2 additions (the dollar bridge, close date passed, the look-first reasons, deal links and grouping) are tested on recorded and generated data. Stateless mode was checked on one HubSpot test portal against a snapshot stored mode saved at the same instant: 137 seeded deals, including merges, deletes and deals changed more than 20 times, with every difference accounted for. That is one portal, so it is not yet confirmed on many real portals. If you try it, please report problems in GitHub Issues, and tell us when it worked in GitHub Discussions. Both help.

## What the brief looks like

This is the real output of `node bin/monday-brief.mjs demo` (or `npx github:derrtaderr/monday-pipeline-brief#v0.3.0 demo`), run on a fictional pipeline (every company and rep name is made up, and the deal links point at a made-up HubSpot portal):

<!-- demo-output:start -->
```markdown
# Monday pipeline brief, week of Oct 5

Compared with the snapshot from Sep 28.

Open pipeline $1.29M across 23 deals, up $131K on last week.
Closed 3 won ($135K) and 1 lost ($90K).

**How the open pipeline changed**
- Sep 28 open pipeline: $1,155,000
- New deals: +$360,000 (4)
- Reopened: +$30,000 (1)
- Amount increases: +$21,000 (2)
- Amount decreases: -$15,000 (1)
- Won: -$135,000 (3)
- Lost: -$90,000 (1)
- Removed from HubSpot: -$40,000 (1)
- Oct 5 open pipeline: $1,286,000

**Look at these first** (2)
- [Quarry](https://app.hubspot.com/contacts/1234567/record/0-3/D105), $120K, Leo: close date slipped (slipped into Q1 2027; large deal)
- [Halcyon](https://app.hubspot.com/contacts/1234567/record/0-3/D102), $24K, Leo: close date slipped, no activity in 14+ days (2 warning signs)

**Close date passed** (1)
- [Orchard AI](https://app.hubspot.com/contacts/1234567/record/0-3/D119), $32K, Leo: close date was Sep 30, 5 days ago

**Slipped close dates** (3)
- [Quarry](https://app.hubspot.com/contacts/1234567/record/0-3/D105), $120K, Leo: Oct 19 → Jan 15 (+88 days)
- [Sable](https://app.hubspot.com/contacts/1234567/record/0-3/D115), $90K, Dana: Nov 6 → Dec 5 (+29 days)
- [Halcyon](https://app.hubspot.com/contacts/1234567/record/0-3/D102), $24K, Leo: Oct 3 → Dec 19 (+77 days)

**Moved back a stage** (2)
- [Driftwood](https://app.hubspot.com/contacts/1234567/record/0-3/D112), $60K, Dana: Proposal → Qualified
- [Pinecrest](https://app.hubspot.com/contacts/1234567/record/0-3/D110), $24K, Dana: Demo → Discovery

**No next step, or no activity in 14+ days** (4)
- [Vantage Freight](https://app.hubspot.com/contacts/1234567/record/0-3/D111), $90K, Dana: no next step
- [Arcadia](https://app.hubspot.com/contacts/1234567/record/0-3/D109), $48K, Marcus: no activity since Sep 18
- [Kestrel](https://app.hubspot.com/contacts/1234567/record/0-3/D113), $48K, Priya: no activity since Sep 11
- [Halcyon](https://app.hubspot.com/contacts/1234567/record/0-3/D102), $24K, Leo: no activity since Sep 14

**Moved forward** (3)
- [Fernway](https://app.hubspot.com/contacts/1234567/record/0-3/D104), $40K, Leo: Proposal → Negotiation
- [Oakmont](https://app.hubspot.com/contacts/1234567/record/0-3/D107), $40K, Priya: Qualified → Demo
- [Brightline](https://app.hubspot.com/contacts/1234567/record/0-3/D101), $18K, Priya: Demo → Proposal

**Changed stage** (1)
- [Wrenfield Clinics](https://app.hubspot.com/contacts/1234567/record/0-3/D126), $12K, Priya: Paused → Negotiating

**Moved to another pipeline** (1)
- [Tessellate](https://app.hubspot.com/contacts/1234567/record/0-3/D106), $40K, Marcus: Sales Pipeline (Discovery) → Renewals (Upcoming)

**Amount changed** (3)
- [Lumen Health](https://app.hubspot.com/contacts/1234567/record/0-3/D108), $96K, Dana: $90,000 → $96,000, then won
- [Northwind](https://app.hubspot.com/contacts/1234567/record/0-3/D100), $90K, Dana: $75,000 → $90,000
- [Westfield](https://app.hubspot.com/contacts/1234567/record/0-3/D118), $60K, Dana: $75,000 → $60,000

**New this week** (4)
- [Sundial](https://app.hubspot.com/contacts/1234567/record/0-3/D122), $120K, Dana
- [Beacon Pay](https://app.hubspot.com/contacts/1234567/record/0-3/D120), $90K, Marcus
- [Granite](https://app.hubspot.com/contacts/1234567/record/0-3/D121), $75K, Priya
- [Tidewater](https://app.hubspot.com/contacts/1234567/record/0-3/D123), $75K, Leo

**Reopened** (1)
- [Marlowe Systems](https://app.hubspot.com/contacts/1234567/record/0-3/D124), $30K, Marcus: was lost, now in Demo

**Closed** (4)
- [Lumen Health](https://app.hubspot.com/contacts/1234567/record/0-3/D108), $96K, Dana: won
- [Cobalt Labs](https://app.hubspot.com/contacts/1234567/record/0-3/D103), $24K, Priya: won
- [Harbor Freightworks](https://app.hubspot.com/contacts/1234567/record/0-3/D127), $15K, Leo: won, moved from Sales Pipeline to Renewals
- [Meridian](https://app.hubspot.com/contacts/1234567/record/0-3/D114), $90K, Dana: lost

**Removed from HubSpot** (1)
- [Juniper Bio](https://app.hubspot.com/contacts/1234567/record/0-3/D116), $40K, Leo: was open in Discovery, not returned by HubSpot now (deleted, archived or merged)
```
<!-- demo-output:end -->

Try it yourself in ten seconds, no HubSpot account needed:

```bash
git clone https://github.com/derrtaderr/monday-pipeline-brief
cd monday-pipeline-brief
node bin/monday-brief.mjs demo
```

## Five minute quickstart

You need Node 20 or newer and HubSpot admin rights (super admin, or permission to create service keys or private apps). The quickest start is to run it once against your portal in stateless mode: it rebuilds last week from HubSpot's history, so the first run already gives the full brief.

1. **Create a service key in HubSpot.** Settings, then Development, then Legacy Apps (or search the settings for "service key"), then **Create a service key**. Name it "Monday brief" and add exactly these three read scopes:
   - `crm.objects.deals.read`
   - `crm.objects.owners.read`
   - `settings.currencies.read` (stateless mode reads your currency settings, because it runs only on portals with one currency; stored mode does not need it)

   Create the key. On its page, the "Service Key" box has Show and Copy buttons; copy the key (it starts with `pat-`, for example `pat-na1-` or `pat-na2-` depending on your region). That is your `HUBSPOT_TOKEN`.

   **Older accounts that still offer private apps** can use one instead: Settings, then Integrations, then Private Apps, then **Create a private app**. On the Scopes tab tick the same three read scopes, create the app and copy its access token (it also starts with `pat-`).

   To revoke access later, open the key under Service Keys and press Delete (for a private app, delete the app).
2. **Put the token in your environment.** Never paste it into a file you commit.
   ```bash
   export HUBSPOT_TOKEN="paste your pat- token here"
   ```
   Replace everything between the quotes with the token you copied. If it is run exactly as shown, the tool rejects the placeholder on purpose and fetches nothing.
3. **Run it.**
   ```bash
   npx github:derrtaderr/monday-pipeline-brief#v0.3.0 run --since 7d
   # or, from a clone:
   node bin/monday-brief.mjs run --since 7d
   ```
   It prints this week's brief, compared with your pipeline as it stood 7 days ago (`--since 3d` or `--since 14d` work too, up to 90 days). It writes nothing to disk; add `--out brief.md` to save a copy. A portal with more than one currency is refused (exit 5) with a message; stored mode below works there.
4. **Optional, post to Slack.** Create a Slack incoming webhook for your channel and set it:
   ```bash
   export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
   ```
   Replace the whole URL with the one Slack gave you. The tool refuses a URL that still holds the `...` and stops before calling HubSpot.
5. **Run it every week.** The simplest is the GitHub Action below, which keeps no state.

**Stored mode instead.** Without `--since`, the tool keeps its own history: each run saves a snapshot of your deals to `~/.monday-pipeline-brief` in your home directory (the tool creates it) and compares with last week's file. The first run saves `snapshot-YYYY-MM-DD.json`, writes `brief-YYYY-MM-DD.md` there, and adds a line to `run.log`. A comparison needs two weekly runs, so the first brief says so plainly and shows only the current-state parts (open pipeline total, Close date passed, and the stale next step list). Stored mode works on any portal, needs only the first two scopes, and is not limited by what HubSpot's history keeps (see Stateless mode below). To schedule it, see the appendix at the end.

### Options

| Setting | How | Default |
|---|---|---|
| HubSpot token | `HUBSPOT_TOKEN` env var (required for `run`) | none |
| Slack webhook | `SLACK_WEBHOOK_URL` env var | off |
| Stateless mode | `--since 7d` (1d to 90d) or `--as-of 2026-10-01T09:00:00Z` (an exact instant with a zone, at most 90 days ago), or `MONDAY_BRIEF_SINCE=7d`; the flags win | off (stored mode) |
| Snapshot folder (stored mode) | `--dir DIR`, else `MONDAY_BRIEF_DIR` (a leading `~` means your home folder, even inside quotes) | `~/.monday-pipeline-brief` |
| Brief file | `--out FILE` (`--dir=DIR`, `--out=FILE` and `--since=7d` also work) | stored mode: `<snapshot folder>/brief-YYYY-MM-DD.md`; stateless mode: printed only |
| Skip the Next step check | `--no-next-step`, or `MONDAY_BRIEF_NEXT_STEP=off` | on |
| Large deal (one warning sign is enough for "Look at these first") | `--large-deal AMOUNT` (`50000`, `50K`, `1.5M` or `off`), or `MONDAY_BRIEF_LARGE_DEAL`; the flag wins | the largest open deals, at most 10% of them (at least one, unless every deal above $0 has the same amount and they outnumber that limit) |
| Group the brief | `--group-by owner` or `--group-by pipeline`, or `MONDAY_BRIEF_GROUP_BY`; the flag wins | one list |

With `--group-by owner`, the headline and the dollar bridge stay at the top for the whole pipeline, then each rep gets a heading with their own open total and their own sections, largest open total first. `--group-by pipeline` does the same per pipeline, headed with the pipeline's name as it is today (a renamed pipeline stays one group; a pipeline that is gone keeps its last name; two pipelines with the same name each get their HubSpot pipeline id after the name, as they do on any line that names a move between them). Each section still shows its 10 largest deals per group.

<details>
<summary>The demo grouped by owner (<code>node bin/monday-brief.mjs demo --group-by owner</code>)</summary>

<!-- demo-grouped-output:start -->
```markdown
# Monday pipeline brief, week of Oct 5

Compared with the snapshot from Sep 28.

Open pipeline $1.29M across 23 deals, up $131K on last week.
Closed 3 won ($135K) and 1 lost ($90K).

**How the open pipeline changed**
- Sep 28 open pipeline: $1,155,000
- New deals: +$360,000 (4)
- Reopened: +$30,000 (1)
- Amount increases: +$21,000 (2)
- Amount decreases: -$15,000 (1)
- Won: -$135,000 (3)
- Lost: -$90,000 (1)
- Removed from HubSpot: -$40,000 (1)
- Oct 5 open pipeline: $1,286,000

## Dana, open $534K across 7 deals

**Slipped close dates** (1)
- [Sable](https://app.hubspot.com/contacts/1234567/record/0-3/D115), $90K, Dana: Nov 6 → Dec 5 (+29 days)

**Moved back a stage** (2)
- [Driftwood](https://app.hubspot.com/contacts/1234567/record/0-3/D112), $60K, Dana: Proposal → Qualified
- [Pinecrest](https://app.hubspot.com/contacts/1234567/record/0-3/D110), $24K, Dana: Demo → Discovery

**No next step, or no activity in 14+ days** (1)
- [Vantage Freight](https://app.hubspot.com/contacts/1234567/record/0-3/D111), $90K, Dana: no next step

**Amount changed** (3)
- [Lumen Health](https://app.hubspot.com/contacts/1234567/record/0-3/D108), $96K, Dana: $90,000 → $96,000, then won
- [Northwind](https://app.hubspot.com/contacts/1234567/record/0-3/D100), $90K, Dana: $75,000 → $90,000
- [Westfield](https://app.hubspot.com/contacts/1234567/record/0-3/D118), $60K, Dana: $75,000 → $60,000

**New this week** (1)
- [Sundial](https://app.hubspot.com/contacts/1234567/record/0-3/D122), $120K, Dana

**Closed** (2)
- [Lumen Health](https://app.hubspot.com/contacts/1234567/record/0-3/D108), $96K, Dana: won
- [Meridian](https://app.hubspot.com/contacts/1234567/record/0-3/D114), $90K, Dana: lost

## Leo, open $315K across 6 deals

**Look at these first** (2)
- [Quarry](https://app.hubspot.com/contacts/1234567/record/0-3/D105), $120K, Leo: close date slipped (slipped into Q1 2027; large deal)
- [Halcyon](https://app.hubspot.com/contacts/1234567/record/0-3/D102), $24K, Leo: close date slipped, no activity in 14+ days (2 warning signs)

**Close date passed** (1)
- [Orchard AI](https://app.hubspot.com/contacts/1234567/record/0-3/D119), $32K, Leo: close date was Sep 30, 5 days ago

**Slipped close dates** (2)
- [Quarry](https://app.hubspot.com/contacts/1234567/record/0-3/D105), $120K, Leo: Oct 19 → Jan 15 (+88 days)
- [Halcyon](https://app.hubspot.com/contacts/1234567/record/0-3/D102), $24K, Leo: Oct 3 → Dec 19 (+77 days)

**No next step, or no activity in 14+ days** (1)
- [Halcyon](https://app.hubspot.com/contacts/1234567/record/0-3/D102), $24K, Leo: no activity since Sep 14

**Moved forward** (1)
- [Fernway](https://app.hubspot.com/contacts/1234567/record/0-3/D104), $40K, Leo: Proposal → Negotiation

**New this week** (1)
- [Tidewater](https://app.hubspot.com/contacts/1234567/record/0-3/D123), $75K, Leo

**Closed** (1)
- [Harbor Freightworks](https://app.hubspot.com/contacts/1234567/record/0-3/D127), $15K, Leo: won, moved from Sales Pipeline to Renewals

**Removed from HubSpot** (1)
- [Juniper Bio](https://app.hubspot.com/contacts/1234567/record/0-3/D116), $40K, Leo: was open in Discovery, not returned by HubSpot now (deleted, archived or merged)

## Priya, open $229K across 6 deals

**No next step, or no activity in 14+ days** (1)
- [Kestrel](https://app.hubspot.com/contacts/1234567/record/0-3/D113), $48K, Priya: no activity since Sep 11

**Moved forward** (2)
- [Oakmont](https://app.hubspot.com/contacts/1234567/record/0-3/D107), $40K, Priya: Qualified → Demo
- [Brightline](https://app.hubspot.com/contacts/1234567/record/0-3/D101), $18K, Priya: Demo → Proposal

**Changed stage** (1)
- [Wrenfield Clinics](https://app.hubspot.com/contacts/1234567/record/0-3/D126), $12K, Priya: Paused → Negotiating

**New this week** (1)
- [Granite](https://app.hubspot.com/contacts/1234567/record/0-3/D121), $75K, Priya

**Closed** (1)
- [Cobalt Labs](https://app.hubspot.com/contacts/1234567/record/0-3/D103), $24K, Priya: won

## Marcus, open $208K across 4 deals

**No next step, or no activity in 14+ days** (1)
- [Arcadia](https://app.hubspot.com/contacts/1234567/record/0-3/D109), $48K, Marcus: no activity since Sep 18

**Moved to another pipeline** (1)
- [Tessellate](https://app.hubspot.com/contacts/1234567/record/0-3/D106), $40K, Marcus: Sales Pipeline (Discovery) → Renewals (Upcoming)

**New this week** (1)
- [Beacon Pay](https://app.hubspot.com/contacts/1234567/record/0-3/D120), $90K, Marcus

**Reopened** (1)
- [Marlowe Systems](https://app.hubspot.com/contacts/1234567/record/0-3/D124), $30K, Marcus: was lost, now in Demo
```
<!-- demo-grouped-output:end -->

</details>

The token and the webhook URL are read from the environment only. There is deliberately no flag for them, so they stay out of your shell history. If you do change the folder, change it everywhere you run the tool, or your history splits in two.

### Run it every week with GitHub Actions (no state)

Stateless mode needs nowhere to keep files, so a scheduled GitHub Action is enough. Copy [`examples/github-action.yml`](examples/github-action.yml) to `.github/workflows/monday-brief.yml` in a repository of your own (the file sits under `examples/` here so it never runs on this repository), and add two repository secrets, `HUBSPOT_TOKEN` and `SLACK_WEBHOOK_URL`:

```yaml
# Copy this file to .github/workflows/monday-brief.yml in a repository of your own.
# It keeps no state: every Monday it rebuilds last week from HubSpot property history,
# compares it with today and posts the brief to Slack. Nothing is stored between runs.
# Add two repository secrets first: HUBSPOT_TOKEN and SLACK_WEBHOOK_URL. Without the Slack
# secret the job fails at once, since Slack is the only place the brief goes.
name: Monday pipeline brief
on:
  schedule:
    - cron: '0 12 * * 1' # Mondays 12:00 UTC
  workflow_dispatch: {}
permissions: {}
jobs:
  brief:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # The brief goes to Slack. Its printed copy is thrown away, so deal names never
      # reach the workflow log, which anyone with read access to the repository can open.
      - run: |
          test -n "$SLACK_WEBHOOK_URL" || { echo "::error::Add the SLACK_WEBHOOK_URL secret: this job sends the brief to Slack only."; exit 1; }
          npx --yes github:derrtaderr/monday-pipeline-brief#v0.3.0 run --since 7d > /dev/null
        env:
          HUBSPOT_TOKEN: ${{ secrets.HUBSPOT_TOKEN }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

The brief reaches you in Slack. The workflow throws away the printed copy, because a workflow log can be read by anyone with read access to the repository; for the same reason the job fails at once, before reading HubSpot, when the `SLACK_WEBHOOK_URL` secret is missing. Run it once by hand from the Actions tab (Run workflow) to check it.

The `#v0.3.0` in the `npx` line pins the release, so a later change to this repository never runs with your HubSpot token until you change the tag yourself. In a public repository, GitHub turns off scheduled workflows after 60 days with no repository activity and emails you when it does; re-enable it from the Actions tab.

To run stored mode on a schedule instead, on your own machine with cron or launchd, see the appendix at the end.

## Stateless mode: how last week is rebuilt

HubSpot keeps a history of every change to a deal property. `--since 7d` reads it and rebuilds each deal as it stood at that instant (the comparison date), then compares that with today, exactly as stored mode compares two snapshot files.

- **What is read.** Your currency settings first. Then every live deal with its history (50 per page, HubSpot's limit when history is requested), the recycle bin without history, and the deals deleted since the comparison date read again with their full history (50 per request; the recycle bin listing keeps only one version of each property). Then each pipeline and its change log, so stage names and the stage order are the ones in force on that date (a pipeline whose change log is empty or missing uses today's), and owners. That is about twice the requests of stored mode: roughly 9 for 100 deals, 29 for 1,000 and 223 for 10,000 (with 1, 3 and 5 pipelines, and 2% of deals deleted in the week), all within HubSpot's rate limits.
- **What it keeps.** Nothing. No snapshot is written, neither the rebuilt one (which a later stored run could mistake for a real one) nor today's, and no `run.log`. Only `--out`, if you give it, writes a file.
- **Could not rebuild.** HubSpot keeps the newest 20 versions of each property. A deal changed more than 20 times since the comparison date in its stage, pipeline, amount or close date cannot be fully rebuilt, and neither can a deal that two deals were merged into since then (its history mixes both). So is a deal whose stage then is missing from the pipeline settings HubSpot kept for that date (limit 5 below). These deals are listed in their own section, "Could not rebuild as of Sep 28", which says what is unknown and names the merged records. When the state then is known (only the close date was lost, say), the deal still counts: "Sep 28 open pipeline: $215,000 ($206,000 rebuilt + $9,000 from 1 deal only partly rebuilt)". When it is not, the deal is left out of that total and the headline says so: "(the Sep 28 total leaves out 2 deals merged since then and 1 deal whose state then could not be rebuilt)". A bridge line, "Could not rebuild", carries those deals' amounts today, so the bridge still adds up to today's open total. Owner, next step and last activity are read from today only, so changes to those never stop a rebuild.
- **Pushes.** A close date moved later two or more times since the comparison date says so on its Slipped line: "(+46 days, pushed 2 times)". Only later dates count; a pull-in, a cleared date and the date HubSpot stamps when a deal closes do not.

What stateless mode cannot see, where stored mode can:

1. **Merges.** What the merged deals held on the comparison date is unknown; they drop out of the start total and the headline says how many.
2. **More than 20 changes** to a deal's stage, pipeline, amount or close date since the comparison date (above).
3. **Restored deals.** A deal deleted before the comparison date and restored from the recycle bin since rebuilds as if it had never been deleted. Untested.
4. **Permanently deleted deals** (a GDPR delete, or a recycle bin entry older than 90 days) are in no listing, so they vanish without a "Removed from HubSpot" line. Untested.
5. **Deleted pipelines and stages.** A deal whose stage on the comparison date is missing from the pipeline settings HubSpot kept for that date (its pipeline or stage was deleted, or the pipeline's change log does not reach back that far) has no stage name and no open, won or lost status then. It is listed under Could not rebuild and left out of the start total, never counted as open.
6. **Deals deleted moments before the run.** HubSpot's recycle bin listing can take a few seconds (in one test, under a minute) to show a deal just deleted. Such a deal drops out of both ends of the comparison and gets no Removed line.
7. **Portals with more than one currency** are refused (exit 5) until stateless mode has been checked on one.

## Exactly what each section checks

All deals in all deal pipelines are read. "Open" means the deal's stage is not a closed stage.

- **Headline.** Sum of the deal amount over open deals now, and the change from the previous snapshot's open total. Won and lost: deals that are closed now and were open last week (or did not exist last week). Won means a closed stage with probability 100%; lost means any other closed stage. This comes from HubSpot's stage settings, never from the stage name.
- **How the open pipeline changed.** A reconciliation from the previous snapshot's open total to today's, in exact dollars so the lines add up: new deals, reopened deals, amount increases and decreases on deals that were open, won, lost, and open deals no longer returned by HubSpot. Won and lost are counted at their closing amount, and any amount change on the way to closing is counted as an increase or decrease first. A deal that is new and already closed counts as new and as won or lost, which nets to zero. The tool checks that the lines add up before it writes the brief and stops with an error if they ever do not. Left out when nothing changed.
- **Stages we couldn't read.** If an open deal's stage is missing from the pipeline settings HubSpot returns (usually an archived or deleted stage), the brief and the terminal say how many deals and how much money that is. Those deals are counted as open and are left out of stage-move checks.
- **Look at these first.** Open deals with at least one of these flags: close date slipped, moved back a stage, close date passed, no next step or no activity in 14+ days. A deal is listed when it has two or more flags, or one flag and either it is a large deal or its close date slipped into a later calendar quarter (for example Q4 2026 to Q1 2027). Each line ends with why it is there, such as "(2 warning signs)", "(large deal)" or "(slipped into Q1 2027)".

  By default the large deals are the largest open deals, at most 10% of them (at least one, unless every deal above $0 has the same amount and they outnumber that limit): 2 of 21 deals, 50 of 500. Deals tied on the same amount right at the cut-off are left out together, so a tie never pushes the list past 10%; if that would leave no large deal at all and every open deal with an amount is the same size, no deal is large, since none is larger than the rest; otherwise the tied deals are taken in order of lowest HubSpot record id (normally the oldest record) up to the limit. A $0 deal is never large. A fixed dollar figure would be wrong for most teams, since deal sizes differ by 100x from one company to the next, so the default scales with your pipeline. Set your own with `--large-deal 50000` (or `50K`, `1.5M`), or `MONDAY_BRIEF_LARGE_DEAL=50000` in your env file, or turn the rule off with `off`.
- **Close date passed.** Open deals whose `closedate` is before the day of the brief. This is about the date itself, not a change: a deal can be both slipped and past its close date.
- **Slipped close dates.** Open deals whose `closedate` is later than last week. In stateless mode, a deal whose close date was pushed later two or more times since then also says how many times.
- **Moved back a stage / Moved forward / Changed stage.** Open deals that are in a different stage of the same pipeline than last time. Back or forward compares the old stage and the new stage in the stage order you set in HubSpot's pipeline settings, as it is on the day of this brief: each snapshot stores every pipeline's full stage order, so this works even if the old stage is now empty or was moved. Reordering the stages in a pipeline moves no deal, so it never shows here. On a live run, a deal is listed under **Changed stage** (old stage to new, with no back or forward) when its old stage has been deleted in HubSpot since the last snapshot: today's stage order no longer lists it, so the two stages cannot be compared in one stage order. Changed stage is not a warning sign. A deal moved to a different pipeline is not counted as a stage move; it is listed under Moved to another pipeline.
- **No next step, or no activity in 14+ days.** HubSpot has a free-text "Next step" field (`hs_next_step`) but no next step due date, so the brief checks two things on open deals:
  - `hs_next_step` is empty, or
  - `hs_next_step` is filled in, but `notes_last_updated` (HubSpot's "Last Activity Date", the last logged call, email, meeting or note) is 14 or more days old. If no activity has ever been logged, the deal's creation date (`createdate`) stands in: a deal created less than 14 days ago is not flagged, and an older one reads "no activity logged since it was created Sep 20".

  An empty Next step is flagged on any open deal, even one created today, because the next step is the one field that says what happens next and filling it takes seconds.

  It does not use "Last modified date", because workflows and integrations update that on deals nobody has touched.

  **If your team does not use the Next step field**, every open deal would land here. Run with `--no-next-step` (or put `export MONDAY_BRIEF_NEXT_STEP=off` in your env file) and the section becomes "No activity in 14+ days", checking only `notes_last_updated` (and `createdate` when nothing is logged).
- **Moved to another pipeline.** Open deals that were open last time in a different pipeline, shown as old pipeline (stage) → new pipeline (stage). With `--group-by pipeline` the deal is listed under both pipelines, so the one it left still shows it. The dollar bridge is for the whole portal, so a transfer is not a bridge line.
- **Amount changed.** Deals that were open last time and whose amount changed, old amount to new, including deals that closed this week (marked "then won" or "then lost").
- **New this week.** Deals that were not in the previous snapshot.
- **Reopened.** Deals that were won or lost last time and are open again.
- **Closed.** The won and lost deals from the headline. A deal that went from an open stage straight to a closed stage of another pipeline says so: "won, moved from Sales Pipeline to Onboarding" (and with `--group-by pipeline` it is listed under both pipelines). It is still counted once as won or lost in the bridge.
- **Removed from HubSpot.** Deals that were open last time and that HubSpot no longer returns (deleted, archived or merged).
- **Could not rebuild** (stateless mode only). Deals HubSpot's history could not rebuild on the comparison date, as described under Stateless mode, each with what is unknown and, for a merge, the merged record ids.

Each deal's name links to the deal in HubSpot (in Slack too). Snapshots written by v0.1 have no link, so a deal seen only in one of those shows its plain name. Lists are sorted by amount, largest first. Each section shows its 10 largest deals, then one line such as "and 37 more ($1.2M)", so a big pipeline still gives a short brief; the section heading always carries the full count. Empty sections are left out. The Slack message is also kept under 35,000 characters, below Slack's limit; if it ever has to be cut, it says so and the saved file is the full brief.

## Where your data goes

- Stateless mode writes nothing to disk except the brief file you name with `--out`.
- In stored mode, snapshots are plain JSON on your disk, one file per week, kept private: folders and files the tool creates get permissions 0700 (folders) and 0600 (snapshots, briefs, `run.log`), and existing ones keep their permissions, so if you point `--dir` at a folder you already have, check who can read it. Each snapshot holds only these fields per deal: id, name, owner name, pipeline, stage, stage order, open/won/lost, amount, close date, next step text, last activity date, creation date and the link to the deal in HubSpot. It also holds each pipeline's stage list (id, name, order and open/won/lost), so later briefs can read stage moves in the order that was current.
- The token is sent only to `api.hubapi.com` in the Authorization header. It is never written to a snapshot, the brief, a log or an error message, and a test checks that across every success and failure path.
- No telemetry. The tool never phones home.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Brief written (and posted, if Slack is set) |
| 1 | Setup problem found before HubSpot is called: `HUBSPOT_TOKEN` not set or pasted with smart quotes or spaces, a `SLACK_WEBHOOK_URL` that is not a Slack incoming webhook URL (for example the `...` placeholder), a snapshot folder you cannot read or write, an `--out` location you cannot write to or that is a folder (for example `EACCES`), a `--group-by` (or `MONDAY_BRIEF_GROUP_BY`) that is not owner or pipeline, a `--large-deal` (or `MONDAY_BRIEF_LARGE_DEAL`) that is not an amount or off, a `--since` (or `MONDAY_BRIEF_SINCE`) that is not 1d to 90d, an `--as-of` that is not a past instant with a zone within 90 days, `--since` with `--as-of`, `--dir` with stateless mode, `demo --dir`, or an unknown option. Nothing is fetched from HubSpot. Also used for an unexpected error, printed as "Unexpected error: ..." with secrets removed |
| 2 | HubSpot refused or failed (bad token, missing scope, still rate limited after 5 retries). Nothing is written except, in stored mode, a line in `run.log` |
| 3 | The brief was written, but the Slack post failed |
| 4 | HubSpot was read but a file could not be written (for example a full disk). The message names the file and says whether today's snapshot was saved. `demo --out` and a stateless `--out` use this code too |
| 5 | Stateless mode refused on this portal: it has more than one currency, or the token lacks the `settings.currencies.read` scope. Nothing past the currency check is read and nothing is written. Stored mode (no `--since`) still works |

If `run.log` itself cannot be written, the run prints a warning and keeps its exit code.

Rate limits (HTTP 429) and HubSpot server errors are retried up to 5 times, waiting as long as HubSpot asks up to 60 seconds per wait. If HubSpot asks for a longer wait, the run stops with exit 2 and you can simply run it again later.

## Limitations

- HubSpot only. No Salesforce yet.
- In stored mode, history starts on your first run. Stateless mode rebuilds up to 90 days back, within the limits listed under Stateless mode.
- All deal pipelines are read into one brief. `--group-by pipeline` gives each pipeline its own heading and sections; the headline and the dollar bridge stay whole-portal.
- Quarters are calendar quarters; a fiscal year that starts in another month is not configurable yet.
- Amounts: each deal uses `amount_in_home_currency` (HubSpot's conversion to your company currency) when HubSpot returns it, and falls back to `amount` when it does not. If your portal has multiple currencies turned off, that is simply `amount`. No other currency conversion is done. Stateless mode refuses portals with more than one currency.
- Dates are taken as the calendar date HubSpot returns (UTC), which can differ by a day from what you see in your time zone.
- The stale check uses last logged activity, which is only as good as your team's logging.
- In Slack, a HubSpot name that contains formatting marks (`*bold*`, `_italic_`, `~strike~` or backticks) shows with that formatting, and a Markdown viewer may format it too. Slack has no escape for these marks, so the name is sent as typed; links, mentions and HTML in names are always neutralised.
- Closed stages come from each stage's "closed" setting in HubSpot. If HubSpot ever sends a stage without it, the tool falls back to the stage's probability: 100% counts as won, 0% as lost, anything else as open. A closed stage with another probability would then count as open, and an open custom stage set to 0% probability with no `isClosed` would be counted as lost.

## Did it help?

If you got a brief with real changes in it, whether from the first run with `--since 7d` or from the second weekly run in stored mode, please open a GitHub Discussion or an issue and say so, even in one line. There is no telemetry, so that is the only way we learn whether this is worth building further (Salesforce is next if it is). Feature requests are welcome there too.

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

## Appendix: schedule stored mode with cron or launchd

This appendix is for stored mode, which keeps its snapshots on your machine. (For stateless mode, the GitHub Action above is simpler.) The tool does not schedule itself. Use what your machine already has. Scheduled jobs need fixed paths, so clone the repo once (`git clone https://github.com/derrtaderr/monday-pipeline-brief`) and fill in two paths below:

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
