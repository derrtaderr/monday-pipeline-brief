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
