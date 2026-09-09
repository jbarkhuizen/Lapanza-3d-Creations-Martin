import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeAllCachedDbs } from './db.js';
import { updateSettings } from './settings.js';

// Dropship listings write real items into catalog.json (a file), not
// SQLite -- same isolation orders.test.js/inventory.test.js already use for
// the same reason (category-kind products live on disk).
async function withTempCwd(t) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esquire-test-'));
  const originalCwd = process.cwd();
  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'public'), { recursive: true });
  process.chdir(tmpRoot);

  t.after(() => {
    closeAllCachedDbs();
    process.chdir(originalCwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  return tmpRoot;
}

function sampleFeedXml(products) {
  const rows = products
    .map(
      (p) => `<product>
        <ProductName><![CDATA[${p.name}]]></ProductName>
        <ProductCode><![CDATA[${p.code}]]></ProductCode>
        <Category><![CDATA[${p.category != null ? p.category : 'Misc'}]]></Category>
        <ProductSummary><![CDATA[${p.summary || ''}]]></ProductSummary>
        <Price>${p.cost}</Price>
        <AvailableQty>Yes</AvailableQty>
        <image><![CDATA[${p.imageUrl || `https://api.esquire.co.za/Resources/Images/Products/${p.code}.jpg`}]]></image>
      </product>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><ROOT><products dateTime="1">${rows}</products></ROOT>`;
}

function fakeFetcher(xml, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, text: async () => xml });
}

test('parseEsquireFeed decodes the supplier feed\'s double-escaped entities and handles a single-product feed', async () => {
  const { parseEsquireFeed } = await import(`./esquire.js?t=${Date.now()}`);
  const xml = `<ROOT><products><product>
    <ProductName><![CDATA[DC CONNECTOR FEMALE]]></ProductName>
    <ProductCode><![CDATA[DCWF]]></ProductCode>
    <Category><![CDATA[Cable: Adaptors &amp; Convertors]]></Category>
    <ProductSummary><![CDATA[DC female connector]]></ProductSummary>
    <Price>3.3</Price>
    <AvailableQty>Yes</AvailableQty>
    <image><![CDATA[https://api.esquire.co.za/img/a.jpg]]></image>
  </product></products></ROOT>`;
  const products = parseEsquireFeed(xml);
  assert.strictEqual(products.length, 1);
  assert.strictEqual(products[0].category, 'Cable: Adaptors & Convertors', 'literal &amp; inside CDATA must be un-escaped to a real &');
  assert.strictEqual(products[0].cost, 3.3);
});

test('parseEsquireFeed drops a product with no ProductCode and copes with a missing image', async () => {
  const { parseEsquireFeed } = await import(`./esquire.js?t=${Date.now()}`);
  const xml = `<ROOT><products>
    <product><ProductName><![CDATA[No code]]></ProductName><Price>5</Price></product>
    <product><ProductName><![CDATA[No image]]></ProductName><ProductCode><![CDATA[ABC]]></ProductCode><Price>5</Price></product>
  </products></ROOT>`;
  const products = parseEsquireFeed(xml);
  assert.strictEqual(products.length, 1);
  assert.strictEqual(products[0].code, 'ABC');
  assert.strictEqual(products[0].imageUrl, '');
});

test('buildFeedUrl forces m=0 regardless of what is stored, preserving the rest of the query', async () => {
  const { buildFeedUrl } = await import(`./esquire.js?t=${Date.now()}`);
  const url = buildFeedUrl('https://api.esquire.co.za/api/DataFeed?u=me&p=secret&t=xml&m=10&o=ascending');
  const parsed = new URL(url);
  assert.strictEqual(parsed.searchParams.get('m'), '0');
  assert.strictEqual(parsed.searchParams.get('u'), 'me');
  assert.strictEqual(parsed.searchParams.get('t'), 'xml');
});

test('computeSellingPrice applies the margin and rounds to cents', async () => {
  const { computeSellingPrice } = await import(`./esquire.js?t=${Date.now()}`);
  assert.strictEqual(computeSellingPrice(100, 10), 110);
  assert.strictEqual(computeSellingPrice(19.99, 10), 21.99);
  assert.strictEqual(computeSellingPrice(3.3000055, 10), 3.63);
});

test('syncEsquireProducts refuses without a configured feed URL, and refuses to wipe the cache on an empty feed', async (t) => {
  await withTempCwd(t);
  const db = openDb(':memory:');
  const { syncEsquireProducts } = await import(`./esquire.js?t=${Date.now()}`);
  await assert.rejects(() => syncEsquireProducts({ db }), /No Esquire feed URL configured/);

  updateSettings({ esquireFeedUrl: 'https://api.esquire.co.za/api/DataFeed?u=x&p=y&t=xml&m=10' }, db);
  await assert.rejects(
    () => syncEsquireProducts({ fetcher: fakeFetcher(sampleFeedXml([])), db }),
    /zero products/,
  );
  db.close();
});

test('syncEsquireProducts upserts the cache and marks a code missing from the latest pull as unavailable', async (t) => {
  await withTempCwd(t);
  const db = openDb(':memory:');
  const { syncEsquireProducts, getEsquireProduct } = await import(`./esquire.js?t=${Date.now()}`);
  updateSettings({ esquireFeedUrl: 'https://api.esquire.co.za/api/DataFeed?u=x&p=y&t=xml&m=10' }, db);

  const first = await syncEsquireProducts({
    fetcher: fakeFetcher(sampleFeedXml([{ code: 'A1', name: 'Widget', cost: 100 }, { code: 'B2', name: 'Gadget', cost: 50 }])),
    db,
  });
  assert.strictEqual(first.syncedCount, 2);
  assert.strictEqual(getEsquireProduct('A1', db).available, true);

  // B2 disappears from the next pull entirely -- this supplier's feed omits
  // out-of-stock items rather than flagging them.
  await syncEsquireProducts({ fetcher: fakeFetcher(sampleFeedXml([{ code: 'A1', name: 'Widget', cost: 105 }])), db });
  assert.strictEqual(getEsquireProduct('A1', db).cost, 105, 'still-present code gets its refreshed cost');
  assert.strictEqual(getEsquireProduct('B2', db).available, false, 'code missing from the latest pull is marked unavailable, not deleted');
  db.close();
});

test('createDropshipListing imports a cached product into a brand-new category as a real, sellable item', async (t) => {
  await withTempCwd(t);
  const db = openDb(':memory:');
  const { syncEsquireProducts, createDropshipListing } = await import(`./esquire.js?t=${Date.now()}`);
  const { getProduct } = await import(`./store.js?t=${Date.now()}`);
  updateSettings({ esquireFeedUrl: 'https://api.esquire.co.za/api/DataFeed?u=x&p=y&t=xml&m=10' }, db);
  await syncEsquireProducts({ fetcher: fakeFetcher(sampleFeedXml([{ code: 'A1', name: 'Widget', cost: 100 }])), db });

  const { listing, product } = createDropshipListing({ esquireProductCode: 'A1', categorySlug: 'computer-gear', categoryName: 'Computer Gear', marginPercent: 20 }, db);
  assert.strictEqual(listing.marginPercent, 20);
  assert.strictEqual(listing.sellingPrice, 120);

  const saved = getProduct(product.id);
  assert.strictEqual(saved.items.length, 1);
  const item = saved.items[0];
  assert.strictEqual(item.dropship, true);
  assert.strictEqual(item.esquireProductCode, 'A1');
  assert.strictEqual(item.buyingPrice, 100);
  assert.strictEqual(item.price, '120');
  assert.strictEqual(item.stockQty, 999, 'nominal ceiling stands in for a real quantity the feed does not provide');
  assert.strictEqual(item.available, true);
  assert.strictEqual(item.listed, true);
  db.close();
});

test('createDropshipListing rejects an unknown code, and a new category without a name', async (t) => {
  await withTempCwd(t);
  const db = openDb(':memory:');
  const { syncEsquireProducts, createDropshipListing } = await import(`./esquire.js?t=${Date.now()}`);
  updateSettings({ esquireFeedUrl: 'https://api.esquire.co.za/api/DataFeed?u=x&p=y&t=xml&m=10' }, db);
  await syncEsquireProducts({ fetcher: fakeFetcher(sampleFeedXml([{ code: 'A1', name: 'Widget', cost: 100 }])), db });

  assert.throws(() => createDropshipListing({ esquireProductCode: 'NOPE', categorySlug: 'x', categoryName: 'X' }, db), /not found/);
  assert.throws(() => createDropshipListing({ esquireProductCode: 'A1', categorySlug: 'brand-new-slug' }, db), /needs a name/);
  db.close();
});

test('updateDropshipListing recomputes price on a margin change, and active=false unlists+unavailables the item', async (t) => {
  await withTempCwd(t);
  const db = openDb(':memory:');
  const { syncEsquireProducts, createDropshipListing, updateDropshipListing } = await import(`./esquire.js?t=${Date.now()}`);
  const { getProduct } = await import(`./store.js?t=${Date.now()}`);
  updateSettings({ esquireFeedUrl: 'https://api.esquire.co.za/api/DataFeed?u=x&p=y&t=xml&m=10' }, db);
  await syncEsquireProducts({ fetcher: fakeFetcher(sampleFeedXml([{ code: 'A1', name: 'Widget', cost: 100 }])), db });
  const { listing, product } = createDropshipListing({ esquireProductCode: 'A1', categorySlug: 'gear', categoryName: 'Gear', marginPercent: 10 }, db);

  const updated = updateDropshipListing(listing.id, { marginPercent: 25 }, db);
  assert.strictEqual(updated.marginPercent, 25);
  assert.strictEqual(updated.sellingPrice, 125);
  let item = getProduct(product.id).items[0];
  assert.strictEqual(item.price, '125');

  const deactivated = updateDropshipListing(listing.id, { active: false }, db);
  assert.strictEqual(deactivated.active, false);
  item = getProduct(product.id).items[0];
  assert.strictEqual(item.listed, false);
  assert.strictEqual(item.available, false);
  db.close();
});

test('deleteDropshipListing removes the item from its category and the listing row', async (t) => {
  await withTempCwd(t);
  const db = openDb(':memory:');
  const { syncEsquireProducts, createDropshipListing, deleteDropshipListing, getDropshipListing } = await import(`./esquire.js?t=${Date.now()}`);
  const { getProduct } = await import(`./store.js?t=${Date.now()}`);
  updateSettings({ esquireFeedUrl: 'https://api.esquire.co.za/api/DataFeed?u=x&p=y&t=xml&m=10' }, db);
  await syncEsquireProducts({ fetcher: fakeFetcher(sampleFeedXml([{ code: 'A1', name: 'Widget', cost: 100 }])), db });
  const { listing, product } = createDropshipListing({ esquireProductCode: 'A1', categorySlug: 'gear', categoryName: 'Gear' }, db);

  assert.strictEqual(deleteDropshipListing(listing.id, db), true);
  assert.strictEqual(getDropshipListing(listing.id, db), null);
  assert.strictEqual(getProduct(product.id).items.length, 0);
  assert.strictEqual(deleteDropshipListing(listing.id, db), false, 'deleting an already-gone listing is a no-op, not a crash');
  db.close();
});

test('resyncDropshipListings refreshes cost/stock for a still-available item and auto-delists one the supplier dropped', async (t) => {
  await withTempCwd(t);
  const db = openDb(':memory:');
  const { syncEsquireProducts, createDropshipListing, getDropshipListing } = await import(`./esquire.js?t=${Date.now()}`);
  const { getProduct } = await import(`./store.js?t=${Date.now()}`);
  updateSettings({ esquireFeedUrl: 'https://api.esquire.co.za/api/DataFeed?u=x&p=y&t=xml&m=10' }, db);
  await syncEsquireProducts({
    fetcher: fakeFetcher(sampleFeedXml([{ code: 'A1', name: 'Widget', cost: 100 }, { code: 'B2', name: 'Gadget', cost: 50 }])),
    db,
  });
  const listingA = createDropshipListing({ esquireProductCode: 'A1', categorySlug: 'gear', categoryName: 'Gear', marginPercent: 10 }, db).listing;
  const createdB = createDropshipListing({ esquireProductCode: 'B2', categorySlug: 'gear', marginPercent: 10 }, db);
  const productB = createdB.product;
  const listingB = createdB.listing;

  // Next pull: A1's cost changed, B2 vanished entirely (supplier dropped it).
  await syncEsquireProducts({ fetcher: fakeFetcher(sampleFeedXml([{ code: 'A1', name: 'Widget', cost: 110 }])), db });

  const itemA = getProduct(productB.id).items.find((i) => i.esquireProductCode === 'A1');
  assert.strictEqual(itemA.buyingPrice, 110);
  assert.strictEqual(itemA.price, '121');
  assert.strictEqual(itemA.stockQty, 999);
  assert.strictEqual(getDropshipListing(listingA.id, db).active, true);

  const itemB = getProduct(productB.id).items.find((i) => i.esquireProductCode === 'B2');
  assert.strictEqual(itemB.available, false, 'a delisted item is made unavailable');
  assert.strictEqual(itemB.stockQty, 0);
  assert.strictEqual(itemB.listed, false);
  assert.strictEqual(getDropshipListing(listingB.id, db).active, false, 'the listing itself is auto-deactivated');
  db.close();
});

test('resyncDropshipListings keeps an owner-uploaded custom photo, but refreshes the supplier\'s own image', async (t) => {
  await withTempCwd(t);
  const db = openDb(':memory:');
  const { syncEsquireProducts, createDropshipListing } = await import(`./esquire.js?t=${Date.now()}`);
  const { getProduct, upsertProduct } = await import(`./store.js?t=${Date.now()}`);
  updateSettings({ esquireFeedUrl: 'https://api.esquire.co.za/api/DataFeed?u=x&p=y&t=xml&m=10' }, db);
  await syncEsquireProducts({
    fetcher: fakeFetcher(sampleFeedXml([{ code: 'A1', name: 'Widget', cost: 100, imageUrl: 'https://api.esquire.co.za/img/v1.jpg' }])),
    db,
  });
  const { product } = createDropshipListing({ esquireProductCode: 'A1', categorySlug: 'gear', categoryName: 'Gear' }, db);

  // Owner replaces the photo with one uploaded through the admin (not an
  // api.esquire.co.za URL).
  const loaded = getProduct(product.id);
  loaded.items[0].imageUrl = '/uploads/category-items/owner-photo.jpg';
  upsertProduct(loaded, db);

  await syncEsquireProducts({
    fetcher: fakeFetcher(sampleFeedXml([{ code: 'A1', name: 'Widget', cost: 100, imageUrl: 'https://api.esquire.co.za/img/v2.jpg' }])),
    db,
  });
  assert.strictEqual(getProduct(product.id).items[0].imageUrl, '/uploads/category-items/owner-photo.jpg', 'owner photo must survive a sync');
  db.close();
});

test('classifyEsquireCategory buckets raw Esquire category names into umbrella groups, falling back to General Merchandise', async () => {
  const { classifyEsquireCategory } = await import(`./esquire.js?t=${Date.now()}`);
  assert.strictEqual(classifyEsquireCategory('Wireless Mouse').slug, 'computer-accessories-peripherals');
  assert.strictEqual(classifyEsquireCategory('Web Camera').slug, 'computer-accessories-peripherals');
  assert.strictEqual(classifyEsquireCategory('Cable: HDMI').slug, 'cables-adaptors-chargers');
  assert.strictEqual(classifyEsquireCategory('CCTV (Dome Camera)').slug, 'networking-security');
  assert.strictEqual(classifyEsquireCategory('Scented Candles').slug, 'general-merchandise', 'nothing about candles matches any umbrella keyword');
  assert.strictEqual(classifyEsquireCategory('').slug, 'general-merchandise');
});

test('bulkImportRemainingProducts imports every still-available cached product not already listed, grouped into umbrella categories', async (t) => {
  await withTempCwd(t);
  const db = openDb(':memory:');
  const { syncEsquireProducts, bulkImportRemainingProducts, createDropshipListing } = await import(`./esquire.js?t=${Date.now()}`);
  const { loadCatalog } = await import(`./store.js?t=${Date.now()}`);
  updateSettings({ esquireFeedUrl: 'https://api.esquire.co.za/api/DataFeed?u=x&p=y&t=xml&m=10', esquireDefaultMarginPercent: 10 }, db);
  await syncEsquireProducts({
    fetcher: fakeFetcher(sampleFeedXml([
      { code: 'A1', name: 'Mouse', category: 'Wireless Mouse', cost: 100 },
      { code: 'A2', name: 'Mouse 2', category: 'Bluetooth Mouse', cost: 200 },
      { code: 'B1', name: 'Cable', category: 'Cable: HDMI', cost: 50 },
      { code: 'C1', name: 'No Category', category: '', cost: 10 },
    ])),
    db,
  });

  // A1 already hand-imported into a differently-named custom category --
  // bulk import must skip it (by code), not double-import.
  createDropshipListing({ esquireProductCode: 'A1', categorySlug: 'computer-accessories', categoryName: 'Computer Accessories', marginPercent: 15 }, db);

  const result = bulkImportRemainingProducts(db);
  assert.strictEqual(result.imported, 3, 'A2, B1, C1 -- A1 already listed');
  assert.strictEqual(result.categoriesCreated, 3, 'computer-accessories-peripherals, cables-adaptors-chargers, general-merchandise');

  const catalog = loadCatalog();
  const peripherals = catalog.products.find((p) => p.slug === 'computer-accessories-peripherals');
  assert.ok(peripherals, 'Wireless/Bluetooth Mouse both land in the same umbrella group, not two separate categories');
  assert.strictEqual(peripherals.items.length, 1, 'only A2 -- A1 lives in the manually-curated computer-accessories category instead');
  assert.strictEqual(peripherals.items[0].sku, 'A2');
  assert.strictEqual(peripherals.items[0].price, '220', '200 cost + default 10% margin');
  assert.strictEqual(peripherals.items[0].dropship, true);
  assert.strictEqual(peripherals.status, 'published');
  assert.strictEqual(peripherals.featured, true);

  const cables = catalog.products.find((p) => p.slug === 'cables-adaptors-chargers');
  assert.ok(cables);
  assert.strictEqual(cables.items[0].sku, 'B1');

  const general = catalog.products.find((p) => p.slug === 'general-merchandise');
  assert.ok(general, 'a blank Esquire category falls back to General Merchandise rather than crashing');
  assert.strictEqual(general.items[0].sku, 'C1');

  const computerAccessories = catalog.products.find((p) => p.slug === 'computer-accessories');
  assert.strictEqual(computerAccessories.items.length, 1, 'A1 untouched by the bulk import');
  assert.strictEqual(computerAccessories.items[0].sku, 'A1');

  // Re-running immediately is a no-op -- everything is already listed.
  const second = bulkImportRemainingProducts(db);
  assert.strictEqual(second.imported, 0);
  db.close();
});

test('bulkImportRemainingProducts adds a new item to an EXISTING umbrella category rather than creating a duplicate', async (t) => {
  await withTempCwd(t);
  const db = openDb(':memory:');
  const { syncEsquireProducts, bulkImportRemainingProducts } = await import(`./esquire.js?t=${Date.now()}`);
  const { loadCatalog, upsertProduct } = await import(`./store.js?t=${Date.now()}`);
  updateSettings({ esquireFeedUrl: 'https://api.esquire.co.za/api/DataFeed?u=x&p=y&t=xml&m=10' }, db);

  // The umbrella category "Toys, Gifts & Seasonal" (slug toys-gifts-seasonal)
  // already exists with an unrelated hand-made item in it.
  upsertProduct({ id: 'p1', kind: 'category', slug: 'toys-gifts-seasonal', name: 'Toys, Gifts & Seasonal', status: 'published', featured: true, items: [{ id: 'i1', name: 'Handmade Toy', sku: 'HAND-1', price: '50' }] }, db);

  await syncEsquireProducts({
    fetcher: fakeFetcher(sampleFeedXml([{ code: 'T1', name: 'Toy Widget', category: 'Toys/Misc', cost: 30 }])),
    db,
  });
  const result = bulkImportRemainingProducts(db);
  assert.strictEqual(result.imported, 1);
  assert.strictEqual(result.categoriesCreated, 0, 'toys-gifts-seasonal already existed');

  const catalog = loadCatalog();
  const toys = catalog.products.filter((p) => p.slug === 'toys-gifts-seasonal');
  assert.strictEqual(toys.length, 1, 'no duplicate category created');
  assert.strictEqual(toys[0].items.length, 2, 'existing hand-made item preserved, new one added');
  assert.ok(toys[0].items.some((i) => i.sku === 'HAND-1'));
  assert.ok(toys[0].items.some((i) => i.sku === 'T1'));
  db.close();
});

test('migrateGranularCategoriesToGroups regroups old one-per-Esquire-category listings into their umbrella, leaves curated listings alone, and is safe to re-run', async (t) => {
  await withTempCwd(t);
  const db = openDb(':memory:');
  const { syncEsquireProducts, createDropshipListing, migrateGranularCategoriesToGroups, getDropshipListing } = await import(`./esquire.js?t=${Date.now()}`);
  const { loadCatalog } = await import(`./store.js?t=${Date.now()}`);
  updateSettings({ esquireFeedUrl: 'https://api.esquire.co.za/api/DataFeed?u=x&p=y&t=xml&m=10' }, db);
  await syncEsquireProducts({
    fetcher: fakeFetcher(sampleFeedXml([
      { code: 'A1', name: 'Mouse', category: 'Wireless Mouse', cost: 100 },
      { code: 'A2', name: 'Mouse 2', category: 'Bluetooth Mouse', cost: 200 },
      { code: 'B1', name: 'Curated Widget', category: 'Some Weird Category', cost: 50 },
    ])),
    db,
  });

  // Simulate the OLD (pre-grouping) bulk import behaviour directly: one
  // Lapanza category per raw Esquire category, slug = slugify(category).
  const oldListingA1 = createDropshipListing({ esquireProductCode: 'A1', categorySlug: 'wireless-mouse', categoryName: 'Wireless Mouse' }, db).listing;
  const oldListingA2 = createDropshipListing({ esquireProductCode: 'A2', categorySlug: 'bluetooth-mouse', categoryName: 'Bluetooth Mouse' }, db).listing;
  // B1 is a curated listing -- its category_slug was hand-chosen and does
  // NOT match slugify(its own raw category) ("some-weird-category") --
  // migration must leave it exactly where it is.
  const curatedListing = createDropshipListing({ esquireProductCode: 'B1', categorySlug: 'computer-accessories', categoryName: 'Computer Accessories' }, db).listing;

  const result = migrateGranularCategoriesToGroups(db);
  assert.strictEqual(result.migrated, 2, 'A1 and A2, both old auto-created per-category listings');
  assert.strictEqual(result.categoriesRemoved, 2, 'wireless-mouse and bluetooth-mouse are now empty');

  const catalog = loadCatalog();
  assert.strictEqual(catalog.products.some((p) => p.slug === 'wireless-mouse'), false, 'empty old category removed');
  assert.strictEqual(catalog.products.some((p) => p.slug === 'bluetooth-mouse'), false);
  const peripherals = catalog.products.find((p) => p.slug === 'computer-accessories-peripherals');
  assert.ok(peripherals, 'umbrella category created to receive the migrated items');
  assert.strictEqual(peripherals.items.length, 2);
  assert.ok(peripherals.items.some((i) => i.sku === 'A1'));
  assert.ok(peripherals.items.some((i) => i.sku === 'A2'));

  assert.strictEqual(getDropshipListing(oldListingA1.id, db).categorySlug, 'computer-accessories-peripherals');
  assert.strictEqual(getDropshipListing(oldListingA2.id, db).categorySlug, 'computer-accessories-peripherals');
  assert.strictEqual(getDropshipListing(curatedListing.id, db).categorySlug, 'computer-accessories', 'curated listing untouched');
  const computerAccessories = catalog.products.find((p) => p.slug === 'computer-accessories');
  assert.strictEqual(computerAccessories.items.length, 1, 'curated category still has exactly its own item');

  // Re-running is a no-op -- everything left already sits in its umbrella
  // (or was never an auto-created listing in the first place).
  const second = migrateGranularCategoriesToGroups(db);
  assert.strictEqual(second.migrated, 0);
  assert.strictEqual(second.categoriesRemoved, 0);
  db.close();
});

test('disableAllDropshipItems drafts every category holding a dropship item, unlists+unavailables every dropship item, and deactivates every listing -- reversibly, not a delete', async (t) => {
  await withTempCwd(t);
  const db = openDb(':memory:');
  const { syncEsquireProducts, createDropshipListing, disableAllDropshipItems, listDropshipListings } = await import(`./esquire.js?t=${Date.now()}`);
  const { loadCatalog, upsertProduct } = await import(`./store.js?t=${Date.now()}`);
  updateSettings({ esquireFeedUrl: 'https://api.esquire.co.za/api/DataFeed?u=x&p=y&t=xml&m=10' }, db);
  await syncEsquireProducts({
    fetcher: fakeFetcher(sampleFeedXml([{ code: 'A1', name: 'Mouse', category: 'Wireless Mouse', cost: 100 }])),
    db,
  });
  createDropshipListing({ esquireProductCode: 'A1', categorySlug: 'computer-accessories', categoryName: 'Computer Accessories', marginPercent: 10 }, db);

  // An unrelated, entirely hand-made category with no dropship items in
  // it must be left completely untouched.
  upsertProduct({ id: 'p2', kind: 'category', slug: 'toys', name: 'Toys', status: 'published', featured: true, items: [{ id: 'i1', name: 'Handmade Toy', sku: 'HAND-1', price: '50' }] }, db);

  const result = disableAllDropshipItems(db);
  assert.strictEqual(result.categoriesDisabled, 1);
  assert.strictEqual(result.itemsDisabled, 1);
  assert.strictEqual(result.listingsDisabled, 1);

  const catalog = loadCatalog();
  const computerAccessories = catalog.products.find((p) => p.slug === 'computer-accessories');
  assert.strictEqual(computerAccessories.status, 'draft');
  assert.strictEqual(computerAccessories.items[0].listed, false);
  assert.strictEqual(computerAccessories.items[0].available, false);
  // Not a delete -- the item, its sku/price/dropship flag, and the
  // category's name/slug are all still exactly there.
  assert.strictEqual(computerAccessories.items[0].sku, 'A1');
  assert.strictEqual(computerAccessories.items[0].dropship, true);
  assert.strictEqual(computerAccessories.name, 'Computer Accessories');

  const toys = catalog.products.find((p) => p.slug === 'toys');
  assert.strictEqual(toys.status, 'published', 'a category with no dropship items is untouched');
  assert.strictEqual(toys.items[0].listed !== false, true);

  assert.strictEqual(listDropshipListings(db)[0].active, false);

  // Re-running is a no-op -- already disabled.
  const second = disableAllDropshipItems(db);
  assert.strictEqual(second.categoriesDisabled, 0);
  assert.strictEqual(second.itemsDisabled, 0);
  assert.strictEqual(second.listingsDisabled, 0);
  db.close();
});
