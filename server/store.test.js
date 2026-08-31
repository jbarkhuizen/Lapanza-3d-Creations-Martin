import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeAllCachedDbs } from './db.js';

test('upsertProduct adds a category product and getProduct retrieves it', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
  const originalCwd = process.cwd();
  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'public'), { recursive: true });
  process.chdir(tmpRoot);

  t.after(() => {
    closeAllCachedDbs(); // release the SQLite file handle before deleting its directory (Windows locks open handles)
    process.chdir(originalCwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const { upsertProduct, getProduct, deleteProduct } = await import(`./store.js?t=${Date.now()}`);

  const product = upsertProduct({ id: 'p1', kind: 'category', slug: 'toys', name: 'Toys', items: [] });
  assert.strictEqual(product.slug, 'toys');
  assert.ok(getProduct('p1'));

  assert.strictEqual(deleteProduct('p1'), true);
  assert.strictEqual(getProduct('p1'), null);
});

test('saveCatalog writes atomically -- no .tmp residue, valid JSON on disk', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
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

  const { upsertProduct } = await import(`./store.js?t=${Date.now()}`);

  upsertProduct({ id: 'p2', kind: 'category', slug: 'homeware', name: 'Homeware', items: [{ sku: 'H1', stockQty: 4 }] });

  const dataFiles = fs.readdirSync(path.join(tmpRoot, 'data'));
  assert.ok(!dataFiles.some((f) => f.endsWith('.tmp')), 'temp file must be renamed away, not left behind');
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'data', 'catalog.json'), 'utf8'));
  assert.strictEqual(onDisk.products[0].items[0].stockQty, 4);
});
