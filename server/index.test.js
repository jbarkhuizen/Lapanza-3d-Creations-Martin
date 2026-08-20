import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { closeAllCachedDbs, getDb } from './db.js';

async function freshApp() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'index-test-'));
  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'public'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'admin'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'admin', 'index.html'), '<html></html>');
  const originalCwd = process.cwd();
  process.chdir(tmpRoot);
  const mod = await import(`./index.js?t=${Date.now()}-${Math.random()}`);
  return {
    app: mod.default,
    // Exposed so fix-round regression tests can reach the isolated data dir
    // directly (via tmpRoot) instead of calling process.cwd() again later.
    tmpRoot,
    cleanup: () => {
      closeAllCachedDbs(); // each freshApp() call opens its own cache entry (Task 2's getDb is keyed per cwd) -- release it before deleting its directory
      process.chdir(originalCwd);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    },
  };
}

test('health check reports ok when the database is reachable', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);

  const res = await request(app).get('/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.service, 'lapanza-admin');
  assert.ok(res.body.time);
});

test('health check reports 503 when the database is unreachable', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);

  // Simulates the real failure mode a pure liveness check would miss: the
  // Node process is still alive and responding, but the DB underneath it
  // isn't -- closing the connection this app instance holds reproduces
  // exactly that without needing to actually corrupt a file on disk.
  getDb().close();

  const res = await request(app).get('/api/health');
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.body.ok, false);
});

test('setup status is true before any admin exists, false after', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);

  const before = await request(app).get('/api/setup/status');
  assert.strictEqual(before.body.needsSetup, true);

  const setup = await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  assert.strictEqual(setup.status, 201);

  const after = await request(app).get('/api/setup/status');
  assert.strictEqual(after.body.needsSetup, false);
});

test('setup is refused once an admin already exists', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const second = await request(app).post('/api/setup').send({ username: 'other', password: 'correcthorsebattery' });
  assert.strictEqual(second.status, 409);
});

test('login requires username + password, protected routes require a session', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });

  const noAuth = await request(app).get('/api/filaments');
  assert.strictEqual(noAuth.status, 401);

  const badLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'wrong' });
  assert.strictEqual(badLogin.status, 401);

  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  assert.strictEqual(login.status, 200);
  const cookie = login.headers['set-cookie'];

  const withAuth = await request(app).get('/api/filaments').set('Cookie', cookie);
  assert.strictEqual(withAuth.status, 200);
  assert.deepStrictEqual(withAuth.body.filaments, []);
});

test('filament create/update/colour flow end to end through the API', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const created = await request(app).post('/api/filaments').set('Cookie', cookie).send({ name: 'PLA', description: 'Standard' });
  assert.strictEqual(created.status, 201);
  const filamentId = created.body.filament.id;

  const withColour = await request(app)
    .post(`/api/filaments/${filamentId}/colours`)
    .set('Cookie', cookie)
    .send({ name: 'White', sku: 'SKU-1', priceRand: 299, weightG: 1000, stockQty: 5 });
  assert.strictEqual(withColour.status, 201);
  const colourId = withColour.body.filament.colours[0].id;
  assert.strictEqual(withColour.body.filament.colours[0].priceRand, 299);

  const updated = await request(app)
    .put(`/api/filaments/${filamentId}/colours/${colourId}`)
    .set('Cookie', cookie)
    .send({ stockQty: 2 });
  assert.strictEqual(updated.body.filament.colours[0].stockQty, 2);

  const deleted = await request(app).delete(`/api/filaments/${filamentId}/colours/${colourId}`).set('Cookie', cookie);
  assert.strictEqual(deleted.status, 200);
});

test('admins panel: list, add, refuse removing the last admin', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const list = await request(app).get('/api/admins').set('Cookie', cookie);
  assert.strictEqual(list.body.admins.length, 1);
  const onlyAdminId = list.body.admins[0].id;

  const refused = await request(app).delete(`/api/admins/${onlyAdminId}`).set('Cookie', cookie);
  assert.strictEqual(refused.status, 400);

  const added = await request(app).post('/api/admins').set('Cookie', cookie).send({ username: 'linandi', password: 'correcthorsebattery2' });
  assert.strictEqual(added.status, 201);

  const removed = await request(app).delete(`/api/admins/${onlyAdminId}`).set('Cookie', cookie);
  assert.strictEqual(removed.status, 200);
});

