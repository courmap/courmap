import type { DataStatus } from './data.js';
import type { SonarrStatus } from './sonarr.js';
import { mappingYaml } from './assist.js';
import type { AssistedEntry, IndexerStats, Stats, UnresolvedEntry } from './stats.js';

export interface StatusInput {
  version: string;
  data: DataStatus;
  sonarr: SonarrStatus;
  stats: Stats;
  indexers: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${Math.round((a / b) * 1000) / 10}%`);

/** The JSON behind the status page. */
export function statusJson(s: StatusInput) {
  return {
    version: s.version,
    started: s.stats.started,
    data: s.data,
    sonarr: s.sonarr,
    indexers: Object.fromEntries(s.indexers.map((n) => [n, s.stats.of(n)])),
    unresolved: s.stats.unresolvedList(),
    assisted: s.stats.assistedList(),
  };
}

/**
 * A GitHub issue body, for the user to paste (nothing is sent automatically): unresolved names,
 * and every Sonarr-assisted mapping as the data/works override a contributor PR would add.
 */
export function issueText(list: UnresolvedEntry[], dataVersion: string | null, assisted: AssistedEntry[] = [], max = 50): string {
  const cell = (t: string) => t.replace(/\|/g, '\\|');
  const out = [`Reported from the Courmap proxy, data version ${dataVersion ?? 'unknown'}. Please check everything before posting.`];
  if (list.length > 0) {
    out.push(
      '',
      '### Release names Courmap could not resolve',
      '',
      '| Release name | Seen | Result |',
      '| --- | --- | --- |',
      ...list.slice(0, max).map((e) => `| \`${cell(e.name)}\` | ${e.count} | ${e.status}: ${cell(e.detail)} |`),
      ...(list.length > max ? ['', `${list.length - max} more not listed.`] : []),
    );
  }
  if (assisted.length > 0) {
    out.push('', '### Mappings numbered with Sonarr\'s help', '', 'The data has no TVDB projection for these works; this proxy derived one from Sonarr. Each block is a `data/works/` override ready for a pull request once checked on TVDB.');
    for (const a of assisted.slice(0, max)) {
      out.push('', `${a.mapping.work}: used ${a.count} times, for example \`${cell(a.examples[0] ?? '')}\``, '', '```yaml', mappingYaml(a.mapping), '```');
    }
  }
  return out.join('\n');
}

