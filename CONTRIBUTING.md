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

The [contributing guide](https://courmap.com/contributing/) has worked examples for split cours, specials, long-runners and release groups.

## From real traffic to the corpus and the data

The resolver corpus (`tests/releases.yaml`) is the list of release names with known answers that CI checks on every change. It grows from what the Sonarr proxy sees in real use:

1. **Export from a proxy.** Open the proxy's status page (`http://<host>:9797/`) and download `export.json` (or `export.txt`). It lists the names the proxy could not resolve, and the names it rewrote only with Sonarr's help ("assisted": Courmap knew the work but had no TVDB numbering for it).
2. **Import them as cases.** In the repository, run `pnpm corpus:from-proxy export.json` (several files at once are fine). Every new name becomes an unverified case in `tests/releases.yaml`, recording what the resolver answers today, with a note on where it came from. Names already in the corpus are skipped.
3. **Verify each case.** Decide what the right answer is (the work and episode, or `ambiguous` or `unmatched` when that is honestly right), correct `expect`, and set `verified: true`. Only verified cases count toward the pass rate.
4. **Fix what the cases show.** A case that should resolve but does not usually needs an alias or a mapping in `data/works/`. For assisted names, the status page's "Copy as GitHub issue" block already contains the `data/works/<id>.yaml` override the proxy derived; check it on TVDB and open a pull request with it.
5. **Run `pnpm corpus`.** The pass rate must not drop; after an improvement, `pnpm corpus --update-baseline` records the new baseline. Commit the cases, the fixes and the baseline together.

`pnpm corpus:import <names.txt>` does step 2 for any plain list of release names, one per line. The same loop, the `export.json` fields and how users report names are on the site: [Turning proxy reports into data](https://courmap.com/proxy-reports/).

## Finding something to fix

Open issues are listed at https://github.com/courmap/courmap/issues; the ones labeled `good first mapping` are the easiest. [Fixing open issues](https://courmap.com/fixing-issues/) explains each kind of issue, how to check it against the provider, and the usual fix.

## Reviewing bot pull requests

The bots open pull requests for new prequel links and airing updates (see [How automation works](https://courmap.com/automation/)). Merge the ones that are right; edit a pull request's branch to drop a line you disagree with. To reject one for good, close it and add an entry to `data/rejected.yaml` with the reason and a link to the pull request, so the bots never propose it again.

## Style

- No em dashes anywhere (code, comments, docs, commit messages). `pnpm check:dashes` checks files.
- Small commits, one logical change each.
