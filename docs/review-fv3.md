# Review — fv3 · Taste rounds he can click

Reviewer: fv2. Diff: `git diff 5ee48d0...4374679` (fv3's first commit, 4374679). Read-only: the
only thing I ran was fv3's own code, in a throwaway repo under the system temp folder. Findings are
ranked by how Alexander would meet them. Line numbers refer to 4374679.

## 1. Re-running `rig taste` with other sources deletes every earlier rating from disk (verified)

`src/taste/store.js:39-50` (`newRound`), called from `src/commands/taste.js:123`, then `saveState` at
taste.js:125.

`newRound` keeps only the answers whose card is in the new round. Run a comps round on its own
(`rig taste --comps <dir> --ask "…"`, which the usage line allows), or re-run with one `--from`
folder left off, and `refs` holds none of the earlier cards. `ratings` becomes `{}` and is written
over `ratings.json` before the board is even up. I ran fv3's code at 4374679: three ratings were on
disk after round 1, **0** after `--comps … --ask …`, and still 0 after re-running `--from refs`. The
answers are gone for good, and a later Done writes an empty `## Ratings` table over the TASTE.md
that held them.

This breaks "every answer saved, a closed tab loses nothing" across rounds. What to check: keep
answers for cards that are not in the round (carry `prev.ratings` and `prev.refs` forward, or merge
by id), or refuse to replace a round that has answers unless a flag says so. Add a test that runs
round 1, then a comps-only round, and reads `ratings.json`. It must fail against the current
`newRound`.

## 2. A note typed in the last 600 ms, or any failed POST, dies with the tab

`src/taste/page.js:136-142` (the note debounce), `:113-123` (the retry queue). There is no
`pagehide` or `visibilitychange` handler.

- The note is POSTed 600 ms after the last keystroke. Type a note and close the tab, or lock the
  phone, inside that window, and the note never leaves the page.
- A POST that failed sits in `queue`, waiting for a retry 2 s later. Close the tab first and the
  answer is lost, even though the header said "Not saved" only briefly.
- `post()` uses a plain `fetch` with no `keepalive: true`, so on some browsers a tap followed at once
  by a tab close can abort its POST in flight.

The test "a closed tab loses nothing" (test/taste.test.js:587) waits `sleep(150)` after the last tap
and never types a note. It closes the tab only after the answers have been acknowledged, so it
cannot see any of this. What to check: flush the note and the queue on `pagehide` with
`navigator.sendBeacon` (or `fetch(…, { keepalive: true })`). Add a test that types a note and closes
the page at once, then reads `ratings.json`.

## 3. A rejected answer is retried forever, and then Done never finishes

`src/taste/page.js:116-118` and `:322`.

Every failure is queued and retried, including a 404 or a 400. The tab can be stale in two common
ways: `rig taste` was re-run with a reference dropped (the server now answers 404 `no ref "…"`), or
the board was ended from `rig taste --done` in another shell (no server at all). Every tap then reads
"Not saved" forever. `done()` waits while `queue.length` is non-zero, so pressing Done sets
`finished = true`, which also turns off the number keys, and waits forever with no message. What to
check: drop 4xx answers and say why ("this round has changed: reload"), and give Done a time limit
with a visible error.

## 4. The board cannot be reached from a phone

`src/taste/server.js:69` binds `127.0.0.1`. The plan specifies 127.0.0.1. But the lead's
acceptance list for this review says "the page works on a phone over the local server". On a phone,
`http://127.0.0.1:5391/` is the phone itself, so a real phone can never open the board. The tests
emulate 390×844 inside the same machine's Chrome, which is why they pass. This is a contract
question for the lead, not a code fix for fv3 alone. If a real phone is meant, the board needs a LAN
address (`--host`, printed with the URL), and then finding 5 matters more.

## 5. Any web page in his browser can rate, or end the round

`src/taste/server.js:95-115` and `:18-31`. `readJson` parses any body whatever its content type,
and no handler looks at `Origin` or `Host`.

A page on another site can send a "simple" cross-origin POST (`content-type: text/plain`, no
preflight) to `http://127.0.0.1:5391/api/answer`, `/api/pick` or `/api/done`. That changes a
rating, or writes TASTE.md and closes the board. The port is fixed and printed in the usage line. Newer
Chrome versions gate local-network requests, but Safari and Firefox do not in the same way. I read
this from the code. My live probe failed for an unrelated reason (a reused keep-alive socket), so
it is not verified in a browser. What to check: refuse POSTs whose `Origin` is present and is not
the board's own origin, and require `content-type: application/json` (which forces a preflight).
Before any LAN binding (finding 4), require a per-round token in the URL as well.

## 6. Replacing an image under the same file name shows the old one for an hour

`src/taste/server.js:89-92` (`cache-control: max-age=3600`), together with `src/taste/sources.js:53,59`:
the id is a hash of the file name, not of the content.

He reworks `comps/header-b.png` and runs the comps round again. The URL `/img/c-header-b-…/single`
is unchanged, so his browser shows the cached old comp without asking the server, and he rates a
picture that is no longer on disk. URL captures have the same flaw for a different reason:
`capture.js:38` keeps any existing shot forever, so a reference site that changed is never
re-captured. What to check: put the file's mtime and size, or a content hash, in the image URL, or
send `no-cache`. For URL shots, decide on a re-capture rule and print it.

## 7. Error pages are captured and shown as references

`src/taste/capture.js:51`. `page.goto` throws only on network errors and Chrome's own error page.
A URL that answers **404 or 500** with an HTML body loads normally and becomes a card. He is then
asked to rate the site's "Page not found". The plan says "A URL that fails to load is named and
skipped". What to check: read the main document's status (`Network.responseReceived` for the
frame's document, or `Page.navigate` together with a response listener). Treat ≥ 400 as failed and
name it. Add a dead-URL case that answers 404 with a body, beside the existing one that hangs up.

## 8. Checks that cannot fail, or only partly can

- `test/taste.test.js:663`, the comps check, asserts five things at once: the question on top, every
  target ≥ 44 px, no sideways scroll, the ratings in TASTE.md, and the star. Its one control
  (`handlers.pick` saves nothing) can only turn the star red. The 44 px and fit parts have never
  been shown to fail. Split them, and give each its own control, for example shrinking `.star` to
  30 px or widening `.grid` past 390.
- `test/taste.test.js:202-217`, the local `target` helper. When you swap to `s.target` (merged on
  main at 801366e), three behaviours change:
  - A broken run that returns `NaN`, or throws, comes out **VOID** under `s.target`. The local helper
    treats a falsy control as a PASS. If the NO_AUTO_ADVANCE board ever fails `fitsWithoutScrolling`
    (it adds a 48 px Next button to the footer), the broken run returns NaN and the bar goes VOID.
  - `measure` returns `NaN` for "typed" or "does not fit". Throw an `Error` with the reason instead,
    and `s.target` prints the reason as the FAIL detail. NaN only prints "measure() returned NaN".
  - `s.target` resets every `countInput` counter before each measure run. `walk` creates its own
    counter, so this does not affect it.
- `test/taste.test.js:29`: the board runs on the fixed port 5391, the same default Alexander's real
  `rig taste` uses. If he has a board open while `npm test` runs, the suite fails with EADDRINUSE.
  His board is not harmed: `--done` compares ref ids first. The plan asks for 5391, so this is for
  the lead to weigh, not a defect.

## 9. Smaller

- `src/taste/store.js:70`: the date line uses `toISOString()`, which is UTC. A round finished after
  20:00 at UTC−4 (EDT) is dated tomorrow. Use the local date.
- `src/taste/page.js:283, 294`: a second tap within 160 ms of the first is silently dropped
  (`busy`). The bar walk waits between taps, so it never sees this. A fast hand would see a tap that
  did nothing.
- Cross-slice, for the lead: Done writes `docs/TASTE.md` into the main checkout, as fv1's contract
  wants. It is an untracked file there until someone commits it. Decide who commits it, so it does
  not sit in `rig finish`'s clean-tree check, or get swept into a nightly sync.

## Checked and fine

- `--no-open`: every test path passes it (ARGS and COMPS_ARGS, plus the CLI spawn); `--done` never
  opens a browser; Chrome is headless on 9352. Every test repo is a temp directory, never the real
  tree.
- The bar: 6 rating taps plus `#finish` = 7, with real taps and clicks at hit-tested points, at both
  sizes, and with no-typing and no-scroll checks that have a working control. TASTE.md's headings
  match the contract: `## Ratings`, `## Comps — "<question>"` and `## Principles`, with the
  placeholder line byte-exact.
- `.rig` writes go through `rigDir()` (`tasteDir`). No home paths, hostnames or emails, and no AI
  credit, in the diff. `bin/rig.js` adds COMMANDS and USAGE only.
