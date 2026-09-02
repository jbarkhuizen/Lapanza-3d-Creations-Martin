import { randomUUID } from 'crypto';
import { getDb } from './db.js';

const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes with no beacon = no longer "active"
// How long raw page_views detail rows are kept before startPageViewsPruneJob
// (server/jobs.js) removes them -- backlog #32. Same window as audit_log's
// retention, chosen for consistency rather than a technical requirement.
export const PAGE_VIEWS_RETENTION_MONTHS = 12;

// Deliberately in-memory only, never persisted -- "who's on the site right
// now" has no historical value once they leave, and writing a row per
// ~45s heartbeat (see src/js/analytics.js) into page_views would bury the
// one metric that table actually needs to stay useful: real page loads.
// visitorId -> { clientId, path, lastSeenAt }
const activeVisitors = new Map();

export function touchActiveVisitor({ visitorId, clientId, path }) {
  if (!visitorId) return;
  activeVisitors.set(visitorId, { clientId: clientId || null, path: path || '', lastSeenAt: Date.now() });
}

export function pruneActiveVisitors(windowMs = ACTIVE_WINDOW_MS) {
  const cutoff = Date.now() - windowMs;
  for (const [visitorId, v] of activeVisitors) {
    if (v.lastSeenAt < cutoff) activeVisitors.delete(visitorId);
  }
}

// Exported for tests -- lets a test seed/inspect the map directly without
// going through a full beacon request.
export function _activeVisitorsMap() {
  return activeVisitors;
}

export function recordPageView({ visitorId, clientId, path, referrer }, db = getDb()) {
  const cleanVisitorId = String(visitorId || '').trim();
  const cleanPath = String(path || '').trim();
  if (!cleanVisitorId) throw new Error('visitorId is required');
  if (!cleanPath) throw new Error('path is required');
  const id = randomUUID();
  const now = new Date().toISOString();
  const truncatedPath = cleanPath.slice(0, 300);
  db.prepare(
    `INSERT INTO page_views (id, visitor_id, client_id, path, referrer, created_at)
     VALUES (@id, @visitor_id, @client_id, @path, @referrer, @created_at)`,
  ).run({
    id,
    visitor_id: cleanVisitorId,
    client_id: clientId || null,
    path: truncatedPath,
    referrer: String(referrer || '').slice(0, 300),
    created_at: now,
  });
  // Permanent tallies (see db.js's comment on these two tables) -- updated
  // alongside the page_views insert above so getVisitSummary's "all-time"
  // numbers stay accurate even after old page_views rows are pruned
  // (pruneOldPageViews below).
  db.prepare(
    `INSERT INTO analytics_page_totals (path, visit_count) VALUES (?, 1)
     ON CONFLICT(path) DO UPDATE SET visit_count = visit_count + 1`,
  ).run(truncatedPath);
  db.prepare('INSERT OR IGNORE INTO analytics_seen_visitors (visitor_id, first_seen_at) VALUES (?, ?)').run(cleanVisitorId, now);
  touchActiveVisitor({ visitorId: cleanVisitorId, clientId, path: cleanPath });
  return { id };
}

// "Active now" -- anonymous visitor count, registered-client count, and
// who those registered clients actually are (so an admin can see e.g. "3
// customers browsing right now" by name, not just a bare number).
export function getActiveVisitors(db = getDb()) {
  pruneActiveVisitors();
  const entries = [...activeVisitors.entries()];
  const registered = entries.filter(([, v]) => v.clientId);

  let activeClients = [];
  if (registered.length) {
    const clientIds = [...new Set(registered.map(([, v]) => v.clientId))];
    const placeholders = clientIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, name, email FROM clients WHERE id IN (${placeholders})`).all(...clientIds);
    const byId = new Map(rows.map((r) => [r.id, r]));
    activeClients = registered
      .map(([, v]) => ({
        clientId: v.clientId,
        name: byId.get(v.clientId)?.name || 'Unknown',
        email: byId.get(v.clientId)?.email || '',
        path: v.path,
        lastSeenAt: new Date(v.lastSeenAt).toISOString(),
      }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  return {
    totalActive: entries.length,
    anonymousActive: entries.length - registered.length,
    registeredActive: registered.length,
    activeClients,
  };
}

// Historical totals -- 'localtime' on every date grouping here matters: the
// server runs in SAST (UTC+2), and SQLite's date()/datetime() default to
// UTC, which silently shifts "today"/day-groupings by a calendar day near
// midnight otherwise (this exact class of bug already bit invoice-date
// import once in this project -- see docs/SYSTEM_DOCUMENTATION.md 12.5).
export function getVisitSummary(db = getDb()) {
  // "All-time" figures read from the permanent tally tables, NOT page_views
  // directly -- page_views itself is subject to pruneOldPageViews below, so
  // COUNT(*) FROM page_views would quietly turn "all-time" into "since the
  // last prune" the moment retention kicks in. today/last-30-days are
  // always well within the 12-month retention window, so those two still
  // read page_views directly.
  const totalVisits = db.prepare('SELECT COALESCE(SUM(visit_count), 0) c FROM analytics_page_totals').get().c;
  const uniqueVisitorsAllTime = db.prepare('SELECT COUNT(*) c FROM analytics_seen_visitors').get().c;
  const todayVisits = db
    .prepare("SELECT COUNT(*) c FROM page_views WHERE date(created_at, 'localtime') = date('now', 'localtime')")
    .get().c;
  const dailyVisits = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, COUNT(*) AS visits, COUNT(DISTINCT visitor_id) AS uniqueVisitors
       FROM page_views
       WHERE created_at >= datetime('now', '-30 days')
       GROUP BY day
       ORDER BY day DESC`,
    )
    .all();
  const topPages = db
    .prepare('SELECT path, visit_count AS visits FROM analytics_page_totals ORDER BY visit_count DESC LIMIT 10')
    .all();
  // Owner request (2026-09-02): visits + unique visitors per hour over the
  // last 24 hours, for the Analytics chart. Same 'localtime' convention as
  // todayVisits/dailyVisits above (sqlite and Node both use the server's
  // TZ, so the zero-filled bucket keys line up). Buckets with no traffic
  // are filled with zeros so the chart always shows a full 24-hour axis.
  const hourlyRows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d %H', created_at, 'localtime') AS bucket,
              COUNT(*) AS visits, COUNT(DISTINCT visitor_id) AS uniqueVisitors
       FROM page_views
       WHERE created_at >= datetime('now', '-24 hours')
       GROUP BY bucket`,
    )
    .all();
  const byBucket = new Map(hourlyRows.map((r) => [r.bucket, r]));
  const pad = (n) => String(n).padStart(2, '0');
  const hourlyTraffic = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.now() - i * 3600 * 1000);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}`;
    const row = byBucket.get(key);
    hourlyTraffic.push({ hour: `${pad(d.getHours())}:00`, visits: row?.visits || 0, uniqueVisitors: row?.uniqueVisitors || 0 });
  }
  return { totalVisits, uniqueVisitorsAllTime, todayVisits, dailyVisits, topPages, hourlyTraffic };
}

