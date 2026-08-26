import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { createFilament, addColour, getFilament } from './filaments.js';
import { createOrder, createManualOrder, updateOrderStatus, markOrderPaid, cancelStalePendingOrders, cancelOrderByClient, resolveProductSnapshot } from './orders.js';
import { createShippingOption } from './shipping.js';

function colourStock(filamentId, sku, db) {
  return getFilament(filamentId, db).colours.find((c) => c.sku === sku).stockQty;
}

test('resolveProductSnapshot includes stockQty for filament products', () => {
  const db = openDb(':memory:');
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'Red', sku: 'PLA-RED-1KG', priceRand: 299, weightG: 1000, stockQty: 5 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;
  const snapshot = resolveProductSnapshot(productId, db);
  assert.strictEqual(snapshot.stockQty, 5);
  assert.strictEqual(snapshot.price, 299);
  db.close();
});

test('createOrder succeeds when quantity <= stockQty', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);

  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'Blue', sku: 'PLA-BLUE-1KG', priceRand: 299, weightG: 1000, stockQty: 10 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  const order = createOrder(
    {
      client: { name: 'Test Customer', email: 'test@example.com', phone: '0123456789' },
      items: [{ productId, quantity: 5 }],
      paymentMethod: 'payfast_card',
    },
    db,
  );

  assert.ok(order.id);
  assert.strictEqual(order.items.length, 1);
  assert.strictEqual(order.items[0].quantity, 5);
  db.close();
});

test('createOrder blocks checkout when quantity > stockQty', () => {
  const db = openDb(':memory:');
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'Green', sku: 'PLA-GREEN-1KG', priceRand: 299, weightG: 1000, stockQty: 3 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  assert.throws(
    () => createOrder(
      {
        client: { name: 'Test Customer', email: 'test@example.com', phone: '0123456789' },
        items: [{ productId, quantity: 5 }],
        paymentMethod: 'payfast_card',
      },
      db,
    ),
    /Out of stock: PLA — Green \(requested 5, 3 available\)/,
  );
  db.close();
});

test('createOrder blocks checkout when ANY item is out of stock', () => {
  const db = openDb(':memory:');
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour1 = addColour(
    filament.id,
    { name: 'Yellow', sku: 'PLA-YELLOW-1KG', priceRand: 299, weightG: 1000, stockQty: 10 },
    db,
  );
  const filamentWithColour2 = addColour(
    filament.id,
    { name: 'Purple', sku: 'PLA-PURPLE-1KG', priceRand: 299, weightG: 1000, stockQty: 2 },
    db,
  );

  const colour1 = filamentWithColour1.colours.find((c) => c.sku === 'PLA-YELLOW-1KG');
  const colour2 = filamentWithColour2.colours.find((c) => c.sku === 'PLA-PURPLE-1KG');

  const productId1 = `filament:pla:${colour1.sku}`;
  const productId2 = `filament:pla:${colour2.sku}`;

  // Second item would exceed stock
  assert.throws(
    () => createOrder(
      {
        client: { name: 'Test Customer', email: 'test@example.com', phone: '0123456789' },
        items: [
          { productId: productId1, quantity: 2 },
          { productId: productId2, quantity: 5 },
        ],
        paymentMethod: 'payfast_card',
      },
      db,
    ),
    /Out of stock: PLA — Purple \(requested 5, 2 available\)/,
  );
  db.close();
});

test('createOrder allows exact stock quantity (quantity == stockQty)', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 10000, price: 8500 }, db);

  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'Black', sku: 'PLA-BLACK-1KG', priceRand: 299, weightG: 1000, stockQty: 7 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  const order = createOrder(
    {
      client: { name: 'Test Customer', email: 'test@example.com', phone: '0123456789' },
      items: [{ productId, quantity: 7 }],
      paymentMethod: 'payfast_card',
    },
    db,
  );

  assert.ok(order.id);
  assert.strictEqual(order.items[0].quantity, 7);
  db.close();
});

test('createOrder blocks checkout when product has zero stock', () => {
  const db = openDb(':memory:');
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'Orange', sku: 'PLA-ORANGE-1KG', priceRand: 299, weightG: 1000, stockQty: 0 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  assert.throws(
    () => createOrder(
      {
        client: { name: 'Test Customer', email: 'test@example.com', phone: '0123456789' },
        items: [{ productId, quantity: 1 }],
        paymentMethod: 'payfast_card',
      },
      db,
    ),
    /Out of stock: PLA — Orange \(requested 1, 0 available\)/,
  );
  db.close();
});

test('createOrder reserves (decrements) stock immediately at creation, not just at payment', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'Teal', sku: 'PLA-TEAL-1KG', priceRand: 299, weightG: 1000, stockQty: 5 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  const order = createOrder(
    {
      client: { name: 'Test Customer', email: 'test@example.com', phone: '0123456789' },
      items: [{ productId, quantity: 2 }],
      paymentMethod: 'payfast_card',
    },
    db,
  );

  assert.strictEqual(order.status, 'pending_payment');
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 3);
  db.close();
});

test('closes the overselling race: a second order for the same last unit is rejected before payment, not after', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'LastRoll', sku: 'PLA-LASTROLL-1KG', priceRand: 299, weightG: 1000, stockQty: 1 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;
  const cartItems = { client: { name: 'Customer', email: 'c@example.com', phone: '0123456789' }, items: [{ productId, quantity: 1 }], paymentMethod: 'payfast_card' };

  // Customer A checks out first -- succeeds, and the roll is now reserved.
  const orderA = createOrder(cartItems, db);
  assert.strictEqual(orderA.status, 'pending_payment');

  // Customer B checks out for the same (now-reserved) roll before A has
  // paid -- this is exactly the scenario that used to create two
  // confirmed orders for one physical item. Must be rejected here, at
  // order-creation time, not silently allowed through to payment.
  assert.throws(() => createOrder(cartItems, db), /Out of stock: PLA — LastRoll \(requested 1, 0 available\)/);
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 0);
  db.close();
});

