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
  transferStockRoll,
  setInHouseFilamentArchived,
  getInHouseFilamentUsage,
  forceDeleteInHouseFilament,
} from './in-house-filament.js';
import { createPrintJob } from './print-jobs.js';

test('createInHouseFilament requires filament type and color name', () => {
  const db = openDb(':memory:');
  assert.throws(() => createInHouseFilament({ colorName: 'Black' }, db), /Filament type is required/);
  assert.throws(() => createInHouseFilament({ filamentType: 'PLA' }, db), /Color name is required/);
  db.close();
});

test('createInHouseFilament rejects a duplicate brand+filamentType+colorName, case-insensitively', () => {
  const db = openDb(':memory:');
  createInHouseFilament({ brand: 'SunLu', filamentType: 'PLA', colorName: 'Black', rollsAvailable: 1, weightG: 1000, rollLengthM: 335, costPerRollRand: 300 }, db);
  assert.throws(
    () => createInHouseFilament({ brand: 'sunlu', filamentType: 'pla', colorName: '  black  ', rollsAvailable: 1, weightG: 1000, rollLengthM: 335, costPerRollRand: 300 }, db),
    /already exists/,
  );
  // A genuinely different colour for the same type is still fine.
  assert.doesNotThrow(() => createInHouseFilament({ brand: 'Creality', filamentType: 'PLA', colorName: 'Black', rollsAvailable: 1, weightG: 1000, rollLengthM: 335, costPerRollRand: 300 }, db));
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

// Review #5 (todo #144): rolls locked by print-job history archive instead
// of deleting -- flagged in the list, excluded from pickers by the client,
// history untouched, reversible.
test('setInHouseFilamentArchived flags a roll and unarchives it again', () => {
  const db = openDb(':memory:');
  const f = createInHouseFilament({ brand: 'Test', filamentType: 'PLA', colorName: 'Charred Gold', rollsAvailable: 1, weightG: 750 }, db);
  assert.strictEqual(f.archived, false);
  const archived = setInHouseFilamentArchived(f.id, true, db);
  assert.strictEqual(archived.archived, true);
  assert.strictEqual(listInHouseFilament(db).find((x) => x.id === f.id).archived, true);
  const back = setInHouseFilamentArchived(f.id, false, db);
  assert.strictEqual(back.archived, false);
  assert.strictEqual(setInHouseFilamentArchived('nope', true, db), null);
  db.close();
});

// Owner report (2026-09-10): duplicate/mis-captured in-house filament rows
// blocked from a normal delete once a real logged print job references
// them -- the override lets an admin remove them anyway, naming exactly
// what it costs (the referencing jobs lose this filament's cost line).
test('deleteInHouseFilament refuses once a print job references it; forceDeleteInHouseFilament removes it and that job\'s slot for it', () => {
  const db = openDb(':memory:');
  const f = createInHouseFilament({ filamentType: 'PLA', colorName: 'Duplicate Black', rollsAvailable: 5, weightG: 1000, rollLengthM: 335, costPerRollRand: 300 }, db);
  const job = createPrintJob({ itemName: 'Test Widget', filaments: [{ inHouseFilamentId: f.id, grams: 50, meters: 16.75 }], printTimeMinutes: 20 }, db);

  assert.throws(() => deleteInHouseFilament(f.id, db), /Cannot delete — this filament has been used in a logged print job\./);

  const usage = getInHouseFilamentUsage(f.id, db);
  assert.strictEqual(usage.length, 1);
  assert.strictEqual(usage[0].jobId, job.id);
  assert.strictEqual(usage[0].itemName, 'Test Widget');
  assert.strictEqual(usage[0].grams, 50);

  const result = forceDeleteInHouseFilament(f.id, db);
  assert.strictEqual(result.removedUsageCount, 1);
  assert.strictEqual(getInHouseFilament(f.id, db), null, 'the filament itself is gone');
  // The print job ROW survives -- only its filament slot referencing the
  // now-deleted filament is gone, not the whole job's history.
  assert.ok(db.prepare('SELECT id FROM print_jobs WHERE id = ?').get(job.id), 'print job itself is untouched');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM print_job_filaments WHERE in_house_filament_id = ?').get(f.id).n, 0);

  assert.throws(() => forceDeleteInHouseFilament(f.id, db), /In-house filament not found/, 'cannot force-delete something already gone');
  db.close();
});

test('getInHouseFilamentUsage returns an empty list for a filament with no print-job history, and forceDeleteInHouseFilament still works (0 jobs removed)', () => {
  const db = openDb(':memory:');
  const f = createInHouseFilament({ filamentType: 'PLA', colorName: 'Never Used', rollsAvailable: 1, weightG: 1000, rollLengthM: 335 }, db);
  assert.deepStrictEqual(getInHouseFilamentUsage(f.id, db), []);
  const result = forceDeleteInHouseFilament(f.id, db);
  assert.strictEqual(result.removedUsageCount, 0);
  assert.strictEqual(getInHouseFilament(f.id, db), null);
  db.close();
});
