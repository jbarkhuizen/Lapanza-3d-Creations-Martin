import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { syncPublicJson } from './export.js';

const root = process.cwd(); // cwd-based (not __dirname) so tests can isolate via process.chdir()
const DATA_DIR = path.join(root, 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(path.join(root, 'public'))) fs.mkdirSync(path.join(root, 'public'), { recursive: true });
}

function now() {
  return new Date().toISOString();
}

export function loadCatalog() {
  ensureDir();
  if (!fs.existsSync(CATALOG_PATH)) {
    const seeded = { version: 1, updatedAt: now(), products: [] };
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

export function saveCatalog(catalog, db = getDb()) {
  ensureDir();
  catalog.updatedAt = now();
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
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

export { now, randomUUID };
