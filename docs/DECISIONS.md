# Decisions

What was decided for the build, where it was decided, and whether the build carries it. Add one with
`rig decision "<what was decided>" --source <transcript|thread>`; close it with
`rig decision <id> --built`, `--scheduled <round>` or `--not-in-scope`. `rig finish` lists every
decision made since the round started and refuses while one of them is open.

| id | date | what | source | status |
| --- | --- | --- | --- | --- |
| D1 | 2026-10-23 | rig status --eta counts local and host QA stages once, at the longer, and leaves repeat stages out of the round | thread | built (2026-10-23) |
| D2 | 2026-10-23 | repeat runs record their own stages (qa:repeat, qa:host:repeat) | thread | built (2026-10-23) |
| D3 | 2026-10-23 | inboxes default to the XDG state dir; inboxDir keeps an existing layout | thread | built (2026-10-23) |
| D4 | 2026-10-23 | rig job never trusts a pane status left from its previous turn | thread | built (2026-10-23) |
| D5 | 2026-10-23 | every review brief carries the Ask these list (seven items) | thread | built (2026-10-23) |
| D6 | 2026-10-23 | timing checks measure the thing itself, not machine load; flake fixes prove it with --repeat 10 under load | thread | built (2026-10-23) |
| D7 | 2026-10-23 | the taste swipe-tap control under extreme synthetic load (VOID at load ~26) | thread | scheduled 5.5.1 (2026-10-23) |
| D8 | 2026-10-23 | baseline lists a green base's unproven check as new when the head is red for another reason | thread | scheduled 5.5.1 (2026-10-23) |
| D9 | 2026-10-23 | a watcher flags a peer done with nothing running and no report as needs a nudge | thread | scheduled 5.5.1 (2026-10-23) |
| D10 | 2026-10-23 | rebase and fold check migration numbering and load each commit's schema into a blank database | thread | scheduled 5.5.1 (2026-10-23) |
| D11 | 2026-10-23 | await stopped host runs before a later host stage starts, not only at the end | thread | scheduled 5.5.1 (2026-10-23) |
| D12 | 2026-10-23 | FINISH.md names the second machine by a label, never its ssh host | thread | scheduled 5.5.1 (2026-10-23) |
