/** Seed data that was dropped or defaulted, written to data/seeds/conflicts.jsonl for humans (and later, tier C issues). */
export interface Conflict {
  /** The seed work's anchor: `anidb:69`, `anilist:21` or `mal:21`. */
  key: string;
  /** Set once the work has a slug. */
  slug?: string;
  /** What was dropped: `work`, `ids.<provider>`, `projections.<provider>`, `projections.<provider>.<kind>:<from>-<to>`, `status`. */
  part: string;
  reason: string;
  detail: string;
}

const ORDER: Record<string, number> = { anidb: 0, anilist: 1, mal: 2 };

/** Orders keys by anchor priority, then numerically: anidb:2 < anidb:10 < anilist:1. */
export function compareKeys(a: string, b: string): number {
  const [pa = '', ia = '0'] = a.split(':');
  const [pb = '', ib = '0'] = b.split(':');
  return (ORDER[pa] ?? 9) - (ORDER[pb] ?? 9) || Number(ia) - Number(ib);
}

export function sortConflicts(conflicts: Conflict[]): Conflict[] {
  return [...conflicts].sort(
    (a, b) => compareKeys(a.key, b.key) || cmp(a.part, b.part) || cmp(a.reason, b.reason) || cmp(a.detail, b.detail),
  );
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
