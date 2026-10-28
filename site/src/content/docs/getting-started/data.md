---
title: Use the data
description: 'Read Courmap''s data without the library: the HTTP API with curl, the static JSON files, or the SQLite dump from Python.'
sidebar:
  order: 4
---

You do not need the library to use Courmap. The same data is available three ways, from lightest to heaviest. Pick the one that fits.

| You want | Use | Needs |
| --- | --- | --- |
| A quick answer, or a script in any language | The [HTTP API](#the-http-api) | `curl` |
| One work or one ID lookup, cached by your own tool | The [static files](#the-static-files) | An HTTP client |
| Thousands of lookups, or a database of your own | The [dump](#the-dump) | Any SQLite reader |

## The HTTP API

`https://api.courmap.com` is a convenience API over the static files. It runs the same code as the library, so its answers are the library's answers. It is optional: if it is ever switched off, the files, the dumps and the library keep working. Its uptime is on [status.courmap.com](https://status.courmap.com).

Translate episode 5 of AniList 142838 into TVDB and absolute numbering:

```sh
curl "https://api.courmap.com/v1/translate?from=anilist:142838&episode=5&to=tvdb_show,absolute"
```

```json
{"data_version":"2026.44","status":"ok","input":{"ref":"anilist:142838","episode":5},"work":{"id":"spy-x-family-part-2","episode":5,"kind":"regular"},"results":{"tvdb_show":{"id":"405920","season":1,"episode":17},"absolute":{"sequence":"spy-x-family-absolute","episode":17}},"unmapped":[]}
```

Resolve a release name (let `curl` encode it):

```sh
curl -G "https://api.courmap.com/v1/resolve" --data-urlencode "release=[SubsPlease] Spy x Family - 17 (1080p)"
```

The answer has `status` (`ok`, `ambiguous` or `unmatched`), `match` (the work, episode, confidence and reason) and `candidates`. For this name the status is `ok`, the work is `spy-x-family-part-2` and the episode is 5.

| Request | Answer |
| --- | --- |
| `GET /v1/meta` | Data version and build information |
| `GET /v1/lookup?ref=anilist:142838` | The work |
| `GET /v1/translate?from=anilist:142838&episode=5&to=tvdb_show,absolute` | One episode in other numberings |
| `POST /v1/translate` with `{ "items": [{ "ref", "episode", "targets" }] }` | Up to 100 translations; errors per item |
| `GET /v1/resolve?release=...` | A release name resolved |
| `POST /v1/resolve` with `{ "releases": ["..."] }` | Up to 25 release names |
| `GET /v1/search?q=frieren&limit=10` | Works by title |

**Errors** are JSON with `code`, `message` and sometimes `field` or `candidates`, and an HTTP status of 400 (`invalid_input`), 404 (`not_found`) or 409 (`ambiguous`):

```sh
curl -i "https://api.courmap.com/v1/lookup?ref=anilist:99999999"
# HTTP 404
# {"code":"not_found","message":"no work has anilist:99999999","field":"ref"}
```

**Limits.** Each client may make 60 requests a minute; past that the API answers HTTP 429 with a `Retry-After` header. Every response allows any origin, so browsers can call it directly. Anything heavier belongs in the [library](/getting-started/library/) or the [dump](#the-dump).

## The static files

The data is also published as small JSON files at `https://data.courmap.com/v1/`. They are plain files behind a CDN, so you can fetch them from any language and cache them yourself.

```sh
curl https://data.courmap.com/v1/meta.json                      # data version and counts
curl https://data.courmap.com/v1/works/spy-x-family-part-2.json  # one work
```

The work file lists the work's provider IDs, titles and [projections](/concepts/projections/). Fetch `meta.json` at most hourly and refetch other files only when its `data_version` changes. [Static files and dumps](/reference/static-files/) lists every path and the caching contract.

## The dump

For bulk work, download the weekly SQLite dump from the [latest data release](https://github.com/courmap/courmap/releases/latest). The file name carries the version, so ask `meta.json` for the address (this uses `curl` and `jq`):

```sh
url=$(curl -sL https://github.com/courmap/courmap/releases/latest/download/meta.json | jq -r .dumps.sqlite.url)
curl -sL "$url" | gunzip > courmap.sqlite
```

Then read it with any SQLite library. In Python, find the work for AniList 142838 and where its episodes land in TVDB:

```python
import sqlite3

db = sqlite3.connect("courmap.sqlite")

work_id, title = db.execute(
    "SELECT w.id, w.title_romaji FROM works w JOIN provider_refs r ON r.work_id = w.id "
    "WHERE r.provider = 'anilist' AND r.provider_id = '142838'"
).fetchone()
print(work_id, title)  # spy-x-family-part-2 Spy x Family Part 2

for ep_from, ep_to, season, start in db.execute(
    "SELECT ep_from, ep_to, season, target_from FROM projections WHERE work_id = ? AND provider = 'tvdb_show'",
    (work_id,),
):
    print(f"episodes {ep_from}-{ep_to} are TVDB season {season} from episode {start}")
    # episodes 1-13 are TVDB season 1 from episode 13
```

The dump holds every work, provider ID, projection, sequence, alias and release group. To translate rather than read, use the [library](/getting-started/library/) over the same file: it applies the projections and sequences for you. [Static files and dumps](/reference/static-files/) has the checksums and the JSON dump.
