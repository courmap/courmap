# Attribution

Courmap's mapping data builds on the work of these projects. Thank you.

## cedya77/anime-offline-database

https://github.com/cedya77/anime-offline-database

Cross-provider ID backbone (MAL, AniList, AniDB, Kitsu and more), titles and synonyms. Licensed under the Open Database License (ODbL) v1.0 with contents under the Database Contents License (DbCL) v1.0. Data derived from it is redistributed under the same terms (see DATA_LICENSE).

## manami-project/anime-offline-database

https://github.com/manami-project/anime-offline-database

The original dataset that cedya77/anime-offline-database continues. Archived on 2026-07-04. Licensed under ODbL v1.0 and DbCL v1.0.

## Anime-Lists/anime-lists

https://github.com/Anime-Lists/anime-lists

AniDB to TVDB and TMDB ID mappings, season and episode offsets, specials and per-episode mapping lists. Rows derived from it carry `origin: anime-lists` so they can be identified and removed by source.

## TMDB

This product uses the TMDB API but is not endorsed or certified by TMDB.

The API is used only in CI, to check that our TMDB season and episode counts agree with TMDB's. Nothing from it is stored in this repository or in any dump; the TMDB IDs and offsets in the data come from Anime-Lists.

## Identifiers

AniDB, AniList, MyAnimeList, Kitsu, TheTVDB, TMDB and IMDb IDs are referenced as facts to link to those services. Courmap does not redistribute their metadata. AniDB titles are not included in this repository or its dumps.
