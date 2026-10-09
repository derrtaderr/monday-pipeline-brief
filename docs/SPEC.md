# monday-pipeline-brief: v1 spec

The design of v1: what it does, the choices behind it, and the checks that hold it in place.

## The problem

Every Monday a RevOps manager or head of sales at a 50 to 500 person B2B SaaS company on
HubSpot wants one readout of what changed in the pipeline since last week, and often rebuilds
it by hand from exports. This tool keeps a weekly snapshot on the user's own disk and writes
that readout. (Wording corrected in v0.2: HubSpot does keep property history; the earlier text
said it stored only current state.)

## Scope (v1)

1. Read HubSpot deals with the user's own HubSpot service key or private app token from the
   `HUBSPOT_TOKEN` env var.
   Paginate (`paging.next.after`), back off on 429 (honour `Retry-After`, else exponential),
   retry 5xx the same way, give up after 5 retries with a plain error.
2. Resolve stage IDs to labels and stage order via `GET /crm/v3/pipelines/deals`, and owner IDs
   to names via `GET /crm/v3/owners` (active, then `archived=true` so deactivated reps still
   resolve).
3. Write a weekly snapshot JSON to a configurable directory. History accrues from the first run.
4. Diff against the baseline snapshot (the newest readable one at least 6 days old, else the
   newest readable earlier one; see "Which snapshot a brief compares with") and write the brief (markdown file, stdout,
   optionally a Slack incoming webhook).
5. `demo` command: keyless, runs on bundled fictional fixture snapshots and prints the sample brief.
6. First run (one snapshot only): say plainly that a comparison needs two weekly runs, and still
   print the current-state parts (open pipeline total, the stale next step section; from v0.2 also Close date passed).

Not in v1: Salesforce, hosting, telemetry, a UI, a scheduler (README documents cron and launchd).

## Commands

```
node bin/monday-brief.mjs demo [--out FILE]
node bin/monday-brief.mjs run  [--dir DIR] [--out FILE] [--no-next-step]
node bin/monday-brief.mjs help
```

- `run` reads `HUBSPOT_TOKEN` (required) and `SLACK_WEBHOOK_URL` (optional) from the
  environment only. Neither is accepted as a flag, so neither lands in shell history or `ps`.
- Snapshot directory: `--dir`, else `MONDAY_BRIEF_DIR` (an empty value counts as unset), else `~/.monday-pipeline-brief` (one folder for manual and scheduled runs). A leading `~` and one layer of surrounding quotes are removed from `--dir`, `--out` and `MONDAY_BRIEF_DIR`; `--dir=DIR` and `--out=FILE` also work. The tool creates the folder, checks it is readable and writable before calling HubSpot (exit 1 if not), and appends one redacted line per run to `<dir>/run.log`.
- Files written: `<dir>/snapshot-YYYY-MM-DD.json` and `<dir>/brief-YYYY-MM-DD.md` (or `--out`).
  A second run on the same day overwrites that day's snapshot. "Previous" is chosen as
  described under "Which snapshot a brief compares with".
