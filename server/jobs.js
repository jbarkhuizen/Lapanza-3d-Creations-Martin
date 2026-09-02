import { cancelStalePendingOrders } from './orders.js';
import { createBackup, pruneOldBackups, syncOffsite } from './backups.js';
import { pruneOldAuditLogEntries, AUDIT_LOG_RETENTION_MONTHS, recordAuditEvent, AUDIT_EVENTS } from './audit-log.js';
import { pruneOldPageViews, PAGE_VIEWS_RETENTION_MONTHS } from './analytics.js';
import { sendOrderCancelledNotificationEmail } from './mailer.js';
import { alertBackupFailure } from './alerts.js';
import { pruneExpiredDesignFiles } from './design-requests.js';
import { deleteDesignRequestFile } from './uploads.js';
import { getSettings } from './settings.js';

const HOUR_MS = 60 * 60 * 1000;
const CANCEL_AFTER_MS = 7 * 24 * HOUR_MS; // 7 days
const BACKUP_INTERVAL_MS = 24 * HOUR_MS; // daily
const BACKUP_RETENTION_COUNT = 30; // ~1 month of daily backups
const AUDIT_PRUNE_INTERVAL_MS = 24 * HOUR_MS; // daily
const PAGE_VIEWS_PRUNE_INTERVAL_MS = 24 * HOUR_MS; // daily

// G.2: this project has no external process manager, cron, or container
// orchestrator -- it runs as a single persistent `node server/index.js`
// process (see start.mjs/start.bat/README: the whole site is launched by
// double-clicking start.bat, which just runs `npm run dev:all` and leaves
// it running). An in-process setInterval is the right fit here; there's no
// external scheduler to hit an endpoint instead, and adding one (e.g.
// node-cron) would be a dependency for something setInterval already does.
// onCancelled: optional callback invoked once per run when this actually
// cancelled (and so restored stock for) at least one order -- lets the
// caller (server/index.js, which owns publishCatalog/scheduleCatalogPublish
// and can't be imported here without a circular dependency) republish the
// storefront so its stock badges pick up the restored quantities. Not
// awaited: same fire-and-forget reasoning as the notification emails below.
export function startAutoCancelJob(intervalMs = HOUR_MS, onCancelled) {
  async function run() {
    let cancelled = [];
    try {
      cancelled = cancelStalePendingOrders(CANCEL_AFTER_MS);
      if (cancelled.length > 0) console.log(`Auto-cancel: cancelled ${cancelled.length} stale pending_payment order(s)`);
    } catch (err) {
      console.error('Auto-cancel job failed:', err);
      return;
    }
    if (cancelled.length > 0) {
      try {
        onCancelled?.(cancelled);
      } catch (err) {
        console.error('Auto-cancel job: onCancelled callback failed:', err);
      }
    }
    // Separate from the cancel transaction above -- a Gmail hiccup here
    // must never be mistaken for the cancel itself having failed, and one
    // order's failed notification shouldn't skip the rest.
    for (const order of cancelled) {
      try {
        await sendOrderCancelledNotificationEmail(order, 'Automatically cancelled — unpaid after 7 days');
      } catch (err) {
        console.error(`Order ${order.id} cancelled-notification email failed to send:`, err.message);
      }
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
      recordAuditEvent({ eventType: AUDIT_EVENTS.BACKUP_FAILURE, detail: `Local backup: ${err.message}` });
      alertBackupFailure('Local database backup', err).catch(() => {});
      return; // don't sync a possibly-broken local backup set offsite
    }
    // Separate try/catch: an offsite hiccup (network, rclone not yet
    // configured on a fresh box, remote quota) must never be reported as
    // "the backup failed" -- the local backup above already succeeded.
    try {
      await syncOffsite();
      console.log('Auto-backup: synced to offsite remote');
    } catch (err) {
      console.error('Offsite backup sync failed (local backup still succeeded):', err.message);
      recordAuditEvent({ eventType: AUDIT_EVENTS.BACKUP_FAILURE, detail: `Offsite sync: ${err.message}` });
      alertBackupFailure('Offsite backup sync', err).catch(() => {});
    }
  }
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

// Same shape again -- keeps audit_log from growing forever now that it
// covers a lot more than just admin login/session events (see AUDIT_EVENTS
// in server/audit-log.js). Runs once on boot too, same as the jobs above.
export function startAuditLogPruneJob(intervalMs = AUDIT_PRUNE_INTERVAL_MS, monthsToKeep = AUDIT_LOG_RETENTION_MONTHS) {
  function run() {
    try {
      const pruned = pruneOldAuditLogEntries(monthsToKeep);
      if (pruned > 0) console.log(`Audit-log prune: removed ${pruned} entr${pruned === 1 ? 'y' : 'ies'} older than ${monthsToKeep} months`);
    } catch (err) {
      console.error('Audit-log prune job failed:', err);
    }
  }
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

// Same shape again, closing the other half of backlog #32. Only prunes raw
// page_views detail rows -- analytics_page_totals/analytics_seen_visitors
// (server/analytics.js's getVisitSummary "all-time" figures) are permanent
// running tallies updated on every pageview and are never touched here, so
// pruning old detail rows doesn't quietly shrink the Analytics dashboard's
// all-time numbers.
export function startPageViewsPruneJob(intervalMs = PAGE_VIEWS_PRUNE_INTERVAL_MS, monthsToKeep = PAGE_VIEWS_RETENTION_MONTHS) {
  function run() {
    try {
      const pruned = pruneOldPageViews(monthsToKeep);
      if (pruned > 0) console.log(`Page-views prune: removed ${pruned} row(s) older than ${monthsToKeep} months`);
    } catch (err) {
      console.error('Page-views prune job failed:', err);
    }
  }
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

// Backlog #90 (SITE-056/057): daily sweep deleting uploaded design files
// for requests finalized longer ago than settings.designFileRetentionMonths
// (admin-editable; the privacy policy states the same figure). Same
// in-process shape as every other job here; audit-logged per batch so the
// deletion trail is inspectable. deleteFile is injectable (defaults to the
// real deleteDesignRequestFile) so tests can verify the sweep without
// touching the real public/uploads/design-requests directory -- that
// path is a module-level constant resolved from cwd at import time
// (uploads.js), so it can't be redirected by a test's own process.chdir()
// after the fact the way DB-backed state can.
export function startDesignFilePruneJob(intervalMs = 24 * 60 * 60 * 1000, deleteFile = deleteDesignRequestFile) {
  function run() {
    try {
      const months = getSettings().designFileRetentionMonths;
      const pruned = pruneExpiredDesignFiles(months, deleteFile);
      if (pruned.length > 0) {
        console.log(`Design-file prune: removed uploads for ${pruned.length} finalized request(s) older than ${months} months`);
        recordAuditEvent({
          eventType: AUDIT_EVENTS.SETTINGS_UPDATED,
          username: 'system',
          detail: `Design-file retention prune: deleted uploaded files for ${pruned.length} request(s) finalized > ${months} months ago (ids: ${pruned.join(', ')})`,
        });
      }
    } catch (err) {
      console.error('Design-file prune job failed:', err);
    }
  }
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
