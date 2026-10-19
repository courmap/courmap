import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AniListClient, MIN_INTERVAL_MS } from '../src/anilist.js';
import { sendDigest } from '../src/notify.js';
import { digestText, trackerBody } from '../src/report.js';
import { loadState } from '../src/state.js';
import { TmdbClient, checkProjections } from '../src/tmdb.js';
import type { TrackerRow } from '../src/classify.js';

/** A fake clock and fetch: sleeping advances time, responses come from a queue. */
function harness(responses: { status?: number; headers?: Record<string, string>; body?: unknown }[]) {
  let t = 1_000_000;
  const sent: { at: number; body: { variables: Record<string, unknown> } }[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    sent.push({ at: t, body: JSON.parse(String(init.body)) });
    const r = responses.shift() ?? { body: { data: { Page: { pageInfo: { hasNextPage: false }, media: [] } } } };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  const client = new AniListClient({ fetch: fetchFn, now: () => t, sleep: async (ms) => void (t += ms) });
  return { client, sent };
}
const page = (ids: number[], hasNextPage = false) => ({ body: { data: { Page: { pageInfo: { hasNextPage }, media: ids.map((id) => ({ id })) } } } });

describe('AniList client', () => {
  it('spaces requests at least 2 s apart (30 a minute) and follows pagination', async () => {
    const { client, sent } = harness([page([1, 2], true), page([3], true), page([4])]);
    const media = await client.seasonMedia('FALL', 2026);
    expect(media.map((m) => m.id)).toEqual([1, 2, 3, 4]);
    expect(sent.map((s) => s.body.variables.page)).toEqual([1, 2, 3]);
    expect(sent[1]!.at - sent[0]!.at).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
    expect(sent[2]!.at - sent[1]!.at).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
  });

  it('batches IDs 50 to a request', async () => {
    const { client, sent } = harness([]);
    await client.mediaByIds(Array.from({ length: 120 }, (_, i) => 120 - i));
    expect(sent.map((s) => (s.body.variables.ids as number[]).length)).toEqual([50, 50, 20]);
    expect((sent[0]!.body.variables.ids as number[])[0]).toBe(1);
  });

  it('waits out a 429 for Retry-After, then retries', async () => {
    const { client, sent } = harness([{ status: 429, headers: { 'Retry-After': '30' } }, page([7])]);
    expect((await client.mediaByIds([7])).map((m) => m.id)).toEqual([7]);
    expect(sent[1]!.at - sent[0]!.at).toBe(30_000);
  });

  it('holds the next request until X-RateLimit-Reset when none remain', async () => {
    const { client, sent } = harness([{ ...page([1], true), headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(1_000_000 / 1000 + 45) } }, page([2])]);
    await client.seasonMedia('FALL', 2026);
    expect(sent[1]!.at).toBe(1_045_000);
  });

  it('surfaces GraphQL errors', async () => {
    const { client } = harness([{ status: 400, body: { errors: [{ message: 'bad query' }] } }]);
    await expect(client.mediaByIds([1])).rejects.toThrow(/bad query/);
  });
});

describe('TMDB projection checker', async () => {
  const state = await loadState(fileURLToPath(new URL('./fixtures/tmdb/', import.meta.url)));
  it('flags projections past a TMDB season and seasons TMDB lacks, and keeps nothing', async () => {
    const shows: Record<string, unknown> = {
      '8000': { seasons: [{ season_number: 1, episode_count: 12 }, { season_number: 2, episode_count: 10 }] },
    };
    const fetchFn = (async (url: string) => {
      const id = /tv\/(\d+)/.exec(url)![1]!;
      return shows[id] ? new Response(JSON.stringify(shows[id])) : new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const findings = await checkProjections(state.records, state.records.works.keys(), new TmdbClient('key', { fetch: fetchFn, minIntervalMs: 0 }));
    expect(findings.map((f) => [f.work, f.tier, f.summary])).toEqual([
      ['tm-b', 'C', 'TMDB projection disagrees with TMDB: season 2 is mapped to episode 12, TMDB lists 10'],
      ['tm-c', 'C', 'TMDB projection disagrees with TMDB: season 3 is not on TMDB'],
      ['tm-gone', 'C', 'TMDB projection disagrees with TMDB: TMDB has no TV show 8001'],
    ]);
  });
});

describe('digest and tracker text', () => {
  it('says when nothing needs review', () => {
    const d = digestText({ since: new Date('2026-10-12T00:00:00Z'), autoMerged: [], autoOpen: [{ title: 'Airing updates', url: 'u' }], review: [], conflicts: [], trackers: [] });
    expect(d.title).toBe('Courmap: 0 auto-merged, 0 need review, 0 conflicts');
    expect(d.body).toContain('Nothing needs review this week.');
    expect(d.body).toContain('1 tier A PR(s) open (dry run: the bots never merge).');
  });

  it('keeps the tracker under GitHub issue limits', () => {
    const rows: TrackerRow[] = Array.from({ length: 2000 }, (_, i) => ({ anilist: i, work: `w-${i}`, title: `Title ${i}`, format: 'TV', status: 'RELEASING', episodes: 12, state: 'mapped', note: 'x'.repeat(100) }));
    const body = trackerBody('Fall 2026', rows, new Date('2026-10-19T00:00:00Z'));
    expect(body.length).toBeLessThan(65_536);
    expect(body).toMatch(/\d+ more \(mapped\) not listed/);
  });

  it('posts to ntfy and Discord', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response('ok'))) as unknown as typeof fetch;
    const sent = await sendDigest('T', 'B', { ntfyUrl: 'https://ntfy.example/t', discordWebhook: 'https://discord.example/w' }, fetchFn);
    expect(sent).toEqual(['ntfy', 'discord']);
    expect(calls[0]!.init.headers).toMatchObject({ Title: 'T' });
    expect(JSON.parse(String(calls[1]!.init.body))).toMatchObject({ content: '**T**\nB', allowed_mentions: { parse: [] } });
  });
});