- Exit codes: 0 ok; 1 usage or setup problem found before HubSpot is called (nothing fetched),
  or an unexpected error; 2 HubSpot error (only a `run.log` line written); 3 Slack post failed
  (brief and snapshot already written); 4 a file could not be written after work began (the
  message names the file and whether today's snapshot was saved; `demo --out` uses it too).
  `run.log` itself failing is a warning and never changes the exit code.
- Also documented as `npx github:derrtaderr/monday-pipeline-brief run`.

## Design decisions

### Snapshot format (schema 1)

```json
{
  "schema": 1,
  "taken_at": "2026-10-05T07:00:00.000Z",
  "date": "2026-10-05",
  "source": "hubspot",
  "deals": [
    {
      "id": "123", "name": "Northwind", "owner": "Dana Ruiz",
      "pipeline_id": "default", "pipeline": "Sales Pipeline",
      "stage_id": "qualifiedtobuy", "stage": "Qualified", "stage_order": 1,
      "status": "open", "amount": 75000, "close_date": "2026-12-02",
      "next_step": "Pricing call", "last_activity": "2026-10-01", "created": "2026-08-03"
    }
  ]
}
```

Each deal carries its own `stage_order` and `status`, so an old snapshot can be read without
re-fetching pipeline metadata, and a later change to the pipeline layout does not rewrite history.
The snapshot contains only these fields. No token, no request headers, no raw API payload.

### Stage order and closed status come from HubSpot, not from labels

- `stage_order` is the stage's `displayOrder` in its pipeline. No hardcoded stage list.
- `status` comes from stage metadata. When `isClosed` is present (the string `"true"` or
  `"false"`, or a boolean): closed with `probability` 1 means won, closed with any other or no
  probability means lost, not closed means open. When `isClosed` is absent, `probability`
  alone decides: exactly 1 (`"1.0"`, `"1"` or `1`) is won, exactly 0 is lost, anything else or
  no probability is open. HubSpot's published spec documents `probability` but not
  `isClosed`, so this fallback keeps won and lost deals out of the open total if `isClosed`
  is ever missing. Label text such as "Closed won" is never read.
- "Moved forward" and "moved back" compare `stage_order` only when the deal is in the same
  pipeline in both snapshots and open in both. A pipeline change is not counted as a stage move.

### The "stale next step" definition (divergence from the task wording)

HubSpot has `hs_next_step` (free text) and no standard next step date, so "next step overdue
14+ days" cannot be checked literally. v1 checks, for open deals only:

- **No next step**: `hs_next_step` is empty or whitespace.
- **No activity in 14+ days**: `hs_next_step` is set, but `notes_last_updated` (HubSpot's
  "Last Activity Date", the last logged call, email, meeting or note) is missing or 14 or more
  days before the brief date.

Why `notes_last_updated` and not `hs_lastmodifieddate`: any property write, including
workflows, integrations and imports, bumps `hs_lastmodifieddate`, so a deal nobody has touched
can look fresh. Last activity is the closest standard field to "someone actually worked this
deal". The section is titled "No next step, or no activity in 14+ days" so the brief says
exactly what it checked. The README says the same.

### Sections and rules

- Headline: open pipeline total and count, delta versus the previous snapshot's open total;
  won and lost counts and amounts for deals that closed since the previous snapshot (open last
  week, or not present last week, and closed now).
- Look at these first: open deals with more than one warning flag (slipped close date, moved
  back a stage, stale next step), largest amount first.
- Slipped close dates: open deals whose close date moved later.
- Moved back a stage, Moved forward: per the rule above.
- No next step, or no activity in 14+ days: per the definition above.
- New this week: deals not present in the previous snapshot.
- Closed: deals that closed since the previous snapshot, with won or lost.
- Empty sections are omitted. Lists sort by amount, largest first.
- Amounts are summed as plain numbers in the portal's currency. Multi-currency is not converted.

### First run

With no earlier snapshot the brief says: "This is the first snapshot. A comparison needs two
weekly runs, so the week-over-week sections start next week." It still prints the open
pipeline total and the stale next step section.

### Keeping the token out of everything

- The token is read from `process.env.HUBSPOT_TOKEN` and passed only into the HubSpot client,
  which puts it in the `Authorization` header and nowhere else (never in a URL).
- Error messages are built from status codes and endpoint paths, never from headers.
- The CLI's top-level error handler also redacts the token and the Slack webhook URL from any
  message before printing, as a second line of defence.
- A test runs `run` end to end with a token-shaped value (`pat-na1-...`) through every success
  and failure path and asserts the string appears in no written file, no stdout and no stderr.

### Demo fixtures

The seed fixtures (`snapshot-2026-09-28.json`, `snapshot-2026-10-05.json`, fictional
companies and reps) live in `test/fixtures/seed/`. The demo snapshots in `demo/` are generated
from them by a test helper with one documented mapping, because the seed rows carry a
`next_step_date` field that HubSpot does not have:
`last_activity = min(next_step_date, snapshot date minus 2 days)`. A deal the seed data
calls overdue keeps its old date and stays stale; a deal with a future next step gets a
recent activity date. Won and lost deals move to closed won and closed lost stages, as they
would in HubSpot. A test asserts the committed demo snapshots equal that conversion.

### Stack

Node >= 20, ES modules, zero runtime dependencies, `node --test`. The HubSpot client takes an
injectable `fetch` and `sleep`, so every HubSpot path is tested against recorded fixture
responses (including a two-page listing and a 429) with no network.

## Prior art

- Coefficient historical snapshots, Weflow, Clari, Zapier's weekly forecast rollup template,
  HubSpot scheduled reports (current state only, no week-over-week diff), and practitioners'
  own DIY scripts.
- The gap v1 fills: free, runs on the user's side, keeps week-over-week history, and writes the
  readout instead of a chart.

## Divergences from the obvious design

1. "Next step overdue 14+ days" became "no activity in 14+ days while a next step is set",
   for the reason above.
2. The brief adds one line naming the snapshot it compared against, so a skipped week is visible.
3. Deals deleted from HubSpot between runs are not listed. Their amount leaves the open total.
   Stated as a limitation in the README.

## Gates (run on every commit)

| Area | Gate command | What passing looks like |
|---|---|---|
| All logic, HubSpot client, CLI, security | `npm test` | every `node --test` test passes, 0 failures |
| README example freshness | `npm test` (test `readme matches demo output`) | README block between the demo markers equals `demo` stdout byte for byte |
| Lint | `npm run lint` | `node --check` passes on every `.mjs`, README has no em dash, `package.json` has no runtime dependencies, no home-directory paths or review-log language in any file |
| Demo smoke | `node bin/monday-brief.mjs demo` | exit 0, prints the sample brief |

## HubSpot contract tests and pre-publish polish (v0.1)

The HubSpot responses the tests use are recorded by hand. The strongest check available without
a HubSpot portal is to hold those fixtures, and the requests the client sends, against
HubSpot's own published OpenAPI specs.

### Source and license decision

- Source: `github.com/HubSpot/HubSpot-public-api-spec-collection`, pinned at commit
  `b123c5de888fd6405fab85db9c8560ce4e61dfc6`. Files used:
  - `PublicApiSpecs/CRM/Deals/Rollouts/424/v3/deals.json`
  - `PublicApiSpecs/CRM/Pipelines/Rollouts/145896/v3/pipelines.json`
  - `PublicApiSpecs/CRM/Crm Owners/Rollouts/146888/v3/crmOwners.json`
- License: the repository has no license file, and its README says "These specifications are
  proprietary to HubSpot and are not licensed for external use." So nothing from it is copied
  into this repo. The contract tests read the specs from a folder named by `HUBSPOT_SPEC_DIR`
  and skip cleanly when it is unset. `scripts/fetch-hubspot-specs.mjs` downloads the three
  files at the pinned commit into a folder of your choice, for your own local testing.

### What the contract tests check

1. Every recorded HubSpot response in `test/fixtures/hubspot/` (deal pages, pipelines, owners,
   error bodies) validates against the spec's response schema for the endpoint the client
   calls. The validator is a small JSON-schema subset in test code (`type`, `required`,
   `properties`, `additionalProperties` as a schema or `false`, `items`, `enum`, `$ref`,
   `format: date-time`). It throws on any keyword outside that subset and the annotation
   keywords (`description`, `example` and the like), so a spec that starts using `oneOf`,
   `anyOf`, `allOf`, `not` or anything else fails loudly instead of passing unchecked.
2. Every request the client makes uses a path, method and query parameter names the spec
   defines, with values of the declared type. The deals spec does not enumerate deal property
   names (its `properties` is a free-form string map), so property names are not checked
   against it; a test asserts that shape so a future spec that does enumerate them is noticed.
3. The paging shape (`paging.next.after`) and the stage `metadata` shape match the spec.

### What the specs showed

- **Fixture mismatches, fixed.** Every recorded response was missing fields the specs mark
  required: `createdAt` and `updatedAt` on deals, pipelines and stages, and `type`,
  `createdAt` and `updatedAt` on owners. The client never reads these fields, so its behaviour
  does not change, but the fixtures now look like what HubSpot documents. Error bodies for
  401, 403 and 429 were added in the spec's `Error` shape (`category`, `correlationId`,
  `message`); they are modelled on that schema, not recorded from a portal.
