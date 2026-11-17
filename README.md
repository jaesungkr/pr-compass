# PR Compass

**English** · [한국어](README.ko.md)

**Know which pull request to look at next.**

A small, read-only CLI for your public contributions to other people's repositories.
It groups PRs by observed signals and gives a reason, next step, and source link.
No AI, server, dependencies, profile widgets, or write access.

## Run

Node.js 22 or newer:

```sh
git clone https://github.com/jaesungkr/pr-compass.git
cd pr-compass
node src/cli.mjs YOUR_USERNAME
```

No package installation is needed. Review the code you clone; use a reviewed
commit rather than automatically upgrading to an unreviewed revision.

```sh
node src/cli.mjs YOUR_USERNAME --language ko
node src/cli.mjs YOUR_USERNAME --limit 3
node src/cli.mjs YOUR_USERNAME --json
node src/cli.mjs --help
```

The default limit is **5 open + 5 recently merged PRs**, not every PR.
The report states how many matches were sampled. Increase `--limit` up to 20
when needed, bearing in mind API limits. Current searches do not enumerate
historical unmerged closed PRs; a PR closed during collection is labeled
closed without merge.

## Four groups, not a merge verdict

- **Needs a look**: change-request reviews, failed checks, checks requiring
  attention, or a draft. Inspect the evidence; a failure is not necessarily
  caused by your patch, and an old change request may already be addressed.
- **Waiting**: checks still running, or no observed actionable signal in the
  available checks/reviews. This does not mean a maintainer owes you a response,
  required approval is satisfied, or the PR is ready to merge.
- **Done**: GitHub explicitly reports merged, or closed without merge. Those
  outcomes remain distinct. A closed PR is not called a successful contribution.
- **Unknown**: unavailable or partial information, no visible HEAD checks,
  or an otherwise inconclusive state. No checks is never treated as passing.

Known actionable evidence remains worth inspecting even when other data is
incomplete; the report includes that caveat. Merged/closed state takes
precedence over historical check failures.

## What it reads

Only public PRs whose **base repository owner differs from the requested
username**, case-insensitively. Your own repositories and forks are excluded.
Organization-owned repositories remain included. A PR from your own fork into
an upstream project is included.

The CLI reads PR state, latest decisive review records, check runs and legacy
statuses on the fetched **HEAD SHA**. It does not evaluate branch protection,
required checks, resolved conversations, merge queues, or test-merge checks.
Review records are not a policy decision. Search indexing and PR state can
change while the snapshot is being collected.

Each category searches up to 100 recently updated matches. The selected merged
sample is ordered by actual merge date within those results, not guaranteed
global history. The report is a bounded snapshot, not continuous monitoring.

## Authentication and failures

Works without a token when GitHub's public API allowance permits it.
`GITHUB_TOKEN` is optional and read **only from the environment**. Never put a
token in command arguments, commits, screenshots, or issues. Do not broaden
permissions for this tool: it only makes GET requests for public data, even if
a supplied token could read more.

Requests are bounded, sequential, and timed out. GitHub rate limits can make
a second unauthenticated run fail; wait for reset rather than retrying rapidly.
Search failure, incomplete search, or unverified repository visibility aborts
the report rather than producing false zeroes. Unavailable check/review
details are explicitly unknown.

Exit **0** means collection/reporting succeeded, not that your PRs are healthy.
Invalid input or a failed collection exits **1**. `--json` emits one JSON
document on stdout; errors go to stderr. There are no output files unless
you explicitly redirect stdout yourself.

Environment defaults: `PR_COMPASS_USERNAME`, `PR_COMPASS_LIMIT`,
`PR_COMPASS_LANGUAGE`. Explicit CLI options override them.

## Migrating from the profile version

This is a different product direction. The current CLI **never edits READMEs,
generates images, commits, or schedules updates**. The old composite Action and
profile workflow example have been removed from main.

If you installed an older pinned profile workflow, this repository cannot stop
it for you. Remove that workflow from your profile repository, and remove its
generated marker block/assets if no longer wanted. Old pinned commits retain
the old behavior. Do not simply replace an old Action pin with this CLI revision.

## Development

```sh
node --test
```

No runtime/test dependencies. CI covers Node 22 and 24. Tests cover classification
precedence, incomplete data, escaping, public/external boundaries, CLI behavior,
and the no-write contract. AI assistance was used in implementation and tests.

[Security and privacy](SECURITY.md) · [MIT license](LICENSE)
