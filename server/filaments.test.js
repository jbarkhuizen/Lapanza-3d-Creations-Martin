import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import {
  listFilaments,
  getFilament,
  createFilament,
  updateFilament,
  deleteFilament,
  addColour,
  updateColour,
  deleteColour,
  setColourImage,
  listColourImages,
  addColourImage,
  removeColourImage,
  reorderColourImages,
  colourGalleryPaths,
} from './filaments.js';

test('createFilament + getFilament round-trip', () => {
  const db = openDb(':memory:');
  const created = createFilament({ name: 'PLA', description: 'Standard PLA' }, db);
  assert.strictEqual(created.slug, 'pla');
  const fetched = getFilament(created.id, db);
  assert.strictEqual(fetched.name, 'PLA');
  assert.deepStrictEqual(fetched.colours, []);
  db.close();
});

test('listFilaments returns types ordered by sort_order', () => {
  const db = openDb(':memory:');
  createFilament({ name: 'PETG', sortOrder: 1 }, db);
  createFilament({ name: 'PLA', sortOrder: 0 }, db);
  const list = listFilaments(db);
  assert.deepStrictEqual(list.map((f) => f.name), ['PLA', 'PETG']);
  db.close();
});

test('addColour attaches a colour with numeric fields to a filament type', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const updated = addColour(f.id, { name: 'White', sku: 'SKU-1', weightG: 1000, priceRand: 299, stockQty: 5 }, db);
  assert.strictEqual(updated.colours.length, 1);
  assert.strictEqual(updated.colours[0].weightG, 1000);
  assert.strictEqual(updated.colours[0].priceRand, 299);
  assert.strictEqual(updated.colours[0].stockQty, 5);
  assert.strictEqual(updated.colours[0].rollLengthM, null);
  db.close();
});

test('updateColour changes stock/price/weight/roll length', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;
  const updated = updateColour(f.id, colourId, { stockQty: 12, priceRand: 349, rollLengthM: 330 }, db);
  assert.strictEqual(updated.colours[0].stockQty, 12);
  assert.strictEqual(updated.colours[0].priceRand, 349);
  assert.strictEqual(updated.colours[0].rollLengthM, 330);
  db.close();
});

test('addColour defaults listed to true; updateColour can pull it off the products page', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  assert.strictEqual(withColour.colours[0].listed, true);

  const colourId = withColour.colours[0].id;
  const unlisted = updateColour(f.id, colourId, { listed: false }, db);
  assert.strictEqual(unlisted.colours[0].listed, false);
  // Unrelated fields are untouched by the listed-only patch.
  assert.strictEqual(unlisted.colours[0].sku, 'SKU-1');

  const relisted = updateColour(f.id, colourId, { listed: true }, db);
  assert.strictEqual(relisted.colours[0].listed, true);
  db.close();
});

test('deleteColour removes just that colour', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;
  assert.strictEqual(deleteColour(f.id, colourId, db), true);
  assert.strictEqual(getFilament(f.id, db).colours.length, 0);
  db.close();
});

test('deleteFilament cascades to its colours', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  assert.strictEqual(deleteFilament(f.id, db), true);
  assert.strictEqual(getFilament(f.id, db), null);
  const orphanColours = db.prepare('SELECT COUNT(*) AS n FROM filament_colours').get().n;
  assert.strictEqual(orphanColours, 0);
  db.close();
});

test('setColourImage sets image_path and getFilament reflects it', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;
  const updated = setColourImage(f.id, colourId, '/uploads/filaments/sku-1-abcd1234.jpg', db);
  assert.strictEqual(updated.colours[0].imagePath, '/uploads/filaments/sku-1-abcd1234.jpg');
  db.close();
});

test('updateFilament preserves fields not included in the patch', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA', description: 'Original' }, db);
  const updated = updateFilament(f.id, { name: 'PLA Premium' }, db);
  assert.strictEqual(updated.name, 'PLA Premium');
  assert.strictEqual(updated.description, 'Original');
  db.close();
});

test('updateColour clears a previously-set rollLengthM back to null when the patch sends null', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1', rollLengthM: 330 }, db);
  const colourId = withColour.colours[0].id;
  assert.strictEqual(withColour.colours[0].rollLengthM, 330);

  const cleared = updateColour(f.id, colourId, { rollLengthM: null }, db);
  assert.strictEqual(cleared.colours[0].rollLengthM, null);
  db.close();
});

test('updateColour preserves rollLengthM when the patch omits the key entirely', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1', rollLengthM: 330 }, db);
  const colourId = withColour.colours[0].id;

  const updated = updateColour(f.id, colourId, { stockQty: 9 }, db);
  assert.strictEqual(updated.colours[0].rollLengthM, 330);
  assert.strictEqual(updated.colours[0].stockQty, 9);
  db.close();
});

test('updateFilament preserves draft status when a partial update omits the status field', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA', status: 'draft' }, db);
  assert.strictEqual(f.status, 'draft');

  const updated = updateFilament(f.id, { description: 'New description' }, db);
  assert.strictEqual(updated.status, 'draft');
  assert.strictEqual(updated.description, 'New description');
  db.close();
});

test('updateColour with non-numeric input does not throw and preserves existing value', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1', weightG: 1000, priceRand: 299, stockQty: 5 }, db);
  const colourId = withColour.colours[0].id;
  // Pass invalid numeric values - should not throw and should preserve existing values
  const updated = updateColour(f.id, colourId, { weightG: 'abc', priceRand: 'xyz', stockQty: 'invalid', rollLengthM: 'bad' }, db);
  assert.strictEqual(updated.colours[0].weightG, 1000);
  assert.strictEqual(updated.colours[0].priceRand, 299);
  assert.strictEqual(updated.colours[0].stockQty, 5);
  assert.strictEqual(updated.colours[0].rollLengthM, null);
  db.close();
});

