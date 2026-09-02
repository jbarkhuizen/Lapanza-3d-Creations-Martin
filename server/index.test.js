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
  fs.mkdirSync(path.join(tmpRoot, 'server'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'admin', 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(tmpRoot, 'README.md'), '# Test application\n\nTest application documentation.');
  fs.writeFileSync(path.join(tmpRoot, 'docs', 'GUIDE.md'), '# Test guide\n\nTest guide documentation.');
  fs.writeFileSync(
    path.join(tmpRoot, 'server', 'sample.test.js'),
    "import { test } from 'node:test';\ntest('sample test passes', () => {});\n",
  );
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

test('session cookie carries Secure over HTTPS, not over plain-HTTP dev, and responses carry baseline security headers', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });

  // trust proxy is set, so X-Forwarded-Proto https marks the request secure --
  // exactly what nginx sends in production.
  const httpsLogin = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-Proto', 'https')
    .send({ username: 'johan', password: 'correcthorsebattery' });
  assert.strictEqual(httpsLogin.status, 200);
  assert.match(String(httpsLogin.headers['set-cookie']), /Secure/, 'HTTPS login must set a Secure cookie');
  assert.match(String(httpsLogin.headers['strict-transport-security'] || ''), /max-age=/, 'HTTPS responses must carry HSTS');

  const httpLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  assert.strictEqual(httpLogin.status, 200);
  assert.doesNotMatch(String(httpLogin.headers['set-cookie']), /Secure/, 'plain-HTTP local dev must still get a usable cookie');
  assert.strictEqual(httpLogin.headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(httpLogin.headers['x-frame-options'], 'DENY');
});

test('/api/auth/me applies the session TTL, not just token existence', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const live = await request(app).get('/api/auth/me').set('Cookie', cookie);
  assert.strictEqual(live.body.authenticated, true);

  const missing = await request(app).get('/api/auth/me');
  assert.strictEqual(missing.body.authenticated, false);
});

test('version history detail endpoint returns Git-backed release details to an admin', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];
  const db = getDb();
  db.prepare(
    `INSERT INTO version_history (id, version_number, version_label, description, deployed_date, deployed_by, created_at)
     VALUES ('release-1', 1, '0.01', 'Release test', datetime('now'), 'deploy', datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO version_release_details (
       version_id, commit_hash, commit_range, release_notes, commits_json, files_json, files_added, files_deleted, captured_at
     ) VALUES (
       'release-1', 'abc123', 'abc123', 'Release test notes', '[]', '[]', 4, 1, datetime('now')
     )`,
  ).run();

  const res = await request(app).get('/api/version-history/release-1').set('Cookie', cookie);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.version.version_label, '0.01');
  assert.strictEqual(res.body.releaseDetails.commitHash, 'abc123');
  assert.strictEqual(res.body.releaseDetails.filesAdded, 4);
});

test('documentation and selected test cases are available to an authenticated admin', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const documents = await request(app).get('/api/documentation').set('Cookie', cookie);
  assert.strictEqual(documents.status, 200);
  const guide = documents.body.documents.find((document) => document.path === 'docs/GUIDE.md');
  const guideResponse = await request(app).get(`/api/documentation/${guide.id}`).set('Cookie', cookie);
  assert.strictEqual(guideResponse.status, 200);
  assert.match(guideResponse.text, /Test guide/);

  const catalog = await request(app).get('/api/test-cases').set('Cookie', cookie);
  assert.strictEqual(catalog.status, 200);
  assert.strictEqual(catalog.body.cases.length, 1);
  const started = await request(app).post('/api/test-runs').set('Cookie', cookie).send({ scope: 'selected', testCaseIds: [catalog.body.cases[0].id] });
  assert.strictEqual(started.status, 202);
  let result = started.body.run;
  for (let i = 0; i < 20 && result.status === 'running'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    result = (await request(app).get(`/api/test-runs/${result.id}`).set('Cookie', cookie)).body.run;
  }
  assert.strictEqual(result.status, 'passed');
  assert.strictEqual(result.passed_count, 1);
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

// Regression: PUT /api/inventory (Stock Management's own bulk "Save
// Changes") was the one catalog-mutating route left that never called
// publishCatalog() -- a filament colour's stock/price edit here was a bare
// SQL write with no JSON export and no static-page regen, so it looked
// saved in the admin but never reached the live site. Every other
// mutating route in this file always calls publishCatalog(), which -- in
// this sandboxed test cwd, with no real scripts/generate-pages.mjs to run
// -- always resolves to a publishWarning string rather than throwing. That
// makes the presence of a publishWarning key here the observable proof
// that publishCatalog() actually ran; before the fix, this response never
// carried that key at all, regardless of outcome.
test('PUT /api/inventory publishes after a stock/price edit, same as every other catalog-mutating route (#inventory-publish-gap)', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const created = await request(app).post('/api/filaments').set('Cookie', cookie).send({ name: 'PLA', slug: 'pla' });
  const filamentId = created.body.filament.id;
  const withColour = await request(app)
    .post(`/api/filaments/${filamentId}/colours`)
    .set('Cookie', cookie)
    .send({ name: 'White', sku: 'SKU-1', priceRand: 299, weightG: 1000, stockQty: 5 });
  const colourId = withColour.body.filament.colours[0].id;

  const res = await request(app)
    .put('/api/inventory')
    .set('Cookie', cookie)
    .send({ updates: [{ kind: 'filament', id: colourId, parentId: filamentId, stockQty: 3 }] });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.results[0].ok, true);
  assert.ok(typeof res.body.publishWarning === 'string' && res.body.publishWarning.length > 0, 'publishCatalog() must run after a successful inventory update');

  // A row that fails validation (negative stock) makes no real change, so
  // no publish should be attempted for it.
  const rejected = await request(app)
    .put('/api/inventory')
    .set('Cookie', cookie)
    .send({ updates: [{ kind: 'filament', id: colourId, parentId: filamentId, stockQty: -1 }] });
  assert.strictEqual(rejected.body.results[0].ok, false);
  assert.strictEqual(rejected.body.publishWarning, undefined);
});

// Regression: the documented backup-restore procedure (deploy/DEPLOY.md
// §10) only ever restored data/lapanza.db -- it never mentioned the
// paired data/catalog.json snapshot every backup already takes (category
// items live only in that file, not SQLite), so a real restore silently
// left the catalog at whatever it was moments before, with no publish
// afterward either. POST /api/backups/:filename/restore-catalog closes
// that gap for the half of a restore that doesn't require stopping the
// service.
test('POST /api/backups/:filename/restore-catalog restores the pre-backup catalog state and republishes (#backup-restore-gap)', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const created = await request(app)
    .post('/api/products')
    .set('Cookie', cookie)
    .send({ name: 'Original Name', slug: 'toy', items: [{ name: 'Item A' }] });
  assert.strictEqual(created.status, 201);
  const productId = created.body.product.id;

  const backup = await request(app).post('/api/backups').set('Cookie', cookie);
  assert.strictEqual(backup.status, 201);
  assert.strictEqual(backup.body.backup.catalogIncluded, true);

  // Catalog changes after the backup -- what the restore must undo.
  const renamed = await request(app).put(`/api/products/${productId}`).set('Cookie', cookie).send({ name: 'Changed After Backup' });
  assert.strictEqual(renamed.body.product.name, 'Changed After Backup');

  const restore = await request(app).post(`/api/backups/${backup.body.backup.filename}/restore-catalog`).set('Cookie', cookie);
  assert.strictEqual(restore.status, 200);
  assert.strictEqual(restore.body.ok, true);
  assert.ok(typeof restore.body.publishWarning === 'string' && restore.body.publishWarning.length > 0, 'publishCatalog() must run after a catalog restore, same as every other catalog-mutating route');

  const afterRestore = await request(app).get(`/api/products/${productId}`).set('Cookie', cookie);
  assert.strictEqual(afterRestore.body.product.name, 'Original Name', 'the pre-backup catalog state must be restored');

  const audit = await request(app).get('/api/audit-log').set('Cookie', cookie);
  assert.ok(
    audit.body.entries.some((e) => e.eventType === 'catalog_updated' && e.detail?.includes('Restored category-item catalog')),
    'the restore must be audit-logged',
  );

  const missing = await request(app).post('/api/backups/does-not-exist.db/restore-catalog').set('Cookie', cookie);
  assert.strictEqual(missing.status, 400);
  assert.match(missing.body.error, /No catalog snapshot found/);
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

test('uploading a print job model file/photo records the original filename, not just the randomized storage name', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const filament = await request(app).post('/api/in-house-filament').set('Cookie', cookie).send({
    filamentType: 'PLA', colorName: 'Black', rollsAvailable: 5, weightG: 1000, rollLengthM: 335, costPerRollRand: 300,
  });
  const job = await request(app)
    .post('/api/print-jobs')
    .set('Cookie', cookie)
    .send({ itemName: 'Joint Box 8x5', filaments: [{ inHouseFilamentId: filament.body.filament.id, grams: 40, meters: 13.4 }] });
  const jobId = job.body.printJob.id;

  const fileRes = await request(app)
    .post(`/api/print-jobs/${jobId}/file`)
    .set('Cookie', cookie)
    .attach('file', Buffer.from('fake 3mf content'), { filename: 'Joint Box 8x5.3mf', contentType: 'application/octet-stream' });
  assert.strictEqual(fileRes.status, 200);
  assert.strictEqual(fileRes.body.printJob.referenceFileOriginalName, 'Joint Box 8x5.3mf');
  // Storage path is still the randomized name, not the original -- uploads.js
  // deliberately never trusts a client-supplied filename for the disk path.
  assert.doesNotMatch(fileRes.body.printJob.referenceFilePath, /Joint Box/);

  const imageRes = await request(app)
    .post(`/api/print-jobs/${jobId}/image`)
    .set('Cookie', cookie)
    .attach('image', Buffer.from('fake jpeg content'), { filename: 'bench photo.jpg', contentType: 'image/jpeg' });
  assert.strictEqual(imageRes.status, 200);
  assert.strictEqual(imageRes.body.printJob.referenceImageOriginalName, 'bench photo.jpg');

  const fetched = await request(app).get(`/api/print-jobs/${jobId}`).set('Cookie', cookie);
  assert.strictEqual(fetched.body.printJob.referenceFileOriginalName, 'Joint Box 8x5.3mf');
  assert.strictEqual(fetched.body.printJob.referenceImageOriginalName, 'bench photo.jpg');
});

