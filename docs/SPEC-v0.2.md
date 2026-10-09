# monday-pipeline-brief: v0.2 spec

What v0.2 adds to the v1 brief (see `SPEC.md`), the design choices behind each addition, and the
checks that hold them in place. The diff stays deterministic: no AI summary, no hosting, no
scheduler, no Salesforce, no property-history backfill.

## Scope

1. **Stage reorder is not a stage move.** A deal moved a stage only when its `stage_id` changed
   within the same pipeline.
2. **The dollar bridge.** A short reconciliation from last snapshot's open total to this one,
   which must balance, with the deals behind each line named where useful.
3. **Close date passed.** An open deal whose close date is before the snapshot date gets its
   own flag and section, distinct from a slip.
4. **Look-first impact rule.** A single flag also qualifies a deal when the deal is large or
   when its slip crosses a calendar quarter. Each look-first line says why it is there.
5. **Deal links.** Each deal line links to the deal in HubSpot when the snapshot holds its URL.
6. **Grouping.** `--group-by owner|pipeline` (or `MONDAY_BRIEF_GROUP_BY`) groups the deal
   sections. The default stays one flat brief.
7. **Positioning.** The README opener promises the outcome and makes no claim about what
   HubSpot can or cannot store.
8. Demo data, README example, `flow.md`, `metrics.md`, CHANGELOG, version 0.2.0.

## Design decisions

### 1. Stage moves

Before: forward or back was decided by `stage_order` alone. If an admin reordered a pipeline,
every deal in a reordered stage read as moved although none of them moved.

Now:

- A stage move needs the deal's stage identity to change, in the same pipeline. Identity is
  `stage_id`; when a snapshot has no `stage_id` (null), the stage label stands in.
- The direction compares the two stages in the **current** pipeline layout. `buildSnapshot`
  stores each pipeline's full stage layout at the top level of the snapshot
  (`pipelines: [{ id, label, stages: [{ id, label, order, status }] }]`), and `compare` reads
  both stages' order from the current snapshot's layout. This is right even when the old stage
  is now empty or was itself moved (the two reproductions in `test/compare.test.mjs`).
- Fallback, only when the current layout does not list one of the two stages (deleted since)
  or the current snapshot has no layout (written by 0.1): the order of the old stage is read
  from any current deal that sits in it, else the old snapshot's own `stage_order`. This is the
  first v0.2 rule, kept for those cases only. (Changed in 0.2.1: a deleted old stage, or a
  fallback that gives no direction, is listed as "Changed stage" with no direction; see
  `SPEC-v0.2.1.md`.)
- Same stage, different order: never a move. Unknown order on either side: no move (as before).
- Old snapshots load unchanged; the schema stays 1 and every new field is optional.

### 2. The dollar bridge

All bridge arithmetic is done in integer cents, so float rounding can never make it disagree
with itself. Every deal id in either snapshot falls in exactly one row of this table:

| Last snapshot | This snapshot | Bridge lines |
|---|---|---|
| open | open | amount change `now - before` (an increase or a decrease; zero adds nothing) |
| open | won | amount change `now - before`, then won `-now` |
| open | lost | amount change `now - before`, then lost `-now` |
| open | absent | removed `-before` (deleted or archived in HubSpot, or no longer returned) |
| absent | open | new `+now` |
| absent | won or lost | new `+now`, then won or lost `-now` |
| won or lost | open | reopened `+now` |
| won or lost | won, lost or absent | nothing (it was never in the open total) |

So, per deal, the lines sum to its own change in open amount, and summed over all deals:

```
before open + new + reopened + increases - decreases - won - lost - removed = now open
```

Why these choices:

- **Won and lost at the closing amount.** The headline already reports won and lost with the
  current amount. Booking the amount change first and closing at the current amount keeps the
  bridge's won and lost equal to the headline's.
- **New includes deals that are new and already closed.** The "New this week" section lists
  them, and the headline counts them as won or lost, so the bridge shows both lines; they net
  to zero, which is what happened to the open total.
