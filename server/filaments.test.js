import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import {
  listFilaments,
  getFilament,
  createFilament,
  updateFilament,
  deleteFilament,
  addColour,
  updateColour,
  deleteColour,
  setColourImage,
} from './filaments.js';

test('createFilament + getFilament round-trip', () => {
  const db = openDb(':memory:');
  const created = createFilament({ name: 'PLA', description: 'Standard PLA' }, db);
  assert.strictEqual(created.slug, 'pla');
  const fetched = getFilament(created.id, db);
  assert.strictEqual(fetched.name, 'PLA');
  assert.deepStrictEqual(fetched.colours, []);
  db.close();
});

test('listFilaments returns types ordered by sort_order', () => {
  const db = openDb(':memory:');
  createFilament({ name: 'PETG', sortOrder: 1 }, db);
  createFilament({ name: 'PLA', sortOrder: 0 }, db);
  const list = listFilaments(db);
  assert.deepStrictEqual(list.map((f) => f.name), ['PLA', 'PETG']);
  db.close();
});

test('addColour attaches a colour with numeric fields to a filament type', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const updated = addColour(f.id, { name: 'White', sku: 'SKU-1', weightG: 1000, priceRand: 299, stockQty: 5 }, db);
  assert.strictEqual(updated.colours.length, 1);
  assert.strictEqual(updated.colours[0].weightG, 1000);
  assert.strictEqual(updated.colours[0].priceRand, 299);
  assert.strictEqual(updated.colours[0].stockQty, 5);
  assert.strictEqual(updated.colours[0].rollLengthM, null);
  db.close();
});

test('updateColour changes stock/price/weight/roll length', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;
  const updated = updateColour(f.id, colourId, { stockQty: 12, priceRand: 349, rollLengthM: 330 }, db);
  assert.strictEqual(updated.colours[0].stockQty, 12);
  assert.strictEqual(updated.colours[0].priceRand, 349);
  assert.strictEqual(updated.colours[0].rollLengthM, 330);
  db.close();
});

test('deleteColour removes just that colour', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;
  assert.strictEqual(deleteColour(f.id, colourId, db), true);
  assert.strictEqual(getFilament(f.id, db).colours.length, 0);
  db.close();
});

test('deleteFilament cascades to its colours', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  assert.strictEqual(deleteFilament(f.id, db), true);
  assert.strictEqual(getFilament(f.id, db), null);
  const orphanColours = db.prepare('SELECT COUNT(*) AS n FROM filament_colours').get().n;
  assert.strictEqual(orphanColours, 0);
  db.close();
});

test('setColourImage sets image_path and getFilament reflects it', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;
  const updated = setColourImage(f.id, colourId, '/uploads/filaments/sku-1-abcd1234.jpg', db);
  assert.strictEqual(updated.colours[0].imagePath, '/uploads/filaments/sku-1-abcd1234.jpg');
  db.close();
});

test('updateFilament preserves fields not included in the patch', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA', description: 'Original' }, db);
  const updated = updateFilament(f.id, { name: 'PLA Premium' }, db);
  assert.strictEqual(updated.name, 'PLA Premium');
  assert.strictEqual(updated.description, 'Original');
  db.close();
});

test('updateColour with non-numeric input does not throw and preserves existing value', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1', weightG: 1000, priceRand: 299, stockQty: 5 }, db);
  const colourId = withColour.colours[0].id;
  // Pass invalid numeric values - should not throw and should preserve existing values
  const updated = updateColour(f.id, colourId, { weightG: 'abc', priceRand: 'xyz', stockQty: 'invalid', rollLengthM: 'bad' }, db);
  assert.strictEqual(updated.colours[0].weightG, 1000);
  assert.strictEqual(updated.colours[0].priceRand, 299);
  assert.strictEqual(updated.colours[0].stockQty, 5);
  assert.strictEqual(updated.colours[0].rollLengthM, null);
  db.close();
});
