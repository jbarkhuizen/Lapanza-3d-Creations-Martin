import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb } from './db.js';
import { createFilament, addColour } from './filaments.js';
import { syncPublicJson, readCategoryProducts } from './export.js';
import { updateSettings } from './settings.js';

function tmpFile(name) {
  return path.join(os.tmpdir(), `export-test-${Date.now()}-${name}`);
}

test('readCategoryProducts filters to kind===category and handles a missing file', () => {
  const missing = tmpFile('missing.json');
  assert.deepStrictEqual(readCategoryProducts(missing), []);

  const file = tmpFile('catalog.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      products: [
        { kind: 'category', slug: 'toys', name: 'Toys', items: [] },
        { kind: 'filament', slug: 'pla', name: 'PLA' },
      ],
    }),
  );
  const cats = readCategoryProducts(file);
  assert.strictEqual(cats.length, 1);
  assert.strictEqual(cats[0].slug, 'toys');
  fs.unlinkSync(file);
});

test('syncPublicJson writes filaments.json with colour photo, price and stock fields', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA', description: 'Standard PLA' }, db);
  addColour(f.id, { name: 'White', sku: 'SKU-1', priceRand: 299, weightG: 1000, stockQty: 5 }, db);

  const paths = {
    catalogJsonPath: tmpFile('catalog.json'),
    filamentsSrc: tmpFile('filaments.json'),
    categoriesSrc: tmpFile('categories.json'),
    settingsSrc: tmpFile('settings.json'),
    settingsPublic: tmpFile('site-settings.json'),
  };
  fs.writeFileSync(paths.catalogJsonPath, JSON.stringify({ products: [] }));

  syncPublicJson(db, paths);

  const filaments = JSON.parse(fs.readFileSync(paths.filamentsSrc, 'utf8'));
  assert.strictEqual(filaments.length, 1);
  assert.strictEqual(filaments[0].colours[0].price, 'R 299.00');
  assert.strictEqual(filaments[0].colours[0].stockQty, 5);
  assert.strictEqual(filaments[0].colours[0].listed, true);

  const settings = JSON.parse(fs.readFileSync(paths.settingsSrc, 'utf8'));
  assert.strictEqual(settings.siteName, 'Lapanza 3D Creative Lab');

  Object.values(paths).forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
  db.close();
});

test('syncPublicJson carries the Stock Management "listed" flag through to categories.json', () => {
  const db = openDb(':memory:');

  const paths = {
    catalogJsonPath: tmpFile('catalog.json'),
    filamentsSrc: tmpFile('filaments.json'),
    categoriesSrc: tmpFile('categories.json'),
    settingsSrc: tmpFile('settings.json'),
    settingsPublic: tmpFile('site-settings.json'),
  };
  fs.writeFileSync(
    paths.catalogJsonPath,
    JSON.stringify({
      products: [
        {
          kind: 'category',
          slug: 'toys',
          name: 'Toys',
          items: [
            { id: 'i1', name: 'Dino', price: 'R150', listed: false },
            { id: 'i2', name: 'Robot', price: 'R200' },
          ],
        },
      ],
    }),
  );

  syncPublicJson(db, paths);

  const categories = JSON.parse(fs.readFileSync(paths.categoriesSrc, 'utf8'));
  assert.strictEqual(categories.toys.items[0].listed, false);
  // Items created before the "listed" field existed default to listed.
  assert.strictEqual(categories.toys.items[1].listed, true);

  Object.values(paths).forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
  db.close();
});

test('syncPublicJson resolves featuredProducts (filament + category) fresh from current catalog data, dropping refs that no longer resolve', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA', description: 'Standard PLA' }, db);
  addColour(f.id, { name: 'White', sku: 'SKU-1', priceRand: 299, weightG: 1000, stockQty: 5 }, db);

  const paths = {
    catalogJsonPath: tmpFile('catalog.json'),
    filamentsSrc: tmpFile('filaments.json'),
    categoriesSrc: tmpFile('categories.json'),
    settingsSrc: tmpFile('settings.json'),
    settingsPublic: tmpFile('site-settings.json'),
  };
  fs.writeFileSync(
    paths.catalogJsonPath,
    JSON.stringify({
      products: [
        { kind: 'category', slug: 'toys', name: 'Toys', items: [{ id: 'i1', sku: 'UNO', name: 'Uno Box', price: '150' }] },
      ],
    }),
  );
  updateSettings(
    {
      featuredProducts: [
        { id: 'a', productId: `filament:${f.slug}:SKU-1`, active: true },
        { id: 'b', productId: 'category:toys:UNO', active: true },
        { id: 'c', productId: 'category:toys:DOES-NOT-EXIST', active: true },
        { id: 'd', productId: 'category:toys:UNO', active: false },
      ],
    },
    db,
  );

  syncPublicJson(db, paths);

  const settings = JSON.parse(fs.readFileSync(paths.settingsSrc, 'utf8'));
  assert.strictEqual(settings.featuredProducts.length, 2);
  const filamentEntry = settings.featuredProducts.find((p) => p.productId.startsWith('filament:'));
  assert.strictEqual(filamentEntry.name, 'PLA — White');
  assert.strictEqual(filamentEntry.price, 'R 299.00');
  assert.strictEqual(filamentEntry.href, `filament/${f.slug}.html#item-sku-1`);
  const categoryEntry = settings.featuredProducts.find((p) => p.productId.startsWith('category:'));
  assert.strictEqual(categoryEntry.name, 'Uno Box');
  assert.strictEqual(categoryEntry.price, 'R 150.00');
  assert.strictEqual(categoryEntry.href, 'toys.html#item-uno');

  Object.values(paths).forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
  db.close();
});
