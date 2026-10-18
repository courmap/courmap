# Handoff

Where the build stands, for the next session. Read CLAUDE.md, docs/SPEC.md and docs/DECISIONS.md first, as always; this file only says what is done and what is next. Update it at the end of every session.

Last updated 2026-10-18, end of session 3.

## Done

- Build steps 1 to 7 are complete and green in CI.
- Session 3 decisions S3.0 to S3.9 from Xwolv are all applied, with spec text and DECISIONS.md entries.
- Step 8 is partly done: `packages/release` (dump assets plus S3 shard upload) is committed with tests.

## Next: finish step 8

1. **CI end-to-end upload test.** In `.github/workflows/validate.yml`, before the test step, start a local S3-compatible server and point the test at it:
   - `docker run -d -p 9090:9090 adobe/s3mock:5.2` (pinned; `minio/minio` no longer publishes tags on Docker Hub).
   - Wait until `curl -sf http://localhost:9090/` answers.
   - Set `S3_TEST_ENDPOINT: http://localhost:9090` on the test step.

   The test (`packages/release/test/release.test.ts`) creates its own bucket and skips when the variable is unset. It has never run yet, because there was no Docker daemon locally, so expect to fix small S3Mock incompatibilities on the first run (ETag format, HeadObject headers).
2. **`.github/workflows/release.yml`.** Triggers: weekly (after the seed job, for example Tuesdays at 09:00 UTC) and `workflow_dispatch`. Steps:
   - install, `pnpm check`
   - `pnpm compile --out out/courmap.sqlite`
   - `pnpm builder shards --from out/courmap.sqlite --out out/shards/v1`
   - `pnpm release assets --dump out/courmap.sqlite --out out/release`
   - upload `out/release` as a workflow artifact

   Dry run unless the R2 secrets exist. When they exist: create GitHub release `data-<data_version>` with the files in `out/release` (skip if the tag exists, so there is one release per data version), then run `pnpm release upload --dir out/shards/v1 --prune` with `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` set from the secrets. In dry run, run the same upload without credentials (it prints the plan) and create no release.
3. **Documentation for steps 7 and 8.** Spec "Release" section: asset names (`courmap-<v>.sqlite.gz`, `courmap-<v>.json.gz`, `LICENSE`, `ATTRIBUTION.md`, `SHA256SUMS`), the dry-run rule and the secret names. Add DECISIONS.md entries:
   - gzip (not zstd) for dumps, so any client can open them
   - one release per data version
   - ETag-based skipping
   - prune after `meta.json`
   - R2 client settings (path style, checksums only when required)
4. Then stop: step 9 (bots) is next and needs Xwolv's input first.

## Known gaps and notes

- **Commit hygiene.** The resolver's "movie with an episode number" penalty landed inside the corpus commit (7454e60) rather than its own commit.
- **Corpus.** 33 of 34 verified cases pass. Kimi no Na wa (2016) is an honest failure: a 2016 Suntory commercial shares the alias and year, and no S3.4 tie-breaker separates them.
- **Release asset size.** The SQLite dump is 70 MB raw and 38 MB gzipped, mostly the FTS5 trigram index. The resolver no longer reads that index (it uses the alias index in every mode), so dropping `alias_trigrams` from the dump is worth deciding.
- **Remote resolve.** It decompresses `aliases.json.zst` (3.2 MB) with `node:zlib`. The future Worker needs a JS zstd decoder.
- **Seed PRs.** "Allow GitHub Actions to create and approve pull requests" is off for the repo, and there is no `SEED_PR_TOKEN` secret yet, so the weekly seed workflow pushes its branch but cannot open the PR.

## What Xwolv needs to provide

- **Release-name export** for `pnpm corpus:import <file>`: a UTF-8 text file with one release name or file name per line. Full paths are fine (only the file name is kept); `#` lines and blank lines are skipped. Imported cases start unverified.
- **R2 setup:**
  - a bucket (for example `courmap-shards`)
  - an R2 API token with Object Read and Write on that bucket
  - repo secrets `R2_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`), `R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`
  - later, a custom domain on the bucket for `/v1/`
