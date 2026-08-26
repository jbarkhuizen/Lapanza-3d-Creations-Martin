import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeAllCachedDbs } from './db.js';

async function withTempCwd(t) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-test-'));
  const originalCwd = process.cwd();
  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'public'), { recursive: true });
  process.chdir(tmpRoot);

  t.after(() => {
    closeAllCachedDbs();
    process.chdir(originalCwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  return tmpRoot;
}

test('listInventory defaults every row to listed on the products page', async (t) => {
  await withTempCwd(t);
  const { createFilament, addColour } = await import(`./filaments.js?t=${Date.now()}`);
  const { upsertProduct } = await import(`./store.js?t=${Date.now()}`);
  const { listInventory } = await import(`./inventory.js?t=${Date.now()}`);

  const f = createFilament({ name: 'PLA' });
  addColour(f.id, { name: 'White', sku: 'SKU-1', stockQty: 5 });
  upsertProduct({ id: 'p1', kind: 'category', slug: 'toys', name: 'Toys', items: [{ id: 'i1', name: 'Dino', sku: 'SKU-2', stockQty: 3 }] });

  const rows = listInventory();
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((r) => r.listed === true));
});

// The New Order admin form's product picker (admin/admin.js) selects a
// catalog item purely by this productId -- it must resolve through
// resolveProductSnapshot (orders.js) exactly like a real cart line would.
test('listInventory rows carry the same productId scheme resolveProductSnapshot expects, plus shipping weight', async (t) => {
  await withTempCwd(t);
  const { createFilament, addColour } = await import(`./filaments.js?t=${Date.now()}`);
  const { upsertProduct } = await import(`./store.js?t=${Date.now()}`);
  const { listInventory } = await import(`./inventory.js?t=${Date.now()}`);
  const { resolveProductSnapshot } = await import(`./orders.js?t=${Date.now()}`);

  const f = createFilament({ name: 'PLA', slug: 'pla' });
  addColour(f.id, { name: 'White', sku: 'SKU-1', stockQty: 5, weightG: 1000, priceRand: 299 });
  upsertProduct({ id: 'p1', kind: 'category', slug: 'toys', name: 'Toys', items: [{ id: 'i1', name: 'Dino', sku: 'SKU-2', stockQty: 3, price: 'R150', weight: 200 }] });

  const rows = listInventory();
  const filamentRow = rows.find((r) => r.kind === 'filament');
  const categoryRow = rows.find((r) => r.kind === 'category');

  assert.strictEqual(filamentRow.productId, 'filament:pla:SKU-1');
  assert.strictEqual(filamentRow.weight, 1000);
  assert.strictEqual(resolveProductSnapshot(filamentRow.productId).name, 'PLA — White');

  assert.strictEqual(categoryRow.productId, 'category:toys:SKU-2');
  assert.strictEqual(categoryRow.weight, 200);
  assert.strictEqual(resolveProductSnapshot(categoryRow.productId).name, 'Dino');
});

test('bulkUpdateInventory can pull a filament colour off the products page and back on', async (t) => {
  await withTempCwd(t);
  const { createFilament, addColour } = await import(`./filaments.js?t=${Date.now()}`);
  const { listInventory, bulkUpdateInventory } = await import(`./inventory.js?t=${Date.now()}`);

  const f = createFilament({ name: 'PLA' });
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1', stockQty: 5 });
  const colourId = withColour.colours[0].id;

  const [result] = bulkUpdateInventory([{ kind: 'filament', id: colourId, parentId: f.id, listed: false }]);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(listInventory().find((r) => r.id === colourId).listed, false);

  bulkUpdateInventory([{ kind: 'filament', id: colourId, parentId: f.id, listed: true }]);
  assert.strictEqual(listInventory().find((r) => r.id === colourId).listed, true);
});

test('bulkUpdateInventory can pull a category item off the products page without touching stock/price', async (t) => {
  await withTempCwd(t);
  const { upsertProduct } = await import(`./store.js?t=${Date.now()}`);
  const { listInventory, bulkUpdateInventory } = await import(`./inventory.js?t=${Date.now()}`);

  upsertProduct({ id: 'p1', kind: 'category', slug: 'toys', name: 'Toys', items: [{ id: 'i1', name: 'Dino', sku: 'SKU-2', stockQty: 3, price: 'R150' }] });

  const [result] = bulkUpdateInventory([{ kind: 'category', id: 'i1', parentId: 'p1', listed: false }]);
  assert.strictEqual(result.ok, true);
  const row = listInventory().find((r) => r.id === 'i1');
  assert.strictEqual(row.listed, false);
  assert.strictEqual(row.stockQty, 3);
  assert.strictEqual(row.price, 150);
});