- **No client mismatch.** Every path, method and query parameter the client sends (`limit`,
  `after`, `properties`, `archived`) is defined by the spec for that endpoint, with a value of
  the declared type.
- **Deals path alias.** The v3 deals spec lists the endpoint as `/crm/v3/objects/0-3` (the
  deals object type id). The client calls `/crm/v3/objects/deals`, the object type name the
  same spec's description documents. The test maps one to the other and checks that the
  spec's description still names `deals`.
- **`properties` encoding.** The spec declares `properties` as an array with `explode: true`
  (which would mean repeated `properties=` params) and describes it as "a comma separated
  list". The client sends one comma-separated value, which follows the description.
- **Null property values.** The spec types every deal property value as a string. HubSpot
  returns null for a requested property with no value, and the client handles that, so the
  deal fixtures keep nulls and the validator allows null for property values only.
- **Stage metadata.** The spec types `metadata` as a string map and documents `probability`
  for deal pipelines. It does not document `isClosed`, which the tool reads to tell open from
  closed stages; the fixtures carry it as the string `"true"` or `"false"`. This is the one
  field the tool depends on that the specs cannot vouch for, so when a stage has no
  `isClosed` the tool falls back to `probability` (1 won, 0 lost, else open), as described
  under "Stage order and closed status".
