# monday-pipeline-brief: v0.2.1 spec

A pre-public pass on v0.2 (see `SPEC-v0.2.md`). It closes the leftovers from the v0.2 review
before the repo is published. No new feature; every item is a correction to what v0.2 prints or
accepts. The diff stays deterministic.

## Scope

1. **F1. Raw HTML in CRM text.** In the Markdown brief, every piece of CRM-sourced text (deal,
   owner, stage and pipeline names, group headings, and the labels of deal record links) has
   each `<` that would start an HTML tag, comment or autolink written as `&lt;`, and each `&`
   that would start a character reference written as `&amp;`. So `<a href="...">Click</a>` and
   a CommonMark autolink `<https://...>` typed into a HubSpot name print as text in every
   Markdown viewer (GitHub, Obsidian, VS Code preview), while "Johnson & Johnson" or "A < B"
   print as typed. Slack gets each character escaped once, never twice.
2. **N2. A stage change whose direction cannot be judged** is reported in its own section,
   "Changed stage", old stage to new, with no direction, instead of being silent.
3. **N3. A transfer straight into a closed stage of another pipeline** names the move on its
   Closed line: "won, moved from Sales Pipeline to Onboarding". The bridge is unchanged.
4. **N4. Uniform amounts.** When every open deal with a positive amount has the same amount
   and there are more of them than the 10% cap, no deal is large. The lowest-id tie-break stays
   only for a partial tie at the cut.
5. **N5. Pipeline groups keyed by pipeline id**, headed with today's label (the old label for a
   pipeline that has disappeared); two pipelines sharing a label stay apart, each heading
   followed by its id.
6. **F2. Slack formatting characters in CRM text:** declined, see decision 6.
7. **M7. `demo --dir`** is a usage error, exit 1, matching flow.md's "unknown option" row.
8. **Demo data.** Two seed deals show the new wordings: Wrenfield Clinics left the Renewals
   stage "Paused", which an admin deleted between the two weeks (Changed stage: Paused →
   Negotiating), and Harbor Freightworks went from the Sales Pipeline straight to won in
   Renewals ("won, moved from Sales Pipeline to Renewals"). Both demo pipelines now carry
   closed stages. The demo snapshots stay the documented conversion of the seed rows.
9. CHANGELOG entry, version 0.2.1, README, help text and flow.md updated in the commit that
   makes them stale.

M1 does not change: a brand-new large deal with an empty next step still goes to look-first.

Not in scope: weighted pipeline, fiscal quarters, pull-ins, per-group bridges, property
history, the public release.

## Decisions

### 1. F1: escape only what would become markup, and Slack decodes once

The Markdown escape for CRM text is: line breaks to spaces (as before); an `&` followed by
`name;`, `#digits;` or `#xhex;` (the only shapes CommonMark reads as a character reference)
to `&amp;`; a `<` followed by a letter, `/`, `!` or `?` (the only shapes that can open an HTML
tag, closing tag, comment, declaration, processing instruction or autolink) to `&lt;`; then
`[`, `]` and `\` backslash-escaped (as before). `>` is left alone: without an opening `<` it
cannot form a tag, and CRM text never starts a line (a deal line starts with `- `, a group
heading with `## `), so it cannot open a block quote.

Escaping is narrow because the terminal and the raw .md file are the primary reads, and `&` is
common in company names: escaping every `&` would print "Johnson &amp; Johnson", which costs
more than the rare HTML link it prevents.

`toSlack` decodes `&amp;` and `&lt;` (the two entities the escape writes) in a single pass
before applying Slack's own escape of every `&`, `<` and `>`, so each character is escaped
exactly once. A name that literally contains `&lt;` is written `&amp;lt;` in Markdown and
reaches Slack as `&amp;lt;`, which Slack shows as `&lt;`.

### 2. N2: when a stage change has no judgeable direction

A move is judged in today's stored stage layout when it lists both stages (unchanged). When
today's layout lists the new stage but not the old one (the old stage was deleted), the two
orders would come from two different layouts (the old snapshot's and today's), so no direction
is claimed: the deal is listed under **Changed stage** (`S → B`). Before, that case fell back
to the old snapshot's order, which could print a wrong direction or, in the review's repro, no
line at all. Without a stored layout (a snapshot written by v0.1), the deals' own orders are
still used, and if they give no direction (equal orders for two different stages) the deal is
also listed under Changed stage. (Today's snapshot is always written by the current version and
carries its layout, so on a live run Changed stage means the old stage was deleted; the
no-layout path is reached only when comparing older snapshot files directly.) A deal whose new stage cannot be read (unknown stage) is still
left out of stage-move checks. Changed stage is not a warning sign: it says nothing about
whether the deal went backwards, so it adds no look-first flag.

