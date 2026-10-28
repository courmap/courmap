---
title: What is Courmap?
description: The problem Courmap solves, the three ways to use it, and where to go next.
sidebar:
  order: 1
---

Every anime tool has to answer the same question: which episode is this? A fansub release says "episode 17", AniList says "Part 2, episode 5", and TVDB says "S01E17". They all mean the same episode. Courmap is the translation between them, published as open data so nobody has to rebuild it.

Courmap covers AniDB, AniList, MyAnimeList, Kitsu, TVDB, TMDB, IMDb and absolute (fansub) numbering. The name comes from "cour", one broadcast season of an anime, usually about 12 episodes. Anime often come in several cours, and each provider decides differently whether they are one entry or several.

## The four parts

- **The Sonarr proxy** is a Docker container that sits between Prowlarr and Sonarr. It reads the name of each anime release, works out which episode it is, and rewrites the ones it is sure about into the numbering Sonarr understands. Start with the [Sonarr quickstart](/getting-started/sonarr/).
- **The library**, `@courmap/client`, answers three questions in your own code: what is this ID, what is this episode in every other numbering, and which show and episode is this release name. Start with the [Library quickstart](/getting-started/library/).
- **The HTTP API** at `api.courmap.com` answers lookup, translate, resolve and search with `curl`, for scripts in any language. It is a convenience over the data below, limited to 60 requests a minute. See [Use the data](/getting-started/data/).
- **The data** is a public set of YAML files, built into weekly SQLite and JSON dumps and small static JSON files. Most of it is seeded from other open datasets and corrected by pull request. If something is mapped wrong, [fix a mapping](/getting-started/contributing/).

Courmap never guesses silently. When it is not sure, it says so, and the Sonarr proxy then leaves the release exactly as it was.

## Learn the vocabulary

You do not need the concepts to use Courmap. When you want to know why it behaves as it does, the [glossary](/concepts/glossary/) defines each term in a sentence or two, and the concept pages explain [works](/concepts/works/), [projections](/concepts/projections/), [absolute sequences](/concepts/absolute-sequences/), [group overrides](/concepts/group-overrides/) and [how release names are resolved](/concepts/release-names/).

## What it is not

Courmap is not a metadata provider. It has no synopses, images, staff or ratings, only IDs and episode numbers. It does not replace TheXEM for scene numbering; see the [FAQ](/faq/) for how the two differ.
