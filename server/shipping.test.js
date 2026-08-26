import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { createShippingOption, updateShippingOption, listShippingOptions } from './shipping.js';

test('createShippingOption stores a category, defaulting to empty when not given', () => {
  const db = openDb(':memory:');
  const categorised = createShippingOption({ name: 'PUDO Locker (Small)', optionType: 'fixed', price: 65, category: 'PUDO Locker' }, db);
  assert.strictEqual(categorised.category, 'PUDO Locker');

  const uncategorised = createShippingOption({ name: 'Misc option', optionType: 'fixed', price: 50 }, db);
  assert.strictEqual(uncategorised.category, '');
  db.close();
});

test('updateShippingOption changes the category without touching other fields, and leaves it alone when omitted', () => {
  const db = openDb(':memory:');
  const option = createShippingOption({ name: 'Local delivery', optionType: 'fixed', price: 50, category: 'PUDO Locker' }, db);

  const recategorised = updateShippingOption(option.id, { category: 'Local Delivery' }, db);
  assert.strictEqual(recategorised.category, 'Local Delivery');
  assert.strictEqual(recategorised.name, 'Local delivery');

  const untouched = updateShippingOption(option.id, { price: 55 }, db);
  assert.strictEqual(untouched.category, 'Local Delivery');
  assert.strictEqual(untouched.price, 55);
  db.close();
});

test('listShippingOptions returns category alongside every option', () => {
  const db = openDb(':memory:');
  createShippingOption({ name: 'Courier bracket', optionType: 'auto_weight', minWeight: 0, maxWeight: 1000, price: 80, category: 'Courier' }, db);
  const options = listShippingOptions({}, db);
  assert.strictEqual(options[0].category, 'Courier');
  db.close();
});