### 3. N3: closed in another pipeline

`compare` records, for a deal that was open last time in another pipeline and is closed now,
the pipeline it came from. The Closed line reads `won, moved from <old> to <new>`. Grouped by
pipeline, the line shows under both pipelines, as an open transfer already does, so the old
pipeline's heading keeps the deal that left it. The bridge is portal-wide and is unchanged.

### 4. N4: uniform amounts mean no large deal

The cut is unchanged: the largest open deals, at most `max(1, floor(10%))`. A tie at the cut
(tied deals some of which fit under the cap and some not) is left out whole, as before. When
that leaves nothing:

- if the tied group is every open deal with a positive amount, no deal is large (there is no
  "large" in a pipeline where every deal is the same size);
- otherwise (a partial tie: some deals are smaller), the tied deals are taken lowest record id
  first up to the cap, as before.

A tie that fits wholly under the cap is not a tie at the cut, so those deals stay large (two
$50K deals and twenty-eight $0 deals: both $50K deals are large, as before).

### 5. N5: groups keyed by id

Owner groups stay keyed by owner name. Pipeline groups are keyed by pipeline id. The heading
label is taken from today's snapshot (its stored pipeline layout, else today's deals); a
pipeline that is gone today keeps its last label. When two groups share a label, each heading
becomes `<label> (<id>)`. Groups are ordered by open total, then label, then id. A transfer row
lists its old pipeline by id.

### 6. F2: Slack formatting is declined

CRM text in Slack can still turn on Slack's own formatting: `*bold*`, `_italic_`, `~strike~`
and backtick code. This is declined for 0.2.1, for three reasons:

- **Nothing to escape with.** Slack's mrkdwn has escapes for `&`, `<` and `>` only. The known
  workarounds insert invisible characters (zero-width joiners or spaces) next to the markers.
  Those characters would then sit inside every deal name in Slack, where they break copy and
  paste and Slack search for the name, and whether they stop formatting depends on Slack's
  undocumented boundary rules, which this tool cannot test without a live workspace.
- **The harm is cosmetic.** Links and mentions, the cases where CRM text could act on a reader,
  are already neutralised (F1 and v0.2). Formatting changes only how a name looks.
- **The workaround's cost lands on every name**, while the problem lands only on names that
  contain paired markers, which real deal names rarely do.

Turning formatting off for the whole message (`mrkdwn: false`) would also turn off the brief's
own bold section titles and deal links, so it is not an option either.

### 7. M7: `demo --dir` is rejected

`demo` reads bundled data and writes no snapshot, so `--dir` has no meaning there. It is now a
usage error ("--dir is for run; demo reads bundled sample data"), exit 1, plus usage. `run`
is unchanged.

## Prior art

None outside the repo: this extends the repo's own v0.2. There are no open pull requests, and
no other branch does any of this.

## Divergences from the task

1. **N3 under `--group-by pipeline`.** The task asks only for the Closed line to name the move.
   The line is also shown under the old pipeline when grouped by pipeline, the same rule v0.2
   applies to open transfers, so the old pipeline's heading does not lose the deal silently.
2. **N2 without a stored layout.** The task describes the stored-layout case. The same
   no-silence rule is applied when a v0.1 snapshot gives equal orders for two different stages,
   since that is the same silence by another route.
3. **F2 is declined** (allowed by the task), with the reasons above.
4. **Pipeline names on move lines.** The same id rule as the headings applies to the pipeline
   names on a "Moved to another pipeline" line and a "moved from ... to ..." Closed line, in
   every mode, flat included: a label shared by two pipelines, or the same label at both ends,
   is followed by the pipeline id, so a move between two pipelines named "Sales" reads
   "Sales (east) (Qualified) → Sales (west) (Qualified)" rather than looking like no move.

## Gates (run on every commit)

| Area | Gate command | What passing looks like |
|---|---|---|
| All logic, CLI, security, bridge balance | `npm test` | 0 failures (contract tests skip without `HUBSPOT_SPEC_DIR`) |
| README example freshness | `npm test` (readme tests) | both README demo blocks equal `demo` and `demo --group-by owner` byte for byte |
| Lint | `npm run lint` | `lint ok` |