test('category product items support photo upload/remove and a "listed" visibility flag', async (t) => {
  const { app, tmpRoot, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const created = await request(app)
    .post('/api/products')
    .set('Cookie', cookie)
    .send({ name: 'GWM', parent: 'car-parts', items: [{ name: 'Rear Floor Clip Cup Holder' }] });
  const productId = created.body.product.id;
  const itemId = created.body.product.items[0].id;

  // New items default to listed (visible) -- matches scripts/generate-pages.mjs's
  // `item.listed !== false` filter and the existing `available` default.
  assert.strictEqual(created.body.product.items[0].listed, true);

  const uploadRes = await request(app)
    .post(`/api/products/${productId}/items/${itemId}/image`)
    .set('Cookie', cookie)
    .attach('image', Buffer.from('fake jpeg content'), { filename: 'cup holder.jpg', contentType: 'image/jpeg' });
  assert.strictEqual(uploadRes.status, 200);
  const uploadedItem = uploadRes.body.product.items.find((i) => i.id === itemId);
  assert.match(uploadedItem.imageUrl, /^\/uploads\/category-items\//);

  // syncPublicJson() must run on every product/item mutation, or an admin's
  // edits would silently never reach src/data/categories.json (the file the
  // next `npm run build` actually reads) until some unrelated filament edit
  // happened to trigger a sync.
  const categoriesSrc = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'src', 'data', 'categories.json'), 'utf8'));
  const syncedItem = categoriesSrc['gwm'].items.find((i) => i.name === 'Rear Floor Clip Cup Holder');
  assert.match(syncedItem.imageUrl, /^\/uploads\/category-items\//);
  assert.strictEqual(syncedItem.listed, true);

  const putRes = await request(app)
    .put(`/api/products/${productId}`)
    .set('Cookie', cookie)
    .send({ items: [{ ...uploadedItem, listed: false }] });
  assert.strictEqual(putRes.body.product.items[0].listed, false);
  const categoriesAfterHide = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'src', 'data', 'categories.json'), 'utf8'));
  assert.strictEqual(categoriesAfterHide['gwm'].items.find((i) => i.name === 'Rear Floor Clip Cup Holder').listed, false);

  const removeRes = await request(app).delete(`/api/products/${productId}/items/${itemId}/image`).set('Cookie', cookie);
  assert.strictEqual(removeRes.status, 200);
  assert.strictEqual(removeRes.body.product.items.find((i) => i.id === itemId).imageUrl, '');
});

test('category product items support creator/models (car-parts only) and keep sourceUrl out of the public export', async (t) => {
  const { app, tmpRoot, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const created = await request(app)
    .post('/api/products')
    .set('Cookie', cookie)
    .send({
      name: 'Landrover',
      parent: 'car-parts',
      items: [{
        name: 'Door Card Clip',
        sku: 'Part0009',
        creator: 'Louis Roesch',
        models: ['Defender 200 Tdi', 'Defender 300 Tdi'],
        sourceUrl: 'https://lr3dparts.com/parts/door-card-clip',
      }],
    });
  const product = created.body.product;
  assert.strictEqual(product.items[0].creator, 'Louis Roesch');
  assert.deepStrictEqual(product.items[0].models, ['Defender 200 Tdi', 'Defender 300 Tdi']);
  assert.strictEqual(product.items[0].sourceUrl, 'https://lr3dparts.com/parts/door-card-clip');

  const categoriesSrc = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'src', 'data', 'categories.json'), 'utf8'));
  const syncedItem = categoriesSrc['landrover'].items.find((i) => i.sku === 'Part0009');
  assert.strictEqual(syncedItem.creator, 'Louis Roesch');
  assert.deepStrictEqual(syncedItem.models, ['Defender 200 Tdi', 'Defender 300 Tdi']);
  // Admin-only reference back to the design's source page -- never shipped
  // to the customer-facing categories.json export.
  assert.strictEqual(syncedItem.sourceUrl, undefined);
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

test('PUT /api/settings persists inHouseFilamentBrands -- previously allowlist-missing, silently discarded', async (t) => {
  // Regression test: this field had a textarea in the admin UI and looked
  // saveable, but was never in the PUT /api/settings allowlist, so every
  // edit was silently dropped before it ever reached updateSettings().
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app)
    .put('/api/settings')
    .set('Cookie', cookie)
    .send({ inHouseFilamentBrands: [{ id: 'sunlu', name: 'SunLu', active: true }] });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.settings.inHouseFilamentBrands, [{ id: 'sunlu', name: 'SunLu', active: true }]);

  const getRes = await request(app).get('/api/settings').set('Cookie', cookie);
  assert.deepStrictEqual(getRes.body.settings.inHouseFilamentBrands, [{ id: 'sunlu', name: 'SunLu', active: true }]);
});

test('PUT /api/settings persists carPartModelsLandrover/carPartModelsGwm -- same allowlist-missing bug, caught during the add-flow browser test that added them', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app)
    .put('/api/settings')
    .set('Cookie', cookie)
    .send({
      carPartModelsLandrover: [{ id: 'defender-200-tdi', name: 'Defender 200 Tdi', active: true }],
      carPartModelsGwm: [{ id: 'p300', name: 'P300', active: true }],
    });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.settings.carPartModelsLandrover, [{ id: 'defender-200-tdi', name: 'Defender 200 Tdi', active: true }]);
  assert.deepStrictEqual(res.body.settings.carPartModelsGwm, [{ id: 'p300', name: 'P300', active: true }]);

  const getRes = await request(app).get('/api/settings').set('Cookie', cookie);
  assert.deepStrictEqual(getRes.body.settings.carPartModelsGwm, [{ id: 'p300', name: 'P300', active: true }]);
});

test('PUT /api/settings persists featuredProducts, including sanitizing malformed entries', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app)
    .put('/api/settings')
    .set('Cookie', cookie)
    .send({
      featuredProducts: [
        { productId: 'category:toys:UNO', active: true },
        { productId: '' }, // dropped -- no productId to feature
        null, // dropped -- not even an object
      ],
    });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.settings.featuredProducts.length, 1);
  assert.strictEqual(res.body.settings.featuredProducts[0].productId, 'category:toys:UNO');
  assert.strictEqual(res.body.settings.featuredProducts[0].active, true);
  assert.ok(res.body.settings.featuredProducts[0].id);

  const getRes = await request(app).get('/api/settings').set('Cookie', cookie);
  assert.strictEqual(getRes.body.settings.featuredProducts.length, 1);
});

