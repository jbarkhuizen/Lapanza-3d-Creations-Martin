import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { createManualOrder, updateOrderStatus, createOrder } from './orders.js';
import { createFilament, addColour } from './filaments.js';

function paidOrder(db, { total = 100, description = 'Item' } = {}) {
  return createManualOrder(
    { client: { email: `${Math.random()}@example.com` }, items: [{ description, quantity: 1, unitPrice: total }], paymentMethod: 'manual_eft', alreadyPaid: true },
    db,
  );
}

test('getSalesSummary counts revenue only from paid/shipped/completed orders, never pending or cancelled', async () => {
  const db = openDb(':memory:');
  const { getSalesSummary } = await import(`./sales.js?t=${Date.now()}`);

  paidOrder(db, { total: 200 });
  const pending = createManualOrder({ client: { email: 'p@example.com' }, items: [{ description: 'X', quantity: 1, unitPrice: 500 }], paymentMethod: 'manual_eft' }, db);
  const cancelled = paidOrder(db, { total: 300 });
  updateOrderStatus(cancelled.id, 'cancelled', db);

  const summary = getSalesSummary('all', db);
  assert.strictEqual(summary.revenue, 200);
  assert.strictEqual(summary.orderCount, 1);
  assert.strictEqual(summary.averageOrderValue, 200);
  assert.strictEqual(summary.pendingPayment.count, 1);
  assert.strictEqual(summary.pendingPayment.total, 500);
  assert.ok(pending.id);
  db.close();
});

test('getSalesSummary range filtering excludes orders outside the window', async () => {
  const db = openDb(':memory:');
  const { getSalesSummary } = await import(`./sales.js?t=${Date.now()}`);

  const recent = paidOrder(db, { total: 100 });
  const old = paidOrder(db, { total: 900 });
  db.prepare("UPDATE orders SET created_at = datetime('now', '-10 days') WHERE id = ?").run(old.id);

  const last7 = getSalesSummary('7d', db);
  assert.strictEqual(last7.revenue, 100);
  assert.strictEqual(last7.orderCount, 1);

  const all = getSalesSummary('all', db);
  assert.strictEqual(all.revenue, 1000);
  assert.strictEqual(all.orderCount, 2);
  assert.ok(recent.id);
  db.close();
});

test('getSalesSummary today range matches only orders from the current calendar date', async () => {
  const db = openDb(':memory:');
  const { getSalesSummary } = await import(`./sales.js?t=${Date.now()}`);

  paidOrder(db, { total: 50 });
  const yesterday = paidOrder(db, { total: 999 });
  db.prepare("UPDATE orders SET created_at = datetime('now', '-1 day') WHERE id = ?").run(yesterday.id);

  const today = getSalesSummary('today', db);
  assert.strictEqual(today.revenue, 50);
  assert.strictEqual(today.orderCount, 1);
  db.close();
});

test('getSalesSummary "today" and the daily series use the server\'s local timezone (SAST/UTC+2), not UTC, for calendar-day boundaries', async () => {
  const originalTz = process.env.TZ;
  process.env.TZ = 'Africa/Johannesburg'; // UTC+2, no DST -- same offset the production server runs in
  try {
    const db = openDb(':memory:');
    const { getSalesSummary } = await import(`./sales.js?t=${Date.now()}`);

    // An order placed at local (SAST) 00:30 -- just after local midnight --
    // is stored as a UTC instant on the PREVIOUS UTC calendar day (00:30
    // SAST = 22:30 UTC the day before). Anchored on 'now' in LOCAL time,
    // not UTC, so this holds no matter what real instant the test runs at.
    const order = paidOrder(db, { total: 777 });
    db.prepare("UPDATE orders SET created_at = datetime(date('now', 'localtime'), '-90 minutes') WHERE id = ?").run(order.id);

    const fixture = db
      .prepare("SELECT date(created_at) AS utcDate, date(created_at, 'localtime') AS localDate FROM orders WHERE id = ?")
      .get(order.id);
    const localToday = db.prepare("SELECT date('now', 'localtime') AS d").get().d;
    // Prerequisite for this test to mean anything at all: the fixture must
    // genuinely straddle a UTC/local calendar-day boundary.
    assert.notStrictEqual(fixture.utcDate, fixture.localDate, 'fixture must straddle a UTC/SAST day boundary, or this test proves nothing');
    assert.strictEqual(fixture.localDate, localToday, 'fixture must land on local "today"');

    const summary = getSalesSummary('today', db);
    assert.strictEqual(summary.revenue, 777, 'an order from just after local midnight must count as today\'s sale -- a UTC-only comparison pushes it to "yesterday" instead');
    assert.strictEqual(summary.orderCount, 1);
    assert.ok(
      summary.series.some((day) => day.date === localToday && day.revenue === 777),
      'the daily trend series must group the order under its LOCAL calendar date, not the UTC one',
    );

    db.close();
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test('getSalesSummary rejects an unknown range', async () => {
  const db = openDb(':memory:');
  const { getSalesSummary } = await import(`./sales.js?t=${Date.now()}`);
  assert.throws(() => getSalesSummary('nonsense', db), /Unknown range/);
  db.close();
});

test('getSalesSummary ranks top products by revenue, summed by the stable product_id across separate orders', async () => {
  const db = openDb(':memory:');
  const { getSalesSummary } = await import(`./sales.js?t=${Date.now()}`);

  const f = createFilament({ name: 'PLA', slug: 'pla' }, db);
  addColour(f.id, { name: 'Blue', sku: 'PLA-BLUE', priceRand: 100, weightG: 100, stockQty: 10 }, db);
  const productId = 'filament:pla:PLA-BLUE';

  // Two separate orders for the same catalog product -- must sum together
  // under one productId, not appear as two rows.
  const orderA = createOrder({ client: { name: 'A', email: 'a@example.com' }, items: [{ productId, quantity: 2 }], shippingMethod: 'collect', paymentMethod: 'manual_eft' }, db);
  updateOrderStatus(orderA.id, 'paid', db);
  const orderB = createOrder({ client: { name: 'B', email: 'b@example.com' }, items: [{ productId, quantity: 1 }], shippingMethod: 'collect', paymentMethod: 'manual_eft' }, db);
  updateOrderStatus(orderB.id, 'paid', db);
  paidOrder(db, { total: 50, description: 'Widget' });

  const summary = getSalesSummary('all', db);
  const top = summary.topProducts.find((p) => p.productId === productId);
  assert.ok(top, 'PLA Blue appears once');
  assert.strictEqual(top.units, 3);
  assert.strictEqual(top.revenue, 300);
  assert.strictEqual(summary.topProducts[0].productId, productId, 'ranked first by revenue');
  db.close();
});

test('getSalesSummary statusBreakdown covers every order status even with zero orders in it', async () => {
  const db = openDb(':memory:');
  const { getSalesSummary } = await import(`./sales.js?t=${Date.now()}`);
  paidOrder(db, { total: 100 });

  const summary = getSalesSummary('all', db);
  const statuses = summary.statusBreakdown.map((s) => s.status);
  assert.deepStrictEqual(statuses, ['pending_payment', 'paid', 'shipped', 'completed', 'cancelled']);
  assert.strictEqual(summary.statusBreakdown.find((s) => s.status === 'paid').count, 1);
  assert.strictEqual(summary.statusBreakdown.find((s) => s.status === 'shipped').count, 0);
  db.close();
});
