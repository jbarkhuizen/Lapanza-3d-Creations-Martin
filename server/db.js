import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { migrateFromCatalogJson } from './migrate-json.js';

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

    -- Checkout/orders schema. This project has no migration framework --
    -- schema changes live here as idempotent CREATE TABLE IF NOT EXISTS,
    -- the same pattern already used for every table above, run on every
    -- boot via getDb()/openDb(). Weight is stored in GRAMS everywhere
    -- (matches filament_colours.weight_g already above) -- every weight
    -- column/field in this feature (clients... no; shipping brackets,
    -- order_items, orders.total_weight, cart.js, data-weight attributes)
    -- uses grams consistently end to end.

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      client_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      street TEXT NOT NULL DEFAULT '',
      suburb TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT 'South Africa',
      created_at TEXT NOT NULL
    );
    -- Case-insensitive email matching (B.3) is done in application code via
    -- LOWER(email) = LOWER(?), so this index accelerates that lookup;
    -- SQLite has no case-insensitive UNIQUE constraint for arbitrary
    -- unicode without a COLLATE NOCASE column, which would also affect
    -- ordering/display -- an index is enough since the app is the only
    -- writer and always checks-then-inserts inside one transaction.
    CREATE INDEX IF NOT EXISTS idx_clients_email ON clients (email);

    CREATE TABLE IF NOT EXISTS shipping_options (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      min_weight INTEGER NOT NULL,
      max_weight INTEGER,
      price INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id),
      status TEXT NOT NULL DEFAULT 'pending_payment',
      subtotal INTEGER NOT NULL DEFAULT 0,
      shipping_option_id TEXT REFERENCES shipping_options(id),
      shipping_price INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      total_weight INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      tracking_number TEXT NOT NULL DEFAULT '',
      confirmation_email_sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_client ON orders (client_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      weight INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

    CREATE TABLE IF NOT EXISTS payment_transactions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      gateway TEXT NOT NULL,
      gateway_reference TEXT,
      raw_payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payment_transactions_order ON payment_transactions (order_id);
    -- Payfast can resend the same ITN (their docs explicitly warn of this);
    -- gateway+gateway_reference+status is the natural idempotency key so a
    -- duplicate ITN for a reference already recorded at that status is a
    -- no-op instead of a second row.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_idempotent
      ON payment_transactions (gateway, gateway_reference, status);
  `);
  ensureCheckoutColumns(db);
}

function hasColumn(db, tableInfoStatement, column) {
  return db.prepare(tableInfoStatement).all().some((c) => c.name === column);
}

// SQLite has no "ADD COLUMN IF NOT EXISTS", so columns added to an
// already-shipped table (as opposed to a brand new CREATE TABLE above) go
// here as guarded ALTER TABLEs -- same idempotent-on-every-boot philosophy
// as the rest of this file, just at column granularity. PRAGMA doesn't
// support bound parameters for identifiers, so each table name is a plain
// hardcoded literal below rather than interpolated.
function ensureCheckoutColumns(db) {
  // Filament colours already had weight_g ("Filament Weight" -- the
  // product's own net weight, shown as a spec). shipping_weight_g is a
  // separate figure admins can set when the parcel weight for shipping
  // differs from the item's own weight (packaging, etc); it's what
  // drives shipping-bracket matching, not weight_g. Backfilled from
  // weight_g so existing catalog data keeps working with no admin action
  // required until they want to override it.
  if (!hasColumn(db, 'PRAGMA table_info(filament_colours)', 'shipping_weight_g')) {
    db.exec('ALTER TABLE filament_colours ADD COLUMN shipping_weight_g INTEGER');
    db.exec('UPDATE filament_colours SET shipping_weight_g = weight_g WHERE shipping_weight_g IS NULL');
  }
  // Client name is now captured as first/last (+ optional business name)
  // at checkout, but `name` is kept and still populated (see clients.js)
  // so every existing read site (admin list, packing slip, order emails)
  // keeps working unchanged.
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'first_name')) {
    db.exec("ALTER TABLE clients ADD COLUMN first_name TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'last_name')) {
    db.exec("ALTER TABLE clients ADD COLUMN last_name TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'business_name')) {
    db.exec("ALTER TABLE clients ADD COLUMN business_name TEXT NOT NULL DEFAULT ''");
  }
  // Every order placed before this column existed was implicitly our-
  // courier (it was the only option), so backfill to 'courier' rather
  // than leaving historical rows with an empty/null method.
  if (!hasColumn(db, 'PRAGMA table_info(orders)', 'shipping_method')) {
    db.exec("ALTER TABLE orders ADD COLUMN shipping_method TEXT NOT NULL DEFAULT 'courier'");
  }
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
    try {
      migrateFromCatalogJson(db, catalogJsonPath);
    } catch (err) {
      // Migration must not fail silently: a swallowed error here would leave
      // a fresh, empty database masquerading as a successful first boot
      // (needsSetup: true, no filaments, no visible cause), and the first
      // admin action afterward would overwrite the git-tracked
      // src/data/filaments.json with that empty state. Log loudly and
      // remove the just-opened db from the cache before rethrowing so a
      // retry (e.g. a subsequent getDb() call) doesn't see a half-migrated
      // connection cached as if it were healthy.
      console.error('Catalog migration failed:', err);
      _dbCache.delete(dbPath);
      db.close();
      // Also delete the just-created (now known-broken) db file itself.
      // Without this, the file left on disk makes `isNew` (`!fs.existsSync`)
      // false on the NEXT boot attempt, so a restart after a failed
      // migration would silently skip migration entirely and proceed with
      // an empty database instead of retrying -- defeating the point of
      // throwing loudly here in the first place.
      try {
        fs.rmSync(dbPath, { force: true });
        // WAL mode may also leave -wal/-shm sidecar files; clean those up
        // too so a retry starts from a truly clean slate.
        fs.rmSync(`${dbPath}-wal`, { force: true });
        fs.rmSync(`${dbPath}-shm`, { force: true });
      } catch (cleanupErr) {
        console.error('Failed to remove broken db file after migration failure:', cleanupErr);
      }
      throw err;
    }
  }
  return db;
}

// Test-only: closes every cached connection so a temp directory holding one
// can be deleted afterward (Windows locks open file handles, unlike POSIX).
export function closeAllCachedDbs() {
  for (const db of _dbCache.values()) db.close();
  _dbCache.clear();
}
