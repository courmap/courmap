// One request to the deployed Worker, retried on what a flaky network or a deploy in progress produce: a connection
// reset or timeout, and a 502, 503 or 504. Any other answer (a 4xx the library also gives, a 429 the caller waits out)
// is returned as it is, so a real difference between the Worker and the library is never retried away.
export interface RetryOptions {
  attempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const TRANSIENT = new Set([502, 503, 504]);

export async function fetchWithRetry(url: string, opts: RetryOptions = {}): Promise<Response> {
  const attempts = opts.attempts ?? 4;
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 1; ; i++) {
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
      if (!TRANSIENT.has(res.status) || i >= attempts) return res;
    } catch (err) {
      if (i >= attempts) throw err;
    }
    await sleep((opts.backoffMs ?? 2000) * i);
  }
}
