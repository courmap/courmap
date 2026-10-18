import { describe, expect, it } from 'vitest';
import type { ResolveResult } from '@courmap/core';
import { judge, type CorpusCase } from '../scripts/corpus.js';
import { expectationOf, readNames } from '../scripts/corpus-import.js';

const result = (status: ResolveResult['status'], work?: string, episode?: number): ResolveResult =>
  ({
    data_version: 't',
    status,
    parsed: {} as ResolveResult['parsed'],
    match: status === 'ok' ? { work: work!, episode: episode ?? null, confidence: 1, reason: '', ids: {}, projections: {} } : null,
    candidates: status === 'ambiguous' && work ? [{ work, episode: episode ?? null, confidence: 0.5, reason: '' }] : [],
  }) as ResolveResult;

const c = (expect: CorpusCase['expect']): CorpusCase => ({ name: 'x', expect, verified: true, source: 'hand-written' });

describe('corpus judging', () => {
  it('passes only on the expected work and episode', () => {
    expect(judge(c({ status: 'ok', work: 'a', episode: 5 }), result('ok', 'a', 5)).pass).toBe(true);
    expect(judge(c({ status: 'ok', work: 'a', episode: 5 }), result('ok', 'a', 6)).pass).toBe(false);
    expect(judge(c({ status: 'ok', work: 'a', episode: 5 }), result('ambiguous', 'a', 5)).pass).toBe(false);
  });

  it('flags an expected ambiguous or unmatched case that comes back ok', () => {
    expect(judge(c({ status: 'ambiguous' }), result('ok', 'a', 1)).falseOk).toBe(true);
    expect(judge(c({ status: 'unmatched' }), result('ok', 'a', 1)).falseOk).toBe(true);
    expect(judge(c({ status: 'ambiguous', top: 'a' }), result('ambiguous', 'a')).pass).toBe(true);
    expect(judge(c({ status: 'ambiguous', top: 'b' }), result('ambiguous', 'a')).pass).toBe(false);
  });
});

describe('corpus import format', () => {
  it('reads one name per line, skipping blanks and comments, reducing paths to file names', () => {
    const text = '﻿# exported 2026-10-18\n[A] Show - 01 [1080p].mkv\r\n\n  /mnt/anime/[B] Show - 02.mkv  \nC:\\Anime\\[C] Show - 03.mkv\n';
    expect(readNames(text)).toEqual(['[A] Show - 01 [1080p].mkv', '[B] Show - 02.mkv', '[C] Show - 03.mkv']);
  });

  it('records today\'s answer as the unverified expectation', () => {
    expect(expectationOf(result('ok', 'a', 3))).toEqual({ status: 'ok', work: 'a', episode: 3 });
    expect(expectationOf(result('ambiguous', 'b'))).toEqual({ status: 'ambiguous', top: 'b' });
    expect(expectationOf(result('unmatched'))).toEqual({ status: 'unmatched' });
  });
});
