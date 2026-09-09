import { randomUUID } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import { getDb } from './db.js';
import { getSettings } from './settings.js';
import { loadCatalog, saveCatalog, upsertProduct, normalizeItem } from './store.js';
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

// Owner report (2026-09-09): the supplier's feed has 673 of its OWN
// categories -- one Lapanza category per Esquire category (the original
// bulkImportRemainingProducts behaviour) meant 653 new sidebar entries,
// unusable. This groups every raw Esquire category name into one of ~19
// umbrella storefront categories instead, via ordered keyword rules
// (first match wins, most specific groups checked first so e.g. "Digital
// Camera Bag" lands in Cameras, not Bags). A rule set over 673 individual
// strings can never be perfect -- any item that lands in the wrong bucket
// is still just one "Move To" click away from the right one (the same
// admin feature built for a miscategorised filament colour).
// EXPORTED so tests and any future admin "reclassify" tool can reuse the
// exact same grouping without drifting from what the import actually did.
export const ESQUIRE_CATEGORY_GROUPS = [
  { slug: 'gaming', name: 'Gaming', keywords: ['gaming', 'joystick', 'game controller', 'ips gaming monitor', 'vr glasses'] },
  { slug: 'mobile-tablet-accessories', name: 'Mobile & Tablet Accessories', keywords: ['iphone', 'samsung', 'blackberry', 'google nexus', 'screen protector', 'mobile phone', 'mobile smart phone', 'various phone', 'cell phone case', 'ipad', 'ipod', 'tablet', 'selfie monopod', 'smart watch', 'smartphone'] },
  { slug: 'cameras-photography', name: 'Cameras & Photography', keywords: ['digital camera', 'digital photo frame', 'photo frame'] },
  { slug: 'bags-luggage', name: 'Bags & Luggage', keywords: ['backpack', 'bag', 'luggage', 'chair bag', 'padlock', 'carry case', 'carry folder'] },
  { slug: 'networking-security', name: 'Networking & Security', keywords: ['network', 'ethernet', 'broadband router', 'modem', 'range extender', 'access point', 'wireless antenna', 'wireless adaptor', 'kvm', 'cctv', 'ip camera', 'ip dome camera', 'security and alarm', 'poe'] },
  { slug: 'computer-accessories-peripherals', name: 'Computer Accessories & Peripherals', keywords: ['mouse', 'keyboard', 'webcam', 'web camera'] },
  { slug: 'storage-memory', name: 'Storage & Memory', keywords: ['hard disk', 'ssd', 'memory (', 'usb flash', 'storage box', 'disk box', 'media (cd', 'disks: cd'] },
  { slug: 'computers-laptops', name: 'Computers & Laptops', keywords: ['notebook-', 'notebooks', 'desktop systems', 'pc workstation', 'motherboard', 'cpu', 'graphics card', 'monitor', 'server (', 'server component', 'sound card', 'controller (', 'pc fan', 'optical drive', 'intel', 'input device'] },
  { slug: 'printers-office-machines', name: 'Printers, Ink & Office Machines', keywords: ['printer', 'ink cartridge', 'ink and toner', 'toner', 'laminat', 'pos ', 'point of sale', 'hand held scanner', 'document scanner', 'office equipment', 'office supplies'] },
  { slug: 'tv-audio-entertainment', name: 'TVs, Audio & Entertainment', keywords: ['television', 'tv stand', 'home theater', 'bluetooth speaker', 'soundbar', 'hi-fi', 'party speaker', 'multimedia', 'portable speaker', 'professional microphone', 'projector'] },
  { slug: 'power-solar-batteries', name: 'Power, Solar & Batteries', keywords: ['power ', 'power(', 'power bank', 'power distribution', 'power inverter', 'power supply', 'power ups', 'solar', 'inverter', 'battery', 'batteries', 'ups accessories'] },
  { slug: 'cables-adaptors-chargers', name: 'Cables, Adaptors & Chargers', keywords: ['cable', 'hdmi', 'usb (', 'usb charger', 'usb ethernet', 'usb mini', 'usb otg', 'molex', 'rca ', 'vga', 'display port', 'parallel/serial', 'multiplug', 'charger', 'sync & charge', 'sync and charge'] },
  { slug: 'kitchen-appliances', name: 'Kitchen Appliances', keywords: ['air fryer', 'blender', 'coffee', 'kettle', 'toaster', 'microwave', 'food mixer', 'food processor', 'juicer', 'ice cream maker', 'sandwich', 'waffle', 'crepe', 'grill', 'griddle', 'pressure cooker', 'induction cooker', 'milk frother', 'dessert maker', 'beverage carbonator', 'chafing dish', 'deep fryer', 'frying pan', 'can opener', 'food machine'] },
  { slug: 'home-appliances-cleaning', name: 'Home Appliances & Cleaning', keywords: ['vacuum', 'washing machine', 'clothing dryer', 'steam iron', 'ironing board', 'garment steamer', 'fan', 'heater', 'air purifier', 'cooler', 'humidifier', 'airconditioning', 'electric blanket', 'water dispenser', 'fridge', 'freezer', 'pressure washer', 'cleaning', 'floor cleaner', 'window cleaner', 'carpet cleaner', 'white board cleaner', 'white board duster', 'surface wipe', 'waste bin', 'dish rack', 'kitchen scale', 'kitchen utensil', 'bread bin', 'pots & pans', 'cutlery', 'knife set', 'salt & pepper', 'urn', 'water jug', 'water bottle', 'vacuum flask', 'bathroom'] },
  { slug: 'personal-care-health', name: 'Personal Care & Health', keywords: ['hair ', 'shaver', 'nail clipper', 'body massager', 'scalp massager', 'foot warmer', 'facial cleanser', 'health patch', 'heatpad', 'compression sock', 'ankle support', 'elbow support', 'wrist support', 'knee strap', 'waist belt', 'oximeter', 'thermometer', 'oxygen therapy', 'hand sanitizer', 'protective clothing', 'protective eyewear', 'protective facial mask', 'protective barrier', 'nitrile glove', 'latex glove', 'bathroom scale', 'baby bathing', 'baby maternity'] },
  { slug: 'office-stationery', name: 'Office & Stationery', keywords: ['pen', 'pencil', 'highlighter', 'eraser', 'sharpener', 'ruler', 'stapler', 'staple', 'punch', 'clip', 'file divider', 'ring binder', 'display book', 'flip file', 'report folder', 'magazine holder', 'desk organiser', 'desk cube', 'clip board', 'planning board', 'drawing', 'whiteboard', 'chalk board', 'a4 ', 'a5 ', 'counter book', 'examination pad', 'adhesive', 'glue', 'tape ', 'book cover', 'book label', 'scientific calculator', 'maths set', 'dictionary', 'star label', 'photo paper', 'stylus', 'pen caddy', 'colour pencil', 'coloured pencil'] },
  { slug: 'toys-gifts-seasonal', name: 'Toys, Gifts & Seasonal', keywords: ['kids puzzle', 'toy ', 'toys/', 'disney', 'tweety', 'fifa licensed', 'birthday', 'colouring book', 'educational board', 'magnetic drawing', 'fidget', 'kids swimming', 'gadgets and gifts', 'acrylic colour', 'oil colour', 'poster colour', 'water colour', 'water paint', 'clay', 'dough', 'glitter glue', 'keyring', 'wax crayon'] },
  { slug: 'car-tools-outdoor', name: 'Car, Tools & Outdoor', keywords: ['car accessor', 'car air freshener', 'car signal processor', 'bluetooth car kit', 'bike', 'camping', 'outdoor', 'grass trimmer', 'braai', 'rope', 'tape measure', 'ratchet', 'screw driver', 'pliers', 'hand drill', 'metal cutter', 'silicone gun', 'silicone sealant', 'general purpose tool', 'toolkit', 'test equipment'] },
  { slug: 'electrical-lighting', name: 'Electrical & Lighting', keywords: ['flush switch', 'surface switch', 'isolator switch', 'latch', 'plug top', 'insulation tape', 'door chime', 'home safe', 'led ', 'rechargeable led'] },
  { slug: 'software', name: 'Software', keywords: ['software'] },
];

