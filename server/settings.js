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
