/** The fields of /api/v3/series the proxy uses. */
export interface SonarrSeries {
  id: number;
  title: string;
  tvdbId: number;
  seriesType: 'standard' | 'daily' | 'anime';
  useSceneNumbering: boolean;
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

/**
 * Reads the user's Sonarr: series titles by TVDB ID (the rewritten title must be the one Sonarr
 * knows) and, per series, episodes with absolute and scene numbers. The series list is cached
 * and refreshed on a schedule; episode lists are cached for the same interval.
 */
export class SonarrClient {
  private byTvdb = new Map<number, SonarrSeries>();
  private byTitle = new Map<string, SonarrSeries>();
  private episodes = new Map<number, { at: number; list: Promise<SonarrEpisode[]> }>();
  private timer: NodeJS.Timeout | null = null;
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

  /** Reloads the series list. A failure keeps the previous list. */
  async refresh(): Promise<void> {
    if (!this.opts) return;
    try {
      const series = await this.get<SonarrSeries[]>('/api/v3/series');
      this.byTvdb = new Map(series.filter((s) => s.tvdbId > 0).map((s) => [s.tvdbId, s]));
      this.byTitle = new Map();
      for (const s of series) {
        this.byTitle.set(cleanTitle(s.title), s);
        for (const a of s.alternateTitles ?? []) if (!this.byTitle.has(cleanTitle(a.title))) this.byTitle.set(cleanTitle(a.title), s);
      }
      this.episodes.clear();
      Object.assign(this.status, { series: this.byTvdb.size, lastRefresh: new Date(this.opts.now?.() ?? Date.now()).toISOString(), lastError: null });
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

  /** A series' episodes, cached per refresh interval. */
  async episodesOf(series: SonarrSeries): Promise<SonarrEpisode[]> {
    const now = this.opts?.now?.() ?? Date.now();
    const hit = this.episodes.get(series.id);
    if (hit && now - hit.at < (this.opts?.refreshMinutes ?? 60) * 60_000) return hit.list;
    const list = this.get<SonarrEpisode[]>(`/api/v3/episode?seriesId=${series.id}`);
    this.episodes.set(series.id, { at: now, list });
    list.catch(() => this.episodes.delete(series.id));
    return list;
  }
}
