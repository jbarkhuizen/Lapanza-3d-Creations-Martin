import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { createInHouseFilament } from './in-house-filament.js';
import { computeJobCost, createPrintJob, previewPrintJobCost, getPrintJob, listPrintJobs, deletePrintJob } from './print-jobs.js';

const SETTINGS = {
  markupPct: 0.25,
  electricityRate: 4,
  printerPowerDraw: 0.2,
  runningCostsPct: 0.1,
  designRate: 100,
  setupRate: 50,
  postProcessingRate: 20,
};

function makeFilament(db, overrides = {}) {
  return createInHouseFilament({ filamentType: 'PLA', colorName: 'Black', rollsAvailable: 5, weightG: 1000, rollLengthM: 335, costPerRollRand: 300, ...overrides }, db);
}

test('computeJobCost sums cost across multiple resolved filament slots', () => {
  const slots = [
    { grams: 100, meters: 33.5, costPerG: 0.3 },
    { grams: 20, meters: 6.7, costPerG: 0.5 },
  ];
  const cost = computeJobCost({ printTimeMinutes: 0, designHours: 0, setupHours: 0, postProcessingHours: 0 }, SETTINGS, slots);
  assert.strictEqual(cost.totalGrams, 120);
  assert.strictEqual(cost.filamentCost, 100 * 0.3 + 20 * 0.5); // 30 + 10 = 40
});

test('computeJobCost with no filament grams: only power + labour + running cost + markup', () => {
  const cost = computeJobCost({ printTimeMinutes: 60, designHours: 1, setupHours: 0, postProcessingHours: 0 }, SETTINGS, []);
  assert.strictEqual(cost.filamentCost, 0);
  assert.strictEqual(cost.powerCost, 0.8);
  assert.strictEqual(cost.labourCost, 100);
  assert.strictEqual(cost.runningCost, 0.08);
});

test('createPrintJob requires at least one filament slot', () => {
  const db = openDb(':memory:');
  assert.throws(() => createPrintJob({ itemName: 'X', filaments: [] }, db), /At least one filament is required/);
  db.close();
});

test('createPrintJob rejects more than 4 filament slots', () => {
  const db = openDb(':memory:');
  const f = makeFilament(db);
  const slots = Array.from({ length: 5 }, () => ({ inHouseFilamentId: f.id, grams: 10, meters: 1 }));
  assert.throws(() => createPrintJob({ itemName: 'X', filaments: slots }, db), /At most 4 filaments/);
  db.close();
});

test('createPrintJob with up to 4 filament slots stores a snapshot and decrements each filament\'s used_g/used_m', () => {
  const db = openDb(':memory:');
  const f1 = makeFilament(db, { colorName: 'Black' });
  const f2 = makeFilament(db, { colorName: 'White' });
  const job = createPrintJob(
    {
      itemName: 'Dual Color Widget',
      filaments: [
        { inHouseFilamentId: f1.id, grams: 50, meters: 16.75 },
        { inHouseFilamentId: f2.id, grams: 20, meters: 6.7 },
      ],
      printTimeMinutes: 30,
    },
    db,
  );
  assert.strictEqual(job.filaments.length, 2);
  assert.strictEqual(job.totalGrams, 70);
  assert.strictEqual(job.totalMeters, 23.45);
  assert.ok(job.totalCost > 0);
  assert.ok(job.sellingPrice >= job.totalCost);

  const row1 = db.prepare('SELECT used_g, used_m FROM in_house_filament WHERE id = ?').get(f1.id);
  assert.strictEqual(row1.used_g, 50);
  assert.strictEqual(row1.used_m, 16.75);
  const row2 = db.prepare('SELECT used_g, used_m FROM in_house_filament WHERE id = ?').get(f2.id);
  assert.strictEqual(row2.used_g, 20);
  db.close();
});

test('previewPrintJobCost computes the same breakdown as createPrintJob but writes nothing', () => {
  const db = openDb(':memory:');
  const f = makeFilament(db);
  const input = { itemName: 'Preview Me', filaments: [{ inHouseFilamentId: f.id, grams: 40, meters: 13.4 }], printTimeMinutes: 15 };

  const preview = previewPrintJobCost(input, db);
  assert.ok(preview.totalCost > 0);
  assert.strictEqual(listPrintJobs({}, db).length, 0);

  const before = db.prepare('SELECT used_g FROM in_house_filament WHERE id = ?').get(f.id).used_g;
  assert.strictEqual(before, 0);

  const created = createPrintJob(input, db);
  assert.strictEqual(created.totalCost, preview.totalCost);
  db.close();
});

test('createPrintJob requires an item name', () => {
  const db = openDb(':memory:');
  const f = makeFilament(db);
  assert.throws(() => createPrintJob({ filaments: [{ inHouseFilamentId: f.id, grams: 10, meters: 1 }] }, db), /Item name is required/);
  db.close();
});

test('listPrintJobs filters by status, deletePrintJob removes the row and its filament slots', () => {
  const db = openDb(':memory:');
  const f = makeFilament(db);
  const a = createPrintJob({ itemName: 'A', status: 'planned', filaments: [{ inHouseFilamentId: f.id, grams: 5, meters: 1 }] }, db);
  createPrintJob({ itemName: 'B', filaments: [{ inHouseFilamentId: f.id, grams: 5, meters: 1 }] }, db);
  assert.strictEqual(listPrintJobs({ status: 'planned' }, db).length, 1);
  assert.strictEqual(listPrintJobs({}, db).length, 2);
  assert.strictEqual(deletePrintJob(a.id, db), true);
  assert.strictEqual(getPrintJob(a.id, db), null);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM print_job_filaments WHERE print_job_id = ?').get(a.id).n, 0);
  db.close();
});
