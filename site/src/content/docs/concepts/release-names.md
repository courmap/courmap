---
title: Resolving release names
description: Parse, match, interpret, score.
sidebar:
  order: 5
---

Resolving turns a release name into a [work](/concepts/works/) and an episode. Every answer carries a confidence and a reason, so a wrong answer can be debugged from the response alone.

1. **Parse.** The parser pulls out the group, title, season or part token, episode (a single number, a range, or a version like `05v2`), year, resolution, source, codec and flags. `[SubsPlease] Spy x Family - 17 (1080p)` gives group `SubsPlease`, title `Spy x Family`, episode 17.
2. **Normalize the title** the same way every alias was normalized: lowercase, accents and punctuation folded, `×` read as `x`, filler words (`the`, `season`, `part`, `cour`) dropped.
3. **Match.** Look the title up in the alias index (every title and synonym of every work). A year the parser took out of the title is tried as part of it too, since remakes carry it ("Doraemon (2005)"). With no exact hit, a trigram search finds near spellings. An alias several works share splits its weight between them.
4. **Interpret the number** for each candidate: a [group override](/concepts/group-overrides/) first; then a season token read as a TVDB season (for a long-runner, S02E70 is not episode 70); then a number within the work's own count; then a number past it, walked through the work's [absolute sequence](/concepts/absolute-sequences/).
5. **Score.** Evidence multiplies season fit, episode fit and year fit; a tie-breaker that disagrees scores 0.05. A sequel with no season token is penalized only when the matched alias is shared with an earlier work of its chain. Title rank (a work that holds the title beats works that only list it as a synonym)  and type (TV and movies over OVAs and ONAs, over specials) break remaining ties, but never overturn other evidence.

The answer is `ok` only at 0.85 or more with a lead of at least 0.1. Otherwise it is `ambiguous`, with every candidate, or `unmatched`. Courmap never returns a low-confidence guess as ok: tools decide what to do with an ambiguous answer, and the Sonarr proxy passes such releases through unchanged.

A corpus of release names with known answers runs in CI on every change, and the pass rate may never drop.