test('PUT /api/settings persists an edited emailTemplates entry and keeps every other template at its default', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app)
    .put('/api/settings')
    .set('Cookie', cookie)
    .send({ emailTemplates: { passwordReset: { subject: 'Custom subject', message: 'Custom message body.' } } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.settings.emailTemplates.passwordReset.subject, 'Custom subject');
  assert.strictEqual(res.body.settings.emailTemplates.passwordReset.message, 'Custom message body.');
  // Only passwordReset was sent -- every other template must still be
  // present with real copy, not wiped out by a shallow-merge/overwrite.
  assert.ok(res.body.settings.emailTemplates.orderConfirmation.subject);
  assert.ok(res.body.settings.emailTemplates.newDesignRequestNotification.message);

  const getRes = await request(app).get('/api/settings').set('Cookie', cookie);
  assert.strictEqual(getRes.body.settings.emailTemplates.passwordReset.subject, 'Custom subject');
  assert.ok(getRes.body.settings.emailTemplates.orderConfirmation.subject);
});

test('PUT /api/settings falls back to the default subject/message for a blank or malformed emailTemplates entry instead of saving an empty email', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app)
    .put('/api/settings')
    .set('Cookie', cookie)
    .send({ emailTemplates: { passwordReset: { subject: '   ', message: '' }, unknownKey: { subject: 'x', message: 'y' } } });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.settings.emailTemplates.passwordReset.subject.trim());
  assert.ok(res.body.settings.emailTemplates.passwordReset.message.trim());
  assert.strictEqual(res.body.settings.emailTemplates.unknownKey, undefined);
});

test('PUT /api/settings with a non-object emailTemplates is rejected/ignored instead of 500ing', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app).put('/api/settings').set('Cookie', cookie).send({ emailTemplates: 'not an object' });
  assert.strictEqual(res.status, 200);
});

test('POST /api/todos defaults createdBy to the logged-in admin, but an explicit createdBy (Claude) wins', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const humanRes = await request(app).post('/api/todos').set('Cookie', cookie).send({ name: 'Typed by the owner' });
  assert.strictEqual(humanRes.status, 201);
  assert.strictEqual(humanRes.body.todo.createdBy, 'johan');

  const claudeRes = await request(app).post('/api/todos').set('Cookie', cookie).send({ name: 'Logged by Claude', createdBy: 'Claude' });
  assert.strictEqual(claudeRes.status, 201);
  assert.strictEqual(claudeRes.body.todo.createdBy, 'Claude');
});

test('PUT /api/settings sanitizes a configurable list: malformed entries dropped, active defaults true, missing id backfilled', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app)
    .put('/api/settings')
    .set('Cookie', cookie)
    .send({ todoCategories: [null, { name: 'Spike' }, { name: '  ' }, { id: 'x', name: 'Retired', active: false }] });
  assert.strictEqual(res.status, 200);
  const saved = res.body.settings.todoCategories;
  assert.strictEqual(saved.length, 2);
  assert.strictEqual(saved[0].name, 'Spike');
  assert.strictEqual(saved[0].active, true);
  assert.ok(saved[0].id);
  assert.deepStrictEqual(saved[1], { id: 'x', name: 'Retired', active: false });
});

test('PUT /api/settings with a non-array configurable list is rejected/ignored instead of 500ing', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app).put('/api/settings').set('Cookie', cookie).send({ todoPriorities: 'not an array' });
  assert.strictEqual(res.status, 200);
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

test('POST /api/products defaults status/featured/sortOrder to real values, not undefined (#8 launch audit)', async (t) => {
  // Regression: this route used to build the new category from a fixed
  // {id, kind, slug, name, description, crumbs, parent, items} object,
  // silently dropping status/featured/sortOrder/SEO fields even though the
  // admin client sends status:'draft' on every create -- upsertProduct()
  // does a full-record replacement, so the field was simply never written,
  // and printed as literal "undefined" in the admin catalog badge.
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const defaulted = await request(app).post('/api/products').set('Cookie', cookie).send({ name: 'Category B' });
  assert.strictEqual(defaulted.body.product.status, 'draft');
  assert.strictEqual(defaulted.body.product.featured, false);
  assert.strictEqual(defaulted.body.product.sortOrder, 0);

  const explicit = await request(app)
    .post('/api/products')
    .set('Cookie', cookie)
    .send({ name: 'Category C', status: 'published', featured: true, sortOrder: 5, seoTitle: 'Custom title' });
  assert.strictEqual(explicit.body.product.status, 'published');
  assert.strictEqual(explicit.body.product.featured, true);
  assert.strictEqual(explicit.body.product.sortOrder, 5);
  assert.strictEqual(explicit.body.product.seoTitle, 'Custom title');

  const refetched = await request(app).get(`/api/products/${explicit.body.product.id}`).set('Cookie', cookie);
  assert.strictEqual(refetched.body.product.status, 'published');
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

  // Seed all the fields under test via a PUT (isolates this test from
  // whatever POST /api/products defaults to), then confirm they actually landed.
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

test('analytics: pageview beacon is recorded, heartbeat is not, both return 204, admin routes require auth', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = login.headers['set-cookie'];

  const unauthedActive = await request(app).get('/api/analytics/active');
  assert.strictEqual(unauthedActive.status, 401);
  const unauthedSummary = await request(app).get('/api/analytics/summary');
  assert.strictEqual(unauthedSummary.status, 401);

  const pageview = await request(app).post('/api/analytics/beacon').send({ visitorId: 'v1', path: '/toys.html', type: 'pageview' });
  assert.strictEqual(pageview.status, 204);
  const heartbeat = await request(app).post('/api/analytics/beacon').send({ visitorId: 'v1', path: '/toys.html', type: 'heartbeat' });
  assert.strictEqual(heartbeat.status, 204);
  // Malformed beacon (no visitorId) must never surface as a 400/500 to a
  // fire-and-forget client-side call that will never read the response.
  const malformed = await request(app).post('/api/analytics/beacon').send({ path: '/x', type: 'pageview' });
  assert.strictEqual(malformed.status, 204);

  const summary = await request(app).get('/api/analytics/summary').set('Cookie', adminCookie);
  assert.strictEqual(summary.status, 200);
  // Only the pageview should have persisted -- the heartbeat and the
  // malformed beacon must not appear in the historical count.
  assert.strictEqual(summary.body.totalVisits, 1);

  const active = await request(app).get('/api/analytics/active').set('Cookie', adminCookie);
  assert.strictEqual(active.status, 200);
  assert.strictEqual(active.body.totalActive, 1);
});

test('audit log records setup, login success/failure, and logout, newest first', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);

  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  await request(app).post('/api/auth/login').send({ username: 'johan', password: 'wrong-password' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];
  await request(app).post('/api/auth/logout').set('Cookie', cookie);

  // Route is itself behind requireAuth, so re-login to read the log back.
  const relog = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const freshCookie = relog.headers['set-cookie'];

  const res = await request(app).get('/api/audit-log').set('Cookie', freshCookie);
  assert.strictEqual(res.status, 200);
  const types = res.body.entries.map((e) => e.eventType);
  // Newest first: the second login (used to read this list) is on top.
  assert.strictEqual(types[0], 'login_success');
  assert.ok(types.includes('logout'));
  assert.ok(types.includes('login_failure'));
  assert.ok(types.includes('setup'));

  const failure = res.body.entries.find((e) => e.eventType === 'login_failure');
  assert.strictEqual(failure.username, 'johan');
});

test('audit log GET requires an admin session', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });

  const res = await request(app).get('/api/audit-log');
  assert.strictEqual(res.status, 401);
});

