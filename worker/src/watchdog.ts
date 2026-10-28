/**
 * A watchdog for GitHub's scheduled workflows (decision S7.3). GitHub runs schedules on a best
 * effort basis and may drop them under load; the first scheduled bots scan (2026-10-19 07:30 UTC)
 * never ran. A Cloudflare Cron Trigger fires this 30 minutes after each GitHub schedule: if the
 * job has not run today (by schedule or by hand), it dispatches it. Without the
 * GITHUB_DISPATCH_TOKEN secret (fine-grained, Actions: write on courmap/courmap, and on courmap/status for
 * the uptime check) it does nothing.
 *
 * Every decision is made visible in GitHub: after each check the watchdog dispatches the
 * watchdog-report workflow, whose run name says what was checked and what was done (see report()),
 * so nobody needs the Cloudflare logs.
 */

export interface WatchdogEnv {
  GITHUB_DISPATCH_TOKEN?: string;
}

export interface Watched {
  /** The job's name in reports. */
  job: string;
  workflow: string;
  /** Only runs whose title contains this count as the job having run (bots.yml has two jobs). */
  match?: string;
  inputs?: Record<string, string>;
  /** Another repository's workflow (it needs its own access on the token). The default is courmap/courmap. */
  repo?: string;
  /** Judge by the latest run's age instead of "ran today": dispatch if it is older than this many minutes. */
  maxAgeMinutes?: number;
}

/** Cloudflare cron expression to the GitHub job it backs up. Keep in sync with wrangler.toml. */
export const WATCHED: Record<string, Watched> = {
  '53 7 * * *': { job: 'scan', workflow: 'bots.yml', match: 'scan', inputs: { job: 'scan' } }, // bots.yml scan at 07:23
  '47 6 * * 2': { job: 'seed', workflow: 'seed.yml' }, // seed.yml at 06:17 on Tuesdays
  '43 9 * * 2': { job: 'release', workflow: 'release.yml' }, // release.yml at 09:13 on Tuesdays
  '17 11 * * 2': { job: 'weekly', workflow: 'bots.yml', match: 'weekly', inputs: { job: 'weekly' } }, // bots.yml weekly at 10:47 on Tuesdays
  // The Upptime uptime check behind status.courmap.com runs every 5 minutes; GitHub drops some of those runs, and a
  // stale status page is worse than none. Every 30 minutes, dispatch it if its last run is older than 30 minutes.
  '11,41 * * * *': { job: 'uptime', workflow: 'uptime.yml', repo: 'courmap/status', maxAgeMinutes: 30 },
};

const REPO = 'courmap/courmap';
const REPORT_WORKFLOW = 'watchdog-report.yml';

export type WatchdogAction = 'disabled' | 'already-ran' | 'dispatched' | 'unknown-cron' | 'error';

export interface WatchdogResult {
  job: string;
  workflow: string;
  action: WatchdogAction;
  /** What was found, in a sentence: the run that already happened, or why nothing could be done. */
  detail: string;
}

interface Run {
  id: number;
  display_title?: string;
  name?: string;
  event: string;
  status: string;
  conclusion: string | null;
  created_at: string;
}

const headersOf = (token: string) => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'courmap-watchdog', 'X-GitHub-Api-Version': '2022-11-28' });

export async function watchdog(cron: string, env: WatchdogEnv, now: Date, fetchFn: typeof fetch = (i, init) => fetch(i, init)): Promise<WatchdogResult> {
  const w = WATCHED[cron];
  if (!w) return { job: '', workflow: '', action: 'unknown-cron', detail: `no job is watched for cron "${cron}"` };
  const base = { job: w.job, workflow: w.workflow };
  if (!env.GITHUB_DISPATCH_TOKEN) return { ...base, action: 'disabled', detail: 'GITHUB_DISPATCH_TOKEN is not set on the Worker, so nothing is checked' };
  const headers = headersOf(env.GITHUB_DISPATCH_TOKEN);
  const repo = w.repo ?? REPO;
  const today = now.toISOString().slice(0, 10);
  const age = w.maxAgeMinutes;
  // A job judged by age looks at the latest run whatever its event; the others at today's runs.
  const query = age === undefined ? `created=%3E%3D${today}&per_page=30` : 'per_page=1';
  const runs = await fetchFn(`https://api.github.com/repos/${repo}/actions/workflows/${w.workflow}/runs?${query}`, { headers });
  if (!runs.ok) throw new Error(`GitHub runs for ${repo} ${w.workflow}: HTTP ${runs.status}${runs.status === 404 ? ' (does the token have access to that repository?)' : ''}`);
  const found = (((await runs.json()) as { workflow_runs?: Run[] }).workflow_runs ?? []).filter((r) => !w.match || (r.display_title ?? r.name ?? '').includes(w.match));
  const latest = found[0];
  if (latest && (age === undefined || now.getTime() - Date.parse(latest.created_at) <= age * 60_000)) {
    return { ...base, action: 'already-ran', detail: `run ${latest.id} (${latest.event}, ${latest.conclusion ?? latest.status}) at ${latest.created_at}` };
  }
  // Another repository may not be on main (Upptime's is master): ask for its default branch.
  let ref = 'main';
  if (w.repo) {
    const info = await fetchFn(`https://api.github.com/repos/${repo}`, { headers });
    if (!info.ok) throw new Error(`GitHub repository ${repo}: HTTP ${info.status}`);
    ref = ((await info.json()) as { default_branch?: string }).default_branch ?? 'main';
  }
  const res = await fetchFn(`https://api.github.com/repos/${repo}/actions/workflows/${w.workflow}/dispatches`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref, ...(w.inputs && { inputs: w.inputs }) }),
  });
  if (res.status !== 204) throw new Error(`dispatching ${repo} ${w.workflow}: HTTP ${res.status}${res.status === 403 || res.status === 404 ? ' (needs Actions: write on that repository)' : ''}`);
  const why = age === undefined ? `no ${w.job} run today (${today})` : latest ? `its last run (${latest.created_at}) is older than ${age} minutes` : 'it has no runs';
  return { ...base, action: 'dispatched', detail: `${why}, so ${repo} ${w.workflow} was dispatched` };
}

/**
 * Makes a decision visible in GitHub: dispatches watchdog-report.yml, a workflow that only records
 * its inputs. Its run name reads "watchdog scan: dispatched" and its summary has the detail.
 * Best effort: a failing report never hides the decision itself, which is also logged.
 */
export async function report(result: WatchdogResult, env: WatchdogEnv, now: Date, fetchFn: typeof fetch = (i, init) => fetch(i, init)): Promise<boolean> {
  if (!env.GITHUB_DISPATCH_TOKEN || result.action === 'unknown-cron') return false;
  const res = await fetchFn(`https://api.github.com/repos/${REPO}/actions/workflows/${REPORT_WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { ...headersOf(env.GITHUB_DISPATCH_TOKEN), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref: 'main',
      inputs: { job: result.job, workflow: result.workflow, action: result.action, detail: result.detail.slice(0, 400), checked_at: now.toISOString() },
    }),
  });
  return res.status === 204;
}
