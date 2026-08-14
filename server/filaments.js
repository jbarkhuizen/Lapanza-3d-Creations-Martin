import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { deleteImageFile } from './uploads.js';

function rowToColour(row) {
  return {
    id: row.id,
    name: row.name,
    hex: row.hex,
    sku: row.sku,
    weightG: row.weight_g,
    rollLengthM: row.roll_length_m,
    priceRand: row.price_rand,
    stockQty: row.stock_qty,
    imagePath: row.image_path,
    notes: row.notes,
    sortOrder: row.sort_order,
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
    status: data.status === 'draft' ? 'draft' : 'published',
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
  db.prepare(
    `INSERT INTO filament_colours
      (id, filament_type_id, name, hex, sku, weight_g, roll_length_m, price_rand, stock_qty, image_path, notes, sort_order, created_at, updated_at)
     VALUES
      (@id, @filament_type_id, @name, @hex, @sku, @weight_g, @roll_length_m, @price_rand, @stock_qty, @image_path, @notes, @sort_order, @created_at, @updated_at)`,
  ).run({
    id,
    filament_type_id: filamentTypeId,
    name: data.name || '',
    hex: data.hex || '',
    sku: data.sku || id.slice(0, 8),
    weight_g: Number(data.weightG) || 0,
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
      name = @name, hex = @hex, sku = @sku, weight_g = @weight_g, roll_length_m = @roll_length_m,
      price_rand = @price_rand, stock_qty = @stock_qty, notes = @notes, updated_at = @updated_at
     WHERE id = @id`,
  ).run({
    id: colourId,
    name: data.name ?? existing.name,
    hex: data.hex ?? existing.hex,
    sku: data.sku ?? existing.sku,
    weight_g: data.weightG != null ? toNumberOr(data.weightG, existing.weight_g) : existing.weight_g,
    roll_length_m: data.rollLengthM != null && data.rollLengthM !== '' ? toNumberOr(data.rollLengthM, existing.roll_length_m) : existing.roll_length_m,
    price_rand: data.priceRand != null ? toNumberOr(data.priceRand, existing.price_rand) : existing.price_rand,
    stock_qty: data.stockQty != null ? toNumberOr(data.stockQty, existing.stock_qty) : existing.stock_qty,
    notes: data.notes ?? existing.notes,
    updated_at: new Date().toISOString(),
  });
  return getFilament(filamentTypeId, db);
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
