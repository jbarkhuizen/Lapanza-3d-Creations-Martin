import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { listDesignRequests, getDesignRequest, createDesignRequest, updateDesignRequest, deleteDesignRequest, pruneExpiredDesignFiles } from './design-requests.js';

function basePayload(overrides = {}) {
  return { email: 'customer@example.com', name: 'Customer', phone: '0821234567', description: 'A custom bracket for my car', ...overrides };
}

test('createDesignRequest defaults status to new and requires name + email + phone + description', () => {
  const db = openDb(':memory:');
  const request = createDesignRequest(basePayload(), db);
  assert.strictEqual(request.status, 'new');
  assert.strictEqual(request.email, 'customer@example.com');
  assert.throws(() => createDesignRequest(basePayload({ name: '' }), db), /Name is required/);
  assert.throws(() => createDesignRequest(basePayload({ email: '' }), db), /Email is required/);
  assert.throws(() => createDesignRequest(basePayload({ phone: '' }), db), /Phone is required/);
  assert.throws(() => createDesignRequest(basePayload({ description: '' }), db), /Description is required/);
  db.close();
});

test('listDesignRequests filters by status and orders newest first', () => {
  const db = openDb(':memory:');
  const a = createDesignRequest(basePayload({ email: 'a@example.com' }), db);
  createDesignRequest(basePayload({ email: 'b@example.com' }), db);
  updateDesignRequest(a.id, { status: 'in_progress' }, db);
  const inProgress = listDesignRequests({ status: 'in_progress' }, db);
  assert.strictEqual(inProgress.length, 1);
  assert.strictEqual(inProgress[0].id, a.id);
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
  assert.strictEqual(updateDesignRequest('does-not-exist', { status: 'in_progress' }, db), null);
  db.close();
});

test('createDesignRequest and updateDesignRequest store original filenames alongside the randomized upload paths', () => {
  const db = openDb(':memory:');
  const request = createDesignRequest(
    basePayload({ referenceImagePath: '/uploads/design-requests/abc.jpg', referenceImageOriginalName: 'my part.jpg' }),
    db,
  );
  assert.strictEqual(request.referenceImageOriginalName, 'my part.jpg');
  const updated = updateDesignRequest(
    request.id,
    { referenceFilePath: '/uploads/design-requests/def.stl', referenceFileOriginalName: 'my part v2.stl' },
    db,
  );
  assert.strictEqual(updated.referenceFileOriginalName, 'my part v2.stl');
  assert.strictEqual(updated.referenceImageOriginalName, 'my part.jpg');
  db.close();
});

test('updateDesignRequest auto-stamps finalizedAt when status moves to finalized, unless already set', () => {
  const db = openDb(':memory:');
  const request = createDesignRequest(basePayload(), db);
  assert.strictEqual(request.finalizedAt, null);

  const finalized = updateDesignRequest(request.id, { status: 'finalized' }, db);
  assert.ok(finalized.finalizedAt);
  const firstStamp = finalized.finalizedAt;

  // Re-saving while still finalized (e.g. an admin-notes edit) must not
  // move the date -- same "unless already set" rule todos.js's Done uses.
  const resaved = updateDesignRequest(request.id, { adminNotes: 'Delivered' }, db);
  assert.strictEqual(resaved.finalizedAt, firstStamp);
  db.close();
});

test('updateDesignRequest clears finalizedAt when status moves off finalized', () => {
  const db = openDb(':memory:');
  const request = createDesignRequest(basePayload(), db);
  updateDesignRequest(request.id, { status: 'finalized' }, db);
  const reopened = updateDesignRequest(request.id, { status: 'in_progress' }, db);
  assert.strictEqual(reopened.finalizedAt, null);
  db.close();
});

test('deleteDesignRequest removes the row and getDesignRequest returns null afterward', () => {
  const db = openDb(':memory:');
  const request = createDesignRequest(basePayload(), db);
  assert.strictEqual(deleteDesignRequest(request.id, db), true);
  assert.strictEqual(getDesignRequest(request.id, db), null);
  db.close();
});

test('pruneExpiredDesignFiles deletes only finalized-and-expired uploads, keeps rows and active requests (#90)', () => {
  const db = openDb(':memory:');
  const old = createDesignRequest({ name: 'Old', email: 'o@example.com', phone: '082', description: 'x' }, db);
  const fresh = createDesignRequest({ name: 'Fresh', email: 'f@example.com', phone: '082', description: 'y' }, db);
  const active = createDesignRequest({ name: 'Active', email: 'a@example.com', phone: '082', description: 'z' }, db);
  db.prepare("UPDATE design_requests SET reference_image_path = '/uploads/design-requests/a.jpg', reference_file_path = '/uploads/design-requests/a.stl', status = 'finalized', finalized_at = '2024-01-01T00:00:00.000Z' WHERE id = ?").run(old.id);
  db.prepare("UPDATE design_requests SET reference_file_path = '/uploads/design-requests/b.stl', status = 'finalized', finalized_at = ? WHERE id = ?").run(new Date().toISOString(), fresh.id);
  db.prepare("UPDATE design_requests SET reference_file_path = '/uploads/design-requests/c.stl', status = 'in_progress' WHERE id = ?").run(active.id);
  // Backdate the active one too -- status, not age, must protect it.
  db.prepare("UPDATE design_requests SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(active.id);

  const deleted = [];
  const pruned = pruneExpiredDesignFiles(12, (p) => deleted.push(p), db);
  assert.deepStrictEqual(pruned, [old.id]);
  assert.deepStrictEqual(deleted.sort(), ['/uploads/design-requests/a.jpg', '/uploads/design-requests/a.stl']);
  const row = db.prepare('SELECT reference_image_path, reference_file_path, description FROM design_requests WHERE id = ?').get(old.id);
  assert.strictEqual(row.reference_image_path, null);
  assert.strictEqual(row.reference_file_path, null);
  assert.strictEqual(row.description, 'x'); // record kept
  assert.strictEqual(db.prepare('SELECT reference_file_path FROM design_requests WHERE id = ?').get(active.id).reference_file_path, '/uploads/design-requests/c.stl');
  db.close();
});
