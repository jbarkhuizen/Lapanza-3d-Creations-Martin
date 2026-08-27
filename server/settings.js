import { getDb } from './db.js';
import { DEFAULT_SETTINGS } from './settings-defaults.js';

// inHouseFilamentBrands shipped as a plain string[] before the configurable-
// lists feature -- installs with that already saved to the DB would
// otherwise get a stored array of raw strings back where every consumer
// now expects {id,name,active} objects. Upgrading in-place here (not via a
// one-time migration) means it self-heals on every read regardless of when
// an install last touched this setting, and a fresh string typed into the
// old textarea shape (if anything ever sends one again) degrades safely
// too instead of crashing.
const LIST_SETTING_KEYS = ['inHouseFilamentBrands', 'todoCategories', 'todoPriorities', 'carPartModelsLandrover', 'carPartModelsGwm'];

function normalizeListSetting(value) {
  if (!Array.isArray(value)) return value;
  return value.map((entry, i) =>
    typeof entry === 'string'
      ? { id: entry.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `item-${i}`, name: entry, active: true }
      : entry,
  );
}

export function getSettings(db = getDb()) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = {};
  rows.forEach((r) => {
    stored[r.key] = JSON.parse(r.value);
  });
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  for (const key of LIST_SETTING_KEYS) merged[key] = normalizeListSetting(merged[key]);
  return merged;
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
