---
name: monday-pipeline-brief metrics
read_by: the pre-release walkthrough of this repo
---

# Metrics: monday-pipeline-brief v1

## Activation event

**A user's second weekly `run` producing a brief with changes in it** (a "Compared with the
snapshot from" line plus at least one week-over-week section). The first run cannot show
value by design; the second run is the first time the tool does the job it exists for.

## How it is measured without telemetry

The tool has no telemetry and never will in v1 (it runs on the user's machine with their CRM
token; phoning home would break the trust the README promises). So:

| Signal | Source | How collected |
|---|---|---|
| Activation (second weekly run with changes) | The user tells us | README "Did it help?" section asks users to open a GitHub Discussion or issue after two weeks. Counted by hand. |
| First run | The user tells us; issues mentioning setup errors | Same channels |
| Interest | GitHub repo traffic (views, unique visitors, clones) and stars | Repo Insights, Traffic, read weekly during the launch window (GitHub keeps 14 days) |
| Feature asks | Issues and Discussions | By hand |

Only reports from people outside the project count as activation.

## Instrumentation checklist

- [x] README asks for a Discussion or issue after the second weekly run (section "Did it help?").
- [ ] GitHub Discussions enabled on the repo, a repo setting done when the repo goes public.
- [x] No telemetry code in the tool (verifiable: the only network calls are `api.hubapi.com` and the user's own webhook).

## v0.2

The activation event and how it is measured do not change: still no telemetry, still the
README "Did it help?" ask. v0.2 widens what an activating brief can show (the dollar bridge,
close date passed, amount changes, removed and reopened deals, deal links, grouping), so a
second weekly run on a portal where only amounts changed or a deal was deleted now produces
a brief with changes in it too. Feature asks about grouping and the large-deal threshold are
read from Issues and Discussions by hand, as before.

## v0.3

Stateless mode moves the activation event forward. With `run --since 7d` the comparison is
rebuilt from HubSpot's property history, so **a user's first `run --since 7d` producing a brief
with changes in it** (a "Compared with HubSpot as of" line plus at least one week-over-week
section) is activation; there is no first-run state to wait through. Stored mode keeps the
v1 event (the second weekly run). Measurement does not change: no telemetry, and the README
"Did it help?" ask now names both paths, so a report after one stateless run counts. Reports of
a "Could not rebuild" section or an exit 5 refusal (more than one currency, or the missing
`settings.currencies.read` scope) are read from Issues by hand, as signals that stateless mode
does not fit that portal.
