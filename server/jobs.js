import { cancelStalePendingOrders } from './orders.js';
import { createBackup, pruneOldBackups, syncOffsite } from './backups.js';

const HOUR_MS = 60 * 60 * 1000;
const CANCEL_AFTER_MS = 5 * 24 * HOUR_MS; // 5 days, per spec G.1
const BACKUP_INTERVAL_MS = 24 * HOUR_MS; // daily
const BACKUP_RETENTION_COUNT = 30; // ~1 month of daily backups

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

// Same in-process setInterval shape as startAutoCancelJob above -- no
// external cron/scheduler in this project. Runs once on boot too, so a
// freshly-deployed server has at least one backup within seconds rather
// than waiting a full day for the first one.
export function startAutoBackupJob(intervalMs = BACKUP_INTERVAL_MS, keep = BACKUP_RETENTION_COUNT) {
  async function run() {
    try {
      const backup = await createBackup();
      const pruned = pruneOldBackups(keep);
      console.log(`Auto-backup: created ${backup.filename}${pruned ? `, pruned ${pruned} old backup(s)` : ''}`);
    } catch (err) {
      console.error('Auto-backup job failed:', err);
      return; // don't sync a possibly-broken local backup set offsite
    }
    // Separate try/catch: an offsite hiccup (network, rclone not yet
    // configured on a fresh box, remote quota) must never be reported as
    // "the backup failed" -- the local backup above already succeeded.
    try {
      syncOffsite();
      console.log('Auto-backup: synced to offsite remote');
    } catch (err) {
      console.error('Offsite backup sync failed (local backup still succeeded):', err.message);
    }
  }
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
