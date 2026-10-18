# Contributing

Thanks for helping keep anime episode numbering correct for everyone.

## Licensing of contributions

- Code contributions are accepted under the Apache License 2.0 (`LICENSE`).
- Data contributions (anything under `data/`) are accepted under the Open Database License 1.0 with contents under the Database Contents License 1.0 (`DATA_LICENSE`). By opening a pull request that changes `data/`, you agree to license your contribution under those terms.

## Fixing a mapping

One pull request fixes one show: edit or add a single file under `data/works/` (or `data/sequences/`, `data/groups/`).

1. Use real provider IDs only when you can verify them. Never guess an ID.
2. Add `sources:` URLs for anything non-obvious.
3. Do not copy AniDB titles into the repo.
4. Run `pnpm validate` locally. CI runs the same checks plus the test suites.

A full mapping guide with worked examples is planned for the docs site.

## Style

- No em dashes anywhere (code, comments, docs, commit messages). `pnpm check:dashes` checks files.
- Small commits, one logical change each.
