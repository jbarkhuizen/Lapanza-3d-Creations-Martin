import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { getDb } from './db.js';

export function hasAnyAdmin(db = getDb()) {
  return db.prepare('SELECT COUNT(*) AS n FROM admins').get().n > 0;
}

export function listAdmins(db = getDb()) {
  return db.prepare('SELECT id, username, email, created_at FROM admins ORDER BY created_at ASC').all();
}

// One password rule for every path that sets an admin password. The 8+
// minimum previously existed only on the first-run /api/setup route, so
// "add admin" and "reset password" happily accepted a 1-character password
// on the account guarding the entire back office (launch-audit finding).
// Matches resetClientPassword's customer-side rule.
const MIN_PASSWORD_LENGTH = 8;
function assertPasswordAllowed(password) {
  if (!password) throw new Error('Password required');
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

// Throws a friendly, specific error before the INSERT/UPDATE ever runs --
// same reasoning as the username uniqueness check just below: a raw SQLite
// UNIQUE-constraint failure from the idx_admins_email partial index would
// surface as an opaque "UNIQUE constraint failed" string to the admin.
function assertEmailAvailable(email, db, excludeId) {
  if (!email) return;
  const existing = db.prepare('SELECT id FROM admins WHERE LOWER(email) = LOWER(?)').get(email);
  if (existing && existing.id !== excludeId) throw new Error('Email already in use by another admin account');
}

export function createAdmin({ username, password, email }, db = getDb()) {
  if (!username) throw new Error('Username and password required');
  assertPasswordAllowed(password);
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (existing) throw new Error('Username already taken');
  const trimmedEmail = String(email || '').trim();
  assertEmailAvailable(trimmedEmail, db);
  const admin = {
    id: randomUUID(),
    username,
    email: trimmedEmail || null,
    password_hash: bcrypt.hashSync(password, 10),
    created_at: new Date().toISOString(),
  };
  db.prepare(
    'INSERT INTO admins (id, username, email, password_hash, created_at) VALUES (@id, @username, @email, @password_hash, @created_at)',
  ).run(admin);
  return { id: admin.id, username: admin.username, email: admin.email, created_at: admin.created_at };
}

// Owner request (2026-09-08): lets an existing admin account (every one of
// which predates the email column) actually gain a login-by-email option.
// Passing an empty string clears it back to NULL rather than storing '' --
// keeps the partial unique index's `email <> ''` guard meaningful, and
// matches assertEmailAvailable()'s !email early-return for a blank value.
export function updateAdminEmail(id, email, db = getDb()) {
  const trimmedEmail = String(email || '').trim();
  assertEmailAvailable(trimmedEmail, db, id);
  const result = db.prepare('UPDATE admins SET email = ? WHERE id = ?').run(trimmedEmail || null, id);
  return result.changes > 0;
}

export function deleteAdmin(id, db = getDb()) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (count <= 1) throw new Error('Cannot remove the last admin account');
  const result = db.prepare('DELETE FROM admins WHERE id = ?').run(id);
  return result.changes > 0;
}

export function resetPassword(id, password, db = getDb()) {
  assertPasswordAllowed(password);
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, id);
  return result.changes > 0;
}

// Owner request (2026-09-08): `identifier` may be either the username or the
// account's email (if it has one -- see ensureAdminEmailColumn's comment).
// Returns the account's REAL username, never the raw identifier the caller
// typed -- login-by-email must not let "the email" end up recorded as the
// username in the session, audit log, or anywhere else that reads it.
export function verifyLogin(identifier, password, db = getDb()) {
  const trimmed = String(identifier || '').trim();
  const row = db
    .prepare('SELECT id, username, password_hash FROM admins WHERE username = ? OR (email IS NOT NULL AND LOWER(email) = LOWER(?))')
    .get(trimmed, trimmed);
  if (!row) return null;
  return bcrypt.compareSync(password, row.password_hash) ? { id: row.id, username: row.username } : null;
}
