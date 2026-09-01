import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { deleteImageFile } from './uploads.js';

function rowToColour(row) {
  // Phase 3 spool tracking: stock_qty is "spools owned" (unchanged meaning,
  // same as the existing low-stock alert). Total stock in metres/grams is
  // spools owned x the nominal per-spool spec; remaining/% left are always
  // computed here from used_m/used_g, never stored, so there's one source
  // of truth (see db.js's ensureManagementColumns comment).
  const totalM = (row.stock_qty || 0) * (row.roll_length_m || 0);
  const totalG = (row.stock_qty || 0) * (row.weight_g || 0);
  const remainingM = Math.max(0, totalM - (row.used_m || 0));
  const remainingG = Math.max(0, totalG - (row.used_g || 0));
  return {
    id: row.id,
    name: row.name,
    hex: row.hex,
    sku: row.sku,
    weightG: row.weight_g,
    // Shipping weight is what drives shipping-bracket matching, separate
    // from weightG (the item's own "Filament Weight"). Falls back to
    // weightG when null so a colour created before this column existed
    // (or one where the admin hasn't set it) still ships correctly.
    shippingWeightG: row.shipping_weight_g ?? row.weight_g,
    rollLengthM: row.roll_length_m,
    priceRand: row.price_rand,
    stockQty: row.stock_qty,
    usedM: row.used_m || 0,
    usedG: row.used_g || 0,
    remainingM,
    remainingG,
    percentLeft: totalG > 0 ? Math.max(0, Math.min(1, remainingG / totalG)) : null,
    imagePath: row.image_path,
    notes: row.notes,
    sortOrder: row.sort_order,
    // Stock Management "Listed on site" radio -- excludes just this colour
    // from the filament's public colour grid (see export.js/generate-pages.mjs).
    listed: row.listed !== 0,
  };
}

function rowToType(row, colourRows) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    colourNote: row.colour_note,
    specs: JSON.parse(row.specs_json || '[]'),
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    internalNotes: row.internal_notes,
    status: row.status,
    featured: Boolean(row.featured),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    colours: colourRows.map(rowToColour),
  };
}

function slugify(value) {
  return (
    String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'filament'
  );
}

const colourStmtFor = (db) => db.prepare('SELECT * FROM filament_colours WHERE filament_type_id = ? ORDER BY sort_order ASC');

function toNumberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function listFilaments(db = getDb()) {
  const types = db.prepare('SELECT * FROM filament_types ORDER BY sort_order ASC, name ASC').all();
  const colourStmt = colourStmtFor(db);
  return types.map((t) => rowToType(t, colourStmt.all(t.id)));
}

export function getFilament(id, db = getDb()) {
  const t = db.prepare('SELECT * FROM filament_types WHERE id = ?').get(id);
  if (!t) return null;
  return rowToType(t, colourStmtFor(db).all(id));
}

