import { randomUUID } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import { getDb } from './db.js';
import { getSettings } from './settings.js';
import { upsertProduct, normalizeItem } from './store.js';
import { readCategoryProducts } from './export.js';

// A dropship item with no real supplier quantity (the feed is Yes/No, not a
// count) gets a nominal ceiling instead of a real stock figure, so the
// existing reserve-at-order-creation/decrement machinery (orders.js) works
// unmodified. This is NOT a promise of 999 real units -- oversell risk
// against the supplier's own stock is inherent to dropshipping and can only
// be absorbed operationally (refund/backorder), not engineered away.
export const DROPSHIP_NOMINAL_STOCK = 999;

const parser = new XMLParser({ cdataPropName: '__cdata' });

function cdata(node) {
  if (node == null) return '';
  const raw = typeof node === 'object' ? node.__cdata ?? '' : String(node);
  // This supplier's feed generator double-escapes HTML entities INSIDE its
  // own CDATA blocks (e.g. literal "&amp;" instead of "&") -- CDATA content
  // is never entity-decoded by spec, so the parser hands it back exactly as
  // written. Undoing that one-level-too-many escaping here, once, rather
  // than at every call site.
  return String(raw)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// The stored feed URL always carries the owner's own u=/p= query-string
// credentials -- never logged, never sent anywhere but straight to fetch().
// Its own `m=` (margin) param is forced to 0 regardless of what's stored,
// so a sync always pulls true supplier cost -- the owner sets and adjusts
// his own margin per item (dropship_listings.margin_percent), never trusts
// the supplier's own margin param (verified empirically before building
// this: m=10 vs m=0 differed by exactly a 1.10 ratio on every SKU checked).
export function buildFeedUrl(storedUrl) {
  const url = new URL(storedUrl);
  url.searchParams.set('m', '0');
  return url.toString();
}

export function parseEsquireFeed(xml) {
  const parsed = parser.parse(xml);
  const raw = parsed?.ROOT?.products?.product;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((p) => ({
      code: cdata(p.ProductCode),
      name: cdata(p.ProductName),
      category: cdata(p.Category),
      summary: cdata(p.ProductSummary),
      cost: Number(p.Price) || 0,
      imageUrl: cdata(p.image),
    }))
    .filter((p) => p.code);
}

// Pulls the live feed, forced to true cost, and wholesale-replaces the
// esquire_products cache. Any code NOT seen in this pull is marked
// unavailable rather than deleted -- this supplier's feed appears to omit
// out-of-stock items entirely rather than flag them, so "missing from the
// latest pull" is the only unavailability signal there is, and a
// dropship_listings row may still reference a now-unavailable code.
export async function syncEsquireProducts({ fetcher = fetch, db = getDb() } = {}) {
  const settings = getSettings(db);
  const storedUrl = String(settings.esquireFeedUrl || '').trim();
  if (!storedUrl) throw new Error('No Esquire feed URL configured (Settings -> Dropship)');
  const res = await fetcher(buildFeedUrl(storedUrl));
  if (!res.ok) throw new Error(`Esquire feed returned ${res.status}`);
  const xml = await res.text();
  const products = parseEsquireFeed(xml);
  if (products.length === 0) throw new Error('Esquire feed returned zero products -- refusing to wipe the cache');

  const now = new Date().toISOString();
  const txn = db.transaction((items) => {
    db.prepare('UPDATE esquire_products SET available = 0').run();
    const upsert = db.prepare(
      `INSERT INTO esquire_products (code, name, category, summary, cost_rand, image_url, available, last_synced_at)
       VALUES (@code, @name, @category, @summary, @cost, @imageUrl, 1, @now)
       ON CONFLICT(code) DO UPDATE SET
         name = excluded.name, category = excluded.category, summary = excluded.summary,
         cost_rand = excluded.cost_rand, image_url = excluded.image_url, available = 1, last_synced_at = excluded.last_synced_at`,
    );
    for (const item of items) upsert.run({ ...item, now });
  });
  txn(products);

  const relisted = resyncDropshipListings(db);
  return { syncedCount: products.length, syncedAt: now, catalogChanged: relisted.changed, delisted: relisted.delisted };
}

function rowToEsquireProduct(row) {
  return {
    code: row.code,
    name: row.name,
    category: row.category,
    summary: row.summary,
    cost: row.cost_rand,
    imageUrl: row.image_url,
    available: Boolean(row.available),
    lastSyncedAt: row.last_synced_at,
  };
}

export function listEsquireCategories(db = getDb()) {
  return db
    .prepare('SELECT category, COUNT(*) AS count FROM esquire_products WHERE available = 1 GROUP BY category ORDER BY category ASC')
    .all()
    .map((r) => ({ category: r.category, count: r.count }));
}

export function listEsquireProducts({ q, category, page = 1, pageSize = 50 } = {}, db = getDb()) {
  const clauses = ['available = 1'];
  const params = {};
  if (q) {
    clauses.push('(name LIKE @q OR code LIKE @q)');
    params.q = `%${q}%`;
  }
  if (category) {
    clauses.push('category = @category');
    params.category = category;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM esquire_products ${where}`).get(params).n;
  const offset = Math.max(0, (Number(page) - 1) * Number(pageSize));
  const rows = db
    .prepare(`SELECT * FROM esquire_products ${where} ORDER BY name ASC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: Number(pageSize), offset });
  return { products: rows.map(rowToEsquireProduct), total, page: Number(page), pageSize: Number(pageSize) };
}