test('paying an order does not decrement stock again -- it was already reserved at creation', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'Silver', sku: 'PLA-SILVER-1KG', priceRand: 299, weightG: 1000, stockQty: 4 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  const order = createOrder(
    { client: { name: 'C', email: 'c@example.com', phone: '0123456789' }, items: [{ productId, quantity: 3 }], paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 1);

  const { changed, lowStock } = markOrderPaid(order.id, db);
  assert.strictEqual(changed, true);
  assert.deepStrictEqual(lowStock, []);
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 1); // unchanged -- not decremented a second time

  const updated = updateOrderStatus(order.id, 'shipped', db);
  assert.strictEqual(updated.status, 'shipped');
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 1); // still unchanged
  db.close();
});

test('cancelStalePendingOrders restores reserved stock for each order it cancels', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'Gold', sku: 'PLA-GOLD-1KG', priceRand: 299, weightG: 1000, stockQty: 5 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  const order = createOrder(
    { client: { name: 'C', email: 'c@example.com', phone: '0123456789' }, items: [{ productId, quantity: 2 }], paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 3);

  // Backdate created_at so it counts as stale, same technique the existing
  // auto-cancel job tests use.
  db.prepare("UPDATE orders SET created_at = datetime('now', '-10 days') WHERE id = ?").run(order.id);
  const cancelledOrders = cancelStalePendingOrders(5 * 24 * 60 * 60 * 1000, db);
  assert.strictEqual(cancelledOrders.length, 1);
  assert.strictEqual(cancelledOrders[0].id, order.id);
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 5); // back to full

  // A now-freed-up roll can be sold again.
  const secondOrder = createOrder(
    { client: { name: 'D', email: 'd@example.com', phone: '0123456789' }, items: [{ productId, quantity: 5 }], paymentMethod: 'manual_eft' },
    db,
  );
  assert.ok(secondOrder.id);
  db.close();
});

test('cancelOrderByClient cancels a pending_payment order owned by that client and restores stock', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'Gold', sku: 'PLA-GOLD-1KG', priceRand: 299, weightG: 1000, stockQty: 5 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  const order = createOrder(
    { client: { name: 'C', email: 'c@example.com', phone: '0123456789' }, items: [{ productId, quantity: 2 }], paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 3);

  const cancelled = cancelOrderByClient(order.id, order.clientId, db);
  assert.strictEqual(cancelled.status, 'cancelled');
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 5);
});

test('cancelOrderByClient refuses an order that belongs to a different client', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(filament.id, { name: 'Gold', sku: 'PLA-GOLD-1KG', priceRand: 299, weightG: 1000, stockQty: 5 }, db);
  const productId = `filament:pla:${filamentWithColour.colours[0].sku}`;
  const order = createOrder(
    { client: { name: 'C', email: 'c@example.com', phone: '0123456789' }, items: [{ productId, quantity: 1 }], paymentMethod: 'manual_eft' },
    db,
  );

  const result = cancelOrderByClient(order.id, 'some-other-client-id', db);
  assert.strictEqual(result, null);
  assert.strictEqual(updateOrderStatus(order.id, 'shipped', db).status, 'shipped'); // still untouched -> can still be validly transitioned
});

test('cancelOrderByClient refuses an order that is no longer pending_payment', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(filament.id, { name: 'Gold', sku: 'PLA-GOLD-1KG', priceRand: 299, weightG: 1000, stockQty: 5 }, db);
  const productId = `filament:pla:${filamentWithColour.colours[0].sku}`;
  const order = createOrder(
    { client: { name: 'C', email: 'c@example.com', phone: '0123456789' }, items: [{ productId, quantity: 1 }], paymentMethod: 'manual_eft' },
    db,
  );
  markOrderPaid(order.id, db);

  assert.throws(() => cancelOrderByClient(order.id, order.clientId, db), /awaiting payment/);
});

test('admin-cancelling an order via updateOrderStatus restores stock exactly once', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'Bronze', sku: 'PLA-BRONZE-1KG', priceRand: 299, weightG: 1000, stockQty: 5 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  const order = createOrder(
    { client: { name: 'C', email: 'c@example.com', phone: '0123456789' }, items: [{ productId, quantity: 2 }], paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 3);

  updateOrderStatus(order.id, 'cancelled', db);
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 5);

  // Re-saving as cancelled again (e.g. a duplicate admin click) must not
  // restore a second time.
  updateOrderStatus(order.id, 'cancelled', db);
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 5);
  db.close();
});

test('createManualOrder reserves stock immediately regardless of alreadyPaid', () => {
  const db = openDb(':memory:');
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'Copper', sku: 'PLA-COPPER-1KG', priceRand: 299, weightG: 1000, stockQty: 6 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  const order = createManualOrder(
    {
      client: { name: 'Walk-in', email: 'walkin@example.com', phone: '0123456789' },
      items: [{ productId, quantity: 4 }],
      paymentMethod: 'cash_on_collection',
      alreadyPaid: false,
    },
    db,
  );

  assert.strictEqual(order.status, 'pending_payment');
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 2);
  db.close();
});
