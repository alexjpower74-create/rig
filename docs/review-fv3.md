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

## Re-check by fv2 (fixes at 1d896e0, against 4374679)

Read-only. I unpacked 1d896e0 and 4374679 whole into an ignored scratch folder, then ran the same
probes against each sha's own `src/`. Each probe ran in a throwaway git repo. Boards ran on ports
5491–5495 (never 5391), always with `--no-open`. Chrome ran headless only, on debugging ports
9361–9363, at 390×844 mobile, with real taps at points hit-tested with `elementFromPoint`. HTTP
probes open a fresh socket per request, so keep-alive cannot hide a result (the reason my first
finding-5 probe failed).

### 1. A re-run with other sources keeps earlier ratings: PASS

Round 1 had three references, rated 3, 4 and 5. Next came a comps-only round
(`--comps … --ask …`). Then a `--from refs` re-run with one reference added. Last, `--done`.

| | 4374679 | 1d896e0 |
|---|---|---|
| ratings on disk after round 1 | 3 | 3 |
| after the comps-only round | **0** | 3 |
| carried into the refs re-run | none | 3, 4, 5 (the new reference starts empty) |
| rated rows in TASTE.md after `--done` | **0** | 6 (round 1 and round 3, each listed) |

### 2. A note typed and the page left at once still lands on disk: PASS

| | 4374679 | 1d896e0 |
|---|---|---|
| note typed with real keys, then `Page.navigate` away with no wait | lost | on disk |
| note typed, then the tab closed with no wait | lost | on disk |
| one answer failed, then the page left before the 2 s retry | lost | on disk (4) |

The failed answer was made with CDP `Fetch.failRequest` on the first `/api/answer` only. The header
read "Not saved" before the page left, at both shas.

### 3. A 4xx ends the round plainly, and Done doesn't hang: PASS

- **Stale tab:** the board was re-run with the card the tab shows dropped, then that card was
  tapped.
  - 1d896e0: it shows "This round has ended. Every answer it saved is on disk. Run rig taste again
    for a fresh link." It makes 0 answer requests over the next 5 s. Done does nothing further.
  - 4374679: it shows "Not saved", retries every 2 s (2 requests in 5 s), and Done shows nothing
    for 9 s.
- **Board gone (ended from another shell):** a tap reads "Not saved".
  - 1d896e0: Done settles in 6.1 s with "The board is not answering. Answers marked Saved are on
    disk. Press Done again, or run rig taste --done in the terminal."
  - 4374679: still nothing after 10 s.

### 5. Only the board's page can talk to it: PASS

These are POSTs to `/api/answer` with a real card and rating, and the token in `x-taste-token`
unless stated.

| Request | 4374679 | 1d896e0 |
|---|---|---|
| foreign Origin, `text/plain` | 200 | 403 |
| foreign Origin, JSON | 200 | 403 |
| no Origin, `text/plain` | 200 | 415 |
| own Origin, JSON, **no token** | 200 | 403 |
| own Origin, JSON, wrong token (same length) | 200 | 403 |
| DNS-rebinding Host (`evil.example:<port>`) | 200 | 421 |
| own Origin, JSON, token (the valid one) | 200 | 200 |
| `POST /api/done`, foreign Origin, `text/plain` | 200, **board closed** | 403, board still up |
| `GET /`, `/api/state` and an image, without token | 200 | 403 each; 200 with `?t=` |

The page is served with `referrer-policy: no-referrer`, so the token in the URL is not sent on to
any link.

**`--lan`, through the real CLI:**
- `rig taste --from refs --no-open --lan` prints the 127.0.0.1 URL and one "on a phone on this
  network" URL per address, each with `?t=<token>`.
- On the LAN address, `/` and `/api/state` with the token: 200. Without the token: 403.
- Without `--lan`, the LAN address refuses the connection; 127.0.0.1 with the token: 200.
- `--done` stops the board in both cases (exit 0).
- One thing to know, not a defect: `--lan` binds every interface, so it also prints and answers on a
  VPN address if the machine has one. The token still guards it.

### 6 and 7 (a quick look): PASS

- **6:** images are `no-cache` with an ETag. An unchanged file answers 304. After I rewrote the
  image with the same byte size, the old ETag got 200 with the new image. 4374679 sent
  `max-age=3600` and no ETag.
- **7:** `captureAll` against a local server. A 200 and a 302→200 became cards. A 404 and a 500 with
  HTML bodies were skipped, named "answered HTTP 404/500". At 4374679, all four became cards.

### New, found while re-checking: hiding the tab while offline loses a queued answer, then shows "Saved"

`src/taste/page.js:154-160` at 1d896e0. `flushAll()` empties `queue` and sends each item with
`send()`, ignoring the result. On `visibilitychange` (app switch, phone lock) the tab is still
alive. If the board can't be reached at that moment, those keepalive sends fail, and the answers are
no longer queued, so nothing retries them. The next good tap then sets the header to "Saved",
because `queue` is empty.

