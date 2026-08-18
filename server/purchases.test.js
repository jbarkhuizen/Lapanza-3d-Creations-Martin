import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { listPurchases, getPurchase, createPurchase, updatePurchase, deletePurchase } from './purchases.js';

test('createPurchase defaults status to outstanding and requires a supplier', () => {
  const db = openDb(':memory:');
  const purchase = createPurchase({ supplier: 'Geewiz', goods: 'Bambu Labs P2S', totalValue: 28000 }, db);
  assert.strictEqual(purchase.status, 'outstanding');
  assert.strictEqual(purchase.totalValue, 28000);
  assert.throws(() => createPurchase({ goods: 'no supplier' }, db), /Supplier is required/);
  db.close();
});

test('listPurchases filters by status and orders newest first', () => {
  const db = openDb(':memory:');
  const a = createPurchase({ supplier: 'A', totalValue: 100 }, db);
  createPurchase({ supplier: 'B', totalValue: 200 }, db);
  updatePurchase(a.id, { status: 'paid' }, db);
  const paid = listPurchases({ status: 'paid' }, db);
  assert.strictEqual(paid.length, 1);
  assert.strictEqual(paid[0].id, a.id);
  db.close();
});

test('updatePurchase applies partial updates without clobbering other fields', () => {
  const db = openDb(':memory:');
  const purchase = createPurchase({ supplier: 'Build Volume', goods: 'SnapMaker', totalValue: 10000 }, db);
  const updated = updatePurchase(purchase.id, { status: 'paid', paymentType: 'FNB Card' }, db);
  assert.strictEqual(updated.goods, 'SnapMaker');
  assert.strictEqual(updated.status, 'paid');
  assert.strictEqual(updated.paymentType, 'FNB Card');
  db.close();
});

test('updatePurchase returns null for a missing id', () => {
  const db = openDb(':memory:');
  assert.strictEqual(updatePurchase('does-not-exist', { status: 'paid' }, db), null);
  db.close();
});

test('deletePurchase removes the row and getPurchase returns null afterward', () => {
  const db = openDb(':memory:');
  const purchase = createPurchase({ supplier: 'X', totalValue: 50 }, db);
  assert.strictEqual(deletePurchase(purchase.id, db), true);
  assert.strictEqual(getPurchase(purchase.id, db), null);
  db.close();
});
