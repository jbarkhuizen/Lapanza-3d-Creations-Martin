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

test('addItemImage appends photos up to the 5-photo cap; removeItemImage removes one', async (t) => {
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

  const { upsertProduct, addItemImage, removeItemImage, itemGalleryPaths, getProduct } = await import(`./store.js?t=${Date.now()}`);

  upsertProduct({ id: 'p1', kind: 'category', slug: 'toys', name: 'Toys', items: [{ id: 'i1', name: 'Dino' }] });

  addItemImage('p1', 'i1', '/uploads/category-items/a.jpg');
  addItemImage('p1', 'i1', '/uploads/category-items/b.jpg');
  addItemImage('p1', 'i1', '/uploads/category-items/c.jpg');
  addItemImage('p1', 'i1', '/uploads/category-items/d.jpg');
  addItemImage('p1', 'i1', '/uploads/category-items/e.jpg');
  assert.throws(() => addItemImage('p1', 'i1', '/uploads/category-items/f.jpg'), /at most 5 photos/);

  const item = getProduct('p1').items[0];
  assert.strictEqual(item.images.length, 5);
  assert.deepStrictEqual(itemGalleryPaths(item), item.images);

  removeItemImage('p1', 'i1', '/uploads/category-items/c.jpg');
  const afterRemove = getProduct('p1').items[0];
  assert.strictEqual(afterRemove.images.length, 4);
  assert.ok(!afterRemove.images.includes('/uploads/category-items/c.jpg'));
});

test('itemGalleryPaths falls back to imageUrl when the item has no gallery array yet', async (t) => {
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

  const { itemGalleryPaths } = await import(`./store.js?t=${Date.now()}`);
  assert.deepStrictEqual(itemGalleryPaths({ imageUrl: '/uploads/category-items/legacy.jpg' }), ['/uploads/category-items/legacy.jpg']);
  assert.deepStrictEqual(itemGalleryPaths({ imageUrl: '' }), []);
  assert.deepStrictEqual(itemGalleryPaths({ imageUrl: '/uploads/category-items/legacy.jpg', images: ['/uploads/category-items/new.jpg'] }), ['/uploads/category-items/new.jpg']);
});

test('reorderItemImages rejects a mismatched path list', async (t) => {
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

  const { upsertProduct, addItemImage, reorderItemImages, getProduct } = await import(`./store.js?t=${Date.now()}`);
  upsertProduct({ id: 'p1', kind: 'category', slug: 'toys', name: 'Toys', items: [{ id: 'i1', name: 'Dino' }] });
  addItemImage('p1', 'i1', '/uploads/category-items/a.jpg');
  addItemImage('p1', 'i1', '/uploads/category-items/b.jpg');

  reorderItemImages('p1', 'i1', ['/uploads/category-items/b.jpg', '/uploads/category-items/a.jpg']);
  assert.deepStrictEqual(getProduct('p1').items[0].images, ['/uploads/category-items/b.jpg', '/uploads/category-items/a.jpg']);

  assert.throws(() => reorderItemImages('p1', 'i1', ['/uploads/category-items/a.jpg']), /exactly the existing image paths/);
});

test('reorderItemImages rejects duplicate paths in the reorder list', async (t) => {
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

  const { upsertProduct, addItemImage, reorderItemImages } = await import(`./store.js?t=${Date.now()}`);
  upsertProduct({ id: 'p1', kind: 'category', slug: 'toys', name: 'Toys', items: [{ id: 'i1', name: 'Dino' }] });
  addItemImage('p1', 'i1', '/uploads/category-items/a.jpg');
  addItemImage('p1', 'i1', '/uploads/category-items/b.jpg');
  addItemImage('p1', 'i1', '/uploads/category-items/c.jpg');
  addItemImage('p1', 'i1', '/uploads/category-items/d.jpg');
  addItemImage('p1', 'i1', '/uploads/category-items/e.jpg');

  assert.throws(() => reorderItemImages('p1', 'i1', ['/uploads/category-items/a.jpg', '/uploads/category-items/a.jpg', '/uploads/category-items/a.jpg', '/uploads/category-items/a.jpg', '/uploads/category-items/a.jpg']), /exactly the existing image paths/);
});
