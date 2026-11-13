# Public mode

[Back to the README](../README.md)

`public_mode: true` lets a **public** Traffolio repository collect, for example a public demo dashboard. Use it only if you intend to publish these numbers:

- **Everything it produces is public.** The traffic, star/fork, referrer and release data of the selected repositories, the README dashboard, and the repository's Actions logs and run Summaries can be read by anyone.
- **Private repositories are never selected.** `include_private: true` is refused with a config error, and a run stops with nothing written if `data/index.json` already holds data about a private repository (or cannot be read): start from a clean repository rather than publishing data from a private past.
- **A tracked repository that turns private** is no longer collected, and its index entry keeps its previous (public) metadata, only marked `missing`, so the dashboard does not reveal the change or its new name. Its earlier data stays, since it was already public.
- Logs and the Summary name only the selected repositories; other repositories appear only in the discovered/selected counts. The README table and the repository pages also keep repositories tracked earlier (excluded or `missing` now), with their earlier public data. A repository never selected appears nowhere.
- **Use a separate fine-grained token** for the public repository's `TRAFFIC_TOKEN`, limited to the repositories you publish (Repository access: **Only select repositories**), so it cannot read traffic of anything else.
- In a private repository `public_mode` has no effect; the run logs a notice and collects as usual.

## Embed a chart in another README

A public-mode repository's charts are public files, so any README can show them, for example the project's own. Each run updates them, and each chart follows the viewer's light or dark GitHub theme (in Safari, the system appearance).

```markdown
![Views of my-project](https://raw.githubusercontent.com/<user>/<traffolio-repository>/main/assets/repos/<repo_id>/views.svg)
```

- `assets/views.svg` and `assets/clones.svg`: daily totals across the selected repositories over the last 30 days, headlined by the 30-day total (marked `*` when some days are missing or partial).
- `assets/repos/<repo_id>/views.svg`, `clones.svg`: one repository's last 90 days, and `stars.svg` once its star history has been stored. `<repo_id>` is the repository's numeric ID, the name of its page in `repos/` (linked from the README table), or `gh api repos/<user>/<name> --jq .id`.

Replace `main` if your default branch has another name. Charts in a private Traffolio repository can't be embedded elsewhere: their URLs need access to the repository.

## GitHub Pages dashboard

With `pages: true` as well, each run also publishes the [local dashboard](../README.md#local-dashboard) to GitHub Pages, at `https://<user>.github.io/<repository>/`. The page is built from the `data/` the run has just committed, so it shows nothing the repository doesn't already publish, and it names no local path.

1. Set `pages: true` in `traffolio.config.yml`, next to `public_mode: true`.
2. In the repository's Settings → Pages, set **Build and deployment → Source** to **GitHub Actions**. Until then the `deploy-pages` job fails; a workflow can't turn Pages on by itself.
3. Run **Traffolio Collect**. The `deploy-pages` job's summary links the page.

What gets published, and when:

- Only from a public repository in public mode. A private repository with `pages: true` logs a notice and publishes nothing (a Pages site on a personal account is always public), and the template repository publishes nothing.
- Never when `data/index.json` lists a private repository: the run stops before anything is collected, and the page build refuses that data too.
- A partial run (exit 2) still publishes: the data it committed is already public. A run whose commit or push failed publishes nothing.
- A run that changed no data still redeploys, so a Traffolio update to the dashboard reaches the page.
