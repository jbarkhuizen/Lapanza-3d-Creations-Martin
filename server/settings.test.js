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
