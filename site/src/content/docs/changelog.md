---
title: Changelog
description: Notable changes to Courmap's data format, library and tools.
---

Weekly data releases are listed on [GitHub Releases](https://github.com/courmap/courmap/releases). This page records changes to formats and tools.

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
