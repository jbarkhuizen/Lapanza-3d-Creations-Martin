# Phase 1: Filament Catalog + Multi-Admin Auth + Images

Status: Approved for implementation
Scope: Foundation for the storefront (cart/shipping = Phase 3, scrape import = Phase 2, both later)

## Goal

Extend the filament catalog so every colour is a real purchasable SKU (weight,
roll length, stock quantity, price per roll, photo), move admin auth to
multiple named accounts, and put the catalog on storage that can safely
support real orders next phase.

## Storage: SQLite (better-sqlite3)

data/lapanza.db, single file, gitignored (same pattern as today's
data/catalog.json). No external DB server, no new ops burden. Chosen over
staying JSON-only because Phase 3 needs safe stock decrement under concurrent
checkouts -- JSON read-modify-write has no real transaction. SQLite gives that
for free while staying a zero-config file, and is a straightforward stepping
stone to Postgres later if hosting ever needs more than one machine.

Split of responsibility (deliberately not a full rewrite):

- Moves to SQLite: filament types, filament colours, admin accounts, site
  settings.
- Stays in data/catalog.json: car-parts/toys/homeware/phones category
  items. Not part of this request, no stock/price race risk (they're
  printed to order, not stock-tracked), touching them now would be scope
  creep. catalog.json is rewritten during migration to hold only
  { version, updatedAt, products: [...categoryItemsOnly] } -- settings key
  removed from it (moved to DB).

## Schema

```sql
CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE filament_types (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  colour_note TEXT NOT NULL DEFAULT '',
  specs_json TEXT NOT NULL DEFAULT '[]',   -- [{label, value}] -- flexible, not worth its own table
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published', -- 'draft' | 'published'
  featured INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE filament_colours (
  id TEXT PRIMARY KEY,
  filament_type_id TEXT NOT NULL REFERENCES filament_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hex TEXT NOT NULL DEFAULT '',
  sku TEXT UNIQUE NOT NULL,
  weight_g INTEGER NOT NULL DEFAULT 0,
  roll_length_m REAL,                       -- nullable: not on the source site, manual entry
  price_rand INTEGER NOT NULL DEFAULT 0,     -- whole Rand, no cents seen anywhere in real data
  stock_qty INTEGER NOT NULL DEFAULT 0,
  image_path TEXT,                          -- '/uploads/filaments/<file>' or NULL
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL   -- JSON-encoded
);
```

Price/weight become real numbers now (not the current opaque "R299"
string) specifically because Phase 3 cart math needs to add them up -- doing
it now avoids re-parsing display strings later. Display formatting
(R + price_rand) happens at render time, same as today.

## Migration (automatic, on first boot)

server/db.js creates the schema if data/lapanza.db doesn't exist, then
runs a one-time import if the DB is empty:

- catalog.json products where kind === 'filament' -> one filament_types
  row + N filament_colours rows (weight/roll length/stock default to 0/NULL
  since the old schema didn't have them -- admin fills in real values,
  starting with the Phase 2 scrape import).
- catalog.json settings (siteName, tagline, homeTiles, fonts, etc.) ->
  settings table, one row per key. adminPassword / adminPasswordHash
  are dropped, not migrated -- the new multi-admin model replaces the
  single shared login outright (see below).
- catalog.json products where kind === 'category' stay in the file;
  catalog.json is rewritten without settings and without the migrated
  filament products.

No manual step. Same auto-seed pattern the site already uses.

## Admin auth (multi-account)

- admins table, bcrypt-hashed passwords, session cookie unchanged from
  today's implementation.
- First boot, zero admins: GET /api/setup/status -> { needsSetup: true }.
  Admin portal shows a "Create your first admin account" form instead of
  login. POST /api/setup creates that account (only works while the table
  is empty) and logs in.
- Once at least one admin exists: POST /api/auth/login takes
  { username, password } (was password-only).
- New "Admins" panel in Settings: list accounts, add one, remove one (block
  removing the last remaining admin), reset a password. No role
  differentiation -- every admin account has equal access, matching what
  exists today.

## Images

- multer (already a dependency, currently unused -- no new install) saves
  to public/uploads/filaments/.
- One image per colour (matches how the source site organizes photos --
  each colour is its own listing with its own shot).
- Upload endpoint returns the saved path, admin UI attaches it to
  image_path on that colour via the normal save flow.
- Filename: <sku>-<shortRandomHash>.<ext> -- avoids collisions, stays
  traceable to the SKU.

## API surface (new/changed)

```
GET    /api/setup/status
POST   /api/setup                              { username, password }

POST   /api/auth/login                          { username, password }  (was password only)
GET    /api/admins                              requireAuth
POST   /api/admins                              { username, password }
DELETE /api/admins/:id
POST   /api/admins/:id/reset-password           { password }

GET    /api/filaments
GET    /api/filaments/:id
POST   /api/filaments                           create type
PUT    /api/filaments/:id                       update type + specs
DELETE /api/filaments/:id                       cascades colours + their image files

POST   /api/filaments/:id/colours               add colour
PUT    /api/filaments/:filamentId/colours/:id   update (incl. stock/price/weight/roll length)
DELETE /api/filaments/:filamentId/colours/:id   removes its image file too
POST   /api/filaments/:filamentId/colours/:id/image   multipart upload -> sets image_path
```

Existing generic /api/products* endpoints keep serving category items
only (car-parts/toys/homeware/phones) -- filaments move off them entirely
onto the routes above.

## Publish pipeline

scripts/generate-pages.mjs itself is unchanged -- it still just reads
src/data/filaments.json / categories.json / settings.json. What
changes is the export step: syncToSiteData()-equivalent now queries
SQLite for filaments/settings (instead of reading them off the in-memory
catalog object) while still reading categories from catalog.json, and
writes the same JSON shapes as before. This keeps the generator + public
page templates untouched and contains the blast radius to the sync layer.

One small template addition: colourCards() in the generator renders the
colour's photo (thumbnail) if imageUrl is present, falling back to today's
"Photo coming soon" placeholder. Stock badges and an Add-to-Cart button are
explicitly out of scope this phase -- they land in Phase 3 alongside the
cart, since that's when the colour card gets redesigned anyway.

## Out of scope (this phase)

- Cart, shipping options, checkout, orders (Phase 3)
- Scraping/importing real diyelectronics.co.za data (Phase 2 -- depends on
  this phase's schema existing first)
- Payment integration, prebuilt-products catalog (later, separate specs)
