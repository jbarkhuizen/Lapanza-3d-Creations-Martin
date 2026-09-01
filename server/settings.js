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
const LIST_SETTING_KEYS = ['inHouseFilamentBrands', 'todoCategories', 'todoPriorities', 'carPartModelsLandrover', 'carPartModelsGwm', 'carPartBrands'];

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

// Explicit allowlist of what the public storefront is allowed to see.
// This function's output is written verbatim to /site-settings.json on the
// public web root (server/export.js) -- before this list existed it was a
// pass-through, publishing the bank account number, the entire print-cost
// model (markup/electricity/design/setup rates), operational-alert
// thresholds, and admin email templates to anyone with curl (launch-audit
// blocker #3). Every key here is verified in use by src/js/* or the
// generated pages' client-side hydration; anything new must be ADDED
// deliberately, never inherited. Banking details are deliberately absent:
// the one public consumer (checkout's manual-EFT success panel) now gets
// them from the checkout response itself, and the invoice email carries
// them too.
const PUBLIC_SETTINGS_KEYS = [
  // Identity + contact (site.js, nav.js, checkout, get-in-touch hydration)
  'siteName', 'tagline', 'phoneDisplay', 'phoneTel', 'email', 'address', 'hours',
  'whatsapp', 'whatsappResponseNote', 'escalationContactsNote', 'facebook', 'instagram',
  // Appearance (appearance.js)
  'useUniversalFont', 'universalFont', 'fontSans', 'fontSerif', 'defaultTheme',
  // Public content (site.js hydration)
  'homeTiles', 'featuredProducts', 'testimonials',
  // Commerce display (cart-ui.js delivery note, checkout volume discount,
  // generate-pages' "Only N left" stock labels and car-part brand pages --
  // the same filtered object feeds src/data/settings.json at build time)
  'printLeadTimeDays', 'filamentDispatchDays', 'volumeDiscounts', 'lowStockThreshold', 'carPartBrands',
];

export function publicSettings(settings) {
  const publicView = {};
  for (const key of PUBLIC_SETTINGS_KEYS) {
    if (settings[key] !== undefined) publicView[key] = settings[key];
  }
  return publicView;
}
