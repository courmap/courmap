import { describe, expect, it } from 'vitest';
import { fetchWithRetry } from '../scripts/retry.js';

const sleep = async () => {};
const reply = (status: number) => new Response('{}', { status });

describe('fetchWithRetry', () => {
  it('retries a connection reset and returns the later answer', async () => {
    let calls = 0;
    const f = (async () => {
      if (++calls < 3) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
      return reply(200);
    }) as unknown as typeof fetch;
    expect((await fetchWithRetry('http://x', { fetch: f, sleep })).status).toBe(200);
    expect(calls).toBe(3);
  });

  it('retries 502, 503 and 504', async () => {
    const seq = [502, 503, 504, 200];
    const f = (async () => reply(seq.shift()!)) as unknown as typeof fetch;
    expect((await fetchWithRetry('http://x', { fetch: f, sleep, attempts: 4 })).status).toBe(200);
  });

  it('does not retry an answer the library could also give', async () => {
    for (const status of [200, 400, 404, 409, 429, 500]) {
      let calls = 0;
      const f = (async () => (calls++, reply(status))) as unknown as typeof fetch;
      expect((await fetchWithRetry('http://x', { fetch: f, sleep })).status).toBe(status);
      expect(calls).toBe(1);
    }
  });

  it('gives up after the last attempt: the error is thrown, a persistent 503 is returned', async () => {
    let calls = 0;
    const down = (async () => (calls++, Promise.reject(new TypeError('fetch failed')))) as unknown as typeof fetch;
    await expect(fetchWithRetry('http://x', { fetch: down, sleep, attempts: 3 })).rejects.toThrow('fetch failed');
    expect(calls).toBe(3);
    const busy = (async () => reply(503)) as unknown as typeof fetch;
    expect((await fetchWithRetry('http://x', { fetch: busy, sleep, attempts: 2 })).status).toBe(503);
  });

  it('waits longer after each failure', async () => {
    const waits: number[] = [];
    const f = (async () => reply(503)) as unknown as typeof fetch;
    await fetchWithRetry('http://x', { fetch: f, attempts: 3, backoffMs: 100, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([100, 200]);
  });
});