test('updateColour clearing SKU to blank falls back to a colourId-derived SKU instead of colliding with another blank-SKU colour', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColours = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  addColour(f.id, { name: 'Black', sku: 'SKU-2' }, db);
  const whiteId = withColours.colours[0].id;

  // Clearing the first colour's SKU must not persist '' -- sku is UNIQUE
  // NOT NULL, so a second colour later clearing its own SKU would otherwise
  // collide with this one and surface as a confusing "duplicate SKU" error.
  const afterClear = updateColour(f.id, whiteId, { sku: '' }, db);
  const whiteAfter = afterClear.colours.find((c) => c.id === whiteId);
  assert.notStrictEqual(whiteAfter.sku, '');
  assert.ok(whiteAfter.sku);

  // Clearing the second colour's SKU must succeed too, not throw a UNIQUE
  // constraint violation against the first colour's now-generated fallback.
  const blackId = afterClear.colours.find((c) => c.name === 'Black').id;
  assert.doesNotThrow(() => updateColour(f.id, blackId, { sku: '' }, db));
  db.close();
});

test('addColourImage appends photos in order, up to the 5-photo cap', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;

  addColourImage(colourId, '/uploads/filaments/a.jpg', db);
  addColourImage(colourId, '/uploads/filaments/b.jpg', db);
  const images = listColourImages(colourId, db);
  assert.strictEqual(images.length, 2);
  assert.strictEqual(images[0].imagePath, '/uploads/filaments/a.jpg');
  assert.strictEqual(images[1].imagePath, '/uploads/filaments/b.jpg');
  assert.strictEqual(images[0].sortOrder, 0);
  assert.strictEqual(images[1].sortOrder, 1);

  addColourImage(colourId, '/uploads/filaments/c.jpg', db);
  addColourImage(colourId, '/uploads/filaments/d.jpg', db);
  addColourImage(colourId, '/uploads/filaments/e.jpg', db);
  assert.throws(() => addColourImage(colourId, '/uploads/filaments/f.jpg', db), /at most 5 photos/);
  assert.strictEqual(listColourImages(colourId, db).length, 5);
  db.close();
});

test('removeColourImage deletes the row and returns the remaining list; unknown id returns null', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;
  addColourImage(colourId, '/uploads/filaments/a.jpg', db);
  const afterSecond = addColourImage(colourId, '/uploads/filaments/b.jpg', db);
  const added = afterSecond[afterSecond.length - 1];

  const remaining = removeColourImage(colourId, added.id, db);
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].imagePath, '/uploads/filaments/a.jpg');

  assert.strictEqual(removeColourImage(colourId, 'not-a-real-id', db), null);
  db.close();
});

test('reorderColourImages persists a new sort order and rejects a mismatched id list', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;
  addColourImage(colourId, '/uploads/filaments/a.jpg', db);
  addColourImage(colourId, '/uploads/filaments/b.jpg', db);
  const [first, second] = listColourImages(colourId, db);

  const reordered = reorderColourImages(colourId, [second.id, first.id], db);
  assert.strictEqual(reordered[0].imagePath, '/uploads/filaments/b.jpg');
  assert.strictEqual(reordered[1].imagePath, '/uploads/filaments/a.jpg');

  assert.throws(() => reorderColourImages(colourId, [first.id], db), /exactly the existing image ids/);
  assert.throws(() => reorderColourImages(colourId, [first.id, 'bogus'], db), /exactly the existing image ids/);
  assert.throws(() => reorderColourImages(colourId, [first.id, first.id], db), /exactly the existing image ids/);
  db.close();
});

test('colourGalleryPaths falls back to the legacy image_path when no gallery rows exist', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;

  assert.deepStrictEqual(colourGalleryPaths(getFilament(f.id, db).colours[0], db), []);

  setColourImage(f.id, colourId, '/uploads/filaments/legacy.jpg', db);
  assert.deepStrictEqual(colourGalleryPaths(getFilament(f.id, db).colours[0], db), ['/uploads/filaments/legacy.jpg']);

  addColourImage(colourId, '/uploads/filaments/gallery-1.jpg', db);
  assert.deepStrictEqual(colourGalleryPaths(getFilament(f.id, db).colours[0], db), ['/uploads/filaments/gallery-1.jpg']);
  db.close();
});

// #139: rich text is sanitized AT SAVE, not just at render -- a hostile or
// pasted-in payload must never reach the database.
test('createFilament and updateFilament sanitize description and colourNote', () => {
  const db = openDb(':memory:');
  const created = createFilament({
    name: 'ASA',
    description: '<p onclick="x()">Tough</p><script>alert(1)</script>',
    colourNote: '<b>Note</b><img src=x onerror=alert(1)>',
  }, db);
  assert.strictEqual(created.description, '<p>Tough</p>alert(1)');
  assert.strictEqual(created.colourNote, '<strong>Note</strong>');
  const updated = updateFilament(created.id, { description: '<a href="javascript:alert(1)">safe text</a>' }, db);
  assert.strictEqual(updated.description, 'safe text');
  // carry-forward path re-sanitizes too (progressively cleans legacy rows)
  const untouched = updateFilament(created.id, { name: 'ASA+' }, db);
  assert.strictEqual(untouched.colourNote, '<strong>Note</strong>');
  db.close();
});
