import { cancelStalePendingOrders } from './orders.js';

const HOUR_MS = 60 * 60 * 1000;
const CANCEL_AFTER_MS = 5 * 24 * HOUR_MS; // 5 days, per spec G.1

// G.2: this project has no external process manager, cron, or container
// orchestrator -- it runs as a single persistent `node server/index.js`
// process (see start.mjs/start.bat/README: the whole site is launched by
// double-clicking start.bat, which just runs `npm run dev:all` and leaves
// it running). An in-process setInterval is the right fit here; there's no
// external scheduler to hit an endpoint instead, and adding one (e.g.
// node-cron) would be a dependency for something setInterval already does.
export function startAutoCancelJob(intervalMs = HOUR_MS) {
  function run() {
    try {
      const count = cancelStalePendingOrders(CANCEL_AFTER_MS);
      if (count > 0) console.log(`Auto-cancel: cancelled ${count} stale pending_payment order(s)`);
    } catch (err) {
      console.error('Auto-cancel job failed:', err);
    }
  }
  run(); // also run once immediately on boot, don't wait a full interval for the first pass
  const timer = setInterval(run, intervalMs);
  timer.unref?.(); // don't keep the process alive on its own if everything else has shut down
  return timer;
}
