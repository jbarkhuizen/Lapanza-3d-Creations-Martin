import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { updateSettings } from './settings.js';
import { createFilament, addColour, getFilament } from './filaments.js';
import { createOrder, createManualOrder, updateOrderStatus, markOrderPaid, cancelStalePendingOrders, cancelOrderByClient, deleteOrder, listOrders, resolveProductSnapshot } from './orders.js';
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

test('un-cancelling an order re-reserves its stock (and delete after un-cancel restores it exactly once)', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(
    filament.id,
    { name: 'Revive', sku: 'PLA-REVIVE-1KG', priceRand: 299, weightG: 1000, stockQty: 5 },
    db,
  );
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  const order = createOrder(
    { client: { name: 'Test Customer', email: 'revive@example.com', phone: '0123456789' }, items: [{ productId, quantity: 2 }], paymentMethod: 'payfast_card' },
    db,
  );
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 3); // reserved at creation

  updateOrderStatus(order.id, 'cancelled', db);
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 5); // released

  // Regression: this transition previously re-activated the order while the
  // stock stayed restored -- and a later delete restored it a second time.
  updateOrderStatus(order.id, 'pending_payment', db);
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 3, 'un-cancel must re-reserve');

  deleteOrder(order.id, db);
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 5, 'delete after un-cancel restores exactly once');
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

test('listOrders attaches each order\'s client name/email/clientCode -- the Invoice History "client name missing" bug', () => {
  const db = openDb(':memory:');
  const order = createManualOrder(
    { client: { name: 'Jane Doe', email: 'jane@example.com', phone: '0123456789' }, items: [{ description: 'Custom part', quantity: 1, unitPrice: 100 }], paymentMethod: 'manual_eft' },
    db,
  );

  const withoutQuery = listOrders({}, db);
  assert.strictEqual(withoutQuery.find((o) => o.id === order.id).client.name, 'Jane Doe');

  const withQuery = listOrders({ q: 'jane' }, db);
  assert.strictEqual(withQuery.length, 1);
  assert.strictEqual(withQuery[0].client.email, 'jane@example.com');
  db.close();
});

test('updateOrderStatus keeps payment_status in lockstep: paid/shipped/completed mark it paid, pending_payment marks it pending, cancelled leaves it alone', () => {
  const db = openDb(':memory:');
  const order = createManualOrder(
    { client: { email: 'sync@example.com' }, items: [{ description: 'Item', quantity: 1, unitPrice: 100 }], paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(order.paymentStatus, 'pending');

  const paid = updateOrderStatus(order.id, 'paid', db);
  assert.strictEqual(paid.paymentStatus, 'paid');

  const shipped = updateOrderStatus(order.id, 'shipped', db);
  assert.strictEqual(shipped.paymentStatus, 'paid');

  const backToPending = updateOrderStatus(order.id, 'pending_payment', db);
  assert.strictEqual(backToPending.paymentStatus, 'pending');

  const paidAgain = updateOrderStatus(order.id, 'paid', db);
  assert.strictEqual(paidAgain.paymentStatus, 'paid');
  const cancelled = updateOrderStatus(order.id, 'cancelled', db);
  assert.strictEqual(cancelled.paymentStatus, 'paid'); // untouched by the cancel transition
  db.close();
});

test('deleteOrder removes the order, its items and transactions, and restores stock only when it was still reserved', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(filament.id, { name: 'Gold', sku: 'PLA-GOLD-1KG', priceRand: 299, weightG: 1000, stockQty: 5 }, db);
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  const order = createOrder(
    { client: { name: 'C', email: 'c@example.com', phone: '0123456789' }, items: [{ productId, quantity: 2 }], paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 3); // 5 - 2 reserved

  assert.strictEqual(deleteOrder(order.id, db), true);
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 5); // reserved stock restored
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM orders WHERE id = ?').get(order.id).c, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM order_items WHERE order_id = ?').get(order.id).c, 0);
  db.close();
});

test('deleteOrder does not double-restore stock for an order that was already shipped/completed or cancelled', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 5000, price: 8500 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const filamentWithColour = addColour(filament.id, { name: 'Gold', sku: 'PLA-GOLD-1KG', priceRand: 299, weightG: 1000, stockQty: 5 }, db);
  const colour = filamentWithColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  const order = createOrder(
    { client: { name: 'C', email: 'c2@example.com', phone: '0123456789' }, items: [{ productId, quantity: 2 }], paymentMethod: 'manual_eft' },
    db,
  );
  updateOrderStatus(order.id, 'shipped', db);
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 3); // still reserved-and-gone, unaffected by the shipped transition

  deleteOrder(order.id, db);
  assert.strictEqual(colourStock(filament.id, colour.sku, db), 3); // NOT restored -- the stock already physically left
  db.close();
});

