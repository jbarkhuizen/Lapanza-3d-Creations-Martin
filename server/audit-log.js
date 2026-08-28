import { randomUUID } from 'crypto';
import { getDb } from './db.js';

export const AUDIT_EVENTS = {
  SETUP: 'setup',
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILURE: 'login_failure',
  LOGOUT: 'logout',
  SESSION_EXPIRED: 'session_expired',
  ADMIN_CREATED: 'admin_created',
  ADMIN_DELETED: 'admin_deleted',
  PASSWORD_RESET: 'password_reset',
  // Covers every outbound-email call site that was previously a silent
  // console.error only (order/verification/reset/newsletter/design-request/
  // low-stock notifications) -- visible in the admin "Audit Logs" page
  // instead of requiring server-log/SSH access to ever notice a send failed.
  EMAIL_FAILURE: 'email_failure',

  // Deliberately fewer, broader buckets rather than one enum value per
  // route (order status vs tracking vs manual-creation, filament vs colour
  // vs category product, etc) -- with ~25 instrumented routes across
  // orders/stock/catalog/settings, a one-event-per-route enum would make
  // the Audit Logs filter dropdown unusably long. The specific action
  // always lives in `detail` (e.g. `Order abc123: status Pending -> Paid`);
  // filter by these four to narrow by area, then read/search `detail` for
  // the specifics.
  ORDER_UPDATED: 'order_updated',
  STOCK_UPDATED: 'stock_updated',
  CATALOG_UPDATED: 'catalog_updated',
  SETTINGS_UPDATED: 'settings_updated',
  MARKETING_UPDATED: 'marketing_updated',

  // Backlog #120: previously console.error-only, invisible short of SSHing
  // into the VPS and reading the systemd journal. See server/alerts.js for
  // the actual alerting decision (these audit rows are recorded
  // unconditionally, for visibility, regardless of whether an alert email
  // fires for a given occurrence).
  BACKUP_FAILURE: 'backup_failure',
  PAYMENT_FAILURE: 'payment_failure',
  CHECKOUT_ERROR: 'checkout_error',

  // Security/abuse signals -- passive logging only (no email alert), same
  // reasoning as everything else on this page: visible when you look,
  // not something that pages you.
  CLIENT_LOGIN_FAILURE: 'client_login_failure',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  // Only fires when there's no session cookie at all (a probe/bot hitting
  // an admin API path directly, never having been through login) -- NOT
  // for a cookie that exists but points at a since-expired/restarted
  // session (that's the existing, unrelated SESSION_EXPIRED case). This
  // distinction is what keeps it a real signal instead of firing on every
  // admin's first request after a routine server restart (see the
  // "in-memory session store" tradeoff, Won't Fix #4).
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
};

// How long audit_log rows are kept before startAuditLogPruneJob (server/jobs.js)
// removes them -- the widened logging added alongside this (orders/stock/
// catalog/settings actions, plus security signals) meaningfully raises the
// row count, closing backlog tech-debt #32's "no retention" gap for this
// table specifically (page_views is a separate, still-open part of #32).
export const AUDIT_LOG_RETENTION_MONTHS = 12;

export function pruneOldAuditLogEntries(monthsToKeep = AUDIT_LOG_RETENTION_MONTHS, db = getDb()) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsToKeep);
  const result = db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(cutoff.toISOString());
  return result.changes;
}

function rowToEntry(row) {
  return {
    id: row.id,
    eventType: row.event_type,
    adminId: row.admin_id,
    username: row.username,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

// Called from request handlers after the real work (login, logout, admin
// management) already happened -- a broken audit write must never surface
// as a failure of the action it's recording, so this catches and logs
// rather than throwing. If the DB itself is down, every other route on the
// request is about to fail anyway; this just avoids being the first domino.
export function recordAuditEvent({ eventType, adminId = null, username = null, ip = null, userAgent = null, detail = '' }, db = getDb()) {
  try {
    db.prepare(
      `INSERT INTO audit_log (id, event_type, admin_id, username, ip_address, user_agent, detail, created_at)
       VALUES (@id, @event_type, @admin_id, @username, @ip_address, @user_agent, @detail, @created_at)`,
    ).run({
      id: randomUUID(),
      event_type: eventType,
      admin_id: adminId,
      username,
      ip_address: ip,
      user_agent: userAgent,
      detail: detail || '',
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('audit-log: failed to record event', eventType, err);
  }
}

// limit caps the query, not just the response, so a years-old install with
// a huge audit_log can't turn "open the Audit Logs page" into a multi-second
// full-table read -- 1000 is generously above what one admin reviews in a
// sitting; older entries are still there, just need a narrower eventType/q
// filter (or a smaller date range once one exists) to reach them.
export function listAuditLog({ eventType, q, limit = 500 } = {}, db = getDb()) {
  const clauses = [];
  const params = {};
  if (eventType) {
    clauses.push('event_type = @eventType');
    params.eventType = eventType;
  }
  if (q && q.trim()) {
    clauses.push('(username LIKE @q OR ip_address LIKE @q OR detail LIKE @q)');
    params.q = `%${q.trim()}%`;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const parsedLimit = Number(limit);
  params.limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 1000) : 500;
  // rowid tiebreaks created_at -- two events in the same request/test can
  // land on the same millisecond, and only rowid (SQLite's own insertion
  // order) is guaranteed monotonic then, same reasoning as version_history's
  // version_number tiebreak.
  const rows = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC, rowid DESC LIMIT @limit`).all(params);
  return rows.map(rowToEntry);
}
