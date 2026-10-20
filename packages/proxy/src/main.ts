#!/usr/bin/env node
import { loadConfig } from './config.js';
import { DataManager } from './data.js';
import { describeError, redactorFromEnv } from './redact.js';
import { createProxyServer } from './server.js';
import { SonarrClient } from './sonarr.js';
import { Stats } from './stats.js';

/** Replaced at bundle time for the Docker image; "dev" when run from source. */
declare const COURMAP_PROXY_VERSION: string | undefined;
const version = typeof COURMAP_PROXY_VERSION === 'string' ? COURMAP_PROXY_VERSION : 'dev';

// Everything printed goes through the redactor: the Sonarr and indexer API keys never reach a log,
// not even inside an error message (no secret in any log line, page or export).
const redactor = redactorFromEnv(process.env);
const log = (l: string) => console.log(`${new Date().toISOString()} ${redactor.redact(l)}`);
const fail = (what: string, err: unknown): never => {
  console.error(`${new Date().toISOString()} ${what}: ${describeError(redactor, err)}`);
  process.exit(1);
};
process.on('uncaughtException', (err) => fail('crashed', err));
process.on('unhandledRejection', (err) => fail('crashed', err));
let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (err) {
  config = fail('invalid configuration', err);
}
redactor.add(config.sonarr?.apiKey);
for (const i of config.indexers) {
  redactor.add(i.apikey);
  redactor.addFromUrl(i.url);
}
if (config.indexers.length === 0) log('no indexers configured: set INDEXER_<NAME>_URL or list indexers in the config file');
const data = new DataManager({ dataDir: config.dataDir, metaUrl: config.metaUrl, dump: config.dump, refreshHours: config.refreshHours, log });
const sonarr = new SonarrClient(config.sonarr ? { ...config.sonarr, timeoutMs: config.timeoutMs } : null);
const stats = Stats.in(config.dataDir);
const server = createProxyServer({ indexers: config.indexers, data, sonarr, stats, version, timeoutMs: config.timeoutMs, log, redactor });

server.listen(config.port, () => {
  log(`Courmap proxy ${version} on port ${config.port}; indexers: ${config.indexers.map((i) => `/${i.name}`).join(', ') || 'none'}`);
});
// Data and Sonarr load in the background; until then releases pass through unchanged.
void data.start().then(() => log(data.status.dataVersion ? `data ${data.status.dataVersion}` : `no data yet: ${data.status.lastError ?? 'unknown error'}`));
void sonarr.start().then(() => log(sonarr.status.lastError ? `Sonarr: ${sonarr.status.lastError}` : `Sonarr: ${sonarr.status.series} series`));

const shutdown = () => {
  log('shutting down');
  server.close();
  data.stop();
  sonarr.stop();
  void stats.save().finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
