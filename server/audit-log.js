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
};

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
