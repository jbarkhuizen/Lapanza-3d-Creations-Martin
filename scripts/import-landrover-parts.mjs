#!/usr/bin/env node
// One-time import of the Land Rover 3D-printable-parts catalog into the
// "landrover" category's items[]. Source data was scraped from each part's
// page on lr3dparts.com (JSON-LD Product block) rather than the original
// spreadsheet directly, because the spreadsheet's "Fits (Vehicles)" and
// "Category" columns were truncated/corrupted for a meaningful fraction of
// rows -- see scripts/scrape input format below. Run once:
//   node scripts/import-landrover-parts.mjs <path-to-scraped.json>
// REPLACES the landrover product's entire items[] array (including the 3
// placeholder items) -- not idempotent, don't run twice.
//
// Expected input: a JSON array of objects shaped like:
//   { partNo, creator, link, scrapedName, scrapedDesc, scrapedMaterials,
//     scrapedModels: string[], localImagePath, sheetName, sheetDesc,
//     sheetMaterials }
// Falls back to the sheet* fields when a scrape* field is missing (a
// handful of pages had no meta description, etc).
//
// Price/weight/shippingWeight are flat defaults across all 194 items, per
// explicit instruction (2026-08-27) -- not scraped, the source site lists
// parts as free STL downloads, not priced physical products.

import fs from 'fs';
import { randomUUID } from 'crypto';
import { loadCatalog, saveCatalog } from '../server/store.js';
import { getDb } from '../server/db.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/import-landrover-parts.mjs <path-to-scraped.json>');
  process.exit(1);
}

const FLAT_PRICE = '150';
const FLAT_WEIGHT = 300;
const FLAT_SHIPPING_WEIGHT = 500;

const rows = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const items = rows.map((row, i) => ({
  id: randomUUID(),
  name: row.scrapedName || row.sheetName || `Landrover part ${i + 1}`,
  details: row.scrapedDesc || row.sheetDesc || '',
  material: row.scrapedMaterials || row.sheetMaterials || '',
  size: '',
  finish: '',
  price: FLAT_PRICE,
  sku: row.partNo || '',
  imageUrl: row.localImagePath || '',
  weight: FLAT_WEIGHT,
  shippingWeight: FLAT_SHIPPING_WEIGHT,
  stockQty: 0,
  available: true,
  listed: true,
  creator: row.creator || '',
  models: Array.isArray(row.scrapedModels) ? row.scrapedModels : [],
  sourceUrl: row.link || '',
  sortOrder: i,
}));

const catalog = loadCatalog();
const product = catalog.products.find((p) => p.kind === 'category' && p.slug === 'landrover');
if (!product) {
  console.error('No category product with slug "landrover" found in catalog.json');
  process.exit(1);
}

const before = product.items?.length || 0;
product.items = items;
saveCatalog(catalog, getDb());

console.log(`Imported ${items.length} Landrover items (replaced ${before} existing item(s)).`);
