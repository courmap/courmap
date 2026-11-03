---
title: Changelog
description: Notable changes to Courmap's data format, library and tools.
---

Weekly data releases are listed on [GitHub Releases](https://github.com/courmap/courmap/releases). This page records changes to formats and tools.

## Proxy 0.1.0

First release of the Sonarr proxy, `ghcr.io/courmap/proxy:0.1.0` (also `:latest`), for amd64 and arm64.

- **What it does.** Sits between Prowlarr (or your indexers) and Sonarr and rewrites anime release names into the numbering Sonarr understands, and translates Sonarr's searches into the names indexers know. Works with Torznab (torrents) and Newznab (usenet) feeds, set per indexer or detected from the feed.
- **Series reload on a miss.** When a release or a search needs a show that is not in the proxy's Sonarr series list, it reloads the list (at most once a minute). A search is translated straight away; an RSS release that arrives first passes through unchanged and the next one is rewritten.
- **Indexer API limits.** A cache for identical queries, early stop on episode searches, and a cap on queries per search keep request counts low. The status page shows requests per indexer for the last seven UTC days, with cache hits and failures. When an indexer reports its limit, the proxy passes the answer to Sonarr unchanged and does not retry.
- **Secret redaction.** API keys (Sonarr's, an indexer's, any `apikey=` in a feed address) never reach the logs, the status page or the exports.
- **Status page and exports.** `http://<your-host>:9797/` shows the data version, the Sonarr connection, per-indexer counts, the works numbered with Sonarr's help and the release names that could not be resolved, with a block you can paste into a GitHub issue.
- **Known limits.** Sonarr only (no Radarr). Ambiguous releases pass through unchanged rather than being guessed. The unresolved and assisted lists, and so the export, hold at most 500 names each.

## 2026-11-02

- **`@courmap/client`, `@courmap/core` and `@courmap/parser` 0.1.2.** The client now depends on `better-sqlite3` 13, which ships prebuilt binaries: `npm install @courmap/client` and `pnpm add @courmap/client` work without build scripts or build tools (0.1.1 needed `pnpm approve-builds`, or a compiler, to open a dump with pnpm).
- **Parser**: streaming-service and scene language tags, `1x12`, `Season.1`, Dual Audio, `DD+`, `V2` and `ESub` are metadata, not title; a glued season may be followed by more tags (`Dan Da Dan-S02-1080p`); `Ep-05` and `Title-05-[tags]` read as episodes; slashes in brackets, a year before the season, an episode before the resolution and a leading `Hi10` are handled; titles ending in a number before a resolution keep it.
- **Resolve**: with a season token, a release year may be that of the work the episode lands in or of the series' first season; a release posted after a remake premiered favors the remake when the title is the only tie (Cat's Eye 1983 and 2025).

## 2026-10-19

- **First data release**, `data-2026.43`: 32,833 works, with the SQLite and JSON dumps, `meta.json` and checksums on GitHub Releases.
- **The alias index is split** into `aliases/<prefix>.json` files plus a trigram set, replacing `aliases.json.zst`; a first remote resolve downloads a few files instead of the whole index.
- **Sonarr proxy** `ghcr.io/courmap/proxy` for amd64 and arm64: rewrites anime releases between Prowlarr and Sonarr, translates searches, and keeps a local list of names it could not resolve.
- **Lookup** returns `prequel_origin` for each work.
- **Resolve**: a year in the release name is tried as part of the title ("Doraemon (2005)"), and a sequel without a season token is penalized only when the matched title is shared with an earlier work of its chain.

## 2026-10-18

- **Dump schema 4**: the unused full-text trigram table is gone; the gzipped dump went from 38 MB to 22 MB.
- **Resolve**: title rank and type break ties between works sharing a title.
- **Browser entry** `@courmap/client/remote` with no Node-only code.
