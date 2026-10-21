import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { issueBody } from '../src/report.js';
import { loadState } from '../src/state.js';
import { related } from '../src/tmdb.js';

describe('naming the file in an issue', async () => {
  const state = await loadState(fileURLToPath(new URL('./fixtures/tmdb-rule/', import.meta.url)));
  it('lists the other works of the show that have no TMDB mapping, so the issue can name their files', () => {
    // r-cour-one and r-cour-two share TMDB show 9006 and both are mapped: nothing to list.
    expect(related(state.records, 'r-cour-one')).toEqual({});
  });

  it('puts the exact file name and an example in the body', () => {
    const body = issueBody({ tier: 'C', kind: 'projection-mismatch', work: 'some-show', anilist: 1, title: 'Some Show', summary: 'x', data: { tmdb_show: '123', url: 'https://www.themoviedb.org/tv/123', related_without_tmdb_mapping: ['some-show-special'] } });
    expect(body).toContain('`data/works/some-show.yaml`');
    expect(body).toContain('`data/works/some-show-special.yaml`');
    expect(body).toContain('tmdb_show: 123');
    expect(body).toContain('How to fix this');
  });
});
