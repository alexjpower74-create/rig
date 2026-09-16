# Review — rg3 · `rig roll` — final

Confirmation pass on `8277c5e` (merged into main at `31e42ce`), checked against the five second-round
findings. Read only; nothing edited. `node test/roll.test.js` on main: 33 passed, 0 failed, 0 void,
0 unproven. Each finding's scratch reproduction from round two was re-run against main's code and
now returns the state the gate needs; each new check's negative control was read and flips the exact
branch under test.

## Second-round findings

- **A. Fetch named `origin` — CONFIRMED FIXED.** `repoState` now fetches `remoteName(path)`. Reproduced
  state: remote `github`, remote rewound behind the rig's back → `committed` (was `pushed`). Test: the
  rewind check with the remote renamed; control runs the same read with `fetch: false`, where the
  stale tracking ref still says `pushed`, so the assertion goes red.
- **B. SKIPPED outranked a real roll commit — CONFIRMED FIXED.** `rollCommit` runs first; a SKIPPED
  line over a found commit returns `contradiction` with the sha, and `finishChecks` fails it with
  "report says SKIPPED but <sha> carries the roll's commit subject". Reproduced: unpushed roll commit
  plus SKIPPED line → `contradiction`. A SKIPPED repo with no roll commit is still `skipped`, dirty or
  not, so finding 1 of round one stays fixed. Test control amends the subject away so the same line is
  an honest SKIPPED and the assertion fails.
- **C. Old author date on top stopped the scan — CONFIRMED FIXED.** The cutoff is committer date
  (`%ct`). Reproduced: tab commit under an owner commit authored 2020 → the tab's sha. Test control
  gives the owner commit an old committer date as well, which genuinely predates the roll and stops
  the scan, so the assertion goes red.
- **D. Case-sensitive slug lookup — CONFIRMED FIXED.** Report keys and lookups are lower-cased.
  Reproduced: `- Beacon: SKIPPED` → `beacon`. Two tests; controls swap in the round-two parser, and
  drop the colon.
- **E. Unquoted `--add-dir` path — CONFIRMED FIXED.** `shellQuote` single-quotes anything outside a
  safe character class and escapes embedded quotes. Checked: `/x/My Repo` and `/x/it's` both quote
  correctly. Test control swaps in the unquoted version.

Nothing STILL OPEN. No new findings from this pass.

## Hard rules

Unchanged: nothing in `8277c5e` sends, deploys, spends or deletes; `down` still closes only by the
roll's own ids; `finish` jots only when every check passes and a `contradiction` row fails it; no
worktrees, no dependencies, `harness/**` untouched, no personal data in the tracked files.

## History

**Round one** (reviewed `d5e4290`, acted on in `1f599ea`): nine findings. A repo SKIPPED for a dirty
tree read as `in progress`; any commit since `startedAt` counted as the roll's; a second roll with the
same tab ids made duplicate tabs and `down` closed both; "names every repo" was satisfied by any
mention and hyphenated slugs matched inside longer ones; `skippedIn` read SKIPPED anywhere on a line;
only the first repo was pre-trusted and set as project root; a remote not named `origin` read as no
remote; the roll name carried the UTC date; `--no-fetch` was undocumented. All nine were fixed, seven
with tests whose controls flip the branch under test.

**Round two** (reviewed `1f599ea`, acted on in `8277c5e`): five findings on the fixes themselves. The
fetch still named `origin`; reordering the SKIPPED check let a SKIPPED line hide a real commit; the
author-date cutoff let an old-authored commit on top hide the tab's commit; the parser was
case-insensitive but the lookup was not; `--add-dir` paths were unquoted. All five confirmed fixed
above.
