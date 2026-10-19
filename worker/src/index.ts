// The Worker entry. workerd reads every named export of this module as a handler, so the API
// lives in api.ts, the schedule watchdog in watchdog.ts, and only the default export is here.
import { handle } from './api.js';
import { watchdog, type WatchdogEnv } from './watchdog.js';

export default {
  fetch: handle,
  async scheduled(event: { cron: string; scheduledTime: number }, env: WatchdogEnv): Promise<void> {
    const r = await watchdog(event.cron, env, new Date(event.scheduledTime));
    console.log(`watchdog ${event.cron}: ${r.workflow} ${r.action}`);
  },
};
