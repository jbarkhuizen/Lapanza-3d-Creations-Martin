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

test('getSettings upgrades a legacy plain-string inHouseFilamentBrands array to {id,name,active} objects', () => {
  const db = openDb(':memory:');
  updateSettings({ inHouseFilamentBrands: ['SunLu', 'eSUN 3D'] }, db);
  const settings = getSettings(db);
  assert.deepStrictEqual(settings.inHouseFilamentBrands, [
    { id: 'sunlu', name: 'SunLu', active: true },
    { id: 'esun-3d', name: 'eSUN 3D', active: true },
  ]);
  db.close();
});

test('getSettings leaves an already-upgraded configurable list untouched', () => {
  const db = openDb(':memory:');
  const brands = [{ id: 'custom-id', name: 'Custom Brand', active: false }];
  updateSettings({ inHouseFilamentBrands: brands }, db);
  const settings = getSettings(db);
  assert.deepStrictEqual(settings.inHouseFilamentBrands, brands);
  db.close();
});

test('getSettings falls back to the seeded defaults for todoCategories/todoPriorities when unset', () => {
  const db = openDb(':memory:');
  const settings = getSettings(db);
  assert.deepStrictEqual(
    settings.todoCategories.map((c) => c.name),
    ['Bug', 'Feature', 'Enhancement', 'Tech Debt'],
  );
  assert.deepStrictEqual(
    settings.todoPriorities.map((p) => p.name),
    ['Critical', 'High', 'Medium', 'Low'],
  );
  db.close();
});

test('getSettings falls back to the seeded defaults for carPartModelsLandrover/carPartModelsGwm when unset, and normalizes {id,name,active} shape', () => {
  const db = openDb(':memory:');
  const settings = getSettings(db);
  for (const key of ['carPartModelsLandrover', 'carPartModelsGwm']) {
    assert.ok(settings[key].length > 0);
    assert.ok(settings[key].every((m) => typeof m.id === 'string' && typeof m.name === 'string' && typeof m.active === 'boolean'));
  }
  assert.ok(settings.carPartModelsLandrover.some((m) => m.name === 'Defender 200 Tdi'));
  assert.ok(settings.carPartModelsGwm.some((m) => m.name === 'P300'));
  db.close();
});
