import { readFileSync } from 'node:fs';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import type { FileKind } from './load.js';
import type { PathSegment } from './diagnostics.js';

// ajv-formats is CommonJS; its default export arrives wrapped under NodeNext.
const addFormats = addFormatsImport as unknown as (typeof addFormatsImport)['default'];

/** schema/ at the repo root is the source of truth for every YAML kind. */
export const SCHEMA_DIR = new URL('../../../schema/', import.meta.url);

export function loadSchema(kind: FileKind): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`${kind}.schema.json`, SCHEMA_DIR), 'utf8')) as Record<string, unknown>;
}

export interface SchemaIssue {
  path: PathSegment[];
  /** Point at the key rather than the value (unknown fields). */
  key: boolean;
  message: string;
}

let validators: Record<FileKind, ValidateFunction> | null = null;

function getValidators(): Record<FileKind, ValidateFunction> {
  if (validators) return validators;
  const ajv = new Ajv2020({ allErrors: true, strict: true, verbose: true });
  addFormats(ajv, ['uri']);
  validators = {
    work: ajv.compile(loadSchema('work')),
    sequence: ajv.compile(loadSchema('sequence')),
    group: ajv.compile(loadSchema('group')),
  };
  return validators;
}

const pointerToPath = (pointer: string): PathSegment[] =>
  pointer
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));

const show = (v: unknown) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

function describe(e: ErrorObject): string {
  const parent = e.parentSchema as { description?: string; title?: string } | undefined;
  switch (e.keyword) {
    case 'required':
      return `missing required field "${(e.params as { missingProperty: string }).missingProperty}"`;
    case 'additionalProperties':
      return `unknown field "${(e.params as { additionalProperty: string }).additionalProperty}"`;
    case 'enum':
      return `${show(e.data)} is not allowed; expected one of ${(e.params as { allowedValues: unknown[] }).allowedValues.map(show).join(', ')}`;
    case 'type':
      return `${show(e.data)} must be ${(e.params as { type: string | string[] }).type.toString().replace(',', ' or ')}`;
    case 'oneOf':
    case 'anyOf':
    case 'pattern':
      return parent?.description ? `${show(e.data)} is not valid. ${parent.description}` : `${show(e.data)} ${e.message ?? 'is not valid'}`;
    case 'format':
      return `${show(e.data)} is not a valid ${(e.params as { format: string }).format}`;
    case 'uniqueItems':
      return 'contains duplicate entries';
    default:
      return e.message ?? 'is not valid';
  }
}

/** Validates a parsed file against its schema and returns readable issues, one per problem. */
export function schemaIssues(kind: FileKind, data: unknown): SchemaIssue[] {
  const validate = getValidators()[kind];
  if (validate(data)) return [];
  const errors = validate.errors ?? [];
  // A failing oneOf also reports every branch's error; keep only the summary.
  const isAlt = (e: ErrorObject) => e.keyword === 'oneOf' || e.keyword === 'anyOf';
  const oneOfPaths = new Set(errors.filter(isAlt).map((e) => e.instancePath));
  const issues: SchemaIssue[] = [];
  const seen = new Set<string>();
  // A oneOf summary is noise when one of its branches already reported something deeper and more specific.
  const hasDeeper = (p: string) => errors.some((x) => x.instancePath.startsWith(`${p}/`));
  for (const e of errors) {
    if (!isAlt(e) && oneOfPaths.has(e.instancePath) && /\/(oneOf|anyOf)\//.test(e.schemaPath)) continue;
    if (isAlt(e) && hasDeeper(e.instancePath)) continue;
    let path = pointerToPath(e.instancePath);
    let key = false;
    if (e.keyword === 'additionalProperties') {
      path = [...path, (e.params as { additionalProperty: string }).additionalProperty];
      key = true;
    }
    const message = describe(e);
    const id = `${e.instancePath}|${message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    issues.push({ path, key, message });
  }
  return issues;
}
