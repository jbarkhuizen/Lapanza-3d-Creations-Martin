import path from 'path';
import fs from 'fs';
import { dataDir } from './paths.js';
import { getSettings } from './settings.js';

// Owner request (2026-09-06): let checkout customers pick the exact PUDO
// locker (The Courier Guy) their parcel ships to. TCG publishes a lockers
// endpoint, but it needs an API key from a (free) PUDO account -- there is
// no keyless public source (integrators like OneDayOnly proxy it behind
// their own backend for the same reason). So this module is that proxy:
// fetch with the admin-entered key (settings.pudoApiKey), cache to disk,
// and serve the storefront a slim public list. No key or a dead API just
// means an empty list -- checkout falls back to manual locker entry.
const LOCKERS_URL = 'https://api-pudo.co.za/api/v1/lockers-data';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // locker network changes rarely

const cacheFile = () => path.join(dataDir(), 'pudo-lockers.json');

let memory = null; // { fetchedAt, lockers } -- process-lifetime copy of the disk cache

function readDiskCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8'));
    if (Array.isArray(parsed.lockers)) return parsed;
  } catch { /* no cache yet, or unreadable -- treat as absent */ }
  return null;
}

// Slim the raw TCG payload down to what checkout needs. The raw objects
// carry opening hours, box sizes, coordinates etc -- tens of KB the
// storefront picker has no use for.
function slimLockers(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((l) => ({
      code: String(l.code || '').trim(),
      name: String(l.name || '').trim(),
      address: String(l.address || '').trim(),
    }))
    .filter((l) => l.name && l.address)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchFresh(apiKey, fetcher) {
  // TCG's docs describe key auth both as a bearer token and an api_key
  // parameter depending on endpoint generation -- send both; extras are
  // ignored server-side.
  const url = `${LOCKERS_URL}?api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetcher(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`PUDO lockers request failed: HTTP ${res.status}`);
  const lockers = slimLockers(await res.json());
  if (!lockers.length) throw new Error('PUDO lockers response contained no usable lockers');
  return lockers;
}

// The one entry point: returns { lockers, fetchedAt, stale? }. Refreshes at
// most once per TTL; on refresh failure serves whatever cache exists (a
// stale locker list beats none) and only returns empty when there has never
// been a successful fetch. Never throws -- checkout must keep working.
export async function getPudoLockers({ fetcher = fetch, db } = {}) {
  if (!memory) memory = readDiskCache();
  const fresh = memory && Date.now() - Date.parse(memory.fetchedAt) < CACHE_TTL_MS;
  if (fresh) return { lockers: memory.lockers, fetchedAt: memory.fetchedAt };

  const apiKey = String(getSettings(db).pudoApiKey || '').trim();
  if (!apiKey) return { lockers: memory?.lockers || [], fetchedAt: memory?.fetchedAt || null, stale: Boolean(memory) };

  try {
    const lockers = await fetchFresh(apiKey, fetcher);
    memory = { fetchedAt: new Date().toISOString(), lockers };
    try {
      fs.mkdirSync(dataDir(), { recursive: true });
      fs.writeFileSync(cacheFile(), JSON.stringify(memory));
    } catch (err) {
      console.error('PUDO locker cache write failed (serving from memory):', err.message);
    }
    return { lockers, fetchedAt: memory.fetchedAt };
  } catch (err) {
    console.error('PUDO locker refresh failed:', err.message);
    if (memory) {
      // Push the stale copy's clock forward so a dead API is retried once
      // per TTL, not hammered on every checkout page load.
      memory = { ...memory, fetchedAt: new Date().toISOString() };
      return { lockers: memory.lockers, fetchedAt: memory.fetchedAt, stale: true };
    }
    return { lockers: [], fetchedAt: null, stale: false };
  }
}

// Test hook: reset module state between test blocks.
export function _resetPudoCache() {
  memory = null;
}
