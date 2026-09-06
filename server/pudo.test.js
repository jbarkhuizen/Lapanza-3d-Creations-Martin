import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getPudoLockers, _resetPudoCache } from './pudo.js';
import { openDb } from './db.js';
import { updateSettings } from './settings.js';

// pudo.js resolves its cache file from dataDir() (DATA_DIR env or cwd/data),
// so each test gets its own DATA_DIR temp dir plus a fresh in-memory module
// state via _resetPudoCache().
function withTempDataDir(fn) {
  const prev = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pudo-test-'));
  process.env.DATA_DIR = dir;
  _resetPudoCache();
  return Promise.resolve(fn(dir)).finally(() => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    _resetPudoCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

const RAW_LOCKERS = [
  { code: 'CG2', name: 'Beta Mall', address: '2 Beta St, Town', latitude: '-26', extra: 'x' },
  { code: 'CG1', name: 'Alpha Centre', address: '1 Alpha Rd, City' },
  { code: 'CG3', name: 'No Address' },
];

test('getPudoLockers returns empty without an API key and no cache', () =>
  withTempDataDir(async () => {
    const db = openDb(':memory:');
    const result = await getPudoLockers({ db, fetcher: () => { throw new Error('must not be called'); } });
    assert.deepStrictEqual(result.lockers, []);
    db.close();
  }));

test('getPudoLockers fetches, slims, sorts and caches when a key is set', () =>
  withTempDataDir(async (dir) => {
    const db = openDb(':memory:');
    updateSettings({ pudoApiKey: 'k123' }, db);
    let calls = 0;
    const fetcher = async (url, opts) => {
      calls += 1;
      assert.ok(url.includes('api_key=k123'));
      assert.strictEqual(opts.headers.Authorization, 'Bearer k123');
      return { ok: true, json: async () => RAW_LOCKERS };
    };
    const result = await getPudoLockers({ db, fetcher });
    assert.deepStrictEqual(result.lockers.map((l) => l.name), ['Alpha Centre', 'Beta Mall']); // sorted, no-address row dropped
    assert.deepStrictEqual(Object.keys(result.lockers[0]).sort(), ['address', 'code', 'name']); // slimmed
    assert.ok(fs.existsSync(path.join(dir, 'pudo-lockers.json')), 'disk cache written');

    // Second call inside the TTL serves the cache without refetching.
    const again = await getPudoLockers({ db, fetcher });
    assert.strictEqual(calls, 1);
    assert.strictEqual(again.lockers.length, 2);
    db.close();
  }));

test('getPudoLockers serves the stale cache when a refresh fails', () =>
  withTempDataDir(async (dir) => {
    const db = openDb(':memory:');
    updateSettings({ pudoApiKey: 'k123' }, db);
    // Seed an EXPIRED disk cache, as if fetched long ago.
    fs.writeFileSync(
      path.join(dir, 'pudo-lockers.json'),
      JSON.stringify({ fetchedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), lockers: [{ code: 'X', name: 'Old Locker', address: 'Somewhere' }] }),
    );
    const result = await getPudoLockers({ db, fetcher: async () => ({ ok: false, status: 500 }) });
    assert.strictEqual(result.stale, true);
    assert.deepStrictEqual(result.lockers.map((l) => l.name), ['Old Locker']);
    db.close();
  }));
