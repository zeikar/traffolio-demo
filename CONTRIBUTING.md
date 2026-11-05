# Contributing

Thanks for helping with Traffolio. Bug reports, questions and pull requests are welcome.

## Reporting a problem

Open an issue with the bug report form. Include the Actions run's Summary and the relevant log lines, but **never paste your token**, and leave out anything from a private repository you don't want to share (names, numbers, referrers). The collector's messages are designed to be shareable: they name an error class, not response bodies.

For a security problem, such as a way the token or private data could leak, use [private vulnerability reporting](https://github.com/zeikar/traffolio/security/advisories/new) instead of a public issue.

## Development

Requires Node 24.

```sh
npm install
npm run check   # type check (src and test), tests, build, and a check that docs/demo is up to date
```

`npm run demo` regenerates `docs/demo/` from `fixtures/`; commit the result when your change alters the README output. `npm run dashboard:demo` writes a local dashboard from the same fixtures. Neither needs GitHub access.

## Pull requests

- Keep a pull request to one change, with tests for new behavior. A bug fix should come with a test that fails without it.
- Run `npm run check` before pushing; CI runs the same.
- Code, comments, docs and commit messages are in English. Commit subjects follow the existing style (`fix(reporter): ...`, `feat(dashboard): ...`, `docs: ...`).
- Changes to what is collected, stored or published need extra care: data files are public in public mode, and a Traffolio repository's history can't be rewritten after the fact. Explain the effect on existing `data/` files, and update docs/data.md and the CHANGELOG.
- No new runtime dependency without a reason; the collector runs with a write-scoped token.