// Fallback for anything none of the ordered groups above matched (a
// genuinely new Esquire category the rules haven't seen yet, or one
// specific enough it doesn't fit any umbrella) -- one catch-all rather
// than silently creating yet another 1-item category.
const ESQUIRE_FALLBACK_GROUP = { slug: 'general-merchandise', name: 'General Merchandise' };

export function classifyEsquireCategory(rawCategoryName) {
  const needle = String(rawCategoryName || '').toLowerCase();
  for (const group of ESQUIRE_CATEGORY_GROUPS) {
    if (group.keywords.some((kw) => needle.includes(kw))) return group;
  }
  return ESQUIRE_FALLBACK_GROUP;
}

// Owner request (2026-09-09): "import everything" -- every still-available
// cached product that isn't already an active dropship_listings row, in
// ONE pass. Deliberately bypasses createDropshipListing()'s one-item-at-a-
// time shape (which calls upsertProduct -> saveCatalog -> syncPublicJson
// per item): at full-feed scale (thousands of items) that would mean
// thousands of catalog.json rewrites for one operation. Instead this loads
// the catalog once, mutates every affected category product in memory,
// and calls saveCatalog() exactly once at the end -- the caller is still
// responsible for publishCatalog() afterwards (this function never
// generates pages or builds, same division of responsibility as every
// other route that mutates the catalog).
//
// Every candidate is bucketed into one of ESQUIRE_CATEGORY_GROUPS' ~19
// umbrella categories (not one Lapanza category per Esquire category --
// owner report 2026-09-09: that made 653 sidebar entries). Re-running this
// after a later sync only picks up genuinely new codes (already-imported
// ones, active or not, are skipped by code) -- safe to call again, not a
// one-shot script.
export function bulkImportRemainingProducts(db = getDb()) {
  const defaultMargin = Number(getSettings(db).esquireDefaultMarginPercent) || 10;
  const alreadyImported = new Set(db.prepare('SELECT esquire_product_code FROM dropship_listings').all().map((r) => r.esquire_product_code));
  const candidates = db
    .prepare('SELECT * FROM esquire_products WHERE available = 1')
    .all()
    .map(rowToEsquireProduct)
    .filter((p) => !alreadyImported.has(p.code));
  if (candidates.length === 0) return { imported: 0, categoriesCreated: 0, categoriesTouched: 0 };

  const catalog = loadCatalog();
  const bySlug = new Map(catalog.products.filter((p) => p.kind === 'category').map((p) => [p.slug, p]));
  const touchedSlugs = new Set();
  let categoriesCreated = 0;

  const now = new Date().toISOString();
  const insertListing = db.prepare(
    `INSERT INTO dropship_listings (id, esquire_product_code, category_slug, item_id, margin_percent, active, created_at, updated_at)
     VALUES (@id, @code, @slug, @item_id, @margin, 1, @now, @now)`,
  );

  const txn = db.transaction((items) => {
    for (const esquireProduct of items) {
      const group = classifyEsquireCategory(esquireProduct.category);
      let product = bySlug.get(group.slug);
      if (!product) {
        product = {
          id: randomUUID(), kind: 'category', slug: group.slug, name: group.name, description: '', crumbs: '', parent: null,
          items: [], status: 'published', featured: true, sortOrder: 0, seoTitle: '', seoDescription: '', internalNotes: '',
        };
        bySlug.set(group.slug, product);
        categoriesCreated += 1;
      }
      touchedSlugs.add(group.slug);
      const item = normalizeItem(
        {
          name: esquireProduct.name,
          details: esquireProduct.summary,
          sku: esquireProduct.code,
          price: String(computeSellingPrice(esquireProduct.cost, defaultMargin)),
          buyingPrice: esquireProduct.cost,
          imageUrl: esquireProduct.imageUrl,
          stockQty: DROPSHIP_NOMINAL_STOCK,
          available: true,
          listed: true,
          dropship: true,
          esquireProductCode: esquireProduct.code,
          marginPercent: defaultMargin,
        },
        product.items.length,
      );
      product.items.push(item);
      insertListing.run({ id: randomUUID(), code: esquireProduct.code, slug: group.slug, item_id: item.id, margin: defaultMargin, now });
    }
  });
  txn(candidates);

  for (const slug of touchedSlugs) {
    const product = bySlug.get(slug);
    const idx = catalog.products.findIndex((p) => p.id === product.id);
    if (idx === -1) catalog.products.push(product);
    else catalog.products[idx] = product;
  }
  saveCatalog(catalog, db);

  return { imported: candidates.length, categoriesCreated, categoriesTouched: touchedSlugs.size };
}

