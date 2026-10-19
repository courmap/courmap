/**
 * A watchdog for GitHub's scheduled workflows (decision S7.3). GitHub runs schedules on a best
 * effort basis and may drop them under load; the first scheduled bots scan (2026-10-19 07:30 UTC)
 * never ran. A Cloudflare Cron Trigger fires this 30 minutes after each GitHub schedule: if the
 * workflow has not run today (by schedule or by hand), it dispatches it. Without the
 * GITHUB_DISPATCH_TOKEN secret (fine-grained, Actions: write on courmap/courmap) it does nothing.
 */

export interface WatchdogEnv {
  GITHUB_DISPATCH_TOKEN?: string;
}

/** Cloudflare cron expression to the GitHub workflow it backs up. Keep in sync with wrangler.toml. */
export const WATCHED: Record<string, { workflow: string; inputs?: Record<string, string> }> = {
  '53 7 * * *': { workflow: 'bots.yml', inputs: { job: 'scan' } }, // bots.yml scan at 07:23
  '47 6 * * 2': { workflow: 'seed.yml' }, // seed.yml at 06:17 on Tuesdays
  '43 9 * * 2': { workflow: 'release.yml' }, // release.yml at 09:13 on Tuesdays
};

const REPO = 'courmap/courmap';

export interface WatchdogResult {
  workflow: string;
  action: 'disabled' | 'already-ran' | 'dispatched' | 'unknown-cron';
}

export async function watchdog(cron: string, env: WatchdogEnv, now: Date, fetchFn: typeof fetch = (i, init) => fetch(i, init)): Promise<WatchdogResult> {
  const w = WATCHED[cron];
  if (!w) return { workflow: '', action: 'unknown-cron' };
  if (!env.GITHUB_DISPATCH_TOKEN) return { workflow: w.workflow, action: 'disabled' };
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, 'User-Agent': 'courmap-watchdog', 'X-GitHub-Api-Version': '2022-11-28' };
  const today = now.toISOString().slice(0, 10);
  const runs = await fetchFn(`https://api.github.com/repos/${REPO}/actions/workflows/${w.workflow}/runs?created=%3E%3D${today}&per_page=1`, { headers });
  if (!runs.ok) throw new Error(`GitHub runs for ${w.workflow}: HTTP ${runs.status}`);
  if (((await runs.json()) as { total_count: number }).total_count > 0) return { workflow: w.workflow, action: 'already-ran' };
  const res = await fetchFn(`https://api.github.com/repos/${REPO}/actions/workflows/${w.workflow}/dispatches`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', ...(w.inputs && { inputs: w.inputs }) }),
  });
  if (res.status !== 204) throw new Error(`dispatching ${w.workflow}: HTTP ${res.status}`);
  return { workflow: w.workflow, action: 'dispatched' };
}
