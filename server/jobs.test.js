import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb, closeAllCachedDbs } from './db.js';
import { createFilament, addColour, getFilament } from './filaments.js';
import { createOrder } from './orders.js';
import { createShippingOption } from './shipping.js';
import { createBackup, listBackups } from './backups.js';
import { recordAuditEvent, AUDIT_EVENTS, listAuditLog } from './audit-log.js';
import { updateSettings } from './settings.js';
import { createDesignRequest } from './design-requests.js';
import {
  startAutoCancelJob,
  startAutoBackupJob,
  startAuditLogPruneJob,
  startPageViewsPruneJob,
  startDesignFilePruneJob,
} from './jobs.js';

function colourStock(filamentId, sku, db) {
  return getFilament(filamentId, db).colours.find((c) => c.sku === sku).stockQty;
}

// getDb() resolves its path from process.cwd() (server/paths.js's
// dataDir()), same cwd-isolation convention server/index.test.js's
// freshApp() relies on -- without chdir-ing into a scratch directory
// first, a test here would open (and mutate) the REAL local dev
// data/lapanza.db in the repo root. Never skip this. Promise-based (not
// try/finally around a bare call) so an async fn's awaits complete, and
// its assertions are actually reported, BEFORE cleanup tears down the
// scratch dir out from under it -- callers must `return withScratchCwd(...)`
// so node:test awaits the whole thing.
function withScratchCwd(fn) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-test-'));
  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  const originalCwd = process.cwd();
  process.chdir(tmpRoot);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      closeAllCachedDbs();
      process.chdir(originalCwd);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });
}

