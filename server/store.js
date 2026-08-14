import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { DEFAULT_SETTINGS, publicSettings } from './settings-defaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const DATA_DIR = path.join(root, 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');
const FILAMENTS_SRC = path.join(root, 'src', 'data', 'filaments.json');
const CATEGORIES_SRC = path.join(root, 'src', 'data', 'categories.json');
const SETTINGS_SRC = path.join(root, 'src', 'data', 'settings.json');
const SETTINGS_PUBLIC = path.join(root, 'public', 'site-settings.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(path.join(root, 'public'))) fs.mkdirSync(path.join(root, 'public'), { recursive: true });
}

function now() {
  return new Date().toISOString();
}

function seedFromSite() {
  const filaments = JSON.parse(fs.readFileSync(FILAMENTS_SRC, 'utf8'));
  const categories = JSON.parse(fs.readFileSync(CATEGORIES_SRC, 'utf8'));
  const ts = now();

  const products = filaments.map((f, index) => ({
    id: randomUUID(),
    kind: 'filament',
    status: 'published',
    featured: index < 3,
    sortOrder: index,
    slug: f.slug,
    name: f.name,
    description: f.description || '',
    colourNote: f.colourNote || '',
    seoTitle: `${f.name} — Lapanza 3D Creative Lab`,
    seoDescription: (f.description || '').slice(0, 155),
    internalNotes: '',
    specs: (f.specs || []).map((s) => ({
      id: randomUUID(),
      label: s.label,
      value: s.value,
    })),
    colours: (f.colours || []).map((c) => ({
      id: randomUUID(),
      name: c.name,
      sku: c.sku,
      price: c.price,
      hex: '',
      inStock: true,
      notes: '',
    })),
    createdAt: ts,
    updatedAt: ts,
  }));

  const categoryProducts = Object.values(categories).map((c, index) => ({
    id: randomUUID(),
    kind: 'category',
    status: 'published',
    featured: false,
    sortOrder: index,
    slug: c.slug,
    name: c.name,
    description: c.description || '',
    crumbs: c.crumbs || '',
    parent: c.parent || null,
    seoTitle: `${c.name} — Lapanza 3D Creative Lab`,
    seoDescription: (c.description || '').slice(0, 155),
    internalNotes: '',
    items: Array.from({ length: 3 }).map((_, i) => ({
      id: randomUUID(),
      name: `${c.name} piece ${i + 1}`,
      details: 'Custom printed to order — material, size and finish on request.',
      material: '',
      size: '',
      finish: '',
      price: '',
      sku: '',
      imageUrl: '',
      available: true,
      sortOrder: i,
    })),
    createdAt: ts,
    updatedAt: ts,
  }));

  return {
    version: 1,
    updatedAt: ts,
    settings: { ...DEFAULT_SETTINGS },
    products: [...products, ...categoryProducts],
  };
}

export function loadCatalog() {
  ensureDir();
  if (!fs.existsSync(CATALOG_PATH)) {
    const seeded = seedFromSite();
    seeded.settings.adminPasswordHash = bcrypt.hashSync('lapanza-admin', 10);
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(seeded, null, 2));
    syncToSiteData(seeded);
    return seeded;
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  catalog.settings = { ...DEFAULT_SETTINGS, ...(catalog.settings || {}) };
  // Migrate legacy plaintext adminPassword (pre-hashing) to a bcrypt hash.
  if (catalog.settings.adminPassword) {
    catalog.settings.adminPasswordHash = bcrypt.hashSync(catalog.settings.adminPassword, 10);
    delete catalog.settings.adminPassword;
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  } else if (!catalog.settings.adminPasswordHash) {
    catalog.settings.adminPasswordHash = bcrypt.hashSync('lapanza-admin', 10);
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  }
  return catalog;
}

export function saveCatalog(catalog) {
  ensureDir();
  catalog.updatedAt = now();
  catalog.settings = { ...DEFAULT_SETTINGS, ...(catalog.settings || {}) };
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  syncToSiteData(catalog);
  return catalog;
}

/** Keep the public site JSON files in sync so generate/pages stay current */
export function syncToSiteData(catalog) {
  const filaments = catalog.products
    .filter((p) => p.kind === 'filament')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      description: p.description,
      specs: (p.specs || []).map((s) => ({ label: s.label, value: s.value })),
      colours: (p.colours || []).map((c) => ({
        name: c.name,
        sku: c.sku,
        price: c.price,
      })),
      colourNote: p.colourNote || '',
    }));

  const categories = {};
  catalog.products
    .filter((p) => p.kind === 'category')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .forEach((p) => {
      categories[p.slug] = {
        slug: p.slug,
        name: p.name,
        description: p.description,
        crumbs: p.crumbs || `Home / ${p.name}`,
        ...(p.parent ? { parent: p.parent } : {}),
        items: (p.items || []).map((item) => ({
          name: item.name,
          details: item.details,
          material: item.material,
          size: item.size,
          finish: item.finish,
          price: item.price,
          sku: item.sku,
          imageUrl: item.imageUrl,
          available: item.available !== false,
        })),
      };
    });

  const settings = publicSettings(catalog.settings);
  fs.writeFileSync(FILAMENTS_SRC, JSON.stringify(filaments, null, 2));
  fs.writeFileSync(CATEGORIES_SRC, JSON.stringify(categories, null, 2));
  fs.writeFileSync(SETTINGS_SRC, JSON.stringify(settings, null, 2));
  fs.writeFileSync(SETTINGS_PUBLIC, JSON.stringify(settings, null, 2));
}

export function getProduct(id) {
  return loadCatalog().products.find((p) => p.id === id) || null;
}

export function upsertProduct(product) {
  const catalog = loadCatalog();
  const idx = catalog.products.findIndex((p) => p.id === product.id);
  const ts = now();
  if (idx === -1) {
    product.createdAt = product.createdAt || ts;
    product.updatedAt = ts;
    if (!product.id) product.id = randomUUID();
    catalog.products.push(product);
  } else {
    product.createdAt = catalog.products[idx].createdAt || ts;
    product.updatedAt = ts;
    catalog.products[idx] = product;
  }
  saveCatalog(catalog);
  return product;
}

export function deleteProduct(id) {
  const catalog = loadCatalog();
  const before = catalog.products.length;
  catalog.products = catalog.products.filter((p) => p.id !== id);
  if (catalog.products.length === before) return false;
  saveCatalog(catalog);
  return true;
}

export function updateSettings(partial) {
  const catalog = loadCatalog();
  catalog.settings = { ...DEFAULT_SETTINGS, ...catalog.settings, ...partial };
  saveCatalog(catalog);
  return catalog.settings;
}

export { now, randomUUID, CATALOG_PATH, DEFAULT_SETTINGS, publicSettings };
