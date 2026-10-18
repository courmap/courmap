// Generated from schema/group.schema.json by `pnpm gen:types`. Do not edit by hand.

/**
 * Lowercase letters and digits, separated by single hyphens (for example sousou-no-frieren).
 */
export type Slug = string;
export type Sources = string[];

/**
 * A release group and its known numbering quirks: data/groups/<id>.yaml.
 */
export interface GroupFile {
  id: Slug;
  aliases?: string[];
  overrides?: GroupOverride[];
  notes?: string;
  sources?: Sources;
}
export interface GroupOverride {
  work: Slug;
  /**
   * continue_prequel: numbers this work after its prequel's last episode. absolute: uses the work's absolute sequence (its default one, unless `sequence` names another). offset: adds `offset` to canonical numbers.
   */
  numbering: 'continue_prequel' | 'absolute' | 'offset';
  /**
   * Required when numbering is offset, not allowed otherwise.
   */
  offset?: number;
  /**
   * Lowercase letters and digits, separated by single hyphens (for example sousou-no-frieren).
   */
  sequence?: string;
}
