# Build report: r55u, Upstream: drift, rebase, baselines that know their sha

Items 11, 12, 15 of docs/PLAN-5.5.md, and `rig status --eta` (9's display). Branch `rig/r55u`.
Gate: `rig qa f2d2ae6 --run "npm run check"` → `rig qa: test exit 0 at f2d2ae6` (Biome, all 20 test
files, `check-no-personal-data`). The QA worktree (qa-2) had no `node_modules`, so the first run
exited 127 (`biome: command not found`); I ran `npm ci` in it and ran it again.

## What I built

### 1. `drift(root, opts)`: `src/drift.js`. DONE
- Fetches the remote branch the base names (`origin/main` → `git fetch origin +refs/heads/main:…`),
  with `GIT_TERMINAL_PROMPT=0`, ssh `BatchMode` and a 30 s limit: a fetch that asks for a password counts as failed.
- `since`: commits on the base after the merge base, newest first. `touched`: files those commits
  changed that a slice owns (via the plan's globs) or the head changed, each with `slices` and
  `headChanged` (true when the head changed it too, so a conflict is likely). `safe`: owned files at the head plus files the head changed
  that upstream left alone. `merges`/`conflicts`: `git merge-tree --write-tree --name-only`, so no
  work tree is touched.
- Never throws. When the fetch fails, `error` says why and the comparison still runs against the last
  fetched base (`fetched: false`). A base that does not resolve leaves `mergeBase: null`, and nothing else runs.
- Extra exports for r55g and r55q: `fetchBase` (fetch once, then pass `fetch: false` per head),
  `liveBase(root, branch)`, `mergeTree(root, base, head)`, `formatDrift(d, { label })`. That is the
  one-line-per-head text `rig status` prints, so `fold` and `finish` can print drift the same way.

### 2. `rig status`: drift first, `--no-fetch`, `--eta`. DONE
- Prints `drift vs <live base>` before anything else: one line per slice branch (moved N commits,
  owned files touched and whose, how many safe, merges cleanly / DOES NOT MERGE: files), then the
  new base commits and "the base moved: rebuild the round before reviews, not after them (rig rebase <id>)".
- `--eta`: `estimate()` (r55m) for the final-round stages `qa:test, qa:negative, qa:baseline,
  [qa:ci], [qa:host], review, fold`. `qa:ci` and `qa:host` are included when configured
  (`ciCommand`, `qaHost`) or already measured. Each stage shows its median and run count, or
  "no data". The total is printed only when every stage has data. Otherwise it reads
  `total no data for <stages>`, with a second line `at least <sum> from the N measured stage(s)`:
  a sum of measured medians, labelled as a floor, never a guess at the stages nobody measured.
  I checked this against r55m's real `estimate()` in a throwaway merge of `rig/r55m`: medians exact
  (120/150/180 s → 2 min 30 s).
- Exit code unchanged: still 1 only for files outside a slice. Drift is information, not a gate here.

### 3. `rig rebase <id>`: `src/commands/rebase.js`. DONE
- Fetches, prints the slice's drift line, and stops if the base has not moved.
- **Before resolving anything** it checks every file the slice changed against the base. If upstream
  **deleted** it, **moved** it (rename), **created it too**, or **rewrote ≥ share** of its old lines
  (deleted lines ÷ old line count; binary counts as all of it), the rebase stops. It writes `.rig/rebase-<id>.md`
  (each file, what upstream did, the upstream commits, the slice commits that are drop candidates,
  and the exact answer commands), prints it, and exits **3**. The branch and worktree are untouched.
- `--covered "<what upstream covers>"` appends the answer (time, covered, dropped, result) to that
  file and lets the rebase go on. `--drop <sha>` (repeatable) drops superseded commits through an
  interactive rebase whose sequence editor turns their `pick` into `drop`. Each `--drop` must be a
  slice commit since the merge base. `--drop` without `--covered` is refused, so every dropped commit has its reason recorded.
- A rebase that conflicts is **aborted**: exit 1, the conflicting files named, the branch exactly as
  it was, no rebase left in progress. Resolving is the owner's job. Commits upstream already carries
  are dropped by git's own patch-id check (stable-queue practice). `--no-autosquash` leaves the
  fix commits as they are, since folding them is `rig fold`'s job. A `range-diff -s` (old → new) is printed after a rebase.
- Runs in the worktree where the branch is checked out, or a temporary worktree that it removes afterwards.
  Refuses over uncommitted work.

### 4. Snapshot helpers: `harness/snapshot.js`, exported from `harness/index.js` (additions only). DONE
- `pin(page, { modifier: 'Control'|'Meta', locale, timezone, userAgent })`: user agent, platform
  (`MacIntel` for Meta, `Linux x86_64` for Control), UA client hints, locale, Accept-Language and
  time zone, set through CDP before load. Also `window.__RIG_PIN__`. `DEFAULT_PIN` is Control, en-US, UTC.
  `modifierKey(pin)` gives `{ key, code, bit }` for `Input.dispatchKeyEvent`.
- `snapshot(page, { ready, tries = 3, readyTimeout, reload, onRetake, ...captureOpts })`: waits for
  app-ready (a selector string or `{ selector }`, `{ global: 'app.ready' }`, or a function run in the
  page). It captures, then checks that the page was still ready after the capture, and retakes otherwise, up to `tries`.
  If the page never becomes ready it throws, naming the signal and the number of tries. There is no ready
  signal by default: "First paint is not ready" is refused.
- `capture(page, { selector, styles, boxes, margins })` records structure, the element's own text, and
  styles that do not depend on fonts or window size (no boxes unless `boxes: true`). Margins are recorded
  **as written**: each element is hidden for the read (a non-rendered element reports its computed
  value, not its used value), then put back exactly as it was. So `margin: 0 auto` → `"auto"` and `5%` → `"5%"`.
- Baselines: `writeBaseline` (first line `RECORDED_FROM: <sha>`, and refuses a non-sha),
  `readBaseline` (refuses a file without it), `matchBaseline` (creates on first run or with
  `RIG_UPDATE_SNAPSHOTS=1`, otherwise diffs), and `diffSnapshots` (names each changed style, text, added or missing element).
- `examples/snapshot-fixture.html`: paints "Loading…" first and is ready later (`?readyAfter=`,
  `?never=1`), has a centred column, and shows a shortcut, a number and a time zone read from the platform.

### 5. `staleBaselines(root, opts)`: `src/baselines.js`. DONE
- Finds tracked files under `dirs`, else the config's `snapshotDirs` (folders or globs), else any
  `__snapshots__/`, `snapshot(s)/`, `baseline(s)/` folder plus `*.snap`. It reads `RECORDED_FROM: <sha>`
  from the first 5 lines in any comment style, and returns `{ file, recordedFrom, behind }` for each
  baseline the base moved past.
- `behind` counts commits that changed something other than baselines, so committing a freshly
  recorded baseline does not make it stale. A sha this clone does not have is returned with
  `behind: null, unknown: true`: its staleness can't be measured, but it is not reported as fresh. If `origin/main` does not resolve, the live
  base of the current branch is used.
- `formatStale(stale, { base })`: the warning lines for `rig qa` to print.

## Checks, each seen red, and how it was made red

Run with `env -u WAYLAND_DISPLAY -u DISPLAY`. Every check uses `s.check(… breaks)`. A PASS means the
control went red. All on f2d2ae6.

`test/upstream-drift.test.js` (10):
| check | red by |
|---|---|
| base moved, touching an owned file: flagged with its owner; untouched files safe | the 5.0 stub swapped back in |
| drift fetches first: a push since the last fetch is seen | `fetch: false` (comparing against the clone's stale origin/main) |
| a non-merging stack is reported with the conflicting file; slice worktree untouched | a drift that never asks merge-tree (`merges: true`) |
| mergeTree: clean / conflicted / bad ref = null with reason | reading the exit code alone (bad ref reads as a conflict) |
| no remote: error says so, the local base still compares, no throw | stub |
| the live base is local `main` once a slice is merged there unpushed | always using the upstream |
| `rig status` prints drift before the slices; `--no-fetch` skips the fetch; a conflict shows | the Rig at 14a1ad6 (`git archive` of the start commit) run in its place |
| `rig status --eta` says "no data", no total, no invented number | same |
| formatEta: medians with run count, total only when complete, floor labelled | a formatter that fills the total from the stages it has |
| roundStages adds qa:host/qa:ci only when configured or measured | every stage always |

`test/upstream-rebase.test.js` (7), all through the real `bin/rig.js`:
| check | red by |
|---|---|
| upstream deleted a file the slice changed: exit 3, question written and printed, branch untouched | the Rig at 14a1ad6 |
| upstream rewrote 75%: stops at the 50% default and names the share | `--share 0.9` |
| `--covered` + `--drop`: answer recorded, superseded commit dropped, rest rebased | leaving out `--drop` (the kept commit conflicts) |
| a conflict is aborted: exit 1, file named, branch as it was, no rebase in progress | the Rig at 14a1ad6 |
| nothing superseded: ordinary rebase, every commit kept | the Rig at 14a1ad6 |
| `--drop` without `--covered` refused | the Rig at 14a1ad6 |
| supersededFiles: rename away and both-created are caught; a small edit is not | a detector that only knows deletions |

`test/snapshot.test.js` (8, headless Chrome through `harness/cdp.js`):
| check | red by |
|---|---|
| a not-ready page is retaken until ready; snapshot is of the ready page | capture at first paint (the old way) |
| never ready: refused after 3 tries in bounded time, naming the signal | 1000 tries (the check's clock runs out) |
| ready as selector, global, function; no signal refused | every signal replaced by `body` (holds at first paint) |
| `margin: 0 auto` is "auto"; 1440 px and 390 px record identical snapshots | `margins: 'used'` |
| pin: Meta → ⌘K, de-DE → 1.234,5, Asia/Tokyo → GMT+9; Control → Ctrl K, en-US, UTC | no pin |
| modifierKey follows the pin | constant Control |
| baseline: RECORDED_FROM first, reads back, a change named in the diff | a diff that sees nothing |
| a baseline without RECORDED_FROM refused; a non-sha never written | a reader that takes any JSON |

`test/upstream-baselines.test.js` (6):
| check | red by |
|---|---|
| base moved 2 past a baseline: reported 2 behind; a fresh one not reported | the stub |
| committing a fresh baseline does not make it stale | counting the baseline's own commits |
| snapshotDirs from config or opts | looking in the wrong folder |
| unknown sha reported unknown; RECORDED_FROM in a comment counts | dropping unknowns |
| no origin: falls back to the live base | origin/main only |
| formatStale names each and how far | a formatter that prints nothing |

### A real bug the checks caught
The auto-margin check at first compared 1440 px with 600 px and passed. At 390 px it went red. On a
phone, the centred column's used margin is 0 px, and the first version dropped zero margins before
reading them as written, so phone and desktop recorded different snapshots. Fixed by reading
margins as written for every element. The check now uses 390 px.

### And one in the design
In this very build, local `main` is 4 commits ahead of `origin/main`. The lead merges slices into
local `main`, so comparing only against `origin/main` would miss a slice landing. `liveBase` uses
the upstream only when the local branch has nothing upstream lacks. `rig status` still fetches the
upstream, and says "pull before the round" when the upstream has commits the local base lacks.

## Decided
- **Rewrite threshold**: 50% of the old version's lines deleted or replaced (`--share`, config
  `rebaseRewriteShare`). Deleted, renamed away and created-on-both-sides always stop.
- **Exit codes for `rig rebase`**: 0 rebased or nothing to do; 3 stopped to ask; 1 conflict
  (aborted) or a refusal.
- **A conflicting rebase is aborted**, not left mid-way: someone who walks into a half-done rebase in a
  slice worktree has inherited a mess.
- **The answer lives in `.rig/rebase-<id>.md`** (machine state through `rigDir`). The question is
  written there, and each answer is appended under it.
- **`rig status` exit code** is unchanged by drift.
- **Fetch on failure**: compare against the last fetched base and say so, rather than say nothing.
- **Snapshot format**: `RECORDED_FROM: <sha>` on line 1, then JSON (`*.snap`). `staleBaselines`
  also accepts the line in a comment within the first 5 lines, for other tools' formats.
- **Snapshot default pin**: Control (Linux platform), en-US, UTC. Either machine can be "the" machine,
  as long as both pin the same way.
- **Chrome port**: the snapshot test uses `launch()`'s default port 0 (Chrome picks a free one), not
  the brief's 9355. `harness/cdp.js` explains why a fixed port collides when `rig qa` and a slice's own
  run go at once, and every existing test uses port 0.

## For the lead: USAGE and README text (bin/rig.js and README.md are yours)

USAGE entries:
```js
status: `rig status [--base <ref>] [--no-fetch] [--eta]
  drift first: each slice against the live base (fetched; --no-fetch uses the last fetch), the owned
  files it touched, how many are safe, and whether each still merges (git merge-tree);
  --eta prints the median of measured stage times for a final round, or "no data"`,
rebase: `rig rebase <id> [--base <ref>] [--share <0..1>] [--covered "<what upstream covers>"] [--drop <sha>]... [--no-fetch]
  stops before resolving (exit 3, .rig/rebase-<id>.md) when upstream deleted, moved, also created, or
  rewrote ≥ share (default 0.5) of a file the slice changed; --covered records the answer and goes on;
  --drop drops a superseded commit; a conflict is aborted with the files named (exit 1)`,
```
COMMANDS one-liner for status: `per-slice: drift against the live base first, then agent state, commits ahead, uncommitted files, and anything edited outside its slice (--eta for measured stage times)`.

README paragraph:
> **Upstream moves; the round knows first.** `rig status` starts with drift: for each slice, the
> commits that landed on the live base since it was cut, which of its owned files they touched,
> which are still safe, and whether it still merges (`git merge-tree`, no checkout touched).
> `rig rebase <id>` moves a slice onto the new base, but when upstream deleted, moved or largely
> rewrote a file the slice changed, it stops before resolving anything and asks the slice owner what
> upstream now covers. Answer with `--covered "…"`, drop the commits upstream superseded with
> `--drop <sha>`, and the slice gets smaller and correct, not merged by hand. Snapshot
> baselines from the test kit (`pin`, `snapshot`, `matchBaseline`) are taken on a pinned platform,
> locale and zone, after the app says it is ready, with auto margins recorded as `auto`, and carry
> `RECORDED_FROM: <sha>` so `rig qa` can say when the base has moved past them.

## For other slices
- **r55g** (fold, finish): `import { drift, fetchBase, formatDrift, liveBase } from '../drift.js'`.
  Fetch once, then call `drift(root, { base, head: 'refs/heads/<branch>', slices: [agent], fetch: false })`
  per slice and print `formatDrift(d, { label: id })`. That is the exact pattern `printDrift` uses in
  `src/commands/status.js`. `d.mergeBase === null` means drift is unknown (`d.error` says why).
- **r55q** (`rig qa` warns): `import { staleBaselines, formatStale } from '../baselines.js'`, then
  `for (const l of formatStale(staleBaselines(root, { base }), { base })) console.warn(l)`.
  `base` defaults to `origin/main` and falls back to the live base when that does not resolve.

## What's left
- **Review of r55w** (`docs/review-r55w.md`): r55w had no commit on its branch when I finished my
  slice (its work was still uncommitted), so there was no diff to review yet. I'll review its first commit when it lands.
- **macOS run**: `npm run check` is green on Linux only. The snapshot pin is meant to make the two
  machines agree, but I have not run it on the second machine.
- `--update-refs` (stacked slice branches moved together) is not offered. Slices here are not
  stacked on each other, and moving another slice's branch is outside `rig rebase <id>`'s scope.
