/**
 * invalid_input: malformed ref, episode or target (HTTP 400).
 * not_found: the ref, or the episode within it, is unknown (HTTP 404).
 * ambiguous: the ref points at more than one work; `candidates` lists them.
 */
export type ErrorCode = 'invalid_input' | 'not_found' | 'ambiguous';

export interface CourmapErrorJSON {
  code: ErrorCode;
  message: string;
  field?: string;
  candidates?: string[];
}

export class CourmapError extends Error {
  readonly code: ErrorCode;
  readonly field: string | undefined;
  readonly candidates: string[] | undefined;

  constructor(code: ErrorCode, message: string, extra: { field?: string; candidates?: string[] } = {}) {
    super(message);
    this.name = 'CourmapError';
    this.code = code;
    this.field = extra.field;
    this.candidates = extra.candidates;
  }

  toJSON(): CourmapErrorJSON {
    return {
      code: this.code,
      message: this.message,
      ...(this.field !== undefined && { field: this.field }),
      ...(this.candidates !== undefined && { candidates: this.candidates }),
    };
  }
}
