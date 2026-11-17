# PR Compass

**Your public pull requests, without losing the nuance.**

A dependency-free GitHub Action and Node CLI that keeps a small status section in
your profile README up to date. It shows open PRs and recently merged PRs, review
records and current HEAD checks without pretending that a green check means
“ready to merge.” English and Korean output are supported.

## Install in your profile

1. In your `USERNAME/USERNAME` repository, add exactly one marker pair to
   `README.md`, wherever you want the status section:

   ```markdown
   <!-- PR-COMPASS:START -->
   <!-- PR-COMPASS:END -->
   ```

2. Copy [`examples/profile-workflow.yml`](examples/profile-workflow.yml) into
   `.github/workflows/pr-compass.yml` in that repository. The example is pinned
   to a tested full commit SHA. Review that revision before enabling the workflow;
   keep future upgrades pinned to a full reviewed SHA too. The default username
   is your repository owner. Change `language` to `ko` for Korean.

3. Open **Actions → Update public PR status → Run workflow** on your default
   branch. Check the first run and the resulting README commit. Thereafter the
   workflow requests an update every six hours at minute 23, UTC.

No PAT, third-party account, paid service, package install or repository-wide
permission change is needed. The built-in, short-lived `GITHUB_TOKEN` is supplied
by GitHub. The update job needs `contents: write` only to commit its own README.
If branch protection or your organization blocks that write, keep the protection
and adapt your own review process instead of granting broader access.

The action only edits the file. **Your workflow owns committing it.** Everything
outside the marker pair is preserved. Missing, duplicated or reversed markers
are errors, not an invitation to overwrite your biography.

## Action inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `username` | required | A valid GitHub username |
| `readme` | `README.md` | File containing one marker pair |
| `limit` | `5` | PRs per category, from 1 to 20 |
| `language` | `en` | `en` or `ko` |
| `token` | `${{ github.token }}` | Optional built-in token for rate limits |

## Run locally

Requires Node.js 22 or newer. Clone a revision you trust, then:

```sh
node src/cli.mjs --username YOUR_USERNAME --readme /path/to/README.md --limit 5
node --test
```

Use `--language ko` for Korean. The CLI accepts `PR_COMPASS_USERNAME`,
`PR_COMPASS_README`, `PR_COMPASS_LIMIT`, and `PR_COMPASS_LANGUAGE` environment
variables, plus optional `GITHUB_TOKEN`. Never put a token in a command argument
or commit it. Unauthenticated calls have much lower rate limits.

## What the status means

- **Public only.** Search is constrained to public PRs. Private repository
  content is not a supported feature, even if a supplied token can read it.
- **State is separate from CI.** Draft, open, merged and closed are PR states.
  Failures, running checks, cancelled/action-required checks, success and
  neutral/skipped results remain distinct. Zero visible checks is not success.
- **Review records are not branch protection.** The latest decisive review per
  reviewer and approvals on the observed HEAD are distinguished. Required
  approvals, resolved conversations and branch rules are not inferred.
- **HEAD only.** Results describe the fetched head SHA, not GitHub's test-merge
  commit. A PR can change while a request is running. Open the linked source
  before taking action.
- **Bounded snapshot.** Searches retrieve at most 100 updated PRs per category;
  the chosen limit controls how many are shown. Merged results are sorted by
  actual merge date within that sample, not guaranteed global history. Search
  indexing can lag. Truncated detail pages are marked partial.
- **Unknown is not healthy.** Unavailable details are explicitly unknown or
  partial. Search failure, incomplete search, bad input or invalid markers fail
  the run and preserve the last README. Its observation timestamp remains old.

## Operations and limits

GitHub schedules are best-effort, may be delayed or dropped, and run from the
default branch. In public repositories, scheduled workflows may be disabled
after 60 days without repository activity. Keep **Actions** notifications on if
you want failure notices, and use manual dispatch to inspect or resume updates.
This is a scheduled snapshot, not a real-time monitor.

API limits include separate search and secondary limits. Requests are bounded
and sequential; the tool does not retry aggressively. On a rate limit, wait
until GitHub allows another run rather than increasing token permissions.

To uninstall, remove the workflow. Remove the marked block too if you no longer
want the last snapshot displayed. Removing only the block will cause subsequent
runs to fail safely.

## Development

No runtime or test dependencies. `node --test` exercises fixture-based API
responses, status classification, Markdown safety and preservation behavior.
CI runs on Node 22 and 24. Do not add real tokens or private data to fixtures.
AI assistance was used in the initial implementation and tests.

See [security and privacy](SECURITY.md). Contributions should include a regression
test and keep the public-only, least-privilege boundary intact.

## References

- [GitHub workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)
- [Scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

## License

[MIT](LICENSE).