- **Unknown-stage deals** are open (as everywhere else), so they bridge like any open deal.
- **Multi-currency.** `amount` is already in the home currency (`amount_in_home_currency`
  when HubSpot returns it), so the bridge adds plain numbers.
- **No pipeline transfer line.** The bridge is portal-wide, so a deal moving pipelines is just
  an open deal with (possibly) an amount change. A transfer line only exists if the bridge is
  split by pipeline, and v0.2 does not split it (see Divergences).

**Balance is enforced twice.** `compare()` checks the identity after building the bridge and
throws `bridge does not balance` if it ever fails, so an unbalanced bridge is an error, never
a rendered number. And a property-style test builds hundreds of seeded random snapshot pairs
covering every row of the table above (plus unknown stages, cent amounts and pipeline moves),
asserts the identity in cents on each, and parses the rendered bridge text back to check the
printed lines add up.

**Rendering.** The bridge prints exact dollar amounts (`$1,094,000`, cents only when present),
not the rounded `$1.09M` style used elsewhere, because rounded lines would not visibly add up.
Zero lines are left out; the start and end lines always print.

```
**How the open pipeline changed**
- Sep 28 open pipeline: $1,094,000
- New deals: +$480,000 (4)
- Amount increases: +$15,000 (1)
- Won: -$114,000 (2)
- Lost: -$90,000 (1)
- Removed from HubSpot: -$40,000 (1)
- Oct 5 open pipeline: $1,250,000
```

Named per deal, in their own capped sections: **Amount changed** (old to new amount, increases
and decreases, including deals that also closed), **Removed from HubSpot** (open last time,
not returned now), **Reopened**. New, won and lost are already named in their sections.

### 3. Close date passed

An open deal whose `close_date` is before the snapshot date. Flag text "close date passed".
It is current state, so it also shows on a first run. A deal can be both slipped and past its
close date (moved from Sep 1 to Oct 1, brief on Oct 5): both flags apply.

### 4. Look-first impact rule

A flagged open deal is in "Look at these first" when any of these holds:

- it has two or more flags (as before);
- it has one flag and is a **large deal**;
- it has one flag and its close date **slipped into a later calendar quarter**
  (for example Q4 2026 to Q1 2027).

Each line ends with the reason in brackets: `(2 warning signs)`, `(large deal)`,
`(slipped into Q1 2027)`, joined with "; " when more than one applies.

**Large-deal default: the largest open deals, at most 10% of them (at least one, unless every deal above $0 has the same amount and they outnumber that limit).** The cap is
`max(1, floor(10% of open deals))`. Deals are taken largest first. If deals tied on one amount
straddle the cap (some would fit, some would not), the whole tied group is left out. Only if
that leaves no large deal at all (and, since 0.2.1, not every deal with an amount is tied, in
which case no deal is large) are the tied deals taken in deal id order (lowest HubSpot
record id first, compared numerically; normally the oldest record) up to the cap, so the
choice is deterministic. A $0 deal is never large. (The first v0.2 rule counted every deal tied
at the cut-off, which made 30 deals at one amount all large, and 6 of 21 in the demo.) Why relative, not a fixed dollar figure: a
fixed figure means nothing across teams whose deal sizes differ by 100x, so any default would be
wrong for most users. The top decile scales with the pipeline and keeps the list short: a
20-deal pipeline has at most 2 large deals, a 500-deal one at most 50, and those count only when they also
carry a warning. Override with `--large-deal AMOUNT` or `MONDAY_BRIEF_LARGE_DEAL=AMOUNT`
(dollars, `50000`, `50K`, `1.5M`), or `off` to turn the large-deal rule off. The flag wins
over the env var, matching `--no-next-step` and `MONDAY_BRIEF_NEXT_STEP`. A value that is not
an amount is a usage error, exit 1, before HubSpot is called.

Calendar quarters only; fiscal years are not configurable in v0.2.

### 5. Deal links

