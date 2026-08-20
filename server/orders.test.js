import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { createFilament, addColour } from './filaments.js';
import { createOrder, resolveProductSnapshot } from './orders.js';
import { createShippingOption } from './shipping.js';

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