My probe:
1. Every `/api/*` request failed (CDP Fetch). I tapped 4 on the first card.
2. The page's own `visibilitychange` handler fired, hidden then visible, still offline.
3. I went back online and waited 3 s, then tapped 2 on the second card.

| | 4374679 | 1d896e0 |
|---|---|---|
| header after coming back online | Saved (the 2 s retry delivered it) | Not saved, and nothing is retrying |
| header after the next tap | Saved | **Saved** |
| first card on disk | 4 | **missing** |

This is a regression in the fix: the old page retried that answer. The `visibilitychange` here was
dispatched by the probe, with `visibilityState` overridden, because headless Chrome won't hide a tab
for real. It is the page's own listener running, though, and a phone lock fires the same event.
What to check: in `flushAll`, send copies and keep `queue` until each item is answered. Or put a
failed send back in the queue and call `retrySoon()`. Re-sending an answer is harmless, because it
sets the same rating. The note sent from `flushAll` has the same gap. Add this probe as a test: it is
green at 4374679 and red at 1d896e0.

**Verdict:** findings 1, 2, 3 and 5 are fixed at 1d896e0, and 6 and 7 are too. Each probe is red at
4374679 and green at 1d896e0. One new gap remains (above): a queued answer is dropped when the tab is
hidden while the board can't be reached. It's small, but it loses a tap and then shows "Saved".

## Re-check 2 by fv2 (the flushAll fix at 94c50dc, against 1d896e0)

Same rules and method as above, read-only. Both shas were unpacked whole. Boards ran on 5496,
always with `--no-open`. Chrome was headless on 9364 at 390×844 mobile, and every tap went to a
point that `elementFromPoint` confirmed. CDP `Fetch` failed or held `/api/answer` requests.

**The header check.** Through every run, a sampler read the header, then `ratings.json`, about every
20 ms. The server writes to disk before it answers. So a correct page can never show "Saved" while a
tapped rating is still missing from disk. A sample where it does is counted as a lie.

| Scenario | 1d896e0 | 94c50dc |
|---|---|---|
| **A.** My first probe (below) | first card **missing**; 51 lies | 4 and 2 on disk; 0 lies (298 samples) |
| **B.** Slow board: every answer held 700 ms; three fast taps, then card 3 re-rated through ‹ back | 5, 3, 2; 0 lies | 5, 3, 2; 0 lies (339 samples) |
| **C.** Flaky: every other answer fails at first; three taps, wait past the retries | 4, 5, 2; 0 lies | 4, 5, 2; 0 lies (507 samples) |

Scenario A, step by step:
1. Tap 4 while offline.
2. The page's own `visibilitychange` fires, hidden then visible.
3. Go back online and wait 3 s.
4. Tap 2 on the next card.

What the header read at each point:

| | 1d896e0 | 94c50dc |
|---|---|---|
| after the offline tap | Not saved | Not saved |
| back online, 3 s later | Not saved | Saved (retried) |
| after the next tap | Saved | Saved |

At 94c50dc, the answer stayed queued through the hide, and the 2 s retry delivered it. "Saved" never
showed while the disk lacked an answer. The finding is fixed. fv3's new test does the same thing with
`Network.emulateNetworkConditions`, and serves 1d896e0's page as its control.

### Residual: a hidden tab can still let an older rating land after a newer one

The comment at 94c50dc promises that "a later answer for a card never lands under an earlier one",
and `pump()` keeps that by sending one at a time. `flushAll()` (`src/taste/page.js:169-173`) does
not. It sends every queued item that isn't already in flight, at once, while an earlier answer for
the same card may still be on the wire.

Scenario **D**:
1. Tap 4 on card 1. That request is held in flight.
2. Tap ‹ back, then tap 2 on card 1.
3. The tab is hidden and shown again.
4. The held 4 is released.

| | 1d896e0 | 94c50dc, tab hidden | 94c50dc, not hidden |
|---|---|---|---|
| card 1 on disk at the end | **4** | **4** | 2 |
| header | Saved | Saved | Saved |
| lies | 97 | 97 | 0 |

So the fix put the ordering in place for the normal path, and only the hidden-tab path still breaks
it. This was already broken at 1d896e0, so it is not a regression. It needs a re-rate inside one
round trip, followed by the phone locking or the app switching while that first request is stuck.
That's narrow, but the result is a wrong rating shown as "Saved".

What to check:
- Give each answer a per-page sequence number, and have `handlers.answer` ignore one older than the
  rating it already has for that card. That holds whatever order the browser delivers in.
- Or have `flushAll` skip any item whose key has an earlier item still in flight. The in-flight
  keepalive then carries the older value, though, so the sequence number is the sounder fix.

**Verdict: PASS** on the flushAll regression at 94c50dc. One narrow residual (D) remains: it predates
the fix, and it's the lead's call whether it blocks the finish gate.
