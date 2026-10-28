---
title: Static files and dumps
description: Every published file, the caching contract and checksum verification.
---

Courmap publishes everything as files. There is no server to run.

## Weekly data releases

Each weekly release is tagged `data-<version>` on [GitHub Releases](https://github.com/courmap/courmap/releases), where `<version>` is the ISO year and week (`2026.43`). The newest one is marked latest, so `https://github.com/courmap/courmap/releases/latest/download/<file>` always [works](/concepts/works/).

| File | Contents |
| --- | --- |
| `courmap-<version>.sqlite.gz` | The SQLite dump: every work, provider ID, [projection](/concepts/projections/), sequence, alias and group. What offline mode and the Sonarr proxy read. |
| `courmap-<version>.json.gz` | The same data as JSON: `meta`, `works`, `sequences`, `groups`. |
| `meta.json` | The data version, build information, counts, and `dumps`: this release's tag and each dump's URL and SHA-256. |
| `SHA256SUMS` | Checksums of every other file, in `sha256sum -c` format. |
| `DATA_LICENSE` | ODbL 1.0 and DbCL 1.0, the license of the data. |
| `LICENSE` | Apache-2.0, the license of the code. |
| `ATTRIBUTION.md` | The sources the data builds on. |

Dumps are gzip, so any language can open them. Verify a download with:

```sh
sha256sum -c SHA256SUMS --ignore-missing
```

## Static shards

The same data, split into small JSON files for remote mode, under `https://data.courmap.com/v1/`:

| Path | Contents |
| --- | --- |
| `/v1/meta.json` | The data version, build information, counts and dump links. |
| `/v1/works/<id>.json` | One work: exactly the record `lookup` returns, without `data_version`. |
| `/v1/refs/<provider>/<shard>.json` | Provider ID to the sorted list of work ids. `shard` is the ID divided by 1000, rounded down; IMDb IDs use the digits after `tt`. |
| `/v1/sequences/<id>.json` | One [absolute sequence](/concepts/absolute-sequences/). |
| `/v1/groups/<id>.json` | One release group. |
| `/v1/groups.json` | Every release group, for resolvers. |
| `/v1/aliases/<prefix>.json` | The alias index, split by the first two characters of each normalized alias: `[[alias, [work ids]], ...]`. Letters a-z and digits stay as they are; any other character becomes `_` and six hex digits. |
| `/v1/aliases/grams/<0-255>.json` | The trigram set for fuzzy title matching: `{ trigram: [prefixes] }`. |

## Caching contract

- `meta.json` is served with `Cache-Control: max-age=300`.
- Every other file is immutable within a data version and served with `max-age=3600, stale-while-revalidate=86400`. A new version overwrites the files, and `meta.json` is written last, so a client never sees a half-published version.
- Clients poll `meta.json` at most hourly and refetch other files only when `data_version` changes.
- Every file allows cross-origin `GET` and `HEAD`, so browsers can read the data from any site.
