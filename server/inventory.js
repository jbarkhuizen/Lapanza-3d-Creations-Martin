import { getDb } from './db.js';
import { listFilaments, updateColour } from './filaments.js';
import { getProduct, upsertProduct } from './store.js';
import { readCategoryProducts } from './export.js';

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
        sku: colour.sku,
        name: `${filament.name} — ${colour.name}`,
        category: 'Filament',
        stockQty: colour.stockQty,
        price: colour.priceRand,
      });
    }
  }

  for (const product of readCategoryProducts()) {
    for (const item of product.items || []) {
      rows.push({
        kind: 'category',
        id: item.id,
        parentId: product.id,
        sku: item.sku || '',
        name: item.name,
        category: product.name,
        stockQty: Number(item.stockQty) || 0,
        price: parseRand(item.price),
      });
    }
  }

  return rows;
}

function updateCategoryItemStock(productId, itemId, { stockQty, price }) {
  const product = getProduct(productId);
  if (!product) throw new Error('Product not found');
  const item = (product.items || []).find((i) => i.id === itemId);
  if (!item) throw new Error('Item not found');
  if (stockQty !== undefined) item.stockQty = Math.max(0, Number(stockQty) || 0);
  if (price !== undefined) item.price = `R${Math.max(0, Number(price) || 0)}`;
  upsertProduct(product);
}

// F.2: single "Save Changes" action applies every edited row. Each row is
// applied independently (one bad row doesn't block the rest) but the
// caller gets a per-row result list so the UI can show exactly what failed.
export function bulkUpdateInventory(updates, db = getDb()) {
  const results = [];
  for (const update of updates) {
    const { kind, id, parentId, stockQty, price } = update;
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
        updateColour(parentId, id, { stockQty, priceRand: price }, db);
      } else if (kind === 'category') {
        updateCategoryItemStock(parentId, id, { stockQty, price });
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
