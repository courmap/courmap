---
title: Contributing mappings
description: Step-by-step mapping fixes, with worked examples for the hard cases.
---

Mappings are YAML files in [`data/`](https://github.com/courmap/courmap/tree/main/data). A pull request with one file fixes one show for everyone. Every field is listed in the [data format reference](/reference/data-format/); this page shows how to use them.

## The rules that matter

- **Seeds and overrides.** About 33,000 [works](/concepts/works/) come from seed data in `data/seeds/` (never edit it). To fix one, add `data/works/<id>.yaml` with the same `id` and only the parts that change: an `ids.<provider>` key or a `projections.<provider>` block replaces the seed's, any other key you set wins, `aliases` are added to the seed's, and `null` removes a seed value.
- **Slugs are permanent.** A work's id never changes once published. A new work's id is its romaji title in lowercase kebab-case.
- **Never guess an ID.** Use IDs you can see on the provider's site, and link them in `sources:`.
- **Check before pushing.** `pnpm validate` runs every check CI runs on the data and names the file, line and fix for each problem.

## A split cour

AniDB and AniList split a season in two; TVDB keeps one season. Each half is its own work, and the second half's TVDB [projection](/concepts/projections/) starts after the first:

```yaml
id: spy-x-family-part-2
projections:
  tvdb_show:
    - { season: 1, episodes: 1-13, start: 13 }   # canonical 1-13 are S01E13-E25
prequel: spy-x-family
```

If fansubs number the second half continuously (13, 14, ...), add an [absolute sequence](/concepts/absolute-sequences/) in `data/sequences/`:

```yaml
id: spy-x-family-absolute
members:
  - { work: spy-x-family, episodes: 1-12, absolute_start: 1 }
  - { work: spy-x-family-part-2, episodes: 1-13, absolute_start: 13 }
```

## Specials

Specials are canonical episodes `S1`, `S2` and so on, numbered as AniDB numbers them. Map them to TVDB season 0 with `kind: special`:

```yaml
id: shingeki-no-kyojin
projections:
  tvdb_show:
    - { season: 1, episodes: 1-25 }
    - { kind: special, season: 0, episodes: S1-S6 }
    - { kind: special, season: 0, episodes: S7-S10, start: 8 }
```

One canonical episode that a provider shows as two uses `target`:

```yaml
id: example-show
projections:
  tvdb_show:
    - { season: 1, episodes: 1-11 }
    - { season: 1, episodes: 12, target: 12-13 }   # the double-length finale is S01E12 and E13
notes: placeholder IDs, verify before release
```

## A long-runner

A show that is still airing has `status: airing`, `episodes: null`, and an open-ended last range that grows as episodes air:

```yaml
id: example-long-runner
status: airing
episodes: null
projections:
  tvdb_show:
    - { season: 1, episodes: 1-61 }
    - { season: 2, episodes: 62-77, start: 1 }
    - { season: 21, episodes: 892-, start: 1 }   # open-ended
notes: placeholder IDs, verify before release
```

## A release group with its own numbering

```yaml
# data/groups/examplesubs.yaml
id: examplesubs
aliases: [ExampleSubs, ExSubs]
overrides:
  - { work: example-show-part-2, numbering: continue_prequel }
sources:
  - https://example.com/a-release-showing-the-numbering
notes: placeholder group, verify before release
```

Link releases that show the quirk in `sources:`. See [group overrides](/concepts/group-overrides/) for the three kinds of numbering.

## Reading the checks on your pull request

- **validate** runs the same checks as `pnpm validate`, plus round trips: every episode translated to each provider and back must return itself.
- The **resolver corpus** comment shows the pass rate on real [release names](/concepts/release-names/) before and after your change. It must not drop, and no name expected to be ambiguous may come back as ok.
- Bot pull requests (labeled `auto` or `needs-review`) include a diff of which works' prequels or absolute numbers change; see [how automation works](/automation/).
