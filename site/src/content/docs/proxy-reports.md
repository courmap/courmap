---
title: Turning proxy reports into data
description: What happens to the names a Sonarr proxy could not resolve, and how a maintainer uses export.json and export.txt to grow the resolver corpus and fix the data.
---

The Sonarr proxy keeps a list of the [release names](/concepts/release-names/) it could not resolve, and of the works it numbered only with Sonarr's help. Nothing is sent anywhere. This page covers the two ways that list reaches the project, and what a maintainer does with it.

## Reporting from a proxy (anyone)

1. Open the status page at `http://<your-host>:9797/` and scroll to **Copy as GitHub issue**. Press **Copy** (if your browser blocks it, the text is selected for you; press Ctrl+C).
2. Read the text. Remove anything you do not want public. The proxy masks its own API keys, but release names are shown as they were.
3. [Open a new issue](https://github.com/courmap/courmap/issues/new?template=unresolved-names.yml) with the "Unresolved release names from the proxy" form. Keep the title prefix and add a few words, such as the show: `Unresolved release names from the proxy: Frieren, 3 names`. Paste the text into the first box.

What happens next: a maintainer adds the names to the resolver corpus as unverified cases, decides the right answer for each, and fixes the data with an alias or a mapping. The assisted blocks in your report are `data/works/` overrides the proxy derived from Sonarr; a maintainer (or you, in a pull request) checks each against TVDB before it is merged. You will get a reply on the issue or a pull request that closes it. The names then count as cases in CI, so the same mistake cannot return unnoticed.

## The export files (maintainers)

The status page also links two downloads, served by the proxy at `/export.json` and `/export.txt`. They are the same data as the issue text, in a form `pnpm corpus:from-proxy` reads.

`export.json`:

| Field | Meaning |
| --- | --- |
| `courmap_proxy_export` | Format version (1). |
| `data_version` | The data release the proxy was running. |
| `unresolved[]` | `name`, `status` and `detail` (why it did not resolve), `count`, `firstSeen`, `lastSeen`. The 500 most recent distinct names. |
| `assisted[]` | `work`, `count`, `examples` (release names) and `mapping`, the TVDB numbering derived from Sonarr, shaped like a `data/works/` override. |

`export.txt` is one release name per line: the unresolved names, then the examples of assisted works. Use it when you only want names.

## The maintenance loop

1. Collect `export.json` files from proxies, or take the block from a report issue and save the table's names to a text file.
2. `pnpm corpus:from-proxy export.json` (several files are fine), or `pnpm corpus:import names.txt` for a plain list. Each new name becomes an unverified case in `tests/releases.yaml` with what the resolver answers today. Names already present are skipped.
3. Verify each case: set `expect` to the honest answer (a work and episode, or `ambiguous`, or `unmatched`) and `verified: true`. Only verified cases count toward the pass rate.
4. Fix what the cases show. A name that should resolve usually needs an alias or a mapping in `data/works/`; see [Contributing mappings](/contributing/). For assisted works, check the derived override on TVDB, then add it as a file.
5. `pnpm corpus`. The pass rate must not drop. After an improvement, `pnpm corpus --update-baseline` records the new baseline. Commit the cases, the fixes and the baseline together.
6. Close the report issue with a link to the pull request.
