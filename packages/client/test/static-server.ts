import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

export interface StaticServer {
  /** Base URL of the /v1/ root, with a trailing slash. */
  url: string;
  /** Paths requested so far, relative to the root. */
  requests: string[];
  /** When set, every request whose path starts with this prefix fails with HTTP 500. */
  failPrefix: string | null;
  close(): Promise<void>;
}

/** Serves `root` under /v1/ on a random local port, the way R2 would serve the shards. */
export async function serveStatic(root: string): Promise<StaticServer> {
  const state = { requests: [] as string[], failPrefix: null as string | null };
  const server: Server = createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/v1\//, '');
    state.requests.push(rel);
    if (state.failPrefix !== null && rel.startsWith(state.failPrefix)) {
      res.writeHead(500).end();
      return;
    }
    const file = path.resolve(root, rel);
    if (!file.startsWith(path.resolve(root) + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': 'application/json' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1/`,
    get requests() {
      return state.requests;
    },
    get failPrefix() {
      return state.failPrefix;
    },
    set failPrefix(v) {
      state.failPrefix = v;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
