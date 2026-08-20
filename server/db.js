import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { migrateFromCatalogJson } from './migrate-json.js';
import { dataDir } from './paths.js';

function ensureDataDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function ensureSchema(db) {
  db.pragma('foreign_keys = ON');
  // One-time redesign of print_jobs from single-filament/role-based
  // (model_g/support_g/...) to multi-filament slots (print_job_filaments).
  // A DROP+recreate here is only safe because this table shipped in this
  // same project phase with no real rows in production yet -- this is NOT
  // the normal pattern (see hasColumn/guarded-ALTER below for that).
  const stillOldShape = db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='print_jobs'")
    .get().n > 0 && db.prepare('PRAGMA table_info(print_jobs)').all().some((c) => c.name === 'model_g');
  if (stillOldShape) db.exec('DROP TABLE print_jobs');
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

    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_path TEXT,
      file_path TEXT,
      print_settings TEXT NOT NULL DEFAULT '',
      filament_type TEXT NOT NULL DEFAULT '',
      dimensions TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Phase 2: client accounts, newsletter, custom design requests.

    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      token TEXT NOT NULL,
      subscribed_at TEXT NOT NULL,
      confirmed_at TEXT,
      unsubscribed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_token ON newsletter_subscribers (token);

    CREATE TABLE IF NOT EXISTS design_requests (
      id TEXT PRIMARY KEY,
      client_id TEXT REFERENCES clients(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      budget_note TEXT NOT NULL DEFAULT '',
      reference_image_path TEXT,
      reference_file_path TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      admin_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_design_requests_status ON design_requests (status);

    -- Phase 3: print-job costing (internal-only, never touches storefront
    -- pricing) and supplier purchase tracking. Both fully separate from
    -- orders/products.

    CREATE TABLE IF NOT EXISTS print_jobs (
      id TEXT PRIMARY KEY,
      item_name TEXT NOT NULL,
      total_grams REAL NOT NULL DEFAULT 0,
      total_meters REAL NOT NULL DEFAULT 0,
      print_time_minutes INTEGER NOT NULL DEFAULT 0,
      design_hours REAL NOT NULL DEFAULT 0,
      setup_hours REAL NOT NULL DEFAULT 0,
      post_processing_hours REAL NOT NULL DEFAULT 0,
      markup_pct REAL NOT NULL DEFAULT 0,
      filament_cost REAL NOT NULL DEFAULT 0,
      power_cost REAL NOT NULL DEFAULT 0,
      labour_cost REAL NOT NULL DEFAULT 0,
      running_cost REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      markup_amount REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      reference_file_path TEXT,
      reference_image_path TEXT,
      status TEXT NOT NULL DEFAULT 'printed',
      date_printed TEXT,
      created_at TEXT NOT NULL
    );

    -- In-house filament: physically-open rolls kept for local/internal
    -- printing, separate from the storefront Filament Library (which is the
    -- sellable catalog with its own SKU/price/spool tracking). Weight and
    -- roll_length_m are the per-roll spec (same convention as
    -- filament_colours.weight_g/roll_length_m); rolls_available x that spec
    -- gives total stock, used_g/used_m track cumulative consumption from
    -- logged print jobs -- same "computed at read time, never stored
    -- remaining/percent" pattern as filament_colours.
    CREATE TABLE IF NOT EXISTS in_house_filament (
      id TEXT PRIMARY KEY,
      filament_type TEXT NOT NULL,
      color_name TEXT NOT NULL,
      rolls_available INTEGER NOT NULL DEFAULT 0,
      weight_g INTEGER NOT NULL DEFAULT 0,
      roll_length_m REAL NOT NULL DEFAULT 0,
      cost_per_roll_rand INTEGER NOT NULL DEFAULT 0,
      used_g REAL NOT NULL DEFAULT 0,
      used_m REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Up to 4 filaments per job (multi-material/multi-colour prints), each
    -- with its own grams + metres used. Replaces the single-filament,
    -- role-based (model/support/purge/tower) shape print_jobs originally
    -- shipped with -- see the one-time migration below for why that's a
    -- DROP+recreate instead of the usual guarded ALTER TABLE.
    CREATE TABLE IF NOT EXISTS print_job_filaments (
      id TEXT PRIMARY KEY,
      print_job_id TEXT NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
      in_house_filament_id TEXT NOT NULL REFERENCES in_house_filament(id),
      grams REAL NOT NULL DEFAULT 0,
      meters REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      slot_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_print_job_filaments_job ON print_job_filaments (print_job_id);
    CREATE INDEX IF NOT EXISTS idx_print_job_filaments_filament ON print_job_filaments (in_house_filament_id);

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      supplier TEXT NOT NULL,
      goods TEXT NOT NULL DEFAULT '',
      total_value INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'outstanding',
      payment_type TEXT NOT NULL DEFAULT '',
      purchase_date TEXT,
      created_at TEXT NOT NULL
    );

    -- Phase 4: marketing campaigns. Separate from newsletter_subscribers
    -- (the audience list) -- these are the actual messages sent, with a
    -- compose -> approve -> send lifecycle.
    CREATE TABLE IF NOT EXISTS newsletter_campaigns (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      approved_at TEXT,
      sent_at TEXT,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0
    );

    -- template_params_json holds the {{1}}/{{2}}... substitution values for
    -- the Meta-approved template named by template_name -- WhatsApp Business
    -- API requires a pre-approved template for any business-initiated
    -- broadcast, free text isn't accepted (see server/whatsapp.js).
    CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
      id TEXT PRIMARY KEY,
      template_name TEXT NOT NULL,
      template_params_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      approved_at TEXT,
      sent_at TEXT,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0
    );

    -- Post-launch: visitor analytics. One row per real page load (never per
    -- heartbeat -- see server/analytics.js for why "currently active" is
    -- tracked in memory instead of here). visitor_id is a random client-
    -- generated identifier (localStorage), never an IP address or anything
    -- else identifying on its own -- client_id is only attached when the
    -- visitor happens to have a valid logged-in client session at that
    -- moment, which is the one case this table does hold real personal data.
    CREATE TABLE IF NOT EXISTS page_views (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      client_id TEXT REFERENCES clients(id),
      path TEXT NOT NULL,
      referrer TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views (created_at);
    CREATE INDEX IF NOT EXISTS idx_page_views_visitor ON page_views (visitor_id);

    CREATE TABLE IF NOT EXISTS version_history (
      id TEXT PRIMARY KEY,
      version_number INTEGER NOT NULL UNIQUE,
      description TEXT NOT NULL,
      deployed_date TEXT NOT NULL,
      deployed_by TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_version_history_number ON version_history (version_number DESC);
  `);
  ensureCheckoutColumns(db);
  ensureClientAuthColumns(db);
  ensureManagementColumns(db);
  ensureEngagementColumns(db);
  ensurePasswordResetColumns(db);
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

// Phase 2: a `clients` row becomes a real account once password_hash is set
// (NULL means it's still just a guest-checkout record) -- no separate
// accounts table, this table already carries everything an account needs.
function ensureClientAuthColumns(db) {
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'password_hash')) {
    db.exec('ALTER TABLE clients ADD COLUMN password_hash TEXT');
  }
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'email_verified')) {
    db.exec('ALTER TABLE clients ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'verification_token')) {
    db.exec('ALTER TABLE clients ADD COLUMN verification_token TEXT');
  }
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'verification_token_expires')) {
    db.exec('ALTER TABLE clients ADD COLUMN verification_token_expires TEXT');
  }
}

// Phase 3: invoicing, manual orders, client discounts/lead-source, shipping
// option types, and filament spool consumption -- all additive columns on
// already-shipped tables, so guarded ALTER TABLEs same as the two functions
// above.
function ensureManagementColumns(db) {
  if (!hasColumn(db, 'PRAGMA table_info(orders)', 'invoice_number')) {
    db.exec('ALTER TABLE orders ADD COLUMN invoice_number TEXT');
  }
  // Discount is applied only on manually-created orders (createManualOrder
  // in orders.js) -- online checkout orders always have discount_pct = 0.
  // Stored on the order itself (not just computed from the client's
  // discount_pct at read time) so the invoice reflects what the discount
  // actually was at the time of sale, even if the client's discount % is
  // changed later.
  if (!hasColumn(db, 'PRAGMA table_info(orders)', 'discount_pct')) {
    db.exec('ALTER TABLE orders ADD COLUMN discount_pct REAL NOT NULL DEFAULT 0');
  }
  if (!hasColumn(db, 'PRAGMA table_info(orders)', 'discount_amount')) {
    db.exec('ALTER TABLE orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'discount_pct')) {
    db.exec('ALTER TABLE clients ADD COLUMN discount_pct REAL NOT NULL DEFAULT 0');
  }
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'discount_note')) {
    db.exec("ALTER TABLE clients ADD COLUMN discount_note TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'source')) {
    db.exec("ALTER TABLE clients ADD COLUMN source TEXT NOT NULL DEFAULT ''");
  }
  // Cumulative consumption logged by print jobs (server/print-jobs.js) --
  // remaining/%left are computed at read time from stock_qty * roll_length_m
  // minus these, never stored, so there's only one source of truth.
  if (!hasColumn(db, 'PRAGMA table_info(filament_colours)', 'used_m')) {
    db.exec('ALTER TABLE filament_colours ADD COLUMN used_m REAL NOT NULL DEFAULT 0');
  }
  if (!hasColumn(db, 'PRAGMA table_info(filament_colours)', 'used_g')) {
    db.exec('ALTER TABLE filament_colours ADD COLUMN used_g REAL NOT NULL DEFAULT 0');
  }
  // 'auto_weight' = today's matchShippingForWeight bracket matching
  // (unchanged behavior). 'fixed' = a named flat-price option the customer
  // or admin picks directly (PUDO lockers, local delivery zones) -- price
  // doesn't depend on cart weight, so bracket matching doesn't apply.
  if (!hasColumn(db, 'PRAGMA table_info(shipping_options)', 'option_type')) {
    db.exec("ALTER TABLE shipping_options ADD COLUMN option_type TEXT NOT NULL DEFAULT 'auto_weight'");
  }
}

// Phase 4: login-activity tracking + WhatsApp marketing consent (separate
// from newsletter_subscribers -- email and WhatsApp are separate consents).
function ensureEngagementColumns(db) {
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'last_login_at')) {
    db.exec('ALTER TABLE clients ADD COLUMN last_login_at TEXT');
  }
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'whatsapp_opt_in')) {
    db.exec('ALTER TABLE clients ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0');
  }
}

// Password recovery: separate token pair from verification_token above so a
// pending email-verification link and a pending reset link can't clobber
// each other if both are outstanding at once.
function ensurePasswordResetColumns(db) {
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'reset_token')) {
    db.exec('ALTER TABLE clients ADD COLUMN reset_token TEXT');
  }
  if (!hasColumn(db, 'PRAGMA table_info(clients)', 'reset_token_expires')) {
    db.exec('ALTER TABLE clients ADD COLUMN reset_token_expires TEXT');
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
  const dbPath = path.join(dataDir(), 'lapanza.db');
  if (_dbCache.has(dbPath)) return _dbCache.get(dbPath);
  const isNew = !fs.existsSync(dbPath);
  const db = openDb(dbPath);
  _dbCache.set(dbPath, db);
  if (isNew) {
    const catalogJsonPath = path.join(dataDir(), 'catalog.json');
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