test('audit log filters by eventType and search text', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  await request(app).post('/api/auth/login').send({ username: 'johan', password: 'wrong-password' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const filtered = await request(app).get('/api/audit-log?eventType=login_failure').set('Cookie', cookie);
  assert.strictEqual(filtered.body.entries.length, 1);
  assert.strictEqual(filtered.body.entries[0].eventType, 'login_failure');

  const searched = await request(app).get('/api/audit-log?q=johan').set('Cookie', cookie);
  assert.ok(searched.body.entries.length >= 2);
  assert.ok(searched.body.entries.every((e) => e.username === 'johan'));
});

test('a failed outbound email is recorded to the audit log instead of only console.error -- this is what a broken Gmail app password looks like', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  // GMAIL_APP_PASSWORD is deliberately unset in the test env (mailer.js's
  // lazy-transporter comment) -- registering a client genuinely exercises
  // the real failure path, not a mock.
  const register = await request(app).post('/api/client/register').send({ firstName: 'New', lastName: 'Customer', email: 'newcustomer@example.com', password: 'correcthorsebattery' });
  assert.strictEqual(register.status, 201); // a failed verification email must never fail registration itself

  const res = await request(app).get('/api/audit-log?eventType=email_failure').set('Cookie', cookie);
  assert.strictEqual(res.body.entries.length, 1);
  assert.match(res.body.entries[0].detail, /Verification email/);
  assert.match(res.body.entries[0].detail, /GMAIL_APP_PASSWORD/);
});

test('registering an already-registered email returns the same generic success as a fresh signup (no enumeration)', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  const payload = { firstName: 'First', lastName: 'Owner', email: 'enum-probe@example.com', password: 'correcthorsebattery' };

  const first = await request(app).post('/api/client/register').send(payload);
  assert.strictEqual(first.status, 201);

  // Regression (launch-audit SEC-003): this used to answer 400 "already
  // exists", letting anyone probe which emails hold accounts -- login and
  // forgot-password were already generic, this was the one gap left.
  const second = await request(app).post('/api/client/register').send({ ...payload, firstName: 'Someone', lastName: 'Else', password: 'differentpassword' });
  assert.strictEqual(second.status, 201);
  assert.strictEqual(second.body.message, first.body.message);
});

test('POST /api/client/register requires first name and surname, and stores company name', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const noFirstName = await request(app).post('/api/client/register').send({ lastName: 'Buyer', email: 'a@example.com', password: 'correcthorsebattery' });
  assert.strictEqual(noFirstName.status, 400);
  assert.match(noFirstName.body.error, /first name/i);

  const noLastName = await request(app).post('/api/client/register').send({ firstName: 'Test', email: 'b@example.com', password: 'correcthorsebattery' });
  assert.strictEqual(noLastName.status, 400);
  assert.match(noLastName.body.error, /surname/i);

  // registerClient() itself stays lenient (many other callers/tests use it
  // as a minimal email+password fixture) -- this proves the requirement is
  // enforced at the public route, not silently bypassable by omission, and
  // that a supplied company name actually reaches the stored client record.
  const ok = await request(app).post('/api/client/register').send({
    firstName: 'Jane', lastName: 'Doe', businessName: 'Acme Co', email: 'jane@example.com', password: 'correcthorsebattery',
  });
  assert.strictEqual(ok.status, 201);
  const list = await request(app).get('/api/clients?q=jane@example.com').set('Cookie', cookie);
  assert.strictEqual(list.body.clients[0].businessName, 'Acme Co');
});

test('Payfast checkout does not send the order confirmation immediately -- only manual_eft/cash_on_collection do', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const filament = await request(app).post('/api/filaments').set('Cookie', cookie).send({ name: 'PLA', slug: 'pla' });
  const colour = await request(app)
    .post(`/api/filaments/${filament.body.filament.id}/colours`)
    .set('Cookie', cookie)
    .send({ name: 'Red', sku: 'PLA-RED', priceRand: 100, weightG: 100, stockQty: 10 });
  const productId = `filament:pla:${colour.body.filament.colours[0].sku}`;

  const checkoutPayload = (paymentMethod) => ({
    client: { firstName: 'Test', lastName: 'Buyer', email: 'buyer@example.com' },
    items: [{ productId, quantity: 1 }],
    shippingMethod: 'collect',
    paymentMethod,
  });

  const payfastRes = await request(app).post('/api/checkout').send(checkoutPayload('payfast_card'));
  assert.strictEqual(payfastRes.status, 201);
  assert.strictEqual(payfastRes.body.emailSent, false);
  assert.strictEqual(payfastRes.body.redirect.actionUrl.includes('payfast.co.za'), true);

  const manualRes = await request(app).post('/api/checkout').send(checkoutPayload('manual_eft'));
  assert.strictEqual(manualRes.status, 201);

  // Launch-audit #3: banking details ride only on the manual-EFT order
  // response (the success panel's one consumer) -- never the Payfast
  // response, and never the public settings file (covered in export.test.js).
  assert.strictEqual(manualRes.body.bankingDetails.bankName, 'Absa');
  assert.ok(manualRes.body.bankingDetails.accountNumber);
  assert.strictEqual(payfastRes.body.bankingDetails, undefined);

  const cocRes = await request(app).post('/api/checkout').send(checkoutPayload('cash_on_collection'));
  assert.strictEqual(cocRes.status, 201);
  assert.strictEqual(cocRes.body.bankingDetails, null, 'cash on collection needs no banking details');

  // GMAIL_APP_PASSWORD is deliberately unset in the test env, so a real send
  // attempt fails and is logged as email_failure -- that's how this test
  // distinguishes "attempted a confirmation email" from "correctly skipped
  // it because payment isn't confirmed yet" without needing a working SMTP
  // config. Matching on "Order <id> confirmation email" (the logEmailFailure
  // context string), not just the substring "confirmation email" -- the
  // underlying GMAIL_APP_PASSWORD error text itself contains that phrase
  // too, so every failed send (including the unrelated owner-notification
  // one both checkouts also trigger) would otherwise false-match.
  const audit = await request(app).get('/api/audit-log?eventType=email_failure').set('Cookie', cookie);
  const forOrder = (orderId) => audit.body.entries.filter((e) => e.detail.startsWith(`Order ${orderId} confirmation email`));
  assert.strictEqual(forOrder(manualRes.body.order.id).length, 1);
  assert.strictEqual(forOrder(payfastRes.body.order.id).length, 0);
});

// -- Backlog #120: actionable alerts for backup/email/payment failures -----

test('a checkout error (even an ordinary validation rejection) is always recorded to audit_log, previously logged nowhere at all', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app).post('/api/checkout').send({ client: { firstName: 'A', lastName: 'B', email: 'a@example.com' }, items: [], shippingMethod: 'collect', paymentMethod: 'manual_eft' });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /Cart is empty/);

  const audit = await request(app).get('/api/audit-log?eventType=checkout_error').set('Cookie', cookie);
  assert.strictEqual(audit.body.entries.length, 1);
  assert.match(audit.body.entries[0].detail, /Cart is empty/);
});

test('a Payfast ITN for an unknown order is recorded as a payment_failure audit event, previously console-only', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const itnRes = await request(app).post('/api/payfast/itn').type('form').send({ m_payment_id: 'does-not-exist', pf_payment_id: '123', payment_status: 'COMPLETE' });
  assert.strictEqual(itnRes.status, 200); // always 200 to Payfast regardless of outcome

  const audit = await request(app).get('/api/audit-log?eventType=payment_failure').set('Cookie', cookie);
  assert.strictEqual(audit.body.entries.length, 1);
  assert.match(audit.body.entries[0].detail, /Unknown order: does-not-exist/);
});

test('PUT /api/settings persists the new operational-alert keys', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app)
    .put('/api/settings')
    .set('Cookie', cookie)
    .send({
      alertBackupFailureEnabled: false,
      alertPaymentFailureEnabled: false,
      alertCheckoutErrorEnabled: false,
      alertEmailFallbackEnabled: true,
      alertEmailFallbackThreshold: 5,
      alertEmailFallbackWhatsappNumber: '27821234567',
      alertEmailFallbackWhatsappTemplateName: 'system_alert',
      alertSecuritySpikeEnabled: true,
      alertSecuritySpikeThreshold: 20,
      alertSecuritySpikeWindowMinutes: 30,
    });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.settings.alertBackupFailureEnabled, false);
  assert.strictEqual(res.body.settings.alertEmailFallbackThreshold, 5);
  assert.strictEqual(res.body.settings.alertEmailFallbackWhatsappNumber, '27821234567');
  assert.strictEqual(res.body.settings.alertSecuritySpikeWindowMinutes, 30);

  const getRes = await request(app).get('/api/settings').set('Cookie', cookie);
  assert.strictEqual(getRes.body.settings.alertCheckoutErrorEnabled, false);
});

