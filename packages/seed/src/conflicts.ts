/** Seed data that was dropped or defaulted, written to data/seeds/conflicts.jsonl for humans (and later, tier C issues). */
export interface Conflict {
  anidb: number;
  /** Set once the work has a slug. */
  slug?: string;
  /** What was dropped: `work`, `ids.<provider>`, `projections.<provider>`, `projections.<provider>.<kind>:<from>-<to>`, `status`. */
  part: string;
  reason: string;
  detail: string;
}

export function sortConflicts(conflicts: Conflict[]): Conflict[] {
  return [...conflicts].sort(
    (a, b) => a.anidb - b.anidb || cmp(a.part, b.part) || cmp(a.reason, b.reason) || cmp(a.detail, b.detail),
  );
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