// Some jobs (startAutoBackupJob) do real async I/O (better-sqlite3's own
// backup API) inside a fire-and-forget run() that the caller never gets a
// promise handle to -- unlike the other jobs here, which are fully
// synchronous end to end (no await before their observable side effect),
// so there's nothing to poll for. Terminates as soon as the condition is
// met; the timeout is only a safety net against a real regression hanging
// the test rather than failing it fast.
async function waitFor(conditionFn, { timeoutMs = 2000, intervalMs = 20 } = {}) {
  const start = Date.now();
  for (;;) {
    if (await conditionFn()) return true;
    if (Date.now() - start >= timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

test('startAutoCancelJob invokes onCancelled exactly once per run, with the orders it cancelled (needed to trigger a catalog republish -- see index.js\'s scheduleCatalogPublish)', () =>
  withScratchCwd(() => {
    const db = getDb();
    createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
    const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
    const filamentWithColour = addColour(
      filament.id,
      { name: 'Stale', sku: 'PLA-STALE-1KG', priceRand: 299, weightG: 1000, stockQty: 5 },
      db,
    );
    const colour = filamentWithColour.colours[0];
    const productId = `filament:pla:${colour.sku}`;

    const order = createOrder(
      { client: { name: 'Customer', email: 'stale@example.com', phone: '0123456789' }, items: [{ productId, quantity: 2 }], paymentMethod: 'payfast_card' },
      db,
    );
    assert.strictEqual(colourStock(filament.id, colour.sku, db), 3); // reserved at creation
    db.prepare("UPDATE orders SET created_at = datetime('now', '-10 days') WHERE id = ?").run(order.id);

    const calls = [];
    // A huge interval so the recurring setInterval tick never fires during
    // this test -- only the one immediate run() on startup matters.
    // cancelStalePendingOrders() and the onCancelled callback both run
    // synchronously (no await before them inside jobs.js's run()), so by
    // the time startAutoCancelJob() returns, onCancelled has already fired
    // if anything was cancelled -- no polling needed.
    const timer = startAutoCancelJob(24 * 60 * 60 * 1000, (cancelled) => calls.push(cancelled));
    timer.unref?.();
    clearInterval(timer);

    assert.strictEqual(calls.length, 1, 'onCancelled must fire exactly once for a run that cancelled something');
    assert.strictEqual(calls[0].length, 1);
    assert.strictEqual(calls[0][0].id, order.id);
    assert.strictEqual(colourStock(filament.id, colour.sku, db), 5, 'stock restored before onCancelled fires');
  }));

test('startAutoCancelJob does not invoke onCancelled when nothing was cancelled', () =>
  withScratchCwd(() => {
    const db = getDb();
    createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
    const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
    const filamentWithColour = addColour(
      filament.id,
      { name: 'Fresh', sku: 'PLA-FRESH-1KG', priceRand: 299, weightG: 1000, stockQty: 5 },
      db,
    );
    const colour = filamentWithColour.colours[0];
    // A brand-new (not backdated) pending order -- not stale, must not be
    // auto-cancelled or reported to onCancelled.
    createOrder(
      { client: { name: 'Customer', email: 'fresh@example.com', phone: '0123456789' }, items: [{ productId: `filament:pla:${colour.sku}`, quantity: 1 }], paymentMethod: 'payfast_card' },
      db,
    );

    const calls = [];
    const timer = startAutoCancelJob(24 * 60 * 60 * 1000, (cancelled) => calls.push(cancelled));
    timer.unref?.();
    clearInterval(timer);

    assert.strictEqual(calls.length, 0, 'onCancelled must not fire when nothing was cancelled');
  }));

test('a throwing onCancelled callback is caught -- it must never prevent the cancellation itself or crash the job', () =>
  withScratchCwd(() => {
    const db = getDb();
    createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
    const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
    const filamentWithColour = addColour(
      filament.id,
      { name: 'Faulty', sku: 'PLA-FAULTY-1KG', priceRand: 299, weightG: 1000, stockQty: 5 },
      db,
    );
    const colour = filamentWithColour.colours[0];
    const order = createOrder(
      { client: { name: 'Customer', email: 'faulty@example.com', phone: '0123456789' }, items: [{ productId: `filament:pla:${colour.sku}`, quantity: 1 }], paymentMethod: 'payfast_card' },
      db,
    );
    db.prepare("UPDATE orders SET created_at = datetime('now', '-10 days') WHERE id = ?").run(order.id);

    assert.doesNotThrow(() => {
      const timer = startAutoCancelJob(24 * 60 * 60 * 1000, () => {
        throw new Error('publish scheduling exploded');
      });
      timer.unref?.();
      clearInterval(timer);
    });
    // The cancellation (and its stock restore) must have gone through
    // regardless of the callback blowing up.
    assert.strictEqual(colourStock(filament.id, colour.sku, db), 5);
  }));

test('startAutoBackupJob creates a real backup on startup, and prunes down to the keep count', () =>
  withScratchCwd(async () => {
    const db = getDb();
    // Two pre-existing backups, kept apart in time so filename/mtime
    // ordering is unambiguous -- pruneOldBackups (already covered in
    // backups.test.js as a pure function) keeps the newest.
    await createBackup(db);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createBackup(db);
    assert.strictEqual(listBackups().length, 2);

    // keep = 1: the job's own new backup makes 3, then prunes down to 1 --
    // this is jobs.js's actual value beyond backups.js's own unit tests:
    // that startAutoBackupJob really does wire create+prune together on a
    // real schedule, not just that each function works in isolation.
    const timer = startAutoBackupJob(24 * 60 * 60 * 1000, 1);
    timer.unref?.();
    try {
      const settled = await waitFor(() => listBackups().length === 1);
      assert.ok(settled, 'a new backup must be created and pruned down to the keep count shortly after the job starts');
    } finally {
      clearInterval(timer);
    }
  }));

test('startAuditLogPruneJob removes entries older than the retention window and leaves recent ones alone', () =>
  withScratchCwd(() => {
    const db = getDb();
    recordAuditEvent({ eventType: AUDIT_EVENTS.LOGIN_SUCCESS, username: 'old-entry' }, db);
    recordAuditEvent({ eventType: AUDIT_EVENTS.LOGIN_SUCCESS, username: 'recent-entry' }, db);
    db.prepare("UPDATE audit_log SET created_at = datetime('now', '-13 months') WHERE username = 'old-entry'").run();

    // pruneOldAuditLogEntries has no await before its observable effect
    // (a synchronous DELETE), so by the time startAuditLogPruneJob()
    // returns, the prune has already happened -- no polling needed.
    const timer = startAuditLogPruneJob(24 * 60 * 60 * 1000, 12);
    timer.unref?.();
    clearInterval(timer);

    const remaining = listAuditLog({}, db).map((e) => e.username);
    assert.ok(!remaining.includes('old-entry'), 'an entry past the retention window must be pruned');
    assert.ok(remaining.includes('recent-entry'), 'a recent entry must survive');
  }));

test('startPageViewsPruneJob removes page_views rows older than the retention window', () =>
  withScratchCwd(() => {
    const db = getDb();
    db.prepare("INSERT INTO page_views (id, path, visitor_id, created_at) VALUES ('old', '/x', 'v1', datetime('now', '-13 months'))").run();
    db.prepare("INSERT INTO page_views (id, path, visitor_id, created_at) VALUES ('recent', '/x', 'v2', datetime('now'))").run();

    const timer = startPageViewsPruneJob(24 * 60 * 60 * 1000, 12);
    timer.unref?.();
    clearInterval(timer);

    const ids = db.prepare('SELECT id FROM page_views').all().map((r) => r.id);
    assert.deepStrictEqual(ids, ['recent']);
  }));

test('startDesignFilePruneJob deletes uploaded files for finalized requests past the configured retention, and audit-logs the sweep', () =>
  withScratchCwd(() => {
    const db = getDb();
    updateSettings({ designFileRetentionMonths: 12 }, db);
    const request = createDesignRequest(
      {
        name: 'Design Client',
        email: 'design@example.com',
        phone: '0123456789',
        description: 'A bracket',
        referenceImagePath: '/uploads/design-requests/old.jpg',
      },
      db,
    );
    // pruneExpiredDesignFiles only considers finalized requests whose
    // finalized_at is past the retention cutoff -- no production function
    // sets finalized_at directly (the admin status-update route stamps it
    // with `now()`), so backdating it via SQL here matches this codebase's
    // own established convention for simulating "old" rows in tests (e.g.
    // orders.test.js/this file's own auto-cancel tests backdating created_at).
    db.prepare("UPDATE design_requests SET status = 'finalized', finalized_at = datetime('now', '-13 months') WHERE id = ?").run(request.id);

    const deleted = [];
    // deleteFile is injectable specifically so this test never touches the
    // real public/uploads/design-requests directory -- see jobs.js's own
    // comment on why that path can't be redirected by process.chdir().
    const timer = startDesignFilePruneJob(24 * 60 * 60 * 1000, (p) => deleted.push(p));
    timer.unref?.();
    clearInterval(timer);

    assert.deepStrictEqual(deleted, ['/uploads/design-requests/old.jpg']);
    const auditEntry = listAuditLog({}, db).find((e) => e.detail?.includes('Design-file retention prune'));
    assert.ok(auditEntry, 'the sweep must be audit-logged');
  }));