// One-time migration (owner report 2026-09-09, same day as the bulk import
// itself): bulkImportRemainingProducts originally created one Lapanza
// category PER ESQUIRE CATEGORY -- 653 of them, an unusable sidebar. This
// re-buckets every listing that's still sitting in one of those original
// auto-created per-category products into its ESQUIRE_CATEGORY_GROUPS
// umbrella instead, deletes the now-empty originals, and leaves anything
// else (a hand-curated import like the first "Computer Accessories" batch,
// whose category_slug was chosen explicitly and never matched
// slugify(its own Esquire category)) untouched -- that distinction IS the
// signal used to tell "auto-created by the old bulk import" apart from
// "the owner/an admin deliberately chose this category", since nothing
// else in the schema tracks it. Safe to re-run: once migrated, a row's
// category_slug already equals its umbrella group's slug, so the
// early-exit guard skips it on a second pass.
export function migrateGranularCategoriesToGroups(db = getDb()) {
  const catalog = loadCatalog();
  const bySlug = new Map(catalog.products.filter((p) => p.kind === 'category').map((p) => [p.slug, p]));
  const listings = db.prepare('SELECT * FROM dropship_listings').all();
  const now = new Date().toISOString();
  const updateSlug = db.prepare('UPDATE dropship_listings SET category_slug = @slug, updated_at = @now WHERE id = @id');
  const touchedSourceSlugs = new Set();
  let migrated = 0;

  const txn = db.transaction((rows) => {
    for (const row of rows) {
      const esquireProduct = getEsquireProduct(row.esquire_product_code, db);
      const rawCategory = esquireProduct?.category || 'Uncategorized';
      const autoSlug = slugifyFallback(rawCategory);
      if (row.category_slug !== autoSlug) continue; // a curated/manual listing, not one of the old auto-created ones
      const group = classifyEsquireCategory(rawCategory);
      if (row.category_slug === group.slug) continue; // already an umbrella slug (re-run safety)

      const source = bySlug.get(row.category_slug);
      const idx = source?.items?.findIndex((i) => i.id === row.item_id);
      if (!source || idx == null || idx < 0) continue;
      const [item] = source.items.splice(idx, 1);
      touchedSourceSlugs.add(row.category_slug);

      let target = bySlug.get(group.slug);
      if (!target) {
        target = {
          id: randomUUID(), kind: 'category', slug: group.slug, name: group.name, description: '', crumbs: '', parent: null,
          items: [], status: 'published', featured: true, sortOrder: 0, seoTitle: '', seoDescription: '', internalNotes: '',
        };
        bySlug.set(group.slug, target);
      }
      target.items.push(item);
      updateSlug.run({ slug: group.slug, now, id: row.id });
      migrated += 1;
    }
  });
  txn(listings);

  let categoriesRemoved = 0;
  for (const slug of touchedSourceSlugs) {
    const product = bySlug.get(slug);
    if (product && product.items.length === 0) {
      bySlug.delete(slug);
      categoriesRemoved += 1;
    }
  }

  catalog.products = catalog.products.filter((p) => p.kind !== 'category' || bySlug.has(p.slug) || !touchedSourceSlugs.has(p.slug));
  for (const product of bySlug.values()) {
    const idx = catalog.products.findIndex((p) => p.id === product.id);
    if (idx === -1) catalog.products.push(product);
    else catalog.products[idx] = product;
  }
  saveCatalog(catalog, db);

  return { migrated, categoriesRemoved };
}

