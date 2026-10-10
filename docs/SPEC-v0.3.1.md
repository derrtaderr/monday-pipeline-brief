# monday-pipeline-brief: v0.3.1 spec

A patch release on v0.3.0 (see `SPEC-v0.3.md`). One blocker that has been present since v0.1, six
smaller correctness items, the minors queued after v0.3.0, and a cleanup that removes copies of the
same constant or helper across modules. Every code change lands with a test that failed first.

## Scope

1. **F1. Changed after closing (blocker).** A deal that is closed at both ends of the comparison
   is never in the open pipeline, so today it is silent: won last week and lost this week prints
   "Closed 0 won and 0 lost" and "Nothing flagged". v0.3.1 lists such deals in a new section,
   **Changed after closing**:
   - `was won, now lost` (or `was lost, now won`), followed by `, $250,000 → $200,000` when the
     amount moved too;
   - `won amount $250,000 → $300,000` (or `lost amount ...`) when only the amount moved.
   The headline's Closed line keeps its meaning (deals closed this week) and gains one sentence
   when the section has rows: "1 deal changed after closing." These deals are never added to the
   won or lost counts, and the dollar bridge is unchanged: they were closed at both ends, so the
   open total never held them. The README says so next to the section. The section renders in
   Markdown and Slack, flat and grouped, in both modes.

   **Stateless mode.** The rebuilt snapshot at T carries each deal's stage (and so its won or
   lost status) and amount at T from property history, so the same comparison finds the change.
   Interaction with could-not-rebuild:
   - status at T unknown (merged, capped stage history, stage missing from the layout at T): the
     deal stays only under Could not rebuild, which now ends "won now" or "lost now" when it is
     closed today (m3). No "Changed after closing" row is claimed from an unknown start.
   - status at T known and closed, amount at T unknown (a capped amount history): the flip is
     reported (status is known), the amount part is not (the amount at T is unknown). The deal
     also stays under Could not rebuild, as in v0.3.0.

2. **F2. Pinned npx in the CLI's own text.** `NPX` is built from `package.json`'s version:
   `npx github:derrtaderr/monday-pipeline-brief#v0.3.1`. Help, the missing-token hint and the
   demo footer all print the pinned form. A cli test fails on any printed `npx github:` command
   without `#v<version>`.

3. **F3. Pinning, honestly.** Decision: **the README and the Action pin the release tag
   (`#v0.3.1`), and document commit-SHA pinning as the safer choice**, rather than shipping a SHA
   placeholder. Reasons: a commit cannot contain its own SHA, so the release commit's README can
   never name the release commit; the public tree is a squashed export, so no SHA from this
   repository is valid there; and a placeholder in the lead command would ship a command that
   does not run. The README claim becomes true as worded: a tag can be moved by whoever controls
   the repository, so pinning the tag means you run the release you chose unless the tag is moved;
   for a pin nobody can move, replace `#v0.3.1` with the commit SHA the tag points at
   (`git ls-remote https://github.com/derrtaderr/monday-pipeline-brief refs/tags/v0.3.1`). The
   Action carries the same note as a comment. `actions/setup-node` is pinned by full commit SHA
   with a version comment (`# v4.4.0`, what `@v4` resolves to today, so behaviour is unchanged).
   The readme test requires the README and Action pins to equal `#v` + the `package.json` version,
   so a version bump without a pin bump fails the suite.

4. **F4. Owners are grouped by id.** Snapshot rows gain `owner_id` (additive; schema stays 1, and
   older snapshots without it still load). `--group-by owner` keys groups by `owner_id`. A row
   without one (an older snapshot) is matched to the id that carries its owner name today, when
   exactly one does. Two owners in HubSpot with the same display name are told apart at snapshot
   time, as pipelines are: `Dana Ruiz (dana@example.com)`, or `Dana Ruiz (owner 102)` when there
   is no email or the email does not tell them apart.

