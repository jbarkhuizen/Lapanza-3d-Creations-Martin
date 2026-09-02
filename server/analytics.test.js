import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { createClient } from './clients.js';
import {
  recordEvent,
  getEventSummary,
  pruneOldPageViews,
  ANALYTICS_EVENT_TYPES,
  recordPageView,
  touchActiveVisitor,
  pruneActiveVisitors,
  getActiveVisitors,
  getVisitSummary,
  _activeVisitorsMap,
} from './analytics.js';

// The active-visitor map is module-level (deliberately, see analytics.js) --
// clear it before every test that touches it so tests can't see each
// other's state.
function resetActive() {
  _activeVisitorsMap().clear();
}

test('recordPageView writes a row and requires visitorId + path', () => {
  const db = openDb(':memory:');
  const { id } = recordPageView({ visitorId: 'v1', path: '/toys.html', referrer: 'https://google.com' }, db);
  assert.ok(id);
  const row = db.prepare('SELECT * FROM page_views WHERE id = ?').get(id);
  assert.strictEqual(row.visitor_id, 'v1');
  assert.strictEqual(row.path, '/toys.html');
  assert.strictEqual(row.referrer, 'https://google.com');
  assert.strictEqual(row.client_id, null);

  assert.throws(() => recordPageView({ visitorId: '', path: '/x' }, db), /visitorId is required/);
  assert.throws(() => recordPageView({ visitorId: 'v2', path: '' }, db), /path is required/);
  db.close();
});

test('recordPageView attaches clientId when provided', () => {
  const db = openDb(':memory:');
  const client = createClient({ email: 'shopper@example.com', name: 'Shopper' }, db);
  recordPageView({ visitorId: 'v1', clientId: client.id, path: '/account.html' }, db);
  const row = db.prepare('SELECT client_id FROM page_views WHERE visitor_id = ?').get('v1');
  assert.strictEqual(row.client_id, client.id);
  db.close();
});

test('recordPageView also marks the visitor active', () => {
  resetActive();
  const db = openDb(':memory:');
  recordPageView({ visitorId: 'v1', path: '/index.html' }, db);
  const active = getActiveVisitors(db);
  assert.strictEqual(active.totalActive, 1);
  db.close();
});

