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
  moveColourToFilament,
  setColourImage,
  listColourImages,
  addColourImage,
  removeColourImage,
  reorderColourImages,
  colourGalleryPaths,
  startSpecial,
  endSpecial,
  listSpecials,
  listSpecialCandidates,
  endExpiredAndSoldOutSpecials,
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

// Owner request (2026-09-09): "Move To" fixes a roll captured under the
// wrong filament type without a delete-and-recreate.
test('moveColourToFilament moves a colour to a different filament type, keeping its sku/stock/price', () => {
  const db = openDb(':memory:');
  const pla = createFilament({ name: 'PLA' }, db);
  const petg = createFilament({ name: 'PETG' }, db);
  const withColour = addColour(pla.id, { name: 'Black', sku: 'SKU-1', stockQty: 5, priceRand: 225 }, db);
  const colourId = withColour.colours[0].id;

  const source = moveColourToFilament(pla.id, colourId, petg.id, db);
  assert.strictEqual(source.colours.length, 0, 'moved colour no longer on the source type');

  const target = getFilament(petg.id, db);
  assert.strictEqual(target.colours.length, 1);
  assert.strictEqual(target.colours[0].id, colourId);
  assert.strictEqual(target.colours[0].sku, 'SKU-1');
  assert.strictEqual(target.colours[0].stockQty, 5);
  assert.strictEqual(target.colours[0].priceRand, 225);
  db.close();
});

