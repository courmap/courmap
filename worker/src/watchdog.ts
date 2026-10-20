/**
 * A watchdog for GitHub's scheduled workflows (decision S7.3). GitHub runs schedules on a best
 * effort basis and may drop them under load; the first scheduled bots scan (2026-10-19 07:30 UTC)
 * never ran. A Cloudflare Cron Trigger fires this 30 minutes after each GitHub schedule: if the
 * job has not run today (by schedule or by hand), it dispatches it. Without the
 * GITHUB_DISPATCH_TOKEN secret (fine-grained, Actions: write on courmap/courmap) it does nothing.
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
}

/** Cloudflare cron expression to the GitHub job it backs up. Keep in sync with wrangler.toml. */
export const WATCHED: Record<string, Watched> = {
  '53 7 * * *': { job: 'scan', workflow: 'bots.yml', match: 'scan', inputs: { job: 'scan' } }, // bots.yml scan at 07:23
  '47 6 * * 2': { job: 'seed', workflow: 'seed.yml' }, // seed.yml at 06:17 on Tuesdays
  '43 9 * * 2': { job: 'release', workflow: 'release.yml' }, // release.yml at 09:13 on Tuesdays
  '17 11 * * 2': { job: 'weekly', workflow: 'bots.yml', match: 'weekly', inputs: { job: 'weekly' } }, // bots.yml weekly at 10:47 on Tuesdays
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
  const today = now.toISOString().slice(0, 10);
  const runs = await fetchFn(`https://api.github.com/repos/${REPO}/actions/workflows/${w.workflow}/runs?created=%3E%3D${today}&per_page=30`, { headers });
  if (!runs.ok) throw new Error(`GitHub runs for ${w.workflow}: HTTP ${runs.status}`);
  const found = (((await runs.json()) as { workflow_runs?: Run[] }).workflow_runs ?? []).filter((r) => !w.match || (r.display_title ?? r.name ?? '').includes(w.match));
  if (found.length > 0) {
    const r = found[0]!;
    return { ...base, action: 'already-ran', detail: `run ${r.id} (${r.event}, ${r.conclusion ?? r.status}) at ${r.created_at}` };
  }
  const res = await fetchFn(`https://api.github.com/repos/${REPO}/actions/workflows/${w.workflow}/dispatches`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', ...(w.inputs && { inputs: w.inputs }) }),
  });
  if (res.status !== 204) throw new Error(`dispatching ${w.workflow}: HTTP ${res.status}`);
  return { ...base, action: 'dispatched', detail: `no ${w.job} run today (${today}), so ${w.workflow} was dispatched` };
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