test('GET /api/health/backups reports unhealthy (503) when no backups exist yet, unauthenticated (matches /api/health)', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  const res = await request(app).get('/api/health/backups');
  assert.strictEqual(res.status, 503);
  assert.match(res.body.error, /No backups exist yet/);
});

test('PUT /api/settings persists the backlog #78 contact fields (hours/whatsappResponseNote/escalationContactsNote)', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const res = await request(app)
    .put('/api/settings')
    .set('Cookie', cookie)
    .send({
      hours: 'Mon-Fri 9am-4pm',
      whatsappResponseNote: 'Within the hour, usually',
      escalationContactsNote: 'Call Jane on 000',
    });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.settings.hours, 'Mon-Fri 9am-4pm');
  assert.strictEqual(res.body.settings.whatsappResponseNote, 'Within the hour, usually');
  assert.strictEqual(res.body.settings.escalationContactsNote, 'Call Jane on 000');

  const getRes = await request(app).get('/api/settings').set('Cookie', cookie);
  assert.strictEqual(getRes.body.settings.whatsappResponseNote, 'Within the hour, usually');
});

// -- Backlog #51: admin-managed testimonials ---------------------------

test('POST /api/testimonials creates a draft by default and PUT can publish it once consent is recorded', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const created = await request(app)
    .post('/api/testimonials')
    .set('Cookie', cookie)
    .send({ customerName: 'Jane Real Name', displayName: 'Jane D.', quote: 'Loved the print quality.' });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.testimonial.status, 'draft');

  const publishAttempt = await request(app)
    .put(`/api/testimonials/${created.body.testimonial.id}`)
    .set('Cookie', cookie)
    .send({ status: 'published' });
  assert.strictEqual(publishAttempt.status, 400);
  assert.match(publishAttempt.body.error, /consent/i);

  const published = await request(app)
    .put(`/api/testimonials/${created.body.testimonial.id}`)
    .set('Cookie', cookie)
    .send({ status: 'published', consentGiven: true });
  assert.strictEqual(published.status, 200);
  assert.strictEqual(published.body.testimonial.status, 'published');
});

test('GET /api/testimonials?status=published only returns published ones, and the customer real name never leaves the admin API', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  await request(app).post('/api/testimonials').set('Cookie', cookie).send({ customerName: 'Draft Person', displayName: 'D.', quote: 'x' });
  await request(app)
    .post('/api/testimonials')
    .set('Cookie', cookie)
    .send({ customerName: 'Published Person', displayName: 'P.', quote: 'y', status: 'published', consentGiven: true });

  const res = await request(app).get('/api/testimonials?status=published').set('Cookie', cookie);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.testimonials.length, 1);
  assert.strictEqual(res.body.testimonials[0].displayName, 'P.');
});

test('DELETE /api/testimonials/:id removes it', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const created = await request(app).post('/api/testimonials').set('Cookie', cookie).send({ customerName: 'X', displayName: 'X.', quote: 'x' });
  const del = await request(app).delete(`/api/testimonials/${created.body.testimonial.id}`).set('Cookie', cookie);
  assert.strictEqual(del.status, 200);
  const get = await request(app).get(`/api/testimonials/${created.body.testimonial.id}`).set('Cookie', cookie);
  assert.strictEqual(get.status, 404);
});

test('POST /api/testimonials without auth is rejected', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  const res = await request(app).post('/api/testimonials').send({ customerName: 'X', displayName: 'X.', quote: 'x' });
  assert.strictEqual(res.status, 401);
});

test('potential-market CRUD roundtrip: create, list, inline status update via PUT, delete', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const created = await request(app)
    .post('/api/potential-market')
    .set('Cookie', cookie)
    .send({ name: 'Lead', surname: 'One', email: 'lead@example.com', mobileNumber: '0821234567' });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.contact.status, 'Initial Load');

  const list = await request(app).get('/api/potential-market').set('Cookie', cookie);
  assert.strictEqual(list.body.contacts.length, 1);

  const updated = await request(app)
    .put(`/api/potential-market/${created.body.contact.id}`)
    .set('Cookie', cookie)
    .send({ status: 'Active' });
  assert.strictEqual(updated.body.contact.status, 'Active');

  const filtered = await request(app).get('/api/potential-market?status=Active').set('Cookie', cookie);
  assert.strictEqual(filtered.body.contacts.length, 1);

  const del = await request(app).delete(`/api/potential-market/${created.body.contact.id}`).set('Cookie', cookie);
  assert.strictEqual(del.status, 200);
  const getAfterDelete = await request(app).get(`/api/potential-market/${created.body.contact.id}`).set('Cookie', cookie);
  assert.strictEqual(getAfterDelete.status, 404);
});

test('POST /api/potential-market without auth is rejected', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  const res = await request(app).post('/api/potential-market').send({ name: 'X', surname: 'Y' });
  assert.strictEqual(res.status, 401);
});

test('POST /api/potential-market/import creates new rows and skips a duplicate against an existing contact', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  await request(app).post('/api/potential-market').set('Cookie', cookie).send({ name: 'Existing', surname: 'Contact', email: 'existing@example.com' });

  const imported = await request(app)
    .post('/api/potential-market/import')
    .set('Cookie', cookie)
    .send({
      contacts: [
        { name: 'Existing', surname: 'Contact', email: 'existing@example.com' },
        { name: 'New', surname: 'Person', email: 'new@example.com' },
      ],
    });
  assert.strictEqual(imported.status, 200);
  assert.strictEqual(imported.body.created, 1);
  assert.strictEqual(imported.body.skipped, 1);

  const list = await request(app).get('/api/potential-market').set('Cookie', cookie);
  assert.strictEqual(list.body.contacts.length, 2);
});

test('deleting an admin and resetting a password are attributed to the acting admin and recorded', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const second = await request(app).post('/api/admins').set('Cookie', cookie).send({ username: 'martin', password: 'anothersafepassword' });
  assert.strictEqual(second.status, 201);

  await request(app).post(`/api/admins/${second.body.admin.id}/reset-password`).set('Cookie', cookie).send({ password: 'yetanothersafepass' });
  await request(app).delete(`/api/admins/${second.body.admin.id}`).set('Cookie', cookie);

  const res = await request(app).get('/api/audit-log').set('Cookie', cookie);
  const created = res.body.entries.find((e) => e.eventType === 'admin_created');
  const reset = res.body.entries.find((e) => e.eventType === 'password_reset');
  const deleted = res.body.entries.find((e) => e.eventType === 'admin_deleted');
  assert.ok(created && reset && deleted);
  // adminId/username on these events is the acting admin (johan), not the
  // admin account being acted on (martin) -- detail carries the target.
  assert.strictEqual(created.username, 'johan');
  assert.match(created.detail, /martin/);
  assert.strictEqual(reset.username, 'johan');
  assert.match(reset.detail, /martin/);
  assert.strictEqual(deleted.username, 'johan');
  assert.match(deleted.detail, /martin/);
});

test('tripping a rate limiter records rate_limit_exceeded instead of failing silently', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  // authLimiter allows 10 requests per window -- the setup+login calls above
  // already used 1, so 10 more wrong-password attempts trips it on the 10th.
  let tripped = null;
  for (let i = 0; i < 10; i++) {
    const res = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'wrong' });
    if (res.status === 429) tripped = res;
  }
  assert.ok(tripped, 'expected the limiter to trip within 10 attempts');

  const audit = await request(app).get('/api/audit-log?eventType=rate_limit_exceeded').set('Cookie', cookie);
  assert.ok(audit.body.entries.length >= 1);
  assert.match(audit.body.entries[0].detail, /authLimiter/);
});

test('hitting a protected admin route with no session cookie at all records unauthorized_access; a stale/unknown cookie does not', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  const noCookie = await request(app).get('/api/filaments');
  assert.strictEqual(noCookie.status, 401);

  const staleCookie = await request(app).get('/api/filaments').set('Cookie', 'lapanza_admin_session=not-a-real-token');
  assert.strictEqual(staleCookie.status, 401);

  const audit = await request(app).get('/api/audit-log?eventType=unauthorized_access').set('Cookie', cookie);
  assert.strictEqual(audit.body.entries.length, 1); // only the no-cookie-at-all request, not the stale-cookie one
});

