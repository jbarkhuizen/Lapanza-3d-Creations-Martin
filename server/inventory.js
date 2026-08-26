import { getDb } from './db.js';
import { listFilaments, updateColour } from './filaments.js';
import { getProduct, upsertProduct } from './store.js';
import { readCategoryProducts } from './export.js';
import { formatRand } from './money.js';

function parseRand(value) {
  const n = parseFloat(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// Unifies the two separate product storage systems (filament_colours in
// SQLite, category items in catalog.json) into one flat list for the Stock
// Management grid -- each row carries enough to route a save back to the
// right system (kind + parentId identifies which).
export function listInventory(db = getDb()) {
  const rows = [];

  for (const filament of listFilaments(db)) {
    for (const colour of filament.colours) {
      rows.push({
        kind: 'filament',
        id: colour.id,
        parentId: filament.id,
        // Matches resolveProductSnapshot's filament: scheme exactly (orders.js)
        // -- lets the New Order line-item picker select a real catalog
        // product without duplicating that id-building logic here.
        productId: `filament:${filament.slug}:${colour.sku}`,
        sku: colour.sku,
        name: `${filament.name} — ${colour.name}`,
        category: 'Filament',
        stockQty: colour.stockQty,
        price: colour.priceRand,
        weight: colour.shippingWeightG ?? colour.weightG,
        // Phase 3 spool tracking -- read-only here, written only by logging
        // a print job (see print-jobs.js / filaments.js's incrementFilamentUsage).
        usedM: colour.usedM,
        usedG: colour.usedG,
        remainingM: colour.remainingM,
        remainingG: colour.remainingG,
        percentLeft: colour.percentLeft,
        listed: colour.listed,
      });
    }
  }

  for (const product of readCategoryProducts()) {
    const items = product.items || [];
    items.forEach((item, idx) => {
      // Matches resolveProductSnapshot's category: scheme exactly (orders.js):
      // sku when the item has one, otherwise its index within this product.
      const skuOrIndex = item.sku || String(idx);
      rows.push({
        kind: 'category',
        id: item.id,
        parentId: product.id,
        productId: `category:${product.slug}:${skuOrIndex}`,
        sku: item.sku || '',
        name: item.name,
        category: product.name,
        stockQty: Number(item.stockQty) || 0,
        price: parseRand(item.price),
        weight: Number(item.shippingWeight ?? item.weight) || 0,
        listed: item.listed !== false,
      });
    });
  }

  return rows;
}

function updateCategoryItemStock(productId, itemId, { stockQty, price, listed }) {
  const product = getProduct(productId);
  if (!product) throw new Error('Product not found');
  const item = (product.items || []).find((i) => i.id === itemId);
  if (!item) throw new Error('Item not found');
  if (stockQty !== undefined) item.stockQty = Math.max(0, Number(stockQty) || 0);
  if (price !== undefined) item.price = formatRand(Math.max(0, Number(price) || 0));
  if (listed !== undefined) item.listed = Boolean(listed);
  upsertProduct(product);
}

// F.2: single "Save Changes" action applies every edited row. Each row is
// applied independently (one bad row doesn't block the rest) but the
// caller gets a per-row result list so the UI can show exactly what failed.
export function bulkUpdateInventory(updates, db = getDb()) {
  const results = [];
  for (const update of updates) {
    const { kind, id, parentId, stockQty, price, listed } = update;
    if (stockQty !== undefined && Number(stockQty) < 0) {
      results.push({ id, ok: false, error: 'Stock cannot be negative' });
      continue;
    }
    if (price !== undefined && Number(price) < 0) {
      results.push({ id, ok: false, error: 'Price cannot be negative' });
      continue;
    }
    try {
      if (kind === 'filament') {
        updateColour(parentId, id, { stockQty, priceRand: price, listed }, db);
      } else if (kind === 'category') {
        updateCategoryItemStock(parentId, id, { stockQty, price, listed });
      } else {
        throw new Error('Unknown inventory kind');
      }
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err.message });
    }
  }
  return results;
}
