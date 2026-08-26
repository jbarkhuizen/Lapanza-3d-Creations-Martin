import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { createManualOrder, getOrder } from './orders.js';
import { createClient } from './clients.js';
import { updateSettings } from './settings.js';
import { createFilament, addColour } from './filaments.js';
import { createShippingOption } from './shipping.js';

function freeTextItem(overrides = {}) {
  return { description: 'Custom bracket', quantity: 1, unitPrice: 100, ...overrides };
}

test('createManualOrder assigns a sequential invoice number seeded from settings', () => {
  const db = openDb(':memory:');
  updateSettings({ invoiceNumberSeed: 10 }, db);
  const first = createManualOrder({ client: { email: 'a@example.com' }, items: [freeTextItem()], paymentMethod: 'manual_eft' }, db);
  assert.strictEqual(first.invoiceNumber, 'INV-0010');
  const second = createManualOrder({ client: { email: 'b@example.com' }, items: [freeTextItem()], paymentMethod: 'manual_eft' }, db);
  assert.strictEqual(second.invoiceNumber, 'INV-0011');
  db.close();
});

test('createManualOrder accepts free-text line items with admin-entered prices', () => {
  const db = openDb(':memory:');
  const order = createManualOrder(
    { client: { email: 'custom@example.com' }, items: [freeTextItem({ description: 'One-off part', unitPrice: 250, quantity: 2 })], paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(order.items.length, 1);
  assert.strictEqual(order.items[0].productName, 'One-off part');
  assert.strictEqual(order.subtotal, 500);
  assert.strictEqual(order.items[0].productId.startsWith('manual:'), true);
  db.close();
});

test('createManualOrder applies discountPct to the subtotal and records it on the order', () => {
  const db = openDb(':memory:');
  const order = createManualOrder(
    { client: { email: 'discount@example.com' }, items: [freeTextItem({ unitPrice: 1000, quantity: 1 })], discountPct: 10, paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(order.discountPct, 10);
  assert.strictEqual(order.discountAmount, 100);
  assert.strictEqual(order.total, 900);
  db.close();
});

test('createManualOrder with alreadyPaid sets status to paid directly (no Payfast flow)', () => {
  const db = openDb(':memory:');
  const order = createManualOrder(
    { client: { email: 'paid@example.com' }, items: [freeTextItem()], paymentMethod: 'cash_on_collection', alreadyPaid: true },
    db,
  );
  assert.strictEqual(order.status, 'paid');
  assert.strictEqual(order.paymentStatus, 'paid');
  db.close();
});

test('createManualOrder without alreadyPaid leaves the order pending', () => {
  const db = openDb(':memory:');
  const order = createManualOrder(
    { client: { email: 'pending@example.com' }, items: [freeTextItem()], paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(order.status, 'pending_payment');
  assert.strictEqual(order.paymentStatus, 'pending');
  db.close();
});

test('createManualOrder reuses an existing client by clientId', () => {
  const db = openDb(':memory:');
  const client = createClient({ email: 'existing@example.com', name: 'Existing Client' }, db);
  const order = createManualOrder({ clientId: client.id, items: [freeTextItem()], paymentMethod: 'manual_eft' }, db);
  assert.strictEqual(order.clientId, client.id);
  db.close();
});

test('createManualOrder rejects an empty item list', () => {
  const db = openDb(':memory:');
  assert.throws(() => createManualOrder({ client: { email: 'x@example.com' }, items: [], paymentMethod: 'manual_eft' }, db), /at least one item/);
  db.close();
});

test('createManualOrder rejects a line item with neither product nor description', () => {
  const db = openDb(':memory:');
  assert.throws(
    () => createManualOrder({ client: { email: 'x@example.com' }, items: [{ quantity: 1, unitPrice: 10 }], paymentMethod: 'manual_eft' }, db),
    /needs either a product or a description/,
  );
  db.close();
});

test('createManualOrder round-trips through getOrder with the same invoice number', () => {
  const db = openDb(':memory:');
  const order = createManualOrder({ client: { email: 'roundtrip@example.com' }, items: [freeTextItem()], paymentMethod: 'manual_eft' }, db);
  const fetched = getOrder(order.id, db);
  assert.strictEqual(fetched.invoiceNumber, order.invoiceNumber);
  db.close();
});

test('createManualOrder defaults shippingMethod to courier (no shippingOptionId) or fixed (with one) for backward compatibility when not sent', () => {
  const db = openDb(':memory:');
  const withoutOption = createManualOrder({ client: { email: 'noship-a@example.com' }, items: [freeTextItem()], paymentMethod: 'manual_eft' }, db);
  assert.strictEqual(withoutOption.shippingMethod, 'courier');

  const option = createShippingOption({ name: 'PUDO Locker (Small)', optionType: 'fixed', price: 65 }, db);
  const withOption = createManualOrder(
    { client: { email: 'noship-b@example.com' }, items: [freeTextItem()], paymentMethod: 'manual_eft', shippingOptionId: option.id },
    db,
  );
  assert.strictEqual(withOption.shippingMethod, 'fixed');
  assert.strictEqual(withOption.shippingPrice, 65);
  db.close();
});

test('createManualOrder stores an explicit shippingMethod and zeros the price for own_courier/collect regardless of a manual price', () => {
  const db = openDb(':memory:');
  const order = createManualOrder(
    {
      client: { email: 'owncourier@example.com' },
      items: [freeTextItem()],
      paymentMethod: 'manual_eft',
      shippingMethod: 'own_courier',
      shippingPrice: 150, // must be ignored -- own_courier is always free
    },
    db,
  );
  assert.strictEqual(order.shippingMethod, 'own_courier');
  assert.strictEqual(order.shippingPrice, 0);
  assert.strictEqual(order.total, order.subtotal);
  db.close();
});

test('createManualOrder rejects an invalid shippingMethod', () => {
  const db = openDb(':memory:');
  assert.throws(
    () => createManualOrder({ client: { email: 'x@example.com' }, items: [freeTextItem()], paymentMethod: 'manual_eft', shippingMethod: 'teleport' }, db),
    /Invalid shipping method/,
  );
  db.close();
});

test('createManualOrder accepts a catalog product line item by productId, resolved server-side (not the admin-entered price)', () => {
  const db = openDb(':memory:');
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const withColour = addColour(filament.id, { name: 'Red', sku: 'PLA-RED-1KG', priceRand: 299, weightG: 1000, stockQty: 5 }, db);
  const colour = withColour.colours[0];
  const productId = `filament:pla:${colour.sku}`;

  const order = createManualOrder(
    { client: { email: 'catalog@example.com' }, items: [{ productId, quantity: 2 }], paymentMethod: 'manual_eft' },
    db,
  );
  assert.strictEqual(order.items[0].productId, productId);
  assert.strictEqual(order.items[0].price, 299);
  assert.strictEqual(order.subtotal, 598);
  db.close();
});
