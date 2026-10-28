---
title: 'Library guide: remote and offline'
description: Which mode of @courmap/client to use, and how each one behaves.
sidebar:
  order: 2
---

Pick the mode that fits where your code runs. New to the library? Start with the [Library quickstart](/getting-started/library/). `@courmap/client` gives the same answers in every mode: every call runs the same engine over a `Dataset`, and a conformance suite in CI checks that the modes agree. Only where the data comes from differs.

| | Offline | Remote |
| --- | --- | --- |
| Create | `createOfflineClient('courmap.sqlite')` | `createRemoteClient()` |
| Data | The weekly SQLite dump, downloaded once | Static JSON files, fetched on demand |
| Network per call | None | Only files not yet cached |
| Runs in | Node | Node, browsers, Workers (`@courmap/client/remote`) |
| Best for | PVRs, bulk jobs, anything resolving many names | Browsers, occasional lookups, small tools |

## Calls

| Call | Answers |
| --- | --- |
| `lookup(ref)` | The [work](/concepts/works/) a provider ID points at, with every ID, [projection](/concepts/projections/), sequence membership, title and alias. |
| `translate(ref, episode, targets)` | One episode in every requested numbering. Targets are provider names or `absolute`. |
| `resolve(releaseName)` | A [release name](/concepts/release-names/) to a work and episode, with confidence, reason and runners-up. |
| `search(query)` | Works whose titles or aliases match, best first. |
| `meta()` | The data version and build information. |

Refs look like `anilist:142838`, `anidb:17061`, `tvdb_show:405920:s1` (season-based providers take a season), `tmdb_movie:372058`, `imdb:tt5311514`, `work:sousou-no-frieren` or `absolute:spy-x-family-absolute`.

```ts
import { createOfflineClient } from '@courmap/client';

const courmap = createOfflineClient('courmap.sqlite');
const back = await courmap.translate('tvdb_show:405920:s1', 17, ['anilist', 'absolute']);
console.log(back.work); // { id: 'spy-x-family-part-2', episode: 5, kind: 'regular' }
console.log(back.results.anilist); // { id: '142838', episode: 5 }
courmap.close();
```

## Errors

`lookup` and `translate` throw a `CourmapError` with a `code`:

- `not_found`: an unknown ID, or an episode no work maps.
- `invalid_input`: a malformed ref or episode, a missing season scope, or an episode past the work's count.
- `ambiguous`: the ref matches several works (for example a TVDB season two cours share); `candidates` lists them.

A translation that maps some targets but not others is not an error: `status` is `unmapped`, the mapped targets are in `results`, and the rest are listed in `unmapped`. `resolve` never throws for an unknown name; it answers `ambiguous` or `unmatched`.

## Offline mode

Download the dump from the [latest data release](https://github.com/courmap/courmap/releases/latest), verify it and unpack it:

```sh
curl -LO https://github.com/courmap/courmap/releases/latest/download/SHA256SUMS
curl -LO https://github.com/courmap/courmap/releases/latest/download/meta.json
```

`meta.json` names the dump of that release and its SHA-256 (`dumps.sqlite.url`, `dumps.sqlite.sha256`); after downloading it, `sha256sum -c SHA256SUMS --ignore-missing` checks it, and `gunzip` unpacks it. A new release comes out weekly; check `meta.json` and download only when `data_version` changes.

## Remote mode

`createRemoteClient(baseUrl, options)` reads the static files at `baseUrl` (by default `https://data.courmap.com/v1/`). It reads `meta.json` at most hourly and caches every other file by data version, in memory; in Node, `{ cacheDir }` also caches on disk. A resolve fetches `meta.json`, one alias shard for the title, the release groups list and the works it matches, usually 60 to 160 KB before compression. `fetch` and a clock can be passed in for tests.
