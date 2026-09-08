import { getDb } from './db.js';
import { getSettings } from './settings.js';
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
        buyingPrice: colour.buyingPriceRand || 0,
        // Manufacturing cost / made-to-order only apply to printed category
        // items -- filament rolls are always genuinely bought stock on hand.
        // null (not 0) marks the column as not applicable for this row, same
        // convention as remainingG/percentLeft below for non-filament rows.
        manufacturingCost: null,
        madeToOrder: false,
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
        buyingPrice: Number(item.buyingPrice) || 0,
        // Owner request (2026-09-08): printed items are costed by
        // manufacturing cost, not a buying price -- kept as a distinct field
        // since some category items (bought hardware/inserts) genuinely do
        // use buyingPrice instead. madeToOrder defaults true (undefined ->
        // true) because today almost everything in the catalog is printed on
        // demand, not real stock on hand -- the owner flips a specific item
        // to false once they actually keep that one stocked. This default is
        // what makes Stock Value's totals honest out of the box instead of
        // requiring every existing item to be flagged by hand first.
        manufacturingCost: Number(item.manufacturingCost) || 0,
        madeToOrder: item.madeToOrder !== false,
        weight: Number(item.shippingWeight ?? item.weight) || 0,
        listed: item.listed !== false,
      });
    });
  }

  return rows;
}

function updateCategoryItemStock(productId, itemId, { stockQty, price, buyingPrice, manufacturingCost, madeToOrder, listed }) {
  const product = getProduct(productId);
  if (!product) throw new Error('Product not found');
  const item = (product.items || []).find((i) => i.id === itemId);
  if (!item) throw new Error('Item not found');
  if (stockQty !== undefined) item.stockQty = Math.max(0, Number(stockQty) || 0);
  if (price !== undefined) item.price = formatRand(Math.max(0, Number(price) || 0));
  if (buyingPrice !== undefined) item.buyingPrice = Math.max(0, Math.round((Number(buyingPrice) || 0) * 100) / 100);
  if (manufacturingCost !== undefined) item.manufacturingCost = Math.max(0, Math.round((Number(manufacturingCost) || 0) * 100) / 100);
  if (madeToOrder !== undefined) item.madeToOrder = Boolean(madeToOrder);
  if (listed !== undefined) item.listed = Boolean(listed);
  upsertProduct(product);
}

// F.2: single "Save Changes" action applies every edited row. Each row is
// applied independently (one bad row doesn't block the rest) but the
// caller gets a per-row result list so the UI can show exactly what failed.
export function bulkUpdateInventory(updates, db = getDb()) {
  const results = [];
  // Optimistic concurrency for stock edits: the grid posts absolute
  // quantities captured when the page rendered, so a save from a panel left
  // open all day silently reverted every order placed in between (the one
  // place the careful transactional stock model was bypassed). The client
  // sends expectedStockQty (the value it displayed); a row whose live stock
  // no longer matches is rejected with the current number instead of
  // clobbered. Older clients that don't send it keep the old last-write-wins.
  const liveStock = new Map(listInventory(db).map((row) => [row.id, row.stockQty]));
  for (const update of updates) {
    const { kind, id, parentId, stockQty, price, buyingPrice, manufacturingCost, madeToOrder, listed, expectedStockQty } = update;
    if (stockQty !== undefined && Number(stockQty) < 0) {
      results.push({ id, ok: false, error: 'Stock cannot be negative' });
      continue;
    }
    if (stockQty !== undefined && expectedStockQty !== undefined) {
      const current = liveStock.get(id);
      if (current !== undefined && current !== Number(expectedStockQty)) {
        results.push({ id, ok: false, error: `Stock is now ${current} (changed by an order or another admin since this page loaded) — refresh and re-apply` });
        continue;
      }
    }
    if (price !== undefined && Number(price) < 0) {
      results.push({ id, ok: false, error: 'Price cannot be negative' });
      continue;
    }
    if (buyingPrice !== undefined && Number(buyingPrice) < 0) {
      results.push({ id, ok: false, error: 'Buying price cannot be negative' });
      continue;
    }
    if (manufacturingCost !== undefined && Number(manufacturingCost) < 0) {
      results.push({ id, ok: false, error: 'Manufacturing cost cannot be negative' });
      continue;
    }
    try {
      if (kind === 'filament') {
        updateColour(parentId, id, { stockQty, priceRand: price, buyingPriceRand: buyingPrice, listed }, db);
      } else if (kind === 'category') {
        updateCategoryItemStock(parentId, id, { stockQty, price, buyingPrice, manufacturingCost, madeToOrder, listed });
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

// Backlog #122 (SITE-088): reorder report -- every sellable item at/below
// the low-stock threshold, with 30-day units sold so the owner can size
// the reorder. Threshold is the same admin-editable lowStockThreshold the
// storefront messaging and low-stock alerts already use (per-item reorder
// points remain an easy follow-up if one global line proves too coarse).
// Cancelled orders excluded -- their stock came back.
export function getReorderReport(db = getDb()) {
  const threshold = Number(getSettings(db).lowStockThreshold) || 3;
  const sold = new Map(
    db
      .prepare(
        `SELECT oi.product_id AS productId, SUM(oi.quantity) AS units
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.created_at >= datetime('now', '-30 days') AND o.status != 'cancelled'
         GROUP BY oi.product_id`,
      )
      .all()
      .map((r) => [r.productId, r.units]),
  );
  return listInventory(db)
    .filter((i) => Number(i.stockQty) <= threshold)
    .map((i) => ({ ...i, soldLast30Days: sold.get(i.productId) || 0 }))
    .sort((a, b) => a.stockQty - b.stockQty || b.soldLast30Days - a.soldLast30Days);
}