- **Deal property names.** Not enumerated by the spec (free-form map), so not checked beyond
  the five defaults its description names.

### Pre-publish polish

- README: v0.1 early-release note, launchd "test it now" and reinstall steps, the cron
  equivalent, the missing env file as a top cause in troubleshooting, creating the env file and
  the LaunchAgents folder, placeholders that cannot be run literally.
- An empty `MONDAY_BRIEF_DIR` is treated as unset.
- This spec: the baseline rule in scope item 4, and `--no-next-step` in the `run` synopsis.
- `flow.md`: the same-day re-run state gets its exit code and files.

### Gates for this work

| Area | Gate command | What passing looks like |
|---|---|---|
| Contract tests | `node scripts/fetch-hubspot-specs.mjs /tmp/hubspot-specs && HUBSPOT_SPEC_DIR=/tmp/hubspot-specs npm test` | every contract test runs (none skipped) and passes |
| Contract tests, no specs | `npm test` | contract tests are reported as skipped, everything else passes |
| README and docs | `npm test` (readme tests), `npm run lint` | pass |
| Demo freshness | `node bin/monday-brief.mjs demo` | exit 0, output equals the README demo block |

## Final README and contract hardening

### Schedule recipes

- launchd: save the plist, replace both `/path/to/` placeholders (the callout sits here, with a
  one-line check that none is left, because `plutil -lint` passes an unfilled plist), then
  `launchctl bootstrap`, then "test it now". cron: the same order, placeholders filled before
  `crontab -e`. A readme test holds the callout before the install command in both recipes.
- The cron line sends stdout to `/dev/null`, as launchd does, so deal data never lands in local
  mail. `run.log` is the record of every run.
- The env file section says `MONDAY_BRIEF_DIR` must be an absolute path or start with `~`,
  because a relative path resolves against the scheduler's working directory.
- The optional Slack line in the env file example is commented out.

### Slack webhook setup check

`SLACK_WEBHOOK_URL`, when set, must start with `https://hooks.slack.com/` and must not contain
`...` (or the single-character ellipsis), the README's placeholder. Anything else is a named setup
error: exit 1 before any HubSpot call, nothing fetched, and the URL is never printed. Every Slack
test uses a `hooks.slack.com` URL, so the host check costs no test coverage.

### Spec provenance

