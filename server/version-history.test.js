import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { listVersions, recordVersion } from './version-history.js';

test('recordVersion starts the automated scheme at 1.01', () => {
  const db = openDb(':memory:');
  const result = recordVersion('First deploy', 'deploy', db);
  assert.strictEqual(result.version_label, '1.01');
  assert.strictEqual(result.deployed_by, 'deploy');
  db.close();
});

test('recordVersion increments the minor part on each subsequent call', () => {
  const db = openDb(':memory:');
  recordVersion('First', 'deploy', db);
  const second = recordVersion('Second', 'deploy', db);
  const third = recordVersion('Third', 'deploy', db);
  assert.strictEqual(second.version_label, '1.02');
  assert.strictEqual(third.version_label, '1.03');
  db.close();
});

test('recordVersion rolls the major version over after .99', () => {
  const db = openDb(':memory:');
  db.prepare(
    `INSERT INTO version_history (id, version_number, version_label, description, deployed_date, deployed_by, created_at)
     VALUES ('seed', 1, '1.99', 'Seeded at the boundary', datetime('now'), 'deploy', datetime('now'))`,
  ).run();
  const result = recordVersion('Rolls over', 'deploy', db);
  assert.strictEqual(result.version_label, '2.01');
  db.close();
});

test('recordVersion rejects a missing description', () => {
  const db = openDb(':memory:');
  assert.throws(() => recordVersion('', 'deploy', db), /description required/);
  db.close();
});

test('listVersions returns newest first', () => {
  const db = openDb(':memory:');
  recordVersion('Older', 'deploy', db);
  recordVersion('Newer', 'deploy', db);
  const versions = listVersions(db);
  assert.strictEqual(versions.length, 2);
  assert.strictEqual(versions[0].description, 'Newer');
  assert.strictEqual(versions[1].description, 'Older');
  db.close();
});