export function getEsquireProduct(code, db = getDb()) {
  const row = db.prepare('SELECT * FROM esquire_products WHERE code = ?').get(code);
  return row ? rowToEsquireProduct(row) : null;
}

function rowToListing(row, db) {
  const esquireProduct = getEsquireProduct(row.esquire_product_code, db);
  return {
    id: row.id,
    esquireProductCode: row.esquire_product_code,
    categorySlug: row.category_slug,
    itemId: row.item_id,
    marginPercent: row.margin_percent,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    esquireProduct,
    sellingPrice: esquireProduct ? computeSellingPrice(esquireProduct.cost, row.margin_percent) : null,
  };
}

export function listDropshipListings(db = getDb()) {
  return db.prepare('SELECT * FROM dropship_listings ORDER BY created_at DESC').all().map((r) => rowToListing(r, db));
}

export function getDropshipListing(id, db = getDb()) {
  const row = db.prepare('SELECT * FROM dropship_listings WHERE id = ?').get(id);
  return row ? rowToListing(row, db) : null;
}

export function computeSellingPrice(cost, marginPercent) {
  return Math.round(Number(cost) * (1 + Number(marginPercent) / 100) * 100) / 100;
}

function findCategoryBySlug(slug) {
  return readCategoryProducts().find((c) => c.slug === slug) || null;
}