`buildSnapshot` keeps HubSpot's top-level `url` on each deal (only when it is an `https://`
string). Each deal line renders the name as a Markdown link, `[Northwind](url)`, and Slack
gets `<url|Northwind>`. A deal without `url` (any 0.1 snapshot) renders its plain name. Square
brackets in a name are escaped for Markdown; `&`, `<` and `>` are escaped inside Slack links.

### 6. Grouping

`--group-by owner` or `--group-by pipeline` (`--group-by=…` too, env `MONDAY_BRIEF_GROUP_BY`).
The headline, the bridge and the unknown-stage line stay portal-wide at the top. Then one
`## <owner or pipeline>` heading per group, with that group's open total and count, followed by
that group's sections, each still capped at 10 with "and N more". A deal belongs to its group
in this snapshot (a removed deal to its group in the last one). Groups are ordered by open
total, largest first, then name. (Since 0.2.1, pipeline groups are keyed by pipeline id and
headed with today's label; see `SPEC-v0.2.1.md`.) A group with nothing in any section says "Nothing flagged."
The default is no grouping: one flat brief, which reads best for one pipeline and a small team.
`demo --group-by owner` shows it.

### 7. Positioning

The README opener drops the claim that HubSpot stores only current state (HubSpot does keep
property history). It opens on the outcome: know what changed in your HubSpot pipeline before
Monday's meeting. No competitor claims. `package.json`'s description changes the same way.
The GitHub repo description is outside this repo; the proposed text goes to the orchestrator
in the pull request body.

## Prior art (checked by the orchestrator)

- No open pull requests on the repo.
- The five earlier lane branches (rows 85 to 89) are merged into main.
- No branch or build already does any of this.
- No CI workflow in the repo, so the gates below are run by hand on every commit.

## Divergences from the task

1. **The bridge is portal-wide, with no pipeline transfer line.** The task makes transfers
   conditional on splitting by pipeline. Grouping by pipeline groups the deal lists, not the
   bridge. Transfers are still visible: a "Moved to another pipeline" section lists every deal
   open in both snapshots whose pipeline changed (old pipeline and stage to new), flat and
   grouped; grouped by pipeline, the deal is listed under its old and its new pipeline so the
   old heading never vanishes. A per-pipeline bridge is a candidate for later.
2. **The orchestrator handoff notes are in the pull request body, not a file in the repo.**
   The repo's lint gate (and its test) forbid a maker-notes file at the root and the word that
   names it in any file, because this repo is squashed into the public one. Writing that file
   would turn the suite red. The exact old and new strings are in the PR body instead.
3. **The look-first section title changes** from "(more than one warning sign)" to a title
   that covers all three reasons, since a deal can now be there with one sign.

## Gates (run on every commit)

| Area | Gate command | What passing looks like |
|---|---|---|
| All logic, CLI, security, bridge balance | `npm test` | 0 failures (contract tests skip without `HUBSPOT_SPEC_DIR`) |
| README example freshness | `npm test` (readme tests) | both README demo blocks equal `demo` and `demo --group-by owner` output byte for byte |
| Demo data freshness | `npm test` (demo-fixtures tests) | committed demo snapshots equal the documented seed conversion |
| Lint | `npm run lint` | `lint ok` |
| Demo smoke | `node bin/monday-brief.mjs demo` | exit 0, shows the bridge, close date passed, amount changed, removed, links |

## Demo data

The demo snapshots are still generated from the seed rows by `test/helpers/convert-seed.mjs`,
and a test holds the committed files equal to that conversion. v0.2 seed changes: amount
changes (Northwind up, Westfield down, Lumen Health up then won), a removed deal (Juniper Bio),
a reopened deal (Marlowe Systems), a passed close date (Orchard AI), record urls on a made-up
portal id, a second pipeline (Renewals) with a deal transferred into it (Tessellate), and a
Renewals stage reorder between the two weeks (Contacted moved ahead of Upcoming) under a deal
that does not move (Pemberton Labs), which the brief correctly leaves out. The demo snapshots
carry the stored stage layout, as `run` writes it.