test('a failed customer login records client_login_failure', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  await request(app).post('/api/client/register').send({ firstName: 'Test', lastName: 'Customer', email: 'customer@example.com', password: 'correcthorsebattery' });
  await request(app).post('/api/client/login').send({ email: 'customer@example.com', password: 'wrongpassword' });

  const audit = await request(app).get('/api/audit-log?eventType=client_login_failure').set('Cookie', cookie);
  assert.strictEqual(audit.body.entries.length, 1);
  assert.strictEqual(audit.body.entries[0].username, 'customer@example.com');
});

test('order status changes, inventory updates, catalog changes, and settings changes are all recorded', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const login = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const cookie = login.headers['set-cookie'];

  // Orders
  const filament = await request(app).post('/api/filaments').set('Cookie', cookie).send({ name: 'PLA', slug: 'pla' });
  const colour = await request(app)
    .post(`/api/filaments/${filament.body.filament.id}/colours`)
    .set('Cookie', cookie)
    .send({ name: 'White', sku: 'SKU-1', priceRand: 100, stockQty: 5 });
  const order = await request(app)
    .post('/api/orders')
    .set('Cookie', cookie)
    .send({
      client: { name: 'Buyer', email: 'buyer@example.com', phone: '0123456789' },
      items: [{ productId: 'filament:pla:SKU-1', quantity: 1 }],
      paymentMethod: 'cash_on_collection',
      alreadyPaid: false,
    });
  assert.strictEqual(order.status, 201);
  await request(app).put(`/api/orders/${order.body.order.id}/status`).set('Cookie', cookie).send({ status: 'cancelled' });

  // Stock/pricing
  await request(app).put('/api/inventory').set('Cookie', cookie).send({ updates: [{ kind: 'filament', id: colour.body.filament.colours[0].id, parentId: filament.body.filament.id, stockQty: 3 }] });

  // Catalog (filament delete, on top of the create above)
  await request(app).delete(`/api/filaments/${filament.body.filament.id}`).set('Cookie', cookie);

  // Settings
  await request(app).put('/api/settings').set('Cookie', cookie).send({ siteName: 'Renamed Lab' });

  const audit = await request(app).get('/api/audit-log').set('Cookie', cookie);
  const types = audit.body.entries.map((e) => e.eventType);
  assert.ok(types.includes('order_updated'));
  assert.ok(types.includes('stock_updated'));
  assert.ok(types.includes('catalog_updated'));
  assert.ok(types.includes('settings_updated'));

  const statusChange = audit.body.entries.find((e) => e.eventType === 'order_updated' && e.detail.includes('status'));
  assert.match(statusChange.detail, /pending_payment.*cancelled/i);

  const settingsChange = audit.body.entries.find((e) => e.eventType === 'settings_updated');
  assert.match(settingsChange.detail, /siteName/);
});

test('admin can disable/re-enable a registered client, blocking and restoring login via the real route', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  await request(app).post('/api/client/register').send({ firstName: 'Dis', lastName: 'Able', email: 'disable-route@example.com', password: 'correcthorsebattery' });
  const list = await request(app).get('/api/clients?q=disable-route@example.com').set('Cookie', adminCookie);
  const clientId = list.body.clients[0].id;
  await request(app).patch(`/api/clients/${clientId}/verify`).set('Cookie', adminCookie);

  const disableRes = await request(app).patch(`/api/clients/${clientId}/disabled`).set('Cookie', adminCookie).send({ disabled: true });
  assert.strictEqual(disableRes.status, 200);
  assert.strictEqual(disableRes.body.client.disabled, true);

  const blockedLogin = await request(app).post('/api/client/login').send({ email: 'disable-route@example.com', password: 'correcthorsebattery' });
  assert.strictEqual(blockedLogin.status, 403);
  assert.match(blockedLogin.body.error, /disabled/i);

  const enableRes = await request(app).patch(`/api/clients/${clientId}/disabled`).set('Cookie', adminCookie).send({ disabled: false });
  assert.strictEqual(enableRes.body.client.disabled, false);
  const restoredLogin = await request(app).post('/api/client/login').send({ email: 'disable-route@example.com', password: 'correcthorsebattery' });
  assert.strictEqual(restoredLogin.status, 200);

  const notFound = await request(app).patch('/api/clients/bogus-id/disabled').set('Cookie', adminCookie).send({ disabled: true });
  assert.strictEqual(notFound.status, 404);
});

test('admin can trigger a password reset email for a registered client', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  await request(app).post('/api/client/register').send({ firstName: 'Reset', lastName: 'Me', email: 'admin-reset@example.com', password: 'correcthorsebattery' });
  const list = await request(app).get('/api/clients?q=admin-reset@example.com').set('Cookie', adminCookie);
  const clientId = list.body.clients[0].id;

  // GMAIL_APP_PASSWORD is deliberately unset in the test env -- the send
  // itself fails, but the route must still resolve the client and attempt
  // it (a 404 here would mean the route never even found the client).
  const res = await request(app).post(`/api/clients/${clientId}/send-password-reset`).set('Cookie', adminCookie);
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /GMAIL_APP_PASSWORD/);

  const missing = await request(app).post('/api/clients/bogus-id/send-password-reset').set('Cookie', adminCookie);
  assert.strictEqual(missing.status, 404);
});

async function loggedInClientCookie(app, adminCookie, email) {
  await request(app).post('/api/client/register').send({ firstName: 'Test', lastName: 'Client', email, password: 'correcthorsebattery' });
  const list = await request(app).get(`/api/clients?q=${encodeURIComponent(email)}`).set('Cookie', adminCookie);
  const clientId = list.body.clients[0].id;
  await request(app).patch(`/api/clients/${clientId}/verify`).set('Cookie', adminCookie);
  const login = await request(app).post('/api/client/login').send({ email, password: 'correcthorsebattery' });
  return { clientId, cookie: login.headers['set-cookie'] };
}

test('a logged-in client can update their own details via PATCH /api/client/me, but not admin-only fields', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  const { cookie } = await loggedInClientCookie(app, adminCookie, 'selfservice@example.com');

  const me = await request(app).get('/api/client/me').set('Cookie', cookie);
  assert.strictEqual(me.body.authenticated, true);
  assert.strictEqual(me.body.client.email, 'selfservice@example.com');

  const update = await request(app)
    .patch('/api/client/me')
    .set('Cookie', cookie)
    .send({ firstName: 'Jane', lastName: 'Doe', city: 'Cape Town', discountPct: 50 });
  assert.strictEqual(update.status, 200);
  assert.strictEqual(update.body.client.firstName, 'Jane');
  assert.strictEqual(update.body.client.city, 'Cape Town');
  // discountPct is an admin-only business field (set from the admin Clients
  // view / manual orders) -- must never be reachable from a client's own
  // self-service session, even if they include it in the request body.
  assert.strictEqual(update.body.client.discountPct, 0);
});

test('PATCH /api/client/me is rejected without a client session', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  const res = await request(app).patch('/api/client/me').send({ firstName: 'Jane' });
  assert.strictEqual(res.status, 401);
});

test('client invoice route serves own orders only; tracking rides along in order history (#97)', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  const filament = await request(app).post('/api/filaments').set('Cookie', adminCookie).send({ name: 'PLA97', slug: 'pla97' });
  const colour = await request(app)
    .post(`/api/filaments/${filament.body.filament.id}/colours`)
    .set('Cookie', adminCookie)
    .send({ name: 'Red', sku: 'PLA97-RED', priceRand: 100, weightG: 100, stockQty: 10 });
  const productId = `filament:pla97:${colour.body.filament.colours[0].sku}`;

  const owner = await loggedInClientCookie(app, adminCookie, 'invoice-owner@example.com');
  const other = await loggedInClientCookie(app, adminCookie, 'invoice-other@example.com');

  const checkout = await request(app).post('/api/checkout').send({
    client: { firstName: 'Test', lastName: 'Client', email: 'invoice-owner@example.com' },
    items: [{ productId, quantity: 1 }],
    shippingMethod: 'collect',
    paymentMethod: 'manual_eft',
  });
  assert.strictEqual(checkout.status, 201);
  const orderId = checkout.body.orderId || checkout.body.order?.id;

  // Owner sees their invoice; another logged-in client gets a 404, never
  // someone else's document.
  const own = await request(app).get(`/api/client/orders/${orderId}/invoice`).set('Cookie', owner.cookie);
  assert.strictEqual(own.status, 200);
  assert.match(own.text, /Invoice|INV-/);
  const foreign = await request(app).get(`/api/client/orders/${orderId}/invoice`).set('Cookie', other.cookie);
  assert.strictEqual(foreign.status, 404);
  const anon = await request(app).get(`/api/client/orders/${orderId}/invoice`);
  assert.strictEqual(anon.status, 401);

  // Tracking number set by admin appears in the client's order history.
  await request(app).put(`/api/orders/${orderId}/tracking`).set('Cookie', adminCookie).send({ trackingNumber: 'PUD123456' });
  const history = await request(app).get('/api/client/orders').set('Cookie', owner.cookie);
  const row = history.body.orders.find((o) => o.id === orderId);
  assert.strictEqual(row.tracking_number, 'PUD123456');
});

