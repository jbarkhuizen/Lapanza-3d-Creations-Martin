import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, ensureSchema, getDb, closeAllCachedDbs } from './db.js';

test('ensureSchema creates every expected table', () => {
  const db = openDb(':memory:');
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepStrictEqual(tables, [
    'admins',
    'analytics_events',
    'analytics_page_totals',
    'analytics_seen_visitors',
    'audit_log',
    'clients',
    'design_requests',
    'filament_colours',
    'filament_types',
    'in_house_filament',
    'newsletter_assets',
    'newsletter_campaign_recipients',
    'newsletter_campaigns',
    'newsletter_subscribers',
    'newsletter_suppressions',
    'newsletter_templates',
    'order_items',
    'orders',
    'page_views',
    'payment_transactions',
    'print_job_filaments',
    'print_jobs',
    'purchases',
    'resources',
    'settings',
    'shipping_options',
    'test_run_cases',
    'test_runs',
    'testimonials',
    'todo_items',
    'version_history',
    'version_release_details',
    'whatsapp_campaigns',
  ]);
  db.close();
});

test('ensureSchema is idempotent (safe to call twice)', () => {
  const db = openDb(':memory:');
  assert.doesNotThrow(() => ensureSchema(db));
  db.close();
});

test('analytics_page_totals/analytics_seen_visitors are backfilled once from pre-existing page_views history, not left empty', () => {
  const db = openDb(':memory:'); // ensureSchema already ran here -- tables exist, page_views is empty, backfill was a no-op
  // Simulate a production DB that already had real traffic before this
  // migration shipped -- insert page_views rows directly, bypassing
  // recordPageView (which would populate the tally tables itself and mask
  // the bug this backfill exists to prevent: the tally tables silently
  // starting at zero and making "all-time" totals reset on deploy).
  const insert = db.prepare('INSERT INTO page_views (id, visitor_id, path, referrer, created_at) VALUES (?, ?, ?, ?, ?)');
  insert.run('r1', 'v1', '/toys.html', '', '2026-01-01T00:00:00.000Z');
  insert.run('r2', 'v1', '/toys.html', '', '2026-01-02T00:00:00.000Z');
  insert.run('r3', 'v2', '/homeware.html', '', '2026-01-01T12:00:00.000Z');

  // Re-running ensureSchema is exactly what happens on the next boot after
  // this code deploys to a server that already has page_views history.
  ensureSchema(db);

  const totals = db.prepare('SELECT path, visit_count FROM analytics_page_totals ORDER BY path').all();
  assert.deepStrictEqual(totals, [
    { path: '/homeware.html', visit_count: 1 },
    { path: '/toys.html', visit_count: 2 },
  ]);
  const visitors = db.prepare('SELECT visitor_id, first_seen_at FROM analytics_seen_visitors ORDER BY visitor_id').all();
  assert.strictEqual(visitors.length, 2);
  assert.strictEqual(visitors[0].first_seen_at, '2026-01-01T00:00:00.000Z'); // earliest of v1's two rows, not the latest

  // Running it a third time must not double-count -- the guard is "only
  // while analytics_page_totals is still empty", and it's not empty anymore.
  ensureSchema(db);
  const totalsAfterAgain = db.prepare('SELECT visit_count FROM analytics_page_totals WHERE path = ?').get('/toys.html');
  assert.strictEqual(totalsAfterAgain.visit_count, 2);
  db.close();
});

