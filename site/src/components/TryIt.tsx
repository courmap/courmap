import { createRemoteClient, type ResolveResult } from '@courmap/client/remote';
import { useState } from 'preact/hooks';
import { DATA_URL } from '../data-url';

/** Release names from the committed data that show what resolving does. */
const EXAMPLES = [
  '[SubsPlease] Spy x Family - 17 (1080p) [ABCD1234].mkv',
  '[SubsPlease] Sousou no Frieren - 12 (1080p)',
  '[Group] Doraemon (2005) - 01 [1080p]',
  'One Piece S22E14 1080p WEB H264-GRP',
];

let client: ReturnType<typeof createRemoteClient> | null = null;
const getClient = () => (client ??= createRemoteClient(DATA_URL));

const PROVIDER_LABELS: Record<string, string> = { anidb: 'AniDB', anilist: 'AniList', mal: 'MAL', kitsu: 'Kitsu', tvdb_show: 'TVDB', tmdb_show: 'TMDB', tmdb_movie: 'TMDB movie', imdb: 'IMDb' };

/**
 * The try-it box (decision S4.7): resolves a release name in the browser with the remote client,
 * straight from the static shards. No Worker and no server are involved.
 */
export default function TryIt() {
  const [name, setName] = useState(EXAMPLES[0]!);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  const run = async (value = name) => {
    setBusy(true);
    setError(null);
    const t0 = performance.now();
    try {
      setResult(await getClient().resolve(value));
      setMs(Math.round(performance.now() - t0));
    } catch (err) {
      setResult(null);
      setError(
        `Could not load data from ${DATA_URL}: ${(err as Error).message}. The live data at data.courmap.com is not published yet; ` +
          'locally, run pnpm compile and pnpm builder shards, then pnpm --filter @courmap/site dev.',
      );
    } finally {
      setBusy(false);
    }
  };

  const m = result?.match;
  return (
    <div class="tryit">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label for="tryit-input">Release name</label>
        <div class="tryit-row">
          <input id="tryit-input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} spellcheck={false} autocomplete="off" />
          <button type="submit" disabled={busy}>
            {busy ? 'Resolving' : 'Resolve'}
          </button>
        </div>
      </form>
      <p class="tryit-examples">
        Try:{' '}
        {EXAMPLES.map((x) => (
          <button
            type="button"
            class="tryit-chip"
            key={x}
            onClick={() => {
              setName(x);
              void run(x);
            }}
          >
            {x}
          </button>
        ))}
      </p>
      {error && <p class="tryit-error">{error}</p>}
      {result && (
        <div class="tryit-result" aria-live="polite">
          <p>
            <strong class={`tryit-status tryit-${result.status}`}>{result.status}</strong>
            {m && (
              <>
                {' '}
                <code>{m.work}</code> episode {m.episode ?? 'none'}
                {m.episode_to ? `-${m.episode_to}` : ''}, confidence {m.confidence}
              </>
            )}
            {ms !== null && <span class="tryit-ms"> ({ms} ms in your browser, data {result.data_version})</span>}
          </p>
          {m && <p class="tryit-reason">{m.reason}</p>}
          {m && (
            <table>
              <thead>
                <tr>
                  <th>Numbering</th>
                  <th>ID</th>
                  <th>Episode</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(m.ids).map(([p, id]) => {
                  const proj = (m.projections as Record<string, { season?: number; episode: number } | undefined>)[p];
                  const canonical = ['anidb', 'anilist', 'mal', 'kitsu'].includes(p);
                  return (
                    <tr key={p}>
                      <td>{PROVIDER_LABELS[p] ?? p}</td>
                      <td>
                        <code>{id}</code>
                      </td>
                      <td>{proj ? `${proj.season !== undefined ? `S${String(proj.season).padStart(2, '0')}E` : ''}${proj.episode}` : canonical ? m.episode : ''}</td>
                    </tr>
                  );
                })}
                {m.projections.absolute && (
                  <tr>
                    <td>Absolute</td>
                    <td>
                      <code>{m.projections.absolute.sequence}</code>
                    </td>
                    <td>{m.projections.absolute.episode}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {result.candidates.length > 0 && (
            <details open={result.status !== 'ok'}>
              <summary>{result.status === 'ok' ? 'Runners-up' : 'Candidates'}</summary>
              <ul>
                {result.candidates.map((c) => (
                  <li key={`${c.work}-${c.episode}`}>
                    <code>{c.work}</code> episode {c.episode ?? 'none'}, confidence {c.confidence}: {c.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