5. **F5. The weekly baseline.** `findPrevious` prefers the newest snapshot 7 or 8 days old (one
   week, the same window the brief calls "last week"); else the newest at least 6 days old; else
   the newest earlier one. A Tuesday run by hand no longer becomes next Monday's baseline. The
   literal "newest at least 7 days old" was not used: with last week's run late by a day (6 days
   old) and the one before 14 days old, it would compare with two weeks ago, which the README's
   asleep-Mac case says it must not.

6. **F6. Slack cut note.** The note names the saved file when there is one, by file name only
   and never a local path ("The full brief is saved as brief-2026-10-05.md on the machine that ran
   it.") and says "Run with --out FILE for the full brief." when there is not
   (stateless mode without `--out`). Before cutting the text, the Slack copy is re-rendered with
   fewer rows per section (5, then 3, then 1), so every group and section keeps its heading and its
   "and N more" line; a note says how many rows each section shows. Only if one row per section
   still does not fit is the text cut at a line, as before.

7. **F7. Multi-currency portals in stored mode.** Snapshots also store the deal's currency
   (`deal_currency_code`) and its amount in that currency, when HubSpot returns them (additive).
   An Amount changed (or Changed after closing) row whose home-currency amount moved while the
   deal's own amount and currency did not is labelled "(exchange rate)". A closed deal whose only
   change is such a move is not listed under Changed after closing and not counted (no aggregate
   line either: on a multi-currency portal it would repeat every week and say nothing). In the
   first comparison after upgrading, the baseline has no currency fields; an amount change on a
   deal whose own amount differs from its home amount today (a foreign-currency deal) is marked
   "(currency unknown last week)" rather than hidden, since it may be a real edit. The README no longer says
   stored mode simply works on multi-currency portals: it says amounts are HubSpot's conversion at
   its current rate, so rate moves show as amount changes, labelled when the tool can tell.

8. **Minors queued after v0.3.0.**
   - m2: duplicate ids in the recycle bin listing are read once.
   - m1: a pipeline whose change log starts after T, but that has deals at T, takes its stages at
     T from the oldest settings HubSpot kept, and the brief says so in one line. The remaining
     layout lines name what the tool can see: a pipeline deleted since T, or a stage missing from
     the pipeline's settings for that date.
   - m3: see F1 (won now / lost now).
   - m4: the stderr line for a stateless run with no `--out` and no Slack is worded so it is true
     when stdout is piped or redirected to a file: the run kept no copy of its own.

9. **Minors F8 to F17.**
   - stderr carries counts only, never dollar totals (public Action logs).
   - The headline's change is the bridge's end minus start, in cents.
   - `money()`: $999,500 is `$1.00M` (never `$1,000K`), $1,000,000,000 is `$1.00B`, and anything
     that rounds to zero is `$0` (never `-$0`).
   - A grouped brief with no groups gets its "Nothing flagged" line.
   - A deal that existed at T but whose history has no stage at T goes to Could not rebuild
     ("HubSpot's history has no stage for it on <date>"), never New.
   - The stateless stderr line gives the comparison date as the brief does, with the exact instant
     in UTC after it.
   - Help lists all three scopes.
   - Snapshot and brief writes are atomic (a temp file in the same folder, then a rename), so
     "No snapshot or brief was written" is true after a failed write.
   - The README says how fast snapshots grow and how to prune them by hand; nothing is deleted
     automatically.
   - Token-leak tests assert each scenario's exit code; the stale "two read scopes" readme test
     checks three; `archivedListed` is removed (no caller in the tool).

10. **Cleanup.** One `sum` and one `DAY_MS` (format.mjs); `HISTORY_BATCH` is `HISTORY_PAGE`; the
    "14+" and "more than 20" in rendered text come from `STALE_DAYS` and `HISTORY_CAP`; one
    source for file modes and private writes; one quote-strip helper; one setup preamble (token,
    webhook, `--out`) shared by stored and stateless runs. The three meanings of "known" stay as
    they are: renaming them would touch every rebuild rule for no behaviour change.

11. Version 0.3.1, CHANGELOG entry; README, help and demo updated in the commit that makes them
    stale. The demo gains one deal won last week and lost this week, so the new section shows.

Not in scope: the real-portal audit-depth check, restored deals, multi-currency validation on a
real portal, the release itself.
