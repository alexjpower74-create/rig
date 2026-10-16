# Build report — fv3 · Taste rounds he can click

Final sha: **1d896e0** on `rig/fv3` (main merged in at 6676cc6, so fv2's `s.target` and `countInput` are in).
QA: `rig qa 1d896e0 --run "npm ci --silent && npm run check"` printed
`rig qa: test exit 0 at 1d896e0` and `rig qa: negative exit 0 at 1d896e0` (the demo still prints its
one VOID and one FAIL). `test/taste.test.js` at that sha: **31 passed, 0 failed, 0 void, 0 unproven;
targets 2 passed**.

## What I built — DONE

- **`rig taste`** (`src/commands/taste.js`, registered in `bin/rig.js` COMMANDS + USAGE):
  `[--from <dir>] [--url <u>]... [--comps <dir> --ask "<q>"] [--port N] [--lan] [--no-open] [--done]`.
- **References** (`src/taste/sources.js`) come from three places:
  - image files in `--from`: `name-desktop.png` + `name-phone.png` pair into one card shown side by side;
  - `--url`;
  - URLs in the bullets of the plan's `## The best at this job`, read through `parseSections` + `bullets`.
- **Capture** (`src/taste/capture.js`): headless through `harness/cdp.js` at 1440×900 and 390×844,
  into `.rig/taste/shots/` via `rigDir()`. A URL that fails to load, or whose main document answers
  4xx/5xx, is named in the console and skipped.
- **Store** (`src/taste/store.js`): `.rig/taste/ratings.json` keeps **every round**, rewritten whole
  (temp file + rename) on every answer.
  - Re-running with the same sources resumes the newest round.
  - Anything else adds a round, and each card starts with its newest earlier answer.
  - `docs/TASTE.md` holds a local-date line, then `## Ratings` (a table per round, newest first),
    then `## Comps — "<question>"` (comp, rating, picked, note) per comps round, then
    `## Principles` with the placeholder line byte-exact. Principles someone already wrote are kept.
- **Server** (`src/taste/server.js`): node:http, zero dependencies, 127.0.0.1 only unless `--lan`.
  Port is `--port`, else `cfg.tastePort`, else 5391.
  - Every request must carry the round's random token (in the URL or `x-taste-token`).
  - The Host must be one the board listens as (no DNS rebinding).
  - A POST's Origin must be the board's own, and a POST must be `application/json`.
  - Images get content-stamped URLs and `no-cache` + ETag.
  - `.rig/taste/board.json` tells `rig taste --done` where a running board is.
- **Page** (`src/taste/page.js`): one self-contained page, inline CSS and JS.
  - One reference at a time, as large as the stage allows: phone shot beside or under the desktop
    shot, whichever is bigger.
  - Five 56–60 px rating buttons, also number keys, that save and advance by themselves. Anchors only
    at the ends ("1 · not this", "exactly this · 5"), with no leading words in the middle.
  - An optional note, "3 of 6" progress, ‹ back (and ←).
  - An end card with thumbnails and a big Done.
  - Comps round, desktop: the question in the header, frames shaped like their images.
  - Comps round, under 600 px: one comp at full width with A–D chips carrying rating and star,
    switched by tapping a chip or swiping.
  - Light and dark follow the system.
  - Fast taps are queued, never dropped. Answers go with `keepalive` and flush on
    pagehide/visibilitychange. A 4xx ends the round with a plain message. Done waits at most 6 s,
    then says what is wrong.
- **Screenshots** `docs/shots/`: `taste-round-{desktop,phone}-{light,dark}.png` and
  `taste-comps-{desktop,phone}-{light,dark}.png`. They come from the test's own walk over generated
  fixtures, via `RIG_TASTE_SHOTS=docs/shots node test/taste.test.js`. I looked at all of them.

## The bar — DONE

`s.target` + `countInput`, at 1440×900 and 390×844: **7 taps (≤ 7)**. The broken run took
**13 taps**: rating buttons that don't advance by themselves, plus a Next button. `measure` throws a
reason (typed, scrolled, didn't fit, Done never finished) instead of returning NaN. A companion
check proves no typing and no scrolling. Its control pushes the footer below the fold.

## Each check, and the red I saw

Every check is `s.check` / `s.target` with `breaks`. The controls put the old behaviour back:

| Check | Control (seen red) |
| --- | --- |
| dead URL and 404 named and skipped | the 404 page put back as a card |
| desktop 1440×900, phone 780×1688 px shots | phone shot swapped for the desktop one |
| bar, two sizes | no auto-advance + Next (13 taps) |
| no typing / no scroll, two sizes | footer pushed below the fold |
| ratings.json + TASTE.md hold exactly the taps | `handlers.answer` that saves nothing |
| same, through the button | rating buttons wired to nothing |
| note typed, page left at once, is on disk | every fetch after `beforeunload` fails (the first draft's effect) |
| an answer given offline, through a hidden tab, reaches disk once the board is back (fv2's re-check probe) | the 1d896e0 page served instead, via `view.page`: header "Saved", first answer gone |
| a re-rating that overtakes the first answer wins when the first lands last (fv2's second re-check; CDP Fetch holds the first answer) | 94c50dc's answer handler: card 1 ended at 4, not 2 |
| a second tab with its clock 2 minutes behind can still change a rating (fv2's probe E) | c8f3088's page and handler: card stayed 5 under "Saved" |
| fast second tap lands on the next card | the first draft's 160 ms drop rule, in front of the handler |
| number keys rate and advance | keydown swallowed |
| back returns with the rating shown | back button wired to nothing |
| a re-run keeps every round | the first draft's `newRound`, swapped in through `policy.openRound` |
| closed tab + `--done` | `handlers.answer` that saves nothing |
| a 4xx ends the round plainly, Done doesn't hang | the first draft's post(), which retried 4xx |
| only the board's page can talk to it | all four `guards` swapped for `() => true` (no token, foreign Origin, text/plain and a lying Host all got 200) |
| reworked image gets a new URL | an edit with size and nanosecond timestamps restored |
| local date, not UTC (TZ=America/Toronto, 22:30) | `getDate` swapped for `getUTCDate` |
| CLI prints the tokened URL; `--done` stops the board | `--done` whose fetch fails |
| `--lan` reachable on the LAN address with token; default not | `--lan` added to the default run |
| comps rated and starred into TASTE.md | `handlers.pick` that saves nothing |
| question once, frames shaped like the image | question added again + portrait frames |
| phone: chip tap shows that comp, chip carries rating | chip clicks swallowed |
| phone: swipe left/right moves between comps | touchend swallowed before the stage |
| comps at 390: every target ≥ 44 px | `.star` shrunk to 30 px |
| comps at 390: no sideways scroll | a fixed 640 px column |
| dark mode | the dark media rule deleted |
| principles kept | the first draft, which always wrote the placeholder |

Bugs found by the tests, each with a test that failed first:
- **A late, older answer could overwrite a newer one** (fv2's second re-check). The hide flush sends
  every waiting answer at once. My first fix numbered answers by each tab's clock and compared them
  across tabs. fv2's third re-check showed a phone with a slow clock then couldn't change what the
  desktop said. Now each page load has a random tab id and a counter that only goes up. The server
  keeps both per field (rating, note, star) and ignores an answer only when the held one came from
  the same tab with a higher count (replying 200, so the queue clears). Different tabs apply in
  arrival order.
- **A hidden tab lost an answer it hadn't delivered** (found by fv2's re-check of 1d896e0). The hide
  flush emptied the queue whatever happened to the sends, and the next good tap showed "Saved"
  over the gap. Now answers leave the queue only when the server acknowledges them, go one at a time
  in order, and merge into a waiting answer for the same card. "Saved" shows only when the queue is
  empty.

- **Swipe right left the board.** Mobile Chrome took it as the back gesture. The swipe check failed
  that way; the fix is `touch-action: pan-y` and `overscroll-behavior: none`.
- **Sticky `:hover` on phones.** It looked like a rating already given on the next card. I found it
  in the screenshots. Hover is now limited to `(hover: hover)`.

## Decided

- **The note-on-close test leaves by navigating, not by CDP close.** A CDP close keeps the tab's
  timers running long enough for the 250 ms debounce to save the note anyway, which would hide the
  bug. (Measured: the save arrived on navigation.)
- **I removed the `process.exit` I'd added to the CLI.** I couldn't show it was needed: the board
  exits on its own once Done closes it.
- **Rounds keep their own answers.** A new round carries each card's newest earlier answer. TASTE.md
  lists every round that has an answer.
- **Comps accept 2–4 images.** More than 4 uses the first 4, with a warning.
- **URL shots are captured fresh for every new round.** A resumed round keeps its shots.

## Left undone / for others

- DONE (the lead's ruling): **tests never use 5391.** Every test board takes `--port 0` and reads
  its real port back; 5391 stays the CLI default. The test holds 5391 itself for the whole run, as
  his open board would. Red: the 1d896e0 test, with 5391 held, failed at once with "Port 5391 is
  in use". Green: the new one passes 28/0/0 with it held.
- **`rig taste` never commits `docs/TASTE.md`.** It prints the path and says to commit it. The lead
  commits it.
- DONE (fv1, on main at 5d9a012, merged into this branch): `rig brief <id>` now carries the TASTE
  pointer.
