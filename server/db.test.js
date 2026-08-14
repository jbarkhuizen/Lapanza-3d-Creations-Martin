import { test } from 'node:test';
import assert from 'node:assert';
import { openDb, ensureSchema } from './db.js';

test('ensureSchema creates all four tables', () => {
  const db = openDb(':memory:');
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepStrictEqual(tables, ['admins', 'filament_colours', 'filament_types', 'settings']);
  db.close();
});

test('ensureSchema is idempotent (safe to call twice)', () => {
  const db = openDb(':memory:');
  assert.doesNotThrow(() => ensureSchema(db));
  db.close();
});

test('filament_colours cascades delete when filament_types row is removed', () => {
  const db = openDb(':memory:');
  db.prepare(
    `INSERT INTO filament_types (id, slug, name, description, colour_note, specs_json, seo_title, seo_description, internal_notes, status, featured, sort_order, created_at, updated_at)
     VALUES ('t1','pla','PLA','','','[]','','','','published',0,0,'now','now')`,
  ).run();
  db.prepare(
    `INSERT INTO filament_colours (id, filament_type_id, name, hex, sku, weight_g, roll_length_m, price_rand, stock_qty, image_path, notes, sort_order, created_at, updated_at)
     VALUES ('c1','t1','White','','SKU-1',1000,NULL,299,5,NULL,'',0,'now','now')`,
  ).run();
  db.pragma('foreign_keys = ON');
  db.prepare('DELETE FROM filament_types WHERE id = ?').run('t1');
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM filament_colours').get();
  assert.strictEqual(remaining.n, 0);
  db.close();
});
