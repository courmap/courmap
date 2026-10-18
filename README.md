![Courmap](assets/courmap-banner.png)

# Courmap

Courmap maps anime episode numbering across AniDB, AniList, MAL, Kitsu, TVDB, TMDB and absolute (fansub) numbering, and resolves release names to the right show and episode.

**Status: early development.** Data format, validator, SQLite compiler and an offline client (`lookup`, `translate`) exist. Nothing is published yet. See [docs/SPEC.md](docs/SPEC.md) for the full plan.

```sh
pnpm install
pnpm validate
pnpm compile --out out/courmap.sqlite
pnpm test
```

## License

Code: Apache-2.0 ([LICENSE](LICENSE)). Data in `data/` and all dumps: ODbL 1.0 + DbCL 1.0 ([DATA_LICENSE](DATA_LICENSE)). See [ATTRIBUTION.md](ATTRIBUTION.md).