`scripts/fetch-hubspot-specs.mjs` deletes any old marker first, downloads the three files, and
writes `spec-sha.txt` (holding `SPEC_SHA`) last, so a partial download never carries a marker.
Every contract test checks that the marker in `HUBSPOT_SPEC_DIR` matches `SPEC_SHA` and fails
with "re-run the fetch script" otherwise. A network failure prints one plain line and exits 1,
with no stack trace.

### Docs

- `flow.md`: the "scheduled run did not happen" state names a missing or misnamed env file.
- README limitations: an open custom stage set to 0% probability with no `isClosed` would be
  counted as lost (the probability fallback).

## Robustness and safety

### Which snapshot a brief compares with

The previous snapshot is the newest readable one that is at least 6 days older than today. If
none is that old, it is the newest readable earlier snapshot. So an ad-hoc mid-week run never
displaces the weekly baseline: a brief run by hand on Friday and then by cron on Monday still
compares Monday with the Monday before. Unreadable snapshots (not JSON, another schema, no
deals list, a deal with no id) are named and skipped; amounts are coerced to numbers on load.
Today's snapshot is written before the previous one is read, so a bad older file never stops
history accruing.

### Honest comparison wording

The gap is the number of days between the previous snapshot and today.

- 6 to 8 days: "Compared with the snapshot from Sep 28.", "up $156K on last week", "New this
  week", "Nothing flagged this week.", heading "week of Oct 5".
- Any other gap: "Compared with the snapshot from Sep 21, 2 weeks ago." (a multiple of 7 reads
  as weeks, anything else as days), "up $39K since Sep 21", "New since Sep 21", "Nothing
  flagged since Sep 21.", heading "Oct 5" with no week claim.
- Skipped files are named in the brief itself, then a blank line: "Skipped unreadable
  snapshot-2026-09-28.json (not valid JSON)." With no readable earlier snapshot the brief
  opens "No earlier snapshot could be read." The Slack text is derived from the brief.

### Token format

`HUBSPOT_TOKEN`, after trimming, must be printable ASCII (`!` to `~`) with no quote characters.
Anything else (smart quotes, inner spaces, non-ASCII) fails at once with exit 1, before any
request, and the message never contains the token. The client applies the same rule and builds
its headers outside the retry loop, so a header that cannot be sent is never retried as a
network failure.

### Files and permissions

- The snapshot folder and the `--out` location are checked before HubSpot is called (exit 1).
  The folder must be readable and writable; `--out` must not be a folder.
- Folders the tool creates are 0700; snapshot, brief and `run.log` files it creates are 0600.
  Existing folders and files keep their permissions.
- The README's launchd and cron recipes send stdout to `/dev/null` (the brief is already
  saved), so deal data never lands in a world-readable `/tmp` log or in local mail.

### Large and odd pipelines

- Every section shows its 10 largest, then "and N more ($X)". Slack text is capped at 35,000
  characters and says when it was cut.
- `--no-next-step` / `MONDAY_BRIEF_NEXT_STEP=off` makes the stale check activity-only.
- Open deals whose stage is missing from pipeline metadata are counted in the brief and warned
  on stderr.
- A Retry-After over 60 seconds fails clean (exit 2). Each deal uses `amount_in_home_currency`
  when HubSpot returns it, else `amount`.
- Usage and messages show the command actually used (`node bin/monday-brief.mjs`, an absolute
  path, or the npx form).

### Shipped files

`package.json` `files` limits the package to `bin`, `src`, `demo`, `README.md` and `LICENSE`.
The lint gate fails on home-directory paths and on review-log language anywhere in the repo.

Out of scope (README limitations): deleted deals, pipeline moves, pruning old closed deals,
failure notification under cron beyond the log location.

## Real-portal fixes (v0.1.1)

v0.1.0 was run against a real HubSpot portal for the first time: a free account in the na2
region, a custom pipeline, 22 seeded test deals and a simulated week of changes. Every stage
move, slipped close date, close, new deal and next step change was reported correctly. The run
found two problems that no recorded fixture could show.

