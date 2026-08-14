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
    }).catch(() => {
      // migrate-json.js not available yet, will be implemented in later task
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
