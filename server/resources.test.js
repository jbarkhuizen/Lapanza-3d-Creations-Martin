import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { listResources, getResource, createResource, updateResource, deleteResource } from './resources.js';

function basePayload(overrides = {}) {
  return { title: 'Articulated dragon', filamentType: 'PLA', ...overrides };
}

test('createResource stores original filenames alongside the randomized upload paths', () => {
  const db = openDb(':memory:');
  const resource = createResource(
    basePayload({ imagePath: '/uploads/resources/abc123.jpg', imageOriginalName: 'dragon.jpg', filePath: '/uploads/resources/def456.stl', fileOriginalName: 'Dragon Model.stl' }),
    db,
  );
  assert.strictEqual(resource.imageOriginalName, 'dragon.jpg');
  assert.strictEqual(resource.fileOriginalName, 'Dragon Model.stl');
  assert.strictEqual(getResource(resource.id, db).fileOriginalName, 'Dragon Model.stl');
  db.close();
});

test('updateResource sets original filenames on upload without clobbering other fields', () => {
  const db = openDb(':memory:');
  const resource = createResource(basePayload({ dimensions: '80x80x120mm' }), db);
  const updated = updateResource(resource.id, { filePath: '/uploads/resources/xyz789.3mf', fileOriginalName: 'dragon v2.3mf' }, db);
  assert.strictEqual(updated.fileOriginalName, 'dragon v2.3mf');
  assert.strictEqual(updated.dimensions, '80x80x120mm');
  db.close();
});

test('listResources orders by sort order then newest first', () => {
  const db = openDb(':memory:');
  createResource(basePayload({ title: 'Second', sortOrder: 1 }), db);
  createResource(basePayload({ title: 'First', sortOrder: 0 }), db);
  const [first, second] = listResources({}, db);
  assert.strictEqual(first.title, 'First');
  assert.strictEqual(second.title, 'Second');
  db.close();
});

test('deleteResource removes the row and getResource returns null afterward', () => {
  const db = openDb(':memory:');
  const resource = createResource(basePayload(), db);
  assert.strictEqual(deleteResource(resource.id, db), true);
  assert.strictEqual(getResource(resource.id, db), null);
  db.close();
});
