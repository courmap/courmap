// Generated from schema/sequence.schema.json by `pnpm gen:types`. Do not edit by hand.

/**
 * Lowercase letters and digits, separated by single hyphens (for example sousou-no-frieren).
 */
export type Slug = string;
/**
 * Regular canonical episodes of the work covered by this member.
 */
export type EpisodeRange = number | string;
export type Sources = string[];

/**
 * An absolute sequence: an ordered chain of works numbered continuously, the way fansubs number long series. data/sequences/<id>.yaml.
 */
export interface SequenceFile {
  id: Slug;
  /**
   * @minItems 1
   */
  members: [SequenceMember, ...SequenceMember[]];
  notes?: string;
  sources?: Sources;
}
export interface SequenceMember {
  work: Slug;
  episodes: EpisodeRange;
  /**
   * Absolute number of the first episode in the range.
   */
  absolute_start: number;
  /**
   * Marks this sequence as the default absolute numbering for the member work. Required on exactly one sequence when a work belongs to several.
   */
  default?: boolean;
}
