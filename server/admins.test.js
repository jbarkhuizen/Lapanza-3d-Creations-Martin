import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { hasAnyAdmin, listAdmins, createAdmin, deleteAdmin, resetPassword, verifyLogin } from './admins.js';

test('hasAnyAdmin is false on an empty db, true after createAdmin', () => {
  const db = openDb(':memory:');
  assert.strictEqual(hasAnyAdmin(db), false);
  createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  assert.strictEqual(hasAnyAdmin(db), true);
  db.close();
});

test('createAdmin rejects a duplicate username', () => {
  const db = openDb(':memory:');
  createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  assert.throws(() => createAdmin({ username: 'johan', password: 'otherpassword' }, db), /already taken/);
  db.close();
});

test('every admin-password path enforces the 8-character minimum, not just first-run setup', () => {
  // Regression (launch-audit): the 8+ rule lived only on /api/setup, so
  // "add admin" and "reset password" accepted a 1-character password on the
  // account guarding the whole back office.
  const db = openDb(':memory:');
  assert.throws(() => createAdmin({ username: 'weak', password: 'short' }, db), /at least 8 characters/);
  const admin = createAdmin({ username: 'strong', password: 'correcthorse' }, db);
  assert.throws(() => resetPassword(admin.id, 'tiny', db), /at least 8 characters/);
  assert.strictEqual(resetPassword(admin.id, 'longenoughpassword', db), true);
  assert.ok(verifyLogin('strong', 'longenoughpassword', db));
  db.close();
});

test('verifyLogin succeeds with correct credentials, fails with wrong password or unknown user', () => {
  const db = openDb(':memory:');
  createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  assert.ok(verifyLogin('johan', 'correcthorse', db));
  assert.strictEqual(verifyLogin('johan', 'wrong', db), null);
  assert.strictEqual(verifyLogin('nobody', 'correcthorse', db), null);
  db.close();
});

test('deleteAdmin refuses to remove the last remaining admin', () => {
  const db = openDb(':memory:');
  const admin = createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  assert.throws(() => deleteAdmin(admin.id, db), /last admin/);
  db.close();
});

test('deleteAdmin succeeds when more than one admin exists', () => {
  const db = openDb(':memory:');
  const a = createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  createAdmin({ username: 'linandi', password: 'correcthorse2' }, db);
  assert.strictEqual(deleteAdmin(a.id, db), true);
  assert.strictEqual(listAdmins(db).length, 1);
  db.close();
});

test('resetPassword changes what verifyLogin accepts', () => {
  const db = openDb(':memory:');
  const admin = createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  resetPassword(admin.id, 'newpassword', db);
  assert.strictEqual(verifyLogin('johan', 'correcthorse', db), null);
  assert.ok(verifyLogin('johan', 'newpassword', db));
  db.close();
});

test('listAdmins never exposes password_hash', () => {
  const db = openDb(':memory:');
  createAdmin({ username: 'johan', password: 'correcthorse' }, db);
  const admins = listAdmins(db);
  assert.strictEqual(admins[0].password_hash, undefined);
  assert.strictEqual(admins[0].username, 'johan');
  db.close();
});
