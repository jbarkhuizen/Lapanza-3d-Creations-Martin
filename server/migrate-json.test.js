import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb } from './db.js';
import { migrateFromCatalogJson, parsePriceToRand } from './migrate-json.js';

function writeFixtureCatalog() {
  const file = path.join(os.tmpdir(), `catalog-fixture-${Date.now()}.json`);
  const catalog = {
    version: 1,
    updatedAt: 'now',
    settings: {
      siteName: 'Lapanza 3D Creative Lab',
      adminPasswordHash: 'should-not-migrate',
    },
    products: [
      {
        id: 'p1',
        kind: 'filament',
        slug: 'pla',
        name: 'PLA',
        description: 'Standard PLA',
        colours: [
          { name: 'White', sku: 'SKU-1', price: 'R299', inStock: true },
          { name: 'Black', sku: 'SKU-2', price: 'R329', inStock: false },
        ],
      },
      {
        id: 'p2',
        kind: 'category',
        slug: 'toys',
        name: 'Toys',
        items: [{ name: 'Dice set', price: 'R99' }],
      },
    ],
  };
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2));
  return file;
}

test('parsePriceToRand strips currency symbols', () => {
  assert.strictEqual(parsePriceToRand('R299'), 299);
  assert.strictEqual(parsePriceToRand('R1,299'), 1);
  assert.strictEqual(parsePriceToRand(''), 0);
  assert.strictEqual(parsePriceToRand(null), 0);
});

test('migrateFromCatalogJson imports filament products into SQLite and strips them from the JSON file', () => {
  const db = openDb(':memory:');
  const fixture = writeFixtureCatalog();

  const result = migrateFromCatalogJson(db, fixture);
  assert.strictEqual(result.migrated, true);
  assert.strictEqual(result.filamentTypeCount, 1);

  const types = db.prepare('SELECT * FROM filament_types').all();
  assert.strictEqual(types.length, 1);
  assert.strictEqual(types[0].slug, 'pla');

  const colours = db.prepare('SELECT * FROM filament_colours ORDER BY sort_order').all();
  assert.strictEqual(colours.length, 2);
  assert.strictEqual(colours[0].sku, 'SKU-1');
  assert.strictEqual(colours[0].price_rand, 299);
  assert.strictEqual(colours[0].stock_qty, 1);
  assert.strictEqual(colours[1].stock_qty, 0);

  const settingsRows = db.prepare('SELECT key FROM settings').all().map((r) => r.key);
  assert.ok(settingsRows.includes('siteName'));
  assert.ok(!settingsRows.includes('adminPasswordHash'));

  const remaining = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  assert.strictEqual(remaining.products.length, 1);
  assert.strictEqual(remaining.products[0].kind, 'category');
  assert.strictEqual(remaining.settings, undefined);

  fs.unlinkSync(fixture);
  db.close();
});

test('migrateFromCatalogJson is a no-op when the file does not exist', () => {
  const db = openDb(':memory:');
  const result = migrateFromCatalogJson(db, path.join(os.tmpdir(), 'does-not-exist.json'));
  assert.strictEqual(result.migrated, false);
  db.close();
});
