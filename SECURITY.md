# Security and privacy

PR Compass is a read-only GitHub.com public-data CLI. All network calls are GET
requests to the GitHub API. It does not check out or execute pull request code,
run commands from titles, post comments, create reviews, merge, or change profiles.

No AI service, telemetry, server, persistent storage, or runtime dependency is
used. The CLI prints to stdout and does not create or update files. The optional
GITHUB_TOKEN is read from the environment, never command arguments. Raw network
error text and token values must not be included in output. Untrusted PR text
must be sanitized for terminal control sequences.

Public visibility is verified before displaying a PR. A supplied token does not
enable private-PR support. Classification is informational: it cannot authorize
a merge or establish required-check/approval compliance. Unknown information
must never become success.

Review the revision you run. The repository's own test workflow has read-only
contents permission and does not persist checkout credentials.

Earlier pinned commits of this project implement profile-writing features.
Those remain available in Git history; remove any old installed profile
workflow to stop its updates. Current main is the read-only CLI.

Do not put credentials, private repository names or employer information in
bug reports. Use private vulnerability reporting if enabled for sensitive
findings; otherwise contact the maintainer without publicly exposing secrets.