test('design_requests status remap collapses the old 6-stage funnel into new/in_progress/finalized on boot', () => {
  const db = openDb(':memory:'); // ensureSchema already ran -- table exists, no rows to remap yet
  const insert = db.prepare(
    "INSERT INTO design_requests (id, name, email, phone, description, status, updated_at, created_at) VALUES (?, 'C', 'c@example.com', '0821234567', 'x', ?, ?, ?)",
  );
  insert.run('r1', 'in_review', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  insert.run('r2', 'quoted', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  insert.run('r3', 'accepted', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  insert.run('r4', 'rejected', '2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  insert.run('r5', 'completed', '2026-01-03T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  insert.run('r6', 'new', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

  // Re-running ensureSchema is exactly what happens on the next boot after
  // this remap ships to a server with real pre-existing design requests.
  ensureSchema(db);

  const rows = db.prepare('SELECT id, status, finalized_at FROM design_requests ORDER BY id').all();
  assert.deepStrictEqual(rows, [
    { id: 'r1', status: 'in_progress', finalized_at: null },
    { id: 'r2', status: 'in_progress', finalized_at: null },
    { id: 'r3', status: 'in_progress', finalized_at: null },
    { id: 'r4', status: 'finalized', finalized_at: '2026-01-02T00:00:00.000Z' }, // backfilled from updated_at
    { id: 'r5', status: 'finalized', finalized_at: '2026-01-03T00:00:00.000Z' },
    { id: 'r6', status: 'new', finalized_at: null },
  ]);
  db.close();
});

test('shipping_options category is backfilled from name/type on boot, but never overwrites a category an admin already set', () => {
  const db = openDb(':memory:');
  const insert = db.prepare(
    "INSERT INTO shipping_options (id, name, option_type, min_weight, max_weight, price, active, category, created_at, updated_at) VALUES (?, ?, ?, 0, NULL, 100, 1, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
  );
  insert.run('s1', 'PUDO Locker to Locker (Small)', 'fixed', '');
  insert.run('s2', 'Local delivery - 10km radius', 'fixed', '');
  insert.run('s3', 'Standard courier', 'auto_weight', '');
  insert.run('s4', 'Already categorised', 'fixed', 'Custom Category');

  ensureSchema(db);

  const rows = db.prepare('SELECT id, category FROM shipping_options ORDER BY id').all();
  assert.deepStrictEqual(rows, [
    { id: 's1', category: 'PUDO Locker' },
    { id: 's2', category: 'Local Delivery' },
    { id: 's3', category: 'Courier' },
    { id: 's4', category: 'Custom Category' }, // untouched -- already had a category
  ]);
  db.close();
});

test('filament_colours cascades delete when filament_types row is removed', () => {
  const db = openDb(':memory:');
  db.prepare(
    `INSERT INTO filament_types (id, slug, name, description, colour_note, specs_json, seo_title, seo_description, internal_notes, status, featured, sort_order, created_at, updated_at)
     VALUES ('t1','pla','PLA','','','[]','','','','published',0,0,'now','now')`,
  ).run();
  db.prepare(
    `INSERT INTO filament_colours (id, filament_type_id, name, hex, sku, weight_g, roll_length_m, price_rand, stock_qty, image_path, notes, sort_order, created_at, updated_at)
     VALUES ('c1','t1','White','','SKU-1',1000,NULL,299,5,NULL,'',0,'now','now')`,
  ).run();
  db.pragma('foreign_keys = ON');
  db.prepare('DELETE FROM filament_types WHERE id = ?').run('t1');
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM filament_colours').get();
  assert.strictEqual(remaining.n, 0);
  db.close();
});

test('getDb() caches per resolved path: different cwds get separate instances', async (t) => {
  const origCwd = process.cwd();
  const tmpDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'lapanza-test-'));
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lapanza-test-'));

  await t.after(() => {
    closeAllCachedDbs();
    process.chdir(origCwd);
    try {
      fs.rmSync(tmpDir1, { recursive: true, force: true });
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors
    }
  });

  process.chdir(tmpDir1);
  const db1a = getDb();

  process.chdir(tmpDir2);
  const db2 = getDb();

  process.chdir(tmpDir1);
  const db1b = getDb();

  // db1a and db1b should be the SAME cached instance (same cwd)
  assert.strictEqual(db1a, db1b, 'getDb() should return cached instance for same cwd');

  // db1a and db2 should be DIFFERENT instances (different cwds)
  assert.notStrictEqual(db1a, db2, 'getDb() should return different instances for different cwds');
});

test('getDb() surfaces a migration error loudly instead of silently leaving an empty db', async (t) => {
  const origCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapanza-test-'));

  await t.after(() => {
    closeAllCachedDbs();
    process.chdir(origCwd);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors
    }
  });

  process.chdir(tmpDir);
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  // Two filament products whose colours share a SKU -- violates the
  // filament_colours.sku UNIQUE constraint, so migration must fail partway
  // through instead of quietly leaving a fresh, empty database that later
  // presents as a successful (but data-less) first boot.
  const catalog = {
    version: 1,
    products: [
      {
        kind: 'filament',
        slug: 'pla',
        name: 'PLA',
        colours: [{ name: 'White', sku: 'DUPLICATE-SKU' }],
      },
      {
        kind: 'filament',
        slug: 'petg',
        name: 'PETG',
        colours: [{ name: 'Black', sku: 'DUPLICATE-SKU' }],
      },
    ],
  };
  fs.writeFileSync(path.join(tmpDir, 'data', 'catalog.json'), JSON.stringify(catalog, null, 2));

  assert.throws(() => getDb(), /UNIQUE constraint failed/);
});

test('getDb() removes the broken db file after a failed migration so the next boot retries', async (t) => {
  const origCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapanza-test-'));

  await t.after(() => {
    closeAllCachedDbs();
    process.chdir(origCwd);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors
    }
  });

  process.chdir(tmpDir);
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  // Same duplicate-SKU catalog as above, guaranteed to fail migration.
  const catalog = {
    version: 1,
    products: [
      {
        kind: 'filament',
        slug: 'pla',
        name: 'PLA',
        colours: [{ name: 'White', sku: 'DUPLICATE-SKU' }],
      },
      {
        kind: 'filament',
        slug: 'petg',
        name: 'PETG',
        colours: [{ name: 'Black', sku: 'DUPLICATE-SKU' }],
      },
    ],
  };
  fs.writeFileSync(path.join(tmpDir, 'data', 'catalog.json'), JSON.stringify(catalog, null, 2));

  const dbPath = path.join(tmpDir, 'data', 'lapanza.db');

  assert.throws(() => getDb(), /UNIQUE constraint failed/);
  // The just-created db file must not survive a failed migration -- if it
  // did, the next getDb() call would see `!fs.existsSync(dbPath)` as false,
  // skip migration entirely, and silently boot with an empty database.
  assert.strictEqual(fs.existsSync(dbPath), false, 'broken db file should be removed after failed migration');

  // A second boot attempt should therefore see isNew === true again and
  // retry migration (and fail the same way) rather than silently succeeding
  // with an empty db.
  assert.throws(() => getDb(), /UNIQUE constraint failed/);
  assert.strictEqual(fs.existsSync(dbPath), false, 'broken db file should still be removed after the retry');
});

test('getDb() caches per resolved path: same cwd returns same instance', async (t) => {
  const origCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapanza-test-'));

  await t.after(() => {
    closeAllCachedDbs();
    process.chdir(origCwd);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors
    }
  });

  process.chdir(tmpDir);
  const db1 = getDb();
  const db2 = getDb();
  const db3 = getDb();

  // All three calls should return the same cached instance
  assert.strictEqual(db1, db2, 'getDb() should return same instance on second call');
  assert.strictEqual(db2, db3, 'getDb() should return same instance on third call');
});
