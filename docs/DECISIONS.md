# Decisions

Choices made where `docs/SPEC.md` was ambiguous, silent or seemed wrong. One entry per decision, with a one-line rationale. Newest entries at the bottom of each section.

## Repository and tooling

- **Brand asset names.** `assets/` holds `logo.svg` and `courmap-banner.png`, not the `logo.png` / `banner.png` the spec names; the README uses `courmap-banner.png`. Rationale: use the files that exist and leave renaming to the asset owner.
- **Source export condition.** Workspace packages export `src/*.ts` under a custom `@courmap/source` condition used by tsx, Vitest and tsc. Rationale: no build step in the dev, test or CI loop, while `dist/` stays the published entry point.
- **Unbuilt packages are README stubs.** `packages/parser`, `seed`, `bots`, `proxy` and `worker/` contain only a README until their build step. Rationale: matches the layout without shipping empty packages that would need versioning.
- **One DATA_LICENSE file.** It contains the full ODbL 1.0 text followed by the full DbCL 1.0 text. Rationale: the spec names a single file for both licenses.
- **CI runs on Node 22.** Local development works on Node 22 or later. Rationale: the spec targets Node 22 LTS as the floor, so CI tests the floor.
