/**
 * The AniList GraphQL client. This package is the only one allowed to call AniList
 * (docs/SPEC.md, "Data sources and licensing"): only the season scanner and the airing tracker
 * use it, requests are batched 50 media at a time, and every request waits for the rate limit
 * (30 requests a minute while AniList is degraded) and honours its rate-limit headers.
 */

export const ANILIST_URL = 'https://graphql.anilist.co';
/** AniList's current (degraded) limit is 30 requests a minute; one every 2 s stays under it. */
export const MIN_INTERVAL_MS = 2_000;
const PER_PAGE = 50;
const MAX_RETRIES = 4;
/** Stop paginating a season after this many pages (2,500 media), whatever pageInfo says. */
const MAX_PAGES = 50;

export type MediaFormat = 'TV' | 'TV_SHORT' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC';
export type MediaStatus = 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';
export type Season = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';

/** The only fields we read: IDs, format, status, episode count, start date, prequel/sequel relations, airing. No titles. */
export interface AniListMedia {
  id: number;
  idMal: number | null;
  format: MediaFormat | null;
  status: MediaStatus | null;
  episodes: number | null;
  season: Season | null;
  seasonYear: number | null;
  startDate: { year: number | null; month: number | null; day: number | null };
  relations: { edges: { relationType: string; node: { id: number; type: string } }[] } | null;
  nextAiringEpisode: { episode: number; airingAt: number } | null;
}

const MEDIA_FIELDS = `
  id idMal format status episodes season seasonYear
  startDate { year month day }
  relations { edges { relationType node { id type } } }
  nextAiringEpisode { episode airingAt }
`;

const SEASON_QUERY = `query ($season: MediaSeason, $year: Int, $page: Int) {
  Page(page: $page, perPage: ${PER_PAGE}) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $year, type: ANIME, sort: ID) { ${MEDIA_FIELDS} }
  }
}`;

const IDS_QUERY = `query ($ids: [Int], $page: Int) {
  Page(page: $page, perPage: ${PER_PAGE}) {
    pageInfo { hasNextPage }
    media(id_in: $ids, type: ANIME, sort: ID) { ${MEDIA_FIELDS} }
  }
}`;

interface PageResult {
  Page: { pageInfo: { hasNextPage: boolean }; media: AniListMedia[] };
}

export interface AniListOptions {
  fetch?: typeof fetch;
  /** Minimum time between two requests. Default MIN_INTERVAL_MS. */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

export class AniListClient {
  /** Requests sent so far, retries included. */
  requests = 0;
  private last = -Infinity;
  /** Earliest time the next request may go out, from rate-limit headers. */
  private notBefore = 0;
  private readonly fetchFn: typeof fetch;
  private readonly interval: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(opts: AniListOptions = {}) {
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.interval = opts.minIntervalMs ?? MIN_INTERVAL_MS;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  /** One GraphQL request, paced and retried on 429 and 5xx. */
  async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(this.last + this.interval, this.notBefore) - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
      this.requests++;
      const res = await this.fetchFn(ANILIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      this.readLimits(res);
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= MAX_RETRIES) throw new Error(`AniList: HTTP ${res.status} after ${attempt + 1} attempts`);
        const retryAfter = Number(res.headers.get('Retry-After'));
        const backoff = res.status === 429 ? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000) : 5_000 * 2 ** attempt;
        this.log(`AniList: HTTP ${res.status}, waiting ${Math.round(backoff / 1000)} s`);
        this.notBefore = Math.max(this.notBefore, this.now() + backoff);
        continue;
      }
      const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
      if (!res.ok || body.errors?.length || !body.data) {
        throw new Error(`AniList: HTTP ${res.status}: ${body.errors?.map((e) => e.message).join('; ') ?? 'no data'}`);
      }
      return body.data;
    }
  }

  /** X-RateLimit-Remaining at 0 holds the next request until X-RateLimit-Reset (or a minute). */
  private readLimits(res: Response): void {
    const remaining = res.headers.get('X-RateLimit-Remaining');
    if (remaining !== null && Number(remaining) <= 0) {
      const reset = Number(res.headers.get('X-RateLimit-Reset'));
      const until = Number.isFinite(reset) && reset > 0 ? reset * 1000 : this.now() + 60_000;
      this.notBefore = Math.max(this.notBefore, until);
    }
  }

  private async pages(query: string, variables: Record<string, unknown>): Promise<AniListMedia[]> {
    const out: AniListMedia[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await this.query<PageResult>(query, { ...variables, page });
      out.push(...r.Page.media);
      if (!r.Page.pageInfo.hasNextPage) break;
    }
    return out;
  }

  /** Every anime of one season, 50 per request. */
  seasonMedia(season: Season, year: number): Promise<AniListMedia[]> {
    return this.pages(SEASON_QUERY, { season, year });
  }

  /** The given media, 50 IDs per request. */
  async mediaByIds(ids: readonly number[]): Promise<AniListMedia[]> {
    const unique = [...new Set(ids)].sort((a, b) => a - b);
    const out: AniListMedia[] = [];
    for (let i = 0; i < unique.length; i += PER_PAGE) out.push(...(await this.pages(IDS_QUERY, { ids: unique.slice(i, i + PER_PAGE) })));
    return out;
  }
}
