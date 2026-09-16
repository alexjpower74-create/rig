# Review — rg3 · `rig roll` — second round

Second-round review of the fix commits on main, `1f599ea` (code and tests) and `33d1f37` (build report),
against the nine findings of the first-round review and the "Review findings acted on" section of
`docs/build-report-rg3.md`. Read only; nothing edited. `node test/roll.test.js` on main: 27 passed, 0 failed,
0 void, 0 unproven. Every state named below was reproduced in a scratch repo with main's own code.

## Each finding, and whether the fix and its test hold

1. **SKIPPED read as in progress — fixed.** `repoState` returns `skipped` before the dirty check. The new
   check is dirty-and-SKIPPED → `skipped`, red by deleting the SKIPPED line (old code gives `in progress`,
   so the assertion discriminates). Holds. See finding B below for what the reorder lets through.
2. **Any commit since start counted — fixed.** Subject AND date, scan stops at the first older commit.
   Two checks; the controls (startedAt moved to 2019; commitSubject dropped from roll.json) each flip the
   exact branch under test. The check that encoded the defect was removed. Holds. See finding C for the
   stop condition.
3. **Second roll, same ids — fixed.** `up` refuses on `listWindows(session, ids)` before writing anything;
   the control relabels the open tab to `c1`. Template uses `lint1`/`lint2` and says why. Holds. Note the
   check is skipped under `--no-launch`, which is right: no tab is made.
4. and 5. **Loose report parsing — fixed.** `reportLines` accepts `- <slug>: done|SKIPPED` only; the
   control swaps the first-round parser back in and the assertion goes red on headings, `not started
   yet`, `home-care-visits`, `Note` and `done … SKIPPED`. Holds. See finding D for case.
6. **Only the first repo trusted — fixed as far as a test can go.** Every repo after the first is
   pre-trusted and passed with `--add-dir` when the launcher starts with `claude`; the control launches
   `codex` and the assertion goes red. Not tried against live Claude Code, as the report says. See
   finding E for quoting.
7. **Remote not named origin — half fixed.** `remoteName`/`remoteHead` see any remote, and the new
   check (rename to `github`, unpushed commit → `committed`) is real. But the fetch was not moved; see
   finding A. The test only covers the unpushed side, so it could not see it.
8. **UTC date — fixed.** Local date. No test, as the report says; cosmetic, agreed.
9. **`--no-fetch` undocumented — fixed** in `USAGE`.

## Findings

- **A. `src/roll.js` line 290: `fetch` still names `origin`, so for any other remote `pushed` is read
  from a stale tracking ref.** `remoteHead` resolves `github/main`, but the refresh runs `git fetch
  origin`, which fails silently. Reproduced: remote named `github`, tab commit pushed, remote rewound
  one commit behind the rig's back → `pushed` (with `origin` the same state is `committed`, which is what
  the existing "Move origin's main back" check at `test/roll.test.js` line 184 guards). Check: fetch
  `remoteName(path)`; and run that rewind check once with the remote renamed, so the guard covers the
  path finding 7 opened.

- **B. `src/roll.js` line 284: SKIPPED now outranks a real roll commit, so a tab that committed and
  then wrote SKIPPED passes the gate with an unpushed commit.** Before `1f599ea` the commit was found
  first and the line ignored; now `skipped` returns before `rollCommit` runs. Reproduced: unpushed
  commit carrying the brief's subject, report line `- r: SKIPPED — …` → `skipped` → finish PASS,
  nothing pushed, nothing in the table. The brief says a repo ends in exactly one state, so the two
  witnesses disagreeing is itself a failure. Check: when `skipped.has(slug)` and `rollCommit` finds a
  commit, return the commit's state (or a distinct `contradiction`) so finish fails and names it; a
  fixture check for "SKIPPED line over a roll commit" would be the one that fails without it.

- **C. `src/roll.js` line 238: the scan stops at the first commit with an author date older than the
  roll, so any commit on top with an old author date hides the tab's commit.** A cherry-pick, a
  `rebase` of someone's old branch onto main, or a `git am` of a patch keeps its author date. Reproduced:
  tab commit (subject, in time) then an owner cherry-pick authored 2020 on top → `rollCommit` returns
  `null` → `untouched` → finish FAIL "no commit since the roll started". Check: cut off on committer date
  (`%ct`) rather than author date, or do not stop at an old line while `commitSubject` is set (the log
  is already bounded at 500); the test is the finding-2 fixture with the owner's commit given
  `GIT_AUTHOR_DATE=2020-…`.

- **D. `src/roll.js` line 258 and 271: the line regex is case-insensitive but the slug lookup is not.**
  `- Beacon: SKIPPED — busy` yields key `Beacon`; `namedIn(…, ['beacon'])` and `skipped.has('beacon')`
  both miss it, so the repo reads as not named and `untouched`. Reproduced. Small: either lower-case
  the key (slugs are lower-case by construction) or drop the `i` flag and let `done`/`SKIPPED` be
  spelt as the brief spells them.

- **E. `src/commands/roll.js` line 150: `--add-dir ${r.path}` is unquoted in a shell command line.** A
  repo path with a space (a registry `code:` field can point anywhere) splits into two arguments and
  the launch gets a wrong directory and a stray word. Not reproduced live; the check is a fixture path
  with a space in the finding-6 launch check. Same for the cwd if the driver passes it on a command
  line; the `"Read … and follow it."` argument is already quoted, so the author has the pattern.

## Hard rules

Unchanged from the first round: nothing in `1f599ea` sends, deploys, spends or deletes; `down` closes
only by the roll's own ids and now refuses to create a duplicate set; `finish` jots only when every
check passes; no worktrees, no dependencies, `harness/**` untouched, no personal data in the tracked
files. `preTrust` now writes `~/.claude.json` entries for every repo in a list, which is the intended
effect of finding 6 and is idempotent.