test('buy-again re-resolves own past orders at current prices; foreign orders 404 (#96)', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  const filament = await request(app).post('/api/filaments').set('Cookie', adminCookie).send({ name: 'PLA96', slug: 'pla96' });
  const colour = await request(app)
    .post(`/api/filaments/${filament.body.filament.id}/colours`)
    .set('Cookie', adminCookie)
    .send({ name: 'Blue', sku: 'PLA96-BLUE', priceRand: 100, weightG: 100, stockQty: 10 });
  const productId = `filament:pla96:${colour.body.filament.colours[0].sku}`;

  const owner = await loggedInClientCookie(app, adminCookie, 'buyagain@example.com');
  const other = await loggedInClientCookie(app, adminCookie, 'buyagain-other@example.com');

  const checkout = await request(app).post('/api/checkout').send({
    client: { firstName: 'Buy', lastName: 'Again', email: 'buyagain@example.com' },
    items: [{ productId, quantity: 2 }],
    shippingMethod: 'collect',
    paymentMethod: 'manual_eft',
  });
  const orderId = checkout.body.orderId || checkout.body.order?.id;

  // Price change after the order -- buy-again must return TODAY's price.
  await request(app)
    .put(`/api/filaments/${filament.body.filament.id}/colours/${colour.body.filament.colours[0].id}`)
    .set('Cookie', adminCookie)
    .send({ priceRand: 150 });

  const res = await request(app).get(`/api/client/orders/${orderId}/buy-again`).set('Cookie', owner.cookie);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.items.length, 1);
  assert.strictEqual(res.body.items[0].price, 150);
  assert.strictEqual(res.body.items[0].quantity, 2);
  assert.deepStrictEqual(res.body.unavailable, []);

  const foreign = await request(app).get(`/api/client/orders/${orderId}/buy-again`).set('Cookie', other.cookie);
  assert.strictEqual(foreign.status, 404);
});

test('"Order this again" books a fresh order at the recorded quote price without touching the original quote link (#93)', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  const submit = await request(app).post('/api/design-requests').send({
    name: 'Repeat Rita', email: 'rita@example.com', phone: '0821234567', description: 'A custom car-part bracket',
  });
  const { id, statusToken } = submit.body.designRequest;

  await request(app).put(`/api/design-requests/${id}/quote`).set('Cookie', adminCookie).send({ amount: 850, terms: 'Same design, next batch' });

  // Not reorderable yet -- only quoted, not finalized.
  const early = await request(app).post('/api/design-request-status/reorder').send({ token: statusToken });
  assert.strictEqual(early.status, 400);

  await request(app).post('/api/design-request-status/accept').send({ token: statusToken, shippingMethod: 'collect' });
  const acceptedOrderId = (await request(app).get(`/api/design-requests/${id}`).set('Cookie', adminCookie)).body.designRequest.quoteOrderId;
  await request(app).patch(`/api/design-requests/${id}`).set('Cookie', adminCookie).send({ status: 'finalized' });

  const reorder = await request(app).post('/api/design-request-status/reorder').send({ token: statusToken, shippingMethod: 'collect' });
  assert.strictEqual(reorder.status, 200);
  assert.strictEqual(reorder.body.ok, true);
  assert.strictEqual(reorder.body.redirect.actionUrl.includes('payfast.co.za'), true);

  // Full recorded price -- accept() above ALSO took the full R850 (no
  // depositPct was sent, and setDesignRequestQuote defaults to 100), so
  // this specifically confirms there are two distinct R850 orders, not one.
  const orders = await request(app).get('/api/orders').set('Cookie', adminCookie);
  const fullPriceOrders = orders.body.orders.filter((o) => o.total === 850);
  assert.strictEqual(fullPriceOrders.length, 2, 'expected the accepted-quote order AND the reorder, both at R850');
  const repeatOrder = fullPriceOrders.find((o) => o.id !== acceptedOrderId);
  assert.ok(repeatOrder, 'the reorder produced a genuinely separate order');

  // The original request's quote/order link stays on the FIRST (accepted) order.
  const detail = await request(app).get(`/api/design-requests/${id}`).set('Cookie', adminCookie);
  assert.strictEqual(detail.body.designRequest.quoteStatus, 'accepted');
  assert.strictEqual(detail.body.designRequest.quoteOrderId, acceptedOrderId);
  assert.notStrictEqual(detail.body.designRequest.quoteOrderId, repeatOrder.id);

  const missingToken = await request(app).post('/api/design-request-status/reorder').send({ token: 'not-a-real-token' });
  assert.strictEqual(missingToken.status, 404);
});

test('POST /api/design-requests reports client.hasAccount:false for a guest, offering the same post-submit account prompt checkout offers post-purchase', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  const submit = await request(app).post('/api/design-requests').send({
    name: 'Guest Gwen', email: 'gwen@example.com', phone: '0821234567', description: 'A phone stand',
  });
  assert.strictEqual(submit.status, 201);
  assert.strictEqual(submit.body.client.hasAccount, false);
});

test('POST /api/design-requests reports client.hasAccount:true for an already-logged-in submitter', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];
  const { cookie: clientCookie } = await loggedInClientCookie(app, adminCookie, 'loggedin-designrequest@example.com');

  const submit = await request(app)
    .post('/api/design-requests')
    .set('Cookie', clientCookie)
    .send({ name: 'Test Client', email: 'loggedin-designrequest@example.com', phone: '0821234567', description: 'A bracket' });
  assert.strictEqual(submit.status, 201);
  assert.strictEqual(submit.body.client.hasAccount, true);
});

test('PUT quote/:id rejects a depositPct that is not one of the active configured tiers (#94)', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  const submit = await request(app).post('/api/design-requests').send({
    name: 'Deposit Dana', email: 'dana@example.com', phone: '0821234567', description: 'A vase',
  });
  const { id } = submit.body.designRequest;

  const rejected = await request(app).put(`/api/design-requests/${id}/quote`).set('Cookie', adminCookie).send({ amount: 400, depositPct: 40 });
  assert.strictEqual(rejected.status, 400);
  assert.match(rejected.body.error, /active tiers/);

  const accepted = await request(app).put(`/api/design-requests/${id}/quote`).set('Cookie', adminCookie).send({ amount: 400, depositPct: 25 });
  assert.strictEqual(accepted.status, 200);
  assert.strictEqual(accepted.body.request.quoteDepositPct, 25);

  // Retiring a tier (active: false) must stop it validating for NEW quotes,
  // without touching this already-quoted request's own locked-in value.
  const settings = await request(app).get('/api/settings').set('Cookie', adminCookie);
  const tiers = settings.body.settings.quoteDepositOptions.map((t) => (t.pct === 25 ? { ...t, active: false } : t));
  await request(app).put('/api/settings').set('Cookie', adminCookie).send({ quoteDepositOptions: tiers });
  const nowRejected = await request(app).put(`/api/design-requests/${id}/quote`).set('Cookie', adminCookie).send({ amount: 400, depositPct: 25 });
  assert.strictEqual(nowRejected.status, 400);
});

