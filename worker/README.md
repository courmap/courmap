# Courmap Worker

The optional HTTP API (decision S6.3): a Cloudflare Worker serving lookup, translate, resolve and search over the static shards, for curl-and-go use. It runs the same remote client as the browser, so its answers are the library's answers. It is a convenience: if it is switched off, the library, the dumps, the Sonarr proxy and the docs site's try-it box all keep working.

| Request | Answer |
| --- | --- |
| `GET /v1/meta` | Data version and build information |
| `GET /v1/lookup?ref=anilist:142838` | The work |
| `GET /v1/translate?from=anilist:142838&episode=5&to=tvdb_show,absolute` | One episode in other numberings |
| `POST /v1/translate` with `{ "items": [{ "ref", "episode", "targets" }] }` | Up to 100 translations; errors per item |
| `GET /v1/resolve?release=...` | A release name resolved |
| `POST /v1/resolve` with `{ "releases": ["..."] }` | Up to 25 release names |
| `GET /v1/search?q=frieren&limit=10` | Works by title |

Errors are `{ code, message, field?, candidates? }` with HTTP 400 (`invalid_input`), 404 (`not_found`) or 409 (`ambiguous`). Every response allows any origin. Clients are limited to 60 requests a minute (HTTP 429 with `Retry-After`); anything heavier should use the library or the dumps.

## Develop and deploy

```sh
pnpm vitest run worker                                       # handler tests, incl. the conformance suite
npx wrangler@4.151.2 dev --var DATA_URL:http://127.0.0.1:<port>/v1/   # in workerd, against local shards
npx tsx --conditions=@courmap/source worker/scripts/check-deployed.ts <worker url> courmap.sqlite
```

`.github/workflows/worker.yml` bundles it on every change and deploys from `main` when the `CLOUDFLARE_API_TOKEN` (Workers: Edit) and `CLOUDFLARE_ACCOUNT_ID` secrets exist. It is served at `courmap.<account>.workers.dev` until `api.courmap.com` exists. `DATA_URL` in `wrangler.toml` points at `data.courmap.com`, which serves shards once R2 is set up.
