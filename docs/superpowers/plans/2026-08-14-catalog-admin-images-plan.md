# Filament Catalog + Multi-Admin Auth + Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the filament catalog onto SQLite with per-colour SKUs (weight, roll length, stock qty, price, photo), replace the single shared admin password with multi-account username+password login, and add image upload -- while leaving the generator/public pages and category catalogue (car-parts/toys/homeware/phones) untouched.

**Architecture:** New `data/lapanza.db` (better-sqlite3) holds `admins`, `filament_types`, `filament_colours`, `settings`. A one-time boot migration imports the existing `data/catalog.json` into it, then rewrites `catalog.json` to hold only category products. A new `syncPublicJson()` step (replacing the old `syncToSiteData`) still writes `src/data/filaments.json`, `src/data/categories.json`, `src/data/settings.json`, `public/site-settings.json` in the exact same shapes the existing `scripts/generate-pages.mjs` and frontend already read -- so the generator and public pages need only one small addition (colour photo thumbnail).

**Tech Stack:** better-sqlite3 (already installed), multer (already installed, previously unused), bcryptjs (already installed), Node's built-in `node:test` runner (zero new dependency), supertest for HTTP-level tests (already installed).

**Spec:** `docs/superpowers/specs/2026-08-14-catalog-admin-images-design.md`

## Global Constraints

- SQLite file lives at `data/lapanza.db`, gitignored, same pattern as today's `data/catalog.json`.
- No role differentiation between admin accounts -- every admin has equal access.
- Stock is exact integer quantity (`stock_qty`), not a status enum.
- Price stored as whole Rand integer (`price_rand`) -- no cents anywhere in real data.
- `roll_length_m` is nullable -- not available from any scrape source, admin fills in manually.
- One image per **colour**, not per filament type.
- Category catalogue (car-parts/toys/homeware/phones) stays in `data/catalog.json`, completely untouched by this plan.
- `scripts/generate-pages.mjs` gets exactly one addition (colour photo in `colourCards()`) -- nothing else in it changes.
- Every new server module exposes a `db` parameter defaulting to `getDb()` so tests can inject an isolated in-memory database.

---