### 1. A portal with little logged activity flagged every deal as stale

`notes_last_updated` is null until someone logs a call, email, meeting or note on the deal. On
that portal every open deal was flagged, including a deal created minutes before the run, which
was listed under "no activity in 14+ days". Those flags also pushed deals into "Look at these
first".

The rule, for open deals:

- **No next step** (with the next step check on): `hs_next_step` is empty. This flags whatever
  the deal's age.
- **No activity in 14+ days**: the next step is set (or the check is off), and either
  - `notes_last_updated` is set and 14 or more days before the brief date, or
  - `notes_last_updated` is missing, and the deal was created 14 or more days before the brief
    date. The brief says "no activity logged since it was created Sep 20", which is what is
    actually known. A deal created less than 14 days ago with no logged activity is not stale.
  - If the creation date is also missing (HubSpot did not return it), the deal is flagged as
    before ("next step set, no activity logged").

**Decision: a brand-new deal with no next step is still flagged.** The fix is about activity,
which a new deal has not had time to log. A next step is different: it is the one field that
says what happens next, filling it takes a rep seconds, and a deal entered without one is
exactly the gap the section exists to show. Making the next step rule depend on age would add a
second clock to the brief and hide new deals the manager most wants to see shaped early. So the
rule stays simple: empty next step, flagged, any age.

**Look at these first** needs more than one warning. A deal new since the previous snapshot can
carry at most one (it has no earlier close date or stage to slip or move back from), and a deal
created less than 14 days ago no longer gets the activity warning, so a young deal cannot land
there just because nothing is logged yet.

**Where the creation date comes from.** The client requests the `createdate` deal property and
the snapshot stores it as `created` (a `YYYY-MM-DD` day). When `createdate` is missing, the
snapshot uses the record's top-level `createdAt`. The published deals spec names five default
properties (`dealname`, `amount`, `closedate`, `pipeline`, `dealstage`), and `createdate` is not
one of them, so it is requested by name like the others the tool reads. The spec does document
`createdAt` on every deal record as a required date-time, "the timestamp when the object was
created", which is why it is the fallback. A contract test holds both facts. On the real portal
`createdate` and `createdAt` held the same value.

**Snapshot shape.** Each deal gains one field, `created` (a day, or null). The schema stays 1:
the field is additive, and only today's freshly built snapshot is read for the stale check, so
an older snapshot without `created` still loads and still serves as the comparison baseline. A
test reads an old-shape snapshot as the baseline to hold that.

**Real response shape.** A fixture modelled on the real response (sanitized: fictional names,
fake ids, a fake portal id) carries what the hand-recorded fixtures did not: a top-level `url`
on each deal, string amounts, null rather than empty strings for unset properties, and ISO dates
with milliseconds. It validates against the spec (which documents `url`) and the client turns
it into a correct snapshot.

### 2. New HubSpot accounts cannot create private apps

On a new account, Settings, Development, Legacy Apps says legacy apps are not available and
offers "Create a service key" and "Create a project-based app". A service key works with the
tool unchanged: it is a `pat-<region>-...` token sent as `Authorization: Bearer`, and the deals,
pipelines and owners endpoints all returned 200 with the same two read scopes. The token check
accepts any printable token, so `pat-na1-`, `pat-na2-`, `pat-eu1-` and other regions all pass; a
test holds that.

- The README quickstart leads with the service key path and keeps a short private app path for
  older accounts that still offer it. It never sends users to a project-based app. The service
  key page lists scopes by their API names, so the README names exactly `crm.objects.deals.read`
  and `crm.objects.owners.read` (no write scope), and says how to revoke: open the key under
  Service Keys and press Delete.
- Every message that said "private app" now says "HubSpot service key or private app token" (or
  the equivalent), because either one works.

### Release

`package.json` goes to 0.1.1, and `CHANGELOG.md` records v0.1.0 and v0.1.1. The README says the
tool has now been run on one real HubSpot portal, with a custom pipeline, on a service key, with
test data.