// ---- Conversion events (backlog #113 / SITE-079) ----
// Fixed vocabulary -- the beacon route validates against this list, so a
// client can never invent event types. payment_complete is recorded
// SERVER-side only (the Payfast ITN handler, inside its existing
// changed-flag dedupe, so ITN redeliveries never double-count).
export const ANALYTICS_EVENT_TYPES = ['add_to_cart', 'checkout_start', 'quote_submit', 'whatsapp_click', 'payment_complete'];

export function recordEvent({ visitorId = '', clientId = null, eventType, path = '', detail = '' }, db = getDb()) {
  if (!ANALYTICS_EVENT_TYPES.includes(eventType)) return false;
  db.prepare(
    `INSERT INTO analytics_events (id, visitor_id, client_id, event_type, path, detail, created_at)
     VALUES (@id, @visitor_id, @client_id, @event_type, @path, @detail, @created_at)`,
  ).run({
    id: randomUUID(),
    visitor_id: String(visitorId || '').slice(0, 64),
    client_id: clientId,
    event_type: eventType,
    path: String(path || '').slice(0, 300),
    detail: String(detail || '').slice(0, 300),
    created_at: new Date().toISOString(),
  });
  return true;
}

// Owner request (2026-09-02): the funnel and top pages are range-selectable.
// A fixed vocabulary, validated here, so a range string can never reach SQL.
export const ANALYTICS_RANGES = {
  '1h': "'-1 hour'",
  '24h': "'-24 hours'",
  '7d': "'-7 days'",
  '30d': "'-30 days'",
};

function rangeModifier(range, fallback = '30d') {
  return ANALYTICS_RANGES[range] || ANALYTICS_RANGES[fallback];
}

// Funnel counts for the chosen range, plus distinct visitors per step --
// enough for the admin's "where do buyers drop off" read without any
// per-person view.
export function getEventSummary(range = '30d', db = getDb()) {
  const rows = db
    .prepare(
      `SELECT event_type AS eventType, COUNT(*) AS count, COUNT(DISTINCT visitor_id) AS uniqueVisitors
       FROM analytics_events
       WHERE created_at >= datetime('now', ${rangeModifier(range)})
       GROUP BY event_type`,
    )
    .all();
  const byType = Object.fromEntries(rows.map((r) => [r.eventType, r]));
  return ANALYTICS_EVENT_TYPES.map((t) => ({ eventType: t, count: byType[t]?.count || 0, uniqueVisitors: byType[t]?.uniqueVisitors || 0 }));
}

// Range-windowed top pages come from page_views directly (fine within the
// 12-month retention window); 'all' keeps reading the permanent
// analytics_page_totals tallies, which pruning never touches.
export function getTopPages(range = 'all', db = getDb()) {
  if (!ANALYTICS_RANGES[range]) {
    return db.prepare('SELECT path, visit_count AS visits FROM analytics_page_totals ORDER BY visit_count DESC LIMIT 10').all();
  }
  return db
    .prepare(
      `SELECT path, COUNT(*) AS visits
       FROM page_views
       WHERE created_at >= datetime('now', ${rangeModifier(range)})
       GROUP BY path
       ORDER BY visits DESC
       LIMIT 10`,
    )
    .all();
}

// Detail rows only -- analytics_page_totals/analytics_seen_visitors are
// permanent by design (see db.js's comment on those two tables) and are
// never touched here. analytics_events shares page_views' retention cycle.
export function pruneOldPageViews(monthsToKeep = PAGE_VIEWS_RETENTION_MONTHS, db = getDb()) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsToKeep);
  const result = db.prepare('DELETE FROM page_views WHERE created_at < ?').run(cutoff.toISOString());
  db.prepare('DELETE FROM analytics_events WHERE created_at < ?').run(cutoff.toISOString());
  return result.changes;
}
