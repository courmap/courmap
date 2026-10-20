---
title: Licensing and attribution
description: What you may do with Courmap's code and data, and the sources it builds on.
---

## Code

The code (the client library, builder, proxy and every other package) is licensed under the [Apache License 2.0](https://github.com/courmap/courmap/blob/main/LICENSE). You can embed it in open-source and commercial projects, including GPL and AGPL ones.

## Data

Everything in `data/` and every published dump and shard is licensed under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (the database) and the [Database Contents License 1.0](https://opendatacommons.org/licenses/dbcl/1-0/) (its contents); see [`DATA_LICENSE`](https://github.com/courmap/courmap/blob/main/DATA_LICENSE). In short:

- You may use, share and adapt the data, including commercially.
- Credit Courmap and the sources below.
- If you publish an adapted database, share it under the ODbL too.

Contributions to `data/` are accepted under the same license.

## Sources

- **[anime-offline-database](https://github.com/cedya77/anime-offline-database)** by cedya77, continuing [manami-project's](https://github.com/manami-project/anime-offline-database) original: IDs across providers, titles and synonyms. ODbL 1.0 and DbCL 1.0.
- **[Anime-Lists](https://github.com/Anime-Lists/anime-lists)**: AniDB to TVDB and TMDB IDs, season and episode offsets. Every row from it carries `origin: anime-lists`, so it can be removed cleanly if its maintainers ever ask.
- **AniList**: airing status, episode counts and sequel relations read by the bots, used for detection; no AniList titles are stored.
- **TMDB**: season episode counts read in CI to check mappings; nothing from the TMDB API is stored or published. This product uses the TMDB API but is not endorsed or certified by TMDB.
- **AniDB**: IDs appear as facts. Courmap never calls the AniDB API and never redistributes AniDB titles.

The full list is in [`ATTRIBUTION.md`](https://github.com/courmap/courmap/blob/main/ATTRIBUTION.md), which ships with every data release.