test('accept + reorder require a real shipping method and capture it on the order, no more hardcoded collect (#94)', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];
  const pudo = await request(app).post('/api/shipping-options').set('Cookie', adminCookie).send({ name: 'PUDO Locker', optionType: 'fixed', price: 65 });
  const shippingOptionId = pudo.body.shippingOption.id;

  const submit = await request(app).post('/api/design-requests').send({
    name: 'Ship Sam', email: 'sam@example.com', phone: '0821234567', description: 'A bracket',
  });
  const { id, statusToken } = submit.body.designRequest;
  await request(app).put(`/api/design-requests/${id}/quote`).set('Cookie', adminCookie).send({ amount: 500, depositPct: 100 });

  // No shippingMethod at all -- must be rejected, not silently default to collect.
  const noMethod = await request(app).post('/api/design-request-status/accept').send({ token: statusToken });
  assert.strictEqual(noMethod.status, 400);
  assert.match(noMethod.body.error, /shipping method/);

  // 'fixed' without picking an actual option must also be rejected.
  const fixedNoOption = await request(app).post('/api/design-request-status/accept').send({ token: statusToken, shippingMethod: 'fixed' });
  assert.strictEqual(fixedNoOption.status, 400);

  // A real fixed option + address -- order must carry the real shipping price and the client record the address.
  const accept = await request(app).post('/api/design-request-status/accept').send({
    token: statusToken, shippingMethod: 'fixed', shippingOptionId,
    street: '1 Main Road', suburb: 'Centurion Central', city: 'Centurion', province: 'Gauteng', postalCode: '0157',
  });
  assert.strictEqual(accept.status, 200);

  const orders = await request(app).get('/api/orders').set('Cookie', adminCookie);
  const order = orders.body.orders.find((o) => o.total === 500 + 65);
  assert.ok(order, 'order total should include the R65 fixed shipping price on top of the R500 quote');

  const clients = await request(app).get('/api/clients').set('Cookie', adminCookie);
  const client = clients.body.clients.find((c) => c.email === 'sam@example.com');
  assert.strictEqual(client.street, '1 Main Road');
  assert.strictEqual(client.city, 'Centurion');
});

test('quote stage progresses quoted -> order_placed -> order_paid, derived not stored (#94)', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  const submit = await request(app).post('/api/design-requests').send({
    name: 'Stage Steve', email: 'steve@example.com', phone: '0821234567', description: 'A knob',
  });
  const { id, statusToken } = submit.body.designRequest;

  const beforeQuote = await request(app).get(`/api/design-requests/${id}`).set('Cookie', adminCookie);
  assert.strictEqual(beforeQuote.body.designRequest.quoteStage, null);

  await request(app).put(`/api/design-requests/${id}/quote`).set('Cookie', adminCookie).send({ amount: 300, depositPct: 100 });
  const quotedList = await request(app).get('/api/design-requests').set('Cookie', adminCookie);
  assert.strictEqual(quotedList.body.designRequests.find((r) => r.id === id).quoteStage, 'quoted');

  await request(app).post('/api/design-request-status/accept').send({ token: statusToken, shippingMethod: 'collect' });
  const placed = await request(app).get(`/api/design-requests/${id}`).set('Cookie', adminCookie);
  assert.strictEqual(placed.body.designRequest.quoteStage, 'order_placed');

  const orderId = placed.body.designRequest.quoteOrderId;
  await request(app).put(`/api/orders/${orderId}/status`).set('Cookie', adminCookie).send({ status: 'paid' });
  const paid = await request(app).get(`/api/design-requests/${id}`).set('Cookie', adminCookie);
  assert.strictEqual(paid.body.designRequest.quoteStage, 'order_paid');

  const paidList = await request(app).get('/api/design-requests').set('Cookie', adminCookie);
  assert.strictEqual(paidList.body.designRequests.find((r) => r.id === id).quoteStage, 'order_paid');
});

test('GET /api/dashboard/sales requires admin auth, honors ?range, and rejects an unknown range', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  const anon = await request(app).get('/api/dashboard/sales');
  assert.strictEqual(anon.status, 401);

  const defaultRange = await request(app).get('/api/dashboard/sales').set('Cookie', adminCookie);
  assert.strictEqual(defaultRange.status, 200);
  assert.strictEqual(defaultRange.body.range, '30d');
  assert.strictEqual(defaultRange.body.revenue, 0);
  assert.deepStrictEqual(defaultRange.body.statusBreakdown.map((s) => s.status), ['pending_payment', 'paid', 'shipped', 'completed', 'cancelled']);

  const today = await request(app).get('/api/dashboard/sales?range=today').set('Cookie', adminCookie);
  assert.strictEqual(today.status, 200);
  assert.strictEqual(today.body.range, 'today');

  const bad = await request(app).get('/api/dashboard/sales?range=nonsense').set('Cookie', adminCookie);
  assert.strictEqual(bad.status, 400);
});

test('filament colour gallery: upload up to 5, reject the 6th, delete, reorder', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  const filament = await request(app).post('/api/filaments').set('Cookie', adminCookie).send({ name: 'PLA95', slug: 'pla95' });
  const colour = await request(app).post(`/api/filaments/${filament.body.filament.id}/colours`).set('Cookie', adminCookie).send({ name: 'Blue', sku: 'PLA95-BLUE' });
  const colourId = colour.body.filament.colours[0].id;

  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

  let last;
  for (let i = 0; i < 5; i++) {
    last = await request(app)
      .post(`/api/filaments/${filament.body.filament.id}/colours/${colourId}/images`)
      .set('Cookie', adminCookie)
      .attach('image', png1x1, `photo${i}.png`);
    assert.strictEqual(last.status, 201);
  }
  assert.strictEqual(last.body.images.length, 5);

  const sixth = await request(app)
    .post(`/api/filaments/${filament.body.filament.id}/colours/${colourId}/images`)
    .set('Cookie', adminCookie)
    .attach('image', png1x1, 'photo5.png');
  assert.strictEqual(sixth.status, 400);
  assert.match(sixth.body.error, /at most 5 photos/);

  const [first, second] = last.body.images;
  const reordered = await request(app)
    .put(`/api/filaments/${filament.body.filament.id}/colours/${colourId}/images/reorder`)
    .set('Cookie', adminCookie)
    .send({ order: [second.id, first.id, ...last.body.images.slice(2).map((i) => i.id)] });
  assert.strictEqual(reordered.status, 200);
  assert.strictEqual(reordered.body.images[0].id, second.id);

  const removed = await request(app)
    .delete(`/api/filaments/${filament.body.filament.id}/colours/${colourId}/images/${first.id}`)
    .set('Cookie', adminCookie);
  assert.strictEqual(removed.status, 200);
  assert.strictEqual(removed.body.images.length, 4);

  const missing = await request(app)
    .delete(`/api/filaments/${filament.body.filament.id}/colours/${colourId}/images/not-a-real-id`)
    .set('Cookie', adminCookie);
  assert.strictEqual(missing.status, 404);
});

test('category item gallery: upload, delete by path, reorder; whole-item PUT cannot overwrite it', async (t) => {
  const { app, cleanup } = await freshApp();
  t.after(cleanup);
  await request(app).post('/api/setup').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminLogin = await request(app).post('/api/auth/login').send({ username: 'johan', password: 'correcthorsebattery' });
  const adminCookie = adminLogin.headers['set-cookie'];

  const product = await request(app).post('/api/products').set('Cookie', adminCookie).send({ name: 'Toys', slug: 'toys95', items: [{ name: 'Dino' }] });
  const itemId = product.body.product.items[0].id;

  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

  const first = await request(app)
    .post(`/api/products/${product.body.product.id}/items/${itemId}/images`)
    .set('Cookie', adminCookie)
    .attach('image', png1x1, 'a.png');
  assert.strictEqual(first.status, 201);
  const second = await request(app)
    .post(`/api/products/${product.body.product.id}/items/${itemId}/images`)
    .set('Cookie', adminCookie)
    .attach('image', png1x1, 'b.png');
  assert.strictEqual(second.body.images.length, 2);

  const putRes = await request(app)
    .put(`/api/products/${product.body.product.id}/items/${itemId}`)
    .set('Cookie', adminCookie)
    .send({ name: 'Dino', images: ['/uploads/category-items/hacked.jpg'] });
  assert.strictEqual(putRes.status, 200);
  assert.deepStrictEqual(putRes.body.item.images, second.body.images);

  const reordered = await request(app)
    .put(`/api/products/${product.body.product.id}/items/${itemId}/images/reorder`)
    .set('Cookie', adminCookie)
    .send({ order: [second.body.images[1], second.body.images[0]] });
  assert.strictEqual(reordered.status, 200);
  assert.deepStrictEqual(reordered.body.images, [second.body.images[1], second.body.images[0]]);

  const removed = await request(app)
    .delete(`/api/products/${product.body.product.id}/items/${itemId}/images`)
    .set('Cookie', adminCookie)
    .send({ imagePath: second.body.images[1] });
  assert.strictEqual(removed.status, 200);
  assert.strictEqual(removed.body.images.length, 1);
});
