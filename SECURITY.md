# Security and privacy

PR Compass is a read-only GitHub.com public-data reader. It does not check out
pull request code, execute titles, write comments, merge PRs or read private PRs.
Treat all upstream titles and API responses as untrusted.

The Action writes its selected README and four static SVG files in a validated
relative assets directory. The caller commits them together. Generated SVGs have
no scripts, external resources or embedded HTML. Use the short-lived built-in `GITHUB_TOKEN`, not a personal
access token. The example grants `contents: write` only to the update job so it
can save its own repository's README. It does not grant write access to upstream
repositories. No repository-wide permission change is required.

Pin the action and dependencies to full commit SHAs. Review updates before
changing the pin. Run updates only on the default branch through `schedule` or
`workflow_dispatch`, never `pull_request_target` or untrusted PR code.

Missing or duplicate markers, search failures, and invalid inputs fail without
replacing the README. An old observation timestamp means the display may be
stale. Never use this display as authorization to merge or as a security gate.

Do not include tokens, employer data, private repository names, or other secrets
in bug reports. For sensitive findings, use GitHub's private vulnerability report
feature if enabled; otherwise contact the maintainer without posting exploit
secrets publicly.
