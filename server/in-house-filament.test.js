import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import {
  listInHouseFilament,
  getInHouseFilament,
  createInHouseFilament,
  updateInHouseFilament,
  deleteInHouseFilament,
  incrementInHouseFilamentUsage,
} from './in-house-filament.js';

test('createInHouseFilament requires filament type and color name', () => {
  const db = openDb(':memory:');
  assert.throws(() => createInHouseFilament({ colorName: 'Black' }, db), /Filament type is required/);
  assert.throws(() => createInHouseFilament({ filamentType: 'PLA' }, db), /Color name is required/);
  db.close();
});

test('createInHouseFilament computes remaining/percentLeft from rolls x per-roll spec', () => {
  const db = openDb(':memory:');
  const f = createInHouseFilament({ filamentType: 'PLA', colorName: 'Black', rollsAvailable: 3, weightG: 1000, rollLengthM: 335, costPerRollRand: 300 }, db);
  assert.strictEqual(f.remainingG, 3000);
  assert.strictEqual(f.remainingM, 1005);
  assert.strictEqual(f.percentLeft, 1);
  assert.strictEqual(f.costPerG, 0.3);
  db.close();
});

test('incrementInHouseFilamentUsage decreases remaining and percentLeft', () => {
  const db = openDb(':memory:');
  const f = createInHouseFilament({ filamentType: 'PLA', colorName: 'Red', rollsAvailable: 1, weightG: 1000, rollLengthM: 335, costPerRollRand: 300 }, db);
  incrementInHouseFilamentUsage(f.id, { usedG: 250, usedM: 83.75 }, db);
  const updated = getInHouseFilament(f.id, db);
  assert.strictEqual(updated.remainingG, 750);
  assert.strictEqual(updated.percentLeft, 0.75);
  db.close();
});

test('updateInHouseFilament applies partial updates without clobbering other fields', () => {
  const db = openDb(':memory:');
  const f = createInHouseFilament({ filamentType: 'PETG', colorName: 'Blue', rollsAvailable: 2, weightG: 1000, rollLengthM: 327, costPerRollRand: 250 }, db);
  const updated = updateInHouseFilament(f.id, { rollsAvailable: 5 }, db);
  assert.strictEqual(updated.rollsAvailable, 5);
  assert.strictEqual(updated.colorName, 'Blue');
  assert.strictEqual(updated.costPerRollRand, 250);
  db.close();
});

test('listInHouseFilament orders by type then color', () => {
  const db = openDb(':memory:');
  createInHouseFilament({ filamentType: 'PLA', colorName: 'White', rollsAvailable: 1, weightG: 1000, rollLengthM: 335, costPerRollRand: 300 }, db);
  createInHouseFilament({ filamentType: 'ABS', colorName: 'Black', rollsAvailable: 1, weightG: 1000, rollLengthM: 400, costPerRollRand: 300 }, db);
  const list = listInHouseFilament(db);
  assert.strictEqual(list[0].filamentType, 'ABS');
  assert.strictEqual(list[1].filamentType, 'PLA');
  db.close();
});

test('deleteInHouseFilament removes the row', () => {
  const db = openDb(':memory:');
  const f = createInHouseFilament({ filamentType: 'PLA', colorName: 'Green', rollsAvailable: 1, weightG: 1000, rollLengthM: 335, costPerRollRand: 300 }, db);
  assert.strictEqual(deleteInHouseFilament(f.id, db), true);
  assert.strictEqual(getInHouseFilament(f.id, db), null);
  db.close();
});
