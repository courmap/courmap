/** The fields of /api/v3/series the proxy uses. */
export interface SonarrSeries {
  id: number;
  title: string;
  tvdbId: number;
  seriesType: 'standard' | 'daily' | 'anime';
  useSceneNumbering: boolean;
  /** First-aired year, when Sonarr knows it. */
  year?: number;
  alternateTitles?: { title: string; seasonNumber?: number; sceneSeasonNumber?: number }[];
}

/** The fields of /api/v3/episode the proxy uses. */
export interface SonarrEpisode {
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber?: number | null;
  sceneSeasonNumber?: number | null;
  sceneEpisodeNumber?: number | null;
  sceneAbsoluteEpisodeNumber?: number | null;
}

export interface SonarrStatus {
  configured: boolean;
  series: number;
  lastRefresh: string | null;
  lastError: string | null;
}

/** Sonarr's own title cleaning, roughly: lowercase letters and digits only. Used to match search queries to series. */
export const cleanTitle = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** The shortest time between two series-list reloads that a missing series may trigger. */
export const MISS_REFRESH_INTERVAL_MS = 60_000;

/**
 * Reads the user's Sonarr: series titles by TVDB ID (the rewritten title must be the one Sonarr
 * knows) and, per series, episodes with absolute and scene numbers. The series list is cached
 * and refreshed on a schedule, and also when a release resolves to a TVDB show the list does not
 * have (at most once a minute), so a series added to Sonarr is picked up without waiting for the
 * schedule; episode lists are cached for the same interval.
 */
export class SonarrClient {
  private byTvdb = new Map<number, SonarrSeries>();
  private byTitle = new Map<string, SonarrSeries>();
  private episodes = new Map<number, { at: number; list: Promise<SonarrEpisode[]> }>();
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;
  private lastAttempt = -Infinity;
  readonly status: SonarrStatus;

  constructor(
    private readonly opts: { url: string; apiKey: string; refreshMinutes: number; fetch?: typeof fetch; now?: () => number; timeoutMs?: number } | null,
  ) {
    this.status = { configured: opts !== null, series: 0, lastRefresh: null, lastError: opts ? null : 'SONARR_URL and SONARR_API_KEY are not set: every release passes through unchanged' };
  }

  private async get<T>(pathAndQuery: string): Promise<T> {
    const o = this.opts!;
    const res = await (o.fetch ?? ((i, init) => fetch(i, init)))(`${o.url}${pathAndQuery}`, {
      headers: { 'X-Api-Key': o.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
    });
    if (!res.ok) throw new Error(`Sonarr ${pathAndQuery.split('?')[0]}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async start(): Promise<void> {
    if (!this.opts) return;
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.opts.refreshMinutes * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Reloads the series list. A failure keeps the previous list. A reload already running is
   * shared, not repeated. `missedTvdbId` marks a reload triggered by a series the list did not
   * have: the other series' cached episode lists are kept, and the new series' own is dropped,
   * since Sonarr may still have been filling it in when it was last read.
   */
  refresh(missedTvdbId?: number): Promise<void> {
    if (!this.opts) return Promise.resolve();
    this.inflight ??= this.load(missedTvdbId).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /**
   * Called when a release resolves to a TVDB show that is not in the cached series list. Starts a
   * reload in the background and returns at once: the release in hand passes through as it would
   * without the reload, and the next one sees the new series. At most one reload per
   * MISS_REFRESH_INTERVAL_MS, counted from the last reload of any kind, so a Sonarr that is
   * down or a show that is not in Sonarr at all costs at most one request a minute.
   */
  refreshOnMiss(tvdbId: number): void {
    if (!this.opts || this.byTvdb.has(tvdbId) || this.inflight) return;
    if (this.now() - this.lastAttempt < MISS_REFRESH_INTERVAL_MS) return;
    void this.refresh(tvdbId);
  }

  private now(): number {
    return this.opts?.now?.() ?? Date.now();
  }

  private async load(missedTvdbId?: number): Promise<void> {
    this.lastAttempt = this.now();
    try {
      const series = await this.get<SonarrSeries[]>('/api/v3/series');
      this.byTvdb = new Map(series.filter((s) => s.tvdbId > 0).map((s) => [s.tvdbId, s]));
      this.byTitle = new Map();
      for (const s of series) {
        this.byTitle.set(cleanTitle(s.title), s);
        for (const a of s.alternateTitles ?? []) if (!this.byTitle.has(cleanTitle(a.title))) this.byTitle.set(cleanTitle(a.title), s);
      }
      if (missedTvdbId === undefined) this.episodes.clear();
      else {
        const ids = new Set(series.map((s) => s.id));
        for (const id of [...this.episodes.keys()]) if (!ids.has(id)) this.episodes.delete(id);
        const added = this.byTvdb.get(missedTvdbId);
        if (added) this.episodes.delete(added.id);
      }
      Object.assign(this.status, { series: this.byTvdb.size, lastRefresh: new Date(this.now()).toISOString(), lastError: null });
    } catch (err) {
      this.status.lastError = (err as Error).message;
    }
  }

  seriesByTvdb(tvdbId: number): SonarrSeries | undefined {
    return this.byTvdb.get(tvdbId);
  }

  seriesByTitle(title: string): SonarrSeries | undefined {
    return this.byTitle.get(cleanTitle(title));
  }

  /**
   * Series whose title or any alternate title equals one of `titles` (cleaned), and whose year is
   * within one of `year` when both are known (decision S7.1). Used only when the data has no
   * TVDB projection; the caller requires exactly one.
   */
  matchSeries(titles: readonly string[], year: number | null): SonarrSeries[] {
    const wanted = new Set(titles.map(cleanTitle).filter((t) => t.length >= 3));
    const out = new Map<number, SonarrSeries>();
    for (const s of this.byTvdb.values()) {
      const names = [s.title, ...(s.alternateTitles ?? []).map((a) => a.title)].map(cleanTitle);
      if (!names.some((n) => wanted.has(n))) continue;
      if (year !== null && s.year !== undefined && s.year > 0 && Math.abs(s.year - year) > 1) continue;
      out.set(s.tvdbId, s);
    }
    return [...out.values()].sort((a, b) => a.tvdbId - b.tvdbId);
  }

  /** A series' episodes, cached per refresh interval. */
  async episodesOf(series: SonarrSeries): Promise<SonarrEpisode[]> {
    const now = this.now();
    const hit = this.episodes.get(series.id);
    if (hit && now - hit.at < (this.opts?.refreshMinutes ?? 60) * 60_000) return hit.list;
    const list = this.get<SonarrEpisode[]>(`/api/v3/episode?seriesId=${series.id}`);
    this.episodes.set(series.id, { at: now, list });
    list.catch(() => this.episodes.delete(series.id));
    return list;
  }
}
