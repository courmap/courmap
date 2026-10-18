import { isProvider, type RefNamespace } from './providers.js';
import type { ParseResult } from './range.js';

/**
 * A reference in `provider:id[:scope]` form, for example `anilist:12345`,
 * `tvdb_show:67890:s2`, `work:sousou-no-frieren` or `absolute:spy-x-family-absolute`.
 */
export interface Ref {
  namespace: RefNamespace;
  id: string;
  /** Season number from a `sN` scope; only meaningful for season-based providers. */
  season: number | null;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseRef(input: string): ParseResult<Ref> {
  const parts = input.trim().split(':');
  const [ns = '', id = '', scope] = parts;
  if (parts.length < 2 || parts.length > 3 || !id) {
    return { ok: false, error: `"${input}" is not a ref (expected provider:id or provider:id:scope)` };
  }
  if (ns === 'work' || ns === 'absolute') {
    if (scope !== undefined) return { ok: false, error: `${ns} refs take no scope` };
    if (!SLUG_RE.test(id)) return { ok: false, error: `"${id}" is not a valid slug` };
    return { ok: true, value: { namespace: ns, id, season: null } };
  }
  if (!isProvider(ns)) return { ok: false, error: `unknown provider "${ns}"` };
  if (ns === 'imdb' ? !/^tt\d{7,}$/.test(id) : !/^[1-9]\d*$/.test(id)) {
    return { ok: false, error: `"${id}" is not a valid ${ns} id` };
  }
  let season: number | null = null;
  if (scope !== undefined) {
    if (ns !== 'tvdb_show' && ns !== 'tmdb_show') return { ok: false, error: `${ns} refs take no scope` };
    const m = /^s(\d+)$/.exec(scope);
    if (!m) return { ok: false, error: `scope "${scope}" is not a season (expected s0, s1, ...)` };
    season = Number(m[1]);
  }
  return { ok: true, value: { namespace: ns, id, season } };
}

export function formatRef(ref: Ref): string {
  return ref.season === null ? `${ref.namespace}:${ref.id}` : `${ref.namespace}:${ref.id}:s${ref.season}`;
}
