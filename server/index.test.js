import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { closeAllCachedDbs } from './db.js';

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

test('login with a missing or non-string password returns 401, not 500', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });

  const missing = await request(app).post('/api/auth/login').send({ username: 'johan' });
  assert.strictEqual(missing.status, 401);

  const nonString = await request(app).post('/api/auth/login').send({ username: 'johan', password: 12345678 });
  assert.strictEqual(nonString.status, 401);
});