### Task 1: Dependencies, gitignore, test runner

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm test` runs `node --test` (auto-discovers `**/*.test.js`).

- [ ] **Step 1: Move `supertest` to devDependencies, add test script**

`better-sqlite3` and `supertest` are already installed (verified: better-sqlite3 opens/queries fine via ESM `import`, `node --test` correctly auto-discovers only `*.test.js` files with no path argument). Edit `package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "dev:site": "vite",
    "dev:admin": "node server/index.js",
    "dev:all": "concurrently -n site,admin -c cyan,magenta \"npm run dev:site\" \"npm run dev:admin\"",
    "build": "vite build",
    "preview": "vite preview",
    "generate": "node scripts/generate-pages.mjs",
    "admin": "node server/index.js",
    "test": "node --test"
  },
  "dependencies": {
    "bcryptjs": "^3.0.3",
    "better-sqlite3": "^13.0.3",
    "concurrently": "^10.0.4",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.6",
    "express": "^5.2.1",
    "gsap": "^3.12.7",
    "multer": "^2.2.0",
    "three": "^0.172.0",
    "uuid": "^14.0.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.6",
    "nodemon": "^3.1.14",
    "supertest": "^7.2.2",
    "tailwindcss": "^4.0.6",
    "vite": "^6.1.0"
  }
}
```

(Move the `supertest` line from `dependencies` to `devDependencies` -- it is a test-only tool. `better-sqlite3` stays in `dependencies` since the server needs it at runtime.)

- [ ] **Step 2: Add gitignore entries**

Append to `.gitignore`:

```
data/lapanza.db
data/lapanza.db-*
```

(The `-wal`/`-shm` WAL journal files better-sqlite3 creates alongside the main db file. `public/uploads/` is deliberately NOT gitignored -- those images are committed like the rest of the static site, since there's no CDN/S3 in front of this deployment yet.)

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: `# tests 0` (no test files exist yet) -- command exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: add test script, gitignore SQLite db files"
```

---

### Task 2: `server/db.js` -- schema + connection

**Files:**
- Create: `server/db.js`
- Test: `server/db.test.js`

**Interfaces:**
- Produces: `openDb(dbPath)` -> opens/creates a db at `dbPath` with schema applied, returns the `better-sqlite3` `Database` instance. `getDb()` -> connection cached per resolved `data/lapanza.db` path under the current `process.cwd()` (not a single global singleton -- so cwd-isolated tests within one process each get their own DB), auto-runs migration on first creation of that path. `ensureSchema(db)` -> idempotent `CREATE TABLE IF NOT EXISTS` for all 4 tables. `closeAllCachedDbs()` -> test-only helper that closes and clears every cached connection.

- [ ] **Step 1: Write the failing test**

```javascript
// server/db.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { openDb, ensureSchema } from './db.js';

test('ensureSchema creates all four tables', () => {
  const db = openDb(':memory:');
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepStrictEqual(tables, ['admins', 'filament_colours', 'filament_types', 'settings']);
  db.close();
});

test('ensureSchema is idempotent (safe to call twice)', () => {
  const db = openDb(':memory:');
  assert.doesNotThrow(() => ensureSchema(db));
  db.close();
});

test('filament_colours cascades delete when filament_types row is removed', () => {
  const db = openDb(':memory:');
  db.prepare(
    `INSERT INTO filament_types (id, slug, name, description, colour_note, specs_json, seo_title, seo_description, internal_notes, status, featured, sort_order, created_at, updated_at)
     VALUES ('t1','pla','PLA','','','[]','','','','published',0,0,'now','now')`,
  ).run();
  db.prepare(
    `INSERT INTO filament_colours (id, filament_type_id, name, hex, sku, weight_g, roll_length_m, price_rand, stock_qty, image_path, notes, sort_order, created_at, updated_at)
     VALUES ('c1','t1','White','','SKU-1',1000,NULL,299,5,NULL,'',0,'now','now')`,
  ).run();
  db.pragma('foreign_keys = ON');
  db.prepare('DELETE FROM filament_types WHERE id = ?').run('t1');
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM filament_colours').get();
  assert.strictEqual(remaining.n, 0);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- `Cannot find module './db.js'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```javascript
// server/db.js
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

function ensureDataDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function ensureSchema(db) {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS filament_types (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      colour_note TEXT NOT NULL DEFAULT '',
      specs_json TEXT NOT NULL DEFAULT '[]',
      seo_title TEXT NOT NULL DEFAULT '',
      seo_description TEXT NOT NULL DEFAULT '',
      internal_notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'published',
      featured INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS filament_colours (
      id TEXT PRIMARY KEY,
      filament_type_id TEXT NOT NULL REFERENCES filament_types(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      hex TEXT NOT NULL DEFAULT '',
      sku TEXT UNIQUE NOT NULL,
      weight_g INTEGER NOT NULL DEFAULT 0,
      roll_length_m REAL,
      price_rand INTEGER NOT NULL DEFAULT 0,
      stock_qty INTEGER NOT NULL DEFAULT 0,
      image_path TEXT,
      notes TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function openDb(dbPath) {
  if (dbPath !== ':memory:') ensureDataDir(path.dirname(dbPath));
  const db = new Database(dbPath);
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
  ensureSchema(db);
  return db;
}

// Cached per resolved path (not a single global), so multiple cwd-isolated
// tests within one process (e.g. several test() blocks in index.test.js
// each calling process.chdir()) each get their own DB instance instead of
// silently sharing whichever one was opened first.
const _dbCache = new Map();

export function getDb() {
  const root = process.cwd();
  const dbPath = path.join(root, 'data', 'lapanza.db');
  if (_dbCache.has(dbPath)) return _dbCache.get(dbPath);
  const isNew = !fs.existsSync(dbPath);
  const db = openDb(dbPath);
  _dbCache.set(dbPath, db);
  if (isNew) {
    const catalogJsonPath = path.join(root, 'data', 'catalog.json');
    import('./migrate-json.js').then(({ migrateFromCatalogJson }) => {
      migrateFromCatalogJson(db, catalogJsonPath);
    });
  }
  return db;
}

// Test-only: closes every cached connection so a temp directory holding one
// can be deleted afterward (Windows locks open file handles, unlike POSIX).
export function closeAllCachedDbs() {
  for (const db of _dbCache.values()) db.close();
  _dbCache.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/db.test.js
git commit -m "feat: add SQLite schema module (admins, filaments, colours, settings)"
```

---

### Task 3: `server/migrate-json.js` -- one-time import from catalog.json

**Files:**
- Create: `server/migrate-json.js`
- Test: `server/migrate-json.test.js`

**Interfaces:**
- Consumes: a `better-sqlite3` `db` (from `openDb`/`getDb`) with schema already applied.
- Produces: `migrateFromCatalogJson(db, catalogJsonPath)` -> `{ migrated: boolean, filamentTypeCount: number }`. `parsePriceToRand(priceStr)` -> integer.

- [ ] **Step 1: Write the failing test**

```javascript
// server/migrate-json.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb } from './db.js';
import { migrateFromCatalogJson, parsePriceToRand } from './migrate-json.js';

function writeFixtureCatalog() {
  const file = path.join(os.tmpdir(), `catalog-fixture-${Date.now()}.json`);
  const catalog = {
    version: 1,
    updatedAt: 'now',
    settings: {
      siteName: 'Lapanza 3D Creative Lab',
      adminPasswordHash: 'should-not-migrate',
    },
    products: [
      {
        id: 'p1',
        kind: 'filament',
        slug: 'pla',
        name: 'PLA',
        description: 'Standard PLA',
        colours: [
          { name: 'White', sku: 'SKU-1', price: 'R299', inStock: true },
          { name: 'Black', sku: 'SKU-2', price: 'R329', inStock: false },
        ],
      },
      {
        id: 'p2',
        kind: 'category',
        slug: 'toys',
        name: 'Toys',
        items: [{ name: 'Dice set', price: 'R99' }],
      },
    ],
  };
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2));
  return file;
}

test('parsePriceToRand strips currency symbols', () => {
  assert.strictEqual(parsePriceToRand('R299'), 299);
  assert.strictEqual(parsePriceToRand('R1,299'), 1);
  assert.strictEqual(parsePriceToRand(''), 0);
  assert.strictEqual(parsePriceToRand(null), 0);
});

test('migrateFromCatalogJson imports filament products into SQLite and strips them from the JSON file', () => {
  const db = openDb(':memory:');
  const fixture = writeFixtureCatalog();

  const result = migrateFromCatalogJson(db, fixture);
  assert.strictEqual(result.migrated, true);
  assert.strictEqual(result.filamentTypeCount, 1);

  const types = db.prepare('SELECT * FROM filament_types').all();
  assert.strictEqual(types.length, 1);
  assert.strictEqual(types[0].slug, 'pla');

  const colours = db.prepare('SELECT * FROM filament_colours ORDER BY sort_order').all();
  assert.strictEqual(colours.length, 2);
  assert.strictEqual(colours[0].sku, 'SKU-1');
  assert.strictEqual(colours[0].price_rand, 299);
  assert.strictEqual(colours[0].stock_qty, 1);
  assert.strictEqual(colours[1].stock_qty, 0);

  const settingsRows = db.prepare('SELECT key FROM settings').all().map((r) => r.key);
  assert.ok(settingsRows.includes('siteName'));
  assert.ok(!settingsRows.includes('adminPasswordHash'));

  const remaining = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  assert.strictEqual(remaining.products.length, 1);
  assert.strictEqual(remaining.products[0].kind, 'category');
  assert.strictEqual(remaining.settings, undefined);

  fs.unlinkSync(fixture);
  db.close();
});

test('migrateFromCatalogJson is a no-op when the file does not exist', () => {
  const db = openDb(':memory:');
  const result = migrateFromCatalogJson(db, path.join(os.tmpdir(), 'does-not-exist.json'));
  assert.strictEqual(result.migrated, false);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- `Cannot find module './migrate-json.js'`.

- [ ] **Step 3: Write the implementation**

```javascript
// server/migrate-json.js
import fs from 'fs';
import { randomUUID } from 'crypto';

export function parsePriceToRand(priceStr) {
  if (typeof priceStr === 'number') return Math.round(priceStr);
  if (!priceStr) return 0;
  const digits = String(priceStr).replace(/[^0-9.]/g, '');
  return digits ? Math.round(parseFloat(digits)) : 0;
}

export function migrateFromCatalogJson(db, catalogJsonPath) {
  if (!fs.existsSync(catalogJsonPath)) return { migrated: false, filamentTypeCount: 0 };

  const catalog = JSON.parse(fs.readFileSync(catalogJsonPath, 'utf8'));
  const now = new Date().toISOString();
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const filamentProducts = products.filter((p) => p.kind === 'filament');
  const categoryProducts = products.filter((p) => p.kind !== 'filament');

  const insertType = db.prepare(`
    INSERT INTO filament_types
      (id, slug, name, description, colour_note, specs_json, seo_title, seo_description, internal_notes, status, featured, sort_order, created_at, updated_at)
    VALUES
      (@id, @slug, @name, @description, @colour_note, @specs_json, @seo_title, @seo_description, @internal_notes, @status, @featured, @sort_order, @created_at, @updated_at)
  `);
  const insertColour = db.prepare(`
    INSERT INTO filament_colours
      (id, filament_type_id, name, hex, sku, weight_g, roll_length_m, price_rand, stock_qty, image_path, notes, sort_order, created_at, updated_at)
    VALUES
      (@id, @filament_type_id, @name, @hex, @sku, @weight_g, @roll_length_m, @price_rand, @stock_qty, @image_path, @notes, @sort_order, @created_at, @updated_at)
  `);
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  const txn = db.transaction(() => {
    filamentProducts.forEach((p, typeIndex) => {
      const typeId = randomUUID();
      insertType.run({
        id: typeId,
        slug: p.slug,
        name: p.name,
        description: p.description || '',
        colour_note: p.colourNote || '',
        specs_json: JSON.stringify(p.specs || []),
        seo_title: p.seoTitle || '',
        seo_description: p.seoDescription || '',
        internal_notes: p.internalNotes || '',
        status: p.status === 'draft' ? 'draft' : 'published',
        featured: p.featured ? 1 : 0,
        sort_order: p.sortOrder ?? typeIndex,
        created_at: p.createdAt || now,
        updated_at: p.updatedAt || now,
      });
      (p.colours || []).forEach((c, colourIndex) => {
        insertColour.run({
          id: randomUUID(),
          filament_type_id: typeId,
          name: c.name || '',
          hex: c.hex || '',
          sku: c.sku || `${p.slug}-${colourIndex}`,
          weight_g: 0,
          roll_length_m: null,
          price_rand: parsePriceToRand(c.price),
          stock_qty: c.inStock === false ? 0 : 1,
          image_path: null,
          notes: c.notes || '',
          sort_order: colourIndex,
          created_at: now,
          updated_at: now,
        });
      });
    });

    Object.entries(catalog.settings || {}).forEach(([key, value]) => {
      if (key === 'adminPassword' || key === 'adminPasswordHash') return;
      insertSetting.run(key, JSON.stringify(value));
    });
  });
  txn();

  fs.writeFileSync(
    catalogJsonPath,
    JSON.stringify({ version: catalog.version || 1, updatedAt: now, products: categoryProducts }, null, 2),
  );

  return { migrated: true, filamentTypeCount: filamentProducts.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: All tests pass (Task 2's 3 + Task 3's 4 = 7 total).

- [ ] **Step 5: Commit**

```bash
git add server/migrate-json.js server/migrate-json.test.js
git commit -m "feat: one-time migration from catalog.json into SQLite"
```

---

### Task 4: `server/settings-defaults.js` -- drop password field, `server/settings.js` -- DB-backed settings

**Files:**
- Modify: `server/settings-defaults.js`
- Create: `server/settings.js`
- Test: `server/settings.test.js`

**Interfaces:**
- Consumes: `getDb()` from `server/db.js`.
- Produces: `getSettings(db)` -> merged settings object. `updateSettings(patch, db)` -> updated settings object. `publicSettings(settings)` -> settings with no secrets (currently a no-op passthrough now that passwords live in `admins`, kept for API-shape continuity).

- [ ] **Step 1: Remove `adminPasswordHash` from settings-defaults.js**

Edit `server/settings-defaults.js` -- remove the `adminPasswordHash` field and simplify `publicSettings` (no more secret field to strip, since admin credentials now live entirely in the `admins` table):

```javascript
export const DEFAULT_SETTINGS = {
  siteName: 'Lapanza 3D Creative Lab',
  tagline: 'Custom 3D Printing & SA Filament',
  phoneDisplay: '082 663 9608',
  phoneTel: '+27826639608',
  email: 'lapanzaonline@gmail.com',
  address: '23 Gladiator Rd, Pierre van Ryneveld, Centurion',
  hours: 'By appointment',
  whatsapp:
    'https://api.whatsapp.com/send?phone=27826639608&text=Hello%20Lapanza%2C%20I%20am%20contacting%20you%20from%20your%20new%203D%20site.',
  facebook: 'https://www.facebook.com/Lapanzaloeferox',
  instagram: 'https://www.instagram.com/lapanza_beauty_lifestyle/',
  useUniversalFont: false,
  universalFont: 'dm-sans',
  fontSans: 'dm-sans',
  fontSerif: 'fraunces',
  defaultTheme: 'system',
  homeTiles: [
    { eyebrow: '20 types', title: 'Filament', description: 'PLA, PETG, ABS, TPU, PRO CPE and more -- real colours, real specs.' },
    { eyebrow: 'GWM . Landrover', title: 'Car Parts', description: 'Custom and replacement 3D printed parts for your vehicle.' },
    { eyebrow: 'Toys . Home . Phones', title: 'Everything Else', description: 'Toys, homeware and phone accessories, printed to order.' },
  ],
};
```

(Keep `FONT_OPTIONS` and `findFont` exactly as they are today -- only `DEFAULT_SETTINGS.adminPasswordHash` and the old `publicSettings` function are removed; the new `publicSettings` lives in `settings.js` below. Keep the real em-dash/middle-dot characters that are already in the file for `homeTiles` -- the ASCII substitutes above are only to survive this plan document's own encoding, copy the existing punctuation style from the current file.)

- [ ] **Step 2: Write the failing test for settings.js**

```javascript
// server/settings.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { getSettings, updateSettings, publicSettings } from './settings.js';

test('getSettings returns defaults when the settings table is empty', () => {
  const db = openDb(':memory:');
  const settings = getSettings(db);
  assert.strictEqual(settings.siteName, 'Lapanza 3D Creative Lab');
  assert.strictEqual(settings.homeTiles.length, 3);
  db.close();
});

test('updateSettings persists a patch and getSettings reflects it', () => {
  const db = openDb(':memory:');
  updateSettings({ siteName: 'New Name', tagline: 'New Tagline' }, db);
  const settings = getSettings(db);
  assert.strictEqual(settings.siteName, 'New Name');
  assert.strictEqual(settings.tagline, 'New Tagline');
  db.close();
});

test('updateSettings round-trips a nested array value (homeTiles)', () => {
  const db = openDb(':memory:');
  const tiles = [{ eyebrow: 'x', title: 'y', description: 'z' }];
  updateSettings({ homeTiles: tiles }, db);
  const settings = getSettings(db);
  assert.deepStrictEqual(settings.homeTiles, tiles);
  db.close();
});

test('publicSettings is a passthrough (no secrets stored in settings anymore)', () => {
  const settings = { siteName: 'X' };
  assert.deepStrictEqual(publicSettings(settings), settings);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- `Cannot find module './settings.js'`.

- [ ] **Step 4: Write the implementation**

```javascript
// server/settings.js
import { getDb } from './db.js';
import { DEFAULT_SETTINGS } from './settings-defaults.js';

export function getSettings(db = getDb()) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = {};
  rows.forEach((r) => {
    stored[r.key] = JSON.parse(r.value);
  });
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function updateSettings(patch, db = getDb()) {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const txn = db.transaction((entries) => {
    entries.forEach(([key, value]) => upsert.run(key, JSON.stringify(value)));
  });
  txn(Object.entries(patch));
  return getSettings(db);
}

export function publicSettings(settings) {
  return { ...settings };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/settings-defaults.js server/settings.js server/settings.test.js
git commit -m "feat: DB-backed settings, remove password field from settings schema"
```

---

### Task 5: `server/admins.js` -- multi-account auth

**Files:**
- Create: `server/admins.js`
- Test: `server/admins.test.js`

**Interfaces:**
- Consumes: `getDb()` from `server/db.js`, `bcryptjs`.
- Produces: `hasAnyAdmin(db)`, `listAdmins(db)`, `createAdmin({username, password}, db)`, `deleteAdmin(id, db)`, `resetPassword(id, password, db)`, `verifyLogin(username, password, db)`.

- [ ] **Step 1: Write the failing test**

```javascript
// server/admins.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { hasAnyAdmin, listAdmins, createAdmin, deleteAdmin, resetPassword, verifyLogin } from './admins.js';

test('hasAnyAdmin is false on an empty db, true after createAdmin', () => {
  const db = openDb(':memory:');
  assert.strictEqual(hasAnyAdmin(db), false);
  createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  assert.strictEqual(hasAnyAdmin(db), true);
  db.close();
});

test('createAdmin rejects a duplicate username', () => {
  const db = openDb(':memory:');
  createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  assert.throws(() => createAdmin({ username: 'johan', password: 'other' }, db), /already taken/);
  db.close();
});

test('verifyLogin succeeds with correct credentials, fails with wrong password or unknown user', () => {
  const db = openDb(':memory:');
  createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  assert.ok(verifyLogin('johan', 'correcthorse', db));
  assert.strictEqual(verifyLogin('johan', 'wrong', db), null);
  assert.strictEqual(verifyLogin('nobody', 'correcthorse', db), null);
  db.close();
});

test('deleteAdmin refuses to remove the last remaining admin', () => {
  const db = openDb(':memory:');
  const admin = createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  assert.throws(() => deleteAdmin(admin.id, db), /last admin/);
  db.close();
});

test('deleteAdmin succeeds when more than one admin exists', () => {
  const db = openDb(':memory:');
  const a = createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  createAdmin({ username: 'linandi', password: 'correcthorse2' }, db);
  assert.strictEqual(deleteAdmin(a.id, db), true);
  assert.strictEqual(listAdmins(db).length, 1);
  db.close();
});

test('resetPassword changes what verifyLogin accepts', () => {
  const db = openDb(':memory:');
  const admin = createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  resetPassword(admin.id, 'newpassword', db);
  assert.strictEqual(verifyLogin('johan', 'correcthorse', db), null);
  assert.ok(verifyLogin('johan', 'newpassword', db));
  db.close();
});

test('listAdmins never exposes password_hash', () => {
  const db = openDb(':memory:');
  createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  const admins = listAdmins(db);
  assert.strictEqual(admins[0].password_hash, undefined);
  assert.strictEqual(admins[0].username, 'johan');
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- `Cannot find module './admins.js'`.

- [ ] **Step 3: Write the implementation**

```javascript
// server/admins.js
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { getDb } from './db.js';

export function hasAnyAdmin(db = getDb()) {
  return db.prepare('SELECT COUNT(*) AS n FROM admins').get().n > 0;
}

export function listAdmins(db = getDb()) {
  return db.prepare('SELECT id, username, created_at FROM admins ORDER BY created_at ASC').all();
}

export function createAdmin({ username, password }, db = getDb()) {
  if (!username || !password) throw new Error('Username and password required');
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (existing) throw new Error('Username already taken');
  const admin = {
    id: randomUUID(),
    username,
    password_hash: bcrypt.hashSync(password, 10),
    created_at: new Date().toISOString(),
  };
  db.prepare(
    'INSERT INTO admins (id, username, password_hash, created_at) VALUES (@id, @username, @password_hash, @created_at)',
  ).run(admin);
  return { id: admin.id, username: admin.username, created_at: admin.created_at };
}

export function deleteAdmin(id, db = getDb()) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (count <= 1) throw new Error('Cannot remove the last admin account');
  const result = db.prepare('DELETE FROM admins WHERE id = ?').run(id);
  return result.changes > 0;
}

export function resetPassword(id, password, db = getDb()) {
  if (!password) throw new Error('Password required');
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, id);
  return result.changes > 0;
}

export function verifyLogin(username, password, db = getDb()) {
  const row = db.prepare('SELECT id, password_hash FROM admins WHERE username = ?').get(username);
  if (!row) return null;
  return bcrypt.compareSync(password, row.password_hash) ? { id: row.id, username } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/admins.js server/admins.test.js
git commit -m "feat: multi-account admin auth module"
```

---

### Task 6: `server/uploads.js` -- image storage

**Files:**
- Create: `server/uploads.js`
- Test: `server/uploads.test.js`

**Interfaces:**
- Produces: `UPLOAD_DIR` (absolute path constant), `ensureUploadDir()`, `buildImageFilename(sku, originalName)`, `deleteImageFile(imagePath)`, `uploadFilamentImage` (configured multer instance, `.single('image')` used by the route).

- [ ] **Step 1: Write the failing test**

```javascript
// server/uploads.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { buildImageFilename, deleteImageFile, UPLOAD_DIR, ensureUploadDir } from './uploads.js';

test('buildImageFilename produces a slug-based name with the original extension', () => {
  const name = buildImageFilename('SKU-123', 'photo.JPG');
  assert.match(name, /^sku-123-[0-9a-f]{8}\.jpg$/);
});

test('buildImageFilename falls back to a safe default when sku is missing', () => {
  const name = buildImageFilename('', 'photo.png');
  assert.match(name, /^colour-[0-9a-f]{8}\.png$/);
});

test('buildImageFilename defaults to .jpg when the original name has no extension', () => {
  const name = buildImageFilename('sku', 'photo');
  assert.match(name, /\.jpg$/);
});

test('deleteImageFile removes an existing file and is a no-op for a missing one', () => {
  ensureUploadDir();
  const file = path.join(UPLOAD_DIR, 'delete-me-test.jpg');
  fs.writeFileSync(file, 'x');
  deleteImageFile('/uploads/filaments/delete-me-test.jpg');
  assert.strictEqual(fs.existsSync(file), false);
  assert.doesNotThrow(() => deleteImageFile('/uploads/filaments/never-existed.jpg'));
  assert.doesNotThrow(() => deleteImageFile(null));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- `Cannot find module './uploads.js'`.

- [ ] **Step 3: Write the implementation**

```javascript
// server/uploads.js
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';

const root = process.cwd(); // cwd-based (not __dirname) so tests can isolate via process.chdir()
export const UPLOAD_DIR = path.join(root, 'public', 'uploads', 'filaments');

export function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function buildImageFilename(sku, originalName) {
  const ext = (path.extname(originalName || '') || '.jpg').toLowerCase();
  const safeSku =
    String(sku || 'colour')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '') || 'colour';
  const hash = crypto.randomBytes(4).toString('hex');
  return `${safeSku}-${hash}${ext}`;
}

export function deleteImageFile(imagePath) {
  if (!imagePath) return;
  const filename = path.basename(imagePath);
  const abs = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const uploadFilamentImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureUploadDir();
      cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => cb(null, buildImageFilename(req.params.colourId, file.originalname)),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype)),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/uploads.js server/uploads.test.js
git commit -m "feat: filament colour image upload module (multer, disk storage)"
```

---

### Task 7: `server/filaments.js` -- filament type + colour CRUD

**Files:**
- Create: `server/filaments.js`
- Test: `server/filaments.test.js`

**Interfaces:**
- Consumes: `getDb()`, `deleteImageFile` from `server/uploads.js`.
- Produces: `listFilaments(db)`, `getFilament(id, db)`, `createFilament(data, db)`, `updateFilament(id, data, db)`, `deleteFilament(id, db)`, `addColour(filamentTypeId, data, db)`, `updateColour(filamentTypeId, colourId, data, db)`, `deleteColour(filamentTypeId, colourId, db)`, `setColourImage(filamentTypeId, colourId, imagePath, db)`. Each returns camelCase objects: `{ id, slug, name, description, colourNote, specs, seoTitle, seoDescription, internalNotes, status, featured, sortOrder, createdAt, updatedAt, colours: [{ id, name, hex, sku, weightG, rollLengthM, priceRand, stockQty, imagePath, notes, sortOrder }] }`.

- [ ] **Step 1: Write the failing test**

```javascript
// server/filaments.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import {
  listFilaments,
  getFilament,
  createFilament,
  updateFilament,
  deleteFilament,
  addColour,
  updateColour,
  deleteColour,
  setColourImage,
} from './filaments.js';

test('createFilament + getFilament round-trip', () => {
  const db = openDb(':memory:');
  const created = createFilament({ name: 'PLA', description: 'Standard PLA' }, db);
  assert.strictEqual(created.slug, 'pla');
  const fetched = getFilament(created.id, db);
  assert.strictEqual(fetched.name, 'PLA');
  assert.deepStrictEqual(fetched.colours, []);
  db.close();
});

test('listFilaments returns types ordered by sort_order', () => {
  const db = openDb(':memory:');
  createFilament({ name: 'PETG', sortOrder: 1 }, db);
  createFilament({ name: 'PLA', sortOrder: 0 }, db);
  const list = listFilaments(db);
  assert.deepStrictEqual(list.map((f) => f.name), ['PLA', 'PETG']);
  db.close();
});

test('addColour attaches a colour with numeric fields to a filament type', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const updated = addColour(f.id, { name: 'White', sku: 'SKU-1', weightG: 1000, priceRand: 299, stockQty: 5 }, db);
  assert.strictEqual(updated.colours.length, 1);
  assert.strictEqual(updated.colours[0].weightG, 1000);
  assert.strictEqual(updated.colours[0].priceRand, 299);
  assert.strictEqual(updated.colours[0].stockQty, 5);
  assert.strictEqual(updated.colours[0].rollLengthM, null);
  db.close();
});

test('updateColour changes stock/price/weight/roll length', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;
  const updated = updateColour(f.id, colourId, { stockQty: 12, priceRand: 349, rollLengthM: 330 }, db);
  assert.strictEqual(updated.colours[0].stockQty, 12);
  assert.strictEqual(updated.colours[0].priceRand, 349);
  assert.strictEqual(updated.colours[0].rollLengthM, 330);
  db.close();
});

test('deleteColour removes just that colour', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;
  assert.strictEqual(deleteColour(f.id, colourId, db), true);
  assert.strictEqual(getFilament(f.id, db).colours.length, 0);
  db.close();
});

test('deleteFilament cascades to its colours', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  assert.strictEqual(deleteFilament(f.id, db), true);
  assert.strictEqual(getFilament(f.id, db), null);
  const orphanColours = db.prepare('SELECT COUNT(*) AS n FROM filament_colours').get().n;
  assert.strictEqual(orphanColours, 0);
  db.close();
});

test('setColourImage sets image_path and getFilament reflects it', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA' }, db);
  const withColour = addColour(f.id, { name: 'White', sku: 'SKU-1' }, db);
  const colourId = withColour.colours[0].id;
  const updated = setColourImage(f.id, colourId, '/uploads/filaments/sku-1-abcd1234.jpg', db);
  assert.strictEqual(updated.colours[0].imagePath, '/uploads/filaments/sku-1-abcd1234.jpg');
  db.close();
});

test('updateFilament preserves fields not included in the patch', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA', description: 'Original' }, db);
  const updated = updateFilament(f.id, { name: 'PLA Premium' }, db);
  assert.strictEqual(updated.name, 'PLA Premium');
  assert.strictEqual(updated.description, 'Original');
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- `Cannot find module './filaments.js'`.

- [ ] **Step 3: Write the implementation**

```javascript
// server/filaments.js
import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { deleteImageFile } from './uploads.js';

function rowToColour(row) {
  return {
    id: row.id,
    name: row.name,
    hex: row.hex,
    sku: row.sku,
    weightG: row.weight_g,
    rollLengthM: row.roll_length_m,
    priceRand: row.price_rand,
    stockQty: row.stock_qty,
    imagePath: row.image_path,
    notes: row.notes,
    sortOrder: row.sort_order,
  };
}

function rowToType(row, colourRows) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    colourNote: row.colour_note,
    specs: JSON.parse(row.specs_json || '[]'),
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    internalNotes: row.internal_notes,
    status: row.status,
    featured: Boolean(row.featured),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    colours: colourRows.map(rowToColour),
  };
}

function slugify(value) {
  return (
    String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'filament'
  );
}

const colourStmtFor = (db) => db.prepare('SELECT * FROM filament_colours WHERE filament_type_id = ? ORDER BY sort_order ASC');

export function listFilaments(db = getDb()) {
  const types = db.prepare('SELECT * FROM filament_types ORDER BY sort_order ASC, name ASC').all();
  const colourStmt = colourStmtFor(db);
  return types.map((t) => rowToType(t, colourStmt.all(t.id)));
}

export function getFilament(id, db = getDb()) {
  const t = db.prepare('SELECT * FROM filament_types WHERE id = ?').get(id);
  if (!t) return null;
  return rowToType(t, colourStmtFor(db).all(id));
}

export function createFilament(data, db = getDb()) {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO filament_types
      (id, slug, name, description, colour_note, specs_json, seo_title, seo_description, internal_notes, status, featured, sort_order, created_at, updated_at)
     VALUES
      (@id, @slug, @name, @description, @colour_note, @specs_json, @seo_title, @seo_description, @internal_notes, @status, @featured, @sort_order, @created_at, @updated_at)`,
  ).run({
    id,
    slug: slugify(data.slug || data.name),
    name: data.name || 'Untitled filament',
    description: data.description || '',
    colour_note: data.colourNote || '',
    specs_json: JSON.stringify(data.specs || []),
    seo_title: data.seoTitle || '',
    seo_description: data.seoDescription || '',
    internal_notes: data.internalNotes || '',
    status: data.status === 'draft' ? 'draft' : 'published',
    featured: data.featured ? 1 : 0,
    sort_order: Number(data.sortOrder) || 0,
    created_at: now,
    updated_at: now,
  });
  return getFilament(id, db);
}

export function updateFilament(id, data, db = getDb()) {
  const existing = getFilament(id, db);
  if (!existing) return null;
  db.prepare(
    `UPDATE filament_types SET
      slug = @slug, name = @name, description = @description, colour_note = @colour_note,
      specs_json = @specs_json, seo_title = @seo_title, seo_description = @seo_description,
      internal_notes = @internal_notes, status = @status, featured = @featured,
      sort_order = @sort_order, updated_at = @updated_at
     WHERE id = @id`,
  ).run({
    id,
    slug: slugify(data.slug ?? existing.slug),
    name: data.name ?? existing.name,
    description: data.description ?? existing.description,
    colour_note: data.colourNote ?? existing.colourNote,
    specs_json: JSON.stringify(data.specs ?? existing.specs),
    seo_title: data.seoTitle ?? existing.seoTitle,
    seo_description: data.seoDescription ?? existing.seoDescription,
    internal_notes: data.internalNotes ?? existing.internalNotes,
    status: data.status === 'draft' ? 'draft' : 'published',
    featured: data.featured !== undefined ? (data.featured ? 1 : 0) : (existing.featured ? 1 : 0),
    sort_order: data.sortOrder ?? existing.sortOrder,
    updated_at: new Date().toISOString(),
  });
  return getFilament(id, db);
}

export function deleteFilament(id, db = getDb()) {
  const existing = getFilament(id, db);
  if (!existing) return false;
  existing.colours.forEach((c) => deleteImageFile(c.imagePath));
  db.prepare('DELETE FROM filament_types WHERE id = ?').run(id);
  return true;
}

export function addColour(filamentTypeId, data, db = getDb()) {
  const parent = getFilament(filamentTypeId, db);
  if (!parent) return null;
  const now = new Date().toISOString();
  const id = randomUUID();
  const maxSort = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM filament_colours WHERE filament_type_id = ?')
    .get(filamentTypeId).m;
  db.prepare(
    `INSERT INTO filament_colours
      (id, filament_type_id, name, hex, sku, weight_g, roll_length_m, price_rand, stock_qty, image_path, notes, sort_order, created_at, updated_at)
     VALUES
      (@id, @filament_type_id, @name, @hex, @sku, @weight_g, @roll_length_m, @price_rand, @stock_qty, @image_path, @notes, @sort_order, @created_at, @updated_at)`,
  ).run({
    id,
    filament_type_id: filamentTypeId,
    name: data.name || '',
    hex: data.hex || '',
    sku: data.sku || id.slice(0, 8),
    weight_g: Number(data.weightG) || 0,
    roll_length_m: data.rollLengthM != null && data.rollLengthM !== '' ? Number(data.rollLengthM) : null,
    price_rand: Number(data.priceRand) || 0,
    stock_qty: Number(data.stockQty) || 0,
    image_path: null,
    notes: data.notes || '',
    sort_order: maxSort + 1,
    created_at: now,
    updated_at: now,
  });
  return getFilament(filamentTypeId, db);
}

export function updateColour(filamentTypeId, colourId, data, db = getDb()) {
  const existing = db.prepare('SELECT * FROM filament_colours WHERE id = ? AND filament_type_id = ?').get(colourId, filamentTypeId);
  if (!existing) return null;
  db.prepare(
    `UPDATE filament_colours SET
      name = @name, hex = @hex, sku = @sku, weight_g = @weight_g, roll_length_m = @roll_length_m,
      price_rand = @price_rand, stock_qty = @stock_qty, notes = @notes, updated_at = @updated_at
     WHERE id = @id`,
  ).run({
    id: colourId,
    name: data.name ?? existing.name,
    hex: data.hex ?? existing.hex,
    sku: data.sku ?? existing.sku,
    weight_g: data.weightG != null ? Number(data.weightG) : existing.weight_g,
    roll_length_m: data.rollLengthM != null && data.rollLengthM !== '' ? Number(data.rollLengthM) : existing.roll_length_m,
    price_rand: data.priceRand != null ? Number(data.priceRand) : existing.price_rand,
    stock_qty: data.stockQty != null ? Number(data.stockQty) : existing.stock_qty,
    notes: data.notes ?? existing.notes,
    updated_at: new Date().toISOString(),
  });
  return getFilament(filamentTypeId, db);
}

export function deleteColour(filamentTypeId, colourId, db = getDb()) {
  const existing = db.prepare('SELECT * FROM filament_colours WHERE id = ? AND filament_type_id = ?').get(colourId, filamentTypeId);
  if (!existing) return false;
  deleteImageFile(existing.image_path);
  db.prepare('DELETE FROM filament_colours WHERE id = ?').run(colourId);
  return true;
}

export function setColourImage(filamentTypeId, colourId, imagePath, db = getDb()) {
  const existing = db.prepare('SELECT * FROM filament_colours WHERE id = ? AND filament_type_id = ?').get(colourId, filamentTypeId);
  if (!existing) return null;
  if (existing.image_path) deleteImageFile(existing.image_path);
  db.prepare('UPDATE filament_colours SET image_path = ?, updated_at = ? WHERE id = ?').run(
    imagePath,
    new Date().toISOString(),
    colourId,
  );
  return getFilament(filamentTypeId, db);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/filaments.js server/filaments.test.js
git commit -m "feat: filament type + colour CRUD backed by SQLite"
```

---

### Task 8: `server/export.js` -- replaces `syncToSiteData`

**Files:**
- Create: `server/export.js`
- Test: `server/export.test.js`

**Interfaces:**
- Consumes: `listFilaments(db)` from `server/filaments.js`, `getSettings(db)`/`publicSettings` from `server/settings.js`.
- Produces: `readCategoryProducts(catalogJsonPath)`, `syncPublicJson(db, paths)` -- writes `filaments.json`/`categories.json`/`settings.json`/`site-settings.json` in the same shapes the generator already reads. `paths` param (all 4 target file paths + the catalog.json path) defaults to the real project paths but is overridable for tests.

- [ ] **Step 1: Write the failing test**

```javascript
// server/export.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb } from './db.js';
import { createFilament, addColour } from './filaments.js';
import { syncPublicJson, readCategoryProducts } from './export.js';

function tmpFile(name) {
  return path.join(os.tmpdir(), `export-test-${Date.now()}-${name}`);
}

test('readCategoryProducts filters to kind===category and handles a missing file', () => {
  const missing = tmpFile('missing.json');
  assert.deepStrictEqual(readCategoryProducts(missing), []);

  const file = tmpFile('catalog.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      products: [
        { kind: 'category', slug: 'toys', name: 'Toys', items: [] },
        { kind: 'filament', slug: 'pla', name: 'PLA' },
      ],
    }),
  );
  const cats = readCategoryProducts(file);
  assert.strictEqual(cats.length, 1);
  assert.strictEqual(cats[0].slug, 'toys');
  fs.unlinkSync(file);
});

test('syncPublicJson writes filaments.json with colour photo, price and stock fields', () => {
  const db = openDb(':memory:');
  const f = createFilament({ name: 'PLA', description: 'Standard PLA' }, db);
  addColour(f.id, { name: 'White', sku: 'SKU-1', priceRand: 299, weightG: 1000, stockQty: 5 }, db);

  const paths = {
    catalogJsonPath: tmpFile('catalog.json'),
    filamentsSrc: tmpFile('filaments.json'),
    categoriesSrc: tmpFile('categories.json'),
    settingsSrc: tmpFile('settings.json'),
    settingsPublic: tmpFile('site-settings.json'),
  };
  fs.writeFileSync(paths.catalogJsonPath, JSON.stringify({ products: [] }));

  syncPublicJson(db, paths);

  const filaments = JSON.parse(fs.readFileSync(paths.filamentsSrc, 'utf8'));
  assert.strictEqual(filaments.length, 1);
  assert.strictEqual(filaments[0].colours[0].price, 'R299');
  assert.strictEqual(filaments[0].colours[0].stockQty, 5);

  const settings = JSON.parse(fs.readFileSync(paths.settingsSrc, 'utf8'));
  assert.strictEqual(settings.siteName, 'Lapanza 3D Creative Lab');

  Object.values(paths).forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- `Cannot find module './export.js'`.

- [ ] **Step 3: Write the implementation**

```javascript
// server/export.js
import fs from 'fs';
import path from 'path';
import { listFilaments } from './filaments.js';
import { getSettings, publicSettings } from './settings.js';

const root = process.cwd(); // cwd-based (not __dirname) so tests can isolate via process.chdir()

const DEFAULT_PATHS = {
  catalogJsonPath: path.join(root, 'data', 'catalog.json'),
  filamentsSrc: path.join(root, 'src', 'data', 'filaments.json'),
  categoriesSrc: path.join(root, 'src', 'data', 'categories.json'),
  settingsSrc: path.join(root, 'src', 'data', 'settings.json'),
  settingsPublic: path.join(root, 'public', 'site-settings.json'),
};

export function readCategoryProducts(catalogJsonPath = DEFAULT_PATHS.catalogJsonPath) {
  if (!fs.existsSync(catalogJsonPath)) return [];
  const catalog = JSON.parse(fs.readFileSync(catalogJsonPath, 'utf8'));
  return (catalog.products || []).filter((p) => p.kind === 'category');
}

export function syncPublicJson(db, paths = DEFAULT_PATHS) {
  const filaments = listFilaments(db).map((f) => ({
    slug: f.slug,
    name: f.name,
    description: f.description,
    specs: f.specs,
    colourNote: f.colourNote,
    colours: f.colours.map((c) => ({
      name: c.name,
      sku: c.sku,
      price: `R${c.priceRand}`,
      weightG: c.weightG,
      rollLengthM: c.rollLengthM,
      stockQty: c.stockQty,
      imageUrl: c.imagePath || '',
    })),
  }));

  const categories = {};
  readCategoryProducts(paths.catalogJsonPath)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .forEach((p) => {
      categories[p.slug] = {
        slug: p.slug,
        name: p.name,
        description: p.description,
        crumbs: p.crumbs || `Home / ${p.name}`,
        ...(p.parent ? { parent: p.parent } : {}),
        items: (p.items || []).map((item) => ({
          name: item.name,
          details: item.details,
          material: item.material,
          size: item.size,
          finish: item.finish,
          price: item.price,
          sku: item.sku,
          imageUrl: item.imageUrl,
          available: item.available !== false,
        })),
      };
    });

  const settings = publicSettings(getSettings(db));

  fs.writeFileSync(paths.filamentsSrc, JSON.stringify(filaments, null, 2));
  fs.writeFileSync(paths.categoriesSrc, JSON.stringify(categories, null, 2));
  fs.writeFileSync(paths.settingsSrc, JSON.stringify(settings, null, 2));
  fs.writeFileSync(paths.settingsPublic, JSON.stringify(settings, null, 2));
}

export { DEFAULT_PATHS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/export.js server/export.test.js
git commit -m "feat: syncPublicJson replaces syncToSiteData, sources filaments from SQLite"
```

---

### Task 9: `server/store.js` -- trim to category products only

**Files:**
- Modify: `server/store.js` (full rewrite -- old filament/settings handling removed)
- Test: `server/store.test.js`

**Interfaces:**
- Consumes: `syncPublicJson` from `server/export.js`, `getDb` from `server/db.js`.
- Produces: `loadCatalog()`, `saveCatalog(catalog, db)`, `getProduct(id)`, `upsertProduct(product, db)`, `deleteProduct(id, db)` -- unchanged call shape from before, now scoped to category products only.

- [ ] **Step 1: Write the failing test**

```javascript
// server/store.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeAllCachedDbs } from './db.js';

test('upsertProduct adds a category product and getProduct retrieves it', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
  const originalCwd = process.cwd();
  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'public'), { recursive: true });
  process.chdir(tmpRoot);

  t.after(() => {
    closeAllCachedDbs(); // release the SQLite file handle before deleting its directory (Windows locks open handles)
    process.chdir(originalCwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const { upsertProduct, getProduct, deleteProduct } = await import(`./store.js?t=${Date.now()}`);

  const product = upsertProduct({ id: 'p1', kind: 'category', slug: 'toys', name: 'Toys', items: [] });
  assert.strictEqual(product.slug, 'toys');
  assert.ok(getProduct('p1'));

  assert.strictEqual(deleteProduct('p1'), true);
  assert.strictEqual(getProduct('p1'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- `store.js` still has the old catalog-with-settings shape, `upsertProduct` still branches on `kind === 'filament'` and won't match this test's assumptions cleanly. (If it happens to pass by coincidence, proceed anyway -- the rewrite in Step 3 is still required per the design.)

- [ ] **Step 3: Rewrite the implementation**

```javascript
// server/store.js
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { syncPublicJson } from './export.js';

const root = process.cwd(); // cwd-based (not __dirname) so tests can isolate via process.chdir()
const DATA_DIR = path.join(root, 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(path.join(root, 'public'))) fs.mkdirSync(path.join(root, 'public'), { recursive: true });
}

function now() {
  return new Date().toISOString();
}

export function loadCatalog() {
  ensureDir();
  if (!fs.existsSync(CATALOG_PATH)) {
    const seeded = { version: 1, updatedAt: now(), products: [] };
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

export function saveCatalog(catalog, db = getDb()) {
  ensureDir();
  catalog.updatedAt = now();
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  syncPublicJson(db);
  return catalog;
}

export function getProduct(id) {
  return loadCatalog().products.find((p) => p.id === id) || null;
}

export function upsertProduct(product, db = getDb()) {
  const catalog = loadCatalog();
  const idx = catalog.products.findIndex((p) => p.id === product.id);
  const ts = now();
  const record = { ...product, kind: 'category' };
  if (idx === -1) {
    record.createdAt = record.createdAt || ts;
    record.updatedAt = ts;
    if (!record.id) record.id = randomUUID();
    catalog.products.push(record);
  } else {
    record.createdAt = catalog.products[idx].createdAt || ts;
    record.updatedAt = ts;
    catalog.products[idx] = record;
  }
  saveCatalog(catalog, db);
  return record;
}

export function deleteProduct(id, db = getDb()) {
  const catalog = loadCatalog();
  const before = catalog.products.length;
  catalog.products = catalog.products.filter((p) => p.id !== id);
  if (catalog.products.length === before) return false;
  saveCatalog(catalog, db);
  return true;
}

export { now, randomUUID };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: All tests pass. (The `?t=timestamp` query-string import trick forces a fresh module instance per test run since `store.js` resolves its data paths relative to `process.cwd()` at import time -- acceptable here since this is the only test that needs cwd isolation.)

- [ ] **Step 5: Commit**

```bash
git add server/store.js server/store.test.js
git commit -m "refactor: trim store.js to category products only, delegate JSON export to syncPublicJson"
```

---

### Task 10: `server/index.js` -- route rewrite

**Files:**
- Modify: `server/index.js` (large rewrite)
- Test: `server/index.test.js`

**Interfaces:**
- Consumes: everything from Tasks 2-9.
- Produces: `export default app` (Express app, `.listen()` guarded so importing it for tests doesn't bind a port). New routes: `/api/setup/status`, `/api/setup`, `/api/admins*`, `/api/filaments*`, `/api/filaments/:id/colours/:colourId/image`. Changed: `/api/auth/login` (username+password), `/api/settings` (no adminPassword field), `/api/dashboard` (merges filament + category counts). Unchanged: `/api/products*` (category-only now), `/api/publish`, `/admin` static serving.

- [ ] **Step 1: Write the failing test**

```javascript
// server/index.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- `index.js` doesn't export `app`, still has the old single-password login, no `/api/setup*`, `/api/admins*`, or `/api/filaments*` routes.

- [ ] **Step 3: Rewrite the implementation**

```javascript
// server/index.js
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { getSettings, updateSettings, publicSettings } from './settings.js';
import { FONT_OPTIONS } from './settings-defaults.js';
import { hasAnyAdmin, listAdmins, createAdmin, deleteAdmin, resetPassword, verifyLogin } from './admins.js';
import {
  listFilaments,
  getFilament,
  createFilament,
  updateFilament,
  deleteFilament,
  addColour,
  updateColour,
  deleteColour,
  setColourImage,
} from './filaments.js';
import { uploadFilamentImage } from './uploads.js';
import { syncPublicJson, readCategoryProducts } from './export.js';
import { loadCatalog, saveCatalog, getProduct, upsertProduct, deleteProduct } from './store.js';

const root = process.cwd(); // cwd-based (not __dirname) so tests can isolate via process.chdir()
const PORT = Number(process.env.ADMIN_PORT || 8787);
const SESSION_COOKIE = 'lapanza_admin_session';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(root, 'public', 'uploads')));

const sessions = new Map();

function requireAuth(req, res, next) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function startSession(res) {
  const token = randomUUID();
  sessions.set(token, { createdAt: Date.now() });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'lapanza-admin', time: new Date().toISOString() });
});

app.get('/api/setup/status', (_req, res) => {
  res.json({ needsSetup: !hasAnyAdmin() });
});

app.post('/api/setup', (req, res) => {
  if (hasAnyAdmin()) return res.status(409).json({ error: 'Setup already completed' });
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username and an 8+ character password are required' });
  }
  try {
    createAdmin({ username, password });
    startSession(res);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const admin = verifyLogin(username, password);
  if (!admin) return res.status(401).json({ error: 'Invalid username or password' });
  startSession(res);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  res.json({ authenticated: Boolean(token && sessions.has(token)) });
});

app.get('/api/admins', requireAuth, (_req, res) => {
  res.json({ admins: listAdmins() });
});

app.post('/api/admins', requireAuth, (req, res) => {
  try {
    res.status(201).json({ admin: createAdmin(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admins/:id', requireAuth, (req, res) => {
  try {
    const ok = deleteAdmin(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Admin not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admins/:id/reset-password', requireAuth, (req, res) => {
  try {
    const ok = resetPassword(req.params.id, (req.body || {}).password);
    if (!ok) return res.status(404).json({ error: 'Admin not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/dashboard', requireAuth, (_req, res) => {
  const filaments = listFilaments();
  const categories = readCategoryProducts();
  const colourCount = filaments.reduce((n, f) => n + f.colours.length, 0);
  const itemCount = categories.reduce((n, c) => n + (c.items?.length || 0), 0);
  const draftCount = filaments.filter((f) => f.status === 'draft').length;
  const publishedCount = filaments.filter((f) => f.status === 'published').length;
  const recent = [...filaments]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 8)
    .map((f) => ({ id: f.id, name: f.name, kind: 'filament', status: f.status, updatedAt: f.updatedAt, slug: f.slug }));

  res.json({
    updatedAt: new Date().toISOString(),
    totals: {
      products: filaments.length + categories.length,
      filaments: filaments.length,
      categories: categories.length,
      colours: colourCount,
      catalogItems: itemCount,
      published: publishedCount,
      drafts: draftCount,
    },
    recent,
  });
});

app.get('/api/filaments', requireAuth, (_req, res) => {
  res.json({ filaments: listFilaments() });
});

app.get('/api/filaments/:id', requireAuth, (req, res) => {
  const filament = getFilament(req.params.id);
  if (!filament) return res.status(404).json({ error: 'Filament not found' });
  res.json({ filament });
});

app.post('/api/filaments', requireAuth, (req, res) => {
  const filament = createFilament(req.body || {});
  syncPublicJson(getDb());
  res.status(201).json({ filament });
});

app.put('/api/filaments/:id', requireAuth, (req, res) => {
  const filament = updateFilament(req.params.id, req.body || {});
  if (!filament) return res.status(404).json({ error: 'Filament not found' });
  syncPublicJson(getDb());
  res.json({ filament });
});

app.delete('/api/filaments/:id', requireAuth, (req, res) => {
  const ok = deleteFilament(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Filament not found' });
  syncPublicJson(getDb());
  res.json({ ok: true });
});

app.post('/api/filaments/:id/colours', requireAuth, (req, res) => {
  const filament = addColour(req.params.id, req.body || {});
  if (!filament) return res.status(404).json({ error: 'Filament not found' });
  syncPublicJson(getDb());
  res.status(201).json({ filament });
});

app.put('/api/filaments/:filamentId/colours/:colourId', requireAuth, (req, res) => {
  const filament = updateColour(req.params.filamentId, req.params.colourId, req.body || {});
  if (!filament) return res.status(404).json({ error: 'Colour not found' });
  syncPublicJson(getDb());
  res.json({ filament });
});

app.delete('/api/filaments/:filamentId/colours/:colourId', requireAuth, (req, res) => {
  const ok = deleteColour(req.params.filamentId, req.params.colourId);
  if (!ok) return res.status(404).json({ error: 'Colour not found' });
  syncPublicJson(getDb());
  res.json({ ok: true });
});

app.post(
  '/api/filaments/:filamentId/colours/:colourId/image',
  requireAuth,
  // Looks up the colour's sku BEFORE multer runs, so uploadFilamentImage's
  // storage.filename callback can build a SKU-traceable filename instead of
  // falling back to the colour's opaque UUID (Task 6 review finding).
  (req, res, next) => {
    const filament = getFilament(req.params.filamentId);
    const colour = filament?.colours.find((c) => c.id === req.params.colourId);
    if (!colour) return res.status(404).json({ error: 'Colour not found' });
    req.colourSku = colour.sku;
    next();
  },
  uploadFilamentImage.single('image'),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const imagePath = `/uploads/filaments/${req.file.filename}`;
    const filament = setColourImage(req.params.filamentId, req.params.colourId, imagePath);
    if (!filament) return res.status(404).json({ error: 'Colour not found' });
    syncPublicJson(getDb());
    res.json({ filament });
  },
);

app.get('/api/products', requireAuth, (req, res) => {
  const catalog = loadCatalog();
  let list = [...catalog.products];
  const { q, parent } = req.query;
  if (parent) list = list.filter((p) => p.parent === parent);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((p) => {
      const hay = [p.name, p.slug, p.description, ...(p.items || []).flatMap((i) => [i.name, i.sku, i.details])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }
  list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  res.json({ products: list, count: list.length });
});

app.get('/api/products/:id', requireAuth, (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json({ product });
});

app.post('/api/products', requireAuth, (req, res) => {
  const body = req.body || {};
  const product = {
    id: randomUUID(),
    kind: 'category',
    slug: slugify(body.slug || body.name || 'product'),
    name: body.name || 'Untitled product',
    description: body.description || '',
    crumbs: body.crumbs || '',
    parent: body.parent || null,
    items: normalizeItems(body.items),
  };
  upsertProduct(product);
  res.status(201).json({ product });
});

app.put('/api/products/:id', requireAuth, (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const body = req.body || {};
  const product = {
    ...existing,
    ...body,
    id: existing.id,
    kind: 'category',
    slug: slugify(body.slug || existing.slug),
    items: normalizeItems(body.items ?? existing.items),
  };
  upsertProduct(product);
  res.json({ product });
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  const ok = deleteProduct(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
});

app.get('/api/settings', requireAuth, (_req, res) => {
  res.json({ settings: publicSettings(getSettings()), fonts: FONT_OPTIONS });
});

app.put('/api/settings', requireAuth, (req, res) => {
  const body = req.body || {};
  const allowed = [
    'siteName', 'tagline', 'phoneDisplay', 'phoneTel', 'email', 'address', 'hours', 'whatsapp',
    'facebook', 'instagram', 'useUniversalFont', 'universalFont', 'fontSans', 'fontSerif',
    'defaultTheme', 'homeTiles',
  ];
  const patch = {};
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (typeof patch.useUniversalFont === 'string') {
    patch.useUniversalFont = patch.useUniversalFont === 'true';
  }
  if (patch.homeTiles) {
    patch.homeTiles = patch.homeTiles.slice(0, 3).map((t) => ({
      eyebrow: t.eyebrow || '',
      title: t.title || '',
      description: t.description || '',
    }));
  }
  const settings = updateSettings(patch);
  syncPublicJson(getDb());
  res.json({ settings: publicSettings(settings) });
});

app.post('/api/publish', requireAuth, async (_req, res) => {
  syncPublicJson(getDb());
  try {
    await runGenerate();
    res.json({ ok: true, message: 'Site pages regenerated from catalog.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Generate failed' });
  }
});

app.use('/admin', express.static(path.join(root, 'admin')));
app.get(/^\/admin(\/.*)?$/, (_req, res) => {
  res.sendFile(path.join(root, 'admin', 'index.html'));
});

app.get('/', (_req, res) => {
  res.redirect('/admin/');
});

function slugify(value) {
  return (
    String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'product'
  );
}

function normalizeItems(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item, i) => ({
    id: item.id || randomUUID(),
    name: item.name || `Item ${i + 1}`,
    details: item.details || '',
    material: item.material || '',
    size: item.size || '',
    finish: item.finish || '',
    price: item.price || '',
    sku: item.sku || '',
    imageUrl: item.imageUrl || '',
    available: item.available !== false,
    sortOrder: item.sortOrder ?? i,
  }));
}

function runGenerate() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`generate-pages exited with code ${code}`));
    });
  });
}

getDb();

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  app.listen(PORT, () => {
    console.log(`\n> Lapanza Admin API  http://localhost:${PORT}/admin/\n`);
  });
}

export default app;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/index.test.js
git commit -m "feat: rewrite server routes for multi-admin auth, filament CRUD, image upload"
```

---

### Task 11: `scripts/generate-pages.mjs` -- render colour photo

**Files:**
- Modify: `scripts/generate-pages.mjs:162-173` (the `colourCards` function)
- Test: `scripts/generate-pages.test.js`

**Interfaces:**
- Consumes: colour objects with the same shape `syncPublicJson` now writes to `src/data/filaments.json` -- `{ name, sku, price, imageUrl, ... }` (already the exact field names the function used before, `imageUrl` is the only new one it reads).

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/generate-pages.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

test('generate-pages renders an <img> for a colour with imageUrl, placeholder text otherwise', () => {
  const filamentsPath = path.join(root, 'src', 'data', 'filaments.json');
  const backup = fs.readFileSync(filamentsPath, 'utf8');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genpages-test-'));

  try {
    fs.writeFileSync(
      filamentsPath,
      JSON.stringify([
        {
          slug: 'test-pla',
          name: 'Test PLA',
          description: 'A test filament',
          specs: [],
          colours: [
            { name: 'With Photo', sku: 'SKU-1', price: 'R299', imageUrl: '/uploads/filaments/white.jpg' },
            { name: 'No Photo', sku: 'SKU-2', price: 'R299' },
          ],
        },
      ]),
    );

    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });

    const html = fs.readFileSync(path.join(root, 'filament', 'test-pla.html'), 'utf8');
    assert.match(html, /<img src="\/uploads\/filaments\/white\.jpg"/);
    assert.match(html, /Photo coming soon/);
  } finally {
    fs.writeFileSync(filamentsPath, backup);
    fs.rmSync(path.join(root, 'filament', 'test-pla.html'), { force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- no `<img>` tag present, `colourCards()` doesn't read `imageUrl` yet.

- [ ] **Step 3: Update `colourCards()`**

In `scripts/generate-pages.mjs`, replace the existing `colourCards` function (currently around line 162):

```javascript
function colourCards(colours) {
  if (!colours?.length) return '';
  return colours
    .map(
      (c) => `<div class="swatch-card border border-charcoal/10 rounded-sm p-4" data-colour-name="${c.name}">
                  ${
                    c.imageUrl
                      ? `<img src="${c.imageUrl}" alt="${c.name}" class="w-full aspect-square object-cover rounded-sm mb-3" loading="lazy">`
                      : `<div class="w-full aspect-square rounded-sm mb-3 bg-gradient-to-br from-linen to-cream flex items-center justify-center border border-charcoal/10"><span class="text-espresso/35 text-[0.65rem] uppercase tracking-[0.2em]">Photo coming soon</span></div>`
                  }
                  <p class="font-medium mb-1 tracking-tight">${c.name}</p>
                  <p class="text-espresso/45 text-[0.7rem] mb-2 font-mono">${c.sku}</p>
                  <p class="text-terracotta font-semibold">${c.price}</p>
                </div>`,
    )
    .join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Regenerate the real site and spot-check**

Run: `npm run generate`
Expected: exits 0, all filament pages rewritten (existing colours have no `imageUrl` yet, so they should all show the new "Photo coming soon" box instead of the old bare placeholder text -- visually equivalent, just now boxed like a real photo slot).

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-pages.mjs scripts/generate-pages.test.js
git commit -m "feat: render colour photo thumbnail on public filament pages"
```

---

### Task 12: Admin UI -- setup screen + username login

**Files:**
- Modify: `admin/admin.js` (login screen + new setup screen)

**Interfaces:**
- Consumes: `GET /api/setup/status`, `POST /api/setup`, `POST /api/auth/login` (now `{username, password}`).

- [ ] **Step 1: Read the current login rendering in `admin/admin.js`**

Find the function that renders the login form (search for `Enter admin password` -- this is the login screen built in JS, not static HTML). Note its exact structure before changing it, since the surrounding boot/auth-check logic (checking `/api/auth/me` on load) must still call the right next step.

- [ ] **Step 2: Add a setup-vs-login branch to the boot sequence**

Find the app's boot/init function (where it currently checks auth and decides whether to show the login screen or the dashboard). Add a check to `/api/setup/status` before that decision:

```javascript
async function boot() {
  const setupStatus = await api('/api/setup/status').catch(() => ({ needsSetup: false }));
  if (setupStatus.needsSetup) {
    renderSetupScreen();
    return;
  }
  const me = await api('/api/auth/me').catch(() => ({ authenticated: false }));
  if (me.authenticated) {
    renderApp();
  } else {
    renderLoginScreen();
  }
}
```

(Adapt this to however the existing boot function is actually named/structured -- the key change is: check `needsSetup` first, before the existing authenticated/not-authenticated branch.)

- [ ] **Step 3: Add `renderSetupScreen()`**

```javascript
function renderSetupScreen() {
  document.body.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <h1>Create your admin account</h1>
        <p class="muted">This is the first time the admin portal has run -- set the username and password you will use to sign in.</p>
        <label class="field"><span>Username</span><input id="setup-username" type="text" autocomplete="username" /></label>
        <label class="field"><span>Password (8+ characters)</span><input id="setup-password" type="password" autocomplete="new-password" /></label>
        <div id="setup-error" class="error hidden"></div>
        <button id="setup-submit" class="btn btn-primary" type="button">Create account</button>
      </div>
    </div>
  `;
  document.getElementById('setup-submit').addEventListener('click', async () => {
    const username = document.getElementById('setup-username').value.trim();
    const password = document.getElementById('setup-password').value;
    const errorEl = document.getElementById('setup-error');
    try {
      await api('/api/setup', { method: 'POST', body: JSON.stringify({ username, password }) });
      boot();
    } catch (ex) {
      errorEl.textContent = ex.message;
      errorEl.classList.remove('hidden');
    }
  });
}
```

- [ ] **Step 4: Update `renderLoginScreen()` to take a username field**

Locate the existing login-rendering code (built around a single password `<input>`). Add a username input above the password field, and change the submit handler to send `{ username, password }` instead of `{ password }`:

```javascript
function renderLoginScreen() {
  document.body.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <h1>Lapanza Admin</h1>
        <label class="field"><span>Username</span><input id="login-username" type="text" autocomplete="username" /></label>
        <label class="field"><span>Password</span><input id="login-password" type="password" placeholder="Enter admin password" autocomplete="current-password" /></label>
        <div id="login-error" class="error hidden"></div>
        <button id="login-submit" class="btn btn-primary" type="submit">Sign in</button>
      </div>
    </div>
  `;
  document.getElementById('login-submit').addEventListener('click', async () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      renderApp();
    } catch (ex) {
      errorEl.textContent = ex.message;
      errorEl.classList.remove('hidden');
    }
  });
}
```

(Keep whatever CSS classes the existing login screen already used -- `auth-screen`/`auth-card`/`field`/`btn btn-primary` above are placeholders for "match the existing class names," check `admin/admin.css` for the real ones before finalizing this edit.)

- [ ] **Step 5: Manual verification (no frontend test harness exists for admin.js -- none is being introduced here, consistent with the rest of the codebase)**

1. Delete `data/lapanza.db` if present (forces a fresh setup flow) -- **only in your local dev environment, never in a way that touches real customer data**.
2. Run: `node server/index.js`
3. In the browser, navigate to `http://localhost:8787/admin/` -- expect the "Create your admin account" screen, not the old password-only login.
4. Submit a username + 8+ character password -- expect it to log straight into the dashboard.
5. Sign out, reload -- expect the login screen now asks for both username and password, and rejects a wrong password with an inline error.

- [ ] **Step 6: Commit**

```bash
git add admin/admin.js
git commit -m "feat: admin UI first-run setup screen, username+password login"
```

---

### Task 13: Admin UI -- Admins management panel

**Files:**
- Modify: `admin/admin.js` (new panel in the Settings view, alongside the existing "Homepage tiles" panel added previously)

**Interfaces:**
- Consumes: `GET /api/admins`, `POST /api/admins`, `DELETE /api/admins/:id`, `POST /api/admins/:id/reset-password`.

- [ ] **Step 1: Add an "Admins" panel to `renderSettings()`**

Insert a new panel after the existing "Homepage tiles" panel (found via the marker comment/heading added in the prior session) and before "Public site contact":

```javascript
async function renderAdminsPanel() {
  const { admins } = await api('/api/admins');
  return `
    <div class="panel stack gap-3">
      <div class="section-head"><h3>Admin accounts</h3></div>
      <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">
        Everyone listed here has full access to this admin portal.
      </p>
      <div class="stack gap-2">
        ${admins
          .map(
            (a) => `
        <div class="flex items-center justify-between gap-3" style="padding:0.5rem 0;border-top:1px dashed var(--line)">
          <span>${escapeHtml(a.username)}</span>
          <div class="flex gap-2">
            <button class="btn btn-sm" data-reset-admin="${a.id}" type="button">Reset password</button>
            <button class="btn btn-sm btn-danger" data-remove-admin="${a.id}" type="button" ${admins.length <= 1 ? 'disabled' : ''}>Remove</button>
          </div>
        </div>`,
          )
          .join('')}
      </div>
      <div class="grid-2">
        <label class="field"><span>New admin username</span><input id="new-admin-username" type="text" /></label>
        <label class="field"><span>New admin password</span><input id="new-admin-password" type="password" /></label>
      </div>
      <div><button class="btn" id="add-admin" type="button">Add admin</button></div>
    </div>
  `;
}
```

- [ ] **Step 2: Splice it into the settings view and wire up the buttons**

In `renderSettings()`, after computing `s` and before building the big template string, fetch the panel HTML and insert it (following the same pattern used for the homeTiles panel -- insert its HTML string at the same anchor point, right before the `Public site contact` panel):

```javascript
const adminsPanelHtml = await renderAdminsPanel();
// ... splice adminsPanelHtml into the template in place of the "Public site contact" anchor,
// exactly the same way the homeTiles panel was spliced in during the previous session.
```

After `$('#view-settings').innerHTML = ...` is set, wire the new buttons (alongside the existing `$('#save-settings')` listener):

```javascript
$('#add-admin')?.addEventListener('click', async () => {
  const username = $('#new-admin-username').value.trim();
  const password = $('#new-admin-password').value;
  try {
    await api('/api/admins', { method: 'POST', body: JSON.stringify({ username, password }) });
    toast('Admin added');
    await renderSettings();
  } catch (ex) {
    toast(ex.message);
  }
});

$$('[data-reset-admin]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const password = prompt('New password for this admin (8+ characters):');
    if (!password) return;
    try {
      await api(`/api/admins/${btn.dataset.resetAdmin}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) });
      toast('Password reset');
    } catch (ex) {
      toast(ex.message);
    }
  });
});

$$('[data-remove-admin]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    if (!confirm('Remove this admin account?')) return;
    try {
      await api(`/api/admins/${btn.dataset.removeAdmin}`, { method: 'DELETE' });
      toast('Admin removed');
      await renderSettings();
    } catch (ex) {
      toast(ex.message);
    }
  });
});
```

- [ ] **Step 3: Manual verification**

1. Run `node server/index.js`, sign in, go to Settings.
2. Confirm the "Admin accounts" panel lists the current account with "Remove" disabled (only one admin).
3. Add a second admin -- confirm it appears, and "Remove" is now enabled on both.
4. Remove the second admin -- confirm it disappears and the first account's "Remove" button goes back to disabled.
5. Reset the current admin's password, sign out, sign back in with the new password -- confirm it works and the old password is rejected.

- [ ] **Step 4: Commit**

```bash
git add admin/admin.js
git commit -m "feat: admin accounts management panel (add/remove/reset password)"
```

---

### Task 14: Admin UI -- filament editor gets weight/roll length/stock/price/image

**Files:**
- Modify: `admin/admin.js` (the filament product editor -- find the existing colour-row rendering, search for `data-colour="name"`)

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /api/filaments*`, `POST /api/filaments/:id/colours/:colourId/image` (multipart).

- [ ] **Step 1: Point the editor's data fetching at `/api/filaments` instead of `/api/products`**

Find wherever the catalog/editor view currently calls `api('/api/products')` and `api('/api/products/:id')` for `kind === 'filament'` items -- repoint filament-kind fetches to `api('/api/filaments')` / `api('/api/filaments/:id')`, and filament save/delete calls to `POST/PUT/DELETE /api/filaments[/:id]`. Category-kind items keep using the existing `/api/products*` calls unchanged.

- [ ] **Step 2: Extend the colour-row template with the new fields**

Find the existing colour-row rendering (search for `data-colour="name"` in `admin/admin.js`, part of the product editor). Add weight/roll length/stock/price inputs and an image upload control alongside the existing name/sku/price/hex/notes fields:

```javascript
function colourRowHtml(c, i) {
  return `
    <div class="colour-row stack gap-2" data-colour-id="${c.id}" style="padding:0.75rem 0;border-top:1px dashed var(--line)">
      <div class="flex items-center gap-3">
        ${c.imagePath ? `<img src="${c.imagePath}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:4px" />` : `<div style="width:56px;height:56px;border-radius:4px;background:var(--panel-2)"></div>`}
        <input type="file" accept="image/jpeg,image/png,image/webp" data-colour-image="${c.id}" />
      </div>
      <div class="grid-2">
        <label class="field"><span>Colour name</span><input data-colour="name" value="${escapeAttr(c.name)}" /></label>
        <label class="field"><span>SKU</span><input data-colour="sku" value="${escapeAttr(c.sku)}" /></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Weight (g)</span><input data-colour="weightG" type="number" min="0" value="${c.weightG}" /></label>
        <label class="field"><span>Roll length (m, optional)</span><input data-colour="rollLengthM" type="number" min="0" step="0.1" value="${c.rollLengthM ?? ''}" /></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Price per roll (R)</span><input data-colour="priceRand" type="number" min="0" value="${c.priceRand}" /></label>
        <label class="field"><span>Stock quantity</span><input data-colour="stockQty" type="number" min="0" value="${c.stockQty}" /></label>
      </div>
      <label class="field"><span>Hex override</span><input data-colour="hex" value="${escapeAttr(c.hex || '')}" placeholder="#c24b28" /></label>
      <label class="field"><span>Notes</span><input data-colour="notes" value="${escapeAttr(c.notes || '')}" /></label>
      <button class="btn btn-sm btn-danger" data-remove-colour="${c.id}" type="button">Remove colour</button>
    </div>
  `;
}
```

- [ ] **Step 3: Wire the image upload input**

Alongside the existing save-handler wiring, add a per-colour file-input listener that uploads immediately on selection (simplest UX -- no separate "upload" button to forget to click):

```javascript
$$('[data-colour-image]').forEach((input) => {
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const colourId = input.dataset.colourImage;
    const filamentId = state.editingId;
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await fetch(`/api/filaments/${filamentId}/colours/${colourId}/image`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
      toast('Photo uploaded');
      await renderEditor(filamentId);
    } catch (ex) {
      toast(ex.message);
    }
  });
});
```

(`fetch` directly rather than the `api()` helper here, since `api()` always sets `Content-Type: application/json` -- multipart uploads need the browser to set their own `multipart/form-data` boundary header, which only happens when `Content-Type` is left unset.)

- [ ] **Step 4: Wire the new numeric fields into the save payload**

Find the colour-save-collection logic (wherever it currently reads `[data-colour]` inputs into an object per colour row) and confirm `weightG`, `rollLengthM`, `priceRand`, `stockQty` are picked up the same way `name`/`sku`/`hex`/`notes` already are (same `data-colour="<field>"` pattern, just new field names -- should require no structural change, only benefits from the new `data-colour` attributes added in Step 2).

- [ ] **Step 5: Manual verification**

1. Run `node server/index.js`, sign in, open the filament editor for an existing type (or create a new one).
2. Add a colour, fill in weight/roll length/price/stock, save -- confirm it persists (reload the editor, values still there).
3. Upload a photo for that colour -- confirm the thumbnail appears immediately without a page reload.
4. Click "Publish to site," then open the corresponding `filament/<slug>.html` page in the browser -- confirm the uploaded photo renders on the public page (Task 11's `colourCards()` change).
5. Set stock to 0 -- confirm it saves as 0 (not blank/NaN).

- [ ] **Step 6: Commit**

```bash
git add admin/admin.js
git commit -m "feat: filament editor gains weight/roll length/stock/price/image fields"
```

---

### Task 15: Full end-to-end verification + cleanup

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every test file from Tasks 2-11 passes.

- [ ] **Step 2: Fresh-boot walkthrough**

1. Stop any running `node server/index.js` process.
2. Delete `data/lapanza.db` (and `-wal`/`-shm` siblings if present) to force the migration path to run again from the current `data/catalog.json`.
3. Start the server: `node server/index.js`.
4. Confirm the console log shows the admin URL (no password printed anymore -- that line should be gone since there is no more default shared password).
5. In the browser: setup screen appears -> create your real admin account -> dashboard loads -> existing filament types (PLA, PETG, etc.) are all present with their original colours, now with `weightG: 0`, `stockQty` migrated from `inStock` (1 or 0), `rollLengthM: null` -- exactly as the migration is designed to produce.
6. Open `data/catalog.json` -- confirm it now contains only category products (car-parts/toys/homeware/phones), no `settings` key, no filament products.
7. Run `npm run generate` (or click "Publish to site" in the admin UI) -- confirm it completes without error and the public filament pages still render correctly (spot-check `filament/pla.html` in the browser).

- [ ] **Step 3: Confirm the public site and other admin flows still work**

1. Start the Vite dev server (`npx vite`) alongside the admin server.
2. Visit `http://localhost:5173/index.html` -- confirm homepage, nav, and a filament detail page all render with no console errors.
3. In the admin portal, edit a car-parts/toys/homeware/phones category item (unaffected by this plan) -- confirm it still saves correctly through the unchanged `/api/products` endpoints.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 1 complete -- filament catalog on SQLite, multi-admin auth, image upload"
```