// Local, migration-only re-derivation of the slug bulkImportRemainingProducts
// used to generate before umbrella grouping existed -- kept separate from
// classifyEsquireCategory precisely because it must NOT change: it's the
// fingerprint that tells an old auto-created category apart from a
// deliberately-chosen one.
function slugifyFallback(value) {
  return (
    String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'uncategorized'
  );
}

// Kill switch (owner report 2026-09-09: the full Esquire import appears to
// have crashed the site -- disabling everything at both levels while that
// gets investigated, without deleting any data). "Menu level" = every
// category that holds a dropship item goes to `status: 'draft'` (the same
// gate generate-pages.mjs/site.js's nav/orders.js's checkout backstop
// already enforce for any other draft category -- hidden from the
// sidebar, no public page, blocked at checkout even via a stale link).
// "Product level" = every dropship item itself, in EVERY category
// regardless of its dropship_listings row (belt-and-suspenders against
// any drift between the two), gets unlisted + unavailable. Every
// dropship_listings row is marked inactive too, so the daily sync job's
// resyncDropshipListings() (which only touches active rows) leaves
// everything alone until the owner deliberately re-enables it -- this is
// reversible, not a delete.
export function disableAllDropshipItems(db = getDb()) {
  const catalog = loadCatalog();
  let categoriesDisabled = 0;
  let itemsDisabled = 0;

  for (const product of catalog.products) {
    if (product.kind !== 'category') continue;
    const items = product.items || [];
    const hasDropship = items.some((i) => i.dropship === true);
    if (!hasDropship) continue;
    if (product.status !== 'draft') {
      product.status = 'draft';
      categoriesDisabled += 1;
    }
    product.items = items.map((item, i) => {
      if (!item.dropship) return item;
      if (item.listed === false && item.available === false) return item;
      itemsDisabled += 1;
      return normalizeItem({ ...item, listed: false, available: false }, i);
    });
  }
  saveCatalog(catalog, db);

  const now = new Date().toISOString();
  const { changes: listingsDisabled } = db.prepare("UPDATE dropship_listings SET active = 0, updated_at = ? WHERE active = 1").run(now);

  return { categoriesDisabled, itemsDisabled, listingsDisabled };
}
