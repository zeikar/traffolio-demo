# Operations

[Back to the README](../README.md)

- **Schedule.** The workflow runs daily at 03:17 UTC (an off-the-hour time, because GitHub delays runs at the top of the hour). Scheduled runs can still be delayed or skipped. If one is missed, run it manually from Actions → **Traffolio Collect** → **Run workflow**. A missed day is recoverable as long as you re-run within 14 days; the dashboard's data-through date and `—` cells show any gap.
- **Token expiry.** Fine-grained tokens expire. Renew before the expiry date and replace the `TRAFFIC_TOKEN` secret. If collection is broken for more than 14 days, the older days are lost permanently because GitHub no longer provides them.
- **Branch protection.** Rules that block pushes to the default branch also block the bot's commit. See [Troubleshooting](#troubleshooting).
- **Private repository traffic.** Whether traffic is available for private repositories depends on your GitHub plan and the token's permissions. Unavailable repositories are recorded in `data/status.json` and shown as `—`, never as zero.
- **Actions minutes.** A daily run takes roughly 1 to 2 minutes, about 30 to 60 minutes a month. Private repositories draw on your account's included Actions minutes, so compare that with your plan.
- **Adding or removing repositories.** Each run rediscovers your repositories, so new ones are picked up automatically. Removed or excluded ones keep their history.

## Run a collection locally

The same collection the workflow runs can be run from your clone, for example while Actions is unavailable:

```sh
npm run build
TRAFFIC_TOKEN=<token> GITHUB_TOKEN=<token> GITHUB_REPOSITORY=<you>/<your Traffolio repo> node dist/cli/collect.js
git add -A -- data assets repos README.md && git commit -m "chore(data): update traffic (local run)" && git push
```

`GITHUB_TOKEN` here only needs to read your Traffolio repository's metadata (the fail-closed visibility check); your fine-grained `TRAFFIC_TOKEN` works if it covers that repository. Run it at least every 14 days to avoid gaps.

## Troubleshooting

- **The run stopped with `readme_markers`.** The README must contain exactly one `<!-- TRAFFOLIO:START -->` and one `<!-- TRAFFOLIO:END -->`, with START first; the log names what is wrong (a missing marker, a duplicate, or the wrong order). Nothing was collected or written. Put the two marker lines back on their own lines where the dashboard should go (whatever is between them is replaced on the next run), commit, and re-run the workflow.
- **The run failed because `TRAFFIC_TOKEN` is missing, or with a 401.** The secret is missing, expired, or revoked. Create a new token as in [Setup](../README.md#setup) step 4 and update the secret, then re-run.
- **The run failed because the repository is public.** Make it private again. Anything committed while it was public is already exposed, so consider the history compromised and start from a fresh private repository if the data matters. Set `public_mode: true` only if you intend to publish the numbers (see [Public mode](public-mode.md)).
- **A public-mode run failed with `public_private_data`.** The repository's `data/index.json` already holds data about a private repository, typically because it was a private Traffolio repository before. Create a clean new repository for public mode instead.
- **The commit/push step failed (branch protection).** The workflow pushes to the default branch as `github-actions[bot]` using `GITHUB_TOKEN`. If branch protection or a ruleset requires pull requests, reviews, or status checks, that push is rejected. Allow the GitHub Actions bot to bypass the rule for this repository, or relax the rule on the default branch. Collected data from the failed run is not committed, and the next run collects it again.
- **The push was rejected because of a concurrent push.** If you pushed at the same moment, the workflow rebases and retries once. If it still fails, just re-run the workflow.
- **A repository's Status shows `<error> since <date>`.** The date is when that error first appeared; it stays the same while the same error repeats on later runs.
- **A repository shows `—`.** The API returned 403/404 for it (permissions or plan), or it has not been collected yet. Check `data/status.json` for the reason, and check that the token covers that repository.
- **Some repositories failed (exit 2).** These were transient errors such as rate limits or 5xx responses. Successful repositories were committed; re-run the workflow to retry the rest.