test('deleteOrder returns false for a missing id', () => {
  const db = openDb(':memory:');
  assert.strictEqual(deleteOrder('does-not-exist', db), false);
  db.close();
});

test('createOrder applies the best volume-discount tier to the filament portion only (#60)', () => {
  const db = openDb(':memory:');
  updateSettings({ volumeDiscounts: [
    { id: 'a', minQty: 3, pct: 5, active: true },
    { id: 'b', minQty: 5, pct: 10, active: true },
    { id: 'c', minQty: 2, pct: 50, active: false }, // inactive -- never applies
  ] }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const withColour = addColour(filament.id, { name: 'Grey', sku: 'PLA-GREY-1KG', priceRand: 100, weightG: 1000, stockQty: 20 }, db);
  const productId = `filament:pla:${withColour.colours[0].sku}`;

  // 5 rolls -> the 10% tier (best matching), on filament subtotal 500 = 50 off.
  const order = createOrder(
    { client: { name: 'Bulk Buyer', email: 'bulk@example.com' }, items: [{ productId, quantity: 5 }], shippingMethod: 'collect', paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(order.subtotal, 500);
  assert.strictEqual(order.discountPct, 10);
  assert.strictEqual(order.discountAmount, 50);
  assert.strictEqual(order.total, 450);

  // 2 rolls -> below every active tier -> no discount.
  const small = createOrder(
    { client: { name: 'Bulk Buyer', email: 'bulk@example.com' }, items: [{ productId, quantity: 2 }], shippingMethod: 'collect', paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(small.discountAmount, 0);
  assert.strictEqual(small.total, 200);
  db.close();
});

test('createOrder with no configured volume tiers applies no discount (#60 default-inert)', () => {
  const db = openDb(':memory:');
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const withColour = addColour(filament.id, { name: 'Ivory', sku: 'PLA-IVORY-1KG', priceRand: 100, weightG: 1000, stockQty: 20 }, db);
  const order = createOrder(
    { client: { name: 'B', email: 'b@example.com' }, items: [{ productId: `filament:pla:${withColour.colours[0].sku}`, quantity: 6 }], shippingMethod: 'collect', paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(order.discountAmount, 0);
  assert.strictEqual(order.total, 600);
  db.close();
});

// Go-live duplicate guard (2026-09-03): an identical pending order from the
// same email within 30 minutes is a payment retry, not a new order.
test('createOrder reuses an identical recent pending order instead of duplicating it', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Std', minWeight: 0, maxWeight: 50000, price: 100 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const withColour = addColour(filament.id, { name: 'Blue', sku: 'DUP-1', priceRand: 300, weightG: 1000, stockQty: 10 }, db);
  const productId = `filament:pla:${withColour.colours[0].sku}`;
  const payload = {
    client: { name: 'Dup Tester', email: 'dup@example.com', phone: '0820000000' },
    items: [{ productId, quantity: 1 }],
    shippingMethod: 'collect',
    paymentMethod: 'payfast_card',
  };
  const first = createOrder(payload, db);
  const second = createOrder({ ...payload, paymentMethod: 'payfast_eft' }, db); // retried with a different method
  assert.strictEqual(second.id, first.id, 'same order handed back');
  assert.strictEqual(second._reused, true);
  assert.strictEqual(second.paymentMethod, 'payfast_eft', 'method switch applied to the existing order');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 1, 'no duplicate row');
  // stock reserved exactly once
  assert.strictEqual(getFilament(filament.id, db).colours[0].stockQty, 9);

  // a genuinely different cart still creates a new order
  const changed = createOrder({ ...payload, items: [{ productId, quantity: 2 }] }, db);
  assert.notStrictEqual(changed.id, first.id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 2);

  // a paid order is never reused -- a fresh identical purchase is legitimate
  updateOrderStatus(first.id, 'paid', db);
  const afterPaid = createOrder(payload, db);
  assert.notStrictEqual(afterPaid.id, first.id);
  db.close();
});