/** The proxy's status page: data version, refreshes, hit rates and unresolved names. */
export function statusHtml(s: StatusInput): string {
  const row = (name: string, x: IndexerStats) => {
    const passed = Object.entries(x.passed)
      .sort((a, b) => b[1]! - a[1]!)
      .map(([k, v]) => `${esc(k)} ${v}`)
      .join(', ');
    return `<tr><td>${esc(name)}</td><td>${x.requests}</td><td>${x.searches} (${x.translated} translated)</td><td>${x.items}</td><td>${x.rewritten} (${pct(x.rewritten, x.items)})${x.assisted ? `, ${x.assisted} assisted` : ''}</td><td>${passed || '0'}</td><td>${x.upstreamErrors}</td></tr>`;
  };
  const list = s.stats.unresolvedList();
  const assisted = s.stats.assistedList();
  const issue = issueText(list, s.data.dataVersion, assisted);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Courmap proxy</title>
<style>
  :root { --ink: #16181D; --paper: #F4F1EA; --accent: #E04E39; --muted: #6f6b63; --line: #d9d4c9; }
  @media (prefers-color-scheme: dark) { :root { --ink: #F4F1EA; --paper: #16181D; --muted: #A9A59C; --line: #33363d; } }
  body { margin: 0; padding: 24px 16px; background: var(--paper); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; } h1 span { color: var(--accent); }
  h2 { font-size: 16px; margin: 28px 0 8px; }
  .muted { color: var(--muted); }
  .bad { color: var(--accent); }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  td code { word-break: break-all; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
  dt { color: var(--muted); }
  textarea { width: 100%; box-sizing: border-box; min-height: 160px; font: 13px/1.4 ui-monospace, monospace; background: transparent; color: inherit; border: 1px solid var(--line); padding: 8px; }
  button { font: inherit; padding: 6px 12px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
</style>
</head>
<body>
<main>
<h1>Courmap <span>proxy</span></h1>
<p class="muted">Version ${esc(s.version)}, running since ${esc(s.stats.started)}. This page is local: nothing on it is sent anywhere.</p>

<h2>Data</h2>
<dl>
  <dt>Data version</dt><dd>${s.data.dataVersion ? esc(s.data.dataVersion) : '<span class="bad">none loaded: every release passes through unchanged</span>'}</dd>
  <dt>Last check</dt><dd>${esc(s.data.lastCheck ?? 'never')}</dd>
  <dt>Last change</dt><dd>${esc(s.data.lastChange ?? 'never')}</dd>
  ${s.data.lastError ? `<dt>Last error</dt><dd class="bad">${esc(s.data.lastError)}</dd>` : ''}
  <dt>Sonarr</dt><dd>${s.sonarr.configured ? `${s.sonarr.series} series, refreshed ${esc(s.sonarr.lastRefresh ?? 'never')}` : '<span class="bad">not configured</span>'}</dd>
  ${s.sonarr.lastError ? `<dt>Sonarr error</dt><dd class="bad">${esc(s.sonarr.lastError)}</dd>` : ''}
</dl>

<h2>Indexers</h2>
<div class="scroll"><table>
<tr><th>Path</th><th>Requests</th><th>Searches</th><th>Items</th><th>Rewritten</th><th>Passed through</th><th>Upstream errors</th></tr>
${s.indexers.map((n) => row(n, s.stats.of(n))).join('\n')}
</table></div>

<h2>Assisted numbering (${assisted.length})</h2>
<p class="muted">Works the data has no TVDB projection for, numbered from your Sonarr's episode list. Local to this install; the copy block below turns them into mapping contributions.</p>
${
  assisted.length === 0
    ? '<p class="muted">None so far.</p>'
    : `<div class="scroll"><table><tr><th>Work</th><th>Sonarr series</th><th>How</th><th>Used</th><th>Example</th></tr>
${assisted.slice(0, 200).map((a) => `<tr><td><code>${esc(a.mapping.work)}</code></td><td>${esc(a.mapping.series.title)} (TVDB ${a.mapping.series.tvdbId})</td><td>${a.mapping.method === 'first-season' ? 'first season' : 'absolute'}, by ${a.mapping.matchedBy === 'tvdb-id' ? 'TVDB ID' : 'title'}</td><td>${a.count}</td><td><code>${esc(a.examples[0] ?? '')}</code></td></tr>`).join('\n')}
</table></div>`
}

<h2>Unresolved release names (${list.length})</h2>
${
  list.length === 0
    ? '<p class="muted">None so far.</p>'
    : `<div class="scroll"><table><tr><th>Release name</th><th>Seen</th><th>Result</th><th>Last seen</th></tr>
${list.slice(0, 200).map((e) => `<tr><td><code>${esc(e.name)}</code></td><td>${e.count}</td><td>${esc(e.status)}: ${esc(e.detail)}</td><td>${esc(e.lastSeen)}</td></tr>`).join('\n')}
</table></div>`
}
${
  list.length + assisted.length === 0
    ? ''
    : `<h2>Copy as GitHub issue</h2>
<p class="muted">Paste this into a new issue at github.com/courmap/courmap if you want to help. Check it first; nothing is reported automatically.</p>
<textarea id="issue" readonly>${esc(issue)}</textarea>
<p><button type="button" onclick="navigator.clipboard.writeText(document.getElementById('issue').value).then(()=>{this.textContent='Copied'})">Copy</button></p>`
}
<h2>Export</h2>
<p class="muted"><a href="/export.json">export.json</a> (unresolved and assisted names, with details) or <a href="/export.txt">export.txt</a> (one release name per line), for <code>pnpm corpus:from-proxy</code> in the Courmap repository.</p>
</main>
</body>
</html>
`;
}
