---
title: FAQ
description: Common questions about Courmap.
---

**Is Courmap a metadata provider?**
No. It has no synopses, images, staff or ratings. It maps IDs and episode numbers; fetch everything else from the providers themselves.

**How is this different from TheXEM?**
TheXEM maps scene numbering to TVDB for Sonarr. Courmap maps every provider (AniDB, AniList, MAL, Kitsu, TVDB, TMDB, IMDb and [absolute numbering](/concepts/absolute-sequences/)) to one canonical [work](/concepts/works/), resolves [release names](/concepts/release-names/), and publishes everything as open data and a library. The Sonarr proxy uses Sonarr's own scene numbering where TheXEM provides it.

**How is it different from Anime-Lists and anime-offline-database?**
Courmap builds on both: anime-offline-database supplies the IDs, titles and synonyms, and Anime-Lists the TVDB and TMDB episode offsets. Courmap joins them, adds hand-written corrections and absolute sequences, checks that every episode translates and round-trips, and adds release-name resolution.

**Does it call the AniDB API?**
Never. AniDB IDs appear as facts; AniDB titles are not redistributed.

**What happens when Courmap is unsure?**
It says so. A release name that could be two works comes back `ambiguous` with both candidates and their scores, never as a confident guess. The Sonarr proxy passes such releases through unchanged.

**How fresh is the data?**
A new data release comes out every week. Airing shows are tracked daily by the bots, and their updates ship in the next weekly release.

**Is there an API server?**
Not one you need. Everything is published as files, and the library does the work locally. A small optional HTTP API for quick experiments may follow.

**Something is mapped wrong. What do I do?**
Open an issue with the release name or IDs, or fix it yourself in a small pull request; see [for contributors](/getting-started/contributing/).
