# Product Photo Galleries + Detail Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Up to 5 photos per product (filament colours, category items, car-parts items), a swipeable card carousel with dot indicators on every listing page, and a real per-product detail page (full gallery + Add to Cart) that the photo links to.

**Architecture:** Filament colours get a new `filament_colour_images` SQLite child table (CASCADE, mirrors `design_request_files`). Category/car-parts items get an `images: string[]` array on their `catalog.json` item object. Both fall back to the existing single legacy photo when no gallery exists yet. `scripts/generate-pages.mjs` gains a shared gallery HTML partial, Product+Offer JSON-LD, and a new detail-page writer per product type; a new `src/js/product-gallery.js` (CSS scroll-snap + `IntersectionObserver`, no library) is imported from the already-shared `site.js` bundle so every generated page gets gallery behavior with zero per-page wiring. Admin gets a drag-reorder thumbnail panel (native HTML5 Drag and Drop, no library) replacing the single-file input for both product types.

**Tech Stack:** Node/Express, better-sqlite3, vanilla ES modules (no frontend framework, no new npm dependencies), multer (existing), sharp (existing, via `server/images.js`), Playwright (existing e2e harness) for browser verification.

**Spec:** `docs/superpowers/specs/2026-09-01-product-photo-gallery-design.md`

## Global Constraints

- 5 photos per product, hard cap, enforced server-side (reject the 6th, never silently drop it) — per spec's Data model section.
- Legacy single-photo fallback: a product with zero gallery entries shows its old `image_path`/`imageUrl` as photo #1 everywhere (storefront cards, detail pages, admin panel) — no migration script, no backfill, purely a defensive read-time fallback — per spec's Data model section.
- No new npm dependencies — native HTML5 Drag and Drop for admin reorder, CSS scroll-snap + `IntersectionObserver` for the storefront carousel, matching this codebase's zero-dependency-admin/zero-carousel-library precedent.
- **URL scheme refinement from the spec** (a deliberate, documented deviation, not scope drift): the spec's nested paths (`filament/<type-slug>/<colour-slug>.html`) would need `vite.config.js`'s `htmlEntries()` directory-discovery loop made recursive, which the loop is not today (confirmed non-recursive, single-level `readdirSync` over `filament/` and `car-parts/` only) — exactly the class of bug that has caused live 404s in this project before (see `docs/AI_HANDOFF.md`'s vite htmlEntries incident notes). This plan instead writes:
  - Filament colour detail pages as **flat files directly inside the existing `filament/` directory**: `filament/<type-slug>-<colour-sku-lowercased>.html` — vite's existing non-recursive loop over `filament/` already picks these up with zero `vite.config.js` changes.
  - Category **and** car-parts item detail pages into **one new flat directory**, `products/`: `products/<category-slug>-<item-slug>-<sku-lowercased>.html` — requires exactly one line added to `vite.config.js`'s directory-discovery list (`'products'`), no recursion needed.
- Every upload call still runs `generateImageVariants()` (480/960 WebP) exactly as today — once per photo, not once per product.
- `imageUrl`/`images` (category items) and the gallery table (filament colours) are never writable through the whole-product/whole-item PUT body — only through the dedicated image upload/delete/reorder routes, matching the existing rule for `imageUrl` (`server/index.js`'s item PUT route forces `imageUrl: existing.imageUrl`).

---

### Task 1: Filament colour image gallery — schema + CRUD module + tests

**Files:**
- Modify: `server/db.js` (add `ensureFilamentColourImagesTable`, register it in `ensureSchema()`)
- Modify: `server/filaments.js` (add gallery CRUD functions)
- Modify: `server/filaments.test.js` (new tests)

**Interfaces:**
- Consumes: `getDb()` from `db.js`, `deleteImageFile` from `uploads.js` (already imported in `filaments.js`)
- Produces: `listColourImages(colourId, db)`, `addColourImage(colourId, imagePath, db)`, `removeColourImage(colourId, imageId, db)`, `reorderColourImages(colourId, orderedIds, db)`, `colourGalleryPaths(colour, db)` — all exported from `server/filaments.js`, all default `db = getDb()` as the last param, matching every other function in that file.

- [ ] **Step 1: Write the failing tests**

Append to `server/filaments.test.js` (imports at the top of that file already include `openDb`, `createFilament`, `addColour` — add the new function names to the existing `import { ... } from './filaments.js'` line: `listColourImages, addColourImage, removeColourImage, reorderColourImages, colourGalleryPaths`):

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="addColourImage|removeColourImage|reorderColourImages|colourGalleryPaths"`
Expected: FAIL with an import error (function not defined)

- [ ] **Step 3: Add the schema table**

In `server/db.js`, add this new function right after `ensureDesignRequestV2Columns` (whose closing `}` is immediately followed by the `ensureListingColumns` function in the existing file):

```js
// #95: gallery table for filament colour photos (up to 5, admin-ordered).
// Same CASCADE/index shape as design_request_files -- a colour's photos are
// deleted automatically when the colour itself is (filament_colours already
// has ON DELETE CASCADE from filament_types, so this chains transitively).
function ensureFilamentColourImagesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS filament_colour_images (
      id TEXT PRIMARY KEY,
      colour_id TEXT NOT NULL REFERENCES filament_colours(id) ON DELETE CASCADE,
      image_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_filament_colour_images_colour ON filament_colour_images (colour_id);
  `);
}
```

Register it in the `ensureSchema()` call list — find this exact block and add the new line immediately after `ensureDesignRequestV2Columns(db);`:

```js
  ensureDesignRequestStatusColumns(db);
  ensureDesignRequestV2Columns(db);
  ensureFilamentColourImagesTable(db);
  ensureShippingCategoryColumn(db);
```

- [ ] **Step 4: Add the CRUD functions to filaments.js**

In `server/filaments.js`, add near the bottom, right after `setColourImage` (the last function in the file):

```js
const MAX_GALLERY_IMAGES = 5;

export function listColourImages(colourId, db = getDb()) {
  return db
    .prepare('SELECT id, image_path AS imagePath, sort_order AS sortOrder FROM filament_colour_images WHERE colour_id = ? ORDER BY sort_order ASC')
    .all(colourId);
}

export function addColourImage(colourId, imagePath, db = getDb()) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM filament_colour_images WHERE colour_id = ?').get(colourId).n;
  if (count >= MAX_GALLERY_IMAGES) throw new Error(`A product can have at most ${MAX_GALLERY_IMAGES} photos`);
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM filament_colour_images WHERE colour_id = ?').get(colourId).m;
  db.prepare('INSERT INTO filament_colour_images (id, colour_id, image_path, sort_order, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), colourId, imagePath, maxSort + 1, new Date().toISOString());
  return listColourImages(colourId, db);
}

export function removeColourImage(colourId, imageId, db = getDb()) {
  const row = db.prepare('SELECT * FROM filament_colour_images WHERE id = ? AND colour_id = ?').get(imageId, colourId);
  if (!row) return null;
  deleteImageFile(row.image_path);
  db.prepare('DELETE FROM filament_colour_images WHERE id = ?').run(imageId);
  return listColourImages(colourId, db);
}

// orderedIds must be exactly the current image ids for this colour, in the
// new order -- rejecting anything else (missing/extra/foreign ids) rather
// than silently applying a partial reorder.
export function reorderColourImages(colourId, orderedIds, db = getDb()) {
  const existing = listColourImages(colourId, db);
  const existingIds = new Set(existing.map((i) => i.id));
  const valid = Array.isArray(orderedIds) && orderedIds.length === existing.length && orderedIds.every((id) => existingIds.has(id));
  if (!valid) throw new Error('Reorder list must contain exactly the existing image ids');
  const tx = db.transaction((ids) => {
    ids.forEach((id, i) => db.prepare('UPDATE filament_colour_images SET sort_order = ? WHERE id = ?').run(i, id));
  });
  tx(orderedIds);
  return listColourImages(colourId, db);
}

// Read-time fallback (#95): a colour with no gallery rows yet still shows
// its single legacy photo as "photo #1" everywhere -- storefront cards,
// detail pages, and the admin gallery panel all call this instead of
// reading colour.imagePath or filament_colour_images directly.
export function colourGalleryPaths(colour, db = getDb()) {
  const images = listColourImages(colour.id, db);
  if (images.length) return images.map((i) => i.imagePath);
  return colour.imagePath ? [colour.imagePath] : [];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="addColourImage|removeColourImage|reorderColourImages|colourGalleryPaths"`
Expected: PASS (4 new tests)

- [ ] **Step 6: Run the full unit suite**

Run: `npm test`
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add server/db.js server/filaments.js server/filaments.test.js
git commit -m "feat: filament colour photo gallery data model + CRUD"
```

---

### Task 2: Category/car-parts item image gallery — catalog.json array + CRUD + tests

**Files:**
- Modify: `server/store.js` (add gallery CRUD functions)
- Modify: `server/store.test.js` (new tests)

**Interfaces:**
- Consumes: `getProduct(id)`, `upsertProduct(product, db)` (both already in `server/store.js`)
- Produces: `addItemImage(productId, itemId, imagePath, db)`, `removeItemImage(productId, itemId, imagePath, db)`, `reorderItemImages(productId, itemId, orderedPaths, db)`, `itemGalleryPaths(item)` — all exported from `server/store.js`. `itemGalleryPaths` takes a plain item object (no db needed — pure function over already-loaded data), matching how `catalogueItems()` in the generator already receives items in-memory.

- [ ] **Step 1: Write the failing tests**

Append to `server/store.test.js` (this file uses the `withTempCwd` + dynamic-import convention — follow the exact pattern from the existing `upsertProduct adds a category product...` test, importing the new functions in the same dynamic `import()` call):

```js
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
```

Add `import { closeAllCachedDbs } from './db.js';` to the top of `server/store.test.js` if it isn't already imported there (the existing test in that file already uses it per the research — verify before adding a duplicate import).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="addItemImage|itemGalleryPaths|reorderItemImages"`
Expected: FAIL — import error

- [ ] **Step 3: Add the CRUD functions to store.js**

Add to `server/store.js`, after the existing `upsertProduct` function:

```js
const MAX_ITEM_IMAGES = 5;

export function addItemImage(productId, itemId, imagePath, db = getDb()) {
  const product = getProduct(productId);
  if (!product) return null;
  const item = (product.items || []).find((i) => i.id === itemId);
  if (!item) return null;
  item.images = Array.isArray(item.images) ? item.images : [];
  if (item.images.length >= MAX_ITEM_IMAGES) throw new Error(`A product can have at most ${MAX_ITEM_IMAGES} photos`);
  item.images.push(imagePath);
  upsertProduct(product, db);
  return item.images;
}

export function removeItemImage(productId, itemId, imagePath, db = getDb()) {
  const product = getProduct(productId);
  if (!product) return null;
  const item = (product.items || []).find((i) => i.id === itemId);
  if (!item) return null;
  item.images = (item.images || []).filter((p) => p !== imagePath);
  upsertProduct(product, db);
  return item.images;
}

// orderedPaths must be exactly the item's current images, in the new order.
export function reorderItemImages(productId, itemId, orderedPaths, db = getDb()) {
  const product = getProduct(productId);
  if (!product) return null;
  const item = (product.items || []).find((i) => i.id === itemId);
  if (!item) return null;
  const existing = item.images || [];
  const valid = Array.isArray(orderedPaths) && orderedPaths.length === existing.length && orderedPaths.every((p) => existing.includes(p));
  if (!valid) throw new Error('Reorder list must contain exactly the existing image paths');
  item.images = orderedPaths;
  upsertProduct(product, db);
  return item.images;
}

// Read-time fallback (#95), pure function -- no db access, takes whatever
// item object the caller already has in memory (generator, export.js, or a
// freshly-read product from getProduct()).
export function itemGalleryPaths(item) {
  if (Array.isArray(item.images) && item.images.length) return item.images;
  return item.imageUrl ? [item.imageUrl] : [];
}
```

`getDb` must already be importable in `server/store.js` — `upsertProduct` already takes `db = getDb()` per the existing code, so the import is already present at the top of the file; do not add a duplicate.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="addItemImage|itemGalleryPaths|reorderItemImages"`
Expected: PASS (3 new tests)

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS, no regressions

- [ ] **Step 6: Commit**

```bash
git add server/store.js server/store.test.js
git commit -m "feat: category/car-parts item photo gallery data model + CRUD"
```

---

### Task 3: Filament colour image upload/delete/reorder routes + normalizeItem gallery field

**Files:**
- Modify: `server/index.js` (new routes; extend `./filaments.js`, `./store.js`, `./uploads.js` import blocks; extend `normalizeItem`)
- Test: `server/index.test.js` (new route-level tests)

**Interfaces:**
- Consumes: `addColourImage`, `removeColourImage`, `reorderColourImages` (Task 1); `addItemImage`, `removeItemImage`, `reorderItemImages` (Task 2); existing `uploadFilamentImage`, `uploadCategoryItemImage` multer instances (`server/uploads.js`, unchanged — both are already single-file, matching this task's one-photo-per-call design); existing `generateImageVariants` (`server/images.js`); existing `publishCatalog()`, `recordAuditEvent`, `AUDIT_EVENTS`, `requestMeta` (all already used by the neighboring routes in `server/index.js`).
- Produces: 6 new routes (3 per product type), documented below.

- [ ] **Step 1: Extend the import blocks**

In `server/index.js`, change the `./filaments.js` import block to:

```js
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
} from './filaments.js';
```

Change the `./store.js` import line to:

```js
import { saveCatalog, getProduct, upsertProduct, deleteProduct, addItemImage, removeItemImage, reorderItemImages } from './store.js';
```

Add `deleteImageFile` to the `./uploads.js` import block (currently imported by `filaments.js` internally but not by `index.js` — needed here for the cap-exceeded rollback in Step 2):

```js
import {
  uploadFilamentImage,
  uploadResourceImage,
  uploadResourceFile,
  deleteResourceFile,
  uploadDesignRequestAssets,
  deleteDesignRequestFile,
  uploadPrintJobImage,
  uploadPrintJobFile,
  uploadCategoryItemImage,
  deleteCategoryItemImage,
  uploadTestimonialImage,
  deleteTestimonialImage,
  deleteImageFile,
} from './uploads.js';
```

- [ ] **Step 2: Add the filament colour gallery routes**

In `server/index.js`, add immediately after the existing single-photo upload route (`app.post('/api/filaments/:filamentId/colours/:colourId/image', ...)`, which stays exactly as-is — it's the legacy single-photo path, untouched per this plan's Global Constraints):

```js
// #95: multi-photo gallery, up to 5, additive (each call appends one photo
// rather than replacing) -- distinct from the single-photo /image route
// above, which stays untouched for backward compatibility.
app.post(
  '/api/filaments/:filamentId/colours/:colourId/images',
  requireAuth,
  (req, res, next) => {
    const filament = getFilament(req.params.filamentId);
    const colour = filament?.colours.find((c) => c.id === req.params.colourId);
    if (!colour) return res.status(404).json({ error: 'Colour not found' });
    req.colourSku = colour.sku;
    next();
  },
  uploadFilamentImage.single('image'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const imagePath = `/uploads/filaments/${req.file.filename}`;
    try {
      const images = addColourImage(req.params.colourId, imagePath);
      await generateImageVariants(req.file.path).catch(() => {});
      const publishWarning = await publishCatalog();
      recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Added gallery photo to colour ${req.params.colourId}` });
      res.status(201).json({ images, ...(publishWarning ? { publishWarning } : {}) });
    } catch (err) {
      // Cap exceeded -- the file already landed on disk via multer before
      // this handler ran; remove it rather than leaving an orphan.
      deleteImageFile(imagePath);
      res.status(400).json({ error: err.message });
    }
  },
  (err, _req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Image must be under 5MB' });
    next(err);
  },
);

app.delete('/api/filaments/:filamentId/colours/:colourId/images/:imageId', requireAuth, async (req, res) => {
  const images = removeColourImage(req.params.colourId, req.params.imageId);
  if (images === null) return res.status(404).json({ error: 'Image not found' });
  const publishWarning = await publishCatalog();
  recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Removed gallery photo from colour ${req.params.colourId}` });
  res.json({ images, ...(publishWarning ? { publishWarning } : {}) });
});

