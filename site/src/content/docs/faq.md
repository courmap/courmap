---
title: FAQ
description: Common questions about Courmap.
---

**Is Courmap a metadata provider?**
No. It has no synopses, images, staff or ratings. It maps IDs and episode numbers; fetch everything else from the providers themselves.

**How is this different from TheXEM?**
TheXEM maps scene numbering to TVDB for Sonarr. Courmap maps every provider (AniDB, AniList, MAL, Kitsu, TVDB, TMDB, IMDb and [absolute numbering](/concepts/absolute-sequences/)) to one canonical [work](/concepts/works/), resolves [release names](/concepts/release-names/), and publishes everything as open data and a library. The Sonarr proxy uses Sonarr's own scene numbering (TheXEM's, where Sonarr uses it) for the series that have it, so the two work together rather than compete.

**How is it different from Anime-Lists and anime-offline-database?**
Courmap builds on both: anime-offline-database supplies the IDs, titles and synonyms, and Anime-Lists the TVDB and TMDB episode offsets. Courmap joins them, adds hand-written corrections and absolute sequences, checks that every episode translates and round-trips, and adds release-name resolution.

**Does it call the AniDB API?**
Never. AniDB IDs appear as facts; AniDB titles are not redistributed.

**What happens when Courmap is unsure?**
It says so. A release name that could be two works comes back `ambiguous` with both candidates and their scores, never as a confident guess. The Sonarr proxy passes such releases through unchanged.

**How fresh is the data?**
A new data release comes out every week. Airing shows are tracked daily by the bots, and their updates ship in the next weekly release.

**Is Courmap down?**
Check [the status page](https://status.courmap.com), which watches the data files, the API and the docs. An outage is rarely a problem for you: the Sonarr proxy keeps working on the last data it downloaded, and the library's offline mode (a local dump) needs no network at all. Only fetching a newer data release, the remote library mode and `api.courmap.com` need the network.

**Is there an API server?**
Yes, an optional one. `api.courmap.com` is a convenience HTTP API with lookup, translate, resolve and search, limited to 60 requests a minute per client. Heavier use should go to the library or the dumps, which need no server at all: everything is published as files, and the library does the work locally. See [Use the data](/getting-started/data/#the-http-api) for examples.

**Does it work with Radarr?**
The Sonarr proxy does not. It reads your Sonarr series list and writes `SxxEyy` titles, which is how Sonarr reads episodes, so it is for Sonarr only. The data does cover anime films, though. A film is a [work](/concepts/works/) of type movie, and many of them carry a `tmdb_movie` and an `imdb` ID (not every film has both yet). The library and the HTTP API resolve a film's release name to its work, with those IDs in the answer, and translate a `tmdb_movie` or `imdb` ref to the film's AniList, MAL, AniDB and other IDs. A film release resolves to its work with no episode number. If you build a Radarr tool, use the [library or the API](/getting-started/data/) for the lookup.

**Something is mapped wrong. What do I do?**
Open an issue with the release name or IDs, or fix it yourself in a small pull request; see [Fix a mapping](/getting-started/contributing/).