test('settings PUT/GET round-trip has no adminPassword field anymore', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const put = await request(app).put('/api/settings').set('Cookie', cookie).send({ siteName: 'New Name' });
  assert.strictEqual(put.body.settings.siteName, 'New Name');
  assert.strictEqual(put.body.settings.adminPassword, undefined);
  assert.strictEqual(put.body.settings.adminPasswordHash, undefined);
});

// -- Fix-round regression tests (reviewer findings on Task 10) --------------

test('GET /api/products never returns a filament-kind row, even one injected directly into catalog.json', async (t) => {
  const { app, cleanup, tmpRoot } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const createdCategory = await request(app).post('/api/products').set('Cookie', cookie).send({ name: 'Category A' });
  assert.strictEqual(createdCategory.status, 201);
  const categoryId = createdCategory.body.product.id;

  // Simulate a stray filament-kind row surviving in catalog.json (e.g. a
  // failed/skipped migration) by writing one directly into the file,
  // bypassing the API's write-path kind:'category' guard entirely. Uses
  // tmpRoot (captured before any chdir race) rather than process.cwd().
  const catalogPath = path.join(tmpRoot, 'data', 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const strayId = 'stray-filament-id';
  catalog.products.push({ id: strayId, kind: 'filament', name: 'Stray Filament', slug: 'stray-filament' });
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));

  const list = await request(app).get('/api/products').set('Cookie', cookie);
  assert.strictEqual(list.body.products.some((p) => p.id === strayId), false);
  assert.strictEqual(list.body.products.some((p) => p.id === categoryId), true);

  const single = await request(app).get(`/api/products/${strayId}`).set('Cookie', cookie);
  assert.strictEqual(single.status, 404);
});

test('removing an admin revokes their live session', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const loginJohan = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const johanCookie = loginJohan.headers['set-cookie'];

  await request(app).post('/api/admins').set('Cookie', johanCookie).send({ username: 'linandi', password: 'correcthorsebattery2' });
  const loginLinandi = await request(app).post('/api/auth/login').send({ username: 'linandi', password: 'correcthorsebattery2' });
  const linandiCookie = loginLinandi.headers['set-cookie'];

  const list = await request(app).get('/api/admins').set('Cookie', johanCookie);
  const linandiId = list.body.admins.find((a) => a.username === 'linandi').id;

  // sanity check: linandi's session works before removal
  const before = await request(app).get('/api/filaments').set('Cookie', linandiCookie);
  assert.strictEqual(before.status, 200);

  await request(app).delete(`/api/admins/${linandiId}`).set('Cookie', johanCookie);

  const after = await request(app).get('/api/filaments').set('Cookie', linandiCookie);
  assert.strictEqual(after.status, 401);
});

test('resetting an admin password revokes their live session', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const loginJohan = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const johanCookie = loginJohan.headers['set-cookie'];

  await request(app).post('/api/admins').set('Cookie', johanCookie).send({ username: 'linandi', password: 'correcthorsebattery2' });
  const loginLinandi = await request(app).post('/api/auth/login').send({ username: 'linandi', password: 'correcthorsebattery2' });
  const linandiCookie = loginLinandi.headers['set-cookie'];

  const list = await request(app).get('/api/admins').set('Cookie', johanCookie);
  const linandiId = list.body.admins.find((a) => a.username === 'linandi').id;

  await request(app)
    .post(`/api/admins/${linandiId}/reset-password`)
    .set('Cookie', johanCookie)
    .send({ password: 'brandnewpassword1' });

  const after = await request(app).get('/api/filaments').set('Cookie', linandiCookie);
  assert.strictEqual(after.status, 401);
});

test('a session older than 12h is rejected server-side even with a valid cookie', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });

  const realNow = Date.now;
  const THIRTEEN_HOURS_AGO = Date.now() - 13 * 60 * 60 * 1000;
  Date.now = () => THIRTEEN_HOURS_AGO;
  let login;
  try {
    login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  } finally {
    Date.now = realNow;
  }
  assert.strictEqual(login.status, 200);
  const cookie = login.headers['set-cookie'];

  const res = await request(app).get('/api/filaments').set('Cookie', cookie);
  assert.strictEqual(res.status, 401);
});

