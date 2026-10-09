# monday-pipeline-brief: v0.3 spec

v0.3 adds an opt-in **stateless mode**. `run --since 7d` (or `run --as-of <ISO instant>`)
rebuilds the comparison snapshot from HubSpot property history instead of reading one from
disk, so the first run already has a week to compare against and a scheduled job needs no
storage. Stored snapshots stay the default and keep working exactly as they do now.

The source is the "Proposed v0.3 row" in `spike/FINDINGS.md`. Four corrections from the final
read of that spike are binding and override the FINDINGS text where they differ (section 2).

## 1. Order of work

1. **The gate (spike only).** Fix `precondition()` and corrections 1 to 4 inside `spike/`, test
   first. Then re-run the evidence on the test portal: `spike/seed-v03.mjs`, then
   `spike/reconstruct.mjs`, and require `precondition.pass: true` under the four-condition
   definition below. If it fails, stop: the evidence is committed, the PR is a draft that reports
   the failure, and `src/` is not touched.
2. **The product.** Only after the gate passes, the spike logic moves into `src/`, and the spike
   imports it from there (one source of truth, no fork).

## 2. Binding corrections

1. **No phantoms.** The precondition has a fourth condition: no deal may be present in the
   rebuild at T while absent from the stored snapshot. `precondition()` computes it from the
   `(deal)` rows. Pass now means all of: 0 field mismatches on the 9 compare fields, a balanced
   bridge, every stored deal absent from the rebuild accounted for (flagged, or a source of a
   flagged merge), and no phantom.
2. **Start line.** A could-not-rebuild deal's amount at T counts toward the open start only when
   its status at T is known and open. "Known" means `status` is not among its unknown fields
   (its stage and pipeline histories reach T) and its stage at T is in the stage layout at T.
   A deal, rebuilt or partial, whose stage at T is missing from that layout (a deleted pipeline
   or stage, or an audit that starts after T) goes to could-not-rebuild with reason `layout` and
   status unknown; buildSnapshot's default of open is never used for T. A capped-stage deal therefore never adds to the open
   start, and neither does a deal known to be closed at T.

   **How (implementation).** Such a deal is a *partial* deal: its snapshot row at T joins the
   rebuilt previous snapshot with an unknown close date left empty (so no slip is claimed) and,
   when it was closed, an unknown amount set to 0 (never read for a closed deal). `compare()` then
   treats it like any other deal, which also gives correction 4 for free.
3. **Headline caveat.** A merged record counts as its number of sources: "leaves out 2 deals
   merged since then", not 1.
4. **Removed, not could-not-rebuild.** A deal known to be open at T that is gone today leaves
   the bridge through "Removed from HubSpot" with its amount at T, and is listed in that section.
   It never prints a "Could not rebuild: -$7,000 (0)" line.

**One divergence, stated.** Correction 2 as written says that otherwise "its amount at T is
unknown". For a deal whose status at T is known and closed, its contribution to the *open*
start is known: it is zero. Counting it in the headline caveat would print "leaves out 1 deal"
about a total that leaves nothing out. So a known-closed deal adds nothing to the open start
and nothing to the caveat. Every other case (status unknown, stage missing from the layout at
T) is unknown and is counted in the caveat. This never adds to the open start, which is what
the correction protects.

## 3. Scope of the product

1. **Read path** (one as-of instant T):
   - live deals listed with history, 50 per page (`propertiesWithHistory` caps a page at 50);
   - archived deals listed without history (100 per page), filtered on `archivedAt > T`, then
     read again through `POST /crm/v3/objects/deals/batch/read?archived=true` with history, 50
     per call. History is never read from the archived list, which truncates it to one version;
   - pipelines, one audit per pipeline, owners (live and archived);
   - cursor paging on every listing, with tests for multi-page live and archived listings.
   Today's snapshot is built from the same live listing (`properties` arrive beside
   `propertiesWithHistory`), so no second deal listing is made.
2. **Existence.** A deal with no version of any property at or before T (a backdated import) is
   absent. Then the cap check, before the first-stage-version existence rule: a deal whose capped
   `dealstage` history starts after T is could-not-rebuild, never dropped or new.
3. **Per-field unknowns,** only on `stage_id, status, stage_order, pipeline_id, amount,
   close_date` (the fields `compare()` and the bridge read from the previous snapshot). A cap on
   owner, next step or last activity never sends a deal to could-not-rebuild.
4. **Could not rebuild.** A section and a bridge line in `renderBrief`, Markdown and Slack, flat
   and grouped, so the bridge balances to the live open total. Merges are detected through
   `hs_merged_object_ids` plus a `MERGE_OBJECTS` version after T, and the section names their
   sources.
