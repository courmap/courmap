---
title: Glossary
description: Every Courmap term in a sentence or two, with a link to the full page where there is one.
sidebar:
  order: 0
---

## Absolute numbering

Counting a show's episodes straight through from 1, with no seasons, the way most fansub groups do. See [absolute sequence](#absolute-sequence).

## Absolute sequence

An ordered chain of [works](#work) numbered continuously, so the second cour starts at 13 instead of 1. It is how Courmap reads "Spy x Family - 17" as the fifth episode of Part 2. See [Absolute sequences](/concepts/absolute-sequences/).

## Ambiguous

An answer Courmap will not commit to: the release name could be two or more works, so it returns every candidate with its score instead of picking one. The Sonarr proxy passes ambiguous releases through unchanged. See [Resolving release names](/concepts/release-names/).

## Cour

One broadcast season of an anime, usually about 12 episodes. A show with two cours airs for two seasons in a row.

## Data release

A weekly snapshot of the data, tagged `data-<year>.<week>` on GitHub Releases, such as `data-2026.44`. It carries the [dumps](#dump) and a `meta.json` with the version. See [Static files and dumps](/reference/static-files/).

## Dump

The whole dataset as one file: a SQLite file for offline use and a JSON file for everything else, both gzip-compressed. The library's offline mode and the Sonarr proxy read the SQLite dump. See [Static files and dumps](/reference/static-files/).

## Group override

A note that one release group numbers a particular show its own way, so the resolver reads that group's episode numbers accordingly. See [Group overrides](/concepts/group-overrides/).

## Projection

Where a [work](#work)'s episodes land in a provider that uses seasons, such as TVDB or TMDB: which season, and which episode numbers. See [Projections](/concepts/projections/).

## Release name

The file or torrent name a group gives a release, such as `[SubsPlease] Spy x Family - 17 (1080p)`. Courmap turns it into a work and an episode. See [Resolving release names](/concepts/release-names/).

## Resolve

To turn a [release name](#release-name) into a [work](#work) and an episode, with a confidence score and a reason. In the library, `resolve(releaseName)`. See [Resolving release names](/concepts/release-names/).

## Shard

One small JSON file from the static copy of the data, such as a single work or one slice of the title index. The remote client fetches only the shards a call needs. See [Static files and dumps](/reference/static-files/).

## Torznab and Newznab

The search formats that indexers speak to apps like Sonarr: Torznab for torrents and Newznab for usenet. The Sonarr proxy reads and serves both. See the [Sonarr quickstart](/getting-started/sonarr/).

## Translate

To convert one episode from one numbering to others, for example AniList episode 5 of a work to TVDB S01E17. In the library, `translate(ref, episode, targets)`. See [Library: remote vs offline](/guides/library/).

## Work

Courmap's basic unit: usually one cour, one film or one OVA, at the finest split any provider uses. Every provider's entry maps to a work, never directly to another provider. See [Works](/concepts/works/).
