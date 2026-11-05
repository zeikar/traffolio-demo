# Security and permissions

[Back to the README](../README.md)

- **Never make this repository public.** Traffic numbers and the full Git history become public the moment you do, and a later detection by the collector cannot undo that. If you want a public dashboard, create a clean new repository with `public_mode: true` instead (see [Public mode](public-mode.md)).
- The token lives only in Actions Secrets. It is never written to data files, config, logs, the run Summary, or the SVG, and error messages do not dump raw HTTP responses.
- `include_private` defaults to `false`, so private repositories are not collected unless you opt in.
- **Visibility is re-checked on every run.** Traffolio calls `GET /repos/{GITHUB_REPOSITORY}` each time instead of trusting the event payload. Each collected repository's visibility is also re-read and stored; if a repository became private while `include_private` is `false`, that repository is no longer collected (its past data stays).
- **Fail closed.** If Traffolio is public without `public_mode: true`, or its visibility cannot be determined, nothing is collected or committed. If the repository is the template origin (`is_template`), the run exits successfully with a notice and collects nothing.

What failures look like in Actions:

| Situation | Data | Run result |
|---|---|---|
| Missing `TRAFFIC_TOKEN`, 401, `GET /user` fails | Nothing written | Failed (exit 1) |
| Traffolio repo is public without `public_mode: true`, or visibility cannot be determined | Nothing written | Failed (exit 1) |
| `public_mode: true` in a public repo with `include_private: true` | Nothing written | Failed (exit 1) |
| `public_mode: true` in a public repo whose `data/index.json` lists a private repository, or is unreadable | Nothing written; nothing deployed to GitHub Pages | Failed (exit 1) |
| All selected repositories failed | Nothing written | Failed (exit 1) |
| Some repositories hit transient errors (5xx, network, rate limit) after retries | Successes are committed | Failed (exit 2) |
| A repository returns 403/404 (no permission or traffic not available) | Status recorded, no numbers written | Succeeds with a warning; shown as `—` |
| Star/fork, referrer or release request returns 401 | Nothing written | Failed (exit 1) |
| Star/fork, referrer or release request returns 403/404 | That file keeps its previous contents; traffic is committed | Succeeds with a warning in the log |
| Star/fork, referrer or release request fails transiently (5xx, network, unexpected response) | That file keeps its previous contents; everything else is committed | Failed (exit 2) |
| The rate limit is not lifted in time during star/fork, referrer or release requests (or already during traffic) | No further requests; what was gathered is committed | Failed (exit 2) |
| Template origin repository | Nothing written | Succeeds (exit 0) with a notice |

A failed run sends GitHub's normal notification, so a broken token does not go unnoticed.

## Why Administration: Read

For fine-grained tokens, GitHub's REST docs list **Administration: Read** as the permission required by the traffic endpoints, so the token needs it. Traffolio uses it read-only and calls exactly these APIs:

| API | Token | Permission | Purpose |
|---|---|---|---|
| `GET /user` | `TRAFFIC_TOKEN` | none | Identify the token owner |
| `GET /user/repos?affiliation=owner` | `TRAFFIC_TOKEN` | Metadata: Read | List repositories you own (paginated) |
| `GET /repos/{owner}/{repo}/traffic/views?per=day` | `TRAFFIC_TOKEN` | Administration: Read | Daily views |
| `GET /repos/{owner}/{repo}/traffic/clones?per=day` | `TRAFFIC_TOKEN` | Administration: Read | Daily clones |
| `GET /repos/{owner}/{repo}/traffic/popular/referrers` | `TRAFFIC_TOKEN` | Administration: Read | Top 10 referrers, last 14 days |
| `GET /repos/{owner}/{repo}/traffic/popular/paths` | `TRAFFIC_TOKEN` | Administration: Read | Top 10 pages, last 14 days |
| `GET /repos/{owner}/{repo}/stargazers/history` | `TRAFFIC_TOKEN` | Metadata: Read | Stars per day, by week (paginated; contains no user data) |
| `GET /repos/{owner}/{repo}/forks` | `TRAFFIC_TOKEN` | Metadata: Read | Fork dates (paginated; only `created_at` is kept) |
| `GET /repos/{owner}/{repo}/releases` | `TRAFFIC_TOKEN` | Contents: Read (private repositories only; optional) | Release asset download counts (paginated) |
| `GET /repos/{GITHUB_REPOSITORY}` | `GITHUB_TOKEN` | Metadata: Read | Check Traffolio's own visibility and that it is not the template |

Star history and fork lists are fetched in full on every run (one request per 30 weeks of the repository's age, and per 100 forks), because an unchanged count does not prove the dates are unchanged: an unstar plus a new star leaves the total the same.

The default `GITHUB_TOKEN` cannot read other repositories' traffic, so it cannot replace the PAT. The workflow only needs `contents: write` for the commit; with `pages: true` in public mode, its `deploy-pages` job also uses `GITHUB_TOKEN` with `pages: write` and `id-token: write` to publish the dashboard. Notes on the API versions and behavior are in [github-api-notes.md](github-api-notes.md).