test('moveColourToFilament rejects moving to the same type, an unknown type, or an unknown colour', () => {
  const db = openDb(':memory:');
  const pla = createFilament({ name: 'PLA' }, db);
  const petg = createFilament({ name: 'PETG' }, db);
  const withColour = addColour(pla.id, { name: 'Black', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;

  assert.throws(() => moveColourToFilament(pla.id, colourId, pla.id, db), /different filament type/);
  assert.throws(() => moveColourToFilament(pla.id, colourId, 'unknown-type-id', db), /Target filament type not found/);
  assert.strictEqual(moveColourToFilament(pla.id, 'unknown-colour-id', petg.id, db), null);
  db.close();
});

test('moveColourToFilament refuses to move an active special (mirrors deleteColour\'s guard)', () => {
  const db = openDb(':memory:');
  const pla = createFilament({ name: 'PLA' }, db);
  const other = createFilament({ name: 'PETG' }, db);
  const withBase = addColour(pla.id, { name: 'Black', sku: 'SKU-1', stockQty: 10, priceRand: 225 }, db);
  const baseId = withBase.colours[0].id;
  const special = startSpecial(baseId, { specialPriceRand: 199, quantity: 2, days: 2 }, db);
  assert.strictEqual(special.specialStatus, 'active');

  assert.throws(() => moveColourToFilament(pla.id, special.id, other.id, db), /active special/);
  // The base colour itself (not special) still moves freely.
  assert.doesNotThrow(() => moveColourToFilament(pla.id, baseId, other.id, db));
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

test('buying price round-trips through addColour/updateColour, defaults 0', () => {
  const db = openDb(':memory:');
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const withColour = addColour(filament.id, { name: 'Red', sku: 'BUY-1', priceRand: 300, weightG: 1000, stockQty: 5, buyingPriceRand: 180.5 }, db);
  assert.strictEqual(withColour.colours[0].buyingPriceRand, 180.5);

  const updated = updateColour(filament.id, withColour.colours[0].id, { buyingPriceRand: 199.99 }, db);
  assert.strictEqual(updated.colours[0].buyingPriceRand, 199.99);
  // Untouched by an unrelated update.
  const again = updateColour(filament.id, withColour.colours[0].id, { stockQty: 3 }, db);
  assert.strictEqual(again.colours[0].buyingPriceRand, 199.99);

  const plain = addColour(filament.id, { name: 'Blue', sku: 'BUY-2', priceRand: 300, weightG: 1000 }, db);
  assert.strictEqual(plain.colours.find((c) => c.sku === 'BUY-2').buyingPriceRand, 0);
  db.close();
});

// ---- Flash Stock Specials ----

function seedBaseColour(db, overrides = {}) {
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const withColour = addColour(
    filament.id,
    { name: 'Black', sku: 'PLA-BLK-100', priceRand: 349, weightG: 1000, stockQty: 40, buyingPriceRand: 180, ...overrides },
    db,
  );
  return { filament, base: withColour.colours[0] };
}

test('startSpecial splits stock off the base colour into a new, separately-priced row', () => {
  const db = openDb(':memory:');
  const { base, filament } = seedBaseColour(db);

  const special = startSpecial(base.id, { specialPriceRand: 249, quantity: 10, days: 2 }, db);
  assert.strictEqual(special.priceRand, 249);
  assert.strictEqual(special.stockQty, 10);
  assert.strictEqual(special.specialInitialQty, 10);
  assert.strictEqual(special.specialStatus, 'active');
  assert.strictEqual(special.specialSourceColourId, base.id);
  assert.strictEqual(special.specialWasPriceRand, 349);
  assert.strictEqual(special.name, 'Black (Special)');
  assert.strictEqual(special.sku, 'PLA-BLK-100-SPECIAL');
  // Buying price defaults from the base colour when none is supplied.
  assert.strictEqual(special.buyingPriceRand, 180);
  assert.ok(special.specialEndsAt);

  const baseAfter = getFilament(filament.id, db).colours.find((c) => c.id === base.id);
  assert.strictEqual(baseAfter.stockQty, 30);
  db.close();
});

test('startSpecial rejects allocating more than what is actually in stock', () => {
  const db = openDb(':memory:');
  const { base } = seedBaseColour(db, { stockQty: 5 });
  assert.throws(() => startSpecial(base.id, { specialPriceRand: 249, quantity: 10, days: 2 }, db), /Only 5 in stock/);
  db.close();
});

test('startSpecial refuses a second active special while one is already running, and refuses special-of-a-special', () => {
  const db = openDb(':memory:');
  const { base } = seedBaseColour(db);
  const special = startSpecial(base.id, { specialPriceRand: 249, quantity: 10, days: 2 }, db);
  assert.throws(() => startSpecial(base.id, { specialPriceRand: 199, quantity: 5, days: 1 }, db), /already has an active special/);
  assert.throws(() => startSpecial(special.id, { specialPriceRand: 150, quantity: 2, days: 1 }, db), /already a special/);
  db.close();
});

test('endSpecial (early end, leftover stock) rejoins the unsold units at the base colour\'s standard price', () => {
  const db = openDb(':memory:');
  const { base, filament } = seedBaseColour(db);
  const special = startSpecial(base.id, { specialPriceRand: 249, quantity: 10, days: 2 }, db);

  // Simulate 4 sold during the special (the same generic UPDATE
  // decrementStockForOrder would run -- no special-aware code involved).
  db.prepare('UPDATE filament_colours SET stock_qty = stock_qty - 4 WHERE id = ?').run(special.id);

  const ended = endSpecial(special.id, db);
  assert.strictEqual(ended.specialStatus, 'ended');
  assert.strictEqual(ended.stockQty, 0);
  assert.strictEqual(ended.listed, false);

  const baseAfter = getFilament(filament.id, db).colours.find((c) => c.id === base.id);
  // Started at 40, 10 split off (30), 6 unsold rejoin (36) -- the 4 sold
  // during the special are gone for good, same as any other sale.
  assert.strictEqual(baseAfter.stockQty, 36);
  db.close();
});

test('endSpecial on a sold-out special (0 remaining) ends cleanly with no merge needed', () => {
  const db = openDb(':memory:');
  const { base, filament } = seedBaseColour(db);
  const special = startSpecial(base.id, { specialPriceRand: 249, quantity: 10, days: 2 }, db);
  db.prepare('UPDATE filament_colours SET stock_qty = 0 WHERE id = ?').run(special.id);

  endSpecial(special.id, db);
  const baseAfter = getFilament(filament.id, db).colours.find((c) => c.id === base.id);
  assert.strictEqual(baseAfter.stockQty, 30); // unchanged -- nothing left to rejoin
  db.close();
});

test('endSpecial rejects an id that is not an active special', () => {
  const db = openDb(':memory:');
  const { base } = seedBaseColour(db);
  assert.throws(() => endSpecial(base.id, db), /Active special not found/);
  db.close();
});

test('endExpiredAndSoldOutSpecials ends a sold-out one and a time-expired one, leaves a healthy one running', () => {
  const db = openDb(':memory:');
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const addBase = (sku) => addColour(filament.id, { name: sku, sku, priceRand: 349, weightG: 1000, stockQty: 40 }, db).colours.find((c) => c.sku === sku);

  const soldOutBase = addBase('A-1');
  const soldOut = startSpecial(soldOutBase.id, { specialPriceRand: 100, quantity: 5, days: 2 }, db);
  db.prepare('UPDATE filament_colours SET stock_qty = 0 WHERE id = ?').run(soldOut.id);

  const expiredBase = addBase('A-2');
  const expired = startSpecial(expiredBase.id, { specialPriceRand: 100, quantity: 5, days: 2 }, db);
  db.prepare("UPDATE filament_colours SET special_ends_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(expired.id);

  const healthyBase = addBase('A-3');
  const healthy = startSpecial(healthyBase.id, { specialPriceRand: 100, quantity: 5, days: 2 }, db);

  const ended = endExpiredAndSoldOutSpecials(db);
  assert.deepStrictEqual(new Set(ended.map((s) => s.id)), new Set([soldOut.id, expired.id]));

  const stillActive = db.prepare("SELECT special_status FROM filament_colours WHERE id = ?").get(healthy.id);
  assert.strictEqual(stillActive.special_status, 'active');
  db.close();
});

test('listSpecials returns active and ended specials newest first, with filament/base names attached', () => {
  const db = openDb(':memory:');
  const { base } = seedBaseColour(db);
  const special = startSpecial(base.id, { specialPriceRand: 249, quantity: 10, days: 2 }, db);
  const list = listSpecials(db);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, special.id);
  assert.strictEqual(list[0].filamentName, 'PLA');
  assert.strictEqual(list[0].baseColourName, 'Black');

  endSpecial(special.id, db);
  const afterEnd = listSpecials(db);
  assert.strictEqual(afterEnd.length, 1);
  assert.strictEqual(afterEnd[0].specialStatus, 'ended');
  db.close();
});

test('listSpecialCandidates excludes out-of-stock colours and specials themselves', () => {
  const db = openDb(':memory:');
  const { filament, base } = seedBaseColour(db);
  addColour(filament.id, { name: 'Empty', sku: 'EMPTY-1', priceRand: 300, weightG: 1000, stockQty: 0 }, db);
  const special = startSpecial(base.id, { specialPriceRand: 249, quantity: 10, days: 2 }, db);

  const candidates = listSpecialCandidates(db);
  const skus = candidates.map((c) => c.sku);
  assert.ok(skus.includes('PLA-BLK-100'));
  assert.ok(!skus.includes('EMPTY-1'));
  assert.ok(!skus.includes(special.sku));
  db.close();
});

test('deleteColour refuses to delete an active special (would silently skip the merge-back), allows it once ended', () => {
  const db = openDb(':memory:');
  const { filament, base } = seedBaseColour(db);
  const special = startSpecial(base.id, { specialPriceRand: 249, quantity: 10, days: 2 }, db);

  assert.throws(() => deleteColour(filament.id, special.id, db), /active special/);
  // The base colour itself is never blocked -- only the special row is.
  assert.strictEqual(deleteColour(filament.id, base.id, db), true);

  endSpecial(special.id, db);
  assert.strictEqual(deleteColour(filament.id, special.id, db), true);
  db.close();
});

test('starting a second special on the same colour after the first ended gets a distinct SKU', () => {
  const db = openDb(':memory:');
  const { base } = seedBaseColour(db);
  const first = startSpecial(base.id, { specialPriceRand: 249, quantity: 10, days: 2 }, db);
  endSpecial(first.id, db);
  const second = startSpecial(base.id, { specialPriceRand: 199, quantity: 5, days: 1 }, db);
  assert.notStrictEqual(second.sku, first.sku);
  db.close();
});
