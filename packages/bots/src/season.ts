import type { Season } from './anilist.js';

export interface SeasonRef {
  season: Season;
  year: number;
}

const ORDER: readonly Season[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const NAMES: Record<Season, string> = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };

/** The anime season a date falls in (UTC): Winter is January to March, and so on. */
export function seasonOf(date: Date): SeasonRef {
  return { season: ORDER[Math.floor(date.getUTCMonth() / 3)]!, year: date.getUTCFullYear() };
}

export function nextSeason(s: SeasonRef): SeasonRef {
  const i = ORDER.indexOf(s.season);
  return i === 3 ? { season: 'WINTER', year: s.year + 1 } : { season: ORDER[i + 1]!, year: s.year };
}

/** "Fall 2026". */
export const seasonName = (s: SeasonRef) => `${NAMES[s.season]} ${s.year}`;

/** First day of a season, UTC. */
export const seasonStart = (s: SeasonRef) => new Date(Date.UTC(s.year, ORDER.indexOf(s.season) * 3, 1));
