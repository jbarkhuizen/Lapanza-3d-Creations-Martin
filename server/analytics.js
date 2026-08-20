import { randomUUID } from 'crypto';
import { getDb } from './db.js';

const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes with no beacon = no longer "active"

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
  db.prepare(
    `INSERT INTO page_views (id, visitor_id, client_id, path, referrer, created_at)
     VALUES (@id, @visitor_id, @client_id, @path, @referrer, @created_at)`,
  ).run({
    id,
    visitor_id: cleanVisitorId,
    client_id: clientId || null,
    path: cleanPath.slice(0, 300),
    referrer: String(referrer || '').slice(0, 300),
    created_at: now,
  });
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
  const totalVisits = db.prepare('SELECT COUNT(*) c FROM page_views').get().c;
  const uniqueVisitorsAllTime = db.prepare('SELECT COUNT(DISTINCT visitor_id) c FROM page_views').get().c;
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
    .prepare('SELECT path, COUNT(*) AS visits FROM page_views GROUP BY path ORDER BY visits DESC LIMIT 10')
    .all();
  return { totalVisits, uniqueVisitorsAllTime, todayVisits, dailyVisits, topPages };
}
