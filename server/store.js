import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { syncPublicJson } from './export.js';

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
  return JSON.parse(fs.readFileSync(p.catalogPath, 'utf8'));
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

export { now, randomUUID };
