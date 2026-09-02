import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb, closeAllCachedDbs } from './db.js';
import { createFilament, addColour, getFilament } from './filaments.js';
import { createOrder } from './orders.js';
import { createShippingOption } from './shipping.js';
import { startAutoCancelJob } from './jobs.js';

function colourStock(filamentId, sku, db) {
  return getFilament(filamentId, db).colours.find((c) => c.sku === sku).stockQty;
}

// getDb() resolves its path from process.cwd() (server/paths.js's
// dataDir()), same cwd-isolation convention server/index.test.js's
// freshApp() relies on -- without chdir-ing into a scratch directory
// first, a test here would open (and mutate) the REAL local dev
// data/lapanza.db in the repo root. Never skip this.
function withScratchCwd(fn) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-test-'));
  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  const originalCwd = process.cwd();
  process.chdir(tmpRoot);
  try {
    return fn();
  } finally {
    closeAllCachedDbs();
    process.chdir(originalCwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

test('startAutoCancelJob invokes onCancelled exactly once per run, with the orders it cancelled (needed to trigger a catalog republish -- see index.js\'s scheduleCatalogPublish)', () => {
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
  });
});

test('startAutoCancelJob does not invoke onCancelled when nothing was cancelled', () => {
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
  });
});

test('a throwing onCancelled callback is caught -- it must never prevent the cancellation itself or crash the job', () => {
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
  });
});
