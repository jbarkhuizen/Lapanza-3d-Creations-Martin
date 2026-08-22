import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeAllCachedDbs } from './db.js';
import { createInHouseFilament } from './in-house-filament.js';
import {
  computeJobCost,
  createPrintJob,
  previewPrintJobCost,
  getPrintJob,
  listPrintJobs,
  deletePrintJob,
  updatePrintJob,
  listPrintJobForSale,
  updatePrintJobListing,
  setPrintJobFile,
  setPrintJobImage,
} from './print-jobs.js';
import { upsertProduct, getProduct } from './store.js';

// Category products live in data/catalog.json (a flat file keyed off
// process.cwd(), not SQLite -- see store.js/paths.js), so listing-related
// tests need their own isolated cwd, same technique store.test.js uses.
function withTempCatalogDir(fn) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'print-jobs-listing-test-'));
  const originalCwd = process.cwd();
  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'public'), { recursive: true });
  process.chdir(tmpRoot);
  return Promise.resolve(fn()).finally(() => {
    closeAllCachedDbs(); // release the SQLite file handle before deleting its directory (Windows locks open handles)
    process.chdir(originalCwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
}

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
  const a = createPrintJob({ itemName: 'A', status: 'Estimate', filaments: [{ inHouseFilamentId: f.id, grams: 5, meters: 1 }] }, db);
  createPrintJob({ itemName: 'B', filaments: [{ inHouseFilamentId: f.id, grams: 5, meters: 1 }] }, db);
  assert.strictEqual(listPrintJobs({ status: 'Estimate' }, db).length, 1);
  assert.strictEqual(listPrintJobs({}, db).length, 2);
  assert.strictEqual(deletePrintJob(a.id, db), true);
  assert.strictEqual(getPrintJob(a.id, db), null);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM print_job_filaments WHERE print_job_id = ?').get(a.id).n, 0);
  db.close();
});

test('setPrintJobFile/setPrintJobImage store the original filename alongside the randomized storage path', () => {
  const db = openDb(':memory:');
  const f = makeFilament(db);
  const job = createPrintJob({ itemName: 'Joint Box 8x5', filaments: [{ inHouseFilamentId: f.id, grams: 40, meters: 13.4 }] }, db);
  assert.strictEqual(job.referenceFileOriginalName, null);

  const withFile = setPrintJobFile(job.id, '/uploads/print-jobs/abc123.3mf', 'Joint Box 8x5.3mf', db);
  assert.strictEqual(withFile.referenceFilePath, '/uploads/print-jobs/abc123.3mf');
  assert.strictEqual(withFile.referenceFileOriginalName, 'Joint Box 8x5.3mf');

  const withImage = setPrintJobImage(job.id, '/uploads/print-jobs/def456.jpg', 'photo.jpg', db);
  assert.strictEqual(withImage.referenceImagePath, '/uploads/print-jobs/def456.jpg');
  assert.strictEqual(withImage.referenceImageOriginalName, 'photo.jpg');
  db.close();
});

test('setPrintJobFile without an originalName (e.g. an older caller) stores null rather than throwing', () => {
  const db = openDb(':memory:');
  const f = makeFilament(db);
  const job = createPrintJob({ itemName: 'Widget', filaments: [{ inHouseFilamentId: f.id, grams: 10, meters: 1 }] }, db);
  const updated = setPrintJobFile(job.id, '/uploads/print-jobs/xyz.stl', undefined, db);
  assert.strictEqual(updated.referenceFileOriginalName, null);
  db.close();
});

test('createPrintJob defaults finalSellingPrice to the computed minimum when not supplied', () => {
  const db = openDb(':memory:');
  const f = makeFilament(db);
  const job = createPrintJob({ itemName: 'Widget', filaments: [{ inHouseFilamentId: f.id, grams: 40, meters: 13.4 }] }, db);
  assert.strictEqual(job.finalSellingPrice, job.sellingPrice);
  db.close();
});

test('createPrintJob respects an explicit finalSellingPrice, updatePrintJob can change it later', () => {
  const db = openDb(':memory:');
  const f = makeFilament(db);
  const job = createPrintJob(
    { itemName: 'Widget', finalSellingPrice: 999, filaments: [{ inHouseFilamentId: f.id, grams: 40, meters: 13.4 }] },
    db,
  );
  assert.strictEqual(job.finalSellingPrice, 999);
  assert.notStrictEqual(job.finalSellingPrice, job.sellingPrice); // minimum is unaffected by the override

  const updated = updatePrintJob(job.id, { finalSellingPrice: 1200, status: 'Printed' }, db);
  assert.strictEqual(updated.finalSellingPrice, 1200);
  assert.strictEqual(updated.status, 'Printed');
  db.close();
});