app.put('/api/filaments/:filamentId/colours/:colourId/images/reorder', requireAuth, async (req, res) => {
  try {
    const images = reorderColourImages(req.params.colourId, (req.body || {}).order || []);
    const publishWarning = await publishCatalog();
    res.json({ images, ...(publishWarning ? { publishWarning } : {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Add the category item gallery routes**

Add immediately after the existing single-photo category item routes (`app.delete('/api/products/:productId/items/:itemId/image', ...)`):

```js
// #95: multi-photo gallery for category/car-parts items -- same additive
// shape as the filament colour routes above.
app.post(
  '/api/products/:productId/items/:itemId/images',
  requireAuth,
  uploadCategoryItemImage.single('image'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const imagePath = `/uploads/category-items/${req.file.filename}`;
    try {
      const images = addItemImage(req.params.productId, req.params.itemId, imagePath);
      if (images === null) {
        deleteCategoryItemImage(imagePath);
        return res.status(404).json({ error: 'Item not found' });
      }
      await generateImageVariants(req.file.path).catch(() => {});
      const publishWarning = await publishCatalog();
      recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Added gallery photo to item ${req.params.itemId}` });
      res.status(201).json({ images, ...(publishWarning ? { publishWarning } : {}) });
    } catch (err) {
      deleteCategoryItemImage(imagePath);
      res.status(400).json({ error: err.message });
    }
  },
  (err, _req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Image must be under 5MB' });
    next(err);
  },
);

app.delete('/api/products/:productId/items/:itemId/images', requireAuth, async (req, res) => {
  const imagePath = (req.body || {}).imagePath;
  if (!imagePath) return res.status(400).json({ error: 'imagePath is required' });
  const images = removeItemImage(req.params.productId, req.params.itemId, imagePath);
  if (images === null) return res.status(404).json({ error: 'Item not found' });
  if (imagePath.startsWith('/uploads/category-items/')) deleteCategoryItemImage(imagePath);
  const publishWarning = await publishCatalog();
  recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Removed gallery photo from item ${req.params.itemId}` });
  res.json({ images, ...(publishWarning ? { publishWarning } : {}) });
});

app.put('/api/products/:productId/items/:itemId/images/reorder', requireAuth, async (req, res) => {
  try {
    const images = reorderItemImages(req.params.productId, req.params.itemId, (req.body || {}).order || []);
    if (images === null) return res.status(404).json({ error: 'Item not found' });
    const publishWarning = await publishCatalog();
    res.json({ images, ...(publishWarning ? { publishWarning } : {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Extend `normalizeItem` to preserve (never accept-from-body) the gallery**

In `server/index.js`, find the `normalizeItem(item, i)` function and add one line to the returned object, right after `imageUrl: item.imageUrl || '',`:

```js
    imageUrl: item.imageUrl || '',
    images: Array.isArray(item.images) ? item.images.filter(Boolean).slice(0, 5) : [],
```

To make sure the whole-item PUT route never lets the request body silently overwrite the gallery (matching the existing rule for `imageUrl`), find this line in the `PUT /api/products/:productId/items/:itemId` handler:

```js
  const merged = normalizeItem({ ...existing, ...(req.body || {}), id: existing.id, imageUrl: existing.imageUrl }, idx);
```

and change it to:

```js
  const merged = normalizeItem({ ...existing, ...(req.body || {}), id: existing.id, imageUrl: existing.imageUrl, images: existing.images }, idx);
```

- [ ] **Step 5: Write the failing route-level tests**

Append to `server/index.test.js`:

```js
test('filament colour gallery: upload up to 5, reject the 6th, delete, reorder', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  const filament = await request(app).post('/api/filaments').set('Cookie', adminCookie).send({ name: 'PLA95', slug: 'pla95' });
  const colour = await request(app).post(`/api/filaments/${filament.body.filament.id}/colours`).set('Cookie', adminCookie).send({ name: 'Blue', sku: 'PLA95-BLUE' });
  const colourId = colour.body.filament.colours[0].id;

  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

  let last;
  for (let i = 0; i < 5; i++) {
    last = await request(app)
      .post(`/api/filaments/${filament.body.filament.id}/colours/${colourId}/images`)
      .set('Cookie', adminCookie)
      .attach('image', png1x1, `photo${i}.png`);
    assert.strictEqual(last.status, 201);
  }
  assert.strictEqual(last.body.images.length, 5);

  const sixth = await request(app)
    .post(`/api/filaments/${filament.body.filament.id}/colours/${colourId}/images`)
    .set('Cookie', adminCookie)
    .attach('image', png1x1, 'photo5.png');
  assert.strictEqual(sixth.status, 400);
  assert.match(sixth.body.error, /at most 5 photos/);

  const [first, second] = last.body.images;
  const reordered = await request(app)
    .put(`/api/filaments/${filament.body.filament.id}/colours/${colourId}/images/reorder`)
    .set('Cookie', adminCookie)
    .send({ order: [second.id, first.id, ...last.body.images.slice(2).map((i) => i.id)] });
  assert.strictEqual(reordered.status, 200);
  assert.strictEqual(reordered.body.images[0].id, second.id);

  const removed = await request(app)
    .delete(`/api/filaments/${filament.body.filament.id}/colours/${colourId}/images/${first.id}`)
    .set('Cookie', adminCookie);
  assert.strictEqual(removed.status, 200);
  assert.strictEqual(removed.body.images.length, 4);

  const missing = await request(app)
    .delete(`/api/filaments/${filament.body.filament.id}/colours/${colourId}/images/not-a-real-id`)
    .set('Cookie', adminCookie);
  assert.strictEqual(missing.status, 404);
});

test('category item gallery: upload, delete by path, reorder; whole-item PUT cannot overwrite it', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  const product = await request(app).post('/api/products').set('Cookie', adminCookie).send({ name: 'Toys', slug: 'toys95', items: [{ name: 'Dino' }] });
  const itemId = product.body.product.items[0].id;

  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

  const first = await request(app)
    .post(`/api/products/${product.body.product.id}/items/${itemId}/images`)
    .set('Cookie', adminCookie)
    .attach('image', png1x1, 'a.png');
  assert.strictEqual(first.status, 201);
  const second = await request(app)
    .post(`/api/products/${product.body.product.id}/items/${itemId}/images`)
    .set('Cookie', adminCookie)
    .attach('image', png1x1, 'b.png');
  assert.strictEqual(second.body.images.length, 2);

  const putRes = await request(app)
    .put(`/api/products/${product.body.product.id}/items/${itemId}`)
    .set('Cookie', adminCookie)
    .send({ name: 'Dino', images: ['/uploads/category-items/hacked.jpg'] });
  assert.strictEqual(putRes.status, 200);
  assert.deepStrictEqual(putRes.body.item.images, second.body.images);

  const reordered = await request(app)
    .put(`/api/products/${product.body.product.id}/items/${itemId}/images/reorder`)
    .set('Cookie', adminCookie)
    .send({ order: [second.body.images[1], second.body.images[0]] });
  assert.strictEqual(reordered.status, 200);
  assert.deepStrictEqual(reordered.body.images, [second.body.images[1], second.body.images[0]]);

  const removed = await request(app)
    .delete(`/api/products/${product.body.product.id}/items/${itemId}/images`)
    .set('Cookie', adminCookie)
    .send({ imagePath: second.body.images[1] });
  assert.strictEqual(removed.status, 200);
  assert.strictEqual(removed.body.images.length, 1);
});
```

- [ ] **Step 6: Run tests to verify they fail, then pass**

Run: `npm test -- --test-name-pattern="filament colour gallery|category item gallery"`
Expected: FAIL first (routes don't exist), then PASS after Steps 2-4

- [ ] **Step 7: Run the full unit suite**

Run: `npm test`
Expected: PASS, no regressions

- [ ] **Step 8: Commit**

```bash
git add server/index.js server/index.test.js
git commit -m "feat: gallery upload/delete/reorder routes for filament colours + category items"
```

---

### Task 4: Carry the gallery through `syncPublicJson` to public JSON

**Files:**
- Modify: `server/export.js`
- Modify: `server/export.test.js` (new tests)

**Interfaces:**
- Consumes: `colourGalleryPaths` (Task 1, from `./filaments.js`), `itemGalleryPaths` (Task 2, from `./store.js`)
- Produces: `filaments.json` colour objects gain `images: string[]`; `categories.json` item objects gain `images: string[]` — both consumed by `scripts/generate-pages.mjs` in Task 8/9.

- [ ] **Step 1: Write the failing test**

Append to `server/export.test.js`:

```js
test('syncPublicJson carries the photo gallery through for both colours and category items, falling back to the legacy single photo', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA', description: 'Standard PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-GAL', priceRand: 299, weightG: 1000, stockQty: 5 }, db);
  const colourId = withColour.colours[0].id;
  addColourImage(colourId, '/uploads/filaments/gallery-1.jpg', db);
  addColourImage(colourId, '/uploads/filaments/gallery-2.jpg', db);

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
          id: 'p1', kind: 'category', slug: 'toys', name: 'Toys',
          items: [{ id: 'i1', name: 'Dino', imageUrl: '/uploads/category-items/legacy.jpg', images: ['/uploads/category-items/new-1.jpg'] }],
        },
      ],
    }),
  );

  syncPublicJson(db, paths);

  const filaments = JSON.parse(fs.readFileSync(paths.filamentsSrc, 'utf8'));
  assert.deepStrictEqual(filaments[0].colours[0].images, ['/uploads/filaments/gallery-1.jpg', '/uploads/filaments/gallery-2.jpg']);

  const categories = JSON.parse(fs.readFileSync(paths.categoriesSrc, 'utf8'));
  assert.deepStrictEqual(categories.toys.items[0].images, ['/uploads/category-items/new-1.jpg']);

  Object.values(paths).forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
  db.close();
});
```

Add `addColourImage` to that test file's existing `import { createFilament, addColour } from './filaments.js';` line.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="syncPublicJson carries the photo gallery"`
Expected: FAIL — `filaments[0].colours[0].images` is `undefined`

