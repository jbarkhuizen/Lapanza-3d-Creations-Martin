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
        <Category><![CDATA[${p.category || 'Misc'}]]></Category>
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
