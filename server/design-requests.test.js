import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { listDesignRequests, getDesignRequest, createDesignRequest, updateDesignRequest, deleteDesignRequest } from './design-requests.js';

function basePayload(overrides = {}) {
  return { email: 'customer@example.com', name: 'Customer', description: 'A custom bracket for my car', ...overrides };
}

test('createDesignRequest defaults status to new and requires email + description', () => {
  const db = openDb(':memory:');
  const request = createDesignRequest(basePayload(), db);
  assert.strictEqual(request.status, 'new');
  assert.strictEqual(request.email, 'customer@example.com');
  assert.throws(() => createDesignRequest({ email: 'x@example.com' }, db), /Description is required/);
  assert.throws(() => createDesignRequest({ description: 'no email' }, db), /Email is required/);
  db.close();
});

test('listDesignRequests filters by status and orders newest first', () => {
  const db = openDb(':memory:');
  const a = createDesignRequest(basePayload({ email: 'a@example.com' }), db);
  createDesignRequest(basePayload({ email: 'b@example.com' }), db);
  updateDesignRequest(a.id, { status: 'quoted' }, db);
  const quoted = listDesignRequests({ status: 'quoted' }, db);
  assert.strictEqual(quoted.length, 1);
  assert.strictEqual(quoted[0].id, a.id);
  db.close();
});

test('updateDesignRequest rejects an invalid status', () => {
  const db = openDb(':memory:');
  const request = createDesignRequest(basePayload(), db);
  assert.throws(() => updateDesignRequest(request.id, { status: 'not-a-real-status' }, db), /Status must be one of/);
  db.close();
});

test('updateDesignRequest applies partial updates without clobbering other fields', () => {
  const db = openDb(':memory:');
  const request = createDesignRequest(basePayload({ budgetNote: 'under R500' }), db);
  const updated = updateDesignRequest(request.id, { adminNotes: 'Quoted at R350' }, db);
  assert.strictEqual(updated.budgetNote, 'under R500');
  assert.strictEqual(updated.adminNotes, 'Quoted at R350');
  db.close();
});

test('updateDesignRequest returns null for a missing id', () => {
  const db = openDb(':memory:');
  assert.strictEqual(updateDesignRequest('does-not-exist', { status: 'quoted' }, db), null);
  db.close();
});

test('deleteDesignRequest removes the row and getDesignRequest returns null afterward', () => {
  const db = openDb(':memory:');
  const request = createDesignRequest(basePayload(), db);
  assert.strictEqual(deleteDesignRequest(request.id, db), true);
  assert.strictEqual(getDesignRequest(request.id, db), null);
  db.close();
});
