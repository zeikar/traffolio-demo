# Data

[Back to the README](../README.md)

Everything lives in your repository. These files are created by collection (the template ships with an empty `data/`):

```text
data/
  index.json                 repo ID -> name, visibility, status, star/fork snapshot
  status.json                data-through date, per-repo last success and error class
  traffic/<repo_id>/YYYY-MM.json   daily metrics for one repo and month
  growth/<repo_id>.json      stars and forks per date
  referrers/<repo_id>/YYYY-MM.json   top referrers and pages, one snapshot per run date
  releases/<repo_id>.json    cumulative release downloads per run date (only repos with release assets)
assets/views.svg, clones.svg generated README charts
assets/sparklines/<repo_id>.svg   30-day views trend shown in the README table
assets/repos/<repo_id>/views.svg, clones.svg, stars.svg   90-day charts of the repository page
repos/<repo_id>.md           per-repository page (totals, charts, referrers, releases)
```

Per-month file shape:

```json
{
  "schemaVersion": 1,
  "repositoryId": 12345678,
  "month": "2026-10",
  "days": {
    "2026-10-25": { "views": 112, "uniqueViews": 45, "clones": 8, "uniqueCloners": 6 }
  }
}
```

- **Present, missing, not tracked yet.** A date key in `days` means it was collected, even when every value is `0`. A repository's tracking starts at its earliest stored date. After that, a date without a key is missing: it was never collected (failed run, no permission, or a gap longer than 14 days). Before it, the date is not tracked yet: windows start no earlier than the first stored date, so a 30-day window over a repository first collected 14 days ago covers those 14 days, with no `*`. A tracked repository with no stored days at all (its first collection failed) shows `—` and marks every tracked date of the totals as partial. Missing days are never summed as zero or interpolated; the dashboard shows them as `—`.
- **Data-through date, not run date.** The Traffic API lags by one to two days, and its 14-day window ends on different days for different repositories. "Data through" is the earliest window end among the repositories collected successfully in the latest run, so a faster repository's later day doesn't show up as a day the others lack; it is stored and appears on a following run. A repository whose collection failed doesn't hold the date back, so the newest day can still be partial (marked `*`).
- **UTC only.** All dates and periods are UTC. There is no timezone setting.
- **Events, not people.** Totals are event counts summed across the tracked repositories. Daily unique counts are stored but are not added across days or repositories, so there is no "monthly unique visitors". The repository pages and the dashboard show daily unique counts as separate lines but never sum them. CI checkouts of your repositories can count as clones.
- **Star and fork counts in `index.json` are snapshots** taken at collection time. `growth/<repo_id>.json` holds the history: the number of stars and forks per UTC date, fetched in full each run. Stars come from GitHub's weekly star history (stars per day of each week); GitHub's day boundaries aren't UTC, so a star can be counted on an adjacent day, while weekly totals are reliable. Forks come from the fork list (`created_at`). A listing GitHub refuses to page through makes that extra fail and the run partial (exit 2), with the previous history kept. It is retroactive back to the repository's start, but covers only current stars and existing forks: removed stars and deleted forks are absent, so past totals can be slightly lower than they really were. Only dates are stored, never usernames.
- **Referrer snapshots are 14-day aggregates.** GitHub reports only each repository's top 10 referrers and top 10 pages over the last 14 days. Each run stores that list under its run date in `referrers/<repo_id>/YYYY-MM.json` (an empty list is a valid snapshot). These are rolling 14-day totals as of each run date, not daily values, so don't add snapshots together. The README's top-referrer table sums the latest run date's snapshots across repositories (counts only: uniques cannot be added across repositories).
- **Release downloads are cumulative.** `releases/<repo_id>.json` stores, per run date, each published release's total asset downloads so far. Downloads between two snapshots are the increase from one to the next, shown on the later snapshot's date: a gap between snapshots can't be split into days, and a decrease (deleted assets) counts as 0. Drafts are ignored, prereleases count. Updater metadata, signatures and checksum files, matched by name (`latest.yml`, `latest-*.yml`, `latest.json`, `*.blockmap`, `*.sig`, `*.asc`, `*.minisig`, `*.sha256`, `checksums.txt`, `SHA256SUMS`, ...) are not counted, while other `.json`/`.yaml` assets are, and GitHub has no counts for source-code archives, so those, and downloads from npm or other registries, are not included. A repository gets this file once it has at least one counted asset; after that, every successful run appends a snapshot, even when all counted assets were later deleted. Metadata of deleted releases is kept.
- **Nothing is deleted.** If a repository is deleted, renamed, or filtered out later, its old data stays. Repositories are keyed by their numeric ID, so a rename continues the same history.
- Files have a fixed ordering and contain no run timestamps, so a same-day re-run with unchanged GitHub responses produces no diff and no commit.
