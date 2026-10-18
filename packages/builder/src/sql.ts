/** Bumped whenever SCHEMA_SQL changes shape. Stored in meta.schema_version. */
export const SCHEMA_VERSION = '3';

/** The compiled data model from docs/SPEC.md ("Compiled data model"), verbatim except that column comments are dropped. */
export const SCHEMA_SQL = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE works (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  status        TEXT,
  year          INTEGER,
  episodes      INTEGER,
  specials      INTEGER,
  title_romaji  TEXT, title_english TEXT, title_native TEXT,
  prequel_id    TEXT REFERENCES works(id),
  prequel_origin TEXT
);

CREATE TABLE provider_refs (
  work_id      TEXT NOT NULL REFERENCES works(id),
  provider     TEXT NOT NULL,
  provider_id  TEXT NOT NULL,
  origin       TEXT NOT NULL,
  PRIMARY KEY (provider, provider_id, work_id)
);
CREATE INDEX idx_refs_work ON provider_refs(work_id);

CREATE TABLE projections (
  work_id      TEXT NOT NULL REFERENCES works(id),
  provider     TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'regular',
  ep_from      INTEGER NOT NULL,
  ep_to        INTEGER,
  season       INTEGER,
  target_from  INTEGER NOT NULL,
  target_to    INTEGER,
  origin       TEXT NOT NULL
);
CREATE INDEX idx_proj_lookup ON projections(provider, work_id, kind, ep_from);
CREATE INDEX idx_proj_reverse ON projections(provider, season, target_from);
CREATE INDEX idx_proj_work ON projections(work_id, provider, kind, ep_from);

CREATE TABLE sequences (
  id      TEXT PRIMARY KEY,
  origin  TEXT NOT NULL
);
CREATE TABLE sequence_members (
  sequence_id     TEXT NOT NULL REFERENCES sequences(id),
  work_id         TEXT NOT NULL REFERENCES works(id),
  ep_from         INTEGER NOT NULL,
  ep_to           INTEGER,
  absolute_start  INTEGER NOT NULL,
  is_default      INTEGER NOT NULL,
  origin          TEXT NOT NULL,
  PRIMARY KEY (sequence_id, work_id, ep_from)
);
CREATE INDEX idx_members_work ON sequence_members(work_id);

CREATE TABLE aliases (
  work_id     TEXT NOT NULL REFERENCES works(id),
  alias       TEXT NOT NULL,
  normalized  TEXT NOT NULL,
  origin      TEXT NOT NULL
);
CREATE INDEX idx_alias_norm ON aliases(normalized);
CREATE INDEX idx_alias_work ON aliases(work_id);
CREATE VIRTUAL TABLE alias_trigrams USING fts5(normalized, work_id UNINDEXED, tokenize = 'trigram');

CREATE TABLE groups (
  id      TEXT PRIMARY KEY,
  origin  TEXT NOT NULL
);
CREATE TABLE group_aliases (
  group_id TEXT NOT NULL REFERENCES groups(id),
  alias    TEXT NOT NULL,
  origin   TEXT NOT NULL
);
CREATE TABLE group_overrides (
  group_id   TEXT NOT NULL REFERENCES groups(id),
  work_id    TEXT NOT NULL REFERENCES works(id),
  numbering  TEXT NOT NULL,
  offset     INTEGER,
  sequence_id TEXT REFERENCES sequences(id),
  origin     TEXT NOT NULL
);
`;

export const TABLES = [
  'meta',
  'works',
  'provider_refs',
  'projections',
  'sequences',
  'sequence_members',
  'aliases',
  'alias_trigrams',
  'groups',
  'group_aliases',
  'group_overrides',
] as const;
export type Table = (typeof TABLES)[number];
