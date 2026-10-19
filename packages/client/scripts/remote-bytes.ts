// Bytes a remote resolve downloads, measured against a local copy of the shard tree.
// Usage: tsx --conditions=@courmap/source packages/client/scripts/remote-bytes.ts <shards/v1> "<release name>" ...
import { serveStatic } from '../test/static-server.js';
import { createRemoteClient } from '../src/index.js';

const [root, ...names] = process.argv.slice(2);
if (!root || names.length === 0) {
  console.error('usage: remote-bytes.ts <shards/v1> "<release name>" ...');
  process.exit(1);
}
const server = await serveStatic(root);
try {
  for (const name of names) {
    let bytes = 0;
    const files: string[] = [];
    const counting: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      const body = await res.arrayBuffer();
      bytes += body.byteLength;
      files.push(String(input).replace(server.url, ''));
      return new Response(body, { status: res.status, headers: res.headers });
    };
    // A fresh client per name: nothing cached, as for a first visit to the try-it box.
    const r = await createRemoteClient(server.url, { fetch: counting }).resolve(name);
    console.log(`${name}\n  ${r.status} ${r.match?.work ?? ''} ${r.match?.episode ?? ''}: ${files.length} files, ${bytes} bytes (${files.join(', ')})`);
  }
} finally {
  await server.close();
}
