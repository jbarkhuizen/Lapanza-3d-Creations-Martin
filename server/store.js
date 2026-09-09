import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { syncPublicJson } from './export.js';
import { sanitizeRichText } from './rich-text.js';

// cwd-based (not __dirname) so tests can isolate via process.chdir() --
// computed fresh on every call (not cached at module scope) because a
// module is only evaluated once per process: index.test.js imports this
// module indirectly, through several cache-busted index.js instances that
// each process.chdir() to their own temp dir, so a module-level `root`
// would freeze on whichever test's cwd happened to trigger the first
// import and silently point every later test at that stale, since-deleted
// directory (the same class of bug already fixed in db.js and export.js).
function paths() {
  const root = process.cwd();
  const dataDir = path.join(root, 'data');
  return { root, dataDir, catalogPath: path.join(dataDir, 'catalog.json') };
}

function ensureDir({ root, dataDir } = paths()) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(path.join(root, 'public'))) fs.mkdirSync(path.join(root, 'public'), { recursive: true });
}

function now() {
  return new Date().toISOString();
}

export function loadCatalog() {
  const p = paths();
  ensureDir(p);
  if (!fs.existsSync(p.catalogPath)) {
    const seeded = { version: 1, updatedAt: now(), products: [] };
    fs.writeFileSync(p.catalogPath, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  const catalog = JSON.parse(fs.readFileSync(p.catalogPath, 'utf8'));
  // Review #8 (todo #147): categories saved before the status field existed
  // (or before the 92bc4af create-path fix) have NO status on disk. Nothing
  // public gates on category status, so a missing value has always behaved
  // as published -- but the admin LIST showed `p.status || 'draft'` while
  // the EDITOR's select visually fell back to its first option (Published),
  // and the two disagreed. Normalize on read to what the value truly means;
  // the next save persists it.
  for (const product of catalog.products || []) {
    if (!product.status) product.status = 'published';
  }
  return catalog;
}

export function saveCatalog(catalog, db = getDb()) {
  const p = paths();
  ensureDir(p);
  catalog.updatedAt = now();
  // Write-temp-then-rename so a crash mid-write can never truncate the
  // only copy of the category catalog -- catalog.json is real business
  // data (prices, SKUs, stock) that exists nowhere else, and a bare
  // writeFileSync interrupted halfway leaves an unparseable file behind.
  const tmpPath = `${p.catalogPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(catalog, null, 2));
  fs.renameSync(tmpPath, p.catalogPath);
  syncPublicJson(db);
  return catalog;
}

export function getProduct(id) {
  return loadCatalog().products.find((p) => p.id === id) || null;
}

export function upsertProduct(product, db = getDb()) {
  const catalog = loadCatalog();
  const idx = catalog.products.findIndex((p) => p.id === product.id);
  const ts = now();
  const record = { ...product, kind: 'category' };
  if (idx === -1) {
    record.createdAt = record.createdAt || ts;
    record.updatedAt = ts;
    if (!record.id) record.id = randomUUID();
    catalog.products.push(record);
  } else {
    record.createdAt = catalog.products[idx].createdAt || ts;
    record.updatedAt = ts;
    catalog.products[idx] = record;
  }
  saveCatalog(catalog, db);
  return record;
}

export function deleteProduct(id, db = getDb()) {
  const catalog = loadCatalog();
  const before = catalog.products.length;
  catalog.products = catalog.products.filter((p) => p.id !== id);
  if (catalog.products.length === before) return false;
  saveCatalog(catalog, db);
  return true;
}

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
  const valid = Array.isArray(orderedPaths) && orderedPaths.length === existing.length && new Set(orderedPaths).size === existing.length && orderedPaths.every((p) => existing.includes(p));
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

// Single-item shape, shared by index.js's bulk normalizeItems() below, its
// per-item POST/PUT routes (so "Save item" on one GWM/Landrover/Toys/etc
// row produces byte-identical output to what the old full-array "Save
// product" always did), and esquire.js's dropship import/resync -- moved
// here (out of index.js) specifically so esquire.js can normalize an item
// without importing index.js itself, which would create a circular import
// (index.js already imports esquire.js for its routes; every other
// cross-module wiring in this app avoids importing back into index.js the
// same way, see jobs.js's `publish` parameter).
export function normalizeItem(item, i) {
  return {
    id: item.id || randomUUID(),
    name: item.name || `Item ${i + 1}`,
    details: sanitizeRichText(item.details || ''),
    material: item.material || '',
    size: item.size || '',
    finish: item.finish || '',
    price: item.price || '',
    // Owner request (2026-09-07): cost price for the Stock Value sheet.
    // Admin-only -- export.js's public field lists deliberately omit it.
    buyingPrice: Math.max(0, Math.round((Number(item.buyingPrice) || 0) * 100) / 100),
    // Owner request (2026-09-08): printed items are costed by manufacturing
    // cost (from the costing sheet), not a buying price -- kept distinct
    // since some items (bought hardware/inserts) genuinely use buyingPrice
    // instead. madeToOrder defaults true (item.madeToOrder !== false) since
    // most category items today are printed on demand, not real stock on
    // hand -- Stock Value excludes made-to-order rows from its totals so the
    // "value of stock on hand" figure stops overstating printed-on-demand
    // items. Also admin-only -- omitted from export.js's public field lists.
    manufacturingCost: Math.max(0, Math.round((Number(item.manufacturingCost) || 0) * 100) / 100),
    madeToOrder: item.madeToOrder !== false,
    sku: item.sku || '',
    imageUrl: item.imageUrl || '',
    videoUrl: item.videoUrl || '', // review #25 (todo #164)
    images: Array.isArray(item.images) ? item.images.filter(Boolean).slice(0, 5) : [],
    // Car-parts only (GWM/Landrover) -- who designed the printable part, and
    // which vehicle model(s) it fits. Stored as plain name strings (not ids
    // into settings.carPartModelsLandrover/carPartModelsGwm), same
    // convention as in_house_filament.brand/todo_items.category: renaming a
    // list entry later must not retroactively change what's already saved
    // on an item.
    creator: item.creator || '',
    models: Array.isArray(item.models) ? item.models.filter(Boolean) : [],
    // Admin-only reference back to the original design's source page --
    // never sent to the public categories.json export (see export.js).
    sourceUrl: item.sourceUrl || '',
    // Grams -- matches filament_colours.weight_g and every other weight
    // field end to end (order_items.weight, cart.js, data-weight attrs).
    weight: Number(item.weight) || 0,
    // Separate from weight -- what actually drives shipping-bracket
    // matching, so packaging etc can differ from the item's own weight.
    shippingWeight: item.shippingWeight != null && item.shippingWeight !== '' ? Number(item.shippingWeight) : undefined,
    // Unified with filament_colours.stock_qty for the Stock Management grid
    // and inventory decrement -- category items had no numeric stock count
    // before, only the `available` boolean.
    stockQty: Math.max(0, Number(item.stockQty) || 0),
    available: item.available !== false,
    // Whether this item shows on its category page at all -- separate from
    // `available` (which only controls whether the Add to Cart button shows;
    // an unavailable-but-listed item still displays with an Enquire link).
    // scripts/generate-pages.mjs and export.js's syncPublicJson() already
    // filter/pass this through; it was just never settable from the admin UI.
    listed: item.listed !== false,
    sortOrder: item.sortOrder ?? i,
    // Dropship (Esquire) module (owner request 2026-09-09). dropship marks
    // an item as supplier-fulfilled rather than printed/stocked in-house;
    // esquireProductCode/marginPercent are admin-only (never in export.js's
    // public field lists, same as buyingPrice/manufacturingCost) so a
    // customer or competitor can never see which items are dropshipped, the
    // supplier's product code, or the margin applied over its cost.
    dropship: item.dropship === true,
    esquireProductCode: item.esquireProductCode || '',
    marginPercent: Number(item.marginPercent) || 0,
  };
}

export function normalizeItems(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item, i) => normalizeItem(item, i));
}

export { now, randomUUID };
