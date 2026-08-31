import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { createFilament, addColour, updateColour } from './filaments.js';
import { subscribeRestock, unsubscribeRestock, listPendingRestockSubscriptions, processRestockNotifications } from './restock.js';

function seed(db, stockQty) {
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const withColour = addColour(filament.id, { name: 'Black', sku: 'PLA-BLACK-1KG', priceRand: 299, weightG: 1000, stockQty }, db);
  return { filament, colour: withColour.colours[0], productId: `filament:pla:${withColour.colours[0].sku}` };
}

test('subscribeRestock dedupes per product+email, validates email, unsubscribe removes by token', () => {
  const db = openDb(':memory:');
  const { productId } = seed(db, 0);
  assert.throws(() => subscribeRestock(productId, 'not-an-email', db), /valid email/);
  const first = subscribeRestock(productId, 'Shopper@Example.com', db);
  const dup = subscribeRestock(productId, 'shopper@example.com', db); // case-insensitive duplicate
  assert.strictEqual(first.id, dup.id);
  assert.strictEqual(listPendingRestockSubscriptions(db).length, 1);
  assert.strictEqual(unsubscribeRestock(first.token, db), true);
  assert.strictEqual(unsubscribeRestock('bogus', db), false);
  assert.strictEqual(listPendingRestockSubscriptions(db).length, 0);
  db.close();
});

test('processRestockNotifications notifies only purchasable products, once, and keeps failed sends pending', async () => {
  const db = openDb(':memory:');
  const { filament, colour, productId } = seed(db, 0);
  subscribeRestock(productId, 'a@example.com', db);
  subscribeRestock(productId, 'b@example.com', db);

  // Still out of stock -> nothing sends.
  const sentWhileOut = await processRestockNotifications(async () => {}, db);
  assert.strictEqual(sentWhileOut, 0);
  assert.strictEqual(listPendingRestockSubscriptions(db).length, 2);

  // Back in stock -> both notify; a failing send stays pending.
  updateColour(filament.id, colour.id, { stockQty: 5 }, db);
  const sends = [];
  const sent = await processRestockNotifications(async (sub, snapshot) => {
    if (sub.email === 'b@example.com') throw new Error('SMTP down');
    sends.push({ email: sub.email, product: snapshot.name, stock: snapshot.stockQty });
  }, db);
  assert.strictEqual(sent, 1);
  assert.deepStrictEqual(sends, [{ email: 'a@example.com', product: 'PLA — Black', stock: 5 }]);
  const pending = listPendingRestockSubscriptions(db);
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].email, 'b@example.com');

  // Re-run (the daily safety net) -> the failed one gets retried; the
  // already-notified one never re-sends.
  const retried = await processRestockNotifications(async (sub) => sends.push({ email: sub.email }), db);
  assert.strictEqual(retried, 1);
  assert.strictEqual(sends.length, 2);
  assert.strictEqual(listPendingRestockSubscriptions(db).length, 0);
  db.close();
});

test('re-subscribing after a sent notification renews intent (notified_at cleared)', async () => {
  const db = openDb(':memory:');
  const { filament, colour, productId } = seed(db, 3);
  const sub = subscribeRestock(productId, 'again@example.com', db);
  await processRestockNotifications(async () => {}, db); // in stock -> notifies immediately
  assert.strictEqual(listPendingRestockSubscriptions(db).length, 0);
  updateColour(filament.id, colour.id, { stockQty: 0 }, db);
  const renewed = subscribeRestock(productId, 'again@example.com', db);
  assert.strictEqual(renewed.id, sub.id);
  assert.strictEqual(listPendingRestockSubscriptions(db).length, 1);
  db.close();
});