test('updatePrintJob ignores an invalid status/price rather than clobbering existing values', () => {
  const db = openDb(':memory:');
  const f = makeFilament(db);
  const job = createPrintJob({ itemName: 'Widget', status: 'Estimate', filaments: [{ inHouseFilamentId: f.id, grams: 10, meters: 1 }] }, db);
  const updated = updatePrintJob(job.id, { status: 'Nonsense', finalSellingPrice: -5 }, db);
  assert.strictEqual(updated.status, 'Estimate');
  assert.strictEqual(updated.finalSellingPrice, job.finalSellingPrice);
  db.close();
});

test('listPrintJobForSale creates a category item, links the job, and stock/price flow through', async () => {
  await withTempCatalogDir(async () => {
    const db = openDb(':memory:');
    upsertProduct({ id: 'cat-toys', kind: 'category', slug: 'toys', name: 'Toys', items: [] }, db);
    const f = makeFilament(db);
    const job = createPrintJob(
      { itemName: 'Dragon Figurine', finalSellingPrice: 249, filaments: [{ inHouseFilamentId: f.id, grams: 80, meters: 26.8 }] },
      db,
    );

    const listed = listPrintJobForSale(job.id, { categorySlug: 'toys', stockQty: 3 }, db);
    assert.strictEqual(listed.listingCategoryId, 'cat-toys');
    assert.ok(listed.listingItemId);

    const product = getProduct('cat-toys');
    const item = product.items.find((i) => i.id === listed.listingItemId);
    assert.strictEqual(item.name, 'Dragon Figurine');
    assert.strictEqual(item.price, '249');
    assert.strictEqual(item.stockQty, 3);
    assert.strictEqual(item.weight, job.totalGrams);
    db.close();
  });
});

test('listPrintJobForSale refuses to list the same job twice', async () => {
  await withTempCatalogDir(async () => {
    const db = openDb(':memory:');
    upsertProduct({ id: 'cat-toys', kind: 'category', slug: 'toys', name: 'Toys', items: [] }, db);
    const f = makeFilament(db);
    const job = createPrintJob({ itemName: 'Widget', finalSellingPrice: 100, filaments: [{ inHouseFilamentId: f.id, grams: 10, meters: 1 }] }, db);
    listPrintJobForSale(job.id, { categorySlug: 'toys', stockQty: 1 }, db);
    assert.throws(() => listPrintJobForSale(job.id, { categorySlug: 'toys', stockQty: 1 }, db), /Already listed/);
    db.close();
  });
});

test('listPrintJobForSale rejects an unknown category', async () => {
  await withTempCatalogDir(async () => {
    const db = openDb(':memory:');
    const f = makeFilament(db);
    const job = createPrintJob({ itemName: 'Widget', finalSellingPrice: 100, filaments: [{ inHouseFilamentId: f.id, grams: 10, meters: 1 }] }, db);
    assert.throws(() => listPrintJobForSale(job.id, { categorySlug: 'nonexistent', stockQty: 1 }, db), /Category not found/);
    db.close();
  });
});

test('updatePrintJobListing requires the job to already be listed', () => {
  const db = openDb(':memory:');
  const f = makeFilament(db);
  const job = createPrintJob({ itemName: 'Widget', finalSellingPrice: 100, filaments: [{ inHouseFilamentId: f.id, grams: 10, meters: 1 }] }, db);
  assert.throws(() => updatePrintJobListing(job.id, { stockQty: 5 }, db), /not been listed/);
  db.close();
});

test('updatePrintJobListing bumps stock ("printed 3 more") on the existing linked item', async () => {
  await withTempCatalogDir(async () => {
    const db = openDb(':memory:');
    upsertProduct({ id: 'cat-toys', kind: 'category', slug: 'toys', name: 'Toys', items: [] }, db);
    const f = makeFilament(db);
    const job = createPrintJob({ itemName: 'Widget', finalSellingPrice: 100, filaments: [{ inHouseFilamentId: f.id, grams: 10, meters: 1 }] }, db);
    const listed = listPrintJobForSale(job.id, { categorySlug: 'toys', stockQty: 1 }, db);

    updatePrintJobListing(job.id, { stockQty: 4, price: 150 }, db);

    const product = getProduct('cat-toys');
    const item = product.items.find((i) => i.id === listed.listingItemId);
    assert.strictEqual(item.stockQty, 4);
    assert.strictEqual(item.price, '150');
    // Still exactly one item -- an update, not a second duplicate listing.
    assert.strictEqual(product.items.length, 1);
    db.close();
  });
});