// Imports one Esquire product into a Lapanza category as a real, sellable
// item -- creates the target category product if categoryName is given and
// no product with that slug exists yet. Reuses the exact category-item
// schema every other product already uses (normalizeItem, server/index.js)
// so nothing downstream (cart, checkout, storefront rendering) needs a
// special case for a dropship item beyond the `dropship`/`esquireProductCode`
// flag fields themselves.
export function createDropshipListing({ esquireProductCode, categorySlug, categoryName, marginPercent }, db = getDb()) {
  const esquireProduct = getEsquireProduct(esquireProductCode, db);
  if (!esquireProduct) throw new Error('Esquire product not found in the synced cache');
  const margin = marginPercent != null ? Number(marginPercent) : Number(getSettings(db).esquireDefaultMarginPercent) || 10;

  let product = findCategoryBySlug(categorySlug);
  if (!product) {
    if (!categoryName) throw new Error('New category needs a name');
    // Same field shape POST /api/products writes (server/index.js) --
    // published + featured by default so a newly-created dropship category
    // is actually live and in the sidebar immediately, unlike a hand-created
    // category which defaults to draft/unfeatured pending the owner's review.
    product = {
      id: randomUUID(),
      kind: 'category',
      slug: categorySlug,
      name: categoryName,
      description: '',
      crumbs: '',
      parent: null,
      items: [],
      status: 'published',
      featured: true,
      sortOrder: 0,
      seoTitle: '',
      seoDescription: '',
      internalNotes: '',
    };
  }

  const item = normalizeItem(
    {
      name: esquireProduct.name,
      details: esquireProduct.summary,
      sku: esquireProduct.code,
      price: String(computeSellingPrice(esquireProduct.cost, margin)),
      buyingPrice: esquireProduct.cost,
      imageUrl: esquireProduct.imageUrl,
      stockQty: esquireProduct.available ? DROPSHIP_NOMINAL_STOCK : 0,
      available: esquireProduct.available,
      listed: true,
      dropship: true,
      esquireProductCode: esquireProduct.code,
      marginPercent: margin,
    },
    (product.items || []).length,
  );
  product.items = [...(product.items || []), item];
  upsertProduct(product, db);

  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO dropship_listings (id, esquire_product_code, category_slug, item_id, margin_percent, active, created_at, updated_at)
     VALUES (@id, @code, @slug, @item_id, @margin, 1, @now, @now)`,
  ).run({ id, code: esquireProduct.code, slug: product.slug, item_id: item.id, margin, now });

  return { listing: getDropshipListing(id, db), product };
}

export function updateDropshipListing(id, { marginPercent, active }, db = getDb()) {
  const row = db.prepare('SELECT * FROM dropship_listings WHERE id = ?').get(id);
  if (!row) return null;
  const margin = marginPercent != null ? Number(marginPercent) : row.margin_percent;
  const nextActive = active != null ? Boolean(active) : Boolean(row.active);

  const product = findCategoryBySlug(row.category_slug);
  const idx = product?.items?.findIndex((i) => i.id === row.item_id);
  if (product && idx > -1) {
    const existing = product.items[idx];
    product.items[idx] = normalizeItem(
      {
        ...existing,
        marginPercent: margin,
        listed: nextActive,
        available: nextActive && existing.stockQty > 0,
        price: marginPercent != null ? String(computeSellingPrice(existing.buyingPrice, margin)) : existing.price,
      },
      idx,
    );
    upsertProduct(product, db);
  }

  db.prepare('UPDATE dropship_listings SET margin_percent = @margin, active = @active, updated_at = @now WHERE id = @id')
    .run({ id, margin, active: nextActive ? 1 : 0, now: new Date().toISOString() });
  return getDropshipListing(id, db);
}

export function deleteDropshipListing(id, db = getDb()) {
  const row = db.prepare('SELECT * FROM dropship_listings WHERE id = ?').get(id);
  if (!row) return false;
  const product = findCategoryBySlug(row.category_slug);
  if (product) {
    product.items = (product.items || []).filter((i) => i.id !== row.item_id);
    upsertProduct(product, db);
  }
  db.prepare('DELETE FROM dropship_listings WHERE id = ?').run(id);
  return true;
}

// Runs after every sync: pushes fresh cost/availability/image from the cache
// into each active listing's live catalog item, and auto-delists (sets the
// item unavailable/unlisted, the listing inactive) anything the supplier no
// longer carries -- catching a discontinued line without the owner having
// to notice it manually. An owner-uploaded custom photo (imageUrl no longer
// pointing at api.esquire.co.za) is deliberately left alone rather than
// overwritten back to the supplier's own image.
export function resyncDropshipListings(db = getDb()) {
  const listings = db.prepare('SELECT * FROM dropship_listings WHERE active = 1').all();
  const byProduct = new Map();
  let changed = false;
  let delisted = 0;

  for (const row of listings) {
    const esquireProduct = getEsquireProduct(row.esquire_product_code, db);
    const product = byProduct.get(row.category_slug) || findCategoryBySlug(row.category_slug);
    if (!product) continue;
    byProduct.set(row.category_slug, product);
    const idx = product.items?.findIndex((i) => i.id === row.item_id);
    if (idx == null || idx < 0) continue;
    const existing = product.items[idx];

    if (!esquireProduct || !esquireProduct.available) {
      product.items[idx] = normalizeItem({ ...existing, available: false, stockQty: 0, listed: false }, idx);
      db.prepare('UPDATE dropship_listings SET active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
      delisted += 1;
      changed = true;
      continue;
    }

    const keepOwnImage = existing.imageUrl && !existing.imageUrl.startsWith('https://api.esquire.co.za/');
    product.items[idx] = normalizeItem(
      {
        ...existing,
        buyingPrice: esquireProduct.cost,
        price: String(computeSellingPrice(esquireProduct.cost, row.margin_percent)),
        stockQty: DROPSHIP_NOMINAL_STOCK,
        available: true,
        imageUrl: keepOwnImage ? existing.imageUrl : esquireProduct.imageUrl,
      },
      idx,
    );
    changed = true;
  }

  for (const product of byProduct.values()) upsertProduct(product, db);
  return { changed, delisted };
}