export function createFilament(data, db = getDb()) {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO filament_types
      (id, slug, name, description, colour_note, specs_json, seo_title, seo_description, internal_notes, status, featured, sort_order, created_at, updated_at)
     VALUES
      (@id, @slug, @name, @description, @colour_note, @specs_json, @seo_title, @seo_description, @internal_notes, @status, @featured, @sort_order, @created_at, @updated_at)`,
  ).run({
    id,
    slug: slugify(data.slug || data.name),
    name: data.name || 'Untitled filament',
    description: data.description || '',
    colour_note: data.colourNote || '',
    specs_json: JSON.stringify(data.specs || []),
    seo_title: data.seoTitle || '',
    seo_description: data.seoDescription || '',
    internal_notes: data.internalNotes || '',
    status: data.status === 'draft' ? 'draft' : 'published',
    featured: data.featured ? 1 : 0,
    sort_order: Number(data.sortOrder) || 0,
    created_at: now,
    updated_at: now,
  });
  return getFilament(id, db);
}

export function updateFilament(id, data, db = getDb()) {
  const existing = getFilament(id, db);
  if (!existing) return null;
  db.prepare(
    `UPDATE filament_types SET
      slug = @slug, name = @name, description = @description, colour_note = @colour_note,
      specs_json = @specs_json, seo_title = @seo_title, seo_description = @seo_description,
      internal_notes = @internal_notes, status = @status, featured = @featured,
      sort_order = @sort_order, updated_at = @updated_at
     WHERE id = @id`,
  ).run({
    id,
    slug: slugify(data.slug ?? existing.slug),
    name: data.name ?? existing.name,
    description: data.description ?? existing.description,
    colour_note: data.colourNote ?? existing.colourNote,
    specs_json: JSON.stringify(data.specs ?? existing.specs),
    seo_title: data.seoTitle ?? existing.seoTitle,
    seo_description: data.seoDescription ?? existing.seoDescription,
    internal_notes: data.internalNotes ?? existing.internalNotes,
    // Unlike every other field here, status previously forced 'published'
    // whenever the patch didn't explicitly say 'draft' -- so a partial
    // update that only touched e.g. description would silently flip a
    // draft filament to published. Preserve the existing status when the
    // patch omits the field entirely, matching the ?? pattern used above.
    status: data.status !== undefined ? (data.status === 'draft' ? 'draft' : 'published') : existing.status,
    featured: data.featured !== undefined ? (data.featured ? 1 : 0) : (existing.featured ? 1 : 0),
    sort_order: data.sortOrder ?? existing.sortOrder,
    updated_at: new Date().toISOString(),
  });
  return getFilament(id, db);
}

export function deleteFilament(id, db = getDb()) {
  const existing = getFilament(id, db);
  if (!existing) return false;
  existing.colours.forEach((c) => deleteImageFile(c.imagePath));
  db.prepare('DELETE FROM filament_types WHERE id = ?').run(id);
  return true;
}

export function addColour(filamentTypeId, data, db = getDb()) {
  const parent = getFilament(filamentTypeId, db);
  if (!parent) return null;
  const now = new Date().toISOString();
  const id = randomUUID();
  const maxSort = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM filament_colours WHERE filament_type_id = ?')
    .get(filamentTypeId).m;
  const weightG = Number(data.weightG) || 0;
  db.prepare(
    `INSERT INTO filament_colours
      (id, filament_type_id, name, hex, sku, weight_g, shipping_weight_g, roll_length_m, price_rand, stock_qty, image_path, notes, sort_order, created_at, updated_at)
     VALUES
      (@id, @filament_type_id, @name, @hex, @sku, @weight_g, @shipping_weight_g, @roll_length_m, @price_rand, @stock_qty, @image_path, @notes, @sort_order, @created_at, @updated_at)`,
  ).run({
    id,
    filament_type_id: filamentTypeId,
    name: data.name || '',
    hex: data.hex || '',
    sku: data.sku || id.slice(0, 8),
    weight_g: weightG,
    // Defaults to weightG when the admin hasn't set a distinct shipping
    // weight yet, same fallback rowToColour applies on read.
    shipping_weight_g: data.shippingWeightG != null && data.shippingWeightG !== '' ? Number(data.shippingWeightG) : weightG,
    roll_length_m: data.rollLengthM != null && data.rollLengthM !== '' ? Number(data.rollLengthM) : null,
    price_rand: Number(data.priceRand) || 0,
    stock_qty: Number(data.stockQty) || 0,
    image_path: null,
    notes: data.notes || '',
    sort_order: maxSort + 1,
    created_at: now,
    updated_at: now,
  });
  return getFilament(filamentTypeId, db);
}

export function updateColour(filamentTypeId, colourId, data, db = getDb()) {
  const existing = db.prepare('SELECT * FROM filament_colours WHERE id = ? AND filament_type_id = ?').get(colourId, filamentTypeId);
  if (!existing) return null;
  db.prepare(
    `UPDATE filament_colours SET
      name = @name, hex = @hex, sku = @sku, weight_g = @weight_g, shipping_weight_g = @shipping_weight_g, roll_length_m = @roll_length_m,
      price_rand = @price_rand, stock_qty = @stock_qty, notes = @notes, listed = @listed, updated_at = @updated_at
     WHERE id = @id`,
  ).run({
    id: colourId,
    name: data.name ?? existing.name,
    hex: data.hex ?? existing.hex,
    // sku is UNIQUE NOT NULL -- a blank/cleared SKU field must never be
    // persisted as '' (data.sku ?? existing.sku alone would do exactly
    // that, since '' isn't nullish), or the second colour saved with a
    // blank SKU hits a UNIQUE constraint violation that surfaces to the
    // admin as a confusing "duplicate SKU" error for two rolls that were
    // never meant to collide. Same colourId-derived fallback addColour
    // already uses for a blank SKU on create.
    sku: data.sku !== undefined ? (data.sku || colourId.slice(0, 8)) : existing.sku,
    weight_g: data.weightG != null ? toNumberOr(data.weightG, existing.weight_g) : existing.weight_g,
    shipping_weight_g: data.shippingWeightG != null
      ? toNumberOr(data.shippingWeightG, existing.shipping_weight_g)
      : existing.shipping_weight_g,
    // Distinguishes "rollLengthM omitted from the patch" (preserve existing)
    // from "rollLengthM present but null/empty" (explicitly clear it) --
    // admin.js sends null for a blank input specifically to clear a
    // previously-set roll length, which the old `!= null` check could never
    // satisfy since both branches fell through to "keep existing".
    roll_length_m: !('rollLengthM' in data)
      ? existing.roll_length_m
      : (data.rollLengthM == null || data.rollLengthM === '')
        ? null
        : toNumberOr(data.rollLengthM, existing.roll_length_m),
    price_rand: data.priceRand != null ? toNumberOr(data.priceRand, existing.price_rand) : existing.price_rand,
    stock_qty: data.stockQty != null ? toNumberOr(data.stockQty, existing.stock_qty) : existing.stock_qty,
    notes: data.notes ?? existing.notes,
    listed: data.listed !== undefined ? (data.listed ? 1 : 0) : existing.listed,
    updated_at: new Date().toISOString(),
  });
  return getFilament(filamentTypeId, db);
}

// Phase 3: called by print-jobs.js when a job logged against this colour is
// saved -- the only writer of used_m/used_g (see rowToColour's comment).
// Looked up by colour id directly (not scoped to a filamentTypeId) since
// the Print Jobs form picks a colour, not a type.
export function incrementFilamentUsage(colourId, { usedM = 0, usedG = 0 }, db = getDb()) {
  const result = db
    .prepare('UPDATE filament_colours SET used_m = used_m + ?, used_g = used_g + ?, updated_at = ? WHERE id = ?')
    .run(Number(usedM) || 0, Number(usedG) || 0, new Date().toISOString(), colourId);
  return result.changes > 0;
}

export function deleteColour(filamentTypeId, colourId, db = getDb()) {
  const existing = db.prepare('SELECT * FROM filament_colours WHERE id = ? AND filament_type_id = ?').get(colourId, filamentTypeId);
  if (!existing) return false;
  deleteImageFile(existing.image_path);
  db.prepare('DELETE FROM filament_colours WHERE id = ?').run(colourId);
  return true;
}

export function setColourImage(filamentTypeId, colourId, imagePath, db = getDb()) {
  const existing = db.prepare('SELECT * FROM filament_colours WHERE id = ? AND filament_type_id = ?').get(colourId, filamentTypeId);
  if (!existing) return null;
  if (existing.image_path) deleteImageFile(existing.image_path);
  db.prepare('UPDATE filament_colours SET image_path = ?, updated_at = ? WHERE id = ?').run(
    imagePath,
    new Date().toISOString(),
    colourId,
  );
  return getFilament(filamentTypeId, db);
}

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
  const valid = Array.isArray(orderedIds) && orderedIds.length === existing.length && new Set(orderedIds).size === existing.length && orderedIds.every((id) => existingIds.has(id));
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