5. **Start line.** `- Oct 1 open pipeline: $X ($Y rebuilt + $Z from N deals only partly
   rebuilt)`, with corrections 2 and 3 (the user never sees "T", so the brief does not say it),
   and the headline caveat when anything is left out: `(the Oct 1 total leaves out 2 deals merged
   since then and 1 deal whose state then could not be rebuilt)`.
6. **Push count.** Slips count moves to a later date only, skip `close-date-automation`, and a
   cleared close date counts none. A deal in "Slipped close dates" whose close date moved later
   two or more times since T says so on its line: `(+46 days, pushed 2 times)`. One push is the
   line itself and adds nothing. Stored mode never prints a push count.
7. **Same-millisecond order:** versions written in one millisecond keep HubSpot's newest-first
   order (first listed wins), in `valueAt` and in the push count.
8. **Stage layout at T:** from the pipeline audit. An empty audit and a 404 both fall back to
   today's layout.
9. **A GitHub Action example with no state**, in the README and as
   `examples/github-action.yml` (outside `.github/workflows`, so it never runs on this repo).
10. **Multi-currency refusal.** Before any deal is read, stateless mode calls
    `GET /settings/v3/currencies/exchange-rates/current` (scope `settings.currencies.read`).
    A portal with any exchange rate has more than one currency, and stateless mode refuses:
    exit 5, a message saying stored mode still works. A 403 refuses with exit 5 and a message
    naming the scope. Stored mode never makes this call and never needs the scope.

## 4. Decisions

1. **Flags.** `--since Nd` (N a whole number of days, 1 to 90) or `--as-of` an ISO instant with
   a time and a zone (`2026-10-01T09:00:00Z`), in the past and at most 90 days ago (HubSpot keeps
   archived deals in the recycle bin for 90 days, so an older T would miss removals). The two
   are exclusive. `MONDAY_BRIEF_SINCE` mirrors `--since` for scheduled jobs; the flag wins.
2. **Stateless mode writes no snapshot.** Not the rebuilt one, which a later stored run could
   mistake for a real read, and not today's either: the mode's promise is that it keeps no
   state, and a half-kept history in a folder the user never chose would be a second, silent
   baseline. It writes nothing to disk except the brief, and only when `--out` is given; no
   `run.log` either. `--dir` with stateless mode is a usage error. The brief is printed to
   stdout and posted to Slack when `SLACK_WEBHOOK_URL` is set.
3. **Exit codes.** 0, 1, 2, 3 and 4 keep their meaning. New: **5**, stateless mode refused on
   this portal (more than one currency, or the token lacks `settings.currencies.read`). Nothing
   is fetched past the currency check.
4. **Comparison line.** Stateless briefs say what they compared with: "Compared with HubSpot as
   of Oct 1, rebuilt from property history." Every other existing section is unchanged.
5. **Module layout.** `src/history.mjs` holds the pure rebuild rules (`valueAt`, `knownAt`,
   `rebuildAt`, `closeDateMoves`, `layoutAsOf`, `layoutsAt`, `archivedBatches`).
   `src/stateless.mjs` holds the read path and `compareStateless`. `src/hubspot.mjs` gains the
   history listings, the archived batch read, the audit and the currency call.
   `spike/reconstruct.mjs` keeps only the validation harness (`run`, `mismatches`,
   `precondition`) and imports everything else from `src/`; the spike tests of moved functions
   move to `test/`.
6. **README.** The quickstart leads with the stateless path ("run it once against your portal").
   Scheduling with launchd or cron becomes an appendix for stored mode. The required scopes list
   adds `settings.currencies.read` for stateless mode.

7. **Archive lag (found by the gate).** A deal archived seconds before a stateless run can be in
   neither listing; it drops out of both ends of the bridge with no Removed line. Documented as a
   README limit, not fixed: nothing in the API marks it.

## 5. The gate, re-run

The seed (`spike/seed-v03.mjs`) is extended so the validation set pages and covers the
corrections:

- 55 filler `[TEST spike]` deals stay live through T (more than 50 live deals, two history pages),
  and 70 more are created and archived before T (more than 100 archived records, two archived
  pages). Cleanup archives the 55 after T, so a re-run after cleanup batch reads more than 50
  archived deals (two batch calls).
- A deal with 21 close date writes after T and an unchanged open stage (capped `close_date`,
  status known open at T), archived after T: correction 4.
- A deal won before T with 21 close date writes after T (capped `close_date`, status known
  closed at T): correction 2.
- `spike/cleanup-v03.mjs` archives every seeded deal still live and deletes the seeded notes,
  then verifies the live listing holds only the pre-existing deal 352942642895.

The evidence is run twice: once while the seed deals are live, once after cleanup.

## 6. Non-scope

Owner history, hard-delete detection, the modified-since search shortcut, multi-currency
portals, restored deals (limit 3 in FINDINGS), and any change to stored mode's behaviour.

## 7. Release

Version 0.3.0, a CHANGELOG entry, README, help text and demo fresh in the commit that changes
them.
