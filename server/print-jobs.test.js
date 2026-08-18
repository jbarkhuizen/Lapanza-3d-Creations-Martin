import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { computeJobCost, createPrintJob, getPrintJob, listPrintJobs, deletePrintJob } from './print-jobs.js';

const SETTINGS = {
  markupPct: 0.25,
  electricityRate: 4,
  printerPowerDraw: 0.2,
  runningCostsPct: 0.1,
  designRate: 100,
  setupRate: 50,
  postProcessingRate: 20,
};

test('computeJobCost with no filament: only power + labour + running cost + markup', () => {
  const cost = computeJobCost(
    { printTimeMinutes: 60, designHours: 1, setupHours: 0, postProcessingHours: 0 },
    SETTINGS,
    null,
  );
  // power: 1hr * 0.2kWh/hr * R4/kWh = R0.80
  assert.strictEqual(cost.filamentCost, 0);
  assert.strictEqual(cost.powerCost, 0.8);
  // labour: 1hr design * R100/hr = R100
  assert.strictEqual(cost.labourCost, 100);
  // running cost: (0 + 0.8) * 0.1 = 0.08
  assert.strictEqual(cost.runningCost, 0.08);
  const totalCost = 0 + 0.8 + 100 + 0.08;
  assert.strictEqual(cost.totalCost, Math.round(totalCost * 100) / 100);
  // markup: totalCost * 0.25
  assert.strictEqual(cost.markupAmount, Math.round(totalCost * 0.25 * 100) / 100);
  assert.strictEqual(cost.sellingPrice, Math.round((totalCost + totalCost * 0.25) * 100) / 100);
});

test('computeJobCost derives filament cost from priceRand/weightG times grams used', () => {
  const filament = { priceRand: 300, weightG: 1000 }; // R0.30/g
  const cost = computeJobCost({ modelG: 100, supportG: 20 }, SETTINGS, filament);
  assert.strictEqual(cost.totalFilamentG, 120);
  assert.strictEqual(cost.filamentCost, 36); // 120g * R0.30
});

test('computeJobCost markupPct override beats the settings default', () => {
  const cost = computeJobCost({ modelG: 10 }, SETTINGS, { priceRand: 100, weightG: 100 });
  const costWithDefault = cost.markupAmount;
  const overridden = computeJobCost({ modelG: 10, markupPct: 0.5 }, SETTINGS, { priceRand: 100, weightG: 100 });
  assert.notStrictEqual(overridden.markupAmount, costWithDefault);
  assert.strictEqual(overridden.markupPct, 0.5);
});

test('createPrintJob stores a snapshot and decrements the picked filament colour\'s used_g', () => {
  const db = openDb(':memory:');
  db.prepare(
    `INSERT INTO filament_types (id, slug, name, description, colour_note, specs_json, seo_title, seo_description, internal_notes, status, featured, sort_order, created_at, updated_at)
     VALUES ('t1','pla','PLA','','','[]','','','','published',0,0,'now','now')`,
  ).run();
  db.prepare(
    `INSERT INTO filament_colours (id, filament_type_id, name, hex, sku, weight_g, roll_length_m, price_rand, stock_qty, image_path, notes, sort_order, created_at, updated_at)
     VALUES ('c1','t1','Black','','SKU-1',1000,335,300,3,NULL,'',0,'now','now')`,
  ).run();
  // settings table empty -> falls back to DEFAULT_SETTINGS, fine for this test

  const job = createPrintJob({ itemName: 'Test Widget', filamentColourId: 'c1', modelG: 50, printTimeMinutes: 30 }, db);
  assert.strictEqual(job.itemName, 'Test Widget');
  assert.ok(job.totalCost >= 0);
  assert.ok(job.sellingPrice >= job.totalCost);

  const colour = db.prepare('SELECT used_g FROM filament_colours WHERE id = ?').get('c1');
  assert.strictEqual(colour.used_g, 50);
  db.close();
});

test('createPrintJob requires an item name', () => {
  const db = openDb(':memory:');
  assert.throws(() => createPrintJob({}, db), /Item name is required/);
  db.close();
});

test('listPrintJobs filters by status, deletePrintJob removes the row', () => {
  const db = openDb(':memory:');
  const a = createPrintJob({ itemName: 'A', status: 'planned' }, db);
  createPrintJob({ itemName: 'B' }, db);
  assert.strictEqual(listPrintJobs({ status: 'planned' }, db).length, 1);
  assert.strictEqual(listPrintJobs({}, db).length, 2);
  assert.strictEqual(deletePrintJob(a.id, db), true);
  assert.strictEqual(getPrintJob(a.id, db), null);
  db.close();
});