// -- Final-review fix-wave regression tests ---------------------------------

test('duplicate filament slug returns clean 400 JSON, not a raw 500 HTML page', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const first = await request(app).post('/api/filaments').set('Cookie', cookie).send({ name: 'PLA', slug: 'pla' });
  assert.strictEqual(first.status, 201);

  const dup = await request(app).post('/api/filaments').set('Cookie', cookie).send({ name: 'PLA Again', slug: 'pla' });
  assert.strictEqual(dup.status, 400);
  assert.match(dup.headers['content-type'], /json/);
  assert.match(dup.body.error, /slug/i);
});

test('updating a filament to a slug that collides with another filament returns clean 400 JSON, not a raw 500 HTML page', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  await request(app).post('/api/filaments').set('Cookie', cookie).send({ name: 'PLA', slug: 'pla' });
  const second = await request(app).post('/api/filaments').set('Cookie', cookie).send({ name: 'PETG', slug: 'petg' });
  const secondId = second.body.filament.id;

  const dup = await request(app).put(`/api/filaments/${secondId}`).set('Cookie', cookie).send({ slug: 'pla' });
  assert.strictEqual(dup.status, 400);
  assert.match(dup.headers['content-type'], /json/);
  assert.match(dup.body.error, /slug/i);
});

test('duplicate colour SKU (on create and on update) returns clean 400 JSON, not a raw 500 HTML page', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const filament = await request(app).post('/api/filaments').set('Cookie', cookie).send({ name: 'PLA' });
  const filamentId = filament.body.filament.id;

  const first = await request(app)
    .post(`/api/filaments/${filamentId}/colours`)
    .set('Cookie', cookie)
    .send({ name: 'White', sku: 'SKU-1' });
  assert.strictEqual(first.status, 201);

  const dupCreate = await request(app)
    .post(`/api/filaments/${filamentId}/colours`)
    .set('Cookie', cookie)
    .send({ name: 'Off-White', sku: 'SKU-1' });
  assert.strictEqual(dupCreate.status, 400);
  assert.match(dupCreate.headers['content-type'], /json/);
  assert.match(dupCreate.body.error, /sku/i);

  const second = await request(app)
    .post(`/api/filaments/${filamentId}/colours`)
    .set('Cookie', cookie)
    .send({ name: 'Black', sku: 'SKU-2' });
  const secondColourId = second.body.filament.colours.find((c) => c.sku === 'SKU-2').id;

  const dupUpdate = await request(app)
    .put(`/api/filaments/${filamentId}/colours/${secondColourId}`)
    .set('Cookie', cookie)
    .send({ sku: 'SKU-1' });
  assert.strictEqual(dupUpdate.status, 400);
  assert.match(dupUpdate.headers['content-type'], /json/);
  assert.match(dupUpdate.body.error, /sku/i);
});

test('uploading an image over the 5MB limit returns clean 400 JSON, not a raw 500 HTML page', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const filament = await request(app).post('/api/filaments').set('Cookie', cookie).send({ name: 'PLA' });
  const filamentId = filament.body.filament.id;
  const colour = await request(app)
    .post(`/api/filaments/${filamentId}/colours`)
    .set('Cookie', cookie)
    .send({ name: 'White', sku: 'SKU-1' });
  const colourId = colour.body.filament.colours[0].id;

  const oversized = Buffer.alloc(6 * 1024 * 1024, 1); // 6MB, over uploads.js's 5MB limit
  const res = await request(app)
    .post(`/api/filaments/${filamentId}/colours/${colourId}/image`)
    .set('Cookie', cookie)
    .attach('image', oversized, { filename: 'big.jpg', contentType: 'image/jpeg' });

  assert.strictEqual(res.status, 400);
  assert.match(res.headers['content-type'], /json/);
  assert.match(res.body.error, /5MB/i);
});

test('PUT /api/settings with a non-array homeTiles is rejected/ignored instead of 500ing', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app).put('/api/settings').set('Cookie', cookie).send({ homeTiles: { a: 1 } });
  assert.strictEqual(res.status, 200);
});