test('touchActiveVisitor without a DB write still counts as active', () => {
  resetActive();
  const db = openDb(':memory:');
  touchActiveVisitor({ visitorId: 'v1', path: '/toys.html' });
  const active = getActiveVisitors(db);
  assert.strictEqual(active.totalActive, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM page_views').get().c, 0);
  db.close();
});

test('getActiveVisitors splits anonymous vs registered and resolves client names', () => {
  resetActive();
  const db = openDb(':memory:');
  const client = createClient({ email: 'known@example.com', name: 'Known Customer' }, db);
  touchActiveVisitor({ visitorId: 'anon-1', path: '/toys.html' });
  touchActiveVisitor({ visitorId: 'anon-2', path: '/homeware.html' });
  touchActiveVisitor({ visitorId: 'known-1', clientId: client.id, path: '/account.html' });

  const active = getActiveVisitors(db);
  assert.strictEqual(active.totalActive, 3);
  assert.strictEqual(active.anonymousActive, 2);
  assert.strictEqual(active.registeredActive, 1);
  assert.strictEqual(active.activeClients.length, 1);
  assert.strictEqual(active.activeClients[0].name, 'Known Customer');
  assert.strictEqual(active.activeClients[0].email, 'known@example.com');
  assert.strictEqual(active.activeClients[0].path, '/account.html');
  db.close();
});

test('pruneActiveVisitors removes entries older than the window, keeps recent ones', () => {
  resetActive();
  touchActiveVisitor({ visitorId: 'stale', path: '/x' });
  // Backdate it directly rather than waiting -- same map, same shape.
  _activeVisitorsMap().get('stale').lastSeenAt = Date.now() - 10 * 60 * 1000;
  touchActiveVisitor({ visitorId: 'fresh', path: '/y' });

  pruneActiveVisitors(5 * 60 * 1000);
  const remaining = [..._activeVisitorsMap().keys()];
  assert.deepStrictEqual(remaining, ['fresh']);
});

test('getVisitSummary computes totals, today, unique visitors, daily breakdown, and top pages', () => {
  const db = openDb(':memory:');
  recordPageView({ visitorId: 'v1', path: '/toys.html' }, db);
  recordPageView({ visitorId: 'v1', path: '/toys.html' }, db);
  recordPageView({ visitorId: 'v2', path: '/homeware.html' }, db);

  const summary = getVisitSummary(db);
  assert.strictEqual(summary.totalVisits, 3);
  assert.strictEqual(summary.uniqueVisitorsAllTime, 2);
  assert.strictEqual(summary.todayVisits, 3);
  assert.strictEqual(summary.dailyVisits.length, 1);
  assert.strictEqual(summary.dailyVisits[0].visits, 3);
  assert.strictEqual(summary.dailyVisits[0].uniqueVisitors, 2);
  assert.strictEqual(summary.topPages[0].path, '/toys.html');
  assert.strictEqual(summary.topPages[0].visits, 2);
  db.close();
});

test('getVisitSummary returns zeroes/empty arrays on a database with no visits', () => {
  const db = openDb(':memory:');
  const summary = getVisitSummary(db);
  assert.strictEqual(summary.totalVisits, 0);
  assert.strictEqual(summary.uniqueVisitorsAllTime, 0);
  assert.strictEqual(summary.todayVisits, 0);
  assert.deepStrictEqual(summary.dailyVisits, []);
  assert.deepStrictEqual(summary.topPages, []);
  db.close();
});

test('pruneOldPageViews removes only page_views rows older than the retention window, leaving the permanent all-time tallies untouched', () => {
  const db = openDb(':memory:');
  recordPageView({ visitorId: 'v1', path: '/toys.html' }, db);
  recordPageView({ visitorId: 'v2', path: '/homeware.html' }, db);
  // Backdate one row directly (recordPageView always stamps "now") to
  // simulate a pageview from well outside the retention window.
  db.prepare('UPDATE page_views SET created_at = ? WHERE visitor_id = ?').run(
    new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(), // ~13 months ago
    'v1',
  );

  const removed = pruneOldPageViews(12, db);
  assert.strictEqual(removed, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM page_views').get().c, 1);

  // The whole point: all-time totals/top-pages/unique-visitors must still
  // reflect both original pageviews, even though one detail row is gone.
  const summary = getVisitSummary(db);
  assert.strictEqual(summary.totalVisits, 2);
  assert.strictEqual(summary.uniqueVisitorsAllTime, 2);
  assert.strictEqual(summary.topPages.length, 2);
  db.close();
});

test('a repeat visit from the same visitor does not inflate uniqueVisitorsAllTime', () => {
  const db = openDb(':memory:');
  recordPageView({ visitorId: 'v1', path: '/toys.html' }, db);
  recordPageView({ visitorId: 'v1', path: '/homeware.html' }, db);
  recordPageView({ visitorId: 'v1', path: '/phones.html' }, db);
  const summary = getVisitSummary(db);
  assert.strictEqual(summary.totalVisits, 3);
  assert.strictEqual(summary.uniqueVisitorsAllTime, 1);
  db.close();
});

test('recordEvent enforces the fixed vocabulary and getEventSummary reports 30-day funnel counts (#113)', () => {
  const db = openDb(':memory:');
  assert.strictEqual(recordEvent({ visitorId: 'v1', eventType: 'made_up_event' }, db), false);
  assert.ok(ANALYTICS_EVENT_TYPES.includes('payment_complete'));
  recordEvent({ visitorId: 'v1', eventType: 'add_to_cart', path: '/filament/pla.html', detail: 'filament:pla:sku1' }, db);
  recordEvent({ visitorId: 'v1', eventType: 'add_to_cart' }, db);
  recordEvent({ visitorId: 'v2', eventType: 'checkout_start' }, db);
  recordEvent({ eventType: 'payment_complete', detail: 'order:abc' }, db);
  const summary = getEventSummary(db);
  const byType = Object.fromEntries(summary.map((e) => [e.eventType, e]));
  assert.strictEqual(byType.add_to_cart.count, 2);
  assert.strictEqual(byType.add_to_cart.uniqueVisitors, 1);
  assert.strictEqual(byType.checkout_start.count, 1);
  assert.strictEqual(byType.payment_complete.count, 1);
  // every vocabulary type is present even at zero, so the admin funnel
  // always shows the full ladder
  assert.strictEqual(summary.length, ANALYTICS_EVENT_TYPES.length);
  assert.strictEqual(byType.quote_submit.count, 0);
  db.close();
});

test('pruneOldPageViews also prunes old analytics_events on the same cycle', () => {
  const db = openDb(':memory:');
  recordEvent({ visitorId: 'v1', eventType: 'add_to_cart' }, db);
  db.prepare("UPDATE analytics_events SET created_at = '2020-01-01T00:00:00.000Z'").run();
  pruneOldPageViews(12, db);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM analytics_events').get().c, 0);
  db.close();
});

// Owner request (2026-09-02): hourly visits/unique-visitors series for the
// Analytics chart -- always exactly 24 zero-filled buckets, current traffic
// landing in the newest bucket.
test('getVisitSummary.hourlyTraffic returns 24 buckets with current visits in the last one', () => {
  const db = openDb(':memory:');
  recordPageView({ visitorId: 'v1', path: '/' }, db);
  recordPageView({ visitorId: 'v1', path: '/toys.html' }, db);
  recordPageView({ visitorId: 'v2', path: '/' }, db);
  const { hourlyTraffic } = getVisitSummary(db);
  assert.strictEqual(hourlyTraffic.length, 24);
  assert.ok(hourlyTraffic.every((h) => /^\d\d:00$/.test(h.hour)));
  const last = hourlyTraffic[hourlyTraffic.length - 1];
  assert.strictEqual(last.visits, 3);
  assert.strictEqual(last.uniqueVisitors, 2);
  assert.strictEqual(hourlyTraffic.slice(0, 23).reduce((n, h) => n + h.visits, 0), 0);
  db.close();
});
