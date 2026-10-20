/**
 * Keeps secrets out of everything the proxy prints or shows: log lines, the status page and its
 * JSON, the exports, and error messages. Two layers, because an error message can carry either a
 * key the proxy was given or one it only saw in a URL:
 *   1. every secret it knows (the Sonarr API key, indexer keys, and the `apikey` Sonarr sends with
 *      each request) is replaced wherever it occurs;
 *   2. anything shaped like a secret is masked: credential parameters in URLs (`apikey=...`,
 *      `token=...`), user:password in a URL, `X-Api-Key: ...` headers, and `api_key: ...` lines (a
 *      YAML parse error quotes the line it fails on).
 *
 * Feeds are not passed through this: a result's download link carries the indexer's own key and
 * must reach Sonarr as it is.
 */

const MASK = '***';
/** Shorter values are not treated as secrets: replacing them everywhere would mangle ordinary text. */
const MIN_SECRET_LENGTH = 6;

const SECRET_PARAMS = 'apikey|api_key|api-key|apitoken|api_token|token|passkey|rsskey|secret|password|passwd|auth|authkey|access_token';

// The value of a credential parameter in a URL or query string: ?apikey=VALUE, &token=VALUE.
const QUERY_PARAM = new RegExp(String.raw`([?&;\s"'(](?:${SECRET_PARAMS})=)[^&\s"'<>)]+`, 'gi');
// Newznab download links name the key "r" (and only there, so it must follow ? or & directly).
const R_PARAM = /([?&]r=)[^&\s"'<>)]+/g;
// user:password@ in a URL.
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
// X-Api-Key: VALUE, Authorization: Bearer VALUE.
const HEADER = /\b(x-api-key|authorization|x-auth-token)(\s*[:=]\s*)(?:bearer\s+|basic\s+)?[^\s,;"']+/gi;
// api_key: VALUE (a config line quoted in an error).
const CONFIG_LINE = new RegExp(String.raw`\b(${SECRET_PARAMS})(["']?\s*:\s*["']?)[^\s"',}\]]+`, 'gi');

export class Redactor {
  private readonly secrets = new Set<string>();

  constructor(...initial: (string | null | undefined)[]) {
    this.add(...initial);
  }

  /** Registers secrets to mask. Empty and very short values are ignored. */
  add(...values: (string | null | undefined)[]): void {
    for (const v of values) if (typeof v === 'string' && v.length >= MIN_SECRET_LENGTH) this.secrets.add(v);
  }

  /** Registers the credential parameters found in a URL (an indexer URL may carry its key as ?apikey=). */
  addFromUrl(url: string): void {
    for (const m of url.matchAll(new RegExp(String.raw`[?&](?:${SECRET_PARAMS}|r)=([^&\s]+)`, 'gi'))) this.add(decodeURIComponentSafe(m[1]!), m[1]);
    const userinfo = /^[a-z][a-z0-9+.-]*:\/\/([^\s/@:]+):([^\s/@]+)@/i.exec(url);
    if (userinfo) this.add(decodeURIComponentSafe(userinfo[2]!), userinfo[2]);
  }

  redact(text: string): string {
    let out = text;
    // Longest first, so a secret that contains another is masked whole.
    for (const s of [...this.secrets].sort((a, b) => b.length - a.length)) out = out.split(s).join(MASK);
    return out
      .replace(URL_USERINFO, `$1${MASK}@`)
      .replace(QUERY_PARAM, `$1${MASK}`)
      .replace(R_PARAM, `$1${MASK}`)
      .replace(HEADER, `$1$2${MASK}`)
      .replace(CONFIG_LINE, `$1$2${MASK}`);
  }
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const SECRET_ENV = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS)(?:$|_)/i;

/** A redactor that already knows every secret in the environment (variables named like a key, token or password, and keys inside any `*_URL`). */
export function redactorFromEnv(env: NodeJS.ProcessEnv): Redactor {
  const r = new Redactor();
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (SECRET_ENV.test(name)) r.add(value);
    if (/_URL$/i.test(name)) r.addFromUrl(value);
  }
  return r;
}

/** Turns a thrown value into a redacted one-line description, for startup failures. */
export const describeError = (redactor: Redactor, err: unknown): string => redactor.redact(err instanceof Error ? (err.stack ?? err.message) : String(err));
