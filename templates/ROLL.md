# {{ROLL}} — a cross-repo roll

One brief, several tabs, each tab a list of repos, one procedure applied to every repo in turn, one
report per tab. `rig roll up <this file>` opens one tab per list in the workspace it runs from.

## What it's for
<the change every repo gets, in one or two sentences — not the tool>

## What must not happen
- <a hard rule every tab obeys, e.g. "Never commit over a dirty tree; SKIP it and say so.">
- <"Never touch a repo that is not on its default branch.">
- <"Nothing leaves without the owner: no releases, deploys, posts or pull requests.">

## Procedure per repo
1. <record the test result before touching anything>
2. <the change>
3. <run the tests again; if they went red, revert and SKIP with the reason>
4. <one commit with the subject below; push where there is a remote>

## Commit subject
<one line, identical in every repo; `rig roll status` finds roll commits by it>

## Report
<where each tab writes, `{tab}` for the tab id; default: <roll dir>/{tab}/REPORT.md>

## Repos
<optional overrides, one per line: `slug = ~/path`. Otherwise a slug is found through the registry
(`~/.claude/apps/<slug>.md`, its `code:` field) and then `~/Projects/<slug>`.>

## Lists
<one `### <tab id>` per tab. Ids are the tab labels and must be unique across the workspace:
prefix them with the roll's name (`lint1`, `lint2`), never bare `t1`/`c1`, which the next crew will also use.>

### lint1
<slug-a, slug-b, slug-c — one line of comma-separated slugs, or one slug per bullet>

### lint2
- <slug-d>
- <slug-e>