test('PUT /api/settings with a homeTiles array containing a null/non-object element is defaulted instead of 500ing', async (t) => {
  // Regression test: the array-level Array.isArray(patch.homeTiles) guard
  // only checks the array itself -- an element like `null` inside it still
  // crashes when the code reads `.eyebrow`/`.title`/`.description` off it.
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app)
    .put('/api/settings')
    .set('Cookie', cookie)
    .send({ homeTiles: [null, 'not an object', { eyebrow: 'Real', title: 'Tile', description: 'Kept' }] });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.settings.homeTiles, [
    { eyebrow: '', title: '', description: '' },
    { eyebrow: '', title: '', description: '' },
    { eyebrow: 'Real', title: 'Tile', description: 'Kept' },
  ]);
});

test('PUT /api/products/:id only persists allowlisted fields, not arbitrary request-body keys', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const created = await request(app).post('/api/products').set('Cookie', cookie).send({ name: 'Category A' });
  const productId = created.body.product.id;

  const updated = await request(app)
    .put(`/api/products/${productId}`)
    .set('Cookie', cookie)
    .send({ name: 'Category A', evilKey: 'malicious value', __proto__: { polluted: true } });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.product.evilKey, undefined);

  const refetched = await request(app).get(`/api/products/${productId}`).set('Cookie', cookie);
  assert.strictEqual(refetched.body.product.evilKey, undefined);
});

test('PUT /api/products/:id touching only one field preserves status/featured/sortOrder/SEO fields', async (t) => {
  // Regression test: upsertProduct() in store.js does a full-record
  // replacement, not a merge, so any field the PUT allowlist omits is
  // silently deleted on every save -- not just left alone. This proves a
  // PUT that only intends to change `description` doesn't wipe out the
  // other real, editable category-product fields.
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const created = await request(app).post('/api/products').set('Cookie', cookie).send({ name: 'Category A' });
  const productId = created.body.product.id;

  // Seed all the fields under test via a PUT (POST /api/products doesn't
  // accept them yet), then confirm they actually landed.
  const seeded = await request(app)
    .put(`/api/products/${productId}`)
    .set('Cookie', cookie)
    .send({
      name: 'Category A',
      description: 'original description',
      status: 'published',
      featured: true,
      sortOrder: 7,
      seoTitle: 'Original SEO title',
      seoDescription: 'Original SEO description',
      internalNotes: 'do not show to customers',
    });
  assert.strictEqual(seeded.status, 200);
  assert.strictEqual(seeded.body.product.status, 'published');
  assert.strictEqual(seeded.body.product.featured, true);
  assert.strictEqual(seeded.body.product.sortOrder, 7);

  // Now touch only `description` -- everything else must survive.
  const updated = await request(app)
    .put(`/api/products/${productId}`)
    .set('Cookie', cookie)
    .send({ description: 'new description' });
  assert.strictEqual(updated.status, 200);
  const product = updated.body.product;
  assert.strictEqual(product.description, 'new description');
  assert.strictEqual(product.status, 'published');
  assert.strictEqual(product.featured, true);
  assert.strictEqual(product.sortOrder, 7);
  assert.strictEqual(product.seoTitle, 'Original SEO title');
  assert.strictEqual(product.seoDescription, 'Original SEO description');
  assert.strictEqual(product.internalNotes, 'do not show to customers');

  const refetched = await request(app).get(`/api/products/${productId}`).set('Cookie', cookie);
  assert.strictEqual(refetched.body.product.status, 'published');
  assert.strictEqual(refetched.body.product.featured, true);
  assert.strictEqual(refetched.body.product.sortOrder, 7);
  assert.strictEqual(refetched.body.product.seoTitle, 'Original SEO title');
  assert.strictEqual(refetched.body.product.seoDescription, 'Original SEO description');
  assert.strictEqual(refetched.body.product.internalNotes, 'do not show to customers');
});

test('login with a missing or non-string password returns 401, not 500', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });

  const missing = await request(app).post('/api/auth/login').send({ username: 'johan' });
  assert.strictEqual(missing.status, 401);

  const nonString = await request(app).post('/api/auth/login').send({ username: 'johan', password: 12345678 });
  assert.strictEqual(nonString.status, 401);
});
