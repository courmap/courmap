// The Worker entry. workerd reads every named export of this module as a handler, so the API
// lives in api.ts, the schedule watchdog in watchdog.ts, and only the default export is here.
import { handle } from './api.js';
import { report, watchdog, type WatchdogEnv, type WatchdogResult } from './watchdog.js';

export default {
  fetch: handle,
  async scheduled(event: { cron: string; scheduledTime: number }, env: WatchdogEnv): Promise<void> {
    const now = new Date(event.scheduledTime);
    let result: WatchdogResult;
    try {
      result = await watchdog(event.cron, env, now);
    } catch (err) {
      const job = event.cron;
      result = { job, workflow: '', action: 'error', detail: err instanceof Error ? err.message : String(err) };
    }
    console.log(`watchdog ${event.cron}: ${result.job} ${result.workflow} ${result.action} ${result.detail}`);
    // The decision, as a GitHub run, so nobody needs the Cloudflare logs.
    const reported = await report(result, env, now).catch(() => false);
    if (!reported && result.action !== 'disabled') console.log('watchdog report could not be dispatched');
  },
};
