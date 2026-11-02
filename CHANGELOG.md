# Changelog

All notable changes to Traffolio are listed here. Versions follow [Semantic Versioning](https://semver.org/); until 1.0.0, a minor version may change the configuration or data format, and the notes say how to update.

To update an existing Traffolio repository, see [Updating Traffolio](README.md#updating-traffolio).

## [Unreleased]

### Public mode

- `pages: true` publishes the dashboard to GitHub Pages on each run, from the data the run committed. It only takes effect in a public repository with `public_mode: true`; set the repository's Pages source to GitHub Actions first (see [GitHub Pages dashboard](README.md#github-pages-dashboard)).
- `npm run dashboard -- --public` builds that page locally: no local path in the header, and it refuses data that lists a private repository.

## [0.1.0] - 2026-11-01

First release.

### Collection

- A daily GitHub Actions workflow collects views and clones for the repositories your personal account owns and keeps the history as JSON in `data/`, one file per repository and month. The Traffic API's 14-day window is upserted by repository ID and UTC date, so re-runs never double-count.
- Filters in `traffolio.config.yml`: `include`/`exclude` globs, and opt-ins for private repositories, forks, archived repositories and the Traffolio repository itself. Unknown keys and wrong types are rejected.
- Star and fork history, top referrers and popular pages, and release download counts for the same repositories.
- Fail closed: nothing is collected or committed unless the Traffolio repository is private (or opts in with `public_mode: true`), and the token is never written to data, logs or the run Summary.
- Exit codes and the run Summary separate a fatal stop (nothing written), a partial run (successes committed, run marked failed) and a successful one.

### Output

- A dashboard section in the README between the `TRAFFOLIO` markers: 7-day, 30-day and all-time totals, a per-repository table with 30-day trend sparklines, a daily chart (`assets/traffic.svg`) and the top referrers.
- Missing days are never shown as zero. Days before a repository's first collection count as not tracked yet rather than missing.
- `npm run dashboard` builds a local single-file HTML dashboard with period selection, per-repository details, star history, referrers, pages and release downloads. It loads nothing external.

### Public mode

- `public_mode: true` lets a public repository publish the traffic of selected public repositories. Private repositories can't be selected, and a repository that turns private stops being collected without revealing the change.

[Unreleased]: https://github.com/zeikar/traffolio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zeikar/traffolio/releases/tag/v0.1.0