- [ ] **Step 3: Wire the gallery into both mappings**

In `server/export.js`, add the two new fallback function imports (merge into whatever import line from `./filaments.js` already exists there — don't create a duplicate):

```js
import { listFilaments, colourGalleryPaths } from './filaments.js';
import { itemGalleryPaths } from './store.js';
```

In the `colours: f.colours.map((c) => ({ ... }))` block, add one field:

```js
    colours: f.colours.map((c) => ({
      name: c.name,
      sku: c.sku,
      price: formatRand(c.priceRand),
      weightG: c.weightG,
      shippingWeightG: c.shippingWeightG,
      rollLengthM: c.rollLengthM,
      stockQty: c.stockQty,
      imageUrl: c.imagePath || '',
      images: colourGalleryPaths(c, db),
      listed: c.listed !== false,
    })),
```

In the `items: (p.items || []).map((item) => ({ ... }))` block, add:

```js
        items: (p.items || []).map((item) => ({
          name: item.name,
          details: item.details,
          material: item.material,
          size: item.size,
          finish: item.finish,
          price: item.price,
          sku: item.sku,
          imageUrl: item.imageUrl,
          images: itemGalleryPaths(item),
          creator: item.creator || '',
          models: Array.isArray(item.models) ? item.models : [],
          weight: Number(item.weight) || 0,
          shippingWeight: item.shippingWeight != null && item.shippingWeight !== '' ? Number(item.shippingWeight) : Number(item.weight) || 0,
          stockQty: Number(item.stockQty) || 0,
          available: item.available !== false,
          listed: item.listed !== false,
        })),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern="syncPublicJson carries the photo gallery"`
Expected: PASS

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS, no regressions

- [ ] **Step 6: Commit**

```bash
git add server/export.js server/export.test.js
git commit -m "feat: carry photo galleries through to public filaments.json/categories.json"
```

---

### Task 5: Admin gallery panel — filament colours

**Files:**
- Modify: `server/index.js` (attach gallery images to filament GET/mutation responses)
- Modify: `admin/admin.js` (replace the single-file colour image control with a drag-reorder gallery panel; add shared `galleryPanelHtml`/`wireGalleryPanel`)
- Modify: `admin/admin.css` (thumbnail strip styling)

**Interfaces:**
- Consumes: `listColourImages` (Task 1); the three gallery routes from Task 3
- Produces: `galleryPanelHtml(kind, ownerId, images)`, `wireGalleryPanel(kind, ownerId, ownerContext, onUpdated)` — both defined in `admin/admin.js`, reused by Task 6 for category items.

- [ ] **Step 1: Attach gallery images to the filament GET/mutation responses**

`getFilament`/`listFilaments` don't currently attach `images` to a colour object (only `imagePath`). In `server/index.js`, add this helper right before the `app.get('/api/filaments', ...)` route:

```js
// #95: attaches each colour's gallery to the filament object the admin
// editor receives -- kept out of filaments.js itself so that module's core
// CRUD stays free of this cross-cutting concern (same reasoning #94's
// withQuoteStage() used for design requests).
function attachColourImages(filament) {
  return { ...filament, colours: filament.colours.map((c) => ({ ...c, images: listColourImages(c.id) })) };
}
```

Update the two filament GET routes:

```js
app.get('/api/filaments', requireAuth, (_req, res) => {
  res.json({ filaments: listFilaments().map(attachColourImages) });
});

app.get('/api/filaments/:id', requireAuth, (req, res) => {
  const filament = getFilament(req.params.id);
  if (!filament) return res.status(404).json({ error: 'Filament not found' });
  res.json({ filament: attachColourImages(filament) });
});
```

Also wrap the response in every route that returns a filament after a mutation — change `res.json({ filament, ...` to `res.json({ filament: attachColourImages(filament), ...` in each of: `POST /api/filaments`, `PUT /api/filaments/:id`, `POST /api/filaments/:id/colours`, `PUT /api/filaments/:filamentId/colours/:colourId`. (The three new Task 3 gallery routes already return `images` directly and don't need this.)

- [ ] **Step 2: Run existing tests to confirm nothing broke**

Run: `npm test`
Expected: PASS — `attachColourImages` only adds a field, so no existing assertion should break unless a test does an exact `assert.deepStrictEqual` on a full filament response shape, in which case extend its expected object with `images: []` per colour.

- [ ] **Step 3: Add the shared gallery panel HTML + wiring functions**

In `admin/admin.js`, add this right after `configurableListPanel`/`wireConfigurableListPanels`:

```js
// #95: shared drag-reorder gallery panel for both filament colours and
// category items -- `kind` is 'colour' or 'item', used to build distinct
// data-attributes so two panels on the same page never collide, and to
// pick the right upload/delete/reorder endpoint in wireGalleryPanel below.
function galleryPanelHtml(kind, ownerId, images) {
  const thumbs = images
    .map(
      (img, i) => `
        <div class="gallery-thumb" draggable="true" data-gallery-image-id="${escapeAttr(img.id || img)}" data-gallery-index="${i}">
          <img src="${escapeAttr(img.imagePath || img)}" alt="" />
          <button class="gallery-thumb-remove" data-gallery-remove="${escapeAttr(img.id || img)}" type="button" title="Remove">&times;</button>
        </div>`,
    )
    .join('');
  const canAddMore = images.length < 5;
  return `
    <div class="gallery-panel" data-gallery-kind="${kind}" data-gallery-owner="${escapeAttr(ownerId)}">
      <div class="gallery-thumbs">${thumbs}</div>
      ${canAddMore
        ? `<button class="btn small" data-action="trigger-gallery-add" data-gallery-owner="${escapeAttr(ownerId)}" type="button">+ Add photo (${images.length}/5)</button>
           <input type="file" class="hidden" accept="image/jpeg,image/png,image/webp" data-gallery-add="${escapeAttr(ownerId)}" />`
        : '<span class="muted" style="font-size:0.78rem">5/5 photos</span>'}
    </div>`;
}

// One call wires exactly ONE panel (identified by kind+ownerId), not every
// panel on the page -- callers loop over their own rows and call this once
// per already-persisted row (see Task 5 Step 4 / Task 6 Step 2).
function wireGalleryPanel(kind, ownerId, ownerContext, onUpdated) {
  const panel = document.querySelector(`.gallery-panel[data-gallery-kind="${kind}"][data-gallery-owner="${ownerId}"]`);
  if (!panel) return;
  const basePath = kind === 'colour'
    ? `/api/filaments/${ownerContext.filamentId}/colours/${ownerId}/images`
    : `/api/products/${ownerContext.productId}/items/${ownerId}/images`;

  panel.querySelector('[data-action="trigger-gallery-add"]')?.addEventListener('click', () => {
    $(`[data-gallery-add="${ownerId}"]`)?.click();
  });

  $(`[data-gallery-add="${ownerId}"]`)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await fetch(basePath, { method: 'POST', credentials: 'include', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      toast('Photo added');
      onUpdated(data.images);
    } catch (ex) {
      toast(ex.message);
    }
  });

  panel.querySelectorAll('[data-gallery-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const imageId = btn.dataset.galleryRemove;
      try {
        const res = kind === 'colour'
          ? await api(`${basePath}/${imageId}`, { method: 'DELETE' })
          : await api(basePath, { method: 'DELETE', body: JSON.stringify({ imagePath: imageId }) });
        toast('Photo removed');
        onUpdated(res.images);
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  // Native HTML5 drag-and-drop reorder -- no library. Dropping a thumb onto
  // another thumb's position swaps it there and immediately PUTs the new
  // order (matches this admin's existing "no separate Save step"
  // convention for other reorderable lists, e.g. the deposit-tier panel).
  let dragSourceIndex = null;
  panel.querySelectorAll('.gallery-thumb').forEach((thumb) => {
    thumb.addEventListener('dragstart', () => {
      dragSourceIndex = Number(thumb.dataset.galleryIndex);
    });
    thumb.addEventListener('dragover', (e) => e.preventDefault());
    thumb.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetIndex = Number(thumb.dataset.galleryIndex);
      if (dragSourceIndex === null || dragSourceIndex === targetIndex) return;
      const thumbs = [...panel.querySelectorAll('.gallery-thumb')];
      const ids = thumbs.map((t) => t.dataset.galleryImageId);
      const [moved] = ids.splice(dragSourceIndex, 1);
      ids.splice(targetIndex, 0, moved);
      try {
        const res = await api(`${basePath}/reorder`, { method: 'PUT', body: JSON.stringify({ order: ids }) });
        onUpdated(res.images);
      } catch (ex) {
        toast(ex.message);
      }
    });
  });
}
```

- [ ] **Step 4: Replace the admin colour image control and wire it**

Find the colour row template block containing `data-colour-image="${c.id}"` and replace this section:

```js
                ${c.imagePath
                  ? `<img src="${escapeAttr(c.imagePath)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid var(--line)" onerror="this.style.display='none'" />`
                  : `<div class="swatch-preview" style="background:${escapeAttr(c.hex || guessHex(c.name))}"></div>`}
                ${c._isNew
                  ? '<span class="muted" style="font-size:0.78rem">Save to Enable Photo Upload</span>'
                  : `<button class="btn small" data-action="trigger-colour-image" data-trigger-colour-image="${c.id}" type="button">Choose File</button>
                     <input type="file" class="hidden" accept="image/jpeg,image/png,image/webp" data-colour-image="${c.id}" />`}
```

with:

```js
                ${c._isNew
                  ? '<span class="muted" style="font-size:0.78rem">Save to Enable Photo Upload</span>'
                  : galleryPanelHtml('colour', c.id, c.images || [])}
```

Find and **delete entirely** the old `[data-trigger-colour-image]` click listener and `[data-colour-image]` change listener blocks (they have no matching elements left in the DOM after this template change — dead code).

Add, in the same render function (wherever colour rows are rendered, right after that markup is inserted into the DOM):

```js
  (p.colours || []).forEach((c) => {
    if (c._isNew) return;
    wireGalleryPanel('colour', c.id, { filamentId: p.id }, (images) => {
      state.draft.colours = state.draft.colours.map((row) => (row.id === c.id ? { ...row, images } : row));
      renderEditor();
    });
  });
```

- [ ] **Step 5: Add CSS for the thumbnail strip**

In `admin/admin.css`, add near the other `.config-list*` rules:

```css
.gallery-panel { display: flex; flex-direction: column; gap: 0.5rem; }
.gallery-thumbs { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.gallery-thumb { position: relative; width: 56px; height: 56px; border-radius: 4px; overflow: hidden; border: 1px solid var(--line); cursor: grab; }
.gallery-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.gallery-thumb-remove { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; line-height: 16px; border-radius: 50%; background: rgba(20,20,19,0.7); color: #fff; border: none; font-size: 0.8rem; cursor: pointer; padding: 0; }
```

- [ ] **Step 6: Syntax-check**

Run: `node --check admin/admin.js`
Expected: no syntax errors

- [ ] **Step 7: Commit**

```bash
git add server/index.js admin/admin.js admin/admin.css
git commit -m "feat: admin drag-reorder gallery panel for filament colours"
```

---

### Task 6: Admin gallery panel — category/car-parts items

**Files:**
- Modify: `admin/admin.js` (replace the single-file item image control with the same gallery panel from Task 5)

**Interfaces:**
- Consumes: `galleryPanelHtml`, `wireGalleryPanel` (Task 5, reused verbatim with `kind: 'item'`)
- Produces: working drag-reorder UI for category items, identical UX to Task 5.

- [ ] **Step 1: Replace the category item image control**

Find the item row template block containing `data-item-image="${item.id}"` and the adjacent `data-remove-item-image` button, and replace this section:

```js
              <div class="flex items-center gap-3">
                ${item.imageUrl
                  ? `<img src="${escapeAttr(item.imageUrl)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid var(--line)" onerror="this.style.display='none'" />`
                  : '<span class="muted" style="font-size:0.78rem">No Photo</span>'}
                ${item._isNew
                  ? '<span class="muted" style="font-size:0.78rem">Save to Enable Photo Upload</span>'
                  : `<button class="btn small" data-action="trigger-item-image" data-trigger-item-image="${item.id}" type="button">Choose File</button>
                     <input type="file" class="hidden" accept="image/jpeg,image/png,image/webp" data-item-image="${item.id}" />`}
              </div>
              ${item.imageUrl && !item._isNew ? `<button class="btn small btn-danger" data-remove-item-image="${item.id}" type="button">Remove photo</button>` : ''}
```

with:

```js
              ${item._isNew ? '<span class="muted" style="font-size:0.78rem">Save to Enable Photo Upload</span>' : galleryPanelHtml('item', item.id, item.images || [])}
```

- [ ] **Step 2: Remove old wiring, add new**

Delete the old `[data-item-image]` change listener, `[data-remove-item-image]` click listener, and `[data-trigger-item-image]` click listener blocks entirely — Step 1's template change leaves nothing for them to attach to.

Add, in the category product editor's render function (the sibling of Task 5 Step 4's colour wiring, but for items):

```js
  (p.items || []).forEach((item) => {
    if (item._isNew) return;
    wireGalleryPanel('item', item.id, { productId: p.id }, (images) => {
      state.draft.items = state.draft.items.map((row) => (row.id === item.id ? { ...row, images } : row));
      renderEditor();
    });
  });
```

- [ ] **Step 3: Syntax-check**

Run: `node --check admin/admin.js`
Expected: no syntax errors

- [ ] **Step 4: Commit**

```bash
git add admin/admin.js
git commit -m "feat: admin drag-reorder gallery panel for category/car-parts items"
```

---

### Task 7: Generator — shared gallery HTML partial + Product JSON-LD

**Files:**
- Modify: `scripts/generate-pages.mjs`
- Modify: `src/styles/main.css`

**Interfaces:**
- Produces: `productGalleryHtml({ images, alt, mode })` (mode: `'compact'` for cards, `'full'` for detail pages), `productDetailJsonLd({ name, images, sku, price, inStock, url })` — both used by Tasks 8-10.

- [ ] **Step 1: Add the gallery HTML partial**

In `scripts/generate-pages.mjs`, add near `responsiveImg()`:

```js
// #95: renders 1-5 photos as a scroll-snap strip with dot indicators.
// 'compact' (card carousel, no thumbnail strip) vs 'full' (detail-page
// hero, adds a clickable thumbnail strip below the dots). The actual
// swipe/drag behavior is pure CSS scroll-snap; src/js/product-gallery.js
// only keeps the dots in sync via IntersectionObserver and handles
// dot/thumbnail clicks -- see that file for the JS half.
function productGalleryHtml({ images, alt, mode = 'compact' }) {
  const list = (images && images.length ? images : []).slice(0, 5);
  if (!list.length) {
    return `<div class="w-full aspect-square rounded-sm bg-gradient-to-br from-linen to-cream flex items-center justify-center border border-charcoal/10"><span class="text-espresso/35 text-[0.65rem] uppercase tracking-[0.2em]">Photo coming soon</span></div>`;
  }
  const slides = list
    .map((url, i) => `<div class="gallery-slide" data-gallery-slide="${i}">${responsiveImg(url, alt, 'w-full aspect-square object-cover')}</div>`)
    .join('');
  const dots = list.length > 1
    ? `<div class="gallery-dots" role="tablist">${list.map((_, i) => `<button type="button" class="gallery-dot" data-gallery-dot="${i}" aria-label="Photo ${i + 1} of ${list.length}"></button>`).join('')}</div>`
    : '';
  const thumbs = mode === 'full' && list.length > 1
    ? `<div class="gallery-thumb-strip">${list.map((url, i) => `<button type="button" class="gallery-thumb-btn" data-gallery-thumb="${i}">${responsiveImg(url, alt, 'w-full h-full object-cover')}</button>`).join('')}</div>`
    : '';
  return `<div class="product-gallery" data-gallery data-gallery-mode="${mode}">
            <div class="gallery-track">${slides}</div>
            ${dots}
            ${thumbs}
          </div>`;
}
```

- [ ] **Step 2: Add the Product+Offer JSON-LD builder**

Add near `productListJsonLd`:

```js
// #95: single-product JSON-LD for a detail page, same field names/casing
// as the 'item' object inside productListJsonLd's ItemList above, just not
// wrapped in one.
function productDetailJsonLd({ name, images, sku, price, inStock, url }) {
  if (!name || !(price > 0)) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    ...(images && images.length ? { image: images.map((i) => `${SITE_ORIGIN}/${String(i).replace(/^\//, '')}`) } : {}),
    ...(sku ? { sku } : {}),
    offers: {
      '@type': 'Offer',
      price: String(Number(price)),
      priceCurrency: 'ZAR',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/MadeToOrder',
      url,
    },
  };
}
```

- [ ] **Step 3: Add gallery CSS**

In `src/styles/main.css`, add:

```css
.product-gallery { position: relative; }
.gallery-track { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; border-radius: 0.125rem; }
.gallery-track::-webkit-scrollbar { display: none; }
.gallery-slide { flex: 0 0 100%; scroll-snap-align: start; }
.gallery-dots { display: flex; justify-content: center; gap: 0.4rem; margin-top: 0.5rem; }
.gallery-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--line, #d8cfc0); border: none; padding: 0; cursor: pointer; }
.gallery-dot[aria-current="true"] { background: var(--terracotta, #c2542c); }
.gallery-thumb-strip { display: flex; gap: 0.4rem; margin-top: 0.6rem; }
.gallery-thumb-btn { width: 56px; height: 56px; border-radius: 0.25rem; overflow: hidden; border: 2px solid transparent; padding: 0; cursor: pointer; }
.gallery-thumb-btn[aria-current="true"] { border-color: var(--terracotta, #c2542c); }
```

- [ ] **Step 4: Syntax-check**

Run: `node --check scripts/generate-pages.mjs`
Expected: no syntax errors

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-pages.mjs src/styles/main.css
git commit -m "feat: shared gallery HTML partial + Product JSON-LD for the generator"
```

---

### Task 8: Generator — filament colour detail pages

**Files:**
- Modify: `scripts/generate-pages.mjs`

**Interfaces:**
- Consumes: `productGalleryHtml`, `productDetailJsonLd` (Task 7), `addToCartButton`, `head`, `shellStart`, `footer`, `backToHomeButton`, `write`, `breadcrumbJsonLd`, `parsePrice` (all pre-existing)
- Produces: one file per listed colour at `filament/<type-slug>-<colour-sku-lowercased>.html`; exports `colourDetailSlug` for reuse by Task 10.

- [ ] **Step 1: Add the detail-page generator function**

Add right after `generateFilamentPage`:

```js
// #95: one real static page per colour, flat inside filament/ (see this
// plan's Global Constraints for why -- vite's htmlEntries() already
// auto-discovers new files here with zero config changes, unlike a nested
// path would need).
function colourDetailSlug(filamentSlug, sku) {
  const skuSlug = String(sku || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${filamentSlug}-${skuSlug}`;
}

function generateColourDetailPage(f, c) {
  const file = `filament/${colourDetailSlug(f.slug, c.sku)}.html`;
  const pagePath = file;
  const images = c.images && c.images.length ? c.images : (c.imageUrl ? [c.imageUrl] : []);
  const priceNum = parsePrice(c.price) || 0;
  const inStock = Number(c.stockQty) > 0;
  const title = `${f.name} — ${c.name} — Lapanza 3D Creative Lab`;
  const description = `${f.name} filament in ${c.name}. ${c.price || ''} — ${inStock ? 'in stock' : 'made to order'}. ${f.description || ''}`.trim();

  const html = `${head({
    title,
    description,
    depth: 1,
    pagePath,
    jsonLd: [
      breadcrumbJsonLd(`Home / Filament / ${f.name} / ${c.name}`, pagePath),
      productDetailJsonLd({
        name: `${f.name} — ${c.name}`,
        images,
        sku: c.sku,
        price: priceNum,
        inStock,
        url: `${SITE_ORIGIN}/${pagePath}`,
      }),
    ].filter(Boolean),
  })}
${shellStart({ depth: 1 })}
    <main id="main" class="flex-1 min-w-0 px-6 sm:px-10 lg:px-16 xl:px-24 py-12 md:py-20">
      <div class="mx-auto w-full max-w-5xl">
      <nav class="text-[0.7rem] uppercase tracking-[0.14em] text-espresso/45 mb-6" aria-label="Breadcrumb">
        <a href="../index.html" class="hover:text-terracotta">Home</a> <span class="mx-1.5 opacity-40">/</span>
        <a href="../filament/${f.slug}.html" class="hover:text-terracotta">${f.name}</a> <span class="mx-1.5 opacity-40">/</span>
        <span class="text-espresso/70">${c.name}</span>
      </nav>
      <div class="mb-6">${backToHomeButton({ depth: 1 })}</div>
      <div class="grid md:grid-cols-2 gap-10">
        <div>${productGalleryHtml({ images, alt: `${f.name} — ${c.name}`, mode: 'full' })}</div>
        <div>
          <p class="eyebrow mb-2">Filament · ${f.name}</p>
          <h1 class="font-serif text-3xl md:text-4xl tracking-[-0.03em] mb-3">${c.name}</h1>
          <p class="text-2xl font-semibold text-terracotta mb-4">${c.price || ''}</p>
          <p class="text-espresso/70 leading-relaxed mb-6">${f.description || ''}</p>
          <p class="text-sm ${inStock ? 'text-espresso/60' : 'text-terracotta'} mb-6">${inStock ? 'In stock' : 'Made to order'}</p>
          ${inStock ? addToCartButton({
            productId: `filament:${f.slug}:${c.sku}`,
            name: `${f.name} — ${c.name}`,
            price: c.price,
            image: images[0] || '',
            weight: c.shippingWeightG ?? c.weightG,
          }) : `<button type="button" class="restock-notify text-sm font-semibold text-terracotta hover:underline" data-restock-product="filament:${f.slug}:${c.sku}">Email me when it's back</button>`}
        </div>
      </div>
      <div class="mt-14 pt-8 border-t border-charcoal/10">${backToHomeButton({ depth: 1 })}</div>
      </div>
    </main>
${footer({ depth: 1 })}`;
  write(file, html);
}
```

- [ ] **Step 2: Call it for every listed colour**

Find the line `filaments.forEach(generateFilamentPage);` and add immediately after it:

```js
filaments.forEach(generateFilamentPage);
filaments.forEach((f) => {
  (f.colours || []).filter((c) => c.listed !== false).forEach((c) => generateColourDetailPage(f, c));
});
```

- [ ] **Step 3: Run the generator and verify output**

Run: `npm run generate`
Expected: console shows the existing `wrote filament/<slug>.html` lines, PLUS new `wrote filament/<type-slug>-<sku>.html` lines, one per listed colour.

Run: `git status --short filament/` — confirm new files appear. Check whether `filament/*.html` files are already git-tracked today (`git ls-files filament/ | head`); if the existing listing pages are tracked, these new detail pages should be committed the same way in Step 5 below.

Run: `node --check scripts/generate-pages.mjs`
Expected: no syntax errors

- [ ] **Step 4: Full local build check**

Run: `npm run build`
Expected: PASS (the new flat files in `filament/` are picked up automatically by vite's existing non-recursive discovery loop — no `vite.config.js` change needed for this task)

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-pages.mjs
git add filament/*.html
git commit -m "feat: generate a real detail page per filament colour"
```

---

### Task 9: Generator — category + car-parts item detail pages

**Files:**
- Modify: `scripts/generate-pages.mjs`
- Modify: `vite.config.js`

**Interfaces:**
- Consumes: same as Task 8, plus the category-page generation loop's existing item data
- Produces: one file per listed item at `products/<category-slug>-<item-slug>-<sku-lowercased>.html`

- [ ] **Step 1: Register the new `products/` directory with vite**

In `vite.config.js`, find:

```js
  for (const dir of ['filament', 'car-parts']) {
```

and change it to:

```js
  for (const dir of ['filament', 'car-parts', 'products']) {
```

- [ ] **Step 2: Add the item detail-page generator**

In `scripts/generate-pages.mjs`, add right after `generateColourDetailPage` (Task 8):

```js
// #95: one real static page per category/car-parts item, all flattened
// into one new products/ directory (not nested under each category's own
// page) -- keeps vite's htmlEntries() registration to the single line
// added in Task 9 Step 1, regardless of how many categories exist.
function itemDetailSlug(categorySlug, item, index) {
  const namePart = String(item.name || `item-${index}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const skuPart = item.sku ? `-${String(item.sku).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : `-${index}`;
  return `${categorySlug}-${namePart}${skuPart}`;
}

function generateItemDetailPage(categorySlug, categoryName, item, index) {
  const file = `products/${itemDetailSlug(categorySlug, item, index)}.html`;
  const pagePath = file;
  const images = item.images && item.images.length ? item.images : (item.imageUrl ? [item.imageUrl] : []);
  const priceNum = parsePrice(item.price) || 0;
  const canAddToCart = item.price && item.available !== false && Number(item.stockQty) > 0;
  const meta = [item.material, item.size, item.finish].filter(Boolean).join(' · ');
  const fitment = [item.creator ? `Design: ${item.creator}` : '', item.models?.length ? `Fits: ${item.models.join(', ')}` : ''].filter(Boolean).join(' · ');
  const title = `${item.name} — ${categoryName} — Lapanza 3D Creative Lab`;
  const description = (item.details || `${item.name}, printed to order.`).slice(0, 300);

  const html = `${head({
    title,
    description,
    depth: 1,
    pagePath,
    jsonLd: [
      breadcrumbJsonLd(`Home / ${categoryName} / ${item.name}`, pagePath),
      productDetailJsonLd({
        name: item.name,
        images,
        sku: item.sku,
        price: priceNum,
        inStock: Number(item.stockQty) > 0,
        url: `${SITE_ORIGIN}/${pagePath}`,
      }),
    ].filter(Boolean),
  })}
${shellStart({ depth: 1 })}
    <main id="main" class="flex-1 min-w-0 px-6 sm:px-10 lg:px-16 xl:px-24 py-12 md:py-20">
      <div class="mx-auto w-full max-w-5xl">
      <nav class="text-[0.7rem] uppercase tracking-[0.14em] text-espresso/45 mb-6" aria-label="Breadcrumb">
        <a href="../index.html" class="hover:text-terracotta">Home</a> <span class="mx-1.5 opacity-40">/</span>
        <span class="text-espresso/70">${categoryName}</span> <span class="mx-1.5 opacity-40">/</span>
        <span class="text-espresso/70">${item.name}</span>
      </nav>
      <div class="mb-6">${backToHomeButton({ depth: 1 })}</div>
      <div class="grid md:grid-cols-2 gap-10">
        <div>${productGalleryHtml({ images, alt: item.name, mode: 'full' })}</div>
        <div>
          <p class="eyebrow mb-2">${categoryName}</p>
          <h1 class="font-serif text-3xl md:text-4xl tracking-[-0.03em] mb-3">${item.name}</h1>
          ${item.price ? `<p class="text-2xl font-semibold text-terracotta mb-4">${formatItemPrice(item.price)}</p>` : ''}
          <p class="text-espresso/70 leading-relaxed mb-4">${item.details || 'Custom printed to order.'}</p>
          ${meta ? `<p class="text-espresso/50 text-sm mb-2">${meta}</p>` : ''}
          ${fitment ? `<p class="text-espresso/50 text-sm mb-6">${fitment}</p>` : ''}
          ${fulfilmentLabel(item)}
          <a href="${SITE.whatsapp}" class="block text-sm font-semibold text-terracotta hover:underline mb-4" target="_blank" rel="noopener noreferrer">Enquire</a>
          ${canAddToCart ? addToCartButton({
            productId: `category:${categorySlug}:${item.sku || index}`,
            name: item.name,
            price: item.price,
            image: images[0] || '',
            weight: item.shippingWeight ?? item.weight,
          }) : ''}
        </div>
      </div>
      <div class="mt-14 pt-8 border-t border-charcoal/10">${backToHomeButton({ depth: 1 })}</div>
      </div>
    </main>
${footer({ depth: 1 })}`;
  write(file, html);
}
```

- [ ] **Step 3: Call it from the existing category-page loop**

Read `scripts/generate-pages.mjs`'s category-page generation loop (the one that calls `generateCategoryPage`, around the area confirmed by research to iterate `categoryPages` merged with `categories[page.slug]`) directly, before writing this step — the exact local variable names for the current category's slug/name/items must match what that loop actually uses, not be guessed. Add one line inside that loop, after its existing `generateCategoryPage({...})` call, using those real variable names:

```js
  (items || []).filter((item) => item.listed !== false).forEach((item, i) => generateItemDetailPage(slug, name, item, i));
```

(Replace `items`/`slug`/`name` with the loop's actual variable names once you've read the real code — this is a placeholder for the exact identifiers only, the call shape itself — `categorySlug, categoryName, item, index` positionally into `generateItemDetailPage` — is final.)

- [ ] **Step 4: Run the generator and verify output**

Run: `npm run generate`
Expected: new `wrote products/<category-slug>-<item-slug>-<sku>.html` lines, one per listed category/car-parts item

Run: `npm run build`
Expected: build succeeds, no missing-entry errors (this is the exact check that would have caught the historical vite htmlEntries incident — if it fails here, re-check Step 1's `vite.config.js` edit)

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-pages.mjs vite.config.js
git add products/*.html
git commit -m "feat: generate a real detail page per category/car-parts item"
```

---

### Task 10: Storefront cards — carousel + link to detail page

**Files:**
- Modify: `scripts/generate-pages.mjs` (`colourCards()`, `catalogueItems()`)

**Interfaces:**
- Consumes: `productGalleryHtml` (Task 7), `colourDetailSlug` (Task 8), `itemDetailSlug` (Task 9)
- Produces: cards on `filament/<slug>.html` and category pages now show up to 5 photos with dots, and clicking the photo (not the dots) navigates to the new detail page.

- [ ] **Step 1: Update `colourCards()` to use the gallery + link to the detail page**

In `colourCards()`, replace this block:

```js
                  ${
                    imageFileExists(c.imageUrl)
                      ? responsiveImg(c.imageUrl, c.name, 'w-full aspect-square object-cover rounded-sm mb-3')
                      : `<div class="w-full aspect-square rounded-sm mb-3 bg-gradient-to-br from-linen to-cream flex items-center justify-center border border-charcoal/10"><span class="text-espresso/35 text-[0.65rem] uppercase tracking-[0.2em]">Photo coming soon</span></div>`
                  }
```

with:

```js
                  <a href="${colourDetailSlug(filament.slug, c.sku)}.html" class="block mb-3" aria-label="View ${c.name} details">
                    ${productGalleryHtml({ images: c.images && c.images.length ? c.images : (c.imageUrl ? [c.imageUrl] : []), alt: c.name, mode: 'compact' })}
                  </a>
```

(This is a same-directory relative link — `colourCards()` renders inside `filament/<slug>.html`, and Task 8's detail page is a flat sibling file in the same `filament/` directory.)

- [ ] **Step 2: Update `catalogueItems()` to use the gallery + link to the detail page**

Change the function signature from `catalogueItems(label, items, categorySlug)` to `catalogueItems(label, items, categorySlug, depth = 0)`. Update every call site of `catalogueItems(...)` to pass its real page depth (root category pages like `toys.html` and car-parts brand pages like `car-parts/<brand>.html` are both depth-0 flat files — read each call site to confirm before assuming 0 everywhere).

Replace:

```js
      const img = imageFileExists(item.imageUrl)
        ? responsiveImg(item.imageUrl, item.name, 'w-full h-full object-cover')
        : `<span class="text-espresso/35 text-xs uppercase tracking-[0.2em]">Photo coming soon</span>`;
```

with:

```js
      const galleryImages = item.images && item.images.length ? item.images : (item.imageUrl ? [item.imageUrl] : []);
      const img = productGalleryHtml({ images: galleryImages, alt: item.name, mode: 'compact' });
```

Find where `${img}` is rendered inside the card markup:

```js
              <div class="aspect-square bg-gradient-to-br from-linen to-cream flex items-center justify-center border-b border-charcoal/10 overflow-hidden">
                ${img}
              </div>
```

and replace with a link to the detail page:

```js
              <a href="${'../'.repeat(depth)}products/${itemDetailSlug(categorySlug, item, i)}.html" class="block aspect-square bg-gradient-to-br from-linen to-cream flex items-center justify-center border-b border-charcoal/10 overflow-hidden" aria-label="View ${item.name} details">
                ${img}
              </a>
```

- [ ] **Step 3: Regenerate and spot-check**

Run: `npm run generate`
Expected: no errors; open one generated `filament/*.html` and one category page (e.g. `toys.html`) and confirm the new `<a href="...">` wraps each card's gallery, pointing at the matching detail-page filename.

Run: `npm run build`
Expected: PASS

Run: `node --check scripts/generate-pages.mjs`
Expected: no syntax errors

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-pages.mjs
git add filament/*.html toys.html homeware.html phones.html car-parts/*.html
git commit -m "feat: storefront cards get the photo carousel and link to the new detail pages"
```

---

### Task 11: `src/js/product-gallery.js` — dot sync + click handling

**Files:**
- Create: `src/js/product-gallery.js`
- Modify: `src/js/site.js` (import it)

**Interfaces:**
- Consumes: DOM markup from `productGalleryHtml()` (Task 7) — `.product-gallery[data-gallery]`, `.gallery-track`, `.gallery-slide[data-gallery-slide]`, `.gallery-dot[data-gallery-dot]`, `.gallery-thumb-btn[data-gallery-thumb]`
- Produces: self-initializing on `DOMContentLoaded` — no other module needs to call anything.

- [ ] **Step 1: Write the gallery module**

Create `src/js/product-gallery.js`:

```js
// #95: dot/thumbnail sync for the CSS-scroll-snap photo carousel emitted by
// generate-pages.mjs's productGalleryHtml(). The swipe/drag itself is pure
// CSS (scroll-snap-type on .gallery-track) -- this only keeps the dots in
// sync via IntersectionObserver (no manual touch/pointer tracking) and
// handles dot/thumbnail clicks. Self-initializing: scans the whole document
// on load, so it works on every generated page (card carousels AND detail
// pages) with zero per-page wiring, same convention as cart-ui.js's
// delegated add-to-cart listener.
function initGallery(root) {
  const track = root.querySelector('.gallery-track');
  const slides = [...root.querySelectorAll('.gallery-slide')];
  const dots = [...root.querySelectorAll('.gallery-dot')];
  const thumbs = [...root.querySelectorAll('.gallery-thumb-btn')];
  if (!track || slides.length < 2) return; // single-photo gallery has no dots/thumbs to sync

  const setActive = (index) => {
    dots.forEach((d, i) => d.setAttribute('aria-current', String(i === index)));
    thumbs.forEach((t, i) => t.setAttribute('aria-current', String(i === index)));
  };
  setActive(0);

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.find((e) => e.isIntersecting);
      if (!visible) return;
      const index = Number(visible.target.dataset.gallerySlide);
      setActive(index);
    },
    { root: track, threshold: 0.6 },
  );
  slides.forEach((s) => observer.observe(s));

  dots.forEach((dot) => {
    dot.addEventListener('click', (e) => {
      e.preventDefault();
      const index = Number(dot.dataset.galleryDot);
      slides[index]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    });
  });
  thumbs.forEach((thumb) => {
    thumb.addEventListener('click', (e) => {
      e.preventDefault();
      const index = Number(thumb.dataset.galleryThumb);
      slides[index]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    });
  });
}

function initAllGalleries() {
  document.querySelectorAll('[data-gallery]').forEach(initGallery);
}

document.addEventListener('DOMContentLoaded', initAllGalleries);
```

- [ ] **Step 2: Import it from the shared bundle**

In `src/js/site.js`, add near the top with the other imports:

```js
import './product-gallery.js';
```

(A side-effect-only import — `product-gallery.js` self-initializes via its own `DOMContentLoaded` listener and exports nothing.)

- [ ] **Step 3: Syntax-check and build**

Run: `node --check src/js/product-gallery.js`
Expected: no syntax errors

Run: `npm run build`
Expected: PASS; a slightly larger `site-*.js` chunk is expected (zero new dependencies added)

- [ ] **Step 4: Commit**

```bash
git add src/js/product-gallery.js src/js/site.js
git commit -m "feat: gallery dot-sync + click-to-navigate JS, self-wired via site.js"
```

---

### Task 12: Real browser verification (throwaway Playwright script)

**Files:**
- Create (temporary, not committed): `tests/e2e/tmp-verify-95.spec.js`

**Interfaces:**
- Consumes: the full stack from Tasks 1-11, driven exactly like the prior feature's verification script (same scratch-DB `playwright.config.js` webServer setup, same admin credentials `e2e-admin`/`correcthorsebattery`).
- Produces: nothing shipped — pass/fail confidence only, deleted after the run.

- [ ] **Step 1: Write the verification script**

Create `tests/e2e/tmp-verify-95.spec.js`:

```js
// THROWAWAY verification script for #95 -- not part of the committed smoke
// pack, deleted after use. Real browser click-through of: admin gallery
// upload + drag-reorder, storefront card carousel dot sync, click-photo
// navigation to a detail page, Add to Cart from the detail page.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'child_process';

const API = 'http://localhost:8787';
const ADMIN = { username: 'e2e-admin', password: 'correcthorsebattery' };
let adminCookie = '';

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

test.beforeAll(async () => {
  await api('/api/setup', { method: 'POST', body: ADMIN });
  const login = await api('/api/auth/login', { method: 'POST', body: ADMIN });
  adminCookie = (login.headers.get('set-cookie') || '').split(';')[0];
});

test('admin: gallery upload + drag-reorder; storefront: carousel + navigate to detail page', async ({ page }) => {
  await page.goto(`${API}/admin/`);
  await page.fill('#login-form input[name="username"]', ADMIN.username);
  await page.fill('#login-form input[name="password"]', ADMIN.password);
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator('.sidebar-nav')).toBeVisible({ timeout: 10000 });

  const filamentRes = await api('/api/filaments', { method: 'POST', cookie: adminCookie, body: { name: 'Verify95', slug: 'verify95' } });
  const filamentId = (await filamentRes.json()).filament.id;
  const colourRes = await api(`/api/filaments/${filamentId}/colours`, { method: 'POST', cookie: adminCookie, body: { name: 'Test Blue', sku: 'V95-BLUE', priceRand: 250, weightG: 1000, stockQty: 10 } });
  const colourId = (await colourRes.json()).filament.colours[0].id;

  await page.click('[data-route="catalog"]');
  await page.click(`tr[data-id="${filamentId}"]`);
  const galleryPanel = page.locator(`.gallery-panel[data-gallery-owner="${colourId}"]`);
  await expect(galleryPanel).toBeVisible({ timeout: 10000 });

  const fileInput = page.locator(`[data-gallery-add="${colourId}"]`);
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await fileInput.setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(galleryPanel.locator('.gallery-thumb')).toHaveCount(1, { timeout: 10000 });
  await fileInput.setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(galleryPanel.locator('.gallery-thumb')).toHaveCount(2, { timeout: 10000 });

  const gen = spawnSync(process.execPath, ['scripts/generate-pages.mjs'], { env: { ...process.env, DATA_DIR: process.env.E2E_DATA_DIR } });
  expect(gen.status).toBe(0);
  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { env: process.env });
  expect(build.status).toBe(0);

  await page.goto('http://localhost:4173/filament/verify95.html');
  const card = page.locator('.swatch-card', { hasText: 'Test Blue' });
  await expect(card).toBeVisible();
  await expect(card.locator('.gallery-dot')).toHaveCount(2);

  await card.locator('a').first().click();
  await expect(page).toHaveURL(/filament\/verify95-v95-blue\.html/);
  await expect(page.locator('h1')).toContainText('Test Blue');
  await expect(page.locator('.gallery-thumb-btn')).toHaveCount(2);

  await page.click('[data-add-to-cart]');
  await expect(page.locator('#cart-badge, .cart-badge')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'tmp-95-detail-page.png' });
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test tests/e2e/tmp-verify-95.spec.js`
Expected: PASS. If it fails, read the failure carefully — this is the same class of check that caught two real bugs in the prior feature (a settings allow-list gap and a CSS-class wiring collision); don't dismiss a failure as "probably just the test."

- [ ] **Step 3: Look at the screenshot**

Read `tmp-95-detail-page.png` to visually confirm the detail page layout (side-by-side gallery + buy panel, thumbnail strip, dots).

- [ ] **Step 4: Clean up**

```bash
rm tests/e2e/tmp-verify-95.spec.js tmp-95-detail-page.png
git status --short
```

Expected: verify no generated-file drift leaked into tracked source files from the regenerate/build calls the script ran (same class of drift this project has hit repeatedly — check for unexpected `src/data/*.json`/`public/*.json` changes and `git checkout --` them if they're just local-scratch-DB noise).

- [ ] **Step 5: No commit for this task** — the script is deleted, not shipped.

---

### Task 13: Full regression, docs, deploy

**Files:**
- Modify: `docs/SYSTEM_DOCUMENTATION.md`
- Modify: `docs/AI_HANDOFF.md`

- [ ] **Step 1: Full local regression**

Run: `npm test`
Expected: PASS, full count (existing 388 + all new unit/route tests from Tasks 1-4)

Run: `npm run build`
Expected: PASS

Run: `npm run test:e2e`
Expected: PASS, 4/4 (the existing committed smoke pack — confirm this feature didn't break any of those journeys)

- [ ] **Step 2: Discard any generated-file drift**

Run: `git status --short`
Expected: only the files this plan's tasks intentionally modified/created are staged/modified — no stray `src/data/*.json`, `public/*.json`, or root-level `.html` changes from local test/build runs against a non-production DB. `git checkout --` anything that's clearly local-scratch noise.

- [ ] **Step 3: Update SYSTEM_DOCUMENTATION.md**

Add one new row to the running features table (same style/tone as every other entry — see the most recent entries for the exact format), summarizing: the two data-model shapes, the 5-photo cap, the legacy fallback, the flat-file URL scheme decision (and why, referencing the vite htmlEntries incident), the admin drag-reorder panel, and the real test/verification counts from Step 1.

- [ ] **Step 4: Update AI_HANDOFF.md**

Add a matching, shorter entry to that file's running table, same style as the most recent entries there.

- [ ] **Step 5: Commit docs**

```bash
git add docs/SYSTEM_DOCUMENTATION.md docs/AI_HANDOFF.md
git commit -m "docs: record the product photo gallery + detail page feature"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

- [ ] **Step 7: Deploy**

```bash
ssh -i ~/.ssh/lapanza_vps_deploy deploy@41.222.36.147 "cd /opt/lapanza/app && bash deploy/deploy-app.sh"
```

Expected: the deploy script's own build step regenerates every page from PRODUCTION's real catalog (194 Landrover parts, every real filament colour, etc.) — this is the first real test of Tasks 8-9's page-generation loops at production scale and volume. Watch the deploy output for errors, not just a clean exit code.

- [ ] **Step 8: Live verification**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://lapanza3d.co.za/filament/pla.html
```

Pick one real filament colour from that page's HTML and confirm its new detail-page URL 200s:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://lapanza3d.co.za/filament/<real-detail-page-url-from-the-listing-page>
```

Do the same for one real category item detail page under `/products/`.

---

## Self-Review Notes

**Spec coverage**: Data model (Tasks 1-2) covered. Admin upload UI (Tasks 5-6) covered. Generator + detail pages (Tasks 7-10) covered. Gallery mechanics (Task 11) covered. Order flow reuse (Tasks 8-9's `addToCartButton()` calls emit the same attributes every existing card already does) covered. Testing (Tasks 1-4's unit/route tests, Task 12's browser verification) covered.

**Deviation from the spec, documented**: the URL nesting scheme changed from the spec's `filament/<type>/<colour>.html` to a flat `filament/<type>-<colour>.html` (and category items get one new flat `products/` directory instead of nesting under each category) — see Global Constraints for the exact reasoning (vite's non-recursive entry-discovery loop, and this project's documented history of exactly this class of 404 incident). The spec's intent (a real static URL per product) is fully preserved; only the path shape changed.

**Known follow-up not silently dropped**: Task 9 Step 3 explicitly requires reading the category-page loop's real variable names from the live file at implementation time rather than assuming them — the research pass confirmed the loop's location and shape but did not quote its literal local variable names verbatim.

**Type/interface consistency check**: `colourGalleryPaths(colour, db)` (Task 1) and `itemGalleryPaths(item)` (Task 2) are deliberately asymmetric (one takes `db`, one doesn't) — this matches their underlying data sources exactly (SQLite needs a db handle, an in-memory JS array does not), not an inconsistency. `galleryPanelHtml`/`wireGalleryPanel` (Task 5) are used identically by both `kind: 'colour'` (Task 5) and `kind: 'item'` (Task 6) call sites — verified the parameter shapes match at both call sites above.
