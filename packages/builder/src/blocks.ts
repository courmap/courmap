import type { ProjectionBlock, ProjectionEntry, ProjectionProvider } from '@courmap/core';
import type { PathSegment } from './diagnostics.js';

/** A provider block in either written form, with the YAML path its ranges live at. */
export interface Block {
  ranges: ProjectionEntry[];
  coverage: 'full' | 'partial';
  notes: string | null;
  /** Path of the ranges list in the source file, for diagnostics. */
  base: PathSegment[];
}

/** Reads `projections.<provider>`, written as a plain list or as `{ coverage, notes, ranges }`. */
export function readBlock(block: ProjectionBlock, provider: ProjectionProvider): Block {
  if (Array.isArray(block)) return { ranges: block, coverage: 'full', notes: null, base: ['projections', provider] };
  return {
    ranges: block.ranges,
    coverage: block.coverage ?? 'full',
    notes: block.notes ?? null,
    base: ['projections', provider, 'ranges'],
  };
}
