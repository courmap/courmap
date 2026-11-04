---
title: Fix a mapping
description: Fix a wrong mapping once, for everyone, with a small YAML pull request.
sidebar:
  order: 5
---

A wrong mapping is wrong for everyone, so a fix helps everyone. Every mapping lives in [`data/`](https://github.com/courmap/courmap/tree/main/data) on GitHub. Most [works](/concepts/works/) come from seed datasets; when one is wrong, you add a short file in `data/works/` that overrides just the part that is wrong. CI checks it, and it ships in the next weekly data release.

## How to contribute

1. **Fork** the repository on GitHub (the Fork button, top right).
2. **Make a branch** in your fork.
3. **Change one file**, usually one short YAML file in `data/works/`.
4. **Open a pull request** against `courmap/courmap`.

The first time you contribute, the automated checks wait for a maintainer to approve them; Xwolv or another maintainer does that, usually soon, and later pull requests from you run straight away. Nothing is wrong if the checks show as waiting.

A one-file data fix needs no clone and no Node install. Open the file under [`data/works/`](https://github.com/courmap/courmap/tree/main/data/works) on GitHub and click the pencil icon ("Edit this file"); GitHub forks the repository for you and walks you through the pull request. To add a new file, use "Add file" then "Create new file" in the same folder. To fix a typo or a sentence in these docs, use the "Edit page" link at the bottom of any page. Running `pnpm validate` first (steps below) is still the quickest way to catch a mistake, but CI runs the same checks on your pull request.

## 1. Find the work

Every work has a permanent id (its slug), derived from its romaji title, such as `kusuriya-no-hitorigoto-2nd-season`. Find it with the [try-it box](/try/), or in `data/seeds/slugs.jsonl` by AniDB, AniList or MAL ID.

## 2. Write the fix

Create `data/works/<id>.yaml` with the id and only what changes. (You need Node 22 or later and [pnpm](https://pnpm.io/); clone the repository first.) For example, if TMDB numbers a sequel as a continuation of season 1:

```yaml
id: kusuriya-no-hitorigoto-2nd-season
projections:
  tmdb_show:
    - { season: 1, episodes: 1-24, start: 25 }
sources:
  - https://www.themoviedb.org/tv/220542/season/1
```

This replaces the seed's TMDB block and keeps everything else from the seed. `sources` links whatever justifies the mapping.

## 3. Check it locally

```sh
pnpm install
pnpm validate
```

`pnpm validate` checks the schema, overlapping and missing episodes, episode counts, and that every episode translates to every provider and back. The error messages name the file, line and fix.

## 4. Open a pull request

CI runs the same checks and comments with the resolver corpus pass rate. A maintainer reviews it; once merged, it ships in the next weekly release.

That is the whole loop. For the hard cases (split cours, specials, long-runners, release groups with their own numbering) see [Contributing mappings](/contributing/), and for the rules every file follows see the [data format](/reference/data-format/). Looking for something to fix? [Fixing open issues](/fixing-issues/) explains each kind of bot-opened issue.
